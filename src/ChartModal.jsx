import { useEffect, useRef, useState, useCallback } from "react";
import { createChart, CrosshairMode, LineStyle } from "lightweight-charts";
import { useIsMobile } from "./ui/useBreakpoint.jsx";

// ── 보조지표 계산 ────────────────────────────────────────────────
function calcSMA(data, period) {
  return data.map((_, i) => {
    if (i < period - 1) return null;
    const slice = data.slice(i - period + 1, i + 1);
    return slice.reduce((a, b) => a + b, 0) / period;
  });
}

function calcBB(closes, period = 20, mult = 2) {
  return closes.map((_, i) => {
    if (i < period - 1) return null;
    const slice = closes.slice(i - period + 1, i + 1);
    const mean = slice.reduce((a, b) => a + b, 0) / period;
    const std = Math.sqrt(slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period);
    return { upper: mean + mult * std, middle: mean, lower: mean - mult * std };
  });
}

function calcRSI(closes, period = 14) {
  const result = new Array(closes.length).fill(null);
  if (closes.length < period + 1) return result;
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) avgGain += d; else avgLoss -= d;
  }
  avgGain /= period; avgLoss /= period;
  result[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(d, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-d, 0)) / period;
    result[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return result;
}

function calcMACD(closes) {
  const k12 = 2 / 13, k26 = 2 / 27, k9 = 2 / 10;
  const n = closes.length;
  const macdLine = new Array(n).fill(null);
  const signalLine = new Array(n).fill(null);
  const histogram = new Array(n).fill(null);
  if (n < 35) return { macdLine, signalLine, histogram };

  let e12 = closes.slice(0, 12).reduce((a, b) => a + b, 0) / 12;
  let e26 = closes.slice(0, 26).reduce((a, b) => a + b, 0) / 26;
  const macdArr = [];
  for (let i = 0; i < n; i++) {
    if (i >= 12) e12 = closes[i] * k12 + e12 * (1 - k12);
    if (i >= 26) { e26 = closes[i] * k26 + e26 * (1 - k26); macdArr.push({ i, v: e12 - e26 }); }
  }
  if (macdArr.length < 9) return { macdLine, signalLine, histogram };

  let sig = macdArr.slice(0, 9).reduce((a, b) => a + b.v, 0) / 9;
  macdArr.slice(9).forEach(({ i, v }) => {
    sig = v * k9 + sig * (1 - k9);
    macdLine[i] = +v.toFixed(6);
    signalLine[i] = +sig.toFixed(6);
    histogram[i] = +(v - sig).toFixed(6);
  });
  return { macdLine, signalLine, histogram };
}

// ── 시간 변환: 인트라데이는 Unix timestamp, 일봉 이상은 business day ──
function isIntraday(tf) {
  return ["1m", "5m", "10m", "30m", "1h", "2h", "4h"].includes(tf);
}

// lightweight-charts는 UTC 기준으로 시간을 렌더링하므로,
// 사용자 로컬 타임존 오프셋을 보정하여 로컬 시간이 표시되게 함
const LOCAL_TZ_OFFSET = new Date().getTimezoneOffset() * 60; // 초 단위 (KST = -32400)

function tsToTime(ts, tf) {
  if (isIntraday(tf)) {
    // Unix timestamp (초) + 로컬 타임존 보정
    // 예: KST(+9) → UTC timestamp에 +9시간을 더해 차트에서 로컬 시간 표시
    return ts - LOCAL_TZ_OFFSET;
  }
  // Business day format for daily+ (Date 생성자가 로컬 타임존 자동 적용)
  const d = new Date(ts * 1000);
  return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
}

function deduplicateCandles(candles, tf) {
  const map = new Map();
  for (const c of candles) {
    let key;
    if (isIntraday(tf)) {
      key = c.time; // Unix timestamp
    } else {
      key = `${c.time.year}-${c.time.month}-${c.time.day}`;
    }
    map.set(key, c);
  }
  return Array.from(map.values()).sort((a, b) => {
    if (isIntraday(tf)) return a.time - b.time;
    if (a.time.year !== b.time.year) return a.time.year - b.time.year;
    if (a.time.month !== b.time.month) return a.time.month - b.time.month;
    return a.time.day - b.time.day;
  });
}

// ── 타임프레임 설정 (10개 세분화) ──
const TF_CONFIG = {
  "1m":  { label: "1분",   interval: "1m",  range: "1d" },
  "5m":  { label: "5분",   interval: "5m",  range: "5d" },
  "10m": { label: "10분",  interval: "5m",  range: "5d" },  // Yahoo doesn't support 10m, use 5m
  "30m": { label: "30분",  interval: "30m", range: "1mo" },
  "1h":  { label: "1시간", interval: "1h",  range: "6mo" },
  "2h":  { label: "2시간", interval: "1h",  range: "6mo" },  // Aggregate from 1h
  "4h":  { label: "4시간", interval: "1h",  range: "1y" },   // Aggregate from 1h
  "1d":  { label: "날봉",  interval: "1d",  range: "1y" },   // 최근 1년 (더 세밀한 캔들)
  "1wk": { label: "주봉",  interval: "1wk", range: "5y" },   // 최근 5년
  "1mo": { label: "월봉",  interval: "1mo", range: "max" },  // 상장일부터 전체
};

const CRYPTO_TF = {
  "1m":  { label: "1분",   days: "1" },
  "5m":  { label: "5분",   days: "1" },
  "10m": { label: "10분",  days: "1" },
  "30m": { label: "30분",  days: "14" },
  "1h":  { label: "1시간", days: "30" },
  "2h":  { label: "2시간", days: "90" },
  "4h":  { label: "4시간", days: "180" },
  "1d":  { label: "날봉",  days: "max" },   // 상장일부터 전체
  "1wk": { label: "주봉",  days: "max" },   // 상장일부터 전체
  "1mo": { label: "월봉",  days: "max" },   // 상장일부터 전체
};

// ── Aggregate candles for 10m/2h/4h (from smaller intervals) ──
function aggregateCandles(candles, factor) {
  if (factor <= 1) return candles;
  const result = [];
  for (let i = 0; i < candles.length; i += factor) {
    const chunk = candles.slice(i, i + factor);
    if (!chunk.length) break;
    result.push({
      time: chunk[0].time,
      open: chunk[0].open,
      high: Math.max(...chunk.map(c => c.high)),
      low: Math.min(...chunk.map(c => c.low)),
      close: chunk[chunk.length - 1].close,
      volume: chunk.reduce((s, c) => s + (c.volume || 0), 0),
    });
  }
  return result;
}

// ── colors — dark / light
// Zepta tokens.css 와 동기화
const CC_DARK = {
  bg: "#070B14", card: "#101828", card2: "#161F33",
  border: "#1E2A42", border2: "#2A3A58",
  blue: "#3B82F6", green: "#10D884", red: "#FF4D64", yellow: "#FFB020",
  text1: "#F1F5FB", text2: "#9AA7BD", text3: "#64728C",
  gridColor: "#1E2A42", crossColor: "#3B4D6D", labelBg: "#3B82F6", chartText: "#9AA7BD",
};
const CC_LIGHT = {
  bg: "#F6F8FC", card: "#FFFFFF", card2: "#F1F4F9",
  border: "#E2E6EF", border2: "#D0D6E1",
  blue: "#2563EB", green: "#059B64", red: "#E11D48", yellow: "#D08300",
  text1: "#0A1224", text2: "#4C5870", text3: "#7D889D",
  gridColor: "#E2E6EF", crossColor: "#B7C0CE", labelBg: "#2563EB", chartText: "#7D889D",
};

// Chart options (theme-aware)
function makeChartOptions(height, width, tf, cc) {
  const intra = isIntraday(tf);
  return {
    layout: {
      background: { color: cc.bg },
      textColor: cc.chartText,
      fontFamily: "'Pretendard', 'Apple SD Gothic Neo', system-ui, sans-serif",
    },
    grid: {
      vertLines: { color: cc.gridColor },
      horzLines: { color: cc.gridColor },
    },
    crosshair: {
      mode: CrosshairMode.Normal,
      vertLine: { color: cc.crossColor, labelBackgroundColor: cc.labelBg },
      horzLine: { color: cc.crossColor, labelBackgroundColor: cc.labelBg },
    },
    rightPriceScale: {
      borderColor: cc.gridColor,
      scaleMargins: { top: 0.08, bottom: 0.05 },
      minimumWidth: 100,
      entireTextOnly: true,
    },
    timeScale: {
      borderColor: cc.gridColor,
      timeVisible: intra,
      secondsVisible: false,
      // ★ 2026-06-12 (대표 피드백 — 트레이딩뷰 방식): fixRightEdge 가 마지막 봉을 우측 끝에
      //   고정해 현재가 오른쪽 여백(rightOffset)을 죽이고 있었음 → 해제 + 여백 8봉.
      fixLeftEdge: false,
      fixRightEdge: false,
      rightOffset: 8,
    },
    height,
    width: width || 300,
    handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false, touch: true },
    // ★ 휠 줌 허용 — 트레이딩뷰와 동일 (모바일은 기존 핀치 유지)
    handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: true, axisDoubleClickReset: true },
    kineticScroll: { mouse: false, touch: true },
  };
}

