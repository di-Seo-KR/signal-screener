// ════════════════════════════════════════════════════════════════════
// 스윙 전환 그리드 (2026-07-08, 대표 지시 "스윙에 초점 — 손실만 커진다")
// ────────────────────────────────────────────────────────────────────
// 진단(30일 shadow): 마감 140건 전부 마이크로캡, 중앙보유 3.7h 단타 churn,
//   retro 36 청산변형 전부 음수 = 청산이 아닌 진입·보유구조 문제.
//   → 유니버스 정화는 코드 배선(그리드 불필요), 이 그리드는 "검증된 유니버스에서
//     스윙 보유구조(홀드 연장·TP 확대·트레일·1d 레짐)"의 엣지를 사전등록 검증.
//
// 사전등록 변형 (결과 확인 후 추가 금지 — 다중가설 방어):
//   기준 F3 = 현행 라이브 (ATR 2/4 + 레짐 + ER≥0.2, 홀드 24봉=4일)
//   S1: 홀드 60봉(10일) + TP 6ATR              — 승자 보유 연장
//   S2: 샹들리에 트레일 3ATR (TP 없음, 홀드 90) — 추세 추종 청산
//   S3: 1R 도달 후 트레일 4ATR (TP 없음, 홀드 90)
//   S4: SL 2.5 / TP 8ATR (홀드 90)              — 클래식 스윙 R:R
//   S5: F3 + 1d 레짐(EMA1200@4h ≈ 일봉 EMA200)  — 게이트 단독 효과
//   S6: S1 + 1d 레짐
//   S7: S2 + 1d 레짐
// 채택 규칙(사전등록): full·OOS PF 모두 F3 이상 + 기대값(bps/거래) F3의 1.5배 이상
//   → 홀드아웃(ZEPTA_SYMBOL_SET=holdout) 최종 1회. 승률 하락은 PF·기대값 개선 시 허용(정직 보고).
// 실행: node scripts/optimize-swing.mjs  (신호 캐시 공유 — optimize-exits 와 동일 키)
// ════════════════════════════════════════════════════════════════════

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { fetchDeepKlines } from "./deep-history.mjs";
import { ALL_STRATEGIES } from "../api/_shared/strategies/index.js";
import { calcEMA } from "../api/_shared/strategies/_indicators.js";

const SYMBOLS = process.env.ZEPTA_SYMBOL_SET === "holdout"
  ? ["TRXUSDT", "TONUSDT", "XLMUSDT", "BCHUSDT", "ETCUSDT", "HBARUSDT"]
  : ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "AVAXUSDT", "LINKUSDT",
     "BNBUSDT", "ADAUSDT", "DOGEUSDT", "DOTUSDT", "LTCUSDT", "UNIUSDT",
     "ATOMUSDT", "NEARUSDT", "APTUSDT", "ARBUSDT", "OPUSDT", "FILUSDT",
     "INJUSDT", "SUIUSDT", "AAVEUSDT", "WLDUSDT", "FETUSDT", "TAOUSDT"];
const LIVE7 = ["hurst-trend", "trend-follow", "defi-momentum", "supertrend", "ensemble", "momentum-rotation", "volatility-arb"];
const FEE = 0.001;
const OOS_FRAC = 0.35;

const SIG_CACHE = "/private/tmp/claude-501/-Users-kaneseo-Desktop-signal-screener-project--claude-worktrees-strange-bardeen-4ae62e/3d6e6a2a-2672-42dc-8d40-11e1b4ab1a72/scratchpad/sig-cache";
mkdirSync(SIG_CACHE, { recursive: true });

