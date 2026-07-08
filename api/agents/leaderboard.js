// ════════════════════════════════════════════════════════════════════
// Zepta — Bot Leaderboard Aggregator (시간당 cron)
// ────────────────────────────────────────────────────────────────────
// 모든 사용자의 봇별 perf + snapshot 을 익명 집계해 leaderboard KV 적재.
//
// 입력 KV (per-user 형식이 운영되면 우선):
//   di:real:phase1-users           → [userId, ...] (실거래 사용자)
//   di:real:active-users           → [userId, ...] (활성 사용자)
//   di:user:<uid>:bot:<bot>:perf   → 사용자별 봇 성과 (있으면 사용)
//   di:user:<uid>:bot:<bot>:snap   → 사용자별 봇 스냅샷 (있으면 사용)
//   di:bot:<bot>:perf              → 글로벌 봇 성과 (per-user 없을 때 fallback)
//   di:bot:<bot>:snapshot          → 글로벌 봇 스냅샷
//
// 출력 KV:
//   di:leaderboard                 → { generatedAt, period, entries:[…], userCount, …}
//   di:leaderboard:bot:<botId>     → 해당 봇에 한정한 ranked entries
//
// 익명화: userId → SHA-256(8B) → 닉네임 사전 매핑 ("트레이더_a3f5")
//
// Cron: `15 * * * *` (매시 15분)
// ════════════════════════════════════════════════════════════════════

import { requireCronAuth } from "../_shared/require-cron.js";
import { createHash } from "crypto";

export const config = { maxDuration: 60 };

// ── 봇 메타 (전체 봇 universe) ──
// bot-performance.js / dev-status.js 와 동기화 필수.
export const BOT_REGISTRY = {
  // 크립토 봇
  "btc-alpha":         { kind: "crypto",  family: "trend-follow",      assets: ["BTC/USD"] },
  "highcap-momentum":  { kind: "crypto",  family: "momentum-rotation", assets: ["BTC/USD","ETH/USD","SOL/USD","XRP/USD","ADA/USD","AVAX/USD"] },
  "defi-infra":        { kind: "crypto",  family: "defi-momentum",     assets: ["LINK/USD","UNI/USD","AAVE/USD","DOT/USD"] },
  "meme-trend":        { kind: "crypto",  family: "breakout",          assets: ["DOGE/USD","SHIB/USD","PEPE/USD"] },
  "l2-emerging":       { kind: "crypto",  family: "momentum-rotation", assets: ["ARB/USD","OP/USD","MATIC/USD"] },
  "crypto-diversity":  { kind: "crypto",  family: "ensemble",          assets: ["*"] },
  "crypto-swing":      { kind: "crypto",  family: "mean-revert",       assets: ["*"] },
  // 주식 봇
  "stable-quant":      { kind: "stock",   family: "trend-follow",      assets: ["AAPL","MSFT","GOOG","AMZN","AVGO"] },
  "balanced-quant":    { kind: "stock",   family: "ensemble",          assets: ["mixed"] },
  "aggressive-quant":  { kind: "stock",   family: "momentum-rotation", assets: ["mixed"] },
  "trend-follow":      { kind: "stock",   family: "trend-follow",      assets: ["mixed"] },
  "mean-reversion":    { kind: "stock",   family: "mean-revert",       assets: ["mixed"] },
  "ensemble-signal":   { kind: "stock",   family: "ensemble",          assets: ["mixed"] },
};

const ALL_BOT_IDS = Object.keys(BOT_REGISTRY);
const PROBE_USER = "__zepta_global_probe__";

// ── 닉네임 사전 (anon-friendly) ─────────────────────────────────────
const NICK_PREFIX = [
  "트레이더", "퀀트", "알파", "리스크", "헤지",
  "스윙", "롱숏", "모멘텀", "캐리", "팩터",
];

async function getKv() {
  return (await import("@vercel/kv")).kv;
}

