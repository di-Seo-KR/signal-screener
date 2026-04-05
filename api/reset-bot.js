// 단일 봇 KV 데이터 초기화 API
// POST /api/reset-bot  body: { botId: "btc-alpha" }
// 봇 생성 시 또는 삭제 시 호출하여 이전 거래/스냅샷 데이터 제거

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const { botId } = req.body || {};
    if (!botId || typeof botId !== "string") {
      return res.status(400).json({ ok: false, error: "botId required" });
    }

    const kvModule = await import("@vercel/kv");
    const kv = kvModule.kv;

    // 봇 성과 데이터 삭제
    await kv.del(`di:bot:${botId}:perf`);
    // 봇 스냅샷 데이터 삭제
    await kv.del(`di:bot:${botId}:snapshot`);

    return res.status(200).json({ ok: true, botId, message: `${botId} 데이터 초기화 완료` });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
