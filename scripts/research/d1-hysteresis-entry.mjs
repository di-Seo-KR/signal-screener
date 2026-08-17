// ════════════════════════════════════════════════════════════════════
// D-1 검증 — 진입 히스테리시스 필터 (사전등록 백테스트, 2026-08-17)
// ────────────────────────────────────────────────────────────────────
// 가설: "시그널 발화 직후 w사이클(1사이클=10분, btc-cron 주기) 내 재확인
//   (같은 방향 유지)된 진입이, 즉시 진입보다 낫다(플리커 진입 차단)."
//
// 시그널 프록시 (사전등록): 10분봉 20봉 채널 돌파 (h2 스크립트와 동일 탐지기).
//   발화 = 종가가 직전 20봉 최고가 상향 돌파(롱) / 최저가 하향 돌파(숏).
//   재확인 = 발화 w봉 뒤 종가가 *여전히* 발화 시점 채널 레벨 밖(같은 방향 유지).
//   즉시 진입(베이스라인) = 발화봉 종가. 히스테리시스 진입 = 재확인봉 종가.
//   재확인 실패 시 진입 자체를 차단(플리커 차단) — 그 발화는 거래 없음.
//
// 리서치 전용 스크립트 — 라이브 코드·매매 경로와 완전 분리.
// 실행: node scripts/research/d1-hysteresis-entry.mjs
// 산출: scripts/research/d1-results.json (판정과 무관하게 항상 저장)
//
// ★★★ 사전등록 파라미터 (아래 상수 외 사후 튜닝 금지) ★★★
// ════════════════════════════════════════════════════════════════════

// ── 그리드 (유일한 자유도 — 지시로 2개 고정, 추가 금지) ──
const W_GRID = [1, 3]; // 재확인 대기 사이클 수: 1사이클(10분) / 3사이클(30분)

// ── 고정 파라미터 (그리드 아님 — 변경 금지, H2 규약 승계) ──
const CYCLE_MS = 10 * 60 * 1000;   // 1사이클 = 10분 (btc-cron 주기와 동일)
const BREAKOUT_LOOKBACK = 20;      // 돌파 정의: 직전 20봉 최고/최저 (h2와 동일)
const EXIT_BARS = 24;              // 진입 후 24봉(=4시간) 경과 시 종가 청산
const ATR_PERIOD = 14;             // Wilder ATR(14)
const STOP_ATR_MULT = 2;           // 손절 = 진입가 ∓ 2×ATR(14) — ATR 은 *실제 진입봉* 기준
const N_PERM = 1000;               // 순열검정 반복 수
const PERM_SEED = 20260817;        // 순열 시드 (재현성)

// ── 심볼 (사전등록 — H2/H3/H5 공통 규약: BTC·ETH·SOL + 알트 5종) ──
const INSAMPLE_SYMBOLS = ["BTCUSDT", "ETHUSDT"];
const CROSSVAL_SYMBOLS = ["SOLUSDT", "XRPUSDT", "BNBUSDT", "DOGEUSDT", "ADAUSDT", "LINKUSDT"];
const ALL_SYMBOLS = [...INSAMPLE_SYMBOLS, ...CROSSVAL_SYMBOLS];

// ── 기간 (사전등록, 고정 타임스탬프 — H2 와 동일 경계) ──
// 최근 18개월 = 인샘플 12개월 + OOS 6개월.
// ★ 홀드아웃: 2026-08-12 이후 데이터는 사용하지 않음 (H2 홀드아웃과 공유 — 소진 금지).
const IS_START = Date.parse("2025-02-12T00:00:00Z");
const OOS_START = Date.parse("2026-02-12T00:00:00Z");
const PERIOD_END = Date.parse("2026-08-12T00:00:00Z");
const WARMUP_MS = 10 * 24 * 3600 * 1000; // 지표 워밍업 선행 데이터 (10일 = 10분봉 1,440개)

