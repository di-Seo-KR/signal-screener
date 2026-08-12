// ════════════════════════════════════════════════════════════════════
// H1 검증 — 피보 리클레임 진입 vs 레벨 터치 즉시 진입 A/B (사전등록 백테스트, 2026-08-12)
// ────────────────────────────────────────────────────────────────────
// 출처 가설: docs/research/veyric-ta-methodology-2026-08.json hypotheses[0]
//   "레벨 저격(각질) 금지 — 피보 터치 후 상위 레벨 종가 회복(리클레임) 확인 진입"
//   원 주장: "레벨 각질은 10번 중 3승 7휩소"
//
// 리서치 전용 스크립트 — 라이브 코드·매매 경로와 완전 분리.
// 실행: node scripts/research/h1-fib-reclaim.mjs
// 산출: scripts/research/h1-results.json
//
// ★★★ 사전등록 파라미터·규약 (아래 상수/규약 외 사후 튜닝 금지) ★★★
// ════════════════════════════════════════════════════════════════════

// ── 그리드 (유일한 자유도) ──
const THETA_GRID = [0.03, 0.05, 0.08]; // ZigZag 반전 임계 θ (3/5/8%)
const TFS = ["1h", "4h"];              // 4h 기본 + 1h 병행

// ── 고정 파라미터 (그리드 아님 — 변경 금지) ──
// 레벨 규격: L(r) = B − r×(B−A)  (A=다리 저점, B=다리 고점, r=되돌림 비율)
// [2파형 W2] 터치 L(0.618) → 확인 종가 > L(0.5) 롱. SL 종가 < L(0.786).
// [4파형 W4] 터치 L(0.382) → 확인 종가 > L(0.236) 롱. SL 종가 < L(0.5).
// 공통: 진입 후 확인 레벨 재이탈(종가 < conf) 시 청산 + 셋업 영구 폐기(재진입 없음 — 셋업당 최대 1트레이드).
// TP: 직전 고점 B(=L(0)) 인트라바 터치 (갭 상방 시가면 시가 체결). 타임스톱: 60봉 종가.
const TIMESTOP_BARS = 60;
const W2 = { name: "W2", touch: 0.618, conf: 0.5, sl: 0.786 };
const W4 = { name: "W4", touch: 0.382, conf: 0.236, sl: 0.5 };

// ── 비교 기준 (baseline B안): 동일 좌표 "레벨 터치 즉시 지정가 진입" ──
// 셋업 생성(피벗 확정) 다음 봉부터 지정가 L(touch) 대기 → low ≤ L(touch) 시 체결
// (시가 ≤ L(touch)면 시가 체결 — 갭/이미 하회 상태). SL/TP/타임스톱은 리클레임과 동일 좌표:
// SL 종가 < L(sl), TP=B 터치, 60봉 타임스톱. 확인 절차만 제거한 순수 A/B.
//
// ── ZigZag (스트리밍 — 룩어헤드 없음) ──
// 상승 다리: pivot low A 확정 → 이후 최고가 B 에서 low 가 B×(1−θ) 이하로 밀리는 봉에서
// pivot high B "확정". 확정 봉을 셋업 생성 봉으로 삼음. 봉당 최대 1회 방향 전환(단순화).
//
// ── 셋업 수명 규칙 (사전등록) ──
// 생성: pivot high 확정 봉. W2·W4 두 셋업 동시 생성 (독립 평가, 중복 허용).
//   생성 봉 종가가 이미 L(sl) 미만이면 셋업 미생성 (사산 방지).
//   터치 판정은 확정 지연 구간 포함: min(low[B봉+1 .. 생성봉]) ≤ L(touch) 면 touched.
//   생성 봉 종가로 확인 조건 충족 시 즉시 진입 허용 (마감 정보만 사용 — 룩어헤드 없음).
// 진입 전 소멸: [리클레임] 종가 < L(sl) → 폐기 / 미터치 상태 종가 > B → 만료(조정 종료)
//   / 새 pivot high 확정 시 미진입·미체결 셋업 전부 만료(대체).
// baseline 체결은 생성 봉 이후(익봉부터)만 — 레벨은 피벗 확정 후에야 알 수 있으므로
//   확정 지연 구간의 터치로는 체결되지 않음 (양 팔 동일 정보 시점 — A/B 공정성).
//
// ── 실행·집계 규약 (사전등록) ──
// 리클레임 진입가 = 확인 봉 종가. 청산 체크는 익봉부터: TP 터치(시가 갭이면 시가) 우선
//   → 재이탈 종가 → 60봉째 종가. baseline 진입 봉은 SL 종가 체크만(TP는 경로 모호로 익봉부터).
// 수수료·슬리피지: 미적용(총수익) — 양 팔 동일 규약이라 상대 비교에는 영향 없음. caveat 명기.
//   (원 가설 risk: 확인 진입의 불리한 평균 진입가는 진입가 자체에 반영되어 있음)
// 신호 독립 평가: 각 셋업×팔을 독립 트레이드로 평가 (중복 허용, 포지션 순차 모델 미채택).
// 말단: 진입봉 idx + 60봉이 데이터에 없으면 스킵 (집계 제외, skipped 카운트).
// 세그먼트 귀속: 각 팔의 진입 봉 openTime 기준 (같은 셋업이라도 팔 간 세그먼트가 다를 수 있음).
// 집계 대상: 진입 봉 openTime ∈ [IS_START, PERIOD_END).

