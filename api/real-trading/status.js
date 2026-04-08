// api/real-trading/status.js
//
// 프론트엔드용 실전매매 상태 요약 엔드포인트.
//
// GET ?userId=...
// →
// {
//   ok: true,
//   userId,
//   phase1Enabled, killswitchOn, halted,
//   equity,
//   openPositions: [...],
//   recentEngineLog: [...],  // 최근 10건
//   recentOrders: [...],     // 최근 10건
//   breaker: {...},
// }

import { loadUserCredentials, respondError } from "../_shared/binance-auth.js";
import { getAccountInfo, getPositionRisk } from "../_shared/binance-client.js";
import { isKillSwitchEnabled, getBreakerState } from "../_shared/circuit-breaker.js";

async function getKv() {
  return (await import("@vercel/kv")).kv;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    const userId = req.query?.userId;
    if (!userId) return res.status(400).json({ error: "userId required" });

    const kv = await getKv();
    const [killed, phase1, breaker, engineLog, orders] = await Promise.all([
      isKillSwitchEnabled(userId),
      kv.get(`di:real:user:${userId}:phase1_enabled`),
      getBreakerState(userId),
      kv.get(`di:real:user:${userId}:engine-log`),
      kv.get(`di:real:user:${userId}:orders`),
    ]);

    let equity = null;
    let openPositions = [];
    try {
      const creds = await loadUserCredentials(userId);
      const [acct, positions] = await Promise.all([
        getAccountInfo(creds),
        getPositionRisk(creds),
      ]);
      equity = parseFloat(acct.totalWalletBalance || "0");
      openPositions = (positions || [])
        .filter((p) => Math.abs(parseFloat(p.positionAmt || 0)) > 0)
        .map((p) => ({
          symbol: p.symbol,
          positionAmt: parseFloat(p.positionAmt),
          entryPrice: parseFloat(p.entryPrice),
          markPrice: parseFloat(p.markPrice),
          unRealizedProfit: parseFloat(p.unRealizedProfit),
          leverage: parseFloat(p.leverage),
        }));
    } catch (e) {
      // 키 없거나 인증 실패여도 status 는 리턴
    }

    return res.status(200).json({
      ok: true,
      userId,
      phase1Enabled: !!phase1,
      killswitchOn: killed,
      halted: !!breaker?.halted,
      haltedReason: breaker?.haltedReason || null,
      equity,
      openPositions,
      recentEngineLog: (engineLog || []).slice(0, 10),
      recentOrders: (orders || []).slice(0, 10),
      breaker,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    return respondError(res, err);
  }
}
