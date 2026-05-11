// ════════════════════════════════════════════════════════════════════
// Zepta — 포트폴리오 분석 API
// ────────────────────────────────────────────────────────────────────
// PLAN-SVC #3 (2026-05-11)
//
// 입력 (POST):
//   {
//     userId?: string,                 // (선택) 서버 holdings 조회용
//     holdings?: [{ symbol, quantity, type? }]  // (선택) 클라 직접 전달
//   }
//
// 출력:
//   {
//     ok: true,
//     allocation: [{ symbol, weight, value, category }],
//     categories: [{ name, weight }],
//     correlation: { symbols, matrix },            // NxN
//     diversityScore: 0~100,                       // 0=집중, 100=완전 분산
//     diversityLabel: "잘 분산됨" | "보통" | "집중 위험",
//     rebalanceTips: [string],
//     volatility: { atr14, mdd30, sharpe30, totalValue },
//     sectorExposure: [{ name, weight }]
//   }
//
// 데이터 소스:
//   - 코인: CoinGecko 시뮬레이션은 무리 → yahoo /api/yahoo-ohlc 활용
//     (yahoo 가 BTC-USD, ETH-USD 등 지원)
//   - 주식: 동일 yahoo API
// ════════════════════════════════════════════════════════════════════

export const config = { maxDuration: 30 };

// ────────────────────────────────────────────────────────────────
// 카테고리 매핑 — 코인 (메가캡/디파이/L2/밈) + 주식 섹터
// ────────────────────────────────────────────────────────────────
const COIN_CATEGORY = {
  BTC: "메가캡",
  ETH: "메가캡",
  SOL: "메가캡",
  BNB: "메가캡",
  XRP: "메가캡",
  ADA: "메가캡",
  AVAX: "메가캡",
  LINK: "DeFi 인프라",
  UNI: "DeFi 인프라",
  AAVE: "DeFi 인프라",
  DOT: "DeFi 인프라",
  ARB: "L2",
  OP: "L2",
  MATIC: "L2",
  POL: "L2",
  DOGE: "밈코인",
  SHIB: "밈코인",
  PEPE: "밈코인",
};

const STOCK_SECTOR = {
  AAPL: "Tech",
  MSFT: "Tech",
  GOOGL: "Tech",
  GOOG: "Tech",
  META: "Tech",
  NVDA: "Tech",
  AMZN: "Tech",
  TSLA: "Auto/Tech",
  JPM: "Finance",
  BAC: "Finance",
  GS: "Finance",
  XOM: "Energy",
  CVX: "Energy",
  JNJ: "Healthcare",
  PFE: "Healthcare",
  UNH: "Healthcare",
  WMT: "Consumer",
  PG: "Consumer",
  KO: "Consumer",
};

function categoryFor(symbol, type) {
  const sym = String(symbol || "").toUpperCase();
  // Crypto: BTC, BTC-USD, BTCUSDT 등 prefix 매칭
  const baseCoin = sym.replace(/USDT$/, "").replace(/-USD$/, "").replace(/USD$/, "");
  if (COIN_CATEGORY[baseCoin]) return COIN_CATEGORY[baseCoin];
  if (STOCK_SECTOR[sym]) return STOCK_SECTOR[sym];
  return type === "crypto" ? "기타 코인" : "기타";
}

// ────────────────────────────────────────────────────────────────
// Yahoo OHLC 30일 fetch — symbol 정규화 포함
//   코인: BTC → BTC-USD
//   주식: AAPL → AAPL
// ────────────────────────────────────────────────────────────────
function normalizeYahooSymbol(symbol, type) {
  const s = String(symbol || "").toUpperCase().trim();
  if (!s) return null;
  // 이미 yahoo 형식 (BTC-USD, AAPL)
  if (s.includes("-") || (type === "stock" && !s.endsWith("USDT"))) return s;
  // USDT pair → coin-USD
  if (s.endsWith("USDT")) return s.replace(/USDT$/, "-USD");
  // 기본 (type=crypto) → -USD 추가
  if (type === "crypto" || COIN_CATEGORY[s]) return `${s}-USD`;
  return s;
}

