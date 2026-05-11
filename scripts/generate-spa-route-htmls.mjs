#!/usr/bin/env node
// scripts/generate-spa-route-htmls.mjs
//
// Vite build 후 실행 — dist/index.html 을 베이스로 SPA 경로 별 정적 HTML 생성.
// 각 HTML 은 같은 JS/CSS 번들 로드 (assets 해시 보존) 하지만
// <title>, canonical, og:url, og:title, og:description, twitter:title, twitter:description 만
// 경로별로 다르게 주입.
//
// 결과: Google 봇이 /screener 크롤링 시 zepta.app/screener 의 고유 canonical/title 을
// 보게 됨 → 중복 페이지 판정 회피 → 색인 정상화.
//
// vercel.json 의 rewrites 가 각 경로를 해당 HTML 로 매핑해야 함:
//   { "source": "/screener", "destination": "/screener.html" }

import fs from "fs";
import path from "path";

const DIST = "dist";

// SPA 경로 + 경로별 SEO 메타데이터.
// 새 경로 추가 시 여기에만 추가하면 됨.
const ROUTES = [
  {
    path: "screener",
    title: "Zepta 스크리너 — AI가 찾는 매수 종목 실시간 스코어",
    desc: "주식·코인 실시간 스크리닝. 알파 33개 통합 점수, 멀티팩터, 골든크로스/RSI/MACD 자동 분석.",
  },
  {
    path: "auto-trading",
    title: "Zepta 자동매매 — AI 33개 퀀트 봇 전략",
    desc: "백테스트 검증된 알파 기반 자동 진입·청산. 7개 코인 봇 + 6개 주식 봇 + 8개 strategy 다양화.",
  },
  {
    path: "real-trading",
    title: "Zepta 실전매매 — Binance Futures USDM 실거래",
    desc: "Binance Futures 실전매매 관제센터. 일/주 손익 한도, MDD 30일 rolling, 자동 force-close 안전망.",
  },
  {
    path: "alpha-lab",
    title: "Zepta Alpha Lab — 24/7 알파 추적·자동 개선",
    desc: "8개 strategy 의 Sharpe·PF·승률 매시간 leaderboard. 파라미터 자동 튜닝 + 시장 레짐 자동 적응.",
  },
  {
    path: "portfolio",
    title: "Zepta 포트폴리오 — AI 리밸런싱",
    desc: "켈리·평균-분산·블랙리터만 다중 알고리즘 포트폴리오 최적화. 실시간 마켓벨류 + 자동 리밸런싱.",
  },
  {
    path: "backtest",
    title: "Zepta 백테스트 — OHLC 시계열 walk-forward",
    desc: "30/60/90일 walk-forward 백테스트. Sharpe·PF·MDD·Calmar 자동 산출. 파라미터 grid search.",
  },
  {
    path: "strategy",
    title: "Zepta 알파 전략 — 33개 검증된 퀀트 시그널",
    desc: "RSI/MACD/볼린저밴드/Hurst/ER/OBV 등 검증된 33개 알파. Family 별 가중치 자동 학습.",
  },
  {
    path: "risk-map",
    title: "Zepta 리스크 맵 — 상관관계·변동성·집중도 시각화",
    desc: "포지션 상관관계 히트맵, 변동성 레짐, 자산 집중도 분석. ATR/Hurst 기반 리스크 메트릭.",
  },
  {
    path: "sentiment",
    title: "Zepta 시장 심리 — Fear & Greed + Crypto 센티먼트",
    desc: "Fear & Greed Index, 비트코인 도미넌스, 펀딩비 종합 시장 심리 지표.",
  },
  {
    path: "econ-calendar",
    title: "Zepta 경제 캘린더 — FOMC·CPI·PMI 한국어",
    desc: "주요 거시 지표 일정 한국어로 정리. FOMC, CPI, PMI, 고용지표 등 시장 영향도 표시.",
  },
  {
    path: "news",
    title: "Zepta 시장 뉴스 — AI 요약 + 영향도",
    desc: "주식·코인 시장 주요 뉴스 AI 요약. 종목 영향도, 출처 신뢰도, 시간순 정렬.",
  },
  {
    path: "anomaly",
    title: "Zepta 이상 감지 — 변동성·거래량 스파이크",
    desc: "비정상 변동률 2σ 초과, 거래량 3배 폭증, 급격한 갭 자동 감지. 실시간 알림.",
  },
  {
    path: "alerts",
    title: "Zepta 알림 — 가격·신호 사용자 정의",
    desc: "사용자 정의 가격 알림, 시그널 발생 알림, 포트폴리오 임계값 알림. 텔레그램 연동.",
  },
  {
    path: "sector-flow",
    title: "Zepta 섹터 플로우 — 자금 흐름·로테이션",
    desc: "섹터별 자금 흐름, 로테이션 패턴 분석. 강세 섹터 식별, 약세 섹터 회피.",
  },
  {
    path: "quant-portfolio",
    title: "Zepta 퀀트 포트폴리오 — 다중 알고리즘 최적화",
    desc: "켈리·평균분산·블랙리터만 다중 알고리즘. 자동 리밸런싱, 리스크 패리티.",
  },
  {
    path: "quant-report",
    title: "Zepta 퀀트 리포트 — AI 일일 분석",
    desc: "AI 에이전트 매일 시장 분석 리포트. 알파 후보, 리스크 알림, 포트폴리오 추천.",
  },
  {
    path: "notifications",
    title: "Zepta 알림 센터 — 가격·시그널·뉴스·포트폴리오 통합",
    desc: "모든 알림을 한 곳에서 — 가격 변동, 시그널 발생, 뉴스 영향도, 포트폴리오 임계값. 채널 별 설정.",
  },
  {
    path: "saved-screeners",
    title: "Zepta 저장한 스크리너 — 관심 조건 자동 매칭 알림",
    desc: "RSI 과매도, 골든크로스, 볼린저밴드, ATR 폭발 등 저장한 조건이 시장에서 매칭되면 알림 전송.",
  },
  {
    path: "leaderboard",
    title: "Zepta 봇 리더보드 — 익명 사용자 봇 성과 랭킹",
    desc: "모든 사용자의 자동매매 봇 성과를 익명으로 비교. 30일 수익률, 안정성(Sharpe), MDD, 거래수 매시간 갱신.",
  },
  {
    path: "reports",
    title: "Zepta 봇 리포트 — 봇별 누적 성과·에쿼티 커브",
    desc: "13개 자동매매 봇의 누적 수익, 승률, PF, MDD, 최근 30일 에쿼티 커브와 거래 내역을 한 곳에서 확인.",
  },
];

