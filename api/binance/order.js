// POST /api/binance/order
// Futures MARKET 주문 실행. 레버리지/마진타입 자동 세팅 포함.
//
// body:
// {
//   "userId":     "string (필수)",
//   "symbol":     "BTCUSDT (필수)",
//   "side":       "LONG" | "SHORT" (필수)  — 롱/숏 포지션 진입 방향
//   "usdt":       number (필수)   — 포지션에 쓸 증거금 USDT (레버리지 곱하기 전)
//   "leverage":   number (선택, 기본 10)  — 1~125 (심볼별 제한 다름)
//   "marginType": "ISOLATED" | "CROSSED" (선택, 기본 "ISOLATED")
//   "reduceOnly": boolean (선택)  — 포지션 청산 전용
//   "clientOrderId": string (선택) — 멱등성 보장
//   "dryRun":     boolean (선택)  — true면 실제 주문 X, 파라미터만 리턴
// }
//
// 응답:
// {
//   ok: true,
//   orderId, clientOrderId, symbol, side, type, quantity,
//   executedPrice, executedQty, cost, leverage, marginType,
//   raw: {...바이낸스 원본...}
// }

import { loadUserCredentials, respondError } from "../_shared/binance-auth.js";
import {
  binanceSignedRequest,
  changeLeverage,
  changeMarginType,
  getExchangeInfo,
  getTickerPrice,
  placeOrder,
} from "../_shared/binance-client.js";

