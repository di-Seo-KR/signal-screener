// ════════════════════════════════════════════════════════════════════
// Zepta — 마케팅 대시보드 통계 API (오너 전용, GA4급)
// GET /api/marketing-stats?uid=<ownerId>&days=14
//
// /api/track 이 적재한 KV 일별 집계를 합쳐 반환.
// 응답: {
//   ok, rangeDays, days:[{date, pv, uv, newUv, sessions, signups, dev}],
//   topPaths, refs, utm, events, geo, os, browser,
//   funnel:[{step, n}], realtimeActive, users:{total, source, today, last7},
//   totals
// }
// ════════════════════════════════════════════════════════════════════

export const config = { maxDuration: 30 };

const OWNER = process.env.ZEPTA_OWNER_USER_ID || "b707e106-8d92-499a-887b-e1ce0145033c";

function kstDayOffset(offset) {
  const d = new Date(Date.now() + 9 * 3600000 - offset * 86400000);
  return d.toISOString().slice(0, 10);
}

function mergeHash(into, hash) {
  for (const [k, v] of Object.entries(hash || {})) into[k] = (into[k] || 0) + Number(v || 0);
}
function topN(hash, n = 15) {
  return Object.entries(hash).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => ({ k, v }));
}
function sumEv(evHashes, name) {
  let s = 0;
  for (const h of evHashes) for (const [k, v] of Object.entries(h || {})) {
    if (k === name || k.startsWith(name + "::")) s += Number(v || 0);
  }
  return s;
}

