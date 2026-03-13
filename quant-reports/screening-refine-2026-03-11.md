# 스크리닝 옵션 고도화 및 정제 보고서
**날짜**: 2026-03-11 (화) 20:00
**분석 대상**: `analyzeAsset()` (L553-693) + `quickDiagnosis()` (L1076-1200)

---

## 1. 현재 로직 구조 요약

### analyzeAsset — 16개 스크리닝 조건
| 카테고리 | 조건 | 현재 로직 |
|---------|------|----------|
| 모멘텀 | rsi_extreme | RSI ≤ 25 또는 ≥ 75 |
| 모멘텀 | macd_divergence | 가격 2주 방향 vs MACD-Signal 방향 비교 |
| 추세 | ma_ribbon | MA20 > MA50 > MA200 정배열 or 역배열 |
| 추세 | adx_trend | ADX ≥ 25 |
| 변동성 | bb_squeeze | 밴드폭 52주 최저 × 1.05 이내 |
| 변동성 | atr_breakout | 당주 변동폭 > ATR × 2 |
| 가격구조 | price_channel | 52주 고/저 근접 |
| 가격구조 | gap_signal | 주간변화 ±3% |
| 수급 | volume_climax | volRatio ≥ 3 |
| 수급 | obv_divergence | 4주 가격추세 vs OBV추세 불일치 |
| 수급 | volume_dry | volRatio ≤ 0.3 |
| 밸류에이션 | near_52w_low | 52주 저가 대비 5% 이내 |
| 밸류에이션 | near_52w_high | 52주 고가 대비 2% 이내 |
| 추세전환 | death_cross | MA50 < MA200 (현재 상태) |
| 추세전환 | golden_cross | MA50 > MA200 (현재 상태) |
| 평균회귀 | mean_reversion | 200일선 대비 ±15% 이탈 |

### quickDiagnosis — 4축 가중평균 (100점 만점)
- 추세 30% / 모멘텀 30% / 수급 20% / 위치 20%

---

## 2. 정확도 평가 — 발견된 문제점

### 🔴 P1 (높은 우선순위)

#### 2-1. MACD 다이버전스 로직 오류 (L638-646)
**현재**: 지난 2주 가격 방향 vs `macd.macdLine` vs `macd.signalLine` 비교
**문제**: 이것은 진정한 다이버전스가 아님. 실제 다이버전스는 가격의 고점/저점 시퀀스와 MACD 고점/저점 시퀀스를 비교하는 것.
- 현재 코드에서 `prevMacdVal = macd.signalLine`으로 대입하는데, 이것은 이전 MACD 값이 아니라 현재 시그널 값임
- 결과적으로 "MACD > Signal이면 상승" 정도의 의미밖에 없음 → **false positive 다량 발생 가능**

**개선안**:
```javascript
// MACD 히스토리 배열을 보존하고, 최근 N주의 peak/trough를 비교
function detectMACDDivergence(weeklyCloses, macdHistory) {
  // 1) 최근 12주간 가격 swing high/low 찾기
  // 2) 해당 시점의 MACD swing high/low 찾기
  // 3) 가격 higher-high + MACD lower-high → bearish divergence
  // 4) 가격 lower-low + MACD higher-low → bullish divergence
  // 최소 2개의 피크/트러프 필요
}
```

#### 2-2. Golden/Death Cross — "이벤트"가 아닌 "상태" 감지 (L659-663)
**현재**: `ma50daily > ma200daily` 여부만 확인
**문제**: 3개월 전에 발생한 골든크로스도 계속 트리거됨. 실제 트레이딩에서는 **크로스오버 시점**이 중요.

**개선안**:
```javascript
// 이전 주와 현재 주의 MA50-MA200 관계 변화를 추적
const prevMA50 = calcSMA(dailyCloses.slice(0, -5), 50);
const prevMA200 = calcSMA(dailyCloses.slice(0, -5), 200);
const goldenCross = prevMA50 <= prevMA200 && ma50daily > ma200daily; // 실제 크로스
const deathCross = prevMA50 >= prevMA200 && ma50daily < ma200daily;
// 또는 최근 N주 이내에 크로스가 발생했는지 확인
```

