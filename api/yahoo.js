// Vercel Serverless — Yahoo Finance 통합 프록시 v3
// 4개 엔드포인트를 1개로 통합 (Hobby 플랜 Serverless 12개 제한 대응)
//
// 모드 자동 감지 (vercel.json rewrite로 _mode 전달):
//   /api/yahoo?symbol=AAPL&interval=1wk&range=2y          → 단일 심볼 (기본)
//   /api/yahoo-ohlc?symbol=AAPL&interval=1d&range=6mo     → OHLC 캔들 (_mode=ohlc)
//   /api/yahoo-batch?symbols=AAPL,MSFT&interval=1d&range=1y → 배치 (_mode=batch)
//   /api/yahoo-quote?symbols=AAPL,MSFT                     → 실시간 시세 (_mode=quote)

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
  throw new Error("Yahoo auth failed");
}

// ── 단일 심볼 차트 데이터 fetch ──
async function fetchChart(symbol, interval, range, includePrePost = false) {
  const { cookie, crumb } = await getAuth();
  const prePost = includePrePost ? "true" : "false";

  for (const host of ["query2.finance.yahoo.com", "query1.finance.yahoo.com"]) {
    const url = `https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}&crumb=${encodeURIComponent(crumb)}&includePrePost=${prePost}`;
    try {
      let r = await fetch(url, {
        headers: { "User-Agent": UA, "Accept": "application/json", "Cookie": cookie },
      });
      if (r.status === 401 || r.status === 403) {
        _cookie = null; _crumb = null; _expires = 0;
        const auth2 = await getAuth();
        const url2 = `https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}&crumb=${encodeURIComponent(auth2.crumb)}&includePrePost=${prePost}`;
        r = await fetch(url2, {
          headers: { "User-Agent": UA, "Accept": "application/json", "Cookie": auth2.cookie },
        });
      }
      if (r.ok) return r.json();
    } catch {}
  }
  throw new Error(`Yahoo fetch failed for ${symbol}`);
}

// ── 배치 모드: 단일 심볼 빠른 fetch (5초 타임아웃) ──
async function fetchOne(symbol, interval, range, auth) {
  for (const host of ["query2.finance.yahoo.com", "query1.finance.yahoo.com"]) {
    const url = `https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}&crumb=${encodeURIComponent(auth.crumb)}&includePrePost=false`;
    try {
      const r = await fetch(url, {
        headers: { "User-Agent": UA, "Accept": "application/json", "Cookie": auth.cookie },
        signal: AbortSignal.timeout(5000),
      });
      if (r.ok) return r.json();
    } catch {}
  }
  return null;
}

// ── 파싱: closes/volumes 배열 ──
function parseArrays(json) {
  const result = json?.chart?.result?.[0];
  if (!result) return null;
  const timestamps = result.timestamp || [];
  const q = result.indicators?.quote?.[0] || {};
  const { open = [], high = [], low = [], close = [], volume = [] } = q;
  const closes = [], volumes = [], highs = [], lows = [], opens = [], validTs = [];
  for (let i = 0; i < timestamps.length; i++) {
    if (close[i] == null) continue;
    closes.push(close[i]); volumes.push(volume[i] || 0);
    highs.push(high[i] || close[i]); lows.push(low[i] || close[i]);
    opens.push(open[i] || close[i]); validTs.push(timestamps[i]);
  }
  return { closes, volumes, highs, lows, opens, timestamps: validTs };
}

