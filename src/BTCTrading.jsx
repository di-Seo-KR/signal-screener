// ════════════════════════════════════════════════════════════════════
// Zepta — ₿ 비트코인 전용 자동매매 시스템 v2.0
// BTC 알파 v2 멀티팩터 전략 + KV 가상 포트폴리오 자동매매
// CoinGecko 실시간 + Yahoo Finance 캔들 + Binance 데이터
// ════════════════════════════════════════════════════════════════════
import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { ALL_STRATEGIES, runBacktest, diagnoseMarket, strategyHurst, strategyVolCluster, strategyEfficiency, strategyMomDecay, strategyInfoFlow, strategyFundingRate, strategyMicrostructure, strategyEntropy } from "./strategies.js";

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

// 지원 크립토 자산
// KV 가상 포트폴리오에서 Binance USDT 쌍으로 거래됨
const BTC_ASSETS = [
  { sym: "BTC-USD", name: "Bitcoin", icon: "₿", weight: 0.35 },
  { sym: "ETH-USD", name: "Ethereum", icon: "Ξ", weight: 0.25 },
  { sym: "SOL-USD", name: "Solana", icon: "◎", weight: 0.15 },
  { sym: "AVAX-USD", name: "Avalanche", icon: "🔺", weight: 0.10 },
  { sym: "LINK-USD", name: "Chainlink", icon: "⬡", weight: 0.08 },
  { sym: "DOGE-USD", name: "Dogecoin", icon: "🐕", weight: 0.07 },
];

const BTC_STRATEGY = ALL_STRATEGIES.find(s => s.id === "btc_alpha");

// ── Storage (유저별 키 분리) ──
function makeBtcKeys(userId) {
  const p = userId ? `di_${userId.slice(0, 8)}_btc_` : "di_btc_";
  return { log: `${p}trade_log_v2`, settings: `${p}settings_v2` };
}
let KEYS = makeBtcKeys(null);
function load(k, fb) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fb; } catch { return fb; } }
function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }

// ── Virtual Portfolio API ──
async function fetchVirtualPortfolio() {
  try {
    const res = await fetch(`/api/virtual-portfolio?type=crypto`);
    if (!res.ok) throw new Error(`API ${res.status}`);
    const data = await res.json();
    return data.ok ? data.crypto : null;
  } catch (e) {
    console.error("Virtual portfolio fetch failed:", e);
    return null;
  }
}

// ── Yahoo candles ──
async function fetchCandles(symbol, range = "1y", interval = "1d") {
  try {
    const res = await fetch(`/api/yahoo-chart?symbol=${encodeURIComponent(symbol)}&range=${range}&interval=${interval}`);
    if (!res.ok) return [];
    const data = await res.json();
    const ts = data.chart?.result?.[0]?.timestamp;
    const q = data.chart?.result?.[0]?.indicators?.quote?.[0];
    if (!ts || !q) return [];
    return ts.map((t, i) => ({
      time: t, open: q.open?.[i], high: q.high?.[i], low: q.low?.[i], close: q.close?.[i], volume: q.volume?.[i],
    })).filter(c => c.close != null && c.high != null && c.low != null);
  } catch { return []; }
}

// ── CoinGecko ──
async function fetchCryptoPrices() {
  try {
    const r = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana,avalanche-2,chainlink,dogecoin&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true&include_market_cap=true");
    return r.ok ? await r.json() : null;
  } catch { return null; }
}
const GECKO = { "BTC-USD": "bitcoin", "ETH-USD": "ethereum", "SOL-USD": "solana", "AVAX-USD": "avalanche-2", "LINK-USD": "chainlink", "DOGE-USD": "dogecoin" };

// ── CryptoRiskManager ──
class CryptoRiskManager {
  constructor(config = {}) {
    this.maxCryptoExposure = config.maxCryptoExposure || 0.60; // 60% of portfolio
    this.volatilityThresholds = { calm: 40, normal: 80 }; // annualized %
    this.correlationThreshold = 0.85;
    this.maxDrawdown = config.maxDrawdown || 0.15; // 15%
  }

  calculateVolatility(prices) {
    if (!prices || prices.length < 2) return 0;
    const returns = [];
    for (let i = 1; i < prices.length; i++) {
      const ret = (prices[i] - prices[i - 1]) / prices[i - 1];
      returns.push(ret);
    }
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / returns.length;
    const stdDev = Math.sqrt(variance);
    return stdDev * Math.sqrt(252) * 100; // annualized %
  }

  getVolatilityRegime(annualizedVol) {
    if (annualizedVol < this.volatilityThresholds.calm) return "calm";
    if (annualizedVol < this.volatilityThresholds.normal) return "normal";
    return "wild";
  }

  kellyCriterion(winRate, avgWin, avgLoss) {
    if (avgLoss === 0) return 0.25;
    const kc = (winRate * avgWin - (1 - winRate) * avgLoss) / avgWin;
    return Math.max(0.05, Math.min(0.25, kc)); // clamp 5-25%
  }

  adjustPositionSize(baseSize, volatilityRegime, drawdown) {
    let volAdjust = 1.0;
    if (volatilityRegime === "calm") volAdjust = 1.2;
    else if (volatilityRegime === "wild") volAdjust = 0.6;

    const drawdownLevels = [
      { threshold: 0.05, mult: 1.0 },
      { threshold: 0.10, mult: 0.7 },
      { threshold: 0.15, mult: 0.4 },
      { threshold: Infinity, mult: 0.1 },
    ];
    let ddMult = 1.0;
    for (const level of drawdownLevels) {
      if (drawdown <= level.threshold) {
        ddMult = level.mult;
        break;
      }
    }

    return baseSize * volAdjust * ddMult;
  }

  shouldReduceForFearGreed(btcChange24h) {
    if (Math.abs(btcChange24h) > 5) return true; // >5% = extremes, reduce
    return false;
  }

  calculatePortfolioHeat(positions) {
    // Simple heat metric: sum of position notionals / total exposure
    if (!positions || positions.length === 0) return 0;
    const totalExposure = positions.reduce((sum, p) => sum + parseFloat(p.market_value || 0), 0);
    return Math.min(100, (totalExposure / 50000) * 100); // normalized to 50k baseline
  }

  estimateVaR(returns, confidence = 0.95) {
    if (!returns || returns.length < 10) return 0;
    const sorted = [...returns].sort((a, b) => a - b);
    const idx = Math.floor(sorted.length * (1 - confidence));
    return Math.abs(sorted[idx]) * 100;
  }
}

