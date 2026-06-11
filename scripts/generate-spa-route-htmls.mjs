#!/usr/bin/env node
// scripts/generate-spa-route-htmls.mjs
//
// Vite build 후 실행 — dist/index.html 을 베이스로 SPA 경로 별 정적 HTML 생성.
//
// 2026-05-12 SEO 색인 누락 fix (Google Search Console "발견됨 - 색인 생성 안됨" 13개 URL):
//  - 각 페이지에 H1 / intro / 기능 bullet / FAQ prerender 콘텐츠를 #root 내부에 삽입.
//    React 가 ReactDOM.createRoot(...).render(...) 호출 시 #root 내부가 덮어쓰여
//    사용자 경험에는 영향 없음. 단, Googlebot 은 JS 실행 전 prerender 콘텐츠를 thin-content
//    소프트 404 판정 회피용으로 먼저 수집함.
//  - FAQ 가 있는 페이지는 FAQPage JSON-LD 자동 주입 → Google FAQ rich snippet 후보.
//  - <title>, canonical, og/twitter 메타는 기존대로 페이지별 교체.
//
// vercel.json 의 rewrites 가 각 경로를 해당 HTML 로 매핑해야 함.

import fs from "fs";
import path from "path";

const DIST = "dist";

// SPA 경로 + 경로별 SEO 메타데이터 + prerender 콘텐츠.
// 새 경로 추가 시 여기에만 추가.
//
// 각 엔트리 필드:
//   path     : URL 경로 (예: "alerts" → /alerts → dist/alerts.html)
//   title    : <title> 및 og:title
//   desc     : meta description 및 og:description
//   h1       : prerender H1 (페이지 핵심 메시지)
//   intro    : prerender 첫 문단 (1~2 문장, 검색 결과 스니펫 후보)
//   features : 3~5개 핵심 기능 bullet (각 "키워드 — 설명" 형식)
//   faq      : Q&A 3개 (Google FAQ rich snippet 대상)
const ROUTES = [
  {
    path: "screener",
    title: "Zepta 스크리너 — AI가 찾는 매수 종목 실시간 스코어",
    desc: "주식·코인 실시간 스크리닝. 알파 33개 통합 점수, 멀티팩터, 골든크로스/RSI/MACD 자동 분석.",
    h1: "Zepta 스크리너 — AI가 매수 종목을 찾아드립니다",
    intro: "미국 주식과 글로벌 암호화폐를 실시간으로 스크리닝합니다. 33개 알파 시그널을 통합한 종목별 스코어로 매수 후보를 빠르게 식별하세요.",
    features: [
      "통합 알파 스코어 — 33개 시그널을 가중 평균한 종목별 매수 강도",
      "멀티팩터 필터 — 가격, 거래량, 변동성, 모멘텀을 한 화면에서 조합",
      "골든크로스·RSI·MACD — 검증된 기술적 시그널 자동 탐지",
      "실시간 데이터 — Yahoo Finance + Binance 시세를 분당 갱신",
      "주식·코인 통합 — 한 화면에서 글로벌 자산 비교",
    ],
    faq: [
      { q: "Zepta 스크리너는 무료인가요?", a: "기본 스크리닝과 알파 스코어 조회는 무료입니다. 고급 필터 저장과 알림 연동은 Pro 플랜에서 제공됩니다." },
      { q: "어떤 종목을 분석할 수 있나요?", a: "S&P 500 미국 주식, KOSPI/KOSDAQ 한국 주식, Binance Top 100 암호화폐를 실시간으로 분석합니다." },
      { q: "알파 시그널은 어떻게 검증되었나요?", a: "Zepta 알파 시그널은 walk-forward 백테스트로 검증되어 평균 Sharpe 1.5 이상의 성과를 보입니다." },
    ],
  },
  {
    path: "auto-trading",
    title: "Zepta 자동매매 — AI 33개 퀀트 봇 전략",
    desc: "백테스트 검증된 알파 기반 자동 진입·청산. 7개 코인 봇 + 6개 주식 봇 + 8개 strategy 다양화.",
    h1: "Zepta 자동매매 — AI 퀀트 봇이 24시간 매매합니다",
    intro: "백테스트로 검증된 알파 전략을 기반으로 자동 진입·청산합니다. 7개 코인 봇과 6개 주식 봇, 8개 strategy 조합으로 리스크를 분산하세요.",
    features: [
      "13개 자동매매 봇 — 코인 7개 + 주식 6개, 자산 클래스 다각화",
      "8개 strategy 조합 — 추세, 돌파, 평균회귀, 앙상블을 자유롭게 선택",
      "자동 진입·청산 — 알파 시그널 발생 시 즉시 매매, 손절·익절 자동",
      "포지션 사이징 — 켈리 공식 기반 자금 배분",
      "텔레그램 알림 — 매매 발생 시 모바일 실시간 알림",
    ],
    faq: [
      { q: "자동매매에 별도 API 키가 필요한가요?", a: "Binance Futures USDM 의 경우 본인 API 키 등록 후 실거래가 가능하며, 페이퍼 트레이딩 모드는 키 없이 무료로 체험할 수 있습니다." },
      { q: "최소 운영 자금은 얼마인가요?", a: "페이퍼 트레이딩은 0원, 실거래는 Binance 기준 100 USDT 이상 권장입니다. 자금이 적을수록 수수료 비중이 커집니다." },
      { q: "손실이 발생할 수 있나요?", a: "투자에는 항상 원금 손실 위험이 있습니다. Zepta 는 백테스트 메트릭과 MDD 한도를 공개하지만 미래 수익을 보장하지 않습니다." },
    ],
  },
  {
    path: "real-trading",
    title: "Zepta 실전매매 — Binance Futures USDM 실거래",
    desc: "Binance Futures 실전매매 관제센터. 일/주 손익 한도, MDD 30일 rolling, 자동 force-close 안전망.",
    h1: "Zepta 실전매매 — Binance Futures 실거래 관제센터",
    intro: "Binance Futures USDM 계정과 연동하여 실전 자동매매를 운영합니다. 일·주 단위 손익 한도, 30일 rolling MDD, 자동 force-close 까지 안전망을 갖췄습니다.",
    features: [
      "Binance Futures USDM — API 키 연동으로 실거래 즉시 가동",
      "일·주 손익 한도 — 한도 초과 시 자동 매매 중단",
      "30일 rolling MDD — 최대 낙폭 한도 도달 시 신규 진입 차단",
      "자동 force-close — 청산가 근접 시 안전망으로 강제 청산",
      "Shadow 모드 — 실거래 전 페이퍼 모드로 전략 검증",
    ],
    faq: [
      { q: "Zepta 가 내 자금을 직접 보관하나요?", a: "아니오. 자금은 Binance 계좌에 그대로 있고, Zepta 는 매매 권한만 받은 API 키로 주문을 전송합니다. 출금 권한은 절대 요청하지 않습니다." },
      { q: "수수료는 어떻게 되나요?", a: "Binance 거래 수수료(0.04% 메이커/0.05% 테이커) 외 Zepta 는 별도 거래 수수료를 받지 않습니다. Pro 플랜 구독료만 발생합니다." },
      { q: "한국 거주자도 사용 가능한가요?", a: "Binance 자체 약관과 본인 거주국 법령을 우선 확인해 주세요. Zepta 는 한국 자본시장법상 일임매매가 아닌 신호 알림·자동 주문 도구입니다." },
    ],
  },
  {
    path: "alpha-lab",
    title: "Zepta Alpha Lab — 24/7 알파 추적·자동 개선",
    desc: "8개 strategy 의 Sharpe·PF·승률 매시간 leaderboard. 파라미터 자동 튜닝 + 시장 레짐 자동 적응.",
    h1: "Zepta Alpha Lab — 알파 전략을 24/7 추적·개선합니다",
    intro: "8개 strategy 의 Sharpe Ratio, Profit Factor, 승률을 매시간 leaderboard 로 갱신합니다. 파라미터 자동 튜닝과 시장 레짐 적응까지 자동화되어 있습니다.",
    features: [
      "매시간 leaderboard — 8개 strategy 성과를 실시간 순위로",
      "파라미터 자동 튜닝 — Grid search + Bayesian 최적화",
      "시장 레짐 감지 — Hurst·엔트로피 기반 추세/횡보 자동 구분",
      "Shadow → Production 승급 — 통계적 유의성 검증 후 자동 승급",
      "디머지 알림 — 성과 악화 strategy 자동 비활성화",
    ],
    faq: [
      { q: "Alpha Lab 의 결과는 어떻게 활용하나요?", a: "leaderboard 상위 strategy 를 자동매매 봇에 자동 매핑하거나, 본인 의사결정 보조 지표로 사용할 수 있습니다." },
      { q: "백테스트 데이터 기간은 얼마나 되나요?", a: "코인은 2018년 이후, 미국 주식은 2010년 이후 OHLC 데이터를 walk-forward 방식으로 평가합니다." },
      { q: "사용자도 직접 strategy 를 추가할 수 있나요?", a: "Premium 플랜에서 사용자 정의 알파 시그널을 등록하고 백테스트할 수 있습니다." },
    ],
  },
  {
    path: "portfolio",
    title: "Zepta 포트폴리오 — AI 리밸런싱",
    desc: "켈리·평균-분산·블랙리터만 다중 알고리즘 포트폴리오 최적화. 실시간 마켓벨류 + 자동 리밸런싱.",
    h1: "Zepta 포트폴리오 — AI 리밸런싱으로 자산을 최적화",
    intro: "켈리, 평균-분산, 블랙리터만 등 다중 알고리즘으로 포트폴리오를 최적화합니다. 실시간 마켓벨류 추적과 자동 리밸런싱 추천을 한 화면에서 확인하세요.",
    features: [
      "다중 최적화 알고리즘 — 켈리·평균분산·블랙리터만 동시 비교",
      "실시간 마켓벨류 — 보유 자산의 분 단위 평가액·손익 추적",
      "자동 리밸런싱 — 목표 비중 이탈 시 신호 발생",
      "위험 패리티 — 각 자산이 동일한 리스크 기여도를 갖도록 분배",
      "세금·수수료 반영 — 리밸런싱 비용까지 고려한 추천",
    ],
    faq: [
      { q: "어떤 자산을 포트폴리오에 담을 수 있나요?", a: "미국 주식, 한국 주식, 글로벌 암호화폐, ETF, 현금성 자산까지 통합 관리할 수 있습니다." },
      { q: "리밸런싱 주기는 어떻게 정하나요?", a: "월간, 분기, 임계값 도달 시 자동 등 3가지 모드를 지원합니다. 임계값 모드가 비용 효율이 가장 높습니다." },
      { q: "거래소 연동이 필요한가요?", a: "조회만이라면 수동 입력으로 충분합니다. 자동 리밸런싱 실행을 원하면 Binance·증권사 API 키 연동이 필요합니다." },
    ],
  },
  {
    path: "portfolio-analysis",
    title: "Zepta 포트폴리오 분석 — 분산도·상관관계·리밸런싱",
    desc: "보유 자산의 카테고리 배분, 30일 상관관계 히트맵, 분산 점수, 리밸런싱 추천을 한 화면에서 확인하세요.",
    h1: "Zepta 포트폴리오 분석 — 분산도와 상관관계를 한눈에",
    intro: "보유 자산의 카테고리 배분, 30일 상관관계 히트맵, 분산 점수, 리밸런싱 추천을 한 화면에서 확인합니다. 집중 리스크와 다각화 기회를 즉시 파악하세요.",
    features: [
      "카테고리 배분 — 주식·코인·현금 비중을 도넛 차트로 시각화",
      "30일 상관관계 히트맵 — 자산 간 동조성과 분산 효과 확인",
      "분산 점수 — Herfindahl 지수 기반 집중도 정량화",
      "리밸런싱 추천 — 과집중 자산 매도, 저비중 자산 매수 시그널",
      "변동성 기여도 — 각 자산이 포트폴리오 변동성에 미치는 영향",
    ],
    faq: [
      { q: "분산 점수가 낮으면 어떻게 해야 하나요?", a: "한 자산에 과도하게 집중되어 있다는 뜻입니다. 추천 리밸런싱을 따르거나 새로운 자산군을 추가해 분산도를 높이세요." },
      { q: "상관관계가 높은 자산은 피해야 하나요?", a: "꼭 그렇지는 않습니다. 같은 방향으로 움직이는 자산은 분산 효과가 적지만 추세 추종 전략에는 유리할 수 있습니다." },
      { q: "분석 데이터 출처는?", a: "Yahoo Finance (주식·ETF), Binance (코인) 의 일/시간 단위 OHLC 를 사용합니다." },
    ],
  },
  {
    path: "backtest",
    title: "Zepta 백테스트 — OHLC 시계열 walk-forward",
    desc: "30/60/90일 walk-forward 백테스트. Sharpe·PF·MDD·Calmar 자동 산출. 파라미터 grid search.",
    h1: "Zepta 백테스트 — Walk-forward 로 과거 성과를 검증",
    intro: "30/60/90일 walk-forward 방식으로 strategy 의 과거 성과를 검증합니다. Sharpe, Profit Factor, MDD, Calmar 비율을 자동 산출하여 객관적으로 비교하세요.",
    features: [
      "Walk-forward 백테스트 — 미래 데이터 누출 없는 엄정한 검증",
      "Sharpe·PF·MDD·Calmar — 4대 성과 메트릭 자동 산출",
      "파라미터 grid search — 최적 파라미터를 자동 탐색",
      "거래비용 반영 — 수수료·슬리피지를 포함한 현실적 백테스트",
      "에쿼티 커브 — 누적 손익 추이와 최대 낙폭 시각화",
    ],
    faq: [
      { q: "백테스트 데이터는 얼마나 정확한가요?", a: "Yahoo Finance 와 Binance 의 공식 OHLC 데이터를 사용합니다. 일봉 기준 99.9% 정확하며, 분봉은 일부 누락 가능성이 있습니다." },
      { q: "백테스트 성과가 미래 수익을 보장하나요?", a: "아니오. 백테스트는 과거 성과일 뿐이며 미래를 보장하지 않습니다. Walk-forward 방식으로 과적합을 최소화했지만 시장 레짐 변화 위험은 존재합니다." },
      { q: "내 strategy 도 백테스트할 수 있나요?", a: "Premium 플랜에서 사용자 정의 strategy 의 백테스트를 지원합니다." },
    ],
  },
  {
    path: "strategy",
    title: "Zepta 알파 전략 — 33개 검증된 퀀트 시그널",
    desc: "RSI/MACD/볼린저밴드/Hurst/ER/OBV 등 검증된 33개 알파. Family 별 가중치 자동 학습.",
    h1: "Zepta 알파 전략 — 33개 검증된 퀀트 시그널 모음",
    intro: "RSI, MACD, 볼린저밴드, Hurst 지수, Efficiency Ratio, OBV 등 검증된 33개 알파 시그널을 family 별로 정리했습니다. 각 시그널의 작동 원리와 백테스트 성과를 확인하세요.",
    features: [
      "Momentum family — RSI·MACD·Stochastic 등 추세 시그널",
      "Mean Reversion family — 볼린저밴드·Z-score·평균회귀",
      "Volatility family — ATR·Volatility Clustering·GARCH",
      "Market Structure family — Hurst·엔트로피·Efficiency Ratio",
      "Volume family — OBV·MFI·CMF 등 거래량 기반 시그널",
    ],
    faq: [
      { q: "33개 시그널 중 어떤 것이 가장 좋나요?", a: "시장 상황(추세/횡보)에 따라 최적 시그널이 달라집니다. Alpha Lab leaderboard 에서 현재 시장 레짐에 맞는 상위 시그널을 확인하세요." },
      { q: "시그널을 직접 조합할 수 있나요?", a: "스크리너에서 여러 시그널을 AND/OR 로 조합한 사용자 정의 필터를 만들 수 있습니다." },
      { q: "Hurst 지수가 뭔가요?", a: "시계열의 장기 기억(추세 지속성)을 측정하는 지표입니다. 0.5 초과면 추세, 미만이면 평균회귀 성향을 나타냅니다." },
    ],
  },
  {
    path: "risk-map",
    title: "Zepta 리스크 맵 — 상관관계·변동성·집중도 시각화",
    desc: "포지션 상관관계 히트맵, 변동성 레짐, 자산 집중도 분석. ATR/Hurst 기반 리스크 메트릭.",
    h1: "Zepta 리스크 맵 — 포트폴리오 위험을 한눈에",
    intro: "포지션 간 상관관계, 변동성 레짐, 자산 집중도를 종합 시각화합니다. ATR 과 Hurst 기반 리스크 메트릭으로 숨은 위험을 발견하세요.",
    features: [
      "상관관계 히트맵 — 자산 간 동조성을 색상으로 즉시 파악",
      "변동성 레짐 — 저변동/중변동/고변동 구간 자동 분류",
      "자산 집중도 — Herfindahl 지수와 카테고리별 비중",
      "ATR 기반 리스크 — 자산별 평균 일일 변동폭 측정",
      "Hurst 레짐 — 추세 지속성으로 시장 상태 진단",
    ],
    faq: [
      { q: "리스크 맵을 얼마나 자주 확인해야 하나요?", a: "매일 시장 마감 후 점검을 권장합니다. 변동성 급증 시에는 실시간 알림을 받도록 설정할 수 있습니다." },
      { q: "상관관계가 +1 에 가까운 자산이 많으면 위험한가요?", a: "네. 시장 급락 시 동시에 손실이 발생할 수 있으므로 음의 상관관계 또는 무상관 자산을 추가하는 것이 좋습니다." },
      { q: "리스크 맵 데이터는 얼마나 자주 업데이트되나요?", a: "보유 자산 시세는 분 단위, 상관관계·변동성 메트릭은 일 단위로 갱신됩니다." },
    ],
  },
  {
    path: "sentiment",
    title: "Zepta 시장 심리 — Fear & Greed + Crypto 센티먼트",
    desc: "Fear & Greed Index, 비트코인 도미넌스, 펀딩비 종합 시장 심리 지표.",
    h1: "Zepta 시장 심리 — Fear & Greed 와 코인 센티먼트",
    intro: "전통 시장의 Fear & Greed Index 와 암호화폐 시장의 펀딩비·도미넌스를 종합한 시장 심리 지표를 제공합니다. 극단 영역에서 역발상 신호를 포착하세요.",
    features: [
      "Fear & Greed Index — 0~100 점수로 시장 심리 정량화",
      "비트코인 도미넌스 — 자금이 알트코인으로 이동 중인지 확인",
      "Funding Rate — Binance 영구선물 펀딩비로 과열 진단",
      "Put/Call Ratio — 옵션 시장의 헤지 수요 측정",
      "역사적 분위 — 현재 심리가 과거 대비 어느 분위에 있는지",
    ],
    faq: [
      { q: "Fear & Greed 가 극단값일 때 어떻게 활용하나요?", a: "극단적 공포(20 이하)는 역발상 매수 후보, 극단적 탐욕(80 이상)은 차익실현 시점으로 활용할 수 있습니다." },
      { q: "데이터 출처는 어디인가요?", a: "Alternative.me Fear & Greed, CoinMarketCap 도미넌스, Binance 펀딩비를 사용합니다." },
      { q: "주식과 코인의 심리가 다른 이유는?", a: "두 시장은 투자자 구성과 변동성이 다릅니다. Zepta 는 둘을 분리해서 보여주고 종합 점수도 제공합니다." },
    ],
  },
  {
    path: "econ-calendar",
    title: "Zepta 경제 캘린더 — FOMC·CPI·PMI 한국어",
    desc: "주요 거시 지표 일정 한국어로 정리. FOMC, CPI, PMI, 고용지표 등 시장 영향도 표시.",
    h1: "Zepta 경제 캘린더 — 주요 거시 지표를 한국어로",
    intro: "FOMC, CPI, PMI, 비농업 고용 등 시장을 움직이는 주요 거시 지표를 한국어로 정리합니다. 발표 일정과 예상치, 시장 영향도를 한 화면에서 확인하세요.",
    features: [
      "FOMC 일정 — 금리 결정 회의와 점도표 발표",
      "CPI·PCE — 미국 물가 지표와 연준 정책 시사점",
      "고용지표 — 비농업 고용, 실업률, 임금 상승률",
      "PMI·소비 — ISM 제조업·서비스업 PMI, 소매판매",
      "시장 영향도 — 지표별 변동성 영향을 별점으로 표시",
    ],
    faq: [
      { q: "어떤 시간대로 표시되나요?", a: "한국 표준시(KST) 기준이며, 사용자 설정으로 미국 동부시간(ET) 으로 전환할 수 있습니다." },
      { q: "예상치와 실제치가 크게 다를 때는?", a: "서프라이즈 지수로 자동 강조됩니다. 변동성 알림을 켜두면 발표 직후 텔레그램으로 받을 수 있습니다." },
      { q: "한국·일본·유럽 지표도 포함되나요?", a: "한국 금통위, 일본 BoJ, 유럽 ECB 주요 회의도 포함됩니다." },
    ],
  },
  {
    path: "news",
    title: "Zepta 시장 뉴스 — AI 요약 + 영향도",
    desc: "주식·코인 시장 주요 뉴스 AI 요약. 종목 영향도, 출처 신뢰도, 시간순 정렬.",
    h1: "Zepta 시장 뉴스 — AI 가 요약하는 주식·코인 헤드라인",
    intro: "주식·코인 시장의 주요 뉴스를 AI 가 한국어로 요약합니다. 종목별 영향도와 출처 신뢰도, 시간순 정렬로 정보 과부하를 줄이세요.",
    features: [
      "AI 요약 — 긴 영문 기사를 3줄 한국어로 즉시 요약",
      "종목 영향도 — 뉴스가 어떤 종목에 영향을 주는지 자동 태깅",
      "출처 신뢰도 — Reuters·Bloomberg 등 1차 출처 우선",
      "시간순 정렬 — 최신순 또는 영향도 순으로 정렬",
      "키워드 알림 — 관심 종목·키워드 뉴스 발생 시 텔레그램 알림",
    ],
    faq: [
      { q: "뉴스 출처는 어디인가요?", a: "Reuters, Bloomberg, CoinDesk, Financial Times 등 주요 영문 매체와 한국경제, 매일경제 등 한국 매체를 포함합니다." },
      { q: "가짜 뉴스 방지는?", a: "신뢰도 점수가 낮은 출처는 자동 필터링되며, 동일 사건에 대한 다중 출처 교차 검증을 합니다." },
      { q: "뉴스 보관 기간은?", a: "최근 30일까지 무료, Pro 플랜은 1년치 아카이브 검색이 가능합니다." },
    ],
  },
  {
    path: "anomaly",
    title: "Zepta 이상 감지 — 변동성·거래량 스파이크",
    desc: "비정상 변동률 2σ 초과, 거래량 3배 폭증, 급격한 갭 자동 감지. 실시간 알림.",
    h1: "Zepta 이상 감지 — 비정상 변동과 거래량 스파이크 포착",
    intro: "2σ 초과 변동률, 거래량 3배 폭증, 급격한 갭을 자동 감지합니다. 이벤트 드라이븐 매매 기회를 실시간으로 잡으세요.",
    features: [
      "변동성 스파이크 — 2σ 초과 비정상 변동 자동 알림",
      "거래량 폭증 — 평균 대비 3배 이상 거래량 감지",
      "갭 감지 — 시초가 갭과 갭 메우기 패턴 추적",
      "이상 가격 — 호가창 비대칭과 비정상 호가",
      "텔레그램 즉시 알림 — 이상 발생 30초 이내 푸시",
    ],
    faq: [
      { q: "민감도를 조절할 수 있나요?", a: "2σ, 2.5σ, 3σ 임계값을 선택할 수 있습니다. 높을수록 알림은 적지만 신호 강도는 강해집니다." },
      { q: "거짓 신호는 얼마나 되나요?", a: "2σ 기준 약 5%, 3σ 기준 약 0.3% 의 노이즈가 발생합니다. 거래량 폭증과 결합하면 정확도가 크게 향상됩니다." },
      { q: "어떤 시간 단위로 감지하나요?", a: "1분/5분/1시간/일 봉 각각 독립적으로 감지하며 사용자가 선택할 수 있습니다." },
    ],
  },
  {
    path: "alerts",
    title: "Zepta 알림 — 가격·신호 사용자 정의",
    desc: "사용자 정의 가격 알림, 시그널 발생 알림, 포트폴리오 임계값 알림. 텔레그램 연동.",
    h1: "Zepta 알림 — 가격·시그널·포트폴리오 사용자 정의 알림",
    intro: "원하는 종목의 가격 조건, 시그널 발생, 포트폴리오 임계값 도달 시 실시간 알림을 받아보세요. 텔레그램 연동으로 모바일에서도 즉시 확인합니다.",
    features: [
      "가격 알림 — 종목별 상한/하한 가격 도달 시 알림",
      "시그널 알림 — 33개 알파 시그널 중 선택해 발생 시 알림",
      "포트폴리오 알림 — 보유 자산 손익률·집중도 임계값 도달 시 알림",
      "텔레그램 연동 — 모바일 푸시보다 빠른 즉시 알림",
      "조건 조합 — AND/OR 로 복합 조건 알림 생성",
    ],
    faq: [
      { q: "알림은 무료인가요?", a: "기본 가격·시그널 알림은 무료입니다. 텔레그램 연동·고급 조건 알림은 Pro 플랜에서 제공됩니다." },
      { q: "몇 개까지 등록 가능한가요?", a: "무료는 5개, Pro 는 50개, Premium 은 무제한입니다." },
      { q: "신호 정확도는?", a: "Zepta 알파 시그널은 백테스트 검증 평균 Sharpe 1.5 이상입니다. 단일 시그널 보다 다중 시그널 조합이 권장됩니다." },
    ],
  },
  {
    path: "quant-portfolio",
    title: "Zepta 퀀트 포트폴리오 — 다중 알고리즘 최적화",
    desc: "켈리·평균분산·블랙리터만 다중 알고리즘. 자동 리밸런싱, 리스크 패리티.",
    h1: "Zepta 퀀트 포트폴리오 — 다중 알고리즘으로 최적 배분",
    intro: "켈리 공식, 평균-분산 최적화, 블랙리터만 모델, 리스크 패리티를 동시에 실행하여 알고리즘 간 결과를 비교합니다. 자동 리밸런싱까지 한 화면에서 처리하세요.",
    features: [
      "켈리 공식 — 기대 수익률과 분산 기반 최적 베팅 비율",
      "평균-분산 최적화 — Markowitz Efficient Frontier 계산",
      "블랙리터만 — 사용자 견해를 반영한 베이지안 최적화",
      "리스크 패리티 — 각 자산의 리스크 기여도 균등화",
      "자동 리밸런싱 — 임계값 이탈 시 신호 자동 발생",
    ],
    faq: [
      { q: "어떤 알고리즘을 선택해야 하나요?", a: "초보자는 리스크 패리티, 적극 투자자는 켈리, 본인 견해 반영을 원하면 블랙리터만을 권장합니다. Zepta 는 4개를 모두 보여주고 사용자가 선택하게 합니다." },
      { q: "공매도가 필요한가요?", a: "기본은 long-only 모드입니다. 옵션에서 공매도 허용을 켜면 알고리즘이 음의 비중도 추천합니다." },
      { q: "최소 종목 수는?", a: "유의미한 최적화를 위해 최소 5종목 이상을 권장합니다." },
    ],
  },
  {
    path: "quant-report",
    title: "Zepta 퀀트 리포트 — AI 일일 분석",
    desc: "AI 에이전트 매일 시장 분석 리포트. 알파 후보, 리스크 알림, 포트폴리오 추천.",
    h1: "Zepta 퀀트 리포트 — AI 에이전트의 매일 시장 분석",
    intro: "Zepta 퀀트 AI 에이전트가 매일 KST 06:00 시장을 분석합니다. 신규 알파 후보, 리스크 알림, 포트폴리오 추천을 한 페이지에서 받아보세요.",
    features: [
      "일일 시장 진단 — 미국·한국·코인 3개 시장 종합 분석",
      "알파 후보 — 새로 부상한 시그널과 그 근거",
      "리스크 알림 — 변동성 급증·상관관계 변화 경고",
      "포트폴리오 추천 — 현재 시장 레짐에 맞는 배분안",
      "텔레그램 발송 — 매일 06:00 자동 푸시",
    ],
    faq: [
      { q: "리포트는 무료인가요?", a: "기본 요약은 무료, 상세 분석과 알파 후보는 Pro 플랜에서 제공됩니다." },
      { q: "리포트 보관 기간은?", a: "최근 30일은 무료 열람, 1년치 아카이브는 Pro 플랜에서 검색·다운로드할 수 있습니다." },
      { q: "AI 분석은 얼마나 정확한가요?", a: "Sharpe·MDD 같은 정량 지표는 100% 정확합니다. 자연어 해석은 보조 자료로 활용하고 본인 판단을 우선하세요." },
    ],
  },
  {
    path: "notifications",
    title: "Zepta 알림 센터 — 가격·시그널·뉴스·포트폴리오 통합",
    desc: "모든 알림을 한 곳에서 — 가격 변동, 시그널 발생, 뉴스 영향도, 포트폴리오 임계값. 채널 별 설정.",
    h1: "Zepta 알림 센터 — 모든 알림을 한 곳에서",
    intro: "가격 변동, 시그널 발생, 뉴스 영향도, 포트폴리오 임계값 알림을 통합 관리합니다. 채널별로 텔레그램·이메일·앱 푸시를 자유롭게 설정하세요.",
    features: [
      "통합 인박스 — 모든 알림을 한 타임라인에서 확인",
      "채널별 라우팅 — 알림 종류별 텔레그램·이메일·푸시 선택",
      "우선순위 — 중요 알림만 별도 채널로 분리",
      "조용시간 — 야간·주말 자동 음소거",
      "읽음 처리 — 처리 완료 알림 자동 아카이브",
    ],
    faq: [
      { q: "텔레그램 봇은 어떻게 연결하나요?", a: "프로필 > 알림 채널 > 텔레그램 연결 버튼으로 1회 인증하면 즉시 사용 가능합니다." },
      { q: "이메일 알림 빈도는?", a: "즉시·시간별·일별 묶음 발송 중 선택할 수 있습니다. 시간별 묶음이 가장 인기입니다." },
      { q: "알림 누락이 발생할 수 있나요?", a: "텔레그램은 99.9% 도달률입니다. 이메일은 스팸함을 확인해 주세요." },
    ],
  },
  {
    path: "saved-screeners",
    title: "Zepta 저장한 스크리너 — 관심 조건 자동 매칭 알림",
    desc: "RSI 과매도, 골든크로스, 볼린저밴드, ATR 폭발 등 저장한 조건이 시장에서 매칭되면 알림 전송.",
    h1: "Zepta 저장한 스크리너 — 관심 조건을 자동 매칭",
    intro: "RSI 과매도, 골든크로스, 볼린저밴드 돌파, ATR 폭발 같은 관심 조건을 저장해 두면 시장에서 매칭되는 순간 알림을 보냅니다.",
    features: [
      "저장한 필터 — 자주 쓰는 스크리닝 조건을 이름과 함께 저장",
      "자동 매칭 — 15분마다 시장 스캔, 매칭 종목 알림",
      "히트맵 — 어느 종목이 자주 매칭되는지 시각화",
      "히스토리 — 과거 매칭 사례와 그 후 수익률 추적",
      "공유 — 본인 필터를 다른 사용자와 공유 (옵트인)",
    ],
    faq: [
      { q: "스크리너를 몇 개까지 저장할 수 있나요?", a: "무료 3개, Pro 30개, Premium 무제한입니다." },
      { q: "매칭 빈도는 얼마나 되나요?", a: "엄격한 조건은 하루 0~5개, 느슨한 조건은 100개 이상도 가능합니다. 너무 많으면 임계값을 올리세요." },
      { q: "알림 채널은?", a: "텔레그램, 이메일, 앱 푸시 중 선택할 수 있습니다." },
    ],
  },
  {
    path: "leaderboard",
    title: "Zepta 봇 리더보드 — 익명 사용자 봇 성과 랭킹",
    desc: "모든 사용자의 자동매매 봇 성과를 익명으로 비교. 30일 수익률, 안정성(Sharpe), MDD, 거래수 매시간 갱신.",
    h1: "Zepta 봇 리더보드 — 익명 사용자 봇 성과 랭킹",
    intro: "모든 사용자의 자동매매 봇 성과를 익명으로 비교할 수 있는 공개 리더보드입니다. 30일 수익률, Sharpe, MDD, 거래 수를 매시간 갱신합니다.",
    features: [
      "30일 수익률 랭킹 — 단기 수익률 상위 봇 식별",
      "Sharpe 랭킹 — 위험 대비 수익이 가장 좋은 봇",
      "MDD 랭킹 — 최대 낙폭이 가장 작은 안정형 봇",
      "거래 수 — 너무 적거나 너무 많은 봇 필터링",
      "익명 ID — 사용자 신원 비공개, 봇 성능만 비교",
    ],
    faq: [
      { q: "내 봇은 자동으로 리더보드에 올라가나요?", a: "옵트인 방식입니다. 본인이 동의하지 않으면 공개되지 않습니다." },
      { q: "수익률이 가장 높은 봇을 따라 해도 되나요?", a: "성과는 과거 기록일 뿐이며 미래를 보장하지 않습니다. 카피트레이딩 페이지에서 안전한 신호 알림 방식으로 따라할 수 있습니다." },
      { q: "리더보드 갱신 주기는?", a: "매시간 갱신됩니다." },
    ],
  },
  {
    path: "reports",
    title: "Zepta 봇 리포트 — 봇별 누적 성과·에쿼티 커브",
    desc: "13개 자동매매 봇의 누적 수익, 승률, PF, MDD, 최근 30일 에쿼티 커브와 거래 내역을 한 곳에서 확인.",
    h1: "Zepta 봇 리포트 — 봇별 누적 성과와 거래 내역",
    intro: "13개 자동매매 봇의 누적 수익, 승률, Profit Factor, MDD, 최근 30일 에쿼티 커브와 거래 내역을 한 곳에서 투명하게 공개합니다.",
    features: [
      "누적 손익 — 봇별 시작 이후 총 수익률",
      "승률·PF — 거래 단위 성과 메트릭",
      "MDD — 최대 낙폭과 회복 기간",
      "에쿼티 커브 — 최근 30일 자본 곡선 차트",
      "거래 내역 — 모든 진입·청산 시각과 손익",
    ],
    faq: [
      { q: "봇 리포트의 데이터는 실거래 결과인가요?", a: "Shadow 봇은 페이퍼 트레이딩, Production 봇은 실거래 결과입니다. 각 봇 상세에 라벨이 표시됩니다." },
      { q: "내 봇의 거래 내역도 공개되나요?", a: "본인 봇은 본인만 볼 수 있습니다. 공개 리더보드에는 집계 메트릭만 익명으로 노출됩니다." },
      { q: "거래 내역을 다운로드할 수 있나요?", a: "Pro 플랜에서 CSV 다운로드가 가능합니다. 세금 신고용으로 활용할 수 있습니다." },
    ],
  },
  {
    path: "backtest-compare",
    title: "Zepta 백테스트 비교 — 멀티 전략 동시 백테스트",
    desc: "같은 자산·기간에 추세·돌파·평균회귀·앙상블 등 여러 strategy 를 한 차트에 overlay 비교. Sharpe·PF·MDD·승률 메트릭 테이블.",
    h1: "Zepta 백테스트 비교 — 여러 전략을 한 차트에서",
    intro: "같은 자산과 기간에 추세·돌파·평균회귀·앙상블 등 여러 strategy 를 동시에 백테스트하고 한 차트에서 overlay 로 비교합니다.",
    features: [
      "Multi-strategy overlay — 여러 strategy 의 에쿼티 커브 동시 비교",
      "메트릭 테이블 — Sharpe·PF·MDD·승률을 한 표에서 비교",
      "공통 자산·기간 — 동일 조건에서 공정 비교",
      "조합 백테스트 — 두 strategy 의 가중 평균 결과도 즉시 계산",
      "출력 — PNG·CSV 로 결과 저장",
    ],
    faq: [
      { q: "몇 개 strategy 를 동시에 비교할 수 있나요?", a: "최대 8개까지 한 차트에 overlay 할 수 있습니다." },
      { q: "백테스트 데이터 기간은?", a: "최대 10년치(주식) / 7년치(코인) 데이터를 사용합니다." },
      { q: "결과를 저장할 수 있나요?", a: "Pro 플랜에서 비교 결과를 워크스페이스에 저장하고 나중에 다시 열 수 있습니다." },
    ],
  },
  {
    path: "copy-trading",
    title: "Zepta 카피트레이딩 — 신호 알림 + 설정 복사 (법적 안전 모드)",
    desc: "다른 봇의 진입·청산 신호를 알림으로 받거나 strategy / parameter 만 복사. 자동 미러 매매 X — 한국 자본시장법 준수.",
    h1: "Zepta 카피트레이딩 — 신호 알림과 설정 복사 (법적 안전 모드)",
    intro: "다른 사용자 봇의 진입·청산 신호를 알림으로 받거나 strategy 와 파라미터를 그대로 복사합니다. 자동 미러 매매가 아닌 신호 알림 + 본인 매매 방식이므로 한국 자본시장법상 일임매매에 해당하지 않습니다.",
    features: [
      "신호 알림 — 다른 봇이 진입·청산할 때 텔레그램 알림",
      "설정 복사 — strategy 와 파라미터를 본인 봇에 적용",
      "본인 매매 — 최종 매매는 본인이 결정·실행",
      "성과 검증 — 카피하려는 봇의 30일 성과를 사전 확인",
      "법적 안전 — 일임매매 X, 자본시장법 준수",
    ],
    faq: [
      { q: "자동으로 미러 매매되나요?", a: "아니오. 신호 알림만 보내거나 설정만 복사합니다. 최종 매매는 본인이 결정합니다. 한국 자본시장법 준수를 위한 설계입니다." },
      { q: "카피 대상 봇은 어떻게 찾나요?", a: "리더보드에서 30일 성과 상위 봇 중 카피 동의 봇을 선택할 수 있습니다." },
      { q: "수수료는?", a: "신호 알림은 Pro 플랜 기본, 카피 대상 봇 운영자에게는 별도 인센티브가 지급되지 않습니다." },
    ],
  },
  {
    path: "pricing",
    title: "Zepta 가격 — Free · Pro · Premium 구독 플랜",
    desc: "투자 도구 SaaS 3 tier 비교. Pro 14일 무료 체험. 봇·백테스트·알림·AlphaLab·카피트레이딩 풀 액세스. 환불 정책 명시.",
    h1: "Zepta 가격 — Free·Pro·Premium 3개 플랜",
    intro: "Zepta 는 Free, Pro, Premium 3개 플랜을 제공합니다. Pro 는 14일 무료 체험이 가능하며, 환불 정책은 결제 후 7일 이내 100% 환불입니다.",
    features: [
      "Free — 기본 스크리너·알림·뉴스 무료",
      "Pro — 자동매매·AlphaLab·카피트레이딩·텔레그램 알림 전체 액세스",
      "Premium — 사용자 정의 알파·실시간 데이터·API 우선",
      "14일 무료 체험 — Pro 결제 카드 등록 후 첫 14일 무료",
      "7일 환불 — 결제 후 7일 이내 사용량 무관 100% 환불",
    ],
    faq: [
      { q: "결제 수단은 무엇이 있나요?", a: "국내 카드(신용·체크), 해외 카드, 토스페이, 카카오페이를 지원합니다." },
      { q: "구독을 언제든 해지할 수 있나요?", a: "네. 마이페이지에서 즉시 해지 가능하며 다음 결제일까지 Pro 기능을 계속 사용할 수 있습니다." },
      { q: "기업 / 기관용 플랜이 있나요?", a: "사용자 5인 이상은 Enterprise 플랜을 별도 문의 부탁드립니다(contact@zepta.app)." },
    ],
  },
  {
    path: "quant-port",
    // 'quant-portfolio' 의 짧은 별칭 (sitemap.xml 에 등록됨). 동일 콘텐츠 prerender.
    title: "Zepta 퀀트 포트폴리오 — 다중 알고리즘 최적화",
    desc: "켈리·평균분산·블랙리터만 다중 알고리즘. 자동 리밸런싱, 리스크 패리티.",
    h1: "Zepta 퀀트 포트폴리오 — 다중 알고리즘으로 최적 배분",
    intro: "켈리 공식, 평균-분산 최적화, 블랙리터만 모델, 리스크 패리티를 동시에 실행하여 알고리즘 간 결과를 비교합니다. 자동 리밸런싱까지 한 화면에서 처리하세요.",
    features: [
      "켈리 공식 — 기대 수익률과 분산 기반 최적 베팅 비율",
      "평균-분산 최적화 — Markowitz Efficient Frontier 계산",
      "블랙리터만 — 사용자 견해를 반영한 베이지안 최적화",
      "리스크 패리티 — 각 자산의 리스크 기여도 균등화",
      "자동 리밸런싱 — 임계값 이탈 시 신호 자동 발생",
    ],
    faq: [
      { q: "quant-port 와 quant-portfolio 의 차이는?", a: "동일한 페이지의 짧은 별칭입니다. 두 URL 모두 같은 퀀트 포트폴리오 화면을 보여줍니다." },
      { q: "어떤 알고리즘을 선택해야 하나요?", a: "초보자는 리스크 패리티, 적극 투자자는 켈리, 본인 견해 반영을 원하면 블랙리터만을 권장합니다." },
      { q: "공매도가 필요한가요?", a: "기본은 long-only 모드이며 옵션에서 공매도 허용으로 전환할 수 있습니다." },
    ],
  },
  {
    path: "profile",
    title: "Zepta 프로필 — 계정·알림 채널·API 키 관리",
    desc: "사용자 프로필, 알림 채널(텔레그램·이메일), Binance API 키, 구독 플랜, 보안 설정을 한 곳에서 관리.",
    h1: "Zepta 프로필 — 계정과 연동을 한 곳에서 관리",
    intro: "Zepta 사용자 프로필 페이지에서 알림 채널, Binance API 키 연동, 구독 플랜, 보안 설정을 통합 관리합니다.",
    features: [
      "알림 채널 — 텔레그램·이메일·앱 푸시 연결과 활성화",
      "Binance API — 실거래용 API 키 등록(매매 권한만, 출금 권한 X)",
      "구독 관리 — Free/Pro/Premium 플랜 변경과 결제 내역",
      "보안 — 2FA 설정, 로그인 기록, 세션 관리",
      "데이터 — 본인 거래·백테스트 데이터 다운로드와 삭제",
    ],
    faq: [
      { q: "API 키 등록 시 출금 권한이 필요한가요?", a: "절대 아닙니다. Zepta 는 매매 권한만 사용하며 출금 권한은 요청하지 않습니다. 키 등록 시 출금 권한은 비활성으로 유지하세요." },
      { q: "계정 탈퇴 시 데이터는 어떻게 되나요?", a: "30일간 복구 가능 보관 후 완전 삭제됩니다. 즉시 삭제는 마이페이지에서 요청할 수 있습니다." },
      { q: "비밀번호를 잊었을 때는?", a: "로그인 화면의 \"비밀번호 찾기\" 로 등록 이메일에서 재설정할 수 있습니다." },
    ],
  },
];

