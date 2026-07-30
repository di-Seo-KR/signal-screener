// ════════════════════════════════════════════════════════════════════
// 경제지표 발표 결과 페이지 — 콘텐츠 조립 공유 모듈 (정보 피벗 2차)
// ────────────────────────────────────────────────────────────────────
// 사용처: api/agents/econ-results.js (크론 생성) / api/econ-page.js (서빙·허브)
//         / api/sitemap-econ.js (사이트맵)
//
// 재료 (전부 KV 재사용 — 외부 API 0회):
//   di:econ:actuals   — "YYYY-MM-DD::영문 이벤트명" → 발표치(number)  (econ-calendar 적재, 실측)
//   di:econ:estimates — "YYYY-MM-DD::영문 이벤트명" → { e:컨센서스, p:이전치, dt:ISO발표시각 }
//
// KV 키 (이 모듈 소유):
//   di:econ-page:{YYYY-MM-DD}-{slug} — 완성 HTML 문자열
//   di:econ-page:index               — [{key, date, event, ko, actual, estimate, previous, unit}]
//                                      (날짜 내림차순, 최근 500)
//
// slug 규칙: 영문 이벤트명 소문자화 → 영숫자 외 '-' 치환 → 연속/양끝 '-' 정리.
//   예: "CPI (YoY)" → "cpi-yoy", "Nonfarm Payrolls" → "nonfarm-payrolls".
//   di:econ:actuals 의 키 포맷(`date::event`)은 econ-calendar.js 코드로 실측 확인.
//
// 표현 원칙: 행동 지시(매수/진입/권장) 금지 — 발표치·예측치·이전치와 서프라이즈
// 방향의 사실 서술, 지표 자체의 설명만 담습니다.
// ════════════════════════════════════════════════════════════════════

import { renderPage, escH, SITE, DISCLAIMER_LINE } from "./page-shell.js";

export const ECON_PAGE_KEY = (key) => `di:econ-page:${key}`;
export const ECON_INDEX_KEY = "di:econ-page:index";
export const ECON_INDEX_MAX = 500;
export const ECON_KEY_RE = /^\d{4}-\d{2}-\d{2}-[a-z0-9][a-z0-9-]{0,78}$/;

/** KST 기준 오늘 날짜 (YYYY-MM-DD) — briefing.js 와 동일 로직 (결합 최소화를 위해 자체 구현) */
export function kstToday(now = Date.now()) {
  return new Date(now + 9 * 3600000).toISOString().slice(0, 10);
}

