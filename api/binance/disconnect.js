// POST /api/binance/disconnect
// 유저의 바이낸스 API 키 등록을 해제.
// 주의: 실전 봇이 돌아가고 있으면 먼저 봇을 정지시키고, 오픈 포지션/주문은 유저에게 알림.
//
// body: { "userId": "..." }

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const { userId } = body;
    if (!userId) return res.status(400).json({ error: "userId is required" });

    const kvModule = await import("@vercel/kv");
    const kv = kvModule.kv;

    const credKey = `di:real:user:${userId}:credentials`;
    const existing = await kv.get(credKey);
    if (!existing) {
      return res.status(404).json({ ok: false, error: "등록된 키가 없습니다." });
    }

    // 활성 실전 봇 확인 — 있으면 경고만 반환 (해제 강제는 force=true)
    const botsKey = `di:real:user:${userId}:bots`;
    const bots = (await kv.get(botsKey)) || [];
    const activeBots = Array.isArray(bots) ? bots.filter(b => b && b.status === "active") : [];
    if (activeBots.length > 0 && !body.force) {
      return res.status(409).json({
        ok: false,
        error: "활성 실전 봇이 있습니다. 먼저 봇을 정지하거나 force:true 로 강제 해제하세요.",
        activeBots: activeBots.map(b => ({ botId: b.botId, label: b.label })),
      });
    }

    // 키 삭제 (soft delete: 기록 보존용으로 revoked 상태만 표시하고 암호문은 삭제)
    const revoked = {
      ...existing,
      apiKeyEnc: null,
      apiSecretEnc: null,
      status: "revoked",
      revokedAt: new Date().toISOString(),
    };
    await kv.set(credKey, revoked);
    await kv.set(`di:real:user:${userId}:enabled`, false);

    return res.status(200).json({ ok: true, userId, revokedAt: revoked.revokedAt });
  } catch (err) {
    console.error("[binance/disconnect] error:", err);
    return res.status(500).json({ error: "Internal error", detail: err?.message || String(err) });
  }
}
