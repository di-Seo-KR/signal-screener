// ════════════════════════════════════════════════════════════════════
// Zepta 에이전트 일일 스탠드업 (KST 06:00)
//
// 매일 아침 KST 06:00 에 Vercel cron 으로 호출되어 다음 에이전트들이
// 각자 시니어 페르소나로 작업하고 텔레그램에 결과를 보고합니다.
//
//   1) QUANT-RES (알파 리서처)
//       - 어제 shadow ledger 성과 분석
//       - 잘 작동한 전략 패밀리 / 부진한 전략 패밀리 식별
//       - 새 알파 후보 1건 제안
//
//   2) QUANT-PLAN (전략 기획자)
//       - shadow → production 승급 후보
//       - 디머지(deprecate) 후보
//       - 전략 가중치 조정 권고
//
// 발송 대상: 텔레그램 (TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID)
// 사용 모델: claude-sonnet-4-6 (시니어 분석가 페르소나)
//
// 환경변수:
//   ANTHROPIC_API_KEY        — 필수
//   TELEGRAM_BOT_TOKEN/CHAT_ID — 필수
//   KV_REST_API_URL/TOKEN    — Vercel KV 연동
//
// 수동 호출: GET /api/agents/daily-standup?dryRun=1
// ════════════════════════════════════════════════════════════════════

import Anthropic from "@anthropic-ai/sdk";
import { sendCards, buildCard, fmtKST } from "../_shared/telegram.js";
import { fetchGA4DailySummary } from "../_shared/ga4.js";
import { fetchSentryDailySummary } from "../_shared/sentry.js";
import { batchBacktest } from "../_shared/ohlc-backtest.js";

// 7 명 에이전트 + OHLC 백테스트 + LLM 2회(QUANT-RES, QUANT-PLAN) — 60s 초과로 매일 타임아웃.
// ★ 2026-06-03: maxDuration 60 → 300 (continuous-backtest 와 동일). 완주 보장.
export const config = { maxDuration: 300 };

const MODEL = "claude-sonnet-4-6";
const PROBE_USER = "__zepta_global_probe__";

async function getKv() {
  return (await import("@vercel/kv")).kv;
}

// shadow ledger 에서 최근 N일 데이터 가져오기
// 엔진(engine.js)이 쌓는 엔트리는 openedAt(ISO 문자열) 형태이므로
// 다양한 timestamp 필드를 모두 호환 처리
function entryTimeMs(e) {
  if (!e) return 0;
  if (typeof e.time === "number") return e.time;
  if (typeof e.openedAt === "string") return Date.parse(e.openedAt) || 0;
  if (typeof e.openedAt === "number") return e.openedAt;
  if (typeof e.closedAt === "string") return Date.parse(e.closedAt) || 0;
  if (typeof e.id === "string") {
    const m = e.id.match(/^sh-(\d+)-/);
    if (m) return Number(m[1]) || 0;
  }
  return 0;
}

async function readShadowLedger(kv, days = 7) {
  const ledger = (await kv.get(`di:real:user:${PROBE_USER}:shadow-ledger`)) || [];
  if (!Array.isArray(ledger) || ledger.length === 0) return [];
  const cutoff = Date.now() - days * 86400000;
  return ledger.filter((e) => entryTimeMs(e) >= cutoff).slice(-200);
}

// 전략 가중치 / 패밀리별 성과 요약
async function readWeights(kv) {
  // ★ 2026-06-02 버그수정: 잘못된 키 di:real:strategy-weights(미존재) → di:alpha:strategy-weights.
  //   저장 형식 { weights:{...}, regime, updatedAt } 이라 .weights 추출. (보고 입력이 늘 빈값이던 것)
  const stored = await kv.get("di:alpha:strategy-weights");
  return stored?.weights || {};
}

// shadow-monitor 가 만들어두는 누적 요약 (있으면 활용)
async function readShadowSummary(kv) {
  return (await kv.get(`di:real:user:${PROBE_USER}:shadow-summary`)) || null;
}

// ── 실거래 일일 활동 요약 (사용자 본인 phase1 유저들 기준) ──
// 어제(KST) 자정~24시 동안의 engine-log 분석 → 진입/청산/손익 집계
async function readRealTradingActivity(kv) {
  const phase1Users = (await kv.get("di:real:phase1-users")) || [];
  if (!phase1Users.length) {
    return { phase1Count: 0, users: [] };
  }
  // KST 기준 어제 0시 ~ 오늘 0시
  const KST_MS = 9 * 3600000;
  const nowKst = new Date(Date.now() + KST_MS);
  const yMidnightKst = Date.UTC(nowKst.getUTCFullYear(), nowKst.getUTCMonth(), nowKst.getUTCDate() - 1);
  const tMidnightKst = yMidnightKst + 86400000;
  const sinceMs = yMidnightKst - KST_MS; // KST 자정 → UTC ms
  const untilMs = tMidnightKst - KST_MS;

  const userActivities = [];
  for (const uid of phase1Users.slice(0, 5)) {
    try {
      const [log, status, posPlans] = await Promise.all([
        kv.get(`di:real:user:${uid}:engine-log`).then((v) => v || []),
        kv.get(`di:real:user:${uid}:phase1_enabled`),
        kv.get(`di:real:user:${uid}:open-positions`).then((v) => v || []),
      ]);
      // 어제 윈도우 내 로그만
      const yLog = log.filter((e) => {
        const t = e.time ? Date.parse(e.time) : 0;
        return t >= sinceMs && t < untilMs;
      });
      const evaluated = yLog.length;
      const entries = yLog.filter((e) => e.mode === "live" && e.result?.ok && !e.dryRun);
      const exits = yLog.filter((e) => e.event === "position_closed");
      const skipped = yLog.filter((e) => !e.signal && e.reason);
      const realizedToday = exits.reduce((s, e) => s + (e.netPnL || 0), 0);
      // 잔고 조회 (status 끼어들기)
      const realStatus = await kv.get(`di:real:user:${uid}:status-cache`).catch(() => null);
      userActivities.push({
        userIdShort: uid.slice(0, 8),
        phase1Enabled: !!status,
        evaluated,
        entries: entries.length,
        exits: exits.length,
        skipped: skipped.length,
        realizedToday: Number(realizedToday.toFixed(2)),
        openPositions: Array.isArray(posPlans) ? posPlans.length : 0,
        equity: realStatus?.totalWalletBalance ? Number(realStatus.totalWalletBalance) : null,
      });
    } catch {}
  }
  return { phase1Count: phase1Users.length, users: userActivities };
}

// 마감 거래 아카이브 (retro 백테스트 자동화 input)
async function readClosedArchive(kv) {
  return (await kv.get(`di:real:user:${PROBE_USER}:shadow-closed-archive`)) || [];
}

// ★ Hurst bucket 분석 — 진입 시점 시장 레짐별 승률/PnL 집계.
// regime snapshot 이 entry 에 동봉되기 시작한 이후의 거래만 의미 있음 (이전 거래는
// regime: null → "unknown" bucket 으로 분류). 1주일치 데이터 누적되면 soft/strict
// 모드 승급 결정의 직접 근거.
function analyzeRegimeBuckets(archive) {
  if (!Array.isArray(archive) || archive.length === 0) return null;
  const buckets = {
    trending: { trades: 0, wins: 0, netPnL: 0, hurstSum: 0 },        // > 0.55
    transitional: { trades: 0, wins: 0, netPnL: 0, hurstSum: 0 },    // 0.45 ~ 0.55
    mean_reverting: { trades: 0, wins: 0, netPnL: 0, hurstSum: 0 },  // < 0.45
    unknown: { trades: 0, wins: 0, netPnL: 0, hurstSum: 0 },         // regime snapshot 없음
  };
  let withRegime = 0;
  for (const c of archive) {
    const h = c.regime?.avgHurst;
    let key = "unknown";
    if (Number.isFinite(h)) {
      withRegime += 1;
      if (h > 0.55) key = "trending";
      else if (h < 0.45) key = "mean_reverting";
      else key = "transitional";
    }
    const b = buckets[key];
    b.trades += 1;
    if ((c.netPnL || 0) > 0) b.wins += 1;
    b.netPnL += (c.netPnL || 0);
    if (Number.isFinite(h)) b.hurstSum += h;
  }
  // 정리
  const out = {};
  for (const [k, b] of Object.entries(buckets)) {
    if (b.trades === 0) continue;
    out[k] = {
      trades: b.trades,
      wins: b.wins,
      losses: b.trades - b.wins,
      winRate: Number(((b.wins / b.trades) * 100).toFixed(1)),
      netPnL: Number(b.netPnL.toFixed(2)),
      avgHurst: b.hurstSum > 0 ? Number((b.hurstSum / b.trades).toFixed(3)) : null,
    };
  }
  return {
    totalArchive: archive.length,
    withRegimeSnapshot: withRegime,
    coverage: archive.length ? Number(((withRegime / archive.length) * 100).toFixed(1)) : 0,
    buckets: out,
  };
}

