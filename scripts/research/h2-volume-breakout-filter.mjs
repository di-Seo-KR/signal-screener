// ════════════════════════════════════════════════════════════════════
// H2 검증 — 거래량 확인 돌파 필터 (사전등록 백테스트, 2026-08-12)
// ────────────────────────────────────────────────────────────────────
// 출처 가설: docs/research/veyric-ta-methodology-2026-08.json hypotheses[1]
//   "돌파 캔들 거래량 z-score ≥ k AND 양봉일 때만 발화 — 불충족 시 억제"
//
// 리서치 전용 스크립트 — 라이브 코드·매매 경로와 완전 분리.
// 실행: node scripts/research/h2-volume-breakout-filter.mjs
// 산출: scripts/research/h2-results.json
//
// ★★★ 사전등록 파라미터 (아래 상수 외 사후 튜닝 금지) ★★★
// ════════════════════════════════════════════════════════════════════

// ── 그리드 (유일한 자유도) ──
const K_GRID = [1.0, 1.5, 2.0];          // 거래량 z-score 임계
const TFS = ["1h", "4h"];                 // 타임프레임 2개

// ── 고정 파라미터 (그리드 아님 — 변경 금지) ──
const Z_WINDOW = 20;        // z-score 롤링창: 돌파 캔들 "직전" 20봉 (돌파봉 제외)
const BREAKOUT_LOOKBACK = 20; // 돌파 정의: 직전 20봉 최고가를 종가로 상향 돌파(롱) / 최저가 하향(숏) — 대칭
const EXIT_BARS = 24;       // 진입 후 24봉 경과 시 종가 청산
const ATR_PERIOD = 14;      // Wilder ATR(14)
const STOP_ATR_MULT = 2;    // 손절 = 진입가 ∓ 2×ATR(14)

// ── 심볼 (사전등록) ──
const INSAMPLE_SYMBOLS = ["BTCUSDT", "ETHUSDT"];
const CROSSVAL_SYMBOLS = ["SOLUSDT", "XRPUSDT", "BNBUSDT", "DOGEUSDT", "ADAUSDT", "LINKUSDT"];
const ALL_SYMBOLS = [...INSAMPLE_SYMBOLS, ...CROSSVAL_SYMBOLS];

// ── 기간 (사전등록, 고정 타임스탬프 — 재실행 재현성) ──
// 최근 18개월 = 인샘플 12개월 + OOS 6개월. 홀드아웃(2026-08-12 이후 데이터)은 소진하지 않음.
const IS_START = Date.parse("2025-02-12T00:00:00Z");
const OOS_START = Date.parse("2026-02-12T00:00:00Z");
const PERIOD_END = Date.parse("2026-08-12T00:00:00Z");
const WARMUP_MS = 40 * 24 * 3600 * 1000; // 지표 워밍업용 선행 데이터 (40일)

// ── 판정 룰 (사전등록 — 결과 본 뒤 변경 금지) ──
// bestK: 인샘플 심볼(BTC+ETH)×양 TF 풀링 IS 구간에서 (PF_on − PF_off) 최대인 k
// passOOS: bestK 로 전 심볼×양 TF 풀링 OOS 구간에서 PF_on > PF_off AND
//          억제군 평균수익 < 통과군 평균수익 (필터가 버린 것이 실제로 더 나빴는가)
// 단, ON 거래 수가 IS+OOS 합계 30건 미만이면 유의성 미달로 자동 기각(원 가설 risk 항목 반영)
const MIN_ON_TRADES = 30;

// ── 진입·청산 규약 (사전등록) ──
// 진입: 돌파 확정봉(신호봉)의 종가. 신호는 해당 봉 마감 데이터(종가·거래량)로만 계산 — 룩어헤드 없음.
// 손절 체크: 신호봉 다음 봉부터. 갭 이탈 시 시가 체결(보수적), 아니면 손절가 체결.
// 수수료·슬리피지: 미적용(총수익) — on/off 동일 규약이라 상대 비교에는 영향 없음. caveat 에 명시.
// 신호 독립 평가: 각 신호를 독립 트레이드로 평가(중복 허용). 포지션 순차 모델은 필터 on/off 간
//   타이밍 교란을 만들어 필터 효과 격리를 깨므로 채택하지 않음.
// 데이터 말단에서 EXIT_BARS 봉이 남지 않은 신호는 스킵(집계 제외, skipped 로 카운트).
// 세그먼트 귀속: 진입봉 openTime 기준 (IS 진입 트레이드의 청산이 OOS 초입을 스치는 것 허용 — caveat).

