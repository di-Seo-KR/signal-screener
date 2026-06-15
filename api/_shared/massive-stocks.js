// ════════════════════════════════════════════════════════════════════
// massive-stocks — Massive.com 주식 시세 클라이언트 (Polygon 호환 REST)
//
// ★ 2026-06-15 (대표 지시 A): 주식 데이터 소스를 Yahoo → Massive 로 업그레이드.
//   기관급(Massive.com) OHLC. 키 없거나 실패 시 호출부가 Yahoo 로 폴백하도록
//   *항상 null 안전*하게 동작(throw 안 함).
//
// ★ 적대 리뷰(2026-06-15, 37에이전트) 반영 하드닝:
//   ① 타임스탬프 ms/s sanity — 최신 봉이 그럴듯한 범위 아니면 null(41년 어긋난 데이터 차단).
//   ② KV 캐시(기본 30분) + 일일 호출 cap — Massive 비용 폭증 방지(stock-cron 80→~10콜/일).
//   ③ 진단 로깅 — 응답 status/keys 출력해 배포 후 계약(베이스/Bearer/필드명) 검증 가능.
//
// 인증: Authorization: Bearer <MASSIVE_API_KEY>  (env)
// 베이스: https://api.massive.com  (env MASSIVE_API_BASE override 가능)
// 히스토리: GET /v2/aggs/ticker/{T}/range/1/day/{fromMs}/{toMs}
//   응답: { results: [{ o,h,l,c,v,t(ms),vw,n }], status, resultsCount }
// ════════════════════════════════════════════════════════════════════

const DEFAULT_BASE = "https://api.massive.com";
const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_PLAUSIBLE_SEC = 1262304000; // 2010-01-01 — 이보다 과거면 ms/s 오판 의심

/** Massive 사용 가능 여부 (env 키 존재). 호출부가 폴백 분기에 사용. */
export function massiveEnabled() {
  return !!(process.env.MASSIVE_API_KEY && String(process.env.MASSIVE_API_KEY).trim());
}

function base() {
  return (process.env.MASSIVE_API_BASE || DEFAULT_BASE).trim().replace(/\/+$/, "");
}

function cacheTtlSec() {
  const t = Number(process.env.MASSIVE_CACHE_TTL_SEC);
  return Number.isFinite(t) && t > 0 ? t : 1800; // 기본 30분 (일봉이라 intraday 갱신 불필요)
}

async function getKvSafe() {
  try { return (await import("@vercel/kv")).kv; } catch { return null; }
}

/** 일일 호출 cap — 비용 안전장치. KV 실패 시 막지 않음(가용성 우선). */
async function underDailyCap(kv) {
  if (!kv) return true;
  try {
    const cap = Number(process.env.MASSIVE_DAILY_CALL_CAP) || 1000;
    const day = new Date().toISOString().slice(0, 10);
    const key = `di:massive:calls:${day}`;
    const n = await kv.incr(key);
    if (n === 1) { try { await kv.expire(key, 172800); } catch {} } // 2일 후 만료
    return n <= cap;
  } catch { return true; }
}

/** 최신 일봉 타임스탬프(초)가 그럴듯한지 — ms/s 오판/스테일 데이터 차단. */
function timePlausibleSec(sec) {
  const nowSec = Date.now() / 1000;
  return Number.isFinite(sec) && sec > MIN_PLAUSIBLE_SEC && sec < nowSec + 3 * 86400;
}

/** 공통 GET — Bearer 인증, 타임아웃, 실패 시 null (throw 안 함). status 로깅. */
async function massiveGet(path, { timeoutMs = 8000 } = {}) {
  const key = process.env.MASSIVE_API_KEY;
  if (!key) return null;
  try {
    const r = await fetch(`${base()}${path}`, {
      headers: { Authorization: `Bearer ${String(key).trim()}`, Accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!r.ok) {
      console.warn(`[massive] HTTP ${r.status} ${r.statusText || ""} (인증/계약 확인 필요)`);
      return null;
    }
    return await r.json();
  } catch (e) {
    if (e?.name === "AbortError" || e?.name === "TimeoutError") console.warn(`[massive] timeout ${timeoutMs}ms`);
    else console.warn(`[massive] fetch 실패: ${e?.message}`);
    return null; // 키는 헤더에만 — 로그/URL 에 노출 안 됨
  }
}

/**
 * 일봉 범위 집계 — 최근 N일. KV 캐시 + 일일 cap + 타임스탬프 sanity 적용.
 * @returns {Array<{o,h,l,c,v,t}>|null} results(시간 오름차순) 또는 null(실패→폴백 신호)
 */
export async function getDailyAggsRaw(ticker, { days = 365 } = {}) {
  if (!ticker || !massiveEnabled()) return null;
  const sym = String(ticker).toUpperCase();
  const kv = await getKvSafe();
  const cacheKey = `di:massive:aggs:${sym}:${days}`;

  // ① 캐시 히트 — 비용/지연 절감 (일봉은 intraday 불변에 가까움)
  if (kv) {
    try { const c = await kv.get(cacheKey); if (Array.isArray(c) && c.length) return c; } catch {}
  }
  // ② 일일 호출 cap (실제 API 콜 직전)
  if (!(await underDailyCap(kv))) {
    console.warn(`[massive] daily call cap 도달 — ${sym} yahoo 폴백`);
    return null;
  }
  // ③ API
  const now = Date.now();
  const fromMs = now - Math.max(1, days) * DAY_MS;
  const json = await massiveGet(`/v2/aggs/ticker/${encodeURIComponent(sym)}/range/1/day/${fromMs}/${now}?adjusted=true&sort=asc&limit=50000`);
  if (!json) return null;
  const results = json.results;
  if (!Array.isArray(results) || results.length === 0) {
    console.warn(`[massive] ${sym} results 없음 — 응답 keys: [${Object.keys(json).join(",")}] (필드명/계약 확인)`);
    return null;
  }
  // ④ 타임스탬프 sanity — 최신 봉이 그럴듯해야 함 (ms/s 오판이면 41년 어긋나 탈락→yahoo)
  const newestSec = Math.floor(Number(results[results.length - 1]?.t) / 1000);
  if (!timePlausibleSec(newestSec)) {
    console.warn(`[massive] ${sym} 타임스탬프 비정상(newest=${newestSec}s) — ms/s 오판 의심 → yahoo 폴백`);
    return null;
  }
  if (results.length >= 49999) console.warn(`[massive] ${sym} results ${results.length} (limit 근접 — truncation 의심)`);
  // ⑤ 캐시 저장
  if (kv) { try { await kv.set(cacheKey, results, { ex: cacheTtlSec() }); } catch {} }
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

// 아래 두 편의함수는 절대 throw 안 함 — 모든 실패 경로에서 null 반환(호출부 Yahoo 폴백).
/** 일봉 캔들 객체 배열 (yahoo.js ohlc 모드용). 실패 시 null. */
export async function getDailyCandles(ticker, { days = 365 } = {}) {
  return aggsToCandles(await getDailyAggsRaw(ticker, { days }));
}

/** 일봉 배열 형태 (stock-cron 용). 실패 시 null. */
export async function getDailyArrays(ticker, { days = 365 } = {}) {
  return aggsToArrays(await getDailyAggsRaw(ticker, { days }));
}

export default { massiveEnabled, getDailyAggsRaw, aggsToCandles, aggsToArrays, getDailyCandles, getDailyArrays };
