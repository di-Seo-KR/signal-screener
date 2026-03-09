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

// ── 타임프레임 설정 ──────────────────────────────────────────────
const TF_CONFIG = {
  "5m":  { label: "5분",  interval: "5m",   range: "5d",   isCrypto: false },
  "1h":  { label: "1시간", interval: "1h",  range: "1mo",  isCrypto: false },
  "1d":  { label: "일봉",  interval: "1d",   range: "6mo",  isCrypto: false },
  "1wk": { label: "주봉",  interval: "1wk",  range: "2y",   isCrypto: false },
  "1mo": { label: "월봉",  interval: "1mo",  range: "5y",   isCrypto: false },
};

const CRYPTO_TF = {
  "5m":  { label: "5분",  days: "1"   },
  "1h":  { label: "1시간", days: "7"  },
  "1d":  { label: "일봉",  days: "90" },
  "1wk": { label: "주봉",  days: "365"},
  "1mo": { label: "월봉",  days: "max"},
};

// ── Chart Theme ───────────────────────────────────────────────────
const chartOptions = (height) => ({
  layout: {
    background: { color: "#0d1117" },
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
    scaleMargins: { top: 0.1, bottom: 0.05 },
  },
  timeScale: {
    borderColor: "#1c2128",
    timeVisible: true,
    secondsVisible: false,
  },
  height,
  width: undefined,
  handleScroll: true,
  handleScale: true,
});

