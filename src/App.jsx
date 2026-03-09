// DI금융 v5.1 — 투자 스크리너 + 퀀트 엔진 + 백테스트
// Features: 스크리닝, 캔들차트, 24개 전략, 백테스트, 포트폴리오, 뉴스, 텔레그램 알림
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import ChartModal from "./ChartModal.jsx";
import StrategyPanel from "./StrategyPanel.jsx";
import BacktestPanel from "./BacktestPanel.jsx";

// ════════════════════════════════════════════════════════════════════
// 데이터 정의
// ════════════════════════════════════════════════════════════════════
const US_ASSETS = [
  // ── Mega Cap Tech ──
  { symbol: "AAPL", name: "Apple" }, { symbol: "MSFT", name: "Microsoft" },
  { symbol: "GOOGL", name: "Alphabet" }, { symbol: "AMZN", name: "Amazon" },
  { symbol: "NVDA", name: "NVIDIA" }, { symbol: "META", name: "Meta" },
  { symbol: "TSLA", name: "Tesla" }, { symbol: "NFLX", name: "Netflix" },
  // ── Semiconductors ──
  { symbol: "AMD", name: "AMD" }, { symbol: "INTC", name: "Intel" },
  { symbol: "AVGO", name: "Broadcom" }, { symbol: "QCOM", name: "Qualcomm" },
  { symbol: "MU", name: "Micron" }, { symbol: "MRVL", name: "Marvell" },
  { symbol: "SMCI", name: "Super Micro" }, { symbol: "ARM", name: "ARM Holdings" },
  { symbol: "ASML", name: "ASML" }, { symbol: "TSM", name: "TSMC" },
  { symbol: "LRCX", name: "Lam Research" }, { symbol: "KLAC", name: "KLA" },
  { symbol: "AMAT", name: "Applied Materials" }, { symbol: "ON", name: "ON Semi" },
  { symbol: "TXN", name: "Texas Instruments" }, { symbol: "ADI", name: "Analog Devices" },
  // ── Software & Cloud ──
  { symbol: "CRM", name: "Salesforce" }, { symbol: "ORCL", name: "Oracle" },
  { symbol: "ADBE", name: "Adobe" }, { symbol: "NOW", name: "ServiceNow" },
  { symbol: "SHOP", name: "Shopify" }, { symbol: "SNOW", name: "Snowflake" },
  { symbol: "DDOG", name: "Datadog" }, { symbol: "NET", name: "Cloudflare" },
  { symbol: "ZS", name: "Zscaler" }, { symbol: "PANW", name: "Palo Alto" },
  { symbol: "CRWD", name: "CrowdStrike" }, { symbol: "FTNT", name: "Fortinet" },
  { symbol: "WDAY", name: "Workday" }, { symbol: "HUBS", name: "HubSpot" },
  { symbol: "TEAM", name: "Atlassian" }, { symbol: "MDB", name: "MongoDB" },
  { symbol: "PLTR", name: "Palantir" }, { symbol: "AI", name: "C3.ai" },
  { symbol: "PATH", name: "UiPath" }, { symbol: "DOCN", name: "DigitalOcean" },
  // ── Internet & Social ──
  { symbol: "SNAP", name: "Snap" }, { symbol: "PINS", name: "Pinterest" },
  { symbol: "UBER", name: "Uber" }, { symbol: "LYFT", name: "Lyft" },
  { symbol: "ABNB", name: "Airbnb" }, { symbol: "BKNG", name: "Booking" },
  { symbol: "DASH", name: "DoorDash" }, { symbol: "RBLX", name: "Roblox" },
  { symbol: "U", name: "Unity" }, { symbol: "TTWO", name: "Take-Two" },
  { symbol: "EA", name: "EA Games" }, { symbol: "ROKU", name: "Roku" },
  { symbol: "SPOT", name: "Spotify" },
  // ── Fintech & Crypto ──
  { symbol: "COIN", name: "Coinbase" }, { symbol: "SQ", name: "Block" },
  { symbol: "PYPL", name: "PayPal" }, { symbol: "AFRM", name: "Affirm" },
  { symbol: "SOFI", name: "SoFi" }, { symbol: "HOOD", name: "Robinhood" },
  { symbol: "MSTR", name: "MicroStrategy" },
  // ── Finance (Banks & Asset Mgmt) ──
  { symbol: "V", name: "Visa" }, { symbol: "MA", name: "Mastercard" },
  { symbol: "JPM", name: "JPMorgan" }, { symbol: "GS", name: "Goldman Sachs" },
  { symbol: "BAC", name: "BofA" }, { symbol: "WFC", name: "Wells Fargo" },
  { symbol: "MS", name: "Morgan Stanley" }, { symbol: "C", name: "Citigroup" },
  { symbol: "BLK", name: "BlackRock" }, { symbol: "SCHW", name: "Schwab" },
  { symbol: "AXP", name: "Amex" }, { symbol: "BX", name: "Blackstone" },
  { symbol: "KKR", name: "KKR" }, { symbol: "APO", name: "Apollo" },
  // ── Healthcare & Pharma ──
  { symbol: "UNH", name: "UnitedHealth" }, { symbol: "JNJ", name: "J&J" },
  { symbol: "LLY", name: "Eli Lilly" }, { symbol: "NVO", name: "Novo Nordisk" },
  { symbol: "ABBV", name: "AbbVie" }, { symbol: "PFE", name: "Pfizer" },
  { symbol: "MRK", name: "Merck" }, { symbol: "TMO", name: "Thermo Fisher" },
  { symbol: "ABT", name: "Abbott" }, { symbol: "BMY", name: "Bristol-Myers" },
  { symbol: "AMGN", name: "Amgen" }, { symbol: "GILD", name: "Gilead" },
  { symbol: "ISRG", name: "Intuitive Surgical" }, { symbol: "VRTX", name: "Vertex" },
  { symbol: "REGN", name: "Regeneron" }, { symbol: "MRNA", name: "Moderna" },
  // ── Industrials & Defense ──
  { symbol: "BA", name: "Boeing" }, { symbol: "CAT", name: "Caterpillar" },
  { symbol: "DE", name: "Deere" }, { symbol: "HON", name: "Honeywell" },
  { symbol: "RTX", name: "RTX (Raytheon)" }, { symbol: "LMT", name: "Lockheed Martin" },
  { symbol: "GE", name: "GE Aerospace" }, { symbol: "UPS", name: "UPS" },
  { symbol: "FDX", name: "FedEx" },
  // ── Energy ──
  { symbol: "XOM", name: "Exxon" }, { symbol: "CVX", name: "Chevron" },
  { symbol: "LNG", name: "Cheniere" }, { symbol: "COP", name: "ConocoPhillips" },
  { symbol: "SLB", name: "Schlumberger" }, { symbol: "OXY", name: "Occidental" },
  { symbol: "EOG", name: "EOG Resources" },
  // ── Consumer ──
  { symbol: "WMT", name: "Walmart" }, { symbol: "COST", name: "Costco" },
  { symbol: "HD", name: "Home Depot" }, { symbol: "MCD", name: "McDonalds" },
  { symbol: "DIS", name: "Disney" }, { symbol: "SBUX", name: "Starbucks" },
  { symbol: "NKE", name: "Nike" }, { symbol: "TGT", name: "Target" },
  { symbol: "LOW", name: "Lowe's" }, { symbol: "KO", name: "Coca-Cola" },
  { symbol: "PEP", name: "Pepsi" }, { symbol: "PG", name: "P&G" },
  { symbol: "PM", name: "Philip Morris" }, { symbol: "CL", name: "Colgate" },
  // ── Telecom & Media ──
  { symbol: "T", name: "AT&T" }, { symbol: "VZ", name: "Verizon" },
  { symbol: "TMUS", name: "T-Mobile" }, { symbol: "CMCSA", name: "Comcast" },
  { symbol: "WBD", name: "Warner Bros" }, { symbol: "PARA", name: "Paramount" },
  // ── Real Estate ──
  { symbol: "AMT", name: "American Tower" }, { symbol: "PLD", name: "Prologis" },
  { symbol: "O", name: "Realty Income" }, { symbol: "EQIX", name: "Equinix" },
  // ── EV & Clean Energy ──
  { symbol: "RIVN", name: "Rivian" }, { symbol: "LCID", name: "Lucid" },
  { symbol: "LI", name: "Li Auto" }, { symbol: "NIO", name: "NIO" },
  { symbol: "XPEV", name: "XPeng" }, { symbol: "ENPH", name: "Enphase" },
  { symbol: "FSLR", name: "First Solar" }, { symbol: "PLUG", name: "Plug Power" },
  // ── China ADRs ──
  { symbol: "BABA", name: "Alibaba" }, { symbol: "JD", name: "JD.com" },
  { symbol: "PDD", name: "PDD (Temu)" }, { symbol: "BIDU", name: "Baidu" },
  { symbol: "NTES", name: "NetEase" }, { symbol: "TME", name: "Tencent Music" },
  // ── ETFs ──
  { symbol: "SPY", name: "S&P 500 ETF" }, { symbol: "QQQ", name: "나스닥 100 ETF" },
  { symbol: "DIA", name: "다우 ETF" }, { symbol: "IWM", name: "Russell 2000" },
  { symbol: "ARKK", name: "ARK Innovation" }, { symbol: "ARKW", name: "ARK Next Gen" },
  { symbol: "SOXL", name: "반도체 3x" }, { symbol: "TQQQ", name: "나스닥 3x" },
  { symbol: "SQQQ", name: "나스닥 -3x" }, { symbol: "UPRO", name: "S&P 3x" },
  { symbol: "SPXS", name: "S&P -3x" },
  { symbol: "BITO", name: "ProShares BTC" }, { symbol: "BITI", name: "ProShares Short BTC" },
  { symbol: "GLD", name: "Gold ETF" }, { symbol: "SLV", name: "Silver ETF" },
  { symbol: "TLT", name: "미국 장기채" }, { symbol: "SHY", name: "미국 단기채" },
  { symbol: "SCHD", name: "배당 ETF" }, { symbol: "JEPI", name: "JP모건 인컴" },
  { symbol: "VIG", name: "배당 성장 ETF" }, { symbol: "NOBL", name: "배당 귀족 ETF" },
  { symbol: "XLF", name: "금융 Select" }, { symbol: "XLE", name: "에너지 Select" },
  { symbol: "XLK", name: "테크 Select" }, { symbol: "XLV", name: "헬스케어 Select" },
  { symbol: "XLI", name: "산업재 Select" }, { symbol: "XLC", name: "커뮤니케이션 Select" },
  { symbol: "XLRE", name: "부동산 Select" }, { symbol: "XLU", name: "유틸리티 Select" },
  { symbol: "KWEB", name: "China Internet" }, { symbol: "EEM", name: "Emerging Markets" },
  { symbol: "VNQ", name: "Real Estate" }, { symbol: "HYG", name: "High Yield Bond" },
  { symbol: "LQD", name: "Investment Grade" }, { symbol: "UNG", name: "Natural Gas" },
  { symbol: "USO", name: "원유 ETF" }, { symbol: "COPX", name: "구리 ETF" },
  { symbol: "VIX", name: "VIX 변동성" }, { symbol: "UVXY", name: "VIX 1.5x" },
];