function escapeAttr(s) {
  return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeText(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeJson(s) {
  // JSON-LD 안의 문자열 — 백슬래시·따옴표·</script 만 안전 처리.
  return String(s)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/<\/(script)/gi, "<\\/$1");
}

function replaceMetaTag(html, attrName, attrValue, contentAttr, newContent) {
  const re = new RegExp(`(<meta ${attrName}="${attrValue}"[^>]*${contentAttr}=")[^"]+(")`, "i");
  return html.replace(re, `$1${escapeAttr(newContent)}$2`);
}

// FAQPage JSON-LD 생성 (Google FAQ rich snippet 대상)
function buildFaqJsonLd(faq) {
  const mainEntity = faq.map(({ q, a }) => ({
    "@type": "Question",
    name: q,
    acceptedAnswer: { "@type": "Answer", text: a },
  }));
  const obj = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity,
  };
  // 직접 stringify (escapeJson 으로 내부 처리)
  const parts = mainEntity
    .map(
      (e) =>
        `{"@type":"Question","name":"${escapeJson(e.name)}","acceptedAnswer":{"@type":"Answer","text":"${escapeJson(
          e.acceptedAnswer.text,
        )}"}}`,
    )
    .join(",");
  return `{"@context":"https://schema.org","@type":"FAQPage","mainEntity":[${parts}]}`;
}

