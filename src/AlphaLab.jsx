// ══════════════════════════════════════════════════════════════════
// Zepta — Alpha Lab 페이지
// ──────────────────────────────────────────────────────────────────
// 24/7 알파 추적 시스템의 통합 모니터링 화면.
//
// 표시 항목:
//   1) 시장 레짐 + 현재 strategy family 가중치
//   2) Strategy leaderboard (Sharpe / PF / 거래수 / 상태)
//   3) 최근 자동 promote/demote 이벤트
//   4) Strategy 별 누적 PnL (history 기반 라인 차트)
//   5) 새 후보 strategy (continuous-backtest 가 발굴)
//
// API: GET /api/agents/alpha-status (단일 호출로 모든 데이터)
// 갱신: 60초 polling
//
// 2026-05-11 PLAN-BIZ #1: 어려운 용어 → 친화 카피 + Public Mode 추가
//   - 비로그인 시: 오늘 잘 작동한 알파 TOP 3 carousel + 가입 CTA
//   - 회원: 절대 수치(PnL/Sharpe 등) 포함 전체 leaderboard
// ══════════════════════════════════════════════════════════════════
import React, { useEffect, useMemo, useState } from "react";
import { useThemeTokens, FONT, RADIUS } from "./ui/theme.jsx";
import { useIsMobile } from "./ui/useBreakpoint.jsx";
import { ga } from "./lib/analytics.js";
import { useAuth } from "./AuthProvider.jsx";
import { LoadingBlock } from "./ui/primitives.jsx";

const REFRESH_MS = 60_000;

const STATUS_LABEL = {
  active:   { label: "운영중", emoji: "🟢", desc: "정식 운영 — 시그널 100% 반영" },
  watch:    { label: "관찰중", emoji: "🟡", desc: "조심스럽게 — 가중치 절반 적용" },
  disabled: { label: "비활성", emoji: "🔴", desc: "실거래 차단 (shadow 만 운영)" },
};

const REGIME_LABEL = {
  trending:       { label: "추세장", desc: "한 방향으로 흐름이 잡혀있어요" },
  mean_reverting: { label: "역추세장", desc: "박스권 움직임, 회귀 전략 우세" },
  transitional:   { label: "혼조", desc: "방향성 불명확, 보수적 운영" },
  unknown:        { label: "데이터 부족", desc: "Hurst 산출 불가" },
};

const VOL_LABEL = {
  vol_explosive:  "변동성 폭발",
  vol_compressed: "변동성 압축",
  vol_normal:     "변동성 정상",
  unknown:        "변동성 미상",
};

const STRATEGY_KO = {
  "trend-follow":      "추세 추종",
  "mean-revert":       "평균 회귀",
  "breakout":          "돌파 매매",
  "momentum-rotation": "모멘텀 로테이션",
  "volatility-arb":    "변동성 차익",
  "hurst-trend":       "허스트 추세",
  "defi-momentum":     "DeFi 모멘텀",
  "ensemble":          "앙상블 합의",
};

// G-1 — 옛 데이터의 raw ID ("trend", "unknown") 만 숨기고, 나머지는 한글 fallback 으로 표시.
// 2026-05-12 hotfix: 필터가 너무 공격적이면 strategy 응답 키가 STRATEGY_KO 와 100% 일치
// 안 할 때 전략 순위표가 통째로 비어 보이는 critical issue 발생 → fallback 라벨 패턴 도입.
const KNOWN_STRATEGY_IDS = new Set(Object.keys(STRATEGY_KO));
const BLOCKED_RAW_IDS = new Set(["trend", "unknown", "default", "n/a", "null", "undefined"]);
const isValidStrategyId = (id) =>
  typeof id === "string" && id.length > 0 && !BLOCKED_RAW_IDS.has(id.toLowerCase());
const strategyLabel = (id) => STRATEGY_KO[id] || "AI 전략";

// 어려운 지표 → 입문자 친화 툴팁 설명 (PLAN-BIZ #1)
const METRIC_TOOLTIP = {
  sharpe: "위험 대비 수익률 — 같은 변동성에서 얼마나 안정적으로 벌었는지. 1.0 이상이면 양호, 2.0 이상이면 매우 우수.",
  pf: "손익비 (Profit Factor) — 번 돈을 잃은 돈으로 나눈 값. 1.5 이상이면 건강한 전략.",
  mdd: "최대 낙폭 — 운영 기간 중 가장 크게 잃었던 비율. 작을수록 안정적.",
  winRate: "승률 — 전체 거래 중 이긴 거래의 비율. 단, 승률이 낮아도 손익비가 좋으면 수익 가능.",
  hurst: "허스트 지수 — 0.5보다 크면 추세 지속, 작으면 박스권. 시장의 방향성을 측정.",
  atrRatio: "ATR 비율 — 평소 변동성 대비 현재 변동성. 1.5x 이상이면 변동성 폭발 구간.",
};

// Sharpe 등급 변환 — AutoTrading.jsx 와 동일 정책
function sharpeToGrade(sharpe) {
  const s = parseFloat(sharpe);
  if (!isFinite(s)) return { label: "측정 중", grade: "—", color: "neutral" };
  if (s >= 2.0) return { label: "안정성 S 등급", grade: "S", color: "active" };
  if (s >= 1.5) return { label: "안정성 A 등급", grade: "A", color: "active" };
  if (s >= 1.0) return { label: "안정성 B 등급", grade: "B", color: "info" };
  if (s >= 0.5) return { label: "안정성 C 등급", grade: "C", color: "watch" };
  return                { label: "안정성 D 등급 (주의)", grade: "D", color: "disabled" };
}

