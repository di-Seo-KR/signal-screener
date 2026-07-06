// ════════════════════════════════════════════════════════════════════
// 실전 전략 승률·손익비 개선 그리드 (2026-07-04, 대표 지시 "잃고벌고 반복 개선")
// ────────────────────────────────────────────────────────────────────
// 진단: 최근 180일 실전 전략 PF 0.69~1.04 = churn. 레버 3개를 사전등록 그리드로 검증:
//   ① 청산: 고정 4%/8% → ATR 상대화(코인별 변동성 정규화) + 본전스탑 + 타임스탑
//   ② 진입 필터: 레짐 정렬(롱=EMA200 위/숏=아래) + 횡보 회피(ER14 ≥ 0.2)
//   ③ (별도) 전략별 성과 — 표에서 드러남
// 방법: 신호는 전략당 1회 계산(디스크 캐시), 청산 변형은 고속 재시뮬.
//   deep 4h(상장이후 전체, 약세장 포함) × 학습 24심볼 → OOS(뒤 35%) 일관 확인
//   → 홀드아웃 6심볼 1회(ZEPTA_SYMBOL_SET=holdout).
// 실행: node scripts/optimize-exits.mjs   (첫 실행 ~3분: 신호 계산, 이후 캐시)
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
// 실전 배정 7전략 (BOT_STRATEGY_MAP)
const LIVE7 = ["hurst-trend", "trend-follow", "defi-momentum", "supertrend", "ensemble", "momentum-rotation", "volatility-arb"];
const FEE = 0.001; // 왕복 0.1%
const OOS_FRAC = 0.35;

const SIG_CACHE = "/private/tmp/claude-501/-Users-kaneseo-Desktop-signal-screener-project--claude-worktrees-strange-bardeen-4ae62e/3d6e6a2a-2672-42dc-8d40-11e1b4ab1a72/scratchpad/sig-cache";
mkdirSync(SIG_CACHE, { recursive: true });

// ── 사전등록 변형 (결과 보고 후 추가 금지 — 다중가설 방어) ──
const VARIANTS = [
  { id: "B0_기존",           slPct: 4, tpPct: 8 },
  { id: "A1_ATR2/4",         slAtr: 2, tpAtr: 4 },
  { id: "A2_ATR1.5/4.5",     slAtr: 1.5, tpAtr: 4.5 },
  { id: "A3_ATR2/4+본전1R",  slAtr: 2, tpAtr: 4, beAtR: 1 },
  { id: "A4_ATR2/4+타임12",  slAtr: 2, tpAtr: 4, tsBars: 12 },
  { id: "A5_ATR+본전+타임",  slAtr: 2, tpAtr: 4, beAtR: 1, tsBars: 12 },
  { id: "F1_기존+레짐",      slPct: 4, tpPct: 8, regime: true },
  { id: "F2_A1+레짐",        slAtr: 2, tpAtr: 4, regime: true },
  { id: "F3_A1+레짐+ER",     slAtr: 2, tpAtr: 4, regime: true, minER: 0.2 },
  { id: "F4_A5+레짐+ER",     slAtr: 2, tpAtr: 4, beAtR: 1, tsBars: 12, regime: true, minER: 0.2 },
];
const MAX_HOLD = 24;

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

// 신호 1회 계산 + 디스크 캐시 (전략 코드 불변 전제)
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

// 청산 시뮬 (공유 백테스터와 동일 의미론: 다음봉 시가 진입·SL 우선·갭 모델·왕복 수수료)
function simulate(ohlc, sigs, v, ctx) {
  const trades = [];
  let nexti = 0, pos = null;
  const n = ohlc.length;
  for (let i = 60; i < n - 1; i++) {
    if (pos) continue; // 순차 스캔이라 pos 처리 후 i 점프 — 아래 while 로 구현
  }
  // 명시 루프: 신호 순회 + 점유 관리
  let cursor = 60;
  for (const s of sigs) {
    if (s.i < cursor) continue;
    // 진입 필터
    if (v.regime) {
      const e200 = ctx.ema200[s.i];
      if (e200 != null) {
        if (s.side === "LONG" && ohlc[s.i].c <= e200) continue;
        if (s.side === "SHORT" && ohlc[s.i].c >= e200) continue;
      }
    }
    if (v.minER != null && (ctx.er[s.i] == null || ctx.er[s.i] < v.minER)) continue;

    const entryIdx = s.i + 1;
    if (entryIdx >= n) break;
    const entry = ohlc[entryIdx].o;
    const atr = ctx.atr[s.i];
    let slPrice, tpPrice;
    if (v.slAtr != null) {
      if (!(atr > 0)) continue;
      slPrice = s.side === "LONG" ? entry - v.slAtr * atr : entry + v.slAtr * atr;
      tpPrice = s.side === "LONG" ? entry + v.tpAtr * atr : entry - v.tpAtr * atr;
    } else {
      slPrice = entry * (s.side === "LONG" ? 1 - v.slPct / 100 : 1 + v.slPct / 100);
      tpPrice = entry * (s.side === "LONG" ? 1 + v.tpPct / 100 : 1 - v.tpPct / 100);
    }
    const R = Math.abs(entry - slPrice);
    let beDone = false;
    let exitIdx = -1, exitPrice = entry, reason = "TIME";
    const endIdx = Math.min(n - 1, entryIdx + MAX_HOLD);
    for (let j = entryIdx; j <= endIdx; j++) {
      const b = ohlc[j];
      if (s.side === "LONG") {
        if (b.l <= slPrice) { exitIdx = j; exitPrice = Math.min(slPrice, b.o); reason = beDone ? "BE" : "SL"; break; }
        if (b.h >= tpPrice) { exitIdx = j; exitPrice = tpPrice; reason = "TP"; break; }
      } else {
        if (b.h >= slPrice) { exitIdx = j; exitPrice = Math.max(slPrice, b.o); reason = beDone ? "BE" : "SL"; break; }
        if (b.l <= tpPrice) { exitIdx = j; exitPrice = tpPrice; reason = "TP"; break; }
      }
      // 봉 마감 후 규칙 (다음 봉부터 적용 — 룩어헤드 없음)
      if (v.beAtR && !beDone) {
        const fav = s.side === "LONG" ? b.c - entry : entry - b.c;
        if (fav >= v.beAtR * R) { slPrice = s.side === "LONG" ? entry * (1 + FEE) : entry * (1 - FEE); beDone = true; }
      }
      if (v.tsBars && j === entryIdx + v.tsBars) {
        const pnl = s.side === "LONG" ? b.c - entry : entry - b.c;
        if (pnl <= 0) { exitIdx = j; exitPrice = b.c; reason = "TS"; break; }
      }
    }
    if (exitIdx < 0) { exitIdx = endIdx; exitPrice = ohlc[endIdx].c; reason = "TIME"; }
    let pnl = s.side === "LONG" ? (exitPrice - entry) / entry : (entry - exitPrice) / entry;
    pnl -= FEE;
    trades.push({ entryIdx, pnl, reason });
    cursor = exitIdx + 1;
  }
  return trades;
}

