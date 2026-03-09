// Vercel Serverless — 금융 뉴스 피드 (Yahoo Finance RSS + Google News)
// /api/news?lang=ko

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { lang = "ko" } = req.query;

  try {
    const news = [];

    // Source 1: Yahoo Finance RSS (Top Stories)
    try {
      const yahooUrl = "https://finance.yahoo.com/news/rssindex";
      const yahooRes = await fetch(yahooUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" },
      });
      if (yahooRes.ok) {
        const xml = await yahooRes.text();
        const items = xml.match(/<item>([\s\S]*?)<\/item>/g) || [];
        items.slice(0, 10).forEach(item => {
          const title = (item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) || item.match(/<title>(.*?)<\/title>/) || [])[1];
          const link = (item.match(/<link>(.*?)<\/link>/) || [])[1];
          const pubDate = (item.match(/<pubDate>(.*?)<\/pubDate>/) || [])[1];
          const desc = (item.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/) || item.match(/<description>(.*?)<\/description>/) || [])[1];
          if (title && link) {
            news.push({ title: title.trim(), url: link.trim(), date: pubDate || "", desc: (desc || "").replace(/<[^>]*>/g, "").slice(0, 150), source: "Yahoo Finance" });
          }
        });
      }
    } catch {}

    // Source 2: Google News RSS (한국 금융)
    try {
      const topic = lang === "ko" ? "주식+투자+경제" : "stock+market+finance";
      const googleUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(topic)}&hl=${lang === "ko" ? "ko" : "en"}&gl=${lang === "ko" ? "KR" : "US"}&ceid=${lang === "ko" ? "KR:ko" : "US:en"}`;
      const googleRes = await fetch(googleUrl, {
        headers: { "User-Agent": "Mozilla/5.0" },
      });
      if (googleRes.ok) {
        const xml = await googleRes.text();
        const items = xml.match(/<item>([\s\S]*?)<\/item>/g) || [];
        items.slice(0, 10).forEach(item => {
          const title = (item.match(/<title>(.*?)<\/title>/) || [])[1];
          const link = (item.match(/<link\/>(.*?)<pubDate>/) || item.match(/<link>(.*?)<\/link>/) || [])[1];
          const pubDate = (item.match(/<pubDate>(.*?)<\/pubDate>/) || [])[1];
          const source = (item.match(/<source[^>]*>(.*?)<\/source>/) || [])[1];
          if (title) {
            news.push({ title: title.trim(), url: (link || "").trim(), date: pubDate || "", desc: "", source: source || "Google News" });
          }
        });
      }
    } catch {}

    // Source 3: CoinGecko trending (크립토)
    try {
      const cgRes = await fetch("https://api.coingecko.com/api/v3/search/trending", {
        headers: { "User-Agent": "SignalScreener/3.0" },
      });
      if (cgRes.ok) {
        const trending = await cgRes.json();
        (trending.coins || []).slice(0, 5).forEach(c => {
          const coin = c.item;
          news.push({
            title: `🔥 트렌딩: ${coin.name} (${coin.symbol}) — 시장 순위 #${coin.market_cap_rank || "?"}`,
            url: `https://www.coingecko.com/en/coins/${coin.id}`,
            date: new Date().toISOString(),
            desc: `24h 가격: $${coin.data?.price?.toFixed(4) || "?"} | 시총 순위 ${coin.market_cap_rank || "?"}위`,
            source: "CoinGecko Trending",
          });
        });
      }
    } catch {}

    // 날짜순 정렬 (최신 먼저)
    news.sort((a, b) => {
      try { return new Date(b.date) - new Date(a.date); } catch { return 0; }
    });

    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    return res.status(200).json({ news: news.slice(0, 20) });
  } catch (err) {
    return res.status(500).json({ error: err.message, news: [] });
  }
}
