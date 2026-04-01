// Vercel Cron — 멀티 자산 암호화폐 자동매매 서버사이드 엔진
// 1시간마다 실행: BTC, ETH, SOL 캔들 데이터 → 전략 시그널 생성 → Alpaca 주문
// market-monitor가 KV에 쌓은 레짐 데이터를 참조하여 적응형 매매
// 환경변수: ALPACA_API_KEY, ALPACA_SECRET_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID

export const config = { maxDuration: 120 };

const CRYPTO_ASSETS = ["BTC/USD", "ETH/USD", "SOL/USD", "AVAX/USD", "LINK/USD", "DOGE/USD"];
const YAHOO_TICKERS = { "BTC/USD": "BTC-USD", "ETH/USD": "ETH-USD", "SOL/USD": "SOL-USD", "AVAX/USD": "AVAX-USD", "LINK/USD": "LINK-USD", "DOGE/USD": "DOGE-USD" };
const MAX_POSITION_PER_ASSET = 0.30;
const MAX_TOTAL_CRYPTO_EXPOSURE = 0.80;

export default async function handler(req, res) {
  const startTime = Date.now();
  const log = [];
  const addLog = (msg) => { log.push(`[${new Date().toISOString()}] ${msg}`); console.log(msg); };

  try {
    addLog("🚀 크립토 자동매매 Cron 시작 (1h 간격)");

    // ── KV에서 market-monitor 레짐 데이터 로드 ──
    let marketRegime = null;
    let monitorAlerts = [];
    try {
      const kvModule = await import("@vercel/kv");
      const kv = kvModule.kv;
      marketRegime = await kv.get("di:market:regime");
      monitorAlerts = (await kv.get("di:market:alerts")) || [];
      if (marketRegime) {
        addLog(`📡 마켓 모니터 레짐: ${marketRegime.regime} (H=${marketRegime.avgHurst?.toFixed(2)}, ER=${marketRegime.avgER?.toFixed(2)})`);
      }
      if (monitorAlerts.length > 0) {
        addLog(`🚨 활성 알림 ${monitorAlerts.length}건`);
      }
    } catch {
      addLog("⚠️ KV 미연결 — 기본 모드");
    }

    // ── 환경변수 확인 ──
    const ALPACA_KEY = process.env.ALPACA_API_KEY;
    const ALPACA_SECRET = process.env.ALPACA_SECRET_KEY;
    const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const TG_CHAT = process.env.TELEGRAM_CHAT_ID;

    if (!ALPACA_KEY || !ALPACA_SECRET) {
      addLog("❌ ALPACA_API_KEY 또는 ALPACA_SECRET_KEY 환경변수 없음");
      return res.status(200).json({ ok: false, error: "Missing Alpaca credentials", log });
    }

    // ── Alpaca 계좌 확인 ──
    addLog("💰 Alpaca 계좌 조회...");
    const alpacaBase = "https://paper-api.alpaca.markets";
    const alpacaHeaders = {
      "APCA-API-KEY-ID": ALPACA_KEY,
      "APCA-API-SECRET-KEY": ALPACA_SECRET,
      "Content-Type": "application/json",
    };

    const accRes = await fetch(`${alpacaBase}/v2/account`, { headers: alpacaHeaders });
    const account = await accRes.json();
    if (!accRes.ok) {
      addLog(`❌ Alpaca 계좌 오류: ${JSON.stringify(account)}`);
      return res.status(200).json({ ok: false, error: "Alpaca account error", log });
    }

    const equity = parseFloat(account.equity || 0);
    const cash = parseFloat(account.cash || 0);
    addLog(`✅ 계좌: $${equity.toFixed(0)} (현금: $${cash.toFixed(0)})`);

    // ── 포지션 확인 ──
    const posRes = await fetch(`${alpacaBase}/v2/positions`, { headers: alpacaHeaders });
    const positions = await posRes.json();
    const positionMap = {};
    if (Array.isArray(positions)) {
      for (const asset of CRYPTO_ASSETS) {
        const pos = positions.find(p => p.symbol === asset);
        if (pos) positionMap[asset] = pos;
      }
    }

    // ── Fear & Greed Index 페치 ──
    let fngData = null;
    let fngValue = 50; // 기본값: Neutral
    let fngClassification = "Neutral";
    try {
      const fngRes = await fetch("https://api.alternative.me/fng/?limit=1");
      const fngJson = await fngRes.json();
      if (fngJson.data && fngJson.data.length > 0) {
        fngValue = parseInt(fngJson.data[0].value);
        fngClassification = fngJson.data[0].value_classification;
        fngData = { value: fngValue, classification: fngClassification };
        addLog(`📊 Fear & Greed: ${fngValue} (${fngClassification})`);
      }
    } catch (e) {
      addLog(`⚠️ FNG API 오류: ${e.message} (기본값 사용)`);
    }

    // ── 멀티 자산 스캔 및 주문 실행 ──
    const assetResults = [];
    let totalCryptoExposure = 0;

    for (const asset of CRYPTO_ASSETS) {
      addLog(`\n📊 ${asset} 스캔 중...`);
      const yahooTicker = YAHOO_TICKERS[asset];

      // Yahoo Finance 데이터 로드
      // 멀티 타임프레임: 일봉(1y) + 4시간봉(60d) 모두 로드
      const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooTicker}?range=1y&interval=1d`;
      const yahoo4hUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooTicker}?range=60d&interval=60m`;
      let yahooData, result;
      try {
        const yahooRes = await fetch(yahooUrl, {
          headers: { "User-Agent": "Mozilla/5.0 (DI-Financial Cron)" },
        });
        yahooData = await yahooRes.json();
        result = yahooData?.chart?.result?.[0];
      } catch (e) {
        addLog(`❌ ${asset} Yahoo 데이터 오류: ${e.message}`);
        assetResults.push({ asset, ok: false, error: "Yahoo data fetch failed" });
        continue;
      }

      if (!result || !result.timestamp) {
        addLog(`❌ ${asset} Yahoo 데이터 없음`);
        assetResults.push({ asset, ok: false, error: "No Yahoo data" });
        continue;
      }

      const timestamps = result.timestamp;
      const q = result.indicators.quote[0];
      const candles = timestamps.map((t, i) => ({
        time: t,
        open: q.open[i],
        high: q.high[i],
        low: q.low[i],
        close: q.close[i],
        volume: q.volume[i],
      })).filter(c => c.close != null && c.high != null && c.low != null);

      if (candles.length < 100) {
        addLog(`❌ ${asset} 캔들 부족 (${candles.length}개 < 100개)`);
        assetResults.push({ asset, ok: false, error: "Insufficient candle data" });
        continue;
      }

      // 4시간봉 로드 (추가 시그널 소스)
      let candles4h = [];
      try {
        const res4h = await fetch(yahoo4hUrl, {
          headers: { "User-Agent": "Mozilla/5.0 (DI-Financial Cron)" },
        });
        const data4h = await res4h.json();
        const r4h = data4h?.chart?.result?.[0];
        if (r4h && r4h.timestamp) {
          const q4h = r4h.indicators.quote[0];
          candles4h = r4h.timestamp.map((t, i) => ({
            time: t, open: q4h.open[i], high: q4h.high[i], low: q4h.low[i], close: q4h.close[i], volume: q4h.volume[i],
          })).filter(c => c.close != null && c.high != null && c.low != null);
        }
      } catch { /* 4h 실패해도 일봉으로 계속 */ }

      addLog(`✅ ${asset}: 일봉 ${candles.length}개 + 4h ${candles4h.length}개 (최신: $${candles[candles.length - 1]?.close?.toFixed(0)})`);

      // 지표 계산
      const closes = candles.map(c => c.close);
      const highs = candles.map(c => c.high);
      const lows = candles.map(c => c.low);
      const volumes = candles.map(c => c.volume || 0);

      const rsi = calcRSI(closes, 14);
      const bb = calcBB(closes, 20, 2.0); // BB multiplier 2.0으로 변경
      const ema21 = calcEMA(closes, 21);
      const ema55 = calcEMA(closes, 55);
      const ema200 = calcEMA(closes, 200);
      const { macdLine, signal: macdSig, histogram } = calcMACD(closes);
      const adx = calcADX(highs, lows, closes, 14);
      const atr = calcATR(highs, lows, closes, 14);
      const stoch = calcStochastic(highs, lows, closes, 14, 3);
      const obv = calcOBV(closes, volumes);
      const obvEma = calcEMA(obv, 20);
      const volSMA = calcSMA(volumes, 20);

      // 주봉 추세
      const weeklyCandles = resampleWeekly(candles);
      const wCloses = weeklyCandles.map(c => c.close);
      const wEma10 = wCloses.length > 10 ? calcEMA(wCloses, 10) : [];
      const wEma30 = wCloses.length > 30 ? calcEMA(wCloses, 30) : [];
      const weeklyTrendUp = wEma10.length > 0 && wEma30.length > 0
        ? wEma10[wEma10.length - 1] > wEma30[wEma30.length - 1] : null;

      // 최근 시그널 분석 (market-monitor 레짐 연동)
      // monitorAlerts에서 현재 자산 관련 알림 추출
      const assetAlerts = monitorAlerts.filter(a => a.ticker === yahooTicker);
      let latestSignal = analyzeLatest(candles, closes, highs, lows, volumes, {
        rsi, bb, ema21, ema55, ema200, macdLine, macdSig, histogram,
        adx, atr, stoch, obv, obvEma, volSMA, weeklyTrendUp,
      }, fngValue, marketRegime, assetAlerts);

      // 일봉에서 시그널 없으면 4시간봉으로 재시도
      if (!latestSignal && candles4h.length >= 61) {
        addLog(`🔄 ${asset} 일봉 시그널 없음 → 4시간봉 분석...`);
        const c4h = candles4h;
        const closes4h = c4h.map(c => c.close);
        const highs4h = c4h.map(c => c.high);
        const lows4h = c4h.map(c => c.low);
        const volumes4h = c4h.map(c => c.volume || 0);
        const rsi4h = calcRSI(closes4h, 14);
        const bb4h = calcBB(closes4h, 20, 2.0);
        const ema21_4h = calcEMA(closes4h, 21);
        const ema55_4h = calcEMA(closes4h, 55);
        const ema200_4h = closes4h.length > 200 ? calcEMA(closes4h, 200) : [];
        const macd4h = calcMACD(closes4h);
        const adx4h = calcADX(highs4h, lows4h, closes4h, 14);
        const atr4h = calcATR(highs4h, lows4h, closes4h, 14);
        const stoch4h = calcStochastic(highs4h, lows4h, closes4h, 14, 3);
        const obv4h = calcOBV(closes4h, volumes4h);
        const obvEma4h = calcEMA(obv4h, 20);
        const volSMA4h = calcSMA(volumes4h, 20);
        latestSignal = analyzeLatest(c4h, closes4h, highs4h, lows4h, volumes4h, {
          rsi: rsi4h, bb: bb4h, ema21: ema21_4h, ema55: ema55_4h, ema200: ema200_4h,
          macdLine: macd4h.macdLine, macdSig: macd4h.signal, histogram: macd4h.histogram,
          adx: adx4h, atr: atr4h, stoch: stoch4h, obv: obv4h, obvEma: obvEma4h, volSMA: volSMA4h, weeklyTrendUp,
        }, fngValue, marketRegime, assetAlerts);
        if (latestSignal) {
          latestSignal.reason = `[4h] ${latestSignal.reason}`;
          // 4시간봉 시그널은 포지션 크기 50%로 축소
          latestSignal.positionSize = (latestSignal.positionSize || 0.5) * 0.5;
        }
      }

      if (!latestSignal) {
        addLog(`⏸️ ${asset} 시그널 없음 (일봉+4시간봉 모두)`);
        assetResults.push({ asset, ok: true, action: "wait", signal: null });
        continue;
      }

      addLog(`🎯 ${asset} 시그널: ${latestSignal.type} | ${latestSignal.confidence}급 | ${latestSignal.score}pt`);

      // 현재 포지션 확인
      const pos = positionMap[asset];
      const currentExposure = pos ? parseFloat(pos.market_value || 0) : 0;
      const positionSize = latestSignal.positionSize || 0.5;

      // 포지션 크기 결정
      const maxAssetValue = equity * MAX_POSITION_PER_ASSET;
      let tradeAmount = 0;

      // Trailing stop-loss 확인: 포지션이 있으면 -5% 체크
      let shouldSellForStopLoss = false;
      if (pos && pos.unrealized_pl != null) {
        const plPct = (parseFloat(pos.unrealized_pl) / parseFloat(pos.cost_basis || 1)) * 100;
        if (plPct <= -5) {
          shouldSellForStopLoss = true;
          addLog(`🛑 ${asset} 손절: P&L ${plPct.toFixed(1)}%`);
        }
      }

      // BUY 주문 실행 (현금 기준 — 레버리지 미사용)
      if (latestSignal.type === "BUY" && !shouldSellForStopLoss) {
        const availableCash = cash - totalCryptoExposure;
        const maxCashPerAsset = cash * MAX_POSITION_PER_ASSET;
        if (pos) {
          const addAmount = cash * positionSize * 0.25;
          if (currentExposure + addAmount <= maxCashPerAsset && addAmount <= availableCash) {
            tradeAmount = Math.min(addAmount, maxCashPerAsset - currentExposure, availableCash);
          }
        } else {
          tradeAmount = Math.min(cash * positionSize * 0.25, maxCashPerAsset, availableCash);
        }

        if (latestSignal.type === "BUY" && tradeAmount > 10) {
          addLog(`🟢 ${asset} 매수: $${tradeAmount.toFixed(0)}`);
          const orderRes = await fetch(`${alpacaBase}/v2/orders`, {
            method: "POST",
            headers: alpacaHeaders,
            body: JSON.stringify({
              symbol: asset,
              notional: tradeAmount.toFixed(2),
              side: "buy",
              type: "market",
              time_in_force: "gtc",
            }),
          });
          const orderResult = await orderRes.json();
          if (orderRes.ok) {
            addLog(`✅ ${asset} 매수 완료: ${orderResult.id}`);
            assetResults.push({ asset, ok: true, type: "BUY", signal: latestSignal, order: orderResult.id, amount: tradeAmount });
            totalCryptoExposure += tradeAmount;
          } else {
            addLog(`❌ ${asset} 매수 실패: ${JSON.stringify(orderResult)}`);
            assetResults.push({ asset, ok: false, error: `Buy failed: ${orderResult.code}` });
          }
        }
      }

      // SELL 주문 실행
      if ((latestSignal.type === "SELL" || shouldSellForStopLoss) && pos) {
        const sellAmount = parseFloat(pos.market_value || 0);
        if (sellAmount > 10) {
          addLog(`🔴 ${asset} 매도: $${sellAmount.toFixed(0)}`);
          const orderRes = await fetch(`${alpacaBase}/v2/orders`, {
            method: "POST",
            headers: alpacaHeaders,
            body: JSON.stringify({
              symbol: asset,
              notional: sellAmount.toFixed(2),
              side: "sell",
              type: "market",
              time_in_force: "gtc",
            }),
          });
          const orderResult = await orderRes.json();
          if (orderRes.ok) {
            addLog(`✅ ${asset} 매도 완료: ${orderResult.id}`);
            assetResults.push({ asset, ok: true, type: "SELL", signal: latestSignal, order: orderResult.id, amount: sellAmount });
            totalCryptoExposure -= sellAmount;
          } else {
            addLog(`❌ ${asset} 매도 실패: ${JSON.stringify(orderResult)}`);
            assetResults.push({ asset, ok: false, error: `Sell failed: ${orderResult.code}` });
          }
        }
      }

      if (!latestSignal || (latestSignal.type === "BUY" && tradeAmount <= 10)) {
        assetResults.push({ asset, ok: true, action: "skip", signal: latestSignal });
      }
    }

    // ── 텔레그램 알림 ──
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    const tgMsg = buildTelegramMessage(assetResults, positionMap, equity, cash, duration, fngData);

    await sendTelegram(TG_TOKEN, TG_CHAT, tgMsg);
    addLog(`📨 텔레그램 전송 완료 (${duration}s)`);

    return res.status(200).json({
      ok: true,
      results: assetResults,
      duration: `${duration}s`,
      log,
    });

  } catch (e) {
    addLog(`💥 에러: ${e.message}`);
    return res.status(200).json({ ok: false, error: e.message, log });
  }
}

