// Vercel Serverless — Yahoo Finance OHLC (캔들차트용)
// /api/yahoo-ohlc?symbol=AAPL&interval=1d&range=6mo
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { symbol, interval = "1d", range = "6mo" } = req.query;
  if (!symbol) return res.status(400).json({ error: "symbol required" });

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}&includePrePost=false`;

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
        "Referer": "https://finance.yahoo.com",
        "Origin": "https://finance.yahoo.com",
        "Cache-Control": "no-cache",
      },
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: `Yahoo error: ${response.status}` });
    }

    const json = await response.json();
    const result = json?.chart?.result?.[0];
    if (!result) return res.status(404).json({ error: "No data" });

    const timestamps = result.timestamp || [];
    const q = result.indicators?.quote?.[0] || {};
    const { open = [], high = [], low = [], close = [], volume = [] } = q;

    // Build OHLCV array, skip null candles
    const candles = [];
    for (let i = 0; i < timestamps.length; i++) {
      if (open[i] == null || high[i] == null || low[i] == null || close[i] == null) continue;
      candles.push({
        time: timestamps[i],       // Unix seconds
        open: +open[i].toFixed(4),
        high: +high[i].toFixed(4),
        low: +low[i].toFixed(4),
        close: +close[i].toFixed(4),
        volume: volume[i] || 0,
      });
    }

    // No-store: always fresh
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ symbol, interval, range, candles });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
