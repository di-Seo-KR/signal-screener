// Vercel Serverless — 핵심 금융 뉴스 피드
// /api/news?lang=ko
// 핵심 시장 뉴스만 필터링하여 반환

// 핵심 키워드 필터 (이 키워드가 포함된 뉴스만 통과)
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

function isRelevant(title, desc, lang) {
  const text = `${title} ${desc}`.toLowerCase();
  const keywords = lang === "ko" ? MARKET_KEYWORDS_KO : MARKET_KEYWORDS_EN;
  return keywords.some(kw => text.includes(kw.toLowerCase()));
}

// 핵심 키워드 추출
function extractKeywords(title, lang) {
  const keywords = lang === "ko" ? MARKET_KEYWORDS_KO : MARKET_KEYWORDS_EN;
  const titleLower = title.toLowerCase();
  return keywords
    .filter(kw => titleLower.includes(kw.toLowerCase()))
    .slice(0, 3);
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { lang = "ko" } = req.query;

  try {
    const news = [];

    // Source 1: Yahoo Finance RSS
    try {
      const yahooRes = await fetch("https://finance.yahoo.com/news/rssindex", {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
      });
      if (yahooRes.ok) {
        const xml = await yahooRes.text();
        const items = xml.match(/<item>([\s\S]*?)<\/item>/g) || [];
        items.slice(0, 15).forEach(item => {
          const title = (item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) || item.match(/<title>(.*?)<\/title>/) || [])[1];
          const link = (item.match(/<link>(.*?)<\/link>/) || [])[1];
          const pubDate = (item.match(/<pubDate>(.*?)<\/pubDate>/) || [])[1];
          const desc = (item.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/) || item.match(/<description>(.*?)<\/description>/) || [])[1];
          if (title && link) {
            const cleanDesc = (desc || "").replace(/<[^>]*>/g, "").slice(0, 120);
            if (isRelevant(title, cleanDesc, "en")) {
              const tags = extractKeywords(title, "en");
              news.push({ title: title.trim(), url: link.trim(), date: pubDate || "", desc: cleanDesc, source: "Yahoo Finance", tags });
            }
          }
        });
      }
    } catch {}

    // Source 2: Google News RSS — 핵심 금융 키워드
    try {
      const queries = lang === "ko"
        ? ["증시+금리+경제", "코스피+나스닥+반도체", "비트코인+가상화폐"]
        : ["stock+market+Fed", "NVIDIA+Apple+earnings", "Bitcoin+crypto"];

      for (const q of queries) {
        try {
          const googleUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=${lang === "ko" ? "ko" : "en"}&gl=${lang === "ko" ? "KR" : "US"}&ceid=${lang === "ko" ? "KR:ko" : "US:en"}`;
          const googleRes = await fetch(googleUrl, { headers: { "User-Agent": "Mozilla/5.0" } });
          if (googleRes.ok) {
            const xml = await googleRes.text();
            const items = xml.match(/<item>([\s\S]*?)<\/item>/g) || [];
            items.slice(0, 8).forEach(item => {
              const title = (item.match(/<title>(.*?)<\/title>/) || [])[1];
              const link = (item.match(/<link\/>(.*?)<pubDate>/) || item.match(/<link>(.*?)<\/link>/) || [])[1];
              const pubDate = (item.match(/<pubDate>(.*?)<\/pubDate>/) || [])[1];
              const source = (item.match(/<source[^>]*>(.*?)<\/source>/) || [])[1];
              if (title && isRelevant(title, "", lang)) {
                const tags = extractKeywords(title, lang);
                news.push({ title: title.trim(), url: (link || "").trim(), date: pubDate || "", desc: "", source: source || "Google News", tags });
              }
            });
          }
        } catch {}
      }
    } catch {}

    // Source 3: X(Twitter) / Nitter RSS — 주요 금융 인플루언서
    try {
      const xAccounts = [
        { handle: "zaborowski", name: "X Finance" },
        { handle: "DeItaone", name: "Walter Bloomberg" },
        { handle: "unusual_whales", name: "Unusual Whales" },
      ];
      // Use multiple Nitter instances for resilience
      const nitterHosts = ["nitter.privacydev.net", "nitter.poast.org", "nitter.cz"];
      for (const { handle, name } of xAccounts) {
        let fetched = false;
        for (const host of nitterHosts) {
          if (fetched) break;
          try {
            const xUrl = `https://${host}/${handle}/rss`;
            const xRes = await fetch(xUrl, {
              headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
              signal: AbortSignal.timeout(5000),
            });
            if (xRes.ok) {
              const xml = await xRes.text();
              const items = xml.match(/<item>([\s\S]*?)<\/item>/g) || [];
              items.slice(0, 5).forEach(item => {
                const title = (item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) || item.match(/<title>(.*?)<\/title>/) || [])[1];
                const link = (item.match(/<link>(.*?)<\/link>/) || [])[1];
                const pubDate = (item.match(/<pubDate>(.*?)<\/pubDate>/) || item.match(/<dc:date>(.*?)<\/dc:date>/) || [])[1];
                if (title && isRelevant(title, "", lang === "ko" ? "en" : lang)) {
                  const tags = ["X", ...extractKeywords(title, "en")];
                  const cleanTitle = title.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").slice(0, 200);
                  news.push({ title: cleanTitle, url: (link || `https://x.com/${handle}`).replace(host, "x.com"), date: pubDate || new Date().toISOString(), desc: "", source: `X @${handle}`, tags });
                }
              });
              fetched = true;
            }
          } catch {}
        }
      }
    } catch {}

    // Source 4: CoinGecko trending top 3만
    try {
      const cgRes = await fetch("https://api.coingecko.com/api/v3/search/trending", {
        headers: { "User-Agent": "SignalScreener/4.0" },
      });
      if (cgRes.ok) {
        const trending = await cgRes.json();
        (trending.coins || []).slice(0, 3).forEach(c => {
          const coin = c.item;
          news.push({
            title: `${coin.name} (${coin.symbol}) 트렌딩 — #${coin.market_cap_rank || "?"}`,
            url: `https://www.coingecko.com/en/coins/${coin.id}`,
            date: new Date().toISOString(),
            desc: `24h 가격: $${coin.data?.price?.toFixed(4) || "?"}`,
            source: "CoinGecko",
            tags: ["크립토", coin.symbol],
          });
        });
      }
    } catch {}

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

    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    return res.status(200).json({ news: unique.slice(0, 25) });
  } catch (err) {
    return res.status(500).json({ error: err.message, news: [] });
  }
}