// QUANT-RES 가 사용할 자동 백테스트 — OHLC 정확 시뮬 (Track B 통합)
// archive 가 있으면 archive 사용, 없으면 ledger.closed 30건 샘플 fallback.
// 변형 5개 (3 SL × 변동 TP) × 30건 ≈ 150 fetch ≈ 15~25초 (Vercel 60s 한도 내).
// Binance 451 차단은 Fly.io 프록시 자동 경유로 우회됨 (binance-client.js getKlines).
async function retroBacktest(archive, ledgerClosed) {
  // 입력: archive 우선, 부족하면 ledger.closed 사용
  let source = "archive";
  let pool = archive;
  if (!pool || pool.length < 10) {
    if (ledgerClosed && ledgerClosed.length >= 10) {
      // ledger.closed → batchBacktest 입력 형식으로 매핑
      pool = ledgerClosed.map((c) => ({
        id: c.id,
        symbol: c.plan?.symbol,
        side: c.plan?.side,
        openedAt: c.openedAt,
        entryPrice: c.entryPrice,
        notional: c.plan?.notional,
        riskAmount: c.plan?.riskAmount,
        feeBps: c.feeBps,
        slippageBps: c.slippageBps,
        netPnL: c.netPnL,
      }));
      source = "ledger.closed";
    } else {
      return null;
    }
  }

  // 샘플링 — 처음 30건. 변형 5개 × 30 = 150 OHLC fetch. 캐시로 중복 제거됨.
  const sampleSize = Math.min(30, pool.length);
  const sample = pool.slice(0, sampleSize);

  // 기준선 — 원본 룰 그대로 누적 손익
  const baselineNetPnL = sample.reduce((a, c) => a + (c.netPnL || 0), 0);
  const baselineWins = sample.filter((c) => (c.netPnL || 0) > 0).length;
  const baseline = {
    trades: sample.length,
    wins: baselineWins,
    losses: sample.length - baselineWins,
    winRate: sample.length ? Number(((baselineWins / sample.length) * 100).toFixed(1)) : 0,
    netPnL: Number(baselineNetPnL.toFixed(2)),
  };

  // 변형 매트릭스 — holdHours 다양화 (24h 안엔 SL/TP 안 닿는 박스권 패턴 발견 후 확장)
  // 가격 움직임이 24h 보다 더 긴 시간 필요한지 확인
  const matrix = [
    // 24h 한도 (기존)
    { slPct: 3, tpPct: 4, holdHours: 24 },  // RR 1.33
    { slPct: 3, tpPct: 6, holdHours: 24 },  // RR 2.00
    { slPct: 4, tpPct: 8, holdHours: 24 },  // RR 2.00 (SL 절반)
    // 48h 한도 — 더 긴 시간 두면 SL/TP 발동되는지
    { slPct: 4, tpPct: 8, holdHours: 48 },
    { slPct: 5, tpPct: 10, holdHours: 48 },
    // 72h 한도 — 큰 추세 노림
    { slPct: 5, tpPct: 12, holdHours: 72 }, // RR 2.4
    { slPct: 6, tpPct: 12, holdHours: 72 }, // 현재 룰과 비슷
  ];
  const variants = [];
  for (const v of matrix) {
    try {
      const agg = await batchBacktest(sample, v);
      if (agg && agg.trades > 0) {
        variants.push({
          slPct: v.slPct,
          tpPct: v.tpPct,
          holdHours: v.holdHours,
          rr: Number((v.tpPct / v.slPct).toFixed(2)),
          ...agg,
        });
      }
    } catch (e) {
      console.warn("[retroBacktest] variant skip:", e?.message);
    }
  }
  variants.sort((a, b) => (b.netPnL || -Infinity) - (a.netPnL || -Infinity));
  // ★ Hurst regime bucket 분석 (전체 archive 풀 대상, 샘플링 안 함 — 모든 데이터 활용)
  const regimeBuckets = analyzeRegimeBuckets(pool);
  return {
    sourceSize: pool.length,
    sampledSize: sample.length,
    source,
    baseline,
    topVariants: variants.slice(0, 3),
    regimeBuckets,
  };
}

// ── 실거래 활동 카드 빌더 (직관적, 짧게) ──
function buildRealTradingActivityCard(activity, summary) {
  if (!activity || activity.phase1Count === 0) {
    return buildCard({
      tag: "💼",
      title: "어제 실거래 활동",
      lines: ["등록된 실거래 유저 없음 — 바이낸스 키 등록 후 활성화하세요"],
    });
  }
  // 첫 번째 유저(본인) 기준 요약
  const me = activity.users[0];
  if (!me) {
    return buildCard({
      tag: "💼",
      title: "어제 실거래 활동",
      lines: ["활동 데이터 없음"],
    });
  }
  const lines = [];
  lines.push(`신호 평가 ${me.evaluated}회 · 진입 ${me.entries}건 · 청산 ${me.exits}건`);
  if (me.realizedToday !== 0) {
    const sign = me.realizedToday >= 0 ? "+" : "";
    lines.push(`어제 실현 손익: ${sign}$${me.realizedToday}`);
  }
  if (me.openPositions > 0) {
    lines.push(`현재 오픈 포지션: ${me.openPositions}건`);
  }
  if (me.equity !== null) {
    lines.push(`잔고: $${me.equity.toFixed(2)}${me.equity < 200 ? "  (< $200 = 진입 자동 차단)" : ""}`);
  }
  if (me.entries === 0 && me.skipped > 0) {
    lines.push(`스킵 사유 ${me.skipped}건 — 잔고 부족 또는 자동 차단`);
  }
  return buildCard({
    tag: "💼",
    title: "어제 실거래 활동",
    lines,
    hint: me.equity !== null && me.equity < 200
      ? "실거래 본격 가동 조건: 잔고 ≥ $200 + Phase 1 enable. 작은 금액으로 시작하려면 Phase 1 임계값 조정 필요"
      : undefined,
  });
}

// ── 가상매매 한 줄 참고 카드 (짧게) ──
function buildShadowReferenceCard(summary) {
  if (!summary) {
    return buildCard({
      tag: "🌙",
      title: "가상매매 (참고용)",
      lines: ["데이터 누적 중"],
    });
  }
  const total = (summary.wins || 0) + (summary.losses || 0);
  const wr = total ? ((summary.wins / total) * 100).toFixed(1) : "—";
  const pf = summary.profitFactor != null ? Number(summary.profitFactor).toFixed(2) : "—";
  const pnl = Number(summary.netPnL || 0).toFixed(2);
  const sign = (summary.netPnL || 0) >= 0 ? "+" : "";
  return buildCard({
    tag: "🌙",
    title: "가상매매 누적 (참고용)",
    lines: [
      `누적 ${total}건 · 승률 ${wr}% · 손익비 ${pf}`,
      `누적 손익 ${sign}$${pnl}`,
    ],
    footer: pf !== "—" && Number(pf) < 1.2 ? "손익비 1.2 미만 — 전략 개선 필요" : undefined,
  });
}

