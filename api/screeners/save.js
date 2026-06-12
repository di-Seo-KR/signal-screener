// ════════════════════════════════════════════════════════════════════
// Zepta — 스크리너 조건 저장 API
// ──────────────────────────────────────────────────────────────────
// POST /api/screeners/save  body: { uid, screener: {...} }
//   → 새 스크리너 추가 (id 미지정 시 자동 생성)
//   → id 지정 시 해당 항목 갱신
// DELETE /api/screeners/save  body: { uid, id }
//   → 삭제
// POST  body: { uid, id, action: "toggle-alert" }
//   → 알람 ON/OFF 토글
//
// KV 스키마:
//   di:saved-screeners:<uid>
//     [{ id, name, conditions, alert_enabled, created_at, last_matched_at, last_match_count }, ...]
//
// conditions 예시:
//   { rsi: { op: "<", value: 30 }, volume_ratio: { op: ">=", value: 1.5 }, market: "us" }
//
// Free 사용자는 3개 제한 (Pro 무제한 — 현재는 모든 사용자 Free 로 취급).
// ════════════════════════════════════════════════════════════════════

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

function newId() {
  return `scr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function sanitizeScreener(s) {
  return {
    id: s.id || newId(),
    name: String(s.name || "이름 없음").slice(0, 80),
    conditions: typeof s.conditions === "object" && s.conditions ? s.conditions : {},
    // ★ 2026-06-12 (전수 감사): 스크리너 UI 의 조건 키 배열 — 저장→재실행 루프용.
    //   기존 conditions(객체, 알림 모니터용)와 병행. 둘 중 하나만 있어도 동작.
    conditionKeys: Array.isArray(s.conditionKeys) ? s.conditionKeys.slice(0, 24).map(String) : undefined,
    mode: s.mode === "and" ? "and" : "or",
    alert_enabled: !!s.alert_enabled,
    created_at: s.created_at || new Date().toISOString(),
    last_matched_at: s.last_matched_at || null,
    last_match_count: typeof s.last_match_count === "number" ? s.last_match_count : 0,
  };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const kv = await getKv();
  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  const uid = sanitizeUid(body.uid);
  const key = KEY(uid);

  if (!kv) {
    return res.status(200).json({ ok: false, skipped: true, reason: "KV not configured" });
  }

  try {
    const current = (await kv.get(key)) || [];
    const list = Array.isArray(current) ? current : [];

    if (req.method === "DELETE") {
      const id = body.id;
      const updated = list.filter(s => s.id !== id);
      await kv.set(key, updated, { ex: 365 * 24 * 60 * 60 });
      return res.status(200).json({ ok: true, count: updated.length });
    }

    if (req.method === "POST") {
      // 액션 분기
      if (body.action === "toggle-alert") {
        const updated = list.map(s =>
          s.id === body.id ? { ...s, alert_enabled: !s.alert_enabled } : s
        );
        await kv.set(key, updated, { ex: 365 * 24 * 60 * 60 });
        return res.status(200).json({ ok: true });
      }

      // 저장/갱신
      const incoming = sanitizeScreener(body.screener || {});

      // 기존 id 가 있으면 업데이트
      const existingIdx = list.findIndex(s => s.id === incoming.id);
      if (existingIdx >= 0) {
        list[existingIdx] = { ...list[existingIdx], ...incoming };
        await kv.set(key, list, { ex: 365 * 24 * 60 * 60 });
        return res.status(200).json({ ok: true, screener: list[existingIdx], updated: true });
      }

      // Free 제한
      if (list.length >= FREE_LIMIT) {
        return res.status(403).json({
          ok: false,
          error: "FREE_LIMIT_REACHED",
          message: `무료 플랜은 최대 ${FREE_LIMIT}개까지만 저장할 수 있습니다.`,
          limit: FREE_LIMIT,
        });
      }

      list.unshift(incoming);
      await kv.set(key, list, { ex: 365 * 24 * 60 * 60 });

      // 활성 사용자 목록에 추가 (cron 이 순회할 풀)
      try {
        const users = (await kv.get("di:saved-screeners:users")) || [];
        if (Array.isArray(users) && !users.includes(uid)) {
          users.push(uid);
          await kv.set("di:saved-screeners:users", users.slice(-500), { ex: 365 * 24 * 60 * 60 });
        }
      } catch {}

      return res.status(200).json({ ok: true, screener: incoming, created: true });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}

export { FREE_LIMIT, sanitizeScreener };
