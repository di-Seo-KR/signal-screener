// 바이낸스 Futures(USDⓈ-M) REST API 클라이언트
//
// 두 가지 모드 지원:
//   1) DIRECT 모드 — Vercel에서 바이낸스로 직접 HTTP 호출
//      (IP 화이트리스트 불가라 Futures trading 불가능 — 무서명 호출용)
//   2) PROXY 모드 — Fly.io 고정 IP 프록시 경유
//      환경변수 BINANCE_PROXY_URL, BINANCE_PROXY_SECRET 설정되면 자동으로 프록시 모드
//
// 사용 예:
//   import { getAccountInfo } from "../_shared/binance-client.js";
//   const acct = await getAccountInfo({ apiKey, apiSecret });

import crypto from "node:crypto";

export const BINANCE_FAPI = process.env.BINANCE_FAPI_BASE || "https://fapi.binance.com";
export const BINANCE_FAPI_TESTNET = "https://testnet.binancefuture.com";

const PROXY_URL = process.env.BINANCE_PROXY_URL || "";       // 예: https://zepta-binance-proxy.fly.dev
const PROXY_SECRET = process.env.BINANCE_PROXY_SECRET || ""; // Fly.io와 공유하는 HMAC 키

export function isProxyMode() {
  return !!(PROXY_URL && PROXY_SECRET);
}

function sign(queryString, apiSecret) {
  return crypto.createHmac("sha256", apiSecret).update(queryString).digest("hex");
}

function buildQuery(params) {
  // undefined/null 제거
  const entries = Object.entries(params || {}).filter(([, v]) => v !== undefined && v !== null && v !== "");
  return entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
}

// 프록시 내부 인증 서명 (Fly.io server.js의 signInternal과 동일 규칙)
function signProxyInternal(timestamp, method, path, bodyStr) {
  return crypto
    .createHmac("sha256", PROXY_SECRET)
    .update(`${timestamp}\n${method}\n${path}\n${bodyStr || ""}`)
    .digest("hex");
}

