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
// 전체 크립토 자산 목록 (아이콘/이름 매핑)
const ALL_CRYPTO = {
  "BTC/USD": { sym: "BTC-USD", name: "Bitcoin", icon: "₿" },
  "ETH/USD": { sym: "ETH-USD", name: "Ethereum", icon: "Ξ" },
  "SOL/USD": { sym: "SOL-USD", name: "Solana", icon: "◎" },
  "XRP/USD": { sym: "XRP-USD", name: "XRP", icon: "✕" },
  "ADA/USD": { sym: "ADA-USD", name: "Cardano", icon: "◆" },
  "AVAX/USD": { sym: "AVAX-USD", name: "Avalanche", icon: "🔺" },
  "LINK/USD": { sym: "LINK-USD", name: "Chainlink", icon: "⬡" },
  "UNI/USD": { sym: "UNI-USD", name: "Uniswap", icon: "🦄" },
  "AAVE/USD": { sym: "AAVE-USD", name: "Aave", icon: "👻" },
  "DOT/USD": { sym: "DOT-USD", name: "Polkadot", icon: "●" },
  "DOGE/USD": { sym: "DOGE-USD", name: "Dogecoin", icon: "🐕" },
  "SHIB/USD": { sym: "SHIB-USD", name: "Shiba Inu", icon: "🐶" },
  "PEPE/USD": { sym: "PEPE-USD", name: "Pepe", icon: "🐸" },
  "ARB/USD": { sym: "ARB-USD", name: "Arbitrum", icon: "🔵" },
  "OP/USD": { sym: "OP-USD", name: "Optimism", icon: "🔴" },
  "MATIC/USD": { sym: "MATIC-USD", name: "Polygon", icon: "💜" },
};

// 봇별 매매 대상 자산 (btc-cron.js BOT_ASSET_MAP과 동기화)
const BOT_ASSET_MAP = {
  "btc-alpha": ["BTC/USD"],
  "highcap-momentum": ["BTC/USD", "ETH/USD", "SOL/USD", "XRP/USD", "ADA/USD", "AVAX/USD"],
  "defi-infra": ["LINK/USD", "UNI/USD", "AAVE/USD", "DOT/USD"],
  "meme-trend": ["DOGE/USD", "SHIB/USD", "PEPE/USD"],
  "l2-emerging": ["ARB/USD", "OP/USD", "MATIC/USD"],
  "crypto-diversity": Object.keys(ALL_CRYPTO),
  "crypto-swing": Object.keys(ALL_CRYPTO),
};

// 기본 폴백 (봇 미지정 시)
const DEFAULT_ASSETS = ["BTC/USD", "ETH/USD", "SOL/USD", "AVAX/USD", "LINK/USD", "DOGE/USD"];

// 봇 ID에 맞는 자산 목록 반환
function getBotAssets(botId) {
  const assetKeys = BOT_ASSET_MAP[botId] || DEFAULT_ASSETS;
  return assetKeys.map(k => ALL_CRYPTO[k]).filter(Boolean);
}

