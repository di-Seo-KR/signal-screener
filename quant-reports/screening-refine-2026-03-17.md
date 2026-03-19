# 스크리닝 옵션 고도화 및 정제 보고서
**날짜**: 2026-03-17 (화) 20:00
**분석 대상**: `analyzeAsset()` (L795-1121) + `quickDiagnosis()` (L1569-1729)
**전일 보고서**: screening-refine-2026-03-16.md

---

## 1. 전일(3/16) 개선 항목 구현 현황

### ✅ 금일 구현 완료 (improvement-log-2026-03-17 기준)
| 항목 | 상태 | 비고 |
|------|------|------|
| TTM Squeeze 전략 strategies.js 도입 | ✅ | BB+KC 기반 진정한 스퀴즈 판별 |
| analyzeAsset return에 adx, plusDI, minusDI, bbSqueeze 추가 | ✅ | L1113-1116 확인 |
| 스크리닝 카드 UI — ADX, TTM Squeeze, RSI 과매수 표시 | ✅ | App.jsx 반영 |
| 차트 모달 VWAP·피벗·MA수렴도 추가 | ✅ | ChartModal.jsx |

### ❌ 미구현 (4건 — 누적 미구현, 긴급도 상승)
| 항목 | 상태 | 누적 일수 | 원인 |
|------|------|-----------|------|
| P1-1: `goldenCross`/`deathCross` return 객체 추가 | ❌ 미구현 | **3일째** | L1101-1120 return 블록에 여전히 누락 |
| P2-1: MACD div → quickDiagnosis 점수 반영 (±10점) | ❌ 미구현 | **5일째** | L1630 이후 코드 없음 |
| P2-2: Golden/Death Cross 이벤트 보너스 (±12점) | ❌ 미구현 | **5일째** | P1-1이 blocker |
| P2-5: BB 스퀴즈 폴백 avgBW 필터 | ❌ 미구현 | **3일째** | L844-854 단일 조건 유지 |

### ✅ 이전 구현 완료 항목 (정상 유지)
| 항목 | 상태 | 비고 |
|------|------|------|
| MACD 다이버전스 감지 (peak/trough 비교) | ✅ | L956-988 정상 |
| RSI 다이버전스 → quickDiagnosis ±8점 | ✅ | L1628-1630 정상 |
| OBV 선형회귀 기울기 비교 | ✅ | L898-914 정상 |
| Gap Signal 마켓별 임계값 | ✅ | L888-890 (crypto 8%, kr 4%, us 3%) |
| 볼륨 프로파일 POC | ✅ | L1027-1035 정상 |
| ADX +DI/-DI 방향성 | ✅ | L1045-1048 정상 |
| CMF/MFI 지표 | ✅ | L916-950 정상 |
| v3.1 전략 고도화 (거래량 확인/추세필터/다이버전스) | ✅ | strategies.js 32개 전략 일관 적용 |
| TTM Squeeze 전략 | ✅ 신규 | strategies.js + UI 반영 완료 |

---

## 2. 전일 보고서 오류 정정

### ⚠️ P2-7 (stoch 반환값 배열 버그) — **오탐 정정: 실제 버그 아님**

3/16 보고서에서 `stoch` 반환값이 배열 전체여서 `asset.stoch.k`가 배열이라고 보고했으나, 코드 재검증 결과:

- `calcStochastic()` (L731-743): return `{ k: kLast, d: dLast }` — **스칼라 값** 반환
- L740: `const kLast = kArr[kArr.length - 1]` — 배열이 아닌 마지막 값만 반환
- L741: `const dLast = kArr.slice(-dPeriod).reduce(...) / dPeriod` — 스칼라

따라서 quickDiagnosis L1617-1622의 `asset.stoch.k`, `asset.stoch.d` 비교는 **정상 작동**. 3/16 보고서의 P2-7은 오탐이며, stochastic 기반 momScore ±8점은 의도대로 동작 중.

**교훈**: `calcStochastic`의 내부 `kArr`(배열)과 반환값 `k`(스칼라)를 혼동. 향후 분석 시 return 문까지 정확히 추적 필요.

---

## 3. 신규 발견 문제점

### 🔴 P1 (높은 우선순위)

#### 3-1. `goldenCross`/`deathCross` return 누락 — **3일째 blocker, 위험도 상향**

**현재 코드** (L1101-1120):
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
  adx: adxResult ? +adxResult.adx.toFixed(1) : null,
  plusDI: adxResult ? +adxResult.plusDI.toFixed(1) : null,
  minusDI: adxResult ? +adxResult.minusDI.toFixed(1) : null,
  bbSqueeze,
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

