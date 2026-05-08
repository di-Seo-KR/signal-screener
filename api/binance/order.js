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
  placeStopOrder,
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

/**
 * 재사용 가능한 내부 함수: (dry)실제 진입+옵션으로 SL/TP 까지 한 번에 태운다.
 * 실전매매 엔진(api/real-trading/engine.js, api/binance/bracket-order.js)이 이걸 호출한다.
 *
 * @param {object} opts
 * @param {string} opts.userId
 * @param {string} opts.symbol
 * @param {"LONG"|"SHORT"} opts.side
 * @param {number} opts.usdt            증거금 USDT (레버리지 곱하기 전)
 * @param {number} [opts.leverage=10]
 * @param {"ISOLATED"|"CROSSED"} [opts.marginType="ISOLATED"]
 * @param {boolean} [opts.dryRun=true]  ★ 기본값 true (안전 기본값)
 * @param {number} [opts.stopLossPrice]
 * @param {number} [opts.takeProfitPrice]
 * @param {string} [opts.clientOrderId]
 * @returns {Promise<object>}
 */
export async function executeOrderPlan(opts) {
  const {
    userId, symbol, side, usdt,
    leverage = 10, marginType = "ISOLATED",
    dryRun = true, stopLossPrice, takeProfitPrice, clientOrderId,
  } = opts;

  if (!userId) throw Object.assign(new Error("userId required"), { code: "BAD_REQUEST" });
  if (!["LONG", "SHORT"].includes(side)) throw Object.assign(new Error("side must be LONG/SHORT"), { code: "BAD_REQUEST" });
  if (!(usdt > 0)) throw Object.assign(new Error("usdt > 0 required"), { code: "BAD_REQUEST" });

  const { apiKey, apiSecret, testnet } = await loadUserCredentials(userId);
  const filter = await getSymbolFilter(symbol, testnet);
  const tick = await getTickerPrice({ symbol, testnet });
  const price = parseFloat(tick.price);
  if (!(price > 0)) throw new Error(`price fetch failed: ${symbol}`);

  const notional = usdt * leverage;
  const rawQty = notional / price;
  const stepped = floorToStep(rawQty, filter.stepSize);
  const qty = roundPrecision(stepped, filter.quantityPrecision);

  if (qty < filter.minQty) throw new Error(`qty ${qty} < minQty ${filter.minQty}`);
  if (qty * price < filter.minNotional) throw new Error(`notional ${(qty * price).toFixed(2)} < minNotional ${filter.minNotional}`);

  if (dryRun) {
    return {
      ok: true, dryRun: true, symbol, side, leverage, marginType,
      price, notional, qty, estimatedMargin: usdt,
      stopLossPrice: stopLossPrice ?? null,
      takeProfitPrice: takeProfitPrice ?? null,
    };
  }

  // === 실제 주문 path ===
  try {
    await changeMarginType({ apiKey, apiSecret, symbol, marginType, testnet });
  } catch (e) {
    if (e?.data?.code !== -4046) console.warn(`[executeOrderPlan] marginType:`, e?.data?.msg || e?.message);
  }
  try {
    await changeLeverage({ apiKey, apiSecret, symbol, leverage, testnet });
  } catch (e) {
    throw Object.assign(new Error(`레버리지 ${leverage}x 설정 실패: ${e?.data?.msg || e?.message}`), { code: "LEVERAGE_FAIL" });
  }

  const entrySide = side === "LONG" ? "BUY" : "SELL";
  const entryParams = {
    symbol, side: entrySide, type: "MARKET", quantity: qty,
    newOrderRespType: "RESULT",
  };
  if (clientOrderId) entryParams.newClientOrderId = clientOrderId;
  const entryResp = await placeOrder({ apiKey, apiSecret, params: entryParams, testnet });

  // === SL/TP 예약 (원자성 강화: retry + fallback close) ===
  // ★ Critical #1 ★
  //   진입은 체결됐는데 bracket 이 안 걸리면 "벌거벗은 포지션" 이 남아서 재앙.
  //   전략: SL 을 반드시 먼저 3회 재시도 → 실패 시 즉시 시장가로 포지션 강제 청산.
  //   SL 성공 후 TP 는 best-effort (TP 실패는 손실 무제한이 아니므로 close 까진 안 함).
  const bracketResults = { sl: null, tp: null };
  const closeSide = side === "LONG" ? "SELL" : "BUY";
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function tryStopOrder(params, label, attempts = 3) {
    let lastErr;
    for (let i = 0; i < attempts; i++) {
      try {
        const r = await placeStopOrder(params);
        return { ok: true, orderId: r.orderId, attempts: i + 1 };
      } catch (e) {
        lastErr = e;
        const msg = e?.data?.msg || e?.message || String(e);
        console.warn(`[executeOrderPlan] ${label} attempt ${i + 1} failed: ${msg}`);
        if (i < attempts - 1) await sleep(300 * (i + 1));
      }
    }
    return { ok: false, error: lastErr?.data?.msg || lastErr?.message || "unknown" };
  }

  let bracketRescue = null;
  // ★ 2026-05-08: Rescue 모드 환경변수로 제어 가능하게 변경.
  //   이전 default=force_close 가 SL attach 실패 시 즉시 시장가 청산 → 봇이
  //   진입 0.03초 만에 종료되는 사고 발생 (AAVE 케이스). 원인 미파악 상태에서
  //   rescue 가 너무 공격적이라 손실 확정.
  //   현재 default=quantity_fallback — closePosition=true 실패 시 quantity+
  //   reduceOnly 로 한 번 더 시도. 여전히 실패하면 alert 만 (즉시 청산 X).
  //   ZEPTA_BRACKET_RESCUE_MODE = "force_close" | "quantity_fallback" | "alert_only"
  const rescueMode = process.env.ZEPTA_BRACKET_RESCUE_MODE || "quantity_fallback";

  // ★ 진입 직후 mark price stabilize 시간 (300ms). binance 가 진입 직후의
  //   mark price 일시 swing 으로 STOP_MARKET 을 "would immediately trigger"
  //   reject 하는 케이스 방지.
  if (stopLossPrice || takeProfitPrice) {
    await sleep(300);
  }

  if (stopLossPrice && Number.isFinite(stopLossPrice)) {
    let slRes = await tryStopOrder({
      apiKey, apiSecret, symbol, type: "STOP_MARKET", side: closeSide,
      stopPrice: stopLossPrice, closePosition: true, testnet,
      clientOrderId: clientOrderId ? `${clientOrderId}-SL` : undefined,
    }, "SL");
    bracketResults.sl = slRes;

    // ★ Fallback: closePosition=true 실패 시 quantity+reduceOnly 로 재시도.
    //   Binance Hedge Mode 에서 closePosition=true 가 reject 되는 케이스 대응.
    if (!slRes.ok && rescueMode !== "force_close" && rescueMode !== "alert_only") {
      console.warn(`[executeOrderPlan] SL closePosition=true failed → trying quantity+reduceOnly`);
      const slRes2 = await tryStopOrder({
        apiKey, apiSecret, symbol, type: "STOP_MARKET", side: closeSide,
        stopPrice: stopLossPrice, quantity: qty, testnet,
        clientOrderId: clientOrderId ? `${clientOrderId}-SL2` : undefined,
      }, "SL-fallback");
      if (slRes2.ok) {
        bracketResults.sl = slRes2;
        bracketResults.slMode = "quantity_fallback";
        slRes = slRes2;
      } else {
        bracketResults.slFallbackError = slRes2.error;
      }
    }

    if (!slRes.ok) {
      // 두 시도 모두 실패. rescueMode 에 따라 분기.
      const errMsg = bracketResults.slFallbackError || slRes.error || "unknown";
      console.error(`[executeOrderPlan] SL attach FAILED (mode=${rescueMode}): ${errMsg}`);
      if (rescueMode === "force_close") {
        // 옛 동작 — 위험. 명시적으로 켤 때만 사용.
        try {
          const rescueResp = await placeOrder({
            apiKey, apiSecret, testnet,
            params: {
              symbol, side: closeSide, type: "MARKET", quantity: qty,
              reduceOnly: true, newOrderRespType: "RESULT",
              newClientOrderId: clientOrderId ? `${clientOrderId}-RESCUE` : undefined,
            },
          });
          bracketRescue = { ok: true, orderId: rescueResp.orderId, reason: "SL attach failed, force-closed (legacy)", slError: errMsg };
        } catch (e) {
          bracketRescue = { ok: false, error: e?.data?.msg || e?.message, critical: true, slError: errMsg };
        }
      } else {
        // alert_only 또는 quantity_fallback 둘 다 실패한 경우.
        // 포지션은 유지 + position-monitor 가 plan KV 기반 시간손절/트레일링으로
        // 보호. SL 누락 사실을 명확히 노출해 사용자가 binance UI 에서 직접
        // SL 추가 가능.
        bracketRescue = {
          ok: false,
          critical: true,
          reason: "SL attach failed — position held without binance bracket. Position-monitor still tracks via plan KV.",
          slError: errMsg,
          rescueMode,
          warning: "binance UI 에서 직접 SL 추가 권장 (안전).",
        };
      }
    }
  }

  // TP 는 SL 이 있는 상태에서만, 실패해도 RESCUE 안 함 (SL 이 이미 하방을 지킴)
  if (takeProfitPrice && Number.isFinite(takeProfitPrice) && bracketResults.sl?.ok) {
    const tpRes = await tryStopOrder({
      apiKey, apiSecret, symbol, type: "TAKE_PROFIT_MARKET", side: closeSide,
      stopPrice: takeProfitPrice, closePosition: true, testnet,
      clientOrderId: clientOrderId ? `${clientOrderId}-TP` : undefined,
    }, "TP");
    bracketResults.tp = tpRes;
  }

  // 로그
  try {
    const kvModule = await import("@vercel/kv");
    const kv = kvModule.kv;
    const logKey = `di:real:user:${userId}:orders`;
    const existing = (await kv.get(logKey)) || [];
    existing.unshift({
      time: new Date().toISOString(),
      symbol, side, qty, leverage, marginType, price,
      orderId: entryResp.orderId,
      clientOrderId: entryResp.clientOrderId,
      executedQty: parseFloat(entryResp.executedQty || 0),
      avgPrice: parseFloat(entryResp.avgPrice || 0),
      status: entryResp.status,
      bracket: bracketResults,
      bracketRescue,
      bracketMode: !!(stopLossPrice || takeProfitPrice),
    });
    await kv.set(logKey, existing.slice(0, 500));
  } catch (e) {
    console.warn("[executeOrderPlan] log 실패:", e?.message);
  }

  return {
    ok: true,
    symbol, side, leverage, marginType,
    orderId: entryResp.orderId,
    clientOrderId: entryResp.clientOrderId,
    type: entryResp.type,
    status: entryResp.status,
    executedQty: parseFloat(entryResp.executedQty || 0),
    avgPrice: parseFloat(entryResp.avgPrice || 0),
    cumQuote: parseFloat(entryResp.cumQuote || 0),
    qtyRequested: qty,
    priceAtRequest: price,
    notional,
    bracket: bracketResults,
    bracketRescue,
    raw: entryResp,
  };
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