// ── Alpha Lab 카드 빌더 (Phase 1~6 시스템 결과 요약) ──
function buildAlphaLabCard(leaderboard, candidates) {
  if (!leaderboard) {
    return buildCard({
      tag: "🧬",
      title: "Alpha Lab — 24/7 알파 추적",
      lines: ["leaderboard 미생성 — alpha-lab cron 첫 실행 대기"],
    });
  }
  const strategies = leaderboard.strategies || {};
  const ranked = Object.entries(strategies)
    .map(([id, m]) => ({ id, ...m }))
    .sort((a, b) => (b.sharpe || 0) - (a.sharpe || 0));
  const top3 = ranked.slice(0, 3);
  const worst = ranked.slice(-1)[0];
  const regime = leaderboard.regime;
  const lines = [];
  if (regime) {
    const regimeKo = regime.regime === "trending" ? "추세장" :
                     regime.regime === "mean_reverting" ? "역추세장" :
                     regime.regime === "transitional" ? "혼조" : regime.regime;
    lines.push(`시장 레짐: ${regimeKo} (Hurst ${regime.hurst?.toFixed(3) || "—"}, ATR ${regime.atrRatio?.toFixed(2) || "—"}x)`);
  }
  if (top3.length > 0) {
    lines.push(`상위 3전략 (Sharpe 기준):`);
    for (const s of top3) {
      lines.push(`  · ${s.id}: ${s.trades}건, Sharpe ${s.sharpe?.toFixed(2)}, PF ${s.profitFactor != null ? s.profitFactor.toFixed(2) : "—"}`);
    }
  }
  if (worst && worst !== top3[0] && (worst.sharpe || 0) < 0) {
    lines.push(`주의: ${worst.id} Sharpe ${worst.sharpe?.toFixed(2)} (${worst.trades}건)`);
  }
  const candCount = Array.isArray(candidates) ? candidates.length : 0;
  if (candCount > 0) {
    lines.push(`관찰중 후보 전략: ${candCount}개`);
  }
  return buildCard({
    tag: "🧬",
    title: "Alpha Lab — 24/7 알파 추적",
    lines,
    footer: leaderboard.generatedAt ? `갱신 ${leaderboard.generatedAt}` : undefined,
  });
}

// ── 안전 JSON 파싱 (Claude 응답에서 마크다운 코드블록 제거) ──
function safeJSONParse(text) {
  if (!text) return null;
  // ★ 2026-06-03: 견고화 — 코드블록 / raw / 첫{~마지막} 추출을 차례로 시도(산문 혼입·truncation 대비).
  const candidates = [];
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (m) candidates.push(m[1]);
  candidates.push(text);
  const fi = text.indexOf("{"), li = text.lastIndexOf("}");
  if (fi >= 0 && li > fi) candidates.push(text.slice(fi, li + 1));
  for (const c of candidates) {
    try {
      const v = JSON.parse(String(c).trim());
      if (v && typeof v === "object") return v;
    } catch { /* 다음 후보 */ }
  }
  return null;
}