// ── 판정 룰 (사전등록 — 결과 본 뒤 변경 금지) ──
// bestW: IS·insample(BTC+ETH) 풀링에서 (PF_hyst − PF_base) 최대인 w
// "배포 후보" = 아래 3개 모두 충족, 하나라도 미달 시 "기각":
//  (a) OOS PF 개선: bestW 로 OOS·전심볼 풀링에서 PF_hyst > PF_base(즉시 진입, 전 발화)
//  (b) 순열검정 p < 0.05 (단측): OOS·전심볼에서 "재확인 라벨"을 심볼 내 셔플(같은 개수 유지,
//      N_PERM회, 시드 고정)한 지연진입 부분집합 PF ≥ 관측 PF_hyst 비율 = p.
//      → 재확인 *선별*이 같은 크기의 무작위 선별보다 유의하게 나은가 (지연 효과와 분리)
//  (c) 히스테리시스 거래수 IS+OOS 합계 ≥ 30 (유의성 미달 자동 기각 — H2 규약 승계)
const MIN_HYST_TRADES = 30;
const P_THRESHOLD = 0.05;

// ── 진입·청산 규약 (사전등록) ──
// 10분봉 = 바이낸스 선물 5m 캔들 2개 집계(정각 10분 경계 정렬, 불완전 그룹 폐기).
// 신호는 봉 마감 데이터로만 계산 — 룩어헤드 없음. 손절 체크는 진입봉 다음 봉부터
// (갭 이탈 시 시가 체결 — 보수적), 수수료·슬리피지 미적용(베이스/히스테리시스 동일 규약 —
// 상대 비교에는 영향 없음, caveat 명시). 신호 독립 평가(중복 허용, h2와 동일 사유).
// 데이터 말단에서 재확인봉 또는 EXIT_BARS 가 안 남는 발화는 스킵(집계 제외, skipped 카운트).
// 세그먼트 귀속: *발화봉* openTime 기준. 진단용 지연진입 전수(delayedAll)·차단군
// 즉시진입(blockedBase)은 보고용 — 판정에 불사용.

// ════════════════════════════════════════════════════════════════════
// 데이터 수집 — 바이낸스 선물 klines 직접 호출 (h2 스크립트와 동일 경로) + 캐시
// ════════════════════════════════════════════════════════════════════

import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = join(__dirname, "d1-results.json");

const CACHE_DIR = process.env.ZEPTA_D1_CACHE
  || "/private/tmp/claude-501/-Users-kaneseo-Desktop-signal-screener-project--claude-worktrees-strange-bardeen-4ae62e/3d6e6a2a-2672-42dc-8d40-11e1b4ab1a72/scratchpad/d1-klines-cache";
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

// 바이낸스 fapi 한도: 가중치 2400/min, klines(limit=1500) 가중치 10 → 분당 240회 상한.
// 페이지 간 300ms(≈분당 200회 = 가중치 2000)로 여유 확보 + 429 시 65초 백오프 후 재시도.
// (데이터 수집 인프라 파라미터 — 사전등록 분석 파라미터와 무관)
const PAGE_SLEEP_MS = 300;
async function fetchKlinesPage(symbol, interval, startTime, endTime) {
  const url = `${FAPI}/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=1500`
    + `&startTime=${startTime}&endTime=${endTime}`;
  for (let attempt = 0; ; attempt++) {
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(20000),
      headers: { "User-Agent": "Zepta-Research/1.0", "Accept": "application/json" },
    });
    if (resp.status === 429 || resp.status === 418) {
      if (attempt >= 3) throw new Error(`klines ${symbol} ${interval} ${resp.status}: rate limit (3회 백오프 후에도 지속)`);
      const ra = Number(resp.headers.get("retry-after"));
      const waitMs = (Number.isFinite(ra) && ra > 0 ? ra : 65) * 1000;
      console.log(`  ${symbol} ${interval} ${resp.status} — ${Math.round(waitMs / 1000)}초 대기 후 재시도 (${attempt + 1}/3)`);
      await sleep(waitMs);
      continue;
    }
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(`klines ${symbol} ${interval} ${resp.status}: ${body.slice(0, 160)}`);
    }
    return await resp.json();
  }
}

