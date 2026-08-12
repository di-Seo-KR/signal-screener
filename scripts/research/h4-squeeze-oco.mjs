// ════════════════════════════════════════════════════════════════════
// H4 검증 — 변동성 수축 양방향 OCO (사전등록 백테스트, 2026-08-12)
// ────────────────────────────────────────────────────────────────────
// 출처 가설: docs/research/veyric-ta-methodology-2026-08.json hypotheses[3]
//   "BB밴드폭 백분위 ≤ p10 이 M봉 지속 → 박스 상단/하단 양방향 스탑 OCO"
//
// 리서치 전용 스크립트 — 라이브 코드·매매 경로와 완전 분리.
// 실행: node scripts/research/h4-squeeze-oco.mjs
// 산출: scripts/research/h4-results.json
//
// ★★★ 사전등록 파라미터 (아래 상수 외 사후 튜닝 금지) ★★★
// ════════════════════════════════════════════════════════════════════

// ── 그리드 (유일한 자유도 — 대표 지시서 명시 그리드) ──
const M_GRID = [3, 6];                    // 수축 지속 봉 수
const BUFFER_GRID = [0.001, 0.0025];      // 돌파 버퍼 0.1% / 0.25%

// ── 고정 파라미터 (그리드 아님 — 변경 금지) ──
const TF = "1h";            // 타임프레임 (지시서: 1h 단일)
const BB_PERIOD = 20;       // 볼린저 기간
const BB_MULT = 2;          // 볼린저 표준편차 배수
const PCT_WINDOW = 20;      // 밴드폭 롤링 백분위 창 (현재봉 제외 직전 20봉)
const SQUEEZE_P = 0.10;     // 수축 판정: 백분위 랭크 ≤ p10
const RECOVER_P = 0.50;     // 무효(철회) 판정: 미체결 중 백분위 랭크 > p50
const ATR_PERIOD = 14;      // Wilder ATR(14) — 발주봉 기준으로 SL/TP 고정
const SL_ATR_MULT = 1;      // 손절 = 진입가 ∓ 1×ATR
const TP_ATR_MULT = 2;      // 익절 = 진입가 ± 2×ATR
const TIME_STOP_BARS = 24;  // 진입 후 24봉 경과 시 종가 청산
const MAX_PENDING_BARS = 24; // 미체결 주문 유효기간 (운영 규약 — 양군 공통, 하단 주석 참조)

// ── 판정 임계 (사전등록) ──
const MIN_SQ_TRADES = 30;   // 수축군 IS+OOS 합계 체결 수 미달 시 유의성 미달로 자동 기각
const INFO_FEE_RT = 0.001;  // 참고용 왕복 비용 0.1% (판정에 미사용 — 정보 제공만)

// ── 심볼 (사전등록) ──
const INSAMPLE_SYMBOLS = ["BTCUSDT", "ETHUSDT"];
const CROSSVAL_SYMBOLS = ["SOLUSDT", "XRPUSDT", "BNBUSDT", "DOGEUSDT", "ADAUSDT", "LINKUSDT"];
const ALL_SYMBOLS = [...INSAMPLE_SYMBOLS, ...CROSSVAL_SYMBOLS];

// ── 기간 (사전등록, 고정 타임스탬프 — H2/H3 와 동일, 재실행 재현성) ──
// 최근 18개월 = 인샘플 12개월 + OOS 6개월. 홀드아웃(2026-08-12 이후 데이터)은 소진하지 않음.
const IS_START = Date.parse("2025-02-12T00:00:00Z");
const OOS_START = Date.parse("2026-02-12T00:00:00Z");
const PERIOD_END = Date.parse("2026-08-12T00:00:00Z");
const WARMUP_MS = 40 * 24 * 3600 * 1000; // 지표 워밍업 40일

