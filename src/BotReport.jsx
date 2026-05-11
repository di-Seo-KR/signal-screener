// ══════════════════════════════════════════════════════════════════
// Zepta — Bot Report 페이지
// ──────────────────────────────────────────────────────────────────
// /reports             → 전체 봇 목록
// /reports/<bot-id>    → 개별 봇 상세 리포트
//
// 표시:
//   - 누적 메트릭 (수익률, 안정성, 승률, PF, MDD, 거래수, 평균 보유, 실현 손익)
//   - 최근 30일 equity curve (인라인 SVG)
//   - 최근 거래 10건
//   - 봇 메타 (kind/family/자산 universe)
//
// API: GET /api/bot-report?botId=<id>  (없으면 목록)
// 비로그인 사용자도 접근 가능 (SEO).
// ══════════════════════════════════════════════════════════════════
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useThemeTokens, FONT, RADIUS, pickFont } from "./ui/theme.jsx";
import { useBreakpoint } from "./ui/useBreakpoint.jsx";

const BOT_NAME_KO = {
  "btc-alpha":        "BTC 알파",
  "highcap-momentum": "대형코인 모멘텀",
  "defi-infra":       "DeFi 인프라",
  "meme-trend":       "밈코인 트렌드",
  "l2-emerging":      "L2 신흥",
  "crypto-diversity": "크립토 분산",
  "crypto-swing":     "크립토 스윙",
  "stable-quant":     "안정형 퀀트",
  "balanced-quant":   "균형형 퀀트",
  "aggressive-quant": "공격형 퀀트",
  "trend-follow":     "추세 추종",
  "mean-reversion":   "평균 회귀",
  "ensemble-signal":  "앙상블 시그널",
};
const FAMILY_KO = {
  "trend-follow":      "추세 추종",
  "mean-revert":       "평균 회귀",
  "breakout":          "돌파 매매",
  "momentum-rotation": "모멘텀 로테이션",
  "volatility-arb":    "변동성 차익",
  "hurst-trend":       "허스트 추세",
  "defi-momentum":     "DeFi 모멘텀",
  "ensemble":          "앙상블",
};

// ── 헬퍼 ──────────────────────────────────────────────────────────
const fmtPct = (v, d = 1) => (v == null || !isFinite(v)) ? "—" : `${Number(v) >= 0 ? "+" : ""}${Number(v).toFixed(d)}%`;
const fmtNum = (v, d = 2) => (v == null || !isFinite(v)) ? "—" : Number(v).toFixed(d);
const fmtInt = (v) => (v == null || !isFinite(v)) ? "—" : Math.round(v).toLocaleString();
const fmtMoney = (v) => (v == null || !isFinite(v)) ? "—" : `$${Math.round(Number(v)).toLocaleString()}`;
const fmtDate = (s) => {
  if (!s) return "—";
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return "—";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
};

// ── UI helper ─────────────────────────────────────────────────────
function Card({ children, style, ...rest }) {
  const C = useThemeTokens();
  return (
    <div
      style={{
        background: C.card, border: `1px solid ${C.border}`,
        borderRadius: RADIUS.lg, padding: 16,
        boxShadow: C.cardShadow, ...style,
      }}
      {...rest}
    >{children}</div>
  );
}

