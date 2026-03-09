// DI금융 v5.0 — 투자 스크리너 + 퀀트 엔진 + 백테스트
// Features: 스크리닝, 캔들차트, 12개 전략, 백테스트, 포트폴리오, 뉴스, 텔레그램 알림
import { useState, useEffect, useCallback } from "react";
import ChartModal from "./ChartModal.jsx";
import StrategyPanel from "./StrategyPanel.jsx";
import BacktestPanel from "./BacktestPanel.jsx";

// ════════════════════════════════════════════════════════════════════
// 데이터 정의
// ════════════════════════════════════════════════════════════════════
const US_ASSETS = [
  { symbol: "AAPL", name: "Apple" }, { symbol: "MSFT", name: "Microsoft" },
  { symbol: "GOOGL", name: "Alphabet" }, { symbol: "AMZN", name: "Amazon" },
  { symbol: "NVDA", name: "NVIDIA" }, { symbol: "META", name: "Meta" },
  { symbol: "TSLA", name: "Tesla" }, { symbol: "AMD", name: "AMD" },
  { symbol: "NFLX", name: "Netflix" }, { symbol: "INTC", name: "Intel" },
  { symbol: "BA", name: "Boeing" }, { symbol: "DIS", name: "Disney" },
  { symbol: "PYPL", name: "PayPal" }, { symbol: "SNAP", name: "Snap" },
  { symbol: "UBER", name: "Uber" }, { symbol: "COIN", name: "Coinbase" },
  { symbol: "SQ", name: "Block" }, { symbol: "PLTR", name: "Palantir" },
  { symbol: "V", name: "Visa" }, { symbol: "MA", name: "Mastercard" },
  { symbol: "JPM", name: "JPMorgan" }, { symbol: "GS", name: "Goldman Sachs" },
  { symbol: "CRM", name: "Salesforce" }, { symbol: "ORCL", name: "Oracle" },
  { symbol: "ADBE", name: "Adobe" }, { symbol: "QCOM", name: "Qualcomm" },
  // Tech expansion
  { symbol: "AVGO", name: "Broadcom" }, { symbol: "MU", name: "Micron" },
  { symbol: "MRVL", name: "Marvell" }, { symbol: "SMCI", name: "Super Micro" },
  { symbol: "ARM", name: "ARM Holdings" }, { symbol: "PANW", name: "Palo Alto" },
  { symbol: "CRWD", name: "CrowdStrike" }, { symbol: "NOW", name: "ServiceNow" },
  { symbol: "SHOP", name: "Shopify" }, { symbol: "SNOW", name: "Snowflake" },
  { symbol: "DDOG", name: "Datadog" },
  // Finance expansion
  { symbol: "BAC", name: "BofA" }, { symbol: "WFC", name: "Wells Fargo" },
  { symbol: "MS", name: "Morgan Stanley" }, { symbol: "C", name: "Citigroup" },
  { symbol: "BLK", name: "BlackRock" },
  // Healthcare expansion
  { symbol: "UNH", name: "UnitedHealth" }, { symbol: "JNJ", name: "J&J" },
  { symbol: "LLY", name: "Eli Lilly" }, { symbol: "NVO", name: "Novo Nordisk" },
  { symbol: "ABBV", name: "AbbVie" },
  // Energy/Materials expansion
  { symbol: "XOM", name: "Exxon" }, { symbol: "CVX", name: "Chevron" },
  { symbol: "LNG", name: "Cheniere" },
  // Consumer expansion
  { symbol: "WMT", name: "Walmart" }, { symbol: "COST", name: "Costco" },
  { symbol: "HD", name: "Home Depot" }, { symbol: "MCD", name: "McDonalds" },
  // ETF expansion
  { symbol: "SPY", name: "S&P 500 ETF" }, { symbol: "QQQ", name: "나스닥 100 ETF" },
  { symbol: "ARKK", name: "ARK Innovation" }, { symbol: "SOXL", name: "반도체 3x" },
  { symbol: "TQQQ", name: "나스닥 3x" }, { symbol: "BITI", name: "ProShares Short BTC" },
  { symbol: "BITO", name: "ProShares BTC Strategy" }, { symbol: "GLD", name: "Gold ETF" },
  { symbol: "TLT", name: "미국 장기채 ETF" }, { symbol: "VIX", name: "VIX 변동성" },
  { symbol: "SCHD", name: "배당 ETF" }, { symbol: "JEPI", name: "JP모건 인컴 ETF" },
  { symbol: "IWM", name: "Russell 2000" }, { symbol: "XLF", name: "Financial Select" },
  { symbol: "XLE", name: "Energy Select" }, { symbol: "XLK", name: "Tech Select" },
  { symbol: "KWEB", name: "China Internet" }, { symbol: "EEM", name: "Emerging Markets" },
  { symbol: "VNQ", name: "Real Estate" }, { symbol: "HYG", name: "High Yield Bond" },
  { symbol: "LQD", name: "Investment Grade Bond" }, { symbol: "UNG", name: "Natural Gas" },
];

const KR_ASSETS = [
  { symbol: "005930.KS", name: "삼성전자" }, { symbol: "000660.KS", name: "SK하이닉스" },
  { symbol: "035420.KS", name: "NAVER" },    { symbol: "035720.KS", name: "카카오" },
  { symbol: "051910.KS", name: "LG화학" },   { symbol: "006400.KS", name: "삼성SDI" },
  { symbol: "003670.KS", name: "포스코퓨처엠" }, { symbol: "105560.KS", name: "KB금융" },
  { symbol: "055550.KS", name: "신한지주" }, { symbol: "068270.KS", name: "셀트리온" },
  { symbol: "207940.KS", name: "삼성바이오로직스" }, { symbol: "066570.KS", name: "LG전자" },
  { symbol: "005380.KS", name: "현대차" },   { symbol: "000270.KS", name: "기아" },
  { symbol: "086790.KS", name: "하나금융지주" },
  // Energy & Materials expansion
  { symbol: "373220.KS", name: "LG에너지솔루션" }, { symbol: "247540.KS", name: "에코프로비엠" },
  { symbol: "028260.KS", name: "삼성물산" }, { symbol: "012330.KS", name: "현대모비스" },
  { symbol: "096770.KS", name: "SK이노베이션" }, { symbol: "034730.KS", name: "SK" },
  { symbol: "017670.KS", name: "SK텔레콤" },
  // Games & Entertainment expansion
  { symbol: "259960.KS", name: "크래프톤" }, { symbol: "263750.KS", name: "펄어비스" },
  { symbol: "036570.KS", name: "엔씨소프트" },
  // Insurance expansion
  { symbol: "000810.KS", name: "삼성화재" }, { symbol: "032830.KS", name: "삼성생명" },
];

const CRYPTO_ASSETS = [
  { id: "bitcoin", symbol: "BTC", name: "Bitcoin" },
  { id: "ethereum", symbol: "ETH", name: "Ethereum" },
  { id: "solana", symbol: "SOL", name: "Solana" },
  { id: "ripple", symbol: "XRP", name: "XRP" },
  { id: "cardano", symbol: "ADA", name: "Cardano" },
  { id: "avalanche-2", symbol: "AVAX", name: "Avalanche" },
  { id: "polkadot", symbol: "DOT", name: "Polkadot" },
  { id: "chainlink", symbol: "LINK", name: "Chainlink" },
  { id: "dogecoin", symbol: "DOGE", name: "Dogecoin" },
  { id: "uniswap", symbol: "UNI", name: "Uniswap" },
  { id: "binancecoin", symbol: "BNB", name: "BNB" },
  { id: "tron", symbol: "TRX", name: "TRON" },
  { id: "near", symbol: "NEAR", name: "NEAR Protocol" },
  { id: "sui", symbol: "SUI", name: "Sui" },
  { id: "pepe", symbol: "PEPE", name: "Pepe" },
  { id: "render-token", symbol: "RNDR", name: "Render" },
  { id: "injective-protocol", symbol: "INJ", name: "Injective" },
  { id: "fetch-ai", symbol: "FET", name: "Fetch.ai" },
];

// ════════════════════════════════════════════════════════════════════
// 기술 지표 계산
// ════════════════════════════════════════════════════════════════════
function calcRSI(closes, period = 14) {
  if (closes.length < period + 1) return null;
  let ag = 0, al = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) ag += d; else al -= d;
  }
  ag /= period; al /= period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    ag = (ag * (period - 1) + Math.max(d, 0)) / period;
    al = (al * (period - 1) + Math.max(-d, 0)) / period;
  }
  return al === 0 ? 100 : 100 - 100 / (1 + ag / al);
}

function calcSMA(data, period) {
  if (data.length < period) return null;
  return data.slice(-period).reduce((a, b) => a + b, 0) / period;
}

function calcBB(closes, period = 20, mult = 2) {
  if (closes.length < period) return null;
  const s = closes.slice(-period);
  const mean = s.reduce((a, b) => a + b, 0) / period;
  const std = Math.sqrt(s.reduce((a, b) => a + (b - mean) ** 2, 0) / period);
  return { upper: mean + mult * std, middle: mean, lower: mean - mult * std };
}

function calcMACD(closes) {
  if (closes.length < 35) return { goldenCross: false };
  const k12 = 2 / 13, k26 = 2 / 27, k9 = 2 / 10;
  let e12 = closes.slice(0, 12).reduce((a, b) => a + b, 0) / 12;
  let e26 = closes.slice(0, 26).reduce((a, b) => a + b, 0) / 26;
  const macdArr = [];
  for (let i = 0; i < closes.length; i++) {
    if (i >= 12) e12 = closes[i] * k12 + e12 * (1 - k12);
    if (i >= 26) { e26 = closes[i] * k26 + e26 * (1 - k26); macdArr.push(e12 - e26); }
  }
  if (macdArr.length < 9) return { goldenCross: false };
  let sig = macdArr.slice(0, 9).reduce((a, b) => a + b, 0) / 9;
  let prevSig = sig;
  for (let i = 9; i < macdArr.length - 1; i++) prevSig = macdArr[i] * k9 + prevSig * (1 - k9);
  for (let i = 9; i < macdArr.length; i++) sig = macdArr[i] * k9 + sig * (1 - k9);
  const cur = macdArr[macdArr.length - 1], prev = macdArr[macdArr.length - 2];
  return { goldenCross: prev <= prevSig && cur > sig, macdLine: cur, signalLine: sig };
}

