// ════════════════════════════════════════════════════════════════════
// Zepta — 실시간 베타 가입자 수 조회 API (2026-05-12, MKT-LEAD)
// ──────────────────────────────────────────────────────────────────
// GET /api/stats/beta-count
//   응답: { ok: true, count: 1234, updatedAt: "2026-05-12T..." }
//
// 홈 비로그인 배너의 신뢰 시그널 4-pill 중 "베타 무료" → "베타 사용자 N+"
// 로 동적 노출하기 위한 카운트 엔드포인트입니다.
//
// 카운트 산정 (가중치 적용 X — 단순 합):
//   1) KV `zepta:beta-waitlist:payment:emails` (set cardinality)
//   2) KV `zepta:beta-waitlist:payment:uids`   (set cardinality)
//   3) 베이스라인 + (총합) — 베이스라인은 사전 가입 추정치
//
// 환경:
//   - KV 미설정 시 베이스라인만 노출 (서비스 차단 없음).
//
// 캐시:
//   - Vercel Edge Cache: 15분 (s-maxage=900).
// ════════════════════════════════════════════════════════════════════

const KV_LIST_KEY = "zepta:beta-waitlist:payment";
// ★ 2026-06-14 (대표 지시): 가짜 추산 baseline(1200) 제거 — 실제 KV 카운트만 정직 반환.
//   홈 배너는 이제 이 API 를 호출하지 않음(App.jsx 에서 제거). 실가입수는 /marketing 에서.
const BASELINE = 0;

async function getKv() {
  try {
    if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) return null;
    const m = await import("@vercel/kv");
    return m.kv;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  // 15 분 edge cache + stale-while-revalidate 1 시간
  res.setHeader("Cache-Control", "public, s-maxage=900, stale-while-revalidate=3600");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const updatedAt = new Date().toISOString();
  const kv = await getKv();

  if (!kv) {
    // KV 미설정 — 베이스라인만 노출. count 가 0 이 아니라 BASELINE 으로
    // 응답해야 클라이언트가 잘못된 "0+" 노출을 피할 수 있음.
    return res.status(200).json({ ok: true, count: BASELINE, updatedAt, storage: "none" });
  }

  try {
    // SCARD — 이메일 / uid 두 집합의 cardinality 합산
    const [emails, uids] = await Promise.all([
      kv.scard(`${KV_LIST_KEY}:emails`).catch(() => 0),
      kv.scard(`${KV_LIST_KEY}:uids`).catch(() => 0),
    ]);
    const live = (Number(emails) || 0) + (Number(uids) || 0);
    const count = BASELINE + live;
    return res.status(200).json({ ok: true, count, updatedAt, storage: "kv", baseline: BASELINE, live });
  } catch (e) {
    // KV 장애 시에도 UX 보존 — baseline 반환
    return res.status(200).json({
      ok: true,
      count: BASELINE,
      updatedAt,
      storage: "none",
      warning: `KV 조회 실패 (${e?.message || "unknown"})`,
    });
  }
}
