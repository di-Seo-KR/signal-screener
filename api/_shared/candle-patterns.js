// ════════════════════════════════════════════════════════════════════
// Zepta — 캔들 패턴 감지 + 컨텍스트 게이트 + 캘리브레이션 융합 (2026-07)
// ────────────────────────────────────────────────────────────────────
// 백엔드(btc-cron·전략 정제 레이어)와 프론트(ChartModal 타이밍 마커)가
// *같은 모듈*을 공유한다 — 이중 구현 금지(차트에 보이는 신호 = 스코어에
// 반영되는 신호). 순수 ESM, 네트워크/노드 API 의존 없음.
//
// 설계 근거 (2026-07 웹 리서치 — Bulkowski 2만+ 표본, Chan et al. 2021
// IEEE 크립토 23코인, Lu et al. 2012 Rev.Fin.Econ, Marshall et al. 2006):
//   1) 캔들 패턴은 *단독으로는 무작위* (크립토 직접 연구에서 전 패턴 무효).
//      → 컨텍스트 게이트(추세 레그 + S/R 근접 [+ 거래량]) 통과 시에만 발화.
//      게이트 미통과 = 0점. "패턴 나오면 무조건 가점" 구조 금지.
//   2) 통계 우위가 재현된 6개 패밀리만 채택 (샛별/석별 1.0 > 관통 0.9 >
//      장악 0.7 > 적삼병/흑삼병 0.6 > 흑운 0.5 > 망치 0.4).
//      교수형·역망치·유성·도지·집게·인사이드/아웃사이드바·마루보즈·핀바는
//      제외 — 통계가 무작위(50~59%)거나 속설과 *반대*(교수형=강세지속 59%)
//      거나 기존 모듈(S/R 터치·변동성 압축·장악형)과 정보 중복.
//   3) 크립토 24h 시장은 갭이 없다 → 갭 요구 전면 제거, 중간값 침투·몸통
//      장악을 본질 조건으로 재정의. 모든 크기 임계는 ATR14 상대화(고정 % 금지).
//   4) 확정봉만 감지(진행봉 감지 = 리페인팅/룩어헤드). 같은 봉에 복수 패턴이
//      떠도 방향별 max 하나만 반영(sum 금지 — 이중 카운트 방지).
//   5) TF 신뢰 서열: 일봉≥주봉 > 4h(×0.75) > 1h(×0.5) > 1h 미만(0 — 스캔 금지).
//   6) 가중치는 교과서가 아니라 *우리 코인 과거 데이터 캘리브레이션*이 최종
//      결정 (candle-calibration.js — scripts/calibrate-candle-patterns.mjs 산출).
//      실측 엣지가 0 이하인 패턴×TF 조합은 mult=0 으로 완전 꺼진다.
// ════════════════════════════════════════════════════════════════════

import { calcEMA, calcSMA } from "./strategies/_indicators.js";
import { CANDLE_CALIB } from "./candle-calibration.js";

// 패턴 정의: base = 리서치 근거 상대가중(블록 내), dir = +1 강세 / -1 약세
export const PATTERN_DEFS = {
  morning_star:      { ko: "샛별형",   base: 1.0, dir: +1 },
  evening_star:      { ko: "석별형",   base: 1.0, dir: -1 },
  piercing:          { ko: "관통형",   base: 0.9, dir: +1 },
  dark_cloud:        { ko: "흑운형",   base: 0.5, dir: -1 },
  bullish_engulfing: { ko: "상승장악", base: 0.7, dir: +1 },
  bearish_engulfing: { ko: "하락장악", base: 0.7, dir: -1 },
  three_soldiers:    { ko: "적삼병",   base: 0.6, dir: +1 },
  three_crows:       { ko: "흑삼병",   base: 0.6, dir: -1 },
  hammer:            { ko: "망치형",   base: 0.4, dir: +1 },
};

