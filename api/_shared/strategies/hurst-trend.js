// ════════════════════════════════════════════════════════
// Strategy: hurst-trend (Hurst 추세 알파)
// 봇: btc-alpha (BTC 단일 자산 전문)
// ────────────────────────────────────────────────────────
// 핵심 아이디어: Hurst 지수(R/S 분석) > 0.55 = 추세 지속 성향 시장.
// BTC 는 일봉/4시간봉에서 Hurst 가 가장 안정적으로 산출되어 검증된
// 비효율성 지표. EMA 정배열과 결합해 BTC 만의 모멘텀을 잡음.
//
// 진입 조건:
//   LONG  — Hurst > 0.55 + EMA21 > EMA55 + 가격 상승 흐름
//   SHORT — Hurst > 0.55 + EMA21 < EMA55 + 가격 하락 흐름
//   Hurst < 0.5 (회귀장) 에서는 진입 안 함.
// ════════════════════════════════════════════════════════

import { computeIndicatorBundle, gradeConfidence, scaleScore } from "./_indicators.js";

const FAMILY = "trend";
const MIN_BARS = 80;

export function runHurstTrend({ closes, highs, lows, volumes, asset, timeframe = "1d" }) {
  if (!closes || closes.length < MIN_BARS) return null;
  const ind = computeIndicatorBundle({ closes, highs, lows, volumes });
  const L = closes.length - 1;
  const price = closes[L];
  const prev5 = closes[Math.max(0, L - 5)];

  const hurst = ind.hurst;
  const adx = ind.adx[L] || 0;
  const ema21 = ind.ema21[L];
  const ema55 = ind.ema55[L];

  // Hurst 회귀장은 이 전략의 본령이 아님 → 보류
  if (hurst < 0.5) {
    return null;
  }

  const reasons = [`Hurst ${hurst.toFixed(2)}`, `ADX ${adx.toFixed(0)}`];
  let buy = 0, sell = 0;

  // Hurst 강도 기반 핵심 점수 (최대 3점)
  if (hurst > 0.6) {
    // 매우 강한 추세 지속 성향
    if (price > prev5) { buy += 3; reasons.push("강한 추세지속↑"); }
    else { sell += 3; reasons.push("강한 추세지속↓"); }
  } else if (hurst > 0.55) {
    if (price > prev5) { buy += 2; reasons.push("추세지속↑"); }
    else { sell += 2; reasons.push("추세지속↓"); }
  }

  // EMA 정배열 (2점)
  if (ema21 != null && ema55 != null) {
    if (ema21 > ema55) { buy += 2; reasons.push("EMA정배열"); }
    else { sell += 2; reasons.push("EMA역배열"); }
  }

  // ADX 강도 (1점)
  if (adx > 25) {
    if (ema21 > ema55) { buy += 1; reasons.push("ADX 추세 확인"); }
    else { sell += 1; reasons.push("ADX 추세 확인"); }
  }

  // 효율성 비율 (1점) — Hurst 와 함께 보조
  const curER = ind.er[ind.er.length - 1] || 0;
  if (curER > 0.4) {
    if (price > prev5) { buy += 1; reasons.push(`ER ${curER.toFixed(2)}`); }
    else { sell += 1; reasons.push(`ER ${curER.toFixed(2)}`); }
  }

  // MACD 방향 (1점)
  const macd = ind.macdLine[L];
  const macdSig = ind.macdSig[L];
  if (macd != null && macdSig != null) {
    if (macd > macdSig) { buy += 1; reasons.push("MACD bullish"); }
    else { sell += 1; reasons.push("MACD bearish"); }
  }

  const netScore = buy - sell;
  const absNet = Math.abs(netScore);
  if (absNet < 3) return null;

  const side = netScore > 0 ? "LONG" : "SHORT";
  return {
    side,
    score: scaleScore(absNet),
    confidence: gradeConfidence(absNet),
    family: FAMILY,
    timeframe,
    reason: `[${timeframe}|hurst-trend] ` + reasons.join(" + "),
    sizeHint: Math.max(0.4, Math.min(0.9, absNet / 9)),
    type: side === "LONG" ? "BUY" : "SELL",
    positionSize: Math.max(0.4, Math.min(0.9, absNet / 9)),
  };
}

export default { runHurstTrend, FAMILY };
