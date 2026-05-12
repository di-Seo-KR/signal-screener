# PLAN-SVC 2026-05-12 — Zepta 종합 UX 개선 spec

작성: PLAN-SVC (시니어 서비스 기획)
대상: DEV-ARCH / DEV-IMPL / DEV-QA / DEV-PERF (4명 병렬 구현)
검수 후 즉시 착수 가능. 코드 변경 없음, 본 문서는 구현 spec 만 정의.

본 문서는 대표(서동인 CEO) 가 모바일 실기기 사용 중 식별한 10개 카테고리 이슈와, PLAN-SVC 가 워크트리 audit 중 추가로 발견한 페이지별 이슈를 통합 정리한 결과물입니다. 모든 항목은 파일·라인 단위로 위치를 적시하고 Before/After 카피와 데이터 계약 변경까지 포함하므로, DEV 4명은 별도 분석 단계 없이 곧바로 구현 단계로 진입할 수 있습니다.

---

## 1. 종합 요약 — Top 5 이슈

| 순위 | 이슈 | 영향 | 우선순위 |
|------|------|------|---------|
| 1 | "AI 매매 = 가상매매"인데 "실제 자금 사용" / "실전매매 시작" 문구가 다이얼로그·토스트에 도배 — 사용자가 본인이 실거래를 시작했다고 오해할 위험 | 신뢰 손상, 컴플라이언스 리스크 | **P0** |
| 2 | 구독 결제가 mock 인데 UI 는 실 결제처럼 보임. "구독이 활성화되었어요" 토스트까지 노출 — 환불 분쟁·CS 리스크 | 컴플라이언스·고객 신뢰 | **P0** |
| 3 | 저장조건 페이지에서 추천 조건 추가 → POST → load() 풀 라운드트립까지 카드가 안 보임. "추가 안 된 것 같다"는 첫 인상 유발 | 핵심 기능 사용성 저하 | **P0** |
| 4 | 모바일 토스트가 화면 상단(safe-area-top)에 표시되지만, 사용자는 하단 nav 위에 잘려 보인다고 인지 → 토스트 위치 정책과 시각적 분리가 동시에 모호 | 알림 손실 인지 | **P1** |
| 5 | 메뉴명 전반("저장조건", "전략비교", "AI매매" 등)이 약어/축약 위주. 입문자가 첫 진입 시 의미 추론이 어려움. GNB·모바일 빠른접근 모두 동일 | 첫 사용자 이탈률 | **P1** |

---

## 2. 이슈 카테고리별 spec

### A. 구독·결제 — 베타 단계 명시 (P0)

#### A-1. Pricing 페이지 "베타" 배지 + 비활성화 안내

- **문제**: `src/Pricing.jsx:520~534` 의 `handleUpgrade` 가 `paymentToken: \`mock-${Date.now()}\`` 로 mock 결제 진행 후 "Pro 구독이 활성화되었어요" 토스트까지 띄움. 사용자는 실 결제를 한 것으로 오해.
- **영향**: 결제 사기 신고·CS 폭주 가능. 컴플라이언스 (특금법/전자상거래법) 리스크.
- **변경 위치**:
  - `src/Pricing.jsx:556~558` (헤더) — 페이지 상단에 "🧪 베타 단계 — 결제 시뮬레이션만 가능" 배지 카드 추가
  - `src/Pricing.jsx:508~540` (`handleUpgrade`) — 실 결제 호출 분기를 분리하고 mock 분기에는 안내 모달 강제 표시
  - `src/Pricing.jsx:99~100` (FAQ) — 기존 답변 ("토스 페이먼츠 / Stripe... 곧 출시") 그대로 두고, FAQ 최상단에 "현재 결제가 가능한가요?" Q&A 추가

- **Before/After 카피**:

  Before (현재 토스트):
  ```
  Pro 구독이 활성화되었어요.
  ```
  After (베타 안내 모달, 결제 버튼 클릭 시 결제 진행 전에 차단):
  ```
  제목:   🧪 결제는 아직 베타 단계입니다
  본문:   Zepta 구독 결제는 현재 시뮬레이션만 제공하고 있어요.
         실제 카드 결제 (토스 페이먼츠·Stripe) 는 2026 Q3 안에
         정식 오픈 예정입니다. 베타 알림을 신청하시면 정식 결제가
         열리는 즉시 가장 먼저 알려드릴게요.
  버튼:   [닫기]  [베타 알림 신청 →]
  ```

- **Pricing 헤더 배지 카피**:
  ```
  🧪 베타  ·  실제 결제는 2026 Q3 오픈 예정 · 지금은 기능 체험용
  ```

- **데이터/API 변경**:
  - 신규: `POST /api/beta-waitlist` → KV `zepta:beta-waitlist:payment` 에 `{ email, uid, requestedAt }` 적재 (정식 오픈 시 메일 발송)
  - 기존 `requestUpgrade` 호출은 그대로 두되, 호출 전 `confirm(...)` UI 강제

- **우선순위**: **P0**

#### A-2. "베타" 시각 배지 일관성

- **변경 위치**: `src/Pricing.jsx:265, 285` ("바로 구독" / "Premium 구독" 버튼)
- **Before**: `바로 구독`, `Premium 구독`
- **After**: `바로 구독  (베타)`, `Premium 구독  (베타)` — 버튼 우측에 작은 베타 칩
- 칩 스타일: `background: ${C.yellow}22`, `border: 1px solid ${C.yellow}`, `padding: 2px 6px`, `borderRadius: 999`

---

### B. 메뉴명·정보 구조 (P1)

#### B-1. 모바일 빠른접근 + GNB 라벨 재정비

