// ════════════════════════════════════════════════════════════════════
// GET /api/index-page?slug=... — Zepta 자체 지수 공개 SEO 페이지 (정보 피벗 2차)
// ────────────────────────────────────────────────────────────────────
// rewrites: /index/market-temp · /index/funding-squeeze · /index/alt-heat
// 각 페이지 = 지수 설명 + 산식(재현 가능 수준) + 라이브 수치 위젯 + FAQ JSON-LD.
// 라이브 수치는 클라이언트 인라인 JS 가 60초마다 JSON 을 재호출해 채웁니다:
//   market-temp     → GET /api/market-temp
//   funding-squeeze → GET /api/indicators/summary (id 로 추출)
//   alt-heat        → GET /api/indicators/summary (id 로 추출)
// 페이지 자체는 정적 조립이라 항상 200 (김프 페이지와 동일 구조).
// 표현 원칙: 행동 지시(매수/진입/권장) 금지 — 상태 서술만.
// ════════════════════════════════════════════════════════════════════

import { renderPage, escH, SITE, DISCLAIMER_LINE } from "./_shared/page-shell.js";

export const config = { maxDuration: 15 };

// ── 라이브 위젯 스크립트 (공통 골격 — 지수별 fetch·추출만 다름) ──
//   위젯 DOM: #ix-val(값) #ix-label(라벨) #ix-sub(부가) #ix-updated(갱신 시각) #ix-bar(게이지)
function widgetScript({ fetchUrl, extractJs }) {
  return `
  <script>
  (function(){
    function setBar(v){var b=document.getElementById('ix-bar');if(b&&typeof v==='number'&&isFinite(v)){b.style.width=Math.max(0,Math.min(100,v))+'%'}}
    function apply(d){
      var x=null;
      try{ x=(${extractJs})(d); }catch(e){ x=null; }
      if(!x||typeof x.value!=='number'||!isFinite(x.value)){
        document.getElementById('ix-updated').textContent='지수를 계산할 데이터가 부족합니다. 잠시 후 자동으로 다시 시도합니다.';
        return;
      }
      document.getElementById('ix-val').textContent=Math.round(x.value);
      document.getElementById('ix-label').textContent=x.label||'';
      if(x.sub)document.getElementById('ix-sub').textContent=x.sub;
      setBar(x.value);
      document.getElementById('ix-updated').textContent='마지막 갱신 '+new Date(x.updatedAt||Date.now()).toLocaleTimeString('ko-KR')+' · 60초마다 자동 갱신';
    }
    function load(){
      fetch('${fetchUrl}').then(function(r){return r.json()}).then(apply)
      .catch(function(){document.getElementById('ix-updated').textContent='수치를 불러오지 못했습니다. 잠시 후 자동으로 다시 시도합니다.'});
    }
    load();
    setInterval(load,60*1000);
  })();
  </script>`;
}

const WIDGET_HTML = `
    <div class="temp-hero">
      <div class="t-val" id="ix-val">—</div>
      <div class="t-label" id="ix-label">불러오는 중…</div>
      <div class="t-bar"><i id="ix-bar" style="width:0%"></i></div>
      <div class="t-sub" id="ix-sub"></div>
      <div class="t-sub" id="ix-updated">수치를 불러오는 중입니다…</div>
    </div>`;