// ────────────────────────────────────────────────
// 공통 헬퍼
// ────────────────────────────────────────────────
const fmtPct = (v, d = 1) => (v == null || !isFinite(v)) ? "—" : `${Number(v).toFixed(d)}%`;
const fmtNum = (v, d = 2) => (v == null || !isFinite(v)) ? "—" : Number(v).toFixed(d);
const fmtInt = (v) => (v == null || !isFinite(v)) ? "—" : Math.round(v).toLocaleString();
const fmtAgo = (iso) => {
  if (!iso) return "—";
  const ms = Date.now() - Date.parse(iso);
  if (ms < 60000) return "방금";
  if (ms < 3600000) return `${Math.floor(ms / 60000)}분 전`;
  if (ms < 86400000) return `${Math.floor(ms / 3600000)}시간 전`;
  return `${Math.floor(ms / 86400000)}일 전`;
};

// ────────────────────────────────────────────────
// 작은 UI 컴포넌트
// ────────────────────────────────────────────────
function Card({ children, style, ...rest }) {
  const C = useThemeTokens();
  return (
    <div
      style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: RADIUS.lg,
        padding: 16,
        boxShadow: C.cardShadow,
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

// ────────────────────────────────────────────────
// 시장 레짐 + 가중치 카드
// ────────────────────────────────────────────────
function RegimePanel({ data }) {
  const C = useThemeTokens();
  const regime = data?.leaderboard?.regime || null;
  const weights = data?.weights?.weights || {};
  const updatedAt = data?.weights?.updatedAt;

  const regimeKey = regime?.regime || "unknown";
  const volKey = regime?.volRegime || "unknown";

  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ fontSize: FONT.lg, fontWeight: 700, color: C.text1 }}>지금 시장 흐름 & 전략 가중치</div>
        <span style={{ fontSize: FONT.xs, color: C.text3 }}>{updatedAt ? fmtAgo(updatedAt) + " 갱신" : "데이터 없음"}</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginBottom: 16 }}>
        <Stat
          label="시장 흐름"
          value={REGIME_LABEL[regimeKey]?.label || regimeKey}
          sub={REGIME_LABEL[regimeKey]?.desc}
          color={regimeKey === "trending" ? C.green : regimeKey === "mean_reverting" ? C.purple : C.text1}
        />
        <Stat
          label="추세 강도"
          value={fmtNum(regime?.hurst, 3)}
          sub={regime?.hurst > 0.55 ? "한쪽 방향 흐름 강함" : regime?.hurst < 0.45 ? "박스권 회귀 성격" : "방향성 약함"}
          tip={METRIC_TOOLTIP.hurst}
        />
        <Stat
          label="변동성"
          value={VOL_LABEL[volKey] || volKey}
          sub={`평소 대비 ${fmtNum(regime?.atrRatio, 2)}배`}
          color={volKey === "vol_explosive" ? C.red : volKey === "vol_compressed" ? C.blue : C.text1}
          tip={METRIC_TOOLTIP.atrRatio}
        />
        <Stat label="BTC 시세" value={regime?.btcPrice ? `$${fmtInt(regime.btcPrice)}` : "—"} />
      </div>
      <div style={{ fontSize: FONT.sm, color: C.text2, marginBottom: 8 }}>전략별 가중치 — 시장 흐름에 맞춰 자동 조정됩니다:</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8 }}>
        {Object.entries(weights).map(([k, v]) => {
          const tone = v > 1.1 ? C.green : v < 0.7 ? C.red : C.text2;
          return (
            <div key={k} style={{
              padding: "6px 10px",
              background: C.card2,
              borderRadius: RADIUS.sm,
              border: `1px solid ${C.border}`,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}>
              <span style={{ fontSize: FONT.xs, color: C.text2 }}>{strategyLabel(k)}</span>
              <span style={{ fontSize: FONT.sm, fontWeight: 700, color: tone }}>×{fmtNum(v, 2)}</span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ────────────────────────────────────────────────
// Strategy Leaderboard 테이블
// ────────────────────────────────────────────────
function LeaderboardTable({ data }) {
  const C = useThemeTokens();
  // iPhone 16 (393pt) 기준 — 모바일은 카드 리스트로 정보 위계 축소 (테이블 가로 스크롤보다 가독성 우위)
  const isMobile = useIsMobile();
  const strategies = data?.leaderboard?.strategies || {};
  const statuses = data?.statuses || {};
  const params = data?.params || {};

  const rows = useMemo(() => {
    // ★ 2026-06-01 — 리더보드 누락 수정: production 데이터 없는 family(검증된 mean-revert 등)도
    //   표에 나오도록, strategies ∪ statuses ∪ params 의 합집합으로 모든 전략을 표시.
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
        // ★ 2026-05-29 — 지표 정합성: production 메트릭이 신뢰 불가(summary-fallback 또는 거래 없음)
        //   이면 Sharpe·PF·netPnL 대신 백테스트 검증 등급 + "수집중" 표시.
        const tunedSharpe = (params[id] && Number.isFinite(params[id].sharpe)) ? params[id].sharpe : null;
        // 실거래 누적 신뢰 불가: summary-fallback 이거나 실거래 trade 가 0
        const isFallback = m._source === "summary-fallback" || !(m.trades > 0);
        const gradeSharpe = tunedSharpe != null ? tunedSharpe : (m.sharpe || 0);
        return {
          id,
          name: strategyLabel(id),
          status,
          statusReason: statusObj?.reason || "",
          trades: m.trades || 0,
          winRate: m.winRate || 0,
          sharpe: m.sharpe || 0,
          pf: m.profitFactor,
          netPnL: m.netPnL || 0,
          maxDD: m.maxDD || 0,
          avgHold: m.avgHoldHours || 0,
          tunedAt: params[id]?.tunedAt,
          tunedSharpe,
          gradeSharpe,
          isFallback,           // production 누적 신뢰 불가 → 수집중 표시
          backtestGrade: tunedSharpe != null, // 등급이 백테스트 기준임
          // 등급이 의미 있는 경우: 백테스트 검증(tuned) 또는 신뢰 가능한 실거래 Sharpe.
          //   데이터·검증 없으면 등급을 "—" 로 (0 → D 오표시 방지).
          gradeMeaningful: tunedSharpe != null || (m._source !== "summary-fallback" && m.trades > 0 && Number.isFinite(m.sharpe)),
          live: m.live || null,  // ★ 실거래 성과 {trades, winRate, netPnLUsd, avgPnLUsd}
        };
      }).sort((a, b) => b.gradeSharpe - a.gradeSharpe);
  }, [strategies, statuses, params]);

  if (rows.length === 0) {
    return (
      <Card>
        <div style={{ fontSize: FONT.lg, fontWeight: 700, color: C.text1, marginBottom: 8 }}>전략 순위표</div>
        <div style={{ fontSize: FONT.sm, color: C.text3, padding: "24px 0", textAlign: "center" }}>
          데이터를 모으는 중입니다 — 매시 정각마다 자동 갱신됩니다.
        </div>
      </Card>
    );
  }

  const thStyle = { textAlign: "left", padding: "8px 6px", fontSize: FONT.xs, color: C.text3, fontWeight: 600, borderBottom: `1px solid ${C.border}` };
  const tdStyle = { padding: "10px 6px", fontSize: FONT.sm, color: C.text1, borderBottom: `1px solid ${C.border}40` };

  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ fontSize: FONT.lg, fontWeight: 700, color: C.text1 }}>전략 순위표</div>
        <span style={{ fontSize: FONT.xs, color: C.text3 }}>{data?.generatedAt ? fmtAgo(data.generatedAt) + " 갱신" : ""}</span>
      </div>
      <div style={{ fontSize: FONT.xs, color: C.text3, marginBottom: 8, lineHeight: 1.5 }}>
        안정성 등급은 위험 대비 수익률(Sharpe) 기준 — S/A 등급일수록 변동성 대비 꾸준한 수익을 냅니다.
        <br />
        <span style={{ opacity: 0.85 }}>·BT 표시는 백테스트로 검증된 등급입니다. 실거래 누적 손익은 데이터가 쌓이면 "수집중"이 실제 수치로 바뀝니다.</span>
      </div>
      {isMobile ? (
        // 모바일 카드 리스트 — 가로 스크롤 테이블보다 위계가 명확
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {rows.map((r) => {
            const statusInfo = STATUS_LABEL[r.status] || STATUS_LABEL.active;
            const pnlColor = r.netPnL > 0 ? C.green : r.netPnL < 0 ? C.red : C.text2;
            const sharpeColor = r.gradeSharpe >= 1.5 ? C.green : r.gradeSharpe <= 0 ? C.red : C.text1;
            const grade = sharpeToGrade(r.gradeSharpe);
            return (
              <div key={r.id} style={{
                background: C.card2, border: `1px solid ${C.border}`,
                borderRadius: RADIUS.md, padding: 12, display: "flex", flexDirection: "column", gap: 8,
              }}>
                {/* 헤더: 이름 + 상태 */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 15, color: C.text1 }}>{r.name}</div>
                    {r.tunedAt && (
                      <div style={{ fontSize: FONT.xs, color: C.green, fontWeight: 600, marginTop: 1 }}>
                        🧬 실거래 반영중 · 튜닝 {fmtAgo(r.tunedAt)}
                      </div>
                    )}
                  </div>
                  <Badge kind={r.status}>{statusInfo.emoji} {statusInfo.label}</Badge>
                </div>
                {/* 핵심 메트릭 2x2 그리드 */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <div style={{ background: C.card, borderRadius: RADIUS.sm, padding: "8px 10px" }}>
                    <div style={{ fontSize: FONT.xs, color: C.text3, marginBottom: 2 }}>안정성 등급{r.gradeMeaningful && r.backtestGrade ? " · 백테스트" : ""}</div>
                    {r.gradeMeaningful ? (
                      <div style={{ fontSize: 16, fontWeight: 800, color: sharpeColor }}>{grade.grade}
                        <span style={{ fontSize: FONT.xs, fontWeight: 500, color: C.text3, marginLeft: 4 }}>{fmtNum(r.gradeSharpe, 2)}</span>
                      </div>
                    ) : (
                      <div style={{ fontSize: 14, fontWeight: 600, color: C.text3 }}>— <span style={{ fontSize: FONT.xs }}>측정 전</span></div>
                    )}
                  </div>
                  <div style={{ background: C.card, borderRadius: RADIUS.sm, padding: "8px 10px" }}>
                    <div style={{ fontSize: FONT.xs, color: C.text3, marginBottom: 2 }}>{r.live ? "실거래 손익" : "누적 수익률"}</div>
                    {r.live ? (
                      <>
                        <div style={{ fontSize: 16, fontWeight: 800, color: r.live.netPnLUsd > 0 ? C.green : r.live.netPnLUsd < 0 ? C.red : C.text2 }}>
                          {r.live.netPnLUsd > 0 ? "+" : ""}${fmtNum(r.live.netPnLUsd, 2)}
                        </div>
                        <div style={{ fontSize: FONT.xs, color: C.text3 }}>{fmtInt(r.live.trades)}건 · 승률 {fmtNum(r.live.winRate, 0)}%</div>
                      </>
                    ) : r.isFallback ? (
                      <div style={{ fontSize: 13, fontWeight: 600, color: C.text3 }}>실거래 수집중</div>
                    ) : (
                      <div style={{ fontSize: 16, fontWeight: 800, color: pnlColor }}>
                        {r.netPnL > 0 ? "+" : ""}{fmtNum(r.netPnL, 2)}%
                      </div>
                    )}
                  </div>
                  <div style={{ background: C.card, borderRadius: RADIUS.sm, padding: "8px 10px" }}>
                    <div style={{ fontSize: FONT.xs, color: C.text3, marginBottom: 2 }}>승률</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: C.text1 }}>{r.isFallback ? "—" : fmtPct(r.winRate)}</div>
                  </div>
                  <div style={{ background: C.card, borderRadius: RADIUS.sm, padding: "8px 10px" }}>
                    <div style={{ fontSize: FONT.xs, color: C.text3, marginBottom: 2 }}>최대 낙폭</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: C.text1 }}>{r.isFallback ? "—" : fmtPct(r.maxDD)}</div>
                  </div>
                </div>
                {/* 보조 메트릭 — 인라인 한 줄 */}
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: FONT.xs, color: C.text3 }}>
                  <span>누적 거래 {fmtInt(r.trades)}</span>
                  <span>손익비 {r.isFallback || r.pf == null ? "—" : fmtNum(r.pf, 2)}</span>
                  {!r.isFallback && <span>평균보유 {fmtNum(r.avgHold, 1)}h</span>}
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
                <th style={thStyle}>전략</th>
                <th style={thStyle}>운영 상태</th>
                <th style={{ ...thStyle, textAlign: "right" }} title="누적 거래 횟수">거래수</th>
                <th style={{ ...thStyle, textAlign: "right" }} title={METRIC_TOOLTIP.winRate}>승률</th>
                <th style={{ ...thStyle, textAlign: "right" }} title={METRIC_TOOLTIP.sharpe}>안정성 등급</th>
                <th style={{ ...thStyle, textAlign: "right" }} title={METRIC_TOOLTIP.pf}>손익비</th>
                <th style={{ ...thStyle, textAlign: "right" }}>누적 수익률</th>
                <th style={{ ...thStyle, textAlign: "right" }} title={METRIC_TOOLTIP.mdd}>최대 낙폭</th>
                <th style={{ ...thStyle, textAlign: "right" }}>평균 보유</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const statusInfo = STATUS_LABEL[r.status] || STATUS_LABEL.active;
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
                          🧬 실거래 반영중 · {fmtAgo(r.tunedAt)}
                        </div>
                      )}
                    </td>
                    <td style={tdStyle}>
                      <Badge kind={r.status}>{statusInfo.emoji} {statusInfo.label}</Badge>
                      {r.statusReason && (
                        <div style={{ fontSize: FONT.xs, color: C.text3, marginTop: 2 }} title={r.statusReason}>
                          {r.statusReason.length > 28 ? r.statusReason.slice(0, 28) + "…" : r.statusReason}
                        </div>
                      )}
                    </td>
                    <td style={{ ...tdStyle, textAlign: "right" }}>{fmtInt(r.trades)}</td>
                    <td style={{ ...tdStyle, textAlign: "right" }}>{r.isFallback ? "—" : fmtPct(r.winRate)}</td>
                    <td style={{ ...tdStyle, textAlign: "right", color: r.gradeMeaningful ? sharpeColor : C.text3, fontWeight: 700 }} title={r.backtestGrade ? "백테스트로 검증된 안정성 등급 (실거래 누적 데이터 수집 중)" : METRIC_TOOLTIP.sharpe}>
                      {r.gradeMeaningful ? (
                        <>
                          <div>{grade.grade}{r.backtestGrade ? <span style={{ fontSize: FONT.xs, fontWeight: 500, color: C.text3 }}> ·BT</span> : null}</div>
                          <div style={{ fontSize: FONT.xs, fontWeight: 500, color: C.text3 }}>{fmtNum(r.gradeSharpe, 2)}</div>
                        </>
                      ) : (
                        <div style={{ fontWeight: 600 }}>— <span style={{ fontSize: FONT.xs, fontWeight: 400 }}>측정 전</span></div>
                      )}
                    </td>
                    <td style={{ ...tdStyle, textAlign: "right" }} title={METRIC_TOOLTIP.pf}>{r.isFallback || r.pf == null ? "—" : fmtNum(r.pf, 2)}</td>
                    {r.live ? (
                      <td style={{ ...tdStyle, textAlign: "right", fontWeight: 600 }} title={`실거래 ${r.live.trades}건 · 승률 ${r.live.winRate}% · 거래당 평균 $${r.live.avgPnLUsd}`}>
                        <div style={{ color: r.live.netPnLUsd > 0 ? C.green : r.live.netPnLUsd < 0 ? C.red : C.text2 }}>
                          {r.live.netPnLUsd > 0 ? "+" : ""}${fmtNum(r.live.netPnLUsd, 2)}
                        </div>
                        <div style={{ fontSize: FONT.xs, fontWeight: 500, color: C.text3 }}>{fmtInt(r.live.trades)}건 · {fmtNum(r.live.winRate, 0)}%</div>
                      </td>
                    ) : r.isFallback ? (
                      <td style={muted} title="실거래 누적 손익은 데이터 수집 후 표시됩니다">수집중</td>
                    ) : (
                      <td style={{ ...tdStyle, textAlign: "right", color: pnlColor, fontWeight: 600 }}>
                        {r.netPnL > 0 ? "+" : ""}{fmtNum(r.netPnL, 2)}%
                      </td>
                    )}
                    <td style={{ ...tdStyle, textAlign: "right" }} title={METRIC_TOOLTIP.mdd}>{r.isFallback ? "—" : fmtPct(r.maxDD)}</td>
                    <td style={{ ...tdStyle, textAlign: "right" }}>{r.isFallback ? "—" : `${fmtNum(r.avgHold, 1)}h`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div style={{ fontSize: FONT.xs, color: C.text3, marginTop: 12, padding: "8px 10px", background: C.card2, borderRadius: RADIUS.sm }}>
        ⚠ Zepta 는 분석 도구입니다. 위 수치는 과거 시뮬레이션 결과이며 미래 수익을 보장하지 않습니다. 매매 결정과 손익은 본인 책임입니다.
      </div>
    </Card>
  );
}

