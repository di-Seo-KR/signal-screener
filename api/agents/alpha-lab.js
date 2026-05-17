// ════════════════════════════════════════════════════════════════════
// Zepta — Alpha Lab (1시간 cron)
// ────────────────────────────────────────────────────────────────────
// 모든 사용자의 shadow-summary + live-summary 를 분석해 다음을 산출:
//   1) Strategy 별 종합 메트릭 (Sharpe·PF·hit rate·max DD·avg holdMs·trades)
//   2) 종목별 메트릭
//   3) Timeframe 별 메트릭
//   4) 시장 레짐 스냅샷 (BTC Hurst·ATR·trend) — strategy-router 의 input
//
// 결과 KV:
//   di:alpha:leaderboard      → 가장 최근 분석 결과 (UI / 다른 cron 이 읽음)
//   di:alpha:leaderboard:hist → 최근 168시간 (7일) 시계열 push (Q: 누적 추세 분석용)
//
// + 시장 레짐 갱신: strategy-router.updateMarketRegimeAndWeights() 호출
//   → di:alpha:strategy-weights 자동 적재 → 다음 시그널 사이클부터 적용
//
// Cron: `0 * * * *` (매시 정각)
// Timeout: 60초 (모든 사용자 처리. shadow-summary 가 누적 데이터라 빠름)
// ════════════════════════════════════════════════════════════════════

import { getKlines } from "../_shared/binance-client.js";
import { updateMarketRegimeAndWeights } from "../_shared/strategy-router.js";

export const config = { maxDuration: 60 };

const PROBE_USER = "__zepta_global_probe__";
const MAX_HIST_HOURS = 168; // 7일

async function getKv() {
  return (await import("@vercel/kv")).kv;
}

// ────────────────────────────────────────────────────────────────────
// 사용자 목록 — phase1-users + probe 합집합
// ────────────────────────────────────────────────────────────────────
async function listAllUsers(kv) {
  const users = new Set([PROBE_USER]);
  try {
    const phase1 = (await kv.get("di:real:phase1-users")) || [];
    if (Array.isArray(phase1)) phase1.forEach((u) => users.add(u));
  } catch {}
  try {
    const active = (await kv.get("di:real:active-users")) || [];
    if (Array.isArray(active)) active.forEach((u) => users.add(u));
  } catch {}
  return [...users];
}

// ────────────────────────────────────────────────────────────────────
// 단일 사용자의 shadow / live 데이터 + ledger 통합 fetch
// ────────────────────────────────────────────────────────────────────
async function fetchUserData(kv, userId) {
  const [shadow, live, ledger] = await Promise.all([
    kv.get(`di:real:user:${userId}:shadow-summary`).catch(() => null),
    kv.get(`di:real:user:${userId}:live-summary`).catch(() => null),
    kv.get(`di:real:user:${userId}:shadow-ledger`).then((v) => v || []).catch(() => []),
  ]);
  return { userId, shadow, live, ledger };
}

// ★ 2026-05-12 hotfix: shadow ledger 의 옛 trade 들이 strategy id 를 raw family
// 값 ("trend", "mean", "unknown" 등) 으로 적재해서 leaderboard 가 옛 키만 가짐.
// auto-promote 는 DEFAULT_STRATEGY_WEIGHTS 의 새 키 (trend-follow, mean-revert 등) 로
// 조회하므로 모든 strategy 가 metrics 없음 → "no data" 강등 발생.
// 매핑 테이블로 raw family → 새 strategy id 통합 → leaderboard 정상화.
const RAW_SID_TO_NEW = {
  "trend":          "trend-follow",
  "trending":       "trend-follow",
  "mean-reverting": "mean-revert",
  "mean":           "mean-revert",
  "reverting":      "mean-revert",
  "breakout":       "breakout",
  "momentum":       "momentum-rotation",
  "rotation":       "momentum-rotation",
  "volatility":     "volatility-arb",
  "vol-arb":        "volatility-arb",
  "hurst":          "hurst-trend",
  "defi":           "defi-momentum",
  "ensemble":       "ensemble",
};
function normalizeStrategyId(rawSid) {
  if (!rawSid) return "unknown";
  if (RAW_SID_TO_NEW[rawSid]) return RAW_SID_TO_NEW[rawSid];
  // 이미 정규화된 id (trend-follow 등) 또는 신규 family 는 그대로
  return rawSid;
}

