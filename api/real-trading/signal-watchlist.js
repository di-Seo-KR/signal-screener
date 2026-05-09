// api/real-trading/signal-watchlist.js
//
// 실거래 대시보드 — 진입 후보 시그널 워치리스트 (Widget 6).
// 활성 봇들의 최근 BUY 시그널을 수집해서 랭킹·dedup 한 결과를 반환.
// engine.js 와 같은 데이터 소스(di:bot:<id>:perf.trades)를 쓰지만
// 실행은 안 하고 "지금 진입 후보"만 보여준다.
//
// GET ?userId=...&limit=8&hours=4
//
// → { ok: true, signals: [{ symbol, asset, side, score, confidence, reason, source, ts }, ...], updatedAt }

import { rankSignals, extractSignal, normalizeAssetKey, ASSET_TO_SYMBOL } from "../_shared/signal-extractor.js";

async function getKv() {
  return (await import("@vercel/kv")).kv;
}

// AutoTrading.jsx 의 CRYPTO_BOTS id 와 동기화
const CRYPTO_BOT_IDS = new Set([
  "btc-alpha", "highcap-momentum", "defi-infra", "meme-trend",
  "l2-emerging", "crypto-diversity", "crypto-swing",
]);

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    const userId = req.query?.userId;
    if (!userId) return res.status(400).json({ error: "userId required" });
    const limit = Math.min(parseInt(req.query?.limit || "8", 10), 20);
    const hours = Math.min(parseInt(req.query?.hours || "4", 10), 24);

    const kv = await getKv();
    const activeBots = (await kv.get("di:active-bots")) || [];
    const cryptoBots = activeBots.filter((b) => CRYPTO_BOT_IDS.has(b.botId || b.id));

    if (cryptoBots.length === 0) {
      return res.status(200).json({
        ok: true,
        signals: [],
        message: "활성 크립토 봇이 없습니다.",
        updatedAt: new Date().toISOString(),
      });
    }

    const now = Date.now();
    const lookbackMs = hours * 60 * 60 * 1000;
    const minTs = now - lookbackMs;

    // 봇별 trades 수집 → BUY 만 + 시간창 + 봇별 자산 dedup
    const candidates = [];
    for (const b of cryptoBots) {
      const botId = b.botId || b.id;
      const perf = await kv.get(`di:bot:${botId}:perf`);
      if (!perf || !Array.isArray(perf.trades)) continue;
      const seen = new Set();
      for (const t of perf.trades.slice(0, 30)) {
        if (!t || !t.time || t.type !== "BUY") continue;
        const ts = new Date(t.time).getTime();
        if (!Number.isFinite(ts)) continue;
        if (ts < minTs) continue;
        if (seen.has(t.asset)) continue;
        seen.add(t.asset);
        candidates.push({
          asset: t.asset,
          source: `bot:${botId}`,
          signal: {
            type: "BUY",
            confidence: t.signal?.confidence || "B",
            score: t.signal?.score || 60,
            reason: t.signal?.reason || `${botId} BUY`,
            positionSize: 0.5,
          },
          ts,
        });
      }
    }

    // extractSignal 로 정규화 + rankSignals 로 자산 dedup·점수 정렬
    const canonical = candidates
      .map((c) => extractSignal(c, { strict: false }))
      .filter(Boolean);
    const ranked = rankSignals(canonical).slice(0, limit);

    // UI 친화 형태로 가공
    const signals = ranked.map((s) => {
      // confidence A/B/C → 0.85/0.65/0.45 같은 숫자로 변환
      const confMap = { A: 0.85, B: 0.65, C: 0.45 };
      const conf = typeof s.confidence === "number" ? s.confidence
                 : confMap[s.confidence] || 0.5;
      // score 정규화 (0~10 스케일로 추정)
      const rawScore = parseFloat(s.score || 0);
      const score10 = rawScore > 10 ? rawScore / 10 : rawScore;
      return {
        symbol: s.symbol || ASSET_TO_SYMBOL[normalizeAssetKey(s.asset)] || s.asset,
        asset: s.asset,
        side: s.side || s.type || "BUY",
        score: score10,
        confidence: conf,
        reason: (s.reason || "").slice(0, 80),
        source: s.source || "—",
        ts: s.ts,
      };
    });

    return res.status(200).json({
      ok: true,
      signals,
      activeBotsScanned: cryptoBots.length,
      lookbackHours: hours,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[signal-watchlist]", err);
    return res.status(500).json({ error: err?.message || String(err) });
  }
}
