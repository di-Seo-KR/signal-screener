// ════════════════════════════════════════════════════════════════════
// DI금융 퀀트 엔진 v2.1
// 24개 매매전략 + 백테스팅 엔진 + 시장진단 + 전략추천
// ════════════════════════════════════════════════════════════════════

// ── 보조지표 계산 함수 ───────────────────────────────────────────
export function calcSMA(data, period) {
  return data.map((_, i) => {
    if (i < period - 1) return null;
    return data.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period;
  });
}

export function calcEMA(data, period) {
  const k = 2 / (period + 1);
  const ema = [data[0]];
  for (let i = 1; i < data.length; i++) {
    ema.push(data[i] * k + ema[i - 1] * (1 - k));
  }
  return ema;
}

export function calcRSI(closes, period = 14) {
  const rsi = new Array(closes.length).fill(null);
  if (closes.length < period + 1) return rsi;
  let ag = 0, al = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) ag += d; else al -= d;
  }
  ag /= period; al /= period;
  rsi[period] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    ag = (ag * (period - 1) + Math.max(d, 0)) / period;
    al = (al * (period - 1) + Math.max(-d, 0)) / period;
    rsi[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  }
  return rsi;
}

export function calcBB(closes, period = 20, mult = 2) {
  return closes.map((_, i) => {
    if (i < period - 1) return null;
    const sl = closes.slice(i - period + 1, i + 1);
    const mean = sl.reduce((a, b) => a + b, 0) / period;
    const std = Math.sqrt(sl.reduce((a, b) => a + (b - mean) ** 2, 0) / period);
    return { upper: mean + mult * std, middle: mean, lower: mean - mult * std, bw: mean > 0 ? (std * 2 * mult) / mean : 0 };
  });
}

export function calcMACD(closes) {
  const ema12 = calcEMA(closes, 12);
  const ema26 = calcEMA(closes, 26);
  const macdLine = ema12.map((v, i) => v - ema26[i]);
  const signal = calcEMA(macdLine, 9);
  const histogram = macdLine.map((v, i) => v - signal[i]);
  return { macdLine, signal, histogram };
}

export function calcStochastic(highs, lows, closes, kPeriod = 14, dPeriod = 3) {
  const kArr = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < kPeriod - 1) { kArr.push(null); continue; }
    const hh = Math.max(...highs.slice(i - kPeriod + 1, i + 1));
    const ll = Math.min(...lows.slice(i - kPeriod + 1, i + 1));
    kArr.push(hh === ll ? 50 : ((closes[i] - ll) / (hh - ll)) * 100);
  }
  const dArr = kArr.map((_, i) => {
    if (i < kPeriod - 1 + dPeriod - 1) return null;
    const sl = kArr.slice(i - dPeriod + 1, i + 1).filter(v => v != null);
    return sl.length ? sl.reduce((a, b) => a + b, 0) / sl.length : null;
  });
  return { k: kArr, d: dArr };
}

export function calcATR(highs, lows, closes, period = 14) {
  const tr = [highs[0] - lows[0]];
  for (let i = 1; i < closes.length; i++) {
    tr.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
  }
  const atr = new Array(closes.length).fill(null);
  if (tr.length < period) return atr;
  let sum = tr.slice(0, period).reduce((a, b) => a + b, 0);
  atr[period - 1] = sum / period;
  for (let i = period; i < tr.length; i++) {
    atr[i] = (atr[i - 1] * (period - 1) + tr[i]) / period;
  }
  return atr;
}

export function calcADX(highs, lows, closes, period = 14) {
  const n = closes.length;
  const dx = new Array(n).fill(null);
  const adx = new Array(n).fill(null);
  if (n < period * 2) return adx;

  const plusDM = [], minusDM = [], tr = [];
  for (let i = 1; i < n; i++) {
    const upMove = highs[i] - highs[i - 1];
    const downMove = lows[i - 1] - lows[i];
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
    tr.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
  }

  let smoothPDM = plusDM.slice(0, period).reduce((a, b) => a + b, 0);
  let smoothMDM = minusDM.slice(0, period).reduce((a, b) => a + b, 0);
  let smoothTR = tr.slice(0, period).reduce((a, b) => a + b, 0);

  const dxArr = [];
  for (let i = period; i < tr.length; i++) {
    smoothPDM = smoothPDM - smoothPDM / period + plusDM[i];
    smoothMDM = smoothMDM - smoothMDM / period + minusDM[i];
    smoothTR = smoothTR - smoothTR / period + tr[i];
    const pdi = smoothTR > 0 ? (smoothPDM / smoothTR) * 100 : 0;
    const mdi = smoothTR > 0 ? (smoothMDM / smoothTR) * 100 : 0;
    const dxVal = (pdi + mdi) > 0 ? Math.abs(pdi - mdi) / (pdi + mdi) * 100 : 0;
    dxArr.push(dxVal);
  }

  if (dxArr.length >= period) {
    let adxSum = dxArr.slice(0, period).reduce((a, b) => a + b, 0) / period;
    adx[period * 2] = adxSum;
    for (let i = period; i < dxArr.length; i++) {
      adxSum = (adxSum * (period - 1) + dxArr[i]) / period;
      adx[period + 1 + i] = adxSum;
    }
  }
  return adx;
}

export function calcWilliamsR(highs, lows, closes, period = 14) {
  return closes.map((_, i) => {
    if (i < period - 1) return null;
    const hh = Math.max(...highs.slice(i - period + 1, i + 1));
    const ll = Math.min(...lows.slice(i - period + 1, i + 1));
    return hh === ll ? -50 : ((hh - closes[i]) / (hh - ll)) * -100;
  });
}

// Donchian Channel (터틀 트레이딩)
function calcDonchian(highs, lows, period) {
  return highs.map((_, i) => {
    if (i < period - 1) return null;
    return {
      upper: Math.max(...highs.slice(i - period + 1, i + 1)),
      lower: Math.min(...lows.slice(i - period + 1, i + 1)),
      mid: (Math.max(...highs.slice(i - period + 1, i + 1)) + Math.min(...lows.slice(i - period + 1, i + 1))) / 2,
    };
  });
}

// Keltner Channel
function calcKeltner(closes, highs, lows, emaPeriod = 20, atrPeriod = 10, atrMult = 2) {
  const ema = calcEMA(closes, emaPeriod);
  const atr = calcATR(highs, lows, closes, atrPeriod);
  return closes.map((_, i) => {
    if (atr[i] == null) return null;
    return { upper: ema[i] + atrMult * atr[i], middle: ema[i], lower: ema[i] - atrMult * atr[i] };
  });
}

// ════════════════════════════════════════════════════════════════════
// 매매 전략 정의 (12개)
// ════════════════════════════════════════════════════════════════════

// ━━━ 전략 1: RSI 반전 전략 ━━━
export const strategyRSI = {
  id: "rsi_reversal",
  name: "RSI 반전 전략",
  desc: "RSI(14)가 30 이하일 때 매수, 70 이상일 때 매도. 과매도 구간에서 평균 회귀를 노리는 전략.",
  category: "평균회귀",
  risk: "중",
  icon: "📉",
  params: { period: 14, buyThreshold: 30, sellThreshold: 70 },
  generate(candles, params = {}) {
    const { period = 14, buyThreshold = 30, sellThreshold = 70 } = { ...this.params, ...params };
    const closes = candles.map(c => c.close);
    const rsi = calcRSI(closes, period);
    const signals = [];
    for (let i = 1; i < candles.length; i++) {
      if (rsi[i] == null || rsi[i - 1] == null) continue;
      if (rsi[i] <= buyThreshold && rsi[i - 1] > buyThreshold)
        signals.push({ index: i, type: "BUY", price: closes[i], reason: `RSI ${rsi[i].toFixed(1)} ≤ ${buyThreshold}` });
      else if (rsi[i] >= sellThreshold && rsi[i - 1] < sellThreshold)
        signals.push({ index: i, type: "SELL", price: closes[i], reason: `RSI ${rsi[i].toFixed(1)} ≥ ${sellThreshold}` });
    }
    return signals;
  },
};

