// Stock Auto-Trading Cron Engine for Vercel
// 장중 30분 간격 실행: 실시간 시장 감시 + 알파 전략 기반 자동매매
// KV 가상 포트폴리오 매매
// Yahoo Finance 가격 기반 가상매매
// 텔레그램 알림: api/_shared/telegram.js 의 buildCard/sendCards (사용자 친화 평어)

export const config = { maxDuration: 120 };

import fetch from 'node-fetch';
import { sendCards, buildCard } from "./_shared/telegram.js";

const YAHOO_FINANCE_URL = 'https://query1.finance.yahoo.com/v8/finance/chart';

const WATCHLIST = ['AAPL', 'MSFT', 'NVDA', 'GOOG', 'AMZN', 'META', 'TSLA', 'AMD', 'AVGO', 'CRM'];
const MAX_EQUITY_PER_STOCK = 0.15;
const MAX_TOTAL_STOCK_EXPOSURE = 0.80;
const TRAILING_STOP_LOSS = -0.04;

// ── 주식 봇별 자산 매핑 (btc-cron 의 BOT_ASSET_MAP 패턴) ──
// ★ 2026-05-09: 이전엔 자산-봇 매핑 없이 모든 활성 주식 봇에 동일 주문이 누적되어
//   활성 봇 N개면 한 거래가 tradeCount/winCount/realizedPL 모두 N번 카운트됐다.
//   각 봇의 성격(블루칩/모멘텀/회귀)에 따라 자산을 나눠 다중 카운트를 통제한다.
const STOCK_BOT_ASSET_MAP = {
  "stable-quant":     ['AAPL', 'MSFT', 'GOOG', 'AMZN', 'AVGO'],          // 블루칩만
  "balanced-quant":   WATCHLIST,                                          // 전체 (앙상블 균형)
  "aggressive-quant": ['NVDA', 'TSLA', 'AMD', 'META', 'AVGO', 'CRM'],     // 고변동
  "trend-follow":     ['NVDA', 'TSLA', 'AMD', 'META', 'AVGO'],            // 모멘텀
  "mean-reversion":   ['AAPL', 'MSFT', 'GOOG', 'AMZN', 'CRM'],            // 안정/회귀
  "ensemble-signal":  WATCHLIST,                                          // 전체 (가장 보수적, 합의)
};

// 자산 → 해당 자산을 다루는 주식 봇 목록 (활성 봇 중)
function getStockBotsForAsset(symbol, activeBotIds) {
  return Object.entries(STOCK_BOT_ASSET_MAP)
    .filter(([botId, assets]) => activeBotIds.includes(botId) && assets.includes(symbol))
    .map(([botId]) => botId);
}

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

// ── Hurst 지수 계산 (R/S 분석) ──
function calcHurst(data) {
  const n = data.length;
  if (n < 20) return 0.5;
  const logReturns = [];
  for (let i = 1; i < n; i++) logReturns.push(Math.log(data[i] / data[i - 1]));
  const mean = logReturns.reduce((a, b) => a + b, 0) / logReturns.length;
  const deviations = logReturns.map(r => r - mean);
  const cumDev = []; let cum = 0;
  for (const d of deviations) { cum += d; cumDev.push(cum); }
  const R = Math.max(...cumDev) - Math.min(...cumDev);
  const S = Math.sqrt(deviations.reduce((a, b) => a + b * b, 0) / deviations.length);
  if (S === 0) return 0.5;
  return Math.log(R / S) / Math.log(n);
}

// ── Kaufman 효율성 비율 ──
function calcEfficiencyRatio(closes, period = 10) {
  const er = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < period) { er.push(0); continue; }
    const direction = Math.abs(closes[i] - closes[i - period]);
    let volatility = 0;
    for (let j = 1; j <= period; j++) volatility += Math.abs(closes[i - j + 1] - closes[i - j]);
    er.push(volatility > 0 ? direction / volatility : 0);
  }
  return er;
}

