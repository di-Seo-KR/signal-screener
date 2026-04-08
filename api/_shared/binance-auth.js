// 유저의 저장된 API 키를 복호화해서 가져오는 공통 헬퍼.
// 모든 실전 매매 엔드포인트는 이 함수를 거쳐야 함.

import { decrypt } from "./encryption.js";

/**
 * @param {string} userId
 * @returns {Promise<{apiKey: string, apiSecret: string, testnet: boolean, label: string, record: object}>}
 * @throws Error (code: NOT_CONNECTED | REVOKED | DECRYPT_FAILED)
 */
export async function loadUserCredentials(userId) {
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
