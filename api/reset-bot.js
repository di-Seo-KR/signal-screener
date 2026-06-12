// 단일 봇 KV 데이터 초기화 API (★ 운영자 전용)
// POST /api/reset-bot  body: { botId: "btc-alpha", userId: "<owner-uuid>" }
//
// ★ 2026-06-12 (전수 감사 — 보안): 이전엔 무인증이라 누구나 임의 botId 의
//   글로벌 성과 키(di:bot:*:perf/snapshot — 리더보드·봇리포트·SEO 페이지의 원천)를
//   삭제할 수 있었음. 글로벌 봇 데이터는 cron 이 관리하는 공유 자산이므로
//   운영자만 초기화 가능하도록 잠금. (사용자 봇 활성화 시 호출도 제거됨 —
//   타 사용자의 리포트가 예고 없이 0부터 시작되던 부작용 동근원 해결)

const OWNER = process.env.ZEPTA_OWNER_USER_ID || "b707e106-8d92-499a-887b-e1ce0145033c";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  try {
    const { botId, userId } = req.body || {};
    if (!botId || typeof botId !== "string") {
      return res.status(400).json({ ok: false, error: "botId required" });
    }
    if (userId !== OWNER) {
      return res.status(403).json({ ok: false, error: "owner only — 글로벌 봇 데이터는 운영자만 초기화할 수 있습니다" });
    }

    const kvModule = await import("@vercel/kv");
    const kv = kvModule.kv;

    await kv.del(`di:bot:${botId}:perf`);
    await kv.del(`di:bot:${botId}:snapshot`);

    return res.status(200).json({ ok: true, botId, message: `${botId} 데이터 초기화 완료` });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
