# 스크리닝 옵션 고도화 및 정제 보고서
**날짜**: 2026-03-16 (월) 20:00
**분석 대상**: `analyzeAsset()` (L795-1117) + `quickDiagnosis()` (L1565-1725)
**전일 보고서**: screening-refine-2026-03-15.md

---

## 1. 전일(3/15) 개선 항목 구현 현황

### ❌ 미구현 (3건 — P1/P2, 누적 미구현)
| 항목 | 상태 | 누적 일수 | 원인 |
|------|------|-----------|------|
| P1-1: `goldenCross`/`deathCross` return 객체 추가 | ❌ 미구현 | **2일째** | L1101-1116 return 블록에 여전히 누락 |
| P2-1: MACD div → quickDiagnosis 점수 반영 (±10점) | ❌ 미구현 | **4일째** | L1626 이후 코드 없음 |
| P2-2: Golden/Death Cross 이벤트 보너스 (±12점) | ❌ 미구현 | **4일째** | P1-1이 blocker |

### ✅ 이전 구현 완료 항목 (정상 유지)
| 항목 | 상태 | 비고 |
|------|------|------|
| MACD 다이버전스 감지 (peak/trough 비교) | ✅ | L956-988 정상 |
| RSI 다이버전스 → quickDiagnosis ±8점 | ✅ | L1624-1626 정상 |
| OBV 선형회귀 기울기 비교 | ✅ | L898-914 정상 |
| Gap Signal 마켓별 임계값 | ✅ | L888-890 (crypto 8%, kr 4%, us 3%) |
| 볼륨 프로파일 POC | ✅ | L1027-1035 정상 |
| ADX +DI/-DI 방향성 | ✅ | L1045-1048 정상 |
| CMF/MFI 지표 | ✅ | L916-950 정상 |
| v3.1 전략 고도화 (거래량 확인/추세필터/다이버전스) | ✅ | strategies.js 32개 전략 일관 적용 |

---

## 2. 신규 발견 문제점

### 🔴 P1 (높은 우선순위)

#### 2-1. `goldenCross`/`deathCross` return 누락 — **4일째 blocker 지속**

**현재 코드** (L1101-1116):
```javascript
return {
  triggers, price: +price.toFixed(6),
  rsi: rsi != null ? +rsi.toFixed(1) : null,
  weekChange: +weekChange.toFixed(2),
  ma200Dist: ma200Dist != null ? +ma200Dist.toFixed(2) : null,
  volRatio: +volRatio.toFixed(1),
  ma50: ma50daily, ma200: ma200daily,
  stoch, wr: wr != null ? +wr.toFixed(1) : null,
  low52w, high52w,
  cmf: cmf != null ? +cmf.toFixed(3) : null,
  mfi: mfi != null ? +mfi.toFixed(1) : null,
  adxBullish, adxBearish,
  macdDivType, rsiDivType,
  pocPrice: pocPrice != null ? +pocPrice.toFixed(2) : null,
  nearPOC,
  // ⚠️ goldenCross, deathCross 여전히 누락
};
```

`goldenCross`/`deathCross`는 L1052-1073에서 **정상 계산**되고, L1089-1090에서 triggers 배열에도 반영됨. 그러나 return 객체에 포함되지 않아 quickDiagnosis에서 `asset.goldenCross`로 접근 불가.

**수정안** (2줄 추가):
```javascript
return {
  // ... 기존 필드 ...
  nearPOC,
  goldenCross,   // ← 추가
  deathCross,    // ← 추가
};
```

난이도: **하** / 예상 효과: P2-2 blocker 해소 → trendScore ±12점 정확도 향상

#### 2-2. `calcMACD().goldenCross`와 `macd.goldenCross` 용어 충돌 — 오해 유발

**현재 코드**:
- L691-707: App.jsx 로컬 `calcMACD()`가 `{ goldenCross: prev <= prevSig && cur > sig }` 반환 (= **MACD 라인이 시그널 라인을 상향 돌파**)
- L1052: `let goldenCross = false` (= **MA50이 MA200을 상향 돌파**)
- 동일 함수(`analyzeAsset`) 내에서 같은 이름의 두 가지 다른 개념이 공존

