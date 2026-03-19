# 스크리닝 옵션 고도화 및 정제 보고서
**날짜**: 2026-03-15 (일) 20:00
**분석 대상**: `analyzeAsset()` (L795-1117) + `quickDiagnosis()` (L1559-1719)
**전일 보고서**: screening-refine-2026-03-13.md (3/14 보고서 없음 — 건너뜀)

---

## 1. 전일(3/13) 개선 항목 구현 현황

### ❌ 미구현 (2건 — P2 우선순위)
| 항목 | 상태 | 원인 |
|------|------|------|
| P2-1: MACD div → quickDiagnosis 점수 반영 (±10점) | ❌ 미구현 | quickDiagnosis에서 `asset.macdDivType` 미참조 |
| P2-2: Golden/Death Cross 이벤트 보너스 (±12점) | ❌ 미구현 | **blocker**: `goldenCross`/`deathCross`가 return 객체에 미포함 |

### ✅ 이전 구현 완료 항목 (정상 유지)
| 항목 | 상태 | 비고 |
|------|------|------|
| MACD 다이버전스 감지 (peak/trough 비교) | ✅ | L956-988 정상 |
| RSI 다이버전스 → quickDiagnosis ±8점 | ✅ | L1618-1620 정상 |
| OBV 선형회귀 기울기 비교 | ✅ | L898-914 정상 |
| Gap Signal 마켓별 임계값 | ✅ | L888-890 (crypto 8%, kr 4%, us 3%) |
| 볼륨 프로파일 POC | ✅ | L1027-1035 정상 |
| ADX +DI/-DI 방향성 | ✅ | L1045-1048 정상 |

---

## 2. 신규 발견 문제점

### 🔴 P1 (높은 우선순위)

#### 2-1. `goldenCross`/`deathCross`가 `analyzeAsset` return 객체에 누락 — P2-2의 blocker

**현재 코드** (L1050-1073):
- `goldenCross`/`deathCross`가 analyzeAsset 내에서 **정상적으로 계산**됨
- **그러나** return 객체(L1101-1117)에 포함되지 않음
- 오직 `triggers` 배열에만 반영 (L1089-1090)

**영향**: quickDiagnosis에서 `asset.goldenCross`, `asset.deathCross`에 접근 불가. 전일 P2-2 "이벤트 보너스"를 구현하려면 이 값이 반드시 return에 포함되어야 함.

**수정안** (analyzeAsset return 객체에 추가):
```javascript
return {
  triggers, price: +price.toFixed(6),
  // ... 기존 필드 ...
  macdDivType, rsiDivType,
  pocPrice: pocPrice != null ? +pocPrice.toFixed(2) : null,
  nearPOC,
  goldenCross,   // ← 추가
  deathCross,    // ← 추가
};
```

이것이 해결되면 quickDiagnosis에서 다음과 같이 활용:
```javascript
// Golden/Death Cross 이벤트 보너스 (4주 이내 발생)
if (asset.goldenCross) { trendScore += 12; signals.push({ type: "bullish", name: "골든크로스 발생 (4주 이내)" }); }
if (asset.deathCross) { trendScore -= 12; signals.push({ type: "bearish", name: "데스크로스 발생 (4주 이내)" }); }
```

난이도: **하** / 예상 효과: trendScore 정확도 유의미 향상

#### 2-2. MACD 다이버전스 quickDiagnosis 미반영 — 3일째 미구현

3/13 보고서에서 처음 식별. 여전히 quickDiagnosis L1618-1621 블록 이후에 MACD 다이버전스 반영 코드가 없음.

**수정안** (quickDiagnosis, RSI 다이버전스 블록(L1620) 이후에 삽입):
```javascript
// MACD 다이버전스 반영 — RSI보다 중장기 신뢰도 높음 (±10점)
if (asset.macdDivType === "bullish") { momScore += 10; signals.push({ type: "bullish", name: "MACD 강세 다이버전스" }); }
else if (asset.macdDivType === "bearish") { momScore -= 10; signals.push({ type: "bearish", name: "MACD 약세 다이버전스" }); }
```

