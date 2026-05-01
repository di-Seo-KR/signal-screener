// ════════════════════════════════════════════════════════════════════
// GA4 Data API 읽기 모듈 — Service Account JWT 직접 서명 (외부 SDK 미사용)
//
// 환경변수:
//   GA4_PROPERTY_ID       — GA4 Property ID (예: "382839472"; "properties/" 없이 숫자만)
//   GA4_SA_CLIENT_EMAIL   — 서비스 계정 이메일
//   GA4_SA_PRIVATE_KEY    — 서비스 계정 RSA private key (PEM, \n 그대로 또는 실제 줄바꿈)
//
// 사용:
//   const summary = await fetchGA4DailySummary({ daysBack: 1 });
//   summary === null 이면 환경변수 미설정 (graceful fallback)
//
// ════════════════════════════════════════════════════════════════════

import crypto from "node:crypto";

const SCOPE = "https://www.googleapis.com/auth/analytics.readonly";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DATA_API = "https://analyticsdata.googleapis.com/v1beta";

function base64url(input) {
  return Buffer.from(input).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function buildJwt(clientEmail, privateKey) {
  const header = { alg: "RS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const claim = {
    iss: clientEmail,
    scope: SCOPE,
    aud: TOKEN_URL,
    exp: now + 3600,
    iat: now,
  };
  const headerB64 = base64url(JSON.stringify(header));
  const claimB64 = base64url(JSON.stringify(claim));
  const signInput = `${headerB64}.${claimB64}`;
  // GA4_SA_PRIVATE_KEY 는 \n 이스케이프되어 있을 수 있음 — 실제 줄바꿈으로 정규화
  const pem = privateKey.replace(/\\n/g, "\n");
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(signInput);
  signer.end();
  const signature = signer.sign(pem);
  return `${signInput}.${base64url(signature)}`;
}

async function getAccessToken(clientEmail, privateKey) {
  const jwt = buildJwt(clientEmail, privateKey);
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }).toString(),
  });
  if (!r.ok) throw new Error(`GA4 token exchange failed: ${r.status} ${await r.text()}`);
  const j = await r.json();
  return j.access_token;
}

async function runReport(propertyId, accessToken, body) {
  const url = `${DATA_API}/properties/${propertyId}:runReport`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`GA4 runReport failed: ${r.status} ${await r.text()}`);
  return r.json();
}

// ── 일일 요약 ──
//   - 어제(daysBack=1) 기준
//   - 사용자/세션/페이지뷰
//   - 상위 3 페이지 (path)
//   - 상위 3 유입 경로 (sessionDefaultChannelGroup)
//   - 상위 3 키워드 (가능한 경우 — googleSearchConsoleQuery)
export async function fetchGA4DailySummary({ daysBack = 1 } = {}) {
  const propertyId = process.env.GA4_PROPERTY_ID;
  const clientEmail = process.env.GA4_SA_CLIENT_EMAIL;
  const privateKey = process.env.GA4_SA_PRIVATE_KEY;
  if (!propertyId || !clientEmail || !privateKey) {
    return null; // graceful fallback — MKT-LEAD 가 "데이터 없음" 모드로 처리
  }

  const startDate = `${daysBack}daysAgo`;
  const endDate = `${daysBack}daysAgo`;

  try {
    const token = await getAccessToken(clientEmail, privateKey);

    const [overall, pages, channels] = await Promise.all([
      runReport(propertyId, token, {
        dateRanges: [{ startDate, endDate }],
        metrics: [
          { name: "totalUsers" },
          { name: "sessions" },
          { name: "screenPageViews" },
          { name: "averageSessionDuration" },
          { name: "bounceRate" },
        ],
      }),
      runReport(propertyId, token, {
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: "pagePath" }],
        metrics: [{ name: "screenPageViews" }],
        orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
        limit: 5,
      }),
      runReport(propertyId, token, {
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: "sessionDefaultChannelGroup" }],
        metrics: [{ name: "sessions" }],
        orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
        limit: 5,
      }),
    ]);

    const m = overall.rows?.[0]?.metricValues || [];
    const overallMetrics = {
      users: Number(m[0]?.value || 0),
      sessions: Number(m[1]?.value || 0),
      pageviews: Number(m[2]?.value || 0),
      avgSessionDurationSec: Number(m[3]?.value || 0),
      bounceRate: Number(m[4]?.value || 0),
    };

    const topPages = (pages.rows || []).map((r) => ({
      path: r.dimensionValues?.[0]?.value || "",
      pageviews: Number(r.metricValues?.[0]?.value || 0),
    }));

    const topChannels = (channels.rows || []).map((r) => ({
      channel: r.dimensionValues?.[0]?.value || "",
      sessions: Number(r.metricValues?.[0]?.value || 0),
    }));

    return {
      date: startDate, // "1daysAgo"
      ...overallMetrics,
      topPages,
      topChannels,
    };
  } catch (e) {
    console.error("[ga4] fetch failed:", e?.message || e);
    return { error: e?.message || String(e) };
  }
}
