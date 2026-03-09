// Vercel Serverless — Yahoo Finance OHLC 캔들차트용 (cookie + crumb 인증)
// /api/yahoo-ohlc?symbol=AAPL&interval=1d&range=6mo

let _cookie = null;
let _crumb = null;
let _expires = 0;

async function getAuth() {
  const now = Date.now();
  if (_cookie && _crumb && now < _expires) return { cookie: _cookie, crumb: _crumb };

  const initRes = await fetch("https://fc.yahoo.com", {
    redirect: "follow",
    headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" },
  });
  const cookies = initRes.headers.get("set-cookie") || "";

  const crumbRes = await fetch("https://query2.finance.yahoo.com/v1/test/getcrumb", {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Cookie": cookies,
    },
  });
  if (!crumbRes.ok) throw new Error(`Crumb failed: ${crumbRes.status}`);
  const crumb = await crumbRes.text();
  _cookie = cookies; _crumb = crumb; _expires = now + 10 * 60 * 1000;
  return { cookie: _cookie, crumb: _crumb };
}

async function fetchWithAuth(symbol, interval, range) {
  const { cookie, crumb } = await getAuth();
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}&crumb=${encodeURIComponent(crumb)}&includePrePost=false`;
  const r = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "application/json",
      "Cookie": cookie,
    },
  });

  if (r.status === 401 || r.status === 403) {
    _cookie = null; _crumb = null; _expires = 0;
    const auth2 = await getAuth();
    const url2 = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}&crumb=${encodeURIComponent(auth2.crumb)}&includePrePost=false`;
    const r2 = await fetch(url2, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json",
        "Cookie": auth2.cookie,
      },
    });
    if (!r2.ok) throw new Error(`Yahoo retry: ${r2.status}`);
    return r2.json();
  }
  if (!r.ok) throw new Error(`Yahoo: ${r.status}`);
  return r.json();
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { symbol, interval = "1d", range = "6mo" } = req.query;
  if (!symbol) return res.status(400).json({ error: "symbol required" });

  try {
    const json = await fetchWithAuth(symbol, interval, range);
    const result = json?.chart?.result?.[0];
    if (!result) return res.status(404).json({ error: "No data" });

    const timestamps = result.timestamp || [];
    const q = result.indicators?.quote?.[0] || {};
    const { open = [], high = [], low = [], close = [], volume = [] } = q;

    const candles = [];
    for (let i = 0; i < timestamps.length; i++) {
      if (open[i] == null || high[i] == null || low[i] == null || close[i] == null) continue;
      candles.push({
        time: timestamps[i],
        open: +open[i].toFixed(4),
        high: +high[i].toFixed(4),
        low: +low[i].toFixed(4),
        close: +close[i].toFixed(4),
        volume: volume[i] || 0,
      });
    }

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ symbol, interval, range, candles });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
