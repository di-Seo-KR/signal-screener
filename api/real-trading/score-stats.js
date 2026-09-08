// GET /api/real-trading/score-stats
//
// ★ 2026-09-08 (대표 지시 "스코어링 계속 개선"): 스코어 섀도 자동 채점 통계 공개.
//   btc-cron 이 적재·채점하는 di:score:shadow-stats(#270, score-shadow.js)를
//   읽기 전용으로 서빙합니다 — "점수대별로 신호가 실제로 맞았는가"의 실측.
//
//   · 집계 전용(개별 거래·계정 정보 없음) → 공개 무해. 코인 카드 적중률 표시와
//     일일 감사의 캘리브레이션 판단이 이 엔드포인트 하나를 공유합니다.
//   · winRate = +24h 뒤 신호 방향으로 가격이 움직인 비율(수수료 미반영 방향 적중).
//   · 표본이 어린 초기엔 n 이 작음 — 소비자(UI)는 n 게이트(≥30)로 표시 여부를 판단.
//
// → { ok, total:{n,winRate,avgRetPct}, byScoreBucket:{ "LONG:75-84": {...}, ... },
//      byBucket:{ "75-84": {...} }(방향 합산), oc, h2, matured, expired, updatedAt }

async function getKv() {
  return (await import("@vercel/kv")).kv;
}

const STATS_KEY = "di:score:shadow-stats";

function pub(b) {
  const n = Number(b?.n) || 0;
  if (!n) return null;
  return {
    n,
    winRate: Number(((Number(b.win) || 0) / n * 100).toFixed(1)),
    avgRetPct: Number(((Number(b.sumRet) || 0) / n * 100).toFixed(3)),
  };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  // 채점은 btc-cron(10분) 주기 — 5분 엣지 캐시로 KV 읽기 흡수
  res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    const kv = await getKv();
    const stats = (await kv.get(STATS_KEY)) || null;
    if (!stats || !stats.total) {
      return res.status(200).json({ ok: true, available: false, note: "표본 축적 전 (score-shadow #270 배포 후 +24h 채점부터 누적)" });
    }

    const byScoreBucket = {};
    const byBucket = {}; // 방향 합산(표시용 — LONG/SHORT 합쳐 점수대만)
    for (const [k, b] of Object.entries(stats.byScoreBucket || {})) {
      const p = pub(b);
      if (!p) continue;
      byScoreBucket[k] = p;
      const bucket = k.includes(":") ? k.split(":")[1] : k;
      const agg = byBucket[bucket] || (byBucket[bucket] = { n: 0, win: 0, sumRet: 0 });
      agg.n += Number(b.n) || 0;
      agg.win += Number(b.win) || 0;
      agg.sumRet += Number(b.sumRet) || 0;
    }
    for (const k of Object.keys(byBucket)) byBucket[k] = pub(byBucket[k]);

    const mapPub = (o) => Object.fromEntries(
      Object.entries(o || {}).map(([k, b]) => [k, pub(b)]).filter(([, v]) => v)
    );

    return res.status(200).json({
      ok: true,
      available: true,
      total: pub(stats.total),
      byScoreBucket,
      byBucket,
      oc: mapPub(stats.oc),
      h2: mapPub(stats.h2),
      matured: stats.matured || 0,
      expired: stats.expired || 0,
      updatedAt: stats.updatedAt || null,
      note: "+24h 방향 적중 실측(수수료 미반영). n 이 작은 구간은 통계적 의미 제한 — UI 는 n≥30 게이트 권장.",
    });
  } catch (err) {
    console.error("[score-stats]", err);
    return res.status(500).json({ error: err?.message || String(err) });
  }
}