function calcStochastic(highs, lows, closes, kPeriod = 14, dPeriod = 3) {
  if (closes.length < kPeriod) return null;
  const kArr = [];
  for (let i = kPeriod - 1; i < closes.length; i++) {
    const hh = Math.max(...highs.slice(i - kPeriod + 1, i + 1));
    const ll = Math.min(...lows.slice(i - kPeriod + 1, i + 1));
    kArr.push(hh === ll ? 50 : ((closes[i] - ll) / (hh - ll)) * 100);
  }
  if (kArr.length < dPeriod) return null;
  const kLast = kArr[kArr.length - 1];
  const dLast = kArr.slice(-dPeriod).reduce((a, b) => a + b, 0) / dPeriod;
  return { k: kLast, d: dLast };
}

function calcWilliamsR(highs, lows, closes, period = 14) {
  if (closes.length < period) return null;
  const hh = Math.max(...highs.slice(-period));
  const ll = Math.min(...lows.slice(-period));
  if (hh === ll) return -50;
  return ((hh - closes[closes.length - 1]) / (hh - ll)) * -100;
}

function calcATR(highs, lows, closes, period = 14) {
  if (closes.length < period + 1) return null;
  const trs = [];
  for (let i = 1; i < closes.length; i++) {
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i-1]),
      Math.abs(lows[i] - closes[i-1])
    );
    trs.push(tr);
  }
  if (trs.length < period) return null;
  let atr = trs.slice(0, period).reduce((a,b) => a+b, 0) / period;
  for (let i = period; i < trs.length; i++) {
    atr = (atr * (period - 1) + trs[i]) / period;
  }
  return atr;
}

function calcSimpleADX(highs, lows, closes, period = 14) {
  if (closes.length < period + 2) return null;
  let plusDM = 0, minusDM = 0, tr = 0;
  for (let i = 1; i <= period; i++) {
    const upMove = highs[i] - highs[i-1];
    const downMove = lows[i-1] - lows[i];
    plusDM += (upMove > downMove && upMove > 0) ? upMove : 0;
    minusDM += (downMove > upMove && downMove > 0) ? downMove : 0;
    tr += Math.max(highs[i]-lows[i], Math.abs(highs[i]-closes[i-1]), Math.abs(lows[i]-closes[i-1]));
  }
  for (let i = period + 1; i < closes.length; i++) {
    const upMove = highs[i] - highs[i-1];
    const downMove = lows[i-1] - lows[i];
    plusDM = plusDM - plusDM/period + ((upMove > downMove && upMove > 0) ? upMove : 0);
    minusDM = minusDM - minusDM/period + ((downMove > upMove && downMove > 0) ? downMove : 0);
    tr = tr - tr/period + Math.max(highs[i]-lows[i], Math.abs(highs[i]-closes[i-1]), Math.abs(lows[i]-closes[i-1]));
  }
  const plusDI = tr > 0 ? (plusDM / tr) * 100 : 0;
  const minusDI = tr > 0 ? (minusDM / tr) * 100 : 0;
  const dx = (plusDI + minusDI) > 0 ? Math.abs(plusDI - minusDI) / (plusDI + minusDI) * 100 : 0;
  return { adx: dx, plusDI, minusDI };
}

function analyzeAsset(weeklyCloses, dailyCloses, weeklyVolumes, weeklyHighs, weeklyLows, conditions) {
  const price = weeklyCloses[weeklyCloses.length - 1];
  const rsi = calcRSI(weeklyCloses, 14);
  const ma20daily = calcSMA(dailyCloses, 20);
  const ma50daily  = calcSMA(dailyCloses, 50);
  const ma200daily = calcSMA(dailyCloses, 200);
  const bb   = calcBB(weeklyCloses);
  const macd = calcMACD(weeklyCloses);
  const stoch = calcStochastic(weeklyHighs, weeklyLows, weeklyCloses);
  const wr    = calcWilliamsR(weeklyHighs, weeklyLows, weeklyCloses);
  const atr   = calcATR(weeklyHighs, weeklyLows, weeklyCloses);
  const adxResult = calcSimpleADX(weeklyHighs, weeklyLows, weeklyCloses);

  const avgVol  = weeklyVolumes.slice(-20).reduce((a, b) => a + b, 0) / Math.min(weeklyVolumes.length, 20);
  const curVol  = weeklyVolumes[weeklyVolumes.length - 1] || 0;
  const volRatio = avgVol > 0 ? curVol / avgVol : 0;
  const ma200Dist = ma200daily ? ((price - ma200daily) / ma200daily) * 100 : null;

  const prev = weeklyCloses.length >= 2 ? weeklyCloses[weeklyCloses.length - 2] : price;
  const weekChange = ((price - prev) / prev) * 100;

  // BB 스퀴즈
  let bbSqueeze = false;
  if (weeklyCloses.length >= 20) {
    const bwArr = [];
    for (let i = 19; i < weeklyCloses.length; i++) {
      const sl = weeklyCloses.slice(i - 19, i + 1);
      const m  = sl.reduce((a, b) => a + b, 0) / 20;
      const sd = Math.sqrt(sl.reduce((a, b) => a + (b - m) ** 2, 0) / 20);
      bwArr.push(m > 0 ? (sd * 4) / m : 0);
    }
    const curBW = bwArr[bwArr.length - 1];
    const minBW = Math.min(...bwArr.slice(-52));
    bbSqueeze = bwArr.length >= 4 && curBW <= minBW * 1.05;
  }

  // 52주 신고/저가
  const high52w = weeklyCloses.length >= 52
    ? Math.max(...weeklyCloses.slice(-52))
    : Math.max(...weeklyCloses);
  const low52w = weeklyCloses.length >= 52
    ? Math.min(...weeklyCloses.slice(-52))
    : Math.min(...weeklyCloses);
  const near52wLow = price <= low52w * 1.05;
  const near52wHigh = price >= high52w * 0.98;

  // OBV (On-Balance Volume) - 간단한 구현
  let obv = 0;
  const obvArr = [];
  for (let i = 0; i < weeklyCloses.length; i++) {
    if (i === 0) obv = weeklyVolumes[i];
    else {
      if (weeklyCloses[i] > weeklyCloses[i-1]) obv += weeklyVolumes[i];
      else if (weeklyCloses[i] < weeklyCloses[i-1]) obv -= weeklyVolumes[i];
    }
    obvArr.push(obv);
  }

  // 최근 주간 변동폭 (ATR의 2배 이상인지 확인)
  const recentRange = weeklyHighs[weeklyHighs.length - 1] - weeklyLows[weeklyLows.length - 1];
  const atrBreakout = atr && recentRange > atr * 2;

  // 가격 채널 (52주 고/저 근처)
  const priceChannel = near52wHigh || near52wLow;

  // 갭 신호 (주간 변화 ±3% 이상)
  const gapSignal = Math.abs(weekChange) >= 3;

  // 거래량 극증
  const volumeClimax = volRatio >= 3;

  // 거래량 고갈
  const volumeDry = volRatio <= 0.3;

  // OBV 다이버전스 - 최근 4주 가격 추세 vs OBV 추세
  let obvDivergence = false;
  if (obvArr.length >= 4) {
    const priceTrend = weeklyCloses[weeklyCloses.length - 1] > weeklyCloses[weeklyCloses.length - 4] ? 1 : -1;
    const obvTrend = obvArr[obvArr.length - 1] > obvArr[obvArr.length - 4] ? 1 : -1;
    obvDivergence = priceTrend !== obvTrend;
  }

  // 평균회귀 (200일선 대비 ±15% 이상)
  const meanReversion = ma200Dist && Math.abs(ma200Dist) >= 15;

  // MACD 다이버전스 - 간단한 구현: 지난 2주 가격 방향 vs MACD 방향
  let macdDivergence = false;
  if (weeklyCloses.length >= 2) {
    const priceTrend = weeklyCloses[weeklyCloses.length - 1] > weeklyCloses[weeklyCloses.length - 2] ? 1 : -1;
    const macdVal = macd.macdLine || 0;
    const prevMacdVal = macd.signalLine || 0;
    const macdTrend = macdVal > prevMacdVal ? 1 : -1;
    macdDivergence = priceTrend !== macdTrend;
  }

  // MA 리본 (정배열/역배열)
  let maRibbon = false;
  if (ma20daily && ma50daily && ma200daily) {
    const bullish = ma20daily > ma50daily && ma50daily > ma200daily;
    const bearish = ma20daily < ma50daily && ma50daily < ma200daily;
    maRibbon = bullish || bearish;
  }

  // ADX 강한 추세
  const adxTrend = adxResult && adxResult.adx >= 25;

  // 골든크로스
  const goldenCross = ma50daily && ma200daily && ma50daily > ma200daily;

  // 데스크로스
  const deathCross = ma50daily && ma200daily && ma50daily < ma200daily;

  const triggers = [];
  if (conditions.includes("rsi_extreme")     && rsi != null && (rsi <= 25 || rsi >= 75))           triggers.push("rsi_extreme");
  if (conditions.includes("macd_divergence")  && macdDivergence)                                   triggers.push("macd_divergence");
  if (conditions.includes("ma_ribbon")        && maRibbon)                                         triggers.push("ma_ribbon");
  if (conditions.includes("adx_trend")        && adxTrend)                                         triggers.push("adx_trend");
  if (conditions.includes("bb_squeeze")       && bbSqueeze)                                        triggers.push("bb_squeeze");
  if (conditions.includes("atr_breakout")     && atrBreakout)                                      triggers.push("atr_breakout");
  if (conditions.includes("price_channel")    && priceChannel)                                     triggers.push("price_channel");
  if (conditions.includes("gap_signal")       && gapSignal)                                        triggers.push("gap_signal");
  if (conditions.includes("volume_climax")    && volumeClimax)                                     triggers.push("volume_climax");
  if (conditions.includes("obv_divergence")   && obvDivergence)                                    triggers.push("obv_divergence");
  if (conditions.includes("volume_dry")       && volumeDry)                                        triggers.push("volume_dry");
  if (conditions.includes("near_52w_low")     && near52wLow)                                       triggers.push("near_52w_low");
  if (conditions.includes("near_52w_high")    && near52wHigh)                                      triggers.push("near_52w_high");
  if (conditions.includes("death_cross")      && deathCross)                                       triggers.push("death_cross");
  if (conditions.includes("golden_cross")     && goldenCross)                                      triggers.push("golden_cross");
  if (conditions.includes("mean_reversion")   && meanReversion)                                    triggers.push("mean_reversion");

  return {
    triggers, price: +price.toFixed(6),
    rsi: rsi != null ? +rsi.toFixed(1) : null,
    weekChange: +weekChange.toFixed(2),
    ma200Dist: ma200Dist != null ? +ma200Dist.toFixed(2) : null,
    volRatio: +volRatio.toFixed(1),
    ma50: ma50daily, ma200: ma200daily,
    stoch, wr: wr != null ? +wr.toFixed(1) : null,
    low52w, high52w,
  };
}