**위험**: 현재 직접 버그는 아니지만, `calcMACD().goldenCross`의 결과가 다른 변수에 할당되지 않으므로 혼동만 유발. 그러나 만약 누군가 `const macdResult = calcMACD(weeklyCloses); if (macdResult.goldenCross) ...` 형태로 사용할 경우, MA 골든크로스와 착각하여 로직 오류 발생 가능.

**수정안**: `calcMACD` L707 수정
```javascript
return { macdBullishCross: prev <= prevSig && cur > sig, macdLine: cur, signalLine: sig };
```
+ 모든 참조 수정 필요 (현재 App.jsx 내 `calcMACD().goldenCross` 사용 위치 확인 후)

난이도: **하** / 예상 효과: 코드 가독성·유지보수성 향상

### 🟡 P2 (중간 우선순위)

#### 2-3. MACD 다이버전스 quickDiagnosis 미반영 — **4일째 미구현** ⚠️

3/13 보고서에서 최초 식별. L1624-1626(RSI 다이버전스) 이후에 MACD 다이버전스 반영 코드가 없음. `asset.macdDivType`은 return 객체에 정상 포함(L1113)되므로 즉시 구현 가능.

**수정안** (L1626 이후 삽입):
```javascript
// MACD 다이버전스 반영 — RSI보다 중장기 신뢰도 높음 (±10점)
if (asset.macdDivType === "bullish") { momScore += 10; signals.push({ type: "bullish", name: "MACD 강세 다이버전스" }); }
else if (asset.macdDivType === "bearish") { momScore -= 10; signals.push({ type: "bearish", name: "MACD 약세 다이버전스" }); }
```

난이도: **하** / 예상 효과: momScore ±10점 — MACD div는 RSI div보다 중장기 신뢰도가 높아 예측력 유의미 향상

#### 2-4. Golden/Death Cross 이벤트 보너스 — **4일째 미구현** (P1-1 해결 후)

P1-1(return 객체 추가) 해결 후 quickDiagnosis에 삽입:
```javascript
if (asset.goldenCross) { trendScore += 12; signals.push({ type: "bullish", name: "골든크로스 발생 (4주 이내)" }); }
if (asset.deathCross) { trendScore -= 12; signals.push({ type: "bearish", name: "데스크로스 발생 (4주 이내)" }); }
```

#### 2-5. BB 스퀴즈 폴백 — 저변동성 종목 오탐 지속 (3/15 보고서 P2-4)

**현재** (L844-855): `curBW <= minBW * 1.05` 단일 조건만 사용.
유틸리티주, 채권 ETF 등 본질적 저변동성 종목에서 항상 트리거.

**수정안**: 평균 밴드폭 대비 필터 추가
```javascript
if (!bbSqueeze) {
  // ... 기존 bwArr 계산 ...
  const curBW = bwArr[bwArr.length - 1];
  const minBW = Math.min(...bwArr.slice(-52));
  const avgBW = bwArr.slice(-52).reduce((a, b) => a + b, 0) / Math.min(bwArr.length, 52);
  // 최소값 근접 + 평균의 50% 이하일 때만 스퀴즈 인정
  bbSqueeze = bwArr.length >= 4 && curBW <= minBW * 1.05 && curBW < avgBW * 0.5;
}
```

#### 2-6. quickDiagnosis RSI — 마켓 타입 미분화 (3/15 보고서 P2-5)

크립토 시장은 변동성이 높아 RSI 30/70이 US 주식만큼 극단적이지 않음. 크립토에서 RSI 25는 US에서 RSI 20에 해당.

**수정안** (quickDiagnosis L1596 이전):
```javascript
const mkt = asset.market || "us";
const rsiAdj = mkt === "crypto" ? 5 : 0;
// RSI 체크 시 rsiAdj 적용:
if (asset.rsi >= 80 + rsiAdj) { ... } // 크립토: 85+
else if (asset.rsi <= 20 - rsiAdj) { ... } // 크립토: 15 이하
```

#### 2-7. [신규] `stoch` 반환값이 배열 전체 — 메모리 낭비

**현재** (L1108): `stoch` 반환 시 calcStochastic의 결과 배열 전체를 return. quickDiagnosis에서는 마지막 값(`stoch.k[stoch.k.length-1]`)만 사용하지만, L1613에서 직접 `asset.stoch.k` 값을 사용 — 이는 **배열의 마지막 요소가 아닌 전체 배열의 `.k` 속성**을 참조.

