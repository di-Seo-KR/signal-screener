// ════════════════════════════════════════════════════════════════════
// sr-levels — 지지·저항(매물대) 레벨 계산 (표시 전용, 매매 로직 무관)
//
// ★ 2026-06-12 (대표 지시): 시그널 종목 카드에 "중요 매물대(지지·저항) 실시간" 표시.
//   btc-cron 이 이미 보유한 일봉 캔들로 계산(추가 API 0회) → 시그널 풀 엔트리에 동승.
//
// 알고리즘 (DEV-ARCH 설계 확정안):
//   주: 최근 N=60 완결 일봉의 스윙 고저점(좌우 k=2 엄격 극값) → 상대 0.5% 클러스터
//       병합(터치 가중평균) → 터치 횟수 + 최근성 보너스로 강도 산정 →
//       현재가 아래 지지 2개·위 저항 2개 (가까운 순, 터치 2회+ 우선).
//   보조: 전일 완결 캔들 피봇(P=(H+L+C)/3, S1/S2/R1/R2) — 빈자리 보충(t:0 마커).
//
// 출력 스키마 (SSOT — coin-scores → 프론트 카드가 그대로 사용):
//   { s: [{p, t, d}], r: [{p, t, d}], piv, px, m }
//   p=레벨가(toPrecision 5), t=터치횟수(피봇 보충=0), d=기준가 대비 거리%(지지 음수),
//   px=계산 기준가(마지막 일봉 종가), m="cluster"|"mixed"|"pivot"
//   계산 불가 시 null.
// ════════════════════════════════════════════════════════════════════

const round5 = (x) => Number(Number(x).toPrecision(5));
const round1 = (x) => Number(Number(x).toFixed(1));

/** 전일 완결 캔들 클래식 피봇 — {P, S1, S2, R1, R2} 또는 null */
function classicPivot(candles) {
  const prev = candles[candles.length - 2]; // 마지막(진행 중) 제외한 완결 캔들
  if (!prev) return null;
  const H = Number(prev.high), L = Number(prev.low), C = Number(prev.close);
  if (![H, L, C].every((v) => Number.isFinite(v) && v > 0)) return null;
  const P = (H + L + C) / 3;
  return { P, R1: 2 * P - L, S1: 2 * P - H, R2: P + (H - L), S2: P - (H - L) };
}

/** 피봇 전용 폴백 — 스윙 데이터 부족 시 */
function pivotOnly(candles, refPrice) {
  const piv = classicPivot(candles);
  if (!piv || !(refPrice > 0)) return null;
  const mk = (p) => ({ p: round5(p), t: 0, d: round1((p / refPrice - 1) * 100) });
  // ★ 거리 캡 ±25% — 초변동 코인(신규상장 등)의 피봇 폭주 차단 (2026-06-12 라이브 실측 보강)
  const s = [piv.S1, piv.S2].filter((p) => p > 0 && p < refPrice * 0.998 && p > refPrice * 0.75).map(mk);
  const r = [piv.R1, piv.R2].filter((p) => p > refPrice * 1.002 && p < refPrice * 1.25).map(mk);
  if (s.length === 0 && r.length === 0) return null;
  return { s, r, piv: round5(piv.P), px: round5(refPrice), m: "pivot" };
}

/** 최근 N일 실제 고점·저점 폴백 — 피봇이 ±캡 밖으로 폭주하는 초변동 코인 대응
 *  (2026-06-14 대표 제보: SIREN·VELVET 등 지지/저항 미표시). 실제 거래 가격이라 정직. */
function recentRangeBand(candles, refPrice, N = 20) {
  if (!Array.isArray(candles) || !(refPrice > 0)) return null;
  const win = candles.slice(-N);
  if (win.length < 5) return null;
  const highs = win.map((c) => Number(c.high)).filter((v) => Number.isFinite(v) && v > 0);
  const lows = win.map((c) => Number(c.low)).filter((v) => Number.isFinite(v) && v > 0);
  if (!highs.length || !lows.length) return null;
  const hi = Math.max(...highs), lo = Math.min(...lows), mid = (hi + lo) / 2;
  const mk = (p) => ({ p: round5(p), t: 1, d: round1((p / refPrice - 1) * 100) });
  const s = [], r = [];
  if (lo < refPrice * 0.998) s.push(mk(lo));        // 최근 저점 = 지지
  if (mid < refPrice * 0.998) s.push(mk(mid));      // 중간값 보강
  if (hi > refPrice * 1.002) r.push(mk(hi));        // 최근 고점 = 저항
  if (mid > refPrice * 1.002) r.push(mk(mid));
  if (!s.length && !r.length) return null;
  return { s: s.slice(0, 2), r: r.slice(0, 2), piv: round5(mid), px: round5(refPrice), m: "range" };
}

