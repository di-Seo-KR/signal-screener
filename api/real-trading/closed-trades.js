// GET /api/real-trading/closed-trades?userId=xxx&days=40
// 청산(실현) 거래 내역 — 승률·손익비·Sharpe 집계용.
//   문제: di:real:user:<uid>:orders 는 *진입 주문*만 기록(pnl 없음) → 상세분석의
//   승률/손익비/안정성이 항상 "—" 로 떴음.
//   해결: 바이낸스 income(REALIZED_PNL)에서 실제 청산 손익을 가져온다. 각 레코드 = 청산 이벤트.
//   (FUNDING_FEE·COMMISSION 은 net 표시용으로 합산 옵션 제공.)

import { loadUserCredentials, respondError } from "../_shared/binance-auth.js";
import { getIncome } from "../_shared/binance-client.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "private, no-store"); // ★ 사용자 실현손익 데이터 — 캐시 원천 차단
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    const userId = req.query.userId;
    const { apiKey, apiSecret, testnet } = await loadUserCredentials(userId, req); // 인증 게이트
    const days = Math.min(parseInt(req.query.days, 10) || 40, 90);
    const startTime = Date.now() - days * DAY_MS;

    let rows = [];
    try {
      rows = await getIncome({ apiKey, apiSecret, incomeType: "REALIZED_PNL", startTime, limit: 1000, testnet });
    } catch (e) {
      return res.status(200).json({ ok: true, available: false, reason: e?.message || String(e), trades: [], count: 0 });
    }

    const trades = (Array.isArray(rows) ? rows : [])
      .map((r) => ({ symbol: r.symbol || "", pnl: Number(r.income) || 0, time: Number(r.time) || 0 }))
      .filter((t) => t.time > 0 && t.pnl !== 0)   // 손익 0(수수료 없는 평가) 제외
      .sort((a, b) => b.time - a.time);

    const wins = trades.filter((t) => t.pnl > 0).length;
    const losses = trades.filter((t) => t.pnl < 0).length;
    const netPnL = trades.reduce((s, t) => s + t.pnl, 0);

    return res.status(200).json({
      ok: true,
      available: true,
      trades,                       // [{ symbol, pnl, time }] 최신순
      count: trades.length,
      wins, losses,
      netPnL: Number(netPnL.toFixed(2)),
      note: "REALIZED_PNL income 기준. 부분청산은 여러 레코드가 될 수 있음(승률 근사).",
    });
  } catch (err) {
    return respondError(res, err);
  }
}