async function fetchOhlc30(symbol, type, host) {
  const ys = normalizeYahooSymbol(symbol, type);
  if (!ys) return null;
  try {
    const url = `${host}/api/yahoo?_mode=ohlc&symbol=${encodeURIComponent(ys)}&interval=1d&range=2mo`;
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const j = await r.json();
    const closes = (j?.closes || j?.close || []).map(Number).filter(v => isFinite(v) && v > 0);
    const highs = (j?.highs || j?.high || []).map(Number).filter(v => isFinite(v));
    const lows = (j?.lows || j?.low || []).map(Number).filter(v => isFinite(v));
    if (closes.length < 10) return null;
    // 최근 30일만
    return {
      closes: closes.slice(-30),
      highs: highs.slice(-30),
      lows: lows.slice(-30),
      lastPrice: closes[closes.length - 1],
    };
  } catch {
    return null;
  }
}

// ────────────────────────────────────────────────────────────────
// 로그수익률 → Pearson 상관계수
// ────────────────────────────────────────────────────────────────
function logReturns(closes) {
  const r = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i] > 0 && closes[i - 1] > 0) r.push(Math.log(closes[i] / closes[i - 1]));
  }
  return r;
}

function pearson(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 3) return 0;
  const ax = a.slice(-n), bx = b.slice(-n);
  const meanA = ax.reduce((s, v) => s + v, 0) / n;
  const meanB = bx.reduce((s, v) => s + v, 0) / n;
  let num = 0, dA = 0, dB = 0;
  for (let i = 0; i < n; i++) {
    const da = ax[i] - meanA;
    const db = bx[i] - meanB;
    num += da * db;
    dA += da * da;
    dB += db * db;
  }
  const denom = Math.sqrt(dA * dB);
  if (denom === 0) return 0;
  return num / denom;
}

// ────────────────────────────────────────────────────────────────
// 분산 점수 — Herfindahl-Hirschman Index 응용
//   HHI = Σ(w_i^2). 1=완전 집중, 1/N=완전 분산.
//   diversityScore = (1 - HHI) × 100, 단 평균 상관계수가 높으면 페널티
// ────────────────────────────────────────────────────────────────
function diversityScore(weights, avgCorrelation) {
  const hhi = weights.reduce((s, w) => s + w * w, 0);
  let base = Math.max(0, Math.min(1, 1 - hhi)) * 100;
  // 평균 상관계수가 0.7 이상이면 분산 효과 미미 → 점수 절반
  if (avgCorrelation > 0.7) base *= 0.6;
  else if (avgCorrelation > 0.5) base *= 0.8;
  return Math.round(base);
}

function diversityLabel(score) {
  if (score >= 70) return "잘 분산됨";
  if (score >= 40) return "보통";
  return "집중 위험";
}

// ────────────────────────────────────────────────────────────────
// 리밸런싱 추천 — 비중 상한 + 카테고리 균형
// ────────────────────────────────────────────────────────────────
function buildRebalanceTips(allocation, categories) {
  const tips = [];
  // 단일 자산 30% 이상 경고
  const heavy = allocation.filter(a => a.weight > 0.3);
  for (const h of heavy) {
    const target = Math.round(h.weight * 100) >= 50 ? 25 : 20;
    tips.push(`${h.symbol} 비중 ${Math.round(h.weight * 100)}% → ${target}% 권장 (단일 자산 집중 위험)`);
  }
  // 단일 카테고리 60% 이상 경고
  const heavyCat = categories.filter(c => c.weight > 0.6);
  for (const c of heavyCat) {
    tips.push(`'${c.name}' 카테고리 비중 ${Math.round(c.weight * 100)}% — 다른 섹터 분산 필요`);
  }
  // 자산 < 3 → 분산 부족
  if (allocation.length < 3) {
    tips.push(`보유 종목 ${allocation.length}개 — 최소 3~5개로 분산 권장`);
  }
  if (tips.length === 0) {
    tips.push("현재 배분은 양호합니다. 정기적으로 비중을 점검하세요.");
  }
  return tips;
}

