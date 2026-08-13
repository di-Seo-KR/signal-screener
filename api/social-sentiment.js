// Vercel Serverless — 소셜 미디어 센티먼트 분석
// /api/social-sentiment
//
// 수집 시도 소스: StockTwits(공개 API), Reddit /r/wallstreetbets(공개 JSON)
//
// ★ 2026-08-13 (감사 #3): 화면 문구는 "StockTwits · Reddit(WSB) 기반" 이라고
//   고정돼 있었지만, 실제 응답에 Reddit 항목이 없는 경우가 많았습니다
//   (Reddit 이 데이터센터 IP 를 403 으로 차단 — 서버리스에서 자주 실패).
//   → 이제 실제로 수집된 소스만 sourceNames/attribution 으로 내려보내고,
//     소스별 성공·실패 사유를 sourceStatus 로 노출합니다(무성 실패 방지).
//     화면 문구도 특정 소스를 단정하지 않도록 정정했습니다.
//
// ★ 2026-08-13 (감사 #7): 게시글 본문·제목에 HTML 엔티티(&gt;&gt;, &#39;)가
//   그대로 노출되던 문제 — 서버측에서 디코딩합니다(키워드 매칭 정확도도 함께
//   올라갑니다). 규칙은 api/_shared/html-entities.js 한 곳에만 둡니다 —
//   같은 15줄을 news.js·briefing.js 에 복사해 두면 한쪽만 고쳤을 때 다른
//   화면에서 같은 결함이 재발합니다(감사 #7 이 정확히 그 유형이었습니다).

import { decodeEntities } from "./_shared/html-entities.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();

  const symbol = (req.query.symbol || "SPY").toUpperCase();
  const result = { symbol, sentiment: null, trending: [], sources: [] };

  // 소스별 실측 상태 — ok:true 인 소스만 표기에 사용합니다(가짜 출처 표기 금지).
  const sourceStatus = [
    { id: "stocktwits", name: "StockTwits",  ok: false, items: 0, reason: null },
    { id: "reddit_wsb", name: "Reddit (WSB)", ok: false, items: 0, reason: null },
  ];
  const st = sourceStatus[0];
  const rd = sourceStatus[1];

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
          body: decodeEntities(m.body || "").slice(0, 200), // 감사 #7 — &gt;&gt;·&#39; 노출 차단
          sentiment: m.entities?.sentiment?.basic || "neutral",
          time: m.created_at,
          user: decodeEntities(m.user?.username || "") || "unknown",
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
        st.ok = true;
        st.items = total;
      } else {
        st.reason = "게시글 0건";
      }

      // 트렌딩 심볼
      if (data?.symbol?.watchlist_count) {
        result.watchers = data.symbol.watchlist_count;
      }
    } else {
      st.reason = `HTTP ${stRes.status}`;
    }
  } catch (e) {
    st.reason = e?.name === "TimeoutError" ? "타임아웃" : (e?.message || String(e)).slice(0, 80);
  }

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
        title: decodeEntities(s.title || ""),
        watchers: s.watchlist_count,
      }));
    }
  } catch {}

  // ── 3) Reddit /r/wallstreetbets 핫 포스트 (공개 JSON API) ──
  //   ※ Reddit 은 데이터센터 IP 를 403 으로 자주 막습니다. 실패하면 아래 sourceStatus
  //     에 사유가 남고, 표기(attribution)에서도 자동으로 빠집니다.
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
        // 감사 #7 — Reddit JSON 은 제목·본문을 HTML 이스케이프해 내려줍니다.
        //   디코딩 후 매칭해야 키워드 판정도 정확해집니다.
        const title = decodeEntities(d.title || "");
        const selftext = decodeEntities(d.selftext || "");
        const text = `${title} ${selftext}`.toLowerCase();

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
          title: title.slice(0, 150),
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
        rd.ok = true;
        rd.items = symTotal;
      } else {
        rd.reason = `${symbol} 언급 포스트 ${symTotal}건 (2건 미만이라 종합에서 제외)`;
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
    } else {
      rd.reason = redditRes.status === 403
        ? "HTTP 403 — Reddit 이 서버 IP 를 차단"
        : `HTTP ${redditRes.status}`;
    }
  } catch (e) {
    rd.reason = e?.name === "TimeoutError" ? "타임아웃" : (e?.message || String(e)).slice(0, 80);
  }

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

  // ── 5) 출처 표기 — 실제로 수집된 소스만 (감사 #3: 가짜 출처 표기 금지) ──
  //   UI 는 sourceNames/attribution 을 그대로 쓰면 되고, 실패 사유는 sourceStatus 로 확인합니다.
  //   ★ 수집 소스가 하나도 없으면 attribution 은 빈 문자열이 아니라 null 입니다.
  //     빈 문자열이면 소비자가 `${attribution} 기반` 으로 치환했을 때 " 기반" 이라는
  //     깨진 문구가 화면에 뜹니다 — '값 없음'을 null 로 명시해 UI 가 출처 줄 자체를
  //     생략하고 기존 '데이터 없음' 문구로 떨어지게 합니다.
  result.sourceNames = result.sources.map(s => s.name);
  result.attribution = result.sourceNames.length > 0 ? result.sourceNames.join(" · ") : null;
  result.sourceStatus = sourceStatus;
  result.updatedAt = new Date().toISOString();

  // 무성 실패 방지 — 아무 소스도 못 받으면 로그를 남깁니다.
  if (result.sources.length === 0) {
    console.warn(`[social-sentiment] ${symbol} 수집 0건 — ` +
      sourceStatus.map(s => `${s.id}:${s.reason || "사유 미상"}`).join(" / "));
  }

  res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
  return res.status(200).json(result);
}
