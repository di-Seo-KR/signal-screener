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
      // ★ 2026-06-12 (전수 감사): 종목 언급 포스트(symBull/symBear)와 시장 전체(mktBull/mktBear)를
      //   분리 집계. 종합 점수엔 '종목 언급분'만 반영하고, 시장 전체 WSB 분위기는 별도 카드로.
      let symBull = 0, symBear = 0, symTotal = 0;
      let mktBull = 0, mktBear = 0, mktTotal = 0;

      const bullishKeywords = ["moon", "buy", "calls", "bullish", "rocket", "gains", "pump", "long", "yolo", "diamond", "tendies", "squeeze", "rally"];
      const bearishKeywords = ["puts", "short", "bearish", "crash", "dump", "sell", "fear", "recession", "drop", "tank", "loss", "bag"];

      for (const p of posts) {
        const d = p.data;
        const text = ((d.title || "") + " " + (d.selftext || "")).toLowerCase();

        let postBull = 0, postBear = 0;
        for (const w of bullishKeywords) { if (text.includes(w)) postBull++; }
        for (const w of bearishKeywords) { if (text.includes(w)) postBear++; }
        const dir = postBull > postBear ? 1 : postBear > postBull ? -1 : 0;

        // 시장 전체
        mktTotal++;
        if (dir > 0) mktBull++; else if (dir < 0) mktBear++;

        // 심볼 매칭 — 종목 점수엔 이 포스트만 반영
        const mentionsSymbol = text.includes(symbol.toLowerCase()) || text.includes(`$${symbol.toLowerCase()}`);
        if (mentionsSymbol) {
          symTotal++;
          if (dir > 0) symBull++; else if (dir < 0) symBear++;
        }

        relevant.push({
          title: (d.title || "").slice(0, 150),
          score: d.score || 0,
          comments: d.num_comments || 0,
          sentiment: dir > 0 ? "bullish" : dir < 0 ? "bearish" : "neutral",
          mentionsSymbol,
          time: d.created_utc,
          url: `https://reddit.com${d.permalink}`,
        });
      }

      // 종목 언급이 2건 이상일 때만 Reddit 을 종목 소스로 반영(표본 부족 시 종합 오염 방지)
      if (symTotal >= 2) {
        result.sources.push({
          name: "Reddit (WSB)",
          bullish: Math.round((symBull / symTotal) * 100),
          bearish: Math.round((symBear / symTotal) * 100),
          neutral: Math.round(((symTotal - symBull - symBear) / symTotal) * 100),
          total: symTotal,
          posts: relevant.filter(r => r.mentionsSymbol).slice(0, 8),
          allPosts: relevant.filter(r => r.mentionsSymbol).slice(0, 8),
        });
      }

      // 시장 전체 WSB 분위기 — 종합 점수와 무관한 별도 카드용
      if (mktTotal > 0) {
        result.marketMood = {
          name: "WSB 시장 전체",
          bullish: Math.round((mktBull / mktTotal) * 100),
          bearish: Math.round((mktBear / mktTotal) * 100),
          total: mktTotal,
          topPosts: relevant.filter(r => r.score > 100).slice(0, 5),
        };
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
