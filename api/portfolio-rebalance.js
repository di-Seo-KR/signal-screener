// Portfolio Rebalancing Cron - Runs weekdays at 14:00 UTC (10:00 ET)
// Manages position weights, stop-losses, and profit-taking

const ALPACA_BASE = 'https://paper-api.alpaca.markets';
const MAX_STOCK_WEIGHT = 0.20; // 20% max per stock
const MAX_CRYPTO_WEIGHT = 0.30; // 30% max per crypto
const STOP_LOSS_THRESHOLD = -0.08; // -8% unrealized loss
const PROFIT_TAKE_THRESHOLD = 0.25; // +25% unrealized gain

export default async function handler(req, res) {
  // Verify cron secret
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const alpacaKey = process.env.ALPACA_API_KEY;
    const alpacaSecret = process.env.ALPACA_SECRET_KEY;

    if (!alpacaKey || !alpacaSecret) {
      throw new Error('Missing Alpaca credentials');
    }

    // Step 1: Fetch account info
    const accountResp = await fetchAlpaca('/v2/account', { alpacaKey, alpacaSecret });
    const equity = parseFloat(accountResp.equity);
    const cash = parseFloat(accountResp.cash);

    // Step 2: Fetch all positions
    const positionsResp = await fetchAlpaca('/v2/positions', { alpacaKey, alpacaSecret });
    const positions = Array.isArray(positionsResp) ? positionsResp : [];

    // Calculate position weights and identify actions
    const positionWeights = positions.map(pos => ({
      symbol: pos.symbol,
      qty: parseFloat(pos.qty),
      current_price: parseFloat(pos.current_price),
      market_value: parseFloat(pos.market_value),
      cost_basis: parseFloat(pos.cost_basis),
      unrealized_pl: parseFloat(pos.unrealized_pl),
      unrealized_plpc: parseFloat(pos.unrealized_plpc),
      weight: parseFloat(pos.market_value) / equity,
      asset_class: pos.asset_class || 'us_equity',
    }));

    // Step 3-5: Identify rebalancing actions
    const actions = identifyRebalancingActions(positionWeights, equity);

    // Step 6: Execute rebalancing orders
    const executionResults = await executeRebalancingOrders(
      actions,
      { alpacaKey, alpacaSecret }
    );

    // Step 7: Send Telegram notification
    const summary = formatRebalancingSummary(
      positionWeights,
      actions,
      executionResults,
      equity,
      cash
    );

    await sendTelegramMessage(summary);

    return res.status(200).json({
      success: true,
      timestamp: new Date().toISOString(),
      portfolio_equity: equity,
      total_positions: positions.length,
      actions_identified: actions.length,
      actions_executed: executionResults.filter(r => r.success).length,
    });
  } catch (error) {
    console.error('Portfolio rebalance error:', error);

    // Send error notification
    await sendTelegramMessage(
      `❌ Portfolio Rebalance Error\n\n${error.message}`
    ).catch(() => {});

    return res.status(500).json({
      error: error.message || 'Rebalancing failed',
      timestamp: new Date().toISOString(),
    });
  }
}

/**
 * Identify positions that need rebalancing
 */
function identifyRebalancingActions(positionWeights, equity) {
  const actions = [];

  for (const pos of positionWeights) {
    const isCrypto = pos.asset_class === 'crypto';
    const maxWeight = isCrypto ? MAX_CRYPTO_WEIGHT : MAX_STOCK_WEIGHT;

    // Rule 1: Overweight positions
    if (pos.weight > maxWeight) {
      const excessValue = pos.market_value - (maxWeight * equity);
      const sellQty = Math.floor(excessValue / pos.current_price);

      if (sellQty > 0) {
        actions.push({
          type: 'sell_overweight',
          symbol: pos.symbol,
          qty: sellQty,
          reason: `Overweight (${(pos.weight * 100).toFixed(1)}% > ${(maxWeight * 100).toFixed(1)}%)`,
          current_weight: pos.weight,
          target_weight: maxWeight,
        });
      }
    }

    // Rule 2: Stop-loss positions (large unrealized losses)
    if (pos.unrealized_plpc < STOP_LOSS_THRESHOLD) {
      actions.push({
        type: 'stop_loss',
        symbol: pos.symbol,
        qty: pos.qty,
        reason: `Stop-loss triggered (${(pos.unrealized_plpc * 100).toFixed(2)}% loss)`,
        unrealized_loss: pos.unrealized_pl,
        unrealized_loss_pct: pos.unrealized_plpc,
      });
    }

    // Rule 3: Profit-taking (large unrealized gains - trim to half)
    if (pos.unrealized_plpc > PROFIT_TAKE_THRESHOLD) {
      const trimQty = Math.floor(pos.qty / 2);

      if (trimQty > 0) {
        actions.push({
          type: 'profit_take',
          symbol: pos.symbol,
          qty: trimQty,
          reason: `Profit-taking (${(pos.unrealized_plpc * 100).toFixed(2)}% gain)`,
          unrealized_gain: pos.unrealized_pl,
          unrealized_gain_pct: pos.unrealized_plpc,
        });
      }
    }
  }

  return actions;
}

