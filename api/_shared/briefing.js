// ════════════════════════════════════════════════════════════════════
// 일일 마켓 브리핑 — 조립 공유 모듈
// ────────────────────────────────────────────────────────────────────
// 2026-07-30 (정보 피벗 1차): KST 기준 날짜별 코인 시장 브리핑 HTML 을 조립해
// KV 에 저장합니다. 크론(api/agents/daily-briefing.js)과 lazy 생성 폴백
// (api/briefing.js — 크론 실패 대비 fail-safe)이 이 모듈을 공유합니다.
//
// 재료 (전부 KV/내부 재사용 — 외부 API 최소화):
//   ① 마켓 온도 지수 — api/_shared/market-temp.js 공유 모듈
//   ② MTF 풀 breadth — 온도 지수 계산에 포함된 심볼별 집계 재사용 (KV 재조회 0회)
//   ③ 경제 일정 — di:econ:estimates (econ-calendar 가 적재한 관측 컨센서스)
//   ④ 공포·탐욕 — 온도 지수 구성요소 재사용 (Alternative.me 1회)
//   ⑤ 뉴스 헤드라인 5건 — api/news.js 의 Google News RSS 로직 복사
//      (자기호출 fetch(/api/news) 나 news.js 의 _shared 추출 없이 — 순환/결합 방지)
//
// KV 키:
//   di:briefing:{YYYY-MM-DD} — 완성 HTML 문자열
//   di:briefing:index        — 날짜 배열(내림차순, 최근 400)
//
// 표현 원칙: 행동 지시(매수/진입/권장) 금지 — 상태·사실 서술만.
// ════════════════════════════════════════════════════════════════════

import { getMarketTempCached } from "./market-temp.js";
import { renderPage, escH, escA, SITE, DISCLAIMER_LINE } from "./page-shell.js";

export const BRIEFING_KEY = (date) => `di:briefing:${date}`;
export const BRIEFING_INDEX_KEY = "di:briefing:index";
const INDEX_MAX = 400;

// 상세 페이지(/coin/{sym})가 존재하는 심볼 — scripts/coin-data.mjs COINS 와 동일 목록.
// (scripts/ 는 빌드 전용 소유 영역이라 import 하지 않고 심볼만 미러링.
//  코인 페이지 추가 시 이 목록도 갱신 필요 — 미스매치여도 링크가 안 나올 뿐 무해.)
const COIN_PAGE_SYMS = new Set([
  "BTC", "ETH", "BNB", "SOL", "XRP", "ADA", "AVAX", "TRX", "LINK", "DOT",
  "ATOM", "NEAR", "APT", "SUI", "ICP", "HBAR", "UNI", "AAVE", "INJ", "FIL",
  "LTC", "BCH", "ETC", "TON", "DOGE", "SHIB", "PEPE", "ARB", "OP", "MATIC",
  "WLD", "FET", "RENDER", "TIA", "SEI", "IMX", "GALA", "SAND", "MANA", "AXS",
  "GRT", "ALGO", "VET", "THETA", "RUNE", "TAO", "JUP", "ENA",
]);

/** KST 기준 오늘 날짜 (YYYY-MM-DD) */
export function kstDateString(offsetDays = 0, now = Date.now()) {
  return new Date(now + 9 * 3600000 + offsetDays * 86400000).toISOString().slice(0, 10);
}

/** "YYYY-MM-DD" → "YYYY년 M월 D일" */
function koreanDate(date) {
  const [y, m, d] = String(date).split("-").map((v) => parseInt(v, 10));
  return `${y}년 ${m}월 ${d}일`;
}

