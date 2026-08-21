// ════════════════════════════════════════════════════════════════════
// Zepta — 일일 자동 점검 (실전매매 + 알파랩 건강/정합성)
// ────────────────────────────────────────────────────────────────────
// 대표 지시(2026-06-03): "매일 실전매매·알파랩 버그 없는지 전체 점검, 발견 시 개선".
//   이 cron 은 *결정적* 데이터 정합성/건강 체크를 돌려 이상을 텔레그램으로 알린다.
//   (자동 코드수정은 위험 → 탐지·보고에 집중. 발견분은 대표/Claude 가 즉시 개선.)
//
// 점검 항목:
//   [실전매매] 엔진 heartbeat freshness · 시그널 풀 freshness · 측정 루프(live-summary)
//   [알파랩]   발굴(leaderboard) freshness · 주입 파라미터 과적합/raw 잔재 · 후보 과적합 노출
//   [공통]     KV 도달성
//
// Cron: 매일 1회. Timeout 60초.
// ★ 2026-08-17 알림 통합: 발견 내역은 KV(di:standup:health)에만 적재 →
//   KST 06:00 통합 스탠드업 ⑤에 병합. ZEPTA_TG_VERBOSE=1 이면 기존 개별 발송 복원.
// ════════════════════════════════════════════════════════════════════

import { requireCronAuth } from "../_shared/require-cron.js";
import { sendTelegram } from "../_shared/telegram.js";
import { ALL_STRATEGIES } from "../_shared/strategies/index.js";

async function getKv() { return (await import("@vercel/kv")).kv; }
export const config = { maxDuration: 60 };

const OWNER = process.env.ZEPTA_OWNER_USER_ID || "b707e106-8d92-499a-887b-e1ce0145033c";
const CANONICAL = Object.keys(ALL_STRATEGIES);
const RAW_LEGACY = ["trend", "momentum", "volatility", "hurst", "defi", "mean", "reverting", "trending", "rotation"];

function minsAgo(t) {
  const ms = typeof t === "number" ? t : Date.parse(t || 0);
  return ms ? Math.round((Date.now() - ms) / 60000) : null;
}

