// Stock Auto-Trading Cron Engine for Vercel
// Runs weekdays at 13:30 UTC (US market open 9:30 ET)
// Paper-trades 10 high-liquidity US stocks via Alpaca

import fetch from 'node-fetch';

const ALPACA_BASE = 'https://paper-api.alpaca.markets';
const YAHOO_FINANCE_URL = 'https://query1.finance.yahoo.com/v8/finance/chart';

const WATCHLIST = ['AAPL', 'MSFT', 'NVDA', 'GOOG', 'AMZN', 'META', 'TSLA', 'AMD', 'AVGO', 'CRM'];
const MAX_EQUITY_PER_STOCK = 0.15;
const MAX_TOTAL_STOCK_EXPOSURE = 0.80;
const TRAILING_STOP_LOSS = -0.04;

// ==================== TECHNICAL INDICATOR CALCULATIONS ====================

function calcSMA(data, period) {
  if (data.length < period) return [];
  const sma = [];
  for (let i = period - 1; i < data.length; i++) {
    const sum = data.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
    sma.push(sum / period);
  }
  return sma;
}

function calcEMA(data, period) {
  if (data.length < period) return [];
  const k = 2 / (period + 1);
  const ema = [];

  // Initial SMA
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += data[i];
  }
  ema.push(sum / period);

  // EMA
  for (let i = period; i < data.length; i++) {
    ema.push(data[i] * k + ema[ema.length - 1] * (1 - k));
  }
  return ema;
}

function calcRSI(data, period = 14) {
  if (data.length < period + 1) return [];

  const changes = [];
  for (let i = 1; i < data.length; i++) {
    changes.push(data[i] - data[i - 1]);
  }

  let avgGain = 0, avgLoss = 0;
  for (let i = 0; i < period; i++) {
    const change = changes[i];
    if (change > 0) avgGain += change;
    else avgLoss -= change;
  }
  avgGain /= period;
  avgLoss /= period;

  const rsi = [];
  for (let i = period; i < changes.length; i++) {
    const change = changes[i];
    if (change > 0) avgGain = (avgGain * (period - 1) + change) / period;
    else avgLoss = (avgLoss * (period - 1) - change) / period;

    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    rsi.push(100 - (100 / (1 + rs)));
  }
  return rsi;
}

function calcBB(data, period = 20, stdDev = 2) {
  const sma = calcSMA(data, period);
  const bb = [];

  for (let i = period - 1; i < data.length; i++) {
    const window = data.slice(i - period + 1, i + 1);
    const mean = sma[i - period + 1];
    let variance = 0;
    for (let j = 0; j < window.length; j++) {
      variance += Math.pow(window[j] - mean, 2);
    }
    variance /= period;
    const std = Math.sqrt(variance);
    bb.push({
      upper: mean + stdDev * std,
      middle: mean,
      lower: mean - stdDev * std
    });
  }
  return bb;
}

function calcMACD(data, fast = 12, slow = 26, signal = 9) {
  const emaFast = calcEMA(data, fast);
  const emaSlow = calcEMA(data, slow);

  const macdLine = [];
  const startIdx = slow - 1;
  for (let i = startIdx; i < data.length; i++) {
    macdLine.push(emaFast[i - (fast - 1)] - emaSlow[i - (slow - 1)]);
  }

  const signalLine = calcEMA(macdLine, signal);
  const histogram = [];
  for (let i = 0; i < macdLine.length; i++) {
    histogram.push(macdLine[i] - (signalLine[i - (signal - 1)] || macdLine[i]));
  }

  return { macdLine, signalLine, histogram };
}

function calcATR(highs, lows, closes, period = 14) {
  const tr = [];
  for (let i = 0; i < highs.length; i++) {
    const hl = highs[i] - lows[i];
    const hc = i > 0 ? Math.abs(highs[i] - closes[i - 1]) : 0;
    const lc = i > 0 ? Math.abs(lows[i] - closes[i - 1]) : 0;
    tr.push(Math.max(hl, hc, lc));
  }

  const atr = [];
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += tr[i];
  }
  atr.push(sum / period);

  for (let i = period; i < tr.length; i++) {
    atr.push((atr[atr.length - 1] * (period - 1) + tr[i]) / period);
  }
  return atr;
}

