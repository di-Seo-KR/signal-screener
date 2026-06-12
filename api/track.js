// ════════════════════════════════════════════════════════════════════
// Zepta — 퍼스트파티 애널리틱스 수집기 (GA 대체, 2026-06-12 대표 지시)
// POST /api/track
//
// 설계 원칙:
//   - 무쿠키 · 익명: vid 는 클라이언트 localStorage 의 랜덤 UUID (PII 없음, IP 미저장)
//   - KV(Upstash) 일별 집계만 저장 — 원본 이벤트 로그 없음 (개인정보·비용 최소화)
//   - 절대 실패 노출 금지: 어떤 오류든 204 (수집기가 본 서비스에 영향 0)
//
// payload: { t:"pv"|"ev", path, ref, utm, vid, dev:"m"|"d", ev, label }
// KV 스키마 (KST 일자 기준, 90일 TTL):
//   di:mkt:pv:<day>   hash  path → count        (페이지뷰)
//   di:mkt:uv:<day>   set   vid                 (고유 방문자)
//   di:mkt:ref:<day>  hash  refDomain → count   (유입 출처, 내부/없음 = direct)
//   di:mkt:utm:<day>  hash  source → count      (UTM 캠페인 유입)
//   di:mkt:dev:<day>  hash  m|d → count         (디바이스)
//   di:mkt:ev:<day>   hash  eventName → count   (전환/행동 이벤트)
// ════════════════════════════════════════════════════════════════════

export const config = { maxDuration: 10 };

const TTL = 90 * 24 * 60 * 60; // 90일

function kstDay() {
  const d = new Date(Date.now() + 9 * 3600000);
  return d.toISOString().slice(0, 10);
}

function clean(s, max = 80) {
  if (typeof s !== "string") return null;
  const t = s.trim().slice(0, max);
  return t || null;
}

// 경로 정규화: 쿼리 제거, 코인/봇 상세는 묶음 처리해 카디널리티 제한
function normPath(p) {
  let path = clean(p, 120) || "/";
  try { path = path.split("?")[0].split("#")[0] || "/"; } catch {}
  if (!path.startsWith("/")) path = "/" + path;
  if (path.startsWith("/coin/")) path = "/coin/:sym";
  if (path.startsWith("/reports/")) path = "/reports/:bot";
  if (path.startsWith("/blog/")) path = path; // 블로그는 글별 유지 (콘텐츠 성과 분석용)
  return path.slice(0, 80);
}

function refDomain(r) {
  const s = clean(r, 200);
  if (!s) return "direct";
  try {
    const h = new URL(s).hostname.replace(/^www\./, "");
    if (!h || h === "zepta.app" || h.endsWith(".zepta.app")) return null; // 내부 이동은 미집계
    return h.slice(0, 60);
  } catch { return "direct"; }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(204).end();

  try {
    // 봇/크롤러 제외 (집계 오염 방지)
    const ua = String(req.headers["user-agent"] || "");
    if (/bot|crawl|spider|slurp|headless|lighthouse|pingdom|monitor/i.test(ua)) return res.status(204).end();

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const day = kstDay();
    const t = body.t === "ev" ? "ev" : "pv";

    const { kv } = await import("@vercel/kv");
    const ops = [];

    if (t === "pv") {
      const path = normPath(body.path);
      const vid = clean(body.vid, 40);
      const dev = body.dev === "m" ? "m" : "d";
      ops.push(kv.hincrby(`di:mkt:pv:${day}`, path, 1));
      ops.push(kv.expire(`di:mkt:pv:${day}`, TTL));
      if (vid) {
        ops.push(kv.sadd(`di:mkt:uv:${day}`, vid));
        ops.push(kv.expire(`di:mkt:uv:${day}`, TTL));
      }
      ops.push(kv.hincrby(`di:mkt:dev:${day}`, dev, 1));
      ops.push(kv.expire(`di:mkt:dev:${day}`, TTL));
      const ref = refDomain(body.ref);
      if (ref) {
        ops.push(kv.hincrby(`di:mkt:ref:${day}`, ref, 1));
        ops.push(kv.expire(`di:mkt:ref:${day}`, TTL));
      }
      const utm = clean(body.utm, 60);
      if (utm) {
        ops.push(kv.hincrby(`di:mkt:utm:${day}`, utm, 1));
        ops.push(kv.expire(`di:mkt:utm:${day}`, TTL));
      }
    } else {
      const ev = clean(body.ev, 60);
      if (ev) {
        // label 이 있으면 ev::label 로 세분 (예: cta_click::home-quant)
        const label = clean(body.label, 60);
        const key = label ? `${ev}::${label}` : ev;
        ops.push(kv.hincrby(`di:mkt:ev:${day}`, key.slice(0, 100), 1));
        ops.push(kv.expire(`di:mkt:ev:${day}`, TTL));
      }
    }

    await Promise.allSettled(ops);
  } catch { /* 수집기는 절대 오류를 밖으로 내지 않음 */ }

  return res.status(204).end();
}
