// api/real-trading/drawdown-guard.js
//
// 2026-05-17 (QUANT-PLAN) — 포트폴리오 drawdown 자동 청산 가드.
//
// 대표 보고:
//   "벌때는 잘 버는데, 장이 하락할때는 손을 못 쓸정도로 하락하는 거 같아서."
//
// 동작:
//   1) circuit-breaker 의 equityHigh / equityHigh30d 와 현재 currentEquity 비교 → drawdown 계산.
//   2) 단계별 조치:
//      DD ≥ 10%  → 가장 약한 (unrealized PnL 최저) 포지션 50% 청산
//      DD ≥ 15%  → 모든 포지션 30% 청산
//      DD ≥ 20%  → 전체 포지션 강제 청산 + 24h cooldown 활성
//   3) cooldown 은 circuit-breaker.state.cooldownUntil 에 set (기존 인프라 재사용).
//
// 환경변수: ZEPTA_DD_PROTECTION_MODE = off | soft | strict (기본 soft)
//   - off: 평가 안 함 (위험 — 비추천)
//   - soft: 10/15/20% 임계 적용 (기본)
//   - strict: 7/12/18% (더 보수적)
//
// 외부 호출:
//   - position-monitor.js 에서 매 cron 마지막에 evaluateDrawdownGuard(...) 호출.
//   - getPositionRisk 결과의 nonZero 포지션 배열 + creds + userId + currentEquity 받음.

import { placeOrder, cancelAllOpenOrders } from "../_shared/binance-client.js";
import { getSymbolFilter } from "../_shared/exchange-info.js";

async function getKv() { return (await import("@vercel/kv")).kv; }

const STRICT_THRESHOLDS = { lvl1: 0.07, lvl2: 0.12, lvl3: 0.18 };
const SOFT_THRESHOLDS = { lvl1: 0.10, lvl2: 0.15, lvl3: 0.20 };
const COOLDOWN_MS = 24 * 60 * 60 * 1000;

function quantityForReducePct(positionAmt, pct, stepSize) {
  let qty = Math.abs(parseFloat(positionAmt)) * pct;
  if (stepSize && stepSize > 0) {
    qty = Math.floor(qty / stepSize) * stepSize;
  }
  return qty;
}

async function closeReducePct({ creds, p, pct }) {
  const sym = p.symbol;
  const filter = await getSymbolFilter(sym).catch(() => null);
  const step = filter?.stepSize || 0;
  const qty = quantityForReducePct(p.positionAmt, pct, step);
  if (!qty || qty <= 0) return { ok: false, reason: "qty rounded to 0" };
  const side = parseFloat(p.positionAmt) > 0 ? "SELL" : "BUY";
  try {
    await placeOrder({
      ...creds,
      params: {
        symbol: sym,
        side,
        type: "MARKET",
        quantity: qty,
        reduceOnly: "true",
        newOrderRespType: "RESULT",
      },
    });
    return { ok: true, qty };
  } catch (e) {
    return { ok: false, reason: e?.message };
  }
}

/**
 * Drawdown 가드 평가 + 필요 시 자동 청산.
 *
 * @param {object} args
 * @param {string} args.userId
 * @param {object} args.creds        { apiKey, apiSecret, testnet }
 * @param {Array}  args.positions    Binance getPositionRisk 결과의 nonZero 포지션
 * @param {number} args.currentEquity
 * @returns {Promise<{ triggered: boolean, level?: number, ddPct?: number, actions: Array, reason?: string }>}
 */