// #root 내부에 삽입할 prerender HTML 생성.
// React 가 마운트되면서 이 콘텐츠를 즉시 덮어쓰지만 Googlebot 은 그 전에 수집한다.
function buildPrerenderBody(route) {
  const featuresHtml = route.features.map((f) => `<li>${escapeText(f)}</li>`).join("");
  const faqHtml = route.faq
    .map(({ q, a }) => `<div><h3>${escapeText(q)}</h3><p>${escapeText(a)}</p></div>`)
    .join("");
  return `
    <section class="seo-prerender" style="display:block;padding:24px;max-width:800px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#F4F5F7;background:#0A0B0F;line-height:1.7;">
      <h1 style="font-size:26px;font-weight:800;color:#F4F5F7;margin:0 0 16px;">${escapeText(route.h1)}</h1>
      <p style="font-size:17px;color:#A1A6B2;margin:0 0 24px;">${escapeText(route.intro)}</p>
      <h2 style="font-size:20px;font-weight:700;color:#F4F5F7;margin:24px 0 12px;">주요 기능</h2>
      <ul style="padding-left:20px;color:#A1A6B2;">${featuresHtml}</ul>
      <h2 style="font-size:20px;font-weight:700;color:#F4F5F7;margin:24px 0 12px;">자주 묻는 질문</h2>
      ${faqHtml}
      <nav style="margin-top:32px;padding-top:16px;border-top:1px solid #23262F;font-size:14px;color:#A1A6B2;">
        <a href="/" style="color:#6E92FF;margin-right:12px;">홈</a>
        <a href="/screener" style="color:#6E92FF;margin-right:12px;">스크리너</a>
        <a href="/auto-trading" style="color:#6E92FF;margin-right:12px;">자동매매</a>
        <a href="/portfolio" style="color:#6E92FF;margin-right:12px;">포트폴리오</a>
        <a href="/pricing" style="color:#6E92FF;">요금제</a>
      </nav>
    </section>
  `;
}

