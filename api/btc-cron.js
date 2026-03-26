// Vercel Cron — 멀티 자산 암호화폐 자동매매 서버사이드 엔진
// 4시간마다 실행: BTC, ETH, SOL 캔들 데이터 → 전략 시그널 생성 → Alpaca 주문
// 환경변수: ALPACA_API_KEY, ALPACA_SECRET_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID

const CRYPTO_ASSETS = ["BTC/USD", "ETH/USD", "SOL/USD"];
const YAHOO_TICKERS = { "BTC/USD": "BTC-USD", "ETH/USD": "ETH-USD", "SOL/USD": "SOL-USD" };
const MAX_POSITION_PER_ASSET = 0.30; // 자산당 최대 30% 에쿼티
const MAX_TOTAL_CRYPTO_EXPOSURE = 0.80; // 총 암호화폐 노출 최대 80%

export default async function handler(req, res) {
  const startTime = Date.now();
  const log = [];
  const addLog = (msg) => { log.push(`[${new Date().toISOString()}] ${msg}`); console.log(msg); };

  try {
    addLog("🚀 멀티 자산 암호화폐 자동매매 Cron 시작");

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
    const buyingPower = parseFloat(account.buying_power || 0);
    addLog(`✅ 계좌: $${equity.toFixed(0)} (매수력: $${buyingPower.toFixed(0)})`);

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
      const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooTicker}?range=1y&interval=1d`;
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

      if (candles.length < 220) {
        addLog(`❌ ${asset} 캔들 부족 (${candles.length}개 < 220개)`);
        assetResults.push({ asset, ok: false, error: "Insufficient candle data" });
        continue;
      }

      addLog(`✅ ${asset}: ${candles.length}개 캔들 로드 (최신: $${candles[candles.length - 1]?.close?.toFixed(0)})`);

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

      // 최근 5봉 시그널 분석
      const latestSignal = analyzeLatest(candles, closes, highs, lows, volumes, {
        rsi, bb, ema21, ema55, ema200, macdLine, macdSig, histogram,
        adx, atr, stoch, obv, obvEma, volSMA, weeklyTrendUp,
      }, fngValue);

      if (!latestSignal) {
        addLog(`⏸️ ${asset} 시그널 없음`);
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

      // BUY 주문 실행
      if ((latestSignal.type === "BUY" || shouldSellForStopLoss === false) && !shouldSellForStopLoss) {
        // 포지션 스케일링: 기존 포지션이 있으면 추가 진입 가능
        if (pos) {
          const newExposure = currentExposure + (equity * positionSize * 0.25);
          if (newExposure <= maxAssetValue && (totalCryptoExposure + newExposure) <= (equity * MAX_TOTAL_CRYPTO_EXPOSURE)) {
            tradeAmount = Math.min(equity * positionSize * 0.25, maxAssetValue - currentExposure);
          }
        } else {
          // 신규 포지션
          tradeAmount = Math.min(equity * positionSize * 0.25, maxAssetValue);
          if ((totalCryptoExposure + tradeAmount) > (equity * MAX_TOTAL_CRYPTO_EXPOSURE)) {
            tradeAmount = Math.max(0, equity * MAX_TOTAL_CRYPTO_EXPOSURE - totalCryptoExposure);
          }
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
    const tgMsg = buildTelegramMessage(assetResults, positionMap, equity, buyingPower, duration, fngData);

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
function buildTelegramMessage(assetResults, positionMap, equity, buyingPower, duration, fngData) {
  const lines = [
    `🤖 멀티 자산 암호화폐 엔진`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `📅 ${new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}`,
  ];

  if (fngData) {
    lines.push(`📊 Fear & Greed: ${fngData.value} (${fngData.classification})`);
  }

  lines.push(``);

  for (const result of assetResults) {
    if (result.signal) {
      const icon = result.signal.type === "BUY" ? "🟢" : "🔴";
      const grade = result.signal.confidence === "A" ? "⭐⭐⭐" : result.signal.confidence === "B" ? "⭐⭐" : "⭐";
      lines.push(`${icon} ${result.asset}: ${result.signal.type} (${grade} ${result.signal.score}pt)`);
      lines.push(`  근거: ${result.signal.reason.substring(0, 60)}...`);
    } else if (result.action === "wait") {
      lines.push(`⏸️ ${result.asset}: 신호 없음`);
    }
  }

  lines.push(``, `💰 포트폴리오`);
  lines.push(`━━━━━━━━━━━━━━━━━━━━`);
  lines.push(`계좌: $${equity.toFixed(0)} | 매수력: $${buyingPower.toFixed(0)}`);

  for (const asset of CRYPTO_ASSETS) {
    const pos = positionMap[asset];
    if (pos) {
      const pl = parseFloat(pos.unrealized_pl || 0);
      const icon = pl >= 0 ? "📈" : "📉";
      lines.push(`${icon} ${asset}: $${parseFloat(pos.market_value || 0).toFixed(0)} (P&L: $${pl.toFixed(2)})`);
    }
  }

  lines.push(``, `⏱️ ${duration}s`);
  return lines.join("\n");
}

// ════════════════════════════════════════════════════════
// 최근 시그널 분석 (마지막 5봉 스캔)
// ════════════════════════════════════════════════════════
function analyzeLatest(candles, closes, highs, lows, volumes, ind, fngValue = 50) {
  const { rsi, bb, ema21, ema55, ema200, macdLine, macdSig, histogram,
    adx, atr, stoch, obv, obvEma, volSMA, weeklyTrendUp } = ind;

  // Fear & Greed에 따른 동적 임계값 설정
  let buyThreshold, buyFactorsThreshold, sellThreshold, sellFactorsThreshold;
  if (fngValue <= 25) {
    // 극도의 공포 (0-25): 매수 임계값 낮춤 (좋은 매수 기회)
    buyThreshold = 3;
    buyFactorsThreshold = 2;
    sellThreshold = 6;
    sellFactorsThreshold = 3;
  } else if (fngValue <= 45) {
    // 공포 (26-45): 기본값 유지
    buyThreshold = 3;
    buyFactorsThreshold = 2;
    sellThreshold = 5;
    sellFactorsThreshold = 3;
  } else if (fngValue <= 55) {
    // 중립 (46-55): 기본값
    buyThreshold = 4;
    buyFactorsThreshold = 2;
    sellThreshold = 4;
    sellFactorsThreshold = 2;
  } else if (fngValue <= 75) {
    // 탐욕 (56-75): 매수 임계값 높임 (신중)
    buyThreshold = 5;
    buyFactorsThreshold = 3;
    sellThreshold = 4;
    sellFactorsThreshold = 2;
  } else {
    // 극도의 탐욕 (76-100): 매수 매우 신중, 매도 쉬움
    buyThreshold = 6;
    buyFactorsThreshold = 3;
    sellThreshold = 3;
    sellFactorsThreshold = 2;
  }

  // 마지막 5봉에서 시그널 검색 (최신 우선)
  for (let offset = 0; offset < 5; offset++) {
    const i = candles.length - 1 - offset;
    if (i < 210 || rsi[i] == null || !bb[i] || histogram[i] == null) continue;

    const price = closes[i];
    const prevPrice = closes[i - 1];

    // 적응형 RSI 임계값
    const atrPct = atr[i] && closes[i] > 0 ? (atr[i] / closes[i]) * 100 : 2;
    const rsiBuyTh = atrPct > 5 ? 20 : atrPct > 3 ? 25 : atrPct > 1.5 ? 28 : 32;
    const rsiSellTh = atrPct > 5 ? 80 : atrPct > 3 ? 75 : atrPct > 1.5 ? 72 : 68;

    // 팩터 계산
    const trendUp = ema21[i] > ema55[i];
    const trendDown = ema21[i] < ema55[i];
    const longTrendUp = price > ema200[i];
    const longTrendDown = price < ema200[i];
    const emaCrossUp = ema21[i] > ema55[i] && ema21[i - 1] <= ema55[i - 1];
    const emaCrossDown = ema21[i] < ema55[i] && ema21[i - 1] >= ema55[i - 1];

    const rsiBounce = rsi[i] > rsiBuyTh && rsi[i - 1] <= rsiBuyTh;
    const rsiDrop = rsi[i] < rsiSellTh && rsi[i - 1] >= rsiSellTh;
    const bbBounce = prevPrice <= (bb[i - 1]?.lower || 0) && price > bb[i].lower;
    const bbReject = prevPrice >= (bb[i - 1]?.upper || Infinity) && price < bb[i].upper;

    const volAvg = volSMA[i] || 0;
    const curVol = volumes[i];
    const volExplosion = volAvg > 0 && curVol >= volAvg * 1.8;
    const obvRising = obv[i] > obvEma[i] && obv[i - 1] <= obvEma[i - 1];
    const obvFalling = obv[i] < obvEma[i] && obv[i - 1] >= obvEma[i - 1];

    const macdCrossUp = macdLine[i] > macdSig[i] && macdLine[i - 1] <= macdSig[i - 1];
    const macdCrossDown = macdLine[i] < macdSig[i] && macdLine[i - 1] >= macdSig[i - 1];
    const macdAccelUp = histogram[i] > histogram[i - 1] && histogram[i - 1] <= (histogram[i - 2] || 0);
    const macdAccelDown = histogram[i] < histogram[i - 1] && histogram[i - 1] >= (histogram[i - 2] || 0);

    const adxStrong = adx[i] != null && adx[i] >= 20;
    const stochBullCross = stoch.k[i] != null && stoch.d[i] != null
      && stoch.k[i] > stoch.d[i] && (stoch.k[i - 1] || 50) <= (stoch.d[i - 1] || 50)
      && stoch.k[i] < 30;
    const stochBearCross = stoch.k[i] != null && stoch.d[i] != null
      && stoch.k[i] < stoch.d[i] && (stoch.k[i - 1] || 50) >= (stoch.d[i - 1] || 50)
      && stoch.k[i] > 70;

    let isSqueeze = false;
    if (i >= 6 && bb[i] && bb[i - 6]) isSqueeze = bb[i - 6].bw > 0 && bb[i].bw < bb[i - 6].bw * 0.6;

    const bullDiv = detectBullishDivergence(closes, rsi, i, 15);
    const bearDiv = detectBearishDivergence(closes, rsi, i, 15);

    let bullMomentum = true, bearMomentum = true;
    for (let j = 1; j <= 3 && i - j >= 0; j++) {
      if (closes[i - j + 1] <= closes[i - j]) bullMomentum = false;
      if (closes[i - j + 1] >= closes[i - j]) bearMomentum = false;
    }

    const pattern = detectCandlePattern(candles, i);
    const posSize = atrPct > 5 ? 0.3 : atrPct > 3 ? 0.5 : atrPct > 1.5 ? 0.7 : 0.9;

    // ── 매수 스코어 ──
    let buyScore = 0, buyFactors = 0;
    const buyReasons = [];

    if (rsiBounce) { buyScore += 3; buyFactors++; buyReasons.push(`RSI ${rsi[i].toFixed(1)} 탈출`); }
    if (bbBounce) { buyScore += 2; buyFactors++; buyReasons.push("BB 하단 반등"); }
    if (volExplosion && price > prevPrice) { buyScore += 2; buyFactors++; buyReasons.push("Vol 폭증"); }
    if (obvRising) { buyScore += 2; buyFactors++; buyReasons.push("OBV 유입"); }
    if (macdCrossUp) { buyScore += 2; buyFactors++; buyReasons.push("MACD 골든"); }
    else if (macdAccelUp && histogram[i] > 0) { buyScore += 1; buyFactors++; buyReasons.push("MACD 가속↑"); }
    if (emaCrossUp) { buyScore += 3; buyFactors++; buyReasons.push("EMA 골든크로스"); }
    else if (trendUp) buyScore += 1;
    if (longTrendUp) { buyScore += 1; if (trendUp) buyReasons.push("장기추세↑"); }
    if (weeklyTrendUp === true) { buyScore += 1; buyReasons.push("주봉↑"); }
    if (isSqueeze && price > bb[i].middle && (volExplosion || bullMomentum)) { buyScore += 3; buyFactors++; buyReasons.push("스퀴즈 상방"); }
    if (bullDiv) { buyScore += 2; buyFactors++; buyReasons.push("강세 다이버전스"); }
    if (stochBullCross) { buyScore += 2; buyFactors++; buyReasons.push("Stoch 과매도"); }
    if (pattern === "hammer") { buyScore += 2; buyFactors++; buyReasons.push("해머"); }
    else if (pattern === "bullish_engulfing") { buyScore += 2; buyFactors++; buyReasons.push("강세 장악형"); }
    if (adxStrong && trendUp) { buyScore += 1; buyReasons.push(`ADX ${(adx[i] || 0).toFixed(0)}`); }
    if (bullMomentum && trendUp) { buyScore += 1; buyReasons.push("연속 상승"); }

    if (buyScore >= buyThreshold && buyFactors >= buyFactorsThreshold) {
      return {
        type: "BUY",
        confidence: buyScore >= 9 ? "A" : buyScore >= 7 ? "B" : "C",
        score: buyScore, factors: buyFactors,
        positionSize: posSize,
        reason: buyReasons.join(" + "),
        bar: i, price,
      };
    }

    // ── 매도 스코어 ──
    let sellScore = 0, sellFactors = 0;
    const sellReasons = [];

    if (rsiDrop) { sellScore += 3; sellFactors++; sellReasons.push(`RSI ${rsi[i].toFixed(1)} 탈출`); }
    if (bbReject) { sellScore += 2; sellFactors++; sellReasons.push("BB 상단 거부"); }
    if (macdCrossDown) { sellScore += 2; sellFactors++; sellReasons.push("MACD 데드"); }
    else if (macdAccelDown && histogram[i] < 0) { sellScore += 1; sellFactors++; sellReasons.push("MACD 가속↓"); }
    if (emaCrossDown) { sellScore += 3; sellFactors++; sellReasons.push("EMA 데드크로스"); }
    else if (trendDown) sellScore += 1;
    if (longTrendDown && trendDown) { sellScore += 2; sellReasons.push("EMA200 하회"); }
    if (bearDiv) { sellScore += 2; sellFactors++; sellReasons.push("약세 다이버전스"); }
    if (obvFalling) { sellScore += 2; sellFactors++; sellReasons.push("OBV 이탈"); }
    if (volExplosion && price < prevPrice) { sellScore += 2; sellFactors++; sellReasons.push("Vol 폭증+음봉"); }
    if (isSqueeze && price < bb[i].middle && bearMomentum) { sellScore += 2; sellFactors++; sellReasons.push("스퀴즈 하방"); }
    if (stochBearCross) { sellScore += 2; sellFactors++; sellReasons.push("Stoch 과매수"); }
    if (pattern === "bearish_engulfing") { sellScore += 2; sellFactors++; sellReasons.push("약세 장악형"); }
    if (adxStrong && trendDown) { sellScore += 1; sellReasons.push(`ADX ${(adx[i] || 0).toFixed(0)}`); }
    if (bearMomentum && trendDown) { sellScore += 1; sellReasons.push("연속 하락"); }

    if (sellScore >= sellThreshold && sellFactors >= sellFactorsThreshold) {
      return {
        type: "SELL",
        confidence: sellScore >= 9 ? "A" : sellScore >= 7 ? "B" : "C",
        score: sellScore, factors: sellFactors,
        positionSize: posSize,
        reason: sellReasons.join(" + "),
        bar: i, price,
      };
    }
  }

  return null; // 시그널 없음
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
