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
  getUserTrades,
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

  // 3) 현재 포지션 저장 (symbol → info 맵 형태, reconcile.js 와 공유)
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