- **문제**: 입문자가 의미 추론 어려운 약어 다수. 특히 "저장조건"은 "내가 무엇을 저장했는지" 자체가 불분명. "전략비교", "AI매매", "포트분석" 도 동일.
- **영향**: 첫 사용자가 메뉴를 탐색하다 이탈하는 패턴.
- **변경 위치**:
  - `src/App.jsx:7503~7518` (모바일 빠른접근 14개 버튼)
  - `src/App.jsx:12141~12144` 인근 (GNB/더보기 메뉴 라벨)
  - `src/App.jsx:7514` 와 `src/App.jsx:12143` 의 "저장조건"
  - `src/SavedScreeners.jsx:2` 의 헤더 문구도 동기화

- **Before / After 라벨 표 (full)**:

| 현재 라벨 | 신규 라벨 | 근거 |
|----------|----------|------|
| 스크리너 | 스크리너 | (유지 — 토스도 동일 용어) |
| AI매매 | AI 자동매매 | "AI매매" 만으로는 가상/실제 불분명 |
| 알파랩 | 전략 연구소 | 입문자에게 "알파"는 외계어 |
| 리더보드 | 봇 순위 | 영문 라벨 한글화 |
| 카피매매 | 따라하기 | "카피매매" 보다 직관적 |
| 전략분석 | 전략 분석 | (띄어쓰기 통일) |
| 백테스트 | 과거 시뮬레이션 | 입문자용 |
| 전략비교 | 전략 비교 시뮬 | "비교"가 무엇 비교인지 모호 |
| 포트분석 | 포트폴리오 진단 | "분석"은 추상, "진단"이 액션 |
| **저장조건** | **저장한 스크리너** | 대표 직접 지시 |
| 알림센터 | 알림 | (단어 단축) |
| 프리미엄 | 구독 플랜 | "프리미엄" 단어가 결제 압박 |
| 뉴스 | 뉴스 | (유지) |
| 캘린더 | 경제 캘린더 | "캘린더" 만으론 무엇인지 불명 |

- **하단 nav (모바일 4개 + 더보기)** `src/App.jsx:12920~12925`:
  - "홈" → 유지
  - "스크리너" → 유지
  - "AI매매" → **AI 자동**
  - "포트폴리오" → **자산**
  - "더보기" → 유지

- **i18n 동기화**: `src/i18n/ko.json` 의 해당 키 라벨도 함께 갱신. DEV-IMPL 가 grep `"AI매매"` `"저장조건"` `"카피매매"` `"포트분석"` `"전략비교"` `"알파랩"` `"리더보드"` 로 모든 출현을 일괄 치환.

- **데이터/API 변경**: 없음 (라벨 only)
- **우선순위**: **P1**

#### B-2. 메뉴 hover/active 시 1줄 설명 표시 (옵션 — DEV 여유분)

- 데스크탑 GNB 드롭다운에 마우스 hover 시 라벨 아래 한 줄 설명 노출
  - 예: "전략 연구소 — Zepta AI 가 매시간 평가하는 알파 전략의 안정성 추이"
- 카피는 본 문서 부록 [B-2 부록] 참조 (시간 부족 시 DEV-QA 가 카피 정리)

---

### C. 저장조건 페이지 — 즉시 반영 (P0)

#### C-1. 추천 조건 추가 시 낙관적 업데이트

- **문제**: `src/SavedScreeners.jsx:95~123` 의 `addSuggested` 가 `POST` 응답 받은 뒤 `load()` 로 전체 refetch 까지 끝나야 카드가 보임. 약 600ms~1.2s 의 빈 화면 발생 → "추가 안 된 것" 으로 인지.
- **영향**: 핵심 기능 사용성 저하. 사용자가 같은 버튼을 여러번 눌러 중복 저장 시도 가능.
- **변경 위치**: `src/SavedScreeners.jsx:95~123`

- **변경안 (DEV-IMPL 가 그대로 옮길 수 있는 형태)**:
  ```
  1) addSuggested(s) 시작 시 즉시 setScreeners 에 임시 카드 push
     - tempId = `temp-${Date.now()}`
     - { ...screener, id: tempId, _pending: true, _failed: false }
  2) BottomSheet 닫기 (setShowSuggested(false))  ← 즉시
  3) POST /api/screeners/save 호출
  4) 응답 ok 시: load() 실행 → 실제 id 로 교체 (또는 응답에 신규 id 가 있으면 setScreeners(prev => prev.map(...)) 로 in-place 교체)
  5) 응답 실패 시: setScreeners(prev => prev.filter(x => x.id !== tempId)) + showToast("error", ...)
  ```

- **임시 카드 시각 표시**:
  - 카드 우측 상단에 작은 "저장 중…" 텍스트 + `opacity: 0.7`
  - 실패 시 빨간색 X 아이콘 + "다시 시도" 버튼

- **toggleAlert / remove 도 동일 패턴 점검**: 이미 낙관적이지만 (line 73, 85) 실패 시 롤백 분기 없음 → DEV-QA 가 catch 블록에서 prev 상태 복원 추가.

- **데이터/API 변경**: `POST /api/screeners/save` 응답에 신규 screener 객체 (`{ ok: true, screener: {...} }`) 반환하도록 백엔드 보강 (현재는 ok 만 반환). 백엔드 변경 어려우면 임시로 load() 그대로 두되 임시 카드 표시는 유지.

- **우선순위**: **P0**

---

### D. 포트폴리오 분석 페이지 — 사용 흐름 명확화 (P1)

#### D-1. 빈 상태 + 첫 사용 가이드

- **문제**: `src/PortfolioAnalysis.jsx:118~122` 의 기본 holdings 가 BTC 0.1 / ETH 2 / AAPL 10 으로 박혀 있음. 사용자가 본인 자산을 어떻게 입력하는지, 결과를 어떻게 읽는지 안내 부족.
- **영향**: "내 자산을 어떻게 넣지?", "이 도넛이 무엇을 의미하지?" 라는 두 단계 의문에서 사용자가 이탈.
- **변경 위치**:
  - `src/PortfolioAnalysis.jsx:111~210` — 첫 진입 시 가이드 카드 + 빈 상태 분기 추가
  - `src/PortfolioAnalysis.jsx:200~208` (헤더 영역)

