// ════════════════════════════════════════════════════════════════════
// Zepta — Strategy Backtester
// ────────────────────────────────────────────────────────────────────
// strategy 모듈을 OHLC 시계열에 적용해 누적 성과를 시뮬레이션.
//
// 사용처:
//   - param-tuner (Phase 2): 같은 strategy 의 파라미터 grid 를 탐색해
//     Sharpe 최고인 조합 선택
//   - continuous-backtest (Phase 5): 변형 strategy 를 60일 데이터로
//     검증 후 후보 등록
//
// 동작:
//   1) 입력: OHLC 시계열 + strategy 함수 + 룰 (SL/TP/maxHold)
//   2) 각 봉 시점에 strategy 호출 → 시그널 나오면 진입
//   3) 다음 봉부터 SL/TP/maxHold 체크 → 청산
//   4) Sharpe, PF, hit rate, max DD, avg holdMs 계산
//
// 가정·근사:
//   - 진입: 시그널 봉의 close 가격
//   - SL/TP: 다음 봉부터 high/low 로 체크 (intra-bar 순서 모르므로 보수적 — LONG 은 SL 우선)
//   - 슬리피지 / 수수료: 0.1% (10bps) 가정 (왕복 0.2%)
//   - 한 번에 하나의 포지션만 (concurrent 진입 무시)
//
// 입력 OHLC 형식:
//   [{ ts: number, o, h, l, c, v }, ...]  (timestamp 오름차순)
//
// Binance klines [openTime, open, high, low, close, volume, ...] 도
// `klinesToOhlc()` 헬퍼로 변환 가능.
// ════════════════════════════════════════════════════════════════════

const FEE_BPS = 10; // 왕복 0.1% (1pt = 0.0001)
const ANNUALIZE = Math.sqrt(252); // 일봉 가정 시 연환산 (param-tuner 는 4h 봉도 쓰지만 단순화)

/**
 * Binance klines 배열 → ohlc 객체 배열로 변환.
 */
export function klinesToOhlc(klines) {
  if (!Array.isArray(klines)) return [];
  return klines.map((k) => ({
    ts: Number(k[0]),
    o: Number(k[1]),
    h: Number(k[2]),
    l: Number(k[3]),
    c: Number(k[4]),
    v: Number(k[5]),
  })).filter((x) => Number.isFinite(x.c));
}

/**
 * OHLC 시계열 1점 → strategy 가 요구하는 input 형태 (window 끝점).
 */
function windowSlice(ohlc, endIdx, minBars = 60) {
  if (endIdx + 1 < minBars) return null;
  const startIdx = Math.max(0, endIdx + 1 - 240); // 최근 240봉 (~10일 1h, ~10달 1d)
  const slice = ohlc.slice(startIdx, endIdx + 1);
  return {
    closes: slice.map((b) => b.c),
    highs: slice.map((b) => b.h),
    lows: slice.map((b) => b.l),
    volumes: slice.map((b) => b.v),
    opens: slice.map((b) => b.o), // ★ 2026-07 캔들패턴 융합 — 윈도우 끝봉=완결봉(진입은 i+1 시가라 룩어헤드 없음)
  };
}

/**
 * 단일 strategy 백테스트.
 * @param {object} opts
 * @param {Function} opts.strategyFn   strategy 함수 (input 받아서 signal 또는 null)
 * @param {Array} opts.ohlc            OHLC 시계열 [{ts,o,h,l,c,v}]
 * @param {object} [opts.params]       strategy 에 주입할 파라미터 (cfg.params)
 * @param {number} [opts.slPct=4]      손절 %
 * @param {number} [opts.tpPct=8]      익절 %
 * @param {number} [opts.maxHoldBars=24] 최대 보유 봉 수
 * @param {number} [opts.minBars=60]
 * @returns {object} { trades, wins, losses, winRate, netReturn, sharpe, profitFactor, maxDD, avgHoldMs }
 */
