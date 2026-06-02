// GET /api/binance/balance?userId=xxx
// 유저의 Futures 계정 잔고 요약.

import { loadUserCredentials, respondError } from "../_shared/binance-auth.js";
import { getAccountInfo } from "../_shared/binance-client.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { apiKey, apiSecret, testnet } = await loadUserCredentials(req.query.userId, req);
    const account = await getAccountInfo({ apiKey, apiSecret, testnet });

    const assets = (account.assets || [])
      .filter(a => parseFloat(a.walletBalance || 0) > 0)
      .map(a => ({
        asset: a.asset,
        walletBalance: parseFloat(a.walletBalance),
        unrealizedProfit: parseFloat(a.unrealizedProfit || 0),
        marginBalance: parseFloat(a.marginBalance || 0),
        availableBalance: parseFloat(a.availableBalance || 0),
      }));

    return res.status(200).json({
      ok: true,
      totalWalletBalance: parseFloat(account.totalWalletBalance || 0),
      totalUnrealizedProfit: parseFloat(account.totalUnrealizedProfit || 0),
      totalMarginBalance: parseFloat(account.totalMarginBalance || 0),
      availableBalance: parseFloat(account.availableBalance || 0),
      maxWithdrawAmount: parseFloat(account.maxWithdrawAmount || 0),
      feeTier: account.feeTier,
      canTrade: account.canTrade,
      assets,
    });
  } catch (err) {
    return respondError(res, err);
  }
}
