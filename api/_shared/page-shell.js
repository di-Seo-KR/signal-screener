// ════════════════════════════════════════════════════════════════════
// 공개 콘텐츠 페이지 공통 셸 — 다크 인라인 CSS · NAV · 드로어 · 푸터 · 트래킹
// ────────────────────────────────────────────────────────────────────
// 2026-07-30 (정보 피벗 1차): scripts/generate-coin-pages.mjs 의 HTML 템플릿
// 스타일을 서버 렌더 페이지(브리핑 /briefing, 김프 /kimchi-premium)에서도
// 동일하게 쓰기 위해 복사·모듈화했습니다. (스크립트 파일 자체는 빌드 산출물
// 생성 전용이라 import 하지 않고 스타일만 복제 — 소유권 분리 원칙)
//
// 사용처: api/_shared/briefing.js, api/kimchi-premium.js
// ════════════════════════════════════════════════════════════════════

/** HTML 어트리뷰트용 이스케이프 */
export const escA = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** HTML 본문용 이스케이프 */
export const escH = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export const SITE = "https://zepta.app";

// ── 다크 테마 인라인 CSS (generate-coin-pages.mjs STYLE 과 동일 계열) ──
// 2026-08-11 (시안 1h 콘텐츠 템플릿): 카드 어법(좌측 3px 보더 + 상단 그라데이션,
// radius 16), mono 숫자, 시안 악센트(#3DDC97/#FF6478/#FFBE4D)로 표현만 교체.
// 다크 고정 페이지라 C.* 토큰 대신 시안 hex 를 그대로 사용합니다.
export const STYLE = `
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;background:#0A0B10;color:#A6ACBF;line-height:1.85;word-break:keep-all;overflow-wrap:break-word}
.mono{font-family:'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.wrap{max-width:820px;margin:0 auto;padding:40px 20px}
nav{position:sticky;top:0;z-index:50;background:rgba(10,11,16,.92);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border-bottom:1px solid #232734;padding:0 20px;height:56px;display:flex;align-items:center;justify-content:space-between;gap:16px}
nav .brand{font-weight:800;font-size:18px;color:#EDEFF5;text-decoration:none;letter-spacing:-0.02em}
nav .brand b{color:#7C6BFF;font-weight:800}
nav .nav-right{display:flex;align-items:center;gap:6px}
nav .links{display:flex;gap:4px}
nav .links a{padding:7px 11px;border-radius:9px;font-size:14px;font-weight:600;color:#A6ACBF;text-decoration:none;white-space:nowrap;transition:color .15s,background .15s}
nav .links a:hover{color:#EDEFF5;background:#1A1D26}
.znav-burger{width:40px;height:40px;border:1px solid #232734;border-radius:10px;background:transparent;color:#EDEFF5;font-size:17px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background .15s}
.znav-burger:hover{background:#1A1D26}
#znav-overlay{position:fixed;inset:0;background:rgba(0,0,0,.55);opacity:0;pointer-events:none;transition:opacity .2s;z-index:98}
#znav-drawer{position:fixed;top:0;right:0;bottom:0;width:300px;max-width:85vw;background:#0E0F16;border-left:1px solid #232734;transform:translateX(102%);transition:transform .22s cubic-bezier(.2,.8,.2,1);z-index:99;overflow-y:auto;padding:0 16px 28px}
body.znav-open #znav-overlay{opacity:1;pointer-events:auto}
body.znav-open #znav-drawer{transform:translateX(0)}
.znav-head{display:flex;align-items:center;justify-content:space-between;height:56px;border-bottom:1px solid #232734;margin-bottom:10px}
.znav-head .brand{font-weight:800;font-size:18px;color:#EDEFF5;text-decoration:none}
.znav-head .brand b{color:#7C6BFF}
.znav-head button{width:36px;height:36px;border:none;border-radius:9px;background:transparent;color:#A6ACBF;font-size:16px;cursor:pointer}
.znav-head button:hover{background:#1A1D26;color:#EDEFF5}
.znav-group{margin:14px 0}
.znav-title{font-size:11px;font-weight:800;color:#6C7387;letter-spacing:.06em;margin:0 10px 6px}
.znav-group a{display:block;padding:10px 10px;border-radius:10px;font-size:15px;font-weight:600;color:#A6ACBF;text-decoration:none}
.znav-group a:hover{color:#EDEFF5;background:#1A1D26}
@media(max-width:640px){nav .links{display:none}}
.breadcrumb{font-size:13px;color:#6C7387;margin-bottom:18px}
.breadcrumb a{color:#9D8FFF;text-decoration:none}
.date-line{font-size:13px;font-weight:700;color:#9D8FFF;margin-bottom:6px}
h1{font-size:30px;font-weight:800;color:#EDEFF5;margin-bottom:10px;letter-spacing:-0.01em;line-height:1.3;text-wrap:pretty}
.meta-row{font-size:13px;color:#6C7387;margin-bottom:24px}
.tag-row{display:flex;gap:6px;flex-wrap:wrap;margin:2px 0 24px}
.tag{font-size:12px;font-weight:700;padding:4px 10px;border-radius:9999px;background:#12141B;border:1px solid #232734;color:#A6ACBF}
h2{font-size:20px;font-weight:800;color:#EDEFF5;margin:36px 0 12px;letter-spacing:-0.01em}
h3{font-size:16px;color:#EDEFF5;margin:20px 0 6px}
p{font-size:15.5px;margin-bottom:14px;line-height:1.8;text-wrap:pretty}
strong{color:#EDEFF5}
a{color:#9D8FFF;text-decoration:none}a:hover{text-decoration:underline}
.callout{background:linear-gradient(180deg,rgba(124,107,255,.09),transparent 42%),#12141B;border:1px solid #232734;border-left:3px solid #7C6BFF;border-radius:16px;padding:15px 16px;margin:18px 0;font-size:15px}
.sum-card{background:linear-gradient(180deg,rgba(124,107,255,.09),transparent 42%),#12141B;border:1px solid #232734;border-left:3px solid #7C6BFF;border-radius:16px;padding:15px 16px;margin:18px 0}
.sum-card .sum-t{font-size:12px;font-weight:800;color:#9D8FFF;margin-bottom:9px}
.sum-card ul{list-style:none;margin:0;display:flex;flex-direction:column;gap:8px}
.sum-card li{display:flex;gap:9px;align-items:flex-start;font-size:14px;color:#A6ACBF;line-height:1.6;margin:0}
.sum-card li::before{content:"";width:5px;height:5px;border-radius:50%;background:#7C6BFF;margin-top:8px;flex-shrink:0}
.disc{font-size:12px;color:#8A91A6;text-align:center;line-height:1.6;margin:28px auto;max-width:560px}
.empty-card{border:1.5px dashed #232734;border-radius:16px;padding:28px 24px;text-align:center;color:#6C7387;font-size:14px;line-height:1.6;margin:18px 0}
.facts{background:#12141B;border:1px solid #232734;border-radius:16px;padding:4px 0;margin:18px 0;overflow:hidden}
.facts .row{display:grid;grid-template-columns:130px 1fr;border-bottom:1px solid #1A1D26;padding:11px 18px;font-size:15px}
.facts .row:last-child{border-bottom:none}
.facts .row span{color:#6C7387}
.facts .row b{color:#EDEFF5;font-weight:600}
.green{color:#3DDC97}.red{color:#FF6478}.yellow{color:#FFBE4D}
ul{margin:0 0 16px 22px}li{margin-bottom:8px;font-size:15.5px}
.related{background:#12141B;border:1px solid #232734;border-radius:16px;margin-top:44px;overflow:hidden}
.related h3{font-size:12px;font-weight:800;color:#6C7387;margin:0;padding:13px 16px 4px}
.related a{display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid #1A1D26;font-size:14px;font-weight:700;color:#EDEFF5}
.related a:last-of-type{border-bottom:none}
.related a:hover{text-decoration:none;background:#181A21}
.related a::after{content:"›";margin-left:auto;color:#474D5F;font-size:17px;font-weight:700;line-height:1}
.related .rt{display:block;font-size:14px;font-weight:700;color:#EDEFF5}
.related .rs{display:block;font-size:12px;font-weight:400;color:#6C7387;margin-top:1px}
.cta{background:linear-gradient(135deg,#18172D 0%,#141329 100%);border:1px solid #7C6BFF40;border-radius:16px;padding:24px;text-align:center;margin:34px 0}
.cta a{display:inline-block;background:#7C6BFF;color:#fff;padding:11px 22px;border-radius:10px;font-weight:700;margin-top:8px}
.dash-strip{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:10px;margin:20px 0}
.dash-stat{background:#12141B;border:1px solid #232734;border-radius:12px;padding:10px 12px;display:flex;flex-direction:column-reverse;justify-content:flex-end}
.dash-stat .v{font-size:18px;font-weight:800;color:#EDEFF5;line-height:1.25;margin-top:3px;font-family:'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.dash-stat .l{font-size:11px;color:#6C7387;font-weight:700}
.top-sigs{display:flex;gap:8px;flex-wrap:wrap;margin:14px 0 4px}
.sig-pill{display:inline-flex;align-items:center;gap:6px;background:#12141B;border:1px solid #232734;border-radius:9999px;padding:8px 14px;font-size:14px;font-weight:700;color:#EDEFF5;text-decoration:none}
.sig-pill b{font-weight:800}
.temp-hero{background:linear-gradient(180deg,rgba(124,107,255,.09),transparent 42%),#12141B;border:1px solid #232734;border-left:3px solid #7C6BFF;border-radius:16px;padding:24px;margin:8px 0 26px;text-align:center}
.temp-hero .t-val{font-size:44px;font-weight:800;color:#EDEFF5;line-height:1.1;font-family:'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.temp-hero .t-label{font-size:15px;font-weight:800;margin-top:4px}
.temp-hero .t-sub{font-size:12px;color:#6C7387;margin-top:8px}
.t-bar{height:8px;border-radius:8px;background:#232734;overflow:hidden;margin:14px auto 0;max-width:420px}
.t-bar i{display:block;height:100%;border-radius:8px;background:linear-gradient(90deg,#7C6BFF,#3DDC97,#FFBE4D,#FF6478)}
table.z-tbl{width:100%;border-collapse:collapse;background:#12141B;border:1px solid #232734;border-radius:16px;overflow:hidden;margin:18px 0;font-size:14px}
table.z-tbl th{background:#1A1D26;color:#6C7387;font-size:12px;font-weight:700;text-align:left;padding:10px 14px}
table.z-tbl td{padding:11px 14px;border-top:1px solid #1A1D26;color:#A6ACBF}
table.z-tbl td b{color:#EDEFF5}
.news-list a{display:block;padding:10px 0;border-top:1px solid #1A1D26;font-size:15px;color:#A6ACBF}
.news-list a:first-child{border-top:none}
.news-list .src{font-size:12px;color:#6C7387;margin-left:6px}
footer{text-align:center;padding:40px 20px;color:#6C7387;font-size:14px;border-top:1px solid #232734;margin-top:60px}
footer a{color:#9D8FFF;text-decoration:none;margin:0 6px}
@media(max-width:640px){h1{font-size:23px}.wrap{padding:24px 16px}p,li{font-size:14.5px}.facts .row{grid-template-columns:100px 1fr;font-size:14px}.temp-hero .t-val{font-size:36px}}
`;