// ── 지수별 페이지 정의 ──
const PAGES = {
  "market-temp": {
    title: "마켓 온도 지수 — 코인 시장 체감 온도 0~100 실시간 | Zepta",
    metaDesc: "Zepta 마켓 온도 지수: 유동성 상위 코인의 신호 분포(시장 폭)·펀딩비 극단 비율·공포탐욕 지수를 가중 합산해 시장의 체감 온도를 0~100 한 숫자로 요약합니다. 산식 공개, 10분마다 갱신.",
    h1: "마켓 온도 지수 — 시장 체감 온도 0~100",
    metaRow: "Zepta 자체 지수 1호 · 10분마다 갱신 · 산식 공개",
    fetchUrl: "/api/market-temp",
    extractJs: `function(d){ if(!d||!d.ok)return null; var b=d.components&&d.components.breadth; return { value:d.temp, label:d.label, updatedAt:d.updatedAt, sub: b?('상승 우위 '+b.long+'/'+b.total+'종목 · 평균 부호 스코어 '+b.avgSigned):'' } }`,
    intro: `<p>마켓 온도 지수는 <strong>코인 시장이 지금 얼마나 달아올라 있는지</strong>를 0~100 한 숫자로 요약한 Zepta 자체 지수입니다. 0에 가까울수록 냉각, 100에 가까울수록 과열 상태를 뜻하며, 라벨은 냉각(≤20) · 위축(≤40) · 중립(≤60) · 가열(≤80) · 과열(>80) 다섯 구간입니다.</p>`,
    formula: `<h2>산식</h2>
    <p>세 구성요소를 가중 합산합니다. 일부 요소의 데이터가 없으면 해당 요소를 제외하고 가중치를 재정규화해, 없는 데이터를 지어내지 않습니다.</p>
    <ul>
      <li><strong>시장 폭 (가중 60%)</strong> — 유동성 상위 유니버스의 멀티 타임프레임 종합 신호에서 상승 우위 종목 비율과 평균 부호 스코어를 6:4 로 합성합니다. 전 종목 상승 우위·만점이면 100, 전 종목 하락 우위면 0.</li>
      <li><strong>펀딩 극단 비율 (가중 20%)</strong> — 바이낸스 선물 전 심볼 중 극단 양수 펀딩(≥+0.05%/8h) 비율에서 극단 음수 비율을 뺀 값을 50 중심으로 스케일합니다. 롱 과열일수록 온도가 올라갑니다.</li>
      <li><strong>공포·탐욕 (가중 20%)</strong> — Alternative.me 크립토 공포·탐욕 지수(0~100)를 그대로 사용합니다.</li>
    </ul>`,
    faq: [
      { q: "마켓 온도 지수는 얼마나 자주 갱신되나요?", a: "신호 데이터 파이프라인 주기에 맞춰 10분 단위로 갱신됩니다. 이 페이지의 수치는 60초마다 자동으로 다시 불러옵니다." },
      { q: "온도가 높으면 좋은 건가요?", a: "지수는 시장의 상태를 서술하는 관찰 지표이며 좋고 나쁨의 판단이나 매매 신호가 아닙니다. 과열 구간은 상승 신호와 롱 쏠림·탐욕 심리가 동시에 강한 상태가 관찰된다는 뜻이고, 그 이후의 가격 방향은 보장되지 않습니다." },
    ],
    related: [
      ["/index/funding-squeeze", "펀딩 스퀴즈 지수 — 숏 과밀 정도 0~100"],
      ["/index/alt-heat", "알트 과열 지수 — BTC 대비 알트 신호 우위"],
      ["/briefing", "오늘의 코인 시장 브리핑 — 매일 아침 자동 발행"],
    ],
  },

  "funding-squeeze": {
    title: "펀딩 스퀴즈 지수 — 숏 과밀 정도 0~100 실시간 | Zepta",
    metaDesc: "Zepta 펀딩 스퀴즈 지수: 바이낸스 선물 유니버스의 펀딩비 분포에서 숏 포지션 과밀 정도를 0~100 으로 요약합니다. 70 이상 숏 과밀(스퀴즈 잠재), 30 이하 롱 과밀. 산식 공개, 10분마다 갱신.",
    h1: "펀딩 스퀴즈 지수 — 숏 과밀 정도 0~100",
    metaRow: "Zepta 자체 지수 3호 · 10분마다 갱신 · 산식 공개",
    fetchUrl: "/api/indicators/summary",
    extractJs: `function(d){ if(!d||!d.ok||!d.indicators)return null; var it=null; for(var i=0;i<d.indicators.length;i++){if(d.indicators[i].id==='funding-squeeze'){it=d.indicators[i];break}} if(!it)return null; return { value:it.value, label:it.label, updatedAt:it.updatedAt, sub:it.desc||'' } }`,
    intro: `<p>펀딩 스퀴즈 지수는 <strong>선물 시장의 자금조달료(펀딩비) 분포가 숏 쪽으로 얼마나 쏠려 있는지</strong>를 0~100 으로 요약한 Zepta 자체 지수입니다. 펀딩비가 음수인 심볼은 숏 포지션이 롱에게 수수료를 지불하는 상태로, 이런 심볼이 많을수록 숏 포지션이 과밀하다는 뜻입니다. 50이 중립이며, <strong>70 이상은 숏 과밀(스퀴즈 잠재)</strong>, <strong>30 이하는 롱 과밀</strong> 상태로 서술합니다.</p>
    <p>과거 시장에서는 숏 과밀 구간에서 가격이 반등할 때 숏 청산이 연쇄되며 상승이 증폭되는 이른바 '숏 스퀴즈' 사례들이 관찰돼 왔습니다. 이 지수는 그런 구조가 잠재된 상태인지 여부를 서술할 뿐, 발생 시점이나 방향을 예측하지 않습니다.</p>`,
    formula: `<h2>산식</h2>
    <p>바이낸스 USDT 마진 선물 전 심볼의 현재 펀딩비를 한 번에 수집해 다음과 같이 합산합니다 (극단 기준 EXT = ±0.05%/8h, 통상 기본 펀딩 +0.01% 의 5배).</p>
    <ul>
      <li><strong>음수 펀딩 비율 편차</strong> — (음수 심볼 비율 − 25%) × 80, 기여 ±40 캡. 무기한 선물 펀딩은 기본이 양수(+0.01%)라 평시에도 음수 심볼이 10~30% 존재하므로, 통상치인 25% 를 중립 기준선으로 사용합니다.</li>
      <li><strong>극단 음수 가산</strong> — 펀딩비 ≤ −0.05%/8h 심볼 비율 × 150 (상한 +15).</li>
      <li><strong>극단 양수 감산</strong> — 펀딩비 ≥ +0.05%/8h 심볼 비율 × 150 (하한 −15, 롱 과밀 대칭).</li>
      <li><strong>평균 펀딩</strong> — 평균 펀딩비의 음수 정도를 ±10 범위로 반영.</li>
    </ul>
    <p>이를 50(중립)에 더해 0~100 으로 클램프합니다. 표본이 10개 미만이면 값을 만들지 않고 결측으로 처리합니다.</p>`,
    faq: [
      { q: "펀딩비가 음수라는 건 무슨 뜻인가요?", a: "무기한 선물의 펀딩비가 음수면 숏 포지션이 롱 포지션에게 주기적으로 수수료를 지불하는 상태입니다. 선물 가격이 현물보다 낮게 눌릴 만큼 숏 수요가 강할 때 나타나며, 이 지수는 그런 심볼이 유니버스에서 차지하는 비중을 집계합니다." },
      { q: "지수가 70을 넘으면 반등한다는 뜻인가요?", a: "아닙니다. 70 이상은 숏 포지션 과밀이라는 현재 상태의 서술이며, 스퀴즈의 발생 여부·시점·방향을 보장하지 않습니다. 과거에도 숏 과밀 상태가 길게 이어진 사례가 있습니다." },
    ],
    related: [
      ["/index/market-temp", "마켓 온도 지수 — 시장 체감 온도 0~100"],
      ["/index/alt-heat", "알트 과열 지수 — BTC 대비 알트 신호 우위"],
      ["/kimchi-premium", "김치프리미엄 실시간 — 국내외 가격 차이"],
    ],
  },

  "alt-heat": {
    title: "알트 과열 지수 — BTC 대비 알트코인 과열 0~100 실시간 | Zepta",
    metaDesc: "Zepta 알트 과열 지수: BTC 를 제외한 알트코인의 상승 신호 우위·평균 스코어와 BTC 신호의 격차, 알트 거래대금 비중을 합산해 알트 시장의 과열 정도를 0~100 으로 요약합니다. 산식 공개, 10분마다 갱신.",
    h1: "알트 과열 지수 — BTC 대비 알트 신호 우위 0~100",
    metaRow: "Zepta 자체 지수 4호 · 10분마다 갱신 · 산식 공개",
    fetchUrl: "/api/indicators/summary",
    extractJs: `function(d){ if(!d||!d.ok||!d.indicators)return null; var it=null; for(var i=0;i<d.indicators.length;i++){if(d.indicators[i].id==='alt-heat'){it=d.indicators[i];break}} if(!it)return null; return { value:it.value, label:it.label, updatedAt:it.updatedAt, sub:it.desc||'' } }`,
    intro: `<p>알트 과열 지수는 <strong>비트코인을 제외한 알트코인 시장이 BTC 대비 얼마나 달아올라 있는지</strong>를 0~100 으로 요약한 Zepta 자체 지수입니다. 알트 자금이 몰리는 이른바 '알트 시즌' 성격의 구간에서는 알트의 상승 신호 우위와 거래대금 비중이 동시에 커지는 경향이 관찰돼 왔습니다. 라벨은 <strong>냉각(≤30) · 중립 · 과열(≥70)</strong> 세 구간입니다.</p>`,
    formula: `<h2>산식</h2>
    <p>유동성 상위 유니버스의 멀티 타임프레임 종합 신호(심볼당 최신 1건, 4시간 윈도우)에서 다음 요소를 가중 합산합니다. 데이터가 없는 요소는 제외하고 가중치를 재정규화합니다.</p>
    <ul>
      <li><strong>알트 상승 우위 비율 (가중 40%)</strong> — BTC 제외 알트 중 상승(LONG) 우위 종목 비율.</li>
      <li><strong>알트 평균 부호 스코어 (가중 30%)</strong> — 상승이면 +스코어, 하락이면 −스코어의 평균(−100~+100)을 0~100 으로 매핑.</li>
      <li><strong>BTC 와의 격차 (가중 20%)</strong> — 알트 평균 부호 스코어 − BTC 부호 스코어. 격차가 +일수록 알트 우위.</li>
      <li><strong>알트 거래대금 비중 (가중 10%)</strong> — 유동성 상위 선물 유니버스의 24시간 거래대금 중 BTC 제외 비중. 통상 수준(약 65%)을 50점 기준으로 스케일.</li>
    </ul>
    <p>알트 표본이 5종목 미만이면 값을 만들지 않고 결측으로 처리합니다.</p>`,
    faq: [
      { q: "알트 과열 지수가 높으면 알트 시즌인가요?", a: "지수가 높다는 것은 알트의 상승 신호 우위와 거래대금 비중이 BTC 대비 강한 상태가 관찰된다는 서술입니다. 알트 시즌으로 불려온 과거 구간들과 유사한 상태인지 참고할 수 있지만, 지속 여부나 이후 가격 방향을 보장하지 않습니다." },
      { q: "왜 BTC 를 제외하고 계산하나요?", a: "이 지수의 목적이 '시장 전체'가 아니라 'BTC 대비 알트의 상대적 온도'를 보는 것이기 때문입니다. 시장 전체의 온도는 마켓 온도 지수가 담당합니다." },
    ],
    related: [
      ["/index/market-temp", "마켓 온도 지수 — 시장 체감 온도 0~100"],
      ["/index/funding-squeeze", "펀딩 스퀴즈 지수 — 숏 과밀 정도 0~100"],
      ["/coin", "코인 라이브 대시보드 — 유동성 상위 전 종목 스코어"],
    ],
  },
};