// ── ⑤ 뉴스 헤드라인 — news.js 의 Google News RSS 로직 복사(축약) ──
const NEWS_TIMEOUT_MS = 2500;
async function fetchGoogleNewsKo(q) {
  const out = [];
  try {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=ko&gl=KR&ceid=KR:ko`;
    const resp = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(NEWS_TIMEOUT_MS),
    });
    if (!resp.ok) return out;
    const xml = await resp.text();
    const items = xml.match(/<item>([\s\S]*?)<\/item>/g) || [];
    for (const item of items.slice(0, 8)) {
      const title = (item.match(/<title>(.*?)<\/title>/) || [])[1];
      const link = (item.match(/<link\/>(.*?)<pubDate>/) || item.match(/<link>(.*?)<\/link>/) || [])[1];
      const pubDate = (item.match(/<pubDate>(.*?)<\/pubDate>/) || [])[1];
      const source = (item.match(/<source[^>]*>(.*?)<\/source>/) || [])[1];
      if (title) out.push({ title: title.trim(), url: (link || "").trim(), date: pubDate || "", source: source || "Google News" });
    }
  } catch { /* 실패 → 빈 배열 (섹션 생략) */ }
  return out;
}

export async function fetchNewsHeadlines(limit = 5) {
  const results = await Promise.allSettled([
    fetchGoogleNewsKo("비트코인+가상화폐"),
    fetchGoogleNewsKo("코인+시장+규제"),
  ]);
  const merged = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  const seen = new Set();
  const unique = merged.filter((n) => {
    const key = n.title.slice(0, 40).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  unique.sort((a, b) => {
    try { return new Date(b.date) - new Date(a.date); } catch { return 0; }
  });
  return unique.slice(0, limit).filter((n) => /^https?:\/\//.test(n.url));
}

// ── ③ 경제 일정 — di:econ:estimates 에서 오늘·내일 이벤트 추출 ──
//   키 형식: "YYYY-MM-DD::이벤트명" → { e: 컨센서스, p: 이전치, dt: ISO발표시각 }
export async function getEconEvents(kv, dateKST) {
  try {
    const estimates = (await kv.get("di:econ:estimates")) || {};
    // dateKST 기준 다음 날 (문자열 연산 — 타임존 개입 없음)
    const tomorrow = new Date(Date.parse(`${dateKST}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
    const out = [];
    for (const [key, v] of Object.entries(estimates)) {
      const idx = key.indexOf("::");
      if (idx < 0) continue;
      const date = key.slice(0, idx);
      if (date !== dateKST && date !== tomorrow) continue;
      out.push({ date, event: key.slice(idx + 2), estimate: v?.e ?? null, previous: v?.p ?? null, dt: v?.dt || null });
    }
    out.sort((a, b) => (a.date + (a.dt || "")).localeCompare(b.date + (b.dt || "")));
    return out.slice(0, 10);
  } catch { return []; }
}

/** ISO 발표시각 → "KST HH:MM" (없으면 빈 문자열) */
function kstTime(dt) {
  const t = Date.parse(dt || "");
  if (!Number.isFinite(t)) return "";
  const d = new Date(t + 9 * 3600000);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} KST`;
}

// ── HTML 조립 ──
function renderBriefingHtml({ date, temp, econEvents, news }) {
  const kd = koreanDate(date);
  const url = `${SITE}/briefing/${date}`;
  const title = `${kd} 코인 시장 브리핑 | Zepta`;

  const breadth = temp?.components?.breadth || null;
  const fng = temp?.components?.fearGreed || null;
  const funding = temp?.components?.funding || null;
  const coins = Array.isArray(temp?._breadthCoins) ? temp._breadthCoins : [];
  const top5 = coins.slice().sort((a, b) => b.score - a.score).slice(0, 5);

  const metaDesc = `${kd} 암호화폐 시장 상태 요약 — Zepta 마켓 온도 ${temp?.ok ? `${temp.temp}점(${temp.label})` : "집계 중"}, 상승/하락 신호 분포, 경제 일정, 주요 헤드라인을 매일 아침 정리합니다.`;

  // ── 온도 지수 히어로 ──
  const tempHero = temp?.ok ? `
    <div class="temp-hero">
      <div class="t-val">${temp.temp}<span style="font-size:20px;color:#6E7585">/100</span></div>
      <div class="t-label ${temp.temp > 60 ? "red" : temp.temp < 40 ? "green" : "yellow"}">마켓 온도 · ${escH(temp.label)}</div>
      <div class="t-bar"><i style="width:${Math.max(2, Math.min(100, temp.temp))}%"></i></div>
      <div class="t-sub">신호 분포(60%) + 펀딩 상태(20%) + 공포·탐욕(20%) 가중 합산 · 산출 ${escH((temp.updatedAt || "").slice(0, 16).replace("T", " "))} UTC</div>
    </div>` : `
    <div class="callout">이날 마켓 온도 지수는 집계되지 않았습니다.</div>`;

  // ── 시장 개요 (사실 서술) ──
  let overview = "";
  if (breadth) {
    const dominant = breadth.long > breadth.short ? "상승" : breadth.long < breadth.short ? "하락" : "균형";
    overview = `
    <h2>시장 개요</h2>
    <div class="dash-strip">
      <div class="dash-stat"><div class="v">${breadth.total}</div><div class="l">분석 종목</div></div>
      <div class="dash-stat"><div class="v green">${breadth.long}</div><div class="l">상승 신호 우세</div></div>
      <div class="dash-stat"><div class="v red">${breadth.short}</div><div class="l">하락 신호 우세</div></div>
      <div class="dash-stat"><div class="v">${breadth.avgSigned > 0 ? "+" : ""}${breadth.avgSigned}</div><div class="l">평균 방향 스코어</div></div>
    </div>
    <p>이날 집계에서 유동성 상위 ${breadth.total}개 종목 중 <strong class="green">${breadth.long}종</strong>이 상승 신호 우세, <strong class="red">${breadth.short}종</strong>이 하락 신호 우세 상태였습니다. 전체적으로는 ${dominant === "균형" ? "상승과 하락 신호가 균형을 이루는" : `${dominant} 신호가 우위인`} 분포입니다.</p>`;
    const btc = coins.find((c) => c.asset === "BTC");
    const eth = coins.find((c) => c.asset === "ETH");
    const line = (c, ko) => c ? `${ko}는 ${c.side === "LONG" ? "상승" : "하락"} 신호 우세 상태입니다(종합 스코어 ${Math.round(c.score)}점).` : "";
    const btcEth = [line(btc, "BTC"), line(eth, "ETH")].filter(Boolean).join(" ");
    if (btcEth) overview += `\n    <p>${btcEth}</p>`;
  } else {
    overview = `
    <h2>시장 개요</h2>
    <p>이날 신호 분포 데이터가 집계되지 않았습니다. 실시간 현황은 <a href="/coin">코인 라이브 대시보드</a>에서 확인할 수 있습니다.</p>`;
  }

  // ── 상위 스코어 5종 ──
  let topHtml = "";
  if (top5.length > 0) {
    const rows = top5.map((c) => {
      const nm = c.asset.replace(/^1000/, "");
      const page = COIN_PAGE_SYMS.has(nm) ? `/coin/${nm.toLowerCase()}` : null;
      const nameCell = page ? `<a href="${page}"><b>${escH(nm)}</b></a>` : `<b>${escH(nm)}</b>`;
      const sideCls = c.side === "LONG" ? "green" : "red";
      const sideKo = c.side === "LONG" ? "상승 우세" : "하락 우세";
      return `      <tr><td>${nameCell}</td><td class="${sideCls}">${sideKo}</td><td><b>${Math.round(c.score)}점</b></td></tr>`;
    }).join("\n");
    topHtml = `
    <h2>이날 신호 강도 상위 5종</h2>
    <table class="z-tbl">
      <thead><tr><th>종목</th><th>신호 방향</th><th>종합 스코어</th></tr></thead>
      <tbody>
