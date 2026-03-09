// Vercel Cron Job — 자동 스캔 + 텔레그램 알림
// vercel.json 에서 스케줄 설정 (예: 매일 오전 9시)
//
// 환경변수 설정 필요 (Vercel Dashboard → Settings → Environment Variables):
//   TELEGRAM_BOT_TOKEN  = 봇 토큰
//   TELEGRAM_CHAT_ID    = 챗 ID
//   ALERT_CONDITIONS    = 쉼표 구분 조건 (기본: rsi30,ma200,bb_lower,macd_golden,volume_spike)
//   ALERT_MODE          = or | and (기본: or)

// ─── 감시할 자산 목록 ───
const US_SYMBOLS = [
  "AAPL","MSFT","GOOGL","AMZN","NVDA","META","TSLA","AMD","NFLX","INTC",
  "BA","DIS","PYPL","SNAP","UBER","COIN","SQ","PLTR","V","MA",
  "JPM","GS","BAC","WFC","AXP","CRM","ORCL","ADBE","QCOM","MU",
];

const KR_SYMBOLS = [
  "005930.KS","000660.KS","035420.KS","035720.KS","051910.KS",
  "006400.KS","003670.KS","105560.KS","055550.KS","068270.KS",
  "207940.KS","066570.KS","005380.KS","000270.KS","086790.KS",
];

const KR_NAMES = {
  "005930.KS":"삼성전자","000660.KS":"SK하이닉스","035420.KS":"NAVER","035720.KS":"카카오",
  "051910.KS":"LG화학","006400.KS":"삼성SDI","003670.KS":"포스코퓨처엠","105560.KS":"KB금융",
  "055550.KS":"신한지주","068270.KS":"셀트리온","207940.KS":"삼성바이오로직스",
  "066570.KS":"LG전자","005380.KS":"현대차","000270.KS":"기아","086790.KS":"하나금융지주",
};

const CRYPTO_IDS = [
  "bitcoin","ethereum","solana","ripple","cardano",
  "avalanche-2","polkadot","chainlink","dogecoin","uniswap",
];

const CRYPTO_SYMBOLS = {
  "bitcoin":"BTC","ethereum":"ETH","solana":"SOL","ripple":"XRP","cardano":"ADA",
  "avalanche-2":"AVAX","polkadot":"DOT","chainlink":"LINK","dogecoin":"DOGE","uniswap":"UNI",
};

// ─── 기술적 분석 함수 ───
function calcRSI(closes, period = 14) {
  if (closes.length < period + 1) return null;
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i-1];
    if (d >= 0) avgGain += d; else avgLoss -= d;
  }
  avgGain /= period; avgLoss /= period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i-1];
    avgGain = (avgGain*(period-1) + Math.max(d,0)) / period;
    avgLoss = (avgLoss*(period-1) + Math.max(-d,0)) / period;
  }
  return avgLoss === 0 ? 100 : 100 - 100/(1 + avgGain/avgLoss);
}

function calcSMA(data, period) {
  if (data.length < period) return null;
  return data.slice(-period).reduce((a,b)=>a+b,0) / period;
}

function calcBB(closes, period=20, mult=2) {
  if (closes.length < period) return null;
  const s = closes.slice(-period);
  const mean = s.reduce((a,b)=>a+b,0)/period;
  const std = Math.sqrt(s.reduce((a,b)=>a+(b-mean)**2,0)/period);
  return { upper: mean+mult*std, middle: mean, lower: mean-mult*std };
}

function calcMACD(closes) {
  if (closes.length < 35) return { goldenCross: false };
  const k12=2/13, k26=2/27, k9=2/10;
  let e12=closes.slice(0,12).reduce((a,b)=>a+b,0)/12;
  let e26=closes.slice(0,26).reduce((a,b)=>a+b,0)/26;
  const macdArr=[];
  for (let i=0; i<closes.length; i++) {
    if (i>=12) e12=closes[i]*k12+e12*(1-k12);
    if (i>=26) { e26=closes[i]*k26+e26*(1-k26); macdArr.push(e12-e26); }
  }
  if (macdArr.length < 9) return { goldenCross: false };
  let sig=macdArr.slice(0,9).reduce((a,b)=>a+b,0)/9;
  for (let i=9; i<macdArr.length; i++) sig=macdArr[i]*k9+sig*(1-k9);
  let prevSig=macdArr.slice(0,9).reduce((a,b)=>a+b,0)/9;
  for (let i=9; i<macdArr.length-1; i++) prevSig=macdArr[i]*k9+prevSig*(1-k9);
  const cur=macdArr[macdArr.length-1], prev=macdArr[macdArr.length-2];
  return { goldenCross: prev<=prevSig && cur>sig, macdLine: cur, signalLine: sig };
}

