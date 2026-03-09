// Vercel Serverless Function — Yahoo Finance 프록시
// 브라우저 CORS 문제 없이 Yahoo Finance 데이터를 서버에서 직접 가져옵니다

export default async function handler(req, res) {
  // CORS 허용
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const { symbol, interval = "1wk", range = "2y" } = req.query;

  if (!symbol) {
    return res.status(400).json({ error: "symbol is required" });
  }

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`;

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; SignalScreener/2.0)",
        "Accept": "application/json",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": "https://finance.yahoo.com",
        "Origin": "https://finance.yahoo.com",
      },
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: `Yahoo Finance error: ${response.status}` });
    }

    const data = await response.json();

    // 항상 최신 데이터 — 캐시 비활성화
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    return res.status(200).json(data);
  } catch (error) {
    console.error(`Yahoo fetch error for ${symbol}:`, error);
    return res.status(500).json({ error: error.message });
  }
}