function calcADX(highs, lows, closes, period = 14) {
  const pDM = [];
  const nDM = [];

  for (let i = 1; i < highs.length; i++) {
    const upMove = highs[i] - highs[i - 1];
    const downMove = lows[i - 1] - lows[i];

    let pDMVal = 0, nDMVal = 0;
    if (upMove > 0 && upMove > downMove) pDMVal = upMove;
    if (downMove > 0 && downMove > upMove) nDMVal = downMove;

    pDM.push(pDMVal);
    nDM.push(nDMVal);
  }

  const tr = [];
  for (let i = 0; i < highs.length - 1; i++) {
    const hl = highs[i + 1] - lows[i + 1];
    const hc = Math.abs(highs[i + 1] - closes[i]);
    const lc = Math.abs(lows[i + 1] - closes[i]);
    tr.push(Math.max(hl, hc, lc));
  }

  const atr = [];
  let trSum = 0;
  for (let i = 0; i < period; i++) {
    trSum += tr[i];
  }
  atr.push(trSum / period);

  for (let i = period; i < tr.length; i++) {
    atr.push((atr[atr.length - 1] * (period - 1) + tr[i]) / period);
  }

  const pDI = [];
  const nDI = [];
  let pDMSum = 0, nDMSum = 0;
  for (let i = 0; i < period; i++) {
    pDMSum += pDM[i];
    nDMSum += nDM[i];
  }
  pDI.push((pDMSum / atr[0]) * 100);
  nDI.push((nDMSum / atr[0]) * 100);

  for (let i = period; i < pDM.length; i++) {
    pDMSum = pDMSum * (period - 1) / period + pDM[i];
    nDMSum = nDMSum * (period - 1) / period + nDM[i];
    pDI.push((pDMSum / atr[Math.min(i - period + 1, atr.length - 1)]) * 100);
    nDI.push((nDMSum / atr[Math.min(i - period + 1, atr.length - 1)]) * 100);
  }

  const adx = [];
  let diDiffSum = 0;
  for (let i = 0; i < period; i++) {
    diDiffSum += Math.abs(pDI[i] - nDI[i]) / (pDI[i] + nDI[i] || 1);
  }
  adx.push((diDiffSum / period) * 100);

  for (let i = period; i < pDI.length; i++) {
    const diDiff = Math.abs(pDI[i] - nDI[i]) / (pDI[i] + nDI[i] || 1);
    adx.push((adx[adx.length - 1] * (period - 1) / period + diDiff * 100));
  }

  return { adx, pDI, nDI };
}

function calcStochastic(highs, lows, closes, period = 14, smoothK = 3) {
  const k = [];

  for (let i = period - 1; i < closes.length; i++) {
    const high = Math.max(...highs.slice(i - period + 1, i + 1));
    const low = Math.min(...lows.slice(i - period + 1, i + 1));
    const kVal = ((closes[i] - low) / (high - low)) * 100;
    k.push(isFinite(kVal) ? kVal : 50);
  }

  const d = calcSMA(k, smoothK);
  return { k, d };
}

function calcOBV(closes, volumes) {
  const obv = [volumes[0]];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i] > closes[i - 1]) {
      obv.push(obv[i - 1] + volumes[i]);
    } else if (closes[i] < closes[i - 1]) {
      obv.push(obv[i - 1] - volumes[i]);
    } else {
      obv.push(obv[i - 1]);
    }
  }
  return obv;
}

function detectCandlePattern(data) {
  if (data.length < 3) return null;

  const last = data[data.length - 1];
  const prev = data[data.length - 2];

  const bodySize = Math.abs(last.close - last.open);
  const prevBodySize = Math.abs(prev.close - prev.open);

  const bullishEngulfing =
    prev.close < prev.open &&
    last.close > last.open &&
    last.open <= prev.close &&
    last.close >= prev.open;

  const bearishEngulfing =
    prev.close > prev.open &&
    last.close < last.open &&
    last.open >= prev.close &&
    last.close <= prev.open;

  if (bullishEngulfing) return 'bullish_engulfing';
  if (bearishEngulfing) return 'bearish_engulfing';
  return null;
}