// 모든 변형은 F3(레짐+ER) 위에서 — 현행 라이브가 기준
const BASE = { regime: true, minER: 0.2 };
const VARIANTS = [
  { id: "F3_현행(기준)",     ...BASE, slAtr: 2,   tpAtr: 4, hold: 24 },
  { id: "S1_홀드60+TP6",     ...BASE, slAtr: 2,   tpAtr: 6, hold: 60 },
  { id: "S2_샹들리에3",      ...BASE, slAtr: 2,   trail: 3, hold: 90 },
  { id: "S3_1R후트레일4",    ...BASE, slAtr: 2,   trail: 4, trailAtR: 1, hold: 90 },
  { id: "S4_와이드2.5/8",    ...BASE, slAtr: 2.5, tpAtr: 8, hold: 90 },
  { id: "S5_F3+1d레짐",      ...BASE, slAtr: 2,   tpAtr: 4, hold: 24, regime1d: true },
  { id: "S6_S1+1d레짐",      ...BASE, slAtr: 2,   tpAtr: 6, hold: 60, regime1d: true },
  { id: "S7_S2+1d레짐",      ...BASE, slAtr: 2,   trail: 3, hold: 90, regime1d: true },
  // ★ 구현 제약 검증(사전등록 외 — 변형 쇼핑 아님): 라이브 브래킷 주문은 TP 주문이 필수라
  //   S3 의 "TP 없음"을 "TP 15%(dynamicTPCeilPct) 백스톱"으로 구현해야 함. 백스톱이
  //   S3 성과를 훼손하지 않는지만 확인 (S3 대비 열화 시 TP 완전 제거 방식으로 구현 변경).
  { id: "S3b_S3+TP15백스톱", ...BASE, slAtr: 2,   trail: 4, trailAtR: 1, hold: 90, tpPctBackstop: 15 },
];

function toOhlc(klines) {
  return klines.map(k => ({ ts: +k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] })).filter(x => Number.isFinite(x.c));
}
function atrSeries(ohlc, p = 14) {
  const n = ohlc.length, out = new Array(n).fill(null);
  let sum = 0, cnt = 0;
  for (let i = 1; i < n; i++) {
    const tr = Math.max(ohlc[i].h - ohlc[i].l, Math.abs(ohlc[i].h - ohlc[i - 1].c), Math.abs(ohlc[i].l - ohlc[i - 1].c));
    sum += tr; cnt++;
    if (cnt > p) { const j = i - p; sum -= Math.max(ohlc[j].h - ohlc[j].l, Math.abs(ohlc[j].h - ohlc[j - 1].c), Math.abs(ohlc[j].l - ohlc[j - 1].c)); cnt = p; }
    if (cnt === p) out[i] = sum / p;
  }
  return out;
}
function erSeries(closes, p = 14) {
  const n = closes.length, out = new Array(n).fill(null);
  for (let i = p; i < n; i++) {
    const net = Math.abs(closes[i] - closes[i - p]);
    let vol = 0;
    for (let j = i - p + 1; j <= i; j++) vol += Math.abs(closes[j] - closes[j - 1]);
    out[i] = vol > 0 ? net / vol : 0;
  }
  return out;
}

// 신호 캐시 — optimize-exits.mjs 와 동일 키(전략 코드 불변 전제)
function rawSignals(stratId, sym, ohlc) {
  const key = `${SIG_CACHE}/${stratId}-${sym}.json`;
  if (existsSync(key)) { try { return JSON.parse(readFileSync(key, "utf8")); } catch {} }
  const fn = ALL_STRATEGIES[stratId];
  const sigs = [];
  for (let i = 60; i < ohlc.length - 1; i++) {
    const s0 = Math.max(0, i + 1 - 240);
    const sl = ohlc.slice(s0, i + 1);
    let sig = null;
    try {
      sig = fn({
        closes: sl.map(b => b.c), highs: sl.map(b => b.h), lows: sl.map(b => b.l),
        volumes: sl.map(b => b.v), opens: sl.map(b => b.o),
        asset: "BTC/USD", timeframe: "4h", params: null, lastBarClosed: true,
      });
    } catch {}
    if (sig?.side) sigs.push({ i, side: sig.side });
  }
  writeFileSync(key, JSON.stringify(sigs));
  return sigs;
}

