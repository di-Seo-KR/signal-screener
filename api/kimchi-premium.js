// ════════════════════════════════════════════════════════════════════
// GET /api/kimchi-premium — 김치프리미엄 실시간 (BTC·ETH)
// ────────────────────────────────────────────────────────────────────
// rewrites: /kimchi-premium → 이 핸들러 (완전 HTML 페이지).
// ?json=1 → { ok, btc:{upbitKrw, binanceUsdt, premiumPct}, eth:{...}, usdtKrw, updatedAt }
//
// 계산 (환산 기준을 페이지 본문에도 명시):
//   김프% = (업비트 KRW 가격 ÷ (바이낸스 USDT 가격 × 업비트 KRW-USDT 시세) − 1) × 100
//   · 업비트: https://api.upbit.com/v1/ticker?markets=KRW-BTC,KRW-ETH,KRW-USDT
//     (trade_price 필드 — 2026-07-30 포맷 실측. Vercel 에서 직접 fetch 가능)
//   · 바이낸스: BTCUSDT/ETHUSDT — 기존 binance-client 프록시 경유
//     (★ 직접 fetch 금지 — Vercel 리전 451 차단 이력)
//   · 환산 환율은 은행 고시 환율이 아니라 "업비트 KRW-USDT 시세"를 사용
//     (실제 코인 시장 자금 이동 경로와 일치 — 페이지에 명시)
//
// KV 캐시 60초 (di:kimp:cache). KV 불능 시 캐시 없이 라이브 계산.
// ════════════════════════════════════════════════════════════════════

import { getTickerPrice } from "./_shared/binance-client.js";
import { renderPage, escH, SITE, DISCLAIMER_LINE } from "./_shared/page-shell.js";

// KV 핸들 — env 미설정 환경에서도 죽지 않는 graceful 획득.
// ★ 주의: @vercel/kv 의 kv 는 env 미설정 시 *모든 프로퍼티 접근*에서 throw 하는
//   Proxy 라, async 함수가 프록시를 그대로 return 하면 프라미스 해소가 .then 을
//   건드리며 try/catch 밖에서 터짐(로컬 실측). → 접근 프로브 후 평범한 객체로 래핑.
async function getKv() {
  try {
    const { kv } = await import("@vercel/kv");
    const get = kv.get.bind(kv); // env 미설정이면 이 접근에서 throw → catch → null
    const set = kv.set.bind(kv);
    return { get, set };
  } catch { return null; }
}
export const config = { maxDuration: 30 };

const CACHE_KEY = "di:kimp:cache";
const CACHE_TTL_MS = 60 * 1000;
const URL_PATH = `${SITE}/kimchi-premium`;

// ── 업비트 현재가 (직접 fetch — trade_price 실측 확인) ──
async function fetchUpbit() {
  const resp = await fetch("https://api.upbit.com/v1/ticker?markets=KRW-BTC,KRW-ETH,KRW-USDT", {
    headers: { "User-Agent": "Zepta/1.0", "Accept": "application/json" },
    signal: AbortSignal.timeout(6000),
  });
  if (!resp.ok) throw new Error(`upbit ${resp.status}`);
  const arr = await resp.json();
  const out = {};
  for (const t of Array.isArray(arr) ? arr : []) {
    const p = parseFloat(t?.trade_price);
    if (t?.market && Number.isFinite(p)) out[t.market] = p;
  }
  if (!out["KRW-BTC"] || !out["KRW-ETH"] || !out["KRW-USDT"]) throw new Error("upbit incomplete");
  return out;
}

// ── 바이낸스 현재가 (프록시 경유 — binance-client) ──
async function fetchBinancePair() {
  const [btc, eth] = await Promise.all([
    getTickerPrice({ symbol: "BTCUSDT" }),
    getTickerPrice({ symbol: "ETHUSDT" }),
  ]);
  const b = parseFloat(btc?.price), e = parseFloat(eth?.price);
  if (!Number.isFinite(b) || !Number.isFinite(e)) throw new Error("binance price invalid");
  return { BTCUSDT: b, ETHUSDT: e };
}

