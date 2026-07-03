// ════════════════════════════════════════════════════════════════════
// Zepta — 합류(Confluence) 타점 엔진 v2 (2026-07-04, 대표 피드백 반영)
// ────────────────────────────────────────────────────────────────────
// v1(캘리브레이션 봉패턴 단독)의 한계: 약세 패턴이 실측 검증 전멸 → 숏 타점
// 부재 + 롱도 패턴 하나로는 정밀도 부족. → 봉패턴을 6요소 중 하나로 내리고,
// 지표·차트구조 증거를 합산해 임계 돌파 시에만 ▲/▼ 발화. 롱/숏 대칭.
//
// 6요소 (각 요소는 확정봉 i 종가까지 데이터만 사용 — 룩어헤드 금지):
//   ① 캘리브레이션 봉패턴 (candle-patterns.js — 검증 통과 조합만 w>0)
//   ② RSI 다이버전스: 확정 피벗 2개 기준 가격 LL+RSI HL(강세)/HH+LH(약세)
//   ③ RSI 극단 반전: 30 하향→상향 재돌파(롱) / 70 상향→하향 이탈(숏)
//   ④ 스윕-리클레임: 꼬리로 S/R 관통 후 종가 회복(레벨 거부 — 숏의 핵심 재료)
//   ⑤ 눌림목/되돌림 거부: EMA20>50 추세 중 EMA20 터치 후 방향 재개(양방향)
//   ⑥ 거래량 확인: ≥1.5×SMA20 (단독 발화 불가 — 다른 증거 있을 때만 가산)
//
// 발화 규칙: score ≥ TH(기본 2.0) AND (score − 반대편) ≥ 1.0.
// 가중·임계는 scripts/validate-timing-signals.mjs 가 과거 데이터(학습/OOS/홀드아웃
// 심볼)로 검증 — 통과 못 하면 배포 금지. 순수 ESM, 백엔드·프론트 공유.
// ════════════════════════════════════════════════════════════════════

import { calcEMA, calcSMA, calcRSI, calcMACD, calcBB, calcStochastic, calcMFI, calcOBV } from "./strategies/_indicators.js";
import { analyzeCandleSeries, swingLevels, tfWeight } from "./candle-patterns.js";

// 요소 가중 — 근거: ②④는 레벨·모멘텀 이중 정보라 상위, ⑥은 확인용 보조.
//   (validate-timing-signals.mjs 홀드아웃 검증을 통과한 세트만 배포)
export const TIMING_WEIGHTS = {
  pattern: 1.5,     // ① × 패턴 자체 w(0~1) — 실질 0~1.5
  divergence: 1.2,  // ②
  rsiReversal: 0.8, // ③
  sweepReclaim: 1.2,// ④
  pullback: 1.0,    // ⑤
  volume: 0.5,      // ⑥ (보조)
};
export const TIMING_TH = 2.0;      // 발화 임계 (리서치 모드)
export const TIMING_DOMINANCE = 1.0; // 반대편 대비 우위 요구 (리서치 모드)

// ★ 2026-07-04 요소별 캘리브레이션 결과 (24심볼×3TF, 두 구간 부호일관+OOS≥10bps+
//   클러스터-강건 t≥1.5, 총 42 요소×TF×방향 중 9개 생존 — 전부 롱):
//   숏은 반전형 5가설 + 지속형 2가설(구조이탈·LH) 전부 두 구간 불일치/음수로 탈락.
//   → 검증 모드에서 숏 신호는 표시하지 않는다(동전던지기 이하를 파는 건 부정직).
//   주봉·월봉은 1d 준용(패턴만). 재검증: scripts/calibrate-timing-factors.mjs
// ★ v3 총동원 캘리브레이션 (2026-07-04 2차): 후보 19요소×3TF×롱숏=114조합,
//   신규 요소는 강화 규칙(두 구간 각각 t≥1.0 추가) — 17조합 생존, 전부 롱.
//   숏은 레짐 조건부 포함 3차례 검증에서 전멸(총 ~40 숏 조합) — 표시하지 않는다.
export const VALIDATED_TIMING = {
  "1h": { long: ["pattern", "pullback", "structureBreak", "structureHL", "stochCross", "obvAccum", "breakRetest"], short: [] },
  "4h": { long: ["pattern", "rsiReversal", "sweepReclaim", "structureBreak", "macdCross", "macdHistTurn", "stochCross", "obvAccum", "breakRetest"], short: [] },
  "1d": { long: ["pattern"], short: [] },
};

