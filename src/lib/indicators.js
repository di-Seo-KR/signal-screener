// ════════════════════════════════════════════════════════════════════
// 기술 지표 계산 유틸리티 (순수 함수 — React/DOM 의존 X)
//
// App.jsx 분리 1단계로 이곳에 옮김. 입출력은 동일하므로 import 만 추가하면 됨.
// 추후 다른 컴포넌트(차트 모달, 백테스트, 봇 등)에서도 자유롭게 재사용.
// ════════════════════════════════════════════════════════════════════

export function calcRSI(closes, period = 14) {
  if (closes.length < period + 1) return null;
  let ag = 0, al = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) ag += d; else al -= d;
  }
  ag /= period; al /= period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    ag = (ag * (period - 1) + Math.max(d, 0)) / period;
    al = (al * (period - 1) + Math.max(-d, 0)) / period;
  }
  return al === 0 ? 100 : 100 - 100 / (1 + ag / al);
}

// RSI 전체 시계열 배열 반환 (다이버전스 분석용)
export function calcRSIArray(closes, period = 14) {
  if (closes.length < period + 1) return [];
  let ag = 0, al = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) ag += d; else al -= d;
  }
  ag /= period; al /= period;
  const rsiArr = [al === 0 ? 100 : 100 - 100 / (1 + ag / al)];
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    ag = (ag * (period - 1) + Math.max(d, 0)) / period;
    al = (al * (period - 1) + Math.max(-d, 0)) / period;
    rsiArr.push(al === 0 ? 100 : 100 - 100 / (1 + ag / al));
  }
  return rsiArr;
}

// 볼륨 프로파일 — POC(Point of Control) 산출
export function calcVolumeProfile(closes, volumes, bins = 20) {
  if (closes.length < 10 || volumes.length < 10) return null;
  const min = Math.min(...closes), max = Math.max(...closes);
  if (max === min) return null;
  const step = (max - min) / bins;
  const profile = new Array(bins).fill(0);
  closes.forEach((c, i) => {
    const bin = Math.min(Math.floor((c - min) / step), bins - 1);
    profile[bin] += volumes[i] || 0;
  });
  const pocBin = profile.indexOf(Math.max(...profile));
  const poc = min + (pocBin + 0.5) * step;
  return { poc, profile, min, max, step };
}

export function calcSMA(data, period) {
  if (data.length < period) return null;
  return data.slice(-period).reduce((a, b) => a + b, 0) / period;
}

export function calcBB(closes, period = 20, mult = 2) {
  if (closes.length < period) return null;
  const s = closes.slice(-period);
  const mean = s.reduce((a, b) => a + b, 0) / period;
  const std = Math.sqrt(s.reduce((a, b) => a + (b - mean) ** 2, 0) / period);
  return { upper: mean + mult * std, middle: mean, lower: mean - mult * std };
}

export function calcMACD(closes) {
  if (closes.length < 35) return { goldenCross: false };
  const k12 = 2 / 13, k26 = 2 / 27, k9 = 2 / 10;
  let e12 = closes.slice(0, 12).reduce((a, b) => a + b, 0) / 12;
  let e26 = closes.slice(0, 26).reduce((a, b) => a + b, 0) / 26;
  const macdArr = [];
  for (let i = 0; i < closes.length; i++) {
    if (i >= 12) e12 = closes[i] * k12 + e12 * (1 - k12);
    if (i >= 26) { e26 = closes[i] * k26 + e26 * (1 - k26); macdArr.push(e12 - e26); }
  }
  if (macdArr.length < 9) return { goldenCross: false };
  let sig = macdArr.slice(0, 9).reduce((a, b) => a + b, 0) / 9;
  let prevSig = sig;
  for (let i = 9; i < macdArr.length - 1; i++) prevSig = macdArr[i] * k9 + prevSig * (1 - k9);
  for (let i = 9; i < macdArr.length; i++) sig = macdArr[i] * k9 + sig * (1 - k9);
  const cur = macdArr[macdArr.length - 1], prev = macdArr[macdArr.length - 2];
  return { goldenCross: prev <= prevSig && cur > sig, macdLine: cur, signalLine: sig };
}

