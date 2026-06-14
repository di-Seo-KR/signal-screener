// ════════════════════════════════════════════════════════
// Zepta — 전략 모듈 공통 지표 라이브러리
// ────────────────────────────────────────────────────────
// btc-cron.js 의 calcRSI/calcEMA/... 와 동일한 식으로 분리.
// strategy 모듈이 순수 함수가 되도록 (KV/네트워크 의존 0) 공유 dependency.
// ════════════════════════════════════════════════════════

export function calcSMA(data, period) {
  const result = new Array(data.length).fill(null);
  for (let i = period - 1; i < data.length; i++) {
    let sum = 0;
    for (let j = 0; j < period; j++) sum += data[i - j];
    result[i] = sum / period;
  }
  return result;
}

export function calcEMA(data, period) {
  const result = new Array(data.length).fill(null);
  const k = 2 / (period + 1);
  let start = -1;
  for (let i = 0; i < data.length; i++) { if (data[i] != null) { start = i; break; } }
  if (start < 0 || data.length - start < period) return result;
  let sum = 0;
  for (let i = start; i < start + period; i++) sum += data[i];
  result[start + period - 1] = sum / period;
  for (let i = start + period; i < data.length; i++) {
    result[i] = data[i] * k + result[i - 1] * (1 - k);
  }
  return result;
}

export function calcRSI(closes, period = 14) {
  const result = new Array(closes.length).fill(null);
  if (closes.length < period + 1) return result;
  let gainSum = 0, lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gainSum += d; else lossSum -= d;
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  result[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + (d > 0 ? d : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (d < 0 ? -d : 0)) / period;
    result[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return result;
}

export function calcBB(closes, period = 20, mult = 2) {
  const result = new Array(closes.length).fill(null);
  const sma = calcSMA(closes, period);
  for (let i = period - 1; i < closes.length; i++) {
    if (sma[i] == null) continue;
    let sqSum = 0;
    for (let j = 0; j < period; j++) sqSum += (closes[i - j] - sma[i]) ** 2;
    const std = Math.sqrt(sqSum / period);
    const upper = sma[i] + std * mult;
    const lower = sma[i] - std * mult;
    result[i] = { middle: sma[i], upper, lower, bw: sma[i] > 0 ? (upper - lower) / sma[i] : 0 };
  }
  return result;
}

export function calcMACD(closes, fast = 12, slow = 26, sig = 9) {
  const emaFast = calcEMA(closes, fast);
  const emaSlow = calcEMA(closes, slow);
  const macdLine = closes.map((_, i) => (emaFast[i] != null && emaSlow[i] != null) ? emaFast[i] - emaSlow[i] : null);
  const signal = calcEMA(macdLine.map(v => v ?? 0), sig);
  const histogram = closes.map((_, i) => (macdLine[i] != null && signal[i] != null) ? macdLine[i] - signal[i] : null);
  return { macdLine, signal, histogram };
}

export function calcATR(highs, lows, closes, period = 14) {
  const tr = [highs[0] - lows[0]];
  for (let i = 1; i < closes.length; i++) {
    tr.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
  }
  return calcEMA(tr, period);
}

export function calcADX(highs, lows, closes, period = 14) {
  const len = closes.length;
  const result = new Array(len).fill(null);
  if (len < period * 2) return result;
  const tr = [0];
  const plusDM = [0];
  const minusDM = [0];
  for (let i = 1; i < len; i++) {
    tr.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
    const up = highs[i] - highs[i - 1];
    const down = lows[i - 1] - lows[i];
    plusDM.push(up > down && up > 0 ? up : 0);
    minusDM.push(down > up && down > 0 ? down : 0);
  }
  const smoothTR = calcEMA(tr, period);
  const smoothPlus = calcEMA(plusDM, period);
  const smoothMinus = calcEMA(minusDM, period);
  const dx = [];
  for (let i = 0; i < len; i++) {
    if (smoothTR[i] && smoothTR[i] > 0) {
      const pdi = (smoothPlus[i] / smoothTR[i]) * 100;
      const mdi = (smoothMinus[i] / smoothTR[i]) * 100;
      const sum = pdi + mdi;
      dx.push(sum > 0 ? (Math.abs(pdi - mdi) / sum) * 100 : 0);
    } else dx.push(0);
  }
  const adxSmooth = calcEMA(dx, period);
  for (let i = 0; i < len; i++) result[i] = adxSmooth[i];
  return result;
}

export function calcStochastic(highs, lows, closes, kPeriod = 14, dPeriod = 3) {
  const k = new Array(closes.length).fill(null);
  for (let i = kPeriod - 1; i < closes.length; i++) {
    let hh = -Infinity, ll = Infinity;
    for (let j = 0; j < kPeriod; j++) {
      hh = Math.max(hh, highs[i - j]);
      ll = Math.min(ll, lows[i - j]);
    }
    k[i] = hh !== ll ? ((closes[i] - ll) / (hh - ll)) * 100 : 50;
  }
  const d = calcSMA(k.map(v => v ?? 50), dPeriod);
  return { k, d };
}

export function calcOBV(closes, volumes) {
  const obv = [0];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i] > closes[i - 1]) obv.push(obv[i - 1] + (volumes[i] || 0));
    else if (closes[i] < closes[i - 1]) obv.push(obv[i - 1] - (volumes[i] || 0));
    else obv.push(obv[i - 1]);
  }
  return obv;
}