// ── 가입 유저수: Supabase service-role(정확) → 없으면 KV signup 카운터(근사) ──
async function fetchUserCount(kv) {
  const url = process.env.SUPABASE_URL || "https://tlszuuimorxcfohzirlz.supabase.co";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (key) {
    try {
      // Admin REST: total 은 응답 헤더 x-total-count 또는 body.total 로 옴
      const r = await fetch(`${url}/auth/v1/admin/users?per_page=1&page=1`, {
        headers: { apikey: key, Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(6000),
      });
      if (r.ok) {
        const totalHeader = r.headers.get("x-total-count");
        let total = totalHeader != null ? Number(totalHeader) : null;
        if (total == null) { const j = await r.json().catch(() => null); total = Number(j?.total ?? (Array.isArray(j?.users) ? j.users.length : NaN)); }
        if (Number.isFinite(total)) return { total, source: "supabase" };
      }
      return { total: null, source: "supabase-error", error: `HTTP ${r.status}` };
    } catch (e) {
      return { total: null, source: "supabase-error", error: e?.message || String(e) };
    }
  }
  // 폴백 — track 의 signup_completed 누적 (추적 시작 이후 가입, 과거 유저 미포함)
  try {
    const n = await kv.get("di:auth:signup-total");
    return { total: Number(n || 0), source: "kv-fallback" };
  } catch {
    return { total: null, source: "none" };
  }
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

    // 일자별: pv합 + uv(scard) + new + sessions(scard) + signups + dev
    const perDay = await Promise.all(dayKeys.map(async (day) => {
      const [pvHash, uvCount, newHash, sessCount, signHash, devHash] = await Promise.all([
        kv.hgetall(`di:mkt:pv:${day}`).catch(() => null),
        kv.scard(`di:mkt:uv:${day}`).catch(() => 0),
        kv.hgetall(`di:mkt:new:${day}`).catch(() => null),
        kv.scard(`di:mkt:sess:${day}`).catch(() => 0),
        kv.hgetall(`di:mkt:signups:${day}`).catch(() => null),
        kv.hgetall(`di:mkt:dev:${day}`).catch(() => null),
      ]);
      const pv = Object.values(pvHash || {}).reduce((a, b) => a + Number(b || 0), 0);
      const uv = Number(uvCount || 0);
      const newUv = Number(newHash?.n || 0);
      return {
        date: day, pv, uv,
        newUv, returningUv: Math.max(0, uv - newUv),
        sessions: Number(sessCount || 0),
        signups: Number(signHash?.n || 0),
        dev: { m: Number(devHash?.m || 0), d: Number(devHash?.d || 0) },
        _pvHash: pvHash || {},
      };
    }));

    // 기간 합산 해시들
    const pathAgg = {}, refAgg = {}, utmAgg = {}, evAgg = {}, geoAgg = {}, osAgg = {}, brAgg = {};
    for (const d of perDay) mergeHash(pathAgg, d._pvHash);
    const [refH, utmH, evH, geoH, osH, brH] = await Promise.all([
      Promise.all(dayKeys.map(day => kv.hgetall(`di:mkt:ref:${day}`).catch(() => null))),
      Promise.all(dayKeys.map(day => kv.hgetall(`di:mkt:utm:${day}`).catch(() => null))),
      Promise.all(dayKeys.map(day => kv.hgetall(`di:mkt:ev:${day}`).catch(() => null))),
      Promise.all(dayKeys.map(day => kv.hgetall(`di:mkt:geo:${day}`).catch(() => null))),
      Promise.all(dayKeys.map(day => kv.hgetall(`di:mkt:os:${day}`).catch(() => null))),
      Promise.all(dayKeys.map(day => kv.hgetall(`di:mkt:browser:${day}`).catch(() => null))),
    ]);
    refH.forEach(h => mergeHash(refAgg, h));
    utmH.forEach(h => mergeHash(utmAgg, h));
    evH.forEach(h => mergeHash(evAgg, h));
    geoH.forEach(h => mergeHash(geoAgg, h));
    osH.forEach(h => mergeHash(osAgg, h));
    brH.forEach(h => mergeHash(brAgg, h));

    // 전환 퍼널 — 방문(uv합) → 가입시작 → 가입완료 → 봇활성 → 실거래
    const uvSum = perDay.reduce((a, d) => a + d.uv, 0);
    const funnel = [
      { step: "방문(고유)", n: uvSum },
      { step: "가입 시작", n: sumEv(evH, "signup_started") },
      { step: "가입 완료", n: sumEv(evH, "signup_completed") },
      { step: "봇 활성", n: sumEv(evH, "bot_activated") },
      { step: "실거래 시작", n: sumEv(evH, "real_trading_started") },
    ];

    // 실시간 활성 — 최근 6개 5분 버킷(=30분) vid union
    let realtimeActive = 0;
    try {
      const nowM = Math.floor((Date.now() + 9 * 3600000) / (5 * 60000));
      const keys = Array.from({ length: 6 }, (_, i) => `di:mkt:rt:${nowM - i}`);
      const u = await kv.sunion(...keys).catch(() => null);
      realtimeActive = Array.isArray(u) ? u.length : 0;
    } catch {}

    // 가입 유저수
    const userCount = await fetchUserCount(kv);
    const users = {
      total: userCount.total,
      source: userCount.source,
      error: userCount.error || null,
      today: perDay[perDay.length - 1]?.signups || 0,
      last7: perDay.slice(-7).reduce((a, d) => a + d.signups, 0),
    };

    const totals = {
      pv: perDay.reduce((a, d) => a + d.pv, 0),
      uvSum,
      newUv: perDay.reduce((a, d) => a + d.newUv, 0),
      sessions: perDay.reduce((a, d) => a + d.sessions, 0),
      signups: perDay.reduce((a, d) => a + d.signups, 0),
      m: perDay.reduce((a, d) => a + d.dev.m, 0),
      d: perDay.reduce((a, d) => a + d.dev.d, 0),
    };

    return res.status(200).json({
      ok: true,
      rangeDays: days,
      days: perDay.map(({ _pvHash, ...rest }) => rest),
      topPaths: topN(pathAgg, 20),
      refs: topN(refAgg, 12),
      utm: topN(utmAgg, 10),
      events: topN(evAgg, 24),
      geo: topN(geoAgg, 10),
      os: topN(osAgg, 8),
      browser: topN(brAgg, 8),
      funnel,
      realtimeActive,
      users,
      totals,
      generatedAt: new Date().toISOString(),
    });
  } catch (e) {
    return res.status(200).json({ ok: false, error: e?.message || String(e) });
  }
}