난이도: **하** / 예상 효과: ±10점으로 모멘텀 점수 예측력 향상

### 🟡 P2 (중간 우선순위)

#### 2-3. `calcMACD` 반환값의 `goldenCross` 네이밍 혼동

**현재 코드** (L691-707):
- App.jsx의 로컬 `calcMACD` 함수가 `{ goldenCross: prev <= prevSig && cur > sig }` 반환
- 이것은 **MACD 라인이 시그널 라인을 상향 돌파**했는지 여부
- 하지만 `goldenCross`라는 이름은 보통 **MA50이 MA200을 상향 돌파**를 의미
- analyzeAsset 내에서도 별도의 `goldenCross` 변수가 MA 크로스용으로 존재 (L1052)

**영향**: 직접적 버그는 아니나, 향후 유지보수 시 혼동 유발. 특히 새 개발자가 `calcMACD().goldenCross`를 MA 골든크로스로 착각할 수 있음.

**수정안**: `calcMACD` 반환값을 `macdBullishCross`로 변경
```javascript
return { macdBullishCross: prev <= prevSig && cur > sig, macdLine: cur, signalLine: sig };
```

#### 2-4. BB 스퀴즈 폴백 기준이 저변동성 종목에서 오탐 유발 가능

**현재 코드** (L844-854):
- 1차: Keltner Channel 기반 진정한 스퀴즈 감지 (정확)
- 2차 폴백: `curBW <= minBW * 1.05` — 현재 밴드폭이 52주 최소값의 105% 이내

**문제**: 유틸리티주, 채권 ETF 등 본질적으로 변동성이 낮은 종목은 밴드폭이 항상 좁음. 이런 종목에서는 52주 최소 BW와 현재 BW의 차이가 작아서 폴백 조건이 빈번하게 트리거됨 → **스퀴즈가 아닌데 스퀴즈로 판정**.

**수정안**: 폴백에 절대 임계값 추가
```javascript
if (!bbSqueeze) {
  // ... 기존 bwArr 계산 ...
  const curBW = bwArr[bwArr.length - 1];
  const minBW = Math.min(...bwArr.slice(-52));
  const avgBW = bwArr.slice(-52).reduce((a, b) => a + b, 0) / bwArr.slice(-52).length;
  // 최소값 근접 + 평균의 50% 이하일 때만 스퀴즈 인정
  bbSqueeze = bwArr.length >= 4 && curBW <= minBW * 1.05 && curBW < avgBW * 0.5;
}
```

#### 2-5. quickDiagnosis RSI 임계값이 마켓 타입을 무시

**현재**: quickDiagnosis L1590-1601에서 RSI 기반 momScore 조정이 모든 마켓에 동일한 임계값 사용.

**문제**: 크립토 시장은 변동성이 높아 RSI 30/70이 US 주식시장만큼 극단적이지 않음. 크립토에서 RSI 25는 US에서 RSI 20에 해당하는 과매도 수준일 수 있음.

**수정안** (quickDiagnosis 시작부에서 마켓별 RSI 보정):
```javascript
const mkt = asset.market || "us";
// 크립토: RSI 극단 판단 기준을 5포인트 더 극단으로 조정
const rsiAdj = mkt === "crypto" ? 5 : 0;
// ... RSI 체크 시:
if (asset.rsi >= 80 + rsiAdj) { ... } // 크립토는 85 이상일 때
else if (asset.rsi <= 20 - rsiAdj) { ... } // 크립토는 15 이하일 때
```

### 🟢 P3 (낮은 우선순위 / 향후 연구)

#### 2-6. Golden/Death Cross 루프의 성능 문제

