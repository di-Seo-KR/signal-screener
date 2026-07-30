// ════════════════════════════════════════════════════════════════════
// GET /api/briefing?date=YYYY-MM-DD — 일일 마켓 브리핑 서빙
// ────────────────────────────────────────────────────────────────────
// rewrites: /briefing → 최신 브리핑, /briefing/:date → 해당 날짜.
//
// 동작:
//   · date 없음 → 인덱스 최신 날짜 서빙 (인덱스 비어있으면 오늘 자 lazy 생성)
//   · date == 오늘(KST) 인데 KV 미존재 → lazy 생성 (크론 실패 대비 fail-safe —
//     api/agents/daily-briefing.js 와 동일한 조립 모듈 공유)
//   · 과거/미래 날짜 미존재 → 404 + 최신 브리핑 안내 링크
//
// 응답: text/html; charset=utf-8, Cache-Control s-maxage=600.
// ════════════════════════════════════════════════════════════════════

import {
  buildDailyBriefing, saveBriefing, kstDateString,
  BRIEFING_KEY, BRIEFING_INDEX_KEY,
} from "./_shared/briefing.js";
import { renderPage, escH, SITE } from "./_shared/page-shell.js";

async function getKv() { return (await import("@vercel/kv")).kv; }
export const config = { maxDuration: 60 }; // lazy 생성 경로 대비

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function send(res, status, html, cacheSeconds = 600) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader(
    "Cache-Control",
    status === 200 ? `public, s-maxage=${cacheSeconds}, stale-while-revalidate=3600` : "no-store",
  );
  return res.status(status).send(html);
}

function notFoundHtml(date, latestDate) {
  const bodyHtml = `    <div class="breadcrumb"><a href="/">홈</a> › <a href="/briefing">마켓 브리핑</a></div>
    <h1>해당 날짜의 브리핑이 없습니다</h1>
    <p>${escH(date)} 자 브리핑은 아직 발행되지 않았거나 존재하지 않는 날짜입니다. 브리핑은 매일 아침 KST 07:00 에 자동 발행됩니다.</p>
    <div class="cta">
      <p>가장 최근 발행된 브리핑을 확인해 보세요.</p>
      <a href="${latestDate ? `/briefing/${escH(latestDate)}` : "/briefing"}">${latestDate ? escH(latestDate) + " 브리핑 보기 →" : "최신 브리핑 보기 →"}</a>
    </div>`;
  return renderPage({
    title: "브리핑 없음 | Zepta 마켓 브리핑",
    metaDesc: "요청하신 날짜의 코인 시장 브리핑이 없습니다. 최신 브리핑으로 이동해 주세요.",
    canonical: `${SITE}/briefing`,
    bodyHtml,
    ogType: "website",
  });
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const kv = await getKv();
    const today = kstDateString();
    const reqDate = typeof req.query?.date === "string" ? req.query.date.trim() : "";

    if (reqDate && !DATE_RE.test(reqDate)) {
      return send(res, 404, notFoundHtml(reqDate.slice(0, 40), null));
    }

    // ── 서빙 대상 날짜 결정 ──
    let date = reqDate;
    if (!date) {
      const idx = (await kv.get(BRIEFING_INDEX_KEY)) || [];
      date = (Array.isArray(idx) && typeof idx[0] === "string" && DATE_RE.test(idx[0])) ? idx[0] : today;
    }

    // ── KV 조회 ──
    let html = await kv.get(BRIEFING_KEY(date));
    if (typeof html === "string" && html.startsWith("<!DOCTYPE")) {
      return send(res, 200, html);
    }

    // ── 미존재: 오늘 자면 lazy 생성 (크론 실패 대비 fail-safe) ──
    if (date === today) {
      const { html: fresh } = await buildDailyBriefing(kv, { date });
      try { await saveBriefing(kv, date, fresh); } catch { /* 저장 실패해도 서빙은 진행 */ }
      return send(res, 200, fresh, 300);
    }

    // ── 과거/미래 날짜 미존재 → 404 + 최신 안내 ──
    const idx = (await kv.get(BRIEFING_INDEX_KEY)) || [];
    const latest = (Array.isArray(idx) && typeof idx[0] === "string" && DATE_RE.test(idx[0])) ? idx[0] : null;
    return send(res, 404, notFoundHtml(date, latest));
  } catch (err) {
    console.error("[briefing]", err);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    return res.status(500).send("<!DOCTYPE html><html lang=\"ko\"><body>브리핑을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</body></html>");
  }
}
