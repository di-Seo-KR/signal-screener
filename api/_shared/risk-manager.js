// api/_shared/risk-manager.js
//
// Phase 1 실전매매 리스크 매니저 (Option A — 절대수익형 posture).
//
// 이 모듈의 직무:
//  1) 에쿼티 + 신호 → 한 번에 얼마를 걸지 결정 (Fractional Kelly)
//  2) ATR 기반 SL 거리 + 전략 family 별 R:R 매칭
//  3) Binance minNotional / stepSize 제약 반영
//  4) 동적 레버리지 2x~5x (Option A 보수화)
//  5) ★ 수수료(왕복 0.08%) + 예상 슬리피지(왕복 0.05%) 를 리스크에 반영
//  6) ★ 청산가격과 SL 거리 안전 버퍼 검증 (liquidation-before-SL 사고 방지)
//  7) 모든 판단을 log 배열에 남김
//
// 외부(Binance REST) 직접 호출 없음. 엔진이 필터·가격·ATR 을 넘겨준다.

// ── Option A: 절대수익형 기본 설정 ──
export const RISK_CONFIG = {
  // Fractional Kelly ~ 1/8. $100 기준 1회 -$0.8 손실 목표.
  // (수수료·슬리피지 흡수 후에도 실질 risk 가 의도와 맞도록 축소)
  riskPerTradePct: 0.008, // 0.8%

  // 한 포지션 최대 증거금 비중
  maxMarginPct: 0.35,

  // 동시 보유 포지션 상한 (상관 위험 관리)
  maxConcurrentPositions: 2,

  // 심볼 간 상관 그룹 — 같은 그룹에서 동시 2개 금지
  correlationGroups: [
    ["BTCUSDT", "ETHUSDT", "BNBUSDT"],              // 메가캡
    ["SOLUSDT", "AVAXUSDT", "ADAUSDT", "DOTUSDT"],  // L1
    ["DOGEUSDT", "XRPUSDT"],                        // 레거시 밈/페이먼트
    ["MATICUSDT", "LINKUSDT"],                      // 인프라
  ],

  // 전략 family 별 ATR × 배수 (SL 거리)
  atrMultSL: {
    trend: 2.5,
    "mean-revert": 1.5,
    breakout: 1.2,
    unknown: 2.0,
  },
  // TP = SL × rewardToRisk (수수료 차감 전 raw RR)
  rewardToRisk: {
    trend: 3.0,          // 절대수익형: 승률 희생하고 기대값 키움
    "mean-revert": 1.8,
    breakout: 2.5,
    unknown: 2.0,
  },

  // 수수료 + 슬리피지 가정 (왕복 기준, 명목가 대비)
  // Binance USDⓈ-M Futures taker 0.04% × 2 = 0.08%.
  // 슬리피지 0.025% × 2 = 0.05%. 합 0.13%.
  roundTripFeePct: 0.0008,       // 0.08% taker
  roundTripSlippagePct: 0.0005,  // 0.05% slippage
  // TP·SL 가격이 커버해야 할 "고정비용 거리" = 0.13% + 약간의 버퍼
  minNetRR: 1.8,                 // 비용 차감 후 실질 RR 하한

  // 레버리지 — Option A 는 2~5x (청산 사고 위험 축소)
  minLeverage: 2,
  maxLeverage: 5,
  leverageBias: {
    trend: 1,
    breakout: 0,
    "mean-revert": -1,
    unknown: 0,
  },

  // 청산거리 안전 버퍼
  //  SL 거리 ≤ 청산거리 × liqSafetyRatio 강제.
  //  Isolated 기준 청산거리 ≈ (1 / leverage) × (1 - maintMargin).
  //  Binance 유지증거금 ~0.4~1.0% 가정 → 단순화: 1/lev × 0.9
  liqSafetyRatio: 0.7,

  // minNotional 여유
  minNotionalSafety: 1.05,
  absoluteMaxNotional: 500,

  // ★ 작은 계정 구제: notional 이 minNotional×safety 미만일 때
  //   qty 를 bump 하되, 그 결과의 실효 손실(effLossPct × notional) 이
  //   원래 riskAmount 의 minNotionalBumpCap 배수 이내면 허용.
  //   초과하면 기존대로 reject.
  //   Phase 1 ($100 계정) 에서 XRP/DOGE 같은 저가 알트 시그널이 전부
  //   reject 되는 문제를 해결하면서 리스크 상한은 유지.
  minNotionalBumpCap: 1.5,

  // 시간 손절 (engine 외부에서 참조)
  maxHoldMs: 48 * 60 * 60 * 1000,
};