// ════════════════════════════════════════════════════════
// 텔레그램 메시지 생성
// ════════════════════════════════════════════════════════
function buildTelegramMessage(assetResults, positionMap, equity, cash, duration, fngData) {
  const now = new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul", hour12: false });
  const lines = [
    `🤖 *DI금융 크립토 자동매매 리포트*`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `📅 ${now}`,
  ];

  // Fear & Greed with visual gauge
  if (fngData) {
    const fVal = fngData.value;
    const fBar = fVal <= 25 ? '🟥🟥🟥⬜⬜' : fVal <= 45 ? '🟧🟧🟧⬜⬜' : fVal <= 55 ? '🟨🟨🟨⬜⬜' : fVal <= 75 ? '🟩🟩🟩⬜⬜' : '🟩🟩🟩🟩🟩';
    const fAdvice = fVal <= 25 ? '극공포 → 매수 기회 탐색' : fVal <= 45 ? '공포 → 선별적 매수' : fVal <= 55 ? '중립 → 시그널 대기' : fVal <= 75 ? '탐욕 → 신중한 매수' : '극탐욕 → 이익 확보 우선';
    lines.push(`📊 F&G: ${fVal} ${fBar}`);
    lines.push(`   ${fngData.classification} → ${fAdvice}`);
  }

  lines.push(``);

  // Asset signals with detailed breakdown
  const hasAction = assetResults.some(r => r.signal);
  if (hasAction) {
    lines.push(`🔍 *시그널 분석*`);
  }

  for (const result of assetResults) {
    if (result.signal) {
      const icon = result.signal.type === "BUY" ? "🟢" : "🔴";
      const grade = result.signal.confidence === "A" ? "⭐⭐⭐" : result.signal.confidence === "B" ? "⭐⭐" : "⭐";
      const actionEmoji = result.type === "BUY" ? " → 매수 체결!" : result.type === "SELL" ? " → 매도 체결!" : "";
      lines.push(`${icon} *${result.asset}*: ${result.signal.type} ${grade} (${result.signal.score}pt/${result.signal.factors}F)${actionEmoji}`);
      lines.push(`   📝 ${result.signal.reason}`);
      if (result.amount) {
        lines.push(`   💵 체결: $${result.amount.toFixed(0)}`);
      }
    } else if (result.action === "wait" || result.action === "skip") {
      lines.push(`⏸️ ${result.asset}: 시그널 대기`);
    } else if (!result.ok) {
      lines.push(`⚠️ ${result.asset}: ${result.error || '오류'}`);
    }
  }

  // Portfolio with risk metrics
  lines.push(``, `💰 *포트폴리오*`);
  lines.push(`━━━━━━━━━━━━━━━━━━━━`);
  const cashPct = equity > 0 ? ((cash / equity) * 100) : 0;
  lines.push(`계좌: $${equity.toFixed(0)} | 현금: $${cash.toFixed(0)} (${cashPct.toFixed(0)}%)`);

  let totalCryptoValue = 0;
  let totalCryptoPnL = 0;
  for (const asset of CRYPTO_ASSETS) {
    const pos = positionMap[asset];
    if (pos) {
      const mv = parseFloat(pos.market_value || 0);
      const pl = parseFloat(pos.unrealized_pl || 0);
      const cost = parseFloat(pos.cost_basis || 0);
      const plPct = cost > 0 ? ((pl / cost) * 100) : 0;
      const weight = equity > 0 ? ((mv / equity) * 100) : 0;
      totalCryptoValue += mv;
      totalCryptoPnL += pl;
      const icon = pl >= 0 ? "📈" : "📉";
      lines.push(`${icon} ${asset}: $${mv.toFixed(0)} (${plPct >= 0 ? '+' : ''}${plPct.toFixed(1)}%) [${weight.toFixed(0)}%]`);
    }
  }

  if (totalCryptoValue > 0) {
    const totalExposure = equity > 0 ? ((totalCryptoValue / equity) * 100) : 0;
    lines.push(`──`);
    lines.push(`📊 크립토 노출: ${totalExposure.toFixed(0)}%/${(MAX_TOTAL_CRYPTO_EXPOSURE * 100).toFixed(0)}% | P/L: $${totalCryptoPnL >= 0 ? '+' : ''}${totalCryptoPnL.toFixed(0)}`);
  }

  lines.push(``, `⏱️ ${duration}s | DI금융 Crypto v3`);
  return lines.join("\n");
}