// TF별 발화 최소 점수 — 학습 8심볼 임계 스캔(홀드아웃 미사용) 실측:
//   합류 점수와 엣지가 단조 증가 (1h: 1.9→+9bps/63봉당1개 · 2.5→+51bps · 3.0→+68bps,
//   4h: 1.9→+24bps · 2.5→+63bps · 3.0→+89bps). 기본 마커 1.9, 강한 합류 2.5.
export const TIMING_MIN_SCORE = { "1h": 1.9, "4h": 1.9, "1d": 0.75 };
export const TIMING_STRONG_SCORE = 2.5; // 강한 합류 (표시 강조 + 알림 권장 티어)
export const TIMING_SCORE_FULL = 4.0;   // 종합 점수 100점 환산 기준 (score/4×100)

// 쿨다운 (2026-07-04 대표 피드백 "1h 신호 과다"): 강추세 구간에서 눌림목·HL구조가
// 연속 봉 재발화 → 클러스터. 같은 방향 신호 후 N봉 억제, 점수가 직전+0.5 초과로
// 세지면 예외(에스컬레이션 허용). 표시 필터이며 요소 검증과 무관.
export const TIMING_COOLDOWN = { "1h": 6, "4h": 4, "1d": 2 };

// ── 내부: ATR14 (candle-patterns 와 동일 — TR 의 SMA) ──
function atrSeries(highs, lows, closes, period = 14) {
  const n = closes.length;
  const out = new Array(n).fill(null);
  let sum = 0, cnt = 0;
  for (let i = 1; i < n; i++) {
    const tr = Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1]));
    sum += tr; cnt++;
    if (cnt > period) {
      const j = i - period;
      sum -= Math.max(highs[j] - lows[j], Math.abs(highs[j] - closes[j - 1]), Math.abs(lows[j] - closes[j - 1]));
      cnt = period;
    }
    if (cnt === period) out[i] = sum / period;
  }
  return out;
}

// ── 내부: 확정 프랙탈 피벗 (k=2 — 봉 i 에서 피벗 i-2 확정) ──
function confirmedPivots(highs, lows, n, k = 2) {
  const phIdx = [], plIdx = [];
  for (let i = k; i < n - k; i++) {
    let isH = true, isL = true;
    for (let d = 1; d <= k; d++) {
      if (!(highs[i] > highs[i - d] && highs[i] > highs[i + d])) isH = false;
      if (!(lows[i] < lows[i - d] && lows[i] < lows[i + d])) isL = false;
    }
    if (isH) phIdx.push(i);
    if (isL) plIdx.push(i);
  }
  return { phIdx, plIdx };
}

/**
 * computeTimingSignals — 시리즈 전체 스캔 (차트 마커·검증 하니스 공용).
 *   입력 배열: 과거→최신 오름차순. 진행봉은 caller 가 제거(확정봉 원칙).
 *   volumes 없으면 ⑥ 비활성 + 거래량 필수 패턴 자동 비활성(모듈 위임).
 * 반환: { signals: [{i, dir(+1/-1), score, opposing, reasons[]}] }
 */