**현재** (L1061-1072): 최대 4주 × 2회(MA50 + MA200) × 2셋(prev + cur) = 16번의 `calcSMA` 호출. 각 호출이 50~200개 배열 슬라이스 + reduce.

대규모 워치리스트(200+ 종목)에서 이 계산이 종목당 수행되므로:
- 200종목 × 16회 × ~200 iterations = ~640,000 iterations

**수정안**: 루프 대신 일간 MA50/MA200 배열을 한 번 계산하고 주간 간격으로 인덱싱
```javascript
// 사전에 MA50, MA200을 전체 일간 배열로 계산 (각 1회)
const ma50Arr = calcSMAArray(dailyCloses, 50);
const ma200Arr = calcSMAArray(dailyCloses, 200);
// 주간 간격으로 크로스 확인 (단순 인덱스 접근)
for (let w = 0; w <= 4; w++) {
  const idx = dailyCloses.length - 1 - w * 5;
  if (idx < 200) break;
  if (ma50Arr[idx-5] <= ma200Arr[idx-5] && ma50Arr[idx] > ma200Arr[idx]) { goldenCross = true; break; }
  if (ma50Arr[idx-5] >= ma200Arr[idx-5] && ma50Arr[idx] < ma200Arr[idx]) { deathCross = true; break; }
}
```

#### 2-7. 볼륨 프로파일 POC — 전체 이력 사용의 한계

**현재** (L663-676): `calcVolumeProfile(weeklyCloses, weeklyVolumes)` — 전체 주간 데이터 사용.

**문제**: 3년치 데이터가 있는 종목의 경우, 3년 전 가격대에서 대량 거래가 있었다면 POC가 현재 가격과 무관한 구간으로 설정됨. "근접 여부"가 무의미해질 수 있음.

**수정안**: 최근 52주로 제한
```javascript
const vpCloses = weeklyCloses.slice(-52);
const vpVolumes = weeklyVolumes.slice(-52);
const vpResult = calcVolumeProfile(vpCloses, vpVolumes);
```

#### 2-8. OBV 다이버전스 룩백 8주 — 3/13 보고서 이후 미변경

여전히 L900: `const obvLookback = Math.min(obvArr.length, 8);`
학술적 권장은 13~26주. 횡보장에서 8주 룩백은 오탐 빈도가 높음. 13주로 확대 권장.

---

## 3. 신규 지표/기능 제안 (다음 단계)

### 3-1. 복합 다이버전스 시그널 — 추천도: ★★★★★ (3/13 재제안)
RSI + MACD 다이버전스 동시 발생 시 복합 시그널. P1 해결 후 구현 가능.
quickDiagnosis 가중치: ±15점

### 3-2. MACD 히스토그램 제로라인 크로스 → quickDiagnosis 반영 — 추천도: ★★★★
현재 `calcMACD` (L691)에서 MACD 골든크로스(MACD > Signal)를 감지하지만 quickDiagnosis에서 활용하지 않음. MACD 히스토그램이 0 위로 전환되는 이벤트는 중기 추세 전환의 강한 확인 신호.

```javascript
// analyzeAsset return에 추가
macdBullishCross: calcMACD(weeklyCloses).goldenCross,  // MACD > Signal 전환

// quickDiagnosis에서:
if (asset.macdBullishCross) { momScore += 6; signals.push({ type: "bullish", name: "MACD 골든크로스" }); }
```

### 3-3. Supertrend 스크리닝 조건 — 추천도: ★★★★ (3/13 재제안)
strategies.js에 이미 구현 완료. analyzeAsset에서 Supertrend 방향을 계산하여 스크리닝 조건으로 추가 가능.

### 3-4. 52주 범위 내 위치 기반 동적 전략 가중치 — 추천도: ★★★★
52주 범위 하위 20% 종목에서는 평균회귀 전략에 더 높은 가중치, 상위 20% 종목에서는 모멘텀 전략에 더 높은 가중치를 부여하면 quickDiagnosis 점수의 맥락 민감도가 향상됨.

