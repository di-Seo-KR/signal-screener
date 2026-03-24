// Vercel Cron — 퀀트 전략 연구 엔진 (서버사이드)
// 매일 자동 실행: 전략 백테스트 → 성과 분석 → 최적 파라미터 탐색 → 결과 저장 + 텔레그램 리포트
// 환경변수: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID

const STRATEGIES = [
  { name: "RSI Reversal", fn: strategyRSI, paramSets: [
    { period: 14, buyTh: 30, sellTh: 70 },
    { period: 10, buyTh: 25, sellTh: 75 },
    { period: 14, buyTh: 25, sellTh: 75 },
    { period: 21, buyTh: 35, sellTh: 65 },
  ]},
  { name: "MACD Crossover", fn: strategyMACD, paramSets: [
    { fast: 12, slow: 26, sig: 9 },
    { fast: 8, slow: 21, sig: 5 },
    { fast: 12, slow: 26, sig: 5 },
  ]},
  { name: "BB Bounce", fn: strategyBB, paramSets: [
    { period: 20, mult: 2 },
    { period: 20, mult: 2.5 },
    { period: 30, mult: 2 },
  ]},
  { name: "BTC Alpha", fn: strategyBTCAlpha, paramSets: [
    { rsiPeriod: 14, bbMult: 2.5, emaFast: 21, emaSlow: 55, cooldown: 3 },
    { rsiPeriod: 10, bbMult: 2.0, emaFast: 13, emaSlow: 34, cooldown: 2 },
    { rsiPeriod: 14, bbMult: 3.0, emaFast: 21, emaSlow: 55, cooldown: 5 },
  ]},
  { name: "Triple MA", fn: strategyTripleMA, paramSets: [
    { fast: 10, mid: 20, slow: 50 },
    { fast: 5, mid: 13, slow: 34 },
    { fast: 8, mid: 21, slow: 55 },
  ]},
  { name: "Supertrend", fn: strategySupertrend, paramSets: [
    { atrPeriod: 10, mult: 3 },
    { atrPeriod: 14, mult: 2.5 },
    { atrPeriod: 10, mult: 2 },
  ]},
];

// 백테스트할 종목
const SYMBOLS = [
  { sym: "BTC-USD", name: "비트코인", type: "crypto" },
  { sym: "AAPL", name: "애플", type: "stock" },
  { sym: "NVDA", name: "엔비디아", type: "stock" },
  { sym: "TSLA", name: "테슬라", type: "stock" },
  { sym: "SPY", name: "S&P 500", type: "etf" },
  { sym: "QQQ", name: "나스닥 100", type: "etf" },
];