// ════════════════════════════════════════════════════════
// Hurst 지수 계산 (R/S 분석)
// ════════════════════════════════════════════════════════
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

// ════════════════════════════════════════════════════════
// Kaufman 효율성 비율 계산
// ════════════════════════════════════════════════════════
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

// ════════════════════════════════════════════════════════
// 3-Layer 알파 시그널 분석 (최근 시그널 분석)
// ════════════════════════════════════════════════════════
function analyzeLatest(candles, closes, highs, lows, volumes, ind, fngValue = 50, marketRegime = null, assetAlerts = []) {
  const { rsi, bb, ema21, ema55, ema200, macdLine, macdSig, histogram,
    adx, atr, stoch, obv, obvEma, volSMA, weeklyTrendUp } = ind;

  const lastIdx = closes.length - 1;
  if (lastIdx < 60) return null;

  const price = closes[lastIdx];
  const prevPrice = closes[lastIdx - 1];
  const atrPct = atr[lastIdx] && price > 0 ? (atr[lastIdx] / price) * 100 : 2;
  const posSize = atrPct > 5 ? 0.3 : atrPct > 3 ? 0.5 : atrPct > 1.5 ? 0.7 : 0.9;

  // Fear & Greed에 따른 동적 임계값 (v4: 훨씬 더 공격적)
  // buyFactorsThreshold는 0 — score만 넘으면 시그널 발생
  let buyThreshold, buyFactorsThreshold, sellThreshold, sellFactorsThreshold;
  if (fngValue <= 25) { buyThreshold = 1; buyFactorsThreshold = 0; sellThreshold = 3; sellFactorsThreshold = 1; }
  else if (fngValue <= 45) { buyThreshold = 1; buyFactorsThreshold = 0; sellThreshold = 2; sellFactorsThreshold = 0; }
  else if (fngValue <= 55) { buyThreshold = 1; buyFactorsThreshold = 0; sellThreshold = 1; sellFactorsThreshold = 0; }
  else if (fngValue <= 75) { buyThreshold = 2; buyFactorsThreshold = 0; sellThreshold = 1; sellFactorsThreshold = 0; }
  else { buyThreshold = 3; buyFactorsThreshold = 0; sellThreshold = 1; sellFactorsThreshold = 0; }

  // ── market-monitor 레짐 데이터로 임계값 미세 조정 ──
  if (marketRegime) {
    if (marketRegime.regime === "trending") {
      // 추세 시장: 추세 방향 매매를 더 쉽게
      buyThreshold = Math.max(2, buyThreshold - 1);
      sellThreshold = Math.max(2, sellThreshold - 1);
    } else if (marketRegime.regime === "mean_reverting") {
      // 평균회귀 시장: 역추세 진입에 더 관대
      buyThreshold = Math.max(2, buyThreshold - 1);
    }
  }

  let buyScore = 0, buyFactors = 0;
  let sellScore = 0, sellFactors = 0;
  const reasons = [];

  // ═══════════════════════════════════════════════════════
  // LAYER 1: 독자 알파 전략 (시장 비효율성 포착)
  // ═══════════════════════════════════════════════════════

  // 1) Hurst 레짐 분석 — 추세 vs 평균회귀 판별
  const hurst = calcHurst(closes.slice(-100));
  const isHurstTrending = hurst > 0.55;
  const isHurstMeanRev = hurst < 0.45;

  // 2) 효율성 비율 — 추세 탄생/소멸 감지
  const er = calcEfficiencyRatio(closes, 10);
  const curER = er[er.length - 1] || 0;
  const prevER = (er[er.length - 2] + er[er.length - 3] + er[er.length - 4]) / 3 || 0;
  const erSurge = curER > 0.6 && prevER < 0.4;
  const erCollapse = curER < 0.2 && prevER > 0.5;

  // 3) 변동성 군집 (ATR 수축→폭발)
  const atrLongMA = calcSMA(atr.map(v => v || 0), 50);
  const atrRatio = atr[lastIdx] && atrLongMA[atrLongMA.length - 1] > 0
    ? atr[lastIdx] / atrLongMA[atrLongMA.length - 1] : 1;
  const volExpanding = atrRatio > 1.8;

  // 4) 모멘텀 감쇠 (1차/2차 도함수)
  const mom10 = lastIdx > 10 ? ((price - closes[lastIdx - 10]) / closes[lastIdx - 10]) * 100 : 0;
  const momPrev = lastIdx > 11 ? ((closes[lastIdx - 1] - closes[lastIdx - 11]) / closes[lastIdx - 11]) * 100 : 0;
  const momDecaying = mom10 > 2 && mom10 < momPrev;
  const momRecovering = mom10 < -2 && mom10 > momPrev;

  // 5) 정보흐름 감지 (가격보합 + 거래량 급증 = 스마트머니)
  const priceFlatRange = Math.abs(price - closes[lastIdx - 3]) / closes[lastIdx - 3] * 100;
  const volAvg = volSMA[lastIdx] || 1;
  const vol3barSurge = volumes[lastIdx] > volAvg * 2 && volumes[lastIdx - 1] > volAvg * 1.5 && volumes[lastIdx - 2] > volAvg * 1.5;
  const lastOBV = obv[lastIdx];
  const lastObvEma = obvEma[obvEma.length - 1] || 0;
  const smartMoneyAccum = priceFlatRange < 1.5 && vol3barSurge && lastOBV > lastObvEma;
  const smartMoneyDist = priceFlatRange < 1.5 && vol3barSurge && lastOBV < lastObvEma;

  // ═══════════════════════════════════════════════════════
  // LAYER 2: 알파 시그널 스코어링
  // ═══════════════════════════════════════════════════════

  // Hurst 추세레짐 + 돌파 (v3: 조건 완화)
  if (isHurstTrending) {
    const high20 = Math.max(...highs.slice(-20));
    const low20 = Math.min(...lows.slice(-20));
    if (price >= high20 * 0.97) {
      buyScore += 3; buyFactors++;
      reasons.push(`Hurst${hurst.toFixed(2)} 추세레짐 고점근접`);
    }
    if (price <= low20 * 1.03) {
      sellScore += 3; sellFactors++;
      reasons.push(`Hurst${hurst.toFixed(2)} 추세레짐 저점근접`);
    }
  }
  // Hurst 방향 시그널 (v4: 0.48 이상이면 방향성 참고)
  if (hurst > 0.48 && price > ema21[lastIdx]) {
    buyScore += 1; reasons.push(`Hurst${hurst.toFixed(2)} 상승`);
  }
  if (hurst > 0.48 && price < ema21[lastIdx]) {
    sellScore += 1; reasons.push(`Hurst${hurst.toFixed(2)} 하락`);
  }

  // Hurst 평균회귀레짐 + RSI 역추세 (v3: RSI 완화 40/60)
  if (isHurstMeanRev) {
    if (rsi[lastIdx] < 40 && rsi[lastIdx] > rsi[lastIdx - 1]) {
      buyScore += 3; buyFactors++;
      reasons.push(`Hurst${hurst.toFixed(2)} 회귀레짐 RSI반등`);
    }
    if (rsi[lastIdx] > 60 && rsi[lastIdx] < rsi[lastIdx - 1]) {
      sellScore += 3; sellFactors++;
      reasons.push(`Hurst${hurst.toFixed(2)} 회귀레짐 RSI하락`);
    }
  }

  // 효율성 비율 추세 탄생/소멸
  if (erSurge) {
    const dir = price > closes[lastIdx - 10] ? 'buy' : 'sell';
    if (dir === 'buy') { buyScore += 3; buyFactors++; reasons.push(`ER ${curER.toFixed(2)} 추세탄생↑`); }
    else { sellScore += 3; sellFactors++; reasons.push(`ER ${curER.toFixed(2)} 추세탄생↓`); }
  }
  if (erCollapse) {
    const dir = price > closes[lastIdx - 3] ? 'sell' : 'buy';
    if (dir === 'buy') { buyScore += 1; buyFactors++; reasons.push(`ER 추세소멸 반전매수`); }
    else { sellScore += 1; sellFactors++; reasons.push(`ER 추세소멸 이탈매도`); }
  }

  // 변동성 군집 돌파 (v3: 1.3x도 약한 시그널)
  if (volExpanding && price > prevPrice) {
    buyScore += 2; buyFactors++;
    reasons.push(`ATR폭발 ${atrRatio.toFixed(1)}x 상방`);
  } else if (volExpanding && price < prevPrice) {
    sellScore += 2; sellFactors++;
    reasons.push(`ATR폭발 ${atrRatio.toFixed(1)}x 하방`);
  } else if (atrRatio > 1.3 && price > prevPrice) {
    buyScore += 1; buyFactors++;
    reasons.push(`ATR확대 ${atrRatio.toFixed(1)}x↑`);
  } else if (atrRatio > 1.3 && price < prevPrice) {
    sellScore += 1; sellFactors++;
    reasons.push(`ATR확대 ${atrRatio.toFixed(1)}x↓`);
  }

  // 모멘텀 감쇠 (선행 반전 포착)
  if (momDecaying && rsi[lastIdx] > 60) {
    sellScore += 2; sellFactors++;
    reasons.push(`모멘텀감쇠 ${mom10.toFixed(1)}%↘`);
  }
  if (momRecovering && rsi[lastIdx] < 40) {
    buyScore += 2; buyFactors++;
    reasons.push(`하락감쇠 ${mom10.toFixed(1)}%↗`);
  }

  // 스마트머니 매집/분산
  if (smartMoneyAccum) {
    buyScore += 3; buyFactors++;
    reasons.push(`스마트머니 매집`);
  }
  if (smartMoneyDist) {
    sellScore += 3; sellFactors++;
    reasons.push(`스마트머니 분산`);
  }

  // ═══════════════════════════════════════════════════════
  // LAYER 3: 기존 지표 보조 확인 (가중치 축소)
  // ═══════════════════════════════════════════════════════

  // RSI 보조 (v4: 구간 더 넓힘)
  if (rsi[lastIdx] < 25) { buyScore += 2; buyFactors++; reasons.push(`RSI ${rsi[lastIdx].toFixed(0)} 극과매도`); }
  else if (rsi[lastIdx] < 40 && rsi[lastIdx] > rsi[lastIdx - 1]) { buyScore += 1; buyFactors++; reasons.push(`RSI ${rsi[lastIdx].toFixed(0)} 반등`); }
  else if (rsi[lastIdx] < 50) { buyScore += 1; reasons.push(`RSI ${rsi[lastIdx].toFixed(0)} 매수권`); }
  if (rsi[lastIdx] > 75) { sellScore += 2; sellFactors++; reasons.push(`RSI ${rsi[lastIdx].toFixed(0)} 극과매수`); }
  else if (rsi[lastIdx] > 60 && rsi[lastIdx] < rsi[lastIdx - 1]) { sellScore += 1; sellFactors++; reasons.push(`RSI ${rsi[lastIdx].toFixed(0)} 하락`); }
  else if (rsi[lastIdx] > 50) { sellScore += 1; reasons.push(`RSI ${rsi[lastIdx].toFixed(0)} 매도권`); }

  // MACD 보조
  if (macdLine[lastIdx] > macdSig[lastIdx] && macdLine[lastIdx - 1] <= macdSig[lastIdx - 1]) {
    buyScore += 1; buyFactors++; reasons.push("MACD 골든");
  } else if (histogram[lastIdx] > 0 && histogram[lastIdx] > histogram[lastIdx - 1]) {
    buyScore += 1;
  }
  if (macdLine[lastIdx] < macdSig[lastIdx] && macdLine[lastIdx - 1] >= macdSig[lastIdx - 1]) {
    sellScore += 1; sellFactors++; reasons.push("MACD 데드");
  } else if (histogram[lastIdx] < 0 && histogram[lastIdx] < histogram[lastIdx - 1]) {
    sellScore += 1;
  }

  // EMA 보조 (v3: 크로스오버 + 추세 방향 모두 반영)
  if (ema21[lastIdx] > ema55[lastIdx]) { buyScore += 1; buyFactors++; reasons.push("EMA21>55"); }
  if (ema21[lastIdx] < ema55[lastIdx]) { sellScore += 1; sellFactors++; reasons.push("EMA21<55"); }
  // EMA 골든/데드 크로스
  if (ema21[lastIdx] > ema55[lastIdx] && ema21[lastIdx - 1] <= ema55[lastIdx - 1]) {
    buyScore += 2; buyFactors++; reasons.push("EMA 골든크로스");
  }
  if (ema21[lastIdx] < ema55[lastIdx] && ema21[lastIdx - 1] >= ema55[lastIdx - 1]) {
    sellScore += 2; sellFactors++; reasons.push("EMA 데드크로스");
  }
  // 가격 vs EMA200 위치
  if (ema200.length > 0 && ema200[lastIdx]) {
    if (price > ema200[lastIdx]) { buyScore += 1; reasons.push("EMA200↑"); }
    else { sellScore += 1; reasons.push("EMA200↓"); }
  }
  if (weeklyTrendUp === true) { buyScore += 1; reasons.push("주봉↑"); }
  if (weeklyTrendUp === false) { sellScore += 1; reasons.push("주봉↓"); }

  // BB 보조
  if (bb[lastIdx] && price <= bb[lastIdx].lower * 1.01) { buyScore += 1; buyFactors++; reasons.push("BB 하단근접"); }
  if (bb[lastIdx] && price >= bb[lastIdx].upper * 0.99) { sellScore += 1; sellFactors++; reasons.push("BB 상단근접"); }

  // 캔들 패턴
  const pattern = detectCandlePattern(candles, lastIdx);
  if (pattern === "hammer" || pattern === "bullish_engulfing") { buyScore += 1; buyFactors++; reasons.push(pattern === "hammer" ? "해머" : "강세장악형"); }
  if (pattern === "bearish_engulfing") { sellScore += 1; sellFactors++; reasons.push("약세장악형"); }

  // 다이버전스
  if (detectBullishDivergence(closes, rsi, lastIdx, 15)) { buyScore += 2; buyFactors++; reasons.push("강세 다이버전스"); }
  if (detectBearishDivergence(closes, rsi, lastIdx, 15)) { sellScore += 2; sellFactors++; reasons.push("약세 다이버전스"); }

  // ═══════════════════════════════════════════════════════
  // LAYER 4: market-monitor 실시간 알림 부스트
  // ═══════════════════════════════════════════════════════
  for (const alert of assetAlerts) {
    if (alert.type === "REGIME_SHIFT" && alert.severity === "high") {
      // 레짐 전환 알림이 있으면 현재 방향에 보너스
      if (price > prevPrice) { buyScore += 2; reasons.push("모니터:레짐전환↑"); }
      else { sellScore += 2; reasons.push("모니터:레짐전환↓"); }
    }
    if (alert.type === "TREND_BIRTH") {
      if (price > prevPrice) { buyScore += 2; buyFactors++; reasons.push("모니터:추세탄생↑"); }
      else { sellScore += 2; sellFactors++; reasons.push("모니터:추세탄생↓"); }
    }
    if (alert.type === "VOL_EXPLOSION") {
      if (price > prevPrice) { buyScore += 1; reasons.push("모니터:변동성폭발↑"); }
      else { sellScore += 1; reasons.push("모니터:변동성폭발↓"); }
    }
    if (alert.type === "SMART_MONEY") {
      buyScore += 1; reasons.push("모니터:스마트머니");
    }
  }

  // ═══════════════════════════════════════════════════════
  // 최종 판정 (v4: 동점 시 FNG 방향 우선, 폴백 추세추종)
  // ═══════════════════════════════════════════════════════
  const buyPass = buyScore >= buyThreshold && buyFactors >= buyFactorsThreshold;
  const sellPass = sellScore >= sellThreshold && sellFactors >= sellFactorsThreshold;

  // 동점이면 FNG 기반 방향 선택 (공포→매수 우선, 탐욕→매도 우선)
  if (buyPass && sellPass && buyScore === sellScore) {
    const favorBuy = fngValue <= 50;
    if (favorBuy) {
      return { type: "BUY", confidence: "C", score: buyScore, factors: buyFactors, positionSize: posSize * 0.5, reason: reasons.join(" + ") + " [동점→FNG매수]", bar: lastIdx, price };
    } else {
      return { type: "SELL", confidence: "C", score: sellScore, factors: sellFactors, positionSize: posSize * 0.5, reason: reasons.join(" + ") + " [동점→FNG매도]", bar: lastIdx, price };
    }
  }

  if (buyPass && buyScore > sellScore) {
    return {
      type: "BUY",
      confidence: buyScore >= 9 ? "A" : buyScore >= 7 ? "B" : "C",
      score: buyScore, factors: buyFactors,
      positionSize: posSize,
      reason: reasons.join(" + "),
      bar: lastIdx, price,
    };
  }

  if (sellPass && sellScore > buyScore) {
    return {
      type: "SELL",
      confidence: sellScore >= 9 ? "A" : sellScore >= 7 ? "B" : "C",
      score: sellScore, factors: sellFactors,
      positionSize: posSize,
      reason: reasons.join(" + "),
      bar: lastIdx, price,
    };
  }

  // ═══════════════════════════════════════════════════════
  // 폴백: 추세 추종 시그널 (아무 시그널도 없을 때)
  // EMA21/55 방향 + 주봉 추세만으로 약한 시그널 발생
  // ═══════════════════════════════════════════════════════
  const emaUp = ema21[lastIdx] > ema55[lastIdx];
  const emaDown = ema21[lastIdx] < ema55[lastIdx];
  const above200 = ema200.length > 0 && ema200[lastIdx] ? price > ema200[lastIdx] : null;

  if (emaUp && (weeklyTrendUp === true || above200 === true)) {
    return {
      type: "BUY", confidence: "C", score: 1, factors: 0,
      positionSize: posSize * 0.3,
      reason: "폴백: EMA상승 + " + (weeklyTrendUp ? "주봉↑" : "EMA200↑"),
      bar: lastIdx, price,
    };
  }
  if (emaDown && (weeklyTrendUp === false || above200 === false)) {
    return {
      type: "SELL", confidence: "C", score: 1, factors: 0,
      positionSize: posSize * 0.3,
      reason: "폴백: EMA하락 + " + (weeklyTrendUp === false ? "주봉↓" : "EMA200↓"),
      bar: lastIdx, price,
    };
  }

  return null;
}

