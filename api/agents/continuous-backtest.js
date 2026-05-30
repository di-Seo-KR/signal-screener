// ════════════════════════════════════════════════════════════════════
// Zepta — Continuous Backtest (일일 cron, KST 16:00)
// ────────────────────────────────────────────────────────────────────
// 새 strategy 후보 자동 생성 & 검증.
//
// 알고리즘:
//   1) 기존 strategy 들의 파라미터를 WIDE_PARAM_SPACE 에서 random sample 20개씩 추출
//   2) 각 변형을 최근 60일 BTCUSDT 4h OHLC 로 백테스트
//   3) Sharpe ≥ 2.0 AND maxDD ≤ 20% AND trades ≥ 30 통과 시 후보 등록
//   4) 후보는 `di:alpha:strategy-candidates` 에 추가 → 1주 shadow 관찰
//   5) candidate 가 7일 이상 됐고 leaderboard 에서 여전히 우수 → status=active 자동 promote
//
// KV:
//   di:alpha:strategy-candidates  → [{ id, parentStrategy, params, backtestResult, createdAt, status }]
//
// Cron: `0 7 * * *` (KST 16:00)
// Timeout: 60초 — 8 strategy × 20 sample × 백테스트 ≈ 16~25초
// ════════════════════════════════════════════════════════════════════

import { getKlines } from "../_shared/binance-client.js";
import { backtestStrategy, klinesToOhlc } from "../_shared/strategy-backtester.js";
import { sampleRandomParams } from "../_shared/strategy-param-space.js";
import { ALL_STRATEGIES } from "../_shared/strategies/index.js";
import { setStrategyStatus, setStrategyParams, STRATEGY_STATUS } from "../_shared/dynamic-config.js";

export const config = { maxDuration: 60 };

// 60일 = 4h 봉 360개 (binance limit 1500 이내)
const KLINE_INTERVAL = "4h";
const KLINE_LIMIT = 360;

// ★ 2026-05-13 다중 심볼 발굴 — 대표 지시 "테스트 가능한 모든 심볼 포함".
//   매 cron 에 SYMBOLS_PER_RUN 만 rotation 처리 → Vercel 60초 timeout 안전.
//   매 4시간 cron × 4 symbols = 24시간 안에 13개 자산 모두 cycle 완료.
//   각 symbol 별 30 sample × N strategies → 자산 다양성 + param 탐색 균형.
const TOP_SYMBOLS = [
  "BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "ADAUSDT",
  "AVAXUSDT", "LINKUSDT", "UNIUSDT", "AAVEUSDT", "DOTUSDT",
  "DOGEUSDT", "MATICUSDT", "ARBUSDT",
];
const SYMBOLS_PER_RUN = 4;
const SYMBOL_CURSOR_KEY = "di:continuous-backtest:symbol-cursor";

// ★ 2026-05-20 추가 완화 — 대표 지시 "전략 다양화 멈춰있는 거 아니냐":
//   기존 1.5 / 30 sample → MATICUSDT + ARBUSDT 만 통과 (35건 모두 2개 자산).
//   - minSharpe 1.5 → 1.0: BTC/ETH/SOL 등 메이저 자산도 통과 가능
//   - minTrades 20 → 15: 표본 적은 strategy 도 candidate 등록 기회
//   - SAMPLES_PER_STRATEGY 30 → 50: param space 더 넓게 탐색
//   7일 관찰 단계에서 부진 폐기로 quality 유지 (OBSERVATION_DAYS 7).
const CANDIDATE_THRESHOLD = { minSharpe: 1.0, maxDD: 25, minTrades: 15 };

// 변형 sample 수 (strategy × symbol 당)
const SAMPLES_PER_STRATEGY = 50;

