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

  // ★ 2026-06-03 (대표 지시): 확신도 기반 동적 사이징.
  //   "애매하면 진입금액 적게, 확실해지면 추가 진입" → riskAmount 를 신호 종합점수에 비례.
  //   점수 minScore 이하 = minFactor(소량), maxScore 이상 = maxFactor(최대). 그 사이 선형.
  //   이것 + 기존 피라미드(pyramidMinR 0=자유, sameSymbolMaxNotionalPct 30%) 결합 →
  //     낮은 확신=소량 진입 → 점수 오르면 추가 진입(스케일인) → 상한(자본30%)까지.
  //   기본 ON. env ZEPTA_CONVICTION_SIZING=0 으로 비활성(고정 사이징 복원).
  convictionSizing: {
    enabled: true,
    minScore: 55,    // 이하면 소량
    maxScore: 88,    // 이상이면 최대
    minFactor: 0.40, // riskAmount × 0.40
    maxFactor: 1.0,  // riskAmount × 1.0
  },

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
  // ★ 2026-05-12 hotfix v2: 0.85 → 0.95 (대표 지시: "자본 한도의 95%까지는 다 사용해서 진입").
  //   $518 × 0.95 = $492 한도 → 자본 거의 풀 사용 → 거래 다양화 극대화.
  //   대신 "무지성 진입 방지" 안전망: utilizationMinConfidence 단계별 quality guard 도입 (아래).
  //   env ZEPTA_MAX_TOTAL_MARGIN_RATIO 로 즉시 strict 복원 가능 (위험 식별 시 0.7 또는 0.85).
  maxTotalMarginRatio: 0.95,    // 자본의 95% 까지 마진 사용 허용

  // ★ 무지성 진입 방지 — 자본 사용률이 높을수록 신규 진입의 시그널 강도 요구 상향.
  //   대표 지시 (2026-05-12): "한도 맞추려고 무지성으로 진입하게 해서는 안되고"
  //   사용률 0.0~0.70: 기본 minConfidence (시그널 자체의 quality 가드만)
  //   사용률 0.70~0.85: confidence >= 0.65 (중강도 시그널)
  //   사용률 0.85~0.95: confidence >= 0.75 (강한 시그널만)
  //   사용률 ≥ 0.95: 무조건 차단
  utilizationMinConfidence: [
    { threshold: 0.70, minConf: 0.65 },
    { threshold: 0.85, minConf: 0.75 },
  ],

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

  // 전략 family 별 ATR × 배수 (SL 거리) — 하위 호환용 (구버전 family 명)
  // ★ 2026-05-03 데이터 기반 조정 — shadow 537건 분석 결과 SL 8.5% 가 너무 멀어
  // 전체 손익이 마이너스. SL 을 절반(4% 부근)으로 줄여 작은 이익 506건이 큰
  // 손실 31건에 잡아먹히지 않도록.
  // ★ 2026-05-17 (QUANT-RES): 신규 dynamicSL 시스템 도입. 이 atrMultSL 은 legacy
  //   path (signal.strategyFamily 가 옛 raw id 일 때) 폴백용. 신규 family-id 는
  //   familySLTPMatrix 사용 (아래).
  atrMultSL: {
    trend: 1.3,          // 2.5 → 1.3 (큰 추세장 모멘텀 봇 위험 축소)
    "mean-revert": 0.8,  // 1.5 → 0.8
    breakout: 0.7,       // 1.2 → 0.7
    unknown: 1.0,        // 2.0 → 1.0 (SL 거리 절반)
  },
  // TP = SL × rewardToRisk (수수료 차감 전 raw RR) — legacy path 용
  rewardToRisk: {
    trend: 2.5,
    "mean-revert": 1.8,
    breakout: 2.0,
    unknown: 2.0,
  },

  // ── 동적 SL/TP 매트릭스 (★ 2026-05-17 QUANT-RES 신규) ──
  //
  // 배경: 대표 지시 "손실 40% / 익절 100% 하드코딩 학습력 떨어진다.
  //       매도 시점은 RSI 등 다양한 로직으로 계속 산출하는 방향".
  //
  // 산출 공식:
  //   atrPct  = ATR / price            (현재 변동성, 소수)
  //   slPct   = atrPct × slAtrMul × regimeSLBoost
  //   tpPct   = atrPct × tpAtrMul × regimeTPBoost
  //   → cap   = clamp(slPct, slFloor, slCeil), clamp(tpPct, tpFloor, tpCeil)
  //
  // family 별 매핑 (신규 strategy id 체계 — alpha-lab RAW_SID_TO_NEW 와 일치):
  familySLTPMatrix: {
    "trend-follow":       { slAtrMul: 2.5, tpAtrMul: 5.0 },  // 추세 — 멀리
    "mean-revert":        { slAtrMul: 1.5, tpAtrMul: 2.0 },  // 회귀 — 짧게
    "breakout":           { slAtrMul: 2.0, tpAtrMul: 4.0 },
    "momentum-rotation":  { slAtrMul: 2.5, tpAtrMul: 4.0 },
    "volatility-arb":     { slAtrMul: 1.2, tpAtrMul: 1.8 },
    "hurst-trend":        { slAtrMul: 2.5, tpAtrMul: 5.0 },
    "defi-momentum":      { slAtrMul: 3.0, tpAtrMul: 6.0 },  // 변동성 큰 자산
    "ensemble":           { slAtrMul: 2.0, tpAtrMul: 4.0 },
    // legacy family 명 (signal.strategyFamily 가 옛 raw 일 때 일치)
    "trend":              { slAtrMul: 2.5, tpAtrMul: 5.0 },
    "momentum":           { slAtrMul: 2.5, tpAtrMul: 4.0 },
    "default":            { slAtrMul: 2.0, tpAtrMul: 3.0 },
  },
  // regime 보정 (BTC 시장 레짐 — strategy-router 가 산출)
  regimeSLTPBoost: {
    trending:       { slBoost: 1.0, tpBoost: 1.3 },  // 추세장 — TP 더 멀리
    mean_reverting: { slBoost: 0.8, tpBoost: 0.8 },  // 박스 — 양쪽 짧게
    transitional:   { slBoost: 0.8, tpBoost: 1.0 },  // 보수 — SL 짧게
    default:        { slBoost: 1.0, tpBoost: 1.0 },
  },
  // 안전 cap — 동적 산출 결과가 비현실적이지 않게 floor/ceiling
  dynamicSLFloorPct: 0.015,  // 최소 1.5% (너무 가까운 SL = costPct 못 이김)
  dynamicSLCeilPct:  0.075,  // 최대 7.5% (2026-06-15 item4 — 대표 "손절라인 보수적으로": 8%→7.5%
                             //   극단 변동 꼬리만 미세 클립. 전형 SL 2.5~6%는 불변. env ZEPTA_SL_CEIL_PCT 로 조정/원복(0.08).)
  dynamicTPFloorPct: 0.02,   // 최소 2% (수수료 0.13% 대비 minNetRR 확보)
  dynamicTPCeilPct:  0.15,   // 최대 15% (장기 추세 봇 한계)
  // 전역 env over-ride (모든 family 일괄 적용)
  //   ZEPTA_SL_ATR_MUL / ZEPTA_TP_ATR_MUL — 수동 over-ride 우선.
  //   미설정 시 위 family + regime 매핑 사용.

  // 수수료 + 슬리피지 가정 (왕복 기준, 명목가 대비)
  // Binance USDⓈ-M Futures taker 0.04% × 2 = 0.08%.
  // 슬리피지 0.025% × 2 = 0.05%. 합 0.13%.
  roundTripFeePct: 0.0008,       // 0.08% taker
  roundTripSlippagePct: 0.0005,  // 0.05% slippage
  // TP·SL 가격이 커버해야 할 "고정비용 거리" = 0.13% + 약간의 버퍼
  minNetRR: 1.8,                 // 비용 차감 후 실질 RR 하한

  // 레버리지 — 2026-05-09 대표님 지시로 고정 10x 로 변경.
  // 이전 (3~10x 가변, conf 기반) 방식에선 conf 0.7 시그널이 약 6x 로 진입 →
  // ★ 2026-06-02 대표 지시 — 안정성 위해 10x → 5x.
  //   효과: (1) 청산거리 ~2배(약 -9% → -18%)로 멀어져 변동성 꼬리에 강제청산 안 당함.
  //   (2) 청산안전 SL 캡이 ~6.3% → ~12.6% 로 풀려, 동적 SL 상한이 dynamicSLCeilPct
  //       8% 로 결정됨 → 전략 ATR SL(보통 2.5~6%)이 안 잘리고 그대로 작동(=대부분 수용).
  //   (3) 거래당 위험(riskPerTradePct 10%)은 SL 거리에 맞춰 노셔널 자동 조절 → 불변.
  //   마진 효율은 낮아짐(같은 노셔널에 마진 2배) → 동시 포지션 수는 자연 감소.
  // ★ audit M3/N4: leverageBias 객체 + 가변 lev 로직 모두 제거 (dead code).
  //   복원/조정 시 minLeverage 와 maxLeverage 를 다르게 두면 신뢰도 비례 가변 lev.
  minLeverage: 5,
  maxLeverage: 5,

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
  // ★ 2026-06-03 (대표 지시 "있는대로 잡으면 되지, 하한은 둘 필요 없잖아"):
  //   상한(absoluteMaxMargin*)은 유지하되, 신규 진입 마진은 실제 가용잔고(availableBalance)
  //   안으로 자동 축소(shrink-to-fit). 가용의 이 비율까지만 사용 → 슬리피지/수수료 버퍼 확보.
  //   인위적 하한은 없음. 진짜 하한은 거래소 minNotional 뿐(그 아래는 주문 자체가 거부됨).
  availableMarginBudgetPct: 0.90,    // 가용잔고의 90% 까지 한 거래에 투입 허용
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
export function checkAggregateExposure({ plan, openPositions, equity, availableMargin = null, cfg = RISK_CONFIG }) {
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

  // ★ 2026-06-03 (대표 지시 "있는대로 잡으면 되지"): 가용잔고(availableBalance)가 주어지면
  //   그게 진짜 진입 가능 한도다 — equity×ratio 소프트 가드 대신 "신규 마진 ≤ 가용×budget"
  //   으로 판정한다. 수동 포지션이 자본의 95% 를 차지해도, 남은 가용 안에서는 봇이 진입.
  //   (equity 비례 가드는 all-bot 계정 가정이라 대표의 수동 롱/숏이 사용률을 부풀려 봇을 막던 문제)
  //   env ZEPTA_AGG_USE_AVAILABLE=0 으로 옛 strict(equity 비례) 동작 복원 가능.
  const useAvail = Number.isFinite(availableMargin) && availableMargin > 0
    && process.env.ZEPTA_AGG_USE_AVAILABLE !== "0";
  const newMargin = plan.marginRequired || (plan.notional / (plan.leverage || 10));

  if (useAvail) {
    const availBudgetPct = cfg.availableMarginBudgetPct ?? 0.90;
    const availCap = availableMargin * availBudgetPct;
    push(`가용 기준 판정: 신규 마진 $${newMargin.toFixed(2)} vs 가용한도 $${availCap.toFixed(2)} (가용 $${availableMargin.toFixed(2)} × ${(availBudgetPct*100).toFixed(0)}%)`);
    if (newMargin > availCap + 0.01) {
      return {
        ok: false,
        reason: `신규 마진 $${newMargin.toFixed(2)} > 가용 한도 $${availCap.toFixed(2)} (가용 $${availableMargin.toFixed(2)}의 ${(availBudgetPct*100).toFixed(0)}%)`,
        sumNotional, sumMargin, log,
      };
    }
    // 가용 경로에선 품질을 conviction sizing(약한 시그널→소량) + 엔진 랭킹/스코어 임계가 담당.
    return { ok: true, sumNotional, sumMargin, log };
  }

  // ── 이하 equity 비례 strict 경로 (가용잔고 미제공 또는 ZEPTA_AGG_USE_AVAILABLE=0) ──
  if (newSumMargin > marginCap) {
    return {
      ok: false,
      reason: `합산 마진 $${newSumMargin.toFixed(2)} > 한도 $${marginCap.toFixed(2)} (${(marginRatio*100).toFixed(0)}% of equity)`,
      sumNotional, sumMargin, log,
    };
  }

  // ★ 무지성 진입 방지 — 자본 사용률 기반 동적 quality guard.
  //   사용률이 높을수록 강한 시그널만 통과시켜 "한도 맞추려고 약한 시그널도 진입" 차단.
  //   plan.confidence 는 signal.confidence 그대로 복사됨 (planTrade 결과).
  const utilizationPct = newSumMargin / equity;
  const guardTiers = cfg.utilizationMinConfidence || [];
  // tier 는 threshold 오름차순. 사용률이 가장 높은 적용 tier 의 minConf 사용.
  let requiredMinConf = 0;
  for (const tier of guardTiers) {
    if (utilizationPct >= tier.threshold) requiredMinConf = tier.minConf;
  }
  if (requiredMinConf > 0) {
    const planConf = plan.confidence ?? plan.signalConfidence ?? 0;
    if (planConf < requiredMinConf) {
      push(`utilization guard: ${(utilizationPct*100).toFixed(0)}% used → require conf ≥ ${requiredMinConf}, plan conf=${planConf}`);
      return {
        ok: false,
        reason: `자본 사용률 ${(utilizationPct*100).toFixed(0)}% — 강한 시그널 (confidence ≥ ${requiredMinConf}) 만 추가 진입 허용 (현재 ${planConf})`,
        sumNotional, sumMargin, log,
      };
    }
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

/**
 * 동적 SL/TP 산출 — family + regime + ATR 기반 (★ 2026-05-17 QUANT-RES 신규).
 *
 * 우선순위:
 *   1) env ZEPTA_SL_ATR_MUL / ZEPTA_TP_ATR_MUL (수동 over-ride)
 *   2) cfg.familySLTPMatrix[family] (신규 family-id 별)
 *   3) cfg.atrMultSL[family] (legacy 폴백)
 *   4) cfg.familySLTPMatrix.default
 *
 * regime 보정:
 *   regime ∈ {trending, mean_reverting, transitional} 인 경우 cfg.regimeSLTPBoost 적용.
 *   미상이면 boost 1.0 (no-op).
 *
 * 안전 cap:
 *   slPct ∈ [dynamicSLFloorPct, dynamicSLCeilPct]
 *   tpPct ∈ [dynamicTPFloorPct, dynamicTPCeilPct]
 *
 * @returns {{ slPct, tpPct, atrPct, slMul, tpMul, slBoost, tpBoost, source }}
 */
export function dynamicSLTP({ price, atr, family, regime, cfg = RISK_CONFIG }) {
  if (!atr || !price || atr <= 0 || price <= 0) return null;
  const atrPct = atr / price; // 소수

  // 1) env over-ride
  const envSL = Number(process.env.ZEPTA_SL_ATR_MUL);
  const envTP = Number(process.env.ZEPTA_TP_ATR_MUL);

  // 2~4) family lookup
  const matrix = cfg.familySLTPMatrix || {};
  const famKey = family || "default";
  const famEntry =
    matrix[famKey] ||
    matrix[famKey?.replace(/-/g, "_")] ||
    matrix.default || { slAtrMul: 2.0, tpAtrMul: 3.0 };

  // legacy atrMultSL 폴백 (familySLTPMatrix 에 없을 때만)
  const legacySLMul = cfg.atrMultSL?.[famKey] ?? cfg.atrMultSL?.unknown;
  const legacyTPMul = legacySLMul != null ? legacySLMul * (cfg.rewardToRisk?.[famKey] ?? cfg.rewardToRisk?.unknown ?? 2.0) : null;

  let slMul = Number.isFinite(envSL) ? envSL
            : (famEntry.slAtrMul ?? legacySLMul ?? 2.0);
  let tpMul = Number.isFinite(envTP) ? envTP
            : (famEntry.tpAtrMul ?? legacyTPMul ?? 4.0);

  // regime 보정
  // ★ 2026-06-14 (감사): regime 이 객체({avgHurst, regime:string|null})일 때 regime.regime 이
  //   null 이면 기존 `regime?.regime || regime` 가 *객체 자체*를 키로 써 "[object Object]" →
  //   매트릭스 미스 → default. 타입 가드로 항상 문자열 키만 사용(정상 케이스 동작 불변).
  const regimeKey = (typeof regime === "string" ? regime : regime?.regime) || "default";
  const regBoost = (cfg.regimeSLTPBoost || {})[regimeKey] || (cfg.regimeSLTPBoost || {}).default || { slBoost: 1, tpBoost: 1 };
  const slBoost = regBoost.slBoost ?? 1.0;
  const tpBoost = regBoost.tpBoost ?? 1.0;

  let slPct = atrPct * slMul * slBoost;
  let tpPct = atrPct * tpMul * tpBoost;

  // 안전 cap
  const slFloor = cfg.dynamicSLFloorPct ?? 0.015;
  // ★ 2026-06-15 (item4): SL 상한 env over-ride. 백테스트상 공격적 SL 축소(3%)는 -$21로
  //   역효과였으므로 상한만 8%→7.5%로 미세 클립(극단 꼬리). ZEPTA_SL_CEIL_PCT=0.08 로 즉시 원복.
  const _envCeil = Number(process.env.ZEPTA_SL_CEIL_PCT);
  const slCeil  = (Number.isFinite(_envCeil) && _envCeil > 0 ? _envCeil : (cfg.dynamicSLCeilPct ?? 0.075));
  const tpFloor = cfg.dynamicTPFloorPct ?? 0.02;
  const tpCeil  = cfg.dynamicTPCeilPct  ?? 0.15;

  slPct = Math.min(slCeil, Math.max(slFloor, slPct));
  tpPct = Math.min(tpCeil, Math.max(tpFloor, tpPct));

  return {
    slPct, tpPct, atrPct,
    slMul, tpMul, slBoost, tpBoost,
    regimeKey,
    source: Number.isFinite(envSL) || Number.isFinite(envTP) ? "env" : (matrix[famKey] ? "family-matrix" : "legacy"),
  };
}

/**
 * Legacy 호환 — 기존 호출 측 ({ price, atr, family, cfg }) 그대로 동작.
 * 신규 dynamicSLTP 의 slPct 만 반환.
 *
 * ★ 2026-05-17: 내부적으로 dynamicSLTP 위임. regime 미전달 시 boost 1.0 동작.
 */
export function stopDistancePct({ price, atr, family, regime = null, cfg = RISK_CONFIG }) {
  const r = dynamicSLTP({ price, atr, family, regime, cfg });
  return r ? r.slPct : null;
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
 *
 * ★ 2026-05-17 (QUANT-RES): regime 파라미터 추가. signal.regime 또는 args.regime
 *   로 전달 가능. 동적 SL/TP 가 regime 보정 자동 적용.
 */
export function planTrade({ signal, equity, price, atr, filter, regime = null, availableMargin = null, cfg = RISK_CONFIG }) {
  const log = [];
  const push = (m) => log.push(m);

  if (!signal || !["LONG", "SHORT"].includes(signal.side)) {
    return { ok: false, reason: "invalid signal side", log };
  }
  if (!(equity > 0)) return { ok: false, reason: "equity <= 0", log };
  if (!(price > 0)) return { ok: false, reason: "price invalid", log };
  if (!filter) return { ok: false, reason: "symbol filter missing", log };

  // regime 우선순위: 인자 → signal.regime → null (boost 1.0)
  const effectiveRegime = regime || signal.regime || null;

  // 1) ATR → 동적 SL/TP (family + regime 매트릭스)
  const dyn = dynamicSLTP({ price, atr, family: signal.strategyFamily, regime: effectiveRegime, cfg });
  if (!dyn || !dyn.slPct || dyn.slPct <= 0) {
    return { ok: false, reason: "ATR 없음 또는 stop 거리 산출 불가", log };
  }
  let stopDistPct = dyn.slPct;
  let dynamicTpPct = dyn.tpPct;
  push(`dynamicSLTP source=${dyn.source} regime=${dyn.regimeKey} atr%=${(dyn.atrPct*100).toFixed(2)} slMul=${dyn.slMul}×${dyn.slBoost} tpMul=${dyn.tpMul}×${dyn.tpBoost}`);
  push(`rawStopDistPct=${(stopDistPct * 100).toFixed(3)}% (dynamic TP=${(dynamicTpPct * 100).toFixed(3)}%)`);

  // ★ 1-1) 손절 거리 결정.
  //   2026-05-31 대표 지시: "익절·손절 모두 내가 지정하지 말고 전략이 알아서 정하게".
  //   → 사용자 고정 ROI 손절 캡 기본 해제. SL 은 dynamicSLTP 의 ATR×family×regime 거리
  //     (가격 1.5~8%, dynamicSLFloor/Ceil 로 자동 bound) 를 그대로 사용.
  //   ★ 거래당 $위험은 불변: 손절폭이 넓어지면 포지션이 그만큼 작게 사이징됨
  //     (notional = riskAmount / effLossPct). 청산버퍼 검증(아래)이 안전 backstop.
  //   옛 고정 캡 복원: env ZEPTA_MAX_ROI_LOSS_PCT (예: 0.40 → 10x 기준 가격 4%).
  const previewLev = pickLeverage(signal.confidence, signal.strategyFamily, cfg);
  // 손절은 전략 ATR 거리(dynamicSLTP) 그대로 — 사용자 고정 ROI 캡 제거.
  //   단, SL 은 청산보다 먼저 와야 하므로 "청산-안전 거리"로만 상한 (물리적 안전 bound, 사용자값 아님).
  //   상한에 걸려도 trade 거부가 아니라 안전거리로 cap → 전략 SL 최대한 살리되 청산 안전.
  const previewLiqSafe = approxLiquidationPct(previewLev) * (cfg.liqSafetyRatio || 0.7);
  if (stopDistPct > previewLiqSafe) {
    push(`stopDistPct ${(stopDistPct * 100).toFixed(2)}% > 청산안전 ${(previewLiqSafe * 100).toFixed(2)}% → 안전거리로 cap (전략 SL, 사용자 ROI 캡 없음)`);
    stopDistPct = previewLiqSafe;
  } else {
    push(`손절 = 전략 ATR 거리 ${(stopDistPct * 100).toFixed(2)}% (사용자 ROI 캡 없음, 포지션 자동 사이징으로 $위험 일정)`);
  }
  // 옛 고정 ROI 캡 복원용 — 기본 미설정 = 비활성 (env ZEPTA_MAX_ROI_LOSS_PCT, 예: 0.40).
  const roiCapEnv = parseFloat(process.env.ZEPTA_MAX_ROI_LOSS_PCT);
  if (Number.isFinite(roiCapEnv) && roiCapEnv > 0) {
    const slCapByRoi = roiCapEnv / previewLev;
    if (stopDistPct > slCapByRoi) { push(`+ env ROI cap → ${(slCapByRoi * 100).toFixed(2)}%`); stopDistPct = slCapByRoi; }
  }

  // 2) 비용 거리 (수수료 + 슬리피지, 왕복)
  const costPct = (cfg.roundTripFeePct || 0) + (cfg.roundTripSlippagePct || 0);
  push(`costPct=${(costPct * 100).toFixed(3)}% (fee+slip roundtrip)`);
  if (stopDistPct <= costPct * 1.5) {
    return { ok: false, reason: `stopDist ${(stopDistPct * 100).toFixed(2)}% too tight vs costs ${(costPct * 100).toFixed(2)}%`, log };
  }

  // 3) 리스크 금액 (SL 까지 맞았을 때 잃는 순손실 한도)
  //    ★ 2026-06-03: 확신도 비례 사이징 — 종합점수↑면 크게, 애매하면 소량(스케일인과 결합).
  const csz = cfg.convictionSizing || {};
  let convFactor = 1.0;
  if (csz.enabled !== false && process.env.ZEPTA_CONVICTION_SIZING !== "0") {
    const sc = Number(signal.score);
    if (Number.isFinite(sc)) {
      const lo = csz.minScore ?? 55, hi = csz.maxScore ?? 88;
      const fLo = csz.minFactor ?? 0.4, fHi = csz.maxFactor ?? 1.0;
      const t = hi > lo ? Math.max(0, Math.min(1, (sc - lo) / (hi - lo))) : 1;
      convFactor = fLo + t * (fHi - fLo);
    } else {
      // 점수 없으면 confidence 등급 폴백
      convFactor = ({ A: 1.0, B: 0.72, C: 0.5 })[signal.confidence] ?? 0.6;
    }
  }
  const riskAmount = equity * cfg.riskPerTradePct * convFactor;
  push(`riskAmount=$${riskAmount.toFixed(3)} (${(cfg.riskPerTradePct * 100).toFixed(2)}% × 확신${convFactor.toFixed(2)} of $${equity.toFixed(2)}, score=${signal.score ?? "-"})`);

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
  let effMaxMargin = clamp(
    equity * (cfg.absoluteMaxMarginPct || 0.20),
    cfg.absoluteMaxMarginFloor || 50,
    cfg.absoluteMaxMarginCeiling || 2000,
  );
  // ★ 2026-06-03 (대표 지시): 신규 진입 마진을 실제 가용잔고 안으로 자동 축소.
  //   가용($198)이 자본비례 상한($481)보다 작으면 → 가용×90% 로 줄여 잡음(reject 대신 shrink).
  //   인위적 하한 없음 — 가용이 minNotional 도 못 채우면 그때만 minNotional 로직이 거른다.
  if (Number.isFinite(availableMargin) && availableMargin > 0) {
    const availCap = availableMargin * (cfg.availableMarginBudgetPct ?? 0.90);
    if (availCap < effMaxMargin) {
      effMaxMargin = availCap;
      push(`shrink-to-fit: 가용 $${availableMargin.toFixed(0)} × ${((cfg.availableMarginBudgetPct ?? 0.90)*100).toFixed(0)}% = maxMargin $${effMaxMargin.toFixed(0)}`);
    }
  }
  const maxNotionalCap = effMaxMargin * previewLevForCap;
  if (notional > maxNotionalCap) {
    notional = maxNotionalCap;
    push(`capped by effMaxMargin=$${effMaxMargin.toFixed(0)} × lev ${previewLevForCap} = noSi $${maxNotionalCap.toFixed(0)}`);
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
    // needLev = SL 이 안전한 *최대* 레버리지(0.9 안전마진 포함). 레버리지가 낮을수록
    //   청산거리가 멀어져 안전 → finalLev ≤ needLev 면 안전. 최저 허용 레버리지(minLev)로도
    //   못 낮추면(needLev < minLev) 거부.
    const needLev = Math.ceil(1 / (stopDistPct / (cfg.liqSafetyRatio || 0.7) / 0.9));
    const adjLev = clamp(needLev, cfg.minLeverage, cfg.maxLeverage);
    // ★ 2026-06-14 (감사 P1-3): 거부 조건을 needLev < minLeverage 로 정정.
    //   기존 `adjLev >= leverage`는 고정 레버리지(min=max)에선 우연히 맞으나, 가변
    //   레버리지(minLev < 현재lev)에서 needLev < minLev 인데도 거부 못 해 *불안전 레버리지*로
    //   진입하던 latent landmine. 현 고정 5x 설정에선 동작 불변(둘 다 거부).
    if (needLev < cfg.minLeverage) {
      return { ok: false, reason: `SL ${(stopDistPct * 100).toFixed(2)}% 가 최저 레버리지(${cfg.minLeverage}x)에서도 청산거리 초과 — 거부`, log };
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
  let minMarginUsd = Math.max(
    equity * (cfg.minMarginPct || 0.05),
    cfg.minMarginFloor || 20,
  );
  // ★ 2026-06-03 (대표 지시 "하한은 둘 필요 없잖아"): 인위적 5% 하한이 가용 상한(effMaxMargin,
  //   가용잔고 반영됨)을 넘지 못하게 묶는다. 가용이 작으면 하한도 함께 내려가 "있는대로" 진입.
  //   진짜 하한은 아래 9)~10) 거래소 minNotional 뿐.
  if (effMaxMargin < minMarginUsd) minMarginUsd = effMaxMargin;
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

  // 11) SL / TP 가격
  // ★ 2026-05-17 (QUANT-RES): 동적 TP 우선. dynamicSLTP 가 family + regime 기반으로
  //   tpPct 를 이미 산출했으므로 그것을 base 로 사용하되, "비용 차감 후 순 RR" 하한은
  //   여전히 강제 (minNetRR 안전망).
  const slPct = stopDistPct;
  // dynamic TP 기본 — 위 dyn.tpPct (slPct 가 cap 으로 줄었어도 dynamicTpPct 는 보존).
  const dynamicBaseTp = Number.isFinite(dynamicTpPct) && dynamicTpPct > 0 ? dynamicTpPct : slPct * 2.0;
  // legacy rewardToRisk 폴백 (env / family 매핑 없을 때만 영향)
  const legacyRR = cfg.rewardToRisk?.[signal.strategyFamily] || cfg.rewardToRisk?.unknown || 2.0;
  // 순 RR 하한: (tpPct - costPct) / (slPct + costPct) ≥ minNetRR
  const minNetTp = (cfg.minNetRR || 1.8) * (slPct + costPct) + costPct;
  const tpPct = Math.max(dynamicBaseTp, slPct * legacyRR, minNetTp);
  const netRR = (tpPct - costPct) / (slPct + costPct);
  push(`tp source: dynamic=${(dynamicBaseTp*100).toFixed(2)}% legacyRR=${legacyRR} minNetFloor=${(minNetTp*100).toFixed(2)}% → tpPct=${(tpPct * 100).toFixed(3)}% netRR=${netRR.toFixed(2)}`);
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
    // ★ 2026-05-17 (QUANT-RES) 동적 SL/TP 메타 — 분석/디버깅용 KV 적재
    dynamic: dyn ? {
      source: dyn.source,
      regimeKey: dyn.regimeKey,
      atrPct: Number(dyn.atrPct.toFixed(5)),
      slMul: dyn.slMul,
      tpMul: dyn.tpMul,
      slBoost: dyn.slBoost,
      tpBoost: dyn.tpBoost,
    } : null,
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
  dynamicSLTP,
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