function roundDownStep(x, step) { if (!step || step <= 0) return x; return Math.floor(x / step) * step; }
function round(x, decimals)     { const f = Math.pow(10, decimals || 0); return Math.round(x * f) / f; }
function clamp(x, lo, hi)       { return Math.max(lo, Math.min(hi, x)); }

export function pickLeverage(confidence, family, cfg = RISK_CONFIG) {
  const base = cfg.minLeverage + (cfg.maxLeverage - cfg.minLeverage) * clamp((confidence - 0.5) / 0.5, 0, 1);
  const bias = cfg.leverageBias[family] || 0;
  return Math.round(clamp(base + bias, cfg.minLeverage, cfg.maxLeverage));
}

export function stopDistancePct({ price, atr, family, cfg = RISK_CONFIG }) {
  if (!atr || !price || atr <= 0 || price <= 0) return null;
  const mult = cfg.atrMultSL[family] || cfg.atrMultSL.unknown;
  return (atr * mult) / price;
}

/** Isolated 포지션의 대략적 청산거리 비율 (보수적 가정). */
export function approxLiquidationPct(leverage) {
  if (!leverage || leverage <= 1) return 0.99;
  return (1 / leverage) * 0.9; // 유지증거금 ~10% 흡수
}

/** 상관 그룹에서 이미 오픈된 심볼과 같은 그룹인지 */
export function inSameCorrelationGroup(symbol, openSymbols, cfg = RISK_CONFIG) {
  const groups = cfg.correlationGroups || [];
  for (const g of groups) {
    if (g.includes(symbol) && openSymbols.some((s) => g.includes(s) && s !== symbol)) return true;
  }
  return false;
}

