// Zepta — 퀀트 전략 기반 자동매매 시스템 v3.0 (Production-Grade)
// 리스크 관리 · 브래킷 주문 · 드로다운 보호 · 시그널 신뢰도 · 변동성 사이징
// KV 가상 포트폴리오 매매
import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { ALL_STRATEGIES } from "./strategies.js";
import { STRATEGY_PORTFOLIOS as RAW_PORTFOLIOS } from "./QuantPortfolio.jsx";

const DARK_C = {
  bg: "#0B0F19", card: "#131B2E", card2: "#1A2438",
  border: "#1F2E42", border2: "#2A3F58",
  blue: "#3B8BFF", blueL: "#64ABFF", blueBg: "#182D54",
  red: "#FF4D5E", redBg: "#2C1520",
  green: "#00D47E", greenBg: "#0B2E1E",
  yellow: "#FFC233", yellowBg: "#2B2100",
  purple: "#9B6FFF", purpleBg: "#201840",
  orange: "#FF6B2C", orangeBg: "#2A1A0A",
  text1: "#F0F2F7", text2: "#94A3B8", text3: "#64748B",
  isDark: true,
};
const LIGHT_C = {
  bg: "#F8F9FB", card: "#FFFFFF", card2: "#F1F3F6",
  border: "#E2E5EA", border2: "#D1D5DC",
  blue: "#2563EB", blueL: "#3B82F6", blueBg: "#DBEAFE",
  red: "#DC2626", redBg: "#FEF2F2",
  green: "#16A34A", greenBg: "#F0FDF4",
  yellow: "#D97706", yellowBg: "#FFFBEB",
  purple: "#7C3AED", purpleBg: "#F3F0FF",
  orange: "#EA580C", orangeBg: "#FFF7ED",
  text1: "#0F172A", text2: "#475569", text3: "#94A3B8",
  isDark: false,
};
// C is dynamically selected inside component via getC(theme)

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
  "₿ BTC 알파 전략": 0.8,
  // 알파 전략 (시장 비효율성 — 높은 신뢰도)
  "🧬 Hurst 레짐 스위칭": 0.85,
  "⚡ 변동성 군집 돌파": 0.80,
  "📐 효율성 비율 전략": 0.85,
  "📉 모멘텀 감쇠 포착": 0.80,
  "🔮 정보흐름 감지": 0.85,
};

// ══════════════════════════════════════════════════════════════
// QuantPortfolio 원본 33개 전략에서 US 종목만 자동 추출 + 비중 정규화
// .KS(한국) / -USD(크립토) 제외 → 미국 주식만
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

function collectUSSymbols(activeStrategies) {
  const syms = new Set();
  for (const [name, holdings] of Object.entries(STRATEGY_PORTFOLIOS)) {
    // activeStrategies가 주어지면 해당 전략의 종목만 수집
    if (activeStrategies && !activeStrategies.includes(name)) continue;
    for (const { sym } of holdings) syms.add(sym);
  }
  return [...syms];
}

// ══════════════════════════════════════════════════════════════
// Storage (localStorage + cookie 이중 저장 — iOS 홈화면 추가 대응)
// iOS standalone PWA는 Safari와 localStorage가 분리되므로
// config는 cookie에도 저장하여 브라우저↔홈화면 앱 간 공유
// ══════════════════════════════════════════════════════════════
// userId가 있으면 유저별 키, 없으면 기본 키 (하위호환)
function makeKeys(userId) {
  const p = userId ? `di_${userId.slice(0, 8)}_` : "di_";
  return {
    config: `${p}virtual_portfolio_config`,
    autoTrade: `${p}auto_trade_v3`,
    tradeLog: `${p}trade_log_v3`,
    executed: `${p}executed_v3`,
    settings: `${p}trade_settings_v3`,
    riskState: `${p}risk_state`,
    peakEquity: `${p}peak_equity`,
  };
}
let KEYS = makeKeys(null);

function setCookie(name, val, days = 365) {
  try {
    const d = new Date(); d.setTime(d.getTime() + days * 86400000);
    document.cookie = `${name}=${encodeURIComponent(val)};expires=${d.toUTCString()};path=/;SameSite=Lax`;
  } catch {}
}
function getCookie(name) {
  try {
    const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
    return m ? decodeURIComponent(m[1]) : null;
  } catch { return null; }
}

function load(key, fallback) {
  try {
    // localStorage 우선, 없으면 cookie fallback (iOS standalone 대응)
    const ls = localStorage.getItem(key);
    if (ls) return JSON.parse(ls);
    if (key === KEYS.config) {
      const ck = getCookie("di_config");
      if (ck) { const parsed = JSON.parse(ck); localStorage.setItem(key, ck); return parsed; }
    }
    if (key === KEYS.settings) {
      const ck = getCookie("di_settings");
      if (ck) { const parsed = JSON.parse(ck); localStorage.setItem(key, ck); return parsed; }
    }
    return fallback;
  } catch { return fallback; }
}
function save(key, val) {
  try {
    const json = JSON.stringify(val);
    localStorage.setItem(key, json);
    // config와 settings는 cookie에도 저장 (iOS standalone 공유)
    if (key === KEYS.config) setCookie("di_config", json);
    if (key === KEYS.settings) setCookie("di_settings", json);
  } catch {}
}