// ── 규약 상세 (사전등록 — 결과 본 뒤 변경 금지) ──
// [수축 정의] 밴드폭 bw = (상단−하단)/중심선 = 4σ/SMA20. 백분위 랭크 r(i) =
//   직전 PCT_WINDOW봉(현재봉 제외) 중 bw < bw(i) 인 봉의 비율. r ≤ 0.10 이 M봉 연속이면 수축 확정.
// [발주] 수축 확정봉 i 종가 시점에 OCO 발주. 박스 = 최근 M봉(수축 구간)의 최고가/최저가.
//   롱스탑 = 박스상단×(1+버퍼), 숏스탑 = 박스하단×(1−버퍼). 수축 런당 1회만 발주
//   (r > p10 으로 런이 깨진 뒤 다시 M봉 충족해야 재발주). SL/TP 는 발주봉 ATR(14)로 고정.
// [체결] 발주 익봉부터. 갭(시가가 스탑 관통) 시 시가 체결, 아니면 스탑가 체결.
//   한 봉에서 양쪽 스탑 모두 도달 시 시가에서 가까운 쪽이 먼저 체결된 것으로 간주(ambiguous 카운트).
// [철회] 미체결 중 봉 마감 r > 0.50 → 양쪽 철회(원 가설 규격). 추가로 발주 후
//   MAX_PENDING_BARS봉 경과 시 철회 — 원 가설에 없는 운영 규약이나, 비교군에 철회 규칙이
//   없으면 무한 대기 주문이 생겨 비교가 불가능해 양군 공통으로 부여. caveat 에 명기.
// [청산] 진입봉 내 보수 규약: SL 우선(진입봉의 반대편 극값이 SL 관통 시 SL 체결로 간주,
//   같은 봉 TP 는 SL 미관통 시에만 인정). 이후 봉도 SL 우선, 갭은 시가 체결.
//   진입 후 TIME_STOP_BARS봉 종가 타임스톱.
// [비교 기준] 무필터 랜덤이 아닌 "수축 무관 동일 박스 돌파": 모든 적격봉(지표 유효)에서
//   동일 M봉 박스·동일 버퍼·동일 SL/TP/타임스톱 OCO 를 발주하는 기준군. 철회는
//   MAX_PENDING_BARS 만 적용(수축 상태 기반 p50 철회는 수축 기법 고유 규칙이므로 제외).
//   수축 조건의 순수 기여 = 수축군 성과 − 기준군 성과.
// [평가] 각 셋업 독립 평가(중복 허용 — H2 규약 준용). 기준군은 매 봉 발주라 셋업 간
//   중첩 상관 큼 → t 검정은 근사치로만 해석(caveat).
// [귀속] 세그먼트 귀속은 발주봉 openTime 기준. 데이터 말단에서 미완결 셋업은 스킵 카운트.
// [비용] 수수료·슬리피지·펀딩비 미적용 — 양군 동일 규약이라 상대 비교에는 영향 없음.
//   참고용으로 왕복 0.1% 차감 시 지표를 별도 산출(판정 미사용).

// ════════════════════════════════════════════════════════════════════
// 데이터 수집 — 바이낸스 선물 klines (H2 스크립트와 동일 패턴, 캐시 공유)
// ════════════════════════════════════════════════════════════════════

import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = join(__dirname, "h4-results.json");

const CACHE_DIR = process.env.ZEPTA_H4_CACHE
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

// ════════════════════════════════════════════════════════════════════
// 지표
// ════════════════════════════════════════════════════════════════════

function parseBars(raw) {
  return raw.map((k) => ({
    t: Number(k[0]),
    o: Number(k[1]), h: Number(k[2]), l: Number(k[3]), c: Number(k[4]),
    v: Number(k[5]),
  }));
}

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

/** BB(20,2) 밴드폭 = 4σ/SMA (모집단 σ). 앞 BB_PERIOD-1 봉은 null */
function bbWidth(bars) {
  const bw = new Array(bars.length).fill(null);
  for (let i = BB_PERIOD - 1; i < bars.length; i++) {
    let sum = 0;
    for (let j = i - BB_PERIOD + 1; j <= i; j++) sum += bars[j].c;
    const mean = sum / BB_PERIOD;
    let ss = 0;
    for (let j = i - BB_PERIOD + 1; j <= i; j++) ss += (bars[j].c - mean) ** 2;
    const sd = Math.sqrt(ss / BB_PERIOD);
    bw[i] = mean > 1e-12 ? (2 * BB_MULT * sd) / mean : null;
  }
  return bw;
}

