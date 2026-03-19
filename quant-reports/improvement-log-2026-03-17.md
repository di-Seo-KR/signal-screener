# DI금융 일일 개선 로그 — 2026-03-17

## 변경 요약

### 1. TTM Squeeze 전략 도입 (strategies.js)
- 기존 BB 스퀴즈 전략을 TTM Squeeze 방식으로 전면 업그레이드
- BB가 Keltner Channel 내부에 수축할 때 진정한 스퀴즈로 판별
- 선형회귀 잔차 기반 모멘텀 오실레이터 추가 (TTM 핵심 요소)
- 스퀴즈 해제(fired) 시점을 가장 강력한 신호로 분류
- 거래량 임계값을 스퀴즈 해제 여부에 따라 동적 조정
- 시그널 reason에 모멘텀 방향(↑/↓) 표시 추가

### 2. 스크리닝 카드 UI 강화 (App.jsx)
- 지표 상세 그리드에 ADX 지표 추가 (+DI/-DI 우세 방향 표시)
- TTM Squeeze ON/OFF 상태 표시 추가
- RSI 과매수 구간(≥70) 색상 표시 추가 (기존 과매도만 표시)
- 수급 종합 섹션에 ADX 방향 뱃지 추가 (ADX≥25 시)
- 수급 종합 섹션에 TTM Squeeze ON 뱃지 추가
- analyzeAsset 반환값에 adx, plusDI, minusDI, bbSqueeze 필드 추가
- 조건 메타데이터에서 "볼린저 스퀴즈" → "TTM 스퀴즈"로 라벨 업데이트

### 3. 차트 모달 진단 고도화 (ChartModal.jsx)
- VWAP 근사 계산 추가 (20일 거래량 가중 평균가)
- 피벗 포인트 기반 지지/저항 레벨 자동 탐지
- MA 수렴도 계산으로 추세 전환 조기 감지
- VWAP 상회/하회 시 trendScore 반영 + 시그널 추가

### 4. 전략 패널 모바일 최적화 (StrategyPanel.jsx)
- 전략 그리드 minmax를 min(240px, 100%)로 변경 (소형 화면 대응)
- 전략 카드 레이아웃 개선: 카테고리 뱃지를 헤더 우측으로 이동

## 기술 노트
- strategies.js 문법 검증 통과 (node -c)
- 기존 BB 스퀴즈 폴백 로직 유지 (하위 호환성)
- TTM Squeeze 파라미터: KC ATR mult 1.5 (표준 값)
