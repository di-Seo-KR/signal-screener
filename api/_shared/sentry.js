// ════════════════════════════════════════════════════════════════════
// Sentry 일일 요약 — 어제 새 이슈 / 빈도 높은 이슈 / 미해결 회귀
//
// 환경변수:
//   SENTRY_AUTH_TOKEN     — 사용자 또는 프로젝트 인증 토큰 (Settings → Auth Tokens)
//   SENTRY_ORG_SLUG       — 조직 slug (예: "zepta")
//   SENTRY_PROJECT_SLUG   — 프로젝트 slug (예: "zepta-web")
//   SENTRY_REGION_URL     — (선택) 자체 호스팅 시 베이스 URL. 기본값: https://sentry.io
//
// 사용:
//   const summary = await fetchSentryDailySummary();
//   summary === null 이면 환경변수 미설정 (graceful fallback)
// ════════════════════════════════════════════════════════════════════

export async function fetchSentryDailySummary({ daysBack = 1 } = {}) {
  const token = process.env.SENTRY_AUTH_TOKEN;
  const org = process.env.SENTRY_ORG_SLUG;
  const project = process.env.SENTRY_PROJECT_SLUG;
  const base = process.env.SENTRY_REGION_URL || "https://sentry.io";
  if (!token || !org || !project) {
    return null; // graceful fallback
  }

  // 24시간 윈도우 (어제 00:00 ~ 어제 24:00 KST 기준 근사 — Sentry 는 UTC 사용)
  const now = Date.now();
  const start = new Date(now - daysBack * 86400000);
  const end = new Date(now - (daysBack - 1) * 86400000);
  const since = start.toISOString();
  const until = end.toISOString();

  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  try {
    // 1) 최근 이슈 (firstSeen 윈도우 내)
    const newIssuesUrl = `${base}/api/0/projects/${org}/${project}/issues/?` +
      new URLSearchParams({
        statsPeriod: `${daysBack}d`,
        sort: "freq",
        query: `is:unresolved firstSeen:>=${since}`,
        limit: "10",
      }).toString();
    const newR = await fetch(newIssuesUrl, { headers });
    const newIssues = newR.ok ? await newR.json() : [];

    // 2) 가장 자주 발생하는 미해결 이슈 (윈도우 내)
    const topIssuesUrl = `${base}/api/0/projects/${org}/${project}/issues/?` +
      new URLSearchParams({
        statsPeriod: `${daysBack}d`,
        sort: "freq",
        query: "is:unresolved",
        limit: "5",
      }).toString();
    const topR = await fetch(topIssuesUrl, { headers });
    const topIssues = topR.ok ? await topR.json() : [];

    const simplify = (arr) => (Array.isArray(arr) ? arr : []).map((it) => ({
      id: it.shortId || it.id,
      title: it.title,
      culprit: it.culprit,
      level: it.level,
      count: Number(it.count || 0),
      userCount: Number(it.userCount || 0),
      firstSeen: it.firstSeen,
      permalink: it.permalink,
    }));

    return {
      window: { since, until },
      newIssues: simplify(newIssues),
      topIssues: simplify(topIssues),
    };
  } catch (e) {
    console.error("[sentry] fetch failed:", e?.message || e);
    return { error: e?.message || String(e) };
  }
}