/** 밴드폭 백분위 랭크: 직전 PCT_WINDOW봉(현재봉 제외) 중 bw < bw(i) 비율 */
function bwRank(bw) {
  const rank = new Array(bw.length).fill(null);
  for (let i = 0; i < bw.length; i++) {
    if (bw[i] == null) continue;
    let cnt = 0, valid = 0;
    for (let j = i - PCT_WINDOW; j < i; j++) {
      if (j < 0 || bw[j] == null) { valid = -1; break; }
      valid++;
      if (bw[j] < bw[i]) cnt++;
    }
    if (valid === PCT_WINDOW) rank[i] = cnt / PCT_WINDOW;
  }
  return rank;
}

// ════════════════════════════════════════════════════════════════════
// 셋업 시뮬레이션 (OCO 발주 → 체결/철회 → SL/TP/타임스톱)
// ════════════════════════════════════════════════════════════════════

/**
 * 발주봉 i 에서 OCO 셋업 1건 시뮬레이션.
 * useP50Cancel: 수축군만 true (미체결 중 r > p50 철회 — 원 가설 규격).
 * 반환: {outcome: "trade"|"cancelRecover"|"cancelTime"|"dataEnd"|"invalid", trade?}
 */
function simulateSetup(bars, rank, atr, i, M, buffer, useP50Cancel) {
  const a = atr[i];
  if (a == null || !(a > 0) || i - M + 1 < 0) return { outcome: "invalid" };
  let boxTop = -Infinity, boxBot = Infinity;
  for (let j = i - M + 1; j <= i; j++) {
    if (bars[j].h > boxTop) boxTop = bars[j].h;
    if (bars[j].l < boxBot) boxBot = bars[j].l;
  }
  const longStop = boxTop * (1 + buffer);
  const shortStop = boxBot * (1 - buffer);

  // ── 체결 대기 루프 ──
  let entryIdx = -1, dir = 0, entry = null, ambiguous = false;
  for (let j = i + 1; j <= i + MAX_PENDING_BARS; j++) {
    if (j >= bars.length) return { outcome: "dataEnd" };
    const b = bars[j];
    if (b.o >= longStop) { entryIdx = j; dir = 1; entry = b.o; break; }
    if (b.o <= shortStop) { entryIdx = j; dir = -1; entry = b.o; break; }
    const hitLong = b.h >= longStop;
    const hitShort = b.l <= shortStop;
    if (hitLong && hitShort) {
      // 양쪽 동시 도달 — 시가에서 가까운 쪽이 먼저 체결된 것으로 간주
      ambiguous = true;
      if (longStop - b.o <= b.o - shortStop) { entryIdx = j; dir = 1; entry = longStop; }
      else { entryIdx = j; dir = -1; entry = shortStop; }
      break;
    }
    if (hitLong) { entryIdx = j; dir = 1; entry = longStop; break; }
    if (hitShort) { entryIdx = j; dir = -1; entry = shortStop; break; }
    // 미체결 봉 마감 — 철회 판정
    if (useP50Cancel && rank[j] != null && rank[j] > RECOVER_P) return { outcome: "cancelRecover" };
  }
  if (entryIdx < 0) return { outcome: "cancelTime" };

  // ── 포지션 관리 ──
  const sl = entry - dir * SL_ATR_MULT * a;
  const tp = entry + dir * TP_ATR_MULT * a;
  let exit = null, exitType = null;

  // 진입봉 내 보수 규약: SL 우선
  {
    const b = bars[entryIdx];
    if (dir === 1) {
      if (b.l <= sl) { exit = sl; exitType = "stop-samebar"; }
      else if (b.h >= tp) { exit = tp; exitType = "tp-samebar"; }
    } else {
      if (b.h >= sl) { exit = sl; exitType = "stop-samebar"; }
      else if (b.l <= tp) { exit = tp; exitType = "tp-samebar"; }
    }
  }
  if (exit == null) {
    const lastIdx = entryIdx + TIME_STOP_BARS;
    if (lastIdx >= bars.length) return { outcome: "dataEnd" };
    for (let j = entryIdx + 1; j <= lastIdx; j++) {
      const b = bars[j];
      if (dir === 1) {
        if (b.o <= sl) { exit = b.o; exitType = "stop-gap"; break; }
        if (b.l <= sl) { exit = sl; exitType = "stop"; break; }
        if (b.o >= tp) { exit = b.o; exitType = "tp-gap"; break; }
        if (b.h >= tp) { exit = tp; exitType = "tp"; break; }
      } else {
        if (b.o >= sl) { exit = b.o; exitType = "stop-gap"; break; }
        if (b.h >= sl) { exit = sl; exitType = "stop"; break; }
        if (b.o <= tp) { exit = b.o; exitType = "tp-gap"; break; }
        if (b.l <= tp) { exit = tp; exitType = "tp"; break; }
      }
      if (j === lastIdx) { exit = b.c; exitType = "time"; }
    }
  }
  const ret = dir * (exit / entry - 1);
  return {
    outcome: "trade",
    trade: { armT: bars[i].t, entryT: bars[entryIdx].t, waitBars: entryIdx - i, dir, entry, exit, exitType, ret, ambiguous },
  };
}

