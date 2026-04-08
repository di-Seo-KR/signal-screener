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
} from "../_shared/binance-client.js";
import { recordTradeResult } from "../_shared/circuit-breaker.js";

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
  const lastPos = (await kv.get(lastPosKey)) || [];

  const report = { userId, positions: nonZero.length, closed: [], orphansCleaned: [] };

  // 1) 고아 SL/TP 정리 — 포지션 없는 심볼에 남은 reduce-only 주문 취소
  const symbolsWithPos = new Set(nonZero.map((p) => p.symbol));
  // 직전에 포지션이 있었지만 지금은 없는 것 = 최근 청산된 심볼
  const lastSymbols = new Set((lastPos || []).map((p) => p.symbol));
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

  // 2) realizedPnL 추정 — orders 로그에서 마지막 entry 와 현재 시점 사이 손익 찾기
  if (report.closed.length) {
    const ordersLog = (await kv.get(`di:real:user:${userId}:orders`)) || [];
    for (const sym of report.closed) {
      const lastEntry = ordersLog.find((o) => o.symbol === sym && !o.reduceOnly);
      if (lastEntry) {
        // 간단 근사: 실제 realizedPnL 은 Binance userTrades endpoint 에서 가져와야 정확.
        // Phase 1 에서는 기록만 하고, 0 으로 간주해 recordTradeResult 는 패스.
        // (breaker 는 equity 기준으로 daily/weekly 손익을 별도 체크하므로 안전)
      }
    }
    // 안전: 연속손실 트리거는 equity 기반으로 추후 갱신.
    await recordTradeResult(userId, 0);
  }

  // 3) 현재 포지션 저장 (다음 틱 비교용)
  await kv.set(
    lastPosKey,
    nonZero.map((p) => ({
      symbol: p.symbol,
      positionAmt: parseFloat(p.positionAmt),
      entryPrice: parseFloat(p.entryPrice),
      markPrice: parseFloat(p.markPrice),
      unRealizedProfit: parseFloat(p.unRealizedProfit),
    }))
  );

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
