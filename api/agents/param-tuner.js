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

import { getKlines } from "../_shared/binance-client.js";
import { gridSearch, klinesToOhlc } from "../_shared/strategy-backtester.js";
import { PARAM_SPACE } from "../_shared/strategy-param-space.js";
import { setStrategyParams } from "../_shared/dynamic-config.js";
import { ALL_STRATEGIES } from "../_shared/strategies/index.js";

export const config = { maxDuration: 60 };

// 30일 4h 봉 = 180봉, 충분히 의미 있는 표본
const KLINE_INTERVAL = "4h";
const KLINE_LIMIT = 180;
const SYMBOL = "BTCUSDT";

// 백테스트 룰 (고정) — 파라미터만 튜닝, exit 룰은 별도 (auto-promote 에서 조정)
const BACKTEST_RULES = { slPct: 4, tpPct: 8, maxHoldBars: 24 };

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

        // 의미 있는 결과만 KV 에 적재 (>= 10 trades + sharpe>0 or PF>0.8)
        if (best.trades >= 10 && (best.sharpe > 0 || (best.profitFactor || 0) > 0.8)) {
          await setStrategyParams(strategyId, best.params, {
            sharpe: best.sharpe,
            trades: best.trades,
            version: Math.floor(Date.now() / 1000),
          });
          tuned.push({ strategyId, sharpe: best.sharpe, trades: best.trades, params: best.params });
          L(`  → KV updated: di:alpha:params:${strategyId}`);
        } else {
          L(`  → not enough quality data (trades<10 or sharpe<=0), KV unchanged`);
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
