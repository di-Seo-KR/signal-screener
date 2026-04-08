// api/_shared/risk-manager.js
//
// $100 수준의 소자본 실전매매를 위한 리스크 매니저.
//
// 책임:
//  1. 현재 에쿼티 + 신호 기반으로 "한 번의 트레이드에 얼마를 걸까" 결정
//  2. 전략 family 기반 ATR 배수로 SL/TP 거리 계산
//  3. Binance minNotional / stepSize 제약을 만족하는 수량 계산
//  4. 동적 레버리지 2x ~ 10x (신호 confidence + family 에 따라)
//  5. 모든 결정을 log 로 남겨 디버그 가능하게 함
//
// 이 파일은 외부(Binance REST) 를 직접 호출하지 않는다.
// 엔진이 먼저 exchangeInfo, ticker 등을 조회해 filter/price 를 넘겨준다.

// ── 기본 설정 (Phase 1) ──
export const RISK_CONFIG = {
  // 계정 에쿼티 대비 단일 트레이드의 "리스크 한도" (SL 까지 맞았을 때 잃는 금액 비율)
  // Fractional Kelly 1/4 ~ 1/5 수준. $100 기준 1회 -$1.5 ~ -$2 손실.
  riskPerTradePct: 0.015, // 1.5%

  // 최대 증거금 비중 (에쿼티 대비) — 레버리지 쓰더라도 마진 콜 여유 확보
  maxMarginPct: 0.40, // 한 포지션에 에쿼티의 40% 까지만 증거금으로

  // 전략 family 별 ATR 배수 (SL 거리)
  atrMultSL: {
    trend: 2.5,
    "mean-revert": 1.5,
    breakout: 1.2,
    unknown: 2.0,
  },
  // TP = SL * RR
  rewardToRisk: {
    trend: 2.5,
    "mean-revert": 1.5,
    breakout: 2.0,
    unknown: 2.0,
  },

  // 레버리지 범위
  minLeverage: 2,
  maxLeverage: 10,

  // confidence 0.5 → minLeverage, 1.0 → maxLeverage (선형)
  // family 가 trend 면 +1, breakout 이면 +0, mean-revert 면 -1 조정
  leverageBias: {
    trend: 1,
    breakout: 0,
    "mean-revert": -1,
    unknown: 0,
  },

  // 최소 주문가능 여유 (minNotional 의 몇 배 이상이어야 실행)
  minNotionalSafety: 1.05,

  // Phase 1 에서는 작은 자본 보호용으로 단일 포지션 "절대 상한"
  absoluteMaxNotional: 500, // $500 — 레버리지 반영 후에도 이 이상 금지
};

function roundDownStep(x, step) {
  if (!step || step <= 0) return x;
  return Math.floor(x / step) * step;
}

function round(x, decimals) {
  const f = Math.pow(10, decimals || 0);
  return Math.round(x * f) / f;
}

function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

/**
 * 동적 레버리지.
 * confidence: 0~1, family: trend/mean-revert/breakout/unknown
 */
export function pickLeverage(confidence, family, cfg = RISK_CONFIG) {
  const base = cfg.minLeverage + (cfg.maxLeverage - cfg.minLeverage) * clamp((confidence - 0.5) / 0.5, 0, 1);
  const bias = cfg.leverageBias[family] || 0;
  return Math.round(clamp(base + bias, cfg.minLeverage, cfg.maxLeverage));
}

/**
 * ATR 기반 stop 거리(퍼센트). atr 는 price 와 같은 단위.
 */
export function stopDistancePct({ price, atr, family, cfg = RISK_CONFIG }) {
  if (!atr || !price || atr <= 0 || price <= 0) return null;
  const mult = cfg.atrMultSL[family] || cfg.atrMultSL.unknown;
  return (atr * mult) / price; // ratio (e.g., 0.02 = 2%)
}

/**
 * 핵심 함수: 신호 + 계정 상태 → 실제 주문 파라미터.
 *
 * @param {object} args
 * @param {object} args.signal        canonical signal (signal-extractor 출력)
 * @param {number} args.equity        현재 가용 USDT (Binance futures wallet)
 * @param {number} args.price         현재가
 * @param {number} args.atr           최근 ATR (price 단위)
 * @param {object} args.filter        binance symbol filter (stepSize, minQty, minNotional, ...)
 * @param {object} [args.cfg]         RISK_CONFIG override
 * @returns {{ ok: boolean, reason?: string, plan?: object }}
 */
