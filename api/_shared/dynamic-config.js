// ════════════════════════════════════════════════════════════════════
// Zepta — Dynamic Config (KV Hot-Reload)
// ────────────────────────────────────────────────────────────────────
// 24/7 알파 추적 시스템의 "구조 ↔ 데이터 분리" 핵심 헬퍼.
//
// strategy 본체 코드는 그대로 두고, 다음 3가지를 KV 에서 hot-reload:
//   1) strategy 별 파라미터 (RSI 임계값, ATR 배수, EMA 기간 등)
//      → param-tuner cron 이 grid search 로 6시간마다 최적화 후 KV 에 적재
//   2) strategy family 가중치
//      → strategy-router 가 시장 레짐별로 동적 산출
//   3) strategy 활성/비활성 상태 (active / watch / disabled)
//      → auto-promote cron 이 leaderboard 기반으로 매일 결정
//
// 캐싱: 모듈 레벨 60초 TTL. cron 5분 주기에 비해 1/5 수준이라 충분.
// fail-safe: KV read 실패 시 default 값으로 즉시 fallback (절대 throw 안 함).
//
// KV 키 스키마:
//   di:alpha:params:<strategyId>     → { params: {...}, version, updatedAt }
//   di:alpha:strategy-weights        → { weights: {...}, regime, updatedAt }
//   di:alpha:strategy-status:<id>    → { status, reason, updatedAt }
// ════════════════════════════════════════════════════════════════════

const CACHE_TTL_MS = 60_000; // 60초
const _cache = new Map(); // key → { value, expireAt }

async function getKv() {
  try {
    const mod = await import("@vercel/kv");
    return mod.kv;
  } catch {
    return null;
  }
}

function cacheGet(key) {
  const hit = _cache.get(key);
  if (!hit) return undefined;
  if (Date.now() > hit.expireAt) {
    _cache.delete(key);
    return undefined;
  }
  return hit.value;
}

function cacheSet(key, value) {
  _cache.set(key, { value, expireAt: Date.now() + CACHE_TTL_MS });
}

/** 캐시 즉시 만료 (cron 이 KV 쓴 직후 호출하면 다음 read 가 신선) */
export function invalidateDynamicCache(prefix) {
  if (!prefix) {
    _cache.clear();
    return;
  }
  for (const k of _cache.keys()) {
    if (k.startsWith(prefix)) _cache.delete(k);
  }
}

// ────────────────────────────────────────────────────────────────────
// 1) Strategy 파라미터 — param-tuner 결과 hot-reload
// ────────────────────────────────────────────────────────────────────

// strategy 별 기본 파라미터. param-tuner 가 grid search 로 이걸 덮어씀.
// 값은 strategy 모듈의 하드코딩된 임계값과 동일하게 시작 (즉시 적용해도 동작 동일).
export const DEFAULT_STRATEGY_PARAMS = {
  "trend-follow": {
    EMA_FAST: 21, EMA_SLOW: 55, EMA_LONG: 200,
    ADX_MIN: 22, RSI_BULL: 55, RSI_BEAR: 45,
    MIN_ABS_NET: 2,
  },
  "mean-revert": {
    RSI_OVERSOLD: 30, RSI_OVERBOUGHT: 70,
    BB_PERIOD: 20, BB_MULT: 2.0,
    ADX_MAX: 28, HURST_MAX_FOR_REGIME: 0.6,
    MIN_ABS_NET: 2,
  },
  "breakout": {
    BREAKOUT_PERIOD: 20, VOL_MULT: 1.5,
    ATR_PERIOD: 14, MIN_ABS_NET: 2,
  },
  "momentum-rotation": {
    LOOKBACK_DAYS: 21, TOP_N: 3, MIN_ABS_NET: 2,
  },
  "volatility-arb": {
    ATR_PERIOD: 14, BB_PERIOD: 20, BB_SQUEEZE_THRESHOLD: 0.05,
    MIN_ABS_NET: 2,
  },
  "hurst-trend": {
    HURST_TREND_MIN: 0.55, HURST_REVERT_MAX: 0.45,
    RSI_BULL: 55, RSI_BEAR: 45, MIN_ABS_NET: 2,
  },
  "defi-momentum": {
    EMA_FAST: 13, EMA_SLOW: 34,
    OBV_LOOKBACK: 20, MIN_ABS_NET: 2,
  },
  "ensemble": {
    CONSENSUS_MIN: 2, // 최소 2개 sub-strategy 합의
    MIN_ABS_NET: 3,
  },
};

