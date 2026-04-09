// api/_shared/signal-extractor.js
//
// 가상매매(btc-cron 등)에서 생성된 "시그널" 객체를 실전매매 엔진에서
// 쓸 수 있는 정규화된(canonical) 시그널 형태로 변환한다.
//
// 가상매매가 내보내는 원본 시그널 형태 (btc-cron.js 기준):
// {
//   type: "BUY" | "SELL",
//   confidence: "A" | "B" | "C",
//   score: number,      // 점수 (0~100)
//   factors: number,    // 기여한 factor 개수
//   reason: string,     // 사람이 읽는 설명 ("[4h] RSI 과매도 + ...")
//   positionSize: number // 0~1 사이. 이미 타임프레임 축소가 반영됨
// }
//
// 실전매매 엔진이 기대하는 canonical 시그널:
// {
//   id: string,              // 고유 id (멱등)
//   source: string,          // "btc-cron" | "stock-cron" | "quant-research" | "bot:<id>"
//   asset: string,           // "BTC" | "ETH" | ...
//   symbol: string,          // "BTCUSDT" | "ETHUSDT" | "SOLUSDT" (바이낸스 심볼)
//   side: "LONG" | "SHORT" | "CLOSE",
//   confidence: number,      // 0~1 (A=0.9, B=0.7, C=0.5 등)
//   score: number,           // 원본 점수
//   reason: string,
//   timeframe: string,       // "1d" | "4h" | "1h"
//   sizeHint: number,        // 0~1 (원본 positionSize)
//   generatedAt: string,     // ISO
//   strategyFamily: "trend"|"mean-revert"|"breakout"|"unknown",
// }
//
// 이 파일은 "매매 결정"을 하지 않는다 — 오직 포맷 변환만 담당.

const CONFIDENCE_MAP = { A: 0.9, B: 0.7, C: 0.5, D: 0.3 };

// 가상매매에서 쓰는 자산 이름 → 바이낸스 Futures 심볼 매핑.
// Phase 1 에서는 minNotional 제약 때문에 BTC 는 제외하고 ETH/SOL 을 우선 사용한다.
export const ASSET_TO_SYMBOL = {
  BTC: "BTCUSDT",
  ETH: "ETHUSDT",
  SOL: "SOLUSDT",
  BNB: "BNBUSDT",
  XRP: "XRPUSDT",
  DOGE: "DOGEUSDT",
  ADA: "ADAUSDT",
  AVAX: "AVAXUSDT",
  LINK: "LINKUSDT",
  MATIC: "MATICUSDT",
  DOT: "DOTUSDT",
};

// Phase 1 허용 심볼 (자본 $100 기준으로 minNotional 이 부담 없는 것만)
// BTCUSDT 는 $100 minNotional 이라 자본 전체가 한 포지션에 들어가 제외.
export const PHASE1_ALLOWED_SYMBOLS = new Set([
  "ETHUSDT",
  "SOLUSDT",
  "BNBUSDT",
  "XRPUSDT",
  "DOGEUSDT",
  "ADAUSDT",
  "AVAXUSDT",
  "LINKUSDT",
  "MATICUSDT",
]);

// 전략명(reason 안에 들어있거나, 별도 strategy 필드로 올 경우) 을 family 로 분류.
// 리스크 매니저가 ATR 배수를 고를 때 쓴다.
const TREND_KEYWORDS = ["ema", "trend", "supertrend", "ichimoku", "donchian", "macd cross", "adx"];
const MEAN_REVERT_KEYWORDS = ["rsi", "reversion", "bb bounce", "stoch", "zscore", "mean reversion"];
const BREAKOUT_KEYWORDS = ["breakout", "range break", "vol spike", "bollinger break", "20d high"];

export function classifyStrategyFamily(reason, stratName) {
  const text = `${reason || ""} ${stratName || ""}`.toLowerCase();
  if (BREAKOUT_KEYWORDS.some((k) => text.includes(k))) return "breakout";
  if (MEAN_REVERT_KEYWORDS.some((k) => text.includes(k))) return "mean-revert";
  if (TREND_KEYWORDS.some((k) => text.includes(k))) return "trend";
  return "unknown";
}

function parseTimeframe(reason) {
  if (!reason) return "1d";
  if (reason.startsWith("[4h]")) return "4h";
  if (reason.startsWith("[1h]")) return "1h";
  return "1d";
}

