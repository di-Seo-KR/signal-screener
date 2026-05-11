// ════════════════════════════════════════════════════════
// Strategy: defi-momentum (DeFi/인프라 섹터 모멘텀)
// 봇: defi-infra (LINK·UNI·AAVE·DOT)
// ────────────────────────────────────────────────────────
// 핵심 아이디어: DeFi 토큰은 BTC 베타가 높지만 섹터 모멘텀에 더 민감.
// OBV (스마트머니 흐름) + 14일 모멘텀 + EMA + RSI 의 합성.
// 거래량 동반 상승을 매수 신호로 가장 강하게 잡는다 — DeFi 펌프는
// 보통 거래량 spike 가 선행하기 때문.
//
// 진입 조건:
//   LONG  — OBV 상승추세 + 14일 수익률>3% + EMA21>55 + RSI 50~70
//   SHORT — OBV 하락추세 + 14일 수익률<-3% + EMA21<55 + RSI 30~50
// ════════════════════════════════════════════════════════

import { computeIndicatorBundle, gradeConfidence, scaleScore } from "./_indicators.js";

const FAMILY = "momentum";
const MIN_BARS = 60;

export function runDefiMomentum({ closes, highs, lows, volumes, asset, timeframe = "1d" }) {
  if (!closes || closes.length < MIN_BARS) return null;
  const ind = computeIndicatorBundle({ closes, highs, lows, volumes });
  const L = closes.length - 1;
  const price = closes[L];

  const back14 = closes[Math.max(0, L - 14)];
  const back7 = closes[Math.max(0, L - 7)];
  const ret14 = back14 > 0 ? (price / back14 - 1) * 100 : 0;
  const ret7 = back7 > 0 ? (price / back7 - 1) * 100 : 0;

  const rsi = ind.rsi[L];
  const ema21 = ind.ema21[L];
  const ema55 = ind.ema55[L];
  const obv = ind.obv[L];
  const obvEma = ind.obvEma[ind.obvEma.length - 1] || 0;

  const reasons = [`14일 ${ret14.toFixed(1)}%`];
  let buy = 0, sell = 0;

  // OBV 스마트머니 흐름 (핵심 3점) — DeFi 펌프는 보통 OBV 가 선행
  const obvUp = obv > obvEma;
  if (obvUp && ret7 > 0) { buy += 3; reasons.push("OBV 매집"); }
  if (!obvUp && ret7 < 0) { sell += 3; reasons.push("OBV 분산"); }

  // 14일 모멘텀 (2점)
  if (ret14 > 5) { buy += 2; reasons.push("강한 모멘텀↑"); }
  else if (ret14 > 2) { buy += 1; reasons.push("약 모멘텀↑"); }
  if (ret14 < -5) { sell += 2; reasons.push("강한 모멘텀↓"); }
  else if (ret14 < -2) { sell += 1; reasons.push("약 모멘텀↓"); }

  // EMA 정배열 (2점)
  if (ema21 != null && ema55 != null) {
    if (ema21 > ema55) { buy += 2; reasons.push("EMA정배열"); }
    else { sell += 2; reasons.push("EMA역배열"); }
  }

  // RSI sweet spot (1점) — 50~70 강세지속, 30~50 약세지속
  if (rsi != null) {
    if (rsi >= 50 && rsi <= 70) { buy += 1; reasons.push(`RSI${rsi.toFixed(0)} 강세대`); }
    if (rsi >= 30 && rsi <= 50) { sell += 1; reasons.push(`RSI${rsi.toFixed(0)} 약세대`); }
    // 극단 회피
    if (rsi > 80 || rsi < 20) {
      reasons.push(`RSI${rsi.toFixed(0)} 극단주의`);
    }
  }

  // 거래량 확인 (1점)
  const volAvg = ind.volSMA[L];
  if (volAvg && volAvg > 0) {
    const volMult = volumes[L] / volAvg;
    if (volMult > 1.4) {
      if (price > closes[L - 1]) { buy += 1; reasons.push(`거래량 ${volMult.toFixed(1)}x`); }
      else { sell += 1; reasons.push(`거래량 ${volMult.toFixed(1)}x`); }
    }
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
    reason: `[${timeframe}|defi-momentum] ` + reasons.join(" + "),
    sizeHint: Math.max(0.35, Math.min(0.8, absNet / 9)),
    type: side === "LONG" ? "BUY" : "SELL",
    positionSize: Math.max(0.35, Math.min(0.8, absNet / 9)),
  };
}

export default { runDefiMomentum, FAMILY };