/** 김프 계산 — 순수 함수 (단위 검증용 export) */
export function computePremium({ upbitKrw, binanceUsdt, usdtKrw }) {
  if (![upbitKrw, binanceUsdt, usdtKrw].every((v) => Number.isFinite(v) && v > 0)) return null;
  return Math.round((upbitKrw / (binanceUsdt * usdtKrw) - 1) * 100 * 100) / 100;
}

async function getKimpData(kv) {
  // 60초 KV 캐시
  if (kv) {
    try {
      const c = await kv.get(CACHE_KEY);
      if (c?.data?.ok && Date.now() - (c.ts || 0) < CACHE_TTL_MS) return { ...c.data, cached: true };
    } catch { /* 캐시 실패 → 라이브 */ }
  }
  const [upbitR, binR] = await Promise.allSettled([fetchUpbit(), fetchBinancePair()]);
  if (upbitR.status !== "fulfilled" || binR.status !== "fulfilled") {
    const errs = [];
    if (upbitR.status === "rejected") errs.push(`upbit: ${upbitR.reason?.message}`);
    if (binR.status === "rejected") errs.push(`binance: ${binR.reason?.message}`);
    return { ok: false, error: errs.join(" / ") || "fetch failed" };
  }
  const up = upbitR.value, bin = binR.value;
  const usdtKrw = up["KRW-USDT"];
  const data = {
    ok: true,
    btc: {
      upbitKrw: up["KRW-BTC"],
      binanceUsdt: bin.BTCUSDT,
      premiumPct: computePremium({ upbitKrw: up["KRW-BTC"], binanceUsdt: bin.BTCUSDT, usdtKrw }),
    },
    eth: {
      upbitKrw: up["KRW-ETH"],
      binanceUsdt: bin.ETHUSDT,
      premiumPct: computePremium({ upbitKrw: up["KRW-ETH"], binanceUsdt: bin.ETHUSDT, usdtKrw }),
    },
    usdtKrw,
    updatedAt: new Date().toISOString(),
  };
  if (kv) {
    try { await kv.set(CACHE_KEY, { data, ts: Date.now() }, { ex: 120 }); } catch { /* 무시 */ }
  }
  return data;
}