// ── 심볼 (사전등록) ──
const INSAMPLE_SYMBOLS = ["BTCUSDT", "ETHUSDT"];
const CROSSVAL_SYMBOLS = ["SOLUSDT", "XRPUSDT", "BNBUSDT", "DOGEUSDT", "ADAUSDT", "LINKUSDT"];
const ALL_SYMBOLS = [...INSAMPLE_SYMBOLS, ...CROSSVAL_SYMBOLS];

// ── 기간 (사전등록, 고정 타임스탬프 — 재실행 재현성) ──
// 최근 18개월 = 인샘플 12개월 + OOS 6개월. 홀드아웃(2026-08-12 이후 데이터)은 소진하지 않음.
const IS_START = Date.parse("2025-02-12T00:00:00Z");
const OOS_START = Date.parse("2026-02-12T00:00:00Z");
const PERIOD_END = Date.parse("2026-08-12T00:00:00Z");
const WARMUP_MS = 40 * 24 * 3600 * 1000; // ZigZag 상태 워밍업용 선행 데이터 (40일)

// ── 판정 룰 (사전등록 — 결과 본 뒤 변경 금지) ──
// bestTheta: 인샘플 심볼(BTC+ETH)×양 TF 풀링 IS 구간에서 Σ_tf (PF_reclaim − PF_baseline) 최대 θ
// passOOS: bestTheta 로 전 심볼×양 TF 풀링 OOS 구간에서, 양 TF 모두
//   PF_reclaim > PF_baseline AND winRate_reclaim > winRate_baseline
//   AND 리클레임 거래 수(IS+OOS 합, 전 심볼·양 TF) ≥ 30 (미만이면 유의성 미달 자동 기각)
const MIN_RECLAIM_TRADES = 30;

// ════════════════════════════════════════════════════════════════════
// 데이터 수집 — h2-volume-breakout-filter.mjs 와 동일 패턴 (바이낸스 선물 klines).
// 캐시: H2 와 기간·워밍업·심볼·TF 가 동일하므로 h2-klines-cache 재사용.
// ════════════════════════════════════════════════════════════════════

import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = join(__dirname, "h1-results.json");

const CACHE_DIR = process.env.ZEPTA_H1_CACHE
  || "/private/tmp/claude-501/-Users-kaneseo-Desktop-signal-screener-project--claude-worktrees-strange-bardeen-4ae62e/3d6e6a2a-2672-42dc-8d40-11e1b4ab1a72/scratchpad/h2-klines-cache";
mkdirSync(CACHE_DIR, { recursive: true });

const FAPI = process.env.BINANCE_FAPI_BASE || "https://fapi.binance.com";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readCache(name, maxAgeMs = 24 * 3600 * 1000) {
  const p = join(CACHE_DIR, `${name}.json`);
  if (!existsSync(p)) return null;
  if (Date.now() - statSync(p).mtimeMs > maxAgeMs) return null;
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; }
}
function writeCache(name, data) {
  writeFileSync(join(CACHE_DIR, `${name}.json`), JSON.stringify(data));
}

