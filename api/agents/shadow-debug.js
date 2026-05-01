// ════════════════════════════════════════════════════════════════════
// Shadow Ledger 손실 패턴 진단 — QUANT-RES 가 던진 질문에 답하는 도구
//
// 답하는 질문:
//   1) 마감 거래의 close 이유별 분포 (SL / TP / TIME)
//   2) 보유 시간(hold time) 분포
//   3) 패밀리/심볼/방향(LONG·SHORT) 별 승률
//   4) 손실 누적 상위 거래 TOP 10 (디버깅용)
//   5) 진입 시 손절폭(slPct)·목표폭(tpPct) 분포
//   6) 만약 "최대 보유시간 N시간" 규칙 적용 시 시뮬레이션 결과
//
// 사용:
//   GET /api/agents/shadow-debug
//   GET /api/agents/shadow-debug?holdHours=24  // 24시간 강제청산 시뮬
//   GET /api/agents/shadow-debug?days=30       // 최근 30일치 분석
// ════════════════════════════════════════════════════════════════════

import { sendCards, buildCard, fmtKSTShort } from "../_shared/telegram.js";

const PROBE_USER = "__zepta_global_probe__";

async function getKv() {
  return (await import("@vercel/kv")).kv;
}

function entryTimeMs(e) {
  if (!e) return 0;
  if (typeof e.openedAt === "string") return Date.parse(e.openedAt) || 0;
  if (typeof e.openedAt === "number") return e.openedAt;
  if (typeof e.id === "string") {
    const m = e.id.match(/^sh-(\d+)-/);
    if (m) return Number(m[1]) || 0;
  }
  return 0;
}

function closeTimeMs(e) {
  if (typeof e?.closedAt === "string") return Date.parse(e.closedAt) || 0;
  if (typeof e?.closedAt === "number") return e.closedAt;
  return 0;
}

// 백분위 계산 (정렬된 배열에서)
function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.floor((sorted.length - 1) * p);
  return sorted[idx];
}

