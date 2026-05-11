// ════════════════════════════════════════════════════════════════════
// Zepta — Bot Report API
// ────────────────────────────────────────────────────────────────────
// GET /api/bot-report
//   ?botId=stable-quant            (필수 — 빠지면 전체 봇 목록 메타만 반환)
//
// 응답:
//   {
//     ok, botId, meta:{kind,family,assets},
//     cumulative:{returnPct,sharpe,mdd,profitFactor,winRate,tradeCount,avgHoldDays,realizedPL},
//     equityCurve:[{date,equity,equityPct}],  // 최근 30영업일
//     recentTrades:[{time,asset,type,amount,pnl?,reason?}],  // 최근 10건
//     generatedAt
//   }
//
// 비로그인 사용자 접근 가능 (SEO friendly). KV 가 비어도 graceful 응답.
// ════════════════════════════════════════════════════════════════════

import { BOT_REGISTRY } from "./agents/leaderboard.js";

async function getKv() {
  return (await import("@vercel/kv")).kv;
}

// bot-performance.js 와 동일 — KST 일별 그룹 + 합리 범위 필터
function buildEquityCurve(history, alloc, maxDays = 30) {
  if (!Array.isArray(history) || history.length < 2 || !(alloc > 0)) return [];
  const KST_MS = 9 * 3600000;
  const dayMap = new Map();
  for (const h of history) {
    const eq = Number(h?.equity);
    if (!(eq > 0)) continue;
    if (eq > alloc * 3 || eq < alloc * 0.1) continue;
    const t = Date.parse(h?.time || "");
    if (!Number.isFinite(t)) continue;
    const k = new Date(t + KST_MS);
    const key = `${k.getUTCFullYear()}-${String(k.getUTCMonth() + 1).padStart(2,"0")}-${String(k.getUTCDate()).padStart(2,"0")}`;
    dayMap.set(key, eq);
  }
  const daily = Array.from(dayMap.entries()).sort(([a],[b]) => a.localeCompare(b)).slice(-maxDays);
  return daily.map(([date, equity]) => ({
    date,
    equity: Number(equity.toFixed(2)),
    equityPct: Number(((equity / alloc) * 100).toFixed(2)),
  }));
}

function cumulativeMetrics(perf, snap, equityCurve) {
  const tradeCount = perf?.tradeCount || (perf?.trades?.length ?? 0) || 0;
  const closedCount = perf?.closedCount || 0;
  const winCount = perf?.winCount || 0;
  const winRate = closedCount > 0 ? (winCount / closedCount) * 100 : 0;
  const grossWin = Number(perf?.grossWin || 0);
  const grossLoss = Number(perf?.grossLoss || 0);
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? null : 0);
  const realizedPL = Number(perf?.realizedPL || 0);
  const mdd = Number(snap?.mdd || 0);
  const alloc = Number(snap?.botAllocation || 0);
  const botEquity = Number(snap?.botEquity || 0);
  const returnPct = alloc > 0 && botEquity > 0 ? ((botEquity - alloc) / alloc) * 100 : 0;

  // Sharpe 추정 (equityCurve 의 일별 변화율)
  let sharpe = 0;
  if (equityCurve.length >= 2) {
    const rets = [];
    for (let i = 1; i < equityCurve.length; i++) {
      const a = equityCurve[i - 1].equity, b = equityCurve[i].equity;
      rets.push(a > 0 ? (b - a) / a : 0);
    }
    if (rets.length >= 2) {
      const mean = rets.reduce((s,r)=>s+r,0) / rets.length;
      const variance = rets.reduce((s,r)=>s+(r-mean)**2,0) / Math.max(1, rets.length - 1);
      const std = Math.sqrt(variance);
      sharpe = std > 1e-9 ? (mean / std) * Math.sqrt(252) : 0;
    }
  }

  // 평균 보유일 — perf.trades 의 시간 간격 추정 (단순 평균)
  let avgHoldDays = 0;
  const trades = Array.isArray(perf?.trades) ? perf.trades : [];
  if (trades.length >= 2) {
    const intervals = [];
    for (let i = 1; i < trades.length; i++) {
      const a = Date.parse(trades[i - 1]?.time || "");
      const b = Date.parse(trades[i]?.time || "");
      if (Number.isFinite(a) && Number.isFinite(b)) intervals.push(Math.abs(a - b));
    }
    if (intervals.length > 0) {
      avgHoldDays = (intervals.reduce((s,x)=>s+x,0) / intervals.length) / 86400000;
    }
  }

  return {
    returnPct:    Number(returnPct.toFixed(2)),
    sharpe:       Number(sharpe.toFixed(2)),
    mdd:          Number(mdd.toFixed(2)),
    profitFactor: profitFactor == null ? null : Number(profitFactor.toFixed(2)),
    winRate:      Number(winRate.toFixed(1)),
    tradeCount,
    closedCount,
    avgHoldDays:  Number(avgHoldDays.toFixed(2)),
    realizedPL:   Number(realizedPL.toFixed(2)),
    botAllocation: alloc,
    botEquity:    botEquity || alloc,
  };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");
  try {
    const kv = await getKv();
    const botId = req.query?.botId ? String(req.query.botId) : null;

    // botId 없으면 전체 봇 메타만 반환 — /reports 목록 페이지가 사용
    if (!botId) {
      const list = Object.entries(BOT_REGISTRY).map(([id, m]) => ({
        botId: id,
        kind: m.kind,
        family: m.family,
        assets: m.assets,
      }));
      return res.status(200).json({
        ok: true,
        type: "list",
        bots: list,
        count: list.length,
      });
    }

    if (!BOT_REGISTRY[botId]) {
      return res.status(404).json({ ok: false, error: `unknown botId: ${botId}` });
    }

    const [perf, snap] = await Promise.all([
      kv.get(`di:bot:${botId}:perf`).catch(() => null),
      kv.get(`di:bot:${botId}:snapshot`).catch(() => null),
    ]);

    const meta = BOT_REGISTRY[botId];
    const alloc = Number(snap?.botAllocation || 0);
    const history = Array.isArray(snap?.history) ? snap.history : [];
    const equityCurve = buildEquityCurve(history, alloc, 30);
    const cumulative = cumulativeMetrics(perf, snap, equityCurve);
    const recentTrades = (Array.isArray(perf?.trades) ? perf.trades : []).slice(0, 10);

    return res.status(200).json({
      ok: true,
      botId,
      meta: { kind: meta.kind, family: meta.family, assets: meta.assets },
      cumulative,
      equityCurve,
      recentTrades,
      empty: !perf && !snap,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[bot-report] fatal:", err);
    return res.status(200).json({ ok: false, error: err?.message || String(err) });
  }
}