export function planTrade({ signal, equity, price, atr, filter, cfg = RISK_CONFIG }) {
  const log = [];
  const push = (m) => log.push(m);

  if (!signal || !["LONG", "SHORT"].includes(signal.side)) {
    return { ok: false, reason: "invalid signal side", log };
  }
  if (!(equity > 0)) return { ok: false, reason: "equity <= 0", log };
  if (!(price > 0)) return { ok: false, reason: "price invalid", log };
  if (!filter) return { ok: false, reason: "symbol filter missing", log };

  // 1) ATR → stop 거리
  const stopDistPct = stopDistancePct({ price, atr, family: signal.strategyFamily, cfg });
  if (!stopDistPct || stopDistPct <= 0) {
    return { ok: false, reason: "ATR 없음 또는 stop 거리 산출 불가", log };
  }
  push(`stopDistPct=${(stopDistPct * 100).toFixed(2)}%`);

  // 2) 리스크 금액 = 에쿼티 × riskPerTradePct
  const riskAmount = equity * cfg.riskPerTradePct;
  push(`riskAmount=$${riskAmount.toFixed(2)} (${cfg.riskPerTradePct * 100}% of $${equity.toFixed(2)})`);

  // 3) 리스크 금액 / stop 거리 = 명목가 (notional)
  //    포지션이 stopDistPct 만큼 움직이면 riskAmount 를 잃는다.
  let notional = riskAmount / stopDistPct;
  push(`rawNotional=$${notional.toFixed(2)}`);

  // 4) 절대 상한
  if (notional > cfg.absoluteMaxNotional) {
    notional = cfg.absoluteMaxNotional;
    push(`capped by absoluteMaxNotional=$${cfg.absoluteMaxNotional}`);
  }

  // 5) 레버리지
  const leverage = pickLeverage(signal.confidence, signal.strategyFamily, cfg);
  push(`leverage=${leverage}x (conf=${signal.confidence}, fam=${signal.strategyFamily})`);

  // 6) 필요한 증거금 = notional / leverage
  const margin = notional / leverage;
  const maxMargin = equity * cfg.maxMarginPct;
  if (margin > maxMargin) {
    notional = maxMargin * leverage;
    push(`margin capped: margin=$${margin.toFixed(2)} > max=$${maxMargin.toFixed(2)} → notional=$${notional.toFixed(2)}`);
  }

  // 7) sizeHint 반영 (약한 신호는 더 작게)
  const sizeHint = clamp(signal.sizeHint ?? 0.5, 0.1, 1.0);
  notional = notional * sizeHint;
  push(`sizeHint=${sizeHint} → notional=$${notional.toFixed(2)}`);

  // 8) minNotional 체크
  const minN = filter.minNotional || 0;
  if (notional < minN * cfg.minNotionalSafety) {
    return {
      ok: false,
      reason: `notional $${notional.toFixed(2)} < minNotional×safety $${(minN * cfg.minNotionalSafety).toFixed(2)}`,
      log,
    };
  }

  // 9) quantity 계산 + stepSize 반올림
  const rawQty = notional / price;
  const qty = roundDownStep(rawQty, filter.stepSize || 0);
  if (qty < (filter.minQty || 0)) {
    return { ok: false, reason: `qty ${qty} < minQty ${filter.minQty}`, log };
  }
  const finalNotional = qty * price;
  if (finalNotional < minN) {
    return { ok: false, reason: `finalNotional ${finalNotional.toFixed(2)} < minNotional ${minN}`, log };
  }

  // 10) SL/TP 가격 (price 단위)
  const slPct = stopDistPct;
  const rr = cfg.rewardToRisk[signal.strategyFamily] || cfg.rewardToRisk.unknown;
  const tpPct = slPct * rr;

  const slPrice =
    signal.side === "LONG" ? price * (1 - slPct) : price * (1 + slPct);
  const tpPrice =
    signal.side === "LONG" ? price * (1 + tpPct) : price * (1 - tpPct);

  const tickSize = filter.tickSize || 0;
  const pricePrecision = filter.pricePrecision || 2;
  const roundPrice = (p) => {
    const stepped = tickSize > 0 ? Math.round(p / tickSize) * tickSize : p;
    return round(stepped, pricePrecision);
  };

  const plan = {
    symbol: signal.symbol,
    side: signal.side,
    qty,
    entryPrice: price,
    notional: finalNotional,
    marginRequired: finalNotional / leverage,
    leverage,
    slPrice: roundPrice(slPrice),
    tpPrice: roundPrice(tpPrice),
    slPct,
    tpPct,
    riskAmount,
    expectedWin: (finalNotional * tpPct),
    expectedLoss: (finalNotional * slPct),
    strategyFamily: signal.strategyFamily,
    confidence: signal.confidence,
    sizeHint,
    log,
  };
  return { ok: true, plan };
}

export default { planTrade, pickLeverage, stopDistancePct, RISK_CONFIG };
