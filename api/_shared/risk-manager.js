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
  // 거래당 위험 한도 — 자본 대비 % (SL 맞을 때 잃는 돈).
  // ★ 2026-05-08 (2차): 4% → 10% 상향 (대표님 추가 지시 — "거래당 최대 -40%
  //   까지 가능"). 다만 -40% 는 너무 공격적이라 안전 마진 두고 10% 로 절충.
  //   - 자본 $325 × 10% = $32.5 위험 (이전 $13)
  //   - SL 거리 5% 가정 시 notional ≈ $650, absoluteMaxNotional 300 에서 잘림
  //   - SL 거리 더 작은 케이스 (2~3%) 면 자연스럽게 notional 한도 hit
  //   - 매우 보수적으로 돌리고 싶을 땐 0.02~0.04 로 다시 낮출 것.
  riskPerTradePct: 0.10, // 10% (이전 4%)

  // 한 포지션 최대 증거금 비중 — 자본 대비 마진 상한 (lev 별 차이 흡수)
  // 자본 $325 × 0.5 = $163 마진 상한 (8x lev 면 노출 $1,300 → 한도 300 에서 잘림)
  maxMarginPct: 0.5,

  // ★ 2026-05-09 대표님 지시 — 동시 보유 포지션 상한 해제 (10 = 사실상 무한)
  //   기존 2개 제한이 다양한 시그널 진입 막아왔음. 거래당 노출 $300 cap 으로
  //   총 노출 자체는 자연 제한 (자본 $325 × 마진율 50% = $163 마진 = 약 5포지션
  //   동시 = 노출 ~$1,500). 위험 감내 의지 반영.
  maxConcurrentPositions: 10,

  // ★ 2026-05-09 (audit C1): 합산 노셔널 가드 추가.
  //   동시 10포지션 × 노셔널 $300 = 잠재 노출 $3,000 (자본 $370 × 8.1배).
  //   maxMarginPct 0.5 는 단일 포지션 한도라 합산 제한 없음 → 자본 8배 노출 가능.
  //   잠재 ROI -40% × 10포지션 = 손실 $1,200 (자본 3.2배) → 마진콜 위험.
  //   현재: 모든 오픈 포지션의 합산 노셔널이 자본의 maxTotalNotionalRatio 배 초과 시 reject.
  // ★ 2026-05-12: 노셔널 가드 사실상 제거. 1.5 → 3.0 → 10.0.
  //   자본 $519 + 거래당 노셔널 $500~700 (riskPerTradePct 10%) + ADAUSDT $1000 보유 →
  //   합산 $1500+ 로 한도 자주 초과. 거래 다양화 막힘.
  //   진짜 안전망은 maxTotalMarginRatio 0.6 (자본의 60% 마진).
  //   노셔널 가드는 10x 늘려 사실상 비활성 — 마진 가드 의지.
  maxTotalNotionalRatio: 10.0,  // 사실상 무제한 (마진 가드 0.6 이 실 안전망)
  // 합산 마진 노출 cap (위 노셔널과 별개로 마진 합산도 제한)
  // ★ 2026-05-12 hotfix: 0.6 → 0.85 완화 (대표 보고: 자본 $518 중 $276 사용했는데 진입 차단됨).
  //   $518 × 0.60 = $311 한도 vs 현재 $276 → 추가 $35 만 가능 → 사실상 새 진입 0건.
  //   $518 × 0.85 = $440 한도 → 추가 $164 까지 가능 → 거래 다양화 정상화.
  //   isolated margin 모드 가정 (cross 면 100% 까지도 안전). env ZEPTA_MAX_TOTAL_MARGIN_RATIO 로 조정 가능.
  maxTotalMarginRatio: 0.85,    // 자본의 85% 가 마진 묶이면 추가 진입 차단

  // ★ 2026-05-12 대표 지시: 같은 심볼 averaging 자유화.
  //   pyramidMinR — checkPyramidGuard 가 averaging 차단 시 사용할 R 임계값.
  //     기존 하드코딩 1.0R (피라미딩만 허용, 물타기 차단) 너무 엄격해 강한 시그널
  //     + 약간 손해 상태에서도 추가 진입 막힘.
  //     기본 0.0 = averaging 완전 자유 (대표 요청).
  //     1.0 으로 옛 보수 동작 복원 가능 (env ZEPTA_PYRAMID_MIN_R).
  //   sameSymbolMaxNotionalPct — pyramid guard 완화의 대가로 추가한 안전망.
  //     한 심볼에 합산 노시오날이 자본의 N% 초과면 추가 진입 차단 (마틴게일 폭주 방지).
  //     기본 0.30 = 자본의 30%.
  //     env ZEPTA_SAME_SYMBOL_MAX_PCT 로 조정.
  pyramidMinR: 0.0,
  sameSymbolMaxNotionalPct: 0.30,

  // 심볼 간 상관 그룹 — 같은 그룹에서 동시 2개 금지
  correlationGroups: [
    ["BTCUSDT", "ETHUSDT", "BNBUSDT"],              // 메가캡
    ["SOLUSDT", "AVAXUSDT", "ADAUSDT", "DOTUSDT"],  // L1
    ["DOGEUSDT", "XRPUSDT"],                        // 레거시 밈/페이먼트
    ["MATICUSDT", "LINKUSDT"],                      // 인프라
  ],

  // 전략 family 별 ATR × 배수 (SL 거리)
  // ★ 2026-05-03 데이터 기반 조정 — shadow 537건 분석 결과 SL 8.5% 가 너무 멀어
  // 전체 손익이 마이너스. SL 을 절반(4% 부근)으로 줄여 작은 이익 506건이 큰
  // 손실 31건에 잡아먹히지 않도록.
  atrMultSL: {
    trend: 1.3,          // 2.5 → 1.3 (큰 추세장 모멘텀 봇 위험 축소)
    "mean-revert": 0.8,  // 1.5 → 0.8
    breakout: 0.7,       // 1.2 → 0.7
    unknown: 1.0,        // 2.0 → 1.0 (SL 거리 절반)
  },
  // TP = SL × rewardToRisk (수수료 차감 전 raw RR)
  // ★ TP 도 같이 조정 — minNetRR 1.8 유지하려면 RR 자체는 비슷하게.
  // 실제 효과: SL 작아지면 TP 도 작아져 작은 변동에서 수익 마감 빈도 ↑
  rewardToRisk: {
    trend: 2.5,
    "mean-revert": 1.8,
    breakout: 2.0,
    unknown: 2.0,
  },

  // 수수료 + 슬리피지 가정 (왕복 기준, 명목가 대비)
  // Binance USDⓈ-M Futures taker 0.04% × 2 = 0.08%.
  // 슬리피지 0.025% × 2 = 0.05%. 합 0.13%.
  roundTripFeePct: 0.0008,       // 0.08% taker
  roundTripSlippagePct: 0.0005,  // 0.05% slippage
  // TP·SL 가격이 커버해야 할 "고정비용 거리" = 0.13% + 약간의 버퍼
  minNetRR: 1.8,                 // 비용 차감 후 실질 RR 하한

  // 레버리지 — 2026-05-09 대표님 지시로 고정 10x 로 변경.
  // 이전 (3~10x 가변, conf 기반) 방식에선 conf 0.7 시그널이 약 6x 로 진입 →
  // 사용자 의지 (항상 10x) 와 불일치. min=max=10 으로 통일.
  // ROI -40% cap 으로 SL 거리는 4% 로 자동 제한됨 (10x × 4% = ROI 40%).
  // ★ audit M3/N4: leverageBias 객체 + 가변 lev 로직 모두 제거 (dead code).
  //   복원 시 minLeverage 와 maxLeverage 를 다르게 두면 됨.
  minLeverage: 10,
  maxLeverage: 10,

  // 청산거리 안전 버퍼
  //  SL 거리 ≤ 청산거리 × liqSafetyRatio 강제.
  //  Isolated 기준 청산거리 ≈ (1 / leverage) × (1 - maintMargin).
  //  Binance 유지증거금 ~0.4~1.0% 가정 → 단순화: 1/lev × 0.9
  liqSafetyRatio: 0.7,

  // ★ 거래당 ROI 손실 한도 (마진 대비 %, Binance UI 표시 기준).
  //   대표님 지시 (2026-05-08): "거래당 ROI -40% 까지 가능, 10배 기준".
  //   가격 변동 % × leverage = ROI %. 즉 SL 거리 = maxRoiLossPct / leverage.
  //   - 10x → 가격 -4% 까지 SL 거리 허용
  //   - 5x → 가격 -8%
  //   - 3x → 가격 -13.3%
  //   ATR 기반 stopDistPct 가 이 한도를 초과하면 cap. 한도 안이면 그대로 사용.
  maxRoiLossPct: 0.40,

  // minNotional 여유
  minNotionalSafety: 1.05,
  // 절대 노출 상한 — riskPct/leverage 조합과 무관하게 강제. 대표님 요청
  // "한 거래에 최대 $300" 반영.
  // ★ 2026-05-11 의미 정정: 원래 의도가 "한 거래에 들어가는 실제 돈 $300"
  //   (= 마진) 였는데 변수명이 absoluteMaxNotional 이라 혼선. 새 변수로 분리.
  //   - absoluteMaxMarginUsd: 마진(실 위험 자본) 상한. 이게 진짜 사용자 의도.
  //   - absoluteMaxNotional: 레거시. 하위 호환 위해 보존만 (사용 안 함).
  // ★ 2026-05-12 자본 비례 자동 조정 (대표 지시):
  //   이전: absoluteMaxMarginUsd $300, minMarginUsd $50 절대값 → 자본 변경 시 수동 조정 필요.
  //   이후: 자본 비례 + floor/ceiling. 자본 $500 부터 $50,000 까지 자동 적용.
  //   ┌────────────────┬──────────────┬──────────────┐
  //   │ 자본              │ minMargin     │ maxMargin     │
  //   ├────────────────┼──────────────┼──────────────┤
  //   │ $500            │ $25 (5%)      │ $100 (20%)    │
  //   │ $5,000          │ $250 (5%)     │ $1,000 (20%)  │
  //   │ $50,000         │ $2,500 (5%)   │ $2,000 (ceil) │
  //   └────────────────┴──────────────┴──────────────┘
  absoluteMaxMarginPct: 0.20,        // 자본의 20% (한 거래 마진 최대)
  absoluteMaxMarginFloor: 50,        // 최소 $50 (작은 자본 구제)
  absoluteMaxMarginCeiling: 2000,    // 최대 $2,000 (큰 자본도 슬리피지 위험 차단)
  minMarginPct: 0.05,                // 자본의 5% (포지션 최소 마진)
  minMarginFloor: 20,                // 최소 $20 (거래소 minNotional 안전)
  // ★ deprecated (자본 비례 시 무시) — 하위 호환 보존만
  absoluteMaxMarginUsd: 300,
  absoluteMaxNotional: 300,
  minMarginUsd: 50,

  // ★ 작은 계정 구제: notional 이 minNotional×safety 미만일 때
  //   qty 를 bump 하되, 그 결과의 실효 손실(effLossPct × notional) 이
  //   원래 riskAmount 의 minNotionalBumpCap 배수 이내면 허용.
  //   초과하면 기존대로 reject.
  //   Phase 1 ($100 계정) 에서 XRP/DOGE 같은 저가 알트 시그널이 전부
  //   reject 되는 문제를 해결하면서 리스크 상한은 유지.
  minNotionalBumpCap: 1.5,

  // ★ 시간 손절 — 2026-05-08 대표님 지시로 비활성화.
  //   "그런 제한을 뭐하러 둬" 의지 반영. TP/SL/안전잠금 만으로 청산 결정.
  //   maxHoldMs 는 plan 에 보존 (참조용) 하지만 매우 크게 두어 자연 발동 안 함.
  //   evaluateTimeStop 도 cfg.timeStops 비어있으면 신호 안 줌.
  maxHoldMs: 30 * 24 * 60 * 60 * 1000, // 30일 (사실상 무한 — TP/SL 도달이 더 빠름)
  timeStops: [], // 단계적 시간 손절 제거 (이전: 6h/12h/24h)

  // ── 트레일링 스탑 ──
  // 포지션이 +activationR 이상으로 가면, 그때부터 SL 을 trailDistanceR 만큼
  // 떨어진 위치로 끌어올린다. (=Binance SL 주문을 cancel & re-create)
  // 한 번 올린 SL 은 절대 내리지 않음 (one-way ratchet).
  trailingStop: {
    enabled: true,
    activationR: 1.0,    // +1R 도달 시 활성화
    trailDistanceR: 0.5, // 최고점에서 0.5R 만큼 양보 (=lock 0.5R 이상)
    breakEvenAtR: 0.7,   // +0.7R 시 일단 breakeven 으로 SL 이동
  },

  // ── 부분 익절 (Partial TP) ──
  // 활성화 시 진입가에서 +tp1R 도달하면 포지션의 tp1FractionPct 를 시장가 청산하고
  // 잔여분의 SL 을 breakeven 으로 이동.
  partialTP: {
    enabled: false,      // Phase 1 default OFF — bracket atomic 보존 우선
    tp1R: 1.5,
    tp1FractionPct: 0.5,
  },
};