// ────────────────────────────────────────────────────────────────
// 변동성 메트릭 — 가중 평균 일일 수익률 → 연환산 Sharpe
// ────────────────────────────────────────────────────────────────
function portfolioVolMetrics(holdings, ohlcMap) {
  const totalValue = holdings.reduce((s, h) => s + (h.value || 0), 0);
  if (totalValue <= 0) return { atr14: null, mdd30: null, sharpe30: null, totalValue: 0 };

  // 가중 일일 수익률 시계열 (T=30)
  const T = 30;
  const portRet = new Array(T - 1).fill(0);
  for (const h of holdings) {
    const ohlc = ohlcMap[h.symbol];
    if (!ohlc || ohlc.closes.length < T) continue;
    const w = h.value / totalValue;
    const c = ohlc.closes.slice(-T);
    for (let i = 1; i < c.length; i++) {
      const r = c[i] / c[i - 1] - 1;
      portRet[i - 1] += w * r;
    }
  }
  // ATR(14) 응용 — 일일 수익률 절댓값의 EMA14
  const abs = portRet.map(Math.abs);
  let atr = abs[0] || 0;
  for (let i = 1; i < abs.length; i++) atr = atr * (13 / 14) + abs[i] * (1 / 14);

  // MDD30 — 누적 equity 시계열
  let equity = 1;
  let peak = 1;
  let mdd = 0;
  for (const r of portRet) {
    equity *= (1 + r);
    peak = Math.max(peak, equity);
    mdd = Math.max(mdd, (peak - equity) / peak);
  }

  // Sharpe30 (연환산, rf=0 가정)
  const mean = portRet.reduce((s, v) => s + v, 0) / portRet.length;
  const variance = portRet.reduce((s, v) => s + (v - mean) ** 2, 0) / portRet.length;
  const stdev = Math.sqrt(variance);
  const sharpe = stdev > 0 ? (mean / stdev) * Math.sqrt(365) : 0;

  return {
    atr14: Number((atr * 100).toFixed(2)),     // %
    mdd30: Number((mdd * 100).toFixed(2)),     // %
    sharpe30: Number(sharpe.toFixed(2)),
    totalValue: Number(totalValue.toFixed(2)),
  };
}