function hash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

/**
 * 가상매매 raw 시그널 → canonical 시그널.
 * 매핑 불가(BTC 제외, 미지원 자산) 시 null 리턴.
 *
 * @param {object} raw
 * @param {string} raw.asset  e.g. "ETH"
 * @param {object} raw.signal e.g. { type, confidence, score, reason, positionSize }
 * @param {string} raw.source e.g. "btc-cron"
 * @param {string} [raw.stratName]
 * @param {object} [opts]
 * @param {boolean} [opts.strict] Phase1 allowed symbol 만 허용
 * @returns {null | object} canonical signal
 */
/**
 * 봇이 저장하는 다양한 asset 포맷을 짧은 티커(BTC, ETH, ...)로 정규화.
 * 지원 포맷:
 *   "BTC"        → "BTC"
 *   "BTC/USD"    → "BTC"   (btc-cron.js CRYPTO_ASSETS 포맷)
 *   "BTC/USDT"   → "BTC"
 *   "BTCUSDT"    → "BTC"   (바이낸스 full symbol)
 *   "BTC-USD"    → "BTC"
 *   "btc"        → "BTC"
 */
export function normalizeAssetKey(asset) {
  if (!asset) return null;
  let a = String(asset).toUpperCase().trim();
  // slash / dash quote 구분자 제거 (BTC/USD, BTC-USD)
  if (a.includes("/")) a = a.split("/")[0];
  if (a.includes("-")) a = a.split("-")[0];
  // 이미 짧은 티커면 바로 리턴
  if (ASSET_TO_SYMBOL[a]) return a;
  // full symbol (BTCUSDT, ETHUSDT) 인 경우 USDT/USD 접미어 제거
  if (a.endsWith("USDT")) {
    const s = a.slice(0, -4);
    if (ASSET_TO_SYMBOL[s]) return s;
  }
  if (a.endsWith("USD")) {
    const s = a.slice(0, -3);
    if (ASSET_TO_SYMBOL[s]) return s;
  }
  return null;
}

export function extractSignal({ asset, signal, source, stratName }, opts = {}) {
  if (!signal || !signal.type) return null;
  if (!asset) return null;

  const key = normalizeAssetKey(asset);
  if (!key) return null;
  const symbol = ASSET_TO_SYMBOL[key];
  if (!symbol) return null;
  if (opts.strict !== false && !PHASE1_ALLOWED_SYMBOLS.has(symbol)) return null;

  let side;
  if (signal.type === "BUY") side = "LONG";
  else if (signal.type === "SELL") side = "SHORT";
  else if (signal.type === "CLOSE") side = "CLOSE";
  else return null;

  const conf =
    typeof signal.confidence === "number"
      ? Math.max(0, Math.min(1, signal.confidence))
      : CONFIDENCE_MAP[(signal.confidence || "C").toUpperCase()] || 0.5;

  const timeframe = parseTimeframe(signal.reason);
  const family = classifyStrategyFamily(signal.reason, stratName);

  const generatedAt = new Date().toISOString();
  const idRaw = `${source}|${asset}|${side}|${timeframe}|${signal.score || 0}|${generatedAt.slice(0, 16)}`;
  const id = hash(idRaw);

  return {
    id,
    source: source || "unknown",
    asset: key,
    symbol,
    side,
    confidence: Number(conf.toFixed(3)),
    score: Number(signal.score || 0),
    reason: String(signal.reason || "").slice(0, 240),
    timeframe,
    sizeHint: Math.max(0, Math.min(1, Number(signal.positionSize ?? 0.5))),
    generatedAt,
    strategyFamily: family,
  };
}

/**
 * 여러 시그널 중 실전매매에 쓸 "최상위" 시그널 하나만 뽑는다.
 * 기준: confidence 우선 → score → sizeHint
 */
export function pickBestSignal(signals) {
  const valid = (signals || []).filter(Boolean);
  if (!valid.length) return null;
  return valid.sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    if (b.score !== a.score) return b.score - a.score;
    return (b.sizeHint || 0) - (a.sizeHint || 0);
  })[0];
}

export default { extractSignal, pickBestSignal, normalizeAssetKey, ASSET_TO_SYMBOL, PHASE1_ALLOWED_SYMBOLS, classifyStrategyFamily };