#### 3-2. `calcMACD().goldenCross`와 `macd.goldenCross` 용어 충돌 — 3일째

**현재 코드**:
- L691-707: App.jsx 로컬 `calcMACD()`가 `{ goldenCross: prev <= prevSig && cur > sig }` 반환 (= **MACD 라인이 시그널 라인을 상향 돌파**)
- L1052: `let goldenCross = false` (= **MA50이 MA200을 상향 돌파**)
- 동일 함수(`analyzeAsset`) 내에서 같은 이름의 두 가지 다른 개념이 공존

현재 직접 버그는 아니지만, `calcMACD().goldenCross`의 결과가 다른 변수에 할당되지 않으므로 혼동만 유발. 유지보수 시 로직 오류 발생 가능.

**수정안**: `calcMACD` L707 수정
```javascript
return { macdBullishCross: prev <= prevSig && cur > sig, macdLine: cur, signalLine: sig };
```

난이도: **하** / 예상 효과: 코드 가독성·유지보수성 향상

### 🟡 P2 (중간 우선순위)

#### 3-3. MACD 다이버전스 quickDiagnosis 미반영 — **5일째 미구현** ⚠️⚠️

3/13 보고서에서 최초 식별. L1628-1630(RSI 다이버전스) 이후에 MACD 다이버전스 반영 코드가 없음. `asset.macdDivType`은 return 객체에 정상 포함(L1117)되므로 즉시 구현 가능.

**수정안** (L1630 이후 삽입):
```javascript
// MACD 다이버전스 반영 — RSI보다 중장기 신뢰도 높음 (±10점)
if (asset.macdDivType === "bullish") { momScore += 10; signals.push({ type: "bullish", name: "MACD 강세 다이버전스" }); }
else if (asset.macdDivType === "bearish") { momScore -= 10; signals.push({ type: "bearish", name: "MACD 약세 다이버전스" }); }
```

난이도: **하** / 예상 효과: momScore ±10점 — MACD div는 RSI div보다 중장기 신뢰도가 높아 예측력 유의미 향상

#### 3-4. Golden/Death Cross 이벤트 보너스 — **5일째 미구현** (P1-1 해결 후)

P1-1(return 객체 추가) 해결 후 quickDiagnosis에 삽입:
```javascript
if (asset.goldenCross) { trendScore += 12; signals.push({ type: "bullish", name: "골든크로스 발생 (4주 이내)" }); }
if (asset.deathCross) { trendScore -= 12; signals.push({ type: "bearish", name: "데스크로스 발생 (4주 이내)" }); }
```

#### 3-5. BB 스퀴즈 폴백 — 저변동성 종목 오탐 지속 (3일째)

**현재** (L844-854): `curBW <= minBW * 1.05` 단일 조건만 사용.
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

#### 3-6. quickDiagnosis RSI — 마켓 타입 미분화 (3일째)

크립토 시장은 변동성이 높아 RSI 30/70이 US 주식만큼 극단적이지 않음.

**수정안** (quickDiagnosis L1599 이전):
```javascript
const mkt = asset.market || "us";
const rsiAdj = mkt === "crypto" ? 5 : 0;
// RSI 체크 시 rsiAdj 적용:
if (asset.rsi >= 80 + rsiAdj) { ... } // 크립토: 85+
else if (asset.rsi <= 20 - rsiAdj) { ... } // 크립토: 15 이하
```

#### 3-7. [신규] 백테스트 TOP 10 — 0거래 전략이 상위 독점 문제

**현재** (backtest-report-2026-03-17.md): TOP 10 절대 수익률이 모두 거래수 0, Sharpe 0.00. 이는 해당 전략이 시그널을 한 번도 생성하지 않아 초기 포지션(= B&H)과 동일한 결과를 보임.

- solana TOP 5: 모두 +593.2% — B&H와 동일, 전략 기여 0
- 035420.KS TOP 6-10: 모두 +170.5% — B&H와 동일

**원인 추정**:
1. `피보나치 되돌림`, `슈퍼트렌드`, `레짐 전환 적응형`, `채널 돌파 모멘텀` 전략들이 특정 종목에서 진입 조건이 너무 엄격하여 시그널 미발생
2. 또는 `runBacktest`에서 시그널 미발생 시 초기 자본을 B&H로 처리하는 폴백이 존재

**수정안**:
- `runBacktest`에서 거래수 0인 경우 ROI를 B&H가 아닌 0%로 보고하거나, 별도 "미거래" 플래그 추가
- TOP 10 정렬 시 `trades >= 1` 필터 적용 (이미 Sharpe TOP 10에는 적용됨)
- 전략별 시그널 발생률을 진단 지표로 추가

