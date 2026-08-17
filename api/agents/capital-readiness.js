// ════════════════════════════════════════════════════════════════════
// Zepta — Capital Readiness Tracker (자본 투입 근거 데이터 트래커)
// ────────────────────────────────────────────────────────────────────
// 목적: "지금 자본을 늘릴 데이터 근거가 갖춰졌는가?"를 객관적 지표로만 판단해
//   대표에게 *아주 단순한* 한 줄 신호로 알린다.
//
// ⚠️ 중요 — 투자 권유 아님:
//   이 트래커는 "자본을 늘려라/줄여라"를 지시하지 않는다. 오직 통계적 신뢰를
//   확보할 만큼 *실거래 데이터가 쌓였는지*(검증 충족 ✅ / 아직 ⏳)만 보고한다.
//   자본 결정은 전적으로 대표 몫. 메시지 문구도 데이터 사실만 담는다.
//
// 판단 기준 (전부 충족해야 ✅ — 보수적):
//   C1) 표본 충분   : 실거래 청산 누적 ≥ READY_MIN_TRADES (기본 30건)
//   C2) 기간/국면    : 트래킹 시작 후 ≥ READY_MIN_DAYS (기본 14일 — 여러 시장
//                      국면 경험 프록시)
//   C3) 엣지 확인    : 누적 순손익 ≥ 0  그리고  승률 ≥ READY_MIN_WINRATE(기본 0.40)
//
// 알림 정책 (스팸 방지): 매일 돌되 *상태가 의미있게 바뀔 때만* 텔레그램 발송.
//   - ⏳→✅ 전환 (근거 마련) / ✅→⏳ 후퇴 (근거 약화)
//   - ⏳ 진행 중 표본 마일스톤(10/30/50건) 신규 도달
//   그 외에는 조용히 상태만 저장.
//
// Cron: 매일 1회 (vercel.json). Timeout: 30초.
// KV:
//   읽기 — di:real:user:<owner>:live-summary  (실거래 누적 성과)
//          di:alpha:params:mean-revert        (검증 통과 전략 메타, 참고용)
//   상태 — di:alpha:capital-readiness-state    (startedAt, lastVerdict, lastMilestone)
// ════════════════════════════════════════════════════════════════════

import { requireCronAuth } from "../_shared/require-cron.js";
import { sendTelegram } from "../_shared/telegram.js";

async function getKv() {
  return (await import("@vercel/kv")).kv;
}

export const config = { maxDuration: 30 };

// 기준값 (env 로 조정 가능)
const OWNER_USER_ID = process.env.ZEPTA_OWNER_USER_ID || "b707e106-8d92-499a-887b-e1ce0145033c";
const READY_MIN_TRADES = parseInt(process.env.ZEPTA_READY_MIN_TRADES || "30", 10);
const READY_MIN_DAYS = parseInt(process.env.ZEPTA_READY_MIN_DAYS || "14", 10);
const READY_MIN_WINRATE = parseFloat(process.env.ZEPTA_READY_MIN_WINRATE || "0.40");
const MILESTONES = [10, 30, 50];

const STATE_KEY = "di:alpha:capital-readiness-state";

function fmtUsd(n) {
  const v = Number(n) || 0;
  const s = v >= 0 ? "+" : "−";
  return `${s}$${Math.abs(v).toFixed(0)}`;
}