// ════════════════════════════════════════════════════════
// 텔레그램 전송
// ════════════════════════════════════════════════════════
async function sendTelegram(token, chatId, text) {
  if (!token || !chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
    });
  } catch (e) { console.error("Telegram error:", e.message); }
}

// ════════════════════════════════════════════════════════
// 기술 지표 라이브러리 (서버사이드 순수 JS)
// ════════════════════════════════════════════════════════

function calcSMA(data, period) {
  const result = new Array(data.length).fill(null);
  for (let i = period - 1; i < data.length; i++) {
    let sum = 0;
    for (let j = 0; j < period; j++) sum += data[i - j];
    result[i] = sum / period;
  }
  return result;
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
  for (let i = start + period; i < data.length; i++) {
    result[i] = data[i] * k + result[i - 1] * (1 - k);
  }
  return result;
}

function calcRSI(closes, period = 14) {
  const result = new Array(closes.length).fill(null);
  if (closes.length < period + 1) return result;
  let gainSum = 0, lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gainSum += d; else lossSum -= d;
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  result[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + (d > 0 ? d : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (d < 0 ? -d : 0)) / period;
    result[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return result;
}

function calcBB(closes, period = 20, mult = 2) {
  const result = new Array(closes.length).fill(null);
  const sma = calcSMA(closes, period);
  for (let i = period - 1; i < closes.length; i++) {
    if (sma[i] == null) continue;
    let sqSum = 0;
    for (let j = 0; j < period; j++) sqSum += (closes[i - j] - sma[i]) ** 2;
    const std = Math.sqrt(sqSum / period);
    const upper = sma[i] + std * mult;
    const lower = sma[i] - std * mult;
    result[i] = { middle: sma[i], upper, lower, bw: sma[i] > 0 ? (upper - lower) / sma[i] : 0 };
  }
  return result;
}

function calcMACD(closes, fast = 12, slow = 26, sig = 9) {
  const emaFast = calcEMA(closes, fast);
  const emaSlow = calcEMA(closes, slow);
  const macdLine = closes.map((_, i) => (emaFast[i] != null && emaSlow[i] != null) ? emaFast[i] - emaSlow[i] : null);
  const signal = calcEMA(macdLine.map(v => v ?? 0), sig);
  const histogram = closes.map((_, i) => (macdLine[i] != null && signal[i] != null) ? macdLine[i] - signal[i] : null);
  return { macdLine, signal, histogram };
}

function calcATR(highs, lows, closes, period = 14) {
  const tr = [highs[0] - lows[0]];
  for (let i = 1; i < closes.length; i++) {
    tr.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
  }
  return calcEMA(tr, period);
}

function calcADX(highs, lows, closes, period = 14) {
  const len = closes.length;
  const result = new Array(len).fill(null);
  if (len < period * 2) return result;
  const tr = [0];
  const plusDM = [0];
  const minusDM = [0];
  for (let i = 1; i < len; i++) {
    tr.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
    const up = highs[i] - highs[i - 1];
    const down = lows[i - 1] - lows[i];
    plusDM.push(up > down && up > 0 ? up : 0);
    minusDM.push(down > up && down > 0 ? down : 0);
  }
  const smoothTR = calcEMA(tr, period);
  const smoothPlus = calcEMA(plusDM, period);
  const smoothMinus = calcEMA(minusDM, period);
  const dx = [];
  for (let i = 0; i < len; i++) {
    if (smoothTR[i] && smoothTR[i] > 0) {
      const pdi = (smoothPlus[i] / smoothTR[i]) * 100;
      const mdi = (smoothMinus[i] / smoothTR[i]) * 100;
      const sum = pdi + mdi;
      dx.push(sum > 0 ? (Math.abs(pdi - mdi) / sum) * 100 : 0);
    } else dx.push(0);
  }
  const adxSmooth = calcEMA(dx, period);
  for (let i = 0; i < len; i++) result[i] = adxSmooth[i];
  return result;
}

function calcStochastic(highs, lows, closes, kPeriod = 14, dPeriod = 3) {
  const k = new Array(closes.length).fill(null);
  for (let i = kPeriod - 1; i < closes.length; i++) {
    let hh = -Infinity, ll = Infinity;
    for (let j = 0; j < kPeriod; j++) {
      hh = Math.max(hh, highs[i - j]);
      ll = Math.min(ll, lows[i - j]);
    }
    k[i] = hh !== ll ? ((closes[i] - ll) / (hh - ll)) * 100 : 50;
  }
  const d = calcSMA(k.map(v => v ?? 50), dPeriod);
  return { k, d };
}

function calcOBV(closes, volumes) {
  const obv = [0];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i] > closes[i - 1]) obv.push(obv[i - 1] + (volumes[i] || 0));
    else if (closes[i] < closes[i - 1]) obv.push(obv[i - 1] - (volumes[i] || 0));
    else obv.push(obv[i - 1]);
  }
  return obv;
}