난이도: **중** / 예상 효과: 백테스트 리포트 신뢰성 대폭 향상, 실제 알파 창출 전략 식별 용이

#### 3-8. [신규] App.jsx 로컬 `calcMACD` (L691)와 strategies.js `calcMACD` (L58) 섀도잉

두 함수는 이름은 같지만 입출력이 다름:
- App.jsx L691: `calcMACD(closes)` → `{ goldenCross, macdLine, signalLine }`
- strategies.js L58: `calcMACD(closes)` → `{ macd: [], signal: [], histogram: [] }` (배열 반환)

App.jsx에서 `import { calcMACD } from './strategies'`를 하지 않고 로컬 재정의하므로 현재 직접 충돌은 없음. 그러나 향후 모듈 분리 시 import 순서에 따라 잘못된 함수가 호출될 위험.

**수정안**: App.jsx 로컬 버전을 `calcMACDSimple` 또는 `calcMACDCrossover`로 리네이밍

### 🟢 P3 (낮은 우선순위 / 향후 연구)

#### 3-9. OBV 다이버전스 룩백 8주 — 6일째 미변경
L900: `const obvLookback = Math.min(obvArr.length, 8);`
학술적 권장 13~26주. **수정안**: `Math.min(obvArr.length, 13)`

#### 3-10. VP POC 전체 이력 사용 — 3일째 미변경
L1030: 전체 데이터 사용. **수정안**: `.slice(-52)` 적용

#### 3-11. Golden/Death Cross 루프 성능 — 3일째 미변경
L1061-1072에서 최대 16번 `calcSMA` 호출. 사전 MA 배열 계산으로 전환 권장.

---

## 4. 신규 지표/기능 제안

### 4-1. 복합 다이버전스 시그널 — 추천도: ★★★★★ (5일째 재제안)
RSI + MACD 다이버전스 동시 발생 시 복합 시그널. P2-3 해결 후 구현 가능.
quickDiagnosis 가중치: ±15점
```javascript
if (asset.rsiDivType === "bullish" && asset.macdDivType === "bullish") {
  momScore += 15; signals.push({ type: "bullish", name: "복합 강세 다이버전스 (RSI+MACD)" });
} else if (asset.rsiDivType === "bearish" && asset.macdDivType === "bearish") {
  momScore -= 15; signals.push({ type: "bearish", name: "복합 약세 다이버전스 (RSI+MACD)" });
}
```

### 4-2. MACD 히스토그램 제로라인 크로스 → quickDiagnosis — 추천도: ★★★★ (3일째)
`calcMACD(weeklyCloses).goldenCross` (MACD > Signal 전환)를 quickDiagnosis momScore에 +6점 반영.

### 4-3. Supertrend 스크리닝 조건 — 추천도: ★★★★ (5일째)
strategies.js에 구현 완료. analyzeAsset에서 Supertrend 방향 계산하여 스크리닝 조건 추가.

### 4-4. 52주 범위 기반 동적 전략 가중치 — 추천도: ★★★★ (3일째)
하위 20% → 평균회귀 전략 가중치↑, 상위 20% → 모멘텀 전략 가중치↑

### 4-5. 백테스트 성과 기반 가중치 — 추천도: ★★★★★ (5일째)
quickDiagnosis 가중치(추세 35%, 모멘텀 25%, 수급 20%, 위치 20%)를 `runBacktest` ROI로 동적 조정.

### 4-6. [신규] TTM Squeeze → quickDiagnosis 연계 — 추천도: ★★★★★
금일 TTM Squeeze가 strategies.js + analyzeAsset(bbSqueeze)에 구현되었으므로, quickDiagnosis에서도 활용 가능:
```javascript
// TTM Squeeze ON → 변동성 수축 중, 방향 확인 후 큰 움직임 예상
if (asset.bbSqueeze) {
  signals.push({ type: "neutral", name: "TTM Squeeze ON — 변동성 확장 임박" });
  // Squeeze + 상승 모멘텀 → bullish, Squeeze + 하락 모멘텀 → bearish
  if (asset.weekChange > 0 && asset.rsi > 50) { momScore += 6; }
  else if (asset.weekChange < 0 && asset.rsi < 50) { momScore -= 6; }
}
```

### 4-7. [신규] 백테스트 시그널 발생률 추적
전략별로 16개 종목 중 시그널이 최소 1회 이상 발생한 종목 비율 추적. 0% 시그널 발생률 전략은 해당 종목에 부적합으로 마킹.

---

## 5. 구현 우선순위 로드맵 (업데이트)

