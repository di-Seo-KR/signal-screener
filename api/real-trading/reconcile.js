// api/real-trading/reconcile.js
//
// Daily reconciliation cron.
// 목적: KV 로컬 상태(di:real:user:<uid>:last-positions, engine-log, orders) 와
//       Binance 실제 포지션(getPositionRisk) 을 비교해서 드리프트 감지/정정.
//
// 실행 흐름:
//  1) phase1-users 전체 대상
//  2) Binance positionRisk 로 "현재 실제 오픈 포지션" snapshot
//  3) KV last-positions 와 비교 → 누락/잉여/수량 불일치 감지
//  4) 차이가 있으면 KV 를 Binance 기준으로 덮어씀(강제 동기화)
//  5) reconcile-log 에 diff 저장, Telegram 알림 발송 (sendTG 있으면)
//
// cron: 매일 한국시간 06:00 (UTC 21:00)

import { loadUserCredentials, respondError } from "../_shared/binance-auth.js";
import { getPositionRisk, getAccountInfo, getUserTrades } from "../_shared/binance-client.js";

export const config = { maxDuration: 60 };

async function getKv() {
  const mod = await import("@vercel/kv");
  return mod.kv;
}

async function sendTelegram(text) {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chat  = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chat) return;
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text, parse_mode: "Markdown" }),
    });
  } catch (e) {
    console.warn("[reconcile] TG failed:", e?.message);
  }
}

async function reconcileUser(userId) {
  const kv = await getKv();
  const diff = { userId, missing: [], extra: [], mismatch: [], equity: null, realizedToday: 0 };
  let creds;
  try {
    creds = await loadUserCredentials(userId);
  } catch (e) {
    return { userId, error: `no creds: ${e.message}` };
  }

  // 1) 실제 포지션
  let positions;
  try {
    positions = await getPositionRisk({ ...creds });
  } catch (e) {
    return { userId, error: `positionRisk failed: ${e.message}` };
  }
  const actualOpen = {};
  for (const p of (positions || [])) {
    const amt = parseFloat(p.positionAmt || "0");
    if (Math.abs(amt) > 0) {
      actualOpen[p.symbol] = {
        symbol: p.symbol,
        positionAmt: amt,
        entryPrice: parseFloat(p.entryPrice || "0"),
        markPrice: parseFloat(p.markPrice || "0"),
        unrealizedProfit: parseFloat(p.unRealizedProfit || "0"),
        leverage: parseInt(p.leverage || "0", 10),
        marginType: p.marginType,
      };
    }
  }

  // 2) 계정 에쿼티
  try {
    const acct = await getAccountInfo(creds);
    diff.equity = parseFloat(acct.totalWalletBalance || "0");
  } catch {}

  // 3) KV 와 비교
  const last = (await kv.get(`di:real:user:${userId}:last-positions`)) || {};
  const lastSymbols = new Set(Object.keys(last));
  const actualSymbols = new Set(Object.keys(actualOpen));

  for (const s of actualSymbols) if (!lastSymbols.has(s)) diff.missing.push(s); // 실제는 열려있는데 KV 에 없음
  for (const s of lastSymbols) if (!actualSymbols.has(s)) diff.extra.push(s);   // KV 엔 있는데 실제 포지션은 닫힘
  for (const s of actualSymbols) {
    if (lastSymbols.has(s)) {
      const a = actualOpen[s];
      const l = last[s] || {};
      if (Math.abs(parseFloat(l.positionAmt || 0) - a.positionAmt) > 1e-8) {
        diff.mismatch.push({ symbol: s, kv: l.positionAmt, actual: a.positionAmt });
      }
    }
  }

  // 4) 강제 동기화: KV 를 Binance 기준으로 덮어쓰기
  if (diff.missing.length || diff.extra.length || diff.mismatch.length) {
    await kv.set(`di:real:user:${userId}:last-positions`, actualOpen);
  }

  // 5) 오늘 실현 손익 집계 (symbols 별 userTrades)
  try {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const startTime = start.getTime();
    const symbolsOfInterest = [...new Set([...actualSymbols, ...lastSymbols])];
    let total = 0;
    for (const s of symbolsOfInterest.slice(0, 5)) {
      try {
        const tr = await getUserTrades({ ...creds, symbol: s, startTime, limit: 200 });
        for (const t of (tr || [])) total += parseFloat(t.realizedPnl || "0");
      } catch {}
    }
    diff.realizedToday = total;
  } catch {}

  // 6) 로그 저장
  try {
    const key = `di:real:user:${userId}:reconcile-log`;
    const log = (await kv.get(key)) || [];
    log.unshift({ time: new Date().toISOString(), diff, actualOpen });
    await kv.set(key, log.slice(0, 90));
  } catch {}

  // 7) 알림: 차이 있으면 Telegram
  const hasDiff = diff.missing.length || diff.extra.length || diff.mismatch.length;
  if (hasDiff) {
    await sendTelegram(
      `*Zepta Reconcile ALERT*\nuser: ${userId.slice(0, 8)}…\n` +
      (diff.missing.length ? `missing: ${diff.missing.join(", ")}\n` : "") +
      (diff.extra.length   ? `extra: ${diff.extra.join(", ")}\n`     : "") +
      (diff.mismatch.length ? `mismatch: ${diff.mismatch.length} symbols\n` : "") +
      `equity: $${(diff.equity || 0).toFixed(2)}\n` +
      `realized today: $${diff.realizedToday.toFixed(2)}`
    );
  }

  return { userId, ok: true, diff, actualOpenCount: Object.keys(actualOpen).length };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  try {
    // POST { userId } → 해당 유저만. GET → cron, 전체 순회.
    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
      const { userId } = body;
      if (!userId) return res.status(400).json({ error: "userId required" });
      const out = await reconcileUser(userId);
      return res.status(200).json(out);
    }

    const kv = await getKv();
    const users = (await kv.get("di:real:phase1-users")) || [];
    const results = [];
    for (const uid of users.slice(0, 10)) {
      try { results.push(await reconcileUser(uid)); }
      catch (e) { results.push({ userId: uid, error: e?.message }); }
    }
    return res.status(200).json({ ok: true, count: results.length, results });
  } catch (err) {
    return respondError(res, err);
  }
}