// ━━━ 전략 2: 볼린저밴드 바운스 ━━━
export const strategyBB = {
  id: "bb_bounce",
  name: "볼린저밴드 바운스",
  desc: "가격이 BB 하단에 닿으면 매수, 상단에 닿으면 매도. 밴드 내 왕복 수익을 추구.",
  category: "평균회귀",
  risk: "중",
  icon: "🎯",
  params: { period: 20, mult: 2 },
  generate(candles, params = {}) {
    const { period = 20, mult = 2 } = { ...this.params, ...params };
    const closes = candles.map(c => c.close);
    const bb = calcBB(closes, period, mult);
    const signals = [];
    for (let i = 1; i < candles.length; i++) {
      if (!bb[i] || !bb[i - 1]) continue;
      if (closes[i] <= bb[i].lower && closes[i - 1] > bb[i - 1].lower)
        signals.push({ index: i, type: "BUY", price: closes[i], reason: `BB 하단 터치` });
      else if (closes[i] >= bb[i].upper && closes[i - 1] < bb[i - 1].upper)
        signals.push({ index: i, type: "SELL", price: closes[i], reason: `BB 상단 터치` });
    }
    return signals;
  },
};

// ━━━ 전략 3: MACD 크로스오버 ━━━
export const strategyMACD = {
  id: "macd_crossover",
  name: "MACD 크로스오버",
  desc: "MACD 라인이 시그널 상향 돌파 매수, 하향 돌파 매도. 추세 전환 포착.",
  category: "추세추종",
  risk: "중",
  icon: "✨",
  params: {},
  generate(candles) {
    const closes = candles.map(c => c.close);
    const { macdLine, signal } = calcMACD(closes);
    const signals = [];
    for (let i = 30; i < candles.length; i++) {
      const prevDiff = macdLine[i - 1] - signal[i - 1];
      const curDiff = macdLine[i] - signal[i];
      if (prevDiff <= 0 && curDiff > 0)
        signals.push({ index: i, type: "BUY", price: closes[i], reason: `MACD 골든크로스` });
      else if (prevDiff >= 0 && curDiff < 0)
        signals.push({ index: i, type: "SELL", price: closes[i], reason: `MACD 데드크로스` });
    }
    return signals;
  },
};

// ━━━ 전략 4: 이동평균 골든/데드크로스 ━━━
export const strategyMA = {
  id: "ma_crossover",
  name: "이평선 크로스 (20/60)",
  desc: "20일선이 60일선 위로 돌파 매수, 아래로 돌파 매도.",
  category: "추세추종",
  risk: "낮음",
  icon: "🏆",
  params: { shortPeriod: 20, longPeriod: 60 },
  generate(candles, params = {}) {
    const { shortPeriod = 20, longPeriod = 60 } = { ...this.params, ...params };
    const closes = candles.map(c => c.close);
    const shortMA = calcSMA(closes, shortPeriod);
    const longMA = calcSMA(closes, longPeriod);
    const signals = [];
    for (let i = longPeriod + 1; i < candles.length; i++) {
      if (shortMA[i] == null || longMA[i] == null || shortMA[i - 1] == null || longMA[i - 1] == null) continue;
      if (shortMA[i - 1] <= longMA[i - 1] && shortMA[i] > longMA[i])
        signals.push({ index: i, type: "BUY", price: closes[i], reason: `${shortPeriod}MA > ${longPeriod}MA 골든크로스` });
      else if (shortMA[i - 1] >= longMA[i - 1] && shortMA[i] < longMA[i])
        signals.push({ index: i, type: "SELL", price: closes[i], reason: `${shortPeriod}MA < ${longPeriod}MA 데드크로스` });
    }
    return signals;
  },
};

// ━━━ 전략 5: 거래량 돌파 ━━━
export const strategyVolume = {
  id: "volume_breakout",
  name: "거래량 돌파 전략",
  desc: "거래량이 20일 평균 2배 이상 + 양봉이면 매수. 강한 매수세 포착.",
  category: "모멘텀",
  risk: "높음",
  icon: "🔥",
  params: { volPeriod: 20, volMult: 2.0, holdBars: 5 },
  generate(candles, params = {}) {
    const { volPeriod = 20, volMult = 2.0, holdBars = 5 } = { ...this.params, ...params };
    const signals = [];
    for (let i = volPeriod; i < candles.length; i++) {
      const avgVol = candles.slice(i - volPeriod, i).reduce((a, c) => a + (c.volume || 0), 0) / volPeriod;
      const vol = candles[i].volume || 0;
      const isGreen = candles[i].close > candles[i].open;
      if (vol >= avgVol * volMult && isGreen && avgVol > 0) {
        signals.push({ index: i, type: "BUY", price: candles[i].close, reason: `거래량 ${(vol / avgVol).toFixed(1)}x 급증` });
        const sellIdx = Math.min(i + holdBars, candles.length - 1);
        signals.push({ index: sellIdx, type: "SELL", price: candles[sellIdx].close, reason: `${holdBars}봉 보유 후 매도` });
      }
    }
    return signals;
  },
};

// ━━━ 전략 6: 스토캐스틱+RSI 콤보 ━━━
export const strategyCombo = {
  id: "stoch_rsi_combo",
  name: "스토캐스틱+RSI 콤보",
  desc: "RSI < 35 AND Stoch %K < 25 동시 충족 매수. 이중 필터로 가짜 신호 제거.",
  category: "평균회귀",
  risk: "낮음",
  icon: "🌊",
  params: { rsiBuy: 35, rsiSell: 65, stochBuy: 25, stochSell: 75 },
  generate(candles, params = {}) {
    const { rsiBuy = 35, rsiSell = 65, stochBuy = 25, stochSell = 75 } = { ...this.params, ...params };
    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const rsi = calcRSI(closes);
    const stoch = calcStochastic(highs, lows, closes);
    const signals = [];
    for (let i = 20; i < candles.length; i++) {
      if (rsi[i] == null || stoch.k[i] == null) continue;
      if (rsi[i] <= rsiBuy && stoch.k[i] <= stochBuy)
        signals.push({ index: i, type: "BUY", price: closes[i], reason: `RSI ${rsi[i].toFixed(1)} + Stoch ${stoch.k[i].toFixed(1)} 과매도` });
      else if (rsi[i] >= rsiSell && stoch.k[i] >= stochSell)
        signals.push({ index: i, type: "SELL", price: closes[i], reason: `RSI ${rsi[i].toFixed(1)} + Stoch ${stoch.k[i].toFixed(1)} 과매수` });
    }
    return signals;
  },
};

// ━━━ 전략 7: 터틀 트레이딩 (Donchian Breakout) ━━━
// 리처드 데니스의 터틀 트레이딩 — 20일 고가 돌파 매수, 10일 저가 이탈 매도
export const strategyTurtle = {
  id: "turtle_breakout",
  name: "터틀 트레이딩",
  desc: "20일 최고가 돌파 매수, 10일 최저가 이탈 매도. 리처드 데니스의 추세추종 전략.",
  category: "추세추종",
  risk: "중",
  icon: "🐢",
  params: { entryPeriod: 20, exitPeriod: 10 },
  generate(candles, params = {}) {
    const { entryPeriod = 20, exitPeriod = 10 } = { ...this.params, ...params };
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const closes = candles.map(c => c.close);
    const entryDonchian = calcDonchian(highs, lows, entryPeriod);
    const exitDonchian = calcDonchian(highs, lows, exitPeriod);
    const signals = [];
    for (let i = entryPeriod + 1; i < candles.length; i++) {
      if (!entryDonchian[i - 1] || !exitDonchian[i - 1]) continue;
      if (closes[i] > entryDonchian[i - 1].upper)
        signals.push({ index: i, type: "BUY", price: closes[i], reason: `${entryPeriod}일 고가 돌파` });
      else if (closes[i] < exitDonchian[i - 1].lower)
        signals.push({ index: i, type: "SELL", price: closes[i], reason: `${exitPeriod}일 저가 이탈` });
    }
    return signals;
  },
};