/**
 * strategy 의 현재 파라미터 (param-tuner 가 적재한 최적값 또는 default).
 * @param {string} strategyId
 * @returns {Promise<object>} 항상 객체 반환 (fail-safe)
 */
export async function getStrategyParams(strategyId) {
  if (!strategyId) return {};
  const cacheKey = `params:${strategyId}`;
  const cached = cacheGet(cacheKey);
  if (cached !== undefined) return cached;

  const defaults = DEFAULT_STRATEGY_PARAMS[strategyId] || {};
  try {
    const kv = await getKv();
    if (!kv) {
      cacheSet(cacheKey, defaults);
      return defaults;
    }
    const stored = await kv.get(`di:alpha:params:${strategyId}`);
    if (!stored || typeof stored !== "object" || !stored.params) {
      cacheSet(cacheKey, defaults);
      return defaults;
    }
    // 항상 default 와 머지 — KV 에 누락된 필드가 있어도 안전.
    const merged = { ...defaults, ...stored.params };
    cacheSet(cacheKey, merged);
    return merged;
  } catch (e) {
    console.warn(`[dynamic-config] getStrategyParams(${strategyId}) 실패:`, e?.message);
    cacheSet(cacheKey, defaults);
    return defaults;
  }
}

/**
 * 동기 버전 — 캐시에 있으면 즉시 반환, 없으면 default (네트워크 호출 안 함).
 * hot path (strategy 모듈 안) 에서 await 부담을 피하고 싶을 때 사용.
 */
export function getStrategyParamsSync(strategyId) {
  if (!strategyId) return {};
  const cacheKey = `params:${strategyId}`;
  const cached = cacheGet(cacheKey);
  if (cached !== undefined) return cached;
  return DEFAULT_STRATEGY_PARAMS[strategyId] || {};
}

// ────────────────────────────────────────────────────────────────────
// 2) Strategy 가중치 — 시장 레짐 기반 동적 가중치
// ────────────────────────────────────────────────────────────────────

export const DEFAULT_STRATEGY_WEIGHTS = {
  "trend-follow": 1.0, "mean-revert": 1.0, "breakout": 1.0,
  "momentum-rotation": 1.0, "volatility-arb": 1.0, "hurst-trend": 1.0,
  "defi-momentum": 1.0, "ensemble": 1.0,
};

/**
 * 현재 가중치 맵. strategy-router 가 매 분 시장 레짐 기반으로 적재함.
 * KV 우선 → cache → default.
 */
export async function getStrategyWeights() {
  const cacheKey = `weights:global`;
  const cached = cacheGet(cacheKey);
  if (cached !== undefined) return cached;

  try {
    const kv = await getKv();
    if (!kv) {
      cacheSet(cacheKey, DEFAULT_STRATEGY_WEIGHTS);
      return DEFAULT_STRATEGY_WEIGHTS;
    }
    const stored = await kv.get("di:alpha:strategy-weights");
    if (!stored || typeof stored !== "object" || !stored.weights) {
      cacheSet(cacheKey, DEFAULT_STRATEGY_WEIGHTS);
      return DEFAULT_STRATEGY_WEIGHTS;
    }
    const merged = { ...DEFAULT_STRATEGY_WEIGHTS, ...stored.weights };
    cacheSet(cacheKey, merged);
    return merged;
  } catch (e) {
    console.warn("[dynamic-config] getStrategyWeights 실패:", e?.message);
    cacheSet(cacheKey, DEFAULT_STRATEGY_WEIGHTS);
    return DEFAULT_STRATEGY_WEIGHTS;
  }
}

// ────────────────────────────────────────────────────────────────────
// 3) Strategy 상태 — active / watch / disabled
// ────────────────────────────────────────────────────────────────────

export const STRATEGY_STATUS = {
  ACTIVE: "active",     // production 정식 운영
  WATCH: "watch",       // 조심스럽게 — 절반 가중치
  DISABLED: "disabled", // 실거래 차단, shadow 만 운영
};

/**
 * strategy 의 현재 상태.
 * 미설정이면 "active" — 처음 등장한 strategy 는 일단 가동, 데이터 쌓이면 조정.
 */