// 심볼 정보 캐시 (Lambda warm 동안 유지)
let _exchangeInfoCache = null;
let _exchangeInfoCacheAt = 0;
async function getSymbolFilter(symbol, testnet) {
  const now = Date.now();
  if (!_exchangeInfoCache || now - _exchangeInfoCacheAt > 5 * 60 * 1000) {
    _exchangeInfoCache = await getExchangeInfo({ testnet });
    _exchangeInfoCacheAt = now;
  }
  const s = (_exchangeInfoCache.symbols || []).find(x => x.symbol === symbol);
  if (!s) throw new Error(`심볼 ${symbol} 을 바이낸스에서 찾을 수 없음`);
  const lotSize = s.filters.find(f => f.filterType === "LOT_SIZE") || {};
  const minNotional = s.filters.find(f => f.filterType === "MIN_NOTIONAL") || {};
  const priceFilter = s.filters.find(f => f.filterType === "PRICE_FILTER") || {};
  return {
    pricePrecision: s.pricePrecision,
    quantityPrecision: s.quantityPrecision,
    stepSize: parseFloat(lotSize.stepSize || 0),
    minQty: parseFloat(lotSize.minQty || 0),
    minNotional: parseFloat(minNotional.notional || 0),
    tickSize: parseFloat(priceFilter.tickSize || 0),
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
    const {
      userId,
      symbol,
      side,              // "LONG" | "SHORT"
      usdt,              // 증거금 USDT
      leverage = 10,
      marginType = "ISOLATED",
      reduceOnly = false,
      clientOrderId,
      dryRun = false,
    } = body;

    // === 입력 검증 ===
    if (!userId) return res.status(400).json({ error: "userId is required" });
    if (!symbol || typeof symbol !== "string") return res.status(400).json({ error: "symbol is required" });
    if (!["LONG", "SHORT"].includes(side)) return res.status(400).json({ error: "side must be LONG or SHORT" });
    if (typeof usdt !== "number" || usdt <= 0) return res.status(400).json({ error: "usdt must be positive number" });
    if (usdt > 100000) return res.status(400).json({ error: "단일 주문 한도 초과 ($100,000)" });
    if (typeof leverage !== "number" || leverage < 1 || leverage > 125) {
      return res.status(400).json({ error: "leverage must be 1~125" });
    }
    if (!["ISOLATED", "CROSSED"].includes(marginType)) {
      return res.status(400).json({ error: "marginType must be ISOLATED or CROSSED" });
    }

    const { apiKey, apiSecret, testnet } = await loadUserCredentials(userId);

    // === 1) 심볼 필터 조회 ===
    const filter = await getSymbolFilter(symbol, testnet);

    // === 2) 현재가 조회 ===
    const tick = await getTickerPrice({ symbol, testnet });
    const price = parseFloat(tick.price);
    if (!price || price <= 0) throw new Error(`가격 조회 실패: ${symbol}`);

    // === 3) 수량 계산 ===
    // notional = usdt * leverage, qty = notional / price
    const notional = usdt * leverage;
    const rawQty = notional / price;
    const stepped = floorToStep(rawQty, filter.stepSize);
    const qty = roundPrecision(stepped, filter.quantityPrecision);

    if (qty < filter.minQty) {
      return res.status(400).json({
        error: `최소 수량 미달: ${qty} < ${filter.minQty} (증거금/레버리지/가격 조정 필요)`,
        debug: { price, notional, rawQty, stepSize: filter.stepSize, minQty: filter.minQty },
      });
    }
    if (qty * price < filter.minNotional) {
      return res.status(400).json({
        error: `최소 명목가 미달: ${(qty * price).toFixed(2)} < ${filter.minNotional}`,
      });
    }

    // === 4) Dry run ===
    if (dryRun) {
      return res.status(200).json({
        ok: true,
        dryRun: true,
        symbol, side, leverage, marginType,
        price, notional, qty,
        estimatedMargin: usdt,
      });
    }

    // === 5) 마진 타입 변경 (이미 같으면 에러 나지만 무시) ===
    try {
      await changeMarginType({ apiKey, apiSecret, symbol, marginType, testnet });
    } catch (e) {
      // -4046: "No need to change margin type." — 이미 같음, 무시
      if (e?.data?.code !== -4046) {
        console.warn(`[order] marginType 변경 경고 (${symbol}):`, e?.data?.msg || e?.message);
      }
    }

    // === 6) 레버리지 변경 ===
    try {
      await changeLeverage({ apiKey, apiSecret, symbol, leverage, testnet });
    } catch (e) {
      console.warn(`[order] leverage 변경 경고 (${symbol}):`, e?.data?.msg || e?.message);
      // 레버리지 변경 실패는 치명적 — 중단
      return res.status(400).json({
        error: `레버리지 ${leverage}x 설정 실패`,
        detail: e?.data?.msg || e?.message,
      });
    }

    // === 7) 주문 실행 ===
    // one-way mode 기준: BUY=롱 진입, SELL=숏 진입 (또는 청산)
    const orderSide = side === "LONG" ? "BUY" : "SELL";
    const orderParams = {
      symbol,
      side: orderSide,
      type: "MARKET",
      quantity: qty,
    };
    if (reduceOnly) orderParams.reduceOnly = "true";
    if (clientOrderId) orderParams.newClientOrderId = clientOrderId;
    // 체결 정보 풀로 받기
    orderParams.newOrderRespType = "RESULT";

    const orderResp = await placeOrder({ apiKey, apiSecret, params: orderParams, testnet });

    // === 8) KV에 주문 로그 기록 ===
    try {
      const kvModule = await import("@vercel/kv");
      const kv = kvModule.kv;
      const logKey = `di:real:user:${userId}:orders`;
      const existing = (await kv.get(logKey)) || [];
      const entry = {
        time: new Date().toISOString(),
        symbol,
        side,
        orderSide,
        qty,
        leverage,
        marginType,
        price,
        orderId: orderResp.orderId,
        clientOrderId: orderResp.clientOrderId,
        executedQty: parseFloat(orderResp.executedQty || 0),
        avgPrice: parseFloat(orderResp.avgPrice || 0),
        status: orderResp.status,
        reduceOnly,
      };
      existing.unshift(entry);
      // 최근 500건만 보존
      await kv.set(logKey, existing.slice(0, 500));
    } catch (e) {
      console.warn("[order] log 저장 실패:", e?.message);
    }

    return res.status(200).json({
      ok: true,
      symbol,
      side,
      leverage,
      marginType,
      orderId: orderResp.orderId,
      clientOrderId: orderResp.clientOrderId,
      type: orderResp.type,
      status: orderResp.status,
      executedQty: parseFloat(orderResp.executedQty || 0),
      avgPrice: parseFloat(orderResp.avgPrice || 0),
      cumQuote: parseFloat(orderResp.cumQuote || 0),
      qtyRequested: qty,
      priceAtRequest: price,
      notional,
      raw: orderResp,
    });
  } catch (err) {
    return respondError(res, err);
  }
}
