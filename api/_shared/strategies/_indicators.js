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

// ════════════════════════════════════════════════════════
// 알파 정제 레이어 (2026-06-02) — 스코어 결정요인 고도화
// ────────────────────────────────────────────────────────
// 문제(대표 관찰): RSI 30 이하인데도 trend-follow 가 숏 95 를 냄.
//   원인 = (1) 상관된 추세 지표(EMA배열·MACD·데드크로스·EMA200)가 같은 신호를
//   여러 번 세서 확신도 인플레, (2) 추세장에 반전·과열·소진 감지가 전무.
// 해결(전부 dampening-우세 = 과신 축소 방향이라 안전):
//   ① 과확장 페널티  ② 다이버전스(추세 반대)  ③ 극단 RSI 소진
//   ④ 거래량 페이드  ⑤ 독립 확인 폭(breadth) 기반 점수 캡 (상관 인플레 차단)
// ════════════════════════════════════════════════════════

// 가격 ↔ 지표 다이버전스. 윈도우를 절반으로 나눠 직전/현재 극값 비교.
//   bullish: 가격 더 낮은 저점 + 지표 더 높은 저점 → 하락 소진(숏 약화 근거)
//   bearish: 가격 더 높은 고점 + 지표 더 낮은 고점 → 상승 소진(롱 약화 근거)
export function detectDivergence(price, series, L, lookback = 12) {
  if (!price || !series || L < lookback + 1) return { bullish: false, bearish: false };
  const half = Math.floor(lookback / 2);
  let pMinNow = Infinity, pMaxNow = -Infinity, sMinNow = Infinity, sMaxNow = -Infinity;
  let pMinPrev = Infinity, pMaxPrev = -Infinity, sMinPrev = Infinity, sMaxPrev = -Infinity;
  for (let i = L - half + 1; i <= L; i++) {
    if (price[i] == null || series[i] == null) continue;
    pMinNow = Math.min(pMinNow, price[i]); pMaxNow = Math.max(pMaxNow, price[i]);
    sMinNow = Math.min(sMinNow, series[i]); sMaxNow = Math.max(sMaxNow, series[i]);
  }
  for (let i = L - lookback + 1; i <= L - half; i++) {
    if (price[i] == null || series[i] == null) continue;
    pMinPrev = Math.min(pMinPrev, price[i]); pMaxPrev = Math.max(pMaxPrev, price[i]);
    sMinPrev = Math.min(sMinPrev, series[i]); sMaxPrev = Math.max(sMaxPrev, series[i]);
  }
  if (!isFinite(pMinPrev) || !isFinite(pMinNow)) return { bullish: false, bearish: false };
  return {
    bullish: pMinNow < pMinPrev && sMinNow > sMinPrev,
    bearish: pMaxNow > pMaxPrev && sMaxNow < sMaxPrev,
  };
}