export default async function handler(req, res) {
  if (!requireCronAuth(req, res)) return; // ★ 크론/내부 전용 (2026-07-08 무인증 노출 차단)
  res.setHeader("Access-Control-Allow-Origin", "*");
  const findings = [];
  const add = (level, area, msg) => findings.push({ level, area, msg });

  try {
    const kv = await getKv();

    // ── [실전매매] 엔진 heartbeat (5분 주기) ──
    try {
      const hb = await kv.get(`di:real:user:${OWNER}:engine-heartbeat`);
      const m = hb ? minsAgo(hb.time) : null;
      if (m == null) add("warn", "엔진", "heartbeat 없음 (엔진 미가동?)");
      else if (m > 30) add("warn", "엔진", `heartbeat ${m}분 전 — 엔진 지연/중단 의심`);
    } catch (e) { add("warn", "엔진", `확인 실패: ${e?.message}`); }

    // ── [실전매매] 시그널 풀 freshness (btc-cron 15분 주기) ──
    try {
      const pool = (await kv.get("di:signals:realtime-pool")) || [];
      const newest = Array.isArray(pool) && pool.length ? Math.max(...pool.map((e) => e.ts || 0)) : 0;
      const m = newest ? minsAgo(newest) : null;
      if (m == null) add("warn", "시그널", "풀 비어있음 (btc-cron 미가동?)");
      else if (m > 40) add("warn", "시그널", `최신 신호 ${m}분 전 — btc-cron 지연 의심`);
    } catch (e) { add("warn", "시그널", `확인 실패: ${e?.message}`); }

    // ── [실전매매] 동적 유니버스 freshness (btc-cron 6시간 주기 갱신) ──
    try {
      const uni = await kv.get("di:signals:futures-universe");
      const m = uni?.generatedAt ? minsAgo(uni.generatedAt) : null;
      if (m == null) add("warn", "유니버스", "동적 유니버스 없음 — 정적 30종 폴백으로 동작 중");
      else if (m > 24 * 60) add("warn", "유니버스", `유니버스 ${Math.round(m / 60)}시간 전 갱신 — 거래소 메타 fetch 점검`);
    } catch (e) { add("warn", "유니버스", `확인 실패: ${e?.message}`); }

    // ── [실전매매] 측정 루프 ──
    try {
      const live = await kv.get(`di:real:user:${OWNER}:live-summary`);
      if (!live) add("warn", "측정", "live-summary 없음 — 실거래 성과 측정 루프 미작동?");
    } catch (e) { add("warn", "측정", `확인 실패: ${e?.message}`); }

    // ── [알파랩] 발굴 freshness (alpha-lab 1시간 / continuous-backtest 6시간) ──
    try {
      const lb = await kv.get("di:alpha:leaderboard");
      const m = lb?.generatedAt ? minsAgo(lb.generatedAt) : null;
      if (m == null) add("warn", "발굴", "leaderboard 없음");
      else if (m > 180) add("warn", "발굴", `leaderboard ${m}분 전 갱신 — alpha-lab cron 지연 의심`);
    } catch (e) { add("warn", "발굴", `확인 실패: ${e?.message}`); }

    // ── [알파랩] 주입 파라미터 과적합 누수 / canonical 외 raw 잔재 ──
    try {
      let inflated = [], active = 0;
      for (const id of CANONICAL) {
        const p = await kv.get(`di:alpha:params:${id}`);
        if (!p) continue;
        active += 1;
        // ★ 2026-08-21 (일일감사): 기존엔 p.sharpe 만 봐서 실제 과적합을 놓쳤습니다.
        //   예) trend-follow 는 sharpe 5.3 이라 통과했지만 oosSharpe 가 14.79(15거래) 로
        //   in-sample 3.46 의 4.3배 — 전형적인 검증창 과소 표본 신호인데 무경보였습니다.
        //   이제 ① sharpe>8 ② oosSharpe>8 ③ OOS 가 in-sample 의 2.5배 초과 중 하나라도
        //   걸리면 경보합니다. (탐지 전용 — 승급/주입 규칙 자체는 변경하지 않습니다.)
        const flags = [];
        if (Number.isFinite(p.sharpe) && p.sharpe > 8) flags.push(`Sharpe ${p.sharpe}`);
        if (Number.isFinite(p.oosSharpe) && p.oosSharpe > 8) flags.push(`OOS ${p.oosSharpe}`);
        if (Number.isFinite(p.oosSharpe) && Number.isFinite(p.inSampleSharpe) && p.inSampleSharpe > 0
            && p.oosSharpe > p.inSampleSharpe * 2.5) {
          flags.push(`OOS/IS ${(p.oosSharpe / p.inSampleSharpe).toFixed(1)}배`);
        }
        if (flags.length) inflated.push(`${id}(${flags.join(", ")}${Number.isFinite(p.trades) ? `, ${p.trades}거래` : ""})`);
      }
      let raw = [];
      for (const rid of RAW_LEGACY) {
        const p = await kv.get(`di:alpha:params:${rid}`);
        if (p) raw.push(rid);
      }
      if (inflated.length) add("warn", "주입", `과적합 의심 주입: ${inflated.join(", ")} — 교차검증 누수/표본 부족 점검`);
      if (raw.length) add("warn", "주입", `canonical 외 raw family 키 잔재: ${raw.join(", ")}`);
    } catch (e) { add("warn", "주입", `확인 실패: ${e?.message}`); }

    // ── [알파랩] 후보 데이터 freshness ──
    //   (옛 'Sharpe>10 단일심볼 노출' 체크는 제거: UI 가 '단일심볼·교차검증 전' 으로 정직하게
    //    라벨링하므로 오해 소지가 사라졌고, 실제 위험인 '과적합 후보의 승급/주입' 은 위
    //    '주입 파라미터 과적합(Sharpe>8)' 체크가 담당. 매일 헛알림 방지.)
    try {
      const cands = (await kv.get("di:alpha:strategy-candidates")) || [];
      if (!Array.isArray(cands) || cands.length === 0) add("warn", "후보", "후보 풀 비어있음 — 발굴 엔진 점검");
    } catch (e) { add("warn", "후보", `확인 실패: ${e?.message}`); }

    const fails = findings.filter((f) => f.level === "fail");
    const warns = findings.filter((f) => f.level === "warn");
    const total = fails.length + warns.length;

    // ★ 2026-08-17 알림 통합 — 대표 지시 "데일리 보고 1건": 기본은 무발송.
    //   발견 내역을 KV 에 남겨 KST 06:00 통합 스탠드업 ⑤(경고·액션 필요)에 병합.
    //   ZEPTA_TG_VERBOSE=1 이면 기존 개별 발송 복원(되돌리기 스위치). 점검 자체는 전부 유지.
    try {
      await kv.set("di:standup:health", {
        total,
        failCount: fails.length,
        warnCount: warns.length,
        findings: [...fails, ...warns].slice(0, 10),
        checkedAt: new Date().toISOString(),
      }, { ex: 3 * 86400 });
    } catch {}
    if (total > 0 && process.env.ZEPTA_TG_VERBOSE === "1") {
      const lines = [...fails, ...warns].map((f) => `${f.level === "fail" ? "🔴" : "⚠️"} [${f.area}] ${f.msg}`);
      try { await sendTelegram({ text: `🩺 Zepta 일일 점검 — ${total}건 발견\n` + lines.join("\n") }); } catch {}
    }

    return res.status(200).json({
      ok: true,
      total, failCount: fails.length, warnCount: warns.length,
      findings,
      checkedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[daily-health-check] fatal:", err);
    // 점검 자체 실패 = 치명 등급 — KV 에 fail 로 남겨 통합 스탠드업 ⑤가 반드시 노출
    try {
      const kv = await getKv();
      await kv.set("di:standup:health", {
        total: 1, failCount: 1, warnCount: 0,
        findings: [{ level: "fail", area: "점검", msg: `일일 점검 자체 실패: ${err?.message || err}` }],
        checkedAt: new Date().toISOString(),
      }, { ex: 3 * 86400 });
    } catch {}
    if (process.env.ZEPTA_TG_VERBOSE === "1") {
      try { await sendTelegram({ text: `🔴 Zepta 일일 점검 자체 실패: ${err?.message || err}` }); } catch {}
    }
    return res.status(200).json({ ok: false, error: err?.message || String(err) });
  }
}