/** 기간 전체 5m klines (페이지네이션 + 중복 제거 + 캐시). 실패 시 throw — 호출부에서 심볼 제외 */
async function fetchAll5m(symbol) {
  const key = `${symbol}-5m`;
  const cached = readCache(key);
  if (cached) return cached;
  const out = [];
  let start = IS_START - WARMUP_MS;
  for (let page = 0; page < 130; page++) {
    let kl;
    try {
      kl = await fetchKlinesPage(symbol, "5m", start, PERIOD_END);
    } catch (e) {
      await sleep(800); // 1회 재시도
      kl = await fetchKlinesPage(symbol, "5m", start, PERIOD_END);
    }
    if (!Array.isArray(kl) || kl.length === 0) break;
    out.push(...kl);
    if (kl.length < 1500) break;
    start = Number(kl[kl.length - 1][0]) + 1;
    await sleep(PAGE_SLEEP_MS);
  }
  const seen = new Set(); const dedup = [];
  for (const k of out) {
    const t = Number(k[0]);
    if (!seen.has(t)) { seen.add(t); dedup.push(k); }
  }
  // 진행 중(미마감) 봉 제거
  const closed = dedup.filter((k) => Number(k[6]) <= PERIOD_END);
  writeCache(key, closed);
  return closed;
}

/** 5m 원시 klines → 10분봉 {t,o,h,l,c,v}. 정각 10분 경계에 정렬된 2개 1조만 채택 */
function aggregate10m(raw) {
  const bars5 = raw.map((k) => ({
    t: Number(k[0]),
    o: Number(k[1]), h: Number(k[2]), l: Number(k[3]), c: Number(k[4]),
    v: Number(k[5]),
  }));
  const out = [];
  for (let i = 0; i + 1 < bars5.length; ) {
    const a = bars5[i];
    if (a.t % CYCLE_MS !== 0) { i++; continue; } // 10분 경계 정렬
    const b = bars5[i + 1];
    if (b.t !== a.t + 5 * 60 * 1000) { i++; continue; } // 연속성 (결측 시 그룹 폐기)
    out.push({
      t: a.t, o: a.o, c: b.c,
      h: Math.max(a.h, b.h), l: Math.min(a.l, b.l),
      v: a.v + b.v,
    });
    i += 2;
  }
  return out;
}

// ════════════════════════════════════════════════════════════════════
// 지표·신호 (h2 스크립트와 동일 정의)
// ════════════════════════════════════════════════════════════════════

/** Wilder ATR(period). 반환: bars 와 같은 길이 배열 (앞 period 는 null) */
function wilderATR(bars, period) {
  const atr = new Array(bars.length).fill(null);
  if (bars.length < period + 1) return atr;
  const tr = new Array(bars.length).fill(0);
  for (let i = 1; i < bars.length; i++) {
    const b = bars[i], pc = bars[i - 1].c;
    tr[i] = Math.max(b.h - b.l, Math.abs(b.h - pc), Math.abs(b.l - pc));
  }
  let sum = 0;
  for (let i = 1; i <= period; i++) sum += tr[i];
  atr[period] = sum / period;
  for (let i = period + 1; i < bars.length; i++) {
    atr[i] = (atr[i - 1] * (period - 1) + tr[i]) / period;
  }
  return atr;
}

/**
 * 돌파 발화 전수 탐지 (h2 detectSignals 와 동일 — 연속 발화 중복 억제 포함).
 * 발화 시점의 채널 레벨(hh/ll)을 함께 반환 — 재확인 판정에 사용.
 */
function detectSignals(bars) {
  const signals = [];
  for (let i = BREAKOUT_LOOKBACK; i < bars.length; i++) {
    let hh = -Infinity, ll = Infinity;
    for (let j = i - BREAKOUT_LOOKBACK; j < i; j++) {
      if (bars[j].h > hh) hh = bars[j].h;
      if (bars[j].l < ll) ll = bars[j].l;
    }
    const b = bars[i];
    let phh = -Infinity, pll = Infinity;
    if (i - 1 >= BREAKOUT_LOOKBACK) {
      for (let j = i - 1 - BREAKOUT_LOOKBACK; j < i - 1; j++) {
        if (bars[j].h > phh) phh = bars[j].h;
        if (bars[j].l < pll) pll = bars[j].l;
      }
    }
    const prevInsideLong = i - 1 < BREAKOUT_LOOKBACK || bars[i - 1].c <= phh;
    const prevInsideShort = i - 1 < BREAKOUT_LOOKBACK || bars[i - 1].c >= pll;
    if (b.c > hh && prevInsideLong) signals.push({ i, dir: 1, hh, ll });
    else if (b.c < ll && prevInsideShort) signals.push({ i, dir: -1, hh, ll });
  }
  return signals;
}

