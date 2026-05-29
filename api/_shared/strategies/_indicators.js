// ════════════════════════════════════════════════════════
// Zepta — 전략 모듈 공통 지표 라이브러리
// ────────────────────────────────────────────────────────
// btc-cron.js 의 calcRSI/calcEMA/... 와 동일한 식으로 분리.
// strategy 모듈이 순수 함수가 되도록 (KV/네트워크 의존 0) 공유 dependency.
// ════════════════════════════════════════════════════════

export function calcSMA(data, period) {
  const result = new Array(data.length).fill(null);
  for (let i = period - 1; i < data.length; i++) {
    let sum = 0;
    for (let j = 0; j < period; j++) sum += data[i - j];
    result[i] = sum / period;
  }
  return result;
}

export function calcEMA(data, period) {
  const result = new Array(data.length).fill(null);
  const k = 2 / (period + 1);
  let start = -1;
  for (let i = 0; i < data.length; i++) { if (data[i] != null) { start = i; break; } }
  if (start < 0 || data.length - start < period) return result;
  let sum = 0;
  for (let i = start; i < start + period; i++) sum += data[i];
  result[start + period - 1] = sum / period;
  for (let i = start + period; i < data.length; i++) {
    result[i] = data[i] * k + result[i - 1] * (1 - k);
  }
  return result;
}

export function calcRSI(closes, period = 14) {
  const result = new Array(closes.length).fill(null);
  if (closes.length < period + 1) return result;
  let gainSum = 0, lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gainSum += d; else lossSum -= d;
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  result[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + (d > 0 ? d : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (d < 0 ? -d : 0)) / period;
    result[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return result;
}

export function calcBB(closes, period = 20, mult = 2) {
  const result = new Array(closes.length).fill(null);
  const sma = calcSMA(closes, period);
  for (let i = period - 1; i < closes.length; i++) {
    if (sma[i] == null) continue;
    let sqSum = 0;
    for (let j = 0; j < period; j++) sqSum += (closes[i - j] - sma[i]) ** 2;
    const std = Math.sqrt(sqSum / period);
    const upper = sma[i] + std * mult;
    const lower = sma[i] - std * mult;
    result[i] = { middle: sma[i], upper, lower, bw: sma[i] > 0 ? (upper - lower) / sma[i] : 0 };
  }
  return result;
}

export function calcMACD(closes, fast = 12, slow = 26, sig = 9) {
  const emaFast = calcEMA(closes, fast);
  const emaSlow = calcEMA(closes, slow);
  const macdLine = closes.map((_, i) => (emaFast[i] != null && emaSlow[i] != null) ? emaFast[i] - emaSlow[i] : null);
  const signal = calcEMA(macdLine.map(v => v ?? 0), sig);
  const histogram = closes.map((_, i) => (macdLine[i] != null && signal[i] != null) ? macdLine[i] - signal[i] : null);
  return { macdLine, signal, histogram };
}

export function calcATR(highs, lows, closes, period = 14) {
  const tr = [highs[0] - lows[0]];
  for (let i = 1; i < closes.length; i++) {
    tr.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
  }
  return calcEMA(tr, period);
}

export function calcADX(highs, lows, closes, period = 14) {
  const len = closes.length;
  const result = new Array(len).fill(null);
  if (len < period * 2) return result;
  const tr = [0];
  const plusDM = [0];
  const minusDM = [0];
  for (let i = 1; i < len; i++) {
    tr.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
    const up = highs[i] - highs[i - 1];
    const down = lows[i - 1] - lows[i];
    plusDM.push(up > down && up > 0 ? up : 0);
    minusDM.push(down > up && down > 0 ? down : 0);
  }
  const smoothTR = calcEMA(tr, period);
  const smoothPlus = calcEMA(plusDM, period);
  const smoothMinus = calcEMA(minusDM, period);
  const dx = [];
  for (let i = 0; i < len; i++) {
    if (smoothTR[i] && smoothTR[i] > 0) {
      const pdi = (smoothPlus[i] / smoothTR[i]) * 100;
      const mdi = (smoothMinus[i] / smoothTR[i]) * 100;
      const sum = pdi + mdi;
      dx.push(sum > 0 ? (Math.abs(pdi - mdi) / sum) * 100 : 0);
    } else dx.push(0);
  }
  const adxSmooth = calcEMA(dx, period);
  for (let i = 0; i < len; i++) result[i] = adxSmooth[i];
  return result;
}

export function calcStochastic(highs, lows, closes, kPeriod = 14, dPeriod = 3) {
  const k = new Array(closes.length).fill(null);
  for (let i = kPeriod - 1; i < closes.length; i++) {
    let hh = -Infinity, ll = Infinity;
    for (let j = 0; j < kPeriod; j++) {
      hh = Math.max(hh, highs[i - j]);
      ll = Math.min(ll, lows[i - j]);
    }
    k[i] = hh !== ll ? ((closes[i] - ll) / (hh - ll)) * 100 : 50;
  }
  const d = calcSMA(k.map(v => v ?? 50), dPeriod);
  return { k, d };
}

export function calcOBV(closes, volumes) {
  const obv = [0];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i] > closes[i - 1]) obv.push(obv[i - 1] + (volumes[i] || 0));
    else if (closes[i] < closes[i - 1]) obv.push(obv[i - 1] - (volumes[i] || 0));
    else obv.push(obv[i - 1]);
  }
  return obv;
}

