// POST /api/binance/close-position
// 특정 심볼의 현재 포지션 전체 청산 (MARKET + reduceOnly).
//
// body: { userId, symbol, percent? (0~100, 기본 100) }

import { loadUserCredentials, respondError } from "../_shared/binance-auth.js";
import { getPositionRisk, placeOrder, getExchangeInfo } from "../_shared/binance-client.js";

let _exchangeInfoCache = null;
let _exchangeInfoCacheAt = 0;
async function getSymbolFilter(symbol, testnet) {
  const now = Date.now();
  if (!_exchangeInfoCache || now - _exchangeInfoCacheAt > 5 * 60 * 1000) {
    _exchangeInfoCache = await getExchangeInfo({ testnet });
    _exchangeInfoCacheAt = now;
  }
  const s = (_exchangeInfoCache.symbols || []).find(x => x.symbol === symbol);
  if (!s) throw new Error(`심볼 ${symbol} 없음`);
  const lotSize = s.filters.find(f => f.filterType === "LOT_SIZE") || {};
  return {
    quantityPrecision: s.quantityPrecision,
    stepSize: parseFloat(lotSize.stepSize || 0),
  };
}
function floorToStep(qty, step) {
  if (!step || step <= 0) return qty;
  return Math.floor(qty / step) * step;
}
function roundPrecision(x, p) {
  const f = Math.pow(10, p || 0);
  return Math.floor(x * f) / f;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const { userId, symbol } = body;
    const percent = typeof body.percent === "number" ? body.percent : 100;

    if (!userId) return res.status(400).json({ error: "userId required" });
    if (!symbol) return res.status(400).json({ error: "symbol required" });
    if (percent <= 0 || percent > 100) return res.status(400).json({ error: "percent must be 0~100" });

    const { apiKey, apiSecret, testnet } = await loadUserCredentials(userId, req);

    const risks = await getPositionRisk({ apiKey, apiSecret, symbol, testnet });
    const pos = (risks || []).find(p => parseFloat(p.positionAmt || 0) !== 0);
    if (!pos) {
      return res.status(200).json({ ok: true, message: "청산할 포지션이 없음", symbol });
    }

    const amt = parseFloat(pos.positionAmt);
    const isLong = amt > 0;
    const closeQtyRaw = Math.abs(amt) * (percent / 100);

    const filter = await getSymbolFilter(symbol, testnet);
    const stepped = floorToStep(closeQtyRaw, filter.stepSize);
    const qty = roundPrecision(stepped, filter.quantityPrecision);

    if (qty <= 0) {
      return res.status(400).json({ error: "청산 수량이 너무 작음", closeQtyRaw });
    }

    const orderResp = await placeOrder({
      apiKey, apiSecret, testnet,
      params: {
        symbol,
        side: isLong ? "SELL" : "BUY",
        type: "MARKET",
        quantity: qty,
        reduceOnly: true,
        newOrderRespType: "RESULT",
      },
    });

    return res.status(200).json({
      ok: true,
      symbol,
      closedSide: isLong ? "LONG" : "SHORT",
      closedQty: qty,
      percent,
      orderId: orderResp.orderId,
      avgPrice: parseFloat(orderResp.avgPrice || 0),
      status: orderResp.status,
      raw: orderResp,
    });
  } catch (err) {
    return respondError(res, err);
  }
}
