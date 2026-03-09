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
  "1h":  { label: "1시간", interval: "1h",  range: "1mo" },
  "2h":  { label: "2시간", interval: "1h",  range: "1mo" },  // Aggregate from 1h
  "4h":  { label: "4시간", interval: "1h",  range: "3mo" },  // Aggregate from 1h
  "1d":  { label: "날봉",  interval: "1d",  range: "6mo" },
  "1wk": { label: "주봉",  interval: "1wk", range: "2y" },
  "1mo": { label: "월봉",  interval: "1mo", range: "10y" },
};

const CRYPTO_TF = {
  "1m":  { label: "1분",   days: "1" },
  "5m":  { label: "5분",   days: "1" },
  "10m": { label: "10분",  days: "1" },
  "30m": { label: "30분",  days: "7" },
  "1h":  { label: "1시간", days: "7" },
  "2h":  { label: "2시간", days: "14" },
  "4h":  { label: "4시간", days: "30" },
  "1d":  { label: "날봉",  days: "90" },
  "1wk": { label: "주봉",  days: "365" },
  "1mo": { label: "월봉",  days: "max" },
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

// Chart options
function makeChartOptions(height, width, tf) {
  const intra = isIntraday(tf);
  return {
    layout: {
      background: { color: "#0A0E17" },
      textColor: "#8b949e",
      fontFamily: "'Pretendard', 'Apple SD Gothic Neo', system-ui, sans-serif",
    },
    grid: {
      vertLines: { color: "#1c2128" },
      horzLines: { color: "#1c2128" },
    },
    crosshair: {
      mode: CrosshairMode.Normal,
      vertLine: { color: "#3d4f63", labelBackgroundColor: "#1f6feb" },
      horzLine: { color: "#3d4f63", labelBackgroundColor: "#1f6feb" },
    },
    rightPriceScale: {
      borderColor: "#1c2128",
      scaleMargins: { top: 0.08, bottom: 0.05 },
      minimumWidth: 100,
      entireTextOnly: true,
    },
    timeScale: {
      borderColor: "#1c2128",
      timeVisible: intra,
      secondsVisible: false,
      fixLeftEdge: true,
      fixRightEdge: true,
      rightOffset: 5,
    },
    height,
    width: width || 300,
    handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
    handleScale: { mouseWheel: true, pinch: true },
  };
}

// ── colors (matching App.jsx palette)
const CC = {
  bg: "#0A0E17", card: "#111927", card2: "#1A2332",
  border: "#1E2D3D", border2: "#283B50",
  blue: "#3182F6", green: "#05C072", red: "#F04452", yellow: "#FFB400",
  text1: "#F7F8FA", text2: "#B0BEC5", text3: "#6B7D8E",
};

// ── Price formatting with commas ──
function fmtPrice(p, market) {
  if (!p && p !== 0) return "—";
  if (market === "kr") return `₩${Math.round(p).toLocaleString("ko-KR")}`;
  if (p < 0.01) return `$${p.toFixed(6)}`;
  if (p < 1) return `$${p.toFixed(4)}`;
  return `$${p.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ── Full-page chart component ────────────────────────────────────
export default function ChartModal({ asset, onClose, krwRate }) {
  const containerRef = useRef(null);
  const mainRef   = useRef(null);
  const rsiRef    = useRef(null);
  const macdRef   = useRef(null);
  const chartObjs = useRef({});

  const [timeframe, setTimeframe] = useState("1d");
  const [indicators, setIndicators] = useState({
    ma5: false, ma20: true, ma60: true, ma200: true, bb: true, vol: true, rsi: true, macd: true,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);
  const [ohlcInfo, setOhlcInfo] = useState(null);
  const [showKRW, setShowKRW] = useState(false);

  const isCrypto = asset?.market === "crypto";
  const isUS = asset?.market === "us";
  const toggleIndicator = (key) => setIndicators(prev => ({ ...prev, [key]: !prev[key] }));

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
      return candles;
    } catch (e) {
      setError(e.message);
      return null;
    } finally {
      setLoading(false);
    }
  }, [asset, isCrypto]);

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

    const showRSI  = indicators.rsi;
    const showMACD = indicators.macd;
    const mainH  = showRSI || showMACD ? 360 : 520;
    const subH   = 130;

    const containerW = containerRef.current?.clientWidth || 600;

    // ── Main chart ───
    const mainChart = createChart(mainRef.current, makeChartOptions(mainH, containerW, tf));
    chartObjs.current.main = mainChart;

    const candleSeries = mainChart.addCandlestickSeries({
      upColor: "#26a64b", downColor: "#ef4444",
      borderUpColor: "#26a64b", borderDownColor: "#ef4444",
      wickUpColor: "#26a64b", wickDownColor: "#ef4444",
    });
    candleSeries.setData(candles.map(c => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close })));

    // Volume histogram
    if (indicators.vol) {
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

    // MA lines — lastValueVisible: false to prevent label overlap!
    const maConfig = [
      { key: "ma5",  period: 5,   color: "#facc15", width: 1.5 },
      { key: "ma20", period: 20,  color: "#38bdf8", width: 2 },
      { key: "ma60", period: 60,  color: "#f97316", width: 2 },
      { key: "ma200",period: 200, color: "#a855f7", width: 2.5 },
    ];
    maConfig.forEach(({ key, period, color, width }) => {
      if (!indicators[key]) return;
      const sma = calcSMA(closes, period);
      const maSeries = mainChart.addLineSeries({
        color, lineWidth: width,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      maSeries.setData(sma.map((v, i) => v != null ? { time: times[i], value: v } : null).filter(Boolean));
    });

    // Bollinger Bands — lastValueVisible: false
    if (indicators.bb) {
      const bbs = calcBB(closes);
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
      const rsiChart = createChart(rsiRef.current, makeChartOptions(subH, containerW, tf));
      chartObjs.current.rsi = rsiChart;
      const rsi = calcRSI(closes);
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
      const macdChart = createChart(macdRef.current, makeChartOptions(subH, containerW, tf));
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
  }, [fetchData, indicators]);

  useEffect(() => {
    if (!asset) return;
    const timer = setTimeout(() => buildCharts(timeframe), 80);
    return () => {
      clearTimeout(timer);
      Object.values(chartObjs.current).forEach(c => { try { c.remove(); } catch {} });
    };
  }, [asset, timeframe, indicators]);

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

  // Prevent body scrolling when chart page is open
  useEffect(() => {
    document.body.style.overflow = "hidden";
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
          <div style={{ color: CC.text1, fontWeight: 700, fontSize: "18px" }}>{formatPriceWithKRW(asset.price)}</div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", justifyContent: "flex-end" }}>
            {asset.weekChange != null && (
              <span style={{ fontSize: "13px", fontWeight: 600, color: asset.weekChange >= 0 ? CC.green : CC.red }}>
                {asset.weekChange >= 0 ? "\u25B2" : "\u25BC"} {Math.abs(asset.weekChange)}%
              </span>
            )}
            {isUS && krwRate && (
              <button onClick={() => setShowKRW(!showKRW)} style={{
                fontSize: "10px", padding: "3px 8px", borderRadius: "6px", cursor: "pointer",
                background: showKRW ? CC.blue + "33" : "transparent",
                color: showKRW ? CC.blue : CC.text3,
                border: `1px solid ${showKRW ? CC.blue : CC.border}`,
              }}>
                {showKRW ? "KRW" : "USD"}
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

        {/* Indicator toggles */}
        <div style={{ display: "flex", gap: "5px", marginBottom: "12px", flexWrap: "wrap" }}>
          {[
            { key: "ma5",  label: "MA5",   color: "#facc15" },
            { key: "ma20", label: "MA20",  color: "#38bdf8" },
            { key: "ma60", label: "MA60",  color: "#f97316" },
            { key: "ma200",label: "MA200", color: "#a855f7" },
            { key: "bb",   label: "BB",    color: "#60a5fa" },
            { key: "vol",  label: "\uAC70\uB798\uB7C9", color: "#1f6feb" },
            { key: "rsi",  label: "RSI",   color: "#f472b6" },
            { key: "macd", label: "MACD",  color: "#34d399" },
          ].map(({ key, label, color }) => (
            <button key={key} onClick={() => toggleIndicator(key)} style={{
              padding: "4px 9px", borderRadius: "8px", fontSize: "11px", cursor: "pointer", fontWeight: 600,
              background: indicators[key] ? `${color}22` : "transparent",
              color: indicators[key] ? color : CC.text3,
              border: `1px solid ${indicators[key] ? `${color}88` : CC.border}`,
            }}>
              <span style={{ display: "inline-block", width: "7px", height: "7px", borderRadius: "50%", background: indicators[key] ? color : CC.text3, marginRight: "4px", verticalAlign: "middle" }} />
              {label}
            </button>
          ))}
        </div>

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
          <div ref={mainRef} style={{ width: "100%", borderRadius: "10px", overflow: "hidden" }} />
          {indicators.rsi && (
            <>
              <div style={{
                color: "#f472b6", fontSize: "11px", fontWeight: 600, padding: "8px 0 4px 4px",
                display: "flex", alignItems: "center", gap: "6px",
              }}>
                <span style={{ width: "10px", height: "3px", background: "#f472b6", borderRadius: "2px", display: "inline-block" }} />
                RSI(14)
              </div>
              <div ref={rsiRef} style={{ width: "100%", borderRadius: "10px", overflow: "hidden" }} />
            </>
          )}
          {indicators.macd && (
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
              <div ref={macdRef} style={{ width: "100%", borderRadius: "10px", overflow: "hidden" }} />
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
            { color: "#facc15", label: "MA5", active: indicators.ma5 },
            { color: "#38bdf8", label: "MA20", active: indicators.ma20 },
            { color: "#f97316", label: "MA60", active: indicators.ma60 },
            { color: "#a855f7", label: "MA200", active: indicators.ma200 },
            { color: "#60a5fa", label: "\uBCFC\uB9B0\uC800\uBC34\uB4DC", active: indicators.bb },
            { color: "#f472b6", label: "RSI(14)", active: indicators.rsi },
            { color: "#38bdf8", label: "MACD", active: indicators.macd },
            { color: "#fb923c", label: "Signal", active: indicators.macd },
          ].filter(l => l.active).map(({ color, label }) => (
            <span key={label} style={{ display: "flex", alignItems: "center", gap: "5px", color: CC.text3 }}>
              <span style={{ width: "16px", height: "3px", background: color, display: "inline-block", borderRadius: "2px" }} />
              {label}
            </span>
          ))}
        </div>

        <div style={{ height: "20px" }} />
      </div>

      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }`}</style>
    </div>
  );
}
