// ════════════════════════════════════════════════════════════════════
// Zepta — 구독 모델 (Free / Pro / Premium 3 tier) SSOT
// ────────────────────────────────────────────────────────────────────
// 모든 권한 확인은 이 파일을 거칩니다.
// UI 컴포넌트 → hasFeature(user, "ALPHA_LAB_FULL") 형태로 호출.
// 한도 확인 → getTierLimit(user, "botCount") 형태로 호출.
//
// 법적 포지셔닝:
//   - "도구 사용권" SaaS — 투자 결과를 보장하지 않습니다.
//   - 한국 자본시장법 인가 없음 → "투자자문" 라벨 X.
//   - 결제 통합은 후속 sprint (현재 mock 단계).
//
// KV 스키마: `di:subscription:<uid>`
//   {
//     tier: "free" | "pro" | "premium",
//     startedAt: ISO,
//     expiresAt: ISO | null,         // null = 무기한 (free)
//     trialEndsAt: ISO | null,       // Pro 14일 trial 종료 시각
//     paymentMethod: "mock" | "toss" | "stripe" | null,
//     autoRenew: bool,
//     cancelledAt: ISO | null,
//     history: [{ tier, startedAt, endedAt, reason }]
//   }
// ════════════════════════════════════════════════════════════════════

// ── Tier 정의 ─────────────────────────────────────────────────────
export const TIERS = ["free", "pro", "premium"];

export const TIER_LABELS = {
  free:    { ko: "무료",    en: "Free",    krw: 0,     usd: 0 },
  pro:     { ko: "Pro",     en: "Pro",     krw: 9900,  usd: 9.99 },
  premium: { ko: "Premium", en: "Premium", krw: 29900, usd: 29.99 },
};

// ── Tier 별 사용 한도 ───────────────────────────────────────────
// Infinity 는 클라이언트에서 isFinite() 로 판정 후 "무제한" UI 노출.
export const TIER_LIMITS = {
  free: {
    botCount: 1,
    dcaBotCount: 0,
    savedScreeners: 3,
    backtestLookbackDays: 30,
    backtestCompareSlots: 0,
    alertCount: 3,
    copyTradingFollows: 0,
    telegramSignalsPerDay: 5,
    apiCallsPerMinute: 10,
    showAds: true,
  },
  pro: {
    botCount: 5,
    dcaBotCount: 5,
    savedScreeners: Infinity,
    backtestLookbackDays: 90,
    backtestCompareSlots: 4,
    alertCount: Infinity,
    copyTradingFollows: 10,
    telegramSignalsPerDay: 50,
    apiCallsPerMinute: 60,
    showAds: false,
  },
  premium: {
    botCount: Infinity,
    dcaBotCount: Infinity,
    savedScreeners: Infinity,
    backtestLookbackDays: Infinity,
    backtestCompareSlots: Infinity,
    alertCount: Infinity,
    copyTradingFollows: Infinity,
    telegramSignalsPerDay: Infinity,
    apiCallsPerMinute: 300,
    showAds: false,
  },
};

// ── Feature flags — 권한 게이트 ─────────────────────────────────
// 각 키는 "최소 필요 tier" 를 의미. hasFeature() 는 비교 연산.
export const FEATURE_FLAGS = {
  // 스크리너
  SCREENER_BASIC:          "free",
  SCREENER_FAVORITES:      "pro",       // 즐겨찾기 무제한

  // 봇/자동매매
  BOT_BASIC:               "free",       // 봇 1개
  BOT_PRO:                 "pro",        // 5개 + DCA
  BOT_UNLIMITED:           "premium",

  // 백테스트
  BACKTEST_30D:            "free",
  BACKTEST_90D:            "pro",
  BACKTEST_UNLIMITED:      "premium",
  BACKTEST_COMPARE:        "pro",
  BACKTEST_GRID_SEARCH:    "premium",

  // 알림
  ALERT_PRICE_ONLY:        "free",
  ALERT_FULL:              "pro",        // 가격 · 신호 · 뉴스 · 포트폴리오
  TELEGRAM_UNLIMITED:      "premium",

  // AlphaLab
  ALPHA_LAB_PUBLIC:        "free",       // shadow / promotion 결과 조회
  ALPHA_LAB_FULL:          "pro",        // 파라미터 grid · backtest · 시뮬

  // 카피트레이딩
  COPY_TRADING_BASIC:      "pro",        // 10 follow
  COPY_TRADING_UNLIMITED:  "premium",

  // 광고
  AD_FREE:                 "pro",

  // API
  API_ACCESS:              "premium",

  // 고객 지원
  PRIORITY_SUPPORT:        "premium",
};

const TIER_ORDER = { free: 0, pro: 1, premium: 2 };

// ── 핵심 헬퍼 ───────────────────────────────────────────────────

/** 사용자 객체에서 현재 tier 추출 (없으면 free). */
export function getTier(user) {
  if (!user) return "free";
  // 1) cached subscription 객체 (App.jsx 에서 주입)
  const sub = user.subscription || user.user_metadata?.subscription;
  if (sub && TIERS.includes(sub.tier)) {
    // 만료 체크
    if (sub.expiresAt && new Date(sub.expiresAt) < new Date()) return "free";
    return sub.tier;
  }
  return "free";
}

