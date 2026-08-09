// ════════════════════════════════════════════════════════════════════
// GET /api/econ-page — 경제지표 발표 결과 서빙 (정보 피벗 2차)
// ────────────────────────────────────────────────────────────────────
// rewrites: /econ → 목록(허브), /econ/:key → 개별 발표 결과 페이지.
//   개별 페이지 HTML 은 크론(api/agents/econ-results.js)이 di:econ-page:{key} 에
//   미리 생성해 둔 것을 그대로 서빙합니다 (요청 시 생성 없음 — 미발표 빈 페이지 불가).
//
// 허브(/econ)는 di:econ-page:index 메타로 목록을 렌더합니다. 목록이 비어 있어도
// 섹션 소개·경제 캘린더 링크가 있는 정상 콘텐츠 페이지를 서빙합니다.
// ════════════════════════════════════════════════════════════════════

import { renderPage, escH, SITE, DISCLAIMER_LINE } from "./_shared/page-shell.js";
import { ECON_PAGE_KEY, ECON_INDEX_KEY, ECON_KEY_RE, fmtVal, koreanDate } from "./_shared/econ-content.js";

async function getKv() {
  try {
    const { kv } = await import("@vercel/kv");
    const get = kv.get.bind(kv);
    return { get };
  } catch { return null; }
}

export const config = { maxDuration: 30 };

/**
 * null/undefined/"" 를 NaN 으로 변환합니다 — Number(null)===0 이라
 * 집계되지 않은 컨센서스가 '예측 0K·0%' 로 지어내지는 함정을 차단합니다.
 * (과거 세대 인덱스에 문자열 수치("4.2")가 저장된 경우도 정상 처리)
 */
function toNum(v) {
  return v === null || v === undefined || v === "" ? NaN : Number(v);
}

function send(res, status, html, cacheSeconds = 600) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader(
    "Cache-Control",
    status === 200 ? `public, s-maxage=${cacheSeconds}, stale-while-revalidate=3600` : "no-store",
  );
  return res.status(status).send(html);
}

function notFoundHtml(key) {
  const bodyHtml = `    <div class="breadcrumb"><a href="/">홈</a> › <a href="/econ">경제지표 발표 결과</a></div>
    <h1>해당 발표 결과 페이지가 없습니다</h1>
    <p>${escH(String(key).slice(0, 60))} 페이지는 아직 발행되지 않았거나 존재하지 않는 주소입니다. 발표 결과 페이지는 지표 발표 후 1시간 이내 자동 발행됩니다.</p>
    <div class="cta">
      <p>발행된 발표 결과 전체 목록을 확인해 보세요.</p>
      <a href="/econ">경제지표 발표 결과 모음 →</a>
    </div>`;
  return renderPage({
    title: "발표 결과 없음 | Zepta 경제지표",
    metaDesc: "요청하신 경제지표 발표 결과 페이지가 없습니다. 전체 목록으로 이동해 주세요.",
    canonical: `${SITE}/econ`,
    bodyHtml,
    ogType: "website",
  });
}

function renderHub(index) {
  const entries = (Array.isArray(index) ? index : [])
    .filter((e) => e && typeof e.key === "string" && ECON_KEY_RE.test(e.key))
    .slice(0, 200);

  const title = "미국 경제지표 발표 결과 모음 — CPI·고용·FOMC | Zepta";
  const metaDesc = "미국 CPI·고용지표·FOMC 등 주요 경제지표의 발표치 vs 예측치 vs 이전치를 발표 직후 자동 정리합니다. 서프라이즈 방향과 지표 해설 포함.";

  const listHtml = entries.length > 0
    ? `<div class="news-list">
${entries.map((e) => {
      const label = `${e.date} — ${e.ko || e.event}`;
      // 컨센서스 미집계(null)면 예측 표기를 아예 생략합니다 (fmtVal 은 NaN 에 "—" 폴백)
      const act = toNum(e.actual);
      const est = toNum(e.estimate);
      const nums = `발표 ${fmtVal(act, e.unit)}${Number.isFinite(est) ? ` · 예측 ${fmtVal(est, e.unit)}` : ""}`;
      return `      <a href="/econ/${escH(e.key)}">${escH(label)}<span class="src">${escH(nums)}</span></a>`;
    }).join("\n")}
    </div>`
    : `<p>아직 발행된 발표 결과 페이지가 없습니다. 다음 지표 발표 후 1시간 이내 이 목록에 자동으로 추가됩니다. 다가오는 발표 일정은 <a href="/econ-calendar">경제 캘린더</a>에서 확인하실 수 있습니다.</p>`;

  const jsonLd = [
    {
      "@context": "https://schema.org", "@type": "CollectionPage",
      name: "미국 경제지표 발표 결과 모음",
      description: metaDesc,
      url: `${SITE}/econ`,
    },
    {
      "@context": "https://schema.org", "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "홈", item: SITE + "/" },
        { "@type": "ListItem", position: 2, name: "경제지표 발표 결과", item: `${SITE}/econ` },
      ],
    },
  ];

  const latest = entries[0];
  const bodyHtml = `    <div class="breadcrumb"><a href="/">홈</a> › 경제지표 발표 결과</div>
    <h1>미국 경제지표 발표 결과 모음</h1>
    <div class="meta-row">CPI · 고용 · FOMC · PCE 등 주요 지표 발표 직후 자동 발행${latest ? ` · 최신 ${escH(koreanDate(latest.date))}` : ""}</div>

    <p>미국 주요 경제지표의 <strong>발표치·시장 예측치(컨센서스)·이전치</strong>를 발표 직후 자동으로 정리한 기록 모음입니다. 각 페이지에는 서프라이즈 방향의 사실 정리와 해당 지표가 무엇을 측정하는지에 대한 설명이 함께 담겨 있습니다.</p>

    <h2>발표 결과 목록</h2>
    ${listHtml}

    <div class="disc">⚠️ ${escH(DISCLAIMER_LINE)} 발표치·예측치는 공개 데이터 소스 집계 기준이며 이후 정정될 수 있습니다.</div>

    <div class="related">
      <h3>더 살펴보기</h3>
      <a href="/econ-calendar">경제 캘린더 — 다가오는 발표 일정과 컨센서스</a>
      <a href="/briefing">오늘의 코인 시장 브리핑</a>
      <a href="/kimchi-premium">김치프리미엄 실시간</a>
    </div>`;

  return renderPage({ title, metaDesc, canonical: `${SITE}/econ`, bodyHtml, jsonLd, ogType: "website" });
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const kv = await getKv();
    const key = typeof req.query?.key === "string" ? req.query.key.trim() : "";

    // ── 개별 발표 결과 페이지 ──
    if (key) {
      if (!ECON_KEY_RE.test(key)) return send(res, 404, notFoundHtml(key));
      const html = kv ? await kv.get(ECON_PAGE_KEY(key)) : null;
      if (typeof html === "string" && html.startsWith("<!DOCTYPE")) {
        return send(res, 200, html, 3600); // 발표 결과는 불변 — 1시간 CDN 캐시
      }
      return send(res, 404, notFoundHtml(key));
    }

    // ── 허브(목록) ──
    const index = kv ? await kv.get(ECON_INDEX_KEY) : null;
    return send(res, 200, renderHub(index), 600);
  } catch (err) {
    console.error("[econ-page]", err);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    return res.status(500).send("<!DOCTYPE html><html lang=\"ko\"><body>페이지를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</body></html>");
  }
}
