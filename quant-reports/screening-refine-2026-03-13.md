# 스크리닝 옵션 고도화 및 정제 보고서
**날짜**: 2026-03-13 (금) 20:00
**분석 대상**: `analyzeAsset()` (L660-982) + `quickDiagnosis()` (L1406-1566)
**전일 보고서**: screening-refine-2026-03-12.md

---

## 1. 전일 개선 항목 구현 현황

### ✅ 구현 완료 (8/8 — 전일 대비 2건 추가)
| 항목 | 상태 | 구현 위치 |
|------|------|----------|
| P1: MACD 다이버전스 → `calcMACDHistogram` | ✅ 구현 | L576-595 (1회 계산 + slice) |
| P1: MACD 성능 최적화 | ✅ 구현 | L826 (기존 24회 반복 → 1회) |
| P2: OBV 다이버전스 룩백 8주 + 선형회귀 | ✅ 구현 | L763-779 |
| P2: Gap Signal 마켓별 동적 임계값 | ✅ 구현 | L752-755 (crypto 8%, kr 4%, us 3%) |
| P2: RSI 점수 연속 그라데이션 | ✅ 구현 | L1437-1448 (10단계 세분화) |
| P3: ADX +DI/-DI 방향성 활용 | ✅ 구현 | L910-913, L1493-1495 |
| P3: 거래량 클라이맥스 방향 구분 | ✅ 구현 | L1472-1474 (매집/투매 분리) |
| P3: 52주 신고가 점수 충돌 해소 | ✅ 구현 | L1505 (98%+weekChange>0 면제) |

### ✅ 신규 기능 추가 완료
| 기능 | 구현 위치 | quickDiagnosis 반영 |
|------|----------|-------------------|
| RSI 다이버전스 (peak/trough 비교) | L856-890 | ✅ L1485-1486 (±8점) |
| 볼륨 프로파일 POC 근접 | L892-900 | ✅ L1514-1518 (±4~6점) |
| `near_poc` 스크리닝 조건 | L964 | ✅ CONDITION_META L1017 |
| `rsi_divergence` 스크리닝 조건 | L963 | ✅ CONDITION_META L1016 |

---

## 2. 전일 보고서 오류 정정 (중요)

### ⚠️ 전일 P2-3, P2-4, P2-5는 **오탐(false positive)**이었음

전일 보고서에서 Stochastic 타입 오류(P2-3), Williams %R 타입 오류(P2-4), Golden/Death Cross 배열 비교(P2-5)를 버그로 식별했으나, **이는 잘못된 분석이었음**.

**원인**: `strategies.js`의 함수(배열 반환)와 `App.jsx`의 로컬 함수(스칼라 반환)를 혼동

| 함수 | strategies.js (배열) | App.jsx 로컬 (스칼라) | 실제 사용 |
|------|---------------------|---------------------|----------|
| `calcRSI` | L25-42: `Array` | L493-507: `number` | ✅ 스칼라 |
| `calcSMA` | L9-13: `Array` | L544-547: `number` | ✅ 스칼라 |
| `calcStochastic` | L63-77: `{k: Array, d: Array}` | L597-609: `{k: number, d: number}` | ✅ 스칼라 |
| `calcWilliamsR` | L135-142: `Array` | L611-617: `number` | ✅ 스칼라 |

App.jsx는 자체 로컬 함수를 정의하여 strategies.js의 배열 반환 함수를 **섀도잉(shadowing)**하고 있음. `analyzeAsset`에서 호출되는 모든 calc 함수는 App.jsx 로컬 버전(스칼라 반환)을 사용하므로, 전일 보고서의 타입 오류 지적은 유효하지 않음.

**교훈**: 향후 분석 시 import 경로와 로컬 함수 섀도잉을 반드시 확인할 것.

---

## 3. 신규 발견 문제점

### 🟡 P2 (중간 우선순위)

#### 3-1. MACD 다이버전스가 quickDiagnosis 점수에 미반영

**현재 코드**:
- RSI 다이버전스: ✅ L1485-1486에서 momScore ±8 반영
- MACD 다이버전스: ❌ quickDiagnosis에서 `asset.macdDivType`를 **참조하지 않음**
- `macdDivType`는 L1263-1264에서 라벨 렌더링에만 사용

**영향**: MACD 다이버전스는 스크리닝 트리거 목록에만 표시되고, 종합 점수(score)에는 반영되지 않음. 강한 반전 신호인 MACD 다이버전스가 "매수/매도" 판정에 기여하지 못함.

