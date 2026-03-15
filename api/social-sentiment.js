// Vercel Serverless — 소셜 미디어 센티먼트 분석
// /api/social-sentiment
// 주식·시장에 대한 소셜 센티먼트 수집 (Reddit, StockTwits 등)

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();

  const symbol = (req.query.symbol || "SPY").toUpperCase();
  const result = { symbol, sentiment: null, trending: [], sources: [] };

  // ── 1) StockTwits 센티먼트 (공개 API) ──
  try {
    const stRes = await fetch(`https://api.stocktwits.com/api/2/streams/symbol/${symbol}.json`, {
      headers: { "User-Agent": "SignalScreener/5.0" },
      signal: AbortSignal.timeout(8000),
    });
    if (stRes.ok) {
      const data = await stRes.json();
      const msgs = data?.messages || [];
      let bullish = 0, bearish = 0, total = 0;
      const recentPosts = [];

      for (const m of msgs.slice(0, 30)) {
        total++;
        if (m.entities?.sentiment?.basic === "Bullish") bullish++;
        else if (m.entities?.sentiment?.basic === "Bearish") bearish++;
        recentPosts.push({
          body: (m.body || "").slice(0, 200),
          sentiment: m.entities?.sentiment?.basic || "neutral",
          time: m.created_at,
          user: m.user?.username || "unknown",
          likes: m.likes?.total || 0,
        });
      }

      if (total > 0) {
        const bullPct = Math.round((bullish / total) * 100);
        const bearPct = Math.round((bearish / total) * 100);
        const neutralPct = 100 - bullPct - bearPct;
        result.sources.push({
          name: "StockTwits",
          bullish: bullPct,
          bearish: bearPct,
          neutral: neutralPct,
          total,
          posts: recentPosts.slice(0, 10),
        });
      }

      // 트렌딩 심볼
      if (data?.symbol?.watchlist_count) {
        result.watchers = data.symbol.watchlist_count;
      }
    }
  } catch {}

  // ── 2) StockTwits 트렌딩 심볼 ──
  try {
    const trendRes = await fetch("https://api.stocktwits.com/api/2/trending/symbols.json", {
      headers: { "User-Agent": "SignalScreener/5.0" },
      signal: AbortSignal.timeout(5000),
    });
    if (trendRes.ok) {
      const data = await trendRes.json();
      result.trending = (data?.symbols || []).slice(0, 15).map(s => ({
        symbol: s.symbol,
        title: s.title,
        watchers: s.watchlist_count,
      }));
    }
  } catch {}

  // ── 3) Reddit /r/wallstreetbets 핫 포스트 (공개 JSON API) ──
  try {
    const redditRes = await fetch("https://www.reddit.com/r/wallstreetbets/hot.json?limit=25", {
      headers: { "User-Agent": "SignalScreener/5.0 (by /u/signalscreener)" },
      signal: AbortSignal.timeout(8000),
    });
    if (redditRes.ok) {
      const data = await redditRes.json();
      const posts = data?.data?.children || [];
      const relevant = [];
      let bullWords = 0, bearWords = 0, totalWords = 0;

      const bullishKeywords = ["moon", "buy", "calls", "bullish", "rocket", "gains", "pump", "long", "yolo", "diamond", "tendies", "squeeze", "rally"];
      const bearishKeywords = ["puts", "short", "bearish", "crash", "dump", "sell", "fear", "recession", "drop", "tank", "loss", "bag"];

      for (const p of posts) {
        const d = p.data;
        const text = ((d.title || "") + " " + (d.selftext || "")).toLowerCase();
        totalWords++;

        let postBull = 0, postBear = 0;
        for (const w of bullishKeywords) { if (text.includes(w)) postBull++; }
        for (const w of bearishKeywords) { if (text.includes(w)) postBear++; }

        if (postBull > postBear) bullWords++;
        else if (postBear > postBull) bearWords++;

        // 심볼 매칭
        const mentionsSymbol = text.includes(symbol.toLowerCase()) || text.includes(`$${symbol.toLowerCase()}`);

        relevant.push({
          title: (d.title || "").slice(0, 150),
          score: d.score || 0,
          comments: d.num_comments || 0,
          sentiment: postBull > postBear ? "bullish" : postBear > postBull ? "bearish" : "neutral",
          mentionsSymbol,
          time: d.created_utc,
          url: `https://reddit.com${d.permalink}`,
        });
      }

      if (totalWords > 0) {
        result.sources.push({
          name: "Reddit (WSB)",
          bullish: Math.round((bullWords / totalWords) * 100),
          bearish: Math.round((bearWords / totalWords) * 100),
          neutral: Math.round(((totalWords - bullWords - bearWords) / totalWords) * 100),
          total: totalWords,
          posts: relevant.filter(r => r.mentionsSymbol || r.score > 100).slice(0, 8),
          allPosts: relevant.slice(0, 8),
        });
      }
    }
  } catch {}

  // ── 4) 종합 센티먼트 계산 ──
  if (result.sources.length > 0) {
    let totalBull = 0, totalBear = 0, totalNeutral = 0, sourceCount = 0;
    for (const src of result.sources) {
      totalBull += src.bullish;
      totalBear += src.bearish;
      totalNeutral += src.neutral;
      sourceCount++;
    }
    if (sourceCount > 0) {
      const avgBull = Math.round(totalBull / sourceCount);
      const avgBear = Math.round(totalBear / sourceCount);
      const avgNeutral = 100 - avgBull - avgBear;
      const score = Math.round(50 + (avgBull - avgBear) / 2);
      const label = score >= 70 ? "매우 긍정적" : score >= 55 ? "긍정적" : score >= 45 ? "중립" : score >= 30 ? "부정적" : "매우 부정적";

      result.sentiment = {
        score: Math.max(0, Math.min(100, score)),
        label,
        bullish: avgBull,
        bearish: avgBear,
        neutral: avgNeutral,
      };
    }
  }

  res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
  return res.status(200).json(result);
}
