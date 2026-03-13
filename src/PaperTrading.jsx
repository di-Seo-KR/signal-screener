// DI금융 — 퀀트 전략 기반 자동매매 시스템 v2.0
// 퀀트 포트폴리오 전략 시그널 → 자동 주문 실행 → 포지션 관리
// Alpaca Trading API 연동 (Paper / Live)
import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { ALL_STRATEGIES } from "./strategies.js";

const C = {
  bg: "#070C14", card: "#0F1825", card2: "#141E2E",
  border: "#1A2535", border2: "#243044",
  blue: "#3182F6", blueL: "#5AA3FF", blueBg: "#1A2C4F",
  red: "#F04452", redBg: "#2A1520",
  green: "#05C072", greenBg: "#0A2A1A",
  yellow: "#FFB400", yellowBg: "#2A2000",
  purple: "#8B5CF6", purpleBg: "#1E1535",
  orange: "#FF6B2C",
  text1: "#F2F4F7", text2: "#A0AEBF", text3: "#5A6880",
};

// ══════════════════════════════════════════════════════════════
// 퀀트 전략 포트폴리오 (US 종목만 — Alpaca 거래 대상)
// ══════════════════════════════════════════════════════════════
const STRATEGY_PORTFOLIOS = {
  "RSI 반전 전략": [
    { sym: "GOOGL", w: 0.12 }, { sym: "AMD", w: 0.10 }, { sym: "TSLA", w: 0.10 },
    { sym: "AAPL", w: 0.10 }, { sym: "DIS", w: 0.08 }, { sym: "PYPL", w: 0.08 },
    { sym: "INTC", w: 0.08 }, { sym: "NKE", w: 0.08 }, { sym: "BA", w: 0.08 },
    { sym: "COIN", w: 0.06 }, { sym: "DASH", w: 0.06 }, { sym: "ABNB", w: 0.06 },
  ],
  "볼린저밴드 바운스": [
    { sym: "AAPL", w: 0.10 }, { sym: "MSFT", w: 0.08 }, { sym: "JPM", w: 0.08 },
    { sym: "JNJ", w: 0.07 }, { sym: "PG", w: 0.07 }, { sym: "V", w: 0.07 },
    { sym: "KO", w: 0.06 }, { sym: "PEP", w: 0.06 }, { sym: "MRK", w: 0.06 },
    { sym: "COST", w: 0.06 }, { sym: "HD", w: 0.06 }, { sym: "UNH", w: 0.07 },
    { sym: "WMT", w: 0.05 }, { sym: "ABBV", w: 0.06 }, { sym: "TMO", w: 0.05 },
  ],
  "MACD 크로스오버": [
    { sym: "NVDA", w: 0.10 }, { sym: "META", w: 0.08 }, { sym: "AMZN", w: 0.08 },
    { sym: "MSFT", w: 0.07 }, { sym: "AVGO", w: 0.07 }, { sym: "ORCL", w: 0.06 },
    { sym: "CRM", w: 0.06 }, { sym: "NOW", w: 0.06 }, { sym: "PANW", w: 0.06 },
    { sym: "CRWD", w: 0.06 }, { sym: "DDOG", w: 0.05 }, { sym: "NET", w: 0.05 },
    { sym: "SPY", w: 0.06 }, { sym: "QQQ", w: 0.07 }, { sym: "SOXX", w: 0.07 },
  ],
  "이평선 크로스 (20/60)": [
    { sym: "SPY", w: 0.10 }, { sym: "QQQ", w: 0.08 }, { sym: "AAPL", w: 0.07 },
    { sym: "MSFT", w: 0.07 }, { sym: "NVDA", w: 0.07 }, { sym: "AMZN", w: 0.06 },
    { sym: "GOOG", w: 0.06 }, { sym: "META", w: 0.06 }, { sym: "AVGO", w: 0.06 },
    { sym: "JPM", w: 0.06 }, { sym: "LLY", w: 0.06 }, { sym: "GLD", w: 0.05 },
    { sym: "TLT", w: 0.05 }, { sym: "COST", w: 0.05 }, { sym: "XLE", w: 0.05 },
    { sym: "DIA", w: 0.05 },
  ],
  "거래량 돌파 전략": [
    { sym: "NVDA", w: 0.10 }, { sym: "AMD", w: 0.08 }, { sym: "TSLA", w: 0.08 },
    { sym: "AVGO", w: 0.07 }, { sym: "MRVL", w: 0.06 }, { sym: "COIN", w: 0.06 },
    { sym: "META", w: 0.07 }, { sym: "NFLX", w: 0.06 }, { sym: "SHOP", w: 0.06 },
    { sym: "CRWD", w: 0.06 }, { sym: "SNOW", w: 0.05 }, { sym: "NET", w: 0.05 },
    { sym: "DDOG", w: 0.05 }, { sym: "ARKK", w: 0.05 }, { sym: "SOXX", w: 0.05 },
    { sym: "SMH", w: 0.05 },
  ],
  "스토캐스틱+RSI 콤보": [
    { sym: "AMZN", w: 0.09 }, { sym: "META", w: 0.09 }, { sym: "NFLX", w: 0.08 },
    { sym: "CRM", w: 0.07 }, { sym: "ORCL", w: 0.07 }, { sym: "SBUX", w: 0.06 },
    { sym: "MCD", w: 0.06 }, { sym: "MA", w: 0.07 }, { sym: "DHR", w: 0.06 },
    { sym: "ABNB", w: 0.06 }, { sym: "UBER", w: 0.06 }, { sym: "LLY", w: 0.06 },
    { sym: "NOW", w: 0.06 }, { sym: "V", w: 0.06 }, { sym: "UNH", w: 0.05 },
  ],
  "터틀 트레이딩": [
    { sym: "SPY", w: 0.08 }, { sym: "QQQ", w: 0.07 }, { sym: "GLD", w: 0.08 },
    { sym: "TLT", w: 0.07 }, { sym: "XLE", w: 0.06 }, { sym: "XLF", w: 0.06 },
    { sym: "XOM", w: 0.06 }, { sym: "CVX", w: 0.05 }, { sym: "COP", w: 0.05 },
    { sym: "BA", w: 0.06 }, { sym: "CAT", w: 0.06 }, { sym: "GE", w: 0.06 },
    { sym: "RTX", w: 0.05 }, { sym: "LMT", w: 0.05 }, { sym: "IWM", w: 0.05 },
    { sym: "DIA", w: 0.05 }, { sym: "VNQ", w: 0.04 },
  ],
  "듀얼 모멘텀": [
    { sym: "SPY", w: 0.12 }, { sym: "QQQ", w: 0.10 }, { sym: "IWM", w: 0.06 },
    { sym: "GLD", w: 0.10 }, { sym: "NVDA", w: 0.08 }, { sym: "AAPL", w: 0.06 },
    { sym: "MSFT", w: 0.06 }, { sym: "TLT", w: 0.08 }, { sym: "XLE", w: 0.06 },
    { sym: "XLF", w: 0.05 }, { sym: "SOXX", w: 0.06 }, { sym: "AVGO", w: 0.05 },
    { sym: "META", w: 0.05 }, { sym: "XLV", w: 0.04 }, { sym: "VNQ", w: 0.03 },
  ],
  "슈퍼트렌드": [
    { sym: "NVDA", w: 0.10 }, { sym: "TSLA", w: 0.08 }, { sym: "AMD", w: 0.07 },
    { sym: "AVGO", w: 0.07 }, { sym: "META", w: 0.07 }, { sym: "AMZN", w: 0.06 },
    { sym: "COIN", w: 0.06 }, { sym: "MSTR", w: 0.05 }, { sym: "SHOP", w: 0.06 },
    { sym: "SQ", w: 0.05 }, { sym: "CRWD", w: 0.06 }, { sym: "ARKK", w: 0.06 },
    { sym: "SMH", w: 0.07 }, { sym: "SOXX", w: 0.07 }, { sym: "SPY", w: 0.07 },
  ],
  "파라볼릭 SAR": [
    { sym: "AAPL", w: 0.08 }, { sym: "MSFT", w: 0.08 }, { sym: "GOOG", w: 0.07 },
    { sym: "AMZN", w: 0.07 }, { sym: "JPM", w: 0.07 }, { sym: "V", w: 0.06 },
    { sym: "MA", w: 0.06 }, { sym: "UNH", w: 0.06 }, { sym: "LLY", w: 0.06 },
    { sym: "PG", w: 0.06 }, { sym: "JNJ", w: 0.05 }, { sym: "HD", w: 0.06 },
    { sym: "COST", w: 0.06 }, { sym: "GS", w: 0.05 }, { sym: "MS", w: 0.05 },
    { sym: "BLK", w: 0.06 },
  ],
  "ATR 스윙": [
    { sym: "TSLA", w: 0.09 }, { sym: "NVDA", w: 0.08 }, { sym: "AMD", w: 0.07 },
    { sym: "GLD", w: 0.10 }, { sym: "TLT", w: 0.08 }, { sym: "XOM", w: 0.06 },
    { sym: "CVX", w: 0.06 }, { sym: "JPM", w: 0.06 }, { sym: "SPY", w: 0.07 },
    { sym: "IWM", w: 0.05 }, { sym: "BA", w: 0.06 }, { sym: "CAT", w: 0.06 },
    { sym: "RTX", w: 0.05 }, { sym: "LMT", w: 0.05 }, { sym: "GE", w: 0.06 },
  ],
  "피보나치 되돌림": [
    { sym: "SPY", w: 0.12 }, { sym: "QQQ", w: 0.10 }, { sym: "AAPL", w: 0.08 },
    { sym: "MSFT", w: 0.08 }, { sym: "AMZN", w: 0.07 }, { sym: "GOOG", w: 0.07 },
    { sym: "GLD", w: 0.08 }, { sym: "TLT", w: 0.07 }, { sym: "XLE", w: 0.06 },
    { sym: "DIA", w: 0.06 }, { sym: "COST", w: 0.06 }, { sym: "LLY", w: 0.06 },
    { sym: "ABBV", w: 0.05 }, { sym: "AVGO", w: 0.04 },
  ],
};

