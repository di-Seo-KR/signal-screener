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

    const toAdd = ALL_CRYPTO_BOTS.filter((b) => !existingIds.has(b.id));
    const merged = [...existing];
    for (const b of toAdd) {
      merged.push({
        id: b.id,
        name: b.name,
        universe: b.universe,
        active: true,
        seededAt: new Date().toISOString(),
      });
    }

    if (dryRun) {
      return res.status(200).json({
        ok: true,
        dryRun: true,
        existingCount: existing.length,
        existingIds: Array.from(existingIds),
        wouldAdd: toAdd.map((b) => b.id),
        finalCount: merged.length,
      });
    }

    if (toAdd.length > 0) {
      await kv.set("di:active-bots", merged);
    }

    return res.status(200).json({
      ok: true,
      added: toAdd.map((b) => b.id),
      already: Array.from(existingIds),
      total: merged.length,
      message: toAdd.length > 0
        ? `${toAdd.length}개 봇 추가 활성화 — 다음 5분 cron 부터 다양한 종목 시그널 평가 시작`
        : "모든 봇 이미 활성화됨",
    });
  } catch (err) {
    return res.status(200).json({ ok: false, error: err?.message || String(err) });
  }
}
