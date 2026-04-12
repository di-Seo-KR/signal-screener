---
name: context7
description: |
  최신 라이브러리/프레임워크 문서를 실시간으로 조회하여 정확한 코드를 작성하도록 돕는 스킬입니다.
  React, Vite, Tailwind CSS, shadcn/ui, Supabase, Vercel, Yahoo Finance API 등
  Zepta 프로젝트에서 사용하는 기술 스택의 공식 문서를 웹 검색으로 조회합니다.
  
  반드시 이 스킬을 사용해야 하는 상황:
  - 라이브러리 API가 변경되었는지 확인이 필요할 때
  - 새로운 라이브러리나 프레임워크를 도입할 때
  - 특정 함수/컴포넌트의 정확한 사용법이 필요할 때
  - "이 API 아직 쓸 수 있어?", "최신 버전에서 뭐가 바뀌었어?" 같은 질문
  - 에러가 발생했는데 라이브러리 버전 문제가 의심될 때
  - shadcn/ui 컴포넌트 사용법, Tailwind v4 문법, Supabase 쿼리 패턴 확인
---

# Context7 — 실시간 기술 문서 조회 스킬

## 목적

코드를 작성할 때 훈련 데이터에 의존하지 않고, **공식 문서를 실시간으로 조회**하여
최신 API, 사용법, Breaking Changes를 반영한 정확한 코드를 생산합니다.

## Zepta 기술 스택 참조 테이블

| 기술 | 버전 | 공식 문서 URL |
|------|------|--------------|
| React | 19.x | https://react.dev |
| Vite | 6.x | https://vite.dev |
| Tailwind CSS | v4 | https://tailwindcss.com/docs |
| shadcn/ui | v4.2.0 | https://ui.shadcn.com |
| Supabase | latest | https://supabase.com/docs |
| Vercel | latest | https://vercel.com/docs |
| Recharts | 2.x | https://recharts.org/en-US/api |
| Yahoo Finance API | - | https://finance.yahoo.com (비공식) |
| i18next | latest | https://www.i18next.com |

## 워크플로우

### Step 1: 필요한 문서 식별
코드 작성 전에 어떤 라이브러리/API의 문서가 필요한지 판단합니다.

### Step 2: 웹 검색으로 공식 문서 조회
WebSearch 또는 WebFetch 도구를 사용하여 공식 문서를 조회합니다.

검색 쿼리 패턴:
```
"{라이브러리명} {API/함수명} documentation site:{공식사이트}"
```

예시:
```
"shadcn/ui dialog component site:ui.shadcn.com"
"tailwind css v4 dark mode site:tailwindcss.com"
"supabase javascript client auth site:supabase.com"
"react useOptimistic hook site:react.dev"
```

### Step 3: 문서 내용 검증 및 적용
- 조회한 문서의 버전이 프로젝트와 일치하는지 확인
- Breaking Changes가 있다면 마이그레이션 방법 확인
- 코드에 적용할 때 프로젝트 컨벤션(JSX, no TypeScript, C 테마 객체, t() i18n)에 맞게 변환

## 주의사항

- 훈련 데이터의 API 사용법과 실제 최신 문서가 다를 수 있으므로, 확신이 없으면 반드시 조회
- shadcn/ui v4와 v3는 import 경로가 다르므로 항상 v4 문서 참조
- Tailwind CSS v4는 `@apply` 대신 유틸리티 클래스 직접 사용 권장
- Supabase Auth v2의 API 변경사항 주의 (signInWithPassword 등)

## 출력 형식

문서 조회 후 다음 형식으로 보고:
```
📚 [라이브러리명] 문서 조회 결과:
- 확인한 API: {함수/컴포넌트명}
- 현재 버전: {버전}
- 주요 변경사항: {있으면 기술}
- 적용 방법: {코드 스니펫}
```
