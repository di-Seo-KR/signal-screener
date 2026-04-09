// api/real-trading/position-monitor.js
//
// 실전 포지션 + Bracket(SL/TP) 상태를 주기적으로 확인.
// 부분 체결/고아 SL/TP 주문을 감지하고, 포지션 청산이 확인되면
// circuit-breaker 에 realizedPnL 을 기록.
//
// 역할 정리:
//  1) getPositionRisk → 현재 포지션
//  2) getOpenOrders → 남아있는 SL/TP 주문
//  3) 포지션이 0 인데 SL/TP 가 살아있으면 cancelAllOpenOrders (고아 정리)
//  4) 포지션이 0 되었고 직전 engine-log 에 해당 심볼이 있으면
//     대략적인 realizedPnL 을 orders 로그에서 찾아 breaker.recordTradeResult 호출

import { loadUserCredentials, respondError } from "../_shared/binance-auth.js";
import {
  getPositionRisk,
  getOpenOrders,
  cancelAllOpenOrders,
  cancelOrder,
  placeStopOrder,
  placeOrder,
  getUserTrades,
} from "../_shared/binance-client.js";
import { recordTradeResult } from "../_shared/circuit-breaker.js";
import {
  evaluateTimeStop,
  evaluateTrailingStop,
  RISK_CONFIG,
} from "../_shared/risk-manager.js";
import { getSymbolFilter } from "../_shared/exchange-info.js";

export const config = { maxDuration: 60 };

async function getKv() {
  return (await import("@vercel/kv")).kv;
}

