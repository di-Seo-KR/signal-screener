// Vercel Serverless — 핵심 금융 뉴스 피드
// /api/news?lang=ko&category=crypto|kr-stock|us-stock|macro
//
// ★ 2026-08 뉴스 소싱 전면 개편 (대표 지시 — "지금 마켓 뉴스가 그냥 답이 없다")
//   1순위: 네이버 검색 오픈 API 로 수집해 둔 KV 풀(di:news:pool)을 배급합니다.
//          수집은 크론(api/agents/news-collect.js, 20분 주기)이 담당하므로
//          이 엔드포인트는 KV 조회 한 번으로 끝나 매우 빠릅니다.
//          풀이 30분 넘게 갱신되지 않았으면 축소 세트로 lazy 수집을 1회 시도합니다.
//   2순위: 기존 RSS 로직(Yahoo / Google News) — 네이버 키 미설정이거나
//          수집이 실패했을 때의 폴백으로 그대로 남겨 둡니다.
//   응답의 source 필드로 어느 경로를 탔는지 구분합니다("naver" | "rss").
//
//   ※ CoinGecko 트렌딩은 삭제했습니다. "Ondo 트렌딩 #41" 같은 랭킹 알림이
//     뉴스로 노출되던 대표 불만의 직접 원인이라, 별도 필드로도 넣지 않습니다.
//
// ★ 2026-06-12 성능 개편 (콜드 5.04s → ~1s) — 폴백 경로에 그대로 유효합니다:
//   1) Nitter(X) 소스 삭제 — 2024년 X 게스트 폐지 후 공개 인스턴스 전멸(403/DNS 실패).
//   2) 소스 간 의존성이 없으므로 Yahoo / Google(3쿼리) 전부 병렬(Promise.allSettled).
//   3) 모든 fetch 에 AbortSignal.timeout(2500) — worst-case 를 2.5s 로 캡.
//   4) SWR 600→86400: 캐시 만료 후에도 만료본 즉시 반환 + 백그라운드 재검증.

import {
  NEWS_CATEGORIES,
  isNewsCategoryId,
  hasNaverCredentials,
  collectNaverNews,
  readNewsPool,
  writeNewsPool,
  capAndSortArticles,
  acquireCollectLock,
  releaseCollectLock,
} from "./_shared/news-sources.js";

// 풀이 이 시간보다 오래 갱신되지 않았으면 요청 경로에서 1회 lazy 수집을 시도합니다.
const POOL_STALE_MS = 30 * 60 * 1000; // 30분

const MARKET_KEYWORDS_KO = [
  "코스피", "코스닥", "나스닥", "S&P", "다우", "증시", "주가",
  "금리", "Fed", "연준", "기준금리", "인플레이션", "CPI",
  "반도체", "AI", "엔비디아", "삼성전자", "SK하이닉스", "테슬라", "애플",
  "환율", "달러", "원화", "유가", "금값",
  "ETF", "IPO", "실적", "어닝", "매출", "영업이익",
  "비트코인", "이더리움", "크립토", "가상화폐",
  "트럼프", "관세", "무역", "제재", "긴축", "완화",
  "상장", "배당", "자사주", "공매도", "매수", "매도",
  "GDP", "고용", "실업", "PMI", "소비자", "경기",
  "폭락", "급등", "랠리", "조정", "신고가", "신저가",
];
const MARKET_KEYWORDS_EN = [
  "stock", "market", "S&P", "Nasdaq", "Dow", "Fed", "rate",
  "inflation", "CPI", "GDP", "earnings", "revenue",
  "NVIDIA", "Apple", "Tesla", "Microsoft", "Amazon", "Meta",
  "semiconductor", "AI", "chip",
  "Bitcoin", "Ethereum", "crypto",
  "oil", "gold", "dollar", "currency",
  "tariff", "trade", "sanction",
  "IPO", "ETF", "dividend", "buyback",
  "rally", "crash", "correction", "record", "surge", "plunge",
  "employment", "jobs", "housing", "recession",
];

// ── HTML 엔티티 디코딩 (RSS 폴백 경로 전용) ──────────────────────
// RSS 원문의 "S&amp;P500" 류가 화면에 그대로 노출되는 문제를 막습니다.
// 반드시 파싱 직후·관련도 판정 이전에 적용해야 합니다 — 키워드에 "S&P" 가
// 들어 있어 미디코딩 상태로는 isRelevant()/extractKeywords() 매칭도 함께
// 실패하기 때문입니다. 외부 의존성 없이 주요 명명 엔티티와 숫자 엔티티
// (10진·16진)만 처리하며, 이중 이스케이프(&amp;amp;)는 한 단계씩 풀립니다.
const NAMED_ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
function decodeEntities(s) {
  if (!s) return s;
  return String(s)
    .replace(/&#x([0-9a-f]+);/gi, (m, hex) => {
      const cp = parseInt(hex, 16);
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
    })
    .replace(/&#(\d+);/g, (m, dec) => {
      const cp = parseInt(dec, 10);
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
    })
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/gi, (m, name) => NAMED_ENTITIES[name.toLowerCase()]);
}