// ════════════════════════════════════════════════════════════════════
// HTTP handler
// ════════════════════════════════════════════════════════════════════
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "method not allowed" });

  try {
    const body = req.body || {};
    let holdings = Array.isArray(body.holdings) ? body.holdings : null;

    // userId 만 들어온 경우 — KV 의 사용자 holdings 시도 (없으면 빈 분석)
    if (!holdings && body.userId) {
      try {
        const kvModule = await import("@vercel/kv");
        const kv = kvModule.kv;
        const stock = (await kv.get(`zepta:portfolio:${body.userId}:stocks`)) || [];
        const crypto = (await kv.get(`zepta:portfolio:${body.userId}:crypto`)) || [];
        holdings = [...stock.map(h => ({ ...h, type: "stock" })), ...crypto.map(h => ({ ...h, type: "crypto" }))];
      } catch {}
    }

    if (!Array.isArray(holdings) || holdings.length === 0) {
      return res.status(200).json({
        ok: true,
        empty: true,
        message: "보유 종목이 없습니다. 포트폴리오에 종목을 추가해주세요.",
      });
    }

    // 입력 검증 + 정규화
    const norm = holdings
      .map(h => ({
        symbol: String(h.symbol || h.ticker || "").toUpperCase().trim(),
        quantity: Number(h.quantity || h.qty || 0),
        type: h.type === "crypto" || h.type === "stock" ? h.type : (h.symbol?.endsWith("USDT") ? "crypto" : "stock"),
      }))
      .filter(h => h.symbol && h.quantity > 0)
      .slice(0, 30); // 최대 30개

    if (norm.length === 0) {
      return res.status(200).json({ ok: true, empty: true, message: "유효한 종목이 없습니다." });
    }

    // 호스트 추론 (yahoo proxy 호출용)
    const host = req.headers.host?.startsWith("localhost")
      ? `http://${req.headers.host}`
      : `https://${req.headers.host || "zepta.app"}`;

    // OHLC 동시 fetch
    const ohlcEntries = await Promise.all(
      norm.map(async h => [h.symbol, await fetchOhlc30(h.symbol, h.type, host)])
    );
    const ohlcMap = Object.fromEntries(ohlcEntries);

    // 현재가 + 평가액 산출
    const enriched = norm.map(h => {
      const o = ohlcMap[h.symbol];
      const price = o?.lastPrice || 0;
      return { ...h, price, value: price * h.quantity };
    }).filter(h => h.value > 0);

    if (enriched.length === 0) {
      return res.status(200).json({ ok: true, empty: true, message: "가격 데이터를 조회할 수 없습니다." });
    }

    const totalValue = enriched.reduce((s, h) => s + h.value, 0);
    const allocation = enriched.map(h => ({
      symbol: h.symbol,
      quantity: h.quantity,
      price: Number(h.price.toFixed(2)),
      value: Number(h.value.toFixed(2)),
      weight: h.value / totalValue,
      category: categoryFor(h.symbol, h.type),
    })).sort((a, b) => b.weight - a.weight);

    // 카테고리 집계
    const catMap = {};
    for (const a of allocation) {
      catMap[a.category] = (catMap[a.category] || 0) + a.weight;
    }
    const categories = Object.entries(catMap)
      .map(([name, weight]) => ({ name, weight: Number(weight.toFixed(4)) }))
      .sort((a, b) => b.weight - a.weight);

    // 섹터(주식만)
    const sectorMap = {};
    for (const a of allocation) {
      const t = enriched.find(e => e.symbol === a.symbol)?.type;
      if (t === "stock") sectorMap[a.category] = (sectorMap[a.category] || 0) + a.weight;
    }
    const sectorExposure = Object.entries(sectorMap)
      .map(([name, weight]) => ({ name, weight: Number(weight.toFixed(4)) }))
      .sort((a, b) => b.weight - a.weight);

    // 상관관계 매트릭스
    const corrSymbols = allocation.map(a => a.symbol);
    const returnsBySymbol = {};
    for (const sym of corrSymbols) {
      const o = ohlcMap[sym];
      returnsBySymbol[sym] = o ? logReturns(o.closes) : [];
    }
    const matrix = corrSymbols.map(s1 =>
      corrSymbols.map(s2 => {
        if (s1 === s2) return 1;
        const r = pearson(returnsBySymbol[s1], returnsBySymbol[s2]);
        return Number(r.toFixed(3));
      })
    );

    // 평균 상관계수 (대각 제외)
    let sumCorr = 0, cntCorr = 0;
    for (let i = 0; i < matrix.length; i++) {
      for (let j = i + 1; j < matrix.length; j++) {
        sumCorr += Math.abs(matrix[i][j]);
        cntCorr += 1;
      }
    }
    const avgCorr = cntCorr > 0 ? sumCorr / cntCorr : 0;

    // 분산 점수
    const weights = allocation.map(a => a.weight);
    const divScore = diversityScore(weights, avgCorr);

    // 변동성 메트릭
    const volMetrics = portfolioVolMetrics(enriched, ohlcMap);

    // 리밸런싱 추천
    const tips = buildRebalanceTips(allocation, categories);

    return res.status(200).json({
      ok: true,
      allocation,
      categories,
      sectorExposure,
      correlation: { symbols: corrSymbols, matrix, avgAbs: Number(avgCorr.toFixed(3)) },
      diversityScore: divScore,
      diversityLabel: diversityLabel(divScore),
      rebalanceTips: tips,
      volatility: volMetrics,
      totalValue: Number(totalValue.toFixed(2)),
      generatedAt: new Date().toISOString(),
    });
  } catch (e) {
    console.error("[portfolio-analysis] error:", e);
    return res.status(500).json({ ok: false, error: e.message || String(e) });
  }
}
