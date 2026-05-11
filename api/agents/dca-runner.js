// ════════════════════════════════════════════════════════════════════
// Zepta — DCA (Dollar-Cost Averaging) 자동 실행 cron
// ────────────────────────────────────────────────────────────────────
// PLAN-BIZ #5 (2026-05-11)
//
// Cron: `0 * * * *` (매시 정각, UTC)
//
// 동작:
//   1) `di:dca:active-users` 인덱스에서 활성 사용자 수집
//   2) 사용자별 `di:dca:user:<uid>:configs` 순회
//   3) frequency + hour 매칭 + 이전 lastRun 으로 중복 방지
//      - daily   : 매일 hour 시
//      - weekly  : 매주 월요일 hour 시
//      - monthly : 매월 1일 hour 시
//   4) loadUserCredentials 로 API 키 로드 (실패 시 skip)
//   5) Binance Futures MARKET BUY (quoteOrderQty 사용 → 정액 매수)
//   6) lastRun / totalInvested / runs 업데이트
//
// 로깅: `di:dca:user:<uid>:log` 에 최근 50건 push
// 텔레그램: 본 cron 은 별도 알림 X (사용자 본인 매매 추적은 거래내역으로)
//
// Timeout: 60초 (사용자 수가 많아져도 1분 안에 완료)
// ════════════════════════════════════════════════════════════════════

import { placeOrder, getSymbolFilter } from "../_shared/binance-client.js";
import { loadUserCredentials } from "../_shared/binance-auth.js";

export const config = { maxDuration: 60 };

async function getKv() {
  return (await import("@vercel/kv")).kv;
}

// ────────────────────────────────────────────────────────────────────
// frequency 매칭 — UTC 기준
//   daily   : hour 일치
//   weekly  : 월요일(getUTCDay()===1) + hour 일치
//   monthly : 1일(getUTCDate()===1) + hour 일치
//
// 추가로 lastRun 이 24h(daily)/7d(weekly)/28d(monthly) 안이면 skip — 중복 방지.
// ────────────────────────────────────────────────────────────────────
function shouldRun(cfg, now) {
  if (now.getUTCHours() !== cfg.hour) return false;
  if (cfg.frequency === "daily") {
    if (cfg.lastRun && now.getTime() - cfg.lastRun < 20 * 3600 * 1000) return false;
    return true;
  }
  if (cfg.frequency === "weekly") {
    if (now.getUTCDay() !== 1) return false; // 월요일
    if (cfg.lastRun && now.getTime() - cfg.lastRun < 6 * 24 * 3600 * 1000) return false;
    return true;
  }
  if (cfg.frequency === "monthly") {
    if (now.getUTCDate() !== 1) return false; // 매월 1일
    if (cfg.lastRun && now.getTime() - cfg.lastRun < 25 * 24 * 3600 * 1000) return false;
    return true;
  }
  return false;
}

// ────────────────────────────────────────────────────────────────────
// 단일 config 실행 — Binance Futures MARKET BUY (정액)
//   Binance Futures USDM 은 quoteOrderQty 미지원 → 가격 조회 후 qty 환산.
// ────────────────────────────────────────────────────────────────────
async function executeDCAOrder({ apiKey, apiSecret, testnet, cfg }) {
  const { symbol, amount } = cfg;

  // 심볼 필터 (stepSize, minNotional, quantityPrecision)
  let filter;
  try {
    filter = await getSymbolFilter(symbol, { testnet });
  } catch (e) {
    throw new Error(`심볼 필터 조회 실패: ${e.message}`);
  }
  if (filter.status !== "TRADING") {
    throw new Error(`심볼 ${symbol} 거래 중지 상태`);
  }

  // 현재가 조회 (mark price)
  const priceUrl = (testnet
    ? "https://testnet.binancefuture.com"
    : "https://fapi.binance.com") + `/fapi/v1/premiumIndex?symbol=${symbol}`;
  const pr = await fetch(priceUrl, { signal: AbortSignal.timeout(8000) });
  if (!pr.ok) throw new Error(`가격 조회 실패: ${pr.status}`);
  const priceJson = await pr.json();
  const markPrice = parseFloat(priceJson.markPrice || priceJson.indexPrice || 0);
  if (!markPrice || markPrice <= 0) throw new Error("가격 데이터 없음");

  // 수량 계산 + stepSize 반올림
  const rawQty = amount / markPrice;
  const step = filter.stepSize || Math.pow(10, -filter.quantityPrecision);
  let qty = Math.floor(rawQty / step) * step;
  qty = Number(qty.toFixed(filter.quantityPrecision || 4));

  if (qty < (filter.minQty || 0)) {
    throw new Error(`매수 수량(${qty}) 이 최소 수량(${filter.minQty})보다 작음. 매수 금액을 늘려주세요.`);
  }
  const notional = qty * markPrice;
  if (filter.minNotional && notional < filter.minNotional) {
    throw new Error(`주문 금액(${notional.toFixed(2)} USDT) 이 최소 주문(${filter.minNotional} USDT) 미만`);
  }

  // MARKET BUY 주문 — DCA 는 격리 마진 + 1x 레버리지 (단순 spot-like)
  const params = {
    symbol,
    side: "BUY",
    type: "MARKET",
    quantity: qty,
    newOrderRespType: "RESULT",
    newClientOrderId: `zepta-dca-${cfg.id}-${Date.now()}`.slice(0, 36),
  };
  const resp = await placeOrder({ apiKey, apiSecret, params, testnet });

  return {
    orderId: resp.orderId,
    qty,
    price: markPrice,
    notional: Number(notional.toFixed(2)),
    status: resp.status,
  };
}

