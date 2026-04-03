// Virtual Portfolio API — KV 가상 포트폴리오 데이터 조회
// 크립토 + 주식 가상 포트폴리오를 프론트엔드에 제공

export default async function handler(req, res) {
  try {
    const kvModule = await import("@vercel/kv");
    const kv = kvModule.kv;

    const type = req.query.type || "all"; // "crypto", "stock", "all"

    const result = {};

    if (type === "crypto" || type === "all") {
      const cryptoPortfolio = await kv.get("di:virtual:portfolio");
      if (cryptoPortfolio) {
        // 현재 가격 조회 (CoinGecko — Binance 미국 차단)
        let prices = {};
        const cgIds = {
          "BTC/USD": "bitcoin", "ETH/USD": "ethereum", "SOL/USD": "solana",
          "XRP/USD": "ripple", "ADA/USD": "cardano", "AVAX/USD": "avalanche-2",
          "LINK/USD": "chainlink", "UNI/USD": "uniswap", "AAVE/USD": "aave",
          "DOT/USD": "polkadot", "DOGE/USD": "dogecoin", "SHIB/USD": "shiba-inu",
          "PEPE/USD": "pepe", "ARB/USD": "arbitrum", "OP/USD": "optimism",
          "MATIC/USD": "matic-network",
        };
        try {
          const ids = Object.values(cgIds).join(",");
          const cgRes = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`, { signal: AbortSignal.timeout(8000) });
          if (cgRes.ok) {
            const cgData = await cgRes.json();
            for (const [asset, cgId] of Object.entries(cgIds)) {
              if (cgData[cgId]?.usd) prices[asset] = cgData[cgId].usd;
            }
          }
        } catch { /* CoinGecko 실패 시 매수가로 폴백 */ }

        // 포지션 시가평가
        let totalMarketValue = 0;
        const positions = [];
        for (const [asset, pos] of Object.entries(cryptoPortfolio.positions || {})) {
          const currentPrice = prices[asset] || pos.avgPrice;
          const mv = pos.qty * currentPrice;
          const costBasis = pos.qty * pos.avgPrice;
          totalMarketValue += mv;
          positions.push({
            symbol: asset,
            qty: pos.qty,
            avgPrice: pos.avgPrice,
            currentPrice,
            marketValue: mv,
            costBasis,
            unrealizedPL: mv - costBasis,
            unrealizedPLPct: costBasis > 0 ? ((mv - costBasis) / costBasis * 100) : 0,
            entryTime: pos.entryTime,
          });
        }

        const equity = cryptoPortfolio.cash + totalMarketValue;
        const initialCash = cryptoPortfolio.initialCash || 100000;
        const totalPL = equity - initialCash;
        const totalPLPct = initialCash > 0 ? ((equity - initialCash) / initialCash * 100) : 0;

        // 이전 equity (일간 P&L용)
        const prevEquity = (await kv.get("di:virtual:crypto-prev-equity")) || equity;

        result.crypto = {
          cash: cryptoPortfolio.cash,
          equity,
          initialCash,
          totalMarketValue,
          totalPL,
          totalPLPct,
          dayPL: equity - prevEquity,
          dayPLPct: prevEquity > 0 ? ((equity - prevEquity) / prevEquity * 100) : 0,
          positions,
          totalTrades: cryptoPortfolio.totalTrades || 0,
          createdAt: cryptoPortfolio.createdAt,
        };
      }
    }

    if (type === "stock" || type === "all") {
      const stockPortfolio = await kv.get("di:virtual:stock-portfolio");
      if (stockPortfolio) {
        // Yahoo Finance에서 현재 가격 조회
        let currentPrices = {};
        const symbols = Object.keys(stockPortfolio.positions || {});
        if (symbols.length > 0) {
          try {
            const promises = symbols.map(async (sym) => {
              const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&range=1d`);
              const d = await r.json();
              const meta = d?.chart?.result?.[0]?.meta;
              if (meta?.regularMarketPrice) currentPrices[sym] = meta.regularMarketPrice;
            });
            await Promise.allSettled(promises);
          } catch {}
        }

        let totalMarketValue = 0;
        const positions = [];
        for (const [symbol, pos] of Object.entries(stockPortfolio.positions || {})) {
          const currentPrice = currentPrices[symbol] || pos.avgPrice;
          const mv = pos.qty * currentPrice;
          const costBasis = pos.qty * pos.avgPrice;
          totalMarketValue += mv;
          positions.push({
            symbol,
            qty: pos.qty,
            avgPrice: pos.avgPrice,
            currentPrice,
            marketValue: mv,
            costBasis,
            unrealizedPL: mv - costBasis,
            unrealizedPLPct: costBasis > 0 ? ((mv - costBasis) / costBasis * 100) : 0,
            entryTime: pos.entryTime,
          });
        }

        const equity = stockPortfolio.cash + totalMarketValue;
        const initialCash = stockPortfolio.initialCash || 100000;
        const totalPL = equity - initialCash;
        const totalPLPct = initialCash > 0 ? ((equity - initialCash) / initialCash * 100) : 0;

        const prevEquity = (await kv.get("di:virtual:stock-prev-equity")) || equity;

        result.stock = {
          cash: stockPortfolio.cash,
          equity,
          initialCash,
          totalMarketValue,
          totalPL,
          totalPLPct,
          dayPL: equity - prevEquity,
          dayPLPct: prevEquity > 0 ? ((equity - prevEquity) / prevEquity * 100) : 0,
          positions,
          totalTrades: stockPortfolio.totalTrades || 0,
          createdAt: stockPortfolio.createdAt,
        };
      }
    }

    return res.status(200).json({ ok: true, ...result });
  } catch (error) {
    console.error("Virtual portfolio API error:", error);
    return res.status(500).json({ ok: false, error: error.message });
  }
}