export default async function handler(req, res) {
  if (!requireCronAuth(req, res)) return; // ★ 크론/내부 전용 (2026-07-08 무인증 노출 차단)
  res.setHeader("Access-Control-Allow-Origin", "*");
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  try {
    const kv = await getKv();

    // ── 1) 실거래 누적 성과 읽기 (all-time) ──────────────────────────
    const live = (await kv.get(`di:real:user:${OWNER_USER_ID}:live-summary`)) || {};
    const allTrades = Number(live.trades) || 0;
    const allWins = Number(live.wins) || 0;
    const allNetPnL = Number(live.netPnL) || 0;

    // ── 2) 트래커 상태 + 기준선(baseline) ────────────────────────────
    //   ★ 핵심: 판정은 "트래킹 시작 이후 증분(since)"으로만. 과거 −47% 같은
    //   all-time 누적에 발목 잡히지 않도록, 시작 시점 성과를 baseline 으로 고정하고
    //   그 이후 쌓인 데이터만 평가한다. (대표가 청산 후 새로 쌓는 데이터 = 진짜 판단 대상)
    const state = (await kv.get(STATE_KEY)) || {};
    const isInit = state.baseline == null; // 최초 실행(또는 baseline 미설정 마이그레이션)

    const baseline = state.baseline || { trades: allTrades, wins: allWins, netPnL: allNetPnL };
    // baseline 필드 NaN 가드 (옛 부분 저장 상태 방어) — 누락 시 0으로.
    const bTrades = Number(baseline.trades) || 0, bWins = Number(baseline.wins) || 0, bNet = Number(baseline.netPnL) || 0;
    const startedAtMs = Number.isFinite(state.startedAtMs) ? state.startedAtMs : nowMs;
    const daysElapsed = Math.floor((nowMs - startedAtMs) / 86400000);

    // 증분 — 트래킹 시작 이후
    const trades = Math.max(0, allTrades - bTrades);
    const wins = Math.max(0, allWins - bWins);
    const netPnL = allNetPnL - bNet;
    const winRate = trades > 0 ? wins / trades : 0;

    // ── 3) 기준 평가 (전부 충족해야 ✅) ──────────────────────────────
    const c1 = trades >= READY_MIN_TRADES;            // 표본 충분 (since)
    const c2 = daysElapsed >= READY_MIN_DAYS;         // 기간/국면
    const c3 = netPnL >= 0 && winRate >= READY_MIN_WINRATE; // 엣지 확인 (since)
    const ready = c1 && c2 && c3;
    const verdict = ready ? "ready" : "not-ready";

    // 가장 부족한 항목 (⏳ 일 때 메시지에 단서로)
    let blocker = null;
    if (!c1) blocker = `표본 ${trades}/${READY_MIN_TRADES}건`;
    else if (!c2) blocker = `기간 ${daysElapsed}/${READY_MIN_DAYS}일`;
    else if (!c3) blocker = netPnL < 0 ? `순손익 ${fmtUsd(netPnL)}` : `승률 ${(winRate * 100).toFixed(0)}%`;

    // ── 4) 알림 여부 결정 ────────────────────────────────────────────
    //   최초 실행(isInit)은 baseline 만 조용히 고정하고 알리지 않는다
    //   (대표는 이미 "지금부터 쌓는다"를 알고 있음 — 무의미한 알림 방지).
    const lastVerdict = state.lastVerdict || null;
    const lastMilestone = state.lastMilestone || 0;
    const reachedMilestone = MILESTONES.filter((m) => trades >= m).pop() || 0;

    let notify = false;
    let text = null;

    if (!isInit) {
      if (lastVerdict !== verdict) {
        // 판정 전환 — 핵심 순간
        notify = true;
        if (ready) {
          text =
            `📊 Zepta — 데이터 검증 충족 ✅\n` +
            `최근 ${trades}건 · ${daysElapsed}일 · 순손익 ${fmtUsd(netPnL)} · 승률 ${(winRate * 100).toFixed(0)}%\n` +
            `백테스트 엣지가 실거래로 확인됨. 자본 판단 근거 마련 (결정은 대표님).`;
        } else {
          text =
            `📊 Zepta — 데이터 근거 약화 ⏳\n` +
            `최근 ${trades}건 · 순손익 ${fmtUsd(netPnL)} · 승률 ${(winRate * 100).toFixed(0)}%\n` +
            `미충족: ${blocker}. 추가 데이터 수집 중.`;
        }
      } else if (!ready && reachedMilestone > lastMilestone) {
        // ⏳ 진행 중 새 표본 마일스톤 도달
        notify = true;
        text =
          `📊 Zepta — 데이터 축적 ${trades}건 도달 ⏳\n` +
          `순손익 ${fmtUsd(netPnL)} · 승률 ${(winRate * 100).toFixed(0)}% · ${daysElapsed}일\n` +
          `아직 검증 미충족(${blocker}). 계속 수집 중.`;
      }
    }

    // ★ 2026-08-17 알림 통합 — 대표 지시 "데일리 보고 1건": 기본은 무발송.
    //   핵심 판정을 KV 에 남겨 KST 06:00 통합 스탠드업이 ④(게이트 현황)·⑤(경고)에 반영.
    //   ZEPTA_TG_VERBOSE=1 이면 기존 개별 발송 복원(되돌리기 스위치). 판정·상태 저장은 전부 유지.
    let sendResult = null;
    if (notify && text && process.env.ZEPTA_TG_VERBOSE === "1") {
      sendResult = await sendTelegram({ text });
    }

    // 통합 스탠드업이 읽는 핵심 판정 요약 (추가 필드 — 기존 상태 키와 별개)
    try {
      await kv.set("di:standup:capital", {
        verdict,
        blocker,
        since: { trades, winRate: Number(winRate.toFixed(3)), netPnL: Number(netPnL.toFixed(2)), daysElapsed },
        notice: notify && text ? text.split("\n")[0] : null,
        updatedAt: nowIso,
      }, { ex: 3 * 86400 });
    } catch {}

    // ── 5) 상태 저장 ─────────────────────────────────────────────────
    await kv.set(STATE_KEY, {
      startedAtMs,
      baseline, // 시작 시점 성과 고정 (이후 변경 안 함)
      lastVerdict: verdict,
      lastMilestone: Math.max(lastMilestone, reachedMilestone),
      lastTrades: trades,
      lastNetPnL: netPnL,
      updatedAt: nowIso,
    });

    return res.status(200).json({
      ok: true,
      verdict,
      init: isInit,
      criteria: { c1_sample: c1, c2_duration: c2, c3_edge: c3 },
      since: { trades, winRate: Number(winRate.toFixed(3)), netPnL: Number(netPnL.toFixed(2)), daysElapsed },
      allTime: { trades: allTrades, netPnL: Number(allNetPnL.toFixed(2)) },
      baseline,
      thresholds: { READY_MIN_TRADES, READY_MIN_DAYS, READY_MIN_WINRATE },
      blocker,
      notified: notify,
      sendResult,
      generatedAt: nowIso,
    });
  } catch (err) {
    console.error("[capital-readiness] fatal:", err);
    return res.status(200).json({ ok: false, error: err?.message || String(err) });
  }
}