function resampleWeekly(candles) {
  const weeks = [];
  let week = null;
  for (const c of candles) {
    const d = new Date((c.time || 0) * 1000);
    const day = d.getDay() || 7;
    const thursday = new Date(d);
    thursday.setDate(d.getDate() + 4 - day);
    const yearStart = new Date(thursday.getFullYear(), 0, 1);
    const weekNo = Math.ceil(((thursday - yearStart) / 86400000 + 1) / 7);
    const wk = `${thursday.getFullYear()}-W${String(weekNo).padStart(2, "0")}`;
    if (!week || week.wk !== wk) {
      if (week) weeks.push(week);
      week = { wk, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume || 0, time: c.time };
    } else {
      week.high = Math.max(week.high, c.high);
      week.low = Math.min(week.low, c.low);
      week.close = c.close;
      week.volume += c.volume || 0;
    }
  }
  if (week) weeks.push(week);
  return weeks;
}

function detectCandlePattern(candles, i) {
  if (i < 2) return null;
  const c = candles[i], p = candles[i - 1], pp = candles[i - 2];
  const bodyC = Math.abs(c.close - c.open);
  const rangeC = c.high - c.low;
  const bodyP = Math.abs(p.close - p.open);
  const lowerWick = Math.min(c.open, c.close) - c.low;
  const upperWick = c.high - Math.max(c.open, c.close);
  if (lowerWick > bodyC * 2 && upperWick < bodyC * 0.5 && rangeC > 0) {
    if (p.close < p.open && pp.close < pp.open) return "hammer";
  }
  if (p.close < p.open && c.close > c.open && c.close > p.open && c.open < p.close && bodyC > bodyP * 1.2)
    return "bullish_engulfing";
  if (p.close > p.open && c.close < c.open && c.close < p.open && c.open > p.close && bodyC > bodyP * 1.2)
    return "bearish_engulfing";
  if (rangeC > 0 && bodyC / rangeC < 0.1) return "doji";
  return null;
}