// Hurst 지수 (R/S 분석). H > 0.5 = 추세 지속, H < 0.5 = 평균회귀.
export function calcHurst(data) {
  const n = data.length;
  if (n < 20) return 0.5;
  const logReturns = [];
  for (let i = 1; i < n; i++) {
    if (data[i] > 0 && data[i - 1] > 0) logReturns.push(Math.log(data[i] / data[i - 1]));
  }
  if (logReturns.length < 10) return 0.5;
  const mean = logReturns.reduce((a, b) => a + b, 0) / logReturns.length;
  const deviations = logReturns.map(r => r - mean);
  const cumDev = []; let cum = 0;
  for (const d of deviations) { cum += d; cumDev.push(cum); }
  const R = Math.max(...cumDev) - Math.min(...cumDev);
  const S = Math.sqrt(deviations.reduce((a, b) => a + b * b, 0) / deviations.length);
  if (S === 0) return 0.5;
  return Math.log(R / S) / Math.log(logReturns.length);
}

// Kaufman 효율성 비율: 1 = 완벽한 추세, 0 = 무방향 노이즈
export function calcEfficiencyRatio(closes, period = 10) {
  const er = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < period) { er.push(0); continue; }
    const direction = Math.abs(closes[i] - closes[i - period]);
    let volatility = 0;
    for (let j = 1; j <= period; j++) volatility += Math.abs(closes[i - j + 1] - closes[i - j]);
    er.push(volatility > 0 ? direction / volatility : 0);
  }
  return er;
}

// ────────────────────────────────────────────────────────
// 공통 헬퍼: 지표 묶음 한 번에 계산
// strategy 모듈이 매번 같은 지표 재계산하지 않도록 한 번 만들어서 넘김.
// ────────────────────────────────────────────────────────
// cfg: 선택적 기간/배수 override (param-tuner / 발굴된 후보 파라미터 주입용).
//   비우면 모든 값이 기존 하드코딩과 동일 → 동작 불변 (default-preserving).
//   ema21/ema55 필드명은 호환 위해 유지하되 실제 기간은 EMA_FAST/EMA_SLOW 를 따른다.
export function computeIndicatorBundle({ closes, highs, lows, volumes }, cfg = {}) {
  const rsiP   = cfg.RSI_PERIOD   || 14;
  const bbP    = cfg.BB_PERIOD    || 20;
  const bbMult = cfg.BB_MULT      || 2.0;
  const emaF   = cfg.EMA_FAST     || 21;
  const emaS   = cfg.EMA_SLOW     || 55;
  const adxP   = cfg.ADX_PERIOD   || 14;
  const atrP   = cfg.ATR_PERIOD   || 14;
  const obvP   = cfg.OBV_LOOKBACK || 20;
  const rsi = calcRSI(closes, rsiP);
  const bb = calcBB(closes, bbP, bbMult);
  const ema21 = calcEMA(closes, emaF);
  const ema55 = calcEMA(closes, emaS);
  const ema200 = closes.length > 200 ? calcEMA(closes, 200) : new Array(closes.length).fill(null);
  const macd = calcMACD(closes);
  const adx = calcADX(highs, lows, closes, adxP);
  const atr = calcATR(highs, lows, closes, atrP);
  const stoch = calcStochastic(highs, lows, closes, 14, 3);
  const obv = calcOBV(closes, volumes || []);
  const obvEma = calcEMA(obv, obvP);
  const volSMA = calcSMA(volumes || [], 20);
  const hurst = calcHurst(closes.slice(-100));
  const er = calcEfficiencyRatio(closes, 10);
  return {
    rsi, bb, ema21, ema55, ema200,
    macdLine: macd.macdLine, macdSig: macd.signal, histogram: macd.histogram,
    adx, atr, stoch, obv, obvEma, volSMA,
    hurst, er,
  };
}

// 신호 강도 → confidence 등급 변환 (공통 규칙)
//   absNet 6+: A (강한 확신, 5+ 인디케이터 합의)
//   absNet 3-5: B (중간)
//   absNet 1-2: C (약함)
export function gradeConfidence(absNet) {
  if (absNet >= 6) return "A";
  if (absNet >= 3) return "B";
  return "C";
}

// 0~100 점수로 정규화 (기존 호환): absNet 7+ → 95, 1 → 50
export function scaleScore(absNet) {
  // absNet 1 → 55,  3 → 70,  5 → 82,  7+ → 92~95
  const base = 50 + Math.min(absNet, 8) * 6;
  return Math.min(95, Math.max(50, base));
}

// ════════════════════════════════════════════════════════
// 알파 정제 레이어 (2026-06-02) — 스코어 결정요인 고도화
// ────────────────────────────────────────────────────────
// 문제(대표 관찰): RSI 30 이하인데도 trend-follow 가 숏 95 를 냄.
//   원인 = (1) 상관된 추세 지표(EMA배열·MACD·데드크로스·EMA200)가 같은 신호를
//   여러 번 세서 확신도 인플레, (2) 추세장에 반전·과열·소진 감지가 전무.
// 해결(전부 dampening-우세 = 과신 축소 방향이라 안전):
//   ① 과확장 페널티  ② 다이버전스(추세 반대)  ③ 극단 RSI 소진
//   ④ 거래량 페이드  ⑤ 독립 확인 폭(breadth) 기반 점수 캡 (상관 인플레 차단)
// ════════════════════════════════════════════════════════