export function backtestStrategy({
  strategyFn,
  ohlc,
  params = null,
  slPct = 4,
  tpPct = 8,
  maxHoldBars = 24,
  minBars = 60,
  timeframe = "1h", // ★ 2026-07: 실제 봉 TF 전달(캔들패턴 캘리브레이션 TF 매칭용). 기존 하드코딩 "1h" 하위호환.
}) {
  if (typeof strategyFn !== "function" || !Array.isArray(ohlc) || ohlc.length < minBars + 5) {
    return emptyResult();
  }

  const trades = [];
  let equity = 1.0;
  let equityCurve = [1.0];
  let peak = 1.0;
  let maxDD = 0;

  let i = minBars;
  while (i < ohlc.length - 1) {
    const win = windowSlice(ohlc, i, minBars);
    if (!win) { i += 1; continue; }
    let signal;
    try {
      signal = strategyFn({ ...win, params, asset: "BTC/USD", timeframe });
    } catch (e) {
      signal = null;
    }
    if (!signal || !signal.side) { i += 1; continue; }

    // ★ 2026-06-14 (감사 P2): 룩어헤드 바이어스 제거. 신호는 봉 i 종가까지로 계산되지만
    //   실거래는 봉 i 종료 후(다음 cron) 인지 → 봉 i+1 *시가* 진입이 현실적. 기존 entryBar.c
    //   (봉 i 종가)는 신호 생성에 쓴 바로 그 가격에 진입하는 낙관편향 → 승급판정 과대평가.
    const entryIdx = i + 1;
    if (entryIdx > ohlc.length - 1) break; // 다음 봉 없음 — 마지막 신호는 진입 불가
    const entryBar = ohlc[entryIdx];
    const entryPrice = entryBar.o;
    const side = signal.side;
    const slMult = side === "LONG" ? (1 - slPct / 100) : (1 + slPct / 100);
    const tpMult = side === "LONG" ? (1 + tpPct / 100) : (1 - tpPct / 100);
    const slPrice = entryPrice * slMult;
    const tpPrice = entryPrice * tpMult;

    // 청산 탐색 — 진입 봉(i+1)부터(시가 진입 후 같은 봉 내 intrabar SL/TP 가능)
    let exitIdx = -1;
    let exitPrice = entryPrice;
    let exitReason = "TIME";
    const endIdx = Math.min(ohlc.length - 1, entryIdx + maxHoldBars);
    for (let j = entryIdx; j <= endIdx; j++) {
      const bar = ohlc[j];
      if (side === "LONG") {
        // 보수적: 같은 봉에서 SL/TP 둘 다 닿으면 SL 우선
        // ★ 적대감사 P1-6: 갭다운 모델링 — 봉 시가가 SL 아래로 열렸으면 시가(더 불리)로 체결.
        //   기존엔 무조건 slPrice 로 박아 갭 손실(5x 레버리지에서 -6~-10%)을 SL 폭으로 과소평가했음.
        if (bar.l <= slPrice) { exitIdx = j; exitPrice = Math.min(slPrice, bar.o); exitReason = "SL"; break; }
        if (bar.h >= tpPrice) { exitIdx = j; exitPrice = tpPrice; exitReason = "TP"; break; }
      } else {
        if (bar.h >= slPrice) { exitIdx = j; exitPrice = Math.max(slPrice, bar.o); exitReason = "SL"; break; }
        if (bar.l <= tpPrice) { exitIdx = j; exitPrice = tpPrice; exitReason = "TP"; break; }
      }
    }
    if (exitIdx < 0) {
      exitIdx = endIdx;
      exitPrice = ohlc[endIdx].c;
      exitReason = "TIME";
    }

    // 수익률 (왕복 수수료 차감)
    let pnlPct = side === "LONG"
      ? (exitPrice - entryPrice) / entryPrice
      : (entryPrice - exitPrice) / entryPrice;
    pnlPct -= FEE_BPS / 10000; // 왕복 0.1%

    trades.push({
      entryIdx, entryPrice, side, exitIdx, exitPrice, exitReason,
      pnlPct, holdMs: (ohlc[exitIdx].ts - entryBar.ts) || 0,
      entryTs: entryBar.ts, exitTs: ohlc[exitIdx].ts, // ★ P1-7: 빈도 기반 연환산용
      confidence: signal.confidence, family: signal.family,
    });

    equity *= (1 + pnlPct);
    equityCurve.push(equity);
    if (equity > peak) peak = equity;
    const dd = (peak - equity) / peak;
    if (dd > maxDD) maxDD = dd;

    // 다음 진입은 청산 이후 봉부터 (no concurrent)
    i = exitIdx + 1;
  }

  return summarize(trades, equityCurve, maxDD);
}

