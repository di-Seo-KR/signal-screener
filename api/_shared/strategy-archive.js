// api/_shared/strategy-archive.js
//
// 목적:
//  현재 저장소는 전략/봇의 성과가 "5일 rolling window" 로만 남는다.
//  실전매매를 위해서는 장기간의 영구 히스토리가 필요하다.
//  이 모듈은 매일 한 번 (혹은 원하는 주기로) bot perf / quant-research 결과를
//  "append-only" 형식으로 KV 에 저장하는 헬퍼다.
//
// 키 스키마:
//  di:archive:bots:YYYY-MM-DD       → 그 날의 모든 봇 snapshot 배열
//  di:archive:bots:index            → ["2026-04-09", "2026-04-08", ...] (최근 365일)
//  di:archive:quant:YYYY-MM-DD      → 그 날의 quant-research 결과 (topSharpe, stratRank 등)
//  di:archive:quant:index
//
// 읽기 헬퍼:
//  getBotHistory(botId, n)          → 최근 n일간의 특정 봇 스냅샷
//  getStrategyRanking(n)            → 최근 n일간 누적 전략 랭킹

const MAX_INDEX = 365;

async function getKv() {
  const mod = await import("@vercel/kv");
  return mod.kv;
}

function dayKey(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

async function pushIndex(kv, indexKey, day) {
  const idx = (await kv.get(indexKey)) || [];
  if (idx[0] === day) return idx;
  idx.unshift(day);
  const trimmed = idx.slice(0, MAX_INDEX);
  await kv.set(indexKey, trimmed);
  return trimmed;
}

/**
 * 전 봇의 현재 snapshot 을 하루짜리 스냅샷으로 아카이브.
 * @param {string[]} botIds
 */
export async function archiveDailyBotSnapshots(botIds) {
  const kv = await getKv();
  const day = dayKey();
  const out = [];
  for (const botId of botIds) {
    const [perf, snap] = await Promise.all([
      kv.get(`di:bot:${botId}:perf`),
      kv.get(`di:bot:${botId}:snapshot`),
    ]);
    if (!perf && !snap) continue;

    // perf 에서 최근 10 트레이드만 추출 (용량 절약)
    const recentTrades =
      perf && Array.isArray(perf.trades) ? perf.trades.slice(0, 10) : [];

    out.push({
      botId,
      realizedPL: perf?.realizedPL ?? 0,
      totalTrades: perf?.trades?.length ?? 0,
      recentTrades,
      equity: snap?.botEquity ?? null,
      dd: snap?.dd ?? null,
      mdd: snap?.mdd ?? null,
      positionCount: snap?.positionCount ?? 0,
      lastUpdated: snap?.lastUpdated ?? null,
    });
  }

  await kv.set(`di:archive:bots:${day}`, out);
  await pushIndex(kv, "di:archive:bots:index", day);
  return { day, count: out.length };
}

/**
 * Quant-research 결과 (topSharpe, stratRank, bestBySymbol 등) 를 저장.
 * @param {object} payload
 */
export async function archiveQuantResearch(payload) {
  const kv = await getKv();
  const day = dayKey();
  await kv.set(`di:archive:quant:${day}`, {
    ...payload,
    archivedAt: new Date().toISOString(),
  });
  await pushIndex(kv, "di:archive:quant:index", day);
  return { day };
}

/**
 * 최근 n일 봇 히스토리.
 */
export async function getBotHistory(botId, n = 30) {
  const kv = await getKv();
  const idx = (await kv.get("di:archive:bots:index")) || [];
  const days = idx.slice(0, n);
  const out = [];
  for (const d of days) {
    const arr = (await kv.get(`di:archive:bots:${d}`)) || [];
    const row = arr.find((r) => r.botId === botId);
    if (row) out.push({ day: d, ...row });
  }
  return out;
}

/**
 * 최근 n일 quant 스냅샷의 "stratRank" 을 누적해서 평균 sharpe 기준 전략 랭킹을 낸다.
 * 빈 데이터면 [] 리턴.
 */
export async function getStrategyRanking(n = 14) {
  const kv = await getKv();
  const idx = (await kv.get("di:archive:quant:index")) || [];
  const days = idx.slice(0, n);
  if (!days.length) return [];
  const agg = {};
  for (const d of days) {
    const q = await kv.get(`di:archive:quant:${d}`);
    if (!q || !Array.isArray(q.stratRank)) continue;
    for (const s of q.stratRank) {
      if (!agg[s.name]) agg[s.name] = { name: s.name, sharpes: [], returns: [], winRates: [] };
      if (Number.isFinite(s.avgSharpe)) agg[s.name].sharpes.push(s.avgSharpe);
      if (Number.isFinite(s.avgReturn)) agg[s.name].returns.push(s.avgReturn);
      if (Number.isFinite(s.avgWinRate)) agg[s.name].winRates.push(s.avgWinRate);
    }
  }
  const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const ranked = Object.values(agg)
    .map((g) => ({
      name: g.name,
      meanSharpe: mean(g.sharpes),
      meanReturn: mean(g.returns),
      meanWinRate: mean(g.winRates),
      samples: g.sharpes.length,
    }))
    .sort((a, b) => b.meanSharpe - a.meanSharpe);
  return ranked;
}

// ════════════════════════════════════════════════════════════════════
// 알파 수명주기 이벤트 로그 (append-only) — 2026-06-12 전수조사
// ──────────────────────────────────────────────────────────────────
// 승급(promote)/주입(inject)/제거(revoke)/재검증(refresh) 이벤트를 영구 보관.
// 기존엔 cron JSON + 텔레그램으로만 휘발 → 사후 추적·회귀감지·UI 타임라인 근거 소실.
// best-effort: 실패해도 호출측(발굴/승급 파이프라인)에 절대 영향 없음(throw 안 함).
// 실거래 주문·자금·게이트 미접촉 — 알파 메타데이터 read/write 만.
// ════════════════════════════════════════════════════════════════════
const ALPHA_EVENTS_KEY = "di:alpha:events";
const MAX_ALPHA_EVENTS = 200;

/**
 * @param {{type:string, family?:string, reason?:string, sharpe?:number, oosSharpe?:number,
 *          symbolsValidated?:number, symbol?:string, from?:*, to?:*}} evt
 */
export async function archiveAlphaLifecycleEvent(evt = {}) {
  try {
    const kv = await getKv();
    const list = (await kv.get(ALPHA_EVENTS_KEY)) || [];
    const arr = Array.isArray(list) ? list : [];
    arr.unshift({
      ts: new Date().toISOString(),
      type: String(evt.type || "event").slice(0, 24),
      family: evt.family ? String(evt.family).slice(0, 40) : null,
      reason: evt.reason ? String(evt.reason).slice(0, 200) : null,
      sharpe: Number.isFinite(evt.sharpe) ? Number(evt.sharpe) : null,
      oosSharpe: Number.isFinite(evt.oosSharpe) ? Number(evt.oosSharpe) : null,
      symbolsValidated: Number.isFinite(evt.symbolsValidated) ? evt.symbolsValidated : null,
      symbol: evt.symbol ? String(evt.symbol).slice(0, 20) : null,
      from: evt.from ?? null,
      to: evt.to ?? null,
    });
    await kv.set(ALPHA_EVENTS_KEY, arr.slice(0, MAX_ALPHA_EVENTS));
    return true;
  } catch (e) {
    console.error("[strategy-archive] archiveAlphaLifecycleEvent 실패:", e?.message);
    return false;
  }
}

/** 최근 n개 알파 수명주기 이벤트 (newest first). */
export async function getAlphaLifecycleEvents(n = 30) {
  try {
    const kv = await getKv();
    const list = (await kv.get(ALPHA_EVENTS_KEY)) || [];
    if (!Array.isArray(list)) return [];
    return list.slice(0, Math.max(1, Math.min(n, MAX_ALPHA_EVENTS)));
  } catch {
    return [];
  }
}

export default {
  archiveDailyBotSnapshots,
  archiveQuantResearch,
  getBotHistory,
  getStrategyRanking,
  archiveAlphaLifecycleEvent,
  getAlphaLifecycleEvents,
};
