// ════════════════════════════════════════════════════════════════════
// Zepta — Leaderboard Read API
// ────────────────────────────────────────────────────────────────────
// GET /api/leaderboard
//   ?type=overall|by-bot|by-asset    (기본 overall)
//   &botKind=all|crypto|stock        (필터, 기본 all)
//   &botId=<id>                      (type=by-bot 일 때)
//   &assetKind=all|crypto|stock      (assetKind alias)
//   &period=7|30|90                  (기본 30 — 현재는 30 만 cron 적재됨)
//   &sort=return|sharpe|winrate      (기본 return)
//   &limit=10|50|100                 (기본 50, max 200)
//   &userHash=<8hex>                 (본인 봇 highlight 용. 응답에는 영향 없음)
//
// 응답:
//   { ok, generatedAt, total, entries: [...] }
//
// 비고:
//   - period 가 30 이 아니면 entries 의 returnPct 는 변환되지 않음 (cron 이
//     단일 기간만 생성). UI 가 "30일 기준" 안내문 표시.
//   - KV 가 비어 있으면 빈 entries[] + ok:true 반환 (mock data 제거).
// ════════════════════════════════════════════════════════════════════

async function getKv() {
  return (await import("@vercel/kv")).kv;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  // ★ 2026-06-12 성능: 전역 cron 산출물(di:leaderboard 단일 키) — no-store → CDN 캐시.
  //   userHash 는 서버 응답에 영향 없음(프론트가 클라이언트에서 강조 처리).
  res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
  try {
    const kv = await getKv();
    const q = req.query || {};
    const type = String(q.type || "overall");
    const botKind = String(q.botKind || q.assetKind || "all");
    const botId = q.botId ? String(q.botId) : null;
    const sort = String(q.sort || "return");
    const limit = Math.min(parseInt(q.limit) || 50, 200);
    const periodDays = parseInt(q.period) || 30;

    let payload;
    if (type === "by-bot" && botId) {
      payload = await kv.get(`di:leaderboard:bot:${botId}`);
    } else {
      payload = await kv.get("di:leaderboard");
    }

    if (!payload || !Array.isArray(payload.entries)) {
      return res.status(200).json({
        ok: true,
        generatedAt: null,
        periodDays,
        total: 0,
        userCount: 0,
        entries: [],
        empty: true,
        message: "리더보드 데이터가 아직 누적되지 않았습니다. cron 첫 실행 후 표시됩니다.",
      });
    }

    let entries = payload.entries.slice();

    // ── 필터 ──
    if (botKind !== "all") {
      entries = entries.filter((e) => e.botKind === botKind);
    }
    if (type === "overall" && botId) {
      entries = entries.filter((e) => e.botId === botId);
    }

    // ── 정렬 ──
    const sortFn = {
      return:  (a, b) => b.returnPct - a.returnPct,
      sharpe:  (a, b) => b.sharpe - a.sharpe,
      winrate: (a, b) => b.winRate - a.winRate,
    }[sort] || ((a, b) => b.returnPct - a.returnPct);
    entries.sort(sortFn);

    // ── 절단 ──
    const total = entries.length;
    entries = entries.slice(0, limit);

    return res.status(200).json({
      ok: true,
      generatedAt: payload.generatedAt || null,
      periodDays: payload.periodDays || periodDays,
      userCount: payload.userCount || 0,
      total,
      entries,
      filters: { type, botKind, botId, sort, limit },
    });
  } catch (err) {
    console.error("[leaderboard-read] fatal:", err);
    return res.status(200).json({ ok: false, error: err?.message || String(err), entries: [] });
  }
}