export const NAV = `
  <nav>
    <a class="brand" href="/"><b>Z</b>epta</a>
    <div class="nav-right">
      <div class="links">
        <a href="/">홈</a>
        <a href="/coin">코인 분석</a>
        <a href="/briefing">마켓 브리핑</a>
        <a href="/kimchi-premium">김치프리미엄</a>
        <a href="/blog">블로그</a>
      </div>
      <button class="znav-burger" onclick="zNavOpen()" aria-label="전체 메뉴">☰</button>
    </div>
  </nav>`;

export const DRAWER = `<div id="znav-overlay" onclick="zNavClose()"></div>
  <aside id="znav-drawer" aria-label="전체 메뉴">
    <div class="znav-head"><a class="brand" href="/"><b>Z</b>epta</a><button onclick="zNavClose()" aria-label="닫기">✕</button></div>
    <div class="znav-group"><div class="znav-title">마켓</div><a href="/screener">스크리너</a><a href="/coin">코인 분석</a><a href="/briefing">마켓 브리핑</a><a href="/kimchi-premium">김치프리미엄</a><a href="/news">뉴스</a><a href="/sentiment">시장 심리</a><a href="/econ-calendar">경제 일정</a></div>
    <div class="znav-group"><div class="znav-title">포트폴리오</div><a href="/portfolio">포트폴리오</a><a href="/risk-map">리스크맵</a></div>
    <div class="znav-group"><div class="znav-title">더보기</div><a href="/blog">블로그</a><a href="/about">소개</a><a href="/guide">투자 가이드</a><a href="/contact">문의</a></div>
  </aside>
  <script>function zNavOpen(){document.body.classList.add("znav-open")}function zNavClose(){document.body.classList.remove("znav-open")}document.addEventListener("keydown",function(e){if(e.key==="Escape")zNavClose()})</script>`;