function analyzeSignals(weeklyCloses, dailyCloses, volumes, conditions) {
  const price = weeklyCloses[weeklyCloses.length-1];
  const rsi = calcRSI(weeklyCloses, 14);
  const ma200 = calcSMA(dailyCloses, 200);
  const bb = calcBB(weeklyCloses);
  const macd = calcMACD(weeklyCloses);
  const avgVol = volumes.slice(-20).reduce((a,b)=>a+b,0) / Math.min(volumes.length,20);
  const curVol = volumes[volumes.length-1]||0;
  const volRatio = avgVol>0 ? curVol/avgVol : 0;
  const ma200Dist = ma200 ? ((price-ma200)/ma200)*100 : null;
  const prev = weeklyCloses.length>=2 ? weeklyCloses[weeklyCloses.length-2] : price;
  const weekChange = ((price-prev)/prev)*100;

  const triggers = [];
  if (conditions.includes("rsi30")       && rsi!=null && rsi<=30)                           triggers.push("rsi30");
  if (conditions.includes("ma200")        && ma200Dist!=null && Math.abs(ma200Dist)<=2)      triggers.push("ma200");
  if (conditions.includes("bb_lower")     && bb && price<=bb.lower*1.01)                    triggers.push("bb_lower");
  if (conditions.includes("macd_golden")  && macd.goldenCross)                              triggers.push("macd_golden");
  if (conditions.includes("volume_spike") && volRatio>=2)                                   triggers.push("volume_spike");

  return {
    triggers,
    price: +price.toFixed(4),
    rsi: rsi!=null ? +rsi.toFixed(1) : null,
    weekChange: +weekChange.toFixed(2),
    ma200Dist: ma200Dist!=null ? +ma200Dist.toFixed(2) : null,
    volRatio: +volRatio.toFixed(1),
  };
}

// ─── Yahoo Finance cookie/crumb 인증 ───
let _cookie = null;
let _crumb = null;
let _expires = 0;

async function getYahooAuth() {
  const now = Date.now();
  if (_cookie && _crumb && now < _expires) return { cookie: _cookie, crumb: _crumb };
  const initRes = await fetch("https://fc.yahoo.com", {
    redirect: "follow",
    headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" },
  });
  const cookies = initRes.headers.get("set-cookie") || "";
  const crumbRes = await fetch("https://query2.finance.yahoo.com/v1/test/getcrumb", {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Cookie": cookies,
    },
  });
  if (!crumbRes.ok) throw new Error(`Crumb failed: ${crumbRes.status}`);
  const crumb = await crumbRes.text();
  _cookie = cookies; _crumb = crumb; _expires = now + 10 * 60 * 1000;
  return { cookie: _cookie, crumb: _crumb };
}

// ─── 데이터 수집 함수 ───
async function fetchYahoo(symbol, interval, range) {
  const { cookie, crumb } = await getYahooAuth();
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}&crumb=${encodeURIComponent(crumb)}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "application/json",
      "Cookie": cookie,
    },
  });
  if (res.status === 401 || res.status === 403) {
    _cookie = null; _crumb = null; _expires = 0;
    return fetchYahoo(symbol, interval, range); // 재시도
  }
  if (!res.ok) throw new Error(`Yahoo ${res.status}`);
  const json = await res.json();
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error("No data");
  const q = result.indicators?.quote?.[0];
  return {
    closes: (q?.close||[]).filter(v=>v!=null),
    volumes: (q?.volume||[]).filter(v=>v!=null),
  };
}

async function fetchCoinGecko(id) {
  const url = `https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=365&interval=daily`;
  const res = await fetch(url, { headers: { "Accept": "application/json" } });
  if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
  return res.json();
}

// ─── 텔레그램 전송 ───
async function sendTelegram(botToken, chatId, assets, conditions) {
  const COND_LABELS = {
    rsi30: "📉 RSI ≤ 30",
    ma200: "📊 200일선 터치",
    bb_lower: "🎯 BB 하단",
    macd_golden: "✨ MACD 골든크로스",
    volume_spike: "🔥 거래량 급증",
  };

  let msg = `🚨 *DI금융 자동 알림*\n\n`;
  msg += `📅 ${new Date().toLocaleDateString("ko-KR", {timeZone:"Asia/Seoul"})} `;
  msg += `${new Date().toLocaleTimeString("ko-KR", {timeZone:"Asia/Seoul"})}\n`;
  msg += `📊 시그널 감지: *${assets.length}개* 자산\n`;
  msg += `🔍 조건: ${conditions.map(c=>COND_LABELS[c]||c).join(", ")}\n\n`;

  assets.slice(0, 20).forEach(a => {
    const flag = a.market==="us"?"🇺🇸":a.market==="kr"?"🇰🇷":"₿";
    const price = a.market==="kr"
      ? `₩${Math.round(a.price).toLocaleString()}`
      : `$${a.price?.toLocaleString(undefined, {maximumFractionDigits: a.price<1?6:2})}`;
    const chg = a.weekChange>=0 ? `+${a.weekChange}%` : `${a.weekChange}%`;
    const sigs = a.triggers.map(t=>COND_LABELS[t]||t).join(" · ");
    msg += `${flag} *${a.name}* \`${a.symbol}\`\n`;
    msg += `   ${price} | ${chg} | RSI ${a.rsi??"—"}\n`;
    msg += `   ${sigs}\n\n`;
  });

  if (assets.length > 20) msg += `_...외 ${assets.length-20}개 자산_\n\n`;
  msg += `_⚠️ 기술적 지표 기반 — 투자 추천 아님_`;

  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: msg, parse_mode: "Markdown" }),
  });
  return res.json();
}

