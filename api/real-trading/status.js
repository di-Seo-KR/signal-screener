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
import { RISK_CONFIG } from "../_shared/risk-manager.js";

async function getKv() {
  return (await import("@vercel/kv")).kv;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "private, no-store"); // ★ 사용자 자산·포지션 데이터 — 캐시 원천 차단
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    const userId = req.query?.userId;
    if (!userId) return res.status(400).json({ error: "userId required" });

    const kv = await getKv();
    // ★ 2026-06-12 성능: loadUserCredentials(KV 1회)를 직렬로 기다리던 것을 첫 병렬 묶음에 편입
    //   (실패는 아래 catch 와 동일하게 binanceOk=false 로 흡수 — 동작 불변, ~100ms 단축)
    const [killed, phase1, shadowEnrolled, breaker, engineLog, engineHeartbeat, orders, shadowSummary, shadowLedger, reconcileLog, credsOrNull] = await Promise.all([
      isKillSwitchEnabled(userId),
      kv.get(`di:real:user:${userId}:phase1_enabled`),
      kv.get(`di:real:user:${userId}:shadow_enabled`),
      getBreakerState(userId),
      kv.get(`di:real:user:${userId}:engine-log`),
      kv.get(`di:real:user:${userId}:engine-heartbeat`),  // ★ 매 cron 갱신 — dot 판정 SSOT
      kv.get(`di:real:user:${userId}:orders`),
      kv.get(`di:real:user:${userId}:shadow-summary`),
      kv.get(`di:real:user:${userId}:shadow-ledger`),
      kv.get(`di:real:user:${userId}:reconcile-log`),
      loadUserCredentials(userId, req).catch(() => null),
    ]);

    let equity = null;
    let marginBalance = null;     // 지갑잔고 + 미실현손익 = 바이낸스 '마진 잔고'(메인 표기와 일치)
    let unrealizedPnl = null;     // 열린 포지션 평가손익 합계
    let availableBalance = null;  // 신규 진입 가용 잔고
    let openPositions = [];
    let binanceOk = true;
    try {
      const creds = credsOrNull;
      if (!creds) throw new Error("credentials unavailable");
      const [acct, positions] = await Promise.all([
        getAccountInfo(creds),
        getPositionRisk(creds),
      ]);
      // ★ equity 는 totalWalletBalance(미실현 제외) — 수익률/브레이커/증거금% 의 SSOT 로 유지(불변).
      //   화면 헤드라인은 바이낸스와 맞추기 위해 marginBalance(지갑+미실현)를 별도로 내려줌.
      equity = parseFloat(acct.totalWalletBalance || "0");
      unrealizedPnl = parseFloat(acct.totalUnrealizedProfit || "0");
      marginBalance = acct.totalMarginBalance != null
        ? parseFloat(acct.totalMarginBalance)
        : equity + unrealizedPnl;
      availableBalance = parseFloat(acct.availableBalance || "0");
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
    // ★ 2026-05-13 fix: engineLastRunAt 는 engine-heartbeat KV 를 SSOT 로 사용.
    //   engine-log 는 "시그널 처리 사이클" 만 기록 → "no recent signals" 빈 사이클 누락 →
    //   30분 빈 사이클 연속 시 dot 빨강. heartbeat 는 매 cron 진입 시 갱신 → 정확.
    //   fallback 으로 engine-log 도 사용 (옛 데이터 보호 + heartbeat 미적재 케이스).
    let engineLastRunAt = null;
    let lastErrorAt = null;
    if (engineHeartbeat?.time) {
      engineLastRunAt = engineHeartbeat.time;
    } else if (Array.isArray(engineLog) && engineLog.length > 0) {
      engineLastRunAt = engineLog[0]?.time || null;
    }
    if (Array.isArray(engineLog) && engineLog.length > 0) {
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
      equity,                 // 지갑잔고(미실현 제외) — 내부 계산 SSOT
      marginBalance,          // 지갑+미실현 = 바이낸스 '마진 잔고'
      unrealizedPnl,          // 미실현손익 합계
      availableBalance,       // 가용 잔고
      openPositions,
      recentEngineLog: (engineLog || []).slice(0, 20),
      recentOrders: (orders || []).slice(0, 10),
      breaker: { ...breaker, limits: BREAKER_LIMITS },  // ★ UI 가 옛 한도 하드코딩 안 하도록 함께 내려줌
      // ★ 2026-06-12 (전수조사): 리스크 프리셋 카드가 RISK_CONFIG 와 또 드리프트(레버리지·합산마진)
      //   하던 것 차단 — 실 설정값을 SSOT 로 내려 UI 가 참조하게 함. env override 반영.
      riskConfig: {
        riskPerTradePct: RISK_CONFIG.riskPerTradePct,
        maxMarginPct: RISK_CONFIG.maxMarginPct,
        maxTotalMarginRatio: Number(process.env.ZEPTA_MAX_TOTAL_MARGIN_RATIO) || RISK_CONFIG.maxTotalMarginRatio,
        maxTotalNotionalRatio: RISK_CONFIG.maxTotalNotionalRatio,
        minLeverage: RISK_CONFIG.minLeverage,
        maxLeverage: RISK_CONFIG.maxLeverage,
        maxRoiLossPct: RISK_CONFIG.maxRoiLossPct,
        minNetRR: RISK_CONFIG.minNetRR,
        maxConcurrentPositions: RISK_CONFIG.maxConcurrentPositions,
      },
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
