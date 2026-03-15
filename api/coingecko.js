// Vercel Serverless — CoinGecko 통합 프록시
// 기본: /api/coingecko?id=bitcoin&days=365 (market_chart)
// OHLC: /api/coingecko?id=bitcoin&days=90&type=ohlc (캔들차트용)

const UA = "SignalScreener/3.0";

async function fetchMarketChart(id, days) {
  const url = `https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=${days}&interval=daily`;
  const r = await fetch(url, {
    headers: { "Accept": "application/json", "User-Agent": UA },
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) {
    if (r.status === 429) throw { status: 429, message: "CoinGecko rate limit exceeded. 1분 후 재시도하세요." };
    throw { status: r.status, message: `CoinGecko error: ${r.status}` };
  }
  return r.json();
}

async function fetchOHLC(id, days) {
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
        const candles = raw
          .filter(d => Array.isArray(d) && d.length >= 5 && d[1] != null)
          .map(([ts, o, h, l, c]) => ({ time: Math.floor(ts / 1000), open: o, high: h, low: l, close: c }));
        if (candles.length > 0) return { id, days, candles };
      }
    }
  } catch {}

  // 2차: 폴백 — market_chart → 캔들 변환
  const mc = await fetchMarketChart(id, days);
  const prices = mc.prices || [];
  if (!prices.length) return { id, days, candles: [] };

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
  return { id, days, candles: Array.from(buckets.values()).sort((a, b) => a.time - b.time) };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { id, days = "365", type } = req.query;
  if (!id) return res.status(400).json({ error: "id is required" });

  try {
    if (type === "ohlc") {
      const data = await fetchOHLC(id, days);
      res.setHeader("Cache-Control", "s-maxage=120, stale-while-revalidate=300");
      return res.status(200).json(data);
    } else {
      const data = await fetchMarketChart(id, days);
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
      return res.status(200).json(data);
    }
  } catch (error) {
    const status = error.status || 500;
    console.error(`CoinGecko error for ${id}:`, error.message || error);
    return res.status(status).json({ error: error.message || "Unknown error", candles: [] });
  }
}
