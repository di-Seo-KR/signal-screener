// ─────────────────────────────────────────────────────────────────────────────
// /coin/<sym> 공개 콘텐츠 페이지 30종 + 허브(/coin) 정적 HTML 생성.
//   vite build 후 실행 → dist/coin/*.html 생성 (블로그 public/blog/*.html 와 동일한
//   '콘텐츠 100% HTML' 패턴이라 Googlebot·AdSense 크롤러가 본문을 전부 수집함).
//
// ★ 2026-06-08 (대표 지시 / 애드센스 'low value content' 대응):
//   - evergreen 고유 콘텐츠(코인별 정체·합의·주의점) → 크롤러용(애드센스 충족).
//   - 라이브 종합 스코어 위젯(클라이언트가 /api/real-trading/coin-scores fetch) → 사용자용 '종목별 UI·자동갱신'.
//   진짜 하한은 evergreen 콘텐츠라, API 실패해도 페이지는 충분한 본문을 유지함.
// ─────────────────────────────────────────────────────────────────────────────
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { COINS } from "./coin-data.mjs";

const DIST = "dist";
const SITE = "https://zepta.app";
const GA = "G-BMP34JQ649";
const BUILD_DATE = new Date().toISOString().slice(0, 10);

const escA = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escH = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const jstr = (s) => JSON.stringify(String(s)); // JSON-LD 안전 문자열