// ════════════════════════════════════════════════════════════════════
// 조건 메타데이터
// ════════════════════════════════════════════════════════════════════
const CONDITION_META = {
  // 모멘텀 & 추세
  rsi_extreme:     { label: "RSI 극단값",        icon: "⚡", desc: "RSI ≤ 25 또는 ≥ 75 — 극단적 과매수/과매도" },
  macd_divergence: { label: "MACD 다이버전스",    icon: "🔀", desc: "가격과 MACD 방향 불일치 — 추세 반전 선행지표" },
  ma_ribbon:       { label: "이평선 정배열/역배열", icon: "📐", desc: "MA20>MA50>MA200 정배열 또는 역배열 — 추세 강도 확인" },
  adx_trend:       { label: "ADX 강한 추세",      icon: "💪", desc: "ADX ≥ 25 + DI 방향 — 추세 존재 및 방향 확인" },
  // 변동성 & 가격 구조
  bb_squeeze:      { label: "볼린저 스퀴즈",      icon: "🔥", desc: "밴드폭 52주 최저 — 대규모 변동 임박 신호" },
  atr_breakout:    { label: "ATR 돌파",           icon: "🚀", desc: "당일 변동폭이 ATR(14) 2배 초과 — 폭발적 움직임" },
  price_channel:   { label: "채널 돌파",          icon: "📊", desc: "52주 고가/저가 채널 돌파 — 신고가 또는 지지선 이탈" },
  gap_signal:      { label: "갭 시그널",          icon: "⬆️", desc: "전주 대비 ±3% 이상 갭 — 수급 불균형" },
  // 수급 & 거래량
  volume_climax:   { label: "거래량 클라이맥스",   icon: "🌊", desc: "거래량 20주 평균 3배 이상 — 세력 매집/투매 신호" },
  obv_divergence:  { label: "OBV 다이버전스",     icon: "📈", desc: "OBV와 가격 방향 불일치 — 스마트머니 움직임 포착" },
  volume_dry:      { label: "거래량 고갈",         icon: "🏜️", desc: "거래량 20주 평균 30% 이하 — 바닥 형성 가능" },
  // 밸류에이션 & 상대강도
  near_52w_low:    { label: "52주 신저가 근접",    icon: "🔔", desc: "52주 최저가 대비 5% 이내" },
  near_52w_high:   { label: "52주 신고가 근접",    icon: "🏆", desc: "52주 최고가 대비 2% 이내 — 모멘텀 브레이크아웃" },
  death_cross:     { label: "데스크로스",          icon: "💀", desc: "50일선이 200일선 하향돌파 — 장기 하락전환 경고" },
  golden_cross:    { label: "골든크로스",          icon: "✨", desc: "50일선이 200일선 상향돌파 — 장기 상승전환" },
  mean_reversion:  { label: "평균회귀 신호",       icon: "🎯", desc: "200일선 대비 ±15% 이상 이탈 — 평균회귀 구간" },
};

// ════════════════════════════════════════════════════════════════════
// 감정 분석 헬퍼
// ════════════════════════════════════════════════════════════════════
function analyzeSentiment(title) {
  const pos = ["surge","rally","rise","gain","jump","soar","record","bull","up","growth","profit","beat","strong","high","buy","upgrade","긍정","상승","급등","호재","성장","흑자","매수","상향","신고가","최고","강세","돌파"];
  const neg = ["crash","fall","drop","plunge","decline","loss","bear","down","sell","cut","miss","weak","low","risk","concern","recession","부정","하락","급락","악재","적자","매도","하향","신저가","최저","약세","폭락","위기","불안"];
  const titleLower = title.toLowerCase();
  const posCount = pos.filter(w => titleLower.includes(w)).length;
  const negCount = neg.filter(w => titleLower.includes(w)).length;
  if (posCount > negCount) return "positive";
  if (negCount > posCount) return "negative";
  return "neutral";
}

// ════════════════════════════════════════════════════════════════════
// 텔레그램
// ════════════════════════════════════════════════════════════════════
async function sendTelegramAlert(botToken, chatId, assets, conditions) {
  const labels = Object.fromEntries(Object.entries(CONDITION_META).map(([k, v]) => [k, `${v.icon} ${v.label}`]));
  let msg = `🚨 *DI금융 알림*\n\n`;
  msg += `📅 ${new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}\n`;
  msg += `📊 시그널 감지: *${assets.length}개* 자산\n\n`;
  assets.slice(0, 15).forEach(a => {
    const flag = a.market === "us" ? "🇺🇸" : a.market === "kr" ? "🇰🇷" : "₿";
    const price = a.market === "kr"
      ? `₩${Math.round(a.price).toLocaleString()}`
      : `$${a.price?.toLocaleString(undefined, { maximumFractionDigits: a.price < 1 ? 6 : 2 })}`;
    const chg = a.weekChange >= 0 ? `+${a.weekChange}%` : `${a.weekChange}%`;
    msg += `${flag} *${a.name}* \`${a.symbol}\`\n`;
    msg += `   ${price} | ${chg} | RSI ${a.rsi ?? "—"}\n`;
    msg += `   ${a.triggers.map(t => labels[t] || t).join(" · ")}\n\n`;
  });
  if (assets.length > 15) msg += `_...외 ${assets.length - 15}개_\n\n`;
  msg += `_⚠️ 기술적 지표 기반 — 투자 추천 아님_`;
  const r = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: msg, parse_mode: "Markdown" }),
  });
  return r.json();
}

// ════════════════════════════════════════════════════════════════════
// 로컬스토리지 헬퍼
// ════════════════════════════════════════════════════════════════════
const PORTFOLIO_KEY = "ss_portfolio_v3";
const SETTINGS_KEY  = "ss_settings_v3";
function loadPortfolio() { try { return JSON.parse(localStorage.getItem(PORTFOLIO_KEY)) || []; } catch { return []; } }
function savePortfolio(p) { localStorage.setItem(PORTFOLIO_KEY, JSON.stringify(p)); }
function loadSettings()  { try { return JSON.parse(localStorage.getItem(SETTINGS_KEY))  || {}; } catch { return {}; } }
function saveSettings(s) { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); }

