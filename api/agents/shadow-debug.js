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
//   7) ★ Retro 시뮬 — closed-archive 데이터로 "다른 SL/TP 룰이었다면?" 재계산
//
// 사용:
//   GET /api/agents/shadow-debug
//   GET /api/agents/shadow-debug?holdHours=24
//   GET /api/agents/shadow-debug?days=30
//   GET /api/agents/shadow-debug?retroSL=4&retroTP=6  // SL 4% + TP 6% 적용 시뮬
//   GET /api/agents/shadow-debug?retroSL=3,4,5&retroTP=5,6,8  // 다중 변형 비교
// ════════════════════════════════════════════════════════════════════

import { sendCards, buildCard, fmtKSTShort } from "../_shared/telegram.js";
import { batchBacktest } from "../_shared/ohlc-backtest.js";

const PROBE_USER = "__zepta_global_probe__";

export const config = { maxDuration: 60 };

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

// ── Retro 시뮬 ──
// 한계: 실제 가격 경로는 모르고 entry/MFE/MAE 만 알 수 있음.
// 가정: MFE 와 MAE 사이의 어느 시점에 가격이 도달했다 (시간 순서는 미상).
//
// 보수적 가정: 하락(MAE) 이 먼저, 상승(MFE) 이 나중. LONG 기준 "최악의 경우".
// → 새 SL 이 MAE 보다 가까우면(=덜 손실) 새 SL 에서 청산
// → 새 TP 가 MFE 보다 가까우면 새 TP 에서 청산 (단, 그 전에 SL 안 맞았어야)
// → 둘 다 안 맞으면 maxHold 가 짧으면 TIME, 길면 원본 청산가 그대로
//
// 더 정확한 분석은 entry 시점부터 maxHold 기간의 분단위 OHLC 가 필요 (별도 백테스트)
function retroSimOne(c, { slPct, tpPct, holdHours }) {
  const side = c.side;
  const entry = c.entryPrice;
  if (!entry || !side) return null;

  // 입력된 새 SL/TP 비율 적용 (없으면 원본 유지)
  const newSlPct = slPct != null ? slPct / 100 : c.slPct;
  const newTpPct = tpPct != null ? tpPct / 100 : c.tpPct;
  const newSlPrice = side === "LONG" ? entry * (1 - newSlPct) : entry * (1 + newSlPct);
  const newTpPrice = side === "LONG" ? entry * (1 + newTpPct) : entry * (1 - newTpPct);

  // MAE / MFE 가 새 SL/TP 를 건드렸는지 판정
  const mae = c.maePrice ?? entry;
  const mfe = c.mfePrice ?? entry;
  const slHitByMae = side === "LONG" ? mae <= newSlPrice : mae >= newSlPrice;
  const tpHitByMfe = side === "LONG" ? mfe >= newTpPrice : mfe <= newTpPrice;

  // 보유 시간 컷
  const holdMsLimit = holdHours != null ? holdHours * 3600000 : (c.holdMs ?? Infinity);
  const wouldTimeOut = (c.holdMs ?? 0) > holdMsLimit;

  let newCloseReason, newGrossPct;
  if (slHitByMae) {
    // 새 SL 발동
    newCloseReason = "SL";
    newGrossPct = side === "LONG" ? -newSlPct : newSlPct; // LONG SL hit → -slPct grossPct
  } else if (tpHitByMfe) {
    newCloseReason = "TP";
    newGrossPct = side === "LONG" ? newTpPct : -newTpPct;
  } else if (wouldTimeOut) {
    // 시간 초과 — 시뮬상 단순화: maxHold 시점 가격을 모르니 원본 exit 가격 그대로
    newCloseReason = "TIME";
    newGrossPct = c.grossPct ?? 0;
  } else {
    // 어떤 룰에도 안 닿음 → 원본 청산 유지
    newCloseReason = c.closeReason || "UNKNOWN";
    newGrossPct = c.grossPct ?? 0;
  }

  const costPct = ((c.feeBps || 8) + (c.slippageBps || 5)) / 10000;
  const newNetPct = newGrossPct - costPct;
  const newNetPnL = (c.notional || 0) * newNetPct;
  const newR = (c.riskAmount || 0) > 0 ? newNetPnL / c.riskAmount : 0;
  return { closeReason: newCloseReason, netPnL: newNetPnL, rMultiple: newR };
}

