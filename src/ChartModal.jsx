import { useEffect, useRef, useState, useCallback } from "react";
import { createChart, CrosshairMode, LineStyle } from "lightweight-charts";

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

function tsToTime(ts, tf) {
  if (isIntraday(tf)) {
    // Unix timestamp (seconds) for intraday
    return ts;
  }
  // Business day format for daily+
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
  "1d":  { label: "날봉",  interval: "1d",  range: "max" },  // 상장일부터 전체
  "1wk": { label: "주봉",  interval: "1wk", range: "max" },  // 상장일부터 전체
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
const CC_DARK = {
  bg: "#0A0E17", card: "#111927", card2: "#1A2332",
  border: "#1E2D3D", border2: "#283B50",
  blue: "#3182F6", green: "#05C072", red: "#F04452", yellow: "#FFB400",
  text1: "#F7F8FA", text2: "#B0BEC5", text3: "#6B7D8E",
  gridColor: "#1c2128", crossColor: "#3d4f63", labelBg: "#1f6feb", chartText: "#8b949e",
};
const CC_LIGHT = {
  bg: "#F5F6F8", card: "#FFFFFF", card2: "#F0F2F5",
  border: "#E0E3E8", border2: "#D0D4DB",
  blue: "#2563EB", green: "#16A34A", red: "#DC2626", yellow: "#D97706",
  text1: "#111827", text2: "#4B5563", text3: "#9CA3AF",
  gridColor: "#E5E7EB", crossColor: "#9CA3AF", labelBg: "#2563EB", chartText: "#6B7280",
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
      fixLeftEdge: true,
      fixRightEdge: true,
      rightOffset: 5,
    },
    height,
    width: width || 300,
    handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false, touch: true },
    handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: true, axisDoubleClickReset: true },
    kineticScroll: { mouse: true, touch: true },
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

