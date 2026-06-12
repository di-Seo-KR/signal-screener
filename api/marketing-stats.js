// ════════════════════════════════════════════════════════════════════
// Zepta — 마케팅 대시보드 통계 API (오너 전용)
// GET /api/marketing-stats?uid=<ownerId>&days=14
//
// /api/track 이 적재한 KV 일별 집계를 합쳐 반환.
// 응답: { ok, days:[{date, pv, uv, dev:{m,d}}], topPaths, refs, utm, events, totals }
// ════════════════════════════════════════════════════════════════════

export const config = { maxDuration: 30 };

const OWNER = process.env.ZEPTA_OWNER_USER_ID || "b707e106-8d92-499a-887b-e1ce0145033c";

function kstDayOffset(offset) {
  const d = new Date(Date.now() + 9 * 3600000 - offset * 86400000);
  return d.toISOString().slice(0, 10);
}

function mergeHash(into, hash) {
  for (const [k, v] of Object.entries(hash || {})) {
    into[k] = (into[k] || 0) + Number(v || 0);
  }
}

function topN(hash, n = 15) {
  return Object.entries(hash)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k, v]) => ({ k, v }));
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "private, no-store");

  const uid = String(req.query.uid || "");
  if (uid !== OWNER) return res.status(403).json({ ok: false, error: "owner only" });

  const days = Math.max(1, Math.min(30, parseInt(req.query.days, 10) || 14));

  try {
    const { kv } = await import("@vercel/kv");
    const dayKeys = Array.from({ length: days }, (_, i) => kstDayOffset(days - 1 - i)); // 과거→오늘

    // 일자별 병렬 조회 (pv hash 합 + uv scard + dev hash)
    const perDay = await Promise.all(dayKeys.map(async (day) => {
      const [pvHash, uvCount, devHash] = await Promise.all([
        kv.hgetall(`di:mkt:pv:${day}`).catch(() => null),
        kv.scard(`di:mkt:uv:${day}`).catch(() => 0),
        kv.hgetall(`di:mkt:dev:${day}`).catch(() => null),
      ]);
      const pv = Object.values(pvHash || {}).reduce((a, b) => a + Number(b || 0), 0);
      return {
        date: day,
        pv,
        uv: Number(uvCount || 0),
        dev: { m: Number(devHash?.m || 0), d: Number(devHash?.d || 0) },
        _pvHash: pvHash || {},
      };
    }));

    // 기간 합산 (경로/유입/UTM/이벤트)
    const pathAgg = {}, refAgg = {}, utmAgg = {}, evAgg = {};
    for (const d of perDay) mergeHash(pathAgg, d._pvHash);
    const [refHashes, utmHashes, evHashes] = await Promise.all([
      Promise.all(dayKeys.map(day => kv.hgetall(`di:mkt:ref:${day}`).catch(() => null))),
      Promise.all(dayKeys.map(day => kv.hgetall(`di:mkt:utm:${day}`).catch(() => null))),
      Promise.all(dayKeys.map(day => kv.hgetall(`di:mkt:ev:${day}`).catch(() => null))),
    ]);
    refHashes.forEach(h => mergeHash(refAgg, h));
    utmHashes.forEach(h => mergeHash(utmAgg, h));
    evHashes.forEach(h => mergeHash(evAgg, h));

    const totals = {
      pv: perDay.reduce((a, d) => a + d.pv, 0),
      uv: perDay.reduce((a, d) => a + d.uv, 0), // 일별 UV 합 (기간 고유 아님 — 라벨에 명시)
      m: perDay.reduce((a, d) => a + d.dev.m, 0),
      d: perDay.reduce((a, d) => a + d.dev.d, 0),
    };

    return res.status(200).json({
      ok: true,
      rangeDays: days,
      days: perDay.map(({ _pvHash, ...rest }) => rest),
      topPaths: topN(pathAgg, 20),
      refs: topN(refAgg, 15),
      utm: topN(utmAgg, 15),
      events: topN(evAgg, 30),
      totals,
      generatedAt: new Date().toISOString(),
    });
  } catch (e) {
    return res.status(200).json({ ok: false, error: e?.message || String(e) });
  }
}