/** 사용자의 trial 잔여일수 (Pro 14일 trial 중일 때만 양수). */
export function getTrialDaysLeft(user) {
  const sub = user?.subscription || user?.user_metadata?.subscription;
  if (!sub?.trialEndsAt) return 0;
  const left = (new Date(sub.trialEndsAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000);
  return left > 0 ? Math.ceil(left) : 0;
}

/**
 * 권한 확인 — feature 가 요구하는 tier 이상이어야 true.
 * 사용: hasFeature(user, "ALPHA_LAB_FULL")
 */
export function hasFeature(user, feature) {
  const required = FEATURE_FLAGS[feature];
  if (!required) {
    console.warn(`[subscription] unknown feature: ${feature}`);
    return false;
  }
  return TIER_ORDER[getTier(user)] >= TIER_ORDER[required];
}

/** Tier 비교 — 현재 tier 가 target 이상이면 true. */
export function meetsTier(user, target) {
  return TIER_ORDER[getTier(user)] >= (TIER_ORDER[target] ?? 0);
}

/** 한도 조회 — getTierLimit(user, "botCount") */
export function getTierLimit(user, key) {
  const tier = getTier(user);
  return TIER_LIMITS[tier]?.[key];
}

/**
 * 한도 초과 체크 — current 가 한도 미만이면 true.
 * UI 에서 "추가 가능?" 판정용.
 */
export function canAddMore(user, key, current) {
  const limit = getTierLimit(user, key);
  if (limit == null) return true;
  if (!isFinite(limit)) return true;
  return current < limit;
}

/** 광고 노출 여부 — free 만 true. */
export function shouldShowAds(user) {
  return !!getTierLimit(user, "showAds");
}

/** 사용자 친화적 tier 라벨 (한국어). */
export function getTierLabel(tier, lang = "ko") {
  const t = TIER_LABELS[tier] || TIER_LABELS.free;
  return lang === "en" ? t.en : t.ko;
}

/** 가격 포맷 — { krw, usd } */
export function getTierPrice(tier) {
  return TIER_LABELS[tier] || TIER_LABELS.free;
}

// ── API 호출 헬퍼 ───────────────────────────────────────────────

/**
 * 서버에서 사용자 구독 상태 조회 (KV 우선).
 * App.jsx 에서 로그인 직후 호출 → user.subscription 에 저장.
 */
export async function fetchSubscription(uid) {
  if (!uid) return null;
  try {
    const r = await fetch(`/api/subscription/status?uid=${encodeURIComponent(uid)}`);
    if (!r.ok) return null;
    const data = await r.json();
    return data?.subscription || null;
  } catch (e) {
    console.warn("[subscription] fetch failed:", e?.message);
    return null;
  }
}

/**
 * Tier 업그레이드 요청 (mock — 결제 통합 전).
 * POST /api/subscription/upgrade  body: { uid, targetTier, useTrial }
 */
export async function requestUpgrade({ uid, targetTier, useTrial = false, paymentToken = "mock" }) {
  if (!uid) throw new Error("uid required");
  if (!TIERS.includes(targetTier)) throw new Error("invalid tier");
  const r = await fetch("/api/subscription/upgrade", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uid, targetTier, useTrial, paymentToken }),
  });
  const data = await r.json();
  if (!r.ok || !data?.ok) throw new Error(data?.error || "upgrade failed");
  return data.subscription;
}

/** 구독 취소 — 즉시 free 다운그레이드 X (현재 결제 주기 종료 후). */
export async function cancelSubscription(uid) {
  if (!uid) throw new Error("uid required");
  const r = await fetch("/api/subscription/cancel", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uid }),
  });
  const data = await r.json();
  if (!r.ok || !data?.ok) throw new Error(data?.error || "cancel failed");
  return data.subscription;
}

// ── 결제 어댑터 인터페이스 (후속 sprint 에서 구현) ─────────────
/**
 * 토스 페이먼츠 / Stripe 통합 시 이 인터페이스를 구현하면 됨.
 *   { id, label, createCheckout({ uid, tier }), verify(token), refund(orderId) }
 */
export const PAYMENT_ADAPTERS = {
  mock: {
    id: "mock",
    label: "Mock (개발용)",
    async createCheckout({ uid, tier }) {
      return { token: `mock-${uid}-${tier}-${Date.now()}`, redirectUrl: null };
    },
    async verify(_token) { return { ok: true, paid: true }; },
    async refund(_orderId) { return { ok: true, refunded: true }; },
  },
  // toss: { ... }   ← 후속 sprint
  // stripe: { ... } ← 후속 sprint
};

export default {
  TIERS,
  TIER_LABELS,
  TIER_LIMITS,
  FEATURE_FLAGS,
  getTier,
  getTrialDaysLeft,
  hasFeature,
  meetsTier,
  getTierLimit,
  canAddMore,
  shouldShowAds,
  getTierLabel,
  getTierPrice,
  fetchSubscription,
  requestUpgrade,
  cancelSubscription,
  PAYMENT_ADAPTERS,
};