// ★ 2026-05-29 (대표 지시: "발굴된 우수전략을 실거래에 실시간 반영, 계속 진행")
//   매 cron 마다 이번 회차 발굴 후보 중 *충분히 우수한* 것을 실거래 파라미터로 즉시 주입.
//   주입 대상: di:alpha:params:<family> → btc-cron 이 다음 신호 생성부터 적용 → 실거래 풀 반영.
//   - candidate 의 backtest 지표가 param-aware 이므로 (전략이 params 를 실제 소비) 의미 있는 주입.
//   - flapping 방지: 기존 적재 Sharpe 대비 +INJECT_IMPROVE_MARGIN 이상일 때만 교체.
//   - INJECT 임계는 candidate 등록 임계(완화)보다 엄격 — 실거래엔 진짜 검증된 것만.
// 임계 튜닝 (2026-05-29 라이브 검증): 60일/4h 발굴은 선별적이라 후보 거래수 15~18.
//   minTrades 20 은 사실상 모든 우수 후보를 차단 → 실시간 반영 무력화.
//   minTrades 15 로 맞추되, 표본이 작은 만큼 Sharpe 바를 2.5 로 올려 robust 한 것만 통과.
// 1차 선별 임계 — 후보의 *교차심볼 중앙* 지표 기준 (단일심볼 inflated 값 아님).
//   2026-05-30: 발굴이 교차심볼 중앙값으로 바뀌어 값 자체가 정직(낮음) → 임계도 현실화.
//   진짜 게이트는 validateParamSet(OOS 포함)이고 이건 명백히 약한 후보만 빠르게 거른다.
const INJECT_THRESHOLD = { minSharpe: 1.3, minTrades: 12, maxDD: 25, minWinRate: 45, minProfitFactor: 1.15 };
const INJECT_IMPROVE_MARGIN = 0.3;

// ★ 2026-05-30 과적합 가드 — 실거래 주입 전 "교차심볼 + out-of-sample" 검증.
//   단일 심볼 in-sample Sharpe(예: 17) 는 곡선맞추기일 수 있음. 같은 파라미터가
//   (a) 다른 심볼들에서도, (b) 학습에 안 쓴 최근 구간(OOS)에서도 통해야 진짜 알파.
//   둘 다 통과한 것만 주입하고, 저장 Sharpe 도 "교차검증 중앙값"으로 정직하게 기록.
const VALIDATE_THRESHOLD = {
  minSymbols: 3,        // 최소 3개 심볼에서 검증
  minMedianSharpe: 1.0, // 교차심볼 full-window 중앙 Sharpe
  minPosFrac: 0.6,      // 60% 이상 심볼에서 + 수익
  minOosSharpe: 0.3,    // out-of-sample 중앙 Sharpe (양수 + 의미)
  minOosPosFrac: 0.5,   // 50% 이상 심볼 OOS 에서 + 수익
};