function roundDownStep(x, step) { if (!step || step <= 0) return x; return Math.floor(x / step) * step; }
function round(x, decimals)     { const f = Math.pow(10, decimals || 0); return Math.round(x * f) / f; }
function clamp(x, lo, hi)       { return Math.max(lo, Math.min(hi, x)); }

export function pickLeverage(confidence, family, cfg = RISK_CONFIG) {
  // ★ 2026-05-09 audit M3: min === max 일 때 가변 분기는 dead code.
  //   고정 lev 모드면 즉시 리턴 (옛 confidence/bias 분기 제거).
  if (cfg.minLeverage === cfg.maxLeverage) return cfg.minLeverage;
  const base = cfg.minLeverage + (cfg.maxLeverage - cfg.minLeverage) * clamp((confidence - 0.5) / 0.5, 0, 1);
  const bias = (cfg.leverageBias && cfg.leverageBias[family]) || 0;
  return Math.round(clamp(base + bias, cfg.minLeverage, cfg.maxLeverage));
}

/**
 * ★ 2026-05-09 audit C1: 합산 노출 가드.
 * 새 진입 후보 plan 이 기존 오픈 포지션과 합쳐 자본 한도(maxTotalNotionalRatio,
 * maxTotalMarginRatio) 초과인지 검사.
 *
 * @param {object} args
 * @param {object} args.plan          새 진입 plan (planTrade 결과)
 * @param {Array}  args.openPositions Binance positionRisk 배열
 *                                    [{ symbol, positionAmt, entryPrice, leverage, ... }]
 * @param {number} args.equity        자본 (USDT)
 * @param {object} [args.cfg=RISK_CONFIG]
 * @returns {{ ok: boolean, reason?: string, sumNotional, sumMargin, log: string[] }}
 */