const STYLE = `
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;background:#0A0B0F;color:#A1A6B2;line-height:1.85;word-break:keep-all;overflow-wrap:break-word}
.wrap{max-width:820px;margin:0 auto;padding:40px 20px}
nav{position:sticky;top:0;z-index:50;background:rgba(10,11,15,.92);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border-bottom:1px solid #23262F;padding:0 20px;height:56px;display:flex;align-items:center;justify-content:space-between;gap:16px}
nav .brand{font-weight:800;font-size:18px;color:#F4F5F7;text-decoration:none;letter-spacing:-0.02em}
nav .brand b{color:#4D7CFF;font-weight:800}
nav .nav-right{display:flex;align-items:center;gap:6px}
nav .links{display:flex;gap:4px}
nav .links a{padding:7px 11px;border-radius:9px;font-size:14px;font-weight:600;color:#A1A6B2;text-decoration:none;white-space:nowrap;transition:color .15s,background .15s}
nav .links a:hover{color:#F4F5F7;background:#1B1D25}
.znav-burger{width:40px;height:40px;border:1px solid #23262F;border-radius:10px;background:transparent;color:#F4F5F7;font-size:17px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background .15s}
.znav-burger:hover{background:#1B1D25}
#znav-overlay{position:fixed;inset:0;background:rgba(0,0,0,.55);opacity:0;pointer-events:none;transition:opacity .2s;z-index:98}
#znav-drawer{position:fixed;top:0;right:0;bottom:0;width:300px;max-width:85vw;background:#0F1014;border-left:1px solid #23262F;transform:translateX(102%);transition:transform .22s cubic-bezier(.2,.8,.2,1);z-index:99;overflow-y:auto;padding:0 16px 28px}
body.znav-open #znav-overlay{opacity:1;pointer-events:auto}
body.znav-open #znav-drawer{transform:translateX(0)}
.znav-head{display:flex;align-items:center;justify-content:space-between;height:56px;border-bottom:1px solid #23262F;margin-bottom:10px}
.znav-head .brand{font-weight:800;font-size:18px;color:#F4F5F7;text-decoration:none}
.znav-head .brand b{color:#4D7CFF}
.znav-head button{width:36px;height:36px;border:none;border-radius:9px;background:transparent;color:#A1A6B2;font-size:16px;cursor:pointer}
.znav-head button:hover{background:#1B1D25;color:#F4F5F7}
.znav-group{margin:14px 0}
.znav-title{font-size:11px;font-weight:800;color:#6E7585;letter-spacing:.06em;margin:0 10px 6px}
.znav-group a{display:block;padding:10px 10px;border-radius:10px;font-size:15px;font-weight:600;color:#A1A6B2;text-decoration:none}
.znav-group a:hover{color:#F4F5F7;background:#1B1D25}
@media(max-width:640px){nav .links{display:none}}
.breadcrumb{font-size:13px;color:#6E7585;margin-bottom:18px}
.breadcrumb a{color:#6E92FF;text-decoration:none}
h1{font-size:30px;font-weight:800;color:#F4F5F7;margin-bottom:10px;letter-spacing:-0.02em;line-height:1.3}
.meta-row{font-size:13px;color:#6E7585;margin-bottom:24px}
h2{font-size:21px;font-weight:700;color:#F4F5F7;margin:36px 0 14px;letter-spacing:-0.01em}
p{font-size:16px;margin-bottom:14px}
strong{color:#F4F5F7}
a{color:#6E92FF;text-decoration:none}a:hover{text-decoration:underline}
.callout{background:#131B31;border-left:3px solid #4D7CFF;padding:14px 18px;margin:18px 0;border-radius:6px;font-size:15px}
.disc{background:#1a1206;border-left:3px solid #FFB020;padding:12px 16px;margin:22px 0;border-radius:6px;font-size:13px;color:#C9B68C}
.facts{background:#14151B;border:1px solid #23262F;border-radius:12px;padding:4px 0;margin:18px 0;overflow:hidden}
.facts .row{display:grid;grid-template-columns:130px 1fr;border-bottom:1px solid #23262F;padding:11px 18px;font-size:15px}
.facts .row:last-child{border-bottom:none}
.facts .row span{color:#6E7585}
.facts .row b{color:#F4F5F7;font-weight:600}
.signal{background:linear-gradient(135deg,#131B31 0%,#0a1530 100%);border:1px solid #4D7CFF40;border-radius:14px;padding:20px;margin:8px 0 26px}
.signal-loading,.signal-na{color:#A1A6B2;font-size:15px;text-align:center;padding:8px 0}
.signal-head{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:14px}
.signal-label{font-size:13px;color:#A1A6B2}
.signal-score{font-size:22px;font-weight:800}
.tf-row{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
.tf{background:#0b1322;border:1px solid #23262F;border-radius:10px;padding:10px 6px;text-align:center}
.tf span{display:block;font-size:12px;color:#6E7585;margin-bottom:4px}
.tf b{font-size:15px;color:#F4F5F7;font-weight:700}
.signal-note{font-size:12px;color:#6E7585;margin-top:12px}
.green{color:#10D884}.red{color:#FF7B91}.yellow{color:#FFB020}
ul{margin:0 0 16px 22px}li{margin-bottom:8px;font-size:16px}
.related{background:#14151B;border:1px solid #23262F;border-radius:12px;padding:20px;margin-top:44px}
.related h3{font-size:16px;color:#F4F5F7;margin-bottom:12px}
.related a{display:block;padding:8px 0;font-size:15px;border-top:1px solid #23262F;color:#A1A6B2}
.related a:first-of-type{border-top:none}
.cta{background:linear-gradient(135deg,#131B31 0%,#0a1530 100%);border:1px solid #4D7CFF40;border-radius:14px;padding:24px;text-align:center;margin:34px 0}
.cta a{display:inline-block;background:#4D7CFF;color:#fff;padding:11px 22px;border-radius:8px;font-weight:700;margin-top:8px}
.coin-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:24px 0}
.coin-card{background:#14151B;border:1px solid #23262F;border-radius:12px;padding:16px;transition:border-color .2s,transform .2s}
.coin-card:hover{border-color:#4D7CFF;transform:translateY(-2px)}
.coin-card a{display:block;color:inherit}
.coin-card .c-sym{font-size:16px;font-weight:700;color:#F4F5F7}
.coin-card .c-ko{font-size:13px;color:#A1A6B2}
.coin-card .c-score{font-size:14px;font-weight:700;margin-top:8px;color:#6E7585}
footer{text-align:center;padding:40px 20px;color:#6E7585;font-size:14px;border-top:1px solid #23262F;margin-top:60px}
footer a{color:#6E92FF;text-decoration:none;margin:0 6px}
@media(max-width:640px){h1{font-size:24px}.wrap{padding:24px 16px}p,li{font-size:15px}.facts .row{grid-template-columns:100px 1fr;font-size:14px}}
`;