export async function evaluateDrawdownGuard({ userId, creds, positions, currentEquity } = {}) {
  // ★ 2026-05-17 대표 지시: 기본 off — "DD나 MDD에 따른 일시 중단 빼줘"
  //   복원 시 ZEPTA_DD_PROTECTION_MODE=soft 또는 strict 환경변수 지정.
  const mode = (process.env.ZEPTA_DD_PROTECTION_MODE || "off").toLowerCase();
  if (mode === "off") {
    return { triggered: false, actions: [], reason: "mode=off" };
  }
  if (!userId || !Array.isArray(positions) || !Number.isFinite(currentEquity) || currentEquity <= 0) {
    return { triggered: false, actions: [], reason: "missing args" };
  }
  const thresholds = mode === "strict" ? STRICT_THRESHOLDS : SOFT_THRESHOLDS;

  const kv = await getKv();
  const breakerKey = `di:real:user:${userId}:breaker`;
  const breaker = (await kv.get(breakerKey)) || {};

  // peak: 30일 rolling preferred, fallback to all-time
  const peak = breaker.equityHigh30d || breaker.equityHigh || currentEquity;
  if (!peak || peak <= 0) {
    return { triggered: false, actions: [], reason: "no equity peak yet" };
  }
  const ddPct = (peak - currentEquity) / peak;
  if (ddPct < thresholds.lvl1) {
    return { triggered: false, ddPct, actions: [] };
  }

  // 이미 같은 level cooldown 중이면 재처리 안 함 (중복 청산 방지)
  const ddGuardKey = `di:real:user:${userId}:dd-guard`;
  const guardState = (await kv.get(ddGuardKey)) || {};
  const now = Date.now();
  if (guardState.cooldownUntil && now < guardState.cooldownUntil) {
    return { triggered: false, ddPct, actions: [], reason: "dd-guard cooldown active" };
  }

  // 레벨 결정 (단계는 누적이 아니라 최고 단계만 한 번 처리)
  let level = 1;
  if (ddPct >= thresholds.lvl3) level = 3;
  else if (ddPct >= thresholds.lvl2) level = 2;
  else level = 1;

  // 직전 처리 level 보다 낮으면 skip (이미 처리됨)
  if (guardState.lastLevel && level <= guardState.lastLevel && (now - (guardState.lastTriggeredAt || 0)) < 60 * 60 * 1000) {
    return { triggered: false, ddPct, actions: [], reason: `level ${level} 이미 1시간 내 처리됨` };
  }

  const actions = [];
  if (level === 1) {
    // 가장 약한 (unrealized PnL 최저) 포지션 50% 청산
    const sorted = [...positions].sort((a, b) => parseFloat(a.unRealizedProfit || 0) - parseFloat(b.unRealizedProfit || 0));
    const target = sorted[0];
    if (target) {
      const r = await closeReducePct({ creds, p: target, pct: 0.5 });
      actions.push({ symbol: target.symbol, level, pct: 0.5, ...r });
    }
  } else if (level === 2) {
    // 모든 포지션 30% 청산
    for (const p of positions) {
      const r = await closeReducePct({ creds, p, pct: 0.3 });
      actions.push({ symbol: p.symbol, level, pct: 0.3, ...r });
    }
  } else if (level === 3) {
    // 전체 청산 + cooldown 24h
    for (const p of positions) {
      try { await cancelAllOpenOrders({ ...creds, symbol: p.symbol }).catch(() => {}); } catch {}
      const r = await closeReducePct({ creds, p, pct: 1.0 });
      actions.push({ symbol: p.symbol, level, pct: 1.0, ...r });
    }
    // circuit-breaker.cooldownUntil 도 활성 → 신규 진입 24h 차단
    breaker.cooldownUntil = now + COOLDOWN_MS;
    breaker.haltedReason = `drawdown guard L3 (${(ddPct*100).toFixed(1)}%)`;
    await kv.set(breakerKey, breaker);
  }

  guardState.lastLevel = level;
  guardState.lastTriggeredAt = now;
  guardState.lastDdPct = ddPct;
  if (level === 3) guardState.cooldownUntil = now + COOLDOWN_MS;
  await kv.set(ddGuardKey, guardState);

  // 청산 후 텔레그램 알림
  try {
    const { sendCards, buildCard } = await import("../_shared/telegram.js");
    const tagMap = { 1: "🟡", 2: "🟠", 3: "🔴" };
    const titleMap = {
      1: "drawdown 1단계 — 약한 포지션 50% 청산",
      2: "drawdown 2단계 — 전 포지션 30% 청산",
      3: "drawdown 3단계 — 전 포지션 강제 청산 + 24h cooldown",
    };
    await sendCards([
      buildCard({
        tag: tagMap[level],
        title: titleMap[level],
        lines: [
          `현재 drawdown ${(ddPct*100).toFixed(2)}% (peak $${peak.toFixed(2)} → equity $${currentEquity.toFixed(2)})`,
          `처리 액션: ${actions.length}개 — ${actions.filter(a => a.ok).length}개 성공`,
          ...actions.slice(0, 4).map((a) => `· ${a.symbol} ${a.ok ? `qty ${a.qty}` : `실패 (${a.reason})`}`),
        ],
        hint: "환경변수 ZEPTA_DD_PROTECTION_MODE 로 임계 조절 (off/soft/strict).",
      }),
    ]);
  } catch (e) {
    console.warn("[dd-guard] telegram failed:", e?.message);
  }

  // engine-log 도 기록
  try {
    const logKey = `di:real:user:${userId}:engine-log`;
    const log = (await kv.get(logKey)) || [];
    log.unshift({
      time: new Date().toISOString(),
      event: `dd_guard_L${level}`,
      ddPct: Number(ddPct.toFixed(4)),
      peak,
      equity: currentEquity,
      actions,
    });
    await kv.set(logKey, log.slice(0, 200));
  } catch {}

  return { triggered: true, level, ddPct, actions };
}

export default { evaluateDrawdownGuard };