// ════════════════════════════════════════════════════════════════════
// 발주봉 탐지
// ════════════════════════════════════════════════════════════════════

/** 수축군: r ≤ p10 이 M봉 연속 최초 충족 시 발주. 런당 1회. */
function squeezeArmBars(rank, M) {
  const arms = [];
  let run = 0, armed = false;
  for (let i = 0; i < rank.length; i++) {
    if (rank[i] != null && rank[i] <= SQUEEZE_P) {
      run++;
      if (run >= M && !armed) { arms.push(i); armed = true; }
    } else {
      run = 0; armed = false;
    }
  }
  return arms;
}

/** 기준군: 수축 무관 — 지표 유효(rank·atr) 봉 전부 발주 (동일 봉 유니버스 보장 위해 rank 유효 요구) */
function baselineArmBars(rank, atr, M) {
  const arms = [];
  for (let i = M - 1; i < rank.length; i++) {
    if (rank[i] != null && atr[i] != null && atr[i] > 0) arms.push(i);
  }
  return arms;
}

// ════════════════════════════════════════════════════════════════════
// 집계 + 통계
// ════════════════════════════════════════════════════════════════════

function metrics(trades, feeRt = 0) {
  const n = trades.length;
  if (n === 0) return { trades: 0, winRate: null, avgRetPct: null, medianRetPct: null, pf: null, maxConsecLosses: null };
  const rets = trades.map((t) => t.ret - feeRt);
  const wins = rets.filter((r) => r > 0);
  const grossP = wins.reduce((s, r) => s + r, 0);
  const grossL = rets.filter((r) => r < 0).reduce((s, r) => s - r, 0);
  const sorted = [...rets].sort((a, b) => a - b);
  const med = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  // 최대 연속 손절 (발주 시각순 — validationPlan 의 등재 조건 모니터링 항목)
  const byTime = [...trades].sort((a, b) => a.armT - b.armT);
  let maxLoss = 0, cur = 0;
  for (const t of byTime) {
    if (t.ret - feeRt < 0) { cur++; if (cur > maxLoss) maxLoss = cur; }
    else cur = 0;
  }
  return {
    trades: n,
    winRate: round4(wins.length / n),
    avgRetPct: round4((rets.reduce((s, r) => s + r, 0) / n) * 100),
    medianRetPct: round4(med * 100),
    pf: grossL > 1e-12 ? round4(grossP / grossL) : (grossP > 0 ? null : 0),
    maxConsecLosses: maxLoss,
  };
}

function round4(x) { return x == null ? null : Math.round(x * 1e4) / 1e4; }

