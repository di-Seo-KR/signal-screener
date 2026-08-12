// ════════════════════════════════════════════════════════════════════
// H5 검증 — 시간대·요일 계절성 (사전등록 통계 검정, 2026-08-12)
// ────────────────────────────────────────────────────────────────────
// 출처 가설: docs/research/veyric-ta-methodology-2026-08.json hypotheses[4]
//   검증 대상 주장(KST):
//   ① 09시 봉의 상승 확률이 최고
//   ② 장대양봉(실체 상위 10%)은 10시·15시에 집중
//   ③ 수요일 상승 우위·목요일 하락 우위
//
// 백테스트가 아닌 통계 검정 — 트레이드 시뮬레이션 없음.
// 리서치 전용 스크립트 — 라이브 코드·매매 경로와 완전 분리.
// 실행: node scripts/research/h5-time-seasonality.mjs
// 산출: scripts/research/h5-results.json
//
// ★★★ 사전등록 파라미터·판정 룰 (아래 상수 외 사후 튜닝 금지) ★★★
// ════════════════════════════════════════════════════════════════════

// ── 검정 대상 주장 (원 주장 그대로 — 그리드 없음) ──
const CLAIM_HOUR_UP = 9;            // ① KST 09시 봉 상승 확률 최고
const CLAIM_BIGBULL_HOURS = [10, 15]; // ② 장대양봉 집중 시간 (각각 독립 검정: C2a=10시, C2b=15시)
const CLAIM_DAY_UP = 3;             // ③-a 수요일(KST, 0=일요일) 상승 우위
const CLAIM_DAY_DOWN = 4;           // ③-b 목요일 하락 우위
const BIG_BODY_TOP_PCT = 0.10;      // 장대양봉 = 양봉 중 실체비율(|c-o|/o) 상위 10%

// ── 다중비교 보정 (사전등록) ──
// 검정 5건: C1(09시 상승) / C2a(10시 장대양봉) / C2b(15시 장대양봉) / C3a(수 상승) / C3b(목 하락)
// Bonferroni: 유의 판정 기준 raw p < ALPHA / M_TESTS = 0.01
// BTC·ETH 양쪽 모두 요구는 보정이 아니라 복제(replication) 요건 — 검정 수에 불포함.
const ALPHA = 0.05;
const M_TESTS = 5;

// ── 검정 방법 (사전등록) ──
// 1차(판정용): 단측 이항 검정 — 관찰군 성공수 vs 기준율 p0(관찰군 제외 나머지 시간/요일의 풀링 비율).
//   C1: 09시 봉 상승수, p0 = 나머지 23개 시간대 상승률, 단측 greater
//   C2a/C2b: 장대양봉 중 해당 시각 개수, p0 = 1/24 (균등 귀무), 단측 greater
//   C3a: 수요일 상승 일수, p0 = 비수요일 상승률, 단측 greater
//   C3b: 목요일 상승 일수, p0 = 비목요일 상승률, 단측 lesser (하락 우위 = 상승률 유의하게 낮음)
// 2차(보고용, 판정 불사용): 순열 검정 10,000회 (시드 고정) —
//   C1: 시간 라벨 순열 후 09시 상승률 ≥ 관찰값 비율
//   C3a/C3b: 요일 라벨 순열 후 수요일 평균수익 ≥ / 목요일 평균수익 ≤ 관찰값 비율
const PERM_N = 10000;
const PERM_SEED = 20260812;

// ── 심볼 (사전등록 — 공통 규약) ──
const INSAMPLE_SYMBOLS = ["BTCUSDT", "ETHUSDT"];
const CROSSVAL_SYMBOLS = ["SOLUSDT", "XRPUSDT", "BNBUSDT", "DOGEUSDT", "ADAUSDT", "LINKUSDT"];
const ALL_SYMBOLS = [...INSAMPLE_SYMBOLS, ...CROSSVAL_SYMBOLS];

// ── 기간 (사전등록, 고정 타임스탬프 — H2/H3 과 동일) ──
// 최근 18개월 = 인샘플 12개월 + OOS 6개월. 홀드아웃(2026-08-12 이후)은 소진하지 않음.
const IS_START = Date.parse("2025-02-12T00:00:00Z");
const OOS_START = Date.parse("2026-02-12T00:00:00Z");
const PERIOD_END = Date.parse("2026-08-12T00:00:00Z");