export default async function handler(req, res) {
  const startTime = Date.now();
  const log = [];
  const addLog = (msg) => { log.push(msg); console.log(msg); };

  try {
    addLog("🔬 퀀트 전략 연구 Cron 시작");

    const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const TG_CHAT = process.env.TELEGRAM_CHAT_ID;

    const allResults = [];

    // ── 각 종목별 데이터 로드 & 전략 백테스트 ──
    for (const sym of SYMBOLS) {
      addLog(`📊 ${sym.name} (${sym.sym}) 데이터 로딩...`);
      const candles = await fetchYahooCandles(sym.sym);
      if (!candles || candles.length < 100) {
        addLog(`⚠️ ${sym.sym}: 데이터 부족 (${candles?.length || 0}개)`);
        continue;
      }
      addLog(`✅ ${sym.sym}: ${candles.length}개 캔들`);

      // 각 전략 × 파라미터 조합 테스트
      for (const strat of STRATEGIES) {
        // BTC Alpha는 크립토만
        if (strat.name === "BTC Alpha" && sym.type !== "crypto") continue;

        for (const params of strat.paramSets) {
          try {
            const signals = strat.fn(candles, params);
            if (!signals || signals.length === 0) continue;

            const bt = runBacktest(candles, signals, {
              initialCapital: 10000,
              positionSize: 0.7,
              commission: sym.type === "crypto" ? 0.001 : 0.0005,
              slippage: sym.type === "crypto" ? 0.001 : 0.0003,
            });

            allResults.push({
              symbol: sym.sym,
              symbolName: sym.name,
              strategy: strat.name,
              params: JSON.stringify(params),
              signals: signals.length,
              totalReturn: bt.totalReturn,
              sharpeRatio: bt.sharpeRatio,
              maxDrawdown: bt.maxDrawdown,
              winRate: bt.winRate,
              profitFactor: bt.profitFactor,
              trades: bt.totalTrades,
              sortino: bt.sortinoRatio || 0,
            });
          } catch (e) {
            // 개별 전략 에러는 무시
          }
        }
      }
    }

    addLog(`\n📈 총 ${allResults.length}개 백테스트 완료`);

    // ── 결과 분석 ──
    // 1) 종목별 최고 전략
    const bestBySymbol = {};
    for (const r of allResults) {
      if (!bestBySymbol[r.symbol] || r.sharpeRatio > bestBySymbol[r.symbol].sharpeRatio) {
        bestBySymbol[r.symbol] = r;
      }
    }

    // 2) 전략별 평균 성과
    const stratPerf = {};
    for (const r of allResults) {
      if (!stratPerf[r.strategy]) stratPerf[r.strategy] = { returns: [], sharpes: [], winRates: [], count: 0 };
      stratPerf[r.strategy].returns.push(r.totalReturn || 0);
      stratPerf[r.strategy].sharpes.push(r.sharpeRatio || 0);
      stratPerf[r.strategy].winRates.push(r.winRate || 0);
      stratPerf[r.strategy].count++;
    }

    // 3) 전체 랭킹 (Sharpe 기준)
    const topResults = [...allResults].sort((a, b) => (b.sharpeRatio || 0) - (a.sharpeRatio || 0)).slice(0, 10);

    // ── 텔레그램 리포트 ──
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    const date = new Date().toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" });

    let tgMsg = `🔬 퀀트 전략 연구 리포트\n📅 ${date}\n\n`;
    tgMsg += `📊 ${allResults.length}개 백테스트 실행 (${SYMBOLS.length}종목 × ${STRATEGIES.length}전략)\n\n`;

    // Top 5 전략
    tgMsg += `🏆 Top 5 (Sharpe Ratio 기준)\n`;
    topResults.slice(0, 5).forEach((r, i) => {
      tgMsg += `${i + 1}. ${r.symbolName} × ${r.strategy}\n`;
      tgMsg += `   수익: ${(r.totalReturn || 0).toFixed(1)}% | Sharpe: ${(r.sharpeRatio || 0).toFixed(2)} | 승률: ${(r.winRate || 0).toFixed(0)}% | MDD: ${(r.maxDrawdown || 0).toFixed(1)}%\n`;
    });

    // 종목별 최적 전략
    tgMsg += `\n📋 종목별 최적 전략\n`;
    for (const [sym, r] of Object.entries(bestBySymbol)) {
      tgMsg += `${r.symbolName}: ${r.strategy} (Sharpe ${(r.sharpeRatio || 0).toFixed(2)}, 수익 ${(r.totalReturn || 0).toFixed(1)}%)\n`;
    }

    // 전략별 평균 성과
    tgMsg += `\n📈 전략별 평균 Sharpe\n`;
    const stratRank = Object.entries(stratPerf).map(([name, data]) => ({
      name,
      avgSharpe: data.sharpes.reduce((a, b) => a + b, 0) / data.sharpes.length,
      avgReturn: data.returns.reduce((a, b) => a + b, 0) / data.returns.length,
      count: data.count,
    })).sort((a, b) => b.avgSharpe - a.avgSharpe);

    stratRank.forEach(s => {
      tgMsg += `${s.name}: ${s.avgSharpe.toFixed(2)} (평균 수익 ${s.avgReturn.toFixed(1)}%, ${s.count}회)\n`;
    });

    tgMsg += `\n⏱️ ${duration}s`;

    await sendTelegram(TG_TOKEN, TG_CHAT, tgMsg);
    addLog(`📨 텔레그램 리포트 전송 완료`);

    return res.status(200).json({
      ok: true,
      summary: {
        totalTests: allResults.length,
        top5: topResults.slice(0, 5).map(r => ({
          symbol: r.symbol, strategy: r.strategy,
          return: r.totalReturn, sharpe: r.sharpeRatio, winRate: r.winRate,
        })),
        bestBySymbol: Object.fromEntries(
          Object.entries(bestBySymbol).map(([k, v]) => [k, { strategy: v.strategy, sharpe: v.sharpeRatio, return: v.totalReturn }])
        ),
        strategyRanking: stratRank,
      },
      duration: `${duration}s`,
      log,
    });

  } catch (e) {
    addLog(`💥 에러: ${e.message}`);
    return res.status(200).json({ ok: false, error: e.message, log });
  }
}