function isRelevant(title, desc, lang) {
  const text = `${title} ${desc}`.toLowerCase();
  const keywords = lang === "ko" ? MARKET_KEYWORDS_KO : MARKET_KEYWORDS_EN;
  return keywords.some(kw => text.includes(kw.toLowerCase()));
}

function extractKeywords(title, lang) {
  const keywords = lang === "ko" ? MARKET_KEYWORDS_KO : MARKET_KEYWORDS_EN;
  const titleLower = title.toLowerCase();
  return keywords
    .filter(kw => titleLower.includes(kw.toLowerCase()))
    .slice(0, 3);
}

const FETCH_TIMEOUT_MS = 2500; // 병렬화 후엔 per-source 타임아웃이 곧 전체 상한

// ── 폴백 Source 1: Yahoo Finance RSS ──────────────────────────────
async function fetchYahoo() {
  const out = [];
  const yahooRes = await fetch("https://finance.yahoo.com/news/rssindex", {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!yahooRes.ok) return out;
  const xml = await yahooRes.text();
  const items = xml.match(/<item>([\s\S]*?)<\/item>/g) || [];
  items.slice(0, 15).forEach(item => {
    // ★ 제목·요약은 파싱 직후 엔티티 디코딩 — 아래 isRelevant() 의 "S&P" 매칭이 원문
    //   "S&amp;P" 상태로는 실패하고, 화면에도 이스케이프 잔재가 그대로 노출되기 때문입니다.
    const title = decodeEntities((item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) || item.match(/<title>(.*?)<\/title>/) || [])[1]);
    const link = (item.match(/<link>(.*?)<\/link>/) || [])[1];
    const pubDate = (item.match(/<pubDate>(.*?)<\/pubDate>/) || [])[1];
    // rssindex 피드는 현재 <description> 을 내려주지 않습니다(2026-08 실측 — item 에
    // title/link/pubDate/source/guid/media 만 존재). 태그가 오는 경우에만 파싱되며,
    // 없으면 desc 는 빈 값으로 정직하게 남습니다(요약을 지어내지 않습니다).
    const desc = (item.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/) || item.match(/<description>(.*?)<\/description>/) || [])[1];
    if (title && link) {
      const cleanDesc = decodeEntities((desc || "").replace(/<[^>]*>/g, "")).slice(0, 120);
      if (isRelevant(title, cleanDesc, "en")) {
        const tags = extractKeywords(title, "en");
        out.push({ title: title.trim(), url: link.trim(), date: pubDate || "", desc: cleanDesc, source: "Yahoo Finance", tags, category: "" });
      }
    }
  });
  return out;
}