/** entryIdx 봉 종가 진입 트레이드 시뮬레이션. 청산 불가(말단)·ATR 미형성 시 null */
function simulateFrom(bars, atr, entryIdx, dir) {
  if (entryIdx + EXIT_BARS >= bars.length) return null;
  const a = atr[entryIdx];
  if (a == null || !(a > 0)) return null;
  const entry = bars[entryIdx].c;
  const stop = entry - dir * STOP_ATR_MULT * a;
  let exit = null; let exitType = "time";
  for (let j = entryIdx + 1; j <= entryIdx + EXIT_BARS; j++) {
    const b = bars[j];
    if (dir === 1) {
      if (b.o <= stop) { exit = b.o; exitType = "stop-gap"; break; }
      if (b.l <= stop) { exit = stop; exitType = "stop"; break; }
    } else {
      if (b.o >= stop) { exit = b.o; exitType = "stop-gap"; break; }
      if (b.h >= stop) { exit = stop; exitType = "stop"; break; }
    }
    if (j === entryIdx + EXIT_BARS) { exit = b.c; exitType = "time"; }
  }
  const ret = dir * (exit / entry - 1);
  return { ret, exitType };
}

// ════════════════════════════════════════════════════════════════════
// 집계·통계 (h2 metrics/welch, h5 mulberry32 승계)
// ════════════════════════════════════════════════════════════════════

