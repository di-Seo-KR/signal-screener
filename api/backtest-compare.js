// ════════════════════════════════════════════════════════════════════
// Zepta — Backtest Compare API
// ────────────────────────────────────────────────────────────────────
// 같은 자산·기간에 N개의 strategy 를 병렬 백테스트해 결과를 한 응답에 반환.
// UI 의 multi-strategy 비교 차트가 이 응답 하나로 라인을 그릴 수 있도록 설계.
//
// 사용:
//   GET /api/backtest-compare?symbol=BTC&period=60&strategies=trend-follow,breakout,ensemble
//
// 응답:
//   {
//     ok, symbol, periodDays, generatedAt,
//     bars: number,                         // OHLC 봉 수
//     baselineCurve: [{ t, c }],            // buy-and-hold 비교용 (선택)
//     results: [
//       {
//         strategy, label, color,
//         metrics: { trades, winRate, netReturn, sharpe, profitFactor, maxDD, avgHoldHours, ... },
//         equityCurve: [1.0, 1.012, ...],   // 정규화 (시작 1.0)
//       }
//     ],
//     best: { strategy, sharpe, netReturn },
//   }
//
// 캐시: di:backtest-cache:<symbol>:<period>:<strategiesSorted>  TTL 300s
//
// 데이터 소스:
//   - 크립토 심볼 (BTC/ETH/SOL/BNB 등): Binance USDM 4h klines (period 일치 분량)
//   - 주식 심볼 (AAPL/TSLA/...): Yahoo Finance 1d candles
//
// 보안: read-only, public, KV 캐싱으로 abuse 방지.
// ════════════════════════════════════════════════════════════════════

import { backtestStrategy, klinesToOhlc } from "./_shared/strategy-backtester.js";
import { ALL_STRATEGIES } from "./_shared/strategies/index.js";
import { getKlines } from "./_shared/binance-client.js";

// strategy 별 표시 색상 (theme palette 기준)
const STRATEGY_COLOR = {
  "trend-follow":      "#3B82F6", // blue
  "mean-revert":       "#10D884", // green
  "breakout":          "#FF6B2C", // orange
  "momentum-rotation": "#9B6FFF", // purple
  "volatility-arb":    "#FFB020", // yellow
  "hurst-trend":       "#FF4D64", // red
  "defi-momentum":     "#60A5FA", // blueL
  "ensemble":          "#94A0B6", // gray
};

const STRATEGY_LABEL = {
  "trend-follow":      "추세 추종",
  "mean-revert":       "평균 회귀",
  "breakout":          "돌파",
  "momentum-rotation": "모멘텀 로테이션",
  "volatility-arb":    "변동성 차익",
  "hurst-trend":       "Hurst 추세",
  "defi-momentum":     "DeFi 모멘텀",
  "ensemble":          "앙상블 합의",
};

