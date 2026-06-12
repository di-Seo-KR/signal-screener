// ════════════════════════════════════════════════════════════════════
// Zepta 퀀트 엔진 v4.2 — 하위전략 3차 안전필터 강화 (2026-04-02)
// 41개 매매전략 + 백테스팅 엔진 + 시장진단 + 전략추천
// v4.2: 4/2 일일 개선 — 백테스트 하위전략 안전필터 3차 강화
//   - OBV 추세추종: RSI>72 과매수 억제 + ADX≥15 추세필터 + MA200 하락추세 매수억제 + OBV 3봉 기울기 확인
//   - 갭 앤 고: RSI>70 과매수 억제 + 연속양봉 과열 차단 + 중복진입 방지 + ATR 트레일링 스탑
//   - 삼중 이평선: ADX 상승확인 + RSI 기울기 반등 확인 + MA200 장기추세필터(95% 이하 차단)
// v4.1: 4/2 오전 전략 업데이트 (VIX 25.25 고변동 + BTC Fear 8 극공포 반영)
//   - RSI 반전: 기본 임계값 26/74→25/75 (고변동장 과매도 진입 깊게)
//   - RSI 반전: 하락추세 진입 RSI 기준 20→18 (패닉 매도 반전 포착)
//   - BTC 알파: 패닉 RSI 18→20 (극공포 F&G 8 반영, 과격한 진입 완화)
//   - BTC 알파: 저변동 RSI 임계값 32/68→30/70 (레인지 확대)
//   - 볼린저밴드: 스퀴즈 비율 0.5→0.45 (수축 구간 더 엄격 억제)
//   - 백테스트 엔진: Omega Ratio + Tail Ratio 메트릭 추가
//   - 백테스트 엔진: 연속 손실 포지션 축소 3회→2회 (고변동 리스크 관리 강화)
// v4.0: 3/31 오전 전략 업데이트
//   - RSI 반전: 기본 임계값 27/73→26/74 + 거래량 확인 0.7→0.65 완화
//   - BTC 알파: 패닉 RSI 15→18 (극단 진입 방지) + 거래량 서지 1.8→1.6
//   - 백테스트 엔진: ATR 기반 변동성 적응 포지션 사이징 + 월별 수익률 계산 수정
//   - 백테스트 엔진: 승리/패배 거래별 평균 보유기간 + 연간화 변동성 메트릭 추가
// v3.9: 3/30 백테스트 결과 기반 하위전략 2차 강화
//   - 일목균형표: ADX 최소 25로 상향 + MA200 방향 필터 + RSI 하한 40
//   - 스토캐스틱+RSI: MA200 하락추세 시 임계값 보수적 조정(30→25/20→15) + RSI 기울기 확인
//   - 레짐 전환: 횡보장 RSI 진입 30→25 보수적 조정 + 연속 과매도 2봉 확인
//   - 볼린저밴드 바운스: 연속 2봉 BB 하단 확인 + RSI 추가 하한(25) 필터
//   - 듀얼 타임프레임: MA200 위 추가 확인 + RSI 기울기 반전 확인
// v3.8: Sharpe 하위 5개 전략 안전필터 강화 (BB/VWAP/일목/레짐전환/삼중EMA)
//   - BB 바운스: MA200 추세필터 — 하락추세 매수 시 다이버전스 필수
//   - VWAP 반전: ATR 동적 임계값 + RSI<45 확인 + 하락추세 억제
//   - 일목균형표: ADX<20 비추세장 비활성화 + 구름 두께 최소 0.5% 기준
//   - 레짐 전환: ADX 히스테리시스(25/20) + MA200 추세방향 필터 + ATR 급등 억제
//   - 삼중 이평선: ADX≥18 추세강도 필터 + 이격도>8% 과열 억제 + RSI<75 확인
// v3.7: 하위전략 파라미터 최적화 (일목/듀얼모멘텀/채널돌파/MFI)
//   - 일목균형표: 구름 근접성 완화(99% 허용) + 치쿠스팬 추세확인 + RSI 교차검증
//   - 듀얼 모멘텀: ADX 추세강도 필터(≥18) + RSI 모멘텀 확인 + 3봉 모멘텀 기울기
//   - 채널 돌파: ADX 20으로 완화 + RSI 40~75 진입대 + ATR 트레일링 스탑 + 돌파강도 등급
//   - MFI 자금유입: 추세 적응형 임계값(상승:25/85,하락:15/75) + RSI 교차검증
// v3.6: 오전 전략 파라미터 최적화 + 백테스트 엔진 고도화
//   - RSI 반전: 변동성 레짐 기반 적응형 임계값 (저변동: 30/70, 고변동: 25/75)
//   - RSI 반전: 거래량 확인 임계값 완화 (0.8→0.7) + 3봉 RSI 기울기 확인 필터
//   - MACD: 제로라인 거리 기반 시그널 필터링 + 히스토그램 정규화 개선
//   - 볼린저밴드: 밴드폭 수축 시 역추세 시그널 억제 (스퀴즈 구간 보호)
//   - 거래량 돌파: 연속 거래량 증가 조건 완화 (전봉 avgVol*0.8 허용)
//   - 이평선 크로스: EMA 전환 옵션 추가 (빠른 반응) + 스프레드 최소치 필터
//   - 백테스트 엔진: 연속 손실 3회 시 포지션 사이즈 50% 축소 (리스크 적응)
//   - 백테스트 엔진: 최대 보유 기간(60봉) 강제 청산 + 월별 승률 추가
// v3.5: 전략 파라미터 재최적화 + 백테스트 엔진 고도화
//   - RSI 반전: ATR 적응형 임계값 미세조정 (27/73) + 연속봉 확인 필터
//   - MACD: 히스토그램 기울기 가속도 필터 + 시그널 강도 등급화
//   - 백테스트 엔진: MAE/MFE 추적, Expectancy, Recovery Factor, 월별 수익률 추가
//   - 거래량 돌파: 연속 거래량 증가 3봉 확인 강화
//   - 볼린저밴드: %B 극단값 수치 표시 + 밴드 수축률 정량화
// v3.4: 거래량 돌파 RSI+ATR 동적 홀드, 피보나치 확장 룩백, 갭&고 ATR 임계값
// v3.3: 전략 파라미터 최적화 + 백테스트 고도화
// v3.2: BTC 알파 전략 추가 (비트코인 전용 멀티팩터 자동매매)
// v3.1: 전 전략 거래량 확인·다이버전스·추세필터·신뢰도 지표 적용
// ════════════════════════════════════════════════════════════════════

// ── 보조지표 계산 함수 ───────────────────────────────────────────
export function calcSMA(data, period) {
  return data.map((_, i) => {
    if (i < period - 1) return null;
    return data.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period;
  });
}

export function calcEMA(data, period) {
  const k = 2 / (period + 1);
  const ema = [data[0]];
  for (let i = 1; i < data.length; i++) {
    ema.push(data[i] * k + ema[i - 1] * (1 - k));
  }
  return ema;
}

export function calcRSI(closes, period = 14) {
  const rsi = new Array(closes.length).fill(null);
  if (closes.length < period + 1) return rsi;
  let ag = 0, al = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) ag += d; else al -= d;
  }
  ag /= period; al /= period;
  rsi[period] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    ag = (ag * (period - 1) + Math.max(d, 0)) / period;
    al = (al * (period - 1) + Math.max(-d, 0)) / period;
    rsi[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  }
  return rsi;
}

export function calcBB(closes, period = 20, mult = 2) {
  return closes.map((_, i) => {
    if (i < period - 1) return null;
    const sl = closes.slice(i - period + 1, i + 1);
    const mean = sl.reduce((a, b) => a + b, 0) / period;
    const std = Math.sqrt(sl.reduce((a, b) => a + (b - mean) ** 2, 0) / period);
    return { upper: mean + mult * std, middle: mean, lower: mean - mult * std, bw: mean > 0 ? (std * 2 * mult) / mean : 0 };
  });
}

export function calcMACD(closes) {
  const ema12 = calcEMA(closes, 12);
  const ema26 = calcEMA(closes, 26);
  const macdLine = ema12.map((v, i) => v - ema26[i]);
  const signal = calcEMA(macdLine, 9);
  const histogram = macdLine.map((v, i) => v - signal[i]);
  return { macdLine, signal, histogram };
}

export function calcStochastic(highs, lows, closes, kPeriod = 14, dPeriod = 3) {
  const kArr = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < kPeriod - 1) { kArr.push(null); continue; }
    const hh = Math.max(...highs.slice(i - kPeriod + 1, i + 1));
    const ll = Math.min(...lows.slice(i - kPeriod + 1, i + 1));
    kArr.push(hh === ll ? 50 : ((closes[i] - ll) / (hh - ll)) * 100);
  }
  const dArr = kArr.map((_, i) => {
    if (i < kPeriod - 1 + dPeriod - 1) return null;
    const sl = kArr.slice(i - dPeriod + 1, i + 1).filter(v => v != null);
    return sl.length ? sl.reduce((a, b) => a + b, 0) / sl.length : null;
  });
  return { k: kArr, d: dArr };
}

export function calcATR(highs, lows, closes, period = 14) {
  const tr = [highs[0] - lows[0]];
  for (let i = 1; i < closes.length; i++) {
    tr.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
  }
  const atr = new Array(closes.length).fill(null);
  if (tr.length < period) return atr;
  let sum = tr.slice(0, period).reduce((a, b) => a + b, 0);
  atr[period - 1] = sum / period;
  for (let i = period; i < tr.length; i++) {
    atr[i] = (atr[i - 1] * (period - 1) + tr[i]) / period;
  }
  return atr;
}

export function calcADX(highs, lows, closes, period = 14) {
  const n = closes.length;
  const dx = new Array(n).fill(null);
  const adx = new Array(n).fill(null);
  if (n < period * 2) return adx;

  const plusDM = [], minusDM = [], tr = [];
  for (let i = 1; i < n; i++) {
    const upMove = highs[i] - highs[i - 1];
    const downMove = lows[i - 1] - lows[i];
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
    tr.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
  }

  let smoothPDM = plusDM.slice(0, period).reduce((a, b) => a + b, 0);
  let smoothMDM = minusDM.slice(0, period).reduce((a, b) => a + b, 0);
  let smoothTR = tr.slice(0, period).reduce((a, b) => a + b, 0);

  const dxArr = [];
  for (let i = period; i < tr.length; i++) {
    smoothPDM = smoothPDM - smoothPDM / period + plusDM[i];
    smoothMDM = smoothMDM - smoothMDM / period + minusDM[i];
    smoothTR = smoothTR - smoothTR / period + tr[i];
    const pdi = smoothTR > 0 ? (smoothPDM / smoothTR) * 100 : 0;
    const mdi = smoothTR > 0 ? (smoothMDM / smoothTR) * 100 : 0;
    const dxVal = (pdi + mdi) > 0 ? Math.abs(pdi - mdi) / (pdi + mdi) * 100 : 0;
    dxArr.push(dxVal);
  }

  if (dxArr.length >= period) {
    let adxSum = dxArr.slice(0, period).reduce((a, b) => a + b, 0) / period;
    adx[period * 2] = adxSum;
    for (let i = period; i < dxArr.length; i++) {
      adxSum = (adxSum * (period - 1) + dxArr[i]) / period;
      adx[period + 1 + i] = adxSum;
    }
  }
  return adx;
}

export function calcWilliamsR(highs, lows, closes, period = 14) {
  return closes.map((_, i) => {
    if (i < period - 1) return null;
    const hh = Math.max(...highs.slice(i - period + 1, i + 1));
    const ll = Math.min(...lows.slice(i - period + 1, i + 1));
    return hh === ll ? -50 : ((hh - closes[i]) / (hh - ll)) * -100;
  });
}

// Donchian Channel (터틀 트레이딩)
function calcDonchian(highs, lows, period) {
  return highs.map((_, i) => {
    if (i < period - 1) return null;
    return {
      upper: Math.max(...highs.slice(i - period + 1, i + 1)),
      lower: Math.min(...lows.slice(i - period + 1, i + 1)),
      mid: (Math.max(...highs.slice(i - period + 1, i + 1)) + Math.min(...lows.slice(i - period + 1, i + 1))) / 2,
    };
  });
}

// Keltner Channel
function calcKeltner(closes, highs, lows, emaPeriod = 20, atrPeriod = 10, atrMult = 2) {
  const ema = calcEMA(closes, emaPeriod);
  const atr = calcATR(highs, lows, closes, atrPeriod);
  return closes.map((_, i) => {
    if (atr[i] == null) return null;
    return { upper: ema[i] + atrMult * atr[i], middle: ema[i], lower: ema[i] - atrMult * atr[i] };
  });
}

// ════════════════════════════════════════════════════════════════════
// 공통 필터 유틸리티 (v3.1 — 전략 고도화)
// ════════════════════════════════════════════════════════════════════

// 거래량 확인: 최근 N일 평균 대비 현재 거래량이 threshold 배 이상인지
function isVolumeConfirmed(candles, index, lookback = 20, threshold = 1.2) {
  if (index < lookback || !candles[index]?.volume) return true; // 데이터 부족 시 통과
  const avgVol = candles.slice(index - lookback, index).reduce((s, c) => s + (c.volume || 0), 0) / lookback;
  return avgVol > 0 ? candles[index].volume >= avgVol * threshold : true;
}

// 추세 방향 필터: SMA50 기반 상승/하락 추세 판별
function getTrendDirection(closes, index, period = 50) {
  if (index < period) return "neutral";
  const sma = closes.slice(index - period + 1, index + 1).reduce((a, b) => a + b, 0) / period;
  if (!sma || sma === 0) return "neutral";
  const pct = (closes[index] - sma) / sma;
  if (pct > 0.02) return "up";
  if (pct < -0.02) return "down";
  return "neutral";
}

// RSI 다이버전스 감지: 가격은 신저점인데 RSI는 높아지는 패턴 (강세 다이버전스)
function detectBullishDivergence(closes, rsi, index, lookback = 10) {
  if (index < lookback || rsi[index] == null) return false;
  // 최근 lookback 내에서 가격 저점 찾기
  let priceNewLow = false, rsiHigherLow = false;
  for (let i = index - lookback; i < index - 2; i++) {
    if (rsi[i] == null) continue;
    if (closes[index] < closes[i] && rsi[index] > rsi[i]) {
      priceNewLow = true;
      rsiHigherLow = true;
      break;
    }
  }
  return priceNewLow && rsiHigherLow;
}

// 약세 다이버전스: 가격은 신고점인데 RSI는 낮아지는 패턴
function detectBearishDivergence(closes, rsi, index, lookback = 10) {
  if (index < lookback || rsi[index] == null) return false;
  for (let i = index - lookback; i < index - 2; i++) {
    if (rsi[i] == null) continue;
    if (closes[index] > closes[i] && rsi[index] < rsi[i]) return true;
  }
  return false;
}

// ════════════════════════════════════════════════════════════════════
// 매매 전략 정의 (41개) — v3.9 전략 업데이트
// ════════════════════════════════════════════════════════════════════

// ━━━ 전략 1: RSI 반전 전략 ━━━
// v3.6: 변동성 레짐 기반 적응형 임계값 + RSI 기울기 확인 + 거래량 완화
export const strategyRSI = {
  id: "rsi_reversal",
  name: "RSI 반전 전략",
  desc: "RSI(14) 과매도/과매수 진입. v4.1: 고변동장 최적화 임계값(25/75) + 패닉 매도 반전 포착(하락추세 RSI 18) + 변동성 레짐 적응형.",
  category: "평균회귀",
  risk: "중",
  icon: "📉",
  params: { period: 14, buyThreshold: 25, sellThreshold: 75 }, // v4.1: 26/74→25/75 고변동장 과매도 진입 확대
  generate(candles, params = {}) {
    const { period = 14, buyThreshold = 25, sellThreshold = 75 } = { ...this.params, ...params };
    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const rsi = calcRSI(closes, period);
    const atr = calcATR(highs, lows, closes, 14);
    const { histogram } = calcMACD(closes);
    const signals = [];
    for (let i = 2; i < candles.length; i++) {
      if (rsi[i] == null || rsi[i - 1] == null) continue;
      // v3.6: 변동성 레짐 감지 — ATR%의 20봉 이동평균 대비 비율로 레짐 판단
      const atrPct = atr[i] && closes[i] ? (atr[i] / closes[i]) * 100 : 1.5;
      let atrAvg = atrPct;
      if (i >= 20) {
        let atrSum = 0, atrCnt = 0;
        for (let j = i - 19; j <= i; j++) {
          if (atr[j] && closes[j]) { atrSum += (atr[j] / closes[j]) * 100; atrCnt++; }
        }
        if (atrCnt > 0) atrAvg = atrSum / atrCnt;
      }
      const volRegime = atrPct > atrAvg * 1.3 ? "high" : atrPct < atrAvg * 0.7 ? "low" : "normal";
      // v3.9: 레짐 기반 임계값 — 고변동: 과매도 더 깊게(-4), 저변동: 완화(+3)
      const regimeBuy = volRegime === "high" ? buyThreshold - 4 : volRegime === "low" ? buyThreshold + 3 : buyThreshold;
      const regimeSell = volRegime === "high" ? sellThreshold + 4 : volRegime === "low" ? sellThreshold - 3 : sellThreshold;
      const volAdj = Math.min(Math.max(atrPct / 1.5 - 1, -3), 3);
      const adjBuy = regimeBuy + volAdj;
      const adjSell = regimeSell - volAdj;
      if (rsi[i] <= adjBuy && rsi[i - 1] > adjBuy) {
        if (!isVolumeConfirmed(candles, i, 20, 0.65)) continue; // v4.0: 0.7→0.65 완화 (더 많은 시그널 포착)
        const trend = getTrendDirection(closes, i);
        if (trend === "down" && rsi[i] > 18) continue; // v4.1: 20→18 패닉 매도 반전 포착 (VIX 25+ 환경)
        // v3.5: 연속 하락봉 후 반전봉 확인
        const prevBearish = (i >= 2 && candles[i-1].close < candles[i-1].open) || (i >= 3 && candles[i-2].close < candles[i-2].open);
        if (!prevBearish && rsi[i] > 20) continue; // v4.1: 22→20 반전봉 확인 기준 완화
        // v3.6: RSI 3봉 기울기 반전 확인 — RSI가 최근 저점에서 상승 전환 중인지 확인
        const rsiSlope = i >= 3 && rsi[i-2] != null ? (rsi[i] - rsi[i-2]) : 0;
        const rsiTurning = rsiSlope > -2; // 급락 중이면 아직 반전 아님
        if (!rsiTurning && rsi[i] > 22) continue;
        // v3.5: MACD 히스토그램 반등 확인
        const macdTurning = i >= 2 && histogram[i] > histogram[i - 1];
        const div = detectBullishDivergence(closes, rsi, i);
        const regLabel = volRegime === "high" ? " · 고변동" : volRegime === "low" ? " · 저변동" : "";
        signals.push({ index: i, type: "BUY", price: closes[i],
          reason: `RSI ${rsi[i].toFixed(1)} ≤ ${adjBuy.toFixed(0)}${div ? " + 강세다이버전스" : ""}${macdTurning ? " · MACD↑" : ""}${trend === "up" ? " · 상승추세" : ""}${regLabel}` });
      } else if (rsi[i] >= adjSell && rsi[i - 1] < adjSell) {
        const div = detectBearishDivergence(closes, rsi, i);
        const trend = getTrendDirection(closes, i);
        if (trend === "up" && rsi[i] < 80) continue;
        const macdFalling = i >= 2 && histogram[i] < histogram[i - 1];
        signals.push({ index: i, type: "SELL", price: closes[i],
          reason: `RSI ${rsi[i].toFixed(1)} ≥ ${adjSell.toFixed(0)}${div ? " + 약세다이버전스" : ""}${macdFalling ? " · MACD↓" : ""}` });
      }
    }
    return signals;
  },
};

// ━━━ 전략 2: 볼린저밴드 바운스 ━━━
export const strategyBB = {
  id: "bb_bounce",
  name: "볼린저밴드 바운스",
  desc: "가격이 BB 하단에 닿으면 매수, 상단에 닿으면 매도. v3.8: MA200 추세필터 — 하락추세 매수 억제 + RSI 다이버전스 필수.",
  category: "평균회귀",
  risk: "중",
  icon: "🎯",
  params: { period: 20, mult: 2 },
  generate(candles, params = {}) {
    const { period = 20, mult = 2 } = { ...this.params, ...params };
    const closes = candles.map(c => c.close);
    const bb = calcBB(closes, period, mult);
    const rsi14 = calcRSI(closes, 14);
    const ma200 = calcSMA(closes, 200);
    const signals = [];
    for (let i = 1; i < candles.length; i++) {
      if (!bb[i] || !bb[i - 1]) continue;
      // v3.5: %B 수치 정량화 (0 = 하단, 1 = 상단)
      const bbRange = bb[i].upper - bb[i].lower;
      const pctB = bbRange > 0 ? ((closes[i] - bb[i].lower) / bbRange) : 0.5;
      // v3.5: 밴드 수축률 (최근 20봉 대비 현재 BW 비율)
      const recentBWs = [];
      for (let j = Math.max(1, i - 20); j < i; j++) { if (bb[j]) recentBWs.push(bb[j].bw); }
      const avgBW = recentBWs.length > 0 ? recentBWs.reduce((a, b) => a + b, 0) / recentBWs.length : bb[i].bw;
      const bwRatio = avgBW > 0 ? (bb[i].bw / avgBW) : 1;
      if (closes[i] <= bb[i].lower && closes[i - 1] > bb[i - 1].lower) {
        if (!isVolumeConfirmed(candles, i, 20, 0.8)) continue;
        // v4.1: 밴드폭 극단 수축 시 역추세 신호 억제 — 스퀴즈 구간 더 엄격 억제 (0.5→0.45)
        if (bwRatio < 0.45) continue; // v4.1: 고변동장 스퀴즈 구간 더 넓게 차단
        const rsiOversold = rsi14[i] != null && rsi14[i] < 35;
        const div = detectBullishDivergence(closes, rsi14, i);
        // v3.9: 종가 이탈 기준을 ATR 비례로 조정 (고변동: 완화, 저변동: 엄격)
        const penetration = bb[i].lower > 0 ? ((bb[i].lower - closes[i]) / bb[i].lower) * 100 : 0;
        const localAtrPct = bb[i].bw || 1.5; // BB bandwidth를 ATR 프록시로 활용
        const dynPenThreshold = Math.max(0.1, Math.min(0.5, localAtrPct * 0.15));
        if (penetration < dynPenThreshold && !rsiOversold) continue;
        // v3.8: MA200 추세 필터 — 가격이 MA200 아래이면 하락추세로 간주, 다이버전스 필수
        const belowMA200 = ma200[i] != null && closes[i] < ma200[i];
        if (belowMA200 && !div) continue; // 하락추세에서 다이버전스 없으면 매수 억제
        const trendTag = belowMA200 ? " · MA200↓" : "";
        signals.push({ index: i, type: "BUY", price: closes[i],
          reason: `BB 하단 (%B=${pctB.toFixed(2)})${rsiOversold ? ` + RSI${rsi14[i].toFixed(0)}` : ""}${div ? " + 강세다이버전스" : ""}${bwRatio < 0.8 ? " · 밴드수축" : ""}${trendTag}` });
      } else if (closes[i] >= bb[i].upper && closes[i - 1] < bb[i - 1].upper) {
        if (bwRatio < 0.45) continue; // v4.1: 0.5→0.45 스퀴즈 구간 보호 강화 (매도측도 동일)
        const div = detectBearishDivergence(closes, rsi14, i);
        signals.push({ index: i, type: "SELL", price: closes[i],
          reason: `BB 상단 (%B=${pctB.toFixed(2)})${div ? " + 약세다이버전스" : ""}${bwRatio < 0.8 ? " · 밴드수축" : ""}` });
      }
    }
    return signals;
  },
};

