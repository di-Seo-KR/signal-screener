// api/real-trading/engine.js
//
// Phase 1 실전매매 엔진 (Vercel cron).
//
// 역할:
//  1) 킬스위치 + 서킷브레이커 체크
//  2) 가장 최근 가상매매 시그널 중 "매수 직후" 신호를 탐지
//  3) 신호를 canonical 로 변환
//  4) 리스크 매니저로 수량/SL/TP 산출
//  5) executeOrderPlan(dryRun 기본 true) 로 실행
//  6) 실행 내역을 KV에 기록
//
// ★ 안전 원칙 ★
//  - 이 엔드포인트는 기본값으로 "dryRun=true, enabled=false" 이다.
//  - 유저가 명시적으로 KV 플래그 2개를 풀어줘야 실거래가 된다:
//      di:real:user:<uid>:killswitch = false  (기본 true)
//      di:real:user:<uid>:phase1_enabled = true
//  - 자동 트리거(cron)는 GET 메서드. 수동 실행은 POST + { userId, dryRun } 지원.

import { loadUserCredentials, respondError } from "../_shared/binance-auth.js";
import { extractSignal, pickBestSignal, PHASE1_ALLOWED_SYMBOLS } from "../_shared/signal-extractor.js";
import { planTrade, RISK_CONFIG } from "../_shared/risk-manager.js";
import { preTradeCheck } from "../_shared/circuit-breaker.js";
import { getExchangeInfo, getTickerPrice, getAccountInfo } from "../_shared/binance-client.js";
import { executeOrderPlan } from "../binance/order.js";

export const config = { maxDuration: 60 };

// 심볼 필터 캐시
let _exInfo = null;
let _exInfoAt = 0;
async function symFilter(symbol) {
  const now = Date.now();
  if (!_exInfo || now - _exInfoAt > 5 * 60 * 1000) {
    _exInfo = await getExchangeInfo({});
    _exInfoAt = now;
  }
  const s = (_exInfo.symbols || []).find((x) => x.symbol === symbol);
  if (!s) throw new Error(`symbol ${symbol} not in exchangeInfo`);
  const lot = s.filters.find((f) => f.filterType === "LOT_SIZE") || {};
  const mn = s.filters.find((f) => f.filterType === "MIN_NOTIONAL") || {};
  const pf = s.filters.find((f) => f.filterType === "PRICE_FILTER") || {};
  return {
    pricePrecision: s.pricePrecision,
    quantityPrecision: s.quantityPrecision,
    stepSize: parseFloat(lot.stepSize || 0),
    minQty: parseFloat(lot.minQty || 0),
    minNotional: parseFloat(mn.notional || 0),
    tickSize: parseFloat(pf.tickSize || 0),
  };
}

async function getKv() {
  const mod = await import("@vercel/kv");
  return mod.kv;
}

/**
 * 최근 cron 결과(bot perf) 에서 미체결 시그널을 끌어온다.
 * btc-cron 은 trade 실행 시 `di:bot:<botId>:perf.trades[]` 에 log 를 남긴다.
 * 엔진은 중복 실행을 막기 위해 "마지막으로 처리한 trade id" 를 기억.
 *
 * 반환: [{ asset, signal, source }]
 */
async function pullRecentSignals(userId) {
  const kv = await getKv();
  const activeBots = (await kv.get("di:active-bots")) || [];
  const cryptoBots = activeBots.filter((b) =>
    /^(btc-alpha|highcap-momentum|defi-infra|meme-trend|l2-emerging|crypto-diversity|crypto-swing)/.test(b.id || b.botId || "")
  );
  const lastSeenKey = `di:real:user:${userId}:last-signal-ts`;
  const lastSeen = (await kv.get(lastSeenKey)) || 0;
  const now = Date.now();
  const MAX_AGE_MS = 30 * 60 * 1000; // 30분 이내만 실거래 대상

  const candidates = [];
  for (const b of cryptoBots) {
    const botId = b.id || b.botId;
    const perf = await kv.get(`di:bot:${botId}:perf`);
    if (!perf || !Array.isArray(perf.trades)) continue;
    for (const t of perf.trades.slice(0, 10)) {
      if (!t || !t.time || t.type !== "BUY") continue;
      const ts = new Date(t.time).getTime();
      if (!Number.isFinite(ts)) continue;
      if (ts <= lastSeen) continue;
      if (now - ts > MAX_AGE_MS) continue;
      candidates.push({
        asset: t.asset,
        source: `bot:${botId}`,
        signal: {
          type: "BUY",
          confidence: t.signal?.confidence || "B",
          score: t.signal?.score || 60,
          reason: t.signal?.reason || `${botId} BUY`,
          positionSize: 0.5,
        },
        ts,
      });
    }
  }
  await kv.set(lastSeenKey, now);
  return candidates;
}

/**
 * 가격 히스토리로부터 간단한 ATR(14) 근사.
 * 프록시 경유로 klines 를 받아오지 않도록, ticker/price 만 쓰고
 * ATR 은 보수적으로 "가격의 1.5%" 고정값으로 가정한다 (Phase 1 안전 기본값).
 *
 * Phase 2 에서 실제 ATR 로 교체.
 */
function defaultAtrApprox(price) {
  return price * 0.015;
}

