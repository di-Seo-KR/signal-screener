// ══════════════════════════════════════════════════════════════════
// Zepta — Alpha Lab 페이지 (2026-08-17 전면 재구성)
// ──────────────────────────────────────────────────────────────────
// 콘셉트: "알파의 수명주기를 보여주는 연구실"
//   후보 발굴 → 사전등록 검증 → 섀도 축적 → 실거래 반영(승급/기각)의
//   전 과정을 실데이터로 노출. 기각 기록도 그대로 공개(과학적 정직성).
//
// 첫 화면 카드 3개(밀도 규칙 — 정돈 패스 원칙, 상세는 펼침):
//   1) 수명주기 파이프라인 — 단계별 실측 카운트 + 섀도 축적 트랙 + 수명주기 로그
//   2) 검증 아카이브 — 가설별 결론 카드(p값·표본 실측치, "기각도 성과" 톤)
//   3) 실전 전략 현황판 — 실전 9종 위상(가동/관찰/차단) + 순위표·레짐·가중치 상세
//
// API: GET /api/agents/alpha-status (단일 호출 — 60초 polling)
//   응답 필드 실존 확인(라이브 curl, 2026-08-17):
//   ok/generatedAt/leaderboard{strategies}/historyTail/candidates/weights{weights}
//   /regime{regime,avgHurst,avgER,activeTickers,t}/statuses{id:{status,reason,updatedAt}}
//   /params{id:{sharpe,oosSharpe,tunedAt,…}}/events[{ts,type,family,reason,from,to,…}]
//
// i18n: 모든 UI 문자열 t("alphalab.*") — ko/en 패리티 (src/i18n/*.json alphalab 슬라이스)
// ══════════════════════════════════════════════════════════════════
import React, { useEffect, useMemo, useState } from "react";
import { useThemeTokens, FONT, RADIUS } from "./ui/theme.jsx";
import { useIsMobile } from "./ui/useBreakpoint.jsx";
import { ga } from "./lib/analytics.js";
import { useAuth } from "./AuthProvider.jsx";
import { LoadingBlock } from "./ui/primitives.jsx";
import { useLanguage } from "./i18n/LanguageContext.jsx";

const REFRESH_MS = 60_000;

// G-1 — 옛 데이터의 raw ID ("trend", "unknown") 만 숨기고, 나머지는 fallback 라벨로 표시.
const BLOCKED_RAW_IDS = new Set(["trend", "unknown", "default", "n/a", "null", "undefined"]);
const isValidStrategyId = (id) =>
  typeof id === "string" && id.length > 0 && !BLOCKED_RAW_IDS.has(id.toLowerCase());

// 전략 표시명 — i18n(alphalab.strategyNames.*), 미등록 id 는 fallback.
function strategyLabel(t, id) {
  const key = `alphalab.strategyNames.${id}`;
  const v = t(key);
  return v === key ? t("alphalab.strategyNames.fallback") : v;
}

// ────────────────────────────────────────────────
// 검증 아카이브 정적 메타 — 문구·수치는 i18n(alphalab.archive.items.*).
// ★ 절대 규칙 1(가짜 수치 금지): 아래 항목의 모든 수치는 실측 결과 요약입니다.
//   수치 원본(2026-08-17 확인):
//   h1     scripts/research/h1-results.json  (2026-08-12, passOOS=false, recTradesTotal=354,
//          OOS 1h reclaim PF 0.9397 vs baseline 1.1157, reclaimVsBaseline p≈0.6949)
//   h2     scripts/research/h2-results.json  (2026-08-12, passOOS=true, bestK=2,
//          onTradesTotal=3688, OOS 4h ON PF 0.7921 vs OFF 0.6583 vs 억제군 0.5690)
//   h3     scripts/research/h3-results.json  (2026-08-12, passOOS=false, totalRetestTrades=416,
//          OOS retest PF 0.5172 vs baseline 0.5399, avgRetPct −1.0181)
//   h4     scripts/research/h4-results.json  (2026-08-12, passOOS=false, sqTradesTotal=1795,
//          OOS squeeze PF 0.5928 vs baseline 0.5498, fee-stress 0.4943, maxConsecLosses 34)
//   h5     scripts/research/h5-results.json  (2026-08-12, passOOS=false, 5주장 전부 미지지,
//          최저 IS p=0.045495(C3a), Bonferroni 문턱 raw p<0.01)
//   candle api/_shared/candle-calibration.js (2026-07-03 생성 — 27조합 중 mult>0 3개:
//          1h bullish_engulfing(OOS n=225 +67bps t=1.61)·4h piercing(OOS n=155 +71bps)·
//          1d three_soldiers)
//   timing api/_shared/timing-signals.js 헤더 (2026-07-04 — 42요소 중 9 생존(전부 롱),
//          v4 딥 히스토리 1h 86만 봉, 홀드아웃 미지 6심볼 22만 봉에서 2요소 추가 탈락)
//   sr     api/_shared/sr-levels.js Phase2 주석 (적대검증 P1 — 볼륨 가점을 t≥2 레벨로 한정)
// ────────────────────────────────────────────────
const RESEARCH_ARCHIVE = [
  { id: "h1", verdict: "rejected", date: "2026-08-12", src: "research/h1-results.json" },
  { id: "h2", verdict: "conditional", date: "2026-08-12", src: "research/h2-results.json" },
  { id: "h3", verdict: "rejected", date: "2026-08-12", src: "research/h3-results.json" },
  { id: "h4", verdict: "rejected", date: "2026-08-12", src: "research/h4-results.json" },
  { id: "h5", verdict: "rejected", date: "2026-08-12", src: "research/h5-results.json" },
  { id: "candle", verdict: "partial", date: "2026-07-03", src: "candle-calibration.js" },
  { id: "timing", verdict: "partial", date: "2026-07-04", src: "timing-signals.js" },
  { id: "sr", verdict: "scoped", date: "2026-06-15", src: "sr-levels.js (Phase2)" },
];

// 섀도 축적 트랙 — 시작일·게이트는 사전등록 사실(가짜 진행도 금지 — n 은 서버 내부 집계).
//   oc: btc-cron OC_SHADOW (2026-08-11 배선, 게이트: 4주+ · n≥200 · adj≠0 n≥50 · p<0.05)
//   h2: H2 거래량 돌파 필터 4h 섀도 (2026-08-17 이번 배포에서 배선 — 목표 기간은
//       게이트 사전등록 후 표기: 미정 상태를 가짜 목표로 채우지 않음)
const SHADOW_TRACKS = [
  { id: "oc", start: "2026-08-11T00:00:00Z", targetDays: 28, hasGate: true },
  { id: "h2", start: "2026-08-17T00:00:00Z", targetDays: null, hasGate: false, wiredDate: "2026-08-17" },
];

// Sharpe 등급 변환 — AutoTrading.jsx 와 동일 정책
function sharpeToGrade(sharpe) {
  const s = parseFloat(sharpe);
  if (!isFinite(s)) return { grade: "—", key: "measuring", color: "neutral" };
  if (s >= 2.0) return { grade: "S", key: "s", color: "active" };
  if (s >= 1.5) return { grade: "A", key: "a", color: "active" };
  if (s >= 1.0) return { grade: "B", key: "b", color: "info" };
  if (s >= 0.5) return { grade: "C", key: "c", color: "watch" };
  return { grade: "D", key: "d", color: "disabled" };
}

