# 스크리닝 옵션 고도화 및 정제 보고서
**날짜**: 2026-03-12 (목) 20:00
**분석 대상**: `analyzeAsset()` (L554-830) + `quickDiagnosis()` (L1228-1374)
**전일 보고서**: screening-refine-2026-03-11.md

---

## 1. 전일 개선 항목 구현 현황

### ✅ 구현 완료 (6/8)
| 항목 | 상태 | 구현 위치 |
|------|------|----------|
| P1: MACD 다이버전스 → peak/trough 비교 | ✅ 구현 | L717-752 |
| P1: Golden/Death Cross → 이벤트 감지 | ✅ 구현 | L769-790 (4주 룩백 포함) |
| P2: OBV 다이버전스 룩백 8주 + 선형회귀 | ✅ 구현 | L657-673 |
| P2: Gap Signal 마켓별 동적 임계값 | ✅ 구현 | L647-649 (crypto 8%, kr 4%, us 3%) |
| P2: RSI 점수 연속 그라데이션 | ✅ 구현 | L1259-1270 (10단계 세분화) |
| P3: ADX +DI/-DI 방향성 활용 | ✅ 구현 | L762-765, L1307-1309 |

### ⚠️ 구현되었으나 결함 발견 (1건 — 아래 P1 참조)
| 항목 | 상태 | 문제 |
|------|------|------|
| P3: BB 스퀴즈 Keltner 기반 | ✅ 구현 | L575-614 (정상 작동) |

### ✅ 신규 지표 추가 완료
| 지표 | 구현 위치 | quickDiagnosis 반영 |
|------|----------|-------------------|
| CMF (Chaikin Money Flow) | L675-687 | ✅ L1301-1306 (±0.05/±0.15 구간) |
| MFI (Money Flow Index) | L689-709 | ✅ L1271-1275 (<20/\>80) |
| 시장별 적응 가중치 | — | ✅ L1330-1334 |

### 📋 미구현 (향후 과제)
| 항목 | 비고 |
|------|------|
| ROC (Rate of Change) | 아직 미적용 |
| 다중 타임프레임 확인 | 아직 미적용 |

---

## 2. 신규 발견 문제점

### 🔴 P1 (긴급) — MACD 다이버전스 구현 결함

#### 2-1. `calcMACD` 반환값 프로퍼티명 불일치 (L724)

**현재 코드** (analyzeAsset L721-724):
```javascript
const sl = weeklyCloses.slice(0, i + 1);
const m = calcMACD(sl);
macdHist.push((m.macdLine || 0) - (m.signalLine || 0));
```

**문제**:
1. `calcMACD()`는 `{ macdLine, signal, histogram }`을 반환 (strategies.js L54-61)
2. `m.signalLine`은 **undefined** → `m.signalLine || 0` = `0`
3. `m.macdLine`은 **배열** → `배열 - 0` = `NaN`
4. 결과적으로 `macdHist` 전체가 `NaN`으로 채워짐
5. `findSwings(NaN배열, ...)` → swing을 찾지 못함 → **MACD 다이버전스가 절대 트리거되지 않음**

**수정안**:
```javascript
const sl = weeklyCloses.slice(0, i + 1);
const m = calcMACD(sl);
const lastIdx = m.macdLine.length - 1;
macdHist.push(m.macdLine[lastIdx] - m.signal[lastIdx]);
```

#### 2-2. MACD 다이버전스 성능 이슈 (L719-724)

**현재**: 매 반복마다 `calcMACD(weeklyCloses.slice(0, i+1))` 호출
- `calcMACD`는 내부에서 EMA12, EMA26, Signal 3번의 EMA를 계산
- lookback=24일 때 24번 호출 × 3 EMA = 72회 EMA 계산
- 종목 200개 × 72 = **14,400회 불필요한 EMA 재계산**

**수정안**: 전체 MACD를 한 번만 계산하고 히스토그램 배열을 슬라이스
```javascript
const fullMACD = calcMACD(weeklyCloses);
const macdHist = fullMACD.histogram.slice(-lookback);
```

### 🟡 P2 (중간 우선순위)