**수정안** (quickDiagnosis 내부, RSI 다이버전스 블록 이후):
```javascript
// MACD 다이버전스 반영 — RSI보다 중장기 신뢰도 높음
if (asset.macdDivType === "bullish") { momScore += 10; signals.push({ type: "bullish", name: "MACD 강세 다이버전스" }); }
else if (asset.macdDivType === "bearish") { momScore -= 10; signals.push({ type: "bearish", name: "MACD 약세 다이버전스" }); }
```
RSI(±8)보다 MACD(±10)에 더 높은 가중치를 부여하는 이유: MACD 다이버전스는 더 긴 룩백을 사용하므로 중장기 추세 반전에 대한 신뢰도가 높음.

#### 3-2. Golden/Death Cross "이벤트" 감지가 quickDiagnosis에 미반영

**현재**:
- quickDiagnosis L1423-1428: MA50 vs MA200의 **정적 관계**만 평가 (골든크로스 구간 vs 데드크로스 구간)
- analyzeAsset L917-937: Golden/Death Cross **이벤트**(최근 발생 여부)를 별도로 감지
- 하지만 이 이벤트 데이터가 quickDiagnosis에 전달/활용되지 않음

**영향**: "방금 골든크로스가 발생한 종목"과 "이미 6개월째 골든크로스 구간인 종목"이 동일한 점수를 받음. 신선한 크로스 이벤트의 강한 시그널 가치가 사라짐.

**수정안** (analyzeAsset 반환값에 추가 + quickDiagnosis에서 활용):
```javascript
// analyzeAsset return에 추가
goldenCross, deathCross,

// quickDiagnosis에서 활용
if (asset.goldenCross) { trendScore += 12; signals.push({ type: "bullish", name: "골든크로스 발생 (4주 이내)" }); }
if (asset.deathCross) { trendScore -= 12; signals.push({ type: "bearish", name: "데스크로스 발생 (4주 이내)" }); }
```

### 🟢 P3 (낮은 우선순위 / 향후 연구)

#### 3-3. OBV 다이버전스 룩백 8주 — 학술적 기준 대비 짧음

**현재** (L765): `const obvLookback = Math.min(obvArr.length, 8);`
**학술 문헌**: OBV 다이버전스는 통상 13~26주 룩백 권장 (Joseph Granville 원전)

8주 룩백은 노이즈에 취약하며, 특히 횡보장에서 오탐 빈도가 높아질 수 있음.

**수정안**: 13주로 확대 + 최소 룩백 검증 강화
```javascript
const obvLookback = Math.min(obvArr.length, 13);
// ... (기존 로직 동일, 4 → 6으로 최소 검증 상향)
if (obvArr.length >= obvLookback && obvLookback >= 6) {
```

#### 3-4. 함수 이중 정의 구조의 유지보수 리스크

App.jsx에 `calcRSI`, `calcSMA`, `calcStochastic` 등이 strategies.js와 동일 이름으로 로컬 정의되어 있음. 의도적인 설계이나:
- strategies.js 수정 시 App.jsx 로컬 함수와의 동기화 누락 가능
- 새로운 개발자가 strategies.js 함수가 사용되는 것으로 착각할 수 있음 (전일 보고서의 오탐 원인)

**제안**: 주석을 통한 명시적 구분 또는 네이밍 컨벤션 도입
```javascript
// ═══ App.jsx 전용: 스칼라 반환 (마지막 값만) ═══
// strategies.js의 동명 함수는 배열을 반환하므로 혼동 주의
function calcRSI(closes, period = 14) { ... }
```
또는 함수명 변경: `calcRSILast`, `calcSMALast` 등으로 의도를 명확히.

---

## 4. 신규 지표/기능 제안 (다음 단계)

### 4-1. 다이버전스 복합 시그널 — 추천도: ★★★★★
RSI + MACD 다이버전스가 동시에 발생하면 신뢰도가 극적으로 상승. 복합 다이버전스 스크리닝 조건 추가.
```javascript
// 스크리닝 조건: "dual_divergence"
// RSI bullish + MACD bullish 동시 → 강한 바닥 신호
// RSI bearish + MACD bearish 동시 → 강한 천장 신호
const dualBullishDiv = rsiDivType === "bullish" && macdDivType === "bullish";
const dualBearishDiv = rsiDivType === "bearish" && macdDivType === "bearish";
```
quickDiagnosis 가중치: ±15점 (개별 다이버전스보다 높은 확신)

### 4-2. Supertrend 기반 스크리닝 — 추천도: ★★★★
strategies.js에 `strategySupertrend` (L742)이 이미 구현되어 있으나 스크리닝 조건으로 활용되지 않음. Supertrend 방향 전환은 명확한 추세 전환 신호.
```javascript
// analyzeAsset에 supertrend 상태 추가
// supertrend_bullish: ATR 기반 Supertrend가 가격 아래로 전환
// supertrend_bearish: ATR 기반 Supertrend가 가격 위로 전환
```

