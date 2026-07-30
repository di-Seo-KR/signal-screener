// ════════════════════════════════════════════════════════════════════
// GET /api/sitemap-briefings — 일일 브리핑 XML 사이트맵
// ────────────────────────────────────────────────────────────────────
// rewrite: /sitemap-briefings.xml → 이 핸들러.
// di:briefing:index (날짜 배열, 내림차순 최근 400) 로 /briefing/{date}
// 엔트리를 생성합니다. lastmod = 해당 날짜. robots.txt 에 Sitemap 줄 등록됨.
// ════════════════════════════════════════════════════════════════════

import { BRIEFING_INDEX_KEY } from "./_shared/briefing.js";
import { SITE } from "./_shared/page-shell.js";

async function getKv() { return (await import("@vercel/kv")).kv; }

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default async function handler(req, res) {
  try {
    const kv = await getKv();
    const idx = (await kv.get(BRIEFING_INDEX_KEY)) || [];
    const dates = (Array.isArray(idx) ? idx : []).filter((d) => typeof d === "string" && DATE_RE.test(d));

    const urls = dates.map((d) => `  <url>
    <loc>${SITE}/briefing/${d}</loc>
    <lastmod>${d}</lastmod>
    <changefreq>never</changefreq>
    <priority>0.7</priority>
  </url>`).join("\n");

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400");
    return res.status(200).send(xml);
  } catch (err) {
    console.error("[sitemap-briefings]", err);
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n</urlset>\n`);
  }
}