// ══════════════════════════════════════════════════════════════
// KV Virtual Stock Portfolio API
// ══════════════════════════════════════════════════════════════
async function virtualStockAPI(action, config = {}, params = {}, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const ctrl = new AbortController();
      const tmr = setTimeout(() => ctrl.abort(), 15000);

      if (action === "account") {
        const res = await fetch("/api/virtual-portfolio?type=stock", { signal: ctrl.signal }).finally(() => clearTimeout(tmr));
        if (!res.ok) throw new Error(`API Error ${res.status}`);
        const data = await res.json();
        // Transform virtual portfolio response to account-like format
        return {
          id: data.id || "virtual-stock",
          equity: parseFloat(data.equity || 0),
          cash: parseFloat(data.cash || 0),
          buying_power: parseFloat(data.buying_power || 0),
          portfolio_value: parseFloat(data.portfolio_value || 0),
          last_equity: parseFloat(data.last_equity || 0),
        };
      } else if (action === "positions") {
        const res = await fetch("/api/virtual-portfolio?type=stock", { signal: ctrl.signal }).finally(() => clearTimeout(tmr));
        if (!res.ok) throw new Error(`API Error ${res.status}`);
        const data = await res.json();
        return Array.isArray(data.positions) ? data.positions : [];
      } else if (action === "orders") {
        // Orders are now handled by cron, return empty
        return [];
      } else if (action === "clock") {
        // Market clock - always return open for virtual trading
        return { is_open: true };
      } else if (action === "submit_order") {
        // For now, just show a notification that the bot will process it
        console.log("주문 수신:", params);
        // In the future, this could call /api/virtual-trade with POST
        // For now, make it a no-op as orders are handled by cron
        return { status: "pending", message: "주문이 큐에 추가되었습니다" };
      } else if (action === "close_position") {
        // No-op for virtual portfolio (cron handles closing)
        console.log("포지션 청산 요청:", params);
        return { status: "pending" };
      } else if (action === "cancel_order") {
        // No-op for virtual portfolio
        console.log("주문 취소 요청:", params);
        return { status: "cancelled" };
      } else if (action === "close_all") {
        // No-op for virtual portfolio
        console.log("전체 청산 요청");
        return { status: "pending" };
      } else if (action === "cancel_all") {
        // No-op for virtual portfolio
        console.log("전체 주문 취소 요청");
        return { status: "pending" };
      } else {
        throw new Error(`Unknown action: ${action}`);
      }
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
        const json = await res.json();
        const data = json.results || json; // yahoo-batch는 { results: { SYM: {...} } }
        for (const sym of batch) {
          const d = data[sym];
          if (!d?.closes?.length) continue;
          const candles = [];
          for (let j = 0; j < d.closes.length; j++) {
            if (d.closes[j] == null) continue;
            candles.push({
              time: (d.timestamps?.[j] || 0) * 1000,
              open: d.opens?.[j] || d.closes[j],
              high: d.highs?.[j] || d.closes[j],
              low: d.lows?.[j] || d.closes[j],
              close: d.closes[j],
              volume: d.volumes?.[j] || 0,
            });
          }
          if (candles.length > 30) results[sym] = candles;
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
// 마켓 레짐 감지 (Wall Street Regime Detection)
// VIX/변동성 기반 시장 상태: trending / mean-reverting / volatile
// 레짐에 따라 전략 가중치를 동적으로 조절
// ══════════════════════════════════════════════════════════════
function detectMarketRegime(candleMap) {
  // SPY를 시장 대리지표로 사용
  const spy = candleMap["SPY"] || candleMap["QQQ"];
  if (!spy || spy.length < 60) return { regime: "unknown", strength: 0.5, volatility: "normal" };

  const len = spy.length;
  const recent = spy.slice(-20);
  const mid = spy.slice(-40, -20);

  // 1) 추세 강도: 20일 수익률 방향성
  const returns20d = (recent[recent.length - 1].close - recent[0].close) / recent[0].close;
  const absReturns20d = Math.abs(returns20d);

  // 2) 변동성 레짐: 최근 20일 표준편차 vs 40일 전 20일 표준편차
  const calcStdDev = (candles) => {
    const rets = [];
    for (let i = 1; i < candles.length; i++) {
      rets.push((candles[i].close - candles[i - 1].close) / candles[i - 1].close);
    }
    const mean = rets.reduce((s, r) => s + r, 0) / rets.length;
    const variance = rets.reduce((s, r) => s + (r - mean) ** 2, 0) / rets.length;
    return Math.sqrt(variance);
  };

  const recentVol = calcStdDev(recent);
  const pastVol = mid.length >= 10 ? calcStdDev(mid) : recentVol;
  const volRatio = pastVol > 0 ? recentVol / pastVol : 1;
  const annualizedVol = recentVol * Math.sqrt(252) * 100; // 연환산 %

  // 3) ADX 유사 계산 (추세 강도)
  let plusDM = 0, minusDM = 0, trSum = 0;
  for (let i = len - 14; i < len; i++) {
    const c = spy[i], p = spy[i - 1];
    const upMove = c.high - p.high;
    const downMove = p.low - c.low;
    plusDM += (upMove > downMove && upMove > 0) ? upMove : 0;
    minusDM += (downMove > upMove && downMove > 0) ? downMove : 0;
    trSum += Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
  }
  const adxProxy = trSum > 0 ? Math.abs(plusDM - minusDM) / trSum * 100 : 0;

  // 4) 레짐 분류
  let regime, strength;
  const volatility = annualizedVol > 25 ? "high" : annualizedVol > 15 ? "normal" : "low";

  if (adxProxy > 20 && absReturns20d > 0.03) {
    regime = "trending";     // 강한 추세 (모멘텀 전략 유리)
    strength = Math.min(1, adxProxy / 40);
  } else if (volatility === "high" && volRatio > 1.3) {
    regime = "volatile";     // 고변동성 (리스크 축소, 방어적)
    strength = Math.min(1, volRatio / 2);
  } else {
    regime = "mean-reverting"; // 박스권 (평균회귀 전략 유리)
    strength = Math.min(1, (1 - absReturns20d / 0.05));
  }

  return { regime, strength, volatility, annualizedVol, adxProxy, trendDir: returns20d > 0 ? "bull" : "bear" };
}

// 레짐별 전략 카테고리 가중치
const REGIME_WEIGHTS = {
  "trending":       { "추세추종": 1.4, "모멘텀": 1.3, "평균회귀": 0.6, "패턴": 0.9, "복합": 1.1 },
  "mean-reverting": { "추세추종": 0.7, "모멘텀": 0.7, "평균회귀": 1.4, "패턴": 1.1, "복합": 1.0 },
  "volatile":       { "추세추종": 0.5, "모멘텀": 0.5, "평균회귀": 0.8, "패턴": 0.7, "복합": 1.2 },
  "unknown":        { "추세추종": 1.0, "모멘텀": 1.0, "평균회귀": 1.0, "패턴": 1.0, "복합": 1.0 },
};

// 전략명 → 카테고리 매핑
const STRATEGY_CATEGORY_MAP = {
  "이평선 크로스 (20/60)": "추세추종", "MACD 크로스오버": "추세추종", "거래량 돌파 전략": "추세추종",
  "터틀 트레이딩": "추세추종", "슈퍼트렌드": "추세추종", "OBV 추세 추종": "추세추종",
  "채널 돌파 모멘텀": "추세추종", "헤이킨 아시 추세": "추세추종", "파라볼릭 SAR": "추세추종",
  "듀얼 모멘텀": "모멘텀", "듀얼 타임프레임 모멘텀": "모멘텀", "모멘텀·거래량 가중": "모멘텀",
  "갭 앤 고": "모멘텀",
  "RSI 반전 전략": "평균회귀", "볼린저밴드 바운스": "평균회귀", "켈트너 채널 회귀": "평균회귀",
  "VWAP 반전": "평균회귀", "래리 코너스 RSI(2)": "평균회귀", "MFI 자금유입": "평균회귀",
  "스토캐스틱+RSI 콤보": "평균회귀", "CCI 오실레이터": "평균회귀",
  "피보나치 되돌림": "패턴", "캔들 패턴 (엔궐핑)": "패턴", "BB 스퀴즈 돌파": "패턴",
  "일목균형표": "패턴", "MACD 다이버전스": "패턴",
  "엘더 삼중 필터": "복합", "레짐 전환 적응형": "복합", "삼중 이평선 + ATR 정지": "복합",
  "Williams %R + ADX": "복합", "통계적 차익 (Z-Score)": "복합", "ATR 스윙": "복합",
  // 알파 전략
  "🧬 Hurst 레짐 스위칭": "복합", "⚡ 변동성 군집 돌파": "추세추종",
  "📐 효율성 비율 전략": "모멘텀", "📉 모멘텀 감쇠 포착": "평균회귀",
  "🔮 정보흐름 감지": "복합",
};

// ══════════════════════════════════════════════════════════════
// 전략 성과 추적 (동적 가중치 — 최근 승률 기반)
// ══════════════════════════════════════════════════════════════
function loadStrategyPerformance() {
  return load("di_strat_perf", {});
}
function saveStrategyPerformance(perf) {
  save("di_strat_perf", perf);
}
function getStrategyDynamicWeight(stratName) {
  const perf = loadStrategyPerformance();
  const s = perf[stratName];
  if (!s || (s.wins + s.losses) < 3) return 1.0; // 데이터 부족 시 기본값
  const winRate = s.wins / (s.wins + s.losses);
  // 승률 50% 기준 — 60%면 1.2배, 40%면 0.8배
  return Math.max(0.4, Math.min(1.6, 0.4 + winRate * 1.6));
}

// ══════════════════════════════════════════════════════════════
// 앙상블 시그널 감지 (Wall Street Ensemble Scoring)
// 여러 전략이 같은 종목·방향에 동시 신호 → 복합 신뢰도 합산
// ══════════════════════════════════════════════════════════════
function detectSignals(candleMap) {
  const rawSignals = [];
  const now = Date.now();
  const regime = detectMarketRegime(candleMap);

  for (const [stratName, holdings] of Object.entries(STRATEGY_PORTFOLIOS)) {
    const strategy = STRATEGY_MAP[stratName];
    if (!strategy?.generate) continue;
    const baseConfidence = STRATEGY_CONFIDENCE[stratName] || 0.5;

    for (const { sym, w } of holdings) {
      const candles = candleMap[sym];
      if (!candles || candles.length < 30) continue;

      try {
        const sigs = strategy.generate(candles);
        if (!sigs?.length) continue;

        const recent = sigs.filter(s => s.index >= candles.length - 3);
        for (const sig of recent) {
          const candle = candles[sig.index] || candles[candles.length - 1];
          const atr = calcATR(candles);
          const lastPrice = candles[candles.length - 1].close;
          const signalAge = candles.length - 1 - sig.index;
          const agePenalty = 1 - (signalAge * 0.15);

          // 레짐 가중치
          const cat = STRATEGY_CATEGORY_MAP[stratName] || "복합";
          const regimeW = (REGIME_WEIGHTS[regime.regime] || REGIME_WEIGHTS.unknown)[cat] || 1.0;

          // 동적 성과 가중치
          const perfW = getStrategyDynamicWeight(stratName);

          // 최종 개별 신뢰도 = 기본 × 나이감쇠 × 레짐 × 성과
          const finalConfidence = Math.max(0.05, baseConfidence * agePenalty * regimeW * perfW);

          rawSignals.push({
            id: `${stratName}-${sym}-${sig.type}-${candle.time}`,
            strategy: stratName,
            strategyIcon: strategy.icon || "📊",
            category: cat,
            symbol: sym,
            sector: SECTOR_MAP[sym] || "Other",
            type: sig.type,
            price: lastPrice,
            signalPrice: sig.price || candle.close,
            reason: sig.reason || `${stratName} ${sig.type}`,
            weight: w,
            confidence: finalConfidence,
            atr, atrPct: lastPrice > 0 ? (atr / lastPrice) * 100 : 0,
            time: candle.time, detectedAt: now, signalAge,
            regimeBoost: regimeW, perfBoost: perfW,
          });
        }
      } catch {}
    }
  }

  // ── 앙상블 합산: 같은 (종목 + 방향) 시그널을 합쳐서 복합 점수 ──
  const ensembleMap = {}; // key: "SYM|BUY" → aggregated signal
  for (const sig of rawSignals) {
    const key = `${sig.symbol}|${sig.type}`;
    if (!ensembleMap[key]) {
      ensembleMap[key] = {
        ...sig,
        strategies: [sig.strategy],
        ensembleCount: 1,
        rawConfidences: [sig.confidence],
        // 앙상블 ID (합산된 시그널은 첫 번째 ID 사용)
        originalIds: [sig.id],
      };
    } else {
      const e = ensembleMap[key];
      e.strategies.push(sig.strategy);
      e.ensembleCount++;
      e.rawConfidences.push(sig.confidence);
      e.originalIds.push(sig.id);
      // 최고 신뢰도 시그널의 정보를 기본으로
      if (sig.confidence > e.confidence) {
        e.strategy = sig.strategy;
        e.strategyIcon = sig.strategyIcon;
        e.reason = sig.reason;
        e.signalPrice = sig.signalPrice;
        e.time = sig.time;
      }
    }
  }

  // 앙상블 스코어 계산 + 신호 품질 개선
  const signals = Object.values(ensembleMap).map(e => {
    // 앙상블 보너스: 2개 전략 합의 → +30%, 3개 → +50%, 4+ → +65%
    const bonusMap = { 1: 1.0, 2: 1.3, 3: 1.5, 4: 1.65 };
    const bonus = bonusMap[Math.min(e.ensembleCount, 4)] || 1.65;
    // 최고 신뢰도 기반 + 앙상블 보너스 (cap: 0.95)
    const maxConf = Math.max(...e.rawConfidences);
    const avgConf = e.rawConfidences.reduce((s, c) => s + c, 0) / e.rawConfidences.length;
    // 가중 합산: 70% 최고 + 30% 평균 → × 앙상블 보너스
    let baseConfidence = Math.min(0.95, (maxConf * 0.7 + avgConf * 0.3) * bonus);

    // ── 신호 품질 스코어링 개선 ──
    let qualityBoost = 1.0;

    // 거래량 확인: 위 평균 거래량이면 +15% 부스트
    const candlesForVol = candleMap[e.symbol];
    if (candlesForVol && candlesForVol.length > 0) {
      const recentVol = candlesForVol[candlesForVol.length - 1].volume || 0;
      const avgVol = candlesForVol.slice(-20).reduce((s, c) => s + (c.volume || 0), 0) / Math.min(20, candlesForVol.length);
      if (recentVol > avgVol) {
        qualityBoost *= 1.15; // +15% 부스트
      }
    }

    // 다중 시간프레임 확인: 주간 추세가 일일 신호와 합의하면 +20%
    if (regime && e.type === "BUY" && regime.regime === "trending") {
      qualityBoost *= 1.2; // +20% 부스트
    } else if (regime && e.type === "SELL" && regime.regime === "reverting") {
      qualityBoost *= 1.2;
    }

    // 상대 강도 (모멘텀) 순위: SPY 대비 이 종목의 강도
    const candlesSpy = candleMap["SPY"];
    if (candlesSpy && candlesSpy.length > 0) {
      const symbolMom = (candlesForVol[candlesForVol.length - 1].close - candlesForVol[Math.max(0, candlesForVol.length - 21)].close) / candlesForVol[Math.max(0, candlesForVol.length - 21)].close;
      const spyMom = (candlesSpy[candlesSpy.length - 1].close - candlesSpy[Math.max(0, candlesSpy.length - 21)].close) / candlesSpy[Math.max(0, candlesSpy.length - 21)].close;
      if ((e.type === "BUY" && symbolMom > spyMom) || (e.type === "SELL" && symbolMom < spyMom)) {
        qualityBoost *= 1.1; // +10% 부스트 상대강도 우위
      }
    }

    // 신호 신선도 감쇠 개선: 선형 → 지수함수 (더 가파른 감쇠)
    const signalAge = e.signalAge || 0;
    const freshnessPenalty = Math.exp(-signalAge * 0.5); // 지수 감쇠
    baseConfidence *= freshnessPenalty;

    e.confidence = Math.min(0.98, baseConfidence * qualityBoost);
    e.ensembleScore = e.confidence;
    e.qualityBoost = qualityBoost;

    // 시그널 컨플릭트 감지: 같은 종목에 BUY와 SELL이 동시에 있으면 플래그
    e.isConflicting = false;

    e.reason = e.ensembleCount > 1
      ? `[앙상블 ${e.ensembleCount}x] ${e.strategies.slice(0, 3).join(" + ")}${e.ensembleCount > 3 ? ` 외 ${e.ensembleCount - 3}개` : ""}`
      : e.reason;
    return e;
  });

  // 시그널 컨플릭트 감지: 같은 종목의 반대 신호들을 낮춤
  const symbolBuySellMap = {};
  for (const sig of signals) {
    const key = sig.symbol;
    if (!symbolBuySellMap[key]) symbolBuySellMap[key] = { buy: [], sell: [] };
    if (sig.type === "BUY") symbolBuySellMap[key].buy.push(sig);
    else if (sig.type === "SELL") symbolBuySellMap[key].sell.push(sig);
  }
  for (const [sym, { buy, sell }] of Object.entries(symbolBuySellMap)) {
    if (buy.length > 0 && sell.length > 0) {
      // 상충 신호 감지: 둘 다 신뢰도를 낮춤 (각 30% 감소)
      for (const s of [...buy, ...sell]) {
        s.confidence *= 0.7;
        s.isConflicting = true;
      }
    }
  }

  // 신뢰도 높은 순 → 최신 순
  signals.sort((a, b) => b.confidence - a.confidence || b.time - a.time);

  // 레짐 정보를 signals 배열에 첨부
  signals._regime = regime;
  return signals;
}

// ══════════════════════════════════════════════════════════════
// 리스크 관리 엔진 v3 (Enterprise Grade)
// VaR · 포트폴리오 베타 · Sharpe/Sortino/Calmar · 6단계 드로다운 보호 · TWAP
// ══════════════════════════════════════════════════════════════
class RiskManager {
  constructor(settings, account, positions) {
    this.s = settings;
    this.equity = parseFloat(account?.equity || 0);
    this.cash = parseFloat(account?.cash || 0);
    this.positions = positions || [];
    this.peakEquity = Math.max(load(KEYS.peakEquity, 100000), this.equity);
    save(KEYS.peakEquity, this.peakEquity);
    this.positionReturns = []; // 포지션별 수익률 히스토리 (VaR용)
  }

  get drawdown() {
    return this.peakEquity > 0 ? ((this.peakEquity - this.equity) / this.peakEquity) * 100 : 0;
  }

  dailyPL(account) {
    const lastEq = parseFloat(account?.last_equity || account?.equity || 0);
    return lastEq > 0 ? ((this.equity - lastEq) / lastEq) * 100 : 0;
  }

  isDrawdownBreached() {
    return this.drawdown >= (this.s.maxDrawdownPct || 10);
  }

  isDailyLossBreached(account) {
    return this.dailyPL(account) <= -(this.s.maxDailyLossPct || 3);
  }

  // 6단계 드로다운 보호 (Enhanced Progressive Risk Reduction)
  // 0-2%: 100%, 2-4%: 85%, 4-6%: 65%, 6-8%: 45%, 8-10%: 25%, 10%+: 0%
  get drawdownMultiplier() {
    const dd = this.drawdown;
    if (dd < 2) return 1.0;
    if (dd < 4) return 0.85;
    if (dd < 6) return 0.65;
    if (dd < 8) return 0.45;
    if (dd < 10) return 0.25;
    return 0.0; // 10% 이상 트레이딩 정지
  }

  // VaR (Value at Risk) — 95% 신뢰도, 역사적 시뮬레이션
  calcVaR(confidence = 0.95) {
    if (this.positionReturns.length < 10) return 0; // 최소 10개 데이터
    const sorted = [...this.positionReturns].sort((a, b) => a - b);
    const idx = Math.floor(sorted.length * (1 - confidence));
    const varReturn = sorted[idx];
    return Math.abs(varReturn * this.equity);
  }

  // 포트폴리오 베타 (SPY 기준)
  calcPortfolioBeta() {
    if (this.positions.length === 0) return 1.0;
    // 단순 평균 베타 (각 섹터별 베타 근사)
    const betaMap = {
      "Tech": 1.2, "Consumer": 1.1, "Finance": 1.05, "Health": 0.9,
      "Energy": 0.95, "Industrial": 1.05, "ETF": 1.0, "Other": 1.0
    };
    let totalBeta = 0;
    for (const pos of this.positions) {
      const sector = SECTOR_MAP[pos.symbol] || "Other";
      totalBeta += betaMap[sector] || 1.0;
    }
    return this.positions.length > 0 ? totalBeta / this.positions.length : 1.0;
  }

  // Sharpe Ratio (연간화) — (평균수익 - 무위험율) / 표준편차
  calcSharpeRatio(dailyReturns = []) {
    if (dailyReturns.length < 2) return 0;
    const avgReturn = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
    const variance = dailyReturns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / dailyReturns.length;
    const stdDev = Math.sqrt(variance);
    const riskFreeRate = 0.04 / 252; // 연 4%, 일일 환산
    return stdDev > 0 ? ((avgReturn - riskFreeRate) / stdDev) * Math.sqrt(252) : 0;
  }

  // Sortino Ratio — downside-only volatility 기반
  calcSortinoRatio(dailyReturns = []) {
    if (dailyReturns.length < 2) return 0;
    const avgReturn = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
    const downside = dailyReturns.filter(r => r < 0).map(r => Math.pow(r, 2));
    const downVariance = downside.reduce((a, b) => a + b, 0) / dailyReturns.length;
    const downStdDev = Math.sqrt(downVariance);
    const riskFreeRate = 0.04 / 252;
    return downStdDev > 0 ? ((avgReturn - riskFreeRate) / downStdDev) * Math.sqrt(252) : 0;
  }

  // Calmar Ratio — 연수익 / 최대드로다운
  calcCalmarRatio(annualReturn = 0) {
    return this.drawdown > 0 ? annualReturn / this.drawdown : 0;
  }

  // 포트폴리오 Heat — 배포된 총 리스크 (자산 기준 %)
  calcPortfolioHeat() {
    const usedEquity = this.positions.reduce((sum, p) => sum + Math.abs(parseFloat(p.market_value || 0)), 0);
    return this.equity > 0 ? (usedEquity / this.equity) * 100 : 0;
  }

  // 장중 모멘텀 필터 — 강한 추세에 역진입 방지
  shouldFilterIntradayMomentum(symbol, candleMap) {
    const candles = candleMap[symbol];
    if (!candles || candles.length < 10) return false;
    // 최근 5개 봉 기준 강한 방향성 체크
    const recent = candles.slice(-5);
    const closes = recent.map(c => c.close);
    const trend = closes[closes.length - 1] - closes[0];
    const atr = calcATR(candles);
    // ATR 대비 3배 이상이면 강한 추세 → 반대 진입 제한
    return Math.abs(trend) > atr * 3;
  }

  // 최대 오픈 주문 한도 체크
  checkMaxOpenOrders(currentOrders) {
    const maxOpenOrders = this.s.maxOpenOrders || 10;
    return currentOrders.length < maxOpenOrders;
  }

  // 오버나이트 리스크 조정 — 장시간 홀딩 포지션 축소
  getOvernightAdjustment(symbol) {
    const pos = this.positions.find(p => p.symbol === symbol);
    if (!pos) return 1.0;
    // 매수 후 경과 시간 (하루 이상이면 0.7배)
    const holdDays = (Date.now() - parseFloat(pos.created_at || Date.now())) / (1000 * 3600 * 24);
    return holdDays > 1 ? 0.7 : 1.0;
  }

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
    if (sector === "ETF") return true;
    const exposure = this.getSectorExposure();
    return (exposure[sector] || 0) < (this.s.maxSectorPct || 35);
  }

  canAddToSymbol(symbol) {
    const existing = this.positions.find(p => p.symbol === symbol);
    if (!existing) return true;
    const posValue = Math.abs(parseFloat(existing.market_value || 0));
    const maxPosValue = this.equity * (this.s.maxSinglePct || 5) / 100;
    return posValue < maxPosValue;
  }

  // 상관관계 필터: 같은 섹터에 이미 2+ 포지션이면 추가 진입 제한
  isCorrelatedRisk(symbol) {
    const sector = SECTOR_MAP[symbol] || "Other";
    if (sector === "ETF") return false;
    const sameSector = this.positions.filter(p => (SECTOR_MAP[p.symbol] || "Other") === sector);
    // 같은 섹터 3개 이상이면 상관위험 경고
    return sameSector.length >= 3;
  }

  // 켈리 기준 포지션 사이징 (Half-Kelly for safety)
  // f* = (bp - q) / b  →  b=승배비, p=승률, q=패률
  calcKellyFraction(signal) {
    const perf = loadStrategyPerformance();
    const s = perf[signal.strategy];
    // 충분한 데이터 없으면 기본값
    if (!s || (s.wins + s.losses) < 5) return 0.05; // 기본 5%
    const p = s.wins / (s.wins + s.losses);
    const q = 1 - p;
    const avgWin = s.avgWin || 1;
    const avgLoss = s.avgLoss || 1;
    const b = avgLoss > 0 ? avgWin / avgLoss : 1.5;
    const kelly = (b * p - q) / b;
    // Half-Kelly (안전계수 50%), 최소 1%, 최대 12%
    return Math.max(0.01, Math.min(0.12, kelly * 0.5));
  }

  // 향상된 포지션 사이징 (ATR + 켈리 + 레짐 + 드로다운 + 오버나이트 조절)
  calcPositionSize(signal, regime) {
    const allocPct = this.s.allocationPct || 5;
    const baseAlloc = this.equity * allocPct / 100;

    // ATR 변동성 조정
    const atrPct = signal.atrPct || 2;
    const volAdjust = Math.min(1.5, Math.max(0.5, 2 / atrPct));

    // 켈리 기준 보정
    const kellyF = this.calcKellyFraction(signal);
    const kellySize = this.equity * kellyF;

    // 신뢰도 가중 (앙상블 보너스 반영)
    const confAdjust = Math.max(0.6, signal.confidence);

    // 레짐 기반 전체 리스크 스케일링
    let regimeScale = 1.0;
    if (regime) {
      if (regime.volatility === "high") regimeScale = 0.7;      // 고변동: 축소
      else if (regime.regime === "trending") regimeScale = 1.2;  // 추세: 확대
    }

    // 드로다운 단계별 축소
    const ddMult = this.drawdownMultiplier;

    // 오버나이트 리스크 조정
    const overnightAdj = this.getOvernightAdjustment(signal.symbol);

    // 최종: max(ATR 기반, 켈리 기반) × 보정팩터
    const adjusted = Math.max(baseAlloc * volAdjust, kellySize) * confAdjust * regimeScale * ddMult * overnightAdj;
    // 최대 개별 포지션: 자산의 maxSinglePct% (기본 8%)
    const maxSingle = this.equity * (this.s.maxSinglePct || 8) / 100;
    return Math.round(Math.max(50, Math.min(adjusted, maxSingle)));
  }

  // 스탑로스/익절 가격 계산 (ATR 기반 + 트레일링 지원)
  calcBracket(signal) {
    const price = signal.price;
    const atr = signal.atr || price * 0.02;
    const slMult = this.s.stopLossATR || 2;    // ATR × 2 = 스탑로스
    const tpMult = this.s.takeProfitATR || 3;   // ATR × 3 = 익절 (1.5:1 R:R)
    const useTrailing = this.s.trailingStop || false;
    const trailPct = this.s.trailPercent || 2; // 트레일링 %

    if (signal.type === "BUY") {
      return {
        stopLoss: Math.round((price - atr * slMult) * 100) / 100,
        takeProfit: Math.round((price + atr * tpMult) * 100) / 100,
        ...(useTrailing && { trailPercent: trailPct, trailPrice: Math.round(price * (1 - trailPct / 100) * 100) / 100 }),
      };
    } else {
      return {
        stopLoss: Math.round((price + atr * slMult) * 100) / 100,
        takeProfit: Math.round((price - atr * tpMult) * 100) / 100,
        ...(useTrailing && { trailPercent: trailPct, trailPrice: Math.round(price * (1 + trailPct / 100) * 100) / 100 }),
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
// 설정 패널 (가상매매 - 자동 연결)
// ══════════════════════════════════════════════════════════════
function SetupPanel({ config, setConfig, onConnect, theme }) {
  const C = theme === "light" ? LIGHT_C : DARK_C;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    // Auto-connect to virtual portfolio on mount
    const connect = async () => {
      setLoading(true);
      setError("");
      try {
        const acc = await virtualStockAPI("account");
        if (acc && acc.id) {
          const newConfig = { connected: true, type: "virtual-stock" };
          setConfig(newConfig);
          save(KEYS.config, newConfig);
          if (onConnect) onConnect(acc);
        } else {
          setError("가상 포트폴리오 연결 실패");
        }
      } catch (e) {
        setError("포트폴리오 데이터를 불러올 수 없습니다: " + (e.message || "알 수 없는 오류"));
      }
      setLoading(false);
    };
    connect();
  }, []);

  if (loading) {
    return (
      <div className="tab-content">
        <div style={{ background: `linear-gradient(135deg, ${C.card} 0%, #0D1B2A 100%)`,
          border: `1px solid ${C.border}`, borderRadius: "16px", padding: "40px 24px", textAlign: "center" }}>
          <div style={{ fontSize: "48px", marginBottom: "12px" }}>🤖</div>
          <div style={{ fontWeight: 800, fontSize: "22px", marginBottom: "8px" }}>가상매매</div>
          <div style={{ color: C.text3, fontSize: "14px", maxWidth: "420px", margin: "0 auto", lineHeight: 1.6, marginBottom: "20px" }}>
            리스크 관리 · 브래킷 주문 · 드로다운 보호 · ATR 포지션 사이징
          </div>
          <div style={{ fontSize: "14px", color: C.text2 }}>포트폴리오 연결 중...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="tab-content">
        <div style={{ background: `linear-gradient(135deg, ${C.card} 0%, #0D1B2A 100%)`,
          border: `1px solid ${C.border}`, borderRadius: "16px", padding: "40px 24px", textAlign: "center", marginBottom: "16px" }}>
          <div style={{ fontSize: "48px", marginBottom: "12px" }}>🤖</div>
          <div style={{ fontWeight: 800, fontSize: "22px", marginBottom: "8px" }}>가상매매</div>
        </div>
        <div style={{ background: C.redBg, border: `1px solid ${C.red}`, borderRadius: "12px", padding: "16px", textAlign: "center" }}>
          <div style={{ color: C.red, fontSize: "14px", fontWeight: 600 }}>{error}</div>
          <button onClick={() => window.location.reload()} style={{
            marginTop: "12px", padding: "8px 16px", borderRadius: "8px", fontSize: "13px",
            background: C.red, color: "white", border: "none", cursor: "pointer", fontWeight: 600
          }}>다시 시도</button>
        </div>
      </div>
    );
  }

  return (
    <div className="tab-content">
      <div style={{ background: `linear-gradient(135deg, ${C.card} 0%, #0D1B2A 100%)`,
        border: `1px solid ${C.border}`, borderRadius: "16px", padding: "40px 24px", textAlign: "center" }}>
        <div style={{ fontSize: "48px", marginBottom: "12px" }}>✅</div>
        <div style={{ fontWeight: 800, fontSize: "22px", marginBottom: "8px" }}>가상매매 준비 완료</div>
        <div style={{ color: C.text3, fontSize: "14px", maxWidth: "420px", margin: "0 auto", lineHeight: 1.6 }}>
          자동매매 봇이 실시간으로 시그널을 감지하고 주문을 처리합니다
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
      const order = await virtualStockAPI("submit_order", {}, params);
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
        padding: "24px", width: "100%", maxWidth: "min(90vw, 400px)", margin: "16px", boxSizing: "border-box" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px", minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: "17px" }}>{side === "buy" ? "매수" : "매도"} 주문</div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: C.text3, fontSize: "20px", cursor: "pointer", padding: "4px 8px", minHeight: "32px", minWidth: "32px", flexShrink: 0 }}>×</button>
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
// QR 코드 생성 (동적 CDN 로드)
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

// ══════════════════════════════════════════════════════════════
// URL ?sync= 파라미터 선파싱 (가상매매는 API 키가 불필요하므로 미사용)
function _parseSyncParam() {
  return null; // 가상매매 전환으로 동기화 파라미터 불필요
}
const _syncOnce = _parseSyncParam();

// 메인 컴포넌트
// ══════════════════════════════════════════════════════════════
// ── 봇 프리셋 → 전략 세트 매핑 (AutoTrading에서 봇 선택 시 자동 적용) ──
function getBotPresetSettings(presetId) {
  if (!presetId) return null;
  const allStrats = Object.keys(STRATEGY_PORTFOLIOS);
  switch (presetId) {
    case "stable-quant": return {
      allocationPct: 3, maxPositions: 10, maxDrawdownPct: 5, maxDailyLossPct: 2,
      maxSectorPct: 25, maxSinglePct: 5, stopLossATR: 1.5, takeProfitATR: 2.5,
      useBracketOrders: true, minConfidence: 0.7, cooldownHours: 48, orderType: "market",
      strategies: allStrats.filter(n => {
        const cat = STRATEGY_CATEGORY_MAP[n] || "복합";
        const conf = STRATEGY_CONFIDENCE[n] || 0.5;
        return conf >= 0.65 && (cat === "복합" || cat === "평균회귀");
      }),
    };
    case "balanced-quant": return {
      allocationPct: 5, maxPositions: 20, maxDrawdownPct: 10, maxDailyLossPct: 3,
      maxSectorPct: 35, maxSinglePct: 8, stopLossATR: 2, takeProfitATR: 3,
      useBracketOrders: true, minConfidence: 0.5, cooldownHours: 24, orderType: "market",
      strategies: allStrats.filter(n => {
        const cat = STRATEGY_CATEGORY_MAP[n] || "복합";
        const conf = STRATEGY_CONFIDENCE[n] || 0.5;
        return conf >= 0.5 && cat !== "추세추종";
      }),
    };
    case "aggressive-quant": return {
      allocationPct: 8, maxPositions: 30, maxDrawdownPct: 15, maxDailyLossPct: 5,
      maxSectorPct: 45, maxSinglePct: 12, stopLossATR: 2.5, takeProfitATR: 4,
      useBracketOrders: true, minConfidence: 0.4, cooldownHours: 12, orderType: "market",
      strategies: allStrats.filter(n => {
        const cat = STRATEGY_CATEGORY_MAP[n] || "복합";
        return cat === "추세추종" || cat === "모멘텀" || cat === "복합";
      }),
    };
    case "trend-follow": return {
      allocationPct: 5, maxPositions: 15, maxDrawdownPct: 12, maxDailyLossPct: 3,
      maxSectorPct: 35, maxSinglePct: 10, stopLossATR: 2.5, takeProfitATR: 4,
      useBracketOrders: true, minConfidence: 0.55, cooldownHours: 24, orderType: "market",
      strategies: allStrats.filter(n => (STRATEGY_CATEGORY_MAP[n] || "복합") === "추세추종"),
    };
    case "mean-reversion": return {
      allocationPct: 4, maxPositions: 15, maxDrawdownPct: 8, maxDailyLossPct: 2,
      maxSectorPct: 30, maxSinglePct: 6, stopLossATR: 1.5, takeProfitATR: 2,
      useBracketOrders: true, minConfidence: 0.6, cooldownHours: 36, orderType: "market",
      strategies: allStrats.filter(n => (STRATEGY_CATEGORY_MAP[n] || "복합") === "평균회귀"),
    };
    default: return null;
  }
}

export default function PaperTrading({ strategyAlerts = [], theme = "dark", user, botPreset, botAllocation, isMobile = false }) {
  // 유저별 localStorage 키 분리
  const userId = user?.id || null;
  KEYS = makeKeys(userId);

  const C = theme === "light" ? LIGHT_C : DARK_C;
  const [config, setConfig] = useState(() => {
    const saved = load(KEYS.config, {});
    if (_syncOnce?.k) {
      const merged = { apiKey: _syncOnce.k, apiSecret: _syncOnce.s, isPaper: _syncOnce.p !== 0, connected: true };
      save(KEYS.config, merged);
      return merged;
    }
    return saved;
  });
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
  const [qrModal, setQrModal] = useState(null); // null | "generate"
  const [autoScanEnabled, setAutoScanEnabled] = useState(() => load("di_auto_scan", false));

  // 리스크 알림 상태
  const [riskAlerts, setRiskAlerts] = useState([]);
  // 가상매매 전환: 기존 halted 상태 초기화 (이전 Alpaca 연동 시 halt된 값이 남아있을 수 있음)
  const [tradingHalted, setTradingHalted] = useState(false);

  // ── botPreset이 있으면 프리셋 설정 자동 적용, 없으면 localStorage 기본값 ──
  const presetOverride = botPreset?.id ? getBotPresetSettings(botPreset.id) : null;
  const [tradeSettings, setTradeSettings] = useState(() => {
    if (presetOverride) return presetOverride;
    return load(KEYS.settings, {
      orderType: "market",
      allocationPct: 5,
      maxPositions: 20,
      maxDrawdownPct: 10,
      maxDailyLossPct: 3,
      maxSectorPct: 35,
      maxSinglePct: 8,
      stopLossATR: 2,
      takeProfitATR: 3,
      useBracketOrders: true,
      minConfidence: 0.5,
      cooldownHours: 24,
      strategies: Object.keys(STRATEGY_PORTFOLIOS),
    });
  });

  // 대기 주문 큐 (장 마감 시 스캔한 시그널을 저장, 장 시작 시 자동 실행)
  const [pendingOrders, setPendingOrders] = useState(() => load("di_queued_signals", []));

  const refreshTimer = useRef(null);
  const scanTimer = useRef(null);
  const isConnected = config.connected === true;

  // ── botPreset이 있으면 해당 봇 전략의 종목만 필터링 ──
  const botSymbolSet = useMemo(() => {
    if (!presetOverride) return null; // 프리셋 없으면 전체 표시
    const syms = new Set();
    for (const stratName of (presetOverride.strategies || [])) {
      const holdings = STRATEGY_PORTFOLIOS[stratName];
      if (holdings) holdings.forEach(h => syms.add(h.sym));
    }
    return syms;
  }, [presetOverride]);
  const filteredPositions = useMemo(() => {
    if (!botSymbolSet) return positions; // 프리셋 없으면 전체
    return positions.filter(p => botSymbolSet.has(p.symbol));
  }, [positions, botSymbolSet]);

  // URL sync 정리 (카메라 앱 → 브라우저로 열렸을 때)
  useEffect(() => {
    if (_syncOnce) {
      const url = new URL(window.location);
      url.searchParams.delete("sync");
      url.searchParams.delete("tab");
      window.history.replaceState({}, "", url.pathname + (url.search || ""));
    }
  }, []);

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
  useEffect(() => { save("di_queued_signals", pendingOrders); }, [pendingOrders]);
  useEffect(() => { save("di_pt_tab", activeTab); }, [activeTab]);

  // ── 계좌 데이터 ──
  const refreshData = useCallback(async () => {
    if (!config.connected) return;
    setLoading(true);
    try {
      const [acc, pos, ord, clk] = await Promise.allSettled([
        virtualStockAPI("account", config),
        virtualStockAPI("positions", config),
        virtualStockAPI("orders", config, { status: "all", limit: "50" }),
        virtualStockAPI("clock", config),
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

  // ── 장 시작 시 대기 주문 자동 실행 ──
  const prevClockOpen = useRef(false);
  useEffect(() => {
    const isOpen = clock?.is_open === true;
    const wasJustOpened = isOpen && !prevClockOpen.current;
    prevClockOpen.current = isOpen;

    if (wasJustOpened && autoTradeEnabled && isConnected && !tradingHalted && pendingOrders.length > 0) {
      // 만료되지 않은 대기 시그널만 필터
      const validQueued = pendingOrders.filter(sig => sig.expiresAt > Date.now());
      if (validQueued.length > 0) {
        setRiskAlerts(prev => [...prev, {
          level: "info",
          msg: `장 시작 — 대기 주문 ${validQueued.length}건 실행 중...`,
          time: Date.now(),
        }]);
        executeAutoTrades(validQueued).then(() => {
          setPendingOrders([]);
        });
      } else {
        setPendingOrders([]);
      }
    }
  }, [clock?.is_open]);

  // ── 전략 성과 추적 (체결 주문 → 승패 판정) ──
  useEffect(() => {
    if (!orders.length || !positions.length) return;
    const pending = load("di_pending_orders", []);
    if (!pending.length) return;
    const perf = loadStrategyPerformance();
    const remaining = [];

    for (const p of pending) {
      // 24시간 지난 주문은 포기
      if (Date.now() - p.time > 86400000) continue;

      // 매수 주문: 현재 포지션에서 P&L 확인
      if (p.side === "BUY") {
        const pos = positions.find(pp => pp.symbol === p.symbol);
        if (!pos) {
          // 이미 청산됨 → filled orders에서 체결가 확인
          const filledOrder = orders.find(o => o.client_order_id?.startsWith(`di-${p.symbol}`) && o.status === "filled" && o.side === "sell");
          if (filledOrder) {
            const fillPrice = parseFloat(filledOrder.filled_avg_price || 0);
            const isWin = fillPrice > p.price;
            const pct = p.price > 0 ? Math.abs(fillPrice - p.price) / p.price : 0;
            for (const strat of (p.strategies || [p.strategy])) {
              if (!perf[strat]) perf[strat] = { wins: 0, losses: 0, avgWin: 0, avgLoss: 0, total: 0 };
              if (isWin) { perf[strat].wins++; perf[strat].avgWin = (perf[strat].avgWin * (perf[strat].wins - 1) + pct) / perf[strat].wins; }
              else { perf[strat].losses++; perf[strat].avgLoss = (perf[strat].avgLoss * (perf[strat].losses - 1) + pct) / perf[strat].losses; }
              perf[strat].total++;
            }
          } else {
            remaining.push(p); // 아직 청산 안 됨
          }
        } else {
          remaining.push(p); // 아직 보유 중
        }
      }
    }

    if (remaining.length !== pending.length) {
      save("di_pending_orders", remaining);
      saveStrategyPerformance(perf);
    }
  }, [orders, positions]);

  // ── 리스크 체크 (계좌 갱신 시마다) ──
  useEffect(() => {
    if (!account || !isConnected) return;
    // 가상매매: equity가 0이거나 아직 로딩 안 됐으면 리스크 체크 스킵
    const eq = parseFloat(account?.equity || 0);
    if (eq <= 0) return;
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
      const usSymbols = collectUSSymbols(tradeSettings.strategies);
      const candleMap = await fetchCandleData(usSymbols, setScanProgress);
      const signals = detectSignals(candleMap);
      setDetectedSignals(signals);
      setLastScanTime(new Date());

      if (autoTradeEnabled && isConnected && signals.length > 0 && !tradingHalted) {
        if (clock?.is_open) {
          await executeAutoTrades(signals);
        } else {
          // 장 마감 시: 시그널을 대기 주문 큐에 저장 (장 시작 시 자동 실행)
          const newPending = signals.filter(sig => {
            const sigIds = sig.originalIds || [sig.id];
            return !sigIds.some(id => executedSignals[id]);
          }).map(sig => ({
            ...sig,
            queuedAt: Date.now(),
            expiresAt: Date.now() + 24 * 3600000, // 24시간 유효
          }));
          if (newPending.length > 0) {
            setPendingOrders(prev => {
              const existingIds = new Set(prev.map(p => p.id));
              const fresh = newPending.filter(p => !existingIds.has(p.id));
              return [...fresh, ...prev].slice(0, 50);
            });
            setRiskAlerts(prev => {
              const msg = `장 마감 — ${newPending.length}건 대기 주문 큐에 추가 (장 시작 시 자동 실행)`;
              if (prev.some(a => a.msg === msg)) return prev;
              return [...prev, { level: "info", msg, time: Date.now() }];
            });
          }
        }
      }
    } catch (e) {
      console.error("Quant scan error:", e);
    }
    setScanning(false);
    setScanProgress(100);
  }, [scanning, autoTradeEnabled, isConnected, config, executedSignals, tradeSettings, account, positions, clock, tradingHalted]);

  // ── 자동 주문 실행 (Wall Street Grade 리스크 관리) ──
  const executeAutoTrades = async (signals) => {
    if (!account) return;
    const rm = new RiskManager(tradeSettings, account, positions);
    const regime = signals._regime || { regime: "unknown", volatility: "normal" };

    // 최종 리스크 체크
    if (rm.isDrawdownBreached() || rm.isDailyLossBreached(account)) {
      if (!tradingHalted) {
        setTradingHalted(true);
        setRiskAlerts(prev => [...prev, { type: "critical", msg: "드로다운/일일 손실 한도 초과 — 자동매매 중단", time: Date.now() }]);
      }
      setTradeLog(prev => [{ time: new Date().toLocaleString("ko-KR"),
        symbol: "SYSTEM", side: "HALT", strategy: "리스크 관리",
        reason: `드로다운 ${rm.drawdown.toFixed(1)}% / 일일P&L ${rm.dailyPL(account).toFixed(1)}%`,
        error: "RISK_HALT" }, ...prev]);
      return;
    }

    // 고변동성 레짐: 주문 속도 제한 (1회 3건)
    const MAX_ORDERS_PER_SCAN = regime.volatility === "high" ? 3 : 5;

    let newExecuted = { ...executedSignals };
    let newLog = [...tradeLog];
    let ordersPlaced = 0;

    for (const sig of signals) {
      if (ordersPlaced >= MAX_ORDERS_PER_SCAN) break;

      // 앙상블 시그널은 originalIds 전부 체크
      const sigIds = sig.originalIds || [sig.id];
      if (sigIds.some(id => newExecuted[id])) continue;

      // 전략 활성 체크 (앙상블은 하나라도 활성이면 OK)
      const activeStrategies = sig.strategies || [sig.strategy];
      if (!activeStrategies.some(s => tradeSettings.strategies.includes(s))) continue;

      // 신뢰도 필터
      if (sig.confidence < (tradeSettings.minConfidence || 0.5)) continue;

      // 쿨다운 체크
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
        // 상관관계 필터
        if (rm.isCorrelatedRisk(sig.symbol) && sig.confidence < 0.7) {
          newLog.unshift({ time: new Date().toLocaleString("ko-KR"), symbol: sig.symbol, side: "BUY",
            strategy: sig.strategy, reason: `동일 섹터 3+포지션 — 상관위험 (신뢰도 ${(sig.confidence*100).toFixed(0)}% < 70%)`, error: "CORR_RISK" });
          continue;
        }
      }

      // 매도: 보유 중인 종목만
      if (sig.type === "SELL") {
        if (!positions.some(p => p.symbol === sig.symbol)) continue;
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
          const positionSize = rm.calcPositionSize(sig, regime);
          orderParams.notional = Math.max(1, positionSize);

          if (tradeSettings.useBracketOrders) {
            const bracket = rm.calcBracket(sig);
            orderParams.order_class = "bracket";
            orderParams.take_profit = { limit_price: String(bracket.takeProfit) };
            orderParams.stop_loss = { stop_price: String(bracket.stopLoss) };
          }

          // ── TWAP 실행: $2000 이상 주문은 3-5개로 분할 (30초 간격, 마켓 아워에만) ──
          if (positionSize >= 2000 && clock?.is_open && (tradeSettings.orderType || "market") === "market") {
            const numSlices = Math.min(5, Math.max(3, Math.floor(positionSize / 800)));
            const sliceSize = Math.round(positionSize / numSlices);
            let totalOrderSize = 0;

            for (let i = 0; i < numSlices; i++) {
              const isLastSlice = i === numSlices - 1;
              const orderSize = isLastSlice ? positionSize - totalOrderSize : sliceSize;
              totalOrderSize += orderSize;

              const twapOrder = {
                ...orderParams,
                notional: orderSize,
                client_order_id: `di-${sig.symbol}-${Date.now()}-${i}`,
              };

              try {
                const subOrder = await virtualStockAPI("submit_order", {}, twapOrder);
                newLog.unshift({
                  time: new Date().toLocaleString("ko-KR"),
                  symbol: sig.symbol, side: "BUY", strategy: sig.strategy,
                  reason: `[TWAP ${i+1}/${numSlices}] ${sig.reason}`,
                  confidence: sig.confidence,
                  amount: `$${orderSize}`,
                  status: "submitted",
                  orderId: subOrder.id,
                  atrPct: sig.atrPct,
                });
                ordersPlaced++;
              } catch (e) {
                console.error(`TWAP slice ${i+1} failed:`, e);
              }

              // 마지막 주문 아닌 경우, 30초 대기
              if (i < numSlices - 1) {
                await new Promise(r => setTimeout(r, 30000));
              }
            }

            // TWAP 완료 후 마크
            sigIds.forEach(id => { newExecuted[id] = Date.now(); });
            continue; // 다음 신호로 진행 (일반 주문 제출 스킵)
          }
        } else {
          const pos = positions.find(p => p.symbol === sig.symbol);
          orderParams.qty = pos ? parseFloat(pos.qty) : 1;
        }

        const order = await virtualStockAPI("submit_order", {}, orderParams);

        let verifiedStatus = order.status;
        if (order.id) {
          try {
            await new Promise(r => setTimeout(r, 1500));
            // Virtual portfolio doesn't support get_order, so we skip verification
          } catch {}
        }

        // 모든 관련 시그널 ID 실행 기록
        sigIds.forEach(id => { newExecuted[id] = Date.now(); });
        const bracket = tradeSettings.useBracketOrders && sig.type === "BUY" ? rm.calcBracket(sig) : null;
        newLog.unshift({
          time: new Date().toLocaleString("ko-KR"),
          symbol: sig.symbol,
          side: sig.type,
          strategy: sig.reason, // 앙상블 정보 포함
          reason: sig.reason,
          confidence: sig.confidence,
          ensembleCount: sig.ensembleCount || 1,
          regime: regime.regime,
          amount: sig.type === "BUY" ? `$${rm.calcPositionSize(sig, regime)}` : `${orderParams.qty}주 청산`,
          stopLoss: bracket ? `$${bracket.stopLoss}` : null,
          takeProfit: bracket ? `$${bracket.takeProfit}` : null,
          orderId: order.id,
          status: verifiedStatus,
          atrPct: sig.atrPct,
        });
        ordersPlaced++;

        // 전략 성과 추적 (주문 성공 기록 → 나중에 체결 후 승패 판정)
        const perfKey = `di_pending_orders`;
        const pending = load(perfKey, []);
        pending.push({ orderId: order.id, strategy: sig.strategy, strategies: activeStrategies,
          symbol: sig.symbol, side: sig.type, price: sig.price, time: Date.now() });
        save(perfKey, pending.slice(-100));
      } catch (e) {
        sigIds.forEach(id => { newExecuted[id] = Date.now(); });
        newLog.unshift({
          time: new Date().toLocaleString("ko-KR"),
          symbol: sig.symbol, side: sig.type, strategy: sig.strategy,
          reason: sig.reason, confidence: sig.confidence, error: e.message,
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
    try { await virtualStockAPI("close_position", {}, { symbol }); setTimeout(refreshData, 500); }
    catch (e) { alert("청산 실패: " + e.message); }
  };
  const cancelOrder = async (orderId) => {
    try { await virtualStockAPI("cancel_order", {}, { order_id: orderId }); setTimeout(refreshData, 500); }
    catch (e) { alert("취소 실패: " + e.message); }
  }

  if (!isConnected) return <SetupPanel config={config} setConfig={setConfig} onConnect={acc => setAccount(acc)} theme={theme} />;

  const fullEquity = parseFloat(account?.equity || 0);
  const fullCash = parseFloat(account?.cash || 0);
  const fullBuyingPower = parseFloat(account?.cash || 0);
  // 봇 배분 비율: botAllocation이 있으면 해당 봇에 배분된 비율만큼만 표시
  const allocRatio = (botAllocation && fullEquity > 0) ? (botAllocation / fullEquity) : 1;
  const equity = botAllocation ? botAllocation : fullEquity;
  const cash = Math.round(fullCash * allocRatio * 100) / 100;
  const buyingPower = botAllocation
    ? Math.min(Math.round(fullBuyingPower * allocRatio * 100) / 100, botAllocation)
    : fullBuyingPower;
  const fullDayPL = parseFloat(account?.equity) - parseFloat(account?.last_equity || account?.equity);
  const dayPL = Math.round(fullDayPL * allocRatio * 100) / 100;
  const dayPLPct = parseFloat(account?.last_equity) ? (fullDayPL / parseFloat(account.last_equity) * 100) : 0;
  const totalPL = equity - (botAllocation || 100000);
  const totalPLPct = botAllocation ? (totalPL / botAllocation * 100) : ((equity - 100000) / 100000 * 100);
  const positionPL = filteredPositions.reduce((s, p) => s + parseFloat(p.unrealized_pl || 0), 0);
  const openOrders = orders.filter(o => ["new","accepted","pending_new","partially_filled"].includes(o.status));
  const filledOrders = orders.filter(o => o.status === "filled");
  const marketOpen = clock?.is_open;

  const rm = new RiskManager(tradeSettings, account, positions);

  return (
    <div className="tab-content" style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "240px 1fr", gap: "0", minHeight: "100vh" }}>
      {/* ═══════════════════════════════════════════════════════════
          LEFT SIDEBAR: 네비게이션 (토스 스타일) — hidden on mobile
      ═══════════════════════════════════════════════════════════ */}
      {!isMobile && <div style={{
        background: C.card, borderRight: `1px solid ${C.border}`, padding: "20px 0",
        display: "flex", flexDirection: "column", gap: "0", position: "sticky", top: "0", maxHeight: "100vh", overflowY: "auto",
      }}>
        {[
          { id: "dashboard", label: "포지션", count: filteredPositions.length },
          { id: "signals", label: "시그널", count: detectedSignals.length },
          { id: "market", label: "시장진단", count: null },
        ].map(({ id, label, count }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            style={{
              padding: "14px 20px", margin: "0", border: "none",
              background: activeTab === id ? `${C.blue}14` : "transparent",
              color: activeTab === id ? C.blue : C.text2,
              borderLeft: activeTab === id ? `3px solid ${C.blue}` : `3px solid transparent`,
              fontSize: "13px", fontWeight: activeTab === id ? 700 : 600,
              cursor: "pointer", textAlign: "left", transition: "all 0.15s",
              display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px",
            }}
            onMouseEnter={e => {
              if (activeTab !== id) {
                e.currentTarget.style.background = `${C.card2}80`;
              }
            }}
            onMouseLeave={e => {
              if (activeTab !== id) {
                e.currentTarget.style.background = "transparent";
              }
            }}>
            <span>{label}</span>
            {count != null && count > 0 && (
              <span style={{
                background: activeTab === id ? C.blue : C.border2,
                color: activeTab === id ? "#fff" : C.text3,
                fontSize: "10px", fontWeight: 700, borderRadius: "50%",
                width: "20px", height: "20px",
                display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
              }}>
                {count > 99 ? "99+" : count}
              </span>
            )}
          </button>
        ))}

        <div style={{ flex: 1 }} />

        <div style={{ padding: "0 20px", display: "flex", gap: "6px", flexDirection: "column" }}>
          <button onClick={() => setOrderModal({ symbol: "", side: "buy", reason: "수동 주문" })} style={{
            padding: "10px 14px", borderRadius: "8px", fontSize: "12px", fontWeight: 700,
            background: `linear-gradient(135deg,${C.blue},#2563EB)`, color: "#fff", border: "none",
            cursor: "pointer", whiteSpace: "nowrap",
          }}>
            + 주문하기
          </button>
          <button onClick={refreshData} style={{
            padding: "10px 14px", borderRadius: "8px", fontSize: "11px", fontWeight: 600,
            background: C.card2, border: `1px solid ${C.border2}`, color: C.text2, cursor: "pointer",
          }}>
            새로고침
          </button>
        </div>
      </div>}

      {/* ═══════════════════════════════════════════════════════════
          MAIN CONTENT: 우측 패널 (큰 잔액 표시 + 탭 콘텐츠)
      ═══════════════════════════════════════════════════════════ */}
      <div style={{ display: "flex", flexDirection: "column", gap: "20px", padding: "20px", paddingBottom: isMobile ? "76px" : "20px", overflowY: "auto" }}>
        {orderModal && <OrderModal symbol={orderModal.symbol} side={orderModal.side} reason={orderModal.reason}
          config={config} onClose={() => setOrderModal(null)} onOrderPlaced={handleOrderPlaced} />}

        {/* ── 리스크 알림 배너 ── */}
        {riskAlerts.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
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

        {/* ── 큰 잔액 표시 (토스 스타일) ── */}
        <div style={{
          background: `linear-gradient(135deg, ${C.card} 0%, #0D1B2A 100%)`,
          border: `1px solid ${C.border}`, borderRadius: "16px", padding: "28px 32px",
        }}>
          <div style={{ fontSize: "13px", color: C.text3, fontWeight: 500, marginBottom: "8px" }}>배분 금액</div>
          <div style={{
            fontWeight: 800, fontSize: "42px", color: C.text1, lineHeight: 1, marginBottom: "12px",
            letterSpacing: "-1px",
          }}>
            {fmtUSD(equity)}
          </div>
          <div style={{
            display: "flex", alignItems: "baseline", gap: "12px", fontSize: "13px", fontWeight: 600,
          }}>
            <span style={{ color: dayPL >= 0 ? C.green : C.red }}>
              {dayPL >= 0 ? "+" : ""}{fmtUSD(dayPL)}
            </span>
            <span style={{ color: dayPL >= 0 ? C.green : C.red, fontSize: "12px" }}>
              {fmtPct(dayPLPct)} 오늘
            </span>
          </div>

          <div style={{ marginTop: "20px", display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "12px" }}>
            {[
              { label: "현금", value: fmtUSD(cash), color: C.blue },
              { label: "가용현금", value: fmtUSD(buyingPower), color: C.blueL },
              { label: "총 수익", value: fmtUSD(totalPL), sub: fmtPct(totalPLPct), color: totalPL >= 0 ? C.green : C.red },
              { label: "포지션 P&L", value: fmtUSD(positionPL), color: positionPL >= 0 ? C.green : C.red },
            ].map((m, i) => (
              <div key={i} style={{ background: C.card2, borderRadius: "10px", padding: "12px" }}>
                <div style={{ fontSize: "10px", color: C.text3, marginBottom: "3px", fontWeight: 500 }}>{m.label}</div>
                <div style={{ fontWeight: 800, fontSize: "14px", color: m.color }}>{m.value}</div>
                {m.sub && <div style={{ fontSize: "10px", color: m.color, marginTop: "2px" }}>{m.sub}</div>}
              </div>
            ))}
          </div>

          {/* ═══ 봇 성과 지표 (3×2 그리드) ═══ */}
          {(() => {
            const initCapital = botAllocation || 100000;
            const unrealizedPL = filteredPositions.reduce((s, p) => s + parseFloat(p.unrealized_pl || 0), 0);
            const peakEq = Math.max(initCapital, equity);
            const dd = peakEq > 0 ? ((peakEq - equity) / peakEq) * 100 : 0;
            const invested = filteredPositions.reduce((s, p) => s + parseFloat(p.market_value || 0), 0);
            const investedPct = equity > 0 ? (invested / equity) * 100 : 0;
            const perfMetrics = [
              { label: "오늘 수익", value: fmtUSD(dayPL), sub: fmtPct(dayPLPct), color: dayPL >= 0 ? C.green : C.red },
              { label: "누적 수익", value: fmtUSD(totalPL), sub: fmtPct(totalPLPct), color: totalPL >= 0 ? C.green : C.red },
              { label: "미실현 P&L", value: fmtUSD(positionPL), color: positionPL >= 0 ? C.green : C.red },
              { label: "Drawdown", value: `-${dd.toFixed(2)}%`, sub: `한도 ${tradeSettings.maxDrawdownPct}%`, color: dd > 5 ? C.red : dd > 2 ? C.yellow : C.green },
              { label: "투자 비중", value: `${investedPct.toFixed(1)}%`, color: investedPct > 70 ? C.yellow : C.blue },
              { label: "포지션 수", value: `${filteredPositions.length}개`, color: C.text1 },
            ];
            return (
              <div style={{ marginTop: "16px", borderTop: `1px solid ${C.border}40`, paddingTop: "14px" }}>
                <div style={{ fontSize: "11px", fontWeight: 700, color: C.text3, marginBottom: "8px" }}>봇 성과</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "8px" }}>
                  {perfMetrics.map((m, i) => (
                    <div key={i} style={{ background: C.card2, borderRadius: "8px", padding: "10px", textAlign: "center" }}>
                      <div style={{ fontSize: "9px", color: C.text3, marginBottom: "3px", fontWeight: 600 }}>{m.label}</div>
                      <div style={{ fontSize: "13px", fontWeight: 800, color: m.color }}>{m.value}</div>
                      {m.sub && <div style={{ fontSize: "9px", color: m.color, marginTop: "2px" }}>{m.sub}</div>}
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          <div style={{ marginTop: "14px", fontSize: "11px", color: C.text3, display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <span>{loading ? "갱신 중..." : "30초 자동 갱신"}</span>
            {lastScanTime && <span>스캔 {lastScanTime.toLocaleTimeString("ko-KR")}</span>}
          </div>

          <div style={{ marginTop: "12px", display: "flex", alignItems: "center", gap: "8px" }}>
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
            {pendingOrders.length > 0 && (
              <span style={{ padding: "2px 8px", borderRadius: "4px", fontSize: "10px", fontWeight: 700,
                background: C.yellowBg, color: C.yellow }}>대기 {pendingOrders.length}</span>
            )}
          </div>
        </div>

      {/* ── 포지션 ── */}
      {activeTab==="dashboard"&&(<>
        {/* 마켓 레짐 인디케이터 */}
        {detectedSignals._regime && (()=>{
          const r = detectedSignals._regime;
          const regimeInfo = {
            trending: { icon: "📈", label: "추세장", color: C.green, desc: "모멘텀·추세추종 전략 유리" },
            "mean-reverting": { icon: "↔️", label: "박스권", color: C.yellow, desc: "평균회귀·오실레이터 전략 유리" },
            volatile: { icon: "⚡", label: "고변동", color: C.red, desc: "리스크 축소, 방어적 운용" },
            unknown: { icon: "❓", label: "분석중", color: C.text3, desc: "데이터 수집 중" },
          }[r.regime] || { icon: "❓", label: "분석중", color: C.text3, desc: "" };
          return (
            <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:"16px",padding:"16px",marginBottom:"12px"}}>
              <div style={{display:"flex",alignItems:"center",gap:"12px"}}>
                <div style={{fontSize:"28px"}}>{regimeInfo.icon}</div>
                <div style={{flex:1}}>
                  <div style={{fontWeight:700,fontSize:"14px",display:"flex",alignItems:"center",gap:"8px"}}>
                    마켓 레짐: <span style={{color:regimeInfo.color}}>{regimeInfo.label}</span>
                    {r.trendDir && <span style={{fontSize:"11px",color:r.trendDir==="bull"?C.green:C.red,fontWeight:600}}>
                      {r.trendDir==="bull"?"BULL":"BEAR"}
                    </span>}
                  </div>
                  <div style={{fontSize:"11px",color:C.text3,marginTop:"2px"}}>{regimeInfo.desc}</div>
                </div>
                <div style={{textAlign:"right",fontSize:"11px",color:C.text3}}>
                  {r.annualizedVol!=null && <div>변동성 <b style={{color:C.text2}}>{r.annualizedVol.toFixed(1)}%</b></div>}
                  {r.adxProxy!=null && <div>추세강도 <b style={{color:C.text2}}>{r.adxProxy.toFixed(0)}</b></div>}
                </div>
              </div>
            </div>
          );
        })()}

        <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:"16px",padding:"20px"}}>
          <div style={{fontWeight:700,marginBottom:"16px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span>보유 포지션 ({filteredPositions.length}/{tradeSettings.maxPositions})</span>
            {filteredPositions.length>0&&(
              <button onClick={async()=>{if(confirm("전체 청산?")){await virtualStockAPI("close_all",{});setTimeout(refreshData,1000);}}}
                style={{fontSize:"11px",color:C.red,background:"none",border:"none",cursor:"pointer"}}>전체 청산</button>
            )}
          </div>
          {filteredPositions.length===0?(
            <div style={{textAlign:"center",padding:"40px 0",color:C.text3}}>
              <div style={{fontSize:"40px",marginBottom:"8px"}}>📭</div>
              <div>{presetOverride ? "이 봇 전략에 해당하는 보유 종목이 없습니다" : "보유 중인 포지션이 없습니다"}</div>
            </div>
          ):(
            <div style={{display:"flex",flexDirection:"column",gap:"6px"}}>
              {filteredPositions.map((p,i)=>{
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
      </>)}

      {/* ── 시장진단 ── */}
      {activeTab==="market"&&(
        <div style={{display:"flex",flexDirection:"column",gap:"12px"}}>
          {/* 마켓 레짐 */}
          {detectedSignals._regime && (()=>{
            const r = detectedSignals._regime;
            const regimeInfo = {
              trending: { icon: "📈", label: "추세장", color: C.green, desc: "모멘텀·추세추종 전략 유리" },
              "mean-reverting": { icon: "↔️", label: "박스권", color: C.yellow, desc: "평균회귀·오실레이터 전략 유리" },
              volatile: { icon: "⚡", label: "고변동", color: C.red, desc: "리스크 축소, 방어적 운용" },
              unknown: { icon: "❓", label: "분석중", color: C.text3, desc: "데이터 수집 중" },
            }[r.regime] || { icon: "❓", label: "분석중", color: C.text3, desc: "" };
            return (
              <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:"16px",padding:"20px"}}>
                <div style={{display:"flex",alignItems:"center",gap:"12px",marginBottom:"16px"}}>
                  <div style={{fontSize:"32px"}}>{regimeInfo.icon}</div>
                  <div style={{flex:1}}>
                    <div style={{fontWeight:700,fontSize:"15px",display:"flex",alignItems:"center",gap:"8px"}}>
                      마켓 레짐: <span style={{color:regimeInfo.color}}>{regimeInfo.label}</span>
                      {r.trendDir && <span style={{fontSize:"11px",color:r.trendDir==="bull"?C.green:C.red,fontWeight:600}}>
                        {r.trendDir==="bull"?"BULL":"BEAR"}
                      </span>}
                    </div>
                    <div style={{fontSize:"12px",color:C.text3,marginTop:"4px"}}>{regimeInfo.desc}</div>
                  </div>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:"8px"}}>
                  {r.annualizedVol!=null && (
                    <div style={{background:C.card2,borderRadius:"10px",padding:"10px",textAlign:"center"}}>
                      <div style={{fontSize:"10px",color:C.text3,marginBottom:"2px"}}>연환산 변동성</div>
                      <div style={{fontSize:"15px",fontWeight:800,color:r.annualizedVol>30?C.red:r.annualizedVol>15?C.yellow:C.green}}>{r.annualizedVol.toFixed(1)}%</div>
                    </div>
                  )}
                  {r.adxProxy!=null && (
                    <div style={{background:C.card2,borderRadius:"10px",padding:"10px",textAlign:"center"}}>
                      <div style={{fontSize:"10px",color:C.text3,marginBottom:"2px"}}>추세 강도</div>
                      <div style={{fontSize:"15px",fontWeight:800,color:r.adxProxy>25?C.green:C.yellow}}>{r.adxProxy.toFixed(0)}</div>
                    </div>
                  )}
                  {r.strength!=null && (
                    <div style={{background:C.card2,borderRadius:"10px",padding:"10px",textAlign:"center"}}>
                      <div style={{fontSize:"10px",color:C.text3,marginBottom:"2px"}}>레짐 신뢰도</div>
                      <div style={{fontSize:"15px",fontWeight:800,color:C.blue}}>{(r.strength*100).toFixed(0)}%</div>
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {/* 리스크 알림 */}
          {riskAlerts.length > 0 && (
            <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:"16px",padding:"20px"}}>
              <div style={{fontWeight:700,fontSize:"14px",marginBottom:"12px"}}>리스크 알림 ({riskAlerts.length})</div>
              <div style={{display:"flex",flexDirection:"column",gap:"6px"}}>
                {riskAlerts.map((a,i) => (
                  <div key={i} style={{
                    background: a.level==="critical"?C.redBg:a.level==="warning"?C.yellowBg:C.blueBg,
                    border:`1px solid ${a.level==="critical"?C.red:a.level==="warning"?C.yellow:C.blue}33`,
                    borderRadius:"10px",padding:"10px 14px",fontSize:"12px",
                    color: a.level==="critical"?C.red:a.level==="warning"?C.yellow:C.blue,
                    display:"flex",alignItems:"center",gap:"8px",
                  }}>
                    <span style={{fontSize:"14px"}}>{a.level==="critical"?"🚨":a.level==="warning"?"⚠️":"ℹ️"}</span>
                    {a.msg}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 데이터 없을 때 */}
          {!detectedSignals._regime && riskAlerts.length === 0 && (
            <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:"16px",padding:"40px",textAlign:"center"}}>
              <div style={{fontSize:"24px",marginBottom:"8px"}}>📊</div>
              <div style={{fontSize:"13px",fontWeight:600,color:C.text2}}>시그널 스캔을 실행하면 시장 진단 정보가 표시됩니다</div>
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
                  {tradeSettings.strategies.length}개 전략 · {collectUSSymbols(tradeSettings.strategies).length}개 종목 · 신뢰도 {tradeSettings.minConfidence*100}%+ 필터
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
            {/* 대기 주문 큐 표시 */}
            {pendingOrders.length > 0 && (
              <div style={{background:C.card2,border:`1px solid ${C.yellow}40`,borderRadius:"10px",padding:"12px",marginBottom:"10px"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"8px"}}>
                  <div style={{display:"flex",alignItems:"center",gap:"6px"}}>
                    <span style={{fontSize:"16px"}}>⏳</span>
                    <span style={{fontWeight:700,fontSize:"13px",color:C.yellow}}>대기 주문 ({pendingOrders.filter(p=>p.expiresAt>Date.now()).length}건)</span>
                  </div>
                  <button onClick={()=>{setPendingOrders([]);setRiskAlerts(p=>[...p,{level:"info",msg:"대기 주문 전체 취소",time:Date.now()}])}} style={{
                    padding:"4px 10px",borderRadius:"6px",fontSize:"11px",fontWeight:600,
                    background:C.redBg,color:C.red,border:`1px solid ${C.red}40`,cursor:"pointer"}}>전체 취소</button>
                </div>
                <div style={{fontSize:"11px",color:C.text3,marginBottom:"6px"}}>장 마감 중 감지된 시그널 — 장 시작 시 자동 실행됩니다</div>
                <div style={{display:"flex",flexDirection:"column",gap:"4px",maxHeight:"150px",overflow:"auto"}}>
                  {pendingOrders.filter(p=>p.expiresAt>Date.now()).map((sig,i)=>(
                    <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",
                      padding:"6px 8px",background:C.bg,borderRadius:"6px",fontSize:"12px"}}>
                      <div style={{display:"flex",alignItems:"center",gap:"6px"}}>
                        <span style={{padding:"1px 5px",borderRadius:"3px",fontWeight:700,fontSize:"10px",
                          background:sig.type==="BUY"?C.redBg:C.blueBg,
                          color:sig.type==="BUY"?C.red:C.blue}}>{sig.type==="BUY"?"매수":"매도"}</span>
                        <span style={{fontWeight:600}}>{sig.symbol}</span>
                        <span style={{color:C.text3,fontSize:"10px"}}>{sig.strategy}</span>
                      </div>
                      <div style={{display:"flex",alignItems:"center",gap:"6px"}}>
                        <span style={{color:C.text3,fontSize:"10px"}}>{new Date(sig.queuedAt).toLocaleTimeString("ko-KR",{hour:"2-digit",minute:"2-digit"})}</span>
                        <button onClick={()=>setPendingOrders(p=>p.filter((_,j)=>j!==i))} style={{
                          padding:"2px 6px",borderRadius:"4px",fontSize:"10px",
                          background:"transparent",color:C.red,border:`1px solid ${C.red}40`,cursor:"pointer"}}>취소</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {detectedSignals.length===0?(
              <div style={{textAlign:"center",padding:"40px 0",color:C.text3}}>
                <div style={{fontSize:"40px",marginBottom:"8px"}}>📡</div>
                <div>"전략 스캔" 실행으로 시그널 감지</div>
              </div>
            ):(
              <div style={{display:"flex",flexDirection:"column",gap:"6px",maxHeight:"500px",overflow:"auto"}}>
                {detectedSignals.slice(0,60).map((sig,i)=>{
                  const isBuy=sig.type==="BUY";
                  const sigIds = sig.originalIds || [sig.id];
                  const wasExec=sigIds.some(id=>executedSignals[id]);
                  const confColor=sig.confidence>=0.7?C.green:sig.confidence>=0.5?C.yellow:C.red;
                  const isEnsemble = (sig.ensembleCount||1) > 1;
                  return (
                    <div key={i} style={{background:C.card2,borderRadius:"10px",padding:"12px",
                      borderLeft:`3px solid ${isEnsemble?C.purple:isBuy?C.red:C.blue}`,opacity:wasExec?0.5:1}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"4px"}}>
                        <div style={{display:"flex",alignItems:"center",gap:"6px",flexWrap:"wrap"}}>
                          <span style={{padding:"2px 6px",borderRadius:"4px",fontSize:"10px",fontWeight:700,
                            background:isBuy?C.redBg:C.blueBg,color:isBuy?C.red:C.blue}}>{isBuy?"매수":"매도"}</span>
                          <span style={{fontWeight:700}}>{sig.symbol}</span>
                          {isEnsemble && <span style={{fontSize:"9px",padding:"1px 5px",borderRadius:"10px",fontWeight:800,
                            background:C.purpleBg,color:C.purple}}>앙상블 {sig.ensembleCount}x</span>}
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

      </div>{/* end main content */}

      {/* ── QR 모달 (생성 / 스캔) ── */}
      {qrModal && (
        <div style={{
          position:"fixed",top:0,left:0,right:0,bottom:0,zIndex:9999,
          background:"rgba(0,0,0,0.85)",display:"flex",alignItems:"center",justifyContent:"center",padding:"20px"
        }} onClick={(e)=>{
          if (e.target === e.currentTarget) setQrModal(null);
        }}>
          <div style={{
            background:C.card,border:`1px solid ${C.border}`,borderRadius:"20px",padding:"28px",
            maxWidth:"360px",width:"100%",textAlign:"center"
          }}>
            {qrModal === "generate" && (
              <>
                <div style={{fontWeight:800,fontSize:"18px",marginBottom:"6px"}}>📱 QR 코드</div>
                <div style={{fontSize:"12px",color:C.text3,marginBottom:"20px"}}>
                  모바일 카메라 앱으로 스캔하세요
                </div>
                <div id="di-qr-container" style={{
                  display:"inline-block",padding:"16px",background:"#ffffff",borderRadius:"16px",
                }} />
                <div style={{fontSize:"10px",color:C.text3,marginTop:"16px"}}>
                  API 키 포함 — 주변에 다른 사람이 없을 때 사용
                </div>
              </>
            )}
            <button onClick={()=> setQrModal(null)} style={{
              marginTop:"20px",padding:"12px 32px",borderRadius:"10px",fontWeight:700,fontSize:"13px",
              background:C.card2,color:C.text2,border:`1px solid ${C.border2}`,cursor:"pointer",width:"100%"
            }}>닫기</button>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════
          MOBILE NAVIGATION: Horizontal tabs at bottom
      ═══════════════════════════════════════════════════════════ */}
      {isMobile && (
        <div style={{
          position: "fixed", bottom: "0", left: "0", right: "0",
          background: C.card, borderTop: `1px solid ${C.border}`,
          display: "flex", justifyContent: "space-around", alignItems: "center",
          padding: "8px 0", zIndex: 100, maxHeight: "56px",
        }}>
          {[
            { id: "dashboard", label: "포지션", count: filteredPositions.length },
            { id: "signals", label: "시그널", count: detectedSignals.length },
            { id: "market", label: "시장진단", count: null },
          ].map(({ id, label, count }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              style={{
                flex: 1, padding: "6px 4px", border: "none",
                background: activeTab === id ? `${C.blue}14` : "transparent",
                color: activeTab === id ? C.blue : C.text2,
                borderTop: activeTab === id ? `3px solid ${C.blue}` : `3px solid transparent`,
                fontSize: "11px", fontWeight: activeTab === id ? 700 : 600,
                cursor: "pointer", textAlign: "center", transition: "all 0.15s",
              }}
            >
              {label}
              {count != null && count > 0 && (
                <span style={{ fontSize: "8px", marginLeft: "2px" }}>({count})</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
