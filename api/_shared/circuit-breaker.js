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

// ★ 2026-05-09: BREAKER_LIMITS export — UI 가 옛 한도 하드코딩 안 하도록.
//   status.js 가 이 객체를 함께 내려보내고, RealTrading.jsx 가 그것 사용.
export const BREAKER_LIMITS = {
  // ★ 2026-05-08: 대표님 지시로 대폭 완화.
  //   거래당 ROI -40% 까지 허용한 만큼 서킷브레이커 한도도 일치시켜야
  //   한 거래만으로 자동매매가 그날 멈추는 사태 방지.
  dailyLossPct: 0.40,   // 하루 -40% 넘으면 halt (이전 -4%)
  weeklyLossPct: 0.60,  // 주간 -60% (이전 -8%) — 연속 사고 차단
  mddPct: 0.50,         // MDD -50% (이전 -15%) — 자본 절반 보호
  consecLossThreshold: 5, // 연속 손실 5회 → 24h cooldown (그대로)
  cooldownMs: 24 * 60 * 60 * 1000,
};

// ★ 2026-05-09: KST 기준 reset 으로 변경 (이전: UTC).
//   이전엔 UTC 자정 = KST 09:00 에 카운터 reset → 새벽 매매가 두 거래일로 쪼개짐.
//   현재는 KST 자정 = UTC 15:00 에 reset.
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
function kstDate(d = new Date()) {
  return new Date(d.getTime() + KST_OFFSET_MS);
}
function dayKey(d = new Date()) {
  return kstDate(d).toISOString().slice(0, 10); // YYYY-MM-DD (KST)
}
function weekKey(d = new Date()) {
  // ISO 8601 week — 첫 목요일 기준. KST 시각 기반으로 계산.
  const k = kstDate(d);
  // ISO week 계산 정공법 (Mon 시작, 첫 목요일 포함 주가 1주차)
  const target = new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate()));
  const dayNum = (target.getUTCDay() + 6) % 7; // Mon=0 ~ Sun=6
  target.setUTCDate(target.getUTCDate() - dayNum + 3); // 그 주의 목요일
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  const week = 1 + Math.round((target - firstThursday) / (7 * 86400000));
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
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
      // ★ rolling 30일 peak 사용 (auto-recovery 도 일관된 기준)
      const peakForMdd = state.equityHigh30d || state.equityHigh;
      const mddNow = (peakForMdd - currentEquity) / peakForMdd;
      // ★ 2026-05-09 audit C2: hysteresis 적용 — 한도의 80% 까지 회복해야 자동 해제.
      //   이전: 한도 안에 들어오면 즉시 해제 → -42% halt → -38% 회복 → 즉시 해제 → 또 진입 → -45% 사이클.
      //   현재: 한 번 halt 면 -32% (=한도 80%) 까지 회복 후에만 해제 → 진동 방지.
      const HYSTERESIS = 0.80;
      const dailyHysCap = BREAKER_LIMITS.dailyLossPct * HYSTERESIS;
      const weeklyHysCap = BREAKER_LIMITS.weeklyLossPct * HYSTERESIS;
      const mddHysCap = BREAKER_LIMITS.mddPct * HYSTERESIS;
      const inBounds =
        dPnL > -dailyHysCap &&
        wPnL > -weeklyHysCap &&
        mddNow < mddHysCap;
      if (inBounds) {
        state.halted = false;
        state.haltedReason = null;
        state.haltedAt = null;
        state.haltedRecoveredAt = now;
        await kv.set(key, state);
        // 통과 (allowed) — 5번 한도 체크에서 다시 평가
      } else {
        return {
          allowed: false,
          reason: `halted: ${reason} (hysteresis: 한도 ${(HYSTERESIS*100).toFixed(0)}% 까지 회복 필요)`,
          state,
        };
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

  // ★ 2026-05-09: rolling 30일 equityHigh 도입.
  //   기존 equityHigh 는 all-time 이라 한 번 큰 상승 후엔 영원히 -50% MDD 트리거 위험.
  //   현재: 최근 30일 내 최고점 대비로 MDD 계산 → 장기 보유 후 정상 조정도 지나치게 안 막음.
  //   equityHistory: [{ ts, equity }] — 30일 초과분은 자동 폐기, 봉당 1개만 유지.
  const ROLLING_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
  const ROLLING_BUCKET_MS = 60 * 60 * 1000; // 1시간 간격 샘플링 (KV 사이즈 제어)
  if (!Array.isArray(state.equityHistory)) state.equityHistory = [];
  const lastSample = state.equityHistory[state.equityHistory.length - 1];
  if (!lastSample || (now - lastSample.ts) >= ROLLING_BUCKET_MS) {
    state.equityHistory.push({ ts: now, equity: currentEquity });
    // 30일 초과 샘플 폐기
    state.equityHistory = state.equityHistory.filter((s) => now - s.ts <= ROLLING_WINDOW_MS);
    dirty = true;
  }
  const equityHigh30d = state.equityHistory.length > 0
    ? Math.max(...state.equityHistory.map((s) => s.equity), currentEquity)
    : currentEquity;
  state.equityHigh30d = equityHigh30d;

  // 5) 한도 체크
  const dayPnL = state.dayStartEquity ? (currentEquity - state.dayStartEquity) / state.dayStartEquity : 0;
  const weekPnL = state.weekStartEquity ? (currentEquity - state.weekStartEquity) / state.weekStartEquity : 0;
  // ★ MDD 계산은 30일 rolling peak 사용 (이전: all-time equityHigh)
  const mdd = equityHigh30d > 0 ? (equityHigh30d - currentEquity) / equityHigh30d : 0;

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
    state.haltedReason = `MDD ${(mdd * 100).toFixed(2)}% >= ${(BREAKER_LIMITS.mddPct * 100).toFixed(0)}% (30일 peak 기준)`;
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

    // ★ 2026-05-09: realized=0 (수수료 break-even) 도 streak break.
    //   이전 정책: realizedPnL < 0 만 +1, > 0 만 reset → 0 거래는 영원히 무영향
    //   → 연속손실 streak 가 영원히 안 끊일 수 있음 (예: -loss / 0 / -loss / 0 ...)
    //   현재: realizedPnL < 0 만 +1, > 0 또는 == 0 이면 reset.
    if (realizedPnL < 0) {
      state.consecLosses = (state.consecLosses || 0) + 1;
      state.lastLossAt = now;
      if (state.consecLosses >= BREAKER_LIMITS.consecLossThreshold) {
        state.cooldownUntil = now + BREAKER_LIMITS.cooldownMs;
        state.consecLosses = 0;
      }
    } else {
      // > 0 또는 == 0 (break-even) — streak 끊김
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

/**
 * ★ 2026-05-09: MDD 기준점 (equityHigh / equityHigh30d / equityHistory) 만 리셋.
 * 큰 상승 후 정상 조정에도 옛 peak 가 발목 잡을 때 유저가 수동으로 기준점을 현재가로 재설정.
 * halted 상태는 건드리지 않음 (그건 resetBreaker 가 별도 처리).
 */
export async function resetEquityHigh(userId, currentEquity) {
  const kv = await getKv();
  const key = `di:real:user:${userId}:breaker`;
  const state = (await kv.get(key)) || {};
  const now = Date.now();
  state.equityHigh = currentEquity;
  state.equityHigh30d = currentEquity;
  state.equityHistory = [{ ts: now, equity: currentEquity }];
  state.equityHighResetAt = now;
  await kv.set(key, state);
  return state;
}

export const BREAKER_CONFIG = BREAKER_LIMITS;

export default {
  preTradeCheck,
  recordTradeResult,
  resetBreaker,
  resetEquityHigh,
  isKillSwitchEnabled,
  setKillSwitch,
  getBreakerState,
  BREAKER_CONFIG,
};
