// ════════════════════════════════════════════════════════════════════
// GET /api/market-temp — Zepta 마켓 온도 지수 (자체 지표 1호)
// ────────────────────────────────────────────────────────────────────
// 프론트 계약 (홈에서 소비):
//   { ok: true, temp: 0~100, label: "냉각|위축|중립|가열|과열",
//     components: { breadth|funding|fearGreed: {...}|null }, updatedAt, cached? }
//   실패 시 { ok: false, error } (HTTP 503)
//
// 산식·가중치·라벨 경계는 api/_shared/market-temp.js 주석에 명시 (재현 가능성).
// KV 10분 캐시 + CDN s-maxage 120s — btc-cron(10분) 갱신 주기와 정합.
// ════════════════════════════════════════════════════════════════════

import { getMarketTempCached } from "./_shared/market-temp.js";

// KV 핸들 — env 미설정 환경에서도 죽지 않는 graceful 획득.
// ★ 주의: @vercel/kv 의 kv 는 env 미설정 시 *모든 프로퍼티 접근*에서 throw 하는
//   Proxy 라, async 함수가 프록시를 그대로 return 하면 프라미스 해소가 .then 을
//   건드리며 try/catch 밖에서 터짐(로컬 실측). → 접근 프로브 후 평범한 객체로 래핑.
async function getKv() {
  try {
    const { kv } = await import("@vercel/kv");
    const get = kv.get.bind(kv); // env 미설정이면 이 접근에서 throw → catch → null
    const set = kv.set.bind(kv);
    return { get, set };
  } catch { return null; }
}

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });

  try {
    const kv = await getKv();
    const result = await getMarketTempCached(kv);
    if (!result.ok) {
      res.setHeader("Cache-Control", "no-store");
      return res.status(503).json(result);
    }
    const { _breadthCoins: _omit, ...pub } = result; // 내부 필드 제거
    res.setHeader("Cache-Control", "public, s-maxage=120, stale-while-revalidate=600");
    return res.status(200).json(pub);
  } catch (err) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
}
