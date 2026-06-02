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

import { computeIndicatorBundle, gradeConfidence, scaleScore, refineSignalScore } from "./_indicators.js";

const FAMILY = "hurst-trend"; // ★ 2026-06-02 "trend"→canonical (trend-follow 로 흡수되던 것 분리)
const MIN_BARS = 80;

export function runHurstTrend({ closes, highs, lows, volumes, asset, timeframe = "1d", params = null }) {
  if (!closes || closes.length < MIN_BARS) return null;
  // ★ 2026-05-29 — 튜닝 파라미터 주입 (없으면 기존 하드코딩 값 그대로).
  const P = params || {};
  const HURST_TREND_MIN  = P.HURST_TREND_MIN  ?? 0.55;
  const HURST_REVERT_MAX = P.HURST_REVERT_MAX ?? 0.50;
  const MIN_ABS_NET      = P.MIN_ABS_NET      ?? 3;
  const ind = computeIndicatorBundle({ closes, highs, lows, volumes });
  const L = closes.length - 1;
  const price = closes[L];
  const prev5 = closes[Math.max(0, L - 5)];

  const hurst = ind.hurst;
  const adx = ind.adx[L] || 0;
  const ema21 = ind.ema21[L];
  const ema55 = ind.ema55[L];

  // ★ 2026-06-02 게이트 갭 수정: 기존 HURST_REVERT_MAX(0.50) 게이트는 [0.50,0.55]
  //   전환구간을 통과시키는데 정작 Hurst 점수는 >0.55 부터라, 그 구간은 Hurst 우위
  //   없이 신호가 났음. 추세 우위(≥HURST_TREND_MIN)에서만 진입하도록 게이트 상향.
  if (hurst < HURST_TREND_MIN) {
    return null;
  }

  const reasons = [`Hurst ${hurst.toFixed(2)}`, `ADX ${adx.toFixed(0)}`];
  let buy = 0, sell = 0;

  // Hurst 강도 기반 핵심 점수 (최대 3점)
  if (hurst > HURST_TREND_MIN + 0.05) {
    // 매우 강한 추세 지속 성향
    if (price > prev5) { buy += 3; reasons.push("강한 추세지속↑"); }
    else { sell += 3; reasons.push("강한 추세지속↓"); }
  } else if (hurst > HURST_TREND_MIN) {
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

  // ★ 2026-06-02 — 알파 정제 레이어 (과확장·다이버전스·극단RSI·거래량·breadth 캡)
  const refined = refineSignalScore({ buy, sell, ind, closes, volumes, L });
  if (refined.absNet < MIN_ABS_NET) return null;
  if (refined.notes.length) reasons.push(...refined.notes);

  const side = refined.side;
  const sz = Math.max(0.4, Math.min(0.9, refined.absNet / 9));
  return {
    side,
    score: refined.score,
    confidence: refined.confidence,
    family: FAMILY,
    timeframe,
    reason: `[${timeframe}|hurst-trend] ` + reasons.join(" + "),
    sizeHint: sz,
    type: side === "LONG" ? "BUY" : "SELL",
    positionSize: sz,
  };
}

export default { runHurstTrend, FAMILY };