// ── QUANT-RES — 알파 리서처 ──
async function runQuantResearcher(client, ledger, weights, summary, retroResult) {
  // CLOSED 항목만 승률 산정 — OPEN 은 결과 미확정이라 제외
  const closed = ledger.filter((e) => e?.status === "CLOSED");
  const winRate = closed.length ? closed.filter((e) => (e?.netPnL || 0) > 0).length / closed.length : 0;

  const familyStats = {};
  for (const e of closed) {
    const fam = e?.plan?.strategyFamily || e?.signal?.strategyFamily || e?.signal?.source || "기타";
    familyStats[fam] = familyStats[fam] || { count: 0, wins: 0, pnlSum: 0 };
    familyStats[fam].count++;
    if ((e?.netPnL || 0) > 0) familyStats[fam].wins++;
    familyStats[fam].pnlSum += (e?.netPnL || 0);
  }

  const sys = `당신은 Zepta 의 시니어 퀀트 알파 리서처(QUANT-RES)입니다.
- 페르소나: 8년차 퀀트, 통계학 박사. 솔직하고 데이터 중심.
- 출력: 한국어 존댓말. 사용자가 "투자 입문자"라고 가정하고 평어로 풀어 설명.
- 절대 어려운 전문 용어 그대로 쓰지 말 것 — 풀어서 비유 들기.
- "그래서 뭘 하면 되나" 행동 가이드 포함.
- 백테스트 결과(retroBacktest)가 주어지면 그 데이터를 첫 번째 근거로 활용.
- JSON 만 응답 (마크다운 코드블록 안에 넣어도 됨).`;

  const openCount = ledger.length - closed.length;

  // 종목별 누적 통계 (shadow-summary.bySymbol) — 자동 차단·가중치 input
  let bySymbolBlock = "(아직 종목별 누적 통계 부족)";
  if (summary?.bySymbol && Object.keys(summary.bySymbol).length > 0) {
    const symStats = Object.entries(summary.bySymbol)
      .map(([sym, s]) => ({
        sym,
        trades: s.trades || 0,
        wins: s.wins || 0,
        netPnL: s.netPnL || 0,
        winRate: s.trades > 0 ? (s.wins / s.trades) * 100 : 0,
      }))
      .filter((x) => x.trades >= 5)
      .sort((a, b) => b.trades - a.trades)
      .slice(0, 10);
    if (symStats.length) {
      const lines = symStats.map((x) =>
        `  · ${x.sym}: ${x.trades}건, 승률 ${x.winRate.toFixed(0)}%, 누적 ${x.netPnL >= 0 ? "+" : ""}$${x.netPnL.toFixed(2)}` +
        (x.trades >= 20 && x.winRate < 30 ? "  🔴 자동 차단" : x.trades >= 20 && x.winRate >= 70 ? "  🟢 우수" : "")
      );
      bySymbolBlock = lines.join("\n");
    }
  }

  // Retro 백테스트 결과를 자연어로 풀어서 입력 (LLM 이 바로 활용 가능하도록)
  let retroBlock = "(아카이브 부족 — 백테스트 자동화 미가동)";
  if (retroResult && retroResult.sampledSize >= 10) {
    const lines = [
      `${retroResult.source} ${retroResult.sampledSize}건 OHLC 백테스트 결과 (Binance 5m 분봉, 24h maxHold):`,
    ];
    if (retroResult.baseline) {
      lines.push(`- 현재 룰 기준선: 승률 ${retroResult.baseline.winRate}%, 누적 손익 $${retroResult.baseline.netPnL}`);
    }
    if (retroResult.topVariants?.length) {
      lines.push(`- 변형 매트릭스 결과 (상위 3):`);
      for (const v of retroResult.topVariants) {
        lines.push(`  · SL ${v.slPct}% / TP ${v.tpPct}% (RR ${v.rr}): 승률 ${v.winRate}%, 손익 $${v.netPnL}, ${v.byCloseReason?.SL||0}SL/${v.byCloseReason?.TP||0}TP/${v.byCloseReason?.TIME||0}TIME`);
      }
      const best = retroResult.topVariants[0];
      const baseline = retroResult.baseline;
      if (best && baseline) {
        const delta = (best.netPnL || 0) - (baseline.netPnL || 0);
        if (delta > 0) {
          lines.push(`  → 최고 변형이 기준선 대비 +$${delta.toFixed(2)} 개선 (OHLC 시뮬상)`);
        } else {
          lines.push(`  → 모든 변형이 기준선과 비슷하거나 못함 — 진입 룰 자체 재검토 필요`);
        }
      }
    } else {
      lines.push(`- 변형 매트릭스 fetch 실패 — 다음 cron 재시도`);
    }
    retroBlock = lines.join("\n");
  } else if (retroResult) {
    retroBlock = `${retroResult.source} 데이터 ${retroResult.sourceSize}건 (10건 미만, 통계 의미 부족)`;
  }

  // ★ Hurst regime bucket 분석 — 어떤 시장 환경에서 들어간 거래가 이겼는지 (regime filter 승급 근거)
  let regimeBlock = "(레짐 스냅샷 데이터 부족 — 1주일 누적 후 의미 있어짐)";
  if (retroResult?.regimeBuckets) {
    const rb = retroResult.regimeBuckets;
    if (rb.withRegimeSnapshot >= 5) {
      const lines = [
        `진입 시점 시장 레짐별 성과 (snapshot ${rb.withRegimeSnapshot}/${rb.totalArchive}건, ${rb.coverage}% 커버):`,
      ];
      const order = ["trending", "transitional", "mean_reverting", "unknown"];
      const labels = {
        trending: "추세장 (Hurst > 0.55)",
        transitional: "혼조 (Hurst 0.45~0.55)",
        mean_reverting: "역추세장 (Hurst < 0.45)",
        unknown: "레짐 미기록 (이전 거래)",
      };
      for (const k of order) {
        const b = rb.buckets[k];
        if (!b) continue;
        const pnlSign = b.netPnL >= 0 ? "+" : "";
        const avgH = b.avgHurst != null ? ` 평균H=${b.avgHurst}` : "";
        lines.push(`  · ${labels[k]}: ${b.trades}건, 승률 ${b.winRate}%, 손익 ${pnlSign}$${b.netPnL}${avgH}`);
      }
      // 권고 자동 도출
      const tr = rb.buckets.trending;
      const mr = rb.buckets.mean_reverting;
      const tx = rb.buckets.transitional;
      if (tr && mr && tr.trades >= 5 && mr.trades >= 5) {
        if (tr.winRate - mr.winRate > 15) {
          lines.push(`  → 추세장 승률이 역추세장 대비 +${(tr.winRate - mr.winRate).toFixed(0)}%p 우세 — soft 또는 strict 모드 승급 검토 가치 있음`);
        } else if (Math.abs(tr.winRate - mr.winRate) < 5) {
          lines.push(`  → 레짐 차이로 승률이 크게 갈리지 않음 — Hurst gating 효과 제한적, log 모드 유지 권고`);
        }
      }
      if (tx && tx.trades >= 5 && tx.winRate < 30) {
        lines.push(`  → 혼조 구간 (${tx.trades}건) 에서 승률 ${tx.winRate}% — strict 모드면 이 구간을 차단하므로 net 개선 가능성 있음`);
      }
      regimeBlock = lines.join("\n");
    } else {
      regimeBlock = `진입 시점 레짐 snapshot 누적 부족 (${rb.withRegimeSnapshot}건). 5월 4일 이후 거래부터 기록 시작 → 1주 후부터 의미 있음`;
    }
  }

  const user = `오늘 아침 분석 보고서 작성 요청입니다.

[지난 7일 shadow ledger 요약]
- 전체 가상 거래: ${ledger.length}건 (마감 ${closed.length} / 진행 ${openCount})
- 가상 승률 (마감 기준): ${(winRate * 100).toFixed(1)}%
- 패밀리별 성과 (마감 기준):
${Object.entries(familyStats).map(([f, s]) =>
  `  · ${f}: ${s.count}건, 승률 ${s.count ? ((s.wins/s.count)*100).toFixed(0) : 0}%, 누적 가상손익 ${s.pnlSum.toFixed(2)}`
).join("\n") || "  (마감된 거래 없음)"}
- 누적 요약: ${summary ? JSON.stringify({ wins: summary.wins, losses: summary.losses, netPnL: Number(summary.netPnL || 0).toFixed(2), profitFactor: summary.profitFactor }) : "(없음)"}
- 현재 가중치: ${JSON.stringify(weights).slice(0, 400)}

[종목별 누적 성과 (영구 통계, 자동 차단 기준 = 20건+ AND 승률<30%)]
${bySymbolBlock}

[Retro 백테스트 결과 — 다른 SL/TP 룰 적용 시뮬]
${retroBlock}

위 retro 결과가 있으면 그게 가장 신뢰도 높은 근거입니다. alpha_idea 와 action 은 retro 데이터에 부합해야 합니다.

다음 형식의 JSON 으로만 답변:
{
  "headline": "한 줄 요약 (예: 추세 추종 전략이 잘 통했지만 변동성 폭발 구간엔 약했어요)",
  "yesterday": ["어제 잘 된 것 1", "어제 부진했던 것 1"],
  "today_watch": "오늘 시장에서 주의 깊게 볼 포인트 1~2줄",
  "alpha_idea": {
    "name": "새 알파 후보 이름 (retro 결과 활용 시 명시)",
    "why": "왜 시도해볼 만한지 평어로 1~2문장 (retro 수치 인용 가능)",
    "how": "어떻게 검증할지 (예: 30일 백테스트)"
  },
  "retro_recommendation": "retro 데이터가 있으면 추천 SL/TP/RR 한 줄, 없으면 빈 문자열",
  "action": "대표가 오늘 할 만한 일 (예: 'SL 4% TP 6% 변형을 shadow 1주 운영')"
}`;

  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: 1500,
    system: sys,
    messages: [{ role: "user", content: user }],
  });

  const text = resp.content?.[0]?.text || "";
  return safeJSONParse(text) || { headline: "리서치 응답 파싱 실패", _raw: text.slice(0, 500) };
}

// ── QUANT-PLAN — 전략 기획자 ──
async function runQuantPlanner(client, ledger, weights, research) {
  const closed = ledger.filter((e) => e?.status === "CLOSED");
  const familyStats = {};
  for (const e of closed) {
    const fam = e?.plan?.strategyFamily || e?.signal?.strategyFamily || e?.signal?.source || "기타";
    familyStats[fam] = familyStats[fam] || { count: 0, wins: 0, pnlSum: 0 };
    familyStats[fam].count++;
    if ((e?.netPnL || 0) > 0) familyStats[fam].wins++;
    familyStats[fam].pnlSum += (e?.netPnL || 0);
  }

  const sys = `당신은 Zepta 의 시니어 퀀트 전략 기획자(QUANT-PLAN)입니다.
- 페르소나: 10년차 퀀트 PM. 의사결정 단호하되 근거 명확. 데이터 부족하면 보류 결정도 OK.
- 역할: 리서처 리포트(QUANT-RES) 와 shadow ledger 통계를 종합해 운용 결정을 내림.
- 결정 원칙:
  1) 리서처가 제안한 알파 후보가 합리적이면 ⇒ 백테스트 단계로 promote 추천
  2) 패밀리별 마감 거래 ≥ 30건이고 승률·누적손익이 명백히 부진 ⇒ demote 또는 가중치 하향
  3) 패밀리별 마감 거래 ≥ 30건이고 명백히 양호 ⇒ promote 또는 가중치 상향
  4) 30건 미만이면 통계적 유의성 부족 ⇒ 가중치 조정 보류, "데이터 더 필요" 명시
  5) 리서처가 위험 시그널을 짚었으면 ⇒ risk_note 에 반드시 반영
- 출력: 한국어 존댓말, 평어. JSON 만 응답 (마크다운 코드블록 가능).`;

  const user = `오늘 자 전략 운용 결정을 내려주세요.

[리서처(QUANT-RES) 핵심 보고]
- 헤드라인: ${research?.headline || "(없음)"}
- 어제 진단: ${JSON.stringify(research?.yesterday || []).slice(0, 400)}
- 오늘 주목: ${research?.today_watch || "(없음)"}
- 새 알파 후보: ${research?.alpha_idea?.name || "(없음)"} — ${research?.alpha_idea?.why || ""}
- 리서처 제안 행동: ${research?.action || "(없음)"}

[shadow ledger 통계 — 마감 ${closed.length}건 기준]
${Object.entries(familyStats).map(([f, s]) =>
  `- ${f}: ${s.count}건, 승률 ${s.count ? ((s.wins/s.count)*100).toFixed(0) : 0}%, 누적손익 ${s.pnlSum.toFixed(2)}`
).join("\n") || "- (마감 거래 없음)"}

[현재 가중치]
${JSON.stringify(weights).slice(0, 400)}

다음 형식의 JSON 으로만 답변:
{
  "headline": "한 줄 요약 (예: '거래량돌파' 가중치 하향 + 리서치 제안 알파 후보 백테스트 단계 진입)",
  "promote": [{"name":"전략명/알파명", "reason":"평어 한 줄"}],
  "demote": [{"name":"전략명", "reason":"평어 한 줄"}],
  "weight_changes": [{"name":"전략명", "from":1.0, "to":1.2, "why":"평어 한 줄"}],
  "risk_note": "오늘 특별히 주의할 시장 리스크 (리서처 경고 반영)"
}`;

  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: 2000, // ★ 2026-06-03: 1200→2000 (promote/demote/weight_changes 배열로 길어져 truncation 발생)
    system: sys,
    messages: [{ role: "user", content: user }],
  });

  const text = resp.content?.[0]?.text || "";
  return safeJSONParse(text) || { headline: "기획 응답 파싱 실패", _raw: text.slice(0, 500) };
}

