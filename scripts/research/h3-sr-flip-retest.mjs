// ════════════════════════════════════════════════════════════════════
// H3 검증 — SR 플립 리테스트 진입 (사전등록 백테스트, 2026-08-12)
// ────────────────────────────────────────────────────────────────────
// 출처 가설: docs/research/veyric-ta-methodology-2026-08.json hypotheses[2]
//   "R 존 종가 돌파 → 존으로 회귀(리테스트) → 존 위 종가 마감(지지 확인) 시 롱.
//    지지가 저항으로 변하면(플립 역전) 전량 청산."
//
// 리서치 전용 스크립트 — 라이브 코드·매매 경로와 완전 분리. git 커밋 금지.
// 실행: node scripts/research/h3-sr-flip-retest.mjs
// 산출: scripts/research/h3-results.json
//
// ★★★ 사전등록 파라미터 (아래 상수 외 사후 튜닝 금지) ★★★
// ════════════════════════════════════════════════════════════════════

import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
// ★ 존 산출: 프로덕션 sr 모듈을 "그대로" import — 파라미터·가중치 일절 미변경.
import { computeSRLevels } from "../../api/_shared/sr-levels.js";

// ── 그리드 (유일한 자유도) ──
const BUFFER_GRID = [0.003, 0.005, 0.010]; // 리테스트 버퍼: 존 상단±{0.3%, 0.5%, 1.0%}

// ── 고정 파라미터 (그리드 아님 — 변경 금지) ──
const TFS = ["4h", "1d"];      // 진입 TF (가설 원문: 4H / 1D)
const RETEST_WINDOW = 30;      // 돌파 후 30봉 내 리테스트 없으면 셋업 소멸(누락으로 기록)
const TIMESTOP_BARS = 60;      // 진입 후 60봉 타임스톱
const ZONE_HALF = 0.005;       // 존 반폭 — computeSRLevels 의 클러스터 병합 tol(0.5%) "재사용".
                               //   신규 파라미터 아님(프로덕션 상수 준용). 존 = [p·(1−0.005), p·(1+0.005)]
const MIN_LEVEL_TOUCHES = 1;   // 실제 스윙 클러스터(t≥1)만 존으로 인정 — 피봇 보충 레벨(t=0)은
                               //   매물대가 아니므로 제외 (가설 원문 "볼륨 프로파일 기반 존")
const MIN_TRADES = 30;         // 리테스트 진입 IS+OOS 합계 30건 미만 → 유의성 미달 자동 기각 (H2 준용)

// ── 심볼 (사전등록 — H2 와 동일) ──
const INSAMPLE_SYMBOLS = ["BTCUSDT", "ETHUSDT"];
const CROSSVAL_SYMBOLS = ["SOLUSDT", "XRPUSDT", "BNBUSDT", "DOGEUSDT", "ADAUSDT", "LINKUSDT"];
const ALL_SYMBOLS = [...INSAMPLE_SYMBOLS, ...CROSSVAL_SYMBOLS];

// ── 기간 (사전등록, 고정 타임스탬프) ──
// 18개월 = 인샘플 12 + OOS 6. 홀드아웃(2026-08-12 이후) 미소진 보존.
const IS_START = Date.parse("2025-02-12T00:00:00Z");
const OOS_START = Date.parse("2026-02-12T00:00:00Z");
const PERIOD_END = Date.parse("2026-08-12T00:00:00Z");
const DAILY_WARMUP_MS = 150 * 24 * 3600 * 1000; // 존용 일봉 워밍업(150일) — sr 윈도우 N=60 + vp N=90 충족
const ENTRY_WARMUP_MS = 10 * 24 * 3600 * 1000;  // 진입 TF 봉 선행(직전 봉 종가 비교용)

