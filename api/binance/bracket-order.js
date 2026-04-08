// POST /api/binance/bracket-order
//
// 실전매매 원자적 주문 (진입 + SL + TP). executeOrderPlan 을 래핑.
// 기본값 dryRun=true. 명시적으로 false 로 설정해야 실거래.
//
// body:
// {
//   userId, symbol, side: "LONG"|"SHORT",
//   usdt, leverage, marginType,
//   stopLossPrice, takeProfitPrice,
//   clientOrderId,
//   dryRun: true  ← 기본값 true
// }

import { respondError } from "../_shared/binance-auth.js";
import { executeOrderPlan } from "./order.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const {
      userId, symbol, side,
      usdt, leverage = 5, marginType = "ISOLATED",
      stopLossPrice, takeProfitPrice,
      clientOrderId,
      dryRun = true, // ★ 안전 기본값
    } = body;

    if (!userId || !symbol || !side || typeof usdt !== "number") {
      return res.status(400).json({ error: "userId/symbol/side/usdt required" });
    }
    if (!["LONG", "SHORT"].includes(side)) return res.status(400).json({ error: "side must be LONG/SHORT" });
    if (usdt <= 0 || usdt > 1000) return res.status(400).json({ error: "usdt out of range (0, 1000]" });
    if (leverage < 1 || leverage > 25) return res.status(400).json({ error: "leverage 1~25 (Phase1 safety cap)" });

    const result = await executeOrderPlan({
      userId, symbol, side, usdt, leverage, marginType,
      dryRun, stopLossPrice, takeProfitPrice, clientOrderId,
    });
    return res.status(200).json(result);
  } catch (err) {
    return respondError(res, err);
  }
}
