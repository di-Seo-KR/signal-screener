// ════════════════════════════════════════════════════════════════════
// Zepta — 통합 알림 센터 API
// ──────────────────────────────────────────────────────────────────
// GET  /api/notifications/list?uid=<userId>&limit=50&category=&unread=1
//      → 사용자의 누적 알림 조회 (최근순)
// POST /api/notifications/list
//      body: { uid, action: "push" | "read" | "read-all" | "clear",
//              notification?, id? }
//      → 알림 추가 / 읽음 처리 / 전체 삭제
//
// KV 스키마:
//   di:notifications:user:<uid>  (List, LPUSH)
//     [{ id, category, priority, title, summary, link, ts, read }, ...]
//     최근 100건만 보존 (LTRIM)
//
// category: "price" | "signal" | "news" | "portfolio" | "system" | "screener"
// priority: "high" | "medium" | "low"
// ════════════════════════════════════════════════════════════════════

const KEY = (uid) => `di:notifications:user:${sanitizeUid(uid)}`;
const MAX_NOTIFICATIONS = 100;

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

function normalizeNotification(n) {
  return {
    id: n.id || `n_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    category: n.category || "system",
    priority: ["high", "medium", "low"].includes(n.priority) ? n.priority : "medium",
    title: String(n.title || "").slice(0, 120),
    summary: String(n.summary || "").slice(0, 280),
    symbol: n.symbol || null,
    link: n.link || null,
    ts: n.ts || new Date().toISOString(),
    read: !!n.read,
  };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const kv = await getKv();
  const uid = sanitizeUid(req.query?.uid || (req.body && req.body.uid));
  const key = KEY(uid);

  // ── GET: 조회 ──
  if (req.method === "GET") {
    const limit = Math.min(parseInt(req.query.limit || "50", 10) || 50, MAX_NOTIFICATIONS);
    const category = req.query.category || null;
    const unreadOnly = req.query.unread === "1";

    if (!kv) {
      return res.status(200).json({ ok: true, notifications: [], unreadCount: 0, storage: "none" });
    }

    try {
      const list = (await kv.get(key)) || [];
      let filtered = Array.isArray(list) ? list : [];
      if (category) filtered = filtered.filter(n => n.category === category);
      if (unreadOnly) filtered = filtered.filter(n => !n.read);
      const unreadCount = (Array.isArray(list) ? list : []).filter(n => !n.read).length;
      return res.status(200).json({
        ok: true,
        notifications: filtered.slice(0, limit),
        unreadCount,
        total: Array.isArray(list) ? list.length : 0,
        storage: "kv",
      });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message, notifications: [] });
    }
  }

  // ── POST: 변경 ──
  if (req.method === "POST") {
    try {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
      const action = body.action || "push";

      if (!kv) {
        return res.status(200).json({ ok: false, skipped: true, reason: "KV not configured" });
      }

      const current = (await kv.get(key)) || [];
      const list = Array.isArray(current) ? current : [];

      if (action === "push") {
        const n = normalizeNotification(body.notification || {});
        list.unshift(n);
        const trimmed = list.slice(0, MAX_NOTIFICATIONS);
        await kv.set(key, trimmed, { ex: 90 * 24 * 60 * 60 });
        return res.status(200).json({ ok: true, notification: n, total: trimmed.length });
      }

      if (action === "read") {
        const id = body.id;
        const updated = list.map(n => (n.id === id ? { ...n, read: true } : n));
        await kv.set(key, updated, { ex: 90 * 24 * 60 * 60 });
        return res.status(200).json({ ok: true });
      }

      if (action === "read-all") {
        const updated = list.map(n => ({ ...n, read: true }));
        await kv.set(key, updated, { ex: 90 * 24 * 60 * 60 });
        return res.status(200).json({ ok: true, count: updated.length });
      }

      if (action === "clear") {
        await kv.del(key);
        return res.status(200).json({ ok: true });
      }

      if (action === "delete") {
        const id = body.id;
        const updated = list.filter(n => n.id !== id);
        await kv.set(key, updated, { ex: 90 * 24 * 60 * 60 });
        return res.status(200).json({ ok: true });
      }

      return res.status(400).json({ ok: false, error: "unknown action" });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}

// ── 외부 모듈에서 푸시할 때 공용 헬퍼 (cron / agent 가 import 해서 사용) ──
export async function pushNotification(uid, notification) {
  const kv = await getKv();
  if (!kv) return { ok: false, skipped: true };
  const key = KEY(uid);
  try {
    const current = (await kv.get(key)) || [];
    const list = Array.isArray(current) ? current : [];
    const n = normalizeNotification(notification);
    list.unshift(n);
    const trimmed = list.slice(0, MAX_NOTIFICATIONS);
    await kv.set(key, trimmed, { ex: 90 * 24 * 60 * 60 });
    return { ok: true, notification: n };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
