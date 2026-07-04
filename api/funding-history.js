// ════════════════════════════════════════════════════════════════════
// 펀딩비 히스토리 API — 타점 엔진 v4.1 펀딩 스퀴즈 요소용 (2026-07-04)
// ────────────────────────────────────────────────────────────────────
// GET /api/funding-history?symbol=BTCUSDT
//   → { ok, symbol, rates: [{ t, rate }] }  (8h 간격, 최근 ~333일, 오름차순)
// 바이낸스 /fapi/v1/fundingRate 프록시(무서명, Vercel 451 회피는 binance-client
// 프록시 모드가 처리). KV 캐시 6h — 펀딩은 8h 마다 갱신되므로 충분.
// 보안: read-only·public, 심볼 화이트리스트 형식 검증, KV 캐싱으로 abuse 방지.
// ════════════════════════════════════════════════════════════════════

import { getFundingHistory } from "./_shared/binance-client.js";

async function getKv() {
  try {
    if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) return null;
    return (await import("@vercel/kv")).kv;
  } catch { return null; }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  const symbol = String(req.query?.symbol || "").toUpperCase();
  if (!/^[A-Z0-9]{5,20}$/.test(symbol)) {
    return res.status(400).json({ ok: false, error: "invalid symbol" });
  }

  const cacheKey = `di:funding:hist:${symbol}`;
  const kv = await getKv();
  try {
    if (kv) {
      const cached = await kv.get(cacheKey);
      if (cached?.rates?.length && Date.now() - (cached.at || 0) < 6 * 3600 * 1000) {
        res.setHeader("Cache-Control", "public, max-age=1800");
        return res.status(200).json({ ok: true, symbol, rates: cached.rates, cached: true });
      }
    }
    const rows = await getFundingHistory({ symbol, limit: 1000 });
    if (!Array.isArray(rows)) throw new Error("unexpected response");
    const rates = rows
      .map((r) => ({ t: Number(r.fundingTime), rate: parseFloat(r.fundingRate) }))
      .filter((r) => Number.isFinite(r.t) && Number.isFinite(r.rate))
      .sort((a, b) => a.t - b.t);
    if (kv && rates.length) { try { await kv.set(cacheKey, { at: Date.now(), rates }); } catch {} }
    res.setHeader("Cache-Control", "public, max-age=1800");
    return res.status(200).json({ ok: true, symbol, rates });
  } catch (e) {
    return res.status(200).json({ ok: false, symbol, error: e?.message || String(e), rates: [] });
  }
}
