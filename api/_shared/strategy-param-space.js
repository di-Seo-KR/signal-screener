// ════════════════════════════════════════════════════════════════════
// Zepta — Strategy Parameter Search Space
// ────────────────────────────────────────────────────────────────────
// 각 strategy 의 grid search 탐색 공간 정의.
//
// 본래 strategy 모듈에 `getParamSpace()` 를 노출하는 게 이상적이지만,
// 병렬 작업 충돌 회피를 위해 별도 파일로 분리. param-tuner 가 여길 읽고
// 모든 조합을 시뮬레이션한 뒤 KV (di:alpha:params:<id>) 에 적재.
//
// 조합 크기 ≤ 32 권장 (백테스트 1회 ≈ 100ms × 32 × 60일 ≈ 5초/strategy).
// 8개 strategy × 5초 = 40초 → Vercel cron 60초 timeout 내 안전.
// ════════════════════════════════════════════════════════════════════

export const PARAM_SPACE = {
  "trend-follow": {
    // 추세 강도 임계 — 22 미만 못잡으면 ADX 16 도 시도해볼 가치
    ADX_MIN: [18, 22, 26],
    // EMA 짧은 쪽
    EMA_FAST: [13, 21, 34],
    // 신호 강도 컷
    MIN_ABS_NET: [2, 3, 4],
  },
  "mean-revert": {
    RSI_OVERSOLD: [25, 30, 35],
    RSI_OVERBOUGHT: [65, 70, 75],
    BB_MULT: [1.8, 2.0, 2.2],
    MIN_ABS_NET: [2, 3],
  },
  "breakout": {
    BREAKOUT_PERIOD: [10, 20, 30],
    VOL_MULT: [1.2, 1.5, 2.0],
    MIN_ABS_NET: [2, 3],
  },
  "momentum-rotation": {
    LOOKBACK_DAYS: [14, 21, 30],
    TOP_N: [2, 3, 5],
    MIN_ABS_NET: [2, 3],
  },
  "volatility-arb": {
    BB_SQUEEZE_THRESHOLD: [0.03, 0.05, 0.08],
    ATR_PERIOD: [10, 14, 20],
    MIN_ABS_NET: [2, 3],
  },
  "hurst-trend": {
    HURST_TREND_MIN: [0.52, 0.55, 0.58],
    HURST_REVERT_MAX: [0.42, 0.45, 0.48],
    MIN_ABS_NET: [2, 3],
  },
  "defi-momentum": {
    EMA_FAST: [8, 13, 21],
    EMA_SLOW: [21, 34, 55],
    MIN_ABS_NET: [2, 3],
  },
  "ensemble": {
    CONSENSUS_MIN: [2, 3],
    MIN_ABS_NET: [3, 4],
  },
  "supertrend": {
    ATR_PERIOD: [7, 10, 14],
    ST_MULT: [2.0, 3.0, 4.0],
    MIN_ABS_NET: [2, 3],
  },
};

/**
 * 변형 후보 sweep — Phase 5 continuous-backtest 에서 사용.
 * 위 grid 보다 넓은 공간을 random sample 로 탐색.
 */
export const WIDE_PARAM_SPACE = {
  "trend-follow": {
    ADX_MIN: [12, 16, 20, 24, 28, 32],
    EMA_FAST: [8, 13, 21, 34, 55],
    EMA_SLOW: [34, 55, 89, 144],
    RSI_BULL: [50, 55, 60, 65],
    RSI_BEAR: [35, 40, 45, 50],
    MIN_ABS_NET: [1, 2, 3, 4, 5],
  },
  "mean-revert": {
    RSI_OVERSOLD: [20, 25, 30, 35, 40],
    RSI_OVERBOUGHT: [60, 65, 70, 75, 80],
    BB_PERIOD: [15, 20, 25, 30],
    BB_MULT: [1.5, 1.8, 2.0, 2.2, 2.5],
    ADX_MAX: [22, 26, 30, 34],
    MIN_ABS_NET: [1, 2, 3, 4],
  },
  "breakout": {
    BREAKOUT_PERIOD: [5, 10, 15, 20, 30, 50],
    VOL_MULT: [1.0, 1.3, 1.5, 1.8, 2.0, 2.5],
    ATR_PERIOD: [7, 14, 21],
    MIN_ABS_NET: [1, 2, 3, 4],
  },
  "momentum-rotation": {
    LOOKBACK_DAYS: [7, 14, 21, 30, 45, 60],
    TOP_N: [1, 2, 3, 5, 7],
    MIN_ABS_NET: [1, 2, 3, 4],
  },
  "volatility-arb": {
    BB_SQUEEZE_THRESHOLD: [0.02, 0.03, 0.05, 0.08, 0.12],
    ATR_PERIOD: [7, 10, 14, 20, 30],
    BB_PERIOD: [15, 20, 25],
    MIN_ABS_NET: [1, 2, 3, 4],
  },
  "hurst-trend": {
    HURST_TREND_MIN: [0.50, 0.52, 0.55, 0.58, 0.62],
    HURST_REVERT_MAX: [0.38, 0.42, 0.45, 0.48, 0.50],
    RSI_BULL: [50, 55, 60],
    RSI_BEAR: [40, 45, 50],
    MIN_ABS_NET: [1, 2, 3, 4],
  },
  "defi-momentum": {
    EMA_FAST: [5, 8, 13, 21, 34],
    EMA_SLOW: [21, 34, 55, 89],
    OBV_LOOKBACK: [10, 14, 20, 30],
    MIN_ABS_NET: [1, 2, 3, 4],
  },
  "ensemble": {
    CONSENSUS_MIN: [2, 3, 4],
    MIN_ABS_NET: [2, 3, 4, 5, 6],
  },
  "supertrend": {
    ATR_PERIOD: [7, 10, 14, 20],
    ST_MULT: [1.5, 2.0, 2.5, 3.0, 3.5, 4.0],
    ADX_MIN: [12, 18, 24, 30],
    MIN_ABS_NET: [1, 2, 3, 4],
  },
};

/**
 * random sample N 개 추출 (continuous-backtest 의 random sweep).
 * @param {string} strategyId
 * @param {number} n
 * @returns {Array<object>}
 */
export function sampleRandomParams(strategyId, n = 20) {
  const space = WIDE_PARAM_SPACE[strategyId];
  if (!space) return [];
  const keys = Object.keys(space);
  // ★ 적대감사 P2-13: 복원추출이라 같은 조합이 중복 생성 → 작은 grid(예 ensemble 15개)에선 n=50 중
  //   다수가 중복(계산 낭비 + 미탐색 조합 발생). Set dedup + cap=min(n, gridSize)로 중복 제거·커버리지↑.
  const gridSize = keys.reduce((p, k) => p * space[k].length, 1);
  const cap = Math.min(n, gridSize);
  const seen = new Set();
  const out = [];
  let guard = 0;
  while (out.length < cap && guard < n * 50) {
    guard++;
    const combo = {};
    for (const k of keys) {
      const arr = space[k];
      combo[k] = arr[Math.floor(Math.random() * arr.length)];
    }
    const sig = keys.map((k) => combo[k]).join("|");
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push(combo);
  }
  return out;
}

export default { PARAM_SPACE, WIDE_PARAM_SPACE, sampleRandomParams };
