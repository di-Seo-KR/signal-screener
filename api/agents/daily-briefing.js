// ════════════════════════════════════════════════════════════════════
// 일일 마켓 브리핑 생성 크론 — /api/agents/daily-briefing
// ────────────────────────────────────────────────────────────────────
// Cron: "0 22 * * *" (UTC 22:00 = KST 익일 07:00) — vercel.json crons 등록.
// KST 기준 오늘 날짜의 브리핑 HTML 을 조립해 KV 에 저장합니다.
//   di:briefing:{YYYY-MM-DD} + di:briefing:index (최근 400)
//
// 크론 실패 대비 fail-safe: api/briefing.js 가 같은 조립 모듈로 lazy 생성.
// 수동 트리거: ?key=<CRON_SECRET> (require-cron 공통 규칙).
// ════════════════════════════════════════════════════════════════════

import { requireCronAuth } from "../_shared/require-cron.js";
import { buildDailyBriefing, saveBriefing, kstDateString } from "../_shared/briefing.js";

async function getKv() { return (await import("@vercel/kv")).kv; }
export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (!requireCronAuth(req, res)) return; // ★ 크론/내부 전용
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");

  try {
    const kv = await getKv();
    const date = kstDateString();
    const { html, meta } = await buildDailyBriefing(kv, { date });
    await saveBriefing(kv, date, html);
    return res.status(200).json({ ok: true, date, url: `/briefing/${date}`, meta });
  } catch (err) {
    console.error("[daily-briefing]", err);
    return res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
}
