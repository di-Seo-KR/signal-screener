// Zepta Binance Proxy — Fly.io 고정 IP 서버
// 역할: Vercel(zepta) ↔ Binance Futures 중계
//
// 환경변수:
//   PROXY_SHARED_SECRET  Vercel과 공유하는 내부 인증 토큰 (HMAC-SHA256 서명 검증용)
//   BINANCE_FAPI_BASE    (선택) 기본 https://fapi.binance.com
//   PORT                 (Fly.io 자동 주입, 기본 8080)
//
// 인증:
//   모든 요청에 다음 헤더 필수
//     X-Proxy-Timestamp: 밀리초
//     X-Proxy-Signature: hex(HMAC-SHA256(PROXY_SHARED_SECRET, timestamp + "\n" + method + "\n" + path + "\n" + body))
//   timestamp는 현재 시각 기준 ±60초 범위여야 함 (리플레이 방지)
//
// 엔드포인트:
//   GET  /health                      Fly.io 헬스체크 (무인증)
//   GET  /ip                          현재 outbound IP 확인 (무인증, 화이트리스트 등록용)
//   POST /binance/request             범용 프록시. body: { apiKey, apiSecret, method, path, params, testnet }
//
//   (편의 래퍼 — 선택적, 내부에서 /binance/request 호출)
//   POST /binance/order               주문
//   GET  /binance/account             계정 조회
//   GET  /binance/positions           포지션 조회
//
// 주의: API key/secret은 이 서버에 저장되지 않음. 매 요청마다 Vercel에서 암호화 해제된 상태로 넘어옴.

import Fastify from "fastify";
import crypto from "node:crypto";

const app = Fastify({ logger: { level: process.env.LOG_LEVEL || "info" } });

// === 커스텀 JSON 파서: rawBody 보존 ===
// Fastify의 기본 JSON 파서는 body를 객체로 변환만 하는데, HMAC 검증 시
// JSON.stringify(req.body)로 재직렬화하면 원본 바이트와 달라질 수 있어 서명이 깨진다.
// 따라서 원본 문자열(rawBody)을 보존하고, preHandler에서 이를 사용해 HMAC을 검증한다.
//
// Fastify 4는 기본 JSON 파서가 이미 등록돼 있으므로 먼저 제거한 뒤 교체해야 한다.
app.removeContentTypeParser("application/json");
app.addContentTypeParser("application/json", { parseAs: "string" }, function (req, body, done) {
  req.rawBody = body || "";
  if (!body) {
    done(null, {});
    return;
  }
  try {
    done(null, JSON.parse(body));
  } catch (err) {
    err.statusCode = 400;
    done(err, undefined);
  }
});

const BINANCE_FAPI = process.env.BINANCE_FAPI_BASE || "https://fapi.binance.com";
const BINANCE_FAPI_TESTNET = "https://testnet.binancefuture.com";
const SHARED = process.env.PROXY_SHARED_SECRET || "";
const MAX_CLOCK_SKEW_MS = 60 * 1000;

if (!SHARED) {
  console.warn("[WARN] PROXY_SHARED_SECRET is empty — all authenticated requests will be rejected.");
}

// === 유틸 ===
function signInternal(timestamp, method, path, bodyStr) {
  return crypto
    .createHmac("sha256", SHARED)
    .update(`${timestamp}\n${method}\n${path}\n${bodyStr || ""}`)
    .digest("hex");
}

function signBinance(queryString, apiSecret) {
  return crypto.createHmac("sha256", apiSecret).update(queryString).digest("hex");
}

function buildQuery(params) {
  const entries = Object.entries(params || {}).filter(([, v]) => v !== undefined && v !== null && v !== "");
  return entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
}