// 전략이름 → strategies.js의 전략 매칭
const STRATEGY_MAP = {};
ALL_STRATEGIES.forEach(s => { STRATEGY_MAP[s.name] = s; });

// US 종목만 수집
function collectUSSymbols() {
  const syms = new Set();
  for (const holdings of Object.values(STRATEGY_PORTFOLIOS)) {
    for (const { sym } of holdings) {
      if (!sym.includes(".KS") && !sym.includes("-USD")) syms.add(sym);
    }
  }
  return [...syms];
}

const ALPACA_STORAGE_KEY = "di_alpaca_config";
const AUTO_TRADE_KEY = "di_auto_trade";
const TRADE_LOG_KEY = "di_trade_log";
const EXECUTED_KEY = "di_executed_signals";

function loadAlpacaConfig() {
  try { return JSON.parse(localStorage.getItem(ALPACA_STORAGE_KEY)) || {}; } catch { return {}; }
}
function saveAlpacaConfig(cfg) {
  try { localStorage.setItem(ALPACA_STORAGE_KEY, JSON.stringify(cfg)); } catch {}
}
function loadTradeLog() {
  try { return JSON.parse(localStorage.getItem(TRADE_LOG_KEY)) || []; } catch { return []; }
}
function saveTradeLog(log) {
  try { localStorage.setItem(TRADE_LOG_KEY, JSON.stringify(log.slice(0, 200))); } catch {}
}
function loadExecuted() {
  try { return JSON.parse(localStorage.getItem(EXECUTED_KEY)) || {}; } catch { return {}; }
}
function saveExecuted(map) {
  // 최근 7일 것만 유지
  const cutoff = Date.now() - 7 * 24 * 3600 * 1000;
  const clean = {};
  for (const [k, v] of Object.entries(map)) { if (v > cutoff) clean[k] = v; }
  try { localStorage.setItem(EXECUTED_KEY, JSON.stringify(clean)); } catch {}
}

// ── Alpaca API 호출 래퍼 ──
async function alpacaAPI(action, config, params = {}) {
  const { apiKey, apiSecret, isPaper = true } = config;
  if (!apiKey || !apiSecret) throw new Error("API 키가 설정되지 않았습니다");
  const isPost = ["submit_order"].includes(action);
  const queryParams = isPost ? `action=${action}` : new URLSearchParams({ action, ...params }).toString();
  const res = await fetch(`/api/alpaca?${queryParams}`, {
    method: isPost ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
      "x-alpaca-key": apiKey,
      "x-alpaca-secret": apiSecret,
      "x-alpaca-paper": String(isPaper),
    },
    body: isPost ? JSON.stringify(params) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || data.error || `API Error ${res.status}`);
  return data;
}

// ── Yahoo Finance 캔들 데이터 fetch ──
async function fetchCandleData(symbols, onProgress) {
  const results = {};
  const BATCH = 15;
  const batches = [];
  for (let i = 0; i < symbols.length; i += BATCH) batches.push(symbols.slice(i, i + BATCH));

  let done = 0;
  for (const batch of batches) {
    try {
      const ctrl = new AbortController();
      const tmr = setTimeout(() => ctrl.abort(), 20000);
      const url = `/api/yahoo-batch?symbols=${batch.join(",")}&range=6mo&interval=1d`;
      const res = await fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(tmr));
      if (res.ok) {
        const data = await res.json();
        for (const sym of batch) {
          if (data[sym]?.chart?.result?.[0]) {
            const r = data[sym].chart.result[0];
            const ts = r.timestamp || [];
            const q = r.indicators?.quote?.[0] || {};
            const candles = [];
            for (let j = 0; j < ts.length; j++) {
              if (q.close?.[j] != null) {
                candles.push({
                  time: ts[j] * 1000,
                  open: q.open?.[j] || q.close[j],
                  high: q.high?.[j] || q.close[j],
                  low: q.low?.[j] || q.close[j],
                  close: q.close[j],
                  volume: q.volume?.[j] || 0,
                });
              }
            }
            if (candles.length > 30) results[sym] = candles;
          }
        }
      }
    } catch {}
    done += batch.length;
    if (onProgress) onProgress(Math.min(100, Math.round((done / symbols.length) * 100)));
    // 배치 간 딜레이
    if (done < symbols.length) await new Promise(r => setTimeout(r, 300));
  }
  return results;
}

// ── 전략 시그널 감지 엔진 ──
function detectSignals(candleMap) {
  const signals = [];
  const now = Date.now();

  for (const [stratName, holdings] of Object.entries(STRATEGY_PORTFOLIOS)) {
    const strategy = STRATEGY_MAP[stratName];
    if (!strategy?.generate) continue;

    for (const { sym, w } of holdings) {
      const candles = candleMap[sym];
      if (!candles || candles.length < 30) continue;

      try {
        const sigs = strategy.generate(candles);
        if (!sigs?.length) continue;

        // 최근 5 캔들 이내의 시그널만
        const recent = sigs.filter(s => s.index >= candles.length - 5);
        for (const sig of recent) {
          const candle = candles[sig.index] || candles[candles.length - 1];
          signals.push({
            id: `${stratName}-${sym}-${sig.type}-${candle.time}`,
            strategy: stratName,
            strategyIcon: strategy.icon || "📊",
            category: strategy.category || "",
            symbol: sym,
            type: sig.type, // BUY or SELL
            price: sig.price || candle.close,
            reason: sig.reason || `${stratName} ${sig.type}`,
            weight: w,
            time: candle.time,
            detectedAt: now,
          });
        }
      } catch {}
    }
  }

  // 최신 시그널 우선
  signals.sort((a, b) => b.time - a.time);
  return signals;
}