- **변경 내용 (3단 가이드)**:
  1. 페이지 진입 시 사용자 holdings 가 비어있거나 default 와 동일하면 **"3단계 시작 가이드"** 카드 표시
  ```
  ① 보유 자산 입력  →  ② 분석 실행  →  ③ 리밸런싱 힌트 확인
  ```
  2. 각 결과 카드(자산배분 도넛 / 상관관계 히트맵 / 분산점수 게이지) 우측 상단에 작은 ⓘ 아이콘 추가, 클릭 시 1줄 설명 툴팁:
     - 자산 배분: "비중이 한 종목에 30% 이상 몰리면 위험합니다"
     - 상관관계: "초록=같이 움직임 / 빨강=반대로 움직임. 다양할수록 안정적"
     - 분산점수: "0=한 종목 몰빵 / 100=완전 분산. 70 이상이면 양호"
  3. 분석 실행 버튼을 더 눈에 띄게 (현재는 헤더 영역에 묻혀 있음) → 헤더 바로 아래 풀폭 primary CTA "내 자산 분석하기" 카드

- **데이터/API 변경**: 없음
- **우선순위**: **P1**

#### D-2. 자산 입력 UX — 종목 자동완성

- **문제**: 사용자가 `BTCUSDT`, `BTC`, `bitcoin` 중 무엇을 적어야 할지 모름. `src/PortfolioAnalysis.jsx:154~158`
- **변경**: 입력 필드에 종목 검색 dropdown 추가 (`Yahoo Finance` `/api/screener` 자동완성 재사용 권장 — App.jsx 의 SearchBar 컴포넌트 재활용)
- **우선순위**: P2 (선택)

---

### E. 모바일 UI 이슈 (이미지 1~5)

#### E-1. (이미지 1) BTC 알파봇 활성화 다이얼로그 — "실제 자금" 문구 (P0)

- **문제**: `src/AutoTrading.jsx:2755~2813` 의 "실전 매매 확인 다이얼로그" 가 모든 봇 활성화 시 표시. 그런데 AutoTrading 의 봇은 전부 `/api/virtual-portfolio` 기반 **가상매매**.
- **영향**: 사용자가 본인이 실거래를 시작했다고 오해. 컴플라이언스 리스크.
- **변경 위치**:
  - `src/AutoTrading.jsx:2774` (제목)
  - `src/AutoTrading.jsx:2780~2781` (본문)
  - `src/AutoTrading.jsx:2808` (확인 버튼 라벨)

- **Before / After 카피**:

  Before:
  ```
  제목: 실전 매매를 시작합니다
  본문: 실제 자금이 사용됩니다.
       {봇이름}으로 Binance 실거래를 시작하시겠습니까?
  버튼: 시작
  ```
  After:
  ```
  제목: 모의 자금으로 시뮬레이션을 시작합니다
  본문: 실제 돈은 사용되지 않습니다.
       Zepta 가상 자금 (시작 잔고 기준) 으로
       {봇이름} 의 매매 시그널을 실시간으로 따라합니다.
       실제 매매로 전환하려면 [실전매매] 메뉴를 이용해주세요.
  버튼: 모의매매 시작
  ```

- **확인 다이얼로그 시각 톤도 함께 변경**:
  - 경고 이모지 ⚠️ → 정보성 이모지 🧪 (또는 🤖)
  - 본문 색상 `C.text2` 유지하되 "실제 돈은 사용되지 않습니다" 부분만 `C.green` `fontWeight: 700` 강조

- **데이터/API 변경**: 없음

- **우선순위**: **P0**

#### E-2. (이미지 2) 앙상블 시그널봇 투입 금액 모달 (P1)

- **문제**:
  - `src/AutoTrading.jsx:2105~2200` 인근 — 수동 배분 모달. 오렌지 강조색 "배분 완료: $100,000" 의 의미가 모호 (= 남은 한도? = 이미 배분? = 권장?).
  - "처음 시작은 잃어도 괜찮은 소액..." 카피가 너무 강조되어 사용자 자신감을 떨어뜨림.
- **영향**: 사용자가 모달에서 머뭇거리고 이탈.
- **변경 위치**: `src/AutoTrading.jsx:2105~2300`

- **Before / After**:

  Before (강조 카피):
  ```
  처음 시작은 잃어도 괜찮은 소액부터 시작하세요.
  ```
  After (안내 톤):
  ```
  💡 처음이라면 $500 ~ $1,000 정도의 작은 금액부터 추천드려요.
     익숙해진 뒤 단계적으로 늘릴 수 있어요.
  ```
  - 위치: 모달 본문 하단 작은 hint 박스. 강조 X.

- **"배분 완료: $X" 표현 명확화**:
  - 라벨 변경: `배분 완료` → `현재 모의 자금 잔액` (또는 `투입 가능 잔액`)
  - 오렌지 색 → 중립 `C.text2` (정보성. 액션 X 이므로 강조 X)
  - 사용자가 입력한 금액과 잔액의 관계 시각화:
    ```
    잔액  $100,000  ─────────────  $0
                   [████░░░░░░░░░]
                   ↑ 이번 봇 $5,000
    ```

- **우선순위**: **P1**

#### E-3. (이미지 3) 카피트레이딩 페이지 — 면책 박스 + 정보 위계 (P1)

- **문제**:
  - `src/CopyTrading.jsx:423~434` — 노란색 면책 배너가 페이지 약 1/5 차지.
  - `src/CopyTrading.jsx:446~535` (내가 팔로우 중인 봇) — 봇명·메트릭이 한 줄에 다 안 들어가서 줄바꿈 되며 위계 흐림.