// ━━━ 전략 8: 켈트너 채널 평균회귀 ━━━
// 켈트너 채널 하단 이탈 후 복귀 시 매수
export const strategyKeltner = {
  id: "keltner_reversion",
  name: "켈트너 채널 회귀",
  desc: "켈트너 채널 하단 이탈 후 복귀 시 매수, 상단 이탈 후 복귀 시 매도. ATR 기반 채널 전략.",
  category: "평균회귀",
  risk: "중",
  icon: "📐",
  params: { emaPeriod: 20, atrPeriod: 10, atrMult: 2 },
  generate(candles, params = {}) {
    const { emaPeriod = 20, atrPeriod = 10, atrMult = 2 } = { ...this.params, ...params };
    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const kc = calcKeltner(closes, highs, lows, emaPeriod, atrPeriod, atrMult);
    const signals = [];
    for (let i = 2; i < candles.length; i++) {
      if (!kc[i] || !kc[i - 1] || !kc[i - 2]) continue;
      // 하단 이탈 후 복귀
      if (closes[i - 1] < kc[i - 1].lower && closes[i] > kc[i].lower)
        signals.push({ index: i, type: "BUY", price: closes[i], reason: `켈트너 하단 복귀` });
      // 상단 이탈 후 복귀
      else if (closes[i - 1] > kc[i - 1].upper && closes[i] < kc[i].upper)
        signals.push({ index: i, type: "SELL", price: closes[i], reason: `켈트너 상단 복귀` });
    }
    return signals;
  },
};

// ━━━ 전략 9: 듀얼 모멘텀 (절대 + 상대) ━━━
// Gary Antonacci의 듀얼 모멘텀 — 12개월 수익률 기반
export const strategyDualMomentum = {
  id: "dual_momentum",
  name: "듀얼 모멘텀",
  desc: "절대 모멘텀(12개월 수익률 > 0) + 추세필터(가격 > 200MA) 동시 충족 시 매수.",
  category: "모멘텀",
  risk: "낮음",
  icon: "🚀",
  params: { lookback: 60, maPeriod: 200 },
  generate(candles, params = {}) {
    const { lookback = 60, maPeriod: maP = 200 } = { ...this.params, ...params };
    const closes = candles.map(c => c.close);
    const effectiveMA = Math.min(maP, Math.floor(closes.length * 0.6));
    const ma = calcSMA(closes, effectiveMA);
    const signals = [];
    for (let i = Math.max(lookback, effectiveMA) + 1; i < candles.length; i++) {
      if (ma[i] == null || ma[i - 1] == null) continue;
      const mom = (closes[i] - closes[i - lookback]) / closes[i - lookback];
      const prevMom = (closes[i - 1] - closes[i - 1 - lookback]) / closes[i - 1 - lookback];
      // 모멘텀이 양전환 + 가격 > MA
      if (mom > 0 && prevMom <= 0 && closes[i] > ma[i])
        signals.push({ index: i, type: "BUY", price: closes[i], reason: `듀얼모멘텀 진입 (수익률 ${(mom * 100).toFixed(1)}%)` });
      // 모멘텀이 음전환 또는 가격 < MA
      else if ((mom < 0 && prevMom >= 0) || (closes[i] < ma[i] && closes[i - 1] >= ma[i - 1]))
        signals.push({ index: i, type: "SELL", price: closes[i], reason: `듀얼모멘텀 이탈` });
    }
    return signals;
  },
};

// ━━━ 전략 10: Williams %R + ADX 필터 ━━━
// Williams %R 과매도 + ADX로 추세 강도 확인
export const strategyWilliamsADX = {
  id: "williams_adx",
  name: "Williams %R + ADX",
  desc: "Williams %R 과매도(-80 이하) + ADX > 25(추세 존재) 시 매수. 추세 내 저점 매수.",
  category: "추세추종",
  risk: "중",
  icon: "📊",
  params: { wrPeriod: 14, wrBuy: -80, wrSell: -20, adxThreshold: 25 },
  generate(candles, params = {}) {
    const { wrPeriod = 14, wrBuy = -80, wrSell = -20, adxThreshold = 25 } = { ...this.params, ...params };
    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const wr = calcWilliamsR(highs, lows, closes, wrPeriod);
    const adx = calcADX(highs, lows, closes);
    const signals = [];
    for (let i = 30; i < candles.length; i++) {
      if (wr[i] == null) continue;
      const adxVal = adx[i] || 0;
      if (wr[i] <= wrBuy && adxVal >= adxThreshold)
        signals.push({ index: i, type: "BUY", price: closes[i], reason: `WR ${wr[i].toFixed(0)} + ADX ${adxVal.toFixed(0)}` });
      else if (wr[i] >= wrSell)
        signals.push({ index: i, type: "SELL", price: closes[i], reason: `WR ${wr[i].toFixed(0)} 과매수` });
    }
    return signals;
  },
};

// ━━━ 전략 11: BB 스퀴즈 돌파 ━━━
// 볼린저밴드 폭이 최소인 상태(스퀴즈)에서 가격 돌파 시 진입
export const strategyBBSqueeze = {
  id: "bb_squeeze",
  name: "BB 스퀴즈 돌파",
  desc: "볼린저밴드 폭이 20봉 최소(스퀴즈) → 상단 돌파 시 매수. 대폭발 전조 포착.",
  category: "변동성",
  risk: "높음",
  icon: "⚡",
  params: { period: 20, mult: 2, squeezeLookback: 20 },
  generate(candles, params = {}) {
    const { period = 20, mult = 2, squeezeLookback = 20 } = { ...this.params, ...params };
    const closes = candles.map(c => c.close);
    const bb = calcBB(closes, period, mult);
    const signals = [];
    for (let i = squeezeLookback + period; i < candles.length; i++) {
      if (!bb[i] || !bb[i - 1]) continue;
      const recentBW = [];
      for (let j = i - squeezeLookback; j < i; j++) {
        if (bb[j]) recentBW.push(bb[j].bw);
      }
      if (!recentBW.length) continue;
      const minBW = Math.min(...recentBW);
      const isSqueeze = bb[i - 1].bw <= minBW * 1.05;
      if (isSqueeze && closes[i] > bb[i].upper)
        signals.push({ index: i, type: "BUY", price: closes[i], reason: `BB 스퀴즈 → 상단 돌파` });
      else if (isSqueeze && closes[i] < bb[i].lower)
        signals.push({ index: i, type: "SELL", price: closes[i], reason: `BB 스퀴즈 → 하단 이탈` });
    }
    return signals;
  },
};

// ━━━ 전략 12: 삼중 이평선 + ATR 후행 정지 ━━━
// EMA(5/20/60) 정배열 매수 + ATR 기반 동적 손절
export const strategyTripleMA = {
  id: "triple_ma_atr",
  name: "삼중 이평선 + ATR 정지",
  desc: "EMA(5) > EMA(20) > EMA(60) 정배열 매수, 가격이 EMA(20) - 2×ATR 이하 시 매도. 추세 라이딩 전략.",
  category: "추세추종",
  risk: "중",
  icon: "🎿",
  params: { fast: 5, mid: 20, slow: 60, atrMult: 2 },
  generate(candles, params = {}) {
    const { fast = 5, mid = 20, slow = 60, atrMult = 2 } = { ...this.params, ...params };
    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const emaF = calcEMA(closes, fast);
    const emaM = calcEMA(closes, mid);
    const emaS = calcEMA(closes, slow);
    const atr = calcATR(highs, lows, closes);
    const signals = [];
    for (let i = slow + 1; i < candles.length; i++) {
      if (atr[i] == null) continue;
      const aligned = emaF[i] > emaM[i] && emaM[i] > emaS[i];
      const prevAligned = emaF[i - 1] > emaM[i - 1] && emaM[i - 1] > emaS[i - 1];
      if (aligned && !prevAligned)
        signals.push({ index: i, type: "BUY", price: closes[i], reason: `삼중 이평선 정배열` });
      // ATR 후행 정지
      const trailingStop = emaM[i] - atrMult * atr[i];
      if (!aligned && prevAligned || closes[i] < trailingStop)
        signals.push({ index: i, type: "SELL", price: closes[i], reason: `ATR 후행정지 / 정배열 해제` });
    }
    return signals;
  },
};