export function checkAggregateExposure({ plan, openPositions, equity, cfg = RISK_CONFIG }) {
  const log = [];
  const push = (m) => log.push(m);
  if (!plan || !plan.notional) return { ok: false, reason: "invalid plan", log };
  if (!(equity > 0)) return { ok: false, reason: "equity <= 0", log };

  // 오픈 포지션의 노셔널/마진 합산 (자기 심볼 averaging 도 같은 방향이면 합산)
  let sumNotional = 0;
  let sumMargin = 0;
  for (const p of openPositions || []) {
    const amt = Math.abs(parseFloat(p.positionAmt || 0));
    if (amt === 0) continue;
    const ep = parseFloat(p.entryPrice || p.markPrice || 0);
    const lv = parseFloat(p.leverage || cfg.maxLeverage || 10);
    const notional = amt * ep;
    sumNotional += notional;
    sumMargin += notional / Math.max(lv, 1);
  }
  push(`기존 합산 noSi=$${sumNotional.toFixed(2)} margin=$${sumMargin.toFixed(2)}`);

  const newSumNotional = sumNotional + plan.notional;
  const newSumMargin = sumMargin + (plan.marginRequired || (plan.notional / (plan.leverage || 10)));
  const notionalCap = equity * (cfg.maxTotalNotionalRatio || 1.5);
  // env override 우선 — 런타임 조정 가능 (대표가 위험 식별 시 즉시 0.6 로 strict 복원 가능)
  const marginRatio = Number(process.env.ZEPTA_MAX_TOTAL_MARGIN_RATIO) || cfg.maxTotalMarginRatio || 0.85;
  const marginCap = equity * marginRatio;
  push(`예정 합산 noSi=$${newSumNotional.toFixed(2)} margin=$${newSumMargin.toFixed(2)} (cap noSi=$${notionalCap.toFixed(2)}, margin=$${marginCap.toFixed(2)})`);

  if (newSumNotional > notionalCap) {
    return {
      ok: false,
      reason: `합산 노셔널 $${newSumNotional.toFixed(2)} > 한도 $${notionalCap.toFixed(2)} (${((cfg.maxTotalNotionalRatio||1.5)*100).toFixed(0)}% of equity)`,
      sumNotional, sumMargin, log,
    };
  }
  if (newSumMargin > marginCap) {
    return {
      ok: false,
      reason: `합산 마진 $${newSumMargin.toFixed(2)} > 한도 $${marginCap.toFixed(2)} (${(marginRatio*100).toFixed(0)}% of equity)`,
      sumNotional, sumMargin, log,
    };
  }
  return { ok: true, sumNotional, sumMargin, log };
}