export const FOOTER = `
  <footer>
    <p>© 2026 Zepta — <a href="/">홈</a> · <a href="/coin">코인 분석</a> · <a href="/briefing">마켓 브리핑</a> · <a href="/blog">블로그</a> · <a href="/about">소개</a> · <a href="/contact">문의</a></p>
    <p style="margin-top:8px;font-size:12px;color:#8A91A6">본 페이지의 정보는 투자 조언이 아니며 참고용입니다. 모든 투자의 책임은 본인에게 있습니다.</p>
  </footer>`;

// 자체 퍼스트파티 비콘(/api/track) — GA4 대체 (코인 페이지와 동일 스니펫)
export const TRACK_SNIPPET = `
  <script>
  (function(){
    function vid(){try{var v=localStorage.getItem("z_vid");if(!v){v=Date.now()+"-"+Math.random().toString(36).slice(2,10);localStorage.setItem("z_vid",v)}return v}catch(e){return null}}
    function send(p){try{var b=JSON.stringify(p);if(navigator.sendBeacon){navigator.sendBeacon("/api/track",new Blob([b],{type:"application/json"}))}else{fetch("/api/track",{method:"POST",body:b,keepalive:true,headers:{"Content-Type":"application/json"}})}}catch(e){}}
    var u=null;try{u=new URLSearchParams(location.search).get("utm_source")}catch(e){}
    send({t:"pv",path:location.pathname,vid:vid(),dev:innerWidth<=640?"m":"d",ref:document.referrer||null,utm:u});
  })();
  </script>`;