const NAV = `
  <nav>
    <a class="brand" href="/"><b>Z</b>epta</a>
    <div class="nav-right">
      <div class="links">
        <a href="/">홈</a>
        <a href="/coin">코인 분석</a>
        <a href="/blog">블로그</a>
      </div>
      <button class="znav-burger" onclick="zNavOpen()" aria-label="전체 메뉴">☰</button>
    </div>
  </nav>`;

const DRAWER = `<div id="znav-overlay" onclick="zNavClose()"></div>\n  <aside id="znav-drawer" aria-label="전체 메뉴">\n    <div class="znav-head"><a class="brand" href="/"><b>Z</b>epta</a><button onclick="zNavClose()" aria-label="닫기">✕</button></div>\n    <div class="znav-group"><div class="znav-title">마켓</div><a href="/screener">스크리너</a><a href="/coin">코인 분석</a><a href="/news">뉴스</a><a href="/sentiment">시장 심리</a><a href="/econ-calendar">경제 일정</a></div>\n    <div class="znav-group"><div class="znav-title">트레이딩</div><a href="/auto-trading">모의투자 (AI 자동매매)</a><a href="/alpha-lab">알파 랩</a><a href="/backtest">백테스트</a><a href="/leaderboard">봇 랭킹</a></div>\n    <div class="znav-group"><div class="znav-title">포트폴리오</div><a href="/portfolio">포트폴리오</a><a href="/risk-map">리스크맵</a></div>\n    <div class="znav-group"><div class="znav-title">더보기</div><a href="/blog">블로그</a><a href="/about">소개</a><a href="/guide">투자 가이드</a><a href="/contact">문의</a></div>\n  </aside>\n  <script>function zNavOpen(){document.body.classList.add("znav-open")}function zNavClose(){document.body.classList.remove("znav-open")}document.addEventListener("keydown",function(e){if(e.key==="Escape")zNavClose()})</script>`;

const FOOTER = `
  <footer>
    <p>© 2026 Zepta — <a href="/">홈</a> · <a href="/coin">코인 분석</a> · <a href="/blog">블로그</a> · <a href="/about">소개</a> · <a href="/contact">문의</a></p>
    <p style="margin-top:8px;font-size:12px;color:#474C5A">본 페이지의 정보는 투자 조언이 아니며 참고용입니다. 모든 투자의 책임은 본인에게 있습니다.</p>
  </footer>`;

const GA_SNIPPET = `
  <script async src="https://www.googletagmanager.com/gtag/js?id=${GA}"></script>
  <script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','${GA}')</script>`;

// 라이브 시그널 위젯 스크립트 (코인별 asset 매칭)
function liveScript(sym) {
  return `
  <script>
  (function(){
    var box=document.getElementById('live-signal');if(!box)return;
    function esc(s){return String(s).replace(/[&<>]/g,function(m){return{'&':'&amp;','<':'&lt;','>':'&gt;'}[m]})}
    fetch('/api/real-trading/coin-scores').then(function(r){return r.json()}).then(function(d){
      var list=(d&&d.coins)||[],c=null,i;
      for(i=0;i<list.length;i++){if(list[i].asset===${jstr(sym)}){c=list[i];break}}
      if(!c){box.innerHTML='<div class="signal-na">현재 ${escH(sym)} 종합 시그널을 집계 중입니다. 10분 주기로 갱신되니 잠시 후 다시 확인해 주세요.</div>';return}
      var isLong=c.side==='LONG',side=isLong?'롱 (매수 우위)':'숏 (매도 우위)',cls=isLong?'green':'red',bd=c.breakdown||{};
      function tf(k,label){var x=bd[k];if(!x)return '<div class="tf"><span>'+label+'</span><b>—</b></div>';var s=x.side==='LONG'?'롱':'숏',cl=x.side==='LONG'?'green':'red';return '<div class="tf"><span>'+label+'</span><b class="'+cl+'">'+s+' '+Math.round(x.score)+'</b></div>'}
      box.innerHTML='<div class="signal-head"><span class="signal-label">현재 Zepta 종합 시그널</span><span class="signal-score '+cls+'">'+side+' · '+Math.round(c.score)+'점</span></div>'+
        '<div class="tf-row">'+tf('1w','주봉')+tf('1d','일봉')+tf('4h','4시간')+tf('1h','1시간')+'</div>'+
        '<div class="signal-note">'+(c.reason?esc(c.reason):'')+' · 10분마다 자동 갱신</div>';
    }).catch(function(){box.innerHTML='<div class="signal-na">실시간 시그널을 불러오지 못했습니다. 페이지를 새로고침해 주세요.</div>'});
  })();
  </script>`;
}

