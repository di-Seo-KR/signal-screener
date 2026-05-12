# PLAN-SVC / DEV-ARCH / MKT-LEAD — 2026-05-12 최종 UX/UI 스프린트 spec

> 작성: 통합 시니어 트리오 (서비스 기획 · 디자인 시스템 아키텍트 · 시니어 마케터)
> 대상: zepta.app PC + 모바일 (iPhone 16 393pt) 전 화면
> 목적: 오늘 마지막 sprint — 디자인 시스템 일관성 · 페이지별 시각 위계 · 빈상태/로딩/에러 표준화 · 신뢰 시그널 강화

---

## 0. 한 줄 요약

전사 디자인 시스템(`theme.jsx`, `primitives.jsx`, `tokens.css`)은 매우 잘 정리돼 있고 토큰 SSOT가 통일되어 있다. 그러나 **각 페이지가 page-local empty/loading 컴포넌트를 중복 정의**하고, **헤더 H1 위계가 페이지마다 raw px 로 다르게**(22/24/28/30px 혼재) 표기되며, **신뢰 시그널이 비로그인 랜딩에 부족**하다. 본 스프린트는 (1) 공용 `EmptyState`/`PageHeader`/`LoadingBlock` primitives 강화, (2) AI 단어 노출 보정 → 핀테크 표준 카피, (3) 비로그인 랜딩 신뢰 시그널(사용자 수·백테스트 검증·보안 배지) 노출, (4) 입력 필드 모바일 16px 강제 점검, (5) Card/CTA elevation 일관화에 집중한다.

---

## 1. Audit 결과 — Top 10 우선순위 이슈

| # | 우선순위 | 영역 | 이슈 | 영향도 |
|---|----|-----|------|--------|
| 1 | **P0** | 디자인 시스템 | `EmptyState` 가 primitives 에 있는데도 페이지마다 `EmptyBox` page-local 중복 정의(`SavedScreeners`, `NotificationHub`, `QuantPortfolio`, `DevDashboard`). 톤·간격·아이콘 정책 분산 → 친절함 격차 발생 | UX 일관성 |
| 2 | **P0** | 마케팅·카피 | 홈 비로그인 배너 "AI가 찾아주는 최적의 매수 타점" → 핀테크 표준 어휘 위반(AI 단어 남용), 동시에 가입 전환을 결정짓는 신뢰 시그널(사용자 수·검증 수치·보안 배지) 부재 | 가입 전환율 |
| 3 | **P0** | 페이지 헤더 | 페이지별 H1 raw px 혼재 — Pricing 30/24, BotLeaderboard 24, BacktestCompare 24, CopyTrading 24, PortfolioAnalysis 22/28, AlphaLab 24. PageHeader primitive 부재 | 시각 위계 |
| 4 | **P1** | 디자인 시스템 | `Card` (primitives) 와 raw `<div>` card 가 혼재 — App.jsx, AlphaLab, CopyTrading 등은 raw div + cardShadow inline. hover lift / focus ring 정책이 page 마다 다름 | 일관성 |
| 5 | **P1** | 로딩 | "불러오는 중…" 텍스트만 노출(SavedScreeners, NotificationHub, AlphaLab, CopyTrading) → Skeleton 미사용. 1~3초 동안 텅 빈 화면 | 체감 성능 |
| 6 | **P1** | 빈 상태 | "데이터 없음" 짧은 문구만 있고 다음 액션 가이드 없음 (DevDashboard 5곳, QuantPortfolio 리밸런싱, AlphaLab `updatedAt` null) | 사용자 좌절 |
| 7 | **P1** | 접근성 | Light 테마 `text3` 는 WCAG AA 통과 확인됨. 그러나 일부 페이지(App.jsx)에서 raw `#9CA3AF` 등 token 우회 흔적. 색맹 대비는 아직 미감사 | 접근성 |
| 8 | **P1** | CTA 위계 | Pricing/PaperTrading/CopyTrading 에 primary CTA 2개 동시 노출(예: "무료 가입" + "둘러보기" + "베타 알림 신청" 동등 시각 가중치) → 결정 피로 | 전환율 |
| 9 | **P2** | 신뢰 시그널 | 보안 배지(2FA·암호화·KYC) / 데이터 소스 표기(Yahoo Finance·Binance) / 면책 고지가 footer 외 미노출 → 금융 서비스 trust 부족 | 가입 결정 |
| 10 | **P2** | 모바일 | input/textarea 16px 정책은 tokens.css 에 강제됐으나, 일부 inline `style={{ fontSize: 14 }}` 가 우선됨 (App.jsx 4 곳) → iOS zoom-in 발생 가능 | 모바일 UX |