// TF 신뢰 가중 — 리서치: 일봉 최적, 15분 이하 노이즈 무효(스캔 자체 금지)
export function tfWeight(tf) {
  const t = String(tf || "").toLowerCase();
  if (t === "1d" || t === "1w" || t === "1wk" || t === "1mo" || t === "1m_month") return 1.0;
  if (t === "4h") return 0.75;
  if (t === "1h" || t === "60m") return 0.5;
  return 0; // 10m/15m/30m 등 저TF — 패턴 스캔 무효
}

// 캘리브레이션 mult 조회 — 실측 데이터가 해당 패턴×TF 를 지지하지 않으면 0
function calibMult(name, tf, calib) {
  const table = calib === undefined ? CANDLE_CALIB : calib; // null = 캘리브레이션 무시(원가중)
  if (!table) return 1.0;
  const tfKey = ({ "1wk": "1d", "1w": "1d", "1mo": "1d" })[tf] || tf; // 상위 TF 는 일봉 캘리브 준용
  const e = table?.[tfKey]?.[name];
  if (!e) return 0.6; // 실측 표본 없음 → 보수 할인
  return e.mult;
}

// ── 내부: ATR14 (SMA of TR — _indicators.calcATR 과 동일 방식, 배열 정렬 보장) ──
function atrSeries(highs, lows, closes, period = 14) {
  const n = closes.length;
  const tr = new Array(n).fill(null);
  for (let i = 1; i < n; i++) {
    tr[i] = Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1]));
  }
  const out = new Array(n).fill(null);
  let sum = 0, cnt = 0;
  for (let i = 1; i < n; i++) {
    sum += tr[i]; cnt++;
    if (cnt > period) { sum -= tr[i - period]; cnt = period; }
    if (cnt === period) out[i] = sum / period;
  }
  return out;
}

// ── 내부: 스윙 피벗 기반 S/R 레벨 (fractal k=2, 0.5ATR 클러스터, 터치≥2) ──
//   백엔드 sr 스키마(매물대)가 있으면 caller 가 srLevels 로 주입해 대체 가능.
function swingLevels(highs, lows, endIdx, atr, lookback = 120) {
  const start = Math.max(2, endIdx - lookback);
  const pivots = [];
  for (let i = start; i <= endIdx - 2; i++) {
    if (highs[i] > highs[i - 1] && highs[i] > highs[i - 2] && highs[i] > highs[i + 1] && highs[i] > highs[i + 2]) pivots.push(highs[i]);
    if (lows[i] < lows[i - 1] && lows[i] < lows[i - 2] && lows[i] < lows[i + 1] && lows[i] < lows[i + 2]) pivots.push(lows[i]);
  }
  if (!pivots.length || !(atr > 0)) return [];
  pivots.sort((a, b) => a - b);
  const clusters = []; // {p(평균), t(터치수)}
  for (const p of pivots) {
    const last = clusters[clusters.length - 1];
    if (last && Math.abs(p - last.p) <= 0.5 * atr) { last.p = (last.p * last.t + p) / (last.t + 1); last.t++; }
    else clusters.push({ p, t: 1 });
  }
  return clusters.filter(c => c.t >= 2);
}

