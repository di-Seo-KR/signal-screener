// GET /api/real-trading/position-plans?userId=xxx
// 현재 열린 포지션별로 *봇이 저장한 실제 plan*(슬리피지 없는 정확한 익절/손절가)을 반환.
//   plan 출처: di:real:user:<uid>:plan:<symbol> (engine 진입 시 저장, position-monitor 가 사용).
//   추정이 아니라 봇이 실제로 들고 있는 tpPrice/slPrice 를 보여준다.
//   plan 이 없는 포지션(수동 진입 등)은 hasPlan=false → 봇이 익절/손절 관리 안 함.

import { loadUserCredentials, respondError } from "../_shared/binance-auth.js";
import { getPositionRisk } from "../_shared/binance-client.js";

async function getKv() { return (await import("@vercel/kv")).kv; }

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "private, no-store"); // ★ 사용자 자산 데이터 — 캐시 원천 차단
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    const userId = req.query.userId;
    const { apiKey, apiSecret, testnet } = await loadUserCredentials(userId, req); // 인증 게이트
    const raw = await getPositionRisk({ apiKey, apiSecret, testnet });
    const kv = await getKv();

    const open = (raw || []).filter((p) => parseFloat(p.positionAmt || 0) !== 0);
    // ★ 2026-06-12 성능: 포지션별 직렬 kv.get(N+1) → mget 1회 왕복 (N=8이면 ~0.5s 단축)
    let plans = [];
    try {
      plans = open.length ? await kv.mget(...open.map((p) => `di:real:user:${userId}:plan:${p.symbol}`)) : [];
    } catch { plans = open.map(() => null); }
    const positions = [];
    for (let i = 0; i < open.length; i++) {
      const p = open[i];
      const amt = parseFloat(p.positionAmt);
      const side = amt > 0 ? "LONG" : "SHORT";
      const entry = parseFloat(p.entryPrice || 0);
      const mark = parseFloat(p.markPrice || 0);
      const plan = plans[i] || null;
      const tpPrice = plan?.tpPrice != null ? Number(plan.tpPrice) : null;
      const slPrice = plan?.slPrice != null ? Number(plan.slPrice) : null;

      // mark 기준 익절/손절까지 남은 거리(%) — SHORT 는 아래로, LONG 은 위로.
      const pct = (target) => (target == null || !(mark > 0)) ? null
        : Number((((side === "SHORT" ? (mark - target) : (target - mark)) / mark) * 100).toFixed(2));

      positions.push({
        symbol: p.symbol,
        side,
        entryPrice: entry,
        markPrice: mark,
        hasPlan: !!plan,
        tpPrice,
        slPrice,
        distToTpPct: pct(tpPrice),   // + 면 아직 익절까지 그만큼 남음
        distToSlPct: pct(slPrice),   // - 면 손절선을 이미 지난 것(이상)
        family: plan?.family || plan?.strategyFamily || null,
        openedAt: plan?.openedAt || null,
      });
    }

    return res.status(200).json({
      ok: true,
      count: positions.length,
      withPlan: positions.filter((x) => x.hasPlan).length,
      positions,
      note: "tpPrice/slPrice 는 봇이 진입 시 저장한 실제값. hasPlan=false 면 봇 관리 밖(수동 포지션).",
    });
  } catch (err) {
    return respondError(res, err);
  }
}