// ── 텔레그램 카드 빌드 ──
function buildCardsForResearch(r) {
  if (!r || r._raw) {
    return buildCard({
      tag: "🧪",
      title: "QUANT-RES — 오늘의 알파 리서치",
      lines: ["응답 파싱 실패 — 원본을 확인해주세요"],
      footer: r?._raw || "",
    });
  }
  return buildCard({
    tag: "🧪",
    title: "QUANT-RES — 오늘의 알파 리서치",
    lines: [
      r.headline,
      ...(r.yesterday || []).map((s) => `어제: ${s}`),
      r.today_watch ? `오늘 주목: ${r.today_watch}` : "",
      r.alpha_idea ? `새 후보: ${r.alpha_idea.name} — ${r.alpha_idea.why}` : "",
      r.retro_recommendation ? `백테스트 권고: ${r.retro_recommendation}` : "",
    ],
    hint: r.action,
    footer: `검증: ${r.alpha_idea?.how || "-"}`,
  });
}

function buildCardsForPlan(p) {
  if (!p || p._raw) {
    return buildCard({
      tag: "🎯",
      title: "QUANT-PLAN — 오늘의 전략 운용 결정",
      lines: ["응답 파싱 실패 — 원본을 확인해주세요"],
      footer: p?._raw || "",
    });
  }
  const lines = [p.headline];
  for (const x of p.promote || []) lines.push(`승급: ${x.name} — ${x.reason}`);
  for (const x of p.demote || []) lines.push(`중단: ${x.name} — ${x.reason}`);
  for (const x of p.weight_changes || []) lines.push(`가중치 ${x.name}: ${x.from} → ${x.to} (${x.why})`);
  return buildCard({
    tag: "🎯",
    title: "QUANT-PLAN — 오늘의 전략 운용 결정",
    lines,
    hint: p.risk_note,
  });
}

// ── MKT-LEAD — 시니어 그로스 마케터 ──
async function runMarketingLead(client, research, latestQuant, ga4, sentry) {
  const sys = `당신은 Zepta 의 시니어 그로스 마케터(MKT-LEAD)입니다.
- 페르소나: 8년차 그로스 마케터 + SEO 전문가. 한국 핀테크 시장(토스/뱅크샐러드/카카오페이) 잘 알고 있음.
- 역할: 오늘 시장·퀀트·실유입 데이터를 종합해 Zepta 의 유입을 늘릴 콘텐츠 1건과 SEO/광고 전략 제안.
- 데이터 우선순위:
  1) 어제 GA4 실측 (있으면 가장 큰 가중치)
  2) 퀀트 리서치 헤드라인 (오늘 발행 콘텐츠 후크 소재)
  3) Sentry 사용자 영향 이슈 (있으면 "사이트 안정성 메시지"로 활용 가능)
- 톤: 한국어 존댓말, 평어. 실용 중심. 광고 카피 톤은 자제.
- 콘텐츠는 네이버 블로그 / 티스토리 / 트위터(X) 중 가장 유리한 채널 1개 선택.
- 출력: JSON 만 응답.`;

  const today = new Date().toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" });

  // GA4 컨텍스트 — 없으면 비워두고 LLM 이 알아서 처리
  let ga4Block = "(GA4 미연동 — 일반 컨텍스트로 작성)";
  if (ga4 && !ga4.error) {
    const topPagesStr = (ga4.topPages || []).slice(0, 3).map((p) => `${p.path}(${p.pageviews}회)`).join(", ");
    const topChStr = (ga4.topChannels || []).slice(0, 3).map((c) => `${c.channel}(${c.sessions}세션)`).join(", ");
    ga4Block = [
      `- 어제 사용자 ${ga4.users}명, 세션 ${ga4.sessions}건, 페이지뷰 ${ga4.pageviews}건`,
      `- 평균 세션 ${(ga4.avgSessionDurationSec || 0).toFixed(0)}초, 이탈률 ${((ga4.bounceRate || 0) * 100).toFixed(0)}%`,
      `- 인기 페이지: ${topPagesStr || "(없음)"}`,
      `- 유입 채널: ${topChStr || "(없음)"}`,
    ].join("\n");
  }

  let sentryBlock = "(Sentry 미연동)";
  if (sentry && !sentry.error) {
    const newCount = sentry.newIssues?.length || 0;
    const topErr = sentry.topIssues?.[0];
    sentryBlock = `- 어제 새 이슈 ${newCount}건${topErr ? ` · 가장 잦은 이슈: "${topErr.title}" (${topErr.count}회 / ${topErr.userCount}명 영향)` : ""}`;
  }

  const user = `오늘(${today}) Zepta 마케팅 데일리 제안 작성 요청입니다.

[어제 GA4 실유입 데이터]
${ga4Block}

[Sentry 사이트 안정성]
${sentryBlock}

[퀀트 리서치 헤드라인]
${research?.headline || "(없음)"}
- 어제 진단: ${JSON.stringify(research?.yesterday || []).slice(0, 200)}
- 새 알파 후보: ${research?.alpha_idea?.name || "(없음)"}

[최근 자동 백테스트 요약]
${latestQuant ? JSON.stringify({
  batch: latestQuant.batch,
  topSymbol: latestQuant.topSharpe?.[0]?.name,
  topStrat: latestQuant.stratRank?.[0]?.name,
}).slice(0, 300) : "(없음)"}

다음 형식의 JSON 으로만 답변:
{
  "headline": "오늘의 그로스 한 줄 (어제 GA4 데이터에 근거하여 — 데이터 있으면 활용)",
  "yesterday_summary": "어제 유입 한 줄 요약 (GA4 있으면 실수치, 없으면 '데이터 미연동')",
  "content_idea": {
    "channel": "네이버블로그 | 티스토리 | 트위터",
    "title": "발행할 글 제목 (검색 타이틀로 클릭 유도)",
    "angle": "핵심 메시지 한 문장",
    "outline": ["섹션1 한 줄", "섹션2 한 줄", "섹션3 한 줄"]
  },
  "seo_keywords": ["키워드1", "키워드2", "키워드3"],
  "social_post": "트위터/스레드용 짧은 게시물 280자 이내",
  "ads_note": "쿠팡파트너스/AdSense 배치·문구 최적화 1건 (선택)",
  "channel_diagnosis": "GA4 데이터 있으면: 어떤 유입 채널을 강화/축소해야 할지 한 줄. 없으면 빈 문자열."
}`;

  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: 1300,
    system: sys,
    messages: [{ role: "user", content: user }],
  });

  const text = resp.content?.[0]?.text || "";
  return safeJSONParse(text) || { headline: "마케팅 응답 파싱 실패", _raw: text.slice(0, 500) };
}

