// ════════════════════════════════════════════════════════════════════
// OHLC 기반 정확 백테스트 헬퍼 (Track B 1단계)
//
// 기존 retroBacktest 의 한계:
//   - MAE/MFE 만 알고 가격 경로는 모름 → "보수적 가정" 으로 근사
//   - SL 발동 시점, TP 발동 순서 모호
//
// 이 헬퍼:
//   - Binance Public Klines API 로 실제 분봉/시간봉 OHLC 가져옴
//   - 각 봉의 high/low 로 SL/TP hit 정확 판정 (시간 순서 반영)
//   - 5분봉 기준 (분봉 너무 많고 5분이면 충분)
//   - 한 번 fetch 한 OHLC 는 in-memory 캐싱 (같은 symbol×기간 재호출 방지)
//
// API 한도 (Binance Public):
//   - klines 1회당 1500개 봉 max
//   - 분봉 5분이면 1500 봉 = 125시간 = 5일치
//   - rate limit 1200 req/min (충분)
//
// 사용:
//   import { preciseBacktest } from "./ohlc-backtest.js";
//   const result = await preciseBacktest({ symbol, side, entryPrice, openedAt, slPct, tpPct, holdHours });
// ════════════════════════════════════════════════════════════════════

const BINANCE_FAPI = process.env.BINANCE_FAPI_BASE || "https://fapi.binance.com";

// in-memory OHLC 캐시 (Vercel function lifetime 한정 — 보통 cold start 까지)
const ohlcCache = new Map();

/**
 * Binance USDM Futures klines fetch.
 * @param {string} symbol  예: "ADAUSDT"
 * @param {string} interval  "1m"|"5m"|"15m"|"1h"
 * @param {number} startMs  Unix ms
 * @param {number} endMs    Unix ms
 * @returns {Promise<Array>}  [openTime, open, high, low, close, volume, closeTime, ...]
 */
async function fetchKlinesRange(symbol, interval, startMs, endMs) {
  const cacheKey = `${symbol}:${interval}:${startMs}:${endMs}`;
  if (ohlcCache.has(cacheKey)) return ohlcCache.get(cacheKey);

  const url = `${BINANCE_FAPI}/fapi/v1/klines?symbol=${symbol}&interval=${interval}` +
              `&startTime=${startMs}&endTime=${endMs}&limit=1500`;
  // User-Agent 필수 — 일부 CDN 이 fetch 기본값 거부.
  // timeout 15초 (Vercel cold start 고려)
  let r;
  try {
    r = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      headers: {
        "User-Agent": "Zepta/1.0 (backtest-engine)",
        "Accept": "application/json",
      },
    });
  } catch (e) {
    throw new Error(`fetch failed: ${e?.message || e?.name || String(e)} (url: ${url.slice(0, 100)}...)`);
  }
  if (!r.ok) {
    let body = "";
    try { body = (await r.text()).slice(0, 300); } catch {}
    throw new Error(`klines ${r.status} ${symbol} ${interval}: ${body}`);
  }
  let data;
  try {
    data = await r.json();
  } catch (e) {
    throw new Error(`klines JSON parse failed: ${e?.message}`);
  }
  if (!Array.isArray(data)) {
    throw new Error(`klines unexpected response shape: ${JSON.stringify(data).slice(0, 200)}`);
  }
  ohlcCache.set(cacheKey, data);
  return data;
}

/**
 * 한 거래에 대해 SL/TP/maxHold 룰을 적용해 정확한 청산 시점 계산.
 *
 * 가정: 각 봉 안에서 high 와 low 의 도달 순서는 알 수 없음 → 보수적 (LONG 기준
 * low 가 먼저 도달했다고 가정해 SL 우선 판정. 단 봉의 open 이 SL 보다 위에서
 * 시작했고 close 가 TP 위에서 끝났다면 SL 안 맞은 채 TP 도달했을 가능성 높음)
 *
 * 단순화: 봉 안에서는 SL 우선 평가 (보수적). open=high=low=close 같은 경우는 SL/TP 직접 비교.
 */
