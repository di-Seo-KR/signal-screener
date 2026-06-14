// ════════════════════════════════════════════════════════════════════
// Zepta — 퍼스트파티 애널리틱스 수집기 (GA 대체, 2026-06-12 대표 지시)
// POST /api/track
//
// 설계 원칙:
//   - 무쿠키 · 익명: vid 는 클라이언트 localStorage 의 랜덤 UUID (PII 없음, IP 미저장)
//   - KV(Upstash) 일별 집계만 저장 — 원본 이벤트 로그 없음 (개인정보·비용 최소화)
//   - 절대 실패 노출 금지: 어떤 오류든 204 (수집기가 본 서비스에 영향 0)
//
// payload: { t:"pv"|"ev", path, ref, utm, vid, dev:"m"|"d", sid, sfirst, ev, label }
// KV 스키마 (KST 일자 기준, 90일 TTL):
//   di:mkt:pv:<day>      hash  path → count        (페이지뷰)
//   di:mkt:uv:<day>      set   vid                 (고유 방문자)
//   di:mkt:new:<day>     hash  n → count           (신규 방문자 — 전체 vid 집합에 처음 등장)
//   di:mkt:sess:<day>    set   sid                 (세션 — sessionStorage 단위)
//   di:mkt:ref:<day>     hash  refDomain → count   (유입 출처, 내부/없음 = direct)
//   di:mkt:utm:<day>     hash  source → count      (UTM 캠페인 유입)
//   di:mkt:dev:<day>     hash  m|d → count         (디바이스)
//   di:mkt:geo:<day>     hash  country → count     (국가 — Vercel ip-country 헤더)
//   di:mkt:os:<day>      hash  OS → count          (운영체제 — UA)
//   di:mkt:browser:<day> hash  browser → count     (브라우저 — UA)
//   di:mkt:ev:<day>      hash  eventName → count   (전환/행동 이벤트)
//   di:mkt:signups:<day> hash  n → count           (일별 신규 가입)
//   di:mkt:rt:<5분버킷>  set   vid (TTL 35분)       (실시간 활성)
//   di:mkt:vids:all      set   vid                 (전체 고유 방문자 — 신규 판정)
//   di:auth:signup-total int                       (가입 누적 — service-role 키 폴백)
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

// ── UA → OS/브라우저 (가벼운 파싱, PII 아님) ──
function parseOS(ua) {
  if (/windows nt/i.test(ua)) return "Windows";
  if (/iphone|ipad|ipod/i.test(ua)) return "iOS";
  if (/android/i.test(ua)) return "Android";
  if (/mac os x/i.test(ua)) return "macOS";
  if (/linux/i.test(ua)) return "Linux";
  return "기타";
}
function parseBrowser(ua) {
  if (/edg\//i.test(ua)) return "Edge";
  if (/samsungbrowser/i.test(ua)) return "삼성인터넷";
  if (/kakaotalk/i.test(ua)) return "카카오톡";
  if (/naver|whale/i.test(ua)) return "Whale";
  if (/chrome|crios/i.test(ua)) return "Chrome";
  if (/firefox|fxios/i.test(ua)) return "Firefox";
  if (/safari/i.test(ua)) return "Safari";
  return "기타";
}
// 5분 버킷 키 (실시간 활성 — KST 기준)
function rtBucket() {
  const m = Math.floor((Date.now() + 9 * 3600000) / (5 * 60000));
  return `di:mkt:rt:${m}`;
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
        // ★ 신규 vs 재방문 — 전체 vid 집합(sadd 반환 1=신규)으로 오늘 신규 카운트.
        //   별도 await(파이프라인 밖) — 반환값을 봐야 함.
        try {
          const added = await kv.sadd("di:mkt:vids:all", vid);
          if (added) {
            ops.push(kv.hincrby(`di:mkt:new:${day}`, "n", 1));
            ops.push(kv.expire(`di:mkt:new:${day}`, TTL));
          }
        } catch {}
        // ★ 실시간 활성 — 5분 버킷에 vid 적재(TTL 35분)
        const rk = rtBucket();
        ops.push(kv.sadd(rk, vid));
        ops.push(kv.expire(rk, 35 * 60));
      }
      ops.push(kv.hincrby(`di:mkt:dev:${day}`, dev, 1));
      ops.push(kv.expire(`di:mkt:dev:${day}`, TTL));
      // ★ 지오(국가)·OS·브라우저 — Vercel 헤더 + UA (IP 미저장, 국가는 PII 아님)
      const country = clean(req.headers["x-vercel-ip-country"], 4) || "기타";
      ops.push(kv.hincrby(`di:mkt:geo:${day}`, country, 1));
      ops.push(kv.expire(`di:mkt:geo:${day}`, TTL));
      ops.push(kv.hincrby(`di:mkt:os:${day}`, parseOS(ua), 1));
      ops.push(kv.expire(`di:mkt:os:${day}`, TTL));
      ops.push(kv.hincrby(`di:mkt:browser:${day}`, parseBrowser(ua), 1));
      ops.push(kv.expire(`di:mkt:browser:${day}`, TTL));
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
      // ★ 세션 — sid 단위 고유 세션(세션 첫 PV 에서만 sadd, 세션 수·페이지/세션)
      const sid = clean(body.sid, 40);
      if (sid && body.sfirst) {
        ops.push(kv.sadd(`di:mkt:sess:${day}`, sid));
        ops.push(kv.expire(`di:mkt:sess:${day}`, TTL));
      }
    } else {
      const ev = clean(body.ev, 60);
      if (ev) {
        // label 이 있으면 ev::label 로 세분 (예: cta_click::home-quant)
        const label = clean(body.label, 60);
        const key = label ? `${ev}::${label}` : ev;
        ops.push(kv.hincrby(`di:mkt:ev:${day}`, key.slice(0, 100), 1));
        ops.push(kv.expire(`di:mkt:ev:${day}`, TTL));
        // ★ 가입 누적 카운터 — Supabase service-role 키 없을 때 가입수 폴백 소스
        if (ev === "signup_completed") {
          ops.push(kv.incr("di:auth:signup-total"));
          ops.push(kv.hincrby(`di:mkt:signups:${day}`, "n", 1));
          ops.push(kv.expire(`di:mkt:signups:${day}`, TTL));
        }
      }
    }

    await Promise.allSettled(ops);
  } catch { /* 수집기는 절대 오류를 밖으로 내지 않음 */ }

  return res.status(204).end();
}
