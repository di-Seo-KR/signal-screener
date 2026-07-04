// ════════════════════════════════════════════════════════════════════
// 딥 히스토리 캘리브레이션 — 3대 빈틈 검증 (2026-07-04, 대표 지시 "추가 고도화")
// ────────────────────────────────────────────────────────────────────
// 빈틈 1) 일봉 표본 부족 → 상장 이후 전체(2019-09~) 일봉으로 검증력 확대
// 빈틈 2) 숏이 약세장 못 봄 → 4h 전체 + 1h 2022-01~(2022 약세장 포함)로 재검증
//         + 숏 전용 절반 지평(H/2) 병행 (사전등록: 숏은 빠르게 끝난다는 가설)
// 빈틈 3) 펀딩비 미검증 → 롱 과밀(P90) 숏 / 숏 과밀(P10) 롱 요소 최초 검증
//
// 규칙: 기존 요소=표준 3중 방어, 신규(펀딩)와 모든 숏-절반지평=강화(두 구간 각각 t≥1.0).
// 홀드아웃 6심볼은 여기서도 미사용 — 통과 조합 확정 후 최종 1회.
// 실행: node scripts/calibrate-deep.mjs  (첫 실행 ~5분: 딥 fetch, 이후 캐시)
// ════════════════════════════════════════════════════════════════════

import { fetchDeepKlines, fetchFundingHistory, toArraysWithFunding } from "./deep-history.mjs";
import { computeTimingSignals } from "../api/_shared/timing-signals.js";
import { calcEMA } from "../api/_shared/strategies/_indicators.js";

// ZEPTA_REGIME_GATE=1: 롱 이벤트를 EMA200 위(상승 레짐)에서만 집계 — 1차 딥 실행에서
// 1h 롱 요소들이 2022 약세장 구간 때문에 탈락한 것이 "레짐 미구분" 탓인지 검증(사전등록).
const REGIME_GATE = process.env.ZEPTA_REGIME_GATE === "1";

// ZEPTA_SYMBOL_SET=holdout → 학습에 안 쓴 6심볼로 최종 1회 확인 (동일 규칙·동일 분할)
const SYMBOLS = process.env.ZEPTA_SYMBOL_SET === "holdout"
  ? ["TRXUSDT", "TONUSDT", "XLMUSDT", "BCHUSDT", "ETCUSDT", "HBARUSDT"]
  : [
    "BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "AVAXUSDT", "LINKUSDT",
    "BNBUSDT", "ADAUSDT", "DOGEUSDT", "DOTUSDT", "LTCUSDT", "UNIUSDT",
    "ATOMUSDT", "NEARUSDT", "APTUSDT", "ARBUSDT", "OPUSDT", "FILUSDT",
    "INJUSDT", "SUIUSDT", "AAVEUSDT", "WLDUSDT", "FETUSDT", "TAOUSDT",
  ];
const TFS = [
  { tf: "1h", since: Date.parse("2022-01-01T00:00:00Z"), horizon: 24 },
  { tf: "4h", since: Date.parse("2019-09-01T00:00:00Z"), horizon: 12 },
  { tf: "1d", since: Date.parse("2019-09-01T00:00:00Z"), horizon: 5 },
];
const TRAIN_FRAC = 0.65, FEE = 0.0010;
const OLD_FACTORS = ["pattern", "divergence", "rsiReversal", "sweepReclaim", "pullback", "structureBreak", "structureHL"];
const ALL_ENGINE_FACTORS = [...OLD_FACTORS,
  "macdCross", "macdHistTurn", "bbReversal", "bbSqueezeBreak", "stochCross", "mfiReversal",
  "obvAccum", "ema200Reclaim", "emaCross", "doubleExtreme", "breakRetest", "thrust",
  "exhaustReversal", "parabolicBreak", "wickExhaust"];

const median = (xs) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

function stats(items) {
  const n = items.length;
  if (!n) return { n: 0, mean: 0, t: 0, winRate: 0 };
  const byTs = new Map();
  for (const it of items) { const g = byTs.get(it.ts) || []; g.push(it.x); byTs.set(it.ts, g); }
  const cm = [...byTs.values()].map((g) => g.reduce((a, b) => a + b, 0) / g.length);
  const k = cm.length;
  const mean = cm.reduce((a, b) => a + b, 0) / k;
  const varr = k > 1 ? cm.reduce((a, b) => a + (b - mean) ** 2, 0) / (k - 1) : 0;
  const se = Math.sqrt(varr / Math.max(1, k));
  return { n, mean, t: se > 0 ? mean / se : 0, winRate: items.filter((it) => it.x > 0).length / n };
}

// 펀딩 극단 요소 (사전등록): 직전 90일 롤링 분위 기준 P90↑ 롱과밀 + 약세봉 → 숏 /
//   P10↓ 숏과밀 + 강세봉 → 롱. 분위는 봉 i *이전* 데이터만 사용(룩어헤드 금지).
function fundingEvents(arr, tf) {
  const ev = [];
  const f = arr.fundingAt;
  if (!f) return ev;
  const winBars = tf === "1h" ? 24 * 90 : tf === "4h" ? 6 * 90 : 90;
  for (let i = 30; i < arr.closes.length; i++) {
    if (f[i] == null) continue;
    const s0 = Math.max(0, i - winBars);
    const window = [];
    for (let j = s0; j < i; j++) if (f[j] != null) window.push(f[j]);
    if (window.length < 60) continue;
    const sorted = [...window].sort((a, b) => a - b);
    const p90 = sorted[Math.floor(sorted.length * 0.9)];
    const p10 = sorted[Math.floor(sorted.length * 0.1)];
    const bear = arr.closes[i] < arr.opens[i], bull = arr.closes[i] > arr.opens[i];
    if (f[i] >= p90 && f[i] > 0 && bear) ev.push({ i, dir: -1, factor: "fundingCrowdedLong" });
    if (f[i] <= p10 && f[i] < 0 && bull) ev.push({ i, dir: +1, factor: "fundingCrowdedShort" });
  }
  return ev;
}