// 가격 ↔ 지표 다이버전스. 윈도우를 절반으로 나눠 직전/현재 극값 비교.
//   bullish: 가격 더 낮은 저점 + 지표 더 높은 저점 → 하락 소진(숏 약화 근거)
//   bearish: 가격 더 높은 고점 + 지표 더 낮은 고점 → 상승 소진(롱 약화 근거)
export function detectDivergence(price, series, L, lookback = 12) {
  if (!price || !series || L < lookback + 1) return { bullish: false, bearish: false };
  const half = Math.floor(lookback / 2);
  let pMinNow = Infinity, pMaxNow = -Infinity, sMinNow = Infinity, sMaxNow = -Infinity;
  let pMinPrev = Infinity, pMaxPrev = -Infinity, sMinPrev = Infinity, sMaxPrev = -Infinity;
  for (let i = L - half + 1; i <= L; i++) {
    if (price[i] == null || series[i] == null) continue;
    pMinNow = Math.min(pMinNow, price[i]); pMaxNow = Math.max(pMaxNow, price[i]);
    sMinNow = Math.min(sMinNow, series[i]); sMaxNow = Math.max(sMaxNow, series[i]);
  }
  for (let i = L - lookback + 1; i <= L - half; i++) {
    if (price[i] == null || series[i] == null) continue;
    pMinPrev = Math.min(pMinPrev, price[i]); pMaxPrev = Math.max(pMaxPrev, price[i]);
    sMinPrev = Math.min(sMinPrev, series[i]); sMaxPrev = Math.max(sMaxPrev, series[i]);
  }
  if (!isFinite(pMinPrev) || !isFinite(pMinNow)) return { bullish: false, bearish: false };
  return {
    bullish: pMinNow < pMinPrev && sMinNow > sMinPrev,
    bearish: pMaxNow > pMaxPrev && sMaxNow < sMaxPrev,
  };
}

// ════════════════════════════════════════════════════════
// MTF + 차트구조 진입 정제 (복합 스코어 레벨) — 2026-06-14 대표 지시
//   "1h·4h·일봉 RSI 가 다 과매수면 추가 진입 안 되게 점수를 낮추거나" + 차트
//   구조(과확장 추격·S/R 근접·압축 후 돌파/쐐기형)를 종목 시그널 점수에 반영.
//   기존 refineSignalScore 는 *단일 TF* 정제 — 이건 타임프레임을 *횡단*해서
//   소진/추격을 감점하고 신선한 돌파를 가점하는 composite 레벨 레이어.
//   반환 mult(0.45~1.2) 를 composite/trade 시그널 score 에 곱한다(방향은 불변 — 감점만).
//   ZEPTA_ENTRY_REFINE=0 으로 끔.
//
//   perTF: { "1h":{closes,highs,lows}, "4h":{...}, "1d":{...} } (있는 것만)
//   sr: computeSRLevels 결과 { s:[{p,t}], r:[{p,t}] } (없으면 생략)
// ════════════════════════════════════════════════════════
function _last(arr) {
  if (!Array.isArray(arr)) return null;
  for (let i = arr.length - 1; i >= 0; i--) if (arr[i] != null) return arr[i];
  return null;
}

// ── 차트 TA 리서치(2026-06-14, 워크플로우 w31s376lk) 헬퍼 ──
function _mean(arr) {
  if (!Array.isArray(arr) || !arr.length) return null;
  let s = 0, n = 0;
  for (const v of arr) if (v != null && isFinite(v)) { s += v; n++; }
  return n ? s / n : null;
}
function _std(arr, m = null) {
  if (!Array.isArray(arr) || arr.length < 2) return null;
  const mu = m == null ? _mean(arr) : m;
  if (mu == null) return null;
  let s = 0, n = 0;
  for (const v of arr) if (v != null && isFinite(v)) { s += (v - mu) ** 2; n++; }
  return n > 1 ? Math.sqrt(s / (n - 1)) : null;
}
// 스윙 고저점 추출 — computeSRLevels 와 동일 fractal(좌우 k봉보다 strict 극값).
//   우측 k봉 확정이라 진행 중인 마지막 봉은 자연히 제외(비-repaint). 종가확정 구조 분석용.
function _swings(highs, lows, k = 2, lookback = 60) {
  const hh = [], ll = [];
  if (!Array.isArray(highs) || !Array.isArray(lows)) return { hh, ll };
  const n = Math.min(highs.length, lows.length);
  const start = Math.max(k, n - lookback);
  for (let i = start; i < n - k; i++) {
    let isHigh = true, isLow = true;
    for (let j = i - k; j <= i + k; j++) {
      if (j === i) continue;
      if (highs[j] >= highs[i]) isHigh = false;
      if (lows[j] <= lows[i]) isLow = false;
    }
    if (isHigh && isFinite(highs[i])) hh.push({ p: highs[i], idx: i });
    if (isLow && isFinite(lows[i])) ll.push({ p: lows[i], idx: i });
  }
  return { hh, ll };
}
// MFI (Money Flow Index) — 거래량 가중 RSI(typical price 기반). 최신값 스칼라 반환.
export function calcMFI(highs, lows, closes, volumes, period = 14) {
  const n = Math.min(highs?.length || 0, lows?.length || 0, closes?.length || 0, volumes?.length || 0);
  if (n < period + 1) return null;
  let pos = 0, neg = 0;
  for (let i = n - period; i < n; i++) {
    const tp = (highs[i] + lows[i] + closes[i]) / 3;
    const tpPrev = (highs[i - 1] + lows[i - 1] + closes[i - 1]) / 3;
    const flow = tp * (volumes[i] || 0);
    if (tp > tpPrev) pos += flow;
    else if (tp < tpPrev) neg += flow;
  }
  if (pos + neg === 0) return 50;
  if (neg === 0) return 100;
  return 100 - 100 / (1 + pos / neg);
}