**확인 필요**: quickDiagnosis L1613에서 `asset.stoch.k`는 배열? 스칼라?
- `calcStochastic` 반환값은 `{ k: [array], d: [array] }`
- analyzeAsset L803: `const stoch = calcStochastic(weeklyHighs, weeklyLows, weeklyCloses)`
- return L1108: `stoch` — 배열 전체 반환

quickDiagnosis L1613: `const sk = asset.stoch.k` → 이는 **배열**. `if (sk < 20)` 비교 시 JavaScript에서 배열은 truthy이므로 이 비교가 **항상 false**.

**⚠️ 실제로는 App.jsx의 다른 곳에서 stoch 값을 스칼라로 변환하는 코드가 있을 수 있음** — 추가 확인 필요. 만약 변환 없이 배열이 그대로 전달된다면, stochastic 기반 momScore 조정이 **전혀 작동하지 않는** 심각한 버그.

**수정안** (analyzeAsset return에서 마지막 값만 반환):
```javascript
stochK: stoch.k ? +stoch.k[stoch.k.length - 1]?.toFixed(1) : null,
stochD: stoch.d ? +stoch.d[stoch.d.length - 1]?.toFixed(1) : null,
```

난이도: **하** / 예상 효과: stochastic 기반 momScore ±8점이 정상 작동하게 됨 (현재 미작동 가능성)

### 🟢 P3 (낮은 우선순위 / 향후 연구)

#### 2-8. OBV 다이버전스 룩백 8주 — 5일째 미변경

L900: `const obvLookback = Math.min(obvArr.length, 8);`
학술적 권장 13~26주. 8주 룩백은 횡보장에서 오탐 빈도 높음.
**수정안**: `const obvLookback = Math.min(obvArr.length, 13);`

#### 2-9. VP POC 전체 이력 사용 — 2일째 미변경

L1030: `const vpResult = calcVolumeProfile(weeklyCloses, weeklyVolumes);`
3년치 데이터 시 과거 가격대에 POC가 고정됨.
**수정안**: `calcVolumeProfile(weeklyCloses.slice(-52), weeklyVolumes.slice(-52))`

#### 2-10. Golden/Death Cross 루프 성능 — 2일째 미변경

L1061-1072에서 최대 16번 `calcSMA` 호출. 200+ 종목 워치리스트에서 ~640K iterations.
사전에 MA50/MA200 배열을 한 번 계산하고 인덱스 접근으로 전환 권장.

---

## 3. 신규 지표/기능 제안

### 3-1. 복합 다이버전스 시그널 — 추천도: ★★★★★ (4일째 재제안)
RSI + MACD 다이버전스 동시 발생 시 복합 시그널. P2-3 해결 후 구현 가능.
quickDiagnosis 가중치: ±15점
```javascript
if (asset.rsiDivType === "bullish" && asset.macdDivType === "bullish") {
  momScore += 15; signals.push({ type: "bullish", name: "복합 강세 다이버전스 (RSI+MACD)" });
} else if (asset.rsiDivType === "bearish" && asset.macdDivType === "bearish") {
  momScore -= 15; signals.push({ type: "bearish", name: "복합 약세 다이버전스 (RSI+MACD)" });
}
```

### 3-2. MACD 히스토그램 제로라인 크로스 → quickDiagnosis — 추천도: ★★★★ (2일째)
`calcMACD(weeklyCloses).goldenCross` (MACD > Signal 전환)를 quickDiagnosis momScore에 +6점 반영.

### 3-3. Supertrend 스크리닝 조건 — 추천도: ★★★★ (4일째)
strategies.js에 구현 완료(L867-906). analyzeAsset에서 Supertrend 방향 계산하여 스크리닝 조건 추가.

### 3-4. 52주 범위 기반 동적 전략 가중치 — 추천도: ★★★★ (2일째)
하위 20% → 평균회귀 전략 가중치↑, 상위 20% → 모멘텀 전략 가중치↑

### 3-5. 백테스트 성과 기반 가중치 — 추천도: ★★★★★ (4일째)
quickDiagnosis 가중치(추세 35%, 모멘텀 25%, 수급 20%, 위치 20%)를 `runBacktest` ROI로 동적 조정.

### 3-6. [신규] Stochastic RSI (StochRSI) — 추천도: ★★★
기존 RSI에 Stochastic 공식을 적용한 2차 오실레이터. RSI가 30~70 사이의 애매한 구간에 있을 때 추가 방향성 신호 제공. strategies.js에 전략은 없으나 analyzeAsset 스크리닝 조건으로 추가하면 모멘텀 신호의 민감도 향상.

