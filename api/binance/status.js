// GET /api/binance/status?userId=xxx
// 프론트가 자주 호출하는 가벼운 연결 상태 조회.
// 바이낸스에 실제로 요청하지 않고 KV만 조회 (rate limit 보호).
// 실검증은 /api/binance/verify 사용.

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    const userId = req.query.userId;
    if (!userId) return res.status(400).json({ error: "userId is required" });

    const kvModule = await import("@vercel/kv");
    const kv = kvModule.kv;

    const record = await kv.get(`di:real:user:${userId}:credentials`);
    const enabled = await kv.get(`di:real:user:${userId}:enabled`);

    if (!record || record.status === "revoked" || !record.apiKeyEnc) {
      return res.status(200).json({
        ok: true,
        connected: false,
        enabled: !!enabled,
      });
    }

    return res.status(200).json({
      ok: true,
      connected: true,
      enabled: !!enabled,
      userId,
      label: record.label,
      testnet: record.testnet,
      apiKeyMasked: record.apiKeyMasked,
      status: record.status,
      lastVerifiedAt: record.lastVerifiedAt,
      verification: record.verification || null,
    });
  } catch (err) {
    console.error("[binance/status] error:", err);
    return res.status(500).json({ error: "Internal error", detail: err?.message || String(err) });
  }
}