/** 영문 이벤트명 → URL slug */
export function slugifyEvent(event) {
  return String(event || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/** "YYYY-MM-DD" → "YYYY년 M월 D일" */
export function koreanDate(date) {
  const [y, m, d] = String(date).split("-").map((v) => parseInt(v, 10));
  return `${y}년 ${m}월 ${d}일`;
}

// ── 지표 사전 — 이벤트명(econ-calendar 실측 명칭) → 한국어명·단위·설명 ──
//   설명은 지표의 정의·발표 주체 등 사실 서술만 담습니다.
const EVENT_INFO = {
  "CPI (YoY)": {
    ko: "소비자물가지수(CPI) 전년비", unit: "%",
    about: "미국 노동통계국(BLS)이 매월 발표하는 소비자물가지수(CPI)의 전년 동월 대비 상승률입니다. 도시 소비자가 구매하는 상품·서비스 바구니의 가격 변화를 측정하며, 연방준비제도(Fed)의 물가 안정 목표(2%) 달성 여부를 가늠할 때 가장 널리 인용되는 물가 지표입니다.",
  },
  "Core CPI (YoY)": {
    ko: "근원 소비자물가지수(Core CPI) 전년비", unit: "%",
    about: "변동성이 큰 식품·에너지 가격을 제외한 소비자물가지수의 전년 동월 대비 상승률입니다. 일시적 요인을 걷어낸 기조적 물가 흐름을 보여줘, 헤드라인 CPI 보다 통화정책 논의에서 더 무겁게 다뤄지는 경우가 많습니다.",
  },
  "CPI (MoM)": {
    ko: "소비자물가지수(CPI) 전월비", unit: "%",
    about: "소비자물가지수의 전월 대비 변화율입니다. 전년비보다 최근 물가 모멘텀을 민감하게 반영하며, 연율 환산 시 대략 12배로 해석됩니다.",
  },
  "Core CPI (MoM)": {
    ko: "근원 소비자물가지수(Core CPI) 전월비", unit: "%",
    about: "식품·에너지를 제외한 소비자물가지수의 전월 대비 변화율입니다. 최근의 기조적 물가 모멘텀을 가장 빠르게 보여주는 월간 수치입니다.",
  },
  "PPI (MoM)": {
    ko: "생산자물가지수(PPI) 전월비", unit: "%",
    about: "미국 노동통계국(BLS)이 발표하는 생산자물가지수(최종수요 기준)의 전월 대비 변화율입니다. 생산 단계의 가격 변화를 측정해 소비자물가에 선행하는 경향이 관찰되는 지표입니다.",
  },
  "Core PPI (MoM)": {
    ko: "근원 생산자물가지수(Core PPI) 전월비", unit: "%",
    about: "식품·에너지를 제외한 생산자물가지수의 전월 대비 변화율입니다. 생산 단계의 기조적 가격 압력을 보여줍니다.",
  },
  "Nonfarm Payrolls": {
    ko: "비농업 고용지수(NFP)", unit: "K",
    about: "미국 노동통계국(BLS)이 매월 첫째 주 금요일에 발표하는 농업 부문 제외 신규 고용자 수 변화(천 명 단위)입니다. 미국 노동시장의 체온계로 불리며, 발표 직후 금리·달러·위험자산 가격이 크게 움직인 사례가 많은 대표 지표입니다.",
  },
  "Unemployment Rate": {
    ko: "실업률", unit: "%",
    about: "미국의 경제활동인구 중 실업자 비율입니다. 비농업 고용지수와 같은 날 발표되며, 노동시장의 수급 상태를 보여주는 기본 지표입니다.",
  },
  "FOMC Rate Decision": {
    ko: "FOMC 기준금리 결정", unit: "%",
    about: "미국 연방공개시장위원회(FOMC)가 연 8회 회의에서 결정하는 연방기금금리 목표 범위(상단 기준)입니다. 글로벌 유동성과 자산 가격 전반에 영향을 주는 가장 주목도 높은 통화정책 이벤트입니다.",
  },
  "Retail Sales (MoM)": {
    ko: "소매판매 전월비", unit: "%",
    about: "미국 인구조사국이 발표하는 소매·외식 판매액의 전월 대비 변화율입니다. 미국 GDP 의 약 3분의 2를 차지하는 소비의 흐름을 가장 빠르게 보여주는 월간 지표입니다.",
  },
  "Core Retail Sales (MoM)": {
    ko: "근원 소매판매 전월비", unit: "%",
    about: "변동성이 큰 자동차 판매를 제외한 소매판매의 전월 대비 변화율입니다. 기조적인 소비 흐름을 파악할 때 참고됩니다.",
  },
  "ISM Manufacturing PMI": {
    ko: "ISM 제조업 PMI", unit: "",
    about: "미국 공급관리협회(ISM)가 제조업 구매관리자 설문으로 산출하는 경기 확산 지수입니다. 50 을 기준으로 그 위는 제조업 경기 확장, 아래는 위축 국면으로 해석됩니다.",
  },
  "ISM Services PMI": {
    ko: "ISM 서비스업 PMI", unit: "",
    about: "미국 공급관리협회(ISM)가 서비스업 구매관리자 설문으로 산출하는 경기 확산 지수입니다. 미국 경제의 대부분을 차지하는 서비스업의 확장(50 초과)·위축(50 미만)을 보여줍니다.",
  },
  "Initial Jobless Claims": {
    ko: "신규 실업수당 청구건수", unit: "K",
    about: "미국 노동부가 매주 목요일 발표하는 신규 실업수당 청구 건수(천 건 단위)입니다. 주간 단위로 발표돼 노동시장의 변곡을 가장 빠르게 포착하는 고빈도 지표입니다.",
  },
  "PCE Price Index (YoY)": {
    ko: "PCE 물가지수 전년비", unit: "%",
    about: "미국 경제분석국(BEA)이 발표하는 개인소비지출(PCE) 물가지수의 전년 동월 대비 상승률입니다. 연방준비제도가 물가 목표(2%)의 공식 기준으로 삼는 지표입니다.",
  },
  "Core PCE (YoY)": {
    ko: "근원 PCE 물가지수 전년비", unit: "%",
    about: "식품·에너지를 제외한 개인소비지출(PCE) 물가지수의 전년 동월 대비 상승률입니다. 연방준비제도가 가장 중시하는 것으로 알려진 물가 지표입니다.",
  },
  "Core PCE (MoM)": {
    ko: "근원 PCE 물가지수 전월비", unit: "%",
    about: "식품·에너지를 제외한 개인소비지출(PCE) 물가지수의 전월 대비 변화율입니다. 연준이 중시하는 물가 지표의 최근 모멘텀을 보여줍니다.",
  },
  "Industrial Production (MoM)": {
    ko: "산업생산 전월비", unit: "%",
    about: "미국 연방준비제도가 발표하는 제조업·광업·유틸리티 생산량의 전월 대비 변화율입니다. 실물 생산 경기의 흐름을 보여주는 지표입니다.",
  },
};

// GDP 는 "GDP Growth Rate (Q1, Advance)" 처럼 분기·차수가 붙어 접두 매칭으로 처리합니다.
const GDP_INFO = {
  ko: "GDP 성장률(연율)", unit: "%",
  about: "미국 경제분석국(BEA)이 발표하는 국내총생산(GDP)의 전분기 대비 연율 환산 성장률입니다. 속보치(Advance)·잠정치(Second)·확정치(Final) 순으로 세 차례 발표되며, 미국 경제의 종합 성적표로 불립니다.",
};

/** 단위 추정 폴백 (econ-calendar.js getUnit 과 동일 휴리스틱) */
function guessUnit(event) {
  const l = String(event || "").toLowerCase();
  if (l.includes("rate") || l.includes("yoy") || l.includes("mom") || l.includes("pce") || l.includes("cpi") || l.includes("ppi") || l.includes("gdp")) return "%";
  if (l.includes("payrolls") || l.includes("nfp") || l.includes("claims")) return "K";
  return "";
}

/** 이벤트명 → { ko, unit, about } (사전 → GDP 접두 → 일반 폴백) */
export function getEventInfo(event) {
  const name = String(event || "").trim();
  if (EVENT_INFO[name]) return EVENT_INFO[name];
  if (name.startsWith("GDP Growth Rate")) {
    const m = name.match(/\(([^)]+)\)/);
    return { ...GDP_INFO, ko: m ? `GDP 성장률(연율, ${m[1]})` : GDP_INFO.ko };
  }
  return {
    ko: name, unit: guessUnit(name),
    about: "미국에서 정기적으로 발표되는 주요 경제지표입니다. 발표치가 시장 컨센서스와 다를 때 금리·달러·위험자산 가격이 반응한 사례들이 관찰돼 왔습니다.",
  };
}

/** 수치 + 단위 표기 (예: 2.9% / 227K / 50.3) */
export function fmtVal(v, unit) {
  if (!Number.isFinite(v)) return "—";
  const n = Math.abs(v) >= 100 ? Math.round(v * 10) / 10 : Math.round(v * 100) / 100;
  return `${n}${unit === "%" ? "%" : unit === "K" ? "K" : ""}`;
}

/** 서프라이즈 사실 서술 (행동 지시 없음) */
export function surpriseText(actual, estimate, unit) {
  if (!Number.isFinite(actual) || !Number.isFinite(estimate)) {
    return "이번 발표에 대한 시장 컨센서스 집계는 확보되지 않았습니다.";
  }
  const diff = Math.round((actual - estimate) * 100) / 100;
  if (diff === 0) return "발표치가 시장 예측치에 정확히 부합했습니다.";
  const amt = unit === "%" ? `${Math.abs(diff)}%p` : unit === "K" ? `${Math.abs(diff)}K` : `${Math.abs(diff)}`;
  return `발표치가 시장 예측치를 ${amt} ${diff > 0 ? "상회" : "하회"}했습니다.`;
}

/** 이전치 대비 사실 서술 */
function vsPreviousText(actual, previous, unit) {
  if (!Number.isFinite(actual) || !Number.isFinite(previous)) return "";
  const diff = Math.round((actual - previous) * 100) / 100;
  if (diff === 0) return "직전 발표치와 같은 수준입니다.";
  const amt = unit === "%" ? `${Math.abs(diff)}%p` : unit === "K" ? `${Math.abs(diff)}K` : `${Math.abs(diff)}`;
  return `직전 발표치 대비 ${amt} ${diff > 0 ? "높은" : "낮은"} 수치입니다.`;
}

/**
 * 발표 결과 페이지 HTML 조립.
 * @param {{date:string, event:string, actual:number, estimate:number|null, previous:number|null}} entry
 * @returns {{key:string, html:string, indexEntry:object}}
 */
export function buildEconResultPage(entry) {
  const { date, event, actual } = entry;
  const info = getEventInfo(event);
  const unit = info.unit;
  const estimate = Number.isFinite(entry.estimate) ? entry.estimate : null;
  const previous = Number.isFinite(entry.previous) ? entry.previous : null;
  const slug = slugifyEvent(event);
  const key = `${date}-${slug}`;
  const urlPath = `${SITE}/econ/${key}`;
  const kdate = koreanDate(date);

  const title = `미국 ${info.ko} ${kdate} 발표 결과 — ${fmtVal(actual, unit)} | Zepta`;
  const metaDesc = `${kdate} 발표된 미국 ${info.ko}: 발표치 ${fmtVal(actual, unit)}${estimate != null ? `, 예측치 ${fmtVal(estimate, unit)}` : ""}${previous != null ? `, 이전치 ${fmtVal(previous, unit)}` : ""}. 서프라이즈 방향과 지표 해설을 정리했습니다.`;

  const surprise = surpriseText(actual, estimate, unit);
  const vsPrev = vsPreviousText(actual, previous, unit);

  const jsonLd = [
    {
      "@context": "https://schema.org", "@type": "Article",
      headline: `미국 ${info.ko} ${kdate} 발표 결과`,
      description: metaDesc,
      datePublished: date,
      dateModified: date,
      author: { "@type": "Organization", name: "Zepta" },
      publisher: { "@type": "Organization", name: "Zepta", url: SITE },
      mainEntityOfPage: urlPath,
    },
    {
      "@context": "https://schema.org", "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "홈", item: SITE + "/" },
        { "@type": "ListItem", position: 2, name: "경제지표 발표 결과", item: SITE + "/econ" },
        { "@type": "ListItem", position: 3, name: info.ko, item: urlPath },
      ],
    },
  ];

  const bodyHtml = `    <div class="breadcrumb"><a href="/">홈</a> › <a href="/econ">경제지표 발표 결과</a> › ${escH(info.ko)}</div>
    <h1>미국 ${escH(info.ko)} — ${escH(kdate)} 발표 결과</h1>
    <div class="meta-row">${escH(event)} · 발표일 ${escH(date)}</div>

    <div class="dash-strip">
      <div class="dash-stat"><div class="v">${escH(fmtVal(actual, unit))}</div><div class="l">발표치</div></div>
      <div class="dash-stat"><div class="v">${escH(estimate != null ? fmtVal(estimate, unit) : "—")}</div><div class="l">예측치(컨센서스)</div></div>
      <div class="dash-stat"><div class="v">${escH(previous != null ? fmtVal(previous, unit) : "—")}</div><div class="l">이전치</div></div>
    </div>

    <div class="callout"><strong>서프라이즈</strong> — ${escH(surprise)}${vsPrev ? " " + escH(vsPrev) : ""}</div>

    <h2>이 지표란?</h2>
    <p>${escH(info.about)}</p>

    <h2>이번 수치 정리</h2>
    <div class="facts">
      <div class="row"><span>지표</span><b>${escH(info.ko)} (${escH(event)})</b></div>
      <div class="row"><span>발표일</span><b>${escH(kdate)}</b></div>
      <div class="row"><span>발표치</span><b>${escH(fmtVal(actual, unit))}</b></div>
      <div class="row"><span>예측치</span><b>${escH(estimate != null ? fmtVal(estimate, unit) : "집계 없음")}</b></div>
      <div class="row"><span>이전치</span><b>${escH(previous != null ? fmtVal(previous, unit) : "집계 없음")}</b></div>
    </div>
    <p>${escH(surprise)} 발표치와 컨센서스의 차이(서프라이즈)는 발표 직후 시장 가격에 반영되는 경향이 관찰돼 왔으며, 같은 수치라도 당시의 금리·물가 국면에 따라 시장 반응은 달랐습니다.</p>

    <div class="disc">⚠️ ${escH(DISCLAIMER_LINE)} 발표치·예측치는 공개 데이터 소스 집계 기준이며 이후 정정(수정 발표)될 수 있습니다.</div>

    <div class="related">
      <h3>더 살펴보기</h3>
      <a href="/econ">경제지표 발표 결과 모음 — 전체 목록</a>
      <a href="/econ-calendar">경제 캘린더 — 다가오는 발표 일정과 컨센서스</a>
      <a href="/briefing">오늘의 코인 시장 브리핑</a>
    </div>`;

  const html = renderPage({ title, metaDesc, canonical: urlPath, bodyHtml, jsonLd, ogType: "article" });

  return {
    key,
    html,
    indexEntry: { key, date, event, ko: info.ko, unit, actual, estimate, previous },
  };
}

export default {
  ECON_PAGE_KEY, ECON_INDEX_KEY, ECON_INDEX_MAX, ECON_KEY_RE,
  kstToday, slugifyEvent, koreanDate, getEventInfo, fmtVal, surpriseText, buildEconResultPage,
};
