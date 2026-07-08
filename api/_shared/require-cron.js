// ════════════════════════════════════════════════════════════════════
// 크론/내부 전용 엔드포인트 인증 가드 — timing-tracker(#200) 패턴의 공유화
// ────────────────────────────────────────────────────────────────────
// 2026-07-08 (스윙 전환 진단 부수 발견): api/agents/* 12개가 무인증으로 열려
// 내부 거래 통계 노출(shadow-debug)·상태 변경(auto-promote/param-tuner)·
// 텔레그램 발송 트리거(daily-standup)가 외부에서 가능했음 → 일괄 차단.
//
// 허용 경로 3가지 (기존 timing-tracker 와 동일):
//   ① Vercel Cron 호출 (x-vercel-cron 헤더 — CRON_SECRET 설정 시 Vercel 이
//      Authorization: Bearer 도 자동 첨부)
//   ② Authorization: Bearer <CRON_SECRET>
//   ③ ?key=<CRON_SECRET> (대표 수동 트리거용)
// CRON_SECRET 미설정 환경에서는 무동작(fail-open) — 크론 무중단 보장.
// ════════════════════════════════════════════════════════════════════

/** 인증 실패 시 401 응답을 보내고 false 반환. 핸들러는 `if (!requireCronAuth(req, res)) return;` */
export function requireCronAuth(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // 미설정 환경 — 차단하지 않음 (기존 크론 무중단)
  const auth = req.headers?.authorization || "";
  const isCron = req.headers?.["x-vercel-cron"] != null;
  if (isCron || auth === `Bearer ${secret}` || req.query?.key === secret) return true;
  res.status(401).json({ ok: false, error: "unauthorized" });
  return false;
}

export default { requireCronAuth };