// ─── 메인 핸들러 ───
export default async function handler(req, res) {
  // Vercel Cron 인증 (무단 호출 방지)
  const authHeader = req.headers["authorization"];
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const BOT_TOKEN  = process.env.TELEGRAM_BOT_TOKEN;
  const CHAT_ID    = process.env.TELEGRAM_CHAT_ID;
  const CONDITIONS = (process.env.ALERT_CONDITIONS || "rsi30,ma200,bb_lower,macd_golden,volume_spike").split(",");
  const MODE       = process.env.ALERT_MODE || "or";

  if (!BOT_TOKEN || !CHAT_ID) {
    return res.status(400).json({ error: "TELEGRAM_BOT_TOKEN 또는 TELEGRAM_CHAT_ID 환경변수가 없습니다." });
  }

  const signaled = [];
  const errors   = [];

  console.log(`[Cron] 스캔 시작 — 조건: ${CONDITIONS.join(",")} / 모드: ${MODE}`);

  // ── US 주식 스캔 ──
  for (const symbol of US_SYMBOLS) {
    try {
      const [weekly, daily] = await Promise.all([
        fetchYahoo(symbol, "1wk", "2y"),
        fetchYahoo(symbol, "1d",  "1y"),
      ]);
      const result = analyzeSignals(weekly.closes, daily.closes, weekly.volumes, CONDITIONS);
      const match = MODE==="or"
        ? result.triggers.length > 0
        : CONDITIONS.every(c => result.triggers.includes(c));
      if (match) signaled.push({ symbol, name: symbol, market: "us", ...result });
    } catch(e) { errors.push(`US:${symbol} - ${e.message}`); }
    await new Promise(r => setTimeout(r, 100));
  }

  // ── 한국 주식 스캔 ──
  for (const symbol of KR_SYMBOLS) {
    try {
      const [weekly, daily] = await Promise.all([
        fetchYahoo(symbol, "1wk", "2y"),
        fetchYahoo(symbol, "1d",  "1y"),
      ]);
      const result = analyzeSignals(weekly.closes, daily.closes, weekly.volumes, CONDITIONS);
      const match = MODE==="or"
        ? result.triggers.length > 0
        : CONDITIONS.every(c => result.triggers.includes(c));
      if (match) signaled.push({ symbol: symbol.replace(".KS",""), name: KR_NAMES[symbol]||symbol, market: "kr", ...result });
    } catch(e) { errors.push(`KR:${symbol} - ${e.message}`); }
    await new Promise(r => setTimeout(r, 100));
  }

  // ── 크립토 스캔 ──
  for (const id of CRYPTO_IDS) {
    try {
      const json = await fetchCoinGecko(id);
      const dailyPrices  = (json.prices||[]).map(p=>p[1]);
      const dailyVolumes = (json.total_volumes||[]).map(v=>v[1]);
      const weeklyCloses=[], weeklyVolumes=[];
      for (let i=6; i<dailyPrices.length; i+=7) {
        weeklyCloses.push(dailyPrices[i]);
        weeklyVolumes.push(dailyVolumes.slice(Math.max(0,i-6),i+1).reduce((a,b)=>a+b,0));
      }
      const result = analyzeSignals(weeklyCloses, dailyPrices, weeklyVolumes, CONDITIONS);
      const match = MODE==="or"
        ? result.triggers.length > 0
        : CONDITIONS.every(c => result.triggers.includes(c));
      if (match) signaled.push({ symbol: CRYPTO_SYMBOLS[id]||id.toUpperCase(), name: id.charAt(0).toUpperCase()+id.slice(1).replace(/-/g," "), market: "crypto", ...result });
    } catch(e) { errors.push(`Crypto:${id} - ${e.message}`); }
    await new Promise(r => setTimeout(r, 700)); // CoinGecko rate limit
  }

  console.log(`[Cron] 스캔 완료 — 시그널 ${signaled.length}개 / 오류 ${errors.length}개`);

  // 시그널 있을 때만 텔레그램 전송
  if (signaled.length > 0) {
    const tgResult = await sendTelegram(BOT_TOKEN, CHAT_ID, signaled, CONDITIONS);
    console.log("[Cron] 텔레그램 전송:", tgResult.ok ? "성공" : tgResult.description);
    return res.status(200).json({ ok: true, signaled: signaled.length, errors, telegram: tgResult.ok });
  } else {
    console.log("[Cron] 시그널 없음 — 텔레그램 전송 생략");
    return res.status(200).json({ ok: true, signaled: 0, message: "시그널 없음", errors });
  }
}