// ────────────────────────────────────────────────
// 누적 Sharpe 시계열 라인 (SVG sparkline)
// ────────────────────────────────────────────────
function SharpeHistoryChart({ data }) {
  const C = useThemeTokens();
  const hist = data?.historyTail || [];
  const strategies = data?.leaderboard?.strategies || {};
  const top4 = useMemo(() => {
    return Object.entries(strategies)
      .filter(([id]) => isValidStrategyId(id)) // G-1 hotfix — raw ID 만 숨기고 나머지는 fallback 라벨
      .sort((a, b) => (b[1].sharpe || 0) - (a[1].sharpe || 0))
      .slice(0, 4)
      .map(([k]) => k);
  }, [strategies]);

  if (hist.length < 2 || top4.length === 0) {
    return (
      <Card>
        <div style={{ fontSize: FONT.lg, fontWeight: 700, color: C.text1, marginBottom: 8 }}>안정성 추이 (최근 24시간)</div>
        <div style={{ fontSize: FONT.sm, color: C.text3, padding: "24px 0", textAlign: "center" }}>
          데이터를 모으는 중입니다 — 매시간 누적되어 24시간 이후부터 그래프로 보여드려요.
        </div>
      </Card>
    );
  }

  const W = 600, H = 160, P = 16;
  const series = top4.map((sid, idx) => {
    const points = hist.map((h, i) => ({
      i,
      v: h.strategies?.[sid]?.sharpe ?? 0,
    }));
    return { sid, points };
  });
  const allV = series.flatMap((s) => s.points.map((p) => p.v));
  const vMin = Math.min(0, ...allV, -1);
  const vMax = Math.max(1, ...allV);
  const xStep = (W - 2 * P) / Math.max(1, hist.length - 1);
  const colors = [C.blue, C.green, C.purple, C.orange];

  const yMap = (v) => H - P - ((v - vMin) / (vMax - vMin || 1)) * (H - 2 * P);
  const zeroY = yMap(0);

  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ fontSize: FONT.lg, fontWeight: 700, color: C.text1 }} title={METRIC_TOOLTIP.sharpe}>안정성 추이 (최근 {hist.length}시간)</div>
      </div>
      {/* viewBox 로 모바일에서도 가용 폭에 맞춰 비례 축소 (iPhone 16: 393pt → 가용 폭 약 320pt 까지 축소) */}
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" style={{ display: "block", width: "100%", height: "auto" }}>
        <line x1={P} y1={zeroY} x2={W - P} y2={zeroY} stroke={C.border} strokeDasharray="3 3" />
        {series.map((s, idx) => {
          const d = s.points.map((p, i) => `${i === 0 ? "M" : "L"} ${P + p.i * xStep} ${yMap(p.v)}`).join(" ");
          return <path key={s.sid} d={d} stroke={colors[idx]} strokeWidth={2} fill="none" />;
        })}
      </svg>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 8 }}>
        {series.map((s, idx) => (
          <div key={s.sid} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: FONT.xs, color: C.text2 }}>
            <span style={{ width: 10, height: 3, background: colors[idx] }} />
            {strategyLabel(s.sid)}
          </div>
        ))}
      </div>
    </Card>
  );
}

