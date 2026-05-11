// ════════════════════════════════════════════════════════════════════
// Zepta — 구독 상태 조회 API
// ──────────────────────────────────────────────────────────────────
// GET /api/subscription/status?uid=<userId>
//
// 반환:
//   {
//     ok: true,
//     subscription: {
//       tier, startedAt, expiresAt, trialEndsAt,
//       paymentMethod, autoRenew, cancelledAt, history
//     },
//     storage: "kv" | "default"
//   }
//
// KV 미설정 / 미가입 사용자는 free tier 기본값 반환.
// ════════════════════════════════════════════════════════════════════

const KEY = (uid) => `di:subscription:${sanitizeUid(uid)}`;

export const DEFAULT_SUBSCRIPTION = {
  tier: "free",
  startedAt: null,
  expiresAt: null,
  trialEndsAt: null,
  paymentMethod: null,
  autoRenew: false,
  cancelledAt: null,
  history: [],
};

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

/**
 * 만료된 구독을 free 로 정규화 — 응답 직전에 호출.
 * KV 의 데이터 자체는 history 보존 위해 유지.
 */
function normalizeExpired(sub) {
  if (!sub) return { ...DEFAULT_SUBSCRIPTION };
  const now = new Date();
  const out = { ...DEFAULT_SUBSCRIPTION, ...sub };
  if (out.expiresAt && new Date(out.expiresAt) < now && out.tier !== "free") {
    out.tier = "free";
  }
  // trial 만료 처리
  if (out.trialEndsAt && new Date(out.trialEndsAt) < now) {
    out.trialEndsAt = null;
  }
  return out;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const uid = sanitizeUid(req.query?.uid);
  const kv = await getKv();

  if (!kv) {
    return res.status(200).json({
      ok: true,
      subscription: { ...DEFAULT_SUBSCRIPTION },
      storage: "default",
    });
  }

  try {
    const saved = await kv.get(KEY(uid));
    const sub = normalizeExpired(saved);
    return res.status(200).json({
      ok: true,
      subscription: sub,
      storage: saved ? "kv" : "default",
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: e.message,
      subscription: { ...DEFAULT_SUBSCRIPTION },
    });
  }
}

/** 외부 모듈 (cron, gating middleware 등) 에서 구독 조회. */
export async function getSubscription(uid) {
  const kv = await getKv();
  if (!kv) return { ...DEFAULT_SUBSCRIPTION };
  try {
    const saved = await kv.get(KEY(uid));
    return normalizeExpired(saved);
  } catch {
    return { ...DEFAULT_SUBSCRIPTION };
  }
}

export { KEY as SUBSCRIPTION_KEY, sanitizeUid };