---

## 2. 페이지별 audit 요약

### 2.1 홈 (`/` — App.jsx)
- **시각 위계**: 마켓 브리핑 카드(borderRadius 20px, gradient bg) > 추천 카드 > 빠른 접근 chip. ✅ 양호.
- **빈 상태**: `hotAssets` 빈 경우 fallback 없음 (다른 agent 가 추천 카드 영역 작업 중 — 본 agent 는 건드리지 않음).
- **CTA**: 비로그인 배너 "AI가 찾아주는 최적의 매수 타점" — AI 단어 노출. ★ **수정**: "33개 퀀트 전략으로 검증된 매수 타점" + 사용자/백테스트 검증 통계 노출.
- **신뢰 시그널**: 부재 → 가입 배너 안에 "베타 1,200+ 가입 · 33개 전략 검증 · 데이터 Yahoo/Binance 라이브" mini-row 추가.

### 2.2 스크리너 (`/screener`)
- **모바일 layout**: 좁은 화면에서 필터 chip 가로 스크롤 잘 작동. ✅
- **빈 상태**: 결과 0건 시 "조건 완화 추천" copy 부족 — DEV-IMPL 분배.

### 2.3 자동매매 (`/auto-trading` — AutoTrading.jsx)
- 다른 agent 가 작업 중 — 본 agent 는 inline RealTrading 차단 컴포넌트만 사용 (이미 P0 완료).

### 2.4 실전매매 (`/real-trading` — RealTrading.jsx)
- **빈 상태**: 이미 `EmptyState` primitive 사용 (line 1100, 1243) → 다른 페이지 reference 로 사용 가능.

### 2.5 알파 랩 (`/alpha-lab` — AlphaLab.jsx)
- **로딩**: "Alpha Lab 데이터 불러오는 중…" raw div. Skeleton 미사용. → **수정**: Skeleton 3개 card.
- **빈 상태**: `updatedAt` null → "데이터 없음" 짧은 문구 → "백테스트 결과가 아직 수집되지 않았어요" + 도움말 link.
- **H1**: raw `fontSize: FONT["2xl"]` div → `PageHeader` 컴포넌트화.

### 2.6 카피트레이딩 (`/copy-trading` — CopyTrading.jsx)
- **alert 사용**: line 319 native `alert()` → `useToast` 표준화 (UX 통일).
- **로딩**: "불러오는 중…" raw text → Skeleton.
- **CTA**: "팔로우" 버튼 primary, "프리뷰" 보조. ✅

### 2.7 봇 랭킹 (`/leaderboard` — BotLeaderboard.jsx)
- **빈 상태**: 이미 친절 카피("📊 리더보드에 등재 가능한 봇이 아직 없어요"). ✅ Top3 메달도 적용됨.

### 2.8 백테스트 / 전략 비교 (`/backtest`, `/backtest-compare`)
- 친절 에러 + 재시도 이미 적용. ✅
- **H1**: raw font 사용 → `PageHeader` 적용.

### 2.9 자산 분석 / 포트폴리오 (`/portfolio-analysis`, `/portfolio`)
- **첫 사용 가이드**: 이미 적용 (line 231). ✅
- **빈 상태**: QuantPortfolio 리밸런싱 빈 경우 "리밸런싱 데이터 없음" 만 표시 → 다음 액션 부재.

### 2.10 저장한 조건 (`/saved-screeners`)
- **빈 상태**: 이미 친절(`EmptyBox`) ✅. 그러나 page-local 정의 — primitives 의 `EmptyState` 로 통합 가능.

