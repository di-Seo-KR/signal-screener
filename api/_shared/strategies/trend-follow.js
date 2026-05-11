// ════════════════════════════════════════════════════════
// Strategy: trend-follow
// 봇: highcap-momentum (BTC·ETH·SOL·XRP·ADA·AVAX 등 하이캡)
// ────────────────────────────────────────────────────────
// 핵심 아이디어: 강한 추세장(ADX > 25)에서 EMA 정배열 + MACD 방향에
// 올라타는 모멘텀 추종. 횡보장에서는 신호 자체를 내지 않음.
// "트렌드는 친구다 — 끝나기 전까진" 류의 가장 단순한 베이스라인.
//
// 진입 조건:
//   LONG  — EMA21 > EMA55 + MACD bullish + ADX > 22
//   SHORT — EMA21 < EMA55 + MACD bearish + ADX > 22
//   ADX 약하면 시그널 안 냄 (필터)
// ════════════════════════════════════════════════════════

import { computeIndicatorBundle, gradeConfidence, scaleScore } from "./_indicators.js";

const FAMILY = "trend";
const MIN_BARS = 60;

export function runTrendFollow({ closes, highs, lows, volumes, asset, timeframe = "1d" }) {
  if (!closes || closes.length < MIN_BARS) {
    return null;
  }
  const ind = computeIndicatorBundle({ closes, highs, lows, volumes });
  const L = closes.length - 1;
  const price = closes[L];
  const prev = closes[L - 1] || price;

  const ema21 = ind.ema21[L];
  const ema55 = ind.ema55[L];
  const ema200 = ind.ema200[L];
  const macd = ind.macdLine[L];
  const macdSig = ind.macdSig[L];
  const hist = ind.histogram[L];
  const adx = ind.adx[L] || 0;

  // 추세 강도 필터: ADX 22 미만이면 트렌드 미성숙으로 보고 보류
  if (adx < 22) {
    return null;
  }

  const reasons = [`ADX${adx.toFixed(0)} 추세장`];
  let buy = 0, sell = 0;

  // EMA 정배열 (3점, 핵심 지표)
  if (ema21 != null && ema55 != null) {
    if (ema21 > ema55) { buy += 3; reasons.push("EMA정배열(21>55)"); }
    else { sell += 3; reasons.push("EMA역배열(21<55)"); }
  }

  // MACD 방향 (2점)
  if (macd != null && macdSig != null) {
    if (macd > macdSig) { buy += 2; reasons.push("MACD bullish"); }
    else { sell += 2; reasons.push("MACD bearish"); }
  }

  // MACD 가속 (1점)
  if (hist != null && ind.histogram[L - 1] != null) {
    if (hist > 0 && hist > ind.histogram[L - 1]) { buy += 1; reasons.push("MACD가속↑"); }
    if (hist < 0 && hist < ind.histogram[L - 1]) { sell += 1; reasons.push("MACD가속↓"); }
  }

  // EMA200 장기 필터 (1점) — 장기 추세 일치 보너스
  if (ema200 != null) {
    if (price > ema200) { buy += 1; reasons.push("EMA200위"); }
    else { sell += 1; reasons.push("EMA200아래"); }
  }

  // RSI 모멘텀 (확인용 1점, 트렌드 follow 에선 과매수도 강세)
  const rsi = ind.rsi[L];
  if (rsi != null) {
    if (rsi > 55 && macd > macdSig) { buy += 1; reasons.push(`RSI${rsi.toFixed(0)} 강세지속`); }
    if (rsi < 45 && macd < macdSig) { sell += 1; reasons.push(`RSI${rsi.toFixed(0)} 약세지속`); }
  }

  // EMA 골든/데드 크로스 발생 시 추가 가중 (2점)
  if (ema21 != null && ema55 != null && ind.ema21[L - 1] != null && ind.ema55[L - 1] != null) {
    if (ema21 > ema55 && ind.ema21[L - 1] <= ind.ema55[L - 1]) {
      buy += 2; reasons.push("골든크로스!");
    }
    if (ema21 < ema55 && ind.ema21[L - 1] >= ind.ema55[L - 1]) {
      sell += 2; reasons.push("데드크로스!");
    }
  }

  const net = buy - sell;
  const absNet = Math.abs(net);
  if (absNet < 2) return null; // 추세장 약한 합의는 매매 안 함

  const side = net > 0 ? "LONG" : "SHORT";
  return {
    side,
    score: scaleScore(absNet),
    confidence: gradeConfidence(absNet),
    family: FAMILY,
    timeframe,
    reason: `[${timeframe}|trend-follow] ` + reasons.join(" + "),
    sizeHint: Math.max(0.3, Math.min(0.9, absNet / 10)),
    // btc-cron 호환 필드
    type: side === "LONG" ? "BUY" : "SELL",
    positionSize: Math.max(0.3, Math.min(0.9, absNet / 10)),
  };
}

export default { runTrendFollow, FAMILY };
