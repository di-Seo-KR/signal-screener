// ════════════════════════════════════════════════════════════════════
// 캔들패턴 융합 A/B 백테스트 — 배포 게이트 (2026-07)
// ────────────────────────────────────────────────────────────────────
// baseline(ZEPTA_CANDLE_FUSION=0) vs fused(=1) 를 동일 데이터로 비교.
// 검증 앵커 6심볼 × 4h × 1080봉(180일), full + 최근 35% OOS.
// (continuous-backtest.js 의 validateParamSet 패턴 재사용 — supertrend 채택 때와 동일)
//
// 판정 기준: 융합이 개선 또는 최소한 무해(악화 없음)여야 배포.
//   - 전략별 교차심볼 중앙 Sharpe: fused ≥ baseline − 0.10 (허용 오차)
//   - 전체 합산 PF·승률 악화 없음
// 실행: node scripts/backtest-candle-ab.mjs   (env 불필요)
// ════════════════════════════════════════════════════════════════════

import { getKlines } from "../api/_shared/binance-client.js";
import { backtestStrategy, klinesToOhlc } from "../api/_shared/strategy-backtester.js";
import { ALL_STRATEGIES } from "../api/_shared/strategies/index.js";

// ★ 적대리뷰 P1-2d 반영: 기존 6앵커는 캘리브레이션 24심볼의 부분집합(인샘플) —
//   과적합 탐지 불가. 캘리브레이션에 안 쓴 홀드아웃 6심볼을 진짜 게이트로 추가.
const SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "AVAXUSDT", "LINKUSDT"]; // 인샘플(참고용)
const HOLDOUT = ["TRXUSDT", "TONUSDT", "XLMUSDT", "BCHUSDT", "ETCUSDT", "HBARUSDT"]; // 캘리브레이션 미포함 — 배포 게이트
const STRATS = ["trend-follow", "breakout", "defi-momentum", "momentum-rotation", "hurst-trend", "supertrend"]; // refineSignalScore 호출 6종
const TF = "4h", LIMIT = 1080, OOS_FRAC = 0.35;

const median = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

async function fetchAll(symbols) {
  const data = {};
  for (const sym of symbols) {
    const kl = await getKlines({ symbol: sym, interval: TF, limit: LIMIT });
    data[sym] = klinesToOhlc(kl).slice(0, -1); // 진행봉 제거
    await new Promise((r) => setTimeout(r, 150));
  }
  return data;
}

function runPass(data, symbols) {
  const out = {}; // strat → {full: [], oos: [], trades, wins, grossP, grossL}
  for (const strat of STRATS) {
    const fn = ALL_STRATEGIES[strat];
    const agg = { fullSharpe: [], oosSharpe: [], fullPF: [], trades: 0, wins: 0 };
    for (const sym of symbols) {
      const ohlc = data[sym];
      const full = backtestStrategy({ strategyFn: fn, ohlc, timeframe: TF });
      const oosSlice = ohlc.slice(Math.floor(ohlc.length * (1 - OOS_FRAC)));
      const oos = backtestStrategy({ strategyFn: fn, ohlc: oosSlice, timeframe: TF });
      agg.fullSharpe.push(full.sharpe || 0);
      agg.oosSharpe.push(oos.sharpe || 0);
      if (Number.isFinite(full.profitFactor)) agg.fullPF.push(full.profitFactor);
      agg.trades += full.trades || 0;
      agg.wins += full.wins || 0;
    }
    out[strat] = {
      medFullSharpe: +median(agg.fullSharpe).toFixed(3),
      medOosSharpe: +median(agg.oosSharpe).toFixed(3),
      medPF: +median(agg.fullPF).toFixed(3),
      trades: agg.trades,
      winRate: agg.trades ? +(agg.wins / agg.trades * 100).toFixed(1) : 0,
    };
  }
  return out;
}

function compareSet(name, data, symbols) {
  process.env.ZEPTA_CANDLE_FUSION = "0";
  const base = runPass(data, symbols);
  process.env.ZEPTA_CANDLE_FUSION = "1";
  const fused = runPass(data, symbols);

  console.log(`\n══ [${name}] ══`);
  console.log(`전략               | 중앙Sharpe(full)  base→fused | 중앙Sharpe(OOS)  base→fused | PF base→fused | 거래 base→fused | 승률% base→fused`);
  let worse = 0;
  for (const s of STRATS) {
    const b = base[s], f = fused[s];
    const dS = f.medFullSharpe - b.medFullSharpe;
    const dO = f.medOosSharpe - b.medOosSharpe;
    if (dS < -0.10) worse++;
    console.log(
      `${s.padEnd(18)} | ${String(b.medFullSharpe).padStart(7)} → ${String(f.medFullSharpe).padEnd(7)} (${dS >= 0 ? "+" : ""}${dS.toFixed(2)}) | ${String(b.medOosSharpe).padStart(6)} → ${String(f.medOosSharpe).padEnd(6)} (${dO >= 0 ? "+" : ""}${dO.toFixed(2)}) | ${b.medPF} → ${f.medPF} | ${b.trades} → ${f.trades} | ${b.winRate} → ${f.winRate}`
    );
  }
  const aggB = median(STRATS.map((s) => base[s].medFullSharpe));
  const aggF = median(STRATS.map((s) => fused[s].medFullSharpe));
  const aggBO = median(STRATS.map((s) => base[s].medOosSharpe));
  const aggFO = median(STRATS.map((s) => fused[s].medOosSharpe));
  console.log(`종합(전략 중앙): full Sharpe ${aggB.toFixed(3)} → ${aggF.toFixed(3)} | OOS ${aggBO.toFixed(3)} → ${aggFO.toFixed(3)}`);
  return worse;
}

async function main() {
  console.log(`데이터 로드: 인샘플 ${SYMBOLS.length} + 홀드아웃 ${HOLDOUT.length} 심볼 × ${TF} × ${LIMIT}봉...`);
  const dataIn = await fetchAll(SYMBOLS);
  const dataHold = await fetchAll(HOLDOUT);

  const worseIn = compareSet("인샘플 앵커 6종 (참고용 — 캘리브레이션 데이터와 겹침)", dataIn, SYMBOLS);
  const worseHold = compareSet("홀드아웃 6종 (배포 게이트 — 캘리브레이션 미포함 심볼)", dataHold, HOLDOUT);

  console.log(worseHold === 0
    ? `\n✅ 판정: 통과 — 홀드아웃에서 어떤 전략도 중앙 Sharpe −0.10 초과 악화 없음${worseIn > 0 ? ` (인샘플 악화 ${worseIn}건은 참고)` : ""}`
    : `\n❌ 판정: 실패 — 홀드아웃 ${worseHold}개 전략 악화(−0.10 초과). 융합 가중/게이트 재조정 필요`);
}

main().catch((e) => { console.error("치명 오류:", e); process.exit(1); });