/**
 * ★ 2026-05-09 audit M1: 같은 심볼 averaging 가드.
 * ★ 2026-05-12: 대표 지시로 임계값 동적화 (cfg.pyramidMinR / env ZEPTA_PYRAMID_MIN_R).
 *   - 기본 0.0R → averaging 자유. "강한 시그널이면 약간 손해 중에도 추가 진입" 가능.
 *   - 1.0R 옛 동작 복원: cfg.pyramidMinR = 1.0 또는 env ZEPTA_PYRAMID_MIN_R=1.0.
 *   - 마틴게일 폭주는 별도 sameSymbolMaxNotionalPct 가드로 차단 (checkSameSymbolNotional).
 *
 * @param {object} args
 * @param {object} args.plan          새 진입 plan
 * @param {object} args.existingPos   같은 심볼 기존 포지션 (Binance positionRisk 한 항목)
 * @param {object} [args.cfg=RISK_CONFIG]
 * @returns {{ ok: boolean, reason?: string, currentR?: number }}
 */
export function checkPyramidGuard({ plan, existingPos, cfg = RISK_CONFIG }) {
  if (!existingPos || Math.abs(parseFloat(existingPos.positionAmt || 0)) === 0) return { ok: true };
  // 방향 다르면 OK (long → short 헤지 또는 익절 같은 다른 의도)
  const existingSide = parseFloat(existingPos.positionAmt) > 0 ? "LONG" : "SHORT";
  if (existingSide !== plan.side) return { ok: true };
  // 같은 방향 — 현재 R 계산
  const entryPrice = parseFloat(existingPos.entryPrice || 0);
  const markPrice = parseFloat(existingPos.markPrice || plan.entryPrice || 0);
  if (!entryPrice || !markPrice || !plan.slPct) return { ok: true };
  const moveFrac = plan.side === "LONG"
    ? (markPrice - entryPrice) / entryPrice
    : (entryPrice - markPrice) / entryPrice;
  const currentR = moveFrac / plan.slPct;

  // ★ 동적 임계값: env ZEPTA_PYRAMID_MIN_R 우선 → cfg.pyramidMinR → fallback 0.0
  const envMinR = Number(process.env.ZEPTA_PYRAMID_MIN_R);
  const minR = Number.isFinite(envMinR)
    ? envMinR
    : (typeof cfg.pyramidMinR === "number" ? cfg.pyramidMinR : 0.0);

  if (currentR < minR) {
    return {
      ok: false,
      reason: `같은 ${plan.side} averaging 차단 — 현재 R=${currentR.toFixed(2)} < ${minR.toFixed(2)}R (피라미딩 가능 라인). 물타기 위험.`,
      currentR,
    };
  }
  return { ok: true, currentR };
}