### 4-3. CCI (Commodity Channel Index) 스크리닝 — 추천도: ★★★★
strategies.js에 `strategyCCI` (L1130) 구현 완료. CCI ±200 극단값은 강한 과매수/과매도 신호로 RSI/MFI를 보완.
```javascript
// cci_extreme 조건: CCI > 200 또는 CCI < -200
// quickDiagnosis: momScore ±6
```

### 4-4. Ichimoku 구름대 스크리닝 — 추천도: ★★★
strategies.js에 `strategyIchimoku` (L616) 구현 완료. 가격이 구름대 위/아래인지, 구름대 두께(추세 강도)를 스크리닝 조건으로 활용 가능.

### 4-5. ROC (Rate of Change) — 추천도: ★★★
여전히 미구현. 12주/26주 ROC는 모멘텀 강도를 직관적으로 측정. `calcSMA` 패턴으로 간단히 구현 가능.
```javascript
const roc12 = weeklyCloses.length >= 13
  ? ((price - weeklyCloses[weeklyCloses.length - 13]) / weeklyCloses[weeklyCloses.length - 13]) * 100
  : null;
```

### 4-6. 백테스트 성과 기반 스크리닝 가중치 — 추천도: ★★★★★
현재 quickDiagnosis의 가중치(추세 35%, 모멘텀 25%, 수급 20%, 위치 20%)는 고정값. `runBacktest` 결과(승률, 샤프비율)를 종목별로 누적하여 가중치를 동적으로 조정하면 점수의 예측력이 향상될 수 있음.

---

## 5. 구현 우선순위 로드맵

| 순서 | 항목 | 난이도 | 예상 효과 | 긴급도 |
|------|------|--------|----------|--------|
| 1 | **MACD div → quickDiagnosis** (P2) | 하 | 종합 점수 정확도 향상 (±10점) | 🟡 높음 |
| 2 | **Golden/Death Cross 이벤트 보너스** (P2) | 하 | 신선한 크로스 정확 반영 (+12점) | 🟡 높음 |
| 3 | 다이버전스 복합 시그널 (신규) | 하 | 강한 반전 포착 (±15점) | 🟢 보통 |
| 4 | OBV 룩백 13주 확대 (P3) | 하 | 오탐 감소 | 🟢 보통 |
| 5 | Supertrend 스크리닝 조건 (신규) | 중 | 추세 전환 감지 추가 | 🟢 보통 |
| 6 | CCI 극단값 스크리닝 (신규) | 하 | 과매수/과매도 보완 | 🟢 보통 |
| 7 | ROC 지표 추가 (신규) | 하 | 모멘텀 직관성 향상 | 🟢 낮음 |
| 8 | 백테스트 기반 가중치 (신규) | 상 | 예측력 대폭 향상 | 🟢 낮음 |

---

## 6. 코드 품질 노트

### 긍정적 변화
- `calcMACDHistogram` 분리로 MACD 다이버전스가 정상 작동 (전일 P1 해결)
- RSI 다이버전스 + 볼륨 프로파일 POC 추가로 스크리닝 조건이 24개로 확대
- 거래량 클라이맥스 방향 구분으로 quickDiagnosis 정확도 향상
- 52주 신고가 점수 충돌 해소로 모멘텀 브레이크아웃 감지 개선

### 아키텍처 관찰
App.jsx의 로컬 calc 함수(스칼라 반환)와 strategies.js의 동명 함수(배열 반환)가 공존하는 구조는 기능적으로 정상이나, 유지보수 시 혼동 가능성이 있음. 코드 코멘트 또는 네이밍 컨벤션으로 보완 권장.

---

## 7. 결론

전일 보고서의 모든 구현 항목(8/8)이 완료되었고, RSI 다이버전스 + 볼륨 프로파일 POC까지 신규 추가됨. 전일 P2 항목 중 3건(Stochastic/WilliamsR 타입 오류, Golden Cross 배열 비교)은 App.jsx 로컬 함수 섀도잉에 의한 **오탐으로 정정**함.

금일 발견된 핵심 개선 포인트는 **MACD 다이버전스의 quickDiagnosis 미반영**(P2)과 **Golden/Death Cross 이벤트 보너스 부재**(P2). 둘 다 난이도 '하'이며 종합 점수의 예측력을 즉시 높일 수 있음.

다음 고도화 단계로는 복합 다이버전스 시그널(RSI+MACD 동시), Supertrend/CCI 스크리닝 조건 추가, 그리고 중장기적으로 백테스트 성과 기반 동적 가중치 시스템이 가장 높은 ROI를 제공할 것으로 판단됨.