// ledger 의 CLOSED 항목에서 strategy 별 PnL 시계열 추출 (Sharpe / maxDD 계산용)
//
// ★ 2026-05-17 단위 정정 (QUANT-RES):
//   pnlPct = pnl / notional 은 ROI (마진 대비) 가 아니라 "노시오날 대비 손익률".
//   이 값을 단순 합산 (reduce + 단위 ×100) 하니 1000건의 작은 손실이 -1000%+ 가 됨.
//   해결: pnlPct 는 "거래당 ROI ratio" (소수, 예: 0.012 = 1.2%) 로 정의하고
//        합산 대신 평균/복리/메디안 등 robust statistics 사용.
function strategyPnlSeries(ledger) {
  const out = {}; // strategyId -> Array<{ts, pnlPct, holdMs}>
  for (const e of ledger || []) {
    if (e?.status !== "CLOSED") continue;
    const rawSid = e?.plan?.strategyId || e?.signal?.strategy || e?.plan?.strategyFamily || e?.signal?.strategyFamily || "unknown";
    const sid = normalizeStrategyId(rawSid);
    const tf = e?.signal?.timeframe || "unknown";
    const sym = e?.plan?.symbol || e?.signal?.symbol || "unknown";
    const ts = Date.parse(e.closedAt || e.openedAt || "") || 0;
    const notional = Number(e?.plan?.notional || 0);
    const marginRequired = Number(e?.plan?.marginRequired || 0);
    const pnl = Number(e?.netPnL || 0);
    // ROI ratio: 마진 대비 손익. 마진 없으면 notional 폴백.
    const denom = marginRequired > 0 ? marginRequired : (notional > 0 ? notional : 1);
    let pnlPct = pnl / denom;
    // ★ 단위 sanity guard: ROI ratio 가 |±5| 이상이면 100x 배율 오류 의심 → drop.
    //   정상 거래의 ROI 는 -1.0 ~ +5.0 (마진 대비 -100% ~ +500%) 범위.
    if (!Number.isFinite(pnlPct) || Math.abs(pnlPct) > 5) continue;
    const holdMs = ts && e.openedAt ? Math.max(0, ts - Date.parse(e.openedAt)) : 0;
    if (!out[sid]) out[sid] = [];
    out[sid].push({ ts, pnlPct, holdMs, sym, tf, pnlUsd: pnl });
  }
  return out;
}

// Winsorize — 상하 1% 절단 (robust statistics).
// 1건의 이상치가 표준편차 / 합산 결과를 왜곡하지 않게 trim.
function winsorize(values, pct = 0.01) {
  if (!values || values.length < 20) return values.slice(); // 표본 작으면 trim 안 함
  const sorted = [...values].sort((a, b) => a - b);
  const k = Math.floor(sorted.length * pct);
  if (k === 0) return sorted;
  const lo = sorted[k];
  const hi = sorted[sorted.length - 1 - k];
  return values.map((v) => Math.min(hi, Math.max(lo, v)));
}

