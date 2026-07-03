// ════════════════════════════════════════════════════════════════════
// 타점 요소별 캘리브레이션 — 어떤 요소가 실제로 타점 가치가 있나 (2026-07-04)
// ────────────────────────────────────────────────────────────────────
// v2 초안(손가중 합산)이 홀드아웃 실패 → 패턴 때와 같은 방법론 적용:
//   각 요소(패턴/다이버전스/RSI반전/스윕리클레임/눌림목)를 *독립* 이벤트로
//   측정해 두 구간(65/35) 부호 일관 + OOS≥10bps + 클러스터-강건 t 로 선별.
//   ※ 홀드아웃 6심볼은 여기서 절대 사용 금지 — 최종 검증 1회용으로 보존.
// 실행: node scripts/calibrate-timing-factors.mjs
// ════════════════════════════════════════════════════════════════════

import { getKlines } from "../api/_shared/binance-client.js";
import { computeTimingSignals, TIMING_WEIGHTS } from "../api/_shared/timing-signals.js";

const SYMBOLS = [
  "BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "AVAXUSDT", "LINKUSDT",
  "BNBUSDT", "ADAUSDT", "DOGEUSDT", "DOTUSDT", "LTCUSDT", "UNIUSDT",
  "ATOMUSDT", "NEARUSDT", "APTUSDT", "ARBUSDT", "OPUSDT", "FILUSDT",
  "INJUSDT", "SUIUSDT", "AAVEUSDT", "WLDUSDT", "FETUSDT", "TAOUSDT",
];
const TFS = [
  { tf: "1h", limit: 1500, horizon: 24 },
  { tf: "4h", limit: 1500, horizon: 12 },
  { tf: "1d", limit: 1500, horizon: 5 },
];
const TRAIN_FRAC = 0.65, FEE = 0.0010;
const FACTORS = [
  "pattern", "divergence", "rsiReversal", "sweepReclaim", "pullback", "structureBreak", "structureHL",
  // v3 총동원 후보 (2026-07-04) — 신규 숏은 레짐 조건부 정의
  "macdCross", "macdHistTurn", "bbReversal", "bbSqueezeBreak", "stochCross", "mfiReversal",
  "obvAccum", "ema200Reclaim", "emaCross", "doubleExtreme", "breakRetest", "thrust",
];

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

async function main() {
  const t0 = Date.now();
  // pool[tf][factor][dir]["train"|"test"]
  const pool = {};
  for (const { tf } of TFS) {
    pool[tf] = {};
    for (const f of FACTORS) pool[tf][f] = { long: { train: [], test: [] }, short: { train: [], test: [] } };
  }

  for (const { tf, limit, horizon } of TFS) {
    for (const symbol of SYMBOLS) {
      let kl;
      try { kl = await getKlines({ symbol, interval: tf, limit }); }
      catch { await sleep(300); continue; }
      const arr = toArrays(kl);
      for (const k of Object.keys(arr)) arr[k] = arr[k].slice(0, -1);
      const n = arr.closes.length;
      if (n < 300) { await sleep(120); continue; }

      const splitIdx = Math.floor(n * TRAIN_FRAC);
      const fwdTrain = [];
      for (let j = 30; j + 1 + horizon < splitIdx; j++) {
        const e = arr.opens[j + 1];
        if (e > 0) fwdTrain.push((arr.closes[j + horizon] - e) / e);
      }
      const drift = median(fwdTrain);

      const { factorEvents } = computeTimingSignals(arr, { tf, emitFactors: true, th: 999, mode: "research" }); // 전 요소 수집 (검증게이트 우회)
      for (const ev of factorEvents) {
        if (ev.i + 1 + horizon >= n) continue;
        const entry = arr.opens[ev.i + 1];
        if (!(entry > 0)) continue;
        const fwd = (arr.closes[ev.i + horizon] - entry) / entry;
        const excess = ev.dir * (fwd - drift);
        const bucket = ev.i < splitIdx ? "train" : "test";
        pool[tf][ev.factor][ev.dir > 0 ? "long" : "short"][bucket].push({ x: excess, ts: arr.times[ev.i] });
      }
      await sleep(120);
    }
    console.log(`  ${tf} 수집 완료`);
  }

  console.log(`\nTF   요소          방향  | 학습 n/엣지bps/t/승률       | OOS n/엣지bps/t/승률        | 판정(패턴과 동일 3중 규칙)`);
  const survivors = [];
  for (const { tf } of TFS) {
    for (const f of FACTORS) {
      for (const dir of ["long", "short"]) {
        const tr = stats(pool[tf][f][dir].train);
        const te = stats(pool[tf][f][dir].test);
        const pooled = stats([...pool[tf][f][dir].train, ...pool[tf][f][dir].test]);
        // 다중가설 방어: v3 신규 12요소(후보 114조합 전수탐색)는 우연 적합 확률이 높아
        // 기존 규칙에 더해 *두 구간 각각* t≥1.0 을 요구 (사전등록 — 결과 보고 완화 금지)
        const isNew = !["pattern", "divergence", "rsiReversal", "sweepReclaim", "pullback", "structureBreak", "structureHL"].includes(f);
        let verdict = "✗";
        if (tr.n >= 30 && te.n >= 10 && tr.mean > 0 && te.mean >= FEE && pooled.t >= 1.5
            && (!isNew || (tr.t >= 1.0 && te.t >= 1.0))) {
          verdict = "✅ 채택"; survivors.push({ tf, factor: f, dir });
        } else if (tr.n < 30 || te.n < 10) verdict = "· 표본부족";
        const fmt = (s) => `${String(s.n).padEnd(4)} ${String(Math.round(s.mean * 1e4)).padStart(5)} ${s.t.toFixed(1).padStart(5)} ${(s.winRate * 100).toFixed(0).padStart(3)}%`;
        console.log(`${tf.padEnd(4)} ${f.padEnd(13)} ${dir.padEnd(5)} | ${fmt(tr)} | ${fmt(te)} | ${verdict}`);
      }
    }
  }
  console.log(`\n생존: ${survivors.length}/${TFS.length * FACTORS.length * 2} — ${JSON.stringify(survivors)}`);
  console.log(`총 ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

main().catch((e) => { console.error("치명 오류:", e); process.exit(1); });