const median = (xs) => { const a = xs.filter(Number.isFinite).sort((x, y) => x - y); if (!a.length) return 0; const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
function metrics(trades) {
  if (!trades.length) return { n: 0, wr: 0, pf: 0, net: 0 };
  const wins = trades.filter(t => t.pnl > 0);
  const gp = wins.reduce((a, t) => a + t.pnl, 0);
  const gl = -trades.filter(t => t.pnl <= 0).reduce((a, t) => a + t.pnl, 0);
  return { n: trades.length, wr: wins.length / trades.length, pf: gl > 0 ? gp / gl : (gp > 0 ? 9.99 : 0), net: trades.reduce((a, t) => a + t.pnl, 0) };
}

async function main() {
  const t0 = Date.now();
  // 데이터 + 컨텍스트 로드
  const data = {};
  for (const sym of SYMBOLS) {
    const kl = await fetchDeepKlines(sym, "4h", Date.parse("2019-09-01T00:00:00Z"));
    if (!kl || kl.length < 1000) continue;
    const ohlc = toOhlc(kl).slice(0, -1);
    const closes = ohlc.map(b => b.c);
    data[sym] = { ohlc, atr: atrSeries(ohlc), ema200: calcEMA(closes, 200), er: erSeries(closes) };
  }
  console.log(`데이터: ${Object.keys(data).length}심볼 (deep 4h)`);

  // 표: 변형 × 전략 — 교차심볼 중앙 {full PF/WR, OOS PF/WR}
  console.log(`\n변형              전략               | full: PF / 승률 / 중앙거래수 | OOS: PF / 승률`);
  const agg = {}; // variant → {fullPF:[], fullWR:[], oosPF:[], oosWR:[]} (전략×심볼 풀)
  for (const v of VARIANTS) agg[v.id] = { fullPF: [], fullWR: [], oosPF: [], oosWR: [], n: [] };

  for (const v of VARIANTS) {
    for (const strat of LIVE7) {
      const fullPF = [], fullWR = [], oosPF = [], oosWR = [], ns = [];
      for (const sym of Object.keys(data)) {
        const d = data[sym];
        const sigs = rawSignals(strat, sym, d.ohlc);
        const trades = simulate(d.ohlc, sigs, v, d);
        const cut = Math.floor(d.ohlc.length * (1 - OOS_FRAC));
        const full = metrics(trades);
        const oos = metrics(trades.filter(t => t.entryIdx >= cut));
        if (full.n >= 8) { fullPF.push(full.pf); fullWR.push(full.wr); ns.push(full.n); }
        if (oos.n >= 4) { oosPF.push(oos.pf); oosWR.push(oos.wr); }
      }
      const line = `${v.id.padEnd(17)} ${strat.padEnd(18)} | ${median(fullPF).toFixed(2)} / ${(median(fullWR) * 100).toFixed(0)}% / ${median(ns)}건 | ${median(oosPF).toFixed(2)} / ${(median(oosWR) * 100).toFixed(0)}%`;
      console.log(line);
      agg[v.id].fullPF.push(...fullPF); agg[v.id].fullWR.push(...fullWR);
      agg[v.id].oosPF.push(...oosPF); agg[v.id].oosWR.push(...oosWR); agg[v.id].n.push(...ns);
    }
    console.log("");
  }
  console.log(`\n═══ 변형 종합 (전략×심볼 풀 중앙값) ═══`);
  for (const v of VARIANTS) {
    const a = agg[v.id];
    console.log(`${v.id.padEnd(17)} | full PF ${median(a.fullPF).toFixed(2)} 승률 ${(median(a.fullWR) * 100).toFixed(0)}% | OOS PF ${median(a.oosPF).toFixed(2)} 승률 ${(median(a.oosWR) * 100).toFixed(0)}% | 중앙거래 ${median(a.n)}건`);
  }
  console.log(`\n총 ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}
main().catch(e => { console.error(e); process.exit(1); });
