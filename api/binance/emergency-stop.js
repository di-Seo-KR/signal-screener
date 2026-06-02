// POST /api/binance/emergency-stop
// 🚨 비상 정지: 모든 오픈 주문 취소 + 모든 포지션 즉시 청산 + 실전 트랙 비활성화.
// UI의 "긴급 정지" 버튼이 호출.
//
// body: { userId, reason? }

import { loadUserCredentials, respondError } from "../_shared/binance-auth.js";
import {
  getPositionRisk,
  cancelAllOpenOrders,
  placeOrder,
  getExchangeInfo,
} from "../_shared/binance-client.js";

let _xiCache = null;
let _xiAt = 0;
async function getXI(testnet) {
  const now = Date.now();
  if (!_xiCache || now - _xiAt > 5 * 60 * 1000) {
    _xiCache = await getExchangeInfo({ testnet });
    _xiAt = now;
  }
  return _xiCache;
}
function symbolPrecision(xi, symbol) {
  const s = (xi.symbols || []).find(x => x.symbol === symbol);
  if (!s) return { quantityPrecision: 3, stepSize: 0 };
  const lot = s.filters.find(f => f.filterType === "LOT_SIZE") || {};
  return {
    quantityPrecision: s.quantityPrecision,
    stepSize: parseFloat(lot.stepSize || 0),
  };
}
function floorToStep(qty, step) {
  if (!step) return qty;
  return Math.floor(qty / step) * step;
}
function round(x, p) {
  const f = Math.pow(10, p || 0);
  return Math.floor(x * f) / f;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const startedAt = Date.now();
  const actions = [];
  const errors = [];

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const { userId, reason = "user_triggered" } = body;
    if (!userId) return res.status(400).json({ error: "userId required" });

    const { apiKey, apiSecret, testnet } = await loadUserCredentials(userId, req);

    // === 1) 전 심볼 오픈 포지션 조회 ===
    const risks = await getPositionRisk({ apiKey, apiSecret, testnet });
    const openPositions = (risks || []).filter(p => parseFloat(p.positionAmt || 0) !== 0);
    actions.push({ step: "fetch_positions", count: openPositions.length });

    // === 2) 오픈 주문 취소 (심볼별) ===
    const symbols = [...new Set(openPositions.map(p => p.symbol))];
    for (const sym of symbols) {
      try {
        await cancelAllOpenOrders({ apiKey, apiSecret, symbol: sym, testnet });
        actions.push({ step: "cancel_orders", symbol: sym, ok: true });
      } catch (e) {
        errors.push({ step: "cancel_orders", symbol: sym, error: e?.data?.msg || e?.message });
      }
    }

    // === 3) 포지션 청산 (MARKET reduceOnly) ===
    const xi = await getXI(testnet);
    for (const p of openPositions) {
      try {
        const amt = parseFloat(p.positionAmt);
        const isLong = amt > 0;
        const { quantityPrecision, stepSize } = symbolPrecision(xi, p.symbol);
        const qty = round(floorToStep(Math.abs(amt), stepSize), quantityPrecision);
        if (qty <= 0) {
          errors.push({ step: "close", symbol: p.symbol, error: "qty<=0" });
          continue;
        }
        const resp = await placeOrder({
          apiKey, apiSecret, testnet,
          params: {
            symbol: p.symbol,
            side: isLong ? "SELL" : "BUY",
            type: "MARKET",
            quantity: qty,
            reduceOnly: "true",
            newOrderRespType: "RESULT",
          },
        });
        actions.push({
          step: "close",
          symbol: p.symbol,
          side: isLong ? "LONG" : "SHORT",
          qty,
          orderId: resp.orderId,
          avgPrice: parseFloat(resp.avgPrice || 0),
        });
      } catch (e) {
        errors.push({ step: "close", symbol: p.symbol, error: e?.data?.msg || e?.message });
      }
    }

    // === 4) 실전 트랙 비활성화 + 모든 실전 봇 중지 마킹 ===
    try {
      const kvModule = await import("@vercel/kv");
      const kv = kvModule.kv;
      await kv.set(`di:real:user:${userId}:enabled`, false);

      const botsKey = `di:real:user:${userId}:bots`;
      const bots = (await kv.get(botsKey)) || [];
      if (Array.isArray(bots)) {
        const stopped = bots.map(b => ({ ...b, status: "stopped", stoppedReason: "emergency_stop", stoppedAt: new Date().toISOString() }));
        await kv.set(botsKey, stopped);
      }

      // 긴급정지 로그 보존
      const logKey = `di:real:user:${userId}:emergency_log`;
      const existing = (await kv.get(logKey)) || [];
      existing.unshift({
        at: new Date().toISOString(),
        reason,
        closedCount: openPositions.length,
        actions,
        errors,
        durationMs: Date.now() - startedAt,
      });
      await kv.set(logKey, existing.slice(0, 50));
      actions.push({ step: "disable_real_track", ok: true });
    } catch (e) {
      errors.push({ step: "kv_update", error: e?.message });
    }

    return res.status(200).json({
      ok: errors.length === 0,
      closedPositions: actions.filter(a => a.step === "close").length,
      canceledSymbols: actions.filter(a => a.step === "cancel_orders" && a.ok).length,
      durationMs: Date.now() - startedAt,
      actions,
      errors,
    });
  } catch (err) {
    return respondError(res, err);
  }
}