export async function getStrategyStatus(strategyId) {
  if (!strategyId) return STRATEGY_STATUS.ACTIVE;
  const cacheKey = `status:${strategyId}`;
  const cached = cacheGet(cacheKey);
  if (cached !== undefined) return cached;

  try {
    const kv = await getKv();
    if (!kv) {
      cacheSet(cacheKey, STRATEGY_STATUS.ACTIVE);
      return STRATEGY_STATUS.ACTIVE;
    }
    const stored = await kv.get(`di:alpha:strategy-status:${strategyId}`);
    if (!stored || !stored.status) {
      cacheSet(cacheKey, STRATEGY_STATUS.ACTIVE);
      return STRATEGY_STATUS.ACTIVE;
    }
    cacheSet(cacheKey, stored.status);
    return stored.status;
  } catch (e) {
    console.warn(`[dynamic-config] getStrategyStatus(${strategyId}) 실패:`, e?.message);
    cacheSet(cacheKey, STRATEGY_STATUS.ACTIVE);
    return STRATEGY_STATUS.ACTIVE;
  }
}

/**
 * 모든 strategy 의 상태 한 번에 조회 (UI / leaderboard 용).
 */
export async function getAllStrategyStatuses() {
  const ids = Object.keys(DEFAULT_STRATEGY_WEIGHTS);
  const out = {};
  await Promise.all(
    ids.map(async (id) => {
      out[id] = await getStrategyStatus(id);
    })
  );
  return out;
}

// ────────────────────────────────────────────────────────────────────
// KV writer 헬퍼 (cron 이 사용)
// ────────────────────────────────────────────────────────────────────

/** param-tuner 가 grid search 후 호출. */
export async function setStrategyParams(strategyId, params, meta = {}) {
  try {
    const kv = await getKv();
    if (!kv) return false;
    const payload = {
      params,
      version: (meta.version || 1),
      sharpe: meta.sharpe ?? null,
      trades: meta.trades ?? null,
      tunedAt: new Date().toISOString(),
    };
    await kv.set(`di:alpha:params:${strategyId}`, payload);
    invalidateDynamicCache(`params:${strategyId}`);
    return true;
  } catch (e) {
    console.error(`[dynamic-config] setStrategyParams(${strategyId}) 실패:`, e?.message);
    return false;
  }
}

/** strategy-router 가 시장 레짐 변화 감지하면 호출. */
export async function setStrategyWeights(weights, meta = {}) {
  try {
    const kv = await getKv();
    if (!kv) return false;
    const payload = {
      weights,
      regime: meta.regime || "unknown",
      hurst: meta.hurst ?? null,
      atrRatio: meta.atrRatio ?? null,
      updatedAt: new Date().toISOString(),
    };
    await kv.set("di:alpha:strategy-weights", payload);
    invalidateDynamicCache("weights:");
    return true;
  } catch (e) {
    console.error("[dynamic-config] setStrategyWeights 실패:", e?.message);
    return false;
  }
}

/** auto-promote 가 일일 leaderboard 분석 후 호출. */
export async function setStrategyStatus(strategyId, status, reason = "") {
  if (!Object.values(STRATEGY_STATUS).includes(status)) {
    console.warn(`[dynamic-config] 잘못된 status: ${status}`);
    return false;
  }
  try {
    const kv = await getKv();
    if (!kv) return false;
    const prev = await kv.get(`di:alpha:strategy-status:${strategyId}`);
    const payload = {
      status,
      reason,
      previousStatus: prev?.status || null,
      updatedAt: new Date().toISOString(),
    };
    await kv.set(`di:alpha:strategy-status:${strategyId}`, payload);
    invalidateDynamicCache(`status:${strategyId}`);
    return { changed: prev?.status !== status, prev: prev?.status, next: status };
  } catch (e) {
    console.error(`[dynamic-config] setStrategyStatus(${strategyId}) 실패:`, e?.message);
    return false;
  }
}

export default {
  DEFAULT_STRATEGY_PARAMS,
  DEFAULT_STRATEGY_WEIGHTS,
  STRATEGY_STATUS,
  getStrategyParams,
  getStrategyParamsSync,
  getStrategyWeights,
  getStrategyStatus,
  getAllStrategyStatuses,
  setStrategyParams,
  setStrategyWeights,
  setStrategyStatus,
  invalidateDynamicCache,
};