// ── PLAN-SVC — 시니어 서비스 기획자 (Week 3) ──
async function runServicePlanner(client, ga4, sentry, research) {
  const sys = `당신은 Zepta 의 시니어 서비스 기획자(PLAN-SVC)입니다.
- 페르소나: 8년차 서비스/프로덕트 기획자. 토스, 카카오페이 수준 핀테크 UX 감각.
- 역할: 어제의 사용자 행동 데이터(GA4)와 사이트 안정성(Sentry)을 보고 오늘 적용 가능한 화면·UX 개선 1건을 제안.
- 출력 원칙:
  · 이탈률·세션 시간·인기 페이지에서 단서 찾기
  · "어떤 화면의 어떤 부분이 문제고, 어떻게 고치면 되는지" 명확하게
  · 개발팀(DEV-IMPL)이 즉시 착수 가능한 수준의 구체성
- 출력: JSON 만 응답.`;

  let ctx = "(GA4 미연동 — 일반 기획 관점으로)";
  if (ga4 && !ga4.error) {
    const topPagesStr = (ga4.topPages || []).slice(0, 3).map((p) => `${p.path}(${p.pageviews}회)`).join(", ");
    ctx = [
      `- 어제 사용자 ${ga4.users}명, 세션 ${ga4.sessions}건`,
      `- 평균 세션 ${(ga4.avgSessionDurationSec || 0).toFixed(0)}초, 이탈률 ${((ga4.bounceRate || 0) * 100).toFixed(0)}%`,
      `- 인기 페이지 TOP3: ${topPagesStr}`,
    ].join("\n");
  }
  const sentryCtx = sentry && !sentry.error
    ? `Sentry 어제 새 이슈 ${(sentry.newIssues || []).length}건${sentry.topIssues?.[0] ? `, 가장 잦은 이슈 "${sentry.topIssues[0].title}" (${sentry.topIssues[0].userCount}명 영향)` : ""}`
    : "(Sentry 미연동)";

  const user = `오늘 자 서비스 기획 데일리 제안 작성 요청입니다.

[어제 GA4]
${ctx}

[Sentry]
${sentryCtx}

[퀀트 리서치 헤드라인]
${research?.headline || "(없음)"}

다음 형식의 JSON 으로만 답변:
{
  "headline": "오늘의 화면 개선 한 줄 (예: '홈 인사 카드 아래 마켓 브리핑 위치 변경 → 첫 진입 후 5초 안에 가치 인지 향상')",
  "diagnosis": "어제 데이터에서 발견된 핵심 문제 한 줄 (이탈률·인기 페이지·세션 시간 근거)",
  "proposal": {
    "screen": "어느 화면 (예: home, screener, auto-trading)",
    "change": "구체적 변경 (예: '인사 카드 옆 우측에 1탭으로 가는 추천 종목 3개 카드 추가')",
    "rationale": "왜 이게 효과적인지 평어 한 줄",
    "dev_estimate": "개발 난이도 (Easy/Medium/Hard) + 예상 시간"
  },
  "metrics_to_watch": ["측정할 지표 1~3개"]
}`;

  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: 1100,
    system: sys,
    messages: [{ role: "user", content: user }],
  });
  const text = resp.content?.[0]?.text || "";
  return safeJSONParse(text) || { headline: "서비스 기획 응답 파싱 실패", _raw: text.slice(0, 500) };
}

function buildCardsForServicePlanner(s) {
  if (!s || s._raw) {
    return buildCard({
      tag: "📐",
      title: "PLAN-SVC — 오늘의 화면 개선 제안",
      lines: ["응답 파싱 실패"],
      footer: s?._raw || "",
    });
  }
  const lines = [s.headline];
  if (s.diagnosis) lines.push(`진단: ${s.diagnosis}`);
  if (s.proposal) {
    lines.push(`제안 화면: ${s.proposal.screen}`);
    lines.push(`변경: ${s.proposal.change}`);
    if (s.proposal.rationale) lines.push(`이유: ${s.proposal.rationale}`);
    if (s.proposal.dev_estimate) lines.push(`난이도: ${s.proposal.dev_estimate}`);
  }
  if (s.metrics_to_watch?.length) lines.push(`관찰 지표: ${s.metrics_to_watch.join(", ")}`);
  return buildCard({
    tag: "📐",
    title: "PLAN-SVC — 오늘의 화면 개선 제안",
    lines,
  });
}

// ── PLAN-BIZ — 시니어 사업 기획자 (Week 3) ──
async function runBusinessPlanner(client, ga4, research, marketing) {
  const sys = `당신은 Zepta 의 시니어 사업 기획자(PLAN-BIZ)입니다.
- 페르소나: 10년차 사업 기획 / 전략 컨설턴트. 한국 핀테크 시장 깊이 이해.
- 역할: Zepta 의 유입·수익 다각화 관점에서 오늘 추진 가능한 사업 액션 1건 제안.
- 관점: 토스/뱅크샐러드/카카오페이/Robinhood 와의 차별화, 광고 외 수익 모델 (프리미엄, 제휴, B2B 등).
- 출력: JSON 만 응답.`;

  let ga4Ctx = "(GA4 미연동)";
  if (ga4 && !ga4.error) {
    ga4Ctx = `어제 사용자 ${ga4.users}명, 세션 ${ga4.sessions}건, 페이지뷰 ${ga4.pageviews}건, 이탈률 ${((ga4.bounceRate || 0) * 100).toFixed(0)}%`;
  }

  const user = `오늘 자 사업 기획 데일리 제안 작성 요청입니다.

[어제 GA4 트래픽]
${ga4Ctx}

[퀀트 리서치 헤드라인]
${research?.headline || "(없음)"}

[오늘 마케팅 콘텐츠 방향]
${marketing?.headline || "(없음)"}

다음 형식의 JSON 으로만 답변:
{
  "headline": "오늘의 사업 액션 한 줄 (예: '쿠팡 파트너스 배치 최적화로 RPM 20% 상승 노리기' / '프리미엄 백테스트 무제한 티어 출시 검토')",
  "competitor_radar": "한국 경쟁사(토스증권/뱅크샐러드/리더스 등) 어제~최근 변화 한 줄 (있으면)",
  "opportunity": {
    "type": "유입확대 | 수익다각화 | 리텐션 | 차별화",
    "idea": "구체적 아이디어 한 문장",
    "why_now": "왜 지금이 적기인지 한 문장",
    "first_step": "오늘 안에 할 수 있는 첫 행동 1개 (시간 단위 작업)"
  },
  "risk": "주의해야 할 리스크 한 줄"
}`;

  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: 1000,
    system: sys,
    messages: [{ role: "user", content: user }],
  });
  const text = resp.content?.[0]?.text || "";
  return safeJSONParse(text) || { headline: "사업 기획 응답 파싱 실패", _raw: text.slice(0, 500) };
}

function buildCardsForBusinessPlanner(b) {
  if (!b || b._raw) {
    return buildCard({
      tag: "💼",
      title: "PLAN-BIZ — 오늘의 사업 액션 제안",
      lines: ["응답 파싱 실패"],
      footer: b?._raw || "",
    });
  }
  const lines = [b.headline];
  if (b.competitor_radar) lines.push(`경쟁사: ${b.competitor_radar}`);
  if (b.opportunity) {
    lines.push(`기회 [${b.opportunity.type}]: ${b.opportunity.idea}`);
    if (b.opportunity.why_now) lines.push(`타이밍: ${b.opportunity.why_now}`);
    if (b.opportunity.first_step) lines.push(`첫 행동: ${b.opportunity.first_step}`);
  }
  return buildCard({
    tag: "💼",
    title: "PLAN-BIZ — 오늘의 사업 액션 제안",
    lines,
    hint: b.risk,
  });
}

