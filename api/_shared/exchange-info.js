// api/_shared/exchange-info.js
//
// 공용 Binance Futures exchangeInfo 캐시 + 심볼 필터 유틸.
// Phase 1 에서 "PHASE1_ALLOWED_SYMBOLS 하드코딩" 을 대체한다:
//  - 심볼이 실제로 현재 자본에서 minNotional 을 감당 가능한지 동적 판단
//  - 필터 (stepSize/minQty/minNotional/tickSize) 를 모든 호출부에서 일관되게 조회
//  - 주문 거부 (-1111, -4164, -2010 등) 시 캐시 강제 갱신 가능

import { getExchangeInfo } from "./binance-client.js";

let _cache = null;
let _cachedAt = 0;
const TTL_MS = 10 * 60 * 1000; // 10분

async function loadFresh(testnet) {
  _cache = await getExchangeInfo({ testnet });
  _cachedAt = Date.now();
  return _cache;
}

export async function ensureExchangeInfo({ testnet = false, force = false } = {}) {
  const now = Date.now();
  if (force || !_cache || now - _cachedAt > TTL_MS) {
    await loadFresh(testnet);
  }
  return _cache;
}

export function invalidateExchangeInfo() {
  _cache = null;
  _cachedAt = 0;
}

export async function getSymbolFilter(symbol, { testnet = false, force = false } = {}) {
  const info = await ensureExchangeInfo({ testnet, force });
  const s = (info.symbols || []).find((x) => x.symbol === symbol);
  if (!s) throw new Error(`symbol ${symbol} not in exchangeInfo`);
  const lot = s.filters.find((f) => f.filterType === "LOT_SIZE") || {};
  const mn  = s.filters.find((f) => f.filterType === "MIN_NOTIONAL") || {};
  const pf  = s.filters.find((f) => f.filterType === "PRICE_FILTER") || {};
  return {
    symbol,
    pricePrecision: s.pricePrecision,
    quantityPrecision: s.quantityPrecision,
    stepSize: parseFloat(lot.stepSize || 0),
    minQty: parseFloat(lot.minQty || 0),
    minNotional: parseFloat(mn.notional || 0),
    tickSize: parseFloat(pf.tickSize || 0),
    contractType: s.contractType,
    status: s.status,
  };
}

/**
 * 현재 equity 에서 이 심볼이 최소 주문가능한지 판단.
 * notional = equity × maxMarginPct × (minLeverage ~ maxLeverage 평균) 로 상한 추정.
 * 그 상한이 minNotional × safety 이상이면 OK.
 */
export function isSymbolAffordable({ equity, filter, cfg }) {
  if (!filter || !equity || equity <= 0) return false;
  const minN = filter.minNotional || 0;
  if (minN <= 0) return true;
  const maxMarginPct = cfg?.maxMarginPct ?? 0.4;
  const maxLev = cfg?.maxLeverage ?? 10;
  const maxNotionalAvailable = equity * maxMarginPct * maxLev;
  const safety = cfg?.minNotionalSafety ?? 1.05;
  return maxNotionalAvailable >= minN * safety;
}

export default { ensureExchangeInfo, invalidateExchangeInfo, getSymbolFilter, isSymbolAffordable };
