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
// Cron: `30 * * * *` (매시간 24회/일 — vercel.json:161).
//   ★ 적대감사 P3-6 정정: 기존 헤더가 '30 6 * * * 일일·시장 닫힘 안전'이라 했으나 실제는 *매시간*
//   실행되어 거래 활성 시간대에도 라이브 전략 상태를 변경함. 빈번한 재승급 안전은
//   P2-9(DISABLED 백테스트 재승급 차단)·P2-10(stale leaderboard 승급 보류)으로 확보.
// ────────────────────────────────────────────────────────────────────

import { requireCronAuth } from "../_shared/require-cron.js";
import {
  setStrategyStatus,
  getStrategyStatus,
  STRATEGY_STATUS,
  DEFAULT_STRATEGY_WEIGHTS,
} from "../_shared/dynamic-config.js";
import { sendCards, buildCard } from "../_shared/telegram.js";
import { archiveAlphaLifecycleEvent } from "../_shared/strategy-archive.js";

export const config = { maxDuration: 30 };

// 규칙 — KV override 가능
// ★ 2026-05-17 대표 지시: "전략 일시 중단 등 로직은 빼줘. 돈을 잃더라도 계속 테스트"
//   demote (active → disabled) 자체 비활성화. 부진해도 watch 까지만 허용 (운영 지속).
//   복원: ZEPTA_AUTO_DEMOTE=1 환경변수.
const RULES = {
  promote: { minTrades: 30, minSharpe: 1.5, minPF: 1.3 },
  demote:  { minTrades: 20, maxSharpe: 0,   minWinRate: 30 }, // OR 조건 (env 활성화 시만 적용)
};
const AUTO_DEMOTE_ENABLED = process.env.ZEPTA_AUTO_DEMOTE === "1";

async function getKv() {
  return (await import("@vercel/kv")).kv;
}

/**
 * leaderboard 의 한 strategy 메트릭으로 권고 상태 산출.
 */
function decide(metrics) {
  if (!metrics) return { next: STRATEGY_STATUS.WATCH, reason: "no data" };
  const { trades = 0, sharpe = 0, profitFactor: pf = 0, winRate = 0 } = metrics;
  // ★ 적대감사 P3-7: 무손실(손실 0건) 전략은 computeMetrics 가 pf=null 반환 → (pf||0)=0 으로 PF
  //   게이트 영구 탈락(최우수 전략이 WATCH 0.5×에 갇힘). trades>=minTrades 가드가 이미 있어 pf==null 은
  //   '거래는 충분한데 손실 0'(=무한 PF)이므로 PF 조건 통과로 처리.
  const pfPass = (pf == null) || ((pf || 0) >= RULES.promote.minPF);
  if (trades >= RULES.promote.minTrades && sharpe >= RULES.promote.minSharpe && pfPass) {
    return {
      next: STRATEGY_STATUS.ACTIVE,
      reason: `n=${trades}, Sharpe ${sharpe} ≥ ${RULES.promote.minSharpe}, PF ${pf == null ? "∞(무손실)" : pf} ≥ ${RULES.promote.minPF}`,
    };
  }
  if (AUTO_DEMOTE_ENABLED && trades >= RULES.demote.minTrades && (sharpe <= RULES.demote.maxSharpe || winRate < RULES.demote.minWinRate)) {
    const cause = sharpe <= 0 ? `Sharpe ${sharpe} ≤ 0` : `winRate ${winRate}% < 30%`;
    return {
      next: STRATEGY_STATUS.DISABLED,
      reason: `n=${trades}, ${cause}`,
    };
  }
  // demote 비활성 시 부진해도 watch — 운영 지속 (대표 지시).
  return { next: STRATEGY_STATUS.WATCH, reason: `n=${trades}, Sharpe ${sharpe}, PF ${pf}` };
}

