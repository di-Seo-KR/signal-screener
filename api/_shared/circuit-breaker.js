// api/_shared/circuit-breaker.js
//
// 실전매매 안전장치. KV 기반으로 일/주 손익, 최대낙폭, 연속손실을 감시한다.
// 조건 위반 시 실전매매 엔진이 자동으로 해당 유저를 halt 시키도록 flag 를 돌려준다.
//
// 키 스키마:
//  di:real:user:<uid>:breaker   → { equityHigh, dayStartEquity, weekStartEquity,
//                                    dayKey, weekKey, consecLosses, lastLossAt,
//                                    halted, haltedReason, haltedAt, cooldownUntil }
//  di:real:user:<uid>:killswitch → boolean (true=disabled, false=enabled)
//                                   ※ 기본값은 "true" (디폴트 OFF = 실거래 금지)
//
// 이 모듈은 "판단만" 한다 — 실제 halt 는 엔진이 flag 를 읽고 스킵.

const BREAKER_LIMITS = {
  // Phase 1 ($100 기준) — 손익 퍼센트 한도
  dailyLossPct: 0.04,   // 하루 -4% 넘으면 halt ($100 기준 -$4)
  weeklyLossPct: 0.08,  // 주간 -8%
  mddPct: 0.15,         // MDD -15%
  consecLossThreshold: 5, // 연속 손실 5회 → 24h cooldown
  cooldownMs: 24 * 60 * 60 * 1000,
};

function dayKey(d = new Date()) {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}
function weekKey(d = new Date()) {
  // ISO week (대충): 연+주차
  const onejan = new Date(d.getFullYear(), 0, 1);
  const week = Math.ceil((((d - onejan) / 86400000) + onejan.getDay() + 1) / 7);
  return `${d.getFullYear()}-W${week}`;
}

async function getKv() {
  const mod = await import("@vercel/kv");
  return mod.kv;
}

export async function getBreakerState(userId) {
  const kv = await getKv();
  const state = (await kv.get(`di:real:user:${userId}:breaker`)) || {};
  return state;
}

export async function isKillSwitchEnabled(userId) {
  const kv = await getKv();
  // 기본값 true = 거래 금지. 유저가 명시적으로 false 로 바꿔야 실거래 가능.
  const v = await kv.get(`di:real:user:${userId}:killswitch`);
  if (v === null || v === undefined) return true; // default ON (disabled)
  return !!v;
}

export async function setKillSwitch(userId, disabled) {
  const kv = await getKv();
  await kv.set(`di:real:user:${userId}:killswitch`, !!disabled);
  return !!disabled;
}

/**
 * 트레이드 전 호출. 실거래 허용 여부와 사유 리턴.
 * @param {string} userId
 * @param {number} currentEquity
 * @returns {Promise<{ allowed: boolean, reason?: string, state: object }>}
 */
export async function preTradeCheck(userId, currentEquity) {
  const kv = await getKv();

  // 1) 킬스위치
  const killed = await isKillSwitchEnabled(userId);
  if (killed) {
    return { allowed: false, reason: "killswitch is ON (default)", state: {} };
  }

  const key = `di:real:user:${userId}:breaker`;
  const state = (await kv.get(key)) || {};
  const now = Date.now();

  // 2) cooldown 중인지
  if (state.cooldownUntil && now < state.cooldownUntil) {
    return {
      allowed: false,
      reason: `cooldown until ${new Date(state.cooldownUntil).toISOString()}`,
      state,
    };
  }

  // 3) 수동 halt
  if (state.halted) {
    return { allowed: false, reason: `halted: ${state.haltedReason || "manual"}`, state };
  }

  // 4) 일/주 시작 에쿼티 초기화
  const dk = dayKey();
  const wk = weekKey();
  let dirty = false;
  if (state.dayKey !== dk) {
    state.dayKey = dk;
    state.dayStartEquity = currentEquity;
    dirty = true;
  }
  if (state.weekKey !== wk) {
    state.weekKey = wk;
    state.weekStartEquity = currentEquity;
    dirty = true;
  }
  if (!state.equityHigh || currentEquity > state.equityHigh) {
    state.equityHigh = currentEquity;
    dirty = true;
  }

  // 5) 한도 체크
  const dayPnL = state.dayStartEquity ? (currentEquity - state.dayStartEquity) / state.dayStartEquity : 0;
  const weekPnL = state.weekStartEquity ? (currentEquity - state.weekStartEquity) / state.weekStartEquity : 0;
  const mdd = state.equityHigh ? (state.equityHigh - currentEquity) / state.equityHigh : 0;

  if (dayPnL <= -BREAKER_LIMITS.dailyLossPct) {
    state.halted = true;
    state.haltedReason = `daily loss ${(dayPnL * 100).toFixed(2)}% <= -${(BREAKER_LIMITS.dailyLossPct * 100).toFixed(0)}%`;
    state.haltedAt = now;
    await kv.set(key, state);
    return { allowed: false, reason: state.haltedReason, state };
  }
  if (weekPnL <= -BREAKER_LIMITS.weeklyLossPct) {
    state.halted = true;
    state.haltedReason = `weekly loss ${(weekPnL * 100).toFixed(2)}%`;
    state.haltedAt = now;
    await kv.set(key, state);
    return { allowed: false, reason: state.haltedReason, state };
  }
  if (mdd >= BREAKER_LIMITS.mddPct) {
    state.halted = true;
    state.haltedReason = `MDD ${(mdd * 100).toFixed(2)}% >= ${(BREAKER_LIMITS.mddPct * 100).toFixed(0)}%`;
    state.haltedAt = now;
    await kv.set(key, state);
    return { allowed: false, reason: state.haltedReason, state };
  }

  if (dirty) await kv.set(key, state);
  return { allowed: true, state };
}

/**
 * 포지션 종료 시 호출해서 연속손실/쿨다운 상태 업데이트.
 * @param {string} userId
 * @param {number} realizedPnL  (USDT, 손익 금액)
 */
export async function recordTradeResult(userId, realizedPnL) {
  const kv = await getKv();
  const key = `di:real:user:${userId}:breaker`;
  const state = (await kv.get(key)) || {};
  const now = Date.now();

  if (realizedPnL < 0) {
    state.consecLosses = (state.consecLosses || 0) + 1;
    state.lastLossAt = now;
    if (state.consecLosses >= BREAKER_LIMITS.consecLossThreshold) {
      state.cooldownUntil = now + BREAKER_LIMITS.cooldownMs;
      state.consecLosses = 0;
    }
  } else if (realizedPnL > 0) {
    state.consecLosses = 0;
  }

  await kv.set(key, state);
  return state;
}

/**
 * 수동 reset (유저가 브레이커를 풀 때)
 */
export async function resetBreaker(userId) {
  const kv = await getKv();
  const key = `di:real:user:${userId}:breaker`;
  const state = (await kv.get(key)) || {};
  state.halted = false;
  state.haltedReason = null;
  state.haltedAt = null;
  state.cooldownUntil = 0;
  state.consecLosses = 0;
  await kv.set(key, state);
  return state;
}

export const BREAKER_CONFIG = BREAKER_LIMITS;

export default {
  preTradeCheck,
  recordTradeResult,
  resetBreaker,
  isKillSwitchEnabled,
  setKillSwitch,
  getBreakerState,
  BREAKER_CONFIG,
};