// ── 투자진단 분석 엔진 ──────────────────────────────────────────
function runDiagnosis(candles) {
  if (!candles || candles.length < 20) return null;
  const closes = candles.map(c => c.close);
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  const volumes = candles.map(c => c.volume || 0);
  const n = closes.length;
  const last = closes[n - 1];
  const prev = closes[n - 2];

  // ── 지표 계산 ──
  const rsiArr = calcRSI(closes, 14);
  const rsi = rsiArr[n - 1];
  const sma20 = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const sma50 = n >= 50 ? closes.slice(-50).reduce((a, b) => a + b, 0) / 50 : null;
  const sma200 = n >= 200 ? closes.slice(-200).reduce((a, b) => a + b, 0) / 200 : null;
  const bbArr = calcBB(closes, 20, 2);
  const bb = bbArr[n - 1];
  const { macdLine, signalLine, histogram } = calcMACD(closes);
  const macdVal = macdLine[n - 1];
  const sigVal = signalLine[n - 1];
  const histVal = histogram[n - 1];
  const prevHist = histogram[n - 2];

  const avgVol = volumes.slice(-20).reduce((a, b) => a + b, 0) / Math.min(volumes.length, 20);
  const curVol = volumes[n - 1];
  const volRatio = avgVol > 0 ? curVol / avgVol : 1;

  const high52 = n >= 52 ? Math.max(...highs.slice(-260)) : Math.max(...highs);
  const low52 = n >= 52 ? Math.min(...lows.slice(-260)) : Math.min(...lows);
  const fromHigh = high52 > 0 ? ((last - high52) / high52) * 100 : 0;
  const fromLow = low52 > 0 ? ((last - low52) / low52) * 100 : 0;

  // 최근 5일 변화율
  const change5 = n >= 5 ? ((last - closes[n - 5]) / closes[n - 5]) * 100 : 0;
  // 최근 20일 변화율
  const change20 = n >= 20 ? ((last - closes[n - 20]) / closes[n - 20]) * 100 : 0;

  // ── 카테고리별 점수 ──
  const signals = [];

  // 1. 추세 점수 (0-100)
  let trendScore = 50;
  if (sma20 && last > sma20) trendScore += 10;
  if (sma20 && last < sma20) trendScore -= 10;
  if (sma50 && last > sma50) trendScore += 10;
  if (sma50 && last < sma50) trendScore -= 10;
  if (sma200 && last > sma200) trendScore += 10;
  if (sma200 && last < sma200) trendScore -= 10;
  if (sma50 && sma200 && sma50 > sma200) { trendScore += 10; signals.push({ type: "bullish", name: "골든크로스 구간", detail: "50일선이 200일선 위 — 장기 상승 추세" }); }
  if (sma50 && sma200 && sma50 < sma200) { trendScore -= 5; signals.push({ type: "bearish", name: "데스크로스 구간", detail: "50일선이 200일선 아래 — 장기 하락 추세" }); }
  if (change5 > 3) trendScore += 5;
  if (change5 < -3) trendScore -= 5;
  trendScore = Math.max(0, Math.min(100, trendScore));
  const trendDetail = last > (sma20 || last)
    ? `단기 상승세 (MA20 위 ${((last / sma20 - 1) * 100).toFixed(1)}%)`
    : `단기 하락세 (MA20 아래 ${((1 - last / (sma20 || last)) * 100).toFixed(1)}%)`;

  // 2. 모멘텀 점수
  let momScore = 50;
  if (rsi != null) {
    if (rsi >= 70) { momScore -= 15; signals.push({ type: "bearish", name: "RSI 과매수", detail: `RSI ${rsi.toFixed(1)} — 과열 구간, 단기 조정 가능` }); }
    else if (rsi <= 30) { momScore += 15; signals.push({ type: "bullish", name: "RSI 과매도", detail: `RSI ${rsi.toFixed(1)} — 반등 가능 구간` }); }
    else if (rsi > 50) momScore += 8;
    else momScore -= 5;
  }
  if (macdVal != null && sigVal != null) {
    if (macdVal > sigVal && prevHist != null && histVal > prevHist) { momScore += 12; signals.push({ type: "bullish", name: "MACD 상승 가속", detail: "MACD 히스토그램 확대 중 — 매수 모멘텀 증가" }); }
    if (macdVal < sigVal && prevHist != null && histVal < prevHist) { momScore -= 10; signals.push({ type: "bearish", name: "MACD 하락 가속", detail: "MACD 히스토그램 축소 중 — 매도 압력 증가" }); }
    if (macdVal > 0 && sigVal > 0) momScore += 5;
  }
  momScore = Math.max(0, Math.min(100, momScore));

  // 3. 변동성 점수
  let volScore = 60;
  if (bb) {
    const bw = bb.upper - bb.lower;
    const bbPercent = bb.middle > 0 ? (bw / bb.middle) * 100 : 0;
    if (bbPercent < 5) { volScore += 10; signals.push({ type: "neutral", name: "볼린저 스퀴즈", detail: `밴드폭 ${bbPercent.toFixed(1)}% — 큰 변동 임박 가능` }); }
    if (last >= bb.upper) { volScore -= 10; signals.push({ type: "bearish", name: "볼린저 상단 터치", detail: "상단 밴드 근접 — 단기 과열" }); }
    if (last <= bb.lower) { volScore += 10; signals.push({ type: "bullish", name: "볼린저 하단 터치", detail: "하단 밴드 근접 — 반등 가능" }); }
  }
  volScore = Math.max(0, Math.min(100, volScore));
  const volDetail = bb ? `BB 위치: ${((last - bb.lower) / (bb.upper - bb.lower) * 100).toFixed(0)}%` : "데이터 부족";

  // 4. 수급 점수
  let supScore = 50;
  if (volRatio >= 2) { supScore += 20; signals.push({ type: "bullish", name: "거래량 급증", detail: `평균 대비 ${volRatio.toFixed(1)}배 — 강한 수급 유입` }); }
  else if (volRatio >= 1.5) supScore += 10;
  else if (volRatio <= 0.3) { supScore -= 10; signals.push({ type: "neutral", name: "거래량 고갈", detail: `평균 대비 ${(volRatio * 100).toFixed(0)}% — 관심 저하` }); }
  // 가격 상승 + 거래량 증가 = 건전한 상승
  if (change5 > 0 && volRatio > 1.2) supScore += 10;
  if (change5 < 0 && volRatio > 1.5) supScore -= 10; // 하락 + 거래량 급증 = 투매
  supScore = Math.max(0, Math.min(100, supScore));
  const supDetail = `거래량 비율 ${volRatio.toFixed(1)}x (20일 평균 대비)`;

  // 5. 위치 점수 (52주 내 위치)
  let posScore = 50;
  const range52 = high52 - low52;
  const pos52 = range52 > 0 ? ((last - low52) / range52) * 100 : 50;
  if (pos52 <= 15) { posScore += 15; signals.push({ type: "bullish", name: "52주 저점 근접", detail: `52주 범위 하위 ${pos52.toFixed(0)}% — 저가 매수 기회` }); }
  if (pos52 >= 90) { posScore -= 5; signals.push({ type: "neutral", name: "52주 고점 근접", detail: `52주 범위 상위 ${pos52.toFixed(0)}% — 신중 접근` }); }
  if (fromHigh < -30) { posScore += 10; signals.push({ type: "bullish", name: "고점 대비 급락", detail: `고점 대비 ${fromHigh.toFixed(1)}% — 반등 여력 존재` }); }
  posScore = Math.max(0, Math.min(100, posScore));
  const posDetail = `52주 고점 대비 ${fromHigh.toFixed(1)}%`;

  // 종합 점수 (가중 평균)
  const totalScore = Math.round(
    trendScore * 0.30 + momScore * 0.25 + volScore * 0.15 + supScore * 0.15 + posScore * 0.15
  );

  let verdict, summary;
  if (totalScore >= 75) { verdict = "적극 매수"; summary = "다수의 기술적 지표가 강한 매수 신호를 보이고 있습니다. 추세, 모멘텀, 수급이 모두 긍정적입니다."; }
  else if (totalScore >= 60) { verdict = "매수 우위"; summary = "전반적으로 긍정적 신호가 우세합니다. 기술적 분석상 매수 관점이 유리합니다."; }
  else if (totalScore >= 45) { verdict = "중립 (관망)"; summary = "매수와 매도 신호가 혼재합니다. 추가 확인 후 진입을 권장합니다."; }
  else if (totalScore >= 30) { verdict = "매도 우위"; summary = "하락 신호가 다수 감지됩니다. 포지션 축소 또는 손절을 고려하세요."; }
  else { verdict = "적극 매도"; summary = "강한 하락 신호가 감지됩니다. 빠른 대응이 필요할 수 있습니다."; }

  // ── 적정가치 추정 (기술적 분석 기반) ──
  let fairValue = null;
  let fairValueMethod = "";
  if (n >= 50) {
    // Method: Weighted average of key support/resistance levels
    const sma50Val = sma50 || sma20;
    const sma200Val = sma200 || sma50Val;
    const bbMid = bb ? bb.middle : sma20;

    // Fair value = weighted blend of MA levels & BB midline
    fairValue = (sma20 * 0.25 + sma50Val * 0.30 + sma200Val * 0.25 + bbMid * 0.20);
    fairValueMethod = "이동평균 & 볼린저밴드 기반";

    // Adjust: if strong trend, weight recent price more
    if (trendScore >= 70) {
      fairValue = fairValue * 0.7 + last * 0.3;
      fairValueMethod += " (상승 추세 반영)";
    } else if (trendScore <= 30) {
      fairValue = fairValue * 0.7 + last * 0.3;
      fairValueMethod += " (하락 추세 반영)";
    }

    const premium = ((last - fairValue) / fairValue) * 100;
    if (premium > 15) signals.push({ type: "bearish", name: "적정가치 대비 고평가", detail: `현재가가 적정가치 대비 ${premium.toFixed(1)}% 높음` });
    else if (premium < -15) signals.push({ type: "bullish", name: "적정가치 대비 저평가", detail: `현재가가 적정가치 대비 ${Math.abs(premium).toFixed(1)}% 낮음` });
  }

  return {
    score: totalScore,
    verdict,
    summary,
    categories: [
      { name: "추세", icon: "\uD83D\uDCC8", score: trendScore, detail: trendDetail },
      { name: "모멘텀", icon: "\u26A1", score: momScore, detail: `RSI ${rsi != null ? rsi.toFixed(1) : "N/A"}` },
      { name: "변동성", icon: "\uD83C\uDF0A", score: volScore, detail: volDetail },
      { name: "수급", icon: "\uD83D\uDCCA", score: supScore, detail: supDetail },
      { name: "가격위치", icon: "\uD83C\uDFAF", score: posScore, detail: posDetail },
      { name: "단기추세", icon: "\uD83D\uDD25", score: Math.round(Math.max(0, Math.min(100, 50 + change5 * 5))), detail: `5일 변화 ${change5.toFixed(2)}%` },
    ],
    signals,
    fairValue,
    fairValueMethod,
    currentPrice: last,
    rsi, macdVal, volRatio, pos52, fromHigh, change5, change20,
  };
}