// ════════════════════════════════════════════════════════════════════
// 데이터 수집 — 바이낸스 선물 klines 직접 호출 (api/_shared/binance-client.js 의
// getKlines 직접 호출 패턴과 동일 — 로컬 실행은 프록시 불필요). 캐시: 스크래치패드.
// ════════════════════════════════════════════════════════════════════

import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = join(__dirname, "h2-results.json");

const CACHE_DIR = process.env.ZEPTA_H2_CACHE
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

/** 기간 전체 klines (페이지네이션 + 중복 제거 + 캐시). 실패 시 throw — 호출부에서 심볼 제외 처리 */
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
  // 진행 중(미마감) 봉 제거: closeTime 이 PERIOD_END 이후면 제외
  const closed = dedup.filter((k) => Number(k[6]) <= PERIOD_END);
  writeCache(key, closed);
  return closed;
}

// ════════════════════════════════════════════════════════════════════
// 지표
// ════════════════════════════════════════════════════════════════════

/** 원시 klines → 시계열 배열 {t, o, h, l, c, v} */
function parseBars(raw) {
  return raw.map((k) => ({
    t: Number(k[0]),
    o: Number(k[1]), h: Number(k[2]), l: Number(k[3]), c: Number(k[4]),
    v: Number(k[5]),
  }));
}

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

/** 거래량 z-score: 직전 Z_WINDOW 봉(현재봉 제외) 평균/표준편차 기준. std≈0 이면 z=0 */
function volumeZ(bars, i) {
  if (i < Z_WINDOW) return null;
  let sum = 0;
  for (let j = i - Z_WINDOW; j < i; j++) sum += bars[j].v;
  const mean = sum / Z_WINDOW;
  let ss = 0;
  for (let j = i - Z_WINDOW; j < i; j++) ss += (bars[j].v - mean) ** 2;
  const std = Math.sqrt(ss / Z_WINDOW);
  if (!(std > 1e-12)) return 0;
  return (bars[i].v - mean) / std;
}

// ════════════════════════════════════════════════════════════════════
// 신호 탐지 + 트레이드 시뮬레이션
// ════════════════════════════════════════════════════════════════════

/**
 * 돌파 신호 전수 탐지 (필터 무관 — off 유니버스).
 * 롱: close[i] > max(high[i-20..i-1]) AND close[i-1] <= 직전 기준 (신규 돌파만, 연속 중복 억제 아님 —
 *     "종가가 처음으로 그 레벨 위로 마감"을 신호로 정의. 직전 봉 종가가 이미 그 봉 기준 채널 위였으면 중복 제외)
 * 숏: 대칭.
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
    // 직전 봉 기준 채널 (연속 발화 중복 제거용)
    let phh = -Infinity, pll = Infinity;
    if (i - 1 >= BREAKOUT_LOOKBACK) {
      for (let j = i - 1 - BREAKOUT_LOOKBACK; j < i - 1; j++) {
        if (bars[j].h > phh) phh = bars[j].h;
        if (bars[j].l < pll) pll = bars[j].l;
      }
    }
    const prevInsideLong = i - 1 < BREAKOUT_LOOKBACK || bars[i - 1].c <= phh;
    const prevInsideShort = i - 1 < BREAKOUT_LOOKBACK || bars[i - 1].c >= pll;
    if (b.c > hh && prevInsideLong) signals.push({ i, dir: 1 });
    else if (b.c < ll && prevInsideShort) signals.push({ i, dir: -1 });
  }
  return signals;
}

/** 단일 신호 → 트레이드 결과. 청산 불가(말단) 시 null */
function simulateTrade(bars, atr, sig) {
  const { i, dir } = sig;
  if (i + EXIT_BARS >= bars.length) return null; // 말단 스킵
  const a = atr[i];
  if (a == null || !(a > 0)) return null;
  const entry = bars[i].c;
  const stop = entry - dir * STOP_ATR_MULT * a;
  let exit = null; let exitType = "time";
  for (let j = i + 1; j <= i + EXIT_BARS; j++) {
    const b = bars[j];
    if (dir === 1) {
      if (b.o <= stop) { exit = b.o; exitType = "stop-gap"; break; }
      if (b.l <= stop) { exit = stop; exitType = "stop"; break; }
    } else {
      if (b.o >= stop) { exit = b.o; exitType = "stop-gap"; break; }
      if (b.h >= stop) { exit = stop; exitType = "stop"; break; }
    }
    if (j === i + EXIT_BARS) { exit = b.c; exitType = "time"; }
  }
  const ret = dir * (exit / entry - 1);
  return { i, t: bars[i].t, dir, entry, exit, exitType, ret };
}