function detectBullishDivergence(closes, lows, rsi) {
  if (closes.length < 2 || rsi.length < 2) return false;
  const lastLow = lows[lows.length - 1];
  const prevLow = Math.min(...lows.slice(-5));
  const lastRSI = rsi[rsi.length - 1];
  const minRSI = Math.min(...rsi.slice(-5));

  return lastLow < prevLow && lastRSI > minRSI && lastRSI < 50;
}

function detectBearishDivergence(closes, highs, rsi) {
  if (closes.length < 2 || rsi.length < 2) return false;
  const lastHigh = highs[highs.length - 1];
  const prevHigh = Math.max(...highs.slice(-5));
  const lastRSI = rsi[rsi.length - 1];
  const maxRSI = Math.max(...rsi.slice(-5));

  return lastHigh > prevHigh && lastRSI < maxRSI && lastRSI > 50;
}

// ==================== DATA & ANALYSIS ====================

async function fetchYahooFinanceData(symbol) {
  try {
    const url = `${YAHOO_FINANCE_URL}/${symbol}?range=1y&interval=1d`;
    const res = await fetch(url);
    const json = await res.json();

    if (!json.chart?.result?.[0]) return null;

    const result = json.chart.result[0];
    const { timestamp, open, high, low, close, volume } = result.indicators.quote[0];

    return {
      timestamp,
      open,
      high,
      low,
      close,
      volume
    };
  } catch (error) {
    console.error(`Error fetching ${symbol}:`, error.message);
    return null;
  }
}

function analyzeLatest(symbol, data) {
  if (!data || data.close.length < 50) return null;

  const closes = data.close;
  const highs = data.high;
  const lows = data.low;
  const volumes = data.volume;

  const rsi = calcRSI(closes, 14);
  const ema21 = calcEMA(closes, 21);
  const ema55 = calcEMA(closes, 55);
  const ema200 = calcEMA(closes, 200);
  const bb = calcBB(closes, 20, 2);
  const { macdLine, signalLine, histogram } = calcMACD(closes, 12, 26, 9);
  const atr = calcATR(highs, lows, closes, 14);
  const { adx, pDI, nDI } = calcADX(highs, lows, closes, 14);
  const { k: stochK, d: stochD } = calcStochastic(highs, lows, closes, 14, 3);
  const obv = calcOBV(closes, volumes);

  const candles = closes.map((c, i) => ({
    open: data.open[i],
    high: highs[i],
    low: lows[i],
    close: c
  }));

  const candlePattern = detectCandlePattern(candles.slice(-3));
  const bullDivergence = detectBullishDivergence(closes, lows, rsi);
  const bearDivergence = detectBearishDivergence(closes, highs, rsi);

  const lastIdx = closes.length - 1;
  const lastClose = closes[lastIdx];
  const lastRSI = rsi[rsi.length - 1];
  const lastMACD = macdLine[macdLine.length - 1];
  const lastSignal = signalLine[signalLine.length - 1];
  const lastBB = bb[bb.length - 1];
  const lastStochK = stochK[stochK.length - 1];
  const lastStochD = stochD[stochD.length - 1];
  const lastADX = adx[adx.length - 1];
  const lastATR = atr[atr.length - 1];
  const lastOBV = obv[lastIdx];
  const prevOBV = obv[lastIdx - 1];

  const lastEMA21 = ema21[ema21.length - 1];
  const lastEMA55 = ema55[ema55.length - 1];
  const lastEMA200 = ema200[ema200.length - 1];

  let buyScore = 0, buyFactors = 0;
  let sellScore = 0, sellFactors = 0;

  // RSI signals
  if (lastRSI < 30) {
    buyScore += 2;
    buyFactors++;
  } else if (lastRSI > 70) {
    sellScore += 2;
    sellFactors++;
  }

  // Bollinger Bands
  if (lastClose < lastBB.lower) {
    buyScore += 2;
    buyFactors++;
  } else if (lastClose > lastBB.upper) {
    sellScore += 2;
    sellFactors++;
  }

  // MACD cross
  if (lastMACD > lastSignal && macdLine[macdLine.length - 2] <= signalLine[signalLine.length - 2]) {
    buyScore += 2;
    buyFactors++;
  } else if (lastMACD < lastSignal && macdLine[macdLine.length - 2] >= signalLine[signalLine.length - 2]) {
    sellScore += 2;
    sellFactors++;
  }

  // EMA cross
  if (lastEMA21 > lastEMA55 && lastEMA55 > lastEMA200) {
    buyScore += 1;
    buyFactors++;
  } else if (lastEMA21 < lastEMA55 && lastEMA55 < lastEMA200) {
    sellScore += 1;
    sellFactors++;
  }

  // Volume explosion
  if (volumes[lastIdx] > volumes[lastIdx - 1] * 1.5) {
    buyScore += 1;
  }

  // OBV uptrend
  if (lastOBV > prevOBV) {
    buyScore += 1;
  } else {
    sellScore += 1;
  }

  // Stochastic
  if (lastStochK < 20) {
    buyScore += 1;
    buyFactors++;
  } else if (lastStochK > 80) {
    sellScore += 1;
    sellFactors++;
  }

  // Candle pattern
  if (candlePattern === 'bullish_engulfing') {
    buyScore += 2;
    buyFactors++;
  } else if (candlePattern === 'bearish_engulfing') {
    sellScore += 2;
    sellFactors++;
  }

  // ADX strength
  if (lastADX > 25) {
    if (pDI[pDI.length - 1] > nDI[nDI.length - 1]) {
      buyScore += 1;
    } else {
      sellScore += 1;
    }
  }

  // Divergence
  if (bullDivergence) {
    buyScore += 2;
    buyFactors++;
  } else if (bearDivergence) {
    sellScore += 2;
    sellFactors++;
  }

  const buySignal = buyScore >= 4 && buyFactors >= 2;
  const sellSignal = sellScore >= 4 && sellFactors >= 2;

  return {
    symbol,
    lastClose,
    lastRSI,
    lastMACD,
    lastSignal,
    lastBB,
    lastEMA21,
    lastEMA55,
    lastEMA200,
    lastADX,
    lastATR,
    lastStochK,
    lastStochD,
    lastOBV,
    buyScore,
    buyFactors,
    buySignal,
    sellScore,
    sellFactors,
    sellSignal,
    candlePattern,
    bullDivergence,
    bearDivergence
  };
}