// ━━━ 전략 3: MACD 크로스오버 ━━━
// v3.6: 제로라인 거리 기반 시그널 필터링 + 히스토그램 정규화
export const strategyMACD = {
  id: "macd_crossover",
  name: "MACD 크로스오버",
  desc: "MACD 골든/데드크로스. v3.6: 제로라인 거리 필터(원거리 크로스 억제) + 히스토그램 ATR 정규화 + 시그널 강도 등급(A/B/C).",
  category: "추세추종",
  risk: "중",
  icon: "✨",
  params: {},
  generate(candles) {
    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const { macdLine, signal, histogram } = calcMACD(closes);
    const atr = calcATR(highs, lows, closes, 14);
    const signals = [];
    for (let i = 30; i < candles.length; i++) {
      const prevDiff = macdLine[i - 1] - signal[i - 1];
      const curDiff = macdLine[i] - signal[i];
      if (prevDiff <= 0 && curDiff > 0) {
        if (!isVolumeConfirmed(candles, i, 20, 1.0)) continue;
        const trend = getTrendDirection(closes, i);
        // v3.6: 제로라인 거리 필터 — MACD 라인이 가격 대비 너무 멀면 노이즈
        const macdPct = closes[i] > 0 ? Math.abs(macdLine[i]) / closes[i] * 100 : 0;
        const atrPct = atr[i] && closes[i] ? (atr[i] / closes[i]) * 100 : 2;
        if (macdPct > atrPct * 3 && macdLine[i] < 0) continue; // 과도한 음의 영역에서 크로스는 약한 신호
        // v3.5: 히스토그램 기울기 가속도
        const histRising = i >= 32 && histogram[i] > histogram[i - 1] && histogram[i - 1] > histogram[i - 2];
        const histAccel = histRising && i >= 33 &&
          (histogram[i] - histogram[i-1]) > (histogram[i-1] - histogram[i-2]);
        const aboveZero = macdLine[i] > 0;
        // v3.6: 히스토그램 ATR 정규화 크기 기반 필터 — 히스토그램이 ATR의 5% 미만이면 미약한 신호
        const histNorm = atr[i] ? Math.abs(histogram[i]) / atr[i] : 1;
        // v3.5: 시그널 강도 등급화 (v3.6: histNorm 반영)
        let grade = "C";
        if (histAccel && aboveZero && trend === "up" && histNorm > 0.1) grade = "A";
        else if (histRising && (aboveZero || trend === "up")) grade = "B";
        else if ((histRising || aboveZero) && histNorm > 0.05) grade = "B";
        // v3.6: C등급이고 히스토그램 미약하면 스킵
        if (grade === "C" && histNorm < 0.03) continue;
        const zoneLabel = aboveZero ? "제로상" : "제로하";
        signals.push({ index: i, type: "BUY", price: closes[i],
          confidence: grade,
          reason: `MACD 골든크로스 [${grade}급 · ${zoneLabel}${histAccel ? " · 가속" : ""}${trend === "up" ? " · 상승추세" : ""}]` });
      } else if (prevDiff >= 0 && curDiff < 0) {
        if (!isVolumeConfirmed(candles, i, 20, 1.0)) continue;
        const histFalling = i >= 32 && histogram[i] < histogram[i - 1] && histogram[i - 1] < histogram[i - 2];
        const histDecel = histFalling && i >= 33 &&
          (histogram[i] - histogram[i-1]) < (histogram[i-1] - histogram[i-2]);
        signals.push({ index: i, type: "SELL", price: closes[i],
          reason: `MACD 데드크로스${histDecel ? " (급락가속)" : histFalling ? " (히스토그램 하락)" : ""}` });
      }
    }
    return signals;
  },
};

// ━━━ 전략 4: 이동평균 골든/데드크로스 ━━━
// v3.6: EMA 기반 전환 + 스프레드 최소치 필터 (잡신호 제거)
export const strategyMA = {
  id: "ma_crossover",
  name: "이평선 크로스 (20/60)",
  desc: "20일선이 60일선 위로 돌파 매수, 아래로 돌파 매도. v3.6: EMA 사용으로 빠른 반응 + 스프레드 0.1% 미만 크로스 필터링.",
  category: "추세추종",
  risk: "낮음",
  icon: "🏆",
  params: { shortPeriod: 20, longPeriod: 60, useEMA: true },
  generate(candles, params = {}) {
    const { shortPeriod = 20, longPeriod = 60, useEMA = true } = { ...this.params, ...params };
    const closes = candles.map(c => c.close);
    // v3.6: EMA 사용 옵션 — SMA 대비 최근 가격 반영도 상승
    const shortMA = useEMA ? calcEMA(closes, shortPeriod) : calcSMA(closes, shortPeriod);
    const longMA = useEMA ? calcEMA(closes, longPeriod) : calcSMA(closes, longPeriod);
    const signals = [];
    for (let i = longPeriod + 1; i < candles.length; i++) {
      if (shortMA[i] == null || longMA[i] == null || shortMA[i - 1] == null || longMA[i - 1] == null) continue;
      if (shortMA[i - 1] <= longMA[i - 1] && shortMA[i] > longMA[i]) {
        if (!isVolumeConfirmed(candles, i, 20, 1.1)) continue;
        const spread = ((shortMA[i] - longMA[i]) / longMA[i] * 100);
        // v3.6: 스프레드 최소치 필터 — 0.1% 미만 크로스는 잡신호 가능성 높음
        if (spread < 0.1) continue;
        signals.push({ index: i, type: "BUY", price: closes[i], reason: `${shortPeriod}${useEMA ? "EMA" : "MA"} > ${longPeriod}${useEMA ? "EMA" : "MA"} 골든크로스 (스프레드 ${spread.toFixed(2)}%)` });
      } else if (shortMA[i - 1] >= longMA[i - 1] && shortMA[i] < longMA[i]) {
        if (!isVolumeConfirmed(candles, i, 20, 1.0)) continue;
        const spread = ((longMA[i] - shortMA[i]) / longMA[i] * 100);
        if (spread < 0.1) continue; // v3.6: 데드크로스에도 최소치 적용
        signals.push({ index: i, type: "SELL", price: closes[i], reason: `${shortPeriod}${useEMA ? "EMA" : "MA"} < ${longPeriod}${useEMA ? "EMA" : "MA"} 데드크로스` });
      }
    }
    return signals;
  },
};

// ━━━ 전략 5: 거래량 돌파 ━━━
export const strategyVolume = {
  id: "volume_breakout",
  name: "거래량 돌파 전략",
  desc: "거래량이 20일 평균 2배 이상 + 양봉이면 매수. 강한 매수세 포착. v3.4: RSI 확인 + ATR 기반 동적 홀드기간 + 거래량 지속성 확인.",
  category: "모멘텀",
  risk: "높음",
  icon: "🔥",
  params: { volPeriod: 20, volMult: 2.0, holdBars: 5 },
  generate(candles, params = {}) {
    const { volPeriod = 20, volMult = 2.0, holdBars = 5 } = { ...this.params, ...params };
    const signals = [];
    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const rsi = calcRSI(closes);
    const atr = calcATR(highs, lows, closes);
    for (let i = volPeriod; i < candles.length; i++) {
      const avgVol = candles.slice(i - volPeriod, i).reduce((a, c) => a + (c.volume || 0), 0) / volPeriod;
      const vol = candles[i].volume || 0;
      const isGreen = candles[i].close > candles[i].open;
      if (vol >= avgVol * volMult && isGreen && avgVol > 0) {
        // v3.1: 추세 방향 확인 — 하락 추세에서는 거래량 돌파 무시
        const trend = getTrendDirection(closes, i);
        if (trend === "down") continue;
        // v3.4: RSI 확인 — 매수 시 RSI < 65만 (과매수 제외)
        if (rsi[i] != null && rsi[i] > 65) continue;
        // v3.6: 거래량 지속성 완화 — 전봉이 평균의 80% 이상이면 허용 (기존: avgVol 100%)
        const prevVol = i > 0 ? candles[i - 1].volume || 0 : 0;
        if (i > 0 && prevVol < avgVol * 0.8) continue;
        // 연속 양봉 확인 (1봉 전도 양봉이면 강화)
        const prevGreen = i > 0 && candles[i-1].close > candles[i-1].open;
        signals.push({ index: i, type: "BUY", price: candles[i].close,
          reason: `거래량 ${(vol / avgVol).toFixed(1)}x 급증${prevGreen ? " · 연속양봉" : ""}${trend === "up" ? " · 상승추세" : ""} · RSI=${rsi[i]?.toFixed(0)}` });
        // v3.4: ATR 기반 동적 홀드 기간 (ATR 클수록 길게 보유)
        const atrVal = atr[i] || 0;
        const closePrice = candles[i].close;
        const dynamicHold = atrVal > 0 ? Math.ceil(holdBars * (1 + atrVal / closePrice)) : holdBars;
        const sellIdx = Math.min(i + Math.min(dynamicHold, 20), candles.length - 1);
        signals.push({ index: sellIdx, type: "SELL", price: candles[sellIdx].close, reason: `${dynamicHold}봉 보유 후 매도 (ATR기반)` });
      }
    }
    return signals;
  },
};

// ━━━ 전략 6: 스토캐스틱+RSI 콤보 ━━━
export const strategyCombo = {
  id: "stoch_rsi_combo",
  name: "스토캐스틱+RSI 콤보",
  desc: "RSI < 35 AND Stoch %K < 25 동시 충족 매수. v3.9: MA200 하락추세 보수적 임계값(RSI<25,K<15) + RSI 기울기 반전 확인.",
  category: "평균회귀",
  risk: "낮음",
  icon: "🌊",
  params: { rsiBuy: 35, rsiSell: 65, stochBuy: 25, stochSell: 75 },
  generate(candles, params = {}) {
    const { rsiBuy = 35, rsiSell = 65, stochBuy = 25, stochSell = 75 } = { ...this.params, ...params };
    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const rsi = calcRSI(closes);
    const stoch = calcStochastic(highs, lows, closes);
    const ma200 = calcSMA(closes, 200);
    const signals = [];
    for (let i = 20; i < candles.length; i++) {
      if (rsi[i] == null || stoch.k[i] == null) continue;
      // v3.9: MA200 하락추세 시 보수적 임계값 적용
      const belowMA200 = ma200[i] != null && closes[i] < ma200[i];
      const effRsiBuy = belowMA200 ? 25 : rsiBuy;
      const effStochBuy = belowMA200 ? 15 : stochBuy;
      if (rsi[i] <= effRsiBuy && stoch.k[i] <= effStochBuy) {
        // v3.1: 삼중 확인 — RSI + Stoch + 다이버전스 + 거래량
        if (!isVolumeConfirmed(candles, i, 20, 0.7)) continue;
        // v3.9: RSI 기울기 반전 확인 — RSI가 직전 봉보다 높아야 (바닥 확인)
        if (rsi[i - 1] != null && rsi[i] < rsi[i - 1]) continue;
        const div = detectBullishDivergence(closes, rsi, i);
        // v3.9: MA200 아래이면 다이버전스 필수
        if (belowMA200 && !div) continue;
        const stochCross = stoch.k[i] > stoch.d[i] && (stoch.k[i - 1] || 50) <= (stoch.d[i - 1] || 50);
        signals.push({ index: i, type: "BUY", price: closes[i],
          reason: `RSI ${rsi[i].toFixed(1)} + Stoch ${stoch.k[i].toFixed(1)} 과매도${stochCross ? " + K>D크로스" : ""}${div ? " + 다이버전스" : ""}${belowMA200 ? " · MA200↓" : ""}` });
      } else if (rsi[i] >= rsiSell && stoch.k[i] >= stochSell) {
        const div = detectBearishDivergence(closes, rsi, i);
        signals.push({ index: i, type: "SELL", price: closes[i],
          reason: `RSI ${rsi[i].toFixed(1)} + Stoch ${stoch.k[i].toFixed(1)} 과매수${div ? " + 다이버전스" : ""}` });
      }
    }
    return signals;
  },
};

// ━━━ 전략 7: 터틀 트레이딩 (Donchian Breakout) ━━━
// 리처드 데니스의 터틀 트레이딩 — 20일 고가 돌파 매수, 10일 저가 이탈 매도
export const strategyTurtle = {
  id: "turtle_breakout",
  name: "터틀 트레이딩",
  desc: "20일 최고가 돌파 매수, 10일 최저가 이탈 매도. 리처드 데니스의 추세추종 전략.",
  category: "추세추종",
  risk: "중",
  icon: "🐢",
  params: { entryPeriod: 20, exitPeriod: 10 },
  generate(candles, params = {}) {
    const { entryPeriod = 20, exitPeriod = 10 } = { ...this.params, ...params };
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const closes = candles.map(c => c.close);
    const entryDonchian = calcDonchian(highs, lows, entryPeriod);
    const exitDonchian = calcDonchian(highs, lows, exitPeriod);
    const signals = [];
    for (let i = entryPeriod + 1; i < candles.length; i++) {
      if (!entryDonchian[i - 1] || !exitDonchian[i - 1]) continue;
      if (closes[i] > entryDonchian[i - 1].upper) {
        // v3.1: 돌파 시 거래량 1.2배 이상 확인
        if (!isVolumeConfirmed(candles, i, 20, 1.2)) continue;
        signals.push({ index: i, type: "BUY", price: closes[i], reason: `${entryPeriod}일 고가 돌파 + 거래량 확인` });
      } else if (closes[i] < exitDonchian[i - 1].lower)
        signals.push({ index: i, type: "SELL", price: closes[i], reason: `${exitPeriod}일 저가 이탈` });
    }
    return signals;
  },
};

// ━━━ 전략 8: 켈트너 채널 평균회귀 ━━━
// 켈트너 채널 하단 이탈 후 복귀 시 매수
export const strategyKeltner = {
  id: "keltner_reversion",
  name: "켈트너 채널 회귀",
  desc: "켈트너 채널 하단 이탈 후 복귀 시 매수, 상단 이탈 후 복귀 시 매도. ATR 기반 채널 전략.",
  category: "평균회귀",
  risk: "중",
  icon: "📐",
  params: { emaPeriod: 20, atrPeriod: 10, atrMult: 2 },
  generate(candles, params = {}) {
    const { emaPeriod = 20, atrPeriod = 10, atrMult = 2 } = { ...this.params, ...params };
    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const kc = calcKeltner(closes, highs, lows, emaPeriod, atrPeriod, atrMult);
    const signals = [];
    for (let i = 2; i < candles.length; i++) {
      if (!kc[i] || !kc[i - 1] || !kc[i - 2]) continue;
      // v3.1: 켈트너 복귀 + 거래량 + 채널 폭 기반 신뢰도
      const chanWidth = ((kc[i].upper - kc[i].lower) / kc[i].middle * 100).toFixed(1);
      // 하단 이탈 후 복귀
      if (closes[i - 1] < kc[i - 1].lower && closes[i] > kc[i].lower) {
        if (!isVolumeConfirmed(candles, i, 20, 0.8)) continue;
        signals.push({ index: i, type: "BUY", price: closes[i], reason: `켈트너 하단 복귀 (채널폭 ${chanWidth}%)` });
      }
      // 상단 이탈 후 복귀
      else if (closes[i - 1] > kc[i - 1].upper && closes[i] < kc[i].upper)
        signals.push({ index: i, type: "SELL", price: closes[i], reason: `켈트너 상단 복귀 (채널폭 ${chanWidth}%)` });
    }
    return signals;
  },
};

// ━━━ 전략 9: 듀얼 모멘텀 (절대 + 상대) ━━━
// Gary Antonacci의 듀얼 모멘텀 — v3.7: RSI 확인 + ADX 추세강도 + 모멘텀 기울기 필터
export const strategyDualMomentum = {
  id: "dual_momentum",
  name: "듀얼 모멘텀",
  desc: "절대 모멘텀(수익률>0) + 추세필터(가격>200MA) + RSI 확인 + ADX 추세강도 + 모멘텀 기울기 필터. v3.7 고도화.",
  category: "모멘텀",
  risk: "낮음",
  icon: "🚀",
  params: { lookback: 60, maPeriod: 200, adxMin: 18 },
  generate(candles, params = {}) {
    const { lookback = 60, maPeriod: maP = 200, adxMin = 18 } = { ...this.params, ...params };
    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const effectiveMA = Math.min(maP, Math.floor(closes.length * 0.6));
    const ma = calcSMA(closes, effectiveMA);
    const rsi = calcRSI(closes, 14);
    const adx = calcADX(highs, lows, closes, 14);
    const signals = [];
    for (let i = Math.max(lookback, effectiveMA) + 1; i < candles.length; i++) {
      if (ma[i] == null || ma[i - 1] == null) continue;
      const mom = (closes[i] - closes[i - lookback]) / closes[i - lookback];
      const prevMom = (closes[i - 1] - closes[i - 1 - lookback]) / closes[i - 1 - lookback];
      // v3.7: 모멘텀 기울기 확인 (3봉 연속 개선 필터)
      const momSlope = i >= 3 ? mom - (closes[i - 3] - closes[i - 3 - lookback]) / closes[i - 3 - lookback] : 0;
      const adxVal = adx[i] || 0;
      const rsiVal = rsi[i] || 50;
      // v3.7: 모멘텀 양전환 + 가격 > MA + ADX 추세 확인 + RSI 모멘텀 확인
      if (mom > 0 && prevMom <= 0 && closes[i] > ma[i] && adxVal >= adxMin && rsiVal > 40 && momSlope > 0) {
        if (!isVolumeConfirmed(candles, i, 20, 1.0)) continue;
        const momStrength = mom > 0.1 ? "강" : mom > 0.05 ? "중" : "약";
        signals.push({ index: i, type: "BUY", price: closes[i], reason: `듀얼모멘텀 진입 (수익률 ${(mom * 100).toFixed(1)}% · ${momStrength} · ADX ${adxVal.toFixed(0)})` });
      }
      // v3.7: 이탈 조건에도 RSI 약세 확인 추가
      else if (((mom < 0 && prevMom >= 0) || (closes[i] < ma[i] && closes[i - 1] >= ma[i - 1])) && rsiVal < 55)
        signals.push({ index: i, type: "SELL", price: closes[i], reason: `듀얼모멘텀 이탈 (${(mom * 100).toFixed(1)}% · RSI ${rsiVal.toFixed(0)})` });
    }
    return signals;
  },
};

// ━━━ 전략 10: Williams %R + ADX 필터 ━━━
// Williams %R 과매도 + ADX로 추세 강도 확인
export const strategyWilliamsADX = {
  id: "williams_adx",
  name: "Williams %R + ADX",
  desc: "Williams %R 과매도(-80 이하) + ADX > 25(추세 존재) 시 매수. 추세 내 저점 매수.",
  category: "추세추종",
  risk: "중",
  icon: "📊",
  params: { wrPeriod: 14, wrBuy: -80, wrSell: -20, adxThreshold: 25 },
  generate(candles, params = {}) {
    const { wrPeriod = 14, wrBuy = -80, wrSell = -20, adxThreshold = 25 } = { ...this.params, ...params };
    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const wr = calcWilliamsR(highs, lows, closes, wrPeriod);
    const adx = calcADX(highs, lows, closes);
    const signals = [];
    for (let i = 30; i < candles.length; i++) {
      if (wr[i] == null) continue;
      const adxVal = adx[i] || 0;
      if (wr[i] <= wrBuy && adxVal >= adxThreshold) {
        // v3.1: 거래량 + 추세방향 확인
        if (!isVolumeConfirmed(candles, i, 20, 0.9)) continue;
        const trend = getTrendDirection(closes, i);
        signals.push({ index: i, type: "BUY", price: closes[i],
          reason: `WR ${wr[i].toFixed(0)} + ADX ${adxVal.toFixed(0)}${trend === "up" ? " · 상승추세" : ""}` });
      } else if (wr[i] >= wrSell)
        signals.push({ index: i, type: "SELL", price: closes[i], reason: `WR ${wr[i].toFixed(0)} 과매수` });
    }
    return signals;
  },
};

// ━━━ 전략 11: BB 스퀴즈 돌파 ━━━
// 볼린저밴드 폭이 최소인 상태(스퀴즈)에서 가격 돌파 시 진입
export const strategyBBSqueeze = {
  id: "bb_squeeze",
  name: "TTM 스퀴즈 돌파",
  desc: "볼린저밴드가 켈트너 채널 안으로 수축(TTM Squeeze) → 돌파 시 매수. 대폭발 전조 포착.",
  category: "변동성",
  risk: "높음",
  icon: "⚡",
  params: { period: 20, bbMult: 2, kcEmaPeriod: 20, kcAtrPeriod: 10, kcAtrMult: 1.5, squeezeLookback: 20 },
  generate(candles, params = {}) {
    const { period = 20, bbMult = 2, kcEmaPeriod = 20, kcAtrPeriod = 10, kcAtrMult = 1.5, squeezeLookback = 20 } = { ...this.params, ...params };
    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const bb = calcBB(closes, period, bbMult);
    const kc = calcKeltner(closes, highs, lows, kcEmaPeriod, kcAtrPeriod, kcAtrMult);
    // 모멘텀 오실레이터: 선형회귀 잔차 기반 (TTM 스퀴즈 핵심)
    const mom = closes.map((_, i) => {
      if (i < period) return 0;
      const sl = closes.slice(i - period + 1, i + 1);
      const n = sl.length;
      const xMean = (n - 1) / 2, yMean = sl.reduce((a, b) => a + b, 0) / n;
      let num = 0, den = 0;
      for (let j = 0; j < n; j++) { num += (j - xMean) * (sl[j] - yMean); den += (j - xMean) ** 2; }
      const slope = den ? num / den : 0;
      const intercept = yMean - slope * xMean;
      return closes[i] - (intercept + slope * (n - 1));
    });
    const signals = [];
    for (let i = Math.max(squeezeLookback + period, kcAtrPeriod + 2); i < candles.length; i++) {
      if (!bb[i] || !bb[i - 1] || !kc[i] || !kc[i - 1]) continue;
      // TTM Squeeze: BB가 KC 안에 있으면 스퀴즈 상태
      const squeezeNow = bb[i].upper < kc[i].upper && bb[i].lower > kc[i].lower;
      const squeezePrev = bb[i - 1].upper < kc[i - 1].upper && bb[i - 1].lower > kc[i - 1].lower;
      // 폴백: 기존 BW 최소값 방식도 보조 사용
      const recentBW = [];
      for (let j = i - squeezeLookback; j < i; j++) { if (bb[j]) recentBW.push(bb[j].bw); }
      const minBW = recentBW.length ? Math.min(...recentBW) : 0;
      const bwSqueeze = bb[i - 1].bw <= minBW * 1.05;
      const isSqueeze = squeezeNow || squeezePrev || bwSqueeze;
      // 스퀴즈 해제 직후 (fired) = 가장 강력한 신호
      const squeezeFired = squeezePrev && !squeezeNow;
      if (isSqueeze && closes[i] > bb[i].upper) {
        if (!isVolumeConfirmed(candles, i, 20, squeezeFired ? 1.2 : 1.5)) continue;
        const trend = getTrendDirection(closes, i);
        const momDir = mom[i] > mom[i - 1] ? "↑" : "↓";
        const label = squeezeFired ? "TTM 스퀴즈 해제" : "BB 스퀴즈";
        signals.push({ index: i, type: "BUY", price: closes[i],
          reason: `${label} → 상단 돌파 + 거래량 · 모멘텀${momDir}${trend === "up" ? " · 상승추세" : ""}` });
      } else if (isSqueeze && closes[i] < bb[i].lower) {
        if (!isVolumeConfirmed(candles, i, 20, squeezeFired ? 1.0 : 1.3)) continue;
        const momDir = mom[i] < mom[i - 1] ? "↓" : "↑";
        const label = squeezeFired ? "TTM 스퀴즈 해제" : "BB 스퀴즈";
        signals.push({ index: i, type: "SELL", price: closes[i],
          reason: `${label} → 하단 이탈 + 거래량 · 모멘텀${momDir}` });
      }
    }
    return signals;
  },
};

// ━━━ 전략 12: 삼중 이평선 + ATR 후행 정지 ━━━
// EMA(5/20/60) 정배열 매수 + ATR 기반 동적 손절
export const strategyTripleMA = {
  id: "triple_ma_atr",
  name: "삼중 이평선 + ATR 정지",
  desc: "EMA(5) > EMA(20) > EMA(60) 정배열 매수. v4.2: MA200 추세필터 + 정배열 2봉 연속확인 + RSI 기울기 반등 + ADX 상승 확인.",
  category: "추세추종",
  risk: "중",
  icon: "🎿",
  params: { fast: 5, mid: 20, slow: 60, atrMult: 2 },
  generate(candles, params = {}) {
    const { fast = 5, mid = 20, slow = 60, atrMult = 2 } = { ...this.params, ...params };
    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const emaF = calcEMA(closes, fast);
    const emaM = calcEMA(closes, mid);
    const emaS = calcEMA(closes, slow);
    const atr = calcATR(highs, lows, closes);
    const adx = calcADX(highs, lows, closes, 14);
    const rsi = calcRSI(closes, 14);
    const signals = [];
    for (let i = slow + 1; i < candles.length; i++) {
      if (atr[i] == null) continue;
      const aligned = emaF[i] > emaM[i] && emaM[i] > emaS[i];
      const prevAligned = emaF[i - 1] > emaM[i - 1] && emaM[i - 1] > emaS[i - 1];
      if (aligned && !prevAligned) {
        // v3.1: 정배열 전환 시 거래량 확인 + 이격도 표시
        if (!isVolumeConfirmed(candles, i, 20, 1.1)) continue;
        const gap = ((emaF[i] - emaS[i]) / emaS[i] * 100);
        // v3.8: ADX 추세강도 필터 — ADX < 18이면 약한 추세, 정배열이어도 매수 보류
        const adxVal = adx[i] || 0;
        if (adxVal < 18) continue;
        // v4.2: ADX 상승 확인 — ADX가 하락 중이면 추세 약화, 진입 보류
        if (i >= 2 && adx[i - 1] != null && adx[i - 2] != null && adx[i] < adx[i - 2]) continue;
        // v3.8: 이격도 과열 억제 — 이격 > 8%면 이미 과열, 추격매수 방지
        if (gap > 8) continue;
        // v3.8: RSI 확인 — 과매수(>75) 상태에서 정배열 전환은 고점 신호
        const rsiVal = rsi[i] || 50;
        if (rsiVal > 75) continue;
        // v4.2: RSI 기울기 반등 확인 — RSI가 하락 중이면 모멘텀 약화
        if (i >= 2 && rsi[i - 1] != null && rsi[i - 2] != null && rsiVal < rsi[i - 2]) continue;
        // v4.2: MA200 추세필터 — 장기 하락추세에서 정배열은 베어마켓 랠리일 가능성
        const ma200 = calcSMA(closes.slice(0, i + 1), Math.min(200, i + 1));
        const ma200Val = ma200[ma200.length - 1];
        if (ma200Val != null && closes[i] < ma200Val * 0.95) continue;
        signals.push({ index: i, type: "BUY", price: closes[i], reason: `삼중 이평선 정배열 (이격 ${gap.toFixed(1)}% · ADX ${adxVal.toFixed(0)}↑ · RSI ${rsiVal.toFixed(0)})` });
      }
      // ATR 후행 정지
      const trailingStop = emaM[i] - atrMult * atr[i];
      if (!aligned && prevAligned || closes[i] < trailingStop)
        signals.push({ index: i, type: "SELL", price: closes[i], reason: `ATR 후행정지 (${trailingStop.toFixed(2)}) / 정배열 해제` });
    }
    return signals;
  },
};