// ════════════════════════════════════════════════════════════════════
// analyzeCandleSeries — 시리즈 전체 스캔 (차트 마커·캘리브레이션용)
//   입력 배열은 과거→최신 오름차순. 마지막 봉이 진행 중이면 caller 가
//   미리 잘라서 넘길 것(확정봉 원칙). volumes 없으면(코인게코 등)
//   거래량 게이트가 "필수"인 패턴(망치형)은 비활성, 보너스는 미적용.
// 반환: events[] = {i, name, ko, dir, w, volBonus, reasons[]}
//   w = base × calibMult × tfWeight (volBonus 별도 — caller 가 ×1.2 선택)
// ════════════════════════════════════════════════════════════════════
export function analyzeCandleSeries({ opens, highs, lows, closes, volumes }, { tf = "1d", calib, srLevels = null, startIdx = null } = {}) {
  const n = closes?.length || 0;
  const tfW = tfWeight(tf);
  if (!opens || !highs || !lows || n < 30 || tfW === 0) return { events: [], tfW };

  const atr = atrSeries(highs, lows, closes, 14);
  const ema20 = calcEMA(closes, 20);
  const volSMA = volumes ? calcSMA(volumes, 20) : null;
  const events = [];
  const s0 = Math.max(21, startIdx == null ? 21 : startIdx);

  for (let i = s0; i < n; i++) {
    const a = atr[i];
    if (!(a > 0)) continue;

    // ── 컨텍스트 (봉 i 종가 시점 — 미래 데이터 참조 없음) ──
    const price = closes[i];
    const downLeg = (ema20[i] != null && price < ema20[i]) || (closes[i - 10] != null && price < closes[i - 10]);
    const upLeg = (ema20[i] != null && price > ema20[i]) || (closes[i - 10] != null && price > closes[i - 10]);
    const levels = (Array.isArray(srLevels) && srLevels.length) ? srLevels : swingLevels(highs, lows, i, a); // 빈 배열 주입 시 스윙 폴백 (적대리뷰 P2-5)
    let nearSup = false, nearRes = false;
    for (const lv of levels) {
      const d = Math.abs(price - lv.p);
      if (d <= 1.5 * a) { if (lv.p <= price + 0.25 * a) nearSup = true; if (lv.p >= price - 0.25 * a) nearRes = true; }
    }
    // 거래량 확인: true(확인) / false(미달) / null(데이터 없음 — 판단 불가)
    const volConfirm = (volumes && volSMA?.[i] > 0 && volumes[i] != null)
      ? volumes[i] >= 1.5 * volSMA[i] : null;
    const volAbove = (volumes && volSMA?.[i] > 0 && volumes[i] != null)
      ? volumes[i] >= volSMA[i] : null;

    // ── 봉 해부 ──
    const o = opens[i], h = highs[i], l = lows[i], c = closes[i];
    const o1 = opens[i - 1], c1 = closes[i - 1];
    const o2 = opens[i - 2], c2 = closes[i - 2];
    if (![o, h, l, c, o1, c1, o2, c2].every(Number.isFinite)) continue;
    const body = Math.abs(c - o), rng = h - l;
    const body1 = Math.abs(c1 - o1), body2 = Math.abs(c2 - o2);
    const upW = h - Math.max(o, c), loW = Math.min(o, c) - l;
    const bull = c > o, bear = c < o;
    const bull1 = c1 > o1, bear1 = c1 < o1;
    const found = []; // {name, volBonus, why}

    // ① 샛별/석별 (3봉 반전 — 크립토: 갭 요구 제거, 중간값 회복이 본질)
    if (bear2(o2, c2) && body2 >= 0.7 * a && body1 <= 0.3 * body2 && bull && body >= 0.5 * a && c >= (o2 + c2) / 2) {
      if (downLegAt(i - 2) && nearSup) found.push({ name: "morning_star", volBonus: volAbove === true, why: "장대음봉→소체→중간값 회복" });
    }
    if (bull2(o2, c2) && body2 >= 0.7 * a && body1 <= 0.3 * body2 && bear && body >= 0.5 * a && c <= (o2 + c2) / 2) {
      if (upLegAt(i - 2) && nearRes) found.push({ name: "evening_star", volBonus: volAbove === true, why: "장대양봉→소체→중간값 하회" });
    }

    // ② 관통형/흑운형 (2봉 — 갭 대신 ±0.1ATR 허용오차, 중간값 침투 본질)
    if (bear1 && body1 >= 0.5 * a && bull && o <= c1 + 0.1 * a && c > (o1 + c1) / 2 && c < o1) {
      if (downLeg && nearSup) found.push({ name: "piercing", volBonus: volConfirm === true, why: "음봉 중간값 상향 침투" });
    }
    if (bull1 && body1 >= 0.5 * a && bear && o >= c1 - 0.1 * a && c < (o1 + c1) / 2 && c > o1) {
      if (upLeg && nearRes) found.push({ name: "dark_cloud", volBonus: volConfirm === true, why: "양봉 중간값 하향 침투" });
    }

    // ③ 장악형 (몸통 장악 + ATR 유의 크기 — 초소형 캔들 노이즈 차단)
    if (bear1 && bull && body >= 1.2 * body1 && body >= 0.5 * a && body1 >= 0.05 * a
        && c >= Math.max(o1, c1) && o <= Math.min(o1, c1) + 0.1 * a) {
      if (downLeg && nearSup) found.push({ name: "bullish_engulfing", volBonus: volConfirm === true, why: "직전 음봉 몸통 장악" });
    }
    if (bull1 && bear && body >= 1.2 * body1 && body >= 0.5 * a && body1 >= 0.05 * a
        && c <= Math.min(o1, c1) && o >= Math.max(o1, c1) - 0.1 * a) {
      if (upLeg && nearRes) found.push({ name: "bearish_engulfing", volBonus: volConfirm === true, why: "직전 양봉 몸통 장악" });
    }

    // ④ 적삼병/흑삼병 (추세 *확인*용 — 반전 아님. 과확장 가드 필수: 소진 추격 방지)
    {
      const b0 = closes[i - 2] > opens[i - 2], b1b = closes[i - 1] > opens[i - 1];
      const rng1 = highs[i - 1] - lows[i - 1], rng2 = highs[i - 2] - lows[i - 2];
      const closePos = rng > 0 ? (c - l) / rng : 0;
      const closePos1 = rng1 > 0 ? (closes[i - 1] - lows[i - 1]) / rng1 : 0;
      const closePos2 = rng2 > 0 ? (closes[i - 2] - lows[i - 2]) / rng2 : 0;
      if (b0 && b1b && bull && body2 >= 0.5 * a && body1 >= 0.5 * a && body >= 0.5 * a
          && closes[i - 1] > closes[i - 2] && c > closes[i - 1]
          && closePos >= 0.6 && closePos1 >= 0.6 && closePos2 >= 0.6
          && (c - opens[i - 2]) <= 3.2 * a && upLeg) {
        found.push({ name: "three_soldiers", volBonus: volAbove === true, why: "3연속 유의 양봉(과확장 아님)" });
      }
      if (!b0 && !b1b && bear && body2 >= 0.5 * a && body1 >= 0.5 * a && body >= 0.5 * a
          && closes[i - 1] < closes[i - 2] && c < closes[i - 1]
          && closePos <= 0.4 && closePos1 <= 0.4 && closePos2 <= 0.4
          && (opens[i - 2] - c) <= 3.2 * a && downLeg) {
        found.push({ name: "three_crows", volBonus: volAbove === true, why: "3연속 유의 음봉(과확장 아님)" });
      }
    }

    // ⑤ 망치형 — 근거 최하위: 3중 게이트 *전부* 필수 (하락레그+지지근접+거래량 1.5×).
    //   거래량 데이터 없으면(volConfirm=null) 발화 금지 — 게이트 판단 불가는 미채택.
    if (loW >= 2 * Math.max(body, 0.05 * a) && upW <= Math.max(body * 0.6, 0.1 * a)
        && rng >= 0.8 * a && rng > 0 && (c - l) / rng >= 0.6) {
      if (downLeg && nearSup && volConfirm === true) {
        found.push({ name: "hammer", volBonus: false, why: "지지+하락레그+거래량 3중 게이트 통과" });
      }
    }

    // ── 방향별 max 채택 (이중 카운트 금지) ──
    let bestBull = null, bestBear = null;
    for (const f of found) {
      const def = PATTERN_DEFS[f.name];
      const w = def.base * calibMult(f.name, tf, calib) * tfW;
      if (w <= 0) continue;
      const ev = { i, name: f.name, ko: def.ko, dir: def.dir, w, volBonus: f.volBonus, reasons: [f.why] };
      if (def.dir > 0) { if (!bestBull || w > bestBull.w) bestBull = ev; }
      else { if (!bestBear || w > bestBear.w) bestBear = ev; }
    }
    if (bestBull) events.push(bestBull);
    if (bestBear) events.push(bestBear);
  }

  return { events, tfW };

  // ── 지역 헬퍼 (호이스팅 이용 — i-2 시점 추세 레그) ──
  function bear2(o_, c_) { return c_ < o_; }
  function bull2(o_, c_) { return c_ > o_; }
  function downLegAt(j) { return (ema20[j] != null && closes[j] < ema20[j]) || (closes[j - 10] != null && closes[j] < closes[j - 10]); }
  function upLegAt(j) { return (ema20[j] != null && closes[j] > ema20[j]) || (closes[j - 10] != null && closes[j] > closes[j - 10]); }
}