// ════════════════════════════════════════════════════════
// Yahoo Finance 캔들 로더
// ════════════════════════════════════════════════════════
async function fetchYahooCandles(symbol) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1y&interval=1d`;
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (DI-Quant Research)" } });
    const data = await r.json();
    const result = data?.chart?.result?.[0];
    if (!result?.timestamp) return [];
    const q = result.indicators.quote[0];
    return result.timestamp.map((t, i) => ({
      time: t, open: q.open[i], high: q.high[i], low: q.low[i], close: q.close[i], volume: q.volume[i],
    })).filter(c => c.close != null && c.high != null);
  } catch { return []; }
}

// ════════════════════════════════════════════════════════
// 백테스트 엔진
// ════════════════════════════════════════════════════════
function runBacktest(candles, signals, opts = {}) {
  const { initialCapital = 10000, positionSize = 0.7, commission = 0.001, slippage = 0.001, stopLoss, takeProfit } = opts;
  let capital = initialCapital;
  let position = null;
  let peak = capital;
  let maxDD = 0;
  const trades = [];
  const equityCurve = [capital];

  for (const sig of signals) {
    const price = sig.price || candles[sig.index]?.close;
    if (!price) continue;
    const slippageAdj = price * slippage;

    if (sig.type === "BUY" && !position) {
      const investAmount = capital * positionSize;
      const buyPrice = price + slippageAdj;
      const shares = investAmount / buyPrice;
      const comm = investAmount * commission;
      capital -= investAmount + comm;
      position = { buyPrice, shares, index: sig.index };
    } else if (sig.type === "SELL" && position) {
      const sellPrice = price - slippageAdj;
      const proceeds = position.shares * sellPrice;
      const comm = proceeds * commission;
      capital += proceeds - comm;
      const pnl = ((sellPrice - position.buyPrice) / position.buyPrice) * 100;
      trades.push({ pnl, buyPrice: position.buyPrice, sellPrice, holdBars: sig.index - position.index });
      position = null;
    }

    const equity = capital + (position ? position.shares * price : 0);
    equityCurve.push(equity);
    if (equity > peak) peak = equity;
    const dd = peak > 0 ? ((peak - equity) / peak) * 100 : 0;
    if (dd > maxDD) maxDD = dd;
  }

  // 미청산 포지션 정리
  if (position) {
    const lastPrice = candles[candles.length - 1].close;
    capital += position.shares * lastPrice;
    trades.push({
      pnl: ((lastPrice - position.buyPrice) / position.buyPrice) * 100,
      buyPrice: position.buyPrice, sellPrice: lastPrice,
      holdBars: candles.length - 1 - position.index,
    });
  }

  const totalReturn = ((capital - initialCapital) / initialCapital) * 100;
  const wins = trades.filter(t => t.pnl > 0);
  const losses = trades.filter(t => t.pnl <= 0);
  const winRate = trades.length > 0 ? (wins.length / trades.length) * 100 : 0;
  const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((s, t) => s + t.pnl, 0) / losses.length) : 1;
  const profitFactor = avgLoss > 0 ? avgWin / avgLoss : avgWin;

  // Sharpe Ratio (annualized)
  const returns = [];
  for (let i = 1; i < equityCurve.length; i++) {
    returns.push((equityCurve[i] - equityCurve[i - 1]) / equityCurve[i - 1]);
  }
  const avgReturn = returns.length > 0 ? returns.reduce((s, r) => s + r, 0) / returns.length : 0;
  const stdReturn = returns.length > 1
    ? Math.sqrt(returns.reduce((s, r) => s + (r - avgReturn) ** 2, 0) / (returns.length - 1)) : 1;
  const sharpeRatio = stdReturn > 0 ? (avgReturn / stdReturn) * Math.sqrt(252) : 0;

  // Sortino Ratio
  const downside = returns.filter(r => r < 0);
  const downsideStd = downside.length > 1
    ? Math.sqrt(downside.reduce((s, r) => s + r ** 2, 0) / downside.length) : 1;
  const sortinoRatio = downsideStd > 0 ? (avgReturn / downsideStd) * Math.sqrt(252) : 0;

  return {
    totalReturn, sharpeRatio, sortinoRatio, maxDrawdown: maxDD,
    winRate, profitFactor, totalTrades: trades.length,
    avgWin, avgLoss, trades,
  };
}

// ════════════════════════════════════════════════════════
// 전략 함수들 (서버사이드)
// ════════════════════════════════════════════════════════

function strategyRSI(candles, params = {}) {
  const { period = 14, buyTh = 30, sellTh = 70 } = params;
  const closes = candles.map(c => c.close);
  const rsi = calcRSI(closes, period);
  const signals = [];
  for (let i = period + 1; i < candles.length; i++) {
    if (rsi[i] == null || rsi[i - 1] == null) continue;
    if (rsi[i] > buyTh && rsi[i - 1] <= buyTh)
      signals.push({ index: i, type: "BUY", price: closes[i], reason: `RSI ${rsi[i].toFixed(1)}` });
    else if (rsi[i] < sellTh && rsi[i - 1] >= sellTh)
      signals.push({ index: i, type: "SELL", price: closes[i], reason: `RSI ${rsi[i].toFixed(1)}` });
  }
  return signals;
}

function strategyMACD(candles, params = {}) {
  const { fast = 12, slow = 26, sig = 9 } = params;
  const closes = candles.map(c => c.close);
  const { macdLine, signal, histogram } = calcMACD(closes, fast, slow, sig);
  const signals = [];
  for (let i = slow + sig + 1; i < candles.length; i++) {
    if (macdLine[i] == null || signal[i] == null) continue;
    if (macdLine[i] > signal[i] && macdLine[i - 1] <= signal[i - 1])
      signals.push({ index: i, type: "BUY", price: closes[i], reason: "MACD 골든크로스" });
    else if (macdLine[i] < signal[i] && macdLine[i - 1] >= signal[i - 1])
      signals.push({ index: i, type: "SELL", price: closes[i], reason: "MACD 데드크로스" });
  }
  return signals;
}

function strategyBB(candles, params = {}) {
  const { period = 20, mult = 2 } = params;
  const closes = candles.map(c => c.close);
  const bb = calcBB(closes, period, mult);
  const signals = [];
  for (let i = period + 1; i < candles.length; i++) {
    if (!bb[i] || !bb[i - 1]) continue;
    if (closes[i - 1] <= bb[i - 1].lower && closes[i] > bb[i].lower)
      signals.push({ index: i, type: "BUY", price: closes[i], reason: "BB 하단 반등" });
    else if (closes[i - 1] >= bb[i - 1].upper && closes[i] < bb[i].upper)
      signals.push({ index: i, type: "SELL", price: closes[i], reason: "BB 상단 거부" });
  }
  return signals;
}

function strategyTripleMA(candles, params = {}) {
  const { fast = 10, mid = 20, slow = 50 } = params;
  const closes = candles.map(c => c.close);
  const emaF = calcEMA(closes, fast);
  const emaM = calcEMA(closes, mid);
  const emaS = calcEMA(closes, slow);
  const signals = [];
  for (let i = slow + 1; i < candles.length; i++) {
    if (emaF[i] == null || emaM[i] == null || emaS[i] == null) continue;
    const aligned = emaF[i] > emaM[i] && emaM[i] > emaS[i];
    const prevAligned = emaF[i - 1] > emaM[i - 1] && emaM[i - 1] > emaS[i - 1];
    const invAligned = emaF[i] < emaM[i] && emaM[i] < emaS[i];
    const prevInvAligned = emaF[i - 1] < emaM[i - 1] && emaM[i - 1] < emaS[i - 1];
    if (aligned && !prevAligned)
      signals.push({ index: i, type: "BUY", price: closes[i], reason: "Triple MA 정배열" });
    else if (invAligned && !prevInvAligned)
      signals.push({ index: i, type: "SELL", price: closes[i], reason: "Triple MA 역배열" });
  }
  return signals;
}

function strategySupertrend(candles, params = {}) {
  const { atrPeriod = 10, mult = 3 } = params;
  const closes = candles.map(c => c.close);
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  const atr = calcATR(highs, lows, closes, atrPeriod);
  const signals = [];
  let trend = 1; // 1=up, -1=down
  let upperBand = 0, lowerBand = 0;
  for (let i = atrPeriod; i < candles.length; i++) {
    if (atr[i] == null) continue;
    const mid = (highs[i] + lows[i]) / 2;
    const newUpper = mid + mult * atr[i];
    const newLower = mid - mult * atr[i];
    upperBand = (newUpper < upperBand || closes[i - 1] > upperBand) ? newUpper : upperBand;
    lowerBand = (newLower > lowerBand || closes[i - 1] < lowerBand) ? newLower : lowerBand;
    const prevTrend = trend;
    if (closes[i] > upperBand) trend = 1;
    else if (closes[i] < lowerBand) trend = -1;
    if (trend === 1 && prevTrend === -1)
      signals.push({ index: i, type: "BUY", price: closes[i], reason: "Supertrend 상방전환" });
    else if (trend === -1 && prevTrend === 1)
      signals.push({ index: i, type: "SELL", price: closes[i], reason: "Supertrend 하방전환" });
  }
  return signals;
}

function strategyBTCAlpha(candles, params = {}) {
  const {
    rsiPeriod = 14, bbMult = 2.5, emaFast = 21, emaSlow = 55,
    cooldown = 3, emaLong = 200, volSurge = 1.8,
  } = params;
  if (candles.length < Math.max(emaLong, 60) + 10) return [];

  const closes = candles.map(c => c.close);
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  const volumes = candles.map(c => c.volume || 0);
  const rsi = calcRSI(closes, rsiPeriod);
  const bb = calcBB(closes, 20, bbMult);
  const ema21 = calcEMA(closes, emaFast);
  const ema55 = calcEMA(closes, emaSlow);
  const ema200 = calcEMA(closes, emaLong);
  const { macdLine, signal: macdSig, histogram } = calcMACD(closes);
  const atr = calcATR(highs, lows, closes, 14);
  const obv = calcOBV(closes, volumes);
  const obvEma = calcEMA(obv, 20);
  const volSMA = calcSMA(volumes, 20);

  const signals = [];
  let lastSig = -999;
  const minIdx = Math.max(emaLong, 55, 30);

  for (let i = minIdx; i < candles.length; i++) {
    if (rsi[i] == null || !bb[i] || histogram[i] == null) continue;
    if (i - lastSig < cooldown) continue;
    const price = closes[i], prev = closes[i - 1];
    const atrPct = atr[i] && price > 0 ? (atr[i] / price) * 100 : 2;
    const rsiBuyTh = atrPct > 5 ? 20 : atrPct > 3 ? 25 : 28;
    const rsiSellTh = atrPct > 5 ? 80 : atrPct > 3 ? 75 : 72;

    let buyS = 0, buyF = 0, sellS = 0, sellF = 0;
    const buyR = [], sellR = [];

    // Buy factors
    if (rsi[i] > rsiBuyTh && rsi[i - 1] <= rsiBuyTh) { buyS += 3; buyF++; buyR.push("RSI 탈출"); }
    if (prev <= (bb[i - 1]?.lower || 0) && price > bb[i].lower) { buyS += 2; buyF++; buyR.push("BB 반등"); }
    if (volSMA[i] > 0 && volumes[i] >= volSMA[i] * volSurge && price > prev) { buyS += 2; buyF++; buyR.push("Vol 서지"); }
    if (obv[i] > obvEma[i] && obv[i - 1] <= obvEma[i - 1]) { buyS += 2; buyF++; buyR.push("OBV 유입"); }
    if (macdLine[i] > macdSig[i] && macdLine[i - 1] <= macdSig[i - 1]) { buyS += 2; buyF++; buyR.push("MACD 골든"); }
    if (ema21[i] > ema55[i] && ema21[i - 1] <= ema55[i - 1]) { buyS += 3; buyF++; buyR.push("EMA 크로스"); }
    else if (ema21[i] > ema55[i]) buyS += 1;
    if (price > ema200[i]) buyS += 1;

    if (buyS >= 5 && buyF >= 3) {
      lastSig = i;
      signals.push({ index: i, type: "BUY", price, reason: buyR.join("+"), confidence: buyS >= 9 ? "A" : buyS >= 7 ? "B" : "C" });
      continue;
    }

    // Sell factors
    if (rsi[i] < rsiSellTh && rsi[i - 1] >= rsiSellTh) { sellS += 3; sellF++; sellR.push("RSI 과매수"); }
    if (prev >= (bb[i - 1]?.upper || Infinity) && price < bb[i].upper) { sellS += 2; sellF++; sellR.push("BB 거부"); }
    if (macdLine[i] < macdSig[i] && macdLine[i - 1] >= macdSig[i - 1]) { sellS += 2; sellF++; sellR.push("MACD 데드"); }
    if (ema21[i] < ema55[i] && ema21[i - 1] >= ema55[i - 1]) { sellS += 3; sellF++; sellR.push("EMA 데드"); }
    else if (ema21[i] < ema55[i]) sellS += 1;
    if (obv[i] < obvEma[i] && obv[i - 1] >= obvEma[i - 1]) { sellS += 2; sellF++; sellR.push("OBV 이탈"); }
    if (price < ema200[i]) sellS += 1;

    if (sellS >= 5 && sellF >= 3) {
      lastSig = i;
      signals.push({ index: i, type: "SELL", price, reason: sellR.join("+"), confidence: sellS >= 9 ? "A" : sellS >= 7 ? "B" : "C" });
    }
  }
  return signals;
}

// ════════════════════════════════════════════════════════
// 텔레그램
// ════════════════════════════════════════════════════════
async function sendTelegram(token, chatId, text) {
  if (!token || !chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
    });
  } catch (e) { console.error("TG error:", e.message); }
}

// ════════════════════════════════════════════════════════
// 기술 지표 (동일 라이브러리)
// ════════════════════════════════════════════════════════

function calcSMA(data, period) {
  const result = new Array(data.length).fill(null);
  for (let i = period - 1; i < data.length; i++) {
    let sum = 0; for (let j = 0; j < period; j++) sum += data[i - j];
    result[i] = sum / period;
  } return result;
}

function calcEMA(data, period) {
  const result = new Array(data.length).fill(null);
  const k = 2 / (period + 1);
  let start = -1;
  for (let i = 0; i < data.length; i++) { if (data[i] != null) { start = i; break; } }
  if (start < 0 || data.length - start < period) return result;
  let sum = 0;
  for (let i = start; i < start + period; i++) sum += data[i];
  result[start + period - 1] = sum / period;
  for (let i = start + period; i < data.length; i++) result[i] = data[i] * k + result[i - 1] * (1 - k);
  return result;
}

function calcRSI(closes, period = 14) {
  const result = new Array(closes.length).fill(null);
  if (closes.length < period + 1) return result;
  let gSum = 0, lSum = 0;
  for (let i = 1; i <= period; i++) { const d = closes[i] - closes[i - 1]; if (d > 0) gSum += d; else lSum -= d; }
  let ag = gSum / period, al = lSum / period;
  result[period] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    ag = (ag * (period - 1) + (d > 0 ? d : 0)) / period;
    al = (al * (period - 1) + (d < 0 ? -d : 0)) / period;
    result[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  } return result;
}

function calcBB(closes, period = 20, mult = 2) {
  const result = new Array(closes.length).fill(null);
  const sma = calcSMA(closes, period);
  for (let i = period - 1; i < closes.length; i++) {
    if (sma[i] == null) continue;
    let sq = 0; for (let j = 0; j < period; j++) sq += (closes[i - j] - sma[i]) ** 2;
    const std = Math.sqrt(sq / period);
    const u = sma[i] + std * mult, l = sma[i] - std * mult;
    result[i] = { middle: sma[i], upper: u, lower: l, bw: sma[i] > 0 ? (u - l) / sma[i] : 0 };
  } return result;
}

function calcMACD(closes, fast = 12, slow = 26, sig = 9) {
  const ef = calcEMA(closes, fast), es = calcEMA(closes, slow);
  const ml = closes.map((_, i) => (ef[i] != null && es[i] != null) ? ef[i] - es[i] : null);
  const signal = calcEMA(ml.map(v => v ?? 0), sig);
  const histogram = closes.map((_, i) => (ml[i] != null && signal[i] != null) ? ml[i] - signal[i] : null);
  return { macdLine: ml, signal, histogram };
}

function calcATR(highs, lows, closes, period = 14) {
  const tr = [highs[0] - lows[0]];
  for (let i = 1; i < closes.length; i++)
    tr.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
  return calcEMA(tr, period);
}

function calcOBV(closes, volumes) {
  const obv = [0];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i] > closes[i - 1]) obv.push(obv[i - 1] + (volumes[i] || 0));
    else if (closes[i] < closes[i - 1]) obv.push(obv[i - 1] - (volumes[i] || 0));
    else obv.push(obv[i - 1]);
  } return obv;
}