// ────────────────────────────────────────────────
// 종목·타임프레임 메트릭
// ────────────────────────────────────────────────
function SymbolTimeframePanel({ data }) {
  const C = useThemeTokens();
  const symbols = data?.leaderboard?.symbols || {};
  const timeframes = data?.leaderboard?.timeframes || {};
  const symRows = Object.entries(symbols).sort((a, b) => (b[1].sharpe || 0) - (a[1].sharpe || 0)).slice(0, 8);
  const tfRows = Object.entries(timeframes).sort((a, b) => (b[1].trades || 0) - (a[1].trades || 0));

  if (symRows.length === 0 && tfRows.length === 0) return null;

  const renderRow = (k, m) => {
    const pnlColor = m.netPnL > 0 ? C.green : m.netPnL < 0 ? C.red : C.text2;
    return (
      <tr key={k}>
        <td style={{ padding: "8px 6px", fontSize: FONT.sm, color: C.text1, borderBottom: `1px solid ${C.border}40` }}>{k}</td>
        <td style={{ padding: "8px 6px", fontSize: FONT.sm, color: C.text1, textAlign: "right", borderBottom: `1px solid ${C.border}40` }}>{fmtInt(m.trades)}</td>
        <td style={{ padding: "8px 6px", fontSize: FONT.sm, color: C.text1, textAlign: "right", borderBottom: `1px solid ${C.border}40` }}>{fmtPct(m.winRate)}</td>
        <td style={{ padding: "8px 6px", fontSize: FONT.sm, color: C.text1, textAlign: "right", borderBottom: `1px solid ${C.border}40` }}>{fmtNum(m.sharpe, 2)}</td>
        <td style={{ padding: "8px 6px", fontSize: FONT.sm, textAlign: "right", color: pnlColor, fontWeight: 600, borderBottom: `1px solid ${C.border}40` }}>
          {m.netPnL > 0 ? "+" : ""}{fmtNum(m.netPnL, 2)}%
        </td>
      </tr>
    );
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 }}>
      {symRows.length > 0 && (
        <Card>
          <div style={{ fontSize: FONT.lg, fontWeight: 700, color: C.text1, marginBottom: 8 }}>종목별 성과 (안정성 TOP 8)</div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: "6px", fontSize: FONT.xs, color: C.text3 }}>종목</th>
                <th style={{ textAlign: "right", padding: "6px", fontSize: FONT.xs, color: C.text3 }}>거래</th>
                <th style={{ textAlign: "right", padding: "6px", fontSize: FONT.xs, color: C.text3 }}>승률</th>
                <th style={{ textAlign: "right", padding: "6px", fontSize: FONT.xs, color: C.text3 }} title={METRIC_TOOLTIP.sharpe}>안정성</th>
                <th style={{ textAlign: "right", padding: "6px", fontSize: FONT.xs, color: C.text3 }}>수익률</th>
              </tr>
            </thead>
            <tbody>{symRows.map(([k, m]) => renderRow(k, m))}</tbody>
          </table>
        </Card>
      )}
      {tfRows.length > 0 && (
        <Card>
          <div style={{ fontSize: FONT.lg, fontWeight: 700, color: C.text1, marginBottom: 8 }}>시간대별 성과</div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: "6px", fontSize: FONT.xs, color: C.text3 }}>시간대</th>
                <th style={{ textAlign: "right", padding: "6px", fontSize: FONT.xs, color: C.text3 }}>거래</th>
                <th style={{ textAlign: "right", padding: "6px", fontSize: FONT.xs, color: C.text3 }}>승률</th>
                <th style={{ textAlign: "right", padding: "6px", fontSize: FONT.xs, color: C.text3 }} title={METRIC_TOOLTIP.sharpe}>안정성</th>
                <th style={{ textAlign: "right", padding: "6px", fontSize: FONT.xs, color: C.text3 }}>수익률</th>
              </tr>
            </thead>
            <tbody>{tfRows.map(([k, m]) => renderRow(k, m))}</tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────