// ── 셋업·진입·청산 규약 (사전등록) ──
// 존 상태: 평가 봉 openTime 이전에 "마감된" 일봉들만으로 computeSRLevels 롤링 재계산
//   (일봉 마감마다 1회 갱신 — validFrom = 일봉 closeTime). 미래 캔들 유입 원천 차단.
// 돌파: 진입 TF 봉 종가 > 존 상단(top) AND 직전 봉 종가 <= top (첫 상향 마감).
//   같은 봉에서 복수 레벨 돌파 시 최상단 레벨 채택. 존은 돌파 시점에 동결(frozen).
// 셋업 유일성: 동일 존 상단가 ±0.5%(=tol) 이내 존은 전 기간 1셋업만 — "1회 무효 = 폐기,
//   한 번의 손절로 판정"의 보수적 해석 + 동일 존 연쇄 재발화로 인한 계열상관 차단.
// 리테스트(버퍼 b): 돌파 후 30봉 내 low <= top·(1+b) 도달. 그 봉 종가 > top 이면 진입(종가 체결).
//   봉 종가 < 존 하단(bottom) → 셋업 무효(진입 전 폐기). 존 내부 마감(bottom~top)은 대기 지속.
// 청산(진입 후, 봉 순서대로): ① 다음 상단 존 터치 — 진입봉 시점 존 상태에서 동결한
//   next-zone 하단(t≥1, 진입가 위 최근접)에 high 도달 시 익절(갭 상향 시 시가 체결).
//   ② 진입 존 하단 아래 종가 마감(플립 역전) → 전량 청산(종가). ③ 60봉 타임스톱(종가).
// 비교 기준 B(돌파 즉시 진입): 같은 셋업의 돌파봉 종가에 즉시 진입, 동일 청산 규약 —
//   리테스트 확인의 순수 엣지 격리용.
// 선택편향 직접 측정: 30봉 내 리테스트 터치가 한 번도 없이 소멸한 셋업(expiredNoTouch)의
//   "즉시 진입 가상 수익"(=기준 B 수익) 분포를 병행 기록, 진입군과 Welch t 검정.
// 숏 대칭(S 존 하향 이탈→리테스트→하단 아래 마감): 탐색용 부기록 — 판정에 미사용.
// 데이터 말단에서 미결(리테스트 대기 중 / 포지션 보유 중) 셋업·트레이드는 집계 제외(카운트만).
// 세그먼트 귀속: 돌파봉 openTime 기준. 수수료·슬리피지 미적용(상대 비교 목적) — caveat 명기.
// 셋업 독립 평가: 서로 다른 존의 셋업이 시간상 겹쳐도 각각 독립 트레이드로 평가(H2 규약 준용).

// ── 판정 룰 (사전등록 — 결과 본 뒤 변경 금지) ──
// bestBuffer: IS·insample(BTC+ETH)·양 TF 합산 (PF_retest − PF_baseline) 최대 버퍼.
// passOOS: bestBuffer 로 OOS·전 심볼·양 TF 풀링에서
//   PF_retest > PF_baseline AND 리테스트군 평균수익 > 0 AND 리테스트 진입 IS+OOS ≥ 30건.

// ════════════════════════════════════════════════════════════════════
// 데이터 수집 — 바이낸스 선물 klines (H2 스크립트 로딩 패턴 재사용)
// ════════════════════════════════════════════════════════════════════

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = join(__dirname, "h3-results.json");

const CACHE_DIR = process.env.ZEPTA_H3_CACHE
  || "/private/tmp/claude-501/-Users-kaneseo-Desktop-signal-screener-project--claude-worktrees-strange-bardeen-4ae62e/3d6e6a2a-2672-42dc-8d40-11e1b4ab1a72/scratchpad/h3-klines-cache";
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

/** 기간 전체 klines (페이지네이션 + 중복 제거 + 캐시). 실패 시 throw */
async function fetchAllKlines(symbol, interval, startMs) {
  const key = `${symbol}-${interval}-${startMs}`;
  const cached = readCache(key);
  if (cached) return cached;
  const out = [];
  let start = startMs;
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
  // 미마감 봉 제거: closeTime 이 PERIOD_END 이후면 제외
  const closed = dedup.filter((k) => Number(k[6]) <= PERIOD_END);
  writeCache(key, closed);
  return closed;
}

/** 원시 klines → {t(openTime), ct(closeTime), o, h, l, c, v} */
function parseBars(raw) {
  return raw.map((k) => ({
    t: Number(k[0]), ct: Number(k[6]),
    o: Number(k[1]), h: Number(k[2]), l: Number(k[3]), c: Number(k[4]),
    v: Number(k[5]),
  }));
}