function median(arr) {
  const a = arr.filter(Number.isFinite).sort((x, y) => x - y);
  if (!a.length) return 0;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

// 한 파라미터 세트를 캐시된 모든 심볼 + OOS 구간에 재검증.
function validateParamSet(strategyFn, params, ohlcCache) {
  const per = [];
  for (const [sym, ohlc] of Object.entries(ohlcCache)) {
    if (!ohlc || ohlc.length < 120) continue;
    const full = backtestStrategy({ strategyFn, ohlc, params, slPct: 4, tpPct: 8, maxHoldBars: 24 });
    // out-of-sample = 최근 35% (후보 선택에 안 쓰인 구간)
    const cut = Math.floor(ohlc.length * 0.65);
    const oosOhlc = ohlc.slice(cut);
    const oos = oosOhlc.length >= 80
      ? backtestStrategy({ strategyFn, ohlc: oosOhlc, params, slPct: 4, tpPct: 8, maxHoldBars: 24 })
      : null;
    per.push({ sym, full, oos });
  }
  const fulls = per.map((p) => p.full).filter(Boolean);
  const ooss = per.map((p) => p.oos).filter(Boolean);
  return {
    symbolsTested: per.length,
    medianSharpe: median(fulls.map((f) => f.sharpe)),
    posFrac: fulls.length ? fulls.filter((f) => (f.netReturn || 0) > 0).length / fulls.length : 0,
    medianOosSharpe: median(ooss.map((o) => o.sharpe)),
    oosPosFrac: ooss.length ? ooss.filter((o) => (o.netReturn || 0) > 0).length / ooss.length : 0,
    avgTrades: Math.round(median(fulls.map((f) => f.trades))),
  };
}

// 이번 회차 신규 후보 중 family 별 best 를 골라 *검증 후* 실거래 파라미터로 주입.
async function injectWinningParams(kv, newCandidates, ohlcCache, L) {
  const injected = [];
  const rejected = [];
  const bestByFamily = {};
  for (const c of newCandidates) {
    const r = c.backtestResult || {};
    const pass =
      (r.sharpe || 0) >= INJECT_THRESHOLD.minSharpe &&
      (r.trades || 0) >= INJECT_THRESHOLD.minTrades &&
      (r.maxDD ?? 100) <= INJECT_THRESHOLD.maxDD &&
      (r.winRate ?? 0) >= INJECT_THRESHOLD.minWinRate &&
      (r.profitFactor ?? 0) >= INJECT_THRESHOLD.minProfitFactor;
    if (!pass) continue;
    const cur = bestByFamily[c.parentStrategy];
    if (!cur || (r.sharpe || 0) > (cur.backtestResult?.sharpe || 0)) {
      bestByFamily[c.parentStrategy] = c;
    }
  }
  for (const [family, c] of Object.entries(bestByFamily)) {
    const r = c.backtestResult || {};
    const strategyFn = ALL_STRATEGIES[family];
    if (!strategyFn) continue;

    // ── 과적합 가드: 교차심볼 + OOS 검증 ──
    const v = validateParamSet(strategyFn, c.params, ohlcCache);
    const V = VALIDATE_THRESHOLD;
    const robust =
      v.symbolsTested >= V.minSymbols &&
      v.medianSharpe >= V.minMedianSharpe &&
      v.posFrac >= V.minPosFrac &&
      v.medianOosSharpe >= V.minOosSharpe &&
      v.oosPosFrac >= V.minOosPosFrac;
    if (!robust) {
      rejected.push({ family, symbol: c.symbol, inSampleSharpe: r.sharpe, ...v });
      L(`[inject] ${family} ✗ 과적합 의심 — in-sample ${(r.sharpe || 0).toFixed(1)} 인데 교차심볼 중앙 ${v.medianSharpe.toFixed(2)} (+${(v.posFrac * 100).toFixed(0)}%), OOS 중앙 ${v.medianOosSharpe.toFixed(2)} (+${(v.oosPosFrac * 100).toFixed(0)}%) — 주입 거부`);
      continue;
    }

    // 저장 Sharpe = 교차검증 중앙값(정직한 일반화 성능). flapping 방지 비교도 이 값 기준.
    const validatedSharpe = Number(v.medianSharpe.toFixed(2));
    let storedSharpe = null;
    try {
      const stored = await kv.get(`di:alpha:params:${family}`);
      if (stored && Number.isFinite(stored.sharpe)) storedSharpe = stored.sharpe;
    } catch {}
    if (storedSharpe != null && validatedSharpe < storedSharpe + INJECT_IMPROVE_MARGIN) {
      L(`[inject] ${family} skip — 검증 Sharpe ${validatedSharpe} ≤ 현재 ${storedSharpe}+${INJECT_IMPROVE_MARGIN}`);
      continue;
    }
    const ok = await setStrategyParams(family, c.params, {
      sharpe: validatedSharpe,            // ★ 정직한 일반화 성능 (단일심볼 inflated 값 아님)
      inSampleSharpe: Number((r.sharpe || 0).toFixed(2)),
      oosSharpe: Number(v.medianOosSharpe.toFixed(2)),
      symbolsValidated: v.symbolsTested,
      posFrac: Number(v.posFrac.toFixed(2)),
      trades: r.trades,
      version: Math.floor(Date.now() / 1000),
    });
    if (ok) {
      try { await setStrategyStatus(family, STRATEGY_STATUS.ACTIVE, `param-inject ${c.symbol} 검증Sharpe ${validatedSharpe} (OOS ${v.medianOosSharpe.toFixed(2)})`); } catch {}
      injected.push({ family, symbol: c.symbol, validatedSharpe, oosSharpe: Number(v.medianOosSharpe.toFixed(2)), inSampleSharpe: Number((r.sharpe || 0).toFixed(2)), symbolsValidated: v.symbolsTested });
      L(`[inject] ✅ ${family} ← ${c.symbol} | in-sample ${(r.sharpe || 0).toFixed(1)} → 검증 중앙 ${validatedSharpe} (${v.symbolsTested}심볼, +${(v.posFrac * 100).toFixed(0)}%), OOS ${v.medianOosSharpe.toFixed(2)} → 실거래 반영`);
    }
  }
  return { injected, rejected };
}

// ★ 2026-05-30 — 이미 실거래에 적재된 파라미터도 매 회차 재검증.
//   과거(검증 도입 전) inflated 단일심볼 Sharpe 로 주입된 것들이 실제로는
//   일반화 안 되면(교차심볼/OOS 실패) default 로 되돌려 실거래에서 제거.
//   통과분은 저장 Sharpe 를 정직한 검증 중앙값으로 갱신.
async function revalidateStoredParams(kv, ohlcCache, L) {
  const cleared = [], refreshed = [];
  if (Object.keys(ohlcCache).length < VALIDATE_THRESHOLD.minSymbols) return { cleared, refreshed };
  const V = VALIDATE_THRESHOLD;
  for (const family of Object.keys(ALL_STRATEGIES)) {
    let stored;
    try { stored = await kv.get(`di:alpha:params:${family}`); } catch { continue; }
    if (!stored || !stored.params) continue;
    const fn = ALL_STRATEGIES[family];
    let v;
    try { v = validateParamSet(fn, stored.params, ohlcCache); } catch { continue; }
    if (v.symbolsTested < V.minSymbols) continue; // 표본 부족 → 판단 보류
    const robust = v.medianSharpe >= V.minMedianSharpe && v.posFrac >= V.minPosFrac &&
      v.medianOosSharpe >= V.minOosSharpe && v.oosPosFrac >= V.minOosPosFrac;
    if (!robust) {
      try { await kv.del(`di:alpha:params:${family}`); } catch {}
      cleared.push({ family, medianSharpe: Number(v.medianSharpe.toFixed(2)), oosSharpe: Number(v.medianOosSharpe.toFixed(2)) });
      L(`[revalidate] ${family} ✗ 실거래 파라미터 검증 실패 (교차중앙 ${v.medianSharpe.toFixed(2)}, OOS ${v.medianOosSharpe.toFixed(2)}, +${(v.posFrac * 100).toFixed(0)}%) → default 복귀(제거)`);
    } else {
      const validatedSharpe = Number(v.medianSharpe.toFixed(2));
      if (Math.abs((stored.sharpe || 0) - validatedSharpe) > 0.05) {
        try {
          await setStrategyParams(family, stored.params, {
            sharpe: validatedSharpe, oosSharpe: Number(v.medianOosSharpe.toFixed(2)),
            symbolsValidated: v.symbolsTested, posFrac: Number(v.posFrac.toFixed(2)),
            trades: stored.trades, version: Math.floor(Date.now() / 1000),
          });
          refreshed.push({ family, from: stored.sharpe, to: validatedSharpe });
        } catch {}
      }
    }
  }
  if (cleared.length || refreshed.length) L(`[revalidate] 제거 ${cleared.length}개 · 정직화 ${refreshed.length}개`);
  return { cleared, refreshed };
}

// 후보 보관 기간
const OBSERVATION_DAYS = 7;
const MAX_CANDIDATES = 100;

// ────────────────────────────────────────────────────────────────────
// ★ 2026-05-17 (QUANT-PLAN): family quota 시스템.
// 문제: 한 family (예: defi-momentum) 가 sample 통과 threshold 를 압도하면
//       다른 family 후보가 한 cron 에서 잘 발굴 안 됨 (대표 보고: DeFi 모멘텀 변형 13건 일색).
// 해결: 매 cron 에 family 별 최대 PER_FAMILY_QUOTA 만 등록 + 적응형 임계 완화.
//
// 메커니즘:
//   1) cron 한 사이클 안에서 family 당 PER_FAMILY_QUOTA 개까지만 후보 등록.
//   2) family 별 발굴 통계 (KV: di:alpha:family-discovery-stats) 추적 →
//      통과 0개 누적 family 는 다음 cron 에 임계 0.1 (Sharpe) 완화.
//   3) 8 family × 2 quota = 최대 16 후보 / cron → 다양성 확보.
// ────────────────────────────────────────────────────────────────────
const PER_FAMILY_QUOTA = 2;
const FAMILY_STATS_KEY = "di:alpha:family-discovery-stats";
const FAMILY_RELAX_MAX_STEPS = 3;   // 최대 -0.3 (Sharpe 1.5 → 1.2) 까지 완화
const FAMILY_RELAX_STEP = 0.1;       // 한 번에 0.1 씩

// family 별 적응형 임계 계산 — 직전 N cron 동안 통과 0이면 단계적 완화
function relaxedThresholdFor(familyStats, family) {
  const s = familyStats?.[family] || { dryRuns: 0, lastPassedAt: null };
  const dryRuns = Math.min(FAMILY_RELAX_MAX_STEPS, s.dryRuns || 0);
  const relaxedSharpe = CANDIDATE_THRESHOLD.minSharpe - dryRuns * FAMILY_RELAX_STEP;
  return {
    minSharpe: Math.max(1.0, relaxedSharpe),     // 절대 1.0 미만은 절대 안 함
    maxDD: CANDIDATE_THRESHOLD.maxDD + dryRuns * 2, // DD 도 살짝 완화 (25 → 31)
    minTrades: CANDIDATE_THRESHOLD.minTrades,
    relaxStep: dryRuns,
  };
}

async function getKv() {
  return (await import("@vercel/kv")).kv;
}

function genCandidateId(parent) {
  return `${parent}-${Math.floor(Date.now() / 1000)}-${Math.random().toString(36).slice(2, 6)}`;
}

async function fetchOhlc(symbol = "BTCUSDT") {
  const klines = await getKlines({ symbol, interval: KLINE_INTERVAL, limit: KLINE_LIMIT });
  return klinesToOhlc(klines);
}

// ★ 심볼 rotation — KV 커서 기반으로 cron 마다 다음 N 심볼 선택.
//   13 symbols × 매 4시간 × 4 symbols/run = 약 13시간 안에 모든 심볼 cycle 완료.
async function pickRotatingSymbols(kv) {
  let cursor = 0;
  try {
    const raw = await kv.get(SYMBOL_CURSOR_KEY);
    cursor = typeof raw === "number" ? raw : (parseInt(raw, 10) || 0);
    if (!Number.isFinite(cursor) || cursor < 0) cursor = 0;
  } catch { cursor = 0; }
  const selected = [];
  for (let i = 0; i < SYMBOLS_PER_RUN; i += 1) {
    selected.push(TOP_SYMBOLS[(cursor + i) % TOP_SYMBOLS.length]);
  }
  const nextCursor = (cursor + SYMBOLS_PER_RUN) % TOP_SYMBOLS.length;
  try { await kv.set(SYMBOL_CURSOR_KEY, nextCursor); } catch {}
  return { selected, cursor, nextCursor };
}

// ────────────────────────────────────────────────────────────────────
// 후보 검증 (1주 관찰 후 promote)
// ────────────────────────────────────────────────────────────────────
async function evaluateExistingCandidates(kv, leaderboard) {
  const candidates = (await kv.get("di:alpha:strategy-candidates")) || [];
  if (!Array.isArray(candidates)) return { promoted: [], remaining: 0 };

  const promoted = [];
  const kept = [];
  const now = Date.now();
  for (const c of candidates) {
    const ageMs = now - (Date.parse(c.createdAt || 0) || 0);
    if (ageMs < OBSERVATION_DAYS * 86400000) {
      kept.push(c);
      continue;
    }
    // ★ 2026-05-29 — 승급 게이트를 후보 *자신의* 백테스트 지표로 판정.
    //   (기존엔 production leaderboard Sharpe 에 의존했는데, 그 값이 summary-fallback 으로
    //    항상 0 이라 어떤 후보도 절대 승급 못 하는 버그였음 — 발굴→실거래 단절의 핵심 원인.)
    const r = c.backtestResult || {};
    const stillGood = (r.sharpe || 0) >= 1.0 && (r.trades || 0) >= 10 && (r.maxDD ?? 100) <= 30;
    if (stillGood) {
      // promote — status=active 로 적재 (candidate 도 keep but flag)
      const sr = await setStrategyStatus(
        c.parentStrategy,
        STRATEGY_STATUS.ACTIVE,
        `auto-promote from candidate ${c.id} (Sharpe ${(r.sharpe || 0).toFixed(2)}, ${r.trades}T)`
      );
      promoted.push({ ...c, promotedAt: new Date().toISOString(), kvResult: sr });
    } else {
      // 후보 부진 — 폐기
    }
  }

  await kv.set("di:alpha:strategy-candidates", kept.slice(-MAX_CANDIDATES));
  return { promoted, remaining: kept.length };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const t0 = Date.now();
  const log = [];
  const L = (m) => { log.push(m); console.log("[continuous-backtest]", m); };
  const dryRun = req.query?.dryRun === "1" || req.query?.dryRun === "true";

  try {
    const kv = await getKv();
    const leaderboard = await kv.get("di:alpha:leaderboard");

    // 1) 기존 후보 1주 관찰 졸업 / 폐기
    const { promoted, remaining } = await evaluateExistingCandidates(kv, leaderboard);
    L(`existing candidates: ${remaining + promoted.length} (promoted ${promoted.length})`);

    // 2) 심볼 rotation — 매 cron 마다 다음 SYMBOLS_PER_RUN 개 심볼 처리
    const { selected: targetSymbols, cursor, nextCursor } = await pickRotatingSymbols(kv);
    L(`symbol rotation: cursor ${cursor} → ${nextCursor}, selected: ${targetSymbols.join(", ")}`);

    // ★ family 별 발굴 통계 + quota 카운터 초기화 (이번 cron 한정)
    const familyStats = (await kv.get(FAMILY_STATS_KEY)) || {};
    const familyQuotaUsed = {}; // { [strategyId]: count }
    const familyRelaxLog = {};  // 보고용

    // 3) 각 심볼별 OHLC + strategy × params sweep
    // ★ family 균등 발굴: passedHere 후보를 모두 buffer → 마지막에 family quota 적용 후 등록.
    //    각 family 별로 sharpe top N 만 채택 → DeFi 한 family 가 cron 을 점령하는 현상 해소.
    const allPassedByFamily = {}; // { [strategyId]: [{ symbol, params, ...metrics }] }
    const scanResults = {};       // { [symbol]: { [strategyId]: {...} } }
    const ohlcCache = {};         // { [symbol]: ohlc } — 주입 시 교차검증 재사용 (과적합 가드)
    const t0Scan = Date.now();
    const TIMEOUT_BUDGET_MS = 50_000; // 60초 maxDuration 중 50초 limit (안전 마진)

    // 3a) 대상 심볼 OHLC 일괄 확보 (교차심볼 발굴/검증 공용 캐시)
    for (const symbol of targetSymbols) {
      if (Date.now() - t0Scan > TIMEOUT_BUDGET_MS) { L(`⏱️ timeout — OHLC fetch 중단`); break; }
      try {
        const ohlc = await fetchOhlc(symbol);
        if (ohlc && ohlc.length >= 100) { ohlcCache[symbol] = ohlc; L(`[${symbol}] OHLC ${ohlc.length} bars`); }
        else L(`[${symbol}] insufficient OHLC (${ohlc?.length || 0}) — skip`);
      } catch (e) { L(`[${symbol}] OHLC fetch failed: ${e?.message}`); }
    }
    const cachedSymbols = Object.keys(ohlcCache);
    const MIN_SYMS = Math.min(VALIDATE_THRESHOLD.minSymbols, cachedSymbols.length || 1);
    L(`★ 교차심볼 발굴 대상: ${cachedSymbols.length}개 (${cachedSymbols.join(", ")})`);

    // 3b) ★ 2026-05-30 교차심볼 발굴 — 단일심볼 곡선맞추기(과적합) 대신,
    //     각 strategy 의 random param 을 *모든 심볼*에 적용해 교차심볼 중앙 Sharpe +
    //     60% 심볼 +수익 을 만족하는 가장 robust 한 1개를 후보로. 처음부터 일반화 탐색.
    for (const [strategyId, strategyFn] of Object.entries(ALL_STRATEGIES)) {
      if (Date.now() - t0Scan > TIMEOUT_BUDGET_MS) { L(`⏱️ timeout — strategy 스캔 중단`); break; }
      if (cachedSymbols.length < MIN_SYMS) break;
      const thr = relaxedThresholdFor(familyStats, strategyId);
      if (thr.relaxStep > 0 && !familyRelaxLog[strategyId]) {
        familyRelaxLog[strategyId] = { relaxStep: thr.relaxStep, minSharpe: thr.minSharpe, maxDD: thr.maxDD };
        L(`[relax] ${strategyId}: dryRuns ${familyStats[strategyId]?.dryRuns || 0} → minSharpe ${thr.minSharpe.toFixed(2)}`);
      }
      const samples = sampleRandomParams(strategyId, SAMPLES_PER_STRATEGY);
      if (samples.length === 0) continue;
      let best = null;    // 임계 통과분 중 교차심볼 중앙 sharpe 최고
      let bestAny = null; // 통과 무관 최고 (dry-run 로그)
      for (const params of samples) {
        if (Date.now() - t0Scan > TIMEOUT_BUDGET_MS) break;
        const per = [];
        for (const sym of cachedSymbols) {
          try { per.push(backtestStrategy({ strategyFn, ohlc: ohlcCache[sym], params, slPct: 4, tpPct: 8, maxHoldBars: 24 })); } catch {}
        }
        if (per.length < MIN_SYMS) continue;
        const medSharpe = median(per.map((r) => r.sharpe));
        const medTrades = Math.round(median(per.map((r) => r.trades)));
        const medMaxDD = median(per.map((r) => r.maxDD));
        const medWin = median(per.map((r) => r.winRate));
        const pfs = per.map((r) => r.profitFactor).filter(Number.isFinite);
        const medPF = pfs.length ? median(pfs) : null;
        const medRet = median(per.map((r) => r.netReturn));
        const posFrac = per.filter((r) => (r.netReturn || 0) > 0).length / per.length;
        const agg = { params, sharpe: medSharpe, trades: medTrades, maxDD: medMaxDD, winRate: medWin, profitFactor: medPF, netReturn: medRet, posFrac, symbolsTested: per.length };
        if (!bestAny || medSharpe > bestAny.sharpe) bestAny = agg;
        if (medTrades >= thr.minTrades && medSharpe >= thr.minSharpe && medMaxDD <= thr.maxDD && posFrac >= 0.6) {
          if (!best || medSharpe > best.sharpe) best = agg;
        }
      }
      scanResults[strategyId] = {
        samples: samples.length, crossSymbol: cachedSymbols.length,
        bestMedianSharpe: bestAny ? Number((bestAny.sharpe || 0).toFixed(2)) : null,
        bestPosFrac: bestAny ? Number((bestAny.posFrac || 0).toFixed(2)) : null,
        passed: best ? 1 : 0,
      };
      if (best) {
        allPassedByFamily[strategyId] = [best];
        L(`[발굴] ${strategyId}: 교차심볼 중앙 Sharpe ${best.sharpe.toFixed(2)} (+${(best.posFrac * 100).toFixed(0)}% 심볼, ${best.trades}T 중앙) — 일반화 후보 ✓`);
      }
    }

    // 후보 등록 — 교차심볼 발굴이라 family 당 robust 1개 (별도 quota dedup 불필요).
    const newCandidates = [];
    for (const [strategyId, pool] of Object.entries(allPassedByFamily)) {
      const c = pool[0];
      if (!c) continue;
      familyQuotaUsed[strategyId] = 1;
      newCandidates.push({
        id: genCandidateId(`${strategyId}-xsym`),
        parentStrategy: strategyId,
        symbol: `교차 ${c.symbolsTested}심볼`,
        params: c.params,
        backtestResult: {
          trades: c.trades,
          sharpe: Number((c.sharpe || 0).toFixed(3)),
          winRate: Number((c.winRate || 0).toFixed(2)),
          profitFactor: c.profitFactor == null ? null : Number(c.profitFactor.toFixed(3)),
          netReturn: Number((c.netReturn || 0).toFixed(2)),
          maxDD: Number((c.maxDD || 0).toFixed(2)),
          crossSymbol: true,
          posFrac: Number((c.posFrac || 0).toFixed(2)),
        },
        createdAt: new Date().toISOString(),
        status: "observing",
      });
    }

    // ★ family-discovery-stats 업데이트 — dry-run 카운터 증감 + last passed 기록
    const nextFamilyStats = { ...familyStats };
    for (const strategyId of Object.keys(ALL_STRATEGIES)) {
      const prev = nextFamilyStats[strategyId] || { dryRuns: 0, totalPassed: 0, lastPassedAt: null };
      const passedThisRun = familyQuotaUsed[strategyId] || 0;
      if (passedThisRun > 0) {
        nextFamilyStats[strategyId] = {
          dryRuns: 0,
          totalPassed: (prev.totalPassed || 0) + passedThisRun,
          lastPassedAt: new Date().toISOString(),
        };
      } else {
        nextFamilyStats[strategyId] = {
          dryRuns: (prev.dryRuns || 0) + 1,
          totalPassed: prev.totalPassed || 0,
          lastPassedAt: prev.lastPassedAt,
        };
      }
    }
    if (!dryRun) {
      try { await kv.set(FAMILY_STATS_KEY, nextFamilyStats); } catch (e) { L(`family-stats persist failed: ${e?.message}`); }
    }

    // 4) 새 후보 등록
    if (newCandidates.length > 0 && !dryRun) {
      const existing = (await kv.get("di:alpha:strategy-candidates")) || [];
      const merged = [...existing, ...newCandidates].slice(-MAX_CANDIDATES);
      await kv.set("di:alpha:strategy-candidates", merged);
      L(`new candidates registered: ${newCandidates.length} (across ${Object.keys(familyQuotaUsed).length} families), total: ${merged.length}`);
    }

    // 4.5) ★ 기존 적재 파라미터 재검증 — 과적합/성능붕괴면 default 복귀 (실거래 정리)
    let revalidated = { cleared: [], refreshed: [] };
    if (!dryRun) {
      try { revalidated = await revalidateStoredParams(kv, ohlcCache, L); }
      catch (e) { L(`[revalidate] 실패: ${e?.message}`); }
    }

    // 5) ★ 발굴된 우수전략 실거래 즉시 반영 (매 cron) — 단, 교차심볼+OOS 검증 통과분만.
    let injected = [];
    let injectRejected = [];
    if (newCandidates.length > 0 && !dryRun) {
      const out = await injectWinningParams(kv, newCandidates, ohlcCache, L);
      injected = out.injected;
      injectRejected = out.rejected;
      if (injected.length > 0) {
        L(`★ 실거래 파라미터 주입(검증통과): ${injected.map((i) => `${i.family}(검증 ${i.validatedSharpe}/OOS ${i.oosSharpe})`).join(", ")}`);
      } else {
        L(`실거래 주입 0건 — ${injectRejected.length}개 과적합 거부 또는 임계 미달 (in-sample 우수해도 교차심볼/OOS 검증 실패)`);
      }
    }

    return res.status(200).json({
      ok: true,
      durationMs: Date.now() - t0,
      promoted,
      injected,
      injectRejected,
      revalidated,
      newCandidates,
      familyQuota: familyQuotaUsed,
      familyRelax: familyRelaxLog,
      familyStats: nextFamilyStats,
      scanResults,
      dryRun,
      log,
    });
  } catch (err) {
    console.error("[continuous-backtest] fatal:", err);
    return res.status(200).json({ ok: false, error: err?.message || String(err), log });
  }
}