// ── Price formatting with commas ──
function fmtPrice(p, market) {
  if (!p && p !== 0) return "—";
  if (market === "kr") return `₩${Math.round(p).toLocaleString("ko-KR")}`;
  if (p < 0.01) return `$${p.toFixed(6)}`;
  if (p < 1) return `$${p.toFixed(4)}`;
  return `$${p.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ── Default indicator settings ──
const DEFAULT_SETTINGS = {
  maList: [
    { enabled: false, period: 5,   color: "#facc15", width: 1.5 },
    { enabled: true,  period: 20,  color: "#38bdf8", width: 2 },
    { enabled: true,  period: 60,  color: "#f97316", width: 2 },
    { enabled: true,  period: 200, color: "#a855f7", width: 2.5 },
  ],
  bb: { enabled: true, period: 20, mult: 2 },
  rsi: { enabled: true, period: 14 },
  macd: { enabled: true },
  vol: { enabled: true },
};

// ── 투자진단 분석 엔진 v2 (고도화) ──────────────────────────────
// 추가 보조지표 함수들
function calcStochastic(highs, lows, closes, kPeriod = 14, dPeriod = 3) {
  const kArr = new Array(closes.length).fill(null);
  for (let i = kPeriod - 1; i < closes.length; i++) {
    const hh = Math.max(...highs.slice(i - kPeriod + 1, i + 1));
    const ll = Math.min(...lows.slice(i - kPeriod + 1, i + 1));
    kArr[i] = hh === ll ? 50 : ((closes[i] - ll) / (hh - ll)) * 100;
  }
  const dArr = new Array(closes.length).fill(null);
  for (let i = 0; i < closes.length; i++) {
    if (i < kPeriod - 1 + dPeriod - 1 || kArr[i] == null) continue;
    const slice = kArr.slice(i - dPeriod + 1, i + 1).filter(v => v != null);
    if (slice.length === dPeriod) dArr[i] = slice.reduce((a, b) => a + b, 0) / dPeriod;
  }
  return { k: kArr, d: dArr };
}

function calcATR(highs, lows, closes, period = 14) {
  const tr = new Array(closes.length).fill(0);
  tr[0] = highs[0] - lows[0];
  for (let i = 1; i < closes.length; i++) {
    tr[i] = Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1]));
  }
  const atr = new Array(closes.length).fill(null);
  if (closes.length >= period) {
    atr[period - 1] = tr.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < closes.length; i++) {
      atr[i] = (atr[i - 1] * (period - 1) + tr[i]) / period;
    }
  }
  return atr;
}

function calcWilliamsR(highs, lows, closes, period = 14) {
  const wr = new Array(closes.length).fill(null);
  for (let i = period - 1; i < closes.length; i++) {
    const hh = Math.max(...highs.slice(i - period + 1, i + 1));
    const ll = Math.min(...lows.slice(i - period + 1, i + 1));
    wr[i] = hh === ll ? -50 : ((hh - closes[i]) / (hh - ll)) * -100;
  }
  return wr;
}

function calcADX(highs, lows, closes, period = 14) {
  const n = closes.length;
  if (n < period * 2) return new Array(n).fill(null);
  const pDM = [], nDM = [], tr = [];
  for (let i = 1; i < n; i++) {
    const upMove = highs[i] - highs[i - 1];
    const dnMove = lows[i - 1] - lows[i];
    pDM.push(upMove > dnMove && upMove > 0 ? upMove : 0);
    nDM.push(dnMove > upMove && dnMove > 0 ? dnMove : 0);
    tr.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
  }
  // Smooth with Wilder's method
  const smooth = (arr) => {
    const s = [arr.slice(0, period).reduce((a, b) => a + b, 0)];
    for (let i = period; i < arr.length; i++) s.push(s[s.length - 1] - s[s.length - 1] / period + arr[i]);
    return s;
  };
  const sTR = smooth(tr), sPDM = smooth(pDM), sNDM = smooth(nDM);
  const dx = [];
  for (let i = 0; i < sTR.length; i++) {
    const pDI = sTR[i] > 0 ? (sPDM[i] / sTR[i]) * 100 : 0;
    const nDI = sTR[i] > 0 ? (sNDM[i] / sTR[i]) * 100 : 0;
    dx.push(pDI + nDI > 0 ? Math.abs(pDI - nDI) / (pDI + nDI) * 100 : 0);
  }
  const adxArr = new Array(n).fill(null);
  if (dx.length >= period) {
    let adxSum = dx.slice(0, period).reduce((a, b) => a + b, 0) / period;
    adxArr[period * 2 - 1] = adxSum;
    for (let i = period; i < dx.length; i++) {
      adxSum = (adxSum * (period - 1) + dx[i]) / period;
      adxArr[i + period] = adxSum;
    }
  }
  return adxArr;
}

function calcOBV(closes, volumes) {
  const obv = [0];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i] > closes[i - 1]) obv.push(obv[i - 1] + volumes[i]);
    else if (closes[i] < closes[i - 1]) obv.push(obv[i - 1] - volumes[i]);
    else obv.push(obv[i - 1]);
  }
  return obv;
}

// ── CMF (Chaikin Money Flow) ── 수급 방향성 정밀 분석
function calcCMF(highs, lows, closes, volumes, period = 20) {
  const n = closes.length;
  if (n < period) return null;
  let sumMFV = 0, sumVol = 0;
  for (let i = n - period; i < n; i++) {
    const hl = highs[i] - lows[i];
    const mfm = hl > 0 ? ((closes[i] - lows[i]) - (highs[i] - closes[i])) / hl : 0;
    sumMFV += mfm * (volumes[i] || 0);
    sumVol += (volumes[i] || 0);
  }
  return sumVol > 0 ? sumMFV / sumVol : 0;
}

// ── +DI / -DI 추출 (ADX 함수와 별도로 방향성 지표 리턴) ──
function calcDMI(highs, lows, closes, period = 14) {
  const n = highs.length;
  if (n < period + 1) return { pDI: null, nDI: null };
  const pDM = [], nDM = [], tr = [];
  for (let i = 1; i < n; i++) {
    const upMove = highs[i] - highs[i - 1];
    const dnMove = lows[i - 1] - lows[i];
    pDM.push(upMove > dnMove && upMove > 0 ? upMove : 0);
    nDM.push(dnMove > upMove && dnMove > 0 ? dnMove : 0);
    tr.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
  }
  const smooth = (arr) => {
    const s = [arr.slice(0, period).reduce((a, b) => a + b, 0)];
    for (let i = period; i < arr.length; i++) s.push(s[s.length - 1] - s[s.length - 1] / period + arr[i]);
    return s;
  };
  const sTR = smooth(tr), sPDM = smooth(pDM), sNDM = smooth(nDM);
  const last = sTR.length - 1;
  const pDI = sTR[last] > 0 ? (sPDM[last] / sTR[last]) * 100 : 0;
  const nDI = sTR[last] > 0 ? (sNDM[last] / sTR[last]) * 100 : 0;
  return { pDI, nDI };
}

// ── Keltner Channel ── BB와 병행하여 스퀴즈 정밀 감지
function calcKeltner(closes, highs, lows, emaPeriod = 20, atrPeriod = 10, mult = 1.5) {
  const n = closes.length;
  if (n < Math.max(emaPeriod, atrPeriod)) return null;
  // EMA
  const k = 2 / (emaPeriod + 1);
  let ema = closes.slice(0, emaPeriod).reduce((a, b) => a + b, 0) / emaPeriod;
  for (let i = emaPeriod; i < n; i++) ema = closes[i] * k + ema * (1 - k);
  // ATR
  let atr = 0;
  for (let i = n - atrPeriod; i < n; i++) {
    atr += Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[Math.max(0, i - 1)]), Math.abs(lows[i] - closes[Math.max(0, i - 1)]));
  }
  atr /= atrPeriod;
  return { mid: ema, upper: ema + mult * atr, lower: ema - mult * atr, atr };
}

function runDiagnosis(candles) {
  if (!candles || candles.length < 20) return null;
  const closes = candles.map(c => c.close);
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  const volumes = candles.map(c => c.volume || 0);
  const n = closes.length;
  const last = closes[n - 1];
  const prev = closes[n - 2];

  // ── 기본 지표 ──
  const rsiArr = calcRSI(closes, 14);
  const rsi = rsiArr[n - 1];
  const sma5 = n >= 5 ? closes.slice(-5).reduce((a, b) => a + b, 0) / 5 : last;
  const sma10 = n >= 10 ? closes.slice(-10).reduce((a, b) => a + b, 0) / 10 : last;
  const sma20 = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const sma50 = n >= 50 ? closes.slice(-50).reduce((a, b) => a + b, 0) / 50 : null;
  const sma120 = n >= 120 ? closes.slice(-120).reduce((a, b) => a + b, 0) / 120 : null;
  const sma200 = n >= 200 ? closes.slice(-200).reduce((a, b) => a + b, 0) / 200 : null;
  const bbArr = calcBB(closes, 20, 2);
  const bb = bbArr[n - 1];
  const { macdLine, signalLine, histogram } = calcMACD(closes);
  const macdVal = macdLine[n - 1];
  const sigVal = signalLine[n - 1];
  const histVal = histogram[n - 1];
  const prevHist = histogram[n - 2];

  // ── 고급 지표 ──
  const stoch = calcStochastic(highs, lows, closes, 14, 3);
  const stochK = stoch.k[n - 1];
  const stochD = stoch.d[n - 1];
  const atrArr = calcATR(highs, lows, closes, 14);
  const atr = atrArr[n - 1];
  const wrArr = calcWilliamsR(highs, lows, closes, 14);
  const wr = wrArr[n - 1];
  const adxArr = calcADX(highs, lows, closes, 14);
  const adx = adxArr[n - 1];
  const obv = calcOBV(closes, volumes);

  // 거래량 분석
  const avgVol20 = volumes.slice(-20).reduce((a, b) => a + b, 0) / Math.min(volumes.length, 20);
  const avgVol5 = n >= 5 ? volumes.slice(-5).reduce((a, b) => a + b, 0) / Math.min(volumes.length, 5) : avgVol20;
  const curVol = volumes[n - 1];
  const volRatio = avgVol20 > 0 ? curVol / avgVol20 : 1;
  const volTrend = avgVol20 > 0 ? avgVol5 / avgVol20 : 1; // 5일 평균 / 20일 평균

  // OBV 트렌드 (20일 OBV 기울기)
  const obvSlope = n >= 20 ? (obv[n - 1] - obv[n - 20]) : 0;
  const obvTrend = obvSlope > 0 ? "up" : obvSlope < 0 ? "down" : "flat";

  // ── CMF (Chaikin Money Flow) — 기관 수급 방향성 ──
  const cmf = calcCMF(highs, lows, closes, volumes, 20);

  // ── +DI / -DI 방향성 지표 ──
  const dmi = calcDMI(highs, lows, closes, 14);

  // ── Keltner Channel (BB 스퀴즈 보조) ──
  const keltner = calcKeltner(closes, highs, lows, 20, 10, 1.5);

  // VWAP 근사 (20일 거래량 가중 평균가)
  let vwap = null;
  if (n >= 20) {
    let sumPV = 0, sumV = 0;
    for (let i = n - 20; i < n; i++) {
      const typical = (highs[i] + lows[i] + closes[i]) / 3;
      sumPV += typical * (volumes[i] || 0);
      sumV += (volumes[i] || 0);
    }
    vwap = sumV > 0 ? sumPV / sumV : null;
  }
  const vwapDeviation = vwap && last > 0 ? ((last - vwap) / vwap) * 100 : null;

  // 지지/저항 레벨 탐지 (피벗 포인트 기반)
  const supportResistance = (() => {
    if (n < 20) return { supports: [], resistances: [] };
    const lookback = Math.min(n, 60);
    const supports = [], resistances = [];
    for (let i = n - lookback + 2; i < n - 2; i++) {
      // 로컬 저점 (지지)
      if (lows[i] <= lows[i - 1] && lows[i] <= lows[i - 2] && lows[i] <= lows[i + 1] && lows[i] <= lows[i + 2]) {
        supports.push(lows[i]);
      }
      // 로컬 고점 (저항)
      if (highs[i] >= highs[i - 1] && highs[i] >= highs[i - 2] && highs[i] >= highs[i + 1] && highs[i] >= highs[i + 2]) {
        resistances.push(highs[i]);
      }
    }
    // 현재가에 가장 가까운 지지/저항 정렬
    supports.sort((a, b) => b - a); // 높은 순 (현재가 아래)
    resistances.sort((a, b) => a - b); // 낮은 순 (현재가 위)
    const nearSupport = supports.filter(s => s < last).slice(0, 3);
    const nearResist = resistances.filter(r => r > last).slice(0, 3);
    return { supports: nearSupport, resistances: nearResist };
  })();

  // 가장 가까운 지지/저항까지 거리 (%)
  const nearestSupport = supportResistance.supports[0];
  const nearestResist = supportResistance.resistances[0];
  const distToSupport = nearestSupport ? ((last - nearestSupport) / last) * 100 : null;
  const distToResist = nearestResist ? ((nearestResist - last) / last) * 100 : null;

  // 추세 전환 조기 감지 (MA 수렴도)
  const maConvergence = (() => {
    if (!sma5 || !sma20) return null;
    const spread = Math.abs(sma5 - sma20) / sma20 * 100;
    const prevSpread5 = n >= 6 ? Math.abs(
      closes.slice(-6, -1).reduce((a,b) => a+b, 0) / 5 -
      closes.slice(-21, -1).reduce((a,b) => a+b, 0) / 20
    ) / (closes.slice(-21, -1).reduce((a,b) => a+b, 0) / 20) * 100 : spread;
    return { spread, converging: spread < prevSpread5 && spread < 1.5 };
  })();

  // 52주 범위
  const high52 = n >= 52 ? Math.max(...highs.slice(-260)) : Math.max(...highs);
  const low52 = n >= 52 ? Math.min(...lows.slice(-260)) : Math.min(...lows);
  const fromHigh = high52 > 0 ? ((last - high52) / high52) * 100 : 0;
  const fromLow = low52 > 0 ? ((last - low52) / low52) * 100 : 0;

  // 변화율
  const change1 = prev > 0 ? ((last - prev) / prev) * 100 : 0;
  const change5 = n >= 5 ? ((last - closes[n - 5]) / closes[n - 5]) * 100 : 0;
  const change10 = n >= 10 ? ((last - closes[n - 10]) / closes[n - 10]) * 100 : 0;
  const change20 = n >= 20 ? ((last - closes[n - 20]) / closes[n - 20]) * 100 : 0;
  const change60 = n >= 60 ? ((last - closes[n - 60]) / closes[n - 60]) * 100 : null;

  // ATR 기반 변동성 비율
  const atrPct = atr && last > 0 ? (atr / last) * 100 : null;

  // 이격도 (Disparity)
  const disp20 = sma20 > 0 ? (last / sma20) * 100 : 100;
  const disp60 = sma50 ? (last / sma50) * 100 : null; // 50일선 이격도

  // 이동평균 배열 (정배열/역배열)
  const maAlignment = (() => {
    const mas = [sma5, sma10, sma20, sma50, sma120, sma200].filter(v => v != null);
    if (mas.length < 3) return "insufficient";
    let bullCount = 0, bearCount = 0;
    for (let i = 0; i < mas.length - 1; i++) {
      if (mas[i] > mas[i + 1]) bullCount++;
      else bearCount++;
    }
    if (bullCount === mas.length - 1) return "perfect_bull"; // 완전 정배열
    if (bearCount === mas.length - 1) return "perfect_bear"; // 완전 역배열
    if (bullCount > bearCount) return "bull";
    if (bearCount > bullCount) return "bear";
    return "mixed";
  })();

  // ── 일목균형표 (Ichimoku Cloud) ──
  const ichimoku = (() => {
    if (n < 52) return null;
    // 전환선 (9일), 기준선 (26일)
    const tenkan = (Math.max(...highs.slice(-9)) + Math.min(...lows.slice(-9))) / 2;
    const kijun = (Math.max(...highs.slice(-26)) + Math.min(...lows.slice(-26))) / 2;
    // 선행스팬A (26일 후), 선행스팬B (52일)
    const senkouA = (tenkan + kijun) / 2;
    const senkouB = (Math.max(...highs.slice(-52)) + Math.min(...lows.slice(-52))) / 2;
    const cloudTop = Math.max(senkouA, senkouB);
    const cloudBot = Math.min(senkouA, senkouB);
    const aboveCloud = last > cloudTop;
    const belowCloud = last < cloudBot;
    const inCloud = !aboveCloud && !belowCloud;
    const cloudThickness = cloudTop > 0 ? ((cloudTop - cloudBot) / cloudTop) * 100 : 0;
    const tkCross = tenkan > kijun ? "bull" : tenkan < kijun ? "bear" : "flat";
    return { tenkan, kijun, senkouA, senkouB, cloudTop, cloudBot, aboveCloud, belowCloud, inCloud, cloudThickness, tkCross };
  })();

  // ── 피보나치 되돌림 레벨 ──
  const fibonacci = (() => {
    if (n < 60) return null;
    const lookback = Math.min(n, 120);
    const recentHigh = Math.max(...highs.slice(-lookback));
    const recentLow = Math.min(...lows.slice(-lookback));
    const diff = recentHigh - recentLow;
    if (diff <= 0) return null;
    const levels = {
      0: recentHigh,
      0.236: recentHigh - diff * 0.236,
      0.382: recentHigh - diff * 0.382,
      0.5: recentHigh - diff * 0.5,
      0.618: recentHigh - diff * 0.618,
      0.786: recentHigh - diff * 0.786,
      1: recentLow,
    };
    // 가장 가까운 피보나치 레벨
    let nearestLevel = null;
    let nearestDist = Infinity;
    for (const [ratio, price] of Object.entries(levels)) {
      const dist = Math.abs(last - price);
      if (dist < nearestDist) { nearestDist = dist; nearestLevel = { ratio: parseFloat(ratio), price }; }
    }
    const distPct = nearestLevel ? (nearestDist / last) * 100 : null;
    return { levels, nearestLevel, distPct };
  })();

  // 캔들패턴 감지 (최근 3일)
  const candlePatterns = [];
  if (n >= 3) {
    const c0 = candles[n - 1], c1 = candles[n - 2], c2 = candles[n - 3];
    const body0 = Math.abs(c0.close - c0.open), body1 = Math.abs(c1.close - c1.open);
    const range0 = c0.high - c0.low, range1 = c1.high - c1.low;
    // 도지 (Doji) — 몸통이 전체 범위의 10% 미만
    if (range0 > 0 && body0 / range0 < 0.1) candlePatterns.push({ name: "도지(Doji)", type: "neutral", detail: "매수/매도 균형 — 추세 전환 가능" });
    // 망치형 (Hammer) — 하락 후 긴 아래꼬리
    if (c0.close > c0.open && (c0.open - c0.low) > body0 * 2 && (c0.high - c0.close) < body0 * 0.5 && change5 < -2)
      candlePatterns.push({ name: "망치형(Hammer)", type: "bullish", detail: "하락 추세 후 반등 신호" });
    // 교수형 (Hanging Man) — 상승 후 긴 아래꼬리
    if (c0.close < c0.open && (c0.close - c0.low) > body0 * 2 && change5 > 2)
      candlePatterns.push({ name: "교수형(Hanging Man)", type: "bearish", detail: "상승 추세 후 하락 전환 경고" });
    // 장악형 (Engulfing)
    if (c1.close < c1.open && c0.close > c0.open && c0.open <= c1.close && c0.close >= c1.open)
      candlePatterns.push({ name: "상승장악형(Bullish Engulfing)", type: "bullish", detail: "강한 매수 전환 패턴" });
    if (c1.close > c1.open && c0.close < c0.open && c0.open >= c1.close && c0.close <= c1.open)
      candlePatterns.push({ name: "하락장악형(Bearish Engulfing)", type: "bearish", detail: "강한 매도 전환 패턴" });
    // 샛별형 (Morning Star)
    if (c2.close < c2.open && body1 < body0 * 0.3 && c0.close > c0.open && c0.close > (c2.open + c2.close) / 2)
      candlePatterns.push({ name: "샛별형(Morning Star)", type: "bullish", detail: "바닥권 강한 반전 패턴" });
    // 저녁별형 (Evening Star)
    if (c2.close > c2.open && body1 < body0 * 0.3 && c0.close < c0.open && c0.close < (c2.open + c2.close) / 2)
      candlePatterns.push({ name: "저녁별형(Evening Star)", type: "bearish", detail: "천정권 강한 반전 패턴" });
  }

  // ════════════════════════════════════════════════════════════════
  // 카테고리별 점수 산출 (각 0~100)
  // ════════════════════════════════════════════════════════════════
  const signals = [];

  // ── 1. 추세 (Trend) 점수 — 가중치 25% ──
  let trendScore = 50;
  // 이동평균 위치
  if (last > sma20) trendScore += 6; else trendScore -= 6;
  if (sma50 && last > sma50) trendScore += 7; else if (sma50) trendScore -= 7;
  if (sma120 && last > sma120) trendScore += 5; else if (sma120) trendScore -= 5;
  if (sma200 && last > sma200) trendScore += 7; else if (sma200) trendScore -= 7;
  // 이동평균 배열
  if (maAlignment === "perfect_bull") { trendScore += 12; signals.push({ type: "bullish", name: "완전 정배열", detail: "모든 이동평균이 상승 정렬 — 가장 강한 추세" }); }
  else if (maAlignment === "perfect_bear") { trendScore -= 12; signals.push({ type: "bearish", name: "완전 역배열", detail: "모든 이동평균이 하락 정렬 — 가장 약한 추세" }); }
  else if (maAlignment === "bull") trendScore += 5;
  else if (maAlignment === "bear") trendScore -= 5;
  // 골든/데드크로스
  if (sma50 && sma200 && sma50 > sma200) { trendScore += 6; signals.push({ type: "bullish", name: "골든크로스 구간", detail: "50일선이 200일선 위 — 장기 상승 추세" }); }
  if (sma50 && sma200 && sma50 < sma200) { trendScore -= 4; signals.push({ type: "bearish", name: "데드크로스 구간", detail: "50일선이 200일선 아래 — 장기 하락 추세" }); }
  // ADX (추세 강도) + DMI 방향성
  if (adx != null) {
    if (adx > 40) { trendScore += 5; signals.push({ type: "neutral", name: `ADX ${adx.toFixed(0)} (강한 추세)`, detail: "추세 방향 확인 필요 — 현재 추세가 강력" }); }
    else if (adx > 25) trendScore += 2;
    else if (adx < 15) { trendScore -= 3; signals.push({ type: "neutral", name: `ADX ${adx.toFixed(0)} (약한 추세)`, detail: "추세 미약 — 횡보 가능성" }); }
  }
  // +DI/-DI 방향성 (DMI 크로스)
  if (dmi.pDI != null && dmi.nDI != null) {
    const diDiff = dmi.pDI - dmi.nDI;
    if (diDiff > 15 && adx > 25) { trendScore += 6; signals.push({ type: "bullish", name: `DMI 강세 (+DI ${dmi.pDI.toFixed(0)} > -DI ${dmi.nDI.toFixed(0)})`, detail: "매수세가 매도세를 압도 — 추세 강도와 방향 동시 확인" }); }
    else if (diDiff > 8) { trendScore += 3; }
    else if (diDiff < -15 && adx > 25) { trendScore -= 6; signals.push({ type: "bearish", name: `DMI 약세 (-DI ${dmi.nDI.toFixed(0)} > +DI ${dmi.pDI.toFixed(0)})`, detail: "매도세가 매수세를 압도 — 하락 추세 강도 확인" }); }
    else if (diDiff < -8) { trendScore -= 3; }
  }
  // 단기 방향
  if (change5 > 5) trendScore += 4;
  else if (change5 > 2) trendScore += 2;
  else if (change5 < -5) trendScore -= 4;
  else if (change5 < -2) trendScore -= 2;
  // VWAP 위치 (기관 수급 프록시)
  if (vwapDeviation != null) {
    if (vwapDeviation > 3) { trendScore += 3; signals.push({ type: "bullish", name: `VWAP 상회 (+${vwapDeviation.toFixed(1)}%)`, detail: "기관 평균 매수가 위 — 수급 우위" }); }
    else if (vwapDeviation < -5) { trendScore -= 2; signals.push({ type: "bearish", name: `VWAP 하회 (${vwapDeviation.toFixed(1)}%)`, detail: "기관 평균 매수가 아래 — 매도 압력" }); }
  }
  // 추세 전환 조기 감지
  if (maConvergence?.converging) {
    signals.push({ type: "neutral", name: "MA 수렴 (추세 전환 임박)", detail: `MA5-MA20 스프레드 ${maConvergence.spread.toFixed(2)}% — 방향 전환 주의` });
  }
  // ── 일목균형표 신호 ──
  if (ichimoku) {
    if (ichimoku.aboveCloud && ichimoku.tkCross === "bull") {
      trendScore += 8; signals.push({ type: "bullish", name: "일목 구름 상방 + 전환/기준 골든크로스", detail: `구름 두께 ${ichimoku.cloudThickness.toFixed(1)}% — 강한 상승 추세 확인` });
    } else if (ichimoku.aboveCloud) {
      trendScore += 4; signals.push({ type: "bullish", name: "일목 구름 상방", detail: "현재가가 구름대 위 — 상승 추세 지속" });
    } else if (ichimoku.belowCloud && ichimoku.tkCross === "bear") {
      trendScore -= 8; signals.push({ type: "bearish", name: "일목 구름 하방 + 전환/기준 데드크로스", detail: `구름 두께 ${ichimoku.cloudThickness.toFixed(1)}% — 강한 하락 추세 확인` });
    } else if (ichimoku.belowCloud) {
      trendScore -= 4; signals.push({ type: "bearish", name: "일목 구름 하방", detail: "현재가가 구름대 아래 — 하락 추세" });
    } else if (ichimoku.inCloud) {
      signals.push({ type: "neutral", name: "일목 구름 내부 (비추세)", detail: "가격이 구름대 안 — 추세 불명확, 돌파 대기" });
    }
  }
  // ── 피보나치 근접 레벨 ──
  if (fibonacci && fibonacci.distPct < 1.5) {
    const ratio = fibonacci.nearestLevel.ratio;
    const levelName = ratio === 0.618 ? "황금비율(0.618)" : ratio === 0.382 ? "0.382" : ratio === 0.5 ? "0.5" : `${ratio}`;
    signals.push({ type: "neutral", name: `피보나치 ${levelName} 레벨 근접`, detail: `$${fibonacci.nearestLevel.price.toFixed(2)} (${fibonacci.distPct.toFixed(1)}% 이내) — 반전/지지 가능 구간` });
    if (ratio >= 0.618 && change5 < -3) { trendScore += 4; } // 깊은 되돌림 후 반등 기대
  }
  trendScore = Math.max(0, Math.min(100, trendScore));
  const trendDetail = last > (sma20 || last)
    ? `상승세 (MA20 +${((last / sma20 - 1) * 100).toFixed(1)}%, 배열: ${maAlignment === "perfect_bull" ? "정배열" : maAlignment === "bull" ? "정배열↑" : "혼합"})`
    : `하락세 (MA20 ${((last / sma20 - 1) * 100).toFixed(1)}%, 배열: ${maAlignment === "perfect_bear" ? "역배열" : maAlignment === "bear" ? "역배열↓" : "혼합"})`;

  // ── 2. 모멘텀 (Momentum) 점수 — 가중치 25% ──
  let momScore = 50;
  // RSI 세분화
  if (rsi != null) {
    if (rsi >= 80) { momScore -= 18; signals.push({ type: "bearish", name: `RSI 극단 과매수 (${rsi.toFixed(0)})`, detail: "심각한 과열 — 조정 임박 가능성 높음" }); }
    else if (rsi >= 70) { momScore -= 10; signals.push({ type: "bearish", name: `RSI 과매수 (${rsi.toFixed(0)})`, detail: "과열 구간 — 단기 조정 가능" }); }
    else if (rsi >= 55) momScore += 6;
    else if (rsi >= 45) momScore += 0; // 중립
    else if (rsi >= 30) momScore -= 4;
    else if (rsi >= 20) { momScore += 12; signals.push({ type: "bullish", name: `RSI 과매도 (${rsi.toFixed(0)})`, detail: "매도 과열 — 반등 가능 구간" }); }
    else { momScore += 16; signals.push({ type: "bullish", name: `RSI 극단 과매도 (${rsi.toFixed(0)})`, detail: "극심한 매도 압력 — 강한 반등 기대" }); }
  }
  // RSI 다이버전스 (다중 기간 감지: 5일, 10일, 20일)
  if (rsi != null && n >= 20) {
    let bullDiv = 0, bearDiv = 0;
    for (const lookback of [5, 10, 20]) {
      if (n < lookback) continue;
      const prevRSI = rsiArr[n - lookback];
      if (prevRSI == null) continue;
      if (last < closes[n - lookback] && rsi > prevRSI) bullDiv++;
      if (last > closes[n - lookback] && rsi < prevRSI) bearDiv++;
    }
    if (bullDiv >= 2) { momScore += 12; signals.push({ type: "bullish", name: `RSI 강세 다이버전스 (${bullDiv}중 확인)`, detail: "다중 기간에서 가격 하락 vs RSI 상승 — 강한 반전 신호" }); }
    else if (bullDiv === 1) { momScore += 6; signals.push({ type: "bullish", name: "RSI 강세 다이버전스", detail: "가격 하락 vs RSI 상승 — 하락 둔화 / 반전 신호" }); }
    if (bearDiv >= 2) { momScore -= 10; signals.push({ type: "bearish", name: `RSI 약세 다이버전스 (${bearDiv}중 확인)`, detail: "다중 기간에서 가격 상승 vs RSI 하락 — 강한 조정 신호" }); }
    else if (bearDiv === 1) { momScore -= 5; signals.push({ type: "bearish", name: "RSI 약세 다이버전스", detail: "가격 상승 vs RSI 하락 — 상승 둔화 / 조정 신호" }); }
  }
  // RSI 기울기 분석 (모멘텀 가속/감속)
  if (rsi != null && n >= 5) {
    const rsi5ago = rsiArr[n - 5];
    if (rsi5ago != null) {
      const rsiSlope = rsi - rsi5ago;
      if (rsiSlope > 15 && rsi < 60) { momScore += 5; signals.push({ type: "bullish", name: `RSI 급가속 (+${rsiSlope.toFixed(0)})`, detail: "5일간 RSI 급등 — 모멘텀 전환 초기" }); }
      else if (rsiSlope < -15 && rsi > 40) { momScore -= 5; signals.push({ type: "bearish", name: `RSI 급감속 (${rsiSlope.toFixed(0)})`, detail: "5일간 RSI 급락 — 모멘텀 약화" }); }
    }
  }
  // MACD
  if (macdVal != null && sigVal != null) {
    if (macdVal > sigVal && prevHist != null && histVal > prevHist) { momScore += 10; signals.push({ type: "bullish", name: "MACD 상승 가속", detail: "히스토그램 확대 — 매수 모멘텀 강화" }); }
    else if (macdVal > sigVal) momScore += 4;
    if (macdVal < sigVal && prevHist != null && histVal < prevHist) { momScore -= 8; signals.push({ type: "bearish", name: "MACD 하락 가속", detail: "히스토그램 축소 — 매도 압력 증가" }); }
    else if (macdVal < sigVal) momScore -= 3;
    // MACD 영선 교차
    if (macdVal > 0 && macdLine[n - 2] <= 0) { momScore += 6; signals.push({ type: "bullish", name: "MACD 영선 상향 돌파", detail: "추세 전환 확인 신호" }); }
    if (macdVal < 0 && macdLine[n - 2] >= 0) { momScore -= 5; signals.push({ type: "bearish", name: "MACD 영선 하향 돌파", detail: "하락 추세 전환 경고" }); }
  }
  // 스토캐스틱
  if (stochK != null && stochD != null) {
    if (stochK < 20 && stochK > stochD) { momScore += 6; signals.push({ type: "bullish", name: "스토캐스틱 과매도 골든크로스", detail: `%K ${stochK.toFixed(0)} > %D ${stochD.toFixed(0)} — 반등 시그널` }); }
    if (stochK > 80 && stochK < stochD) { momScore -= 6; signals.push({ type: "bearish", name: "스토캐스틱 과매수 데드크로스", detail: `%K ${stochK.toFixed(0)} < %D ${stochD.toFixed(0)} — 조정 시그널` }); }
  }
  // Williams %R
  if (wr != null) {
    if (wr < -80) momScore += 3;
    if (wr > -20) momScore -= 3;
  }
  momScore = Math.max(0, Math.min(100, momScore));

  // ── 3. 변동성 & 가격구조 (Volatility) 점수 — 가중치 15% ──
  let volScore = 55;
  if (bb) {
    const bw = bb.upper - bb.lower;
    const bbPercent = bb.middle > 0 ? (bw / bb.middle) * 100 : 0;
    const bbPos = (last - bb.lower) / (bb.upper - bb.lower); // 0~1
    if (bbPercent < 4) { volScore += 10; signals.push({ type: "neutral", name: `볼린저 스퀴즈 (${bbPercent.toFixed(1)}%)`, detail: "밴드 극도 수축 — 큰 변동 임박" }); }
    else if (bbPercent < 8) volScore += 3;
    // BB 위치 점수 (0.5 = 중간이 최적)
    if (bbPos >= 0.95) { volScore -= 12; signals.push({ type: "bearish", name: "볼린저 상단 이탈", detail: "상단 밴드 초과 — 단기 과열 극심" }); }
    else if (bbPos >= 0.85) { volScore -= 6; signals.push({ type: "bearish", name: "볼린저 상단 근접", detail: "상단 밴드 근접 — 단기 과열" }); }
    else if (bbPos <= 0.05) { volScore += 12; signals.push({ type: "bullish", name: "볼린저 하단 이탈", detail: "하단 밴드 아래 — 극단 매도, 반등 가능" }); }
    else if (bbPos <= 0.15) { volScore += 6; signals.push({ type: "bullish", name: "볼린저 하단 근접", detail: "하단 밴드 근접 — 반등 가능" }); }
  }
  // 이격도 분석
  if (disp20 > 110) { volScore -= 8; signals.push({ type: "bearish", name: `이격도 ${disp20.toFixed(0)}% (과열)`, detail: "20일선 대비 10%+ 이격 — 평균회귀 가능" }); }
  else if (disp20 < 90) { volScore += 8; signals.push({ type: "bullish", name: `이격도 ${disp20.toFixed(0)}% (저평가)`, detail: "20일선 대비 -10%+ 이격 — 반등 기대" }); }
  // ATR 변동성
  if (atrPct != null) {
    if (atrPct > 5) volScore -= 5; // 고변동
    else if (atrPct < 1) volScore += 3; // 안정적
  }
  // ── Keltner + BB 교차 스퀴즈 (TTM Squeeze 프록시) ──
  if (keltner && bb) {
    const bbInside = bb.lower > keltner.lower && bb.upper < keltner.upper;
    if (bbInside) {
      volScore += 8;
      signals.push({ type: "neutral", name: "TTM 스퀴즈 (BB⊂Keltner)", detail: "볼린저 밴드가 켈트너 채널 안에 수축 — 폭발적 변동 임박" });
    }
  }
  volScore = Math.max(0, Math.min(100, volScore));
  const bbPos = bb ? ((last - bb.lower) / (bb.upper - bb.lower) * 100).toFixed(0) : "—";
  const volDetail = bb ? `BB ${bbPos}% | 이격도 ${disp20.toFixed(0)}%${atrPct ? ` | ATR ${atrPct.toFixed(1)}%` : ""}` : "데이터 부족";

  // ── 4. 수급 & 거래량 (Supply/Demand) 점수 — 가중치 15% ──
  let supScore = 50;
  // 거래량 수준
  if (volRatio >= 3) { supScore += 18; signals.push({ type: "bullish", name: `거래량 폭증 (${volRatio.toFixed(1)}x)`, detail: "평균 대비 3배 이상 — 강력한 수급 변화" }); }
  else if (volRatio >= 2) { supScore += 14; signals.push({ type: "bullish", name: `거래량 급증 (${volRatio.toFixed(1)}x)`, detail: "평균 대비 2배+ — 강한 수급 유입" }); }
  else if (volRatio >= 1.5) supScore += 8;
  else if (volRatio >= 1.0) supScore += 2;
  else if (volRatio <= 0.3) { supScore -= 12; signals.push({ type: "neutral", name: `거래량 고갈 (${(volRatio * 100).toFixed(0)}%)`, detail: "극심한 거래량 감소 — 관심 저하 또는 바닥 다지기" }); }
  else if (volRatio <= 0.5) supScore -= 6;

  // 가격-거래량 상관관계 (핵심!)
  if (change5 > 0 && volTrend > 1.3) { supScore += 10; signals.push({ type: "bullish", name: "가격↑ + 거래량↑", detail: "건전한 상승 — 수급 동반 상승" }); }
  if (change5 < 0 && volTrend > 1.5) { supScore -= 12; signals.push({ type: "bearish", name: "가격↓ + 거래량↑", detail: "투매 경고 — 매도 압력 증가" }); }
  if (change5 > 0 && volTrend < 0.7) { supScore -= 5; signals.push({ type: "neutral", name: "가격↑ + 거래량↓", detail: "거래량 미확인 상승 — 지속성 의문" }); }
  if (change5 < 0 && volTrend < 0.7) supScore += 3; // 하락 중 거래량 감소 = 매도 소진

  // OBV 트렌드
  if (obvTrend === "up" && change20 > 0) supScore += 5; // OBV 상승 + 가격 상승 = 건전
  if (obvTrend === "down" && change20 > 0) { supScore -= 5; signals.push({ type: "bearish", name: "OBV 약세 다이버전스", detail: "가격 상승 중 OBV 하락 — 수급 약화" }); }
  if (obvTrend === "up" && change20 < 0) { supScore += 5; signals.push({ type: "bullish", name: "OBV 강세 다이버전스", detail: "가격 하락 중 OBV 상승 — 저점 매집 가능" }); }

  // ── CMF (Chaikin Money Flow) — 기관 수급 흐름 ──
  if (cmf != null) {
    if (cmf > 0.15) { supScore += 8; signals.push({ type: "bullish", name: `CMF ${cmf.toFixed(2)} (강한 매집)`, detail: "Chaikin Money Flow 강세 — 기관 매집 구간" }); }
    else if (cmf > 0.05) { supScore += 4; }
    else if (cmf < -0.15) { supScore -= 8; signals.push({ type: "bearish", name: `CMF ${cmf.toFixed(2)} (강한 유출)`, detail: "Chaikin Money Flow 약세 — 기관 이탈 구간" }); }
    else if (cmf < -0.05) { supScore -= 4; }
    // CMF + 가격 다이버전스
    if (cmf > 0.10 && change20 < -5) { supScore += 5; signals.push({ type: "bullish", name: "CMF 강세 다이버전스", detail: "가격 하락 중 자금 유입 — 스마트 머니 매집 가능" }); }
    if (cmf < -0.10 && change20 > 5) { supScore -= 5; signals.push({ type: "bearish", name: "CMF 약세 다이버전스", detail: "가격 상승 중 자금 유출 — 기관 이익 실현 가능" }); }
  }

  supScore = Math.max(0, Math.min(100, supScore));
  const cmfStr = cmf != null ? ` | CMF ${cmf.toFixed(2)}` : "";
  const supDetail = `거래량 ${volRatio.toFixed(1)}x | 5일 추세 ${volTrend.toFixed(1)}x | OBV ${obvTrend === "up" ? "↑" : obvTrend === "down" ? "↓" : "→"}${cmfStr}`;

  // ── 5. 가격위치 & 구조 (Position) 점수 — 가중치 10% ──
  let posScore = 50;
  const range52 = high52 - low52;
  const pos52 = range52 > 0 ? ((last - low52) / range52) * 100 : 50;
  // 52주 위치 세분화
  if (pos52 <= 10) { posScore += 18; signals.push({ type: "bullish", name: `52주 최저점 근접 (${pos52.toFixed(0)}%)`, detail: "극단적 저점 — 강한 반등 기회" }); }
  else if (pos52 <= 20) { posScore += 12; signals.push({ type: "bullish", name: `52주 저점대 (${pos52.toFixed(0)}%)`, detail: "저가 매수 영역" }); }
  else if (pos52 <= 40) posScore += 5;
  else if (pos52 >= 95) { posScore -= 10; signals.push({ type: "neutral", name: `52주 최고점 근접 (${pos52.toFixed(0)}%)`, detail: "신고가 영역 — 추세 강하나 차익실현 주의" }); }
  else if (pos52 >= 85) posScore -= 3;
  // 고점 대비 낙폭
  if (fromHigh < -40) { posScore += 12; signals.push({ type: "bullish", name: `고점 대비 -${Math.abs(fromHigh).toFixed(0)}%`, detail: "큰 낙폭 — 반등 여력 상당" }); }
  else if (fromHigh < -25) { posScore += 6; signals.push({ type: "bullish", name: `고점 대비 ${fromHigh.toFixed(0)}%`, detail: "상당한 조정 후 — 반등 가능" }); }
  // 신고가 돌파
  if (pos52 >= 98 && change5 > 0) { posScore += 8; signals.push({ type: "bullish", name: "52주 신고가 돌파", detail: "강력한 상승 모멘텀 — 추세 추종 구간" }); }
  // 지지/저항 레벨 근접도
  if (distToSupport != null && distToSupport < 2) { posScore += 6; signals.push({ type: "bullish", name: `지지선 근접 (${distToSupport.toFixed(1)}%)`, detail: `$${nearestSupport.toFixed(2)} 지지 레벨 — 반등 기대 구간` }); }
  if (distToResist != null && distToResist < 2) { posScore -= 3; signals.push({ type: "neutral", name: `저항선 근접 (${distToResist.toFixed(1)}%)`, detail: `$${nearestResist.toFixed(2)} 저항 레벨 — 돌파 또는 되돌림 주의` }); }
  posScore = Math.max(0, Math.min(100, posScore));
  const posDetail = `52주 위치 ${pos52.toFixed(0)}% | 고점대비 ${fromHigh.toFixed(1)}%${distToSupport != null ? ` | 지지 ${distToSupport.toFixed(1)}%` : ""}`;

  // ── 6. 캔들패턴 & 단기추세 점수 — 가중치 10% ──
  let patternScore = 50;
  // 캔들 패턴 반영
  for (const p of candlePatterns) {
    if (p.type === "bullish") patternScore += 10;
    if (p.type === "bearish") patternScore -= 10;
    signals.push(p);
  }
  // 단기 모멘텀 (1-5일)
  if (change1 > 3) patternScore += 8;
  else if (change1 > 1) patternScore += 4;
  else if (change1 < -3) patternScore -= 8;
  else if (change1 < -1) patternScore -= 4;
  if (change5 > 8) patternScore += 6;
  else if (change5 > 3) patternScore += 3;
  else if (change5 < -8) patternScore -= 6;
  else if (change5 < -3) patternScore -= 3;
  patternScore = Math.max(0, Math.min(100, patternScore));
  const patternDetail = `${candlePatterns.length ? candlePatterns.map(p => p.name).join(", ") : "패턴 없음"} | 1일 ${change1 >= 0 ? "+" : ""}${change1.toFixed(1)}%`;

  // ════════════════════════════════════════════════════════════════
  // 종합 점수 (가중 평균)
  // ════════════════════════════════════════════════════════════════
  const totalScore = Math.round(
    trendScore * 0.25 +
    momScore * 0.25 +
    volScore * 0.15 +
    supScore * 0.15 +
    posScore * 0.10 +
    patternScore * 0.10
  );

  // 판정 (7단계로 세분화)
  let verdict, summary;
  if (totalScore >= 80) { verdict = "적극 매수"; summary = "기술적 지표 대부분이 강력한 매수 신호를 보이고 있습니다. 추세·모멘텀·수급 3박자가 일치합니다."; }
  else if (totalScore >= 68) { verdict = "매수"; summary = "긍정적 신호가 우세합니다. 기술적 분석상 매수 관점이 유리한 구간입니다."; }
  else if (totalScore >= 58) { verdict = "매수 우위"; summary = "약한 매수 신호입니다. 추가 확인 지표와 함께 분할 매수를 고려해 볼 수 있습니다."; }
  else if (totalScore >= 42) { verdict = "중립 (관망)"; summary = "매수와 매도 신호가 혼재합니다. 추세가 명확해질 때까지 관망이 유리합니다."; }
  else if (totalScore >= 32) { verdict = "매도 우위"; summary = "부정적 신호가 감지됩니다. 포지션 축소 또는 방어적 전략을 권장합니다."; }
  else if (totalScore >= 20) { verdict = "매도"; summary = "다수의 하락 신호가 감지됩니다. 포지션 정리 또는 손절을 고려하세요."; }
  else { verdict = "적극 매도"; summary = "강한 하락 신호가 다수 감지됩니다. 즉각적인 리스크 관리가 필요합니다."; }

  // ── 적정가치 추정 (다중 모델 앙상블) ──
  let fairValue = null;
  let fairValueMethod = "";
  if (n >= 50) {
    const sma50Val = sma50 || sma20;
    const sma200Val = sma200 || sma120 || sma50Val;
    const bbMid = bb ? bb.middle : sma20;

    // 모델 1: MA 앙상블 (이동평균 가중 합성)
    const maModel = sma20 * 0.15 + sma50Val * 0.25 + sma200Val * 0.30 + bbMid * 0.15 + last * 0.15;

    // 모델 2: VWAP + 일목 기준선 복합 (수급 기반)
    const vwapModel = (() => {
      const components = [];
      if (vwap) components.push({ val: vwap, w: 0.35 });
      if (ichimoku) components.push({ val: ichimoku.kijun, w: 0.30 });
      components.push({ val: sma50Val, w: 0.20 });
      components.push({ val: last, w: 0.15 });
      const totalW = components.reduce((s, c) => s + c.w, 0);
      return components.reduce((s, c) => s + c.val * (c.w / totalW), 0);
    })();

    // 모델 3: 평균회귀 모델 (ATR 기반 적정 레인지 중심)
    const meanRevModel = (() => {
      const center = sma200Val || sma50Val;
      const atrBand = atr ? atr * 2 : 0;
      // 현재가가 과매도면 중심 + ATR 쪽, 과매수면 중심 - ATR 쪽
      if (rsi != null && rsi < 35) return center + atrBand * 0.3;
      if (rsi != null && rsi > 65) return center - atrBand * 0.3;
      return center;
    })();

    // 앙상블: 모델별 가중 평균 (시장 상태에 따라 가중치 조정)
    let w1 = 0.40, w2 = 0.30, w3 = 0.30; // 기본 가중치
    if (trendScore >= 70) { w1 = 0.50; w2 = 0.30; w3 = 0.20; } // 강한 추세 → MA 모델 비중↑
    else if (trendScore <= 30) { w1 = 0.25; w2 = 0.25; w3 = 0.50; } // 약한 추세 → 평균회귀 비중↑
    else if (supScore >= 65) { w1 = 0.30; w2 = 0.45; w3 = 0.25; } // 수급 강한 → VWAP 모델↑

    let base = maModel * w1 + vwapModel * w2 + meanRevModel * w3;

    // 추세 보정: 강한 추세시 현재가 방향으로 보정
    if (trendScore >= 75) base = base * 0.7 + last * 0.3;
    else if (trendScore <= 25) base = base * 0.7 + last * 0.3;

    // 모멘텀 보정
    if (momScore >= 70) base *= 1.02;
    else if (momScore <= 30) base *= 0.98;

    // 일목균형표 구름대 보정
    if (ichimoku) {
      if (ichimoku.aboveCloud) base = Math.max(base, ichimoku.cloudTop * 0.98);
      if (ichimoku.belowCloud) base = Math.min(base, ichimoku.cloudBot * 1.02);
    }

    fairValue = base;
    fairValueMethod = "MA앙상블 + VWAP/일목 + 평균회귀 (3모델 가중)";

    const premium = ((last - fairValue) / fairValue) * 100;
    if (premium > 20) signals.push({ type: "bearish", name: `적정가 대비 +${premium.toFixed(0)}% 고평가`, detail: `기술적 적정가 $${fairValue.toFixed(2)} 대비 상당한 프리미엄` });
    else if (premium > 10) signals.push({ type: "bearish", name: `적정가 대비 +${premium.toFixed(0)}% 고평가`, detail: `기술적 적정가 대비 고평가 구간` });
    else if (premium < -20) signals.push({ type: "bullish", name: `적정가 대비 ${premium.toFixed(0)}% 저평가`, detail: `기술적 적정가 $${fairValue.toFixed(2)} 대비 큰 할인` });
    else if (premium < -10) signals.push({ type: "bullish", name: `적정가 대비 ${premium.toFixed(0)}% 저평가`, detail: `기술적 적정가 대비 저평가 구간` });
  }

  // ── 복합 오실레이터 컨센서스 (RSI + Stoch + Williams %R 일치) ──
  if (rsi != null && stochK != null && wr != null) {
    const oscBull = (rsi < 35 ? 1 : 0) + (stochK < 25 ? 1 : 0) + (wr < -75 ? 1 : 0);
    const oscBear = (rsi > 65 ? 1 : 0) + (stochK > 75 ? 1 : 0) + (wr > -25 ? 1 : 0);
    if (oscBull === 3) {
      momScore = Math.min(100, momScore + 8);
      signals.push({ type: "bullish", name: "오실레이터 3중 과매도 컨센서스", detail: "RSI + Stoch + WR 모두 과매도 — 강력한 반등 가능성" });
    } else if (oscBear === 3) {
      momScore = Math.min(100, momScore - 8);
      signals.push({ type: "bearish", name: "오실레이터 3중 과매수 컨센서스", detail: "RSI + Stoch + WR 모두 과매수 — 조정 가능성 높음" });
    }
  }

  // ── BB %B + RSI 평균회귀 콤보 ──
  if (bb && rsi != null) {
    const bbPercentB = (last - bb.lower) / (bb.upper - bb.lower);
    if (bbPercentB < 0.10 && rsi < 30) {
      volScore = Math.min(100, volScore + 6);
      signals.push({ type: "bullish", name: "BB %B + RSI 극단 매도", detail: `%B ${(bbPercentB * 100).toFixed(0)}% + RSI ${rsi.toFixed(0)} — 평균회귀 매수 구간` });
    } else if (bbPercentB > 0.90 && rsi > 70) {
      volScore = Math.max(0, volScore - 6);
      signals.push({ type: "bearish", name: "BB %B + RSI 극단 매수", detail: `%B ${(bbPercentB * 100).toFixed(0)}% + RSI ${rsi.toFixed(0)} — 평균회귀 매도 구간` });
    }
  }

  // ── 추세 강도 신뢰도 (ADX + MA배열 + 거래량 삼박자) ──
  const trendConfidence = (() => {
    let conf = 0;
    if (adx != null && adx > 25) conf++;
    if (maAlignment === "perfect_bull" || maAlignment === "perfect_bear") conf++;
    if (volTrend > 1.2 && obvTrend === (maAlignment.includes("bull") ? "up" : "down")) conf++;
    if (ichimoku && (ichimoku.aboveCloud || ichimoku.belowCloud)) conf++;
    return { score: conf, label: conf >= 3 ? "매우 높음" : conf >= 2 ? "높음" : conf >= 1 ? "보통" : "낮음" };
  })();
  if (trendConfidence.score >= 3) {
    signals.push({ type: "neutral", name: `추세 신뢰도: ${trendConfidence.label} (${trendConfidence.score}/4)`, detail: "ADX·MA배열·거래량·일목균형표 다중 확인 — 추세 방향 신뢰 가능" });
  }

  // ── 거래량 클라이맥스 감지 (극단적 거래량 + 가격 반전 조합) ──
  if (volRatio >= 3 && Math.abs(change1) > 3) {
    const isBuyClímax = change1 > 3 && rsi != null && rsi > 75;
    const isSellClimax = change1 < -3 && rsi != null && rsi < 25;
    if (isBuyClímax) {
      signals.push({ type: "bearish", name: "매수 클라이맥스", detail: `거래량 ${volRatio.toFixed(1)}x + 급등 ${change1.toFixed(1)}% + RSI 과매수 — 천정 가능성` });
    } else if (isSellClimax) {
      signals.push({ type: "bullish", name: "매도 클라이맥스", detail: `거래량 ${volRatio.toFixed(1)}x + 급락 ${change1.toFixed(1)}% + RSI 과매도 — 바닥 가능성` });
    }
  }

  // ── Choppiness Index (변동 횡보 vs 추세 구간 감지) ──
  const choppiness = (() => {
    if (n < 14 || !atr) return null;
    let atrSum = 0;
    for (let k = n - 14; k < n; k++) {
      const tr = Math.max(
        highs[k] - lows[k],
        k > 0 ? Math.abs(highs[k] - closes[k - 1]) : 0,
        k > 0 ? Math.abs(lows[k] - closes[k - 1]) : 0
      );
      atrSum += tr;
    }
    const highestHigh = Math.max(...highs.slice(n - 14, n));
    const lowestLow = Math.min(...lows.slice(n - 14, n));
    const range = highestHigh - lowestLow;
    if (range <= 0) return null;
    return (Math.log10(atrSum / range) / Math.log10(14)) * 100;
  })();
  if (choppiness != null) {
    if (choppiness > 61.8) {
      signals.push({ type: "neutral", name: `횡보 구간 (CI ${choppiness.toFixed(0)})`, detail: "Choppiness Index 고값 — 방향성 부재, 브레이크아웃 대기" });
      trendScore = Math.max(0, trendScore - 4);
    } else if (choppiness < 38.2) {
      signals.push({ type: "neutral", name: `강한 추세 구간 (CI ${choppiness.toFixed(0)})`, detail: "Choppiness Index 저값 — 추세 진행 중, 추세 고갈 주의" });
      trendScore = Math.min(100, trendScore + 3);
    }
  }

  // ── ROC(Rate of Change) 다중 기간 모멘텀 분석 ──
  if (n >= 20) {
    const roc5 = change5;
    const roc20 = change20;
    // 단기·중기 ROC 동시 양수 = 강한 모멘텀 확인
    if (roc5 > 3 && roc20 > 8) {
      momScore = Math.min(100, momScore + 5);
      signals.push({ type: "bullish", name: `ROC 다중 상승 (5일 +${roc5.toFixed(1)}%, 20일 +${roc20.toFixed(1)}%)`, detail: "단기+중기 모멘텀 동시 확인 — 추세 지속 가능성 높음" });
    } else if (roc5 < -3 && roc20 < -8) {
      momScore = Math.max(0, momScore - 5);
      signals.push({ type: "bearish", name: `ROC 다중 하락 (5일 ${roc5.toFixed(1)}%, 20일 ${roc20.toFixed(1)}%)`, detail: "단기+중기 모멘텀 동시 하락 — 약세 지속 가능성" });
    }
    // 단기 반전 감지: 중기 하락 중 단기 반등
    if (roc5 > 2 && roc20 < -5) {
      signals.push({ type: "neutral", name: "ROC 단기 반등 (중기 하락 중)", detail: `5일 +${roc5.toFixed(1)}% vs 20일 ${roc20.toFixed(1)}% — 데드캣 바운스 or 진짜 반전 확인 필요` });
    }
  }

  // ── 거래량 가중 RSI 다이버전스 보정 ──
  if (rsi != null && n >= 10) {
    const recentAvgVol = volumes.slice(-5).reduce((a, b) => a + b, 0) / 5;
    const priorAvgVol = volumes.slice(-10, -5).reduce((a, b) => a + b, 0) / 5;
    const volSupport = recentAvgVol > priorAvgVol * 1.3;
    // 다이버전스 + 거래량 뒷받침 = 더 신뢰도 높은 신호
    if (volSupport && rsi < 40 && change5 < -2 && rsiArr[n - 5] != null && rsi > rsiArr[n - 5]) {
      momScore = Math.min(100, momScore + 4);
      signals.push({ type: "bullish", name: "거래량 확인 RSI 다이버전스", detail: "RSI 반등 + 거래량 증가 — 바닥 확인 신뢰도 상승" });
    }
    if (volSupport && rsi > 60 && change5 > 2 && rsiArr[n - 5] != null && rsi < rsiArr[n - 5]) {
      momScore = Math.max(0, momScore - 4);
      signals.push({ type: "bearish", name: "거래량 확인 RSI 약세 다이버전스", detail: "RSI 하락 + 거래량 증가 — 천정 확인 신뢰도 상승" });
    }
  }

  // ── 일목균형표 시간론 (전환선/기준선 교차 타이밍) ──
  if (ichimoku && n >= 52) {
    const prevTenkan = (Math.max(...highs.slice(-10, -1)) + Math.min(...lows.slice(-10, -1))) / 2;
    const prevKijun = (Math.max(...highs.slice(-27, -1)) + Math.min(...lows.slice(-27, -1))) / 2;
    const tkCrossNow = ichimoku.tenkan > ichimoku.kijun;
    const tkCrossPrev = prevTenkan > prevKijun;
    if (tkCrossNow && !tkCrossPrev) {
      trendScore = Math.min(100, trendScore + 5);
      signals.push({ type: "bullish", name: "일목 전환/기준선 골든크로스 (신규)", detail: "전환선이 기준선 상향 돌파 — 단기 상승 전환 신호" });
    } else if (!tkCrossNow && tkCrossPrev) {
      trendScore = Math.max(0, trendScore - 5);
      signals.push({ type: "bearish", name: "일목 전환/기준선 데드크로스 (신규)", detail: "전환선이 기준선 하향 돌파 — 단기 하락 전환 신호" });
    }
  }

  // ── 파라볼릭 SAR 근사 (추세 반전 감지) ──
  const parabolicSAR = (() => {
    if (n < 30) return null;
    let af = 0.02, maxAf = 0.20;
    let isUpTrend = closes[n - 30] < closes[n - 15]; // 초기 추세 판단
    let sar = isUpTrend ? Math.min(...lows.slice(n - 30, n - 25)) : Math.max(...highs.slice(n - 30, n - 25));
    let ep = isUpTrend ? Math.max(...highs.slice(n - 30, n - 25)) : Math.min(...lows.slice(n - 30, n - 25));

    for (let i = n - 25; i < n; i++) {
      const prevSar = sar;
      sar = sar + af * (ep - sar);
      if (isUpTrend) {
        sar = Math.min(sar, lows[i - 1], i >= 2 ? lows[i - 2] : lows[i - 1]);
        if (lows[i] < sar) { isUpTrend = false; sar = ep; ep = lows[i]; af = 0.02; }
        else { if (highs[i] > ep) { ep = highs[i]; af = Math.min(af + 0.02, maxAf); } }
      } else {
        sar = Math.max(sar, highs[i - 1], i >= 2 ? highs[i - 2] : highs[i - 1]);
        if (highs[i] > sar) { isUpTrend = true; sar = ep; ep = highs[i]; af = 0.02; }
        else { if (lows[i] < ep) { ep = lows[i]; af = Math.min(af + 0.02, maxAf); } }
      }
    }
    return { sar, isUpTrend, distance: ((last - sar) / last) * 100 };
  })();
  if (parabolicSAR) {
    if (parabolicSAR.isUpTrend && parabolicSAR.distance > 0 && parabolicSAR.distance < 2) {
      signals.push({ type: "neutral", name: `SAR 상승추세 근접 ($${parabolicSAR.sar.toFixed(2)})`, detail: `파라볼릭 SAR과 ${parabolicSAR.distance.toFixed(1)}% 간격 — 추세 전환 근접 주의` });
    } else if (!parabolicSAR.isUpTrend && parabolicSAR.distance < 0 && Math.abs(parabolicSAR.distance) < 2) {
      signals.push({ type: "neutral", name: `SAR 하락추세 근접 ($${parabolicSAR.sar.toFixed(2)})`, detail: `파라볼릭 SAR과 ${Math.abs(parabolicSAR.distance).toFixed(1)}% 간격 — 반등 전환 가능` });
    }
    if (parabolicSAR.isUpTrend) trendScore = Math.min(100, trendScore + 2);
    else trendScore = Math.max(0, trendScore - 2);
  }

  // ── MACD 히스토그램 다이버전스 (가격 vs 히스토그램 괴리) ──
  if (histogram && n >= 20) {
    // 가격 신저가 vs 히스토그램 higher low → 강세 다이버전스
    const priceLow5 = Math.min(...closes.slice(-5));
    const priceLow15 = Math.min(...closes.slice(-15, -5));
    const histLow5 = Math.min(...histogram.slice(-5).filter(h => h != null));
    const histLow15 = Math.min(...histogram.slice(-15, -5).filter(h => h != null));
    if (priceLow5 < priceLow15 && histLow5 > histLow15 && histLow5 < 0) {
      momScore = Math.min(100, momScore + 5);
      signals.push({ type: "bullish", name: "MACD 히스토그램 강세 다이버전스", detail: "가격 신저가 vs 히스토그램 상승 — 매도 압력 소진, 반등 임박" });
    }
    // 가격 신고가 vs 히스토그램 lower high → 약세 다이버전스
    const priceHigh5 = Math.max(...closes.slice(-5));
    const priceHigh15 = Math.max(...closes.slice(-15, -5));
    const histHigh5 = Math.max(...histogram.slice(-5).filter(h => h != null));
    const histHigh15 = Math.max(...histogram.slice(-15, -5).filter(h => h != null));
    if (priceHigh5 > priceHigh15 && histHigh5 < histHigh15 && histHigh5 > 0) {
      momScore = Math.max(0, momScore - 5);
      signals.push({ type: "bearish", name: "MACD 히스토그램 약세 다이버전스", detail: "가격 신고가 vs 히스토그램 하락 — 매수 모멘텀 약화, 조정 가능" });
    }
  }

  // ── RSI·Stoch·MACD 트리플 컨버전스 (3지표 동시 방향 일치) ──
  if (rsi != null && stochK != null && macdVal != null && sigVal != null) {
    const rsiBull = rsi > 50 && (rsiArr[n - 2] != null && rsi > rsiArr[n - 2]);
    const stochBull = stochK > stochD && stochK > 20;
    const macdBull = macdVal > sigVal && histVal > 0;
    const rsiBear = rsi < 50 && (rsiArr[n - 2] != null && rsi < rsiArr[n - 2]);
    const stochBear = stochK < stochD && stochK < 80;
    const macdBear = macdVal < sigVal && histVal < 0;
    if (rsiBull && stochBull && macdBull) {
      momScore = Math.min(100, momScore + 6);
      signals.push({ type: "bullish", name: "모멘텀 트리플 컨버전스 ↑", detail: "RSI·Stoch·MACD 3지표 동시 상승 — 매우 강한 매수 모멘텀" });
    } else if (rsiBear && stochBear && macdBear) {
      momScore = Math.max(0, momScore - 6);
      signals.push({ type: "bearish", name: "모멘텀 트리플 컨버전스 ↓", detail: "RSI·Stoch·MACD 3지표 동시 하락 — 매우 강한 매도 모멘텀" });
    }
  }

  // ── ATR 퍼센타일 기반 변동성 레짐 판단 ──
  if (n >= 60 && atrArr) {
    const atrHistory = atrArr.slice(-60).filter(v => v != null && v > 0);
    if (atrHistory.length >= 30) {
      const sorted = [...atrHistory].sort((a, b) => a - b);
      const currentATR = atrArr[n - 1];
      const rank = sorted.findIndex(v => v >= currentATR);
      const percentile = (rank / sorted.length) * 100;
      if (percentile >= 90) {
        volScore = Math.max(0, volScore - 5);
        signals.push({ type: "neutral", name: `ATR 상위 ${(100 - percentile).toFixed(0)}% (극단 변동성)`, detail: "60일 내 최고 수준 변동성 — 리스크 관리 강화 필요" });
      } else if (percentile <= 10) {
        volScore = Math.min(100, volScore + 5);
        signals.push({ type: "neutral", name: `ATR 하위 ${percentile.toFixed(0)}% (극저 변동성)`, detail: "60일 내 최저 수준 변동성 — 폭발적 움직임 임박 가능" });
      }
    }
  }

  // ── 변동성 수축→확장 전환 감지 (Squeeze Momentum) ──
  if (bb && n >= 30) {
    const bbWidths = [];
    for (let i = n - 20; i < n; i++) {
      const bbAt = calcBB(closes.slice(0, i + 1), 20, 2);
      if (bbAt.length > 0) {
        const b = bbAt[bbAt.length - 1];
        bbWidths.push(b.middle > 0 ? (b.upper - b.lower) / b.middle : 0);
      }
    }
    if (bbWidths.length >= 10) {
      const recentWidth = bbWidths.slice(-3).reduce((a, b) => a + b, 0) / 3;
      const priorWidth = bbWidths.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
      if (recentWidth > priorWidth * 1.5 && priorWidth < 0.06) {
        const expandDir = change5 > 0 ? "상방" : change5 < 0 ? "하방" : "미정";
        signals.push({ type: "neutral", name: `스퀴즈 → 확장 돌파 (${expandDir})`, detail: `BB 폭 ${(priorWidth * 100).toFixed(1)}% → ${(recentWidth * 100).toFixed(1)}% 급확장 — 변동성 폭발 진행 중` });
        if (expandDir === "상방") { momScore = Math.min(100, momScore + 4); }
        else if (expandDir === "하방") { momScore = Math.max(0, momScore - 4); }
      }
    }
  }

  // ── 스마트머니 복합 지표 (CMF + OBV + 거래량 동시 확인) ──
  if (cmf != null && obvTrend && volRatio > 0) {
    const smartBull = cmf > 0.05 && obvTrend === "up" && volRatio > 1.2;
    const smartBear = cmf < -0.05 && obvTrend === "down" && volRatio > 1.2;
    if (smartBull && change20 < -3) {
      supScore = Math.min(100, supScore + 7);
      signals.push({ type: "bullish", name: "스마트머니 매집 감지", detail: `CMF(${cmf.toFixed(2)}) + OBV↑ + 거래량↑ — 하락 중 기관 매집 가능성` });
    } else if (smartBear && change20 > 3) {
      supScore = Math.max(0, supScore - 7);
      signals.push({ type: "bearish", name: "스마트머니 이탈 감지", detail: `CMF(${cmf.toFixed(2)}) + OBV↓ + 거래량↑ — 상승 중 기관 이탈 가능성` });
    }
  }

  // ── 리스크/리워드 분석 & 손절/익절 레벨 (ATR 다중 배수 + SAR 참조) ──
  const riskReward = (() => {
    // 손절: SAR, 지지선, ATR 2배 중 가장 타이트한 값
    const candidates = [];
    if (nearestSupport) candidates.push(nearestSupport * 0.99);
    if (atr) candidates.push(last - atr * 2);
    if (parabolicSAR && parabolicSAR.isUpTrend) candidates.push(parabolicSAR.sar * 0.995);
    const stopLoss = candidates.length > 0 ? Math.max(...candidates.filter(c => c < last)) : last * 0.95;

    // 익절: 저항선, ATR 3배, 피보나치 레벨 중 최적
    const tpCandidates = [];
    if (nearestResist) tpCandidates.push(nearestResist * 0.99);
    if (atr) tpCandidates.push(last + atr * 3);
    if (fibonacci && fibonacci.levels) {
      const aboveLevels = Object.values(fibonacci.levels).filter(p => p > last * 1.02);
      if (aboveLevels.length > 0) tpCandidates.push(Math.min(...aboveLevels));
    }
    const takeProfit = tpCandidates.length > 0 ? Math.min(...tpCandidates.filter(c => c > last)) : last * 1.10;

    const risk = last - stopLoss;
    const reward = takeProfit - last;
    const ratio = risk > 0 ? reward / risk : 0;
    // 켈리 기준 포지션 크기 근사 (승률을 totalScore 기반 추정)
    const winProb = Math.min(0.75, Math.max(0.25, totalScore / 100));
    const kelly = ratio > 0 ? Math.max(0, (winProb * ratio - (1 - winProb)) / ratio) : 0;
    const positionPct = Math.min(25, Math.round(kelly * 100 * 0.5)); // Half-Kelly (보수적)
    return { stopLoss, takeProfit, riskPct: (risk / last * 100), rewardPct: (reward / last * 100), ratio, kelly, positionPct };
  })();

  // ── 종합 리스크 등급 ──
  const riskLevel = (() => {
    let riskPts = 0;
    if (atrPct > 4) riskPts += 3;
    else if (atrPct > 2.5) riskPts += 2;
    else if (atrPct > 1.5) riskPts += 1;
    if (volRatio > 2.5) riskPts += 2;
    else if (volRatio > 1.5) riskPts += 1;
    if (adx != null && adx > 40) riskPts += 1;
    if (Math.abs(fromHigh) > 30) riskPts += 1;
    if (riskPts >= 5) return { level: "높음", icon: "🔴", detail: "고변동 + 고위험 구간" };
    if (riskPts >= 3) return { level: "보통", icon: "🟡", detail: "적정 수준의 변동성" };
    return { level: "낮음", icon: "🟢", detail: "안정적 구간" };
  })();

  // ── 신호 일치도 (Signal Consensus) — 카테고리 간 방향성 합의 ──
  const signalConsensus = (() => {
    const catScores = [trendScore, momScore, volScore, supScore, posScore, patternScore];
    const bullish = catScores.filter(s => s >= 60).length;
    const bearish = catScores.filter(s => s <= 40).length;
    const neutral = catScores.filter(s => s > 40 && s < 60).length;
    // 방향 일치도 (0~100): 모든 카테고리가 같은 방향이면 100
    const maxDirection = Math.max(bullish, bearish);
    const consensus = Math.round((maxDirection / catScores.length) * 100);
    // 점수 분산 (낮을수록 일치)
    const mean = catScores.reduce((a, b) => a + b, 0) / catScores.length;
    const variance = Math.sqrt(catScores.reduce((s, v) => s + (v - mean) ** 2, 0) / catScores.length);
    const label = consensus >= 83 ? "매우 강함" : consensus >= 67 ? "강함" : consensus >= 50 ? "보통" : "약함 (혼재)";
    return { consensus, bullish, bearish, neutral, variance: variance.toFixed(1), label };
  })();

  return {
    score: totalScore,
    verdict,
    summary,
    categories: [
      { name: "추세", icon: "\uD83D\uDCC8", score: trendScore, detail: trendDetail },
      { name: "모멘텀", icon: "\u26A1", score: momScore, detail: `RSI ${rsi != null ? rsi.toFixed(1) : "—"} | MACD ${macdVal != null ? (macdVal > sigVal ? "↑" : "↓") : "—"} | Stoch %K ${stochK != null ? stochK.toFixed(0) : "—"}` },
      { name: "변동성", icon: "\uD83C\uDF0A", score: volScore, detail: volDetail },
      { name: "수급", icon: "\uD83D\uDCCA", score: supScore, detail: supDetail },
      { name: "가격위치", icon: "\uD83C\uDFAF", score: posScore, detail: posDetail },
      { name: "캔들패턴", icon: "\uD83D\uDD25", score: patternScore, detail: patternDetail },
    ],
    signals,
    fairValue,
    fairValueMethod,
    currentPrice: last,
    rsi, macdVal, stochK, stochD, wr, adx, volRatio, volTrend, pos52, fromHigh, change1, change5, change10, change20, change60,
    atrPct, disp20, maAlignment,
    vwap, vwapDeviation,
    supportResistance, distToSupport, distToResist,
    maConvergence,
    ichimoku, fibonacci,
    cmf, dmi, keltner,
    parabolicSAR,
    riskReward,
    riskLevel,
    trendConfidence,
    signalConsensus,
  };
}

// ── Full-page chart component ────────────────────────────────────
// 모바일 감지는 useIsMobile (src/ui/useBreakpoint.jsx) SSOT 사용

export default function ChartModal({ asset, onClose, krwRate, theme = "dark" }) {
  const CC = theme === "dark" ? CC_DARK : CC_LIGHT;
  const isMobile = useIsMobile();
  const containerRef = useRef(null);
  const mainRef   = useRef(null);
  const rsiRef    = useRef(null);
  const macdRef   = useRef(null);
  const chartObjs = useRef({});
  const candleSeriesRef = useRef(null);  // for real-time update
  const lastCandleRef = useRef(null);    // last candle data
  const liveIntervalRef = useRef(null);  // polling interval

  const [timeframe, setTimeframe] = useState("1d");
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);
  const [ohlcInfo, setOhlcInfo] = useState(null);
  const [showKRW, setShowKRW] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [livePrice, setLivePrice] = useState(null);
  const [liveChange, setLiveChange] = useState(null);
  const [liveConnected, setLiveConnected] = useState(false);
  const [diagData, setDiagData] = useState(null);
  const [logScale, setLogScale] = useState(false);
  const [currentRSI, setCurrentRSI] = useState(null);
  const [showDiagnosis, setShowDiagnosis] = useState(false);

  // ── Customizable indicator settings ──
  const [settings, setSettings] = useState(() => {
    try { const s = localStorage.getItem("chart-settings"); return s ? JSON.parse(s) : DEFAULT_SETTINGS; }
    catch { return DEFAULT_SETTINGS; }
  });

  // Persist settings
  const updateSettings = (newSettings) => {
    setSettings(newSettings);
    try { localStorage.setItem("chart-settings", JSON.stringify(newSettings)); } catch {}
  };

  const isCrypto = asset?.market === "crypto";
  const isUS = asset?.market === "us";
  const canShowKRW = (isUS || isCrypto) && krwRate;

  const fetchData = useCallback(async (tf) => {
    setLoading(true);
    setError(null);
    try {
      let candles;
      // Aggregation factor for 10m (from 5m x2), 2h (from 1h x2), 4h (from 1h x4)
      const aggFactor = tf === "10m" ? 2 : tf === "2h" ? 2 : tf === "4h" ? 4 : 1;

      if (isCrypto) {
        const { days } = CRYPTO_TF[tf] || CRYPTO_TF["1d"];
        const coinId = asset.cryptoId || asset.symbolRaw || asset.id || asset.symbol.toLowerCase();
        const r = await fetch(`/api/coingecko?id=${encodeURIComponent(coinId)}&days=${days}&type=ohlc`);
        if (!r.ok) throw new Error(`CoinGecko ${r.status}`);
        const j = await r.json();
        candles = (j.candles || []).map(c => ({ ...c, time: tsToTime(c.time, tf) }));
      } else {
        const cfg = TF_CONFIG[tf] || TF_CONFIG["1d"];
        const sym = asset.symbolRaw || asset.symbol;
        const isIntra = ["1m","5m","10m","30m","1h","2h","4h"].includes(tf);
        const r = await fetch(`/api/yahoo-ohlc?symbol=${encodeURIComponent(sym)}&interval=${cfg.interval}&range=${cfg.range}&prepost=true&_t=${Date.now()}`);
        if (!r.ok) throw new Error(`Yahoo ${r.status}`);
        const j = await r.json();
        let raw = j.candles || [];

        // 인트라데이: 프리/포스트마켓 이상 꼬리 클리핑
        // Yahoo includePrePost에서 정규장 시가/종가 근처에 극단 고가/저가가 포함되는 문제 보정
        if (isIntra && raw.length > 0) {
          raw = raw.filter(c => c.volume > 0 || Math.abs(c.close - c.open) > 0); // volume=0 & flat 제거
          raw = raw.map(c => {
            const body = Math.abs(c.close - c.open);
            const midPrice = (c.open + c.close) / 2;
            const maxWick = Math.max(body * 5, midPrice * 0.005); // body의 5배 또는 0.5% 중 큰 값
            const topBody = Math.max(c.open, c.close);
            const botBody = Math.min(c.open, c.close);
            return {
              ...c,
              high: Math.min(c.high, topBody + maxWick),
              low: Math.max(c.low, botBody - maxWick),
            };
          });
        }

        candles = raw.map(c => ({ ...c, time: tsToTime(c.time, tf) }));
      }

      // Aggregate if needed (10m, 2h, 4h)
      if (aggFactor > 1) {
        candles = aggregateCandles(candles, aggFactor);
      }

      candles = deduplicateCandles(candles, tf);
      if (!candles.length) throw new Error("데이터 없음");

      // KRW conversion for US & crypto assets
      if (showKRW && canShowKRW && krwRate) {
        candles = candles.map(c => ({
          ...c,
          open: c.open * krwRate,
          high: c.high * krwRate,
          low: c.low * krwRate,
          close: c.close * krwRate,
        }));
      }

      return candles;
    } catch (e) {
      setError(e.message);
      return null;
    } finally {
      setLoading(false);
    }
  }, [asset, isCrypto, showKRW, canShowKRW, krwRate]);

  const buildCharts = useCallback(async (tf) => {
    const candles = await fetchData(tf);
    if (!candles) return;

    Object.values(chartObjs.current).forEach(c => { try { c.remove(); } catch {} });
    chartObjs.current = {};
    if (mainRef.current) mainRef.current.innerHTML = "";
    if (rsiRef.current) rsiRef.current.innerHTML = "";
    if (macdRef.current) macdRef.current.innerHTML = "";

    const closes  = candles.map(c => c.close);
    const times   = candles.map(c => c.time);
    const volumes = candles.map(c => c.volume ?? 0);

    const showRSI  = settings.rsi?.enabled;
    const showMACD = settings.macd?.enabled;
    const showVol  = settings.vol?.enabled;
    const mainH  = showRSI || showMACD ? 360 : 520;
    const subH   = 130;

    const containerW = containerRef.current?.clientWidth || 600;

    // ── Main chart ───
    const mainChart = createChart(mainRef.current, makeChartOptions(mainH, containerW, tf, CC));
    chartObjs.current.main = mainChart;

    // Apply log scale if enabled
    if (logScale) {
      mainChart.priceScale('right').applyOptions({ mode: 1 }); // Logarithmic
    }

    const candleSeries = mainChart.addCandlestickSeries({
      upColor: "#26a64b", downColor: "#ef4444",
      borderUpColor: "#26a64b", borderDownColor: "#ef4444",
      wickUpColor: "#26a64b", wickDownColor: "#ef4444",
    });
    candleSeries.setData(candles.map(c => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close })));
    candleSeriesRef.current = candleSeries;
    lastCandleRef.current = candles.length ? { ...candles[candles.length - 1] } : null;
    // Set initial live price from last candle
    if (candles.length) {
      const last = candles[candles.length - 1];
      setLivePrice(last.close);
      if (candles.length >= 2) {
        const prev = candles[candles.length - 2].close;
        setLiveChange(prev ? ((last.close - prev) / prev) * 100 : null);
      }
    }
    // 투자진단 실행 (날봉 이상일 때만 의미있음)
    if (!isIntraday(tf) && candles.length >= 20) {
      try { setDiagData(runDiagnosis(candles)); } catch { setDiagData(null); }
    } else {
      setDiagData(null);
    }

    // Volume histogram
    if (showVol) {
      const volSeries = mainChart.addHistogramSeries({
        color: "#1f6feb44",
        priceFormat: { type: "volume" },
        priceScaleId: "vol",
      });
      mainChart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });
      volSeries.setData(candles.map((c, i) => ({
        time: c.time, value: volumes[i],
        color: c.close >= c.open ? "#26a64b44" : "#ef444444",
      })));
    }

    // MA lines from settings — lastValueVisible: false
    (settings.maList || []).forEach(({ enabled, period, color, width }) => {
      if (!enabled) return;
      const sma = calcSMA(closes, period);
      const maSeries = mainChart.addLineSeries({
        color, lineWidth: width,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      maSeries.setData(sma.map((v, i) => v != null ? { time: times[i], value: v } : null).filter(Boolean));
    });

    // Bollinger Bands from settings
    if (settings.bb?.enabled) {
      const bbPeriod = settings.bb.period || 20;
      const bbMult = settings.bb.mult || 2;
      const bbs = calcBB(closes, bbPeriod, bbMult);
      const bbUpper = mainChart.addLineSeries({ color: "#60a5fa88", lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false, lineStyle: LineStyle.Dashed });
      const bbMid   = mainChart.addLineSeries({ color: "#60a5facc", lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
      const bbLower = mainChart.addLineSeries({ color: "#60a5fa88", lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false, lineStyle: LineStyle.Dashed });
      const toSeries = (fn) => bbs.map((b, i) => b ? { time: times[i], value: fn(b) } : null).filter(Boolean);
      bbUpper.setData(toSeries(b => b.upper));
      bbMid.setData(toSeries(b => b.middle));
      bbLower.setData(toSeries(b => b.lower));
    }

    // Crosshair info
    mainChart.subscribeCrosshairMove(p => {
      if (p.time) {
        let bar;
        if (isIntraday(tf)) {
          bar = candles.find(c => c.time === p.time);
        } else {
          bar = candles.find(c =>
            c.time.year === p.time.year && c.time.month === p.time.month && c.time.day === p.time.day
          );
        }
        if (bar) setOhlcInfo(bar);
      }
    });

    // ── RSI chart ───
    if (showRSI && rsiRef.current) {
      const rsiPeriod = settings.rsi?.period || 14;
      const rsiChart = createChart(rsiRef.current, makeChartOptions(subH, containerW, tf, CC));
      chartObjs.current.rsi = rsiChart;
      const rsi = calcRSI(closes, rsiPeriod);
      // Store the current RSI value
      const lastRSI = rsi.filter(v => v != null).pop();
      setCurrentRSI(lastRSI);
      const rsiSeries = rsiChart.addLineSeries({ color: "#f472b6", lineWidth: 2, priceLineVisible: false, lastValueVisible: false });
      rsiSeries.setData(rsi.map((v, i) => v != null ? { time: times[i], value: v } : null).filter(Boolean));
      [70, 30].forEach(lvl => {
        const line = rsiChart.addLineSeries({ color: lvl === 70 ? "#f4723055" : "#34d39955", lineWidth: 1, priceLineVisible: false, lastValueVisible: false, lineStyle: LineStyle.Dotted });
        line.setData(times.map(t => ({ time: t, value: lvl })));
      });
      let syncing = false;
      mainChart.timeScale().subscribeVisibleLogicalRangeChange(r => {
        if (r && !syncing) { syncing = true; rsiChart.timeScale().setVisibleLogicalRange(r); syncing = false; }
      });
      rsiChart.timeScale().subscribeVisibleLogicalRangeChange(r => {
        if (r && !syncing) { syncing = true; mainChart.timeScale().setVisibleLogicalRange(r); syncing = false; }
      });
    }

    // ── MACD chart ───
    if (showMACD && macdRef.current) {
      const macdChart = createChart(macdRef.current, makeChartOptions(subH, containerW, tf, CC));
      chartObjs.current.macd = macdChart;
      const { macdLine, signalLine, histogram } = calcMACD(closes);

      const histSeries = macdChart.addHistogramSeries({ priceLineVisible: false, lastValueVisible: false });
      histSeries.setData(histogram.map((v, i) => v != null ? { time: times[i], value: v, color: v >= 0 ? "#26a64b99" : "#ef444499" } : null).filter(Boolean));

      const macdSeries = macdChart.addLineSeries({ color: "#38bdf8", lineWidth: 2, priceLineVisible: false, lastValueVisible: false });
      macdSeries.setData(macdLine.map((v, i) => v != null ? { time: times[i], value: v } : null).filter(Boolean));

      const sigSeries = macdChart.addLineSeries({ color: "#fb923c", lineWidth: 2, priceLineVisible: false, lastValueVisible: false });
      sigSeries.setData(signalLine.map((v, i) => v != null ? { time: times[i], value: v } : null).filter(Boolean));

      let syncing2 = false;
      mainChart.timeScale().subscribeVisibleLogicalRangeChange(r => {
        if (r && !syncing2) { syncing2 = true; macdChart.timeScale().setVisibleLogicalRange(r); syncing2 = false; }
      });
      macdChart.timeScale().subscribeVisibleLogicalRangeChange(r => {
        if (r && !syncing2) { syncing2 = true; mainChart.timeScale().setVisibleLogicalRange(r); syncing2 = false; }
      });
    }

    // ★ 2026-06-12 (대표 피드백): fitContent() 는 전체 데이터를 화면에 욱여넣어
    //   봉 간격이 뭉개지고 우측 여백이 사라짐 → 트레이딩뷰처럼 '최근 ~110봉 + 우측 8봉 여백'
    //   가시 범위로 설정. 과거는 드래그/휠로 자유 탐색.
    const applyTvRange = () => {
      try {
        const total = candles.length;
        const visibleBars = Math.min(total, 110);
        mainChart.timeScale().setVisibleLogicalRange({ from: total - visibleBars, to: total + 8 });
      } catch {}
    };
    applyTvRange(); // 서브차트(RSI/MACD)는 logical-range 동기화 구독으로 자동 추종

    requestAnimationFrame(() => {
      const w = containerRef.current?.clientWidth;
      if (w) {
        Object.values(chartObjs.current).forEach(c => {
          try { c.applyOptions({ width: w }); } catch {}
        });
        applyTvRange();
      }
    });
  }, [fetchData, settings, logScale]);

  useEffect(() => {
    if (!asset) return;
    const timer = setTimeout(() => buildCharts(timeframe), 80);
    return () => {
      clearTimeout(timer);
      Object.values(chartObjs.current).forEach(c => { try { c.remove(); } catch {} });
    };
  }, [asset, timeframe, settings, showKRW, theme, logScale]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      if (!w) return;
      Object.values(chartObjs.current).forEach(c => { try { c.applyOptions({ width: w }); } catch {} });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── Ctrl+Wheel 줌 (일반 스크롤은 페이지 스크롤) ──
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handleWheel = (e) => {
      // Ctrl or Meta 키를 누른 상태에서만 차트 줌
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const mainChart = chartObjs.current.main;
        if (!mainChart) return;
        const ts = mainChart.timeScale();
        const range = ts.getVisibleLogicalRange();
        if (!range) return;
        const zoomFactor = e.deltaY > 0 ? 1.15 : 0.87;
        const center = (range.from + range.to) / 2;
        const halfSpan = ((range.to - range.from) / 2) * zoomFactor;
        ts.setVisibleLogicalRange({ from: center - halfSpan, to: center + halfSpan });
      }
      // Ctrl 없으면 → 기본 스크롤 동작 (페이지 스크롤)
    };
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, []);

  // ── Real-time price polling (3s interval) ──
  useEffect(() => {
    if (!asset) return;
    let active = true;

    const fetchLive = async () => {
      try {
        let price = null;
        if (isCrypto) {
          const coinId = asset.cryptoId || asset.symbolRaw || asset.id || asset.symbol.toLowerCase();
          const r = await fetch(`/api/coingecko?id=${encodeURIComponent(coinId)}&days=1`);
          if (r.ok) {
            const j = await r.json();
            const prices = j.prices || [];
            if (prices.length) price = prices[prices.length - 1][1];
          }
        } else {
          const sym = asset.symbolRaw || asset.symbol;
          const r = await fetch(`/api/yahoo?symbol=${encodeURIComponent(sym)}&interval=1m&range=1d`);
          if (r.ok) {
            const j = await r.json();
            if (j.closes?.length) price = j.closes[j.closes.length - 1];
          }
        }
        if (!active || price == null) return;

        // Apply KRW conversion if active
        const displayPrice = (showKRW && canShowKRW && krwRate) ? price * krwRate : price;
        setLivePrice(displayPrice);
        setLiveConnected(true);

        // Update last candle on chart
        const lastCandle = lastCandleRef.current;
        const series = candleSeriesRef.current;
        if (lastCandle && series) {
          const updatedCandle = {
            time: lastCandle.time,
            open: lastCandle.open,
            high: Math.max(lastCandle.high, displayPrice),
            low: Math.min(lastCandle.low, displayPrice),
            close: displayPrice,
          };
          try { series.update(updatedCandle); } catch {}
          lastCandleRef.current = updatedCandle;
        }

        // Calculate change from previous candle close (stored in asset or derived)
        if (lastCandle) {
          const prevClose = lastCandle.open; // open of current candle as reference
          if (prevClose) setLiveChange(((displayPrice - prevClose) / prevClose) * 100);
        }
      } catch {
        if (active) setLiveConnected(false);
      }
    };

    // Initial fetch after short delay to let chart build
    const initTimer = setTimeout(fetchLive, 1500);

    // Poll interval: crypto 5s (rate limit), stocks 3s
    const interval = isCrypto ? 5000 : 3000;
    liveIntervalRef.current = setInterval(fetchLive, interval);

    return () => {
      active = false;
      clearTimeout(initTimer);
      if (liveIntervalRef.current) clearInterval(liveIntervalRef.current);
      setLiveConnected(false);
    };
  }, [asset, isCrypto, showKRW, canShowKRW, krwRate, timeframe]);

  // Prevent body scrolling + inject live pulse animation
  useEffect(() => {
    document.body.style.overflow = "hidden";
    const styleId = "live-pulse-style";
    if (!document.getElementById(styleId)) {
      const style = document.createElement("style");
      style.id = styleId;
      style.textContent = `@keyframes livePulse { 0%,100%{opacity:1} 50%{opacity:0.4} }`;
      document.head.appendChild(style);
    }
    return () => { document.body.style.overflow = ""; };
  }, []);

  if (!asset) return null;

  const formatPrice = (p) => fmtPrice(p, asset.market);

  const formatPriceWithKRW = (p) => {
    const usd = fmtPrice(p, asset.market);
    if (showKRW && isUS && krwRate && p) {
      const krw = Math.round(p * krwRate).toLocaleString("ko-KR");
      return `${usd} (₩${krw})`;
    }
    return usd;
  };

  // Timeframe button order
  const tfOrder = ["1m", "5m", "10m", "30m", "1h", "2h", "4h", "1d", "1wk", "1mo"];
  const tfLabels = isCrypto ? CRYPTO_TF : TF_CONFIG;

  // ── Full-page layout ───────────────────────────────────────────
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 1000,
      background: CC.bg, display: "flex", flexDirection: "column",
      overflow: "hidden",
      /* iOS 세이프 에어리어 (노치/다이나믹 아일랜드) 대응 */
      paddingTop: "env(safe-area-inset-top, 0px)",
      paddingBottom: "env(safe-area-inset-bottom, 0px)",
    }}>
      {/* Top bar — 모바일 잘림 방지: 2줄 레이아웃, 최소 높이 보장 */}
      <div style={{
        display: "flex", flexDirection: "column", gap: isMobile ? "5px" : "6px",
        padding: isMobile ? "8px 10px 6px" : "10px 12px 8px", borderBottom: `1px solid ${CC.border}`,
        background: `${CC.bg}f5`, backdropFilter: "blur(8px)", flexShrink: 0,
      }}>
        {/* 1행: 뒤로 + 종목명 + LIVE 배지 */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: isMobile ? "6px" : "8px", minWidth: 0, flex: 1 }}>
            <button onClick={onClose} style={{
              background: CC.card, border: `1px solid ${CC.border}`, color: CC.text2, cursor: "pointer",
              fontSize: isMobile ? "14px" : "15px", padding: isMobile ? "8px 8px" : "6px 10px", borderRadius: "8px", fontWeight: 600, flexShrink: 0, minHeight: isMobile ? "40px" : "auto", minWidth: isMobile ? "40px" : "auto", display: "flex", alignItems: "center", justifyContent: "center",
            }}>←</button>
            <span style={{ fontSize: isMobile ? "16px" : "18px", flexShrink: 0 }}>
              {asset.market === "us" ? "\uD83C\uDDFA\uD83C\uDDF8" : asset.market === "kr" ? "\uD83C\uDDF0\uD83C\uDDF7" : "\u20BF"}
            </span>
            <div style={{ minWidth: 0, overflow: "hidden" }}>
              <div style={{ color: CC.text1, fontWeight: 700, fontSize: isMobile ? "15px" : "18px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{asset.name}</div>
              <div style={{ color: CC.text3, fontSize: isMobile ? "12px" : "14px" }}>{asset.symbol}</div>
            </div>
          </div>
          {liveConnected && (
            <span style={{
              display: "inline-flex", alignItems: "center", gap: "3px", flexShrink: 0,
              fontSize: "12px", fontWeight: 700, color: CC.green,
              background: CC.greenBg, padding: "2px 6px", borderRadius: "4px",
              animation: "livePulse 1.5s ease-in-out infinite",
            }}>
              <span style={{ width: "5px", height: "5px", borderRadius: "50%", background: CC.green, display: "inline-block" }} />
              LIVE
            </span>
          )}
        </div>
        {/* 2행: 가격 + 등락률 + KRW 토글 */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: isMobile ? "6px" : "12px", flexWrap: isMobile ? "wrap" : "nowrap" }}>
          <span style={{ color: CC.text1, fontWeight: 700, fontSize: isMobile ? "16px" : "18px" }}>
            {livePrice != null
              ? (showKRW && canShowKRW
                  ? `₩${Math.round(livePrice).toLocaleString("ko-KR")}`
                  : fmtPrice(livePrice, asset.market))
              : formatPriceWithKRW(asset.price)}
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: isMobile ? "4px" : "6px", minHeight: isMobile ? "40px" : "auto" }}>
            {liveChange != null ? (
              <span style={{ fontSize: isMobile ? "14px" : "15px", fontWeight: 600, color: liveChange >= 0 ? CC.green : CC.red }}>
                {liveChange >= 0 ? "\u25B2" : "\u25BC"} {Math.abs(liveChange).toFixed(2)}%
              </span>
            ) : asset.weekChange != null ? (
              <span style={{ fontSize: isMobile ? "14px" : "15px", fontWeight: 600, color: asset.weekChange >= 0 ? CC.green : CC.red }}>
                {asset.weekChange >= 0 ? "\u25B2" : "\u25BC"} {Math.abs(asset.weekChange)}%
              </span>
            ) : null}
            {canShowKRW && (
              <button onClick={() => setShowKRW(!showKRW)} style={{
                fontSize: isMobile ? "12px" : "14px", padding: isMobile ? "6px 8px" : "3px 7px", borderRadius: "6px", cursor: "pointer",
                background: showKRW ? CC.blue + "33" : "transparent",
                color: showKRW ? CC.blue : CC.text3,
                border: `1px solid ${showKRW ? CC.blue : CC.border}`,
                minHeight: isMobile ? "40px" : "auto", display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                {showKRW ? "\u20A9 KRW" : "$ USD"}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Scrollable body */}
      <div ref={containerRef} style={{ flex: 1, overflowY: "auto", overflowX: "hidden", padding: "10px 12px", WebkitOverflowScrolling: "touch" }}>

        {/* OHLC crosshair info */}
        {ohlcInfo && (
          <div style={{
            display: "flex", gap: "12px", marginBottom: "8px",
            background: CC.card, borderRadius: "10px", padding: "8px 12px",
            fontSize: "14px", flexWrap: "wrap", border: `1px solid ${CC.border}`,
          }}>
            {[["O", ohlcInfo.open], ["H", ohlcInfo.high], ["L", ohlcInfo.low], ["C", ohlcInfo.close]].map(([label, val]) => (
              <span key={label} style={{ color: CC.text3 }}>
                <span style={{ marginRight: "4px" }}>{label}</span>
                <span style={{ color: CC.text1, fontWeight: 600 }}>{formatPriceWithKRW(val)}</span>
              </span>
            ))}
            {ohlcInfo.volume != null && ohlcInfo.volume > 0 && (
              <span style={{ color: CC.text3 }}>
                V <span style={{ color: CC.text1, fontWeight: 600 }}>{ohlcInfo.volume >= 1e9 ? `${(ohlcInfo.volume / 1e9).toFixed(1)}B` : ohlcInfo.volume >= 1e6 ? `${(ohlcInfo.volume / 1e6).toFixed(1)}M` : ohlcInfo.volume.toLocaleString()}</span>
              </span>
            )}
          </div>
        )}

        {/* Timeframe buttons — 10 granularities */}
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(5, 1fr)" : "repeat(10, 1fr)", gap: isMobile ? "3px" : "4px", marginBottom: "8px" }}>
          {tfOrder.map(key => {
            const cfg = tfLabels[key];
            if (!cfg) return null;
            return (
              <button key={key} onClick={() => setTimeframe(key)} style={{
                padding: isMobile ? "8px 4px" : "5px 10px", borderRadius: "8px", fontSize: isMobile ? "12px" : "14px", cursor: "pointer", fontWeight: 600,
                background: timeframe === key ? CC.blue : CC.card,
                color: timeframe === key ? "#fff" : CC.text3,
                border: `1px solid ${timeframe === key ? CC.blue : CC.border}`,
                minHeight: isMobile ? "40px" : "auto",
              }}>{cfg.label}</button>
            );
          })}
        </div>

        {/* Log scale toggle button */}
        <div style={{ display: "flex", gap: "4px", marginBottom: "8px", flexWrap: "wrap" }}>
          <button onClick={() => setLogScale(p => !p)} style={{
            padding: isMobile ? "8px 10px" : "5px 10px", borderRadius: "8px", fontSize: isMobile ? "14px" : "14px", cursor: "pointer", fontWeight: 600,
            background: logScale ? `${CC.yellow}22` : CC.card,
            color: logScale ? CC.yellow : CC.text3,
            border: `1px solid ${logScale ? CC.yellow : CC.border}`,
            minHeight: isMobile ? "40px" : "auto",
          }}>📐 로그</button>
        </div>

        {/* Indicator quick toggles + settings gear */}
        <div style={{ display: "flex", gap: isMobile ? "3px" : "5px", marginBottom: showSettings ? "0px" : "12px", flexWrap: "wrap", alignItems: "center" }}>
          {(settings.maList || []).map((ma, idx) => (
            <button key={`ma-${idx}`} onClick={() => {
              const newList = [...settings.maList];
              newList[idx] = { ...newList[idx], enabled: !newList[idx].enabled };
              updateSettings({ ...settings, maList: newList });
            }} style={{
              padding: isMobile ? "6px 8px" : "4px 9px", borderRadius: "8px", fontSize: isMobile ? "12px" : "14px", cursor: "pointer", fontWeight: 600,
              background: ma.enabled ? `${ma.color}22` : "transparent",
              color: ma.enabled ? ma.color : CC.text3,
              border: `1px solid ${ma.enabled ? `${ma.color}88` : CC.border}`,
              minHeight: isMobile ? "40px" : "auto", display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <span style={{ display: "inline-block", width: "7px", height: "7px", borderRadius: "50%", background: ma.enabled ? ma.color : CC.text3, marginRight: "4px", verticalAlign: "middle" }} />
              MA{ma.period}
            </button>
          ))}
          {[
            { key: "bb", label: "BB", color: "#60a5fa" },
            { key: "vol", label: "\uAC70\uB798\uB7C9", color: "#1f6feb" },
            { key: "rsi", label: "RSI", color: "#f472b6" },
            { key: "macd", label: "MACD", color: "#34d399" },
          ].map(({ key, label, color }) => (
            <button key={key} onClick={() => {
              updateSettings({ ...settings, [key]: { ...settings[key], enabled: !settings[key]?.enabled } });
            }} style={{
              padding: "4px 9px", borderRadius: "8px", fontSize: "14px", cursor: "pointer", fontWeight: 600,
              background: settings[key]?.enabled ? `${color}22` : "transparent",
              color: settings[key]?.enabled ? color : CC.text3,
              border: `1px solid ${settings[key]?.enabled ? `${color}88` : CC.border}`,
            }}>
              <span style={{ display: "inline-block", width: "7px", height: "7px", borderRadius: "50%", background: settings[key]?.enabled ? color : CC.text3, marginRight: "4px", verticalAlign: "middle" }} />
              {label}
            </button>
          ))}
          {/* Settings gear button */}
          <button onClick={() => setShowSettings(!showSettings)} style={{
            padding: "4px 9px", borderRadius: "8px", fontSize: "16px", cursor: "pointer",
            background: showSettings ? CC.card2 : "transparent",
            color: showSettings ? CC.blue : CC.text3,
            border: `1px solid ${showSettings ? CC.blue : CC.border}`,
            marginLeft: "auto",
          }} title="보조지표 설정">{"\u2699\uFE0F"}</button>
        </div>

        {/* Settings panel (collapsible) */}
        {showSettings && (
          <div style={{
            background: CC.card, border: `1px solid ${CC.border}`, borderRadius: "12px",
            padding: "14px", marginBottom: "12px",
          }}>
            <div style={{ fontSize: "15px", fontWeight: 700, color: CC.text1, marginBottom: "12px" }}>
              {"\u2699\uFE0F"} 보조지표 설정
            </div>

            {/* MA settings */}
            <div style={{ marginBottom: "12px" }}>
              <div style={{ fontSize: "14px", color: CC.text3, marginBottom: "6px", fontWeight: 600 }}>이동평균선 (MA)</div>
              {(settings.maList || []).map((ma, idx) => (
                <div key={idx} style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                  <input type="checkbox" checked={ma.enabled} onChange={() => {
                    const newList = [...settings.maList];
                    newList[idx] = { ...newList[idx], enabled: !newList[idx].enabled };
                    updateSettings({ ...settings, maList: newList });
                  }} style={{ accentColor: ma.color }} />
                  <span style={{ fontSize: "14px", color: CC.text2, width: "28px" }}>MA</span>
                  <input type="number" value={ma.period} min={1} max={500} onChange={e => {
                    const newList = [...settings.maList];
                    newList[idx] = { ...newList[idx], period: parseInt(e.target.value) || 5 };
                    updateSettings({ ...settings, maList: newList });
                  }} style={{
                    width: "60px", padding: "4px 6px", borderRadius: "6px", fontSize: "14px",
                    background: CC.card2, color: CC.text1, border: `1px solid ${CC.border2}`, outline: "none",
                  }} />
                  <input type="color" value={ma.color} onChange={e => {
                    const newList = [...settings.maList];
                    newList[idx] = { ...newList[idx], color: e.target.value };
                    updateSettings({ ...settings, maList: newList });
                  }} style={{ width: "28px", height: "24px", border: "none", cursor: "pointer", background: "transparent" }} />
                  <button onClick={() => {
                    const newList = settings.maList.filter((_, i) => i !== idx);
                    updateSettings({ ...settings, maList: newList });
                  }} style={{
                    background: "transparent", border: "none", color: CC.red, cursor: "pointer", fontSize: "16px", padding: "2px",
                  }}>{"\u2715"}</button>
                </div>
              ))}
              <button onClick={() => {
                const colors = ["#facc15","#38bdf8","#f97316","#a855f7","#34d399","#f472b6","#fb923c","#60a5fa"];
                const c = colors[(settings.maList || []).length % colors.length];
                updateSettings({ ...settings, maList: [...(settings.maList || []), { enabled: true, period: 10, color: c, width: 2 }] });
              }} style={{
                fontSize: "14px", padding: "4px 10px", borderRadius: "6px", cursor: "pointer",
                background: CC.card2, color: CC.blue, border: `1px solid ${CC.border2}`, fontWeight: 600,
              }}>+ MA 추가</button>
            </div>

            {/* BB settings */}
            <div style={{ display: "flex", gap: "12px", alignItems: "center", marginBottom: "10px", flexWrap: "wrap" }}>
              <span style={{ fontSize: "14px", color: CC.text2, fontWeight: 600 }}>BB</span>
              <label style={{ fontSize: "14px", color: CC.text3 }}>기간
                <input type="number" value={settings.bb?.period || 20} min={5} max={100} onChange={e => {
                  updateSettings({ ...settings, bb: { ...settings.bb, period: parseInt(e.target.value) || 20 } });
                }} style={{
                  width: "50px", padding: "3px 5px", borderRadius: "6px", fontSize: "14px", marginLeft: "4px",
                  background: CC.card2, color: CC.text1, border: `1px solid ${CC.border2}`, outline: "none",
                }} />
              </label>
              <label style={{ fontSize: "14px", color: CC.text3 }}>배수
                <input type="number" value={settings.bb?.mult || 2} min={0.5} max={5} step={0.5} onChange={e => {
                  updateSettings({ ...settings, bb: { ...settings.bb, mult: parseFloat(e.target.value) || 2 } });
                }} style={{
                  width: "50px", padding: "3px 5px", borderRadius: "6px", fontSize: "14px", marginLeft: "4px",
                  background: CC.card2, color: CC.text1, border: `1px solid ${CC.border2}`, outline: "none",
                }} />
              </label>
            </div>

            {/* RSI settings */}
            <div style={{ display: "flex", gap: "12px", alignItems: "center", marginBottom: "10px" }}>
              <span style={{ fontSize: "14px", color: CC.text2, fontWeight: 600 }}>RSI</span>
              <label style={{ fontSize: "14px", color: CC.text3 }}>기간
                <input type="number" value={settings.rsi?.period || 14} min={2} max={50} onChange={e => {
                  updateSettings({ ...settings, rsi: { ...settings.rsi, period: parseInt(e.target.value) || 14 } });
                }} style={{
                  width: "50px", padding: "3px 5px", borderRadius: "6px", fontSize: "14px", marginLeft: "4px",
                  background: CC.card2, color: CC.text1, border: `1px solid ${CC.border2}`, outline: "none",
                }} />
              </label>
            </div>

            {/* Reset button */}
            <button onClick={() => updateSettings(DEFAULT_SETTINGS)} style={{
              fontSize: "14px", padding: "5px 12px", borderRadius: "6px", cursor: "pointer",
              background: "transparent", color: CC.text3, border: `1px solid ${CC.border2}`,
            }}>기본값으로 초기화</button>
          </div>
        )}

        {/* Chart area */}
        {loading && (
          <div style={{ textAlign: "center", padding: "80px", color: CC.text3 }}>
            <div style={{ fontSize: "28px", marginBottom: "8px", animation: "pulse 1s infinite" }}>\uD83D\uDCE1</div>
            <div>\uCC28\uD2B8 \uB370\uC774\uD130 \uB85C\uB529 \uC911...</div>
          </div>
        )}
        {error && !loading && (
          <div style={{ textAlign: "center", padding: "60px", color: CC.red }}>
            <div style={{ fontSize: "24px", marginBottom: "8px" }}>\u26A0\uFE0F</div>
            <div style={{ marginBottom: "12px" }}>{error}</div>
            <button onClick={() => buildCharts(timeframe)} style={{
              padding: "9px 20px", borderRadius: "10px", fontSize: "15px", fontWeight: 700,
              background: CC.blue, color: "#fff", border: "none", cursor: "pointer",
            }}>\uB2E4\uC2DC \uC2DC\uB3C4</button>
          </div>
        )}
        <div style={{ display: loading ? "none" : "block" }}>
          <div ref={mainRef} style={{
            width: "100%", borderRadius: "10px", overflow: "hidden",
            touchAction: "pan-y", WebkitOverflowScrolling: "auto",
          }} />
          {settings.rsi?.enabled && (
            <>
              <div style={{
                color: "#f472b6", fontSize: "14px", fontWeight: 600, padding: "8px 0 4px 4px",
                display: "flex", alignItems: "center", gap: "6px", justifyContent: "space-between",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <span style={{ width: "10px", height: "3px", background: "#f472b6", borderRadius: "4px", display: "inline-block" }} />
                  RSI({settings.rsi?.period || 14})
                </div>
                {currentRSI != null && (
                  <span style={{
                    fontSize: "15px", fontWeight: 700, padding: "2px 8px", borderRadius: "6px",
                    background: currentRSI >= 70 ? `${CC.red}22` : currentRSI <= 30 ? `${CC.green}22` : `${CC.text3}22`,
                    color: currentRSI >= 70 ? CC.red : currentRSI <= 30 ? CC.green : CC.text2,
                  }}>{currentRSI.toFixed(1)}</span>
                )}
              </div>
              <div ref={rsiRef} style={{ width: "100%", borderRadius: "10px", overflow: "hidden", touchAction: "pan-y" }} />
            </>
          )}
          {settings.macd?.enabled && (
            <>
              <div style={{
                fontSize: "14px", fontWeight: 600, padding: "8px 0 4px 4px",
                display: "flex", alignItems: "center", gap: "10px", color: CC.text3,
              }}>
                <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                  <span style={{ width: "10px", height: "3px", background: "#38bdf8", borderRadius: "4px", display: "inline-block" }} />
                  <span style={{ color: "#38bdf8" }}>MACD</span>
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                  <span style={{ width: "10px", height: "3px", background: "#fb923c", borderRadius: "4px", display: "inline-block" }} />
                  <span style={{ color: "#fb923c" }}>Signal</span>
                </span>
              </div>
              <div ref={macdRef} style={{ width: "100%", borderRadius: "10px", overflow: "hidden", touchAction: "pan-y" }} />
            </>
          )}
        </div>

        {/* Legend */}
        <div style={{
          marginTop: "12px", padding: "10px 12px",
          background: CC.card, borderRadius: "10px", border: `1px solid ${CC.border}`,
          display: "flex", gap: "12px", flexWrap: "wrap", fontSize: "14px",
        }}>
          {[
            ...(settings.maList || []).filter(m => m.enabled).map(m => ({ color: m.color, label: `MA${m.period}` })),
            ...(settings.bb?.enabled ? [{ color: "#60a5fa", label: `BB(${settings.bb?.period || 20},${settings.bb?.mult || 2})` }] : []),
            ...(settings.rsi?.enabled ? [{ color: "#f472b6", label: `RSI(${settings.rsi?.period || 14})` }] : []),
            ...(settings.macd?.enabled ? [{ color: "#38bdf8", label: "MACD" }, { color: "#fb923c", label: "Signal" }] : []),
          ].map(({ color, label }) => (
            <span key={label} style={{ display: "flex", alignItems: "center", gap: "5px", color: CC.text3 }}>
              <span style={{ width: "16px", height: "3px", background: color, display: "inline-block", borderRadius: "4px" }} />
              {label}
            </span>
          ))}
          {showKRW && canShowKRW && <span style={{ color: CC.blue, fontWeight: 600, marginLeft: "auto" }}>KRW 환산</span>}
        </div>

        {/* ── 투자진단 패널 ─────────────────────────────────────── */}
        {!loading && !error && diagData && (
          <div style={{ marginTop: "16px" }}>
            {/* Dropdown toggle */}
            <button onClick={() => setShowDiagnosis(p => !p)} style={{
              width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
              background: CC.card, border: `1px solid ${CC.border}`, borderRadius: "12px",
              padding: "14px 18px", cursor: "pointer", marginBottom: showDiagnosis ? "12px" : "0",
              transition: "all 0.2s",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <span style={{ fontSize: "18px" }}>🩺</span>
                <span style={{ fontSize: "16px", fontWeight: 700, color: CC.text1 }}>투자진단</span>
                <span style={{
                  fontSize: "14px", fontWeight: 700, padding: "3px 8px", borderRadius: "6px",
                  background: diagData.score >= 70 ? CC.greenBg : diagData.score >= 40 ? CC.yellowBg : CC.redBg,
                  color: diagData.score >= 70 ? CC.green : diagData.score >= 40 ? CC.yellow : CC.red,
                }}>{diagData.score}점 · {diagData.verdict}</span>
              </div>
              <span style={{
                fontSize: "16px", color: CC.text3,
                transform: showDiagnosis ? "rotate(180deg)" : "rotate(0deg)",
                transition: "transform 0.2s",
              }}>▼</span>
            </button>

            {showDiagnosis && (
              <>
                {/* 종합 점수 */}
                <div style={{
                  background: CC.card, border: `1px solid ${CC.border}`, borderRadius: "12px",
                  padding: "18px", marginBottom: "12px",
                  borderTop: "none", borderTopLeftRadius: "0", borderTopRightRadius: "0",
                }}>
                  {/* Score gauge */}
                  <div style={{ display: "flex", alignItems: "center", gap: "16px", marginBottom: "16px" }}>
                    <div style={{ position: "relative", width: "80px", height: "80px", flexShrink: 0 }}>
                      <svg viewBox="0 0 80 80" width="80" height="80">
                        <circle cx="40" cy="40" r="34" fill="none" stroke={CC.border} strokeWidth="7" />
                        <circle cx="40" cy="40" r="34" fill="none"
                          stroke={diagData.score >= 70 ? CC.green : diagData.score >= 40 ? CC.yellow : CC.red}
                          strokeWidth="7" strokeLinecap="round"
                          strokeDasharray={`${(diagData.score / 100) * 213.6} 213.6`}
                          transform="rotate(-90 40 40)"
                          style={{ transition: "stroke-dasharray 0.8s ease" }}
                        />
                        <text x="40" y="37" textAnchor="middle" fill={CC.text1} fontSize="18" fontWeight="800">{diagData.score}</text>
                        <text x="40" y="50" textAnchor="middle" fill={CC.text3} fontSize="9">/100</text>
                      </svg>
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{
                        fontSize: "18px", fontWeight: 800, marginBottom: "4px",
                        color: diagData.score >= 70 ? CC.green : diagData.score >= 40 ? CC.yellow : CC.red,
                      }}>{diagData.verdict}</div>
                      <div style={{ fontSize: "14px", color: CC.text2, lineHeight: "1.5" }}>{diagData.summary}</div>
                    </div>
                  </div>

                  {/* Fair value section */}
                  {diagData.fairValue != null && (
                    <div style={{
                      background: CC.bg, borderRadius: "10px", padding: "12px", marginBottom: "12px",
                      border: `1px solid ${CC.border}`,
                    }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                        <span style={{ fontSize: "14px", color: CC.text3, fontWeight: 600 }}>💰 적정가치 추정</span>
                        <span style={{ fontSize: "12px", color: CC.text3, background: CC.card2, padding: "2px 6px", borderRadius: "4px" }}>{diagData.fairValueMethod}</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
                        <div>
                          <div style={{ fontSize: "14px", color: CC.text3 }}>적정가치</div>
                          <div style={{ fontSize: "18px", fontWeight: 700, color: CC.text1 }}>{formatPrice(diagData.fairValue)}</div>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <div style={{ fontSize: "14px", color: CC.text3 }}>현재가 vs 적정가</div>
                          {(() => {
                            const premium = diagData.currentPrice && diagData.fairValue
                              ? ((diagData.currentPrice - diagData.fairValue) / diagData.fairValue) * 100
                              : 0;
                            const isOver = premium > 0;
                            return (
                              <div style={{
                                fontSize: "18px", fontWeight: 700,
                                color: Math.abs(premium) < 5 ? CC.yellow : isOver ? CC.red : CC.green,
                              }}>
                                {isOver ? "+" : ""}{premium.toFixed(1)}%
                                <span style={{ fontSize: "14px", marginLeft: "4px", fontWeight: 500 }}>
                                  {Math.abs(premium) < 5 ? "적정" : isOver ? "고평가" : "저평가"}
                                </span>
                              </div>
                            );
                          })()}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Category scores */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                    {diagData.categories.map(cat => (
                      <div key={cat.name} style={{
                        background: CC.bg, borderRadius: "10px", padding: "10px 12px",
                        border: `1px solid ${CC.border}`,
                      }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                          <span style={{ fontSize: "14px", color: CC.text3, fontWeight: 600 }}>{cat.icon} {cat.name}</span>
                          <span style={{
                            fontSize: "15px", fontWeight: 700,
                            color: cat.score >= 70 ? CC.green : cat.score >= 40 ? CC.yellow : CC.red,
                          }}>{cat.score}</span>
                        </div>
                        <div style={{
                          height: "4px", background: CC.border, borderRadius: "4px", overflow: "hidden",
                        }}>
                          <div style={{
                            height: "100%", borderRadius: "4px", transition: "width 0.6s ease",
                            width: `${cat.score}%`,
                            background: cat.score >= 70 ? CC.green : cat.score >= 40 ? CC.yellow : CC.red,
                          }} />
                        </div>
                        <div style={{ fontSize: "14px", color: CC.text3, marginTop: "4px" }}>{cat.detail}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 상세 시그널 목록 */}
                {diagData.signals.length > 0 && (
                  <div style={{
                    background: CC.card, border: `1px solid ${CC.border}`, borderRadius: "12px",
                    padding: "16px", marginBottom: "12px",
                    borderTop: "none", borderTopLeftRadius: "0", borderTopRightRadius: "0",
                  }}>
                    <div style={{ fontSize: "15px", fontWeight: 700, marginBottom: "10px" }}>{"\uD83D\uDCCB"} 감지된 시그널</div>
                    {diagData.signals.map((sig, i) => (
                      <div key={i} style={{
                        display: "flex", alignItems: "flex-start", gap: "10px",
                        padding: "8px 0", borderBottom: i < diagData.signals.length - 1 ? `1px solid ${CC.border}` : "none",
                      }}>
                        <span style={{
                          fontSize: "12px", fontWeight: 700, padding: "3px 7px", borderRadius: "6px",
                          flexShrink: 0, marginTop: "2px",
                          background: sig.type === "bullish" ? CC.greenBg : sig.type === "bearish" ? CC.redBg : CC.yellowBg,
                          color: sig.type === "bullish" ? CC.green : sig.type === "bearish" ? CC.red : CC.yellow,
                        }}>{sig.type === "bullish" ? "매수" : sig.type === "bearish" ? "매도" : "중립"}</span>
                        <div>
                          <div style={{ fontSize: "14px", fontWeight: 600, color: CC.text1 }}>{sig.name}</div>
                          <div style={{ fontSize: "14px", color: CC.text3, marginTop: "2px" }}>{sig.detail}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        <div style={{ height: "30px" }} />
      </div>

      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }
        @keyframes livePulse { 0%,100%{opacity:1} 50%{opacity:.4} }
      `}</style>
    </div>
  );
}