/**
 * 거래량 프로파일(volume-by-price) — "진짜 매물대" = 실제 거래량이 쌓인 가격대.
 * ★ 2026-06-15 (S/R Phase2, 대표 지시 "너무 약한 매물대"): 일봉 거래량을 가격 빈에
 *   분배(각 봉 volume 을 [low,high] 스팬에 균등) → 히스토그램 → POC(최대 거래량 가격)·
 *   Value Area(POC 중심 70% 누적 구간의 상/하단 VAH/VAL). 추가 API 0회(보유 일봉 재사용).
 * @returns {{poc:number, vah:number, val:number}|null}
 */
export function computeVolumeProfile(candles, { N = 90, bins = 40, valuePct = 0.7 } = {}) {
  if (!Array.isArray(candles) || candles.length < 15) return null;
  const win = candles.slice(0, -1).slice(-N); // 진행 중 봉 제외 + 최근 N (vp 는 긴 히스토리 선호)
  if (win.length < 15) return null;
  let pMin = Infinity, pMax = -Infinity;
  for (const c of win) {
    const h = Number(c.high), l = Number(c.low);
    if (Number.isFinite(h)) pMax = Math.max(pMax, h);
    if (Number.isFinite(l)) pMin = Math.min(pMin, l);
  }
  if (!Number.isFinite(pMin) || !Number.isFinite(pMax) || !(pMax > pMin)) return null;
  const binSize = (pMax - pMin) / bins;
  if (!(binSize > 0)) return null;
  const vol = new Array(bins).fill(0);
  let total = 0;
  for (const c of win) {
    const h = Number(c.high), l = Number(c.low), v = Number(c.volume) || 0;
    if (!Number.isFinite(h) || !Number.isFinite(l) || v <= 0) continue;
    const loBin = Math.max(0, Math.min(bins - 1, Math.floor((l - pMin) / binSize)));
    const hiBin = Math.max(0, Math.min(bins - 1, Math.floor((h - pMin) / binSize)));
    const span = hiBin - loBin + 1;
    const per = v / span;
    for (let b = loBin; b <= hiBin; b++) vol[b] += per;
    total += v;
  }
  if (!(total > 0)) return null;
  let pocBin = 0;
  for (let b = 1; b < bins; b++) if (vol[b] > vol[pocBin]) pocBin = b;
  // Value Area — POC 중심으로 인접 고볼륨 빈을 확장해 valuePct(70%) 누적
  let lo = pocBin, hi = pocBin, acc = vol[pocBin];
  const target = total * valuePct;
  let guard = 0;
  while (acc < target && (lo > 0 || hi < bins - 1) && guard++ < bins * 2) {
    const below = lo > 0 ? vol[lo - 1] : -1;
    const above = hi < bins - 1 ? vol[hi + 1] : -1;
    if (above >= below) { hi += 1; acc += vol[hi]; }
    else { lo -= 1; acc += vol[lo]; }
  }
  return {
    poc: round5(pMin + (pocBin + 0.5) * binSize),
    vah: round5(pMin + (hi + 1) * binSize),
    val: round5(pMin + lo * binSize),
  };
}

/**
 * 지지·저항 레벨 계산.
 * @param {Array<{high:number,low:number,close:number}>} dailyCandles 일봉(과거→최신)
 * @param {number} refPrice 기준가(보통 마지막 일봉 종가)
 */