### 🟡 P2 (중간 우선순위)

#### 2-3. OBV 다이버전스 — 룩백 기간 부족 (L627-633)
**현재**: 4주 룩백
**문제**: 4주는 주간 차트에서 너무 짧음. 의미 있는 다이버전스는 최소 8-12주 필요.

**개선안**:
- 룩백을 8주로 확장
- 선형회귀 기울기로 추세 비교 (단순 시작-끝 비교 대신)

#### 2-4. Gap Signal 크립토 과잉 트리거 (L619)
**현재**: 주간 변화 ±3%
**문제**: BTC조차 주간 3% 변동이 일상적. 크립토에서는 거의 항상 트리거되어 의미 상실.

**개선안**:
```javascript
// 마켓 유형별 동적 임계값
const gapThreshold = market === "crypto" ? 8 : market === "kr" ? 4 : 3;
const gapSignal = Math.abs(weekChange) >= gapThreshold;
```

#### 2-5. quickDiagnosis RSI 점수 비연속성 (L1107-1114)
**현재**: RSI 30~45 → momScore -4 (약간 부정) / RSI 20~30 → momScore +12 (강한 긍정)
**문제**: RSI 31 (-4) vs RSI 29 (+12)에서 16점 점프 발생. 그라데이션 없이 급격히 변함.

**개선안**:
```javascript
// 연속적 스코어링
if (asset.rsi >= 30 && asset.rsi < 40) momScore += 0;      // 중립
else if (asset.rsi >= 20 && asset.rsi < 30) momScore += 8;  // 과매도 반등
else if (asset.rsi < 20) momScore += 16;                     // 극단 과매도
```

### 🟢 P3 (낮은 우선순위 / 향후 고려)

#### 2-6. BB 스퀴즈 — Keltner Channel 미사용
현재 밴드폭만으로 스퀴즈 판단. John Carter 방식의 BB-inside-KC 스퀴즈가 더 정확.

#### 2-7. ADX 방향성 미활용 (L657)
**현재**: `adx >= 25`만 확인
**문제**: ADX가 강한 추세를 나타내지만, +DI/-DI 비교 없이 방향을 알 수 없음.
`calcSimpleADX`는 이미 `plusDI`, `minusDI`를 반환하고 있으나 `analyzeAsset`에서 활용 안 함.

**개선안**:
```javascript
const adxTrend = adxResult && adxResult.adx >= 25;
const adxBullish = adxTrend && adxResult.plusDI > adxResult.minusDI;
const adxBearish = adxTrend && adxResult.minusDI > adxResult.plusDI;
// quickDiagnosis에서도 방향에 따라 점수 차별화
```

---

## 3. 신규 지표 추가 제안

### 3-1. CMF (Chaikin Money Flow) — **추천도: ★★★★★**
매집/분산을 OBV보다 정밀하게 측정. 20주 윈도우 사용.
```javascript
function calcCMF(highs, lows, closes, volumes, period = 20) {
  if (closes.length < period) return null;
  let mfvSum = 0, volSum = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const clv = highs[i] === lows[i] ? 0 :
      ((closes[i] - lows[i]) - (highs[i] - closes[i])) / (highs[i] - lows[i]);
    mfvSum += clv * volumes[i];
    volSum += volumes[i];
  }
  return volSum > 0 ? mfvSum / volSum : 0;
}
// 스크리닝 조건: CMF > 0.1 → 강한 매집, CMF < -0.1 → 강한 분산
```

### 3-2. MFI (Money Flow Index) — **추천도: ★★★★**
"거래량 가중 RSI"로 과매수/과매도를 볼륨과 함께 판단.
```javascript
function calcMFI(highs, lows, closes, volumes, period = 14) {
  if (closes.length < period + 1) return null;
  let posFlow = 0, negFlow = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const tp = (highs[i] + lows[i] + closes[i]) / 3;
    const prevTp = (highs[i-1] + lows[i-1] + closes[i-1]) / 3;
    const rawFlow = tp * volumes[i];
    if (tp > prevTp) posFlow += rawFlow;
    else negFlow += rawFlow;
  }
  return negFlow === 0 ? 100 : 100 - 100 / (1 + posFlow / negFlow);
}
// MFI < 20 과매도 (거래량 동반), MFI > 80 과매수
```