- **영향**: 첫 진입 시 어수선한 인상. 핵심 정보(팔로우 중인 봇 메트릭) 가 면책 박스에 가려짐.
- **변경 위치**: `src/CopyTrading.jsx:423~434`, `src/CopyTrading.jsx:447~535`

- **변경안**:

  (a) 면책 박스 → Accordion 패턴
  ```
  접힌 상태 (기본):
  ┌────────────────────────────────────────────────┐
  │ ⚠️ 투자 권유 아님 · 본인 책임 원칙             ▼│
  └────────────────────────────────────────────────┘

  펼친 상태:
  ┌────────────────────────────────────────────────┐
  │ ⚠️ 투자 권유 아님 · 본인 책임 원칙             ▲│
  │ ────────────────────────────────────────────── │
  │ Zepta 카피트레이딩은 신호 알림 또는 설정 복사만 │
  │ 제공합니다. 매매는 사용자가 직접 결정·실행하며 │
  │ Zepta 는 자동 미러 매매를 제공하지 않습니다.   │
  └────────────────────────────────────────────────┘
  ```
  - 기본 접힘. 처음 방문 시 자동 펼침 후 5초 뒤 자동 접힘 (localStorage `zepta:copy-disclaimer-seen` 으로 1회만)

  (b) "내가 팔로우 중인 봇" 카드 위계 재정립
  ```
  ┌──────────────────────────────────────────────┐
  │ BTC 알파         · 신호 알림          [⋯]  │  ← 1열: 봇명 + 모드
  │ 2026.05.10 부터                              │  ← 2열: 메타
  │ 누적수익 +12.3%  ·  최근 7일 +2.1%          │  ← 3열: 핵심 지표
  │ ────────────────────────────────────────── │
  │ [모드: 신호알림 ▼]              [해제]       │  ← 4열: 액션
  └──────────────────────────────────────────────┘
  ```
  - 모바일에서 한 줄에 다 들어가지 않는 select + 버튼은 2단으로 분리
  - 누적/최근 수익률은 API 응답에 이미 있는 필드 (`f.targetBot?.returnPct`) 활용. 없으면 leaderboard 응답에서 join.

- **우선순위**: **P1**

#### E-4. (이미지 4) 카피트레이딩 면책 모달 z-index 버그 (P0)

- **문제**:
  - `src/ui/bottom-sheet.jsx:96, 257` — BottomSheet z-index = **1000**
  - `src/App.jsx:12918` — 모바일 하단 nav z-index = **10000**
  - 결과: BottomSheet 가 하단 nav 보다 **아래** 에 깔림. "BTC 알파" 텍스트가 BottomSheet 위로 보이는 현상은 이로 인한 것.
  - 추가로 `src/CopyTrading.jsx:230~240` 데스크탑 modal 의 zIndex = **9999** 도 nav (10000) 보다 낮음.
- **영향**: 모달이 열려있는 동안 하단 nav 가 클릭 가능 상태로 남고, BottomSheet 콘텐츠가 잘림. 라디오 버튼 텍스트 겹침도 같은 원인.
- **변경 위치**:
  - `src/ui/bottom-sheet.jsx:96, 257`
  - `src/CopyTrading.jsx:235`
  - `src/ui/primitives.jsx:386` (다른 modal)

- **z-index 정책 통일**:
  ```
  0     기본 콘텐츠
  100   sticky header (이미 적용)
  500   드롭다운 (이미 적용)
  1000  → 5000  로 BottomSheet/Modal 상향
  10000 → 9500  로 하단 nav 하향  (또는 BottomSheet 만 11000 으로 상향)
  99999 토스트 (이미 적용)
  ```
  권장: **BottomSheet/Modal 을 z-index 11000** 으로 올리고 모바일 하단 nav 는 10000 그대로 유지.
  이렇게 하면 토스트(99999) > BottomSheet(11000) > 하단 nav(10000) 순서 유지되고 모달 위에 토스트가 떠도 자연스러움.

- **데이터/API 변경**: 없음 (CSS only)

- **우선순위**: **P0**

#### E-5. (이미지 5) 백테스트 비교 OHLC fetch 실패 (P0)

- **문제**: `src/BacktestCompare.jsx:444~448` 가 에러를 단순히 "오류: {err}" 로만 표시. 재시도 버튼·fallback 없음. 백엔드 `/api/backtest-compare` 가 yahoo OHLC 실패 시 그대로 사용자에게 노출.
- **영향**: 핵심 기능 사용 불가 시 사용자 행동 옵션 없음. 이탈.
- **변경 위치**:
  - `src/BacktestCompare.jsx:214~232` (run 핸들러)
  - `src/BacktestCompare.jsx:444~448` (에러 UI)
  - `api/backtest-compare` (백엔드) — yahoo 실패 시 coingecko fallback

- **프론트 변경**:
  ```
  Before:
  ┌──────────────────────────────────┐
  │ 오류: OHLC fetch 실패: fetch failed │
  └──────────────────────────────────┘

  After:
  ┌──────────────────────────────────────────────┐
  │ ⚠️ 시세 데이터를 불러오지 못했어요             │
  │                                              │
  │ Yahoo Finance 가 잠시 응답하지 않거나,        │
  │ 해당 종목·기간 조합의 데이터가 부족합니다.    │
  │                                              │
  │ 다음을 시도해보세요:                          │
  │  • 기간을 30일 → 60일 로 늘려보기            │
  │  • 다른 종목으로 변경                         │
  │                                              │
  │ [↻ 다시 시도]   [기간 늘리기]                │
  └──────────────────────────────────────────────┘
  ```
  - 재시도 버튼: `onClick={run}`
  - "기간 늘리기": `setPeriod(p => Math.min(180, p + 30))` 후 자동 run

