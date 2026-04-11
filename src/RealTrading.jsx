// ══════════════════════════════════════════════════════════════════
// Zepta — 실전매매 관제센터 (v2)
// 새 디자인 시스템 (src/ui/*) 기반 · Option A 절대수익형 프리셋
// - 초보/전문가 밀도 토글
// - 모바일 반응형
// - Shadow / Reconcile / Bracket rescue 가시성
// - 6단계 안전 활성화 가이드
// ══════════════════════════════════════════════════════════════════
import React, { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "./AuthProvider.jsx";
import {
  Button, Card, Badge, Stat, Tabs, Dialog, Tooltip, Skeleton, Switch, Segmented,
  Table, SectionHeader, KV, Progress, EmptyState, ToastProvider, useToast, Spinner,
} from "./ui/primitives.jsx";
import {
  Play, Stop, Pause, Refresh, Power, Shield, Ghost, Gauge, Alert as AlertIcon,
  Check, Flask, Lock, Unlock, Settings, Sun, Moon, ChevronR, Zap, Activity, Target,
  Wallet, TrendUp, TrendDown,
} from "./ui/icons.jsx";
import { useTheme } from "./ui/theme.jsx";

// ═══════════════════════════════════════════════════════════════════
// Custom Styles for RealTrading Dashboard
// ═══════════════════════════════════════════════════════════════════
const realtradingStyles = `
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
.rt-pulse {
  animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}
`;

// ═══════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════
const fmtUsd = (v, digits = 2) => {
  if (v == null || !isFinite(v)) return "—";
  const n = Number(v);
  return (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits });
};
const fmtPct = (v, d = 2) => (v == null || !isFinite(v)) ? "—" : (v >= 0 ? "+" : "") + Number(v).toFixed(d) + "%";
// float 연산 부작용(3.9000000000000004) 제거용 qty 포맷터
const fmtQty = (v) => {
  if (v == null || !isFinite(v)) return "—";
  const n = Number(v);
  // 6자리에서 반올림 후 불필요한 0 제거 → "3.9", "0.001234"
  const r = Math.round(n * 1e6) / 1e6;
  return r.toString();
};
const fmtTime = (t) => t ? new Date(t).toLocaleTimeString("ko-KR", { hour12: false }) : "—";
const fmtDT = (t) => t ? new Date(t).toLocaleString("ko-KR", { hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";

async function jget(url) {
  const r = await fetch(url, { credentials: "same-origin" });
  return r.json();
}
async function jpost(url, body) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  return r.json();
}

// ═══════════════════════════════════════════════════════════════════
// Root (wraps Toast + Theme)
// ═══════════════════════════════════════════════════════════════════
export default function RealTrading(props) {
  return (
    <ToastProvider>
      <RealTradingInner {...props} />
    </ToastProvider>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Inner
// ═══════════════════════════════════════════════════════════════════
function RealTradingInner() {
  const { user } = useAuth();
  const userId = user?.id;
  const { theme, toggle: toggleTheme } = useTheme();
  const toast = useToast();

  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [density, setDensity] = useState(() => {
    try { return localStorage.getItem("zepta:rt:density") || "pro"; } catch { return "pro"; }
  });
  const [section, setSection] = useState("dashboard");
  const [confirm, setConfirm] = useState(null);
  const timerRef = useRef(null);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

  // Inject custom styles once
  useEffect(() => {
    if (!document.getElementById("realtrading-styles")) {
      const style = document.createElement("style");
      style.id = "realtrading-styles";
      style.textContent = realtradingStyles;
      document.head.appendChild(style);
      return () => style.remove();
    }
  }, []);

  useEffect(() => {
    const h = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, []);

  useEffect(() => {
    try { localStorage.setItem("zepta:rt:density", density); } catch {}
  }, [density]);

  const refresh = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const s = await jget(`/api/real-trading/status?userId=${encodeURIComponent(userId)}`);
      if (!s?.ok) throw new Error(s?.error || "상태 조회 실패");
      setStatus(s);
      setError(null);
      setLastRefresh(Date.now());
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    refresh();
    timerRef.current = setInterval(refresh, 15_000);
    return () => clearInterval(timerRef.current);
  }, [refresh, userId]);

  const act = async (action, body = {}, okMsg) => {
    if (!userId) return;
    setBusy(true);
    try {
      const r = await jpost("/api/real-trading/kill-switch", { userId, action, ...body });
      if (!r?.ok) throw new Error(r?.error || "요청 실패");
      toast.push(okMsg || `${action} 완료`, { tone: "green" });
      await refresh();
    } catch (e) {
      toast.push(e?.message || String(e), { tone: "red", title: "오류" });
    } finally { setBusy(false); }
  };

  const runDry = async () => {
    if (!userId) return;
    setBusy(true);
    try {
      // ★ 모의실행은 항상 shadow+probe — shadow-ledger 에 기록 + 시그널 없으면 합성 주입
      const r = await jpost("/api/real-trading/engine", { userId, dryRun: true, shadow: true, probe: true });
      if (r?.ran) {
        const sym = r.signal?.symbol || "";
        const side = r.signal?.side || "";
        const shadow = r.shadow ? " → Shadow 기록됨" : "";
        toast.push(
          `${sym} ${side} · qty ${fmtQty(r.plan?.qty)} @ ${r.plan?.leverage}×${r.plan?.bumpedToMin ? " · ⚠ bumped" : ""}${shadow}`,
          { tone: "green", title: "✓ 모의 실행 완료", duration: 5000 }
        );
      } else {
        const msg = r?.reason || r?.error || "no action";
        const tried = r?.tried?.length ? ` (${r.tried.length}개 시그널 시도)` : "";
        const tail = r?.steps?.length ? `\n${r.steps.slice(-3).join(" · ")}` : "";
        toast.push(msg + tried + tail, { tone: "yellow", title: "모의 실행 결과", duration: 6000 });
        console.warn("[dry-run diag]", r);
      }
      await refresh();
    } catch (e) {
      toast.push(e?.message || String(e), { tone: "red", title: "오류" });
    } finally { setBusy(false); }
  };

  const emergencyStop = () => setConfirm({
    tone: "danger",
    title: "⚠️ 긴급 정지 — 모든 포지션 시장가 청산",
    desc: "현재 오픈된 모든 Binance Futures 포지션을 즉시 시장가로 청산합니다.\n이 작업은 되돌릴 수 없습니다.",
    confirmLabel: "긴급 청산 실행",
    confirmVariant: "danger",
    onConfirm: async () => {
      setBusy(true);
      try {
        const r = await jpost("/api/binance/emergency-stop", { userId });
        toast.push(r?.ok ? "긴급 정지 완료" : (r?.error || "실패"), { tone: r?.ok ? "green" : "red" });
        await refresh();
      } catch (e) {
        toast.push(e?.message || String(e), { tone: "red" });
      } finally { setBusy(false); }
    },
  });

  // ── 로그인 가드 ──
  if (!userId) {
    return (
      <div style={{
        minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
        background: "var(--z-bg)", padding: 24,
      }}>
        <Card pad={32} style={{ maxWidth: 420, textAlign: "center" }}>
          <Lock size={32} />
          <div style={{ fontSize: 16, fontWeight: 800, marginTop: 12 }}>로그인이 필요합니다</div>
          <div style={{ fontSize: 13, color: "var(--z-text-2)", marginTop: 6 }}>
            실전매매 관제센터는 인증된 사용자만 접근할 수 있습니다.
          </div>
        </Card>
      </div>
    );
  }

  // ── 파생 상태 ──
  const phase1On = !!status?.phase1Enabled;
  const shadowOn = !!status?.shadowEnabled;
  const killOn = !!status?.killswitchOn;
  const halted = !!status?.halted;
  const equity = status?.equity;
  const positions = status?.openPositions || [];
  const engineLog = status?.recentEngineLog || [];
  const orders = status?.recentOrders || [];
  const breaker = status?.breaker || {};
  const shadow = status?.shadow || { summary: null, openCount: 0, recent: [] };
  const reconcile = status?.reconcile || [];
  const trulyLive = phase1On && !killOn && !halted;

  // 브레이커 사용률
  const dayLossPct = breaker.dayStartEquity && equity
    ? ((equity - breaker.dayStartEquity) / breaker.dayStartEquity) * 100 : 0;
  const weekLossPct = breaker.weekStartEquity && equity
    ? ((equity - breaker.weekStartEquity) / breaker.weekStartEquity) * 100 : 0;
  const mddPct = breaker.equityHigh && equity
    ? ((equity - breaker.equityHigh) / breaker.equityHigh) * 100 : 0;

  // ═════════════════════════════════════════════════════════
  // HEADER (REDESIGNED)
  // ═════════════════════════════════════════════════════════
  const header = (
    <div style={{
      background: trulyLive
        ? "linear-gradient(135deg, rgba(239, 68, 68, 0.15) 0%, rgba(234, 51, 35, 0.08) 100%)"
        : "linear-gradient(135deg, rgba(59, 130, 246, 0.12) 0%, rgba(37, 99, 235, 0.06) 100%)",
      border: trulyLive
        ? "1px solid rgba(239, 68, 68, 0.25)"
        : "1px solid rgba(59, 130, 246, 0.2)",
      borderRadius: "var(--z-r-lg)",
      padding: "24px 20px",
      marginBottom: 20,
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      flexWrap: "wrap",
      gap: 16,
    }}>
      <div style={{ flex: 1, minWidth: 240 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 10 }}>
          <div style={{
            width: 48, height: 48, borderRadius: 14,
            background: trulyLive
              ? "linear-gradient(135deg, var(--z-red) 0%, #E53935 100%)"
              : "linear-gradient(135deg, var(--z-blue) 0%, #1E40AF 100%)",
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: trulyLive
              ? "0 8px 24px rgba(239, 68, 68, 0.35), inset 0 1px 0 rgba(255,255,255,0.2)"
              : "0 8px 24px rgba(59, 130, 246, 0.25), inset 0 1px 0 rgba(255,255,255,0.15)",
            position: "relative",
          }}>
            {trulyLive && (
              <div className="rt-pulse" style={{
                position: "absolute", inset: 0, borderRadius: 14,
                background: "rgba(239, 68, 68, 0.3)",
              }} />
            )}
            <Power size={24} color="#fff" style={{ position: "relative", zIndex: 1 }} />
          </div>
          <div>
            <div style={{ fontSize: 28, fontWeight: 900, letterSpacing: "-0.03em", lineHeight: 1 }}>
              실전매매 관제센터
            </div>
            <div style={{ fontSize: 13, color: "var(--z-text-3)", marginTop: 4 }}>
              Zepta Investment Platform
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
          {trulyLive ? (
            <Badge
              tone="red"
              dot
              solid
              className="rt-pulse"
              style={{
                fontSize: 12,
                fontWeight: 700,
                padding: "6px 12px",
              }}
            >
              🔴 LIVE
            </Badge>
          ) : (
            <Badge
              tone="default"
              style={{
                fontSize: 12,
                fontWeight: 700,
                padding: "6px 12px",
              }}
            >
              ⊙ STANDBY
            </Badge>
          )}
          {halted && (
            <Badge
              tone="yellow"
              style={{
                fontSize: 12,
                fontWeight: 700,
                padding: "6px 12px",
              }}
            >
              ⚡ BREAKER
            </Badge>
          )}
          <div style={{ fontSize: 12, color: "var(--z-text-2)", marginLeft: 4 }}>
            · Binance USDⓈ-M Futures
            {lastRefresh && <> · {fmtTime(lastRefresh)}</>}
          </div>
        </div>
      </div>

      <Button
        variant="ghost"
        size="sm"
        onClick={refresh}
        leftIcon={loading ? <Spinner size={14} /> : <Refresh size={14} />}
        style={{ whiteSpace: "nowrap" }}
      >
        새로고침
      </Button>
    </div>
  );

  // ═════════════════════════════════════════════════════════
  // KPI BAR (REDESIGNED - HERO METRICS)
  // ═════════════════════════════════════════════════════════
  const kpiBar = (
    <div style={{
      display: "grid", gap: 12, marginBottom: 20,
      gridTemplateColumns: isMobile
        ? "1fr"
        : "2fr 1fr 1fr",
    }}>
      {/* HERO METRIC — EQUITY */}
      <div style={{
        background: "linear-gradient(135deg, rgba(59, 130, 246, 0.12) 0%, rgba(37, 99, 235, 0.06) 100%)",
        border: "1px solid rgba(59, 130, 246, 0.25)",
        borderRadius: "var(--z-r-lg)",
        padding: "20px",
        display: "flex", flexDirection: "column", justifyContent: "center",
        boxShadow: "0 4px 12px rgba(0, 0, 0, 0.05)",
        gridRow: isMobile ? undefined : "span 2",
      }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 12 }}>
          <div style={{
            width: 44, height: 44, borderRadius: 12,
            background: "linear-gradient(135deg, var(--z-blue) 0%, #1E40AF 100%)",
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: "0 4px 12px rgba(59, 130, 246, 0.3)",
          }}>
            <Wallet size={20} color="#fff" />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, color: "var(--z-text-3)", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>
              현재 에쿼티
            </div>
            <div style={{ fontSize: 32, fontWeight: 900, marginTop: 6, lineHeight: 1, fontFamily: "var(--z-font-mono)" }}>
              {loading && equity == null ? (
                <Skeleton width={140} height={32} />
              ) : (
                fmtUsd(equity)
              )}
            </div>
          </div>
        </div>
        <div style={{
          display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr",
          paddingTop: 12, borderTop: "1px solid rgba(59, 130, 246, 0.1)",
        }}>
          <div>
            <div style={{ fontSize: 11, color: "var(--z-text-3)", marginBottom: 4 }}>일 시작 가</div>
            <div style={{ fontSize: 14, fontWeight: 700, fontFamily: "var(--z-font-mono)" }}>
              {breaker.dayStartEquity ? fmtUsd(breaker.dayStartEquity) : "—"}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: "var(--z-text-3)", marginBottom: 4 }}>최고 수익</div>
            <div style={{ fontSize: 14, fontWeight: 700, fontFamily: "var(--z-font-mono)", color: "var(--z-green-hi)" }}>
              {breaker.equityHigh ? fmtUsd(breaker.equityHigh) : "—"}
            </div>
          </div>
        </div>
      </div>

      {/* SECONDARY METRICS — P&L and MDD */}
      <div style={{
        background: dayLossPct < 0
          ? "linear-gradient(135deg, rgba(239, 68, 68, 0.12) 0%, rgba(220, 38, 38, 0.06) 100%)"
          : "linear-gradient(135deg, rgba(34, 197, 94, 0.12) 0%, rgba(22, 163, 74, 0.06) 100%)",
        border: dayLossPct < 0
          ? "1px solid rgba(239, 68, 68, 0.25)"
          : "1px solid rgba(34, 197, 94, 0.25)",
        borderRadius: "var(--z-r-lg)",
        padding: "18px",
        display: "flex", flexDirection: "column", justifyContent: "space-between",
        boxShadow: "0 4px 12px rgba(0, 0, 0, 0.05)",
      }}>
        <div style={{ fontSize: 12, color: "var(--z-text-3)", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>
          일 손익
        </div>
        <div style={{
          fontSize: 28, fontWeight: 900, lineHeight: 1,
          color: dayLossPct < 0
            ? "var(--z-red-hi)"
            : dayLossPct > 0
              ? "var(--z-green-hi)"
              : "var(--z-text)",
          fontFamily: "var(--z-font-mono)",
        }}>
          {fmtPct(dayLossPct)}
        </div>
        <div style={{
          marginTop: 10, fontSize: 11, color: "var(--z-text-3)",
          padding: "8px 10px", background: "rgba(0, 0, 0, 0.15)", borderRadius: "var(--z-r-md)",
        }}>
          한도 <span style={{ fontWeight: 700 }}>-4%</span>
        </div>
      </div>

      <div style={{
        background: mddPct < -8
          ? "linear-gradient(135deg, rgba(239, 68, 68, 0.12) 0%, rgba(220, 38, 38, 0.06) 100%)"
          : "linear-gradient(135deg, rgba(168, 85, 247, 0.12) 0%, rgba(147, 51, 234, 0.06) 100%)",
        border: mddPct < -8
          ? "1px solid rgba(239, 68, 68, 0.25)"
          : "1px solid rgba(168, 85, 247, 0.25)",
        borderRadius: "var(--z-r-lg)",
        padding: "18px",
        display: "flex", flexDirection: "column", justifyContent: "space-between",
        boxShadow: "0 4px 12px rgba(0, 0, 0, 0.05)",
      }}>
        <div style={{ fontSize: 12, color: "var(--z-text-3)", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>
          MDD
        </div>
        <div style={{
          fontSize: 28, fontWeight: 900, lineHeight: 1,
          color: mddPct < -10
            ? "var(--z-red-hi)"
            : mddPct < -5
              ? "var(--z-yellow-hi)"
              : "var(--z-purple)",
          fontFamily: "var(--z-font-mono)",
        }}>
          {fmtPct(mddPct)}
        </div>
        <div style={{
          marginTop: 10, fontSize: 11, color: "var(--z-text-3)",
          padding: "8px 10px", background: "rgba(0, 0, 0, 0.15)", borderRadius: "var(--z-r-md)",
        }}>
          한도 <span style={{ fontWeight: 700 }}>-15%</span>
        </div>
      </div>

      {/* SUPPORTING METRICS */}
      <div style={{
        background: positions.length >= 2
          ? "linear-gradient(135deg, rgba(234, 179, 8, 0.12) 0%, rgba(202, 138, 4, 0.06) 100%)"
          : "linear-gradient(135deg, rgba(100, 116, 139, 0.12) 0%, rgba(71, 85, 105, 0.06) 100%)",
        border: positions.length >= 2
          ? "1px solid rgba(234, 179, 8, 0.25)"
          : "1px solid rgba(100, 116, 139, 0.2)",
        borderRadius: "var(--z-r-lg)",
        padding: "16px",
        display: "flex", flexDirection: "column", justifyContent: "center",
        boxShadow: "0 4px 12px rgba(0, 0, 0, 0.05)",
      }}>
        <div style={{ fontSize: 11, color: "var(--z-text-3)", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>
          오픈 포지션
        </div>
        <div style={{ fontSize: 24, fontWeight: 900, lineHeight: 1, color: positions.length >= 2 ? "var(--z-yellow-hi)" : "var(--z-text)" }}>
          {positions.length}
        </div>
        <div style={{
          marginTop: 8, fontSize: 10, color: "var(--z-text-3)",
          padding: "6px 8px", background: "rgba(0, 0, 0, 0.15)", borderRadius: "var(--z-r-md)",
        }}>
          최대 2개
        </div>
      </div>

      <div style={{
        background: (breaker.consecLosses || 0) >= 3
          ? "linear-gradient(135deg, rgba(239, 68, 68, 0.12) 0%, rgba(220, 38, 38, 0.06) 100%)"
          : "linear-gradient(135deg, rgba(100, 116, 139, 0.12) 0%, rgba(71, 85, 105, 0.06) 100%)",
        border: (breaker.consecLosses || 0) >= 3
          ? "1px solid rgba(239, 68, 68, 0.25)"
          : "1px solid rgba(100, 116, 139, 0.2)",
        borderRadius: "var(--z-r-lg)",
        padding: "16px",
        display: "flex", flexDirection: "column", justifyContent: "center",
        boxShadow: "0 4px 12px rgba(0, 0, 0, 0.05)",
      }}>
        <div style={{ fontSize: 11, color: "var(--z-text-3)", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>
          연속 손실
        </div>
        <div style={{
          fontSize: 24, fontWeight: 900, lineHeight: 1,
          color: (breaker.consecLosses || 0) >= 3 ? "var(--z-red-hi)" : "var(--z-text)",
        }}>
          {breaker.consecLosses || 0} / 5
        </div>
        <div style={{
          marginTop: 8, fontSize: 10, color: "var(--z-text-3)",
          padding: "6px 8px", background: "rgba(0, 0, 0, 0.15)", borderRadius: "var(--z-r-md)",
        }}>
          쿨다운 24h
        </div>
      </div>
    </div>
  );

  // ═════════════════════════════════════════════════════════
  // CONTROL PANEL (REDESIGNED - PROMINENT BUTTONS)
  // ═════════════════════════════════════════════════════════
  const controlPanel = (
    <div style={{
      background: "linear-gradient(135deg, rgba(99, 102, 241, 0.08) 0%, rgba(79, 70, 229, 0.04) 100%)",
      border: "1px solid rgba(99, 102, 241, 0.2)",
      borderRadius: "var(--z-r-lg)",
      padding: "20px",
      marginBottom: 20,
      display: "flex", flexDirection: "column", gap: 16,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Settings size={18} color="var(--z-text-2)" />
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--z-text-2)" }}>
            매매 제어 센터
          </div>
        </div>
        {trulyLive ? (
          <Badge tone="green" dot style={{ fontSize: 11, fontWeight: 700, padding: "6px 10px" }}>
            ✓ 실거래 중
          </Badge>
        ) : (
          <Badge tone="default" style={{ fontSize: 11, fontWeight: 700, padding: "6px 10px" }}>
            ⊙ 대기 중
          </Badge>
        )}
      </div>

      <div style={{
        display: "grid",
        gap: 10,
        gridTemplateColumns: isMobile
          ? "1fr"
          : "1fr 1fr auto 1fr",
        alignItems: "stretch",
      }}>
        {/* PRIMARY ACTION: START/STOP */}
        {killOn ? (
          <Button
            variant="danger"
            size="lg"
            disabled={busy || !phase1On}
            leftIcon={<Unlock size={16} />}
            onClick={() => setConfirm({
              tone: "danger",
              title: "실거래 시작",
              desc: "이 버튼을 누르면 다음 사이클(5분)부터 실거래가 발생합니다.\n자본·리스크 파라미터를 확인하셨나요?",
              confirmLabel: "실거래 시작",
              confirmVariant: "danger",
              onConfirm: () => act("enable", {}, "실거래 시작 완료"),
            })}
            style={{
              fontSize: 14,
              fontWeight: 700,
              padding: "14px 20px",
              background: "linear-gradient(135deg, var(--z-red) 0%, #DC2626 100%)",
              boxShadow: "0 4px 12px rgba(239, 68, 68, 0.3)",
              border: "1px solid rgba(239, 68, 68, 0.4)",
            }}
          >
            🚀 실거래 시작
          </Button>
        ) : (
          <Button
            variant="warn"
            size="lg"
            disabled={busy}
            leftIcon={<Lock size={16} />}
            onClick={() => act("disable", {}, "실거래 중지")}
            style={{
              fontSize: 14,
              fontWeight: 700,
              padding: "14px 20px",
              background: "linear-gradient(135deg, var(--z-yellow) 0%, #EAB308 100%)",
              boxShadow: "0 4px 12px rgba(234, 179, 8, 0.3)",
              border: "1px solid rgba(234, 179, 8, 0.4)",
            }}
          >
            🔒 실거래 중지
          </Button>
        )}

        {/* SECONDARY ACTION: PAUSE/RESUME */}
        {halted ? (
          <Button
            variant="success"
            size="lg"
            disabled={busy}
            leftIcon={<Play size={16} />}
            onClick={() => act("resume", {}, "재개 완료")}
            style={{
              fontSize: 14,
              fontWeight: 700,
              padding: "14px 20px",
              background: "linear-gradient(135deg, var(--z-green) 0%, #16A34A 100%)",
              boxShadow: "0 4px 12px rgba(34, 197, 94, 0.3)",
              border: "1px solid rgba(34, 197, 94, 0.4)",
            }}
          >
            ▶ 재개
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="lg"
            disabled={busy}
            leftIcon={<Pause size={16} />}
            onClick={() => act("halt", { reason: "manual" }, "일시 정지")}
            style={{
              fontSize: 14,
              fontWeight: 700,
              padding: "14px 20px",
              border: "1px solid var(--z-border)",
            }}
          >
            ⏸ 일시 정지
          </Button>
        )}

        <div style={{ display: isMobile ? "none" : "flex" }} />

        {/* EMERGENCY ACTION: STOP ALL */}
        <Button
          variant="danger"
          size="lg"
          disabled={busy || positions.length === 0}
          leftIcon={<Stop size={16} />}
          onClick={emergencyStop}
          style={{
            fontSize: 14,
            fontWeight: 700,
            padding: "14px 20px",
            background: "linear-gradient(135deg, #7F1D1D 0%, #DC2626 100%)",
            boxShadow: "0 4px 12px rgba(239, 68, 68, 0.35), inset 0 1px 0 rgba(255,255,255,0.1)",
            border: "1px solid rgba(239, 68, 68, 0.5)",
          }}
        >
          ⚠ 긴급 정지
        </Button>
      </div>

      {halted && (
        <div style={{
          padding: 12,
          background: "linear-gradient(135deg, rgba(234, 179, 8, 0.12) 0%, rgba(202, 138, 4, 0.06) 100%)",
          border: `1px solid rgba(234, 179, 8, 0.3)`,
          borderRadius: "var(--z-r-md)",
          color: "var(--z-yellow-hi)",
          fontSize: 12,
          fontWeight: 700,
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}>
          <AlertIcon size={16} />
          <span>서킷브레이커 발동 — <span style={{ fontWeight: 900 }}>{status?.haltedReason}</span></span>
        </div>
      )}
      {error && (
        <div style={{
          padding: 12,
          background: "linear-gradient(135deg, rgba(239, 68, 68, 0.12) 0%, rgba(220, 38, 38, 0.06) 100%)",
          border: `1px solid rgba(239, 68, 68, 0.3)`,
          borderRadius: "var(--z-r-md)",
          color: "var(--z-red-hi)",
          fontSize: 12,
          fontWeight: 700,
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}>
          <AlertIcon size={16} />
          <span>오류: {error}</span>
        </div>
      )}
    </div>
  );

  // ═════════════════════════════════════════════════════════
  // SIMPLE MODE — 가이드 스텝
  // ═════════════════════════════════════════════════════════
  const simpleGuide = (
    <Card title="6단계 안전 활성화 가이드" subtitle="순서대로 따라가면 안전하게 실거래 시작할 수 있어요" icon={<Target size={16} />}>
      {[
        { n: 1, title: "모의실행", desc: "Shadow 모드로 전체 파이프라인을 점검합니다. 시그널이 없으면 자동 합성 시그널로 테스트합니다.", done: engineLog.some(e => e.shadow || e.dryRun) },
        { n: 2, title: "Shadow 모드 시작", desc: "실거래 없이 2~4주 가상 트레이드를 축적하고 승률·netPnL·평균 RR 을 관찰합니다.", done: shadowOn },
        { n: 3, title: "Shadow 결과 검증", desc: "양의 netPnL + 평균 RR ≥ 1.5 를 확인 후 다음 단계로 진행.", done: (shadow.summary?.trades || 0) >= 10 && (shadow.summary?.netPnL || 0) > 0 },
        { n: 4, title: "Phase 1 등록", desc: "실거래 엔진 순회 대상에 이 계정을 등록합니다. Killswitch 는 여전히 ON 상태.", done: phase1On },
        { n: 5, title: "Killswitch 해제", desc: "이 시점부터 5분 내 실거래 발생 가능. 소액부터 시작하세요.", done: !killOn },
        { n: 6, title: "주기적 모니터링", desc: "오픈 포지션·엔진 로그·Reconcile·브레이커 상태를 하루 1~2회 확인.", done: trulyLive },
      ].map((step) => (
        <div key={step.n} style={{
          display: "flex", gap: 14, padding: "12px 0",
          borderBottom: step.n < 6 ? `1px solid var(--z-border)` : "none",
        }}>
          <div style={{
            flexShrink: 0, width: 32, height: 32, borderRadius: "50%",
            background: step.done ? "var(--z-green)" : "var(--z-card-hi)",
            color: step.done ? "#021B10" : "var(--z-text-3)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 13, fontWeight: 800,
            border: `1px solid ${step.done ? "var(--z-green)" : "var(--z-border-2)"}`,
          }}>
            {step.done ? <Check size={16} /> : step.n}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: step.done ? "var(--z-text)" : "var(--z-text-2)" }}>
              {step.title}
              {step.done && <Badge tone="green" size="sm" style={{ marginLeft: 8 }}>완료</Badge>}
            </div>
            <div style={{ fontSize: 11, color: "var(--z-text-3)", marginTop: 3, lineHeight: 1.5 }}>
              {step.desc}
            </div>
          </div>
        </div>
      ))}
    </Card>
  );

  // ═════════════════════════════════════════════════════════
  // OPEN POSITIONS
  // ═════════════════════════════════════════════════════════
  const positionsCard = (
    <Card
      title="오픈 포지션"
      icon={<Activity size={16} />}
      actions={<Badge tone={positions.length > 0 ? "blue" : "default"}>{positions.length}</Badge>}
      pad={0}
    >
      {positions.length === 0 ? (
        <div style={{
          padding: "40px 24px",
          textAlign: "center",
          background: "linear-gradient(135deg, rgba(59, 130, 246, 0.08) 0%, rgba(79, 70, 229, 0.04) 100%)",
          borderRadius: "var(--z-r-md)",
          margin: "16px",
          border: "1px solid rgba(59, 130, 246, 0.15)",
        }}>
          <div style={{
            width: 60, height: 60, borderRadius: 12,
            background: "linear-gradient(135deg, var(--z-blue) 0%, #1E40AF 100%)",
            display: "flex", alignItems: "center", justifyContent: "center",
            margin: "0 auto 16px",
            boxShadow: "0 4px 12px rgba(59, 130, 246, 0.25)",
          }}>
            <Activity size={28} color="#fff" />
          </div>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>오픈 포지션 없음</div>
          <div style={{ fontSize: 13, color: "var(--z-text-3)", lineHeight: 1.5 }}>
            실거래가 활성화되고 신호가 발생하면<br />여기에 포지션이 표시됩니다.
          </div>
        </div>
      ) : (
        <Table
          columns={[
            { key: "symbol", label: "심볼",
              render: (p) => (
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <span style={{ fontWeight: 700 }}>{p.symbol}</span>
                  <Badge tone={p.positionAmt > 0 ? "green" : "red"} size="sm">
                    {p.positionAmt > 0 ? "LONG" : "SHORT"}
                  </Badge>
                </div>
              )
            },
            { key: "qty", label: "수량", mono: true, align: "right",
              render: (p) => Math.abs(p.positionAmt) },
            { key: "entry", label: "진입가", mono: true, align: "right",
              render: (p) => fmtUsd(p.entryPrice) },
            { key: "mark", label: "현재가", mono: true, align: "right",
              render: (p) => fmtUsd(p.markPrice) },
            { key: "lev", label: "레버리지", align: "right",
              render: (p) => `${p.leverage}×` },
            { key: "pnl", label: "손익", mono: true, align: "right",
              render: (p) => (
                <span style={{ color: p.unRealizedProfit >= 0 ? "var(--z-green-hi)" : "var(--z-red-hi)", fontWeight: 700 }}>
                  {fmtUsd(p.unRealizedProfit)}
                </span>
              )
            },
          ]}
          rows={positions}
          emptyText="없음"
        />
      )}
    </Card>
  );

  // ═════════════════════════════════════════════════════════
  // BREAKER
  // ═════════════════════════════════════════════════════════
  const breakerCard = (
    <Card title="서킷브레이커" icon={<Shield size={16} />}
      subtitle="일 -4% · 주 -8% · MDD -15% · 5연속손실 → 24h 쿨다운">
      <div style={{ display: "grid", gap: 10, gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fit, minmax(220px, 1fr))" }}>
        <div>
          <Progress
            label={`일 손실 ${fmtPct(dayLossPct)}`}
            value={Math.min(100, Math.abs(dayLossPct) * 25)}
            tone={dayLossPct <= -3 ? "red" : dayLossPct <= -2 ? "yellow" : "green"}
          />
        </div>
        <div>
          <Progress
            label={`주 손실 ${fmtPct(weekLossPct)}`}
            value={Math.min(100, Math.abs(weekLossPct) * 12.5)}
            tone={weekLossPct <= -6 ? "red" : weekLossPct <= -4 ? "yellow" : "green"}
          />
        </div>
        <div>
          <Progress
            label={`MDD ${fmtPct(mddPct)}`}
            value={Math.min(100, Math.abs(mddPct) * 6.67)}
            tone={mddPct <= -12 ? "red" : mddPct <= -8 ? "yellow" : "green"}
          />
        </div>
        <div>
          <Progress
            label={`연속 손실 ${breaker.consecLosses || 0}/5`}
            value={((breaker.consecLosses || 0) / 5) * 100}
            tone={(breaker.consecLosses || 0) >= 4 ? "red" : (breaker.consecLosses || 0) >= 3 ? "yellow" : "green"}
          />
        </div>
      </div>
      <div style={{ marginTop: 14, display: "grid", gap: 8, gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(auto-fit, minmax(160px, 1fr))", fontSize: 12 }}>
        <KV label="일 시작 에쿼티" value={fmtUsd(breaker.dayStartEquity)} />
        <KV label="주 시작 에쿼티" value={fmtUsd(breaker.weekStartEquity)} />
        <KV label="최고 에쿼티" value={fmtUsd(breaker.equityHigh)} />
        <KV label="쿨다운 종료"
          value={breaker.cooldownUntil && breaker.cooldownUntil > Date.now()
            ? fmtDT(breaker.cooldownUntil) : "—"} mono={false} />
      </div>
    </Card>
  );

  // ═════════════════════════════════════════════════════════
  // ENGINE LOG
  // ═════════════════════════════════════════════════════════
  const engineLogCard = (
    <Card
      title="엔진 실행 로그"
      icon={<Gauge size={16} />}
      actions={<Badge tone="default">{engineLog.length}</Badge>}
    >
      {engineLog.length === 0 ? (
        <EmptyState icon={<Gauge size={26} />} title="로그 없음" description="엔진이 실행되면 여기에 로그가 쌓입니다." />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 360, overflowY: "auto" }}>
          {engineLog.map((e, i) => (
            <div key={i} style={{
              padding: 12, background: "var(--z-card-2)",
              borderRadius: "var(--z-r-md)", border: `1px solid var(--z-border)`,
              fontSize: 12,
            }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 4 }}>
                <span style={{ color: "var(--z-text-3)", fontFamily: "var(--z-font-mono)", fontSize: 11 }}>
                  {fmtDT(e.time)}
                </span>
                {e.event === "position_closed" ? <Badge tone="purple" size="sm">CLOSED</Badge>
                  : e.mode === "shadow" ? <Badge tone="purple" size="sm">SHADOW</Badge>
                  : e.dryRun ? <Badge tone="yellow" size="sm">DRY</Badge>
                  : <Badge tone="green" size="sm" dot>LIVE</Badge>}
                {e.signal && (
                  <>
                    <Badge tone="blue" size="sm">{e.signal.symbol} {e.signal.side}</Badge>
                    {e.signal.confidence && <span style={{ color: "var(--z-text-3)" }}>conf {e.signal.confidence}</span>}
                  </>
                )}
                {e.symbol && !e.signal && <Badge tone="default" size="sm">{e.symbol}</Badge>}
                {e.realizedPnL != null && (
                  <span style={{
                    color: e.realizedPnL >= 0 ? "var(--z-green-hi)" : "var(--z-red-hi)",
                    fontWeight: 700, marginLeft: "auto", fontFamily: "var(--z-font-mono)",
                  }}>{fmtUsd(e.realizedPnL)}</span>
                )}
              </div>
              {e.plan && (
                <div style={{ color: "var(--z-text-2)", fontSize: 11, fontFamily: "var(--z-font-mono)" }}>
                  qty {fmtQty(e.plan.qty)} · {e.plan.leverage}× · SL {fmtUsd(e.plan.slPrice)} · TP {fmtUsd(e.plan.tpPrice)}{e.plan.bumpedToMin ? " · bumped" : ""}
                  {e.plan.effectiveRR && <> · RR {e.plan.effectiveRR.toFixed(2)}</>}
                </div>
              )}
              {e.result?.orderId && (
                <div style={{ color: "var(--z-text-3)", fontSize: 10, fontFamily: "var(--z-font-mono)" }}>
                  orderId: {e.result.orderId}
                </div>
              )}
              {e.result?.bracketRescue && (
                <div style={{
                  marginTop: 6, padding: "6px 10px", background: "var(--z-red-bg)",
                  border: `1px solid var(--z-red)55`, borderRadius: "var(--z-r-xs)",
                  color: "var(--z-red-hi)", fontSize: 11, fontWeight: 700,
                  display: "flex", alignItems: "center", gap: 6,
                }}>
                  <AlertIcon size={12} />
                  Bracket 실패 → 강제 청산 실행됨 ({e.result.bracketRescue.reason || "SL attach failed"})
                </div>
              )}
              {e.reason && !e.signal && (
                <div style={{ color: "var(--z-text-3)", fontSize: 11 }}>reason: {e.reason}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );

  // ═════════════════════════════════════════════════════════
  // SHADOW PANEL
  // ═════════════════════════════════════════════════════════
  const shadowCard = (
    <Card
      title="Shadow 모드"
      subtitle="실거래 없이 전체 파이프라인 기록 · 수수료 + 슬리피지 반영"
      icon={<Ghost size={16} />}
      actions={shadowOn ? <Badge tone="purple" dot>활성</Badge> : <Badge tone="default">비활성</Badge>}
    >
      {shadow.summary ? (
        <>
          <div style={{ display: "grid", gap: 10, gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(auto-fit, minmax(120px, 1fr))", marginBottom: 12 }}>
            <Stat compact label="총 트레이드" value={shadow.summary.trades || 0} />
            <Stat compact label="승 / 패" value={`${shadow.summary.wins || 0} / ${shadow.summary.losses || 0}`} />
            <Stat compact label="승률"
              value={(shadow.summary.trades > 0
                ? ((shadow.summary.wins || 0) / shadow.summary.trades * 100).toFixed(1) + "%" : "—")} />
            <Stat compact label="누적 netPnL"
              value={fmtUsd(shadow.summary.netPnL)}
              tone={(shadow.summary.netPnL || 0) >= 0 ? "success" : "danger"} />
            <Stat compact label="평균 R"
              value={shadow.summary.trades > 0
                ? (shadow.summary.avgR != null
                    ? shadow.summary.avgR.toFixed(2) + "R"
                    : ((shadow.summary.totalRR || 0) / shadow.summary.trades).toFixed(2) + "R")
                : "—"} />
            <Stat compact label="오픈 중" value={shadow.openCount || 0} />
            {shadow.summary.profitFactor != null && (
              <Stat compact label="Profit Factor"
                value={shadow.summary.profitFactor != null && isFinite(shadow.summary.profitFactor)
                  ? shadow.summary.profitFactor.toFixed(2) : "—"}
                tone={(shadow.summary.profitFactor || 0) >= 1.5 ? "success" : (shadow.summary.profitFactor || 0) >= 1 ? "warn" : "danger"} />
            )}
            {shadow.summary.bestR != null && (
              <Stat compact label="Best / Worst"
                value={`${(shadow.summary.bestR || 0).toFixed(1)} / ${(shadow.summary.worstR || 0).toFixed(1)}R`} />
            )}
            {shadow.summary.avgHoldHours != null && (
              <Stat compact label="평균 보유" value={`${(shadow.summary.avgHoldHours || 0).toFixed(1)}h`} />
            )}
          </div>
          {shadow.summary.byCloseReason && (
            <div style={{
              marginBottom: 12, padding: 10,
              background: "var(--z-card-2)", borderRadius: "var(--z-r-sm)",
              border: `1px solid var(--z-border)`,
              display: "flex", gap: 14, flexWrap: "wrap", fontSize: 11,
            }}>
              <span style={{ color: "var(--z-text-3)", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>청산 사유</span>
              <span><Badge tone="green" size="sm">TP</Badge> {shadow.summary.byCloseReason.TP || 0}</span>
              <span><Badge tone="red" size="sm">SL</Badge> {shadow.summary.byCloseReason.SL || 0}</span>
              <span><Badge tone="yellow" size="sm">TIME</Badge> {shadow.summary.byCloseReason.TIME || 0}</span>
            </div>
          )}
          {shadow.summary.byFamily && Object.keys(shadow.summary.byFamily).length > 0 && (
            <div style={{
              marginBottom: 12, padding: 10,
              background: "var(--z-card-2)", borderRadius: "var(--z-r-sm)",
              border: `1px solid var(--z-border)`,
            }}>
              <div style={{ fontSize: 10, color: "var(--z-text-3)", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>전략 family 별</div>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 11 }}>
                {Object.entries(shadow.summary.byFamily).map(([fam, st]) => (
                  <div key={fam} style={{ display: "flex", gap: 4, alignItems: "center" }}>
                    <Badge tone="blue" size="sm">{fam}</Badge>
                    <span style={{ fontFamily: "var(--z-font-mono)", color: (st.netPnL || 0) >= 0 ? "var(--z-green-hi)" : "var(--z-red-hi)" }}>
                      {fmtUsd(st.netPnL)} · {st.wins}/{st.trades}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <EmptyState
          icon={<Ghost size={28} />}
          title="Shadow 기록 없음"
          description={`"모의실행" 버튼을 누르거나 Shadow 모드를 시작하면 가상 매매가 기록됩니다. 5분마다 자동 수집도 됩니다.`}
        />
      )}
      {shadow.recent?.length > 0 && (
        <div style={{ marginTop: 6, maxHeight: 260, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
          {shadow.recent.map((s, i) => (
            <div key={s.id || i} style={{
              padding: 10, background: "var(--z-card-2)",
              borderRadius: "var(--z-r-sm)", border: `1px solid var(--z-border)`,
              fontSize: 11, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center",
            }}>
              <span style={{ color: "var(--z-text-3)", fontFamily: "var(--z-font-mono)" }}>{fmtDT(s.openedAt)}</span>
              <Badge tone={s.status === "OPEN" ? "blue" : "purple"} size="sm">{s.status}</Badge>
              <Badge tone="default" size="sm">{s.signal?.symbol} {s.signal?.side}</Badge>
              {s.entryPrice && <span style={{ color: "var(--z-text-3)", fontFamily: "var(--z-font-mono)" }}>E {fmtUsd(s.entryPrice)}</span>}
              {s.exitPrice && <span style={{ color: "var(--z-text-3)", fontFamily: "var(--z-font-mono)" }}>X {fmtUsd(s.exitPrice)}</span>}
              {s.netPnL != null && (
                <span style={{
                  color: s.netPnL >= 0 ? "var(--z-green-hi)" : "var(--z-red-hi)",
                  fontWeight: 700, fontFamily: "var(--z-font-mono)", marginLeft: "auto",
                }}>{fmtUsd(s.netPnL)}</span>
              )}
              {s.closeReason && <span style={{ color: "var(--z-text-3)" }}>· {s.closeReason}</span>}
            </div>
          ))}
        </div>
      )}
    </Card>
  );

  // ═════════════════════════════════════════════════════════
  // RECONCILE
  // ═════════════════════════════════════════════════════════
  const reconcileCard = reconcile.length > 0 && (
    <Card title="일일 Reconcile" subtitle="Binance = 진실 · KV 자동 동기화" icon={<Refresh size={16} />}>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {reconcile.map((r, i) => {
          const hasDrift = r.drift && (r.drift.missing?.length || r.drift.extra?.length || r.drift.mismatch?.length);
          return (
            <div key={i} style={{
              padding: 10, background: "var(--z-card-2)",
              borderRadius: "var(--z-r-sm)", border: `1px solid var(--z-border)`, fontSize: 12,
            }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <span style={{ color: "var(--z-text-3)", fontFamily: "var(--z-font-mono)", fontSize: 11 }}>{fmtDT(r.time)}</span>
                <Badge tone={hasDrift ? "yellow" : "green"} size="sm">{hasDrift ? "DRIFT" : "OK"}</Badge>
                {r.realizedToday != null && (
                  <span style={{
                    marginLeft: "auto", fontFamily: "var(--z-font-mono)", fontWeight: 700,
                    color: r.realizedToday >= 0 ? "var(--z-green-hi)" : "var(--z-red-hi)",
                  }}>Today {fmtUsd(r.realizedToday)}</span>
                )}
              </div>
              {r.drift && (
                <div style={{ color: "var(--z-text-2)", fontSize: 11, marginTop: 4, fontFamily: "var(--z-font-mono)" }}>
                  missing {r.drift.missing?.length || 0} · extra {r.drift.extra?.length || 0} · mismatch {r.drift.mismatch?.length || 0}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );

  // ═════════════════════════════════════════════════════════
  // RISK PRESET
  // ═════════════════════════════════════════════════════════
  const riskPresetCard = (
    <Card title="리스크 프리셋 · Option A 절대수익형" icon={<Shield size={16} />}
      subtitle="api/_shared/risk-manager.js::RISK_CONFIG">
      <div style={{ display: "grid", gap: 8, gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fit, minmax(200px, 1fr))" }}>
        <KV label="트레이드당 리스크" value="0.8% equity" />
        <KV label="최대 증거금 비율" value="35%" />
        <KV label="레버리지 범위" value="2× ~ 5×" />
        <KV label="동시 포지션 한도" value="최대 2 (상관군 분리)" />
        <KV label="SL/TP 방식" value="ATR(14) + 비용 반영" />
        <KV label="최소 net RR" value="1.8R" />
        <KV label="최대 보유 시간" value="48h" />
        <KV label="청산 안전버퍼" value="0.7 × liqDist" />
        <KV label="비용 가정" value="수수료 0.08% + 슬립 0.05%" />
        <KV label="일/주/MDD 한도" value="-4% / -8% / -15%" />
        <KV label="연속손실 쿨다운" value="5회 → 24h" />
        <KV label="심볼 선택" value="exchangeInfo 동적 필터" />
      </div>
      <div style={{
        marginTop: 14, padding: 12, background: "var(--z-blue-bg)",
        border: `1px solid var(--z-blue)33`, borderRadius: "var(--z-r-sm)",
        fontSize: 11, color: "var(--z-text-2)", lineHeight: 1.6,
      }}>
        <Badge tone="blue" size="sm" style={{ marginRight: 6 }}>안전장치</Badge>
        Killswitch fail-closed · Bracket 실패 시 자동 강제청산 · 일일 Reconcile(Binance=진실) · 상관군 제한
      </div>
    </Card>
  );

  // ═════════════════════════════════════════════════════════
  // LAYOUT
  // ═════════════════════════════════════════════════════════
  const tabs = [
    { id: "dashboard", label: "대시보드" },
    { id: "positions", label: `포지션 (${positions.length})` },
  ];

  return (
    <div style={{
      background: "var(--z-bg)", minHeight: "100vh",
      padding: "20px 16px 80px",
      color: "var(--z-text)",
      fontFamily: "var(--z-font-sans)",
    }} className="z-anim-in">
      <div style={{ maxWidth: 1280, margin: "0 auto" }}>
        {header}
        {kpiBar}
        {controlPanel}

        <div style={{ margin: "18px 0 12px" }}>
          <Tabs value={section} onChange={setSection} items={tabs} variant="underline" />
        </div>

        {section === "dashboard" && (
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: !isMobile ? "minmax(0, 2fr) minmax(0, 1fr)" : "1fr" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {positionsCard}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {breakerCard}
            </div>
          </div>
        )}
        {section === "positions" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {positionsCard}
            {orders.length > 0 && (
              <Card title="최근 주문" icon={<Activity size={16} />} pad={0}>
                <Table
                  columns={[
                    { key: "time", label: "시간", render: (o) => fmtTime(o.time), mono: true },
                    { key: "symbol", label: "심볼", render: (o) => <b>{o.symbol}</b> },
                    { key: "side", label: "방향",
                      render: (o) => <Badge tone={o.side === "LONG" || o.side === "BUY" ? "green" : "red"} size="sm">{o.side}</Badge> },
                    { key: "qty", label: "수량", mono: true, align: "right" },
                    { key: "price", label: "체결가", mono: true, align: "right",
                      render: (o) => fmtUsd(o.avgPrice || o.price) },
                    { key: "status", label: "상태",
                      render: (o) => <Badge size="sm">{o.status || "—"}</Badge> },
                  ]}
                  rows={orders.slice(0, 20)}
                />
              </Card>
            )}
          </div>
        )}
        {section === "shadow" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {shadowCard}
          </div>
        )}
        {section === "engine" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {engineLogCard}
            {reconcileCard}
          </div>
        )}
        {section === "config" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {riskPresetCard}
            {breakerCard}
          </div>
        )}
      </div>

      {/* ── Confirm Dialog ── */}
      <Dialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        title={confirm?.title}
        description={confirm?.desc}
        tone={confirm?.tone}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setConfirm(null)}>취소</Button>
            <Button
              variant={confirm?.confirmVariant || "primary"}
              size="sm"
              loading={busy}
              onClick={async () => {
                const action = confirm?.onConfirm;
                setConfirm(null);
                if (action) await action();
              }}>
              {confirm?.confirmLabel || "확인"}
            </Button>
          </>
        }
      />
    </div>
  );
}
