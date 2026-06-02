// ════════════════════════════════════════════════════════
// Strategy: momentum-rotation
// 봇: crypto-diversity (전체 16자산 올웨더)
// ────────────────────────────────────────────────────────
// 핵심 아이디어: 상대 강도 + 모멘텀 정렬. 한 자산 안에서 보는 모멘텀이
// 임계 이상이면 LONG. 다자산 분산 봇용 — 강한 자산만 골라잡는 회전식.
//
// 진입 조건:
//   LONG  — 30일 수익률 > 0 + RSI 50~75 + EMA21>55 + 거래량 안정
//   SHORT — 30일 수익률 < 0 + RSI 25~50 + EMA21<55
//   극단(RSI>80, <20) 은 회피 (이미 늦은 추격 위험)
// ════════════════════════════════════════════════════════

import { computeIndicatorBundle, gradeConfidence, scaleScore, refineSignalScore } from "./_indicators.js";

const FAMILY = "momentum";
const MIN_BARS = 60;

export function runMomentumRotation({ closes, highs, lows, volumes, asset, timeframe = "1d", params = null }) {
  if (!closes || closes.length < MIN_BARS) return null;
  // ★ 2026-05-29 — 튜닝 파라미터 주입 (없으면 기존 하드코딩 값 그대로).
  const P = params || {};
  const LOOKBACK_DAYS = P.LOOKBACK_DAYS ?? 30;
  const MIN_ABS_NET   = P.MIN_ABS_NET   ?? 3;
  const ind = computeIndicatorBundle({ closes, highs, lows, volumes });
  const L = closes.length - 1;
  const price = closes[L];

  // 장기/14일/7일 수익률 (모멘텀 코어) — 장기 구간은 LOOKBACK_DAYS 로 조정
  const back30 = closes[Math.max(0, L - LOOKBACK_DAYS)];
  const back14 = closes[Math.max(0, L - 14)];
  const back7 = closes[Math.max(0, L - 7)];
  const ret30 = back30 > 0 ? (price / back30 - 1) * 100 : 0;
  const ret14 = back14 > 0 ? (price / back14 - 1) * 100 : 0;
  const ret7 = back7 > 0 ? (price / back7 - 1) * 100 : 0;

  const rsi = ind.rsi[L];
  const ema21 = ind.ema21[L];
  const ema55 = ind.ema55[L];

  const reasons = [`30일 ${ret30.toFixed(1)}%`, `14일 ${ret14.toFixed(1)}%`];
  let buy = 0, sell = 0;

  // 다기간 수익률 합의 (핵심 3점)
  const upAlign = ret30 > 0 && ret14 > 0 && ret7 > 0;
  const downAlign = ret30 < 0 && ret14 < 0 && ret7 < 0;
  if (upAlign) { buy += 3; reasons.push("모멘텀 정렬↑"); }
  if (downAlign) { sell += 3; reasons.push("모멘텀 정렬↓"); }

  // RSI 50~75 (sweet spot) — 강세지속 (2점)
  if (rsi != null) {
    if (rsi >= 50 && rsi <= 75) { buy += 2; reasons.push(`RSI${rsi.toFixed(0)} 강세대`); }
    else if (rsi >= 25 && rsi <= 50) { sell += 2; reasons.push(`RSI${rsi.toFixed(0)} 약세대`); }
    // 극단은 진입 회피 (추격 위험)
    else if (rsi > 80) { sell += 1; reasons.push(`RSI${rsi.toFixed(0)} 과열주의`); }
    else if (rsi < 20) { buy += 1; reasons.push(`RSI${rsi.toFixed(0)} 극단저점`); }
  }

  // EMA 정배열 확인 (2점)
  if (ema21 != null && ema55 != null) {
    if (ema21 > ema55) { buy += 2; reasons.push("EMA정배열"); }
    else { sell += 2; reasons.push("EMA역배열"); }
  }

  // ROC 가속도 (1점) — 7일 > 14일 평균이면 단기 가속
  const acc = ret7 - ret14 / 2;
  if (acc > 3) { buy += 1; reasons.push(`단기 가속 +${acc.toFixed(1)}%`); }
  if (acc < -3) { sell += 1; reasons.push(`단기 감속 ${acc.toFixed(1)}%`); }

  // ER (효율성 비율) — 모멘텀 회전에 가장 적합한 환경 (1점)
  const curER = ind.er[ind.er.length - 1] || 0;
  if (curER > 0.45) {
    if (ret14 > 0) { buy += 1; reasons.push(`ER${curER.toFixed(2)} 효율↑`); }
    else { sell += 1; reasons.push(`ER${curER.toFixed(2)} 효율↓`); }
  }

  // ★ 2026-06-02 — 알파 정제 레이어 (과확장·다이버전스·극단RSI·거래량·breadth 캡)
  const refined = refineSignalScore({ buy, sell, ind, closes, volumes, L });
  if (refined.absNet < MIN_ABS_NET) return null; // 회전 전략은 명확한 모멘텀 필요
  if (refined.notes.length) reasons.push(...refined.notes);

  const side = refined.side;
  const sz = Math.max(0.3, Math.min(0.8, refined.absNet / 9));
  return {
    side,
    score: refined.score,
    confidence: refined.confidence,
    family: FAMILY,
    timeframe,
    reason: `[${timeframe}|momentum-rotation] ` + reasons.join(" + "),
    sizeHint: sz,
    type: side === "LONG" ? "BUY" : "SELL",
    positionSize: sz,
  };
}

export default { runMomentumRotation, FAMILY };