#### 2-3. Stochastic 값 타입 오류 — quickDiagnosis에서 배열 비교

**현재** (analyzeAsset L823):
```javascript
return { ..., stoch, ... }; // stoch = { k: Array, d: Array }
```

**quickDiagnosis** (L1276-1281):
```javascript
const sk = asset.stoch.k; // ← 배열
if (sk < 20 && ...) { ... } // ← 배열 < 20 → 항상 false
```

**영향**: 스토캐스틱이 quickDiagnosis 점수에 **전혀 기여하지 않음** (최대 ±8점 손실)

**수정안** (analyzeAsset 반환값 수정):
```javascript
const lastK = stoch.k[stoch.k.length - 1];
const lastD = stoch.d[stoch.d.length - 1];
return { ..., stoch: { k: lastK, d: lastD }, ... };
```

#### 2-4. Williams %R 동일 타입 오류 가능성

**analyzeAsset L563**: `const wr = calcWilliamsR(...)` → 배열 반환
**L823**: `wr: wr != null ? +wr.toFixed(1) : null`

`calcWilliamsR`는 배열을 반환하므로 `wr.toFixed(1)`는 TypeError 발생 가능.
실제로는 `wr`이 truthy(배열)이므로 `+wr.toFixed(1)` → TypeError.

**확인 필요**: 이 코드가 실행 중 에러 없이 동작한다면, `wr`이 어딘가에서 마지막 값으로 재할당되는 경로가 있을 수 있음. 별도 디버깅 필요.

**수정안 (안전하게)**:
```javascript
const wrArr = calcWilliamsR(weeklyHighs, weeklyLows, weeklyCloses);
const wrLast = wrArr[wrArr.length - 1];
// ...
wr: wrLast != null ? +wrLast.toFixed(1) : null,
```

#### 2-5. Golden/Death Cross 룩백 루프 — `undefined` 슬라이스 엣지 케이스

**현재** (L782):
```javascript
const cM50 = calcSMA(dailyCloses.slice(0, -(w*5 - 5) || undefined), 50);
```

`w=1`일 때 `-(1*5 - 5)` = `0` → `0 || undefined` = `undefined` → `dailyCloses.slice(0, undefined)` = 전체 배열. 의도대로 작동.

하지만 `calcSMA`는 마지막 요소를 반환하지 않고 **전체 SMA 배열**을 반환.
비교 시 `pM50 <= pM200`에서 배열 간 비교가 발생 → 항상 `false` → 4주 이내 크로스가 실질적으로 감지되지 않을 가능성.

**수정안**: calcSMA 결과에서 마지막 값을 추출
```javascript
const pM50Arr = calcSMA(dailyCloses.slice(0, -(w*5)), 50);
const pM50 = pM50Arr?.[pM50Arr.length - 1];
```

### 🟢 P3 (낮은 우선순위 / 향후 연구)

#### 2-6. quickDiagnosis — 거래량 폭증 방향 미고려

**현재** (L1290): `volRatio >= 3` → 무조건 bullish (+18)
**문제**: 거래량 3배 + 음봉(가격 하락) = 투매인데 bullish 점수 부여

**수정안**:
```javascript
if (asset.volRatio >= 3 && asset.weekChange > 0) { supScore += 18; ... } // 매집
else if (asset.volRatio >= 3 && asset.weekChange < 0) { supScore -= 15; ... } // 투매
```
(참고: L1297-1298에 일부 반영되어 있으나, L1290의 +18이 먼저 적용되어 상쇄 불완전)

#### 2-7. 52주 신고가 돌파 vs 과매수 점수 충돌

**현재**: 52주 상위 95% → posScore -5 (L1319), 동시에 52주 신고가 돌파 시 posScore +8 (L1325)
**결과**: 신고가 돌파 시 -5 + 8 = +3으로 미미. 모멘텀 브레이크아웃 시점에서 점수가 너무 보수적.

**수정안**: 신고가 돌파(98%+ && weekChange > 0)인 경우 상단 페널티 면제
```javascript
if (pos52 >= 95 && !(pos52 >= 98 && asset.weekChange > 0)) posScore -= 5;
```