| 순서 | 항목 | 난이도 | 예상 효과 | 상태 |
|------|------|--------|----------|------|
| **1** | **goldenCross/deathCross return 추가** (P1) | 하 | P2 blocker 해소 | 🔴 3일째 |
| **2** | **MACD div → quickDiagnosis** (P2) | 하 | momScore ±10점 | 🔴 5일째 |
| **3** | **Golden/Death Cross 보너스** (P2) | 하 | trendScore ±12점 | 🔴 5일째 |
| **4** | **TTM Squeeze → quickDiagnosis 연계** (신규) | 하 | momScore ±6점 | 🟡 신규 |
| **5** | BB 스퀴즈 폴백 avgBW 필터 (P2) | 하 | 저변동성 오탐 감소 | 🟡 3일째 |
| **6** | RSI 크립토 마켓 보정 (P2) | 하 | 크립토 점수 정확도 | 🟡 3일째 |
| **7** | 백테스트 0거래 필터 (P2-신규) | 중 | 리포트 신뢰성 향상 | 🟡 신규 |
| **8** | calcMACD goldenCross 네이밍 (P2) | 하 | 유지보수성 향상 | 🟡 3일째 |
| **9** | 복합 다이버전스 시그널 (신규) | 하 | ±15점 반전 포착 | 🟢 5일째 |
| **10** | MACD 히스토그램 크로스 활용 (신규) | 하 | momScore +6점 | 🟢 3일째 |
| **11** | 백테스트 시그널 발생률 (신규) | 중 | 전략 적합성 진단 | 🟢 신규 |
| **12** | OBV 룩백 13주 확대 (P3) | 하 | 오탐 감소 | 🟢 6일째 |
| **13** | VP POC 52주 제한 (P3) | 하 | POC 정확도 | 🟢 3일째 |
| **14** | GC/DC 루프 성능 최적화 (P3) | 중 | 속도 향상 | 🟢 3일째 |

**긴급 권고**: 순서 1→2→3은 모두 난이도 '하'이며 총 코드 변경량이 ~15줄. 한번에 적용하면 quickDiagnosis 점수에서 trendScore ±12점, momScore ±10점의 정확도 향상이 즉시 실현됨.

**추가 권고**: 금일 TTM Squeeze 구현이 완료되었으므로, 순서 4번(TTM Squeeze → quickDiagnosis 연계)도 함께 적용하면 변동성 수축 국면의 방향성 판단이 개선됨.

---

## 6. 코드 품질 노트

### 긍정적 관찰
- 금일 TTM Squeeze 도입으로 변동성 전략이 학술적 수준으로 격상
- VWAP·피벗·MA수렴도 추가로 차트 모달 진단이 다차원화
- analyzeAsset return에 adx/plusDI/minusDI/bbSqueeze 추가 — quickDiagnosis 활용 기반 확보
- v3.1의 `isVolumeConfirmed`/`getTrendDirection`/`detectBullish/BearishDivergence`가 32개 전략에 일관 적용 — 코드 구조 우수
- 시장유형별 가중치(L1686-1688)로 크립토/한국/미국 시장 차별화

### 3/16 보고서 오탐 반성
- stoch 반환값 버그(P2-7)는 오탐이었음 — `calcStochastic`이 스칼라를 반환하는 것을 확인하지 않은 분석 실수
- 향후: return 문까지 완전 추적 후 버그 보고 원칙 수립

### 아키텍처 우려 (지속)
- App.jsx ~7800줄 — 모듈 분리 시점 도래 (screening, diagnosis, backtest 분리 권장)
- App.jsx 로컬 `calcMACD` (L691)와 strategies.js `calcMACD` (L58) 섀도잉
- analyzeAsset 함수 ~326줄 — 기능 블록별 분리 필요

---

## 7. 결론

금일 TTM Squeeze 전략 도입과 UI 강화라는 의미 있는 진전이 있었으나, 핵심 P1/P2 항목은 누적 미구현 상태가 지속되고 있음.

3/16 보고서의 stoch 버그(P2-7)는 오탐으로 정정하며, 분석 정확도 개선을 위해 return 문 완전 추적 원칙을 수립함.

**미구현 핵심 항목 현황**:
- P1-1 (goldenCross return): 3일째 — downstream 2건 차단 중
- P2-1 (MACD div quickDiagnosis): 5일째 — momScore ±10점 누락
- P2-2 (GC/DC 보너스): 5일째 — trendScore ±12점 누락

상위 3건은 총 ~15줄 코드 변경으로 quickDiagnosis 예측력을 대폭 개선할 수 있으므로, 다음 코드 업데이트 시 일괄 적용을 **강력 권고**함.

신규 발견된 백테스트 0거래 문제는 리포트 신뢰성에 직접 영향을 미치므로, 중기적으로 반드시 해결 필요.