export function refineCompositeEntry({ side, perTF = {}, sr = null, price = null }) {
  if (process.env.ZEPTA_ENTRY_REFINE === "0") return { mult: 1, reasons: [] };
  const dir = side === "LONG" ? 1 : side === "SHORT" ? -1 : 0;
  if (!dir) return { mult: 1, reasons: [] };
  const reasons = [];
  let mult = 1;
  let mtfExhausted = false, overextended = false; // ⑥ BOS 가드 — '지속'과 '추격' 충돌 시 가점 억제

  // ── ① MTF RSI 소진 — 여러 타임프레임이 동시에 과매수/과매도면 추가 진입 억제 ──
  const tfs = ["1h", "4h", "1d"];
  const rsiVals = {};
  let obCount = 0, osCount = 0;
  for (const tf of tfs) {
    const c = perTF[tf]?.closes;
    if (!c || c.length < 20) continue;
    const r = _last(calcRSI(c, 14));
    if (r == null) continue;
    rsiVals[tf] = Math.round(r);
    if (r >= 70) obCount++;
    if (r <= 30) osCount++;
  }
  if (dir > 0 && obCount >= 2) {
    mult *= obCount >= 3 ? 0.55 : 0.78; mtfExhausted = true;
    reasons.push(`과매수 ${obCount}TF 소진(${tfs.filter(t => rsiVals[t] >= 70).map(t => `${t}:${rsiVals[t]}`).join("·")})`);
  }
  if (dir < 0 && osCount >= 2) {
    mult *= osCount >= 3 ? 0.55 : 0.78; mtfExhausted = true;
    reasons.push(`과매도 ${osCount}TF 소진(${tfs.filter(t => rsiVals[t] <= 30).map(t => `${t}:${rsiVals[t]}`).join("·")})`);
  }

  // ── ② 과확장(추격) — 일봉 BB %B + 60봉 고저 위치 ──
  const d = perTF["1d"];
  if (d?.closes?.length >= 21 && price != null) {
    const bb = _last(calcBB(d.closes, 20, 2));
    if (bb && bb.upper > bb.lower) {
      const pctB = (price - bb.lower) / (bb.upper - bb.lower);
      if (dir > 0 && pctB > 1.0) { mult *= 0.82; overextended = true; reasons.push(`BB상단 돌파 추격(%B ${pctB.toFixed(2)})`); }
      if (dir < 0 && pctB < 0.0) { mult *= 0.82; overextended = true; reasons.push(`BB하단 이탈 추격`); }
    }
    if (d.highs?.length >= 60 && d.lows?.length >= 60) {
      const hi = Math.max(...d.highs.slice(-60));
      const lo = Math.min(...d.lows.slice(-60));
      if (hi > lo) {
        const pos = (price - lo) / (hi - lo);
        if (dir > 0 && pos > 0.92) { mult *= 0.85; overextended = true; reasons.push(`60봉 고점권 ${Math.round(pos * 100)}% 추격`); }
        if (dir < 0 && pos < 0.08) { mult *= 0.85; overextended = true; reasons.push(`60봉 저점권 ${Math.round(pos * 100)}% 추격`); }
      }
    }
  }

  // ── ③ S/R 근접 — 저항 바로 밑 롱 / 지지 바로 위 숏 = 상승/하락 여력 부족 ──
  if (sr && price != null) {
    if (dir > 0 && Array.isArray(sr.r)) {
      const nearR = sr.r.filter(x => x.p > price).sort((a, b) => a.p - b.p)[0];
      if (nearR && (nearR.p - price) / price < 0.012 && (nearR.t || 0) >= 2) {
        mult *= 0.85; reasons.push(`저항 ${((nearR.p - price) / price * 100).toFixed(1)}% 근접(터치${nearR.t})`);
      }
    }
    if (dir < 0 && Array.isArray(sr.s)) {
      const nearS = sr.s.filter(x => x.p < price).sort((a, b) => b.p - a.p)[0];
      if (nearS && (price - nearS.p) / price < 0.012 && (nearS.t || 0) >= 2) {
        mult *= 0.85; reasons.push(`지지 ${((price - nearS.p) / price * 100).toFixed(1)}% 근접 숏(여력부족)`);
      }
    }
  }

  // ── ④ 압축 후 돌파 (쐐기/삼각수렴의 robust 커널) — 신선한 좋은 타점 가점 ──
  //   변동성(ATR)이 직전 대비 수축 → 직전 봉이 방향대로 직전 10봉 범위 돌파 = 압축해소 돌파.
  //   하락 추세 후 상방 돌파 = '하락쐐기형', 상승 추세 후 하방 = '상승쐐기형' (방향성 가점 ↑).
  const f = perTF["4h"]?.closes?.length >= 40 ? perTF["4h"] : (perTF["1d"]?.closes?.length >= 40 ? perTF["1d"] : null);
  if (f) {
    const n = f.closes.length;
    const atrArr = calcATR(f.highs, f.lows, f.closes, 14);
    const atrNow = _last(atrArr);
    const atrPast = atrArr[atrArr.length - 11];
    const lastClose = f.closes[n - 1];
    if (atrNow != null && atrPast != null && atrPast > 0) {
      const compressed = atrNow < atrPast * 0.8; // 변동성 20%+ 수축
      const breakUp = lastClose > Math.max(...f.highs.slice(-11, -1));
      const breakDn = lastClose < Math.min(...f.lows.slice(-11, -1));
      const wasDown = f.highs[n - 2] < f.highs[n - 12]; // 직전 고점 하락(하락추세)
      const wasUp = f.lows[n - 2] > f.lows[n - 12];      // 직전 저점 상승(상승추세)
      if (compressed && dir > 0 && breakUp) {
        if (wasDown) { mult *= 1.12; reasons.push("하락쐐기형 상방 돌파(압축해소)"); }
        else { mult *= 1.06; reasons.push("변동성 압축 후 상방 돌파"); }
      } else if (compressed && dir < 0 && breakDn) {
        if (wasUp) { mult *= 1.12; reasons.push("상승쐐기형 하방 돌파(압축해소)"); }
        else { mult *= 1.06; reasons.push("변동성 압축 후 하방 돌파"); }
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // 차트 TA 리서치(2026-06-14, 워크플로우 w31s376lk) — robust·비중복 7종 합류.
  //   전부 기존 mult 곱셈체인에 합류(상한1.2·하한0.45·방향불변). 거래량/구조 기반
  //   로직은 *마지막 완결봉* ci 기준(마지막 봉은 진행 중일 수 있어 부분 거래량/돌파 배제).
  // ══════════════════════════════════════════════════════════════════
  const N = f ? f.closes.length : 0;
  const ci = N - 2;             // 마지막 완결봉 (진행봉 제외)
  let swHi = null, swLo = null; // ⑥ 추출 → ⑦ 재사용

  // ── ⑤ 구조 레벨 거래량 돌파 — 가짜돌파(저거래·wick) 차단, 종가확정 돌파만 가점 ──
  if (f && sr && ci >= 1 && Array.isArray(f.volumes) && f.volumes.length >= 22) {
    const refClose = f.closes[ci], prevClose = f.closes[ci - 1];
    const atr5 = _last(calcATR(f.highs.slice(0, ci + 1), f.lows.slice(0, ci + 1), f.closes.slice(0, ci + 1), 14));
    const volSMA = _mean(f.volumes.slice(ci - 20, ci));
    const lastVol = f.volumes[ci];
    if (atr5 != null && atr5 > 0 && volSMA && lastVol != null && refClose > 0) {
      const buf = 0.3 * atr5 / refClose;
      if (dir > 0 && Array.isArray(sr.r)) {
        const nearR = sr.r.filter(x => x.p > prevClose && (x.t || 0) >= 2).sort((a, b) => a.p - b.p)[0];
        if (nearR && refClose > nearR.p * (1 + buf) && prevClose <= nearR.p && lastVol >= volSMA * 1.3) {
          mult *= 1.10; reasons.push("저항 거래량 돌파(구조전환)");
        }
        const brokeS = (sr.s || []).filter(x => x.p < prevClose && (x.t || 0) >= 2).sort((a, b) => b.p - a.p)[0];
        if (brokeS && refClose < brokeS.p * (1 - buf) && prevClose >= brokeS.p) { mult *= 0.82; reasons.push("지지 종가 이탈(구조붕괴)"); }
      }
      if (dir < 0 && Array.isArray(sr.s)) {
        const nearS = sr.s.filter(x => x.p < prevClose && (x.t || 0) >= 2).sort((a, b) => b.p - a.p)[0];
        if (nearS && refClose < nearS.p * (1 - buf) && prevClose >= nearS.p && lastVol >= volSMA * 1.3) {
          mult *= 1.10; reasons.push("지지 거래량 하향돌파(구조전환)");
        }
        const brokeR = (sr.r || []).filter(x => x.p > prevClose && (x.t || 0) >= 2).sort((a, b) => a.p - b.p)[0];
        if (brokeR && refClose > brokeR.p * (1 + buf) && prevClose <= brokeR.p) { mult *= 0.82; reasons.push("저항 종가 돌파(구조붕괴-숏역행)"); }
      }
    }
  }

  // ── ⑥ 스윙 구조 추세정합(HH/HL vs LH/LL) + 종가확정 BOS ──
  if (f && N >= 30 && ci >= 1) {
    const { hh, ll } = _swings(f.highs, f.lows, 2, 60);
    const atrB = _last(calcATR(f.highs, f.lows, f.closes, 14));
    if (hh.length >= 2 && ll.length >= 2 && atrB != null && atrB > 0) {
      const rHH = hh.slice(-2), rLL = ll.slice(-2);
      const up = rHH[1].p > rHH[0].p && rLL[1].p > rLL[0].p;
      const down = rHH[1].p < rHH[0].p && rLL[1].p < rLL[0].p;
      swHi = hh[hh.length - 1].p; swLo = ll[ll.length - 1].p;
      if ((dir > 0 && up) || (dir < 0 && down)) { mult *= 1.06; reasons.push(dir > 0 ? "스윙 상승구조 정합(HH/HL)" : "스윙 하락구조 정합(LH/LL)"); }
      else if ((dir > 0 && down) || (dir < 0 && up)) { mult *= 0.85; reasons.push("스윙 구조 역행"); }
      // BOS — 마지막 완결봉이 직전 미돌파 스윙을 *처음* 종가 돌파(fresh, wick 제외)
      const bosUp = dir > 0 && f.closes[ci] > swHi && f.closes[ci - 1] <= swHi && (f.closes[ci] - swHi) > 0.15 * atrB;
      const bosDn = dir < 0 && f.closes[ci] < swLo && f.closes[ci - 1] >= swLo && (swLo - f.closes[ci]) > 0.15 * atrB;
      if (bosUp || bosDn) {
        const bonus = (overextended || mtfExhausted) ? 1.04 : 1.08; // 추격 의심이면 가점 약화
        mult *= bonus; reasons.push(dir > 0 ? "스윙고점 종가돌파 BOS" : "스윙저점 종가돌파 BOS");
      }
    }
  }

  // ── ⑦ 유동성 스윕 실패돌파 — 꼬리만 넘고 종가 회귀 = 추세소진(감점) ──
  if (f && N >= 30 && (swHi != null || swLo != null)) {
    const atrS = _last(calcATR(f.highs, f.lows, f.closes, 14));
    const er = _last(calcEfficiencyRatio(f.closes, 10));
    if (atrS != null && atrS > 0) {
      for (let b = 1; b <= 2; b++) {
        const idx = N - 1 - b; // 완결봉만 (진행봉 N-1 제외)
        if (idx < 1) break;
        const hi = f.highs[idx], lo = f.lows[idx], cl = f.closes[idx];
        if (dir > 0 && swHi != null && hi > swHi && cl < swHi) {
          const pierce = hi - swHi;
          if (pierce >= 0.1 * atrS && (hi - cl) >= 0.5 * pierce) {
            mult *= (er != null && er > 0.35) ? 0.90 : 0.82; reasons.push("상단 유동성스윕 후 회귀(추세소진)"); break;
          }
        }
        if (dir < 0 && swLo != null && lo < swLo && cl > swLo) {
          const pierce = swLo - lo;
          if (pierce >= 0.1 * atrS && (cl - lo) >= 0.5 * pierce) {
            mult *= (er != null && er > 0.35) ? 0.90 : 0.82; reasons.push("하단 유동성스윕 후 회귀(추세소진)"); break;
          }
        }
      }
    }
  }

  // ── ⑧ 거래량 처닝 — 고거래량인데 가격 진전 없음(노력대비 정체) = 분산 의심(감점) ──
  if (f && Array.isArray(f.volumes) && f.volumes.length >= 22 && ci >= 6) {
    const atrArr2 = calcATR(f.highs, f.lows, f.closes, 14);
    const atrI = atrArr2[ci] ?? _last(atrArr2);
    const volWin = f.volumes.slice(ci - 20, ci);
    const vMean = _mean(volWin), vStd = _std(volWin, vMean);
    if (atrI != null && atrI > 0 && vMean != null && vStd != null && vStd > 0) {
      const volZ = (f.volumes[ci] - vMean) / vStd;
      const progress = Math.abs(f.closes[ci] - f.closes[ci - 1]) / atrI;
      if (volZ >= 2.0 && progress < 0.5) {
        const trendUp = f.closes[ci] > f.closes[ci - 5];
        if ((dir > 0 && trendUp) || (dir < 0 && !trendUp)) { mult *= 0.83; reasons.push("거래량 처닝(노력대비 정체)"); }
      }
    }
  }

  // ── ⑨ 200MA 카운터트렌드 페널티 + ADX 추세정합 가점 ──
  //   ★ 리서치의 'ADX<20 횡보장 일괄 감점'은 composite 레벨에서 전략 family(추세추종 vs
  //     평균회귀)를 구분 못 해 평균회귀 진입을 오감점할 위험 → 제외. 200MA 거시역행
  //     감점(가장 robust·MDD 축소)과 ADX 정합 소폭 가점만 채택.
  if (d?.closes?.length >= 30 && price != null) {
    const adx = _last(calcADX(d.highs, d.lows, d.closes, 14));
    const ema21d = _last(calcEMA(d.closes, 21));
    const diDir = ema21d != null ? (price > ema21d ? 1 : -1) : 0;
    if (adx != null && adx >= 25 && diDir === dir) { mult *= 1.05; reasons.push(`추세장 정합(ADX ${Math.round(adx)})`); }
    let ma200 = null, weak = false;
    if (d.closes.length >= 200) ma200 = _last(calcEMA(d.closes, 200));
    else { ma200 = _last(calcEMA(d.closes, 55)); weak = true; }
    if (ma200 != null && ma200 > 0) {
      const dist = (price - ma200) / ma200;
      if (Math.abs(dist) > 0.015) { // 데드존 ±1.5% — 전환 직후 첫 진입 과도감점 방지
        const counter = (dir > 0 && dist < 0) || (dir < 0 && dist > 0);
        if (counter) {
          let m = Math.abs(dist) > 0.08 ? 0.78 : 0.85;
          if (weak) m = 1 - (1 - m) * 0.5; // 200봉 미만 폴백이면 감점 약화
          mult *= m; reasons.push(`${weak ? "추세선" : "200MA"} 거시역행(${(dist * 100).toFixed(1)}%)`);
        }
      }
    }
  }

  // ── ⑩ 다중 오실레이터 동시극단 소진캡 — RSI·Stoch·MFI 3계열 동시극단(감점) ──
  if (f && N >= 20 && Array.isArray(f.volumes) && f.volumes.length >= 20) {
    const rsi = _last(calcRSI(f.closes, 14));
    const st = calcStochastic(f.highs, f.lows, f.closes, 14, 3);
    const stK = _last(st?.k);
    const mfi = calcMFI(f.highs, f.lows, f.closes, f.volumes, 14);
    if (rsi != null && stK != null && mfi != null) {
      const obN = (rsi >= 72 ? 1 : 0) + (stK >= 80 ? 1 : 0) + (mfi >= 80 ? 1 : 0);
      const osN = (rsi <= 28 ? 1 : 0) + (stK <= 20 ? 1 : 0) + (mfi <= 20 ? 1 : 0);
      if (dir > 0 && obN >= 3) { mult *= 0.85; reasons.push("RSI·Stoch·MFI 동시 과매수 소진"); }
      if (dir < 0 && osN >= 3) { mult *= 0.85; reasons.push("RSI·Stoch·MFI 동시 과매도 소진"); }
    }
  }

  // ── ⑪ 히든 다이버전스(추세지속 가점) + RSI2 반전 게이트 ──
  if (f && N >= 30) {
    const L = N - 1;
    // 1d 추세 필터
    let trendUp = null;
    if (d?.closes?.length >= 55) {
      const e21 = _last(calcEMA(d.closes, 21)), e55 = _last(calcEMA(d.closes, 55));
      if (e21 != null && e55 != null) trendUp = e21 > e55;
    }
    if (trendUp !== null && L >= 13) {
      const rsiS = calcRSI(f.closes, 14);
      const half = 6, lb = 12;
      let pMinNow = Infinity, pMinPrev = Infinity, sMinNow = Infinity, sMinPrev = Infinity;
      let pMaxNow = -Infinity, pMaxPrev = -Infinity, sMaxNow = -Infinity, sMaxPrev = -Infinity;
      for (let i = L - half + 1; i <= L; i++) { if (f.closes[i] == null || rsiS[i] == null) continue; pMinNow = Math.min(pMinNow, f.closes[i]); pMaxNow = Math.max(pMaxNow, f.closes[i]); sMinNow = Math.min(sMinNow, rsiS[i]); sMaxNow = Math.max(sMaxNow, rsiS[i]); }
      for (let i = L - lb + 1; i <= L - half; i++) { if (f.closes[i] == null || rsiS[i] == null) continue; pMinPrev = Math.min(pMinPrev, f.closes[i]); pMaxPrev = Math.max(pMaxPrev, f.closes[i]); sMinPrev = Math.min(sMinPrev, rsiS[i]); sMaxPrev = Math.max(sMaxPrev, rsiS[i]); }
      const bullishHidden = isFinite(pMinPrev) && isFinite(pMinNow) && pMinNow > pMinPrev && sMinNow < sMinPrev;
      const bearishHidden = isFinite(pMaxPrev) && isFinite(pMaxNow) && pMaxNow < pMaxPrev && sMaxNow > sMaxPrev;
      if (dir > 0 && trendUp && bullishHidden) { mult *= 1.08; reasons.push("히든 불리시 다이버전스(상승지속)"); }
      if (dir < 0 && !trendUp && bearishHidden) { mult *= 1.08; reasons.push("히든 베어리시 다이버전스(하락지속)"); }
    }
    // RSI2 반전 — 평균회귀 레짐(추세장 아닐 때)에서만 회귀 가점
    const r2 = calcRSI(f.closes, 2);
    const hurst = calcHurst(f.closes.slice(-100));
    const adxF = _last(calcADX(f.highs, f.lows, f.closes, 14));
    const meanRev = (hurst != null && hurst < 0.47) || (adxF != null && adxF < 25);
    if (meanRev && r2.length >= 2) {
      const r2n = r2[r2.length - 1], r2p = r2[r2.length - 2];
      if (dir > 0 && r2p != null && r2n != null && r2p <= 10 && r2n > 10) { mult *= 1.08; reasons.push("RSI2 과매도반전"); }
      if (dir < 0 && r2p != null && r2n != null && r2p >= 90 && r2n < 90) { mult *= 1.08; reasons.push("RSI2 과매수반전"); }
    }
  }

  mult = Math.max(0.45, Math.min(1.2, mult));
  return { mult, reasons };
}

// 원시 buy/sell 표 → 정제된 net/score/confidence.
//   strategy 들이 net 계산 직전에 호출. dampening 우세이며, 정상 추세(과확장·
//   다이버전스·극단·거래량부진 없음)에선 표 변화 0 → 기존과 동일 신호.
export function refineSignalScore({ buy, sell, ind, closes, volumes, L, extensionPenalty = true }) {
  let adjBuy = buy, adjSell = sell;
  const notes = [];
  const price = closes?.[L];
  const atr = ind.atr?.[L];
  const ema21 = ind.ema21?.[L];
  const ema55 = ind.ema55?.[L];
  const rsi = ind.rsi?.[L];

  const side = (buy - sell) >= 0 ? "LONG" : "SHORT";

  // ① 과확장 페널티 — 가격이 EMA21 에서 ATR 3배 이상 벌어지면 되돌림 위험
  //   (breakout 처럼 확장이 본질인 전략은 extensionPenalty=false 로 건너뜀)
  if (extensionPenalty && atr && ema21 && atr > 0 && price != null) {
    const ext = (price - ema21) / atr;
    if (ext > 3 && side === "LONG") { adjBuy = Math.max(0, adjBuy - 2); notes.push(`과확장↑${ext.toFixed(1)}ATR`); }
    if (ext < -3 && side === "SHORT") { adjSell = Math.max(0, adjSell - 2); notes.push(`과확장↓${ext.toFixed(1)}ATR`); }
  }

  // ② 다이버전스 — 추세 반대 신호면 dampening
  const divRsi = detectDivergence(closes, ind.rsi, L, 12);
  const divMacd = detectDivergence(closes, ind.histogram, L, 12);
  if (side === "SHORT" && (divRsi.bullish || divMacd.bullish)) { adjSell = Math.max(0, adjSell - 2); notes.push("강세다이버전스"); }
  if (side === "LONG" && (divRsi.bearish || divMacd.bearish)) { adjBuy = Math.max(0, adjBuy - 2); notes.push("약세다이버전스"); }

  // ③ 극단 RSI 소진 — 추세 모멘텀이 과매도/과매수 극단이면 지속 확신 ↓
  if (rsi != null) {
    if (side === "SHORT" && rsi < 25) { adjSell = Math.max(0, adjSell - 1); notes.push(`RSI${rsi.toFixed(0)}과매도소진`); }
    if (side === "LONG" && rsi > 75) { adjBuy = Math.max(0, adjBuy - 1); notes.push(`RSI${rsi.toFixed(0)}과매수소진`); }
  }

  // ④ 거래량 페이드 — 추세가 거래량 빠지며 진행되면 확신 ↓
  const volMult = (ind.volSMA?.[L] > 0 && volumes && volumes[L] != null) ? volumes[L] / ind.volSMA[L] : 1;
  if (volMult < 0.7) {
    if (side === "LONG") adjBuy = Math.max(0, adjBuy - 1); else adjSell = Math.max(0, adjSell - 1);
    notes.push(`거래량부진${volMult.toFixed(1)}x`);
  }

  // dampening 이 부호를 뒤집지 않도록 중립까지만 (whipsaw 방지)
  if (side === "SHORT") adjSell = Math.max(adjSell, adjBuy);
  else adjBuy = Math.max(adjBuy, adjSell);

  const net = adjBuy - adjSell;
  const absNet = Math.abs(net);
  const finalSide = net >= 0 ? "LONG" : "SHORT";
  const fdir = finalSide === "LONG" ? 1 : -1;

  // ⑤ 독립 확인 폭(breadth) — 상관 요인 인플레 차단. 추세/모멘텀/거래량 3 카테고리.
  let confirms = 0;
  const macd = ind.macdLine?.[L], macdSig = ind.macdSig?.[L];
  if (ema21 != null && ema55 != null && macd != null && macdSig != null) {
    const trendDir = ema21 > ema55 ? 1 : -1;
    const macdDir = macd > macdSig ? 1 : -1;
    if (trendDir === fdir && macdDir === fdir) confirms++;           // 추세 카테고리
  }
  if (rsi != null) {                                                  // 모멘텀 — '건강한' 구간만 (극단은 비확인)
    if (fdir > 0 && rsi > 50 && rsi <= 72) confirms++;
    if (fdir < 0 && rsi < 50 && rsi >= 28) confirms++;
  }
  const obvNow = ind.obv?.[L], obvPast = ind.obv?.[L - 5];
  if (obvNow != null && obvPast != null && volMult >= 0.9) {          // 거래량 카테고리 — OBV 기울기 동의
    if ((obvNow > obvPast ? 1 : -1) === fdir) confirms++;
  }

  // breadth 캡: 0→55, 1→68, 2→82, 3→95 (상관 요인만으론 95 불가)
  const breadthCap = [55, 68, 82, 95][Math.min(confirms, 3)];
  const score = Math.min(scaleScore(absNet), breadthCap);

  // confidence 도 breadth(독립확인)로 캡 — score 의 breadthCap 과 정합.
  //   confirms 0 → 최대 C, 1 → 최대 B, 2+ → A 가능. (점수55인데 등급B 같은 불일치 제거)
  let confidence = gradeConfidence(absNet);
  if (confirms < 1) { if (confidence !== "C") confidence = "C"; }
  else if (confirms < 2) { if (confidence === "A") confidence = "B"; }

  return { side: finalSide, net, absNet, score, confidence, confirms, notes };
}