async function fetchKlinesPage(symbol, interval, startTime, endTime) {
  const url = `${FAPI}/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=1500`
    + `&startTime=${startTime}&endTime=${endTime}`;
  const resp = await fetch(url, {
    signal: AbortSignal.timeout(20000),
    headers: { "User-Agent": "Zepta-Research/1.0", "Accept": "application/json" },
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`klines ${symbol} ${interval} ${resp.status}: ${body.slice(0, 160)}`);
  }
  return await resp.json();
}

async function fetchAllKlines(symbol, interval) {
  const key = `${symbol}-${interval}`;
  const cached = readCache(key);
  if (cached) return cached;
  const out = [];
  let start = IS_START - WARMUP_MS;
  for (let page = 0; page < 40; page++) {
    let kl;
    try {
      kl = await fetchKlinesPage(symbol, interval, start, PERIOD_END);
    } catch (e) {
      await sleep(800); // 1회 재시도
      kl = await fetchKlinesPage(symbol, interval, start, PERIOD_END);
    }
    if (!Array.isArray(kl) || kl.length === 0) break;
    out.push(...kl);
    if (kl.length < 1500) break;
    start = Number(kl[kl.length - 1][0]) + 1;
    await sleep(120);
  }
  const seen = new Set(); const dedup = [];
  for (const k of out) {
    const t = Number(k[0]);
    if (!seen.has(t)) { seen.add(t); dedup.push(k); }
  }
  const closed = dedup.filter((k) => Number(k[6]) <= PERIOD_END);
  writeCache(key, closed);
  return closed;
}

function parseBars(raw) {
  return raw.map((k) => ({
    t: Number(k[0]),
    o: Number(k[1]), h: Number(k[2]), l: Number(k[3]), c: Number(k[4]),
  }));
}

// ════════════════════════════════════════════════════════════════════
// 트레이드 시뮬레이션 (독립 평가 — 미래 봉은 이 함수 내부에서만 접근)
// ════════════════════════════════════════════════════════════════════

/** 리클레임 팔: 확인 봉 종가 진입. 익봉부터 TP(B 터치) → 재이탈(종가<conf) → 60봉 종가. 말단이면 null */
function simReclaim(bars, setup, entryIdx) {
  if (entryIdx + TIMESTOP_BARS >= bars.length) return null;
  const entry = bars[entryIdx].c;
  let exit = null; let exitType = "time";
  for (let j = entryIdx + 1; j <= entryIdx + TIMESTOP_BARS; j++) {
    const b = bars[j];
    if (b.o >= setup.B) { exit = b.o; exitType = "tp-gap"; break; }
    if (b.h >= setup.B) { exit = setup.B; exitType = "tp"; break; }
    if (b.c < setup.confLv) { exit = b.c; exitType = "rebreak"; break; }
    if (j === entryIdx + TIMESTOP_BARS) { exit = b.c; exitType = "time"; }
  }
  return { t: bars[entryIdx].t, entry, exit, exitType, ret: exit / entry - 1 };
}

/** baseline 팔: fillIdx 봉 인트라바 체결. 체결 봉은 SL 종가만 체크, 익봉부터 TP → SL 종가 → 60봉 종가 */
function simBaseline(bars, setup, fillIdx, fillPrice) {
  if (fillIdx + TIMESTOP_BARS >= bars.length) return null;
  const entry = fillPrice;
  let exit = null; let exitType = "time";
  if (bars[fillIdx].c < setup.slLv) {
    exit = bars[fillIdx].c; exitType = "sl";
  } else {
    for (let j = fillIdx + 1; j <= fillIdx + TIMESTOP_BARS; j++) {
      const b = bars[j];
      if (b.o >= setup.B) { exit = b.o; exitType = "tp-gap"; break; }
      if (b.h >= setup.B) { exit = setup.B; exitType = "tp"; break; }
      if (b.c < setup.slLv) { exit = b.c; exitType = "sl"; break; }
      if (j === fillIdx + TIMESTOP_BARS) { exit = b.c; exitType = "time"; }
    }
  }
  return { t: bars[fillIdx].t, entry, exit, exitType, ret: exit / entry - 1 };
}