### 3-5. 백테스트 성과 기반 가중치 — 추천도: ★★★★★ (3/13 재제안)
quickDiagnosis 가중치(추세 35%, 모멘텀 25%, 수급 20%, 위치 20%)를 `runBacktest` 결과로 동적 조정. 장기 ROI 최대.

---

## 4. 구현 우선순위 로드맵 (업데이트)

| 순서 | 항목 | 난이도 | 예상 효과 | 상태 |
|------|------|--------|----------|------|
| **1** | **goldenCross/deathCross return 추가** (P1) | 하 | P2-2 blocker 해소 | 🔴 신규 |
| **2** | **MACD div → quickDiagnosis** (P2) | 하 | momScore ±10점 | 🟡 3일째 |
| **3** | **Golden/Death Cross 이벤트 보너스** (P2) | 하 | trendScore ±12점 | 🟡 3일째 |
| 4 | BB 스퀴즈 폴백 개선 (P2) | 하 | 저변동성 종목 오탐 감소 | 🟢 신규 |
| 5 | RSI 크립토 마켓 보정 (P2) | 하 | 크립토 점수 정확도 향상 | 🟢 신규 |
| 6 | 복합 다이버전스 시그널 (신규) | 하 | ±15점 강한 반전 포착 | 🟢 2일째 |
| 7 | MACD 히스토그램 크로스 활용 (신규) | 하 | momScore +6점 | 🟢 신규 |
| 8 | OBV 룩백 13주 확대 (P3) | 하 | 오탐 감소 | 🟢 3일째 |
| 9 | VP POC 52주 제한 (P3) | 하 | POC 정확도 향상 | 🟢 신규 |
| 10 | GC/DC 루프 성능 최적화 (P3) | 중 | 대규모 워치리스트 속도 향상 | 🟢 신규 |

**긴급 권고**: 순서 1→2→3은 모두 난이도 '하'이며 총 코드 변경량이 ~15줄. 한번에 구현하면 quickDiagnosis 점수 예측력이 즉시 개선됨.

---

## 5. 코드 품질 노트

### 긍정적 관찰
- v3.1의 거래량 확인(isVolumeConfirmed)과 추세방향 필터(getTrendDirection)가 32개 전략 전반에 일관되게 적용됨
- 다이버전스 감지(RSI, MACD, OBV)의 peak/trough 비교 방식이 학술적 접근과 부합
- CMF, MFI 지표 추가로 수급 분석 다차원화 달성
- 시장유형별 가중치(L1676-1678)로 크립토/한국/미국 시장 차별화 기반 마련

### 아키텍처 우려
- `calcMACD`의 `goldenCross` 네이밍이 MA 골든크로스와 혼동 유발 (P2-3)
- analyzeAsset 함수 길이가 ~320줄로 매우 김. 기능 블록별 분리 고려 필요
- App.jsx 로컬 calc 함수 섀도잉 구조 — 3/13에서 오탐 원인으로 확인. 주석/네이밍 보완 미실행

---

## 6. 결론

3/13 보고서의 핵심 P2 항목 2건(MACD div quickDiagnosis 반영, GC/DC 이벤트 보너스)이 **3일째 미구현** 상태. 금일 분석에서 GC/DC 이벤트 보너스의 **선결 조건**(return 객체 누락)을 새로 발견함. 이 3건(return 추가 → MACD div 반영 → GC/DC 보너스)은 총 ~15줄 코드 변경으로 quickDiagnosis의 예측력을 즉시 높일 수 있으므로, 다음 코드 업데이트 시 최우선 적용을 강력 권고함.

신규 발견 항목 중 BB 스퀴즈 폴백 오탐(P2-4)과 크립토 RSI 보정(P2-5)도 비교적 간단한 수정으로 점수 정확도를 개선할 수 있음.