- **백엔드 변경** (`api/backtest-compare.mjs` 또는 동등 파일):
  - yahoo OHLC fetch 에 `AbortController` + `timeout: 10s`
  - 실패 시 코인 자산은 coingecko `/coins/{id}/market_chart` 로 fallback (15 분 캐시)
  - 주식 자산은 stooq.com CSV 로 fallback
  - 모두 실패 시 명확한 error code 반환 (`OHLC_UNAVAILABLE`) — 프론트가 메시지 분기

- **데이터 계약**:
  ```json
  { "ok": false, "errorCode": "OHLC_UNAVAILABLE", "error": "Yahoo + Coingecko 모두 실패", "symbol": "ETH-USD", "retryAfterSec": 60 }
  ```

- **우선순위**: **P0**

---

### F. 봇 리더보드 (P1)

#### F-1. 매매 0회 봇 필터링

- **문제**: `src/BotLeaderboard.jsx:163~179` (load) 가 응답을 그대로 표시. `e.tradeCount === 0` 또는 `e.returnPct == null` 인 행이 0% 로 정렬 하위에 깔려 있음.
- **영향**: 리더보드가 "아무 일도 안 일어난 봇" 으로 도배되어 신뢰도 낮음.
- **변경 위치**: `src/BotLeaderboard.jsx:183` 이후 `entries` 사용 부분

- **변경 내용**:
  ```
  const visibleEntries = useMemo(() => {
    return entries.filter(e => (e.tradeCount ?? 0) > 0 && e.returnPct != null);
  }, [entries]);
  ```
  - `visibleEntries` 를 모든 테이블/카드 렌더에 사용
  - 단, "본인 봇 highlight" 카드 (line 235~) 는 매매 0회여도 표시. 대신 "아직 매매가 일어나지 않았어요" 안내 표시.

- **빈 상태 카피**:
  ```
  📊 리더보드에 등재 가능한 봇이 아직 없어요
     봇은 첫 매매가 발생한 시점부터 순위에 포함됩니다.
     보통 첫 진입까지 30분~2시간 정도 걸려요.
  ```

- **우선순위**: **P1**

#### F-2. Top 3 시각 강조

- **문제**: `src/BotLeaderboard.jsx:444~488` — Top 3 가 단순히 금색 텍스트 1위/2위/3위만 차이. 밋밋함.
- **변경**:
  - 1위 row: 배경 `linear-gradient(90deg, ${C.yellow}15, transparent)` + 🥇 이모지 + `borderLeft: 4px solid ${C.yellow}`
  - 2위 row: 동일 패턴, 🥈, `#C0C0C0`
  - 3위 row: 동일 패턴, 🥉, `#CD7F32`
  - 4위 이하: 기존 동일

- **수익률 mini 차트** (옵션 — P2):
  - 각 row 우측에 sparkline (`e.equityCurve` 또는 `e.dailyReturns`) — 7일/30일 수익 추이
  - 데이터 없으면 생략

- **우선순위**: **P1**

#### F-3. 본인 봇 카드 강조 강화

- 이미 적용 (line 235~) 되어 있으나 모바일에서 메트릭 3개가 한 줄에 표시되며 잘림.
- `src/BotLeaderboard.jsx:247~258` — `display: flex` → 모바일 시 `display: grid; grid-template-columns: repeat(3, 1fr)` 로 변경.

---

### G. 알파 랩 — family 정리 (P1)

#### G-1. STRATEGY_KO 미매핑 ID 숨김 또는 표시

- **문제**: `src/AlphaLab.jsx:238` 와 `src/BotLeaderboard.jsx:458` — `STRATEGY_KO[id] || id` 패턴이라 옛 데이터의 `"trend"` `"unknown"` 같은 raw ID 가 그대로 노출.
- **영향**: 신뢰도 저하. 사용자가 "trend 가 뭐지?" 라고 질문.
- **변경 위치**:
  - `src/AlphaLab.jsx:232~251` (`rows` 생성 시 필터링)
  - `src/BotLeaderboard.jsx:458` (`{e.botFamily}` 표시)
  - 백엔드 `api/strategy-leaderboard` — 옛 데이터 마이그레이션

- **프론트 단기 대응**:
  ```
  const KNOWN_STRATEGY_IDS = new Set(Object.keys(STRATEGY_KO));

  const rows = useMemo(() => {
    return Object.entries(strategies)
      .filter(([id]) => KNOWN_STRATEGY_IDS.has(id))   // ← 추가
      .map(([id, m]) => ({...}))
      .sort((a, b) => b.sharpe - a.sharpe);
  }, [strategies, ...]);
  ```
  - 미매핑 ID 는 우선 숨김. 별도 "기타" 그룹으로 묶지 않음 (사용자 혼란만 증가).

- **백엔드 마이그레이션** (QUANT-RES 협업 필요):
  - shadow ledger 의 `family: "trend"`, `family: "unknown"` 항목을 신규 family ID 로 재분류
  - 마이그레이션 스크립트 작성 후 1회 실행
  - 이후 신규 trade 는 정확한 family 로 적재되도록 `quant-agents/*` 파이프라인 점검

- **우선순위**: **P1**

#### G-2. botFamily 라벨 한글화

- **변경 위치**: `src/BotLeaderboard.jsx:458`
- **추가**: `BOT_FAMILY_KO` 맵을 BOT_NAME_KO 옆에 정의
  ```
  const BOT_FAMILY_KO = {
    "trend-follow":   "추세 추종",
    "mean-revert":    "평균 회귀",
    "breakout":       "돌파",
    "momentum":       "모멘텀",
    "volatility":     "변동성",
    "defi":           "DeFi",
    "ensemble":       "앙상블",
  };
  // 사용: BOT_FAMILY_KO[e.botFamily] || null  (null 이면 표시 생략)
  ```

---

### H. AI 매매 토스트 — "실제 자금 투입" (P0)

