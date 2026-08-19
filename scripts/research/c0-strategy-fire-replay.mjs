// ════════════════════════════════════════════════════════════════════
// C-0 하네스 — 실제 전략 코드 발화 재현 리플레이 (사전등록 백테스트, 2026-08-19)
// ────────────────────────────────────────────────────────────────────
// 목적: C-1(전략 합의 부스트)·C-2(레짐-전략 매칭 가중) 두 가설의 공통 트레이드
//   스트림 생성. 프록시 신호가 아니라 **실제 전략 9종 코드**(api/_shared/strategies)
//   를 임포트해 프로덕션 경로 그대로 실행합니다:
//     · btc-cron 10분 주기 재현(10분봉 스텝)
//     · 1d 시계열 = 완결 일봉 364개 + 진행 중 일봉(10분 집계) — 프로덕션
//       fetchFuturesCandles("1d", 365) + lastBarClosed:false 경로와 동일
//     · 자산별 봇 라우팅(BOT_ASSET_MAP 미러) → runStrategyForBot → pickTop 미러
//     · F3 필터(4h EMA200 정렬 + ER14≥0.2 + ATR 상한) 통과분만 발화(풀 적재) 인정
//     · 진입 게이트: score≥55, 4h ATR%≥1.5 / 재진입 쿨다운(손실120분·익절45분 동방향)
//     · 심볼당 1포지션 순차 진입, 청산 = 2×ATR(14,4h) 손절 or 24h 시간청산
//
// 리서치 전용 — 라이브 코드·매매 경로와 완전 분리(전략 모듈은 읽기만).
// 실행: node scripts/research/c0-strategy-fire-replay.mjs
// 산출: scripts/research/c0-fire-trades.json (C-1/C-2 분석 스크립트 입력)
//
// ★★★ 사전등록 규약 (그리드·판정은 c1/c2 스크립트에 — 여기는 공통 재현만) ★★★
// ★ 홀드아웃: 2026-08-12 이후 데이터 절대 미사용 (D-1·H2 와 공유 — 소진 금지)
// ════════════════════════════════════════════════════════════════════

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runStrategyForBot } from "../../api/_shared/strategies/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = join(__dirname, "c0-fire-trades.json");

// ── 기간 (사전등록, H2/D-1 과 동일 경계 — 재현성 고정 타임스탬프) ──
const IS_START = Date.parse("2025-02-12T00:00:00Z");
const OOS_START = Date.parse("2026-02-12T00:00:00Z");
const PERIOD_END = Date.parse("2026-08-12T00:00:00Z"); // ★ 홀드아웃 시작 — 이후 데이터 미접근

// ── 심볼 (사전등록 — H2/D-1 공통 규약) ──
const INSAMPLE_SYMBOLS = ["BTCUSDT", "ETHUSDT"];
const CROSSVAL_SYMBOLS = ["SOLUSDT", "XRPUSDT", "BNBUSDT", "DOGEUSDT", "ADAUSDT", "LINKUSDT"];
const ALL_SYMBOLS = [...INSAMPLE_SYMBOLS, ...CROSSVAL_SYMBOLS];
const ASSET_OF = (sym) => `${sym.replace(/USDT$/, "")}/USD`; // btc-cron 자산 표기

// ── 고정 파라미터 (그리드 아님 — 변경 금지) ──
const STEP_MS = 10 * 60 * 1000;         // btc-cron 주기 = 10분
const DAILY_CAP = 365;                  // 프로덕션 1d fetch limit (진행봉 포함 365)
const MIN_SCORE = 55;                   // engine ZEPTA_MIN_SCORE 기본
const MIN_ATR_PCT = 1.5;                // engine ZEPTA_MIN_ATR_PCT 기본 (박스권 차단)
const STOP_ATR_MULT = 2.0;              // 스윙 S3 규약: SL = 2×ATR(14, 4h) — 균일 청산 규약
const EXIT_BARS_10M = 144;              // 24h 시간청산 (10분봉 144개)
const COOLDOWN_LOSS_MIN = 120;          // reentry-cooldown 기본(손실)
const COOLDOWN_WIN_MIN = 45;            // reentry-cooldown 기본(익절)
const CONSENSUS_WINDOW_MAX_MIN = 60;    // C-1 그리드 최대창(60분) — 발화 덱 유지 시간
// F3 (btc-cron 프로덕션 상수 미러)
const F3_MIN_4H_BARS = 220;
const F3_ER_PERIOD = 14;
const F3_ER_MIN = 0.2;
const F3_ATR_SL_CEIL = 0.075;           // 2×ATR% > 7.5% → 차단
// 레짐 (market-monitor 미러): BTC·ETH·SOL 일봉 종가 100개 R/S Hurst 평균
const HURST_BASKET = ["BTCUSDT", "ETHUSDT", "SOLUSDT"];
const HURST_WINDOW = 100;