function aggregateSim(sims) {
  if (!sims.length) return null;
  const wins = sims.filter((s) => (s.netPnL || 0) > 0).length;
  const losses = sims.length - wins;
  const netPnL = sims.reduce((a, s) => a + (s.netPnL || 0), 0);
  const avgR = sims.reduce((a, s) => a + (s.rMultiple || 0), 0) / sims.length;
  const reasons = { TP: 0, SL: 0, TIME: 0, SOFT_TIME: 0, UNKNOWN: 0 };
  for (const s of sims) reasons[s.closeReason || "UNKNOWN"] = (reasons[s.closeReason] || 0) + 1;
  return {
    trades: sims.length,
    wins, losses,
    winRate: sims.length ? Number(((wins / sims.length) * 100).toFixed(1)) : 0,
    netPnL: Number(netPnL.toFixed(2)),
    avgR: Number(avgR.toFixed(3)),
    byCloseReason: reasons,
  };
}

function parseList(s) {
  if (!s) return [];
  return String(s).split(",").map((v) => Number(v.trim())).filter((v) => Number.isFinite(v) && v > 0);
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  try {
    const days = Number(req.query?.days) || 30;
    const simHoldHours = Number(req.query?.holdHours) || 0; // 0 = 시뮬 미실행
    const retroSlList = parseList(req.query?.retroSL); // 단일 또는 콤마 분리 (예: "3,4,5")
    const retroTpList = parseList(req.query?.retroTP);
    const retroHoldList = parseList(req.query?.retroHold);
    const precise = req.query?.precise === "1" || req.query?.precise === "true"; // OHLC 정확 시뮬 모드

    const kv = await getKv();
    const [ledger, summary, archive] = await Promise.all([
      kv.get(`di:real:user:${PROBE_USER}:shadow-ledger`).then((v) => v || []),
      kv.get(`di:real:user:${PROBE_USER}:shadow-summary`).then((v) => v || null),
      kv.get(`di:real:user:${PROBE_USER}:shadow-closed-archive`).then((v) => v || []),
    ]);

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

    // ── 입력 데이터 결정: archive 우선, 없으면 ledger.closed fallback ──
    // archive 가 비어있는 초기 상태에서도 ledger 의 closed 항목으로 시뮬 가능
    const tradesForSim = archive.length > 0
      ? archive
      : closed.map((c) => ({
          id: c.id,
          symbol: c.plan?.symbol,
          side: c.plan?.side,
          openedAt: c.openedAt,
          closedAt: c.closedAt,
          entryPrice: c.entryPrice,
          notional: c.plan?.notional,
          riskAmount: c.plan?.riskAmount,
          mfePrice: c.mfePrice,
          maePrice: c.maePrice,
          slPct: c.plan?.slPct,
          tpPct: c.plan?.tpPct,
          closeReason: c.closeReason,
          netPnL: c.netPnL,
          rMultiple: c.rMultiple,
          grossPct: c.grossPct,
          holdMs: c.holdMs,
          feeBps: c.feeBps,
          slippageBps: c.slippageBps,
        }));

    // ── Precise 모드: OHLC 1분/5분봉 기반 정확한 백테스트 (Track B 1단계) ──
    // archive 또는 ledger.closed 의 entry 시점부터 maxHold 기간의 실제 분봉 가져와
    // SL/TP hit 시점을 정확히 판정. 처리 시간 길어 옵트인.
    let preciseSims = null;
    if (precise && tradesForSim.length > 0) {
      const slCandidates = retroSlList.length ? retroSlList : [3, 4, 5];
      const tpCandidates = retroTpList.length ? retroTpList : [4, 6, 8];
      const holdCandidates = retroHoldList.length ? retroHoldList : [24];
      // 처리 시간 제어: 최대 80건만 (5x5x1 * 80 = 2000 봉 fetch 추정)
      const sampled = tradesForSim.slice(0, 80);
      const variants = [];
      for (const sl of slCandidates) {
        for (const tp of tpCandidates) {
          if (tp <= sl) continue;
          for (const hh of holdCandidates) {
            try {
              const agg = await batchBacktest(sampled, { slPct: sl, tpPct: tp, holdHours: hh });
              if (agg) variants.push({ slPct: sl, tpPct: tp, holdHours: hh, rr: Number((tp/sl).toFixed(2)), ...agg });
            } catch (e) {
              variants.push({ slPct: sl, tpPct: tp, holdHours: hh, error: e?.message });
            }
          }
        }
      }
      variants.sort((a, b) => (b.netPnL || -Infinity) - (a.netPnL || -Infinity));
      preciseSims = {
        sampled: sampled.length,
        source: archive.length > 0 ? "archive" : "ledger.closed",
        variantsCount: variants.length,
        topVariants: variants.slice(0, 5),
      };
    }

    // ── Retro 시뮬 (보수적 MFE/MAE 근사) — 빠른 평가용 기본 모드 ──
    const retroSims = (() => {
      if (!tradesForSim.length) return null;
      // 기준선: 원본 룰 그대로
      const baseline = aggregateSim(tradesForSim.map((c) => ({
        closeReason: c.closeReason,
        netPnL: c.netPnL,
        rMultiple: c.rMultiple,
      })));
      // 변형 매트릭스: SL × TP 곱집합 (기본 변형 자동 추가)
      const slCandidates = retroSlList.length ? retroSlList : [3, 4, 5, 6];
      const tpCandidates = retroTpList.length ? retroTpList : [4, 6, 8, 10];
      const holdCandidates = retroHoldList.length ? retroHoldList : [12, 24, 48];
      const variants = [];
      for (const sl of slCandidates) {
        for (const tp of tpCandidates) {
          if (tp <= sl) continue; // RR < 1 인 변형은 제외
          for (const hh of holdCandidates) {
            const sims = tradesForSim
              .map((c) => retroSimOne(c, { slPct: sl, tpPct: tp, holdHours: hh }))
              .filter(Boolean);
            const agg = aggregateSim(sims);
            if (agg) variants.push({ slPct: sl, tpPct: tp, holdHours: hh, rr: Number((tp/sl).toFixed(2)), ...agg });
          }
        }
      }
      // 누적 손익 기준 상위 5개만 노출 (응답 크기 절감)
      variants.sort((a, b) => b.netPnL - a.netPnL);
      const topVariants = variants.slice(0, 5);
      // 기준선 대비 가장 좋은 변형
      const bestVsBaseline = topVariants[0] && baseline
        ? {
            improvement: Number((topVariants[0].netPnL - baseline.netPnL).toFixed(2)),
            winRateDelta: Number((topVariants[0].winRate - baseline.winRate).toFixed(1)),
          }
        : null;
      return {
        sourceSize: tradesForSim.length,
        source: archive.length > 0 ? "archive" : "ledger.closed",
        baseline,
        variantsCount: variants.length,
        topVariants,
        bestVsBaseline,
        note: archive.length < 10
          ? "archive 가 충분치 않아요. 시간이 지나면 자연 누적됩니다 (목표: 50건+)"
          : null,
      };
    })();

    const result = {
      ok: true,
      windowDays: days,
      totals: {
        ledgerSize: ledger.length,
        windowSize: filtered.length,
        open: open.length,
        closed: closed.length,
        archive: archive.length,
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
      retroSims,
      preciseSims, // ?precise=1 일 때만 채워짐. OHLC 분봉 기반 정확 시뮬.
      generatedAt: new Date().toISOString(),
    };

    // 텔레그램 발송 옵션
    if (req.query?.notify === "1") {
      const lines = [
        `윈도우: 최근 ${days}일 / 마감 ${closed.length}건 / 진행 ${open.length}건`,
        `누적 손익 ${result.totals.netPnL >= 0 ? "+" : ""}$${result.totals.netPnL}, 승률 ${result.totals.winRate}`,
        `청산 이유: ${Object.entries(closeReasonStats).map(([k, v]) => `${k}(${k === "SOFT_TIME" ? "조기TIME" : k}) ${v.count}건(승률 ${v.count ? ((v.wins/v.count)*100).toFixed(0) : 0}%)`).join(" / ") || "(없음)"}`,
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