function analyzeLatest(symbol, data, marketRegime = null, stockAlerts = []) {
  if (!data || data.close.length < 100) return null;

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
  const obvEma = calcEMA(obv, 20);
  const volSMA = calcSMA(volumes, 20);

  const candles = closes.map((c, i) => ({
    open: data.open[i], high: highs[i], low: lows[i], close: c
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
  const alphaReasons = [];

  // ═══════════════════════════════════════════════════════
  // LAYER 1: 독자 알파 전략 (시장 비효율성 포착)
  // ═══════════════════════════════════════════════════════

  // 1) Hurst 레짐 분석
  const hurst = calcHurst(closes.slice(-100));
  const isHurstTrending = hurst > 0.55;
  const isHurstMeanRev = hurst < 0.45;

  // 2) 효율성 비율 (추세 탄생/소멸 감지)
  const er = calcEfficiencyRatio(closes, 10);
  const curER = er[er.length - 1] || 0;
  const prevER = (er[er.length - 2] + er[er.length - 3] + er[er.length - 4]) / 3 || 0;
  const erSurge = curER > 0.6 && prevER < 0.4; // 추세 탄생
  const erCollapse = curER < 0.2 && prevER > 0.5; // 추세 소멸

  // 3) 변동성 군집 분석 (ATR 수축→폭발)
  const atrLongMA = calcSMA(atr.map(v => v || 0), 50);
  const atrRatio = atr[lastIdx] && atrLongMA[atrLongMA.length - 1] > 0
    ? atr[lastIdx] / atrLongMA[atrLongMA.length - 1] : 1;
  const volExpanding = atrRatio > 1.8;
  const volContracting = atrRatio < 0.5;

  // 4) 모멘텀 감쇠 분석
  const mom10 = closes.length > 10 ? ((lastClose - closes[lastIdx - 10]) / closes[lastIdx - 10]) * 100 : 0;
  const momPrev = closes.length > 11 ? ((closes[lastIdx - 1] - closes[lastIdx - 11]) / closes[lastIdx - 11]) * 100 : 0;
  const momDecaying = mom10 > 2 && mom10 < momPrev; // 상승 감속
  const momRecovering = mom10 < -2 && mom10 > momPrev; // 하락 감속

  // 5) 정보흐름 감지 (가격보합 + 거래량 급증)
  const priceFlatRange = Math.abs(lastClose - closes[lastIdx - 3]) / closes[lastIdx - 3] * 100;
  const volAvg = volSMA[volSMA.length - 1] || 1;
  const vol3barSurge = volumes[lastIdx] > volAvg * 2 && volumes[lastIdx - 1] > volAvg * 1.5 && volumes[lastIdx - 2] > volAvg * 1.5;
  const smartMoneyAccum = priceFlatRange < 1.5 && vol3barSurge && lastOBV > (obvEma[obvEma.length - 1] || 0);
  const smartMoneyDist = priceFlatRange < 1.5 && vol3barSurge && lastOBV < (obvEma[obvEma.length - 1] || 0);

  // ═══════════════════════════════════════════════════════
  // LAYER 2: 알파 시그널 스코어링
  // ═══════════════════════════════════════════════════════

  // Hurst 추세레짐 + 돌파
  if (isHurstTrending) {
    const high20 = Math.max(...highs.slice(-20));
    const low20 = Math.min(...lows.slice(-20));
    if (lastClose >= high20 * 0.99) {
      buyScore += 3; buyFactors++;
      alphaReasons.push(`Hurst${hurst.toFixed(2)} 추세레짐 고점돌파`);
    }
    if (lastClose <= low20 * 1.01) {
      sellScore += 3; sellFactors++;
      alphaReasons.push(`Hurst${hurst.toFixed(2)} 추세레짐 저점이탈`);
    }
  }

  // Hurst 회귀레짐 + RSI 역추세
  if (isHurstMeanRev) {
    if (lastRSI < 35 && lastRSI > rsi[rsi.length - 2]) {
      buyScore += 3; buyFactors++;
      alphaReasons.push(`Hurst${hurst.toFixed(2)} 회귀레짐 RSI반등`);
    }
    if (lastRSI > 65 && lastRSI < rsi[rsi.length - 2]) {
      sellScore += 3; sellFactors++;
      alphaReasons.push(`Hurst${hurst.toFixed(2)} 회귀레짐 RSI하락`);
    }
  }

  // 효율성 비율 추세 탄생
  if (erSurge) {
    const dir = lastClose > closes[lastIdx - 10] ? 'buy' : 'sell';
    if (dir === 'buy') { buyScore += 3; buyFactors++; alphaReasons.push(`ER ${curER.toFixed(2)} 추세탄생↑`); }
    else { sellScore += 3; sellFactors++; alphaReasons.push(`ER ${curER.toFixed(2)} 추세탄생↓`); }
  }
  if (erCollapse) {
    const dir = lastClose > closes[lastIdx - 3] ? 'sell' : 'buy';
    if (dir === 'buy') { buyScore += 1; buyFactors++; alphaReasons.push(`ER 추세소멸 반전매수`); }
    else { sellScore += 1; sellFactors++; alphaReasons.push(`ER 추세소멸 이탈매도`); }
  }

  // 변동성 군집 돌파
  if (volExpanding && lastClose > closes[lastIdx - 1]) {
    buyScore += 2; buyFactors++;
    alphaReasons.push(`ATR폭발 ${atrRatio.toFixed(1)}x 상방`);
  } else if (volExpanding && lastClose < closes[lastIdx - 1]) {
    sellScore += 2; sellFactors++;
    alphaReasons.push(`ATR폭발 ${atrRatio.toFixed(1)}x 하방`);
  }

  // 모멘텀 감쇠 (선행 반전 포착)
  if (momDecaying && lastRSI > 60) {
    sellScore += 2; sellFactors++;
    alphaReasons.push(`모멘텀감쇠 ${mom10.toFixed(1)}%↘`);
  }
  if (momRecovering && lastRSI < 40) {
    buyScore += 2; buyFactors++;
    alphaReasons.push(`하락감쇠 ${mom10.toFixed(1)}%↗`);
  }

  // 스마트머니 매집/분산
  if (smartMoneyAccum) {
    buyScore += 3; buyFactors++;
    alphaReasons.push(`스마트머니 매집 (가격보합+Vol급증+OBV↑)`);
  }
  if (smartMoneyDist) {
    sellScore += 3; sellFactors++;
    alphaReasons.push(`스마트머니 분산 (가격보합+Vol급증+OBV↓)`);
  }

  // ═══════════════════════════════════════════════════════
  // LAYER 3: 기존 지표 보조 확인 (가중치 축소)
  // ═══════════════════════════════════════════════════════

  // RSI (과매도/과매수 근접 영역도 포함)
  if (lastRSI < 25) { buyScore += 2; buyFactors++; }
  else if (lastRSI < 35 && lastRSI > rsi[rsi.length - 2]) { buyScore += 1; buyFactors++; }
  if (lastRSI > 75) { sellScore += 2; sellFactors++; }
  else if (lastRSI > 65 && lastRSI < rsi[rsi.length - 2]) { sellScore += 1; sellFactors++; }

  // MACD 크로스 또는 히스토그램 확대
  if (lastMACD > lastSignal && macdLine[macdLine.length - 2] <= signalLine[signalLine.length - 2]) {
    buyScore += 1; buyFactors++;
  } else if (histogram[histogram.length - 1] > 0 && histogram[histogram.length - 1] > histogram[histogram.length - 2]) {
    buyScore += 1;
  }
  if (lastMACD < lastSignal && macdLine[macdLine.length - 2] >= signalLine[signalLine.length - 2]) {
    sellScore += 1; sellFactors++;
  } else if (histogram[histogram.length - 1] < 0 && histogram[histogram.length - 1] < histogram[histogram.length - 2]) {
    sellScore += 1;
  }

  // EMA 정배열/역배열
  if (lastEMA21 > lastEMA55) { buyScore += 1; buyFactors++; }
  if (lastEMA21 < lastEMA55) { sellScore += 1; sellFactors++; }

  // BB 근접
  if (lastBB && lastClose <= lastBB.lower * 1.01) { buyScore += 1; buyFactors++; }
  if (lastBB && lastClose >= lastBB.upper * 0.99) { sellScore += 1; sellFactors++; }

  // 캔들 패턴
  if (candlePattern === 'bullish_engulfing') { buyScore += 1; buyFactors++; }
  if (candlePattern === 'bearish_engulfing') { sellScore += 1; sellFactors++; }

  // 다이버전스
  if (bullDivergence) { buyScore += 2; buyFactors++; alphaReasons.push('강세 다이버전스'); }
  if (bearDivergence) { sellScore += 2; sellFactors++; alphaReasons.push('약세 다이버전스'); }

  // ═══════════════════════════════════════════════════════
  // LAYER 4: market-monitor 실시간 알림 부스트
  // ═══════════════════════════════════════════════════════
  for (const alert of stockAlerts) {
    if (alert.type === "TREND_BIRTH") {
      if (lastClose > closes[closes.length - 2]) { buyScore += 2; buyFactors++; alphaReasons.push("모니터:추세탄생↑"); }
      else { sellScore += 2; sellFactors++; alphaReasons.push("모니터:추세탄생↓"); }
    }
    if (alert.type === "VOL_EXPLOSION") {
      if (lastClose > closes[closes.length - 2]) { buyScore += 1; alphaReasons.push("모니터:변동성폭발↑"); }
      else { sellScore += 1; alphaReasons.push("모니터:변동성폭발↓"); }
    }
    if (alert.type === "SMART_MONEY") {
      buyScore += 1; alphaReasons.push("모니터:스마트머니");
    }
  }

  // 레짐 기반 임계값 조정
  let buyTh = 3, sellTh = 3;
  if (marketRegime) {
    if (marketRegime.regime === "trending") { buyTh = 2; sellTh = 2; }
    else if (marketRegime.regime === "mean_reverting") { buyTh = 3; sellTh = 4; }
  }

  // ═══════════════════════════════════════════════════════
  // 최종 판정
  // ═══════════════════════════════════════════════════════
  const buySignal = buyScore >= buyTh && buyFactors >= 2;
  const sellSignal = sellScore >= sellTh && sellFactors >= 2;

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

// ==================== KV VIRTUAL PORTFOLIO ====================
const STOCK_PORTFOLIO_KEY = "di:virtual:stock-portfolio";
const STOCK_INITIAL_CASH = 100000; // $100,000 가상 자금

// ==================== TELEGRAM REPORTING ====================

// 단일 카드로 발송 — 기존 본문 텍스트는 그대로 lines 로 분리해 표시
async function sendTelegramReport(title, message) {
  // Markdown 잔재 (* 강조) 제거. humanize() 가 "DI금융"→"Zepta" 자동 치환.
  const clean = String(message || "")
    .replace(/\*+/g, "")            // *bold* 제거
    .replace(/^_+|_+$/gm, "")        // 양끝 _ 제거
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/```/g, "").trim()) // 코드블록 풀기
    .replace(/━+/g, "")              // 구분선 제거 (카드가 자체적으로 시각 분리)
    .trim();
  const lines = clean.split(/\n+/).map((s) => s.trim()).filter(Boolean);

  // 너무 길면 첫 ~25줄만 (카드 가독성)
  const trimmed = lines.length > 25 ? [...lines.slice(0, 25), "...(이하 생략 — 자세한 내용은 KV 로그 참고)"] : lines;

  // ★ virtual 채널 — 주식 가상 자동매매라 ZEPTA_TG_VIRTUAL_ENABLED=1 일 때만 발송
  await sendCards([buildCard({
    tag: title.includes("Error") || title.includes("⚠") ? "⚠️" : "🤖",
    title: title.replace(/^[⚠️🤖]\s*/, ""),
    lines: trimmed,
  })], { channel: "virtual" });
}

// ==================== MAIN HANDLER ====================

export default async function handler(req, res) {
  try {
    // Verify cron secret if provided
    if (process.env.CRON_SECRET && req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    console.log('Starting stock auto-trading cron (30min interval)...');

    // ── KV 연결 + 가상 포트폴리오 로드 ──
    let kvModule, kv;
    let marketRegime = null;
    let monitorAlerts = [];
    try {
      kvModule = await import("@vercel/kv");
      kv = kvModule.kv;
      marketRegime = await kv.get("di:market:regime");
      monitorAlerts = (await kv.get("di:market:alerts")) || [];
      if (marketRegime) {
        console.log(`📡 마켓 모니터 레짐: ${marketRegime.regime} (H=${marketRegime.avgHurst?.toFixed(2)})`);
      }
    } catch {
      console.log("❌ KV 연결 실패 — 매매 불가");
      return res.status(200).json({ ok: false, error: "KV connection failed" });
    }

    // ── 활성 봇 확인 → 주식 봇만 필터링 ──
    const STOCK_BOT_IDS = ["stable-quant", "balanced-quant", "aggressive-quant", "trend-follow", "mean-reversion", "ensemble-signal"];
    let activeStockBots = [];
    let totalStockAllocation = 0;
    try {
      const allActiveBots = (await kv.get("di:active-bots")) || [];
      activeStockBots = allActiveBots.filter(ab => STOCK_BOT_IDS.includes(ab.botId) && ab.status !== "paused");
      totalStockAllocation = activeStockBots.reduce((s, ab) => s + (ab.allocation || 0), 0);
      if (activeStockBots.length > 0) {
        console.log(`🤖 활성 주식 봇 ${activeStockBots.length}개, 총 배분: $${totalStockAllocation.toLocaleString()}`);
      } else {
        console.log(`⏸️ 활성 주식 봇 없음 — 시그널 스캔만 수행 (매매 건너뜀)`);
      }
    } catch (e) {
      console.log(`⚠️ 활성 봇 조회 실패: ${e.message}`);
    }

    let portfolio = await kv.get(STOCK_PORTFOLIO_KEY);
    if (!portfolio) {
      portfolio = {
        cash: STOCK_INITIAL_CASH,
        initialCash: STOCK_INITIAL_CASH,
        positions: {}, // { "AAPL": { qty: 10, avgPrice: 180.5, entryTime: "..." } }
        totalTrades: 0,
        createdAt: new Date().toISOString(),
      };
      await kv.set(STOCK_PORTFOLIO_KEY, portfolio);
      console.log(`🆕 주식 가상 포트폴리오 생성: $${STOCK_INITIAL_CASH.toLocaleString()}`);
    }

    // ── 포지션 가치 계산용 — 현재가 필요 ──
    const positions = []; // 텔레그램 리포트용 포지션 배열
    let totalMarketValue = 0;

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

      const stockAlerts = monitorAlerts.filter(a => a.ticker === symbol);
      const analysis = analyzeLatest(symbol, data, marketRegime, stockAlerts);
      if (!analysis) continue;

      signals.push(analysis);

      const existingPos = portfolio.positions[symbol];
      const currentPrice = analysis.lastClose;

      // 기존 포지션 정보를 positions 배열에 추가 (텔레그램 리포트용)
      if (existingPos && existingPos.qty > 0) {
        const mv = existingPos.qty * currentPrice;
        const costBasis = existingPos.qty * existingPos.avgPrice;
        totalMarketValue += mv;
        positions.push({
          symbol,
          qty: existingPos.qty,
          avg_entry_price: existingPos.avgPrice,
          current_price: currentPrice,
          market_value: mv,
          cost_basis: costBasis,
          unrealized_pl: mv - costBasis,
          unrealized_plpc: costBasis > 0 ? (mv - costBasis) / costBasis : 0,
        });
      }

      // BUY signal — 가상매매 (활성 주식 봇이 있을 때만)
      if (analysis.buySignal && !existingPos && activeStockBots.length > 0) {
        const startEquity = portfolio.cash + totalMarketValue;
        // 배분금액 기준으로 매수 한도 계산 (전체 equity 대신)
        const perStockAlloc = totalStockAllocation / WATCHLIST.length;
        const maxEquity = Math.min(perStockAlloc, startEquity * MAX_EQUITY_PER_STOCK);
        const totalAllowed = startEquity * MAX_TOTAL_STOCK_EXPOSURE;

        if (totalMarketValue + maxEquity <= totalAllowed && portfolio.cash >= maxEquity && maxEquity > 10) {
          const qty = Math.floor(maxEquity / currentPrice);
          if (qty > 0) {
            const tradeAmount = qty * currentPrice;
            portfolio.positions[symbol] = { qty, avgPrice: currentPrice, entryTime: new Date().toISOString() };
            portfolio.cash -= tradeAmount;
            portfolio.totalTrades = (portfolio.totalTrades || 0) + 1;
            totalMarketValue += tradeAmount;
            orders.push({ symbol, side: 'BUY', qty, price: currentPrice, status: 'filled' });
            totalTradeValue += tradeAmount;
            console.log(`🟢 BUY ${qty} ${symbol} @ $${currentPrice.toFixed(2)} ($${tradeAmount.toFixed(0)})`);
          }
        }
      } else if (analysis.buySignal && !existingPos && activeStockBots.length === 0) {
        console.log(`⏭️ ${symbol} 매수 스킵 — 활성 주식 봇 없음`);
      }

      // SELL signal — 가상매매
      if (analysis.sellSignal && existingPos && existingPos.qty > 0) {
        const sellValue = existingPos.qty * currentPrice;
        const costBasis = existingPos.qty * existingPos.avgPrice;
        const realizedPL = sellValue - costBasis;
        portfolio.cash += sellValue;
        delete portfolio.positions[symbol];
        portfolio.totalTrades = (portfolio.totalTrades || 0) + 1;
        orders.push({ symbol, side: 'SELL', qty: existingPos.qty, price: currentPrice, status: 'filled', pnl: realizedPL });
        console.log(`🔴 SELL ${existingPos.qty} ${symbol} @ $${currentPrice.toFixed(2)} (P&L: ${realizedPL >= 0 ? '+' : ''}$${realizedPL.toFixed(2)})`);
      }

      // Trailing stop-loss — 가상매매
      if (existingPos && existingPos.qty > 0 && !analysis.sellSignal) {
        const entryPrice = existingPos.avgPrice;
        const pnlPercent = (currentPrice - entryPrice) / entryPrice;

        if (pnlPercent < TRAILING_STOP_LOSS) {
          const sellValue = existingPos.qty * currentPrice;
          const realizedPL = sellValue - (existingPos.qty * entryPrice);
          portfolio.cash += sellValue;
          delete portfolio.positions[symbol];
          portfolio.totalTrades = (portfolio.totalTrades || 0) + 1;
          orders.push({ symbol, side: 'SELL (SL)', qty: existingPos.qty, price: currentPrice, reason: `Trailing SL: ${(pnlPercent * 100).toFixed(2)}%`, pnl: realizedPL });
          console.log(`🛑 SELL ${existingPos.qty} ${symbol} (SL ${(pnlPercent * 100).toFixed(1)}%) @ $${currentPrice.toFixed(2)}`);
        }
      }
    }

    // ── 가상 포트폴리오 KV 저장 ──
    await kv.set(STOCK_PORTFOLIO_KEY, portfolio);
    const startEquity = portfolio.cash + totalMarketValue;
    const startCash = portfolio.cash;
    console.log(`💾 주식 포트폴리오 저장: 현금 $${startCash.toFixed(0)}, 포지션 ${Object.keys(portfolio.positions).length}종목, 총자산 $${startEquity.toFixed(0)}`);

    // ── 주식 봇별 성과 KV 저장 (활성 봇만) ──
    try {
      const activeBotIds = activeStockBots.map(ab => ab.botId);

      if (orders.length > 0 && activeBotIds.length > 0) {
        // ★ 2026-05-09: btc-cron 의 getBotsForAsset 패턴 적용 — 자산별 분배
        //   이전: 모든 활성 봇 × 모든 주문 → 활성 봇 N개면 한 거래가 N번 카운트
        //   이후: 자산을 다루는 봇에만 카운트 → 다중 카운트 통제
        // 거래 단위로 루프 → 각 거래마다 해당 자산을 다루는 봇 목록만 갱신
        const writtenBots = new Set();
        for (const order of orders) {
          const bots = getStockBotsForAsset(order.symbol, activeBotIds);
          if (bots.length === 0) continue;
          for (const botId of bots) {
            const key = `di:bot:${botId}:perf`;
            const existing = (await kv.get(key)) || {
              botId, trades: [], realizedPL: 0, totalBuyCost: 0, totalSellRevenue: 0,
              tradeCount: 0, winCount: 0, closedCount: 0, lossCount: 0,
              grossWin: 0, grossLoss: 0, lastUpdated: null,
            };
            existing.trades = [
              { time: new Date().toISOString(), asset: order.symbol, type: order.side.replace(' (SL)', ''),
                amount: (order.qty || 0) * (order.price || 0), reason: order.reason || '' },
              ...(existing.trades || []),
            ].slice(0, 200);
            existing.tradeCount = (existing.tradeCount || 0) + 1;
            if (order.side === "BUY") {
              existing.totalBuyCost = (existing.totalBuyCost || 0) + (order.qty * order.price);
            } else {
              existing.totalSellRevenue = (existing.totalSellRevenue || 0) + (order.qty * order.price);
              // ★ 2026-05-09: closedCount/lossCount/grossWin/grossLoss 누적 (btc-cron 동일)
              //   winRate = winCount / closedCount (분모 SELL 만), PF = grossWin / grossLoss
              if (order.pnl != null) {
                existing.realizedPL = (existing.realizedPL || 0) + order.pnl;
                existing.closedCount = (existing.closedCount || 0) + 1;
                if (order.pnl > 0) {
                  existing.winCount = (existing.winCount || 0) + 1;
                  existing.grossWin = (existing.grossWin || 0) + order.pnl;
                } else if (order.pnl < 0) {
                  existing.lossCount = (existing.lossCount || 0) + 1;
                  existing.grossLoss = (existing.grossLoss || 0) + Math.abs(order.pnl);
                }
              }
            }
            existing.lastUpdated = new Date().toISOString();
            await kv.set(key, existing);
            writtenBots.add(botId);
          }
        }
        console.log(`📊 주식 봇별 성과 KV 저장: ${orders.length}건 → ${writtenBots.size}개 봇 (자산-봇 매핑 적용)`);
      }

      // 주식 봇별 포지션 스냅샷 (활성 봇만)
      for (const ab of activeStockBots) {
        const botId = ab.botId;
        const botAllocation = ab.allocation || 0;
        const totalMV = positions.reduce((s, p) => s + (parseFloat(p.market_value) || 0), 0);
        const totalUnrealized = positions.reduce((s, p) => s + (parseFloat(p.unrealized_pl) || 0), 0);
        // 봇 에쿼티 = 배분금액 + 미실현 손익 + 실현 손익
        const perfKey = `di:bot:${botId}:perf`;
        const perfData = (await kv.get(perfKey)) || {};
        const realizedPL = perfData.realizedPL || 0;
        const botEquity = botAllocation > 0 ? botAllocation + totalUnrealized + realizedPL : totalMV;
        const snapKey = `di:bot:${botId}:snapshot`;
        const prevSnap = (await kv.get(snapKey)) || { peakEquity: botEquity, mdd: 0, history: [] };
        const peakEquity = Math.max(prevSnap.peakEquity || prevSnap.peakValue || botEquity, botEquity);
        const dd = peakEquity > 0 ? ((peakEquity - botEquity) / peakEquity) * 100 : 0;
        const mdd = Math.max(prevSnap.mdd || 0, dd);
        const history = [...(prevSnap.history || []),
          { time: new Date().toISOString(), equity: botEquity, value: totalMV, unrealizedPL: totalUnrealized, positions: positions.length },
        ].slice(-500);
        await kv.set(snapKey, {
          botId, marketValue: totalMV, unrealizedPL: totalUnrealized,
          positionCount: positions.length, peakEquity, dd, mdd,
          botAllocation, botEquity, realizedPL,
          history, lastUpdated: new Date().toISOString(),
        });
      }
      console.log(`📸 주식 봇별 포지션 스냅샷 저장 완료`);
    } catch (e) {
      console.log(`⚠️ 주식 봇별 성과 KV 저장 실패: ${e.message}`);
    }

    // Build telegram report (structured format v4)
    const now = new Date();
    const timeStr = now.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false });
    const cashPct = startEquity > 0 ? ((startCash / startEquity) * 100).toFixed(1) : '0.0';
    const investedPct = (100 - parseFloat(cashPct)).toFixed(1);

    // 일간 P&L 계산 (이전 자산 대비 — KV에서 이전 equity 로드)
    const prevEquityKey = "di:virtual:stock-prev-equity";
    const prevEquity = (await kv.get(prevEquityKey)) || startEquity;
    const dayPnL = startEquity - prevEquity;
    const dayPnLPct = prevEquity > 0 ? (dayPnL / prevEquity * 100) : 0;
    const dayPnLIcon = dayPnL >= 0 ? '📈' : '📉';
    // 현재 equity를 다음 실행용으로 저장
    await kv.set(prevEquityKey, startEquity);

    let report = `📊 *DI금융 주식 자동매매 리포트*\n`;
    report += `━━━━━━━━━━━━━━━━━━\n`;
    report += `🕐 ${timeStr} (KST)\n\n`;

    // Account summary with P&L
    report += `💰 *계좌 요약*\n`;
    report += `  자산: $${startEquity.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
    if (dayPnL !== 0) report += ` ${dayPnLIcon} ${dayPnL >= 0 ? '+' : ''}$${dayPnL.toFixed(2)} (${dayPnLPct >= 0 ? '+' : ''}${dayPnLPct.toFixed(2)}%)`;
    report += `\n`;
    report += `  현금: $${startCash.toLocaleString('en-US', { minimumFractionDigits: 2 })} (${cashPct}%) | 투자: ${investedPct}%\n`;
    // 현금비율 경고
    if (parseFloat(cashPct) < 10) report += `  ⚠️ 현금비율 ${cashPct}% — 추가 매수 여력 부족\n`;
    else if (parseFloat(cashPct) > 60) report += `  💡 현금비율 ${cashPct}% — 적극 매수 검토 구간\n`;
    report += `\n`;

    // Portfolio positions summary with enhanced metrics
    if (positions.length > 0) {
      report += `📋 *보유 포지션 (${positions.length}/${WATCHLIST.length}종목)*\n`;
      let totalPnL = 0;
      let totalMV = 0;
      let bestPos = null, worstPos = null;
      const posDetails = positions.map(pos => {
        const mv = parseFloat(pos.market_value) || 0;
        const entry = parseFloat(pos.avg_entry_price) || 0;
        const cur = parseFloat(pos.current_price) || entry;
        const pnl = parseFloat(pos.unrealized_pl) || 0;
        const pnlPct = entry > 0 ? ((cur - entry) / entry * 100) : 0;
        totalPnL += pnl;
        totalMV += mv;
        if (!bestPos || pnlPct > bestPos.pnlPct) bestPos = { symbol: pos.symbol, pnlPct };
        if (!worstPos || pnlPct < worstPos.pnlPct) worstPos = { symbol: pos.symbol, pnlPct };
        return { symbol: pos.symbol, qty: pos.qty, cur, pnlPct, pnl, mv, weight: startEquity > 0 ? (mv / startEquity * 100) : 0 };
      });
      posDetails.sort((a, b) => b.pnlPct - a.pnlPct);
      posDetails.forEach(p => {
        const icon = p.pnlPct >= 0 ? '📈' : '📉';
        report += `  ${icon} ${p.symbol}: ${p.qty}주 $${p.cur.toFixed(2)} (${p.pnlPct >= 0 ? '+' : ''}${p.pnlPct.toFixed(1)}%) [${p.weight.toFixed(0)}%]\n`;
      });
      const totalPnLPct = totalMV > 0 ? ((totalPnL / (totalMV - totalPnL)) * 100) : 0;
      report += `  ──\n`;
      report += `  💎 미실현 P/L: $${totalPnL >= 0 ? '+' : ''}${totalPnL.toFixed(2)} (${totalPnLPct >= 0 ? '+' : ''}${totalPnLPct.toFixed(1)}%)\n`;
      if (bestPos && worstPos && positions.length >= 2) {
        report += `  🏆 최고: ${bestPos.symbol} +${bestPos.pnlPct.toFixed(1)}% | 최저: ${worstPos.symbol} ${worstPos.pnlPct.toFixed(1)}%\n`;
      }
      report += `\n`;
    }

    // Market overview (signal heatmap)
    if (signals.length > 0) {
      const buySignals = signals.filter(s => s.buySignal);
      const sellSignals = signals.filter(s => s.sellSignal);
      const holdSignals = signals.filter(s => !s.buySignal && !s.sellSignal);
      const avgRSI = signals.reduce((s, x) => s + (x.lastRSI || 50), 0) / signals.length;
      const marketSentiment = avgRSI >= 60 ? '🟢 강세' : avgRSI <= 40 ? '🔴 약세' : '⚪ 중립';

      report += `🌡️ *시장 온도: ${marketSentiment}* (평균RSI ${avgRSI.toFixed(0)})\n`;
      report += `🔍 *시그널: 매수 ${buySignals.length} | 매도 ${sellSignals.length} | 관망 ${holdSignals.length}*\n`;

      if (buySignals.length > 0) {
        report += `\n  🟢 *매수 (${buySignals.length})*\n`;
        buySignals.forEach(sig => {
          const strength = sig.buyScore >= 6 ? '🔥' : sig.buyScore >= 4 ? '✅' : '💡';
          const emaPos = sig.lastEMA21 > sig.lastEMA55 ? '정배열' : '역배열';
          const bbPos = sig.lastBB ? ((sig.lastClose - sig.lastBB.lower) / (sig.lastBB.upper - sig.lastBB.lower) * 100).toFixed(0) : '—';
          report += `    ${strength} *${sig.symbol}* $${sig.lastClose.toFixed(2)}\n`;
          report += `       RSI:${sig.lastRSI.toFixed(0)} | BB:${bbPos}% | ${emaPos} | Buy:${sig.buyScore}(${sig.buyFactors}F)\n`;
          if (sig.candlePattern) report += `       🕯 ${sig.candlePattern}`;
          if (sig.bullDivergence) report += ` | 강세 다이버전스`;
          if (sig.candlePattern || sig.bullDivergence) report += '\n';
        });
      }
      if (sellSignals.length > 0) {
        report += `\n  🔴 *매도 (${sellSignals.length})*\n`;
        sellSignals.forEach(sig => {
          const strength = sig.sellScore >= 6 ? '⚠️' : '⛔';
          const emaPos = sig.lastEMA21 > sig.lastEMA55 ? '정배열' : '역배열';
          report += `    ${strength} *${sig.symbol}* $${sig.lastClose.toFixed(2)}\n`;
          report += `       RSI:${sig.lastRSI.toFixed(0)} | ${emaPos} | Sell:${sig.sellScore}(${sig.sellFactors}F)\n`;
          if (sig.candlePattern) report += `       🕯 ${sig.candlePattern}\n`;
        });
      }
      if (holdSignals.length > 0) {
        report += `\n  ⚪ *관망 (${holdSignals.length})*\n  `;
        report += holdSignals.map(s => {
          const rsiIcon = s.lastRSI > 60 ? '↑' : s.lastRSI < 40 ? '↓' : '→';
          return `${s.symbol}(${s.lastRSI.toFixed(0)}${rsiIcon})`;
        }).join(' ') + '\n';
      }
    }

    // Risk/Reward 요약 — 포트폴리오 전체 R:R 비율
    if (signals.length > 0) {
      const avgBuyScore = signals.reduce((s, x) => s + x.buyScore, 0) / signals.length;
      const avgSellScore = signals.reduce((s, x) => s + x.sellScore, 0) / signals.length;
      const overallBias = avgBuyScore > avgSellScore ? '매수 우위' : avgBuyScore < avgSellScore ? '매도 우위' : '중립';
      const biasStrength = Math.abs(avgBuyScore - avgSellScore);
      const biasIcon = biasStrength > 3 ? '🔥' : biasStrength > 1.5 ? '💡' : '➖';
      report += `\n📐 *리스크 관리*\n`;
      report += `  포지션: ${positions.length}/${WATCHLIST.length} (${(positions.length / WATCHLIST.length * 100).toFixed(0)}% 배분)\n`;
      report += `  시그널 편향: ${biasIcon} ${overallBias} (Buy ${avgBuyScore.toFixed(1)} / Sell ${avgSellScore.toFixed(1)})`;
      if (biasStrength > 3) report += ` — 강한 방향성`;
      report += `\n`;
      // ATR 기반 포트폴리오 변동성 근사
      const avgATR = signals.filter(s => s.lastATR && s.lastClose > 0)
        .reduce((sum, s) => sum + (s.lastATR / s.lastClose * 100), 0);
      const atrCount = signals.filter(s => s.lastATR && s.lastClose > 0).length;
      if (atrCount > 0) {
        const portfolioVol = (avgATR / atrCount).toFixed(1);
        const volLabel = portfolioVol > 3 ? '🔴 고변동' : portfolioVol > 2 ? '🟡 보통' : '🟢 안정';
        report += `  변동성: ATR ${portfolioVol}% ${volLabel}\n`;
      }
      // 포트폴리오 집중도 & 분산 경고
      if (positions.length > 0) {
        const posValues = positions.map(p => parseFloat(p.market_value) || 0);
        const maxPosValue = Math.max(...posValues);
        const maxPosPct = startEquity > 0 ? (maxPosValue / startEquity * 100) : 0;
        if (maxPosPct > 25) {
          const maxPosSymbol = positions[posValues.indexOf(maxPosValue)]?.symbol || '?';
          report += `  ⚠️ 집중 위험: ${maxPosSymbol} ${maxPosPct.toFixed(0)}% 비중 — 분산 권장\n`;
        }
        // 평균 보유 기간 근사 (수익률 분포로 추정)
        const positivePnl = positions.filter(p => parseFloat(p.unrealized_pl) > 0).length;
        const winRate = positions.length > 0 ? (positivePnl / positions.length * 100) : 0;
        report += `  승률: ${winRate.toFixed(0)}% (${positivePnl}/${positions.length} 수익중)\n`;
      }
    }

    // Orders executed
    if (orders.length > 0) {
      report += `\n⚡ *체결 ${orders.length}건*\n`;
      report += `━━━━━━━━━━━━━━━━━━\n`;
      orders.forEach(ord => {
        const emoji = ord.side === 'BUY' ? '🟢' : ord.side.includes('SL') ? '🛑' : '🔴';
        const value = (ord.qty * ord.price);
        report += `  ${emoji} ${ord.symbol} ${ord.side}: ${ord.qty}주 @ $${ord.price.toFixed(2)} ($${value.toFixed(0)})`;
        if (ord.reason) report += ` — ${ord.reason}`;
        report += '\n';
      });
      report += `  💸 총 거래: $${totalTradeValue.toLocaleString('en-US', { minimumFractionDigits: 0 })}\n`;
    } else {
      report += `\n✋ 체결 주문 없음\n`;
    }

    // 마켓 레짐 정보 표시
    if (marketRegime) {
      report += `\n🧭 *마켓 레짐*\n`;
      report += `  상태: ${marketRegime.regime || '미정'}`;
      if (marketRegime.avgHurst != null) {
        const hurstLabel = marketRegime.avgHurst > 0.6 ? '추세 지속' : marketRegime.avgHurst < 0.4 ? '평균 회귀' : '랜덤워크';
        report += ` | Hurst ${marketRegime.avgHurst.toFixed(2)} (${hurstLabel})`;
      }
      report += `\n`;
    }

    // 다음 주요 이벤트 힌트
    const dayOfWeek = now.getUTCDay();
    if (dayOfWeek === 5) report += `\n📅 주말 포지션 유의 — 월요일 갭 리스크\n`;
    if (dayOfWeek === 1) report += `\n📅 주초 모멘텀 확인 구간\n`;
    if (dayOfWeek >= 2 && dayOfWeek <= 4) {
      const nextClose = dayOfWeek === 4 ? '내일 금요일 주말 앞두고 리스크 체크' : '';
      if (nextClose) report += `\n📅 ${nextClose}\n`;
    }

    const elapsed = ((Date.now() - now.getTime()) / 1000).toFixed(1);
    report += `\n━━━━━━━━━━━━━━━━━━\n`;
    report += `Zepta Stock Auto v4.2 | ${elapsed}s`;

    await sendTelegramReport('주식 자동매매 리포트', report);

    return res.status(200).json({
      success: true,
      timestamp: new Date().toISOString(),
      signals: signals.length,
      orders: orders.length,
      totalTradeValue: totalTradeValue.toFixed(2)
    });
  } catch (error) {
    console.error('Cron error:', error);

    await sendTelegramReport('주식 자동매매 오류 발생', error.message || String(error));

    return res.status(500).json({
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
}
