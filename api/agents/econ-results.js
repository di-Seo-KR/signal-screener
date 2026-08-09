// ════════════════════════════════════════════════════════════════════
// GET /api/agents/econ-results — 경제지표 발표 결과 페이지 자동 생성 (크론 1시간)
// ────────────────────────────────────────────────────────────────────
// 2026-07-30 (정보 피벗 2차): di:econ:actuals (econ-calendar 가 발표 즉시 적재하는
// 발표치 영구 저장소)에서 아직 페이지가 없는 발표를 감지해 /econ/{date}-{slug}
// HTML 을 생성·적재합니다. 발표 임박/미발표 이벤트는 actuals 에 아예 없으므로
// 구조적으로 빈 페이지가 생기지 않습니다 (추가로 값 유효성·미래 날짜 가드).
//
// 흐름:
//   ① requireCronAuth (vercel.json crons + CRON_SECRET)
//   ② di:econ:actuals / di:econ:estimates / di:econ-page:index 로드
//   ③ 후보 = actuals 중 { 값 유효 · 날짜 ≤ 오늘(KST) · 최근 60일 이내 · 미생성 }
//   ④ 날짜 내림차순 상위 12건만 생성 (런타임 바운드 — 백필은 다음 시간 크론이 이어감)
//   ⑤ di:econ-page:{key} 에 HTML, di:econ-page:index 에 메타 적재 (내림차순 500 캡)
//
// 쓰기 경합: 이 크론만 econ-page 키를 write (btc-cron 풀 패턴과 동일 — 단일 작성자).
// ════════════════════════════════════════════════════════════════════

import { requireCronAuth } from "../_shared/require-cron.js";
import {
  ECON_PAGE_KEY, ECON_INDEX_KEY, ECON_INDEX_MAX,
  kstToday, slugifyEvent, buildEconResultPage,
} from "../_shared/econ-content.js";

async function getKv() {
  try {
    const { kv } = await import("@vercel/kv");
    const get = kv.get.bind(kv);
    const set = kv.set.bind(kv);
    return { get, set };
  } catch { return null; }
}

export const config = { maxDuration: 60 };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const BACKFILL_DAYS = 60;  // 초기 가동 시 과거 60일 치 백필 (그 이전은 컨텍스트 가치 낮음)
const PER_RUN = 12;        // 회당 생성 상한 — 백필 폭주 방지 (시간당 크론이 이어감)

/**
 * 발표 결과 페이지 생성 코어 — 핸들러와 분리해 목 KV 로 종단 테스트 가능.
 * @param {{get:Function, set:Function}} kv
 * @param {{now?:number}} [opts]
 */
export async function runEconResults(kv, { now = Date.now() } = {}) {
  const [actualsRaw, estimatesRaw, indexRaw] = await Promise.all([
    kv.get("di:econ:actuals"),
    kv.get("di:econ:estimates"),
    kv.get(ECON_INDEX_KEY),
  ]);
  const actuals = actualsRaw && typeof actualsRaw === "object" ? actualsRaw : {};
  const estimates = estimatesRaw && typeof estimatesRaw === "object" ? estimatesRaw : {};
  const index = Array.isArray(indexRaw) ? indexRaw.filter((e) => e && typeof e.key === "string") : [];
  const existing = new Set(index.map((e) => e.key));

  const today = kstToday(now);
  const cutoff = new Date(Date.parse(`${today}T00:00:00Z`) - BACKFILL_DAYS * 86400000)
    .toISOString().slice(0, 10);

  // ── 후보 수집 — actuals 는 발표 후에만 값이 적재되므로 "미발표 페이지"는 불가 ──
  const candidates = [];
  for (const [k, actual] of Object.entries(actuals)) {
    const sep = k.indexOf("::");
    if (sep < 0) continue;
    const date = k.slice(0, sep);
    const event = k.slice(sep + 2).trim();
    if (!DATE_RE.test(date) || !event) continue;
    // ★ null/"" 명시 가드 — Number(null)===0 이라 미발표(null)가 "발표치 0" 으로
    //   둔갑하는 것을 차단 (목 KV 종단 테스트에서 실측한 구멍. 빈 페이지 금지 원칙)
    if (actual == null || actual === "") continue;
    const val = Number(actual);
    if (!Number.isFinite(val)) continue;          // 숫자 아님 — 생성하지 않음
    if (date > today || date < cutoff) continue;  // 미래(미발표)·과거 초과분 제외
    const slug = slugifyEvent(event);
    if (!slug) continue;
    const key = `${date}-${slug}`;
    if (existing.has(key)) continue; // 이미 발행됨
    const est = estimates[k] || {};
    // ★ 2026-08-10 (전수 감사): Number(null)===0·Number("")===0 이라 미집계 컨센서스가
    //   "예측 0" 으로 페이지에 굳던 함정 — null/빈 문자열은 명시적으로 걸러냅니다.
    const toNum = (v) => (v == null || v === "" ? NaN : Number(v));
    candidates.push({
      key, date, event, actual: val,
      estimate: Number.isFinite(toNum(est.e)) ? Number(est.e) : null,
      previous: Number.isFinite(toNum(est.p)) ? Number(est.p) : null,
    });
  }
  candidates.sort((a, b) => b.date.localeCompare(a.date) || a.event.localeCompare(b.event));

  // ── 생성 (회당 상한 — 잔여 백필은 다음 시간 크론이 이어감) ──
  const created = [];
  const newEntries = [];
  for (const cand of candidates.slice(0, PER_RUN)) {
    if (existing.has(cand.key)) continue; // 동일 런 내 slug 충돌 방어
    const built = buildEconResultPage(cand);
    await kv.set(ECON_PAGE_KEY(built.key), built.html);
    existing.add(built.key);
    newEntries.push(built.indexEntry);
    created.push(built.key);
  }

  // ── 인덱스 갱신 (신규 + 기존, 날짜 내림차순, 캡) ──
  if (newEntries.length > 0) {
    const merged = [...newEntries, ...index]
      .sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(a.key).localeCompare(String(b.key)))
      .slice(0, ECON_INDEX_MAX);
    await kv.set(ECON_INDEX_KEY, merged);
  }

  return {
    ok: true,
    created,
    createdCount: created.length,
    backlogRemaining: Math.max(0, candidates.length - created.length),
    indexSize: Math.min(index.length + newEntries.length, ECON_INDEX_MAX),
  };
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });
  if (!requireCronAuth(req, res)) return;
  res.setHeader("Cache-Control", "no-store");

  try {
    const kv = await getKv();
    if (!kv) return res.status(200).json({ ok: false, error: "KV unavailable" });
    const result = await runEconResults(kv);
    return res.status(200).json(result);
  } catch (err) {
    console.error("[econ-results]", err);
    return res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
}