// ── 시간대 규약 (사전등록) ──
const KST_OFFSET_MS = 9 * 3600 * 1000; // KST = UTC+9 (서머타임 없음)
// 봉의 시간대/요일 = openTime 의 KST 환산. 요일별 일수익 = KST 달력일(00~23시 봉 24개) 집계,
// 일수익 = (마지막 봉 종가 / 첫 봉 시가 − 1). 봉 20개 미만인 불완전 일은 제외.
const MIN_BARS_PER_DAY = 20;
// 세그먼트 귀속: 봉은 openTime(UTC) 기준, KST 달력일은 그 날 첫 봉의 openTime(UTC) 기준.

// ── 판정 룰 (사전등록 — 결과 본 뒤 변경 금지) ──
// 주장별 SUPPORTED 판정 = 아래 3개 모두 충족:
//  (a) IS 유의성: BTC·ETH 모두 IS 에서 효과 방향이 주장과 일치 AND 1차 이항검정 raw p < 0.01 (Bonferroni)
//  (b) OOS 방향 안정성: BTC·ETH 모두 OOS 에서 방향 일치 AND 교차심볼 6종 중 ≥4종 OOS 방향 일치
//  (c) 교차심볼 IS 방향 안정성: 교차심볼 6종 중 ≥4종 IS 방향 일치
//  (OOS·교차심볼은 표본이 작아 유의성이 아닌 방향 일관성만 요구 — 특정 구간·심볼 전용이면 기각)
// passOOS = 5개 주장 중 1개 이상 SUPPORTED.
const CROSSVAL_MIN_AGREE = 4;

// ════════════════════════════════════════════════════════════════════
// 데이터 수집 — 바이낸스 선물 1h klines (H2 와 동일 패턴 + H2 캐시 재사용)
// ════════════════════════════════════════════════════════════════════

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = join(__dirname, "h5-results.json");

const SCRATCH = "/private/tmp/claude-501/-Users-kaneseo-Desktop-signal-screener-project--claude-worktrees-strange-bardeen-4ae62e/3d6e6a2a-2672-42dc-8d40-11e1b4ab1a72/scratchpad";
const CACHE_DIRS = [join(SCRATCH, "h5-klines-cache"), join(SCRATCH, "h2-klines-cache")]; // [0]=쓰기, 나머지=읽기 폴백
mkdirSync(CACHE_DIRS[0], { recursive: true });

