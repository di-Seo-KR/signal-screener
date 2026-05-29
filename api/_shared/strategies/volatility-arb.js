// ════════════════════════════════════════════════════════
// Strategy: volatility-arb (변동성 압축-폭발 알파)
// 봇: crypto-swing (전 코인 단기 스윙, 고변동성 집중)
// ────────────────────────────────────────────────────────
// 핵심 아이디어: ATR 압축(squeeze) 이후의 폭발(expansion) 구간을 잡는다.
// 볼린저 밴드 폭 + ATR 의 단·장기 비교로 압축 상태를 식별,
// 폭발 시작 방향으로 진입.
//
// 진입 조건:
//   LONG  — BB 폭 좁아진 후 상단 돌파 + ATR 폭발 + 가격 양봉
//   SHORT — BB 폭 좁아진 후 하단 이탈 + ATR 폭발 + 가격 음봉
// ════════════════════════════════════════════════════════

import { computeIndicatorBundle, gradeConfidence, scaleScore, calcSMA } from "./_indicators.js";

const FAMILY = "volatility";
const MIN_BARS = 60;

export function runVolatilityArb({ closes, highs, lows, volumes, asset, timeframe = "1d", params = null }) {
  if (!closes || closes.length < MIN_BARS) return null;
  // ★ 2026-05-29 — 튜닝 파라미터 주입 (없으면 기존 하드코딩 값 그대로).
  const P = params || {};
  const BB_SQUEEZE  = P.BB_SQUEEZE_THRESHOLD ?? 0.08;
  const MIN_ABS_NET = P.MIN_ABS_NET          ?? 3;
  const ind = computeIndicatorBundle({ closes, highs, lows, volumes }, {
    ATR_PERIOD: P.ATR_PERIOD, BB_PERIOD: P.BB_PERIOD,
  });
  const L = closes.length - 1;
  const price = closes[L];
  const prev = closes[L - 1] || price;

  const bb = ind.bb[L];
  const bbPrev = ind.bb[L - 5]; // 5봉 전 BB 폭
  if (!bb || !bbPrev) return null;

  const atr = ind.atr;
  const atrLongMA = calcSMA(atr.map(v => v || 0), 50);
  const curAtr = atr[L] || 0;
  const atrMA = atrLongMA[atrLongMA.length - 1] || 1;
  const atrRatio = atrMA > 0 ? curAtr / atrMA : 1;

  const reasons = [];
  let buy = 0, sell = 0;

  // BB 폭 압축 → 폭발 패턴 (핵심)
  // bw = (upper-lower) / middle. 5봉 전 대비 현재 폭이 1.3배 이상이면 폭발 시작
  const bwExpansion = bbPrev.bw > 0 ? bb.bw / bbPrev.bw : 1;
  const compressedBefore = bbPrev.bw < BB_SQUEEZE; // 압축 기준 (BTC 일봉 기준)
  const expandingNow = bwExpansion > 1.3;

  if (compressedBefore && expandingNow) {
    // 압축 후 폭발: 방향성에 강한 가중
    if (price > bb.upper) { buy += 4; reasons.push("BB 압축→상단 돌파!"); }
    else if (price < bb.lower) { sell += 4; reasons.push("BB 압축→하단 이탈!"); }
    else if (price > prev) { buy += 2; reasons.push("BB 압축→양봉 발산"); }
    else if (price < prev) { sell += 2; reasons.push("BB 압축→음봉 발산"); }
    reasons.push(`BB폭 ${(bbPrev.bw * 100).toFixed(1)}%→${(bb.bw * 100).toFixed(1)}%`);
  } else if (atrRatio > 1.8) {
    // 압축은 없지만 ATR 가 강한 expansion: 약한 폭발 시그널
    if (price > prev) { buy += 2; reasons.push(`ATR폭발 ${atrRatio.toFixed(1)}x↑`); }
    else { sell += 2; reasons.push(`ATR폭발 ${atrRatio.toFixed(1)}x↓`); }
  } else {
    // 아무 폭발 시그널 없으면 보류
    return null;
  }

  // 거래량 확인 (2점) — 진성 변동성 폭발은 거래량 동반
  const volAvg = ind.volSMA[L];
  if (volAvg && volAvg > 0) {
    const volMult = volumes[L] / volAvg;
    if (volMult > 1.5) {
      if (price > prev) { buy += 2; reasons.push(`거래량 ${volMult.toFixed(1)}x`); }
      else { sell += 2; reasons.push(`거래량 ${volMult.toFixed(1)}x`); }
    }
  }

  // Hurst 보조 (1점) — H 0.5 근처면 양방향 폭발 가능
  const hurst = ind.hurst;
  if (hurst > 0.45 && hurst < 0.6) {
    if (price > prev) { buy += 1; reasons.push(`H${hurst.toFixed(2)} 중립폭발`); }
    else { sell += 1; reasons.push(`H${hurst.toFixed(2)} 중립폭발`); }
  }

  const netScore = buy - sell;
  const absNet = Math.abs(netScore);
  if (absNet < MIN_ABS_NET) return null; // 변동성 진입은 강한 합의 요구

  const side = netScore > 0 ? "LONG" : "SHORT";
  return {
    side,
    score: scaleScore(absNet),
    confidence: gradeConfidence(absNet),
    family: FAMILY,
    timeframe,
    reason: `[${timeframe}|volatility-arb] ` + reasons.join(" + "),
    sizeHint: Math.max(0.3, Math.min(0.7, absNet / 10)), // 변동성 큰 만큼 작게 진입
    type: side === "LONG" ? "BUY" : "SELL",
    positionSize: Math.max(0.3, Math.min(0.7, absNet / 10)),
  };
}

export default { runVolatilityArb, FAMILY };