// ── 숫자 포맷 ──
function fmt(n, dec = 2) {
  if (n == null || isNaN(n)) return "—";
  return Number(n).toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
function fmtUSD(n) { return n == null ? "—" : `$${fmt(n)}`; }
function fmtPct(n) { return n == null ? "—" : `${Number(n) >= 0 ? "+" : ""}${fmt(n)}%`; }

// ══════════════════════════════════════════════════════════════
// 설정 패널
// ══════════════════════════════════════════════════════════════
function SetupPanel({ config, setConfig, onConnect }) {
  const [key, setKey] = useState(config.apiKey || "");
  const [secret, setSecret] = useState(config.apiSecret || "");
  const [showSecret, setShowSecret] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState("");

  const handleConnect = async () => {
    if (!key.trim() || !secret.trim()) { setError("API Key와 Secret을 모두 입력해주세요"); return; }
    setTesting(true); setError("");
    try {
      const acc = await alpacaAPI("account", { apiKey: key.trim(), apiSecret: secret.trim(), isPaper: true });
      if (acc.id) {
        const newConfig = { apiKey: key.trim(), apiSecret: secret.trim(), isPaper: true, connected: true };
        setConfig(newConfig);
        saveAlpacaConfig(newConfig);
        onConnect(acc);
      } else {
        setError("계좌 인증 실패. API 키를 확인해주세요.");
      }
    } catch (e) { setError(e.message || "연결 실패"); }
    setTesting(false);
  };

  return (
    <div className="tab-content">
      <div style={{ background: `linear-gradient(135deg, ${C.card} 0%, #0D1B2A 100%)`,
        border: `1px solid ${C.border}`, borderRadius: "16px", padding: "32px 24px", textAlign: "center", marginBottom: "16px" }}>
        <div style={{ fontSize: "48px", marginBottom: "12px" }}>🤖</div>
        <div style={{ fontWeight: 800, fontSize: "22px", marginBottom: "8px" }}>퀀트 자동매매</div>
        <div style={{ color: C.text3, fontSize: "14px", maxWidth: "420px", margin: "0 auto", lineHeight: 1.6 }}>
          32개 퀀트 전략이 실시간으로 시장을 분석하고, 시그널 발생 시 자동으로 매매를 실행합니다.
          Alpaca API 연동으로 실시간 포지션 관리.
        </div>
      </div>

      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "16px", padding: "20px", marginBottom: "16px" }}>
        <div style={{ fontWeight: 700, fontSize: "15px", marginBottom: "12px" }}>시작하기</div>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {[
            { step: "1", title: "Alpaca 계정 생성", desc: "alpaca.markets 에서 무료 가입", link: "https://app.alpaca.markets/signup" },
            { step: "2", title: "Paper Trading API 키 발급", desc: "Dashboard → Paper Trading → API Keys" },
            { step: "3", title: "아래에 키 입력 후 연결", desc: "API Key ID와 Secret Key를 입력하세요" },
          ].map(s => (
            <div key={s.step} style={{ display: "flex", gap: "12px", alignItems: "flex-start" }}>
              <div style={{ width: "28px", height: "28px", borderRadius: "50%", background: C.blueBg,
                color: C.blue, fontWeight: 800, fontSize: "13px", display: "flex", alignItems: "center",
                justifyContent: "center", flexShrink: 0 }}>{s.step}</div>
              <div>
                <div style={{ fontWeight: 600, fontSize: "13px" }}>{s.title}</div>
                <div style={{ fontSize: "12px", color: C.text3 }}>{s.desc}</div>
                {s.link && <a href={s.link} target="_blank" rel="noopener noreferrer"
                  style={{ fontSize: "12px", color: C.blue, textDecoration: "none" }}>alpaca.markets 가입 →</a>}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "16px", padding: "20px" }}>
        <div style={{ fontWeight: 700, fontSize: "15px", marginBottom: "16px" }}>API 연결</div>
        <div style={{ marginBottom: "12px" }}>
          <label style={{ fontSize: "12px", color: C.text3, fontWeight: 600, marginBottom: "4px", display: "block" }}>API Key ID</label>
          <input value={key} onChange={e => setKey(e.target.value)} placeholder="PK..." style={{
            width: "100%", padding: "10px 14px", borderRadius: "10px", fontSize: "14px",
            background: C.card2, border: `1px solid ${C.border2}`, color: C.text1, outline: "none", fontFamily: "monospace",
          }} />
        </div>
        <div style={{ marginBottom: "16px" }}>
          <label style={{ fontSize: "12px", color: C.text3, fontWeight: 600, marginBottom: "4px", display: "block" }}>Secret Key</label>
          <div style={{ position: "relative" }}>
            <input value={secret} onChange={e => setSecret(e.target.value)}
              type={showSecret ? "text" : "password"} placeholder="Secret..." style={{
              width: "100%", padding: "10px 14px", paddingRight: "60px", borderRadius: "10px", fontSize: "14px",
              background: C.card2, border: `1px solid ${C.border2}`, color: C.text1, outline: "none", fontFamily: "monospace",
            }} />
            <button onClick={() => setShowSecret(!showSecret)} style={{
              position: "absolute", right: "8px", top: "50%", transform: "translateY(-50%)",
              background: "none", border: "none", color: C.text3, fontSize: "12px", cursor: "pointer",
            }}>{showSecret ? "숨기기" : "보기"}</button>
          </div>
        </div>
        {error && <div style={{ background: C.redBg, border: `1px solid ${C.red}33`, borderRadius: "8px",
          padding: "10px 14px", fontSize: "12px", color: C.red, marginBottom: "12px" }}>{error}</div>}
        <button onClick={handleConnect} disabled={testing} style={{
          width: "100%", padding: "12px", borderRadius: "12px", fontSize: "15px", fontWeight: 700,
          background: testing ? C.card2 : `linear-gradient(135deg, ${C.blue}, #2563EB)`,
          color: "#fff", border: "none", cursor: testing ? "default" : "pointer",
        }}>{testing ? "연결 중..." : "트레이딩 연결"}</button>
        <div style={{ fontSize: "11px", color: C.text3, marginTop: "10px", textAlign: "center" }}>
          API 키는 브라우저 로컬에만 저장됩니다
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// 주문 실행 모달
// ══════════════════════════════════════════════════════════════
function OrderModal({ symbol: initSymbol, side, reason, config, onClose, onOrderPlaced }) {
  const [symbol, setSymbol] = useState(initSymbol || "");
  const [qty, setQty] = useState("");
  const [notional, setNotional] = useState("");
  const [orderType, setOrderType] = useState("market");
  const [limitPrice, setLimitPrice] = useState("");
  const [qtyMode, setQtyMode] = useState("shares");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  const handleSubmit = async () => {
    setSubmitting(true); setError(""); setResult(null);
    try {
      const params = {
        symbol: symbol.replace(".KS", "").replace("-USD", ""),
        side,
        type: orderType,
        time_in_force: orderType === "market" ? "day" : "gtc",
      };
      if (qtyMode === "shares") params.qty = parseFloat(qty);
      else params.notional = parseFloat(notional);
      if (orderType === "limit") params.limit_price = parseFloat(limitPrice);
      const order = await alpacaAPI("submit_order", config, params);
      setResult(order);
      if (onOrderPlaced) onOrderPlaced(order);
    } catch (e) { setError(e.message); }
    setSubmitting(false);
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9999, display: "flex", alignItems: "center",
      justifyContent: "center", background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}
      onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: C.card, border: `1px solid ${C.border}`, borderRadius: "20px",
        padding: "24px", width: "100%", maxWidth: "400px", margin: "16px",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
          <div style={{ fontWeight: 800, fontSize: "17px" }}>
            {side === "buy" ? "매수" : "매도"} 주문
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: C.text3, fontSize: "20px", cursor: "pointer" }}>×</button>
        </div>

        {initSymbol ? (
          <div style={{ background: C.card2, borderRadius: "10px", padding: "12px", marginBottom: "12px",
            borderLeft: `3px solid ${side === "buy" ? C.red : C.blue}` }}>
            <div style={{ fontWeight: 700, fontSize: "15px" }}>{symbol}</div>
            {reason && <div style={{ fontSize: "11px", color: C.text3, marginTop: "2px" }}>{reason}</div>}
          </div>
        ) : (
          <div style={{ marginBottom: "12px" }}>
            <label style={{ fontSize: "12px", color: C.text3, fontWeight: 600, display: "block", marginBottom: "4px" }}>종목 심볼</label>
            <input value={symbol} onChange={e => setSymbol(e.target.value.toUpperCase())}
              placeholder="AAPL, NVDA, TSLA..." style={{
              width: "100%", padding: "10px 14px", borderRadius: "10px", fontSize: "16px", fontWeight: 700,
              background: C.card2, border: `1px solid ${C.border2}`, color: C.text1, outline: "none",
            }} />
          </div>
        )}

        {!result ? (
          <>
            <div style={{ display: "flex", gap: "4px", marginBottom: "12px" }}>
              {[["shares", "수량(주)"], ["dollars", "금액($)"]].map(([id, label]) => (
                <button key={id} onClick={() => setQtyMode(id)} style={{
                  flex: 1, padding: "8px", borderRadius: "8px", fontSize: "12px", fontWeight: 600,
                  background: qtyMode === id ? C.blueBg : "transparent",
                  color: qtyMode === id ? C.blue : C.text3,
                  border: `1px solid ${qtyMode === id ? C.blue : C.border2}`, cursor: "pointer",
                }}>{label}</button>
              ))}
            </div>

            <div style={{ marginBottom: "12px" }}>
              <label style={{ fontSize: "12px", color: C.text3, fontWeight: 600, display: "block", marginBottom: "4px" }}>
                {qtyMode === "shares" ? "주문 수량" : "주문 금액 (USD)"}
              </label>
              <input value={qtyMode === "shares" ? qty : notional}
                onChange={e => qtyMode === "shares" ? setQty(e.target.value) : setNotional(e.target.value)}
                type="number" placeholder={qtyMode === "shares" ? "10" : "1000"} style={{
                width: "100%", padding: "10px 14px", borderRadius: "10px", fontSize: "16px", fontWeight: 700,
                background: C.card2, border: `1px solid ${C.border2}`, color: C.text1, outline: "none",
              }} />
            </div>

            <div style={{ display: "flex", gap: "4px", marginBottom: "12px" }}>
              {[["market", "시장가"], ["limit", "지정가"]].map(([id, label]) => (
                <button key={id} onClick={() => setOrderType(id)} style={{
                  flex: 1, padding: "8px", borderRadius: "8px", fontSize: "12px", fontWeight: 600,
                  background: orderType === id ? C.blueBg : "transparent",
                  color: orderType === id ? C.blue : C.text3,
                  border: `1px solid ${orderType === id ? C.blue : C.border2}`, cursor: "pointer",
                }}>{label}</button>
              ))}
            </div>

            {orderType === "limit" && (
              <div style={{ marginBottom: "12px" }}>
                <label style={{ fontSize: "12px", color: C.text3, fontWeight: 600, display: "block", marginBottom: "4px" }}>지정가 ($)</label>
                <input value={limitPrice} onChange={e => setLimitPrice(e.target.value)}
                  type="number" placeholder="150.00" style={{
                  width: "100%", padding: "10px 14px", borderRadius: "10px", fontSize: "16px", fontWeight: 700,
                  background: C.card2, border: `1px solid ${C.border2}`, color: C.text1, outline: "none",
                }} />
              </div>
            )}

            {error && <div style={{ background: C.redBg, borderRadius: "8px", padding: "10px",
              fontSize: "12px", color: C.red, marginBottom: "12px" }}>{error}</div>}

            <button onClick={handleSubmit} disabled={submitting || (!qty && !notional)} style={{
              width: "100%", padding: "14px", borderRadius: "12px", fontSize: "15px", fontWeight: 700,
              background: submitting ? C.card2 : side === "buy"
                ? `linear-gradient(135deg, ${C.red}, #DC2626)`
                : `linear-gradient(135deg, ${C.blue}, #2563EB)`,
              color: "#fff", border: "none", cursor: submitting ? "default" : "pointer",
              opacity: (!qty && !notional) ? 0.5 : 1,
            }}>
              {submitting ? "주문 전송 중..." : side === "buy" ? `${symbol} 매수` : `${symbol} 매도`}
            </button>
          </>
        ) : (
          <div style={{ textAlign: "center", padding: "16px 0" }}>
            <div style={{ fontSize: "40px", marginBottom: "8px" }}>
              {result.status === "accepted" || result.status === "new" || result.status === "filled" ? "✅" : "⚠️"}
            </div>
            <div style={{ fontWeight: 700, fontSize: "15px", marginBottom: "4px" }}>
              {result.status === "accepted" || result.status === "new" ? "주문 접수" :
               result.status === "filled" ? "체결 완료" : `상태: ${result.status}`}
            </div>
            <div style={{ fontSize: "12px", color: C.text3 }}>
              {result.symbol} · {result.side === "buy" ? "매수" : "매도"} · {result.qty || result.notional}
              {result.type === "limit" ? ` @ $${result.limit_price}` : " 시장가"}
            </div>
            <button onClick={onClose} style={{
              marginTop: "16px", padding: "10px 24px", borderRadius: "10px",
              background: C.card2, border: `1px solid ${C.border2}`, color: C.text2,
              fontSize: "13px", fontWeight: 600, cursor: "pointer",
            }}>확인</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// 메인 컴포넌트
// ══════════════════════════════════════════════════════════════
export default function PaperTrading({ strategyAlerts = [], theme = "dark" }) {
  const [config, setConfig] = useState(() => loadAlpacaConfig());
  const [account, setAccount] = useState(null);
  const [positions, setPositions] = useState([]);
  const [orders, setOrders] = useState([]);
  const [clock, setClock] = useState(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("dashboard");
  const [orderModal, setOrderModal] = useState(null);

  // 자동매매 상태
  const [autoTradeEnabled, setAutoTradeEnabled] = useState(() => {
    try { return JSON.parse(localStorage.getItem(AUTO_TRADE_KEY)) || false; } catch { return false; }
  });
  const [tradeLog, setTradeLog] = useState(() => loadTradeLog());
  const [executedSignals, setExecutedSignals] = useState(() => loadExecuted());

  // 퀀트 스캔 상태
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [detectedSignals, setDetectedSignals] = useState([]);
  const [lastScanTime, setLastScanTime] = useState(null);
  const [autoScanEnabled, setAutoScanEnabled] = useState(false);

  // 자동매매 설정
  const [tradeSettings, setTradeSettings] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("di_trade_settings")) || {
        orderType: "market",
        allocationPct: 2, // 총 자산 대비 % per trade
        maxPositions: 20,
        strategies: Object.keys(STRATEGY_PORTFOLIOS), // 활성화된 전략
      };
    } catch {
      return { orderType: "market", allocationPct: 2, maxPositions: 20, strategies: Object.keys(STRATEGY_PORTFOLIOS) };
    }
  });

  const refreshTimer = useRef(null);
  const scanTimer = useRef(null);
  const isConnected = config.connected && config.apiKey;

  // persist
  useEffect(() => { saveTradeLog(tradeLog); }, [tradeLog]);
  useEffect(() => { saveExecuted(executedSignals); }, [executedSignals]);
  useEffect(() => {
    try { localStorage.setItem(AUTO_TRADE_KEY, JSON.stringify(autoTradeEnabled)); } catch {}
  }, [autoTradeEnabled]);
  useEffect(() => {
    try { localStorage.setItem("di_trade_settings", JSON.stringify(tradeSettings)); } catch {}
  }, [tradeSettings]);

  // ── 계좌 데이터 새로고침 ──
  const refreshData = useCallback(async () => {
    if (!config.apiKey) return;
    setLoading(true);
    try {
      const [acc, pos, ord, clk] = await Promise.allSettled([
        alpacaAPI("account", config),
        alpacaAPI("positions", config),
        alpacaAPI("orders", config, { status: "all", limit: "50" }),
        alpacaAPI("clock", config),
      ]);
      if (acc.status === "fulfilled") setAccount(acc.value);
      if (pos.status === "fulfilled") setPositions(Array.isArray(pos.value) ? pos.value : []);
      if (ord.status === "fulfilled") setOrders(Array.isArray(ord.value) ? ord.value : []);
      if (clk.status === "fulfilled") setClock(clk.value);
    } catch {}
    setLoading(false);
  }, [config]);

  useEffect(() => {
    if (isConnected) {
      refreshData();
      refreshTimer.current = setInterval(refreshData, 30000);
      return () => clearInterval(refreshTimer.current);
    }
  }, [isConnected, refreshData]);

  // ── 퀀트 전략 스캔 ──
  const runQuantScan = useCallback(async () => {
    if (scanning) return;
    setScanning(true);
    setScanProgress(0);

    try {
      const usSymbols = collectUSSymbols();
      const candleMap = await fetchCandleData(usSymbols, setScanProgress);
      const signals = detectSignals(candleMap);
      setDetectedSignals(signals);
      setLastScanTime(new Date());

      // 자동매매가 켜져 있으면 시그널 실행
      if (autoTradeEnabled && isConnected && signals.length > 0) {
        await executeAutoTrades(signals);
      }
    } catch (e) {
      console.error("Quant scan error:", e);
    }

    setScanning(false);
    setScanProgress(100);
  }, [scanning, autoTradeEnabled, isConnected, config, executedSignals, tradeSettings, account]);

  // ── 자동 주문 실행 ──
  const executeAutoTrades = async (signals) => {
    if (!account) return;
    const equity = parseFloat(account.equity || 0);
    const allocPerTrade = equity * (tradeSettings.allocationPct / 100);
    const currentPosCount = positions.length;

    let newExecuted = { ...executedSignals };
    let newLog = [...tradeLog];

    for (const sig of signals) {
      // 이미 실행한 시그널인지 체크 (중복 방지)
      if (newExecuted[sig.id]) continue;

      // 활성화된 전략인지 체크
      if (!tradeSettings.strategies.includes(sig.strategy)) continue;

      // 최대 포지션 수 체크 (BUY만)
      if (sig.type === "BUY" && currentPosCount >= tradeSettings.maxPositions) continue;

      // SELL 시그널: 해당 종목 보유 중일 때만
      if (sig.type === "SELL") {
        const hasPosition = positions.some(p => p.symbol === sig.symbol);
        if (!hasPosition) continue;
      }

      try {
        const orderParams = {
          symbol: sig.symbol,
          side: sig.type === "BUY" ? "buy" : "sell",
          type: tradeSettings.orderType || "market",
          time_in_force: "day",
        };

        if (sig.type === "BUY") {
          // 금액 기반 주문
          orderParams.notional = Math.max(1, Math.round(allocPerTrade));
        } else {
          // SELL: 보유 전량 청산
          const pos = positions.find(p => p.symbol === sig.symbol);
          orderParams.qty = pos ? parseFloat(pos.qty) : 1;
        }

        const order = await alpacaAPI("submit_order", config, orderParams);

        newExecuted[sig.id] = Date.now();
        newLog.unshift({
          time: new Date().toLocaleString("ko-KR"),
          symbol: sig.symbol,
          side: sig.type,
          strategy: sig.strategy,
          reason: sig.reason,
          amount: sig.type === "BUY" ? `$${Math.round(allocPerTrade)}` : `${orderParams.qty}주`,
          orderId: order.id,
          status: order.status,
        });
      } catch (e) {
        newExecuted[sig.id] = Date.now(); // 에러도 기록해서 재시도 방지
        newLog.unshift({
          time: new Date().toLocaleString("ko-KR"),
          symbol: sig.symbol,
          side: sig.type,
          strategy: sig.strategy,
          reason: sig.reason,
          error: e.message,
        });
      }
    }

    setExecutedSignals(newExecuted);
    setTradeLog(newLog.slice(0, 200));
    refreshData();
  };

  // ── 자동 스캔 타이머 (5분마다) ──
  useEffect(() => {
    if (autoTradeEnabled && isConnected && autoScanEnabled) {
      // 즉시 1회 실행
      runQuantScan();
      scanTimer.current = setInterval(runQuantScan, 5 * 60 * 1000);
      return () => clearInterval(scanTimer.current);
    }
    return () => { if (scanTimer.current) clearInterval(scanTimer.current); };
  }, [autoTradeEnabled, isConnected, autoScanEnabled]);

  // ── 주문 완료 콜백 ──
  const handleOrderPlaced = useCallback(() => {
    setTimeout(refreshData, 1000);
  }, [refreshData]);

  const closePosition = async (symbol) => {
    try {
      await alpacaAPI("close_position", config, { symbol });
      setTimeout(refreshData, 500);
    } catch (e) { alert("청산 실패: " + e.message); }
  };

  const cancelOrder = async (orderId) => {
    try {
      await alpacaAPI("cancel_order", config, { order_id: orderId });
      setTimeout(refreshData, 500);
    } catch (e) { alert("취소 실패: " + e.message); }
  };

  const disconnect = () => {
    setConfig({});
    saveAlpacaConfig({});
    setAccount(null);
    setPositions([]);
    setOrders([]);
  };

  if (!isConnected) {
    return <SetupPanel config={config} setConfig={setConfig} onConnect={(acc) => setAccount(acc)} />;
  }

  // ── 계산 ──
  const equity = parseFloat(account?.equity || 0);
  const cash = parseFloat(account?.cash || 0);
  const buyingPower = parseFloat(account?.buying_power || 0);
  const dayPL = parseFloat(account?.equity) - parseFloat(account?.last_equity || account?.equity);
  const dayPLPct = parseFloat(account?.last_equity) ? (dayPL / parseFloat(account.last_equity) * 100) : 0;
  const totalPL = equity - 100000;
  const totalPLPct = (totalPL / 100000) * 100;
  const positionPL = positions.reduce((sum, p) => sum + parseFloat(p.unrealized_pl || 0), 0);
  const openOrders = orders.filter(o => ["new", "accepted", "pending_new", "partially_filled"].includes(o.status));
  const filledOrders = orders.filter(o => o.status === "filled");
  const marketOpen = clock?.is_open;

  const buySignals = detectedSignals.filter(s => s.type === "BUY");
  const sellSignals = detectedSignals.filter(s => s.type === "SELL");

  return (
    <div className="tab-content">
      {orderModal && (
        <OrderModal
          symbol={orderModal.symbol} side={orderModal.side} reason={orderModal.reason}
          config={config} onClose={() => setOrderModal(null)} onOrderPlaced={handleOrderPlaced}
        />
      )}

      {/* ── 상단 계좌 요약 ── */}
      <div style={{ background: `linear-gradient(135deg, ${C.card} 0%, #0D1B2A 100%)`,
        border: `1px solid ${C.border}`, borderRadius: "16px", padding: "20px", marginBottom: "12px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
              <span style={{ fontWeight: 800, fontSize: "18px" }}>퀀트 자동매매</span>
              <span style={{ padding: "2px 8px", borderRadius: "4px", fontSize: "10px", fontWeight: 700,
                background: config.isPaper ? C.yellowBg : C.greenBg, color: config.isPaper ? C.yellow : C.green }}>
                {config.isPaper ? "PAPER" : "LIVE"}
              </span>
              <span style={{ padding: "2px 8px", borderRadius: "4px", fontSize: "10px", fontWeight: 700,
                background: marketOpen ? C.greenBg : C.redBg, color: marketOpen ? C.green : C.red }}>
                {marketOpen ? "장중" : "장 마감"}
              </span>
              {autoTradeEnabled && (
                <span style={{ padding: "2px 8px", borderRadius: "4px", fontSize: "10px", fontWeight: 700,
                  background: C.purpleBg, color: C.purple, animation: "pulse 2s infinite" }}>AUTO</span>
              )}
            </div>
            <div style={{ fontSize: "11px", color: C.text3 }}>
              {loading ? "갱신 중..." : "30초 자동 갱신"}
              {lastScanTime && ` · 마지막 스캔 ${lastScanTime.toLocaleTimeString("ko-KR")}`}
            </div>
          </div>
          <div style={{ display: "flex", gap: "6px" }}>
            <button onClick={refreshData} style={{
              padding: "6px 12px", borderRadius: "8px", fontSize: "11px", fontWeight: 600,
              background: C.card2, border: `1px solid ${C.border2}`, color: C.text2, cursor: "pointer",
            }}>새로고침</button>
            <button onClick={disconnect} style={{
              padding: "6px 12px", borderRadius: "8px", fontSize: "11px", fontWeight: 600,
              background: C.redBg, border: `1px solid ${C.red}33`, color: C.red, cursor: "pointer",
            }}>연결 해제</button>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: "8px" }}>
          {[
            { label: "총 자산", value: fmtUSD(equity), color: C.text1 },
            { label: "현금", value: fmtUSD(cash), color: C.blue },
            { label: "매수 가능액", value: fmtUSD(buyingPower), color: C.blueL },
            { label: "오늘 P&L", value: fmtUSD(dayPL), sub: fmtPct(dayPLPct), color: dayPL >= 0 ? C.green : C.red },
            { label: "총 수익", value: fmtUSD(totalPL), sub: fmtPct(totalPLPct), color: totalPL >= 0 ? C.green : C.red },
            { label: "포지션 P&L", value: fmtUSD(positionPL), color: positionPL >= 0 ? C.green : C.red },
          ].map((m, i) => (
            <div key={i} style={{ background: C.card2, borderRadius: "10px", padding: "10px 12px" }}>
              <div style={{ fontSize: "10px", color: C.text3, marginBottom: "2px" }}>{m.label}</div>
              <div style={{ fontWeight: 800, fontSize: "16px", color: m.color }}>{m.value}</div>
              {m.sub && <div style={{ fontSize: "10px", color: m.color }}>{m.sub}</div>}
            </div>
          ))}
        </div>
      </div>

      {/* ── 탭 네비게이션 ── */}
      <div style={{ display: "flex", gap: "4px", marginBottom: "12px", overflowX: "auto" }}>
        {[
          ["dashboard", "포지션", positions.length],
          ["orders", "주문 내역", orders.length],
          ["signals", "전략 시그널", detectedSignals.length],
          ["auto", "자동매매 설정", null],
          ["log", "실행 로그", tradeLog.length],
        ].map(([id, label, count]) => (
          <button key={id} onClick={() => setActiveTab(id)} style={{
            padding: "8px 14px", borderRadius: "8px", fontSize: "12px", fontWeight: 600,
            background: activeTab === id ? C.blueBg : "transparent",
            color: activeTab === id ? C.blue : C.text3,
            border: `1px solid ${activeTab === id ? C.blue : C.border2}`,
            cursor: "pointer", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: "6px",
          }}>
            {label}
            {count != null && count > 0 && (
              <span style={{ background: activeTab === id ? C.blue : C.border2, color: activeTab === id ? "#fff" : C.text3,
                fontSize: "10px", fontWeight: 700, borderRadius: "50%", width: "18px", height: "18px",
                display: "flex", alignItems: "center", justifyContent: "center" }}>{count > 99 ? "99+" : count}</span>
            )}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button onClick={() => setOrderModal({ symbol: "", side: "buy", reason: "수동 주문" })} style={{
          padding: "8px 14px", borderRadius: "8px", fontSize: "12px", fontWeight: 700,
          background: `linear-gradient(135deg, ${C.blue}, #2563EB)`, color: "#fff",
          border: "none", cursor: "pointer", whiteSpace: "nowrap",
        }}>+ 주문</button>
      </div>

      {/* ── 포지션 탭 ── */}
      {activeTab === "dashboard" && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "16px", padding: "20px" }}>
          <div style={{ fontWeight: 700, marginBottom: "16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>보유 포지션 ({positions.length})</span>
            {positions.length > 0 && (
              <button onClick={async () => {
                if (confirm("모든 포지션을 청산하시겠습니까?")) {
                  await alpacaAPI("close_all", config);
                  setTimeout(refreshData, 1000);
                }
              }} style={{ fontSize: "11px", color: C.red, background: "none", border: "none", cursor: "pointer" }}>전체 청산</button>
            )}
          </div>
          {positions.length === 0 ? (
            <div style={{ textAlign: "center", padding: "40px 0", color: C.text3 }}>
              <div style={{ fontSize: "40px", marginBottom: "8px" }}>📭</div>
              <div>보유 중인 포지션이 없습니다</div>
              <div style={{ fontSize: "12px", marginTop: "4px" }}>자동매매를 켜고 전략 스캔을 실행하세요</div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              {positions.map((p, i) => {
                const pl = parseFloat(p.unrealized_pl || 0);
                const plPct = parseFloat(p.unrealized_plpc || 0) * 100;
                const mktVal = parseFloat(p.market_value || 0);
                const qty = parseFloat(p.qty || 0);
                const avgEntry = parseFloat(p.avg_entry_price || 0);
                const currentPrice = parseFloat(p.current_price || 0);
                return (
                  <div key={i} style={{ background: C.card2, borderRadius: "10px", padding: "12px",
                    borderLeft: `3px solid ${pl >= 0 ? C.green : C.red}` }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                      <div>
                        <span style={{ fontWeight: 700, fontSize: "14px", marginRight: "8px" }}>{p.symbol}</span>
                        <span style={{ fontSize: "11px", color: C.text3 }}>{qty}주 · 평단 ${fmt(avgEntry)}</span>
                      </div>
                      <div style={{ display: "flex", gap: "4px" }}>
                        <button onClick={() => setOrderModal({ symbol: p.symbol, side: "buy", reason: "추가 매수" })} style={{
                          padding: "4px 8px", borderRadius: "6px", fontSize: "10px", fontWeight: 700,
                          background: C.redBg, color: C.red, border: "none", cursor: "pointer",
                        }}>매수</button>
                        <button onClick={() => closePosition(p.symbol)} style={{
                          padding: "4px 8px", borderRadius: "6px", fontSize: "10px", fontWeight: 700,
                          background: C.blueBg, color: C.blue, border: "none", cursor: "pointer",
                        }}>청산</button>
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: "16px", fontSize: "12px", flexWrap: "wrap" }}>
                      <span style={{ color: C.text3 }}>현재가 <b style={{ color: C.text1 }}>${fmt(currentPrice)}</b></span>
                      <span style={{ color: C.text3 }}>평가액 <b style={{ color: C.text1 }}>${fmt(mktVal)}</b></span>
                      <span style={{ color: C.text3 }}>P&L <b style={{ color: pl >= 0 ? C.green : C.red }}>
                        {fmtUSD(pl)} ({fmtPct(plPct)})
                      </b></span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── 주문 내역 탭 ── */}
      {activeTab === "orders" && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "16px", padding: "20px" }}>
          {openOrders.length > 0 && (
            <>
              <div style={{ fontWeight: 700, marginBottom: "12px", display: "flex", justifyContent: "space-between" }}>
                <span>미체결 주문 ({openOrders.length})</span>
                <button onClick={async () => {
                  await alpacaAPI("cancel_all", config);
                  setTimeout(refreshData, 500);
                }} style={{ fontSize: "11px", color: C.red, background: "none", border: "none", cursor: "pointer" }}>전체 취소</button>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "20px" }}>
                {openOrders.map((o, i) => (
                  <div key={i} style={{ background: C.card2, borderRadius: "10px", padding: "12px",
                    display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "2px" }}>
                        <span style={{ padding: "2px 6px", borderRadius: "4px", fontSize: "10px", fontWeight: 700,
                          background: o.side === "buy" ? C.redBg : C.blueBg,
                          color: o.side === "buy" ? C.red : C.blue }}>{o.side === "buy" ? "매수" : "매도"}</span>
                        <span style={{ fontWeight: 700 }}>{o.symbol}</span>
                        <span style={{ fontSize: "11px", color: C.text3 }}>{o.qty || o.notional}{o.qty ? "주" : "$"}</span>
                      </div>
                      <div style={{ fontSize: "11px", color: C.text3 }}>
                        {o.type === "limit" ? `지정가 $${o.limit_price}` : "시장가"} · {o.status}
                      </div>
                    </div>
                    <button onClick={() => cancelOrder(o.id)} style={{
                      padding: "4px 8px", borderRadius: "6px", fontSize: "10px",
                      background: C.redBg, color: C.red, border: "none", cursor: "pointer",
                    }}>취소</button>
                  </div>
                ))}
              </div>
            </>
          )}
          <div style={{ fontWeight: 700, marginBottom: "12px" }}>체결 내역 ({filledOrders.length})</div>
          {filledOrders.length === 0 ? (
            <div style={{ textAlign: "center", padding: "30px 0", color: C.text3 }}>체결 내역이 없습니다</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "4px", maxHeight: "400px", overflow: "auto" }}>
              {filledOrders.map((o, i) => (
                <div key={i} style={{ background: C.card2, borderRadius: "8px", padding: "10px 12px",
                  display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span style={{ padding: "2px 6px", borderRadius: "4px", fontSize: "10px", fontWeight: 700,
                      background: o.side === "buy" ? C.redBg : C.blueBg,
                      color: o.side === "buy" ? C.red : C.blue }}>{o.side === "buy" ? "매수" : "매도"}</span>
                    <span style={{ fontWeight: 600, fontSize: "13px" }}>{o.symbol}</span>
                    <span style={{ fontSize: "11px", color: C.text3 }}>{o.filled_qty}주 @ ${fmt(parseFloat(o.filled_avg_price || 0))}</span>
                  </div>
                  <span style={{ fontSize: "10px", color: C.text3 }}>{new Date(o.filled_at || o.created_at).toLocaleDateString("ko-KR")}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── 전략 시그널 탭 ── */}
      {activeTab === "signals" && (
        <div>
          {/* 스캔 컨트롤 */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "16px", padding: "20px", marginBottom: "12px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: "15px" }}>퀀트 전략 스캔</div>
                <div style={{ fontSize: "12px", color: C.text3, marginTop: "2px" }}>
                  {Object.keys(STRATEGY_PORTFOLIOS).length}개 전략 · {collectUSSymbols().length}개 US 종목 실시간 분석
                </div>
              </div>
              <button onClick={runQuantScan} disabled={scanning} style={{
                padding: "10px 20px", borderRadius: "10px", fontSize: "13px", fontWeight: 700,
                background: scanning ? C.card2 : `linear-gradient(135deg, ${C.purple}, #6D28D9)`,
                color: "#fff", border: "none", cursor: scanning ? "default" : "pointer",
              }}>
                {scanning ? `스캔 중... ${scanProgress}%` : "전략 스캔 실행"}
              </button>
            </div>

            {scanning && (
              <div style={{ height: "4px", background: C.border, borderRadius: "2px", overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${scanProgress}%`, background: `linear-gradient(90deg, ${C.purple}, ${C.blue})`,
                  borderRadius: "2px", transition: "width 0.3s" }} />
              </div>
            )}
          </div>

          {/* 시그널 목록 */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "16px", padding: "20px" }}>
            <div style={{ display: "flex", gap: "12px", marginBottom: "16px" }}>
              <span style={{ fontWeight: 700 }}>감지된 시그널 ({detectedSignals.length})</span>
              {buySignals.length > 0 && (
                <span style={{ fontSize: "12px", color: C.red, fontWeight: 600 }}>매수 {buySignals.length}</span>
              )}
              {sellSignals.length > 0 && (
                <span style={{ fontSize: "12px", color: C.blue, fontWeight: 600 }}>매도 {sellSignals.length}</span>
              )}
            </div>

            {detectedSignals.length === 0 ? (
              <div style={{ textAlign: "center", padding: "40px 0", color: C.text3 }}>
                <div style={{ fontSize: "40px", marginBottom: "8px" }}>📡</div>
                <div>시그널이 없습니다</div>
                <div style={{ fontSize: "12px", marginTop: "4px" }}>위의 "전략 스캔 실행" 버튼으로 퀀트 전략을 분석하세요</div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "6px", maxHeight: "500px", overflow: "auto" }}>
                {detectedSignals.slice(0, 60).map((sig, i) => {
                  const isBuy = sig.type === "BUY";
                  const wasExecuted = executedSignals[sig.id];
                  return (
                    <div key={i} style={{ background: C.card2, borderRadius: "10px", padding: "12px",
                      borderLeft: `3px solid ${isBuy ? C.red : C.blue}`,
                      opacity: wasExecuted ? 0.5 : 1 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                          <span style={{ padding: "2px 6px", borderRadius: "4px", fontSize: "10px", fontWeight: 700,
                            background: isBuy ? C.redBg : C.blueBg, color: isBuy ? C.red : C.blue }}>
                            {isBuy ? "매수" : "매도"}
                          </span>
                          <span style={{ fontWeight: 700 }}>{sig.symbol}</span>
                          <span style={{ fontSize: "10px", color: C.purple }}>{sig.strategyIcon} {sig.strategy}</span>
                          {wasExecuted && <span style={{ fontSize: "9px", color: C.green, fontWeight: 700 }}>실행됨</span>}
                        </div>
                        {!wasExecuted && (
                          <button onClick={() => setOrderModal({
                            symbol: sig.symbol,
                            side: isBuy ? "buy" : "sell",
                            reason: `${sig.strategy}: ${sig.reason}`,
                          })} style={{
                            padding: "5px 10px", borderRadius: "6px", fontSize: "11px", fontWeight: 700,
                            background: isBuy ? C.red : C.blue, color: "#fff",
                            border: "none", cursor: "pointer",
                          }}>주문</button>
                        )}
                      </div>
                      <div style={{ fontSize: "11px", color: C.text3 }}>
                        {sig.reason} · ${fmt(sig.price)} · 비중 {(sig.weight * 100).toFixed(0)}%
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── 자동매매 설정 탭 ── */}
      {activeTab === "auto" && (
        <div>
          {/* 메인 토글 */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "16px", padding: "20px", marginBottom: "12px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: "15px" }}>퀀트 전략 자동매매</div>
                <div style={{ fontSize: "12px", color: C.text3, marginTop: "2px" }}>
                  전략 시그널 감지 시 포트폴리오 비중에 따라 자동 주문 실행
                </div>
              </div>
              <button onClick={() => setAutoTradeEnabled(!autoTradeEnabled)} style={{
                width: "52px", height: "28px", borderRadius: "14px", border: "none", cursor: "pointer",
                background: autoTradeEnabled ? C.green : C.border2,
                position: "relative", transition: "background 0.2s",
              }}>
                <div style={{
                  width: "22px", height: "22px", borderRadius: "50%", background: "#fff",
                  position: "absolute", top: "3px",
                  left: autoTradeEnabled ? "27px" : "3px", transition: "left 0.2s",
                }} />
              </button>
            </div>

            {autoTradeEnabled && (
              <div style={{ background: C.greenBg, border: `1px solid ${C.green}33`, borderRadius: "10px",
                padding: "12px", fontSize: "12px", color: C.green, marginBottom: "12px" }}>
                자동매매가 활성화되었습니다. 전략 스캔 시 감지되는 시그널에 대해 설정된 비중으로 자동 주문이 실행됩니다.
              </div>
            )}

            {/* 자동 스캔 */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "12px", background: C.card2, borderRadius: "10px" }}>
              <div>
                <div style={{ fontSize: "13px", fontWeight: 600 }}>자동 스캔 (5분 간격)</div>
                <div style={{ fontSize: "11px", color: C.text3 }}>전략 스캔을 5분마다 자동 실행</div>
              </div>
              <button onClick={() => setAutoScanEnabled(!autoScanEnabled)} style={{
                width: "44px", height: "24px", borderRadius: "12px", border: "none", cursor: "pointer",
                background: autoScanEnabled ? C.blue : C.border2,
                position: "relative", transition: "background 0.2s",
              }}>
                <div style={{
                  width: "18px", height: "18px", borderRadius: "50%", background: "#fff",
                  position: "absolute", top: "3px",
                  left: autoScanEnabled ? "23px" : "3px", transition: "left 0.2s",
                }} />
              </button>
            </div>
          </div>

          {/* 매매 설정 */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "16px", padding: "20px", marginBottom: "12px" }}>
            <div style={{ fontWeight: 700, fontSize: "15px", marginBottom: "16px" }}>매매 설정</div>

            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              {/* 1건당 배분 비율 */}
              <div>
                <label style={{ fontSize: "12px", color: C.text3, fontWeight: 600, display: "block", marginBottom: "6px" }}>
                  1건당 투자 비율 (총 자산 대비)
                </label>
                <div style={{ display: "flex", gap: "4px" }}>
                  {[1, 2, 3, 5, 10].map(pct => (
                    <button key={pct} onClick={() => setTradeSettings(p => ({ ...p, allocationPct: pct }))} style={{
                      flex: 1, padding: "8px", borderRadius: "8px", fontSize: "12px", fontWeight: 600,
                      background: tradeSettings.allocationPct === pct ? C.blueBg : "transparent",
                      color: tradeSettings.allocationPct === pct ? C.blue : C.text3,
                      border: `1px solid ${tradeSettings.allocationPct === pct ? C.blue : C.border2}`, cursor: "pointer",
                    }}>{pct}%</button>
                  ))}
                </div>
                <div style={{ fontSize: "11px", color: C.text3, marginTop: "4px" }}>
                  현재 기준: 1건당 약 {fmtUSD(equity * tradeSettings.allocationPct / 100)}
                </div>
              </div>

              {/* 최대 포지션 수 */}
              <div>
                <label style={{ fontSize: "12px", color: C.text3, fontWeight: 600, display: "block", marginBottom: "6px" }}>
                  최대 동시 포지션 수
                </label>
                <div style={{ display: "flex", gap: "4px" }}>
                  {[10, 15, 20, 30, 50].map(n => (
                    <button key={n} onClick={() => setTradeSettings(p => ({ ...p, maxPositions: n }))} style={{
                      flex: 1, padding: "8px", borderRadius: "8px", fontSize: "12px", fontWeight: 600,
                      background: tradeSettings.maxPositions === n ? C.blueBg : "transparent",
                      color: tradeSettings.maxPositions === n ? C.blue : C.text3,
                      border: `1px solid ${tradeSettings.maxPositions === n ? C.blue : C.border2}`, cursor: "pointer",
                    }}>{n}개</button>
                  ))}
                </div>
              </div>

              {/* 주문 유형 */}
              <div>
                <label style={{ fontSize: "12px", color: C.text3, fontWeight: 600, display: "block", marginBottom: "6px" }}>
                  주문 유형
                </label>
                <div style={{ display: "flex", gap: "4px" }}>
                  {[["market", "시장가"], ["limit", "지정가"]].map(([id, label]) => (
                    <button key={id} onClick={() => setTradeSettings(p => ({ ...p, orderType: id }))} style={{
                      flex: 1, padding: "8px", borderRadius: "8px", fontSize: "12px", fontWeight: 600,
                      background: tradeSettings.orderType === id ? C.blueBg : "transparent",
                      color: tradeSettings.orderType === id ? C.blue : C.text3,
                      border: `1px solid ${tradeSettings.orderType === id ? C.blue : C.border2}`, cursor: "pointer",
                    }}>{label}</button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* 활성 전략 선택 */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "16px", padding: "20px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: "15px" }}>활성 전략</div>
                <div style={{ fontSize: "12px", color: C.text3, marginTop: "2px" }}>
                  {tradeSettings.strategies.length}/{Object.keys(STRATEGY_PORTFOLIOS).length}개 전략 활성
                </div>
              </div>
              <button onClick={() => {
                const allKeys = Object.keys(STRATEGY_PORTFOLIOS);
                const allActive = tradeSettings.strategies.length === allKeys.length;
                setTradeSettings(p => ({ ...p, strategies: allActive ? [] : allKeys }));
              }} style={{
                fontSize: "11px", color: C.blue, background: "none", border: "none", cursor: "pointer",
              }}>
                {tradeSettings.strategies.length === Object.keys(STRATEGY_PORTFOLIOS).length ? "전체 해제" : "전체 선택"}
              </button>
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
              {Object.keys(STRATEGY_PORTFOLIOS).map(name => {
                const strat = STRATEGY_MAP[name];
                const active = tradeSettings.strategies.includes(name);
                return (
                  <button key={name} onClick={() => {
                    setTradeSettings(p => ({
                      ...p,
                      strategies: active
                        ? p.strategies.filter(s => s !== name)
                        : [...p.strategies, name],
                    }));
                  }} style={{
                    padding: "6px 10px", borderRadius: "8px", fontSize: "11px", fontWeight: 600,
                    background: active ? C.purpleBg : "transparent",
                    color: active ? C.purple : C.text3,
                    border: `1px solid ${active ? C.purple + "55" : C.border2}`,
                    cursor: "pointer",
                  }}>
                    {strat?.icon || "📊"} {name}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── 실행 로그 탭 ── */}
      {activeTab === "log" && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "16px", padding: "20px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
            <span style={{ fontWeight: 700 }}>자동매매 실행 로그 ({tradeLog.length})</span>
            {tradeLog.length > 0 && (
              <button onClick={() => setTradeLog([])} style={{
                fontSize: "11px", color: C.red, background: "none", border: "none", cursor: "pointer",
              }}>전체 삭제</button>
            )}
          </div>
          {tradeLog.length === 0 ? (
            <div style={{ textAlign: "center", padding: "30px 0", color: C.text3 }}>
              실행 기록이 없습니다
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "4px", maxHeight: "500px", overflow: "auto" }}>
              {tradeLog.map((log, i) => (
                <div key={i} style={{ background: C.card2, borderRadius: "8px", padding: "10px 12px",
                  borderLeft: `3px solid ${log.error ? C.red : C.green}` }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "2px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <span style={{ padding: "2px 6px", borderRadius: "4px", fontSize: "10px", fontWeight: 700,
                        background: log.side === "BUY" ? C.redBg : C.blueBg,
                        color: log.side === "BUY" ? C.red : C.blue }}>{log.side === "BUY" ? "매수" : "매도"}</span>
                      <span style={{ fontWeight: 700, fontSize: "13px" }}>{log.symbol}</span>
                      {log.amount && <span style={{ fontSize: "10px", color: C.text2 }}>{log.amount}</span>}
                      {log.strategy && <span style={{ fontSize: "10px", color: C.purple }}>{log.strategy}</span>}
                    </div>
                    <span style={{ fontSize: "10px", color: C.text3 }}>{log.time}</span>
                  </div>
                  {log.reason && <div style={{ fontSize: "10px", color: C.text3, marginBottom: "2px" }}>{log.reason}</div>}
                  {log.error ? (
                    <div style={{ fontSize: "11px", color: C.red }}>{log.error}</div>
                  ) : (
                    <div style={{ fontSize: "11px", color: C.green }}>{log.status} · ID: {log.orderId?.slice(0, 12)}...</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
