// Vercel Serverless Function — CoinGecko 프록시
// 서버에서 직접 CoinGecko API를 호출합니다 (CORS 불필요)

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const { id, days = "365" } = req.query;

  if (!id) {
    return res.status(400).json({ error: "id is required" });
  }

  const url = `https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=${days}&interval=daily`;

  try {
    const response = await fetch(url, {
      headers: {
        "Accept": "application/json",
        "User-Agent": "SignalScreener/2.0",
      },
    });

    if (!response.ok) {
      // CoinGecko 429 (Rate Limit) 처리
      if (response.status === 429) {
        return res.status(429).json({ error: "CoinGecko rate limit exceeded. 1분 후 재시도하세요." });
      }
      return res.status(response.status).json({ error: `CoinGecko error: ${response.status}` });
    }

    const data = await response.json();

    // 항상 최신 데이터 — 캐시 비활성화
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    return res.status(200).json(data);
  } catch (error) {
    console.error(`CoinGecko fetch error for ${id}:`, error);
    return res.status(500).json({ error: error.message });
  }
}