// ── 봇 라우팅 미러 (api/btc-cron.js BOT_ASSET_MAP 2026-08-19 기준 사본) ──
//   "ALL" = 동적 유니버스 전체(유동성 상위 50종) — 8개 메이저는 전 기간 포함 가정(caveat).
const BOT_ASSET_MAP = {
  "btc-alpha": ["BTC/USD"],
  "highcap-momentum": ["BTC/USD", "ETH/USD", "SOL/USD", "XRP/USD", "ADA/USD", "AVAX/USD"],
  "defi-infra": ["LINK/USD", "UNI/USD", "AAVE/USD", "DOT/USD"],
  "meme-trend": ["DOGE/USD", "SHIB/USD", "PEPE/USD"],
  "l2-emerging": ["ARB/USD", "OP/USD", "MATIC/USD"],
  "crypto-diversity": "ALL",
  "crypto-swing": "ALL",
};
function getBotsForAsset(asset) {
  return Object.entries(BOT_ASSET_MAP)
    .filter(([, assets]) => assets === "ALL" || assets.includes(asset))
    .map(([botId]) => botId);
}
// pickTopBotSignal 미러 (btc-cron: score 우선, 동점 confidence 등급)
const CONF_RANK = { A: 3, B: 2, C: 1 };
function pickTop(botSignals) {
  if (!botSignals.length) return null;
  const sorted = botSignals.slice().sort((a, b) => {
    const sA = a.signal.score || 0, sB = b.signal.score || 0;
    if (sA !== sB) return sB - sA;
    return (CONF_RANK[b.signal.confidence] || 0) - (CONF_RANK[a.signal.confidence] || 0);
  });
  return sorted[0];
}

// ════════════════════════════════════════════════════════════════════
// 데이터 수집 — 바이낸스 선물 klines (h2/d1 과 동일 경로) + 영구 캐시
//   (기간이 과거 고정이라 데이터 불변 → 캐시 만료 없음)
// ════════════════════════════════════════════════════════════════════

const CACHE_DIR = process.env.ZEPTA_C0_CACHE
  || "/private/tmp/claude-501/-Users-kaneseo-Desktop-signal-screener-project--claude-worktrees-strange-bardeen-4ae62e/3d6e6a2a-2672-42dc-8d40-11e1b4ab1a72/scratchpad/c0-klines-cache";
mkdirSync(CACHE_DIR, { recursive: true });

const FAPI = process.env.BINANCE_FAPI_BASE || "https://fapi.binance.com";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PAGE_SLEEP_MS = 300; // d1 과 동일 — 분당 가중치 여유 확보

function readCache(name) {
  const p = join(CACHE_DIR, `${name}.json`);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; }
}
function writeCache(name, data) {
  writeFileSync(join(CACHE_DIR, `${name}.json`), JSON.stringify(data));
}

