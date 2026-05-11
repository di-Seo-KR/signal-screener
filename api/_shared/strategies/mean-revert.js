// ════════════════════════════════════════════════════════
// Strategy: mean-revert (평균회귀)
// 봇: meme-trend (밈코인 단기 회귀) + crypto-diversity 의 회귀장 fallback
// ────────────────────────────────────────────────────────
// 핵심 아이디어: 횡보/회귀장에서 과매도-반등 / 과매수-꺾임을 잡는다.
// RSI 30 미만 + 볼린저 하단 터치 + Stochastic 골든크로스 = 3중 합의.
// 추세장(ADX > 25)에서는 일부러 시그널을 내지 않음 — "고점 잡으려다 칼맞기"
// 회피.
//
// 진입 조건:
//   LONG  — RSI<30 + BB lower 접근 + Stoch %K<25 골든
//   SHORT — RSI>70 + BB upper 접근 + Stoch %K>75 데드
// ════════════════════════════════════════════════════════

import { computeIndicatorBundle, gradeConfidence, scaleScore } from "./_indicators.js";

const FAMILY = "mean-revert";
const MIN_BARS = 60;

export function runMeanRevert({ closes, highs, lows, volumes, asset, timeframe = "1d" }) {
  if (!closes || closes.length < MIN_BARS) return null;
  const ind = computeIndicatorBundle({ closes, highs, lows, volumes });
  const L = closes.length - 1;
  const price = closes[L];

  const rsi = ind.rsi[L];
  const rsiPrev = ind.rsi[L - 1];
  const bb = ind.bb[L];
  const adx = ind.adx[L] || 0;
  const hurst = ind.hurst;

  // 강한 추세장이면 회귀 전략 자체가 위험 → 보류
  if (adx > 28 && hurst > 0.6) {
    return null;
  }

  const reasons = [`ADX${adx.toFixed(0)} 비추세`, `H${hurst.toFixed(2)}`];
  let buy = 0, sell = 0;

  // RSI 극단 (핵심 3점)
  if (rsi != null) {
    if (rsi < 30) { buy += 3; reasons.push(`RSI${rsi.toFixed(0)} 과매도`); }
    else if (rsi < 38 && rsiPrev != null && rsi > rsiPrev) {
      buy += 2; reasons.push(`RSI${rsi.toFixed(0)} 반등 시작`);
    }
    if (rsi > 70) { sell += 3; reasons.push(`RSI${rsi.toFixed(0)} 과매수`); }
    else if (rsi > 62 && rsiPrev != null && rsi < rsiPrev) {
      sell += 2; reasons.push(`RSI${rsi.toFixed(0)} 꺾임`);
    }
  }

  // 볼린저 밴드 (2점) — 핵심 회귀 지표
  if (bb) {
    if (price <= bb.lower * 1.02) { buy += 2; reasons.push("BB하단 터치"); }
    else if (price <= bb.lower * 1.05) { buy += 1; reasons.push("BB하단 접근"); }
    if (price >= bb.upper * 0.98) { sell += 2; reasons.push("BB상단 터치"); }
    else if (price >= bb.upper * 0.95) { sell += 1; reasons.push("BB상단 접근"); }
  }

  // Stochastic %K 골든/데드 (2점)
  const k = ind.stoch.k;
  const d = ind.stoch.d;
  if (k.length > 1) {
    const curK = k[k.length - 1];
    const curD = d[d.length - 1];
    const prevK = k[k.length - 2];
    const prevD = d[d.length - 2];
    if (curK != null && curD != null && prevK != null && prevD != null) {
      if (curK < 25 && curK > curD && prevK <= prevD) {
        buy += 2; reasons.push(`Stoch${curK.toFixed(0)} 골든`);
      }
      if (curK > 75 && curK < curD && prevK >= prevD) {
        sell += 2; reasons.push(`Stoch${curK.toFixed(0)} 데드`);
      }
    }
  }

  // Hurst 회귀 확인 (1점) — H<0.45 면 회귀장
  if (hurst < 0.45) {
    if (rsi != null && rsi < 45) { buy += 1; reasons.push("H회귀→매수"); }
    if (rsi != null && rsi > 55) { sell += 1; reasons.push("H회귀→매도"); }
  }

  const net = buy - sell;
  const absNet = Math.abs(net);
  if (absNet < 2) return null;

  const side = net > 0 ? "LONG" : "SHORT";
  return {
    side,
    score: scaleScore(absNet),
    confidence: gradeConfidence(absNet),
    family: FAMILY,
    timeframe,
    reason: `[${timeframe}|mean-revert] ` + reasons.join(" + "),
    sizeHint: Math.max(0.3, Math.min(0.8, absNet / 9)),
    type: side === "LONG" ? "BUY" : "SELL",
    positionSize: Math.max(0.3, Math.min(0.8, absNet / 9)),
  };
}

export default { runMeanRevert, FAMILY };
