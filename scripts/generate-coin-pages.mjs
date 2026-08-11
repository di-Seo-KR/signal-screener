// ─────────────────────────────────────────────────────────────────────────────
// /coin/<sym> 공개 콘텐츠 페이지(coin-data.mjs COINS 전종) + 허브(/coin) 정적 HTML 생성.
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
const BUILD_DATE = new Date().toISOString().slice(0, 10);

const escA = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escH = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const jstr = (s) => JSON.stringify(String(s)); // JSON-LD 안전 문자열

// ★ 2026-08 신규 화면 시안(1a 종목 상세·1f 스크리너) 시각 문법 이식:
//   카드 어법 · 방향 강조(좌측 3px accent + 상단 그라데이션) · mono 수치 · 상태 배지 · 점선 빈 상태.
//   색은 하드코딩 대신 :root CSS 변수로만 사용하며, 값은 src/ui/theme.jsx
//   THEME_TOKENS.dark(디자인 시스템 v2, 2026-08-12 대표 확정 — accent 퍼플 #7C6BFF ·
//   상승 #16C784 · 하락 #F23D5C)와 1:1 동기화합니다. 화면 시안(zepta-screens.dc.html)의
//   v1 팔레트 예시색은 따르지 않습니다(SPA 와 정적 /coin 의 브랜드 팔레트 분열 방지).
//   아래 rgba(...) 알파 틴트도 전부 위 토큰색에서 파생된 값 — 토큰 변경 시 함께 갱신.
//   정적 페이지는 기존과 동일하게 다크 단일 테마입니다.
const STYLE = `
:root{
--bg:#0A0B10;--card:#12141B;--card2:#1A1D26;--border:#232734;--border2:#2E3342;
--text1:#EDEFF5;--text2:#A6ACBF;--text3:#6C7387;--text4:#8A91A6;
--blue:#7C6BFF;--blue-l:#9D8FFF;--blue-bg:#18172D;
--green:#16C784;--green-l:#3DDC97;--red:#F23D5C;--red-l:#FF6478;
--yellow:#F5A524;--yellow-l:#FFBE4D;--yellow-bg:#291F13;--purple:#9D8FFF;--purple-l:#B7ACFF;
--mono:'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;background:var(--bg);color:var(--text2);line-height:1.85;word-break:keep-all;overflow-wrap:break-word}
.wrap{max-width:820px;margin:0 auto;padding:40px 20px}
nav{position:sticky;top:0;z-index:50;background:rgba(10,11,16,.92);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border-bottom:1px solid var(--border);padding:0 20px;height:56px;display:flex;align-items:center;justify-content:space-between;gap:16px}
nav .brand{font-weight:800;font-size:18px;color:var(--text1);text-decoration:none;letter-spacing:-0.02em}
nav .brand b{color:var(--blue);font-weight:800}
nav .nav-right{display:flex;align-items:center;gap:6px}
nav .links{display:flex;gap:4px}
nav .links a{padding:7px 11px;border-radius:9px;font-size:14px;font-weight:600;color:var(--text2);text-decoration:none;white-space:nowrap;transition:color .15s,background .15s}
nav .links a:hover{color:var(--text1);background:var(--card2)}
.znav-burger{width:40px;height:40px;border:1px solid var(--border);border-radius:10px;background:transparent;color:var(--text1);font-size:17px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background .15s}
.znav-burger:hover{background:var(--card2)}
#znav-overlay{position:fixed;inset:0;background:rgba(0,0,0,.55);opacity:0;pointer-events:none;transition:opacity .2s;z-index:98}
#znav-drawer{position:fixed;top:0;right:0;bottom:0;width:300px;max-width:85vw;background:#0E0F16;border-left:1px solid var(--border);transform:translateX(102%);transition:transform .22s cubic-bezier(.2,.8,.2,1);z-index:99;overflow-y:auto;padding:0 16px 28px}
body.znav-open #znav-overlay{opacity:1;pointer-events:auto}
body.znav-open #znav-drawer{transform:translateX(0)}
.znav-head{display:flex;align-items:center;justify-content:space-between;height:56px;border-bottom:1px solid var(--border);margin-bottom:10px}
.znav-head .brand{font-weight:800;font-size:18px;color:var(--text1);text-decoration:none}
.znav-head .brand b{color:var(--blue)}
.znav-head button{width:36px;height:36px;border:none;border-radius:9px;background:transparent;color:var(--text2);font-size:16px;cursor:pointer}
.znav-head button:hover{background:var(--card2);color:var(--text1)}
.znav-group{margin:14px 0}
.znav-title{font-size:11px;font-weight:800;color:var(--text3);letter-spacing:.06em;margin:0 10px 6px}
.znav-group a{display:block;padding:10px 10px;border-radius:10px;font-size:15px;font-weight:600;color:var(--text2);text-decoration:none}
.znav-group a:hover{color:var(--text1);background:var(--card2)}
@media(max-width:640px){nav .links{display:none}}
.breadcrumb{font-size:13px;color:var(--text3);margin-bottom:18px}
.breadcrumb a{color:var(--blue-l);text-decoration:none}
h1{font-size:30px;font-weight:800;color:var(--text1);margin-bottom:10px;letter-spacing:-0.02em;line-height:1.3}
.meta-row{font-size:13px;color:var(--text3);margin-bottom:24px}
.page-head{display:flex;align-items:flex-start;gap:12px;margin-bottom:6px}
.page-head .head-ico{width:38px;height:38px;border-radius:11px;background:rgba(124,107,255,.14);color:var(--blue-l);display:flex;align-items:center;justify-content:center;font-size:17px;font-weight:800;flex-shrink:0;margin-top:5px}
h2{font-size:21px;font-weight:700;color:var(--text1);margin:36px 0 14px;letter-spacing:-0.01em}
p{font-size:16px;margin-bottom:14px}
strong{color:var(--text1)}
a{color:var(--blue-l);text-decoration:none}a:hover{text-decoration:underline}
.mono{font-family:var(--mono)}
.callout{background:var(--blue-bg);border-left:3px solid var(--blue);padding:14px 18px;margin:18px 0;border-radius:10px;font-size:15px}
.disc{background:var(--yellow-bg);border-left:3px solid var(--yellow);padding:12px 16px;margin:22px 0;border-radius:10px;font-size:13px;color:var(--text2)}
.disc strong{color:var(--yellow-l)}
.facts{background:var(--card);border:1px solid var(--border);border-radius:14px;padding:4px 0;margin:18px 0;overflow:hidden}
.facts .row{display:grid;grid-template-columns:130px 1fr;border-bottom:1px solid var(--border);padding:11px 18px;font-size:15px}
.facts .row:last-child{border-bottom:none}
.facts .row span{color:var(--text3)}
.facts .row b{color:var(--text1);font-weight:600}
.facts .row b.mono{font-weight:700;font-size:14px}
.signal{background:var(--card);border:1px solid var(--border);border-radius:16px;padding:15px 16px;margin:8px 0 26px}
.signal.is-long{background:linear-gradient(180deg,rgba(22,199,132,.1),transparent 42%),var(--card);border-left:3px solid var(--green)}
.signal.is-short{background:linear-gradient(180deg,rgba(242,61,92,.1),transparent 42%),var(--card);border-left:3px solid var(--red)}
.signal.is-empty{border:none;background:transparent;padding:0}
.signal-loading{color:var(--text2);font-size:15px;text-align:center;padding:8px 0}
.signal-msg{color:var(--text2);font-size:14.5px;text-align:center;padding:8px 0;line-height:1.65}
.signal-na{border:1.5px dashed var(--border);border-radius:16px;padding:26px 20px;display:flex;flex-direction:column;align-items:center;gap:6px;text-align:center}
.signal-na .na-ico{width:52px;height:52px;border-radius:16px;background:var(--card2);display:flex;align-items:center;justify-content:center;color:var(--text3)}
.signal-na .na-t{font-size:15px;font-weight:800;color:var(--text1);margin-top:8px}
.signal-na .na-d{font-size:12.5px;color:var(--text4);line-height:1.65;max-width:420px}
.sig-top{display:flex;align-items:center;gap:14px}
.sig-donut{width:64px;height:64px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.sig-donut i{width:48px;height:48px;border-radius:50%;background:var(--card);display:flex;align-items:center;justify-content:center;font-family:var(--mono);font-size:18px;font-weight:800;font-style:normal}
.is-long .sig-donut i{color:var(--green-l)}
.is-short .sig-donut i{color:var(--red-l)}
.sig-col{display:flex;flex-direction:column;gap:6px;min-width:0}
.sig-badge{align-self:flex-start;font-size:12px;font-weight:800;padding:3px 10px;border-radius:8px}
.is-long .sig-badge{background:rgba(22,199,132,.1);color:var(--green-l)}
.is-short .sig-badge{background:rgba(242,61,92,.12);color:var(--red-l)}
.sig-cap{font-size:11px;color:var(--text3)}
.tf-row{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-top:12px}
.tf{background:var(--card2);border-radius:12px;padding:10px 6px;text-align:center}
.tf span{display:block;font-size:11px;font-weight:700;color:var(--text3);margin-bottom:4px}
.tf b{font-size:14px;font-weight:800;font-family:var(--mono);color:var(--text1)}
.tf b.green{color:var(--green-l)}.tf b.red{color:var(--red-l)}
.signal-note{font-size:11px;color:var(--text3);margin-top:11px;line-height:1.55}
.green{color:var(--green-l)}.red{color:var(--red-l)}.yellow{color:var(--yellow-l)}
ul{margin:0 0 16px 22px}li{margin-bottom:8px;font-size:16px}
.related{background:var(--card);border:1px solid var(--border);border-radius:14px;padding:20px;margin-top:44px}
.related h3{font-size:16px;color:var(--text1);margin-bottom:12px}
.related a{display:block;padding:8px 0;font-size:15px;border-top:1px solid var(--border);color:var(--text2)}
.related a:first-of-type{border-top:none}
.cta{background:var(--blue-bg);border:1px solid rgba(124,107,255,.25);border-radius:16px;padding:24px;text-align:center;margin:34px 0}
.cta a{display:inline-block;background:var(--blue);color:#fff;padding:11px 22px;border-radius:10px;font-weight:700;margin-top:8px}
.coin-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(164px,1fr));gap:10px;margin:24px 0}
.coin-card{background:var(--card);border:1px solid var(--border);border-radius:14px;padding:12px 14px;transition:border-color .2s,transform .2s}
.coin-card:hover{border-color:var(--blue);transform:translateY(-2px)}
.coin-card.is-long{background:linear-gradient(180deg,rgba(22,199,132,.07),transparent 42%),var(--card);border-left:3px solid var(--green)}
.coin-card.is-short{background:linear-gradient(180deg,rgba(242,61,92,.07),transparent 42%),var(--card);border-left:3px solid var(--red)}
.coin-card a{display:block;color:inherit;text-decoration:none}
.coin-card .c-sym{font-size:15px;font-weight:800;color:var(--text1);font-family:var(--mono)}
.coin-card .c-ko{font-size:12px;color:var(--text2)}
.coin-card .c-score{font-size:14px;font-weight:800;font-family:var(--mono);margin-top:8px;color:var(--text3)}
.coin-card .c-score.up{color:var(--green-l)}
.coin-card .c-score.down{color:var(--red-l)}
.dash-strip{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:10px;margin:20px 0}
.live-note{background:var(--card);border:1px solid var(--border);border-radius:14px;padding:12px 16px;margin:0 0 16px;font-size:14px;color:var(--text2);text-align:center}
.live-note a{color:var(--blue-l);font-weight:600}
.dash-stat{background:var(--card);border:1px solid var(--border);border-radius:14px;padding:14px 10px;text-align:center}
.dash-stat .v{font-size:22px;font-weight:800;font-family:var(--mono);color:var(--text1);line-height:1.2}
.dash-stat .v.green{color:var(--green-l)}.dash-stat .v.red{color:var(--red-l)}
.dash-stat .l{font-size:11px;font-weight:700;color:var(--text3);margin-top:3px}
.top-sigs{display:flex;gap:8px;flex-wrap:wrap;margin:14px 0 4px}
.sig-pill{display:inline-flex;align-items:center;gap:6px;background:var(--card);border:1px solid var(--border);border-radius:9999px;padding:8px 14px;font-size:13px;font-weight:700;color:var(--text1);text-decoration:none}
.sig-pill b{font-weight:800;font-family:var(--mono)}
.c-side{display:inline-block;font-size:10px;font-weight:800;padding:3px 8px;border-radius:8px;margin-top:8px}
.side-long{background:rgba(22,199,132,.1);color:var(--green-l)}
.side-short{background:rgba(242,61,92,.12);color:var(--red-l)}
.c-bar{height:5px;border-radius:3px;background:var(--card2);overflow:hidden;margin-top:8px}
.c-bar i{display:block;height:100%;border-radius:3px}
.c-bar i.up{background:var(--green)}
.c-bar i.down{background:var(--red)}
footer{text-align:center;padding:40px 20px;color:var(--text3);font-size:14px;border-top:1px solid var(--border);margin-top:60px}
footer a{color:var(--blue-l);text-decoration:none;margin:0 6px}
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

const DRAWER = `<div id="znav-overlay" onclick="zNavClose()"></div>\n  <aside id="znav-drawer" aria-label="전체 메뉴">\n    <div class="znav-head"><a class="brand" href="/"><b>Z</b>epta</a><button onclick="zNavClose()" aria-label="닫기">✕</button></div>\n    <div class="znav-group"><div class="znav-title">마켓</div><a href="/screener">스크리너</a><a href="/coin">코인 분석</a><a href="/news">뉴스</a><a href="/sentiment">시장 심리</a><a href="/econ-calendar">경제 일정</a></div>\n    <div class="znav-group"><div class="znav-title">포트폴리오</div><a href="/portfolio">포트폴리오</a><a href="/risk-map">리스크맵</a></div>\n    <div class="znav-group"><div class="znav-title">더보기</div><a href="/blog">블로그</a><a href="/about">소개</a><a href="/guide">투자 가이드</a><a href="/contact">문의</a></div>\n  </aside>\n  <script>function zNavOpen(){document.body.classList.add("znav-open")}function zNavClose(){document.body.classList.remove("znav-open")}document.addEventListener("keydown",function(e){if(e.key==="Escape")zNavClose()})</script>`;

const FOOTER = `
  <footer>
    <p>© 2026 Zepta — <a href="/">홈</a> · <a href="/coin">코인 분석</a> · <a href="/blog">블로그</a> · <a href="/about">소개</a> · <a href="/contact">문의</a></p>
    <p style="margin-top:8px;font-size:12px;color:var(--text4)">본 페이지의 정보는 투자 조언이 아니며 참고용입니다. 모든 투자의 책임은 본인에게 있습니다.</p>
  </footer>`;

// ★ 2026-06-12 (대표 결정): GA4 제거 — 자체 퍼스트파티 비콘(/api/track)으로 교체.
//   무쿠키·익명 vid, 경로는 런타임 location.pathname (허브/코인 페이지 공용).
const GA_SNIPPET = `
  <script>
  (function(){
    function vid(){try{var v=localStorage.getItem("z_vid");if(!v){v=Date.now()+"-"+Math.random().toString(36).slice(2,10);localStorage.setItem("z_vid",v)}return v}catch(e){return null}}
    function send(p){try{var b=JSON.stringify(p);if(navigator.sendBeacon){navigator.sendBeacon("/api/track",new Blob([b],{type:"application/json"}))}else{fetch("/api/track",{method:"POST",body:b,keepalive:true,headers:{"Content-Type":"application/json"}})}}catch(e){}}
    var u=null;try{u=new URLSearchParams(location.search).get("utm_source")}catch(e){}
    send({t:"pv",path:location.pathname,vid:vid(),dev:innerWidth<=640?"m":"d",ref:document.referrer||null,utm:u});
  })();
  </script>`;

// 라이브 시그널 위젯 스크립트 (코인별 asset 매칭)
//   ★ 2026-08 매칭 보정: 풀의 asset 은 1000PEPE 처럼 바이낸스 1000X 승수 접두가 붙을 수
//     있어 허브(render)와 동일하게 ^1000 정규화 후 대조하고, MATIC→POL 처럼 자산 표기가
//     바뀐 코인은 선물 심볼(fut) 대조로 구제합니다. 풀에 없으면 "집계 중"(일시 상태로
//     오인되는 거짓 문구) 대신 유니버스 미편입 사실을 그대로 안내합니다.
function liveScript(sym, fut) {
  return `
  <script>
  (function(){
    var box=document.getElementById('live-signal');if(!box)return;
    function esc(s){return String(s).replace(/[&<>]/g,function(m){return{'&':'&amp;','<':'&lt;','>':'&gt;'}[m]})}
    fetch('/api/real-trading/coin-scores').then(function(r){return r.json()}).then(function(d){
      var list=(d&&d.coins)||[],c=null,i;
      for(i=0;i<list.length;i++){var a=String(list[i].asset||'').replace(/^1000/,'');if(a===${jstr(sym)}||String(list[i].symbol||'')===${jstr(fut)}){c=list[i];break}}
      if(!c){box.className='signal is-empty';box.innerHTML='<div class="signal-na">'+
        '<div class="na-ico"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg></div>'+
        '<div class="na-t">종합 스코어 미산출</div>'+
        '<div class="na-d">${escH(sym)}는 현재 Zepta 실시간 분석 유니버스(바이낸스 USDⓈ-M 선물 거래대금 상위 코인, 6시간 주기 자동 재선별)에 포함돼 있지 않아 종합 스코어가 산출되지 않습니다.</div>'+
        '<div class="na-d" style="margin-top:4px"><a href="/coin">현재 분석 중인 코인 보기 →</a></div></div>';return}
      var isLong=c.side==='LONG',side=isLong?'상승 모멘텀 우세':'하락 모멘텀 우세',bd=c.breakdown||{};
      var score=Math.round(c.score||0),deg=Math.round(Math.max(0,Math.min(100,score))*3.6);
      function tf(k,label){var x=bd[k];if(!x)return '<div class="tf"><span>'+label+'</span><b>—</b></div>';var s=x.side==='LONG'?'상승':'하락',cl=x.side==='LONG'?'green':'red';return '<div class="tf"><span>'+label+'</span><b class="'+cl+'">'+s+' '+Math.round(x.score)+'</b></div>'}
      box.className='signal '+(isLong?'is-long':'is-short');
      box.innerHTML='<div class="sig-top">'+
        '<div class="sig-donut" style="background:conic-gradient(var('+(isLong?'--green-l':'--red-l')+') 0 '+deg+'deg,var(--border) '+deg+'deg 360deg)"><i>'+score+'</i></div>'+
        '<div class="sig-col"><span class="sig-badge">'+side+'</span>'+
        '<span class="sig-cap">현재 Zepta 종합 시그널 · '+score+'점</span>'+
        '<span class="sig-cap">주봉·일봉·4시간·1시간 가중 집계</span></div></div>'+
        '<div class="tf-row">'+tf('1w','주봉')+tf('1d','일봉')+tf('4h','4시간')+tf('1h','1시간')+'</div>'+
        '<div class="signal-note">'+(c.reason?esc(c.reason)+' · ':'')+'10분마다 자동 갱신</div>';
    }).catch(function(){box.className='signal';box.innerHTML='<div class="signal-msg">실시간 시그널을 불러오지 못했습니다. 페이지를 새로고침해 주세요.</div>'});
  })();
  </script>`;
}

function buildCoinPage(coin, idx) {
  const { sym, fut, ko, en, cat, consensus, year, desc, watch } = coin;
  const url = `${SITE}/coin/${sym.toLowerCase()}`;
  const title = `${ko}(${sym}) 전망·멀티 타임프레임 모멘텀 스코어 | Zepta`;
  // ★ 2026-08: 유니버스(유동성 상위 자동 선별) 밖 코인 페이지에서 "10분마다 자동 분석"
  //   단정이 거짓이 되지 않도록, 스코어 산출 주장은 모두 '유니버스 편입 시' 조건부로 서술합니다.
  const metaDesc = `${ko}(${en}, ${sym}) 종합 모멘텀 스코어와 주봉·일봉·4시간·1시간 분석. ${cat}. 유동성 상위 유니버스 편입 시 Zepta 가 ${fut} 시장 데이터를 10분마다 자동 분석합니다.`;
  const kw = `${ko}, ${sym}, ${en}, ${ko} 전망, ${ko} 모멘텀, ${sym} 분석, ${ko} 시세, ${fut}`;

  const faq = [
    { q: `Zepta의 ${ko}(${sym}) 스코어는 어떤 서비스인가요?`,
      a: `Zepta 는 투자 정보·데이터 서비스입니다. ${ko}는 Zepta가 상세 분석을 제공하는 ${COINS.length}개 메이저 코인 중 하나로, 실시간 분석 유니버스(바이낸스 선물 거래대금 상위 코인, 자동 선별)에 편입돼 있는 동안 주봉·일봉·4시간·1시간을 종합한 모멘텀 스코어를 10분마다 산출해 참고 정보로 제공합니다. 매매를 대행하거나 특정 매매를 권유하지 않습니다.` },
    { q: `${ko}는 어떤 코인이고 무엇에 영향을 받나요?`, a: watch },
    { q: `${ko} 모멘텀 스코어는 얼마나 자주 갱신되나요?`,
      a: `실시간 분석 유니버스에 편입돼 있는 동안 10분마다 재산출됩니다. 유니버스는 바이낸스 선물 거래대금 상위 코인으로 6시간 주기 자동 재선별되며, 편입되지 않은 기간에는 스코어가 제공되지 않습니다. 주봉 30%·일봉 25%·4시간 25%·1시간 20% 가중치로 네 시간대를 합산하며, 여러 시간대가 한 방향으로 모일수록 점수(확신도)가 높아집니다. 펀딩비·미결제약정(OI)·베이시스 같은 선물 지표도 보정에 반영됩니다.` },
  ];

  const faqLd = {
    "@context": "https://schema.org", "@type": "FAQPage",
    mainEntity: faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
  };
  const articleLd = {
    "@context": "https://schema.org", "@type": "Article",
    headline: `${ko}(${sym}) 전망과 멀티 타임프레임 모멘텀 스코어`,
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
  const related = sibs.map((c) => `<a href="/coin/${c.sym.toLowerCase()}">${escH(c.ko)}(${c.sym}) 전망·모멘텀 스코어</a>`).join("\n      ")
    + `\n      <a href="/blog/quant-strategies">퀀트 전략이란? 종류와 원리 정리</a>`
    + `\n      <a href="/blog/rsi-divergence">RSI 다이버전스로 추세 전환 신호 읽는 법</a>`;

  const faqHtml = faq.map((f) => `    <h3 style="font-size:16px;color:var(--text1);margin:20px 0 6px">${escH(f.q)}</h3>\n    <p>${escH(f.a)}</p>`).join("\n");

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
    <h1>${escH(ko)}(${sym}) 전망과 멀티 타임프레임 모멘텀 스코어</h1>
    <div class="meta-row">${escH(cat)} · ${escH(consensus)} · ${year}년 출시 · 최종 갱신 ${BUILD_DATE}</div>

    <div class="signal" id="live-signal" data-sym="${escA(sym)}">
      <div class="signal-loading">실시간 ${escH(ko)} 종합 시그널을 불러오는 중…</div>
    </div>

    <h2>${escH(ko)}(${sym})란?</h2>
    <p>${escH(desc)}</p>
    <div class="facts">
      <div class="row"><span>한글 이름</span><b>${escH(ko)}</b></div>
      <div class="row"><span>영문 / 티커</span><b>${escH(en)} / <span class="mono" style="color:inherit">${sym}</span></b></div>
      <div class="row"><span>분류</span><b>${escH(cat)}</b></div>
      <div class="row"><span>합의 방식</span><b>${escH(consensus)}</b></div>
      <div class="row"><span>출시 연도</span><b>${year}년</b></div>
      <div class="row"><span>바이낸스 선물 심볼</span><b class="mono">${escH(fut)}</b></div>
    </div>

    <h2>Zepta는 ${escH(ko)}를 어떻게 분석하나요?</h2>
    <p>Zepta는 실시간 분석 유니버스(바이낸스 선물 거래대금 상위 코인, 6시간 주기 자동 재선별)에 편입된 코인을 <strong>네 개의 시간대로 동시에</strong> 분석해 하나의 종합 스코어로 묶습니다. ${escH(ko)}(${fut})가 유니버스에 편입돼 있으면 위 시그널 박스에 가장 최근 계산값이 표시됩니다. 주봉으로 큰 추세를, 일봉으로 중기 흐름을, 4시간·1시간으로 단기 흐름을 봅니다.</p>
    <ul>
      <li><strong>멀티 타임프레임 가중합</strong> — 주봉 30% · 일봉 25% · 4시간 25% · 1시간 20%. 여러 시간대가 같은 방향이면 점수가 높아지고, 서로 엇갈리면 상쇄돼 신중하게 판단합니다.</li>
      <li><strong>선물 시장 지표 반영</strong> — 펀딩비, 미결제약정(OI) 변화, 베이시스(현·선물 괴리)를 보정에 넣어 과열·쏠림 구간을 걸러냅니다.</li>
      <li><strong>10분마다 재산출</strong> — 유니버스 편입 기간에는 위 시그널 박스가 가장 최근 계산값으로 자동 갱신됩니다.</li>
    </ul>

    <h2>${escH(ko)} 시장을 볼 때 주의할 점</h2>
    <p>${escH(watch)}</p>
    <p>선물 시장은 레버리지가 손익을 함께 키우는 구조라 변동성이 큽니다. 스코어는 시장 상태를 요약한 참고 지표일 뿐이며, 시장 급변 시 신호와 다르게 움직일 수 있습니다.</p>

    <div class="disc">⚠️ 위 종합 스코어와 설명은 알고리즘이 산출한 <strong>참고 정보</strong>이며 투자 조언이나 매수·매도 권유가 아닙니다. 암호화폐 선물은 원금 손실 위험이 크며, 모든 투자 판단과 책임은 본인에게 있습니다.</div>

    <h2>자주 묻는 질문</h2>
${faqHtml}

    <div class="cta">
      <p>${escH(ko)}를 포함한 유동성 상위 코인 전체의 실시간 스코어를 한눈에 볼 수 있습니다.</p>
      <a href="/coin">코인 라이브 대시보드 보기 →</a>
    </div>

    <div class="related">
      <h3>다른 코인·가이드 보기</h3>
      ${related}
    </div>
  </main>${FOOTER}${DRAWER}${liveScript(sym, fut)}
</body>
</html>
`;
}

