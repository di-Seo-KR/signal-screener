// api/_shared/exit-signals.js
//
// 다중 timeframe 청산 신호 평가기 (2026-05-17 — QUANT-PLAN).
//
// 대표 보고:
//   "매도 시점은 1시간봉/주봉 등 RSI도 어느 정도 반영되고, 이외에도 기타 로직으로
//    매도 타점을 계속해서 산출하는 방식으로 가는게 맞는 거 같애... 벌때는 잘 버는데,
//    장이 하락할때는 손을 못 쓸정도로 하락하는 거 같아서."
//
// 동작:
//   1) position-monitor 가 매 cron (3분) 마다 각 open position 의 1h/4h klines 를
//      가져와 RSI/MACD/ATR/EMA 등 지표 계산.
//   2) LONG/SHORT 별로 5개 청산 시그널 평가 → 일치하는 시그널 개수 (confidence).
//   3) confidence >= 2 → 즉시 시장가 청산 (강한 신호).
//      confidence == 1 → plan KV 에 exitWatch 마킹 (다음 cron 에서 재평가).
//
// 시그널 종류 (LONG 기준 — SHORT 은 부호 반대):
//   A. mtfRsiOverbought:  1h RSI > 75 AND 4h RSI > 70
//   B. macdBearishCross:  1h MACD < signal AND close < EMA21
//   C. atrExpansion:      ATR/price > 1.5x 평소 + close < EMA50
//   D. regimeFlip:        진입 시 trending → 현재 mean_reverting (or transitional)
//   E. profitLockTrail:   ROI > 5% 후 peak 대비 -30% 회수
//
// 외부 의존:
//   - getKlines (binance-client)
//   - computeIndicatorBundle (_shared/strategies/_indicators)
// position-monitor 는 plan KV 의 highWater / entryPrice / openedAt / regime 만 읽어 넘김.

import { getKlines } from "./binance-client.js";
import { calcRSI, calcEMA, calcMACD, calcATR } from "./strategies/_indicators.js";

// klines → close/high/low 배열
function klinesToSeries(klines) {
  const closes = [];
  const highs = [];
  const lows = [];
  for (const k of klines || []) {
    const c = parseFloat(k[4]); const h = parseFloat(k[2]); const l = parseFloat(k[3]);
    if (Number.isFinite(c) && Number.isFinite(h) && Number.isFinite(l)) {
      closes.push(c); highs.push(h); lows.push(l);
    }
  }
  return { closes, highs, lows };
}

// 각 timeframe 의 핵심 지표 한 번에 계산
async function fetchTfIndicators(symbol, interval, limit = 120) {
  const klines = await getKlines({ symbol, interval, limit });
  const { closes, highs, lows } = klinesToSeries(klines);
  if (closes.length < 60) {
    return null;
  }
  const rsi = calcRSI(closes, 14);
  const macd = calcMACD(closes, 12, 26, 9);
  const ema21 = calcEMA(closes, 21);
  const ema50 = calcEMA(closes, 50);
  const atr = calcATR(highs, lows, closes, 14);
  const last = closes.length - 1;

  // ATR 평균 (직전 50 봉) — 현재 ATR/price 비 vs 평소 비 비교용
  let avgAtrPct = null;
  const window = Math.min(50, last);
  if (window >= 14) {
    let sum = 0; let n = 0;
    for (let i = last - window + 1; i <= last; i++) {
      if (atr[i] != null && closes[i] > 0) { sum += atr[i] / closes[i]; n += 1; }
    }
    avgAtrPct = n > 0 ? sum / n : null;
  }
  return {
    close: closes[last],
    rsi: rsi[last],
    macd: macd.macdLine[last],
    macdSig: macd.signal[last],
    ema21: ema21[last],
    ema50: ema50[last],
    atr: atr[last],
    atrPct: atr[last] != null && closes[last] > 0 ? atr[last] / closes[last] : null,
    avgAtrPct,
  };
}

/**
 * 다중 timeframe 청산 신호 평가.
 *
 * @param {object} args
 * @param {string} args.symbol         "BTCUSDT" 등
 * @param {string} args.side           "LONG" | "SHORT"
 * @param {number} args.entryPrice
 * @param {number} args.markPrice
 * @param {number} [args.highWater]    포지션 진입 후 최고가(LONG) / 최저가(SHORT)
 * @param {object} [args.entryRegime]  진입 시 regime 스냅샷 ({ regime: "trending"|... })
 * @returns {Promise<{ shouldClose: boolean, confidence: number, reasons: string[], details: object, watchOnly?: boolean }>}
 */