// 크립토 심볼 정규화 — BTC → BTCUSDT
const CRYPTO_BASES = new Set(["BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "DOGE", "AVAX", "MATIC", "DOT", "LINK", "UNI", "ATOM", "LTC", "TRX", "ARB", "OP", "APT", "SUI", "NEAR"]);

function isCrypto(symbol) {
  const s = String(symbol || "").toUpperCase().replace(/[/-].*/, "");
  return CRYPTO_BASES.has(s);
}

function toBinanceSymbol(symbol) {
  const s = String(symbol || "").toUpperCase().replace(/[/-].*/, "");
  return `${s}USDT`;
}

async function getKv() {
  try {
    if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) return null;
    const m = await import("@vercel/kv");
    return m.kv;
  } catch {
    return null;
  }
}

// ── 데이터 fetch ──────────────────────────────────────────────────
// timeout-aware fetch (E-5)
async function fetchWithTimeout(url, opts = {}, timeoutMs = 10_000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

// coingecko symbol id 매핑 (코인 fallback 용)
const COINGECKO_ID = {
  BTC: "bitcoin", ETH: "ethereum", SOL: "solana", BNB: "binancecoin",
  XRP: "ripple", ADA: "cardano", DOGE: "dogecoin", AVAX: "avalanche-2",
  MATIC: "matic-network", DOT: "polkadot", LINK: "chainlink", UNI: "uniswap",
  ATOM: "cosmos", LTC: "litecoin", TRX: "tron", ARB: "arbitrum",
  OP: "optimism", APT: "aptos", SUI: "sui", NEAR: "near",
};

async function fetchCryptoOhlc(symbol, days) {
  const bSym = toBinanceSymbol(symbol);
  // 4h 봉 = 6 candles/day → 30/60/90 일 = 180/360/540 봉
  const interval = "4h";
  const limit = Math.min(1000, days * 6 + 60); // 워밍업 60봉 추가
  const klines = await getKlines({ symbol: bSym, interval, limit });
  return klinesToOhlc(klines);
}

// E-5 — Binance 실패 시 coingecko market_chart fallback (일봉 정밀도)
async function fetchCryptoOhlcCoingecko(symbol, days) {
  const base = String(symbol || "").toUpperCase().replace(/[/-].*/, "");
  const cgId = COINGECKO_ID[base];
  if (!cgId) throw new Error(`coingecko id unmapped: ${base}`);
  const cgDays = Math.min(365, Math.max(30, days + 7));
  const url = `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(cgId)}/market_chart?vs_currency=usd&days=${cgDays}&interval=daily`;
  const res = await fetchWithTimeout(url, {}, 10_000);
  if (!res.ok) throw new Error(`coingecko fetch failed: ${res.status}`);
  const json = await res.json();
  const prices = Array.isArray(json?.prices) ? json.prices : [];
  // [ts, price] 만 노출 — high/low 부재. 단봉 OHLC 로 대체 (open=close=high=low).
  return prices
    .map(([ts, p]) => ({ ts, o: p, h: p, l: p, c: p, v: 0 }))
    .filter(x => Number.isFinite(x.c));
}

async function fetchStockOhlc(symbol, days, baseUrl) {
  // 일봉 — Yahoo Finance
  const range = days <= 30 ? "3mo" : days <= 60 ? "6mo" : days <= 90 ? "1y" : "1y";
  const url = `${baseUrl}/api/yahoo?_mode=ohlc&symbol=${encodeURIComponent(symbol)}&interval=1d&range=${range}`;
  const res = await fetchWithTimeout(url, {}, 10_000);
  if (!res.ok) throw new Error(`yahoo fetch failed: ${res.status}`);
  const json = await res.json();
  const candles = Array.isArray(json?.candles) ? json.candles : [];
  // candles → ohlc 형식 변환
  return candles.map(c => ({
    ts: c.time * 1000,
    o: c.open, h: c.high, l: c.low, c: c.close, v: c.volume,
  })).filter(x => Number.isFinite(x.c));
}

// E-5 — Yahoo 실패 시 stooq.com CSV fallback (미국 주식 일봉)
async function fetchStockOhlcStooq(symbol) {
  // stooq.com 미국 종목: .us suffix 사용 (예: AAPL → aapl.us)
  const stooqSym = `${String(symbol || "").toLowerCase()}.us`;
  const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(stooqSym)}&i=d`;
  const res = await fetchWithTimeout(url, {}, 10_000);
  if (!res.ok) throw new Error(`stooq fetch failed: ${res.status}`);
  const text = await res.text();
  // CSV: Date,Open,High,Low,Close,Volume
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) throw new Error("stooq csv empty");
  return lines.slice(1).map(line => {
    const [date, o, h, l, c, v] = line.split(",");
    return {
      ts: Date.parse(date),
      o: parseFloat(o), h: parseFloat(h), l: parseFloat(l), c: parseFloat(c),
      v: parseFloat(v) || 0,
    };
  }).filter(x => Number.isFinite(x.c) && Number.isFinite(x.ts));
}

// ── 메인 핸들러 ────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const q = req.query || {};
    const symbol = String(q.symbol || "BTC").toUpperCase().slice(0, 16);
    const period = Math.max(7, Math.min(180, parseInt(q.period) || 60));
    const strategiesParam = String(q.strategies || "trend-follow,breakout,ensemble");
    const requested = strategiesParam
      .split(",")
      .map(s => s.trim())
      .filter(s => Object.prototype.hasOwnProperty.call(ALL_STRATEGIES, s))
      .slice(0, 8);

    if (requested.length === 0) {
      return res.status(400).json({ ok: false, error: "유효한 strategy 가 없습니다.", available: Object.keys(ALL_STRATEGIES) });
    }

    // ── 캐시 조회 ──
    const sortedStrats = [...requested].sort().join(",");
    const cacheKey = `di:backtest-cache:${symbol}:${period}:${sortedStrats}`;
    const kv = await getKv();
    if (kv) {
      try {
        const cached = await kv.get(cacheKey);
        if (cached && cached.generatedAt) {
          const ageMs = Date.now() - Date.parse(cached.generatedAt);
          if (Number.isFinite(ageMs) && ageMs < 5 * 60 * 1000) {
            return res.status(200).json({ ...cached, fromCache: true });
          }
        }
      } catch {}
    }

    // ── OHLC fetch ──
    const proto = (req.headers["x-forwarded-proto"] || "https").split(",")[0];
    const host = req.headers["x-forwarded-host"] || req.headers.host || "zepta.app";
    const baseUrl = `${proto}://${host}`;

    // E-5 — 1차 fetch 실패 시 fallback 으로 재시도. 모두 실패 시 errorCode 응답.
    let ohlc;
    let timeframeLabel;
    const fetchErrors = [];
    try {
      if (isCrypto(symbol)) {
        try {
          ohlc = await fetchCryptoOhlc(symbol, period);
          timeframeLabel = "4h";
        } catch (e1) {
          fetchErrors.push(`binance: ${e1?.message || String(e1)}`);
          // 코인 fallback — coingecko (일봉)
          try {
            ohlc = await fetchCryptoOhlcCoingecko(symbol, period);
            timeframeLabel = "1d";
          } catch (e2) {
            fetchErrors.push(`coingecko: ${e2?.message || String(e2)}`);
            throw new Error(fetchErrors.join(" | "));
          }
        }
      } else {
        try {
          ohlc = await fetchStockOhlc(symbol, period, baseUrl);
          timeframeLabel = "1d";
        } catch (e1) {
          fetchErrors.push(`yahoo: ${e1?.message || String(e1)}`);
          // 주식 fallback — stooq CSV
          try {
            ohlc = await fetchStockOhlcStooq(symbol);
            timeframeLabel = "1d";
          } catch (e2) {
            fetchErrors.push(`stooq: ${e2?.message || String(e2)}`);
            throw new Error(fetchErrors.join(" | "));
          }
        }
      }
    } catch (e) {
      return res.status(502).json({
        ok: false,
        errorCode: "OHLC_UNAVAILABLE",
        error: `OHLC fetch 실패: ${e?.message || String(e)}`,
        symbol,
        retryAfterSec: 60,
      });
    }

    if (!Array.isArray(ohlc) || ohlc.length < 70) {
      return res.status(200).json({
        ok: false,
        error: "데이터가 부족합니다 (최소 70봉 필요).",
        bars: ohlc?.length || 0,
      });
    }

    // ── 각 strategy 백테스트 ──
    const results = [];
    for (const stratId of requested) {
      const strategyFn = ALL_STRATEGIES[stratId];
      let trades = [];
      let equityCurve = [1.0];
      let metrics;
      try {
        // backtestStrategy 는 equityCurve 를 반환하지 않으므로 직접 트래킹.
        // 같은 로직을 한번 더 돌리는 대신, 다시 backtester 를 부르되 equityCurve 도
        // 같이 수집하기 위해 변형: backtestStrategy 결과 + 별도 simulate 호출.
        // → backtestStrategy 가 내부적으로 equityCurve 를 만들지만 노출 안 함.
        // 단순한 해결: 같은 로직 복제 안하고 metric 만 받은 뒤, "trades 기반 equity curve" 재구성.
        const r = backtestStrategy({
          strategyFn,
          ohlc,
          slPct: 4, tpPct: 8, maxHoldBars: 24, minBars: 60,
          timeframe: timeframeLabel, // ★ 캔들융합 TF 정합(적대리뷰 P2-2) — 크립토 4h/주식 1d
        });
        metrics = r;
        // backtestStrategy 는 equityCurve 를 노출 안하므로 — 다시 inline 시뮬레이션해 curve 생성
        equityCurve = simulateEquityCurve({ strategyFn, ohlc });
      } catch (e) {
        metrics = { trades: 0, wins: 0, losses: 0, winRate: 0, netReturn: 0, sharpe: 0, profitFactor: null, maxDD: 0, avgHoldHours: 0 };
        equityCurve = [1.0];
      }
      results.push({
        strategy: stratId,
        label: STRATEGY_LABEL[stratId] || stratId,
        color: STRATEGY_COLOR[stratId] || "#94A0B6",
        metrics,
        equityCurve,
      });
    }

    // ── baseline (buy & hold) ──
    const firstClose = ohlc[0].c;
    const lastClose = ohlc[ohlc.length - 1].c;
    const baselineReturn = (lastClose - firstClose) / firstClose;
    const baselineCurve = ohlc.map(b => b.c / firstClose);

    // ── best strategy 선정 (Sharpe + netReturn 기준) ──
    const ranked = results
      .filter(r => r.metrics.trades > 0)
      .sort((a, b) => {
        if (b.metrics.sharpe !== a.metrics.sharpe) return b.metrics.sharpe - a.metrics.sharpe;
        return b.metrics.netReturn - a.metrics.netReturn;
      });
    const best = ranked[0]
      ? { strategy: ranked[0].strategy, sharpe: ranked[0].metrics.sharpe, netReturn: ranked[0].metrics.netReturn }
      : null;

    const payload = {
      ok: true,
      symbol,
      periodDays: period,
      timeframe: timeframeLabel,
      bars: ohlc.length,
      generatedAt: new Date().toISOString(),
      baselineReturnPct: Number((baselineReturn * 100).toFixed(2)),
      baselineCurve: downsample(baselineCurve, 120), // 차트용 다운샘플
      results: results.map(r => ({
        ...r,
        equityCurve: downsample(r.equityCurve, 120),
      })),
      best,
    };

    if (kv) {
      try { await kv.set(cacheKey, payload, { ex: 300 }); } catch {}
    }

    return res.status(200).json(payload);
  } catch (err) {
    console.error("[backtest-compare] fatal:", err);
    return res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
}

// ── equity curve 재시뮬레이션 (backtester 와 동일 로직, curve 만 반환) ────
// strategy-backtester.js 의 backtestStrategy 와 100% 동일한 룰.
const FEE_BPS = 10;
function windowSlice(ohlc, endIdx, minBars = 60) {
  if (endIdx + 1 < minBars) return null;
  const startIdx = Math.max(0, endIdx + 1 - 240);
  const slice = ohlc.slice(startIdx, endIdx + 1);
  return {
    closes: slice.map(b => b.c),
    highs: slice.map(b => b.h),
    lows: slice.map(b => b.l),
    volumes: slice.map(b => b.v),
  };
}
function simulateEquityCurve({ strategyFn, ohlc, slPct = 4, tpPct = 8, maxHoldBars = 24, minBars = 60 }) {
  const curve = new Array(ohlc.length).fill(1.0);
  let equity = 1.0;
  let i = minBars;
  while (i < ohlc.length - 1) {
    const win = windowSlice(ohlc, i, minBars);
    if (!win) { curve[i] = equity; i += 1; continue; }
    let signal;
    try { signal = strategyFn({ ...win, params: null, asset: "X", timeframe: "1h" }); }
    catch { signal = null; }
    if (!signal || !signal.side) { curve[i] = equity; i += 1; continue; }
    const entryBar = ohlc[i];
    const entryPrice = entryBar.c;
    const side = signal.side;
    const slMult = side === "LONG" ? (1 - slPct / 100) : (1 + slPct / 100);
    const tpMult = side === "LONG" ? (1 + tpPct / 100) : (1 - tpPct / 100);
    const slPrice = entryPrice * slMult;
    const tpPrice = entryPrice * tpMult;
    let exitIdx = -1;
    let exitPrice = entryPrice;
    const endIdx = Math.min(ohlc.length - 1, i + maxHoldBars);
    for (let j = i + 1; j <= endIdx; j++) {
      const bar = ohlc[j];
      if (side === "LONG") {
        if (bar.l <= slPrice) { exitIdx = j; exitPrice = slPrice; break; }
        if (bar.h >= tpPrice) { exitIdx = j; exitPrice = tpPrice; break; }
      } else {
        if (bar.h >= slPrice) { exitIdx = j; exitPrice = slPrice; break; }
        if (bar.l <= tpPrice) { exitIdx = j; exitPrice = tpPrice; break; }
      }
    }
    if (exitIdx < 0) { exitIdx = endIdx; exitPrice = ohlc[endIdx].c; }
    let pnlPct = side === "LONG"
      ? (exitPrice - entryPrice) / entryPrice
      : (entryPrice - exitPrice) / entryPrice;
    pnlPct -= FEE_BPS / 10000;
    // 진입~청산 사이의 봉은 비례적으로 equity 가 변하는 게 아니라 청산 시점에 점프.
    // 단순화: 진입~청산 봉 모두 entry equity, 청산 봉부터 새 equity.
    for (let k = i; k < exitIdx; k++) curve[k] = equity;
    equity *= (1 + pnlPct);
    curve[exitIdx] = equity;
    i = exitIdx + 1;
  }
  for (let k = i; k < ohlc.length; k++) curve[k] = equity;
  return curve;
}

// 차트용 다운샘플 (최대 N 포인트)
function downsample(arr, maxPoints = 120) {
  if (!Array.isArray(arr) || arr.length <= maxPoints) return arr.map(v => Number(v.toFixed(5)));
  const step = arr.length / maxPoints;
  const out = [];
  for (let i = 0; i < maxPoints; i++) {
    const idx = Math.min(arr.length - 1, Math.floor(i * step));
    out.push(Number(arr[idx].toFixed(5)));
  }
  out.push(Number(arr[arr.length - 1].toFixed(5)));
  return out;
}