// ────────────────────────────────────────────────
// 공통 헬퍼
// ────────────────────────────────────────────────
const fmtPct = (v, d = 1) => (v == null || !isFinite(v)) ? "—" : `${Number(v).toFixed(d)}%`;
const fmtNum = (v, d = 2) => (v == null || !isFinite(v)) ? "—" : Number(v).toFixed(d);
const fmtInt = (v) => (v == null || !isFinite(v)) ? "—" : Math.round(v).toLocaleString();
const fmtAgo = (t, iso) => {
  if (!iso) return "—";
  const ms = Date.now() - (typeof iso === "number" ? iso : Date.parse(iso));
  if (!isFinite(ms)) return "—";
  if (ms < 60000) return t("alphalab.ago.justNow");
  if (ms < 3600000) return t("alphalab.ago.minutes", { n: Math.floor(ms / 60000) });
  if (ms < 86400000) return t("alphalab.ago.hours", { n: Math.floor(ms / 3600000) });
  return t("alphalab.ago.days", { n: Math.floor(ms / 86400000) });
};

// ────────────────────────────────────────────────
// 작은 UI 컴포넌트
// ────────────────────────────────────────────────
function Card({ children, style, ...rest }) {
  return (
    <div
      style={{
        background: "var(--z-card)",
        border: "1px solid var(--z-border)",
        borderRadius: RADIUS.lg,
        padding: 16,
        boxShadow: "var(--z-sh-sm)",
        ...style,
      }}
      {...rest}
    >
      {children}
    </div>
  );
}

function Badge({ kind = "neutral", children }) {
  const C = useThemeTokens();
  const styleMap = {
    active:   { bg: C.greenBg, fg: C.green },
    watch:    { bg: C.yellowBg, fg: C.yellow },
    disabled: { bg: C.redBg, fg: C.red },
    info:     { bg: C.blueBg, fg: C.blueL },
    neutral:  { bg: C.card2, fg: C.text2 },
  };
  const s = styleMap[kind] || styleMap.neutral;
  return (
    <span style={{
      display: "inline-block",
      padding: "2px 8px",
      borderRadius: RADIUS.full,
      background: s.bg,
      color: s.fg,
      fontSize: FONT.xs,
      fontWeight: 600,
      whiteSpace: "nowrap",
    }}>
      {children}
    </span>
  );
}