// ── HTML 페이지 ──
function renderKimpPage() {
  const title = "김치프리미엄 실시간 | 비트코인·이더리움 김프 | Zepta";
  const metaDesc = "비트코인(BTC)·이더리움(ETH) 김치프리미엄 실시간 조회. 업비트 원화 가격과 바이낸스 달러 가격의 차이를 60초마다 자동 갱신하며, 김프의 의미와 역사적 맥락도 함께 정리했습니다.";

  const faq = [
    {
      q: "김치프리미엄(김프)이란 무엇인가요?",
      a: "같은 코인이 한국 원화 거래소(업비트 등)에서 해외 거래소(바이낸스 등)보다 비싸게 거래될 때 그 가격 차이 비율을 김치프리미엄이라고 부릅니다. 국내 매수 수요가 강하거나 해외로의 자금 이동이 제한될 때 확대되는 경향이 관찰돼 왔고, 반대로 국내 가격이 더 낮으면 역프리미엄(역프)이라고 합니다.",
    },
    {
      q: "Zepta 김프는 어떻게 계산하나요?",
      a: "업비트 KRW 가격을 바이낸스 USDT 가격과 업비트 KRW-USDT 시세의 곱으로 나눠 계산합니다. 즉 김프% = (업비트 KRW ÷ (바이낸스 USDT × KRW-USDT 시세) − 1) × 100 입니다. 은행 고시 환율 대신 코인 시장의 실제 환산 경로인 KRW-USDT 시세를 쓰며, 수치는 60초마다 갱신됩니다.",
    },
  ];
  const faqLd = {
    "@context": "https://schema.org", "@type": "FAQPage",
    mainEntity: faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
  };
  const crumbLd = {
    "@context": "https://schema.org", "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "홈", item: SITE + "/" },
      { "@type": "ListItem", position: 2, name: "김치프리미엄", item: URL_PATH },
    ],
  };

  const faqHtml = faq.map((f) => `    <h3>${escH(f.q)}</h3>\n    <p>${escH(f.a)}</p>`).join("\n");

  const bodyHtml = `    <div class="breadcrumb"><a href="/">홈</a> › 김치프리미엄</div>
    <h1>김치프리미엄 실시간 — 비트코인·이더리움</h1>
    <div class="meta-row">업비트 × 바이낸스 가격 비교 · 60초마다 자동 갱신</div>

    <div class="dash-strip" id="kimp-strip">
      <div class="dash-stat"><div class="v" id="kp-btc">—</div><div class="l">BTC 김프</div></div>
      <div class="dash-stat"><div class="v" id="kp-eth">—</div><div class="l">ETH 김프</div></div>
      <div class="dash-stat"><div class="v" id="kp-usdt">—</div><div class="l">KRW-USDT 시세</div></div>
    </div>

    <table class="z-tbl">
      <thead><tr><th>코인</th><th>업비트 (KRW)</th><th>바이낸스 (USDT)</th><th>김프</th></tr></thead>
      <tbody>
        <tr><td><b>BTC</b></td><td id="t-btc-up">—</td><td id="t-btc-bin">—</td><td id="t-btc-p">—</td></tr>
        <tr><td><b>ETH</b></td><td id="t-eth-up">—</td><td id="t-eth-bin">—</td><td id="t-eth-p">—</td></tr>
      </tbody>
    </table>
    <p style="font-size:13px;color:#6E7585" id="kp-updated">시세를 불러오는 중입니다…</p>

    <div class="callout"><strong>환산 기준</strong> — 김프% = (업비트 KRW ÷ (바이낸스 USDT × KRW-USDT 시세) − 1) × 100. 환율은 은행 고시 환율이 아니라 <strong>업비트 KRW-USDT 시세</strong>를 사용합니다. 코인 시장에서 원화↔달러 자금이 실제로 오가는 경로(테더 환산)와 일치시키기 위한 기준입니다.</div>

    <h2>김치프리미엄이란?</h2>
    <p>김치프리미엄은 <strong>같은 코인의 한국 원화 시장 가격과 해외 달러 시장 가격의 차이</strong>를 백분율로 나타낸 값입니다. 값이 +면 한국에서 더 비싸게, −면(역프리미엄) 더 싸게 거래되고 있다는 뜻입니다. 두 시장은 즉시 차익거래로 이어지기 어려운 구조(자본 이동 규제, 송금 시간)라 가격 차이가 일정 기간 유지되는 특징이 있습니다.</p>

    <h2>역사적 맥락</h2>
    <p>2017~2018년 상승장에서는 김프가 한때 40~50%대까지 확대돼 해외에서도 'Kimchi premium'이라는 이름으로 널리 알려졌습니다. 2021년 상승장에서도 10~20%대 김프가 관찰됐습니다. 반대로 하락장이나 국내 수요가 위축된 구간에서는 0% 부근 또는 역프리미엄이 나타나기도 했습니다.</p>

    <h2>수치는 어떻게 해석되나요?</h2>
    <ul>
      <li><strong>김프 확대</strong> — 국내 매수 수요가 해외 대비 강한 상태가 관찰되는 구간입니다. 과거 급등장 후반부에 김프가 크게 확대된 사례들이 있습니다.</li>
      <li><strong>김프 축소·역프</strong> — 국내 수요가 상대적으로 약하거나 국내 매도 압력이 강한 상태입니다.</li>
      <li><strong>급변</strong> — 규제 발표, 거래소 이슈, 환율 급변 구간에서 김프가 짧은 시간에 크게 움직인 사례가 있습니다.</li>
    </ul>
    <p>김프는 시장 수급 상태를 보여주는 관찰 지표이며, 그 자체로 향후 가격 방향을 보장하지 않습니다.</p>

    <div class="disc">⚠️ ${escH(DISCLAIMER_LINE)} 김치프리미엄 수치는 거래소 시세 API 기준이며 실제 체결가·수수료·환전 비용과 다를 수 있습니다.</div>

    <h2>자주 묻는 질문</h2>
${faqHtml}

    <div class="related">
      <h3>더 살펴보기</h3>
      <a href="/briefing">오늘의 코인 시장 브리핑 — 매일 아침 자동 발행</a>
      <a href="/coin">코인 라이브 대시보드 — 유동성 상위 전 종목 스코어</a>
      <a href="/coin/btc">비트코인(BTC) 상세 분석·멀티 타임프레임 스코어</a>
    </div>`;

  const extraBody = `
  <script>
  (function(){
    function num(v,d){return (typeof v==='number'&&isFinite(v))?v.toLocaleString('ko-KR',{maximumFractionDigits:d==null?0:d}):'—'}
    function pct(v){if(typeof v!=='number'||!isFinite(v))return '—';var s=v>=0?'+':'';return s+v.toFixed(2)+'%'}
    function color(el,v){el.style.color=(typeof v==='number'&&isFinite(v))?(v>=0?'#FF7B91':'#10D884'):''}
    function apply(d){
      if(!d||!d.ok)return;
      var b=document.getElementById('kp-btc'),e=document.getElementById('kp-eth');
      b.textContent=pct(d.btc.premiumPct);color(b,d.btc.premiumPct);
      e.textContent=pct(d.eth.premiumPct);color(e,d.eth.premiumPct);
      document.getElementById('kp-usdt').textContent=num(d.usdtKrw)+'원';
      document.getElementById('t-btc-up').textContent=num(d.btc.upbitKrw)+'원';
      document.getElementById('t-btc-bin').textContent='$'+num(d.btc.binanceUsdt,2);
      var bp=document.getElementById('t-btc-p');bp.textContent=pct(d.btc.premiumPct);color(bp,d.btc.premiumPct);
      document.getElementById('t-eth-up').textContent=num(d.eth.upbitKrw)+'원';
      document.getElementById('t-eth-bin').textContent='$'+num(d.eth.binanceUsdt,2);
      var ep=document.getElementById('t-eth-p');ep.textContent=pct(d.eth.premiumPct);color(ep,d.eth.premiumPct);
      document.getElementById('kp-updated').textContent='마지막 갱신 '+new Date(d.updatedAt).toLocaleTimeString('ko-KR')+' · 60초마다 자동 갱신';
    }
    function load(){
      fetch('/api/kimchi-premium?json=1').then(function(r){return r.json()}).then(apply)
      .catch(function(){document.getElementById('kp-updated').textContent='시세를 불러오지 못했습니다. 잠시 후 자동으로 다시 시도합니다.'});
    }
    load();
    setInterval(load,60*1000);
  })();
  </script>`;

  return renderPage({
    title, metaDesc, canonical: URL_PATH, bodyHtml,
    jsonLd: [faqLd, crumbLd], extraBody, ogType: "website",
  });
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET" && req.method !== "HEAD") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  // ── JSON 모드 (?json=1) — 페이지 인라인 JS 가 60초마다 호출 ──
  if (req.query?.json === "1") {
    try {
      const kv = await getKv();
      const data = await getKimpData(kv);
      res.setHeader("Cache-Control", data.ok ? "public, s-maxage=30, stale-while-revalidate=120" : "no-store");
      return res.status(data.ok ? 200 : 502).json(data);
    } catch (err) {
      res.setHeader("Cache-Control", "no-store");
      return res.status(500).json({ ok: false, error: err?.message || String(err) });
    }
  }

  // ── HTML 모드 — 라이브 수치는 클라이언트에서 채우므로 페이지 자체는 항상 200 ──
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400");
  return res.status(200).send(renderKimpPage());
}