${rows}
      </tbody>
    </table>
    <p>스코어는 주봉·일봉·4시간·1시간 신호를 가중 합산해 10분마다 재산출되는 값으로, 위 표는 이 브리핑 생성 시점의 스냅샷입니다.</p>`;
  }

  // ── 공포·탐욕 + 펀딩 (사실 서술) ──
  let sentimentHtml = "";
  const sentParts = [];
  if (fng) sentParts.push(`크립토 공포·탐욕 지수는 <strong>${fng.value}점(${escH(fng.label || "")})</strong>을 기록했습니다.`);
  if (funding) {
    const pos = Math.round(funding.posExtremeRatio * 100);
    const neg = Math.round(funding.negExtremeRatio * 100);
    sentParts.push(`바이낸스 선물 ${funding.sampled}개 심볼 중 극단적 양(+)의 펀딩비 상태는 ${pos}%, 극단적 음(−)의 펀딩비 상태는 ${neg}%였습니다.`);
  }
  if (sentParts.length > 0) {
    sentimentHtml = `
    <h2>심리·파생 지표</h2>
    <p>${sentParts.join(" ")}</p>`;
  }

  // ── 경제 일정 ──
  let econHtml = "";
  if (econEvents.length > 0) {
    const rows = econEvents.map((e) => {
      const when = e.date === date ? "오늘" : "내일";
      const t = kstTime(e.dt);
      return `      <tr><td>${when}${t ? ` ${escH(t)}` : ""}</td><td><b>${escH(e.event)}</b></td><td>${e.estimate != null ? escH(String(e.estimate)) : "—"}</td><td>${e.previous != null ? escH(String(e.previous)) : "—"}</td></tr>`;
    }).join("\n");
    econHtml = `
    <h2>오늘·내일 주요 경제 일정</h2>
    <table class="z-tbl">
      <thead><tr><th>발표</th><th>지표</th><th>컨센서스</th><th>이전치</th></tr></thead>
      <tbody>
${rows}
      </tbody>
    </table>
    <p>전체 일정과 발표 결과는 <a href="/econ-calendar">경제 캘린더</a>에서 확인할 수 있습니다.</p>`;
  }

  // ── 뉴스 헤드라인 ──
  let newsHtml = "";
  if (news.length > 0) {
    const items = news.map((n) =>
      `      <a href="${escA(n.url)}" target="_blank" rel="noopener nofollow">${escH(n.title)}<span class="src">${escH(n.source || "")}</span></a>`
    ).join("\n");
    newsHtml = `
    <h2>주요 헤드라인</h2>
    <div class="news-list">