export default function BTCTrading({ theme = "dark", user, botPreset, botAllocation, isMobile = false }) {
  // 유저별 localStorage 키 분리
  const userId = user?.id || null;
  KEYS = makeBtcKeys(userId);

  const C = theme === "dark" ? DARK_C : LIGHT_C;

  // ── Settings State ──
  const [showSettings, setShowSettings] = useState(false);

  // ── Trading State ──
  const [prices, setPrices] = useState({});
  const [signals, setSignals] = useState([]);
  const [btResult, setBtResult] = useState(null);
  const [marketDiag, setMarketDiag] = useState(null);
  const [loading, setLoading] = useState(true);
  // ── botPreset별 전략/자산/파라미터 완전 차별화 ──
  const presetConfig = useMemo(() => {
    const pid = botPreset?.id;
    if (pid === "btc-alpha") return {
      riskLevel: "high",
      // BTC 전용 풀알파 — 9종 전략 풀가동, BTC 집중, 5분봉 스캘핑까지
      strategies: ["btc_alpha", "hurst_regime", "vol_cluster", "efficiency_ratio", "momentum_decay", "info_flow",
                   "funding_rate", "microstructure", "entropy_regime"],
      assets: ["BTC-USD"],             // BTC 단일 집중
      timeframes: ["1d", "4h", "5m"],  // 전 타임프레임
      scalpStrategies: ["btc_alpha", "hurst_regime", "vol_cluster", "microstructure"],
      positionMult: 1.2,               // 공격적 사이징
      cooldownMult: 0.8,               // 빠른 재진입
      desc: "BTC 전용 9종 알파 전략 — 펀딩레이트/마이크로스트럭처/엔트로피 포함",
    };
    if (pid === "crypto-diversity") return {
      riskLevel: "medium",
      // 5대 자산 분산 — 안정적 중기 + 엔트로피/정보흐름
      strategies: ["btc_alpha", "hurst_regime", "efficiency_ratio", "info_flow", "entropy_regime", "microstructure"],
      assets: ["BTC-USD", "ETH-USD", "SOL-USD", "AVAX-USD", "LINK-USD", "DOGE-USD"],  // 6자산 분산
      timeframes: ["1d", "4h"],        // 중기 이상만 (스캘핑 없음)
      scalpStrategies: [],
      positionMult: 0.7,               // 보수적 사이징
      cooldownMult: 1.5,               // 느린 재진입 (과매매 방지)
      desc: "5대 크립토 분산 — 엔트로피 레짐 + 정보흐름 중기 전략",
    };
    if (pid === "crypto-swing") return {
      riskLevel: "high",
      // 단기 스윙 — 변동성/펀딩/마이크로 집중, BTC+ETH+SOL
      strategies: ["btc_alpha", "vol_cluster", "momentum_decay", "funding_rate", "microstructure", "hurst_regime"],
      assets: ["BTC-USD", "ETH-USD", "SOL-USD"],  // 유동성 높은 3종
      timeframes: ["4h", "5m"],        // 단기 타임프레임 집중 (일봉 제외)
      scalpStrategies: ["btc_alpha", "vol_cluster", "microstructure", "funding_rate"],
      positionMult: 1.5,               // 매우 공격적 사이징
      cooldownMult: 0.5,               // 매우 빠른 재진입
      desc: "단기 스윙 — 펀딩레이트/마이크로 + 변동성 스캘핑",
    };
    // 프리셋 없으면 기본값 (전체 전략)
    return {
      riskLevel: null,
      strategies: ["btc_alpha", "hurst_regime", "vol_cluster", "efficiency_ratio", "momentum_decay", "info_flow",
                   "funding_rate", "microstructure", "entropy_regime"],
      assets: ["BTC-USD", "ETH-USD", "SOL-USD"],
      timeframes: ["1d", "4h", "5m"],
      scalpStrategies: ["btc_alpha", "hurst_regime", "vol_cluster", "microstructure"],
      positionMult: 1.0,
      cooldownMult: 1.0,
      desc: null,
    };
  }, [botPreset]);

  const [autoMode, setAutoMode] = useState(presetConfig.riskLevel ? true : load(KEYS.settings, { enabled: false, riskLevel: "medium" }).enabled);
  const [riskLevel, setRiskLevel] = useState(presetConfig.riskLevel || load(KEYS.settings, { enabled: false, riskLevel: "medium" }).riskLevel);
  const [tradeLog, setTradeLog] = useState(load(KEYS.log, []));
  const [btcCandles, setBtcCandles] = useState([]);
  const [subTab, setSubTab] = useState("overview");
  const [lastUpdate, setLastUpdate] = useState(null);
  const [riskManager] = useState(new CryptoRiskManager());
  const [volatilityRegime, setVolatilityRegime] = useState("normal");
  const [portfolioMetrics, setPortfolioMetrics] = useState({ heat: 0, var: 0, drawdown: 0 });
  const [lastAutoDecisions, setLastAutoDecisions] = useState([]);
  const [tradeCooldowns, setTradeCooldowns] = useState({});

  // ── Virtual Portfolio State ──
  const [virtualPortfolio, setVirtualPortfolio] = useState(null);
  const [portfolioLoading, setPortfolioLoading] = useState(false);

  // ── 봇별 독립 성과 (KV 데이터) ──
  const [botPerf, setBotPerf] = useState(null); // { perf, snapshot }
  useEffect(() => {
    const bid = botPreset?.id;
    if (!bid) return;
    let cancelled = false;
    const fetchBotPerf = async () => {
      try {
        const res = await fetch(`/api/bot-performance?botId=${bid}`);
        const data = await res.json();
        if (!cancelled && data.ok) setBotPerf({ perf: data.perf, snapshot: data.snapshot });
      } catch { /* 실패해도 기존 데이터로 폴백 */ }
    };
    fetchBotPerf();
    const interval = setInterval(fetchBotPerf, 60000); // 1분마다 갱신
    return () => { cancelled = true; clearInterval(interval); };
  }, [botPreset?.id]);

  const timerRef = useRef(null);

  // ── Virtual Portfolio 페치 ──
  const fetchPortfolio = useCallback(async () => {
    setPortfolioLoading(true);
    try {
      const portfolio = await fetchVirtualPortfolio();
      setVirtualPortfolio(portfolio);
    } catch (e) {
      console.error("Failed to fetch virtual portfolio:", e);
    } finally {
      setPortfolioLoading(false);
    }
  }, []);

  // ── 데이터 로딩 ──
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const geckoData = await fetchCryptoPrices();
      if (geckoData) {
        const pm = {};
        for (const a of BTC_ASSETS) {
          const g = GECKO[a.sym];
          if (geckoData[g]) pm[a.sym] = {
            price: geckoData[g].usd, change24h: geckoData[g].usd_24h_change,
            volume24h: geckoData[g].usd_24h_vol, marketCap: geckoData[g].usd_market_cap,
          };
        }
        setPrices(pm);
      }

      // ── 멀티 타임프레임 캔들 병렬 로딩 (전체 자산 동적) ──
      const assetSyms = BTC_ASSETS.map(a => a.sym);
      const candlePromises = [];
      for (const sym of assetSyms) {
        candlePromises.push(fetchCandles(sym, "1y"));       // 일봉
        candlePromises.push(fetchCandles(sym, "60d", "4h")); // 4시간봉
        candlePromises.push(fetchCandles(sym, "5d", "5m"));  // 5분봉
      }
      const allCandleData = await Promise.all(candlePromises);

      // 자산별 캔들 매핑 구성
      const dailyMap = {}, h4Map = {}, m5Map = {};
      assetSyms.forEach((sym, idx) => {
        dailyMap[sym] = allCandleData[idx * 3];
        h4Map[sym] = allCandleData[idx * 3 + 1];
        m5Map[sym] = allCandleData[idx * 3 + 2];
      });

      const candles = dailyMap["BTC-USD"] || [];
      if (candles.length > 60) {
        setBtcCandles(candles);

        // 변동성 레짐 계산
        const last30prices = candles.slice(-30).map(c => c.close).filter(c => c != null);
        const annVol = riskManager.calculateVolatility(last30prices);
        const regime = riskManager.getVolatilityRegime(annVol);
        setVolatilityRegime(regime);

        if (BTC_STRATEGY) {
          // ── 봇 프리셋별 전략/자산/타임프레임 차별화 ──
          const ALL_STRAT_MAP = {
            btc_alpha: BTC_STRATEGY, hurst_regime: strategyHurst, vol_cluster: strategyVolCluster,
            efficiency_ratio: strategyEfficiency, momentum_decay: strategyMomDecay, info_flow: strategyInfoFlow,
            funding_rate: strategyFundingRate, microstructure: strategyMicrostructure, entropy_regime: strategyEntropy,
          };
          const activeStrategies = presetConfig.strategies
            .map(id => ALL_STRAT_MAP[id]).filter(Boolean);
          const scalpStrats = presetConfig.scalpStrategies
            .map(id => ALL_STRAT_MAP[id]).filter(Boolean);
          const activeAssets = presetConfig.assets;
          const activeTFs = presetConfig.timeframes;

          const genSigs = (strats, candleMap, tf) => {
            if (!activeTFs.includes(tf)) return [];
            return activeAssets.flatMap(asset => {
              const c = candleMap[asset];
              if (!c || c.length <= 60) return [];
              return strats.flatMap(strat => {
                try { return (strat.generate(c) || []).map(s => ({ ...s, asset, stratId: strat.id, tf, time: c[s.index]?.time })); }
                catch { return []; }
              });
            });
          };

          // 타임프레임별 시그널 생성 (프리셋에 따라 자동 필터링)
          const dailySigs = genSigs(activeStrategies, dailyMap, "1d");
          const h4Sigs = genSigs(activeStrategies, h4Map, "4h");
          const m5Sigs = scalpStrats.length > 0 ? genSigs(scalpStrats, m5Map, "5m") : [];

          // 전체 시그널 합산 (타임스탬프 기준 정렬)
          const allSigs = [...dailySigs, ...h4Sigs, ...m5Sigs]
            .sort((a, b) => (a.time || 0) - (b.time || 0));
          setSignals(allSigs);

          // 백테스트는 BTC 일봉 Alpha 기준
          const sigs = btcSigsD.filter(s => s.stratId === "btc_alpha");
          const riskParams = {
            low: { positionSize: 0.5, stopLoss: 5, takeProfit: 10 },
            medium: { positionSize: 0.7, stopLoss: 8, takeProfit: 15 },
            high: { positionSize: 0.9, stopLoss: 12, takeProfit: 25 },
          };
          const rp = riskParams[riskLevel] || riskParams.medium;
          const bt = runBacktest(candles, sigs, {
            initialCapital: 10000, positionSize: rp.positionSize,
            commission: 0.001, slippage: 0.001, stopLoss: rp.stopLoss, takeProfit: rp.takeProfit,
          });
          setBtResult(bt);

          // 포트폴리오 메트릭 계산
          const returns = [];
          for (let i = 1; i < candles.length; i++) {
            returns.push((candles[i].close - candles[i - 1].close) / candles[i - 1].close);
          }
          const var95 = riskManager.estimateVaR(returns, 0.95);
          const equity = bt.finalEquity;
          const maxDD = ((bt.maxDrawdown / 100) * 10000) / equity;
          setPortfolioMetrics({ heat: 45, var: var95, drawdown: maxDD });
        }
        setMarketDiag(diagnoseMarket(candles));
      }
      setLastUpdate(new Date());
    } catch (e) { console.error("[BTC] loadData:", e); }
    setLoading(false);
  }, [riskLevel]);

  // ── 초기 데이터 로딩 및 가상 포트폴리오 페치 ──
  useEffect(() => {
    loadData();
    fetchPortfolio();
  }, [loadData, fetchPortfolio]);

  // ── 주기적 갱신: 가격 + 시그널 (90초), 포트폴리오 (90초) ──
  useEffect(() => {
    timerRef.current = setInterval(() => {
      loadData();
      fetchPortfolio();
    }, 90 * 1000);
    return () => clearInterval(timerRef.current);
  }, [loadData, fetchPortfolio]);

  // ── Auto mode 시그널 표시 (실제 거래는 cron job이 처리) ──
  useEffect(() => {
    if (!autoMode || signals.length === 0) return;

    const now = Date.now();
    const decisions = [];

    // 변동성 레짐 계산 (표시 목적)
    const btcPriceHistory = btcCandles.slice(-30).map(c => c.close).filter(c => c != null);
    const annualizedVol = riskManager.calculateVolatility(btcPriceHistory);
    const regime = riskManager.getVolatilityRegime(annualizedVol);

    // 최근 시그널 평가 (표시용만, 실제 거래는 cron이 처리)
    const nowSec = now / 1000;
    const recentSignals = signals.filter(sig => {
      if (!sig.time) return false;
      const ageSec = nowSec - sig.time;
      if (sig.tf === "5m") return ageSec < 30 * 60;
      if (sig.tf === "4h") return ageSec < 12 * 3600;
      return ageSec < 2 * 86400;
    }).slice(-15);

    for (const sig of recentSignals) {
      const asset = sig.asset || "BTC-USD";
      if (!sig.time) continue;
      if (!presetConfig.assets.includes(asset)) continue;

      // 표시용 의사결정 로직 (cron이 실제 거래 실행)
      const baseCooldown = sig.tf === "5m" ? 15 * 60 * 1000 : sig.tf === "4h" ? 2 * 3600 * 1000 : 4 * 3600 * 1000;
      const cooldownMs = baseCooldown * (presetConfig.cooldownMult || 1);
      const lastTradeSym = tradeCooldowns[asset];
      if (lastTradeSym && now - lastTradeSym < cooldownMs) {
        decisions.push({ symbol: asset, action: "skip", reason: "cooldown" });
        continue;
      }

      decisions.push({ symbol: asset, action: sig.type, reason: sig.reason, confidence: sig.confidence });
    }

    setLastAutoDecisions(decisions.slice(-5));
  }, [autoMode, signals, riskLevel, btcCandles, riskManager, presetConfig, tradeCooldowns]);

  // ── Settings 저장 ──
  useEffect(() => { save(KEYS.settings, { enabled: autoMode, riskLevel }); }, [autoMode, riskLevel]);

  // ── Derived ──
  const recentSignals = useMemo(() =>
    signals.slice(-30).reverse().map(s => ({
      ...s, date: s.time ? new Date(s.time * 1000) : (btcCandles[s.index]?.time ? new Date(btcCandles[s.index].time * 1000) : null),
    })), [signals, btcCandles]);
  const latestSignal = signals.length > 0 ? signals[signals.length - 1] : null;
  const latestDate = latestSignal?.time ? new Date(latestSignal.time * 1000) : (latestSignal && btcCandles[latestSignal.index]?.time ? new Date(btcCandles[latestSignal.index].time * 1000) : null);
  const cryptoPositions = virtualPortfolio?.positions || [];

  // ═══ RENDER ═══
  const fmtNum = (n) => typeof n === "number" ? n.toLocaleString(undefined, { maximumFractionDigits: 2 }) : n;
  const fmtPct = (n) => typeof n === "number" ? `${n >= 0 ? "+" : ""}${n.toFixed(2)}%` : n;

  const card = { background: C.card, borderRadius: "16px", border: `1px solid ${C.border}`, padding: "20px", marginBottom: "16px" };
  const stat = (label, val, color, sub) => (
    <div style={{ flex: 1, minWidth: "110px", padding: "12px 14px", borderRadius: "12px", background: C.card2, border: `1px solid ${C.border}` }}>
      <div style={{ fontSize: "11px", color: C.text3, marginBottom: "3px", fontWeight: 500 }}>{label}</div>
      <div style={{ fontSize: "17px", fontWeight: 800, color: color || C.text1 }}>{val}</div>
      {sub && <div style={{ fontSize: "10px", color: C.text3, marginTop: "2px" }}>{sub}</div>}
    </div>
  );
  const badge = (text, bg, color) => (
    <span style={{ fontSize: "10px", padding: "2px 7px", borderRadius: "5px", background: bg, color, fontWeight: 700 }}>{text}</span>
  );

  return (
    <div style={{ maxWidth: "900px", margin: "0 auto" }}>
      {/* ═══ 헤더 ═══ */}
      <div style={{ ...card, background: `linear-gradient(135deg, ${C.orange}12, ${C.yellow}06)`, border: `1px solid ${C.orange}25` }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "12px" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
              <span style={{ fontSize: "26px" }}>₿</span>
              <span style={{ fontSize: "20px", fontWeight: 800, color: C.text1 }}>BTC 자동매매</span>
              {badge("알파 v2", C.orangeBg, C.orange)}
              {autoMode && badge("자동매매 ON", C.greenBg, C.green)}
            </div>
            <div style={{ fontSize: "12px", color: C.text3 }}>
              10팩터 멀티스코어링 · 다중 타임프레임 · 변동성 적응형 · KV 자동매매
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <button onClick={() => setShowSettings(!showSettings)} style={{
              padding: "7px 12px", borderRadius: "8px", fontSize: "11px", fontWeight: 700,
              background: C.card2, color: C.text2, border: `1px solid ${C.border}`, cursor: "pointer",
            }}>⚙️ 설정</button>
            <div onClick={() => setAutoMode(!autoMode)} style={{
              width: "48px", height: "26px", borderRadius: "13px", cursor: "pointer",
              background: autoMode ? C.green : C.card2, border: `1px solid ${autoMode ? C.green : C.border}`,
              position: "relative", transition: "all .3s",
            }}>
              <div style={{
                width: "20px", height: "20px", borderRadius: "50%", background: "#fff",
                position: "absolute", top: "2px", left: autoMode ? "25px" : "2px",
                transition: "left .3s", boxShadow: "0 1px 3px rgba(0,0,0,.2)",
              }} />
            </div>
            <span style={{ fontSize: "11px", fontWeight: 700, color: autoMode ? C.green : C.text3 }}>
              {autoMode ? "자동 ON" : "자동 OFF"}
            </span>
          </div>
        </div>

        {/* 설정 패널 */}
        {showSettings && (
          <div style={{ marginTop: "16px", padding: "16px", borderRadius: "12px", background: C.card2, border: `1px solid ${C.border}` }}>
            <div style={{ fontSize: "13px", fontWeight: 700, color: C.text1, marginBottom: "12px" }}>자동매매 설정</div>
            <div style={{ fontSize: "11px", color: C.text3, marginBottom: "12px" }}>
              자동매매는 KV 가상 포트폴리오에서 진행됩니다. 리스크 레벨을 선택하세요.
            </div>
            <div style={{ display: "flex", gap: "8px", marginBottom: "12px" }}>
              {["low", "medium", "high"].map(r => (
                <button key={r} onClick={() => setRiskLevel(r)} style={{
                  flex: 1, padding: "8px", borderRadius: "8px", fontSize: "12px", fontWeight: 700,
                  background: riskLevel === r ? (r === "low" ? C.greenBg : r === "high" ? C.redBg : C.yellowBg) : C.bg,
                  color: riskLevel === r ? (r === "low" ? C.green : r === "high" ? C.red : C.yellow) : C.text2,
                  border: `1px solid ${riskLevel === r ? (r === "low" ? C.green : r === "high" ? C.red : C.yellow) : C.border}`,
                  cursor: "pointer",
                }}>
                  {r === "low" ? "🛡️ 보수" : r === "high" ? "⚡ 공격" : "⚖️ 중립"}
                </button>
              ))}
            </div>
            <button onClick={() => setShowSettings(false)} style={{
              width: "100%", padding: "8px", borderRadius: "8px", fontSize: "12px", fontWeight: 700,
              background: C.blue, color: "#fff", border: "none", cursor: "pointer",
            }}>닫기</button>
          </div>
        )}
      </div>

      {/* ═══ 가상매매 포트폴리오 ═══ */}
      {virtualPortfolio && (
        <div style={card}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
            <span style={{ fontSize: "13px", fontWeight: 700, color: C.text1 }}>가상매매 포트폴리오</span>
            {badge("KV 자동매매", C.purpleBg, C.purple)}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "12px" }}>
            {(() => {
              const equity = parseFloat(virtualPortfolio.equity || 0);
              const cash = parseFloat(virtualPortfolio.cash || 0);
              const dayPL = parseFloat(virtualPortfolio.dayPL || 0);
              const dayPLPct = parseFloat(virtualPortfolio.dayPLPct || 0);
              return <>
                {stat("자산 총액", `$${equity.toLocaleString(undefined, { maximumFractionDigits: 0 })}`, C.text1)}
                {stat("현금", `$${cash.toLocaleString(undefined, { maximumFractionDigits: 0 })}`, C.green)}
                {stat("오늘 P&L", `$${dayPL.toFixed(2)}`, dayPL >= 0 ? C.green : C.red, `${dayPLPct >= 0 ? "+" : ""}${dayPLPct.toFixed(2)}%`)}
              </>;
            })()}
          </div>
          {/* 크립토 포지션 */}
          {cryptoPositions && cryptoPositions.length > 0 && (
            <div>
              <div style={{ fontSize: "11px", fontWeight: 700, color: C.text3, marginBottom: "6px" }}>보유 크립토</div>
              {cryptoPositions.map((p, i) => {
                const pnl = parseFloat(p.unrealizedPL || 0);
                const pnlPct = parseFloat(p.unrealizedPLPct || 0);
                const assetIcon = BTC_ASSETS.find(a => p.symbol && a.sym.includes(p.symbol.split("USDT")[0]))?.icon || "₿";
                return (
                  <div key={i} style={{
                    display: "flex", alignItems: "center", gap: "10px", padding: "8px 12px",
                    borderRadius: "8px", background: C.card2, marginBottom: "4px",
                  }}>
                    <span style={{ fontSize: "16px" }}>{assetIcon}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: "12px", fontWeight: 700, color: C.text1 }}>{p.symbol || "Unknown"}</div>
                      <div style={{ fontSize: "10px", color: C.text3 }}>수량: {parseFloat(p.qty || 0).toFixed(6)}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: "12px", fontWeight: 700, color: C.text1 }}>${parseFloat(p.marketValue || 0).toFixed(2)}</div>
                      <div style={{ fontSize: "11px", fontWeight: 700, color: pnl >= 0 ? C.green : C.red }}>
                        {pnl >= 0 ? "+" : ""}{pnl.toFixed(2)} ({pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(2)}%)
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {(!cryptoPositions || cryptoPositions.length === 0) && <div style={{ fontSize: "11px", color: C.text3, textAlign: "center", padding: "8px" }}>보유 크립토 없음</div>}

          {/* ═══ 봇 독립 성과 지표 (KV 기반) ═══ */}
          {(() => {
            const snap = botPerf?.snapshot || {};
            const perf = botPerf?.perf || {};
            const unrealizedPL = snap.unrealizedPL || 0;
            const dd = snap.dd || 0;
            const mdd = snap.mdd || 0;
            const marketValue = snap.marketValue || 0;
            const initCapital = botAllocation || 100000;
            const invested = marketValue;
            const investedPct = initCapital > 0 ? (invested / initCapital) * 100 : 0;
            const tradeCount = perf.tradeCount || 0;
            const totalSold = perf.totalSellRevenue || 0;
            const totalBought = perf.totalBuyCost || 0;
            const realizedPL = totalSold - totalBought + unrealizedPL;
            const realizedPLPct = initCapital > 0 ? (realizedPL / initCapital) * 100 : 0;

            const fmtUSD = (v) => `${v >= 0 ? "+" : ""}$${Math.abs(v).toFixed(2)}`;
            const fmtPct = (v) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
            const metrics = [
              { label: "총 거래", value: `${tradeCount}회`, color: C.text1 },
              { label: "누적 수익", value: fmtUSD(realizedPL), sub: fmtPct(realizedPLPct), color: realizedPL >= 0 ? C.green : C.red },
              { label: "미실현 P&L", value: fmtUSD(unrealizedPL), color: unrealizedPL >= 0 ? C.green : C.red },
              { label: "Drawdown", value: `-${dd.toFixed(2)}%`, color: dd > 5 ? C.red : dd > 2 ? C.yellow : C.green },
              { label: "MDD", value: `-${mdd.toFixed(2)}%`, color: mdd > 10 ? C.red : mdd > 5 ? C.yellow : C.green },
              { label: "포지션 수", value: `${snap.positionCount || 0}개`, color: C.text1 },
            ];
            return (
              <div style={{ marginTop: "12px", borderTop: `1px solid ${C.border}40`, paddingTop: "12px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                  <span style={{ fontSize: "11px", fontWeight: 700, color: C.text3 }}>봇 독립 성과</span>
                  {snap.lastUpdated && (
                    <span style={{ fontSize: "9px", color: C.text3 }}>
                      {new Date(snap.lastUpdated).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })} 갱신
                    </span>
                  )}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "6px" }}>
                  {metrics.map((m, i) => (
                    <div key={i} style={{ background: C.card2, borderRadius: "8px", padding: "8px", textAlign: "center" }}>
                      <div style={{ fontSize: "9px", color: C.text3, marginBottom: "2px", fontWeight: 600 }}>{m.label}</div>
                      <div style={{ fontSize: "12px", fontWeight: 800, color: m.color }}>{m.value}</div>
                      {m.sub && <div style={{ fontSize: "9px", color: m.color, marginTop: "1px" }}>{m.sub}</div>}
                    </div>
                  ))}
                </div>
                {/* 최근 거래 내역 */}
                {perf.trades && perf.trades.length > 0 && (
                  <div style={{ marginTop: "8px" }}>
                    <div style={{ fontSize: "10px", fontWeight: 700, color: C.text3, marginBottom: "4px" }}>최근 거래</div>
                    {perf.trades.slice(0, 5).map((t, i) => (
                      <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
                        padding: "4px 6px", borderRadius: "4px", background: i % 2 === 0 ? C.card2 : "transparent", fontSize: "10px" }}>
                        <span style={{ color: t.type === "BUY" ? C.green : C.red, fontWeight: 700, minWidth: "32px" }}>{t.type}</span>
                        <span style={{ color: C.text2, flex: 1, marginLeft: "6px" }}>{t.asset}</span>
                        <span style={{ color: C.text1, fontWeight: 600 }}>${(t.amount || 0).toFixed(0)}</span>
                        <span style={{ color: C.text3, marginLeft: "6px", fontSize: "9px" }}>
                          {t.time ? new Date(t.time).toLocaleDateString("ko-KR", { month: "short", day: "numeric" }) : ""}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}

      {/* ═══ 실시간 가격 ═══ */}
      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontSize: "13px", fontWeight: 700, color: C.text1 }}>실시간 크립토</span>
            {/* 리스크 레벨 */}
            <div style={{ display: "flex", gap: "4px" }}>
              {["low", "medium", "high"].map(r => (
                <button key={r} onClick={() => setRiskLevel(r)} style={{
                  padding: "2px 8px", borderRadius: "4px", fontSize: "9px", fontWeight: 700,
                  background: riskLevel === r ? (r === "low" ? C.greenBg : r === "high" ? C.redBg : C.yellowBg) : C.card2,
                  color: riskLevel === r ? (r === "low" ? C.green : r === "high" ? C.red : C.yellow) : C.text3,
                  border: "none", cursor: "pointer",
                }}>{r === "low" ? "보수" : r === "high" ? "공격" : "중립"}</button>
              ))}
            </div>
          </div>
          {lastUpdate && <span style={{ fontSize: "10px", color: C.text3 }}>{lastUpdate.toLocaleTimeString("ko-KR")}</span>}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          {BTC_ASSETS.map(a => {
            const p = prices[a.sym];
            const isUp = p && p.change24h >= 0;
            return (
              <div key={a.sym} style={{
                display: "flex", alignItems: "center", padding: "10px 14px", borderRadius: "10px",
                background: C.card2, gap: "10px",
                border: a.sym === "BTC-USD" ? `1px solid ${C.orange}25` : `1px solid transparent`,
              }}>
                <span style={{ fontSize: "18px", width: "24px", textAlign: "center" }}>{a.icon}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <span style={{ fontSize: "12px", fontWeight: 700, color: C.text1 }}>{a.name}</span>
                    {badge(`${(a.weight * 100).toFixed(0)}%`, C.purpleBg, C.purple)}
                  </div>
                  {p?.volume24h && <div style={{ fontSize: "10px", color: C.text3 }}>Vol ${(p.volume24h / 1e9).toFixed(1)}B</div>}
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: "13px", fontWeight: 800, color: C.text1 }}>{p ? `$${p.price?.toLocaleString()}` : "..."}</div>
                  {p && <div style={{ fontSize: "10px", fontWeight: 700, color: isUp ? C.green : C.red }}>{isUp ? "+" : ""}{p.change24h?.toFixed(2)}%</div>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ═══ 탭 네비게이션 ═══ */}
      <div style={{ display: "flex", gap: "6px", marginBottom: "16px", overflowX: "auto" }}>
        {[
          { id: "overview", label: "전략 개요", icon: "📊" },
          { id: "signals", label: "시그널", icon: "🔔" },
          { id: "performance", label: "성과 분석", icon: "📉" },
          { id: "log", label: "매매 기록", icon: "📋" },
        ].map(t => (
          <button key={t.id} onClick={() => setSubTab(t.id)} style={{
            padding: "8px 14px", borderRadius: "10px", fontSize: "12px", fontWeight: 700,
            background: subTab === t.id ? C.blueBg : C.card2,
            color: subTab === t.id ? C.blue : C.text3,
            border: `1px solid ${subTab === t.id ? C.blue + "40" : C.border}`,
            cursor: "pointer", whiteSpace: "nowrap",
          }}>{t.icon} {t.label}</button>
        ))}
      </div>

      {/* ═══ 전략 개요 ═══ */}
      {subTab === "overview" && (
        <>
          {/* 봇 프리셋 전략 정보 배너 */}
          {presetConfig.desc && (
            <div style={{
              ...card, padding: "12px 14px",
              background: `linear-gradient(135deg, ${C.purple}08, ${C.blue}05)`,
              border: `1px solid ${C.purple}20`,
            }}>
              <div style={{ fontSize: "11px", fontWeight: 700, color: C.purple, marginBottom: "6px" }}>
                🎯 {presetConfig.desc}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                {presetConfig.assets.map(a => badge(a.replace("-USD",""), C.blueBg, C.blue))}
                {presetConfig.timeframes.map(tf => badge(tf, C.purpleBg, C.purple))}
                {badge(`전략 ${presetConfig.strategies.length}종`, C.greenBg, C.green)}
                {badge(`사이징 x${presetConfig.positionMult}`, C.yellowBg, C.yellow)}
              </div>
            </div>
          )}
          {latestSignal && (
            <div style={{
              ...card,
              background: latestSignal.type === "BUY" ? `linear-gradient(135deg, ${C.green}10, ${C.green}04)` : `linear-gradient(135deg, ${C.red}10, ${C.red}04)`,
              border: `1px solid ${latestSignal.type === "BUY" ? C.green : C.red}25`,
            }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  {badge(latestSignal.type === "BUY" ? "매수" : "매도", latestSignal.type === "BUY" ? C.greenBg : C.redBg, latestSignal.type === "BUY" ? C.green : C.red)}
                  {latestSignal.confidence && badge(`${latestSignal.confidence}급`, C.blueBg, C.blue)}
                  <span style={{ fontSize: "11px", color: C.text3 }}>최신 시그널</span>
                </div>
                {latestDate && <span style={{ fontSize: "10px", color: C.text3 }}>{latestDate.toLocaleDateString("ko-KR")}</span>}
              </div>
              <div style={{ fontSize: "12px", color: C.text2, lineHeight: 1.6 }}>{latestSignal.reason}</div>
              <div style={{ display: "flex", gap: "10px", marginTop: "6px", fontSize: "11px", color: C.text3 }}>
                <span>가격: ${latestSignal.price?.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                {latestSignal.atrPct && <span>ATR: {latestSignal.atrPct}%</span>}
                {latestSignal.positionSize && <span>포지션: {(latestSignal.positionSize * 100).toFixed(0)}%</span>}
              </div>
            </div>
          )}

          {/* ═══ 변동성 레짐 + 포트폴리오 리스크 ═══ */}
          <div style={card}>
            <div style={{ fontSize: "13px", fontWeight: 700, color: C.text1, marginBottom: "12px" }}>📊 리스크 & 변동성</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "12px" }}>
              {(() => {
                const regimeEmoji = volatilityRegime === "calm" ? "🟢" : volatilityRegime === "wild" ? "🔴" : "🟡";
                const regimeLabel = volatilityRegime === "calm" ? "Calm" : volatilityRegime === "wild" ? "Wild" : "Normal";
                return stat("변동성", `${regimeEmoji} ${regimeLabel}`, volatilityRegime === "calm" ? C.green : volatilityRegime === "wild" ? C.red : C.yellow);
              })()}
              {stat("포트폴리오 Heat", `${portfolioMetrics.heat?.toFixed(0) || 0}%`, portfolioMetrics.heat > 70 ? C.red : portfolioMetrics.heat > 40 ? C.yellow : C.green)}
              {stat("VaR (95%)", `${portfolioMetrics.var?.toFixed(2) || 0}%`, C.orange)}
              {stat("Max Drawdown", `${(portfolioMetrics.drawdown * 100)?.toFixed(2) || 0}%`, portfolioMetrics.drawdown > 0.1 ? C.red : C.yellow)}
            </div>
          </div>

          {/* ═══ 포트폴리오 할당 ═══ */}
          <div style={card}>
            <div style={{ fontSize: "13px", fontWeight: 700, color: C.text1, marginBottom: "10px" }}>💼 목표 할당</div>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {BTC_ASSETS.map(a => (
                <div key={a.sym} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span style={{ fontSize: "12px", fontWeight: 600, color: C.text1, minWidth: "50px" }}>{a.name}</span>
                  <div style={{ flex: 1, height: "20px", borderRadius: "4px", background: C.card2, overflow: "hidden" }}>
                    <div style={{
                      height: "100%", width: `${a.weight * 100}%`,
                      background: a.sym === "BTC-USD" ? C.orange : a.sym === "ETH-USD" ? C.purple : a.sym === "SOL-USD" ? C.blue : a.sym === "BNB-USD" ? C.yellow : C.green,
                      transition: "width .3s",
                    }} />
                  </div>
                  <span style={{ fontSize: "11px", fontWeight: 700, color: C.text2, minWidth: "35px", textAlign: "right" }}>{(a.weight * 100).toFixed(0)}%</span>
                </div>
              ))}
            </div>
          </div>

          {/* ═══ 자동매매 상태 ═══ */}
          {autoMode && lastAutoDecisions.length > 0 && (
            <div style={{ ...card, background: `linear-gradient(135deg, ${C.blue}10, ${C.blue}04)`, border: `1px solid ${C.blue}25` }}>
              <div style={{ fontSize: "13px", fontWeight: 700, color: C.text1, marginBottom: "10px" }}>🤖 최근 자동 결정</div>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {lastAutoDecisions.slice(-3).reverse().map((d, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "8px 10px", borderRadius: "8px", background: C.card2, fontSize: "11px" }}>
                    {d.action === "BUY" && badge("BUY", C.greenBg, C.green)}
                    {d.action === "SELL" && badge("SELL", C.redBg, C.red)}
                    {d.action === "skip" && badge("SKIP", C.card2, C.text3)}
                    {d.action === "reduce" && badge("REDUCE", C.yellowBg, C.yellow)}
                    <span style={{ flex: 1, color: C.text2 }}>{d.reason || d.symbol}</span>
                    {d.amount && <span style={{ fontWeight: 700, color: C.text1 }}>${d.amount}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {marketDiag && (
            <div style={card}>
              <div style={{ fontSize: "13px", fontWeight: 700, color: C.text1, marginBottom: "10px" }}>₿ 시장 진단</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                {stat("국면", marketDiag.regime, C.blue)}
                {stat("추세", marketDiag.trend, marketDiag.trend === "상승" ? C.green : marketDiag.trend === "하락" ? C.red : C.yellow)}
                {stat("변동성", marketDiag.volatility, marketDiag.volatility === "높음" ? C.red : C.green)}
                {stat("RSI", marketDiag.rsi?.toFixed(1) || "-", marketDiag.rsi > 70 ? C.red : marketDiag.rsi < 30 ? C.green : C.text1)}
                {stat("ATR%", (marketDiag.atrPct || 0).toFixed(2) + "%", C.orange)}
                {stat("모멘텀", marketDiag.momentum, C.purple)}
              </div>
            </div>
          )}

          <div style={card}>
            <div style={{ fontSize: "13px", fontWeight: 700, color: C.text1, marginBottom: "10px" }}>BTC 알파 v2 — 10팩터 구성</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" }}>
              {[
                { icon: "📉", name: "RSI 적응형", desc: "ATR 기반 동적 임계값 (20~32/68~80)" },
                { icon: "🎯", name: "BB 2.5σ", desc: "고변동성 볼린저밴드 + 스퀴즈" },
                { icon: "📊", name: "MACD 가속도", desc: "골든/데드크로스 + 히스토그램 방향전환" },
                { icon: "📈", name: "EMA 삼중", desc: "21/55/200 단기·중기·장기 추세" },
                { icon: "🔥", name: "스마트 거래량", desc: "서지 감지 + OBV 스마트머니 추적" },
                { icon: "🕐", name: "주봉 추세", desc: "다중 타임프레임 — 주봉 EMA 확인" },
                { icon: "🔀", name: "RSI 다이버전스", desc: "강세/약세 가격-RSI 괴리 탐지" },
                { icon: "📊", name: "스토캐스틱", desc: "과매수/과매도 크로스 확인" },
                { icon: "🕯️", name: "캔들 패턴", desc: "해머·장악형·도지 자동 인식" },
                { icon: "💪", name: "모멘텀 연속", desc: "N봉 연속 방향성 + ADX 강도" },
              ].map((f, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "8px 10px", borderRadius: "8px", background: C.card2 }}>
                  <span style={{ fontSize: "14px" }}>{f.icon}</span>
                  <div>
                    <div style={{ fontSize: "11px", fontWeight: 700, color: C.text1 }}>{f.name}</div>
                    <div style={{ fontSize: "10px", color: C.text3 }}>{f.desc}</div>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: "10px", padding: "8px 12px", borderRadius: "8px", background: C.orangeBg, border: `1px solid ${C.orange}15` }}>
              <div style={{ fontSize: "10px", color: C.orange, fontWeight: 600, lineHeight: 1.5 }}>
                스코어 5pt 이상 + 3팩터 이상 동시 발동 시 시그널 · 쿨다운 3봉 · 신뢰도 A/B/C 등급 · ATR 동적 포지션 사이징
              </div>
            </div>
          </div>
        </>
      )}

      {/* ═══ 시그널 ═══ */}
      {subTab === "signals" && (
        <div style={card}>
          <div style={{ fontSize: "13px", fontWeight: 700, color: C.text1, marginBottom: "4px" }}>매매 시그널 히스토리</div>
          <div style={{ fontSize: "11px", color: C.text3, marginBottom: "12px" }}>BTC 알파 v2 · 일봉 · 최근 20건</div>
          {recentSignals.length === 0 ? (
            <div style={{ textAlign: "center", padding: "40px", color: C.text3 }}>시그널 없음</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
              {recentSignals.map((s, i) => (
                <div key={i} style={{
                  display: "flex", alignItems: "center", gap: "8px", padding: "10px 12px",
                  borderRadius: "10px", background: C.card2, borderLeft: `3px solid ${s.type === "BUY" ? C.green : C.red}`,
                }}>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "2px" }}>
                    {badge(s.type === "BUY" ? "매수" : "매도", s.type === "BUY" ? C.greenBg : C.redBg, s.type === "BUY" ? C.green : C.red)}
                    {s.confidence && badge(s.confidence, C.blueBg, C.blue)}
                    {s.tf && badge(s.tf, C.purpleBg, C.purple)}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "11px", color: C.text2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {s.asset && <span style={{ fontWeight: 700 }}>[{s.asset.replace("-USD","")}] </span>}{s.reason}
                    </div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div style={{ fontSize: "12px", fontWeight: 700, color: C.text1 }}>${s.price?.toLocaleString(undefined, { maximumFractionDigits: s.price > 100 ? 0 : 2 })}</div>
                    {s.date && <div style={{ fontSize: "9px", color: C.text3 }}>{s.date.toLocaleDateString("ko-KR", { month: "short", day: "numeric" })} {s.tf !== "1d" ? s.date.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }) : ""}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ═══ 백테스트 ═══ */}
      {subTab === "backtest" && (
        <div style={card}>
          <div style={{ fontSize: "13px", fontWeight: 700, color: C.text1, marginBottom: "4px" }}>백테스트 결과 (1년)</div>
          <div style={{ fontSize: "11px", color: C.text3, marginBottom: "12px" }}>
            리스크: {riskLevel === "low" ? "보수 (포지션 50%, 손절 5%)" : riskLevel === "high" ? "공격 (포지션 90%, 손절 12%)" : "중립 (포지션 70%, 손절 8%)"}
          </div>
          {!btResult ? <div style={{ textAlign: "center", padding: "40px", color: C.text3 }}>로딩중...</div> : (
            <>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "14px" }}>
                {stat("총 수익률", `${btResult.totalReturn >= 0 ? "+" : ""}${btResult.totalReturn}%`, btResult.totalReturn >= 0 ? C.green : C.red)}
                {stat("최종 자산", `$${btResult.finalEquity.toLocaleString()}`, btResult.finalEquity > 10000 ? C.green : C.red, "초기 $10,000")}
                {stat("승률", `${btResult.winRate}%`, btResult.winRate >= 50 ? C.green : C.red)}
                {stat("거래 수", `${btResult.totalTrades}회`, C.blue)}
                {stat("샤프", btResult.sharpeRatio.toFixed(2), btResult.sharpeRatio > 1 ? C.green : C.yellow)}
                {stat("PF", btResult.profitFactor === Infinity ? "∞" : btResult.profitFactor.toFixed(2), btResult.profitFactor > 1.5 ? C.green : C.yellow)}
                {stat("최대 낙폭", `-${btResult.maxDrawdown}%`, C.red)}
                {stat("B&H", `${btResult.buyHoldReturn >= 0 ? "+" : ""}${btResult.buyHoldReturn}%`, btResult.buyHoldReturn >= 0 ? C.green : C.red, "벤치마크")}
              </div>
              <div style={{
                padding: "10px 14px", borderRadius: "10px",
                background: btResult.totalReturn > btResult.buyHoldReturn ? C.greenBg : C.card2,
                border: `1px solid ${btResult.totalReturn > btResult.buyHoldReturn ? C.green : C.border}20`,
                fontSize: "12px", fontWeight: 700,
                color: btResult.totalReturn > btResult.buyHoldReturn ? C.green : C.text2,
              }}>
                {btResult.totalReturn > btResult.buyHoldReturn
                  ? `전략이 Buy&Hold 대비 +${(btResult.totalReturn - btResult.buyHoldReturn).toFixed(1)}%p 초과 수익`
                  : `Buy&Hold 대비 ${(btResult.totalReturn - btResult.buyHoldReturn).toFixed(1)}%p — 리스크 관리로 낙폭 제한`}
              </div>
              {btResult.trades.length > 0 && (
                <div style={{ marginTop: "14px" }}>
                  <div style={{ fontSize: "11px", fontWeight: 700, color: C.text3, marginBottom: "6px" }}>최근 거래</div>
                  <div style={{ maxHeight: "280px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "3px" }}>
                    {btResult.trades.slice(-15).reverse().map((t, i) => (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: "6px", padding: "5px 8px", borderRadius: "6px", background: C.card2, fontSize: "10px" }}>
                        {badge(t.type === "BUY" ? "매수" : "매도", t.type === "BUY" ? C.greenBg : C.redBg, t.type === "BUY" ? C.green : C.red)}
                        <span style={{ color: C.text2, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.reason}</span>
                        <span style={{ fontWeight: 700, color: C.text1 }}>${t.price?.toFixed(0)}</span>
                        {t.pnlPct != null && <span style={{ fontWeight: 700, color: t.pnlPct >= 0 ? C.green : C.red, minWidth: "42px", textAlign: "right", flexShrink: 0 }}>{t.pnlPct >= 0 ? "+" : ""}{t.pnlPct.toFixed(1)}%</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ═══ 성과 분석 ═══ */}
      {subTab === "performance" && (
        <div style={card}>
          <div style={{ fontSize: "13px", fontWeight: 700, color: C.text1, marginBottom: "12px" }}>📉 성과 분석</div>
          {(() => {
            // 트레이드 로그 분석
            const totalTrades = tradeLog.length;
            const buyTrades = tradeLog.filter(t => t.type === "BUY");
            const sellTrades = tradeLog.filter(t => t.type === "SELL");
            const totalNotional = tradeLog.reduce((sum, t) => sum + (t.notional || 0), 0);
            const totalPnL = btResult?.totalReturn || 0;
            const winCount = btResult?.trades?.filter(t => t.pnlPct > 0).length || 0;
            const lossCount = btResult?.trades?.filter(t => t.pnlPct <= 0).length || 0;
            const winRate = totalTrades > 0 ? ((winCount / (winCount + lossCount)) * 100).toFixed(1) : 0;

            const bestTrade = btResult?.trades?.reduce((best, t) => (t.pnlPct > (best?.pnlPct || 0) ? t : best), null);
            const worstTrade = btResult?.trades?.reduce((worst, t) => (t.pnlPct < (worst?.pnlPct || 0) ? t : worst), null);

            // Sharpe-like metric (매우 간단한 버전)
            const sharpe = btResult?.sharpeRatio || 0;

            return (
              <>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "14px" }}>
                  {stat("총 P&L", `${totalPnL >= 0 ? "+" : ""}${totalPnL.toFixed(1)}%`, totalPnL >= 0 ? C.green : C.red)}
                  {stat("거래 수", `${totalTrades}`, C.blue)}
                  {stat("매수", `${buyTrades.length}`, C.green)}
                  {stat("매도", `${sellTrades.length}`, C.red)}
                </div>

                <div style={{ marginBottom: "14px", padding: "10px 14px", borderRadius: "10px", background: C.card2, border: `1px solid ${C.border}` }}>
                  <div style={{ fontSize: "11px", fontWeight: 700, color: C.text3, marginBottom: "8px" }}>WIN RATE</div>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: "18px", fontWeight: 800, color: C.text1 }}>{winRate}%</div>
                      <div style={{ fontSize: "10px", color: C.text3, marginTop: "2px" }}>
                        {winCount}승 / {lossCount}패
                      </div>
                    </div>
                    <div style={{ width: "60px", height: "40px", borderRadius: "6px", background: C.bg, position: "relative", overflow: "hidden" }}>
                      <div style={{
                        height: "100%", width: `${Math.min(winRate, 100)}%`,
                        background: winRate >= 50 ? C.green : C.red, transition: "width .3s",
                      }} />
                    </div>
                  </div>
                </div>

                <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "14px" }}>
                  {stat("Risk-Adj Return", `${sharpe.toFixed(2)}`, sharpe > 1 ? C.green : C.yellow, "Sharpe")}
                  {stat("Best Trade", bestTrade ? `+${bestTrade.pnlPct.toFixed(1)}%` : "-", C.green)}
                  {stat("Worst Trade", worstTrade ? `${worstTrade.pnlPct.toFixed(1)}%` : "-", C.red)}
                  {stat("Avg Trade", btResult?.trades?.length > 0 ? `${(btResult.trades.reduce((sum, t) => sum + (t.pnlPct || 0), 0) / btResult.trades.length).toFixed(2)}%` : "-", C.text1)}
                </div>

                {btResult?.trades && btResult.trades.length > 0 && (
                  <div>
                    <div style={{ fontSize: "11px", fontWeight: 700, color: C.text3, marginBottom: "6px" }}>최근 거래 상세</div>
                    <div style={{ maxHeight: "200px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "3px" }}>
                      {btResult.trades.slice(-8).reverse().map((t, i) => (
                        <div key={i} style={{ display: "flex", alignItems: "center", gap: "6px", padding: "6px 8px", borderRadius: "6px", background: C.bg, fontSize: "10px" }}>
                          {badge(t.type === "BUY" ? "매수" : "매도", t.type === "BUY" ? C.greenBg : C.redBg, t.type === "BUY" ? C.green : C.red)}
                          <span style={{ color: C.text3, minWidth: "50px" }}>${t.price?.toFixed(0)}</span>
                          {t.pnlPct != null && (
                            <span style={{ fontWeight: 700, color: t.pnlPct >= 0 ? C.green : C.red, minWidth: "45px", textAlign: "right" }}>
                              {t.pnlPct >= 0 ? "+" : ""}{t.pnlPct.toFixed(2)}%
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            );
          })()}
        </div>
      )}

      {/* ═══ 매매 기록 ═══ */}
      {subTab === "log" && (
        <div style={card}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
            <div>
              <div style={{ fontSize: "13px", fontWeight: 700, color: C.text1 }}>매매 기록</div>
              <div style={{ fontSize: "11px", color: C.text3 }}>KV 자동매매 히스토리</div>
            </div>
            {tradeLog.length > 0 && (
              <button onClick={() => { setTradeLog([]); save(KEYS.log, []); }} style={{
                padding: "4px 10px", borderRadius: "6px", fontSize: "10px", fontWeight: 600,
                background: C.card2, color: C.text3, border: `1px solid ${C.border}`, cursor: "pointer",
              }}>초기화</button>
            )}
          </div>
          {tradeLog.length === 0 ? (
            <div style={{ textAlign: "center", padding: "40px", color: C.text3 }}>
              <div style={{ fontSize: "24px", marginBottom: "8px" }}>₿</div>
              <div style={{ fontSize: "12px", fontWeight: 600 }}>매매 기록 없음</div>
              <div style={{ fontSize: "11px", marginTop: "4px" }}>
                자동매매를 켜면 시그널 발생 시 KV 포트폴리오에 자동 주문됩니다
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "4px", maxHeight: "400px", overflowY: "auto" }}>
              {tradeLog.map((t, i) => (
                <div key={i} style={{
                  display: "flex", alignItems: "center", gap: "6px", padding: "8px 10px",
                  borderRadius: "8px", background: C.card2, fontSize: "11px",
                }}>
                  {badge(t.type === "BUY" ? "매수" : "매도", t.type === "BUY" ? C.greenBg : C.redBg, t.type === "BUY" ? C.green : C.red)}
                  {t.auto && badge("AUTO", C.purpleBg, C.purple)}
                  <span style={{ color: C.text2, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.reason}</span>
                  {t.notional && <span style={{ fontWeight: 600, color: C.text1 }}>${t.notional}</span>}
                  <span style={{ color: C.text3, fontSize: "9px" }}>{new Date(t.time).toLocaleDateString("ko-KR")}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div style={{ textAlign: "center", padding: "12px", fontSize: "10px", color: C.text3, lineHeight: 1.5 }}>
        ₿ BTC 알파 v2 · 10팩터 멀티스코어링 · Binance 데이터 · KV 가상매매<br/>
        투자 판단은 본인의 책임입니다 · 시뮬레이션 결과가 미래 수익을 보장하지 않습니다
      </div>
    </div>
  );
}
