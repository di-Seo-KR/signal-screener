// ════════════════════════════════════════════════════════════════════
// Zepta — 저장된 스크리너 목록 조회 API
// ──────────────────────────────────────────────────────────────────
// GET /api/screeners/list?uid=<userId>
//
// 반환:
//   { ok, screeners: [...], suggested: [...], limit, plan }
//
// suggested: 사용자가 추천 조건 4개 중 아직 저장하지 않은 것
// (스크리너 페이지의 "+추천 조건" 버튼이 이 목록을 활용)
// ════════════════════════════════════════════════════════════════════

import { SUGGESTED_SCREENERS } from "./suggested.js";

const KEY = (uid) => `di:saved-screeners:${sanitizeUid(uid)}`;
const FREE_LIMIT = 3;

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
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const kv = await getKv();
  const uid = sanitizeUid(req.query?.uid);

  if (!kv) {
    return res.status(200).json({
      ok: true,
      screeners: [],
      suggested: SUGGESTED_SCREENERS,
      limit: FREE_LIMIT,
      plan: "free",
      storage: "none",
    });
  }

  try {
    const list = (await kv.get(KEY(uid))) || [];
    const saved = Array.isArray(list) ? list : [];
    const savedTemplateIds = new Set(saved.map(s => s.template_id).filter(Boolean));
    const suggested = SUGGESTED_SCREENERS.filter(s => !savedTemplateIds.has(s.template_id));

    return res.status(200).json({
      ok: true,
      screeners: saved,
      suggested,
      limit: FREE_LIMIT,
      plan: "free",
      storage: "kv",
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message, screeners: [], suggested: SUGGESTED_SCREENERS });
  }
}
