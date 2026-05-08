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
  // ★ 2026-05-08: 대표님 지시로 대폭 완화.
  //   거래당 ROI -40% 까지 허용한 만큼 서킷브레이커 한도도 일치시켜야
  //   한 거래만으로 자동매매가 그날 멈추는 사태 방지.
  dailyLossPct: 0.40,   // 하루 -40% 넘으면 halt (이전 -4%)
  weeklyLossPct: 0.60,  // 주간 -60% (이전 -8%) — 연속 사고 차단
  mddPct: 0.50,         // MDD -50% (이전 -15%) — 자본 절반 보호
  consecLossThreshold: 5, // 연속 손실 5회 → 24h cooldown (그대로)
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
  // ★ Fail-closed: KV 에러/타임아웃/미설정 전부 "차단(ON)" 으로 해석.
  //   이 함수의 기본 원칙은 "조금이라도 의심스러우면 돈을 막는다".
  try {
    const kv = await getKv();
    const v = await kv.get(`di:real:user:${userId}:killswitch`);
    if (v === null || v === undefined) return true; // default ON (disabled)
    return !!v;
  } catch (e) {
    console.error("[killswitch] KV read failed → fail-closed ON:", e?.message);
    return true;
  }
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
  // 1) 킬스위치 (fail-closed)
  const killed = await isKillSwitchEnabled(userId);
  if (killed) {
    return { allowed: false, reason: "killswitch is ON (default)", state: {} };
  }

  // ★ KV read 실패는 fail-closed
  let kv, state;
  try {
    kv = await getKv();
    state = (await kv.get(`di:real:user:${userId}:breaker`)) || {};
  } catch (e) {
    console.error("[breaker] KV read failed → fail-closed:", e?.message);
    return { allowed: false, reason: "breaker KV read failed (fail-closed)", state: {} };
  }

  const key = `di:real:user:${userId}:breaker`;
  const now = Date.now();

  // 2) cooldown 중인지
  if (state.cooldownUntil && now < state.cooldownUntil) {
    return {
      allowed: false,
      reason: `cooldown until ${new Date(state.cooldownUntil).toISOString()}`,
      state,
    };
  }

  // 3) 수동/자동 halt — 단, 한도 완화로 자동 발동된 halt 는 새 한도 안에 있으면 자동 해제
  if (state.halted) {
    // ★ auto-recovery: 자동 발동된 한도(daily/weekly/MDD) 가 현재 새 한도 안에
    //   있으면 자동 해제. 사용자 수동 halt 는 그대로 유지.
    const reason = state.haltedReason || "";
    const isAutoLimit = /daily loss|weekly loss|MDD/.test(reason);
    if (isAutoLimit && state.dayStartEquity && state.weekStartEquity && state.equityHigh) {
      const dPnL = (currentEquity - state.dayStartEquity) / state.dayStartEquity;
      const wPnL = (currentEquity - state.weekStartEquity) / state.weekStartEquity;
      const mddNow = (state.equityHigh - currentEquity) / state.equityHigh;
      const inBounds =
        dPnL > -BREAKER_LIMITS.dailyLossPct &&
        wPnL > -BREAKER_LIMITS.weeklyLossPct &&
        mddNow < BREAKER_LIMITS.mddPct;
      if (inBounds) {
        state.halted = false;
        state.haltedReason = null;
        state.haltedAt = null;
        await kv.set(key, state);
        // 통과 (allowed) — 5번 한도 체크에서 다시 평가
      } else {
        return { allowed: false, reason: `halted: ${reason}`, state };
      }
    } else {
      return { allowed: false, reason: `halted: ${reason || "manual"}`, state };
    }
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
  try {
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
  } catch (e) {
    // ★ KV 장애 시에도 크래시하지 않고 안전하게 실패.
    // 연속손실 카운터가 갱신 안 되더라도 거래 자체는 이미 종료된 상태.
    console.error(`[circuit-breaker] recordTradeResult failed for ${userId}:`, e?.message);
    return null;
  }
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