// 청산 시뮬 — optimize-exits 의미론 유지(다음봉 시가 진입·SL 우선·갭 모델·왕복 수수료)
//   + 스윙 확장: 가변 홀드, TP 없음 허용, 트레일(봉마감 후 갱신 → 다음봉부터 적용 = 룩어헤드 없음)
function simulate(ohlc, sigs, v, ctx) {
  const trades = [];
  const n = ohlc.length;
  let cursor = 60;
  for (const s of sigs) {
    if (s.i < cursor) continue;
    if (v.regime) {
      const e200 = ctx.ema200[s.i];
      if (e200 != null) {
        if (s.side === "LONG" && ohlc[s.i].c <= e200) continue;
        if (s.side === "SHORT" && ohlc[s.i].c >= e200) continue;
      }
    }
    if (v.minER != null && (ctx.er[s.i] == null || ctx.er[s.i] < v.minER)) continue;
    if (v.regime1d) {
      const e1d = ctx.ema1200[s.i];
      if (e1d == null) continue; // 워밍업 미달 구간은 보수적으로 제외
      if (s.side === "LONG" && ohlc[s.i].c <= e1d) continue;
      if (s.side === "SHORT" && ohlc[s.i].c >= e1d) continue;
    }

    const entryIdx = s.i + 1;
    if (entryIdx >= n) break;
    const entry = ohlc[entryIdx].o;
    const atr = ctx.atr[s.i];
    if (!(atr > 0)) continue;
    let slPrice = s.side === "LONG" ? entry - v.slAtr * atr : entry + v.slAtr * atr;
    const tpPrice = v.tpAtr != null
      ? (s.side === "LONG" ? entry + v.tpAtr * atr : entry - v.tpAtr * atr)
      : v.tpPctBackstop != null
        ? entry * (s.side === "LONG" ? 1 + v.tpPctBackstop / 100 : 1 - v.tpPctBackstop / 100)
        : null;
    const R = Math.abs(entry - slPrice);
    let trailOn = v.trail != null && v.trailAtR == null; // 즉시 트레일(S2) vs 1R 후(S3)
    let extreme = entry; // 트레일 기준 극값(마감가)
    let exitIdx = -1, exitPrice = entry, reason = "TIME";
    const endIdx = Math.min(n - 1, entryIdx + (v.hold ?? 24));
    for (let j = entryIdx; j <= endIdx; j++) {
      const b = ohlc[j];
      if (s.side === "LONG") {
        if (b.l <= slPrice) { exitIdx = j; exitPrice = Math.min(slPrice, b.o); reason = "SL"; break; }
        if (tpPrice != null && b.h >= tpPrice) { exitIdx = j; exitPrice = tpPrice; reason = "TP"; break; }
      } else {
        if (b.h >= slPrice) { exitIdx = j; exitPrice = Math.max(slPrice, b.o); reason = "SL"; break; }
        if (tpPrice != null && b.l <= tpPrice) { exitIdx = j; exitPrice = tpPrice; reason = "TP"; break; }
      }
      // ── 봉 마감 후 트레일 갱신 (다음봉부터 적용) ──
      if (v.trail != null) {
        const a = ctx.atr[j] ?? atr;
        if (s.side === "LONG") {
          extreme = Math.max(extreme, b.c);
          if (!trailOn && v.trailAtR != null && b.c - entry >= v.trailAtR * R) trailOn = true;
          if (trailOn) slPrice = Math.max(slPrice, extreme - v.trail * a);
        } else {
          extreme = Math.min(extreme, b.c);
          if (!trailOn && v.trailAtR != null && entry - b.c >= v.trailAtR * R) trailOn = true;
          if (trailOn) slPrice = Math.min(slPrice, extreme + v.trail * a);
        }
      }
    }
    if (exitIdx < 0) { exitIdx = endIdx; exitPrice = ohlc[endIdx].c; reason = "TIME"; }
    let pnl = s.side === "LONG" ? (exitPrice - entry) / entry : (entry - exitPrice) / entry;
    pnl -= FEE;
    trades.push({ entryIdx, pnl, reason, hold: exitIdx - entryIdx });
    cursor = exitIdx + 1;
  }
  return trades;
}

