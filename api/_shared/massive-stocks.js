// ════════════════════════════════════════════════════════════════════
// massive-stocks — Massive.com 주식 시세 클라이언트 (Polygon 호환 REST)
//
// ★ 2026-06-15 (대표 지시 A): 주식 데이터 소스를 Yahoo → Massive 로 업그레이드.
//   기관급(Massive.com) OHLC. Yahoo 보다 정확/안정. 키 없거나 실패 시 호출부가
//   Yahoo 로 폴백하도록 *항상 null 안전*하게 동작(throw 안 함).
//
// 인증: Authorization: Bearer <MASSIVE_API_KEY>  (env)
// 베이스: https://api.massive.com  (env MASSIVE_API_BASE 로 override 가능)
// 히스토리(범위 집계): GET /v2/aggs/ticker/{T}/range/{mult}/{span}/{fromMs}/{toMs}
//   응답: { results: [{ o,h,l,c,v,t(ms),vw,n }], status, resultsCount }
// ════════════════════════════════════════════════════════════════════

const DEFAULT_BASE = "https://api.massive.com";
const DAY_MS = 24 * 60 * 60 * 1000;

/** Massive 사용 가능 여부 (env 키 존재). 호출부가 폴백 분기에 사용. */
export function massiveEnabled() {
  return !!(process.env.MASSIVE_API_KEY && String(process.env.MASSIVE_API_KEY).trim());
}

function base() {
  const b = (process.env.MASSIVE_API_BASE || DEFAULT_BASE).trim();
  return b.replace(/\/+$/, "");
}

/** 공통 GET — Bearer 인증, 타임아웃, 실패 시 null (throw 안 함). */
async function massiveGet(path, { timeoutMs = 8000 } = {}) {
  const key = process.env.MASSIVE_API_KEY;
  if (!key) return null;
  try {
    const r = await fetch(`${base()}${path}`, {
      headers: { Authorization: `Bearer ${String(key).trim()}`, Accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!r.ok) {
      console.warn(`[massive] ${path} → HTTP ${r.status}`);
      return null;
    }
    return await r.json();
  } catch (e) {
    console.warn(`[massive] ${path} 실패: ${e?.message}`);
    return null;
  }
}

/**
 * 일봉 범위 집계 — 최근 N일.
 * @returns {Array<{o,h,l,c,v,t}>|null} results 배열(시간 오름차순) 또는 null(실패→폴백 신호)
 */
export async function getDailyAggsRaw(ticker, { days = 365, adjusted = true } = {}) {
  if (!ticker || !massiveEnabled()) return null;
  const now = Date.now();
  const fromMs = now - Math.max(1, days) * DAY_MS;
  const sym = encodeURIComponent(String(ticker).toUpperCase());
  const q = `adjusted=${adjusted ? "true" : "false"}&sort=asc&limit=50000`;
  const json = await massiveGet(`/v2/aggs/ticker/${sym}/range/1/day/${fromMs}/${now}?${q}`);
  const results = json?.results;
  if (!Array.isArray(results) || results.length === 0) return null;
  return results;
}

/** Massive results → yahoo.js parseCandles 호환 캔들 객체 배열 (time=초 단위). */
export function aggsToCandles(results) {
  if (!Array.isArray(results)) return null;
  const candles = [];
  for (const r of results) {
    if (r == null || r.o == null || r.c == null) continue;
    const o = Number(r.o), c = Number(r.c);
    const h = Number(r.h), l = Number(r.l);
    if (![o, c].every(Number.isFinite)) continue;
    candles.push({
      time: Math.floor(Number(r.t) / 1000), // ms → s (Yahoo 캔들과 동일 단위)
      open: +o.toFixed(4),
      high: +(Number.isFinite(h) ? h : Math.max(o, c)).toFixed(4),
      low: +(Number.isFinite(l) ? l : Math.min(o, c)).toFixed(4),
      close: +c.toFixed(4),
      volume: Number(r.v) || 0,
    });
  }
  return candles.length ? candles : null;
}

/** Massive results → stock-cron fetchYahooFinanceData 호환 배열 형태 (time=초). */
export function aggsToArrays(results) {
  if (!Array.isArray(results)) return null;
  const timestamp = [], open = [], high = [], low = [], close = [], volume = [];
  for (const r of results) {
    if (r == null || r.o == null || r.c == null) continue;
    const o = Number(r.o), c = Number(r.c);
    if (![o, c].every(Number.isFinite)) continue;
    timestamp.push(Math.floor(Number(r.t) / 1000));
    open.push(o);
    high.push(Number.isFinite(Number(r.h)) ? Number(r.h) : Math.max(o, c));
    low.push(Number.isFinite(Number(r.l)) ? Number(r.l) : Math.min(o, c));
    close.push(c);
    volume.push(Number(r.v) || 0);
  }
  return close.length ? { timestamp, open, high, low, close, volume } : null;
}

/** 편의: 일봉 캔들 객체 배열 (yahoo.js ohlc 모드용). 실패 시 null → 호출부 Yahoo 폴백. */
export async function getDailyCandles(ticker, { days = 365 } = {}) {
  const results = await getDailyAggsRaw(ticker, { days });
  return aggsToCandles(results);
}

/** 편의: 일봉 배열 형태 (stock-cron 용). 실패 시 null → 호출부 Yahoo 폴백. */
export async function getDailyArrays(ticker, { days = 365 } = {}) {
  const results = await getDailyAggsRaw(ticker, { days });
  return aggsToArrays(results);
}

export default { massiveEnabled, getDailyAggsRaw, aggsToCandles, aggsToArrays, getDailyCandles, getDailyArrays };
