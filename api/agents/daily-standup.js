// ════════════════════════════════════════════════════════════════════
// Zepta 에이전트 일일 스탠드업 (KST 06:00)
//
// 매일 아침 KST 06:00 에 Vercel cron 으로 호출되어 다음 에이전트들이
// 각자 시니어 페르소나로 작업하고 텔레그램에 결과를 보고합니다.
//
//   1) QUANT-RES (알파 리서처)
//       - 어제 shadow ledger 성과 분석
//       - 잘 작동한 전략 패밀리 / 부진한 전략 패밀리 식별
//       - 새 알파 후보 1건 제안
//
//   2) QUANT-PLAN (전략 기획자)
//       - shadow → production 승급 후보
//       - 디머지(deprecate) 후보
//       - 전략 가중치 조정 권고
//
// 발송 대상: 텔레그램 (TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID)
// 사용 모델: claude-sonnet-4-6 (시니어 분석가 페르소나)
//
// 환경변수:
//   ANTHROPIC_API_KEY        — 필수
//   TELEGRAM_BOT_TOKEN/CHAT_ID — 필수
//   KV_REST_API_URL/TOKEN    — Vercel KV 연동
//
// 수동 호출: GET /api/agents/daily-standup?dryRun=1
// ════════════════════════════════════════════════════════════════════

import Anthropic from "@anthropic-ai/sdk";
import { sendCards, buildCard, fmtKST } from "../_shared/telegram.js";

const MODEL = "claude-sonnet-4-6";
const PROBE_USER = "__zepta_global_probe__";

async function getKv() {
  return (await import("@vercel/kv")).kv;
}

// shadow ledger 에서 최근 N일 데이터 가져오기
// 엔진(engine.js)이 쌓는 엔트리는 openedAt(ISO 문자열) 형태이므로
// 다양한 timestamp 필드를 모두 호환 처리
function entryTimeMs(e) {
  if (!e) return 0;
  if (typeof e.time === "number") return e.time;
  if (typeof e.openedAt === "string") return Date.parse(e.openedAt) || 0;
  if (typeof e.openedAt === "number") return e.openedAt;
  if (typeof e.closedAt === "string") return Date.parse(e.closedAt) || 0;
  if (typeof e.id === "string") {
    const m = e.id.match(/^sh-(\d+)-/);
    if (m) return Number(m[1]) || 0;
  }
  return 0;
}

async function readShadowLedger(kv, days = 7) {
  const ledger = (await kv.get(`di:real:user:${PROBE_USER}:shadow-ledger`)) || [];
  if (!Array.isArray(ledger) || ledger.length === 0) return [];
  const cutoff = Date.now() - days * 86400000;
  return ledger.filter((e) => entryTimeMs(e) >= cutoff).slice(-200);
}

// 전략 가중치 / 패밀리별 성과 요약
async function readWeights(kv) {
  return (await kv.get("di:real:strategy-weights")) || {};
}

// shadow-monitor 가 만들어두는 누적 요약 (있으면 활용)
async function readShadowSummary(kv) {
  return (await kv.get(`di:real:user:${PROBE_USER}:shadow-summary`)) || null;
}

// ── 안전 JSON 파싱 (Claude 응답에서 마크다운 코드블록 제거) ──
function safeJSONParse(text) {
  if (!text) return null;
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = m ? m[1] : text;
  try { return JSON.parse(raw.trim()); } catch { return null; }
}

