// ════════════════════════════════════════════════════════
// Zepta — Strategy Dispatcher
// ────────────────────────────────────────────────────────
// 봇 ID 를 받아 그 봇 전용 strategy 함수를 실행한다.
// btc-cron.js 의 단일 analyzeLatest 를 대체 — 봇별 차별성 확보.
//
// 봇 매핑:
//   btc-alpha          → hurst-trend (BTC 단일, Hurst 기반)
//   highcap-momentum   → trend-follow (EMA+MACD+ADX 추세)
//   defi-infra         → defi-momentum (OBV+모멘텀+EMA)
//   l2-emerging        → supertrend (ATR밴드 추세; breakout 손실로 2026-06 교체)
//   meme-trend         → ensemble (다전략 합의, 보수적)
//   crypto-diversity   → momentum-rotation (다자산 상대강도)
//   crypto-swing       → volatility-arb (ATR 압축-폭발)
//   기본 fallback      → ensemble
// ════════════════════════════════════════════════════════

import { runTrendFollow } from "./trend-follow.js";
import { runMeanRevert } from "./mean-revert.js";
import { runBreakout } from "./breakout.js";
import { runMomentumRotation } from "./momentum-rotation.js";
import { runVolatilityArb } from "./volatility-arb.js";
import { runHurstTrend } from "./hurst-trend.js";
import { runDefiMomentum } from "./defi-momentum.js";
import { runEnsemble } from "./ensemble.js";
import { runSupertrend } from "./supertrend.js";

// 봇 ID → strategy 함수 매핑
//   ★ 2026-06-02 l2-emerging: breakout(백테스트 PF<1 손실) → supertrend(검증 OOS 3.69) 교체.
//     검증된 승자로 손실 전략 대체 + 실거래 전략 다양화. breakout 은 발굴 풀엔 유지(params 개선 시 복귀 가능).
export const BOT_STRATEGY_MAP = {
  "btc-alpha":        runHurstTrend,
  "highcap-momentum": runTrendFollow,
  "defi-infra":       runDefiMomentum,
  "l2-emerging":      runSupertrend,
  "meme-trend":       runEnsemble,
  "crypto-diversity": runMomentumRotation,
  "crypto-swing":     runVolatilityArb,
};

// 모든 strategy 함수 (발굴 대상 + cron 진단).
//   ★ 2026-06-02 supertrend 추가 — 백테스트(full Sharpe1.80/OOS 3.69) 검증 후 발굴 풀 편입.
//   (donchian-revert 는 OOS Sharpe -6.61 과적합으로 채택 보류.)
//   BOT_STRATEGY_MAP 에는 아직 미배정 → 교차심볼+OOS 검증 통과 후 실거래 배정 예정.
export const ALL_STRATEGIES = {
  "trend-follow":       runTrendFollow,
  "mean-revert":        runMeanRevert,
  "breakout":           runBreakout,
  "momentum-rotation":  runMomentumRotation,
  "volatility-arb":     runVolatilityArb,
  "hurst-trend":        runHurstTrend,
  "defi-momentum":      runDefiMomentum,
  "ensemble":           runEnsemble,
  "supertrend":         runSupertrend,
};

/**
 * 봇 ID 와 시장 데이터를 받아 그 봇 전용 시그널을 생성.
 *
 * @param {string} botId          봇 식별자 (예: "btc-alpha")
 * @param {object} input          시장 데이터
 * @param {number[]} input.closes
 * @param {number[]} input.highs
 * @param {number[]} input.lows
 * @param {number[]} input.volumes
 * @param {string}   input.asset  ("BTC/USD" 등)
 * @param {string}   [input.timeframe="1d"]
 * @returns {object|null} 시그널 ({ side, score, confidence, family, timeframe, reason, sizeHint, type, positionSize }) 또는 null
 */
export function runStrategyForBot(botId, input) {
  const fn = BOT_STRATEGY_MAP[botId];
  if (!fn) {
    // 미지의 봇 ID 는 ensemble 로 fallback (가장 보수적)
    return runEnsemble(input);
  }
  return fn(input);
}

/**
 * 봇별 strategy 이름 (텔레메트리/로그용).
 */
export function getStrategyNameForBot(botId) {
  const lookup = {
    "btc-alpha":        "hurst-trend",
    "highcap-momentum": "trend-follow",
    "defi-infra":       "defi-momentum",
    "l2-emerging":      "supertrend",
    "meme-trend":       "ensemble",
    "crypto-diversity": "momentum-rotation",
    "crypto-swing":     "volatility-arb",
  };
  return lookup[botId] || "ensemble";
}

export default {
  BOT_STRATEGY_MAP,
  ALL_STRATEGIES,
  runStrategyForBot,
  getStrategyNameForBot,
};
