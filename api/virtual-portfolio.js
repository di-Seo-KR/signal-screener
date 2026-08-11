// Virtual Portfolio API — KV 가상 포트폴리오 데이터 조회
// 크립토 + 주식 가상 포트폴리오를 프론트엔드에 제공
//
// ★ 2026-08 감사 수정(finding #29): 기존 CoinGecko 16종 하드코딩 맵은 동적 유니버스(유동성
//   상위 50종) 보유 종목 대부분을 커버하지 못해, 매핑에 없는 코인이 '매수가=현재가' 로
//   조용히 폴백 → 손익 +0.00% 허위 표시가 발생했습니다. btc-cron.js 와 동일한
//   프록시 경유 바이낸스 선물 전 심볼 티커 1콜로 시가평가하도록 교체하고,
//   그래도 시세를 못 구한 종목은 priceStale 마커 + 손익 null 로 정직하게 표기합니다.
//   (currentPrice 를 null 로 내리면 프론트가 $0 렌더 + equity 과소 표시되므로,
//   currentPrice 는 원가를 유지하되 마커로 구분 — 응답 스키마는 필드 추가만, 기존 소비처 호환)

import { getTickerPrice } from "./_shared/binance-client.js";
import { UNIVERSE_KV_KEY, universeSymbolMap } from "./_shared/futures-universe.js";

// asset → 바이낸스 선물(USDⓈ-M) 심볼 정적 폴백 맵 — btc-cron.js FUTURES_SYMBOLS 와 동일.
//   저가 밈코인은 1000배 묶음(1000SHIB/1000PEPE), MATIC 은 POL 로 상장 → 명시 룩업 필수.
//   (공유 모듈 추출은 btc-cron.js 동시 수정이 필요해 이번 감사 배치 범위 밖 — 정적 맵 동기화 유지)
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

// 동적 유니버스 맵(BASE→SYMBOL) 우선, 정적 FUTURES_SYMBOLS 폴백 — btc-cron.js 와 동일 규칙.
function assetToBinanceSymbol(asset, dynMap) {
  const base = String(asset || "").split("/")[0];
  if (dynMap && dynMap[base]) return dynMap[base];
  return FUTURES_SYMBOLS[asset] || "";
}