// MACD 히스토그램 전체 배열 반환 (다이버전스 분석용, 1회 계산으로 최적화)
export function calcMACDHistogram(closes) {
  if (closes.length < 35) return [];
  const k12 = 2 / 13, k26 = 2 / 27, k9 = 2 / 10;
  let e12 = closes.slice(0, 12).reduce((a, b) => a + b, 0) / 12;
  let e26 = closes.slice(0, 26).reduce((a, b) => a + b, 0) / 26;
  const macdArr = [];
  for (let i = 0; i < closes.length; i++) {
    if (i >= 12) e12 = closes[i] * k12 + e12 * (1 - k12);
    if (i >= 26) { e26 = closes[i] * k26 + e26 * (1 - k26); macdArr.push(e12 - e26); }
  }
  if (macdArr.length < 9) return [];
  let sig = macdArr.slice(0, 9).reduce((a, b) => a + b, 0) / 9;
  const histogram = new Array(9).fill(0); // 처음 9개는 시그널 수렴 전이므로 0
  for (let i = 9; i < macdArr.length; i++) {
    sig = macdArr[i] * k9 + sig * (1 - k9);
    histogram.push(macdArr[i] - sig);
  }
  return histogram;
}

export function calcStochastic(highs, lows, closes, kPeriod = 14, dPeriod = 3) {
  if (closes.length < kPeriod) return null;
  const kArr = [];
  for (let i = kPeriod - 1; i < closes.length; i++) {
    const hh = Math.max(...highs.slice(i - kPeriod + 1, i + 1));
    const ll = Math.min(...lows.slice(i - kPeriod + 1, i + 1));
    kArr.push(hh === ll ? 50 : ((closes[i] - ll) / (hh - ll)) * 100);
  }
  if (kArr.length < dPeriod) return null;
  const kLast = kArr[kArr.length - 1];
  const dLast = kArr.slice(-dPeriod).reduce((a, b) => a + b, 0) / dPeriod;
  return { k: kLast, d: dLast };
}

export function calcWilliamsR(highs, lows, closes, period = 14) {
  if (closes.length < period) return null;
  const hh = Math.max(...highs.slice(-period));
  const ll = Math.min(...lows.slice(-period));
  if (hh === ll) return -50;
  return ((hh - closes[closes.length - 1]) / (hh - ll)) * -100;
}

export function calcATR(highs, lows, closes, period = 14) {
  if (closes.length < period + 1) return null;
  const trs = [];
  for (let i = 1; i < closes.length; i++) {
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i-1]),
      Math.abs(lows[i] - closes[i-1])
    );
    trs.push(tr);
  }
  if (trs.length < period) return null;
  let atr = trs.slice(0, period).reduce((a,b) => a+b, 0) / period;
  for (let i = period; i < trs.length; i++) {
    atr = (atr * (period - 1) + trs[i]) / period;
  }
  return atr;
}

export function calcSimpleADX(highs, lows, closes, period = 14) {
  if (closes.length < period + 2) return null;
  let plusDM = 0, minusDM = 0, tr = 0;
  for (let i = 1; i <= period; i++) {
    const upMove = highs[i] - highs[i-1];
    const downMove = lows[i-1] - lows[i];
    plusDM += (upMove > downMove && upMove > 0) ? upMove : 0;
    minusDM += (downMove > upMove && downMove > 0) ? downMove : 0;
    tr += Math.max(highs[i]-lows[i], Math.abs(highs[i]-closes[i-1]), Math.abs(lows[i]-closes[i-1]));
  }
  for (let i = period + 1; i < closes.length; i++) {
    const upMove = highs[i] - highs[i-1];
    const downMove = lows[i-1] - lows[i];
    plusDM = plusDM - plusDM/period + ((upMove > downMove && upMove > 0) ? upMove : 0);
    minusDM = minusDM - minusDM/period + ((downMove > upMove && downMove > 0) ? downMove : 0);
    tr = tr - tr/period + Math.max(highs[i]-lows[i], Math.abs(highs[i]-closes[i-1]), Math.abs(lows[i]-closes[i-1]));
  }
  const plusDI = tr > 0 ? (plusDM / tr) * 100 : 0;
  const minusDI = tr > 0 ? (minusDM / tr) * 100 : 0;
  const dx = (plusDI + minusDI) > 0 ? Math.abs(plusDI - minusDI) / (plusDI + minusDI) * 100 : 0;
  return { adx: dx, plusDI, minusDI };
}

// ── 공유 유틸: swing high/low 탐지 (MACD/RSI 다이버전스 공용) ──
export function findSwingPoints(arr, type, count = 3) {
  const swings = [];
  for (let i = 1; i < arr.length - 1; i++) {
    if (type === "high" && arr[i] > arr[i - 1] && arr[i] >= arr[i + 1]) swings.push({ idx: i, val: arr[i] });
    if (type === "low" && arr[i] < arr[i - 1] && arr[i] <= arr[i + 1]) swings.push({ idx: i, val: arr[i] });
  }
  return swings.slice(-count);
}
