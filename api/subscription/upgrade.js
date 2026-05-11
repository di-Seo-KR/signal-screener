// ════════════════════════════════════════════════════════════════════
// Zepta — 구독 업그레이드 API (Mock — 실제 결제 통합 전)
// ──────────────────────────────────────────────────────────────────
// POST /api/subscription/upgrade
//   body: { uid, targetTier, useTrial?: bool, paymentToken?: string }
//
// 동작:
//   1) 입력 검증 (tier 유효성, 다운그레이드 방지)
//   2) Mock 결제 검증 (지금은 paymentToken !== null 이면 통과)
//   3) KV 업데이트 — history 에 이전 tier 기록
//   4) 14일 trial 옵션 (Pro 만, 1회 한정)
//
// 후속 sprint:
//   - paymentToken 을 toss / stripe adapter 로 verify
//   - webhook 으로 결제 완료 확인 후 tier 변경
//   - 정기결제 갱신 (cron)
// ════════════════════════════════════════════════════════════════════

const VALID_TIERS = ["free", "pro", "premium"];
const TIER_ORDER = { free: 0, pro: 1, premium: 2 };
const KEY = (uid) => `di:subscription:${sanitizeUid(uid)}`;
const TRIAL_DAYS = 14;
const PAID_PERIOD_DAYS = 30;

function sanitizeUid(uid) {
  return String(uid || "guest").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64) || "guest";
}

async function getKv() {
  try {
    const m = await import("@vercel/kv");
    if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) return null;
    return m.kv;
  } catch {
    return null;
  }
}

function addDays(date, days) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  // ── 입력 파싱 & 검증 ──
  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
  } catch {
    return res.status(400).json({ ok: false, error: "Invalid JSON" });
  }

  const uid = sanitizeUid(body.uid);
  const targetTier = String(body.targetTier || "").toLowerCase();
  const useTrial = !!body.useTrial;
  const paymentToken = body.paymentToken;

  if (!uid || uid === "guest") {
    return res.status(401).json({ ok: false, error: "Login required" });
  }

  if (!VALID_TIERS.includes(targetTier)) {
    return res.status(400).json({ ok: false, error: "Invalid tier" });
  }

  if (targetTier === "free") {
    return res.status(400).json({
      ok: false,
      error: "Use /api/subscription/cancel for downgrade to free",
    });
  }

  // Trial 은 Pro 만 허용
  if (useTrial && targetTier !== "pro") {
    return res.status(400).json({ ok: false, error: "Trial available for Pro tier only" });
  }

  // 결제 검증 — trial 이 아니면 paymentToken 필수
  if (!useTrial && !paymentToken) {
    return res.status(400).json({ ok: false, error: "Payment token required" });
  }

  const kv = await getKv();
  if (!kv) {
    return res.status(503).json({ ok: false, error: "Storage not available", skipped: true });
  }

  // ── 현재 구독 조회 ──
  let current;
  try {
    current = (await kv.get(KEY(uid))) || {};
  } catch (e) {
    return res.status(500).json({ ok: false, error: `KV read failed: ${e.message}` });
  }

  const currentTier = current.tier || "free";

  // 다운그레이드 / 동일 tier 방지
  if (TIER_ORDER[targetTier] <= TIER_ORDER[currentTier] && currentTier !== "free") {
    return res.status(400).json({
      ok: false,
      error: `Cannot downgrade or repeat — current tier is ${currentTier}`,
    });
  }

  // Trial 1회 한정 체크
  if (useTrial) {
    const usedTrial = (current.history || []).some(
      (h) => h.reason === "trial-start" || h.reason === "trial-end"
    );
    if (usedTrial || current.trialEndsAt) {
      return res.status(400).json({ ok: false, error: "Trial already used" });
    }
  }

  // ── 새 구독 객체 ──
  const now = new Date().toISOString();
  const history = Array.isArray(current.history) ? current.history.slice(-20) : [];
  history.push({
    tier: currentTier,
    endedAt: now,
    reason: useTrial ? "trial-start" : "upgrade",
    targetTier,
  });

  const newSub = {
    tier: targetTier,
    startedAt: now,
    expiresAt: useTrial ? addDays(now, TRIAL_DAYS) : addDays(now, PAID_PERIOD_DAYS),
    trialEndsAt: useTrial ? addDays(now, TRIAL_DAYS) : null,
    paymentMethod: useTrial ? null : "mock",
    autoRenew: !useTrial,
    cancelledAt: null,
    history,
  };

  try {
    // 365 일 TTL — 만료된 구독도 history 보존 위해 유지
    await kv.set(KEY(uid), newSub, { ex: 365 * 24 * 60 * 60 });
  } catch (e) {
    return res.status(500).json({ ok: false, error: `KV write failed: ${e.message}` });
  }

  return res.status(200).json({ ok: true, subscription: newSub });
}
