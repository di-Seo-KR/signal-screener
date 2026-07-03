// ════════════════════════════════════════════════════════
// Strategy: supertrend (2026-06-02 신규)
// ────────────────────────────────────────────────────────
// ATR 밴드 기반 추세 추종. EMA 크로스(trend-follow)와 *다른 방식*으로 추세를
// 잡는다 — 가격이 ATR 밴드(hl2 ± mult×ATR)를 기준으로 추세 방향을 토글.
// EMA 가 놓치는 변동성 기반 추세 전환을 포착 → trend-follow 와 상관 낮춤(다양화).
//
// LONG  — supertrend 상승 전환(가격이 상단밴드 위 안착)
// SHORT — supertrend 하락 전환
// 추세 계열이므로 refineSignalScore(상관완화+반전감지) 적용.
// ════════════════════════════════════════════════════════

import { computeIndicatorBundle, refineSignalScore } from "./_indicators.js";

const FAMILY = "supertrend";
const MIN_BARS = 60;

// Supertrend 계산 — 표준 알고리즘 (ATR 밴드 + 추세 방향 토글).
function computeSupertrend(highs, lows, closes, atr, mult) {
  const n = closes.length;
  const dir = new Array(n).fill(1);    // 1=상승추세, -1=하락추세
  const stLine = new Array(n).fill(null);
  let prevUpper = null, prevLower = null, prevDir = 1, prevST = null;
  for (let i = 0; i < n; i++) {
    const a = atr[i];
    if (a == null) { dir[i] = prevDir; continue; }
    const hl2 = (highs[i] + lows[i]) / 2;
    let upper = hl2 + mult * a;
    let lower = hl2 - mult * a;
    // 밴드 잠금(표준): 추세 유지 중엔 밴드가 한 방향으로만 조여짐
    if (prevUpper != null && (upper > prevUpper && closes[i - 1] <= prevUpper)) upper = prevUpper;
    if (prevLower != null && (lower < prevLower && closes[i - 1] >= prevLower)) lower = prevLower;
    let d = prevDir;
    if (prevST != null) {
      if (prevDir === 1 && closes[i] < prevLower) d = -1;
      else if (prevDir === -1 && closes[i] > prevUpper) d = 1;
    }
    dir[i] = d;
    stLine[i] = d === 1 ? lower : upper;
    prevUpper = upper; prevLower = lower; prevDir = d; prevST = stLine[i];
  }
  return { dir, stLine };
}

export function runSupertrend({ closes, highs, lows, volumes, asset, timeframe = "1d", params = null, opens = null, lastBarClosed = true }) {
  if (!closes || closes.length < MIN_BARS) return null;
  const P = params || {};
  const ATR_PERIOD  = P.ATR_PERIOD  ?? 10;
  const ST_MULT     = P.ST_MULT     ?? 3.0;
  const ADX_MIN     = P.ADX_MIN     ?? 18;
  const MIN_ABS_NET = P.MIN_ABS_NET ?? 2;

  const ind = computeIndicatorBundle({ closes, highs, lows, volumes }, { ATR_PERIOD });
  const L = closes.length - 1;
  const price = closes[L];
  const { dir, stLine } = computeSupertrend(highs, lows, closes, ind.atr, ST_MULT);

  const adx = ind.adx[L] || 0;
  if (adx < ADX_MIN) return null; // 추세 미성숙 보류

  const reasons = [`ST×${ST_MULT}`, `ADX${adx.toFixed(0)}`];
  let buy = 0, sell = 0;

  // supertrend 방향 (핵심 3점)
  if (dir[L] === 1) { buy += 3; reasons.push("ST상승추세"); }
  else { sell += 3; reasons.push("ST하락추세"); }

  // 추세 전환 신선도 (최근 3봉 내 토글 = 진입 적기, 2점)
  let flipBarsAgo = 99;
  for (let k = 1; k <= 5 && L - k >= 0; k++) { if (dir[L - k] !== dir[L]) { flipBarsAgo = k; break; } }
  if (flipBarsAgo <= 3) {
    if (dir[L] === 1) { buy += 2; reasons.push(`상승전환${flipBarsAgo}봉전`); }
    else { sell += 2; reasons.push(`하락전환${flipBarsAgo}봉전`); }
  }

  // EMA200 장기 필터 (1점)
  const ema200 = ind.ema200[L];
  if (ema200 != null) {
    if (price > ema200) { buy += 1; reasons.push("EMA200위"); }
    else { sell += 1; reasons.push("EMA200아래"); }
  }

  // MACD 모멘텀 동조 (1점)
  const macd = ind.macdLine[L], macdSig = ind.macdSig[L];
  if (macd != null && macdSig != null) {
    if (macd > macdSig) { buy += 1; reasons.push("MACD↑"); }
    else { sell += 1; reasons.push("MACD↓"); }
  }

  // 거래량 동반 (1점)
  const volMult = ind.volSMA[L] > 0 && volumes[L] != null ? volumes[L] / ind.volSMA[L] : 1;
  if (volMult > 1.3) {
    if (dir[L] === 1) { buy += 1; reasons.push(`거래량${volMult.toFixed(1)}x`); }
    else { sell += 1; reasons.push(`거래량${volMult.toFixed(1)}x`); }
  }

  // 추세 계열 정제 (상관완화 + 반전/소진 감지)
  const refined = refineSignalScore({ buy, sell, ind, closes, volumes, L, opens, highs, lows, tf: timeframe, lastBarClosed });
  if (refined.absNet < MIN_ABS_NET) return null;
  if (refined.notes.length) reasons.push(...refined.notes);

  const side = refined.side;
  const sz = Math.max(0.3, Math.min(0.9, refined.absNet / 9));
  return {
    side,
    score: refined.score,
    confidence: refined.confidence,
    family: FAMILY,
    timeframe,
    reason: `[${timeframe}|supertrend] ` + reasons.join(" + "),
    sizeHint: sz,
    type: side === "LONG" ? "BUY" : "SELL",
    positionSize: sz,
  };
}

export default { runSupertrend, FAMILY };