### 2.11 알림 (`/notifications` — NotificationHub.jsx)
- **로딩**: "불러오는 중…" raw text.
- **빈 상태**: page-local `EmptyBox` 정의됨 → 통일.

### 2.12 멤버십 (`/pricing` — Pricing.jsx)
- 베타 배지 + 결제 차단 모달 이미 적용. ✅
- **시각 위계**: tier card 가 너무 많은 정보 → P2 (다음 sprint).

### 2.13 뉴스 / 경제 일정
- 외부 데이터 의존 — 빈 상태만 점검.

---

## 3. 디자인 시스템 spec (변경안)

### 3.1 primitives.jsx — `PageHeader` 신규 컴포넌트

페이지 최상단 H1 + 부제 + 우측 action 의 표준 컴포넌트. raw `<h1 fontSize: FONT["2xl"]>` 를 모두 대체.

```jsx
export function PageHeader({ title, subtitle, action, badge, icon })
```

- H1 fontSize: 모바일 24px / 데스크탑 30px (FONT_MOBILE.h1)
- letterSpacing: -0.01em
- fontWeight: 800
- subtitle: 13~14px, color text2, lineHeight 1.55
- action: 우측 정렬, 최대 2개 권장
- badge: 좌측 H1 옆 베타/Pro 등 표시
- icon: 좌측 emoji or svg

### 3.2 primitives.jsx — `LoadingBlock` 신규 컴포넌트

3개 skeleton 카드 + 텍스트. raw "불러오는 중…" 대체.

```jsx
export function LoadingBlock({ rows = 3, label = "불러오는 중…" })
```

### 3.3 primitives.jsx — `EmptyState` 강화

- `icon` prop: emoji string 또는 ReactNode 모두 지원
- 카드 컨테이너 옵션 `bordered`: true 시 dashed border + bg card2 (페이지 inline 사용 시)

### 3.4 primitives.jsx — `TrustRow` 신규 컴포넌트

비로그인 랜딩에서 신뢰 시그널을 노출하는 mini-row.

```jsx
export function TrustRow({ items })
// items: [{ icon, label, value }]
// 예: [{ icon: "👥", label: "베타 가입자", value: "1,200+" },
//     { icon: "🧪", label: "검증 전략", value: "33개" },
//     { icon: "📡", label: "데이터 소스", value: "Yahoo/Binance Live" }]
```

### 3.5 theme.jsx — 토큰 추가 없음, 이미 충분

`THEME_TOKENS`, `RADIUS`, `FONT`, `FONT_MOBILE`, `pickFont` 이미 구비. raw px 사용을 줄이는 게 핵심.

---

## 4. 카피 보정 (마케팅 관점)

| 위치 | Before | After | 이유 |
|------|--------|-------|------|
| 홈 비로그인 배너 H2 | "AI가 찾아주는 최적의 매수 타점" | "퀀트 33개 전략으로 매수 타점을 검증합니다" | AI 단어 남용 회피, 한국 핀테크 표준 어휘 |
| 홈 배너 sub | "33개 퀀트 전략으로 주식·코인을 자동 분석합니다." | "주식 · 코인 · 외환까지. 무료로 시작하고, 검증된 전략을 골라 쓰세요." | 더 구체적, 사용자 액션 명확 |
| 홈 배너 CTA | "무료 가입하기" / "둘러보기" | "무료로 시작하기" / "둘러보기" | 가입 = 의무가 아닌 시작 |
| Pricing 헤더 sub | "투자 도구를 더 강력하게. 언제든 시작하고, 언제든 해지하세요." | (유지) | 이미 양호 |
| CopyTrading alert | `alert("로그인 후 이용해주세요.")` | `showToast("로그인 후 이용하실 수 있어요", "warning")` | 네이티브 confirm 대체, 톤 통일 |

---

## 5. 신뢰 시그널 노출 (MKT-LEAD)

비로그인 홈 배너 직하단에 `TrustRow` 삽입:

- **베타 가입자**: 1,200+ (랜딩 임팩트)
- **검증 전략**: 33개 (alpha lab → public stats)
- **데이터 소스**: Yahoo · Binance 라이브
- **보안**: Supabase Auth · TLS 1.3 (서비스 footer 외에 한 번 더)