function buildCoinPage(coin, idx) {
  const { sym, fut, ko, en, cat, consensus, year, desc, watch } = coin;
  const url = `${SITE}/coin/${sym.toLowerCase()}`;
  const title = `${ko}(${sym}) 전망·롱숏 스코어·자동매매 | Zepta`;
  const metaDesc = `${ko}(${en}, ${sym}) 실시간 종합 롱숏 스코어와 주봉·일봉·4시간·1시간 분석. ${cat}. Zepta AI 퀀트가 ${fut} 선물을 10분마다 자동 분석합니다.`;
  const kw = `${ko}, ${sym}, ${en}, ${ko} 전망, ${ko} 롱숏, ${sym} 자동매매, ${ko} 선물, ${fut}`;

  const faq = [
    { q: `${ko}(${sym}) 선물을 Zepta에서 자동매매할 수 있나요?`,
      a: `네. ${ko}는 Zepta가 다루는 30개 메이저 코인 중 하나로, 바이낸스 USDM 선물 ${fut} 심볼로 거래됩니다. 봇이 주봉·일봉·4시간·1시간을 종합한 스코어로 롱·숏을 자동 판단하고, 레버리지 5배·격리마진으로 진입합니다.` },
    { q: `${ko}는 어떤 코인이고 무엇에 영향을 받나요?`, a: watch },
    { q: `${ko} 롱·숏 스코어는 얼마나 자주 갱신되나요?`,
      a: `10분마다 재산출됩니다. 주봉 30%·일봉 25%·4시간 25%·1시간 20% 가중치로 네 시간대를 합산하며, 여러 시간대가 한 방향으로 모일수록 점수(확신도)가 높아집니다. 펀딩비·미결제약정(OI)·베이시스 같은 선물 지표도 보정에 반영됩니다.` },
  ];

  const faqLd = {
    "@context": "https://schema.org", "@type": "FAQPage",
    mainEntity: faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
  };
  const articleLd = {
    "@context": "https://schema.org", "@type": "Article",
    headline: `${ko}(${sym}) 전망과 실시간 롱숏 스코어`,
    description: metaDesc,
    author: { "@type": "Organization", name: "Zepta" },
    publisher: { "@type": "Organization", name: "Zepta", url: SITE + "/" },
    datePublished: BUILD_DATE, dateModified: BUILD_DATE,
    mainEntityOfPage: url, image: SITE + "/og-image.png", inLanguage: "ko",
  };
  const crumbLd = {
    "@context": "https://schema.org", "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "홈", item: SITE + "/" },
      { "@type": "ListItem", position: 2, name: "코인 분석", item: SITE + "/coin" },
      { "@type": "ListItem", position: 3, name: `${ko}(${sym})`, item: url },
    ],
  };

  // 형제 코인 5개(순환) + 블로그 2개 내부링크
  const sibs = [];
  for (let k = 1; k <= 5; k++) { const c = COINS[(idx + k) % COINS.length]; sibs.push(c); }
  const related = sibs.map((c) => `<a href="/coin/${c.sym.toLowerCase()}">${escH(c.ko)}(${c.sym}) 전망·롱숏 스코어</a>`).join("\n      ")
    + `\n      <a href="/blog/ai-trading-guide">AI 자동매매란? 시작 전에 꼭 알아야 할 것들</a>`
    + `\n      <a href="/blog/leverage-risk-guide">암호화폐 레버리지 매매 위험과 안전한 사용법</a>`;

  const faqHtml = faq.map((f) => `    <h3 style="font-size:16px;color:#F4F5F7;margin:20px 0 6px">${escH(f.q)}</h3>\n    <p>${escH(f.a)}</p>`).join("\n");

  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${escA(title)}</title>
  <meta name="description" content="${escA(metaDesc)}"/>
  <meta name="keywords" content="${escA(kw)}"/>
  <link rel="canonical" href="${url}"/>
  <meta name="robots" content="index, follow"/>
  <meta property="og:title" content="${escA(title)}"/>
  <meta property="og:description" content="${escA(metaDesc)}"/>
  <meta property="og:type" content="article"/>
  <meta property="og:url" content="${url}"/>
  <meta property="og:image" content="${SITE}/og-image.png"/>
  <meta property="og:locale" content="ko_KR"/>
  <meta name="google-adsense-account" content="ca-pub-5897295133273451"/>
  <script type="application/ld+json">${JSON.stringify(articleLd)}</script>
  <script type="application/ld+json">${JSON.stringify(faqLd)}</script>
  <script type="application/ld+json">${JSON.stringify(crumbLd)}</script>
  <style>${STYLE}</style>${GA_SNIPPET}
