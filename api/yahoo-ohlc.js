// Vercel Serverless — Yahoo Finance OHLC 캔들차트 + 백테스트용 (robust auth)
// /api/yahoo-ohlc?symbol=AAPL&interval=1d&range=6mo

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

let _cookie = null;
let _crumb = null;
let _expires = 0;

async function getAuth() {
  const now = Date.now();
  if (_cookie && _crumb && now < _expires) return { cookie: _cookie, crumb: _crumb };

  let cookies = "";
  try {
    const r1 = await fetch("https://fc.yahoo.com", {
      redirect: "manual",
      headers: { "User-Agent": UA },
    });
    cookies = r1.headers.get("set-cookie") || "";
  } catch {}

  if (!cookies) {
    try {
      const r2 = await fetch("https://finance.yahoo.com/", {
        redirect: "manual",
        headers: { "User-Agent": UA },
      });
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

async function fetchWithAuth(symbol, interval, range, includePrePost = false) {
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
  throw new Error(`Yahoo OHLC fetch failed for ${symbol}`);
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { symbol, interval = "1d", range = "6mo", prepost } = req.query;
  if (!symbol) return res.status(400).json({ error: "symbol required" });
  const includePrePost = prepost === "true" || prepost === "1";

  try {
    const json = await fetchWithAuth(symbol, interval, range, includePrePost);
    const result = json?.chart?.result?.[0];
    if (!result) return res.status(404).json({ error: "No data", candles: [] });

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

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ symbol, interval, range, candles });
  } catch (err) {
    console.error(`Yahoo OHLC error [${symbol}]:`, err.message);
    return res.status(500).json({ error: err.message, candles: [] });
  }
}
