// ════════════════════════════════════════════════════════════════════
// /api/real-trading/seed-bots
// di:active-bots KV 에 모든 크립토 봇을 멱등 등록.
//
// 배경: 2026-05-03 진단 — 활성 봇 1개(highcap-momentum)만 가동돼서 모든
// 시그널이 한 종목(AVAXUSDT)에 집중. 다양성 부재로 dedup 후 candidate 1개,
// dedup 차단으로 ran:false. 7개 봇 모두 활성화하면 시그널 종목 자연 분산.
//
// 사용:
//   GET /api/real-trading/seed-bots          ← 멱등 등록
//   GET /api/real-trading/seed-bots?dryRun=1 ← 결과만 미리보기
// ════════════════════════════════════════════════════════════════════

const ALL_CRYPTO_BOTS = [
  { id: "btc-alpha", name: "BTC Alpha", universe: ["BTCUSDT"] },
  { id: "highcap-momentum", name: "하이캡 모멘텀", universe: ["BTCUSDT","ETHUSDT","SOLUSDT","XRPUSDT","ADAUSDT","AVAXUSDT"] },
  { id: "defi-infra", name: "DeFi 인프라", universe: ["LINKUSDT","UNIUSDT","AAVEUSDT","DOTUSDT"] },
  { id: "meme-trend", name: "밈 트렌드", universe: ["DOGEUSDT","SHIBUSDT","PEPEUSDT"] },
  { id: "l2-emerging", name: "L2 이머징", universe: ["ARBUSDT","OPUSDT","MATICUSDT"] },
  { id: "crypto-diversity", name: "크립토 다양화", universe: [] }, // 모든 종목
  { id: "crypto-swing", name: "크립토 스윙", universe: [] },
];

async function getKv() {
  return (await import("@vercel/kv")).kv;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const dryRun = req.query?.dryRun === "1" || req.query?.dryRun === "true";
  try {
    const kv = await getKv();
    const existing = (await kv.get("di:active-bots")) || [];
    const existingIds = new Set(existing.map((b) => b.id || b.botId).filter(Boolean));

    // ★ 자동 업그레이드 모드: 기존 봇 중 botId·allocation 누락된 항목을 보강
    //   초기 seed-bots 호출 시 id 만 저장됐는데 btc-cron 은 ab.botId 만 읽음 →
    //   기존 레코드를 한 번 정상화. 멱등 + 무손실 (기존 데이터 보존).
    const existingKeys = new Set();
    const upgraded = []; // 업그레이드된 봇 ID 목록
    const merged = existing.map((b) => {
      const id = b.id || b.botId;
      if (id) existingKeys.add(id);
      // 누락된 필드 자동 보강
      const def = ALL_CRYPTO_BOTS.find((x) => x.id === id);
      const needsUpgrade = (!b.botId && b.id) || b.allocation == null || !b.status;
      if (needsUpgrade && id) {
        upgraded.push(id);
        return {
          ...b,
          id,
          botId: id,
          name: b.name || def?.name || id,
          universe: b.universe || def?.universe || [],
          active: b.active !== false,
          status: b.status || "active",
          allocation: b.allocation || 1000,
          startedAt: b.startedAt || b.seededAt || new Date().toISOString(),
        };
      }
      return b;
    });

    // 누락된 봇 추가
    const toAdd = ALL_CRYPTO_BOTS.filter((b) => !existingKeys.has(b.id));
    for (const b of toAdd) {
      merged.push({
        id: b.id,
        botId: b.id,
        name: b.name,
        universe: b.universe,
        active: true,
        status: "active",
        allocation: 1000,
        startedAt: new Date().toISOString(),
        seededAt: new Date().toISOString(),
      });
    }

    if (dryRun) {
      return res.status(200).json({
        ok: true,
        dryRun: true,
        existingCount: existing.length,
        existingIds: Array.from(existingKeys),
        wouldAdd: toAdd.map((b) => b.id),
        wouldUpgrade: upgraded,
        finalCount: merged.length,
      });
    }

    if (toAdd.length > 0 || upgraded.length > 0) {
      await kv.set("di:active-bots", merged);
    }

    return res.status(200).json({
      ok: true,
      added: toAdd.map((b) => b.id),
      upgraded,
      already: Array.from(existingKeys).filter((id) => !upgraded.includes(id)),
      total: merged.length,
      message: (() => {
        const msgs = [];
        if (toAdd.length > 0) msgs.push(`${toAdd.length}개 봇 신규 등록`);
        if (upgraded.length > 0) msgs.push(`${upgraded.length}개 봇 정보 보강 (botId/allocation)`);
        if (msgs.length === 0) return "이미 모두 정상 등록됨";
        return msgs.join(", ") + " — 다음 15분 btc-cron 부터 다양한 종목 시그널 만들기 시작";
      })(),
    });
  } catch (err) {
    return res.status(200).json({ ok: false, error: err?.message || String(err) });
  }
}