function Stat({ label, value, sub, color }) {
  const C = useThemeTokens();
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: FONT.xs, color: C.text3 }}>{label}</div>
      <div style={{ fontSize: FONT.xl, fontWeight: 700, color: color || C.text1, marginTop: 2, whiteSpace: "nowrap" }}>{value}</div>
      {sub && <div style={{ fontSize: FONT.xs, color: C.text3, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

// ── Equity curve SVG ──────────────────────────────────────────────
function EquityCurveSVG({ curve }) {
  const C = useThemeTokens();
  if (!curve || curve.length < 2) {
    return (
      <div style={{ height: 200, display: "flex", alignItems: "center", justifyContent: "center", color: C.text3, fontSize: FONT.sm }}>
        에쿼티 데이터가 아직 부족해요. (최소 2영업일 필요)
      </div>
    );
  }
  const W = 720, H = 200, PAD_L = 50, PAD_R = 16, PAD_T = 16, PAD_B = 28;
  const xs = curve.map((_, i) => PAD_L + (i / (curve.length - 1)) * (W - PAD_L - PAD_R));
  const values = curve.map((p) => p.equityPct);
  const minV = Math.min(...values, 100);
  const maxV = Math.max(...values, 100);
  const range = Math.max(0.01, maxV - minV);
  const ys = values.map((v) => PAD_T + (1 - (v - minV) / range) * (H - PAD_T - PAD_B));
  const path = xs.map((x, i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)},${ys[i].toFixed(2)}`).join(" ");
  // baseline 100%
  const yBase = PAD_T + (1 - (100 - minV) / range) * (H - PAD_T - PAD_B);
  const lastV = values[values.length - 1];
  const stroke = lastV >= 100 ? C.green : C.red;
  const fill = lastV >= 100 ? `${C.green}22` : `${C.red}22`;
  const areaPath = `${path} L${xs[xs.length - 1].toFixed(2)},${(H - PAD_B).toFixed(2)} L${xs[0].toFixed(2)},${(H - PAD_B).toFixed(2)} Z`;

  // y축 라벨 (min/base/max)
  const yLabels = [
    { v: maxV, y: PAD_T },
    { v: 100, y: yBase },
    { v: minV, y: H - PAD_B },
  ];

  return (
    <div style={{ overflowX: "auto" }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" style={{ minWidth: 360 }}>
        {/* baseline */}
        <line x1={PAD_L} x2={W - PAD_R} y1={yBase} y2={yBase} stroke={C.text3} strokeDasharray="4,4" strokeWidth="1" opacity="0.5" />
        {/* area */}
        <path d={areaPath} fill={fill} />
        {/* line */}
        <path d={path} fill="none" stroke={stroke} strokeWidth="2" />
        {/* y labels */}
        {yLabels.map((l, i) => (
          <text key={i} x={PAD_L - 6} y={l.y + 4} fontSize="10" fill={C.text3} textAnchor="end">
            {l.v.toFixed(1)}%
          </text>
        ))}
        {/* x labels (first / last) */}
        <text x={xs[0]} y={H - 8} fontSize="10" fill={C.text3} textAnchor="start">{curve[0].date}</text>
        <text x={xs[xs.length - 1]} y={H - 8} fontSize="10" fill={C.text3} textAnchor="end">{curve[curve.length - 1].date}</text>
      </svg>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// 메인 컴포넌트
// ══════════════════════════════════════════════════════════════════
export default function BotReport({ botId: propBotId, onNavigate } = {}) {
  // path 에서 botId 추출 (props 가 우선)
  const pathBotId = useMemo(() => {
    if (propBotId) return propBotId;
    if (typeof window === "undefined") return null;
    const m = window.location.pathname.match(/^\/reports\/([a-zA-Z0-9_-]+)\/?$/);
    return m ? m[1] : null;
  }, [propBotId]);

  if (pathBotId) {
    return <BotReportDetail botId={pathBotId} onNavigate={onNavigate} />;
  }
  return <BotReportList onNavigate={onNavigate} />;
}

// ── 봇 목록 페이지 ───────────────────────────────────────────────
function BotReportList({ onNavigate }) {
  const C = useThemeTokens();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/bot-report");
        const json = await res.json();
        setData(json);
      } catch (e) {
        setErr(e?.message || String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const bots = data?.bots || [];
  const crypto = bots.filter((b) => b.kind === "crypto");
  const stock = bots.filter((b) => b.kind === "stock");

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
      <div>
        <h1 style={{ fontSize: FONT["2xl"], fontWeight: 800, color: C.text1, margin: 0 }}>봇 리포트</h1>
        <p style={{ fontSize: FONT.sm, color: C.text3, margin: "6px 0 0 0" }}>
          각 봇의 누적 성과·에쿼티 커브·최근 거래를 자세히 살펴보세요.
        </p>
      </div>

      {err && (
        <Card><div style={{ color: C.red, fontSize: FONT.sm }}>데이터를 불러오지 못했습니다. ({err})</div></Card>
      )}
      {loading && (
        <Card><div style={{ color: C.text3, fontSize: FONT.sm, textAlign: "center", padding: 24 }}>봇 목록 불러오는 중…</div></Card>
      )}
      {!loading && !err && (
        <>
          <BotGrid title="코인 봇" bots={crypto} onNavigate={onNavigate} />
          <BotGrid title="주식 봇" bots={stock} onNavigate={onNavigate} />
        </>
      )}
    </div>
  );
}

function BotGrid({ title, bots, onNavigate }) {
  const C = useThemeTokens();
  const { isMobile } = useBreakpoint();
  if (!bots || bots.length === 0) return null;
  return (
    <Card>
      <div style={{ fontSize: FONT.lg, fontWeight: 700, color: C.text1, marginBottom: 12 }}>{title}</div>
      <div style={{
        display: "grid",
        gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill, minmax(260px, 1fr))",
        gap: 12,
      }}>
        {bots.map((b) => (
          <a
            key={b.botId}
            href={`/reports/${b.botId}`}
            onClick={(ev) => {
              if (onNavigate) {
                ev.preventDefault();
                onNavigate(`reports/${b.botId}`);
              }
            }}
            style={{
              display: "block",
              padding: isMobile ? 16 : 14,
              minHeight: isMobile ? 96 : undefined,
              borderRadius: RADIUS.md,
              border: `1px solid ${C.border}`, background: C.card2,
              textDecoration: "none", transition: "all 140ms",
            }}
          >
            <div style={{ fontSize: FONT.lg, fontWeight: 800, color: C.text1, marginBottom: 4 }}>
              {BOT_NAME_KO[b.botId] || b.botId}
            </div>
            <div style={{ fontSize: FONT.xs, color: C.text3, marginBottom: 6 }}>
              {b.botId} · {FAMILY_KO[b.family] || b.family}
            </div>
            <div style={{ fontSize: FONT.xs, color: C.text2, lineHeight: 1.5 }}>
              {(b.assets || []).slice(0, 6).join(", ")}
              {b.assets && b.assets.length > 6 && ` 외 ${b.assets.length - 6}개`}
            </div>
            <div style={{ fontSize: FONT.xs, color: C.blueL, fontWeight: 700, marginTop: 8 }}>
              상세 리포트 보기 →
            </div>
          </a>
        ))}
      </div>
    </Card>
  );
}

// ── 봇 상세 페이지 ───────────────────────────────────────────────
function BotReportDetail({ botId, onNavigate }) {
  const C = useThemeTokens();
  const { isMobile } = useBreakpoint();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const res = await fetch(`/api/bot-report?botId=${encodeURIComponent(botId)}`);
      const json = await res.json();
      if (!json.ok) {
        setErr(json.error || "알 수 없는 오류");
      } else {
        setData(json);
      }
    } catch (e) {
      setErr(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [botId]);

  useEffect(() => { load(); }, [load]);

  const meta = data?.meta || {};
  const cum = data?.cumulative || {};
  const curve = data?.equityCurve || [];
  const trades = data?.recentTrades || [];
  const empty = data?.empty;

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
      {/* 헤더 */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <button
            onClick={(ev) => {
              ev.preventDefault();
              if (onNavigate) onNavigate("reports");
              else if (typeof window !== "undefined") window.history.back();
            }}
            style={{
              fontSize: pickFont("button", isMobile) ?? FONT.xs,
              color: C.text3,
              background: "transparent", border: "none",
              cursor: "pointer",
              padding: isMobile ? "8px 0" : 0,
              minHeight: isMobile ? 44 : undefined,
              marginBottom: 6,
            }}
          >← 전체 봇 리포트</button>
          <h1 style={{ fontSize: FONT["2xl"], fontWeight: 800, color: C.text1, margin: 0 }}>
            {BOT_NAME_KO[botId] || botId}
          </h1>
          <p style={{ fontSize: FONT.sm, color: C.text3, margin: "4px 0 0 0" }}>
            {botId} · {FAMILY_KO[meta.family] || meta.family || "—"} · {meta.kind === "crypto" ? "코인" : meta.kind === "stock" ? "주식" : "—"}
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          style={{
            padding: isMobile ? "10px 16px" : "6px 12px",
            minHeight: 44,
            borderRadius: RADIUS.sm,
            background: C.card, border: `1px solid ${C.border}`,
            color: C.text2,
            fontSize: pickFont("button", isMobile) ?? FONT.xs,
            fontWeight: 700, cursor: "pointer",
          }}
        >{loading ? "새로고침 중…" : "새로고침"}</button>
      </div>

      {err && (
        <Card><div style={{ color: C.red, fontSize: FONT.sm }}>리포트를 불러오지 못했습니다. ({err})</div></Card>
      )}

      {/* 누적 메트릭 — 모바일은 2 col grid */}
      <Card>
        <div style={{ fontSize: FONT.lg, fontWeight: 700, color: C.text1, marginBottom: 12 }}>누적 성과</div>
        <div style={{
          display: "grid",
          gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(auto-fit, minmax(140px, 1fr))",
          gap: 12,
        }}>
          <Stat
            label="누적 수익률"
            value={fmtPct(cum.returnPct, 2)}
            color={cum.returnPct >= 0 ? C.green : C.red}
            sub={`배분금 ${fmtMoney(cum.botAllocation)}`}
          />
          <Stat
            label="안정성 (Sharpe)"
            value={fmtNum(cum.sharpe, 2)}
            sub={cum.sharpe >= 2 ? "매우 우수" : cum.sharpe >= 1 ? "양호" : cum.sharpe >= 0 ? "보통" : "주의"}
            color={cum.sharpe >= 1 ? C.green : cum.sharpe < 0 ? C.red : C.text1}
          />
          <Stat label="승률" value={`${fmtNum(cum.winRate, 1)}%`} sub={`${fmtInt(cum.closedCount)}회 청산`} />
          <Stat
            label="PF"
            value={cum.profitFactor == null ? "—" : fmtNum(cum.profitFactor, 2)}
            sub="총 이익 / 총 손실"
            color={cum.profitFactor && cum.profitFactor >= 1.5 ? C.green : cum.profitFactor && cum.profitFactor < 1 ? C.red : C.text1}
          />
          <Stat label="MDD" value={fmtPct(-Math.abs(cum.mdd || 0), 1)} color={C.red} sub="고점 대비 최대 낙폭" />
          <Stat label="총 거래수" value={fmtInt(cum.tradeCount)} />
          <Stat label="평균 보유" value={`${fmtNum(cum.avgHoldDays, 1)}일`} />
          <Stat label="실현 손익" value={fmtMoney(cum.realizedPL)} color={(cum.realizedPL || 0) >= 0 ? C.green : C.red} />
        </div>
      </Card>

      {/* 자산 universe */}
      {Array.isArray(meta.assets) && meta.assets.length > 0 && (
        <Card>
          <div style={{ fontSize: FONT.sm, color: C.text3, fontWeight: 700, marginBottom: 8 }}>매매 대상 자산</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {meta.assets.map((a) => (
              <span key={a} style={{
                padding: "4px 10px", borderRadius: RADIUS.full,
                background: C.card2, border: `1px solid ${C.border}`,
                fontSize: FONT.xs, color: C.text2, fontWeight: 600,
              }}>{a}</span>
            ))}
          </div>
        </Card>
      )}

      {/* Equity curve */}
      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, gap: 8, flexWrap: "wrap" }}>
          <div style={{ fontSize: FONT.lg, fontWeight: 700, color: C.text1 }}>최근 30일 에쿼티 커브</div>
          <div style={{ fontSize: FONT.xs, color: C.text3 }}>배분금 = 100% 기준</div>
        </div>
        <EquityCurveSVG curve={curve} />
      </Card>

      {/* 최근 거래 */}
      <Card style={{ padding: 0 }}>
        <div style={{ padding: 16, borderBottom: `1px solid ${C.border}`, fontSize: FONT.lg, fontWeight: 700, color: C.text1 }}>
          최근 거래 (최대 10건)
        </div>
        {trades.length === 0 ? (
          <div style={{ padding: 24, textAlign: "center", color: C.text3, fontSize: FONT.sm }}>
            {empty ? "이 봇은 아직 거래 기록이 없습니다." : "최근 거래가 없습니다."}
          </div>
        ) : isMobile ? (
          /* 모바일 — 카드 리스트 */
          <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
            {trades.map((t, i) => {
              const isBuy = String(t.type).startsWith("BUY");
              return (
                <div key={i} style={{
                  padding: 12,
                  background: C.card2,
                  border: `1px solid ${C.border}`,
                  borderLeft: `4px solid ${isBuy ? C.green : C.red}`,
                  borderRadius: RADIUS.md,
                }}>
                  <div style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    gap: 8, marginBottom: 6,
                  }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: C.text1 }}>
                      {t.asset || "—"}
                    </span>
                    <span style={{
                      fontSize: 12, fontWeight: 800,
                      color: isBuy ? C.green : C.red,
                      padding: "2px 8px", borderRadius: RADIUS.full,
                      background: isBuy ? C.greenBg : C.redBg,
                    }}>{t.type || "—"}</span>
                  </div>
                  <div style={{
                    display: "flex", justifyContent: "space-between",
                    fontSize: 12, color: C.text2, marginBottom: 4,
                  }}>
                    <span style={{ fontFamily: "var(--z-font-mono)" }}>{fmtDate(t.time)}</span>
                    <span style={{ fontWeight: 700, color: C.text1 }}>{fmtMoney(t.amount)}</span>
                  </div>
                  {t.reason && (
                    <div style={{ fontSize: 11, color: C.text3, lineHeight: 1.4 }}>
                      {t.reason}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 520 }}>
              <thead>
                <tr style={{ background: C.card2 }}>
                  <th style={thStyle(C)}>시각</th>
                  <th style={thStyle(C)}>자산</th>
                  <th style={thStyle(C)}>방향</th>
                  <th style={{ ...thStyle(C), textAlign: "right" }}>금액</th>
                  <th style={thStyle(C)}>사유</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((t, i) => (
                  <tr key={i}>
                    <td style={{ ...tdStyle(C), fontFamily: "var(--z-font-mono)" }}>{fmtDate(t.time)}</td>
                    <td style={tdStyle(C)}>{t.asset || "—"}</td>
                    <td style={{ ...tdStyle(C), color: String(t.type).startsWith("BUY") ? C.green : C.red, fontWeight: 700 }}>
                      {t.type || "—"}
                    </td>
                    <td style={{ ...tdStyle(C), textAlign: "right" }}>{fmtMoney(t.amount)}</td>
                    <td style={{ ...tdStyle(C), color: C.text3, fontSize: FONT.xs }}>{t.reason || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div style={{ fontSize: FONT.xs, color: C.text3, lineHeight: 1.6, padding: "8px 4px" }}>
        ※ 이 리포트는 글로벌 봇 운영 결과를 기준으로 보여집니다. 사용자별 개인 봇 성과는{" "}
        <strong>봇 리더보드</strong> 에서 익명 닉네임으로 확인하실 수 있어요.
      </div>
    </div>
  );
}

function thStyle(C) {
  return {
    textAlign: "left", padding: "10px 12px",
    fontSize: FONT.xs, color: C.text3, fontWeight: 700,
    borderBottom: `1px solid ${C.border}`,
    whiteSpace: "nowrap",
  };
}
function tdStyle(C) {
  return {
    padding: "10px 12px",
    fontSize: FONT.sm, color: C.text1,
    borderBottom: `1px solid ${C.border}40`,
    whiteSpace: "nowrap",
  };
}