// ━━━ 전략 13: VWAP 반전 ━━━
// 거래량 가중 평균가 기반 — 기관투자자의 기준선
export const strategyVWAP = {
  id: "vwap_reversion",
  name: "VWAP 반전",
  desc: "가격이 VWAP(20봉 근사) 아래로 -2% 이상 이탈 후 복귀 시 매수. 기관 매집 가능성 포착.",
  category: "평균회귀",
  risk: "중",
  icon: "🏦",
  params: { period: 20, threshold: 0.02 },
  generate(candles, params = {}) {
    const { period = 20, threshold = 0.02 } = { ...this.params, ...params };
    const signals = [];
    for (let i = period; i < candles.length; i++) {
      // VWAP 근사: 기간 내 (TP*Vol)/Vol 합
      let tpvSum = 0, volSum = 0;
      for (let j = i - period + 1; j <= i; j++) {
        const tp = (candles[j].high + candles[j].low + candles[j].close) / 3;
        tpvSum += tp * (candles[j].volume || 1);
        volSum += (candles[j].volume || 1);
      }
      const vwap = volSum > 0 ? tpvSum / volSum : candles[i].close;
      const deviation = (candles[i].close - vwap) / vwap;
      const prevDeviation = i > period ? (() => {
        let pTpv = 0, pVol = 0;
        for (let j = i - period; j < i; j++) {
          const tp = (candles[j].high + candles[j].low + candles[j].close) / 3;
          pTpv += tp * (candles[j].volume || 1);
          pVol += (candles[j].volume || 1);
        }
        return pVol > 0 ? (candles[i - 1].close - pTpv / pVol) / (pTpv / pVol) : 0;
      })() : 0;
      if (deviation > -threshold && prevDeviation <= -threshold)
        signals.push({ index: i, type: "BUY", price: candles[i].close, reason: `VWAP 복귀 (${(deviation * 100).toFixed(1)}%)` });
      else if (deviation > threshold && prevDeviation <= threshold)
        signals.push({ index: i, type: "SELL", price: candles[i].close, reason: `VWAP 상단 이탈 (${(deviation * 100).toFixed(1)}%)` });
    }
    return signals;
  },
};

// ━━━ 전략 14: 피보나치 되돌림 ━━━
// 38.2% / 61.8% 되돌림 구간에서 반등 매수
export const strategyFibonacci = {
  id: "fibonacci_retracement",
  name: "피보나치 되돌림",
  desc: "52봉 고점-저점 기준 38.2~61.8% 되돌림 구간 진입 시 매수. 고전적 지지/저항 전략.",
  category: "평균회귀",
  risk: "중",
  icon: "🌀",
  params: { lookback: 52, fib382: 0.382, fib618: 0.618 },
  generate(candles, params = {}) {
    const { lookback = 52, fib382 = 0.382, fib618 = 0.618 } = { ...this.params, ...params };
    const signals = [];
    for (let i = lookback; i < candles.length; i++) {
      const slice = candles.slice(i - lookback, i);
      const high = Math.max(...slice.map(c => c.high));
      const low = Math.min(...slice.map(c => c.low));
      const range = high - low;
      if (range <= 0) continue;
      const fib382Level = high - range * fib382;
      const fib618Level = high - range * fib618;
      const price = candles[i].close;
      const prevPrice = candles[i - 1].close;
      // 가격이 피보나치 구간에 진입하고 반등 시작
      if (price >= fib618Level && price <= fib382Level && prevPrice < fib618Level)
        signals.push({ index: i, type: "BUY", price, reason: `피보나치 61.8% 반등 (${fib618Level.toFixed(2)})` });
      else if (price > high * 0.98 && prevPrice < high * 0.98)
        signals.push({ index: i, type: "SELL", price, reason: `고점 근접 (${high.toFixed(2)})` });
    }
    return signals;
  },
};

// ━━━ 전략 15: 허쉬만 채널 모멘텀 ━━━
// 가격이 중앙선 위에서 모멘텀 강화 시 포지션 확대
export const strategyMomentumChannel = {
  id: "momentum_channel",
  name: "모멘텀 채널",
  desc: "BB 중앙선 위 + RSI > 50 + 거래량 증가 동시 충족 시 매수. 다중 필터 모멘텀 포착.",
  category: "모멘텀",
  risk: "중",
  icon: "⚡",
  params: { bbPeriod: 20, rsiPeriod: 14, volMult: 1.5 },
  generate(candles, params = {}) {
    const { bbPeriod = 20, rsiPeriod = 14, volMult = 1.5 } = { ...this.params, ...params };
    const closes = candles.map(c => c.close);
    const bb = calcBB(closes, bbPeriod);
    const rsi = calcRSI(closes, rsiPeriod);
    const signals = [];
    for (let i = Math.max(bbPeriod, rsiPeriod, 20); i < candles.length; i++) {
      if (!bb[i] || rsi[i] == null) continue;
      const avgVol = candles.slice(i - 20, i).reduce((a, c) => a + (c.volume || 0), 0) / 20;
      const curVol = candles[i].volume || 0;
      const volUp = avgVol > 0 && curVol >= avgVol * volMult;
      const aboveMiddle = closes[i] > bb[i].middle;
      const rsiStrong = rsi[i] > 50;
      const prevAbove = bb[i - 1] ? closes[i - 1] > bb[i - 1].middle : false;
      if (aboveMiddle && !prevAbove && rsiStrong && volUp)
        signals.push({ index: i, type: "BUY", price: closes[i], reason: `모멘텀 채널 진입 (RSI ${rsi[i].toFixed(0)}, Vol ${(curVol / avgVol).toFixed(1)}x)` });
      else if (!aboveMiddle && prevAbove)
        signals.push({ index: i, type: "SELL", price: closes[i], reason: `중앙선 이탈` });
    }
    return signals;
  },
};

// ━━━ 전략 16: 갭 앤 고 (Gap & Go) ━━━
// 갭 상승 후 첫 되돌림에서 매수
export const strategyGapAndGo = {
  id: "gap_and_go",
  name: "갭 앤 고",
  desc: "전일 대비 2% 이상 갭 상승 후 3봉 이내 매수 → 5봉 보유 후 매도. 단기 모멘텀 전략.",
  category: "모멘텀",
  risk: "높음",
  icon: "🎯",
  params: { gapPct: 2, holdBars: 5 },
  generate(candles, params = {}) {
    const { gapPct = 2, holdBars = 5 } = { ...this.params, ...params };
    const signals = [];
    for (let i = 1; i < candles.length; i++) {
      const gap = ((candles[i].open - candles[i - 1].close) / candles[i - 1].close) * 100;
      if (gap >= gapPct && candles[i].close > candles[i].open) {
        signals.push({ index: i, type: "BUY", price: candles[i].close, reason: `갭 +${gap.toFixed(1)}% 돌파` });
        const sellIdx = Math.min(i + holdBars, candles.length - 1);
        signals.push({ index: sellIdx, type: "SELL", price: candles[sellIdx].close, reason: `${holdBars}봉 보유 후 매도` });
      }
    }
    return signals;
  },
};

// ━━━ 전략 17: 스윙 구간 트레이딩 ━━━
// ATR 기반 동적 매수/매도 구간 설정
export const strategySwingATR = {
  id: "swing_atr",
  name: "ATR 스윙",
  desc: "가격이 20EMA - 1.5×ATR 아래에서 반등 시 매수, 20EMA + 1.5×ATR 위에서 매도. 스윙 트레이딩 전략.",
  category: "변동성",
  risk: "중",
  icon: "🎢",
  params: { emaPeriod: 20, atrPeriod: 14, atrMult: 1.5 },
  generate(candles, params = {}) {
    const { emaPeriod = 20, atrPeriod = 14, atrMult = 1.5 } = { ...this.params, ...params };
    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const ema = calcEMA(closes, emaPeriod);
    const atr = calcATR(highs, lows, closes, atrPeriod);
    const signals = [];
    for (let i = Math.max(emaPeriod, atrPeriod) + 1; i < candles.length; i++) {
      if (atr[i] == null) continue;
      const lowerBand = ema[i] - atrMult * atr[i];
      const upperBand = ema[i] + atrMult * atr[i];
      if (closes[i] > lowerBand && closes[i - 1] <= (ema[i - 1] - atrMult * (atr[i - 1] || atr[i])))
        signals.push({ index: i, type: "BUY", price: closes[i], reason: `ATR 하단 반등 (${lowerBand.toFixed(2)})` });
      else if (closes[i] >= upperBand)
        signals.push({ index: i, type: "SELL", price: closes[i], reason: `ATR 상단 도달 (${upperBand.toFixed(2)})` });
    }
    return signals;
  },
};

