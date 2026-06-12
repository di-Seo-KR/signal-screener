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
  const s = [piv.S1, piv.S2].filter((p) => p > 0 && p < refPrice * 0.998).map(mk);
  const r = [piv.R1, piv.R2].filter((p) => p > refPrice * 1.002).map(mk);
  if (s.length === 0 && r.length === 0) return null;
  return { s, r, piv: round5(piv.P), px: round5(refPrice), m: "pivot" };
}

/**
 * 지지·저항 레벨 계산.
 * @param {Array<{high:number,low:number,close:number}>} dailyCandles 일봉(과거→최신)
 * @param {number} refPrice 기준가(보통 마지막 일봉 종가)
 */
export function computeSRLevels(dailyCandles, refPrice, { N = 60, k = 2, tol = 0.005 } = {}) {
  try {
    if (!Array.isArray(dailyCandles) || !(refPrice > 0)) return null;
    // 진행 중인 마지막 일봉 제외(고저 미확정) + 최근 N개 윈도우
    const win = dailyCandles.slice(0, -1).slice(-N);
    if (win.length < 2 * k + 3) return pivotOnly(dailyCandles, refPrice);

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
    if (swings.length === 0) return pivotOnly(dailyCandles, refPrice);

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

    // 4) 현재가 분리(±0.2% 버퍼) + 유효거리 캡 ±25%
    const below = clusters.filter((c) => c.p < refPrice * 0.998 && c.p > refPrice * 0.75);
    const above = clusters.filter((c) => c.p > refPrice * 1.002 && c.p < refPrice * 1.25);

    // 5) 가까운 순 + 터치 2회 이상 우선 (1터치는 1.5배 거리 내 강클러스터 없을 때만)
    const pickTwo = (cands) => {
      const sorted = [...cands].sort((a, b) => Math.abs(a.p - refPrice) - Math.abs(b.p - refPrice));
      const strong = sorted.filter((c) => c.t >= 2);
      const out = [];
      for (const c of sorted) {
        if (out.length === 2) break;
        if (c.t >= 2) { out.push(c); continue; }
        const blocked = strong.some((x) => !out.includes(x) && Math.abs(x.p - refPrice) <= 1.5 * Math.abs(c.p - refPrice));
        if (!blocked) out.push(c);
      }
      return out
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
      if (s.length < 2) {
        for (const cand of [piv.S1, piv.S2]) {
          if (s.length >= 2) break;
          if (cand > 0 && cand < refPrice * 0.998 && !s.some((x) => Math.abs(x.p - cand) / cand < tol)) {
            s.push(mkFill(cand)); usedPivotFill = true;
          }
        }
        s.sort((a, b) => Math.abs(a.p - refPrice) - Math.abs(b.p - refPrice));
      }
      if (r.length < 2) {
        for (const cand of [piv.R1, piv.R2]) {
          if (r.length >= 2) break;
          if (cand > refPrice * 1.002 && !r.some((x) => Math.abs(x.p - cand) / cand < tol)) {
            r.push(mkFill(cand)); usedPivotFill = true;
          }
        }
        r.sort((a, b) => Math.abs(a.p - refPrice) - Math.abs(b.p - refPrice));
      }
    }
    if (s.length === 0 && r.length === 0) return pivotOnly(dailyCandles, refPrice);

    const hasCluster = s.some((x) => x.t > 0) || r.some((x) => x.t > 0);
    const m = hasCluster ? (usedPivotFill ? "mixed" : "cluster") : "pivot";
    return { s, r, piv: piv ? round5(piv.P) : null, px: round5(refPrice), m };
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
  };
}
