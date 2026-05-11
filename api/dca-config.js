// ════════════════════════════════════════════════════════════════════
// Zepta — DCA (Dollar-Cost Averaging) 설정 CRUD API
// ────────────────────────────────────────────────────────────────────
// PLAN-BIZ #5 (2026-05-11)
//
// KV: `di:dca:user:<uid>:configs` → [{ id, symbol, amount, frequency,
//                                       hour, createdAt, lastRun,
//                                       totalInvested, runs }]
//
// 액션:
//   - POST { action: "add",    userId, config }   → 신규 추가
//   - POST { action: "remove", userId, configId } → 단건 삭제
//   - POST { action: "list",   userId }            → 전체 조회
//   - POST { action: "clear",  userId }            → 전체 삭제 (봇 정지 시)
//
// 보안: userId 기반 격리. CRON 인증 불필요 (사용자 본인 작업).
// ════════════════════════════════════════════════════════════════════

const ALLOWED_FREQ = new Set(["daily", "weekly", "monthly"]);

function validateConfig(c) {
  if (!c || typeof c !== "object") return "config 누락";
  if (!c.id || typeof c.id !== "string") return "id 누락";
  if (!c.symbol || typeof c.symbol !== "string") return "symbol 누락";
  if (!/^[A-Z0-9]{3,15}USDT$/.test(c.symbol)) return "symbol 형식 오류 (예: BTCUSDT)";
  if (typeof c.amount !== "number" || c.amount < 10 || c.amount > 100000) return "amount 범위 오류 (10~100000)";
  if (!ALLOWED_FREQ.has(c.frequency)) return "frequency 오류 (daily/weekly/monthly)";
  if (typeof c.hour !== "number" || c.hour < 0 || c.hour > 23) return "hour 오류 (0~23)";
  return null;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "method not allowed" });

  try {
    const { action, userId, config, configId } = req.body || {};
    if (!userId || typeof userId !== "string" || userId.length > 100) {
      return res.status(400).json({ ok: false, error: "userId 필수" });
    }
    const kvModule = await import("@vercel/kv");
    const kv = kvModule.kv;
    const key = `di:dca:user:${userId}:configs`;

    const list = (await kv.get(key)) || [];

    if (action === "list") {
      return res.status(200).json({ ok: true, configs: list });
    }

    if (action === "add") {
      const err = validateConfig(config);
      if (err) return res.status(400).json({ ok: false, error: err });
      // 최대 5개 제한 (사용자당)
      if (list.length >= 5) {
        return res.status(400).json({ ok: false, error: "DCA 설정 최대 5개까지 가능합니다." });
      }
      const next = [...list, {
        ...config,
        amount: Number(config.amount),
        hour: Number(config.hour),
        createdAt: config.createdAt || Date.now(),
        lastRun: null,
        totalInvested: 0,
        runs: 0,
      }];
      await kv.set(key, next);
      // 활성 DCA 사용자 인덱스에 추가 — cron 이 사용자 발견용
      try {
        const idx = (await kv.get("di:dca:active-users")) || [];
        if (!idx.includes(userId)) {
          await kv.set("di:dca:active-users", [...idx, userId]);
        }
      } catch {}
      return res.status(200).json({ ok: true, configs: next });
    }

    if (action === "remove") {
      if (!configId) return res.status(400).json({ ok: false, error: "configId 필수" });
      const next = list.filter(c => c.id !== configId);
      await kv.set(key, next);
      // 모든 config 가 제거되면 인덱스에서도 제거
      if (next.length === 0) {
        try {
          const idx = (await kv.get("di:dca:active-users")) || [];
          await kv.set("di:dca:active-users", idx.filter(u => u !== userId));
        } catch {}
      }
      return res.status(200).json({ ok: true, configs: next });
    }

    if (action === "clear") {
      await kv.set(key, []);
      try {
        const idx = (await kv.get("di:dca:active-users")) || [];
        await kv.set("di:dca:active-users", idx.filter(u => u !== userId));
      } catch {}
      return res.status(200).json({ ok: true, configs: [] });
    }

    return res.status(400).json({ ok: false, error: "unknown action" });
  } catch (e) {
    console.error("[dca-config] error:", e);
    return res.status(500).json({ ok: false, error: e.message || String(e) });
  }
}
