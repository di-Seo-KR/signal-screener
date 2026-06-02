// 유저의 저장된 API 키를 복호화해서 가져오는 공통 헬퍼.
// 모든 실전 매매 엔드포인트는 이 함수를 거쳐야 함.

import { decrypt } from "./encryption.js";
import { verifyToken } from "./require-auth.js";

const AUTH_ENFORCE = process.env.ZEPTA_AUTH_ENFORCE === "1";

/**
 * @param {string} userId  클라이언트가 주장한 userId
 * @param {object} [req]   HTTP 요청 — 주어지면 Supabase 세션 토큰 검증(인증 게이트).
 *   ★ 2026-06-02 (F-1 IDOR 차단): req 전달 시 토큰의 user 와 userId 일치 강제(ENFORCE 모드).
 *   cron/자동매매는 req 없이 호출 → 게이트 미적용(영향 0). 모든 키 접근의 choke point.
 * @returns {Promise<{apiKey, apiSecret, testnet, label, record}>}
 * @throws Error (code: BAD_REQUEST | UNAUTHORIZED | FORBIDDEN | NOT_CONNECTED | REVOKED | DECRYPT_FAILED)
 */
export async function loadUserCredentials(userId, req = null) {
  if (req) {
    const h = req.headers?.authorization || req.headers?.Authorization || "";
    const token = typeof h === "string" && h.startsWith("Bearer ") ? h.slice(7) : "";
    const verified = verifyToken(token);
    if (AUTH_ENFORCE) {
      if (!verified?.id) { const e = new Error("유효한 세션 토큰이 필요합니다."); e.code = "UNAUTHORIZED"; throw e; }
      if (userId && userId !== verified.id) { const e = new Error("토큰과 다른 userId 입니다."); e.code = "FORBIDDEN"; throw e; }
      userId = verified.id; // 검증된 id 사용 (위조 차단)
    } else if (token) {
      console.log(`[auth] soft: ${verified?.id ? `verified ${verified.id}` : "verify FAILED"} (claimed=${userId || "none"})`);
    }
  }
  if (!userId) {
    const e = new Error("userId is required");
    e.code = "BAD_REQUEST";
    throw e;
  }
  const kvModule = await import("@vercel/kv");
  const kv = kvModule.kv;
  const record = await kv.get(`di:real:user:${userId}:credentials`);
  if (!record) {
    const e = new Error("등록된 바이낸스 API 키가 없습니다.");
    e.code = "NOT_CONNECTED";
    throw e;
  }
  if (record.status === "revoked" || !record.apiKeyEnc || !record.apiSecretEnc) {
    const e = new Error("해제된 API 키입니다. 다시 등록해주세요.");
    e.code = "REVOKED";
    throw e;
  }
  let apiKey, apiSecret;
  try {
    apiKey = decrypt(record.apiKeyEnc);
    apiSecret = decrypt(record.apiSecretEnc);
  } catch (err) {
    const e = new Error("키 복호화 실패: " + (err?.message || err));
    e.code = "DECRYPT_FAILED";
    throw e;
  }
  return { apiKey, apiSecret, testnet: !!record.testnet, label: record.label, record };
}

/** 에러를 HTTP 응답으로 변환 */
export function respondError(res, err) {
  const code = err?.code;
  if (code === "UNAUTHORIZED") return res.status(401).json({ ok: false, error: err.message, code });
  if (code === "FORBIDDEN") return res.status(403).json({ ok: false, error: err.message, code });
  if (code === "BAD_REQUEST") return res.status(400).json({ ok: false, error: err.message });
  if (code === "NOT_CONNECTED") return res.status(404).json({ ok: false, error: err.message, code });
  if (code === "REVOKED") return res.status(410).json({ ok: false, error: err.message, code });
  if (code === "DECRYPT_FAILED") return res.status(500).json({ ok: false, error: err.message, code });
  // 바이낸스 호출 에러
  if (err?.data?.code) {
    return res.status(400).json({
      ok: false,
      error: "Binance API error",
      binanceCode: err.data.code,
      binanceMsg: err.data.msg,
    });
  }
  console.error("[binance] unhandled:", err);
  return res.status(500).json({ ok: false, error: err?.message || String(err) });
}
