// ════════════════════════════════════════════════════════════════════
// Zepta — Follow Copy Config (봇 설정 복사 — 1회성, 법적 안전 모드)
// ────────────────────────────────────────────────────────────────────
// ⚠️ 법적 안전 가이드:
//   설정 복사 = strategy/parameter 만 한 번 복사.
//   복사 이후 사용자 봇은 독립 운영 (실시간 미러링 X).
//   사용자가 언제든 본인 봇 설정 수정 가능.
//
// 엔드포인트:
//   POST /api/follow/copy-config
//        body: { uid, sourceBotId, targetUserBotId, ackDisclaimer }
//
// 동작:
//   1) source 봇 (di:bot:<sourceBotId>:config) 의 strategy/params 만 추출
//   2) target 사용자 봇 KV (di:user-bot:<uid>:<targetUserBotId>) 에 적용
//   3) 복사 이벤트 로그 (di:follow:copy-log:<uid>)
//
// 사용자 봇 KV 스키마 (간소):
//   di:user-bot:<uid>:<userBotId>  { strategy, params, allocation, createdAt, lastCopiedFrom, lastCopiedAt }
//
// 면책: ackDisclaimer === true 필수.
// 횟수 제한: 같은 source 봇은 1시간에 1회까지 (abuse 방지).
// ════════════════════════════════════════════════════════════════════

const ALLOWED_SOURCE_BOTS = new Set([
  "btc-alpha", "highcap-momentum", "defi-infra", "meme-trend",
  "l2-emerging", "crypto-diversity", "crypto-swing",
  "stable-quant", "balanced-quant", "aggressive-quant",
  "trend-follow", "mean-reversion", "ensemble-signal",
]);

const RATE_LIMIT_MS = 60 * 60 * 1000; // 1시간

function sanitizeUid(uid) {
  return String(uid || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
}
function sanitizeId(id) {
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

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const kv = await getKv();
  if (!kv) return res.status(200).json({ ok: false, skipped: true, reason: "KV not configured" });

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const uid = sanitizeUid(body.uid);
    const sourceBotId = sanitizeId(body.sourceBotId);
    const targetUserBotId = sanitizeId(body.targetUserBotId || `copy-${sourceBotId}`);

    if (!uid) return res.status(401).json({ ok: false, error: "로그인이 필요합니다." });
    if (!sourceBotId || !ALLOWED_SOURCE_BOTS.has(sourceBotId)) {
      return res.status(400).json({ ok: false, error: "유효하지 않은 원본 봇 입니다." });
    }
    if (body.ackDisclaimer !== true) {
      return res.status(400).json({
        ok: false,
        error: "면책 동의가 필요합니다.",
        requiresAck: true,
      });
    }

    // ── rate limit 체크 (같은 source 봇 1시간 1회) ──
    const logKey = `di:follow:copy-log:${uid}`;
    const log = (await kv.get(logKey)) || [];
    const arr = Array.isArray(log) ? log : [];
    const recent = arr.find(e => e.sourceBotId === sourceBotId && (Date.now() - Date.parse(e.copiedAt)) < RATE_LIMIT_MS);
    if (recent) {
      const remainMs = RATE_LIMIT_MS - (Date.now() - Date.parse(recent.copiedAt));
      return res.status(429).json({
        ok: false,
        error: `같은 봇은 1시간에 1번만 복사할 수 있어요. ${Math.ceil(remainMs / 60000)}분 후 다시 시도해주세요.`,
        retryInMs: remainMs,
      });
    }

    // ── source 봇 config 조회 ──
    // 다양한 스키마 fallback (perf 에도 strategy 가 있을 수 있음)
    let sourceConfig = await kv.get(`di:bot:${sourceBotId}:config`);
    if (!sourceConfig) {
      const perf = await kv.get(`di:bot:${sourceBotId}:perf`);
      const snapshot = await kv.get(`di:bot:${sourceBotId}:snapshot`);
      sourceConfig = {
        strategy: perf?.strategy || snapshot?.strategy || sourceBotId,
        params: perf?.params || snapshot?.params || {},
        family: perf?.family || snapshot?.family || null,
      };
    }
    if (!sourceConfig.strategy) {
      // 최종 fallback — botId 그 자체를 strategy 이름으로 간주
      sourceConfig.strategy = sourceBotId;
      sourceConfig.params = sourceConfig.params || {};
    }

    // ── target user-bot KV 에 복사 ──
    const targetKey = `di:user-bot:${uid}:${targetUserBotId}`;
    const existing = (await kv.get(targetKey)) || {};
    const updated = {
      ...existing,
      userBotId: targetUserBotId,
      strategy: sourceConfig.strategy,
      params: sourceConfig.params || {},
      family: sourceConfig.family || null,
      allocation: existing.allocation || 0,
      lastCopiedFrom: sourceBotId,
      lastCopiedAt: new Date().toISOString(),
      createdAt: existing.createdAt || new Date().toISOString(),
      ackDisclaimer: true,
    };
    await kv.set(targetKey, updated, { ex: 365 * 24 * 60 * 60 });

    // ── 복사 로그 누적 (최근 50건만) ──
    arr.unshift({
      sourceBotId,
      targetUserBotId,
      copiedAt: new Date().toISOString(),
      strategy: sourceConfig.strategy,
    });
    await kv.set(logKey, arr.slice(0, 50), { ex: 365 * 24 * 60 * 60 });

    return res.status(200).json({
      ok: true,
      copied: {
        sourceBotId,
        targetUserBotId,
        strategy: sourceConfig.strategy,
        paramKeys: Object.keys(sourceConfig.params || {}),
      },
      message: "봇 설정이 복사됐어요. 이후 운영은 독립적으로 진행됩니다.",
    });
  } catch (e) {
    console.error("[follow/copy-config] fatal:", e);
    return res.status(500).json({ ok: false, error: e.message });
  }
}
