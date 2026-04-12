---
name: security-guidance
description: |
  웹 애플리케이션 보안 검증 및 가이드라인 스킬입니다.
  코드의 보안 취약점을 식별하고, OWASP Top 10 기준으로 검증하며,
  안전한 코딩 패턴을 제안합니다.
  
  반드시 이 스킬을 사용해야 하는 상황:
  - 새로운 API 엔드포인트나 서버리스 함수 작성 시
  - 사용자 입력을 처리하는 코드 작성 시
  - 인증/인가 로직 구현 또는 수정 시
  - localStorage에 민감한 데이터를 저장하려 할 때
  - 환경 변수나 API 키를 다룰 때
  - "이 코드 보안 문제 없어?", "보안 점검해줘" 같은 요청
  - 배포 전 보안 체크리스트가 필요할 때
  - XSS, CSRF, 인젝션 등 보안 관련 키워드가 언급될 때
---

# Security Guidance — 웹 보안 검증 스킬

## 목적

Zepta 투자 서비스는 금융 데이터를 다루므로 보안이 특히 중요합니다.
코드 작성 및 리뷰 시 보안 취약점을 사전에 식별하고 안전한 패턴을 제시합니다.

## Zepta 보안 컨텍스트

| 영역 | 현재 구현 | 보안 고려사항 |
|------|----------|-------------|
| 인증 | Supabase Auth | 세션 토큰 관리, OAuth 플로우 |
| 데이터 저장 | localStorage | 민감 정보 암호화, XSS 시 탈취 위험 |
| API 통신 | Yahoo Finance API | API 키 노출 방지, CORS 설정 |
| 서버리스 | Vercel Edge Functions | 환경 변수 관리, Rate Limiting |
| 사용자 입력 | 검색, 예측, 퀴즈 | XSS 방지, 입력 검증 |

## 보안 검증 체크리스트

### 1. 클라이언트 사이드 (React/Vite)

```
□ XSS 방지
  - dangerouslySetInnerHTML 사용 여부 확인
  - 사용자 입력을 직접 DOM에 삽입하지 않는지 확인
  - URL 파라미터를 검증 없이 사용하지 않는지 확인

□ 민감 데이터 보호
  - localStorage에 토큰/비밀번호 저장 금지 (Supabase 세션은 예외)
  - console.log에 민감 정보 출력 금지
  - 소스코드에 하드코딩된 API 키/시크릿 없는지 확인

□ 의존성 보안
  - 알려진 취약점이 있는 패키지 사용 여부
  - CDN에서 로드하는 스크립트의 무결성(SRI) 확인
```

### 2. 서버 사이드 (Vercel Edge Functions / API Routes)

```
□ 인증/인가
  - 모든 보호된 엔드포인트에 인증 검증 존재
  - Supabase RLS(Row Level Security) 활성화 확인
  - JWT 토큰 검증이 서버에서 수행되는지 확인

□ 입력 검증
  - 모든 사용자 입력에 대한 서버 사이드 검증
  - SQL 인젝션 방지 (Supabase 클라이언트 사용 시 기본 방어)
  - Path Traversal, Command Injection 방지

□ API 보안
  - Rate Limiting 구현 여부
  - CORS 정책이 적절한지 확인
  - 에러 메시지에 내부 정보 노출 여부
```

### 3. 배포/인프라

```
□ 환경 변수
  - .env 파일이 .gitignore에 포함되어 있는지
  - VITE_로 시작하는 환경 변수에 민감 정보가 없는지
    (VITE_ 접두사 변수는 클라이언트에 노출됨!)
  - Vercel 환경 변수가 적절한 스코프(Production/Preview/Development)로 설정

□ 헤더 및 정책
  - Content-Security-Policy 헤더 설정
  - X-Frame-Options (클릭재킹 방지)
  - Strict-Transport-Security (HTTPS 강제)
```

## 취약점 발견 시 보고 형식

```
🔒 보안 검증 결과:

[심각도: 높음/중간/낮음]
- 위치: {파일:라인}
- 취약점: {취약점 유형}
- 위험: {발생 가능한 공격 시나리오}
- 수정: {구체적인 코드 수정 방안}
```

## 안전한 코딩 패턴 (Zepta 프로젝트)

### localStorage 사용 패턴
```javascript
// ❌ 위험: 민감 정보 직접 저장
localStorage.setItem("apiKey", key);

// ✅ 안전: 비민감 데이터만 저장 (예: 사용자 설정, 퀴즈 기록)
localStorage.setItem("zepta:quiz:" + dateKey, JSON.stringify({ answered: true, correct: true }));
```

### 사용자 입력 처리 패턴
```javascript
// ❌ 위험: 검증 없이 사용
const query = new URLSearchParams(location.search).get("q");
document.title = query;

// ✅ 안전: 검증 후 사용
const query = new URLSearchParams(location.search).get("q");
const sanitized = query?.replace(/[<>"'&]/g, "") || "";
document.title = `Zepta - ${sanitized.slice(0, 100)}`;
```

### API 키 관리 패턴
```javascript
// ❌ 위험: 클라이언트에 노출
const VITE_SECRET_KEY = import.meta.env.VITE_SECRET_KEY;

// ✅ 안전: 서버 사이드에서만 사용 (Vercel API Route)
// api/yahoo-batch.js
const SECRET_KEY = process.env.SECRET_KEY; // VITE_ 접두사 없음
```