// ==================== ALPACA INTEGRATION ====================

async function alpacaRequest(endpoint, method = 'GET', body = null) {
  const headers = {
    'APCA-API-KEY-ID': process.env.ALPACA_API_KEY,
    'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET_KEY,
    'Content-Type': 'application/json'
  };

  const config = { method, headers };
  if (body) config.body = JSON.stringify(body);

  const res = await fetch(`${ALPACA_BASE}${endpoint}`, config);
  const json = await res.json();

  if (!res.ok) {
    console.error(`Alpaca error on ${endpoint}:`, json);
    throw new Error(`Alpaca API error: ${json.message || 'Unknown'}`);
  }

  return json;
}

async function getAccount() {
  return alpacaRequest('/v2/account');
}

async function getPositions() {
  return alpacaRequest('/v2/positions');
}

async function getOrders() {
  return alpacaRequest('/v2/orders?status=open');
}

async function placeOrder(symbol, qty, side, orderType = 'market') {
  return alpacaRequest('/v2/orders', 'POST', {
    symbol,
    qty,
    side,
    type: orderType,
    time_in_force: 'day'
  });
}

async function closePosition(symbol) {
  return alpacaRequest(`/v2/positions/${symbol}`, 'DELETE');
}

// ==================== TELEGRAM REPORTING ====================

async function sendTelegramReport(title, message) {
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
    console.log('Telegram not configured, skipping report');
    return;
  }

  try {
    await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: process.env.TELEGRAM_CHAT_ID,
        text: `*${title}*\n\n${message}`,
        parse_mode: 'Markdown'
      })
    });
  } catch (error) {
    console.error('Telegram send error:', error.message);
  }
}

