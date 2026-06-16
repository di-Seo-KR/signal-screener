// Zepta Cron — 멀티 자산 암호화폐 자동매매 서버사이드 엔진
// 10분마다 실행: 바이낸스 선물 캔들 → 전략 시그널 → KV 가상 포트폴리오 매매 + 시그널 풀 적재
// 환경변수: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID (선택)
// 텔레그램 알림: api/_shared/telegram.js 의 buildCard/sendCards (사용자 친화 평어)
//
// ★ 2026-06-11 (대표 승인 2안): 캔들 소스 CryptoCompare → 바이낸스 선물(proxy-aware) 전환.
//   - CryptoCompare(현 CoinDesk)가 키리스 무료 호출 폐지(401) → 신호 생성 전면 중단됐었음.
//   - getKlines 는 Fly.io 프록시 자동 경유 → Vercel IP 차단(451) 무관 (alpha-lab 검증 경로).
//   - 유니버스: 하드코딩 30종 → 유동성(24h 거래대금) 상위 50종 동적 선별 + 폐지 심볼 자동 제외.

import { sendCards, buildCard, fmtKSTShort } from "./_shared/telegram.js";
import { runStrategyForBot, getStrategyNameForBot } from "./_shared/strategies/index.js";
import { getAllStoredStrategyParams } from "./_shared/dynamic-config.js";
import { getMarketContext, getKlines, getTickerPrice } from "./_shared/binance-client.js";
import { getOIChangeMap } from "./_shared/oi-tracker.js";
import { loadUniverse, universeSymbolMap } from "./_shared/futures-universe.js";
import { computeSRLevels, scaleSR } from "./_shared/sr-levels.js"; // ★ 지지·저항(매물대) — 표시 전용
import { refineCompositeEntry } from "./_shared/strategies/_indicators.js"; // ★ MTF 소진·차트구조 진입 정제

// asset → 바이낸스 *선물(USDⓈ-M, fapi)* 심볼. 펀딩/OI/베이시스 맵 조회 키.
//   ★ 2026-06-02 버그수정: 선물은 저가 밈코인을 1000배 묶음(1000SHIB/1000PEPE)으로,
//   MATIC 은 POL 로 상장한다. 현물 규칙({BASE}USDT)으로 추론하면 SHIB/PEPE/MATIC 이
//   빗나가 보정이 조용히 스킵됐음(라이브 확인). 명시 룩업으로 정정.
const FUTURES_SYMBOLS = {
  "BTC/USD": "BTCUSDT", "ETH/USD": "ETHUSDT", "BNB/USD": "BNBUSDT", "SOL/USD": "SOLUSDT",
  "XRP/USD": "XRPUSDT", "ADA/USD": "ADAUSDT", "AVAX/USD": "AVAXUSDT", "TRX/USD": "TRXUSDT",
  "LINK/USD": "LINKUSDT", "DOT/USD": "DOTUSDT", "ATOM/USD": "ATOMUSDT", "NEAR/USD": "NEARUSDT",
  "APT/USD": "APTUSDT", "SUI/USD": "SUIUSDT", "ICP/USD": "ICPUSDT", "HBAR/USD": "HBARUSDT",
  "UNI/USD": "UNIUSDT", "AAVE/USD": "AAVEUSDT", "INJ/USD": "INJUSDT", "FIL/USD": "FILUSDT",
  "LTC/USD": "LTCUSDT", "BCH/USD": "BCHUSDT", "ETC/USD": "ETCUSDT", "TON/USD": "TONUSDT",
  "DOGE/USD": "DOGEUSDT", "SHIB/USD": "1000SHIBUSDT", "PEPE/USD": "1000PEPEUSDT",
  "ARB/USD": "ARBUSDT", "OP/USD": "OPUSDT", "MATIC/USD": "POLUSDT",
};
// ★ 2026-06-11: 동적 유니버스 맵(BASE→SYMBOL) 우선, 정적 FUTURES_SYMBOLS 폴백.
function assetToBinanceSymbol(asset, dynMap) {
  const base = String(asset || "").split("/")[0];
  if (dynMap && dynMap[base]) return dynMap[base];
  return FUTURES_SYMBOLS[asset] || "";
}

export const config = { maxDuration: 300 }; // ★ 2026-06-11: 50종 동적 유니버스 (TF 4개 병렬 fetch) 헤드룸

// 정적 폴백 유니버스 — 동적 유니버스(di:signals:futures-universe) 로드 실패 시에만 사용.
const CRYPTO_ASSETS = [
  // 하이캡 (Top)
  "BTC/USD", "ETH/USD", "BNB/USD", "SOL/USD", "XRP/USD", "ADA/USD", "AVAX/USD", "TRX/USD",
  // L1 / 인프라
  "LINK/USD", "DOT/USD", "ATOM/USD", "NEAR/USD", "APT/USD", "SUI/USD", "ICP/USD", "HBAR/USD",
  // DeFi
  "UNI/USD", "AAVE/USD", "INJ/USD", "FIL/USD",
  // 레거시 / 페이먼트
  "LTC/USD", "BCH/USD", "ETC/USD", "TON/USD",
  // 밈 / 트렌드
  "DOGE/USD", "SHIB/USD", "PEPE/USD",
  // Layer2 / 신흥
  "ARB/USD", "OP/USD", "MATIC/USD",
]; // ★ 2026-06-03 대표 지시: 메이저 30종 (16→30) → 2026-06-11 동적 유니버스의 정적 폴백으로 전환
// ★ 2026-05-11: 가상 포트폴리오 노출 한도 임시 완화.
//   80% 도달 후 매수 SKIP 되어 perf.trades 에 BUY 기록 안 됨 → engine 시그널 풀 빔.
//   95% 로 완화해 새 BUY 가 perf.trades 에 흘러 들어가도록.
//   실거래는 별도 risk-manager 의 합산 노출 가드(자본 1.5배) 가 안전망.
const MAX_POSITION_PER_ASSET = 0.35;     // 0.30 → 0.35
const MAX_TOTAL_CRYPTO_EXPOSURE = 0.95;  // 0.80 → 0.95

// 딜레이 헬퍼 (프록시 부하 분산용 소량 딜레이)
const delay = (ms) => new Promise(r => setTimeout(r, ms));

// 바이낸스 USDⓈ-M 선물 OHLCV 캔들 로드 (proxy-aware getKlines 경유 — Vercel IP 차단 무관)
//   ★ 2026-06-11: CryptoCompare 키 의무화(401)로 전환. 실제 매매 거래소 가격으로
//   신호를 만들어 집행 가격과의 정합성도 개선. interval 은 바이낸스 네이티브(1w/1d/4h/1h).
async function fetchFuturesCandles(symbol, interval, limit) {
  const kl = await getKlines({ symbol, interval, limit: Math.min(limit, 1500) });
  if (!Array.isArray(kl)) throw new Error("klines not array");
  return kl.map(k => ({
    time: Math.floor((k[0] || 0) / 1000), // CC 하위호환: 초 단위 (resampleWeekly 등에서 사용)
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
    volume: parseFloat(k[5]) || 0,
  })).filter(c => c.close > 0 && c.high > 0 && c.low > 0);
}

// ── 봇별 자산 매핑 (AutoTrading.jsx의 CRYPTO_BOTS와 동기화) ──
//   ★ 2026-06-11: "ALL" = 동적 유니버스 전체 (crypto-diversity / crypto-swing).
//   정적 리스트 봇은 유지 — 동적 유니버스의 1000-단위 자산(1000SHIB/USD)도
//   getBotsForAsset 의 prefix 정규화로 기존 매핑(SHIB/USD)과 매칭됨.
const BOT_ASSET_MAP = {
  "btc-alpha": ["BTC/USD"],
  "highcap-momentum": ["BTC/USD", "ETH/USD", "SOL/USD", "XRP/USD", "ADA/USD", "AVAX/USD"],
  "defi-infra": ["LINK/USD", "UNI/USD", "AAVE/USD", "DOT/USD"],
  "meme-trend": ["DOGE/USD", "SHIB/USD", "PEPE/USD"],
  "l2-emerging": ["ARB/USD", "OP/USD", "MATIC/USD"],
  "crypto-diversity": "ALL", // 동적 유니버스 전체
  "crypto-swing": "ALL", // 동적 유니버스 전체
};

// 자산 → 해당 자산을 다루는 봇 목록
function getBotsForAsset(asset) {
  const plain = String(asset || "").replace(/^1000/, ""); // 1000SHIB/USD ↔ SHIB/USD 매칭
  return Object.entries(BOT_ASSET_MAP)
    .filter(([, assets]) => assets === "ALL" || assets.includes(asset) || assets.includes(plain))
    .map(([botId]) => botId);
}