// 새 후보 strategy 패널
// ────────────────────────────────────────────────
function CandidatesPanel({ data }) {
  const C = useThemeTokens();
  const candidates = data?.candidates || [];

  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ fontSize: FONT.lg, fontWeight: 700, color: C.text1 }}>새로 발굴 중인 전략 후보</div>
        <Badge kind="info">{candidates.length}건 관찰중</Badge>
      </div>
      <div style={{ fontSize: FONT.xs, color: C.text3, marginBottom: 8, lineHeight: 1.5 }}>
        백테스트 엔진이 새 변형을 시뮬레이션해 후보를 찾습니다. 아래 수치는 <b style={{ color: C.text2 }}>단일 종목 관찰치</b>로,
        실제보다 부풀려질 수 있습니다(과적합). <b style={{ color: C.text2 }}>여러 종목 + 미학습 구간(OOS) 교차검증을 통과한 것만</b> 실거래에 반영됩니다.
      </div>
      {candidates.length === 0 ? (
        <div style={{ fontSize: FONT.sm, color: C.text3, padding: "16px 0", textAlign: "center" }}>
          현재 관찰중인 후보가 없습니다 — 2시간마다 자동 발굴됩니다.
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 8 }}>
          {[...candidates]
            .sort((a, b) => (b.backtestResult?.sharpe || 0) - (a.backtestResult?.sharpe || 0))
            .slice(0, 12).map((c) => {
            const br = c.backtestResult || {};
            const g = sharpeToGrade(br.sharpe);
            const sym = (c.symbol || "").replace("USDT", "");
            const sharpeColor = (br.sharpe || 0) >= 1.5 ? C.green : (br.sharpe || 0) <= 0 ? C.red : C.text1;
            return (
              <div key={c.id} style={{
                padding: 12,
                background: C.card2,
                borderRadius: RADIUS.sm,
                border: `1px solid ${C.border}`,
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 6 }}>
                  <div style={{ minWidth: 0 }}>
                    <span style={{ fontSize: FONT.sm, fontWeight: 700, color: C.text1 }}>{strategyLabel(c.parentStrategy)}</span>
                    {sym && <span style={{ fontSize: FONT.xs, color: C.text3, marginLeft: 6 }}>{sym}</span>}
                  </div>
                  <span style={{ fontSize: FONT.xs, color: C.text3, whiteSpace: "nowrap" }}>{fmtAgo(c.createdAt)}</span>
                </div>
                {/* 핵심 지표 — 단일심볼 관찰치(교차검증 전이라 과적합 가능, 라벨 명시) */}
                <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 6 }}>
                  <span style={{ fontSize: 18, fontWeight: 800, color: sharpeColor }}>{g.grade}</span>
                  <span style={{ fontSize: FONT.xs, color: C.text3 }}>단일심볼 {fmtNum(br.sharpe, 2)}</span>
                  <span style={{ fontSize: 10, color: C.text3, border: `1px solid ${C.border}`, borderRadius: 4, padding: "1px 5px" }}>교차검증 전</span>
                </div>
                <div style={{ display: "flex", gap: 10, marginTop: 6, flexWrap: "wrap", fontSize: FONT.xs, color: C.text2 }}>
                  <span>승률 <b style={{ color: C.text1 }}>{fmtPct(br.winRate)}</b></span>
                  <span>손익비 <b style={{ color: C.text1 }}>{br.profitFactor == null ? "—" : fmtNum(br.profitFactor, 2)}</b></span>
                  <span>거래 <b style={{ color: C.text1 }}>{br.trades}</b></span>
                </div>
                <details style={{ marginTop: 8 }}>
                  <summary style={{ fontSize: FONT.xs, color: C.text3, cursor: "pointer" }}>상세 파라미터 보기</summary>
                  <pre style={{ fontSize: FONT.xs, color: C.text2, margin: "4px 0 0", whiteSpace: "pre-wrap" }}>
                    {JSON.stringify(c.params || {}, null, 0)}
                  </pre>
                </details>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

// ────────────────────────────────────────────────
// Public Mode — 비로그인 사용자용 카드 (PLAN-BIZ #1)
// "오늘 잘 작동하는 알파 TOP 3" + 가입 CTA
// 회원만 보는 절대 수치는 가리고, 1줄 설명 + 30일 수익률만 노출
// ────────────────────────────────────────────────
function PublicAlphaShowcase({ data, onSignup }) {
  const C = useThemeTokens();
  const strategies = data?.leaderboard?.strategies || {};
  const top3 = useMemo(() => {
    return Object.entries(strategies)
      .filter(([id]) => isValidStrategyId(id)) // G-1 hotfix — raw ID 만 숨기고 나머지는 fallback 라벨
      .sort((a, b) => (b[1].sharpe || 0) - (a[1].sharpe || 0))
      .slice(0, 3)
      .map(([id, m]) => ({ id, ...m }));
  }, [strategies]);

  // 30일 PnL 추정 — historyTail 마지막값과 24시간 전 비교
  const hist = data?.historyTail || [];
  const periodPnL = (sid) => {
    if (hist.length < 2) return null;
    const head = hist[0]?.strategies?.[sid]?.netPnL;
    const tail = hist[hist.length - 1]?.strategies?.[sid]?.netPnL;
    if (typeof head !== "number" || typeof tail !== "number") return null;
    return tail - head;
  };

  return (
    <Card>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: FONT.lg, fontWeight: 800, color: C.text1 }}>오늘 가장 잘 작동하는 알파 TOP 3</div>
        <div style={{ fontSize: FONT.xs, color: C.text3, marginTop: 4 }}>
          Zepta 의 AI 가 매시간 백테스트와 실시간 성과를 평가해 가장 안정적인 전략을 선정합니다.
        </div>
      </div>
      {top3.length === 0 ? (
        <div style={{ fontSize: FONT.sm, color: C.text3, padding: "16px 0", textAlign: "center" }}>
          데이터를 모으는 중입니다.
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
          {top3.map((s, idx) => {
            const grade = sharpeToGrade(s.sharpe);
            const recent = periodPnL(s.id);
            const recentColor = recent == null ? C.text3 : recent > 0 ? C.green : recent < 0 ? C.red : C.text2;
            return (
              <div key={s.id} style={{
                padding: 14,
                background: C.card2,
                borderRadius: RADIUS.md,
                border: `1px solid ${C.border}`,
                display: "flex", flexDirection: "column", gap: 8,
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: FONT.xs, color: C.text3, fontWeight: 600 }}>#{idx + 1}</span>
                  <Badge kind={grade.color}>{grade.label}</Badge>
                </div>
                <div style={{ fontSize: FONT.lg, fontWeight: 700, color: C.text1 }}>{strategyLabel(s.id)}</div>
                <div style={{ fontSize: FONT.xs, color: C.text2, lineHeight: 1.5 }}>
                  {s.id === "trend-follow" && "한 방향으로 흐름이 잡혔을 때 따라가는 전략"}
                  {s.id === "mean-revert" && "박스권에서 과도하게 빠질 때 반등을 노리는 전략"}
                  {s.id === "breakout" && "주요 저항선 돌파 시점에 진입하는 전략"}
                  {s.id === "momentum-rotation" && "최근 강세 종목으로 자동 로테이션"}
                  {s.id === "volatility-arb" && "변동성 차이를 이용한 차익 전략"}
                  {s.id === "hurst-trend" && "추세 강도가 강한 구간만 골라 매매"}
                  {s.id === "defi-momentum" && "DeFi 토큰의 모멘텀 추종"}
                  {s.id === "ensemble" && "여러 전략의 합의된 시그널만 채택"}
                  {!["trend-follow","mean-revert","breakout","momentum-rotation","volatility-arb","hurst-trend","defi-momentum","ensemble"].includes(s.id) && "AI 가 시장 흐름에 맞게 자동 운영"}
                </div>
                <div style={{ fontSize: FONT.xs, color: C.text3 }}>
                  최근 추이: <span style={{ color: recentColor, fontWeight: 600 }}>
                    {recent == null ? "측정 중" : `${recent > 0 ? "+" : ""}${fmtNum(recent, 1)}%p`}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <div style={{
        marginTop: 16, padding: 14,
        background: C.blueBg, borderRadius: RADIUS.md,
        display: "flex", flexDirection: "column", gap: 8, alignItems: "center",
      }}>
        <div style={{ fontSize: FONT.sm, color: C.text1, fontWeight: 600 }}>
          상세 수치 · 실시간 시그널 · 안정성 추이는 가입 후 확인할 수 있어요
        </div>
        <button onClick={onSignup} style={{
          padding: "10px 24px",
          background: C.blue, color: "#fff",
          border: "none", borderRadius: RADIUS.full,
          fontSize: FONT.sm, fontWeight: 700, cursor: "pointer",
        }}>
          무료로 가입하고 전체 보기
        </button>
        <div style={{ fontSize: FONT.xs, color: C.text3, textAlign: "center" }}>
          가입은 30초 · 신용카드 불필요
        </div>
      </div>
    </Card>
  );
}

// ────────────────────────────────────────────────
// 메인 페이지
// ────────────────────────────────────────────────
// ────────────────────────────────────────────────
// 발굴 → 실거래 반영 현황 배너 (2026-05-29)
// 알파랩이 발굴한 우수 전략의 튜닝 파라미터가 실제 자동매매에 적용된 상태를
// 한눈에 보여준다. di:alpha:params 에 적재된(=tunedAt 있는) 전략만 집계.
// ────────────────────────────────────────────────
function LiveTuningBanner({ data }) {
  const C = useThemeTokens();
  const params = data?.params || {};
  const tuned = useMemo(() => {
    return Object.entries(params)
      .filter(([id, p]) => p && p.tunedAt && isValidStrategyId(id))
      .map(([id, p]) => ({ id, name: strategyLabel(id), sharpe: p.sharpe ?? null, tunedAt: p.tunedAt }))
      .sort((a, b) => (b.sharpe || 0) - (a.sharpe || 0));
  }, [params]);

  if (tuned.length === 0) return null;

  return (
    <Card style={{ position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: C.green }} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <div style={{ fontSize: FONT.lg, fontWeight: 800, color: C.text1 }}>🧬 발굴 전략 실거래 반영중</div>
        <Badge kind="active">{tuned.length}개 적용</Badge>
      </div>
      <div style={{ fontSize: FONT.xs, color: C.text2, marginBottom: 10, lineHeight: 1.55 }}>
        알파랩이 발굴·검증한 우수 전략의 최적 파라미터가 자동매매 신호에 적용돼 있습니다.
        2시간마다 더 나은 전략이 나오면 자동으로 교체됩니다.
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {tuned.map((t) => {
          const grade = sharpeToGrade(t.sharpe);
          return (
            <div key={t.id} style={{
              display: "flex", alignItems: "center", gap: 8,
              background: C.card, border: `1px solid ${C.border}`,
              borderRadius: RADIUS.full, padding: "5px 12px",
            }}>
              <span style={{ fontSize: FONT.sm, fontWeight: 700, color: C.text1 }}>{t.name}</span>
              <span style={{ fontSize: FONT.xs, fontWeight: 700, color: C.green }}>
                {grade.grade}{t.sharpe != null && <span style={{ color: C.text3, fontWeight: 500 }}> · {fmtNum(t.sharpe, 1)}</span>}
              </span>
              <span style={{ fontSize: FONT.xs, color: C.text3 }}>{fmtAgo(t.tunedAt)}</span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

export default function AlphaLab({ onRequestLogin }) {
  const C = useThemeTokens();
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
    const title = isPublic
      ? "Alpha Lab — 오늘 가장 잘 작동하는 AI 매매 전략 TOP 3 | Zepta"
      : "Alpha Lab — 24/7 알파 추적 대시보드 | Zepta";
    const desc = isPublic
      ? "Zepta AI 가 매시간 평가한 최상위 매매 전략을 무료로 확인하세요. 시장 흐름에 맞춰 자동 조정되는 8가지 전략을 한눈에."
      : "시장 레짐, 전략별 안정성 등급, 손익비, 최대 낙폭까지. 실시간 매매 신호 모니터링.";
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
  }, [isPublic]);

  const fetchData = async () => {
    try {
      const r = await fetch("/api/agents/alpha-status", { credentials: "same-origin" });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "응답 실패");
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
    const t = setInterval(fetchData, REFRESH_MS);
    return () => clearInterval(t);
  }, []);

  if (loading && !data) {
    // 2026-05-12 — Skeleton 표준화 (LoadingBlock)
    return (
      <div style={{ padding: "14px 14px", maxWidth: 1200, margin: "0 auto" }}>
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: FONT["2xl"], fontWeight: 800, color: C.text1, letterSpacing: "-0.02em" }}>알파 랩</div>
          <div style={{ fontSize: FONT.sm, color: C.text3, marginTop: 4 }}>검증된 33개 전략을 한 자리에서 비교하세요</div>
        </div>
        <LoadingBlock rows={4} height={84} label="알파 데이터 불러오는 중…" />
      </div>
    );
  }

  // ── 비로그인 view (Public Mode) ──────────────────
  if (isPublic) {
    return (
      <div style={{ padding: "14px 14px", display: "flex", flexDirection: "column", gap: 14, maxWidth: 1200, margin: "0 auto" }}>
        <div>
          <div style={{ fontSize: FONT["2xl"], fontWeight: 800, color: C.text1, letterSpacing: "-0.02em" }}>알파 랩</div>
          <div style={{ fontSize: FONT.sm, color: C.text3, marginTop: 4, lineHeight: 1.55 }}>
            33개 매매 전략을 24시간 검증합니다. 가장 잘 작동하는 알파를 자동으로 골라냅니다.
          </div>
        </div>

        <PublicAlphaShowcase data={data} onSignup={() => {
          ga.ctaClick("alpha-lab-public", "signup");
          if (typeof onRequestLogin === "function") onRequestLogin();
        }} />

        {/* 회원만 보는 정보는 숨김 — 단, "이런 것도 볼 수 있어요" preview 카드 */}
        <Card>
          <div style={{ fontSize: FONT.lg, fontWeight: 700, color: C.text1, marginBottom: 8 }}>회원만 볼 수 있는 정보</div>
          <ul style={{ margin: 0, padding: "0 0 0 20px", color: C.text2, fontSize: FONT.sm, lineHeight: 1.8 }}>
            <li>전체 8개 전략의 실시간 안정성 등급과 손익비</li>
            <li>최근 24시간 안정성 추이 그래프</li>
            <li>종목별 · 시간대별 세부 성과</li>
            <li>새로 발굴 중인 전략 후보 12개와 백테스트 결과</li>
            <li>전략별 매매 신호 즉시 알림 (텔레그램)</li>
          </ul>
        </Card>

        <div style={{ fontSize: FONT.xs, color: C.text3, textAlign: "center", padding: "8px 16px", lineHeight: 1.5 }}>
          ⚠ Zepta 는 분석 도구입니다. 표시되는 수치는 과거 시뮬레이션 결과이며 미래 수익을 보장하지 않습니다.<br/>
          매매 결정과 손익은 본인 책임입니다 — 투자 권유가 아닙니다.
        </div>
      </div>
    );
  }

  // ── 로그인 view (전체 정보) ──────────────────
  return (
    <div style={{ padding: "14px 14px", display: "flex", flexDirection: "column", gap: 14, maxWidth: 1200, margin: "0 auto" }}>
      <div>
        <div style={{ fontSize: FONT["2xl"], fontWeight: 800, color: C.text1, letterSpacing: "-0.02em" }}>알파 랩</div>
        <div style={{ fontSize: FONT.sm, color: C.text3, marginTop: 4, lineHeight: 1.55 }}>
          24시간 매매 전략 추적 · 자동 튜닝 · 시장 흐름에 맞춰 가중치 자동 조정.
          {lastFetched && <> · 마지막 갱신 {lastFetched.toLocaleTimeString("ko-KR", { hour12: false })}</>}
        </div>
        {error && (
          <div style={{ marginTop: 8, padding: 10, background: C.redBg, color: C.red, borderRadius: RADIUS.sm, fontSize: FONT.sm }}>
            오류: {error}
          </div>
        )}
      </div>

      <LiveTuningBanner data={data} />
      <RegimePanel data={data} />
      <LeaderboardTable data={data} />
      <SharpeHistoryChart data={data} />
      <SymbolTimeframePanel data={data} />
      <CandidatesPanel data={data} />

      <div style={{ fontSize: FONT.xs, color: C.text3, textAlign: "center", padding: "16px 0", lineHeight: 1.6 }}>
        매시 정각 순위 갱신 · 새 전략 발굴 2시간 주기 · 파라미터 튜닝 3시간 주기 · 우수 전략은 자동매매에 자동 반영 (KST)<br/>
        ⚠ Zepta 는 분석 도구입니다. 매매 결정과 손익은 본인 책임이며, 표시되는 수치는 미래 수익을 보장하지 않습니다.
      </div>
    </div>
  );
}