/**
 * Execute rebalancing orders
 */
async function executeRebalancingOrders(actions, credentials) {
  const results = [];

  for (const action of actions) {
    try {
      const orderPayload = {
        symbol: action.symbol,
        qty: action.qty,
        side: 'sell',
        type: 'market',
        time_in_force: 'day',
      };

      // Add stop price for stop-loss orders
      if (action.type === 'stop_loss') {
        // Stop at 2% below current price to ensure execution
        const stopPriceResp = await fetchAlpaca(
          `/v2/positions/${action.symbol}`,
          credentials
        );
        const currentPrice = parseFloat(stopPriceResp.current_price);
        orderPayload.order_class = 'simple';
      }

      const orderResp = await fetchAlpaca(
        '/v2/orders',
        credentials,
        'POST',
        orderPayload
      );

      results.push({
        success: true,
        action: action.type,
        symbol: action.symbol,
        qty: action.qty,
        order_id: orderResp.id,
        status: orderResp.status,
      });
    } catch (error) {
      results.push({
        success: false,
        action: action.type,
        symbol: action.symbol,
        qty: action.qty,
        error: error.message,
      });
    }
  }

  return results;
}

/**
 * Format rebalancing summary for Telegram
 */
function formatRebalancingSummary(positions, actions, results, equity, cash) {
  let message = '📊 *Portfolio Rebalance Report*\n\n';
  message += `⏰ ${new Date().toISOString()}\n`;
  message += `💼 Equity: $${equity.toFixed(2)}\n`;
  message += `💵 Cash: $${cash.toFixed(2)}\n\n`;

  // Top holdings
  message += '📈 *Top Holdings:*\n';
  const topHoldings = positions
    .sort((a, b) => b.market_value - a.market_value)
    .slice(0, 5);

  for (const pos of topHoldings) {
    const weight = (pos.weight * 100).toFixed(1);
    const pl = pos.unrealized_pl > 0 ? '📈' : '📉';
    const plPct = (pos.unrealized_plpc * 100).toFixed(2);
    message += `${pl} ${pos.symbol}: ${weight}% ($${pos.market_value.toFixed(2)}) [${plPct}%]\n`;
  }

  // Actions taken
  if (actions.length > 0) {
    message += '\n🔄 *Rebalancing Actions:*\n';

    const sellOverweight = actions.filter(a => a.type === 'sell_overweight');
    const stopLosses = actions.filter(a => a.type === 'stop_loss');
    const profitTakes = actions.filter(a => a.type === 'profit_take');

    if (sellOverweight.length > 0) {
      message += '\n*Overweight Reductions:*\n';
      for (const action of sellOverweight) {
        message += `  🔻 ${action.symbol}: Sell ${action.qty} shares (${(action.current_weight * 100).toFixed(1)}% → ${(action.target_weight * 100).toFixed(1)}%)\n`;
      }
    }

    if (stopLosses.length > 0) {
      message += '\n*Stop-Loss Executions:*\n';
      for (const action of stopLosses) {
        message += `  ❌ ${action.symbol}: Sell ${action.qty} shares (${(action.unrealized_loss_pct * 100).toFixed(2)}% loss)\n`;
      }
    }

    if (profitTakes.length > 0) {
      message += '\n*Profit Taking:*\n';
      for (const action of profitTakes) {
        message += `  ✅ ${action.symbol}: Trim ${action.qty} shares (${(action.unrealized_gain_pct * 100).toFixed(2)}% gain)\n`;
      }
    }

    // Execution summary
    message += '\n*Execution Summary:*\n';
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    message += `✓ ${successful} successful | ✗ ${failed} failed\n`;
  } else {
    message += '\n✓ *Portfolio Balanced* - No rebalancing needed\n';
  }

  return message;
}

/**
 * Fetch from Alpaca API
 */
async function fetchAlpaca(
  endpoint,
  { alpacaKey, alpacaSecret },
  method = 'GET',
  body = null
) {
  const url = ALPACA_BASE + endpoint;
  const options = {
    method,
    headers: {
      'APCA-API-KEY-ID': alpacaKey,
      'APCA-API-SECRET-KEY': alpacaSecret,
      'Content-Type': 'application/json',
    },
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Alpaca API error (${response.status}): ${errorText}`);
  }

  return response.json();
}

/**
 * Send Telegram message
 */
async function sendTelegramMessage(message) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!botToken || !chatId) {
    console.warn('Telegram credentials missing, skipping notification');
    return;
  }

  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: message,
      parse_mode: 'Markdown',
    }),
  });

  if (!response.ok) {
    throw new Error(`Telegram API error: ${response.statusText}`);
  }

  return response.json();
}
