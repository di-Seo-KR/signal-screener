// GET /api/binance/positions?userId=xxx[&symbol=BTCUSDT]
// 유저의 현재 Futures 포지션 (amt != 0 인 것만).

import { loadUserCredentials, respondError } from "../_shared/binance-auth.js";
import { getPositionRisk } from "../_shared/binance-client.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { apiKey, apiSecret, testnet } = await loadUserCredentials(req.query.userId, req);
    const symbol = req.query.symbol;
    const raw = await getPositionRisk({ apiKey, apiSecret, symbol, testnet });

    const positions = (raw || [])
      .filter(p => parseFloat(p.positionAmt || 0) !== 0)
      .map(p => {
        const amt = parseFloat(p.positionAmt);
        const entry = parseFloat(p.entryPrice || 0);
        const mark = parseFloat(p.markPrice || 0);
        const unrealized = parseFloat(p.unRealizedProfit || 0);
        const notional = Math.abs(amt) * mark;
        const leverage = parseFloat(p.leverage || 1);
        const side = amt > 0 ? "LONG" : "SHORT";
        const initialMargin = leverage > 0 ? notional / leverage : 0;
        const roi = initialMargin > 0 ? (unrealized / initialMargin) * 100 : 0;
        return {
          symbol: p.symbol,
          side,
          positionAmt: amt,
          entryPrice: entry,
          markPrice: mark,
          liquidationPrice: parseFloat(p.liquidationPrice || 0),
          leverage,
          marginType: p.marginType, // "isolated" | "cross"
          isolatedMargin: parseFloat(p.isolatedMargin || 0),
          notional,
          unrealizedProfit: unrealized,
          roiPct: Number(roi.toFixed(2)),
          updateTime: p.updateTime,
        };
      });

    const totals = positions.reduce(
      (acc, p) => ({
        notional: acc.notional + p.notional,
        unrealized: acc.unrealized + p.unrealizedProfit,
      }),
      { notional: 0, unrealized: 0 }
    );

    return res.status(200).json({
      ok: true,
      count: positions.length,
      totalNotional: totals.notional,
      totalUnrealizedProfit: totals.unrealized,
      positions,
    });
  } catch (err) {
    return respondError(res, err);
  }
}