// ── QUANT-RES — 알파 리서처 ──
async function runQuantResearcher(client, ledger, weights, summary) {
  // CLOSED 항목만 승률 산정 — OPEN 은 결과 미확정이라 제외
  const closed = ledger.filter((e) => e?.status === "CLOSED");
  const winRate = closed.length ? closed.filter((e) => (e?.netPnL || 0) > 0).length / closed.length : 0;

  const familyStats = {};
  for (const e of closed) {
    const fam = e?.plan?.strategyFamily || e?.signal?.strategyFamily || e?.signal?.source || "기타";
    familyStats[fam] = familyStats[fam] || { count: 0, wins: 0, pnlSum: 0 };
    familyStats[fam].count++;
    if ((e?.netPnL || 0) > 0) familyStats[fam].wins++;
    familyStats[fam].pnlSum += (e?.netPnL || 0);
  }

  const sys = `당신은 Zepta 의 시니어 퀀트 알파 리서처(QUANT-RES)입니다.
- 페르소나: 8년차 퀀트, 통계학 박사. 솔직하고 데이터 중심.
- 출력: 한국어 존댓말. 사용자가 "투자 입문자"라고 가정하고 평어로 풀어 설명.
- 절대 어려운 전문 용어 그대로 쓰지 말 것 — 풀어서 비유 들기.
- "그래서 뭘 하면 되나" 행동 가이드 포함.
- JSON 만 응답 (마크다운 코드블록 안에 넣어도 됨).`;

  const openCount = ledger.length - closed.length;
  const user = `오늘 아침 분석 보고서 작성 요청입니다.

[지난 7일 shadow ledger 요약]
- 전체 가상 거래: ${ledger.length}건 (마감 ${closed.length} / 진행 ${openCount})
- 가상 승률 (마감 기준): ${(winRate * 100).toFixed(1)}%
- 패밀리별 성과 (마감 기준):
${Object.entries(familyStats).map(([f, s]) =>
  `  · ${f}: ${s.count}건, 승률 ${s.count ? ((s.wins/s.count)*100).toFixed(0) : 0}%, 누적 가상손익 ${s.pnlSum.toFixed(2)}`
).join("\n") || "  (마감된 거래 없음)"}
- 누적 요약: ${summary ? JSON.stringify({ wins: summary.wins, losses: summary.losses, netPnL: Number(summary.netPnL || 0).toFixed(2) }) : "(없음)"}
- 현재 가중치: ${JSON.stringify(weights).slice(0, 400)}

다음 형식의 JSON 으로만 답변:
{
  "headline": "한 줄 요약 (예: 추세 추종 전략이 잘 통했지만 변동성 폭발 구간엔 약했어요)",
  "yesterday": ["어제 잘 된 것 1", "어제 부진했던 것 1"],
  "today_watch": "오늘 시장에서 주의 깊게 볼 포인트 1~2줄",
  "alpha_idea": {
    "name": "새 알파 후보 이름",
    "why": "왜 시도해볼 만한지 평어로 1~2문장",
    "how": "어떻게 검증할지 (예: 30일 백테스트)"
  },
  "action": "대표가 오늘 할 만한 일 (예: 'BB바운스' 가중치 0.8→1.2로 늘려보세요)"
}`;

  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: 1500,
    system: sys,
    messages: [{ role: "user", content: user }],
  });

  const text = resp.content?.[0]?.text || "";
  return safeJSONParse(text) || { headline: "리서치 응답 파싱 실패", _raw: text.slice(0, 500) };
}

// ── QUANT-PLAN — 전략 기획자 ──
async function runQuantPlanner(client, ledger, weights, researchOutput) {
  const sys = `당신은 Zepta 의 시니어 퀀트 전략 기획자(QUANT-PLAN)입니다.
- 페르소나: 10년차 퀀트 PM. 의사결정 단호하지만 근거 명확.
- 역할: shadow ledger 와 리서처 리포트를 바탕으로 "production 승급 / 디머지 / 가중치 조정" 결정을 내림.
- 출력: 한국어 존댓말, 평어. JSON 만 응답.`;

  const user = `오늘 자 전략 운용 결정을 내려주세요.

[리서치 보고]
${JSON.stringify(researchOutput, null, 2).slice(0, 1200)}

[shadow ledger 통계]
- 거래 ${ledger.length}건
- 가중치: ${JSON.stringify(weights).slice(0, 400)}

JSON 형식:
{
  "headline": "한 줄 요약 (예: 'RSI반전' 본격 운용 시작 권고, '거래량돌파' 일시 중단)",
  "promote": [{"name":"전략명", "reason":"평어 한 줄"}],
  "demote": [{"name":"전략명", "reason":"평어 한 줄"}],
  "weight_changes": [{"name":"전략명", "from":1.0, "to":1.2, "why":"평어 한 줄"}],
  "risk_note": "오늘 특별히 주의할 시장 리스크 한 줄"
}`;

  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: 1200,
    system: sys,
    messages: [{ role: "user", content: user }],
  });

  const text = resp.content?.[0]?.text || "";
  return safeJSONParse(text) || { headline: "기획 응답 파싱 실패", _raw: text.slice(0, 500) };
}