function buildHub() {
  const url = `${SITE}/coin`;
  const title = "코인 라이브 대시보드 — 멀티 타임프레임 모멘텀 스코어 AI 분석 | Zepta";
  const metaDesc = "비트코인·이더리움을 포함한 유동성 상위 코인 전체의 실시간 종합 모멘텀 스코어 대시보드. 주봉·일봉·4시간·1시간을 종합해 10분마다 자동 분석합니다.";
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
  <meta name="keywords" content="코인 모멘텀 스코어, 코인 전망, 비트코인 전망, 이더리움 전망, 알트코인 분석, 암호화폐 데이터 분석, 코인 종합 스코어"/>
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
    <div class="page-head">
      <span class="head-ico" aria-hidden="true">↗</span>
      <div>
        <h1>코인 라이브 대시보드</h1>
        <div class="meta-row">유동성 상위 코인 자동 선별 · 주봉·일봉·4시간·1시간 종합 · 10분마다 자동 갱신 · 최종 갱신 ${BUILD_DATE}</div>
      </div>
    </div>

    <p>Zepta는 바이낸스 선물에서 <strong>유동성 상위 코인 전체</strong>(약 50종, 자동 선별)를 네 개의 시간대(주봉·일봉·4시간·1시간)로 동시에 분석해, 지금 상승 모멘텀과 하락 모멘텀 중 어느 쪽 우세인지 하나의 <strong>종합 스코어</strong>로 보여줍니다.</p>

    <!-- 라이브 요약 스트립 -->
    <div class="dash-strip" id="dash-strip">
      <div class="dash-stat"><div class="v" id="st-total">—</div><div class="l">분석 종목</div></div>
      <div class="dash-stat"><div class="v green" id="st-long">—</div><div class="l">상승 우위</div></div>
      <div class="dash-stat"><div class="v red" id="st-short">—</div><div class="l">하락 우위</div></div>
      <div class="dash-stat"><div class="v" id="st-avg">—</div><div class="l">평균 스코어</div></div>
    </div>

    <!-- 라이브 집계 상태 안내 (빈 응답·조회 실패 시에만 노출) -->
    <div class="live-note" id="live-note" style="display:none"></div>

    <!-- 지금 가장 강한 시그널 -->
    <div class="top-sigs" id="top-sigs" style="display:none"></div>

    <div class="coin-grid" id="coin-grid">
${cards}
    </div>

    <h2>종합 스코어는 어떻게 계산되나요?</h2>
    <p>각 코인의 주봉(30%)·일봉(25%)·4시간(25%)·1시간(20%) 신호를 방향 가중합해 산출합니다. 여러 시간대가 같은 방향으로 모이면 확신도가 높아지고, 엇갈리면 점수가 낮아져 신중해집니다. 여기에 펀딩비·미결제약정(OI)·베이시스 같은 선물 지표를 더해 과열·쏠림을 보정합니다. 모든 값은 10분마다 다시 계산되며, 분석 대상은 거래대금 기준 상위 코인으로 자동 교체됩니다.</p>

    <h2>상세 분석 페이지 제공 코인</h2>
    <p>${listText} — 메이저 ${COINS.length}종은 코인별 정체·합의 방식·주의점까지 담은 상세 페이지를 제공합니다. 그 외 유동성 상위 신규 코인은 위 대시보드에서 실시간 스코어로 확인할 수 있습니다.</p>

    <div class="disc">⚠️ 본 페이지의 스코어는 알고리즘 산출 참고 정보이며 투자 조언이 아닙니다. 암호화폐 선물은 원금 손실 위험이 크며, 투자 판단과 책임은 본인에게 있습니다.</div>

    <div class="cta">
      <p>유동성 상위 코인 전체를 조건 검색으로 더 깊게 살펴볼 수 있습니다.</p>
      <a href="/screener">실시간 스크리너 살펴보기 →</a>
    </div>
  </main>${FOOTER}${DRAWER}
  <script>
  (function(){
    // 상세 페이지 보유 코인 — sym/선물심볼 모두 매핑
    var PAGES={${COINS.map((c) => `"${c.sym}":"/coin/${c.sym.toLowerCase()}","${c.fut}":"/coin/${c.sym.toLowerCase()}"`).join(",")}};
    function esc(s){return String(s).replace(/[&<>"]/g,function(ch){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[ch]})}
    // ★ 2026-08: 빈 응답·조회 실패를 조용히 삼키지 않습니다 — 카드 48장이 '로딩…' 으로
    //   영구 고정되는 것을 막고, 상태 배너 + 다시 시도 링크로 사실을 그대로 안내합니다.
    var loaded=false,note=document.getElementById('live-note');
    function setNote(html){if(!note)return;if(html){note.innerHTML=html;note.style.display='block'}else{note.innerHTML='';note.style.display='none'}}
    if(note){note.addEventListener('click',function(e){var t=e.target;if(t&&t.id==='live-retry'){e.preventDefault();load()}})}
    function markPending(){var els=document.querySelectorAll('#coin-grid .c-score'),i;for(i=0;i<els.length;i++)els[i].textContent='집계 대기'}
    function render(list){
      var i,longN=0,shortN=0,sum=0;
      for(i=0;i<list.length;i++){if(list[i].side==='LONG')longN++;else shortN++;sum+=list[i].score||0}
      document.getElementById('st-total').textContent=list.length;
      document.getElementById('st-long').textContent=longN;
      document.getElementById('st-short').textContent=shortN;
      document.getElementById('st-avg').textContent=list.length?Math.round(sum/list.length):'—';
      // 강한 시그널 TOP 3
      var sorted=list.slice().sort(function(a,b){return (b.score||0)-(a.score||0)});
      var top=sorted.slice(0,3),pills='';
      for(i=0;i<top.length;i++){var t=top[i],nm=esc(String(t.asset||'').replace(/^1000/,'')),lg=t.side==='LONG';
        pills+='<span class="sig-pill"><span class="mono">'+nm+'</span> <b class="'+(lg?'green':'red')+'">'+(lg?'▲ 상승':'▼ 하락')+' '+Math.round(t.score)+'</b></span>'}
      var ts=document.getElementById('top-sigs');ts.innerHTML=pills;ts.style.display=pills?'flex':'none';
      // 그리드 전체를 라이브 유니버스로 재구성 (스코어 내림차순, 상세페이지 보유 시 링크)
      var html='';
      for(i=0;i<sorted.length;i++){var c=sorted[i],a=String(c.asset||''),nm2=esc(a.replace(/^1000/,'')),lg2=c.side==='LONG',dir=lg2?'up':'down';
        var page=PAGES[a]||PAGES[c.symbol]||null;
        var inner='<div class="c-sym">'+nm2+'</div>'
          +'<span class="c-side '+(lg2?'side-long':'side-short')+'">'+(lg2?'▲ 상승 우위':'▼ 하락 우위')+'</span>'
          +'<div class="c-score '+dir+'">'+Math.round(c.score)+'점</div>'
          +'<div class="c-bar"><i class="'+dir+'" style="width:'+Math.max(4,Math.min(100,Math.round(c.score)))+'%"></i></div>';
        html+='<div class="coin-card '+(lg2?'is-long':'is-short')+'">'+(page?'<a href="'+page+'">'+inner+'</a>':inner)+'</div>'}
      if(html)document.getElementById('coin-grid').innerHTML=html;
    }
    function load(){
      fetch('/api/real-trading/coin-scores?limit=60').then(function(r){return r.json()}).then(function(d){
        var list=(d&&d.coins)||[];
        if(list.length){loaded=true;setNote('');render(list);return}
        if(loaded){setNote('새 스코어를 불러오지 못해 마지막 집계값을 표시 중입니다. <a href="#" id="live-retry">다시 시도</a>');return}
        markPending();
        setNote('실시간 스코어가 아직 집계되지 않았습니다. 집계가 재개되면 자동으로 표시됩니다. <a href="#" id="live-retry">다시 시도</a>');
      }).catch(function(){
        if(loaded){setNote('새 스코어를 불러오지 못해 마지막 집계값을 표시 중입니다. <a href="#" id="live-retry">다시 시도</a>');return}
        markPending();
        setNote('실시간 스코어를 불러오지 못했습니다. 네트워크 상태를 확인한 뒤 다시 시도해 주세요. <a href="#" id="live-retry">다시 시도</a>');
      });
    }
    load();
    setInterval(load,5*60*1000); // 5분마다 자동 갱신
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