- **문제**: `src/AutoTrading.jsx:1855` — `showToast("success", \`${pendingBot.name} 실전매매 시작 — $${amount.toLocaleString()} 투입\`)` — AutoTrading 은 가상매매인데 "실전매매" 단어 사용.
- **영향**: E-1 과 동일. 사용자 오해 + 컴플라이언스 리스크.
- **변경 위치**: `src/AutoTrading.jsx:1855`, `src/AutoTrading.jsx:1829`

- **Before / After**:

  Before (line 1855):
  ```
  ${pendingBot.name} 실전매매 시작 — $${amount} 투입
  ```
  After:
  ```
  ${pendingBot.name} 모의매매 시작 — 가상 자금 $${amount} 로 시뮬레이션
  ```

  Before (line 1829, DCA):
  ```
  DCA 봇 시작 — ${config.symbol} ${amt} USDT/${config.frequency}
  ```
  After:
  ```
  DCA 모의 시뮬레이션 시작 — ${config.symbol} ${amt} USDT/${config.frequency}
  ```

- **추가**: 실제 거래 (RealTrading 진입) 의 토스트는 별도 ("✅ Binance 실거래 활성화 — 다음 사이클부터 거래 발생"). 이미 `src/RealTrading.jsx:680` 의 `act("enable", ...)` 흐름에 있으므로 충돌 없음.

- **우선순위**: **P0**

---

### I. UI 강조·구분 전반 (P2)

#### I-1. 카드 구분 강화

- **문제**: 페이지 전반에 `background: C.card`, `border: 1px solid C.border` 단조 반복. 시각 구분이 약함.
- **변경**:
  - 핵심 카드 (현재 메트릭/현재 봇 상태): 상단 1px gradient line + 더 진한 그림자
    ```
    boxShadow: '0 4px 16px rgba(0,0,0,0.06), inset 0 1px 0 rgba(255,255,255,0.04)'
    background: `linear-gradient(180deg, ${C.card} 0%, ${C.card}f8 100%)`
    ```
  - 보조 카드 (설명/안내): 더 옅은 배경 `C.card2` 유지, 그림자 없음
- **변경 위치**: `src/ui/theme.jsx` 에 `cardElevated` 토큰 추가 → 페이지별 핵심 카드에 적용

#### I-2. Empty / Loading / Error 톤 일관성

- 현재 페이지마다 빈 상태·에러 카피·로딩 스피너 스타일이 제각각. (`SavedScreeners` 의 빈 상태와 `BotLeaderboard` 빈 상태 비교)
- 통일 컴포넌트 `<StateCard kind="empty|loading|error" title desc action />` 신설 → `src/ui/primitives.jsx` 에 추가
- 적용 페이지: SavedScreeners, BotLeaderboard, CopyTrading, BacktestCompare, PortfolioAnalysis, AlphaLab

- **우선순위**: **P2** (별도 sprint)

#### I-3. Primary CTA vs 보조 액션

- 페이지마다 버튼 위계 모호. 예: `src/CopyTrading.jsx:485~499` 의 "신호 알림 select" 와 "해제" 버튼이 동일 굵기.
- 정책: primary 는 `background: ${C.blue}` solid, 보조는 ghost (`background: transparent, border: 1px solid C.border`). DEV-IMPL 가 페이지별 audit 하여 보조 액션의 색·굵기 통일.

---

### J. 토스트 알림 잘림 (P1)

- **현재 상태**: `src/App.jsx:13231~13252` — 토스트는 **상단** (`top: env(safe-area-inset-top, 16px)`) 에 표시. 따라서 하단 nav 에 가려질 일은 없음.
- **그러나** 대표가 "잘림" 으로 인지한 원인 가능성:
  1. 모바일 상단 safe-area 영역 위로 토스트가 올라가서 노치/다이내믹 아일랜드에 가려짐
  2. 짧은 토스트 (1.5초~3초) 가 표시되자마자 사라져서 "안 보였다" 로 인지
  3. zIndex 99999 인데 모달 (zIndex 1000~9999) 보다는 위. 그러나 헤더 safe-area-cover 와 충돌 가능 (`src/App.jsx:7034`, 7370)

- **권장 변경**:
  - 토스트 위치를 **헤더 아래** 로 명확히 (`top: calc(env(safe-area-inset-top, 0px) + var(--header-h) + 12px)`)
  - 표시 시간을 3000ms → **4000ms** 로 늘림 (`src/App.jsx:4220`)
  - 토스트 max-width 를 `min(360px, 90vw)` 에서 `min(440px, 92vw)` 로 약간 키움 (line 13243)

- **추가**: 사용자가 "잘렸다" 고 한 다른 시나리오 — 만약 토스트가 **하단** 으로 이동된 적이 있었다면, mobile-bottom-nav (82px + safe-area-bottom) 와 FAB 버튼 (bottom: 100px) 사이에 끼였을 수 있음. 본 수정에서는 **상단 고정** 으로 명확히 한다.

- **변경 위치**: `src/App.jsx:13232~13252`, `src/App.jsx:4220`

- **우선순위**: **P1**

---

## 3. 추가 audit 발견 — 페이지별

### 3.1. `src/RealTrading.jsx` (1508 라인)

| 라인 | 발견 | 우선순위 |
|------|-----|---------|
| 692, 710 | 🚀 실거래 시작 / 🔒 실거래 중지 — 버튼 위계는 좋으나 모바일에서 한 줄로 안 들어감 | P2 |
| 814~820 | 6단계 안전 활성화 가이드 — 현재 step 시각 표시 약함 (체크박스 만으로). 진행 바 추가 권장 | P2 |
| 1173 | "실거래 없이 전체 시스템을 기록 · 수수료 + 슬리피지 반영" — 카피 너무 길고 한 문장. 두 줄로 분리 | P2 |

### 3.2. `src/AutoTrading.jsx` (2817 라인)