// ────────────────────────────────────────────────────────────────────
// ★ 2026-05-30 — 홈페이지(index.html) prerender (AdSense "low value content" 대응)
//   기존 홈은 nav 링크만 있는 ~465자 shell → AdSense 가 첫 화면을 빈 페이지로 판정해 반려.
//   홈에 실질 콘텐츠(소개 3문단 · 기능 모듈 · 가이드 링크 · FAQ · 면책)를 채운다.
// ────────────────────────────────────────────────────────────────────
const HOME = {
  title: "Zepta — AI 퀀트 투자 플랫폼 | 주식·코인 자동매매·스크리너·백테스트",
  desc: "Zepta는 주식과 암호화폐를 위한 올인원 AI 퀀트 투자 플랫폼입니다. 실시간 스크리너, 검증된 알파 기반 자동매매, walk-forward 백테스트, 포트폴리오 최적화, 시장 심리·경제 캘린더까지 한 곳에서 제공합니다.",
  h1: "Zepta — 주식·코인을 위한 올인원 AI 퀀트 투자 플랫폼",
  intros: [
    "Zepta는 개인 투자자가 기관 수준의 퀀트 도구를 쉽게 쓸 수 있도록 만든 올인원 투자 플랫폼입니다. 33개 알파 시그널을 통합한 실시간 스크리너로 매수 후보를 찾고, 백테스트로 검증된 전략을 자동매매 봇으로 24시간 운영하며, 포트폴리오 최적화와 리스크 분석까지 한 화면에서 처리합니다.",
    "모든 전략은 walk-forward 백테스트와 교차심볼·out-of-sample 검증을 거쳐 과적합을 걸러낸 뒤에만 실거래에 반영됩니다. Alpha Lab은 8개 전략군의 Sharpe·손익비·승률을 매시간 추적하고 시장 레짐(추세/횡보)에 맞춰 가중치를 자동 조정합니다.",
    "Zepta는 투자 결정을 돕는 분석·자동화 도구입니다. 자금은 본인 거래소 계좌에 그대로 있고, Zepta는 매매 권한만 받은 API로 주문을 전송하며 출금 권한은 절대 요청하지 않습니다.",
  ],
  modules: [
    "실시간 스크리너 — 미국 주식·한국 주식·암호화폐를 33개 알파 통합 스코어로 스크리닝",
    "자동매매 — 백테스트 검증 전략으로 자동 진입·청산, 손절·익절 자동 관리",
    "Alpha Lab — 8개 전략군 성과를 매시간 추적하고 파라미터를 자동 튜닝",
    "백테스트 엔진 — Walk-forward 방식으로 Sharpe·MDD·Profit Factor 산출",
    "포트폴리오 최적화 — 켈리·평균분산·블랙리터만·리스크패리티 다중 알고리즘",
    "리스크 맵 — 상관관계 히트맵·변동성 레짐·집중도 시각화",
    "시장 심리 — Fear & Greed, 비트코인 도미넌스, 펀딩비 종합 센티먼트",
    "경제 캘린더·뉴스 — FOMC·CPI 일정과 AI 요약 시장 뉴스",
  ],
  guides: [
    { href: "/coin", title: "코인별 실시간 롱숏 스코어 — 메이저 30종" },
    { href: "/blog/ai-trading-guide", title: "AI 자동매매 입문자 가이드" },
    { href: "/blog/bitcoin-auto-trading-5-steps", title: "비트코인 자동매매 5단계로 시작하기" },
    { href: "/blog/quant-strategies", title: "퀀트 전략 33가지 정리" },
    { href: "/blog/backtest-tips", title: "백테스트 제대로 하는 법" },
    { href: "/blog/sharpe-ratio-profit-factor", title: "Sharpe Ratio와 Profit Factor 이해하기" },
    { href: "/blog/realistic-roi-expectation", title: "자동매매 현실적인 수익률 기대치" },
  ],
  faq: [
    { q: "Zepta는 무엇인가요?", a: "주식과 암호화폐를 위한 올인원 AI 퀀트 투자 플랫폼입니다. 스크리너, 자동매매, 백테스트, 포트폴리오 최적화, 시장 분석을 한 곳에서 제공합니다." },
    { q: "Zepta가 수익을 보장하나요?", a: "아니요. Zepta는 분석·자동화 도구이며 투자에는 항상 원금 손실 위험이 있습니다. 모든 백테스트 수치는 과거 성과일 뿐 미래 수익을 보장하지 않습니다." },
    { q: "Zepta가 제 자금을 보관하나요?", a: "아니요. 자금은 본인 거래소 계좌에 그대로 있습니다. Zepta는 매매 권한만 받은 API 키로 주문을 전송하며 출금 권한은 요청하지 않습니다." },
    { q: "무료로 사용할 수 있나요?", a: "기본 스크리너·시장 뉴스·페이퍼 트레이딩은 무료입니다. 자동매매 실거래·Alpha Lab·고급 알림은 Pro 플랜에서 제공됩니다." },
    { q: "초보자도 사용할 수 있나요?", a: "네. 입문자 가이드와 페이퍼 트레이딩으로 위험 없이 시작할 수 있고, 어려운 지표는 쉬운 설명과 툴팁으로 안내합니다." },
  ],
};

