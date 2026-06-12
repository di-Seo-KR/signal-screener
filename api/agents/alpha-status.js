// ════════════════════════════════════════════════════════════════════
// Zepta — Alpha Lab Status (UI 조회 전용)
// ────────────────────────────────────────────────────────────────────
// AlphaLab 페이지가 호출하는 통합 read-only API.
// alpha-lab cron 결과(KV)를 한 번에 묶어서 반환.
//
//   GET /api/agents/alpha-status
//   →  leaderboard, candidates, weights, statuses, hist
//
// 이걸 별도로 두는 이유: 단일 React 페이지에서 KV 4~5개 키를 직접 조회하면
// network round trip 4~5번. 백엔드 1번 호출로 통합.
// ════════════════════════════════════════════════════════════════════

import { DEFAULT_STRATEGY_WEIGHTS } from "../_shared/dynamic-config.js";

async function getKv() {
  return (await import("@vercel/kv")).kv;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  // ★ 2026-06-12 성능: 전역 read-only 집계 — no-store → CDN 캐시 (coin-scores 패턴)
  res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
  try {
    const kv = await getKv();
    const strategyIds = Object.keys(DEFAULT_STRATEGY_WEIGHTS);

    const [leaderboard, hist, candidates, weights, regime, ...statusPairs] = await Promise.all([
      kv.get("di:alpha:leaderboard"),
      kv.get("di:alpha:leaderboard:hist"),
      kv.get("di:alpha:strategy-candidates"),
      kv.get("di:alpha:strategy-weights"),
      kv.get("di:market:regime"),  // ★ 2026-06-03: 마켓 레짐 노출(이전엔 누락 → AlphaLab 레짐 패널 빈 값)
      ...strategyIds.map((id) => kv.get(`di:alpha:strategy-status:${id}`).then((v) => ({ id, status: v }))),
      ...strategyIds.map((id) => kv.get(`di:alpha:params:${id}`).then((v) => ({ id, params: v }))),
    ]);

    // statusPairs 앞 절반은 status, 뒤 절반은 params
    const half = strategyIds.length;
    const statuses = {};
    const params = {};
    statusPairs.slice(0, half).forEach((p) => { statuses[p.id] = p.status; });
    statusPairs.slice(half).forEach((p) => { params[p.id] = p.params; });

    // ★ 2026-06-12 (전수조사): 알파 수명주기 이벤트 — 승급/주입/제거 이력 타임라인 근거.
    let events = [];
    try { const ev = await kv.get("di:alpha:events"); events = Array.isArray(ev) ? ev.slice(0, 30) : []; } catch {}

    return res.status(200).json({
      ok: true,
      generatedAt: leaderboard?.generatedAt || null,
      leaderboard: leaderboard || null,
      historySnapshots: Array.isArray(hist) ? hist.length : 0,
      historyTail: Array.isArray(hist) ? hist.slice(-24) : [], // 최근 24시간만 UI 차트
      candidates: Array.isArray(candidates) ? candidates : [],
      weights: weights || null,
      regime: regime || null,  // ★ { regime: "trending"|"mean_reverting"|"transitional", avgHurst, avgER, ... }
      statuses,
      params,
      events,  // 알파 수명주기 이벤트(최근 30, newest first)
    });
  } catch (err) {
    console.error("[alpha-status] fatal:", err);
    return res.status(200).json({ ok: false, error: err?.message || String(err) });
  }
}
