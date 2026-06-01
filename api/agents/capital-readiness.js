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
  res.setHeader("Access-Control-Allow-Origin", "*");
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  try {
    const kv = await getKv();

    // ── 1) 실거래 누적 성과 읽기 ──────────────────────────────────────
    const live = (await kv.get(`di:real:user:${OWNER_USER_ID}:live-summary`)) || {};
    const trades = Number(live.trades) || 0;
    const wins = Number(live.wins) || 0;
    const netPnL = Number(live.netPnL) || 0;
    const winRate = trades > 0 ? wins / trades : 0;

    // ── 2) 트래커 상태 (시작 시각·직전 판정) ─────────────────────────
    const state = (await kv.get(STATE_KEY)) || {};
    const startedAtMs = state.startedAtMs || nowMs; // 최초 실행 시각 고정
    const daysElapsed = Math.floor((nowMs - startedAtMs) / 86400000);

    // ── 3) 기준 평가 (전부 충족해야 ✅) ──────────────────────────────
    const c1 = trades >= READY_MIN_TRADES;            // 표본 충분
    const c2 = daysElapsed >= READY_MIN_DAYS;         // 기간/국면
    const c3 = netPnL >= 0 && winRate >= READY_MIN_WINRATE; // 엣지 확인
    const ready = c1 && c2 && c3;
    const verdict = ready ? "ready" : "not-ready";

    // 가장 부족한 항목 (⏳ 일 때 메시지에 단서로)
    let blocker = null;
    if (!c1) blocker = `표본 ${trades}/${READY_MIN_TRADES}건`;
    else if (!c2) blocker = `기간 ${daysElapsed}/${READY_MIN_DAYS}일`;
    else if (!c3) blocker = netPnL < 0 ? `순손익 ${fmtUsd(netPnL)}` : `승률 ${(winRate * 100).toFixed(0)}%`;

    // ── 4) 알림 여부 결정 (상태 변화 시에만) ─────────────────────────
    const lastVerdict = state.lastVerdict || null;
    const lastMilestone = state.lastMilestone || 0;
    // 현재 도달한 최고 마일스톤
    const reachedMilestone = MILESTONES.filter((m) => trades >= m).pop() || 0;

    let notify = false;
    let text = null;

    if (lastVerdict !== verdict) {
      // 판정 전환 — 핵심 순간
      notify = true;
      if (ready) {
        text =
          `📊 Zepta — 데이터 검증 충족 ✅\n` +
          `실거래 ${trades}건 · ${daysElapsed}일 · 누적 ${fmtUsd(netPnL)} · 승률 ${(winRate * 100).toFixed(0)}%\n` +
          `백테스트 엣지가 실거래로 확인됨. 자본 판단 근거 마련 (결정은 대표님).`;
      } else {
        text =
          `📊 Zepta — 데이터 근거 후퇴 ⏳\n` +
          `현재 ${trades}건 · 누적 ${fmtUsd(netPnL)} · 승률 ${(winRate * 100).toFixed(0)}%\n` +
          `미충족: ${blocker}. 추가 데이터 수집 중.`;
      }
    } else if (!ready && reachedMilestone > lastMilestone) {
      // ⏳ 진행 중 새 마일스톤 도달
      notify = true;
      text =
        `📊 Zepta — 데이터 축적 ${trades}건 도달 ⏳\n` +
        `누적 ${fmtUsd(netPnL)} · 승률 ${(winRate * 100).toFixed(0)}% · ${daysElapsed}일\n` +
        `아직 검증 미충족(${blocker}). 계속 수집 중.`;
    }

    let sendResult = null;
    if (notify && text) {
      sendResult = await sendTelegram({ text });
    }

    // ── 5) 상태 저장 ─────────────────────────────────────────────────
    await kv.set(STATE_KEY, {
      startedAtMs,
      lastVerdict: verdict,
      lastMilestone: Math.max(lastMilestone, reachedMilestone),
      lastTrades: trades,
      lastNetPnL: netPnL,
      updatedAt: nowIso,
    });

    return res.status(200).json({
      ok: true,
      verdict,
      criteria: { c1_sample: c1, c2_duration: c2, c3_edge: c3 },
      metrics: { trades, winRate: Number(winRate.toFixed(3)), netPnL, daysElapsed },
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
