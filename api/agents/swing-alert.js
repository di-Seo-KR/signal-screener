// ════════════════════════════════════════════════════════════════════
// Zepta — 스윙·중장기 관점 시그널 알림 cron (정보 제공 전용)
// ────────────────────────────────────────────────────────────────────
// 대표 지시(2026-08-17): 자동매매 기준이 아닌, 스윙·장투 관점으로 진입하기에
// 매력적인 코인·주식이 있을 때 텔레그램 알림.
//
// 실행: 1일 2회 — KST 07:30(장전)·22:30(미장 초입). vercel.json 은 UTC 라
//   "30 13,22 * * *" (UTC 22:30 = KST 익일 07:30, UTC 13:30 = KST 22:30).
//
// 스팸 방지:
//   · 동일 심볼 쿨다운 7일 (KV di:swing:notified — { "coin:BTC": ts, ... })
//   · 1회 발송 최대 3종목 (코인+주식 합산, 점수순)
//   · 조건 충족 0건이면 무발송 (빈 알림 금지)
//
// 안전장치:
//   · 킬스위치 ZEPTA_SWING_ALERT=0 → 전체 무동작 (기본 활성)
//   · requireCronAuth — CRON_SECRET 가드 (기존 require-cron 패턴)
//   · ?dry=1 — 발송·기록 없이 판정 결과만 반환 (대표 수동 점검용)
//
// 정직성:
//   · 매매 엔진과 완전 분리 — 엔진 소비 키 접근 없음, 표시 풀 읽기 전용,
//     신규 외부 API 콜 없음. 규칙은 swing-signals.js 에 사전등록(튜닝 금지).
//   · 발송 이력은 di:swing:log 링버퍼(최근 200건)에 남겨 향후 적중률을
//     실데이터로 추적 — 적중률 산출 전에는 성과 수치를 일절 표기하지 않음.
// ════════════════════════════════════════════════════════════════════

import { requireCronAuth } from "../_shared/require-cron.js";
import { sendTelegram, fmtKST } from "../_shared/telegram.js";
import {
  SWING_RULES, selectSwingCandidates, filterByCooldown, pickTop, cooldownKey,
} from "../_shared/swing-signals.js";

// 읽기 전용 표시 풀 (btc-cron / stock-signals-cron 적재분 재사용)
const COIN_POOL_KEY = "di:signals:realtime-pool-mtf";
const STOCK_POOL_KEY = "di:signals:stock-pool-mtf";
// 이 크론 전용 키 (신규 — 엔진과 무관)
const NOTIFIED_KEY = "di:swing:notified"; // { [kind:symbol]: lastNotifiedTs }
const LOG_KEY = "di:swing:log";           // 발송 이력 링버퍼 (최신순)
const LOG_MAX = 200;

async function getKv() {
  try {
    if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) return null;
    return (await import("@vercel/kv")).kv;
  } catch {
    return null;
  }
}