export function computeTimingSignals({ opens, highs, lows, closes, volumes }, { tf = "1d", calib, th = TIMING_TH, dominance = TIMING_DOMINANCE, weights = TIMING_WEIGHTS, emitFactors = false, mode = "validated", minScore = null } = {}) {
  const n = closes?.length || 0;
  if (!opens || !highs || !lows || n < 40 || tfWeight(tf) === 0) return { signals: [], factorEvents: [] };
  const factorEvents = emitFactors ? [] : null; // 요소별 캘리브레이션용 (검증 하니스 전용)

  // 검증 모드: TF×방향별 실측 생존 요소만 집계 (기본). 리서치 모드: 전 요소 + 임계/우위 규칙.
  const tfValKey = ({ "1wk": "1d", "1w": "1d", "1mo": "1d" })[tf] || tf;
  const validated = mode === "validated" ? (VALIDATED_TIMING[tfValKey] || { long: [], short: [] }) : null;
  const useFactor = (factor, dir) => !validated || (dir > 0 ? validated.long : validated.short).includes(factor);
  const minScoreEff = minScore ?? (TIMING_MIN_SCORE[tfValKey] ?? 0.75);

  const atr = atrSeries(highs, lows, closes, 14);
  const ema20 = calcEMA(closes, 20);
  const ema50 = calcEMA(closes, 50);
  const rsi = calcRSI(closes, 14);
  const volSMA = volumes ? calcSMA(volumes, 20) : null;
  const { phIdx, plIdx } = confirmedPivots(highs, lows, n, 2);

  // ── v3 확장 지표 (2026-07-04 "총동원" — 후보 단계. 검증 통과분만 점수 반영) ──
  const ema200 = n >= 210 ? calcEMA(closes, 200) : null;
  const macd = calcMACD(closes);
  const bb = calcBB(closes, 20, 2);
  const stoch = calcStochastic(highs, lows, closes, 14, 3);
  const mfi = volumes ? calcMFI(highs, lows, closes, volumes, 14) : null;
  const obv = volumes ? calcOBV(closes, volumes) : null;
  const obvEma = obv ? calcEMA(obv, 20) : null;
  // BB 밴드폭 (스퀴즈 감지용)
  const bbw = new Array(n).fill(null);
  for (let j = 0; j < n; j++) {
    if (bb.upper?.[j] != null && bb.lower?.[j] != null && bb.middle?.[j] > 0) bbw[j] = (bb.upper[j] - bb.lower[j]) / bb.middle[j];
  }
  let lastBreakUpBar = -99, lastBreakUpLvl = 0, lastBreakDnBar = -99, lastBreakDnLvl = 0; // 리테스트 추적

  // ① 봉패턴 이벤트 인덱스 맵 (캘리브레이션 게이트 포함)
  const patByBar = new Map();
  try {
    const { events } = analyzeCandleSeries({ opens, highs, lows, closes, volumes }, { tf, calib });
    for (const ev of events) {
      const cur = patByBar.get(ev.i) || {};
      if (ev.dir > 0) { if (!cur.bull || ev.w > cur.bull.w) cur.bull = ev; }
      else { if (!cur.bear || ev.w > cur.bear.w) cur.bear = ev; }
      patByBar.set(ev.i, cur);
    }
  } catch { /* 패턴 실패는 다른 요소를 막지 않음 */ }

  const K = 2; // 피벗 확정 지연
  const signals = [];
  let latest = null; // 마지막 확정봉의 종합 점수 (임계 미달도 — 패널 게이지용)
  const cooldown = TIMING_COOLDOWN[tfValKey] ?? 4;
  let lastLongBar = -1e9, lastLongScore = 0, lastShortBar = -1e9, lastShortScore = 0;

  for (let i = 30; i < n; i++) {
    const a = atr[i];
    if (!(a > 0) || rsi[i] == null || ema20[i] == null) continue;

    const levels = swingLevels(highs, lows, i, a);
    let longS = 0, shortS = 0;
    const longR = [], shortR = [];

    // ① 캘리브레이션 봉패턴
    const pat = patByBar.get(i);
    if (pat?.bull) { factorEvents?.push({ i, dir: +1, factor: "pattern" }); if (useFactor("pattern", +1)) { longS += weights.pattern * Math.min(1, pat.bull.w); longR.push(`패턴 ${pat.bull.ko}`); } }
    if (pat?.bear) { factorEvents?.push({ i, dir: -1, factor: "pattern" }); if (useFactor("pattern", -1)) { shortS += weights.pattern * Math.min(1, pat.bear.w); shortR.push(`패턴 ${pat.bear.ko}`); } }

    // ② RSI 다이버전스 — 봉 i 에서 *확정된*(피벗 ≤ i-K) 최근 2개 피벗만 사용, 신선도 3봉
    //    (강세: 가격 저점 낮아지는데 RSI 저점 높아짐 — 하락 모멘텀 소진)
    {
      const pls = plIdx.filter(p => p <= i - K && p >= i - 40);
      if (pls.length >= 2) {
        const p2 = pls[pls.length - 1], p1 = pls[pls.length - 2];
        if (i - K - p2 <= 3 && p2 - p1 >= 3
            && lows[p2] < lows[p1] - 0.1 * a && rsi[p2] != null && rsi[p1] != null && rsi[p2] > rsi[p1] + 2
            && rsi[p1] < 45) {
          factorEvents?.push({ i, dir: +1, factor: "divergence" });
          if (useFactor("divergence", +1)) { longS += weights.divergence; longR.push("RSI 강세 다이버전스"); }
        }
      }
      const phs = phIdx.filter(p => p <= i - K && p >= i - 40);
      if (phs.length >= 2) {
        const p2 = phs[phs.length - 1], p1 = phs[phs.length - 2];
        if (i - K - p2 <= 3 && p2 - p1 >= 3
            && highs[p2] > highs[p1] + 0.1 * a && rsi[p2] != null && rsi[p1] != null && rsi[p2] < rsi[p1] - 2
            && rsi[p1] > 55) {
          factorEvents?.push({ i, dir: -1, factor: "divergence" });
          if (useFactor("divergence", -1)) { shortS += weights.divergence; shortR.push("RSI 약세 다이버전스"); }
        }
      }
    }

    // ③ RSI 극단 반전 (재돌파 봉 — 이미 되돌린 뒤가 아니라 반전 그 시점)
    if (rsi[i - 1] != null) {
      if (rsi[i - 1] < 30 && rsi[i] >= 30 && rsi[i] < 45) { factorEvents?.push({ i, dir: +1, factor: "rsiReversal" }); if (useFactor("rsiReversal", +1)) { longS += weights.rsiReversal; longR.push(`RSI ${rsi[i - 1].toFixed(0)}→${rsi[i].toFixed(0)} 반등`); } }
      if (rsi[i - 1] > 70 && rsi[i] <= 70 && rsi[i] > 55) { factorEvents?.push({ i, dir: -1, factor: "rsiReversal" }); if (useFactor("rsiReversal", -1)) { shortS += weights.rsiReversal; shortR.push(`RSI ${rsi[i - 1].toFixed(0)}→${rsi[i].toFixed(0)} 이탈`); } }
    }

    // ④ 스윕-리클레임 (레벨 거부 — 꼬리로 관통 후 종가 회복)
    {
      const o = opens[i], c = closes[i], h = highs[i], l = lows[i];
      const loW = Math.min(o, c) - l, upW = h - Math.max(o, c);
      for (const lv of levels) {
        // 지지 스윕: 저가가 레벨 아래로 찔렀는데 종가는 레벨 위 복귀 + 유의한 하단 꼬리
        if (l < lv.p - 0.05 * a && c > lv.p + 0.05 * a && loW >= 0.7 * a && c > o) {
          factorEvents?.push({ i, dir: +1, factor: "sweepReclaim" });
          if (useFactor("sweepReclaim", +1)) { longS += weights.sweepReclaim; longR.push(`지지 ${lv.t}회터치 스윕 후 회복`); }
          break;
        }
      }
      for (const lv of levels) {
        if (h > lv.p + 0.05 * a && c < lv.p - 0.05 * a && upW >= 0.7 * a && c < o) {
          factorEvents?.push({ i, dir: -1, factor: "sweepReclaim" });
          if (useFactor("sweepReclaim", -1)) { shortS += weights.sweepReclaim; shortR.push(`저항 ${lv.t}회터치 스윕 후 거부`); }
          break;
        }
      }
    }

    // ⑤ 눌림목/되돌림 거부 (추세 정렬 재개 — 양방향)
    if (ema50[i] != null) {
      const up = ema20[i] > ema50[i], down = ema20[i] < ema50[i];
      if (up && lows[i] <= ema20[i] + 0.3 * a && closes[i] > ema20[i] && closes[i] > opens[i] && closes[i] > closes[i - 1]) {
        factorEvents?.push({ i, dir: +1, factor: "pullback" });
        if (useFactor("pullback", +1)) { longS += weights.pullback; longR.push("상승추세 눌림목 반등"); }
      }
      if (down && highs[i] >= ema20[i] - 0.3 * a && closes[i] < ema20[i] && closes[i] < opens[i] && closes[i] < closes[i - 1]) {
        factorEvents?.push({ i, dir: -1, factor: "pullback" });
        if (useFactor("pullback", -1)) { shortS += weights.pullback; shortR.push("하락추세 되돌림 거부"); }
      }
    }

    // ⑦ 구조 이탈 확정 (breakout/breakdown — 추세 지속 타이밍. 1차 캘리브레이션에서
    //    반전형 숏이 전멸해 추가된 지속형 가설: 레벨을 *종가로* 확정 이탈 + 추세 정렬)
    if (ema50[i] != null) {
      const o = opens[i], c = closes[i];
      const bodyOk = Math.abs(c - o) >= 0.5 * a;
      if (ema20[i] > ema50[i] && c > o && bodyOk) {
        for (const lv of levels) {
          if (c > lv.p + 0.25 * a && closes[i - 1] <= lv.p + 0.05 * a) {
            factorEvents?.push({ i, dir: +1, factor: "structureBreak" });
            if (useFactor("structureBreak", +1)) { longS += (weights.structureBreak ?? 1.0); longR.push(`저항 ${lv.t}회터치 종가 돌파`); }
            lastBreakUpBar = i; lastBreakUpLvl = lv.p; // ⑲ 리테스트 추적용
            break;
          }
        }
      }
      if (ema20[i] < ema50[i] && c < o && bodyOk) {
        for (const lv of levels) {
          if (c < lv.p - 0.25 * a && closes[i - 1] >= lv.p - 0.05 * a) {
            factorEvents?.push({ i, dir: -1, factor: "structureBreak" });
            if (useFactor("structureBreak", -1)) { shortS += (weights.structureBreak ?? 1.0); shortR.push(`지지 ${lv.t}회터치 종가 이탈`); }
            lastBreakDnBar = i; lastBreakDnLvl = lv.p; // ⑲ 리테스트 추적용
            break;
          }
        }
      }
    }

    // ⑧ 스윙 구조 확인 (HL 상승구조 / LH 하락구조 — 확정 피벗 2개, 신선도 3봉)
    {
      const pls = plIdx.filter(p => p <= i - K && p >= i - 40);
      if (pls.length >= 2) {
        const p2 = pls[pls.length - 1], p1 = pls[pls.length - 2];
        if (i - K - p2 <= 3 && p2 - p1 >= 3 && lows[p2] > lows[p1] + 0.1 * a && closes[i] > ema20[i]) {
          factorEvents?.push({ i, dir: +1, factor: "structureHL" });
          if (useFactor("structureHL", +1)) { longS += (weights.structureHL ?? 1.0); longR.push("저점 높아짐(HL) 구조"); }
        }
      }
      const phs = phIdx.filter(p => p <= i - K && p >= i - 40);
      if (phs.length >= 2) {
        const p2 = phs[phs.length - 1], p1 = phs[phs.length - 2];
        if (i - K - p2 <= 3 && p2 - p1 >= 3 && highs[p2] < highs[p1] - 0.1 * a && closes[i] < ema20[i]) {
          factorEvents?.push({ i, dir: -1, factor: "structureHL" });
          if (useFactor("structureHL", -1)) { shortS += (weights.structureHL ?? 1.0); shortR.push("고점 낮아짐(LH) 구조"); }
        }
      }
    }

    // ══ v3 후보 요소 (2026-07-04 "총동원") — 신규 숏 요소는 레짐 조건부(EMA200 아래
    //    에서만 평가 — 1·2차에서 레짐 무시 숏이 전멸한 것에 대한 사전등록 가설).
    //    검증(calibrate-timing-factors.mjs) 통과 전에는 점수 미반영(useFactor 게이트). ══
    {
      const bearRegime = ema200?.[i] != null ? closes[i] < ema200[i] : ema20[i] < ema50[i];
      const c = closes[i], o = opens[i];
      const bodyI = Math.abs(c - o);
      const emit = (name, dir, w, reason) => {
        factorEvents?.push({ i, dir, factor: name });
        if (useFactor(name, dir)) {
          if (dir > 0) { longS += w; longR.push(reason); } else { shortS += w; shortR.push(reason); }
        }
      };

      // ⑨ MACD 골든/데드 크로스 (신선 — 이번 봉 발생)
      const ml = macd.macdLine, ms = macd.signal;
      if (ml?.[i] != null && ms?.[i] != null && ml[i - 1] != null && ms[i - 1] != null) {
        if (ml[i] > ms[i] && ml[i - 1] <= ms[i - 1]) emit("macdCross", +1, 0.9, "MACD 골든크로스");
        if (ml[i] < ms[i] && ml[i - 1] >= ms[i - 1] && bearRegime) emit("macdCross", -1, 0.9, "MACD 데드크로스(약세장)");
      }
      // ⑩ MACD 히스토그램 저점/고점 반전
      const hh = macd.histogram;
      if (hh?.[i] != null && hh[i - 1] != null && hh[i - 2] != null) {
        if (hh[i] > hh[i - 1] && hh[i - 1] <= hh[i - 2] && hh[i - 1] < 0) emit("macdHistTurn", +1, 0.8, "MACD 모멘텀 저점 반전");
        if (hh[i] < hh[i - 1] && hh[i - 1] >= hh[i - 2] && hh[i - 1] > 0 && bearRegime) emit("macdHistTurn", -1, 0.8, "MACD 모멘텀 고점 반전(약세장)");
      }
      // ⑪ 볼린저 밴드 복귀 (이탈 후 재진입 = 되돌림 소진)
      if (bb.lower?.[i] != null && bb.lower[i - 1] != null && bb.upper?.[i] != null && bb.upper[i - 1] != null) {
        if (closes[i - 1] < bb.lower[i - 1] && c > bb.lower[i] && downLeg) emit("bbReversal", +1, 0.9, "볼린저 하단 복귀");
        if (closes[i - 1] > bb.upper[i - 1] && c < bb.upper[i] && upLeg && bearRegime) emit("bbReversal", -1, 0.9, "볼린저 상단 복귀(약세장)");
      }
      // ⑫ 볼린저 스퀴즈 돌파 (변동성 수축 → 확장 방향 추종)
      if (bbw[i - 1] != null && i >= 62) {
        let minW = Infinity;
        for (let j = i - 60; j < i; j++) if (bbw[j] != null && bbw[j] < minW) minW = bbw[j];
        const squeezed = Number.isFinite(minW) && bbw[i - 1] <= minW * 1.25;
        if (squeezed && c > bb.upper[i] && c > o && bodyI >= 0.5 * a) emit("bbSqueezeBreak", +1, 1.0, "스퀴즈 상방 돌파");
        if (squeezed && c < bb.lower[i] && c < o && bodyI >= 0.5 * a) emit("bbSqueezeBreak", -1, 1.0, "스퀴즈 하방 돌파");
      }
      // ⑬ 스토캐스틱 극단 크로스
      const sk = stoch.k, sd2 = stoch.d;
      if (sk?.[i] != null && sd2?.[i] != null && sk[i - 1] != null && sd2[i - 1] != null) {
        if (sk[i] > sd2[i] && sk[i - 1] <= sd2[i - 1] && sk[i - 1] < 25) emit("stochCross", +1, 0.8, "스토캐스틱 과매도 반등");
        if (sk[i] < sd2[i] && sk[i - 1] >= sd2[i - 1] && sk[i - 1] > 75 && bearRegime) emit("stochCross", -1, 0.8, "스토캐스틱 과매수 이탈(약세장)");
      }
      // ⑭ MFI 극단 반전 (거래량 필요)
      if (mfi?.[i] != null && mfi[i - 1] != null) {
        if (mfi[i - 1] < 20 && mfi[i] >= 20) emit("mfiReversal", +1, 0.8, "MFI 과매도 반등");
        if (mfi[i - 1] > 80 && mfi[i] <= 80 && bearRegime) emit("mfiReversal", -1, 0.8, "MFI 과매수 이탈(약세장)");
      }
      // ⑮ OBV 매집/분산 (가격 정체·하락 중 OBV 상승 = 스마트머니)
      if (obv?.[i] != null && obvEma?.[i] != null && obv[i - 5] != null && closes[i - 5] != null) {
        if (obv[i] > obvEma[i] && obv[i] > obv[i - 5] && c <= closes[i - 5]) emit("obvAccum", +1, 0.9, "OBV 매집 (가격 대비)");
        if (obv[i] < obvEma[i] && obv[i] < obv[i - 5] && c >= closes[i - 5] && bearRegime) emit("obvAccum", -1, 0.9, "OBV 분산(약세장)");
      }
      // ⑯ EMA200 리클레임/상실 (거시 레짐 전환 봉)
      if (ema200?.[i] != null && ema200[i - 1] != null) {
        if (c > ema200[i] && closes[i - 1] <= ema200[i - 1] && c > o && bodyI >= 0.5 * a) emit("ema200Reclaim", +1, 1.0, "EMA200 회복");
        if (c < ema200[i] && closes[i - 1] >= ema200[i - 1] && c < o && bodyI >= 0.5 * a) emit("ema200Reclaim", -1, 1.0, "EMA200 상실");
      }
      // ⑰ EMA20/50 골든·데드 크로스 (신선)
      if (ema50[i] != null && ema20[i - 1] != null && ema50[i - 1] != null) {
        if (ema20[i] > ema50[i] && ema20[i - 1] <= ema50[i - 1]) emit("emaCross", +1, 0.9, "EMA 골든크로스");
        if (ema20[i] < ema50[i] && ema20[i - 1] >= ema50[i - 1]) emit("emaCross", -1, 0.9, "EMA 데드크로스");
      }
      // ⑱ 쌍바닥/쌍봉 (차트 패턴 — 동일 레벨 ±0.5ATR 재시험 + 모멘텀 개선/악화)
      {
        const pls = plIdx.filter(p => p <= i - K && p >= i - 60);
        if (pls.length >= 2) {
          const p2 = pls[pls.length - 1], p1 = pls[pls.length - 2];
          if (i - K - p2 <= 5 && p2 - p1 >= 5 && Math.abs(lows[p2] - lows[p1]) <= 0.5 * a
              && c > closes[p2] + 0.5 * a && rsi[p2] != null && rsi[p1] != null && rsi[p2] > rsi[p1]) {
            emit("doubleExtreme", +1, 1.1, "쌍바닥 확인");
          }
        }
        const phs = phIdx.filter(p => p <= i - K && p >= i - 60);
        if (phs.length >= 2) {
          const p2 = phs[phs.length - 1], p1 = phs[phs.length - 2];
          if (i - K - p2 <= 5 && p2 - p1 >= 5 && Math.abs(highs[p2] - highs[p1]) <= 0.5 * a
              && c < closes[p2] - 0.5 * a && rsi[p2] != null && rsi[p1] != null && rsi[p2] < rsi[p1]) {
            emit("doubleExtreme", -1, 1.1, "쌍봉 확인");
          }
        }
      }
      // ⑲ 돌파 후 리테스트 확인 (차트 패턴 — 돌파 레벨 되밟고 지지 확인)
      if (i - lastBreakUpBar >= 1 && i - lastBreakUpBar <= 6
          && lows[i] <= lastBreakUpLvl + 0.3 * a && c > lastBreakUpLvl && c > o) {
        emit("breakRetest", +1, 1.1, "돌파 리테스트 지지 확인");
      }
      if (i - lastBreakDnBar >= 1 && i - lastBreakDnBar <= 6
          && highs[i] >= lastBreakDnLvl - 0.3 * a && c < lastBreakDnLvl && c < o && bearRegime) {
        emit("breakRetest", -1, 1.1, "이탈 리테스트 저항 확인(약세장)");
      }
      // ㉑~㉓ 과확장 소진형 (2026-07-04 4차 사전등록 — 지금까지 미검증이던 *유일한*
      //   숏 메커니즘: 반전/지속이 아닌 "과열의 되돌림". 급등 파라볼릭 꺾임을 노린다.
      //   레짐 게이트 없음 — 소진 숏은 상승장 한복판에서 발생하는 게 본질)
      {
        // ㉑ 과확장 반전: 직전 봉이 EMA20 대비 2.5ATR+ 과확장 → 첫 유의 반대 봉
        const ext1 = ema20[i - 1] != null ? (closes[i - 1] - ema20[i - 1]) / a : 0;
        if (ext1 > 2.5 && c < o && bodyI >= 0.7 * a && c < closes[i - 1]) emit("exhaustReversal", -1, 1.0, "과확장 소진 반전(↓)");
        if (ext1 < -2.5 && c > o && bodyI >= 0.7 * a && c > closes[i - 1]) emit("exhaustReversal", +1, 1.0, "과낙폭 소진 반전(↑)");
        // ㉒ 파라볼릭 꺾임: 최근 6봉 중 5봉+ 같은 방향 & 누적 4ATR+ → 첫 유의 반대 봉
        let ups = 0, dns = 0;
        for (let j = i - 6; j < i; j++) { if (closes[j] > opens[j]) ups++; else if (closes[j] < opens[j]) dns++; }
        const cum6 = closes[i - 1] - closes[i - 7];
        if (ups >= 5 && cum6 > 4 * a && c < o && bodyI >= 0.7 * a) emit("parabolicBreak", -1, 1.1, "파라볼릭 급등 꺾임");
        if (dns >= 5 && -cum6 > 4 * a && c > o && bodyI >= 0.7 * a) emit("parabolicBreak", +1, 1.1, "파라볼릭 급락 꺾임");
        // ㉓ 극단 꼬리 소진: 볼린저 밖 극단 + 긴 거부 꼬리 + 반대 종가
        const upW2 = highs[i] - Math.max(o, c), loW2 = Math.min(o, c) - lows[i];
        if (bb.upper?.[i] != null && highs[i] >= bb.upper[i] && upW2 >= 1.2 * a && upW2 >= 2 * bodyI && c < o) emit("wickExhaust", -1, 1.0, "상단 극단 꼬리 거부");
        if (bb.lower?.[i] != null && lows[i] <= bb.lower[i] && loW2 >= 1.2 * a && loW2 >= 2 * bodyI && c > o) emit("wickExhaust", +1, 1.0, "하단 극단 꼬리 거부");
      }

      // ⑳ 연속 추력 (3연속 유의 몸통 + 거래량 증가)
      if (volumes && volumes[i] != null && volumes[i - 1] != null && volumes[i - 2] != null) {
        const b0 = Math.abs(closes[i - 2] - opens[i - 2]), b1 = Math.abs(closes[i - 1] - opens[i - 1]);
        const volRising = volumes[i] > volumes[i - 1] && volumes[i - 1] > volumes[i - 2];
        if (c > o && closes[i - 1] > opens[i - 1] && closes[i - 2] > opens[i - 2]
            && bodyI >= 0.4 * a && b1 >= 0.4 * a && b0 >= 0.4 * a && volRising) emit("thrust", +1, 0.8, "3연속 상승 추력+거래량");
        if (c < o && closes[i - 1] < opens[i - 1] && closes[i - 2] < opens[i - 2]
            && bodyI >= 0.4 * a && b1 >= 0.4 * a && b0 >= 0.4 * a && volRising && bearRegime) emit("thrust", -1, 0.8, "3연속 하락 추력+거래량(약세장)");
      }
    }

    // ⑥ 거래량 확인 — 다른 증거가 있을 때만 가산 (단독 발화 금지)
    if (volumes && volSMA?.[i] > 0 && volumes[i] >= 1.5 * volSMA[i]) {
      if (longS > 0 && closes[i] > opens[i]) { longS += weights.volume; longR.push("거래량 확인"); }
      if (shortS > 0 && closes[i] < opens[i]) { shortS += weights.volume; shortR.push("거래량 확인"); }
    }

    // ── 발화 판정 ──
    //   검증 모드: 생존 요소 하나라도 발화 = 신호 (각 요소가 독립 실측 검증됨 —
    //   합류 시 score 로 강도만 표시). 리서치 모드: 임계 + 반대편 우위 규칙.
    const thEff = validated ? minScoreEff : th;
    const domEff = validated ? 0 : dominance;
    if (longS >= thEff && longS - shortS >= domEff) {
      // 쿨다운: 클러스터 억제 — 직전 롱 신호 후 N봉 내엔 점수 에스컬레이션 시에만
      if (i - lastLongBar > cooldown || longS > lastLongScore + 0.5) {
        signals.push({ i, dir: +1, score: +longS.toFixed(2), opposing: +shortS.toFixed(2), reasons: longR });
        lastLongBar = i; lastLongScore = longS;
      }
    } else if (shortS >= thEff && shortS - longS >= domEff) {
      if (i - lastShortBar > cooldown || shortS > lastShortScore + 0.5) {
        signals.push({ i, dir: -1, score: +shortS.toFixed(2), opposing: +longS.toFixed(2), reasons: shortR });
        lastShortBar = i; lastShortScore = shortS;
      }
    }
    if (i === n - 1) latest = { longScore: +longS.toFixed(2), shortScore: +shortS.toFixed(2), reasons: longR, threshold: thEff };
  }

  return { signals, factorEvents: factorEvents || [], latest };
}

export default { computeTimingSignals, TIMING_WEIGHTS, TIMING_TH, TIMING_DOMINANCE };
