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
import { setStrategyStatus, STRATEGY_STATUS } from "../_shared/dynamic-config.js";

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

// ★ 발굴 활성화:
//   기존: Sharpe ≥ 2.0 (매우 엄격), 20 sample
//   변경: Sharpe ≥ 1.5 (현실적), DD ≤ 25, trades ≥ 20, 30 sample
const CANDIDATE_THRESHOLD = { minSharpe: 1.5, maxDD: 25, minTrades: 20 };

// 변형 sample 수 (strategy × symbol 당)
const SAMPLES_PER_STRATEGY = 30;

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
    // 1주 경과 — leaderboard 에 부모 strategy 가 여전히 우수면 promote
    const parentMetrics = leaderboard?.strategies?.[c.parentStrategy];
    const stillGood = parentMetrics && (parentMetrics.sharpe || 0) >= 1.0 && (parentMetrics.trades || 0) >= 10;
    if (stillGood) {
      // promote — status=active 로 적재 (candidate 도 keep but flag)
      const r = await setStrategyStatus(c.parentStrategy, STRATEGY_STATUS.ACTIVE, `auto-promote from candidate ${c.id}`);
      promoted.push({ ...c, promotedAt: new Date().toISOString(), kvResult: r });
    } else {
      // 부모 부진 — 후보도 폐기
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
    const t0Scan = Date.now();
    const TIMEOUT_BUDGET_MS = 50_000; // 60초 maxDuration 중 50초 limit (안전 마진)

    for (const symbol of targetSymbols) {
      if (Date.now() - t0Scan > TIMEOUT_BUDGET_MS) {
        L(`⏱️ timeout budget exceeded — skipping remaining symbols`);
        break;
      }
      let ohlc;
      try {
        ohlc = await fetchOhlc(symbol);
        L(`[${symbol}] OHLC fetched: ${ohlc.length} bars (60일 4h)`);
      } catch (e) {
        L(`[${symbol}] OHLC fetch failed: ${e?.message}`);
        continue;
      }
      if (!ohlc || ohlc.length < 100) {
        L(`[${symbol}] insufficient OHLC (${ohlc?.length || 0} bars) — skip`);
        continue;
      }
      scanResults[symbol] = {};

      for (const [strategyId, strategyFn] of Object.entries(ALL_STRATEGIES)) {
        if (Date.now() - t0Scan > TIMEOUT_BUDGET_MS) break;
        // family 별 적응형 임계 (직전 dry-run 누적 시 완화)
        const thr = relaxedThresholdFor(familyStats, strategyId);
        if (thr.relaxStep > 0 && !familyRelaxLog[strategyId]) {
          familyRelaxLog[strategyId] = { relaxStep: thr.relaxStep, minSharpe: thr.minSharpe, maxDD: thr.maxDD };
          L(`[relax] ${strategyId}: dryRuns ${familyStats[strategyId]?.dryRuns || 0} → minSharpe ${thr.minSharpe.toFixed(2)}, maxDD ${thr.maxDD}`);
        }

        const samples = sampleRandomParams(strategyId, SAMPLES_PER_STRATEGY);
        if (samples.length === 0) continue;
        let bestOfStrategy = null;
        const passedHere = [];
        for (const params of samples) {
          try {
            const r = backtestStrategy({
              strategyFn,
              ohlc,
              params,
              slPct: 4, tpPct: 8, maxHoldBars: 24,
            });
            if (!bestOfStrategy || r.sharpe > bestOfStrategy.sharpe) {
              bestOfStrategy = { params, ...r };
            }
            if (
              r.trades >= thr.minTrades &&
              r.sharpe >= thr.minSharpe &&
              r.maxDD <= thr.maxDD
            ) {
              passedHere.push({ params, ...r });
            }
          } catch (e) {
            // 개별 시뮬 실패는 무시 — 다음 sample 진행
          }
        }
        scanResults[symbol][strategyId] = { samples: samples.length, best: bestOfStrategy, passed: passedHere.length };

        // family quota buffer 에 적재 (등록은 모든 symbol 스캔 끝난 뒤 일괄 처리).
        // family-symbol 쌍 당 best 1개씩만 buffer 에 → 다양한 symbol 도 보장.
        if (passedHere.length > 0) {
          passedHere.sort((a, b) => b.sharpe - a.sharpe);
          const winner = passedHere[0];
          if (!allPassedByFamily[strategyId]) allPassedByFamily[strategyId] = [];
          allPassedByFamily[strategyId].push({
            symbol,
            params: winner.params,
            trades: winner.trades,
            sharpe: winner.sharpe,
            winRate: winner.winRate,
            profitFactor: winner.profitFactor,
            netReturn: winner.netReturn,
            maxDD: winner.maxDD,
          });
        }
      }
    }

    // ★ family quota 적용 — 각 family 별로 sharpe top PER_FAMILY_QUOTA 만 등록.
    //    추가로 다양성 가산점: 같은 family 내에서 symbol 중복 시 두 번째 candidate 부터 sharpe 0.05 감점.
    //    → 같은 family 가 다른 symbol 로 분산 발굴되도록 유도.
    const newCandidates = [];
    for (const [strategyId, pool] of Object.entries(allPassedByFamily)) {
      // symbol 다양성 가산: 한 family 내 unique symbol 우선 정렬
      const seenSymbols = new Set();
      const rescored = pool.map((p) => {
        const dup = seenSymbols.has(p.symbol);
        seenSymbols.add(p.symbol);
        return { ...p, _adjSharpe: dup ? p.sharpe - 0.05 : p.sharpe };
      });
      rescored.sort((a, b) => b._adjSharpe - a._adjSharpe);
      const chosen = rescored.slice(0, PER_FAMILY_QUOTA);
      familyQuotaUsed[strategyId] = chosen.length;
      for (const c of chosen) {
        newCandidates.push({
          id: genCandidateId(`${strategyId}-${c.symbol.slice(0, 3)}`),
          parentStrategy: strategyId,
          symbol: c.symbol,
          params: c.params,
          backtestResult: {
            trades: c.trades, sharpe: c.sharpe,
            winRate: c.winRate, profitFactor: c.profitFactor,
            netReturn: c.netReturn, maxDD: c.maxDD,
          },
          createdAt: new Date().toISOString(),
          status: "observing",
        });
      }
      if (chosen.length > 0) {
        L(`[quota] ${strategyId}: pool ${pool.length} → chosen ${chosen.length} (sharpe ${chosen.map(c => c.sharpe.toFixed(2)).join(", ")})`);
      }
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

    return res.status(200).json({
      ok: true,
      durationMs: Date.now() - t0,
      promoted,
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