// === 인증 미들웨어 (hook) ===
app.addHook("preHandler", async (req, reply) => {
  // 헬스체크 / IP 조회는 무인증
  if (req.url === "/health" || req.url === "/ip") return;

  if (!SHARED) {
    return reply.code(503).send({ ok: false, error: "Proxy not configured (missing PROXY_SHARED_SECRET)" });
  }

  const ts = req.headers["x-proxy-timestamp"];
  const sig = req.headers["x-proxy-signature"];
  if (!ts || !sig) {
    return reply.code(401).send({ ok: false, error: "Missing proxy auth headers" });
  }
  const tsNum = parseInt(ts, 10);
  if (!Number.isFinite(tsNum) || Math.abs(Date.now() - tsNum) > MAX_CLOCK_SKEW_MS) {
    return reply.code(401).send({ ok: false, error: "Stale or invalid timestamp" });
  }

  // HMAC은 반드시 원본 raw body 문자열에 대해 계산해야 한다.
  // req.body를 JSON.stringify로 재직렬화하면 파싱/재직렬화 과정에서
  // 원본과 바이트 단위로 다를 수 있어 서명이 깨진다.
  const bodyStr = req.rawBody || "";
  const expected = signInternal(ts, req.method, req.url, bodyStr);

  // timing-safe compare
  let a, b;
  try {
    a = Buffer.from(sig, "hex");
    b = Buffer.from(expected, "hex");
  } catch {
    return reply.code(401).send({ ok: false, error: "Invalid signature format" });
  }
  if (a.length === 0 || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    // 디버깅용: 원본 바이트를 그대로 출력하면 안 되지만 (apiKey/Secret 노출 위험)
    // 대신 길이와 SHA256 체크섬만 로그로 남겨 외부와 비교 가능하게 한다.
    const bodyHash = crypto.createHash("sha256").update(bodyStr).digest("hex").slice(0, 16);
    const firstBytes = bodyStr.slice(0, 30).replace(/"[^"]{20,}"/g, '"***"');
    req.log.warn({
      msg: "HMAC mismatch",
      version: BUILD_VERSION,
      ts,
      method: req.method,
      url: req.url,
      bodyLen: bodyStr.length,
      bodyHash,
      bodyPreview: firstBytes,
      sigLen: sig.length,
      expectedPrefix: expected.slice(0, 16),
      receivedPrefix: sig.toString().slice(0, 16),
      hasRawBody: typeof req.rawBody === "string",
    });
    return reply.code(401).send({ ok: false, error: "Invalid signature" });
  }
});

// === 헬스체크 ===
const BUILD_VERSION = "2026-04-08-rawbody-fix-2";
app.get("/health", async () => ({ ok: true, service: "zepta-binance-proxy", version: BUILD_VERSION, ts: Date.now() }));

// === outbound IP 확인 (바이낸스 화이트리스트 등록용) ===
app.get("/ip", async () => {
  try {
    const r = await fetch("https://api.ipify.org?format=json", { signal: AbortSignal.timeout(5000) });
    const d = await r.json();
    return { ok: true, ip: d.ip };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
});

// === 범용 바이낸스 프록시 ===
app.post("/binance/request", async (req, reply) => {
  const { apiKey, apiSecret, method = "GET", path, params = {}, testnet = false, signed = true, recvWindow = 5000 } = req.body || {};

  if (!path || typeof path !== "string" || !path.startsWith("/")) {
    return reply.code(400).send({ ok: false, error: "path required (must start with /)" });
  }
  if (signed && (!apiKey || !apiSecret)) {
    return reply.code(400).send({ ok: false, error: "apiKey/apiSecret required for signed request" });
  }

  const base = testnet ? BINANCE_FAPI_TESTNET : BINANCE_FAPI;

  let url = `${base}${path}`;
  const init = { method, headers: {} };

  if (signed) {
    const timestamp = Date.now();
    const all = { ...params, recvWindow, timestamp };
    const qs = buildQuery(all);
    const signature = signBinance(qs, apiSecret);
    url += `?${qs}&signature=${signature}`;
    init.headers["X-MBX-APIKEY"] = apiKey;
  } else {
    const qs = buildQuery(params);
    if (qs) url += `?${qs}`;
  }

  try {
    const resp = await fetch(url, { ...init, signal: AbortSignal.timeout(10000) });
    const text = await resp.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    return reply.code(resp.status).send({
      ok: resp.ok,
      status: resp.status,
      data,
    });
  } catch (e) {
    return reply.code(502).send({ ok: false, error: "Binance upstream error", detail: e?.message || String(e) });
  }
});

// === start ===
const port = parseInt(process.env.PORT || "8080", 10);
app
  .listen({ port, host: "0.0.0.0" })
  .then(() => console.log(`[binance-proxy] listening on :${port}`))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