// ════════════════════════════════════════════════════════════════════
// 포맷 헬퍼
// ════════════════════════════════════════════════════════════════════
function fmtPrice(price, market) {
  if (price == null) return "—";
  if (market === "kr") return `₩${Math.round(price).toLocaleString()}`;
  if (price < 0.01) return `$${price.toFixed(6)}`;
  if (price < 1) return `$${price.toFixed(4)}`;
  return `$${price.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

// ════════════════════════════════════════════════════════════════════
// 색상 팔레트 (토스증권 스타일 다크 테마)
// ════════════════════════════════════════════════════════════════════
const C = {
  bg: "#070C14", card: "#0F1825", card2: "#141E2E",
  border: "#1A2535", border2: "#243044",
  blue: "#3182F6", blueL: "#5AA3FF", blueBg: "#1A2C4F",
  red: "#F04452", redBg: "#2A1520",
  green: "#05C072", greenBg: "#0A2A1A",
  yellow: "#FFB400", yellowBg: "#2A2000",
  purple: "#8B5CF6", purpleBg: "#1E1535",
  text1: "#F2F4F7", text2: "#A0AEBF", text3: "#5A6880",
};

// ════════════════════════════════════════════════════════════════════
// 서브 컴포넌트: Tag
// ════════════════════════════════════════════════════════════════════
const TAG_COLORS = {
  rsi_extreme: C.purple, macd_divergence: C.yellow, ma_ribbon: C.blue, adx_trend: C.green,
  bb_squeeze: C.red, atr_breakout: C.red, price_channel: C.blue, gap_signal: C.yellow,
  volume_climax: C.red, obv_divergence: C.purple, volume_dry: C.yellow,
  near_52w_low: C.green, near_52w_high: C.blue, death_cross: C.red, golden_cross: C.green,
  mean_reversion: C.purple,
};

function SignalTag({ triggerKey }) {
  const meta = CONDITION_META[triggerKey];
  const color = TAG_COLORS[triggerKey] || C.blue;
  if (!meta) return null;
  return (
    <span style={{
      padding: "2px 7px", borderRadius: "6px", fontSize: "10px", fontWeight: 700,
      background: `${color}22`, color, border: `1px solid ${color}44`, whiteSpace: "nowrap",
    }}>{meta.icon} {meta.label}</span>
  );
}

// ════════════════════════════════════════════════════════════════════
// 서브 컴포넌트: AssetCard
// ════════════════════════════════════════════════════════════════════
function AssetCard({ asset, onChart }) {
  const [expanded, setExpanded] = useState(false);
  const isPos = asset.weekChange >= 0;
  const mcBg = asset.market === "us" ? "#1A2C4F" : asset.market === "kr" ? "#1A2A1E" : "#1E1A2A";
  const mcColor = asset.market === "us" ? C.blue : asset.market === "kr" ? C.green : C.purple;

  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "14px", overflow: "hidden" }}>
      <div onClick={() => setExpanded(!expanded)}
        style={{ display: "flex", alignItems: "center", padding: "14px 18px", cursor: "pointer", gap: "12px" }}>
        <div style={{
          width: "42px", height: "42px", borderRadius: "12px", background: mcBg, flexShrink: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontWeight: 800, fontSize: "10px", color: mcColor, letterSpacing: "-0.5px",
        }}>
          {asset.symbol.length <= 4 ? asset.symbol : asset.symbol.slice(0, 4)}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
            <span style={{ fontWeight: 700, fontSize: "15px", color: C.text1 }}>{asset.name}</span>
            <span style={{ fontSize: "12px", color: C.text3 }}>{asset.symbol}</span>
          </div>
          <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
            {asset.triggers.map(t => <SignalTag key={t} triggerKey={t} />)}
          </div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontWeight: 700, fontSize: "16px", color: C.text1 }}>{fmtPrice(asset.price, asset.market)}</div>
          <div style={{ fontSize: "13px", fontWeight: 600, color: isPos ? C.green : C.red }}>
            {isPos ? "▲" : "▼"} {Math.abs(asset.weekChange)}%
          </div>
        </div>
      </div>
      {expanded && (
        <div style={{ borderTop: `1px solid ${C.border}`, padding: "14px 18px", background: C.card2 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gap: "8px", marginBottom: "12px" }}>
            {[
              { label: "RSI(14)",    value: asset.rsi ?? "—",   color: asset.rsi != null && asset.rsi <= 30 ? C.purple : C.text2 },
              { label: "200일선 대비", value: asset.ma200Dist != null ? `${asset.ma200Dist > 0 ? "+" : ""}${asset.ma200Dist}%` : "—" },
              { label: "거래량 비율", value: `${asset.volRatio}x`, color: asset.volRatio >= 2 ? C.red : C.text2 },
              { label: "스토캐스틱%K", value: asset.stoch ? `${asset.stoch.k.toFixed(1)}` : "—", color: asset.stoch?.k < 20 ? C.purple : C.text2 },
              { label: "Williams %R", value: asset.wr != null ? `${asset.wr}` : "—", color: asset.wr != null && asset.wr < -80 ? C.purple : C.text2 },
              { label: "52주 저가 대비", value: asset.low52w ? `+${(((asset.price - asset.low52w) / asset.low52w) * 100).toFixed(1)}%` : "—" },
            ].map(({ label, value, color }) => (
              <div key={label} style={{ background: C.bg, borderRadius: "10px", padding: "10px 12px" }}>
                <div style={{ fontSize: "10px", color: C.text3, marginBottom: "4px" }}>{label}</div>
                <div style={{ fontWeight: 700, fontSize: "14px", color: color || C.text1 }}>{value}</div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: "8px" }}>
            <button onClick={(e) => { e.stopPropagation(); onChart(); }} style={{
              padding: "8px 16px", borderRadius: "10px", fontSize: "13px", fontWeight: 600,
              background: C.blueBg, color: C.blue, border: `1px solid ${C.blue}44`,
            }}>📈 차트 보기</button>
            <a href={asset.market === "crypto"
                ? `https://www.coingecko.com/en/coins/${asset.symbolRaw}`
                : `https://finance.yahoo.com/quote/${asset.symbolRaw || asset.symbol}`}
              target="_blank" rel="noopener" onClick={e => e.stopPropagation()}
              style={{
                padding: "8px 16px", borderRadius: "10px", fontSize: "13px", fontWeight: 600,
                background: C.card, color: C.text3, border: `1px solid ${C.border2}`, textDecoration: "none",
              }}>🔗 상세 정보</a>
          </div>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// 메인 앱