// 메트릭 계산 — Sharpe, PF, hit rate, maxDD, avgHoldMs
//
// ★ 2026-05-17 정정 (QUANT-RES):
//   - netPnL: "거래당 평균 ROI × 100" (백분율) — 이전 "ROI 단순 합" 은 비현실 (-12919% 등).
//   - netPnLUsd: 누적 USD 손익 (있을 때만, 신규 필드).
//   - sharpe: stdDev < 0.001 가드 + winsorize + cap (-10 ~ +10) 로 폭주 방지.
//   - maxDD: ROI 복리 누적 (기존 유지하되 ROI ratio 가 클리닝된 값 기반).
function computeMetrics(trades) {
  if (!trades || trades.length === 0) {
    return { trades: 0, wins: 0, losses: 0, winRate: 0, netPnL: 0, netPnLUsd: 0, avgROI: 0, sharpe: 0, profitFactor: null, maxDD: 0, avgHoldMs: 0, avgHoldHours: 0 };
  }
  const wins = trades.filter((t) => (t.pnlPct ?? 0) > 0).length;
  const losses = trades.length - wins;

  const rawPcts = trades.map((t) => Number(t.pnlPct) || 0);
  const pcts = winsorize(rawPcts, 0.01); // 상하 1% 절단

  const sum = pcts.reduce((a, v) => a + v, 0);
  const mean = sum / pcts.length;
  const variance = pcts.reduce((a, v) => a + (v - mean) ** 2, 0) / pcts.length;
  const sd = Math.sqrt(variance);

  // Sharpe — 표본당 단위 (annualize 제거. 거래 빈도가 다양해 252 multiplier 가 왜곡).
  //   원하면 daily-bar 기반 annualize 별도 산출 가능.
  let sharpe = 0;
  if (sd > 0.001 && Number.isFinite(mean)) {
    sharpe = mean / sd;
    // 안전 cap — 표본 수 20개 미만이면 통계적 유의성 약하므로 cap 강하게
    const cap = pcts.length < 20 ? 3 : 10;
    if (sharpe > cap) sharpe = cap;
    if (sharpe < -cap) sharpe = -cap;
  }

  // ProfitFactor — winsorized values 기준
  const grossWin = pcts.filter((v) => v > 0).reduce((a, b) => a + b, 0);
  const grossLoss = pcts.filter((v) => v < 0).reduce((a, b) => a + Math.abs(b), 0);
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? null : 0);

  // maxDD — 복리 equity 곡선 기반 (winsorized).
  let equity = 1.0, peak = 1.0, maxDD = 0;
  const sortedIdx = pcts.map((v, i) => ({ v, ts: trades[i]?.ts || 0 })).sort((a, b) => a.ts - b.ts);
  for (const t of sortedIdx) {
    equity *= 1 + (t.v || 0);
    if (equity > peak) peak = equity;
    const dd = (peak - equity) / peak;
    if (dd > maxDD) maxDD = dd;
  }

  const avgHoldMs = trades.reduce((a, t) => a + (t.holdMs || 0), 0) / trades.length;
  // 누적 USD (있을 때만 — 신규 plan 부터 marginRequired 적재됨)
  const netPnLUsd = trades.reduce((a, t) => a + (Number(t.pnlUsd) || 0), 0);

  return {
    trades: trades.length,
    wins, losses,
    winRate: Number((wins / trades.length * 100).toFixed(2)),
    // ★ netPnL — "거래당 평균 ROI %" 로 의미 변경 (이전 단순 합산은 비현실).
    netPnL: Number((mean * 100).toFixed(2)),
    avgROI: Number((mean * 100).toFixed(2)),
    netPnLUsd: Number(netPnLUsd.toFixed(2)),
    sharpe: Number(sharpe.toFixed(3)),
    profitFactor: profitFactor != null ? Number(profitFactor.toFixed(3)) : null,
    maxDD: Number((maxDD * 100).toFixed(2)),
    avgHoldMs: Math.round(avgHoldMs),
    avgHoldHours: Number((avgHoldMs / 3600000).toFixed(1)),
  };
}

// ────────────────────────────────────────────────────────────────────
// Aggregator — 모든 사용자 데이터를 strategy/symbol/timeframe 차원으로 합산
// ────────────────────────────────────────────────────────────────────
function aggregateAcrossUsers(userDatas) {
  // strategyId -> Array<trade>
  const byStrategy = {};
  const bySymbol = {};
  const byTimeframe = {};

  // shadow-summary 의 byFamily 기반 fallback 메트릭 (ledger 없을 때)
  const familyFallback = {};

  for (const ud of userDatas) {
    const series = strategyPnlSeries(ud.ledger);
    for (const [sid, trades] of Object.entries(series)) {
      if (!byStrategy[sid]) byStrategy[sid] = [];
      byStrategy[sid].push(...trades);
      for (const t of trades) {
        const sk = t.sym;
        if (!bySymbol[sk]) bySymbol[sk] = [];
        bySymbol[sk].push(t);
        const tfk = t.tf;
        if (!byTimeframe[tfk]) byTimeframe[tfk] = [];
        byTimeframe[tfk].push(t);
      }
    }
    // shadow-summary fallback (ledger 가 빈약해도 byFamily 는 누적됨)
    // ★ family raw id ("trend", "mean" 등) 도 normalizeStrategyId 로 정규화 → new id 통합
    const sum = ud.shadow;
    if (sum?.byFamily) {
      for (const [rawFam, s] of Object.entries(sum.byFamily)) {
        const fam = normalizeStrategyId(rawFam);
        if (!familyFallback[fam]) familyFallback[fam] = { trades: 0, wins: 0, netPnL: 0 };
        familyFallback[fam].trades += s.trades || 0;
        familyFallback[fam].wins += s.wins || 0;
        familyFallback[fam].netPnL += s.netPnL || 0;
      }
    }
  }

  // 메트릭 계산
  const strategies = {};
  for (const [sid, trades] of Object.entries(byStrategy)) {
    strategies[sid] = computeMetrics(trades);
  }
  // fallback — ledger 데이터 없는 family 는 summary 의 누적치 사용
  for (const [fam, s] of Object.entries(familyFallback)) {
    if (strategies[fam]) continue;
    if (!s.trades) continue;
    const winRate = s.wins / s.trades;
    strategies[fam] = {
      trades: s.trades,
      wins: s.wins, losses: s.trades - s.wins,
      winRate: Number((winRate * 100).toFixed(2)),
      netPnL: Number(s.netPnL.toFixed(2)),
      sharpe: 0, profitFactor: null, maxDD: 0, avgHoldMs: 0, avgHoldHours: 0,
      _source: "summary-fallback",
    };
  }

  const symbols = {};
  for (const [sym, trades] of Object.entries(bySymbol)) symbols[sym] = computeMetrics(trades);
  const timeframes = {};
  for (const [tf, trades] of Object.entries(byTimeframe)) timeframes[tf] = computeMetrics(trades);

  return { strategies, symbols, timeframes };
}