// ── DEV-IMPL — 시니어 구현 엔지니어 (Week 4) ──
async function runDevImplementer(client, sentry) {
  const sys = `당신은 Zepta 의 시니어 구현 엔지니어(DEV-IMPL)입니다.
- 페르소나: 8년차 풀스택. React + Vercel 환경 깊이 이해.
- 역할: Sentry 어제 이슈를 트리아지하고 오늘 즉시 착수할 픽스 후보 1건을 제안.
- 트리아지 원칙:
  · 사용자 영향(userCount) × 빈도(count) 가중 — 큰 게 우선
  · level=error/fatal > warning
  · firstSeen 이 어제 안이고 미해결이면 회귀 가능성
- 출력: 한국어 존댓말, 간결. JSON 만 응답.`;

  let sentryBlock = "(Sentry 미연동 — 어제 이슈 분석 불가)";
  if (sentry && !sentry.error) {
    const newCount = (sentry.newIssues || []).length;
    const topNew = (sentry.newIssues || []).slice(0, 3).map((i) =>
      `· [${i.level}] "${i.title}" — ${i.count}회/${i.userCount}명, ${i.culprit || "?"}`
    ).join("\n") || "(없음)";
    const topRecurring = (sentry.topIssues || []).slice(0, 3).map((i) =>
      `· "${i.title}" — ${i.count}회/${i.userCount}명, ${i.culprit || "?"}`
    ).join("\n") || "(없음)";
    sentryBlock = [
      `어제 새 이슈 ${newCount}건`,
      `[새 이슈 TOP3]`,
      topNew,
      `[누적 자주 발생 TOP3]`,
      topRecurring,
    ].join("\n");
  }

  const user = `오늘 자 픽스 후보 트리아지 요청입니다.

[Sentry 어제 데이터]
${sentryBlock}

다음 형식의 JSON 으로만 답변:
{
  "headline": "오늘 픽스 권고 한 줄 (예: '결제 모달 null 참조 에러 → 30분 내 픽스 가능')",
  "summary": "어제 사이트 안정성 한 줄 진단 (영향 받은 사용자 수 기준)",
  "fix_candidate": {
    "issue": "이슈 제목 또는 요약",
    "severity": "P0 (서비스 중단) | P1 (주요 기능) | P2 (부분 기능) | P3 (마이너)",
    "user_impact": "영향 받은 사용자 / 빈도",
    "suspected_cause": "원인 추정 1~2문장",
    "fix_approach": "어떻게 고칠지 1문장",
    "estimated_time": "픽스 예상 시간 (예: 30분, 2시간)"
  },
  "regression_alert": "회귀 의심 이슈가 있다면 한 줄, 없으면 빈 문자열"
}`;

  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: 1100,
    system: sys,
    messages: [{ role: "user", content: user }],
  });
  const text = resp.content?.[0]?.text || "";
  return safeJSONParse(text) || { headline: "DEV-IMPL 응답 파싱 실패", _raw: text.slice(0, 500) };
}

function buildCardsForDevImplementer(d) {
  if (!d || d._raw) {
    return buildCard({
      tag: "🔧",
      title: "DEV-IMPL — 오늘의 픽스 후보",
      lines: ["응답 파싱 실패"],
      footer: d?._raw || "",
    });
  }
  const lines = [d.headline];
  if (d.summary) lines.push(`어제 진단: ${d.summary}`);
  if (d.fix_candidate) {
    const fc = d.fix_candidate;
    lines.push(`이슈 [${fc.severity}]: ${fc.issue}`);
    if (fc.user_impact) lines.push(`영향: ${fc.user_impact}`);
    if (fc.suspected_cause) lines.push(`원인: ${fc.suspected_cause}`);
    if (fc.fix_approach) lines.push(`접근: ${fc.fix_approach}`);
    if (fc.estimated_time) lines.push(`예상 시간: ${fc.estimated_time}`);
  }
  return buildCard({
    tag: "🔧",
    title: "DEV-IMPL — 오늘의 픽스 후보",
    lines,
    hint: d.regression_alert || undefined,
  });
}

// ── DEV-PERF — 시니어 성능 엔지니어 (Week 4) ──
async function runDevPerf(client, ga4, sentry) {
  const sys = `당신은 Zepta 의 시니어 성능 엔지니어(DEV-PERF)입니다.
- 페르소나: 7년차 퍼포먼스 엔지니어. Web Vitals, 번들 사이즈, React 렌더링 최적화 전문.
- 역할: 어제 사용자 데이터(GA4 평균 세션 시간/이탈률) + 사이트 안정성을 보고 성능 회귀나 개선 포인트 1건 제안.
- 신호 해석:
  · 이탈률 ↑ + 평균 세션 ↓ → 첫 페인트 / 인터랙션 회귀 의심
  · Sentry 에 "Long task" / "Hydration" / "Out of memory" 류 → 성능 이슈
  · 데이터 부족하면 "오늘은 모니터 모드" 라고 솔직히 말할 것
- 출력: JSON 만 응답.`;

  let ga4Block = "(GA4 미연동)";
  if (ga4 && !ga4.error) {
    ga4Block = [
      `- 사용자 ${ga4.users}, 세션 ${ga4.sessions}, 페이지뷰 ${ga4.pageviews}`,
      `- 평균 세션 ${(ga4.avgSessionDurationSec || 0).toFixed(0)}초`,
      `- 이탈률 ${((ga4.bounceRate || 0) * 100).toFixed(0)}%`,
    ].join("\n");
  }
  const sentryBlock = sentry && !sentry.error
    ? `최근 미해결 이슈 ${(sentry.topIssues || []).length}건. 상위: ${(sentry.topIssues || []).slice(0, 3).map((i) => `"${i.title}" ${i.count}회`).join(" / ") || "(없음)"}`
    : "(Sentry 미연동)";

  const user = `오늘 자 성능 모니터 보고 요청입니다.

[어제 GA4]
${ga4Block}

[Sentry 누적 이슈]
${sentryBlock}

다음 형식의 JSON 으로만 답변:
{
  "headline": "오늘의 성능 한 줄 (예: '이탈률 어제 대비 +12% — 첫 페인트 회귀 의심, 즉시 점검 필요')",
  "verdict": "Green (정상) | Yellow (관찰 필요) | Red (즉시 조치)",
  "concern": "현재 가장 우려되는 지표 한 줄 (없으면 '특이사항 없음')",
  "action": "오늘 할 수 있는 액션 1건 (예: 'Lighthouse 모바일 측정 후 LCP 비교')",
  "watch_list": ["관찰 지표 1~3개"]
}`;

  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: 800,
    system: sys,
    messages: [{ role: "user", content: user }],
  });
  const text = resp.content?.[0]?.text || "";
  return safeJSONParse(text) || { headline: "DEV-PERF 응답 파싱 실패", _raw: text.slice(0, 500) };
}

function buildCardsForDevPerf(p) {
  if (!p || p._raw) {
    return buildCard({
      tag: "⚡",
      title: "DEV-PERF — 오늘의 성능 모니터",
      lines: ["응답 파싱 실패"],
      footer: p?._raw || "",
    });
  }
  const verdictTag =
    p.verdict === "Red" ? "🔴" :
    p.verdict === "Yellow" ? "🟡" :
    p.verdict === "Green" ? "🟢" : "⚡";
  const lines = [`[${verdictTag} ${p.verdict || "—"}] ${p.headline}`];
  if (p.concern) lines.push(`우려: ${p.concern}`);
  if (p.action) lines.push(`오늘 액션: ${p.action}`);
  if (p.watch_list?.length) lines.push(`관찰: ${p.watch_list.join(", ")}`);
  return buildCard({
    tag: "⚡",
    title: "DEV-PERF — 오늘의 성능 모니터",
    lines,
  });
}

function buildCardsForMarketing(m) {
  if (!m || m._raw) {
    return buildCard({
      tag: "📈",
      title: "MKT-LEAD — 오늘의 그로스 제안",
      lines: ["응답 파싱 실패 — 원본을 확인해주세요"],
      footer: m?._raw || "",
    });
  }
  const lines = [m.headline];
  if (m.yesterday_summary) lines.push(`어제 요약: ${m.yesterday_summary}`);
  if (m.channel_diagnosis) lines.push(`채널 진단: ${m.channel_diagnosis}`);
  if (m.content_idea) {
    lines.push(`콘텐츠 [${m.content_idea.channel}] "${m.content_idea.title}"`);
    if (m.content_idea.angle) lines.push(`각도: ${m.content_idea.angle}`);
    for (const o of m.content_idea.outline || []) lines.push(`  · ${o}`);
  }
  if (m.seo_keywords?.length) lines.push(`SEO 키워드: ${m.seo_keywords.join(" / ")}`);
  if (m.social_post) lines.push(`트위터 초안: ${m.social_post}`);
  return buildCard({
    tag: "📈",
    title: "MKT-LEAD — 오늘의 그로스 제안",
    lines,
    hint: m.ads_note,
  });
}