### 3-3. ROC (Rate of Change) — **추천도: ★★★**
단순하지만 모멘텀 가속/감속 판단에 유용.
```javascript
function calcROC(closes, period = 12) {
  if (closes.length < period + 1) return null;
  return ((closes[closes.length - 1] - closes[closes.length - 1 - period])
    / closes[closes.length - 1 - period]) * 100;
}
// 12주 ROC > 20% → 강한 모멘텀, ROC 방향 전환 → 추세 변화 조기 감지
```

### 3-4. 다중 타임프레임 확인 (Multi-Timeframe Confirmation) — **추천도: ★★★★★**
현재 주간 데이터만 사용. 일간 + 주간 동시 확인으로 신뢰도 대폭 향상 가능.
```javascript
// 예: RSI를 주간 + 일간 동시 확인
const weeklyRSI = calcRSI(weeklyCloses, 14);
const dailyRSI = calcRSI(dailyCloses, 14);
const rsiConfirmed = weeklyRSI <= 30 && dailyRSI <= 35; // 양 타임프레임 과매도
```

---

## 4. 가중치 & 스코어링 시스템 개선

### 4-1. 현재 quickDiagnosis 가중치 문제
| 카테고리 | 현재 가중치 | 제안 가중치 | 이유 |
|---------|-----------|-----------|------|
| 추세 | 30% | 35% | 추세가 가장 강력한 예측자 |
| 모멘텀 | 30% | 25% | 추세와 중복 요소 있음 |
| 수급 | 20% | 25% | 거래량 분석 과소평가됨 |
| 위치 | 20% | 15% | 52주 위치는 보조지표 |

### 4-2. 시장 유형별 적응 가중치 제안
```javascript
// 크립토: 모멘텀 & 수급 중시 (추세 짧고 변동성 큼)
const cryptoWeights = { trend: 0.25, momentum: 0.30, supply: 0.30, position: 0.15 };
// 미국주식: 추세 & 위치 중시 (기관 주도, 안정적 추세)
const usWeights = { trend: 0.35, momentum: 0.25, supply: 0.20, position: 0.20 };
// 한국주식: 수급 중시 (외국인/기관 수급이 핵심)
const krWeights = { trend: 0.30, momentum: 0.25, supply: 0.30, position: 0.15 };
```

---

## 5. 우선순위별 구현 로드맵

| 순서 | 항목 | 난이도 | 예상 효과 |
|------|------|--------|----------|
| 1 | MACD 다이버전스 로직 수정 | 중 | false positive 60%+ 감소 예상 |
| 2 | Golden/Death Cross → 이벤트 감지 | 하 | 불필요 알림 대폭 감소 |
| 3 | Gap Signal 마켓별 임계값 | 하 | 크립토 과잉 트리거 해소 |
| 4 | RSI 점수 연속화 | 하 | 점수 신뢰도 향상 |
| 5 | ADX +DI/-DI 방향 활용 | 하 | 추세 방향 정보 추가 |
| 6 | CMF 지표 추가 | 중 | 매집/분산 정밀 탐지 |
| 7 | 다중 타임프레임 확인 | 중 | 전체 신호 신뢰도 향상 |
| 8 | 시장별 적응 가중치 | 중 | 시장 특성 반영 |

---

## 6. 결론

현재 시스템은 16개 기술적 조건과 4축 스코어링으로 충실한 기반을 갖추고 있음. 가장 시급한 개선은 MACD 다이버전스 로직 정정(현재 사실상 의미 없는 신호 생성)과 Golden/Death Cross의 이벤트 감지 전환. 이 두 가지만 수정해도 스크리닝 정확도가 체감적으로 향상될 것으로 판단됨.

중기적으로 CMF 추가와 다중 타임프레임 확인이 가장 높은 ROI를 제공할 것으로 예상.