${items}
    </div>`;
  }

  // ── 내부 링크 (관련 코인 3개 + /kimchi-premium + /coin) ──
  const relCoins = [];
  for (const c of top5) {
    const nm = c.asset.replace(/^1000/, "");
    if (COIN_PAGE_SYMS.has(nm) && !relCoins.includes(nm)) relCoins.push(nm);
    if (relCoins.length >= 3) break;
  }
  for (const nm of ["BTC", "ETH", "SOL"]) {
    if (relCoins.length >= 3) break;
    if (!relCoins.includes(nm)) relCoins.push(nm);
  }
  const relatedHtml = `
    <div class="related">
      <h3>더 살펴보기</h3>
${relCoins.map((nm) => `      <a href="/coin/${nm.toLowerCase()}">${escH(nm)} 상세 분석·멀티 타임프레임 스코어</a>`).join("\n")}
      <a href="/kimchi-premium">김치프리미엄 실시간 — 업비트·바이낸스 가격 차이</a>
      <a href="/coin">코인 라이브 대시보드 — 유동성 상위 전 종목 스코어</a>
    </div>`;

  const bodyHtml = `    <div class="breadcrumb"><a href="/">홈</a> › <a href="/briefing">마켓 브리핑</a> › ${escH(date)}</div>
    <h1>${escH(kd)} 코인 시장 브리핑</h1>
    <div class="meta-row">매일 아침 KST 07:00 발행 · Zepta 알고리즘 자동 집계</div>
${tempHero}
${overview}
${topHtml}
${sentimentHtml}
${econHtml}
${newsHtml}
    <div class="disc">⚠️ ${escH(DISCLAIMER_LINE)} 시장 상황은 수시로 변하며, 위 수치는 브리핑 생성 시점의 스냅샷입니다.</div>
${relatedHtml}`;

  const articleLd = {
    "@context": "https://schema.org", "@type": "Article",
    headline: `${kd} 코인 시장 브리핑`,
    description: metaDesc,
    author: { "@type": "Organization", name: "Zepta" },
    publisher: { "@type": "Organization", name: "Zepta", url: SITE + "/" },
    datePublished: date, dateModified: date,
    mainEntityOfPage: url, image: SITE + "/og-image.png", inLanguage: "ko",
  };
  const crumbLd = {
    "@context": "https://schema.org", "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "홈", item: SITE + "/" },
      { "@type": "ListItem", position: 2, name: "마켓 브리핑", item: SITE + "/briefing" },
      { "@type": "ListItem", position: 3, name: `${kd} 브리핑`, item: url },
    ],
  };

  return renderPage({ title, metaDesc, canonical: url, bodyHtml, jsonLd: [articleLd, crumbLd] });
}

/**
 * 브리핑 조립 (KV 저장은 하지 않음 — 저장은 saveBriefing).
 * 부분 실패 허용: 온도/일정/뉴스 중 실패한 재료는 해당 섹션만 생략.
 * @returns {Promise<{date:string, html:string, meta:object}>}
 */
export async function buildDailyBriefing(kv, { date } = {}) {
  const dateKST = date || kstDateString();
  const [tempR, econR, newsR] = await Promise.allSettled([
    getMarketTempCached(kv),
    getEconEvents(kv, dateKST),
    fetchNewsHeadlines(5),
  ]);
  const temp = tempR.status === "fulfilled" && tempR.value?.ok ? tempR.value : null;
  const econEvents = econR.status === "fulfilled" ? econR.value : [];
  const news = newsR.status === "fulfilled" ? newsR.value : [];

  const html = renderBriefingHtml({ date: dateKST, temp, econEvents, news });
  return {
    date: dateKST,
    html,
    meta: {
      temp: temp ? { temp: temp.temp, label: temp.label } : null,
      econCount: econEvents.length,
      newsCount: news.length,
      bytes: Buffer.byteLength(html, "utf8"),
    },
  };
}

/** 브리핑 저장 + 인덱스 갱신 (내림차순, 최근 400) */
export async function saveBriefing(kv, date, html) {
  await kv.set(BRIEFING_KEY(date), html);
  const idx = (await kv.get(BRIEFING_INDEX_KEY)) || [];
  const arr = Array.isArray(idx) ? idx.filter((d) => typeof d === "string") : [];
  if (!arr.includes(date)) arr.push(date);
  arr.sort((a, b) => b.localeCompare(a));
  await kv.set(BRIEFING_INDEX_KEY, arr.slice(0, INDEX_MAX));
}

export default { buildDailyBriefing, saveBriefing, kstDateString, getEconEvents, fetchNewsHeadlines, BRIEFING_KEY, BRIEFING_INDEX_KEY };