// 텔레그램 HTML 이스케이프 (동적 문자열 — 종목명에 &, < 가능)
function esc(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// 가격 포맷 — 시장별 통화. 소액 코인은 유효숫자 유지(허위 반올림 방지).
function fmtPrice(px, market) {
  if (!Number.isFinite(px)) return "—";
  if (market === "kr") return `${Math.round(px).toLocaleString("ko-KR")}원`;
  const abs = Math.abs(px);
  if (abs >= 1) return `$${px.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  return `$${Number(px.toPrecision(4))}`;
}

// ── 알림 본문 (평어 — 투자 입문자 가정, 수익 보장 뉘앙스 금지) ──
function buildAlertText(picks, now = new Date()) {
  const lines = [
    `🧭 <b>스윙·중장기 관점 시그널</b>`,
    `${fmtKST(now)} 기준 · 사전등록 규칙 ${SWING_RULES.version}`,
    "",
  ];
  picks.forEach((c, i) => {
    const dir = c.side === "LONG" ? "📈 상승 쪽(롱 관점)" : "📉 하락 쪽(숏 관점)";
    const kindKo = c.kind === "coin" ? "코인" : c.market === "kr" ? "국내주식" : "미국주식";
    lines.push(`${i + 1}) <b>${esc(c.displayName)}</b> · ${kindKo} — ${dir}`);
    lines.push(`   기준가 ${fmtPrice(c.px, c.market)} (스캔 시점 종가)`);
    for (const b of c.basisLines || []) lines.push(`   · ${esc(b)}`);
    const lv = [];
    if (Number.isFinite(c.levels?.support)) lv.push(`지지 ${fmtPrice(c.levels.support, c.market)}`);
    if (Number.isFinite(c.levels?.resistance)) lv.push(`저항 ${fmtPrice(c.levels.resistance, c.market)}`);
    if (lv.length) lines.push(`   주요 레벨: ${lv.join(" · ")}`);
    lines.push("");
  });
  lines.push("━━━━━━━━━━");
  lines.push("이 알림은 스윙/중장기 관점의 참고 정보야. 수익을 보장하지 않고, 자동매매와도 무관해. 투자 판단과 책임은 본인에게 있어.");
  return lines.join("\n");
}

export default async function handler(req, res) {
  if (!requireCronAuth(req, res)) return; // 크론/내부 전용
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  // 킬스위치 — 기본 활성, ZEPTA_SWING_ALERT=0 이면 전체 무동작
  if (process.env.ZEPTA_SWING_ALERT === "0") {
    return res.status(200).json({ ok: true, skipped: true, reason: "killswitch ZEPTA_SWING_ALERT=0" });
  }

  const kv = await getKv();
  if (!kv) return res.status(200).json({ ok: false, skipped: true, reason: "KV not configured" });

  try {
    const now = Date.now();
    const dry = req.query?.dry === "1";

    // 표시 풀 읽기 (읽기 전용 — 엔진 소비 키와 무관)
    const [coinPool, stockPool, notifiedRaw] = await Promise.all([
      kv.get(COIN_POOL_KEY).then((p) => p || []),
      kv.get(STOCK_POOL_KEY).then((p) => p || []),
      kv.get(NOTIFIED_KEY).then((m) => m || {}),
    ]);

    // 사전등록 규칙 평가 → 쿨다운 → 점수순 최대 3종
    const { pass, wait, counts } = selectSwingCandidates({ coinPool, stockPool, now });
    const afterCooldown = filterByCooldown(pass, notifiedRaw, now);
    const picks = pickTop(afterCooldown, SWING_RULES.MAX_PICKS);

    const diag = {
      counts,
      cooldownFiltered: pass.length - afterCooldown.length,
      waiting: wait.map((w) => ({ symbol: w.symbol, kind: w.kind, score: w.score })),
      picks: picks.map((p) => ({ symbol: p.symbol, kind: p.kind, side: p.side, score: p.score })),
    };

    if (dry) return res.status(200).json({ ok: true, dry: true, ...diag });

    // 조건 충족 0건 → 무발송 (빈 알림 금지)
    if (picks.length === 0) {
      return res.status(200).json({ ok: true, sent: 0, reason: "no candidates", ...diag });
    }

    const text = buildAlertText(picks, new Date(now));
    const tg = await sendTelegram({ text });

    // 발송 성공 시에만 쿨다운·이력 기록 (발송 실패가 7일 침묵으로 이어지지 않게)
    if (tg.ok) {
      const notified = { ...notifiedRaw };
      for (const p of picks) notified[cooldownKey(p)] = now;
      // 쿨다운 2배 지난 항목은 청소 — 맵 무한 성장 방지
      for (const [k, ts] of Object.entries(notified)) {
        if (!Number.isFinite(ts) || now - ts > SWING_RULES.COOLDOWN_MS * 2) delete notified[k];
      }
      // 쿨다운 기록을 먼저 단독 확정 — 아래 로그 append 가 실패해도
      // 쿨다운은 보존되어 다음 런에서 같은 종목 중복 알림이 나가지 않음
      await kv.set(NOTIFIED_KEY, notified);
      try {
        const prevLog = (await kv.get(LOG_KEY)) || [];
        const logEntries = picks.map((p) => ({
          ts: now, rules: SWING_RULES.version,
          symbol: p.symbol, kind: p.kind, market: p.market, side: p.side,
          score: p.score, px: p.px, levels: p.levels, basis: p.basisLines,
        }));
        const nextLog = [...logEntries, ...(Array.isArray(prevLog) ? prevLog : [])].slice(0, LOG_MAX);
        await kv.set(LOG_KEY, nextLog);
      } catch (logErr) {
        // 이력 링버퍼는 진단용 — 실패해도 발송·쿨다운에는 영향 없음
        console.error("[swing-alert] log append failed", logErr);
      }
    }

    return res.status(200).json({
      ok: true, sent: tg.ok ? picks.length : 0, telegram: tg.ok ? "ok" : (tg.reason || tg.error || "fail"), ...diag,
    });
  } catch (e) {
    console.error("[swing-alert]", e);
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
}
