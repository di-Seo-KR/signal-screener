// 활성 봇 목록 KV 동기화 API
// 프론트엔드에서 봇 활성화/비활성화 시 호출
// btc-cron이 이 KV 키를 읽어서 해당 봇의 자산만 매매

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const { activeBots } = req.body || {};
    if (!Array.isArray(activeBots)) {
      return res.status(400).json({ ok: false, error: "activeBots must be an array" });
    }

    // 입력 검증: 각 봇에 botId와 allocation 필수
    const validBots = activeBots.filter(ab => {
      if (!ab || typeof ab.botId !== "string" || !ab.botId) return false;
      if (typeof ab.allocation !== "number" || ab.allocation < 0) return false;
      return true;
    });
    if (validBots.length !== activeBots.length) {
      console.warn(`⚠️ sync-active-bots: ${activeBots.length - validBots.length}개 잘못된 항목 필터링됨`);
    }

    const kvModule = await import("@vercel/kv");
    const kv = kvModule.kv;

    // 봇 ID 목록만 저장 (allocation 등 메타데이터 포함)
    await kv.set("di:active-bots", validBots);

    return res.status(200).json({ ok: true, count: activeBots.length });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
