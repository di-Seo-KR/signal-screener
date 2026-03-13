// DI금융 — 퀀트 전략 기반 자동매매 시스템 v3.0 (Production-Grade)
// 리스크 관리 · 브래킷 주문 · 드로다운 보호 · 시그널 신뢰도 · 변동성 사이징
// Alpaca Trading API 연동 (Paper / Live)
import React, { useState, useEffect, useCallback, useRef } from "react";
import { ALL_STRATEGIES } from "./strategies.js";
import { STRATEGY_PORTFOLIOS as RAW_PORTFOLIOS } from "./QuantPortfolio.jsx";

const C = {
  bg: "#070C14", card: "#0F1825", card2: "#141E2E",
  border: "#1A2535", border2: "#243044",
  blue: "#3182F6", blueL: "#5AA3FF", blueBg: "#1A2C4F",
  red: "#F04452", redBg: "#2A1520",
  green: "#05C072", greenBg: "#0A2A1A",
  yellow: "#FFB400", yellowBg: "#2A2000",
  purple: "#8B5CF6", purpleBg: "#1E1535",
  orange: "#FF6B2C", orangeBg: "#2A1A0A",
  text1: "#F2F4F7", text2: "#A0AEBF", text3: "#5A6880",
};

// ══════════════════════════════════════════════════════════════
// 섹터 분류
// ══════════════════════════════════════════════════════════════
const SECTOR_MAP = {
  AAPL: "Tech", MSFT: "Tech", NVDA: "Tech", AMD: "Tech", AVGO: "Tech", INTC: "Tech",
  QCOM: "Tech", MU: "Tech", MRVL: "Tech", LRCX: "Tech", AMAT: "Tech", KLAC: "Tech",
  SNPS: "Tech", CDNS: "Tech", META: "Tech", GOOG: "Tech", GOOGL: "Tech",
  AMZN: "Consumer", TSLA: "Consumer", NFLX: "Consumer", DIS: "Consumer", NKE: "Consumer",
  SBUX: "Consumer", MCD: "Consumer", COST: "Consumer", WMT: "Consumer", HD: "Consumer",
  SHOP: "Consumer", ABNB: "Consumer", UBER: "Consumer", DASH: "Consumer",
  JPM: "Finance", GS: "Finance", MS: "Finance", BAC: "Finance", WFC: "Finance",
  BLK: "Finance", SCHW: "Finance", V: "Finance", MA: "Finance", COIN: "Finance",
  SQ: "Finance", PYPL: "Finance",
  JNJ: "Health", UNH: "Health", LLY: "Health", ABBV: "Health", TMO: "Health",
  MRK: "Health", PG: "Health", DHR: "Health",
  XOM: "Energy", CVX: "Energy", COP: "Energy",
  BA: "Industrial", CAT: "Industrial", GE: "Industrial", RTX: "Industrial", LMT: "Industrial",
  CRM: "Tech", ORCL: "Tech", NOW: "Tech", PANW: "Tech", CRWD: "Tech",
  DDOG: "Tech", NET: "Tech", SNOW: "Tech", ZS: "Tech", MSTR: "Tech",
  KO: "Consumer", PEP: "Consumer",
  SPY: "ETF", QQQ: "ETF", IWM: "ETF", DIA: "ETF", GLD: "ETF", SLV: "ETF",
  TLT: "ETF", XLE: "ETF", XLF: "ETF", XLK: "ETF", XLV: "ETF", XLI: "ETF",
  ARKK: "ETF", SOXX: "ETF", SMH: "ETF", VNQ: "ETF", KWEB: "ETF",
};

// ══════════════════════════════════════════════════════════════
// 전략 신뢰도 등급 (단일지표 < 복합지표 < 삼중필터)
// ══════════════════════════════════════════════════════════════
const STRATEGY_CONFIDENCE = {
  "RSI 반전 전략": 0.4,
  "볼린저밴드 바운스": 0.4,
  "MACD 크로스오버": 0.5,
  "이평선 크로스 (20/60)": 0.5,
  "거래량 돌파 전략": 0.6,
  "스토캐스틱+RSI 콤보": 0.7,
  "켈트너 채널 회귀": 0.5,
  "VWAP 반전": 0.5,
  "터틀 트레이딩": 0.7,
  "듀얼 모멘텀": 0.7,
  "슈퍼트렌드": 0.6,
  "파라볼릭 SAR": 0.5,
  "ATR 스윙": 0.6,
  "피보나치 되돌림": 0.5,
  "통계적 차익 (Z-Score)": 0.6,
  "래리 코너스 RSI(2)": 0.4,
  "MFI 자금유입": 0.6,
  "캔들 패턴 (엔궐핑)": 0.5,
  "Williams %R + ADX": 0.6,
  "삼중 이평선 + ATR 정지": 0.7,
  "일목균형표": 0.6,
  "OBV 추세 추종": 0.6,
  "레짐 전환 적응형": 0.8,
  "헤이킨 아시 추세": 0.6,
  "듀얼 타임프레임 모멘텀": 0.7,
  "엘더 삼중 필터": 0.8,
  "MACD 다이버전스": 0.6,
  "갭 앤 고": 0.5,
  "모멘텀·거래량 가중": 0.6,
  "CCI 오실레이터": 0.5,
  "채널 돌파 모멘텀": 0.7,
  "BB 스퀴즈 돌파": 0.6,
};

// ══════════════════════════════════════════════════════════════
// QuantPortfolio 원본 32개 전략에서 US 종목만 자동 추출 + 비중 정규화
// .KS(한국) / -USD(크립토) 제외 → Alpaca 거래 가능 종목만
// ══════════════════════════════════════════════════════════════
const STRATEGY_PORTFOLIOS = (() => {
  const result = {};
  for (const [name, holdings] of Object.entries(RAW_PORTFOLIOS)) {
    const usOnly = holdings.filter(h => !h.sym.includes(".KS") && !h.sym.includes("-USD"));
    if (usOnly.length === 0) continue;
    // 비중 정규화 (US 종목만 남기면 합이 1이 안 되므로)
    const totalW = usOnly.reduce((s, h) => s + h.w, 0);
    result[name] = usOnly.map(h => ({ sym: h.sym, w: h.w / totalW }));
  }
  return result;
})();

const STRATEGY_MAP = {};
ALL_STRATEGIES.forEach(s => { STRATEGY_MAP[s.name] = s; });

function collectUSSymbols() {
  const syms = new Set();
  for (const holdings of Object.values(STRATEGY_PORTFOLIOS)) {
    for (const { sym } of holdings) syms.add(sym);
  }
  return [...syms];
}

// ══════════════════════════════════════════════════════════════
// Storage
// ══════════════════════════════════════════════════════════════
const KEYS = {
  config: "di_alpaca_config",
  autoTrade: "di_auto_trade_v3",
  tradeLog: "di_trade_log_v3",
  executed: "di_executed_v3",
  settings: "di_trade_settings_v3",
  riskState: "di_risk_state",
  peakEquity: "di_peak_equity",
};

function load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch { return fallback; }
}
function save(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}

// ══════════════════════════════════════════════════════════════
// Alpaca API (with retry + backoff)
// ══════════════════════════════════════════════════════════════
async function alpacaAPI(action, config, params = {}, retries = 2) {
  const { apiKey, apiSecret, isPaper = true } = config;
  if (!apiKey || !apiSecret) throw new Error("API 키 미설정");
  const isPost = ["submit_order"].includes(action);
  const queryParams = isPost ? `action=${action}` : new URLSearchParams({ action, ...params }).toString();

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const ctrl = new AbortController();
      const tmr = setTimeout(() => ctrl.abort(), 15000);
      const res = await fetch(`/api/alpaca?${queryParams}`, {
        method: isPost ? "POST" : "GET",
        headers: {
          "Content-Type": "application/json",
          "x-alpaca-key": apiKey,
          "x-alpaca-secret": apiSecret,
          "x-alpaca-paper": String(isPaper),
        },
        body: isPost ? JSON.stringify(params) : undefined,
        signal: ctrl.signal,
      }).finally(() => clearTimeout(tmr));

      const data = await res.json();
      if (res.status === 429 && attempt < retries) {
        await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
        continue;
      }
      if (!res.ok) throw new Error(data.message || data.error || `API Error ${res.status}`);
      return data;
    } catch (e) {
      if (attempt === retries) throw e;
      if (e.name === "AbortError") throw new Error("요청 타임아웃");
      await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
}

// ══════════════════════════════════════════════════════════════
// Yahoo Finance 캔들 + ATR 계산
// ══════════════════════════════════════════════════════════════
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
    if (done < symbols.length) await new Promise(r => setTimeout(r, 300));
  }
  return results;
}

// ATR 계산 (14일)
function calcATR(candles, period = 14) {
  if (candles.length < period + 1) return 0;
  let atr = 0;
  for (let i = candles.length - period; i < candles.length; i++) {
    const prev = candles[i - 1];
    const c = candles[i];
    const tr = Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close));
    atr += tr;
  }
  return atr / period;
}

// ══════════════════════════════════════════════════════════════
// 시그널 감지 + 신뢰도 점수
// ══════════════════════════════════════════════════════════════
function detectSignals(candleMap) {
  const signals = [];
  const now = Date.now();

  for (const [stratName, holdings] of Object.entries(STRATEGY_PORTFOLIOS)) {
    const strategy = STRATEGY_MAP[stratName];
    if (!strategy?.generate) continue;
    const confidence = STRATEGY_CONFIDENCE[stratName] || 0.5;

    for (const { sym, w } of holdings) {
      const candles = candleMap[sym];
      if (!candles || candles.length < 30) continue;

      try {
        const sigs = strategy.generate(candles);
        if (!sigs?.length) continue;

        // 최근 3 캔들만 (더 엄격: 이전엔 5)
        const recent = sigs.filter(s => s.index >= candles.length - 3);
        for (const sig of recent) {
          const candle = candles[sig.index] || candles[candles.length - 1];
          const atr = calcATR(candles);
          const lastPrice = candles[candles.length - 1].close;

          // 시그널 나이 (0=오늘, 1=어제, 2=그저께)
          const signalAge = candles.length - 1 - sig.index;
          // 시그널이 오래될수록 감점
          const agePenalty = 1 - (signalAge * 0.15);
          const finalConfidence = Math.max(0.1, confidence * agePenalty);

          signals.push({
            id: `${stratName}-${sym}-${sig.type}-${candle.time}`,
            strategy: stratName,
            strategyIcon: strategy.icon || "📊",
            category: strategy.category || "",
            symbol: sym,
            sector: SECTOR_MAP[sym] || "Other",
            type: sig.type,
            price: lastPrice,
            signalPrice: sig.price || candle.close,
            reason: sig.reason || `${stratName} ${sig.type}`,
            weight: w,
            confidence: finalConfidence,
            atr: atr,
            atrPct: lastPrice > 0 ? (atr / lastPrice) * 100 : 0,
            time: candle.time,
            detectedAt: now,
            signalAge,
          });
        }
      } catch {}
    }
  }

  // 신뢰도 높은 순 → 최신 순
  signals.sort((a, b) => b.confidence - a.confidence || b.time - a.time);
  return signals;
}