// ==================== MAIN HANDLER ====================

export default async function handler(req, res) {
  try {
    // Verify cron secret if provided
    if (process.env.CRON_SECRET && req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    console.log('Starting stock auto-trading cron...');

    const account = await getAccount();
    const positions = await getPositions();
    const startEquity = parseFloat(account.equity);
    const startCash = parseFloat(account.cash);

    console.log(`Account: $${startEquity.toFixed(2)} equity, $${startCash.toFixed(2)} cash`);

    const signals = [];
    const orders = [];
    let totalTradeValue = 0;

    // Analyze each stock
    for (const symbol of WATCHLIST) {
      const data = await fetchYahooFinanceData(symbol);
      if (!data) {
        console.log(`Skipped ${symbol}: no data`);
        continue;
      }

      const analysis = analyzeLatest(symbol, data);
      if (!analysis) continue;

      signals.push(analysis);

      const existingPos = positions.find(p => p.symbol === symbol);

      // BUY signal
      if (analysis.buySignal && !existingPos) {
        const maxEquity = startEquity * MAX_EQUITY_PER_STOCK;
        const currentStockExposure = positions.reduce((sum, p) => sum + (parseFloat(p.market_value) || 0), 0);
        const totalAllowed = startEquity * MAX_TOTAL_STOCK_EXPOSURE;

        if (currentStockExposure + maxEquity <= totalAllowed) {
          const qty = Math.floor(maxEquity / analysis.lastClose);
          if (qty > 0) {
            try {
              const order = await placeOrder(symbol, qty, 'buy');
              orders.push({
                symbol,
                side: 'BUY',
                qty,
                price: analysis.lastClose,
                status: 'placed'
              });
              totalTradeValue += qty * analysis.lastClose;
              console.log(`BUY ${qty} ${symbol} @ $${analysis.lastClose.toFixed(2)}`);
            } catch (error) {
              console.error(`Buy order failed for ${symbol}:`, error.message);
            }
          }
        }
      }

      // SELL signal
      if (analysis.sellSignal && existingPos) {
        try {
          await closePosition(symbol);
          orders.push({
            symbol,
            side: 'SELL',
            qty: existingPos.qty,
            price: analysis.lastClose,
            status: 'closed'
          });
          console.log(`SELL ${existingPos.qty} ${symbol} @ $${analysis.lastClose.toFixed(2)}`);
        } catch (error) {
          console.error(`Sell order failed for ${symbol}:`, error.message);
        }
      }

      // Trailing stop-loss
      if (existingPos) {
        const entryPrice = parseFloat(existingPos.avg_entry_price);
        const currentPrice = analysis.lastClose;
        const pnlPercent = (currentPrice - entryPrice) / entryPrice;

        if (pnlPercent < TRAILING_STOP_LOSS) {
          try {
            await closePosition(symbol);
            orders.push({
              symbol,
              side: 'SELL (SL)',
              qty: existingPos.qty,
              price: currentPrice,
              reason: `Trailing SL: ${(pnlPercent * 100).toFixed(2)}%`
            });
            console.log(`SELL ${existingPos.qty} ${symbol} (trailing SL) @ $${currentPrice.toFixed(2)}`);
          } catch (error) {
            console.error(`Stop-loss sell failed for ${symbol}:`, error.message);
          }
        }
      }
    }

    // Build telegram report (structured format)
    const now = new Date();
    const timeStr = now.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false });
    let report = `📊 *DI금융 자동매매 리포트*\n`;
    report += `━━━━━━━━━━━━━━━━━━\n`;
    report += `🕐 ${timeStr} (KST)\n`;
    report += `💰 총 자산: $${startEquity.toLocaleString('en-US', { minimumFractionDigits: 2 })}\n`;
    report += `💵 현금: $${startCash.toLocaleString('en-US', { minimumFractionDigits: 2 })}\n\n`;

    // Portfolio positions summary
    if (positions.length > 0) {
      report += `📋 *보유 포지션 (${positions.length}종목)*\n`;
      let totalPnL = 0;
      positions.forEach(pos => {
        const mv = parseFloat(pos.market_value) || 0;
        const entry = parseFloat(pos.avg_entry_price) || 0;
        const cur = parseFloat(pos.current_price) || entry;
        const pnl = parseFloat(pos.unrealized_pl) || 0;
        const pnlPct = entry > 0 ? ((cur - entry) / entry * 100) : 0;
        totalPnL += pnl;
        const pnlEmoji = pnl >= 0 ? '📈' : '📉';
        report += `  ${pnlEmoji} ${pos.symbol}: ${pos.qty}주 @ $${cur.toFixed(2)} (${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(1)}%)\n`;
      });
      report += `  💎 총 미실현 P/L: $${totalPnL >= 0 ? '+' : ''}${totalPnL.toFixed(2)}\n\n`;
    }

    // Trading signals
    if (signals.length > 0) {
      const buySignals = signals.filter(s => s.buySignal);
      const sellSignals = signals.filter(s => s.sellSignal);
      const holdSignals = signals.filter(s => !s.buySignal && !s.sellSignal);

      report += `🔍 *시그널 분석 (${signals.length}종목)*\n`;
      if (buySignals.length > 0) {
        report += `\n  🟢 *매수 신호 (${buySignals.length})*\n`;
        buySignals.forEach(sig => {
          const adxStr = sig.lastADX ? ` ADX:${sig.lastADX.toFixed(0)}` : '';
          const pattern = sig.candlePattern ? ` 🕯${sig.candlePattern}` : '';
          report += `    ✅ ${sig.symbol} $${sig.lastClose.toFixed(2)}\n`;
          report += `       RSI:${sig.lastRSI.toFixed(0)} MACD:${(sig.lastMACD - sig.lastSignal).toFixed(3)}${adxStr}${pattern}\n`;
          report += `       점수: Buy ${sig.buyScore} (${sig.buyFactors}팩터)\n`;
        });
      }
      if (sellSignals.length > 0) {
        report += `\n  🔴 *매도 신호 (${sellSignals.length})*\n`;
        sellSignals.forEach(sig => {
          const pattern = sig.candlePattern ? ` 🕯${sig.candlePattern}` : '';
          report += `    ⛔ ${sig.symbol} $${sig.lastClose.toFixed(2)}\n`;
          report += `       RSI:${sig.lastRSI.toFixed(0)} MACD:${(sig.lastMACD - sig.lastSignal).toFixed(3)}${pattern}\n`;
          report += `       점수: Sell ${sig.sellScore} (${sig.sellFactors}팩터)\n`;
        });
      }
      if (holdSignals.length > 0) {
        report += `\n  ⚪ *관망 (${holdSignals.length})*: `;
        report += holdSignals.map(s => `${s.symbol}(RSI:${s.lastRSI.toFixed(0)})`).join(', ') + '\n';
      }
    }

    // Orders executed
    if (orders.length > 0) {
      report += `\n⚡ *체결 주문 (${orders.length}건)*\n`;
      report += `━━━━━━━━━━━━━━━━━━\n`;
      orders.forEach(ord => {
        const emoji = ord.side === 'BUY' ? '🟢' : ord.side.includes('SL') ? '🛑' : '🔴';
        report += `  ${emoji} ${ord.symbol} ${ord.side}: ${ord.qty}주 @ $${ord.price.toFixed(2)}`;
        if (ord.reason) report += ` (${ord.reason})`;
        report += '\n';
      });
      report += `\n  💸 총 거래금액: $${totalTradeValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}\n`;
    } else {
      report += `\n✋ 오늘 체결 주문 없음\n`;
    }

    report += `\n━━━━━━━━━━━━━━━━━━\n`;
    report += `🤖 DI금융 Auto-Trading v2`;

    await sendTelegramReport('Stock Auto-Trading', report);

    return res.status(200).json({
      success: true,
      timestamp: new Date().toISOString(),
      signals: signals.length,
      orders: orders.length,
      totalTradeValue: totalTradeValue.toFixed(2)
    });
  } catch (error) {
    console.error('Cron error:', error);

    await sendTelegramReport('⚠️ Stock Auto-Trading Error', `\`\`\`${error.message}\`\`\``);

    return res.status(500).json({
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
}