export default async function handler(req, res) {
  const startTime = Date.now();
  const log = [];
  const addLog = (msg) => { log.push(`[${new Date().toISOString()}] ${msg}`); console.log(msg); };

  try {
    addLog("🚀 크립토 자동매매 Cron 시작 (15분 간격)");

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
    const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const TG_CHAT = process.env.TELEGRAM_CHAT_ID;

    // ── KV 가상 포트폴리오 로드 ──
    addLog("💰 가상 포트폴리오 로드...");
    let kvModule, kv;
    try {
      kvModule = await import("@vercel/kv");
      kv = kvModule.kv;
    } catch {
      addLog("❌ KV 연결 실패 — 매매 불가");
      return res.status(200).json({ ok: false, error: "KV connection failed", log });
    }

    const PORTFOLIO_KEY = "di:virtual:portfolio";
    const INITIAL_CASH = 100000; // 가상 초기 자금 $100,000
    let portfolio = await kv.get(PORTFOLIO_KEY);
    if (!portfolio) {
      portfolio = {
        cash: INITIAL_CASH,
        initialCash: INITIAL_CASH,
        positions: {}, // { "BTC/USD": { qty: 0.5, avgPrice: 60000, entryTime: "..." } }
        totalTrades: 0,
        createdAt: new Date().toISOString(),
      };
      await kv.set(PORTFOLIO_KEY, portfolio);
      addLog(`🆕 가상 포트폴리오 생성: $${INITIAL_CASH.toLocaleString()}`);
    }

    // ── ★ 2026-06-11 (대표 승인 2안): 동적 유니버스 로드 — 유동성 상위 50종 자동 선별 ──
    //   6시간 주기 갱신(거래소 exchangeInfo + 24h 거래대금). 실패 시 stale 캐시 →
    //   그것도 없으면 정적 30종(CRYPTO_ASSETS) 폴백. 어떤 경우에도 cron 은 멈추지 않음.
    let dynSymbolMap = null;
    let ASSETS = CRYPTO_ASSETS;
    const quoteVolByAsset = {}; // ★ 2026-06-14: 자산별 24h 거래대금(USD) — item5 거래량 게이트용(신호풀 enrich, 추가 API 0)
    try {
      const universe = await loadUniverse(kv);
      if (universe?.entries?.length) {
        dynSymbolMap = universeSymbolMap(universe);
        ASSETS = universe.entries.map((e) => e.asset);
        for (const e of universe.entries) quoteVolByAsset[e.asset] = Number(e.quoteVolume) || 0;
        addLog(`🌐 동적 유니버스: 유동성 상위 ${ASSETS.length}종 (${universe.generatedAt} 기준)`);
      } else {
        addLog(`🌐 동적 유니버스 미가용 — 정적 ${ASSETS.length}종 폴백`);
      }
    } catch (e) {
      addLog(`⚠️ 유니버스 로드 실패(${e?.message}) — 정적 ${ASSETS.length}종 폴백`);
    }

    // ── 활성 봇 확인 → 매매 대상 자산 필터링 + 자산별 배분금액 한도 ──
    let activeAssets = new Set(ASSETS); // 기본: 전체
    const assetAllocationMap = {}; // { "BTC/USD": 총 배분금액 }  — 봇별 배분금액 합산
    try {
      const activeBots = await kv.get("di:active-bots");
      if (Array.isArray(activeBots) && activeBots.length > 0) {
        activeAssets = new Set();
        for (const ab of activeBots) {
          const mapped = BOT_ASSET_MAP[ab.botId];
          const botAssets = mapped === "ALL" ? ASSETS : mapped;
          const allocation = ab.allocation || 0;
          if (botAssets && allocation > 0) {
            const perAsset = allocation / botAssets.length; // 봇 배분금액을 자산 수로 균등 분배
            botAssets.forEach(a => {
              activeAssets.add(a);
              assetAllocationMap[a] = (assetAllocationMap[a] || 0) + perAsset;
            });
          }
        }
        const totalAlloc = activeBots.reduce((s, ab) => s + (ab.allocation || 0), 0);
        addLog(`🤖 활성 봇 ${activeBots.length}개 → 매매 대상: ${activeAssets.size}종목, 총 배분: $${totalAlloc.toLocaleString()}`);
      } else {
        // 활성 봇 정보가 없으면 매매 안 함 (봇 미생성 상태)
        activeAssets = new Set();
        addLog(`⏸️ 활성 봇 없음 — 시그널 스캔만 수행 (매매 건너뜀)`);
      }
    } catch (e) {
      addLog(`⚠️ 활성 봇 조회 실패: ${e.message} — 전체 자산 스캔`);
      activeAssets = new Set(ASSETS);
    }

    // ── 실시간 가격 조회 (바이낸스 선물 전 심볼 1콜 → CoinGecko 폴백) ──
    //   ★ 2026-06-11: 현물 직접호출 제거 — proxy-aware 선물 티커로 통일 (Vercel IP 차단 무관,
    //   실제 매매 거래소 가격과 일치). 보유 중인 구 유니버스 자산도 정적 맵으로 가격 보전.
    const priceMap = {};
    let priceSource = "none";
    const priceAssets = new Set([...ASSETS, ...Object.keys(portfolio.positions || {})]);

    // 1차: 바이낸스 선물 전 심볼 티커 (프록시 경유)
    try {
      const tickers = await getTickerPrice({});
      const bySym = {};
      for (const t of (Array.isArray(tickers) ? tickers : [])) {
        if (t?.symbol) bySym[t.symbol] = parseFloat(t.price);
      }
      for (const asset of priceAssets) {
        const sym = assetToBinanceSymbol(asset, dynSymbolMap);
        if (!sym) continue;
        let p = bySym[sym];
        if (!Number.isFinite(p) || p <= 0) continue;
        // 레거시 자산(SHIB/USD 등)이 1000-단위 선물(1000SHIBUSDT)에 매핑되면 가상 포트폴리오
        // 가격 스케일(현물 기준)에 맞춰 환산. 동적 유니버스 자산(1000SHIB/USD)은 그대로.
        if (sym.startsWith("1000") && !String(asset).startsWith("1000")) p = p / 1000;
        priceMap[asset] = p;
      }
      if (Object.keys(priceMap).length > 0) priceSource = "binance-futures";
      addLog(`📡 바이낸스 선물 가격: ${Object.keys(priceMap).length}종목 로드`);
    } catch (e) {
      addLog(`⚠️ 선물 가격 실패: ${e.message}`);
    }

    // 2차: CoinGecko 폴백 (Binance 실패 시)
    if (Object.keys(priceMap).length < 5) {
      try {
        const geckoIds = {
          "BTC/USD": "bitcoin", "ETH/USD": "ethereum", "SOL/USD": "solana",
          "XRP/USD": "ripple", "ADA/USD": "cardano", "AVAX/USD": "avalanche-2",
          "LINK/USD": "chainlink", "UNI/USD": "uniswap", "AAVE/USD": "aave",
          "DOT/USD": "polkadot", "DOGE/USD": "dogecoin", "SHIB/USD": "shiba-inu",
          "PEPE/USD": "pepe", "ARB/USD": "arbitrum", "OP/USD": "optimism",
          "MATIC/USD": "matic-network",
        };
        const ids = Object.values(geckoIds).join(",");
        const geckoRes = await fetch(
          `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`,
          { signal: AbortSignal.timeout(8000) }
        );
        const geckoData = await geckoRes.json();
        for (const [asset, geckoId] of Object.entries(geckoIds)) {
          if (geckoData[geckoId]?.usd) priceMap[asset] = geckoData[geckoId].usd;
        }
        if (Object.keys(priceMap).length > 0) priceSource = "coingecko";
        addLog(`📡 CoinGecko 폴백: ${Object.keys(priceMap).length}종목 로드`);
      } catch (e) {
        addLog(`⚠️ CoinGecko도 실패: ${e.message}`);
      }
    }

    if (Object.keys(priceMap).length === 0) {
      addLog(`❌ 모든 가격 소스 실패 — 매매 불가`);
      return res.status(200).json({ ok: false, error: "All price sources failed", log });
    }
    addLog(`✅ 가격 소스: ${priceSource} (${Object.keys(priceMap).length}종목)`);

    // ── 포트폴리오 가치 계산 ──
    let totalMarketValue = 0;
    const positionMap = {};
    for (const [asset, pos] of Object.entries(portfolio.positions || {})) {
      const currentPrice = priceMap[asset];
      if (!currentPrice || !pos.qty || pos.qty <= 0) continue;
      const marketValue = pos.qty * currentPrice;
      const costBasis = pos.qty * pos.avgPrice;
      const unrealizedPL = marketValue - costBasis;
      const unrealizedPLPct = costBasis > 0 ? (unrealizedPL / costBasis) * 100 : 0;
      totalMarketValue += marketValue;
      positionMap[asset] = {
        symbol: asset,
        qty: pos.qty,
        avg_entry_price: pos.avgPrice,
        current_price: currentPrice,
        market_value: marketValue,
        cost_basis: costBasis,
        unrealized_pl: unrealizedPL,
        unrealized_plpc: unrealizedPLPct / 100,
        updated_at: pos.entryTime,
      };
    }
    const equity = portfolio.cash + totalMarketValue;
    const cash = portfolio.cash;
    addLog(`✅ 가상 계좌: $${equity.toFixed(0)} (현금: $${cash.toFixed(0)}, 포지션: $${totalMarketValue.toFixed(0)})`);
    addLog(`📊 보유 포지션: ${Object.keys(positionMap).length}종목`);

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

    // ── equity 유효성 검증 ──
    if (!isFinite(equity) || equity <= 0) {
      addLog(`❌ equity 비정상 ($${equity}) — 매매 중단`);
      return res.status(200).json({ ok: false, error: "Invalid equity", log });
    }

    // ── 멀티 자산 스캔 및 주문 실행 ──
    const assetResults = [];

    // ★ 2026-05-29 — 알파랩에서 발굴·튜닝된 전략 파라미터를 라이브 신호 생성에 주입.
    //   getAllStoredStrategyParams 는 *실제로 적재된* 파라미터만 반환 (없으면 빈 객체)
    //   → 튜닝 전엔 모든 전략이 기존 하드코딩 baseline 으로 동작 (default-preserving).
    //   continuous-backtest / param-tuner 가 di:alpha:params 에 적재하면 즉시 반영.
    let paramsByStrategy = {};
    try {
      paramsByStrategy = await getAllStoredStrategyParams();
      const tunedList = Object.keys(paramsByStrategy);
      if (tunedList.length > 0) {
        addLog(`🧬 튜닝 파라미터 적용: ${tunedList.join(", ")}`);
      }
    } catch (e) {
      addLog(`⚠️ 전략 파라미터 로드 실패 (baseline 사용): ${e?.message}`);
    }

    // ★ 2026-06-02 (P3+OI) 선물 컨텍스트 batch 조회 — 펀딩/베이시스(premiumIndex 1회) + OI 변화.
    //   전부 신호 확신 보정용(방향 안 바꿈). 실패해도 빈 맵 → 보정 스킵, cron 영향 0.
    let fundingMap = {}, basisMap = {}, oiChangeMap = {};
    try {
      const ctx = await getMarketContext();
      fundingMap = ctx.funding || {};
      basisMap = ctx.basis || {};
      if (Object.keys(fundingMap).length) addLog(`💸 펀딩/베이시스 ${Object.keys(fundingMap).length}심볼 로드`);
    } catch { /* 무시 */ }
    try {
      const binSymbols = ASSETS.map((a) => assetToBinanceSymbol(a, dynSymbolMap)).filter(Boolean);
      const oi = await getOIChangeMap(kv, binSymbols);
      oiChangeMap = oi.changeMap || {};
      if (oi.fetched > 0) addLog(`📈 OI ${oi.fetched}심볼 조회, 변화 비교 ${Object.keys(oiChangeMap).length}건`);
    } catch { /* 무시 */ }

    // ★ 2026-06-14 (감사 #3, 대표 승인): 시그널 풀 쓰기 배칭.
    //   기존: 에셋당 kv.get→modify→kv.set (런당 ~30-50종 × 2풀 = ~60-100 KV op) — KV 쓰기
    //   증폭 + btc-cron 동시실행 시 read-modify-write race window 가 매 에셋마다 열림.
    //   변경: 루프 안에서는 메모리 누적만, 루프 후 풀당 1회만 쓰기 → KV op 대폭 절감 +
    //   race window 를 런당 1회로 축소. 각 엔트리는 per-asset ts 유지(엔진이 ts 내림차순
    //   재정렬하므로 배열 순서 무관·기존과 동일 결과). 이 두 키는 btc-cron 만 write(전수 확인).
    const newPoolEntries = []; // di:signals:realtime-pool (거래 신호 — engine 이 읽음)
    const newMtfEntries = [];  // di:signals:realtime-pool-mtf (코인 카드 표시용)

    for (const asset of ASSETS) {
      addLog(`\n📊 ${asset} 스캔 중...`);
      const futSymbol = assetToBinanceSymbol(asset, dynSymbolMap);
      if (!futSymbol) {
        addLog(`⏭️ ${asset} 선물 심볼 매핑 없음 — 스킵`);
        assetResults.push({ asset, ok: false, error: "No futures symbol" });
        continue;
      }

      // ── 캔들 데이터 로드 (바이낸스 선물 proxy-aware — 4개 TF 병렬) ──
      let candles = [], candles4h = [], candles1h = [], candles1w = [];
      let candleSource = "none";
      const [r1d, r4h, r1h, r1w] = await Promise.allSettled([
        fetchFuturesCandles(futSymbol, "1d", 365),
        fetchFuturesCandles(futSymbol, "4h", 500),
        fetchFuturesCandles(futSymbol, "1h", 500),
        fetchFuturesCandles(futSymbol, "1w", 120),
      ]);
      if (r1d.status === "fulfilled") candles = r1d.value;
      else addLog(`⚠️ ${asset}(${futSymbol}) 일봉 실패: ${r1d.reason?.message}`);
      if (r4h.status === "fulfilled") candles4h = r4h.value;
      if (r1h.status === "fulfilled") candles1h = r1h.value;
      if (r1w.status === "fulfilled") candles1w = r1w.value;
      if (candles.length > 50) candleSource = "binance-futures";

      if (candles.length < 100) {
        addLog(`❌ ${asset} 캔들 부족 (${candles.length}개 < 100개) — 스킵 (신규상장/일시오류)`);
        assetResults.push({ asset, ok: false, error: "Insufficient candle data" });
        continue;
      }

      // ★ 2026-06-03 (대표 지시): 멀티 타임프레임 종합 스코어용 — 각 TF 신호를 *항상* 계산.
      //   (기존 4h/1h '폴백'과 별개. 주봉·일봉·4h·1h 를 가중합산해 단일 종합 스코어 산출.)
      const sigForTF = (arr, tf) => {
        if (!Array.isArray(arr) || arr.length < 61) return null;
        try {
          // ★ 2026-06-16 (대표 제보 — 합성점수 10~20점 출렁임 진단/수정): sub-daily TF 신호를
          //   *완결 캔들*로만 계산. 기존엔 형성 중(미완결) 마지막 봉을 포함해 매 10분 재계산 →
          //   1h/4h 지표가 봉 안에서 흔들려 borderline 신호가 깜빡(리페인팅) → 합성점수(0.20·1h +
          //   0.25·4h 부호가중)가 ±10~20 출렁였음. 진행 중 봉 제외 → 1h 는 시간당·4h 는 4시간당
          //   1회만 변경 = 안정. (일/주 영향 미미하나 일관성·리페인팅 제거 위해 동일 적용. 일봉
          //   메인신호 latestSignal 은 불변.) ZEPTA_MTF_CLOSED_BARS=0 으로 기존(미완결 포함) 복귀.
          const src = process.env.ZEPTA_MTF_CLOSED_BARS === "0" ? arr : arr.slice(0, -1);
          if (src.length < 61) return null;
          const cl = src.map(c => c.close), hi = src.map(c => c.high), lo = src.map(c => c.low);
          const s = pickTopBotSignal(computeBotSignals({
            asset, closes: cl, highs: hi, lows: lo, volumes: src.map(c => c.volume || 0), timeframe: tf, paramsByStrategy,
          }));
          if (s) return s;
          // ★ 2026-06-14: 전략 HOLD → 지표 기반 약한 추세읽기 폴백 (TF 빈칸 방지)
          return tfFallbackSignal(cl, hi, lo, tf);
        } catch { return null; }
      };
      const tf1wSignal = sigForTF(candles1w, "1w");
      const tf4hSignal = sigForTF(candles4h, "4h");
      const tf1hSignal = sigForTF(candles1h, "1h");

      // 다음 자산 전 소량 딜레이 — 프록시 부하 분산 (바이낸스 한도는 여유)
      await delay(150);

      addLog(`✅ ${asset} [${candleSource}]: 일봉 ${candles.length}개 + 4h ${candles4h.length}개 + 1h ${candles1h.length}개 (최신: $${candles[candles.length - 1]?.close?.toFixed(0)})`);

      // 지표 계산
      const closes = candles.map(c => c.close);
      const highs = candles.map(c => c.high);
      const lows = candles.map(c => c.low);
      const volumes = candles.map(c => c.volume || 0);

      // ★ 2026-06-12 (대표 지시): 지지·저항(매물대) 레벨 — 일봉 재활용, 추가 API 0회.
      //   refPrice 는 priceMap 이 아닌 *일봉 마지막 종가* (캔들·기준가 스케일 일치 필수).
      //   레거시 자산(SHIB/USD 등)이 1000-단위 선물 캔들로 계산되면 priceMap(230행)과
      //   동일 규칙으로 1/1000 환산. 어떤 실패도 cron 을 막지 않음(표시 전용).
      let srLevels = null;
      try {
        srLevels = computeSRLevels(candles, candles[candles.length - 1]?.close);
        if (srLevels && String(futSymbol || "").startsWith("1000") && !String(asset).startsWith("1000")) {
          srLevels = scaleSR(srLevels, 1 / 1000);
        }
      } catch { srLevels = null; }

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
      const binSymbol = futSymbol || asset;
      const assetAlerts = monitorAlerts.filter(a => a.ticker === binSymbol || a.ticker === asset);

      // ★ 2026-05-11: 봇별 strategy dispatcher 도입
      //   이 자산을 다루는 활성 봇 각각의 전용 strategy 실행.
      //   결과: { botId, signal } 배열. 최고 점수를 latestSignal 로 채택.
      //   봇별 perf 저장 시에도 이 botSignals 를 사용해 봇마다 다른 메타데이터 기록.
      const botSignals = computeBotSignals({ asset, closes, highs, lows, volumes, timeframe: "1d", paramsByStrategy });

      // 일봉 단계 — 봇별 strategy 결과 중 가장 점수 높은 1개를 우선 시그널로
      let latestSignal = pickTopBotSignal(botSignals);
      const sig1d = latestSignal; // ★ 순수 1d 신호 캡처(이후 폴백이 latestSignal 을 덮어써도 보존)

      // ★ 2026-06-03 (대표 지시): 멀티 타임프레임 종합 스코어.
      //   주25·일30·4h25·1h20 부호 가중합 → 전 봉 합의 시 점수↑, 갈리면 상쇄(자동 컨플루언스).
      const _signed = (s) => !s ? 0 : ((s.type === "BUY" ? 1 : s.type === "SELL" ? -1 : 0) * (parseFloat(s.score) || 0));
      // 가중치(대표 지시 2026-06-03): 주30 · 일25 · 4h25 · 1h20
      const _compRaw = 0.30 * _signed(tf1wSignal) + 0.25 * _signed(sig1d) + 0.25 * _signed(tf4hSignal) + 0.20 * _signed(tf1hSignal);
      const _compScore = Math.round(Math.min(100, Math.abs(_compRaw)));
      const _compType = _compRaw > 0.5 ? "BUY" : _compRaw < -0.5 ? "SELL" : null;
      const _tfTag = (s) => !s ? "—" : `${s.type === "BUY" ? "롱" : "숏"}${Math.round(s.score)}`;
      const _breakdown = {
        "1w": tf1wSignal ? { type: tf1wSignal.type, score: Math.round(tf1wSignal.score) } : null,
        "1d": sig1d ? { type: sig1d.type, score: Math.round(sig1d.score) } : null,
        "4h": tf4hSignal ? { type: tf4hSignal.type, score: Math.round(tf4hSignal.score) } : null,
        "1h": tf1hSignal ? { type: tf1hSignal.type, score: Math.round(tf1hSignal.score) } : null,
      };
      const compositeSignal = _compType ? {
        type: _compType, side: _compType === "BUY" ? "LONG" : "SHORT", score: _compScore,
        timeframe: "MTF", family: "composite",
        confidence: _compScore >= 80 ? "A" : _compScore >= 60 ? "B" : "C",
        reason: `종합 ${_compScore} (주${_tfTag(tf1wSignal)}·일${_tfTag(sig1d)}·4h${_tfTag(tf4hSignal)}·1h${_tfTag(tf1hSignal)})`,
        breakdown: _breakdown,
        // 점수 비례 사이즈(고정 0.5 → 0.3~0.7): 합의 강할수록 크게
        positionSize: Math.round((0.3 + Math.min(1, _compScore / 100) * 0.4) * 100) / 100,
      } : null;

      // 봇별 strategy 가 아무도 시그널 안 내면 기존 단일 analyzeLatest 로 fallback
      // (백워드 호환: 봇 매핑 안 된 자산이나 활성 봇 없는 케이스 처리)
      if (!latestSignal) {
        latestSignal = analyzeLatest(candles, closes, highs, lows, volumes, {
          rsi, bb, ema21, ema55, ema200, macdLine, macdSig, histogram,
          adx, atr, stoch, obv, obvEma, volSMA, weeklyTrendUp,
        }, fngValue, marketRegime, assetAlerts);
      }

      // 일봉에서 시그널 없으면 4시간봉으로 재시도
      if (!latestSignal && candles4h.length >= 61) {
        addLog(`🔄 ${asset} 일봉 시그널 없음 → 4시간봉 분석...`);
        const c4h = candles4h;
        const closes4h = c4h.map(c => c.close);
        const highs4h = c4h.map(c => c.high);
        const lows4h = c4h.map(c => c.low);
        const volumes4h = c4h.map(c => c.volume || 0);

        // ★ 봇별 strategy 4h 단계 — 일봉 빈 자산도 더 짧은 TF 로 한 번 더 기회
        const botSignals4h = computeBotSignals({ asset, closes: closes4h, highs: highs4h, lows: lows4h, volumes: volumes4h, timeframe: "4h", paramsByStrategy });
        latestSignal = pickTopBotSignal(botSignals4h);

        if (!latestSignal) {
          // 봇 strategy 가 4h 도 비면 단일 analyzeLatest 로 fallback
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
            latestSignal.positionSize = (latestSignal.positionSize || 0.5) * 0.5;
            latestSignal.timeframe = "4h";
          }
        } else {
          // 봇 strategy 4h 결과: 포지션 50% 축소
          latestSignal.positionSize = (latestSignal.positionSize || 0.5) * 0.5;
          latestSignal.sizeHint = (latestSignal.sizeHint || 0.5) * 0.5;
        }
      }

      // 일봉+4시간봉 모두 시그널 없으면 1시간봉으로 재시도 (유동성 시간대만)
      const currentHourUTC = new Date().getUTCHours();
      const isLiquidHours = currentHourUTC >= 8 || currentHourUTC < 2; // 아시안 저유동성 02-08 UTC 스킵
      if (!latestSignal && candles1h.length >= 61 && isLiquidHours) {
        addLog(`🔄 ${asset} 일봉+4h 시그널 없음 → 1시간봉 분석 (UTC${currentHourUTC}시)...`);
        const c1h = candles1h;
        const closes1h = c1h.map(c => c.close);
        const highs1h = c1h.map(c => c.high);
        const lows1h = c1h.map(c => c.low);
        const volumes1h = c1h.map(c => c.volume || 0);

        // ★ 봇별 strategy 1h 단계
        const botSignals1h = computeBotSignals({ asset, closes: closes1h, highs: highs1h, lows: lows1h, volumes: volumes1h, timeframe: "1h", paramsByStrategy });
        latestSignal = pickTopBotSignal(botSignals1h);

        if (!latestSignal) {
          const rsi1h = calcRSI(closes1h, 14);
          const bb1h = calcBB(closes1h, 20, 2.0);
          const ema21_1h = calcEMA(closes1h, 21);
          const ema55_1h = calcEMA(closes1h, 55);
          const ema200_1h = closes1h.length > 200 ? calcEMA(closes1h, 200) : [];
          const macd1h = calcMACD(closes1h);
          const adx1h = calcADX(highs1h, lows1h, closes1h, 14);
          const atr1h = calcATR(highs1h, lows1h, closes1h, 14);
          const stoch1h = calcStochastic(highs1h, lows1h, closes1h, 14, 3);
          const obv1h = calcOBV(closes1h, volumes1h);
          const obvEma1h = calcEMA(obv1h, 20);
          const volSMA1h = calcSMA(volumes1h, 20);
          latestSignal = analyzeLatest(c1h, closes1h, highs1h, lows1h, volumes1h, {
            rsi: rsi1h, bb: bb1h, ema21: ema21_1h, ema55: ema55_1h, ema200: ema200_1h,
            macdLine: macd1h.macdLine, macdSig: macd1h.signal, histogram: macd1h.histogram,
            adx: adx1h, atr: atr1h, stoch: stoch1h, obv: obv1h, obvEma: obvEma1h, volSMA: volSMA1h, weeklyTrendUp,
          }, fngValue, marketRegime, assetAlerts);
          if (latestSignal) {
            latestSignal.reason = `[1h] ${latestSignal.reason}`;
            latestSignal.positionSize = (latestSignal.positionSize || 0.5) * 0.3;
            latestSignal.timeframe = "1h";
          }
        } else {
          latestSignal.positionSize = (latestSignal.positionSize || 0.5) * 0.3;
          latestSignal.sizeHint = (latestSignal.sizeHint || 0.5) * 0.3;
        }
      }

      if (!latestSignal) {
        addLog(`⏸️ ${asset} 시그널 없음 (일봉+4h+1h 모두)`);
        assetResults.push({ asset, ok: true, action: "wait", signal: null });
        continue;
      }

      // ★ 2026-06-02 MTF + 펀딩 + OI + 베이시스 — 최종 신호 확신 보정 (bounded, 방향 불변).
      try {
        const sSide = latestSignal.side;
        // (a) MTF: 4h 추세(EMA21 vs EMA55)가 신호와 충돌하면 확신 하향
        if (sSide && Array.isArray(candles4h) && candles4h.length >= 61) {
          const c4 = candles4h.map(c => c.close);
          const e21 = calcEMA(c4, 21), e55 = calcEMA(c4, 55);
          const L4 = c4.length - 1;
          if (e21[L4] != null && e55[L4] != null) {
            const tf4Dir = e21[L4] > e55[L4] ? "LONG" : "SHORT";
            if (tf4Dir !== sSide) {
              latestSignal.score = Math.max(50, Math.round((latestSignal.score || 60) * 0.85));
              if (latestSignal.confidence === "A") latestSignal.confidence = "B";
              latestSignal.reason = (latestSignal.reason || "") + " +MTF충돌(4h역방향)";
              addLog(`  ↘ ${asset} MTF 충돌(4h ${tf4Dir} vs ${sSide}) → 확신 하향`);
            }
          }
        }
        // (b)(c)(d) 펀딩·OI·베이시스 — 그래디언트 보정(임계↓·점진·bounded). 1d 신호 + 종합에 동일 적용.
        //   ★ 2026-06-03(대표 지시): 극단-only → 더 자주·점진적으로 알파 기여. 방향은 검증된 것만.
        const sym = futSymbol;
        const fr = fundingMap[sym], oiCh = oiChangeMap[sym], bs = basisMap[sym];
        const n1 = applyFuturesContext(latestSignal, { fr, oiCh, bs });
        if (n1 && n1.length) addLog(`  ⚙ ${asset} 선물보정(${latestSignal.side}): ${n1.join("·")} → ${latestSignal.score}pt`);
        applyFuturesContext(compositeSignal, { fr, oiCh, bs }); // 종합 스코어에도 동일
      } catch (e) { addLog(`⚠️ ${asset} 선물컨텍스트 보정 실패: ${e?.message}`); }

      // ★ 2026-06-14 (대표 지시): MTF 소진·차트구조 진입 정제 — 1h·4h·1d 다중 과매수면
      //   롱 점수 감점(반대 과매도→숏 감점) + 과확장 추격·S/R 근접 감점 + 압축 후 돌파/쐐기형 가점.
      //   "합리적인 좋은 타점" 선별. 방향 불변(감점·가점만). ZEPTA_ENTRY_REFINE=0 으로 끔.
      try {
        const _mk = (arr) => (Array.isArray(arr) && arr.length)
          ? { closes: arr.map(c => c.close), highs: arr.map(c => c.high), lows: arr.map(c => c.low), volumes: arr.map(c => c.volume || 0) } : null;
        const _perTF = { "1h": _mk(candles1h), "4h": _mk(candles4h), "1d": { closes, highs, lows, volumes } };
        const _refSide = compositeSignal?.side || latestSignal?.side;
        if (_refSide) {
          const _ref = refineCompositeEntry({ side: _refSide, perTF: _perTF, sr: srLevels, price: closes[closes.length - 1] });
          if (_ref.mult !== 1) {
            if (compositeSignal) {
              compositeSignal.entryRefine = { mult: _ref.mult, reasons: _ref.reasons, before: compositeSignal.score };
              compositeSignal.score = Math.max(0, Math.min(100, Math.round(compositeSignal.score * _ref.mult)));
              if (_ref.reasons.length) compositeSignal.reason = (compositeSignal.reason || "") + ` | 진입정제 ${_ref.mult.toFixed(2)}×(${_ref.reasons.join(", ")})`;
            }
            if (latestSignal) {
              latestSignal.entryRefine = { mult: _ref.mult, reasons: _ref.reasons, before: latestSignal.score };
              latestSignal.score = Math.max(0, Math.min(100, Math.round((latestSignal.score || 60) * _ref.mult)));
            }
            addLog(`  🎯 ${asset} 진입정제 ${_ref.mult.toFixed(2)}×: ${_ref.reasons.join(" · ")}`);
          }
        }
      } catch (e) { addLog(`  진입정제 skip: ${e?.message}`); }

      addLog(`🎯 ${asset} 시그널: ${latestSignal.type} | ${latestSignal.confidence}급 | ${latestSignal.score}pt`);

      // ★ 2026-05-13 architectural fix: 시그널 풀 SSOT 적재.
      //   실거래 engine 이 di:bot:*:perf 가 아닌 di:signals:realtime-pool 에서 시그널을 가져오면
      //   가상 포트폴리오 한도 / cron 중단 / skip 여부와 완전 독립적으로 작동.
      //   대표 지시: "다시는 실제매매 쪽이 이런 이슈들로 영향받지 않게"
      try {
        // ── 거래 신호: 종합 스코어 플래그(ZEPTA_TRADE_COMPOSITE=1) ON 이면 종합, 아니면 1d/캐스케이드 ──
        //   기본 OFF — 봇 '매매 심장' 교체라 돈 직결. shadow 검증 후 ON 권장.
        //   ★ 배칭: 여기선 메모리 누적만, 실제 KV 쓰기는 루프 후 1회(아래 newPoolEntries 처리).
        //   per-asset ts 유지(엔진 ts 내림차순 재정렬 → 순서 동일).
        const tradeSignal = (process.env.ZEPTA_TRADE_COMPOSITE === "1" && compositeSignal) ? compositeSignal : latestSignal;
        // ★ 2026-06-14: 진입 게이트용 메타 enrich (engine 이 읽어 item5/item7 판정, 추가 API 0).
        //   rsi1h: 1h RSI(item7 극단 진입 판정). htfConfirm: 상위TF(4h 또는 1d)가 거래방향을
        //   확인하는가(item7 — 추세 확인되면 극단이어도 통과). quoteVolume: 24h 거래대금(item5).
        let _rsi1h = null;
        try {
          if (Array.isArray(candles1h) && candles1h.length >= 15) {
            const _r = calcRSI(candles1h.map(c => c.close), 14);
            const _v = _r[_r.length - 1];
            if (Number.isFinite(_v)) _rsi1h = Math.round(_v);
          }
        } catch { _rsi1h = null; }
        // ★ 핫픽스(적대검증 F2): analyzeLatest 폴백 신호는 .side 없이 type 만 있어, 기존
        //   (tf4hSignal?.side === tradeSignal.side) 가 undefined===undefined→true 로 htfConfirm 을
        //   잘못 true 로 만들 수 있었음(RSI 게이트 우회). type→side 정규화 + 거래방향 존재 확인.
        const _sideOf = (s) => s ? (s.side || (s.type === "BUY" ? "LONG" : s.type === "SELL" ? "SHORT" : null)) : null;
        const _tradeSide = _sideOf(tradeSignal);
        const _htfConfirm = !!_tradeSide && (_sideOf(tf4hSignal) === _tradeSide || _sideOf(sig1d) === _tradeSide);
        newPoolEntries.push({
          ts: Date.now(), time: new Date().toISOString(), asset,
          type: tradeSignal.type, confidence: tradeSignal.confidence, score: tradeSignal.score,
          family: tradeSignal.family, timeframe: tradeSignal.timeframe, side: tradeSignal.side,
          reason: (tradeSignal.reason || "").slice(0, 200),
          positionSize: tradeSignal.positionSize || 0.5, source: "btc-cron",
          sr: srLevels, // ★ 지지·저항 — 표시 전용 (engine 은 이 필드를 읽지 않음, additive-safe)
          rsi1h: _rsi1h,                                  // ★ item7 (1h 극단 RSI)
          htfConfirm: !!_htfConfirm,                      // ★ item7 (상위TF 추세 확인)
          quoteVolume: quoteVolByAsset[asset] ?? null,    // ★ item5 (24h 거래대금 USD)
        });

        // ── 종합 스코어 표시 풀 (코인 카드용 — 엔진 거래와 별개로 항상 적재) ──
        if (compositeSignal) {
          newMtfEntries.push({
            ts: Date.now(), time: new Date().toISOString(), asset,
            type: compositeSignal.type, side: compositeSignal.side, score: compositeSignal.score,
            confidence: compositeSignal.confidence, family: "composite", timeframe: "MTF",
            breakdown: compositeSignal.breakdown, reason: compositeSignal.reason, source: "btc-cron-mtf",
            entryRefine: compositeSignal.entryRefine || null, // ★ MTF 소진·차트구조 정제 사유
            sr: srLevels, // ★ 지지·저항 — 코인 카드 매물대 표시용
          });
        }
      } catch (poolErr) {
        addLog(`⚠️ ${asset} 시그널 풀 누적 실패: ${poolErr.message}`);
      }

      // 현재 포지션 확인
      const pos = positionMap[asset];
      const currentExposure = pos ? parseFloat(pos.market_value || 0) : 0;
      const positionSize = latestSignal.positionSize || 0.5;

      // 포지션 크기 결정
      const maxAssetValue = equity * MAX_POSITION_PER_ASSET;
      let tradeAmount = 0;

      // 동적 손절 + 이익 실현 (레짐별 맞춤)
      let shouldSellForStopLoss = false;
      let shouldTakeProfit = false;
      if (pos && pos.unrealized_pl != null) {
        const plPct = (parseFloat(pos.unrealized_pl) / parseFloat(pos.cost_basis || 1)) * 100;
        // 레짐별 손절: 평균회귀 -2.5%, 추세추종 -5%
        const stopLevel = marketRegime === "MEAN_REVERT" ? -2.5 : -5;
        if (plPct <= stopLevel) {
          shouldSellForStopLoss = true;
          addLog(`🛑 ${asset} 손절(${marketRegime === "MEAN_REVERT" ? "MR" : "TR"}): P&L ${plPct.toFixed(1)}% ≤ ${stopLevel}%`);
        }
        // 이익 실현: +5% 이상이면서 SELL 시그널이면 익절
        if (plPct >= 5 && latestSignal && latestSignal.type === "SELL") {
          shouldTakeProfit = true;
          addLog(`💰 ${asset} 익절: P&L +${plPct.toFixed(1)}% + SELL 시그널`);
        }
        // 장기 보유 손실: 14일 이상 보유 중 마이너스면 청산
        if (pos.updated_at) {
          const holdDays = (Date.now() - new Date(pos.updated_at).getTime()) / (1000 * 86400);
          if (holdDays > 14 && plPct < -1) {
            shouldSellForStopLoss = true;
            addLog(`⏰ ${asset} 장기손실 청산: ${holdDays.toFixed(0)}일 보유, P&L ${plPct.toFixed(1)}%`);
          }
        }
      }

      // ── 가상매매: BUY 실행 ──
      const currentPrice = priceMap[asset];
      if (!currentPrice) {
        addLog(`⚠️ ${asset} 가격 없음 — 스킵`);
        assetResults.push({ asset, ok: false, error: "No price data" });
        continue;
      }

      if (latestSignal.type === "BUY" && !shouldSellForStopLoss && !activeAssets.has(asset)) {
        addLog(`⏭️ ${asset} 매수 스킵 — 비활성 봇 자산`);
      }

      if (latestSignal.type === "BUY" && !shouldSellForStopLoss && activeAssets.has(asset)) {
        // portfolio.cash는 매수 시 즉시 차감되므로 그대로 사용 (이중 차감 방지)
        const availableCash = portfolio.cash;
        // 총 크립토 익스포저 체크 (전체 포지션 가치 / 자산 기준)
        const currentTotalExposure = Object.entries(portfolio.positions).reduce((sum, [a, p]) => {
          const px = priceMap[a];
          return sum + (px && p.qty > 0 ? p.qty * px : 0);
        }, 0);
        const maxTotalExposure = equity * MAX_TOTAL_CRYPTO_EXPOSURE;
        const maxCashPerAsset = equity * MAX_POSITION_PER_ASSET;

        // ── 봇 배분금액 한도 체크 ──
        const assetAllocLimit = assetAllocationMap[asset] || 0;
        const currentExposureForAlloc = pos ? (pos.qty * currentPrice) : 0;
        const remainingAlloc = Math.max(0, assetAllocLimit - currentExposureForAlloc);

        if (assetAllocLimit <= 0) {
          addLog(`⚠️ ${asset} 배분금액 없음 — 매수 스킵`);
        } else if (remainingAlloc <= 10) {
          addLog(`⚠️ ${asset} 배분한도 도달 ($${currentExposureForAlloc.toFixed(0)}/$${assetAllocLimit.toFixed(0)}) — 매수 스킵`);
        } else if (currentTotalExposure < maxTotalExposure) {
          const remainingExposure = maxTotalExposure - currentTotalExposure;
          // 매수금액을 봇 배분한도 기준으로 산출 (전체 equity 아닌 자산별 배분금액의 25%)
          const baseAmount = Math.min(assetAllocLimit * positionSize * 0.25, maxCashPerAsset);
          if (pos) {
            const addAmount = baseAmount;
            if (currentExposure + addAmount <= maxCashPerAsset && addAmount <= availableCash) {
              tradeAmount = Math.min(addAmount, maxCashPerAsset - currentExposure, availableCash, remainingExposure, remainingAlloc);
            }
          } else {
            tradeAmount = Math.min(baseAmount, maxCashPerAsset, availableCash, remainingExposure, remainingAlloc);
          }
        } else {
          addLog(`⚠️ ${asset} 총 크립토 익스포저 한도 도달 (${(currentTotalExposure/equity*100).toFixed(1)}% ≥ ${MAX_TOTAL_CRYPTO_EXPOSURE*100}%) — 매수 스킵`);
        }

        if (tradeAmount > 10) {
          const buyQty = tradeAmount / currentPrice;
          const existing = portfolio.positions[asset];
          if (existing && existing.qty > 0) {
            // 평균단가 재계산 (NaN 방지)
            const totalQty = existing.qty + buyQty;
            const totalCost = (existing.qty * existing.avgPrice) + tradeAmount;
            const newAvgPrice = totalQty > 0 ? totalCost / totalQty : currentPrice;
            portfolio.positions[asset] = { qty: totalQty, avgPrice: isFinite(newAvgPrice) ? newAvgPrice : currentPrice, entryTime: existing.entryTime };
          } else {
            portfolio.positions[asset] = { qty: buyQty, avgPrice: currentPrice, entryTime: new Date().toISOString() };
          }
          portfolio.cash -= tradeAmount;
          portfolio.totalTrades = (portfolio.totalTrades || 0) + 1;
          addLog(`🟢 ${asset} 매수: $${tradeAmount.toFixed(0)} (${buyQty.toFixed(6)}개 @ $${currentPrice.toFixed(2)})`);
          assetResults.push({ asset, ok: true, type: "BUY", signal: latestSignal, amount: tradeAmount, price: currentPrice, qty: buyQty });
        }
      }

      // ── 가상매매: SELL 실행 ──
      // 매도 허용 조건:
      // 1. 활성 봇 자산: SELL 시그널, 손절, 익절 모두 허용
      // 2. 비활성/고아 포지션: 포지션이 있으면 무조건 청산 (봇 삭제 후 남은 포지션 정리)
      const isOrphanPosition = pos && !activeAssets.has(asset);
      if (isOrphanPosition) {
        addLog(`🧹 ${asset} 고아 포지션 감지 — 자동 청산 진행`);
      }
      if (((latestSignal.type === "SELL" || shouldSellForStopLoss || shouldTakeProfit) && pos && activeAssets.has(asset)) || isOrphanPosition) {
        const sellQty = portfolio.positions[asset]?.qty || 0;
        const sellValue = sellQty * currentPrice;
        if (sellValue > 10) {
          const costBasis = sellQty * (portfolio.positions[asset]?.avgPrice || currentPrice);
          const realizedPL = sellValue - costBasis;
          portfolio.cash += sellValue;
          delete portfolio.positions[asset];
          portfolio.totalTrades = (portfolio.totalTrades || 0) + 1;
          addLog(`🔴 ${asset} 매도: $${sellValue.toFixed(0)} (P&L: ${realizedPL >= 0 ? "+" : ""}$${realizedPL.toFixed(2)})`);
          assetResults.push({ asset, ok: true, type: "SELL", signal: latestSignal, amount: sellValue, price: currentPrice, pnl: realizedPL });
        }
      }

      if (!latestSignal || (latestSignal.type === "BUY" && tradeAmount <= 10)) {
        // ★ 2026-05-13 hotfix: skip 인 BUY 시그널도 signalOnly 마커로 기록.
        //   가상 포트폴리오 95% 한도 도달 시 모든 BUY skip → perf.trades 누적 중단 →
        //   실거래 engine 의 pullRecentSignals 시그널 풀 empty → "no recent signals" 영구화.
        //   해결: skip 시에도 type:"BUY" + amount:0 + signalOnly:true 로 기록 → engine 시그널 풀 유지.
        //   가상 포트폴리오 손익 (realizedPL, totalBuyCost) 에는 영향 없음 (amount 0).
        if (latestSignal && latestSignal.type === "BUY") {
          assetResults.push({
            asset, ok: true, type: "BUY", signal: latestSignal,
            amount: 0, price: currentPrice, pnl: null,
            signalOnly: true,  // 봇 perf 누적 시 통계 제외 마커
          });
        } else {
          assetResults.push({ asset, ok: true, action: "skip", signal: latestSignal });
        }
      }
    }

    // ── ★ 시그널 풀 일괄 적재 (감사 #3) — 루프 후 풀당 1회만 쓰기 ──
    //   에셋별 ts 는 루프에서 이미 부여됨(엔진 ts 내림차순 재정렬 → 순서 동일). 신규 엔트리를
    //   앞에 두고 4h cutoff 통과한 기존 엔트리 뒤에 이어 200개 슬라이스. btc-cron 만 write 라
    //   merge 충돌 없음. 실패해도 다음 런(10분)이 재구성 — 기존 풀 유지(부분쓰기 없음).
    try {
      const cutoffMs = Date.now() - 4 * 60 * 60 * 1000;
      const poolKey = "di:signals:realtime-pool";
      const existingPool = (await kv.get(poolKey)) || [];
      const mergedPool = [...newPoolEntries, ...existingPool.filter(e => (e.ts || 0) >= cutoffMs)].slice(0, 200);
      await kv.set(poolKey, mergedPool);
      if (newMtfEntries.length > 0) {
        const mKey = "di:signals:realtime-pool-mtf";
        const mPool = (await kv.get(mKey)) || [];
        const mergedMtf = [...newMtfEntries, ...mPool.filter(e => (e.ts || 0) >= cutoffMs)].slice(0, 200);
        await kv.set(mKey, mergedMtf);
      }
      addLog(`💾 시그널 풀 일괄 적재: 거래 ${newPoolEntries.length}건 / 표시 ${newMtfEntries.length}건 (KV set 2회)`);
    } catch (poolErr) {
      addLog(`⚠️ 시그널 풀 일괄 적재 실패: ${poolErr.message}`);
    }

    // ── 가상 포트폴리오 KV 저장 ──
    await kv.set(PORTFOLIO_KEY, portfolio);
    // 일간 P&L용: 하루 첫 실행 시 prevEquity 저장 (한국 시간 기준 날짜 체크)
    const nowKST = new Date(Date.now() + 9 * 3600000);
    const todayKST = nowKST.toISOString().slice(0, 10);
    const prevEquityDate = await kv.get("di:virtual:crypto-prev-equity-date");
    if (prevEquityDate !== todayKST) {
      await kv.set("di:virtual:crypto-prev-equity", equity);
      await kv.set("di:virtual:crypto-prev-equity-date", todayKST);
      addLog(`📊 일간 기준 equity 갱신: $${equity.toFixed(0)} (${todayKST})`);
    }
    addLog(`💾 포트폴리오 저장: 현금 $${portfolio.cash.toFixed(0)}, 포지션 ${Object.keys(portfolio.positions).length}종목`);

    // ── 봇별 성과 KV 저장 ──
    try {
      // ★ signalOnly 마커 trade 도 포함 — perf.trades 에 누적 후 통계는 별도 처리 (라인 ~699)
      const executedTrades = assetResults.filter(r => r.type === "BUY" || r.type === "SELL");

      if (executedTrades.length > 0) {
        // 각 거래를 봇별로 분류하여 기록
        for (const trade of executedTrades) {
          const bots = getBotsForAsset(trade.asset);
          for (const botId of bots) {
            const key = `di:bot:${botId}:perf`;
            const existing = (await kv.get(key)) || {
              botId, trades: [], realizedPL: 0, totalBuyCost: 0, totalSellRevenue: 0,
              tradeCount: 0, winCount: 0, closedCount: 0, lossCount: 0,
              grossWin: 0, grossLoss: 0, peakValue: 0, mdd: 0, lastUpdated: null,
            };
            // 거래 기록 추가 (최근 200건 유지)
            // ★ 2026-05-11: signal 을 객체로 저장. engine.js pullRecentSignals 가
            //   t.signal.confidence / t.signal.score / t.signal.reason 으로 직접 접근.
            //   기존엔 signal 이 reason 문자열만 들어가서 metadata 가 모두 fallback 60/B/string.
            //   이제 family/timeframe 까지 전달되어 가중치 학습·실거래 라우팅 가능.
            const stratName = trade.signal?.family
              ? `${trade.signal.family}/${trade.signal.timeframe || "1d"}`
              : getStrategyNameForBot(botId);
            existing.trades = [
              {
                time: new Date().toISOString(),
                asset: trade.asset,
                type: trade.type,
                amount: trade.amount,
                price: trade.price,
                pnl: trade.pnl,
                strategy: stratName,
                signalOnly: !!trade.signalOnly,  // signal-only 마커 보존 (UI/통계 분기용)
                signal: {
                  reason: (trade.signal?.reason || "").slice(0, 200),
                  score: trade.signal?.score ?? 60,
                  confidence: trade.signal?.confidence || "B",
                  family: trade.signal?.family || "unknown",
                  timeframe: trade.signal?.timeframe || "1d",
                  botSource: botId,
                },
                // 백워드 호환: 기존 UI/조회 코드가 평면 score/confidence 도 읽음
                score: trade.signal?.score ?? 60,
                confidence: trade.signal?.confidence || "B",
              },
              ...(existing.trades || []),
            ].slice(0, 200);
            // ★ signalOnly 인 trade 는 tradeCount/realizedPL/totalBuyCost 등 통계 제외 — 시그널 풀 전용 기록
            if (trade.signalOnly) {
              // 통계 누적 건너뜀 — 다음 if/else 모두 skip
            } else {
            existing.tradeCount = (existing.tradeCount || 0) + 1;
            if (trade.type === "BUY") {
              existing.totalBuyCost = (existing.totalBuyCost || 0) + (trade.amount || 0);
            } else {
              existing.totalSellRevenue = (existing.totalSellRevenue || 0) + (trade.amount || 0);
              // ★ 2026-05-09: closedCount/lossCount/grossWin/grossLoss 누적 — 정확한 승률·PF 계산용
              //   이전: winRate = winCount / tradeCount  ← 분모 BUY+SELL 라 항상 절반
              //   이후: winRate = winCount / closedCount  ← 분모 SELL 만, 정확
              //   PF = grossWin / grossLoss  ← 승률보다 의미 있는 지표
              if (trade.pnl != null) {
                existing.realizedPL = (existing.realizedPL || 0) + trade.pnl;
                existing.closedCount = (existing.closedCount || 0) + 1;
                if (trade.pnl > 0) {
                  existing.winCount = (existing.winCount || 0) + 1;
                  existing.grossWin = (existing.grossWin || 0) + trade.pnl;
                } else if (trade.pnl < 0) {
                  existing.lossCount = (existing.lossCount || 0) + 1;
                  existing.grossLoss = (existing.grossLoss || 0) + Math.abs(trade.pnl);
                }
              }
            }
            } // ← signalOnly else 블록 닫기
            existing.lastUpdated = new Date().toISOString();
            await kv.set(key, existing);
          }
        }
        const realCount = executedTrades.filter(t => !t.signalOnly).length;
        const sigCount = executedTrades.filter(t => t.signalOnly).length;
        addLog(`📊 봇별 성과 KV 저장: ${executedTrades.length}건 (실거래 ${realCount} + 시그널풀 ${sigCount})`);
      }

      // 봇별 포지션 스냅샷 (활성 봇만 — 비활성 봇은 스냅샷 갱신하지 않음)
      const activeBotsList = (await kv.get("di:active-bots")) || [];
      for (const ab of activeBotsList) {
        const botId = ab.botId;
        const mapped = BOT_ASSET_MAP[botId];
        if (!mapped) continue; // 알 수 없는 봇 ID 스킵
        const assets = mapped === "ALL" ? ASSETS : mapped; // ★ 2026-06-11: 동적 유니버스 봇

        // ── 기존 포지션 백필: 포지션 있는데 거래 기록이 0이면 초기 진입으로 기록 ──
        const botPositionsForBackfill = assets.map(a => positionMap[a]).filter(Boolean);
        if (botPositionsForBackfill.length > 0) {
          const perfKeyBf = `di:bot:${botId}:perf`;
          const perfBf = (await kv.get(perfKeyBf)) || { botId, trades: [], tradeCount: 0, realizedPL: 0, totalBuyCost: 0, totalSellRevenue: 0, winCount: 0 };
          if ((perfBf.tradeCount || 0) === 0 && (!perfBf.trades || perfBf.trades.length === 0)) {
            // 기존 포지션을 초기 진입 기록으로 백필
            const backfillTrades = botPositionsForBackfill.map(p => ({
              time: p.updated_at || new Date().toISOString(),
              asset: p.symbol,
              type: "BUY",
              amount: parseFloat(p.market_value || 0),
              price: parseFloat(p.avg_entry_price || p.current_price || 0),
              signal: "기존 포지션 연동",
              score: null,
              confidence: null,
            }));
            perfBf.trades = backfillTrades;
            perfBf.tradeCount = backfillTrades.length;
            perfBf.totalBuyCost = backfillTrades.reduce((s, t) => s + (t.amount || 0), 0);
            perfBf.lastUpdated = new Date().toISOString();
            await kv.set(perfKeyBf, perfBf);
            addLog(`🔄 ${botId}: 기존 포지션 ${backfillTrades.length}건 거래 기록 백필`);
          }
        }

        const botPositions = assets
          .map(a => positionMap[a])
          .filter(Boolean);
        const botUnrealizedPL = botPositions.reduce((s, p) => s + parseFloat(p.unrealized_pl || 0), 0);
        const botMarketValue = botPositions.reduce((s, p) => s + parseFloat(p.market_value || 0), 0);

        const botAllocation = ab.allocation || 0;

        // 봇 에쿼티 = 배분금액 + 미실현 손익 + 실현 손익
        const perfKey = `di:bot:${botId}:perf`;
        const perfData = (await kv.get(perfKey)) || {};
        const realizedPL = perfData.realizedPL || 0;
        const botEquity = botAllocation > 0
          ? botAllocation + botUnrealizedPL + realizedPL
          : botMarketValue;

        // botEquity가 0 이하이면 DD 계산 스킵 (아직 매매 전이거나 데이터 이상)
        if (botEquity <= 0) continue;

        const snapKey = `di:bot:${botId}:snapshot`;
        const prevSnap = (await kv.get(snapKey)) || { peakEquity: botEquity, mdd: 0, history: [] };
        // 에쿼티 합리 범위 (배분금액 대비) — peak/history 방어용으로 먼저 산출
        // ⚠️ TDZ 버그 fix: maxEq/minEq 를 사용 시점보다 먼저 선언
        const maxEq = botAllocation * 3;
        const minEq = botAllocation * 0.1;
        // 에쿼티 기준 peak/DD/MDD (배분금액 대비)
        // peakEquity도 합리적 범위 내에서만 사용 (손상 데이터 방어)
        const prevPeak = prevSnap.peakEquity || prevSnap.peakValue || botEquity;
        const safePrevPeak = (prevPeak > 0 && prevPeak <= maxEq) ? prevPeak : botEquity;
        const peakEquity = Math.max(safePrevPeak, botEquity);
        const dd = peakEquity > 0 ? ((peakEquity - botEquity) / peakEquity) * 100 : 0;
        // MDD도 비정상(99% 이상)이면 리셋
        const prevMDD = (prevSnap.mdd || 0) >= 90 ? 0 : (prevSnap.mdd || 0);
        const mdd = Math.max(prevMDD, dd);
        // 에쿼티 히스토리 (최근 500개 — 15분 간격이면 ~5일)
        // 구버전에서 전체 포트폴리오 에쿼티가 저장된 손상 항목 자동 정리
        const cleanedPrevHistory = (prevSnap.history || []).filter(h => {
          const eq = h.equity;
          return eq != null && eq > 0 && eq >= minEq && eq <= maxEq;
        });
        const history = [
          ...cleanedPrevHistory,
          { time: new Date().toISOString(), equity: botEquity, value: botMarketValue, unrealizedPL: botUnrealizedPL, positions: botPositions.length },
        ].slice(-500);
        // 개별 포지션 상세 (자산 배분 차트용)
        const positionDetails = botPositions.map(p => ({
          asset: p.symbol || p.asset || "",
          qty: p.qty || 0,
          avgPrice: p.avg_entry_price || p.avgPrice || 0,
          marketValue: parseFloat(p.market_value || 0),
          unrealizedPL: parseFloat(p.unrealized_pl || 0),
        }));
        await kv.set(snapKey, {
          botId, marketValue: botMarketValue, unrealizedPL: botUnrealizedPL,
          positionCount: botPositions.length, peakEquity, dd, mdd,
          botAllocation, botEquity, realizedPL,
          positionDetails,
          history, lastUpdated: new Date().toISOString(),
        });
      }
      addLog(`📸 봇별 포지션 스냅샷 저장 완료`);
    } catch (e) {
      addLog(`⚠️ 봇별 성과 KV 저장 실패: ${e.message}`);
    }

    // ── 텔레그램 알림 (카드형, 사용자 친화) ──
    // ★ virtual 채널 — 환경변수 ZEPTA_TG_VIRTUAL_ENABLED=1 일 때만 발송
    //   사용자 요청(2026-05-03): 가상매매 리포트는 끄고 실거래 위주로
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    const cards = buildTelegramCards(assetResults, positionMap, equity, cash, duration, fngData);
    const tg = await sendCards(cards, { channel: "virtual" });
    addLog(`📨 텔레그램 ${tg?.skipped ? "스킵 (virtual muted)" : `전송 완료 (${duration}s)`}`);

    return res.status(200).json({
      ok: true,
      results: assetResults,
      portfolio: { equity: equity.toFixed(0), cash: portfolio.cash.toFixed(0), positions: Object.keys(portfolio.positions).length, totalTrades: portfolio.totalTrades },
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
// 사용자 친화 카드형 메시지 빌더 — buildCard 사용으로 자동 humanize 적용
function buildTelegramCards(assetResults, positionMap, equity, cash, duration, fngData) {
  const cards = [];

  // 카드 1) 시장 분위기 + 봇 상태 헤더
  const fngLines = [];
  if (fngData) {
    const v = fngData.value;
    const mood =
      v <= 25 ? `극도 공포 (${v}/100) — 단기 급락 후 매수 기회 탐색 구간이에요` :
      v <= 45 ? `공포 (${v}/100) — 선별적 매수 가능, 분할 진입 권장` :
      v <= 55 ? `중립 (${v}/100) — 명확한 시그널 나올 때까지 기다리는 구간` :
      v <= 75 ? `탐욕 (${v}/100) — 신중하게, 추격매수는 자제` :
                `극도 탐욕 (${v}/100) — 이익 확보 우선, 신규 진입 주의`;
    fngLines.push(`시장 심리: ${mood}`);
  }
  cards.push(buildCard({
    tag: "🤖",
    title: "Zepta 크립토 자동매매 리포트",
    lines: fngLines.length ? fngLines : ["봇이 정상 가동 중이에요"],
    footer: `${fmtKSTShort()} · 15분 간격 · ${duration}s`,
  }));

  // 카드 2) 시그널 — 액션 있는 종목만
  const acted = assetResults.filter((r) => r.signal);
  if (acted.length > 0) {
    const lines = acted.map((r) => {
      const dir = r.signal.type === "BUY" ? "매수" : "매도";
      const grade = r.signal.confidence === "A" ? "강" : r.signal.confidence === "B" ? "중" : "약";
      const exec =
        r.type === "BUY" ? " → 가상 체결됨" :
        r.type === "SELL" ? " → 가상 정리됨" : "";
      const amt = r.amount ? ` ($${Number(r.amount).toFixed(0)})` : "";
      return `${r.asset} ${dir} 신호 (강도 ${grade})${exec}${amt} — ${r.signal.reason}`;
    });
    cards.push(buildCard({
      tag: "🔍",
      title: `오늘의 매매 신호 ${acted.length}건`,
      lines,
    }));
  }

  // 카드 3) 포트폴리오 스냅샷
  const cashPct = equity > 0 ? ((cash / equity) * 100) : 0;
  const portLines = [
    `계좌 자산 $${equity.toFixed(0)}, 현금 비중 ${cashPct.toFixed(0)}%`,
  ];
  let totalValue = 0, totalPnL = 0;
  for (const asset of Object.keys(positionMap)) { // ★ 2026-06-11: 동적 유니버스 — 보유 포지션 기준 순회
    const pos = positionMap[asset];
    if (!pos) continue;
    const mv = parseFloat(pos.market_value || 0);
    const pl = parseFloat(pos.unrealized_pl || 0);
    const cost = parseFloat(pos.cost_basis || 0);
    const plPct = cost > 0 ? ((pl / cost) * 100) : 0;
    totalValue += mv; totalPnL += pl;
    const sign = pl >= 0 ? "+" : "";
    portLines.push(`${asset}: $${mv.toFixed(0)} (${sign}${plPct.toFixed(1)}%)`);
  }
  if (totalValue > 0) {
    const exposure = equity > 0 ? ((totalValue / equity) * 100) : 0;
    portLines.push(`크립토 노출 ${exposure.toFixed(0)}% / 최대 ${(MAX_TOTAL_CRYPTO_EXPOSURE * 100).toFixed(0)}%, 미실현 손익 ${totalPnL >= 0 ? "+" : ""}$${totalPnL.toFixed(0)}`);
  }
  cards.push(buildCard({
    tag: "💰",
    title: "포트폴리오 현황",
    lines: portLines,
  }));

  return cards;
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
// 봇별 Strategy Dispatcher 헬퍼 (2026-05-11 추가)
// ────────────────────────────────────────────────────────
// computeBotSignals: 이 자산을 다루는 모든 활성 봇 각각에 대해 그 봇의
//                    전용 strategy 함수를 실행. 결과: [{botId, signal}, ...]
// pickTopBotSignal:  여러 봇 시그널 중 최고 점수 1개를 단일 시그널로 채택.
//                    (분배는 호출 측에서 다시 봇별로 처리)
// ════════════════════════════════════════════════════════
function computeBotSignals({ asset, closes, highs, lows, volumes, timeframe, paramsByStrategy = {} }) {
  const out = [];
  const botIds = getBotsForAsset(asset); // 이 자산을 다루는 봇 ID 목록
  for (const botId of botIds) {
    try {
      // ★ 2026-05-29 — 이 봇 strategy 에 발굴·튜닝된 파라미터가 있으면 주입.
      const stratName = getStrategyNameForBot(botId);
      const params = paramsByStrategy[stratName] || null;
      const sig = runStrategyForBot(botId, { closes, highs, lows, volumes, asset, timeframe, params });
      if (sig) out.push({ botId, signal: sig });
    } catch (e) {
      // 한 봇 strategy 실패가 다른 봇에 영향 안 주도록 격리
      console.warn(`[strategy] ${botId} failed for ${asset}:`, e?.message);
    }
  }
  return out;
}

// ★ 2026-06-14 (대표 제보): TF별 전략이 HOLD(무신호)면 그 타임프레임이 카드에서 빈칸(—)으로
//   떴음(BTC/ETH/SOL 4h 등 19/49종). 전략이 비면 지표 기반 약한 추세읽기로 폴백 — 모든 TF가
//   값을 갖게. 점수는 보수적(53~65, 등급 C)이라 전략 신호를 지배하지 않음. 진짜 중립(방향 0)이면
//   폴백도 null(정직). analyzeLatest 폴백과 동일 철학.
function tfFallbackSignal(closes, highs, lows, tf) {
  if (!Array.isArray(closes) || closes.length < 30) return null;
  const ema21 = calcEMA(closes, 21);
  const ema55 = calcEMA(closes, 55);
  const rsiArr = calcRSI(closes, 14);
  const L = closes.length - 1;
  const e21 = ema21[L], e55 = ema55[L], rsi = rsiArr[L], px = closes[L];
  if (e21 == null || e55 == null || rsi == null || !(px > 0)) return null;
  let dir = 0;
  if (e21 > e55) dir += 1; else if (e21 < e55) dir -= 1;       // 추세
  if (px > e21) dir += 1; else if (px < e21) dir -= 1;          // 위치
  if (rsi > 55) dir += 1; else if (rsi < 45) dir -= 1;          // 모멘텀 바이어스
  if (dir === 0) return null; // 진짜 방향 없음 → 폴백 안 함(정직)
  const side = dir > 0 ? "LONG" : "SHORT";
  const score = 50 + Math.abs(dir) * 5; // 55/60/65 — 전략 신호보다 보수적
  return {
    type: side === "LONG" ? "BUY" : "SELL", side, score,
    confidence: "C", family: "tf-trend", timeframe: tf,
    reason: `${tf} 추세읽기(EMA·RSI)`, fallback: true,
  };
}

function pickTopBotSignal(botSignals) {
  if (!Array.isArray(botSignals) || botSignals.length === 0) return null;
  // score 우선, 동점이면 confidence 등급
  const confRank = { A: 3, B: 2, C: 1 };
  const sorted = botSignals.slice().sort((a, b) => {
    const sA = a.signal.score || 0;
    const sB = b.signal.score || 0;
    if (sA !== sB) return sB - sA;
    return (confRank[b.signal.confidence] || 0) - (confRank[a.signal.confidence] || 0);
  });
  // type 필드를 btc-cron 호환으로 보장 (BUY/SELL)
  const top = sorted[0].signal;
  if (!top.type) top.type = top.side === "LONG" ? "BUY" : (top.side === "SHORT" ? "SELL" : "BUY");
  return top;
}

// ════════════════════════════════════════════════════════
// 선물 컨텍스트 그래디언트 보정 (펀딩·OI·베이시스) — 대표 지시 2026-06-03
//   극단-only(이전) → 임계값↓ + 그래디언트 + bounded 로 '더 자주·점진적' 알파 기여.
//   ★ 방향은 검증된 것만: 펀딩과밀=감점 / OI증가=확인 가점 / OI감소=소진 감점 / 베이시스극단=감점.
//   투기적 새 방향 베팅 없음. 전체 보정폭 ±는 0.65~1.15 로 bounded(신호 방향 절대 불변).
//   sig 를 in-place 보정. 적용된 요인명 배열 반환(로깅용).
// ════════════════════════════════════════════════════════
function applyFuturesContext(sig, { fr, oiCh, bs }) {
  if (!sig || !sig.side) return null;
  const side = sig.side;
  let mult = 1.0;
  const notes = [];
  // (b) 펀딩 과밀(신호 방향으로 군중 쏠림 → 스퀴즈 위험) — 임계 0.01%, 그래디언트 최대 -15%
  if (Number.isFinite(fr)) {
    const crowd = side === "SHORT" ? -fr : fr; // >0 = 신호방향 과밀
    if (crowd > 0.0001) { mult *= 1 - Math.min(0.15, crowd * 250); notes.push("펀딩과밀"); }
  }
  // (c) OI 증가 = 추세 확인(가점), 감소 = 소진(감점) — 임계 1%, 그래디언트
  if (Number.isFinite(oiCh)) {
    if (oiCh > 0.01) { mult *= 1 + Math.min(0.10, (oiCh - 0.01) * 2.5 + 0.02); notes.push("OI확인"); }
    else if (oiCh < -0.01) { mult *= 1 - Math.min(0.12, (-oiCh - 0.01) * 2.5 + 0.02); notes.push("OI발산"); }
  }
  // (d) 베이시스 극단(마크-인덱스 괴리가 신호 방향) — 임계 0.04%, 그래디언트 최대 -8%
  if (Number.isFinite(bs)) {
    const ext = side === "SHORT" ? -bs : bs;
    if (ext > 0.0004) { mult *= 1 - Math.min(0.08, ext * 50); notes.push("베이시스극단"); }
  }
  mult = Math.max(0.65, Math.min(1.15, mult)); // bounded — 방향 불변
  sig.score = Math.max(40, Math.min(98, Math.round((sig.score || 60) * mult)));
  if (notes.length) sig.reason = ((sig.reason || "") + " +" + notes.join("·")).slice(0, 200);
  sig.confidence = sig.score >= 80 ? "A" : sig.score >= 60 ? "B" : "C";
  return notes;
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

    // ── RSI 모멘텀 (MACD/EMA 확인 필수) ──
    // RSI > 70 단독은 위험 → MACD+EMA 동시 확인 시에만 강세 신호
    if (rsi[L] > 70 && macdLine[L] > macdSig[L] && ema21[L] > ema55[L]) { buyScore += 2; reasons.push(`RSI${rsi[L].toFixed(0)} 강세(확인됨)`); }
    else if (rsi[L] > 55 && macdLine[L] > macdSig[L]) { buyScore += 1; reasons.push(`RSI${rsi[L].toFixed(0)} 상승`); }
    else if (rsi[L] < 30 && macdLine[L] < macdSig[L]) { sellScore += 2; reasons.push(`RSI${rsi[L].toFixed(0)} 약세(확인됨)`); }
    else if (rsi[L] < 45 && macdLine[L] < macdSig[L]) { sellScore += 1; reasons.push(`RSI${rsi[L].toFixed(0)} 하락`); }

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
    // ── RSI 역추세 (BB 확인 강화) ──
    const bbLower = bb[L] ? bb[L].lower : null;
    const rsiOversold = rsi[L] < 30;
    const bbTouched = bbLower && price <= bbLower * 1.02;
    const priceBouncing = price > closes[L - 2];
    if (rsiOversold && (bbTouched || priceBouncing)) { buyScore += 3; reasons.push(`RSI${rsi[L].toFixed(0)} 과매도(BB확인)`); }
    else if (rsi[L] < 40 && rsi[L] > rsi[L - 1] && priceBouncing) { buyScore += 2; reasons.push(`RSI${rsi[L].toFixed(0)} 반등`); }
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
  const erAcceleration = curER - prevER;
  if (erAcceleration > 0.15) {
    // 추세 가속: ER 급등 (임계값 완화 0.2→0.15)
    if (price > closes[L - 5]) { buyScore += 2; reasons.push(`ER가속${curER.toFixed(2)}↑`); }
    else { sellScore += 2; reasons.push(`ER가속${curER.toFixed(2)}↓`); }
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
// (구버전 sendTelegram 제거 — _shared/telegram.js sendCards 로 대체됨)
// 아래 함수는 호환성을 위해 남겨두지만 호출되지 않습니다.
// ════════════════════════════════════════════════════════
async function _legacySendTelegram(token, chatId, text) {
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
  // 강세 다이버전스: 가격은 더 낮은 저점, RSI는 더 높은 저점
  if (i < lookback + 2) return false;
  // 최근 lookback 내 가장 낮은 2개 저점 찾기
  let low1 = { price: Infinity, idx: i }, low2 = { price: Infinity, idx: i };
  for (let j = 2; j <= lookback; j++) {
    const p = closes[i - j];
    if (p < low1.price) { low2 = { ...low1 }; low1 = { price: p, idx: i - j }; }
    else if (p < low2.price) { low2 = { price: p, idx: i - j }; }
  }
  // 현재 가격이 이전 저점보다 낮거나 같은데, RSI는 더 높은 경우 = 강세 다이버전스
  if (closes[i] <= low1.price * 1.01 && rsi[i] != null && rsi[low1.idx] != null) {
    return rsi[i] > rsi[low1.idx] + 5; // RSI 5pt 이상 차이 필요
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