// ━━━ 전략 13: VWAP 반전 ━━━
// 거래량 가중 평균가 기반 — 기관투자자의 기준선
export const strategyVWAP = {
  id: "vwap_reversion",
  name: "VWAP 반전",
  desc: "가격이 VWAP(20봉 근사) 아래로 이탈 후 복귀 시 매수. v3.8: ATR 동적 임계값 + RSI 과매도 확인 + 추세필터.",
  category: "평균회귀",
  risk: "중",
  icon: "🏦",
  params: { period: 20, threshold: 0.02 },
  generate(candles, params = {}) {
    const { period = 20, threshold = 0.02 } = { ...this.params, ...params };
    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const atr = calcATR(highs, lows, closes);
    const rsi = calcRSI(closes, 14);
    const signals = [];
    for (let i = period; i < candles.length; i++) {
      // VWAP 근사: 기간 내 (TP*Vol)/Vol 합
      let tpvSum = 0, volSum = 0;
      for (let j = i - period + 1; j <= i; j++) {
        const tp = (candles[j].high + candles[j].low + candles[j].close) / 3;
        tpvSum += tp * (candles[j].volume || 1);
        volSum += (candles[j].volume || 1);
      }
      const vwap = volSum > 0 ? tpvSum / volSum : candles[i].close;
      const deviation = (candles[i].close - vwap) / vwap;
      // v3.8: ATR 기반 동적 임계값 (변동성 높으면 임계값 확대)
      const atrVal = atr[i] || 0;
      const dynamicThreshold = Math.max(threshold, atrVal > 0 ? (atrVal / closes[i]) * 1.5 : threshold);
      const prevDeviation = i > period ? (() => {
        let pTpv = 0, pVol = 0;
        for (let j = i - period; j < i; j++) {
          const tp = (candles[j].high + candles[j].low + candles[j].close) / 3;
          pTpv += tp * (candles[j].volume || 1);
          pVol += (candles[j].volume || 1);
        }
        return pVol > 0 ? (candles[i - 1].close - pTpv / pVol) / (pTpv / pVol) : 0;
      })() : 0;
      if (deviation > -dynamicThreshold && prevDeviation <= -dynamicThreshold) {
        // v3.8: RSI 과매도 확인 (RSI < 45이어야 매수)
        const rsiVal = rsi[i] || 50;
        if (rsiVal > 45) continue;
        // v3.8: 추세 필터 — 극단적 하락추세에서는 억제
        const trend = getTrendDirection(closes, i);
        if (trend === "down" && rsiVal > 35) continue; // 하락추세에서는 RSI 35 이하만
        signals.push({ index: i, type: "BUY", price: candles[i].close, reason: `VWAP 복귀 (${(deviation * 100).toFixed(1)}%) · RSI ${rsiVal.toFixed(0)}${trend === "down" ? " · 하락추세" : ""}` });
      }
      else if (deviation > dynamicThreshold && prevDeviation <= dynamicThreshold)
        signals.push({ index: i, type: "SELL", price: candles[i].close, reason: `VWAP 상단 이탈 (${(deviation * 100).toFixed(1)}%)` });
    }
    return signals;
  },
};

// ━━━ 전략 14: 피보나치 되돌림 ━━━
// 38.2% / 61.8% 되돌림 구간에서 반등 매수
export const strategyFibonacci = {
  id: "fibonacci_retracement",
  name: "피보나치 되돌림",
  desc: "52봉 고점-저점 기준 38.2~61.8% 되돌림 구간 진입 시 매수. 고전적 지지/저항 전략. v3.4: 확장된 룩백(100) + 거래량확인 + 추세필터.",
  category: "평균회귀",
  risk: "중",
  icon: "🌀",
  params: { lookback: 52, fib382: 0.382, fib618: 0.618 },
  generate(candles, params = {}) {
    const { lookback = 52, fib382 = 0.382, fib618 = 0.618 } = { ...this.params, ...params };
    const signals = [];
    const closes = candles.map(c => c.close);
    // v3.4: 확장된 룩백 — min(100, candles.length) 사용
    const dynamicLookback = Math.min(100, candles.length);
    for (let i = dynamicLookback; i < candles.length; i++) {
      const slice = candles.slice(i - dynamicLookback, i);
      const high = Math.max(...slice.map(c => c.high));
      const low = Math.min(...slice.map(c => c.low));
      const range = high - low;
      if (range <= 0) continue;
      const fib382Level = high - range * fib382;
      const fib618Level = high - range * fib618;
      const price = candles[i].close;
      const prevPrice = candles[i - 1].close;
      // 가격이 피보나치 구간에 진입하고 반등 시작
      if (price >= fib618Level && price <= fib382Level && prevPrice < fib618Level) {
        // v3.4: 거래량 확인 (평균 이상)
        if (!isVolumeConfirmed(candles, i, 20, 1.2)) continue;
        // v3.4: 추세 필터 — 하강 추세에서는 신호 무시
        const trend = getTrendDirection(closes, i);
        if (trend === "down") continue;
        signals.push({ index: i, type: "BUY", price, reason: `피보나치 61.8% 반등 (${fib618Level.toFixed(2)})${trend === "up" ? " · 상승추세" : ""}` });
      } else if (price > high * 0.98 && prevPrice < high * 0.98)
        signals.push({ index: i, type: "SELL", price, reason: `고점 근접 (${high.toFixed(2)})` });
    }
    return signals;
  },
};

// ━━━ 전략 15: 일목균형표 (Ichimoku Cloud) ━━━
// 전환선/기준선 + 구름대 기반 — 일본 전통 기술적 분석
function calcIchimoku(highs, lows, tenkanP = 9, kijunP = 26, senkouP = 52) {
  const n = highs.length;
  const tenkan = new Array(n).fill(null);
  const kijun = new Array(n).fill(null);
  const senkouA = new Array(n).fill(null);
  const senkouB = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (i >= tenkanP - 1) {
      const hh = Math.max(...highs.slice(i - tenkanP + 1, i + 1));
      const ll = Math.min(...lows.slice(i - tenkanP + 1, i + 1));
      tenkan[i] = (hh + ll) / 2;
    }
    if (i >= kijunP - 1) {
      const hh = Math.max(...highs.slice(i - kijunP + 1, i + 1));
      const ll = Math.min(...lows.slice(i - kijunP + 1, i + 1));
      kijun[i] = (hh + ll) / 2;
    }
    if (tenkan[i] != null && kijun[i] != null) senkouA[i] = (tenkan[i] + kijun[i]) / 2;
    if (i >= senkouP - 1) {
      const hh = Math.max(...highs.slice(i - senkouP + 1, i + 1));
      const ll = Math.min(...lows.slice(i - senkouP + 1, i + 1));
      senkouB[i] = (hh + ll) / 2;
    }
  }
  return { tenkan, kijun, senkouA, senkouB };
}

export const strategyIchimoku = {
  id: "ichimoku_cloud",
  name: "일목균형표",
  desc: "전환선(9) > 기준선(26) + 가격 > 구름대 상단 시 매수. v3.9: ADX≥25 + MA200 방향 필터 + RSI 하한 40.",
  category: "추세추종",
  risk: "중",
  icon: "☁️",
  params: { tenkan: 9, kijun: 26, senkou: 52 },
  generate(candles, params = {}) {
    const { tenkan: tp = 9, kijun: kp = 26, senkou: sp = 52 } = { ...this.params, ...params };
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const closes = candles.map(c => c.close);
    const ich = calcIchimoku(highs, lows, tp, kp, sp);
    const signals = [];
    const rsi = calcRSI(closes, 14);
    const adx = calcADX(highs, lows, closes, 14);
    const ma200 = calcSMA(closes, 200);
    for (let i = sp + 1; i < candles.length; i++) {
      if (ich.tenkan[i] == null || ich.kijun[i] == null || ich.senkouA[i] == null || ich.senkouB[i] == null) continue;
      // v3.9: ADX 최소 25로 상향 — 약한 추세에서 일목 시그널 비활성화
      const adxVal = adx[i] || 0;
      if (adxVal < 25) continue;
      const cloudTop = Math.max(ich.senkouA[i], ich.senkouB[i]);
      const cloudBot = Math.min(ich.senkouA[i], ich.senkouB[i]);
      // v3.8: 구름 두께가 가격 대비 0.5% 미만이면 의미없는 시그널 → 스킵
      const cloudThicknessPct = closes[i] > 0 ? ((cloudTop - cloudBot) / closes[i]) * 100 : 0;
      if (cloudThicknessPct < 0.5) continue;
      const prevTK = ich.tenkan[i - 1] != null && ich.kijun[i - 1] != null;
      if (prevTK) {
        const cloudThickness = cloudThicknessPct.toFixed(1);
        const rsiVal = rsi[i] || 50;
        // 치쿠스팬 (26봉 전 가격과 현재 가격 비교)로 추세 보조 확인
        const chikouBullish = i >= kp && closes[i] > closes[i - kp];
        const chikouBearish = i >= kp && closes[i] < closes[i - kp];
        // v3.7: 구름 근접성 완화 — 구름 내부도 허용 (구름 상단 -1% 이상이면 진입 가능)
        const nearCloud = closes[i] >= cloudTop * 0.99;
        // 전환선 > 기준선 골든크로스 + 가격 구름 근접/위
        // v3.9: RSI 하한 40으로 상향 (약세장 진입 방지) + MA200 방향 필터
        if (ich.tenkan[i] > ich.kijun[i] && ich.tenkan[i - 1] <= ich.kijun[i - 1] && nearCloud && rsiVal > 40) {
          if (!isVolumeConfirmed(candles, i, 20, 0.9)) continue;
          // v3.9: MA200 아래이면 골든크로스 매수 억제 (하락추세 함정)
          const belowMA200 = ma200[i] != null && closes[i] < ma200[i];
          if (belowMA200 && !chikouBullish) continue;
          const grade = closes[i] > cloudTop ? "A" : belowMA200 ? "C" : "B";
          signals.push({ index: i, type: "BUY", price: closes[i], reason: `일목 골든크로스(${grade}) + 구름${closes[i] > cloudTop ? " 위" : " 근접"} (두께 ${cloudThickness}% · ADX ${adxVal.toFixed(0)})${chikouBullish ? " + 치쿠↑" : ""}${belowMA200 ? " · MA200↓" : ""}` });
        }
        // v3.7: 데드크로스도 구름 근접성 완화
        else if (ich.tenkan[i] < ich.kijun[i] && ich.tenkan[i - 1] >= ich.kijun[i - 1] && closes[i] <= cloudBot * 1.01 && rsiVal < 65)
          signals.push({ index: i, type: "SELL", price: closes[i], reason: `일목 데드크로스 + 구름${closes[i] < cloudBot ? " 아래" : " 근접"} (두께 ${cloudThickness}% · ADX ${adxVal.toFixed(0)})${chikouBearish ? " + 치쿠↓" : ""}` });
      }
    }
    return signals;
  },
};

// ━━━ 전략 16: 갭 앤 고 (Gap & Go) ━━━
// 갭 상승 후 첫 되돌림에서 매수
export const strategyGapAndGo = {
  id: "gap_and_go",
  name: "갭 앤 고",
  desc: "전일 대비 갭 상승 후 매수 → 동적 보유 후 매도. v4.2: RSI 과매수 억제 + 전일 캔들 양봉 확인 + ATR 트레일링 스탑 + 연속갭 중복진입 방지.",
  category: "모멘텀",
  risk: "높음",
  icon: "🎯",
  params: { gapPct: 2, holdBars: 5 },
  generate(candles, params = {}) {
    const { gapPct = 2, holdBars = 5 } = { ...this.params, ...params };
    const signals = [];
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const closes = candles.map(c => c.close);
    const atr = calcATR(highs, lows, closes);
    const rsi = calcRSI(closes, 14);
    let lastBuyIdx = -999; // v4.2: 연속갭 중복진입 방지
    for (let i = 1; i < candles.length; i++) {
      const gap = ((candles[i].open - candles[i - 1].close) / candles[i - 1].close) * 100;
      // v3.4: ATR 기반 동적 갭 임계값 (ATR이 클수록 갭 임계값도 높음)
      const atrVal = atr[i - 1] || 0;
      const prevClose = candles[i - 1].close;
      const atrGapPct = atrVal > 0 ? (atrVal / prevClose) * 100 : gapPct;
      const dynamicGapThreshold = Math.max(gapPct, atrGapPct * 0.5);
      if (gap >= dynamicGapThreshold && candles[i].close > candles[i].open) {
        // v3.4: 거래량 2배 이상 확인 (더 엄격)
        const avgVol = candles.slice(Math.max(0, i - 20), i).reduce((a, c) => a + (c.volume || 0), 0) / Math.min(i, 20);
        const vol = candles[i].volume || 0;
        if (vol < avgVol * 2) continue;
        // v4.2: RSI 과매수 억제 — 이미 과매수(>70) 상태에서 갭매수는 고점잡기
        const rsiVal = rsi[i] || 50;
        if (rsiVal > 70) continue;
        // v4.2: 전일 캔들이 음봉(하락)일 때만 갭업이 의미 있음 (반전 갭)
        // 연속 양봉 + 갭은 과열, 전일 음봉/보합 후 갭이 더 신뢰성 높음
        if (i >= 2 && candles[i - 1].close > candles[i - 2].close * 1.02 && candles[i - 2].close > candles[i - 3]?.close * 1.02) continue;
        // v4.2: 연속갭 중복진입 방지 (이전 매수 후 5봉 이내 재진입 금지)
        if (i - lastBuyIdx < holdBars + 2) continue;
        lastBuyIdx = i;
        signals.push({ index: i, type: "BUY", price: candles[i].close, reason: `갭 +${gap.toFixed(1)}% + 거래량 ${(vol/avgVol).toFixed(1)}x (RSI ${rsiVal.toFixed(0)})` });
        // v3.4: 갭 크기에 따른 동적 홀드 기간 (갭이 클수록 길게)
        const gapRatio = gap / dynamicGapThreshold;
        const dynamicHold = Math.ceil(holdBars * Math.min(gapRatio, 2.5));
        // v4.2: ATR 트레일링 스탑 — 보유 중 1.5xATR 이탈 시 조기 매도
        let sellIdx = Math.min(i + dynamicHold, candles.length - 1);
        const entryPrice = candles[i].close;
        for (let j = i + 1; j <= sellIdx; j++) {
          const curAtr = atr[j] || atrVal;
          if (candles[j].close < entryPrice - 1.5 * curAtr) {
            sellIdx = j;
            break;
          }
        }
        signals.push({ index: sellIdx, type: "SELL", price: candles[sellIdx].close, reason: `${sellIdx - i}봉 보유 후 매도 (갭기반 · ATR스탑)` });
      }
    }
    return signals;
  },
};

// ━━━ 전략 17: 스윙 구간 트레이딩 ━━━
// ATR 기반 동적 매수/매도 구간 설정
export const strategySwingATR = {
  id: "swing_atr",
  name: "ATR 스윙",
  desc: "가격이 20EMA - 1.5×ATR 아래에서 반등 시 매수, 20EMA + 1.5×ATR 위에서 매도. 스윙 트레이딩 전략.",
  category: "변동성",
  risk: "중",
  icon: "🎢",
  params: { emaPeriod: 20, atrPeriod: 14, atrMult: 1.5 },
  generate(candles, params = {}) {
    const { emaPeriod = 20, atrPeriod = 14, atrMult = 1.5 } = { ...this.params, ...params };
    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const ema = calcEMA(closes, emaPeriod);
    const atr = calcATR(highs, lows, closes, atrPeriod);
    const signals = [];
    for (let i = Math.max(emaPeriod, atrPeriod) + 1; i < candles.length; i++) {
      if (atr[i] == null) continue;
      const lowerBand = ema[i] - atrMult * atr[i];
      const upperBand = ema[i] + atrMult * atr[i];
      if (closes[i] > lowerBand && closes[i - 1] <= (ema[i - 1] - atrMult * (atr[i - 1] || atr[i])))
        signals.push({ index: i, type: "BUY", price: closes[i], reason: `ATR 하단 반등 (${lowerBand.toFixed(2)})` });
      else if (closes[i] >= upperBand)
        signals.push({ index: i, type: "SELL", price: closes[i], reason: `ATR 상단 도달 (${upperBand.toFixed(2)})` });
    }
    return signals;
  },
};

// ━━━ 전략 18: OBV 트렌드 추종 ━━━
// On-Balance Volume 이동평균 돌파 — 스마트머니 추적
export const strategyOBV = {
  id: "obv_trend",
  name: "OBV 추세 추종",
  desc: "OBV가 20일 이동평균을 상향돌파하면 매수. v4.2: RSI 과매수 억제 + MA200 추세필터 + ADX 최소 15 + OBV 기울기 확인.",
  category: "추세추종",
  risk: "낮음",
  icon: "📈",
  params: { obvMAPeriod: 20 },
  generate(candles, params = {}) {
    const { obvMAPeriod = 20 } = { ...this.params, ...params };
    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const rsi = calcRSI(closes, 14);
    const adx = calcADX(highs, lows, closes, 14);
    const ma200 = calcSMA(closes, Math.min(200, Math.floor(closes.length * 0.8)));
    const obvArr = [0];
    for (let i = 1; i < closes.length; i++) {
      if (closes[i] > closes[i - 1]) obvArr.push(obvArr[i - 1] + (candles[i].volume || 0));
      else if (closes[i] < closes[i - 1]) obvArr.push(obvArr[i - 1] - (candles[i].volume || 0));
      else obvArr.push(obvArr[i - 1]);
    }
    const obvSMA = obvArr.map((_, i) => {
      if (i < obvMAPeriod - 1) return null;
      return obvArr.slice(i - obvMAPeriod + 1, i + 1).reduce((a, b) => a + b, 0) / obvMAPeriod;
    });
    const signals = [];
    for (let i = obvMAPeriod + 1; i < candles.length; i++) {
      if (obvSMA[i] == null || obvSMA[i - 1] == null) continue;
      if (obvArr[i] > obvSMA[i] && obvArr[i - 1] <= obvSMA[i - 1]) {
        // v4.2: RSI 과매수(>72) 상태에서 OBV 돌파는 고점 잡기 위험
        const rsiVal = rsi[i] || 50;
        if (rsiVal > 72) continue;
        // v4.2: ADX 최소 15 — 비추세장에서 OBV 크로스는 노이즈
        const adxVal = adx[i] || 0;
        if (adxVal < 15) continue;
        // v4.2: MA200 하락추세 시 매수 억제 (역추세 진입 방지)
        const ma200Val = ma200[i];
        if (ma200Val != null && closes[i] < ma200Val * 0.97) continue;
        // v4.2: OBV 기울기 확인 — 최근 3봉 OBV 상승 확인
        if (i >= 3 && obvArr[i] <= obvArr[i - 3]) continue;
        signals.push({ index: i, type: "BUY", price: closes[i], reason: `OBV > OBV-MA${obvMAPeriod} 골든크로스 (RSI ${rsiVal.toFixed(0)} · ADX ${adxVal.toFixed(0)})` });
      } else if (obvArr[i] < obvSMA[i] && obvArr[i - 1] >= obvSMA[i - 1])
        signals.push({ index: i, type: "SELL", price: closes[i], reason: `OBV < OBV-MA${obvMAPeriod} 데드크로스` });
    }
    return signals;
  },
};

// ━━━ 전략 19: 슈퍼트렌드 (Supertrend) ━━━
// ATR 기반 동적 추세 지표 — 크립토/인도 시장에서 인기
export const strategySupertrend = {
  id: "supertrend",
  name: "슈퍼트렌드",
  desc: "ATR(10) × 3배 기반 동적 추세선. 가격이 슈퍼트렌드 위로 돌파 매수, 아래로 이탈 매도.",
  category: "추세추종",
  risk: "중",
  icon: "🔺",
  params: { atrPeriod: 10, multiplier: 3 },
  generate(candles, params = {}) {
    const { atrPeriod = 10, multiplier = 3 } = { ...this.params, ...params };
    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const atr = calcATR(highs, lows, closes, atrPeriod);
    const signals = [];
    let supertrend = 0, prevSupertrend = 0, direction = 1; // 1=up, -1=down
    for (let i = atrPeriod; i < candles.length; i++) {
      if (atr[i] == null) continue;
      const hl2 = (highs[i] + lows[i]) / 2;
      const upperBand = hl2 + multiplier * atr[i];
      const lowerBand = hl2 - multiplier * atr[i];
      const prevDirection = direction;
      if (closes[i] > (direction === 1 ? lowerBand : upperBand)) {
        direction = 1;
        supertrend = lowerBand;
      } else {
        direction = -1;
        supertrend = upperBand;
      }
      if (direction === 1 && prevDirection === -1) {
        // v3.1: 슈퍼트렌드 전환 시 거래량 확인
        if (!isVolumeConfirmed(candles, i, 20, 1.1)) continue;
        signals.push({ index: i, type: "BUY", price: closes[i], reason: `슈퍼트렌드 상향전환 (${supertrend.toFixed(2)}) + 거래량` });
      } else if (direction === -1 && prevDirection === 1)
        signals.push({ index: i, type: "SELL", price: closes[i], reason: `슈퍼트렌드 하향전환 (${supertrend.toFixed(2)})` });
      prevSupertrend = supertrend;
    }
    return signals;
  },
};

// ━━━ 전략 20: 통계적 차익거래 (Mean Reversion Z-Score) ━━━
// Z-Score 기반 평균회귀 — 가격이 이평선 대비 표준편차 이상 이탈 시 진입
export const strategyStatArb = {
  id: "stat_arb",
  name: "통계적 차익 (Z-Score)",
  desc: "가격의 Z-Score(이평선 대비 표준편차)가 -2 이하 시 매수, +2 이상 시 매도. 통계적 평균회귀.",
  category: "평균회귀",
  risk: "중",
  icon: "📐",
  params: { period: 20, entryZ: 2.0, exitZ: 0.5 },
  generate(candles, params = {}) {
    const { period = 20, entryZ = 2.0, exitZ = 0.5 } = { ...this.params, ...params };
    const closes = candles.map(c => c.close);
    const signals = [];
    let inPosition = false;

    for (let i = period; i < candles.length; i++) {
      const slice = closes.slice(i - period, i);
      const mean = slice.reduce((a, b) => a + b, 0) / period;
      const std = Math.sqrt(slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period);
      if (std === 0) continue;
      const zScore = (closes[i] - mean) / std;

      if (!inPosition && zScore <= -entryZ) {
        signals.push({ index: i, type: "BUY", price: closes[i], reason: `Z-Score ${zScore.toFixed(2)} ≤ -${entryZ}` });
        inPosition = true;
      } else if (inPosition && (zScore >= exitZ || zScore >= entryZ)) {
        signals.push({ index: i, type: "SELL", price: closes[i], reason: `Z-Score ${zScore.toFixed(2)} 복귀` });
        inPosition = false;
      }
    }
    return signals;
  },
};

// ━━━ 전략 21: 파라볼릭 SAR ━━━
// J. Welles Wilder의 추세추종 + 동적 손절
export const strategyParabolicSAR = {
  id: "parabolic_sar",
  name: "파라볼릭 SAR",
  desc: "파라볼릭 SAR 반전 시그널 — 가격이 SAR 위로 올라가면 매수, 아래로 내려가면 매도.",
  category: "추세추종",
  risk: "중",
  icon: "🔸",
  params: { afStart: 0.02, afStep: 0.02, afMax: 0.2 },
  generate(candles, params = {}) {
    const { afStart = 0.02, afStep = 0.02, afMax = 0.2 } = { ...this.params, ...params };
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const closes = candles.map(c => c.close);
    if (candles.length < 5) return [];
    const signals = [];
    let isUp = closes[1] > closes[0];
    let sar = isUp ? lows[0] : highs[0];
    let ep = isUp ? highs[1] : lows[1];
    let af = afStart;
    for (let i = 2; i < candles.length; i++) {
      const prevSar = sar;
      sar = prevSar + af * (ep - prevSar);
      if (isUp) {
        sar = Math.min(sar, lows[i - 1], lows[i - 2]);
        if (lows[i] < sar) {
          isUp = false; sar = ep; ep = lows[i]; af = afStart;
          signals.push({ index: i, type: "SELL", price: closes[i], reason: `SAR 하향 반전 (${sar.toFixed(2)})` });
          continue;
        }
        if (highs[i] > ep) { ep = highs[i]; af = Math.min(af + afStep, afMax); }
      } else {
        sar = Math.max(sar, highs[i - 1], highs[i - 2]);
        if (highs[i] > sar) {
          isUp = true; sar = ep; ep = highs[i]; af = afStart;
          signals.push({ index: i, type: "BUY", price: closes[i], reason: `SAR 상향 반전 (${sar.toFixed(2)})` });
          continue;
        }
        if (lows[i] < ep) { ep = lows[i]; af = Math.min(af + afStep, afMax); }
      }
    }
    return signals;
  },
};