export function computeSRLevels(dailyCandles, refPrice, { N = 60, k = 2, tol = 0.005 } = {}) {
  try {
    if (!Array.isArray(dailyCandles) || !(refPrice > 0)) return null;
    // ★ Phase2: 거래량 프로파일 — 함수 상단 1회 계산해 모든 return 경로(메인+폴백)에 부착.
    const vp = process.env.ZEPTA_SR_VOLPROFILE !== "0" ? computeVolumeProfile(dailyCandles) : null;
    const attach = (res) => (res ? { ...res, vp: res.vp ?? (vp || null) } : res);
    // 진행 중인 마지막 일봉 제외(고저 미확정) + 최근 N개 윈도우
    const win = dailyCandles.slice(0, -1).slice(-N);
    if (win.length < 2 * k + 3) return attach(pivotOnly(dailyCandles, refPrice) || recentRangeBand(dailyCandles, refPrice));

    // 1) 스윙 고저점 — 좌우 k개보다 엄격히 높/낮은 극값
    const swings = [];
    for (let i = k; i < win.length - k; i++) {
      let isHigh = true, isLow = true;
      for (let j = i - k; j <= i + k; j++) {
        if (j === i) continue;
        if (win[j].high >= win[i].high) isHigh = false;
        if (win[j].low <= win[i].low) isLow = false;
      }
      if (isHigh && Number.isFinite(win[i].high)) swings.push({ p: win[i].high, idx: i });
      if (isLow && Number.isFinite(win[i].low)) swings.push({ p: win[i].low, idx: i });
    }
    if (swings.length === 0) return attach(pivotOnly(dailyCandles, refPrice) || recentRangeBand(dailyCandles, refPrice));

    // 2) 가격순 1-pass 병합 (상대 tol — 미세가격 코인 과병합 방지)
    swings.sort((a, b) => a.p - b.p);
    const clusters = [];
    for (const sw of swings) {
      const last = clusters[clusters.length - 1];
      if (last && (sw.p - last.p) / last.p <= tol) {
        last.p = (last.p * last.t + sw.p) / (last.t + 1);
        last.t += 1;
        last.lastIdx = Math.max(last.lastIdx, sw.idx);
      } else {
        clusters.push({ p: sw.p, t: 1, lastIdx: sw.idx });
      }
    }
    // 3) 강도 = 터치 + 최근성 보너스(마지막 터치가 10봉 이내면 +0.5)
    for (const c of clusters) c.w = c.t + (win.length - 1 - c.lastIdx <= 10 ? 0.5 : 0);

    // 3.5) ★ Phase2: 거래량 프로파일 — 볼륨이 뒷받침하는 레벨(진짜 매물대)에 강도 가점.
    //   POC(최대 거래량 가격) 일치 +1.2 / VAH·VAL 일치 +0.6 → pickTwo 점수↑ → 볼륨 확인 레벨 선택.
    //   ZEPTA_SR_VOLPROFILE=0 으로 끔. vp 는 출력에 동승(표시용 — 코인 카드 매물대 시각화).
    if (vp) {
      for (const c of clusters) {
        if (vp.poc && Math.abs(c.p - vp.poc) / vp.poc <= tol) c.w += 1.2;
        else if ((vp.vah && Math.abs(c.p - vp.vah) / vp.vah <= tol) ||
                 (vp.val && Math.abs(c.p - vp.val) / vp.val <= tol)) c.w += 0.6;
      }
    }

    // 4) 현재가 분리 — ★ 2026-06-14 고도화(대표 지시): 최소거리 0.2%→0.8% (너무 붙은
    //   노이즈 레벨 제외, "actionable 매물대"만). env ZEPTA_SR_MIN_DIST_PCT(기본 0.8). 캡 ±25%.
    const _md = Number(process.env.ZEPTA_SR_MIN_DIST_PCT);
    const minDist = (Number.isFinite(_md) && _md > 0 ? _md : 0.8) / 100;
    const below = clusters.filter((c) => c.p < refPrice * (1 - minDist) && c.p > refPrice * 0.75);
    const above = clusters.filter((c) => c.p > refPrice * (1 + minDist) && c.p < refPrice * 1.25);

    // 5) ★ 고도화: 강도 가중 선별 — 기존엔 '가까운 순'(거리)으로만 골라 약한 근접 레벨이
    //   뽑혔음. 이제 강도(w=터치+최근성)가 강한 레벨을 우선(터치 2회+ 먼저), 같은 등급 안에선
    //   '강도/(1+거리%)' 점수순 → 강한 레벨이 살짝 멀어도 약한 근접 레벨을 이김. 표시는 가까운 순.
    //   ZEPTA_SR_V2=0 이면 기존 동작 복귀.
    const v2 = process.env.ZEPTA_SR_V2 !== "0";
    const pickTwo = (cands) => {
      let chosen;
      if (v2) {
        const score = (c) => (c.w || c.t) / (1 + Math.abs(c.p - refPrice) / refPrice * 100);
        const strong = cands.filter((c) => c.t >= 2).sort((a, b) => score(b) - score(a));
        const weak = cands.filter((c) => c.t < 2).sort((a, b) => score(b) - score(a));
        chosen = [...strong, ...weak].slice(0, 2); // 강한 레벨 우선, 부족하면 약한 레벨로 채움
      } else {
        const sorted = [...cands].sort((a, b) => Math.abs(a.p - refPrice) - Math.abs(b.p - refPrice));
        const strong = sorted.filter((c) => c.t >= 2);
        chosen = [];
        for (const c of sorted) {
          if (chosen.length === 2) break;
          if (c.t >= 2) { chosen.push(c); continue; }
          const blocked = strong.some((x) => !chosen.includes(x) && Math.abs(x.p - refPrice) <= 1.5 * Math.abs(c.p - refPrice));
          if (!blocked) chosen.push(c);
        }
      }
      return chosen
        .sort((a, b) => Math.abs(a.p - refPrice) - Math.abs(b.p - refPrice))
        .map((c) => ({ p: round5(c.p), t: c.t, d: round1((c.p / refPrice - 1) * 100) }));
    };
    let s = pickTwo(below);
    let r = pickTwo(above);

    // 6) 피봇 보충(t:0) — 방향 검증 필수 (추세장에선 S1 이 현재가 위일 수 있음)
    const piv = classicPivot(dailyCandles);
    let usedPivotFill = false;
    if (piv) {
      const mkFill = (p) => ({ p: round5(p), t: 0, d: round1((p / refPrice - 1) * 100) });
      // ★ 보충 후보도 거리 캡 ±25% 적용 — 초변동 코인의 피봇 폭주 차단 (라이브 실측 보강)
      if (s.length < 2) {
        for (const cand of [piv.S1, piv.S2]) {
          if (s.length >= 2) break;
          if (cand > 0 && cand < refPrice * 0.998 && cand > refPrice * 0.75 && !s.some((x) => Math.abs(x.p - cand) / cand < tol)) {
            s.push(mkFill(cand)); usedPivotFill = true;
          }
        }
        s.sort((a, b) => Math.abs(a.p - refPrice) - Math.abs(b.p - refPrice));
      }
      if (r.length < 2) {
        for (const cand of [piv.R1, piv.R2]) {
          if (r.length >= 2) break;
          if (cand > refPrice * 1.002 && cand < refPrice * 1.25 && !r.some((x) => Math.abs(x.p - cand) / cand < tol)) {
            r.push(mkFill(cand)); usedPivotFill = true;
          }
        }
        r.sort((a, b) => Math.abs(a.p - refPrice) - Math.abs(b.p - refPrice));
      }
    }
    if (s.length === 0 && r.length === 0) return attach(pivotOnly(dailyCandles, refPrice) || recentRangeBand(dailyCandles, refPrice));

    const hasCluster = s.some((x) => x.t > 0) || r.some((x) => x.t > 0);
    const m = hasCluster ? (usedPivotFill ? "mixed" : "cluster") : "pivot";
    return attach({ s, r, piv: piv ? round5(piv.P) : null, px: round5(refPrice), m });
  } catch {
    return null; // 표시 전용 — 어떤 실패도 호출부를 막지 않음
  }
}

/** 1000-단위 선물(1000SHIBUSDT 등) → 현물 표시 스케일 환산 (btc-cron priceMap 규칙 미러) */
export function scaleSR(sr, factor) {
  if (!sr || !Number.isFinite(factor) || factor <= 0) return sr;
  const sc = (arr) => (arr || []).map((x) => ({ ...x, p: round5(x.p * factor) })); // d(%)는 불변
  return {
    ...sr,
    s: sc(sr.s),
    r: sc(sr.r),
    piv: sr.piv != null ? round5(sr.piv * factor) : null,
    px: sr.px != null ? round5(sr.px * factor) : null,
    vp: sr.vp ? {
      poc: Number.isFinite(sr.vp.poc) ? round5(sr.vp.poc * factor) : sr.vp.poc,
      vah: Number.isFinite(sr.vp.vah) ? round5(sr.vp.vah * factor) : sr.vp.vah,
      val: Number.isFinite(sr.vp.val) ? round5(sr.vp.val * factor) : sr.vp.val,
    } : null,
  };
}