export default async function handler(req, res) {
  try {
    const kvModule = await import("@vercel/kv");
    const kv = kvModule.kv;

    const type = req.query.type || "all"; // "crypto", "stock", "all"

    const result = {};

    if (type === "crypto" || type === "all") {
      const cryptoPortfolio = await kv.get("di:virtual:portfolio");
      if (cryptoPortfolio) {
        const heldAssets = Object.keys(cryptoPortfolio.positions || {});

        // ── 현재 가격 조회 — 자산별 시세 소스 추적 ──
        const prices = {}; // { asset: 가격 }
        const priceSourceMap = {}; // { asset: "binance-futures" | "coingecko" }

        if (heldAssets.length > 0) {
          // 동적 유니버스 심볼 맵 로드 — btc-cron 이 6시간 주기로 갱신하는 KV 캐시를
          // kv.get 으로 직접 읽기만 합니다.
          // ★ 2026-08 감사 배치3: loadUniverse(maxAgeMs: Infinity) 는 캐시 부재(키 유실·초기화)
          //   콜드 케이스에 내부 refreshUniverse 가 실행돼 사용자향 GET 경로에서 프록시 경유
          //   거래소 2콜 + kv.set(최대 수 초 지연)이 발생할 수 있어, 조회 경로에서는 refresh 를
          //   원천 차단 — 캐시 없으면 즉시 정적 FUTURES_SYMBOLS 폴백으로 동작합니다.
          let dynMap = null;
          try {
            const universe = await kv.get(UNIVERSE_KV_KEY);
            if (Array.isArray(universe?.entries) && universe.entries.length) {
              dynMap = universeSymbolMap(universe);
            }
          } catch { /* 유니버스 캐시 미가용 — 정적 맵으로만 매핑 */ }

          // 1차: 바이낸스 선물 전 심볼 티커 1콜 (프록시 자동 경유 — Vercel IP 차단 무관)
          try {
            const tickers = await getTickerPrice({});
            const bySym = {};
            for (const t of (Array.isArray(tickers) ? tickers : [])) {
              if (t?.symbol) bySym[t.symbol] = parseFloat(t.price);
            }
            for (const asset of heldAssets) {
              const sym = assetToBinanceSymbol(asset, dynMap);
              if (!sym) continue;
              let p = bySym[sym];
              if (!Number.isFinite(p) || p <= 0) continue;
              // 레거시 자산(SHIB/USD 등)이 1000-단위 선물(1000SHIBUSDT)에 매핑되면
              // 가상 포트폴리오 가격 스케일(현물 기준)에 맞춰 환산. 1000-단위 자산은 그대로.
              if (sym.startsWith("1000") && !String(asset).startsWith("1000")) p = p / 1000;
              prices[asset] = p;
              priceSourceMap[asset] = "binance-futures";
            }
          } catch { /* 바이낸스 실패 — CoinGecko 폴백 시도 */ }

          // 2차: CoinGecko 폴백 — 바이낸스에서 시세를 못 구한 메이저 종목만 보충
          const missing = heldAssets.filter((a) => !(a in prices));
          if (missing.length > 0) {
            const cgIds = {
              "BTC/USD": "bitcoin", "ETH/USD": "ethereum", "SOL/USD": "solana",
              "XRP/USD": "ripple", "ADA/USD": "cardano", "AVAX/USD": "avalanche-2",
              "LINK/USD": "chainlink", "UNI/USD": "uniswap", "AAVE/USD": "aave",
              "DOT/USD": "polkadot", "DOGE/USD": "dogecoin", "SHIB/USD": "shiba-inu",
              "PEPE/USD": "pepe", "ARB/USD": "arbitrum", "OP/USD": "optimism",
              "MATIC/USD": "matic-network",
            };
            const targets = missing.filter((a) => cgIds[a]);
            if (targets.length > 0) {
              try {
                const ids = targets.map((a) => cgIds[a]).join(",");
                const cgRes = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`, { signal: AbortSignal.timeout(8000) });
                if (cgRes.ok) {
                  const cgData = await cgRes.json();
                  for (const asset of targets) {
                    const usd = cgData[cgIds[asset]]?.usd;
                    if (Number.isFinite(usd) && usd > 0) {
                      prices[asset] = usd;
                      priceSourceMap[asset] = "coingecko";
                    }
                  }
                }
              } catch { /* CoinGecko 도 실패 — 해당 종목은 priceStale 로 정직 표기 */ }
            }
          }
        }

        // ── 포지션 시가평가 ──
        let totalMarketValue = 0;
        let stalePriceCount = 0; // 시세 미확보 종목 수
        let stalePriceValue = 0; // 시세 미확보 종목의 원가 반영 평가액 합
        const positions = [];
        for (const [asset, pos] of Object.entries(cryptoPortfolio.positions || {})) {
          const livePrice = prices[asset];
          const priceStale = !Number.isFinite(livePrice) || livePrice <= 0;
          // 시세 미확보 시 currentPrice 는 원가(avgPrice)를 유지 — null 로 내리면
          // 프론트(BTCTrading)가 $0 으로 렌더하고 equity 가 과소 표시됩니다.
          // 대신 priceStale 마커를 세우고 손익만 null 로 두어 '+0.00%' 허위 표시를 막습니다.
          const currentPrice = priceStale ? pos.avgPrice : livePrice;
          const mv = pos.qty * currentPrice;
          const costBasis = pos.qty * pos.avgPrice;
          totalMarketValue += mv;
          if (priceStale) { stalePriceCount += 1; stalePriceValue += mv; }
          positions.push({
            symbol: asset,
            qty: pos.qty,
            avgPrice: pos.avgPrice,
            currentPrice,
            marketValue: mv,
            costBasis,
            unrealizedPL: priceStale ? null : mv - costBasis,
            unrealizedPLPct: priceStale ? null : (costBasis > 0 ? ((mv - costBasis) / costBasis * 100) : 0),
            priceStale,
            priceSource: priceStale ? "cost-basis" : priceSourceMap[asset],
            entryTime: pos.entryTime,
          });
        }

        const equity = cryptoPortfolio.cash + totalMarketValue;
        const initialCash = cryptoPortfolio.initialCash || 100000;
        const totalPL = equity - initialCash;
        const totalPLPct = initialCash > 0 ? ((equity - initialCash) / initialCash * 100) : 0;

        // 이전 equity (일간 P&L용)
        const prevEquity = (await kv.get("di:virtual:crypto-prev-equity")) || equity;

        result.crypto = {
          cash: cryptoPortfolio.cash,
          equity,
          initialCash,
          totalMarketValue,
          totalPL,
          totalPLPct,
          dayPL: equity - prevEquity,
          dayPLPct: prevEquity > 0 ? ((equity - prevEquity) / prevEquity * 100) : 0,
          positions,
          // 합계 신뢰도 마커 — n종이 시세 미확보(원가 반영)임을 프론트가 표시할 수 있도록 노출
          stalePriceCount,
          stalePriceValue,
          totalTrades: cryptoPortfolio.totalTrades || 0,
          createdAt: cryptoPortfolio.createdAt,
        };
      }
    }

    if (type === "stock" || type === "all") {
      const stockPortfolio = await kv.get("di:virtual:stock-portfolio");
      if (stockPortfolio) {
        // Yahoo Finance에서 현재 가격 조회
        let currentPrices = {};
        const symbols = Object.keys(stockPortfolio.positions || {});
        if (symbols.length > 0) {
          try {
            const promises = symbols.map(async (sym) => {
              const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&range=1d`);
              const d = await r.json();
              const meta = d?.chart?.result?.[0]?.meta;
              if (meta?.regularMarketPrice) currentPrices[sym] = meta.regularMarketPrice;
            });
            await Promise.allSettled(promises);
          } catch {}
        }

        let totalMarketValue = 0;
        let stalePriceCount = 0;
        let stalePriceValue = 0;
        const positions = [];
        for (const [symbol, pos] of Object.entries(stockPortfolio.positions || {})) {
          const livePrice = currentPrices[symbol];
          const priceStale = !Number.isFinite(livePrice) || livePrice <= 0;
          // 크립토와 동일 원칙 — 시세 미확보 시 원가 유지 + priceStale 마커 + 손익 null
          const currentPrice = priceStale ? pos.avgPrice : livePrice;
          const mv = pos.qty * currentPrice;
          const costBasis = pos.qty * pos.avgPrice;
          totalMarketValue += mv;
          if (priceStale) { stalePriceCount += 1; stalePriceValue += mv; }
          positions.push({
            symbol,
            qty: pos.qty,
            avgPrice: pos.avgPrice,
            currentPrice,
            marketValue: mv,
            costBasis,
            unrealizedPL: priceStale ? null : mv - costBasis,
            unrealizedPLPct: priceStale ? null : (costBasis > 0 ? ((mv - costBasis) / costBasis * 100) : 0),
            priceStale,
            priceSource: priceStale ? "cost-basis" : "yahoo",
            entryTime: pos.entryTime,
          });
        }

        const equity = stockPortfolio.cash + totalMarketValue;
        const initialCash = stockPortfolio.initialCash || 100000;
        const totalPL = equity - initialCash;
        const totalPLPct = initialCash > 0 ? ((equity - initialCash) / initialCash * 100) : 0;

        const prevEquity = (await kv.get("di:virtual:stock-prev-equity")) || equity;

        result.stock = {
          cash: stockPortfolio.cash,
          equity,
          initialCash,
          totalMarketValue,
          totalPL,
          totalPLPct,
          dayPL: equity - prevEquity,
          dayPLPct: prevEquity > 0 ? ((equity - prevEquity) / prevEquity * 100) : 0,
          positions,
          stalePriceCount,
          stalePriceValue,
          totalTrades: stockPortfolio.totalTrades || 0,
          createdAt: stockPortfolio.createdAt,
        };
      }
    }

    return res.status(200).json({ ok: true, ...result });
  } catch (error) {
    console.error("Virtual portfolio API error:", error);
    return res.status(500).json({ ok: false, error: error.message });
  }
}