// ━━━ 전략 22: 래리 코너스 RSI(2) ━━━
// 단기 RSI(2) 극단값에서의 평균회귀 — 고빈도 단기 매매
export const strategyConnorsRSI2 = {
  id: "connors_rsi2",
  name: "래리 코너스 RSI(2)",
  desc: "RSI(2) ≤ 10에서 매수, ≥ 90에서 매도. 초단기 과매수/과매도 평균회귀 전략.",
  category: "평균회귀",
  risk: "높음",
  icon: "⚡",
  params: { rsiPeriod: 2, buyThreshold: 10, sellThreshold: 90, trendFilter: true },
  generate(candles, params = {}) {
    const { rsiPeriod = 2, buyThreshold = 10, sellThreshold = 90, trendFilter = true } = { ...this.params, ...params };
    const closes = candles.map(c => c.close);
    const rsi = calcRSI(closes, rsiPeriod);
    const sma200 = trendFilter ? calcSMA(closes, Math.min(200, Math.floor(closes.length * 0.5))) : null;
    const signals = [];

    for (let i = Math.max(rsiPeriod + 1, trendFilter ? 200 : 0); i < candles.length; i++) {
      if (rsi[i] == null || rsi[i - 1] == null) continue;
      const aboveTrend = !trendFilter || !sma200 || sma200[i] == null || closes[i] > sma200[i];

      if (rsi[i] <= buyThreshold && rsi[i - 1] > buyThreshold && aboveTrend) {
        // v3.1: 극단적 RSI(2) + 연속 하락일수 카운트
        let downDays = 0;
        for (let j = i; j > Math.max(0, i - 5); j--) { if (closes[j] < closes[j - 1]) downDays++; else break; }
        signals.push({ index: i, type: "BUY", price: closes[i],
          reason: `RSI(2) ${rsi[i].toFixed(1)} ≤ ${buyThreshold} (${downDays}일 연속하락)` });
      } else if (rsi[i] >= sellThreshold && rsi[i - 1] < sellThreshold) {
        signals.push({ index: i, type: "SELL", price: closes[i], reason: `RSI(2) ${rsi[i].toFixed(1)} ≥ ${sellThreshold}` });
      }
    }
    return signals;
  },
};

// ━━━ 전략 23: 시장 레짐 전환 (Regime Switch) ━━━
// ADX + ATR 비율로 추세/횡보 레짐 감지 → 적응형 매매
export const strategyRegimeSwitch = {
  id: "regime_switch",
  name: "레짐 전환 적응형",
  desc: "ADX로 추세/횡보 구분 → 추세장: MA 크로스 매매, 횡보장: RSI 평균회귀 매매. v3.9: 횡보 RSI 25 보수적 + 연속 과매도 2봉 확인.",
  category: "추세추종",
  risk: "중",
  icon: "🔄",
  params: { adxThreshold: 25 },
  generate(candles, params = {}) {
    const { adxThreshold = 25 } = { ...this.params, ...params };
    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const adx = calcADX(highs, lows, closes, 14);
    const rsi = calcRSI(closes, 14);
    const ma20 = calcSMA(closes, 20);
    const ma60 = calcSMA(closes, 60);
    const ma200 = calcSMA(closes, 200);
    const atr = calcATR(highs, lows, closes);
    const signals = [];
    // v3.8: 레짐 전환 히스테리시스 — 추세→횡보 전환은 ADX<20에서만 (잦은 전환 방지)
    let currentRegime = "unknown"; // "trending" | "ranging" | "unknown"

    for (let i = 61; i < candles.length; i++) {
      const adxVal = adx[i] || 0;
      // v3.8: 히스테리시스 적용 — 추세 진입은 ADX>=25, 횡보 전환은 ADX<20
      if (adxVal >= adxThreshold) currentRegime = "trending";
      else if (adxVal < 20) currentRegime = "ranging";
      // ADX 20~25 구간은 이전 레짐 유지 (whipsaw 방지)

      if (currentRegime === "trending") {
        // 추세장 → 이평선 크로스 + 거래량 확인 + 추세방향 필터
        if (ma20[i] != null && ma60[i] != null && ma20[i - 1] != null && ma60[i - 1] != null) {
          if (ma20[i - 1] <= ma60[i - 1] && ma20[i] > ma60[i]) {
            if (!isVolumeConfirmed(candles, i, 20, 1.1)) continue;
            // v3.8: MA200 위에서만 골든크로스 매수 (하락추세 함정 방지)
            const aboveMA200 = ma200[i] != null && closes[i] > ma200[i];
            if (!aboveMA200 && ma200[i] != null) continue;
            signals.push({ index: i, type: "BUY", price: closes[i], reason: `추세장 골든크로스 (ADX ${adxVal.toFixed(0)}) + 거래량확인` });
          } else if (ma20[i - 1] >= ma60[i - 1] && ma20[i] < ma60[i])
            signals.push({ index: i, type: "SELL", price: closes[i], reason: `추세장 데드크로스 (ADX ${adxVal.toFixed(0)})` });
        }
      } else if (currentRegime === "ranging") {
        // 횡보장 → RSI 평균회귀 + 다이버전스 체크
        if (rsi[i] != null && rsi[i - 1] != null) {
          // v3.8: ATR 변동성 체크 — 횡보장에서 ATR이 급등하면 돌파 전환 임박이므로 억제
          const atrVal = atr[i] || 0;
          const recentATRs = [];
          for (let j = Math.max(14, i - 20); j < i; j++) if (atr[j]) recentATRs.push(atr[j]);
          const avgATR = recentATRs.length > 0 ? recentATRs.reduce((a, b) => a + b, 0) / recentATRs.length : atrVal;
          if (atrVal > avgATR * 1.5) continue; // ATR 급등 시 평균회귀 부적합
          // v3.9: RSI 25로 보수적 조정 + 연속 2봉 과매도 확인
          if (rsi[i] <= 25 && rsi[i - 1] != null && rsi[i - 1] <= 30) {
            const div = detectBullishDivergence(closes, rsi, i);
            // v3.9: RSI 기울기 반전 필수 (바닥 확인 후 진입)
            if (rsi[i] < rsi[i - 1] && !div) continue;
            signals.push({ index: i, type: "BUY", price: closes[i],
              reason: `횡보장 RSI 과매도 (${rsi[i].toFixed(0)}) · 2봉확인${div ? " + 강세다이버전스" : ""}` });
          } else if (rsi[i] >= 70 && rsi[i - 1] < 70) {
            const div = detectBearishDivergence(closes, rsi, i);
            signals.push({ index: i, type: "SELL", price: closes[i],
              reason: `횡보장 RSI 과매수 (${rsi[i].toFixed(0)})${div ? " + 약세다이버전스" : ""}` });
          }
        }
      }
    }
    return signals;
  },
};

// ━━━ 전략 24: 헤이킨 아시 추세 추종 ━━━
// 헤이킨 아시 캔들 패턴으로 추세 방향 확인 후 진입
export const strategyHeikinAshi = {
  id: "heikin_ashi",
  name: "헤이킨 아시 추세",
  desc: "HA 양봉 3연속 + 하단꼬리 없음 매수, HA 음봉 3연속 + 상단꼬리 없음 매도. 노이즈 제거 추세 추종.",
  category: "추세추종",
  risk: "낮음",
  icon: "🕯️",
  params: { consecutiveBars: 3 },
  generate(candles, params = {}) {
    const { consecutiveBars = 3 } = { ...this.params, ...params };
    // 헤이킨 아시 변환
    const ha = [];
    for (let i = 0; i < candles.length; i++) {
      const c = candles[i];
      const haClose = (c.open + c.high + c.low + c.close) / 4;
      const haOpen = i === 0 ? (c.open + c.close) / 2 : (ha[i - 1].open + ha[i - 1].close) / 2;
      const haHigh = Math.max(c.high, haOpen, haClose);
      const haLow = Math.min(c.low, haOpen, haClose);
      ha.push({ open: haOpen, high: haHigh, low: haLow, close: haClose });
    }

    const signals = [];
    for (let i = consecutiveBars; i < candles.length; i++) {
      // N연속 강한 양봉 (하단꼬리 없음 = 강한 상승)
      let bullCount = 0;
      for (let j = i - consecutiveBars + 1; j <= i; j++) {
        if (ha[j].close > ha[j].open && Math.abs(ha[j].low - Math.min(ha[j].open, ha[j].close)) < (ha[j].high - ha[j].low) * 0.1)
          bullCount++;
      }
      let prevBullCount = 0;
      for (let j = i - consecutiveBars; j < i; j++) {
        if (ha[j].close > ha[j].open && Math.abs(ha[j].low - Math.min(ha[j].open, ha[j].close)) < (ha[j].high - ha[j].low) * 0.1)
          prevBullCount++;
      }

      if (bullCount >= consecutiveBars && prevBullCount < consecutiveBars) {
        // v3.1: HA 강세 전환 시 거래량 확인
        if (!isVolumeConfirmed(candles, i, 20, 1.0)) continue;
        signals.push({ index: i, type: "BUY", price: candles[i].close, reason: `HA ${consecutiveBars}연속 강세봉 + 거래량` });
      }

      // N연속 강한 음봉
      let bearCount = 0;
      for (let j = i - consecutiveBars + 1; j <= i; j++) {
        if (ha[j].close < ha[j].open && Math.abs(ha[j].high - Math.max(ha[j].open, ha[j].close)) < (ha[j].high - ha[j].low) * 0.1)
          bearCount++;
      }
      let prevBearCount = 0;
      for (let j = i - consecutiveBars; j < i; j++) {
        if (ha[j].close < ha[j].open && Math.abs(ha[j].high - Math.max(ha[j].open, ha[j].close)) < (ha[j].high - ha[j].low) * 0.1)
          prevBearCount++;
      }

      if (bearCount >= consecutiveBars && prevBearCount < consecutiveBars)
        signals.push({ index: i, type: "SELL", price: candles[i].close, reason: `HA ${consecutiveBars}연속 약세봉` });
      // (continue to next iteration)
    }
    return signals;
  },
};

// ━━━ 전략 25: 듀얼 타임프레임 모멘텀 ━━━
// 장기(50일) 추세 방향 확인 → 단기(5일) 풀백 진입
export const strategyDualTimeframe = {
  id: "dual_timeframe",
  name: "듀얼 타임프레임 모멘텀",
  desc: "50일선 위에서 5일 RSI 과매도 매수, 50일선 아래서 5일 RSI 과매수 매도. 추세 방향 풀백 진입.",
  category: "추세추종",
  risk: "중",
  icon: "⏱️",
  params: { trendPeriod: 50, rsiPeriod: 5, buyRSI: 30, sellRSI: 70 },
  generate(candles, params = {}) {
    const { trendPeriod = 50, rsiPeriod = 5, buyRSI = 30, sellRSI = 70 } = { ...this.params, ...params };
    const closes = candles.map(c => c.close);
    const sma = calcSMA(closes, trendPeriod);
    const rsi = calcRSI(closes, rsiPeriod);
    const signals = [];
    for (let i = trendPeriod + 1; i < candles.length; i++) {
      if (sma[i] == null || rsi[i] == null || rsi[i - 1] == null) continue;
      // v3.1: 풀백 매수에 거래량 + 다이버전스 교차검증
      // 상승추세 + 단기 과매도 = 풀백 매수
      if (closes[i] > sma[i] && rsi[i] <= buyRSI && rsi[i - 1] > buyRSI) {
        if (!isVolumeConfirmed(candles, i, 20, 0.8)) continue;
        const div = detectBullishDivergence(closes, rsi, i, 8);
        const trendStr = ((closes[i] - sma[i]) / sma[i] * 100).toFixed(1);
        signals.push({ index: i, type: "BUY", price: closes[i],
          reason: `상승추세(+${trendStr}%) 풀백 매수 (RSI5: ${rsi[i].toFixed(0)})${div ? " + 다이버전스" : ""}` });
      }
      // 하락추세 + 단기 과매수 = 반등 매도
      else if (closes[i] < sma[i] && rsi[i] >= sellRSI && rsi[i - 1] < sellRSI)
        signals.push({ index: i, type: "SELL", price: closes[i], reason: `하락추세 반등 매도 (RSI5: ${rsi[i].toFixed(0)})` });
    }
    return signals;
  },
};

// ━━━ 전략 26: MFI (Money Flow Index) v3.7 ━━━
// 거래량 가중 RSI — v3.7: 추세 적응형 임계값 + RSI 교차검증 + 다이버전스 확인
export const strategyMFI = {
  id: "mfi_flow",
  name: "MFI 자금유입",
  desc: "MFI(14) 추세적응형 과매도 매수, 과매수 매도. v3.7: 상승추세 25/75, 하락추세 15/85 적응형 + RSI 교차검증.",
  category: "평균회귀",
  risk: "중",
  icon: "💰",
  params: { period: 14, buyThreshold: 20, sellThreshold: 80 },
  generate(candles, params = {}) {
    const { period = 14, buyThreshold = 20, sellThreshold = 80 } = { ...this.params, ...params };
    const signals = [];
    if (candles.length < period + 2) return signals;
    const closes = candles.map(c => c.close);
    const rsi = calcRSI(closes, 14);
    // v3.7: SMA50 기반 추세 판단
    const sma50 = calcSMA(closes, Math.min(50, Math.floor(closes.length * 0.4)));
    const mfi = new Array(candles.length).fill(null);
    for (let i = period; i < candles.length; i++) {
      let posFlow = 0, negFlow = 0;
      for (let j = i - period + 1; j <= i; j++) {
        const tp = (candles[j].high + candles[j].low + candles[j].close) / 3;
        const prevTp = (candles[j - 1].high + candles[j - 1].low + candles[j - 1].close) / 3;
        const rawFlow = tp * (candles[j].volume || 1);
        if (tp > prevTp) posFlow += rawFlow;
        else if (tp < prevTp) negFlow += rawFlow;
      }
      mfi[i] = negFlow === 0 ? 100 : 100 - 100 / (1 + posFlow / negFlow);
    }
    for (let i = period + 1; i < candles.length; i++) {
      if (mfi[i] == null || mfi[i - 1] == null) continue;
      const rsiVal = rsi[i] || 50;
      // v3.7: 추세 적응형 임계값 — 상승추세에서 더 관대한 과매도, 하락추세에서 더 깊은 과매도
      const inUptrend = sma50[i] != null && closes[i] > sma50[i];
      const adaptBuy = inUptrend ? Math.min(buyThreshold + 5, 30) : Math.max(buyThreshold - 5, 10);
      const adaptSell = inUptrend ? Math.max(sellThreshold + 5, 85) : Math.min(sellThreshold - 5, 70);
      // v3.7: MFI + RSI 교차검증 (두 지표 동시 과매도/과매수 시 더 신뢰)
      if (mfi[i] <= adaptBuy && mfi[i - 1] > adaptBuy && rsiVal < 45) {
        if (!isVolumeConfirmed(candles, i, 20, 0.8)) continue;
        const confidence = rsiVal < 30 ? "높음" : "보통";
        signals.push({ index: i, type: "BUY", price: candles[i].close, reason: `MFI ${mfi[i].toFixed(1)} 과매도 · RSI ${rsiVal.toFixed(0)} (신뢰: ${confidence})` });
      }
      else if (mfi[i] >= adaptSell && mfi[i - 1] < adaptSell && rsiVal > 55)
        signals.push({ index: i, type: "SELL", price: candles[i].close, reason: `MFI ${mfi[i].toFixed(1)} 과매수 · RSI ${rsiVal.toFixed(0)} (자금유출)` });
    }
    return signals;
  },
};

// ━━━ 전략 27: 모멘텀 + 거래량 가중 ━━━
// 가격 모멘텀과 거래량 가중치를 결합한 복합 시그널
export const strategyMomVolWeight = {
  id: "momentum_vol_weight",
  name: "모멘텀·거래량 가중",
  desc: "10일 수익률 상위 + 거래량 급증 매수, 하위 + 거래량 급증 매도. 강한 수급 동반 모멘텀 포착.",
  category: "모멘텀",
  risk: "높음",
  icon: "⚡",
  params: { momPeriod: 10, volPeriod: 20, volThresh: 1.5 },
  generate(candles, params = {}) {
    const { momPeriod = 10, volPeriod = 20, volThresh = 1.5 } = { ...this.params, ...params };
    const closes = candles.map(c => c.close);
    const volumes = candles.map(c => c.volume || 0);
    const signals = [];
    for (let i = Math.max(momPeriod, volPeriod); i < candles.length; i++) {
      const mom = (closes[i] - closes[i - momPeriod]) / closes[i - momPeriod];
      const avgVol = volumes.slice(i - volPeriod, i).reduce((a, b) => a + b, 0) / volPeriod;
      const volRatio = avgVol > 0 ? volumes[i] / avgVol : 0;
      const prevMom = (closes[i - 1] - closes[i - 1 - momPeriod]) / closes[i - 1 - momPeriod];
      if (mom > 0.03 && volRatio >= volThresh && prevMom <= 0.03)
        signals.push({ index: i, type: "BUY", price: closes[i], reason: `모멘텀 ${(mom * 100).toFixed(1)}% + 거래량 ${volRatio.toFixed(1)}x` });
      else if (mom < -0.03 && volRatio >= volThresh && prevMom >= -0.03)
        signals.push({ index: i, type: "SELL", price: closes[i], reason: `모멘텀 ${(mom * 100).toFixed(1)}% + 거래량 ${volRatio.toFixed(1)}x` });
    }
    return signals;
  },
};

// ━━━ 전략 28: 삼중 필터 시스템 (Elder) ━━━
// 장기 추세 + 중기 모멘텀 + 단기 진입 삼중 확인
export const strategyElderTriple = {
  id: "elder_triple_screen",
  name: "엘더 삼중 필터",
  desc: "1차(50EMA 추세) → 2차(MACD 히스토그램 반전) → 3차(2일 저점 돌파) 삼중 확인 진입.",
  category: "추세추종",
  risk: "낮음",
  icon: "🛡️",
  params: { trendPeriod: 50 },
  generate(candles, params = {}) {
    const { trendPeriod = 50 } = { ...this.params, ...params };
    const closes = candles.map(c => c.close);
    const lows = candles.map(c => c.low);
    const highs = candles.map(c => c.high);
    const ema50 = calcEMA(closes, trendPeriod);
    const { histogram } = calcMACD(closes);
    const signals = [];
    for (let i = trendPeriod + 2; i < candles.length; i++) {
      if (histogram[i] == null || histogram[i - 1] == null) continue;
      // 매수: EMA50 상승추세 + MACD 히스토그램 반전 상승 + 전일 저점 돌파
      const trendUp = ema50[i] > ema50[i - 1] && closes[i] > ema50[i];
      const trendDown = ema50[i] < ema50[i - 1] && closes[i] < ema50[i];
      const histReverseUp = histogram[i] > histogram[i - 1] && histogram[i - 1] < histogram[i - 2];
      const histReverseDown = histogram[i] < histogram[i - 1] && histogram[i - 1] > histogram[i - 2];
      if (trendUp && histReverseUp && closes[i] > highs[i - 1]) {
        // v3.1: 엘더 삼중 매수 시 거래량 필수
        if (!isVolumeConfirmed(candles, i, 20, 1.2)) continue;
        signals.push({ index: i, type: "BUY", price: closes[i], reason: `삼중 확인: 추세↑ + MACD반전↑ + 고점돌파 + 거래량` });
      } else if (trendDown && histReverseDown && closes[i] < lows[i - 1])
        signals.push({ index: i, type: "SELL", price: closes[i], reason: `삼중 확인: 추세↓ + MACD반전↓ + 저점이탈` });
    }
    return signals;
  },
};

// ━━━ 전략 29: CCI (Commodity Channel Index) ━━━
// 가격의 통계적 이탈도 — Lambert의 변동성 오실레이터
export const strategyCCI = {
  id: "cci_oscillator",
  name: "CCI 오실레이터",
  desc: "CCI(20)가 -100 이하에서 상향돌파 매수, +100 이상에서 하향돌파 매도. 추세 강도 + 전환 포착.",
  category: "모멘텀",
  risk: "중",
  icon: "📡",
  params: { period: 20, buyLevel: -100, sellLevel: 100 },
  generate(candles, params = {}) {
    const { period = 20, buyLevel = -100, sellLevel = 100 } = { ...this.params, ...params };
    const signals = [];
    const cci = new Array(candles.length).fill(null);
    for (let i = period - 1; i < candles.length; i++) {
      let tpArr = [];
      for (let j = i - period + 1; j <= i; j++) {
        tpArr.push((candles[j].high + candles[j].low + candles[j].close) / 3);
      }
      const mean = tpArr.reduce((a, b) => a + b, 0) / period;
      const meanDev = tpArr.reduce((a, b) => a + Math.abs(b - mean), 0) / period;
      cci[i] = meanDev === 0 ? 0 : (tpArr[tpArr.length - 1] - mean) / (0.015 * meanDev);
    }
    for (let i = period; i < candles.length; i++) {
      if (cci[i] == null || cci[i - 1] == null) continue;
      if (cci[i] > buyLevel && cci[i - 1] <= buyLevel) {
        // v3.1: CCI 상향돌파 + 거래량 + 추세 방향
        if (!isVolumeConfirmed(candles, i, 20, 1.0)) continue;
        const trend = getTrendDirection(candles.map(c => c.close), i);
        signals.push({ index: i, type: "BUY", price: candles[i].close,
          reason: `CCI ${cci[i].toFixed(0)} > ${buyLevel} 상향돌파${trend === "up" ? " · 상승추세" : ""}` });
      } else if (cci[i] < sellLevel && cci[i - 1] >= sellLevel)
        signals.push({ index: i, type: "SELL", price: candles[i].close, reason: `CCI ${cci[i].toFixed(0)} < ${sellLevel} 하향돌파` });
    }
    return signals;
  },
};

// ━━━ 전략 30: MACD 히스토그램 다이버전스 ━━━
// 가격 신고가 but MACD 히스토그램 하락 = 약세 다이버전스 (매도), 반대 = 강세 다이버전스 (매수)
export const strategyMACDDivergence = {
  id: "macd_divergence",
  name: "MACD 다이버전스",
  desc: "가격 신저가 + MACD 히스토그램 상승 = 강세 다이버전스 매수. 숨겨진 추세 전환 포착.",
  category: "추세추종",
  risk: "중",
  icon: "🔀",
  params: { lookback: 20 },
  generate(candles, params = {}) {
    const { lookback = 20 } = { ...this.params, ...params };
    const closes = candles.map(c => c.close);
    const { histogram } = calcMACD(closes);
    const signals = [];
    for (let i = lookback + 30; i < candles.length; i++) {
      if (histogram[i] == null) continue;
      const priceMin = Math.min(...closes.slice(i - lookback, i));
      const priceMax = Math.max(...closes.slice(i - lookback, i));
      const histSlice = histogram.slice(i - lookback, i).filter(v => v != null);
      if (histSlice.length < 5) continue;
      const histMin = Math.min(...histSlice);
      const histMax = Math.max(...histSlice);
      // v3.1: 다이버전스 + 거래량 확인
      // 강세 다이버전스: 가격 새 저점 근접 + 히스토그램 상승중
      if (closes[i] <= priceMin * 1.01 && histogram[i] > histMin * 0.5 && histogram[i] > histogram[i - 1] && closes[i - 1] > priceMin * 1.01) {
        if (!isVolumeConfirmed(candles, i, 20, 0.9)) continue;
        signals.push({ index: i, type: "BUY", price: closes[i], reason: `강세 다이버전스 (가격↓ MACD↑) + 거래량` });
      }
      // 약세 다이버전스: 가격 새 고점 근접 + 히스토그램 하락중
      else if (closes[i] >= priceMax * 0.99 && histogram[i] < histMax * 0.5 && histogram[i] < histogram[i - 1] && closes[i - 1] < priceMax * 0.99)
        signals.push({ index: i, type: "SELL", price: closes[i], reason: `약세 다이버전스 (가격↑ MACD↓)` });
    }
    return signals;
  },
};

// ━━━ 전략 31: 캔들스틱 패턴 (엔궐핑 + 해머) ━━━
// 클래식 가격 액션 패턴
export const strategyCandlePattern = {
  id: "candle_pattern",
  name: "캔들 패턴 (엔궐핑)",
  desc: "상승 엔궐핑 + 20MA 지지 매수, 하락 엔궐핑 + 20MA 저항 매도. 가격 액션 기반 전략.",
  category: "평균회귀",
  risk: "중",
  icon: "🕯️",
  params: { maPeriod: 20 },
  generate(candles, params = {}) {
    const { maPeriod = 20 } = { ...this.params, ...params };
    const closes = candles.map(c => c.close);
    const ma = calcSMA(closes, maPeriod);
    const signals = [];
    for (let i = maPeriod + 1; i < candles.length; i++) {
      if (ma[i] == null) continue;
      const prev = candles[i - 1], cur = candles[i];
      const prevBody = Math.abs(prev.close - prev.open);
      const curBody = Math.abs(cur.close - cur.open);
      const prevBear = prev.close < prev.open;
      const curBull = cur.close > cur.open;
      const prevBull = prev.close > prev.open;
      const curBear = cur.close < cur.open;
      // v3.1: 캔들 패턴 + 거래량 교차검증
      // 상승 엔궐핑: 전봉 음봉 + 현봉 양봉이 전봉을 감싸 + 가격 MA 근처
      if (prevBear && curBull && cur.open <= prev.close && cur.close >= prev.open && curBody > prevBody * 1.2 && closes[i] <= ma[i] * 1.02) {
        if (!isVolumeConfirmed(candles, i, 20, 1.2)) continue;
        const engulfRatio = (curBody / prevBody).toFixed(1);
        signals.push({ index: i, type: "BUY", price: closes[i], reason: `상승 엔궐핑(${engulfRatio}x) + MA${maPeriod} 지지 + 거래량` });
      }
      // 하락 엔궐핑
      else if (prevBull && curBear && cur.open >= prev.close && cur.close <= prev.open && curBody > prevBody * 1.2 && closes[i] >= ma[i] * 0.98)
        signals.push({ index: i, type: "SELL", price: closes[i], reason: `하락 엔궐핑 + MA${maPeriod} 저항` });
      // 해머 패턴 (하단 꼬리가 몸통의 2배 이상 + 상단 꼬리 거의 없음)
      const upperWick = cur.high - Math.max(cur.open, cur.close);
      const lowerWick = Math.min(cur.open, cur.close) - cur.low;
      if (curBody > 0 && lowerWick >= curBody * 2 && upperWick < curBody * 0.3 && closes[i] < ma[i]) {
        if (!isVolumeConfirmed(candles, i, 20, 1.0)) continue;
        signals.push({ index: i, type: "BUY", price: closes[i], reason: `해머 패턴 + MA${maPeriod} 하방 + 거래량` });
      }
    }
    return signals;
  },
};

