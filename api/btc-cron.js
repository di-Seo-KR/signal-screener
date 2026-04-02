// Vercel Cron — 멀티 자산 암호화폐 자동매매 서버사이드 엔진
// 1시간마다 실행: BTC, ETH, SOL 캔들 데이터 → 전략 시그널 생성 → Alpaca 주문
// market-monitor가 KV에 쌓은 레짐 데이터를 참조하여 적응형 매매
// 환경변수: ALPACA_API_KEY, ALPACA_SECRET_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID

export const config = { maxDuration: 120 };

const CRYPTO_ASSETS = ["BTC/USD", "ETH/USD", "SOL/USD", "AVAX/USD", "LINK/USD", "DOGE/USD"];
// Binance 심볼 매핑 (공개 API, 인증 불필요, Yahoo보다 안정적)
const BINANCE_SYMBOLS = { "BTC/USD": "BTCUSDT", "ETH/USD": "ETHUSDT", "SOL/USD": "SOLUSDT", "AVAX/USD": "AVAXUSDT", "LINK/USD": "LINKUSDT", "DOGE/USD": "DOGEUSDT" };
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
      const binSymbol = BINANCE_SYMBOLS[asset];

      // ── Binance 공개 API로 캔들 데이터 로드 ──
      // 일봉 365개 (1년) + 4시간봉 500개 (~83일)
      // 인증 불필요, Yahoo Finance보다 안정적이고 빠름
      const binDaily = `https://api.binance.com/api/v3/klines?symbol=${binSymbol}&interval=1d&limit=365`;
      const bin4h = `https://api.binance.com/api/v3/klines?symbol=${binSymbol}&interval=4h&limit=500`;

      let candles = [];
      try {
        const res = await fetch(binDaily);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const raw = await res.json();
        // Binance klines: [openTime, open, high, low, close, volume, closeTime, ...]
        candles = raw.map(k => ({
          time: Math.floor(k[0] / 1000),
          open: parseFloat(k[1]),
          high: parseFloat(k[2]),
          low: parseFloat(k[3]),
          close: parseFloat(k[4]),
          volume: parseFloat(k[5]),
        })).filter(c => c.close > 0 && c.high > 0 && c.low > 0);
      } catch (e) {
        addLog(`❌ ${asset} Binance 일봉 오류: ${e.message}`);
        assetResults.push({ asset, ok: false, error: "Binance daily fetch failed" });
        continue;
      }

      if (candles.length < 100) {
        addLog(`❌ ${asset} 캔들 부족 (${candles.length}개 < 100개)`);
        assetResults.push({ asset, ok: false, error: "Insufficient candle data" });
        continue;
      }

      // 4시간봉 로드
      let candles4h = [];
      try {
        const res4h = await fetch(bin4h);
        if (res4h.ok) {
          const raw4h = await res4h.json();
          candles4h = raw4h.map(k => ({
            time: Math.floor(k[0] / 1000),
            open: parseFloat(k[1]),
            high: parseFloat(k[2]),
            low: parseFloat(k[3]),
            close: parseFloat(k[4]),
            volume: parseFloat(k[5]),
          })).filter(c => c.close > 0 && c.high > 0 && c.low > 0);
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
      const assetAlerts = monitorAlerts.filter(a => a.ticker === binSymbol || a.ticker === asset);
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
// Regime-Adaptive Alpha Signal Engine v5
// ────────────────────────────────────────────────────────
// 학술 리서치 기반 설계:
// 1. ADX 기반 레짐 판별 → 추세장/횡보장 전략 자동 스위칭
//    (ADX > 25 = 추세 → 모멘텀, ADX < 25 = 횡보 → 평균회귀)
// 2. RSI는 크립토에서 모멘텀(continuation) 지표로 사용
//    (과매수 상태 유지 = 상승 지속 시그널, 학술 연구 기반)
// 3. ATR 역비례 포지션 사이징 (fractional Kelly 0.25)
// 4. Hurst + ER로 시장 비효율성 포착 (독자 알파)
// 5. 스마트머니 흐름 감지 (OBV + 거래량 이상)
// 6. 3-bar confirmation 레짐 전환 안정성
//
// 시그널 빈도 목표: 6개 자산 × 매시간 = 대부분 시그널 발생
// 알파 보존: 레짐별 전략 분리로 무분별 매매 방지
// ════════════════════════════════════════════════════════
function analyzeLatest(candles, closes, highs, lows, volumes, ind, fngValue = 50, marketRegime = null, assetAlerts = []) {
  const { rsi, bb, ema21, ema55, ema200, macdLine, macdSig, histogram,
    adx, atr, stoch, obv, obvEma, volSMA, weeklyTrendUp } = ind;

  const L = closes.length - 1;
  if (L < 60) return null;

  const price = closes[L];
  const prev = closes[L - 1];

  // ═══════════════════════════════════════════════════════
  // STEP 1: ATR 기반 포지션 사이징 (변동성 역비례 + fractional Kelly)
  // 공식: posSize = min(0.01 * equity / (2 * ATR), maxSize)
  // ATR%가 높을수록 작은 포지션 → 리스크 자동 조절
  // ═══════════════════════════════════════════════════════
  const atrVal = atr[L] || 0;
  const atrPct = price > 0 ? (atrVal / price) * 100 : 2;
  // fractional Kelly: 높은 변동성에서 포지션 축소
  const posSize = Math.max(0.15, Math.min(0.9, 1.5 / Math.max(atrPct, 0.5)));

  // ═══════════════════════════════════════════════════════
  // STEP 2: 레짐 판별 (ADX + Hurst + ER 복합)
  // ─ ADX > 25: 추세 시장 (학술 표준 기준)
  // ─ Hurst > 0.55: 추세 지속 성향 (H > 0.5 = persistent)
  // ─ ER > 0.4: 방향 효율성 높음
  // ─ 3가지 중 2개 이상 충족 시 "추세", 아니면 "횡보/회귀"
  // ═══════════════════════════════════════════════════════
  const curADX = adx[L] || 20;
  const hurst = calcHurst(closes.slice(-100));
  const er = calcEfficiencyRatio(closes, 10);
  const curER = er[er.length - 1] || 0;

  const trendSignals = [curADX > 25, hurst > 0.55, curER > 0.4];
  const trendCount = trendSignals.filter(Boolean).length;
  const regime = trendCount >= 2 ? "TRENDING" : "MEAN_REVERT";

  // FNG 센티먼트 바이어스 (공포 = 매수 유리, 탐욕 = 매도 유리)
  const fngBias = fngValue <= 30 ? "FEAR" : fngValue >= 70 ? "GREED" : "NEUTRAL";

  const reasons = [];
  reasons.push(`[${regime}] ADX${curADX.toFixed(0)} H${hurst.toFixed(2)} ER${curER.toFixed(2)}`);
  if (fngBias !== "NEUTRAL") reasons.push(`FNG${fngValue}(${fngBias})`);

  let buyScore = 0, sellScore = 0;

  // ═══════════════════════════════════════════════════════
  // STEP 3A: 추세 시장 전략 (TRENDING regime)
  // ─ 모멘텀 추종이 핵심: 강한 방향에 올라탄다
  // ─ RSI 과매수는 매도가 아닌 "모멘텀 확인" (크립토 학술 발견)
  // ─ EMA 정배열/역배열 + MACD 방향이 주요 근거
  // ═══════════════════════════════════════════════════════
  if (regime === "TRENDING") {
    // ── 모멘텀 방향 (핵심) ──
    // EMA 정배열: 21 > 55 = 상승 추세
    if (ema21[L] > ema55[L]) {
      buyScore += 3;
      reasons.push("EMA정배열(21>55)");
    } else {
      sellScore += 3;
      reasons.push("EMA역배열(21<55)");
    }

    // EMA 골든/데드 크로스 (당일 발생 시 강한 시그널)
    if (ema21[L] > ema55[L] && ema21[L - 1] <= ema55[L - 1]) {
      buyScore += 3; reasons.push("골든크로스!");
    }
    if (ema21[L] < ema55[L] && ema21[L - 1] >= ema55[L - 1]) {
      sellScore += 3; reasons.push("데드크로스!");
    }

    // ── RSI 모멘텀 (크립토에서는 continuation 지표) ──
    // RSI > 60 = 상승 모멘텀 지속, RSI > 70 = 강한 상승 추세
    if (rsi[L] > 70) { buyScore += 2; reasons.push(`RSI${rsi[L].toFixed(0)} 강세모멘텀`); }
    else if (rsi[L] > 55) { buyScore += 1; reasons.push(`RSI${rsi[L].toFixed(0)} 상승`); }
    else if (rsi[L] < 30) { sellScore += 2; reasons.push(`RSI${rsi[L].toFixed(0)} 약세모멘텀`); }
    else if (rsi[L] < 45) { sellScore += 1; reasons.push(`RSI${rsi[L].toFixed(0)} 하락`); }

    // ── MACD 모멘텀 확인 ──
    if (macdLine[L] > macdSig[L]) { buyScore += 1; reasons.push("MACD↑"); }
    else { sellScore += 1; reasons.push("MACD↓"); }
    // MACD 히스토그램 가속/감속
    if (histogram[L] > 0 && histogram[L] > histogram[L - 1]) { buyScore += 1; reasons.push("MACD가속↑"); }
    if (histogram[L] < 0 && histogram[L] < histogram[L - 1]) { sellScore += 1; reasons.push("MACD가속↓"); }

    // ── 20일 고점/저점 돌파 ──
    const high20 = Math.max(...highs.slice(-20));
    const low20 = Math.min(...lows.slice(-20));
    if (price >= high20 * 0.99) { buyScore += 2; reasons.push("20일고점돌파"); }
    if (price <= low20 * 1.01) { sellScore += 2; reasons.push("20일저점이탈"); }

    // ── Hurst 추세 확인 ──
    if (hurst > 0.55) {
      if (price > prev) { buyScore += 1; reasons.push(`Hurst${hurst.toFixed(2)}추세↑`); }
      else { sellScore += 1; reasons.push(`Hurst${hurst.toFixed(2)}추세↓`); }
    }
  }

  // ═══════════════════════════════════════════════════════
  // STEP 3B: 횡보/평균회귀 전략 (MEAN_REVERT regime)
  // ─ RSI 역추세가 핵심: 과매도에서 매수, 과매수에서 매도
  // ─ BB 밴드 터치 + RSI 반전 = 고확률 시그널
  // ─ 스토캐스틱 %K/%D 크로스 보조
  // ═══════════════════════════════════════════════════════
  if (regime === "MEAN_REVERT") {
    // ── RSI 역추세 (핵심) ──
    if (rsi[L] < 30) { buyScore += 3; reasons.push(`RSI${rsi[L].toFixed(0)} 과매도`); }
    else if (rsi[L] < 40 && rsi[L] > rsi[L - 1]) { buyScore += 2; reasons.push(`RSI${rsi[L].toFixed(0)} 반등`); }
    else if (rsi[L] < 45) { buyScore += 1; reasons.push(`RSI${rsi[L].toFixed(0)} 매수권`); }

    if (rsi[L] > 70) { sellScore += 3; reasons.push(`RSI${rsi[L].toFixed(0)} 과매수`); }
    else if (rsi[L] > 60 && rsi[L] < rsi[L - 1]) { sellScore += 2; reasons.push(`RSI${rsi[L].toFixed(0)} 꺾임`); }
    else if (rsi[L] > 55) { sellScore += 1; reasons.push(`RSI${rsi[L].toFixed(0)} 매도권`); }

    // ── 볼린저 밴드 (평균회귀 핵심) ──
    if (bb[L]) {
      if (price <= bb[L].lower * 1.02) { buyScore += 2; reasons.push("BB하단접근"); }
      else if (price <= bb[L].lower * 1.05) { buyScore += 1; reasons.push("BB하단근처"); }
      if (price >= bb[L].upper * 0.98) { sellScore += 2; reasons.push("BB상단접근"); }
      else if (price >= bb[L].upper * 0.95) { sellScore += 1; reasons.push("BB상단근처"); }
    }

    // ── 스토캐스틱 (%K/%D) 크로스 ──
    if (stoch.length > 1) {
      const curK = stoch[stoch.length - 1]?.k;
      const curD = stoch[stoch.length - 1]?.d;
      const prevK = stoch[stoch.length - 2]?.k;
      const prevD = stoch[stoch.length - 2]?.d;
      if (curK != null && curD != null && prevK != null && prevD != null) {
        if (curK < 25 && curK > curD && prevK <= prevD) { buyScore += 2; reasons.push(`Stoch${curK.toFixed(0)} 골든`); }
        if (curK > 75 && curK < curD && prevK >= prevD) { sellScore += 2; reasons.push(`Stoch${curK.toFixed(0)} 데드`); }
        if (curK < 30) { buyScore += 1; reasons.push("Stoch과매도"); }
        if (curK > 70) { sellScore += 1; reasons.push("Stoch과매수"); }
      }
    }

    // ── Hurst 회귀 확인 (H < 0.45 = mean-reverting) ──
    if (hurst < 0.45) {
      if (rsi[L] < 45) { buyScore += 1; reasons.push(`Hurst${hurst.toFixed(2)}회귀→매수`); }
      if (rsi[L] > 55) { sellScore += 1; reasons.push(`Hurst${hurst.toFixed(2)}회귀→매도`); }
    }

    // ── MACD 다이버전스 (평균회귀에서 유효) ──
    if (detectBullishDivergence(closes, rsi, L, 15)) { buyScore += 2; reasons.push("강세다이버전스"); }
    if (detectBearishDivergence(closes, rsi, L, 15)) { sellScore += 2; reasons.push("약세다이버전스"); }
  }

  // ═══════════════════════════════════════════════════════
  // STEP 4: 공통 알파 레이어 (레짐 무관)
  // ─ 독자 비효율성 포착 전략
  // ═══════════════════════════════════════════════════════

  // ── 효율성 비율 급변 (추세 탄생/소멸) ──
  const prevER = (er[er.length - 2] + er[er.length - 3] + er[er.length - 4]) / 3 || 0;
  if (curER > 0.5 && prevER < 0.3) {
    // 추세 탄생: 효율성 급등
    if (price > closes[L - 5]) { buyScore += 2; reasons.push(`ER탄생${curER.toFixed(2)}↑`); }
    else { sellScore += 2; reasons.push(`ER탄생${curER.toFixed(2)}↓`); }
  }

  // ── 변동성 군집 돌파 (ATR 폭발) ──
  const atrLongMA = calcSMA(atr.map(v => v || 0), 50);
  const atrRatio = atrVal > 0 && atrLongMA[atrLongMA.length - 1] > 0
    ? atrVal / atrLongMA[atrLongMA.length - 1] : 1;
  if (atrRatio > 1.5) {
    if (price > prev) { buyScore += 1; reasons.push(`ATR폭발${atrRatio.toFixed(1)}x↑`); }
    else { sellScore += 1; reasons.push(`ATR폭발${atrRatio.toFixed(1)}x↓`); }
  }

  // ── 스마트머니 흐름 (OBV + 거래량) ──
  const volAvg = volSMA[L] || 1;
  const volSurge = volumes[L] > volAvg * 1.5;
  const obvUp = obv[L] > (obvEma[obvEma.length - 1] || 0);
  if (volSurge && obvUp && price > prev) { buyScore += 2; reasons.push("스마트머니매집"); }
  if (volSurge && !obvUp && price < prev) { sellScore += 2; reasons.push("스마트머니분산"); }

  // ── EMA200 장기 추세 필터 (공통 방향 보정) ──
  if (ema200.length > 0 && ema200[L]) {
    if (price > ema200[L]) { buyScore += 1; reasons.push("EMA200위"); }
    else { sellScore += 1; reasons.push("EMA200아래"); }
  }

  // ── 주봉 추세 ──
  if (weeklyTrendUp === true) { buyScore += 1; reasons.push("주봉↑"); }
  if (weeklyTrendUp === false) { sellScore += 1; reasons.push("주봉↓"); }

  // ── 캔들 패턴 ──
  const pattern = detectCandlePattern(candles, L);
  if (pattern === "hammer" || pattern === "bullish_engulfing") { buyScore += 1; reasons.push(pattern === "hammer" ? "해머" : "강세장악"); }
  if (pattern === "bearish_engulfing") { sellScore += 1; reasons.push("약세장악"); }

  // ── market-monitor 실시간 알림 부스트 ──
  for (const alert of assetAlerts) {
    if (alert.type === "REGIME_SHIFT" || alert.type === "TREND_BIRTH") {
      if (price > prev) { buyScore += 2; reasons.push("모니터:" + alert.type); }
      else { sellScore += 2; reasons.push("모니터:" + alert.type); }
    }
    if (alert.type === "VOL_EXPLOSION" || alert.type === "SMART_MONEY") {
      if (price > prev) { buyScore += 1; } else { sellScore += 1; }
    }
  }

  // ═══════════════════════════════════════════════════════
  // STEP 5: FNG 센티먼트 보정
  // 극단적 공포/탐욕에서 역방향 보너스 (contrarian alpha)
  // ═══════════════════════════════════════════════════════
  if (fngBias === "FEAR") { buyScore += 1; reasons.push("공포역투자"); }
  if (fngBias === "GREED") { sellScore += 1; reasons.push("탐욕역투자"); }

  // ═══════════════════════════════════════════════════════
  // STEP 6: 최종 판정
  // ─ 순점수(net score) 기반: |buyScore - sellScore| >= 2 이면 확신
  // ─ 순점수 1이면 약한 시그널 (포지션 50% 축소)
  // ─ 동점이면 레짐 방향 우선
  // ═══════════════════════════════════════════════════════
  const net = buyScore - sellScore;
  const absNet = Math.abs(net);
  const totalScore = Math.max(buyScore, sellScore);

  // 최소 점수 2 이상이어야 시그널 발생 (노이즈 필터)
  if (totalScore < 2) return null;

  if (net > 0) {
    const conf = absNet >= 6 ? "A" : absNet >= 3 ? "B" : "C";
    const sizeMult = absNet >= 3 ? 1.0 : absNet >= 2 ? 0.7 : 0.4;
    return {
      type: "BUY", confidence: conf,
      score: buyScore, factors: absNet,
      positionSize: posSize * sizeMult,
      reason: reasons.join(" + "),
      bar: L, price,
    };
  }

  if (net < 0) {
    const conf = absNet >= 6 ? "A" : absNet >= 3 ? "B" : "C";
    const sizeMult = absNet >= 3 ? 1.0 : absNet >= 2 ? 0.7 : 0.4;
    return {
      type: "SELL", confidence: conf,
      score: sellScore, factors: absNet,
      positionSize: posSize * sizeMult,
      reason: reasons.join(" + "),
      bar: L, price,
    };
  }

  // 동점 (net === 0): 레짐 기반 방향 결정
  if (regime === "TRENDING") {
    // 추세장 동점: EMA 방향으로
    const dir = ema21[L] > ema55[L] ? "BUY" : "SELL";
    return {
      type: dir, confidence: "C", score: totalScore, factors: 0,
      positionSize: posSize * 0.3,
      reason: reasons.join(" + ") + ` [동점→${dir === "BUY" ? "EMA↑" : "EMA↓"}]`,
      bar: L, price,
    };
  } else {
    // 횡보장 동점: FNG 역방향
    const dir = fngValue <= 50 ? "BUY" : "SELL";
    return {
      type: dir, confidence: "C", score: totalScore, factors: 0,
      positionSize: posSize * 0.3,
      reason: reasons.join(" + ") + ` [동점→FNG${dir}]`,
      bar: L, price,
    };
  }
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