// ── 텔레그램 카드 빌드 ──
function buildCardsForResearch(r) {
  if (!r || r._raw) {
    return buildCard({
      tag: "🧪",
      title: "QUANT-RES — 오늘의 알파 리서치",
      lines: ["응답 파싱 실패 — 원본을 확인해주세요"],
      footer: r?._raw || "",
    });
  }
  return buildCard({
    tag: "🧪",
    title: "QUANT-RES — 오늘의 알파 리서치",
    lines: [
      r.headline,
      ...(r.yesterday || []).map((s) => `어제: ${s}`),
      r.today_watch ? `오늘 주목: ${r.today_watch}` : "",
      r.alpha_idea ? `새 후보: ${r.alpha_idea.name} — ${r.alpha_idea.why}` : "",
    ],
    hint: r.action,
    footer: `검증: ${r.alpha_idea?.how || "-"}`,
  });
}

function buildCardsForPlan(p) {
  if (!p || p._raw) {
    return buildCard({
      tag: "🎯",
      title: "QUANT-PLAN — 오늘의 전략 운용 결정",
      lines: ["응답 파싱 실패 — 원본을 확인해주세요"],
      footer: p?._raw || "",
    });
  }
  const lines = [p.headline];
  for (const x of p.promote || []) lines.push(`승급: ${x.name} — ${x.reason}`);
  for (const x of p.demote || []) lines.push(`중단: ${x.name} — ${x.reason}`);
  for (const x of p.weight_changes || []) lines.push(`가중치 ${x.name}: ${x.from} → ${x.to} (${x.why})`);
  return buildCard({
    tag: "🎯",
    title: "QUANT-PLAN — 오늘의 전략 운용 결정",
    lines,
    hint: p.risk_note,
  });
}

// ── 메인 핸들러 ──
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const dryRun = req.query?.dryRun === "1" || req.query?.dryRun === "true";
  const log = [];
  const L = (m) => { log.push(m); console.log("[daily-standup]", m); };

  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(200).json({ ok: false, error: "ANTHROPIC_API_KEY not set", log });
    }

    const kv = await getKv();
    const [ledger, weights, summary] = await Promise.all([
      readShadowLedger(kv, 7),
      readWeights(kv),
      readShadowSummary(kv),
    ]);
    const closedCount = ledger.filter((e) => e?.status === "CLOSED").length;
    L(`shadow ledger: ${ledger.length} entries (지난 7일, 마감 ${closedCount})`);

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const [research, plan] = await Promise.all([
      runQuantResearcher(client, ledger, weights, summary),
      // PLAN 은 RES 결과를 참고하지만, 동시 실행 후 PLAN 이 RES 반영하는 2-pass 패턴 대신
      // 1-pass 빠른 실행 — 우선 둘 다 같은 ledger 보고 독립 의견. 추후 2-pass 로 확장 가능.
      runQuantPlanner(client, ledger, weights, { note: "리서치 동시 진행 중" }),
    ]);
    L(`QUANT-RES headline: ${research.headline?.slice(0, 60)}`);
    L(`QUANT-PLAN headline: ${plan.headline?.slice(0, 60)}`);

    const header = buildCard({
      tag: "🌅",
      title: `Zepta 일일 스탠드업 — ${fmtKST().slice(0, 8)}`,
      lines: [
        `지난 7일 shadow 거래 ${ledger.length}건 분석 완료`,
        `리서처(QUANT-RES) + 기획자(QUANT-PLAN) 동시 보고`,
      ],
    });

    const cards = [
      header,
      buildCardsForResearch(research),
      buildCardsForPlan(plan),
    ];

    if (dryRun) {
      return res.status(200).json({
        ok: true,
        dryRun: true,
        cards,
        research,
        plan,
        log,
      });
    }

    const tg = await sendCards(cards);
    L(`telegram send: ${tg.ok ? "ok" : "fail " + (tg.error || "")}`);

    return res.status(200).json({
      ok: true,
      sent: tg.ok,
      messageId: tg.message_id,
      research,
      plan,
      log,
    });
  } catch (err) {
    console.error("[daily-standup] fatal:", err);
    return res.status(200).json({ ok: false, error: err?.message || String(err), log });
  }
}