// ━━━ 전략 32: 채널 돌파 모멘텀 (Donchian + ADX + Volume) ━━━
// 개선된 터틀 — v3.7: ADX 완화 + RSI 필터 + ATR 트레일링 + 돌파 강도
export const strategyChannelMomentum = {
  id: "channel_momentum",
  name: "채널 돌파 모멘텀",
  desc: "20일 채널 돌파 + ADX>20 + 거래량 1.3배 + RSI 모멘텀 필터. v3.7: ADX 완화, ATR 트레일링 스탑, 돌파 강도 등급.",
  category: "모멘텀",
  risk: "중",
  icon: "🚀",
  params: { channelPeriod: 20, adxThreshold: 20, volMult: 1.3 },
  generate(candles, params = {}) {
    const { channelPeriod = 20, adxThreshold = 20, volMult = 1.3 } = { ...this.params, ...params };
    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const adx = calcADX(highs, lows, closes, 14);
    const rsi = calcRSI(closes, 14);
    const atr = calcATR(highs, lows, closes, 14);
    const dc = calcDonchian(highs, lows, channelPeriod);
    const signals = [];
    for (let i = channelPeriod + 30; i < candles.length; i++) {
      if (!dc[i - 1]) continue;
      const adxVal = adx[i] || 0;
      const rsiVal = rsi[i] || 50;
      const atrVal = atr[i] || 0;
      const avgVol = candles.slice(i - 20, i).reduce((a, c) => a + (c.volume || 0), 0) / 20;
      const curVol = candles[i].volume || 0;
      const volOk = avgVol > 0 && curVol >= avgVol * volMult;
      // v3.7: 돌파 강도 = 채널 상단 대비 초과 비율
      const breakoutPct = dc[i - 1].upper > 0 ? ((closes[i] - dc[i - 1].upper) / dc[i - 1].upper * 100) : 0;
      const breakGrade = breakoutPct > 3 ? "A" : breakoutPct > 1 ? "B" : "C";
      // v3.7: RSI 40~70 구간 진입 (과열/과냉 제외)
      if (closes[i] > dc[i - 1].upper && adxVal >= adxThreshold && volOk && rsiVal > 40 && rsiVal < 75)
        signals.push({ index: i, type: "BUY", price: closes[i], reason: `채널돌파(${breakGrade}) + ADX ${adxVal.toFixed(0)} + Vol ${(curVol / avgVol).toFixed(1)}x` });
      // v3.7: 이탈 조건 완화 — ADX 불필요, ATR 트레일링 스탑 활용
      else if (closes[i] < dc[i - 1].lower || (atrVal > 0 && closes[i] < closes[i - 1] - 2 * atrVal))
        signals.push({ index: i, type: "SELL", price: closes[i], reason: `채널이탈${adxVal >= adxThreshold ? " (추세)" : " (ATR 스탑)"} ADX ${adxVal.toFixed(0)}` });
    }
    return signals;
  },
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 전략 33: BTC 알파 v2 — 비트코인 전용 월가급 멀티팩터 자동매매
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// v2 고도화 내역:
//   1. 다중 타임프레임 확인 (일봉 시그널 + 주봉 추세 필터)
//   2. 변동성 적응형 임계값 (ATR 기반 동적 RSI/BB 조정)
//   3. 모멘텀 연속성 필터 (3봉 연속 방향 확인)
//   4. 스마트 거래량 분석 (OBV 추세 + VWAP 이격도)
//   5. 연속 시그널 방지 (최소 쿨다운 봉 수)
//   6. 신뢰도 등급 (A/B/C) — 팩터 수·강도 기반
//   7. ATR 기반 동적 포지션 사이징 권고
//   8. 장기 추세 컨텍스트 (EMA 200 필터)
//   9. 캔들 패턴 인식 (해머/샛별/장악형)
//  10. 리스크/리워드 비율 계산
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// BTC 전용 헬퍼: 주봉 리샘플링
function resampleWeekly(candles) {
  const weeks = [];
  let week = null;
  for (const c of candles) {
    const d = new Date((c.time || 0) * 1000);
    // proper ISO week: use Monday as week start
    const day = d.getDay() || 7; // convert Sunday(0) to 7
    const thursday = new Date(d);
    thursday.setDate(d.getDate() + 4 - day);
    const yearStart = new Date(thursday.getFullYear(), 0, 1);
    const weekNo = Math.ceil(((thursday - yearStart) / 86400000 + 1) / 7);
    const wk = `${thursday.getFullYear()}-W${String(weekNo).padStart(2, "0")}`;
    if (!week || week.wk !== wk) {
      if (week) weeks.push(week);
      week = { wk, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume || 0, time: c.time };
    } else {
      week.high = Math.max(week.high, c.high);
      week.low = Math.min(week.low, c.low);
      week.close = c.close;
      week.volume += c.volume || 0;
    }
  }
  if (week) weeks.push(week);
  return weeks;
}

// BTC 전용 헬퍼: OBV (On-Balance Volume)
function calcOBV(closes, volumes) {
  const obv = [0];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i] > closes[i - 1]) obv.push(obv[i - 1] + (volumes[i] || 0));
    else if (closes[i] < closes[i - 1]) obv.push(obv[i - 1] - (volumes[i] || 0));
    else obv.push(obv[i - 1]);
  }
  return obv;
}

// BTC 전용 헬퍼: 캔들 패턴 감지
function detectCandlePattern(candles, i) {
  if (i < 2) return null;
  const c = candles[i], p = candles[i - 1], pp = candles[i - 2];
  const bodyC = Math.abs(c.close - c.open);
  const rangeC = c.high - c.low;
  const bodyP = Math.abs(p.close - p.open);

  // 해머 (하락 추세 후 긴 아래꼬리 + 짧은 몸통)
  const lowerWick = Math.min(c.open, c.close) - c.low;
  const upperWick = c.high - Math.max(c.open, c.close);
  if (lowerWick > bodyC * 2 && upperWick < bodyC * 0.5 && rangeC > 0) {
    if (p.close < p.open && pp.close < pp.open) return "hammer";
  }

  // 강세 장악형 (Bullish Engulfing)
  if (p.close < p.open && c.close > c.open && c.close > p.open && c.open < p.close && bodyC > bodyP * 1.2)
    return "bullish_engulfing";

  // 약세 장악형 (Bearish Engulfing)
  if (p.close > p.open && c.close < c.open && c.close < p.open && c.open > p.close && bodyC > bodyP * 1.2)
    return "bearish_engulfing";

  // 도지 (Doji) — 전환 가능성
  if (rangeC > 0 && bodyC / rangeC < 0.1) return "doji";

  return null;
}

export const strategyBTCAlpha = {
  id: "btc_alpha",
  name: "₿ BTC 알파 전략",
  desc: "비트코인 전용 월가급 멀티팩터 v2. 다중 타임프레임 + 변동성 적응형 RSI/BB + OBV 스마트 거래량 + 캔들 패턴 + EMA200 장기필터 + ATR 동적 사이징 + 신뢰도 등급. 10개 팩터 합산 스코어링으로 고변동성 크립토 시장 최적화.",
  category: "크립토",
  risk: "고",
  icon: "₿",
  params: {
    rsiPeriod: 14,
    bbPeriod: 20,
    bbMult: 2.5,
    emaFast: 21,
    emaSlow: 55,
    emaLong: 200,
    volSurge: 1.6,  // v4.0: 1.8→1.6 BTC 거래량 정규화 반영
    adxThreshold: 20,
    squeezeLen: 6,
    cooldown: 2,        // 연속 시그널 방지: 최소 2봉
    momentumBars: 3,    // 모멘텀 연속성 확인 봉 수
  },
  generate(candles, params = {}) {
    const {
      rsiPeriod = 14, bbPeriod = 20, bbMult = 2.5,
      emaFast = 21, emaSlow = 55, emaLong = 200,
      volSurge = 1.8, adxThreshold = 20, squeezeLen = 6,
      cooldown = 3, momentumBars = 3,
    } = { ...this.params, ...params };

    if (candles.length < Math.max(emaLong, 60) + 10) return [];

    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const volumes = candles.map(c => c.volume || 0);

    // ── 일봉 지표 ──
    const rsi = calcRSI(closes, rsiPeriod);
    const bb = calcBB(closes, bbPeriod, bbMult);
    const ema21 = calcEMA(closes, emaFast);
    const ema55 = calcEMA(closes, emaSlow);
    const ema200 = calcEMA(closes, emaLong);
    const { macdLine, signal: macdSig, histogram } = calcMACD(closes);
    const adx = calcADX(highs, lows, closes, 14);
    const atr = calcATR(highs, lows, closes, 14);
    const stoch = calcStochastic(highs, lows, closes, 14, 3);
    const obv = calcOBV(closes, volumes);
    const obvEma = calcEMA(obv, 20);

    // ── 거래량 SMA ──
    const volSMA = calcSMA(volumes, 20);

    // ── 주봉 추세 필터 ──
    const weeklyCandles = resampleWeekly(candles);
    const wCloses = weeklyCandles.map(c => c.close);
    const wEma10 = wCloses.length > 10 ? calcEMA(wCloses, 10) : [];
    const wEma30 = wCloses.length > 30 ? calcEMA(wCloses, 30) : [];
    const weeklyTrendUp = wEma10.length > 0 && wEma30.length > 0
      ? wEma10[wEma10.length - 1] > wEma30[wEma30.length - 1] : null;

    // ── 변동성 적응형 임계값 (패닉 레짐 추가) ──
    // ATR%가 높으면 RSI 임계값을 더 넓게 (20/80), 낮으면 좁게 (30/70)
    // 패닉 레짐(ATR% > 6): RSI < 15 = 극단적 매수신호
    function getAdaptiveRSI(i) {
      const atrPct = atr[i] && closes[i] > 0 ? (atr[i] / closes[i]) * 100 : 2;
      if (atrPct > 6) return { buy: 20, sell: 82, isPanic: true };  // v4.1: 패닉 18→20 (F&G 8 극공포 — 조기 진입 완화)
      if (atrPct > 5) return { buy: 22, sell: 80 };                  // v4.1: 초고변동 20→22 (극단 방지)
      if (atrPct > 3) return { buy: 25, sell: 75 };                  // 고변동
      if (atrPct > 1.5) return { buy: 28, sell: 72 };                // 보통
      return { buy: 30, sell: 70 };                                  // v4.1: 저변동 32/68→30/70 (레인지 확대)
    }

    // ── 변동성 레짐별 동적 거래량 임계값 ──
    function getVolumeSurgeThreshold(i) {
      const atrPct = atr[i] && closes[i] > 0 ? (atr[i] / closes[i]) * 100 : 2;
      if (atrPct > 5) return 1.5;   // 고변동 시장: 1.5배로 완화 (spikes 쉽게 포착)
      if (atrPct > 2) return 1.8;   // 보통: 기본값
      return 2.0;                   // 저변동: 2.0배 (높은 기준)
    }

    const signals = [];
    const minIdx = Math.max(emaLong, bbPeriod, 55, 30);
    let lastSignalIdx = -999; // 연속 시그널 방지

    for (let i = minIdx; i < candles.length; i++) {
      if (rsi[i] == null || !bb[i] || histogram[i] == null) continue;

      const price = closes[i];
      const prevPrice = closes[i - 1];

      // ── 쿨다운 체크 ──
      if (i - lastSignalIdx < cooldown) continue;

      // ══════════════════════════════════════════════════
      // 팩터 계산 (10개 팩터)
      // ══════════════════════════════════════════════════

      // 1) EMA 추세 구조 (단기/중기/장기 삼중)
      const trendUp = ema21[i] > ema55[i];
      const trendDown = ema21[i] < ema55[i];
      const longTrendUp = price > ema200[i];
      const longTrendDown = price < ema200[i];
      const emaCrossUp = ema21[i] > ema55[i] && ema21[i - 1] <= ema55[i - 1];
      const emaCrossDown = ema21[i] < ema55[i] && ema21[i - 1] >= ema55[i - 1];

      // 2) RSI (적응형 임계값 + 패닉 레짐 체크)
      const rsiThresholds = getAdaptiveRSI(i);
      const rsiBuyTh = rsiThresholds.buy;
      const rsiSellTh = rsiThresholds.sell;
      const isPanic = rsiThresholds.isPanic || false;
      const rsiExtremeOversold = isPanic && rsi[i] < 15;  // 패닉 레짐 극단 매수
      const rsiBounce = rsi[i] > rsiBuyTh && rsi[i - 1] <= rsiBuyTh;
      const rsiDrop = rsi[i] < rsiSellTh && rsi[i - 1] >= rsiSellTh;

      // 3) BB 위치
      const bbBounce = prevPrice <= (bb[i - 1]?.lower || 0) && price > bb[i].lower;
      const bbReject = prevPrice >= (bb[i - 1]?.upper || Infinity) && price < bb[i].upper;

      // 4) 거래량 분석 (동적 임계값 + OBV 추세)
      const volAvg = volSMA[i] || 0;
      const curVol = volumes[i];
      const dynamicVolSurge = getVolumeSurgeThreshold(i);
      const volExplosion = volAvg > 0 && curVol >= volAvg * dynamicVolSurge;
      const obvRising = obv[i] > obvEma[i] && obv[i - 1] <= obvEma[i - 1]; // OBV가 EMA 상향돌파
      const obvFalling = obv[i] < obvEma[i] && obv[i - 1] >= obvEma[i - 1];

      // 5) MACD
      const macdCrossUp = macdLine[i] > macdSig[i] && macdLine[i - 1] <= macdSig[i - 1];
      const macdCrossDown = macdLine[i] < macdSig[i] && macdLine[i - 1] >= macdSig[i - 1];
      const macdAccelUp = histogram[i] > histogram[i - 1] && histogram[i - 1] <= (histogram[i - 2] || 0);
      const macdAccelDown = histogram[i] < histogram[i - 1] && histogram[i - 1] >= (histogram[i - 2] || 0);

      // 6) ADX 추세 강도
      const adxStrong = adx[i] != null && adx[i] >= adxThreshold;
      const adxVal = adx[i] || 0;

      // 7) BB 스퀴즈
      let isSqueeze = false;
      if (i >= squeezeLen && bb[i] && bb[i - squeezeLen]) {
        isSqueeze = bb[i - squeezeLen].bw > 0 && bb[i].bw < bb[i - squeezeLen].bw * 0.6;
      }

      // 8) 다이버전스
      const bullDiv = detectBullishDivergence(closes, rsi, i, 15);
      const bearDiv = detectBearishDivergence(closes, rsi, i, 15);

      // 9) 모멘텀 연속성 (최근 N봉 방향 확인)
      let bullMomentum = true, bearMomentum = true;
      for (let j = 1; j <= momentumBars && i - j >= 0; j++) {
        if (closes[i - j + 1] <= closes[i - j]) bullMomentum = false;
        if (closes[i - j + 1] >= closes[i - j]) bearMomentum = false;
      }

      // 9b) 모멘텀 데케이 팩터 (최근 5봉 이내 같은 방향 시그널 = 추세 연속)
      let hasRecentMomentum = false;
      if (i >= 5) {
        const recentBullish = signals.slice(-1).some(s =>
          s.type === "BUY" && i - s.index <= 5 && s.index < i
        );
        const recentBearish = signals.slice(-1).some(s =>
          s.type === "SELL" && i - s.index <= 5 && s.index < i
        );
        hasRecentMomentum = recentBullish || recentBearish;
      }

      // 10) 캔들 패턴
      const pattern = detectCandlePattern(candles, i);

      // 11) 스토캐스틱 크로스
      const stochBullCross = stoch.k[i] != null && stoch.d[i] != null
        && stoch.k[i] > stoch.d[i] && (stoch.k[i - 1] || 50) <= (stoch.d[i - 1] || 50)
        && stoch.k[i] < 30;
      const stochBearCross = stoch.k[i] != null && stoch.d[i] != null
        && stoch.k[i] < stoch.d[i] && (stoch.k[i - 1] || 50) >= (stoch.d[i - 1] || 50)
        && stoch.k[i] > 70;

      // 12) ATR 기반 변동성 비율 + 동적 포지션 사이징 권고
      const atrPct = atr[i] && price > 0 ? (atr[i] / price) * 100 : 0;
      const posSize = atrPct > 5 ? 0.3 : atrPct > 3 ? 0.5 : atrPct > 1.5 ? 0.7 : 0.9;

      // ════════════════════════════════════════════════════════════
      // 매수 시그널 (멀티팩터 스코어링)
      // ════════════════════════════════════════════════════════════
      let buyScore = 0;
      const buyReasons = [];
      let buyFactors = 0; // 총 발동 팩터 수

      // A) RSI 과매도 탈출 (적응형) + 패닉 레짐 극단 매수
      if (rsiExtremeOversold) {
        buyScore += 5; buyFactors++;
        buyReasons.push(`RSI ${rsi[i].toFixed(1)} 극단과매도 (패닉)`);
      } else if (rsiBounce) {
        buyScore += 3; buyFactors++;
        buyReasons.push(`RSI ${rsi[i].toFixed(1)} < ${rsiBuyTh} 탈출`);
      } else if (rsi[i] <= rsiBuyTh + 5 && rsi[i] > rsi[i - 1]) {
        buyScore += 2; buyFactors++;
        buyReasons.push(`RSI ${rsi[i].toFixed(1)} 과매도근접 반등`);
      }

      // B) BB 하단 바운스 또는 하단 근접
      if (bbBounce) {
        buyScore += 2; buyFactors++;
        buyReasons.push("BB(2.5σ) 하단 반등");
      } else if (bb[i] && price <= bb[i].lower * 1.01) {
        buyScore += 1; buyFactors++;
        buyReasons.push("BB 하단 근접");
      }

      // C) 거래량 서지 + 양봉
      if (volExplosion && price > prevPrice) {
        buyScore += 2; buyFactors++;
        buyReasons.push(`Vol ${(curVol / volAvg).toFixed(1)}x 폭증`);
      }

      // D) OBV 상향돌파 또는 지속 상승 (스마트머니 유입)
      if (obvRising) {
        buyScore += 2; buyFactors++;
        buyReasons.push("OBV 스마트머니 유입");
      } else if (obv[i] > obvEma[i] && obv[i] > obv[i - 1]) {
        buyScore += 1; buyFactors++;
        buyReasons.push("OBV 상승 지속");
      }

      // E) MACD 골든크로스 또는 가속 또는 양전환
      if (macdCrossUp) {
        buyScore += 2; buyFactors++;
        buyReasons.push("MACD 골든크로스");
      } else if (macdAccelUp && histogram[i] > 0) {
        buyScore += 1; buyFactors++;
        buyReasons.push("MACD 가속↑");
      } else if (histogram[i] > 0 && histogram[i] > histogram[i - 1]) {
        buyScore += 1; buyFactors++;
        buyReasons.push("MACD 히스토그램 확대↑");
      }

      // F) EMA 정배열 크로스 또는 정배열 유지
      if (emaCrossUp) {
        buyScore += 3; buyFactors++;
        buyReasons.push("EMA21/55 골든크로스");
      } else if (trendUp) {
        buyScore += 1; buyFactors++;
        buyReasons.push("EMA 정배열");
      }

      // G) EMA200 장기 추세 보너스
      if (longTrendUp) {
        buyScore += 1;
        if (trendUp) buyReasons.push("장기추세↑");
      }

      // H) 주봉 추세 확인
      if (weeklyTrendUp === true) {
        buyScore += 1;
        buyReasons.push("주봉추세↑");
      }

      // I) BB 스퀴즈 → 상방
      if (isSqueeze && price > bb[i].middle && (volExplosion || bullMomentum)) {
        buyScore += 3; buyFactors++;
        buyReasons.push("스퀴즈 상방돌파");
      }

      // J) 강세 다이버전스
      if (bullDiv) {
        buyScore += 2; buyFactors++;
        buyReasons.push("RSI 강세 다이버전스");
      }

      // K) 스토캐스틱 과매도 크로스
      if (stochBullCross) {
        buyScore += 2; buyFactors++;
        buyReasons.push(`Stoch ${stoch.k[i].toFixed(0)} 과매도 크로스`);
      }

      // L) 캔들 패턴
      if (pattern === "hammer") {
        buyScore += 2; buyFactors++;
        buyReasons.push("해머 캔들");
      } else if (pattern === "bullish_engulfing") {
        buyScore += 2; buyFactors++;
        buyReasons.push("강세 장악형");
      }

      // M) ADX 보너스
      if (adxStrong && trendUp) {
        buyScore += 1;
        buyReasons.push(`ADX ${adxVal.toFixed(0)}`);
      }

      // N) 모멘텀 연속성 보너스
      if (bullMomentum && trendUp) {
        buyScore += 1;
        buyReasons.push(`${momentumBars}봉 연속 상승`);
      }

      // O) 모멘텀 데케이 팩터 (최근 신호 재확인 = 추세 연속성)
      if (hasRecentMomentum && signals.slice(-1)[0]?.type === "BUY") {
        buyScore += 1;
        buyReasons.push("모멘텀 연속성 +1");
      }

      // ── 매수 조건: 스코어 3+ AND 팩터 2개+ ──
      let ema200Note = "";
      if (longTrendUp) {
        buyScore += 1;
      } else if (longTrendDown) {
        ema200Note = " [장기추세↓ 주의]";
      }

      if (buyScore >= 3 && buyFactors >= 2) {
        const grade = buyScore >= 8 ? "A" : buyScore >= 5 ? "B" : "C";
        lastSignalIdx = i;
        signals.push({
          index: i, type: "BUY", price,
          confidence: grade,
          positionSize: posSize,
          atrPct: +atrPct.toFixed(2),
          reason: `₿ [${grade}급 ${buyScore}pt/${buyFactors}팩터] ${buyReasons.join(" + ")}${ema200Note}`,
        });
      }

      // ════════════════════════════════════════════════════════════
      // 매도 시그널
      // ════════════════════════════════════════════════════════════
      let sellScore = 0;
      const sellReasons = [];
      let sellFactors = 0;

      // A) RSI 과매수 영역
      if (rsiDrop) {
        sellScore += 3; sellFactors++;
        sellReasons.push(`RSI ${rsi[i].toFixed(1)} > ${rsiSellTh} 탈출`);
      } else if (rsi[i] >= rsiSellTh - 5 && rsi[i] < rsi[i - 1]) {
        sellScore += 2; sellFactors++;
        sellReasons.push(`RSI ${rsi[i].toFixed(1)} 과매수근접 하락`);
      }

      // B) BB 상단 거부 또는 상단 근접
      if (bbReject) {
        sellScore += 2; sellFactors++;
        sellReasons.push("BB 상단 거부");
      } else if (bb[i] && price >= bb[i].upper * 0.99) {
        sellScore += 1; sellFactors++;
        sellReasons.push("BB 상단 근접");
      }

      // C) MACD 데드크로스 또는 악화
      if (macdCrossDown) {
        sellScore += 2; sellFactors++;
        sellReasons.push("MACD 데드크로스");
      } else if (macdAccelDown && histogram[i] < 0) {
        sellScore += 1; sellFactors++;
        sellReasons.push("MACD 가속↓");
      } else if (histogram[i] < 0 && histogram[i] < histogram[i - 1]) {
        sellScore += 1; sellFactors++;
        sellReasons.push("MACD 히스토그램 확대↓");
      }

      // D) EMA 역배열 크로스 또는 역배열 유지
      if (emaCrossDown) {
        sellScore += 3; sellFactors++;
        sellReasons.push("EMA21/55 데드크로스");
      } else if (trendDown) {
        sellScore += 1; sellFactors++;
        sellReasons.push("EMA 역배열");
      }

      // E) EMA200 하회 (장기 추세 전환)
      if (longTrendDown && trendDown) {
        sellScore += 2;
        sellReasons.push("EMA200 하회");
      }

      // F) 약세 다이버전스
      if (bearDiv) {
        sellScore += 2; sellFactors++;
        sellReasons.push("RSI 약세 다이버전스");
      }

      // G) OBV 하락전환 또는 지속 하락
      if (obvFalling) {
        sellScore += 2; sellFactors++;
        sellReasons.push("OBV 스마트머니 이탈");
      } else if (obv[i] < obvEma[i] && obv[i] < obv[i - 1]) {
        sellScore += 1; sellFactors++;
        sellReasons.push("OBV 하락 지속");
      }

      // H) 거래량 폭증 + 음봉
      if (volExplosion && price < prevPrice) {
        sellScore += 2; sellFactors++;
        sellReasons.push(`Vol ${(curVol / volAvg).toFixed(1)}x + 음봉`);
      }

      // I) 스퀴즈 하방
      if (isSqueeze && price < bb[i].middle && bearMomentum) {
        sellScore += 2; sellFactors++;
        sellReasons.push("스퀴즈 하방돌파");
      }

      // J) 스토캐스틱 과매수 크로스
      if (stochBearCross) {
        sellScore += 2; sellFactors++;
        sellReasons.push(`Stoch ${stoch.k[i].toFixed(0)} 과매수 크로스`);
      }

      // K) 약세 캔들 패턴
      if (pattern === "bearish_engulfing") {
        sellScore += 2; sellFactors++;
        sellReasons.push("약세 장악형");
      }

      // L) 주봉 추세 하락 확인
      if (weeklyTrendUp === false) {
        sellScore += 1;
        sellReasons.push("주봉추세↓");
      }

      // ── 매도 조건: 스코어 3+ AND 팩터 2개+ ──
      if (sellScore >= 3 && sellFactors >= 2) {
        const grade = sellScore >= 8 ? "A" : sellScore >= 5 ? "B" : "C";
        lastSignalIdx = i;
        signals.push({
          index: i, type: "SELL", price,
          confidence: grade,
          positionSize: posSize,
          atrPct: +atrPct.toFixed(2),
          reason: `₿ [${grade}급 ${sellScore}pt/${sellFactors}팩터] ${sellReasons.join(" + ")}`,
        });
      }
    }

    return signals;
  },
};