// 하위 호환용 (기존 코드에서 BTC_ASSETS 참조하는 부분)
const BTC_ASSETS = Object.values(ALL_CRYPTO).slice(0, 6);

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
  const [subTab, setSubTab] = useState(() => botPreset ? "dashboard" : load("di_btc_tab", "overview"));
  const [detailChartTab, setDetailChartTab] = useState("roi"); // "roi" or "pnl"
  const [chartHover, setChartHover] = useState(null); // { idx, x, y }
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
        if (!cancelled && data.ok) setBotPerf({ perf: data.perf, snapshot: data.snapshot, equityCurve: data.equityCurve || [], pnlCurve: data.pnlCurve || [] });
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
        const allAssets = Object.values(ALL_CRYPTO);
        for (const a of allAssets) {
          const g = GECKO[a.sym];
          if (geckoData[g]) pm[a.sym] = {
            price: geckoData[g].usd, change24h: geckoData[g].usd_24h_change,
            volume24h: geckoData[g].usd_24h_vol, marketCap: geckoData[g].usd_market_cap,
          };
        }
        setPrices(pm);
      }

      // ── 멀티 타임프레임 캔들 병렬 로딩 (전체 자산 동적) ──
      const botAssets = getBotAssets(botPreset?.id);
      const assetSyms = botAssets.map(a => a.sym);
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
          // 포트폴리오 Heat: 포지션 비율 기반 (미실현 손익 기준 리스크)
          const snapData = botPerf?.snapshot || {};
          const pCnt = snapData.positionCount || 0;
          const botAssetCnt = getBotAssets(botPreset?.id)?.length || 6;
          const posRatio = Math.min(pCnt / botAssetCnt, 1) * 100; // 포지션 점유율
          setPortfolioMetrics({ heat: posRatio, var: var95, drawdown: maxDD });
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
  // 봇별 자산 필터링 — 해당 봇이 담당하는 자산만 표시
  const botAssetKeys = BOT_ASSET_MAP[botPreset?.id] || null;
  const cryptoPositions = (virtualPortfolio?.positions || []).filter(p => {
    if (!botAssetKeys) return true; // 매핑 없으면 전체 표시
    return botAssetKeys.some(key => {
      const sym = key.replace("/USD", ""); // "BTC/USD" → "BTC"
      return p.symbol && (p.symbol === key || p.symbol.startsWith(sym));
    });
  });

  // ═══ RENDER ═══
  const fmtNum = (n) => typeof n === "number" ? n.toLocaleString(undefined, { maximumFractionDigits: 2 }) : n;
  const fmtPct = (n) => typeof n === "number" ? `${n >= 0 ? "+" : ""}${n.toFixed(2)}%` : n;

  const card = { background: C.card, borderRadius: "16px", border: `1px solid ${C.border}`, padding: "20px", marginBottom: "16px" };
  const stat = (label, val, color, sub) => (
    <div style={{ flex: 1, minWidth: "110px", padding: "12px 14px", borderRadius: "12px", background: C.card2, border: `1px solid ${C.border}` }}>
      <div style={{ fontSize: isMobile ? "12px" : "14px", color: C.text3, marginBottom: "3px", fontWeight: 500 }}>{label}</div>
      <div style={{ fontSize: isMobile ? "15px" : "17px", fontWeight: 800, color: color || C.text1 }}>{val}</div>
      {sub && <div style={{ fontSize: "13px", color: C.text3, marginTop: "2px" }}>{sub}</div>}
    </div>
  );
  const badge = (text, bg, color) => (
    <span style={{ fontSize: "13px", padding: "2px 7px", borderRadius: "5px", background: bg, color, fontWeight: 700 }}>{text}</span>
  );

  // ── 탭 퍼시스턴스 ──
  useEffect(() => { save("di_btc_tab", subTab); }, [subTab]);

  // ── Equity 계산 ──
  const fullEquity = parseFloat(virtualPortfolio?.equity || 0);
  const fullCash = parseFloat(virtualPortfolio?.cash || 0);
  const hasPortfolioData = fullEquity > 0 || fullCash > 0;
  // 봇 배분 비율: 전체 포트폴리오 대비 이 봇에 할당된 비율
  const allocRatio = (botAllocation && fullEquity > 0) ? (botAllocation / fullEquity) : 1;
  const equity = botAllocation ? botAllocation : fullEquity;
  const cash = botAllocation
    ? (hasPortfolioData ? Math.round(fullCash * allocRatio) : botAllocation)
    : fullCash;
  const fullDayPL = parseFloat(virtualPortfolio?.dayPL || 0);
  const dayPL = botAllocation ? Math.round(fullDayPL * allocRatio * 100) / 100 : fullDayPL;
  const fullDayPLPct = parseFloat(virtualPortfolio?.dayPLPct || 0);
  const dayPLPct = botAllocation ? Math.round(fullDayPLPct * allocRatio * 100) / 100 : fullDayPLPct;
  const fmtUSD2 = (v) => `$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

  // ── 봇 성과 파생 ──
  const snap = botPerf?.snapshot || {};
  const perf = botPerf?.perf || {};
  const unrealizedPL = snap.unrealizedPL || 0;
  // DD/MDD: 배분금액 기준 에쿼티 대비 (100%는 비정상 데이터 → 0으로 처리)
  const rawDD = snap.dd || 0;
  const rawMDD = snap.mdd || 0;
  const dd = rawDD >= 99.9 ? 0 : rawDD;
  const mdd = rawMDD >= 99.9 ? 0 : rawMDD;
  const tradeCount = perf.tradeCount || 0;
  // 실현 손익: 매도한 종목에서만 발생 (매도 수익 - 매도 대상의 매수 비용)
  const closedPL = perf.realizedPL || 0; // btc-cron에서 매도 시 계산된 실현 손익
  // 총 손익 = 실현 손익 + 미실현 손익
  const totalPL = closedPL + unrealizedPL;
  const initCapital = botAllocation || 100000;
  const totalPLPct = initCapital > 0 ? (totalPL / initCapital) * 100 : 0;

  return (
    <div className="tab-content" style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "240px 1fr", gap: "0", minHeight: "100vh" }}>
      {/* ═══════════════════════════════════════════════════════════
          LEFT SIDEBAR — hidden on mobile
      ═══════════════════════════════════════════════════════════ */}
      {!isMobile && <div style={{
        background: C.card, borderRight: `1px solid ${C.border}`, padding: "20px 0",
        display: "flex", flexDirection: "column", gap: "0", position: "sticky", top: "0", maxHeight: "100vh", overflowY: "auto",
      }}>
        {[
          { id: "dashboard", label: "대시보드", count: null },
          { id: "overview", label: "포지션", count: cryptoPositions.length },
          { id: "signals", label: "시그널", count: recentSignals.length },
          { id: "market", label: "시장진단", count: null },
        ].map(({ id, label, count }) => (
          <button
            key={id}
            onClick={() => setSubTab(id)}
            style={{
              padding: "14px 20px", margin: "0", border: "none",
              background: subTab === id ? `${C.blue}14` : "transparent",
              color: subTab === id ? C.blue : C.text2,
              borderLeft: subTab === id ? `3px solid ${C.blue}` : `3px solid transparent`,
              fontSize: isMobile ? "13px" : "15px", fontWeight: subTab === id ? 700 : 600,
              cursor: "pointer", textAlign: "left", transition: "all 0.15s",
              display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px",
            }}
            onMouseEnter={e => { if (subTab !== id) e.currentTarget.style.background = `${C.card2}80`; }}
            onMouseLeave={e => { if (subTab !== id) e.currentTarget.style.background = "transparent"; }}
          >
            <span>{label}</span>
            {count != null && count > 0 && (
              <span style={{
                background: subTab === id ? C.blue : C.border2,
                color: subTab === id ? "#fff" : C.text3,
                fontSize: "13px", fontWeight: 700, borderRadius: "50%",
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
          <button onClick={loadData} style={{
            padding: "10px 14px", borderRadius: "8px", fontSize: isMobile ? "12px" : "14px", fontWeight: 600,
            background: C.card2, border: `1px solid ${C.border2}`, color: C.text2, cursor: "pointer",
          }}>
            새로고침
          </button>
        </div>
      </div>}

      {/* ═══════════════════════════════════════════════════════════
          MAIN CONTENT
      ═══════════════════════════════════════════════════════════ */}
      <div style={{ display: "flex", flexDirection: "column", gap: "20px", padding: "20px", paddingBottom: isMobile ? "76px" : "20px", overflowY: "auto" }}>

        {/* ── 큰 잔액 표시 (토스 스타일) ── */}
        <div style={{
          background: `linear-gradient(135deg, ${C.card} 0%, ${C.isDark ? "#1A0E00" : "#FFF8F0"} 100%)`,
          border: `1px solid ${C.border}`, borderRadius: "16px", padding: "28px 32px",
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
            <div style={{ fontSize: isMobile ? "13px" : "15px", color: C.text3, fontWeight: 500 }}>배분 금액</div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              {badge("알파 v2", C.orangeBg, C.orange)}
              {autoMode && badge("자동매매 ON", C.greenBg, C.green)}
              {!autoMode && badge("자동매매 OFF", C.card2, C.text3)}
              <div onClick={() => setAutoMode(!autoMode)} style={{
                width: "44px", height: "24px", borderRadius: "12px", cursor: "pointer",
                background: autoMode ? C.green : C.card2, border: `1px solid ${autoMode ? C.green : C.border}`,
                position: "relative", transition: "all .3s",
              }}>
                <div style={{
                  width: "18px", height: "18px", borderRadius: "50%", background: "#fff",
                  position: "absolute", top: "2px", left: autoMode ? "23px" : "2px",
                  transition: "left .3s", boxShadow: "0 1px 3px rgba(0,0,0,.2)",
                }} />
              </div>
            </div>
          </div>
          <div style={{
            fontWeight: 800, fontSize: "42px", color: C.text1, lineHeight: 1, marginBottom: "12px",
            letterSpacing: "-1px",
          }}>
            {fmtUSD2(initCapital)}
          </div>
          <div style={{
            display: "flex", alignItems: "baseline", gap: "12px", fontSize: isMobile ? "13px" : "15px", fontWeight: 600,
            color: dayPL >= 0 ? C.green : C.red, marginBottom: "16px",
          }}>
            <span>{dayPL >= 0 ? "+" : ""}{dayPL.toFixed(2)} USD</span>
            <span style={{ fontSize: isMobile ? "12px" : "14px" }}>({dayPLPct >= 0 ? "+" : ""}{dayPLPct.toFixed(2)}%)</span>
            <span style={{ fontSize: "13px", color: C.text3 }}>오늘</span>
          </div>

          {/* 자산 구성 */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "16px" }}>
            <div style={{ padding: "10px 14px", borderRadius: "10px", background: C.card2, border: `1px solid ${C.border}` }}>
              <div style={{ fontSize: "13px", color: C.text3, marginBottom: "2px" }}>현금</div>
              <div style={{ fontSize: isMobile ? "15px" : "17px", fontWeight: 700, color: C.text1 }}>{fmtUSD2(cash)}</div>
            </div>
            <div style={{ padding: "10px 14px", borderRadius: "10px", background: C.card2, border: `1px solid ${C.border}` }}>
              <div style={{ fontSize: "13px", color: C.text3, marginBottom: "2px" }}>포지션</div>
              <div style={{ fontSize: isMobile ? "15px" : "17px", fontWeight: 700, color: C.text1 }}>{cryptoPositions.length}개</div>
            </div>
          </div>

          {/* 봇 성과 요약 (3x2 grid) */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "6px" }}>
            {[
              { label: "총 거래", value: `${tradeCount}회`, color: C.text1 },
              { label: "누적 수익", value: `${totalPL >= 0 ? "+" : ""}$${Math.abs(totalPL).toFixed(0)}`, color: totalPL >= 0 ? C.green : C.red },
              { label: "미실현 P&L", value: `${unrealizedPL >= 0 ? "+" : ""}$${Math.abs(unrealizedPL).toFixed(0)}`, color: unrealizedPL >= 0 ? C.green : C.red },
              { label: "Drawdown", value: `-${dd.toFixed(2)}%`, color: dd > 5 ? C.red : dd > 2 ? C.yellow : C.green },
              { label: "MDD", value: `-${mdd.toFixed(2)}%`, color: mdd > 10 ? C.red : mdd > 5 ? C.yellow : C.green },
              { label: "변동성", value: volatilityRegime === "calm" ? "🟢 Calm" : volatilityRegime === "wild" ? "🔴 Wild" : "🟡 Normal", color: volatilityRegime === "calm" ? C.green : volatilityRegime === "wild" ? C.red : C.yellow },
            ].map((m, i) => (
              <div key={i} style={{ background: C.bg, borderRadius: "8px", padding: "8px 10px", textAlign: "center" }}>
                <div style={{ fontSize: "12px", color: C.text3, marginBottom: "2px", fontWeight: 600 }}>{m.label}</div>
                <div style={{ fontSize: isMobile ? "12px" : "14px", fontWeight: 800, color: m.color }}>{m.value}</div>
              </div>
            ))}
          </div>
        </div>

        {/* ── 모바일 탭 네비게이션 ── */}
        {isMobile && (
          <div style={{ display: "flex", gap: "6px", overflowX: "auto", paddingBottom: "4px" }}>
            {[
              { id: "dashboard", label: "대시보드" },
              { id: "overview", label: "포지션" },
              { id: "signals", label: "시그널" },
              { id: "market", label: "시장진단" },
            ].map(t => (
              <button key={t.id} onClick={() => setSubTab(t.id)} style={{
                padding: "8px 14px", borderRadius: "10px", fontSize: isMobile ? "12px" : "14px", fontWeight: 700,
                background: subTab === t.id ? C.blueBg : C.card2,
                color: subTab === t.id ? C.blue : C.text3,
                border: `1px solid ${subTab === t.id ? C.blue + "40" : C.border}`,
                cursor: "pointer", whiteSpace: "nowrap",
              }}>{t.label}</button>
            ))}
          </div>
        )}

        {/* ═══ 대시보드 (바이낸스 카피트레이딩 스타일) ═══ */}
        {subTab === "dashboard" && (() => {
          const bp = botPerf || {};
          const snap = bp.snapshot || {};
          const perf2 = bp.perf || {};
          const kvTrades = perf2.tradeCount || 0;
          const kvWinCount = perf2.winCount || 0;
          const kvUnrealized = snap.unrealizedPL || 0;
          const kvRealized = perf2.realizedPL || 0;
          const kvTotalPL = kvUnrealized + kvRealized;
          const kvROI = initCapital > 0 ? (kvTotalPL / initCapital) * 100 : 0;
          const kvWinRate = kvTrades > 0 ? (kvWinCount / kvTrades) * 100 : 0;
          const rawDD2 = snap.dd || 0;
          const rawMDD2 = snap.mdd || 0;
          const kvDD2 = rawDD2 >= 99.9 ? 0 : rawDD2;
          const kvMDD2 = rawMDD2 >= 99.9 ? 0 : rawMDD2;
          const botAssets = getBotAssets(botPreset?.id);
          // 실제 포지션 데이터 기반 자산 배분 (positionDetails가 있으면 사용, 없으면 균등)
          const posDetails = snap.positionDetails || [];
          // 자산명 매핑: "BTC-USD" → "Bitcoin" 등
          const assetNameMap = {};
          botAssets.forEach(a => {
            const sym = (a.sym || "").replace("USDT", "").replace("-USD", "");
            assetNameMap[sym] = a.name;
            assetNameMap[sym.toUpperCase()] = a.name;
            assetNameMap[a.sym || ""] = a.name;
          });
          const getAssetLabel = (raw) => {
            const clean = (raw || "").replace("-USD", "").replace("USDT", "").replace("/USD", "");
            return assetNameMap[clean] || assetNameMap[clean.toUpperCase()] || clean || "Unknown";
          };
          const assetData = posDetails.length > 0
            ? posDetails.map(p => ({ name: getAssetLabel(p.asset), value: Math.abs(p.marketValue || 0) })).filter(a => a.value > 0)
            : botAssets.map(a => ({ name: a.name, value: 1 }));
          // 포지션 없으면 "현금" 표시
          const finalAssetData = assetData.length > 0 ? assetData : [{ name: "현금 (대기)", value: 1 }];
          const chartColors = [C.blue, "#FCD535", "#85C4FF", C.purple, C.orange, C.green, C.red, "#FF69B4", "#00CED1", "#FF6347"];
          const eqCurve = bp?.equityCurve || [];
          const pnlCurveData = bp?.pnlCurve || [];
          const activeCurve = detailChartTab === "pnl" ? pnlCurveData : eqCurve;
          // Sharpe Ratio 실제 계산 (일간 수익률 기반, 연환산)
          const calcSharpe = (() => {
            if (eqCurve.length < 3) return null;
            const returns = [];
            for (let i = 1; i < eqCurve.length; i++) {
              returns.push((eqCurve[i] - eqCurve[i - 1]) / eqCurve[i - 1]);
            }
            const avgR = returns.reduce((s, r) => s + r, 0) / returns.length;
            const stdR = Math.sqrt(returns.reduce((s, r) => s + (r - avgR) ** 2, 0) / returns.length);
            if (stdR === 0) return avgR > 0 ? 99 : 0;
            return (avgR / stdR) * Math.sqrt(252); // 연환산
          })();
          const curvePositive = activeCurve.length >= 2 ? activeCurve[activeCurve.length - 1] >= activeCurve[0] : true;
          const elapsed = Date.now() - (botPreset?._startedAt || Date.now());
          const runDays = Math.floor(elapsed / 86400000);
          const runHours = Math.floor((elapsed % 86400000) / 3600000);

          return (
            <>
              {/* 바이낸스 스타일 2열 그리드 */}
              <div style={{
                display: "grid",
                gridTemplateColumns: isMobile ? "1fr" : "1fr 2fr",
                gap: isMobile ? "12px" : "16px",
              }}>
                {/* ── Performance 카드 (좌측) ── */}
                <div style={{ ...card, padding: isMobile ? "16px" : "24px" }}>
                  <div style={{ fontWeight: 700, fontSize: isMobile ? "15px" : "17px", color: C.text1, marginBottom: "16px" }}>Performance</div>

                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                    <span style={{ fontSize: isMobile ? "13px" : "15px", color: C.text3 }}>ROI</span>
                    <span style={{ fontSize: isMobile ? "13px" : "15px", color: C.text3 }}>PnL</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "20px" }}>
                    <span style={{ fontSize: "22px", fontWeight: 700, color: kvROI >= 0 ? C.green : C.red }}>
                      {kvROI >= 0 ? "+" : ""}{kvROI.toFixed(2)}%
                    </span>
                    <span style={{ fontSize: "22px", fontWeight: 700, color: kvTotalPL >= 0 ? C.green : C.red }}>
                      {kvTotalPL >= 0 ? "+" : ""}{kvTotalPL.toFixed(2)}
                    </span>
                  </div>

                  {[
                    { label: "Sharpe Ratio", value: calcSharpe !== null ? calcSharpe.toFixed(2) : "--", color: calcSharpe > 1 ? C.green : calcSharpe > 0 ? C.text1 : C.red },
                    { label: "MDD", value: kvMDD2 > 0 ? `${kvMDD2.toFixed(2)}%` : "--", color: kvMDD2 > 10 ? C.red : kvMDD2 > 5 ? C.yellow : C.text1 },
                    { label: "Win Rate", value: kvTrades > 0 ? `${kvWinRate.toFixed(1)}%` : "--", color: kvWinRate >= 50 ? C.green : C.red },
                    { label: "미실현 손익", value: `${kvUnrealized >= 0 ? "+" : ""}$${kvUnrealized.toFixed(2)}`, color: kvUnrealized >= 0 ? C.green : C.red },
                    { label: "실현 손익", value: `${kvRealized >= 0 ? "+" : ""}$${kvRealized.toFixed(2)}`, color: kvRealized >= 0 ? C.green : C.red },
                    { label: "승리 포지션", value: `${kvWinCount}` },
                    { label: "총 포지션", value: `${kvTrades}` },
                  ].map((row, i) => (
                    <div key={i} style={{
                      display: "flex", justifyContent: "space-between", alignItems: "center",
                      padding: "9px 0", borderTop: i === 0 ? `1px solid ${C.border}` : "none",
                      borderBottom: `1px solid ${C.border}20`,
                    }}>
                      <span style={{ fontSize: isMobile ? "13px" : "15px", color: C.text3 }}>{row.label}</span>
                      <span style={{ fontSize: isMobile ? "14px" : "16px", fontWeight: 600, color: row.color || C.text1 }}>{row.value}</span>
                    </div>
                  ))}
                </div>

                {/* ── 우측: ROI 차트 + 하단 그리드 ── */}
                <div style={{ display: "flex", flexDirection: "column", gap: isMobile ? "12px" : "16px" }}>
                  {/* ROI 차트 카드 */}
                  <div style={{ ...card, padding: isMobile ? "16px" : "24px", flex: 1 }}>
                    <div style={{ display: "flex", gap: "16px", marginBottom: "16px" }}>
                      <span onClick={() => setDetailChartTab("roi")} style={{
                        fontWeight: 700, fontSize: isMobile ? "15px" : "17px", cursor: "pointer",
                        color: detailChartTab === "roi" ? C.text1 : C.text3,
                        borderBottom: detailChartTab === "roi" ? `2px solid ${C.blue}` : "2px solid transparent",
                        paddingBottom: "4px",
                      }}>ROI</span>
                      <span onClick={() => setDetailChartTab("pnl")} style={{
                        fontWeight: 700, fontSize: isMobile ? "15px" : "17px", cursor: "pointer",
                        color: detailChartTab === "pnl" ? C.text1 : C.text3,
                        borderBottom: detailChartTab === "pnl" ? `2px solid ${C.blue}` : "2px solid transparent",
                        paddingBottom: "4px",
                      }}>PnL</span>
                    </div>
                    {activeCurve.length >= 2 ? (() => {
                      const yAxisW = 52; // Y축 라벨 너비
                      const cw = isMobile ? 300 : 560, ch = isMobile ? 160 : 220;
                      const totalW = cw + yAxisW;
                      const min = Math.min(...activeCurve) * 0.998;
                      const max = Math.max(...activeCurve) * 1.002;
                      const rng = max - min || 1;
                      const xStep = cw / (activeCurve.length - 1);
                      const toY = (v) => ch - ((v - min) / rng) * (ch - 12) - 6;
                      const pts = activeCurve.map((v, i) => `${(yAxisW + i * xStep).toFixed(1)},${toY(v).toFixed(1)}`);
                      const linePath = `M${pts.join(" L")}`;
                      const areaPath = `${linePath} L${yAxisW + cw},${ch} L${yAxisW},${ch} Z`;
                      const clr = curvePositive ? C.green : C.red;
                      const baseVal = detailChartTab === "pnl" ? 0 : 100;
                      const baseY = toY(baseVal);
                      const isPnl = detailChartTab === "pnl";
                      // Y축 라벨 값 (5단계)
                      const ySteps = [0, 0.25, 0.5, 0.75, 1].map(f => {
                        const val = min + rng * (1 - f);
                        return { y: 6 + f * (ch - 12), label: isPnl ? `$${val.toFixed(0)}` : `${val.toFixed(1)}%` };
                      });
                      return (
                        <div style={{ position: "relative" }}
                          onMouseMove={(e) => {
                            const rect = e.currentTarget.getBoundingClientRect();
                            const mx = ((e.clientX - rect.left) / rect.width) * totalW - yAxisW;
                            const idx = Math.round(mx / xStep);
                            if (idx >= 0 && idx < activeCurve.length) {
                              setChartHover({ idx, x: e.clientX - rect.left, y: e.clientY - rect.top });
                            }
                          }}
                          onMouseLeave={() => setChartHover(null)}
                        >
                          <svg width="100%" viewBox={`0 0 ${totalW} ${ch}`} preserveAspectRatio="none" style={{ borderRadius: "8px", overflow: "visible", display: "block" }}>
                            <defs>
                              <linearGradient id="roi-detail-grad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor={clr} stopOpacity="0.15" />
                                <stop offset="100%" stopColor={clr} stopOpacity="0.01" />
                              </linearGradient>
                            </defs>
                            {/* Y축 라벨 */}
                            {ySteps.map((ys, i) => (
                              <g key={i}>
                                <text x={yAxisW - 6} y={ys.y + 3} textAnchor="end" fill={C.text3} fontSize="10" fontFamily="inherit">{ys.label}</text>
                                <line x1={yAxisW} y1={ys.y} x2={totalW} y2={ys.y} stroke={C.text3} strokeWidth="0.5" strokeDasharray="3,3" opacity="0.15" />
                              </g>
                            ))}
                            {/* 기준선 */}
                            {baseY > 0 && baseY < ch && (
                              <line x1={yAxisW} y1={baseY} x2={totalW} y2={baseY} stroke={C.text3} strokeWidth="0.8" strokeDasharray="4,4" opacity="0.35" />
                            )}
                            {/* 면적 + 라인 */}
                            <path d={areaPath} fill="url(#roi-detail-grad)" />
                            <path d={linePath} fill="none" stroke={clr} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                            {/* 끝점 */}
                            <circle cx={(yAxisW + (activeCurve.length - 1) * xStep).toFixed(1)} cy={toY(activeCurve[activeCurve.length - 1]).toFixed(1)} r="5" fill={C.card} stroke={clr} strokeWidth="2.5" />
                            {/* 호버 수직선 + 포인트 */}
                            {chartHover && chartHover.idx < activeCurve.length && (() => {
                              const hx = yAxisW + chartHover.idx * xStep;
                              const hy = toY(activeCurve[chartHover.idx]);
                              return (
                                <g>
                                  <line x1={hx} y1={0} x2={hx} y2={ch} stroke={C.text2} strokeWidth="1" strokeDasharray="3,2" opacity="0.5" />
                                  <circle cx={hx} cy={hy} r="4" fill={clr} stroke={C.card} strokeWidth="2" />
                                </g>
                              );
                            })()}
                          </svg>
                          {/* 호버 툴팁 */}
                          {chartHover && chartHover.idx < activeCurve.length && (
                            <div style={{
                              position: "absolute", left: Math.min(chartHover.x + 12, 400), top: chartHover.y - 40,
                              background: C.card2, border: `1px solid ${C.border}`, borderRadius: "8px",
                              padding: "6px 12px", pointerEvents: "none", zIndex: 10, whiteSpace: "nowrap",
                              boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
                            }}>
                              <div style={{ fontSize: "13px", fontWeight: 700, color: clr }}>
                                {isPnl ? `$${activeCurve[chartHover.idx].toFixed(2)}` : `${activeCurve[chartHover.idx].toFixed(2)}%`}
                              </div>
                              <div style={{ fontSize: "11px", color: C.text3 }}>#{chartHover.idx + 1}</div>
                            </div>
                          )}
                        </div>
                      );
                    })() : (
                      <div style={{
                        height: isMobile ? "160px" : "220px", display: "flex", flexDirection: "column",
                        alignItems: "center", justifyContent: "center", borderRadius: "8px",
                        background: `${C.text3}06`, border: `1px dashed ${C.text3}20`,
                      }}>
                        <svg width="48" height="48" viewBox="0 0 48 48" fill="none" style={{ opacity: 0.3, marginBottom: "8px" }}>
                          <path d="M6 36 L14 28 L22 32 L30 18 L38 22 L42 12" stroke={C.text3} strokeWidth="2" strokeLinecap="round" fill="none" />
                        </svg>
                        <span style={{ fontSize: isMobile ? "13px" : "15px", color: C.text3 }}>거래 데이터 수집 중입니다...</span>
                      </div>
                    )}
                  </div>

                  {/* 하단: 봇 개요 + 자산 배분 */}
                  <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: isMobile ? "12px" : "16px" }}>
                    {/* 봇 개요 */}
                    <div style={{ ...card, padding: isMobile ? "16px" : "24px" }}>
                      <div style={{ fontWeight: 700, fontSize: isMobile ? "15px" : "17px", color: C.text1, marginBottom: "16px" }}>봇 개요</div>
                      {[
                        { label: "투입 금액 (AUM)", value: `$${(botAllocation || 0).toLocaleString()}` },
                        { label: "예상 수익률", value: botPreset?.expectedReturn || "--" },
                        { label: "운영 기간", value: `${runDays}일 ${runHours}시간` },
                        { label: "거래 자산 수", value: `${botAssets.length}개` },
                        { label: "Drawdown", value: kvDD2 > 0 ? `${kvDD2.toFixed(2)}%` : "--" },
                      ].map((row, i) => (
                        <div key={i} style={{
                          display: "flex", justifyContent: "space-between", alignItems: "center",
                          padding: "9px 0", borderBottom: `1px solid ${C.border}20`,
                        }}>
                          <span style={{ fontSize: isMobile ? "13px" : "15px", color: C.text3 }}>{row.label}</span>
                          <span style={{ fontSize: isMobile ? "14px" : "16px", fontWeight: 600, color: C.text1 }}>{row.value}</span>
                        </div>
                      ))}
                    </div>

                    {/* 자산 배분 (도넛) */}
                    <div style={{ ...card, padding: isMobile ? "16px" : "24px" }}>
                      <div style={{ fontWeight: 700, fontSize: isMobile ? "15px" : "17px", color: C.text1, marginBottom: "16px" }}>자산 배분</div>
                      <div style={{ display: "flex", gap: "20px", alignItems: "center", justifyContent: "center", flexWrap: "wrap" }}>
                        {/* SVG 도넛 */}
                        {(() => {
                          const sz = isMobile ? 120 : 140;
                          const cx2 = sz / 2, cy2 = sz / 2, r2 = sz * 0.38, sw = sz * 0.15;
                          const total = finalAssetData.reduce((s, d) => s + d.value, 0);
                          let cum = -Math.PI / 2;
                          return (
                            <svg width={sz} height={sz} viewBox={`0 0 ${sz} ${sz}`}>
                              <circle cx={cx2} cy={cy2} r={r2} fill="none" stroke={`${C.text3}15`} strokeWidth={sw} />
                              {finalAssetData.map((d, i) => {
                                const pct = d.value / total;
                                const angle = pct * 2 * Math.PI;
                                const start = cum;
                                cum += angle;
                                const end = cum - 0.001;
                                const la = angle > Math.PI ? 1 : 0;
                                const x1 = cx2 + r2 * Math.cos(start);
                                const y1 = cy2 + r2 * Math.sin(start);
                                const x2 = cx2 + r2 * Math.cos(end);
                                const y2 = cy2 + r2 * Math.sin(end);
                                return <path key={i} d={`M ${x1} ${y1} A ${r2} ${r2} 0 ${la} 1 ${x2} ${y2}`}
                                  fill="none" stroke={chartColors[i % chartColors.length]} strokeWidth={sw} />;
                              })}
                            </svg>
                          );
                        })()}
                        <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
                          {finalAssetData.slice(0, 8).map((a, i) => {
                            const pct = (a.value / finalAssetData.reduce((s, d) => s + d.value, 0) * 100).toFixed(1);
                            return (
                              <div key={i} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                <div style={{ width: "14px", height: "4px", borderRadius: "2px", background: chartColors[i % chartColors.length] }} />
                                <span style={{ fontSize: isMobile ? "12px" : "14px", fontWeight: 600, color: C.text1 }}>{a.name} {pct}%</span>
                              </div>
                            );
                          })}
                          {finalAssetData.length > 8 && <span style={{ fontSize: "13px", color: C.text3 }}>외 {finalAssetData.length - 8}개</span>}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </>
          );
        })()}

        {/* ═══ 포지션 (overview) ═══ */}
        {subTab === "overview" && (
          <>
            {/* 실시간 크립토 가격 */}
            <div style={card}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span style={{ fontSize: isMobile ? "13px" : "15px", fontWeight: 700, color: C.text1 }}>모니터링 종목</span>
                  {botPreset && (
                    <span style={{ fontSize: "13px", padding: "2px 8px", borderRadius: "8px",
                      background: `${C.blue}20`, color: C.blue, fontWeight: 600 }}>{botPreset.name}</span>
                  )}
                </div>
                {lastUpdate && <span style={{ fontSize: "13px", color: C.text3 }}>{lastUpdate.toLocaleTimeString("ko-KR")}</span>}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {getBotAssets(botPreset?.id).map(a => {
                  const p = prices[a.sym];
                  const isUp = p && p.change24h >= 0;
                  return (
                    <div key={a.sym} style={{
                      display: "flex", alignItems: "center", padding: "10px 14px", borderRadius: "10px",
                      background: C.card2, gap: "10px",
                      border: `1px solid transparent`,
                    }}>
                      <span style={{ fontSize: isMobile ? "16px" : "18px", width: "24px", textAlign: "center" }}>{a.icon}</span>
                      <div style={{ flex: 1 }}>
                        <span style={{ fontSize: isMobile ? "12px" : "14px", fontWeight: 700, color: C.text1 }}>{a.name}</span>
                        {p?.volume24h && <div style={{ fontSize: "13px", color: C.text3 }}>Vol ${(p.volume24h / 1e9).toFixed(1)}B</div>}
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: isMobile ? "13px" : "15px", fontWeight: 800, color: C.text1 }}>{p ? `$${p.price?.toLocaleString()}` : "..."}</div>
                        {p && <div style={{ fontSize: "13px", fontWeight: 700, color: isUp ? C.green : C.red }}>{isUp ? "+" : ""}{p.change24h?.toFixed(2)}%</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 보유 크립토 포지션 */}
            <div style={card}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
                <span style={{ fontSize: isMobile ? "13px" : "15px", fontWeight: 700, color: C.text1 }}>보유 포지션</span>
                {badge("KV 자동매매", C.purpleBg, C.purple)}
              </div>
              {cryptoPositions && cryptoPositions.length > 0 ? (
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  {cryptoPositions.map((p, i) => {
                    const pnl = parseFloat(p.unrealizedPL || 0);
                    const pnlPct = parseFloat(p.unrealizedPLPct || 0);
                    const avgPrice = parseFloat(p.avgPrice || p.avg_entry_price || 0);
                    const curPrice = parseFloat(p.currentPrice || p.current_price || 0);
                    const qty = parseFloat(p.qty || 0);
                    const assetIcon = Object.values(ALL_CRYPTO).find(a => p.symbol && a.sym.includes(p.symbol.split("USDT")[0]))?.icon
                      || Object.values(ALL_CRYPTO).find(a => p.symbol && p.symbol.includes(a.sym?.replace("USDT", "")))?.icon || "₿";
                    const assetName = Object.values(ALL_CRYPTO).find(a => p.symbol && (a.sym.includes(p.symbol.split("USDT")[0]) || p.symbol.includes(a.sym?.replace("USDT", ""))))?.name || p.symbol;
                    return (
                      <div key={i} style={{
                        padding: "12px 14px", borderRadius: "10px", background: C.card2,
                        border: `1px solid ${C.border}`, borderLeft: `3px solid ${pnl >= 0 ? C.green : C.red}`,
                      }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                          <span style={{ fontSize: isMobile ? "16px" : "18px" }}>{assetIcon}</span>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: isMobile ? "13px" : "15px", fontWeight: 700, color: C.text1 }}>{p.symbol || "Unknown"}</div>
                            <div style={{ fontSize: "13px", color: C.text3 }}>
                              수량: {qty < 1 ? qty.toFixed(6) : qty.toFixed(2)} · 매수가: ${avgPrice < 1 ? avgPrice.toFixed(6) : avgPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                            </div>
                          </div>
                          <div style={{ textAlign: "right" }}>
                            <div style={{ fontSize: isMobile ? "13px" : "15px", fontWeight: 700, color: C.text1 }}>${parseFloat(p.marketValue || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
                            <div style={{ fontSize: isMobile ? "12px" : "14px", fontWeight: 700, color: pnl >= 0 ? C.green : C.red }}>
                              {pnl >= 0 ? "+" : ""}{pnl.toFixed(2)} ({pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(2)}%)
                            </div>
                          </div>
                        </div>
                        {curPrice > 0 && avgPrice > 0 && (
                          <div style={{ display: "flex", gap: "12px", marginTop: "6px", paddingLeft: "28px" }}>
                            <span style={{ fontSize: "12px", color: C.text3 }}>현재가: ${curPrice < 1 ? curPrice.toFixed(6) : curPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div style={{ textAlign: "center", padding: "32px", color: C.text3 }}>
                  <div style={{ fontSize: "24px", marginBottom: "8px" }}>₿</div>
                  <div style={{ fontSize: isMobile ? "12px" : "14px", fontWeight: 600 }}>보유 크립토 없음</div>
                </div>
              )}
            </div>

            {/* 최근 거래 내역 (봇 성과) */}
            {perf.trades && perf.trades.length > 0 && (
              <div style={card}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
                  <span style={{ fontSize: isMobile ? "13px" : "15px", fontWeight: 700, color: C.text1 }}>최근 거래</span>
                  {snap.lastUpdated && (
                    <span style={{ fontSize: "12px", color: C.text3 }}>
                      {new Date(snap.lastUpdated).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })} 갱신
                    </span>
                  )}
                </div>
                {perf.trades.slice(0, 8).map((t, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
                    padding: "8px 10px", borderRadius: "8px", background: i % 2 === 0 ? C.card2 : "transparent", fontSize: isMobile ? "12px" : "14px" }}>
                    <span style={{ color: t.type === "BUY" ? C.green : C.red, fontWeight: 700, minWidth: "36px" }}>{t.type}</span>
                    <span style={{ color: C.text2, flex: 1, marginLeft: "8px" }}>{t.asset}</span>
                    <span style={{ color: C.text1, fontWeight: 600 }}>${(t.amount || 0).toFixed(0)}</span>
                    <span style={{ color: C.text3, marginLeft: "8px", fontSize: "12px" }}>
                      {t.time ? new Date(t.time).toLocaleDateString("ko-KR", { month: "short", day: "numeric" }) : ""}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* ═══ 시그널 ═══ */}
        {subTab === "signals" && (() => {
          // 봇 상세 모드: KV 실제 거래 데이터 우선, 없으면 프론트엔드 시그널
          const kvTrades2 = botPerf?.perf?.trades || [];
          const showKvTrades = botPreset && kvTrades2.length > 0;
          const displayTrades = showKvTrades
            ? kvTrades2.slice(-30).reverse().map(t => ({
                type: t.side || t.action || "BUY",
                asset: t.asset || t.symbol || "",
                price: t.price || 0,
                qty: t.qty || 0,
                amount: t.amount || (t.price * (t.qty || 0)),
                date: t.time ? new Date(t.time) : null,
                reason: t.reason || (t.side === "SELL" ? "매도 시그널" : "매수 시그널"),
                pnl: t.pnl || null,
              }))
            : recentSignals;
          return (
            <div style={card}>
              <div style={{ fontSize: isMobile ? "13px" : "15px", fontWeight: 700, color: C.text1, marginBottom: "4px" }}>
                {showKvTrades ? "실제 거래 내역" : "매매 시그널 히스토리"}
              </div>
              <div style={{ fontSize: isMobile ? "12px" : "14px", color: C.text3, marginBottom: "12px" }}>
                {showKvTrades
                  ? `${botPreset?.name || "봇"} · 최근 ${Math.min(kvTrades2.length, 30)}건`
                  : "BTC 알파 v2 · 멀티 타임프레임 · 최근 30건"
                }
              </div>
              {displayTrades.length === 0 ? (
                <div style={{ textAlign: "center", padding: "40px", color: C.text3 }}>
                  {showKvTrades ? "거래 내역 없음" : "시그널 없음"}
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
                  {displayTrades.map((s, i) => {
                    const isBuy = (s.type || "").toUpperCase().includes("BUY");
                    return (
                      <div key={i} style={{
                        display: "flex", alignItems: "center", gap: "8px", padding: "10px 12px",
                        borderRadius: "10px", background: C.card2, borderLeft: `3px solid ${isBuy ? C.green : C.red}`,
                      }}>
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "2px" }}>
                          {badge(isBuy ? "매수" : "매도", isBuy ? C.greenBg : C.redBg, isBuy ? C.green : C.red)}
                          {showKvTrades && s.amount > 0 && badge(`$${s.amount.toFixed(0)}`, C.blueBg, C.blue)}
                          {!showKvTrades && s.confidence && badge(s.confidence, C.blueBg, C.blue)}
                          {!showKvTrades && s.tf && badge(s.tf, C.purpleBg, C.purple)}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: isMobile ? "12px" : "14px", color: C.text2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {s.asset && <span style={{ fontWeight: 700 }}>[{(s.asset || "").replace("-USD","").replace("USDT","")}] </span>}
                            {s.reason}
                          </div>
                          {showKvTrades && s.pnl != null && (
                            <div style={{ fontSize: "13px", fontWeight: 600, color: s.pnl >= 0 ? C.green : C.red, marginTop: "2px" }}>
                              PnL: {s.pnl >= 0 ? "+" : ""}${s.pnl.toFixed(2)}
                            </div>
                          )}
                        </div>
                        <div style={{ textAlign: "right", flexShrink: 0 }}>
                          <div style={{ fontSize: isMobile ? "12px" : "14px", fontWeight: 700, color: C.text1 }}>
                            ${s.price?.toLocaleString(undefined, { maximumFractionDigits: s.price > 100 ? 0 : 2 })}
                          </div>
                          {s.date && <div style={{ fontSize: "12px", color: C.text3 }}>{s.date.toLocaleDateString("ko-KR", { month: "short", day: "numeric" })} {s.date.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}</div>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })()}

        {/* ═══ 시장진단 ═══ */}
        {subTab === "market" && (
          <>
            {/* 변동성 & 리스크 */}
            <div style={card}>
              <div style={{ fontSize: isMobile ? "13px" : "15px", fontWeight: 700, color: C.text1, marginBottom: "12px" }}>리스크 & 변동성</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                {(() => {
                  const regimeEmoji = volatilityRegime === "calm" ? "🟢" : volatilityRegime === "wild" ? "🔴" : "🟡";
                  const regimeLabel = volatilityRegime === "calm" ? "Calm" : volatilityRegime === "wild" ? "Wild" : "Normal";
                  return stat("변동성 레짐", `${regimeEmoji} ${regimeLabel}`, volatilityRegime === "calm" ? C.green : volatilityRegime === "wild" ? C.red : C.yellow);
                })()}
                {stat("포트폴리오 Heat", `${portfolioMetrics.heat?.toFixed(0) || 0}%`, portfolioMetrics.heat > 70 ? C.red : portfolioMetrics.heat > 40 ? C.yellow : C.green)}
                {stat("VaR (95%)", `${portfolioMetrics.var?.toFixed(2) || 0}%`, C.orange)}
                {stat("Max Drawdown", `${(portfolioMetrics.drawdown * 100)?.toFixed(2) || 0}%`, portfolioMetrics.drawdown > 0.1 ? C.red : C.yellow)}
              </div>
            </div>

            {/* 시장 진단 */}
            {marketDiag && (
              <div style={card}>
                <div style={{ fontSize: isMobile ? "13px" : "15px", fontWeight: 700, color: C.text1, marginBottom: "10px" }}>₿ 시장 진단</div>
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

            {/* 목표 할당 */}
            <div style={card}>
              <div style={{ fontSize: isMobile ? "13px" : "15px", fontWeight: 700, color: C.text1, marginBottom: "10px" }}>매매 대상 자산</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                {getBotAssets(botPreset?.id).map(a => (
                  <span key={a.sym} style={{
                    fontSize: isMobile ? "12px" : "14px", padding: "5px 12px", borderRadius: "8px",
                    background: C.card2, border: `1px solid ${C.border}`,
                    color: C.text1, fontWeight: 600,
                    display: "flex", alignItems: "center", gap: "4px",
                  }}>
                    <span>{a.icon}</span> {a.name}
                  </span>
                ))}
              </div>
            </div>
          </>
        )}

        <div style={{ textAlign: "center", padding: "12px", fontSize: "13px", color: C.text3, lineHeight: 1.5 }}>
          ₿ BTC 알파 v2 · 10팩터 멀티스코어링 · Binance 데이터 · KV 가상매매<br/>
          투자 판단은 본인의 책임입니다 · 시뮬레이션 결과가 미래 수익을 보장하지 않습니다
        </div>
      </div>
    </div>
  );
}