// ────────────────────────────────────────────────────────────────────
// 시장 레짐 스냅샷 — BTC 100봉 (4h) 기준
// ────────────────────────────────────────────────────────────────────
async function fetchMarketRegime() {
  try {
    const klines = await getKlines({ symbol: "BTCUSDT", interval: "4h", limit: 100 });
    if (!Array.isArray(klines)) return null;
    const closes = klines.map((k) => Number(k[4]));
    const highs = klines.map((k) => Number(k[2]));
    const lows = klines.map((k) => Number(k[3]));
    const { regimeInfo, weights } = await updateMarketRegimeAndWeights({ closes, highs, lows });
    return { ...regimeInfo, weights, btcPrice: closes[closes.length - 1] };
  } catch (e) {
    console.warn("[alpha-lab] regime fetch fail:", e?.message);
    return null;
  }
}

// ────────────────────────────────────────────────────────────────────
// 메인 핸들러
// ────────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const t0 = Date.now();
  const log = [];
  const L = (m) => { log.push(m); console.log("[alpha-lab]", m); };

  try {
    const kv = await getKv();
    const users = await listAllUsers(kv);
    L(`users: ${users.length}`);

    // 사용자 데이터 병렬 fetch — 5개씩 쪼개서 KV 한도 고려
    const userDatas = [];
    for (let i = 0; i < users.length; i += 5) {
      const batch = users.slice(i, i + 5);
      const chunk = await Promise.all(batch.map((u) => fetchUserData(kv, u).catch(() => null)));
      for (const x of chunk) if (x) userDatas.push(x);
    }
    L(`fetched: ${userDatas.length} users`);

    const agg = aggregateAcrossUsers(userDatas);
    L(`strategies: ${Object.keys(agg.strategies).length}, symbols: ${Object.keys(agg.symbols).length}, timeframes: ${Object.keys(agg.timeframes).length}`);

    // 시장 레짐 갱신 (가중치 KV 자동 적재)
    const regime = await fetchMarketRegime();
    if (regime) {
      L(`regime: ${regime.regime}/${regime.volRegime} H=${regime.hurst?.toFixed(3)} ATR=${regime.atrRatio?.toFixed(2)}`);
    }

    const payload = {
      version: 1,
      generatedAt: new Date().toISOString(),
      durationMs: Date.now() - t0,
      users: userDatas.length,
      regime,
      strategies: agg.strategies,
      symbols: agg.symbols,
      timeframes: agg.timeframes,
    };

    // 최신 leaderboard 저장
    await kv.set("di:alpha:leaderboard", payload);

    // 시계열 hist push (168시간 = 7일)
    try {
      const hist = (await kv.get("di:alpha:leaderboard:hist")) || [];
      // 가벼운 스냅샷만 저장 (strategy 별 sharpe·trades·winRate 만)
      const snapshot = {
        ts: payload.generatedAt,
        regime: regime ? { regime: regime.regime, volRegime: regime.volRegime, hurst: regime.hurst } : null,
        strategies: Object.fromEntries(
          Object.entries(agg.strategies).map(([k, m]) => [k, {
            trades: m.trades, winRate: m.winRate, sharpe: m.sharpe,
            netPnL: m.netPnL, profitFactor: m.profitFactor,
          }])
        ),
      };
      hist.push(snapshot);
      const trimmed = hist.slice(-MAX_HIST_HOURS);
      await kv.set("di:alpha:leaderboard:hist", trimmed);
      L(`hist: ${trimmed.length} snapshots`);
    } catch (e) {
      L(`hist push fail: ${e?.message}`);
    }

    return res.status(200).json({ ok: true, durationMs: Date.now() - t0, leaderboard: payload, log });
  } catch (err) {
    console.error("[alpha-lab] fatal:", err);
    return res.status(200).json({ ok: false, error: err?.message || String(err), log });
  }
}