export async function evaluateMtfExitSignals({ symbol, side, entryPrice, markPrice, highWater, entryRegime } = {}) {
  if (!symbol || !side || !entryPrice || !markPrice) {
    return { shouldClose: false, confidence: 0, reasons: ["missing args"], details: {} };
  }

  // 1h + 4h indicators 병렬 fetch
  let h1 = null;
  let h4 = null;
  try {
    [h1, h4] = await Promise.all([
      fetchTfIndicators(symbol, "1h", 120),
      fetchTfIndicators(symbol, "4h", 120),
    ]);
  } catch (e) {
    return { shouldClose: false, confidence: 0, reasons: [`mtf fetch failed: ${e?.message}`], details: {} };
  }
  if (!h1 || !h4) {
    return { shouldClose: false, confidence: 0, reasons: ["mtf indicators not available"], details: { h1, h4 } };
  }

  const reasons = [];
  const isLong = side === "LONG";

  // A. mtfRsiOverbought / oversold
  if (isLong) {
    if (h1.rsi != null && h4.rsi != null && h1.rsi > 75 && h4.rsi > 70) {
      reasons.push(`mtfRsiOverbought: 1h RSI ${h1.rsi.toFixed(1)} > 75 & 4h RSI ${h4.rsi.toFixed(1)} > 70`);
    }
  } else {
    if (h1.rsi != null && h4.rsi != null && h1.rsi < 25 && h4.rsi < 30) {
      reasons.push(`mtfRsiOversold: 1h RSI ${h1.rsi.toFixed(1)} < 25 & 4h RSI ${h4.rsi.toFixed(1)} < 30`);
    }
  }

  // B. macdBearishCross / bullishCross
  if (h1.macd != null && h1.macdSig != null && h1.ema21 != null) {
    if (isLong && h1.macd < h1.macdSig && markPrice < h1.ema21) {
      reasons.push(`macdBearishCross: 1h MACD ${h1.macd.toFixed(4)} < signal ${h1.macdSig.toFixed(4)} & close < EMA21`);
    }
    if (!isLong && h1.macd > h1.macdSig && markPrice > h1.ema21) {
      reasons.push(`macdBullishCross: 1h MACD ${h1.macd.toFixed(4)} > signal ${h1.macdSig.toFixed(4)} & close > EMA21`);
    }
  }

  // C. atrExpansion + close beyond ema50 (LONG: close < ema50, SHORT: close > ema50)
  if (h1.atrPct != null && h1.avgAtrPct != null && h1.ema50 != null && h1.avgAtrPct > 0) {
    const expansion = h1.atrPct / h1.avgAtrPct;
    if (expansion >= 1.5) {
      if (isLong && markPrice < h1.ema50) {
        reasons.push(`atrExpansion+weakness: ATR ${(h1.atrPct*100).toFixed(2)}% (${expansion.toFixed(2)}x 평소) & close < EMA50`);
      }
      if (!isLong && markPrice > h1.ema50) {
        reasons.push(`atrExpansion+rebound: ATR ${(h1.atrPct*100).toFixed(2)}% (${expansion.toFixed(2)}x 평소) & close > EMA50`);
      }
    }
  }

  // D. regimeFlip — 진입 시 trending → 지금 mean_reverting (혹은 transitional)
  if (entryRegime?.regime === "trending") {
    try {
      const kvMod = await import("@vercel/kv");
      const currentRegime = await kvMod.kv.get("di:market:regime");
      if (currentRegime?.regime && currentRegime.regime !== "trending") {
        reasons.push(`regimeFlip: trending → ${currentRegime.regime} (avgHurst ${currentRegime.avgHurst?.toFixed?.(2) ?? "?"})`);
      }
    } catch { /* KV 미연동 환경 무시 */ }
  }

  // E. profitLockTrail — ROI > 5% 후 peak 대비 -30% 회수
  let roi = 0;
  if (entryPrice > 0) {
    roi = isLong
      ? (markPrice - entryPrice) / entryPrice
      : (entryPrice - markPrice) / entryPrice;
  }
  if (Number.isFinite(highWater) && highWater !== entryPrice) {
    const peakRoi = isLong
      ? (highWater - entryPrice) / entryPrice
      : (entryPrice - highWater) / entryPrice;
    if (peakRoi >= 0.05 && roi > 0) {
      const giveback = (peakRoi - roi) / peakRoi; // 0~1
      if (giveback >= 0.30) {
        reasons.push(`profitLockTrail: peak ROI ${(peakRoi*100).toFixed(2)}% → now ${(roi*100).toFixed(2)}% (giveback ${(giveback*100).toFixed(0)}%)`);
      }
    }
  }

  const confidence = reasons.length;
  // 보수성: confidence >= 2 만 즉시 청산. 1이면 watch-only (다음 cron 에서 재평가).
  const shouldClose = confidence >= 2;
  const watchOnly = confidence === 1;

  return {
    shouldClose,
    watchOnly,
    confidence,
    reasons,
    details: {
      h1: { rsi: h1.rsi, macd: h1.macd, macdSig: h1.macdSig, ema21: h1.ema21, ema50: h1.ema50, atrPct: h1.atrPct, avgAtrPct: h1.avgAtrPct },
      h4: { rsi: h4.rsi },
      roi,
    },
  };
}

export default { evaluateMtfExitSignals };
