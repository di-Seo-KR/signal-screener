// ════════════════════════════════════════════════════════════════════
// 캔들 패턴 캘리브레이션 — 과거 봉 전수 학습 (2026-07, 대표 지시)
// ────────────────────────────────────────────────────────────────────
// "교과서 가중치가 아니라 우리 코인 과거 데이터가 가중치를 결정한다."
//
// 방법 (투명한 실측 통계 — 블랙박스 아님):
//   1) 유동성 상위 24심볼 × {1h, 4h, 1d} 캔들 각 1500봉(1h≈62일/4h≈250일/1d≈4.1년)
//   2) candle-patterns.js 로 게이트 통과 패턴 이벤트 전수 감지 (확정봉만)
//   3) 각 이벤트의 전진수익: 다음 봉 시가 진입 → H봉 후 종가 (1h:H=24, 4h:12, 1d:5)
//   4) 초과엣지 = dir×(전진수익 − *학습구간* 드리프트 중앙값) — 상승장 편향 제거(누출 차단)
//   5) 시간 분할: 앞 65% = 학습, 뒤 35% = OOS — 채택은 두 구간 부호 일관 요구
//   6) mult 부여: 학습>0 AND OOS≥10bps(수수료 초과) AND 클러스터-강건 합동 t≥0.5(0.6)/≥1.5(1.0),
//      표본부족(학습<30 또는 OOS<10)은 0. 동일봉 클러스터 SE 로 심볼 동시발화 t-부풀림 차단.
//   → api/_shared/candle-calibration.js 재생성
//
// 실행: node scripts/calibrate-candle-patterns.mjs   (env 불필요 — 다이렉트 모드)
// ════════════════════════════════════════════════════════════════════

import { writeFileSync } from "node:fs";
import { getKlines } from "../api/_shared/binance-client.js";
import { analyzeCandleSeries, PATTERN_DEFS } from "../api/_shared/candle-patterns.js";

const SYMBOLS = [
  "BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "AVAXUSDT", "LINKUSDT", // 검증 앵커 6
  "BNBUSDT", "ADAUSDT", "DOGEUSDT", "DOTUSDT", "LTCUSDT", "UNIUSDT",
  "ATOMUSDT", "NEARUSDT", "APTUSDT", "ARBUSDT", "OPUSDT", "FILUSDT",
  "INJUSDT", "SUIUSDT", "AAVEUSDT", "WLDUSDT", "FETUSDT", "TAOUSDT",
];
const TFS = [
  { tf: "1h", limit: 1500, horizon: 24 },
  { tf: "4h", limit: 1500, horizon: 12 },
  { tf: "1d", limit: 1500, horizon: 5 },
];
const TRAIN_FRAC = 0.65;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function toArrays(klines) {
  const opens = [], highs = [], lows = [], closes = [], volumes = [], times = [];
  for (const k of klines) {
    const o = +k[1], h = +k[2], l = +k[3], c = +k[4], v = +k[5];
    if (![o, h, l, c].every(Number.isFinite)) continue;
    opens.push(o); highs.push(h); lows.push(l); closes.push(c); volumes.push(v); times.push(+k[0]);
  }
  return { opens, highs, lows, closes, volumes, times };
}

function median(xs) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// ★ 적대리뷰 P1-2c 반영: 24개 고상관 크립토가 같은 시장 반전일에 동시 이벤트를 만들어
//   i.i.d. t-stat 이 부풀려짐 → 같은 봉 타임스탬프끼리 클러스터로 묶어 "클러스터 평균들"을
//   관측치로 사용(클러스터-강건 SE 의 보수적 근사). winRate 는 이벤트 단위 유지.
function stats(items) {
  const n = items.length;
  if (!n) return { n: 0, mean: 0, t: 0, winRate: 0, k: 0 };
  const byTs = new Map();
  for (const it of items) {
    const g = byTs.get(it.ts) || [];
    g.push(it.x); byTs.set(it.ts, g);
  }
  const clusterMeans = [...byTs.values()].map((g) => g.reduce((a, b) => a + b, 0) / g.length);
  const k = clusterMeans.length;
  const mean = clusterMeans.reduce((a, b) => a + b, 0) / k;
  const varr = k > 1 ? clusterMeans.reduce((a, b) => a + (b - mean) ** 2, 0) / (k - 1) : 0;
  const se = Math.sqrt(varr / Math.max(1, k));
  const t = se > 0 ? mean / se : 0;
  const winRate = items.filter((it) => it.x > 0).length / n;
  return { n, mean, t, winRate, k };
}

