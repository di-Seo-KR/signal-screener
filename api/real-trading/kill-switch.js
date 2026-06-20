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
  resetEquityHigh,
} from "../_shared/circuit-breaker.js";
import { loadUserCredentials } from "../_shared/binance-auth.js";
import { getAccountInfo } from "../_shared/binance-client.js";

async function getKv() {
  return (await import("@vercel/kv")).kv;
}

// ★ POST 변경 작업의 인증 정책 (2026-05-13 reworked):
//   1) ADMIN action (권한 부여) — admin token 필수: enable, disable (killswitch), enable-phase1, enable-shadow, disable-shadow
//   2) SELF action (본인 봇 운영) — phase1 등록 사용자만 통과: resume, halt, reset-mdd-baseline, reset-shadow
//   대표 보고 (2026-05-13): "기준점 재설정 시 unauthorized" — UI 가 admin token 없이 호출하던 문제.
//   self-action 은 phase1-users KV 멤버십으로 검증 → owner 가 자기 봇 조작 가능, 외부 사용자 차단.
const SELF_ACTIONS = new Set(["resume", "halt", "reset-mdd-baseline", "reset-shadow"]);

function verifyAdminAuth(req) {
  const secret = process.env.TRADING_ADMIN_SECRET || process.env.CRON_SECRET;
  if (!secret) {
    // ★ 적대감사 P1-5: 시크릿 미설정 fail-open 금지(enable/enable-phase1 등 권한부여 액션이 무인증
    //   통과하던 보안 구멍). 운영(prod)에선 fail-closed(거부). 개발(NODE_ENV!=='production') 또는
    //   명시적 ZEPTA_ALLOW_INSECURE_ADMIN=1 일 때만 우회. (prod 는 CRON_SECRET 설정돼 실제 영향 없음.)
    return process.env.NODE_ENV !== "production" || process.env.ZEPTA_ALLOW_INSECURE_ADMIN === "1";
  }
  const auth = req.headers?.authorization || "";
  return auth === `Bearer ${secret}`;
}

// SELF action — phase1-users KV 에 등록된 사용자인지 검증.
// owner 가 직접 자기 봇의 risk 운영을 컨트롤할 때 admin token 없이도 허용.
async function verifyPhase1User(userId, kv) {
  if (!userId) return false;
  try {
    const list = (await kv.get("di:real:phase1-users")) || [];
    return list.includes(userId);
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
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

      // ★ 인증 검증 — 2-tier:
      //   1) admin token 있으면 모든 action 통과
      //   2) admin token 없어도 SELF_ACTIONS 는 phase1 사용자 본인이면 통과
      //   3) 그 외 (privilege-granting) 는 admin token 강제
      const adminOk = verifyAdminAuth(req);
      if (!adminOk) {
        if (!SELF_ACTIONS.has(action)) {
          return res.status(401).json({
            error: "Unauthorized: Bearer token required (이 액션은 관리자만 가능합니다)",
            hint: `SELF actions (admin token 불필요): ${[...SELF_ACTIONS].join(", ")}`,
          });
        }
        // SELF action — phase1 등록 사용자만 통과
        const isPhase1 = await verifyPhase1User(userId, kv);
        if (!isPhase1) {
          return res.status(401).json({
            error: "Unauthorized: phase1 등록 사용자만 자기 봇 조작이 가능합니다",
          });
        }
      }

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
      if (action === "enable-phase1") {
        await kv.set(`di:real:user:${userId}:phase1_enabled`, true);
        const list = (await kv.get("di:real:phase1-users")) || [];
        if (!list.includes(userId)) list.push(userId);
        await kv.set("di:real:phase1-users", list);
        return res.status(200).json({ ok: true, phase1Enabled: true, enrolled: true });
      }
      if (action === "enable-shadow") {
        await kv.set(`di:real:user:${userId}:shadow_enabled`, true);
        const list = (await kv.get("di:real:shadow-users")) || [];
        if (!list.includes(userId)) list.push(userId);
        await kv.set("di:real:shadow-users", list);
        return res.status(200).json({ ok: true, shadowEnabled: true });
      }
      if (action === "disable-shadow") {
        await kv.set(`di:real:user:${userId}:shadow_enabled`, false);
        const list = (await kv.get("di:real:shadow-users")) || [];
        await kv.set("di:real:shadow-users", list.filter((u) => u !== userId));
        return res.status(200).json({ ok: true, shadowEnabled: false });
      }
      // ★ 2026-05-09: MDD 기준점 (equityHigh / 30일 rolling) 만 현재가로 재설정.
      //   큰 상승 후 정상 조정에도 옛 peak 가 발목 잡을 때 사용.
      //   halted/cooldown 상태는 건드리지 않음 — 별도 'resume' 액션 사용.
      if (action === "reset-mdd-baseline") {
        let equity = body?.currentEquity;
        if (equity == null || !isFinite(parseFloat(equity))) {
          // 클라이언트가 안 보내면 서버에서 직접 조회
          try {
            const creds = await loadUserCredentials(userId);
            const acct = await getAccountInfo(creds);
            equity = parseFloat(acct.totalWalletBalance || "0");
          } catch (e) {
            return res.status(400).json({ error: `currentEquity unavailable: ${e?.message || e}` });
          }
        } else {
          equity = parseFloat(equity);
        }
        if (!equity || equity <= 0) {
          return res.status(400).json({ error: "currentEquity must be > 0" });
        }
        const state = await resetEquityHigh(userId, equity);
        return res.status(200).json({ ok: true, breaker: state, newBaseline: equity });
      }
      if (action === "reset-shadow") {
        await kv.set(`di:real:user:${userId}:shadow-ledger`, []);
        await kv.set(`di:real:user:${userId}:shadow-summary`, { wins: 0, losses: 0, netPnL: 0, trades: 0, totalRR: 0, updatedAt: new Date().toISOString() });
        return res.status(200).json({ ok: true, reset: true });
      }
      if (action === "disable-phase1") {
        await kv.set(`di:real:user:${userId}:phase1_enabled`, false);
        const list = (await kv.get("di:real:phase1-users")) || [];
        const next = list.filter((u) => u !== userId);
        await kv.set("di:real:phase1-users", next);
        // 안전을 위해 killswitch 도 같이 ON
        await setKillSwitch(userId, true);
        return res.status(200).json({ ok: true, phase1Enabled: false, killswitchOn: true });
      }
      return res.status(400).json({ error: `unknown action: ${action}` });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("[kill-switch]", err);
    return res.status(500).json({ error: err?.message || String(err) });
  }
}