// ══════════════════════════════════════════════════════════════
// 리스크 관리 엔진
// ══════════════════════════════════════════════════════════════
class RiskManager {
  constructor(settings, account, positions) {
    this.s = settings;
    this.equity = parseFloat(account?.equity || 0);
    this.cash = parseFloat(account?.cash || 0);
    this.positions = positions || [];
    this.peakEquity = Math.max(load(KEYS.peakEquity, 100000), this.equity);
    save(KEYS.peakEquity, this.peakEquity);
  }

  // 현재 드로다운 %
  get drawdown() {
    return this.peakEquity > 0 ? ((this.peakEquity - this.equity) / this.peakEquity) * 100 : 0;
  }

  // 일일 P&L % (last_equity 대비)
  dailyPL(account) {
    const lastEq = parseFloat(account?.last_equity || account?.equity || 0);
    return lastEq > 0 ? ((this.equity - lastEq) / lastEq) * 100 : 0;
  }

  // 드로다운 보호: 최대 드로다운 초과 시 거래 중단
  isDrawdownBreached() {
    return this.drawdown >= (this.s.maxDrawdownPct || 10);
  }

  // 일일 손실 한도 체크
  isDailyLossBreached(account) {
    const dailyPct = this.dailyPL(account);
    return dailyPct <= -(this.s.maxDailyLossPct || 3);
  }

  // 섹터 집중도 체크
  getSectorExposure() {
    const sectorVal = {};
    const totalVal = this.positions.reduce((s, p) => s + Math.abs(parseFloat(p.market_value || 0)), 0);
    for (const p of this.positions) {
      const sector = SECTOR_MAP[p.symbol] || "Other";
      sectorVal[sector] = (sectorVal[sector] || 0) + Math.abs(parseFloat(p.market_value || 0));
    }
    const result = {};
    for (const [sec, val] of Object.entries(sectorVal)) {
      result[sec] = totalVal > 0 ? (val / totalVal) * 100 : 0;
    }
    return result;
  }

  canAddToSector(symbol) {
    const sector = SECTOR_MAP[symbol] || "Other";
    if (sector === "ETF") return true; // ETF는 제한 없음
    const exposure = this.getSectorExposure();
    return (exposure[sector] || 0) < (this.s.maxSectorPct || 35);
  }

  // 개별 종목 한도 체크
  canAddToSymbol(symbol) {
    const existing = this.positions.find(p => p.symbol === symbol);
    if (!existing) return true;
    const posValue = Math.abs(parseFloat(existing.market_value || 0));
    const maxPosValue = this.equity * (this.s.maxSinglePct || 5) / 100;
    return posValue < maxPosValue;
  }

  // 변동성 기반 포지션 사이징
  calcPositionSize(signal) {
    const baseAlloc = this.equity * (this.s.allocationPct || 2) / 100;
    // ATR 기반 조정: 변동성 높으면 사이즈 줄임
    const atrPct = signal.atrPct || 2;
    const volAdjust = Math.min(1.5, Math.max(0.3, 2 / atrPct)); // 2%가 기준
    // 신뢰도 가중
    const confAdjust = Math.max(0.5, signal.confidence);
    const adjusted = baseAlloc * volAdjust * confAdjust;
    // 최소 $10, 최대 equity의 5%
    return Math.round(Math.max(10, Math.min(adjusted, this.equity * 0.05)));
  }

  // 스탑로스/익절 가격 계산 (ATR 기반)
  calcBracket(signal) {
    const price = signal.price;
    const atr = signal.atr || price * 0.02;
    const slMult = this.s.stopLossATR || 2;    // ATR × 2 = 스탑로스
    const tpMult = this.s.takeProfitATR || 3;   // ATR × 3 = 익절 (1.5:1 R:R)

    if (signal.type === "BUY") {
      return {
        stopLoss: Math.round((price - atr * slMult) * 100) / 100,
        takeProfit: Math.round((price + atr * tpMult) * 100) / 100,
      };
    } else {
      return {
        stopLoss: Math.round((price + atr * slMult) * 100) / 100,
        takeProfit: Math.round((price - atr * tpMult) * 100) / 100,
      };
    }
  }
}