</head>
<body>${NAV}
  <main class="wrap">
    <div class="breadcrumb"><a href="/">홈</a> › <a href="/coin">코인 분석</a> › ${escH(ko)}(${sym})</div>
    <h1>${escH(ko)}(${sym}) 전망과 실시간 롱숏 스코어</h1>
    <div class="meta-row">${escH(cat)} · ${escH(consensus)} · ${year}년 출시 · 최종 갱신 ${BUILD_DATE}</div>

    <div class="signal" id="live-signal" data-sym="${escA(sym)}">
      <div class="signal-loading">실시간 ${escH(ko)} 종합 시그널을 불러오는 중…</div>
    </div>

    <h2>${escH(ko)}(${sym})란?</h2>
    <p>${escH(desc)}</p>
    <div class="facts">
      <div class="row"><span>한글 이름</span><b>${escH(ko)}</b></div>
      <div class="row"><span>영문 / 티커</span><b>${escH(en)} / ${sym}</b></div>
      <div class="row"><span>분류</span><b>${escH(cat)}</b></div>
      <div class="row"><span>합의 방식</span><b>${escH(consensus)}</b></div>
      <div class="row"><span>출시 연도</span><b>${year}년</b></div>
      <div class="row"><span>바이낸스 선물 심볼</span><b>${escH(fut)}</b></div>
    </div>

    <h2>Zepta는 ${escH(ko)}를 어떻게 분석하나요?</h2>
    <p>Zepta는 ${escH(ko)}(${fut})를 <strong>네 개의 시간대로 동시에</strong> 분석해 하나의 종합 스코어로 묶습니다. 주봉으로 큰 추세를, 일봉으로 중기 흐름을, 4시간·1시간으로 단기 진입 타이밍을 봅니다.</p>
    <ul>
      <li><strong>멀티 타임프레임 가중합</strong> — 주봉 30% · 일봉 25% · 4시간 25% · 1시간 20%. 여러 시간대가 같은 방향이면 점수가 높아지고, 서로 엇갈리면 상쇄돼 신중하게 판단합니다.</li>
      <li><strong>선물 시장 지표 반영</strong> — 펀딩비, 미결제약정(OI) 변화, 베이시스(현·선물 괴리)를 보정에 넣어 과열·쏠림 구간을 걸러냅니다.</li>
      <li><strong>10분마다 재산출</strong> — 위 실시간 시그널 박스가 가장 최근 계산값이며 자동으로 갱신됩니다.</li>
      <li><strong>자동 진입·청산</strong> — 봇 매매를 켜면 ${escH(ko)} 스코어가 충분히 강할 때 레버리지 5배·격리마진으로 진입하고, 손절·익절을 자동 관리합니다.</li>
    </ul>

    <h2>${escH(ko)} 매매 시 주의할 점</h2>
    <p>${escH(watch)}</p>
    <p>선물 거래는 레버리지가 손익을 함께 키웁니다. 청산가까지 거리를 항상 확인하고, 한 종목에 자본을 몰아넣지 않는 것이 안전합니다. Zepta는 종목별 포지션을 가용 잔고 안에서 자동으로 조절하지만, 시장 급변 시 손실이 발생할 수 있습니다.</p>

    <div class="disc">⚠️ 위 종합 스코어와 설명은 알고리즘이 산출한 <strong>참고 정보</strong>이며 투자 조언이나 매수·매도 권유가 아닙니다. 암호화폐 선물은 원금 손실 위험이 크며, 모든 투자 판단과 책임은 본인에게 있습니다.</div>

    <h2>자주 묻는 질문</h2>
