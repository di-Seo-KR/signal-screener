// Vercel Serverless — 봇별 성과 데이터 API
// KV에 저장된 봇별 거래 기록 + 포지션 스냅샷을 조회
// GET /api/bot-performance?botId=btc-alpha  → 단일 봇
// GET /api/bot-performance?all=1            → 전체 봇

export default async function handler(req, res) {
  try {
    const kvModule = await import("@vercel/kv");
    const kv = kvModule.kv;

    const { botId, all } = req.query;

    // 전체 봇 조회
    if (all === "1" || all === "true") {
      const botIds = [
        // 크립토 봇
        "btc-alpha", "highcap-momentum", "defi-infra",
        "meme-trend", "l2-emerging", "crypto-diversity", "crypto-swing",
        // 주식 봇
        "us-stable", "us-balanced", "us-aggressive", "us-trend", "us-meanrev",
      ];
      const results = {};
      for (const id of botIds) {
        const [perf, snapshot] = await Promise.all([
          kv.get(`di:bot:${id}:perf`),
          kv.get(`di:bot:${id}:snapshot`),
        ]);
        if (perf || snapshot) {
          results[id] = { perf: perf || null, snapshot: snapshot || null };
        }
      }
      return res.status(200).json({ ok: true, bots: results });
    }

    // 단일 봇 조회
    if (botId) {
      const [perf, snapshot] = await Promise.all([
        kv.get(`di:bot:${botId}:perf`),
        kv.get(`di:bot:${botId}:snapshot`),
      ]);
      return res.status(200).json({
        ok: true,
        botId,
        perf: perf || { botId, trades: [], tradeCount: 0, realizedPL: 0 },
        snapshot: snapshot || { botId, marketValue: 0, unrealizedPL: 0, positionCount: 0, dd: 0, mdd: 0, history: [] },
      });
    }

    return res.status(400).json({ ok: false, error: "botId or all=1 required" });
  } catch (e) {
    return res.status(200).json({ ok: false, error: e.message });
  }
}
