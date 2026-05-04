// 활성 봇 목록 KV 동기화 API
// 프론트엔드에서 봇 활성화/비활성화 시 호출
// btc-cron이 이 KV 키를 읽어서 해당 봇의 자산만 매매
//
// ★ 2026-05-03 — UPSERT 모드로 전환 (이전 overwrite 모드 버그)
//   기존: 프론트 payload 그대로 덮어쓰기 → 사용자가 1봇만 활성화하면
//        master cron 리스트가 1봇으로 줄어듦 → 시그널 다양성 붕괴
//   현재: 기존 KV 와 payload 를 botId 로 merge → 사용자 토글은 active/
//        allocation 필드만 갱신, 봇 entry 자체는 보존.
//   봇을 cron 에서 완전히 제거하려면 sync-active-bots 가 아니라
//   별도 admin endpoint 사용 (실수 방지).

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const { activeBots, mode } = req.body || {};
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

    const existing = (await kv.get("di:active-bots")) || [];
    let merged;
    let removed = [];

    if (mode === "replace") {
      // 명시적 replace 모드 (admin 용 — 안전 폴백)
      merged = validBots;
    } else {
      // ★ 기본 UPSERT 모드 — botId 기준 merge
      const byId = new Map();
      for (const e of existing) {
        const id = e.id || e.botId;
        if (id) byId.set(id, e);
      }
      const updated = [];
      for (const b of validBots) {
        const id = b.id || b.botId;
        const existed = byId.get(id);
        byId.set(id, {
          ...existed,
          ...b,
          id,
          botId: id,
          // 기존에 있던 봇이 payload 에 없을 시 active 변경 안 함 (보존)
        });
        if (existed) updated.push(id);
      }
      merged = Array.from(byId.values());
      const payloadIds = new Set(validBots.map((b) => b.id || b.botId));
      removed = existing
        .map((b) => b.id || b.botId)
        .filter((id) => id && !payloadIds.has(id));
    }

    await kv.set("di:active-bots", merged);

    return res.status(200).json({
      ok: true,
      mode: mode === "replace" ? "replace" : "upsert",
      payloadCount: validBots.length,
      mergedCount: merged.length,
      preservedFromExisting: removed.length, // payload 에 없지만 보존된 봇 수
      preservedIds: removed.slice(0, 20),
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