// ════════════════════════════════════════════════════════════════════
// 지표 집계 + 통계
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
    pf: grossL > 1e-12 ? round4(grossP / grossL) : (grossP > 0 ? null : 0), // 무손실 시 null(∞) — JSON 표현 한계
  };
}

function round4(x) { return x == null ? null : Math.round(x * 1e4) / 1e4; }

/** Welch t-test (정규 근사 p-value, 대표본 전제) — 억제군 vs 통과군 수익 차이 검정 */
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
  // 양측 p, 표준정규 근사
  const p = 2 * (1 - normCdf(Math.abs(t)));
  return { t: round4(t), pApprox: round4(p), n1, n2 };
}
function normCdf(x) {
  // Abramowitz-Stegun 근사
  const t = 1 / (1 + 0.2316419 * x);
  const d = 0.3989422804014327 * Math.exp(-x * x / 2);
  const p = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return 1 - p;
}

// ════════════════════════════════════════════════════════════════════
// 메인
// ════════════════════════════════════════════════════════════════════

async function main() {
  console.log("H2 거래량 확인 돌파 필터 — 사전등록 검증 시작");
  console.log(`기간: IS ${iso(IS_START)}~${iso(OOS_START)} / OOS ${iso(OOS_START)}~${iso(PERIOD_END)}`);

  const excluded = [];
  const perCell = []; // {symbol, tf, k, segment, off, on, suppressed}
  // 풀링용 트레이드 버킷: key = `${tf}|${k}|${segment}|${group}` → {off:[], on:[], suppressed:[]}
  const pool = new Map();
  const poolAdd = (tf, k, segment, group, kind, trades) => {
    for (const g of [group, "all"]) {
      const key = `${tf}|${k}|${segment}|${g}`;
      if (!pool.has(key)) pool.set(key, { off: [], on: [], suppressed: [] });
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
      // 캔들 충분성: 워밍업 이후 IS 시작 전 최소 Z_WINDOW+BREAKOUT_LOOKBACK 봉 필요
      const isStartIdx = bars.findIndex((b) => b.t >= IS_START);
      if (isStartIdx < Math.max(Z_WINDOW, BREAKOUT_LOOKBACK, ATR_PERIOD + 1) || bars.length < 500) {
        excluded.push({ symbol, tf, reason: `캔들 부족 (총 ${bars.length}봉, IS 이전 ${isStartIdx}봉)` });
        continue;
      }
      const atr = wilderATR(bars, ATR_PERIOD);
      const allSignals = detectSignals(bars);

      // 검증 기간 내 신호만 (진입봉 openTime 기준)
      const inPeriod = allSignals.filter((s) => bars[s.i].t >= IS_START && bars[s.i].t < PERIOD_END);
      let skipped = 0;
      const offTrades = [];
      for (const s of inPeriod) {
        const tr = simulateTrade(bars, atr, s);
        if (tr === null) { skipped++; continue; }
        tr.z = volumeZ(bars, s.i);
        const b = bars[s.i];
        tr.dirCandle = s.dir === 1 ? b.c > b.o : b.c < b.o; // 롱=양봉 / 숏=음봉 (대칭)
        offTrades.push(tr);
      }

      for (const k of K_GRID) {
        for (const segment of ["IS", "OOS"]) {
          const segTrades = offTrades.filter((t) =>
            segment === "IS" ? t.t < OOS_START : t.t >= OOS_START);
          const on = segTrades.filter((t) => t.z != null && t.z >= k && t.dirCandle);
          const suppressed = segTrades.filter((t) => !(t.z != null && t.z >= k && t.dirCandle));
          perCell.push({
            symbol, tf, k, segment,
            off: metrics(segTrades),
            on: metrics(on),
            suppressed: metrics(suppressed),
            skippedAtEdge: segment === "IS" ? skipped : undefined,
          });
          poolAdd(tf, k, segment, group, "off", segTrades);
          poolAdd(tf, k, segment, group, "on", on);
          poolAdd(tf, k, segment, group, "suppressed", suppressed);
        }
      }
      console.log(`${symbol} ${tf}: ${bars.length}봉, 신호 ${inPeriod.length}건 (말단 스킵 ${skipped})`);
    }
  }

  // ── 풀링 집계 ──
  const pooled = [];
  for (const [key, bucket] of pool.entries()) {
    const [tf, k, segment, group] = key.split("|");
    pooled.push({
      tf, k: Number(k), segment, group,
      off: metrics(bucket.off),
      on: metrics(bucket.on),
      suppressed: metrics(bucket.suppressed),
      suppressedVsOn: welchT(bucket.suppressed.map((t) => t.ret), bucket.on.map((t) => t.ret)),
    });
  }

  // ── bestK 선정 (사전등록 룰: IS 세그먼트, insample 그룹, 양 TF 합산 PF 개선폭 최대) ──
  const kScore = new Map();
  for (const k of K_GRID) {
    let score = 0; let valid = true;
    for (const tf of TFS) {
      const cell = pooled.find((p) => p.tf === tf && p.k === k && p.segment === "IS" && p.group === "insample");
      if (!cell || cell.on.pf == null || cell.off.pf == null) { valid = false; break; }
      score += cell.on.pf - cell.off.pf;
    }
    kScore.set(k, valid ? round4(score) : null);
  }
  let bestK = null; let bestScore = -Infinity;
  for (const [k, s] of kScore.entries()) {
    if (s != null && s > bestScore) { bestScore = s; bestK = k; }
  }

  // ── passOOS 판정 (사전등록 룰) ──
  let passOOS = false;
  let oosDetail = null;
  if (bestK != null) {
    const oosCells = TFS.map((tf) =>
      pooled.find((p) => p.tf === tf && p.k === bestK && p.segment === "OOS" && p.group === "all"));
    const isCells = TFS.map((tf) =>
      pooled.find((p) => p.tf === tf && p.k === bestK && p.segment === "IS" && p.group === "all"));
    const onTradesTotal = [...oosCells, ...isCells].reduce((s, c) => s + (c?.on.trades ?? 0), 0);
    const pfImproves = oosCells.every((c) => c && c.on.pf != null && c.off.pf != null && c.on.pf > c.off.pf);
    const suppressedWorse = oosCells.every((c) =>
      c && c.suppressed.avgRetPct != null && c.on.avgRetPct != null && c.suppressed.avgRetPct < c.on.avgRetPct);
    passOOS = pfImproves && suppressedWorse && onTradesTotal >= MIN_ON_TRADES;
    oosDetail = { pfImproves, suppressedWorse, onTradesTotal, minRequired: MIN_ON_TRADES };
  }

  const results = {
    hypothesis: "H2 — 돌파 시그널에 '돌파 캔들 거래량 z-score ≥ k AND 방향 일치 캔들(롱=양봉/숏=음봉)' 필터 부착 시 성과 개선",
    source: "docs/research/veyric-ta-methodology-2026-08.json hypotheses[1]",
    preregistered: {
      kGrid: K_GRID, zWindow: Z_WINDOW, timeframes: TFS,
      breakoutLookback: BREAKOUT_LOOKBACK, exitBars: EXIT_BARS,
      atrPeriod: ATR_PERIOD, stopAtrMult: STOP_ATR_MULT,
      insampleSymbols: INSAMPLE_SYMBOLS, crossvalSymbols: CROSSVAL_SYMBOLS,
      period: { isStart: iso(IS_START), oosStart: iso(OOS_START), end: iso(PERIOD_END) },
      bestKRule: "IS·insample(BTC+ETH)·양TF 합산 (PF_on − PF_off) 최대 k",
      passOOSRule: `OOS·전심볼·양TF 모두 PF_on > PF_off AND 억제군 평균수익 < 통과군 AND ON 거래수 ≥ ${MIN_ON_TRADES}`,
      entryExit: "진입=돌파 확정봉 종가, 손절 체크는 익봉부터(갭=시가 체결), 24봉 후 종가 청산, 수수료 미적용, 신호 독립 평가(중복 허용)",
    },
    generatedAt: new Date().toISOString(),
    excluded,
    kScoreIS: Object.fromEntries([...kScore.entries()].map(([k, v]) => [String(k), v])),
    bestK,
    passOOS,
    oosDetail,
    pooled: pooled.sort((a, b) =>
      a.group.localeCompare(b.group) || a.tf.localeCompare(b.tf) || a.k - b.k || a.segment.localeCompare(b.segment)),
    perSymbol: perCell,
  };

  writeFileSync(OUT_PATH, JSON.stringify(results, null, 2));
  console.log(`\n결과 저장: ${OUT_PATH}`);
  console.log(`제외: ${excluded.length}건, bestK=${bestK}, passOOS=${passOOS}`);
  if (oosDetail) console.log("OOS 상세:", JSON.stringify(oosDetail));
}

function iso(ms) { return new Date(ms).toISOString().slice(0, 10); }

main().catch((e) => { console.error("실행 실패:", e); process.exit(1); });
