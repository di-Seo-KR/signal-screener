// Vercel Serverless — 공포/탐욕 지수 (Fear & Greed Index)
// /api/fear-greed
// CNN Fear & Greed + Alternative.me Crypto Fear & Greed

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();

  const result = { stock: null, crypto: null };

  // ── 1) CNN Fear & Greed Index (주식) ──
  try {
    // CNN provides a public API endpoint
    const cnnRes = await fetch("https://production.dataviz.cnn.io/index/fearandgreed/graphdata", {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json",
      },
      signal: AbortSignal.timeout(8000),
    });
    if (cnnRes.ok) {
      const data = await cnnRes.json();
      const current = data?.fear_and_greed;
      if (current) {
        result.stock = {
          value: Math.round(current.score),
          label: current.rating,
          previous: current.previous_close ? Math.round(current.previous_close) : null,
          oneWeekAgo: current.previous_1_week ? Math.round(current.previous_1_week) : null,
          oneMonthAgo: current.previous_1_month ? Math.round(current.previous_1_month) : null,
        };
      }
    }
  } catch {}

  // Fallback: compute a simple stock fear/greed from VIX
  if (!result.stock) {
    try {
      const vixRes = await fetch("https://query1.finance.yahoo.com/v8/finance/chart/%5EVIX?interval=1d&range=5d", {
        headers: { "User-Agent": "Mozilla/5.0" },
        signal: AbortSignal.timeout(5000),
      });
      if (vixRes.ok) {
        const vixData = await vixRes.json();
        const closes = vixData?.chart?.result?.[0]?.indicators?.quote?.[0]?.close || [];
        const vix = closes.filter(v => v != null).pop();
        if (vix) {
          // VIX → Fear/Greed mapping:
          // VIX < 12 → Extreme Greed (90)
          // VIX 12-17 → Greed (70)
          // VIX 17-22 → Neutral (50)
          // VIX 22-30 → Fear (30)
          // VIX > 30 → Extreme Fear (10)
          let score;
          if (vix <= 12) score = 90;
          else if (vix <= 17) score = 70 + (17 - vix) / 5 * 20;
          else if (vix <= 22) score = 50 + (22 - vix) / 5 * 20;
          else if (vix <= 30) score = 20 + (30 - vix) / 8 * 30;
          else score = Math.max(5, 20 - (vix - 30) * 1.5);
          score = Math.round(Math.min(99, Math.max(1, score)));
          const label = score <= 25 ? "Extreme Fear" : score <= 40 ? "Fear" : score <= 60 ? "Neutral" : score <= 75 ? "Greed" : "Extreme Greed";
          result.stock = { value: score, label, vix: +vix.toFixed(1) };
        }
      }
    } catch {}
  }

  // ── 2) Crypto Fear & Greed (Alternative.me) ──
  try {
    const altRes = await fetch("https://api.alternative.me/fng/?limit=1", {
      headers: { "User-Agent": "SignalScreener/5.0" },
      signal: AbortSignal.timeout(5000),
    });
    if (altRes.ok) {
      const altData = await altRes.json();
      const d = altData?.data?.[0];
      if (d) {
        result.crypto = {
          value: parseInt(d.value),
          label: d.value_classification,
          ts: d.timestamp,
        };
      }
    }
  } catch {}

  res.setHeader("Cache-Control", "s-maxage=600, stale-while-revalidate=1200");
  return res.status(200).json(result);
}