| 라인 | 발견 | 우선순위 |
|------|-----|---------|
| 604~637 | "모의 ROI 차트 — DCA 봇은 백테스트가 의미 없어 숨김" 주석. UI 에는 그대로 차트 존재. 코드 정합성 점검 | P2 |
| 1184~1199 | 투입 가능 금액 카드 — 라벨 "투입 가능" 모호. 사용자가 본 페이지에서 처음 보는 경우 의미 추론 어려움. → "이 봇에 추가로 넣을 수 있는 가상 자금" 으로 풀어쓰기 | P2 |
| 1318 | "투입: ${totalAllocated}" 표현 — 같은 단어 다른 의미 반복. "현재 운용 중: $X" 권장 | P2 |
| 2217 | "📊 손실 시뮬레이션" 카드 — 시작 직후 사용자에게 너무 부정적. 위치를 모달 하단 또는 접기로 | P2 |

### 3.3. `src/AlphaLab.jsx` (817 라인)

| 라인 | 발견 | 우선순위 |
|------|-----|---------|
| 35~38 | regime 라벨 "데이터 부족" — 입문자에게 "Hurst 산출 불가" 는 외계어. "분석 중" 으로 변경 | P2 |
| 469~474 | "종목·타임프레임 메트릭" 패널 — 모바일에서 테이블 가로 스크롤 발생. 카드 형식으로 전환 | P1 |
| 622~683 | PublicAlphaShowcase — 가입 CTA "무료로 가입하고 전체 보기" 굳. 그러나 hover/click 후의 onboarding 경로가 끊김 → Onboarding 5스텝의 step 1 "관심 전략" 으로 자동 이동 | P2 |

### 3.4. `src/Pricing.jsx` (672 라인)

| 라인 | 발견 | 우선순위 |
|------|-----|---------|
| 84, 88, 92, 96 | FAQ 답변에 "14일 무료 체험", "환불 가능" 등 실 결제 전제 카피. 베타 단계임을 명시 | P0 (A 와 연동) |
| 473 | "결제 진행 시" — 베타 단계에선 결제 진행 자체가 없음. 카피 변경 | P0 |

### 3.5. `src/Onboarding.jsx` (559 라인)

- 별도 audit 가 필요. 본 sprint 에서는 손대지 않음. 차후 PLAN-SVC 단독 spec 으로 작성 예정.

### 3.6. `src/CopyTrading.jsx` (646 라인)

| 라인 | 발견 | 우선순위 |
|------|-----|---------|
| 207 | "${modeLabel}로 팔로우" — modeLabel 변수 의존인데, 가독성 위해 "신호 알림 받기" / "설정 복사하기" 로 직접 분기 권장 | P2 |
| 214~225 | BottomSheet description "⚠️ 카피트레이딩 면책 동의" — 모바일에서 헤더 (description) 영역에 들어가서 본문과 시각 분리 모호. 본문 상단에 별도 yellow 박스로 분리 | P2 |

### 3.7. `src/BacktestCompare.jsx` (692 라인)

| 라인 | 발견 | 우선순위 |
|------|-----|---------|
| 236~239 | 자동 실행 (debounce 300ms) — 사용자가 전략 토글 중간에 자동 fetch 발생. 첫 mount 외에는 수동 "실행" 버튼 권장. (지금은 toggle 6번 = fetch 6번) | P1 |
| 444~448 | 에러 메시지 (E-5 와 통합) | P0 |
| 636 | 빈 상태 "결과가 없어요" — 카피 더 친절히 ("선택한 전략·기간 조합으로 데이터가 부족합니다") | P2 |

### 3.8. `src/PortfolioAnalysis.jsx` (515 라인)

- D-1, D-2 와 통합. 추가 미발견.

### 3.9. `src/NotificationHub.jsx` (625 라인)

| 라인 | 발견 | 우선순위 |
|------|-----|---------|
| 전반 | 알림 카드 type 별 (price / signal / news / 시스템) 색상 구분 약함. 좌측 색상 막대 추가 권장 | P2 |
| 전반 | "읽지 않음" 필터/정렬 UI 가 없음. 알림이 100개 쌓이면 사용 불가 | P1 |

### 3.10. `src/SavedScreeners.jsx` (412 라인)

| 라인 | 발견 | 우선순위 |
|------|-----|---------|
| 84 | `confirm()` 네이티브 다이얼로그 사용 — 모바일에서 OS 스타일 dialog 가 튀어나옴. Zepta 커스텀 confirm modal 사용 권장 | P1 |
| 95~123 | 낙관적 업데이트 (C-1 와 통합) | P0 |

### 3.11. `src/BotLeaderboard.jsx` (521 라인)

- F-1, F-2, F-3 와 통합.

### 3.12. `src/BotReport.jsx` (502 라인)

| 라인 | 발견 | 우선순위 |
|------|-----|---------|
| 전반 | equity curve 차트 — 모바일에서 X 축 라벨 겹침. 라벨 회전 또는 모바일 전용 simplified 버전 | P2 |
| 전반 | "거래 내역 N건" 빈 상태 — 매매 0회 봇 진입 시 사용자가 "뭐가 잘못된 건가" 의심. "아직 첫 매매를 기다리는 중" 카피로 안내 | P1 |

---

## 4. DEV 4명 분배 제안

각 DEV 는 독립적으로 병렬 작업. 충돌 가능 영역(예: App.jsx 메뉴 라벨)은 DEV1 이 단독 책임.

### DEV1 — 글로벌 UI/UX (P1 중심)
- **B-1, B-2** 메뉴명 전면 재정비 + i18n 동기화
- **J** 토스트 위치·시간·max-width 정책 통일
- **I-1, I-2, I-3** 카드 elevation / Empty-Loading-Error 통일 / CTA 위계 (P2 — 시간 여유 있을 때)
- 파일: `src/App.jsx`, `src/i18n/ko.json`, `src/i18n/en.json`, `src/ui/theme.jsx`, `src/ui/primitives.jsx`
- 예상 소요: 4~6시간

