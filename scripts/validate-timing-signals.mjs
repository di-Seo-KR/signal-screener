// ════════════════════════════════════════════════════════════════════
// 합류 타점 엔진 검증 — 롱/숏 × TF별 전진수익 실측 (2026-07-04)
// ────────────────────────────────────────────────────────────────────
// computeTimingSignals 의 발화 시점이 실제로 유리한 타점인지:
//   학습 24심볼(앞65%/뒤35%) + 홀드아웃 6심볼(엔진이 한 번도 못 본 심볼)
//   에서 dir×(H봉 전진수익 − 학습구간 드리프트) 를 클러스터-강건 통계로 측정.
// 게이트: 각 TF×방향(n≥20)에서 홀드아웃 엣지가 −10bps(수수료) 미만이면 실패.
// 실행: node scripts/validate-timing-signals.mjs
// ════════════════════════════════════════════════════════════════════

import { getKlines } from "../api/_shared/binance-client.js";
import { computeTimingSignals } from "../api/_shared/timing-signals.js";

const TRAIN_SYMBOLS = [
  "BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "AVAXUSDT", "LINKUSDT",
  "BNBUSDT", "ADAUSDT", "DOGEUSDT", "DOTUSDT", "LTCUSDT", "UNIUSDT",
  "ATOMUSDT", "NEARUSDT", "APTUSDT", "ARBUSDT", "OPUSDT", "FILUSDT",
  "INJUSDT", "SUIUSDT", "AAVEUSDT", "WLDUSDT", "FETUSDT", "TAOUSDT",
];
const HOLDOUT_SYMBOLS = ["TRXUSDT", "TONUSDT", "XLMUSDT", "BCHUSDT", "ETCUSDT", "HBARUSDT"];
const TFS = [
  { tf: "1h", limit: 1500, horizon: 24 },
  { tf: "4h", limit: 1500, horizon: 12 },
  { tf: "1d", limit: 1500, horizon: 5 },
];
const TRAIN_FRAC = 0.65;
const FEE = 0.0010; // 10bps

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const median = (xs) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

function toArrays(klines) {
  const opens = [], highs = [], lows = [], closes = [], volumes = [], times = [];
  for (const k of klines) {
    const o = +k[1], h = +k[2], l = +k[3], c = +k[4];
    if (![o, h, l, c].every(Number.isFinite)) continue;
    opens.push(o); highs.push(h); lows.push(l); closes.push(c); volumes.push(+k[5]); times.push(+k[0]);
  }
  return { opens, highs, lows, closes, volumes, times };
}

// 클러스터-강건 통계 (동일봉 타임스탬프 묶음)
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

async function collect(symbols, isHoldout) {
  // buckets[tf][dir]["train"|"test"|"hold"] = [{x, ts}]
  const out = {};
  let bars = { "1h": 0, "4h": 0, "1d": 0 };
  for (const { tf } of TFS) out[tf] = { long: { train: [], test: [], hold: [] }, short: { train: [], test: [], hold: [] } };

  for (const { tf, limit, horizon } of TFS) {
    for (const symbol of symbols) {
      let kl;
      try { kl = await getKlines({ symbol, interval: tf, limit }); }
      catch (e) { console.error(`  ✗ ${symbol} ${tf}: ${e.message?.slice(0, 60)}`); await sleep(300); continue; }
      const arr = toArrays(kl);
      for (const k of Object.keys(arr)) arr[k] = arr[k].slice(0, -1); // 진행봉 제거
      const n = arr.closes.length;
      if (n < 300) { await sleep(120); continue; }
      bars[tf] += n;

      const splitIdx = Math.floor(n * TRAIN_FRAC);
      const fwdTrain = [];
      for (let j = 30; j + 1 + horizon < splitIdx; j++) {
        const e = arr.opens[j + 1];
        if (e > 0) fwdTrain.push((arr.closes[j + horizon] - e) / e);
      }
      const drift = median(fwdTrain);

      const { signals } = computeTimingSignals(arr, { tf });
      for (const s of signals) {
        if (s.i + 1 + horizon >= n) continue;
        const entry = arr.opens[s.i + 1];
        if (!(entry > 0)) continue;
        const fwd = (arr.closes[s.i + horizon] - entry) / entry;
        const excess = s.dir * (fwd - drift);
        const bucket = isHoldout ? "hold" : (s.i < splitIdx ? "train" : "test");
        out[tf][s.dir > 0 ? "long" : "short"][bucket].push({ x: excess, ts: arr.times[s.i] });
      }
      await sleep(120);
    }
  }
  return { out, bars };
}

function mergeBuckets(a, b) {
  for (const tf of Object.keys(a)) for (const dir of ["long", "short"]) for (const bk of ["train", "test", "hold"])
    a[tf][dir][bk].push(...b[tf][dir][bk]);
  return a;
}

async function main() {
  const t0 = Date.now();
  console.log(`학습 ${TRAIN_SYMBOLS.length}심볼 + 홀드아웃 ${HOLDOUT_SYMBOLS.length}심볼 × 3TF × 1500봉 수집...`);
  const trainRes = await collect(TRAIN_SYMBOLS, false);
  const holdRes = await collect(HOLDOUT_SYMBOLS, true);
  const buckets = mergeBuckets(trainRes.out, holdRes.out);
  const totalBars = Object.fromEntries(Object.keys(trainRes.bars).map((tf) => [tf, trainRes.bars[tf] + holdRes.bars[tf]]));

  console.log(`\nTF   방향  | 학습 n/엣지bps/t/승률      | OOS n/엣지bps/t/승률       | 홀드아웃 n/엣지bps/t/승률   | 밀도(신호/1000봉)`);
  let fails = 0, rows = 0;
  for (const { tf } of TFS) {
    for (const dir of ["long", "short"]) {
      const tr = stats(buckets[tf][dir].train);
      const te = stats(buckets[tf][dir].test);
      const ho = stats(buckets[tf][dir].hold);
      const totalN = tr.n + te.n + ho.n;
      const density = totalBars[tf] > 0 ? (totalN / totalBars[tf] * 1000).toFixed(1) : "0";
      const fmt = (s) => `${String(s.n).padEnd(4)} ${String(Math.round(s.mean * 1e4)).padStart(5)} ${s.t.toFixed(1).padStart(5)} ${(s.winRate * 100).toFixed(0).padStart(3)}%`;
      let verdict = "";
      if (ho.n >= 20 && ho.mean < -FEE) { verdict = " ❌홀드아웃 음수"; fails++; }
      else if (tr.n >= 30 && tr.mean > FEE && te.mean > -FEE && (ho.n < 20 || ho.mean > -FEE)) verdict = " ✅";
      else verdict = " ⚠️ 표본부족/약함";
      rows++;
      console.log(`${tf.padEnd(4)} ${dir.padEnd(5)} | ${fmt(tr)} | ${fmt(te)} | ${fmt(ho)} | ${density}${verdict}`);
    }
  }
  console.log(`\n총 ${((Date.now() - t0) / 1000).toFixed(0)}s. 판정: ${fails === 0 ? "✅ 통과 — 홀드아웃 음수(−10bps 초과) TF×방향 없음" : `❌ 실패 ${fails}건 — 임계/가중 조정 필요`}`);
}

main().catch((e) => { console.error("치명 오류:", e); process.exit(1); });
