// ════════════════════════════════════════════════════════════════════
// GET /api/sitemap-econ — 경제지표 발표 결과 XML 사이트맵 (정보 피벗 2차)
// ────────────────────────────────────────────────────────────────────
// rewrite: /sitemap-econ.xml → 이 핸들러 (sitemap-briefings 와 동일 패턴).
// di:econ-page:index 메타로 /econ 허브 + /econ/{key} 엔트리를 생성합니다.
// lastmod = 발표일. robots.txt 에 Sitemap 줄 등록됨.
// ════════════════════════════════════════════════════════════════════

import { ECON_INDEX_KEY, ECON_KEY_RE } from "./_shared/econ-content.js";
import { SITE } from "./_shared/page-shell.js";

async function getKv() { return (await import("@vercel/kv")).kv; }

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default async function handler(req, res) {
  try {
    const kv = await getKv();
    const idx = (await kv.get(ECON_INDEX_KEY)) || [];
    const entries = (Array.isArray(idx) ? idx : [])
      .filter((e) => e && typeof e.key === "string" && ECON_KEY_RE.test(e.key) && DATE_RE.test(String(e.date)));

    const hubLastmod = entries.length > 0 ? entries[0].date : new Date().toISOString().slice(0, 10);
    const urls = [
      `  <url>
    <loc>${SITE}/econ</loc>
    <lastmod>${hubLastmod}</lastmod>
    <changefreq>daily</changefreq>
    <priority>0.8</priority>
  </url>`,
      ...entries.map((e) => `  <url>
    <loc>${SITE}/econ/${e.key}</loc>
    <lastmod>${e.date}</lastmod>
    <changefreq>never</changefreq>
    <priority>0.6</priority>
  </url>`),
    ].join("\n");

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400");
    return res.status(200).send(xml);
  } catch (err) {
    console.error("[sitemap-econ]", err);
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n</urlset>\n`);
  }
}