// 원시 buy/sell 표 → 정제된 net/score/confidence.
//   strategy 들이 net 계산 직전에 호출. dampening 우세이며, 정상 추세(과확장·
//   다이버전스·극단·거래량부진 없음)에선 표 변화 0 → 기존과 동일 신호.
export function refineSignalScore({ buy, sell, ind, closes, volumes, L, extensionPenalty = true }) {
  let adjBuy = buy, adjSell = sell;
  const notes = [];
  const price = closes?.[L];
  const atr = ind.atr?.[L];
  const ema21 = ind.ema21?.[L];
  const ema55 = ind.ema55?.[L];
  const rsi = ind.rsi?.[L];

  const side = (buy - sell) >= 0 ? "LONG" : "SHORT";

  // ① 과확장 페널티 — 가격이 EMA21 에서 ATR 3배 이상 벌어지면 되돌림 위험
  //   (breakout 처럼 확장이 본질인 전략은 extensionPenalty=false 로 건너뜀)
  if (extensionPenalty && atr && ema21 && atr > 0 && price != null) {
    const ext = (price - ema21) / atr;
    if (ext > 3 && side === "LONG") { adjBuy = Math.max(0, adjBuy - 2); notes.push(`과확장↑${ext.toFixed(1)}ATR`); }
    if (ext < -3 && side === "SHORT") { adjSell = Math.max(0, adjSell - 2); notes.push(`과확장↓${ext.toFixed(1)}ATR`); }
  }

  // ② 다이버전스 — 추세 반대 신호면 dampening
  const divRsi = detectDivergence(closes, ind.rsi, L, 12);
  const divMacd = detectDivergence(closes, ind.histogram, L, 12);
  if (side === "SHORT" && (divRsi.bullish || divMacd.bullish)) { adjSell = Math.max(0, adjSell - 2); notes.push("강세다이버전스"); }
  if (side === "LONG" && (divRsi.bearish || divMacd.bearish)) { adjBuy = Math.max(0, adjBuy - 2); notes.push("약세다이버전스"); }

  // ③ 극단 RSI 소진 — 추세 모멘텀이 과매도/과매수 극단이면 지속 확신 ↓
  if (rsi != null) {
    if (side === "SHORT" && rsi < 25) { adjSell = Math.max(0, adjSell - 1); notes.push(`RSI${rsi.toFixed(0)}과매도소진`); }
    if (side === "LONG" && rsi > 75) { adjBuy = Math.max(0, adjBuy - 1); notes.push(`RSI${rsi.toFixed(0)}과매수소진`); }
  }

  // ④ 거래량 페이드 — 추세가 거래량 빠지며 진행되면 확신 ↓
  const volMult = (ind.volSMA?.[L] > 0 && volumes && volumes[L] != null) ? volumes[L] / ind.volSMA[L] : 1;
  if (volMult < 0.7) {
    if (side === "LONG") adjBuy = Math.max(0, adjBuy - 1); else adjSell = Math.max(0, adjSell - 1);
    notes.push(`거래량부진${volMult.toFixed(1)}x`);
  }

  // dampening 이 부호를 뒤집지 않도록 중립까지만 (whipsaw 방지)
  if (side === "SHORT") adjSell = Math.max(adjSell, adjBuy);
  else adjBuy = Math.max(adjBuy, adjSell);

  const net = adjBuy - adjSell;
  const absNet = Math.abs(net);
  const finalSide = net >= 0 ? "LONG" : "SHORT";
  const fdir = finalSide === "LONG" ? 1 : -1;

  // ⑤ 독립 확인 폭(breadth) — 상관 요인 인플레 차단. 추세/모멘텀/거래량 3 카테고리.
  let confirms = 0;
  const macd = ind.macdLine?.[L], macdSig = ind.macdSig?.[L];
  if (ema21 != null && ema55 != null && macd != null && macdSig != null) {
    const trendDir = ema21 > ema55 ? 1 : -1;
    const macdDir = macd > macdSig ? 1 : -1;
    if (trendDir === fdir && macdDir === fdir) confirms++;           // 추세 카테고리
  }
  if (rsi != null) {                                                  // 모멘텀 — '건강한' 구간만 (극단은 비확인)
    if (fdir > 0 && rsi > 50 && rsi <= 72) confirms++;
    if (fdir < 0 && rsi < 50 && rsi >= 28) confirms++;
  }
  const obvNow = ind.obv?.[L], obvPast = ind.obv?.[L - 5];
  if (obvNow != null && obvPast != null && volMult >= 0.9) {          // 거래량 카테고리 — OBV 기울기 동의
    if ((obvNow > obvPast ? 1 : -1) === fdir) confirms++;
  }

  // breadth 캡: 0→55, 1→68, 2→82, 3→95 (상관 요인만으론 95 불가)
  const breadthCap = [55, 68, 82, 95][Math.min(confirms, 3)];
  const score = Math.min(scaleScore(absNet), breadthCap);

  // confidence 도 breadth(독립확인)로 캡 — score 의 breadthCap 과 정합.
  //   confirms 0 → 최대 C, 1 → 최대 B, 2+ → A 가능. (점수55인데 등급B 같은 불일치 제거)
  let confidence = gradeConfidence(absNet);
  if (confirms < 1) { if (confidence !== "C") confidence = "C"; }
  else if (confirms < 2) { if (confidence === "A") confidence = "B"; }

  return { side: finalSide, net, absNet, score, confidence, confirms, notes };
}