// 프록시 경유 요청
async function viaProxy({ apiKey, apiSecret, method, path, params, testnet, signed = true }) {
  const proxyPath = "/binance/request";
  const body = { apiKey, apiSecret, method, path, params, testnet, signed };
  const bodyStr = JSON.stringify(body);
  const timestamp = Date.now().toString();
  const sig = signProxyInternal(timestamp, "POST", proxyPath, bodyStr);

  const resp = await fetch(`${PROXY_URL}${proxyPath}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Proxy-Timestamp": timestamp,
      "X-Proxy-Signature": sig,
    },
    body: bodyStr,
    signal: AbortSignal.timeout(15000),
  });

  const text = await resp.text();
  let wrapped;
  try { wrapped = JSON.parse(text); } catch { wrapped = { ok: false, raw: text }; }

  // 프록시 자체 오류
  if (!resp.ok && resp.status !== 400 && resp.status !== 401 && resp.status !== 500) {
    const e = new Error(`Proxy ${resp.status}: ${wrapped?.error || text}`);
    e.status = resp.status;
    throw e;
  }

  // 프록시는 {ok, status, data} 로 래핑해서 반환
  if (wrapped.ok === false && wrapped.data && typeof wrapped.data === "object") {
    const e = new Error(`Binance ${wrapped.status}: ${wrapped.data?.msg || "error"}`);
    e.status = wrapped.status;
    e.code = wrapped.data?.code;
    e.data = wrapped.data;
    throw e;
  }
  if (wrapped.ok === false) {
    const e = new Error(wrapped?.error || "Proxy error");
    e.status = wrapped.status || 500;
    throw e;
  }

  return wrapped.data;
}

/**
 * 서명된 요청.
 * @param {object} opts
 * @param {string} opts.apiKey
 * @param {string} opts.apiSecret
 * @param {"GET"|"POST"|"DELETE"|"PUT"} opts.method
 * @param {string} opts.path  예: "/fapi/v2/account"
 * @param {object} [opts.params]
 * @param {boolean} [opts.testnet]
 * @param {number} [opts.recvWindow] 기본 5000
 */
export async function binanceSignedRequest({ apiKey, apiSecret, method, path, params = {}, testnet = false, recvWindow = 5000 }) {
  if (!apiKey || !apiSecret) throw new Error("binanceSignedRequest: apiKey/apiSecret required");

  // === 프록시 모드: Fly.io 경유 ===
  if (isProxyMode()) {
    return await viaProxy({ apiKey, apiSecret, method, path, params, testnet, signed: true });
  }

  // === 다이렉트 모드 (IP 화이트리스트 없는 환경, 무서명 endpoint나 testnet 용) ===
  const base = testnet ? BINANCE_FAPI_TESTNET : BINANCE_FAPI;

  const timestamp = Date.now();
  const allParams = { ...params, recvWindow, timestamp };
  const qs = buildQuery(allParams);
  const signature = sign(qs, apiSecret);
  const full = `${qs}&signature=${signature}`;

  let url = `${base}${path}`;
  const init = {
    method,
    headers: { "X-MBX-APIKEY": apiKey },
  };

  if (method === "GET" || method === "DELETE") {
    url += `?${full}`;
  } else {
    // POST/PUT — Binance는 body 대신 query에 실어도 받음 (일관성을 위해 query 사용)
    url += `?${full}`;
  }

  const resp = await fetch(url, { ...init, signal: AbortSignal.timeout(10000) });
  const text = await resp.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }

  if (!resp.ok) {
    const err = new Error(`Binance ${resp.status}: ${data?.msg || text}`);
    err.status = resp.status;
    err.code = data?.code;
    err.data = data;
    throw err;
  }
  return data;
}

// === 고수준 헬퍼 ===

/** 계정 정보 (잔고, 포지션, 권한) — GET /fapi/v2/account */
export function getAccountInfo({ apiKey, apiSecret, testnet = false }) {
  return binanceSignedRequest({ apiKey, apiSecret, method: "GET", path: "/fapi/v2/account", testnet });
}

/** API 키 권한 — GET /sapi/v1/account/apiRestrictions (현물 base, 사용 X)
 *  Futures 전용 권한은 /fapi/v2/account 의 canTrade/canDeposit/canWithdraw 로 확인.
 */

/** 심볼 거래소 정보 — GET /fapi/v1/exchangeInfo (무서명)
 *  프록시 모드면 프록시 경유 (바이낸스가 Vercel 미국 IP를 451 차단하므로 필수).
 */
export async function getExchangeInfo({ testnet = false } = {}) {
  if (isProxyMode()) {
    return await viaProxy({
      method: "GET",
      path: "/fapi/v1/exchangeInfo",
      params: {},
      testnet,
      signed: false,
    });
  }
  const base = testnet ? BINANCE_FAPI_TESTNET : BINANCE_FAPI;
  const resp = await fetch(`${base}/fapi/v1/exchangeInfo`, { signal: AbortSignal.timeout(10000) });
  if (!resp.ok) throw new Error(`exchangeInfo ${resp.status}`);
  return await resp.json();
}

/** 현재가 — GET /fapi/v1/ticker/price (무서명)
 *  프록시 모드면 프록시 경유.
 */
export async function getTickerPrice({ symbol, testnet = false }) {
  if (isProxyMode()) {
    return await viaProxy({
      method: "GET",
      path: "/fapi/v1/ticker/price",
      params: symbol ? { symbol } : {},
      testnet,
      signed: false,
    });
  }
  const base = testnet ? BINANCE_FAPI_TESTNET : BINANCE_FAPI;
  const url = symbol ? `${base}/fapi/v1/ticker/price?symbol=${symbol}` : `${base}/fapi/v1/ticker/price`;
  const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!resp.ok) throw new Error(`ticker/price ${resp.status}`);
  return await resp.json();
}

/** 24시간 티커 통계(전 심볼) — GET /fapi/v1/ticker/24hr (무서명).
 *  동적 유니버스의 유동성(quoteVolume) 랭킹용. 프록시 모드면 프록시 경유.
 */
export async function get24hrTickers({ testnet = false } = {}) {
  if (isProxyMode()) {
    return await viaProxy({
      method: "GET",
      path: "/fapi/v1/ticker/24hr",
      params: {},
      testnet,
      signed: false,
    });
  }
  const base = testnet ? BINANCE_FAPI_TESTNET : BINANCE_FAPI;
  const resp = await fetch(`${base}/fapi/v1/ticker/24hr`, {
    signal: AbortSignal.timeout(15000),
    headers: { "User-Agent": "Zepta/1.0", "Accept": "application/json" },
  });
  if (!resp.ok) throw new Error(`ticker/24hr ${resp.status}`);
  return await resp.json();
}

/**
 * 캔들 데이터 — GET /fapi/v1/klines (무서명, 프록시 필수)
 * @param {object} opts
 * @param {string} opts.symbol
 * @param {string} [opts.interval="4h"]
 * @param {number} [opts.limit=100]
 */
export async function getKlines({ symbol, interval = "4h", limit = 100, startTime, endTime, testnet = false }) {
  const params = { symbol, interval, limit };
  if (startTime != null) params.startTime = startTime;
  if (endTime != null) params.endTime = endTime;
  if (isProxyMode()) {
    return await viaProxy({
      method: "GET",
      path: "/fapi/v1/klines",
      params,
      testnet,
      signed: false,
    });
  }
  const base = testnet ? BINANCE_FAPI_TESTNET : BINANCE_FAPI;
  let url = `${base}/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  if (startTime != null) url += `&startTime=${startTime}`;
  if (endTime != null) url += `&endTime=${endTime}`;
  const resp = await fetch(url, {
    signal: AbortSignal.timeout(15000),
    headers: { "User-Agent": "Zepta/1.0", "Accept": "application/json" },
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`klines ${resp.status}: ${body.slice(0, 200)}`);
  }
  return await resp.json();
}

/** 선물 시장 컨텍스트 — premiumIndex 1회로 {funding, basis} 동시 반환.
 *  basis = (markPrice - indexPrice)/indexPrice (퍼프 프리미엄; 펀딩과 관련). 실패 시 빈 맵. */
export async function getMarketContext({ testnet = false } = {}) {
  const funding = {}, basis = {};
  try {
    let arr;
    if (isProxyMode()) {
      arr = await viaProxy({ method: "GET", path: "/fapi/v1/premiumIndex", params: {}, testnet, signed: false });
    } else {
      const base = testnet ? BINANCE_FAPI_TESTNET : BINANCE_FAPI;
      const resp = await fetch(`${base}/fapi/v1/premiumIndex`, {
        signal: AbortSignal.timeout(15000),
        headers: { "User-Agent": "Zepta/1.0", "Accept": "application/json" },
      });
      if (!resp.ok) return { funding, basis };
      arr = await resp.json();
    }
    if (Array.isArray(arr)) {
      for (const e of arr) {
        if (!e.symbol) continue;
        const f = parseFloat(e.lastFundingRate);
        if (Number.isFinite(f)) funding[e.symbol] = f;
        const mark = parseFloat(e.markPrice), idx = parseFloat(e.indexPrice);
        if (Number.isFinite(mark) && Number.isFinite(idx) && idx > 0) basis[e.symbol] = (mark - idx) / idx;
      }
    }
  } catch { /* 무시 → 빈 맵 */ }
  return { funding, basis };
}

/** 단일 심볼 미결제약정(OI) — GET /fapi/v1/openInterest. 실패 시 null. */
export async function getOpenInterest({ symbol, testnet = false }) {
  try {
    let data;
    if (isProxyMode()) {
      data = await viaProxy({ method: "GET", path: "/fapi/v1/openInterest", params: { symbol }, testnet, signed: false });
    } else {
      const base = testnet ? BINANCE_FAPI_TESTNET : BINANCE_FAPI;
      const resp = await fetch(`${base}/fapi/v1/openInterest?symbol=${symbol}`, {
        signal: AbortSignal.timeout(10000),
        headers: { "User-Agent": "Zepta/1.0", "Accept": "application/json" },
      });
      if (!resp.ok) return null;
      data = await resp.json();
    }
    const oi = parseFloat(data?.openInterest);
    return Number.isFinite(oi) ? oi : null;
  } catch { return null; }
}

/** 최근 체결 내역 — GET /fapi/v1/userTrades */
export function getUserTrades({ apiKey, apiSecret, symbol, startTime, limit = 50, testnet = false }) {
  const params = { symbol, limit };
  if (startTime) params.startTime = startTime;
  return binanceSignedRequest({
    apiKey, apiSecret, method: "GET", path: "/fapi/v1/userTrades",
    params, testnet,
  });
}

/**
 * 손익 기록 — GET /fapi/v1/income
 *   incomeType 예: REALIZED_PNL · FUNDING_FEE · COMMISSION · TRANSFER · (생략 시 전체)
 *   TRANSFER = 현물↔선물 지갑 이동(입출금) → 수익률 계산 시 반드시 제외해야 함.
 *   한 번에 최대 1000건. 기간(startTime~endTime)으로 좁혀 호출.
 */
export function getIncome({ apiKey, apiSecret, incomeType, startTime, endTime, limit = 1000, testnet = false }) {
  const params = { limit };
  if (incomeType) params.incomeType = incomeType;
  if (startTime) params.startTime = startTime;
  if (endTime) params.endTime = endTime;
  return binanceSignedRequest({
    apiKey, apiSecret, method: "GET", path: "/fapi/v1/income",
    params, testnet,
  });
}

/** 레버리지 변경 — POST /fapi/v1/leverage */
export function changeLeverage({ apiKey, apiSecret, symbol, leverage, testnet = false }) {
  return binanceSignedRequest({
    apiKey, apiSecret, method: "POST", path: "/fapi/v1/leverage",
    params: { symbol, leverage }, testnet,
  });
}

/** 마진 타입 변경 — POST /fapi/v1/marginType (ISOLATED | CROSSED) */
export function changeMarginType({ apiKey, apiSecret, symbol, marginType, testnet = false }) {
  return binanceSignedRequest({
    apiKey, apiSecret, method: "POST", path: "/fapi/v1/marginType",
    params: { symbol, marginType }, testnet,
  });
}

/** 주문 — POST /fapi/v1/order */
export function placeOrder({ apiKey, apiSecret, params, testnet = false }) {
  return binanceSignedRequest({
    apiKey, apiSecret, method: "POST", path: "/fapi/v1/order",
    params, testnet,
  });
}

/** 포지션 리스크 — GET /fapi/v2/positionRisk */
export function getPositionRisk({ apiKey, apiSecret, symbol, testnet = false }) {
  return binanceSignedRequest({
    apiKey, apiSecret, method: "GET", path: "/fapi/v2/positionRisk",
    params: symbol ? { symbol } : {}, testnet,
  });
}

/** 모든 오픈 주문 취소 — DELETE /fapi/v1/allOpenOrders */
export function cancelAllOpenOrders({ apiKey, apiSecret, symbol, testnet = false }) {
  return binanceSignedRequest({
    apiKey, apiSecret, method: "DELETE", path: "/fapi/v1/allOpenOrders",
    params: { symbol }, testnet,
  });
}

/** 오픈 주문 목록 — GET /fapi/v1/openOrders */
export function getOpenOrders({ apiKey, apiSecret, symbol, testnet = false }) {
  return binanceSignedRequest({
    apiKey, apiSecret, method: "GET", path: "/fapi/v1/openOrders",
    params: symbol ? { symbol } : {}, testnet,
  });
}

/** 단일 주문 취소 — DELETE /fapi/v1/order */
export function cancelOrder({ apiKey, apiSecret, symbol, orderId, origClientOrderId, testnet = false }) {
  const params = { symbol };
  if (orderId) params.orderId = orderId;
  if (origClientOrderId) params.origClientOrderId = origClientOrderId;
  return binanceSignedRequest({
    apiKey, apiSecret, method: "DELETE", path: "/fapi/v1/order",
    params, testnet,
  });
}

/**
 * STOP_MARKET / TAKE_PROFIT_MARKET 주문 (reduceOnly).
 * Bracket(SL/TP) 용.
 *
 * @param {object} opts
 * @param {"STOP_MARKET"|"TAKE_PROFIT_MARKET"} opts.type
 * @param {"BUY"|"SELL"} opts.side  (LONG 포지션의 SL/TP 는 SELL, SHORT 의 경우 BUY)
 * @param {number} opts.stopPrice
 * @param {number} [opts.quantity]  없으면 closePosition=true 로 전량 청산
 * @param {boolean} [opts.closePosition=false]
 * @param {string} [opts.workingType="MARK_PRICE"]
 * @param {string} [opts.clientOrderId]
 */
export function placeStopOrder({
  apiKey, apiSecret, symbol, type, side, stopPrice,
  quantity, closePosition = false, workingType = "MARK_PRICE",
  price, // ★ STOP (limit) / TAKE_PROFIT (limit) 의 limit price
  timeInForce, // ★ STOP (limit) 일 때 GTC 등 명시
  clientOrderId, testnet = false,
}) {
  const params = {
    symbol,
    side,
    type,
    stopPrice,
    workingType,
    newOrderRespType: "RESULT",
  };
  if (closePosition) {
    params.closePosition = true;
  } else {
    params.quantity = quantity;
    params.reduceOnly = true;
  }
  // ★ STOP / TAKE_PROFIT (limit) 은 price + timeInForce 필요
  //   STOP_MARKET / TAKE_PROFIT_MARKET 은 price 없음
  if (price != null && (type === "STOP" || type === "TAKE_PROFIT")) {
    params.price = price;
    params.timeInForce = timeInForce || "GTC";
  }
  if (clientOrderId) params.newClientOrderId = clientOrderId;
  return binanceSignedRequest({
    apiKey, apiSecret, method: "POST", path: "/fapi/v1/order",
    params, testnet,
  });
}
