// ════════════════════════════════════════════════════════════════════
// GA4 연결 검증 endpoint
//
// 환경변수 (GA4_PROPERTY_ID / GA4_SA_CLIENT_EMAIL / GA4_SA_PRIVATE_KEY)
// 셋업 후 이걸 호출하면 즉시 GA4 Data API 가 작동하는지 확인 가능.
//
// GET /api/agents/ga4-check
// →
//   { ok: true, status: "connected", summary: {...} }
//   { ok: true, status: "env_missing", missing: [...] }
//   { ok: true, status: "error", error: "..." }
//
// ════════════════════════════════════════════════════════════════════

import { fetchGA4DailySummary } from "../_shared/ga4.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  // 환경변수 존재 여부 (값은 노출 안 함)
  const envCheck = {
    GA4_PROPERTY_ID: !!process.env.GA4_PROPERTY_ID,
    GA4_SA_CLIENT_EMAIL: !!process.env.GA4_SA_CLIENT_EMAIL,
    GA4_SA_PRIVATE_KEY: !!process.env.GA4_SA_PRIVATE_KEY,
  };
  const missing = Object.entries(envCheck)
    .filter(([, has]) => !has)
    .map(([k]) => k);

  if (missing.length > 0) {
    return res.status(200).json({
      ok: true,
      status: "env_missing",
      envCheck,
      missing,
      hint: "Vercel → Settings → Environment Variables 에서 위 변수 추가 후 재배포",
    });
  }

  // 환경변수 모두 있을 때 — 실제 GA4 Data API 호출
  try {
    const result = await fetchGA4DailySummary({ daysBack: 1 });
    if (result === null) {
      return res.status(200).json({
        ok: true,
        status: "env_missing",
        hint: "fetchGA4DailySummary 가 null 반환 — env var 누락 또는 형식 오류",
      });
    }
    if (result.error) {
      return res.status(200).json({
        ok: true,
        status: "error",
        error: result.error,
        hint: errorHint(result.error),
      });
    }
    return res.status(200).json({
      ok: true,
      status: "connected",
      propertyId: process.env.GA4_PROPERTY_ID,
      summary: result,
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      status: "exception",
      error: e?.message || String(e),
    });
  }
}

function errorHint(msg) {
  if (!msg) return null;
  if (/token exchange failed/i.test(msg)) {
    return "JWT 서명 실패 — GA4_SA_PRIVATE_KEY 형식 문제 (줄바꿈 보존 또는 \\n 이스케이프 정확한지 확인)";
  }
  if (/403|permission|forbidden/i.test(msg)) {
    return "권한 부족 — GA4 → 관리 → 속성 액세스 관리 에서 서비스 계정 이메일에 '뷰어' 권한 부여";
  }
  if (/404|not found/i.test(msg)) {
    return "Property ID 잘못됨 — GA4 → 관리 → 속성 설정 의 속성 ID (숫자) 확인";
  }
  if (/invalid_grant/i.test(msg)) {
    return "Service Account 키 만료 또는 시계 어긋남";
  }
  return "Vercel logs 또는 위 error 메시지로 진단";
}
