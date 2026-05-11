// ════════════════════════════════════════════════════════════════════
// Zepta — Strategy Router (시장 레짐 ↔ 전략 가중치)
// ────────────────────────────────────────────────────────────────────
// "추세장에선 trend-follow / breakout 우대, 횡보장에선 mean-revert /
//  volatility-arb 우대" 를 코드로 강제하는 모듈.
//
// 두 가지 데이터를 본다:
//   1) Hurst 지수 — 추세 vs 평균회귀 성격
//      H > 0.55 → 추세 (trending)
//      H < 0.45 → 평균회귀 (mean-reverting)
//      0.45~0.55 → 랜덤워크 (transitional)
//   2) ATR 비율 — 변동성 레짐
//      현재 ATR / 평균 ATR > 1.5 → 폭발성 (vol_explosive)
//      < 0.7 → 압축 (vol_compressed)
//
// 결과:
//   regime, weights, 산출 메타데이터.
//   weights 는 KV (di:alpha:strategy-weights) 에 적재되어 hot-reload 됨.
//   KV override 가 있으면 (사용자 수동 설정) 그것 우선.
// ════════════════════════════════════════════════════════════════════

import { calcHurst, calcATR } from "./strategies/_indicators.js";
import { setStrategyWeights, DEFAULT_STRATEGY_WEIGHTS } from "./dynamic-config.js";

// ────────────────────────────────────────────────────────────────────
// 가중치 프리셋
// ────────────────────────────────────────────────────────────────────

/**
 * 추세장 (Hurst > 0.55) — 추세 따라가는 전략이 우세.
 * trend-follow, breakout, hurst-trend, momentum-rotation 우대.
 * mean-revert / volatility-arb 는 박스권 가정이라 약화.
 */
export const WEIGHTS_TRENDING = {
  "trend-follow": 1.5,
  "breakout": 1.2,
  "hurst-trend": 1.4,
  "momentum-rotation": 1.2,
  "defi-momentum": 1.2,
  "mean-revert": 0.3,
  "volatility-arb": 0.6,
  "ensemble": 1.0,
};

/**
 * 횡보장 (Hurst < 0.45) — 평균회귀 / 변동성 거래 우세.
 * mean-revert, volatility-arb 우대. trend-follow 약화.
 */
export const WEIGHTS_MEAN_REVERTING = {
  "trend-follow": 0.5,
  "breakout": 0.6,
  "hurst-trend": 0.7,
  "momentum-rotation": 0.7,
  "defi-momentum": 0.8,
  "mean-revert": 1.5,
  "volatility-arb": 1.2,
  "ensemble": 1.0,
};

/**
 * 혼조 (Hurst 0.45~0.55) — 모두 중립.
 */
export const WEIGHTS_TRANSITIONAL = { ...DEFAULT_STRATEGY_WEIGHTS };

/**
 * 변동성 폭발 — risk-off, 모든 전략 가중치 -20% (살아남는 게 우선).
 */
function applyVolExplosivePenalty(weights) {
  const out = {};
  for (const [k, v] of Object.entries(weights)) out[k] = v * 0.8;
  // 단, volatility-arb 는 그 환경의 전문이라 +30% 보너스
  if (out["volatility-arb"] != null) out["volatility-arb"] *= 1.3;
  return out;
}

/**
 * 변동성 압축 — breakout 우대 (압축 후엔 폭발 옴).
 */
function applyVolCompressedBonus(weights) {
  const out = { ...weights };
  if (out["breakout"] != null) out["breakout"] *= 1.2;
  if (out["volatility-arb"] != null) out["volatility-arb"] *= 1.15;
  return out;
}

// ────────────────────────────────────────────────────────────────────
// 시장 레짐 산출
// ────────────────────────────────────────────────────────────────────

/**
 * 가격 데이터에서 시장 레짐 산출.
 * @param {object} input
 * @param {number[]} input.closes  종가 시계열 (최근 100~200개 권장)
 * @param {number[]} [input.highs]
 * @param {number[]} [input.lows]
 * @returns {{regime: string, volRegime: string, hurst: number, atrRatio: number}}
 */
export function detectRegime({ closes, highs, lows }) {
  if (!Array.isArray(closes) || closes.length < 30) {
    return { regime: "unknown", volRegime: "unknown", hurst: 0.5, atrRatio: 1.0 };
  }

  const hurst = calcHurst(closes.slice(-100));

  // ATR 비율 = 최근 14일 평균 ATR / 직전 30~44일 ATR
  let atrRatio = 1.0;
  if (highs && lows && highs.length === closes.length && closes.length >= 50) {
    const atrSeries = calcATR(highs, lows, closes, 14);
    const tail = atrSeries.filter((v) => v != null);
    if (tail.length >= 30) {
      const recent = tail.slice(-14);
      const older = tail.slice(-44, -14);
      const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
      const olderAvg = older.length ? older.reduce((a, b) => a + b, 0) / older.length : recentAvg;
      atrRatio = olderAvg > 0 ? recentAvg / olderAvg : 1.0;
    }
  }

  let regime = "transitional";
  if (hurst > 0.55) regime = "trending";
  else if (hurst < 0.45) regime = "mean_reverting";

  let volRegime = "vol_normal";
  if (atrRatio > 1.5) volRegime = "vol_explosive";
  else if (atrRatio < 0.7) volRegime = "vol_compressed";

  return { regime, volRegime, hurst, atrRatio };
}

// ────────────────────────────────────────────────────────────────────
// 가중치 산출 — regime → weights (메인 함수)
// ────────────────────────────────────────────────────────────────────

/**
 * 현재 시장 레짐에 따른 전략 가중치 맵을 반환.
 * @param {{regime: string, volRegime: string}} regimeInfo
 * @returns {Record<string, number>}
 */
export function getActiveStrategyWeights(regimeInfo) {
  let base;
  switch (regimeInfo?.regime) {
    case "trending":       base = WEIGHTS_TRENDING; break;
    case "mean_reverting": base = WEIGHTS_MEAN_REVERTING; break;
    case "transitional":   base = WEIGHTS_TRANSITIONAL; break;
    default:               base = WEIGHTS_TRANSITIONAL;
  }
  let weights = { ...base };

  // 변동성 보정
  if (regimeInfo?.volRegime === "vol_explosive") {
    weights = applyVolExplosivePenalty(weights);
  } else if (regimeInfo?.volRegime === "vol_compressed") {
    weights = applyVolCompressedBonus(weights);
  }

  // clamp 0.1 ~ 2.0 — 극단치 방지
  for (const k of Object.keys(weights)) {
    weights[k] = Math.max(0.1, Math.min(2.0, Number(weights[k]) || 1.0));
  }
  return weights;
}

/**
 * regime 산출 + KV 적재 통합 함수 (cron 이 한 번에 호출).
 * @param {{closes, highs, lows}} input
 */
export async function updateMarketRegimeAndWeights(input) {
  const regimeInfo = detectRegime(input);
  const weights = getActiveStrategyWeights(regimeInfo);
  await setStrategyWeights(weights, {
    regime: regimeInfo.regime,
    hurst: regimeInfo.hurst,
    atrRatio: regimeInfo.atrRatio,
    volRegime: regimeInfo.volRegime,
  });
  return { regimeInfo, weights };
}

export default {
  detectRegime,
  getActiveStrategyWeights,
  updateMarketRegimeAndWeights,
  WEIGHTS_TRENDING,
  WEIGHTS_MEAN_REVERTING,
  WEIGHTS_TRANSITIONAL,
};
