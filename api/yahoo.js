// Vercel Serverless — Yahoo Finance 프록시 (robust cookie + crumb 인증)
// /api/yahoo?symbol=AAPL&interval=1wk&range=2y
// 반환: { closes, volumes, highs, lows, opens, timestamps }

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

let _cookie = null;
let _crumb = null;
let _expires = 0;

async function getAuth() {
  const now = Date.now();
  if (_cookie && _crumb && now < _expires) return { cookie: _cookie, crumb: _crumb };

  // Step 1: Get consent cookie from fc.yahoo.com (redirect: manual to capture Set-Cookie)
  let cookies = "";
  try {
    const r1 = await fetch("https://fc.yahoo.com", {
      redirect: "manual",
      headers: { "User-Agent": UA },
    });
    cookies = r1.headers.get("set-cookie") || "";
  } catch {}

  // Fallback: try finance.yahoo.com
  if (!cookies) {
    try {
      const r2 = await fetch("https://finance.yahoo.com/", {
        redirect: "manual",
        headers: { "User-Agent": UA },
      });
      cookies = r2.headers.get("set-cookie") || "";
    } catch {}
  }

  // Step 2: Get crumb
  const crumbRes = await fetch("https://query2.finance.yahoo.com/v1/test/getcrumb", {
    headers: { "User-Agent": UA, "Cookie": cookies },
  });

  if (!crumbRes.ok) {
    // Try alternative: query1 instead of query2
    const crumbRes2 = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
      headers: { "User-Agent": UA, "Cookie": cookies },
    });
    if (!crumbRes2.ok) throw new Error(`Crumb failed: ${crumbRes.status}/${crumbRes2.status}`);
    const crumb = await crumbRes2.text();
    _cookie = cookies; _crumb = crumb; _expires = now + 8 * 60 * 1000;
    return { cookie: _cookie, crumb: _crumb };
  }

  const crumb = await crumbRes.text();
  _cookie = cookies; _crumb = crumb; _expires = now + 8 * 60 * 1000;
  return { cookie: _cookie, crumb: _crumb };
}

async function fetchYahoo(symbol, interval, range) {
  const { cookie, crumb } = await getAuth();

  // Try query2 first, then query1 as fallback
  for (const host of ["query2.finance.yahoo.com", "query1.finance.yahoo.com"]) {
    const url = `https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}&crumb=${encodeURIComponent(crumb)}&includePrePost=false`;
    try {
      let r = await fetch(url, {
        headers: { "User-Agent": UA, "Accept": "application/json", "Cookie": cookie },
      });

      if (r.status === 401 || r.status === 403) {
        // Invalidate and retry auth
        _cookie = null; _crumb = null; _expires = 0;
        const auth2 = await getAuth();
        const url2 = `https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}&crumb=${encodeURIComponent(auth2.crumb)}&includePrePost=false`;
        r = await fetch(url2, {
          headers: { "User-Agent": UA, "Accept": "application/json", "Cookie": auth2.cookie },
        });
      }
      if (r.ok) return r.json();
    } catch {}
  }
  throw new Error(`Yahoo fetch failed for ${symbol}`);
}

function parseYahooResult(json) {
  const result = json?.chart?.result?.[0];
  if (!result) return null;

  const timestamps = result.timestamp || [];
  const q = result.indicators?.quote?.[0] || {};
  const { open = [], high = [], low = [], close = [], volume = [] } = q;

  const closes = [], volumes = [], highs = [], lows = [], opens = [], validTimestamps = [];
  for (let i = 0; i < timestamps.length; i++) {
    if (close[i] == null) continue;
    closes.push(close[i]);
    volumes.push(volume[i] || 0);
    highs.push(high[i] || close[i]);
    lows.push(low[i] || close[i]);
    opens.push(open[i] || close[i]);
    validTimestamps.push(timestamps[i]);
  }

  return { closes, volumes, highs, lows, opens, timestamps: validTimestamps };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { symbol, interval = "1wk", range = "2y" } = req.query;
  if (!symbol) return res.status(400).json({ error: "symbol required" });

  try {
    const json = await fetchYahoo(symbol, interval, range);
    const parsed = parseYahooResult(json);
    if (!parsed || !parsed.closes.length) {
      return res.status(404).json({ error: "No data", closes: [], volumes: [], highs: [], lows: [] });
    }
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json(parsed);
  } catch (error) {
    console.error(`Yahoo error [${symbol}]:`, error.message);
    return res.status(500).json({ error: error.message, closes: [], volumes: [], highs: [], lows: [] });
  }
}