function summarize(trades, equityCurve, maxDD) {
  if (trades.length === 0) return emptyResult();
  const wins = trades.filter((t) => t.pnlPct > 0).length;
  const losses = trades.length - wins;
  const winRate = wins / trades.length;
  const netReturn = equityCurve[equityCurve.length - 1] - 1;
  const grossWin = trades.filter((t) => t.pnlPct > 0).reduce((a, b) => a + b.pnlPct, 0);
  const grossLoss = trades.filter((t) => t.pnlPct < 0).reduce((a, b) => a + Math.abs(b.pnlPct), 0);
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? Infinity : 0);
  // Sharpe (per-trade 기반, 연환산은 일/주기 모름 → 단순 / sqrt(N))
  const meanPnl = trades.reduce((a, b) => a + b.pnlPct, 0) / trades.length;
  const variance = trades.reduce((a, b) => a + (b.pnlPct - meanPnl) ** 2, 0) / trades.length;
  const sd = Math.sqrt(variance);
  // ★ 적대감사 P1-7: √252 고정은 4h 데이터에서 Sharpe 과대(거래 빈도 무시 — "Sharpe 17" 원인).
  //   실제 빈도 기반 연환산 옵션(ZEPTA_SHARPE_FREQ_ANNUALIZE=1). ※ 켜면 Sharpe *스케일이 바뀌어*
  //   승급 게이트 임계(minSharpe 등)가 어긋나므로 데이터 기반 재보정 필수 → 기본 OFF 로 현 파이프라인
  //   보존(별도 재보정 라운드에서 활성). 빈도 기반: annualize = sqrt(연간 거래수).
  let annualize = ANNUALIZE;
  if (process.env.ZEPTA_SHARPE_FREQ_ANNUALIZE === "1" && trades.length >= 2) {
    const firstTs = trades[0].entryTs, lastTs = trades[trades.length - 1].exitTs;
    const spanYears = (lastTs > firstTs) ? (lastTs - firstTs) / (365.25 * 24 * 3600 * 1000) : 0;
    if (spanYears > 0) annualize = Math.sqrt(Math.max(1, trades.length / spanYears));
  }
  const sharpe = sd > 0 ? (meanPnl / sd) * annualize : 0;
  const avgHoldMs = trades.reduce((a, b) => a + b.holdMs, 0) / trades.length;
  const byReason = trades.reduce((acc, t) => { acc[t.exitReason] = (acc[t.exitReason] || 0) + 1; return acc; }, {});

  return {
    trades: trades.length,
    wins, losses,
    winRate: Number((winRate * 100).toFixed(2)),
    netReturn: Number((netReturn * 100).toFixed(2)),
    sharpe: Number(sharpe.toFixed(3)),
    profitFactor: Number.isFinite(profitFactor) ? Number(profitFactor.toFixed(3)) : null,
    maxDD: Number((maxDD * 100).toFixed(2)),
    avgHoldMs: Math.round(avgHoldMs),
    avgHoldHours: Number((avgHoldMs / 3600000).toFixed(1)),
    byCloseReason: byReason,
  };
}

function emptyResult() {
  return {
    trades: 0, wins: 0, losses: 0, winRate: 0, netReturn: 0,
    sharpe: 0, profitFactor: null, maxDD: 0,
    avgHoldMs: 0, avgHoldHours: 0, byCloseReason: {},
  };
}

/**
 * Grid search — 파라미터 조합 전부 시뮬레이션 후 Sharpe 가장 높은 조합 선택.
 *
 * @param {object} opts
 * @param {Function} opts.strategyFn
 * @param {Array} opts.ohlc
 * @param {object} opts.paramSpace  { RSI_BUY: [25,30,35], ATR_MULT: [1.5,2.0] }
 * @param {object} [opts.fixedRules] { slPct, tpPct, maxHoldBars }
 * @returns {object} { best, all, totalCombos }
 */
export function gridSearch({ strategyFn, ohlc, paramSpace, fixedRules = {} }) {
  const keys = Object.keys(paramSpace || {});
  if (keys.length === 0) {
    // 파라미터 없음 → 단일 백테스트
    const r = backtestStrategy({ strategyFn, ohlc, ...fixedRules });
    return { best: { params: {}, ...r }, all: [{ params: {}, ...r }], totalCombos: 1 };
  }
  const combos = cartesian(keys.map((k) => paramSpace[k].map((v) => ({ [k]: v }))));
  const results = [];
  for (const c of combos) {
    const params = Object.assign({}, ...c);
    const r = backtestStrategy({ strategyFn, ohlc, params, ...fixedRules });
    results.push({ params, ...r });
  }
  // 정렬: Sharpe 우선, 동률이면 PF, 동률이면 netReturn, trades 최소 10 우선
  results.sort((a, b) => {
    const aValid = a.trades >= 10;
    const bValid = b.trades >= 10;
    if (aValid !== bValid) return aValid ? -1 : 1;
    if (b.sharpe !== a.sharpe) return b.sharpe - a.sharpe;
    if ((b.profitFactor || 0) !== (a.profitFactor || 0)) return (b.profitFactor || 0) - (a.profitFactor || 0);
    return b.netReturn - a.netReturn;
  });
  return {
    best: results[0],
    all: results,
    totalCombos: results.length,
  };
}

// 카테시안 곱: [[{a:1},{a:2}], [{b:1}]] → [[{a:1},{b:1}], [{a:2},{b:1}]]
function cartesian(arrs) {
  return arrs.reduce(
    (acc, cur) => acc.flatMap((a) => cur.map((c) => [...a, c])),
    [[]]
  );
}

export default {
  backtestStrategy,
  gridSearch,
  klinesToOhlc,
};