/** 면책 1줄 — 모든 신규 공개 페이지 공통 (표현 원칙) */
export const DISCLAIMER_LINE = "본 페이지는 알고리즘이 산출한 참고 정보이며 투자 조언이 아닙니다.";

/**
 * 페이지 전체 HTML 조립.
 * @param {object} o
 * @param {string} o.title       <title> 원문
 * @param {string} o.metaDesc    meta description
 * @param {string} o.canonical   canonical 절대 URL
 * @param {string} o.bodyHtml    <main class="wrap"> 안쪽 HTML (이미 이스케이프 완료 상태)
 * @param {object[]} [o.jsonLd]  JSON-LD 오브젝트 배열
 * @param {string} [o.extraHead] 추가 <head> 태그 (선택)
 * @param {string} [o.extraBody] </body> 직전 삽입 스크립트 등 (선택)
 * @param {string} [o.ogType]    og:type (기본 article)
 */
export function renderPage({ title, metaDesc, canonical, bodyHtml, jsonLd = [], extraHead = "", extraBody = "", ogType = "article" }) {
  const ldTags = jsonLd.map((o) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`).join("\n  ");
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${escA(title)}</title>
  <meta name="description" content="${escA(metaDesc)}"/>
  <link rel="canonical" href="${escA(canonical)}"/>
  <meta name="robots" content="index, follow"/>
  <meta property="og:title" content="${escA(title)}"/>
  <meta property="og:description" content="${escA(metaDesc)}"/>
  <meta property="og:type" content="${escA(ogType)}"/>
  <meta property="og:url" content="${escA(canonical)}"/>
  <meta property="og:image" content="${SITE}/og-image.png"/>
  <meta property="og:locale" content="ko_KR"/>
  <meta name="google-adsense-account" content="ca-pub-5897295133273451"/>
  ${ldTags}
  <style>${STYLE}</style>${TRACK_SNIPPET}${extraHead}
</head>
<body>${NAV}
  <main class="wrap">
${bodyHtml}
  </main>${FOOTER}${DRAWER}${extraBody}
</body>
</html>
`;
}

export default { renderPage, escA, escH, SITE, STYLE, NAV, DRAWER, FOOTER, TRACK_SNIPPET, DISCLAIMER_LINE };