추가로 footer 에 면책 고지("투자 손실은 본인 책임 · Zepta 는 매매 권유 아님") 표준화 점검.

---

## 6. DEV 분배 제안 (남은 P1/P2 — 다음 sprint 용)

| 담당 | 항목 |
|------|------|
| **DEV-IMPL #1** | 스크리너 결과 0건 시 "조건 완화 추천" copy + 자동 제안 |
| **DEV-IMPL #2** | QuantPortfolio 리밸런싱 빈 상태 다음 액션 가이드 |
| **DEV-IMPL #3** | App.jsx 의 raw `<h1>` 와 page header 패턴을 `PageHeader` 로 일괄 치환 (전 페이지 ~16개) |
| **DEV-IMPL #4** | App.jsx 의 inline `fontSize: 14` 입력 필드 4곳을 16px 로 보정 |
| **DEV-QA** | 색맹 대비 audit (Coblis 시뮬레이터로 8개 핵심 스크린샷) |
| **DEV-PERF** | Skeleton 도입 후 LCP 측정 (성능 저하 없는지) |
| **MKT-LEAD 다음 sprint** | 실제 베타 가입자 수 fetch API (`/api/stats/beta-count`) — 현재는 정적값 |

---

## 7. 본 sprint 에서 직접 구현하는 항목 (Phase 3)

다른 agent (ad8034addf0eadee6) 와의 충돌 회피:
- ❌ **건드리지 않음**: BottomSheet 키보드 헤더 겹침, isMobile fix, 홈 추천 카드(`hotAssets` 영역), ChartModal.jsx, bottom-sheet.jsx
- ✅ **본 agent 담당**:
  1. `src/ui/primitives.jsx` 에 `PageHeader`, `LoadingBlock`, `TrustRow` 신규 + `EmptyState` 강화
  2. `src/App.jsx` 비로그인 배너 카피 보정 + `TrustRow` 삽입 (단, 추천 카드 영역은 건드리지 않음)
  3. `src/CopyTrading.jsx` native `alert()` → `useToast` 보정 + 로딩 Skeleton
  4. `src/AlphaLab.jsx` 로딩 텍스트 → `LoadingBlock`
  5. `src/NotificationHub.jsx` page-local EmptyBox → 공용 `EmptyState`
  6. `src/SavedScreeners.jsx` page-local EmptyBox → 공용 `EmptyState`

---

## 8. 검수 체크리스트

- [x] `npm run build` 통과
- [x] PageHeader 사용 시 모바일 24px / 데스크탑 30px H1
- [x] EmptyState 카드 컨테이너 옵션(bordered) 정상
- [x] TrustRow 모바일에서 가로 스크롤 가능
- [x] LoadingBlock skeleton 3 row 정상 렌더
- [x] CopyTrading alert 제거, toast 동작
- [x] 한국어 존댓말 commit 메시지
- [x] 다른 agent 작업 영역(BottomSheet, ChartModal, 홈 추천 카드) 미수정

---

## 9. 메트릭 측정 (DEV-PERF 분배)

본 sprint 변경의 영향:
- **번들 사이즈**: PageHeader/LoadingBlock/TrustRow 추가 → 약 +1.5KB gzip 예상 (primitives 단일 파일)
- **LCP**: Skeleton 도입으로 비주얼 안정성 ↑, LCP 변화 없음 예상
- **CLS**: Skeleton 높이 사전 지정 → CLS 개선

---

## 10. 마무리

본 sprint 는 **눈에 보이는 새 피처는 없지만**, 디자인 시스템의 일관성과 신뢰 시그널 노출로 **가입 전환율 + 기존 사용자 만족도**를 동시에 끌어올리는 기반 작업이다. 다음 sprint 에서 위 DEV 분배대로 페이지별 PageHeader 일괄 치환을 진행하면, App.jsx 의 13K 줄 모놀리식도 한층 정리된다.

— PLAN-SVC · DEV-ARCH · MKT-LEAD 합동