const KR_ASSETS = [
  // ── 시가총액 Top ──
  { symbol: "005930.KS", name: "삼성전자" }, { symbol: "000660.KS", name: "SK하이닉스" },
  { symbol: "373220.KS", name: "LG에너지솔루션" }, { symbol: "207940.KS", name: "삼성바이오로직스" },
  { symbol: "005380.KS", name: "현대차" }, { symbol: "000270.KS", name: "기아" },
  { symbol: "068270.KS", name: "셀트리온" }, { symbol: "035420.KS", name: "NAVER" },
  { symbol: "035720.KS", name: "카카오" }, { symbol: "051910.KS", name: "LG화학" },
  { symbol: "006400.KS", name: "삼성SDI" },
  // ── 반도체/전자 ──
  { symbol: "066570.KS", name: "LG전자" }, { symbol: "009150.KS", name: "삼성전기" },
  { symbol: "000990.KS", name: "DB하이텍" }, { symbol: "042700.KS", name: "한미반도체" },
  { symbol: "058470.KS", name: "리노공업" },
  // ── 2차전지/소재 ──
  { symbol: "003670.KS", name: "포스코퓨처엠" }, { symbol: "247540.KS", name: "에코프로비엠" },
  { symbol: "006260.KS", name: "LS" }, { symbol: "011170.KS", name: "롯데케미칼" },
  { symbol: "010130.KS", name: "고려아연" },
  // ── 금융 ──
  { symbol: "105560.KS", name: "KB금융" }, { symbol: "055550.KS", name: "신한지주" },
  { symbol: "086790.KS", name: "하나금융지주" }, { symbol: "316140.KS", name: "우리금융지주" },
  { symbol: "000810.KS", name: "삼성화재" }, { symbol: "032830.KS", name: "삼성생명" },
  { symbol: "024110.KS", name: "기업은행" }, { symbol: "138930.KS", name: "BNK금융지주" },
  // ── 자동차/모빌리티 ──
  { symbol: "012330.KS", name: "현대모비스" }, { symbol: "018880.KS", name: "한온시스템" },
  { symbol: "161390.KS", name: "한국타이어" },
  // ── 에너지/정유/화학 ──
  { symbol: "096770.KS", name: "SK이노베이션" }, { symbol: "034730.KS", name: "SK" },
  { symbol: "010950.KS", name: "S-Oil" }, { symbol: "078930.KS", name: "GS" },
  { symbol: "036460.KS", name: "한국가스공사" },
  // ── 통신 ──
  { symbol: "017670.KS", name: "SK텔레콤" }, { symbol: "030200.KS", name: "KT" },
  { symbol: "032640.KS", name: "LG유플러스" },
  // ── 건설/중공업 ──
  { symbol: "028260.KS", name: "삼성물산" }, { symbol: "000720.KS", name: "현대건설" },
  { symbol: "009540.KS", name: "HD한국조선해양" }, { symbol: "329180.KS", name: "HD현대중공업" },
  { symbol: "010620.KS", name: "HD현대미포" },
  // ── 게임/엔터 ──
  { symbol: "259960.KS", name: "크래프톤" }, { symbol: "263750.KS", name: "펄어비스" },
  { symbol: "036570.KS", name: "엔씨소프트" }, { symbol: "251270.KS", name: "넷마블" },
  { symbol: "041510.KS", name: "에스엠" }, { symbol: "352820.KS", name: "하이브" },
  { symbol: "122870.KS", name: "와이지엔터" }, { symbol: "035900.KS", name: "JYP Ent." },
  // ── 유통/소비재 ──
  { symbol: "004170.KS", name: "신세계" }, { symbol: "023530.KS", name: "롯데쇼핑" },
  { symbol: "069960.KS", name: "현대백화점" }, { symbol: "097950.KS", name: "CJ제일제당" },
  { symbol: "003230.KS", name: "삼양식품" }, { symbol: "271560.KS", name: "오리온" },
  // ── 바이오/헬스케어 ──
  { symbol: "128940.KS", name: "한미약품" }, { symbol: "326030.KS", name: "SK바이오팜" },
  { symbol: "302440.KS", name: "SK바이오사이언스" }, { symbol: "145020.KS", name: "휴젤" },
  { symbol: "091990.KS", name: "셀트리온헬스케어" },
  // ── IT서비스 ──
  { symbol: "018260.KS", name: "삼성SDS" }, { symbol: "034220.KS", name: "LG디스플레이" },
  { symbol: "377300.KS", name: "카카오페이" }, { symbol: "323410.KS", name: "카카오뱅크" },
];

