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
// ══════════════════════════════════════════════════════════════════
import React, { useEffect, useMemo, useState } from "react";
import { useThemeTokens, FONT, RADIUS } from "./ui/theme.jsx";

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

function Stat({ label, value, sub, color }) {
  const C = useThemeTokens();
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: FONT.xs, color: C.text3 }}>{label}</div>
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
        <div style={{ fontSize: FONT.lg, fontWeight: 700, color: C.text1 }}>시장 레짐 & 전략 가중치</div>
        <span style={{ fontSize: FONT.xs, color: C.text3 }}>{updatedAt ? fmtAgo(updatedAt) + " 갱신" : "데이터 없음"}</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginBottom: 16 }}>
        <Stat
          label="시장 성격"
          value={REGIME_LABEL[regimeKey]?.label || regimeKey}
          sub={REGIME_LABEL[regimeKey]?.desc}
          color={regimeKey === "trending" ? C.green : regimeKey === "mean_reverting" ? C.purple : C.text1}
        />
        <Stat
          label="Hurst 지수"
          value={fmtNum(regime?.hurst, 3)}
          sub={regime?.hurst > 0.55 ? "추세 지속성 강함" : regime?.hurst < 0.45 ? "회귀 성격" : "랜덤워크"}
        />
        <Stat
          label="변동성 레짐"
          value={VOL_LABEL[volKey] || volKey}
          sub={`ATR 비율 ${fmtNum(regime?.atrRatio, 2)}x`}
          color={volKey === "vol_explosive" ? C.red : volKey === "vol_compressed" ? C.blue : C.text1}
        />
        <Stat label="BTC" value={regime?.btcPrice ? `$${fmtInt(regime.btcPrice)}` : "—"} />
      </div>
      <div style={{ fontSize: FONT.sm, color: C.text2, marginBottom: 8 }}>현재 strategy 가중치 (시그널 score 에 곱해짐):</div>
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
              <span style={{ fontSize: FONT.xs, color: C.text2 }}>{STRATEGY_KO[k] || k}</span>
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
  const strategies = data?.leaderboard?.strategies || {};
  const statuses = data?.statuses || {};
  const params = data?.params || {};

  const rows = useMemo(() => {
    return Object.entries(strategies).map(([id, m]) => {
      const statusObj = statuses[id];
      const status = (statusObj?.status) || "active";
      return {
        id,
        name: STRATEGY_KO[id] || id,
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
      };
    }).sort((a, b) => b.sharpe - a.sharpe);
  }, [strategies, statuses, params]);

  if (rows.length === 0) {
    return (
      <Card>
        <div style={{ fontSize: FONT.lg, fontWeight: 700, color: C.text1, marginBottom: 8 }}>Strategy Leaderboard</div>
        <div style={{ fontSize: FONT.sm, color: C.text3, padding: "24px 0", textAlign: "center" }}>
          데이터 누적 중입니다 — alpha-lab cron 이 매시 정각마다 실행됩니다.
        </div>
      </Card>
    );
  }

  const thStyle = { textAlign: "left", padding: "8px 6px", fontSize: FONT.xs, color: C.text3, fontWeight: 600, borderBottom: `1px solid ${C.border}` };
  const tdStyle = { padding: "10px 6px", fontSize: FONT.sm, color: C.text1, borderBottom: `1px solid ${C.border}40` };

  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ fontSize: FONT.lg, fontWeight: 700, color: C.text1 }}>Strategy Leaderboard</div>
        <span style={{ fontSize: FONT.xs, color: C.text3 }}>{data?.generatedAt ? fmtAgo(data.generatedAt) + " 갱신" : ""}</span>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
          <thead>
            <tr>
              <th style={thStyle}>전략</th>
              <th style={thStyle}>상태</th>
              <th style={{ ...thStyle, textAlign: "right" }}>거래수</th>
              <th style={{ ...thStyle, textAlign: "right" }}>승률</th>
              <th style={{ ...thStyle, textAlign: "right" }}>Sharpe</th>
              <th style={{ ...thStyle, textAlign: "right" }}>PF</th>
              <th style={{ ...thStyle, textAlign: "right" }}>누적 PnL</th>
              <th style={{ ...thStyle, textAlign: "right" }}>MDD</th>
              <th style={{ ...thStyle, textAlign: "right" }}>평균 보유</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const statusInfo = STATUS_LABEL[r.status] || STATUS_LABEL.active;
              const pnlColor = r.netPnL > 0 ? C.green : r.netPnL < 0 ? C.red : C.text2;
              const sharpeColor = r.sharpe >= 1.5 ? C.green : r.sharpe <= 0 ? C.red : C.text1;
              return (
                <tr key={r.id}>
                  <td style={tdStyle}>
                    <div style={{ fontWeight: 600 }}>{r.name}</div>
                    <div style={{ fontSize: FONT.xs, color: C.text3 }}>{r.id}</div>
                    {r.tunedAt && (
                      <div style={{ fontSize: FONT.xs, color: C.text3 }}>파라미터 튜닝 {fmtAgo(r.tunedAt)}</div>
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
                  <td style={{ ...tdStyle, textAlign: "right" }}>{fmtPct(r.winRate)}</td>
                  <td style={{ ...tdStyle, textAlign: "right", color: sharpeColor, fontWeight: 700 }}>{fmtNum(r.sharpe, 2)}</td>
                  <td style={{ ...tdStyle, textAlign: "right" }}>{r.pf == null ? "—" : fmtNum(r.pf, 2)}</td>
                  <td style={{ ...tdStyle, textAlign: "right", color: pnlColor, fontWeight: 600 }}>
                    {r.netPnL > 0 ? "+" : ""}{fmtNum(r.netPnL, 2)}%
                  </td>
                  <td style={{ ...tdStyle, textAlign: "right" }}>{fmtPct(r.maxDD)}</td>
                  <td style={{ ...tdStyle, textAlign: "right" }}>{fmtNum(r.avgHold, 1)}h</td>
                </tr>
              );
            })}
          </tbody>
        </table>
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
      .sort((a, b) => (b[1].sharpe || 0) - (a[1].sharpe || 0))
      .slice(0, 4)
      .map(([k]) => k);
  }, [strategies]);

  if (hist.length < 2 || top4.length === 0) {
    return (
      <Card>
        <div style={{ fontSize: FONT.lg, fontWeight: 700, color: C.text1, marginBottom: 8 }}>Sharpe 시계열 (24시간)</div>
        <div style={{ fontSize: FONT.sm, color: C.text3, padding: "24px 0", textAlign: "center" }}>
          데이터 부족 — 시계열은 매시간 누적됩니다. 24시간 이상 운영 후 표시됩니다.
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
        <div style={{ fontSize: FONT.lg, fontWeight: 700, color: C.text1 }}>Sharpe 시계열 (최근 {hist.length}h)</div>
      </div>
      <div style={{ overflowX: "auto" }}>
        <svg width={W} height={H} style={{ display: "block" }}>
          <line x1={P} y1={zeroY} x2={W - P} y2={zeroY} stroke={C.border} strokeDasharray="3 3" />
          {series.map((s, idx) => {
            const d = s.points.map((p, i) => `${i === 0 ? "M" : "L"} ${P + p.i * xStep} ${yMap(p.v)}`).join(" ");
            return <path key={s.sid} d={d} stroke={colors[idx]} strokeWidth={2} fill="none" />;
          })}
        </svg>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 8 }}>
        {series.map((s, idx) => (
          <div key={s.sid} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: FONT.xs, color: C.text2 }}>
            <span style={{ width: 10, height: 3, background: colors[idx] }} />
            {STRATEGY_KO[s.sid] || s.sid}
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
          <div style={{ fontSize: FONT.lg, fontWeight: 700, color: C.text1, marginBottom: 8 }}>종목별 (TOP 8 Sharpe)</div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: "6px", fontSize: FONT.xs, color: C.text3 }}>종목</th>
                <th style={{ textAlign: "right", padding: "6px", fontSize: FONT.xs, color: C.text3 }}>거래</th>
                <th style={{ textAlign: "right", padding: "6px", fontSize: FONT.xs, color: C.text3 }}>승률</th>
                <th style={{ textAlign: "right", padding: "6px", fontSize: FONT.xs, color: C.text3 }}>Sharpe</th>
                <th style={{ textAlign: "right", padding: "6px", fontSize: FONT.xs, color: C.text3 }}>PnL</th>
              </tr>
            </thead>
            <tbody>{symRows.map(([k, m]) => renderRow(k, m))}</tbody>
          </table>
        </Card>
      )}
      {tfRows.length > 0 && (
        <Card>
          <div style={{ fontSize: FONT.lg, fontWeight: 700, color: C.text1, marginBottom: 8 }}>타임프레임별</div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: "6px", fontSize: FONT.xs, color: C.text3 }}>TF</th>
                <th style={{ textAlign: "right", padding: "6px", fontSize: FONT.xs, color: C.text3 }}>거래</th>
                <th style={{ textAlign: "right", padding: "6px", fontSize: FONT.xs, color: C.text3 }}>승률</th>
                <th style={{ textAlign: "right", padding: "6px", fontSize: FONT.xs, color: C.text3 }}>Sharpe</th>
                <th style={{ textAlign: "right", padding: "6px", fontSize: FONT.xs, color: C.text3 }}>PnL</th>
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
        <div style={{ fontSize: FONT.lg, fontWeight: 700, color: C.text1 }}>새 후보 전략 (Continuous Backtest)</div>
        <Badge kind="info">{candidates.length}건 관찰중</Badge>
      </div>
      {candidates.length === 0 ? (
        <div style={{ fontSize: FONT.sm, color: C.text3, padding: "16px 0", textAlign: "center" }}>
          관찰중인 후보 없음 — 매일 KST 16:00 에 자동 발굴됩니다.
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 8 }}>
          {candidates.slice(0, 12).map((c) => (
            <div key={c.id} style={{
              padding: 10,
              background: C.card2,
              borderRadius: RADIUS.sm,
              border: `1px solid ${C.border}`,
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: FONT.sm, fontWeight: 600, color: C.text1 }}>{STRATEGY_KO[c.parentStrategy] || c.parentStrategy} 변형</span>
                <span style={{ fontSize: FONT.xs, color: C.text3 }}>{fmtAgo(c.createdAt)}</span>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
                <Badge kind="info">Sharpe {fmtNum(c.backtestResult?.sharpe, 2)}</Badge>
                <Badge>거래 {c.backtestResult?.trades}</Badge>
                <Badge>승률 {fmtPct(c.backtestResult?.winRate)}</Badge>
              </div>
              <details style={{ marginTop: 6 }}>
                <summary style={{ fontSize: FONT.xs, color: C.text3, cursor: "pointer" }}>파라미터</summary>
                <pre style={{ fontSize: FONT.xs, color: C.text2, margin: "4px 0 0", whiteSpace: "pre-wrap" }}>
                  {JSON.stringify(c.params || {}, null, 0)}
                </pre>
              </details>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ────────────────────────────────────────────────
// 메인 페이지
// ────────────────────────────────────────────────
export default function AlphaLab() {
  const C = useThemeTokens();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastFetched, setLastFetched] = useState(null);

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
    return (
      <div style={{ padding: 24, color: C.text2, fontSize: FONT.sm }}>Alpha Lab 데이터 불러오는 중…</div>
    );
  }

  return (
    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 16, maxWidth: 1200, margin: "0 auto" }}>
      <div>
        <div style={{ fontSize: FONT["2xl"], fontWeight: 800, color: C.text1 }}>Alpha Lab</div>
        <div style={{ fontSize: FONT.sm, color: C.text3, marginTop: 4 }}>
          24/7 알파 추적 + 자동 파라미터 튜닝 + 시장 레짐 기반 가중치 조정.
          {lastFetched && <> · 마지막 갱신 {lastFetched.toLocaleTimeString("ko-KR", { hour12: false })}</>}
        </div>
        {error && (
          <div style={{ marginTop: 8, padding: 10, background: C.redBg, color: C.red, borderRadius: RADIUS.sm, fontSize: FONT.sm }}>
            오류: {error}
          </div>
        )}
      </div>

      <RegimePanel data={data} />
      <LeaderboardTable data={data} />
      <SharpeHistoryChart data={data} />
      <SymbolTimeframePanel data={data} />
      <CandidatesPanel data={data} />

      <div style={{ fontSize: FONT.xs, color: C.text3, textAlign: "center", padding: "16px 0" }}>
        Alpha Lab cron 매시 정각 갱신 · Parameter Tuner 6시간마다 · Auto Promote 매일 KST 15:30 · Continuous Backtest 매일 KST 16:00
      </div>
    </div>
  );
}