${faqHtml}

    <div class="cta">
      <p>${escH(ko)}를 포함한 30개 메이저 코인을 AI가 자동으로 분석·매매합니다.</p>
      <a href="/auto-trading">AI 자동매매 살펴보기 →</a>
    </div>

    <div class="related">
      <h3>다른 코인·가이드 보기</h3>
      ${related}
    </div>
  </main>${FOOTER}${DRAWER}${liveScript(sym)}
</body>
</html>
`;
}

function buildHub() {
  const url = `${SITE}/coin`;
  const title = "코인별 실시간 롱숏 스코어 — 메이저 30종 AI 분석 | Zepta";
  const metaDesc = "비트코인·이더리움·솔라나 등 메이저 30개 코인의 실시간 종합 롱숏 스코어. 주봉·일봉·4시간·1시간을 종합해 10분마다 자동 분석합니다.";
  const cards = COINS.map((c) => `      <div class="coin-card"><a href="/coin/${c.sym.toLowerCase()}"><div class="c-sym">${c.sym}</div><div class="c-ko">${escH(c.ko)}</div><div class="c-score" data-sym="${escA(c.sym)}">로딩…</div></a></div>`).join("\n");
  const listText = COINS.map((c) => `${escH(c.ko)}(${c.sym})`).join(", ");
  const crumbLd = {
    "@context": "https://schema.org", "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "홈", item: SITE + "/" },
      { "@type": "ListItem", position: 2, name: "코인 분석", item: url },
    ],
  };
  const itemListLd = {
    "@context": "https://schema.org", "@type": "ItemList",
    itemListElement: COINS.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: `${c.ko}(${c.sym})`, url: `${SITE}/coin/${c.sym.toLowerCase()}` })),
  };

  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${escA(title)}</title>
  <meta name="description" content="${escA(metaDesc)}"/>
  <meta name="keywords" content="코인 롱숏 스코어, 코인 전망, 비트코인 전망, 이더리움 전망, 알트코인 분석, 암호화폐 자동매매, 코인 종합 스코어"/>
  <link rel="canonical" href="${url}"/>
  <meta name="robots" content="index, follow"/>
  <meta property="og:title" content="${escA(title)}"/>
  <meta property="og:description" content="${escA(metaDesc)}"/>
  <meta property="og:type" content="website"/>
  <meta property="og:url" content="${url}"/>
  <meta property="og:image" content="${SITE}/og-image.png"/>
  <meta property="og:locale" content="ko_KR"/>
  <meta name="google-adsense-account" content="ca-pub-5897295133273451"/>
  <script type="application/ld+json">${JSON.stringify(crumbLd)}</script>
  <script type="application/ld+json">${JSON.stringify(itemListLd)}</script>
  <style>${STYLE}</style>${GA_SNIPPET}
</head>
<body>${NAV}
  <main class="wrap">
    <div class="breadcrumb"><a href="/">홈</a> › 코인 분석</div>
    <h1>코인별 실시간 롱숏 스코어</h1>
    <div class="meta-row">메이저 30종 · 주봉·일봉·4시간·1시간 종합 · 10분마다 자동 갱신 · 최종 갱신 ${BUILD_DATE}</div>

    <p>Zepta는 비트코인을 비롯한 메이저 암호화폐 <strong>30종</strong>을 각각 네 개의 시간대(주봉·일봉·4시간·1시간)로 동시에 분석해, 지금 롱(매수)과 숏(매도) 중 어느 쪽 우위인지 하나의 <strong>종합 스코어</strong>로 보여줍니다. 아래에서 종목을 선택하면 코인별 상세 분석과 실시간 시그널을 확인할 수 있습니다.</p>

    <div class="coin-grid">
${cards}
    </div>

    <h2>종합 스코어는 어떻게 계산되나요?</h2>
    <p>각 코인의 주봉(30%)·일봉(25%)·4시간(25%)·1시간(20%) 신호를 방향 가중합해 산출합니다. 여러 시간대가 같은 방향으로 모이면 확신도가 높아지고, 엇갈리면 점수가 낮아져 신중해집니다. 여기에 펀딩비·미결제약정(OI)·베이시스 같은 선물 지표를 더해 과열·쏠림을 보정합니다. 모든 값은 10분마다 다시 계산됩니다.</p>

    <h2>분석 대상 30종</h2>
    <p>${listText}.</p>

    <div class="disc">⚠️ 본 페이지의 스코어는 알고리즘 산출 참고 정보이며 투자 조언이 아닙니다. 암호화폐 선물은 원금 손실 위험이 크며, 투자 판단과 책임은 본인에게 있습니다.</div>

    <div class="cta">
      <p>30종 전체를 AI가 자동으로 분석하고, 원하면 자동매매까지 맡길 수 있습니다.</p>
      <a href="/auto-trading">AI 자동매매 살펴보기 →</a>
    </div>
  </main>${FOOTER}${DRAWER}
  <script>
  (function(){
    fetch('/api/real-trading/coin-scores').then(function(r){return r.json()}).then(function(d){
      var list=(d&&d.coins)||[],map={},i;
      for(i=0;i<list.length;i++){map[list[i].asset]=list[i]}
      var cells=document.querySelectorAll('.c-score[data-sym]');
      for(i=0;i<cells.length;i++){(function(el){var c=map[el.getAttribute('data-sym')];if(!c){el.textContent='집계 중';return}var isLong=c.side==='LONG';el.textContent=(isLong?'롱 ':'숏 ')+Math.round(c.score);el.style.color=isLong?'#10D884':'#FF7B91'})(cells[i])}
    }).catch(function(){});
  })();
  </script>
</body>
</html>
`;
}