const FAPI = process.env.BINANCE_FAPI_BASE || "https://fapi.binance.com";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readCache(name) {
  for (const dir of CACHE_DIRS) {
    const p = join(dir, `${name}.json`);
    if (!existsSync(p)) continue;
    try { return JSON.parse(readFileSync(p, "utf8")); } catch { /* 다음 폴백 */ }
  }
  return null;
}
function writeCache(name, data) {
  writeFileSync(join(CACHE_DIRS[0], `${name}.json`), JSON.stringify(data));
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
  let start = IS_START - 2 * 24 * 3600 * 1000; // KST 달력일 경계 여유 2일
  for (let page = 0; page < 40; page++) {
    let kl;
    try {
      kl = await fetchKlinesPage(symbol, interval, start, PERIOD_END);
    } catch (e) {
      await sleep(800);
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
// 통계 유틸
// ════════════════════════════════════════════════════════════════════

function round4(x) { return x == null || Number.isNaN(x) ? null : Math.round(x * 1e4) / 1e4; }
function round6(x) { return x == null || Number.isNaN(x) ? null : Math.round(x * 1e6) / 1e6; }

/** Lanczos log-gamma */
function lgamma(z) {
  const g = 7;
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lgamma(1 - z);
  z -= 1;
  let x = c[0];
  for (let i = 1; i < g + 2; i++) x += c[i] / (z + i);
  const t = z + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}
function logChoose(n, k) { return lgamma(n + 1) - lgamma(k + 1) - lgamma(n - k + 1); }
function binomPMF(n, k, p) {
  if (p <= 0) return k === 0 ? 1 : 0;
  if (p >= 1) return k === n ? 1 : 0;
  return Math.exp(logChoose(n, k) + k * Math.log(p) + (n - k) * Math.log(1 - p));
}
/** 단측 이항 p — side: "greater" P(X>=k) / "lesser" P(X<=k) */
function binomTest(n, k, p0, side) {
  if (n === 0 || p0 == null) return null;
  let s = 0;
  if (side === "greater") { for (let i = k; i <= n; i++) s += binomPMF(n, i, p0); }
  else { for (let i = 0; i <= k; i++) s += binomPMF(n, i, p0); }
  return Math.min(1, s);
}

/** mulberry32 시드 RNG — 순열 재현성 */
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
function shuffleInPlace(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}
function mean(a) { return a.length ? a.reduce((s, x) => s + x, 0) / a.length : null; }

// ════════════════════════════════════════════════════════════════════
// 세그먼트 분석
// ════════════════════════════════════════════════════════════════════

const kstHour = (t) => new Date(t + KST_OFFSET_MS).getUTCHours();
const kstDow = (t) => new Date(t + KST_OFFSET_MS).getUTCDay();   // 0=일 … 3=수, 4=목
const kstDate = (t) => new Date(t + KST_OFFSET_MS).toISOString().slice(0, 10);

/** KST 달력일 집계 — bars 는 전체(경계 여유 포함), 세그먼트 귀속은 그 날 첫 봉 openTime */
function buildDays(bars) {
  const map = new Map();
  for (const b of bars) {
    const d = kstDate(b.t);
    if (!map.has(d)) map.set(d, []);
    map.get(d).push(b);
  }
  const days = [];
  for (const [date, dayBars] of map.entries()) {
    if (dayBars.length < MIN_BARS_PER_DAY) continue;
    dayBars.sort((a, b) => a.t - b.t);
    const firstT = dayBars[0].t;
    const ret = dayBars[dayBars.length - 1].c / dayBars[0].o - 1;
    days.push({ date, t: firstT, dow: kstDow(firstT), ret, up: ret > 0, nBars: dayBars.length });
  }
  return days.sort((a, b) => a.t - b.t);
}

/** 한 심볼×세그먼트의 전체 검정 */
function analyzeSegment(symbol, segment, segBars, segDays) {
  // ── 시간대별 상승률 ──
  const byHour = Array.from({ length: 24 }, () => ({ n: 0, up: 0, sumRet: 0 }));
  for (const b of segBars) {
    const h = kstHour(b.t);
    const cell = byHour[h];
    cell.n++;
    if (b.c > b.o) cell.up++;
    cell.sumRet += b.c / b.o - 1;
  }
  const hourly = byHour.map((c, h) => ({
    hour: h, n: c.n, upRate: c.n ? round4(c.up / c.n) : null,
    meanRetPct: c.n ? round4((c.sumRet / c.n) * 100) : null,
  }));

  // ── C1: 09시 상승 확률 최고 ──
  const c9 = byHour[CLAIM_HOUR_UP];
  const restN = byHour.reduce((s, c, h) => h === CLAIM_HOUR_UP ? s : s + c.n, 0);
  const restUp = byHour.reduce((s, c, h) => h === CLAIM_HOUR_UP ? s : s + c.up, 0);
  const p0c1 = restN ? restUp / restN : null;
  const rate9 = c9.n ? c9.up / c9.n : null;
  const rank9 = hourly.filter((x) => x.upRate != null && rate9 != null && x.upRate > rate9).length + 1;
  const c1 = {
    n: c9.n, up: c9.up, upRate: round4(rate9), baselineRate: round4(p0c1),
    rankAmong24: rate9 == null ? null : rank9,
    dirMatch: rate9 != null && p0c1 != null && rate9 > p0c1,
    pBinom: round6(binomTest(c9.n, c9.up, p0c1, "greater")),
  };
  // 순열(보고용): 시간 라벨 순열 후 09시 상승률 ≥ 관찰값 비율
  {
    const flags = segBars.map((b) => (b.c > b.o ? 1 : 0));
    const rng = mulberry32(PERM_SEED ^ strHash(`${symbol}|${segment}|C1`));
    let ge = 0;
    if (c9.n > 0 && rate9 != null) {
      for (let p = 0; p < PERM_N; p++) {
        shuffleInPlace(flags, rng);
        let s = 0;
        for (let i = 0; i < c9.n; i++) s += flags[i]; // 순열 후 임의 n개 = 가상 09시군
        if (s / c9.n >= rate9) ge++;
      }
      c1.pPerm = round6(ge / PERM_N);
    } else c1.pPerm = null;
  }

  // ── C2: 장대양봉(실체 상위 10%) 10시·15시 집중 ──
  const bulls = segBars.filter((b) => b.c > b.o).map((b) => ({ t: b.t, body: (b.c - b.o) / b.o }));
  bulls.sort((a, b) => b.body - a.body);
  const nBig = Math.floor(bulls.length * BIG_BODY_TOP_PCT);
  const bigBulls = bulls.slice(0, nBig);
  const bodyThreshold = nBig > 0 ? bulls[nBig - 1].body : null;
  const bigByHour = new Array(24).fill(0);
  for (const b of bigBulls) bigByHour[kstHour(b.t)]++;
  const mkC2 = (hour) => {
    const k = bigByHour[hour];
    const share = nBig ? k / nBig : null;
    return {
      hour, nBigBull: nBig, atHour: k, share: round4(share), expectedShare: round4(1 / 24),
      dirMatch: share != null && share > 1 / 24,
      pBinom: round6(binomTest(nBig, k, 1 / 24, "greater")),
    };
  };
  const c2a = mkC2(CLAIM_BIGBULL_HOURS[0]);
  const c2b = mkC2(CLAIM_BIGBULL_HOURS[1]);
  // 교란 점검(보고용): 장대음봉도 같은 시각에 몰리면 방향 엣지가 아니라 변동성 계절성
  const bears = segBars.filter((b) => b.c < b.o).map((b) => ({ t: b.t, body: (b.o - b.c) / b.o }));
  bears.sort((a, b) => b.body - a.body);
  const nBigBear = Math.floor(bears.length * BIG_BODY_TOP_PCT);
  const bigBearByHour = new Array(24).fill(0);
  for (const b of bears.slice(0, nBigBear)) bigBearByHour[kstHour(b.t)]++;
  const bigBearShare = (h) => (nBigBear ? round4(bigBearByHour[h] / nBigBear) : null);

  // ── C3: 수요일 상승 / 목요일 하락 ──
  const byDow = Array.from({ length: 7 }, () => ({ n: 0, up: 0, rets: [] }));
  for (const d of segDays) { const c = byDow[d.dow]; c.n++; if (d.up) c.up++; c.rets.push(d.ret); }
  const daily = byDow.map((c, dow) => ({
    dow, n: c.n, upRate: c.n ? round4(c.up / c.n) : null,
    meanRetPct: c.n ? round4(mean(c.rets) * 100) : null,
  }));
  const mkC3 = (dow, side) => {
    const cell = byDow[dow];
    const oN = byDow.reduce((s, c, i) => i === dow ? s : s + c.n, 0);
    const oUp = byDow.reduce((s, c, i) => i === dow ? s : s + c.up, 0);
    const p0 = oN ? oUp / oN : null;
    const rate = cell.n ? cell.up / cell.n : null;
    return {
      dow, n: cell.n, up: cell.up, upRate: round4(rate), baselineRate: round4(p0),
      meanRetPct: cell.n ? round4(mean(cell.rets) * 100) : null,
      dirMatch: rate != null && p0 != null && (side === "greater" ? rate > p0 : rate < p0),
      pBinom: round6(binomTest(cell.n, cell.up, p0, side)),
    };
  };
  const c3a = mkC3(CLAIM_DAY_UP, "greater");
  const c3b = mkC3(CLAIM_DAY_DOWN, "lesser");
  // 순열(보고용): 요일 라벨 순열 후 수 평균수익 ≥ / 목 평균수익 ≤ 관찰값 비율
  {
    const rets = segDays.map((d) => d.ret);
    const nWed = byDow[CLAIM_DAY_UP].n, nThu = byDow[CLAIM_DAY_DOWN].n;
    const obsWed = nWed ? mean(byDow[CLAIM_DAY_UP].rets) : null;
    const obsThu = nThu ? mean(byDow[CLAIM_DAY_DOWN].rets) : null;
    if (nWed > 0 && nThu > 0) {
      const rng = mulberry32(PERM_SEED ^ strHash(`${symbol}|${segment}|C3`));
      let geWed = 0, leThu = 0;
      for (let p = 0; p < PERM_N; p++) {
        shuffleInPlace(rets, rng);
        let sw = 0; for (let i = 0; i < nWed; i++) sw += rets[i];
        let st = 0; for (let i = nWed; i < nWed + nThu; i++) st += rets[i];
        if (sw / nWed >= obsWed) geWed++;
        if (st / nThu <= obsThu) leThu++;
      }
      c3a.pPerm = round6(geWed / PERM_N);
      c3b.pPerm = round6(leThu / PERM_N);
    } else { c3a.pPerm = null; c3b.pPerm = null; }
  }

  return {
    symbol, segment,
    bars: segBars.length, days: segDays.length,
    hourly, daily,
    bigBullThresholdPct: round4(bodyThreshold == null ? null : bodyThreshold * 100),
    bigBullByHour: bigByHour,
    bigBearShareAtClaimHours: {
      [`h${CLAIM_BIGBULL_HOURS[0]}`]: bigBearShare(CLAIM_BIGBULL_HOURS[0]),
      [`h${CLAIM_BIGBULL_HOURS[1]}`]: bigBearShare(CLAIM_BIGBULL_HOURS[1]),
    },
    tests: { C1: c1, C2a: c2a, C2b: c2b, C3a: c3a, C3b: c3b },
  };
}

// ════════════════════════════════════════════════════════════════════
// 메인
// ════════════════════════════════════════════════════════════════════

const CLAIM_IDS = ["C1", "C2a", "C2b", "C3a", "C3b"];
const CLAIM_DESC = {
  C1: `KST ${String(CLAIM_HOUR_UP).padStart(2, "0")}시 봉 상승 확률이 나머지 시간대보다 높다 (원 주장: 최고)`,
  C2a: `장대양봉(실체 상위 ${BIG_BODY_TOP_PCT * 100}%)이 KST ${CLAIM_BIGBULL_HOURS[0]}시에 과대 집중 (>1/24)`,
  C2b: `장대양봉(실체 상위 ${BIG_BODY_TOP_PCT * 100}%)이 KST ${CLAIM_BIGBULL_HOURS[1]}시에 과대 집중 (>1/24)`,
  C3a: "수요일(KST) 일봉 상승률이 비수요일보다 높다",
  C3b: "목요일(KST) 일봉 상승률이 비목요일보다 낮다 (하락 우위)",
};

async function main() {
  console.log("H5 시간대·요일 계절성 — 사전등록 통계 검정 시작");
  console.log(`기간: IS ${iso(IS_START)}~${iso(OOS_START)} / OOS ${iso(OOS_START)}~${iso(PERIOD_END)} (KST 기준 집계)`);
  console.log(`Bonferroni: ${M_TESTS}개 검정, 유의 기준 raw p < ${ALPHA / M_TESTS}`);

  const excluded = [];
  const perSegment = []; // symbol×segment 분석 결과

  for (const symbol of ALL_SYMBOLS) {
    let raw;
    try {
      raw = await fetchAllKlines(symbol, "1h");
    } catch (e) {
      excluded.push({ symbol, reason: `API 실패: ${String(e.message).slice(0, 120)}` });
      continue;
    }
    const bars = parseBars(raw).filter((b) => b.t < PERIOD_END);
    if (bars.length < 5000) {
      excluded.push({ symbol, reason: `캔들 부족 (${bars.length}봉)` });
      continue;
    }
    const allDays = buildDays(bars);
    for (const segment of ["IS", "OOS"]) {
      const lo = segment === "IS" ? IS_START : OOS_START;
      const hi = segment === "IS" ? OOS_START : PERIOD_END;
      const segBars = bars.filter((b) => b.t >= lo && b.t < hi);
      const segDays = allDays.filter((d) => d.t >= lo && d.t < hi);
      perSegment.push(analyzeSegment(symbol, segment, segBars, segDays));
    }
    const last = perSegment[perSegment.length - 1];
    console.log(`${symbol}: IS ${perSegment[perSegment.length - 2].bars}봉/${perSegment[perSegment.length - 2].days}일, OOS ${last.bars}봉/${last.days}일`);
  }

  const seg = (symbol, segment) => perSegment.find((s) => s.symbol === symbol && s.segment === segment);
  const availableCrossval = CROSSVAL_SYMBOLS.filter((s) => seg(s, "IS"));

  // ── 판정 (사전등록 룰) ──
  const bonferroniP = ALPHA / M_TESTS;
  const judgments = {};
  for (const cid of CLAIM_IDS) {
    const isSig = INSAMPLE_SYMBOLS.map((sym) => {
      const t = seg(sym, "IS")?.tests[cid];
      return { symbol: sym, dirMatch: !!t?.dirMatch, pBinom: t?.pBinom ?? null,
        sig: !!t?.dirMatch && t?.pBinom != null && t.pBinom < bonferroniP };
    });
    const oosDir = INSAMPLE_SYMBOLS.map((sym) => {
      const t = seg(sym, "OOS")?.tests[cid];
      return { symbol: sym, dirMatch: !!t?.dirMatch, pBinom: t?.pBinom ?? null };
    });
    const cvIS = availableCrossval.map((sym) => ({ symbol: sym, dirMatch: !!seg(sym, "IS")?.tests[cid]?.dirMatch }));
    const cvOOS = availableCrossval.map((sym) => ({ symbol: sym, dirMatch: !!seg(sym, "OOS")?.tests[cid]?.dirMatch }));
    const cvISAgree = cvIS.filter((x) => x.dirMatch).length;
    const cvOOSAgree = cvOOS.filter((x) => x.dirMatch).length;
    const passIS = isSig.every((x) => x.sig);
    const passOOSDir = oosDir.every((x) => x.dirMatch) && cvOOSAgree >= CROSSVAL_MIN_AGREE;
    const passCvIS = cvISAgree >= CROSSVAL_MIN_AGREE;
    judgments[cid] = {
      claim: CLAIM_DESC[cid],
      insampleIS: isSig, insampleOOS: oosDir,
      crossvalISAgree: `${cvISAgree}/${availableCrossval.length}`,
      crossvalOOSAgree: `${cvOOSAgree}/${availableCrossval.length}`,
      passIS_significance: passIS,
      passOOS_direction: passOOSDir,
      passCrossvalIS_direction: passCvIS,
      supported: passIS && passOOSDir && passCvIS,
    };
  }
  const supportedClaims = CLAIM_IDS.filter((c) => judgments[c].supported);
  const passOOS = supportedClaims.length > 0;

  const results = {
    hypothesis: "H5 — KST 시간대·요일 계절성: ①09시 상승 확률 최고 ②장대양봉 10시·15시 집중 ③수요일 상승·목요일 하락 우위",
    source: "docs/research/veyric-ta-methodology-2026-08.json hypotheses[4]",
    methodNote: "백테스트 아님 — 이항(1차·판정)+순열(2차·보고) 통계 검정, Bonferroni 5건 보정",
    preregistered: {
      claims: CLAIM_DESC,
      bigBodyTopPct: BIG_BODY_TOP_PCT,
      alpha: ALPHA, mTests: M_TESTS, bonferroniRawP: bonferroniP,
      permutations: PERM_N, permSeed: PERM_SEED,
      insampleSymbols: INSAMPLE_SYMBOLS, crossvalSymbols: CROSSVAL_SYMBOLS,
      period: { isStart: iso(IS_START), oosStart: iso(OOS_START), end: iso(PERIOD_END) },
      timezone: "KST(UTC+9) — 봉 openTime 기준, 일수익=KST 달력일 첫시가→끝종가, 20봉 미만 일 제외",
      binomBaselines: "C1·C3: 관찰군 제외 나머지 풀링 상승률 / C2: 균등 1/24",
      passRule: `주장별: IS에서 BTC·ETH 모두 방향일치+raw p<${bonferroniP} AND OOS 방향일치(BTC·ETH 모두 + 교차 ≥${CROSSVAL_MIN_AGREE}/6) AND 교차 IS ≥${CROSSVAL_MIN_AGREE}/6. passOOS = 1개 이상 SUPPORTED`,
      feesNote: "통계 검정으로 수수료·슬리피지 미적용 — 트레이드 시뮬레이션 없음",
    },
    generatedAt: new Date().toISOString(),
    excluded,
    judgments,
    supportedClaims,
    passOOS,
    perSegment,
  };

  writeFileSync(OUT_PATH, JSON.stringify(results, null, 2));
  console.log(`\n결과 저장: ${OUT_PATH}`);
  for (const cid of CLAIM_IDS) {
    const j = judgments[cid];
    console.log(`${cid}: supported=${j.supported} (IS유의=${j.passIS_significance}, OOS방향=${j.passOOS_direction}, 교차IS=${j.passCrossvalIS_direction}) — ${j.claim}`);
  }
  console.log(`passOOS=${passOOS} (지지 주장: ${supportedClaims.join(", ") || "없음"})`);
}

function iso(ms) { return new Date(ms).toISOString().slice(0, 10); }

main().catch((e) => { console.error("실행 실패:", e); process.exit(1); });