// ── 폴백 Source 2: Google News RSS — 쿼리 1개 ─────────────────────
async function fetchGoogleQuery(q, lang) {
  const out = [];
  const googleUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=${lang === "ko" ? "ko" : "en"}&gl=${lang === "ko" ? "KR" : "US"}&ceid=${lang === "ko" ? "KR:ko" : "US:en"}`;
  const googleRes = await fetch(googleUrl, {
    headers: { "User-Agent": "Mozilla/5.0" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!googleRes.ok) return out;
  const xml = await googleRes.text();
  const items = xml.match(/<item>([\s\S]*?)<\/item>/g) || [];
  items.slice(0, 8).forEach(item => {
    // ★ 제목·매체명은 파싱 직후 엔티티 디코딩 — "S&amp;P500" 노출 방지 + isRelevant() 의
    //   "S&P" 키워드 매칭 정상화 (디코딩 전에 판정하면 해당 기사가 통째로 누락됩니다).
    const title = decodeEntities((item.match(/<title>(.*?)<\/title>/) || [])[1]);
    const link = (item.match(/<link\/>(.*?)<pubDate>/) || item.match(/<link>(.*?)<\/link>/) || [])[1];
    const pubDate = (item.match(/<pubDate>(.*?)<\/pubDate>/) || [])[1];
    const source = decodeEntities((item.match(/<source[^>]*>(.*?)<\/source>/) || [])[1]);
    if (title && isRelevant(title, "", lang)) {
      const tags = extractKeywords(title, lang);
      // desc 는 빈 값 유지 — Google News RSS 의 <description> 은 제목을 <a> 로 감싼
      // 중복 문자열 + 매체명뿐이라 실제 요약이 없습니다(2026-08 실측). 제목을 요약처럼
      // 복제해 넣는 것은 가짜 데이터라 하지 않으며, 요약은 네이버 풀 경로가 제공합니다.
      out.push({ title: title.trim(), url: (link || "").trim(), date: pubDate || "", desc: "", source: source || "Google News", tags, category: "" });
    }
  });
  return out;
}

/** 폴백(RSS) 경로 — 기존 로직 그대로 유지합니다. */
async function fetchRssNews(lang) {
  const queries = lang === "ko"
    ? ["증시+금리+경제", "코스피+나스닥+반도체", "비트코인+가상화폐"]
    : ["stock+market+Fed", "NVIDIA+Apple+earnings", "Bitcoin+crypto"];

  // ★ 전 소스 병렬 — 직렬 합산(~3s+) → 최장 단일 소스(~1s)
  const results = await Promise.allSettled([
    fetchYahoo(),
    ...queries.map((q) => fetchGoogleQuery(q, lang)),
  ]);
  // 병합 순서 고정: Yahoo → Google(쿼리순) (기존 dedup 우선순위 보존)
  const news = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));

  // 중복 제거 (같은 제목)
  const seen = new Set();
  const unique = news.filter(n => {
    const key = n.title.slice(0, 40).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // 날짜순 정렬
  unique.sort((a, b) => {
    try { return new Date(b.date) - new Date(a.date); } catch { return 0; }
  });

  return unique.slice(0, 25);
}

// ── 네이버 풀 배급 ────────────────────────────────────────────────

/** 카테고리 필터 — 기사 하나가 여러 축에 걸릴 수 있어 categories 도 함께 봅니다. */
function filterByCategory(pool, category) {
  if (!category) return pool;
  return pool.filter((a) =>
    a?.category === category || (Array.isArray(a?.categories) && a.categories.includes(category)),
  );
}

/**
 * 풀이 오래됐을 때 요청 경로에서 시도하는 축소 수집.
 * 카테고리당 상위 3개 키워드 · display 20 으로 12회 호출만 해서 응답 지연을 억제합니다.
 * 락을 못 잡으면(크론 수집 중) 시도하지 않고 기존 풀을 그대로 씁니다.
 */
async function lazyCollect(now) {
  const locked = await acquireCollectLock(60);
  if (!locked) return null;
  try {
    const result = await collectNaverNews({
      keywordsPerCategory: 3,
      display: 20,
      batchSize: 6,
      batchDelayMs: 150,
      timeoutMs: 3000,
      now,
    });
    if (!result.ok || result.articles.length === 0) return null;
    await writeNewsPool(result.articles, { now });
    return result.articles;
  } catch {
    return null;
  } finally {
    await releaseCollectLock();
  }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { lang = "ko", category = "" } = req.query || {};
  const wantNaver = String(lang).toLowerCase() !== "en"; // 네이버는 한국어 전용
  const cat = isNewsCategoryId(String(category)) ? String(category) : "";

  try {
    // ── 1순위: 네이버 풀 ──
    if (wantNaver && hasNaverCredentials()) {
      const now = Date.now();
      const { pool, updatedAt } = await readNewsPool();
      const updatedTs = updatedAt ? new Date(updatedAt).getTime() : 0;
      const isFresh = Number.isFinite(updatedTs) && now - updatedTs <= POOL_STALE_MS;

      let items = capAndSortArticles(pool, { now });
      let stamp = updatedAt;

      if (!isFresh) {
        const fresh = await lazyCollect(now);
        if (fresh) {
          const reread = await readNewsPool();
          items = capAndSortArticles(reread.pool.length ? reread.pool : fresh, { now });
          stamp = reread.updatedAt || new Date(now).toISOString();
        }
      }

      if (items.length > 0) {
        const filtered = filterByCategory(items, cat);
        // ★ SWR — 만료 후에도 만료본 즉시 반환 + 백그라운드 재검증
        res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=86400");
        return res.status(200).json({
          ok: true,
          source: "naver",
          category: cat || "all",
          updatedAt: stamp,
          total: filtered.length,
          categories: NEWS_CATEGORIES.map((c) => ({ id: c.id, label: c.label })),
          news: filtered.slice(0, 60),
        });
      }
      // 풀이 비었으면 아래 RSS 폴백으로 내려갑니다.
    }

    // ── 2순위 폴백: 기존 RSS ──
    const news = await fetchRssNews(String(lang) === "en" ? "en" : "ko");
    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=86400");
    return res.status(200).json({
      ok: true,
      source: "rss",
      category: "all",
      updatedAt: new Date().toISOString(),
      total: news.length,
      news,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, source: "none", error: err.message, news: [] });
  }
}
