// ════════════════════════════════════════════════════════════════════
// Zepta — Parameter Tuner (6시간 cron)
// ────────────────────────────────────────────────────────────────────
// 각 strategy 의 핵심 파라미터를 grid search 로 최적화.
//
// 동작:
//   1) Binance kline 으로 최근 30일 BTCUSDT 4h OHLC fetch (≈ 180봉)
//   2) PARAM_SPACE 의 모든 조합 시뮬레이션
//   3) Sharpe 가장 높은 조합 선택 (trades >= 10 필터)
//   4) KV `di:alpha:params:<strategyId>` 적재 → 다음 시그널 사이클부터 적용
//
// 핵심: 코드 배포 없이 파라미터 즉각 반영 (hot-reload).
//
// Cron: `0 */6 * * *` (6시간마다)
// Timeout: 60초 (8 strategy × 8 strategy × 평균 16조합 × 100ms ≈ 13초)
// ════════════════════════════════════════════════════════════════════

import { requireCronAuth } from "../_shared/require-cron.js";
import { getKlines } from "../_shared/binance-client.js";
import { gridSearch, klinesToOhlc } from "../_shared/strategy-backtester.js";
import { PARAM_SPACE } from "../_shared/strategy-param-space.js";
import { setStrategyParams } from "../_shared/dynamic-config.js";
import { ALL_STRATEGIES } from "../_shared/strategies/index.js";

async function getKv() { return (await import("@vercel/kv")).kv; }

export const config = { maxDuration: 60 };

// ★ 2026-05-29 — 30일(180봉)에선 전략이 선별적이라 trades<10 으로 매번 기각됐음.
//   83일(500봉)로 확대 → 표본 충분 (BTC 기준 전략당 12~30 trades).
//   또한 전략이 이제 params 를 실제 소비하므로 grid search 가 의미 있는 차이를 만든다.
const KLINE_INTERVAL = "4h";
const KLINE_LIMIT = 500;
const SYMBOL = "BTCUSDT";

// 실거래 파라미터 교체 기준 — continuous-backtest 와 같은 키(di:alpha:params:<id>)를
//   공유하므로, 기존 적재 Sharpe 보다 +margin 이상 우수할 때만 덮어쓴다 (flapping 방지).
const TUNER_MIN_SHARPE = 1.0;
const TUNER_MIN_PF = 1.1;
const TUNER_IMPROVE_MARGIN = 0.3;

// ★ 2026-05-31 (QUANT-PLAN) — param-tuner 직접 주입 기본 비활성.
//   문제: param-tuner 는 BTC 단일심볼 grid 만 보고 di:alpha:params 에 직접 써서,
//   continuous-backtest 의 교차심볼+OOS 과적합 가드를 *우회*함 (BTC-overfit 주입 위험).
//   해결: 검증 가드가 있는 continuous-backtest 를 유일 주입자로. param-tuner 는
//   grid search 결과를 로그/후보로만 남긴다. 복원 시 ZEPTA_PARAM_TUNER_INJECT=1.
const TUNER_INJECT_ENABLED = process.env.ZEPTA_PARAM_TUNER_INJECT === "1";

// 백테스트 룰 (고정) — 파라미터만 튜닝, exit 룰은 별도 (auto-promote 에서 조정)
// ★ timeframe: 캔들융합 TF 정합(적대리뷰 P2-2) — gridSearch→backtestStrategy 로 전달
const BACKTEST_RULES = { slPct: 4, tpPct: 8, maxHoldBars: 24, timeframe: KLINE_INTERVAL };

// strategy 가 cfg.params 를 받지 않는 경우 (다 그렇지만)
// 직접 paramSpace 를 받아 wrapper 로 임시 주입하는 방법:
//   - strategy 본체는 KV 안 읽음 (병렬 작업으로 수정중)
//   - 그래서 param-tuner 는 strategy 의 "감응도" 만 확인하는 의미
//   - 미래엔 strategy 가 cfg.params 받도록 확장 필요. 그 전엔 KV 만 적재
//
// 즉, 지금 단계의 param-tuner 는 다음 두 가지를 한다:
//   (1) grid search 자체는 strategy fn 호출 시 params arg 를 넘김 — strategy 가 받든 안받든 함수 시그니처는 안전
//   (2) 최적값을 KV 에 적재 → 다른 에이전트가 만들 신규 strategy 또는 추후 확장에 즉시 활용
//
// 만약 strategy fn 이 params 를 읽지 않으면 모든 조합이 동일 결과 → 첫 조합이 best 로 선택됨 (해롭지 않음).