// ════════════════════════════════════════════════════════════════════
// 셋업 스캔 (심볼×TF×θ) — 스트리밍 ZigZag + 셋업 상태 머신
// 반환: { trades: [{setupId, type, arm, t, ret, exitType}], counters, skipped }
// ════════════════════════════════════════════════════════════════════

function runScan(bars, theta) {
  const trades = [];
  const counters = { setupsCreated: 0, stillborn: 0, touched: 0, reclaimEntered: 0, baseFilled: 0, expiredUntouched: 0, deadPreEntry: 0, superseded: 0 };
  let skippedReclaim = 0, skippedBase = 0;

  // ZigZag 상태
  let dir = 0; // 0=미정, 1=상승, -1=하락
  let runMax = { p: bars[0].h, i: 0 };
  let runMin = { p: bars[0].l, i: 0 };
  let lastPivotLow = null; // {p, i}
  let setupSeq = 0;
  let pending = []; // 활성 셋업

  const makeSetups = (A, Bp, bIdx, i) => {
    const made = [];
    for (const spec of [W2, W4]) {
      const leg = Bp.p - A.p;
      if (!(leg > 0)) continue;
      const L = (r) => Bp.p - r * leg;
      const s = {
        id: ++setupSeq, type: spec.name, createdIdx: i,
        A: A.p, B: Bp.p, bIdx,
        touchLv: L(spec.touch), confLv: L(spec.conf), slLv: L(spec.sl),
        touched: false, reclaimDone: false, baseDone: false,
      };
      // 사산 방지: 생성 봉 종가가 이미 SL 레벨 미만이면 미생성
      if (bars[i].c < s.slLv) { counters.stillborn++; continue; }
      // 확정 지연 구간(B봉+1..생성봉) 터치 판정
      for (let j = bIdx + 1; j <= i; j++) {
        if (bars[j].l <= s.touchLv) { s.touched = true; break; }
      }
      if (s.touched) counters.touched++;
      counters.setupsCreated++;
      // 생성 봉 종가로 즉시 확인 진입 가능 (마감 정보만 사용)
      if (s.touched && bars[i].c > s.confLv) {
        const tr = simReclaim(bars, s, i);
        s.reclaimDone = true;
        counters.reclaimEntered++;
        if (tr === null) skippedReclaim++;
        else trades.push({ setupId: s.id, type: s.type, arm: "reclaim", ...tr });
      }
      made.push(s);
    }
    return made;
  };

  for (let i = 1; i < bars.length; i++) {
    const b = bars[i];

    // ── 1) 기존 셋업 업데이트 (이 봉 데이터) ──
    for (const s of pending) {
      // baseline 지정가 체결 (생성 봉 이후만)
      if (!s.baseDone && i > s.createdIdx && b.l <= s.touchLv) {
        const fill = b.o <= s.touchLv ? b.o : s.touchLv;
        const tr = simBaseline(bars, s, i, fill);
        s.baseDone = true;
        counters.baseFilled++;
        if (tr === null) skippedBase++;
        else trades.push({ setupId: s.id, type: s.type, arm: "baseline", ...tr });
      }
      if (!s.reclaimDone) {
        if (!s.touched && b.l <= s.touchLv) { s.touched = true; counters.touched++; }
        if (s.touched && b.c > s.confLv) {
          const tr = simReclaim(bars, s, i);
          s.reclaimDone = true;
          counters.reclaimEntered++;
          if (tr === null) skippedReclaim++;
          else trades.push({ setupId: s.id, type: s.type, arm: "reclaim", ...tr });
        } else if (b.c < s.slLv) {
          s.reclaimDone = true; s.dead = true; counters.deadPreEntry++;
        } else if (!s.touched && b.c > s.B) {
          s.reclaimDone = true; s.baseDone = true; s.expired = true; counters.expiredUntouched++;
        }
      }
    }
    pending = pending.filter((s) => !(s.reclaimDone && s.baseDone) && !s.expired);

    // ── 2) ZigZag 업데이트 (봉당 최대 1회 전환) ──
    if (dir === 0) {
      if (b.h > runMax.p) runMax = { p: b.h, i };
      if (b.l < runMin.p) runMin = { p: b.l, i };
      if (b.h >= runMin.p * (1 + theta)) { dir = 1; lastPivotLow = runMin; runMax = { p: b.h, i }; }
      else if (b.l <= runMax.p * (1 - theta)) { dir = -1; runMin = { p: b.l, i }; }
    } else if (dir === 1) {
      if (b.h > runMax.p) runMax = { p: b.h, i };
      if (b.l <= runMax.p * (1 - theta)) {
        // pivot high 확정 → 기존 미완료 셋업 만료 + 새 셋업 생성
        const supersededCount = pending.length;
        counters.superseded += supersededCount;
        pending = [];
        if (lastPivotLow && lastPivotLow.i < runMax.i) {
          pending.push(...makeSetups(lastPivotLow, runMax, runMax.i, i));
        }
        dir = -1; runMin = { p: b.l, i };
      }
    } else {
      if (b.l < runMin.p) runMin = { p: b.l, i };
      if (b.h >= runMin.p * (1 + theta)) {
        lastPivotLow = runMin;
        dir = 1; runMax = { p: b.h, i };
      }
    }
  }

  return { trades, counters, skippedReclaim, skippedBase };
}