// ── 메인 핸들러 ──
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const dryRun = req.query?.dryRun === "1" || req.query?.dryRun === "true";
  const log = [];
  const L = (m) => { log.push(m); console.log("[daily-standup]", m); };

  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(200).json({ ok: false, error: "ANTHROPIC_API_KEY not set", log });
    }

    const kv = await getKv();
    const [ledger, weights, summary, latestQuant, ga4, sentry, archive, realActivity, alphaLeaderboard, alphaCandidates] = await Promise.all([
      readShadowLedger(kv, 7),
      readWeights(kv),
      readShadowSummary(kv),
      kv.get("di:quant:latest").catch(() => null), // quant-research 가 매일 06:00 적립
      fetchGA4DailySummary({ daysBack: 1 }),       // null = 미연동, error = 인증 실패
      fetchSentryDailySummary({ daysBack: 1 }),
      readClosedArchive(kv),                       // shadow-monitor 가 누적하는 마감 거래
      readRealTradingActivity(kv),                 // 어제 실거래 활동 (사용자 본인 기준)
      kv.get("di:alpha:leaderboard").catch(() => null),         // alpha-lab cron 결과
      kv.get("di:alpha:strategy-candidates").catch(() => null), // continuous-backtest 후보
    ]);
    // QUANT-RES 입력에 OHLC 정확 백테스트 결과 주입 (Track A+B 통합)
    // archive 누적 부족 시 ledger.closed (최대 30건 샘플) fallback
    const ledgerClosedForSim = ledger
      .filter((e) => e?.status === "CLOSED")
      .slice(0, 30)
      .map((e) => ({
        id: e.id,
        plan: e.plan,
        openedAt: e.openedAt,
        entryPrice: e.entryPrice,
        feeBps: e.feeBps,
        slippageBps: e.slippageBps,
        netPnL: e.netPnL,
      }));
    L(`closed-archive: ${archive.length}, ledger.closed: ${ledgerClosedForSim.length} (백테스트 input)`);
    let retroResult = null;
    try {
      retroResult = await retroBacktest(archive, ledgerClosedForSim);
      if (retroResult) {
        L(`OHLC 백테스트 완료: ${retroResult.source} ${retroResult.sampledSize}건, 변형 ${retroResult.topVariants?.length || 0}개`);
      }
    } catch (e) {
      L(`retroBacktest 실패: ${e?.message}`);
    }
    // ledger 의 status==CLOSED 가 0 이어도 shadow-monitor 가 별도 summary 에 누적함.
    // 표시할 "마감 카운트" 는 summary 가 우선, 없으면 ledger 폴백.
    const closedFromSummary = Number((summary?.wins || 0) + (summary?.losses || 0)) || 0;
    const closedFromLedger = ledger.filter((e) => e?.status === "CLOSED").length;
    const closedCount = closedFromSummary || closedFromLedger;
    L(`shadow ledger: ${ledger.length} entries (지난 7일, 마감 ${closedCount})`);
    L(`GA4: ${ga4 ? (ga4.error ? "error" : `${ga4.users}users/${ga4.sessions}sessions`) : "not connected"}`);
    L(`Sentry: ${sentry ? (sentry.error ? "error" : `${(sentry.newIssues || []).length} new issues`) : "not connected"}`);

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    // 2-pass: RES 먼저 실행 → 결과를 PLAN 에 입력으로 전달
    // 이래야 PLAN 이 RES 의 알파 후보·진단을 보고 의미 있는 승급/디머지 판단을 내림.
    // 둘 다 약 5~8초 걸리므로 총 10~16초. Vercel 함수 60초 한도 내 안전.
    const research = await runQuantResearcher(client, ledger, weights, summary, retroResult);
    L(`QUANT-RES done: ${research.headline?.slice(0, 60)}`);

    // 3-스텝 파이프라인:
    //   Step 1: RES 완료 (위)
    //   Step 2: PLAN(RES), MKT(RES+GA4), SVC(RES+GA4+Sentry), DEV-IMPL(Sentry), DEV-PERF(GA4+Sentry) 5명 병렬
    //   Step 3: PLAN-BIZ 만 별도 — Step 2 의 MKT 결과까지 흡수해서 사업 결정 (3-pass)
    const [plan, marketing, servicePlan, devImpl, devPerf] = await Promise.all([
      runQuantPlanner(client, ledger, weights, research),
      runMarketingLead(client, research, latestQuant, ga4, sentry),
      runServicePlanner(client, ga4, sentry, research),
      runDevImplementer(client, sentry),
      runDevPerf(client, ga4, sentry),
    ]);
    L(`QUANT-PLAN done: ${plan.headline?.slice(0, 60)}`);
    L(`MKT-LEAD done: ${marketing.headline?.slice(0, 60)}`);
    L(`PLAN-SVC done: ${servicePlan.headline?.slice(0, 60)}`);
    L(`DEV-IMPL done: ${devImpl.headline?.slice(0, 60)}`);
    L(`DEV-PERF done: ${devPerf.headline?.slice(0, 60)}`);

    // Step 3: PLAN-BIZ — Step 2 결과 모두 보고 결정
    const businessPlan = await runBusinessPlanner(client, ga4, research, marketing);
    L(`PLAN-BIZ done: ${businessPlan.headline?.slice(0, 60)}`);

    const header = buildCard({
      tag: "🌅",
      title: `Zepta 일일 보고 — ${fmtKST().slice(0, 8)}`,
      lines: [
        `실거래 활동 + 가상매매 참고 + 7인 시니어 진단`,
      ],
      footer: ga4 && !ga4.error ? `어제 GA4 사용자 ${ga4.users}명 · 세션 ${ga4.sessions}건` : undefined,
    });

    const cards = [
      header,
      // ★ 실거래 활동 — 헤더 직후에 배치 (가장 중요한 정보)
      buildRealTradingActivityCard(realActivity, summary),
      buildShadowReferenceCard(summary),
      // ★ Alpha Lab (Phase 1~6) — 24/7 자동 알파 추적 결과
      buildAlphaLabCard(alphaLeaderboard, alphaCandidates),
      buildCardsForResearch(research),
      buildCardsForPlan(plan),
      buildCardsForMarketing(marketing),
      buildCardsForServicePlanner(servicePlan),
      buildCardsForBusinessPlanner(businessPlan),
      buildCardsForDevImplementer(devImpl),
      buildCardsForDevPerf(devPerf),
    ];

    if (dryRun) {
      return res.status(200).json({
        ok: true,
        dryRun: true,
        cards,
        research,
        plan,
        marketing,
        servicePlan,
        businessPlan,
        devImpl,
        devPerf,
        retroBacktest: retroResult,
        ga4: ga4 ? { connected: !ga4.error, ...(ga4.error ? { error: ga4.error } : {}) } : { connected: false },
        sentry: sentry ? { connected: !sentry.error } : { connected: false },
        log,
      });
    }

    const tg = await sendCards(cards);
    L(`telegram send: ${tg.ok ? "ok" : "fail " + (tg.error || "")}`);

    return res.status(200).json({
      ok: true,
      sent: tg.ok,
      messageId: tg.message_id,
      research,
      plan,
      marketing,
      servicePlan,
      businessPlan,
      devImpl,
      devPerf,
      log,
    });
  } catch (err) {
    console.error("[daily-standup] fatal:", err);
    return res.status(200).json({ ok: false, error: err?.message || String(err), log });
  }
}