// ━━━ 전략 18: OBV 트렌드 추종 ━━━
// On-Balance Volume 이동평균 돌파 — 스마트머니 추적
export const strategyOBV = {
  id: "obv_trend",
  name: "OBV 추세 추종",
  desc: "OBV가 20일 이동평균을 상향돌파하면 매수. 거래량 기반 스마트머니 움직임 추적.",
  category: "추세추종",
  risk: "낮음",
  icon: "📈",
  params: { obvMAPeriod: 20 },
  generate(candles, params = {}) {
    const { obvMAPeriod = 20 } = { ...this.params, ...params };
    const closes = candles.map(c => c.close);
    const obvArr = [0];
    for (let i = 1; i < closes.length; i++) {
      if (closes[i] > closes[i - 1]) obvArr.push(obvArr[i - 1] + (candles[i].volume || 0));
      else if (closes[i] < closes[i - 1]) obvArr.push(obvArr[i - 1] - (candles[i].volume || 0));
      else obvArr.push(obvArr[i - 1]);
    }
    const obvSMA = obvArr.map((_, i) => {
      if (i < obvMAPeriod - 1) return null;
      return obvArr.slice(i - obvMAPeriod + 1, i + 1).reduce((a, b) => a + b, 0) / obvMAPeriod;
    });
    const signals = [];
    for (let i = obvMAPeriod + 1; i < candles.length; i++) {
      if (obvSMA[i] == null || obvSMA[i - 1] == null) continue;
      if (obvArr[i] > obvSMA[i] && obvArr[i - 1] <= obvSMA[i - 1])
        signals.push({ index: i, type: "BUY", price: closes[i], reason: `OBV > OBV-MA${obvMAPeriod} 골든크로스` });
      else if (obvArr[i] < obvSMA[i] && obvArr[i - 1] >= obvSMA[i - 1])
        signals.push({ index: i, type: "SELL", price: closes[i], reason: `OBV < OBV-MA${obvMAPeriod} 데드크로스` });
    }
    return signals;
  },
};

// ━━━ 전략 19: 마켓 마이크로스트럭처 (고빈도 근사) ━━━
// 주문 흐름 불균형 — 가격 변화 + 거래량 비율로 매수/매도 압력 추정
export const strategyMicrostructure = {
  id: "microstructure",
  name: "마이크로스트럭처",
  desc: "가격 변화 방향과 거래량 비율로 매수/매도 압력 추정. 고빈도 매매의 일봉 근사.",
  category: "모멘텀",
  risk: "높음",
  icon: "⚙️",
  params: { lookback: 10, threshold: 0.65, holdBars: 3 },
  generate(candles, params = {}) {
    const { lookback = 10, threshold = 0.65, holdBars = 3 } = { ...this.params, ...params };
    const signals = [];
    for (let i = lookback; i < candles.length; i++) {
      // 최근 N봉 중 양봉 비율 + 거래량 가중 방향 계산
      let buyPressure = 0, totalVol = 0;
      for (let j = i - lookback + 1; j <= i; j++) {
        const vol = candles[j].volume || 1;
        totalVol += vol;
        if (candles[j].close > candles[j].open) buyPressure += vol;
        else if (candles[j].close === candles[j].open) buyPressure += vol * 0.5;
      }
      const ratio = totalVol > 0 ? buyPressure / totalVol : 0.5;
      const prevRatio = (() => {
        if (i <= lookback) return 0.5;
        let bp = 0, tv = 0;
        for (let j = i - lookback; j < i; j++) {
          const vol = candles[j].volume || 1; tv += vol;
          if (candles[j].close > candles[j].open) bp += vol;
          else if (candles[j].close === candles[j].open) bp += vol * 0.5;
        }
        return tv > 0 ? bp / tv : 0.5;
      })();

      if (ratio >= threshold && prevRatio < threshold) {
        signals.push({ index: i, type: "BUY", price: candles[i].close, reason: `매수압력 ${(ratio * 100).toFixed(0)}% (임계 ${(threshold * 100).toFixed(0)}%)` });
        const sellIdx = Math.min(i + holdBars, candles.length - 1);
        signals.push({ index: sellIdx, type: "SELL", price: candles[sellIdx].close, reason: `${holdBars}봉 보유 후 청산` });
      }
    }
    return signals;
  },
};

// ━━━ 전략 20: 통계적 차익거래 (Mean Reversion Z-Score) ━━━
// Z-Score 기반 평균회귀 — 가격이 이평선 대비 표준편차 이상 이탈 시 진입
export const strategyStatArb = {
  id: "stat_arb",
  name: "통계적 차익 (Z-Score)",
  desc: "가격의 Z-Score(이평선 대비 표준편차)가 -2 이하 시 매수, +2 이상 시 매도. 통계적 평균회귀.",
  category: "평균회귀",
  risk: "중",
  icon: "📐",
  params: { period: 20, entryZ: 2.0, exitZ: 0.5 },
  generate(candles, params = {}) {
    const { period = 20, entryZ = 2.0, exitZ = 0.5 } = { ...this.params, ...params };
    const closes = candles.map(c => c.close);
    const signals = [];
    let inPosition = false;

    for (let i = period; i < candles.length; i++) {
      const slice = closes.slice(i - period, i);
      const mean = slice.reduce((a, b) => a + b, 0) / period;
      const std = Math.sqrt(slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period);
      if (std === 0) continue;
      const zScore = (closes[i] - mean) / std;

      if (!inPosition && zScore <= -entryZ) {
        signals.push({ index: i, type: "BUY", price: closes[i], reason: `Z-Score ${zScore.toFixed(2)} ≤ -${entryZ}` });
        inPosition = true;
      } else if (inPosition && (zScore >= exitZ || zScore >= entryZ)) {
        signals.push({ index: i, type: "SELL", price: closes[i], reason: `Z-Score ${zScore.toFixed(2)} 복귀` });
        inPosition = false;
      }
    }
    return signals;
  },
};

// ━━━ 전략 21: 변동성 수축 돌파 (Squeeze Momentum) ━━━
// TTM Squeeze 근사 — BB가 KC 안에 들어갈 때 스퀴즈, 해제 시 방향 진입
export const strategySqueezeMomentum = {
  id: "squeeze_momentum",
  name: "스퀴즈 모멘텀",
  desc: "BB가 켈트너채널 안에 수축(스퀴즈) → 해제 시 모멘텀 방향으로 진입. TTM Squeeze 근사.",
  category: "변동성",
  risk: "높음",
  icon: "💥",
  params: { bbPeriod: 20, bbMult: 2, kcPeriod: 20, kcMult: 1.5 },
  generate(candles, params = {}) {
    const { bbPeriod = 20, bbMult = 2, kcPeriod = 20, kcMult = 1.5 } = { ...this.params, ...params };
    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const bb = calcBB(closes, bbPeriod, bbMult);
    const ema = calcEMA(closes, kcPeriod);
    const atr = calcATR(highs, lows, closes, kcPeriod);
    const signals = [];

    let wasSqueezed = false;
    for (let i = Math.max(bbPeriod, kcPeriod) + 1; i < candles.length; i++) {
      if (!bb[i] || atr[i] == null) continue;
      const kcUpper = ema[i] + kcMult * atr[i];
      const kcLower = ema[i] - kcMult * atr[i];
      const isSqueezed = bb[i].upper < kcUpper && bb[i].lower > kcLower;

      if (wasSqueezed && !isSqueezed) {
        // 스퀴즈 해제 — 모멘텀 방향으로 진입
        const mom = closes[i] - closes[i - kcPeriod];
        if (mom > 0) {
          signals.push({ index: i, type: "BUY", price: closes[i], reason: `스퀴즈 해제 → 상승 모멘텀` });
        } else {
          signals.push({ index: i, type: "SELL", price: closes[i], reason: `스퀴즈 해제 → 하락 모멘텀` });
        }
      }
      wasSqueezed = isSqueezed;
    }
    return signals;
  },
};

