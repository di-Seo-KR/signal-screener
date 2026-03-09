// Vercel Serverless — Yahoo Finance 프록시 (cookie + crumb 인증)
// /api/yahoo?symbol=AAPL&interval=1wk&range=2y
// 반환: { closes, volumes, highs, lows, timestamps }

let _cookie = null;
let _crumb = null;
let _expires = 0;

async function getAuth() {
  const now = Date.now();
  if (_cookie && _crumb && now < _expires) return { cookie: _cookie, crumb: _crumb };

  const initRes = await fetch("https://fc.yahoo.com", {
    redirect: "follow",
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
  });
  const cookies = initRes.headers.get("set-cookie") || "";

  const crumbRes = await fetch("https://query2.finance.yahoo.com/v1/test/getcrumb", {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Cookie": cookies,
    },
  });
  if (!crumbRes.ok) throw new Error(`Crumb fetch failed: ${crumbRes.status}`);
  const crumb = await crumbRes.text();

  _cookie = cookies;
  _crumb = crumb;
  _expires = now + 10 * 60 * 1000;
  return { cookie: _cookie, crumb: _crumb };
}

async function fetchYahoo(symbol, interval, range) {
  const { cookie, crumb } = await getAuth();
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}&crumb=${encodeURIComponent(crumb)}&includePrePost=false`;
  const headers = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/json",
    "Cookie": cookie,
  };

  let r = await fetch(url, { headers });

  // 401/403 → 재인증 후 재시도
  if (r.status === 401 || r.status === 403) {
    _cookie = null; _crumb = null; _expires = 0;
    const auth2 = await getAuth();
    const url2 = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}&crumb=${encodeURIComponent(auth2.crumb)}&includePrePost=false`;
    r = await fetch(url2, {
      headers: { ...headers, "Cookie": auth2.cookie },
    });
  }
  if (!r.ok) throw new Error(`Yahoo: ${r.status}`);
  return r.json();
}

function parseYahooResult(json) {
  const result = json?.chart?.result?.[0];
  if (!result) return null;

  const timestamps = result.timestamp || [];
  const q = result.indicators?.quote?.[0] || {};
  const { open = [], high = [], low = [], close = [], volume = [] } = q;

  // null 값 필터링하여 유효한 데이터만 반환
  const closes = [];
  const volumes = [];
  const highs = [];
  const lows = [];
  const opens = [];
  const validTimestamps = [];

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
    console.error(`Yahoo fetch error for ${symbol}:`, error.message);
    return res.status(500).json({ error: error.message, closes: [], volumes: [], highs: [], lows: [] });
  }
}