// ══════════════════════════════════════════════════════════════
// 숫자 포맷
// ══════════════════════════════════════════════════════════════
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
  const [qrScanning, setQrScanning] = useState(false);
  const setupVideoRef = useRef(null);
  const setupStreamRef = useRef(null);

  const handleConnect = async () => {
    if (!key.trim() || !secret.trim()) { setError("API Key와 Secret을 모두 입력해주세요"); return; }
    setTesting(true); setError("");
    try {
      const acc = await alpacaAPI("account", { apiKey: key.trim(), apiSecret: secret.trim(), isPaper: true });
      if (acc.id) {
        const newConfig = { apiKey: key.trim(), apiSecret: secret.trim(), isPaper: true, connected: true };
        setConfig(newConfig); save(KEYS.config, newConfig); onConnect(acc);
      } else { setError("계좌 인증 실패"); }
    } catch (e) { setError(e.message || "연결 실패"); }
    setTesting(false);
  };

  return (
    <div className="tab-content">
      <div style={{ background: `linear-gradient(135deg, ${C.card} 0%, #0D1B2A 100%)`,
        border: `1px solid ${C.border}`, borderRadius: "16px", padding: "32px 24px", textAlign: "center", marginBottom: "16px" }}>
        <div style={{ fontSize: "48px", marginBottom: "12px" }}>🤖</div>
        <div style={{ fontWeight: 800, fontSize: "22px", marginBottom: "8px" }}>퀀트 자동매매 v3</div>
        <div style={{ color: C.text3, fontSize: "14px", maxWidth: "420px", margin: "0 auto", lineHeight: 1.6 }}>
          리스크 관리 · 브래킷 주문 · 드로다운 보호 · ATR 포지션 사이징
        </div>
      </div>

      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "16px", padding: "20px", marginBottom: "16px" }}>
        <div style={{ fontWeight: 700, fontSize: "15px", marginBottom: "12px" }}>시작하기</div>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {[
            { step: "1", title: "Alpaca 계정 생성", desc: "alpaca.markets 무료 가입", link: "https://app.alpaca.markets/signup" },
            { step: "2", title: "Paper Trading API 키 발급", desc: "Dashboard → Paper Trading → API Keys" },
            { step: "3", title: "아래에 키 입력 후 연결", desc: "API Key ID와 Secret Key 입력" },
          ].map(s => (
            <div key={s.step} style={{ display: "flex", gap: "12px", alignItems: "flex-start" }}>
              <div style={{ width: "28px", height: "28px", borderRadius: "50%", background: C.blueBg,
                color: C.blue, fontWeight: 800, fontSize: "13px", display: "flex", alignItems: "center",
                justifyContent: "center", flexShrink: 0 }}>{s.step}</div>
              <div>
                <div style={{ fontWeight: 600, fontSize: "13px" }}>{s.title}</div>
                <div style={{ fontSize: "12px", color: C.text3 }}>{s.desc}</div>
                {s.link && <a href={s.link} target="_blank" rel="noopener noreferrer"
                  style={{ fontSize: "12px", color: C.blue, textDecoration: "none" }}>가입하기 →</a>}
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

        {/* 구분선 */}
        <div style={{display:"flex",alignItems:"center",gap:"12px",margin:"20px 0 16px"}}>
          <div style={{flex:1,height:"1px",background:C.border2}} />
          <span style={{fontSize:"11px",color:C.text3,fontWeight:600}}>또는</span>
          <div style={{flex:1,height:"1px",background:C.border2}} />
        </div>

        {/* QR 스캔으로 불러오기 */}
        {!qrScanning ? (
          <button onClick={async ()=>{
            try {
              await loadJsQR();
              setQrScanning(true);
              setTimeout(async () => {
                try {
                  const stream = await navigator.mediaDevices.getUserMedia({
                    video: { facingMode: "environment", width: { ideal: 640 }, height: { ideal: 480 } }
                  });
                  setupStreamRef.current = stream;
                  if (setupVideoRef.current) {
                    setupVideoRef.current.srcObject = stream;
                    setupVideoRef.current.play();
                    const canvas = document.createElement("canvas");
                    const ctx = canvas.getContext("2d");
                    const scanLoop = () => {
                      if (!setupStreamRef.current) return;
                      const v = setupVideoRef.current;
                      if (!v || v.readyState < 2) { requestAnimationFrame(scanLoop); return; }
                      canvas.width = v.videoWidth;
                      canvas.height = v.videoHeight;
                      ctx.drawImage(v, 0, 0);
                      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                      const code = window.jsQR(imgData.data, canvas.width, canvas.height, { inversionAttempts: "dontInvert" });
                      if (code?.data) {
                        try {
                          let syncData = code.data;
                          if (syncData.startsWith("http")) {
                            const url = new URL(syncData);
                            syncData = url.searchParams.get("sync");
                          }
                          if (!syncData) throw new Error("no sync");
                          const payload = JSON.parse(decodeURIComponent(escape(atob(syncData))));
                          if (!payload.v || !payload.c?.k) throw new Error("invalid");
                          // 성공! 스트림 정리
                          setupStreamRef.current?.getTracks().forEach(t => t.stop());
                          setupStreamRef.current = null;
                          setQrScanning(false);
                          // config 적용 + 연결
                          const newConfig = { apiKey: payload.c.k, apiSecret: payload.c.s, isPaper: payload.c.p !== false, connected: true };
                          setConfig(newConfig);
                          save(KEYS.config, newConfig);
                          // tradeSettings 등도 저장
                          if (payload.t) save(KEYS.settings, payload.t);
                          if (typeof payload.ae === "boolean") save(KEYS.autoTrade, payload.ae);
                          if (typeof payload.as === "boolean") save("di_auto_scan", payload.as);
                          if (typeof payload.th === "boolean") save("di_trading_halted", payload.th);
                          // 계좌 확인
                          try {
                            const acc = await alpacaAPI("account", newConfig);
                            if (acc.id) onConnect(acc);
                          } catch {}
                          return;
                        } catch {
                          requestAnimationFrame(scanLoop);
                          return;
                        }
                      }
                      requestAnimationFrame(scanLoop);
                    };
                    requestAnimationFrame(scanLoop);
                  }
                } catch (e) {
                  alert("카메라 접근 실패: " + e.message);
                  setQrScanning(false);
                }
              }, 200);
            } catch (e) {
              alert("QR 스캐너 로드 실패: " + e.message);
            }
          }} style={{
            width:"100%",padding:"14px",borderRadius:"12px",fontSize:"15px",fontWeight:700,
            background:C.card2,color:C.green,border:`1px solid ${C.green}44`,cursor:"pointer",
            display:"flex",alignItems:"center",justifyContent:"center",gap:"8px",
          }}>
            <span style={{fontSize:"20px"}}>📷</span> QR로 불러오기
          </button>
        ) : (
          <div>
            <div style={{borderRadius:"12px",overflow:"hidden",background:"#000",position:"relative",marginBottom:"8px"}}>
              <video ref={setupVideoRef} style={{width:"100%",height:"auto",display:"block"}} playsInline muted />
              <div style={{
                position:"absolute",top:"50%",left:"50%",transform:"translate(-50%,-50%)",
                width:"180px",height:"180px",border:"3px solid "+C.green,borderRadius:"16px",
                boxShadow:"0 0 0 2000px rgba(0,0,0,0.5)"
              }} />
              <div style={{
                position:"absolute",bottom:"12px",left:"50%",transform:"translateX(-50%)",
                fontSize:"12px",color:"#fff",background:"rgba(0,0,0,0.7)",padding:"4px 12px",borderRadius:"20px",
              }}>PC에 표시된 QR 코드를 비추세요</div>
            </div>
            <button onClick={()=>{
              setupStreamRef.current?.getTracks().forEach(t => t.stop());
              setupStreamRef.current = null;
              setQrScanning(false);
            }} style={{
              width:"100%",padding:"10px",borderRadius:"10px",fontSize:"13px",fontWeight:600,
              background:C.card2,color:C.text3,border:`1px solid ${C.border2}`,cursor:"pointer",
            }}>취소</button>
          </div>
        )}
        <div style={{fontSize:"10px",color:C.text3,marginTop:"8px",textAlign:"center"}}>
          PC 자동매매 설정에서 QR 생성 → 여기서 스캔
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// 주문 모달
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
      const params = { symbol, side, type: orderType, time_in_force: orderType === "market" ? "day" : "gtc" };
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
      justifyContent: "center", background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: C.card, border: `1px solid ${C.border}`, borderRadius: "20px",
        padding: "24px", width: "100%", maxWidth: "400px", margin: "16px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
          <div style={{ fontWeight: 800, fontSize: "17px" }}>{side === "buy" ? "매수" : "매도"} 주문</div>
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
            <label style={{ fontSize: "12px", color: C.text3, fontWeight: 600, display: "block", marginBottom: "4px" }}>종목</label>
            <input value={symbol} onChange={e => setSymbol(e.target.value.toUpperCase())} placeholder="AAPL, NVDA..." style={{
              width: "100%", padding: "10px 14px", borderRadius: "10px", fontSize: "16px", fontWeight: 700,
              background: C.card2, border: `1px solid ${C.border2}`, color: C.text1, outline: "none" }} />
          </div>
        )}
        {!result ? (
          <>
            <div style={{ display: "flex", gap: "4px", marginBottom: "12px" }}>
              {[["shares","수량(주)"],["dollars","금액($)"]].map(([id,label])=>(
                <button key={id} onClick={()=>setQtyMode(id)} style={{
                  flex:1,padding:"8px",borderRadius:"8px",fontSize:"12px",fontWeight:600,
                  background:qtyMode===id?C.blueBg:"transparent",color:qtyMode===id?C.blue:C.text3,
                  border:`1px solid ${qtyMode===id?C.blue:C.border2}`,cursor:"pointer"}}>{label}</button>
              ))}
            </div>
            <div style={{ marginBottom: "12px" }}>
              <input value={qtyMode==="shares"?qty:notional}
                onChange={e=>qtyMode==="shares"?setQty(e.target.value):setNotional(e.target.value)}
                type="number" placeholder={qtyMode==="shares"?"10":"1000"} style={{
                width:"100%",padding:"10px 14px",borderRadius:"10px",fontSize:"16px",fontWeight:700,
                background:C.card2,border:`1px solid ${C.border2}`,color:C.text1,outline:"none"}} />
            </div>
            <div style={{ display: "flex", gap: "4px", marginBottom: "12px" }}>
              {[["market","시장가"],["limit","지정가"]].map(([id,label])=>(
                <button key={id} onClick={()=>setOrderType(id)} style={{
                  flex:1,padding:"8px",borderRadius:"8px",fontSize:"12px",fontWeight:600,
                  background:orderType===id?C.blueBg:"transparent",color:orderType===id?C.blue:C.text3,
                  border:`1px solid ${orderType===id?C.blue:C.border2}`,cursor:"pointer"}}>{label}</button>
              ))}
            </div>
            {orderType==="limit"&&(
              <input value={limitPrice} onChange={e=>setLimitPrice(e.target.value)} type="number" placeholder="$150.00"
                style={{width:"100%",padding:"10px 14px",borderRadius:"10px",fontSize:"16px",fontWeight:700,marginBottom:"12px",
                background:C.card2,border:`1px solid ${C.border2}`,color:C.text1,outline:"none"}} />
            )}
            {error&&<div style={{background:C.redBg,borderRadius:"8px",padding:"10px",fontSize:"12px",color:C.red,marginBottom:"12px"}}>{error}</div>}
            <button onClick={handleSubmit} disabled={submitting||(!qty&&!notional)} style={{
              width:"100%",padding:"14px",borderRadius:"12px",fontSize:"15px",fontWeight:700,
              background:submitting?C.card2:side==="buy"?`linear-gradient(135deg,${C.red},#DC2626)`:`linear-gradient(135deg,${C.blue},#2563EB)`,
              color:"#fff",border:"none",cursor:submitting?"default":"pointer",opacity:(!qty&&!notional)?0.5:1,
            }}>{submitting?"전송 중...":side==="buy"?`${symbol} 매수`:`${symbol} 매도`}</button>
          </>
        ) : (
          <div style={{ textAlign: "center", padding: "16px 0" }}>
            <div style={{ fontSize: "40px", marginBottom: "8px" }}>{["accepted","new","filled"].includes(result.status)?"✅":"⚠️"}</div>
            <div style={{ fontWeight: 700, fontSize: "15px", marginBottom: "4px" }}>
              {result.status==="filled"?"체결 완료":result.status==="accepted"||result.status==="new"?"주문 접수":`상태: ${result.status}`}
            </div>
            <div style={{ fontSize: "12px", color: C.text3 }}>{result.symbol} · {result.qty||result.notional}</div>
            <button onClick={onClose} style={{marginTop:"16px",padding:"10px 24px",borderRadius:"10px",
              background:C.card2,border:`1px solid ${C.border2}`,color:C.text2,fontSize:"13px",fontWeight:600,cursor:"pointer"}}>확인</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// QR 코드 생성 (동적 CDN 로드) + 스캔 (jsQR)
// ══════════════════════════════════════════════════════════════
let _qrLib = null;
async function loadQRGenerator() {
  if (_qrLib) return _qrLib;
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js";
    s.onload = () => { _qrLib = window.QRCode; resolve(_qrLib); };
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

let _jsQR = null;
async function loadJsQR() {
  if (_jsQR) return _jsQR;
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js";
    s.onload = () => { _jsQR = window.jsQR; resolve(_jsQR); };
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

function buildSyncPayload(config, tradeSettings, autoTradeEnabled, autoScanEnabled, tradingHalted) {
  return {
    c: config.apiKey ? { k: config.apiKey, s: config.apiSecret, p: config.isPaper } : null,
    t: tradeSettings,
    ae: autoTradeEnabled,
    as: autoScanEnabled,
    th: tradingHalted,
    v: 1,
    ts: Date.now(),
  };
}

function applySyncPayload(payload, setConfig, setTradeSettings, setAutoTradeEnabled, setAutoScanEnabled, setTradingHalted, config, save, KEYS) {
  if (payload.c?.k) {
    const merged = { ...config, apiKey: payload.c.k, apiSecret: payload.c.s, isPaper: payload.c.p, connected: true };
    setConfig(merged);
    save(KEYS.config, merged);
  }
  if (payload.t) setTradeSettings(payload.t);
  if (typeof payload.ae === "boolean") setAutoTradeEnabled(payload.ae);
  if (typeof payload.as === "boolean") setAutoScanEnabled(payload.as);
  if (typeof payload.th === "boolean") setTradingHalted(payload.th);
}

// ══════════════════════════════════════════════════════════════
// 메인 컴포넌트
// ══════════════════════════════════════════════════════════════
export default function PaperTrading({ strategyAlerts = [], theme = "dark" }) {
  const [config, setConfig] = useState(() => load(KEYS.config, {}));
  const [account, setAccount] = useState(null);
  const [positions, setPositions] = useState([]);
  const [orders, setOrders] = useState([]);
  const [clock, setClock] = useState(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState(() => load("di_pt_tab", "dashboard"));
  const [orderModal, setOrderModal] = useState(null);

  const [autoTradeEnabled, setAutoTradeEnabled] = useState(() => load(KEYS.autoTrade, false));
  const [tradeLog, setTradeLog] = useState(() => load(KEYS.tradeLog, []));
  const [executedSignals, setExecutedSignals] = useState(() => load(KEYS.executed, {}));

  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [detectedSignals, setDetectedSignals] = useState([]);
  const [lastScanTime, setLastScanTime] = useState(null);

  // QR 동기화 모달
  const [qrModal, setQrModal] = useState(null); // null | "generate" | "scan"
  const [qrSvg, setQrSvg] = useState("");
  const videoRef = useRef(null);
  const qrStreamRef = useRef(null);
  const [autoScanEnabled, setAutoScanEnabled] = useState(() => load("di_auto_scan", false));

  // 리스크 알림 상태
  const [riskAlerts, setRiskAlerts] = useState([]);
  const [tradingHalted, setTradingHalted] = useState(() => load("di_trading_halted", false));

  const [tradeSettings, setTradeSettings] = useState(() => load(KEYS.settings, {
    orderType: "market",
    allocationPct: 2,
    maxPositions: 20,
    maxDrawdownPct: 10,
    maxDailyLossPct: 3,
    maxSectorPct: 35,
    maxSinglePct: 5,
    stopLossATR: 2,
    takeProfitATR: 3,
    useBracketOrders: true,
    minConfidence: 0.5,
    cooldownHours: 24,
    strategies: Object.keys(STRATEGY_PORTFOLIOS),
  }));

  const refreshTimer = useRef(null);
  const scanTimer = useRef(null);
  const isConnected = config.connected && config.apiKey;

  // persist
  useEffect(() => { save(KEYS.tradeLog, tradeLog.slice(0, 300)); }, [tradeLog]);
  useEffect(() => {
    const cutoff = Date.now() - 7 * 86400000;
    const clean = {};
    for (const [k, v] of Object.entries(executedSignals)) { if (v > cutoff) clean[k] = v; }
    save(KEYS.executed, clean);
  }, [executedSignals]);
  useEffect(() => { save(KEYS.autoTrade, autoTradeEnabled); }, [autoTradeEnabled]);
  useEffect(() => { save(KEYS.settings, tradeSettings); }, [tradeSettings]);
  useEffect(() => { save("di_auto_scan", autoScanEnabled); }, [autoScanEnabled]);
  useEffect(() => { save("di_trading_halted", tradingHalted); }, [tradingHalted]);
  useEffect(() => { save("di_pt_tab", activeTab); }, [activeTab]);

  // ── 계좌 데이터 ──
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

  // ── 리스크 체크 (계좌 갱신 시마다) ──
  useEffect(() => {
    if (!account || !isConnected) return;
    const rm = new RiskManager(tradeSettings, account, positions);
    const alerts = [];

    if (rm.isDrawdownBreached()) {
      alerts.push({ level: "critical", msg: `최대 드로다운 ${fmt(rm.drawdown)}% 도달 — 자동매매 중단` });
      if (autoTradeEnabled) {
        setAutoTradeEnabled(false);
        setTradingHalted(true);
      }
    }
    if (rm.isDailyLossBreached(account)) {
      alerts.push({ level: "critical", msg: `일일 손실 한도 도달 — 오늘 자동매매 중단` });
      setTradingHalted(true);
    }
    if (rm.drawdown >= (tradeSettings.maxDrawdownPct || 10) * 0.7) {
      alerts.push({ level: "warning", msg: `드로다운 경고: ${fmt(rm.drawdown)}% (한도의 70%)` });
    }

    const sectorExp = rm.getSectorExposure();
    for (const [sec, pct] of Object.entries(sectorExp)) {
      if (pct > (tradeSettings.maxSectorPct || 35) && sec !== "ETF") {
        alerts.push({ level: "warning", msg: `${sec} 섹터 집중도 ${fmt(pct, 0)}% — 한도 ${tradeSettings.maxSectorPct || 35}% 초과` });
      }
    }

    setRiskAlerts(alerts);
  }, [account, positions, tradeSettings]);

  // ── 퀀트 전략 스캔 ──
  const runQuantScan = useCallback(async () => {
    if (scanning) return;

    // 장중 체크
    if (clock && !clock.is_open) {
      setRiskAlerts(prev => {
        if (prev.some(a => a.msg.includes("장 마감"))) return prev;
        return [...prev, { level: "info", msg: "장 마감 상태 — 스캔만 실행, 주문은 다음 장 시작 시 실행" }];
      });
    }

    setScanning(true);
    setScanProgress(0);
    try {
      const usSymbols = collectUSSymbols();
      const candleMap = await fetchCandleData(usSymbols, setScanProgress);
      const signals = detectSignals(candleMap);
      setDetectedSignals(signals);
      setLastScanTime(new Date());

      if (autoTradeEnabled && isConnected && signals.length > 0 && !tradingHalted) {
        if (clock?.is_open) {
          await executeAutoTrades(signals);
        }
      }
    } catch (e) {
      console.error("Quant scan error:", e);
    }
    setScanning(false);
    setScanProgress(100);
  }, [scanning, autoTradeEnabled, isConnected, config, executedSignals, tradeSettings, account, positions, clock, tradingHalted]);

  // ── 자동 주문 실행 (리스크 관리 적용) ──
  const executeAutoTrades = async (signals) => {
    if (!account) return;
    const rm = new RiskManager(tradeSettings, account, positions);

    // 최종 리스크 체크
    if (rm.isDrawdownBreached() || rm.isDailyLossBreached(account)) {
      setTradeLog(prev => [{ time: new Date().toLocaleString("ko-KR"),
        symbol: "SYSTEM", side: "HALT", strategy: "리스크 관리",
        reason: "드로다운/일일 손실 한도 초과로 자동매매 중단",
        error: "RISK_HALT" }, ...prev]);
      return;
    }

    let newExecuted = { ...executedSignals };
    let newLog = [...tradeLog];
    let ordersPlaced = 0;
    const MAX_ORDERS_PER_SCAN = 5; // 1회 스캔당 최대 주문 수

    for (const sig of signals) {
      if (ordersPlaced >= MAX_ORDERS_PER_SCAN) break;

      // 중복 체크
      if (newExecuted[sig.id]) continue;

      // 전략 활성 체크
      if (!tradeSettings.strategies.includes(sig.strategy)) continue;

      // 신뢰도 필터
      if (sig.confidence < (tradeSettings.minConfidence || 0.5)) continue;

      // 쿨다운 체크 (같은 종목 최근 N시간 내 주문 여부)
      const cooldownMs = (tradeSettings.cooldownHours || 24) * 3600000;
      const recentSameSymbol = Object.entries(newExecuted).some(([k, v]) =>
        k.includes(sig.symbol) && (Date.now() - v) < cooldownMs
      );
      if (recentSameSymbol) continue;

      // 매수 전용 체크
      if (sig.type === "BUY") {
        if (positions.length >= (tradeSettings.maxPositions || 20)) continue;
        if (!rm.canAddToSector(sig.symbol)) {
          newLog.unshift({ time: new Date().toLocaleString("ko-KR"), symbol: sig.symbol, side: "BUY",
            strategy: sig.strategy, reason: `${SECTOR_MAP[sig.symbol]} 섹터 한도 초과`, error: "SECTOR_LIMIT" });
          continue;
        }
        if (!rm.canAddToSymbol(sig.symbol)) {
          newLog.unshift({ time: new Date().toLocaleString("ko-KR"), symbol: sig.symbol, side: "BUY",
            strategy: sig.strategy, reason: `개별 종목 한도 초과`, error: "POSITION_LIMIT" });
          continue;
        }
      }

      // 매도: 보유 중인 종목만
      if (sig.type === "SELL") {
        const hasPos = positions.some(p => p.symbol === sig.symbol);
        if (!hasPos) continue;
      }

      try {
        const orderParams = {
          symbol: sig.symbol,
          side: sig.type === "BUY" ? "buy" : "sell",
          type: tradeSettings.orderType || "market",
          time_in_force: "day",
          client_order_id: `di-${sig.symbol}-${Date.now()}`,
        };

        if (sig.type === "BUY") {
          // ATR 기반 포지션 사이징
          const positionSize = rm.calcPositionSize(sig);
          orderParams.notional = Math.max(1, positionSize);

          // 브래킷 주문 (스탑로스 + 익절)
          if (tradeSettings.useBracketOrders) {
            const bracket = rm.calcBracket(sig);
            orderParams.order_class = "bracket";
            orderParams.take_profit = { limit_price: String(bracket.takeProfit) };
            orderParams.stop_loss = { stop_price: String(bracket.stopLoss) };
          }
        } else {
          // 매도: 전량 청산
          const pos = positions.find(p => p.symbol === sig.symbol);
          orderParams.qty = pos ? parseFloat(pos.qty) : 1;
        }

        const order = await alpacaAPI("submit_order", config, orderParams);

        // 주문 상태 확인 (체결 검증)
        let verifiedStatus = order.status;
        if (order.id) {
          try {
            await new Promise(r => setTimeout(r, 1500));
            const check = await alpacaAPI("get_order", config, { order_id: order.id });
            verifiedStatus = check.status;
          } catch {}
        }

        newExecuted[sig.id] = Date.now();
        const bracket = tradeSettings.useBracketOrders && sig.type === "BUY" ? rm.calcBracket(sig) : null;
        newLog.unshift({
          time: new Date().toLocaleString("ko-KR"),
          symbol: sig.symbol,
          side: sig.type,
          strategy: sig.strategy,
          reason: sig.reason,
          confidence: sig.confidence,
          amount: sig.type === "BUY" ? `$${rm.calcPositionSize(sig)}` : `${orderParams.qty}주 청산`,
          stopLoss: bracket ? `$${bracket.stopLoss}` : null,
          takeProfit: bracket ? `$${bracket.takeProfit}` : null,
          orderId: order.id,
          status: verifiedStatus,
          atrPct: sig.atrPct,
        });
        ordersPlaced++;
      } catch (e) {
        newExecuted[sig.id] = Date.now();
        newLog.unshift({
          time: new Date().toLocaleString("ko-KR"),
          symbol: sig.symbol,
          side: sig.type,
          strategy: sig.strategy,
          reason: sig.reason,
          confidence: sig.confidence,
          error: e.message,
        });
      }
    }

    setExecutedSignals(newExecuted);
    setTradeLog(newLog.slice(0, 300));
    if (ordersPlaced > 0) refreshData();
  };

  // ── 자동 스캔 (5분) ──
  useEffect(() => {
    if (autoTradeEnabled && isConnected && autoScanEnabled) {
      runQuantScan();
      scanTimer.current = setInterval(runQuantScan, 5 * 60 * 1000);
      return () => clearInterval(scanTimer.current);
    }
    return () => { if (scanTimer.current) clearInterval(scanTimer.current); };
  }, [autoTradeEnabled, isConnected, autoScanEnabled]);

  const handleOrderPlaced = useCallback(() => { setTimeout(refreshData, 1000); }, [refreshData]);
  const closePosition = async (symbol) => {
    try { await alpacaAPI("close_position", config, { symbol }); setTimeout(refreshData, 500); }
    catch (e) { alert("청산 실패: " + e.message); }
  };
  const cancelOrder = async (orderId) => {
    try { await alpacaAPI("cancel_order", config, { order_id: orderId }); setTimeout(refreshData, 500); }
    catch (e) { alert("취소 실패: " + e.message); }
  };
  const disconnect = () => {
    setConfig({}); save(KEYS.config, {}); setAccount(null); setPositions([]); setOrders([]);
  };

  if (!isConnected) return <SetupPanel config={config} setConfig={setConfig} onConnect={acc => setAccount(acc)} />;

  const equity = parseFloat(account?.equity || 0);
  const cash = parseFloat(account?.cash || 0);
  const buyingPower = parseFloat(account?.buying_power || 0);
  const dayPL = parseFloat(account?.equity) - parseFloat(account?.last_equity || account?.equity);
  const dayPLPct = parseFloat(account?.last_equity) ? (dayPL / parseFloat(account.last_equity) * 100) : 0;
  const totalPL = equity - 100000;
  const totalPLPct = (totalPL / 100000) * 100;
  const positionPL = positions.reduce((s, p) => s + parseFloat(p.unrealized_pl || 0), 0);
  const openOrders = orders.filter(o => ["new","accepted","pending_new","partially_filled"].includes(o.status));
  const filledOrders = orders.filter(o => o.status === "filled");
  const marketOpen = clock?.is_open;

  const rm = new RiskManager(tradeSettings, account, positions);

  return (
    <div className="tab-content">
      {orderModal && <OrderModal symbol={orderModal.symbol} side={orderModal.side} reason={orderModal.reason}
        config={config} onClose={() => setOrderModal(null)} onOrderPlaced={handleOrderPlaced} />}

      {/* ── 리스크 알림 배너 ── */}
      {riskAlerts.length > 0 && (
        <div style={{ marginBottom: "12px", display: "flex", flexDirection: "column", gap: "6px" }}>
          {riskAlerts.map((a, i) => (
            <div key={i} style={{
              background: a.level === "critical" ? C.redBg : a.level === "warning" ? C.yellowBg : C.blueBg,
              border: `1px solid ${a.level === "critical" ? C.red : a.level === "warning" ? C.yellow : C.blue}33`,
              borderRadius: "10px", padding: "10px 14px", fontSize: "12px",
              color: a.level === "critical" ? C.red : a.level === "warning" ? C.yellow : C.blue,
              display: "flex", alignItems: "center", gap: "8px",
            }}>
              <span style={{ fontSize: "14px" }}>{a.level === "critical" ? "🚨" : a.level === "warning" ? "⚠️" : "ℹ️"}</span>
              {a.msg}
            </div>
          ))}
        </div>
      )}

      {/* ── 상단 계좌 요약 ── */}
      <div style={{ background: `linear-gradient(135deg, ${C.card} 0%, #0D1B2A 100%)`,
        border: `1px solid ${C.border}`, borderRadius: "16px", padding: "20px", marginBottom: "12px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px", flexWrap: "wrap" }}>
              <span style={{ fontWeight: 800, fontSize: "18px" }}>퀀트 자동매매 v3</span>
              <span style={{ padding: "2px 8px", borderRadius: "4px", fontSize: "10px", fontWeight: 700,
                background: config.isPaper ? C.yellowBg : C.greenBg, color: config.isPaper ? C.yellow : C.green }}>
                {config.isPaper ? "PAPER" : "LIVE"}</span>
              <span style={{ padding: "2px 8px", borderRadius: "4px", fontSize: "10px", fontWeight: 700,
                background: marketOpen ? C.greenBg : C.redBg, color: marketOpen ? C.green : C.red }}>
                {marketOpen ? "장중" : "장 마감"}</span>
              {autoTradeEnabled && !tradingHalted && (
                <span style={{ padding: "2px 8px", borderRadius: "4px", fontSize: "10px", fontWeight: 700,
                  background: C.purpleBg, color: C.purple }}>AUTO</span>
              )}
              {tradingHalted && (
                <span style={{ padding: "2px 8px", borderRadius: "4px", fontSize: "10px", fontWeight: 700,
                  background: C.redBg, color: C.red }}>HALTED</span>
              )}
            </div>
            <div style={{ fontSize: "11px", color: C.text3, display: "flex", gap: "8px", flexWrap: "wrap" }}>
              <span>{loading ? "갱신 중..." : "30초 자동 갱신"}</span>
              <span>DD: {fmt(rm.drawdown)}%/{tradeSettings.maxDrawdownPct}%</span>
              {lastScanTime && <span>스캔 {lastScanTime.toLocaleTimeString("ko-KR")}</span>}
            </div>
          </div>
          <div style={{ display: "flex", gap: "6px" }}>
            <button onClick={refreshData} style={{ padding: "6px 12px", borderRadius: "8px", fontSize: "11px", fontWeight: 600,
              background: C.card2, border: `1px solid ${C.border2}`, color: C.text2, cursor: "pointer" }}>새로고침</button>
            <button onClick={disconnect} style={{ padding: "6px 12px", borderRadius: "8px", fontSize: "11px", fontWeight: 600,
              background: C.redBg, border: `1px solid ${C.red}33`, color: C.red, cursor: "pointer" }}>연결 해제</button>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: "8px" }}>
          {[
            { label: "총 자산", value: fmtUSD(equity), color: C.text1 },
            { label: "현금", value: fmtUSD(cash), color: C.blue },
            { label: "매수가능", value: fmtUSD(buyingPower), color: C.blueL },
            { label: "오늘 P&L", value: fmtUSD(dayPL), sub: fmtPct(dayPLPct), color: dayPL >= 0 ? C.green : C.red },
            { label: "총 수익", value: fmtUSD(totalPL), sub: fmtPct(totalPLPct), color: totalPL >= 0 ? C.green : C.red },
            { label: "포지션 P&L", value: fmtUSD(positionPL), color: positionPL >= 0 ? C.green : C.red },
          ].map((m, i) => (
            <div key={i} style={{ background: C.card2, borderRadius: "10px", padding: "10px 12px" }}>
              <div style={{ fontSize: "10px", color: C.text3, marginBottom: "2px" }}>{m.label}</div>
              <div style={{ fontWeight: 800, fontSize: "15px", color: m.color }}>{m.value}</div>
              {m.sub && <div style={{ fontSize: "10px", color: m.color }}>{m.sub}</div>}
            </div>
          ))}
        </div>
      </div>

      {/* ── 탭 ── */}
      <div style={{ display: "flex", gap: "4px", marginBottom: "12px", overflowX: "auto" }}>
        {[
          ["dashboard","포지션",positions.length],
          ["orders","주문",orders.filter(o=>["new","partially_filled","accepted","pending_new"].includes(o.status)).length],
          ["signals","시그널",detectedSignals.length],
          ["auto","자동매매",null],
          ["risk","리스크",riskAlerts.length],
          ["log","로그",tradeLog.length],
        ].map(([id,label,count])=>(
          <button key={id} onClick={()=>setActiveTab(id)} style={{
            padding:"8px 12px",borderRadius:"8px",fontSize:"12px",fontWeight:600,
            background:activeTab===id?C.blueBg:"transparent",color:activeTab===id?C.blue:C.text3,
            border:`1px solid ${activeTab===id?C.blue:C.border2}`,cursor:"pointer",whiteSpace:"nowrap",
            display:"flex",alignItems:"center",gap:"6px",
          }}>
            {label}
            {count!=null&&count>0&&(
              <span style={{background:activeTab===id?C.blue:C.border2,color:activeTab===id?"#fff":C.text3,
                fontSize:"10px",fontWeight:700,borderRadius:"50%",width:"18px",height:"18px",
                display:"flex",alignItems:"center",justifyContent:"center"}}>{count>99?"99+":count}</span>
            )}
          </button>
        ))}
        <div style={{flex:1}} />
        <button onClick={()=>setOrderModal({symbol:"",side:"buy",reason:"수동 주문"})} style={{
          padding:"8px 14px",borderRadius:"8px",fontSize:"12px",fontWeight:700,
          background:`linear-gradient(135deg,${C.blue},#2563EB)`,color:"#fff",border:"none",cursor:"pointer",whiteSpace:"nowrap",
        }}>+ 주문</button>
      </div>

      {/* ── 포지션 ── */}
      {activeTab==="dashboard"&&(
        <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:"16px",padding:"20px"}}>
          <div style={{fontWeight:700,marginBottom:"16px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span>보유 포지션 ({positions.length}/{tradeSettings.maxPositions})</span>
            {positions.length>0&&(
              <button onClick={async()=>{if(confirm("전체 청산?")){await alpacaAPI("close_all",config);setTimeout(refreshData,1000);}}}
                style={{fontSize:"11px",color:C.red,background:"none",border:"none",cursor:"pointer"}}>전체 청산</button>
            )}
          </div>
          {positions.length===0?(
            <div style={{textAlign:"center",padding:"40px 0",color:C.text3}}>
              <div style={{fontSize:"40px",marginBottom:"8px"}}>📭</div>
              <div>보유 중인 포지션이 없습니다</div>
            </div>
          ):(
            <div style={{display:"flex",flexDirection:"column",gap:"6px"}}>
              {positions.map((p,i)=>{
                const pl=parseFloat(p.unrealized_pl||0);
                const plPct=parseFloat(p.unrealized_plpc||0)*100;
                const mktVal=parseFloat(p.market_value||0);
                const qty=parseFloat(p.qty||0);
                const avgEntry=parseFloat(p.avg_entry_price||0);
                const curPrice=parseFloat(p.current_price||0);
                const sector=SECTOR_MAP[p.symbol]||"Other";
                return (
                  <div key={i} style={{background:C.card2,borderRadius:"10px",padding:"12px",borderLeft:`3px solid ${pl>=0?C.green:C.red}`}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"6px"}}>
                      <div>
                        <span style={{fontWeight:700,fontSize:"14px",marginRight:"6px"}}>{p.symbol}</span>
                        <span style={{fontSize:"10px",color:C.text3,background:C.card,padding:"1px 6px",borderRadius:"4px"}}>{sector}</span>
                        <span style={{fontSize:"11px",color:C.text3,marginLeft:"8px"}}>{qty}주 · ${fmt(avgEntry)}</span>
                      </div>
                      <div style={{display:"flex",gap:"4px"}}>
                        <button onClick={()=>setOrderModal({symbol:p.symbol,side:"buy",reason:"추가 매수"})} style={{
                          padding:"4px 8px",borderRadius:"6px",fontSize:"10px",fontWeight:700,
                          background:C.redBg,color:C.red,border:"none",cursor:"pointer"}}>매수</button>
                        <button onClick={()=>closePosition(p.symbol)} style={{
                          padding:"4px 8px",borderRadius:"6px",fontSize:"10px",fontWeight:700,
                          background:C.blueBg,color:C.blue,border:"none",cursor:"pointer"}}>청산</button>
                      </div>
                    </div>
                    <div style={{display:"flex",gap:"12px",fontSize:"12px",flexWrap:"wrap"}}>
                      <span style={{color:C.text3}}>현재 <b style={{color:C.text1}}>${fmt(curPrice)}</b></span>
                      <span style={{color:C.text3}}>평가 <b style={{color:C.text1}}>${fmt(mktVal)}</b></span>
                      <span style={{color:C.text3}}>P&L <b style={{color:pl>=0?C.green:C.red}}>{fmtUSD(pl)} ({fmtPct(plPct)})</b></span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── 주문 ── */}
      {activeTab==="orders"&&(
        <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:"16px",padding:"20px"}}>
          {openOrders.length>0&&(<>
            <div style={{fontWeight:700,marginBottom:"12px",display:"flex",justifyContent:"space-between"}}>
              <span>미체결 ({openOrders.length})</span>
              <button onClick={async()=>{await alpacaAPI("cancel_all",config);setTimeout(refreshData,500);}}
                style={{fontSize:"11px",color:C.red,background:"none",border:"none",cursor:"pointer"}}>전체 취소</button>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:"6px",marginBottom:"20px"}}>
              {openOrders.map((o,i)=>(
                <div key={i} style={{background:C.card2,borderRadius:"10px",padding:"12px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <div>
                    <div style={{display:"flex",alignItems:"center",gap:"6px",marginBottom:"2px"}}>
                      <span style={{padding:"2px 6px",borderRadius:"4px",fontSize:"10px",fontWeight:700,
                        background:o.side==="buy"?C.redBg:C.blueBg,color:o.side==="buy"?C.red:C.blue}}>
                        {o.side==="buy"?"매수":"매도"}</span>
                      <span style={{fontWeight:700}}>{o.symbol}</span>
                      <span style={{fontSize:"11px",color:C.text3}}>{o.qty||o.notional}{o.qty?"주":"$"}</span>
                    </div>
                    <div style={{fontSize:"11px",color:C.text3}}>
                      {o.type==="limit"?`지정가 $${o.limit_price}`:o.type==="stop"?`스탑 $${o.stop_price}`:"시장가"} · {o.status}
                      {o.order_class==="bracket"&&" · 브래킷"}
                    </div>
                  </div>
                  <button onClick={()=>cancelOrder(o.id)} style={{
                    padding:"4px 8px",borderRadius:"6px",fontSize:"10px",
                    background:C.redBg,color:C.red,border:"none",cursor:"pointer"}}>취소</button>
                </div>
              ))}
            </div>
          </>)}
          <div style={{fontWeight:700,marginBottom:"12px"}}>체결 ({filledOrders.length})</div>
          {filledOrders.length===0?(
            <div style={{textAlign:"center",padding:"30px 0",color:C.text3}}>체결 내역 없음</div>
          ):(
            <div style={{display:"flex",flexDirection:"column",gap:"4px",maxHeight:"400px",overflow:"auto"}}>
              {filledOrders.map((o,i)=>(
                <div key={i} style={{background:C.card2,borderRadius:"8px",padding:"10px 12px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <div style={{display:"flex",alignItems:"center",gap:"8px"}}>
                    <span style={{padding:"2px 6px",borderRadius:"4px",fontSize:"10px",fontWeight:700,
                      background:o.side==="buy"?C.redBg:C.blueBg,color:o.side==="buy"?C.red:C.blue}}>
                      {o.side==="buy"?"매수":"매도"}</span>
                    <span style={{fontWeight:600,fontSize:"13px"}}>{o.symbol}</span>
                    <span style={{fontSize:"11px",color:C.text3}}>{o.filled_qty}주 @ ${fmt(parseFloat(o.filled_avg_price||0))}</span>
                  </div>
                  <span style={{fontSize:"10px",color:C.text3}}>{new Date(o.filled_at||o.created_at).toLocaleDateString("ko-KR")}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── 시그널 ── */}
      {activeTab==="signals"&&(
        <div>
          <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:"16px",padding:"20px",marginBottom:"12px"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"12px"}}>
              <div>
                <div style={{fontWeight:700,fontSize:"15px"}}>퀀트 전략 스캔</div>
                <div style={{fontSize:"12px",color:C.text3,marginTop:"2px"}}>
                  {Object.keys(STRATEGY_PORTFOLIOS).length}개 전략 · {collectUSSymbols().length}개 종목 · 신뢰도 {tradeSettings.minConfidence*100}%+ 필터
                </div>
              </div>
              <button onClick={runQuantScan} disabled={scanning} style={{
                padding:"10px 20px",borderRadius:"10px",fontSize:"13px",fontWeight:700,
                background:scanning?C.card2:`linear-gradient(135deg,${C.purple},#6D28D9)`,
                color:"#fff",border:"none",cursor:scanning?"default":"pointer",
              }}>{scanning?`스캔 중... ${scanProgress}%`:"전략 스캔"}</button>
            </div>
            {scanning&&(
              <div style={{height:"4px",background:C.border,borderRadius:"2px",overflow:"hidden"}}>
                <div style={{height:"100%",width:`${scanProgress}%`,background:`linear-gradient(90deg,${C.purple},${C.blue})`,
                  borderRadius:"2px",transition:"width 0.3s"}} />
              </div>
            )}
          </div>
          <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:"16px",padding:"20px"}}>
            <div style={{display:"flex",gap:"12px",marginBottom:"16px",alignItems:"center"}}>
              <span style={{fontWeight:700}}>시그널 ({detectedSignals.length})</span>
              {detectedSignals.filter(s=>s.type==="BUY").length>0&&(
                <span style={{fontSize:"12px",color:C.red,fontWeight:600}}>매수 {detectedSignals.filter(s=>s.type==="BUY").length}</span>
              )}
              {detectedSignals.filter(s=>s.type==="SELL").length>0&&(
                <span style={{fontSize:"12px",color:C.blue,fontWeight:600}}>매도 {detectedSignals.filter(s=>s.type==="SELL").length}</span>
              )}
            </div>
            {detectedSignals.length===0?(
              <div style={{textAlign:"center",padding:"40px 0",color:C.text3}}>
                <div style={{fontSize:"40px",marginBottom:"8px"}}>📡</div>
                <div>"전략 스캔" 실행으로 시그널 감지</div>
              </div>
            ):(
              <div style={{display:"flex",flexDirection:"column",gap:"6px",maxHeight:"500px",overflow:"auto"}}>
                {detectedSignals.slice(0,60).map((sig,i)=>{
                  const isBuy=sig.type==="BUY";
                  const wasExec=executedSignals[sig.id];
                  const confColor=sig.confidence>=0.7?C.green:sig.confidence>=0.5?C.yellow:C.red;
                  return (
                    <div key={i} style={{background:C.card2,borderRadius:"10px",padding:"12px",
                      borderLeft:`3px solid ${isBuy?C.red:C.blue}`,opacity:wasExec?0.5:1}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"4px"}}>
                        <div style={{display:"flex",alignItems:"center",gap:"6px",flexWrap:"wrap"}}>
                          <span style={{padding:"2px 6px",borderRadius:"4px",fontSize:"10px",fontWeight:700,
                            background:isBuy?C.redBg:C.blueBg,color:isBuy?C.red:C.blue}}>{isBuy?"매수":"매도"}</span>
                          <span style={{fontWeight:700}}>{sig.symbol}</span>
                          <span style={{fontSize:"10px",color:C.purple}}>{sig.strategyIcon} {sig.strategy}</span>
                          <span style={{fontSize:"9px",padding:"1px 4px",borderRadius:"3px",fontWeight:700,
                            background:sig.confidence>=0.7?C.greenBg:sig.confidence>=0.5?C.yellowBg:C.redBg,
                            color:confColor}}>{(sig.confidence*100).toFixed(0)}%</span>
                          {wasExec&&<span style={{fontSize:"9px",color:C.green,fontWeight:700}}>실행됨</span>}
                        </div>
                        {!wasExec&&(
                          <button onClick={()=>setOrderModal({symbol:sig.symbol,side:isBuy?"buy":"sell",
                            reason:`${sig.strategy}: ${sig.reason}`})} style={{
                            padding:"5px 10px",borderRadius:"6px",fontSize:"11px",fontWeight:700,
                            background:isBuy?C.red:C.blue,color:"#fff",border:"none",cursor:"pointer"}}>주문</button>
                        )}
                      </div>
                      <div style={{fontSize:"11px",color:C.text3}}>
                        {sig.reason} · ${fmt(sig.price)} · ATR {fmt(sig.atrPct,1)}% · {SECTOR_MAP[sig.symbol]||""}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── 자동매매 설정 ── */}
      {activeTab==="auto"&&(
        <div>
          <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:"16px",padding:"20px",marginBottom:"12px"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"16px"}}>
              <div>
                <div style={{fontWeight:700,fontSize:"15px"}}>퀀트 자동매매</div>
                <div style={{fontSize:"12px",color:C.text3,marginTop:"2px"}}>
                  리스크 관리 적용 · 브래킷 주문 · ATR 사이징
                </div>
              </div>
              <button onClick={()=>{setAutoTradeEnabled(!autoTradeEnabled);setTradingHalted(false);}} style={{
                width:"52px",height:"28px",borderRadius:"14px",border:"none",cursor:"pointer",
                background:autoTradeEnabled?C.green:C.border2,position:"relative",transition:"background 0.2s"}}>
                <div style={{width:"22px",height:"22px",borderRadius:"50%",background:"#fff",
                  position:"absolute",top:"3px",left:autoTradeEnabled?"27px":"3px",transition:"left 0.2s"}} />
              </button>
            </div>
            {autoTradeEnabled&&!tradingHalted&&(
              <div style={{background:C.greenBg,border:`1px solid ${C.green}33`,borderRadius:"10px",
                padding:"12px",fontSize:"12px",color:C.green,marginBottom:"12px"}}>
                자동매매 활성. 스탑로스 {tradeSettings.stopLossATR}×ATR / 익절 {tradeSettings.takeProfitATR}×ATR / 1건당 {tradeSettings.allocationPct}%
              </div>
            )}
            {tradingHalted&&(
              <div style={{background:C.redBg,border:`1px solid ${C.red}33`,borderRadius:"10px",
                padding:"12px",fontSize:"12px",color:C.red,marginBottom:"12px"}}>
                리스크 한도 초과로 자동매매가 중단되었습니다. 토글을 다시 켜서 재개할 수 있습니다.
              </div>
            )}

            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"12px",background:C.card2,borderRadius:"10px"}}>
              <div>
                <div style={{fontSize:"13px",fontWeight:600}}>자동 스캔 (5분)</div>
                <div style={{fontSize:"11px",color:C.text3}}>시장 데이터 자동 수집 + 시그널 감지</div>
              </div>
              <button onClick={()=>setAutoScanEnabled(!autoScanEnabled)} style={{
                width:"44px",height:"24px",borderRadius:"12px",border:"none",cursor:"pointer",
                background:autoScanEnabled?C.blue:C.border2,position:"relative",transition:"background 0.2s"}}>
                <div style={{width:"18px",height:"18px",borderRadius:"50%",background:"#fff",
                  position:"absolute",top:"3px",left:autoScanEnabled?"23px":"3px",transition:"left 0.2s"}} />
              </button>
            </div>
          </div>

          {/* 매매 설정 */}
          <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:"16px",padding:"20px",marginBottom:"12px"}}>
            <div style={{fontWeight:700,fontSize:"15px",marginBottom:"16px"}}>포지션 사이징</div>
            <div style={{display:"flex",flexDirection:"column",gap:"14px"}}>

              <div>
                <label style={{fontSize:"12px",color:C.text3,fontWeight:600,display:"block",marginBottom:"6px"}}>1건당 투자 비율</label>
                <div style={{display:"flex",gap:"4px"}}>
                  {[1,2,3,5].map(pct=>(
                    <button key={pct} onClick={()=>setTradeSettings(p=>({...p,allocationPct:pct}))} style={{
                      flex:1,padding:"8px",borderRadius:"8px",fontSize:"12px",fontWeight:600,
                      background:tradeSettings.allocationPct===pct?C.blueBg:"transparent",
                      color:tradeSettings.allocationPct===pct?C.blue:C.text3,
                      border:`1px solid ${tradeSettings.allocationPct===pct?C.blue:C.border2}`,cursor:"pointer"}}>{pct}%</button>
                  ))}
                </div>
                <div style={{fontSize:"11px",color:C.text3,marginTop:"4px"}}>
                  기준 약 {fmtUSD(equity*tradeSettings.allocationPct/100)} · ATR 변동성으로 자동 조정
                </div>
              </div>

              <div>
                <label style={{fontSize:"12px",color:C.text3,fontWeight:600,display:"block",marginBottom:"6px"}}>스탑로스 (ATR 배수)</label>
                <div style={{display:"flex",gap:"4px"}}>
                  {[1.5,2,2.5,3].map(n=>(
                    <button key={n} onClick={()=>setTradeSettings(p=>({...p,stopLossATR:n}))} style={{
                      flex:1,padding:"8px",borderRadius:"8px",fontSize:"12px",fontWeight:600,
                      background:tradeSettings.stopLossATR===n?C.redBg:"transparent",
                      color:tradeSettings.stopLossATR===n?C.red:C.text3,
                      border:`1px solid ${tradeSettings.stopLossATR===n?C.red:C.border2}`,cursor:"pointer"}}>{n}×</button>
                  ))}
                </div>
              </div>

              <div>
                <label style={{fontSize:"12px",color:C.text3,fontWeight:600,display:"block",marginBottom:"6px"}}>익절 (ATR 배수)</label>
                <div style={{display:"flex",gap:"4px"}}>
                  {[2,3,4,5].map(n=>(
                    <button key={n} onClick={()=>setTradeSettings(p=>({...p,takeProfitATR:n}))} style={{
                      flex:1,padding:"8px",borderRadius:"8px",fontSize:"12px",fontWeight:600,
                      background:tradeSettings.takeProfitATR===n?C.greenBg:"transparent",
                      color:tradeSettings.takeProfitATR===n?C.green:C.text3,
                      border:`1px solid ${tradeSettings.takeProfitATR===n?C.green:C.border2}`,cursor:"pointer"}}>{n}×</button>
                  ))}
                </div>
                <div style={{fontSize:"11px",color:C.text3,marginTop:"4px"}}>
                  R:R 비율 = 1:{fmt(tradeSettings.takeProfitATR/tradeSettings.stopLossATR,1)}
                </div>
              </div>

              <div>
                <label style={{fontSize:"12px",color:C.text3,fontWeight:600,display:"block",marginBottom:"6px"}}>최소 신뢰도</label>
                <div style={{display:"flex",gap:"4px"}}>
                  {[0.3,0.4,0.5,0.6,0.7].map(n=>(
                    <button key={n} onClick={()=>setTradeSettings(p=>({...p,minConfidence:n}))} style={{
                      flex:1,padding:"8px",borderRadius:"8px",fontSize:"12px",fontWeight:600,
                      background:tradeSettings.minConfidence===n?C.purpleBg:"transparent",
                      color:tradeSettings.minConfidence===n?C.purple:C.text3,
                      border:`1px solid ${tradeSettings.minConfidence===n?C.purple:C.border2}`,cursor:"pointer"}}>{n*100}%</button>
                  ))}
                </div>
              </div>

              <div>
                <label style={{fontSize:"12px",color:C.text3,fontWeight:600,display:"block",marginBottom:"6px"}}>종목 쿨다운 (시간)</label>
                <div style={{display:"flex",gap:"4px"}}>
                  {[6,12,24,48].map(n=>(
                    <button key={n} onClick={()=>setTradeSettings(p=>({...p,cooldownHours:n}))} style={{
                      flex:1,padding:"8px",borderRadius:"8px",fontSize:"12px",fontWeight:600,
                      background:tradeSettings.cooldownHours===n?C.blueBg:"transparent",
                      color:tradeSettings.cooldownHours===n?C.blue:C.text3,
                      border:`1px solid ${tradeSettings.cooldownHours===n?C.blue:C.border2}`,cursor:"pointer"}}>{n}h</button>
                  ))}
                </div>
              </div>

              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"12px",background:C.card2,borderRadius:"10px"}}>
                <div>
                  <div style={{fontSize:"13px",fontWeight:600}}>브래킷 주문</div>
                  <div style={{fontSize:"11px",color:C.text3}}>진입 시 자동 스탑로스 + 익절 주문</div>
                </div>
                <button onClick={()=>setTradeSettings(p=>({...p,useBracketOrders:!p.useBracketOrders}))} style={{
                  width:"44px",height:"24px",borderRadius:"12px",border:"none",cursor:"pointer",
                  background:tradeSettings.useBracketOrders?C.green:C.border2,position:"relative",transition:"background 0.2s"}}>
                  <div style={{width:"18px",height:"18px",borderRadius:"50%",background:"#fff",
                    position:"absolute",top:"3px",left:tradeSettings.useBracketOrders?"23px":"3px",transition:"left 0.2s"}} />
                </button>
              </div>
            </div>
          </div>

          {/* 전략 선택 */}
          <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:"16px",padding:"20px"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"16px"}}>
              <div>
                <div style={{fontWeight:700,fontSize:"15px"}}>활성 전략</div>
                <div style={{fontSize:"12px",color:C.text3,marginTop:"2px"}}>
                  {tradeSettings.strategies.length}/{Object.keys(STRATEGY_PORTFOLIOS).length}개 전략
                </div>
              </div>
              <button onClick={()=>{
                const all=Object.keys(STRATEGY_PORTFOLIOS);
                setTradeSettings(p=>({...p,strategies:p.strategies.length===all.length?[]:all}));
              }} style={{fontSize:"11px",color:C.blue,background:"none",border:"none",cursor:"pointer"}}>
                {tradeSettings.strategies.length===Object.keys(STRATEGY_PORTFOLIOS).length?"전체 해제":"전체 선택"}
              </button>
            </div>
            <div style={{display:"flex",flexWrap:"wrap",gap:"6px"}}>
              {Object.keys(STRATEGY_PORTFOLIOS).map(name=>{
                const strat=STRATEGY_MAP[name];
                const active=tradeSettings.strategies.includes(name);
                const conf=STRATEGY_CONFIDENCE[name]||0.5;
                return (
                  <button key={name} onClick={()=>{
                    setTradeSettings(p=>({...p,strategies:active?p.strategies.filter(s=>s!==name):[...p.strategies,name]}));
                  }} style={{
                    padding:"6px 10px",borderRadius:"8px",fontSize:"11px",fontWeight:600,
                    background:active?C.purpleBg:"transparent",color:active?C.purple:C.text3,
                    border:`1px solid ${active?C.purple+"55":C.border2}`,cursor:"pointer"}}>
                    {strat?.icon||"📊"} {name} <span style={{fontSize:"9px",opacity:0.7}}>{(conf*100).toFixed(0)}%</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 설정 동기화 — QR 코드 (PC ↔ 모바일) */}
          <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:"16px",padding:"20px"}}>
            <div style={{fontWeight:700,fontSize:"15px",marginBottom:"4px"}}>QR 설정 동기화</div>
            <div style={{fontSize:"11px",color:C.text3,marginBottom:"16px"}}>
              PC → QR 생성 → 모바일 카메라로 스캔 (API 키 포함)
            </div>
            <div style={{display:"flex",gap:"8px",flexWrap:"wrap"}}>
              <button onClick={async ()=>{
                try {
                  const payload = buildSyncPayload(config, tradeSettings, autoTradeEnabled, autoScanEnabled, tradingHalted);
                  const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
                  // QR에 담을 URL (모바일에서 URL 열면 자동 import)
                  const syncUrl = `${window.location.origin}${window.location.pathname}?tab=paper-trading&sync=${encoded}`;
                  await loadQRGenerator();
                  setQrSvg("");
                  setQrModal("generate");
                  // QRCode 라이브러리가 DOM 엘리먼트에 렌더하므로 약간의 딜레이 필요
                  setTimeout(() => {
                    const container = document.getElementById("di-qr-container");
                    if (!container) return;
                    container.innerHTML = "";
                    new window.QRCode(container, {
                      text: syncUrl,
                      width: 260,
                      height: 260,
                      colorDark: "#ffffff",
                      colorLight: "#0F1825",
                      correctLevel: window.QRCode.CorrectLevel.L,
                    });
                  }, 100);
                } catch (e) {
                  alert("QR 코드 생성 실패: " + e.message);
                }
              }} style={{
                flex:1,minWidth:"120px",padding:"14px",borderRadius:"10px",fontWeight:700,fontSize:"13px",
                background:C.blueBg,color:C.blue,border:`1px solid ${C.blue}55`,cursor:"pointer"}}>
                📱 QR 생성 (PC→모바일)
              </button>
              <button onClick={async ()=>{
                try {
                  await loadJsQR();
                  setQrModal("scan");
                  setTimeout(async () => {
                    try {
                      const stream = await navigator.mediaDevices.getUserMedia({
                        video: { facingMode: "environment", width: { ideal: 640 }, height: { ideal: 480 } }
                      });
                      qrStreamRef.current = stream;
                      if (videoRef.current) {
                        videoRef.current.srcObject = stream;
                        videoRef.current.play();
                        // 프레임 스캔 루프
                        const canvas = document.createElement("canvas");
                        const ctx = canvas.getContext("2d");
                        const scanLoop = () => {
                          if (!qrStreamRef.current) return;
                          const v = videoRef.current;
                          if (!v || v.readyState < 2) { requestAnimationFrame(scanLoop); return; }
                          canvas.width = v.videoWidth;
                          canvas.height = v.videoHeight;
                          ctx.drawImage(v, 0, 0);
                          const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                          const code = window.jsQR(imgData.data, canvas.width, canvas.height, { inversionAttempts: "dontInvert" });
                          if (code?.data) {
                            // QR 데이터 파싱
                            try {
                              let syncData = code.data;
                              // URL인 경우 sync 파라미터 추출
                              if (syncData.startsWith("http")) {
                                const url = new URL(syncData);
                                syncData = url.searchParams.get("sync");
                              }
                              if (!syncData) throw new Error("no sync data");
                              const payload = JSON.parse(decodeURIComponent(escape(atob(syncData))));
                              if (!payload.v) throw new Error("invalid");
                              // 스트림 정리
                              qrStreamRef.current?.getTracks().forEach(t => t.stop());
                              qrStreamRef.current = null;
                              setQrModal(null);
                              // 설정 적용
                              applySyncPayload(payload, setConfig, setTradeSettings, setAutoTradeEnabled, setAutoScanEnabled, setTradingHalted, config, save, KEYS);
                              const t = new Date(payload.ts).toLocaleString("ko-KR");
                              alert(`설정 동기화 완료!\n\n내보낸 시각: ${t}`);
                            } catch {
                              // 유효하지 않은 QR → 계속 스캔
                              requestAnimationFrame(scanLoop);
                              return;
                            }
                            return;
                          }
                          requestAnimationFrame(scanLoop);
                        };
                        requestAnimationFrame(scanLoop);
                      }
                    } catch (e) {
                      alert("카메라 접근 실패: " + e.message);
                      setQrModal(null);
                    }
                  }, 200);
                } catch (e) {
                  alert("QR 스캐너 로드 실패: " + e.message);
                }
              }} style={{
                flex:1,minWidth:"120px",padding:"14px",borderRadius:"10px",fontWeight:700,fontSize:"13px",
                background:C.greenBg,color:C.green,border:`1px solid ${C.green}55`,cursor:"pointer"}}>
                📷 QR 스캔 (모바일→PC)
              </button>
            </div>
            <div style={{fontSize:"10px",color:C.text3,marginTop:"8px"}}>
              API 키·시크릿 포함 · 주변에 다른 사람이 없을 때 사용하세요
            </div>
          </div>
        </div>
      )}

      {/* ── 리스크 대시보드 ── */}
      {activeTab==="risk"&&(
        <div>
          <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:"16px",padding:"20px",marginBottom:"12px"}}>
            <div style={{fontWeight:700,fontSize:"15px",marginBottom:"16px"}}>리스크 대시보드</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"8px",marginBottom:"16px"}}>
              <div style={{background:C.card2,borderRadius:"10px",padding:"12px"}}>
                <div style={{fontSize:"10px",color:C.text3}}>드로다운</div>
                <div style={{fontWeight:800,fontSize:"18px",color:rm.drawdown>tradeSettings.maxDrawdownPct*0.7?C.red:C.green}}>
                  {fmt(rm.drawdown)}%
                </div>
                <div style={{fontSize:"10px",color:C.text3}}>한도 {tradeSettings.maxDrawdownPct}%</div>
                <div style={{height:"4px",background:C.border,borderRadius:"2px",marginTop:"6px"}}>
                  <div style={{height:"100%",width:`${Math.min(100,rm.drawdown/tradeSettings.maxDrawdownPct*100)}%`,
                    background:rm.drawdown>tradeSettings.maxDrawdownPct*0.7?C.red:C.green,borderRadius:"2px"}} />
                </div>
              </div>
              <div style={{background:C.card2,borderRadius:"10px",padding:"12px"}}>
                <div style={{fontSize:"10px",color:C.text3}}>일일 P&L</div>
                <div style={{fontWeight:800,fontSize:"18px",color:dayPLPct>=0?C.green:C.red}}>{fmtPct(dayPLPct)}</div>
                <div style={{fontSize:"10px",color:C.text3}}>한도 -{tradeSettings.maxDailyLossPct}%</div>
              </div>
            </div>

            {/* 리스크 한도 설정 */}
            <div style={{display:"flex",flexDirection:"column",gap:"12px"}}>
              <div>
                <label style={{fontSize:"12px",color:C.text3,fontWeight:600,display:"block",marginBottom:"6px"}}>최대 드로다운 (%)</label>
                <div style={{display:"flex",gap:"4px"}}>
                  {[5,8,10,15,20].map(n=>(
                    <button key={n} onClick={()=>setTradeSettings(p=>({...p,maxDrawdownPct:n}))} style={{
                      flex:1,padding:"8px",borderRadius:"8px",fontSize:"12px",fontWeight:600,
                      background:tradeSettings.maxDrawdownPct===n?C.redBg:"transparent",
                      color:tradeSettings.maxDrawdownPct===n?C.red:C.text3,
                      border:`1px solid ${tradeSettings.maxDrawdownPct===n?C.red:C.border2}`,cursor:"pointer"}}>{n}%</button>
                  ))}
                </div>
              </div>
              <div>
                <label style={{fontSize:"12px",color:C.text3,fontWeight:600,display:"block",marginBottom:"6px"}}>일일 손실 한도 (%)</label>
                <div style={{display:"flex",gap:"4px"}}>
                  {[2,3,5,7].map(n=>(
                    <button key={n} onClick={()=>setTradeSettings(p=>({...p,maxDailyLossPct:n}))} style={{
                      flex:1,padding:"8px",borderRadius:"8px",fontSize:"12px",fontWeight:600,
                      background:tradeSettings.maxDailyLossPct===n?C.redBg:"transparent",
                      color:tradeSettings.maxDailyLossPct===n?C.red:C.text3,
                      border:`1px solid ${tradeSettings.maxDailyLossPct===n?C.red:C.border2}`,cursor:"pointer"}}>{n}%</button>
                  ))}
                </div>
              </div>
              <div>
                <label style={{fontSize:"12px",color:C.text3,fontWeight:600,display:"block",marginBottom:"6px"}}>섹터 집중도 한도 (%)</label>
                <div style={{display:"flex",gap:"4px"}}>
                  {[25,30,35,40,50].map(n=>(
                    <button key={n} onClick={()=>setTradeSettings(p=>({...p,maxSectorPct:n}))} style={{
                      flex:1,padding:"8px",borderRadius:"8px",fontSize:"12px",fontWeight:600,
                      background:tradeSettings.maxSectorPct===n?C.orangeBg:"transparent",
                      color:tradeSettings.maxSectorPct===n?C.orange:C.text3,
                      border:`1px solid ${tradeSettings.maxSectorPct===n?C.orange:C.border2}`,cursor:"pointer"}}>{n}%</button>
                  ))}
                </div>
              </div>
              <div>
                <label style={{fontSize:"12px",color:C.text3,fontWeight:600,display:"block",marginBottom:"6px"}}>개별 종목 한도 (%)</label>
                <div style={{display:"flex",gap:"4px"}}>
                  {[3,5,7,10].map(n=>(
                    <button key={n} onClick={()=>setTradeSettings(p=>({...p,maxSinglePct:n}))} style={{
                      flex:1,padding:"8px",borderRadius:"8px",fontSize:"12px",fontWeight:600,
                      background:tradeSettings.maxSinglePct===n?C.orangeBg:"transparent",
                      color:tradeSettings.maxSinglePct===n?C.orange:C.text3,
                      border:`1px solid ${tradeSettings.maxSinglePct===n?C.orange:C.border2}`,cursor:"pointer"}}>{n}%</button>
                  ))}
                </div>
              </div>
              <div>
                <label style={{fontSize:"12px",color:C.text3,fontWeight:600,display:"block",marginBottom:"6px"}}>최대 포지션 수</label>
                <div style={{display:"flex",gap:"4px"}}>
                  {[10,15,20,30].map(n=>(
                    <button key={n} onClick={()=>setTradeSettings(p=>({...p,maxPositions:n}))} style={{
                      flex:1,padding:"8px",borderRadius:"8px",fontSize:"12px",fontWeight:600,
                      background:tradeSettings.maxPositions===n?C.blueBg:"transparent",
                      color:tradeSettings.maxPositions===n?C.blue:C.text3,
                      border:`1px solid ${tradeSettings.maxPositions===n?C.blue:C.border2}`,cursor:"pointer"}}>{n}개</button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* 섹터 분포 */}
          <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:"16px",padding:"20px"}}>
            <div style={{fontWeight:700,fontSize:"15px",marginBottom:"12px"}}>섹터 분포</div>
            {positions.length===0?(
              <div style={{textAlign:"center",padding:"20px 0",color:C.text3}}>포지션 없음</div>
            ):(
              <div style={{display:"flex",flexDirection:"column",gap:"6px"}}>
                {Object.entries(rm.getSectorExposure()).sort((a,b)=>b[1]-a[1]).map(([sec,pct])=>(
                  <div key={sec}>
                    <div style={{display:"flex",justifyContent:"space-between",fontSize:"12px",marginBottom:"2px"}}>
                      <span style={{fontWeight:600}}>{sec}</span>
                      <span style={{color:pct>(tradeSettings.maxSectorPct||35)&&sec!=="ETF"?C.red:C.text2}}>{fmt(pct,1)}%</span>
                    </div>
                    <div style={{height:"6px",background:C.card2,borderRadius:"3px"}}>
                      <div style={{height:"100%",width:`${Math.min(100,pct)}%`,borderRadius:"3px",
                        background:pct>(tradeSettings.maxSectorPct||35)&&sec!=="ETF"?C.red:C.blue}} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── 로그 ── */}
      {activeTab==="log"&&(
        <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:"16px",padding:"20px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"12px"}}>
            <span style={{fontWeight:700}}>실행 로그 ({tradeLog.length})</span>
            {tradeLog.length>0&&(
              <button onClick={()=>setTradeLog([])} style={{fontSize:"11px",color:C.red,background:"none",border:"none",cursor:"pointer"}}>전체 삭제</button>
            )}
          </div>
          {tradeLog.length===0?(
            <div style={{textAlign:"center",padding:"30px 0",color:C.text3}}>실행 기록 없음</div>
          ):(
            <div style={{display:"flex",flexDirection:"column",gap:"4px",maxHeight:"500px",overflow:"auto"}}>
              {tradeLog.map((log,i)=>(
                <div key={i} style={{background:C.card2,borderRadius:"8px",padding:"10px 12px",
                  borderLeft:`3px solid ${log.error?C.red:C.green}`}}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:"2px"}}>
                    <div style={{display:"flex",alignItems:"center",gap:"6px",flexWrap:"wrap"}}>
                      <span style={{padding:"2px 6px",borderRadius:"4px",fontSize:"10px",fontWeight:700,
                        background:log.side==="BUY"?C.redBg:log.side==="SELL"?C.blueBg:C.yellowBg,
                        color:log.side==="BUY"?C.red:log.side==="SELL"?C.blue:C.yellow}}>
                        {log.side==="BUY"?"매수":log.side==="SELL"?"매도":log.side}</span>
                      <span style={{fontWeight:700,fontSize:"13px"}}>{log.symbol}</span>
                      {log.amount&&<span style={{fontSize:"10px",color:C.text2}}>{log.amount}</span>}
                      {log.confidence!=null&&(
                        <span style={{fontSize:"9px",color:C.purple}}>{(log.confidence*100).toFixed(0)}%</span>
                      )}
                      {log.strategy&&<span style={{fontSize:"10px",color:C.purple}}>{log.strategy}</span>}
                    </div>
                    <span style={{fontSize:"10px",color:C.text3}}>{log.time}</span>
                  </div>
                  {log.reason&&<div style={{fontSize:"10px",color:C.text3,marginBottom:"2px"}}>{log.reason}</div>}
                  {log.stopLoss&&(
                    <div style={{fontSize:"10px",color:C.text3}}>SL: {log.stopLoss} · TP: {log.takeProfit}</div>
                  )}
                  {log.error?(
                    <div style={{fontSize:"11px",color:C.red}}>{log.error}</div>
                  ):(
                    <div style={{fontSize:"11px",color:C.green}}>{log.status} · {log.orderId?.slice(0,12)}...</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── QR 모달 (생성 / 스캔) ── */}
      {qrModal && (
        <div style={{
          position:"fixed",top:0,left:0,right:0,bottom:0,zIndex:9999,
          background:"rgba(0,0,0,0.85)",display:"flex",alignItems:"center",justifyContent:"center",padding:"20px"
        }} onClick={(e)=>{
          if (e.target === e.currentTarget) {
            qrStreamRef.current?.getTracks().forEach(t => t.stop());
            qrStreamRef.current = null;
            setQrModal(null);
          }
        }}>
          <div style={{
            background:C.card,border:`1px solid ${C.border}`,borderRadius:"20px",padding:"28px",
            maxWidth:"360px",width:"100%",textAlign:"center"
          }}>
            {qrModal === "generate" && (
              <>
                <div style={{fontWeight:800,fontSize:"18px",marginBottom:"6px"}}>📱 QR 코드</div>
                <div style={{fontSize:"12px",color:C.text3,marginBottom:"20px"}}>
                  모바일에서 카메라로 스캔하세요
                </div>
                <div id="di-qr-container" style={{
                  display:"inline-block",padding:"16px",background:"#0F1825",borderRadius:"16px",
                  border:`1px solid ${C.border}`
                }} />
                <div style={{fontSize:"10px",color:C.text3,marginTop:"16px"}}>
                  API 키 포함 — 주변에 다른 사람이 없을 때 사용
                </div>
              </>
            )}
            {qrModal === "scan" && (
              <>
                <div style={{fontWeight:800,fontSize:"18px",marginBottom:"6px"}}>📷 QR 스캔</div>
                <div style={{fontSize:"12px",color:C.text3,marginBottom:"16px"}}>
                  다른 기기에 표시된 QR 코드를 비추세요
                </div>
                <div style={{borderRadius:"12px",overflow:"hidden",background:"#000",position:"relative"}}>
                  <video ref={videoRef} style={{width:"100%",height:"auto",display:"block"}} playsInline muted />
                  <div style={{
                    position:"absolute",top:"50%",left:"50%",transform:"translate(-50%,-50%)",
                    width:"180px",height:"180px",border:"3px solid "+C.blue,borderRadius:"16px",
                    boxShadow:`0 0 0 2000px rgba(0,0,0,0.4)`
                  }} />
                </div>
                <div style={{fontSize:"11px",color:C.blue,marginTop:"12px",animation:"pulse 1.5s ease-in-out infinite"}}>
                  스캔 대기 중...
                </div>
              </>
            )}
            <button onClick={()=>{
              qrStreamRef.current?.getTracks().forEach(t => t.stop());
              qrStreamRef.current = null;
              setQrModal(null);
            }} style={{
              marginTop:"20px",padding:"12px 32px",borderRadius:"10px",fontWeight:700,fontSize:"13px",
              background:C.card2,color:C.text2,border:`1px solid ${C.border2}`,cursor:"pointer",width:"100%"
            }}>닫기</button>
          </div>
        </div>
      )}
    </div>
  );
}
