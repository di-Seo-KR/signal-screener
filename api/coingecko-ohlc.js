// Vercel Serverless — CoinGecko OHLC (캔들차트용)
// /api/coingecko-ohlc?id=bitcoin&days=90
// 1차: /ohlc 엔드포인트, 2차: /market_chart → 캔들 변환 (폴백)

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { id, days = "90" } = req.query;
  if (!id) return res.status(400).json({ error: "id required", candles: [] });

  const UA = "SignalScreener/3.0";
  let candles = [];

  // 1차: OHLC 엔드포인트 시도
  try {
    const ohlcUrl = `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(id)}/ohlc?vs_currency=usd&days=${days}`;
    const r = await fetch(ohlcUrl, {
      headers: { "Accept": "application/json", "User-Agent": UA },
      signal: AbortSignal.timeout(8000),
    });
    if (r.ok) {
      const raw = await r.json();
      if (Array.isArray(raw) && raw.length > 0) {
        candles = raw
          .filter(d => Array.isArray(d) && d.length >= 5 && d[1] != null)
          .map(([ts, o, h, l, c]) => ({
            time: Math.floor(ts / 1000),
            open: o, high: h, low: l, close: c,
          }));
      }
    }
  } catch {}

  // 2차: 폴백 — market_chart → 캔들 변환
  if (!candles.length) {
    try {
      const mcUrl = `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(id)}/market_chart?vs_currency=usd&days=${days}`;
      const r = await fetch(mcUrl, {
        headers: { "Accept": "application/json", "User-Agent": UA },
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) {
        return res.status(r.status).json({ error: `CoinGecko ${r.status}`, candles: [] });
      }
      const mc = await r.json();
      const prices = mc.prices || [];
      if (prices.length > 0) {
        const daysNum = days === "max" ? 9999 : parseInt(days) || 90;
        let groupMs;
        if (daysNum <= 2) groupMs = 30 * 60 * 1000;
        else if (daysNum <= 14) groupMs = 4 * 3600 * 1000;
        else if (daysNum <= 90) groupMs = 24 * 3600 * 1000;
        else groupMs = 7 * 24 * 3600 * 1000;

        const buckets = new Map();
        for (const [ts, price] of prices) {
          if (price == null) continue;
          const key = Math.floor(ts / groupMs) * groupMs;
          if (!buckets.has(key)) {
            buckets.set(key, { time: Math.floor(key / 1000), open: price, high: price, low: price, close: price });
          } else {
            const b = buckets.get(key);
            b.high = Math.max(b.high, price);
            b.low = Math.min(b.low, price);
            b.close = price;
          }
        }
        candles = Array.from(buckets.values()).sort((a, b) => a.time - b.time);
      }
    } catch (e) {
      return res.status(500).json({ error: e.message, candles: [] });
    }
  }

  res.setHeader("Cache-Control", "s-maxage=120, stale-while-revalidate=300");
  return res.status(200).json({ id, days, candles });
}