function buildHomePrerender(h) {
  const intros = h.intros.map((p) => `<p style="font-size:16px;color:#A1A6B2;margin:0 0 16px;">${escapeText(p)}</p>`).join("");
  const modules = h.modules.map((m) => `<li style="margin-bottom:8px;">${escapeText(m)}</li>`).join("");
  const guides = h.guides.map((g) => `<li style="margin-bottom:6px;"><a href="${escapeAttr(g.href)}" style="color:#6E92FF;">${escapeText(g.title)}</a></li>`).join("");
  const faqHtml = h.faq.map(({ q, a }) => `<div style="margin-bottom:12px;"><h3 style="font-size:16px;color:#F4F5F7;margin:0 0 4px;">${escapeText(q)}</h3><p style="margin:0;color:#A1A6B2;">${escapeText(a)}</p></div>`).join("");
  return `
    <section class="seo-prerender" style="display:block;padding:24px;max-width:860px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#F4F5F7;background:#0A0B0F;line-height:1.7;">
      <h1 style="font-size:28px;font-weight:800;margin:0 0 16px;">${escapeText(h.h1)}</h1>
      ${intros}
      <h2 style="font-size:20px;font-weight:700;margin:28px 0 12px;">Zepta가 제공하는 것</h2>
      <ul style="padding-left:20px;color:#A1A6B2;">${modules}</ul>
      <h2 style="font-size:20px;font-weight:700;margin:28px 0 12px;">투자 가이드</h2>
      <ul style="padding-left:20px;">${guides}</ul>
      <h2 style="font-size:20px;font-weight:700;margin:28px 0 12px;">자주 묻는 질문</h2>
      ${faqHtml}
      <p style="font-size:13px;color:#6E7585;margin-top:24px;border-top:1px solid #23262F;padding-top:16px;">⚠ Zepta는 투자 분석·자동화 도구이며 투자 자문이 아닙니다. 모든 수치는 과거 시뮬레이션 결과로 미래 수익을 보장하지 않으며, 투자에는 원금 손실 위험이 따릅니다. 최종 투자 결정과 책임은 본인에게 있습니다.</p>
      <nav style="margin-top:24px;font-size:14px;">
        <a href="/screener" style="color:#6E92FF;margin-right:12px;">스크리너</a>
        <a href="/auto-trading" style="color:#6E92FF;margin-right:12px;">자동매매</a>
        <a href="/alpha-lab" style="color:#6E92FF;margin-right:12px;">Alpha Lab</a>
        <a href="/backtest" style="color:#6E92FF;margin-right:12px;">백테스트</a>
        <a href="/blog" style="color:#6E92FF;margin-right:12px;">블로그</a>
        <a href="/pricing" style="color:#6E92FF;">요금제</a>
      </nav>
    </section>`;
}