const median = (xs) => { const a = xs.filter(Number.isFinite).sort((x, y) => x - y); if (!a.length) return 0; const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
function metrics(trades) {
  if (!trades.length) return { n: 0, wr: 0, pf: 0, net: 0, exp: 0, hold: 0 };
  const wins = trades.filter(t => t.pnl > 0);
  const gp = wins.reduce((a, t) => a + t.pnl, 0);
  const gl = -trades.filter(t => t.pnl <= 0).reduce((a, t) => a + t.pnl, 0);
  const net = trades.reduce((a, t) => a + t.pnl, 0);
  return {
    n: trades.length, wr: wins.length / trades.length,
    pf: gl > 0 ? gp / gl : (gp > 0 ? 9.99 : 0), net,
    exp: net / trades.length * 1e4, // bps/거래
    hold: trades.reduce((a, t) => a + t.hold, 0) / trades.length,
  };
}

async function main() {
  const t0 = Date.now();
  const data = {};
  for (const sym of SYMBOLS) {
    const kl = await fetchDeepKlines(sym, "4h", Date.parse("2019-09-01T00:00:00Z"));
    if (!kl || kl.length < 1000) continue;
    const ohlc = toOhlc(kl).slice(0, -1);
    const closes = ohlc.map(b => b.c);
    data[sym] = { ohlc, atr: atrSeries(ohlc), ema200: calcEMA(closes, 200), ema1200: calcEMA(closes, 1200), er: erSeries(closes) };
  }
  console.log(`데이터: ${Object.keys(data).length}심볼 (deep 4h)`);

  console.log(`\n변형              전략               | full: PF / 승률 / 기대bps / 중앙거래 / 평균보유봉 | OOS: PF / 승률 / 기대bps`);
  const agg = {};
  for (const v of VARIANTS) agg[v.id] = { fullPF: [], fullWR: [], fullEXP: [], oosPF: [], oosWR: [], oosEXP: [], n: [], hold: [] };

  for (const v of VARIANTS) {
    for (const strat of LIVE7) {
      const fullPF = [], fullWR = [], fullEXP = [], oosPF = [], oosWR = [], oosEXP = [], ns = [], holds = [];
      for (const sym of Object.keys(data)) {
        const d = data[sym];
        const sigs = rawSignals(strat, sym, d.ohlc);
        const trades = simulate(d.ohlc, sigs, v, d);
        const cut = Math.floor(d.ohlc.length * (1 - OOS_FRAC));
        const full = metrics(trades);
        const oos = metrics(trades.filter(t => t.entryIdx >= cut));
        if (full.n >= 8) { fullPF.push(full.pf); fullWR.push(full.wr); fullEXP.push(full.exp); ns.push(full.n); holds.push(full.hold); }
        if (oos.n >= 4) { oosPF.push(oos.pf); oosWR.push(oos.wr); oosEXP.push(oos.exp); }
      }
      console.log(`${v.id.padEnd(17)} ${strat.padEnd(18)} | ${median(fullPF).toFixed(2)} / ${(median(fullWR) * 100).toFixed(0)}% / ${median(fullEXP).toFixed(0)} / ${median(ns)}건 / ${median(holds).toFixed(1)} | ${median(oosPF).toFixed(2)} / ${(median(oosWR) * 100).toFixed(0)}% / ${median(oosEXP).toFixed(0)}`);
      agg[v.id].fullPF.push(...fullPF); agg[v.id].fullWR.push(...fullWR); agg[v.id].fullEXP.push(...fullEXP);
      agg[v.id].oosPF.push(...oosPF); agg[v.id].oosWR.push(...oosWR); agg[v.id].oosEXP.push(...oosEXP);
      agg[v.id].n.push(...ns); agg[v.id].hold.push(...holds);
    }
    console.log("");
  }
  console.log(`\n═══ 변형 종합 (전략×심볼 풀 중앙값) ═══`);
  for (const v of VARIANTS) {
    const a = agg[v.id];
    console.log(`${v.id.padEnd(17)} | full PF ${median(a.fullPF).toFixed(2)} 승률 ${(median(a.fullWR) * 100).toFixed(0)}% 기대 ${median(a.fullEXP).toFixed(0)}bps | OOS PF ${median(a.oosPF).toFixed(2)} 승률 ${(median(a.oosWR) * 100).toFixed(0)}% 기대 ${median(a.oosEXP).toFixed(0)}bps | 중앙거래 ${median(a.n)}건 평균보유 ${median(a.hold).toFixed(1)}봉`);
  }
  console.log(`\n총 ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}
main().catch(e => { console.error(e); process.exit(1); });