async function main() {
  const t0 = Date.now();
  const FACTORS = [...ALL_ENGINE_FACTORS, "fundingCrowdedLong", "fundingCrowdedShort"];
  // pool[tf][factor][dirKey]["train"|"test"] — dirKey: long / short / shortH2(절반지평)
  const pool = {};
  for (const { tf } of TFS) {
    pool[tf] = {};
    for (const fct of FACTORS) pool[tf][fct] = { long: { train: [], test: [] }, short: { train: [], test: [] }, shortH2: { train: [], test: [] } };
  }
  let totalBars = { "1h": 0, "4h": 0, "1d": 0 };

  for (const { tf, since, horizon } of TFS) {
    const h2 = Math.max(3, Math.round(horizon / 2));
    for (const symbol of SYMBOLS) {
      const kl = await fetchDeepKlines(symbol, tf, since);
      if (!kl || kl.length < 400) continue;
      const funding = await fetchFundingHistory(symbol, since);
      const arr = toArraysWithFunding(kl, funding);
      for (const k of ["opens", "highs", "lows", "closes", "volumes", "times", "fundingAt"]) if (arr[k]) arr[k] = arr[k].slice(0, -1);
      const n = arr.closes.length;
      totalBars[tf] += n;

      const splitIdx = Math.floor(n * TRAIN_FRAC);
      const fwdTrain = [];
      for (let j = 30; j + 1 + horizon < splitIdx; j++) { const e = arr.opens[j + 1]; if (e > 0) fwdTrain.push((arr.closes[j + horizon] - e) / e); }
      const drift = median(fwdTrain);
      const fwdTrain2 = [];
      for (let j = 30; j + 1 + h2 < splitIdx; j++) { const e = arr.opens[j + 1]; if (e > 0) fwdTrain2.push((arr.closes[j + h2] - e) / e); }
      const drift2 = median(fwdTrain2);

      const { factorEvents } = computeTimingSignals(arr, { tf, emitFactors: true, th: 999, mode: "research" });
      let allEvents = [...factorEvents, ...fundingEvents(arr, tf)];
      if (REGIME_GATE) {
        const e200 = n >= 210 ? calcEMA(arr.closes, 200) : null;
        allEvents = allEvents.filter(ev => ev.dir < 0 || (e200?.[ev.i] != null && arr.closes[ev.i] > e200[ev.i]));
      }
      for (const ev of allEvents) {
        const bucket = ev.i < splitIdx ? "train" : "test";
        const entry = arr.opens[ev.i + 1];
        if (!(entry > 0)) continue;
        if (ev.i + 1 + horizon < n) {
          const fwd = (arr.closes[ev.i + horizon] - entry) / entry;
          const excess = ev.dir * (fwd - drift);
          pool[tf][ev.factor][ev.dir > 0 ? "long" : "short"][bucket].push({ x: excess, ts: arr.times[ev.i] });
        }
        if (ev.dir < 0 && ev.i + 1 + h2 < n) { // 숏 절반지평 병행 (사전등록)
          const fwd2 = (arr.closes[ev.i + h2] - entry) / entry;
          pool[tf][ev.factor].shortH2[bucket].push({ x: -(fwd2 - drift2), ts: arr.times[ev.i] });
        }
      }
    }
    console.log(`  ${tf} 완료 (총 ${totalBars[tf]}봉)`);
  }

  console.log(`\nTF   요소                 방향     | 학습 n/엣지bps/t/승률       | OOS n/엣지bps/t/승률        | 판정`);
  const survivors = [];
  for (const { tf } of TFS) {
    for (const fct of FACTORS) {
      for (const dirKey of ["long", "short", "shortH2"]) {
        const tr = stats(pool[tf][fct][dirKey].train);
        const te = stats(pool[tf][fct][dirKey].test);
        if (tr.n + te.n === 0) continue;
        const pooled = stats([...pool[tf][fct][dirKey].train, ...pool[tf][fct][dirKey].test]);
        const isStrict = !OLD_FACTORS.includes(fct) || dirKey === "shortH2"; // 신규·절반지평은 강화
        let verdict = "✗";
        if (tr.n >= 30 && te.n >= 10 && tr.mean > 0 && te.mean >= FEE && pooled.t >= 1.5
            && (!isStrict || (tr.t >= 1.0 && te.t >= 1.0))) {
          verdict = "✅ 채택"; survivors.push({ tf, factor: fct, dir: dirKey });
        } else if (tr.n < 30 || te.n < 10) verdict = "· 표본부족";
        const fmt = (s) => `${String(s.n).padEnd(5)} ${String(Math.round(s.mean * 1e4)).padStart(5)} ${s.t.toFixed(1).padStart(5)} ${(s.winRate * 100).toFixed(0).padStart(3)}%`;
        console.log(`${tf.padEnd(4)} ${fct.padEnd(20)} ${dirKey.padEnd(8)} | ${fmt(tr)} | ${fmt(te)} | ${verdict}`);
      }
    }
  }
  console.log(`\n생존: ${survivors.length} — ${JSON.stringify(survivors)}`);
  console.log(`총 ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}
main().catch((e) => { console.error("치명 오류:", e); process.exit(1); });
