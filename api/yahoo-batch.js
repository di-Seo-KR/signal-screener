// Vercel Serverless — Yahoo Finance 배치 프록시
// /api/yahoo-batch?symbols=AAPL,MSFT,NVDA&interval=1wk&range=2y
// 한 번에 최대 15개 심볼 병렬 fetch → { results: { AAPL: {...}, MSFT: {...}, ... } }

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

function parseResult(json) {
  const result = json?.chart?.result?.[0];
  if (!result) return null;
  const timestamps = result.timestamp || [];
  const q = result.indicators?.quote?.[0] || {};
  const { open = [], high = [], low = [], close = [], volume = [] } = q;
  const closes = [], volumes = [], highs = [], lows = [], opens = [], validTs = [];
  for (let i = 0; i < timestamps.length; i++) {
    if (close[i] == null) continue;
    closes.push(close[i]);
    volumes.push(volume[i] || 0);
    highs.push(high[i] || close[i]);
    lows.push(low[i] || close[i]);
    opens.push(open[i] || close[i]);
    validTs.push(timestamps[i]);
  }
  return { closes, volumes, highs, lows, opens, timestamps: validTs };
}

async function fetchOne(symbol, interval, range, auth) {
  for (const host of ["query2.finance.yahoo.com", "query1.finance.yahoo.com"]) {
    const url = `https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}&crumb=${encodeURIComponent(auth.crumb)}&includePrePost=false`;
    try {
      const r = await fetch(url, {
        headers: { "User-Agent": UA, "Accept": "application/json", "Cookie": auth.cookie },
        signal: AbortSignal.timeout(10000),
      });
      if (r.ok) {
        const json = await r.json();
        return parseResult(json);
      }
    } catch {}
  }
  return null;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { symbols, interval = "1wk", range = "2y" } = req.query;
  if (!symbols) return res.status(400).json({ error: "symbols required" });

  const symList = symbols.split(",").map(s => s.trim()).filter(Boolean).slice(0, 30);
  if (!symList.length) return res.status(400).json({ error: "empty symbols" });

  try {
    const auth = await getAuth();
    const results = {};

    // 병렬로 모든 심볼 fetch
    const promises = symList.map(async (sym) => {
      try {
        const data = await fetchOne(sym, interval, range, auth);
        if (data && data.closes.length) results[sym] = data;
        else results[sym] = { error: "No data", closes: [], volumes: [], highs: [], lows: [] };
      } catch (e) {
        results[sym] = { error: e.message, closes: [], volumes: [], highs: [], lows: [] };
      }
    });

    await Promise.all(promises);

    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=120");
    return res.status(200).json({ results });
  } catch (error) {
    return res.status(500).json({ error: error.message, results: {} });
  }
}