async function checkUser(userId) {
  const creds = await loadUserCredentials(userId);
  const positions = await getPositionRisk({ ...creds });
  const nonZero = (positions || []).filter((p) => Math.abs(parseFloat(p.positionAmt || 0)) > 0);

  const kv = await getKv();
  const lastPosKey = `di:real:user:${userId}:last-positions`;
  const lastPosRaw = (await kv.get(lastPosKey)) || {};
  // 레거시 array 형태 호환
  const lastPos = Array.isArray(lastPosRaw)
    ? Object.fromEntries(lastPosRaw.map((p) => [p.symbol, p]))
    : lastPosRaw;

  const report = { userId, positions: nonZero.length, closed: [], orphansCleaned: [] };

  // 1) 고아 SL/TP 정리 — 포지션 없는 심볼에 남은 reduce-only 주문 취소
  const symbolsWithPos = new Set(nonZero.map((p) => p.symbol));
  // 직전에 포지션이 있었지만 지금은 없는 것 = 최근 청산된 심볼
  const lastSymbols = new Set(Object.keys(lastPos));
  for (const sym of lastSymbols) {
    if (!symbolsWithPos.has(sym)) {
      // 고아 주문 확인 후 취소
      try {
        const open = await getOpenOrders({ ...creds, symbol: sym });
        if (Array.isArray(open) && open.length > 0) {
          await cancelAllOpenOrders({ ...creds, symbol: sym });
          report.orphansCleaned.push({ sym, cancelled: open.length });
        }
      } catch (e) {
        report.orphansCleaned.push({ sym, error: e?.message });
      }
      report.closed.push(sym);
    }
  }

  // 2) realizedPnL 계산 — userTrades 에서 최근 청산 트레이드의 realizedPnl 합산
  if (report.closed.length) {
    const lookbackMs = 10 * 60 * 1000; // 최근 10분
    const startTime = Date.now() - lookbackMs;
    for (const sym of report.closed) {
      try {
        const trades = await getUserTrades({ ...creds, symbol: sym, startTime, limit: 50 });
        const realized = (trades || []).reduce((s, t) => s + parseFloat(t.realizedPnl || 0), 0);
        if (Number.isFinite(realized) && realized !== 0) {
          await recordTradeResult(userId, realized);
          // 청산 로그에 반영
          const logKey = `di:real:user:${userId}:engine-log`;
          const log = (await kv.get(logKey)) || [];
          log.unshift({
            time: new Date().toISOString(),
            event: "position_closed",
            symbol: sym,
            realizedPnL: Number(realized.toFixed(4)),
          });
          await kv.set(logKey, log.slice(0, 200));
          report.closed = report.closed.map((c) => (c === sym ? { sym, realizedPnL: realized } : c));
        }
      } catch (e) {
        console.warn(`[monitor] userTrades ${sym} failed:`, e?.message);
      }
    }
  }

  // 3) ── 트레일링 스탑 + 시간 손절 평가 ──
  // engine 이 진입할 때 plan(slPct, openedAt 등)을 di:real:user:{uid}:plan:{symbol} 에 저장.
  // 여기서 그 plan 을 읽어 trailing/timeStop 판정.
  report.timeStopped = [];
  report.trailed = [];
  for (const p of nonZero) {
    const sym = p.symbol;
    const planKey = `di:real:user:${userId}:plan:${sym}`;
    const plan = await kv.get(planKey);
    if (!plan || !plan.openedAt || !plan.slPct) continue;

    const side = parseFloat(p.positionAmt) > 0 ? "LONG" : "SHORT";
    const entryPrice = parseFloat(p.entryPrice);
    const markPrice = parseFloat(p.markPrice);

    // ── highWater 갱신 (LONG=max, SHORT=min) ──
    const prevHW = plan.highWater || markPrice;
    const newHW = side === "LONG" ? Math.max(prevHW, markPrice) : Math.min(prevHW, markPrice);
    if (newHW !== prevHW) {
      plan.highWater = newHW;
      await kv.set(planKey, plan);
    }

    // ── (a) 시간 손절 ──
    const ts = evaluateTimeStop({
      openedAt: plan.openedAt,
      entryPrice,
      markPrice,
      side,
      slPct: plan.slPct,
      cfg: RISK_CONFIG,
    });
    if (ts.shouldClose) {
      try {
        // bracket 취소 후 시장가 청산
        await cancelAllOpenOrders({ ...creds, symbol: sym });
        const closeQty = Math.abs(parseFloat(p.positionAmt));
        await placeOrder({
          ...creds,
          params: {
            symbol: sym,
            side: side === "LONG" ? "SELL" : "BUY",
            type: "MARKET",
            quantity: closeQty,
            reduceOnly: "true",
            newOrderRespType: "RESULT",
          },
        });
        report.timeStopped.push({ sym, reason: ts.reason, currentR: ts.currentR });
        // 엔진 로그
        const logKey = `di:real:user:${userId}:engine-log`;
        const log = (await kv.get(logKey)) || [];
        log.unshift({
          time: new Date().toISOString(),
          event: "time_stop",
          symbol: sym,
          reason: ts.reason,
        });
        await kv.set(logKey, log.slice(0, 200));
        // 다음 단계 평가 skip
        continue;
      } catch (e) {
        report.timeStopped.push({ sym, error: e?.message });
      }
    }

    // ── (b) 트레일링 SL ──
    // 현재 active SL 주문 찾아서 stopPrice 비교
    let currentSlPrice = plan.currentSlPrice || plan.slPrice;
    const trail = evaluateTrailingStop({
      entryPrice,
      markPrice,
      side,
      slPct: plan.slPct,
      currentSlPrice,
      highWater: newHW,
      cfg: RISK_CONFIG,
    });
    if (trail.shouldUpdate && trail.newSlPrice) {
      try {
        // tickSize 라운딩
        const filter = await getSymbolFilter(sym).catch(() => null);
        const tick = filter?.tickSize || 0;
        const pricePrec = filter?.pricePrecision ?? 2;
        let newSL = trail.newSlPrice;
        if (tick > 0) newSL = Math.round(newSL / tick) * tick;
        newSL = Number(newSL.toFixed(pricePrec));

        // 기존 SL 주문(STOP_MARKET, reduceOnly) 찾기
        const opens = await getOpenOrders({ ...creds, symbol: sym });
        const oldSlOrders = (opens || []).filter((o) =>
          (o.type === "STOP_MARKET" || o.type === "STOP") && (o.reduceOnly || o.closePosition)
        );
        for (const o of oldSlOrders) {
          await cancelOrder({ ...creds, symbol: sym, orderId: o.orderId });
        }
        // 새 SL placement
        const closeQty = Math.abs(parseFloat(p.positionAmt));
        await placeStopOrder({
          ...creds,
          symbol: sym,
          type: "STOP_MARKET",
          side: side === "LONG" ? "SELL" : "BUY",
          stopPrice: newSL,
          quantity: closeQty,
          clientOrderId: `trail-${Date.now()}-${sym}`,
        });
        plan.currentSlPrice = newSL;
        await kv.set(planKey, plan);
        report.trailed.push({ sym, newSL, reason: trail.reason, currentR: trail.currentR });

        const logKey = `di:real:user:${userId}:engine-log`;
        const log = (await kv.get(logKey)) || [];
        log.unshift({
          time: new Date().toISOString(),
          event: "trailing_stop",
          symbol: sym,
          newSL,
          reason: trail.reason,
        });
        await kv.set(logKey, log.slice(0, 200));
      } catch (e) {
        report.trailed.push({ sym, error: e?.message });
      }
    }
  }

  // 4) 현재 포지션 저장 (symbol → info 맵 형태, reconcile.js 와 공유)
  const nextMap = {};
  for (const p of nonZero) {
    nextMap[p.symbol] = {
      symbol: p.symbol,
      positionAmt: parseFloat(p.positionAmt),
      entryPrice: parseFloat(p.entryPrice),
      markPrice: parseFloat(p.markPrice),
      unRealizedProfit: parseFloat(p.unRealizedProfit),
      leverage: parseInt(p.leverage || "0", 10),
    };
  }
  await kv.set(lastPosKey, nextMap);

  return report;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  try {
    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
      const { userId } = body;
      if (!userId) return res.status(400).json({ error: "userId required" });
      const out = await checkUser(userId);
      return res.status(200).json({ ok: true, ...out });
    }
    const kv = await getKv();
    const users = (await kv.get("di:real:phase1-users")) || [];
    const results = [];
    for (const uid of users.slice(0, 10)) {
      try {
        results.push(await checkUser(uid));
      } catch (e) {
        results.push({ userId: uid, error: e?.message });
      }
    }
    return res.status(200).json({ ok: true, count: results.length, results });
  } catch (err) {
    return respondError(res, err);
  }
}