// ════════════════════════════════════════════════════════════════════
// 독자 알파 전략 — 시장 비효율성 포착 (퀀트팀 R&D)
// ════════════════════════════════════════════════════════════════════

// ── 1) Hurst Exponent 전략 — 추세/평균회귀 레짐 감지 ──
// H > 0.5 = 추세 지속 (모멘텀 추종), H < 0.5 = 평균회귀 (역추세)
// 대부분의 트레이더가 항상 같은 방식(모멘텀 or 역추세)으로 매매하지만,
// 시장은 레짐이 바뀜. 이걸 실시간 감지해서 전략을 전환하는 것이 알파.
export const strategyHurst = {
  id: "hurst_regime",
  name: "🧬 Hurst 레짐 스위칭",
  desc: "Hurst 지수로 시장이 추세형(H>0.55)인지 평균회귀형(H<0.45)인지 실시간 감지. 추세형에선 돌파 매수, 평균회귀형에선 과매도 역매매. 레짐 전환점이 곧 알파.",
  category: "알파",
  risk: "중",
  icon: "🧬",
  params: { hurstWindow: 100, lookback: 20 },
  generate(candles, params = {}) {
    const { hurstWindow = 100, lookback = 20 } = { ...this.params, ...params };
    if (candles.length < hurstWindow + 50) return [];

    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);

    // Hurst 지수 계산 (R/S 분석)
    function calcHurst(data) {
      const n = data.length;
      if (n < 20) return 0.5;
      const logReturns = [];
      for (let i = 1; i < n; i++) logReturns.push(Math.log(data[i] / data[i - 1]));
      const mean = logReturns.reduce((a, b) => a + b, 0) / logReturns.length;
      const deviations = logReturns.map(r => r - mean);
      const cumDev = [];
      let cum = 0;
      for (const d of deviations) { cum += d; cumDev.push(cum); }
      const R = Math.max(...cumDev) - Math.min(...cumDev);
      const S = Math.sqrt(deviations.reduce((a, b) => a + b * b, 0) / deviations.length);
      if (S === 0) return 0.5;
      const RS = R / S;
      return Math.log(RS) / Math.log(n);
    }

    const signals = [];
    const rsi = calcRSI(closes, 14);
    const atr = calcATR(highs, lows, closes, 14);
    const ema20 = calcEMA(closes, 20);
    const ema50 = calcEMA(closes, 50);
    let lastIdx = -10;

    for (let i = hurstWindow; i < candles.length; i++) {
      if (i - lastIdx < 3) continue;
      const slice = closes.slice(i - hurstWindow, i);
      const H = calcHurst(slice);
      const price = closes[i];
      const atrPct = atr[i] && price > 0 ? (atr[i] / price) * 100 : 2;

      if (H > 0.55) {
        // 추세형 레짐 → 돌파 추종 전략
        const breakoutHigh = Math.max(...highs.slice(i - lookback, i));
        const trendUp = ema20[i] > ema50[i];
        if (price > breakoutHigh && trendUp) {
          lastIdx = i;
          signals.push({
            index: i, type: "BUY", price,
            confidence: H > 0.65 ? "A" : "B",
            reason: `🧬 Hurst ${H.toFixed(2)} 추세레짐 — ${lookback}봉 고점돌파 $${breakoutHigh.toFixed(0)}`,
          });
        }
        const breakoutLow = Math.min(...lows.slice(i - lookback, i));
        if (price < breakoutLow && !trendUp) {
          lastIdx = i;
          signals.push({
            index: i, type: "SELL", price,
            confidence: H > 0.65 ? "A" : "B",
            reason: `🧬 Hurst ${H.toFixed(2)} 추세레짐 — ${lookback}봉 저점이탈 $${breakoutLow.toFixed(0)}`,
          });
        }
      } else if (H < 0.45) {
        // 평균회귀형 레짐 → 역추세 전략
        if (rsi[i] != null && rsi[i] < 30 && rsi[i] > rsi[i - 1]) {
          lastIdx = i;
          signals.push({
            index: i, type: "BUY", price,
            confidence: H < 0.35 ? "A" : "B",
            reason: `🧬 Hurst ${H.toFixed(2)} 회귀레짐 — RSI ${rsi[i].toFixed(1)} 반등 (평균회귀 매수)`,
          });
        }
        if (rsi[i] != null && rsi[i] > 70 && rsi[i] < rsi[i - 1]) {
          lastIdx = i;
          signals.push({
            index: i, type: "SELL", price,
            confidence: H < 0.35 ? "A" : "B",
            reason: `🧬 Hurst ${H.toFixed(2)} 회귀레짐 — RSI ${rsi[i].toFixed(1)} 하락 (평균회귀 매도)`,
          });
        }
      }
    }
    return signals;
  },
};

// ── 2) Volatility Clustering Breakout — 변동성 군집 돌파 ──
// GARCH 개념을 단순화: 변동성은 군집됨 (큰 움직임 뒤에 큰 움직임).
// 변동성 압축 구간(낮은 ATR) → 폭발 직전을 포착하는 것이 핵심 알파.
// 기존 BB Squeeze와 다른 점: ATR 변화율 + 체제 전환 확률까지 계산.
export const strategyVolCluster = {
  id: "vol_cluster",
  name: "⚡ 변동성 군집 돌파",
  desc: "GARCH 기반 변동성 군집 효과 활용. ATR 압축 비율이 임계점 이하로 수축 후 확장 시작 시 돌파 방향으로 포지션. 변동성 폭발 직전을 포착.",
  category: "알파",
  risk: "고",
  icon: "⚡",
  params: { atrPeriod: 14, contractionThreshold: 0.5, expansionMult: 1.8 },
  generate(candles, params = {}) {
    const { atrPeriod = 14, contractionThreshold = 0.5, expansionMult = 1.8 } = { ...this.params, ...params };
    if (candles.length < 80) return [];

    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const volumes = candles.map(c => c.volume || 0);
    const atr = calcATR(highs, lows, closes, atrPeriod);

    // ATR의 50봉 이동평균 (장기 변동성 기준선)
    const atrLongMA = calcSMA(atr.map(v => v || 0), 50);

    const signals = [];
    let lastIdx = -5;
    let inContraction = false;
    let contractionStart = -1;

    for (let i = 60; i < candles.length; i++) {
      if (i - lastIdx < 3) continue;
      if (!atr[i] || !atrLongMA[i] || atrLongMA[i] === 0) continue;

      const atrRatio = atr[i] / atrLongMA[i]; // 현재 ATR / 장기 ATR
      const price = closes[i];

      // 수축 감지: ATR이 장기 평균 대비 50% 이하로 줄어든 상태
      if (atrRatio < contractionThreshold && !inContraction) {
        inContraction = true;
        contractionStart = i;
      }

      // 폭발 감지: 수축 후 ATR이 장기 평균 * 1.8 이상으로 급등
      if (inContraction && atrRatio > expansionMult) {
        inContraction = false;
        const contractionLen = i - contractionStart;

        // 방향 결정: 폭발 시점의 가격 변화 방향
        const priceChange = closes[i] - closes[i - 1];
        const volSurge = volumes[i] > 0 && calcSMA(volumes, 20)[i] > 0
          ? volumes[i] / calcSMA(volumes, 20)[i] : 1;

        if (priceChange > 0) {
          lastIdx = i;
          signals.push({
            index: i, type: "BUY", price,
            confidence: contractionLen > 10 && volSurge > 2 ? "A" : contractionLen > 5 ? "B" : "C",
            reason: `⚡ 변동성폭발↑ ATR비율 ${atrRatio.toFixed(2)} (${contractionLen}봉 수축후) Vol ${volSurge.toFixed(1)}x`,
          });
        } else {
          lastIdx = i;
          signals.push({
            index: i, type: "SELL", price,
            confidence: contractionLen > 10 && volSurge > 2 ? "A" : contractionLen > 5 ? "B" : "C",
            reason: `⚡ 변동성폭발↓ ATR비율 ${atrRatio.toFixed(2)} (${contractionLen}봉 수축후) Vol ${volSurge.toFixed(1)}x`,
          });
        }
      }

      // 수축이 너무 길면 리셋 (30봉 이상 수축은 비정상)
      if (inContraction && i - contractionStart > 30) {
        inContraction = false;
      }
    }
    return signals;
  },
};

// ── 3) Adaptive Efficiency Ratio — 시장 효율성 측정 전략 ──
// Kaufman의 효율성 비율(ER) 확장: ER이 높으면 순방향 모멘텀이 강함,
// ER이 낮으면 시장이 랜덤워크에 가까움 (노이즈).
// ER 급등 = 강한 추세 시작 감지 → 이 "추세 탄생" 순간을 포착.
export const strategyEfficiency = {
  id: "efficiency_ratio",
  name: "📐 효율성 비율 전략",
  desc: "Kaufman 효율성비율(ER) 기반. 가격 이동의 효율성(방향성/노이즈 비율)이 급등하면 새로운 추세 탄생을 포착. ER 급락은 추세 소멸 = 이탈 시그널.",
  category: "알파",
  risk: "중",
  icon: "📐",
  params: { erPeriod: 10, erSmooth: 5, threshold: 0.6 },
  generate(candles, params = {}) {
    const { erPeriod = 10, erSmooth = 5, threshold = 0.6 } = { ...this.params, ...params };
    if (candles.length < erPeriod + erSmooth + 30) return [];

    const closes = candles.map(c => c.close);

    // 효율성 비율 계산: |방향이동| / (총경로이동)
    const er = [];
    for (let i = 0; i < closes.length; i++) {
      if (i < erPeriod) { er.push(0); continue; }
      const direction = Math.abs(closes[i] - closes[i - erPeriod]);
      let volatility = 0;
      for (let j = 1; j <= erPeriod; j++) {
        volatility += Math.abs(closes[i - j + 1] - closes[i - j]);
      }
      er.push(volatility > 0 ? direction / volatility : 0);
    }

    // ER 스무딩
    const erMA = calcSMA(er, erSmooth);

    const signals = [];
    let lastIdx = -5;

    for (let i = erPeriod + erSmooth + 5; i < candles.length; i++) {
      if (i - lastIdx < 3) continue;
      const price = closes[i];

      // ER 급등 감지: 이전 5봉 평균 대비 현재 ER이 threshold 이상
      const prevAvgER = (erMA[i - 1] + erMA[i - 2] + erMA[i - 3]) / 3;
      const curER = erMA[i];

      if (curER > threshold && prevAvgER < threshold * 0.7) {
        // 추세 탄생! 방향은 가격 변화로 판단
        const direction = closes[i] - closes[i - erPeriod];
        if (direction > 0) {
          lastIdx = i;
          signals.push({
            index: i, type: "BUY", price,
            confidence: curER > 0.8 ? "A" : "B",
            reason: `📐 ER ${curER.toFixed(2)}→추세탄생↑ (이전 ${prevAvgER.toFixed(2)} 노이즈→방향성)`,
          });
        } else {
          lastIdx = i;
          signals.push({
            index: i, type: "SELL", price,
            confidence: curER > 0.8 ? "A" : "B",
            reason: `📐 ER ${curER.toFixed(2)}→추세탄생↓ (이전 ${prevAvgER.toFixed(2)} 노이즈→방향성)`,
          });
        }
      }

      // ER 급락 = 추세 소멸 → 기존 포지션 정리 시그널
      if (curER < 0.2 && prevAvgER > 0.5) {
        const priceDir = closes[i] - closes[i - 3];
        lastIdx = i;
        signals.push({
          index: i, type: priceDir > 0 ? "SELL" : "BUY", price,
          confidence: "C",
          reason: `📐 ER ${curER.toFixed(2)}→추세소멸 (${prevAvgER.toFixed(2)}→노이즈전환) 포지션정리`,
        });
      }
    }
    return signals;
  },
};

// ── 4) Momentum Decay Rate — 모멘텀 감쇠율 기반 반전 포착 ──
// 핵심 인사이트: 가격은 한 방향으로 움직이다가 멈추는데,
// "멈추는 과정"은 급작스럽지 않고 감속됨. 이 감속 패턴을 수학적으로 포착.
// 모멘텀의 1차/2차 미분 = 속도와 가속도 분석.
export const strategyMomDecay = {
  id: "momentum_decay",
  name: "📉 모멘텀 감쇠 포착",
  desc: "모멘텀의 1차/2차 미분으로 가속→감속 전환점 실시간 포착. 상승 모멘텀이 3봉 연속 둔화 + 거래량 이탈 = 고점 매도. 하락 감쇠 = 저점 매수.",
  category: "알파",
  risk: "중",
  icon: "📉",
  params: { momPeriod: 10, decayBars: 3 },
  generate(candles, params = {}) {
    const { momPeriod = 10, decayBars = 3 } = { ...this.params, ...params };
    if (candles.length < momPeriod + 30) return [];

    const closes = candles.map(c => c.close);
    const volumes = candles.map(c => c.volume || 0);

    // 모멘텀 (ROC: Rate of Change)
    const mom = [];
    for (let i = 0; i < closes.length; i++) {
      if (i < momPeriod) { mom.push(0); continue; }
      mom.push(((closes[i] - closes[i - momPeriod]) / closes[i - momPeriod]) * 100);
    }

    // 모멘텀의 변화율 (가속도 = 1차 미분)
    const momDelta = [0];
    for (let i = 1; i < mom.length; i++) {
      momDelta.push(mom[i] - mom[i - 1]);
    }

    // 가속도의 변화율 (2차 미분 = 변곡점)
    const momDelta2 = [0];
    for (let i = 1; i < momDelta.length; i++) {
      momDelta2.push(momDelta[i] - momDelta[i - 1]);
    }

    const volSMA = calcSMA(volumes, 20);
    const signals = [];
    let lastIdx = -5;

    for (let i = momPeriod + 10; i < candles.length; i++) {
      if (i - lastIdx < 3) continue;
      const price = closes[i];

      // 상승 모멘텀 감쇠 감지: mom > 0 이지만 decayBars 연속 둔화
      let bullDecaying = mom[i] > 2; // 아직 양의 모멘텀
      for (let j = 0; j < decayBars && i - j > 0; j++) {
        if (momDelta[i - j] >= 0) { bullDecaying = false; break; } // 가속 중이면 아님
      }
      // 거래량 이탈 확인: 현재 거래량 < 평균의 70%
      const volDrying = volSMA[i] > 0 && volumes[i] < volSMA[i] * 0.7;

      if (bullDecaying && (volDrying || momDelta2[i] < -0.5)) {
        lastIdx = i;
        signals.push({
          index: i, type: "SELL", price,
          confidence: volDrying && momDelta2[i] < -1 ? "A" : "B",
          reason: `📉 상승모멘텀 감쇠 ${decayBars}봉 — mom ${mom[i].toFixed(1)}%↘ 가속도 ${momDelta[i].toFixed(2)}${volDrying ? " + 거래량이탈" : ""}`,
        });
      }

      // 하락 모멘텀 감쇠 = 바닥 다지기 → 매수 기회
      let bearDecaying = mom[i] < -2;
      for (let j = 0; j < decayBars && i - j > 0; j++) {
        if (momDelta[i - j] <= 0) { bearDecaying = false; break; }
      }
      const volSurge = volSMA[i] > 0 && volumes[i] > volSMA[i] * 1.5;

      if (bearDecaying && (volSurge || momDelta2[i] > 0.5)) {
        lastIdx = i;
        signals.push({
          index: i, type: "BUY", price,
          confidence: volSurge && momDelta2[i] > 1 ? "A" : "B",
          reason: `📉 하락모멘텀 감쇠 ${decayBars}봉 — mom ${mom[i].toFixed(1)}%↗ 가속도 ${momDelta[i].toFixed(2)}${volSurge ? " + 거래량급증" : ""}`,
        });
      }
    }
    return signals;
  },
};

// ── 5) Information Flow — 정보 비대칭 포착 ──
// 핵심: "스마트머니"는 가격보다 거래량에 먼저 나타남.
// 가격은 아직 움직이지 않았지만 거래량 패턴이 비정상적으로 변한 경우,
// 이는 정보를 가진 대형 플레이어의 선행 포지셔닝 = 알파의 원천.
export const strategyInfoFlow = {
  id: "info_flow",
  name: "🔮 정보흐름 감지",
  desc: "가격-거래량 디커플링으로 스마트머니 선행매집 포착. 가격 보합 + 거래량 3봉 연속 급증 = 대형 플레이어 포지셔닝 감지. OBV 가속 + 가격 정체 = 매집 완료 신호.",
  category: "알파",
  risk: "중",
  icon: "🔮",
  params: { volSurgeMult: 2.0, priceFlatPct: 1.0, confirmBars: 3 },
  generate(candles, params = {}) {
    const { volSurgeMult = 2.0, priceFlatPct = 1.0, confirmBars = 3 } = { ...this.params, ...params };
    if (candles.length < 60) return [];

    const closes = candles.map(c => c.close);
    const volumes = candles.map(c => c.volume || 0);
    const obv = calcOBV(closes, volumes);
    const obvEma = calcEMA(obv, 20);
    const volSMA = calcSMA(volumes, 20);

    const signals = [];
    let lastIdx = -5;

    for (let i = 30; i < candles.length; i++) {
      if (i - lastIdx < 4) continue;
      const price = closes[i];

      // 가격 보합 체크: 최근 confirmBars 동안 변동 < priceFlatPct%
      let priceFlat = true;
      const basePrice = closes[i - confirmBars];
      for (let j = 0; j < confirmBars; j++) {
        const pctChange = Math.abs((closes[i - j] - basePrice) / basePrice) * 100;
        if (pctChange > priceFlatPct) { priceFlat = false; break; }
      }

      // 거래량 서지 체크: confirmBars 연속 평균 대비 volSurgeMult 이상
      let volSurging = true;
      let avgVolRatio = 0;
      for (let j = 0; j < confirmBars; j++) {
        const ratio = volSMA[i - j] > 0 ? volumes[i - j] / volSMA[i - j] : 0;
        if (ratio < volSurgeMult) { volSurging = false; break; }
        avgVolRatio += ratio;
      }
      avgVolRatio /= confirmBars;

      if (!priceFlat || !volSurging) continue;

      // OBV 방향으로 스마트머니 방향 판단
      const obvTrend = obv[i] - obv[i - confirmBars];
      const obvAboveEma = obv[i] > obvEma[i];

      if (obvTrend > 0 && obvAboveEma) {
        // 매집 (스마트머니 매수) 감지
        lastIdx = i;
        signals.push({
          index: i, type: "BUY", price,
          confidence: avgVolRatio > 3 ? "A" : "B",
          reason: `🔮 스마트머니 매집감지 — 가격보합 + Vol ${avgVolRatio.toFixed(1)}x×${confirmBars}봉 + OBV↑`,
        });
      } else if (obvTrend < 0 && !obvAboveEma) {
        // 분산 (스마트머니 매도) 감지
        lastIdx = i;
        signals.push({
          index: i, type: "SELL", price,
          confidence: avgVolRatio > 3 ? "A" : "B",
          reason: `🔮 스마트머니 분산감지 — 가격보합 + Vol ${avgVolRatio.toFixed(1)}x×${confirmBars}봉 + OBV↓`,
        });
      }
    }
    return signals;
  },
};

// ══════════════════════════════════════════════════════════════
// 7) Funding Rate Reversal — 펀딩레이트 극단치 역행 전략
// ══════════════════════════════════════════════════════════════
// 크립토 파생상품 시장에서 펀딩레이트(선물 프리미엄)가 극단적일 때
// 군중의 반대편에 서는 역발상 전략. 펀딩레이트 > 0.1%면 과열 → 숏,
// < -0.05%면 공포 → 롱. 실제 펀딩레이트 API 없이 가격-추세 괴리로 추정.
// 핵심: Open Interest의 방향성 + 가격 추세의 디커플링.
export const strategyFundingRate = {
  id: "funding_rate",
  name: "💰 펀딩레이트 역행",
  desc: "크립토 선물 시장의 펀딩레이트 극단치를 가격-거래량 괴리로 추정하여 군중 반대편 포지셔닝. 과열 시 숏, 공포 시 롱. 파생시장 오버레버리지 청산 파동 포착.",
  category: "알파",
  risk: "고",
  icon: "💰",
  params: { lookback: 20, extremeThreshold: 2.5, cooldown: 5 },
  generate(candles, params = {}) {
    const { lookback = 20, extremeThreshold = 2.5, cooldown = 5 } = { ...this.params, ...params };
    if (candles.length < lookback + 50) return [];

    const closes = candles.map(c => c.close);
    const volumes = candles.map(c => c.volume || 0);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const atr = calcATR(highs, lows, closes, 14);
    const rsi = calcRSI(closes, 14);
    const volSMA = calcSMA(volumes, lookback);

    // 펀딩레이트 프록시: 가격 추세 강도 vs 거래량 비정상도
    // 선물 시장에서 과도한 레버리지 = 가격 급등 + 거래량 폭발 → 청산 임박
    function calcFundingProxy(i) {
      if (i < lookback) return 0;
      // 가격 모멘텀 (z-score)
      const returns = [];
      for (let j = 0; j < lookback; j++) {
        if (i - j > 0) returns.push((closes[i - j] - closes[i - j - 1]) / closes[i - j - 1]);
      }
      const meanRet = returns.reduce((a, b) => a + b, 0) / returns.length;
      const stdRet = Math.sqrt(returns.reduce((a, b) => a + (b - meanRet) ** 2, 0) / returns.length);
      const priceZ = stdRet > 0 ? meanRet / stdRet : 0;

      // 거래량 비정상도
      const volZ = volSMA[i] > 0 ? (volumes[i] / volSMA[i]) - 1 : 0;

      // 펀딩 프록시: 높은 모멘텀 + 높은 거래량 = 과열
      return priceZ * (1 + Math.min(volZ, 3));
    }

    const signals = [];
    let lastIdx = -cooldown;

    for (let i = lookback + 10; i < candles.length; i++) {
      if (i - lastIdx < cooldown) continue;
      const funding = calcFundingProxy(i);
      const price = closes[i];
      const atrPct = atr[i] && price > 0 ? (atr[i] / price) * 100 : 2;

      // 극단적 과열: 펀딩 프록시 > threshold → 매도 (롱 청산 파동 예상)
      if (funding > extremeThreshold && rsi[i] > 70) {
        lastIdx = i;
        signals.push({
          index: i, type: "SELL", price,
          confidence: funding > extremeThreshold * 1.5 ? "A" : "B",
          reason: `💰 펀딩과열 ${funding.toFixed(2)} — RSI ${rsi[i].toFixed(0)} 레버리지 청산 임박`,
        });
      }
      // 극단적 공포: 펀딩 프록시 < -threshold → 매수 (숏 청산 스퀴즈 예상)
      else if (funding < -extremeThreshold && rsi[i] < 30) {
        lastIdx = i;
        signals.push({
          index: i, type: "BUY", price,
          confidence: funding < -extremeThreshold * 1.5 ? "A" : "B",
          reason: `💰 펀딩공포 ${funding.toFixed(2)} — RSI ${rsi[i].toFixed(0)} 숏스퀴즈 임박`,
        });
      }
    }
    return signals;
  },
};