// ════════════════════════════════════════════════════════════════════
export default function App() {
  const [tab, setTab] = useState("screener");
  const [menuOpen, setMenuOpen] = useState(false);

  // ── 스크리너 상태 ─────────────────────────────────────────────
  const [results, setResults]         = useState([]);
  const [scanning, setScanning]       = useState(false);
  const [scanProgress, setScanProgress] = useState({ done: 0, total: 0 });
  const [conditions, setConditions]   = useState(["rsi_extreme","bb_squeeze","volume_climax","golden_cross","mean_reversion"]);
  const [mode, setMode]               = useState("or");
  const [filterMarket, setFilterMarket] = useState("all");
  const [sortBy, setSortBy]           = useState("rsi");
  const [scanErrors, setScanErrors]   = useState([]);
  const [lastScan, setLastScan]       = useState(null);
  const [chartAsset, setChartAsset]   = useState(null);

  // ── 포트폴리오 상태 ───────────────────────────────────────────
  const [portfolio, setPortfolio]         = useState(loadPortfolio);
  const [portfolioPrices, setPortfolioPrices] = useState({});
  const [portfolioLoading, setPortfolioLoading] = useState(false);
  const [showAddAsset, setShowAddAsset]   = useState(false);
  const [newAsset, setNewAsset]           = useState({ symbol: "", name: "", market: "us", qty: "", avgPrice: "" });

  // ── 알림 설정 ─────────────────────────────────────────────────
  const [settings, setSettings] = useState(() => ({ botToken: "", chatId: "", autoSend: false, ...loadSettings() }));
  const [tgStatus, setTgStatus] = useState("");

  // ── 백테스트/전략 상태 ─────────────────────────────────────────
  const [btStrategy, setBtStrategy] = useState(null);
  const [btSymbol, setBtSymbol] = useState(null);

  // ── 통화 (KRW/USD) ──────────────────────────────────────────
  const [currency, setCurrency] = useState("USD");
  const [krwRate, setKrwRate] = useState(1350); // 기본 환율

  // ── 동기화 PIN ───────────────────────────────────────────────
  const [syncPin, setSyncPin] = useState(() => loadSettings().syncPin || "");
  const [syncStatus, setSyncStatus] = useState("");

  // ── 뉴스 상태 ─────────────────────────────────────────────────
  const [newsItems, setNewsItems] = useState([]);
  const [newsLoading, setNewsLoading] = useState(false);
  const [newsSort, setNewsSort] = useState("time"); // time, positive, negative

  useEffect(() => { saveSettings({ botToken: settings.botToken, chatId: settings.chatId, autoSend: settings.autoSend, syncPin }); }, [settings, syncPin]);
  useEffect(() => { savePortfolio(portfolio); }, [portfolio]);

  // ── 스크리너 실행 ─────────────────────────────────────────────
  const runScan = useCallback(async () => {
    if (scanning) return;
    setScanning(true); setScanErrors([]);
    const all = [
      ...US_ASSETS.map(a => ({ ...a, market: "us", symbolRaw: a.symbol })),
      ...KR_ASSETS.map(a => ({ ...a, market: "kr", symbolRaw: a.symbol, symbol: a.symbol.replace(".KS", "") })),
      ...CRYPTO_ASSETS.map(a => ({ ...a, market: "crypto", symbol: a.symbol, symbolRaw: a.id })),
    ];
    setScanProgress({ done: 0, total: all.length });
    const found = [], errors = [];

    for (let i = 0; i < all.length; i++) {
      const asset = all[i];
      try {
        let wCloses, wVolumes, wHighs, wLows, dCloses;
        if (asset.market === "crypto") {
          const r = await fetch(`/api/coingecko?id=${encodeURIComponent(asset.symbolRaw)}&days=365&_t=${Date.now()}`);
          if (!r.ok) throw new Error(`CoinGecko ${r.status}`);
          const j = await r.json();
          const dp = (j.prices || []).map(p => p[1]);
          const dv = (j.total_volumes || []).map(v => v[1]);
          wCloses = []; wVolumes = []; wHighs = []; wLows = [];
          for (let k = 6; k < dp.length; k += 7) {
            const sl = dp.slice(Math.max(0, k - 6), k + 1);
            wCloses.push(dp[k]);
            wVolumes.push(dv.slice(Math.max(0, k - 6), k + 1).reduce((a, b) => a + b, 0));
            wHighs.push(Math.max(...sl));
            wLows.push(Math.min(...sl));
          }
          dCloses = dp;
          await new Promise(r => setTimeout(r, 1200)); // CoinGecko 무료 API 레이트리밋 방지
        } else {
          // 주간 + 일간 데이터만 가져옴 (yahoo.js가 highs/lows 포함)
          const [wkR, dyR] = await Promise.all([
            fetch(`/api/yahoo?symbol=${encodeURIComponent(asset.symbolRaw)}&interval=1wk&range=2y&_t=${Date.now()}`),
            fetch(`/api/yahoo?symbol=${encodeURIComponent(asset.symbolRaw)}&interval=1d&range=1y&_t=${Date.now()}`),
          ]);
          if (!wkR.ok) throw new Error(`Yahoo ${wkR.status}`);
          if (!dyR.ok) throw new Error(`Yahoo daily ${dyR.status}`);
          const wk = await wkR.json();
          const dy = await dyR.json();
          wCloses  = wk.closes  || [];
          wVolumes = wk.volumes || [];
          wHighs   = wk.highs   || wCloses;
          wLows    = wk.lows    || wCloses;
          dCloses  = dy.closes  || [];
          // Yahoo 레이트 리밋 방지 딜레이
          await new Promise(r => setTimeout(r, 200));
        }
        if (!wCloses.length) throw new Error("데이터 없음");
        const result = analyzeAsset(wCloses, dCloses, wVolumes, wHighs, wLows, conditions);
        const match = mode === "or" ? result.triggers.length > 0 : conditions.every(c => result.triggers.includes(c));
        if (match) found.push({ ...asset, ...result });
      } catch (e) { errors.push(`${asset.market.toUpperCase()}:${asset.symbol} — ${e.message}`); }
      setScanProgress({ done: i + 1, total: all.length });
    }

    const sorted = found.sort((a, b) => {
      if (sortBy === "rsi")     return (a.rsi ?? 999) - (b.rsi ?? 999);
      if (sortBy === "change")  return a.weekChange - b.weekChange;
      if (sortBy === "vol")     return b.volRatio - a.volRatio;
      return b.triggers.length - a.triggers.length;
    });
    setResults(sorted); setScanErrors(errors); setLastScan(new Date()); setScanning(false);

    if (settings.autoSend && settings.botToken && settings.chatId && sorted.length > 0) {
      try {
        await sendTelegramAlert(settings.botToken, settings.chatId, sorted, conditions);
        setTgStatus("✅ 자동 알림 전송 완료");
      } catch { setTgStatus("❌ 텔레그램 전송 실패"); }
    }
  }, [scanning, conditions, mode, sortBy, settings]);

  // ── 포트폴리오 가격 갱신 ──────────────────────────────────────
  const fetchPortfolioPrices = useCallback(async () => {
    if (!portfolio.length) return;
    setPortfolioLoading(true);
    const prices = {};
    for (const item of portfolio) {
      try {
        if (item.market === "crypto") {
          const r = await fetch(`/api/coingecko?id=${encodeURIComponent(item.cryptoId || item.symbol.toLowerCase())}&days=7&_t=${Date.now()}`);
          const j = await r.json();
          const dp = j.prices || [];
          if (dp.length) prices[item.symbol] = dp[dp.length - 1][1];
        } else {
          const r = await fetch(`/api/yahoo?symbol=${encodeURIComponent(item.symbolRaw || item.symbol)}&interval=1d&range=5d&_t=${Date.now()}`);
          const j = await r.json();
          if (j.closes?.length) prices[item.symbol] = j.closes[j.closes.length - 1];
        }
      } catch {}
    }
    setPortfolioPrices(prices);
    setPortfolioLoading(false);
  }, [portfolio]);

  useEffect(() => { if (tab === "portfolio") fetchPortfolioPrices(); }, [tab, portfolio.length]);

  // ── 뉴스 fetch ────────────────────────────────────────────────
  const fetchNews = useCallback(async () => {
    setNewsLoading(true);
    try {
      const r = await fetch(`/api/news?lang=ko&_t=${Date.now()}`);
      if (r.ok) {
        const j = await r.json();
        setNewsItems(j.news || []);
      }
    } catch {}
    setNewsLoading(false);
  }, []);

  useEffect(() => { if (tab === "news") fetchNews(); }, [tab]);

  // ── 환율 가져오기 ──────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/yahoo-ohlc?symbol=USDKRW=X&interval=1d&range=5d&_t=" + Date.now());
        if (r.ok) {
          const j = await r.json();
          const candles = j.candles || [];
          if (candles.length) setKrwRate(candles[candles.length - 1].close);
        }
      } catch {}
    })();
  }, []);

  // ── 포트폴리오 동기화 ─────────────────────────────────────────
  const syncUpload = useCallback(async () => {
    if (!syncPin || syncPin.length < 4) { setSyncStatus("❌ PIN 4자리 이상 필요"); return; }
    setSyncStatus("⏳ 업로드 중...");
    try {
      const r = await fetch(`/api/sync?pin=${encodeURIComponent(syncPin)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ portfolio, settings: { ...settings, syncPin } }),
      });
      if (r.ok) setSyncStatus("✅ 동기화 완료");
      else setSyncStatus("❌ 업로드 실패");
    } catch (e) { setSyncStatus(`❌ ${e.message}`); }
  }, [syncPin, portfolio, settings]);

  const syncDownload = useCallback(async () => {
    if (!syncPin || syncPin.length < 4) { setSyncStatus("❌ PIN 4자리 이상 필요"); return; }
    setSyncStatus("⏳ 다운로드 중...");
    try {
      const r = await fetch(`/api/sync?pin=${encodeURIComponent(syncPin)}`);
      if (r.ok) {
        const data = await r.json();
        if (data.portfolio?.length) { setPortfolio(data.portfolio); savePortfolio(data.portfolio); }
        if (data.settings) { setSettings(p => ({ ...p, ...data.settings })); saveSettings({ ...settings, ...data.settings }); }
        setSyncStatus(`✅ 동기화 완료 (${data.updatedAt ? new Date(data.updatedAt).toLocaleString("ko-KR") : ""})`);
      } else setSyncStatus("❌ 데이터 없음");
    } catch (e) { setSyncStatus(`❌ ${e.message}`); }
  }, [syncPin, settings]);

  // ── 통화 변환 헬퍼 ──────────────────────────────────────────────
  const toDisplay = (val, market) => {
    if (val == null) return "—";
    if (currency === "KRW") {
      const krw = market === "kr" ? val : val * krwRate;
      return `₩${Math.round(krw).toLocaleString()}`;
    }
    if (market === "kr") return `₩${Math.round(val).toLocaleString()}`;
    if (val < 0.01) return `$${val.toFixed(6)}`;
    if (val < 1) return `$${val.toFixed(4)}`;
    return `$${val.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  };

  const filtered = results.filter(a => filterMarket === "all" || a.market === filterMarket);

  const pStats = portfolio.reduce((acc, item) => {
    const cur = portfolioPrices[item.symbol];
    const invested = item.qty * item.avgPrice;
    return {
      invested: acc.invested + invested,
      current:  acc.current + (cur ? item.qty * cur : 0),
      pnl:      acc.pnl    + (cur ? item.qty * cur - invested : 0),
      hasPrices: acc.hasPrices || !!cur,
    };
  }, { invested: 0, current: 0, pnl: 0, hasPrices: false });

  // 뉴스 정렬
  const sortedNews = [...newsItems].sort((a, b) => {
    if (newsSort === "time") {
      return new Date(b.date || b.publishedAt || b.pubDate || 0) - new Date(a.date || a.publishedAt || a.pubDate || 0);
    } else if (newsSort === "positive") {
      const sentA = analyzeSentiment(a.title);
      const sentB = analyzeSentiment(b.title);
      const scoreA = sentA === "positive" ? 3 : sentA === "neutral" ? 2 : 1;
      const scoreB = sentB === "positive" ? 3 : sentB === "neutral" ? 2 : 1;
      return scoreB - scoreA;
    } else if (newsSort === "negative") {
      const sentA = analyzeSentiment(a.title);
      const sentB = analyzeSentiment(b.title);
      const scoreA = sentA === "negative" ? 3 : sentA === "neutral" ? 2 : 1;
      const scoreB = sentB === "negative" ? 3 : sentB === "neutral" ? 2 : 1;
      return scoreB - scoreA;
    }
    return 0;
  });

  // ────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text1, fontFamily: "'Pretendard', 'Apple SD Gothic Neo', system-ui, sans-serif" }}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }
        * { box-sizing: border-box; margin: 0; }
        ::-webkit-scrollbar { width: 4px; height: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: ${C.border2}; border-radius: 2px; }
        button, a { cursor: pointer; font-family: inherit; }
        input { font-family: inherit; }
        input:focus { border-color: ${C.blue} !important; }
        @media (max-width: 640px) {
          .desktop-nav { display: none !important; }
          .mobile-menu-btn { display: block !important; }
        }
        @media (min-width: 641px) {
          .mobile-dropdown { display: none !important; }
        }
      `}</style>

      {/* ── 헤더 ──────────────────────────────────────────────────── */}
      <header style={{
        position: "sticky", top: 0, zIndex: 100,
        background: `${C.bg}f0`, backdropFilter: "blur(12px)",
        borderBottom: `1px solid ${C.border}`,
      }}>
        <div style={{ maxWidth: "900px", margin: "0 auto", padding: "0 20px", display: "flex", alignItems: "center", justifyContent: "space-between", height: "56px" }}>
          <div onClick={() => { setTab("screener"); setMenuOpen(false); }} style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", userSelect: "none" }}
            title="홈으로 이동">
            <span style={{ fontSize: "20px" }}>📡</span>
            <span style={{ fontWeight: 800, fontSize: "17px" }}>DI금융</span>
            <span style={{ padding: "1px 7px", borderRadius: "4px", fontSize: "10px", fontWeight: 700, background: C.blueBg, color: C.blue }}>v5</span>
          </div>
          {/* 데스크톱 네비게이션 */}
          <nav className="desktop-nav" style={{ display: "flex", gap: "2px" }}>
            {[{ id: "screener", label: "스크리너", icon: "🔍" }, { id: "strategy", label: "전략", icon: "🎯" }, { id: "backtest", label: "백테스트", icon: "📊" }, { id: "portfolio", label: "포트폴리오", icon: "💼" }, { id: "news", label: "뉴스", icon: "📰" }, { id: "alerts", label: "알림", icon: "🔔" }].map(t => (
              <button key={t.id} onClick={() => setTab(t.id)} style={{
                padding: "6px 10px", borderRadius: "8px", fontSize: "12px", fontWeight: 600,
                background: tab === t.id ? C.blueBg : "transparent",
                color: tab === t.id ? C.blue : C.text3, border: "none", whiteSpace: "nowrap",
              }}>{t.icon} {t.label}</button>
            ))}
          </nav>
          {/* 새로고침 버튼 */}
          <button onClick={() => window.location.reload()} title="새로고침" style={{
            background: "none", border: "none", color: C.text3, fontSize: "18px",
            padding: "4px 8px", cursor: "pointer", marginLeft: "4px",
            transition: "color .2s",
          }}
          onMouseEnter={e => e.currentTarget.style.color = C.blue}
          onMouseLeave={e => e.currentTarget.style.color = C.text3}>🔄</button>
          {/* 모바일 햄버거 */}
          <button className="mobile-menu-btn" onClick={() => setMenuOpen(!menuOpen)} style={{
            display: "none", background: "none", border: "none", color: C.text2,
            fontSize: "22px", padding: "4px 8px", cursor: "pointer",
          }}>
            {menuOpen ? "✕" : "☰"}
          </button>
        </div>
        {/* 모바일 드롭다운 메뉴 */}
        {menuOpen && (
          <div className="mobile-dropdown" style={{
            background: C.card, borderTop: `1px solid ${C.border}`,
            padding: "8px 16px 12px", display: "flex", flexDirection: "column", gap: "2px",
          }}>
            {[{ id: "screener", label: "스크리너", icon: "🔍" }, { id: "strategy", label: "전략", icon: "🎯" }, { id: "backtest", label: "백테스트", icon: "📊" }, { id: "portfolio", label: "포트폴리오", icon: "💼" }, { id: "news", label: "뉴스", icon: "📰" }, { id: "alerts", label: "알림", icon: "🔔" }].map(t => (
              <button key={t.id} onClick={() => { setTab(t.id); setMenuOpen(false); }} style={{
                padding: "10px 14px", borderRadius: "10px", fontSize: "14px", fontWeight: 600,
                background: tab === t.id ? C.blueBg : "transparent",
                color: tab === t.id ? C.blue : C.text2, border: "none",
                textAlign: "left", cursor: "pointer",
              }}>{t.icon} {t.label}</button>
            ))}
          </div>
        )}
      </header>

      <main style={{ maxWidth: "900px", margin: "0 auto", padding: "20px" }}>

        {/* ═══════════════════════════════════════════════════════════
            TAB: 스크리너
        ═══════════════════════════════════════════════════════════ */}
        {tab === "screener" && (
          <div>
            {/* 조건 선택 패널 */}
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "16px", padding: "20px", marginBottom: "16px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "14px" }}>
                <div style={{ fontWeight: 700, fontSize: "15px" }}>⚙️ 스크리닝 옵션</div>
                <div style={{ display: "flex", gap: "6px" }}>
                  {["or", "and"].map(m => (
                    <button key={m} onClick={() => setMode(m)} style={{
                      padding: "5px 12px", borderRadius: "8px", fontSize: "12px", fontWeight: 700,
                      background: mode === m ? C.blue : C.card2, color: mode === m ? "#fff" : C.text3,
                      border: `1px solid ${mode === m ? C.blue : C.border2}`,
                    }}>{m.toUpperCase()}</button>
                  ))}
                </div>
              </div>

              {/* 모멘텀 & 추세 */}
              <div style={{ fontSize: "10px", color: C.text3, fontWeight: 600, letterSpacing: ".05em", marginBottom: "8px", marginTop: "12px" }}>모멘텀 & 추세</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "7px", marginBottom: "14px" }}>
                {["rsi_extreme","macd_divergence","ma_ribbon","adx_trend"].map(key => {
                  const meta = CONDITION_META[key];
                  const on = conditions.includes(key);
                  return (
                    <button key={key} onClick={() => setConditions(p => on ? p.filter(c => c !== key) : [...p, key])}
                      title={meta?.desc} style={{
                        padding: "6px 12px", borderRadius: "10px", fontSize: "12px", fontWeight: 600,
                        background: on ? `${C.blue}22` : C.card2, color: on ? C.blue : C.text3,
                        border: `1px solid ${on ? C.blue : C.border2}`,
                      }}>{meta?.icon} {meta?.label}</button>
                  );
                })}
              </div>

              {/* 변동성 & 가격 구조 */}
              <div style={{ fontSize: "10px", color: C.text3, fontWeight: 600, letterSpacing: ".05em", marginBottom: "8px", marginTop: "12px" }}>변동성 & 가격 구조</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "7px", marginBottom: "14px" }}>
                {["bb_squeeze","atr_breakout","price_channel","gap_signal"].map(key => {
                  const meta = CONDITION_META[key];
                  const on = conditions.includes(key);
                  return (
                    <button key={key} onClick={() => setConditions(p => on ? p.filter(c => c !== key) : [...p, key])}
                      title={meta?.desc} style={{
                        padding: "6px 12px", borderRadius: "10px", fontSize: "12px", fontWeight: 600,
                        background: on ? `${C.red}22` : C.card2, color: on ? C.red : C.text3,
                        border: `1px solid ${on ? C.red : C.border2}`,
                      }}>{meta?.icon} {meta?.label}</button>
                  );
                })}
              </div>

              {/* 수급 & 거래량 */}
              <div style={{ fontSize: "10px", color: C.text3, fontWeight: 600, letterSpacing: ".05em", marginBottom: "8px", marginTop: "12px" }}>수급 & 거래량</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "7px", marginBottom: "14px" }}>
                {["volume_climax","obv_divergence","volume_dry"].map(key => {
                  const meta = CONDITION_META[key];
                  const on = conditions.includes(key);
                  return (
                    <button key={key} onClick={() => setConditions(p => on ? p.filter(c => c !== key) : [...p, key])}
                      title={meta?.desc} style={{
                        padding: "6px 12px", borderRadius: "10px", fontSize: "12px", fontWeight: 600,
                        background: on ? `${C.yellow}22` : C.card2, color: on ? C.yellow : C.text3,
                        border: `1px solid ${on ? C.yellow : C.border2}`,
                      }}>{meta?.icon} {meta?.label}</button>
                  );
                })}
              </div>

              {/* 구조적 시그널 */}
              <div style={{ fontSize: "10px", color: C.text3, fontWeight: 600, letterSpacing: ".05em", marginBottom: "8px", marginTop: "12px" }}>구조적 시그널</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "7px", marginBottom: "18px" }}>
                {["near_52w_low","near_52w_high","death_cross","golden_cross","mean_reversion"].map(key => {
                  const meta = CONDITION_META[key];
                  const on = conditions.includes(key);
                  return (
                    <button key={key} onClick={() => setConditions(p => on ? p.filter(c => c !== key) : [...p, key])}
                      title={meta?.desc} style={{
                        padding: "6px 12px", borderRadius: "10px", fontSize: "12px", fontWeight: 600,
                        background: on ? `${C.green}22` : C.card2, color: on ? C.green : C.text3,
                        border: `1px solid ${on ? C.green : C.border2}`,
                      }}>{meta?.icon} {meta?.label}</button>
                  );
                })}
              </div>

              <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
                <button onClick={runScan} disabled={scanning || conditions.length === 0} style={{
                  padding: "11px 24px", borderRadius: "12px", fontSize: "14px", fontWeight: 700,
                  background: scanning ? C.card2 : C.blue, color: scanning ? C.text3 : "#fff", border: "none",
                  minWidth: "120px",
                }}>
                  {scanning
                    ? <span style={{ display: "flex", alignItems: "center", gap: "8px", justifyContent: "center" }}>
                        <span style={{ animation: "pulse 1s infinite" }}>⏳</span> {scanProgress.done}/{scanProgress.total}
                      </span>
                    : "🔍 스캔 시작"}
                </button>
                {scanning && (
                  <div style={{ flex: 1, minWidth: "120px" }}>
                    <div style={{ height: "4px", background: C.border2, borderRadius: "2px", overflow: "hidden" }}>
                      <div style={{
                        height: "100%", background: C.blue, borderRadius: "2px",
                        width: `${scanProgress.total ? (scanProgress.done / scanProgress.total) * 100 : 0}%`, transition: "width .3s",
                      }} />
                    </div>
                  </div>
                )}
                {lastScan && !scanning && (
                  <span style={{ fontSize: "12px", color: C.text3 }}>마지막: {lastScan.toLocaleTimeString("ko-KR")}</span>
                )}
              </div>

              {scanErrors.length > 0 && (
                <details style={{ marginTop: "10px" }}>
                  <summary style={{ fontSize: "12px", color: C.text3, cursor: "pointer" }}>⚠️ {scanErrors.length}개 오류</summary>
                  <div style={{ marginTop: "6px", fontSize: "11px", color: C.red, lineHeight: 1.6, maxHeight: "80px", overflow: "auto" }}>
                    {scanErrors.map((e, i) => <div key={i}>{e}</div>)}
                  </div>
                </details>
              )}
            </div>

            {/* 결과 필터 */}
            {results.length > 0 && (
              <div style={{ display: "flex", gap: "7px", alignItems: "center", marginBottom: "12px", flexWrap: "wrap" }}>
                <span style={{ fontSize: "13px", color: C.text2, fontWeight: 600 }}>🎯 {filtered.length}개</span>
                {["all","us","kr","crypto"].map(m => (
                  <button key={m} onClick={() => setFilterMarket(m)} style={{
                    padding: "4px 10px", borderRadius: "8px", fontSize: "12px", fontWeight: 600,
                    background: filterMarket === m ? C.blueBg : "transparent",
                    color: filterMarket === m ? C.blue : C.text3, border: `1px solid ${filterMarket === m ? C.blue : C.border2}`,
                  }}>{m === "all" ? "전체" : m === "us" ? "🇺🇸 미국" : m === "kr" ? "🇰🇷 한국" : "₿ 크립토"}</button>
                ))}
                <div style={{ marginLeft: "auto", display: "flex", gap: "5px", alignItems: "center" }}>
                  <span style={{ fontSize: "11px", color: C.text3 }}>정렬</span>
                  {[["rsi","RSI"], ["change","변동률"], ["vol","거래량"], ["signals","시그널"]].map(([v, l]) => (
                    <button key={v} onClick={() => setSortBy(v)} style={{
                      padding: "3px 8px", borderRadius: "6px", fontSize: "11px", fontWeight: 600,
                      background: sortBy === v ? C.blueBg : "transparent", color: sortBy === v ? C.blue : C.text3,
                      border: `1px solid ${sortBy === v ? C.blue : C.border2}`,
                    }}>{l}</button>
                  ))}
                </div>
              </div>
            )}

            {/* 대기 상태 */}
            {!scanning && results.length === 0 && (
              <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "16px", padding: "48px 24px", textAlign: "center" }}>
                <div style={{ fontSize: "44px", marginBottom: "16px" }}>📡</div>
                <div style={{ fontWeight: 700, fontSize: "18px", marginBottom: "8px" }}>스캔 대기 중</div>
                <div style={{ color: C.text3, fontSize: "14px", lineHeight: 1.7 }}>
                  조건 선택 후 <strong style={{ color: C.blue }}>스캔 시작</strong>을 눌러주세요<br />
                  미국 · 한국 주식 + 크립토 {US_ASSETS.length + KR_ASSETS.length + CRYPTO_ASSETS.length}개 자산 분석
                </div>
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {filtered.map((asset, i) => (
                <AssetCard key={`${asset.symbol}-${i}`} asset={asset} onChart={() => setChartAsset(asset)} />
              ))}
            </div>

            {!scanning && results.length > 0 && filtered.length === 0 && (
              <div style={{ textAlign: "center", padding: "32px", color: C.text3 }}>선택한 시장에 시그널 없음</div>
            )}
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════
            TAB: 포트폴리오
        ═══════════════════════════════════════════════════════════ */}
        {tab === "portfolio" && (
          <div>
            {/* 요약 헤더 */}
            <div style={{
              background: `linear-gradient(135deg, ${C.card}, #0d1f35)`,
              border: `1px solid ${C.border}`, borderRadius: "16px", padding: "20px", marginBottom: "16px",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: portfolio.length ? "16px" : "0" }}>
                <div style={{ fontWeight: 700, fontSize: "16px" }}>💼 내 포트폴리오</div>
                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                  <button onClick={() => setCurrency(c => c === "USD" ? "KRW" : "USD")} style={{
                    padding: "6px 10px", borderRadius: "8px", fontSize: "11px", fontWeight: 700,
                    background: C.card2, color: C.yellow, border: `1px solid ${C.yellow}44`,
                  }}>{currency === "USD" ? "🇺🇸 USD" : "🇰🇷 KRW"}</button>
                  <button onClick={fetchPortfolioPrices} style={{
                    padding: "6px 12px", borderRadius: "8px", fontSize: "12px", fontWeight: 600,
                    background: C.blueBg, color: C.blue, border: `1px solid ${C.blue}44`,
                  }}>{portfolioLoading ? "⏳ 갱신 중" : "🔄 가격 갱신"}</button>
                  <button onClick={() => setShowAddAsset(true)} style={{
                    padding: "6px 14px", borderRadius: "8px", fontSize: "12px", fontWeight: 700,
                    background: C.blue, color: "#fff", border: "none",
                  }}>+ 추가</button>
                </div>
              </div>
              {portfolio.length > 0 && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "10px" }}>
                  {[
                    { label: "총 투자금액", value: currency === "KRW" ? `₩${Math.round(pStats.invested * krwRate).toLocaleString()}` : `$${pStats.invested.toLocaleString(undefined, { maximumFractionDigits: 0 })}` },
                    { label: "현재 평가금액", value: pStats.hasPrices ? (currency === "KRW" ? `₩${Math.round(pStats.current * krwRate).toLocaleString()}` : `$${pStats.current.toLocaleString(undefined, { maximumFractionDigits: 0 })}`) : "—" },
                    { label: "총 손익", value: pStats.hasPrices ? `${pStats.pnl >= 0 ? "+" : ""}${currency === "KRW" ? `₩${Math.round(Math.abs(pStats.pnl) * krwRate).toLocaleString()}` : `$${pStats.pnl.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}` : "—", color: pStats.pnl >= 0 ? C.green : C.red },
                  ].map(({ label, value, color }) => (
                    <div key={label} style={{ background: C.bg, borderRadius: "12px", padding: "14px" }}>
                      <div style={{ fontSize: "11px", color: C.text3, marginBottom: "4px" }}>{label}</div>
                      <div style={{ fontWeight: 700, fontSize: "17px", color: color || C.text1 }}>{value}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 자산 추가 폼 */}
            {showAddAsset && (
              <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "16px", padding: "20px", marginBottom: "16px" }}>
                <div style={{ fontWeight: 700, marginBottom: "14px" }}>📌 자산 추가</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "12px" }}>
                  {[
                    { k: "symbol",   label: "심볼 (예: AAPL, 005930)", ph: "심볼 입력" },
                    { k: "name",     label: "이름 (예: Apple, 삼성전자)", ph: "자산명" },
                    { k: "qty",      label: "보유 수량", ph: "0.00" },
                    { k: "avgPrice", label: "평균 매입가", ph: "0.00" },
                  ].map(({ k, label, ph }) => (
                    <div key={k}>
                      <div style={{ fontSize: "11px", color: C.text3, marginBottom: "4px" }}>{label}</div>
                      <input value={newAsset[k]} onChange={e => setNewAsset(p => ({ ...p, [k]: e.target.value }))}
                        placeholder={ph} style={{
                          width: "100%", padding: "9px 12px", borderRadius: "10px", fontSize: "13px",
                          background: C.bg, border: `1px solid ${C.border2}`, color: C.text1, outline: "none",
                        }} />
                    </div>
                  ))}
                </div>
                <div style={{ marginBottom: "12px" }}>
                  <div style={{ fontSize: "11px", color: C.text3, marginBottom: "6px" }}>시장</div>
                  <div style={{ display: "flex", gap: "6px" }}>
                    {[["us","🇺🇸 미국"], ["kr","🇰🇷 한국"], ["crypto","₿ 크립토"]].map(([v, l]) => (
                      <button key={v} onClick={() => setNewAsset(p => ({ ...p, market: v }))} style={{
                        padding: "6px 14px", borderRadius: "8px", fontSize: "12px", fontWeight: 600,
                        background: newAsset.market === v ? C.blueBg : C.card2,
                        color: newAsset.market === v ? C.blue : C.text3,
                        border: `1px solid ${newAsset.market === v ? C.blue : C.border2}`,
                      }}>{l}</button>
                    ))}
                  </div>
                </div>
                <div style={{ display: "flex", gap: "8px" }}>
                  <button onClick={() => {
                    if (!newAsset.symbol || !newAsset.qty || !newAsset.avgPrice) return;
                    const sym = newAsset.symbol.toUpperCase();
                    const symbolRaw = newAsset.market === "kr" && !sym.includes(".KS") ? `${sym}.KS` : sym;
                    const cryptoA = CRYPTO_ASSETS.find(c => c.symbol === sym || c.id === sym.toLowerCase());
                    setPortfolio(p => [...p, {
                      ...newAsset, symbol: sym, symbolRaw, cryptoId: cryptoA?.id || sym.toLowerCase(),
                      qty: parseFloat(newAsset.qty), avgPrice: parseFloat(newAsset.avgPrice), addedAt: Date.now(),
                    }]);
                    setNewAsset({ symbol: "", name: "", market: "us", qty: "", avgPrice: "" });
                    setShowAddAsset(false);
                  }} style={{
                    padding: "9px 20px", borderRadius: "10px", fontSize: "13px", fontWeight: 700,
                    background: C.blue, color: "#fff", border: "none", flex: 1,
                  }}>추가</button>
                  <button onClick={() => setShowAddAsset(false)} style={{
                    padding: "9px 20px", borderRadius: "10px", fontSize: "13px", fontWeight: 600,
                    background: C.card2, color: C.text3, border: `1px solid ${C.border2}`, flex: 1,
                  }}>취소</button>
                </div>
              </div>
            )}

            {/* 포트폴리오 아이템 */}
            {portfolio.length === 0 ? (
              <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "16px", padding: "48px 24px", textAlign: "center" }}>
                <div style={{ fontSize: "44px", marginBottom: "16px" }}>💼</div>
                <div style={{ fontWeight: 700, fontSize: "18px", marginBottom: "8px" }}>포트폴리오 비어있음</div>
                <div style={{ color: C.text3, fontSize: "14px" }}>자산을 추가하여 시작하세요</div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {portfolio.map((item, idx) => {
                  const cur = portfolioPrices[item.symbol];
                  const gain = cur ? ((cur - item.avgPrice) / item.avgPrice) * 100 : 0;
                  const gainVal = cur ? item.qty * (cur - item.avgPrice) : 0;
                  const isPos = gainVal >= 0;
                  return (
                    <div key={idx} style={{
                      background: C.card, border: `1px solid ${C.border}`, borderRadius: "12px", padding: "14px",
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                    }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: "14px", marginBottom: "2px" }}>{item.name}</div>
                        <div style={{ fontSize: "12px", color: C.text3 }}>{item.symbol} · {item.qty.toLocaleString()}개</div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: "13px", color: C.text2 }}>{toDisplay(cur, item.market)}</div>
                        <div style={{ fontSize: "12px", fontWeight: 600, color: isPos ? C.green : C.red }}>
                          {isPos ? "+" : ""}{gain.toFixed(2)}% {toDisplay(gainVal, item.market)}
                        </div>
                      </div>
                      <button onClick={() => setPortfolio(p => p.filter((_, i) => i !== idx))} style={{
                        padding: "4px 8px", borderRadius: "6px", fontSize: "12px", fontWeight: 600,
                        background: C.redBg, color: C.red, border: `1px solid ${C.red}44`, marginLeft: "12px",
                      }}>삭제</button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════
            TAB: 전략
        ═══════════════════════════════════════════════════════════ */}
        {tab === "strategy" && <StrategyPanel onRunBacktest={(strategy, symbol) => {
          setBtStrategy(strategy); setBtSymbol(symbol); setTab("backtest");
        }} />}

        {/* ═══════════════════════════════════════════════════════════
            TAB: 백테스트
        ═══════════════════════════════════════════════════════════ */}
        {tab === "backtest" && <BacktestPanel initialStrategy={btStrategy} initialSymbol={btSymbol} />}

        {/* ═══════════════════════════════════════════════════════════
            TAB: 뉴스
        ═══════════════════════════════════════════════════════════ */}
        {tab === "news" && (
          <div>
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "16px", padding: "16px", marginBottom: "12px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span style={{ fontWeight: 700 }}>📰 투자 뉴스</span>
                  <button onClick={fetchNews} disabled={newsLoading} style={{
                    padding: "4px 10px", borderRadius: "6px", fontSize: "11px", fontWeight: 600,
                    background: C.card2, color: C.text3, border: `1px solid ${C.border2}`, cursor: "pointer",
                  }}>{newsLoading ? "⏳" : "🔄 새로고침"}</button>
                </div>
                <div style={{ display: "flex", gap: "4px" }}>
                  {[
                    ["time", "시간순"],
                    ["positive", "긍정순"],
                    ["negative", "부정순"],
                  ].map(([v, l]) => (
                    <button key={v} onClick={() => setNewsSort(v)} style={{
                      padding: "4px 10px", borderRadius: "8px", fontSize: "11px", fontWeight: 600,
                      background: newsSort === v ? C.blueBg : "transparent",
                      color: newsSort === v ? C.blue : C.text3,
                      border: `1px solid ${newsSort === v ? C.blue : C.border2}`,
                    }}>{l}</button>
                  ))}
                </div>
              </div>
            </div>

            {newsLoading ? (
              <div style={{ textAlign: "center", padding: "32px", color: C.text3 }}>뉴스 로딩 중...</div>
            ) : sortedNews.length === 0 ? (
              <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "16px", padding: "48px 24px", textAlign: "center" }}>
                <div style={{ fontSize: "44px", marginBottom: "16px" }}>📰</div>
                <div style={{ fontWeight: 700, fontSize: "16px", marginBottom: "8px" }}>뉴스 없음</div>
                <div style={{ color: C.text3, fontSize: "14px" }}>최신 뉴스가 없습니다</div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {sortedNews.map((news, i) => {
                  const sentiment = analyzeSentiment(news.title);
                  const sentimentBadge = sentiment === "positive" ? "🟢 긍정" : sentiment === "negative" ? "🔴 부정" : "⚪ 중립";
                  const pubDate = new Date(news.date || news.publishedAt || news.pubDate || Date.now());
                  return (
                    <a key={i} href={news.url || news.link || "#"} target="_blank" rel="noopener" style={{
                      background: C.card, border: `1px solid ${C.border}`, borderRadius: "12px", padding: "14px",
                      textDecoration: "none", color: "inherit", display: "block", transition: "all .2s",
                    }}
                    onMouseEnter={e => e.currentTarget.style.borderColor = C.blue}
                    onMouseLeave={e => e.currentTarget.style.borderColor = C.border}>
                      <div style={{ display: "flex", gap: "8px", alignItems: "flex-start" }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: "13px", marginBottom: "6px", color: C.text1, lineHeight: 1.4 }}>{news.title}</div>
                          <div style={{ fontSize: "12px", color: C.text3, marginBottom: "8px", display: "flex", gap: "8px", flexWrap: "wrap" }}>
                            <span>{news.source || "Unknown"}</span>
                            <span>·</span>
                            <span>{pubDate.toLocaleString("ko-KR")}</span>
                          </div>
                          {(news.desc || news.description) && (
                            <div style={{ fontSize: "12px", color: C.text2, lineHeight: 1.5 }}>{(news.desc || news.description).slice(0, 120)}</div>
                          )}
                          {news.tags?.length > 0 && (
                            <div style={{ display: "flex", gap: "4px", flexWrap: "wrap", marginTop: "6px" }}>
                              {news.tags.map((tag, ti) => (
                                <span key={ti} style={{ padding: "2px 6px", borderRadius: "4px", fontSize: "10px", background: C.card2, color: C.text3 }}>{tag}</span>
                              ))}
                            </div>
                          )}
                        </div>
                        <div style={{ fontSize: "11px", whiteSpace: "nowrap", color: C.text2, padding: "4px 8px", background: C.card2, borderRadius: "6px" }}>{sentimentBadge}</div>
                      </div>
                    </a>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════
            TAB: 알림
        ═══════════════════════════════════════════════════════════ */}
        {tab === "alerts" && (
          <div>
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "16px", padding: "20px", marginBottom: "16px" }}>
              <div style={{ fontWeight: 700, fontSize: "16px", marginBottom: "16px" }}>🔔 텔레그램 알림</div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "12px" }}>
                <div>
                  <div style={{ fontSize: "11px", color: C.text3, marginBottom: "6px", fontWeight: 600 }}>봇 토큰</div>
                  <input value={settings.botToken} onChange={e => setSettings(p => ({ ...p, botToken: e.target.value }))}
                    placeholder="123456789:ABCdefGHIjklMNOpqrSTUvwxyz" type="password" style={{
                      width: "100%", padding: "10px 12px", borderRadius: "10px", fontSize: "12px",
                      background: C.bg, border: `1px solid ${C.border2}`, color: C.text1, outline: "none",
                    }} />
                </div>
                <div>
                  <div style={{ fontSize: "11px", color: C.text3, marginBottom: "6px", fontWeight: 600 }}>채팅 ID</div>
                  <input value={settings.chatId} onChange={e => setSettings(p => ({ ...p, chatId: e.target.value }))}
                    placeholder="1234567890" type="password" style={{
                      width: "100%", padding: "10px 12px", borderRadius: "10px", fontSize: "12px",
                      background: C.bg, border: `1px solid ${C.border2}`, color: C.text1, outline: "none",
                    }} />
                </div>
              </div>

              <div style={{ marginBottom: "12px" }}>
                <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", fontSize: "13px" }}>
                  <input type="checkbox" checked={settings.autoSend} onChange={e => setSettings(p => ({ ...p, autoSend: e.target.checked }))}
                    style={{ cursor: "pointer" }} />
                  <span>스캔 완료 시 자동 알림</span>
                </label>
              </div>

              <div style={{ display: "flex", gap: "8px", marginBottom: "12px" }}>
                <button onClick={() => {
                  if (!settings.botToken || !settings.chatId) return;
                  (async () => {
                    setTgStatus("⏳ 전송 중...");
                    try {
                      const r = await fetch(`https://api.telegram.org/bot${settings.botToken}/sendMessage`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ chat_id: settings.chatId, text: "🚨 *DI금융 테스트*\n\n테스트 알림입니다.", parse_mode: "Markdown" }),
                      });
                      if (r.ok) setTgStatus("✅ 테스트 완료");
                      else setTgStatus("❌ 전송 실패");
                    } catch (e) { setTgStatus(`❌ ${e.message}`); }
                  })();
                }} style={{
                  padding: "9px 20px", borderRadius: "10px", fontSize: "13px", fontWeight: 700,
                  background: C.blue, color: "#fff", border: "none",
                }}>📤 테스트</button>
              </div>

              {tgStatus && (
                <div style={{ fontSize: "12px", color: tgStatus.includes("✅") ? C.green : C.red, fontWeight: 600 }}>
                  {tgStatus}
                </div>
              )}
            </div>

            {/* 동기화 */}
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "16px", padding: "20px" }}>
              <div style={{ fontWeight: 700, fontSize: "16px", marginBottom: "16px" }}>🔄 데이터 동기화</div>
              <div style={{ marginBottom: "12px" }}>
                <div style={{ fontSize: "11px", color: C.text3, marginBottom: "6px", fontWeight: 600 }}>동기화 PIN (4자리 이상)</div>
                <input value={syncPin} onChange={e => setSyncPin(e.target.value)} type="password" placeholder="1234"
                  style={{
                    width: "100%", padding: "10px 12px", borderRadius: "10px", fontSize: "13px",
                    background: C.bg, border: `1px solid ${C.border2}`, color: C.text1, outline: "none", marginBottom: "12px",
                  }} />
              </div>
              <div style={{ display: "flex", gap: "8px", marginBottom: "12px" }}>
                <button onClick={syncUpload} style={{
                  padding: "9px 20px", borderRadius: "10px", fontSize: "13px", fontWeight: 700,
                  background: C.blue, color: "#fff", border: "none", flex: 1,
                }}>📤 업로드</button>
                <button onClick={syncDownload} style={{
                  padding: "9px 20px", borderRadius: "10px", fontSize: "13px", fontWeight: 700,
                  background: C.green, color: "#fff", border: "none", flex: 1,
                }}>📥 다운로드</button>
              </div>
              {syncStatus && (
                <div style={{ fontSize: "12px", color: syncStatus.includes("✅") ? C.green : C.red, fontWeight: 600 }}>
                  {syncStatus}
                </div>
              )}
            </div>
          </div>
        )}

        {/* 차트 모달 */}
        {chartAsset && <ChartModal asset={chartAsset} onClose={() => setChartAsset(null)} />}
      </main>
    </div>
  );
}