// ════════════════════════════════════════════════════════════════════
// 존 상태 롤링 재계산 — ★룩어헤드 차단 핵심부
// ════════════════════════════════════════════════════════════════════

/**
 * 일봉 마감마다 1회, "그 시점까지의 완결 일봉만"으로 computeSRLevels 재계산.
 * computeSRLevels 는 마지막 원소를 진행 중 봉으로 간주해 내부에서 slice(0,-1)로
 * 제거하므로, 완결 봉 전체가 윈도우에 들어가도록 말미에 플레이스홀더 1개를 덧붙임
 * (플레이스홀더 값은 윈도우·피봇·vp 어디에도 쓰이지 않음 — 라이브 호출 형상 재현).
 * refPrice = 마지막 완결 일봉 종가 (프로덕션 규약 "px=마지막 일봉 종가" 동일).
 * validFrom = 해당 일봉 closeTime — 이 시각 이후 여는 봉부터만 이 존 상태를 사용.
 */
function buildZoneStates(daily) {
  const states = [];
  const MIN_HIST = 30; // 극초반 퇴화 존 방지 (IS 시작 시점엔 워밍업 150일 확보로 무관)
  for (let d = MIN_HIST - 1; d < daily.length; d++) {
    const hist = [];
    for (let j = 0; j <= d; j++) {
      const b = daily[j];
      hist.push({ high: b.h, low: b.l, close: b.c, volume: b.v });
    }
    hist.push({ ...hist[hist.length - 1] }); // 진행 중 봉 플레이스홀더
    const sr = computeSRLevels(hist, daily[d].c);
    states.push({ validFrom: daily[d].ct, sr });
  }
  return states;
}

/** 봉 openTime 시점에 유효한 최신 존 상태 (validFrom <= tOpen) — 이진 탐색 */
function asofState(states, tOpen) {
  let lo = 0, hi = states.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (states[mid].validFrom <= tOpen) { ans = mid; lo = mid + 1; } else { hi = mid - 1; }
  }
  return ans >= 0 ? states[ans].sr : null;
}

// ════════════════════════════════════════════════════════════════════
// 셋업 탐지 · 리테스트 해석 · 트레이드 시뮬레이션
// ════════════════════════════════════════════════════════════════════

/** dir=1 롱(R 존 상향 돌파) / dir=-1 숏(S 존 하향 이탈, 탐색용 부기록) */
function detectSetups(bars, states, dir) {
  const setups = [];
  const usedZones = []; // 동일 존(±tol) 전 기간 1셋업 규칙
  for (let i = 1; i < bars.length; i++) {
    const t = bars[i].t;
    if (t < IS_START || t >= PERIOD_END) continue;
    const sr = asofState(states, t);
    if (!sr) continue;
    const levels = (dir === 1 ? sr.r : sr.s) || [];
    let pick = null;
    for (const lv of levels) {
      if (!(lv.t >= MIN_LEVEL_TOUCHES)) continue; // 피봇 보충(t=0) 제외
      const p = lv.p;
      if (dir === 1) {
        const top = p * (1 + ZONE_HALF);
        if (bars[i].c > top && bars[i - 1].c <= top) {
          if (pick == null || p > pick) pick = p; // 최상단 돌파 레벨
        }
      } else {
        const bottom = p * (1 - ZONE_HALF);
        if (bars[i].c < bottom && bars[i - 1].c >= bottom) {
          if (pick == null || p < pick) pick = p; // 최하단 이탈 레벨
        }
      }
    }
    if (pick == null) continue;
    if (usedZones.some((u) => Math.abs(pick / u - 1) <= ZONE_HALF)) continue;
    usedZones.push(pick);
    setups.push({
      i, dir, p: pick,
      top: pick * (1 + ZONE_HALF),
      bottom: pick * (1 - ZONE_HALF),
    });
  }
  return setups;
}

