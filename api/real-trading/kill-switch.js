// api/real-trading/kill-switch.js
//
// 실전매매 비상 스위치.
//
// GET  ?userId=...   → 현재 상태 (killswitch, phase1_enabled, halted)
// POST { userId, action: "disable"|"enable"|"halt"|"resume", reason? }
//   - disable: killswitch = true  (거래 불가, 기본값)
//   - enable:  killswitch = false (거래 허용)
//   - halt:    breaker.halted = true (브레이커 걸기)
//   - resume:  breaker.halted = false (브레이커 해제)
//
// ★ 주의 ★
//  Phase1 에서는 enable/phase1_enabled 은 '유저가 코드를 직접 검토한 후'
//  수동으로 KV 콘솔에서 true 로 돌려야 안전하다.
//  이 엔드포인트는 편의 기능일 뿐, 자동 활성화되지 않는다.

import {
  isKillSwitchEnabled,
  setKillSwitch,
  getBreakerState,
  resetBreaker,
} from "../_shared/circuit-breaker.js";

async function getKv() {
  return (await import("@vercel/kv")).kv;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const kv = await getKv();

    if (req.method === "GET") {
      const userId = req.query?.userId;
      if (!userId) return res.status(400).json({ error: "userId required" });
      const killed = await isKillSwitchEnabled(userId);
      const phase1 = !!(await kv.get(`di:real:user:${userId}:phase1_enabled`));
      const breaker = await getBreakerState(userId);
      return res.status(200).json({
        ok: true,
        userId,
        killswitchOn: killed,       // true = 거래 금지
        phase1Enabled: phase1,      // true = Phase1 엔진 허용
        halted: !!breaker?.halted,
        breaker,
      });
    }

    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
      const { userId, action, reason } = body;
      if (!userId || !action) return res.status(400).json({ error: "userId, action required" });

      if (action === "disable") {
        await setKillSwitch(userId, true);
        return res.status(200).json({ ok: true, killswitchOn: true });
      }
      if (action === "enable") {
        await setKillSwitch(userId, false);
        return res.status(200).json({ ok: true, killswitchOn: false });
      }
      if (action === "halt") {
        const state = (await kv.get(`di:real:user:${userId}:breaker`)) || {};
        state.halted = true;
        state.haltedReason = reason || "manual";
        state.haltedAt = Date.now();
        await kv.set(`di:real:user:${userId}:breaker`, state);
        return res.status(200).json({ ok: true, halted: true });
      }
      if (action === "resume") {
        const state = await resetBreaker(userId);
        return res.status(200).json({ ok: true, breaker: state });
      }
      return res.status(400).json({ error: `unknown action: ${action}` });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("[kill-switch]", err);
    return res.status(500).json({ error: err?.message || String(err) });
  }
}