function detectBullishDivergence(closes, rsi, i, lookback = 10) {
  if (i < lookback + 2) return false;
  let priceLow = Infinity, priceLowIdx = i;
  let prevLow = Infinity, prevLowIdx = i;
  for (let j = 1; j <= lookback; j++) {
    if (closes[i - j] < priceLow) { prevLow = priceLow; prevLowIdx = priceLowIdx; priceLow = closes[i - j]; priceLowIdx = i - j; }
    else if (closes[i - j] < prevLow) { prevLow = closes[i - j]; prevLowIdx = i - j; }
  }
  if (closes[i] <= priceLow && rsi[i] != null && rsi[priceLowIdx] != null) {
    return rsi[i] > rsi[priceLowIdx] + 3;
  }
  return false;
}

function detectBearishDivergence(closes, rsi, i, lookback = 10) {
  if (i < lookback + 2) return false;
  let priceHigh = -Infinity, priceHighIdx = i;
  for (let j = 1; j <= lookback; j++) {
    if (closes[i - j] > priceHigh) { priceHigh = closes[i - j]; priceHighIdx = i - j; }
  }
  if (closes[i] >= priceHigh && rsi[i] != null && rsi[priceHighIdx] != null) {
    return rsi[i] < rsi[priceHighIdx] - 3;
  }
  return false;
}