async function getEquityUsdt({ apiKey, apiSecret, testnet }) {
  const acct = await getAccountInfo({ apiKey, apiSecret, testnet });
  // totalWalletBalance 가 USDT 기준 지갑 잔고.
  const v = parseFloat(acct.totalWalletBalance || "0");
  return Number.isFinite(v) ? v : 0;
}

async function isPhase1Enabled(userId) {
  const kv = await getKv();
  return !!(await kv.get(`di:real:user:${userId}:phase1_enabled`));
}

async function runOnce({ userId, forceDryRun }) {
  const steps = [];
  const S = (m) => steps.push(m);

  // 1) Phase1 enabled?
  const enabled = await isPhase1Enabled(userId);
  if (!enabled && !forceDryRun) {
    S("skip: phase1_enabled=false");
    return { ok: true, userId, ran: false, reason: "phase1 disabled", steps };
  }

  // 2) 키 로드 (없으면 중단)
  let creds;
  try {
    creds = await loadUserCredentials(userId);
  } catch (e) {
    S(`credentials error: ${e.message}`);
    return { ok: false, userId, ran: false, error: e.message, steps };
  }

  // 3) 현재 에쿼티
  const equity = await getEquityUsdt(creds);
  S(`equity=$${equity.toFixed(2)}`);
  if (equity < 20) {
    S("equity < $20 — skip");
    return { ok: true, userId, ran: false, reason: "insufficient equity", equity, steps };
  }

  // 4) 서킷브레이커
  const gate = await preTradeCheck(userId, equity);
  if (!gate.allowed) {
    S(`breaker blocked: ${gate.reason}`);
    return { ok: true, userId, ran: false, reason: gate.reason, blocked: true, steps };
  }

  // 5) 시그널 수집
  const rawSignals = await pullRecentSignals(userId);
  S(`raw signals=${rawSignals.length}`);
  if (!rawSignals.length) {
    return { ok: true, userId, ran: false, reason: "no recent signals", steps };
  }

  // 6) 정규화 + 최상 선택
  const canonical = rawSignals.map((r) => extractSignal(r, { strict: true })).filter(Boolean);
  S(`canonical signals=${canonical.length} (strict Phase1 allowed)`);
  const best = pickBestSignal(canonical);
  if (!best) {
    return { ok: true, userId, ran: false, reason: "no valid canonical signal", steps };
  }
  S(`picked: ${best.symbol} ${best.side} conf=${best.confidence} fam=${best.strategyFamily}`);

  // 7) 현재가 + ATR(근사)
  const tick = await getTickerPrice({ symbol: best.symbol });
  const price = parseFloat(tick.price);
  const atr = defaultAtrApprox(price);
  S(`price=${price} atr≈${atr.toFixed(4)}`);

  // 8) 심볼 필터 + 리스크 플랜
  const filter = await symFilter(best.symbol);
  const plan = planTrade({ signal: best, equity, price, atr, filter, cfg: RISK_CONFIG });
  if (!plan.ok) {
    S(`risk reject: ${plan.reason}`);
    return { ok: true, userId, ran: false, reason: plan.reason, rejected: true, steps, riskLog: plan.log };
  }
  S(`plan: qty=${plan.plan.qty} notional=$${plan.plan.notional.toFixed(2)} lev=${plan.plan.leverage}x`);
  S(`SL=${plan.plan.slPrice} TP=${plan.plan.tpPrice}`);

  // 9) 실행 (forceDryRun 이면 무조건 dryRun)
  const dryRun = forceDryRun || false;
  const result = await executeOrderPlan({
    userId,
    symbol: plan.plan.symbol,
    side: plan.plan.side,
    usdt: plan.plan.marginRequired, // 필요한 증거금
    leverage: plan.plan.leverage,
    marginType: "ISOLATED",
    stopLossPrice: plan.plan.slPrice,
    takeProfitPrice: plan.plan.tpPrice,
    dryRun,
    clientOrderId: `p1-${best.id}`,
  });

  // 10) 실행 로그 저장
  try {
    const kv = await getKv();
    const logKey = `di:real:user:${userId}:engine-log`;
    const log = (await kv.get(logKey)) || [];
    log.unshift({
      time: new Date().toISOString(),
      signal: best,
      plan: { ...plan.plan, log: undefined },
      result: { ok: result.ok, orderId: result.orderId, dryRun: !!result.dryRun, bracket: result.bracket },
      dryRun,
    });
    await kv.set(logKey, log.slice(0, 200));
  } catch (e) {
    S(`engine-log save failed: ${e.message}`);
  }

  return { ok: true, userId, ran: true, dryRun, signal: best, plan: plan.plan, result, steps };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  try {
    // cron (GET) → enabled 된 모든 유저 순회.
    // 수동 (POST { userId, dryRun }) → 해당 유저만.
    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
      const { userId, dryRun = true } = body;
      if (!userId) return res.status(400).json({ error: "userId required" });
      const out = await runOnce({ userId, forceDryRun: !!dryRun });
      return res.status(200).json(out);
    }

    const kv = await (async () => (await import("@vercel/kv")).kv)();
    const enabledUsers = (await kv.get("di:real:phase1-users")) || [];
    const results = [];
    for (const uid of enabledUsers.slice(0, 10)) {
      try {
        results.push(await runOnce({ userId: uid, forceDryRun: false }));
      } catch (e) {
        results.push({ userId: uid, ok: false, error: e?.message });
      }
    }
    return res.status(200).json({ ok: true, count: results.length, results });
  } catch (err) {
    return respondError(res, err);
  }
}
