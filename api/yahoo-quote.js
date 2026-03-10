// Vercel Serverless — Yahoo Finance Quote 프록시 (프리/포스트마켓 포함)
// /api/yahoo-quote?symbols=AAPL,MSFT,NVDA
// 실시간 시세 + preMarketPrice, postMarketPrice 반환

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

let _cookie = null;
let _crumb = null;
let _expires = 0;

async function getAuth() {
  const now = Date.now();
  if (_cookie && _crumb && now < _expires) return { cookie: _cookie, crumb: _crumb };

  let cookies = "";
  try {
    const r1 = await fetch("https://fc.yahoo.com", { redirect: "manual", headers: { "User-Agent": UA } });
    cookies = r1.headers.get("set-cookie") || "";
  } catch {}
  if (!cookies) {
    try {
      const r2 = await fetch("https://finance.yahoo.com/", { redirect: "manual", headers: { "User-Agent": UA } });
      cookies = r2.headers.get("set-cookie") || "";
    } catch {}
  }

  for (const host of ["query2.finance.yahoo.com", "query1.finance.yahoo.com"]) {
    try {
      const crumbRes = await fetch(`https://${host}/v1/test/getcrumb`, {
        headers: { "User-Agent": UA, "Cookie": cookies },
      });
      if (crumbRes.ok) {
        const crumb = await crumbRes.text();
        _cookie = cookies; _crumb = crumb; _expires = now + 8 * 60 * 1000;
        return { cookie: _cookie, crumb: _crumb };
      }
    } catch {}
  }
  throw new Error("Auth failed");
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { symbols } = req.query;
  if (!symbols) return res.status(400).json({ error: "symbols required" });

  const symList = symbols.split(",").map(s => s.trim()).filter(Boolean).slice(0, 50);
  if (!symList.length) return res.status(400).json({ error: "empty symbols" });

  try {
    const auth = await getAuth();
    const symStr = symList.join(",");

    // v7/finance/quote returns real-time quote with pre/post market data
    let quotes = {};
    for (const host of ["query2.finance.yahoo.com", "query1.finance.yahoo.com"]) {
      try {
        const url = `https://${host}/v7/finance/quote?symbols=${encodeURIComponent(symStr)}&crumb=${encodeURIComponent(auth.crumb)}&fields=regularMarketPrice,regularMarketChange,regularMarketChangePercent,preMarketPrice,preMarketChange,preMarketChangePercent,postMarketPrice,postMarketChange,postMarketChangePercent,marketState,targetMeanPrice,targetHighPrice,targetLowPrice,targetMedianPrice,numberOfAnalystOpinions,recommendationKey,recommendationMean,trailingPE,forwardPE,priceToBook,trailingEps,forwardEps,bookValue,fiftyDayAverage,twoHundredDayAverage,fiftyTwoWeekHigh,fiftyTwoWeekLow,marketCap,dividendYield,beta,earningsTimestamp,earningsTimestampStart,earningsTimestampEnd`;
        const r = await fetch(url, {
          headers: { "User-Agent": UA, "Accept": "application/json", "Cookie": auth.cookie },
          signal: AbortSignal.timeout(8000),
        });
        if (r.ok) {
          const json = await r.json();
          const results = json?.quoteResponse?.result || [];
          for (const q of results) {
            quotes[q.symbol] = {
              price: q.regularMarketPrice,
              change: q.regularMarketChange,
              changePct: q.regularMarketChangePercent,
              marketState: q.marketState, // PRE, REGULAR, POST, CLOSED
              preMarketPrice: q.preMarketPrice || null,
              preMarketChange: q.preMarketChange || null,
              preMarketChangePct: q.preMarketChangePercent || null,
              postMarketPrice: q.postMarketPrice || null,
              postMarketChange: q.postMarketChange || null,
              postMarketChangePct: q.postMarketChangePercent || null,
              // 애널리스트 목표가
              targetMean: q.targetMeanPrice || null,
              targetHigh: q.targetHighPrice || null,
              targetLow: q.targetLowPrice || null,
              targetMedian: q.targetMedianPrice || null,
              analystCount: q.numberOfAnalystOpinions || 0,
              recommendation: q.recommendationKey || null, // buy, hold, sell, etc.
              recommendationScore: q.recommendationMean || null, // 1=strongBuy ~ 5=strongSell
              // 밸류에이션
              trailingPE: q.trailingPE || null,
              forwardPE: q.forwardPE || null,
              priceToBook: q.priceToBook || null,
              trailingEps: q.trailingEps || null,
              forwardEps: q.forwardEps || null,
              bookValue: q.bookValue || null,
              // 기타
              fiftyDayAvg: q.fiftyDayAverage || null,
              twoHundredDayAvg: q.twoHundredDayAverage || null,
              fiftyTwoWeekHigh: q.fiftyTwoWeekHigh || null,
              fiftyTwoWeekLow: q.fiftyTwoWeekLow || null,
              marketCap: q.marketCap || null,
              dividendYield: q.dividendYield || null,
              beta: q.beta || null,
              earningsDate: q.earningsTimestamp || q.earningsTimestampStart || null,
            };
          }
          break;
        }
      } catch {}
    }

    res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=60");
    return res.status(200).json({ quotes });
  } catch (error) {
    return res.status(500).json({ error: error.message, quotes: {} });
  }
}