function transformHomeHtml(baseHtml, h) {
  let html = baseHtml;
  const url = "https://zepta.app/";
  html = html.replace(/<title>[^<]*<\/title>/i, `<title>${escapeText(h.title)}</title>`);
  html = html.replace(/(<link\s+rel="canonical"[^>]*href=")[^"]+(")/i, `$1${url}$2`);
  html = replaceMetaTag(html, "name", "description", "content", h.desc);
  html = replaceMetaTag(html, "property", "og:title", "content", h.title);
  html = replaceMetaTag(html, "property", "og:description", "content", h.desc);
  html = replaceMetaTag(html, "property", "og:url", "content", url);
  html = replaceMetaTag(html, "name", "twitter:title", "content", h.title);
  html = replaceMetaTag(html, "name", "twitter:description", "content", h.desc);
  const faqLd = buildFaqJsonLd(h.faq);
  html = html.replace(/<\/head>/i, `\n    <script type="application/ld+json">${faqLd}</script>\n  </head>`);
  html = html.replace(/<div id="root"><\/div>/i, `<div id="root">${buildHomePrerender(h)}</div>`);
  return html;
}

function transformHtml(baseHtml, route) {
  const url = `https://zepta.app/${route.path}`;
  let html = baseHtml;

  // 1) head 메타 교체
  html = html.replace(/<title>[^<]*<\/title>/i, `<title>${escapeText(route.title)}</title>`);
  html = html.replace(/(<link\s+rel="canonical"[^>]*href=")[^"]+(")/i, `$1${url}$2`);
  html = replaceMetaTag(html, "name", "description", "content", route.desc);
  html = replaceMetaTag(html, "property", "og:title", "content", route.title);
  html = replaceMetaTag(html, "property", "og:description", "content", route.desc);
  html = replaceMetaTag(html, "property", "og:url", "content", url);
  html = replaceMetaTag(html, "name", "twitter:title", "content", route.title);
  html = replaceMetaTag(html, "name", "twitter:description", "content", route.desc);

  // 2) FAQPage JSON-LD 주입 (</head> 직전)
  if (Array.isArray(route.faq) && route.faq.length > 0) {
    const faqLd = buildFaqJsonLd(route.faq);
    const ldTag = `\n    <!-- FAQ JSON-LD (페이지별) -->\n    <script type="application/ld+json">${faqLd}</script>\n  `;
    html = html.replace(/<\/head>/i, `${ldTag}</head>`);
  }

  // 3) #root 안에 prerender 콘텐츠 삽입.
  //    React 가 createRoot(...).render(...) 호출 시 이 내부는 즉시 교체됨 → UX 영향 없음.
  //    Googlebot 은 JS 실행 전(또는 첫 paint) 시점에 prerender 콘텐츠를 수집 → thin-content soft-404 회피.
  if (Array.isArray(route.features) && Array.isArray(route.faq)) {
    const prerender = buildPrerenderBody(route);
    html = html.replace(/<div id="root"><\/div>/i, `<div id="root">${prerender}</div>`);
  }

  return html;
}

function main() {
  const indexPath = path.join(DIST, "index.html");
  if (!fs.existsSync(indexPath)) {
    console.error(`[spa-routes] ${indexPath} 가 없습니다. Vite build 가 먼저 실행되어야 합니다.`);
    process.exit(1);
  }
  const baseHtml = fs.readFileSync(indexPath, "utf8");
  let count = 0;
  let prerendered = 0;
  for (const route of ROUTES) {
    try {
      const html = transformHtml(baseHtml, route);
      const outPath = path.join(DIST, `${route.path}.html`);
      fs.writeFileSync(outPath, html);
      count += 1;
      if (Array.isArray(route.features) && Array.isArray(route.faq)) prerendered += 1;
    } catch (e) {
      console.error(`[spa-routes] ${route.path} 생성 실패:`, e?.message);
    }
  }
  console.log(
    `[spa-routes] ${count}/${ROUTES.length} SPA 경로별 HTML 생성 완료 — prerender 콘텐츠 ${prerendered}개 / FAQ JSON-LD ${prerendered}개 주입.`,
  );

  // ★ 홈(index.html) prerender 주입 — 라우트 HTML 은 baseHtml(메모리) 로 이미 생성됨.
  //   여기서 index.html 을 콘텐츠 풍부한 홈으로 덮어써 AdSense low-value-content 반려 해소.
  try {
    const homeHtml = transformHomeHtml(baseHtml, HOME);
    fs.writeFileSync(indexPath, homeHtml);
    console.log("[spa-routes] 홈(index.html) prerender 콘텐츠 주입 완료 — AdSense low-value-content 대응.");
  } catch (e) {
    console.error("[spa-routes] 홈 prerender 실패:", e?.message);
  }
}

main();
