// ════════════════════════════════════════════════════════════════════
// Zepta — 구독 취소 API
// ──────────────────────────────────────────────────────────────────
// POST /api/subscription/cancel
//   body: { uid, reason?: string, immediate?: bool }
//
// 동작:
//   - 기본: autoRenew = false 로 설정. expiresAt 까지는 현 tier 유지.
//   - immediate=true: 즉시 free 다운그레이드 (7일 내 환불 정책 사용 시).
//   - history 에 취소 사유 기록.
//
// 환불 정책 (terms.html 명시):
//   - 7일 이내 100% 환불 (immediate=true 권장)
//   - 7일 후 잔여기간 비례 환불 (기본 autoRenew off)
// ════════════════════════════════════════════════════════════════════

const KEY = (uid) => `di:subscription:${sanitizeUid(uid)}`;

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

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
  } catch {
    return res.status(400).json({ ok: false, error: "Invalid JSON" });
  }

  const uid = sanitizeUid(body.uid);
  const reason = String(body.reason || "user-cancel").slice(0, 200);
  const immediate = !!body.immediate;

  if (!uid || uid === "guest") {
    return res.status(401).json({ ok: false, error: "Login required" });
  }

  const kv = await getKv();
  if (!kv) {
    return res.status(503).json({ ok: false, error: "Storage not available" });
  }

  let current;
  try {
    current = (await kv.get(KEY(uid))) || {};
  } catch (e) {
    return res.status(500).json({ ok: false, error: `KV read failed: ${e.message}` });
  }

  const currentTier = current.tier || "free";
  if (currentTier === "free") {
    return res.status(400).json({ ok: false, error: "No active subscription to cancel" });
  }

  const now = new Date().toISOString();
  const history = Array.isArray(current.history) ? current.history.slice(-20) : [];
  history.push({
    tier: currentTier,
    endedAt: now,
    reason: `cancel:${reason}`,
    immediate,
  });

  const updated = {
    ...current,
    autoRenew: false,
    cancelledAt: now,
    history,
    // 즉시 취소 — free 로 강제 다운그레이드
    ...(immediate
      ? { tier: "free", expiresAt: now, trialEndsAt: null }
      : {}),
  };

  try {
    await kv.set(KEY(uid), updated, { ex: 365 * 24 * 60 * 60 });
  } catch (e) {
    return res.status(500).json({ ok: false, error: `KV write failed: ${e.message}` });
  }

  return res.status(200).json({ ok: true, subscription: updated, immediate });
}