function replaceMetaTag(html, attrName, attrValue, contentAttr, newContent) {
  // <meta {attrName}="{attrValue}" content="..." /> 의 content 만 교체
  const re = new RegExp(`(<meta ${attrName}="${attrValue}"[^>]*${contentAttr}=")[^"]+(")`, "i");
  return html.replace(re, `$1${escapeAttr(newContent)}$2`);
}

function escapeAttr(s) {
  return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function transformHtml(baseHtml, route) {
  const url = `https://zepta.app/${route.path}`;
  let html = baseHtml;

  // <title>
  html = html.replace(/<title>[^<]*<\/title>/i, `<title>${escapeAttr(route.title)}</title>`);

  // <link rel="canonical">
  html = html.replace(/(<link\s+rel="canonical"[^>]*href=")[^"]+(")/i, `$1${url}$2`);

  // <meta name="description">
  html = replaceMetaTag(html, "name", "description", "content", route.desc);

  // og:title / og:description / og:url
  html = replaceMetaTag(html, "property", "og:title", "content", route.title);
  html = replaceMetaTag(html, "property", "og:description", "content", route.desc);
  html = replaceMetaTag(html, "property", "og:url", "content", url);

  // twitter:title / twitter:description (있는 경우)
  html = replaceMetaTag(html, "name", "twitter:title", "content", route.title);
  html = replaceMetaTag(html, "name", "twitter:description", "content", route.desc);

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
  for (const route of ROUTES) {
    try {
      const html = transformHtml(baseHtml, route);
      const outPath = path.join(DIST, `${route.path}.html`);
      fs.writeFileSync(outPath, html);
      count += 1;
    } catch (e) {
      console.error(`[spa-routes] ${route.path} 생성 실패:`, e?.message);
    }
  }
  console.log(`[spa-routes] ${count}/${ROUTES.length} SPA 경로별 HTML 생성 완료 (dist/<route>.html)`);
}

main();