### DEV2 — 자동매매 카피 + 구독 베타 (P0)
- **E-1** AutoTrading 활성화 다이얼로그 카피 (실제→모의)
- **H** AutoTrading 토스트 카피 (실전매매→모의매매)
- **E-2** 앙상블 봇 투입 모달 카피·시각 (P1)
- **A-1, A-2** Pricing 베타 배지 + 결제 차단 모달 + FAQ
- 파일: `src/AutoTrading.jsx`, `src/Pricing.jsx`, (신규) `api/beta-waitlist.mjs`
- 예상 소요: 3~5시간

### DEV3 — 저장조건 즉시 반영 + 포트분석 UX
- **C-1** SavedScreeners 낙관적 업데이트 + 임시 카드 + 롤백
- **D-1** PortfolioAnalysis 첫 사용 가이드 + ⓘ 툴팁 + primary CTA
- **D-2** 자산 자동완성 (P2 — 시간 남으면)
- 파일: `src/SavedScreeners.jsx`, `src/PortfolioAnalysis.jsx`, (필요 시) `api/screeners-save.mjs`
- 예상 소요: 3~4시간

### DEV4 — 리더보드 + 알파랩 + 백테스트 OHLC fix
- **F-1, F-2, F-3** BotLeaderboard 매매 0회 필터·Top3 강조·본인 봇 모바일 layout
- **G-1, G-2** AlphaLab/BotLeaderboard family/strategy 미매핑 ID 숨김 + 한글 매핑
- **E-4** BottomSheet z-index 정책 통일
- **E-5** BacktestCompare 에러 UI + 재시도 + 백엔드 fallback (coingecko/stooq)
- 파일: `src/BotLeaderboard.jsx`, `src/AlphaLab.jsx`, `src/CopyTrading.jsx`, `src/ui/bottom-sheet.jsx`, `src/ui/primitives.jsx`, `src/BacktestCompare.jsx`, `api/backtest-compare.mjs`
- 예상 소요: 5~7시간 (백엔드 fallback 작업 비중 큼)

---

## 5. 검수 체크리스트 (배포 전 DEV-QA 가 통과해야 할 항목)

- [ ] AutoTrading 봇 활성화 시 "실제 자금" 단어가 한 곳도 안 보임
- [ ] Pricing 페이지 진입 시 "🧪 베타" 배지 즉시 노출
- [ ] Pricing 구독 버튼 클릭 시 결제 시뮬레이션 안내 모달이 먼저 표시
- [ ] SavedScreeners 추천 조건 추가 → 클릭 즉시 카드 등장 (네트워크 throttle 1Mbps 환경)
- [ ] CopyTrading 모바일 면책 모달 열림 시 하단 nav 가 위에 보이지 않음
- [ ] BacktestCompare 일부러 잘못된 심볼 입력 시 재시도 버튼 표시
- [ ] BotLeaderboard 진입 시 tradeCount=0 행이 보이지 않음
- [ ] AlphaLab 진입 시 "trend", "unknown" 같은 raw 영문 ID 가 안 보임
- [ ] 모바일 빠른접근 14개 버튼 라벨이 신규 카피로 모두 변경
- [ ] 모바일 하단 nav 라벨 4개 ("홈" / "스크리너" / "AI 자동" / "자산" / "더보기") 노출
- [ ] 토스트 4초 동안 표시되고 헤더 바로 아래 위치 (다이내믹 아일랜드 비간섭)

---

## 6. 의사결정 보류 항목 (대표 확인 요청)

1. **카피트레이딩 메뉴명 "따라하기"** — 직관적이지만 "따라하다=흉내" 뉘앙스라 컴플라이언스 측에서 우려 가능. 대안: "팔로잉 봇" / "신호 구독". 대표 판단 요청.
2. **AlphaLab → "전략 연구소"** — 너무 학술적 톤. 대안: "알파 발굴소" / "전략 분석". 대표 판단 요청.
3. **베타 결제 차단** — 완전 차단 (버튼 비활성화) vs 안내 모달 + 시뮬레이션 진행 가능 — 후자를 spec 으로 작성했으나, 컴플라이언스 안전 측면에서 완전 차단이 더 안전.

---

## 부록

### [B-2 부록] 메뉴 hover 설명 카피

| 라벨 | hover 1줄 설명 |
|------|--------------|
| 스크리너 | 조건에 맞는 종목을 실시간으로 찾아요 |
| AI 자동매매 | Zepta 의 AI 가 봇으로 모의 매매를 진행해요 |
| 전략 연구소 | 매시간 평가되는 전략의 안정성·수익률 추이 |
| 봇 순위 | 모든 사용자 봇의 익명 성과 랭킹 |
| 따라하기 | 다른 봇의 진입·청산 신호를 받거나 설정 복사 |
| 전략 분석 | 개별 전략의 작동 원리·과거 성과 |
| 과거 시뮬레이션 | 한 전략의 과거 수익률 시뮬레이션 |
| 전략 비교 시뮬 | 같은 자산·기간에 여러 전략 동시 비교 |
| 포트폴리오 진단 | 보유 자산의 배분·상관관계·분산도 점검 |
| 저장한 스크리너 | 내가 저장한 스크리닝 조건과 알림 관리 |
| 알림 | 가격·시그널·뉴스 알림 모아보기 |
| 구독 플랜 | Pro / Premium 기능과 가격 안내 |
| 뉴스 | 시장에 영향을 주는 뉴스 큐레이션 |
| 경제 캘린더 | CPI·FOMC 등 주요 일정 |

---

**작성 완료**. DEV 4명은 위 분배안에 따라 즉시 착수해주세요. 동시에 작업하더라도 충돌 영역이 없도록 파일 단위 분리해두었습니다.

– PLAN-SVC