// ══════════════════════════════════════════════════════════════
// 8) Microstructure Alpha — 가격 미세구조 분석 전략
// ══════════════════════════════════════════════════════════════
// 고빈도 매매(HFT) 개념을 일봉/분봉에 적용.
// 캔들의 상체/하체 비율(위꼬리/아래꼬리)로 매수/매도 압력 비대칭 감지.
// 연속된 거래량 가중 가격 이동(VWAP 괴리) + 틱 비대칭으로 숨겨진 수급 포착.
export const strategyMicrostructure = {
  id: "microstructure",
  name: "🔬 마이크로스트럭처",
  desc: "HFT 개념의 가격 미세구조 분석. 캔들 위꼬리/아래꼬리 비율로 매수/매도 압력 비대칭 감지. VWAP 괴리 + 거래량 불균형으로 숨겨진 수급 변동 실시간 포착.",
  category: "알파",
  risk: "중",
  icon: "🔬",
  params: { wickWindow: 10, imbalanceThreshold: 0.65, vwapDeviation: 1.5 },
  generate(candles, params = {}) {
    const { wickWindow = 10, imbalanceThreshold = 0.65, vwapDeviation = 1.5 } = { ...this.params, ...params };
    if (candles.length < 60) return [];

    const closes = candles.map(c => c.close);
    const volumes = candles.map(c => c.volume || 0);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const opens = candles.map(c => c.open);
    const rsi = calcRSI(closes, 14);
    const atr = calcATR(highs, lows, closes, 14);

    // 틱 비대칭 (Tick Imbalance): 위꼬리 대비 아래꼬리 비율
    function calcWickImbalance(i) {
      let buyPressure = 0, sellPressure = 0;
      for (let j = Math.max(0, i - wickWindow + 1); j <= i; j++) {
        const body = Math.abs(closes[j] - opens[j]);
        const range = highs[j] - lows[j];
        if (range === 0) continue;

        // 아래꼬리 = 매수 압력 (하락 시도 후 매수세 유입)
        const lowerWick = Math.min(opens[j], closes[j]) - lows[j];
        // 위꼬리 = 매도 압력 (상승 시도 후 매도세 유입)
        const upperWick = highs[j] - Math.max(opens[j], closes[j]);

        buyPressure += (lowerWick / range) * (volumes[j] || 1);
        sellPressure += (upperWick / range) * (volumes[j] || 1);
      }
      const total = buyPressure + sellPressure;
      return total > 0 ? buyPressure / total : 0.5;
    }

    // 거래량 가중 이동평균가격 (VWAP) 괴리
    function calcVWAPDeviation(i, window = 20) {
      let sumPV = 0, sumV = 0;
      for (let j = Math.max(0, i - window + 1); j <= i; j++) {
        const typicalPrice = (highs[j] + lows[j] + closes[j]) / 3;
        sumPV += typicalPrice * (volumes[j] || 1);
        sumV += (volumes[j] || 1);
      }
      const vwap = sumV > 0 ? sumPV / sumV : closes[i];
      const atrVal = atr[i] || 1;
      return (closes[i] - vwap) / atrVal;
    }

    const signals = [];
    let lastIdx = -5;

    for (let i = 30; i < candles.length; i++) {
      if (i - lastIdx < 3) continue;
      const price = closes[i];
      const imbalance = calcWickImbalance(i);
      const vwapDev = calcVWAPDeviation(i);

      // 매수 압력 우세 + VWAP 하방 괴리 (저평가 + 매수세 강함)
      if (imbalance > imbalanceThreshold && vwapDev < -vwapDeviation && rsi[i] < 45) {
        lastIdx = i;
        signals.push({
          index: i, type: "BUY", price,
          confidence: imbalance > 0.75 ? "A" : "B",
          reason: `🔬 마이크로 매수압력 ${(imbalance * 100).toFixed(0)}% + VWAP괴리 ${vwapDev.toFixed(1)}σ`,
        });
      }
      // 매도 압력 우세 + VWAP 상방 괴리 (고평가 + 매도세 강함)
      else if (imbalance < (1 - imbalanceThreshold) && vwapDev > vwapDeviation && rsi[i] > 55) {
        lastIdx = i;
        signals.push({
          index: i, type: "SELL", price,
          confidence: imbalance < 0.25 ? "A" : "B",
          reason: `🔬 마이크로 매도압력 ${((1 - imbalance) * 100).toFixed(0)}% + VWAP괴리 +${vwapDev.toFixed(1)}σ`,
        });
      }
    }
    return signals;
  },
};

// ══════════════════════════════════════════════════════════════
// 9) Entropy Regime — 정보 엔트로피 기반 레짐 전환 전략
// ══════════════════════════════════════════════════════════════
// 가격 수익률 분포의 Shannon 엔트로피로 시장 무질서도 측정.
// 엔트로피 급감 = 시장이 한 방향으로 수렴 (트렌드 시작 임박)
// 엔트로피 급증 = 시장이 랜덤워크 (방향성 상실 → 역추세)
// 물리학의 상전이(phase transition) 개념을 금융 시장에 적용.
export const strategyEntropy = {
  id: "entropy_regime",
  name: "🌀 엔트로피 레짐",
  desc: "Shannon 엔트로피로 시장의 정보 무질서도를 측정. 엔트로피 급감(수렴) = 추세 시작, 엔트로피 급증(발산) = 방향 상실. 물리학 상전이 개념의 금융시장 적용.",
  category: "알파",
  risk: "중",
  icon: "🌀",
  params: { entropyWindow: 30, bins: 10, changeThreshold: 0.25 },
  generate(candles, params = {}) {
    const { entropyWindow = 30, bins = 10, changeThreshold = 0.25 } = { ...this.params, ...params };
    if (candles.length < entropyWindow + 50) return [];

    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const rsi = calcRSI(closes, 14);
    const ema20 = calcEMA(closes, 20);
    const ema50 = calcEMA(closes, 50);
    const atr = calcATR(highs, lows, closes, 14);

    // Shannon 엔트로피 계산
    function calcEntropy(data) {
      if (data.length < 5) return 0;
      const min = Math.min(...data);
      const max = Math.max(...data);
      const range = max - min;
      if (range === 0) return 0;

      const binCounts = new Array(bins).fill(0);
      for (const v of data) {
        const idx = Math.min(Math.floor(((v - min) / range) * bins), bins - 1);
        binCounts[idx]++;
      }

      let entropy = 0;
      for (const count of binCounts) {
        if (count > 0) {
          const p = count / data.length;
          entropy -= p * Math.log2(p);
        }
      }
      return entropy / Math.log2(bins); // 0~1 정규화
    }

    const signals = [];
    let lastIdx = -5;

    for (let i = entropyWindow + 10; i < candles.length; i++) {
      if (i - lastIdx < 4) continue;
      const price = closes[i];

      // 수익률 기반 엔트로피
      const returns = [];
      for (let j = i - entropyWindow + 1; j <= i; j++) {
        returns.push((closes[j] - closes[j - 1]) / closes[j - 1]);
      }
      const currentEntropy = calcEntropy(returns);

      // 이전 구간 엔트로피 (비교용)
      const prevReturns = [];
      for (let j = i - entropyWindow * 2 + 1; j <= i - entropyWindow; j++) {
        if (j > 0) prevReturns.push((closes[j] - closes[j - 1]) / closes[j - 1]);
      }
      const prevEntropy = prevReturns.length > 5 ? calcEntropy(prevReturns) : currentEntropy;

      const entropyChange = currentEntropy - prevEntropy;
      const trendUp = ema20[i] > ema50[i];
      const trendDown = ema20[i] < ema50[i];

      // 엔트로피 급감 (수렴) → 추세 시작 임박 → 추세 방향으로 진입
      if (entropyChange < -changeThreshold && currentEntropy < 0.4) {
        if (trendUp && rsi[i] > 50 && rsi[i] < 70) {
          lastIdx = i;
          signals.push({
            index: i, type: "BUY", price,
            confidence: entropyChange < -changeThreshold * 1.5 ? "A" : "B",
            reason: `🌀 엔트로피 수렴 ${currentEntropy.toFixed(2)} (Δ${entropyChange.toFixed(2)}) — 상승추세 수렴`,
          });
        } else if (trendDown && rsi[i] < 50 && rsi[i] > 30) {
          lastIdx = i;
          signals.push({
            index: i, type: "SELL", price,
            confidence: entropyChange < -changeThreshold * 1.5 ? "A" : "B",
            reason: `🌀 엔트로피 수렴 ${currentEntropy.toFixed(2)} (Δ${entropyChange.toFixed(2)}) — 하락추세 수렴`,
          });
        }
      }
      // 엔트로피 급증 (발산) → 방향성 상실 → 과매수/과매도 역추세
      else if (entropyChange > changeThreshold && currentEntropy > 0.7) {
        if (rsi[i] < 30) {
          lastIdx = i;
          signals.push({
            index: i, type: "BUY", price,
            confidence: "B",
            reason: `🌀 엔트로피 발산 ${currentEntropy.toFixed(2)} (Δ+${entropyChange.toFixed(2)}) — RSI ${rsi[i].toFixed(0)} 역추세 매수`,
          });
        } else if (rsi[i] > 70) {
          lastIdx = i;
          signals.push({
            index: i, type: "SELL", price,
            confidence: "B",
            reason: `🌀 엔트로피 발산 ${currentEntropy.toFixed(2)} (Δ+${entropyChange.toFixed(2)}) — RSI ${rsi[i].toFixed(0)} 역추세 매도`,
          });
        }
      }
    }
    return signals;
  },
};

// ── 전략 목록 ────────────────────────────────────────────────────
export const ALL_STRATEGIES = [
  strategyRSI,
  strategyBB,
  strategyMACD,
  strategyMA,
  strategyVolume,
  strategyCombo,
  strategyTurtle,
  strategyKeltner,
  strategyDualMomentum,
  strategyWilliamsADX,
  strategyBBSqueeze,
  strategyTripleMA,
  strategyVWAP,
  strategyFibonacci,
  strategyIchimoku,         // NEW: 일목균형표
  strategyGapAndGo,
  strategySwingATR,
  strategyOBV,
  strategySupertrend,       // NEW: 슈퍼트렌드
  strategyStatArb,
  strategyParabolicSAR,     // NEW: 파라볼릭 SAR
  strategyConnorsRSI2,
  strategyRegimeSwitch,
  strategyHeikinAshi,
  strategyDualTimeframe,
  strategyMFI,              // NEW: MFI 자금유입
  strategyMomVolWeight,
  strategyElderTriple,
  strategyCCI,              // NEW: CCI 오실레이터
  strategyMACDDivergence,   // NEW: MACD 다이버전스
  strategyCandlePattern,    // NEW: 캔들 패턴
  strategyChannelMomentum,  // NEW: 채널 돌파 모멘텀
  strategyBTCAlpha,         // ₿ BTC 전용 멀티팩터
  // ── 독자 알파 전략 (퀀트팀 R&D) ──
  strategyHurst,            // 🧬 Hurst 레짐 스위칭
  strategyVolCluster,       // ⚡ 변동성 군집 돌파
  strategyEfficiency,       // 📐 효율성 비율
  strategyMomDecay,         // 📉 모멘텀 감쇠 포착
  strategyInfoFlow,         // 🔮 정보흐름 감지
  strategyFundingRate,      // 💰 펀딩레이트 역행 (크립토 특화)
  strategyMicrostructure,   // 🔬 마이크로스트럭처 (HFT 개념)
  strategyEntropy,          // 🌀 엔트로피 레짐 (물리학 상전이)
];

// ════════════════════════════════════════════════════════════════════
// 백테스팅 엔진 v2
// 슬리피지, 수수료, 포지션 사이징, 손절/익절, 봉별 자산추적
// ════════════════════════════════════════════════════════════════════

