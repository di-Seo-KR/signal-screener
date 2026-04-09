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
  const equityKey = `di:real:user:${userId}:shadow-equity`;
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

    // ── MFE / MAE 트래킹 (best/worst 가격) ──
    e.mfePrice = side === "LONG"
      ? Math.max(e.mfePrice || mark, mark)
      : Math.min(e.mfePrice || mark, mark);
    e.maePrice = side === "LONG"
      ? Math.min(e.maePrice || mark, mark)
      : Math.max(e.maePrice || mark, mark);

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
      const holdMs = now - openedAt;
      e.status = "CLOSED";
      e.closedAt = new Date(now).toISOString();
      e.closeReason = close.closeReason;
      e.exitPrice = close.exitPrice;
      e.grossPct = close.grossPct;
      e.netPct = netPct;
      e.netPnL = netPnL;
      e.holdMs = holdMs;
      // R 단위 결과
      const riskAmt = e.plan?.riskAmount || 0;
      e.rMultiple = riskAmt > 0 ? netPnL / riskAmt : 0;
      // MFE/MAE 를 R 로 변환
      if (riskAmt > 0 && e.plan?.notional) {
        const mfePct = side === "LONG"
          ? ((e.mfePrice || entry) - entry) / entry
          : (entry - (e.mfePrice || entry)) / entry;
        const maePct = side === "LONG"
          ? ((e.maePrice || entry) - entry) / entry
          : (entry - (e.maePrice || entry)) / entry;
        e.mfeR = (mfePct * e.plan.notional) / riskAmt;
        e.maeR = (maePct * e.plan.notional) / riskAmt;
      }
      closed.push(e);
    }
  }

  if (closed.length) {
    await kv.set(ledgerKey, ledger.slice(0, 500));
    // ── 풍부한 summary 업데이트 ──
    const sum = (await kv.get(summaryKey)) || {
      wins: 0, losses: 0, netPnL: 0, trades: 0, totalRR: 0,
      bestR: 0, worstR: 0, totalHoldMs: 0,
      byFamily: {}, byCloseReason: { TP: 0, SL: 0, TIME: 0 },
      grossWin: 0, grossLoss: 0,
    };
    // 신규 필드 backfill
    sum.byFamily = sum.byFamily || {};
    sum.byCloseReason = sum.byCloseReason || { TP: 0, SL: 0, TIME: 0 };
    sum.totalHoldMs = sum.totalHoldMs || 0;
    sum.bestR = sum.bestR || 0;
    sum.worstR = sum.worstR || 0;
    sum.grossWin = sum.grossWin || 0;
    sum.grossLoss = sum.grossLoss || 0;

    for (const c of closed) {
      sum.trades += 1;
      sum.netPnL += c.netPnL || 0;
      sum.totalHoldMs += c.holdMs || 0;
      if ((c.netPnL || 0) > 0) {
        sum.wins += 1;
        sum.grossWin += c.netPnL || 0;
      } else {
        sum.losses += 1;
        sum.grossLoss += Math.abs(c.netPnL || 0);
      }
      if ((c.rMultiple || 0) > sum.bestR) sum.bestR = c.rMultiple;
      if ((c.rMultiple || 0) < sum.worstR) sum.worstR = c.rMultiple;
      sum.totalRR += c.rMultiple || 0;
      sum.byCloseReason[c.closeReason] = (sum.byCloseReason[c.closeReason] || 0) + 1;
      const fam = c.plan?.strategyFamily || "unknown";
      sum.byFamily[fam] = sum.byFamily[fam] || { trades: 0, wins: 0, netPnL: 0 };
      sum.byFamily[fam].trades += 1;
      sum.byFamily[fam].netPnL += c.netPnL || 0;
      if ((c.netPnL || 0) > 0) sum.byFamily[fam].wins += 1;
    }
    sum.profitFactor = sum.grossLoss > 0 ? sum.grossWin / sum.grossLoss : null;
    sum.avgHoldHours = sum.trades > 0 ? sum.totalHoldMs / sum.trades / 3600000 : 0;
    sum.avgR = sum.trades > 0 ? sum.totalRR / sum.trades : 0;
    sum.winRate = sum.trades > 0 ? sum.wins / sum.trades : 0;
    sum.updatedAt = new Date().toISOString();
    await kv.set(summaryKey, sum);

    // ── equity curve append ──
    const curve = (await kv.get(equityKey)) || [];
    curve.push({
      t: now,
      cum: sum.netPnL,
      trades: sum.trades,
    });
    // 최근 1000 포인트만
    await kv.set(equityKey, curve.slice(-1000));
  }

  return {
    userId,
    scanned: ledger.length,
    closed: closed.length,
    closedReasons: closed.map((c) => c.closeReason),
  };
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
    // GLOBAL_PROBE_USER 를 항상 포함시켜 대표님 조작 없이도 자동 평가
    const GLOBAL_PROBE_USER = "__zepta_global_probe__";
    const users = (await kv.get("di:real:shadow-users")) || (await kv.get("di:real:phase1-users")) || [];
    if (!users.includes(GLOBAL_PROBE_USER)) users.unshift(GLOBAL_PROBE_USER);
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