/** 리테스트 해석 (버퍼 b) — entered / invalidated / expiredNoTouch / expiredTouched / unresolvedEnd */
function resolveRetest(bars, setup, buf) {
  const { i, dir, top, bottom } = setup;
  let touched = false;
  for (let j = i + 1; j <= i + RETEST_WINDOW; j++) {
    if (j >= bars.length) return { status: "unresolvedEnd", touched };
    const b = bars[j];
    if (dir === 1) {
      if (b.c < bottom) return { status: "invalidated", j, touched }; // 진입 전 플립 실패 → 폐기
      if (b.l <= top * (1 + buf)) {
        touched = true;
        if (b.c > top) return { status: "entered", j, touched }; // 존 위 종가 마감 = 지지 확인
      }
    } else {
      if (b.c > top) return { status: "invalidated", j, touched };
      if (b.h >= bottom * (1 - buf)) {
        touched = true;
        if (b.c < bottom) return { status: "entered", j, touched };
      }
    }
  }
  return { status: touched ? "expiredTouched" : "expiredNoTouch", touched };
}

/** 진입봉 시점 존 상태에서 다음 존 목표가 동결 (t≥1, 진입가 너머 최근접) */
function nextZoneTarget(sr, dir, entry, setup) {
  if (!sr) return null;
  if (dir === 1) {
    const cands = (sr.r || [])
      .filter((lv) => lv.t >= MIN_LEVEL_TOUCHES)
      .map((lv) => lv.p * (1 - ZONE_HALF)) // 다음 상단 존의 "하단" 도달 = 터치
      .filter((tgt) => tgt > setup.top && tgt > entry * 1.001);
    return cands.length ? Math.min(...cands) : null;
  }
  const cands = (sr.s || [])
    .filter((lv) => lv.t >= MIN_LEVEL_TOUCHES)
    .map((lv) => lv.p * (1 + ZONE_HALF))
    .filter((tgt) => tgt < setup.bottom && tgt < entry * 0.999);
  return cands.length ? Math.max(...cands) : null;
}

/** k 봉 종가 진입 → 청산 규약 시뮬레이션. 데이터 말단 미결 시 null */
function simulateTrade(bars, states, k, setup) {
  const entry = bars[k].c;
  const { dir } = setup;
  const target = nextZoneTarget(asofState(states, bars[k].t), dir, entry, setup);
  const mk = (b, exitType, exit) => ({
    entryIdx: k, entryT: bars[k].t, entry, exitT: b.t, exitType, exit,
    ret: dir * (exit / entry - 1), hadTarget: target != null,
  });
  for (let j = k + 1; j <= k + TIMESTOP_BARS; j++) {
    if (j >= bars.length) return null; // 말단 미결 — 스킵
    const b = bars[j];
    if (dir === 1) {
      if (target != null && b.o >= target) return mk(b, "nextZone-gap", b.o);
      if (target != null && b.h >= target) return mk(b, "nextZone", target);
      if (b.c < setup.bottom) return mk(b, "flipStop", b.c); // 지지가 저항으로 → 전량 청산
    } else {
      if (target != null && b.o <= target) return mk(b, "nextZone-gap", b.o);
      if (target != null && b.l <= target) return mk(b, "nextZone", target);
      if (b.c > setup.top) return mk(b, "flipStop", b.c);
    }
    if (j === k + TIMESTOP_BARS) return mk(b, "time", b.c);
  }
  return null;
}

// ════════════════════════════════════════════════════════════════════
// 통계 (H2 준용)
// ════════════════════════════════════════════════════════════════════

function round4(x) { return x == null ? null : Math.round(x * 1e4) / 1e4; }

/** ret 배열 → 지표. 무손실 표본의 PF 는 100 캡(사전등록 — JSON ∞ 표현 한계) */
function metrics(rets) {
  const n = rets.length;
  if (n === 0) return { trades: 0, winRate: null, avgRetPct: null, medianRetPct: null, pf: null };
  const wins = rets.filter((r) => r > 0);
  const grossP = wins.reduce((s, r) => s + r, 0);
  const grossL = rets.filter((r) => r < 0).reduce((s, r) => s - r, 0);
  const sorted = [...rets].sort((a, b) => a - b);
  const med = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  let pf = null;
  if (grossL > 1e-12) pf = Math.min(grossP / grossL, 100);
  else if (grossP > 0) pf = 100;
  else pf = 0;
  return {
    trades: n,
    winRate: round4(wins.length / n),
    avgRetPct: round4((rets.reduce((s, r) => s + r, 0) / n) * 100),
    medianRetPct: round4(med * 100),
    pf: round4(pf),
  };
}