export async function preciseBacktest({
  symbol,
  side, // "LONG" | "SHORT"
  entryPrice,
  openedAt, // ISO string or Unix ms
  slPct,    // 0.04 = 4%
  tpPct,    // 0.06 = 6%
  holdHours = 48,
  interval = "5m",
} = {}) {
  if (!symbol || !side || !entryPrice || !openedAt || slPct == null || tpPct == null) {
    return { error: "missing input" };
  }
  const startMs = typeof openedAt === "string" ? Date.parse(openedAt) : openedAt;
  if (!Number.isFinite(startMs)) return { error: "invalid openedAt" };
  const endMs = startMs + holdHours * 3600000;

  const slPrice = side === "LONG" ? entryPrice * (1 - slPct) : entryPrice * (1 + slPct);
  const tpPrice = side === "LONG" ? entryPrice * (1 + tpPct) : entryPrice * (1 - tpPct);

  let candles;
  try {
    candles = await fetchKlinesRange(symbol, interval, startMs, endMs);
  } catch (e) {
    return { error: `fetchKlines: ${e?.message || String(e)}` };
  }
  if (!Array.isArray(candles) || candles.length === 0) {
    return { error: "empty candles" };
  }

  // 각 봉 순회하며 SL/TP hit 판정
  for (const k of candles) {
    const [openTime, , h, l, c] = k;
    const high = Number(h);
    const low = Number(l);
    if (!Number.isFinite(high) || !Number.isFinite(low)) continue;
    if (side === "LONG") {
      // 보수적: SL 우선 판정 (한 봉 안에서 SL/TP 둘 다 닿으면 SL 로 청산됐다고 가정)
      if (low <= slPrice) {
        const grossPct = (slPrice - entryPrice) / entryPrice;
        return {
          closeReason: "SL",
          exitPrice: slPrice,
          exitTime: openTime,
          grossPct,
          holdMs: openTime - startMs,
          candlesScanned: candles.indexOf(k) + 1,
        };
      }
      if (high >= tpPrice) {
        const grossPct = (tpPrice - entryPrice) / entryPrice;
        return {
          closeReason: "TP",
          exitPrice: tpPrice,
          exitTime: openTime,
          grossPct,
          holdMs: openTime - startMs,
          candlesScanned: candles.indexOf(k) + 1,
        };
      }
    } else {
      // SHORT
      if (high >= slPrice) {
        const grossPct = (entryPrice - slPrice) / entryPrice;
        return {
          closeReason: "SL",
          exitPrice: slPrice,
          exitTime: openTime,
          grossPct,
          holdMs: openTime - startMs,
          candlesScanned: candles.indexOf(k) + 1,
        };
      }
      if (low <= tpPrice) {
        const grossPct = (entryPrice - tpPrice) / entryPrice;
        return {
          closeReason: "TP",
          exitPrice: tpPrice,
          exitTime: openTime,
          grossPct,
          holdMs: openTime - startMs,
          candlesScanned: candles.indexOf(k) + 1,
        };
      }
    }
  }

  // 어떤 룰에도 안 닿음 → maxHold 만료. 마지막 봉의 close 로 청산.
  const last = candles[candles.length - 1];
  const lastClose = Number(last[4]);
  const grossPct = side === "LONG"
    ? (lastClose - entryPrice) / entryPrice
    : (entryPrice - lastClose) / entryPrice;
  return {
    closeReason: "TIME",
    exitPrice: lastClose,
    exitTime: last[0],
    grossPct,
    holdMs: holdHours * 3600000,
    candlesScanned: candles.length,
  };
}

/**
 * 여러 거래를 변형 매트릭스(SL × TP)로 배치 백테스트.
 * @param {Array<closedTrade>} trades  archive 또는 ledger 의 closed 항목
 * @param {Object} variant  { slPct, tpPct, holdHours }
 * @returns {Promise<{trades, wins, losses, winRate, netPnL, byCloseReason}>}
 */
export async function batchBacktest(trades, variant) {
  const { slPct, tpPct, holdHours = 48 } = variant;
  const results = [];
  const errors = [];
  let skipped = 0;
  for (const t of trades) {
    if (!t.symbol || !t.side || !t.entryPrice || !t.openedAt) {
      skipped++;
      continue;
    }
    const sim = await preciseBacktest({
      symbol: t.symbol,
      side: t.side,
      entryPrice: t.entryPrice,
      openedAt: t.openedAt,
      slPct: slPct / 100,
      tpPct: tpPct / 100,
      holdHours,
    });
    if (sim.error) {
      if (errors.length < 3) errors.push({ id: t.id, symbol: t.symbol, error: sim.error });
      continue;
    }
    const costPct = ((t.feeBps || 8) + (t.slippageBps || 5)) / 10000;
    const netPct = sim.grossPct - costPct;
    const netPnL = (t.notional || 0) * netPct;
    results.push({ ...sim, netPnL, netPct });
  }
  if (!results.length) {
    return {
      trades: 0,
      wins: 0, losses: 0, winRate: 0, netPnL: 0,
      _diag: { input: trades.length, skipped, errored: errors.length, sampleErrors: errors },
    };
  }
  const wins = results.filter((r) => r.netPnL > 0).length;
  const netPnL = results.reduce((a, r) => a + r.netPnL, 0);
  const reasons = { TP: 0, SL: 0, TIME: 0 };
  for (const r of results) reasons[r.closeReason] = (reasons[r.closeReason] || 0) + 1;
  return {
    trades: results.length,
    wins,
    losses: results.length - wins,
    winRate: Number(((wins / results.length) * 100).toFixed(1)),
    netPnL: Number(netPnL.toFixed(2)),
    avgHoldMs: Math.round(results.reduce((a, r) => a + (r.holdMs || 0), 0) / results.length),
    byCloseReason: reasons,
    _diag: errors.length > 0 ? { input: trades.length, skipped, errored: errors.length, sampleErrors: errors } : undefined,
  };
}

// 캐시 비우기 (테스트용)
export function clearOhlcCache() { ohlcCache.clear(); }