// ════════════════════════════════════════════════════════════════════
// 지표 집계 + 통계 (h2 와 동일 규약)
// ════════════════════════════════════════════════════════════════════

function metrics(trades) {
  const n = trades.length;
  if (n === 0) return { trades: 0, winRate: null, avgRetPct: null, medianRetPct: null, pf: null };
  const rets = trades.map((t) => t.ret);
  const wins = rets.filter((r) => r > 0);
  const grossP = wins.reduce((s, r) => s + r, 0);
  const grossL = rets.filter((r) => r < 0).reduce((s, r) => s - r, 0);
  const sorted = [...rets].sort((a, b) => a - b);
  const med = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  return {
    trades: n,
    winRate: round4(wins.length / n),
    avgRetPct: round4((rets.reduce((s, r) => s + r, 0) / n) * 100),
    medianRetPct: round4(med * 100),
    pf: grossL > 1e-12 ? round4(grossP / grossL) : (grossP > 0 ? null : 0),
  };
}
function round4(x) { return x == null ? null : Math.round(x * 1e4) / 1e4; }

function welchT(aRets, bRets) {
  const n1 = aRets.length, n2 = bRets.length;
  if (n1 < 5 || n2 < 5) return { t: null, pApprox: null, n1, n2 };
  const m1 = aRets.reduce((s, r) => s + r, 0) / n1;
  const m2 = bRets.reduce((s, r) => s + r, 0) / n2;
  const v1 = aRets.reduce((s, r) => s + (r - m1) ** 2, 0) / (n1 - 1);
  const v2 = bRets.reduce((s, r) => s + (r - m2) ** 2, 0) / (n2 - 1);
  const se = Math.sqrt(v1 / n1 + v2 / n2);
  if (!(se > 0)) return { t: null, pApprox: null, n1, n2 };
  const t = (m1 - m2) / se;
  const p = 2 * (1 - normCdf(Math.abs(t)));
  return { t: round4(t), pApprox: round4(p), n1, n2 };
}
function normCdf(x) {
  const t = 1 / (1 + 0.2316419 * x);
  const d = 0.3989422804014327 * Math.exp(-x * x / 2);
  const p = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return 1 - p;
}

// ════════════════════════════════════════════════════════════════════
// 메인
// ════════════════════════════════════════════════════════════════════

