// api/agents/x-autopost.js
// ───────────────────────────────────────────────────────────────────────────
// Zepta X(트위터) 자동 게시 봇 — Vercel 크론으로 하루 1개, 가치우선 풀에서 미사용 1개를
// 순서대로 픽 → X API v2(OAuth 1.0a)로 게시 → KV에 used 마킹(중복 0). 한 바퀴(풀 크기)
// 돌면 리셋. 서버에서 도므로 사용자 PC/브라우저 상태와 무관(진짜 무인).
//
// 안전:
//   - ZEPTA_X_AUTOPOST=1 일 때만 동작(킬스위치). 미설정/0 이면 즉시 skip.
//   - X API 키 4개(X_API_KEY/SECRET, X_ACCESS_TOKEN/SECRET) 전부 있어야 동작.
//   - CRON_SECRET 설정 시 Vercel 크론 헤더 또는 Bearer/key 일치만 허용(외부 트리거 차단).
//   - ?dryRun=1 → 게시 안 하고 픽한 글만 반환(키 검증/내용 미리보기용).
//
// 텔레그램으로 게시 결과/실패 알림. 중복 추적은 KV(di:x:autopost:used).
//
// 402(credits depleted) 전용 처리(2026-08-17):
//   - X API 유료 크레딧 소진은 코드 문제가 아님 → 일반 오류와 구분해 알림.
//   - 연속 402 는 7일에 1회만 텔레그램(첫 402 는 즉시). 로그(LOG_KEY)엔 매회 기록.
//   - 크론은 매일 게시 시도를 계속 → 크레딧 충전 시 첫 성공에서 자동 재개 알림 1회.
//   - 402 는 200 + { ok:false, paused:"credits" } 로 반환(크론 실패 카운트 오염 방지).
// ───────────────────────────────────────────────────────────────────────────

import crypto from "crypto";
import { X_CONTENT_POOL } from "../_shared/x-content-pool.js";
import { sendTelegram } from "../_shared/telegram.js";

async function getKv() {
  return (await import("@vercel/kv")).kv;
}

const USED_KEY = "di:x:autopost:used"; // 사용한 post id 배열
const LOG_KEY = "di:x:autopost:log";   // 최근 게시 로그(관측)
const PAUSE_KEY = "di:x:autopost:pause402"; // 402 일시정지 마커 { since, lastNotifiedAt, count }
const PAUSE_RENOTIFY_MS = 7 * 24 * 60 * 60 * 1000; // 연속 402 재알림 간격(7일)

