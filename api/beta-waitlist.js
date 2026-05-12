// ════════════════════════════════════════════════════════════════════
// Zepta — 베타 결제 알림 신청 API (2026-05-12)
// ──────────────────────────────────────────────────────────────────
// POST /api/beta-waitlist
//   body: { email?, uid?, targetTier?, useTrial?, requestedAt? }
//
// 베타 단계 Pricing 페이지에서 사용자가 "베타 알림 신청" 을 누르면
// KV `zepta:beta-waitlist:payment` 리스트에 항목을 적재합니다.
// 정식 결제 (토스 페이먼츠 / Stripe) 오픈 시 일괄 메일 발송 대상.
//
// 환경:
//   - KV (`KV_REST_API_URL`, `KV_REST_API_TOKEN`) 미설정 시
//     200 + storage:"none" 응답 (클라이언트 localStorage fallback).
// ════════════════════════════════════════════════════════════════════

const KV_LIST_KEY = "zepta:beta-waitlist:payment";

function sanitize(s, max = 200) {
  return String(s == null ? "" : s).slice(0, max);
}

function isValidEmail(e) {
  if (!e) return true; // 이메일은 선택값
  return typeof e === "string" && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);
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

  const email = sanitize(body.email, 200);
  const uid = sanitize(body.uid, 64);
  const targetTier = sanitize(body.targetTier, 24);
  const useTrial = !!body.useTrial;
  const requestedAt = sanitize(body.requestedAt, 40) || new Date().toISOString();

  if (!isValidEmail(email)) {
    return res.status(400).json({ ok: false, error: "Invalid email" });
  }
  if (!email && !uid) {
    return res.status(400).json({ ok: false, error: "email 또는 uid 중 하나는 필수입니다." });
  }

  const entry = {
    email: email || null,
    uid: uid || null,
    targetTier: targetTier || null,
    useTrial,
    requestedAt,
    userAgent: sanitize(req.headers?.["user-agent"] || "", 200),
    ip: sanitize(req.headers?.["x-forwarded-for"] || req.socket?.remoteAddress || "", 64),
  };

  const kv = await getKv();
  if (!kv) {
    // KV 미설정 — 클라이언트 localStorage fallback 으로 충분. 성공 응답.
    return res.status(200).json({ ok: true, storage: "none", entry });
  }

  try {
    // 리스트 우측 push (정식 오픈 시 LRANGE 로 일괄 조회 후 발송)
    await kv.rpush(KV_LIST_KEY, JSON.stringify(entry));
    // 중복 알림 방지용 set (이메일 또는 uid 기반)
    if (email) {
      await kv.sadd(`${KV_LIST_KEY}:emails`, email.toLowerCase());
    }
    if (uid) {
      await kv.sadd(`${KV_LIST_KEY}:uids`, uid);
    }
    return res.status(200).json({ ok: true, storage: "kv", entry });
  } catch (e) {
    // KV 장애 시에도 클라이언트 UX 유지를 위해 200 fallback
    return res.status(200).json({
      ok: true,
      storage: "none",
      entry,
      warning: `KV 적재 실패 (${e?.message || "unknown"}). localStorage fallback 권장.`,
    });
  }
}