---

## 3. 신규 지표/기능 제안 (다음 단계)

### 3-1. RSI 다이버전스 (별도 스크리닝 조건) — 추천도: ★★★★★
MACD 다이버전스와 동일 원리를 RSI에 적용. RSI 다이버전스는 MACD보다 더 빈번하고 단기 반전에 유효.
```javascript
// rsi_divergence 조건 추가
// 가격 lower-low + RSI higher-low → bullish RSI divergence
// 가격 higher-high + RSI lower-high → bearish RSI divergence
```

### 3-2. 볼륨 프로파일 기반 지지/저항 — 추천도: ★★★★
최근 52주 가격대별 거래량 분포를 계산하여 고거래량 가격대(POC)를 지지/저항으로 활용.
```javascript
function calcVolumeProfile(closes, volumes, bins = 20) {
  const min = Math.min(...closes), max = Math.max(...closes);
  const step = (max - min) / bins;
  const profile = new Array(bins).fill(0);
  closes.forEach((c, i) => {
    const bin = Math.min(Math.floor((c - min) / step), bins - 1);
    profile[bin] += volumes[i];
  });
  const pocBin = profile.indexOf(Math.max(...profile));
  return { poc: min + (pocBin + 0.5) * step, profile };
}
// 스크리닝: 현재 가격이 POC ±2% 이내 → 강한 지지/저항 근접
```

### 3-3. Relative Strength vs Benchmark — 추천도: ★★★★
개별 종목의 상대 강도를 SPY/QQQ 대비 측정. 시장보다 강한 종목을 선별.

### 3-4. 전략 성과 기반 스크리닝 가중치 조정 — 추천도: ★★★★★
백테스트 결과(승률, 샤프비율)를 바탕으로 각 스크리닝 조건의 가중치를 동적으로 조정. 현재 모든 조건이 동일 가중치.

---

## 4. 구현 우선순위 로드맵

| 순서 | 항목 | 난이도 | 예상 효과 | 긴급도 |
|------|------|--------|----------|--------|
| 1 | **MACD 다이버전스 프로퍼티명 수정** (P1) | 하 | MACD 다이버전스 기능 정상화 | 🔴 긴급 |
| 2 | **MACD 성능 최적화** (P1) | 하 | 14,400회 불필요 연산 제거 | 🔴 긴급 |
| 3 | **Stochastic 타입 수정** (P2) | 하 | quickDiagnosis ±8점 정상화 | 🟡 높음 |
| 4 | **Williams %R 타입 확인/수정** (P2) | 하 | 잠재 TypeError 방지 | 🟡 높음 |
| 5 | **Golden/Death Cross 배열비교 수정** (P2) | 하 | 4주 이내 크로스 감지 정상화 | 🟡 높음 |
| 6 | 거래량 클라이맥스 방향 구분 (P3) | 하 | 점수 정확도 향상 | 🟢 보통 |
| 7 | 52주 신고가 점수 충돌 해소 (P3) | 하 | 모멘텀 종목 정확도 향상 | 🟢 보통 |
| 8 | RSI 다이버전스 조건 추가 (신규) | 중 | 반전 감지 강화 | 🟢 보통 |

---

## 5. 결론

전일 보고서의 8개 개선 항목 중 6개가 구현 완료되어 빠른 진행이 이루어지고 있음. 그러나 **MACD 다이버전스 구현에 치명적 결함**(프로퍼티명 `signalLine` vs `signal`, 배열 vs 스칼라)이 발견됨. 현재 MACD 다이버전스는 사실상 작동하지 않는 상태.

추가로 **Stochastic과 Williams %R의 타입 오류**로 인해 quickDiagnosis의 모멘텀 점수가 불완전하게 계산되고 있을 가능성이 높음. 이 세 가지 수정은 모두 난이도 '하'이므로 빠른 적용을 권장.

다음 고도화 단계로는 RSI 다이버전스 조건 추가와 볼륨 프로파일 기반 지지/저항 감지가 가장 높은 ROI를 제공할 것으로 판단됨.