// RFC3986 percent-encode (OAuth 1.0a 규격).
function pe(s) {
  return encodeURIComponent(String(s)).replace(/[!*'()]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

// OAuth 1.0a User Context Authorization 헤더 생성(HMAC-SHA1).
// extraParams: 폼/쿼리 파라미터(application/json 바디는 서명에 미포함 — X API v2 JSON 규격).
export function buildOAuthHeader({ method, url, creds, extraParams = {}, nonce, timestamp }) {
  const oauth = {
    oauth_consumer_key: creds.apiKey,
    oauth_nonce: nonce,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(timestamp),
    oauth_token: creds.accessToken,
    oauth_version: "1.0",
  };
  const forSig = { ...oauth, ...extraParams };
  const paramString = Object.keys(forSig).sort()
    .map((k) => `${pe(k)}=${pe(forSig[k])}`)
    .join("&");
  const baseString = `${method.toUpperCase()}&${pe(url)}&${pe(paramString)}`;
  const signingKey = `${pe(creds.apiSecret)}&${pe(creds.accessSecret)}`;
  const signature = crypto.createHmac("sha1", signingKey).update(baseString).digest("base64");
  const headerParams = { ...oauth, oauth_signature: signature };
  return "OAuth " + Object.keys(headerParams).sort()
    .map((k) => `${pe(k)}="${pe(headerParams[k])}"`)
    .join(", ");
}

async function postTweet(text, creds) {
  const url = "https://api.twitter.com/2/tweets";
  const auth = buildOAuthHeader({
    method: "POST",
    url,
    creds,
    nonce: crypto.randomBytes(16).toString("hex"),
    timestamp: Math.floor(Date.now() / 1000),
  });
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: auth },
    body: JSON.stringify({ text }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    // 상태코드를 에러 객체에 실어 핸들러에서 402(credits depleted) 등을 구분.
    const err = new Error(`X API ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body; // { data: { id, text } }
}

export default async function handler(req, res) {
  const dryRun = req.query?.dryRun === "1" || req.query?.dryRun === "true";

  // 1) 킬스위치
  if (process.env.ZEPTA_X_AUTOPOST !== "1") {
    return res.status(200).json({ ok: false, skipped: "ZEPTA_X_AUTOPOST != 1 (kill-switch off)" });
  }

  // 2) 인증 — CRON_SECRET 설정 시 Vercel 크론 또는 Bearer/key 일치만 허용.
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers?.authorization || "";
    const isCron = req.headers?.["x-vercel-cron"] != null;
    const keyOk = auth === `Bearer ${secret}` || req.query?.key === secret;
    if (!isCron && !keyOk) return res.status(401).json({ ok: false, error: "unauthorized" });
  }

  // 3) X API 키
  const creds = {
    apiKey: process.env.X_API_KEY,
    apiSecret: process.env.X_API_SECRET,
    accessToken: process.env.X_ACCESS_TOKEN,
    accessSecret: process.env.X_ACCESS_SECRET,
  };
  if (!creds.apiKey || !creds.apiSecret || !creds.accessToken || !creds.accessSecret) {
    return res.status(200).json({ ok: false, error: "X API 키 미설정 (X_API_KEY/SECRET, X_ACCESS_TOKEN/SECRET)" });
  }

  let kv = null;   // catch(402 처리)에서도 참조 — try 밖으로 호이스팅
  let pick = null;
  try {
    kv = await getKv();
    let used = (await kv.get(USED_KEY)) || [];
    if (!Array.isArray(used)) used = [];
    // 풀에 더 이상 없는(삭제된) id는 used 에서 정리.
    const poolIds = new Set(X_CONTENT_POOL.map((p) => p.id));
    used = used.filter((id) => poolIds.has(id));

    let remaining = X_CONTENT_POOL.filter((p) => !used.includes(p.id));
    let cycled = false;
    if (remaining.length === 0) {
      // 한 바퀴 소진 → 리셋(중복 0 유지하다 풀 크기마다 1회 재시작).
      used = [];
      remaining = [...X_CONTENT_POOL];
      cycled = true;
    }
    pick = remaining[0]; // 풀 배열 순서 = 가치/제품 분산 보장

    if (dryRun) {
      return res.status(200).json({
        ok: true, dryRun: true, picked: { id: pick.id, kind: pick.kind, text: pick.text },
        usedCount: used.length, remaining: remaining.length, cycled, poolSize: X_CONTENT_POOL.length,
      });
    }

    const result = await postTweet(pick.text, creds);
    const tweetId = result?.data?.id || null;

    // 4) used 마킹 + 로그(게시 성공 후에만 — 실패 시 다음 사이클 재시도).
    used.push(pick.id);
    await kv.set(USED_KEY, used);
    const log = (await kv.get(LOG_KEY)) || [];
    log.unshift({ at: new Date().toISOString(), id: pick.id, kind: pick.kind, tweetId, text: pick.text.slice(0, 80) });
    await kv.set(LOG_KEY, log.slice(0, 120));

    // 5) 402 일시정지 중이었다면 → 크레딧 충전이 확인된 것 — 마커 해제 + 재개 알림 1회.
    try {
      const pause = await kv.get(PAUSE_KEY);
      if (pause) {
        await kv.del(PAUSE_KEY);
        try {
          await sendTelegram({
            text: `✅ X 자동게시 재개 — X API 크레딧 충전 확인 (일시정지 시작: ${pause?.since || "?"}, 402 누적 ${pause?.count ?? "?"}회)`,
          });
        } catch {}
      }
    } catch {}

    try {
      await sendTelegram({
        text: `🐦 X 자동게시 완료\nid: ${pick.id} (${pick.kind})\nhttps://x.com/Zepta_quant/status/${tweetId}\n남은 풀: ${remaining.length - 1}/${X_CONTENT_POOL.length}${cycled ? "\n(풀 한 바퀴 — 새 글 추가 권장)" : ""}`,
      });
    } catch {}

    return res.status(200).json({ ok: true, posted: pick.id, kind: pick.kind, tweetId, remaining: remaining.length - 1, poolSize: X_CONTENT_POOL.length, cycled });
  } catch (e) {
    console.error(`[x-autopost] 실패: ${e?.message || e}`); // ★ 런타임 로그에 X API 에러 노출(디버깅)

    // ── 402(credits depleted) 전용 처리 ──────────────────────────────────
    // 코드 문제가 아니라 X API 유료 크레딧 소진. 크론은 매일 계속 시도(충전 시
    // 자동 재개)하되, 텔레그램 반복 알림은 7일에 1회로 억제(첫 402 는 즉시).
    const is402 = e?.status === 402 || /X API 402\b/.test(String(e?.message || ""));
    if (is402 && kv) {
      const now = Date.now();
      let notified = false;
      let pause = null;
      try {
        const prev = await kv.get(PAUSE_KEY);
        const valid = prev && typeof prev === "object";
        const shouldNotify = !valid || now - (Number(prev.lastNotifiedAt) || 0) >= PAUSE_RENOTIFY_MS;
        pause = {
          since: (valid && prev.since) || new Date(now).toISOString(),
          lastNotifiedAt: shouldNotify ? now : Number(prev.lastNotifiedAt) || 0,
          count: ((valid && Number(prev.count)) || 0) + 1,
        };
        await kv.set(PAUSE_KEY, pause);
        // 로그(LOG_KEY)에는 매회 기록 — 알림만 억제하고 관측은 유지.
        let log = (await kv.get(LOG_KEY)) || [];
        if (!Array.isArray(log)) log = [];
        log.unshift({ at: new Date(now).toISOString(), id: pick?.id || null, kind: pick?.kind || null, error: "X API 402 credits depleted", paused: true });
        await kv.set(LOG_KEY, log.slice(0, 120));
        notified = shouldNotify;
      } catch {
        notified = true; // KV 장애로 억제 판단 불가 → 알림은 보낸다(관측 우선).
      }
      if (notified) {
        try {
          await sendTelegram({
            text: `⚠️ X 자동게시 일시정지 — X API 크레딧 소진 (코드 문제 아님).\nhttps://developer.x.com 에서 크레딧 충전 시 자동 재개됩니다.\n크론은 매일 게시를 계속 시도하며, 이 알림은 연속 402 동안 7일에 1회만 보냅니다.`,
          });
        } catch {}
      }
      // 5xx 가 아닌 200 + paused 마커로 반환 — 크론 실패 카운트 오염 방지.
      return res.status(200).json({
        ok: false, paused: "credits", error: e?.message || String(e),
        notified, pausedSince: pause?.since || null, count402: pause?.count ?? null,
      });
    }

    // 402 외 오류(인증 만료·규격 변경 등)는 코드/설정 문제일 수 있어 기존대로 즉시 알림.
    try { await sendTelegram({ text: `⚠️ X 자동게시 실패: ${e?.message || e}` }); } catch {}
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
}