// ── 익명 닉네임 생성: userId → "트레이더_a3f5" ─────────────────────
export function anonymizeUserId(userId) {
  if (!userId) return { nick: "익명_0000", hash: "0000" };
  const h = createHash("sha256").update(String(userId)).digest("hex");
  const idx = parseInt(h.slice(0, 2), 16) % NICK_PREFIX.length;
  const suffix = h.slice(2, 6);
  return { nick: `${NICK_PREFIX[idx]}_${suffix}`, hash: h.slice(0, 8) };
}

// ── 사용자 목록 (multi-tenant 대비) ─────────────────────────────────
async function listAllUsers(kv) {
  const users = new Set();
  try {
    const a = (await kv.get("di:real:phase1-users")) || [];
    if (Array.isArray(a)) a.forEach((u) => users.add(u));
  } catch {}
  try {
    const b = (await kv.get("di:real:active-users")) || [];
    if (Array.isArray(b)) b.forEach((u) => users.add(u));
  } catch {}
  // 빈 상태에서도 leaderboard 가 비지 않도록 probe 사용자 1개 강제 포함
  if (users.size === 0) users.add(PROBE_USER);
  return [...users];
}

// ── 단일 사용자×봇 성과 추출 ───────────────────────────────────────
async function fetchUserBot(kv, userId, botId) {
  // per-user 키 우선
  let perf = null, snap = null;
  try { perf = await kv.get(`di:user:${userId}:bot:${botId}:perf`); } catch {}
  try { snap = await kv.get(`di:user:${userId}:bot:${botId}:snap`); } catch {}
  // 글로벌 fallback
  if (!perf) { try { perf = await kv.get(`di:bot:${botId}:perf`); } catch {} }
  if (!snap) { try { snap = await kv.get(`di:bot:${botId}:snapshot`); } catch {} }
  return { perf, snap };
}

// ── 메트릭 계산 ────────────────────────────────────────────────────
// equityCurve(daily) 로부터 N일 수익률 / Sharpe / MDD 산출.
function metricsFromHistory(history, alloc, periodDays) {
  if (!Array.isArray(history) || history.length < 2 || !(alloc > 0)) {
    return { returnPct: 0, sharpe: 0, mdd: 0, valid: false };
  }
  // KST 일별 그룹핑 (bot-performance.js 와 동일 로직)
  const KST_MS = 9 * 3600000;
  const dayMap = new Map();
  for (const h of history) {
    const eq = Number(h?.equity);
    if (!(eq > 0)) continue;
    if (eq > alloc * 3 || eq < alloc * 0.1) continue;
    const t = Date.parse(h?.time || "");
    if (!Number.isFinite(t)) continue;
    const k = new Date(t + KST_MS);
    const key = `${k.getUTCFullYear()}-${String(k.getUTCMonth() + 1).padStart(2,"0")}-${String(k.getUTCDate()).padStart(2,"0")}`;
    dayMap.set(key, eq);
  }
  const daily = Array.from(dayMap.entries()).sort(([a],[b]) => a.localeCompare(b)).map(([,eq]) => eq);
  if (daily.length < 2) return { returnPct: 0, sharpe: 0, mdd: 0, valid: false };

  // 기간 절단
  const tail = daily.slice(-Math.max(periodDays + 1, 2));
  const first = tail[0];
  const last = tail[tail.length - 1];
  const returnPct = first > 0 ? ((last - first) / first) * 100 : 0;

  // 일별 수익률 시계열
  const rets = [];
  for (let i = 1; i < tail.length; i++) {
    const r = tail[i - 1] > 0 ? (tail[i] - tail[i - 1]) / tail[i - 1] : 0;
    rets.push(r);
  }
  // Sharpe (annualized, 252 거래일 기준; 가용 데이터가 적으면 sqrt(n) 가중)
  let sharpe = 0;
  if (rets.length >= 2) {
    const mean = rets.reduce((s, r) => s + r, 0) / rets.length;
    const variance = rets.reduce((s, r) => s + (r - mean) ** 2, 0) / Math.max(1, rets.length - 1);
    const std = Math.sqrt(variance);
    sharpe = std > 1e-9 ? (mean / std) * Math.sqrt(252) : 0;
  }
  // MDD
  let peak = tail[0];
  let mdd = 0;
  for (const eq of tail) {
    if (eq > peak) peak = eq;
    const dd = peak > 0 ? ((peak - eq) / peak) * 100 : 0;
    if (dd > mdd) mdd = dd;
  }
  return { returnPct, sharpe, mdd, valid: true };
}

