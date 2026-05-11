// ════════════════════════════════════════════════════════════════════
// Zepta — 알림 설정 API
// ──────────────────────────────────────────────────────────────────
// GET  /api/notifications/preferences?uid=<userId>
// POST /api/notifications/preferences  body: { uid, prefs }
//
// KV 스키마:
//   di:notifications:prefs:<uid>
//     {
//       price: { enabled, threshold_pct },          // 예: 5 → 5% 변동 시
//       signal: { enabled, min_score },              // 예: 80 → score 80 이상
//       news: { enabled, min_impact },               // "low" | "medium" | "high"
//       portfolio: { enabled, threshold_pct },       // 예: -5 → -5% 도달
//       channels: { telegram, email, push },          // boolean
//       updatedAt
//     }
//
// 기본값은 보수적으로 — 사용자가 명시적으로 켜야 알림이 갑니다.
// ════════════════════════════════════════════════════════════════════

const KEY = (uid) => `di:notifications:prefs:${sanitizeUid(uid)}`;

const DEFAULT_PREFS = {
  price: { enabled: false, threshold_pct: 5 },
  signal: { enabled: true, min_score: 80 },
  news: { enabled: true, min_impact: "high" },
  portfolio: { enabled: false, threshold_pct: -5 },
  channels: { telegram: false, email: false, push: true },
  updatedAt: null,
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

function mergePrefs(saved, incoming) {
  const base = { ...DEFAULT_PREFS, ...(saved || {}) };
  if (!incoming || typeof incoming !== "object") return base;

  const out = { ...base };
  if (incoming.price) out.price = { ...base.price, ...incoming.price };
  if (incoming.signal) out.signal = { ...base.signal, ...incoming.signal };
  if (incoming.news) out.news = { ...base.news, ...incoming.news };
  if (incoming.portfolio) out.portfolio = { ...base.portfolio, ...incoming.portfolio };
  if (incoming.channels) out.channels = { ...base.channels, ...incoming.channels };

  // ── 입력 검증 (서버 측 방어) ──
  out.price.threshold_pct = clampNumber(out.price.threshold_pct, 0.1, 100, 5);
  out.signal.min_score = clampNumber(out.signal.min_score, 0, 100, 80);
  out.portfolio.threshold_pct = clampNumber(out.portfolio.threshold_pct, -100, 100, -5);
  if (!["low", "medium", "high"].includes(out.news.min_impact)) out.news.min_impact = "high";

  out.price.enabled = !!out.price.enabled;
  out.signal.enabled = !!out.signal.enabled;
  out.news.enabled = !!out.news.enabled;
  out.portfolio.enabled = !!out.portfolio.enabled;
  out.channels.telegram = !!out.channels.telegram;
  out.channels.email = !!out.channels.email;
  out.channels.push = !!out.channels.push;

  out.updatedAt = new Date().toISOString();
  return out;
}

function clampNumber(v, min, max, fallback) {
  const n = Number(v);
  if (!isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const kv = await getKv();
  const uid = sanitizeUid(req.query?.uid || (req.body && req.body.uid));
  const key = KEY(uid);

  if (req.method === "GET") {
    if (!kv) return res.status(200).json({ ok: true, prefs: DEFAULT_PREFS, storage: "default" });
    try {
      const saved = await kv.get(key);
      return res.status(200).json({
        ok: true,
        prefs: { ...DEFAULT_PREFS, ...(saved || {}) },
        storage: saved ? "kv" : "default",
      });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message, prefs: DEFAULT_PREFS });
    }
  }

  if (req.method === "POST") {
    if (!kv) return res.status(200).json({ ok: false, skipped: true, reason: "KV not configured" });
    try {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
      const saved = (await kv.get(key)) || {};
      const merged = mergePrefs(saved, body.prefs || {});
      await kv.set(key, merged, { ex: 365 * 24 * 60 * 60 });
      return res.status(200).json({ ok: true, prefs: merged });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}

// 외부 모듈에서 prefs 조회 (cron 등이 사용)
export async function getPrefs(uid) {
  const kv = await getKv();
  if (!kv) return DEFAULT_PREFS;
  try {
    const saved = await kv.get(KEY(uid));
    return { ...DEFAULT_PREFS, ...(saved || {}) };
  } catch {
    return DEFAULT_PREFS;
  }
}

export { DEFAULT_PREFS };
