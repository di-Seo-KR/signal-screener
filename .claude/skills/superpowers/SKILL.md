---
name: superpowers
description: |
  개발 역량을 극대화하는 시니어 엔지니어링 강화 스킬입니다.
  코드 작성 전 분석-설계-계획 프로세스를 강제하고, 프로덕션 수준의 코드 품질을 보장합니다.
  
  반드시 이 스킬을 사용해야 하는 상황:
  - 새로운 기능을 구현하기 전에 아키텍처를 설계해야 할 때
  - 대규모 리팩토링이 필요할 때
  - 코드베이스를 처음 분석해야 할 때
  - "코드 품질을 높여줘", "시니어답게 해줘", "제대로 만들어줘" 같은 요청
  - 복잡한 상태 관리나 비동기 로직을 다룰 때
  - 성능 최적화가 필요할 때
  - 기술 부채를 정리해야 할 때
  - 코드 리뷰에서 개선점을 찾아야 할 때
---

# Superpowers — 시니어 엔지니어링 강화 스킬

## 목적

모든 개발 작업에서 시니어 소프트웨어 엔지니어의 사고 프로세스를 적용합니다.
"처음부터 제대로" 원칙에 따라, 코드 한 줄 작성하기 전에 분석-설계-계획을 완료합니다.

## 핵심 원칙: 코드 작성 전 5단계 프로세스

모든 개발 작업에서 이 프로세스를 따릅니다:

### Phase 1: 요구사항 분석
```
질문: "무엇을 왜 만드는가?"
- 사용자가 원하는 최종 결과물은?
- 비즈니스 목표와의 연결은?
- 성공 기준은 무엇인가?
```

### Phase 2: 현재 상태 파악
```
질문: "기존 코드/구조는 어떤가?"
- 관련 파일과 함수 식별
- 의존성 그래프 파악
- 기존 패턴과 컨벤션 확인
```

### Phase 3: 경계 사례 식별
```
질문: "어떤 예외 상황이 있는가?"
- 빈 배열, null, undefined 처리
- 네트워크 오류, 타임아웃
- 동시성 이슈 (Race Condition)
- 모바일/데스크탑 차이
- i18n (한국어/영어)
- 다크모드/라이트모드
```

### Phase 4: 아키텍처 설계
```
질문: "어떤 구조가 최적인가?"
- 컴포넌트 분리 전략
- 상태 관리 방식
- 데이터 흐름 설계
- 재사용성 고려
```

### Phase 5: 구현 계획 수립
```
질문: "어떤 순서로 만드는가?"
- 파일별 변경 범위
- 구현 순서 (의존성 순)
- 테스트 전략
- 롤백 계획
```

## 코드 품질 표준

### React 컴포넌트 작성 기준 (Zepta)
```javascript
// ✅ 프로덕션 수준 컴포넌트 패턴
function MarketCard({ symbol, price, change, name, flag, onClick }) {
  // 1. 경계 사례 처리
  if (!symbol || price == null) return null;
  
  // 2. 파생 상태 계산
  const isUp = change >= 0;
  const changeText = `${isUp ? "+" : ""}${change.toFixed(2)}%`;
  
  // 3. 접근성 고려
  return (
    <button
      onClick={onClick}
      role="article"
      aria-label={`${name} ${changeText}`}
      style={{
        // 4. 반응형 + 테마 적용
        padding: "14px",
        borderRadius: "14px",
        background: `${isUp ? C.green : C.red}06`,
        border: `1px solid ${isUp ? C.green : C.red}12`,
        cursor: onClick ? "pointer" : "default",
        transition: "all .2s",
        // 5. flexShrink 방어 (sidebar overflow 대응)
        flexShrink: 0,
      }}
    >
      {/* 6. i18n 적용 */}
      <div style={{ fontSize: "13px", color: C.text3 }}>
        {flag} {t(`market.${symbol}`) || name}
      </div>
      <div style={{ fontSize: "20px", fontWeight: 800, color: C.text1 }}>
        {price.toLocaleString()}
      </div>
      <div style={{ fontSize: "14px", fontWeight: 700, color: isUp ? C.green : C.red }}>
        {changeText}
      </div>
    </button>
  );
}
```

### 성능 최적화 체크리스트
```
□ 불필요한 리렌더링 방지 (React.memo, useMemo, useCallback)
□ 대규모 리스트 가상화 (virtualization)
□ 이미지 lazy loading
□ 번들 사이즈 확인 (코드 스플리팅)
□ 네트워크 요청 배치 처리 및 캐싱
□ CSS 애니메이션은 transform/opacity만 사용 (GPU 가속)
□ 메모리 누수 방지 (useEffect cleanup)
```

### 코드베이스 분석 프로토콜

대규모 미지의 코드베이스에 진입했을 때:

```
Step 1: 전체 구조 파악
  - 디렉토리 구조, 진입점, 라우팅
  - 상태 관리 패턴 (Context, Redux, Zustand 등)
  - 데이터 흐름 (API → State → UI)

Step 2: 문제점 식별
  - 중복 코드 (DRY 위반)
  - 과도한 결합 (Coupling)
  - 미사용 코드 (Dead Code)
  - 일관성 없는 패턴

Step 3: 병목 현상 탐지
  - 큰 컴포넌트 (500줄 이상)
  - 깊은 props drilling
  - N+1 쿼리 패턴
  - 불필요한 동기 처리

Step 4: 위험 식별
  - 에러 핸들링 누락
  - 타입 안전성 부족
  - 테스트 커버리지 부재
  - 보안 취약점

Step 5: 개선 로드맵 산출
  - 우선순위별 리팩토링 계획
  - 점진적 마이그레이션 전략
  - 영향도 분석
```

## 출력 형식

모든 개발 작업 시작 시:
```
🔧 [DEV-ARCH] 아키텍처 분석:
- 요구사항: {요약}
- 영향 범위: {파일 목록}
- 경계 사례: {목록}
- 설계 결정: {핵심 설계}
- 구현 계획: {단계별}
- 예상 리스크: {목록}

→ Phase 4 완료. 구현을 시작합니다.
```
