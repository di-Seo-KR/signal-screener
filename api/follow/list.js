// ════════════════════════════════════════════════════════════════════
// Zepta — Follow List (카피트레이딩 — 법적 안전 모드)
// ────────────────────────────────────────────────────────────────────
// ⚠️ 법적 안전 가이드:
//   한국 자본시장법: 투자일임업 인가 없이 사용자 대신 매매 X.
//   이 API 는 "신호 알림" 과 "설정 복사 (1회)" 만 다룬다.
//   자동 미러 매매는 절대 처리하지 않는다.
//
// 엔드포인트:
//   GET  /api/follow/list?uid=<uid>           → 본인 팔로우 목록
//   POST /api/follow/list                     → 추가/해제/모드 변경
//        body: { uid, action, targetBotId, mode, ackDisclaimer }
//        action: "add" | "remove" | "set-mode"
//        mode:   "alert" | "copy"
//        ackDisclaimer: true  ← add 시 필수 (면책 동의)
//
// KV 스키마:
//   di:follow:<uid>                   [{ targetBotId, mode, followedAt, ackDisclaimer }]
//   di:follow:followers:<botId>       [uid1, uid2, ...]  (역 인덱스, notify 발송용)
//
// 최대 팔로우: 20개 / uid
// ════════════════════════════════════════════════════════════════════

const MAX_FOLLOWS_PER_USER = 20;
const ALLOWED_MODES = ["alert", "copy"];

// 카피트레이딩 가능한 봇 — 공개 (leaderboard 에 노출되는 서비스 봇 + 향후 사용자 봇)
const ALLOWED_BOT_IDS = new Set([
  "btc-alpha", "highcap-momentum", "defi-infra", "meme-trend",
  "l2-emerging", "crypto-diversity", "crypto-swing",
  "stable-quant", "balanced-quant", "aggressive-quant",
  "trend-follow", "mean-reversion", "ensemble-signal",
]);

function sanitizeUid(uid) {
  return String(uid || "guest").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64) || "guest";
}

function sanitizeBotId(id) {
  return String(id || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 48);
}

async function getKv() {
  try {
    if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) return null;
    const m = await import("@vercel/kv");
    return m.kv;
  } catch {
    return null;
  }
}

const FOLLOW_KEY = (uid) => `di:follow:${sanitizeUid(uid)}`;
const FOLLOWERS_KEY = (botId) => `di:follow:followers:${sanitizeBotId(botId)}`;
const FOLLOW_TTL = 365 * 24 * 60 * 60; // 1년

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(200).end();

  const kv = await getKv();
  if (!kv) {
    if (req.method === "GET") {
      return res.status(200).json({ ok: true, follows: [], storage: "none" });
    }
    return res.status(200).json({ ok: false, skipped: true, reason: "KV not configured" });
  }

  // ── GET: 본인 팔로우 목록 ──
  if (req.method === "GET") {
    try {
      const uid = sanitizeUid(req.query?.uid);
      if (!uid || uid === "guest") {
        return res.status(200).json({ ok: true, follows: [], guest: true });
      }
      const list = (await kv.get(FOLLOW_KEY(uid))) || [];
      const follows = Array.isArray(list) ? list : [];
      return res.status(200).json({
        ok: true,
        follows,
        count: follows.length,
        max: MAX_FOLLOWS_PER_USER,
      });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message, follows: [] });
    }
  }

  // ── POST: 팔로우 추가/해제/모드 변경 ──
  if (req.method === "POST") {
    try {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
      const uid = sanitizeUid(body.uid);
      if (!uid || uid === "guest") {
        return res.status(401).json({ ok: false, error: "로그인이 필요합니다." });
      }
      const action = String(body.action || "add");
      const targetBotId = sanitizeBotId(body.targetBotId);
      const mode = ALLOWED_MODES.includes(body.mode) ? body.mode : "alert";

      if (!targetBotId || !ALLOWED_BOT_IDS.has(targetBotId)) {
        return res.status(400).json({ ok: false, error: "유효하지 않은 봇 ID 입니다." });
      }

      const currentList = (await kv.get(FOLLOW_KEY(uid))) || [];
      let list = Array.isArray(currentList) ? currentList.slice() : [];

      if (action === "add") {
        // 면책 동의 필수 (법적 안전장치)
        if (body.ackDisclaimer !== true) {
          return res.status(400).json({
            ok: false,
            error: "면책 동의가 필요합니다.",
            requiresAck: true,
          });
        }
        if (list.length >= MAX_FOLLOWS_PER_USER) {
          return res.status(400).json({ ok: false, error: `최대 ${MAX_FOLLOWS_PER_USER}개까지 팔로우할 수 있어요.` });
        }
        if (list.some(f => f.targetBotId === targetBotId)) {
          return res.status(200).json({ ok: true, alreadyFollowing: true, follows: list });
        }
        list.unshift({
          targetBotId,
          mode,
          followedAt: new Date().toISOString(),
          ackDisclaimer: true,
        });
        await kv.set(FOLLOW_KEY(uid), list, { ex: FOLLOW_TTL });

        // 역 인덱스 업데이트 (알림 발송용)
        const followers = (await kv.get(FOLLOWERS_KEY(targetBotId))) || [];
        const fSet = new Set(Array.isArray(followers) ? followers : []);
        fSet.add(uid);
        await kv.set(FOLLOWERS_KEY(targetBotId), Array.from(fSet), { ex: FOLLOW_TTL });

        return res.status(200).json({ ok: true, action: "added", follows: list });
      }

      if (action === "remove") {
        const filtered = list.filter(f => f.targetBotId !== targetBotId);
        await kv.set(FOLLOW_KEY(uid), filtered, { ex: FOLLOW_TTL });

        // 역 인덱스에서 제거
        const followers = (await kv.get(FOLLOWERS_KEY(targetBotId))) || [];
        const filteredFollowers = (Array.isArray(followers) ? followers : []).filter(u => u !== uid);
        await kv.set(FOLLOWERS_KEY(targetBotId), filteredFollowers, { ex: FOLLOW_TTL });

        return res.status(200).json({ ok: true, action: "removed", follows: filtered });
      }

      if (action === "set-mode") {
        const updated = list.map(f => f.targetBotId === targetBotId ? { ...f, mode } : f);
        await kv.set(FOLLOW_KEY(uid), updated, { ex: FOLLOW_TTL });
        return res.status(200).json({ ok: true, action: "mode-set", follows: updated });
      }

      return res.status(400).json({ ok: false, error: "알 수 없는 action 입니다." });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  return res.status(405).json({ ok: false, error: "Method not allowed" });
}

// ── 외부 모듈용 헬퍼 ─────────────────────────────────────────────────
export async function listFollowersForBot(botId) {
  const kv = await getKv();
  if (!kv) return [];
  const followers = (await kv.get(FOLLOWERS_KEY(botId))) || [];
  return Array.isArray(followers) ? followers : [];
}

export async function getFollowForUser(uid, targetBotId) {
  const kv = await getKv();
  if (!kv) return null;
  const list = (await kv.get(FOLLOW_KEY(uid))) || [];
  return (Array.isArray(list) ? list : []).find(f => f.targetBotId === targetBotId) || null;
}
