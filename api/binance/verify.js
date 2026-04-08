// GET /api/binance/verify?userId=xxx
// 저장된 API 키가 아직 유효한지 재검증 + 계정 요약 반환.
// 민감정보(apiKey/secret)는 절대 응답에 포함하지 않음.

import { decrypt, maskKey } from "../_shared/encryption.js";
import { getAccountInfo } from "../_shared/binance-client.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    const userId = req.query.userId;
    if (!userId) return res.status(400).json({ error: "userId is required" });

    const kvModule = await import("@vercel/kv");
    const kv = kvModule.kv;

    const key = `di:real:user:${userId}:credentials`;
    const record = await kv.get(key);
    if (!record) {
      return res.status(404).json({ ok: false, connected: false, error: "등록된 API 키가 없습니다." });
    }

    let apiKey, apiSecret;
    try {
      apiKey = decrypt(record.apiKeyEnc);
      apiSecret = decrypt(record.apiSecretEnc);
    } catch (e) {
      return res.status(500).json({ ok: false, connected: false, error: "저장된 키 복호화 실패", detail: e?.message });
    }

    let account;
    try {
      account = await getAccountInfo({ apiKey, apiSecret, testnet: !!record.testnet });
    } catch (e) {
      // 키가 revoke 되었을 수 있음 — status만 갱신
      const updated = { ...record, status: "invalid", lastError: e?.message || String(e), lastVerifiedAt: new Date().toISOString() };
      await kv.set(key, updated);
      return res.status(200).json({
        ok: false,
        connected: true,
        valid: false,
        error: "API 키 검증 실패",
        detail: e?.message,
        apiKeyMasked: record.apiKeyMasked,
      });
    }

    const verification = {
      canTrade: account.canTrade,
      canWithdraw: account.canWithdraw,
      canDeposit: account.canDeposit,
      totalWalletBalance: account.totalWalletBalance,
      availableBalance: account.availableBalance,
      totalMarginBalance: account.totalMarginBalance,
      totalUnrealizedProfit: account.totalUnrealizedProfit,
      feeTier: account.feeTier,
      positionsCount: (account.positions || []).filter(p => parseFloat(p.positionAmt || 0) !== 0).length,
    };

    const updated = { ...record, status: "active", lastVerifiedAt: new Date().toISOString(), verification, lastError: null };
    await kv.set(key, updated);

    return res.status(200).json({
      ok: true,
      connected: true,
      valid: true,
      userId,
      label: record.label,
      testnet: record.testnet,
      apiKeyMasked: record.apiKeyMasked,
      verification,
      lastVerifiedAt: updated.lastVerifiedAt,
    });
  } catch (err) {
    console.error("[binance/verify] error:", err);
    return res.status(500).json({ error: "Internal error", detail: err?.message || String(err) });
  }
}