/** Welch t-test (정규 근사 p, 대표본 전제) */
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

function iso(ms) { return new Date(ms).toISOString().slice(0, 10); }

async function main() {
  console.log("H3 SR 플립 리테스트 — 사전등록 검증 시작");
  console.log(`기간: IS ${iso(IS_START)}~${iso(OOS_START)} / OOS ${iso(OOS_START)}~${iso(PERIOD_END)}`);

  const excluded = [];
  // outcomes: 셋업 × 버퍼 평면 레코드
  // {symbol, group, tf, dir, segment, buf, status, retestRet|null, retestSkipped, baselineRet|null, baselineSkipped}
  const outcomes = [];
  const setupAudit = []; // 감사용 컴팩트 셋업 목록

  for (const symbol of ALL_SYMBOLS) {
    const group = INSAMPLE_SYMBOLS.includes(symbol) ? "insample" : "crossval";
    let dailyRaw;
    try {
      dailyRaw = await fetchAllKlines(symbol, "1d", IS_START - DAILY_WARMUP_MS);
    } catch (e) {
      excluded.push({ symbol, reason: `일봉 API 실패: ${String(e.message).slice(0, 120)}` });
      continue;
    }
    const daily = parseBars(dailyRaw);
    if (daily.length < 120) {
      excluded.push({ symbol, reason: `일봉 부족 (${daily.length}봉)` });
      continue;
    }
    const zoneStates = buildZoneStates(daily);

    for (const tf of TFS) {
      let bars;
      if (tf === "1d") {
        bars = daily.filter((b) => b.t >= IS_START - ENTRY_WARMUP_MS);
      } else {
        let raw;
        try {
          raw = await fetchAllKlines(symbol, tf, IS_START - ENTRY_WARMUP_MS);
        } catch (e) {
          excluded.push({ symbol, tf, reason: `${tf} API 실패: ${String(e.message).slice(0, 120)}` });
          continue;
        }
        bars = parseBars(raw);
      }
      if (bars.length < 100) {
        excluded.push({ symbol, tf, reason: `${tf} 봉 부족 (${bars.length}봉)` });
        continue;
      }

      for (const dir of [1, -1]) { // 1=롱(본 가설) / -1=숏(탐색용 부기록)
        const setups = detectSetups(bars, zoneStates, dir);
        for (const setup of setups) {
          const segment = bars[setup.i].t < OOS_START ? "IS" : "OOS";
          // 기준 B: 돌파 즉시 진입 (버퍼 무관 — 셋업당 1회)
          const baseline = simulateTrade(bars, zoneStates, setup.i, setup);
          const audit = {
            symbol, tf, dir, segment,
            breakoutT: new Date(bars[setup.i].t).toISOString().slice(0, 16),
            zoneP: setup.p, zoneTop: round4(setup.top), zoneBottom: round4(setup.bottom),
            baseline: baseline
              ? { retPct: round4(baseline.ret * 100), exitType: baseline.exitType, hadTarget: baseline.hadTarget }
              : "skipped-at-edge",
            perBuffer: {},
          };
          for (const buf of BUFFER_GRID) {
            const res = resolveRetest(bars, setup, buf);
            let trade = null;
            if (res.status === "entered") trade = simulateTrade(bars, zoneStates, res.j, setup);
            outcomes.push({
              symbol, group, tf, dir, segment, buf,
              status: res.status,
              retestRet: trade ? trade.ret : null,
              retestSkipped: res.status === "entered" && trade == null,
              retestExitType: trade ? trade.exitType : null,
              waitBars: res.j != null ? res.j - setup.i : null,
              baselineRet: baseline ? baseline.ret : null,
              baselineSkipped: baseline == null,
            });
            audit.perBuffer[String(buf)] = {
              status: res.status,
              retPct: trade ? round4(trade.ret * 100) : null,
              exitType: trade ? trade.exitType : null,
            };
          }
          setupAudit.push(audit);
        }
        console.log(`${symbol} ${tf} dir=${dir === 1 ? "L" : "S"}: 봉 ${bars.length}, 셋업 ${setups.length}건`);
      }
    }
  }

  // ── 셀 집계 ──
  const cellFilter = (dir, tf, buf, seg, g) => outcomes.filter((o) =>
    o.dir === dir && o.tf === tf && o.buf === buf && o.segment === seg &&
    (g === "all" || o.group === g));

  function aggregateCell(sel) {
    const entered = sel.filter((o) => o.status === "entered" && o.retestRet != null);
    const baselineResolved = sel.filter((o) => o.baselineRet != null);
    const missed = sel.filter((o) => o.status === "expiredNoTouch" && o.baselineRet != null);
    const enteredRets = entered.map((o) => o.retestRet);
    const pairedDiffs = entered.filter((o) => o.baselineRet != null)
      .map((o) => o.retestRet - o.baselineRet);
    return {
      counts: {
        setups: sel.length,
        entered: sel.filter((o) => o.status === "entered").length,
        invalidatedPreEntry: sel.filter((o) => o.status === "invalidated").length,
        expiredNoTouch: sel.filter((o) => o.status === "expiredNoTouch").length,
        expiredTouched: sel.filter((o) => o.status === "expiredTouched").length,
        unresolvedEnd: sel.filter((o) => o.status === "unresolvedEnd").length,
        retestSkippedAtEdge: sel.filter((o) => o.retestSkipped).length,
        baselineSkippedAtEdge: sel.filter((o) => o.baselineSkipped).length,
      },
      retest: metrics(enteredRets),
      baseline: metrics(baselineResolved.map((o) => o.baselineRet)),
      missedHypothetical: metrics(missed.map((o) => o.baselineRet)),
      pairedMeanDiffPct: pairedDiffs.length
        ? round4((pairedDiffs.reduce((s, d) => s + d, 0) / pairedDiffs.length) * 100) : null,
      missedVsEntered: welchT(missed.map((o) => o.baselineRet), enteredRets),
    };
  }

  const cells = [];
  for (const dir of [1, -1]) {
    for (const tf of TFS) for (const buf of BUFFER_GRID) {
      for (const seg of ["IS", "OOS"]) for (const g of ["insample", "crossval", "all"]) {
        const sel = cellFilter(dir, tf, buf, seg, g);
        cells.push({ dir, tf, buf, segment: seg, group: g, ...aggregateCell(sel) });
      }
    }
  }

  // ── bestBuffer 선정 (사전등록 룰: 롱, IS, insample, 양 TF 합산 PF_retest − PF_baseline 최대) ──
  const bufScore = new Map();
  for (const buf of BUFFER_GRID) {
    let score = 0; let valid = true;
    for (const tf of TFS) {
      const c = cells.find((x) => x.dir === 1 && x.tf === tf && x.buf === buf
        && x.segment === "IS" && x.group === "insample");
      if (!c || c.retest.pf == null || c.baseline.pf == null || c.retest.trades === 0) { valid = false; break; }
      score += c.retest.pf - c.baseline.pf;
    }
    bufScore.set(buf, valid ? round4(score) : null);
  }
  let bestBuffer = null; let bestScore = -Infinity;
  for (const [buf, s] of bufScore.entries()) {
    if (s != null && s > bestScore) { bestScore = s; bestBuffer = buf; }
  }

  // ── passOOS 판정 (사전등록 룰: bestBuffer, OOS, 전 심볼, 양 TF 풀링) ──
  let passOOS = false; let oosDetail = null;
  if (bestBuffer != null) {
    const sel = (seg) => outcomes.filter((o) => o.dir === 1 && o.buf === bestBuffer
      && (seg == null || o.segment === seg));
    const oosRetest = sel("OOS").filter((o) => o.status === "entered" && o.retestRet != null)
      .map((o) => o.retestRet);
    const oosBaseline = sel("OOS").filter((o) => o.baselineRet != null).map((o) => o.baselineRet);
    const totalRetestTrades = sel(null).filter((o) => o.status === "entered" && o.retestRet != null).length;
    const mR = metrics(oosRetest); const mB = metrics(oosBaseline);
    const pfImproves = mR.pf != null && mB.pf != null && mR.trades > 0 && mR.pf > mB.pf;
    const avgPositive = mR.avgRetPct != null && mR.avgRetPct > 0;
    passOOS = pfImproves && avgPositive && totalRetestTrades >= MIN_TRADES;
    oosDetail = {
      oosRetest: mR, oosBaseline: mB,
      pfImproves, avgPositive, totalRetestTrades, minRequired: MIN_TRADES,
    };
  }

  // ── 선택편향(누락 돌파) 분석 — 롱, 버퍼별, 전 기간(IS+OOS), 전 심볼, 양 TF 풀링 ──
  const missedAnalysis = {};
  for (const buf of BUFFER_GRID) {
    const sel = outcomes.filter((o) => o.dir === 1 && o.buf === buf);
    const missedRets = sel.filter((o) => o.status === "expiredNoTouch" && o.baselineRet != null)
      .map((o) => o.baselineRet);
    const enteredRets = sel.filter((o) => o.status === "entered" && o.retestRet != null)
      .map((o) => o.retestRet);
    missedAnalysis[String(buf)] = {
      missedHypothetical: metrics(missedRets),
      entered: metrics(enteredRets),
      welch: welchT(missedRets, enteredRets),
    };
  }

  const results = {
    hypothesis: "H3 — R 존 종가 돌파 → 존 상단 리테스트 → 존 위 종가 마감(지지 확인) 시 롱. 플립 역전(존 하단 아래 종가) 전량 청산 / 다음 상단 존 터치 익절 / 60봉 타임스톱. 비교 기준 = 동일 돌파 즉시 진입.",
    source: "docs/research/veyric-ta-methodology-2026-08.json hypotheses[2]",
    preregistered: {
      bufferGrid: BUFFER_GRID, timeframes: TFS,
      retestWindowBars: RETEST_WINDOW, timestopBars: TIMESTOP_BARS,
      zoneHalfWidth: ZONE_HALF, zoneHalfWidthNote: "computeSRLevels 클러스터 tol(0.5%) 재사용 — 신규 파라미터 아님",
      minLevelTouches: MIN_LEVEL_TOUCHES, minLevelTouchesNote: "피봇 보충 레벨(t=0)은 매물대 아님 → 제외",
      zoneSource: "api/_shared/sr-levels.js computeSRLevels 그대로 import, 일봉 마감마다 완결 봉만으로 롤링 재계산(validFrom=closeTime) — 룩어헤드 차단",
      oneSetupPerZone: "동일 존 상단가 ±0.5% 는 전 기간 1셋업 (1회 무효=폐기의 보수적 해석)",
      insampleSymbols: INSAMPLE_SYMBOLS, crossvalSymbols: CROSSVAL_SYMBOLS,
      period: { isStart: iso(IS_START), oosStart: iso(OOS_START), end: iso(PERIOD_END) },
      bestBufferRule: "롱·IS·insample(BTC+ETH)·양 TF 합산 (PF_retest − PF_baseline) 최대 버퍼",
      passOOSRule: `bestBuffer 로 OOS·전심볼·양TF 풀링 PF_retest > PF_baseline AND 평균수익 > 0 AND 리테스트 진입 IS+OOS ≥ ${MIN_TRADES}건`,
      entryExit: "진입=리테스트 확인봉 종가(기준B=돌파봉 종가). 청산: 다음존 터치(갭=시가) / 존 하단 아래 종가(플립) / 60봉 타임스톱. 수수료·슬리피지 미적용(상대 비교 목적). 셋업 독립 평가(중복 허용). 숏 대칭은 탐색용 부기록.",
      segmentAttribution: "돌파봉 openTime 기준",
    },
    generatedAt: new Date().toISOString(),
    excluded,
    bufferScoreIS: Object.fromEntries([...bufScore.entries()].map(([k, v]) => [String(k), v])),
    bestBuffer,
    passOOS,
    oosDetail,
    missedAnalysis,
    cellsLong: cells.filter((c) => c.dir === 1),
    cellsShortExploratory: cells.filter((c) => c.dir === -1),
    setupAudit,
  };

  writeFileSync(OUT_PATH, JSON.stringify(results, null, 2));
  console.log(`\n결과 저장: ${OUT_PATH}`);
  console.log(`제외: ${excluded.length}건, bestBuffer=${bestBuffer}, passOOS=${passOOS}`);
  if (oosDetail) console.log("OOS 상세:", JSON.stringify(oosDetail));
}

main().catch((e) => { console.error("실행 실패:", e); process.exit(1); });