// v4.1: Omega/Tail Ratio + 연속손실 2회 축소 + 변동성 적응 슬리피지 + 낙폭 서킷브레이커 + CAGR
export function runBacktest(candles, signals, options = {}) {
  const {
    initialCapital = 10000,
    positionSize = 1.0,
    commission = 0.001,
    slippage = 0.0005,
    stopLoss = null,
    takeProfit = null,
    trailingStop = null,
    maxHoldBars = 60, // v3.6: 최대 보유 기간 (봉 수), null이면 무제한
    riskAdaptive = true, // v3.6: 연속 손실 시 포지션 축소
    maxDrawdownLimit = null, // v3.7: 최대 낙폭 서킷브레이커 (%, null이면 비활성)
    volScaledSlippage = true, // v3.7: 변동성 비례 슬리피지 자동 조정
    volScaledSizing = true, // v4.0: ATR 기반 변동성 적응 포지션 사이징
  } = options;

  let capital = initialCapital;
  let position = 0;
  let entryPrice = 0;
  let trailingHigh = 0;
  let entryIndex = -1; // v3.5: 진입 봉 인덱스 (MAE/MFE 추적용)
  let tradeLow = Infinity; // v3.5: 거래 중 최저가 (MAE)
  let tradeHigh = -Infinity; // v3.5: 거래 중 최고가 (MFE)
  const trades = [];
  const equity = [];
  let peakEquity = initialCapital;
  let maxDrawdown = 0;
  let maxDrawdownDuration = 0;
  let currentDDStart = 0;
  // v3.6: 연속 손실 추적 (리스크 적응 포지션 사이징)
  let consecLosses = 0;
  // v3.7: 서킷브레이커 상태
  let circuitBroken = false;
  let circuitBrokenAt = -1;

  // v3.7: 변동성 적응 슬리피지 계산 (ATR 기반, 최근 14봉 참조)
  function getAdaptiveSlippage(idx) {
    if (!volScaledSlippage) return slippage;
    const lookback = Math.min(14, idx);
    if (lookback < 2) return slippage;
    let atrSum = 0;
    for (let j = idx - lookback + 1; j <= idx; j++) {
      const tr = Math.max(candles[j].high - candles[j].low,
        Math.abs(candles[j].high - candles[j - 1].close),
        Math.abs(candles[j].low - candles[j - 1].close));
      atrSum += tr;
    }
    const atrPct = (atrSum / lookback) / candles[idx].close;
    // 기본 슬리피지 * (1 + ATR비율/2): ATR 3%이면 슬리피지 ~2.5배
    return slippage * (1 + atrPct * 50);
  }

  // v4.0: ATR 기반 변동성 적응 포지션 사이징 — 고변동 시 축소, 저변동 시 확대
  function getVolSizingFactor(idx) {
    if (!volScaledSizing) return 1.0;
    const lookback = Math.min(14, idx);
    if (lookback < 2) return 1.0;
    let atrSum = 0;
    for (let j = idx - lookback + 1; j <= idx; j++) {
      const tr = Math.max(candles[j].high - candles[j].low,
        Math.abs(candles[j].high - candles[j - 1].close),
        Math.abs(candles[j].low - candles[j - 1].close));
      atrSum += tr;
    }
    const atrPct = (atrSum / lookback) / candles[idx].close * 100;
    // 타겟 변동성 2%: ATR 2%이면 1.0, ATR 4%이면 0.5, ATR 1%이면 1.5 (최대 1.5배)
    const targetVol = 2.0;
    return Math.max(0.25, Math.min(1.5, targetVol / Math.max(atrPct, 0.5)));
  }

  // 시그널을 인덱스 순으로 정렬
  const sorted = [...signals].sort((a, b) => a.index - b.index);
  let sigIdx = 0;
  let lastAction = null;

  // 봉별로 순회하며 자산 추적
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];

    // 스톱로스 / 테이크프로핏 / 트레일링 스톱 체크
    if (position > 0 && entryPrice > 0) {
      // v3.5: MAE/MFE 추적 (거래 중 최저/최고 갱신)
      if (c.low < tradeLow) tradeLow = c.low;
      if (c.high > tradeHigh) tradeHigh = c.high;
      if (c.high > trailingHigh) trailingHigh = c.high;

      if (stopLoss && c.low <= entryPrice * (1 - stopLoss / 100)) {
        const sellPrice = entryPrice * (1 - stopLoss / 100) * (1 - slippage);
        const proceeds = position * sellPrice;
        const comm = proceeds * commission;
        const pnl = proceeds - comm - (position * entryPrice);
        const pnlPct = ((sellPrice / entryPrice) - 1) * 100;
        capital += proceeds - comm;
        consecLosses++; // v3.6: 손절은 항상 연속 손실 카운트
        trades.push({ type: "SELL", index: i, price: sellPrice, qty: position, pnl, pnlPct, reason: `손절 -${stopLoss}%`, time: c.time, mae: +((tradeLow - entryPrice) / entryPrice * 100).toFixed(2), mfe: +((tradeHigh - entryPrice) / entryPrice * 100).toFixed(2), holdBars: i - entryIndex });
        position = 0; entryPrice = 0; trailingHigh = 0; entryIndex = -1; tradeLow = Infinity; tradeHigh = -Infinity; lastAction = "SELL";
      } else if (takeProfit && c.high >= entryPrice * (1 + takeProfit / 100)) {
        const sellPrice = entryPrice * (1 + takeProfit / 100) * (1 - slippage);
        const proceeds = position * sellPrice;
        const comm = proceeds * commission;
        const pnl = proceeds - comm - (position * entryPrice);
        const pnlPct = ((sellPrice / entryPrice) - 1) * 100;
        capital += proceeds - comm;
        consecLosses = 0; // v3.6: 익절은 연속 손실 리셋
        trades.push({ type: "SELL", index: i, price: sellPrice, qty: position, pnl, pnlPct, reason: `익절 +${takeProfit}%`, time: c.time, mae: +((tradeLow - entryPrice) / entryPrice * 100).toFixed(2), mfe: +((tradeHigh - entryPrice) / entryPrice * 100).toFixed(2), holdBars: i - entryIndex });
        position = 0; entryPrice = 0; trailingHigh = 0; entryIndex = -1; tradeLow = Infinity; tradeHigh = -Infinity; lastAction = "SELL";
      } else if (trailingStop && trailingHigh > 0 && c.low <= trailingHigh * (1 - trailingStop / 100)) {
        // v3.3: 트레일링 스톱 — 최고점 대비 하락률 초과 시 매도
        const sellPrice = trailingHigh * (1 - trailingStop / 100) * (1 - slippage);
        const proceeds = position * sellPrice;
        const comm = proceeds * commission;
        const pnl = proceeds - comm - (position * entryPrice);
        const pnlPct = ((sellPrice / entryPrice) - 1) * 100;
        capital += proceeds - comm;
        if (pnl <= 0) consecLosses++; else consecLosses = 0; // v3.6
        trades.push({ type: "SELL", index: i, price: sellPrice, qty: position, pnl, pnlPct,
          reason: `트레일링 스톱 (고점 ${trailingHigh.toFixed(2)} → -${trailingStop}%)`, time: c.time, mae: +((tradeLow - entryPrice) / entryPrice * 100).toFixed(2), mfe: +((tradeHigh - entryPrice) / entryPrice * 100).toFixed(2), holdBars: i - entryIndex });
        position = 0; entryPrice = 0; trailingHigh = 0; entryIndex = -1; tradeLow = Infinity; tradeHigh = -Infinity; lastAction = "SELL";
      }
    }

    // v3.6: 최대 보유 기간 초과 시 강제 청산
    if (position > 0 && entryIndex >= 0 && maxHoldBars && (i - entryIndex) >= maxHoldBars) {
      const sellPrice = c.close * (1 - slippage);
      const proceeds = position * sellPrice;
      const comm = proceeds * commission;
      const pnl = proceeds - comm - (position * entryPrice);
      const pnlPct = ((sellPrice / entryPrice) - 1) * 100;
      capital += proceeds - comm;
      if (pnl <= 0) consecLosses++; else consecLosses = 0;
      trades.push({ type: "SELL", index: i, price: sellPrice, qty: position, pnl, pnlPct,
        reason: `최대 보유기간 ${maxHoldBars}봉 초과 청산`, time: c.time,
        mae: +((tradeLow - entryPrice) / entryPrice * 100).toFixed(2),
        mfe: +((tradeHigh - entryPrice) / entryPrice * 100).toFixed(2), holdBars: i - entryIndex });
      position = 0; entryPrice = 0; trailingHigh = 0; entryIndex = -1; tradeLow = Infinity; tradeHigh = -Infinity; lastAction = "SELL";
    }

    // v3.9: 점진적 서킷브레이커 — 낙폭 비례 포지션 축소 (70%→차단, 회복 시 점진 해제)
    let circuitScale = 1.0; // 1.0 = 정상, 0 = 완전 차단
    if (maxDrawdownLimit) {
      const currentEq = capital + (position > 0 ? position * c.close : 0);
      const currentDD = peakEquity > 0 ? ((peakEquity - currentEq) / peakEquity) * 100 : 0;
      if (currentDD >= maxDrawdownLimit) {
        circuitBroken = true;
        circuitBrokenAt = i;
        circuitScale = 0;
      } else if (currentDD >= maxDrawdownLimit * 0.7) {
        // v3.9: 70% 도달 시 포지션 50% 축소 (점진적)
        circuitScale = 0.5;
      } else if (circuitBroken && currentEq >= peakEquity * 0.97) {
        // v3.9: 97%까지 회복하면 50%로 재개, 99%에서 완전 해제
        circuitBroken = false;
        circuitScale = currentEq >= peakEquity * 0.99 ? 1.0 : 0.5;
      } else if (circuitBroken) {
        circuitScale = 0;
      }
    }

    // 시그널 처리
    while (sigIdx < sorted.length && sorted[sigIdx].index === i) {
      const sig = sorted[sigIdx];
      if (sig.type === "BUY" && position === 0 && lastAction !== "BUY" && circuitScale > 0) {
        const adaptiveSlip = getAdaptiveSlippage(i);
        const buyPrice = sig.price * (1 + adaptiveSlip);
        // v4.1: 리스크 적응 포지션 사이징 — 연속 손실 2회로 강화 (고변동 리스크 관리) + 서킷스케일 + 변동성 적응
        const riskFactor = (riskAdaptive && consecLosses >= 2) ? 0.5 : 1.0; // v4.1: 3→2 고변동장 조기 리스크 축소
        const volFactor = getVolSizingFactor(i);
        const investAmount = capital * positionSize * riskFactor * circuitScale * volFactor;
        const comm = investAmount * commission;
        position = (investAmount - comm) / buyPrice;
        entryPrice = buyPrice;
        trailingHigh = buyPrice;
        entryIndex = i; // v3.5
        tradeLow = c.low; tradeHigh = c.high; // v3.5: MAE/MFE 초기화
        capital -= investAmount;
        lastAction = "BUY";
        trades.push({ type: "BUY", index: i, price: buyPrice, qty: position, reason: sig.reason, time: c.time });
      } else if (sig.type === "SELL" && position > 0 && lastAction !== "SELL") {
        const adaptiveSellSlip = getAdaptiveSlippage(i);
        const sellPrice = sig.price * (1 - adaptiveSellSlip);
        const proceeds = position * sellPrice;
        const comm = proceeds * commission;
        const pnl = proceeds - comm - (position * entryPrice);
        const pnlPct = ((sellPrice / entryPrice) - 1) * 100;
        capital += proceeds - comm;
        // v3.6: 연속 손실 추적
        if (pnl <= 0) consecLosses++; else consecLosses = 0;
        // v3.5: MAE/MFE 기록
        const mae = entryPrice > 0 ? ((tradeLow - entryPrice) / entryPrice) * 100 : 0;
        const mfe = entryPrice > 0 ? ((tradeHigh - entryPrice) / entryPrice) * 100 : 0;
        const holdBars = i - entryIndex;
        trades.push({ type: "SELL", index: i, price: sellPrice, qty: position, pnl, pnlPct, reason: sig.reason, time: c.time, mae: +mae.toFixed(2), mfe: +mfe.toFixed(2), holdBars });
        position = 0; entryPrice = 0; trailingHigh = 0; entryIndex = -1; tradeLow = Infinity; tradeHigh = -Infinity; lastAction = "SELL";
      }
      sigIdx++;
    }

    // 자산 추적
    const eq = capital + (position > 0 ? position * c.close : 0);
    equity.push({ index: i, value: eq, time: c.time });
    if (eq > peakEquity) {
      peakEquity = eq;
      // v3.3: 낙폭 회복 시 지속 기간 리셋
      if (currentDDStart > 0) {
        maxDrawdownDuration = Math.max(maxDrawdownDuration, i - currentDDStart);
        currentDDStart = 0;
      }
    }
    const dd = peakEquity > 0 ? ((peakEquity - eq) / peakEquity) * 100 : 0;
    if (dd > maxDrawdown) {
      maxDrawdown = dd;
      if (currentDDStart === 0) currentDDStart = i;
    }
  }

  // 미청산 포지션 정리
  if (position > 0 && candles.length > 0) {
    const last = candles[candles.length - 1];
    const sellPrice = last.close * (1 - slippage);
    const proceeds = position * sellPrice;
    const comm = proceeds * commission;
    const pnl = proceeds - comm - (position * entryPrice);
    const pnlPct = ((sellPrice / entryPrice) - 1) * 100;
    capital += proceeds - comm;
    trades.push({ type: "SELL", index: candles.length - 1, price: sellPrice, qty: position, pnl, pnlPct, reason: "백테스트 종료 청산", time: last.time, mae: entryPrice > 0 ? +((tradeLow - entryPrice) / entryPrice * 100).toFixed(2) : 0, mfe: entryPrice > 0 ? +((tradeHigh - entryPrice) / entryPrice * 100).toFixed(2) : 0, holdBars: (candles.length - 1) - entryIndex });
    position = 0;
  }

  const finalEquity = capital;
  const sellTrades = trades.filter(t => t.type === "SELL");
  const winTrades = sellTrades.filter(t => t.pnl > 0);
  const loseTrades = sellTrades.filter(t => t.pnl <= 0);
  const totalTrades = sellTrades.length;
  const winRate = totalTrades > 0 ? (winTrades.length / totalTrades) * 100 : 0;
  const totalReturn = ((finalEquity - initialCapital) / initialCapital) * 100;
  const avgWin = winTrades.length > 0 ? winTrades.reduce((a, t) => a + t.pnlPct, 0) / winTrades.length : 0;
  const avgLoss = loseTrades.length > 0 ? loseTrades.reduce((a, t) => a + t.pnlPct, 0) / loseTrades.length : 0;

  // 샤프 비율
  const returns = sellTrades.map(t => t.pnlPct / 100);
  const avgReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
  const stdReturn = returns.length > 1
    ? Math.sqrt(returns.reduce((a, r) => a + (r - avgReturn) ** 2, 0) / (returns.length - 1)) : 0;
  const sharpeRatio = stdReturn > 0 ? (avgReturn / stdReturn) * Math.sqrt(252) : 0;

  // v3.3: 소르티노 비율 — 하방 변동성만 고려 (더 정확한 위험 대비 수익 측정)
  const downsideReturns = returns.filter(r => r < 0);
  const downsideDev = downsideReturns.length > 1
    ? Math.sqrt(downsideReturns.reduce((a, r) => a + r ** 2, 0) / downsideReturns.length) : 0;
  const sortinoRatio = downsideDev > 0 ? (avgReturn / downsideDev) * Math.sqrt(252) : 0;

  // v3.7: CAGR (복합 연간 성장률) — 정확한 연간화 수익률
  const tradingDays = candles.length;
  const years = tradingDays / 252;
  const cagr = years > 0 && finalEquity > 0
    ? (Math.pow(finalEquity / initialCapital, 1 / years) - 1) * 100 : 0;

  // v3.3: 칼마 비율 — CAGR / 최대낙폭 (v3.7: CAGR 기반으로 수정)
  const annualizedReturn = cagr; // v3.7: CAGR 사용
  const calmarRatio = maxDrawdown > 0 ? annualizedReturn / maxDrawdown : 0;

  // 프로핏 팩터
  const grossProfit = winTrades.reduce((a, t) => a + t.pnl, 0);
  const grossLoss = Math.abs(loseTrades.reduce((a, t) => a + t.pnl, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

  // Payoff Ratio
  const payoffRatio = avgWin && avgLoss !== 0 ? Math.abs(avgWin / avgLoss) : 0;

  // v3.5: Expectancy (기대값) — 트레이드당 평균 기대 수익률
  const expectancy = totalTrades > 0
    ? (winRate / 100) * (avgWin / 100) - ((100 - winRate) / 100) * Math.abs(avgLoss / 100) : 0;

  // 최대 연속 손실/승리
  let maxConsecLoss = 0, curConsecLoss = 0;
  let maxConsecWin = 0, curConsecWin = 0;
  sellTrades.forEach(t => {
    if (t.pnl <= 0) {
      curConsecLoss++; maxConsecLoss = Math.max(maxConsecLoss, curConsecLoss);
      curConsecWin = 0;
    } else {
      curConsecWin++; maxConsecWin = Math.max(maxConsecWin, curConsecWin);
      curConsecLoss = 0;
    }
  });

  // Buy & Hold 비교
  const bhReturn = candles.length >= 2
    ? ((candles[candles.length - 1].close - candles[0].close) / candles[0].close) * 100 : 0;

  const alpha = totalReturn - bhReturn;

  // v3.5: Recovery Factor — 총 수익률 / 최대 낙폭 (위기 회복 능력)
  const recoveryFactor = maxDrawdown > 0 ? totalReturn / maxDrawdown : 0;

  // v3.5: MAE/MFE 평균 — 거래 효율성 측정
  const sellTradesWithMAE = sellTrades.filter(t => t.mae != null);
  const avgMAE = sellTradesWithMAE.length > 0 ? sellTradesWithMAE.reduce((a, t) => a + t.mae, 0) / sellTradesWithMAE.length : 0;
  const avgMFE = sellTradesWithMAE.length > 0 ? sellTradesWithMAE.reduce((a, t) => a + t.mfe, 0) / sellTradesWithMAE.length : 0;
  const avgHoldBars = sellTradesWithMAE.length > 0 ? Math.round(sellTradesWithMAE.reduce((a, t) => a + (t.holdBars || 0), 0) / sellTradesWithMAE.length) : 0;

  // v4.0: 승리/패배 거래별 평균 보유 기간 분리 — 거래 효율성 심화 분석
  const avgWinHoldBars = winTrades.length > 0 ? Math.round(winTrades.reduce((a, t) => a + (t.holdBars || 0), 0) / winTrades.length) : 0;
  const avgLossHoldBars = loseTrades.length > 0 ? Math.round(loseTrades.reduce((a, t) => a + (t.holdBars || 0), 0) / loseTrades.length) : 0;

  // v4.0: 연간화 변동성 — 일별 수익률 표준편차 × √252
  const dailyReturns = [];
  for (let i = 1; i < equity.length; i++) {
    if (equity[i].value > 0 && equity[i - 1].value > 0) {
      dailyReturns.push(equity[i].value / equity[i - 1].value - 1);
    }
  }
  const annualizedVol = dailyReturns.length > 1
    ? +(Math.sqrt(dailyReturns.reduce((a, r) => a + (r - dailyReturns.reduce((s, v) => s + v, 0) / dailyReturns.length) ** 2, 0) / (dailyReturns.length - 1)) * Math.sqrt(252) * 100).toFixed(2)
    : 0;

  // v4.0: 월별 수익률 — 개선된 시계열 성과 분석 (각 월의 마지막 equity 값 사용)
  const monthlyReturns = {};
  if (equity.length > 0) {
    // 각 월의 마지막 equity 값을 수집
    const monthEndEquity = {};
    for (const eq of equity) {
      if (!eq.time) continue;
      const d = new Date(eq.time * 1000);
      const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      monthEndEquity[monthKey] = eq.value; // 마지막 값이 덮어씌워짐 → 월말 equity
    }
    const monthKeys = Object.keys(monthEndEquity).sort();
    let prevEq = initialCapital;
    for (const mk of monthKeys) {
      monthlyReturns[mk] = +((monthEndEquity[mk] / prevEq) * 100 - 100).toFixed(2);
      prevEq = monthEndEquity[mk];
    }
  }

  // v3.6: 월별 승률 계산 — 양수 수익률 달 / 전체 달
  const monthKeys = Object.keys(monthlyReturns);
  const positiveMonths = monthKeys.filter(k => monthlyReturns[k] > 0).length;
  const monthlyWinRate = monthKeys.length > 0 ? +(positiveMonths / monthKeys.length * 100).toFixed(1) : 0;

  return {
    initialCapital,
    finalEquity: +finalEquity.toFixed(2),
    totalReturn: +totalReturn.toFixed(2),
    buyHoldReturn: +bhReturn.toFixed(2),
    totalTrades,
    winRate: +winRate.toFixed(1),
    avgWin: +avgWin.toFixed(2),
    avgLoss: +avgLoss.toFixed(2),
    maxDrawdown: +maxDrawdown.toFixed(2),
    sharpeRatio: +sharpeRatio.toFixed(2),
    sortinoRatio: +sortinoRatio.toFixed(2),
    calmarRatio: +calmarRatio.toFixed(2),
    profitFactor: +profitFactor.toFixed(2),
    payoffRatio: +payoffRatio.toFixed(2),
    expectancy: +expectancy.toFixed(4),        // v3.5
    recoveryFactor: +recoveryFactor.toFixed(2), // v3.5
    avgMAE: +avgMAE.toFixed(2),                // v3.5
    avgMFE: +avgMFE.toFixed(2),                // v3.5
    avgHoldBars,                                // v3.5
    avgWinHoldBars,                             // v4.0
    avgLossHoldBars,                            // v4.0
    annualizedVol,                              // v4.0
    maxConsecLoss,
    maxConsecWin,
    alpha: +alpha.toFixed(2),
    maxDrawdownDuration,
    monthlyReturns,                             // v3.5
    monthlyWinRate,                             // v3.6
    cagr: +cagr.toFixed(2),                     // v3.7
    circuitBroken: circuitBrokenAt >= 0,        // v3.7
    circuitBrokenAt,                            // v3.7
    // v3.9: Ulcer Index — 낙폭의 지속성과 깊이를 측정 (낮을수록 좋음)
    ulcerIndex: (() => {
      if (equity.length < 2) return 0;
      let sumSqDD = 0;
      let peak = equity[0].value;
      for (const e of equity) {
        if (e.value > peak) peak = e.value;
        const dd = peak > 0 ? ((peak - e.value) / peak) * 100 : 0;
        sumSqDD += dd * dd;
      }
      return +(Math.sqrt(sumSqDD / equity.length)).toFixed(2);
    })(),
    // v3.9: UPI (Ulcer Performance Index) = 초과수익 / Ulcer Index
    upiRatio: (() => {
      if (equity.length < 2) return 0;
      let sumSqDD = 0;
      let peak = equity[0].value;
      for (const e of equity) {
        if (e.value > peak) peak = e.value;
        const dd = peak > 0 ? ((peak - e.value) / peak) * 100 : 0;
        sumSqDD += dd * dd;
      }
      const ui = Math.sqrt(sumSqDD / equity.length);
      return ui > 0 ? +((totalReturn - bhReturn) / ui).toFixed(2) : 0;
    })(),
    // v4.1: Omega Ratio — 임계수익률(0%) 대비 이익영역 합 / 손실영역 합 (높을수록 좋음)
    omegaRatio: (() => {
      if (returns.length < 2) return 0;
      const threshold = 0; // 임계 수익률 0%
      let gains = 0, losses = 0;
      for (const r of returns) {
        if (r > threshold) gains += (r - threshold);
        else losses += (threshold - r);
      }
      return losses > 0 ? +(gains / losses).toFixed(2) : (gains > 0 ? 99.99 : 0);
    })(),
    // v4.1: Tail Ratio — 95th percentile 이익 / 5th percentile 손실 (꼬리 위험 측정)
    tailRatio: (() => {
      if (returns.length < 10) return 0;
      const sorted = [...returns].sort((a, b) => a - b);
      const p5Idx = Math.floor(returns.length * 0.05);
      const p95Idx = Math.floor(returns.length * 0.95);
      const p5 = Math.abs(sorted[p5Idx]);
      const p95 = Math.abs(sorted[p95Idx]);
      return p5 > 0 ? +(p95 / p5).toFixed(2) : (p95 > 0 ? 99.99 : 0);
    })(),
    trades,
    equity,
  };
}

// ════════════════════════════════════════════════════════════════════
// 시장 진단 엔진
// ════════════════════════════════════════════════════════════════════

// v3.9: ADX 추세강도 + 4단계 변동성 + EMA10 단기모멘텀 + 공포/탐욕 프록시
export function diagnoseMarket(candles) {
  if (!candles || candles.length < 60) return { regime: "unknown", volatility: "unknown", trend: "unknown" };

  const closes = candles.map(c => c.close);
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  const last = closes.length - 1;

  // 추세 판단 (SMA + ADX 강도)
  const sma20 = calcSMA(closes, 20);
  const sma60 = calcSMA(closes, 60);
  const adx = calcADX(highs, lows, closes, 14);
  const adxLast = adx[last] || 0;
  let trend = "횡보";
  if (sma20[last] && sma60[last]) {
    if (sma20[last] > sma60[last] * 1.02) trend = "상승";
    else if (sma20[last] < sma60[last] * 0.98) trend = "하락";
  }
  // v3.9: ADX < 15이면 추세 약화 — 횡보로 강제 재분류
  const trendStrength = adxLast >= 30 ? "강" : adxLast >= 20 ? "보통" : "약";
  if (adxLast < 15 && trend !== "횡보") trend = "횡보";

  // v3.9: 4단계 변동성 판단 (매우 높음 추가, 기존 3→2.5 하향)
  const atr = calcATR(highs, lows, closes, 14);
  const atrLast = atr[last];
  const atrPct = atrLast && closes[last] ? (atrLast / closes[last]) * 100 : 0;
  let volatility = "보통";
  if (atrPct > 4.5) volatility = "매우 높음";
  else if (atrPct > 2.5) volatility = "높음";
  else if (atrPct > 1) volatility = "보통";
  else volatility = "낮음";

  // RSI + v3.9 단기 모멘텀 (EMA10 5봉 변화율)
  const rsi = calcRSI(closes);
  const rsiLast = rsi[last];
  const ema10 = calcEMA(closes, 10);
  const shortMom = ema10[last] && ema10[last - 5] ? ((ema10[last] / ema10[last - 5]) - 1) * 100 : 0;
  let momentum = "중립";
  if (rsiLast > 70) momentum = "과매수";
  else if (rsiLast < 30) momentum = "과매도";
  else if (rsiLast > 55 && shortMom > 0.5) momentum = "강세";
  else if (rsiLast < 45 && shortMom < -0.5) momentum = "약세";
  else if (rsiLast < 40) momentum = "약세"; // v3.9: RSI 40 이하는 약세로 분류

  // v3.9: 공포/탐욕 프록시 (RSI + 변동성 + 단기모멘텀 종합)
  const fearScore = Math.max(0, Math.min(100,
    50 - (rsiLast - 50) * 0.8 + (atrPct - 2) * 8 - shortMom * 3
  ));
  let sentiment = "중립";
  if (fearScore >= 75) sentiment = "극단적 공포";
  else if (fearScore >= 60) sentiment = "공포";
  else if (fearScore <= 25) sentiment = "극단적 탐욕";
  else if (fearScore <= 40) sentiment = "탐욕";

  // 시장 국면
  let regime = "혼조";
  if (trend === "상승" && volatility !== "높음" && volatility !== "매우 높음") regime = "안정적 상승";
  else if (trend === "상승" && (volatility === "높음" || volatility === "매우 높음")) regime = "변동성 상승";
  else if (trend === "하락" && (volatility === "높음" || volatility === "매우 높음")) regime = "급락";
  else if (trend === "하락" && volatility !== "높음" && volatility !== "매우 높음") regime = "완만한 하락";
  else if (trend === "횡보" && volatility === "낮음") regime = "저변동 횡보";
  else if (trend === "횡보" && (volatility === "높음" || volatility === "매우 높음")) regime = "변동성 횡보";

  return {
    regime, trend, volatility, momentum, atrPct: +atrPct.toFixed(2),
    rsi: rsiLast ? +rsiLast.toFixed(1) : null,
    adx: +adxLast.toFixed(1), trendStrength, // v3.9
    sentiment, fearScore: +fearScore.toFixed(0), // v3.9
    shortMom: +shortMom.toFixed(2), // v3.9
  };
}

// ════════════════════════════════════════════════════════════════════
// 전략 추천 엔진
// ════════════════════════════════════════════════════════════════════

export function recommendStrategies(marketDiagnosis) {
  const { regime, trend, volatility, momentum } = marketDiagnosis;
  const recs = [];

  // BTC 알파: 크립토 전용 (모든 시장 국면에서 높은 우선순위)
  recs.push({ strategy: strategyBTCAlpha, score: 10, reason: "₿ BTC 전용 멀티팩터 — 고변동성 크립토 시장 최적화 전략" });

  // ── 독자 알파 전략 (시장 국면 불문 추천) ──
  recs.push({ strategy: strategyHurst, score: 11, reason: "🧬 Hurst 레짐 스위칭 — 추세/회귀 국면 자동 전환" });
  recs.push({ strategy: strategyVolCluster, score: 10, reason: "⚡ 변동성 군집 돌파 — 압축→폭발 구간 포착" });
  recs.push({ strategy: strategyEfficiency, score: 10, reason: "📐 효율성 비율 — 추세 탄생/소멸 시점 감지" });
  recs.push({ strategy: strategyMomDecay, score: 10, reason: "📉 모멘텀 감쇠 — 고점/저점 반전 사전 포착" });
  recs.push({ strategy: strategyInfoFlow, score: 10, reason: "🔮 정보흐름 — 스마트머니 매집/분산 감지" });

  if (regime === "안정적 상승" || trend === "상승") {
    recs.push({ strategy: strategyMA, score: 9, reason: "상승 추세에서 이평선 크로스가 가장 효과적" });
    recs.push({ strategy: strategyIchimoku, score: 9, reason: "일목균형표 — 구름 위 추세 + 전환/기준 크로스" });
    recs.push({ strategy: strategyMACD, score: 8, reason: "추세 지속 확인에 MACD가 유용" });
    recs.push({ strategy: strategyTripleMA, score: 8, reason: "삼중 이평선 정배열로 추세 라이딩" });
    recs.push({ strategy: strategyHeikinAshi, score: 8, reason: "HA 캔들 노이즈 제거 — 추세 라이딩 최적" });
    recs.push({ strategy: strategySupertrend, score: 8, reason: "슈퍼트렌드 상향 — ATR 기반 추세 확인" });
    recs.push({ strategy: strategyParabolicSAR, score: 7, reason: "파라볼릭 SAR — 추세 동행 + 동적 손절" });
    recs.push({ strategy: strategyDualMomentum, score: 7, reason: "듀얼 모멘텀으로 절대/상대 강세 확인" });
    recs.push({ strategy: strategyVolume, score: 7, reason: "거래량 돌파로 강한 모멘텀 포착" });
    recs.push({ strategy: strategyOBV, score: 7, reason: "OBV 상향돌파 — 스마트머니 추적" });
    recs.push({ strategy: strategyChannelMomentum, score: 7, reason: "채널 돌파 + ADX + 거래량 삼중 필터" });
    recs.push({ strategy: strategyMACDDivergence, score: 6, reason: "MACD 다이버전스 — 추세 약화 경고" });
  }

  if (regime === "저변동 횡보" || trend === "횡보") {
    recs.push({ strategy: strategyBB, score: 9, reason: "횡보장에서 볼린저밴드 바운스가 최적" });
    recs.push({ strategy: strategyStatArb, score: 9, reason: "Z-Score 평균회귀 — 횡보장 최적 전략" });
    recs.push({ strategy: strategyMFI, score: 8, reason: "MFI 자금유입 — 거래량 가중 과매도 매수" });
    recs.push({ strategy: strategyConnorsRSI2, score: 8, reason: "RSI(2) 극단값 — 초단기 평균회귀" });
    recs.push({ strategy: strategyKeltner, score: 8, reason: "켈트너 채널 회귀도 횡보장에 효과적" });
    recs.push({ strategy: strategyRSI, score: 8, reason: "RSI 반전이 레인지바운드에서 효과적" });
    recs.push({ strategy: strategyVWAP, score: 8, reason: "VWAP 반전 — 기관 매집 가능성 포착" });
    recs.push({ strategy: strategyCandlePattern, score: 7, reason: "엔궐핑 + 해머 패턴 — 횡보장 반전 포착" });
    recs.push({ strategy: strategyRegimeSwitch, score: 7, reason: "횡보장 감지 → 자동 RSI 회귀 전환" });
    recs.push({ strategy: strategyFibonacci, score: 7, reason: "피보나치 되돌림 구간에서 지지 확인" });
    recs.push({ strategy: strategyCombo, score: 7, reason: "이중 필터로 가짜 신호 제거" });
    recs.push({ strategy: strategyBBSqueeze, score: 6, reason: "스퀴즈 후 돌파 가능성 대비" });
    recs.push({ strategy: strategySwingATR, score: 6, reason: "ATR 기반 스윙 구간 트레이딩" });
    recs.push({ strategy: strategyCCI, score: 6, reason: "CCI 오실레이터 — 횡보 구간 극단값 포착" });
  }

  if (momentum === "과매도" || regime === "급락") {
    recs.push({ strategy: strategyRSI, score: 10, reason: "과매도 구간 — RSI 반전 최적 진입" });
    recs.push({ strategy: strategyMFI, score: 9, reason: "MFI 과매도 — 자금유입 전환 매수" });
    recs.push({ strategy: strategyConnorsRSI2, score: 9, reason: "RSI(2) 극단 과매도 — 래리 코너스 반전 매수" });
    recs.push({ strategy: strategyStatArb, score: 9, reason: "Z-Score -2σ 이하 이탈 — 통계적 반등" });
    recs.push({ strategy: strategyCombo, score: 9, reason: "RSI+스토캐스틱 이중 확인 바닥 매수" });
    recs.push({ strategy: strategyCandlePattern, score: 8, reason: "해머/엔궐핑 — 급락 후 반전 캔들 포착" });
    recs.push({ strategy: strategyWilliamsADX, score: 8, reason: "Williams %R + ADX로 추세 내 저점" });
    recs.push({ strategy: strategyMACDDivergence, score: 7, reason: "강세 다이버전스 — 바닥 전환 시그널" });
    recs.push({ strategy: strategyBB, score: 7, reason: "BB 하단 터치 반등 가능성" });
    recs.push({ strategy: strategyFibonacci, score: 7, reason: "피보나치 61.8% 되돌림 지지 확인" });
    recs.push({ strategy: strategyVWAP, score: 6, reason: "VWAP 하단 이탈 후 복귀 매수" });
  }

  if (volatility === "높음" || volatility === "매우 높음") {
    recs.push({ strategy: strategyVolume, score: 8, reason: "높은 변동성에서 거래량 돌파가 강한 시그널" });
    recs.push({ strategy: strategySupertrend, score: 8, reason: "슈퍼트렌드 — 고변동 시장 추세 추종" });
    recs.push({ strategy: strategyBBSqueeze, score: 7, reason: "변동성 압축 후 폭발 포착" });
    recs.push({ strategy: strategyTurtle, score: 7, reason: "터틀 트레이딩 — 변동성 돌파" });
    recs.push({ strategy: strategySwingATR, score: 7, reason: "ATR 스윙 — 변동성 구간 트레이딩" });
    recs.push({ strategy: strategyChannelMomentum, score: 7, reason: "채널 돌파 + ADX 필터 — 노이즈 제거" });
    recs.push({ strategy: strategyParabolicSAR, score: 6, reason: "파라볼릭 SAR — 동적 추세 추종 + 손절" });
    recs.push({ strategy: strategyGapAndGo, score: 6, reason: "갭 앤 고 — 단기 모멘텀 포착" });
  }

  // v3.9: 공포 구간 전용 추천 — 극단적 공포 시 역발상 매수 강화
  const { sentiment, fearScore: fScore } = marketDiagnosis;
  if (sentiment === "극단적 공포" || (fScore && fScore >= 70)) {
    recs.push({ strategy: strategyRSI, score: 10, reason: "극단적 공포 구간 — RSI 반전 역발상 매수 최적" });
    recs.push({ strategy: strategyConnorsRSI2, score: 9, reason: "RSI(2) 극단값 — 공포 매수 최적" });
    recs.push({ strategy: strategyStatArb, score: 9, reason: "Z-Score 극단 이탈 — 통계적 반등 확률 높음" });
    recs.push({ strategy: strategyMFI, score: 8, reason: "MFI 자금유입 전환 — 스마트머니 감지" });
  }
  if (sentiment === "극단적 탐욕" || (fScore && fScore <= 20)) {
    recs.push({ strategy: strategyBB, score: 9, reason: "극단적 탐욕 — BB 상단 이탈 매도 시그널" });
    recs.push({ strategy: strategyRSI, score: 8, reason: "과매수 구간 — RSI 반전 매도 유력" });
    recs.push({ strategy: strategyMACDDivergence, score: 8, reason: "약세 다이버전스 — 고점 경고" });
  }

  if (trend === "하락" && volatility !== "높음") {
    recs.push({ strategy: strategyMACD, score: 7, reason: "하락 추세 전환 포착에 MACD 유용" });
    recs.push({ strategy: strategyHeikinAshi, score: 7, reason: "HA 캔들 반전 패턴 — 하락 추세 종료 감지" });
    recs.push({ strategy: strategyConnorsRSI2, score: 7, reason: "RSI(2) 과매도 — 단기 반등 포착" });
    recs.push({ strategy: strategyMFI, score: 7, reason: "MFI 과매도 — 자금유입 전환 감지" });
    recs.push({ strategy: strategyMACDDivergence, score: 7, reason: "강세 다이버전스 — 바닥 형성 시그널" });
    recs.push({ strategy: strategyRSI, score: 6, reason: "과매도 반등 가능성 모니터링" });
    recs.push({ strategy: strategyKeltner, score: 6, reason: "켈트너 채널 하단 바운스" });
    recs.push({ strategy: strategyOBV, score: 6, reason: "OBV 반전 — 바닥 형성 확인" });
    recs.push({ strategy: strategyStatArb, score: 6, reason: "Z-Score 이탈 → 평균회귀 기대" });
    recs.push({ strategy: strategyCandlePattern, score: 6, reason: "엔궐핑/해머 — 하락장 반전 패턴" });
  }

  // 추가 추천 (추세 + 변동성 조합)
  if (trend === "상승") {
    recs.push({ strategy: strategyDualTimeframe, score: 8, reason: "상승 추세 풀백 매수 — 듀얼 타임프레임 최적" });
    recs.push({ strategy: strategyElderTriple, score: 8, reason: "삼중 필터 확인 — 신뢰도 높은 상승 진입" });
    recs.push({ strategy: strategyMomVolWeight, score: 7, reason: "모멘텀 + 거래량 가중 — 상승 가속 포착" });
    recs.push({ strategy: strategyCCI, score: 7, reason: "CCI 상향돌파 — 모멘텀 가속 확인" });
  }
  if (volatility === "높음") {
    recs.push({ strategy: strategyElderTriple, score: 7, reason: "삼중 필터 — 고변동성에서 가짜 신호 제거" });
    recs.push({ strategy: strategyDualTimeframe, score: 6, reason: "장기 추세 확인 후 단기 진입" });
  }

  // 중복 제거 + 점수 순 정렬
  const seen = new Set();
  return recs.filter(r => {
    if (seen.has(r.strategy.id)) return false;
    seen.add(r.strategy.id); return true;
  }).sort((a, b) => b.score - a.score).slice(0, 8);
}

// ════════════════════════════════════════════════════════════════════
// QA 검증
// ════════════════════════════════════════════════════════════════════

export function validateSignals(signals) {
  const issues = [];
  let lastBuy = null;
  for (const sig of signals) {
    if (sig.type === "BUY") {
      if (lastBuy) issues.push(`중복 매수 시그널 at index ${sig.index}`);
      lastBuy = sig;
    } else if (sig.type === "SELL") {
      if (!lastBuy) issues.push(`매수 없이 매도 시그널 at index ${sig.index}`);
      lastBuy = null;
    }
  }
  return { valid: issues.length === 0, issues };
}