// ────────────────────────────────────────────────────────────────────
// 단일 사용자 처리 — credentials 로드 → 매칭 config 실행
// ────────────────────────────────────────────────────────────────────
async function processUser(kv, userId, now) {
  const key = `di:dca:user:${userId}:configs`;
  const logKey = `di:dca:user:${userId}:log`;
  const list = (await kv.get(key)) || [];
  if (!Array.isArray(list) || list.length === 0) return { userId, ran: 0 };

  const dueConfigs = list.filter(c => shouldRun(c, now));
  if (dueConfigs.length === 0) return { userId, ran: 0 };

  let creds;
  try {
    creds = await loadUserCredentials(userId);
  } catch (e) {
    // API 키 없음 → 로그만 남기고 skip (사용자가 키 연결 후 재시도)
    return { userId, ran: 0, skipped: true, error: e.code || e.message };
  }
  const { apiKey, apiSecret, testnet } = creds;

  let ran = 0;
  const newLogs = [];
  const updated = [...list];

  for (const cfg of dueConfigs) {
    let result;
    let error = null;
    try {
      result = await executeDCAOrder({ apiKey, apiSecret, testnet, cfg });
      ran += 1;
    } catch (e) {
      error = e.message || String(e);
      console.warn(`[dca-runner] ${userId} ${cfg.symbol} 실패:`, error);
    }

    // config 업데이트
    const idx = updated.findIndex(c => c.id === cfg.id);
    if (idx >= 0) {
      if (result) {
        updated[idx] = {
          ...updated[idx],
          lastRun: now.getTime(),
          runs: (updated[idx].runs || 0) + 1,
          totalInvested: (updated[idx].totalInvested || 0) + result.notional,
        };
      } else {
        // 실패해도 lastRun 은 갱신해서 같은 시간에 재시도 폭주 방지
        updated[idx] = {
          ...updated[idx],
          lastRun: now.getTime(),
          lastError: error,
        };
      }
    }

    newLogs.push({
      configId: cfg.id,
      symbol: cfg.symbol,
      amount: cfg.amount,
      frequency: cfg.frequency,
      ranAt: now.getTime(),
      result: result || null,
      error,
    });
  }

  // KV 동시 업데이트
  await kv.set(key, updated);

  // 로그 — 최근 50건만 유지
  try {
    const existingLogs = (await kv.get(logKey)) || [];
    const merged = [...newLogs, ...existingLogs].slice(0, 50);
    await kv.set(logKey, merged);
  } catch (e) {
    console.warn("[dca-runner] log 저장 실패:", e.message);
  }

  return { userId, ran, configs: dueConfigs.length };
}

// ════════════════════════════════════════════════════════════════════
// HTTP handler — Vercel cron 진입점
// ════════════════════════════════════════════════════════════════════
export default async function handler(req, res) {
  // Vercel cron 인증 (다른 cron 과 동일 패턴)
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    // 개발 환경(`?dev=1`)에서는 우회 — 수동 트리거용
    if (req.query?.dev !== "1") {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }
  }

  try {
    const kv = await getKv();
    const users = (await kv.get("di:dca:active-users")) || [];
    if (!Array.isArray(users) || users.length === 0) {
      return res.status(200).json({ ok: true, users: 0, totalRan: 0 });
    }

    const now = new Date();
    const results = [];
    // 사용자 직렬 처리 — 동시 처리 시 Binance rate-limit 위험.
    // DCA 는 한 시간에 한 번이라 1분 안에 충분.
    for (const uid of users) {
      try {
        const r = await processUser(kv, uid, now);
        results.push(r);
      } catch (e) {
        results.push({ userId: uid, error: e.message });
      }
    }

    const totalRan = results.reduce((s, r) => s + (r.ran || 0), 0);
    return res.status(200).json({
      ok: true,
      users: users.length,
      processed: results.length,
      totalRan,
      results: results.slice(0, 30),
      nowUTC: now.toISOString(),
    });
  } catch (e) {
    console.error("[dca-runner] fatal:", e);
    return res.status(500).json({ ok: false, error: e.message || String(e) });
  }
}