// ── perf 에서 직접 winRate / trades 계산 ───────────────────────────
function metricsFromPerf(perf) {
  const tradeCount = perf?.tradeCount || (perf?.trades?.length ?? 0) || 0;
  const closedCount = perf?.closedCount || 0;
  const winCount = perf?.winCount || 0;
  const winRate = closedCount > 0 ? (winCount / closedCount) * 100 : 0;
  return { tradeCount, winRate };
}

// ── 메인 핸들러 ───────────────────────────────────────────────────
export default async function handler(req, res) {
  if (!requireCronAuth(req, res)) return; // ★ 크론/내부 전용 (2026-07-08 무인증 노출 차단)
  try {
    const kv = await getKv();
    const users = await listAllUsers(kv);
    const generatedAt = new Date().toISOString();
    const periodDays = 30; // 기본 30일 — 필요 시 추후 7/90 도 함께 생성

    const allEntries = [];

    for (const userId of users) {
      const { nick, hash } = anonymizeUserId(userId);
      for (const botId of ALL_BOT_IDS) {
        const { perf, snap } = await fetchUserBot(kv, userId, botId);
        if (!perf && !snap) continue;
        const alloc = Number(snap?.botAllocation || 0);
        const history = Array.isArray(snap?.history) ? snap.history : [];
        const m = metricsFromHistory(history, alloc, periodDays);
        const p = metricsFromPerf(perf || {});
        // 거래 기록도 스냅샷도 없으면 entry 자체 skip
        if (!m.valid && p.tradeCount === 0) continue;
        const meta = BOT_REGISTRY[botId] || {};
        allEntries.push({
          userHash: hash,
          nick,
          botId,
          botKind: meta.kind || "unknown",
          botFamily: meta.family || "unknown",
          returnPct: Number(m.returnPct.toFixed(2)),
          sharpe: Number(m.sharpe.toFixed(2)),
          mdd: Number(m.mdd.toFixed(2)),
          tradeCount: p.tradeCount,
          winRate: Number(p.winRate.toFixed(1)),
          updatedAt: perf?.lastUpdated || snap?.lastUpdated || null,
        });
      }
    }

    // 전체 ranked — return desc
    const ranked = [...allEntries].sort((a, b) => b.returnPct - a.returnPct);

    const payload = {
      generatedAt,
      periodDays,
      userCount: users.length,
      entryCount: ranked.length,
      entries: ranked,
    };

    await kv.set("di:leaderboard", payload);

    // 봇별로 잘라 별도 KV
    const byBot = new Map();
    for (const e of ranked) {
      if (!byBot.has(e.botId)) byBot.set(e.botId, []);
      byBot.get(e.botId).push(e);
    }
    for (const [botId, list] of byBot.entries()) {
      await kv.set(`di:leaderboard:bot:${botId}`, {
        generatedAt, botId, count: list.length, entries: list,
      });
    }

    return res.status(200).json({
      ok: true,
      generatedAt,
      userCount: users.length,
      entryCount: ranked.length,
      botCount: byBot.size,
    });
  } catch (err) {
    console.error("[leaderboard-cron] fatal:", err);
    return res.status(200).json({ ok: false, error: err?.message || String(err) });
  }
}