// ── Full-page chart component ────────────────────────────────────
export default function ChartModal({ asset, onClose, krwRate, theme = "dark" }) {
  const CC = theme === "dark" ? CC_DARK : CC_LIGHT;
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
        const r = await fetch(`/api/coingecko-ohlc?id=${encodeURIComponent(coinId)}&days=${days}`);
        if (!r.ok) throw new Error(`CoinGecko ${r.status}`);
        const j = await r.json();
        candles = (j.candles || []).map(c => ({ ...c, time: tsToTime(c.time, tf) }));
      } else {
        const cfg = TF_CONFIG[tf] || TF_CONFIG["1d"];
        const sym = asset.symbolRaw || asset.symbol;
        const r = await fetch(`/api/yahoo-ohlc?symbol=${encodeURIComponent(sym)}&interval=${cfg.interval}&range=${cfg.range}&_t=${Date.now()}`);
        if (!r.ok) throw new Error(`Yahoo ${r.status}`);
        const j = await r.json();
        candles = (j.candles || []).map(c => ({ ...c, time: tsToTime(c.time, tf) }));
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
      rsiChart.timeScale().fitContent();
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
      macdChart.timeScale().fitContent();
    }

    mainChart.timeScale().fitContent();

    requestAnimationFrame(() => {
      const w = containerRef.current?.clientWidth;
      if (w) {
        Object.values(chartObjs.current).forEach(c => {
          try { c.applyOptions({ width: w }); c.timeScale().fitContent(); } catch {}
        });
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
    }}>
      {/* Top bar */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "12px 16px", borderBottom: `1px solid ${CC.border}`,
        background: `${CC.bg}f5`, backdropFilter: "blur(8px)", flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <button onClick={onClose} style={{
            background: CC.card, border: `1px solid ${CC.border}`, color: CC.text2, cursor: "pointer",
            fontSize: "14px", padding: "8px 14px", borderRadius: "10px", fontWeight: 600,
            display: "flex", alignItems: "center", gap: "6px",
          }}>← 뒤로</button>
          <span style={{ fontSize: "18px" }}>
            {asset.market === "us" ? "\uD83C\uDDFA\uD83C\uDDF8" : asset.market === "kr" ? "\uD83C\uDDF0\uD83C\uDDF7" : "\u20BF"}
          </span>
          <div>
            <div style={{ color: CC.text1, fontWeight: 700, fontSize: "16px" }}>{asset.name}</div>
            <div style={{ color: CC.text3, fontSize: "11px" }}>{asset.symbol}</div>
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", justifyContent: "flex-end" }}>
            {liveConnected && (
              <span style={{
                display: "inline-flex", alignItems: "center", gap: "4px",
                fontSize: "9px", fontWeight: 700, color: CC.green,
                background: CC.greenBg, padding: "2px 6px", borderRadius: "4px",
                animation: "livePulse 1.5s ease-in-out infinite",
              }}>
                <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: CC.green, display: "inline-block" }} />
                LIVE
              </span>
            )}
            <span style={{ color: CC.text1, fontWeight: 700, fontSize: "18px" }}>
              {livePrice != null
                ? (showKRW && canShowKRW
                    ? `₩${Math.round(livePrice).toLocaleString("ko-KR")}`
                    : fmtPrice(livePrice, asset.market))
                : formatPriceWithKRW(asset.price)}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", justifyContent: "flex-end" }}>
            {liveChange != null ? (
              <span style={{ fontSize: "13px", fontWeight: 600, color: liveChange >= 0 ? CC.green : CC.red }}>
                {liveChange >= 0 ? "\u25B2" : "\u25BC"} {Math.abs(liveChange).toFixed(2)}%
              </span>
            ) : asset.weekChange != null ? (
              <span style={{ fontSize: "13px", fontWeight: 600, color: asset.weekChange >= 0 ? CC.green : CC.red }}>
                {asset.weekChange >= 0 ? "\u25B2" : "\u25BC"} {Math.abs(asset.weekChange)}%
              </span>
            ) : null}
            {canShowKRW && (
              <button onClick={() => setShowKRW(!showKRW)} style={{
                fontSize: "10px", padding: "3px 8px", borderRadius: "6px", cursor: "pointer",
                background: showKRW ? CC.blue + "33" : "transparent",
                color: showKRW ? CC.blue : CC.text3,
                border: `1px solid ${showKRW ? CC.blue : CC.border}`,
              }}>
                {showKRW ? "\u20A9 KRW" : "$ USD"}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Scrollable body */}
      <div ref={containerRef} style={{ flex: 1, overflowY: "auto", overflowX: "hidden", padding: "12px 16px" }}>

        {/* OHLC crosshair info */}
        {ohlcInfo && (
          <div style={{
            display: "flex", gap: "12px", marginBottom: "8px",
            background: CC.card, borderRadius: "10px", padding: "8px 12px",
            fontSize: "12px", flexWrap: "wrap", border: `1px solid ${CC.border}`,
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
        <div style={{ display: "flex", gap: "4px", marginBottom: "8px", flexWrap: "wrap" }}>
          {tfOrder.map(key => {
            const cfg = tfLabels[key];
            if (!cfg) return null;
            return (
              <button key={key} onClick={() => setTimeframe(key)} style={{
                padding: "5px 10px", borderRadius: "8px", fontSize: "12px", cursor: "pointer", fontWeight: 600,
                background: timeframe === key ? CC.blue : CC.card,
                color: timeframe === key ? "#fff" : CC.text3,
                border: `1px solid ${timeframe === key ? CC.blue : CC.border}`,
              }}>{cfg.label}</button>
            );
          })}
        </div>

        {/* Log scale toggle button */}
        <div style={{ display: "flex", gap: "4px", marginBottom: "8px", flexWrap: "wrap" }}>
          <button onClick={() => setLogScale(p => !p)} style={{
            padding: "5px 10px", borderRadius: "8px", fontSize: "12px", cursor: "pointer", fontWeight: 600,
            background: logScale ? `${CC.yellow}22` : CC.card,
            color: logScale ? CC.yellow : CC.text3,
            border: `1px solid ${logScale ? CC.yellow : CC.border}`,
            marginLeft: "4px",
          }}>📐 로그</button>
        </div>

        {/* Indicator quick toggles + settings gear */}
        <div style={{ display: "flex", gap: "5px", marginBottom: showSettings ? "0px" : "12px", flexWrap: "wrap", alignItems: "center" }}>
          {(settings.maList || []).map((ma, idx) => (
            <button key={`ma-${idx}`} onClick={() => {
              const newList = [...settings.maList];
              newList[idx] = { ...newList[idx], enabled: !newList[idx].enabled };
              updateSettings({ ...settings, maList: newList });
            }} style={{
              padding: "4px 9px", borderRadius: "8px", fontSize: "11px", cursor: "pointer", fontWeight: 600,
              background: ma.enabled ? `${ma.color}22` : "transparent",
              color: ma.enabled ? ma.color : CC.text3,
              border: `1px solid ${ma.enabled ? `${ma.color}88` : CC.border}`,
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
              padding: "4px 9px", borderRadius: "8px", fontSize: "11px", cursor: "pointer", fontWeight: 600,
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
            padding: "4px 9px", borderRadius: "8px", fontSize: "14px", cursor: "pointer",
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
            <div style={{ fontSize: "13px", fontWeight: 700, color: CC.text1, marginBottom: "12px" }}>
              {"\u2699\uFE0F"} 보조지표 설정
            </div>

            {/* MA settings */}
            <div style={{ marginBottom: "12px" }}>
              <div style={{ fontSize: "11px", color: CC.text3, marginBottom: "6px", fontWeight: 600 }}>이동평균선 (MA)</div>
              {(settings.maList || []).map((ma, idx) => (
                <div key={idx} style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                  <input type="checkbox" checked={ma.enabled} onChange={() => {
                    const newList = [...settings.maList];
                    newList[idx] = { ...newList[idx], enabled: !newList[idx].enabled };
                    updateSettings({ ...settings, maList: newList });
                  }} style={{ accentColor: ma.color }} />
                  <span style={{ fontSize: "11px", color: CC.text2, width: "28px" }}>MA</span>
                  <input type="number" value={ma.period} min={1} max={500} onChange={e => {
                    const newList = [...settings.maList];
                    newList[idx] = { ...newList[idx], period: parseInt(e.target.value) || 5 };
                    updateSettings({ ...settings, maList: newList });
                  }} style={{
                    width: "60px", padding: "4px 6px", borderRadius: "6px", fontSize: "12px",
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
                    background: "transparent", border: "none", color: CC.red, cursor: "pointer", fontSize: "14px", padding: "2px",
                  }}>{"\u2715"}</button>
                </div>
              ))}
              <button onClick={() => {
                const colors = ["#facc15","#38bdf8","#f97316","#a855f7","#34d399","#f472b6","#fb923c","#60a5fa"];
                const c = colors[(settings.maList || []).length % colors.length];
                updateSettings({ ...settings, maList: [...(settings.maList || []), { enabled: true, period: 10, color: c, width: 2 }] });
              }} style={{
                fontSize: "11px", padding: "4px 10px", borderRadius: "6px", cursor: "pointer",
                background: CC.card2, color: CC.blue, border: `1px solid ${CC.border2}`, fontWeight: 600,
              }}>+ MA 추가</button>
            </div>

            {/* BB settings */}
            <div style={{ display: "flex", gap: "12px", alignItems: "center", marginBottom: "10px", flexWrap: "wrap" }}>
              <span style={{ fontSize: "11px", color: CC.text2, fontWeight: 600 }}>BB</span>
              <label style={{ fontSize: "11px", color: CC.text3 }}>기간
                <input type="number" value={settings.bb?.period || 20} min={5} max={100} onChange={e => {
                  updateSettings({ ...settings, bb: { ...settings.bb, period: parseInt(e.target.value) || 20 } });
                }} style={{
                  width: "50px", padding: "3px 5px", borderRadius: "5px", fontSize: "11px", marginLeft: "4px",
                  background: CC.card2, color: CC.text1, border: `1px solid ${CC.border2}`, outline: "none",
                }} />
              </label>
              <label style={{ fontSize: "11px", color: CC.text3 }}>배수
                <input type="number" value={settings.bb?.mult || 2} min={0.5} max={5} step={0.5} onChange={e => {
                  updateSettings({ ...settings, bb: { ...settings.bb, mult: parseFloat(e.target.value) || 2 } });
                }} style={{
                  width: "50px", padding: "3px 5px", borderRadius: "5px", fontSize: "11px", marginLeft: "4px",
                  background: CC.card2, color: CC.text1, border: `1px solid ${CC.border2}`, outline: "none",
                }} />
              </label>
            </div>

            {/* RSI settings */}
            <div style={{ display: "flex", gap: "12px", alignItems: "center", marginBottom: "10px" }}>
              <span style={{ fontSize: "11px", color: CC.text2, fontWeight: 600 }}>RSI</span>
              <label style={{ fontSize: "11px", color: CC.text3 }}>기간
                <input type="number" value={settings.rsi?.period || 14} min={2} max={50} onChange={e => {
                  updateSettings({ ...settings, rsi: { ...settings.rsi, period: parseInt(e.target.value) || 14 } });
                }} style={{
                  width: "50px", padding: "3px 5px", borderRadius: "5px", fontSize: "11px", marginLeft: "4px",
                  background: CC.card2, color: CC.text1, border: `1px solid ${CC.border2}`, outline: "none",
                }} />
              </label>
            </div>

            {/* Reset button */}
            <button onClick={() => updateSettings(DEFAULT_SETTINGS)} style={{
              fontSize: "11px", padding: "5px 12px", borderRadius: "6px", cursor: "pointer",
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
              padding: "9px 20px", borderRadius: "10px", fontSize: "13px", fontWeight: 700,
              background: CC.blue, color: "#fff", border: "none", cursor: "pointer",
            }}>\uB2E4\uC2DC \uC2DC\uB3C4</button>
          </div>
        )}
        <div style={{ display: loading ? "none" : "block" }}>
          <div ref={mainRef} style={{
            width: "100%", borderRadius: "10px", overflow: "hidden",
            touchAction: "none", WebkitOverflowScrolling: "auto",
          }} />
          {settings.rsi?.enabled && (
            <>
              <div style={{
                color: "#f472b6", fontSize: "11px", fontWeight: 600, padding: "8px 0 4px 4px",
                display: "flex", alignItems: "center", gap: "6px", justifyContent: "space-between",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <span style={{ width: "10px", height: "3px", background: "#f472b6", borderRadius: "2px", display: "inline-block" }} />
                  RSI({settings.rsi?.period || 14})
                </div>
                {currentRSI != null && (
                  <span style={{
                    fontSize: "13px", fontWeight: 700, padding: "2px 8px", borderRadius: "6px",
                    background: currentRSI >= 70 ? `${CC.red}22` : currentRSI <= 30 ? `${CC.green}22` : `${CC.text3}22`,
                    color: currentRSI >= 70 ? CC.red : currentRSI <= 30 ? CC.green : CC.text2,
                  }}>{currentRSI.toFixed(1)}</span>
                )}
              </div>
              <div ref={rsiRef} style={{ width: "100%", borderRadius: "10px", overflow: "hidden", touchAction: "none" }} />
            </>
          )}
          {settings.macd?.enabled && (
            <>
              <div style={{
                fontSize: "11px", fontWeight: 600, padding: "8px 0 4px 4px",
                display: "flex", alignItems: "center", gap: "10px", color: CC.text3,
              }}>
                <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                  <span style={{ width: "10px", height: "3px", background: "#38bdf8", borderRadius: "2px", display: "inline-block" }} />
                  <span style={{ color: "#38bdf8" }}>MACD</span>
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                  <span style={{ width: "10px", height: "3px", background: "#fb923c", borderRadius: "2px", display: "inline-block" }} />
                  <span style={{ color: "#fb923c" }}>Signal</span>
                </span>
              </div>
              <div ref={macdRef} style={{ width: "100%", borderRadius: "10px", overflow: "hidden", touchAction: "none" }} />
            </>
          )}
        </div>

        {/* Legend */}
        <div style={{
          marginTop: "12px", padding: "10px 12px",
          background: CC.card, borderRadius: "10px", border: `1px solid ${CC.border}`,
          display: "flex", gap: "12px", flexWrap: "wrap", fontSize: "11px",
        }}>
          {[
            ...(settings.maList || []).filter(m => m.enabled).map(m => ({ color: m.color, label: `MA${m.period}` })),
            ...(settings.bb?.enabled ? [{ color: "#60a5fa", label: `BB(${settings.bb?.period || 20},${settings.bb?.mult || 2})` }] : []),
            ...(settings.rsi?.enabled ? [{ color: "#f472b6", label: `RSI(${settings.rsi?.period || 14})` }] : []),
            ...(settings.macd?.enabled ? [{ color: "#38bdf8", label: "MACD" }, { color: "#fb923c", label: "Signal" }] : []),
          ].map(({ color, label }) => (
            <span key={label} style={{ display: "flex", alignItems: "center", gap: "5px", color: CC.text3 }}>
              <span style={{ width: "16px", height: "3px", background: color, display: "inline-block", borderRadius: "2px" }} />
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
              background: CC.card, border: `1px solid ${CC.border}`, borderRadius: "14px",
              padding: "14px 18px", cursor: "pointer", marginBottom: showDiagnosis ? "12px" : "0",
              transition: "all 0.2s",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <span style={{ fontSize: "18px" }}>🩺</span>
                <span style={{ fontSize: "14px", fontWeight: 700, color: CC.text1 }}>투자진단</span>
                <span style={{
                  fontSize: "12px", fontWeight: 700, padding: "3px 8px", borderRadius: "6px",
                  background: diagData.score >= 70 ? CC.greenBg : diagData.score >= 40 ? CC.yellowBg : CC.redBg,
                  color: diagData.score >= 70 ? CC.green : diagData.score >= 40 ? CC.yellow : CC.red,
                }}>{diagData.score}점 · {diagData.verdict}</span>
              </div>
              <span style={{
                fontSize: "14px", color: CC.text3,
                transform: showDiagnosis ? "rotate(180deg)" : "rotate(0deg)",
                transition: "transform 0.2s",
              }}>▼</span>
            </button>

            {showDiagnosis && (
              <>
                {/* 종합 점수 */}
                <div style={{
                  background: CC.card, border: `1px solid ${CC.border}`, borderRadius: "14px",
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
                        fontSize: "16px", fontWeight: 800, marginBottom: "4px",
                        color: diagData.score >= 70 ? CC.green : diagData.score >= 40 ? CC.yellow : CC.red,
                      }}>{diagData.verdict}</div>
                      <div style={{ fontSize: "12px", color: CC.text2, lineHeight: "1.5" }}>{diagData.summary}</div>
                    </div>
                  </div>

                  {/* Fair value section */}
                  {diagData.fairValue != null && (
                    <div style={{
                      background: CC.bg, borderRadius: "10px", padding: "12px", marginBottom: "12px",
                      border: `1px solid ${CC.border}`,
                    }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                        <span style={{ fontSize: "12px", color: CC.text3, fontWeight: 600 }}>💰 적정가치 추정</span>
                        <span style={{ fontSize: "9px", color: CC.text3, background: CC.card2, padding: "2px 6px", borderRadius: "4px" }}>{diagData.fairValueMethod}</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
                        <div>
                          <div style={{ fontSize: "11px", color: CC.text3 }}>적정가치</div>
                          <div style={{ fontSize: "18px", fontWeight: 700, color: CC.text1 }}>{formatPrice(diagData.fairValue)}</div>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <div style={{ fontSize: "11px", color: CC.text3 }}>현재가 vs 적정가</div>
                          {(() => {
                            const premium = diagData.currentPrice && diagData.fairValue
                              ? ((diagData.currentPrice - diagData.fairValue) / diagData.fairValue) * 100
                              : 0;
                            const isOver = premium > 0;
                            return (
                              <div style={{
                                fontSize: "16px", fontWeight: 700,
                                color: Math.abs(premium) < 5 ? CC.yellow : isOver ? CC.red : CC.green,
                              }}>
                                {isOver ? "+" : ""}{premium.toFixed(1)}%
                                <span style={{ fontSize: "11px", marginLeft: "4px", fontWeight: 500 }}>
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
                          <span style={{ fontSize: "11px", color: CC.text3, fontWeight: 600 }}>{cat.icon} {cat.name}</span>
                          <span style={{
                            fontSize: "13px", fontWeight: 700,
                            color: cat.score >= 70 ? CC.green : cat.score >= 40 ? CC.yellow : CC.red,
                          }}>{cat.score}</span>
                        </div>
                        <div style={{
                          height: "4px", background: CC.border, borderRadius: "2px", overflow: "hidden",
                        }}>
                          <div style={{
                            height: "100%", borderRadius: "2px", transition: "width 0.6s ease",
                            width: `${cat.score}%`,
                            background: cat.score >= 70 ? CC.green : cat.score >= 40 ? CC.yellow : CC.red,
                          }} />
                        </div>
                        <div style={{ fontSize: "10px", color: CC.text3, marginTop: "4px" }}>{cat.detail}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 상세 시그널 목록 */}
                {diagData.signals.length > 0 && (
                  <div style={{
                    background: CC.card, border: `1px solid ${CC.border}`, borderRadius: "14px",
                    padding: "16px", marginBottom: "12px",
                    borderTop: "none", borderTopLeftRadius: "0", borderTopRightRadius: "0",
                  }}>
                    <div style={{ fontSize: "13px", fontWeight: 700, marginBottom: "10px" }}>{"\uD83D\uDCCB"} 감지된 시그널</div>
                    {diagData.signals.map((sig, i) => (
                      <div key={i} style={{
                        display: "flex", alignItems: "flex-start", gap: "10px",
                        padding: "8px 0", borderBottom: i < diagData.signals.length - 1 ? `1px solid ${CC.border}` : "none",
                      }}>
                        <span style={{
                          fontSize: "9px", fontWeight: 700, padding: "3px 7px", borderRadius: "5px",
                          flexShrink: 0, marginTop: "2px",
                          background: sig.type === "bullish" ? CC.greenBg : sig.type === "bearish" ? CC.redBg : CC.yellowBg,
                          color: sig.type === "bullish" ? CC.green : sig.type === "bearish" ? CC.red : CC.yellow,
                        }}>{sig.type === "bullish" ? "매수" : sig.type === "bearish" ? "매도" : "중립"}</span>
                        <div>
                          <div style={{ fontSize: "12px", fontWeight: 600, color: CC.text1 }}>{sig.name}</div>
                          <div style={{ fontSize: "11px", color: CC.text3, marginTop: "2px" }}>{sig.detail}</div>
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