function metrics(rets) {
  const n = rets.length;
  if (n === 0) return { trades: 0, winRate: null, avgRetPct: null, medianRetPct: null, pf: null };
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
/** 순열검정 내부용 PF (무손실 시 Infinity — 비교 연산용) */
function pfRaw(rets) {
  let grossP = 0, grossL = 0;
  for (const r of rets) { if (r > 0) grossP += r; else if (r < 0) grossL -= r; }
  return grossL > 1e-12 ? grossP / grossL : (grossP > 0 ? Infinity : 0);
}
function round4(x) { return x == null ? null : Math.round(x * 1e4) / 1e4; }

/** Welch t-test (정규 근사, 대표본) — 차단군 vs 재확인군 즉시진입 수익 차이 (진단용) */
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

/** mulberry32 시드 RNG — 순열 재현성 (h5 와 동일) */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function strHash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/**
 * 순열검정 (사전등록 룰 b): universe = {symbol, reconf, ret(지연진입)} 발화 전수.
 * 관측 통계량 = 재확인 발화들의 지연진입 PF. 귀무 = 재확인 라벨이 성과와 무관.
 * 심볼 내 셔플(층화 — 심볼 구성비 교란 방지, 재확인 개수 보존). 단측 greater.
 */
function permutationTest(universe, wLabel) {
  const bySym = new Map();
  for (const u of universe) {
    if (!bySym.has(u.symbol)) bySym.set(u.symbol, []);
    bySym.get(u.symbol).push(u);
  }
  const obsRets = universe.filter((u) => u.reconf).map((u) => u.ret);
  const pfObs = pfRaw(obsRets);
  const rng = mulberry32(PERM_SEED ^ strHash(`D1|${wLabel}|OOS`));
  let ge = 0; let permPfSum = 0; let permPfN = 0;
  for (let p = 0; p < N_PERM; p++) {
    const permRets = [];
    for (const arr of bySym.values()) {
      const k = arr.reduce((s, u) => s + (u.reconf ? 1 : 0), 0);
      // 부분 Fisher-Yates: k개 무작위 추출 (라벨 셔플과 동치)
      const idx = arr.map((_, j) => j);
      for (let j = 0; j < k; j++) {
        const r = j + Math.floor(rng() * (idx.length - j));
        [idx[j], idx[r]] = [idx[r], idx[j]];
        permRets.push(arr[idx[j]].ret);
      }
    }
    const pfP = pfRaw(permRets);
    if (pfP >= pfObs) ge++;
    if (Number.isFinite(pfP)) { permPfSum += pfP; permPfN++; }
  }
  return {
    pfObs: Number.isFinite(pfObs) ? round4(pfObs) : null,
    nObs: obsRets.length, nUniverse: universe.length,
    nPerm: N_PERM, seed: PERM_SEED,
    pValue: round4((1 + ge) / (1 + N_PERM)), // add-one 보정 (표준 순열 p)
    permMeanPf: permPfN ? round4(permPfSum / permPfN) : null,
  };
}

// ════════════════════════════════════════════════════════════════════
// 메인
// ════════════════════════════════════════════════════════════════════

async function main() {
  console.log("D-1 진입 히스테리시스 필터 — 사전등록 검증 시작");
  console.log(`기간: IS ${iso(IS_START)}~${iso(OOS_START)} / OOS ${iso(OOS_START)}~${iso(PERIOD_END)} (홀드아웃 ${iso(PERIOD_END)}+ 미사용)`);

  const excluded = [];
  const perCell = [];
  // 풀링 버킷: key = `${w}|${segment}|${group}` → 수익 배열들
  const pool = new Map();
  const poolGet = (w, segment, group) => {
    const key = `${w}|${segment}|${group}`;
    if (!pool.has(key)) {
      pool.set(key, { base: [], hyst: [], blockedBase: [], delayedAll: [], reconfBase: [], fireN: 0, reconfN: 0 });
    }
    return pool.get(key);
  };
  // 순열검정 universe: key = `${w}|${segment}` → [{symbol, reconf, ret}]
  const permUniverse = new Map();
  const permGet = (w, segment) => {
    const key = `${w}|${segment}`;
    if (!permUniverse.has(key)) permUniverse.set(key, []);
    return permUniverse.get(key);
  };

  for (const symbol of ALL_SYMBOLS) {
    const group = INSAMPLE_SYMBOLS.includes(symbol) ? "insample" : "crossval";
    let raw;
    try {
      raw = await fetchAll5m(symbol);
    } catch (e) {
      excluded.push({ symbol, reason: `API 실패: ${String(e.message).slice(0, 120)}` });
      continue;
    }
    const bars = aggregate10m(raw);
    const isStartIdx = bars.findIndex((b) => b.t >= IS_START);
    if (isStartIdx < Math.max(BREAKOUT_LOOKBACK, ATR_PERIOD + 1) || bars.length < 3000) {
      excluded.push({ symbol, reason: `캔들 부족 (10분봉 ${bars.length}개, IS 이전 ${isStartIdx}개)` });
      continue;
    }
    const atr = wilderATR(bars, ATR_PERIOD);
    const fires = detectSignals(bars)
      .filter((s) => bars[s.i].t >= IS_START && bars[s.i].t < PERIOD_END);

    // 발화별 평가 (w 별 재확인·지연진입)
    const perW = new Map(W_GRID.map((w) => [w, {
      IS: { base: [], hyst: [], blockedBase: [], delayedAll: [], reconfBase: [], fireN: 0, reconfN: 0, skipped: 0 },
      OOS: { base: [], hyst: [], blockedBase: [], delayedAll: [], reconfBase: [], fireN: 0, reconfN: 0, skipped: 0 },
    }]));
    for (const sig of fires) {
      const segment = bars[sig.i].t < OOS_START ? "IS" : "OOS";
      const baseTr = simulateFrom(bars, atr, sig.i, sig.dir);
      for (const w of W_GRID) {
        const cell = perW.get(w)[segment];
        const j = sig.i + w; // 재확인봉
        if (j >= bars.length) { cell.skipped++; continue; }
        const delayedTr = simulateFrom(bars, atr, j, sig.dir);
        if (baseTr === null || delayedTr === null) { cell.skipped++; continue; } // 말단·ATR 미형성 — 공정 비교 위해 양쪽 다 제외
        const reconf = sig.dir === 1 ? bars[j].c > sig.hh : bars[j].c < sig.ll;
        cell.fireN++;
        cell.base.push(baseTr.ret);
        cell.delayedAll.push(delayedTr.ret);
        if (reconf) {
          cell.reconfN++;
          cell.hyst.push(delayedTr.ret);
          cell.reconfBase.push(baseTr.ret);
        } else {
          cell.blockedBase.push(baseTr.ret);
        }
        permGet(w, segment).push({ symbol, reconf, ret: delayedTr.ret });
      }
    }

    for (const w of W_GRID) {
      for (const segment of ["IS", "OOS"]) {
        const cell = perW.get(w)[segment];
        perCell.push({
          symbol, w, segment,
          fires: cell.fireN, reconfRate: cell.fireN ? round4(cell.reconfN / cell.fireN) : null,
          skipped: cell.skipped,
          base: metrics(cell.base),
          hyst: metrics(cell.hyst),
          blockedBase: metrics(cell.blockedBase),
          delayedAll: metrics(cell.delayedAll),
        });
        for (const g of [group, "all"]) {
          const b = poolGet(w, segment, g);
          b.base.push(...cell.base);
          b.hyst.push(...cell.hyst);
          b.blockedBase.push(...cell.blockedBase);
          b.delayedAll.push(...cell.delayedAll);
          b.reconfBase.push(...cell.reconfBase);
          b.fireN += cell.fireN; b.reconfN += cell.reconfN;
        }
      }
    }
    console.log(`${symbol}: 10분봉 ${bars.length}개, 기간 내 발화 ${fires.length}건`);
  }

  // ── 풀링 집계 ──
  const pooled = [];
  for (const [key, b] of pool.entries()) {
    const [w, segment, group] = key.split("|");
    pooled.push({
      w: Number(w), segment, group,
      fires: b.fireN, reconfRate: b.fireN ? round4(b.reconfN / b.fireN) : null,
      base: metrics(b.base),
      hyst: metrics(b.hyst),
      blockedBase: metrics(b.blockedBase),
      delayedAll: metrics(b.delayedAll),
      // 진단: 필터가 차단한 발화의 "즉시진입" 수익이 재확인 발화의 즉시진입 수익보다 실제로 나빴는가
      blockedVsReconfBase: welchT(b.blockedBase, b.reconfBase),
    });
  }

  // ── bestW 선정 (사전등록: IS·insample 풀링 PF_hyst − PF_base 최대) ──
  const wScore = new Map();
  for (const w of W_GRID) {
    const cell = pooled.find((p) => p.w === w && p.segment === "IS" && p.group === "insample");
    wScore.set(w, (cell && cell.hyst.pf != null && cell.base.pf != null)
      ? round4(cell.hyst.pf - cell.base.pf) : null);
  }
  let bestW = null; let bestScore = -Infinity;
  for (const [w, s] of wScore.entries()) {
    if (s != null && s > bestScore) { bestScore = s; bestW = w; }
  }

  // ── 순열검정 (OOS·전심볼 — 두 w 모두 산출하되 판정은 bestW 만) ──
  const permutation = {};
  for (const w of W_GRID) {
    const uni = permGet(w, "OOS");
    permutation[String(w)] = uni.length ? permutationTest(uni, `w${w}`) : null;
  }

  // ── 판정 (사전등록 룰) ──
  let verdict = { candidate: false, label: "기각", bestW, reasons: {} };
  if (bestW != null) {
    const oosAll = pooled.find((p) => p.w === bestW && p.segment === "OOS" && p.group === "all");
    const isAll = pooled.find((p) => p.w === bestW && p.segment === "IS" && p.group === "all");
    const pfImproves = !!(oosAll && oosAll.hyst.pf != null && oosAll.base.pf != null && oosAll.hyst.pf > oosAll.base.pf);
    const perm = permutation[String(bestW)];
    const permPass = !!(perm && perm.pValue != null && perm.pValue < P_THRESHOLD);
    const hystTradesTotal = (oosAll?.hyst.trades ?? 0) + (isAll?.hyst.trades ?? 0);
    const enoughTrades = hystTradesTotal >= MIN_HYST_TRADES;
    verdict = {
      candidate: pfImproves && permPass && enoughTrades,
      label: (pfImproves && permPass && enoughTrades) ? "배포 후보" : "기각",
      bestW,
      reasons: {
        oosPfImproves: pfImproves,
        oosPfHyst: oosAll?.hyst.pf ?? null, oosPfBase: oosAll?.base.pf ?? null,
        permutationPass: permPass, permutationP: perm?.pValue ?? null,
        hystTradesTotal, minRequired: MIN_HYST_TRADES,
      },
    };
  } else {
    verdict.reasons = { error: "bestW 선정 불가 (IS insample PF 계산 실패)" };
  }

  const results = {
    hypothesis: "D-1 — 시그널 발화 직후 w사이클(10분 단위) 내 재확인(같은 방향 유지)된 진입이 즉시 진입보다 낫다(플리커 진입 차단)",
    source: "대표 지시 2026-08-17 — 자동매매 확실한 타점 개선 (사전등록 백테스트)",
    preregistered: {
      wGridCycles: W_GRID, cycleMinutes: 10,
      signalProxy: "10분봉(바이낸스 5m×2 집계) 20봉 채널 돌파 — h2 detectSignals 동일, 재확인 = w봉 뒤 종가가 발화 시점 채널 레벨 밖 유지",
      breakoutLookback: BREAKOUT_LOOKBACK, exitBars: EXIT_BARS,
      atrPeriod: ATR_PERIOD, stopAtrMult: STOP_ATR_MULT,
      insampleSymbols: INSAMPLE_SYMBOLS, crossvalSymbols: CROSSVAL_SYMBOLS,
      period: { isStart: iso(IS_START), oosStart: iso(OOS_START), end: iso(PERIOD_END), holdoutNote: "2026-08-12 이후 미사용 (H2 홀드아웃 공유 — 소진 금지)" },
      bestWRule: "IS·insample(BTC+ETH) 풀링 (PF_hyst − PF_base) 최대 w",
      candidateRule: `OOS·전심볼 PF_hyst > PF_base AND 순열검정 p<${P_THRESHOLD} (심볼 층화 라벨 셔플 ${N_PERM}회, 단측) AND 히스테리시스 거래수 IS+OOS ≥ ${MIN_HYST_TRADES}`,
      permutationSeed: PERM_SEED,
      entryExit: "베이스=발화봉 종가 진입, 히스테리시스=재확인봉 종가 진입(미재확인 시 무거래), 손절 2×ATR(진입봉)·익봉부터 체크(갭=시가), 24봉 후 종가 청산, 수수료 미적용, 신호 독립 평가",
      caveats: [
        "시그널 프록시(채널 돌파)는 실제 엔진 종합점수의 대리 — 방향 플리커 구조는 유사하나 동일하지 않음",
        "수수료·슬리피지 미적용 — 양군 동일 규약이라 상대 비교에는 영향 없음",
        "손절 ATR 앵커가 진입봉 기준이라 베이스/히스테리시스 손절폭이 미세하게 다름(실제 구현과 동일한 규약)",
        "발화봉 귀속 세그먼트 — IS 말단 발화의 청산이 OOS 초입을 스칠 수 있음(h2와 동일)",
      ],
    },
    generatedAt: new Date().toISOString(),
    excluded,
    wScoreIS: Object.fromEntries([...wScore.entries()].map(([w, v]) => [String(w), v])),
    bestW,
    permutation,
    verdict,
    pooled: pooled.sort((a, b) =>
      a.group.localeCompare(b.group) || a.w - b.w || a.segment.localeCompare(b.segment)),
    perSymbol: perCell,
  };

  writeFileSync(OUT_PATH, JSON.stringify(results, null, 2));
  console.log(`\n결과 저장: ${OUT_PATH}`);
  console.log(`제외: ${excluded.length}건, bestW=${bestW}, 판정=${verdict.label}`);
  console.log("판정 근거:", JSON.stringify(verdict.reasons));
}

function iso(ms) { return new Date(ms).toISOString().slice(0, 10); }

main().catch((e) => { console.error("실행 실패:", e); process.exit(1); });