async function main() {
  console.log("H1 피보 리클레임 vs 레벨 터치 A/B — 사전등록 검증 시작");
  console.log(`기간: IS ${iso(IS_START)}~${iso(OOS_START)} / OOS ${iso(OOS_START)}~${iso(PERIOD_END)}`);

  const excluded = [];
  const perCell = [];
  const scanStats = [];
  // 풀링: key = tf|theta|segment|group → {base:[], rec:[], baseOnly:[]}
  const pool = new Map();
  const poolAdd = (tf, theta, segment, group, kind, trades) => {
    for (const g of [group, "all"]) {
      const key = `${tf}|${theta}|${segment}|${g}`;
      if (!pool.has(key)) pool.set(key, { base: [], rec: [], baseOnly: [] });
      pool.get(key)[kind].push(...trades);
    }
  };

  for (const symbol of ALL_SYMBOLS) {
    const group = INSAMPLE_SYMBOLS.includes(symbol) ? "insample" : "crossval";
    for (const tf of TFS) {
      let raw;
      try {
        raw = await fetchAllKlines(symbol, tf);
      } catch (e) {
        excluded.push({ symbol, tf, reason: `API 실패: ${String(e.message).slice(0, 120)}` });
        continue;
      }
      const bars = parseBars(raw);
      const isStartIdx = bars.findIndex((bb) => bb.t >= IS_START);
      if (isStartIdx < 50 || bars.length < 500) {
        excluded.push({ symbol, tf, reason: `캔들 부족 (총 ${bars.length}봉, IS 이전 ${isStartIdx}봉)` });
        continue;
      }

      for (const theta of THETA_GRID) {
        const { trades, counters, skippedReclaim, skippedBase } = runScan(bars, theta);
        // 집계 대상: 진입 봉이 검증 기간 내
        const inPeriod = trades.filter((t) => t.t >= IS_START && t.t < PERIOD_END);
        const recSetupIds = new Set(inPeriod.filter((t) => t.arm === "reclaim").map((t) => t.setupId));
        for (const segment of ["IS", "OOS"]) {
          const seg = inPeriod.filter((t) =>
            segment === "IS" ? t.t < OOS_START : t.t >= OOS_START);
          const base = seg.filter((t) => t.arm === "baseline");
          const rec = seg.filter((t) => t.arm === "reclaim");
          const baseOnly = base.filter((t) => !recSetupIds.has(t.setupId)); // 리클레임이 걸러낸 셋업의 baseline 성과
          perCell.push({
            symbol, tf, theta, segment,
            baseline: metrics(base),
            reclaim: metrics(rec),
            baselineOnly: metrics(baseOnly),
            byType: {
              W2: { base: base.filter((t) => t.type === "W2").length, rec: rec.filter((t) => t.type === "W2").length },
              W4: { base: base.filter((t) => t.type === "W4").length, rec: rec.filter((t) => t.type === "W4").length },
            },
          });
          poolAdd(tf, theta, segment, group, "base", base);
          poolAdd(tf, theta, segment, group, "rec", rec);
          poolAdd(tf, theta, segment, group, "baseOnly", baseOnly);
        }
        scanStats.push({ symbol, tf, theta, ...counters, skippedReclaim, skippedBase });
      }
      console.log(`${symbol} ${tf}: ${bars.length}봉 스캔 완료`);
    }
  }

  // ── 풀링 집계 ──
  const pooled = [];
  for (const [key, bucket] of pool.entries()) {
    const [tf, theta, segment, group] = key.split("|");
    pooled.push({
      tf, theta: Number(theta), segment, group,
      baseline: metrics(bucket.base),
      reclaim: metrics(bucket.rec),
      baselineOnly: metrics(bucket.baseOnly),
      reclaimVsBaseline: welchT(bucket.rec.map((t) => t.ret), bucket.base.map((t) => t.ret)),
      baselineOnlyVsReclaim: welchT(bucket.baseOnly.map((t) => t.ret), bucket.rec.map((t) => t.ret)),
    });
  }

  // ── bestTheta 선정 (사전등록 룰: IS·insample·양 TF 합산 PF 개선폭 최대) ──
  const thetaScore = new Map();
  for (const theta of THETA_GRID) {
    let score = 0; let valid = true;
    for (const tf of TFS) {
      const cell = pooled.find((p) => p.tf === tf && p.theta === theta && p.segment === "IS" && p.group === "insample");
      if (!cell || cell.reclaim.pf == null || cell.baseline.pf == null) { valid = false; break; }
      score += cell.reclaim.pf - cell.baseline.pf;
    }
    thetaScore.set(theta, valid ? round4(score) : null);
  }
  let bestTheta = null; let bestScore = -Infinity;
  for (const [th, s] of thetaScore.entries()) {
    if (s != null && s > bestScore) { bestScore = s; bestTheta = th; }
  }

  // ── passOOS 판정 (사전등록 룰) ──
  let passOOS = false;
  let oosDetail = null;
  if (bestTheta != null) {
    const oosCells = TFS.map((tf) =>
      pooled.find((p) => p.tf === tf && p.theta === bestTheta && p.segment === "OOS" && p.group === "all"));
    const isCells = TFS.map((tf) =>
      pooled.find((p) => p.tf === tf && p.theta === bestTheta && p.segment === "IS" && p.group === "all"));
    const recTradesTotal = [...oosCells, ...isCells].reduce((s, c) => s + (c?.reclaim.trades ?? 0), 0);
    const pfImproves = oosCells.every((c) => c && c.reclaim.pf != null && c.baseline.pf != null && c.reclaim.pf > c.baseline.pf);
    const wrImproves = oosCells.every((c) => c && c.reclaim.winRate != null && c.baseline.winRate != null && c.reclaim.winRate > c.baseline.winRate);
    passOOS = pfImproves && wrImproves && recTradesTotal >= MIN_RECLAIM_TRADES;
    oosDetail = { pfImproves, wrImproves, recTradesTotal, minRequired: MIN_RECLAIM_TRADES };
  }

  const results = {
    hypothesis: "H1 — 피보 되돌림 '리클레임 확인 진입'(W2: 0.618터치→0.5종가회복 / W4: 0.382터치→0.236종가회복)이 동일 좌표 '레벨 터치 즉시 지정가 진입' 대비 PF·승률 개선",
    source: "docs/research/veyric-ta-methodology-2026-08.json hypotheses[0]",
    preregistered: {
      thetaGrid: THETA_GRID, timeframes: TFS,
      setups: { W2, W4 },
      timestopBars: TIMESTOP_BARS,
      tp: "직전 고점 B(=L(0)) 인트라바 터치, 갭 상방이면 시가",
      reclaimExit: "익봉부터 TP → 확인레벨 재이탈 종가 → 60봉 종가. 재이탈 시 셋업 영구 폐기",
      baselineArm: "셋업 생성 익봉부터 L(touch) 지정가 (시가≤레벨이면 시가), SL 종가<L(sl), TP·타임스톱 동일",
      setupLifecycle: "pivot high 확정 봉 생성 / 생성봉 종가<L(sl)이면 미생성 / 미터치 종가>B 만료 / 새 pivot high 확정 시 미완료 셋업 대체 만료",
      insampleSymbols: INSAMPLE_SYMBOLS, crossvalSymbols: CROSSVAL_SYMBOLS,
      period: { isStart: iso(IS_START), oosStart: iso(OOS_START), end: iso(PERIOD_END) },
      bestThetaRule: "IS·insample(BTC+ETH)·양TF 합산 (PF_reclaim − PF_baseline) 최대 θ",
      passOOSRule: `OOS·전심볼·양TF 모두 PF_rec > PF_base AND winRate_rec > winRate_base AND 리클레임 거래수(IS+OOS) ≥ ${MIN_RECLAIM_TRADES}`,
      fees: "수수료·슬리피지 미적용 (양 팔 동일 규약 — 상대 비교 목적)",
    },
    generatedAt: new Date().toISOString(),
    excluded,
    thetaScoreIS: Object.fromEntries([...thetaScore.entries()].map(([k, v]) => [String(k), v])),
    bestTheta,
    passOOS,
    oosDetail,
    pooled: pooled.sort((a, b) =>
      a.group.localeCompare(b.group) || a.tf.localeCompare(b.tf) || a.theta - b.theta || a.segment.localeCompare(b.segment)),
    perSymbol: perCell,
    scanStats,
  };

  writeFileSync(OUT_PATH, JSON.stringify(results, null, 2));
  console.log(`\n결과 저장: ${OUT_PATH}`);
  console.log(`제외: ${excluded.length}건, bestTheta=${bestTheta}, passOOS=${passOOS}`);
  if (oosDetail) console.log("OOS 상세:", JSON.stringify(oosDetail));
}

function iso(ms) { return new Date(ms).toISOString().slice(0, 10); }

main().catch((e) => { console.error("실행 실패:", e); process.exit(1); });