// ════════════════════════════════════════════════════════════════════
// scoreCandleBlock — 정제 레이어(refineSignalScore)용 단일 시점 평가.
//   마지막 확정봉에서 끝나는 패턴만 평가 (lastBarClosed=false 면 L-1).
//   반환 {bull, bear, notes[]} — bull/bear ∈ [0, ~1.5] (base×calib×tfW×volBonus)
//   같은 (closes 배열 참조, tf) 호출은 WeakMap 메모 — 9전략이 같은 배열을
//   공유하므로 cron 한 사이클에 자산×TF당 1회만 계산.
// ════════════════════════════════════════════════════════════════════
const _blockMemo = new WeakMap();
export function scoreCandleBlock({ opens, highs, lows, closes, volumes, tf = "1d", lastBarClosed = true, calib }) {
  const EMPTY = { bull: 0, bear: 0, bullNote: "", bearNote: "", notes: [] };
  if (!opens || !closes || closes.length < 30 || tfWeight(tf) === 0) return EMPTY;
  // 메모 키에 tf+lastBarClosed 포함, calib 명시 주입 시 메모 우회 (적대리뷰 P2-4: stale 반환 함정 제거)
  const memoKey = `${tf}|${lastBarClosed}`;
  const memoable = calib === undefined;
  let byTf = memoable ? _blockMemo.get(closes) : null;
  if (byTf?.[memoKey]) return byTf[memoKey];

  const endEx = lastBarClosed ? closes.length : closes.length - 1; // 진행봉 제외
  const li = endEx - 1; // 마지막 확정봉 인덱스
  if (li < 25) return EMPTY;
  const slice = (arr) => arr ? arr.slice(0, endEx) : arr;
  const { events } = analyzeCandleSeries(
    { opens: slice(opens), highs: slice(highs), lows: slice(lows), closes: slice(closes), volumes: slice(volumes) },
    { tf, calib, startIdx: li } // 마지막 확정봉만 스캔
  );
  let bull = 0, bear = 0, bullNote = "", bearNote = "";
  for (const ev of events) {
    if (ev.i !== li) continue;
    const eff = ev.w * (ev.volBonus ? 1.2 : 1.0);
    const label = `${ev.ko}${ev.volBonus ? "+량" : ""}`;
    if (ev.dir > 0) { if (eff > bull) { bull = eff; bullNote = label; } }
    else { if (eff > bear) { bear = eff; bearNote = label; } }
  }
  const out = { bull, bear, bullNote, bearNote, notes: [bullNote, bearNote].filter(Boolean) };
  if (memoable) {
    if (!byTf) { byTf = {}; _blockMemo.set(closes, byTf); }
    byTf[memoKey] = out;
  }
  return out;
}

export default { PATTERN_DEFS, tfWeight, analyzeCandleSeries, scoreCandleBlock };
