// Vercel Serverless — CoinGecko OHLC (캔들차트용)
// /api/coingecko-ohlc?id=bitcoin&days=90
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { id, days = "90" } = req.query;
  if (!id) return res.status(400).json({ error: "id required" });

  // CoinGecko /ohlc endpoint: returns [timestamp, open, high, low, close]
  // Granularity: 1-2 days → 30min candles, 3-30 days → 4h, 31-90 days → 4h, 91-365 days → 1d
  const url = `https://api.coingecko.com/api/v3/coins/${id}/ohlc?vs_currency=usd&days=${days}`;

  try {
    const response = await fetch(url, {
      headers: {
        "Accept": "application/json",
        "User-Agent": "SignalScreener/3.0",
      },
    });

    if (response.status === 429) {
      return res.status(429).json({ error: "CoinGecko rate limit. Try again in 60s." });
    }
    if (!response.ok) {
      return res.status(response.status).json({ error: `CoinGecko error: ${response.status}` });
    }

    const raw = await response.json(); // [[ts, o, h, l, c], ...]
    const candles = raw.map(([ts, open, high, low, close]) => ({
      time: Math.floor(ts / 1000), // ms → seconds
      open: +open.toFixed(8),
      high: +high.toFixed(8),
      low: +low.toFixed(8),
      close: +close.toFixed(8),
    }));

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ id, days, candles });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