function Stat({ label, value, sub, color, tip }) {
  const C = useThemeTokens();
  return (
    <div style={{ minWidth: 0 }} title={tip || undefined}>
      <div style={{ fontSize: FONT.xs, color: C.text3, display: "inline-flex", alignItems: "center", gap: 4 }}>
        {label}
        {tip && <span style={{ fontSize: FONT.xs, color: C.text3, cursor: "help", opacity: 0.6 }}>ⓘ</span>}
      </div>
      <div style={{ fontSize: FONT.xl, fontWeight: 700, color: color || C.text1, marginTop: 2 }}>{value}</div>
      {sub && <div style={{ fontSize: FONT.xs, color: C.text3, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

// 접기/펼치기 — 카드 내부 상세 (정돈 패스: 첫 화면 밀도 억제, 상세는 요구 시)
function Collapse({ title, sub, defaultOpen = false, children }) {
  const C = useThemeTokens();
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: RADIUS.md, overflow: "hidden" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        style={{
          width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
          gap: 8, padding: "10px 12px", background: C.card2, border: "none", cursor: "pointer",
          textAlign: "left",
        }}
      >
        <span style={{ minWidth: 0 }}>
          <span style={{ fontSize: FONT.sm, fontWeight: 700, color: C.text1 }}>{title}</span>
          {sub && <span style={{ fontSize: FONT.xs, color: C.text3, marginLeft: 8 }}>{sub}</span>}
        </span>
        <span aria-hidden="true" style={{ fontSize: FONT.xs, color: C.text3, flexShrink: 0 }}>{open ? "▲" : "▼"}</span>
      </button>
      {open && <div style={{ padding: 12, borderTop: `1px solid ${C.border}` }}>{children}</div>}
    </div>
  );
}

// 진행 게이지 — 시간 기반 실측 진행도(경과일/목표일)만 표시 (표본 n 은 서버 내부 집계)
function Gauge({ pct }) {
  const C = useThemeTokens();
  const clamped = Math.max(0, Math.min(1, pct));
  return (
    <div style={{ height: 6, background: C.card, border: `1px solid ${C.border}`, borderRadius: RADIUS.full, overflow: "hidden" }}>
      <div style={{ width: `${Math.round(clamped * 100)}%`, height: "100%", background: clamped >= 1 ? C.green : C.blue, borderRadius: RADIUS.full }} />
    </div>
  );
}

// ════════════════════════════════════════════════
// 카드 1 — 알파 수명주기 파이프라인
// ════════════════════════════════════════════════
function StageTile({ no, name, desc, count, sub, accent }) {
  const C = useThemeTokens();
  return (
    <div style={{ background: C.card2, border: `1px solid ${C.border}`, borderRadius: RADIUS.md, padding: "10px 12px", minWidth: 0 }}>
      <div style={{ fontSize: FONT.xs, color: C.text3, fontWeight: 700 }}>{no}. {name}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: accent || C.text1, marginTop: 2 }}>{count}</div>
      <div style={{ fontSize: FONT.xs, color: C.text3, marginTop: 2, lineHeight: 1.4 }}>{desc}</div>
      {sub && <div style={{ fontSize: FONT.xs, color: C.text2, marginTop: 4, lineHeight: 1.4 }}>{sub}</div>}
    </div>
  );
}

function eventBadgeKind(e) {
  const type = e?.type;
  if (type === "inject" || type === "promote") return "active";
  if (type === "revoke" || type === "demote") return "disabled";
  if (type === "status") {
    if (e?.to === "active") return "active";
    if (e?.to === "disabled") return "disabled";
    if (e?.to === "watch") return "watch";
  }
  return "neutral";
}

function LifecyclePipeline({ data }) {
  const C = useThemeTokens();
  const { t } = useLanguage();
  const isMobile = useIsMobile();

  const candidates = Array.isArray(data?.candidates) ? data.candidates : [];
  const params = data?.params || {};
  const events = Array.isArray(data?.events) ? data.events : [];

  const rejectedCnt = RESEARCH_ARCHIVE.filter((r) => r.verdict === "rejected").length;
  const adoptedCnt = RESEARCH_ARCHIVE.length - rejectedCnt;

  // 실거래 반영중 — di:alpha:params 에 적재된(tunedAt 있는) 전략만 (실측)
  const injected = useMemo(() => Object.entries(params)
    .filter(([id, p]) => p && p.tunedAt && isValidStrategyId(id))
    .map(([id, p]) => ({
      id, sharpe: p.sharpe ?? null, oos: p.oosSharpe ?? null, tunedAt: p.tunedAt,
      // ★ 2026-08-18 (일일감사): 표본 수를 함께 노출. OOS Sharpe 는 거래 수가 적으면
      //   쉽게 두 자릿수로 튀어(실측: mean-revert OOS 14.83 / 표본 15거래) 숫자만 보면
      //   대단한 알파처럼 보입니다. 표본이 작을 때는 "참고용" 임을 명시합니다.
      trades: Number.isFinite(p.trades) ? p.trades : null,
    }))
    .sort((a, b) => (b.sharpe || 0) - (a.sharpe || 0)), [params]);

  const topCands = useMemo(() => [...candidates]
    .sort((a, b) => (b.backtestResult?.sharpe || 0) - (a.backtestResult?.sharpe || 0))
    .slice(0, 6), [candidates]);

  return (
    <Card>
      <div style={{ marginBottom: 6 }}>
        <div style={{ fontSize: FONT.lg, fontWeight: 700, color: C.text1 }}>{t("alphalab.pipeline.title")}</div>
        <div style={{ fontSize: FONT.xs, color: C.text3, marginTop: 4, lineHeight: 1.5 }}>{t("alphalab.pipeline.subtitle")}</div>
      </div>

      {/* 4단계 타일 */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4, 1fr)", gap: 10, marginTop: 10 }}>
        <StageTile
          no={1}
          name={t("alphalab.pipeline.stageCandidates")}
          desc={t("alphalab.pipeline.stageCandidatesDesc")}
          count={t("alphalab.pipeline.unitCount", { n: fmtInt(candidates.length) })}
          accent={C.text2}
        />
        <StageTile
          no={2}
          name={t("alphalab.pipeline.stageValidation")}
          desc={t("alphalab.pipeline.stageValidationDesc")}
          count={t("alphalab.pipeline.unitCount", { n: RESEARCH_ARCHIVE.length })}
          sub={t("alphalab.pipeline.validationSplit", { rejected: rejectedCnt, adopted: adoptedCnt })}
          accent={C.blue}
        />
        <StageTile
          no={3}
          name={t("alphalab.pipeline.stageShadow")}
          desc={t("alphalab.pipeline.stageShadowDesc")}
          count={t("alphalab.pipeline.unitCount", { n: SHADOW_TRACKS.length })}
          accent={C.purple}
        />
        <StageTile
          no={4}
          name={t("alphalab.pipeline.stageLive")}
          desc={t("alphalab.pipeline.stageLiveDesc")}
          count={t("alphalab.pipeline.unitCount", { n: injected.length })}
          accent={C.green}
        />
      </div>

      {/* 실거래 반영중 — 한 줄 칩 (수치는 API params 실측) */}
      {injected.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginTop: 10 }}>
          <span style={{ fontSize: FONT.xs, fontWeight: 700, color: C.green }}>{t("alphalab.pipeline.injectedLead")}</span>
          {injected.map((p) => {
            // 표본 30거래 미만이면 OOS Sharpe 를 성과가 아니라 "참고용" 으로 표기
            const lowN = p.trades != null && p.trades < 30;
            return (
              <span key={p.id} style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                background: C.card2, border: `1px solid ${C.border}`, borderRadius: RADIUS.full,
                padding: "3px 10px", fontSize: FONT.xs,
              }} title={lowN ? t("alphalab.pipeline.injectedLowN", { trades: p.trades }) : undefined}>
                <span style={{ fontWeight: 700, color: C.text1 }}>{strategyLabel(t, p.id)}</span>
                <span style={{ color: C.text3 }}>
                  {p.trades != null
                    ? t("alphalab.pipeline.injectedChipN", { sharpe: fmtNum(p.sharpe, 2), oos: fmtNum(p.oos, 2), trades: fmtInt(p.trades) })
                    : t("alphalab.pipeline.injectedChip", { sharpe: fmtNum(p.sharpe, 2), oos: fmtNum(p.oos, 2) })}
                </span>
                {lowN && <span style={{ color: C.text3, fontWeight: 700 }}>· {t("alphalab.pipeline.injectedLowNTag")}</span>}
                <span style={{ color: C.text3 }}>{fmtAgo(t, p.tunedAt)}</span>
              </span>
            );
          })}
        </div>
      )}

      {/* 섀도 축적 트랙 — 시간 기반 진행 게이지 + 사전등록 게이트 */}
      <div style={{ marginTop: 14 }}>
        <div style={{ fontSize: FONT.sm, fontWeight: 700, color: C.text1, marginBottom: 8 }}>{t("alphalab.pipeline.shadowTitle")}</div>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 10 }}>
          {SHADOW_TRACKS.map((tr) => {
            const elapsedDays = Math.max(0, Math.floor((Date.now() - Date.parse(tr.start)) / 86400000));
            const done = tr.targetDays != null && elapsedDays >= tr.targetDays;
            return (
              <div key={tr.id} style={{ background: C.card2, border: `1px solid ${C.border}`, borderRadius: RADIUS.md, padding: 12 }}>
                <div style={{ fontSize: FONT.sm, fontWeight: 700, color: C.text1 }}>{t(`alphalab.pipeline.${tr.id}Name`)}</div>
                <div style={{ fontSize: FONT.xs, color: C.text3, marginTop: 2, lineHeight: 1.5 }}>{t(`alphalab.pipeline.${tr.id}Desc`)}</div>
                <div style={{ marginTop: 8 }}>
                  {tr.targetDays != null ? (
                    <>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: FONT.xs, color: C.text2, marginBottom: 4 }}>
                        <span>{done
                          ? t("alphalab.pipeline.gateReached")
                          : t("alphalab.pipeline.accumDays", { days: elapsedDays + 1, target: tr.targetDays })}</span>
                        <span style={{ color: C.text3 }}>{Math.min(100, Math.round((elapsedDays / tr.targetDays) * 100))}%</span>
                      </div>
                      <Gauge pct={elapsedDays / tr.targetDays} />
                    </>
                  ) : (
                    <div style={{ fontSize: FONT.xs, color: C.text2 }}>
                      {t("alphalab.pipeline.accumStart", { date: tr.wiredDate })}
                    </div>
                  )}
                </div>
                {tr.hasGate && (
                  <div style={{ marginTop: 8, fontSize: FONT.xs, color: C.text3, lineHeight: 1.5 }}>
                    <span style={{ fontWeight: 700, color: C.text2 }}>{t("alphalab.pipeline.gateLabel")}</span>{" "}
                    {t("alphalab.pipeline.gateSpec")}
                    <br />{t("alphalab.pipeline.gateNote")}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div style={{ fontSize: FONT.xs, color: C.text3, marginTop: 6 }}>{t("alphalab.pipeline.nNote")}</div>
      </div>

      {/* 상세 펼침 — 발굴 후보 / 수명주기 로그 */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
        <Collapse
          title={t("alphalab.pipeline.candDetailTitle")}
          sub={t("alphalab.pipeline.unitCount", { n: fmtInt(candidates.length) })}
        >
          <div style={{ fontSize: FONT.xs, color: C.text3, marginBottom: 8, lineHeight: 1.5 }}>{t("alphalab.pipeline.candDetailSub")}</div>
          {topCands.length === 0 ? (
            <div style={{ fontSize: FONT.xs, color: C.text3 }}>{t("alphalab.pipeline.candEmpty")}</div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 8 }}>
              {topCands.map((c) => (
                <div key={c.id} style={{
                  background: C.card, border: `1px solid ${C.border}`, borderRadius: RADIUS.sm,
                  padding: "8px 10px", display: "flex", flexDirection: "column", gap: 3,
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 6 }}>
                    <span style={{ fontSize: FONT.sm, fontWeight: 700, color: C.text1 }}>{strategyLabel(t, c.parentStrategy)}</span>
                    <span style={{ fontSize: 10, color: C.text3, border: `1px solid ${C.border}`, borderRadius: 4, padding: "1px 5px", whiteSpace: "nowrap" }}>
                      {t("alphalab.pipeline.candUnverified")}
                    </span>
                  </div>
                  <span style={{ fontSize: FONT.xs, color: C.text3 }}>
                    {t("alphalab.pipeline.candStat", {
                      symbol: (c.symbol || "").replace("USDT", ""),
                      sharpe: fmtNum(c.backtestResult?.sharpe, 1),
                      win: fmtNum(c.backtestResult?.winRate, 0),
                    })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Collapse>

        <Collapse
          title={t("alphalab.pipeline.logTitle")}
          sub={t("alphalab.pipeline.logSub", { n: events.length })}
        >
          {events.length === 0 ? (
            <div style={{ fontSize: FONT.xs, color: C.text3 }}>{t("alphalab.pipeline.logEmpty")}</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 0, maxHeight: 320, overflowY: "auto" }}>
              {events.map((e, i) => {
                const typeKey = ["inject", "status", "revoke", "promote", "demote", "refresh"].includes(e?.type) ? e.type : "event";
                return (
                  <div key={`${e?.ts || i}-${i}`} style={{
                    display: "flex", alignItems: "flex-start", gap: 8, padding: "8px 2px",
                    borderBottom: i < events.length - 1 ? `1px solid ${C.border}40` : "none",
                  }}>
                    <span style={{ flexShrink: 0 }}>
                      <Badge kind={eventBadgeKind(e)}>{t(`alphalab.pipeline.evt.${typeKey}`)}</Badge>
                    </span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: FONT.sm, color: C.text1, fontWeight: 600 }}>
                        {e?.family ? strategyLabel(t, e.family) : "—"}
                        {e?.from && e?.to && (
                          <span style={{ fontSize: FONT.xs, color: C.text3, fontWeight: 500, marginLeft: 6 }}>
                            {t(`alphalab.status.${e.from}`) !== `alphalab.status.${e.from}` ? t(`alphalab.status.${e.from}`) : e.from}
                            {" → "}
                            {t(`alphalab.status.${e.to}`) !== `alphalab.status.${e.to}` ? t(`alphalab.status.${e.to}`) : e.to}
                          </span>
                        )}
                      </div>
                      {e?.reason && <div style={{ fontSize: FONT.xs, color: C.text3, lineHeight: 1.4 }}>{e.reason}</div>}
                    </div>
                    <span style={{ fontSize: FONT.xs, color: C.text3, flexShrink: 0 }}>{fmtAgo(t, e?.ts)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </Collapse>
      </div>
    </Card>
  );
}

// ════════════════════════════════════════════════
// 카드 2 — 검증 아카이브 (결론 카드, "기각도 성과" 톤)
// ════════════════════════════════════════════════
const VERDICT_BADGE = { rejected: "disabled", conditional: "watch", partial: "active", scoped: "neutral" };

function ArchiveItem({ item }) {
  const C = useThemeTokens();
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const base = `alphalab.archive.items.${item.id}`;
  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: RADIUS.md, overflow: "hidden" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "10px 12px",
          background: C.card2, border: "none", cursor: "pointer", textAlign: "left",
        }}
      >
        <span style={{ flexShrink: 0 }}>
          <Badge kind={VERDICT_BADGE[item.verdict] || "neutral"}>{t(`alphalab.archive.verdict.${item.verdict}`)}</Badge>
        </span>
        <span style={{ fontSize: FONT.sm, fontWeight: 700, color: C.text1, flex: 1, minWidth: 0 }}>{t(`${base}.title`)}</span>
        <span aria-hidden="true" style={{ fontSize: FONT.xs, color: C.text3, flexShrink: 0 }}>{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div style={{ padding: 12, borderTop: `1px solid ${C.border}` }}>
          <div style={{ fontSize: FONT.sm, color: C.text2, lineHeight: 1.6 }}>{t(`${base}.concl`)}</div>
          <div style={{
            marginTop: 8, padding: "6px 10px", background: C.card2, borderRadius: RADIUS.sm,
            fontSize: FONT.xs, color: C.text2, lineHeight: 1.5,
          }}>
            {t(`${base}.stat`)}
          </div>
          <div style={{ fontSize: FONT.xs, color: C.text3, marginTop: 6 }}>
            {t("alphalab.archive.sourceLabel")}: {item.src} · {item.date}
          </div>
        </div>
      )}
    </div>
  );
}

function ArchiveSection() {
  const C = useThemeTokens();
  const { t } = useLanguage();
  const rejectedCnt = RESEARCH_ARCHIVE.filter((r) => r.verdict === "rejected").length;
  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, marginBottom: 6 }}>
        <div style={{ fontSize: FONT.lg, fontWeight: 700, color: C.text1 }}>{t("alphalab.archive.title")}</div>
        <span style={{ fontSize: FONT.xs, color: C.text3, whiteSpace: "nowrap" }}>
          {t("alphalab.archive.summary", {
            total: RESEARCH_ARCHIVE.length,
            rejected: rejectedCnt,
            adopted: RESEARCH_ARCHIVE.length - rejectedCnt,
          })}
        </span>
      </div>
      <div style={{ fontSize: FONT.xs, color: C.text3, marginBottom: 10, lineHeight: 1.5 }}>{t("alphalab.archive.subtitle")}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {RESEARCH_ARCHIVE.map((item) => <ArchiveItem key={item.id} item={item} />)}
      </div>
    </Card>
  );
}

// ════════════════════════════════════════════════
// 카드 3 — 실전 전략 현황판 (9종 위상 + 상세 순위표·레짐·가중치)
// ════════════════════════════════════════════════
const STATUS_EMOJI = { active: "🟢", watch: "🟡", disabled: "🔴" };

function RegimeDetail({ data }) {
  const C = useThemeTokens();
  const { t } = useLanguage();
  const regime = data?.regime || data?.leaderboard?.regime || null;
  const _w = data?.weights?.weights;
  const weights = (_w && typeof _w === "object" && !Array.isArray(_w)) ? _w : {};

  const regimeKeyMap = { trending: "trending", mean_reverting: "meanReverting", transitional: "transitional" };
  const rk = regimeKeyMap[regime?.regime] || "unknown";
  const hurst = regime?.avgHurst ?? regime?.hurst ?? null;
  const er = regime?.avgER ?? null;
  const effKey = ["directional", "noisy", "mixed"].includes(regime?.efficiency) ? regime.efficiency : "unknown";

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginBottom: 14 }}>
        <Stat
          label={t("alphalab.board.regimeStat")}
          value={t(`alphalab.regime.${rk}`)}
          sub={t(`alphalab.regime.${rk}Desc`)}
          color={rk === "trending" ? C.green : rk === "meanReverting" ? C.purple : C.text1}
        />
        <Stat
          label={t("alphalab.board.hurstStat")}
          value={hurst != null ? fmtNum(hurst, 2) : "—"}
          sub={hurst == null ? t("alphalab.board.calculating") : hurst > 0.55 ? t("alphalab.board.hurstStrong") : hurst < 0.45 ? t("alphalab.board.hurstRange") : t("alphalab.board.hurstWeak")}
          color={hurst == null ? C.text1 : hurst > 0.55 ? C.green : hurst < 0.45 ? C.purple : C.text1}
          tip={t("alphalab.metricTip.hurst")}
        />
        <Stat
          label={t("alphalab.board.erStat")}
          value={er != null ? fmtNum(er, 2) : "—"}
          sub={t(`alphalab.efficiency.${effKey}`)}
          color={effKey === "directional" ? C.green : effKey === "noisy" ? C.red : C.text1}
          tip={t("alphalab.metricTip.er")}
        />
        <Stat
          label={t("alphalab.board.tickersStat")}
          value={regime?.activeTickers != null ? fmtInt(regime.activeTickers) : "—"}
          sub={t("alphalab.board.tickersSub")}
        />
      </div>
      {Object.keys(weights).length > 0 && (
        <>
          <div style={{ fontSize: FONT.sm, color: C.text2, marginBottom: 8 }}>{t("alphalab.board.weightsTitle")}</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8 }}>
            {Object.entries(weights).map(([k, v]) => {
              const tone = v > 1.1 ? C.green : v < 0.7 ? C.red : C.text2;
              return (
                <div key={k} style={{
                  padding: "6px 10px", background: C.card2, borderRadius: RADIUS.sm,
                  border: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center",
                }}>
                  <span style={{ fontSize: FONT.xs, color: C.text2 }}>{strategyLabel(t, k)}</span>
                  <span style={{ fontSize: FONT.sm, fontWeight: 700, color: tone }}>×{fmtNum(v, 2)}</span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function LeaderboardDetail({ data }) {
  const C = useThemeTokens();
  const { t } = useLanguage();
  const isMobile = useIsMobile();
  const strategies = data?.leaderboard?.strategies || {};
  const statuses = data?.statuses || {};
  const params = data?.params || {};

  const rows = useMemo(() => {
    // production 데이터 없는 family(검증된 mean-revert 등)도 표에 나오도록 합집합.
    const allIds = Array.from(new Set([
      ...Object.keys(strategies || {}),
      ...Object.keys(statuses || {}),
      ...Object.keys(params || {}),
    ])).filter((id) => isValidStrategyId(id));
    return allIds
      .map((id) => {
        const m = strategies[id] || {};
        const statusObj = statuses[id];
        const status = (statusObj?.status) || "active";
        const tunedSharpe = (params[id] && Number.isFinite(params[id].sharpe)) ? params[id].sharpe : null;
        // 실거래 누적 신뢰 불가: summary-fallback 이거나 실거래 trade 가 0 → "수집중" 표기
        const isFallback = m._source === "summary-fallback" || !(m.trades > 0);
        const gradeSharpe = tunedSharpe != null ? tunedSharpe : (m.sharpe || 0);
        return {
          id,
          name: strategyLabel(t, id),
          status,
          statusReason: statusObj?.reason || "",
          trades: m.trades || 0,
          winRate: m.winRate || 0,
          pf: m.profitFactor,
          netPnL: m.netPnL || 0,
          maxDD: m.maxDD || 0,
          avgHold: m.avgHoldHours || 0,
          tunedAt: params[id]?.tunedAt,
          gradeSharpe,
          isFallback,
          backtestGrade: tunedSharpe != null,
          gradeMeaningful: tunedSharpe != null || (m._source !== "summary-fallback" && m.trades > 0 && Number.isFinite(m.sharpe)),
          live: m.live || null,
        };
      }).sort((a, b) => b.gradeSharpe - a.gradeSharpe);
  }, [strategies, statuses, params, t]);

  if (rows.length === 0) {
    return <div style={{ fontSize: FONT.sm, color: C.text3, padding: "16px 0", textAlign: "center" }}>{t("alphalab.board.emptyBody")}</div>;
  }

  const thStyle = { textAlign: "left", padding: "8px 6px", fontSize: FONT.xs, color: C.text3, fontWeight: 600, borderBottom: `1px solid ${C.border}` };
  const tdStyle = { padding: "10px 6px", fontSize: FONT.sm, color: C.text1, borderBottom: `1px solid ${C.border}40` };

  return (
    <div>
      <div style={{ fontSize: FONT.xs, color: C.text3, marginBottom: 8, lineHeight: 1.5 }}>
        {t("alphalab.board.tableNote1")}
        <br />
        <span style={{ opacity: 0.85 }}>{t("alphalab.board.tableNote2")}</span>
      </div>
      {isMobile ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {rows.map((r) => {
            const pnlColor = r.netPnL > 0 ? C.green : r.netPnL < 0 ? C.red : C.text2;
            const sharpeColor = r.gradeSharpe >= 1.5 ? C.green : r.gradeSharpe <= 0 ? C.red : C.text1;
            const grade = sharpeToGrade(r.gradeSharpe);
            return (
              <div key={r.id} style={{
                background: C.card2, border: `1px solid ${C.border}`,
                borderRadius: RADIUS.md, padding: 12, display: "flex", flexDirection: "column", gap: 8,
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 15, color: C.text1 }}>{r.name}</div>
                    {r.tunedAt && (
                      <div style={{ fontSize: FONT.xs, color: C.green, fontWeight: 600, marginTop: 1 }}>
                        {t("alphalab.board.tunedTag", { ago: fmtAgo(t, r.tunedAt) })}
                      </div>
                    )}
                  </div>
                  <Badge kind={r.status}>{STATUS_EMOJI[r.status] || ""} {t(`alphalab.status.${r.status}`)}</Badge>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <div style={{ background: C.card, borderRadius: RADIUS.sm, padding: "8px 10px" }}>
                    <div style={{ fontSize: FONT.xs, color: C.text3, marginBottom: 2 }}>
                      {r.gradeMeaningful && r.backtestGrade ? t("alphalab.board.gradeCellBt") : t("alphalab.board.gradeCell")}
                    </div>
                    {r.gradeMeaningful ? (
                      <div style={{ fontSize: 16, fontWeight: 800, color: sharpeColor }}>{grade.grade}
                        <span style={{ fontSize: FONT.xs, fontWeight: 500, color: C.text3, marginLeft: 4 }}>{fmtNum(r.gradeSharpe, 2)}</span>
                      </div>
                    ) : (
                      <div style={{ fontSize: 14, fontWeight: 600, color: C.text3 }}>— <span style={{ fontSize: FONT.xs }}>{t("alphalab.board.preMeasure")}</span></div>
                    )}
                  </div>
                  <div style={{ background: C.card, borderRadius: RADIUS.sm, padding: "8px 10px" }}>
                    <div style={{ fontSize: FONT.xs, color: C.text3, marginBottom: 2 }}>{r.live ? t("alphalab.board.livePnl") : t("alphalab.board.cumPnl")}</div>
                    {r.live ? (
                      <>
                        <div style={{ fontSize: 16, fontWeight: 800, color: r.live.netPnLUsd > 0 ? C.green : r.live.netPnLUsd < 0 ? C.red : C.text2 }}>
                          {r.live.netPnLUsd > 0 ? "+" : ""}${fmtNum(r.live.netPnLUsd, 2)}
                        </div>
                        <div style={{ fontSize: FONT.xs, color: C.text3 }}>{t("alphalab.board.liveSub", { trades: fmtInt(r.live.trades), win: fmtNum(r.live.winRate, 0) })}</div>
                      </>
                    ) : r.isFallback ? (
                      <div style={{ fontSize: 13, fontWeight: 600, color: C.text3 }}>{t("alphalab.board.collecting")}</div>
                    ) : (
                      <div style={{ fontSize: 16, fontWeight: 800, color: pnlColor }}>
                        {r.netPnL > 0 ? "+" : ""}{fmtNum(r.netPnL, 2)}%
                      </div>
                    )}
                  </div>
                  <div style={{ background: C.card, borderRadius: RADIUS.sm, padding: "8px 10px" }}>
                    <div style={{ fontSize: FONT.xs, color: C.text3, marginBottom: 2 }}>{t("alphalab.board.winRateLabel")}</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: C.text1 }}>{r.isFallback ? "—" : fmtPct(r.winRate)}</div>
                  </div>
                  <div style={{ background: C.card, borderRadius: RADIUS.sm, padding: "8px 10px" }}>
                    <div style={{ fontSize: FONT.xs, color: C.text3, marginBottom: 2 }}>{t("alphalab.board.mddLabel")}</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: C.text1 }}>{r.isFallback ? "—" : fmtPct(r.maxDD)}</div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: FONT.xs, color: C.text3 }}>
                  <span>{t("alphalab.board.subTrades", { n: fmtInt(r.trades) })}</span>
                  <span>{t("alphalab.board.subPF", { v: r.isFallback || r.pf == null ? "—" : fmtNum(r.pf, 2) })}</span>
                  {!r.isFallback && <span>{t("alphalab.board.subHold", { h: fmtNum(r.avgHold, 1) })}</span>}
                </div>
                {r.statusReason && (
                  <div style={{ fontSize: FONT.xs, color: C.text3, lineHeight: 1.5 }}>{r.statusReason}</div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
            <thead>
              <tr>
                <th style={thStyle}>{t("alphalab.board.colStrategy")}</th>
                <th style={thStyle}>{t("alphalab.board.colStatus")}</th>
                <th style={{ ...thStyle, textAlign: "right" }} title={t("alphalab.board.tradesTip")}>{t("alphalab.board.colTrades")}</th>
                <th style={{ ...thStyle, textAlign: "right" }} title={t("alphalab.metricTip.winRate")}>{t("alphalab.board.colWinRate")}</th>
                <th style={{ ...thStyle, textAlign: "right" }} title={t("alphalab.metricTip.sharpe")}>{t("alphalab.board.colGrade")}</th>
                <th style={{ ...thStyle, textAlign: "right" }} title={t("alphalab.metricTip.pf")}>{t("alphalab.board.colPF")}</th>
                <th style={{ ...thStyle, textAlign: "right" }}>{t("alphalab.board.colPnL")}</th>
                <th style={{ ...thStyle, textAlign: "right" }} title={t("alphalab.metricTip.mdd")}>{t("alphalab.board.colMDD")}</th>
                <th style={{ ...thStyle, textAlign: "right" }}>{t("alphalab.board.colHold")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const pnlColor = r.netPnL > 0 ? C.green : r.netPnL < 0 ? C.red : C.text2;
                const sharpeColor = r.gradeSharpe >= 1.5 ? C.green : r.gradeSharpe <= 0 ? C.red : C.text1;
                const grade = sharpeToGrade(r.gradeSharpe);
                const muted = { ...tdStyle, textAlign: "right", color: C.text3 };
                return (
                  <tr key={r.id}>
                    <td style={tdStyle}>
                      <div style={{ fontWeight: 600 }}>{r.name}</div>
                      <div style={{ fontSize: FONT.xs, color: C.text3 }}>{r.id}</div>
                      {r.tunedAt && (
                        <div style={{ fontSize: FONT.xs, color: C.green, fontWeight: 600, marginTop: 2 }}>
                          {t("alphalab.board.tunedTag", { ago: fmtAgo(t, r.tunedAt) })}
                        </div>
                      )}
                    </td>
                    <td style={tdStyle}>
                      <Badge kind={r.status}>{STATUS_EMOJI[r.status] || ""} {t(`alphalab.status.${r.status}`)}</Badge>
                      {r.statusReason && (
                        <div style={{ fontSize: FONT.xs, color: C.text3, marginTop: 2 }} title={r.statusReason}>
                          {r.statusReason.length > 28 ? r.statusReason.slice(0, 28) + "…" : r.statusReason}
                        </div>
                      )}
                    </td>
                    <td style={{ ...tdStyle, textAlign: "right" }}>{fmtInt(r.trades)}</td>
                    <td style={{ ...tdStyle, textAlign: "right" }}>{r.isFallback ? "—" : fmtPct(r.winRate)}</td>
                    <td style={{ ...tdStyle, textAlign: "right", color: r.gradeMeaningful ? sharpeColor : C.text3, fontWeight: 700 }}
                        title={r.backtestGrade ? t("alphalab.board.btTip") : t("alphalab.metricTip.sharpe")}>
                      {r.gradeMeaningful ? (
                        <>
                          <div>{grade.grade}{r.backtestGrade ? <span style={{ fontSize: FONT.xs, fontWeight: 500, color: C.text3 }}> ·BT</span> : null}</div>
                          <div style={{ fontSize: FONT.xs, fontWeight: 500, color: C.text3 }}>{fmtNum(r.gradeSharpe, 2)}</div>
                        </>
                      ) : (
                        <div style={{ fontWeight: 600 }}>— <span style={{ fontSize: FONT.xs, fontWeight: 400 }}>{t("alphalab.board.preMeasure")}</span></div>
                      )}
                    </td>
                    <td style={{ ...tdStyle, textAlign: "right" }} title={t("alphalab.metricTip.pf")}>{r.isFallback || r.pf == null ? "—" : fmtNum(r.pf, 2)}</td>
                    {r.live ? (
                      <td style={{ ...tdStyle, textAlign: "right", fontWeight: 600 }}
                          title={t("alphalab.board.liveTip", { trades: r.live.trades, win: r.live.winRate, avg: r.live.avgPnLUsd })}>
                        <div style={{ color: r.live.netPnLUsd > 0 ? C.green : r.live.netPnLUsd < 0 ? C.red : C.text2 }}>
                          {r.live.netPnLUsd > 0 ? "+" : ""}${fmtNum(r.live.netPnLUsd, 2)}
                        </div>
                        <div style={{ fontSize: FONT.xs, fontWeight: 500, color: C.text3 }}>{t("alphalab.board.liveSub", { trades: fmtInt(r.live.trades), win: fmtNum(r.live.winRate, 0) })}</div>
                      </td>
                    ) : r.isFallback ? (
                      <td style={muted} title={t("alphalab.board.collectingTip")}>{t("alphalab.board.collecting")}</td>
                    ) : (
                      <td style={{ ...tdStyle, textAlign: "right", color: pnlColor, fontWeight: 600 }}>
                        {r.netPnL > 0 ? "+" : ""}{fmtNum(r.netPnL, 2)}%
                      </td>
                    )}
                    <td style={{ ...tdStyle, textAlign: "right" }} title={t("alphalab.metricTip.mdd")}>{r.isFallback ? "—" : fmtPct(r.maxDD)}</td>
                    <td style={{ ...tdStyle, textAlign: "right" }}>{r.isFallback ? "—" : `${fmtNum(r.avgHold, 1)}h`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div style={{ fontSize: FONT.xs, color: C.text3, marginTop: 12, padding: "8px 10px", background: C.card2, borderRadius: RADIUS.sm }}>
        {t("alphalab.disclaimerTable")}
      </div>
    </div>
  );
}

function StrategyBoard({ data }) {
  const C = useThemeTokens();
  const { t } = useLanguage();
  const statuses = data?.statuses || {};

  // 실전 9종 위상 — di:alpha:strategy-status:* 실데이터 (statuses 키가 실전 종목 전체)
  const chips = useMemo(() => Object.entries(statuses)
    .filter(([id]) => isValidStrategyId(id))
    .map(([id, s]) => ({ id, status: s?.status || "active", reason: s?.reason || "", updatedAt: s?.updatedAt }))
    .sort((a, b) => {
      const rank = { active: 0, watch: 1, disabled: 2 };
      return (rank[a.status] ?? 3) - (rank[b.status] ?? 3);
    }), [statuses]);

  const counts = useMemo(() => chips.reduce((acc, c) => {
    acc[c.status] = (acc[c.status] || 0) + 1;
    return acc;
  }, {}), [chips]);

  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, marginBottom: 6 }}>
        <div style={{ fontSize: FONT.lg, fontWeight: 700, color: C.text1 }}>{t("alphalab.board.title")}</div>
        {chips.length > 0 && (
          <span style={{ fontSize: FONT.xs, color: C.text3, whiteSpace: "nowrap" }}>
            {t("alphalab.board.counts", { active: counts.active || 0, watch: counts.watch || 0, disabled: counts.disabled || 0 })}
          </span>
        )}
      </div>
      <div style={{ fontSize: FONT.xs, color: C.text3, marginBottom: 10, lineHeight: 1.5 }}>{t("alphalab.board.subtitle")}</div>

      {chips.length === 0 ? (
        <div style={{ fontSize: FONT.sm, color: C.text3, padding: "12px 0", textAlign: "center" }}>{t("alphalab.board.emptyBody")}</div>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
          {chips.map((c) => {
            const fg = c.status === "active" ? C.green : c.status === "disabled" ? C.red : C.yellow;
            return (
              <span key={c.id}
                title={`${t(`alphalab.status.${c.status}Desc`)}${c.reason ? ` — ${c.reason}` : ""}`}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  background: C.card2, border: `1px solid ${C.border}`,
                  borderRadius: RADIUS.full, padding: "5px 12px",
                }}>
                <span aria-hidden="true" style={{ fontSize: FONT.xs }}>{STATUS_EMOJI[c.status] || ""}</span>
                <span style={{ fontSize: FONT.sm, fontWeight: 700, color: C.text1 }}>{strategyLabel(t, c.id)}</span>
                <span style={{ fontSize: FONT.xs, fontWeight: 600, color: fg }}>{t(`alphalab.status.${c.status}`)}</span>
              </span>
            );
          })}
        </div>
      )}

      <Collapse title={t("alphalab.board.detailTitle")}>
        <RegimeDetail data={data} />
        <div style={{ marginTop: 16, fontSize: FONT.sm, fontWeight: 700, color: C.text1, marginBottom: 8 }}>{t("alphalab.board.tableTitle")}</div>
        <LeaderboardDetail data={data} />
      </Collapse>
    </Card>
  );
}

// ────────────────────────────────────────────────
// Public Mode — 비로그인 사용자용 (TOP3 + 가입 CTA — 화면당 액션 1개)
// ────────────────────────────────────────────────
function PublicAlphaShowcase({ data, onSignup }) {
  const C = useThemeTokens();
  const { t } = useLanguage();
  const strategies = data?.leaderboard?.strategies || {};
  const top3 = useMemo(() => {
    return Object.entries(strategies)
      .filter(([id]) => isValidStrategyId(id))
      .sort((a, b) => (b[1].sharpe || 0) - (a[1].sharpe || 0))
      .slice(0, 3)
      .map(([id, m]) => ({ id, ...m }));
  }, [strategies]);

  // 최근 추이 — historyTail 처음/마지막 netPnL 차 (실데이터, 없으면 "측정 중")
  const hist = data?.historyTail || [];
  const periodPnL = (sid) => {
    if (hist.length < 2) return null;
    const head = hist[0]?.strategies?.[sid]?.netPnL;
    const tail = hist[hist.length - 1]?.strategies?.[sid]?.netPnL;
    if (typeof head !== "number" || typeof tail !== "number") return null;
    return tail - head;
  };

  const descOf = (id) => {
    const key = `alphalab.strategyDesc.${id}`;
    const v = t(key);
    return v === key ? t("alphalab.strategyDesc.fallback") : v;
  };

  return (
    <Card>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: FONT.lg, fontWeight: 800, color: C.text1 }}>{t("alphalab.public.showcaseTitle")}</div>
        <div style={{ fontSize: FONT.xs, color: C.text3, marginTop: 4 }}>{t("alphalab.public.showcaseSub")}</div>
      </div>
      {top3.length === 0 ? (
        <div style={{ fontSize: FONT.sm, color: C.text3, padding: "16px 0", textAlign: "center" }}>{t("alphalab.public.empty")}</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
          {top3.map((s, idx) => {
            const grade = sharpeToGrade(s.sharpe);
            const recent = periodPnL(s.id);
            const recentColor = recent == null ? C.text3 : recent > 0 ? C.green : recent < 0 ? C.red : C.text2;
            return (
              <div key={s.id} style={{
                padding: 14, background: C.card2, borderRadius: RADIUS.md,
                border: `1px solid ${C.border}`, display: "flex", flexDirection: "column", gap: 8,
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: FONT.xs, color: C.text3, fontWeight: 600 }}>#{idx + 1}</span>
                  <Badge kind={grade.color}>{t(`alphalab.gradeLabel.${grade.key}`)}</Badge>
                </div>
                <div style={{ fontSize: FONT.lg, fontWeight: 700, color: C.text1 }}>{strategyLabel(t, s.id)}</div>
                <div style={{ fontSize: FONT.xs, color: C.text2, lineHeight: 1.5 }}>{descOf(s.id)}</div>
                <div style={{ fontSize: FONT.xs, color: C.text3 }}>
                  {t("alphalab.public.recentTrend")}{" "}
                  <span style={{ color: recentColor, fontWeight: 600 }}>
                    {recent == null ? t("alphalab.public.measuring") : `${recent > 0 ? "+" : ""}${fmtNum(recent, 1)}%p`}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <div style={{
        marginTop: 16, padding: 14, background: C.blueBg, borderRadius: RADIUS.md,
        display: "flex", flexDirection: "column", gap: 8, alignItems: "center",
      }}>
        <div style={{ fontSize: FONT.sm, color: C.text1, fontWeight: 600 }}>{t("alphalab.public.ctaLead")}</div>
        <button onClick={onSignup} style={{
          padding: "10px 24px", background: C.blue, color: "#fff",
          border: "none", borderRadius: RADIUS.full,
          fontSize: FONT.sm, fontWeight: 700, cursor: "pointer",
        }}>
          {t("alphalab.public.ctaButton")}
        </button>
        <div style={{ fontSize: FONT.xs, color: C.text3, textAlign: "center" }}>{t("alphalab.public.ctaSub")}</div>
      </div>
    </Card>
  );
}

// ────────────────────────────────────────────────
// 메인 페이지
// ────────────────────────────────────────────────
export default function AlphaLab({ onRequestLogin }) {
  const C = useThemeTokens();
  const { t, lang } = useLanguage();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastFetched, setLastFetched] = useState(null);

  // useAuth — Provider 외부에서 호출되면 throw → public fallback 처리
  let auth = null;
  try { auth = useAuth(); } catch { auth = null; }
  const isPublic = !auth?.user;

  // GA4 — Alpha Lab 페이지 진입 (마운트 시 1회)
  useEffect(() => { ga.alphaLabViewed(); }, []);

  // SEO — 동적 메타데이터 (회원/비회원 분기)
  useEffect(() => {
    const title = isPublic ? t("alphalab.seo.publicTitle") : t("alphalab.seo.memberTitle");
    const desc = isPublic ? t("alphalab.seo.publicDesc") : t("alphalab.seo.memberDesc");
    try {
      if (document.title !== title) document.title = title;
      let metaDesc = document.querySelector('meta[name="description"]');
      if (!metaDesc) {
        metaDesc = document.createElement("meta");
        metaDesc.setAttribute("name", "description");
        document.head.appendChild(metaDesc);
      }
      metaDesc.setAttribute("content", desc);
    } catch {}
  }, [isPublic, t]);

  const fetchData = async () => {
    try {
      const r = await fetch("/api/agents/alpha-status", { credentials: "same-origin" });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "fetch failed");
      setData(j);
      setError(null);
      setLastFetched(new Date());
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const tm = setInterval(fetchData, REFRESH_MS);
    return () => clearInterval(tm);
  }, []);

  if (loading && !data) {
    return (
      <div className="z-bento-scope" style={{ padding: "14px 14px", maxWidth: 1200, margin: "0 auto" }}>
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: FONT["2xl"], fontWeight: 800, color: C.text1, letterSpacing: "-0.02em" }}>{t("alphalab.title")}</div>
          <div style={{ fontSize: FONT.sm, color: C.text3, marginTop: 4 }}>{t("alphalab.taglineMember")}</div>
        </div>
        <LoadingBlock rows={4} height={84} label={t("alphalab.loading")} />
      </div>
    );
  }

  // ── 비로그인 view (Public Mode) ──────────────────
  if (isPublic) {
    return (
      <div className="z-bento-scope" style={{ padding: "14px 14px", display: "flex", flexDirection: "column", gap: 14, maxWidth: 1200, margin: "0 auto" }}>
        <div>
          <div style={{ fontSize: FONT["2xl"], fontWeight: 800, color: C.text1, letterSpacing: "-0.02em" }}>{t("alphalab.title")}</div>
          <div style={{ fontSize: FONT.sm, color: C.text3, marginTop: 4, lineHeight: 1.55 }}>{t("alphalab.taglinePublic")}</div>
        </div>

        <PublicAlphaShowcase data={data} onSignup={() => {
          ga.ctaClick("alpha-lab-public", "signup");
          if (typeof onRequestLogin === "function") onRequestLogin();
        }} />

        {/* 검증 아카이브 — 정적 실측 결과라 공개 가능. "기각도 공개"가 곧 신뢰 자산 */}
        <ArchiveSection />

        <Card>
          <div style={{ fontSize: FONT.lg, fontWeight: 700, color: C.text1, marginBottom: 8 }}>{t("alphalab.public.membersTitle")}</div>
          <ul style={{ margin: 0, padding: "0 0 0 20px", color: C.text2, fontSize: FONT.sm, lineHeight: 1.8 }}>
            {(Array.isArray(t("alphalab.public.membersItems")) ? t("alphalab.public.membersItems") : []).map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </Card>

        <div style={{ fontSize: FONT.xs, color: C.text3, textAlign: "center", padding: "8px 16px", lineHeight: 1.5 }}>
          {t("alphalab.publicDisclaimer1")}<br />
          {t("alphalab.publicDisclaimer2")}
        </div>
      </div>
    );
  }

  // ── 로그인 view (첫 화면 카드 3개 — 파이프라인 / 아카이브 / 현황판) ──────────────────
  return (
    <div className="z-bento-scope" style={{ padding: "14px 14px", display: "flex", flexDirection: "column", gap: 14, maxWidth: 1200, margin: "0 auto" }}>
      <div>
        <div style={{ fontSize: FONT["2xl"], fontWeight: 800, color: C.text1, letterSpacing: "-0.02em" }}>{t("alphalab.title")}</div>
        <div style={{ fontSize: FONT.sm, color: C.text3, marginTop: 4, lineHeight: 1.55 }}>
          {t("alphalab.taglineMember")}
          {lastFetched && <> · {t("alphalab.lastUpdated", { time: lastFetched.toLocaleTimeString(lang === "en" ? "en-US" : "ko-KR", { hour12: false }) })}</>}
        </div>
        {error && (
          <div style={{ marginTop: 8, padding: 10, background: C.redBg, color: C.red, borderRadius: RADIUS.sm, fontSize: FONT.sm }}>
            {t("alphalab.error", { msg: error })}
          </div>
        )}
      </div>

      <LifecyclePipeline data={data} />
      <ArchiveSection />
      <StrategyBoard data={data} />

      <div style={{ fontSize: FONT.xs, color: C.text3, textAlign: "center", padding: "16px 0", lineHeight: 1.6 }}>
        {t("alphalab.footerCadence")}<br />
        {t("alphalab.footerDisclaimer")}
      </div>
    </div>
  );
}