function bucketDist(values, buckets) {
  // values: 숫자 배열, buckets: [라벨, min, max] 튜플
  const out = {};
  for (const [label] of buckets) out[label] = 0;
  for (const v of values) {
    for (const [label, lo, hi] of buckets) {
      if (v >= lo && v < hi) { out[label]++; break; }
    }
  }
  return out;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  try {
    const days = Number(req.query?.days) || 30;
    const simHoldHours = Number(req.query?.holdHours) || 0; // 0 = 시뮬 미실행

    const kv = await getKv();
    const ledger = (await kv.get(`di:real:user:${PROBE_USER}:shadow-ledger`)) || [];
    const summary = (await kv.get(`di:real:user:${PROBE_USER}:shadow-summary`)) || null;

    const cutoff = Date.now() - days * 86400000;
    const filtered = ledger.filter((e) => entryTimeMs(e) >= cutoff);

    const closed = filtered.filter((e) => e?.status === "CLOSED");
    const open = filtered.filter((e) => e?.status !== "CLOSED");

    // ── 1) close 이유별 분포 ──
    const closeReasonStats = {};
    for (const e of closed) {
      const r = e.closeReason || "UNKNOWN";
      closeReasonStats[r] = closeReasonStats[r] || { count: 0, totalPnL: 0, wins: 0 };
      closeReasonStats[r].count++;
      closeReasonStats[r].totalPnL += e.netPnL || 0;
      if ((e.netPnL || 0) > 0) closeReasonStats[r].wins++;
    }

    // ── 2) 보유 시간 분포 (마감 거래만) ──
    const holdHours = closed
      .map((e) => {
        const o = entryTimeMs(e), c = closeTimeMs(e);
        return o && c && c >= o ? (c - o) / 3600000 : null;
      })
      .filter((h) => h !== null);
    const holdSorted = [...holdHours].sort((a, b) => a - b);
    const holdDist = bucketDist(holdHours, [
      ["≤1h", 0, 1],
      ["1~6h", 1, 6],
      ["6~24h", 6, 24],
      ["24~48h", 24, 48],
      [">48h", 48, Infinity],
    ]);

    // ── 3) 패밀리·심볼·방향별 승률 ──
    function groupStats(getter) {
      const map = {};
      for (const e of closed) {
        const k = getter(e) || "기타";
        map[k] = map[k] || { count: 0, wins: 0, pnlSum: 0 };
        map[k].count++;
        if ((e.netPnL || 0) > 0) map[k].wins++;
        map[k].pnlSum += e.netPnL || 0;
      }
      return Object.entries(map)
        .map(([k, v]) => ({
          key: k,
          count: v.count,
          winRate: v.count ? ((v.wins / v.count) * 100).toFixed(1) : "0",
          pnlSum: Number(v.pnlSum.toFixed(2)),
        }))
        .sort((a, b) => b.count - a.count);
    }
    const byFamily = groupStats((e) => e?.plan?.strategyFamily || e?.signal?.strategyFamily || e?.signal?.source);
    const bySymbol = groupStats((e) => e?.plan?.symbol || e?.signal?.symbol);
    const bySide = groupStats((e) => e?.plan?.side || e?.signal?.side);

    // ── 4) 손실 누적 상위 거래 TOP 10 ──
    const worstTrades = [...closed]
      .filter((e) => (e.netPnL || 0) < 0)
      .sort((a, b) => (a.netPnL || 0) - (b.netPnL || 0))
      .slice(0, 10)
      .map((e) => ({
        id: e.id,
        symbol: e?.plan?.symbol,
        side: e?.plan?.side,
        family: e?.plan?.strategyFamily || e?.signal?.source,
        netPnL: Number((e.netPnL || 0).toFixed(2)),
        rMultiple: Number((e.rMultiple || 0).toFixed(2)),
        closeReason: e.closeReason,
        holdHours: (() => {
          const o = entryTimeMs(e), c = closeTimeMs(e);
          return o && c ? Number(((c - o) / 3600000).toFixed(1)) : null;
        })(),
        slPct: Number(((e?.plan?.slPct || 0) * 100).toFixed(2)),
        tpPct: Number(((e?.plan?.tpPct || 0) * 100).toFixed(2)),
      }));

    // ── 5) 진입 시 SL/TP 폭 분포 ──
    const slPcts = filtered.map((e) => (e?.plan?.slPct || 0) * 100).filter((v) => v > 0);
    const tpPcts = filtered.map((e) => (e?.plan?.tpPct || 0) * 100).filter((v) => v > 0);
    const slpSorted = [...slPcts].sort((a, b) => a - b);
    const tppSorted = [...tpPcts].sort((a, b) => a - b);

    // ── 6) "최대 보유 N시간 강제청산" 시뮬 (현재 OPEN 포지션 가정 적용) ──
    let holdoutSim = null;
    if (simHoldHours > 0) {
      const simCutoffMs = simHoldHours * 3600000;
      const wouldClose = open.filter((e) => {
        const o = entryTimeMs(e);
        return o > 0 && (Date.now() - o) >= simCutoffMs;
      });
      holdoutSim = {
        rule: `${simHoldHours}시간 경과시 강제청산`,
        wouldCloseCount: wouldClose.length,
        wouldRemainOpen: open.length - wouldClose.length,
        sample: wouldClose.slice(0, 5).map((e) => ({
          id: e.id,
          symbol: e?.plan?.symbol,
          side: e?.plan?.side,
          ageHours: Number(((Date.now() - entryTimeMs(e)) / 3600000).toFixed(1)),
        })),
      };
    }

    const result = {
      ok: true,
      windowDays: days,
      totals: {
        ledgerSize: ledger.length,
        windowSize: filtered.length,
        open: open.length,
        closed: closed.length,
        winRate: closed.length ? `${((closed.filter((e) => (e.netPnL || 0) > 0).length / closed.length) * 100).toFixed(1)}%` : "—",
        netPnL: closed.length ? Number(closed.reduce((s, e) => s + (e.netPnL || 0), 0).toFixed(2)) : 0,
      },
      summaryFromKv: summary,
      closeReasonStats,
      holdHoursDist: {
        buckets: holdDist,
        median: closed.length ? Number(percentile(holdSorted, 0.5).toFixed(1)) : null,
        p90: closed.length ? Number(percentile(holdSorted, 0.9).toFixed(1)) : null,
      },
      byFamily,
      bySymbol: bySymbol.slice(0, 10),
      bySide,
      worstTrades,
      slTpProfile: {
        slPct: slpSorted.length ? {
          median: Number(percentile(slpSorted, 0.5).toFixed(2)),
          p90: Number(percentile(slpSorted, 0.9).toFixed(2)),
          min: Number(slpSorted[0].toFixed(2)),
          max: Number(slpSorted[slpSorted.length - 1].toFixed(2)),
        } : null,
        tpPct: tppSorted.length ? {
          median: Number(percentile(tppSorted, 0.5).toFixed(2)),
          p90: Number(percentile(tppSorted, 0.9).toFixed(2)),
        } : null,
        avgRR: tpPcts.length && slPcts.length
          ? Number((tpPcts.reduce((s, v) => s + v, 0) / slPcts.reduce((s, v) => s + v, 0)).toFixed(2))
          : null,
      },
      holdoutSim,
      generatedAt: new Date().toISOString(),
    };

    // 텔레그램 발송 옵션
    if (req.query?.notify === "1") {
      const lines = [
        `윈도우: 최근 ${days}일 / 마감 ${closed.length}건 / 진행 ${open.length}건`,
        `누적 손익 ${result.totals.netPnL >= 0 ? "+" : ""}$${result.totals.netPnL}, 승률 ${result.totals.winRate}`,
        `청산 이유: ${Object.entries(closeReasonStats).map(([k, v]) => `${k} ${v.count}건(승률 ${v.count ? ((v.wins/v.count)*100).toFixed(0) : 0}%)`).join(" / ") || "(없음)"}`,
        `보유 시간 중앙값 ${result.holdHoursDist.median ?? "—"}h, p90 ${result.holdHoursDist.p90 ?? "—"}h`,
        `손절폭 중앙값 ${result.slTpProfile.slPct?.median ?? "—"}%, 익절폭 ${result.slTpProfile.tpPct?.median ?? "—"}%`,
        worstTrades.length ? `최악 거래: ${worstTrades[0].symbol} ${worstTrades[0].side} $${worstTrades[0].netPnL} (${worstTrades[0].closeReason}, ${worstTrades[0].holdHours}h 보유)` : "",
      ];
      await sendCards([buildCard({
        tag: "🔬",
        title: "Shadow Ledger 손실 패턴 진단",
        lines,
        hint: closed.length && (closed.filter((e) => (e.netPnL || 0) > 0).length / closed.length) < 0.3
          ? "승률 30% 미만 — 청산 로직(SL/TP/TIME) 점검이 우선이에요"
          : undefined,
        footer: `${fmtKSTShort()} · 진단 도구`,
      })]);
    }

    return res.status(200).json(result);
  } catch (err) {
    console.error("[shadow-debug] fatal:", err);
    return res.status(200).json({ ok: false, error: err?.message || String(err) });
  }
}
