// ════════════════════════════════════════════════════════════════════
// Zepta — Auto Promote / Demote (일일 cron)
// ────────────────────────────────────────────────────────────────────
// alpha-lab leaderboard 기반 strategy 자동 활성 / 비활성 결정.
//
// 규칙:
//   Promote (active):  trades >= 30  AND  Sharpe >= 1.5  AND  PF >= 1.3
//   Demote  (disabled): trades >= 20 AND  (Sharpe <= 0 OR winRate < 30%)
//   Watch:             그 외 (기본). 가중치 *0.5 정도로 보수적 운영
//
// 텔레그램: 상태 변경 시 알림 발송 (변경 없으면 무음).
//
// Cron: `30 6 * * *` (KST 15:30, US 시장 닫혀있어 안전)
// ────────────────────────────────────────────────────────────────────

import {
  setStrategyStatus,
  getStrategyStatus,
  STRATEGY_STATUS,
  DEFAULT_STRATEGY_WEIGHTS,
} from "../_shared/dynamic-config.js";
import { sendCards, buildCard } from "../_shared/telegram.js";

export const config = { maxDuration: 30 };

// 규칙 — KV override 가능
const RULES = {
  promote: { minTrades: 30, minSharpe: 1.5, minPF: 1.3 },
  demote:  { minTrades: 20, maxSharpe: 0,   minWinRate: 30 }, // OR 조건
};

async function getKv() {
  return (await import("@vercel/kv")).kv;
}

/**
 * leaderboard 의 한 strategy 메트릭으로 권고 상태 산출.
 */
function decide(metrics) {
  if (!metrics) return { next: STRATEGY_STATUS.WATCH, reason: "no data" };
  const { trades = 0, sharpe = 0, profitFactor: pf = 0, winRate = 0 } = metrics;
  if (trades >= RULES.promote.minTrades && sharpe >= RULES.promote.minSharpe && (pf || 0) >= RULES.promote.minPF) {
    return {
      next: STRATEGY_STATUS.ACTIVE,
      reason: `n=${trades}, Sharpe ${sharpe} ≥ ${RULES.promote.minSharpe}, PF ${pf} ≥ ${RULES.promote.minPF}`,
    };
  }
  if (trades >= RULES.demote.minTrades && (sharpe <= RULES.demote.maxSharpe || winRate < RULES.demote.minWinRate)) {
    const cause = sharpe <= 0 ? `Sharpe ${sharpe} ≤ 0` : `winRate ${winRate}% < 30%`;
    return {
      next: STRATEGY_STATUS.DISABLED,
      reason: `n=${trades}, ${cause}`,
    };
  }
  return { next: STRATEGY_STATUS.WATCH, reason: `n=${trades}, Sharpe ${sharpe}, PF ${pf}` };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const dryRun = req.query?.dryRun === "1" || req.query?.dryRun === "true";
  const log = [];
  const L = (m) => { log.push(m); console.log("[auto-promote]", m); };
  const t0 = Date.now();

  try {
    const kv = await getKv();
    const leaderboard = await kv.get("di:alpha:leaderboard");
    if (!leaderboard) {
      L("leaderboard not found — alpha-lab cron 이 아직 안 돌았을 수 있음");
      return res.status(200).json({ ok: false, error: "no leaderboard", log });
    }
    L(`leaderboard age: ${leaderboard.generatedAt}`);

    const changes = [];
    const noChanges = [];

    for (const strategyId of Object.keys(DEFAULT_STRATEGY_WEIGHTS)) {
      const metrics = leaderboard.strategies?.[strategyId];
      const decision = decide(metrics);
      const currentStatus = await getStrategyStatus(strategyId);
      if (decision.next === currentStatus) {
        noChanges.push({ strategyId, status: currentStatus, ...decision });
        continue;
      }
      if (!dryRun) {
        const r = await setStrategyStatus(strategyId, decision.next, decision.reason);
        L(`${strategyId}: ${currentStatus} → ${decision.next} (${decision.reason})`);
        changes.push({ strategyId, from: currentStatus, to: decision.next, reason: decision.reason, kvResult: r });
      } else {
        L(`[dryRun] ${strategyId}: ${currentStatus} → ${decision.next}`);
        changes.push({ strategyId, from: currentStatus, to: decision.next, reason: decision.reason, dryRun: true });
      }
    }

    // 텔레그램 알림 — 변경 있을 때만
    if (changes.length > 0 && !dryRun) {
      const lines = changes.map((c) => {
        const arrow = c.to === STRATEGY_STATUS.ACTIVE ? "🟢 승급" :
                      c.to === STRATEGY_STATUS.DISABLED ? "🔴 중단" : "🟡 관찰";
        return `${arrow} ${c.strategyId}: ${c.from} → ${c.to} (${c.reason})`;
      });
      const card = buildCard({
        tag: "🎯",
        title: "Auto Promote — 전략 상태 변경",
        lines,
        footer: `leaderboard ${leaderboard.generatedAt}`,
      });
      try {
        await sendCards([card]);
        L("telegram sent");
      } catch (e) {
        L(`telegram fail: ${e?.message}`);
      }
    } else if (changes.length === 0) {
      L("변경 없음 — 텔레그램 발송 skip");
    }

    return res.status(200).json({
      ok: true,
      durationMs: Date.now() - t0,
      dryRun,
      changes,
      noChanges,
      log,
    });
  } catch (err) {
    console.error("[auto-promote] fatal:", err);
    return res.status(200).json({ ok: false, error: err?.message || String(err), log });
  }
}