/** Welch t (정규 근사 p) — 수축군 vs 기준군. 기준군 중첩 상관으로 근사치로만 해석 */
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
  console.log("H4 변동성 수축 양방향 OCO — 사전등록 검증 시작");
  console.log(`기간: IS ${iso(IS_START)}~${iso(OOS_START)} / OOS ${iso(OOS_START)}~${iso(PERIOD_END)} / TF ${TF}`);

  const excluded = [];
  const perCell = [];
  // 풀링: key = `${M}|${buffer}|${segment}|${group}` → {sq:[], base:[], sqStats, baseStats}
  const pool = new Map();
  const poolGet = (M, buffer, segment, group) => {
    const key = `${M}|${buffer}|${segment}|${group}`;
    if (!pool.has(key)) {
      pool.set(key, {
        sq: [], base: [],
        sqSetups: 0, sqCancelRecover: 0, sqCancelTime: 0, sqDataEnd: 0, sqAmbiguous: 0,
        baseSetups: 0, baseCancelTime: 0, baseDataEnd: 0, baseAmbiguous: 0,
      });
    }
    return pool.get(key);
  };

  for (const symbol of ALL_SYMBOLS) {
    const group = INSAMPLE_SYMBOLS.includes(symbol) ? "insample" : "crossval";
    let raw;
    try {
      raw = await fetchAllKlines(symbol, TF);
    } catch (e) {
      excluded.push({ symbol, tf: TF, reason: `API 실패: ${String(e.message).slice(0, 120)}` });
      continue;
    }
    const bars = parseBars(raw);
    const isStartIdx = bars.findIndex((b) => b.t >= IS_START);
    if (isStartIdx < Math.max(BB_PERIOD + PCT_WINDOW, ATR_PERIOD + 1) || bars.length < 1000) {
      excluded.push({ symbol, tf: TF, reason: `캔들 부족 (총 ${bars.length}봉, IS 이전 ${isStartIdx}봉)` });
      continue;
    }
    const atr = wilderATR(bars, ATR_PERIOD);
    const bw = bbWidth(bars);
    const rank = bwRank(bw);

    for (const M of M_GRID) {
      const sqArmsAll = squeezeArmBars(rank, M)
        .filter((i) => bars[i].t >= IS_START && bars[i].t < PERIOD_END);
      const baseArmsAll = baselineArmBars(rank, atr, M)
        .filter((i) => bars[i].t >= IS_START && bars[i].t < PERIOD_END);

      for (const buffer of BUFFER_GRID) {
        const cellStats = {}; // segment → 집계
        for (const segment of ["IS", "OOS"]) {
          const inSeg = (i) => segment === "IS"
            ? bars[i].t < OOS_START : bars[i].t >= OOS_START;
          const bucket = poolGet(M, buffer, segment, group);
          const bucketAll = poolGet(M, buffer, segment, "all");

          const runArm = (armIdx, useP50, trades, tagPrefix, b1, b2) => {
            let cancelRecover = 0, cancelTime = 0, dataEnd = 0, ambiguous = 0, invalid = 0;
            for (const i of armIdx) {
              const r = simulateSetup(bars, rank, atr, i, M, buffer, useP50);
              if (r.outcome === "trade") {
                trades.push(r.trade);
                if (r.trade.ambiguous) ambiguous++;
              } else if (r.outcome === "cancelRecover") cancelRecover++;
              else if (r.outcome === "cancelTime") cancelTime++;
              else if (r.outcome === "dataEnd") dataEnd++;
              else invalid++;
            }
            return { setups: armIdx.length, cancelRecover, cancelTime, dataEnd, ambiguous, invalid };
          };

          const sqArms = sqArmsAll.filter(inSeg);
          const baseArms = baseArmsAll.filter(inSeg);
          const sqTrades = [], baseTrades = [];
          const sqStat = runArm(sqArms, true, sqTrades);
          const baseStat = runArm(baseArms, false, baseTrades);

          bucket.sq.push(...sqTrades); bucket.base.push(...baseTrades);
          bucketAll.sq.push(...sqTrades); bucketAll.base.push(...baseTrades);
          for (const [b, st] of [[bucket, sqStat], [bucketAll, sqStat]]) {
            b.sqSetups += st.setups; b.sqCancelRecover += st.cancelRecover;
            b.sqCancelTime += st.cancelTime; b.sqDataEnd += st.dataEnd; b.sqAmbiguous += st.ambiguous;
          }
          for (const [b, st] of [[bucket, baseStat], [bucketAll, baseStat]]) {
            b.baseSetups += st.setups; b.baseCancelTime += st.cancelTime;
            b.baseDataEnd += st.dataEnd; b.baseAmbiguous += st.ambiguous;
          }

          cellStats[segment] = {
            squeeze: { ...sqStat, ...metrics(sqTrades) },
            baseline: { setups: baseStat.setups, cancelTime: baseStat.cancelTime, dataEnd: baseStat.dataEnd, ambiguous: baseStat.ambiguous, ...metrics(baseTrades) },
          };
        }
        perCell.push({ symbol, M, buffer, IS: cellStats.IS, OOS: cellStats.OOS });
      }
    }
    console.log(`${symbol}: ${bars.length}봉 처리 완료`);
  }

  // ── 풀링 집계 ──
  const pooled = [];
  for (const [key, b] of pool.entries()) {
    const [M, buffer, segment, group] = key.split("|");
    pooled.push({
      M: Number(M), buffer: Number(buffer), segment, group,
      squeeze: {
        setups: b.sqSetups, cancelRecover: b.sqCancelRecover, cancelTime: b.sqCancelTime,
        dataEnd: b.sqDataEnd, ambiguous: b.sqAmbiguous,
        fillRate: b.sqSetups > 0 ? round4(b.sq.length / b.sqSetups) : null,
        ...metrics(b.sq),
        feeStress: metrics(b.sq, INFO_FEE_RT),
      },
      baseline: {
        setups: b.baseSetups, cancelTime: b.baseCancelTime,
        dataEnd: b.baseDataEnd, ambiguous: b.baseAmbiguous,
        fillRate: b.baseSetups > 0 ? round4(b.base.length / b.baseSetups) : null,
        ...metrics(b.base),
        feeStress: metrics(b.base, INFO_FEE_RT),
      },
      squeezeVsBaseline: welchT(b.sq.map((t) => t.ret), b.base.map((t) => t.ret)),
    });
  }

  // ── bestCell 선정 (사전등록 룰: IS·insample(BTC+ETH) 풀링에서 PF_수축 − PF_기준 최대) ──
  const cellScores = [];
  for (const M of M_GRID) {
    for (const buffer of BUFFER_GRID) {
      const cell = pooled.find((p) => p.M === M && p.buffer === buffer && p.segment === "IS" && p.group === "insample");
      const valid = cell && cell.squeeze.pf != null && cell.baseline.pf != null;
      cellScores.push({
        M, buffer,
        score: valid ? round4(cell.squeeze.pf - cell.baseline.pf) : null,
        sqPF_IS: cell?.squeeze.pf ?? null, basePF_IS: cell?.baseline.pf ?? null,
        sqTrades_IS: cell?.squeeze.trades ?? 0,
      });
    }
  }
  let bestCell = null; let bestScore = -Infinity;
  for (const cs of cellScores) {
    if (cs.score != null && cs.score > bestScore) { bestScore = cs.score; bestCell = { M: cs.M, buffer: cs.buffer }; }
  }

  // ── passOOS 판정 (사전등록 룰) ──
  // (1) OOS·전심볼 풀링에서 PF_수축 > PF_기준 (수축 조건의 순수 기여가 OOS 에서도 양수)
  // (2) 동일 셀 PF_수축 > 1.0 (전략 자체가 수수료 미적용 기준 수익)
  // (3) 수축군 체결 수 IS+OOS(전심볼) ≥ MIN_SQ_TRADES
  let passOOS = false;
  let oosDetail = null;
  if (bestCell != null) {
    const oosCell = pooled.find((p) => p.M === bestCell.M && p.buffer === bestCell.buffer && p.segment === "OOS" && p.group === "all");
    const isCell = pooled.find((p) => p.M === bestCell.M && p.buffer === bestCell.buffer && p.segment === "IS" && p.group === "all");
    const sqTradesTotal = (oosCell?.squeeze.trades ?? 0) + (isCell?.squeeze.trades ?? 0);
    const contribPositive = !!(oosCell && oosCell.squeeze.pf != null && oosCell.baseline.pf != null
      && oosCell.squeeze.pf > oosCell.baseline.pf);
    const profitable = !!(oosCell && oosCell.squeeze.pf != null && oosCell.squeeze.pf > 1.0);
    passOOS = contribPositive && profitable && sqTradesTotal >= MIN_SQ_TRADES;
    oosDetail = {
      contribPositive, profitable, sqTradesTotal, minRequired: MIN_SQ_TRADES,
      oosSqueezePF: oosCell?.squeeze.pf ?? null, oosBaselinePF: oosCell?.baseline.pf ?? null,
      oosSqueezeAvgRetPct: oosCell?.squeeze.avgRetPct ?? null,
      oosBaselineAvgRetPct: oosCell?.baseline.avgRetPct ?? null,
      oosSqueezeMaxConsecLosses: oosCell?.squeeze.maxConsecLosses ?? null,
      oosFeeStressSqueezePF: oosCell?.squeeze.feeStress?.pf ?? null,
    };
  }

  const results = {
    hypothesis: "H4 — BB(20,2) 밴드폭 20봉 백분위 ≤ p10 이 M봉 지속(수축) 후 박스 상단/하단 OCO 돌파 진입이 '수축 무관 동일 박스 돌파' 대비 성과 우위",
    source: "docs/research/veyric-ta-methodology-2026-08.json hypotheses[3]",
    preregistered: {
      mGrid: M_GRID, bufferGrid: BUFFER_GRID, tf: TF,
      bbPeriod: BB_PERIOD, bbMult: BB_MULT, pctWindow: PCT_WINDOW,
      squeezeP: SQUEEZE_P, recoverP: RECOVER_P,
      atrPeriod: ATR_PERIOD, slAtrMult: SL_ATR_MULT, tpAtrMult: TP_ATR_MULT,
      timeStopBars: TIME_STOP_BARS, maxPendingBars: MAX_PENDING_BARS,
      insampleSymbols: INSAMPLE_SYMBOLS, crossvalSymbols: CROSSVAL_SYMBOLS,
      period: { isStart: iso(IS_START), oosStart: iso(OOS_START), end: iso(PERIOD_END) },
      bestCellRule: "IS·insample(BTC+ETH) 풀링 (PF_수축 − PF_기준) 최대 셀",
      passOOSRule: `OOS·전심볼 풀링 PF_수축 > PF_기준 AND PF_수축 > 1.0 AND 수축군 체결 IS+OOS ≥ ${MIN_SQ_TRADES}`,
      entryExit: "OCO 스탑 진입(갭=시가), 진입봉 SL 우선 보수 규약, SL=1×ATR(발주봉)·TP=2×ATR·24봉 타임스톱, 수수료 미적용(참고용 왕복 0.1% 별도 산출), 셋업 독립 평가(중복 허용), 세그먼트 귀속=발주봉 openTime",
      baselineNote: "기준군 = 수축 무관 매 적격봉 동일 M봉 박스 OCO. 철회는 양군 공통 24봉 대기 상한, p50 회복 철회는 수축군 전용(원 가설 규격). 24봉 대기 상한은 원 가설에 없는 운영 규약(양군 공통 부여) — caveat.",
    },
    generatedAt: new Date().toISOString(),
    excluded,
    cellScoresIS: cellScores,
    bestCell,
    passOOS,
    oosDetail,
    pooled: pooled.sort((a, b) =>
      a.group.localeCompare(b.group) || a.M - b.M || a.buffer - b.buffer || a.segment.localeCompare(b.segment)),
    perSymbol: perCell,
  };

  writeFileSync(OUT_PATH, JSON.stringify(results, null, 2));
  console.log(`\n결과 저장: ${OUT_PATH}`);
  console.log(`제외: ${excluded.length}건, bestCell=${JSON.stringify(bestCell)}, passOOS=${passOOS}`);
  if (oosDetail) console.log("OOS 상세:", JSON.stringify(oosDetail));
}

function iso(ms) { return new Date(ms).toISOString().slice(0, 10); }

main().catch((e) => { console.error("실행 실패:", e); process.exit(1); });