// Hurst 지수 (R/S 분석). H > 0.5 = 추세 지속, H < 0.5 = 평균회귀.
export function calcHurst(data) {
  const n = data.length;
  if (n < 20) return 0.5;
  const logReturns = [];
  for (let i = 1; i < n; i++) {
    if (data[i] > 0 && data[i - 1] > 0) logReturns.push(Math.log(data[i] / data[i - 1]));
  }
  if (logReturns.length < 10) return 0.5;
  const mean = logReturns.reduce((a, b) => a + b, 0) / logReturns.length;
  const deviations = logReturns.map(r => r - mean);
  const cumDev = []; let cum = 0;
  for (const d of deviations) { cum += d; cumDev.push(cum); }
  const R = Math.max(...cumDev) - Math.min(...cumDev);
  const S = Math.sqrt(deviations.reduce((a, b) => a + b * b, 0) / deviations.length);
  if (S === 0) return 0.5;
  return Math.log(R / S) / Math.log(logReturns.length);
}

// Kaufman 효율성 비율: 1 = 완벽한 추세, 0 = 무방향 노이즈
export function calcEfficiencyRatio(closes, period = 10) {
  const er = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < period) { er.push(0); continue; }
    const direction = Math.abs(closes[i] - closes[i - period]);
    let volatility = 0;
    for (let j = 1; j <= period; j++) volatility += Math.abs(closes[i - j + 1] - closes[i - j]);
    er.push(volatility > 0 ? direction / volatility : 0);
  }
  return er;
}

// ────────────────────────────────────────────────────────
// 공통 헬퍼: 지표 묶음 한 번에 계산
// strategy 모듈이 매번 같은 지표 재계산하지 않도록 한 번 만들어서 넘김.
// ────────────────────────────────────────────────────────
// cfg: 선택적 기간/배수 override (param-tuner / 발굴된 후보 파라미터 주입용).
//   비우면 모든 값이 기존 하드코딩과 동일 → 동작 불변 (default-preserving).
//   ema21/ema55 필드명은 호환 위해 유지하되 실제 기간은 EMA_FAST/EMA_SLOW 를 따른다.
export function computeIndicatorBundle({ closes, highs, lows, volumes }, cfg = {}) {
  const rsiP   = cfg.RSI_PERIOD   || 14;
  const bbP    = cfg.BB_PERIOD    || 20;
  const bbMult = cfg.BB_MULT      || 2.0;
  const emaF   = cfg.EMA_FAST     || 21;
  const emaS   = cfg.EMA_SLOW     || 55;
  const adxP   = cfg.ADX_PERIOD   || 14;
  const atrP   = cfg.ATR_PERIOD   || 14;
  const obvP   = cfg.OBV_LOOKBACK || 20;
  const rsi = calcRSI(closes, rsiP);
  const bb = calcBB(closes, bbP, bbMult);
  const ema21 = calcEMA(closes, emaF);
  const ema55 = calcEMA(closes, emaS);
  const ema200 = closes.length > 200 ? calcEMA(closes, 200) : new Array(closes.length).fill(null);
  const macd = calcMACD(closes);
  const adx = calcADX(highs, lows, closes, adxP);
  const atr = calcATR(highs, lows, closes, atrP);
  const stoch = calcStochastic(highs, lows, closes, 14, 3);
  const obv = calcOBV(closes, volumes || []);
  const obvEma = calcEMA(obv, obvP);
  const volSMA = calcSMA(volumes || [], 20);
  const hurst = calcHurst(closes.slice(-100));
  const er = calcEfficiencyRatio(closes, 10);
  return {
    rsi, bb, ema21, ema55, ema200,
    macdLine: macd.macdLine, macdSig: macd.signal, histogram: macd.histogram,
    adx, atr, stoch, obv, obvEma, volSMA,
    hurst, er,
  };
}

// 신호 강도 → confidence 등급 변환 (공통 규칙)
//   absNet 6+: A (강한 확신, 5+ 인디케이터 합의)
//   absNet 3-5: B (중간)
//   absNet 1-2: C (약함)
export function gradeConfidence(absNet) {
  if (absNet >= 6) return "A";
  if (absNet >= 3) return "B";
  return "C";
}

// 0~100 점수로 정규화 (기존 호환): absNet 7+ → 95, 1 → 50
export function scaleScore(absNet) {
  // absNet 1 → 55,  3 → 70,  5 → 82,  7+ → 92~95
  const base = 50 + Math.min(absNet, 8) * 6;
  return Math.min(95, Math.max(50, base));
}