/**
 * 핵심: 신호 + 계정 상태 → 실제 주문 파라미터.
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

  // 1) ATR → raw stop 거리
  const stopDistPct = stopDistancePct({ price, atr, family: signal.strategyFamily, cfg });
  if (!stopDistPct || stopDistPct <= 0) {
    return { ok: false, reason: "ATR 없음 또는 stop 거리 산출 불가", log };
  }
  push(`rawStopDistPct=${(stopDistPct * 100).toFixed(3)}%`);

  // 2) 비용 거리 (수수료 + 슬리피지, 왕복)
  const costPct = (cfg.roundTripFeePct || 0) + (cfg.roundTripSlippagePct || 0);
  push(`costPct=${(costPct * 100).toFixed(3)}% (fee+slip roundtrip)`);
  if (stopDistPct <= costPct * 1.5) {
    return { ok: false, reason: `stopDist ${(stopDistPct * 100).toFixed(2)}% too tight vs costs ${(costPct * 100).toFixed(2)}%`, log };
  }

  // 3) 리스크 금액 (SL 까지 맞았을 때 잃는 순손실 한도)
  const riskAmount = equity * cfg.riskPerTradePct;
  push(`riskAmount=$${riskAmount.toFixed(3)} (${(cfg.riskPerTradePct * 100).toFixed(2)}% of $${equity.toFixed(2)})`);

  // 4) 효과적 loss 거리 = stopDist + cost (수수료 내기 위해 실제로는 더 많이 움직여야 같은 손실)
  const effLossPct = stopDistPct + costPct;
  let notional = riskAmount / effLossPct;
  push(`effLossPct=${(effLossPct * 100).toFixed(3)}% → rawNotional=$${notional.toFixed(2)}`);

  if (notional > cfg.absoluteMaxNotional) {
    notional = cfg.absoluteMaxNotional;
    push(`capped by absoluteMaxNotional=$${cfg.absoluteMaxNotional}`);
  }

  // 5) 레버리지
  const leverage = pickLeverage(signal.confidence, signal.strategyFamily, cfg);
  push(`leverage=${leverage}x (conf=${signal.confidence}, fam=${signal.strategyFamily})`);

  // 6) ★ liquidation 버퍼 검증 — SL 이 청산보다 먼저 와야 함
  const liqPct = approxLiquidationPct(leverage);
  const safeSL = liqPct * (cfg.liqSafetyRatio || 0.7);
  if (stopDistPct > safeSL) {
    push(`SL ${(stopDistPct * 100).toFixed(2)}% > safe ${(safeSL * 100).toFixed(2)}% — leverage 낮춰야 함`);
    // 자동 조정: 필요한 최소 레버리지 계산
    const needLev = Math.ceil(1 / (stopDistPct / (cfg.liqSafetyRatio || 0.7) / 0.9));
    const adjLev = clamp(needLev, cfg.minLeverage, cfg.maxLeverage);
    if (adjLev >= leverage) {
      return { ok: false, reason: `SL ${(stopDistPct * 100).toFixed(2)}% 가 최대 레버리지에서도 청산거리 초과 — 거부`, log };
    }
    push(`auto-adjust leverage → ${adjLev}x`);
  }
  const finalLev = (() => {
    if (stopDistPct > safeSL) {
      // reconcile 이 위에서 이미 return 했으면 여긴 안 옴
      const needLev = Math.ceil(1 / (stopDistPct / (cfg.liqSafetyRatio || 0.7) / 0.9));
      return clamp(needLev, cfg.minLeverage, cfg.maxLeverage);
    }
    return leverage;
  })();

  // 7) 증거금 상한
  const margin0 = notional / finalLev;
  const maxMargin = equity * cfg.maxMarginPct;
  if (margin0 > maxMargin) {
    notional = maxMargin * finalLev;
    push(`margin capped: margin=$${margin0.toFixed(2)} > max=$${maxMargin.toFixed(2)} → notional=$${notional.toFixed(2)}`);
  }

  // 8) sizeHint
  const sizeHint = clamp(signal.sizeHint ?? 0.5, 0.1, 1.0);
  notional = notional * sizeHint;
  push(`sizeHint=${sizeHint} → notional=$${notional.toFixed(2)}`);

  // 9) minNotional — 작은 계정 bump-to-min 로직
  const minN = filter.minNotional || 0;
  const minNSafe = minN * (cfg.minNotionalSafety || 1.05);
  let bumped = false;
  if (notional < minNSafe) {
    // bump 후 실효 손실이 원래 riskAmount 의 bumpCap 배수 이내면 허용
    const bumpCap = cfg.minNotionalBumpCap || 1.5;
    const bumpedLoss = minNSafe * effLossPct;
    const riskRatio = bumpedLoss / riskAmount;
    if (riskRatio <= bumpCap) {
      push(`bump-to-min: $${notional.toFixed(2)} → $${minNSafe.toFixed(2)} (risk ${riskRatio.toFixed(2)}x ≤ cap ${bumpCap}x)`);
      notional = minNSafe;
      bumped = true;
    } else {
      return {
        ok: false,
        reason: `notional $${notional.toFixed(2)} < minNotional×safety $${minNSafe.toFixed(2)}; bump risk ${riskRatio.toFixed(2)}x > cap ${bumpCap}x`,
        log,
      };
    }
  }

  // 10) quantity
  const rawQty = notional / price;
  const qty = roundDownStep(rawQty, filter.stepSize || 0);
  if (qty < (filter.minQty || 0)) {
    return { ok: false, reason: `qty ${qty} < minQty ${filter.minQty}`, log };
  }
  const finalNotional = qty * price;
  if (finalNotional < minN) {
    return { ok: false, reason: `finalNotional ${finalNotional.toFixed(2)} < minNotional ${minN}`, log };
  }

  // 11) SL / TP 가격 — TP 는 "비용 차감 후 순 RR" 기준으로 역산
  const slPct = stopDistPct;
  const rawRR = cfg.rewardToRisk[signal.strategyFamily] || cfg.rewardToRisk.unknown;
  // 순 RR: (tpPct - costPct) / (slPct + costPct) ≥ minNetRR 가 되도록 tpPct 강제
  const requiredTpPct = Math.max(
    slPct * rawRR,
    (cfg.minNetRR || 1.8) * (slPct + costPct) + costPct,
  );
  const tpPct = requiredTpPct;
  const netRR = (tpPct - costPct) / (slPct + costPct);
  push(`rawRR=${rawRR} tpPct=${(tpPct * 100).toFixed(3)}% netRR=${netRR.toFixed(2)}`);
  if (netRR < (cfg.minNetRR || 1.8)) {
    return { ok: false, reason: `net RR ${netRR.toFixed(2)} < min ${cfg.minNetRR}`, log };
  }

  const slPrice = signal.side === "LONG" ? price * (1 - slPct) : price * (1 + slPct);
  const tpPrice = signal.side === "LONG" ? price * (1 + tpPct) : price * (1 - tpPct);

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
    marginRequired: finalNotional / finalLev,
    leverage: finalLev,
    slPrice: roundPrice(slPrice),
    tpPrice: roundPrice(tpPrice),
    slPct,
    tpPct,
    costPct,
    effectiveRR: netRR,
    riskAmount,
    expectedNetWin: finalNotional * (tpPct - costPct),
    expectedNetLoss: finalNotional * (slPct + costPct),
    strategyFamily: signal.strategyFamily,
    confidence: signal.confidence,
    sizeHint,
    liqPct,
    safeSL,
    maxHoldMs: cfg.maxHoldMs,
    bumpedToMin: bumped,
    log,
  };
  return { ok: true, plan };
}

export default { planTrade, pickLeverage, stopDistancePct, approxLiquidationPct, inSameCorrelationGroup, RISK_CONFIG };