// ── 파싱: OHLC 캔들 ──
function parseCandles(json) {
  const result = json?.chart?.result?.[0];
  if (!result) return null;
  const timestamps = result.timestamp || [];
  const q = result.indicators?.quote?.[0] || {};
  const { open = [], high = [], low = [], close = [], volume = [] } = q;
  const candles = [];
  for (let i = 0; i < timestamps.length; i++) {
    if (open[i] == null || close[i] == null) continue;
    candles.push({
      time: timestamps[i],
      open: +open[i].toFixed(4),
      high: +(high[i] || Math.max(open[i], close[i])).toFixed(4),
      low: +(low[i] || Math.min(open[i], close[i])).toFixed(4),
      close: +close[i].toFixed(4),
      volume: volume[i] || 0,
    });
  }
  return candles;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { _mode, symbol, symbols, interval, range, prepost } = req.query;

  try {
    // ═══════ MODE: quote ═══════
    if (_mode === "quote") {
      if (!symbols) return res.status(400).json({ error: "symbols required" });
      const symList = symbols.split(",").map(s => s.trim()).filter(Boolean).slice(0, 50);
      const auth = await getAuth();
      const symStr = symList.join(",");
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
            for (const q of (json?.quoteResponse?.result || [])) {
              quotes[q.symbol] = {
                price: q.regularMarketPrice, change: q.regularMarketChange,
                changePct: q.regularMarketChangePercent, marketState: q.marketState,
                preMarketPrice: q.preMarketPrice || null, preMarketChange: q.preMarketChange || null,
                preMarketChangePct: q.preMarketChangePercent || null,
                postMarketPrice: q.postMarketPrice || null, postMarketChange: q.postMarketChange || null,
                postMarketChangePct: q.postMarketChangePercent || null,
                targetMean: q.targetMeanPrice || null, targetHigh: q.targetHighPrice || null,
                targetLow: q.targetLowPrice || null, targetMedian: q.targetMedianPrice || null,
                analystCount: q.numberOfAnalystOpinions || 0, recommendation: q.recommendationKey || null,
                recommendationScore: q.recommendationMean || null,
                trailingPE: q.trailingPE || null, forwardPE: q.forwardPE || null,
                priceToBook: q.priceToBook || null, trailingEps: q.trailingEps || null,
                forwardEps: q.forwardEps || null, bookValue: q.bookValue || null,
                fiftyDayAvg: q.fiftyDayAverage || null, twoHundredDayAvg: q.twoHundredDayAverage || null,
                fiftyTwoWeekHigh: q.fiftyTwoWeekHigh || null, fiftyTwoWeekLow: q.fiftyTwoWeekLow || null,
                marketCap: q.marketCap || null, dividendYield: q.dividendYield || null,
                beta: q.beta || null, earningsDate: q.earningsTimestamp || q.earningsTimestampStart || null,
              };
            }
            break;
          }
        } catch {}
      }
      res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=60");
      return res.status(200).json({ quotes });
    }

    // ═══════ MODE: batch ═══════
    if (_mode === "batch") {
      if (!symbols) return res.status(400).json({ error: "symbols required" });
      const symList = symbols.split(",").map(s => s.trim()).filter(Boolean).slice(0, 20);
      const auth = await getAuth();
      const results = {};
      await Promise.allSettled(symList.map(async (sym) => {
        try {
          const json = await fetchOne(sym, interval || "1d", range || "1y", auth);
          const data = json ? parseArrays(json) : null;
          results[sym] = (data && data.closes.length) ? data : { error: "No data", closes: [], volumes: [], highs: [], lows: [] };
        } catch (e) {
          results[sym] = { error: e.message, closes: [], volumes: [], highs: [], lows: [] };
        }
      }));
      res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=120");
      return res.status(200).json({ results });
    }

    // ═══════ MODE: ohlc ═══════
    if (_mode === "ohlc") {
      if (!symbol) return res.status(400).json({ error: "symbol required" });
      const includePrePost = prepost === "true" || prepost === "1";
      const json = await fetchChart(symbol, interval || "1d", range || "6mo", includePrePost);
      const candles = parseCandles(json);
      if (!candles || !candles.length) return res.status(404).json({ error: "No data", candles: [] });
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).json({ symbol, interval: interval || "1d", range: range || "6mo", candles });
    }

    // ═══════ MODE: default (단일 심볼 배열) ═══════
    if (!symbol) return res.status(400).json({ error: "symbol required" });
    const includePrePost = prepost === "true" || prepost === "1";
    const json = await fetchChart(symbol, interval || "1wk", range || "2y", includePrePost);
    const parsed = parseArrays(json);
    if (!parsed || !parsed.closes.length) {
      return res.status(404).json({ error: "No data", closes: [], volumes: [], highs: [], lows: [] });
    }
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json(parsed);

  } catch (error) {
    console.error(`Yahoo error:`, error.message);
    return res.status(500).json({ error: error.message });
  }
}