// ★ 1차 실행 발견(2026-07-03): 학습 t≥2 조합 다수가 OOS 에서 부호 반전(예: 4h
//   흑운형 +98→-106bps) — 캔들 엣지는 레짐 의존이 강해 *한 구간 통계만으론 과적합*.
//   → 채택 규칙 강화: 두 구간(학습+OOS) 부호 일관 + 클러스터-강건 합동 t 유의성 요구.
// ★ 적대리뷰 P1-2a 반영: OOS 엣지 0 통과 허점 제거 — OOS 는 왕복 수수료(10bps)를
//   초과하는 양의 엣지를 실측해야 채택. "OOS 0인데 만점" 케이스 원천 차단.
//   OOS 를 선별에 소비하므로 이 테이블의 최종 검증은 (a) 홀드아웃 심볼 A/B 트레이드
//   백테스트(scripts/backtest-candle-ab.mjs) + (b) 배포 후 shadow 레저 모니터링.
const FEE_FLOOR = 0.0010; // 10bps — 왕복 수수료 하한
// ★ 2차 강화(2026-07-03): 0.6티어(약한 엣지, 예: 학습 +2bps 조합)가 홀드아웃 심볼 A/B 에서
//   노이즈로 판명(defi-momentum −0.23) → 합동 t≥1.5 강유의 조합만 채택. 홀드아웃 반복 튜닝
//   금지 원칙: 이 상향은 1회 조정이며 이후 판단은 배포 후 라이브 모니터링이 맡는다.
function multFromConsistency(tr, te, pooledT) {
  if (tr.n < 30 || te.n < 10) return 0;              // 표본 부족 — 미채택 (반가중 없음)
  if (tr.mean <= 0 || te.mean < FEE_FLOOR) return 0; // OOS 가 수수료 초과 엣지를 실증 못하면 끔
  if (pooledT >= 1.5) return 1.0;                    // 두 구간 일관 + 강한 합동 유의만
  return 0;
}