/**
 * ★ 2026-05-12 신규: 같은 심볼 합산 노시오날 cap 가드 (마틴게일 폭주 방지).
 *
 * checkPyramidGuard 가 averaging 자유로 풀린 만큼 (1.0R → 0.0R) 한 심볼에
 * 끝없이 물타기 들어가는 것을 막는 별도 안전망.
 *
 * 기존 포지션 노시오날 + 새 plan 노시오날 합 > 자본 × sameSymbolMaxNotionalPct
 * 이면 차단. checkAggregateExposure (전체 노시오날) 와 별개로 동작.
 *
 * @param {object} args
 * @param {object} args.plan          새 진입 plan
 * @param {object} args.existingPos   같은 심볼 기존 포지션 (Binance positionRisk 한 항목)
 * @param {number} args.equity        자본 (USDT)
 * @param {object} [args.cfg=RISK_CONFIG]
 * @returns {{ ok: boolean, reason?: string, sameSymbolNotional?: number, capUsd?: number }}
 */
export function checkSameSymbolNotional({ plan, existingPos, equity, cfg = RISK_CONFIG }) {
  if (!plan || !plan.notional) return { ok: true };
  if (!(equity > 0)) return { ok: true };
  if (!existingPos) return { ok: true };
  const amt = Math.abs(parseFloat(existingPos.positionAmt || 0));
  if (amt === 0) return { ok: true };

  const ep = parseFloat(existingPos.entryPrice || existingPos.markPrice || 0);
  if (!ep) return { ok: true };
  const existingNotional = amt * ep;
  const newTotalNotional = existingNotional + plan.notional;

  // env override 우선
  const envPct = Number(process.env.ZEPTA_SAME_SYMBOL_MAX_PCT);
  const capPct = Number.isFinite(envPct)
    ? envPct
    : (typeof cfg.sameSymbolMaxNotionalPct === "number" ? cfg.sameSymbolMaxNotionalPct : 0.30);
  const capUsd = equity * capPct;

  if (newTotalNotional > capUsd) {
    const usedPct = (newTotalNotional / equity) * 100;
    const capPctDisp = capPct * 100;
    return {
      ok: false,
      reason: `같은 심볼 합산 노시오날 ${usedPct.toFixed(1)}% > cap ${capPctDisp.toFixed(1)}% — 추가 진입 보류 (기존 $${existingNotional.toFixed(2)} + 신규 $${plan.notional.toFixed(2)} = $${newTotalNotional.toFixed(2)} > $${capUsd.toFixed(2)})`,
      sameSymbolNotional: newTotalNotional,
      capUsd,
    };
  }
  return { ok: true, sameSymbolNotional: newTotalNotional, capUsd };
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
  let stopDistPct = stopDistancePct({ price, atr, family: signal.strategyFamily, cfg });
  if (!stopDistPct || stopDistPct <= 0) {
    return { ok: false, reason: "ATR 없음 또는 stop 거리 산출 불가", log };
  }
  push(`rawStopDistPct=${(stopDistPct * 100).toFixed(3)}%`);

  // ★ 1-1) leverage 미리 계산 후 ROI 한도 cap.
  //   대표님 지시: 거래당 ROI -40% 까지 OK (10x 기준 가격 -4%).
  //   ATR 기반 stopDistPct 가 ROI 한도를 초과하면 cap.
  const previewLev = pickLeverage(signal.confidence, signal.strategyFamily, cfg);
  const maxRoiLossPct = cfg.maxRoiLossPct || 0.40;
  const slCapByRoi = maxRoiLossPct / previewLev;
  if (stopDistPct > slCapByRoi) {
    push(`stopDistPct ${(stopDistPct * 100).toFixed(2)}% > ROI cap ${(slCapByRoi * 100).toFixed(2)}% (lev ${previewLev}x × maxROI ${(maxRoiLossPct * 100).toFixed(0)}%) → cap`);
    stopDistPct = slCapByRoi;
  }

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

  // ★ 2026-05-11 의미 정정: 변수명은 Notional 이지만 실 cap 은 마진(실 위험 자본).
  //   사용자 의도 "거래당 $300 들어가도 됨" = 마진 $300 = 노셔널 $3000 (10x).
  //   이 단계에선 leverage 미정이라 사용자 maxLeverage 기준으로 notional cap 산출.
  const previewLevForCap = cfg.maxLeverage || 10;
  // ★ 2026-05-12: 자본 비례 maxMargin 산출 (자본 변경 시 자동 조정).
  //   기존 absoluteMaxMarginUsd 절대값 → equity × absoluteMaxMarginPct + floor/ceiling.
  const effMaxMargin = clamp(
    equity * (cfg.absoluteMaxMarginPct || 0.20),
    cfg.absoluteMaxMarginFloor || 50,
    cfg.absoluteMaxMarginCeiling || 2000,
  );
  const maxNotionalCap = effMaxMargin * previewLevForCap;
  if (notional > maxNotionalCap) {
    notional = maxNotionalCap;
    push(`capped by effMaxMargin=$${effMaxMargin.toFixed(0)} (equity ${(cfg.absoluteMaxMarginPct*100).toFixed(0)}%) × lev ${previewLevForCap} = noSi $${maxNotionalCap.toFixed(0)}`);
  }

  // 5) 레버리지
  const leverage = pickLeverage(signal.confidence, signal.strategyFamily, cfg);
  push(`leverage=${leverage}x (conf=${signal.confidence}, fam=${signal.strategyFamily})`);

  // 6) ★ liquidation 버퍼 검증 — SL 이 청산보다 먼저 와야 함
  // ★ 2026-05-09 audit (bonus): IIFE 중복 계산 제거. needLev/adjLev 한 번만 계산.
  const liqPct = approxLiquidationPct(leverage);
  const safeSL = liqPct * (cfg.liqSafetyRatio || 0.7);
  let finalLev = leverage;
  if (stopDistPct > safeSL) {
    push(`SL ${(stopDistPct * 100).toFixed(2)}% > safe ${(safeSL * 100).toFixed(2)}% — leverage 조정 필요`);
    const needLev = Math.ceil(1 / (stopDistPct / (cfg.liqSafetyRatio || 0.7) / 0.9));
    const adjLev = clamp(needLev, cfg.minLeverage, cfg.maxLeverage);
    if (adjLev >= leverage) {
      return { ok: false, reason: `SL ${(stopDistPct * 100).toFixed(2)}% 가 최대 레버리지에서도 청산거리 초과 — 거부`, log };
    }
    push(`auto-adjust leverage → ${adjLev}x`);
    finalLev = adjLev;
  }

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

  // 8.5) ★ 2026-05-12 자본 비례 최소 마진 강제 (이전: absoluteValue $50).
  //   minMargin = max(equity × minMarginPct, minMarginFloor)
  //   자본 $500 → $25, 자본 $5,000 → $250, 자본 $50,000 → $2,500.
  const minMarginUsd = Math.max(
    equity * (cfg.minMarginPct || 0.05),
    cfg.minMarginFloor || 20,
  );
  if (minMarginUsd > 0) {
    const minMarginNotional = minMarginUsd * finalLev;
    if (notional < minMarginNotional) {
      // 자본 가드 — equity × maxMarginPct 안에 들어가면 bump-up 허용
      const maxMargin = equity * (cfg.maxMarginPct || 0.5);
      if (minMarginUsd > maxMargin) {
        return {
          ok: false,
          reason: `최소 마진 $${minMarginUsd} > 자본 한도 $${maxMargin.toFixed(2)} (equity ${(cfg.maxMarginPct*100).toFixed(0)}%) — 자본 부족`,
          log,
        };
      }
      push(`min-margin bump: notional $${notional.toFixed(2)} → $${minMarginNotional.toFixed(2)} (margin $${minMarginUsd} × lev ${finalLev})`);
      notional = minMarginNotional;
    }
  }

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
  let qty = roundDownStep(rawQty, filter.stepSize || 0);
  if (qty < (filter.minQty || 0)) {
    // minQty 미달도 stepSize 한 단위로 보정 시도
    if ((filter.minQty || 0) > 0) {
      qty = filter.minQty;
      push(`qty bumped to minQty ${qty}`);
    } else {
      return { ok: false, reason: `qty ${qty} < minQty ${filter.minQty}`, log };
    }
  }
  let finalNotional = qty * price;
  // ★ stepSize 양자화로 인해 minNotional 을 못 채우면 한 step 위로 올림
  //   (BTC: 0.00145 BTC → 0.001 BTC = $72 < minN $100 케이스 구제)
  if (finalNotional < minN && (filter.stepSize || 0) > 0) {
    const bumpedQty = qty + filter.stepSize;
    const bumpedNotional = bumpedQty * price;
    const bumpedLossUsd = bumpedNotional * effLossPct;
    const stepBumpCap = (cfg.minNotionalBumpCap || 1.5);
    const riskRatio2 = riskAmount > 0 ? bumpedLossUsd / riskAmount : Infinity;
    if (riskRatio2 <= stepBumpCap) {
      push(`stepSize bump: qty ${qty} → ${bumpedQty} ($${finalNotional.toFixed(2)} → $${bumpedNotional.toFixed(2)}, risk ${riskRatio2.toFixed(2)}x ≤ ${stepBumpCap}x)`);
      qty = bumpedQty;
      finalNotional = bumpedNotional;
      bumped = true;
    } else {
      return {
        ok: false,
        reason: `finalNotional ${finalNotional.toFixed(2)} < minNotional ${minN}; step-bump risk ${riskRatio2.toFixed(2)}x > cap ${stepBumpCap}x`,
        log,
      };
    }
  }
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

// ──────────────────────────────────────────────────────────────────
// Position-monitor 헬퍼들
// 모두 순수 함수 — KV/Binance 호출 없음. 호출 측에서 결과만 받아 행동.
// ──────────────────────────────────────────────────────────────────

/**
 * 현재 시점에 시간손절을 발동해야 하는지 판단.
 * @param {object} args
 * @param {number} args.openedAt        포지션 진입 timestamp(ms)
 * @param {number} args.entryPrice
 * @param {number} args.markPrice
 * @param {string} args.side            "LONG" | "SHORT"
 * @param {number} args.slPct           plan.slPct (양수)
 * @param {number} [args.now=Date.now()]
 * @param {object} [args.cfg=RISK_CONFIG]
 * @returns {{ shouldClose: boolean, reason?: string, currentR?: number }}
 */
export function evaluateTimeStop({ openedAt, entryPrice, markPrice, side, slPct, now = Date.now(), cfg = RISK_CONFIG }) {
  // ★ 2026-05-09 audit N5: 시간손절 비활성화 (대표 지시) — RISK_CONFIG.timeStops=[].
  //   maxHoldMs = 30일 (사실상 무한). TP/SL 도달이 더 빠르게 청산.
  //   복원하려면 RISK_CONFIG.timeStops 채우면 됨.
  if (!openedAt || !entryPrice || !markPrice || !slPct) return { shouldClose: false };
  const heldMs = now - openedAt;
  if (heldMs < 0) return { shouldClose: false };

  // 현재 R-multiple = (이익 %) / (slPct)
  const moveFrac = side === "LONG"
    ? (markPrice - entryPrice) / entryPrice
    : (entryPrice - markPrice) / entryPrice;
  const currentR = moveFrac / slPct;

  // 절대 한계
  if (heldMs >= (cfg.maxHoldMs || Infinity)) {
    return { shouldClose: true, reason: `maxHold ${(heldMs / 3600000).toFixed(1)}h reached`, currentR };
  }

  const stops = cfg.timeStops || [];
  // 가장 strict 한 (가장 늦은) 적용 가능 단계 선택
  let triggered = null;
  for (const t of stops) {
    if (heldMs >= t.afterMs && currentR < t.minProfitR) {
      if (!triggered || t.afterMs > triggered.afterMs) triggered = t;
    }
  }
  if (triggered) {
    return {
      shouldClose: true,
      reason: `timeStop ${(triggered.afterMs / 3600000).toFixed(0)}h, R=${currentR.toFixed(2)} < ${triggered.minProfitR}`,
      currentR,
    };
  }
  return { shouldClose: false, currentR };
}

/**
 * 트레일링 스탑 신규 SL 가격 계산.
 * 호출측은 이 결과 newSlPrice 가 기존 SL 보다 유리하면 cancel & re-create.
 * @param {object} args
 * @param {number} args.entryPrice
 * @param {number} args.markPrice            현재가 (또는 highWater 갱신 후의 best price)
 * @param {string} args.side                 "LONG" | "SHORT"
 * @param {number} args.slPct                초기 SL 거리 (양수)
 * @param {number} args.currentSlPrice
 * @param {number} [args.highWater]          이번 포지션의 최고/최저 mark (없으면 markPrice 사용)
 * @param {object} [args.cfg=RISK_CONFIG]
 * @returns {{ shouldUpdate: boolean, newSlPrice?: number, reason?: string, currentR?: number }}
 */
export function evaluateTrailingStop({ entryPrice, markPrice, side, slPct, currentSlPrice, highWater, cfg = RISK_CONFIG }) {
  const ts = cfg.trailingStop || {};
  if (!ts.enabled) return { shouldUpdate: false };
  if (!entryPrice || !markPrice || !slPct) return { shouldUpdate: false };

  const ref = highWater ?? markPrice;
  const moveFrac = side === "LONG"
    ? (ref - entryPrice) / entryPrice
    : (entryPrice - ref) / entryPrice;
  const currentR = moveFrac / slPct;

  // breakeven 단계
  if (currentR >= (ts.breakEvenAtR ?? 0.7) && currentR < (ts.activationR ?? 1.0)) {
    const beSL = entryPrice;
    const isImproved = side === "LONG"
      ? beSL > (currentSlPrice || -Infinity)
      : beSL < (currentSlPrice || Infinity);
    if (isImproved) {
      return { shouldUpdate: true, newSlPrice: beSL, reason: `breakeven @${currentR.toFixed(2)}R`, currentR };
    }
  }

  // 트레일링 활성화
  if (currentR >= (ts.activationR ?? 1.0)) {
    const trailFrac = (ts.trailDistanceR ?? 0.5) * slPct;
    const newSL = side === "LONG"
      ? ref * (1 - trailFrac)
      : ref * (1 + trailFrac);
    const isImproved = side === "LONG"
      ? newSL > (currentSlPrice || -Infinity)
      : newSL < (currentSlPrice || Infinity);
    if (isImproved) {
      return { shouldUpdate: true, newSlPrice: newSL, reason: `trail @${currentR.toFixed(2)}R`, currentR };
    }
  }
  return { shouldUpdate: false, currentR };
}

/**
 * 부분 익절 (TP1) 발동 여부.
 * @returns {{ shouldPartialClose: boolean, fractionPct?: number, reason?: string, currentR?: number }}
 */
export function evaluatePartialTP({ entryPrice, markPrice, side, slPct, cfg = RISK_CONFIG }) {
  const p = cfg.partialTP || {};
  if (!p.enabled) return { shouldPartialClose: false };
  if (!entryPrice || !markPrice || !slPct) return { shouldPartialClose: false };

  const moveFrac = side === "LONG"
    ? (markPrice - entryPrice) / entryPrice
    : (entryPrice - markPrice) / entryPrice;
  const currentR = moveFrac / slPct;

  if (currentR >= (p.tp1R ?? 1.5)) {
    return {
      shouldPartialClose: true,
      fractionPct: p.tp1FractionPct ?? 0.5,
      reason: `TP1 @${currentR.toFixed(2)}R`,
      currentR,
    };
  }
  return { shouldPartialClose: false, currentR };
}

export default {
  planTrade,
  pickLeverage,
  stopDistancePct,
  approxLiquidationPct,
  inSameCorrelationGroup,
  evaluateTimeStop,
  evaluateTrailingStop,
  evaluatePartialTP,
  checkAggregateExposure,
  checkPyramidGuard,
  checkSameSymbolNotional,
  RISK_CONFIG,
};