---

## 4. 구현 우선순위 로드맵 (업데이트)

| 순서 | 항목 | 난이도 | 예상 효과 | 상태 |
|------|------|--------|----------|------|
| **1** | **goldenCross/deathCross return 추가** (P1) | 하 | P2 blocker 해소 | 🔴 2일째 |
| **2** | **stoch 반환값 스칼라 변환** (P2-신규) | 하 | momScore ±8점 정상화 | 🔴 신규 |
| **3** | **MACD div → quickDiagnosis** (P2) | 하 | momScore ±10점 | 🟡 4일째 |
| **4** | **Golden/Death Cross 보너스** (P2) | 하 | trendScore ±12점 | 🟡 4일째 |
| **5** | BB 스퀴즈 폴백 개선 (P2) | 하 | 저변동성 오탐 감소 | 🟡 2일째 |
| **6** | RSI 크립토 마켓 보정 (P2) | 하 | 크립토 점수 정확도 | 🟡 2일째 |
| **7** | calcMACD goldenCross 네이밍 (P2) | 하 | 유지보수성 향상 | 🟡 2일째 |
| **8** | 복합 다이버전스 시그널 (신규) | 하 | ±15점 반전 포착 | 🟢 4일째 |
| **9** | MACD 히스토그램 크로스 활용 (신규) | 하 | momScore +6점 | 🟢 2일째 |
| **10** | OBV 룩백 13주 확대 (P3) | 하 | 오탐 감소 | 🟢 5일째 |
| **11** | VP POC 52주 제한 (P3) | 하 | POC 정확도 | 🟢 2일째 |
| **12** | GC/DC 루프 성능 최적화 (P3) | 중 | 속도 향상 | 🟢 2일째 |

**긴급 권고**: 순서 1→2→3→4는 모두 난이도 '하'이며 총 코드 변경량이 ~20줄. 한번에 적용하면 quickDiagnosis 점수에서 trendScore ±12점, momScore ±18점(stoch 8 + MACD 10)의 정확도 향상이 즉시 실현됨. **특히 순서 2번(stoch 버그)은 현재 momScore 계산에서 stochastic 신호가 사실상 무시될 수 있는 잠재 버그**이므로 최우선 확인 권고.

---

## 5. 코드 품질 노트

### 긍정적 관찰
- v3.1의 `isVolumeConfirmed`/`getTrendDirection`/`detectBullish/BearishDivergence`가 32개 전략에 일관 적용 — 코드 구조 우수
- MACD/RSI 다이버전스의 peak/trough 비교 방식이 학술적 접근과 부합
- CMF, MFI 지표로 수급 분석 다차원화 달성
- 시장유형별 가중치(L1682-1684)로 크립토/한국/미국 시장 차별화 기반 마련
- analyzeAsset 내 Keltner 기반 BB 스퀴즈 1차 감지가 정확한 방법론

### 아키텍처 우려
- `calcMACD`의 `goldenCross` 네이밍 혼동 지속 (L707)
- analyzeAsset 함수 ~320줄 — 기능 블록별 분리 필요
- App.jsx 7781줄 — 모듈 분리 시점 도래 (screening, diagnosis, backtest 분리 권장)
- App.jsx 로컬 `calcMACD` (L691)와 strategies.js의 `calcMACD` (L58) 섀도잉 구조 — 입력/출력이 다른 동명 함수

---

## 6. 결론

3/13 보고서의 핵심 P2 항목 2건(MACD div quickDiagnosis, GC/DC 이벤트 보너스)이 **4일째 미구현** 상태. 3/15 보고서의 P1(return 객체 누락)도 2일째 미해결.

금일 새로 발견한 **stoch 반환값 버그**(P2-7)는 잠재적으로 quickDiagnosis의 stochastic 기반 momScore 조정(±8점)이 전혀 작동하지 않을 수 있는 심각한 문제. 즉시 검증이 필요함.

상위 4건(return 추가 → stoch 수정 → MACD div → GC/DC 보너스)은 총 ~20줄 코드 변경으로 quickDiagnosis 예측력을 대폭 개선할 수 있으므로, 다음 코드 업데이트 시 일괄 적용을 **강력 권고**함.