function renderIndexPage(slug) {
  const p = PAGES[slug];
  const urlPath = `${SITE}/index/${slug}`;

  const faqLd = {
    "@context": "https://schema.org", "@type": "FAQPage",
    mainEntity: p.faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
  };
  const crumbLd = {
    "@context": "https://schema.org", "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "홈", item: SITE + "/" },
      { "@type": "ListItem", position: 2, name: p.h1, item: urlPath },
    ],
  };

  const faqHtml = p.faq.map((f) => `    <h3>${escH(f.q)}</h3>\n    <p>${escH(f.a)}</p>`).join("\n");
  const relatedHtml = p.related.map(([href, label]) => `      <a href="${escH(href)}">${escH(label)}</a>`).join("\n");

  const bodyHtml = `    <div class="breadcrumb"><a href="/">홈</a> › ${escH(p.h1)}</div>
    <h1>${escH(p.h1)}</h1>
    <div class="meta-row">${escH(p.metaRow)}</div>
${WIDGET_HTML}
    ${p.intro}
    ${p.formula}

    <div class="disc">⚠️ ${escH(DISCLAIMER_LINE)} 지수는 시장 상태를 요약한 관찰 지표이며 향후 가격 방향을 보장하지 않습니다.</div>

    <h2>자주 묻는 질문</h2>
${faqHtml}

    <div class="related">
      <h3>더 살펴보기</h3>
${relatedHtml}
    </div>`;

  return renderPage({
    title: p.title,
    metaDesc: p.metaDesc,
    canonical: urlPath,
    bodyHtml,
    jsonLd: [faqLd, crumbLd],
    extraBody: widgetScript({ fetchUrl: p.fetchUrl, extractJs: p.extractJs }),
    ogType: "website",
  });
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }
  const slug = typeof req.query?.slug === "string" ? req.query.slug.trim() : "";
  if (!PAGES[slug]) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    return res.status(404).send("<!DOCTYPE html><html lang=\"ko\"><body>존재하지 않는 지수 페이지입니다. <a href=\"/\">홈으로</a></body></html>");
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400");
  return res.status(200).send(renderIndexPage(slug));
}