async function fetchOhlc(symbol = SYMBOL) {
  const klines = await getKlines({ symbol, interval: KLINE_INTERVAL, limit: KLINE_LIMIT });
  return klinesToOhlc(klines);
}

export default async function handler(req, res) {
  if (!requireCronAuth(req, res)) return; // ★ 크론/내부 전용 (2026-07-08 무인증 노출 차단)
  res.setHeader("Access-Control-Allow-Origin", "*");
  const t0 = Date.now();
  const log = [];
  const L = (m) => { log.push(m); console.log("[param-tuner]", m); };

  try {
    // OHLC 1회 fetch → 모든 strategy 가 공유
    const ohlc = await fetchOhlc();
    L(`OHLC fetched: ${ohlc.length} bars (${KLINE_INTERVAL})`);
    if (ohlc.length < 80) {
      return res.status(200).json({ ok: false, error: "insufficient OHLC", log });
    }

    const results = {};
    const tuned = [];
    for (const [strategyId, strategyFn] of Object.entries(ALL_STRATEGIES)) {
      const space = PARAM_SPACE[strategyId];
      if (!space) {
        L(`skip ${strategyId} — no param space`);
        continue;
      }
      try {
        const t1 = Date.now();
        const gs = gridSearch({
          strategyFn,
          ohlc,
          paramSpace: space,
          fixedRules: BACKTEST_RULES,
        });
        const best = gs.best;
        const durMs = Date.now() - t1;
        results[strategyId] = {
          best,
          totalCombos: gs.totalCombos,
          durationMs: durMs,
        };
        L(`${strategyId}: ${gs.totalCombos} combos in ${durMs}ms — best Sharpe=${best.sharpe}, trades=${best.trades}, PF=${best.profitFactor}`);

        // 실거래 적재 기준: 충분한 표본 + 품질 + 기존보다 우수(margin)할 때만.
        const qualityOk = best.trades >= 10 && (best.sharpe || 0) >= TUNER_MIN_SHARPE && (best.profitFactor || 0) >= TUNER_MIN_PF;
        if (!qualityOk) {
          L(`  → 품질 미달 (trades ${best.trades}, Sharpe ${best.sharpe}, PF ${best.profitFactor}), KV 유지`);
        } else if (!TUNER_INJECT_ENABLED) {
          // 직접 주입 비활성 — 교차심볼/OOS 가드 우회 방지. 로그만 남기고 continuous-backtest 에 위임.
          L(`  → [advisory] BTC grid 우수(Sharpe ${(best.sharpe||0).toFixed(2)}, ${best.trades}T)이나 직접 주입 안 함 — 교차검증(continuous-backtest)에 위임`);
          tuned.push({ strategyId, sharpe: best.sharpe, trades: best.trades, params: best.params, injected: false });
        } else {
          let storedSharpe = null;
          try {
            const kv = await getKv();
            const stored = await kv.get(`di:alpha:params:${strategyId}`);
            if (stored && Number.isFinite(stored.sharpe)) storedSharpe = stored.sharpe;
          } catch {}
          if (storedSharpe != null && (best.sharpe || 0) < storedSharpe + TUNER_IMPROVE_MARGIN) {
            L(`  → 기존 적재(Sharpe ${storedSharpe.toFixed(2)})보다 우수하지 않음 (${(best.sharpe || 0).toFixed(2)}), KV 유지`);
          } else {
            await setStrategyParams(strategyId, best.params, {
              sharpe: best.sharpe,
              trades: best.trades,
              version: Math.floor(Date.now() / 1000),
            });
            tuned.push({ strategyId, sharpe: best.sharpe, trades: best.trades, params: best.params });
            L(`  → ✅ di:alpha:params:${strategyId} 실거래 반영 (Sharpe ${(best.sharpe || 0).toFixed(2)}, ${best.trades}T)`);
          }
        }
      } catch (e) {
        L(`${strategyId} ERROR: ${e?.message}`);
      }
    }

    return res.status(200).json({
      ok: true,
      durationMs: Date.now() - t0,
      ohlcBars: ohlc.length,
      tuned,
      results,
      log,
    });
  } catch (err) {
    console.error("[param-tuner] fatal:", err);
    return res.status(200).json({ ok: false, error: err?.message || String(err), log });
  }
}