// ── 실행 ──
mkdirSync(`${DIST}/coin`, { recursive: true });
let n = 0;
for (let i = 0; i < COINS.length; i++) {
  const c = COINS[i];
  writeFileSync(`${DIST}/coin/${c.sym.toLowerCase()}.html`, buildCoinPage(c, i), "utf8");
  n++;
}
writeFileSync(`${DIST}/coin/index.html`, buildHub(), "utf8");
console.log(`[coin-pages] ${n}개 코인 페이지 + 허브(/coin) 생성 완료 — dist/coin/*.html (애드센스 low-value-content 대응: 코인별 고유 콘텐츠 + 라이브 스코어).`);

// ── 사이트맵 자동 주입 (dist/sitemap.xml — vite 가 public/ 에서 복사한 것에 코인 URL 추가) ──
try {
  const smPath = `${DIST}/sitemap.xml`;
  if (existsSync(smPath)) {
    let sm = readFileSync(smPath, "utf8");
    const entry = (loc, pr) => `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${BUILD_DATE}</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>${pr}</priority>\n  </url>`;
    const urls = [entry(`${SITE}/coin`, "0.9")]
      .concat(COINS.map((c) => entry(`${SITE}/coin/${c.sym.toLowerCase()}`, "0.8")))
      .join("\n");
    if (!sm.includes(`${SITE}/coin/`)) {
      sm = sm.replace(/<\/urlset>/i, `${urls}\n</urlset>`);
      writeFileSync(smPath, sm, "utf8");
      console.log(`[coin-pages] sitemap.xml 에 코인 URL ${COINS.length + 1}개 주입 완료.`);
    } else {
      console.log("[coin-pages] sitemap.xml 에 코인 URL 이미 존재 — 주입 생략.");
    }
  } else {
    console.warn("[coin-pages] dist/sitemap.xml 없음 — 사이트맵 주입 생략 (vite build 후 실행 필요).");
  }
} catch (e) {
  console.warn("[coin-pages] sitemap 주입 실패:", e?.message);
}
