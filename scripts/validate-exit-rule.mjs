// ════════════════════════════════════════════════════════════════════
// 청산 규칙 검증 — "EMA20 종가 이탈" vs 고정 보유 (2026-07-04)
// ────────────────────────────────────────────────────────────────────
// 매도 시점은 숏 예측과 다르다: 예측이 아닌 *규칙*(추세 조건 소멸 시 청산)으로
// 접근. 검증: 우리 검증 롱 신호로 진입했을 때 (A) EMA20 종가 이탈 청산 vs
// (B) 고정 H봉 보유 — 어느 쪽이 평균 수익·꼬리위험이 나은가. 24 학습심볼.
// 실행: node scripts/validate-exit-rule.mjs
// ════════════════════════════════════════════════════════════════════

import { getKlines } from "../api/_shared/binance-client.js";
import { computeTimingSignals } from "../api/_shared/timing-signals.js";
import { calcEMA } from "../api/_shared/strategies/_indicators.js";

const SYMBOLS = [
  "BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "AVAXUSDT", "LINKUSDT",
  "BNBUSDT", "ADAUSDT", "DOGEUSDT", "DOTUSDT", "LTCUSDT", "UNIUSDT",
  "ATOMUSDT", "NEARUSDT", "APTUSDT", "ARBUSDT", "OPUSDT", "FILUSDT",
  "INJUSDT", "SUIUSDT", "AAVEUSDT", "WLDUSDT", "FETUSDT", "TAOUSDT",
];
const TFS = [ { tf: "1h", limit: 1500, hold: 24, maxExit: 60 }, { tf: "4h", limit: 1500, hold: 12, maxExit: 40 } ];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  for (const { tf, limit, hold, maxExit } of TFS) {
    const retA = [], retB = [], holdA = [];
    let exitByRule = 0, exitByTimeout = 0;
    for (const symbol of SYMBOLS) {
      let kl;
      try { kl = await getKlines({ symbol, interval: tf, limit }); }
      catch { await sleep(300); continue; }
      const arr = { opens: [], highs: [], lows: [], closes: [], volumes: [] };
      for (const k of kl) { arr.opens.push(+k[1]); arr.highs.push(+k[2]); arr.lows.push(+k[3]); arr.closes.push(+k[4]); arr.volumes.push(+k[5]); }
      for (const k of Object.keys(arr)) arr[k] = arr[k].slice(0, -1);
      const n = arr.closes.length;
      if (n < 300) { await sleep(120); continue; }
      const ema20 = calcEMA(arr.closes, 20);
      const { signals } = computeTimingSignals(arr, { tf });
      for (const s of signals) {
        if (s.dir < 0) continue;
        const e = s.i + 1;
        if (e >= n || !(arr.opens[e] > 0)) continue;
        const entry = arr.opens[e];
        // A: EMA20 종가 이탈 청산 (다음 봉 시가) — maxExit 봉 내 미이탈 시 그 시점 종가
        let exitIdx = -1;
        for (let j = e; j <= Math.min(e + maxExit, n - 2); j++) {
          if (ema20[j] != null && arr.closes[j] < ema20[j]) { exitIdx = j + 1; break; } // 이탈 확인 → 다음 봉 시가
        }
        if (exitIdx > 0) { retA.push((arr.opens[exitIdx] - entry) / entry); holdA.push(exitIdx - e); exitByRule++; }
        else { const j = Math.min(e + maxExit, n - 1); retA.push((arr.closes[j] - entry) / entry); holdA.push(j - e); exitByTimeout++; }
        // B: 고정 H봉 보유
        const jb = Math.min(e + hold, n - 1);
        retB.push((arr.closes[jb] - entry) / entry);
      }
      await sleep(120);
    }
    const stats = (xs) => {
      const nn = xs.length; if (!nn) return { n: 0 };
      const mean = xs.reduce((a, b) => a + b, 0) / nn;
      const win = xs.filter((x) => x > 0).length / nn;
      const p5 = [...xs].sort((a, b) => a - b)[Math.floor(nn * 0.05)];
      return { n: nn, meanBps: Math.round(mean * 1e4), win: +(win * 100).toFixed(0), p5Bps: Math.round(p5 * 1e4) };
    };
    const A = stats(retA), B = stats(retB);
    const avgHold = holdA.length ? (holdA.reduce((a, b) => a + b, 0) / holdA.length).toFixed(1) : 0;
    console.log(`${tf}: [A] EMA20이탈 청산 — 평균 ${A.meanBps}bps 승률 ${A.win}% 하위5% ${A.p5Bps}bps (평균보유 ${avgHold}봉, 규칙청산 ${exitByRule}/타임아웃 ${exitByTimeout})`);
    console.log(`${" ".repeat(tf.length)}  [B] 고정 ${hold}봉 보유 — 평균 ${B.meanBps}bps 승률 ${B.win}% 하위5% ${B.p5Bps}bps`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