async function fetchKlinesPage(symbol, interval, startTime, endTime) {
  const url = `${FAPI}/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=1500`
    + `&startTime=${startTime}&endTime=${endTime}`;
  for (let attempt = 0; ; attempt++) {
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(20000),
      headers: { "User-Agent": "Zepta-Research/1.0", "Accept": "application/json" },
    });
    if (resp.status === 429 || resp.status === 418) {
      if (attempt >= 3) throw new Error(`klines ${symbol} ${interval} ${resp.status}: rate limit`);
      const ra = Number(resp.headers.get("retry-after"));
      const waitMs = (Number.isFinite(ra) && ra > 0 ? ra : 65) * 1000;
      console.log(`  ${symbol} ${interval} ${resp.status} — ${Math.round(waitMs / 1000)}초 대기 (${attempt + 1}/3)`);
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

/** 기간 전체 klines (페이지네이션 + dedup + 미마감 봉 제거 + 캐시) */
async function fetchAllKlines(symbol, interval, startMs, endMs) {
  const key = `${symbol}-${interval}`;
  const cached = readCache(key);
  if (cached) return cached;
  const out = [];
  let start = startMs;
  for (let page = 0; page < 140; page++) {
    let kl;
    try {
      kl = await fetchKlinesPage(symbol, interval, start, endMs);
    } catch (e) {
      await sleep(800);
      kl = await fetchKlinesPage(symbol, interval, start, endMs);
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
  const closed = dedup.filter((k) => Number(k[6]) <= endMs); // ★ 홀드아웃 경계 밖 봉 제거
  writeCache(key, closed);
  return closed;
}

function parseBars(raw) {
  return raw.map((k) => ({
    t: Number(k[0]), o: Number(k[1]), h: Number(k[2]), l: Number(k[3]),
    c: Number(k[4]), v: Number(k[5]), ct: Number(k[6]),
  })).filter((b) => b.c > 0 && b.h > 0 && b.l > 0);
}

/** 5m → 10분봉 (d1 스크립트 aggregate10m 동일 규약: 정각 10분 경계 2개 1조, 불완전 그룹 폐기) */
function aggregate10m(bars5) {
  const out = [];
  for (let i = 0; i + 1 < bars5.length; ) {
    const a = bars5[i];
    if (a.t % STEP_MS !== 0) { i++; continue; }
    const b = bars5[i + 1];
    if (b.t !== a.t + 5 * 60 * 1000) { i++; continue; }
    out.push({ t: a.t, o: a.o, c: b.c, h: Math.max(a.h, b.h), l: Math.min(a.l, b.l), v: a.v + b.v });
    i += 2;
  }
  return out;
}

// ════════════════════════════════════════════════════════════════════
// 4h 파생 시계열 (프로덕션 미러 — 봉별 사전계산)
// ════════════════════════════════════════════════════════════════════

/** calcEMA 미러(SMA 시드) — btc-cron 이 매 런 "최근 500봉" 창으로 계산하는 것을 봉별 재현 */
function emaTrailing(closes, endIdx, period, windowLen) {
  const startIdx = Math.max(0, endIdx - windowLen + 1);
  const n = endIdx - startIdx + 1;
  if (n < period) return null;
  let sum = 0;
  for (let i = startIdx; i < startIdx + period; i++) sum += closes[i];
  let ema = sum / period;
  const k = 2 / (period + 1);
  for (let i = startIdx + period; i <= endIdx; i++) ema = closes[i] * k + ema * (1 - k);
  return ema;
}

/** 4h 봉별: ema200(500봉 창), er14, f3AtrPct(단순 TR14 평균), wilderAtr(engine computeAtr 미러: 44봉 창) */
function precompute4h(bars4) {
  const n = bars4.length;
  const closes = bars4.map((b) => b.c);
  const ema200 = new Array(n).fill(null);
  const er14 = new Array(n).fill(null);
  const f3AtrPct = new Array(n).fill(null);
  const wilderAtr = new Array(n).fill(null);
  const tr = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    tr[i] = Math.max(bars4[i].h - bars4[i].l,
      Math.abs(bars4[i].h - bars4[i - 1].c), Math.abs(bars4[i].l - bars4[i - 1].c));
  }
  for (let i = 0; i < n; i++) {
    if (i >= 219) ema200[i] = emaTrailing(closes, i, 200, 500); // F3 는 봉 220개부터 유효
    if (i >= F3_ER_PERIOD) {
      const net = Math.abs(closes[i] - closes[i - F3_ER_PERIOD]);
      let vol = 0;
      for (let k = i - F3_ER_PERIOD + 1; k <= i; k++) vol += Math.abs(closes[k] - closes[k - 1]);
      er14[i] = vol > 0 ? net / vol : 0;
    }
    if (i >= 14) {
      let s = 0; let cnt = 0;
      for (let k = i - 13; k <= i; k++) { s += tr[k]; cnt++; }
      f3AtrPct[i] = closes[i] > 0 ? (s / cnt) / closes[i] : null;
    }
    // engine computeAtr 미러: klines limit=44 → TR 43개, 앞 14개 SMA 시드 후 Wilder
    if (i >= 43) {
      const from = i - 42; // TR 인덱스 from..i (43개)
      let a = 0;
      for (let k = from; k < from + 14; k++) a += tr[k];
      a /= 14;
      for (let k = from + 14; k <= i; k++) a = (a * 13 + tr[k]) / 14;
      wilderAtr[i] = a;
    }
  }
  return { ema200, er14, f3AtrPct, wilderAtr };
}

// market-monitor calcHurst 미러 (R/S, log(n) 분모 — btc-cron 판과 동일 계열)
function calcHurstMM(data) {
  const n = data.length;
  if (n < 20) return 0.5;
  const lr = [];
  for (let i = 1; i < n; i++) lr.push(Math.log(data[i] / data[i - 1]));
  const mean = lr.reduce((a, b) => a + b, 0) / lr.length;
  const dev = lr.map((r) => r - mean);
  const cd = []; let cum = 0;
  for (const d of dev) { cum += d; cd.push(cum); }
  const R = Math.max(...cd) - Math.min(...cd);
  const S = Math.sqrt(dev.reduce((a, b) => a + b * b, 0) / dev.length);
  if (S === 0) return 0.5;
  return Math.log(R / S) / Math.log(n);
}

// ════════════════════════════════════════════════════════════════════
// 심볼 리플레이 — 10분 스텝 전략 실행 + 발화/트레이드 스트림
// ════════════════════════════════════════════════════════════════════

function replaySymbol({ symbol, bars10, daily, bars4, hurstByDay, diag }) {
  const asset = ASSET_OF(symbol);
  const botIds = getBotsForAsset(asset);
  const d4 = precompute4h(bars4);
  const trades = [];
  const fireDeque = []; // {t, side, family} — 최근 60분 발화(풀 적재분)
  let openUntilIdx = -1;         // 포지션 보유 중이면 청산 bar 인덱스
  const cooldownUntil = { LONG: 0, SHORT: 0 };
  let fires = 0, f3Blocked = 0, skippedEdge = 0, gateSkipped = 0;
  const famCount = {};

  // 롤링 1d 윈도우 (마지막 원소 = 진행 중 일봉) — 전략은 입력을 읽기만 함(코드 확인 완료)
  const O = [], H = [], L = [], C = [], V = [];
  let dIdx = 0;           // daily 에서 다음으로 편입할 완결 일봉 인덱스
  let curDayStart = -1;

  // 4h 인덱스 포인터 (마지막 완결 4h 봉)
  let i4 = -1;

  const t0 = Date.now();
  let steps = 0, benchLogged = false;

  for (let i = 0; i < bars10.length; i++) {
    const b = bars10[i];
    const tClose = b.t + STEP_MS;
    if (b.t < IS_START) continue;
    if (tClose > PERIOD_END) break; // ★ 홀드아웃 미접근
    const dayStart = Math.floor(b.t / 86400000) * 86400000;

    if (dayStart !== curDayStart) {
      // 새 날 — 완결 일봉 편입 + 진행봉 초기화
      if (curDayStart >= 0 && O.length) { O.pop(); H.pop(); L.pop(); C.pop(); V.pop(); } // 이전 진행봉 제거
      while (dIdx < daily.length && daily[dIdx].t < dayStart) {
        O.push(daily[dIdx].o); H.push(daily[dIdx].h); L.push(daily[dIdx].l);
        C.push(daily[dIdx].c); V.push(daily[dIdx].v);
        dIdx++;
      }
      while (O.length > DAILY_CAP - 1) { O.shift(); H.shift(); L.shift(); C.shift(); V.shift(); }
      // 진행봉 슬롯 push
      O.push(b.o); H.push(b.h); L.push(b.l); C.push(b.c); V.push(b.v);
      curDayStart = dayStart;
    } else {
      // 같은 날 — 진행봉 갱신
      const li = O.length - 1;
      H[li] = Math.max(H[li], b.h);
      L[li] = Math.min(L[li], b.l);
      C[li] = b.c;
      V[li] += b.v;
    }

    // 4h 완결봉 포인터 전진
    while (i4 + 1 < bars4.length && bars4[i4 + 1].ct <= tClose) i4++;

    if (C.length < 60) continue; // 전략 MIN_BARS 미달 (사실상 발생 안 함 — 가드)

    // ── 전략 실행 (실제 코드) ──
    const input = { closes: C, highs: H, lows: L, volumes: V, opens: O, asset, timeframe: "1d", params: null, lastBarClosed: false };
    const botSignals = [];
    for (const botId of botIds) {
      try {
        const sig = runStrategyForBot(botId, input);
        if (sig) botSignals.push({ botId, signal: sig });
      } catch { /* 봇 격리 — 프로덕션 동일 */ }
    }
    steps++;
    if (!benchLogged && steps === 2000) {
      const perStep = (Date.now() - t0) / steps;
      console.log(`  [bench] ${symbol}: ${perStep.toFixed(2)}ms/step → 예상 ${((bars10.length * perStep) / 60000).toFixed(1)}분`);
      benchLogged = true;
    }
    const top = pickTop(botSignals);
    if (!top) continue;
    const sig = top.signal;
    const side = sig.side || (sig.type === "BUY" ? "LONG" : "SHORT");

    // ── F3 필터 (btc-cron 미러 — 통과분만 풀 적재로 인정) ──
    if (i4 + 1 >= F3_MIN_4H_BARS) { // 봉 부족 시 프로덕션 pass-through 동일
      const px4 = bars4[i4].c;
      const e200 = d4.ema200[i4];
      let block = null;
      if (Number.isFinite(e200)) {
        if (side === "LONG" && px4 <= e200) block = "regime";
        if (side === "SHORT" && px4 >= e200) block = "regime";
      }
      if (!block && d4.er14[i4] != null && d4.er14[i4] < F3_ER_MIN) block = "er";
      if (!block && d4.f3AtrPct[i4] != null && d4.f3AtrPct[i4] * 2.0 > F3_ATR_SL_CEIL) block = "atr-ceil";
      if (block) { f3Blocked++; continue; }
    }

    // ── 발화(풀 적재) 확정 ──
    fires++;
    famCount[sig.family] = (famCount[sig.family] || 0) + 1;
    fireDeque.push({ t: tClose, side, family: sig.family });
    while (fireDeque.length && fireDeque[0].t < tClose - CONSENSUS_WINDOW_MAX_MIN * 60000) fireDeque.shift();

    // ── 진입 샘플링 (engine 게이트 미러) ──
    if (i <= openUntilIdx) continue;                       // 심볼당 1포지션
    if (!(Number(sig.score) >= MIN_SCORE)) { gateSkipped++; continue; }  // 최소점수 게이트
    if (tClose < cooldownUntil[side]) { gateSkipped++; continue; }       // 재진입 쿨다운(동방향)
    const atr = i4 >= 0 ? d4.wilderAtr[i4] : null;
    if (atr == null || !(atr > 0)) { gateSkipped++; continue; }
    const entry = b.c;
    if ((atr / entry) * 100 < MIN_ATR_PCT) { gateSkipped++; continue; }  // 박스권 차단
    if (i + EXIT_BARS_10M >= bars10.length) { skippedEdge++; continue; } // 말단(홀드아웃 침범 방지)

    // ── 청산 시뮬레이션 (h2/d1 규약: 손절 체크 익봉부터, 갭=시가 체결) ──
    const dir = side === "LONG" ? 1 : -1;
    const stop = entry - dir * STOP_ATR_MULT * atr;
    let exit = null, exitType = "time", exitIdx = i + EXIT_BARS_10M;
    for (let k = i + 1; k <= i + EXIT_BARS_10M; k++) {
      const bk = bars10[k];
      if (dir === 1) {
        if (bk.o <= stop) { exit = bk.o; exitType = "stop-gap"; exitIdx = k; break; }
        if (bk.l <= stop) { exit = stop; exitType = "stop"; exitIdx = k; break; }
      } else {
        if (bk.o >= stop) { exit = bk.o; exitType = "stop-gap"; exitIdx = k; break; }
        if (bk.h >= stop) { exit = stop; exitType = "stop"; exitIdx = k; break; }
      }
      if (k === i + EXIT_BARS_10M) { exit = bk.c; exitType = "time"; }
    }
    const ret = dir * (exit / entry - 1);
    openUntilIdx = exitIdx;
    const exitTime = bars10[exitIdx].t + STEP_MS;
    cooldownUntil[side] = exitTime + (ret < 0 ? COOLDOWN_LOSS_MIN : COOLDOWN_WIN_MIN) * 60000;

    // ── 라벨 컨텍스트 ──
    const famsIn = (winMin) => {
      const s = new Set();
      for (const f of fireDeque) {
        if (f.side === side && f.t >= tClose - winMin * 60000) s.add(f.family);
      }
      return Array.from(s);
    };
    const hurst = hurstByDay.get(dayStart) ?? null;

    trades.push({
      sym: symbol, t: tClose, side, family: sig.family, score: sig.score,
      conf: sig.confidence, seg: tClose < OOS_START ? "IS" : "OOS",
      ret: Math.round(ret * 1e6) / 1e6, exitType,
      fams30: famsIn(30), fams60: famsIn(60),
      hurst: hurst != null ? Math.round(hurst * 1e4) / 1e4 : null,
    });
  }

  diag.push({
    symbol, bots: botIds, steps, fires, f3Blocked, gateSkipped, skippedEdge,
    trades: trades.length, famCount,
    elapsedSec: Math.round((Date.now() - t0) / 1000),
  });
  return trades;
}

// ════════════════════════════════════════════════════════════════════
// 메인
// ════════════════════════════════════════════════════════════════════

async function main() {
  console.log("C-0 전략 발화 리플레이 — 시작");
  console.log(`기간: IS ${iso(IS_START)}~${iso(OOS_START)} / OOS ${iso(OOS_START)}~${iso(PERIOD_END)} (홀드아웃 ${iso(PERIOD_END)}+ 미사용)`);

  // ── 데이터 수집 ──
  const DAILY_FETCH_START = IS_START - 400 * 86400000; // 1d 워밍업 (진행봉 포함 365개 확보)
  const H4_FETCH_START = IS_START - 120 * 86400000;    // 4h 워밍업 (EMA200 500봉 창)
  const M5_FETCH_START = IS_START - 2 * 86400000;      // 5m 은 진행 일봉 구성용만

  const data = {};
  const excluded = [];
  for (const symbol of ALL_SYMBOLS) {
    try {
      console.log(`${symbol}: 데이터 수집...`);
      const [d1raw, h4raw, m5raw] = [
        await fetchAllKlines(symbol, "1d", DAILY_FETCH_START, PERIOD_END),
        await fetchAllKlines(symbol, "4h", H4_FETCH_START, PERIOD_END),
        await fetchAllKlines(symbol, "5m", M5_FETCH_START, PERIOD_END),
      ];
      const daily = parseBars(d1raw);
      const bars4 = parseBars(h4raw);
      const bars10 = aggregate10m(parseBars(m5raw));
      if (daily.length < 300 || bars4.length < 300 || bars10.length < 3000) {
        excluded.push({ symbol, reason: `캔들 부족 (1d ${daily.length}, 4h ${bars4.length}, 10m ${bars10.length})` });
        continue;
      }
      data[symbol] = { daily, bars4, bars10 };
      console.log(`  1d ${daily.length} / 4h ${bars4.length} / 10m ${bars10.length}`);
    } catch (e) {
      excluded.push({ symbol, reason: `API 실패: ${String(e.message).slice(0, 120)}` });
    }
  }

  // ── 레짐: 일별 avgHurst (BTC·ETH·SOL, 해당 일 이전 완결 일봉 100개) ──
  const hurstByDay = new Map();
  {
    const basket = HURST_BASKET.filter((s) => data[s]);
    for (let day = Math.floor(IS_START / 86400000) * 86400000; day < PERIOD_END; day += 86400000) {
      const hs = [];
      for (const s of basket) {
        const closes = [];
        const dArr = data[s].daily;
        for (let i = 0; i < dArr.length && dArr[i].t < day; i++) closes.push(dArr[i].c);
        if (closes.length >= 20) hs.push(calcHurstMM(closes.slice(-HURST_WINDOW)));
      }
      if (hs.length) hurstByDay.set(day, hs.reduce((a, b) => a + b, 0) / hs.length);
    }
  }

  // ── 리플레이 ──
  const allTrades = [];
  const diag = [];
  for (const symbol of ALL_SYMBOLS) {
    if (!data[symbol]) continue;
    console.log(`${symbol}: 리플레이 (봇: ${getBotsForAsset(ASSET_OF(symbol)).join(",")})...`);
    const trades = replaySymbol({ symbol, ...data[symbol], hurstByDay, diag });
    allTrades.push(...trades);
    const d = diag[diag.length - 1];
    console.log(`  발화 ${d.fires} (F3 차단 ${d.f3Blocked}) → 트레이드 ${d.trades}건 [${d.elapsedSec}s]`);
  }

  const out = {
    generatedAt: new Date().toISOString(),
    preregistered: {
      period: { isStart: iso(IS_START), oosStart: iso(OOS_START), end: iso(PERIOD_END), holdoutNote: "2026-08-12 이후 미사용 (H2/D-1 홀드아웃 공유 — 소진 금지)" },
      insampleSymbols: INSAMPLE_SYMBOLS, crossvalSymbols: CROSSVAL_SYMBOLS,
      replay: "실제 전략 9종 코드(api/_shared/strategies) + 프로덕션 봇 라우팅(BOT_ASSET_MAP 미러) + pickTop 미러, 10분 스텝, 1d=완결364+진행봉(lastBarClosed:false), params=null(기본값)",
      f3Mirror: `4h EMA200 정렬 + ER14≥${F3_ER_MIN} + 2×ATR%≤${F3_ATR_SL_CEIL} (봉<${F3_MIN_4H_BARS} 시 pass-through)`,
      entryGates: `score≥${MIN_SCORE}, 4h WilderATR%≥${MIN_ATR_PCT}, 재진입 쿨다운(손실${COOLDOWN_LOSS_MIN}분/익절${COOLDOWN_WIN_MIN}분 동방향), 심볼당 1포지션`,
      exit: `SL=진입가∓${STOP_ATR_MULT}×ATR(14,4h Wilder·engine computeAtr 44봉 창 미러), 손절 체크 익봉부터(갭=시가), ${EXIT_BARS_10M}×10분(24h) 시간청산, 수수료 미적용`,
      regime: `avgHurst = BTC·ETH·SOL 완결 일봉 종가 slice(-${HURST_WINDOW}) R/S Hurst 평균 (market-monitor 미러, 일별)`,
      caveats: [
        "프로덕션 futures-context(펀딩·OI)·h2Shadow 점수 보정은 과거 데이터 부재로 미재현 — 원 점수 사용",
        "프로덕션은 KV 튜닝 파라미터(paramsByStrategy)를 주입할 수 있으나 여기선 기본값(params=null)",
        "market-monitor avgHurst 는 Yahoo 스팟·진행봉 포함(미장 중 주식 혼입)이나 여기선 바이낸스 선물·완결봉·크립토만",
        "엔진 1h RSI 게이트·거래량 게이트·상관군 가드·고확신 마진 등 사이징/부가 게이트 미재현 (선별 비교에는 양군 동일 규약)",
        "청산은 균일 규약(2×ATR·24h) — 프로덕션 family별 SL·S3 트레일과 다름. 선별 효과 격리 목적의 의도적 균일화",
        "동적 유니버스(상위50) 멤버십 이력 미재현 — 8개 메이저는 전 기간 포함 가정",
        "supertrend(l2-emerging)·단독 mean-revert/breakout/hurst-trend 는 8심볼 봇 라우팅상 top 발화에 등장하지 않음(ensemble 내부에서만 실행) — 프로덕션 실태 그대로",
      ],
    },
    excluded, diag,
    trades: allTrades,
  };
  writeFileSync(OUT_PATH, JSON.stringify(out));
  console.log(`\n저장: ${OUT_PATH} — 트레이드 총 ${allTrades.length}건 (IS ${allTrades.filter(t => t.seg === "IS").length} / OOS ${allTrades.filter(t => t.seg === "OOS").length})`);
}

function iso(ms) { return new Date(ms).toISOString().slice(0, 10); }

// 단위 테스트용 내보내기 (직접 실행 시에만 main 구동)
export {
  aggregate10m, precompute4h, calcHurstMM, replaySymbol, parseBars,
  getBotsForAsset, pickTop, emaTrailing,
  IS_START, OOS_START, PERIOD_END, STEP_MS,
};

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirectRun) {
  main().catch((e) => { console.error("실행 실패:", e); process.exit(1); });
}