const CRYPTO_ASSETS = [
  // ── Top 10 ──
  { id: "bitcoin", symbol: "BTC", name: "Bitcoin" },
  { id: "ethereum", symbol: "ETH", name: "Ethereum" },
  { id: "binancecoin", symbol: "BNB", name: "BNB" },
  { id: "solana", symbol: "SOL", name: "Solana" },
  { id: "ripple", symbol: "XRP", name: "XRP" },
  { id: "cardano", symbol: "ADA", name: "Cardano" },
  { id: "dogecoin", symbol: "DOGE", name: "Dogecoin" },
  { id: "tron", symbol: "TRX", name: "TRON" },
  { id: "avalanche-2", symbol: "AVAX", name: "Avalanche" },
  { id: "polkadot", symbol: "DOT", name: "Polkadot" },
  // ── DeFi ──
  { id: "chainlink", symbol: "LINK", name: "Chainlink" },
  { id: "uniswap", symbol: "UNI", name: "Uniswap" },
  { id: "aave", symbol: "AAVE", name: "Aave" },
  { id: "maker", symbol: "MKR", name: "Maker" },
  { id: "lido-dao", symbol: "LDO", name: "Lido" },
  { id: "the-graph", symbol: "GRT", name: "The Graph" },
  { id: "compound-governance-token", symbol: "COMP", name: "Compound" },
  { id: "1inch", symbol: "1INCH", name: "1inch" },
  { id: "curve-dao-token", symbol: "CRV", name: "Curve" },
  { id: "pendle", symbol: "PENDLE", name: "Pendle" },
  { id: "jupiter-exchange-solana", symbol: "JUP", name: "Jupiter" },
  // ── L1/L2 ──
  { id: "near", symbol: "NEAR", name: "NEAR" },
  { id: "sui", symbol: "SUI", name: "Sui" },
  { id: "aptos", symbol: "APT", name: "Aptos" },
  { id: "cosmos", symbol: "ATOM", name: "Cosmos" },
  { id: "internet-computer", symbol: "ICP", name: "Internet Computer" },
  { id: "filecoin", symbol: "FIL", name: "Filecoin" },
  { id: "arbitrum", symbol: "ARB", name: "Arbitrum" },
  { id: "optimism", symbol: "OP", name: "Optimism" },
  { id: "polygon-ecosystem-token", symbol: "POL", name: "Polygon" },
  { id: "starknet", symbol: "STRK", name: "Starknet" },
  { id: "mantle", symbol: "MNT", name: "Mantle" },
  { id: "sei-network", symbol: "SEI", name: "Sei" },
  { id: "celestia", symbol: "TIA", name: "Celestia" },
  // ── AI & Data ──
  { id: "render-token", symbol: "RNDR", name: "Render" },
  { id: "fetch-ai", symbol: "FET", name: "Fetch.ai" },
  { id: "injective-protocol", symbol: "INJ", name: "Injective" },
  { id: "akash-network", symbol: "AKT", name: "Akash" },
  { id: "artificial-superintelligence-alliance", symbol: "ASI", name: "ASI Alliance" },
  { id: "bittensor", symbol: "TAO", name: "Bittensor" },
  // ── Meme ──
  { id: "pepe", symbol: "PEPE", name: "Pepe" },
  { id: "shiba-inu", symbol: "SHIB", name: "Shiba Inu" },
  { id: "floki", symbol: "FLOKI", name: "Floki" },
  { id: "bonk", symbol: "BONK", name: "Bonk" },
  { id: "dogwifcoin", symbol: "WIF", name: "dogwifhat" },
  // ── Stablecoins & Misc ──
  { id: "wrapped-bitcoin", symbol: "WBTC", name: "Wrapped BTC" },
  { id: "litecoin", symbol: "LTC", name: "Litecoin" },
  { id: "bitcoin-cash", symbol: "BCH", name: "Bitcoin Cash" },
  { id: "stellar", symbol: "XLM", name: "Stellar" },
  { id: "hedera-hashgraph", symbol: "HBAR", name: "Hedera" },
  { id: "algorand", symbol: "ALGO", name: "Algorand" },
  { id: "eos", symbol: "EOS", name: "EOS" },
  { id: "the-sandbox", symbol: "SAND", name: "The Sandbox" },
  { id: "decentraland", symbol: "MANA", name: "Decentraland" },
  { id: "axie-infinity", symbol: "AXS", name: "Axie Infinity" },
  { id: "gala", symbol: "GALA", name: "Gala" },
  { id: "ondo-finance", symbol: "ONDO", name: "Ondo Finance" },
];

