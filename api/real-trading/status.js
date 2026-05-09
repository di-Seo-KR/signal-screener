// api/real-trading/status.js
//
// 프론트엔드용 실전매매 상태 요약 엔드포인트.
//
// GET ?userId=...
// →
// {
//   ok: true,
//   userId,
//   phase1Enabled, killswitchOn, halted,
//   equity,
//   openPositions: [...],
//   recentEngineLog: [...],  // 최근 10건
//   recentOrders: [...],     // 최근 10건
//   breaker: {...},
// }

import { loadUserCredentials, respondError } from "../_shared/binance-auth.js";
import { getAccountInfo, getPositionRisk } from "../_shared/binance-client.js";
import { isKillSwitchEnabled, getBreakerState, BREAKER_LIMITS } from "../_shared/circuit-breaker.js";

async function getKv() {
  return (await import("@vercel/kv")).kv;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    const userId = req.query?.userId;
    if (!userId) return res.status(400).json({ error: "userId required" });

    const kv = await getKv();
    const [killed, phase1, shadowEnrolled, breaker, engineLog, orders, shadowSummary, shadowLedger, reconcileLog] = await Promise.all([
      isKillSwitchEnabled(userId),
      kv.get(`di:real:user:${userId}:phase1_enabled`),
      kv.get(`di:real:user:${userId}:shadow_enabled`),
      getBreakerState(userId),
      kv.get(`di:real:user:${userId}:engine-log`),
      kv.get(`di:real:user:${userId}:orders`),
      kv.get(`di:real:user:${userId}:shadow-summary`),
      kv.get(`di:real:user:${userId}:shadow-ledger`),
      kv.get(`di:real:user:${userId}:reconcile-log`),
    ]);

    let equity = null;
    let openPositions = [];
    let binanceOk = true;
    try {
      const creds = await loadUserCredentials(userId);
      const [acct, positions] = await Promise.all([
        getAccountInfo(creds),
        getPositionRisk(creds),
      ]);
      equity = parseFloat(acct.totalWalletBalance || "0");
      openPositions = (positions || [])
        .filter((p) => Math.abs(parseFloat(p.positionAmt || 0)) > 0)
        .map((p) => ({
          symbol: p.symbol,
          positionAmt: parseFloat(p.positionAmt),
          entryPrice: parseFloat(p.entryPrice),
          markPrice: parseFloat(p.markPrice),
          unRealizedProfit: parseFloat(p.unRealizedProfit),
          leverage: parseFloat(p.leverage),
        }));
    } catch (e) {
      // 키 없거나 인증 실패여도 status 는 리턴 — 시스템 상태 위젯 용 플래그만 기록
      binanceOk = false;
    }

    // ★ 2026-05-09: 시스템 상태 위젯 (Widget 7) — 엔진 마지막 실행 / 최근 오류 추출
    //   engine-log 의 마지막 항목과 마지막 error 항목 시각만 뽑아 가볍게 노출.
    let engineLastRunAt = null;
    let lastErrorAt = null;
    if (Array.isArray(engineLog) && engineLog.length > 0) {
      engineLastRunAt = engineLog[0]?.time || null;
      const errEntry = engineLog.find((e) => e?.error || e?.level === "error");
      lastErrorAt = errEntry?.time || null;
    }

    return res.status(200).json({
      ok: true,
      userId,
      phase1Enabled: !!phase1,
      shadowEnabled: !!shadowEnrolled,
      killswitchOn: killed,
      halted: !!breaker?.halted,
      haltedReason: breaker?.haltedReason || null,
      equity,
      openPositions,
      recentEngineLog: (engineLog || []).slice(0, 20),
      recentOrders: (orders || []).slice(0, 10),
      breaker: { ...breaker, limits: BREAKER_LIMITS },  // ★ UI 가 옛 한도 하드코딩 안 하도록 함께 내려줌
      shadow: {
        summary: shadowSummary || null,
        openCount: (shadowLedger || []).filter((e) => e.status === "OPEN").length,
        recent: (shadowLedger || []).slice(0, 20),
      },
      reconcile: (reconcileLog || []).slice(0, 5),
      // ★ 2026-05-09: Widget 7 시스템 상태 표시등 용
      systemHealth: {
        kvOk: true,        // 여기까지 도달했으면 KV read 는 성공
        binanceOk,         // 위에서 set
        engineLastRunAt,
        lastErrorAt,
      },
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    return respondError(res, err);
  }
}
