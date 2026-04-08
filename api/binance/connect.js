// POST /api/binance/connect
// 유저가 바이낸스 Futures API 키를 등록할 때 호출.
// 1) 키 유효성 & 권한 검증 (futures trade O, withdraw X)
// 2) AES-256-GCM 암호화 후 Vercel KV에 저장
// 3) 마스킹된 키 + 계정 요약 응답
//
// 요청 body (JSON):
// {
//   "userId":    "string (필수)",
//   "apiKey":    "string (필수)",
//   "apiSecret": "string (필수)",
//   "testnet":   boolean (선택, 기본 false),
//   "label":     "string (선택, 키 별명)"
// }
//
// 저장 키: di:real:user:{userId}:credentials

import { encrypt, maskKey } from "../_shared/encryption.js";
import { getAccountInfo } from "../_shared/binance-client.js";

export default async function handler(req, res) {
  // CORS (프론트에서 직접 호출 대비)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const { userId, apiKey, apiSecret, testnet = false, label = "" } = body;

    if (!userId || typeof userId !== "string") {
      return res.status(400).json({ error: "userId is required" });
    }
    if (!apiKey || typeof apiKey !== "string" || apiKey.length < 10) {
      return res.status(400).json({ error: "apiKey is required" });
    }
    if (!apiSecret || typeof apiSecret !== "string" || apiSecret.length < 10) {
      return res.status(400).json({ error: "apiSecret is required" });
    }

    // === 1) 바이낸스에 실제로 물어봐서 검증 ===
    let account;
    try {
      account = await getAccountInfo({ apiKey, apiSecret, testnet });
    } catch (e) {
      return res.status(400).json({
        error: "바이낸스 API 키 검증 실패",
        detail: e?.message || String(e),
        code: e?.code,
        hint: "키 오타, IP 화이트리스트, 또는 Futures 권한 미활성화일 수 있습니다.",
      });
    }

    // === 2) 권한 체크 ===
    // canTrade: 선물 매매 허용 여부
    // canWithdraw: 출금 권한 (반드시 false 여야 함 — 보안 정책)
    if (account.canTrade !== true) {
      return res.status(400).json({
        error: "이 API 키는 Futures 매매 권한이 없습니다.",
        hint: "바이낸스에서 API 키 편집 > 'Enable Futures' 체크 후 다시 시도하세요.",
      });
    }
    if (account.canWithdraw === true) {
      return res.status(400).json({
        error: "출금 권한이 켜진 API 키는 사용할 수 없습니다.",
        hint: "보안을 위해 반드시 출금 권한(Enable Withdrawals)을 꺼주세요.",
      });
    }

    // === 3) 암호화 & 저장 ===
    const kvModule = await import("@vercel/kv");
    const kv = kvModule.kv;

    const record = {
      userId,
      label: label || (testnet ? "Binance Testnet" : "Binance Futures"),
      testnet: !!testnet,
      apiKeyEnc: encrypt(apiKey),
      apiSecretEnc: encrypt(apiSecret),
      apiKeyMasked: maskKey(apiKey),
      createdAt: new Date().toISOString(),
      lastVerifiedAt: new Date().toISOString(),
      status: "active",
      // 검증 스냅샷 (UI 확인용, 민감정보 아님)
      verification: {
        canTrade: account.canTrade,
        canWithdraw: account.canWithdraw,
        canDeposit: account.canDeposit,
        totalWalletBalance: account.totalWalletBalance,
        availableBalance: account.availableBalance,
        feeTier: account.feeTier,
      },
    };

    const key = `di:real:user:${userId}:credentials`;
    await kv.set(key, record);

    // 유저 실전 트랙 활성화 플래그
    await kv.set(`di:real:user:${userId}:enabled`, true);

    return res.status(200).json({
      ok: true,
      userId,
      label: record.label,
      testnet: record.testnet,
      apiKeyMasked: record.apiKeyMasked,
      verification: record.verification,
      createdAt: record.createdAt,
    });
  } catch (err) {
    console.error("[binance/connect] error:", err);
    return res.status(500).json({ error: "Internal error", detail: err?.message || String(err) });
  }
}
