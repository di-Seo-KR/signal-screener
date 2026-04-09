// api/real-trading/shadow-monitor.js
//
// Shadow mode 포지션 모니터.
// shadow-ledger 에 기록된 OPEN 항목을 돌면서 현재가로 SL/TP 히트 또는 time-stop 판정.
// 가상 실현 손익(수수료·슬리피지 차감 후)을 기록.
//
// KV:
//  di:real:user:<uid>:shadow-ledger  → [{ id, openedAt, status, signal, plan, entryPrice, feeBps, slippageBps, closedAt?, closeReason?, netPnL? }]
//  di:real:user:<uid>:shadow-summary → { wins, losses, netPnL, totalRR, trades, updatedAt }
//
// cron: */5 분

import { getTickerPrice } from "../_shared/binance-client.js";
import { respondError } from "../_shared/binance-auth.js";

export const config = { maxDuration: 60 };

async function getKv() {
  const mod = await import("@vercel/kv");
  return mod.kv;
}

function hitLong(entry, markPrice, sl, tp) {
  if (markPrice <= sl) return "SL";
  if (markPrice >= tp) return "TP";
  return null;
}
function hitShort(entry, markPrice, sl, tp) {
  if (markPrice >= sl) return "SL";
  if (markPrice <= tp) return "TP";
  return null;
}

async function tickFor(symbol) {
  try {
    const r = await getTickerPrice({ symbol });
    return parseFloat(r.price);
  } catch {
    return null;
  }
}

async function monitorUser(userId) {
  const kv = await getKv();
  const ledgerKey = `di:real:user:${userId}:shadow-ledger`;
  const summaryKey = `di:real:user:${userId}:shadow-summary`;
  const ledger = (await kv.get(ledgerKey)) || [];
  if (!ledger.length) return { userId, scanned: 0, closed: 0 };

  const now = Date.now();
  const closed = [];
  const symbolPrice = {};

  for (const e of ledger) {
    if (e.status !== "OPEN") continue;
    const sym = e.plan?.symbol;
    if (!sym) continue;
    if (!(sym in symbolPrice)) symbolPrice[sym] = await tickFor(sym);
    const mark = symbolPrice[sym];
    if (!mark || !Number.isFinite(mark)) continue;

    const side = e.plan.side;
    const sl = e.plan.slPrice;
    const tp = e.plan.tpPrice;
    const entry = e.entryPrice;
    const hit = side === "LONG" ? hitLong(entry, mark, sl, tp) : hitShort(entry, mark, sl, tp);

    const openedAt = new Date(e.openedAt || now).getTime();
    const tooOld = now - openedAt > (e.plan.maxHoldMs || 48 * 60 * 60 * 1000);

    let close = null;
    if (hit === "TP") {
      close = {
        closeReason: "TP",
        exitPrice: tp,
        grossPct: side === "LONG" ? (tp - entry) / entry : (entry - tp) / entry,
      };
    } else if (hit === "SL") {
      close = {
        closeReason: "SL",
        exitPrice: sl,
        grossPct: side === "LONG" ? (sl - entry) / entry : (entry - sl) / entry,
      };
    } else if (tooOld) {
      close = {
        closeReason: "TIME",
        exitPrice: mark,
        grossPct: side === "LONG" ? (mark - entry) / entry : (entry - mark) / entry,
      };
    }
    if (close) {
      const costPct = ((e.feeBps || 8) + (e.slippageBps || 5)) / 10000;
      const netPct = close.grossPct - costPct;
      const netPnL = (e.plan.notional || 0) * netPct;
      e.status = "CLOSED";
      e.closedAt = new Date(now).toISOString();
      e.closeReason = close.closeReason;
      e.exitPrice = close.exitPrice;
      e.grossPct = close.grossPct;
      e.netPct = netPct;
      e.netPnL = netPnL;
      closed.push(e);
    }
  }

  if (closed.length) {
    await kv.set(ledgerKey, ledger.slice(0, 500));
    // summary 업데이트
    const sum = (await kv.get(summaryKey)) || { wins: 0, losses: 0, netPnL: 0, trades: 0, totalRR: 0 };
    for (const c of closed) {
      sum.trades += 1;
      sum.netPnL += c.netPnL || 0;
      if ((c.netPnL || 0) > 0) sum.wins += 1;
      else sum.losses += 1;
      const riskAmt = c.plan?.riskAmount || 0;
      if (riskAmt > 0) sum.totalRR += (c.netPnL || 0) / riskAmt;
    }
    sum.updatedAt = new Date().toISOString();
    await kv.set(summaryKey, sum);
  }

  return { userId, scanned: ledger.length, closed: closed.length };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  try {
    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
      const { userId } = body;
      if (!userId) return res.status(400).json({ error: "userId required" });
      return res.status(200).json(await monitorUser(userId));
    }
    const kv = await getKv();
    // shadow 모드는 phase1 enroll 없어도 돈다 — 별도 리스트
    const users = (await kv.get("di:real:shadow-users")) || (await kv.get("di:real:phase1-users")) || [];
    const results = [];
    for (const uid of users.slice(0, 20)) {
      try { results.push(await monitorUser(uid)); }
      catch (e) { results.push({ userId: uid, error: e?.message }); }
    }
    return res.status(200).json({ ok: true, results });
  } catch (err) {
    return respondError(res, err);
  }
}