// ━━━ 전략 22: 래리 코너스 RSI(2) ━━━
// 단기 RSI(2) 극단값에서의 평균회귀 — 고빈도 단기 매매
export const strategyConnorsRSI2 = {
  id: "connors_rsi2",
  name: "래리 코너스 RSI(2)",
  desc: "RSI(2) ≤ 10에서 매수, ≥ 90에서 매도. 초단기 과매수/과매도 평균회귀 전략.",
  category: "평균회귀",
  risk: "높음",
  icon: "⚡",
  params: { rsiPeriod: 2, buyThreshold: 10, sellThreshold: 90, trendFilter: true },
  generate(candles, params = {}) {
    const { rsiPeriod = 2, buyThreshold = 10, sellThreshold = 90, trendFilter = true } = { ...this.params, ...params };
    const closes = candles.map(c => c.close);
    const rsi = calcRSI(closes, rsiPeriod);
    const sma200 = trendFilter ? calcSMA(closes, Math.min(200, Math.floor(closes.length * 0.5))) : null;
    const signals = [];

    for (let i = Math.max(rsiPeriod + 1, trendFilter ? 200 : 0); i < candles.length; i++) {
      if (rsi[i] == null || rsi[i - 1] == null) continue;
      const aboveTrend = !trendFilter || !sma200 || sma200[i] == null || closes[i] > sma200[i];

      if (rsi[i] <= buyThreshold && rsi[i - 1] > buyThreshold && aboveTrend) {
        signals.push({ index: i, type: "BUY", price: closes[i], reason: `RSI(2) ${rsi[i].toFixed(1)} ≤ ${buyThreshold}` });
      } else if (rsi[i] >= sellThreshold && rsi[i - 1] < sellThreshold) {
        signals.push({ index: i, type: "SELL", price: closes[i], reason: `RSI(2) ${rsi[i].toFixed(1)} ≥ ${sellThreshold}` });
      }
    }
    return signals;
  },
};

// ━━━ 전략 23: 시장 레짐 전환 (Regime Switch) ━━━
// ADX + ATR 비율로 추세/횡보 레짐 감지 → 적응형 매매
export const strategyRegimeSwitch = {
  id: "regime_switch",
  name: "레짐 전환 적응형",
  desc: "ADX로 추세/횡보 구분 → 추세장: MA 크로스 매매, 횡보장: RSI 평균회귀 매매. 시장 적응형.",
  category: "추세추종",
  risk: "중",
  icon: "🔄",
  params: { adxThreshold: 25 },
  generate(candles, params = {}) {
    const { adxThreshold = 25 } = { ...this.params, ...params };
    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const adx = calcADX(highs, lows, closes, 14);
    const rsi = calcRSI(closes, 14);
    const ma20 = calcSMA(closes, 20);
    const ma60 = calcSMA(closes, 60);
    const signals = [];

    for (let i = 61; i < candles.length; i++) {
      const adxVal = adx[i] || 0;
      const isTrending = adxVal >= adxThreshold;

      if (isTrending) {
        // 추세장 → 이평선 크로스
        if (ma20[i] != null && ma60[i] != null && ma20[i - 1] != null && ma60[i - 1] != null) {
          if (ma20[i - 1] <= ma60[i - 1] && ma20[i] > ma60[i])
            signals.push({ index: i, type: "BUY", price: closes[i], reason: `추세장 골든크로스 (ADX ${adxVal.toFixed(0)})` });
          else if (ma20[i - 1] >= ma60[i - 1] && ma20[i] < ma60[i])
            signals.push({ index: i, type: "SELL", price: closes[i], reason: `추세장 데드크로스 (ADX ${adxVal.toFixed(0)})` });
        }
      } else {
        // 횡보장 → RSI 평균회귀
        if (rsi[i] != null && rsi[i - 1] != null) {
          if (rsi[i] <= 30 && rsi[i - 1] > 30)
            signals.push({ index: i, type: "BUY", price: closes[i], reason: `횡보장 RSI 과매도 (${rsi[i].toFixed(0)})` });
          else if (rsi[i] >= 70 && rsi[i - 1] < 70)
            signals.push({ index: i, type: "SELL", price: closes[i], reason: `횡보장 RSI 과매수 (${rsi[i].toFixed(0)})` });
        }
      }
    }
    return signals;
  },
};

// ━━━ 전략 24: 헤이킨 아시 추세 추종 ━━━
// 헤이킨 아시 캔들 패턴으로 추세 방향 확인 후 진입
export const strategyHeikinAshi = {
  id: "heikin_ashi",
  name: "헤이킨 아시 추세",
  desc: "HA 양봉 3연속 + 하단꼬리 없음 매수, HA 음봉 3연속 + 상단꼬리 없음 매도. 노이즈 제거 추세 추종.",
  category: "추세추종",
  risk: "낮음",
  icon: "🕯️",
  params: { consecutiveBars: 3 },
  generate(candles, params = {}) {
    const { consecutiveBars = 3 } = { ...this.params, ...params };
    // 헤이킨 아시 변환
    const ha = [];
    for (let i = 0; i < candles.length; i++) {
      const c = candles[i];
      const haClose = (c.open + c.high + c.low + c.close) / 4;
      const haOpen = i === 0 ? (c.open + c.close) / 2 : (ha[i - 1].open + ha[i - 1].close) / 2;
      const haHigh = Math.max(c.high, haOpen, haClose);
      const haLow = Math.min(c.low, haOpen, haClose);
      ha.push({ open: haOpen, high: haHigh, low: haLow, close: haClose });
    }

    const signals = [];
    for (let i = consecutiveBars; i < candles.length; i++) {
      // N연속 강한 양봉 (하단꼬리 없음 = 강한 상승)
      let bullCount = 0;
      for (let j = i - consecutiveBars + 1; j <= i; j++) {
        if (ha[j].close > ha[j].open && Math.abs(ha[j].low - Math.min(ha[j].open, ha[j].close)) < (ha[j].high - ha[j].low) * 0.1)
          bullCount++;
      }
      let prevBullCount = 0;
      for (let j = i - consecutiveBars; j < i; j++) {
        if (ha[j].close > ha[j].open && Math.abs(ha[j].low - Math.min(ha[j].open, ha[j].close)) < (ha[j].high - ha[j].low) * 0.1)
          prevBullCount++;
      }

      if (bullCount >= consecutiveBars && prevBullCount < consecutiveBars)
        signals.push({ index: i, type: "BUY", price: candles[i].close, reason: `HA ${consecutiveBars}연속 강세봉` });

      // N연속 강한 음봉
      let bearCount = 0;
      for (let j = i - consecutiveBars + 1; j <= i; j++) {
        if (ha[j].close < ha[j].open && Math.abs(ha[j].high - Math.max(ha[j].open, ha[j].close)) < (ha[j].high - ha[j].low) * 0.1)
          bearCount++;
      }
      let prevBearCount = 0;
      for (let j = i - consecutiveBars; j < i; j++) {
        if (ha[j].close < ha[j].open && Math.abs(ha[j].high - Math.max(ha[j].open, ha[j].close)) < (ha[j].high - ha[j].low) * 0.1)
          prevBearCount++;
      }

      if (bearCount >= consecutiveBars && prevBearCount < consecutiveBars)
        signals.push({ index: i, type: "SELL", price: candles[i].close, reason: `HA ${consecutiveBars}연속 약세봉` });
    }
    return signals;
  },
};

// ── 전략 목록 ────────────────────────────────────────────────────
export const ALL_STRATEGIES = [
  strategyRSI,
  strategyBB,
  strategyMACD,
  strategyMA,
  strategyVolume,
  strategyCombo,
  strategyTurtle,
  strategyKeltner,
  strategyDualMomentum,
  strategyWilliamsADX,
  strategyBBSqueeze,
  strategyTripleMA,
  strategyVWAP,
  strategyFibonacci,
  strategyMomentumChannel,
  strategyGapAndGo,
  strategySwingATR,
  strategyOBV,
  strategyMicrostructure,
  strategyStatArb,
  strategySqueezeMomentum,
  strategyConnorsRSI2,
  strategyRegimeSwitch,
  strategyHeikinAshi,
];

