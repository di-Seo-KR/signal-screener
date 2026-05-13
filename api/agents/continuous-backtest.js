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

    // 3) 각 심볼별 OHLC + strategy × params sweep
    const newCandidates = [];
    const scanResults = {}; // { [symbol]: { [strategyId]: {...} } }
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
              r.trades >= CANDIDATE_THRESHOLD.minTrades &&
              r.sharpe >= CANDIDATE_THRESHOLD.minSharpe &&
              r.maxDD <= CANDIDATE_THRESHOLD.maxDD
            ) {
              passedHere.push({ params, ...r });
            }
          } catch (e) {
            // 개별 시뮬 실패는 무시 — 다음 sample 진행
          }
        }
        scanResults[symbol][strategyId] = { samples: samples.length, best: bestOfStrategy, passed: passedHere.length };

        // 통과 후보 중 최고 1개만 등록 (스팸 방지) — symbol 정보 포함
        if (passedHere.length > 0) {
          passedHere.sort((a, b) => b.sharpe - a.sharpe);
          const winner = passedHere[0];
          newCandidates.push({
            id: genCandidateId(`${strategyId}-${symbol.slice(0, 3)}`),
            parentStrategy: strategyId,
            symbol,
            params: winner.params,
            backtestResult: {
              trades: winner.trades, sharpe: winner.sharpe,
              winRate: winner.winRate, profitFactor: winner.profitFactor,
              netReturn: winner.netReturn, maxDD: winner.maxDD,
            },
            createdAt: new Date().toISOString(),
            status: "observing",
          });
          L(`[${symbol}] ${strategyId}: ${passedHere.length} passed → candidate registered (Sharpe ${winner.sharpe.toFixed(2)})`);
        }
      }
    }

    // 4) 새 후보 등록
    if (newCandidates.length > 0 && !dryRun) {
      const existing = (await kv.get("di:alpha:strategy-candidates")) || [];
      const merged = [...existing, ...newCandidates].slice(-MAX_CANDIDATES);
      await kv.set("di:alpha:strategy-candidates", merged);
      L(`new candidates registered: ${newCandidates.length}, total: ${merged.length}`);
    }

    return res.status(200).json({
      ok: true,
      durationMs: Date.now() - t0,
      promoted,
      newCandidates,
      scanResults,
      dryRun,
      log,
    });
  } catch (err) {
    console.error("[continuous-backtest] fatal:", err);
    return res.status(200).json({ ok: false, error: err?.message || String(err), log });
  }
}
