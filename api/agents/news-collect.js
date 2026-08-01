// ════════════════════════════════════════════════════════════════════
// 뉴스 수집 크론 — 네이버 검색 오픈 API → KV 뉴스 풀
// ────────────────────────────────────────────────────────────────────
// 2026-08 (대표 지시 — 마켓 뉴스 품질 개편):
//   20분마다 카테고리 4축(크립토·한국증시·미국증시·거시경제) × 키워드 31개를
//   순회 수집해 정규화·품질필터·중복제거 후 KV 풀에 적재합니다.
//   배급(/api/news)은 이 풀만 읽으므로 사용자 요청 경로가 항상 빠릅니다.
//
// KV:
//   di:news:pool       → [{title, url, date, desc, source, tags, category, categories}] (최근 300건)
//   di:news:updatedAt  → ISO 문자열 (배급 측 신선도 판정용)
//
// Cron: */20 * * * *  (vercel.json)
// 인증: requireCronAuth — 외부 호출로 네이버 쿼터를 소모당하지 않도록 막습니다.
//
// 키(NAVER_CLIENT_ID/SECRET) 미설정 시 즉시 ok:false 로 종료하고 KV 에 아무것도
// 쓰지 않습니다 — 폴백(RSS)은 api/news.js 가 담당하므로 여기서 흉내내지 않습니다.
// ════════════════════════════════════════════════════════════════════

import { requireCronAuth } from "../_shared/require-cron.js";
import {
  NEWS_CATEGORIES,
  collectNaverNews,
  hasNaverCredentials,
  readNewsPool,
  writeNewsPool,
  acquireCollectLock,
  releaseCollectLock,
} from "../_shared/news-sources.js";

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (!requireCronAuth(req, res)) return;

  const t0 = Date.now();

  if (!hasNaverCredentials()) {
    // 키 미설정 — 미기록으로 종료합니다(대표 Vercel env 등록 전 상태).
    return res.status(200).json({
      ok: false,
      reason: "naver-credentials-missing",
      hint: "NAVER_CLIENT_ID / NAVER_CLIENT_SECRET 환경변수가 필요합니다",
      elapsedMs: Date.now() - t0,
    });
  }

  // 크론이 겹치거나 lazy 수집과 충돌할 때 네이버 쿼터를 이중 소모하지 않도록 락을 잡습니다.
  const locked = await acquireCollectLock(150);
  if (!locked) {
    return res.status(200).json({
      ok: true,
      skipped: "collect-in-progress",
      elapsedMs: Date.now() - t0,
    });
  }

  try {
    const now = Date.now();
    const result = await collectNaverNews({ categories: NEWS_CATEGORIES, display: 30, now });

    if (!result.ok) {
      // 전량 실패 — 기존 풀을 덮어써서 비우는 일이 없도록 기록하지 않습니다.
      return res.status(200).json({
        ok: false,
        reason: result.reason,
        stats: result.stats,
        elapsedMs: Date.now() - t0,
      });
    }

    const { pool: existingPool } = await readNewsPool();
    const written = await writeNewsPool(result.articles, { existingPool, now });

    // 적재 결과를 카테고리별로 요약해 편중 여부를 바로 볼 수 있게 합니다.
    const byCategory = {};
    for (const c of NEWS_CATEGORIES) byCategory[c.id] = 0;
    try {
      const { pool } = await readNewsPool();
      for (const a of pool) {
        const key = a?.category || "etc";
        byCategory[key] = (byCategory[key] || 0) + 1;
      }
    } catch {
      /* 요약 실패는 무시합니다 — 적재 자체는 이미 끝났습니다 */
    }

    return res.status(200).json({
      ok: written.ok,
      collected: result.articles.length,
      poolSize: written.size,
      added: written.added,
      byCategory,
      stats: result.stats,
      kv: written.ok ? "written" : written.reason,
      elapsedMs: Date.now() - t0,
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: String(e?.message || e),
      elapsedMs: Date.now() - t0,
    });
  } finally {
    await releaseCollectLock();
  }
}