// ════════════════════════════════════════════════════════════════════
// 백테스팅 엔진 v2
// 슬리피지, 수수료, 포지션 사이징, 손절/익절, 봉별 자산추적
// ════════════════════════════════════════════════════════════════════

export function runBacktest(candles, signals, options = {}) {
  const {
    initialCapital = 10000,
    positionSize = 1.0,
    commission = 0.001,
    slippage = 0.0005,
    stopLoss = null,
    takeProfit = null,
  } = options;

  let capital = initialCapital;
  let position = 0;
  let entryPrice = 0;
  const trades = [];
  const equity = [];
  let peakEquity = initialCapital;
  let maxDrawdown = 0;

  // 시그널을 인덱스 순으로 정렬
  const sorted = [...signals].sort((a, b) => a.index - b.index);
  let sigIdx = 0;
  let lastAction = null;

  // 봉별로 순회하며 자산 추적
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];

    // 스톱로스 / 테이크프로핏 체크
    if (position > 0 && entryPrice > 0) {
      if (stopLoss && c.low <= entryPrice * (1 - stopLoss / 100)) {
        const sellPrice = entryPrice * (1 - stopLoss / 100) * (1 - slippage);
        const proceeds = position * sellPrice;
        const comm = proceeds * commission;
        const pnl = proceeds - comm - (position * entryPrice);
        const pnlPct = ((sellPrice / entryPrice) - 1) * 100;
        capital += proceeds - comm;
        trades.push({ type: "SELL", index: i, price: sellPrice, qty: position, pnl, pnlPct, reason: `손절 -${stopLoss}%`, time: c.time });
        position = 0; entryPrice = 0; lastAction = "SELL";
      } else if (takeProfit && c.high >= entryPrice * (1 + takeProfit / 100)) {
        const sellPrice = entryPrice * (1 + takeProfit / 100) * (1 - slippage);
        const proceeds = position * sellPrice;
        const comm = proceeds * commission;
        const pnl = proceeds - comm - (position * entryPrice);
        const pnlPct = ((sellPrice / entryPrice) - 1) * 100;
        capital += proceeds - comm;
        trades.push({ type: "SELL", index: i, price: sellPrice, qty: position, pnl, pnlPct, reason: `익절 +${takeProfit}%`, time: c.time });
        position = 0; entryPrice = 0; lastAction = "SELL";
      }
    }

    // 시그널 처리
    while (sigIdx < sorted.length && sorted[sigIdx].index === i) {
      const sig = sorted[sigIdx];
      if (sig.type === "BUY" && position === 0 && lastAction !== "BUY") {
        const buyPrice = sig.price * (1 + slippage);
        const investAmount = capital * positionSize;
        const comm = investAmount * commission;
        position = (investAmount - comm) / buyPrice;
        entryPrice = buyPrice;
        capital -= investAmount;
        lastAction = "BUY";
        trades.push({ type: "BUY", index: i, price: buyPrice, qty: position, reason: sig.reason, time: c.time });
      } else if (sig.type === "SELL" && position > 0 && lastAction !== "SELL") {
        const sellPrice = sig.price * (1 - slippage);
        const proceeds = position * sellPrice;
        const comm = proceeds * commission;
        const pnl = proceeds - comm - (position * entryPrice);
        const pnlPct = ((sellPrice / entryPrice) - 1) * 100;
        capital += proceeds - comm;
        trades.push({ type: "SELL", index: i, price: sellPrice, qty: position, pnl, pnlPct, reason: sig.reason, time: c.time });
        position = 0; entryPrice = 0; lastAction = "SELL";
      }
      sigIdx++;
    }

    // 자산 추적
    const eq = capital + (position > 0 ? position * c.close : 0);
    equity.push({ index: i, value: eq, time: c.time });
    if (eq > peakEquity) peakEquity = eq;
    const dd = peakEquity > 0 ? ((peakEquity - eq) / peakEquity) * 100 : 0;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  // 미청산 포지션 정리
  if (position > 0 && candles.length > 0) {
    const last = candles[candles.length - 1];
    const sellPrice = last.close * (1 - slippage);
    const proceeds = position * sellPrice;
    const comm = proceeds * commission;
    const pnl = proceeds - comm - (position * entryPrice);
    const pnlPct = ((sellPrice / entryPrice) - 1) * 100;
    capital += proceeds - comm;
    trades.push({ type: "SELL", index: candles.length - 1, price: sellPrice, qty: position, pnl, pnlPct, reason: "백테스트 종료 청산", time: last.time });
    position = 0;
  }

  const finalEquity = capital;
  const sellTrades = trades.filter(t => t.type === "SELL");
  const winTrades = sellTrades.filter(t => t.pnl > 0);
  const loseTrades = sellTrades.filter(t => t.pnl <= 0);
  const totalTrades = sellTrades.length;
  const winRate = totalTrades > 0 ? (winTrades.length / totalTrades) * 100 : 0;
  const totalReturn = ((finalEquity - initialCapital) / initialCapital) * 100;
  const avgWin = winTrades.length > 0 ? winTrades.reduce((a, t) => a + t.pnlPct, 0) / winTrades.length : 0;
  const avgLoss = loseTrades.length > 0 ? loseTrades.reduce((a, t) => a + t.pnlPct, 0) / loseTrades.length : 0;

  // 샤프 비율
  const returns = sellTrades.map(t => t.pnlPct / 100);
  const avgReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
  const stdReturn = returns.length > 1
    ? Math.sqrt(returns.reduce((a, r) => a + (r - avgReturn) ** 2, 0) / (returns.length - 1)) : 0;
  const sharpeRatio = stdReturn > 0 ? (avgReturn / stdReturn) * Math.sqrt(252) : 0;

  // 프로핏 팩터
  const grossProfit = winTrades.reduce((a, t) => a + t.pnl, 0);
  const grossLoss = Math.abs(loseTrades.reduce((a, t) => a + t.pnl, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

  // 최대 연속 손실
  let maxConsecLoss = 0, curConsecLoss = 0;
  sellTrades.forEach(t => {
    if (t.pnl <= 0) { curConsecLoss++; maxConsecLoss = Math.max(maxConsecLoss, curConsecLoss); }
    else curConsecLoss = 0;
  });

  // Buy & Hold 비교
  const bhReturn = candles.length >= 2
    ? ((candles[candles.length - 1].close - candles[0].close) / candles[0].close) * 100 : 0;

  return {
    initialCapital,
    finalEquity: +finalEquity.toFixed(2),
    totalReturn: +totalReturn.toFixed(2),
    buyHoldReturn: +bhReturn.toFixed(2),
    totalTrades,
    winRate: +winRate.toFixed(1),
    avgWin: +avgWin.toFixed(2),
    avgLoss: +avgLoss.toFixed(2),
    maxDrawdown: +maxDrawdown.toFixed(2),
    sharpeRatio: +sharpeRatio.toFixed(2),
    profitFactor: +profitFactor.toFixed(2),
    maxConsecLoss,
    trades,
    equity,
  };
}

// ════════════════════════════════════════════════════════════════════
// 시장 진단 엔진
// ════════════════════════════════════════════════════════════════════

export function diagnoseMarket(candles) {
  if (!candles || candles.length < 60) return { regime: "unknown", volatility: "unknown", trend: "unknown" };

  const closes = candles.map(c => c.close);
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  const last = closes.length - 1;

  // 추세 판단
  const sma20 = calcSMA(closes, 20);
  const sma60 = calcSMA(closes, 60);
  let trend = "횡보";
  if (sma20[last] && sma60[last]) {
    if (sma20[last] > sma60[last] * 1.02) trend = "상승";
    else if (sma20[last] < sma60[last] * 0.98) trend = "하락";
  }

  // 변동성 판단
  const atr = calcATR(highs, lows, closes, 14);
  const atrLast = atr[last];
  const atrPct = atrLast && closes[last] ? (atrLast / closes[last]) * 100 : 0;
  let volatility = "보통";
  if (atrPct > 3) volatility = "높음";
  else if (atrPct < 1) volatility = "낮음";

  // RSI
  const rsi = calcRSI(closes);
  const rsiLast = rsi[last];
  let momentum = "중립";
  if (rsiLast > 70) momentum = "과매수";
  else if (rsiLast < 30) momentum = "과매도";
  else if (rsiLast > 55) momentum = "강세";
  else if (rsiLast < 45) momentum = "약세";

  // 시장 국면
  let regime = "혼조";
  if (trend === "상승" && volatility !== "높음") regime = "안정적 상승";
  else if (trend === "상승" && volatility === "높음") regime = "변동성 상승";
  else if (trend === "하락" && volatility === "높음") regime = "급락";
  else if (trend === "하락" && volatility !== "높음") regime = "완만한 하락";
  else if (trend === "횡보" && volatility === "낮음") regime = "저변동 횡보";
  else if (trend === "횡보" && volatility === "높음") regime = "변동성 횡보";

  return { regime, trend, volatility, momentum, atrPct: +atrPct.toFixed(2), rsi: rsiLast ? +rsiLast.toFixed(1) : null };
}

// ════════════════════════════════════════════════════════════════════
// 전략 추천 엔진
// ════════════════════════════════════════════════════════════════════

export function recommendStrategies(marketDiagnosis) {
  const { regime, trend, volatility, momentum } = marketDiagnosis;
  const recs = [];

  if (regime === "안정적 상승" || trend === "상승") {
    recs.push({ strategy: strategyMA, score: 9, reason: "상승 추세에서 이평선 크로스가 가장 효과적" });
    recs.push({ strategy: strategyMACD, score: 8, reason: "추세 지속 확인에 MACD가 유용" });
    recs.push({ strategy: strategyTripleMA, score: 8, reason: "삼중 이평선 정배열로 추세 라이딩" });
    recs.push({ strategy: strategyHeikinAshi, score: 8, reason: "HA 캔들 노이즈 제거 — 추세 라이딩 최적" });
    recs.push({ strategy: strategyRegimeSwitch, score: 7, reason: "추세장 감지 → 자동 MA 크로스 전환" });
    recs.push({ strategy: strategyDualMomentum, score: 7, reason: "듀얼 모멘텀으로 절대/상대 강세 확인" });
    recs.push({ strategy: strategyVolume, score: 7, reason: "거래량 돌파로 강한 모멘텀 포착" });
    recs.push({ strategy: strategyOBV, score: 7, reason: "OBV 상향돌파 — 스마트머니 추적" });
    recs.push({ strategy: strategyMicrostructure, score: 6, reason: "매수 압력 우위 감지 — 단기 모멘텀" });
    recs.push({ strategy: strategyMomentumChannel, score: 6, reason: "다중 필터 모멘텀으로 추세 확인" });
  }

  if (regime === "저변동 횡보" || trend === "횡보") {
    recs.push({ strategy: strategyBB, score: 9, reason: "횡보장에서 볼린저밴드 바운스가 최적" });
    recs.push({ strategy: strategyStatArb, score: 9, reason: "Z-Score 평균회귀 — 횡보장 최적 전략" });
    recs.push({ strategy: strategyConnorsRSI2, score: 8, reason: "RSI(2) 극단값 — 초단기 평균회귀" });
    recs.push({ strategy: strategyKeltner, score: 8, reason: "켈트너 채널 회귀도 횡보장에 효과적" });
    recs.push({ strategy: strategyRSI, score: 8, reason: "RSI 반전이 레인지바운드에서 효과적" });
    recs.push({ strategy: strategyVWAP, score: 8, reason: "VWAP 반전 — 기관 매집 가능성 포착" });
    recs.push({ strategy: strategyRegimeSwitch, score: 7, reason: "횡보장 감지 → 자동 RSI 회귀 전환" });
    recs.push({ strategy: strategyFibonacci, score: 7, reason: "피보나치 되돌림 구간에서 지지 확인" });
    recs.push({ strategy: strategyCombo, score: 7, reason: "이중 필터로 가짜 신호 제거" });
    recs.push({ strategy: strategyBBSqueeze, score: 6, reason: "스퀴즈 후 돌파 가능성 대비" });
    recs.push({ strategy: strategySqueezeMomentum, score: 6, reason: "TTM 스퀴즈 — 변동성 수축 후 폭발 대비" });
    recs.push({ strategy: strategySwingATR, score: 6, reason: "ATR 기반 스윙 구간 트레이딩" });
  }

  if (momentum === "과매도" || regime === "급락") {
    recs.push({ strategy: strategyRSI, score: 10, reason: "과매도 구간 — RSI 반전 최적 진입" });
    recs.push({ strategy: strategyConnorsRSI2, score: 9, reason: "RSI(2) 극단 과매도 — 래리 코너스 반전 매수" });
    recs.push({ strategy: strategyStatArb, score: 9, reason: "Z-Score -2σ 이하 이탈 — 통계적 반등" });
    recs.push({ strategy: strategyCombo, score: 9, reason: "RSI+스토캐스틱 이중 확인 바닥 매수" });
    recs.push({ strategy: strategyWilliamsADX, score: 8, reason: "Williams %R + ADX로 추세 내 저점" });
    recs.push({ strategy: strategyBB, score: 7, reason: "BB 하단 터치 반등 가능성" });
    recs.push({ strategy: strategyFibonacci, score: 7, reason: "피보나치 61.8% 되돌림 지지 확인" });
    recs.push({ strategy: strategyVWAP, score: 6, reason: "VWAP 하단 이탈 후 복귀 매수" });
  }

  if (volatility === "높음") {
    recs.push({ strategy: strategyVolume, score: 8, reason: "높은 변동성에서 거래량 돌파가 강한 시그널" });
    recs.push({ strategy: strategySqueezeMomentum, score: 8, reason: "TTM 스퀴즈 해제 — 방향성 폭발 포착" });
    recs.push({ strategy: strategyMicrostructure, score: 7, reason: "매수/매도 압력 불균형 — 단기 방향성" });
    recs.push({ strategy: strategyBBSqueeze, score: 7, reason: "변동성 압축 후 폭발 포착" });
    recs.push({ strategy: strategyTurtle, score: 7, reason: "터틀 트레이딩 — 변동성 돌파" });
    recs.push({ strategy: strategySwingATR, score: 7, reason: "ATR 스윙 — 변동성 구간 트레이딩" });
    recs.push({ strategy: strategyGapAndGo, score: 6, reason: "갭 앤 고 — 단기 모멘텀 포착" });
  }

  if (trend === "하락" && volatility !== "높음") {
    recs.push({ strategy: strategyMACD, score: 7, reason: "하락 추세 전환 포착에 MACD 유용" });
    recs.push({ strategy: strategyHeikinAshi, score: 7, reason: "HA 캔들 반전 패턴 — 하락 추세 종료 감지" });
    recs.push({ strategy: strategyConnorsRSI2, score: 7, reason: "RSI(2) 과매도 — 단기 반등 포착" });
    recs.push({ strategy: strategyRSI, score: 6, reason: "과매도 반등 가능성 모니터링" });
    recs.push({ strategy: strategyKeltner, score: 6, reason: "켈트너 채널 하단 바운스" });
    recs.push({ strategy: strategyOBV, score: 6, reason: "OBV 반전 — 바닥 형성 확인" });
    recs.push({ strategy: strategyStatArb, score: 6, reason: "Z-Score 이탈 → 평균회귀 기대" });
  }

  // 중복 제거 + 점수 순 정렬
  const seen = new Set();
  return recs.filter(r => {
    if (seen.has(r.strategy.id)) return false;
    seen.add(r.strategy.id); return true;
  }).sort((a, b) => b.score - a.score).slice(0, 5);
}

// ════════════════════════════════════════════════════════════════════
// QA 검증
// ════════════════════════════════════════════════════════════════════

export function validateSignals(signals) {
  const issues = [];
  let lastBuy = null;
  for (const sig of signals) {
    if (sig.type === "BUY") {
      if (lastBuy) issues.push(`중복 매수 시그널 at index ${sig.index}`);
      lastBuy = sig;
    } else if (sig.type === "SELL") {
      if (!lastBuy) issues.push(`매수 없이 매도 시그널 at index ${sig.index}`);
      lastBuy = null;
    }
  }
  return { valid: issues.length === 0, issues };
}
