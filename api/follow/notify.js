// ════════════════════════════════════════════════════════════════════
// Zepta — Follow Notify (카피트레이딩 신호 알림 발송)
// ────────────────────────────────────────────────────────────────────
// ⚠️ 법적 안전 가이드:
//   이 API 는 신호 알림만 발송. 자동 매매 실행 X.
//   사용자가 직접 매매 결정.
//
// 사용처:
//   - btc-cron.js / stock-cron.js 등이 봇 entry/exit 시점에 호출
//   - 봇별 follower 목록을 조회해 mode="alert" 인 유저에게 알림 푸시
//
// 엔드포인트:
//   POST /api/follow/notify
//        body: { botId, signalType, symbol, side, price, reason }
//        signalType: "entry" | "exit"
//
// 동작:
//   1) di:follow:followers:<botId> 에서 uid 리스트 조회
//   2) 각 uid 의 follow 레코드에서 mode="alert" 인 경우만
//   3) pushNotification (notifications/list.js helper) 호출
//
// 호출 권한: cron secret 헤더 또는 내부 환경에서만 허용
// ════════════════════════════════════════════════════════════════════

import { pushNotification } from "../notifications/list.js";

function sanitizeBotId(id) {
  return String(id || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 48);
}

function sanitizeUid(uid) {
  return String(uid || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
}

async function getKv() {
  try {
    if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) return null;
    const m = await import("@vercel/kv");
    return m.kv;
  } catch {
    return null;
  }
}

const BOT_NAME_KO = {
  "btc-alpha":        "BTC 알파",
  "highcap-momentum": "대형코인 모멘텀",
  "defi-infra":       "DeFi 인프라",
  "meme-trend":       "밈코인 트렌드",
  "l2-emerging":      "L2 신흥",
  "crypto-diversity": "크립토 분산",
  "crypto-swing":     "크립토 스윙",
  "stable-quant":     "안정형 퀀트",
  "balanced-quant":   "균형형 퀀트",
  "aggressive-quant": "공격형 퀀트",
  "trend-follow":     "추세 추종",
  "mean-reversion":   "평균 회귀",
  "ensemble-signal":  "앙상블 시그널",
};

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-cron-secret");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  // 보안: cron secret 검증 (선택적 — 환경변수 미설정시 공개)
  const expectedSecret = process.env.CRON_SECRET;
  if (expectedSecret) {
    const provided = req.headers["x-cron-secret"] || req.query?.secret;
    if (provided !== expectedSecret) {
      return res.status(403).json({ ok: false, error: "Forbidden" });
    }
  }

  const kv = await getKv();
  if (!kv) return res.status(200).json({ ok: false, skipped: true, reason: "KV not configured" });

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const botId = sanitizeBotId(body.botId);
    const signalType = body.signalType === "exit" ? "exit" : "entry";
    const symbol = String(body.symbol || "").slice(0, 16);
    const side = body.side === "SHORT" ? "SHORT" : "LONG";
    const price = Number(body.price) || 0;
    const reason = String(body.reason || "").slice(0, 120);

    if (!botId) return res.status(400).json({ ok: false, error: "botId 필요" });

    const followers = (await kv.get(`di:follow:followers:${botId}`)) || [];
    const followerList = Array.isArray(followers) ? followers : [];

    if (followerList.length === 0) {
      return res.status(200).json({ ok: true, notified: 0, message: "팔로워 없음" });
    }

    const botName = BOT_NAME_KO[botId] || botId;
    const titlePrefix = signalType === "entry" ? "진입 시그널" : "청산 시그널";
    const title = `${botName} ${titlePrefix} — ${symbol}`;
    const summary = signalType === "entry"
      ? `${side === "LONG" ? "매수" : "매도"} 시그널이 발생했어요. 가격 ${price.toFixed(2)}. 매매는 본인이 직접 판단해주세요.${reason ? ` (${reason})` : ""}`
      : `청산 시그널이 발생했어요. 가격 ${price.toFixed(2)}.${reason ? ` (${reason})` : ""}`;

    let notified = 0;
    let skipped = 0;
    for (const rawUid of followerList) {
      const uid = sanitizeUid(rawUid);
      if (!uid) continue;
      // 각 uid 의 follow 레코드에서 mode 확인
      const fList = (await kv.get(`di:follow:${uid}`)) || [];
      const rec = (Array.isArray(fList) ? fList : []).find(f => f.targetBotId === botId);
      if (!rec || rec.mode !== "alert") { skipped++; continue; }

      const result = await pushNotification(uid, {
        category: "signal",
        priority: signalType === "entry" ? "high" : "medium",
        title,
        summary,
        symbol,
        link: `/reports/${botId}`,
      });
      if (result?.ok) notified++;
    }

    return res.status(200).json({
      ok: true,
      botId,
      signalType,
      followers: followerList.length,
      notified,
      skippedCopyMode: skipped,
    });
  } catch (e) {
    console.error("[follow/notify] fatal:", e);
    return res.status(500).json({ ok: false, error: e.message });
  }
}