// 전체 자산 통합 (검색용)
const ALL_ASSETS = [
  ...US_ASSETS.map(a => ({ ...a, market: "us", symbolRaw: a.symbol, searchKey: `${a.symbol} ${a.name}`.toLowerCase() })),
  ...KR_ASSETS.map(a => ({ ...a, market: "kr", symbolRaw: a.symbol, symbol: a.symbol.replace(".KS", ""), searchKey: `${a.symbol.replace(".KS","")} ${a.name}`.toLowerCase() })),
  ...CRYPTO_ASSETS.map(a => ({ ...a, market: "crypto", symbolRaw: a.id, searchKey: `${a.symbol} ${a.name} ${a.id}`.toLowerCase() })),
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
  if (!title) return "neutral";
  const t = ` ${title.toLowerCase()} `;

  // ── 강한 긍정 (가중치 2) ──
  const strongPos = ["surge","soar","record high","all-time high","skyrocket","boom","breakout",
    "급등","폭등","신고가","사상최고","돌파","대박","호실적","깜짝실적","어닝서프라이즈"];
  // ── 긍정 (가중치 1) ──
  const pos = ["rally","gain","jump","rise","bull","growth","profit","beat","outperform",
    "upgrade","buy","strong","positive","recover","rebound","advance","climb","up ",
    "상승","호재","성장","흑자","매수","상향","강세","반등","회복","호조","개선",
    "수혜","낙관","기대","확대","증가","호황","상승세","매출증가","이익증가"];
  // ── 강한 부정 (가중치 2) ──
  const strongNeg = ["crash","plunge","collapse","bankruptcy","default","crisis",
    "폭락","급락","파산","디폴트","위기","붕괴","대폭락","폭발적하락","서킷브레이커"];
  // ── 부정 (가중치 1) ──
  const neg = ["fall","drop","decline","loss","bear","sell","cut","miss","weak","concern",
    "recession","downgrade","warning","fear","risk","slump","slide","tumble","layoff",
    "하락","악재","적자","매도","하향","약세","침체","불안","우려","감소","축소",
    "둔화","손실","경고","감원","정리해고","하락세","부진","역풍"];
  // ── 부정어 앞 긍정을 뒤집는 문맥 (반전어) ──
  const negators = ["not ","no ","n't ","despite ","unlikely ","fails ","failed ",
    "않","못","없","아닌","불구","실패"];

  let score = 0;
  strongPos.forEach(w => { if (t.includes(w)) score += 2; });
  pos.forEach(w => { if (t.includes(w)) score += 1; });
  strongNeg.forEach(w => { if (t.includes(w)) score -= 2; });
  neg.forEach(w => { if (t.includes(w)) score -= 1; });

  // 반전어 감지: "not rise", "상승 않" 등
  const hasNegator = negators.some(n => t.includes(n));
  if (hasNegator && score !== 0) score = -score * 0.5;

  // "low risk" → 중립 보정, "high risk" → 부정 보정
  if (t.includes("low risk")) score += 1;
  if (t.includes("high risk")) score -= 1;
  // "cut rates" (금리인하) → 긍정 보정
  if (t.includes("cut rate") || t.includes("rate cut") || t.includes("금리인하") || t.includes("금리 인하")) score += 1;

  if (score >= 1) return "positive";
  if (score <= -1) return "negative";
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
// 색상 팔레트 (토스증권 스타일 다크 테마) — 가독성 개선
// ════════════════════════════════════════════════════════════════════
const C = {
  bg: "#0A0E17", card: "#111927", card2: "#1A2332",
  border: "#1E2D3D", border2: "#283B50",
  blue: "#3182F6", blueL: "#5AA3FF", blueBg: "#1A2C4F",
  red: "#F04452", redBg: "#2A1520",
  green: "#05C072", greenBg: "#0A2A1A",
  yellow: "#FFB400", yellowBg: "#2A2000",
  purple: "#8B5CF6", purpleBg: "#1E1535",
  text1: "#F7F8FA", text2: "#B0BEC5", text3: "#6B7D8E",
};

// ════════════════════════════════════════════════════════════════════
// 서브 컴포넌트: PullToRefresh (모바일 아래로 당겨서 새로고침)
// ════════════════════════════════════════════════════════════════════
function PullToRefresh({ onRefresh, children }) {
  const containerRef = useRef(null);
  const [pulling, setPulling] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef(0);
  const THRESHOLD = 80;

  const handleTouchStart = useCallback((e) => {
    if (window.scrollY === 0) {
      startY.current = e.touches[0].clientY;
      setPulling(true);
    }
  }, []);

  const handleTouchMove = useCallback((e) => {
    if (!pulling) return;
    const diff = e.touches[0].clientY - startY.current;
    if (diff > 0 && window.scrollY === 0) {
      setPullDistance(Math.min(diff * 0.5, 120));
    }
  }, [pulling]);

  const handleTouchEnd = useCallback(async () => {
    if (pullDistance >= THRESHOLD && !refreshing) {
      setRefreshing(true);
      setPullDistance(50);
      try { await onRefresh(); } catch {}
      setRefreshing(false);
    }
    setPulling(false);
    setPullDistance(0);
  }, [pullDistance, refreshing, onRefresh]);

  return (
    <div ref={containerRef} onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd}>
      {pullDistance > 0 && (
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          height: `${pullDistance}px`, overflow: "hidden",
          transition: pulling ? "none" : "height .3s ease",
        }}>
          <div style={{
            fontSize: "20px",
            transform: `rotate(${Math.min(pullDistance / THRESHOLD, 1) * 360}deg)`,
            transition: pulling ? "none" : "transform .3s ease",
            opacity: Math.min(pullDistance / THRESHOLD, 1),
          }}>
            {refreshing ? "⏳" : pullDistance >= THRESHOLD ? "↻" : "↓"}
          </div>
          <span style={{ marginLeft: "8px", fontSize: "13px", color: C.text3, fontWeight: 600 }}>
            {refreshing ? "새로고침 중..." : pullDistance >= THRESHOLD ? "놓으면 새로고침" : "아래로 당기기"}
          </span>
        </div>
      )}
      {children}
    </div>
  );
}

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
// 서브 컴포넌트: SearchBar (글로벌 종목 검색 + 자동완성)
// ════════════════════════════════════════════════════════════════════
function SearchBar({ onSelect, placeholder = "종목 검색 (예: AAPL, 삼성전자, BTC...)" }) {
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const inputRef = useRef(null);
  const dropRef = useRef(null);

  const suggestions = useMemo(() => {
    if (!query || query.length < 1) return [];
    const q = query.toLowerCase().trim();
    const matched = ALL_ASSETS.filter(a => a.searchKey.includes(q));
    // 정렬: 심볼 정확 매치 > 심볼 시작 매치 > 이름 매치
    matched.sort((a, b) => {
      const aSymExact = a.symbol.toLowerCase() === q ? 0 : 1;
      const bSymExact = b.symbol.toLowerCase() === q ? 0 : 1;
      if (aSymExact !== bSymExact) return aSymExact - bSymExact;
      const aSymStart = a.symbol.toLowerCase().startsWith(q) ? 0 : 1;
      const bSymStart = b.symbol.toLowerCase().startsWith(q) ? 0 : 1;
      if (aSymStart !== bSymStart) return aSymStart - bSymStart;
      return a.symbol.localeCompare(b.symbol);
    });
    return matched.slice(0, 12);
  }, [query]);

  const handleKeyDown = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIdx(i => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIdx(i => Math.max(i - 1, -1));
    } else if (e.key === "Enter" && selectedIdx >= 0 && suggestions[selectedIdx]) {
      e.preventDefault();
      onSelect(suggestions[selectedIdx]);
      setQuery(""); setFocused(false); setSelectedIdx(-1);
      inputRef.current?.blur();
    } else if (e.key === "Escape") {
      setFocused(false); setSelectedIdx(-1);
      inputRef.current?.blur();
    }
  };

  // 클릭 밖 감지
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropRef.current && !dropRef.current.contains(e.target) && inputRef.current && !inputRef.current.contains(e.target)) {
        setFocused(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => { setSelectedIdx(-1); }, [query]);

  const showDrop = focused && suggestions.length > 0;

  return (
    <div style={{ position: "relative", width: "100%" }}>
      <div style={{ position: "relative" }}>
        <span style={{ position: "absolute", left: "14px", top: "50%", transform: "translateY(-50%)", fontSize: "16px", color: C.text3, pointerEvents: "none" }}>🔍</span>
        <input
          ref={inputRef}
          value={query}
          onChange={e => setQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          style={{
            width: "100%", padding: "13px 16px 13px 42px", borderRadius: "14px", fontSize: "14px",
            background: C.card, border: `1px solid ${focused ? C.blue : C.border}`, color: C.text1,
            outline: "none", transition: "border-color .2s, box-shadow .2s",
            boxShadow: focused ? `0 0 0 3px ${C.blue}22` : "none",
            boxSizing: "border-box",
          }}
        />
        {query && (
          <button onClick={() => { setQuery(""); inputRef.current?.focus(); }} style={{
            position: "absolute", right: "12px", top: "50%", transform: "translateY(-50%)",
            background: "none", border: "none", color: C.text3, fontSize: "16px", cursor: "pointer", padding: "4px",
          }}>✕</button>
        )}
      </div>
      {showDrop && (
        <div ref={dropRef} style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 200,
          background: C.card, border: `1px solid ${C.border}`, borderRadius: "14px",
          boxShadow: "0 8px 32px rgba(0,0,0,.5)", overflow: "hidden", maxHeight: "380px", overflowY: "auto",
        }}>
          {suggestions.map((asset, i) => {
            const flag = asset.market === "us" ? "🇺🇸" : asset.market === "kr" ? "🇰🇷" : "₿";
            const isActive = i === selectedIdx;
            return (
              <div key={`${asset.symbol}-${asset.market}-${i}`}
                onClick={() => { onSelect(asset); setQuery(""); setFocused(false); setSelectedIdx(-1); }}
                onMouseEnter={() => setSelectedIdx(i)}
                style={{
                  display: "flex", alignItems: "center", gap: "12px",
                  padding: "12px 16px", cursor: "pointer",
                  background: isActive ? C.blueBg : "transparent",
                  borderBottom: i < suggestions.length - 1 ? `1px solid ${C.border}` : "none",
                  transition: "background .15s",
                }}>
                <div style={{
                  width: "36px", height: "36px", borderRadius: "10px", flexShrink: 0,
                  background: asset.market === "us" ? "#1A2C4F" : asset.market === "kr" ? "#1A2A1E" : "#1E1A2A",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontWeight: 800, fontSize: "9px",
                  color: asset.market === "us" ? C.blue : asset.market === "kr" ? C.green : C.purple,
                }}>
                  {asset.symbol.length <= 5 ? asset.symbol : asset.symbol.slice(0, 5)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: "14px", color: C.text1 }}>{asset.name}</div>
                  <div style={{ fontSize: "12px", color: C.text3 }}>{flag} {asset.symbol}{asset.market === "kr" ? ".KS" : ""}</div>
                </div>
                <div style={{
                  padding: "3px 8px", borderRadius: "6px", fontSize: "10px", fontWeight: 600,
                  background: asset.market === "us" ? `${C.blue}18` : asset.market === "kr" ? `${C.green}18` : `${C.purple}18`,
                  color: asset.market === "us" ? C.blue : asset.market === "kr" ? C.green : C.purple,
                }}>
                  {asset.market === "us" ? "US" : asset.market === "kr" ? "KR" : "Crypto"}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
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
  const [tab, setTab] = useState("home");
  const [menuOpen, setMenuOpen] = useState(false);

  // ── 홈 대시보드 상태 ───────────────────────────────────────────
  const [marketIndices, setMarketIndices] = useState([]);
  const [marketLoading, setMarketLoading] = useState(false);
  const [hotAssets, setHotAssets] = useState([]);

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

  // ── 홈 대시보드 데이터 ─────────────────────────────────────────
  const fetchMarketOverview = useCallback(async () => {
    if (marketLoading) return;
    setMarketLoading(true);
    const indices = [
      { symbol: "^GSPC", name: "S&P 500", flag: "🇺🇸" },
      { symbol: "^IXIC", name: "NASDAQ", flag: "🇺🇸" },
      { symbol: "^DJI", name: "다우존스", flag: "🇺🇸" },
      { symbol: "^KS11", name: "코스피", flag: "🇰🇷" },
      { symbol: "^KQ11", name: "코스닥", flag: "🇰🇷" },
      { symbol: "USDKRW=X", name: "원/달러 환율", flag: "💱" },
    ];
    const results = [];
    for (const idx of indices) {
      try {
        const r = await fetch(`/api/yahoo?symbol=${encodeURIComponent(idx.symbol)}&interval=1d&range=5d&_t=${Date.now()}`);
        if (r.ok) {
          const j = await r.json();
          const closes = j.closes || [];
          if (closes.length >= 2) {
            const cur = closes[closes.length - 1];
            const prev = closes[closes.length - 2];
            const change = ((cur - prev) / prev) * 100;
            results.push({ ...idx, price: cur, change: +change.toFixed(2) });
          }
        }
      } catch {}
    }
    setMarketIndices(results);
    // Hot assets — 주요 종목 가격
    const hots = [
      { symbol: "NVDA", name: "NVIDIA", market: "us" },
      { symbol: "AAPL", name: "Apple", market: "us" },
      { symbol: "TSLA", name: "Tesla", market: "us" },
      { symbol: "MSFT", name: "Microsoft", market: "us" },
      { symbol: "005930.KS", name: "삼성전자", market: "kr" },
      { symbol: "000660.KS", name: "SK하이닉스", market: "kr" },
    ];
    const hotResults = [];
    for (const h of hots) {
      try {
        const r = await fetch(`/api/yahoo?symbol=${encodeURIComponent(h.symbol)}&interval=1d&range=5d&_t=${Date.now()}`);
        if (r.ok) {
          const j = await r.json();
          const closes = j.closes || [];
          if (closes.length >= 2) {
            const cur = closes[closes.length - 1];
            const prev = closes[closes.length - 2];
            hotResults.push({ ...h, price: cur, change: +( ((cur - prev) / prev) * 100 ).toFixed(2), symbolRaw: h.symbol });
          }
        }
      } catch {}
    }
    // Crypto hots
    for (const cId of ["bitcoin", "ethereum", "solana"]) {
      try {
        const r = await fetch(`/api/coingecko?id=${cId}&days=2&_t=${Date.now()}`);
        if (r.ok) {
          const j = await r.json();
          const dp = (j.prices || []).map(p => p[1]);
          if (dp.length >= 2) {
            const cur = dp[dp.length - 1];
            const prev = dp[0];
            const name = cId === "bitcoin" ? "Bitcoin" : cId === "ethereum" ? "Ethereum" : "Solana";
            const sym = cId === "bitcoin" ? "BTC" : cId === "ethereum" ? "ETH" : "SOL";
            hotResults.push({ symbol: sym, name, market: "crypto", price: cur, change: +( ((cur - prev) / prev) * 100 ).toFixed(2), symbolRaw: cId });
          }
        }
        await new Promise(r => setTimeout(r, 1200));
      } catch {}
    }
    setHotAssets(hotResults);
    setMarketLoading(false);
  }, [marketLoading]);

  useEffect(() => { if (tab === "home" && marketIndices.length === 0) fetchMarketOverview(); }, [tab]);

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
        * { box-sizing: border-box; margin: 0; -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; }
        html { font-size: 16px; line-height: 1.5; }
        body { letter-spacing: -0.01em; }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: ${C.border2}; border-radius: 3px; }
        button, a { cursor: pointer; font-family: inherit; }
        input, select { font-family: inherit; font-size: 14px; }
        input:focus { border-color: ${C.blue} !important; box-shadow: 0 0 0 3px ${C.blue}18; }
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
          <div onClick={() => { setTab("home"); setMenuOpen(false); }} style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", userSelect: "none" }}
            title="홈으로 이동">
            <span style={{ fontSize: "20px" }}>📡</span>
            <span style={{ fontWeight: 800, fontSize: "17px" }}>DI금융</span>
            <span style={{ padding: "1px 7px", borderRadius: "4px", fontSize: "10px", fontWeight: 700, background: C.blueBg, color: C.blue }}>v5</span>
          </div>
          {/* 데스크톱 네비게이션 */}
          <nav className="desktop-nav" style={{ display: "flex", gap: "2px" }}>
            {[{ id: "home", label: "홈", icon: "🏠" }, { id: "screener", label: "스크리너", icon: "🔍" }, { id: "strategy", label: "전략", icon: "🎯" }, { id: "backtest", label: "백테스트", icon: "📊" }, { id: "portfolio", label: "포트폴리오", icon: "💼" }, { id: "news", label: "뉴스", icon: "📰" }, { id: "alerts", label: "알림", icon: "🔔" }].map(t => (
              <button key={t.id} onClick={() => setTab(t.id)} style={{
                padding: "6px 10px", borderRadius: "8px", fontSize: "12px", fontWeight: 600,
                background: tab === t.id ? C.blueBg : "transparent",
                color: tab === t.id ? C.blue : C.text3, border: "none", whiteSpace: "nowrap",
              }}>{t.icon} {t.label}</button>
            ))}
          </nav>
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
            {[{ id: "home", label: "홈", icon: "🏠" }, { id: "screener", label: "스크리너", icon: "🔍" }, { id: "strategy", label: "전략", icon: "🎯" }, { id: "backtest", label: "백테스트", icon: "📊" }, { id: "portfolio", label: "포트폴리오", icon: "💼" }, { id: "news", label: "뉴스", icon: "📰" }, { id: "alerts", label: "알림", icon: "🔔" }].map(t => (
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

      <PullToRefresh onRefresh={async () => {
        if (tab === "home") await fetchMarketOverview();
        else if (tab === "portfolio") await fetchPortfolioPrices();
        else if (tab === "news") await fetchNews();
        else window.location.reload();
      }}>
      <main style={{ maxWidth: "900px", margin: "0 auto", padding: "20px" }}>

        {/* ═══════════════════════════════════════════════════════════
            TAB: 홈 (토스 스타일 대시보드)
        ═══════════════════════════════════════════════════════════ */}
        {tab === "home" && (
          <div>
            {/* 검색바 */}
            <div style={{ marginBottom: "20px" }}>
              <SearchBar onSelect={(asset) => {
                setChartAsset(asset);
              }} />
            </div>

            {/* 시장 지수 요약 */}
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "16px", padding: "18px", marginBottom: "16px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "14px" }}>
                <div style={{ fontWeight: 700, fontSize: "16px" }}>📊 시장 현황</div>
                <button onClick={fetchMarketOverview} disabled={marketLoading} style={{
                  padding: "5px 12px", borderRadius: "8px", fontSize: "11px", fontWeight: 600,
                  background: C.card2, color: C.text3, border: `1px solid ${C.border2}`, cursor: "pointer",
                }}>{marketLoading ? "⏳" : "🔄"}</button>
              </div>
              {marketIndices.length === 0 ? (
                <div style={{ textAlign: "center", padding: "20px", color: C.text3, fontSize: "13px" }}>
                  {marketLoading ? "시장 데이터 로딩 중..." : "데이터를 불러오려면 새로고침을 누르세요"}
                </div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: "8px" }}>
                  {marketIndices.map(idx => (
                    <div key={idx.symbol} style={{
                      background: C.bg, borderRadius: "12px", padding: "12px", textAlign: "center",
                      border: `1px solid ${C.border}`,
                    }}>
                      <div style={{ fontSize: "11px", color: C.text3, marginBottom: "4px" }}>{idx.flag} {idx.name}</div>
                      <div style={{ fontWeight: 700, fontSize: "15px", color: C.text1, marginBottom: "2px" }}>
                        {idx.name.includes("환율") ? `₩${Math.round(idx.price).toLocaleString()}` : idx.price.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </div>
                      <div style={{
                        fontSize: "12px", fontWeight: 600,
                        color: idx.change >= 0 ? C.green : C.red,
                      }}>
                        {idx.change >= 0 ? "▲" : "▼"} {Math.abs(idx.change)}%
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 인기 종목 */}
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "16px", padding: "18px", marginBottom: "16px" }}>
              <div style={{ fontWeight: 700, fontSize: "16px", marginBottom: "14px" }}>🔥 주요 종목</div>
              {hotAssets.length === 0 ? (
                <div style={{ textAlign: "center", padding: "16px", color: C.text3, fontSize: "13px" }}>
                  {marketLoading ? "로딩 중..." : "시장 현황 로드 시 함께 표시됩니다"}
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  {hotAssets.map(asset => {
                    const flag = asset.market === "us" ? "🇺🇸" : asset.market === "kr" ? "🇰🇷" : "₿";
                    const isPos = asset.change >= 0;
                    return (
                      <div key={asset.symbol} onClick={() => setChartAsset(asset)}
                        style={{
                          display: "flex", alignItems: "center", justifyContent: "space-between",
                          padding: "12px 14px", borderRadius: "12px", cursor: "pointer",
                          background: "transparent", transition: "background .15s",
                        }}
                        onMouseEnter={e => e.currentTarget.style.background = C.card2}
                        onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                          <div style={{
                            width: "38px", height: "38px", borderRadius: "10px", flexShrink: 0,
                            background: asset.market === "us" ? "#1A2C4F" : asset.market === "kr" ? "#1A2A1E" : "#1E1A2A",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            fontWeight: 800, fontSize: "10px",
                            color: asset.market === "us" ? C.blue : asset.market === "kr" ? C.green : C.purple,
                          }}>{asset.symbol.replace(".KS","").slice(0,4)}</div>
                          <div>
                            <div style={{ fontWeight: 600, fontSize: "14px", color: C.text1 }}>{asset.name}</div>
                            <div style={{ fontSize: "12px", color: C.text3 }}>{flag} {asset.symbol.replace(".KS","")}</div>
                          </div>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <div style={{ fontWeight: 700, fontSize: "15px", color: C.text1 }}>
                            {fmtPrice(asset.price, asset.market)}
                          </div>
                          <div style={{ fontSize: "12px", fontWeight: 600, color: isPos ? C.green : C.red }}>
                            {isPos ? "▲" : "▼"} {Math.abs(asset.change)}%
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* 포트폴리오 미니 요약 */}
            {portfolio.length > 0 && (
              <div style={{ background: `linear-gradient(135deg, ${C.card}, #0d1f35)`, border: `1px solid ${C.border}`, borderRadius: "16px", padding: "18px", marginBottom: "16px", cursor: "pointer" }}
                onClick={() => setTab("portfolio")}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
                  <div style={{ fontWeight: 700, fontSize: "16px" }}>💼 내 포트폴리오</div>
                  <span style={{ fontSize: "12px", color: C.text3 }}>{portfolio.length}개 종목 →</span>
                </div>
                <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                  {portfolio.slice(0, 5).map((item, i) => (
                    <div key={i} style={{
                      padding: "6px 12px", borderRadius: "8px", fontSize: "12px", fontWeight: 600,
                      background: C.bg, color: C.text2, border: `1px solid ${C.border}`,
                    }}>
                      {item.name || item.symbol}
                    </div>
                  ))}
                  {portfolio.length > 5 && (
                    <div style={{ padding: "6px 12px", borderRadius: "8px", fontSize: "12px", color: C.text3 }}>+{portfolio.length - 5}개</div>
                  )}
                </div>
              </div>
            )}

            {/* 빠른 액세스 */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: "10px", marginBottom: "16px" }}>
              {[
                { icon: "🔍", label: "스크리너", desc: "조건 검색", tab: "screener" },
                { icon: "🎯", label: "전략", desc: "24개 전략", tab: "strategy" },
                { icon: "📊", label: "백테스트", desc: "성과 시뮬레이션", tab: "backtest" },
                { icon: "📰", label: "뉴스", desc: "투자 뉴스", tab: "news" },
              ].map(item => (
                <div key={item.tab} onClick={() => setTab(item.tab)}
                  style={{
                    background: C.card, border: `1px solid ${C.border}`, borderRadius: "14px",
                    padding: "18px 14px", cursor: "pointer", textAlign: "center",
                    transition: "all .2s",
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = C.blue; e.currentTarget.style.transform = "translateY(-2px)"; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.transform = "translateY(0)"; }}>
                  <div style={{ fontSize: "28px", marginBottom: "8px" }}>{item.icon}</div>
                  <div style={{ fontWeight: 700, fontSize: "14px", marginBottom: "4px", color: C.text1 }}>{item.label}</div>
                  <div style={{ fontSize: "11px", color: C.text3 }}>{item.desc}</div>
                </div>
              ))}
            </div>

            {/* 전체 종목 리스트 */}
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "16px", padding: "18px" }}>
              <div style={{ fontWeight: 700, fontSize: "16px", marginBottom: "14px" }}>
                📋 전체 종목 ({ALL_ASSETS.length}개)
              </div>
              <div style={{ display: "flex", gap: "6px", marginBottom: "12px", flexWrap: "wrap" }}>
                {[["all","전체"], ["us","🇺🇸 미국"], ["kr","🇰🇷 한국"], ["crypto","₿ 크립토"]].map(([v, l]) => (
                  <button key={v} onClick={() => setFilterMarket(v)} style={{
                    padding: "5px 12px", borderRadius: "8px", fontSize: "12px", fontWeight: 600,
                    background: filterMarket === v ? C.blueBg : "transparent",
                    color: filterMarket === v ? C.blue : C.text3, border: `1px solid ${filterMarket === v ? C.blue : C.border2}`,
                  }}>{l}</button>
                ))}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: "6px", maxHeight: "320px", overflow: "auto" }}>
                {ALL_ASSETS.filter(a => filterMarket === "all" || a.market === filterMarket).map((asset, i) => {
                  const flag = asset.market === "us" ? "🇺🇸" : asset.market === "kr" ? "🇰🇷" : "₿";
                  return (
                    <div key={`${asset.symbol}-${i}`} onClick={() => setChartAsset(asset)}
                      style={{
                        padding: "10px 12px", borderRadius: "10px", cursor: "pointer",
                        background: C.card2, border: `1px solid ${C.border}`, transition: "border-color .15s",
                        display: "flex", alignItems: "center", gap: "8px",
                      }}
                      onMouseEnter={e => e.currentTarget.style.borderColor = C.blue}
                      onMouseLeave={e => e.currentTarget.style.borderColor = C.border}>
                      <span style={{ fontSize: "12px" }}>{flag}</span>
                      <div style={{ minWidth: 0, overflow: "hidden" }}>
                        <div style={{ fontWeight: 600, fontSize: "12px", color: C.text1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{asset.name}</div>
                        <div style={{ fontSize: "10px", color: C.text3 }}>{asset.symbol}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

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
                {/* 종목 검색으로 자동 입력 */}
                <div style={{ marginBottom: "12px" }}>
                  <div style={{ fontSize: "11px", color: C.text3, marginBottom: "6px" }}>종목 검색 (심볼 또는 이름 입력)</div>
                  <SearchBar placeholder="종목 검색 (예: AAPL, 삼성, BTC...)" onSelect={(asset) => {
                    const sym = asset.symbol.toUpperCase();
                    setNewAsset(p => ({
                      ...p,
                      symbol: sym,
                      name: asset.name,
                      market: asset.market,
                    }));
                  }} />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "12px" }}>
                  {[
                    { k: "symbol",   label: "심볼", ph: "AAPL, 005930..." },
                    { k: "name",     label: "자산명", ph: "Apple, 삼성전자..." },
                    { k: "qty",      label: "보유 수량", ph: "0.00" },
                    { k: "avgPrice", label: "평균 매입가", ph: "0.00" },
                  ].map(({ k, label, ph }) => (
                    <div key={k}>
                      <div style={{ fontSize: "11px", color: C.text3, marginBottom: "4px" }}>{label}</div>
                      <input value={newAsset[k]} onChange={e => setNewAsset(p => ({ ...p, [k]: e.target.value }))}
                        placeholder={ph} style={{
                          width: "100%", padding: "9px 12px", borderRadius: "10px", fontSize: "13px",
                          background: C.bg, border: `1px solid ${C.border2}`, color: C.text1, outline: "none",
                          boxSizing: "border-box",
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
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {portfolio.map((item, idx) => {
                  const cur = portfolioPrices[item.symbol];
                  const gain = cur ? ((cur - item.avgPrice) / item.avgPrice) * 100 : 0;
                  const gainVal = cur ? item.qty * (cur - item.avgPrice) : 0;
                  const isPos = gainVal >= 0;
                  const mcColor = item.market === "us" ? C.blue : item.market === "kr" ? C.green : C.purple;
                  const mcBg = item.market === "us" ? "#1A2C4F" : item.market === "kr" ? "#1A2A1E" : "#1E1A2A";
                  const flag = item.market === "us" ? "🇺🇸" : item.market === "kr" ? "🇰🇷" : "₿";
                  return (
                    <div key={idx} style={{
                      background: C.card, border: `1px solid ${C.border}`, borderRadius: "16px", overflow: "hidden",
                    }}>
                      <div style={{ display: "flex", alignItems: "center", padding: "16px 18px", gap: "14px" }}>
                        {/* 심볼 아이콘 */}
                        <div style={{
                          width: "44px", height: "44px", borderRadius: "12px", background: mcBg, flexShrink: 0,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontWeight: 800, fontSize: "10px", color: mcColor,
                        }}>
                          {item.symbol.replace(".KS","").slice(0,4)}
                        </div>
                        {/* 종목 정보 */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "3px" }}>
                            <span style={{ fontWeight: 700, fontSize: "15px", color: C.text1 }}>{item.name || item.symbol}</span>
                            <span style={{ fontSize: "12px", color: C.text3 }}>{flag} {item.symbol}</span>
                          </div>
                          <div style={{ fontSize: "13px", color: C.text3 }}>
                            {item.qty.toLocaleString()}주 · 평균 {toDisplay(item.avgPrice, item.market)}
                          </div>
                        </div>
                        {/* 현재가 & 수익률 */}
                        <div style={{ textAlign: "right", flexShrink: 0 }}>
                          <div style={{ fontWeight: 700, fontSize: "16px", color: C.text1, marginBottom: "2px" }}>
                            {toDisplay(cur, item.market)}
                          </div>
                          <div style={{ fontSize: "13px", fontWeight: 700, color: isPos ? C.green : C.red }}>
                            {isPos ? "+" : ""}{gain.toFixed(2)}%
                          </div>
                        </div>
                      </div>
                      {/* 하단 액션 바 */}
                      <div style={{
                        display: "flex", gap: "8px", padding: "0 18px 14px",
                        borderTop: "none",
                      }}>
                        <button onClick={() => {
                          const cryptoA = CRYPTO_ASSETS.find(c => c.symbol === item.symbol);
                          setChartAsset({
                            symbol: item.symbol, name: item.name || item.symbol,
                            market: item.market, symbolRaw: item.symbolRaw || item.symbol,
                            ...(cryptoA ? { id: cryptoA.id } : {}),
                          });
                        }} style={{
                          flex: 1, padding: "9px 0", borderRadius: "10px", fontSize: "13px", fontWeight: 600,
                          background: C.blueBg, color: C.blue, border: `1px solid ${C.blue}33`,
                          display: "flex", alignItems: "center", justifyContent: "center", gap: "6px",
                        }}>📈 차트</button>
                        <button onClick={() => {
                          const sym = item.market === "crypto"
                            ? `https://www.coingecko.com/en/coins/${item.cryptoId || item.symbol.toLowerCase()}`
                            : `https://finance.yahoo.com/quote/${item.symbolRaw || item.symbol}`;
                          window.open(sym, "_blank");
                        }} style={{
                          flex: 1, padding: "9px 0", borderRadius: "10px", fontSize: "13px", fontWeight: 600,
                          background: C.card2, color: C.text2, border: `1px solid ${C.border2}`,
                          display: "flex", alignItems: "center", justifyContent: "center", gap: "6px",
                        }}>🔗 상세</button>
                        <button onClick={() => setPortfolio(p => p.filter((_, i) => i !== idx))} style={{
                          padding: "9px 14px", borderRadius: "10px", fontSize: "13px", fontWeight: 600,
                          background: C.redBg, color: C.red, border: `1px solid ${C.red}33`,
                        }}>삭제</button>
                      </div>
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
        {chartAsset && <ChartModal asset={chartAsset} onClose={() => setChartAsset(null)} krwRate={krwRate} />}
      </main>
      </PullToRefresh>
    </div>
  );
}
