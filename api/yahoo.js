// Vercel Serverless — Yahoo Finance 프록시 (cookie + crumb 인증)
// Yahoo Finance v8 API는 2023년부터 crumb/cookie 인증 필수

let _cookie = null;
let _crumb = null;
let _expires = 0;

async function getAuth() {
  const now = Date.now();
  if (_cookie && _crumb && now < _expires) return { cookie: _cookie, crumb: _crumb };

  // Step 1: finance.yahoo.com 방문 → Set-Cookie 수집
  const initRes = await fetch("https://fc.yahoo.com", {
    redirect: "follow",
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
  });
  const cookies = initRes.headers.get("set-cookie") || "";

  // Step 2: crumb 획득
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
  _expires = now + 10 * 60 * 1000; // 10분 캐시

  return { cookie: _cookie, crumb: _crumb };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { symbol, interval = "1wk", range = "2y" } = req.query;
  if (!symbol) return res.status(400).json({ error: "symbol required" });

  try {
    const { cookie, crumb } = await getAuth();
    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}&crumb=${encodeURIComponent(crumb)}`;

    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json",
        "Cookie": cookie,
      },
    });

    if (response.status === 401 || response.status === 403) {
      // 인증 만료 → 재시도
      _cookie = null; _crumb = null; _expires = 0;
      const auth2 = await getAuth();
      const url2 = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}&crumb=${encodeURIComponent(auth2.crumb)}`;
      const res2 = await fetch(url2, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "application/json",
          "Cookie": auth2.cookie,
        },
      });
      if (!res2.ok) throw new Error(`Yahoo retry failed: ${res2.status}`);
      const data2 = await res2.json();
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).json(data2);
    }

    if (!response.ok) throw new Error(`Yahoo error: ${response.status}`);
    const data = await response.json();
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json(data);
  } catch (error) {
    console.error(`Yahoo fetch error for ${symbol}:`, error.message);
    return res.status(500).json({ error: error.message });
  }
}
