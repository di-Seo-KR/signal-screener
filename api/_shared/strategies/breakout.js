// ════════════════════════════════════════════════════════
// Strategy: breakout
// 봇: l2-emerging (ARB·OP·MATIC) — 신흥 L2 토큰의 박스권 돌파 알파
// ────────────────────────────────────────────────────────
// 핵심 아이디어: 20일/55일 고점-저점 돌파 + 거래량 spike + ATR 확장.
// 박스권에서 빠져나오는 "역사적 거래량 + 가격 동시 발산" 순간만 잡음.
// false breakout 방지: 거래량 1.5배 미만이면 신호 무효화.
//
// 진입 조건:
//   LONG  — close > 20일 high * 0.99 + vol > 1.5x avg + ATR 확장
//   SHORT — close < 20일 low * 1.01 + vol > 1.5x avg
// ════════════════════════════════════════════════════════

import { computeIndicatorBundle, gradeConfidence, scaleScore, calcSMA } from "./_indicators.js";

const FAMILY = "breakout";
const MIN_BARS = 60;

export function runBreakout({ closes, highs, lows, volumes, asset, timeframe = "1d", params = null }) {
  if (!closes || closes.length < MIN_BARS) return null;
  // ★ 2026-05-29 — 튜닝 파라미터 주입 (없으면 기존 하드코딩 값 그대로).
  const P = params || {};
  const BREAKOUT_PERIOD = P.BREAKOUT_PERIOD ?? 20;
  const VOL_MULT        = P.VOL_MULT        ?? 2.0;  // 강한 거래량 tier 기준
  const MIN_ABS_NET     = P.MIN_ABS_NET     ?? 3;
  const strongVol = VOL_MULT;
  const weakVol   = Math.max(1.2, VOL_MULT * 0.65);  // default 2.0 → 1.3
  const ind = computeIndicatorBundle({ closes, highs, lows, volumes }, {
    ATR_PERIOD: P.ATR_PERIOD,
  });
  const L = closes.length - 1;
  const price = closes[L];
  const prev = closes[L - 1] || price;

  const bp = BREAKOUT_PERIOD;
  const bp2 = Math.round(bp * 2.75);  // default 20 → 55 (중기 돌파 기간)
  const high20 = Math.max(...highs.slice(-bp));
  const low20 = Math.min(...lows.slice(-bp));
  const high55 = highs.length >= bp2 ? Math.max(...highs.slice(-bp2)) : high20;
  const low55 = lows.length >= bp2 ? Math.min(...lows.slice(-bp2)) : low20;

  const reasons = [];
  let buy = 0, sell = 0;

  // 20일 고점/저점 돌파 (핵심 3점)
  const breakHigh20 = price >= high20 * 0.99;
  const breakLow20 = price <= low20 * 1.01;
  if (breakHigh20) { buy += 3; reasons.push("20일고점 돌파"); }
  if (breakLow20) { sell += 3; reasons.push("20일저점 이탈"); }

  // 55일(중기) 고점 돌파 — 더 강력한 추세 시작 (2점)
  if (price >= high55 * 0.995) { buy += 2; reasons.push("55일고점 돌파"); }
  if (price <= low55 * 1.005) { sell += 2; reasons.push("55일저점 이탈"); }

  // 거래량 spike 필터 (필수, 2점)
  const volAvg = ind.volSMA[L];
  const curVol = volumes[L];
  let volMult = 1;
  if (volAvg && volAvg > 0 && curVol > 0) {
    volMult = curVol / volAvg;
    if (volMult > strongVol) {
      if (price > prev) { buy += 2; reasons.push(`거래량${volMult.toFixed(1)}x↑`); }
      else { sell += 2; reasons.push(`거래량${volMult.toFixed(1)}x↓`); }
    } else if (volMult > weakVol) {
      if (price > prev) { buy += 1; reasons.push(`거래량${volMult.toFixed(1)}x`); }
      else { sell += 1; reasons.push(`거래량${volMult.toFixed(1)}x`); }
    }
  }

  // ATR 확장 확인 (1점) — 변동성 expansion 동반 시 진성 돌파 가능성↑
  const atr = ind.atr;
  const atrLongMA = calcSMA(atr.map(v => v || 0), 50);
  const curAtr = atr[L] || 0;
  const atrMA = atrLongMA[atrLongMA.length - 1] || 1;
  const atrRatio = atrMA > 0 ? curAtr / atrMA : 1;
  if (atrRatio > 1.4) {
    if (price > prev) { buy += 1; reasons.push(`ATR확장 ${atrRatio.toFixed(1)}x`); }
    else { sell += 1; reasons.push(`ATR확장 ${atrRatio.toFixed(1)}x`); }
  }

  // 추세 정렬 보너스 (1점) — 돌파 방향이 EMA 와 일치
  if (ind.ema21[L] != null && ind.ema55[L] != null) {
    if (price > ind.ema21[L] && ind.ema21[L] > ind.ema55[L] && net(buy, sell) > 0) {
      buy += 1; reasons.push("EMA정배열 동조");
    }
    if (price < ind.ema21[L] && ind.ema21[L] < ind.ema55[L] && net(buy, sell) < 0) {
      sell += 1; reasons.push("EMA역배열 동조");
    }
  }

  // false breakout 방어: 돌파인데 거래량 약하면 통과 안 시킴
  if ((breakHigh20 || breakLow20) && volMult < 1.2) {
    return null;
  }

  const netScore = buy - sell;
  const absNet = Math.abs(netScore);
  if (absNet < MIN_ABS_NET) return null; // 돌파는 강한 합의만 진입

  const side = netScore > 0 ? "LONG" : "SHORT";
  return {
    side,
    score: scaleScore(absNet),
    confidence: gradeConfidence(absNet),
    family: FAMILY,
    timeframe,
    reason: `[${timeframe}|breakout] ` + reasons.join(" + "),
    sizeHint: Math.max(0.4, Math.min(0.9, absNet / 9)),
    type: side === "LONG" ? "BUY" : "SELL",
    positionSize: Math.max(0.4, Math.min(0.9, absNet / 9)),
  };
}

// 헬퍼: 점수 net 계산 (가독성용)
function net(b, s) { return b - s; }

export default { runBreakout, FAMILY };