export default async function handler(req, res) {
  if (!requireCronAuth(req, res)) return; // ★ 크론/내부 전용 (2026-07-08 무인증 노출 차단)
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
    // ★ 적대감사 P2-10: leaderboard staleness 계산 — 오래된 백테스트 데이터로 라이브 승급 방지.
    const lbAgeMs = leaderboard.generatedAt ? (Date.now() - new Date(leaderboard.generatedAt).getTime()) : Infinity;
    const STALE_H = Number(process.env.ZEPTA_PROMOTE_STALE_HOURS || 48);
    const lbStale = !(lbAgeMs < STALE_H * 3600 * 1000);
    L(`leaderboard age: ${leaderboard.generatedAt} (${Number.isFinite(lbAgeMs) ? Math.round(lbAgeMs / 3600000) : "∞"}h, stale=${lbStale})`);

    const changes = [];
    const noChanges = [];

    for (const strategyId of Object.keys(DEFAULT_STRATEGY_WEIGHTS)) {
      const metrics = leaderboard.strategies?.[strategyId];
      let decision = decide(metrics);
      // ★ 2026-05-29 — 알파랩이 실거래 파라미터를 주입한(=검증된 백테스트 Sharpe 보유)
      //   전략은 production leaderboard 가 summary-fallback 으로 Sharpe 0 이어도
      //   active 로 유지한다. (안 그러면 30분마다 auto-promote 가 watch 로 되돌려
      //   continuous-backtest/param-tuner 의 승급을 무효화함 — 발굴→실거래 단절 재발.)
      try {
        const tuned = await kv.get(`di:alpha:params:${strategyId}`);
        // ★ 적대감사 P2-9: tuned(백테스트) Sharpe 만으로 라이브 강등(DISABLED)을 ACTIVE 로 되돌리면
        //   라이브 부진 전략이 백테스트 점수로 재승급(라이브 5x). WATCH→ACTIVE(발굴→실거래 reconnect)만
        //   허용하고, decide()가 DISABLED(라이브 n≥minTrades + Sharpe≤0/저승률)로 강등한 건 라이브 우선.
        if (tuned && Number.isFinite(tuned.sharpe) && tuned.sharpe >= RULES.promote.minSharpe
            && decision.next === STRATEGY_STATUS.WATCH) {
          decision = {
            next: STRATEGY_STATUS.ACTIVE,
            reason: `tuned params 적용 (backtest Sharpe ${tuned.sharpe.toFixed(2)}) — 실거래 유지`,
          };
        }
      } catch {}
      const currentStatus = await getStrategyStatus(strategyId);
      // ★ 적대감사 P2-10: stale leaderboard(>STALE_H)면 ACTIVE 신규 승급 보류(강등·유지는 허용 — 안전
      //   방향). 새 백테스트 데이터가 들어오면 다음 사이클에 승급. (이미 ACTIVE 인 건 영향 없음.)
      if (lbStale && decision.next === STRATEGY_STATUS.ACTIVE && currentStatus !== STRATEGY_STATUS.ACTIVE) {
        noChanges.push({ strategyId, status: currentStatus, next: decision.next, reason: `stale leaderboard (${Number.isFinite(lbAgeMs) ? Math.round(lbAgeMs / 3600000) : "∞"}h>${STALE_H}h) — 승급 보류` });
        continue;
      }
      if (decision.next === currentStatus) {
        noChanges.push({ strategyId, status: currentStatus, ...decision });
        continue;
      }
      if (!dryRun) {
        const r = await setStrategyStatus(strategyId, decision.next, decision.reason);
        L(`${strategyId}: ${currentStatus} → ${decision.next} (${decision.reason})`);
        try {
          const evType = decision.next === STRATEGY_STATUS.ACTIVE ? "promote" : decision.next === STRATEGY_STATUS.DISABLED ? "demote" : "status";
          await archiveAlphaLifecycleEvent({ type: evType, family: strategyId, from: currentStatus, to: decision.next, reason: decision.reason });
        } catch {}
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
