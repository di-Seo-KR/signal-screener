// Portfolio Rebalancing Cron - Runs weekdays at 14:00 UTC (10:00 ET)
// KV 가상 포트폴리오 기반 리밸런싱
// 주식 + 크립토 포지션 비중 관리, 손절, 익절

const MAX_STOCK_WEIGHT = 0.20; // 20% max per stock
const MAX_CRYPTO_WEIGHT = 0.30; // 30% max per crypto
const STOP_LOSS_THRESHOLD = -0.08; // -8% unrealized loss
const PROFIT_TAKE_THRESHOLD = 0.25; // +25% unrealized gain

const STOCK_PORTFOLIO_KEY = "di:virtual:stock-portfolio";
const CRYPTO_PORTFOLIO_KEY = "di:virtual:portfolio";

export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const kvModule = await import("@vercel/kv");
    const kv = kvModule.kv;

    // Load both portfolios
    const stockPortfolio = await kv.get(STOCK_PORTFOLIO_KEY);
    const cryptoPortfolio = await kv.get(CRYPTO_PORTFOLIO_KEY);

    const allActions = [];
    const allResults = [];
    let totalEquity = 0;
    let totalCash = 0;
    const allPositionWeights = [];

    // ── Stock Portfolio Rebalancing ──
    if (stockPortfolio && Object.keys(stockPortfolio.positions || {}).length > 0) {
      // Fetch current stock prices from Yahoo Finance
      const symbols = Object.keys(stockPortfolio.positions);
      const currentPrices = {};
      for (const sym of symbols) {
        try {
          const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&range=1d`);
          const d = await r.json();
          const meta = d?.chart?.result?.[0]?.meta;
          if (meta?.regularMarketPrice) currentPrices[sym] = meta.regularMarketPrice;
        } catch {}
      }

      let stockMarketValue = 0;
      const stockPositions = [];
      for (const [symbol, pos] of Object.entries(stockPortfolio.positions)) {
        const currentPrice = currentPrices[symbol] || pos.avgPrice;
        const mv = pos.qty * currentPrice;
        const costBasis = pos.qty * pos.avgPrice;
        stockMarketValue += mv;
        stockPositions.push({
          symbol, qty: pos.qty, currentPrice, marketValue: mv, costBasis,
          unrealizedPL: mv - costBasis,
          unrealizedPLPct: costBasis > 0 ? (mv - costBasis) / costBasis : 0,
          assetClass: 'stock',
        });
      }

      const stockEquity = stockPortfolio.cash + stockMarketValue;
      totalEquity += stockEquity;
      totalCash += stockPortfolio.cash;

      // Identify actions for stocks
      for (const pos of stockPositions) {
        const weight = stockEquity > 0 ? pos.marketValue / stockEquity : 0;
        allPositionWeights.push({ ...pos, weight });

        // Overweight
        if (weight > MAX_STOCK_WEIGHT) {
          const excessValue = pos.marketValue - (MAX_STOCK_WEIGHT * stockEquity);
          const sellQty = Math.floor(excessValue / pos.currentPrice);
          if (sellQty > 0) {
            allActions.push({ type: 'sell_overweight', symbol: pos.symbol, qty: sellQty, portfolio: 'stock',
              reason: `Overweight (${(weight * 100).toFixed(1)}% > ${(MAX_STOCK_WEIGHT * 100).toFixed(1)}%)`,
              currentWeight: weight, targetWeight: MAX_STOCK_WEIGHT });
          }
        }

        // Stop-loss
        if (pos.unrealizedPLPct < STOP_LOSS_THRESHOLD) {
          allActions.push({ type: 'stop_loss', symbol: pos.symbol, qty: pos.qty, portfolio: 'stock',
            reason: `Stop-loss (${(pos.unrealizedPLPct * 100).toFixed(2)}% loss)`,
            unrealizedLoss: pos.unrealizedPL, unrealizedLossPct: pos.unrealizedPLPct });
        }

        // Profit-take (trim half)
        if (pos.unrealizedPLPct > PROFIT_TAKE_THRESHOLD) {
          const trimQty = Math.floor(pos.qty / 2);
          if (trimQty > 0) {
            allActions.push({ type: 'profit_take', symbol: pos.symbol, qty: trimQty, portfolio: 'stock',
              reason: `Profit-taking (${(pos.unrealizedPLPct * 100).toFixed(2)}% gain)`,
              unrealizedGain: pos.unrealizedPL, unrealizedGainPct: pos.unrealizedPLPct });
          }
        }
      }

      // Execute stock rebalancing
      for (const action of allActions.filter(a => a.portfolio === 'stock')) {
        try {
          const pos = stockPortfolio.positions[action.symbol];
          if (!pos) { allResults.push({ success: false, ...action, error: 'Position not found' }); continue; }

          const price = currentPrices[action.symbol] || pos.avgPrice;
          const sellValue = action.qty * price;

          if (action.qty >= pos.qty) {
            // Full close
            stockPortfolio.cash += pos.qty * price;
            delete stockPortfolio.positions[action.symbol];
          } else {
            // Partial sell
            stockPortfolio.cash += sellValue;
            pos.qty -= action.qty;
          }
          stockPortfolio.totalTrades = (stockPortfolio.totalTrades || 0) + 1;
          allResults.push({ success: true, ...action, price, value: sellValue });
        } catch (e) {
          allResults.push({ success: false, ...action, error: e.message });
        }
      }

      await kv.set(STOCK_PORTFOLIO_KEY, stockPortfolio);
    }

    // ── Crypto Portfolio Rebalancing ──
    if (cryptoPortfolio && Object.keys(cryptoPortfolio.positions || {}).length > 0) {
      let prices = {};
      try {
        const tickerRes = await fetch("https://api.binance.com/api/v3/ticker/price");
        const tickers = await tickerRes.json();
        for (const t of tickers) prices[t.symbol] = parseFloat(t.price);
      } catch {}

      let cryptoMarketValue = 0;
      const cryptoPositions = [];
      for (const [asset, pos] of Object.entries(cryptoPortfolio.positions)) {
        const binanceSym = asset.replace("-USD", "USDT").replace("/USD", "USDT").replace("/", "");
        const currentPrice = prices[binanceSym] || prices[asset] || pos.avgPrice;
        const mv = pos.qty * currentPrice;
        const costBasis = pos.qty * pos.avgPrice;
        cryptoMarketValue += mv;
        cryptoPositions.push({
          symbol: asset, qty: pos.qty, currentPrice, marketValue: mv, costBasis,
          unrealizedPL: mv - costBasis,
          unrealizedPLPct: costBasis > 0 ? (mv - costBasis) / costBasis : 0,
          assetClass: 'crypto',
        });
      }

      const cryptoEquity = cryptoPortfolio.cash + cryptoMarketValue;
      totalEquity += cryptoEquity;
      totalCash += cryptoPortfolio.cash;

      const cryptoActions = [];
      for (const pos of cryptoPositions) {
        const weight = cryptoEquity > 0 ? pos.marketValue / cryptoEquity : 0;
        allPositionWeights.push({ ...pos, weight });

        if (weight > MAX_CRYPTO_WEIGHT) {
          const excessValue = pos.marketValue - (MAX_CRYPTO_WEIGHT * cryptoEquity);
          const sellQty = excessValue / pos.currentPrice;
          if (sellQty > 0.0001) {
            cryptoActions.push({ type: 'sell_overweight', symbol: pos.symbol, qty: sellQty, portfolio: 'crypto',
              reason: `Overweight (${(weight * 100).toFixed(1)}% > ${(MAX_CRYPTO_WEIGHT * 100).toFixed(1)}%)`,
              currentWeight: weight, targetWeight: MAX_CRYPTO_WEIGHT });
          }
        }

        if (pos.unrealizedPLPct < STOP_LOSS_THRESHOLD) {
          cryptoActions.push({ type: 'stop_loss', symbol: pos.symbol, qty: pos.qty, portfolio: 'crypto',
            reason: `Stop-loss (${(pos.unrealizedPLPct * 100).toFixed(2)}% loss)` });
        }

        if (pos.unrealizedPLPct > PROFIT_TAKE_THRESHOLD) {
          const trimQty = pos.qty / 2;
          if (trimQty > 0.0001) {
            cryptoActions.push({ type: 'profit_take', symbol: pos.symbol, qty: trimQty, portfolio: 'crypto',
              reason: `Profit-taking (${(pos.unrealizedPLPct * 100).toFixed(2)}% gain)` });
          }
        }
      }

      for (const action of cryptoActions) {
        try {
          const pos = cryptoPortfolio.positions[action.symbol];
          if (!pos) { allResults.push({ success: false, ...action, error: 'Position not found' }); continue; }

          const binanceSym = action.symbol.replace("-USD", "USDT").replace("/USD", "USDT").replace("/", "");
          const price = prices[binanceSym] || prices[action.symbol] || pos.avgPrice;
          const sellValue = action.qty * price;

          if (action.qty >= pos.qty) {
            cryptoPortfolio.cash += pos.qty * price;
            delete cryptoPortfolio.positions[action.symbol];
          } else {
            cryptoPortfolio.cash += sellValue;
            pos.qty -= action.qty;
          }
          cryptoPortfolio.totalTrades = (cryptoPortfolio.totalTrades || 0) + 1;
          allResults.push({ success: true, ...action, price, value: sellValue });
        } catch (e) {
          allResults.push({ success: false, ...action, error: e.message });
        }
      }

      allActions.push(...cryptoActions);
      await kv.set(CRYPTO_PORTFOLIO_KEY, cryptoPortfolio);
    }

    // Telegram report
    const summary = formatRebalancingSummary(allPositionWeights, allActions, allResults, totalEquity, totalCash);
    await sendTelegramMessage(summary);

    return res.status(200).json({
      success: true,
      timestamp: new Date().toISOString(),
      portfolio_equity: totalEquity,
      total_positions: allPositionWeights.length,
      actions_identified: allActions.length,
      actions_executed: allResults.filter(r => r.success).length,
    });
  } catch (error) {
    console.error('Portfolio rebalance error:', error);
    await sendTelegramMessage(`❌ Portfolio Rebalance Error\n\n${error.message}`).catch(() => {});
    return res.status(500).json({ error: error.message || 'Rebalancing failed', timestamp: new Date().toISOString() });
  }
}

function formatRebalancingSummary(positions, actions, results, equity, cash) {
  let msg = '📊 *DI 포트폴리오 리밸런스 리포트*\n\n';
  msg += `⏰ ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}\n`;
  msg += `💼 총 자산: $${equity.toFixed(2)}\n`;
  msg += `💵 현금: $${cash.toFixed(2)}\n\n`;

  const topHoldings = positions.sort((a, b) => b.marketValue - a.marketValue).slice(0, 5);
  if (topHoldings.length > 0) {
    msg += '📈 *상위 보유:*\n';
    for (const pos of topHoldings) {
      const icon = pos.unrealizedPL > 0 ? '📈' : '📉';
      msg += `${icon} ${pos.symbol}: ${(pos.weight * 100).toFixed(1)}% ($${pos.marketValue.toFixed(0)}) [${(pos.unrealizedPLPct * 100).toFixed(1)}%]\n`;
    }
  }

  if (actions.length > 0) {
    msg += '\n🔄 *리밸런싱 액션:*\n';
    for (const a of actions) {
      const icon = a.type === 'stop_loss' ? '❌' : a.type === 'profit_take' ? '✅' : '🔻';
      msg += `${icon} ${a.symbol}: ${a.reason}\n`;
    }
    const ok = results.filter(r => r.success).length;
    const fail = results.filter(r => !r.success).length;
    msg += `\n실행: ✓ ${ok}건 성공 | ✗ ${fail}건 실패\n`;
  } else {
    msg += '\n✓ *포트폴리오 균형* — 리밸런싱 불필요\n';
  }

  return msg;
}

async function sendTelegramMessage(message) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!botToken || !chatId) return;

  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'Markdown' }),
    });
  } catch (e) {
    console.error('Telegram send error:', e.message);
  }
}