async function main() {
  const t0 = Date.now();
  // 수집: {tf: {pattern: {train: [], test: []}}}
  const pool = {};
  for (const { tf } of TFS) {
    pool[tf] = {};
    for (const name of Object.keys(PATTERN_DEFS)) pool[tf][name] = { train: [], test: [] };
  }
  let fetched = 0, failed = 0, totalEvents = 0;

  for (const { tf, limit, horizon } of TFS) {
    for (const symbol of SYMBOLS) {
      let klines;
      try {
        klines = await getKlines({ symbol, interval: tf, limit });
      } catch (e) {
        failed++;
        console.error(`  ✗ ${symbol} ${tf}: ${e.message?.slice(0, 80)}`);
        await sleep(300);
        continue;
      }
      fetched++;
      const arr = toArrays(klines);
      // 마지막 봉은 진행 중일 수 있음 — 확정봉 원칙으로 제거
      for (const k of Object.keys(arr)) arr[k] = arr[k].slice(0, -1);
      const n = arr.closes.length;
      if (n < 200) { await sleep(120); continue; }

      // 심볼×TF 드리프트: 학습 구간(앞 65%)의 H봉 전진수익 중앙값만 사용
      //   (적대리뷰 P2-3: 전구간 드리프트는 미래 레짐 정보를 선별 통계에 누출)
      const splitIdx = Math.floor(n * TRAIN_FRAC);
      const fwdTrain = [];
      for (let j = 21; j + 1 + horizon < splitIdx; j++) {
        const entry = arr.opens[j + 1];
        if (entry > 0) fwdTrain.push((arr.closes[j + horizon] - entry) / entry);
      }
      const drift = median(fwdTrain);

      // 패턴 이벤트 감지 — 캘리브레이션이므로 calib=null(원 가중, 게이트는 활성)
      const { events } = analyzeCandleSeries(arr, { tf, calib: null });
      for (const ev of events) {
        if (ev.i + 1 + horizon >= n) continue; // 전진 구간 없음
        const entry = arr.opens[ev.i + 1];
        if (!(entry > 0)) continue;
        const fwd = (arr.closes[ev.i + horizon] - entry) / entry;
        const excess = ev.dir * (fwd - drift); // 방향 정렬 초과수익
        const bucket = ev.i < splitIdx ? "train" : "test";
        pool[tf][ev.name][bucket].push({ x: excess, ts: arr.times[ev.i] }); // ts = 클러스터 키
        totalEvents++;
      }
      await sleep(120); // 바이낸스 가중치 여유 확보
    }
    console.log(`  ${tf} 완료 (누적 이벤트 ${totalEvents})`);
  }

  // ── 통계 → mult 결정 ──
  const calib = {}; const report = [];
  for (const { tf } of TFS) {
    calib[tf] = {};
    for (const name of Object.keys(PATTERN_DEFS)) {
      const tr = stats(pool[tf][name].train);
      const te = stats(pool[tf][name].test);
      const pooledStats = stats([...pool[tf][name].train, ...pool[tf][name].test]);
      const mult = multFromConsistency(tr, te, pooledStats.t);
      calib[tf][name] = {
        mult,
        n: tr.n, edgeBps: Math.round(tr.mean * 1e4), t: +tr.t.toFixed(2), winRate: +tr.winRate.toFixed(3),
        oosN: te.n, oosEdgeBps: Math.round(te.mean * 1e4), oosT: +te.t.toFixed(2), oosWinRate: +te.winRate.toFixed(3),
      };
      report.push({ tf, name, ...calib[tf][name] });
    }
  }

  // ── 파일 생성 ──
  const now = new Date().toISOString();
  const meta = {
    generatedAt: now,
    symbols: SYMBOLS.length, tfs: TFS.map((x) => `${x.tf}×${x.limit}`),
    horizonBars: Object.fromEntries(TFS.map((x) => [x.tf, x.horizon])),
    trainFrac: TRAIN_FRAC, totalEvents, fetched, failed,
    method: "dir×(H봉 전진수익−학습구간 드리프트중앙값), 앞65%/뒤35% 부호일관 + OOS≥10bps + 동일봉 클러스터-강건 합동 t 기반 mult",
  };
  const lines = report.map((r) =>
    `//   ${r.tf.padEnd(3)} ${r.name.padEnd(18)} mult=${String(r.mult).padEnd(4)} | 학습 n=${String(r.n).padEnd(4)} 엣지=${String(r.edgeBps).padStart(5)}bps t=${String(r.t).padStart(5)} 승률=${r.winRate} | OOS n=${String(r.oosN).padEnd(3)} 엣지=${String(r.oosEdgeBps).padStart(5)}bps t=${r.oosT}`
  ).join("\n");
  const src = `// ════════════════════════════════════════════════════════════════════
// Zepta — 캔들 패턴 캘리브레이션 테이블 (자동 생성 — 수동 편집 금지)
// 생성: ${now} / scripts/calibrate-candle-patterns.mjs
// 데이터: 바이낸스 USDM ${SYMBOLS.length}심볼 × {1h,4h,1d} × 1500봉, 확정봉만
// 방법: ${meta.method}
// mult: 0=미채택(부호불일치/OOS<10bps/표본부족) 0.6=일관+약한엣지(합동t≥0.5) 1.0=일관+유의(합동t≥1.5)
// ────────────────────────────────────────────────────────────────────
${lines}
// ════════════════════════════════════════════════════════════════════

export const CANDLE_CALIB = ${JSON.stringify(calib, null, 2)};

export const CANDLE_CALIB_META = ${JSON.stringify(meta, null, 2)};

export default { CANDLE_CALIB, CANDLE_CALIB_META };
`;
  writeFileSync(new URL("../api/_shared/candle-calibration.js", import.meta.url), src);

  // ── 콘솔 보고 ──
  console.log(`\n═══ 캘리브레이션 완료 (${((Date.now() - t0) / 1000).toFixed(0)}s) ═══`);
  console.log(`심볼 ${fetched}/${SYMBOLS.length * TFS.length} fetch, 이벤트 ${totalEvents}개`);
  console.log(`\nTF   패턴               mult  | 학습 n / 엣지bps / t / 승률  | OOS n / 엣지bps / t`);
  for (const r of report) {
    console.log(`${r.tf.padEnd(4)} ${r.name.padEnd(18)} ${String(r.mult).padEnd(5)} | ${String(r.n).padEnd(4)} ${String(r.edgeBps).padStart(6)} ${String(r.t).padStart(6)} ${String(r.winRate).padEnd(5)} | ${String(r.oosN).padEnd(4)} ${String(r.oosEdgeBps).padStart(6)} ${String(r.oosT).padStart(6)}`);
  }
  const kept = report.filter((r) => r.mult > 0).length;
  console.log(`\n채택 ${kept}/${report.length} 조합 (mult>0). OOS 부호 일치율: ${
    (report.filter((r) => r.n >= 30 && r.oosN >= 10 && Math.sign(r.edgeBps) === Math.sign(r.oosEdgeBps)).length)
  }/${report.filter((r) => r.n >= 30 && r.oosN >= 10).length}`);
}

main().catch((e) => { console.error("치명 오류:", e); process.exit(1); });