// ── Main Component ───────────────────────────────────────────────
export default function ChartModal({ asset, onClose }) {
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
  const [ohlcInfo, setOhlcInfo] = useState(null); // crosshair price info

  const isCrypto = asset?.market === "crypto";

  const toggleIndicator = (key) => setIndicators(prev => ({ ...prev, [key]: !prev[key] }));

  // ── fetch OHLC data ─────────────────────────────────────────────
  const fetchData = useCallback(async (tf) => {
    setLoading(true);
    setError(null);
    try {
      let candles;
      if (isCrypto) {
        const { days } = CRYPTO_TF[tf] || CRYPTO_TF["1d"];
        const r = await fetch(`/api/coingecko-ohlc?id=${encodeURIComponent(asset.cryptoId)}&days=${days}`);
        if (!r.ok) throw new Error(`CoinGecko ${r.status}`);
        const j = await r.json();
        candles = j.candles || [];
      } else {
        const { interval, range } = TF_CONFIG[tf] || TF_CONFIG["1d"];
        const r = await fetch(`/api/yahoo-ohlc?symbol=${encodeURIComponent(asset.symbolRaw || asset.symbol)}&interval=${interval}&range=${range}&_t=${Date.now()}`);
        if (!r.ok) throw new Error(`Yahoo ${r.status}`);
        const j = await r.json();
        candles = j.candles || [];
      }
      if (!candles.length) throw new Error("데이터 없음");
      return candles;
    } catch (e) {
      setError(e.message);
      return null;
    } finally {
      setLoading(false);
    }
  }, [asset, isCrypto]);

  // ── build/rebuild charts ────────────────────────────────────────
  const buildCharts = useCallback(async (tf) => {
    const candles = await fetchData(tf);
    if (!candles) return;

    // Destroy old charts
    Object.values(chartObjs.current).forEach(c => { try { c.remove(); } catch {} });
    chartObjs.current = {};

    const closes  = candles.map(c => c.close);
    const times   = candles.map(c => c.time);
    const volumes = candles.map(c => c.volume ?? 0);

    const showRSI  = indicators.rsi;
    const showMACD = indicators.macd;
    const mainH  = showRSI || showMACD ? 340 : 500;
    const subH   = 120;

    // ── Main chart (candles) ───
    const mainChart = createChart(mainRef.current, { ...chartOptions(mainH) });
    chartObjs.current.main = mainChart;

    const candleSeries = mainChart.addCandlestickSeries({
      upColor: "#26a64b", downColor: "#ef4444",
      borderUpColor: "#26a64b", borderDownColor: "#ef4444",
      wickUpColor: "#26a64b", wickDownColor: "#ef4444",
    });
    candleSeries.setData(candles.map(c => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close })));

    // Volume as histogram on main chart
    if (indicators.vol) {
      const volSeries = mainChart.addHistogramSeries({
        color: "#1f6feb44",
        priceFormat: { type: "volume" },
        priceScaleId: "vol",
      });
      mainChart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });
      volSeries.setData(candles.map((c, i) => ({
        time: c.time,
        value: volumes[i],
        color: c.close >= c.open ? "#26a64b44" : "#ef444444",
      })));
    }

    // MA lines
    const maColors = { ma5: "#facc15", ma20: "#38bdf8", ma60: "#f97316", ma200: "#a78bfa" };
    const maPeriods = { ma5: 5, ma20: 20, ma60: 60, ma200: 200 };
    ["ma5","ma20","ma60","ma200"].forEach(key => {
      if (!indicators[key]) return;
      const sma = calcSMA(closes, maPeriods[key]);
      const maSeries = mainChart.addLineSeries({ color: maColors[key], lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
      maSeries.setData(sma.map((v, i) => v != null ? { time: times[i], value: v } : null).filter(Boolean));
    });

    // Bollinger Bands
    if (indicators.bb) {
      const bbs = calcBB(closes);
      const bbUpper = mainChart.addLineSeries({ color: "#60a5fa55", lineWidth: 1, priceLineVisible: false, lastValueVisible: false, lineStyle: LineStyle.Dashed });
      const bbMid   = mainChart.addLineSeries({ color: "#60a5fa88", lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
      const bbLower = mainChart.addLineSeries({ color: "#60a5fa55", lineWidth: 1, priceLineVisible: false, lastValueVisible: false, lineStyle: LineStyle.Dashed });
      const toSeries = (fn) => bbs.map((b, i) => b ? { time: times[i], value: fn(b) } : null).filter(Boolean);
      bbUpper.setData(toSeries(b => b.upper));
      bbMid.setData(toSeries(b => b.middle));
      bbLower.setData(toSeries(b => b.lower));
    }

    // Crosshair info
    mainChart.subscribeCrosshairMove(p => {
      if (p.time) {
        const bar = candles.find(c => c.time === p.time);
        if (bar) setOhlcInfo(bar);
      }
    });

    // ── RSI chart ───
    if (showRSI) {
      const rsiChart = createChart(rsiRef.current, { ...chartOptions(subH) });
      chartObjs.current.rsi = rsiChart;
      const rsi = calcRSI(closes);
      const rsiSeries = rsiChart.addLineSeries({ color: "#f472b6", lineWidth: 1.5, priceLineVisible: false, lastValueVisible: true });
      rsiSeries.setData(rsi.map((v, i) => v != null ? { time: times[i], value: v } : null).filter(Boolean));

      // Overbought/oversold lines
      [70, 30].forEach(lvl => {
        const line = rsiChart.addLineSeries({ color: lvl === 70 ? "#f4723044" : "#34d39944", lineWidth: 1, priceLineVisible: false, lastValueVisible: false, lineStyle: LineStyle.Dotted });
        line.setData(times.map(t => ({ time: t, value: lvl })));
      });

      // Sync scrolling
      mainChart.timeScale().subscribeVisibleLogicalRangeChange(r => {
        if (r) rsiChart.timeScale().setVisibleLogicalRange(r);
      });
      rsiChart.timeScale().subscribeVisibleLogicalRangeChange(r => {
        if (r) mainChart.timeScale().setVisibleLogicalRange(r);
      });
    }

    // ── MACD chart ───
    if (showMACD) {
      const macdChart = createChart(macdRef.current, { ...chartOptions(subH) });
      chartObjs.current.macd = macdChart;
      const { macdLine, signalLine, histogram } = calcMACD(closes);

      const histSeries = macdChart.addHistogramSeries({ color: "#3b82f6", priceLineVisible: false, lastValueVisible: false });
      histSeries.setData(histogram.map((v, i) => v != null ? { time: times[i], value: v, color: v >= 0 ? "#26a64b99" : "#ef444499" } : null).filter(Boolean));

      const macdSeries = macdChart.addLineSeries({ color: "#38bdf8", lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false });
      macdSeries.setData(macdLine.map((v, i) => v != null ? { time: times[i], value: v } : null).filter(Boolean));

      const sigSeries = macdChart.addLineSeries({ color: "#f97316", lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false });
      sigSeries.setData(signalLine.map((v, i) => v != null ? { time: times[i], value: v } : null).filter(Boolean));

      // Sync
      mainChart.timeScale().subscribeVisibleLogicalRangeChange(r => {
        if (r) macdChart.timeScale().setVisibleLogicalRange(r);
      });
      macdChart.timeScale().subscribeVisibleLogicalRangeChange(r => {
        if (r) mainChart.timeScale().setVisibleLogicalRange(r);
      });
    }

    mainChart.timeScale().fitContent();
  }, [fetchData, indicators]);

  useEffect(() => {
    if (!asset) return;
    buildCharts(timeframe);
    return () => {
      Object.values(chartObjs.current).forEach(c => { try { c.remove(); } catch {} });
    };
  }, [asset, timeframe, indicators]); // rebuild when tf or indicators change

  // Resize observer
  useEffect(() => {
    const resizeAll = () => {
      const w = mainRef.current?.clientWidth;
      if (!w) return;
      Object.values(chartObjs.current).forEach(c => c.applyOptions({ width: w }));
    };
    window.addEventListener("resize", resizeAll);
    return () => window.removeEventListener("resize", resizeAll);
  }, []);

  if (!asset) return null;

  const formatPrice = (p) => {
    if (!p) return "—";
    if (asset.market === "kr") return `₩${Math.round(p).toLocaleString()}`;
    if (p < 1) return `$${p.toFixed(6)}`;
    return `$${p.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  };

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 1000,
      background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center",
      padding: "12px",
    }} onClick={onClose}>
      <div style={{
        background: "#0d1117", border: "1px solid #1c2128", borderRadius: "16px",
        width: "min(900px, 100%)", maxHeight: "92vh", overflow: "auto",
        padding: "20px",
        boxShadow: "0 25px 60px rgba(0,0,0,0.8)",
      }} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <span style={{ fontSize: "20px" }}>
              {asset.market === "us" ? "🇺🇸" : asset.market === "kr" ? "🇰🇷" : "₿"}
            </span>
            <div>
              <div style={{ color: "#f0f6fc", fontWeight: 700, fontSize: "18px" }}>{asset.name}</div>
              <div style={{ color: "#8b949e", fontSize: "13px" }}>{asset.symbol}</div>
            </div>
            <div style={{ marginLeft: "8px", textAlign: "right" }}>
              <div style={{ color: "#f0f6fc", fontWeight: 700, fontSize: "22px" }}>
                {formatPrice(asset.price)}
              </div>
              <div style={{ fontSize: "13px", color: asset.weekChange >= 0 ? "#26a64b" : "#ef4444" }}>
                {asset.weekChange >= 0 ? "▲" : "▼"} {Math.abs(asset.weekChange)}%
              </div>
            </div>
          </div>
          <button onClick={onClose} style={{
            background: "none", border: "none", color: "#8b949e", cursor: "pointer",
            fontSize: "22px", lineHeight: 1, padding: "4px 8px", borderRadius: "8px",
          }}>✕</button>
        </div>

        {/* OHLC crosshair info */}
        {ohlcInfo && (
          <div style={{
            display: "flex", gap: "16px", marginBottom: "12px",
            background: "#161b22", borderRadius: "8px", padding: "8px 14px",
            fontSize: "12px", flexWrap: "wrap",
          }}>
            {[["O", ohlcInfo.open], ["H", ohlcInfo.high], ["L", ohlcInfo.low], ["C", ohlcInfo.close]].map(([label, val]) => (
              <span key={label} style={{ color: "#8b949e" }}>
                <span style={{ color: "#8b949e", marginRight: "4px" }}>{label}</span>
                <span style={{ color: "#f0f6fc", fontWeight: 600 }}>{formatPrice(val)}</span>
              </span>
            ))}
          </div>
        )}

        {/* Timeframe buttons */}
        <div style={{ display: "flex", gap: "6px", marginBottom: "12px", flexWrap: "wrap" }}>
          {Object.entries(TF_CONFIG).map(([key, { label }]) => (
            <button key={key} onClick={() => setTimeframe(key)} style={{
              padding: "5px 12px", borderRadius: "8px", fontSize: "13px", cursor: "pointer", fontWeight: 600,
              background: timeframe === key ? "#1f6feb" : "#161b22",
              color: timeframe === key ? "#fff" : "#8b949e",
              border: `1px solid ${timeframe === key ? "#1f6feb" : "#30363d"}`,
              transition: "all .15s",
            }}>{label}</button>
          ))}
        </div>

        {/* Indicator toggles */}
        <div style={{ display: "flex", gap: "6px", marginBottom: "16px", flexWrap: "wrap" }}>
          {[
            { key: "ma5", label: "MA5", color: "#facc15" },
            { key: "ma20", label: "MA20", color: "#38bdf8" },
            { key: "ma60", label: "MA60", color: "#f97316" },
            { key: "ma200", label: "MA200", color: "#a78bfa" },
            { key: "bb", label: "BB", color: "#60a5fa" },
            { key: "vol", label: "거래량", color: "#1f6feb" },
            { key: "rsi", label: "RSI", color: "#f472b6" },
            { key: "macd", label: "MACD", color: "#34d399" },
          ].map(({ key, label, color }) => (
            <button key={key} onClick={() => toggleIndicator(key)} style={{
              padding: "4px 10px", borderRadius: "6px", fontSize: "12px", cursor: "pointer",
              background: indicators[key] ? `${color}22` : "transparent",
              color: indicators[key] ? color : "#555",
              border: `1px solid ${indicators[key] ? color : "#30363d"}`,
              transition: "all .15s",
            }}>{label}</button>
          ))}
        </div>

        {/* Charts */}
        {loading && (
          <div style={{ textAlign: "center", padding: "60px", color: "#8b949e" }}>
            <div style={{ fontSize: "24px", marginBottom: "8px" }}>📡</div>
            <div>차트 데이터 로딩 중...</div>
          </div>
        )}
        {error && !loading && (
          <div style={{ textAlign: "center", padding: "40px", color: "#ef4444" }}>
            <div style={{ fontSize: "20px", marginBottom: "8px" }}>⚠️</div>
            <div>{error}</div>
          </div>
        )}
        <div style={{ display: loading ? "none" : "block" }}>
          <div ref={mainRef} style={{ width: "100%", borderRadius: "8px", overflow: "hidden" }} />
          {indicators.rsi && (
            <>
              <div style={{ color: "#8b949e", fontSize: "11px", padding: "4px 0 2px 4px" }}>RSI(14)</div>
              <div ref={rsiRef} style={{ width: "100%", borderRadius: "8px", overflow: "hidden" }} />
            </>
          )}
          {indicators.macd && (
            <>
              <div style={{ color: "#8b949e", fontSize: "11px", padding: "4px 0 2px 4px" }}>MACD(12,26,9)</div>
              <div ref={macdRef} style={{ width: "100%", borderRadius: "8px", overflow: "hidden" }} />
            </>
          )}
        </div>

        {/* Legend */}
        <div style={{
          marginTop: "12px", padding: "10px 12px",
          background: "#161b22", borderRadius: "8px",
          display: "flex", gap: "16px", flexWrap: "wrap", fontSize: "11px",
        }}>
          {[
            { color: "#facc15", label: "MA5" }, { color: "#38bdf8", label: "MA20" },
            { color: "#f97316", label: "MA60" }, { color: "#a78bfa", label: "MA200" },
            { color: "#60a5fa", label: "볼린저밴드" }, { color: "#f472b6", label: "RSI" },
            { color: "#38bdf8", label: "MACD" }, { color: "#f97316", label: "Signal" },
          ].map(({ color, label }) => (
            <span key={label} style={{ display: "flex", alignItems: "center", gap: "4px", color: "#8b949e" }}>
              <span style={{ width: "16px", height: "2px", background: color, display: "inline-block", borderRadius: "1px" }} />
              {label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
