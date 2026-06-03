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
import { supabase } from "./supabaseClient.js";
import { ga } from "./lib/analytics.js";
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
import { useBreakpoint } from "./ui/useBreakpoint.jsx";
import BinanceConnect from "./components/BinanceConnect.jsx";
// ★ 2026-05-09: 옵션 D — 대시보드 강화 7개 위젯
// ★ 2026-05-11: PeriodReturnsCard + OperationalMetrics 추가 (대표 지시: 일/주/월 수익 + 운영 메트릭)
import {
  EquityCurveChart, LiveMetricsRow, PositionDonutChart,
  TradeHistoryTable, DailyPnLHeatmap, SystemStatusIndicator,
  PeriodReturnsCard, OperationalMetrics, CoinDirectionScores,
} from "./ui/dashboard-widgets.jsx";

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

// ★ 2026-06-02 — Supabase 세션 토큰을 Authorization 으로 첨부 (서버 인증 게이트용).
async function authHeaders() {
  try {
    const { data } = await supabase.auth.getSession();
    const t = data?.session?.access_token;
    return t ? { Authorization: `Bearer ${t}` } : {};
  } catch { return {}; }
}
async function jget(url) {
  const r = await fetch(url, { credentials: "same-origin", headers: { ...(await authHeaders()) } });
  return r.json();
}
async function jpost(url, body) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
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
  const watchlistTimerRef = useRef(null);
  const [lastRefresh, setLastRefresh] = useState(null);
  // ★ 2026-06-01: 코인별 롱숏 점수 (시그널 풀 양방향 집계 — 60s 주기)
  const [coinScores, setCoinScores] = useState({ coins: [], counts: {}, loading: false });
  // ★ 2026-06-03: 포지션별 봇 plan (익절/손절가) — 심볼별 맵 (60s 주기)
  const [posPlans, setPosPlans] = useState({});
  // ★ 2026-06-03: 입출금(transfer) 원시 내역 — 수익률에서 입금 부풀림 제거용 (60s 주기)
  //   netFlow 는 카드가 시작자산 샘플 ts 에 맞춰 직접 합산(윈도우 정합 필수).
  const [transfers, setTransfers] = useState(null);
  // ★ SSOT — useBreakpoint. 이전엔 768 미만을 "isMobile" 로 봤음 (iPad 세로 포함).
  // 그 동작 유지하려면 isSmall (< 1024) 을 isMobile 로 매핑.
  const { isSmall } = useBreakpoint();
  const isMobile = isSmall;

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

  // ★ 2026-06-01: 코인 롱숏 점수 — 60초 주기 별도 갱신 (status 와 분리)
  //   (옛 signal-watchlist 는 BUY만 보여줘 제거 — coin-scores 가 양방향 대체)
  const refreshWatchlist = useCallback(async () => {
    if (!userId) return;
    setCoinScores((prev) => ({ ...prev, loading: true }));
    // 코인 롱숏 점수 + 포지션 plan(익절/손절) + 기간별 순입출금 병렬 조회
    const [cs, pp, pf] = await Promise.allSettled([
      jget(`/api/real-trading/coin-scores?limit=30`),
      jget(`/api/real-trading/position-plans?userId=${encodeURIComponent(userId)}`),
      jget(`/api/real-trading/period-returns?userId=${encodeURIComponent(userId)}`),
    ]);
    const c = cs.status === "fulfilled" ? cs.value : null;
    setCoinScores(c?.ok
      ? { coins: c.coins || [], counts: c.counts || {}, loading: false }
      : { coins: [], counts: {}, loading: false });
    const pl = pp.status === "fulfilled" ? pp.value : null;
    if (pl?.ok && Array.isArray(pl.positions)) {
      const map = {};
      for (const x of pl.positions) map[x.symbol] = x;
      setPosPlans(map);
    }
    const fl = pf.status === "fulfilled" ? pf.value : null;
    if (fl?.ok && Array.isArray(fl.transfers)) setTransfers(fl.transfers);
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    refreshWatchlist();
    watchlistTimerRef.current = setInterval(refreshWatchlist, 60_000);
    return () => clearInterval(watchlistTimerRef.current);
  }, [refreshWatchlist, userId]);

  // 데스크톱으로 전환 시 모바일 전용 '상세분석' 탭에 머물러 있으면 대시보드로 복귀
  useEffect(() => {
    if (!isMobile && section === "analysis") setSection("dashboard");
  }, [isMobile, section]);

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
        const shadow = r.shadow ? " → 모의 운영 기록됨" : "";
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
          <div style={{ fontSize: 14, color: "var(--z-text-2)", marginTop: 6 }}>
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
  // ★ 2026-06-03: 헤드라인 '보유 자산'은 바이낸스 메인과 동일하게 마진잔고(지갑+미실현)로 표기.
  //   equity(지갑잔고)는 내부 계산용으로 그대로 유지 — 둘을 분해해 투명하게 보여준다.
  const unrealizedPnl = status?.unrealizedPnl ?? null;
  const marginBalance = status?.marginBalance ?? (equity != null && unrealizedPnl != null ? equity + unrealizedPnl : equity);
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

  // ★ 2026-06-03: 오늘 '순수 매매손익'(입금 제외) — Toss 히어로/요약용.
  //   dayLossPct 는 입금을 수익으로 잡아 부풀려지므로(예 +184%), period-returns 와 동일하게
  //   당일 순입출금을 차감한다. transfers 미도착 시엔 집계 보류(잘못된 큰 숫자 방지).
  const _kstDayStartTs = (() => { const d = 864e5, K = 9 * 36e5, n = Date.now(); return Math.floor((n + K) / d) * d - K; })();
  const _flowsReady = Array.isArray(transfers);
  const _todayNetFlow = _flowsReady ? transfers.reduce((s, t) => ((Number(t.time) || 0) >= _kstDayStartTs ? s + (Number(t.amount) || 0) : s), 0) : 0;
  const todayPnlUsd = (_flowsReady && equity != null && breaker.dayStartEquity)
    ? (equity - breaker.dayStartEquity) - _todayNetFlow : null;
  // %는 '투입 자본'(시작 + 오늘 입금) 기준 — 시작자본만 쓰면 입금으로 %가 폭발(기간카드와 동일 규칙).
  const _todayDeployed = breaker.dayStartEquity ? Math.max(breaker.dayStartEquity + _todayNetFlow, 1) : null;
  const todayPnlPct = (todayPnlUsd != null && _todayDeployed)
    ? (todayPnlUsd / _todayDeployed) * 100 : null;
  // ★ 2026-05-09: MDD 기준점 — 30일 rolling peak 우선, 폴백은 all-time equityHigh
  //   이전: all-time equityHigh 만 사용 → 큰 상승 후엔 정상 조정도 -50% 트리거 위험
  //   이후: 서버가 주는 equityHigh30d 사용 (없으면 equityHigh 로 폴백)
  const mddBaseline = breaker.equityHigh30d || breaker.equityHigh;
  const mddPct = mddBaseline && equity
    ? ((equity - mddBaseline) / mddBaseline) * 100 : 0;

  // ★ 2026-05-09 — 브레이커 한도값 (status API 가 안 내려주면 폴백)
  //   이전엔 UI 에 -4%/-8%/-15% 하드코딩 → 실제 -40%/-60%/-50% 와 불일치.
  //   이제 breaker.limits 가 있으면 그것을, 없으면 폴백 (현재 한도와 일치).
  const breakerLimits = breaker.limits || {
    dailyLossPct: 0.40,
    weeklyLossPct: 0.60,
    mddPct: 0.50,
    consecLossThreshold: 5,
  };
  const dayLimitPct = (breakerLimits.dailyLossPct || 0.40) * 100;   // 40
  const weekLimitPct = (breakerLimits.weeklyLossPct || 0.60) * 100; // 60
  const mddLimitPct = (breakerLimits.mddPct || 0.50) * 100;         // 50
  // ★ 2026-05-29 — 자동정지(breaker) off 모드 감지: 한도가 사실상 무한(99%/9999)이면
  //   "-99% / 0/9999" 같은 의미 없는 한도 막대 대신 "비활성" 안내를 보여준다.
  const breakerOff = (breakerLimits.consecLossThreshold || 0) >= 1000 || dayLimitPct >= 95 || mddLimitPct >= 95;

  // ═════════════════════════════════════════════════════════
  // HEADER (REDESIGNED) — 모바일은 padding 절반
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
      padding: isMobile ? "14px 14px" : "24px 20px",
      marginBottom: isMobile ? 14 : 20,
      // ★ 2026-05-11 fix: 모바일에선 column 레이아웃 (제목 위 + 버튼 아래).
      //   이전: flex-wrap 으로 버튼이 좌측 제목 영역을 침범해 "실전매매관제센터" 글자가 세로로 깨짐.
      //   현재: 모바일은 헤더 전체 column, 버튼은 width 100% 로 다음 줄.
      display: "flex",
      flexDirection: isMobile ? "column" : "row",
      alignItems: isMobile ? "stretch" : "center",
      justifyContent: "space-between",
      flexWrap: "wrap",
      gap: isMobile ? 12 : 16,
    }}>
      <div style={{ flex: 1, minWidth: 0, width: isMobile ? "100%" : "auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 10 : 14, marginBottom: isMobile ? 6 : 10 }}>
          <div style={{
            width: isMobile ? 38 : 48, height: isMobile ? 38 : 48, borderRadius: isMobile ? 10 : 14,
            background: trulyLive
              ? "linear-gradient(135deg, var(--z-red) 0%, #E53935 100%)"
              : "linear-gradient(135deg, var(--z-blue) 0%, #1E40AF 100%)",
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: trulyLive
              ? "0 8px 24px rgba(239, 68, 68, 0.35), inset 0 1px 0 rgba(255,255,255,0.2)"
              : "0 8px 24px rgba(59, 130, 246, 0.25), inset 0 1px 0 rgba(255,255,255,0.15)",
            position: "relative", flexShrink: 0,
          }}>
            {trulyLive && (
              <div className="rt-pulse" style={{
                position: "absolute", inset: 0, borderRadius: isMobile ? 10 : 14,
                background: "rgba(239, 68, 68, 0.3)",
              }} />
            )}
            <Power size={isMobile ? 18 : 24} color="#fff" style={{ position: "relative", zIndex: 1 }} />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: isMobile ? 18 : 28, fontWeight: 900, letterSpacing: "-0.03em", lineHeight: 1 }}>
              실전매매 관제센터
            </div>
            {/* 모바일: 부제(브랜딩) 생략 — 최상단 간소화 */}
            {!isMobile && (
              <div style={{ fontSize: 15, color: "var(--z-text-3)", marginTop: 4 }}>
                Zepta Investment Platform
              </div>
            )}
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
                fontSize: 14,
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
                fontSize: 14,
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
                fontSize: 14,
                fontWeight: 700,
                padding: "6px 12px",
              }}
            >
              ⚡ BREAKER
            </Badge>
          )}
          {/* 2026-05-29 — 알파랩 발굴·튜닝 전략 자동 반영 안내 (실거래 배선 연결) */}
          <Badge
            tone="purple"
            title="알파랩이 2시간마다 발굴·검증한 최적 전략 파라미터가 자동매매 신호에 반영됩니다"
            style={{ fontSize: 13, fontWeight: 700, padding: "6px 12px" }}
          >
            🧬 AI 자동 튜닝
          </Badge>
          <div style={{ fontSize: isMobile ? 13 : 14, color: "var(--z-text-2)", marginLeft: 4 }}>
            {!isMobile && "· Binance USDⓈ-M Futures"}
            {lastRefresh && <> {!isMobile ? "· " : ""}<span style={{ color: "var(--z-text-3)" }}>{fmtTime(lastRefresh)} 기준</span></>}
          </div>
        </div>
      </div>

      {/* ★ 2026-05-11 fix: 모바일 버튼 행 — width 100%, 두 버튼 1:1 grid */}
      <div style={{
        display: isMobile ? "grid" : "flex",
        gridTemplateColumns: isMobile ? "1fr 1fr" : undefined,
        gap: 8,
        flexWrap: isMobile ? undefined : "wrap",
        width: isMobile ? "100%" : "auto",
      }}>
        {/* Alpha Lab 진입 버튼 — 사용자 직접 URL 입력 없이 한 클릭으로 */}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            try { window.location.href = "/alpha-lab"; } catch {}
          }}
          leftIcon={<Target size={14} />}
          style={{
            whiteSpace: "nowrap", minHeight: 44,
            background: "linear-gradient(135deg, rgba(168, 85, 247, 0.12), rgba(147, 51, 234, 0.06))",
            border: "1px solid rgba(168, 85, 247, 0.3)",
            color: "var(--z-purple)",
            justifyContent: "center",
          }}
        >
          🧬 Alpha Lab
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={refresh}
          leftIcon={loading ? <Spinner size={14} /> : <Refresh size={14} />}
          style={{ whiteSpace: "nowrap", minHeight: 44, justifyContent: "center" }}
        >
          새로고침
        </Button>
      </div>
    </div>
  );

  // ═════════════════════════════════════════════════════════
  // KPI BAR (재설계 — 모바일: 1 큰 hero + 4 작은 셀, 데스크탑: 기존 5분할)
  // ═════════════════════════════════════════════════════════
  const heroEquity = (
    <div style={{
      position: "relative", overflow: "hidden",
      background: "var(--z-card)",
      backdropFilter: "var(--z-card-blur, none)", WebkitBackdropFilter: "var(--z-card-blur, none)",
      border: "1px solid var(--z-border)",
      borderRadius: "var(--z-r-lg)",
      padding: isMobile ? "16px 16px 16px 18px" : "22px 24px 22px 26px",
      display: "flex", flexDirection: "column",
      justifyContent: isMobile ? "flex-start" : "space-between",
      gap: isMobile ? 14 : 18,
      gridRow: isMobile ? undefined : "span 2",
    }}>
      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: "var(--z-blue)" }} />
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: isMobile ? 10 : 0 }}>
        <div style={{
          width: isMobile ? 36 : 44, height: isMobile ? 36 : 44, borderRadius: 12,
          background: "linear-gradient(135deg, var(--z-blue) 0%, #1E40AF 100%)",
          display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          boxShadow: "0 4px 12px rgba(59, 130, 246, 0.3)",
        }}>
          <Wallet size={isMobile ? 16 : 20} color="#fff" />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, color: "var(--z-text-3)", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>
            보유 자산 <span style={{ textTransform: "none", fontWeight: 500, fontSize: 11.5, opacity: 0.8 }}>· 마진 잔고</span>
          </div>
          <div style={{ fontSize: isMobile ? 28 : 40, fontWeight: 900, marginTop: 4, lineHeight: 1, fontFamily: "var(--z-font-mono)", letterSpacing: "-0.02em" }}>
            {loading && marginBalance == null ? (
              <Skeleton width={140} height={isMobile ? 28 : 40} />
            ) : (
              fmtUsd(marginBalance)
            )}
          </div>
          {/* 바이낸스 '마진 잔고' = 지갑잔고 + 미실현. 안 맞아 보이던 차이를 분해해 투명하게 표시 */}
          {marginBalance != null && unrealizedPnl != null && (
            <div style={{ fontSize: 11.5, color: "var(--z-text-3)", marginTop: 5, lineHeight: 1.3 }}>
              지갑 {fmtUsd(equity, 2)}
              <span style={{ color: unrealizedPnl > 0 ? "var(--z-green-hi)" : unrealizedPnl < 0 ? "var(--z-red-hi)" : "var(--z-text-3)" }}>
                {" "}· 미실현 {unrealizedPnl >= 0 ? "+" : ""}{fmtUsd(unrealizedPnl, 2)}
              </span>
            </div>
          )}
        </div>
        {/* 모바일: 일손익을 hero 우측에 inline 표시 (스크롤 없이 한눈에) */}
        {isMobile && (
          <div style={{
            textAlign: "right",
            paddingLeft: 8,
            borderLeft: "1px solid rgba(59, 130, 246, 0.15)",
          }}>
            <div style={{ fontSize: 14, color: "var(--z-text-3)", fontWeight: 600 }}>오늘</div>
            <div style={{
              fontSize: 16, fontWeight: 800, lineHeight: 1.2,
              color: dayLossPct < 0 ? "var(--z-red-hi)" : dayLossPct > 0 ? "var(--z-green-hi)" : "var(--z-text)",
              fontFamily: "var(--z-font-mono)",
            }}>
              {fmtPct(dayLossPct)}
            </div>
          </div>
        )}
      </div>
      <div style={{
        display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr",
        paddingTop: 10, borderTop: "1px solid rgba(59, 130, 246, 0.1)",
      }}>
        <div title="오늘 0시 기준 시작 잔고입니다. 오늘 손익은 이 금액과 비교해 계산돼요.">
          <div style={{ fontSize: 14, color: "var(--z-text-3)", marginBottom: 4 }}>오늘 시작 잔고</div>
          <div style={{ fontSize: 14, fontWeight: 700, fontFamily: "var(--z-font-mono)" }}>
            {breaker.dayStartEquity ? fmtUsd(breaker.dayStartEquity) : "—"}
          </div>
        </div>
        <div title="낙폭(최대 하락폭)을 계산하는 기준선 — 최근 30일 중 가장 높았던 잔고입니다.">
          <div style={{ fontSize: 14, color: "var(--z-text-3)", marginBottom: 4 }}>
            낙폭 기준선 (30일 최고) ⓘ
            {breaker.equityHigh && breaker.equityHigh30d && breaker.equityHigh > breaker.equityHigh30d && (
              <span style={{ marginLeft: 6, fontSize: 14, color: "var(--z-text-3)" }}>
                · 역대 {fmtUsd(breaker.equityHigh)}
              </span>
            )}
          </div>
          <div style={{ fontSize: 14, fontWeight: 700, fontFamily: "var(--z-font-mono)", color: "var(--z-green-hi)" }}>
            {mddBaseline ? fmtUsd(mddBaseline) : "—"}
          </div>
        </div>
      </div>
    </div>
  );

  // 4개 보조 메트릭 카드 빌더 — 프리미엄 다크 (2026-05-29 재디자인)
  //   탁한 그라디언트 배경 제거 → 솔리드 카드 + 좌측 얇은 accent 바 + 색은 숫자에만.
  //   tip: label 옆 ⓘ + hover/길게누르기 툴팁.
  const renderMetricCard = ({ label, value, color, hint, accent, tip }) => (
    <div title={tip || undefined} style={{
      position: "relative", overflow: "hidden",
      background: "var(--z-card)",
      backdropFilter: "var(--z-card-blur, none)", WebkitBackdropFilter: "var(--z-card-blur, none)",
      border: "1px solid var(--z-border)",
      borderRadius: "var(--z-r-lg)",
      padding: isMobile ? "15px 15px 15px 17px" : "18px 18px 18px 20px",
      display: "flex", flexDirection: "column", gap: isMobile ? 7 : 9,
      minHeight: isMobile ? "auto" : "100%",
    }}>
      {accent && <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: accent }} />}
      <div style={{
        fontSize: isMobile ? 12.5 : 13, color: "var(--z-text-3)",
        fontWeight: 600, letterSpacing: 0.1,
        display: "flex", alignItems: "center", gap: 3,
      }}>
        {label}
        {tip && <span style={{ opacity: 0.45, fontSize: 11, cursor: "help" }}>ⓘ</span>}
      </div>
      <div style={{
        fontSize: isMobile ? 22 : 27, fontWeight: 800, lineHeight: 1.0,
        color: color || "var(--z-text)", fontFamily: "var(--z-font-mono)", letterSpacing: "-0.015em",
      }}>
        {value}
      </div>
      {hint && (
        <div style={{ fontSize: isMobile ? 11.5 : 12.5, color: "var(--z-text-3)", lineHeight: 1.4 }}>
          {hint}
        </div>
      )}
    </div>
  );

  const metricCards = [
    {
      key: "pnl",
      el: !isMobile ? renderMetricCard({
        label: "오늘 손익", value: fmtPct(dayLossPct),
        tip: "오늘 시작 잔고 대비 지금까지의 손익률입니다.",
        color: dayLossPct < 0 ? "var(--z-red-hi)" : dayLossPct > 0 ? "var(--z-green-hi)" : "var(--z-text)",
        hint: <>하루 손실 한도 <span style={{ fontWeight: 700 }}>-{dayLimitPct.toFixed(0)}%</span></>,
        accent: dayLossPct < 0 ? "var(--z-red)" : dayLossPct > 0 ? "var(--z-green)" : "var(--z-text-3)",
      }) : null, // 모바일에선 hero 안에 흡수됨
    },
    {
      key: "mdd",
      el: renderMetricCard({
        label: "최대 낙폭", value: fmtPct(mddPct),
        tip: "고점(30일 최고 잔고) 대비 지금까지 가장 크게 떨어진 폭입니다. 작을수록 안정적이에요.",
        color: mddPct < -10 ? "var(--z-red-hi)" : mddPct < -5 ? "var(--z-yellow-hi)" : "var(--z-purple)",
        hint: <>자동정지 한도 <span style={{ fontWeight: 700 }}>-{mddLimitPct.toFixed(0)}%</span></>,
        accent: mddPct < -8 ? "var(--z-red)" : "var(--z-purple)",
      }),
    },
    {
      key: "open",
      // ★ 2026-05-09 대표 지시: 동시 거래 개수 제한 표기 제거.
      //   실제 한도는 maxConcurrentPositions 10 + 합산 노셔널 cap (자본의 1.5배) 으로
      //   자연 제한. 개수 자체는 제한 아님 (= 노셔널 안에서 무제한).
      el: renderMetricCard({
        label: "진행 거래", value: positions.length,
        tip: "지금 열려 있는 포지션(매매) 개수입니다.",
        color: "var(--z-text)",
        hint: "포지션 총액 한도 내에서 자동 진입",
        accent: positions.length > 0 ? "var(--z-blue)" : "var(--z-text-3)",
      }),
    },
    {
      key: "loss",
      el: renderMetricCard({
        label: "연속 손실", value: `${breaker.consecLosses || 0}회`,
        tip: "연달아 손실이 난 횟수입니다. 한도에 닿으면 봇이 잠시 매매를 멈추고 쉬어갑니다.",
        color: (breaker.consecLosses || 0) >= 3 ? "var(--z-red-hi)" : "var(--z-text)",
        hint: "연속 손실 시 자동 휴식",
        accent: (breaker.consecLosses || 0) >= 3 ? "var(--z-red)" : "var(--z-text-3)",
      }),
    },
  ].filter(m => m.el);

  // ═════════════════════════════════════════════════════════
  // ★ 2026-06-03: Toss형 히어로 (모바일) — 큰 카드·여백·핵심만 (대표 지시: 획기적 개편)
  //   보유자산 + 오늘 매매손익(입금 제외) + 상태칩 1줄. 4개 보조카드는 운영메트릭/수익카드로 이관.
  // ═════════════════════════════════════════════════════════
  const sigShort = coinScores?.counts?.short ?? 0;
  const sigLong = coinScores?.counts?.long ?? 0;
  const tossChipStyle = {
    fontSize: 12.5, fontWeight: 700, padding: "7px 12px", borderRadius: 999,
    background: "var(--z-card-2)", border: "1px solid var(--z-border)", color: "var(--z-text-2)",
    whiteSpace: "nowrap",
  };
  const tossHero = (
    <div style={{
      borderRadius: 22, padding: "22px 20px",
      background: "linear-gradient(165deg, var(--z-card) 0%, var(--z-card-2) 120%)",
      backdropFilter: "var(--z-card-blur, none)", WebkitBackdropFilter: "var(--z-card-blur, none)",
      border: "1px solid var(--z-border)", boxShadow: "0 10px 30px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.05)",
      display: "flex", flexDirection: "column", gap: 16,
    }}>
      {/* 보유 자산 */}
      <div>
        <div style={{ fontSize: 13, color: "var(--z-text-3)", fontWeight: 600 }}>보유 자산 · 마진 잔고</div>
        <div style={{ fontSize: 40, fontWeight: 900, lineHeight: 1.02, fontFamily: "var(--z-font-mono)", letterSpacing: "-0.025em", marginTop: 3 }}>
          {marginBalance == null ? <Skeleton width={170} height={40} /> : fmtUsd(marginBalance)}
        </div>
        {marginBalance != null && unrealizedPnl != null && (
          <div style={{ fontSize: 12.5, color: "var(--z-text-3)", marginTop: 7 }}>
            지갑 {fmtUsd(equity, 2)}
            <span style={{ color: unrealizedPnl > 0 ? "var(--z-green-hi)" : unrealizedPnl < 0 ? "var(--z-red-hi)" : "var(--z-text-3)" }}>
              {" "}· 미실현 {unrealizedPnl >= 0 ? "+" : ""}{fmtUsd(unrealizedPnl, 2)}
            </span>
          </div>
        )}
      </div>
      {/* 오늘 매매손익 — 입금 제외 (강조 pill) */}
      <div style={{
        borderRadius: 16, padding: "15px 17px",
        background: todayPnlUsd == null ? "var(--z-card-2)"
          : todayPnlUsd >= 0 ? "rgba(16,216,132,0.10)" : "rgba(255,77,100,0.10)",
        border: `1px solid ${todayPnlUsd == null ? "var(--z-border)" : todayPnlUsd >= 0 ? "rgba(16,216,132,0.25)" : "rgba(255,77,100,0.25)"}`,
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
      }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, color: "var(--z-text-2)", fontWeight: 700 }}>오늘 매매손익</div>
          <div style={{ fontSize: 10.5, color: "var(--z-text-3)", marginTop: 2 }}>입금 제외 · 실현 기준</div>
        </div>
        <div style={{ textAlign: "right", whiteSpace: "nowrap", flexShrink: 0 }}>
          <div style={{
            fontSize: 23, fontWeight: 900, fontFamily: "var(--z-font-mono)", letterSpacing: "-0.01em", lineHeight: 1.05,
            color: todayPnlUsd == null ? "var(--z-text-3)" : todayPnlUsd >= 0 ? "var(--z-green-hi)" : "var(--z-red-hi)",
          }}>
            {todayPnlUsd == null ? "집계 중" : `${todayPnlUsd >= 0 ? "▲ +" : "▼ −"}${fmtUsd(Math.abs(todayPnlUsd), 1)}`}
          </div>
          {todayPnlPct != null && (
            <div style={{ fontSize: 12.5, fontWeight: 700, marginTop: 2, fontFamily: "var(--z-font-mono)",
              color: todayPnlUsd >= 0 ? "var(--z-green-hi)" : "var(--z-red-hi)", opacity: 0.85 }}>
              {todayPnlPct >= 0 ? "+" : ""}{todayPnlPct.toFixed(1)}%
            </div>
          )}
        </div>
      </div>
      {/* 상태 칩 1줄 */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <span style={{ ...tossChipStyle, color: trulyLive ? "var(--z-green-hi)" : killOn ? "var(--z-text-2)" : "var(--z-yellow-hi)" }}>
          {trulyLive ? "🟢 가동중" : killOn ? "⊙ 대기" : "⚡ 정지"}
        </span>
        <span style={tossChipStyle}>📉 신호 {sigShort}숏{sigLong > 0 ? ` · ${sigLong}롱` : ""}</span>
        <span style={tossChipStyle}>💼 포지션 {positions.length}개</span>
      </div>
    </div>
  );

  const kpiBar = (
    <div style={{ marginBottom: 20 }}>
      {/* hero */}
      <div style={{ marginBottom: isMobile ? 10 : 12 }}>
        {!isMobile ? (
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "2fr 1fr 1fr" }}>
            {heroEquity}
            {metricCards.find(m => m.key === "pnl")?.el}
            {metricCards.find(m => m.key === "mdd")?.el}
            {metricCards.find(m => m.key === "open")?.el}
            {metricCards.find(m => m.key === "loss")?.el}
          </div>
        ) : (
          // 모바일: Toss형 단일 히어로 카드 (큰 숫자·여백·상태칩) — 4개 보조카드 그리드 폐지
          tossHero
        )}
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
      // iPhone 16 (393pt) 기준 — 모바일에선 가용 폭 절약 위해 padding 축소
      padding: isMobile ? "14px 12px" : "20px",
      marginBottom: isMobile ? 14 : 20,
      display: "flex", flexDirection: "column", gap: isMobile ? 12 : 16,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Settings size={18} color="var(--z-text-2)" />
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--z-text-2)" }}>
            매매 제어 센터
          </div>
        </div>
        {trulyLive ? (
          <Badge tone="green" dot style={{ fontSize: 14, fontWeight: 700, padding: "6px 10px" }}>
            ✓ 실거래 중
          </Badge>
        ) : (
          <Badge tone="default" style={{ fontSize: 14, fontWeight: 700, padding: "6px 10px" }}>
            ⊙ 대기 중
          </Badge>
        )}
      </div>

      <div style={{
        display: "grid",
        gap: 10,
        // 모바일: 시작/중지 1행, 일시정지/재개 1행, 긴급정지 별도 1행 (위험 액션 분리)
        // 데스크탑: 1열로 정렬 [시작 / 일시정지 / 빈 / 긴급정지]
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
              onConfirm: () => {
                // GA4 — 실거래 활성화 이벤트
                ga.realTradingStarted("live");
                act("enable", {}, "실거래 시작 완료");
              },
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
              background: "var(--z-card-2)",
              color: "var(--z-yellow-hi)",
              boxShadow: "none",
              border: "1px solid rgba(255, 176, 32, 0.45)",
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
          fontSize: 14,
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
          fontSize: 14,
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
    <Card title="6단계 안전 활성화 가이드" subtitle="순서대로 따라가시면 안전하게 실거래를 시작할 수 있어요" icon={<Target size={16} />}>
      {[
        { n: 1, title: "한 번 모의 실행", desc: "실제 돈은 안 쓰고 전체 시스템이 잘 돌아가는지 한 번 점검합니다. 시그널이 없으면 자동으로 가짜 신호를 만들어서 테스트해요.", done: engineLog.some(e => e.shadow || e.dryRun) },
        { n: 2, title: "모의 운영 시작 (Shadow)", desc: "내 돈은 안 쓰면서 2~4주 동안 가상 거래를 쌓습니다. 승률·누적 손익·평균 손익비를 관찰해요.", done: shadowOn },
        { n: 3, title: "모의 운영 결과 검증", desc: "누적 손익이 플러스 + 평균 손익비 ≥ 1.5 인지 확인하고 다음 단계로 갑니다.", done: (shadow.summary?.trades || 0) >= 10 && (shadow.summary?.netPnL || 0) > 0 },
        { n: 4, title: "실거래 등록", desc: "이 계정을 실거래 엔진 대상에 추가합니다. 안전잠금은 여전히 켜져 있어 거래는 일어나지 않아요.", done: phase1On },
        { n: 5, title: "안전잠금 해제", desc: "이 시점부터 5분 안에 실거래가 시작될 수 있습니다. 소액부터 시작하세요.", done: !killOn },
        { n: 6, title: "주기적 모니터링", desc: "진행 중 거래·엔진 로그·계정 동기화·차단기 상태를 하루 1~2회 확인합니다.", done: trulyLive },
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
            fontSize: 14, fontWeight: 800,
            border: `1px solid ${step.done ? "var(--z-green)" : "var(--z-border-2)"}`,
          }}>
            {step.done ? <Check size={16} /> : step.n}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: step.done ? "var(--z-text)" : "var(--z-text-2)" }}>
              {step.title}
              {step.done && <Badge tone="green" size="sm" style={{ marginLeft: 8 }}>완료</Badge>}
            </div>
            <div style={{ fontSize: 14, color: "var(--z-text-3)", marginTop: 3, lineHeight: 1.5 }}>
              {step.desc}
            </div>
          </div>
        </div>
      ))}
    </Card>
  );

  // ═════════════════════════════════════════════════════════
  // OPEN POSITIONS — 모바일은 카드 형식 (Table 가로 스크롤 회피)
  // ═════════════════════════════════════════════════════════
  const renderPositionCard = (p, idx) => {
    const isLong = p.positionAmt > 0;
    const pnl = p.unRealizedProfit || 0;
    const pnlPct = p.entryPrice > 0
      ? ((p.markPrice - p.entryPrice) / p.entryPrice) * (isLong ? 100 : -100) * (p.leverage || 1)
      : 0;
    return (
      <div key={`${p.symbol}-${idx}`} style={{
        padding: 14,
        background: "var(--z-card-2)",
        border: `1px solid var(--z-border)`,
        borderRadius: "var(--z-r-md)",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}>
        {/* 헤더 — 심볼 + 방향 + 손익 (큰 글씨) */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <span style={{ fontSize: 16, fontWeight: 800, color: "var(--z-text)" }}>{p.symbol}</span>
            <Badge tone={isLong ? "green" : "red"} size="sm">
              {isLong ? "롱" : "숏"} {p.leverage}×
            </Badge>
          </div>
          <div style={{ textAlign: "right", flexShrink: 0 }}>
            <div style={{
              fontSize: 18, fontWeight: 900, lineHeight: 1,
              color: pnl >= 0 ? "var(--z-green-hi)" : "var(--z-red-hi)",
              fontFamily: "var(--z-font-mono)",
            }}>
              {pnl >= 0 ? "+" : ""}{fmtUsd(pnl)}
            </div>
            <div style={{
              fontSize: 14, fontWeight: 700, marginTop: 2,
              color: pnl >= 0 ? "var(--z-green-hi)" : "var(--z-red-hi)",
            }}>
              {pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(2)}%
            </div>
          </div>
        </div>

        {/* 본문 — 수량/진입/현재 (가로 분할) */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: 8,
          paddingTop: 10,
          borderTop: `1px solid var(--z-border)`,
        }}>
          <div>
            <div style={{ fontSize: 14, color: "var(--z-text-3)", marginBottom: 2 }}>수량</div>
            <div style={{ fontSize: 14, fontWeight: 700, fontFamily: "var(--z-font-mono)" }}>
              {fmtQty(Math.abs(p.positionAmt))}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 14, color: "var(--z-text-3)", marginBottom: 2 }}>진입가</div>
            <div style={{ fontSize: 14, fontWeight: 700, fontFamily: "var(--z-font-mono)" }}>
              {fmtUsd(p.entryPrice)}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 14, color: "var(--z-text-3)", marginBottom: 2 }}>현재가</div>
            <div style={{
              fontSize: 14, fontWeight: 700, fontFamily: "var(--z-font-mono)",
              color: p.markPrice > p.entryPrice
                ? (isLong ? "var(--z-green-hi)" : "var(--z-red-hi)")
                : (isLong ? "var(--z-red-hi)" : "var(--z-green-hi)"),
            }}>
              {fmtUsd(p.markPrice)}
            </div>
          </div>
        </div>

        {/* ★ 2026-06-03 익절/손절 (봇 plan) — 진입 시 저장된 실제 TP/SL */}
        {(() => {
          const plan = posPlans[p.symbol];
          if (!plan) return null;
          if (!plan.hasPlan) {
            return (
              <div style={{ paddingTop: 10, borderTop: "1px solid var(--z-border)", fontSize: 12, color: "var(--z-text-3)" }}>
                수동 포지션 · 봇 익절/손절 관리 밖
              </div>
            );
          }
          return (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, paddingTop: 10, borderTop: "1px solid var(--z-border)" }}>
              <div>
                <div style={{ fontSize: 12, color: "var(--z-text-3)", marginBottom: 2 }}>익절 (TP)</div>
                <div style={{ fontSize: 14, fontWeight: 700, fontFamily: "var(--z-font-mono)", color: "var(--z-green-hi)" }}>
                  {fmtUsd(plan.tpPrice)}
                  {plan.distToTpPct != null && <span style={{ fontSize: 11, color: "var(--z-text-3)", marginLeft: 4 }}>{Math.abs(plan.distToTpPct)}%</span>}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: "var(--z-text-3)", marginBottom: 2 }}>손절 (SL)</div>
                <div style={{ fontSize: 14, fontWeight: 700, fontFamily: "var(--z-font-mono)", color: "var(--z-red-hi)" }}>
                  {fmtUsd(plan.slPrice)}
                  {plan.distToSlPct != null && <span style={{ fontSize: 11, color: "var(--z-text-3)", marginLeft: 4 }}>{Math.abs(plan.distToSlPct)}%</span>}
                </div>
              </div>
            </div>
          );
        })()}
      </div>
    );
  };

  const positionsCard = (
    <Card
      title="진행 중 거래"
      icon={<Activity size={16} />}
      actions={<Badge tone={positions.length > 0 ? "blue" : "default"}>{positions.length}</Badge>}
      pad={positions.length === 0 || isMobile ? 0 : undefined}
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
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>진행 중 거래 없음</div>
          <div style={{ fontSize: 14, color: "var(--z-text-3)", lineHeight: 1.5 }}>
            실거래가 활성화되고 시그널이 발생하면<br />여기에 포지션이 표시됩니다.
          </div>
        </div>
      ) : isMobile ? (
        // ★ 모바일 — 카드 그리드 (Table 가로 스크롤 회피)
        <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
          {positions.map((p, i) => renderPositionCard(p, i))}
        </div>
      ) : (
        // 데스크탑 — 기존 Table 유지
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
            { key: "tpsl", label: "익절 / 손절", align: "right",
              render: (p) => {
                const plan = posPlans[p.symbol];
                if (!plan) return "—";
                if (!plan.hasPlan) return <span style={{ color: "var(--z-text-3)", fontSize: 12 }}>수동</span>;
                return (
                  <div style={{ fontFamily: "var(--z-font-mono)", fontSize: 12, lineHeight: 1.5 }}>
                    <div style={{ color: "var(--z-green-hi)" }}>{fmtUsd(plan.tpPrice)}</div>
                    <div style={{ color: "var(--z-red-hi)" }}>{fmtUsd(plan.slPrice)}</div>
                  </div>
                );
              }
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
    <Card title="안전장치 (자동정지)" icon={<Shield size={16} />}
      subtitle={breakerOff
        ? "현재 비활성 — 손실이 나도 멈추지 않고 계속 운영·학습합니다"
        : `일 -${dayLimitPct.toFixed(0)}% · 주 -${weekLimitPct.toFixed(0)}% · 낙폭 -${mddLimitPct.toFixed(0)}% · ${breakerLimits.consecLossThreshold}연속손실 → 24h 휴식`}>
      {breakerOff ? (
        // 자동정지 off — 의미 없는 -99%/9999 막대 대신 명확한 안내
        <div style={{
          padding: "13px 15px", background: "var(--z-card-2)",
          border: "1px solid var(--z-border)", borderRadius: "var(--z-r-md)",
          display: "flex", gap: 11, alignItems: "flex-start",
        }}>
          <span style={{ fontSize: 18, lineHeight: 1.2 }}>🟢</span>
          <div style={{ fontSize: 13, color: "var(--z-text-2)", lineHeight: 1.55 }}>
            자동정지(일·주 손실 한도, 낙폭 한도, 연속손실 차단)가 <b style={{ color: "var(--z-text-1)" }}>꺼져 있습니다</b>.
            손실이 나도 멈추지 않고 계속 매매하며 전략을 학습합니다.
            단, 개별 거래의 손절(SL)·익절(TP)은 정상 작동합니다.
          </div>
        </div>
      ) : (
      // ★ 2026-05-11 fix: 손실 한도 막대는 "음수 (손실)" 일 때만 채움.
      <div style={{ display: "grid", gap: 10, gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fit, minmax(220px, 1fr))" }}>
        <div>
          <Progress
            label={`일 손익 ${fmtPct(dayLossPct)} / -${dayLimitPct.toFixed(0)}%`}
            value={dayLossPct >= 0 ? 0 : Math.min(100, (Math.abs(dayLossPct) / dayLimitPct) * 100)}
            tone={dayLossPct >= 0 ? "default" : Math.abs(dayLossPct) >= dayLimitPct * 0.75 ? "red" : Math.abs(dayLossPct) >= dayLimitPct * 0.5 ? "yellow" : "green"}
          />
        </div>
        <div>
          <Progress
            label={`주 손익 ${fmtPct(weekLossPct)} / -${weekLimitPct.toFixed(0)}%`}
            value={weekLossPct >= 0 ? 0 : Math.min(100, (Math.abs(weekLossPct) / weekLimitPct) * 100)}
            tone={weekLossPct >= 0 ? "default" : Math.abs(weekLossPct) >= weekLimitPct * 0.75 ? "red" : Math.abs(weekLossPct) >= weekLimitPct * 0.5 ? "yellow" : "green"}
          />
        </div>
        <div>
          <Progress
            label={`최대 낙폭 ${fmtPct(mddPct)} / -${mddLimitPct.toFixed(0)}%`}
            value={mddPct >= 0 ? 0 : Math.min(100, (Math.abs(mddPct) / mddLimitPct) * 100)}
            tone={mddPct >= 0 ? "default" : Math.abs(mddPct) >= mddLimitPct * 0.75 ? "red" : Math.abs(mddPct) >= mddLimitPct * 0.5 ? "yellow" : "green"}
          />
        </div>
        <div>
          <Progress
            label={`연속 손실 ${breaker.consecLosses || 0}/${breakerLimits.consecLossThreshold}`}
            value={((breaker.consecLosses || 0) / breakerLimits.consecLossThreshold) * 100}
            tone={(breaker.consecLosses || 0) >= breakerLimits.consecLossThreshold - 1 ? "red" : (breaker.consecLosses || 0) >= breakerLimits.consecLossThreshold - 2 ? "yellow" : "green"}
          />
        </div>
      </div>
      )}
      <div style={{ marginTop: 14, display: "grid", gap: 8, gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(auto-fit, minmax(160px, 1fr))", fontSize: 14 }}>
        <KV label="오늘 시작 잔고" value={fmtUsd(breaker.dayStartEquity)} />
        <KV label="이번 주 시작" value={fmtUsd(breaker.weekStartEquity)} />
        <KV label="낙폭 기준선 (30일 최고)" value={fmtUsd(mddBaseline)} />
        <KV label="쿨다운 종료"
          value={breaker.cooldownUntil && breaker.cooldownUntil > Date.now()
            ? fmtDT(breaker.cooldownUntil) : "—"} mono={false} />
      </div>

      {/* ★ 2026-05-09: MDD 기준점 리셋 버튼 — 큰 상승 후 정상 조정도 -50% 트리거 위험 시 사용 */}
      {breaker.equityHigh && equity && breaker.equityHigh > equity * 1.05 && (
        <div style={{
          marginTop: 14, padding: "10px 12px",
          background: "rgba(168, 85, 247, 0.08)",
          border: "1px solid rgba(168, 85, 247, 0.2)",
          borderRadius: "var(--z-r-md)",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          gap: 10, flexWrap: "wrap",
        }}>
          <div style={{ fontSize: 14, color: "var(--z-text-2)", lineHeight: 1.5 }}>
            <strong style={{ color: "var(--z-purple)" }}>낙폭 기준선 재설정</strong>
            <br />
            현재 잔고보다 30일 최고가 {((breaker.equityHigh / equity - 1) * 100).toFixed(1)}% 높습니다 — 큰 상승 뒤 정상 조정에도 자동정지가 걸릴 수 있어요. 현재 잔고를 새 기준선으로 잡으려면 누르세요.
          </div>
          <button
            onClick={() => setConfirm({
              tone: "warn",
              title: "MDD 기준점을 현재 잔고로 재설정",
              desc: `현재 30일 최고 ${fmtUsd(mddBaseline)} → 현재 잔고 ${fmtUsd(equity)} 로 재설정합니다.\n낙폭(MDD) 카운터가 0% 부터 다시 시작됩니다. 자동정지 상태는 변경되지 않습니다.`,
              confirmLabel: "재설정",
              confirmVariant: "primary",
              onConfirm: () => act("reset-mdd-baseline", { currentEquity: equity }, "MDD 기준점 재설정 완료"),
            })}
            disabled={busy}
            style={{
              padding: "6px 12px", fontSize: 14, fontWeight: 600,
              background: "var(--z-purple)", color: "#fff",
              border: "none", borderRadius: "var(--z-r-md)",
              cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.5 : 1,
            }}
          >
            기준점 재설정
          </button>
        </div>
      )}
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
        <EmptyState
          icon={<Gauge size={26} />}
          title="아직 실행 기록이 없어요"
          description='5분마다 자동으로 엔진이 돌면서 기록이 쌓입니다. 지금 바로 보고 싶으시면 위쪽 "모의실행" 버튼을 한 번 눌러보세요.'
        />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 360, overflowY: "auto" }}>
          {engineLog.map((e, i) => (
            <div key={i} style={{
              padding: 12, background: "var(--z-card-2)",
              borderRadius: "var(--z-r-md)", border: `1px solid var(--z-border)`,
              fontSize: 14,
            }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 4 }}>
                <span style={{ color: "var(--z-text-3)", fontFamily: "var(--z-font-mono)", fontSize: 14 }}>
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
                <div style={{ color: "var(--z-text-2)", fontSize: 14, fontFamily: "var(--z-font-mono)" }}>
                  qty {fmtQty(e.plan.qty)} · {e.plan.leverage}× · SL {fmtUsd(e.plan.slPrice)} · TP {fmtUsd(e.plan.tpPrice)}{e.plan.bumpedToMin ? " · bumped" : ""}
                  {e.plan.effectiveRR && <> · RR {e.plan.effectiveRR.toFixed(2)}</>}
                </div>
              )}
              {e.result?.orderId && (
                <div style={{ color: "var(--z-text-3)", fontSize: 14, fontFamily: "var(--z-font-mono)" }}>
                  orderId: {e.result.orderId}
                </div>
              )}
              {e.result?.bracketRescue && (
                <div style={{
                  marginTop: 6, padding: "6px 10px", background: "var(--z-red-bg)",
                  border: `1px solid var(--z-red)55`, borderRadius: "var(--z-r-xs)",
                  color: "var(--z-red-hi)", fontSize: 14, fontWeight: 700,
                  display: "flex", alignItems: "center", gap: 6,
                }}>
                  <AlertIcon size={12} />
                  Bracket 실패 → 강제 청산 실행됨 ({e.result.bracketRescue.reason || "SL attach failed"})
                </div>
              )}
              {e.reason && !e.signal && (
                <div style={{ color: "var(--z-text-3)", fontSize: 14 }}>reason: {e.reason}</div>
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
      title="모의 운영 (Shadow)"
      subtitle="실거래 없이 전체 시스템을 기록 · 수수료 + 슬리피지 반영"
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
              display: "flex", gap: 14, flexWrap: "wrap", fontSize: 14,
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
              <div style={{ fontSize: 14, color: "var(--z-text-3)", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>전략 family 별</div>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 14 }}>
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
          title="가상 매매 기록이 아직 없어요"
          description={`실제 돈은 안 쓰고 "이 시그널이 만약 나갔다면 어떻게 됐을까"를 추적하는 영역이에요. 위쪽 "모의실행" 버튼을 누르면 즉시 1건이 기록되고, 그 이후엔 5분마다 자동으로 쌓입니다.`}
        />
      )}
      {shadow.recent?.length > 0 && (
        <div style={{ marginTop: 6, maxHeight: 260, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
          {shadow.recent.map((s, i) => (
            <div key={s.id || i} style={{
              padding: 10, background: "var(--z-card-2)",
              borderRadius: "var(--z-r-sm)", border: `1px solid var(--z-border)`,
              fontSize: 14, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center",
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
              borderRadius: "var(--z-r-sm)", border: `1px solid var(--z-border)`, fontSize: 14,
            }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <span style={{ color: "var(--z-text-3)", fontFamily: "var(--z-font-mono)", fontSize: 14 }}>{fmtDT(r.time)}</span>
                <Badge tone={hasDrift ? "yellow" : "green"} size="sm">{hasDrift ? "DRIFT" : "OK"}</Badge>
                {r.realizedToday != null && (
                  <span style={{
                    marginLeft: "auto", fontFamily: "var(--z-font-mono)", fontWeight: 700,
                    color: r.realizedToday >= 0 ? "var(--z-green-hi)" : "var(--z-red-hi)",
                  }}>Today {fmtUsd(r.realizedToday)}</span>
                )}
              </div>
              {r.drift && (
                <div style={{ color: "var(--z-text-2)", fontSize: 14, marginTop: 4, fontFamily: "var(--z-font-mono)" }}>
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
        {/* ★ 2026-05-09: 옛 하드코딩 값 (0.8%, 35%, 2×~5×, 최대 2) 정정 — 현재 RISK_CONFIG 일치 */}
        <KV label="트레이드당 리스크" value="10% equity" />
        <KV label="최대 증거금 비율" value="50% (단일) · 60% (합산)" />
        <KV label="레버리지" value="고정 10×" />
        <KV label="동시 포지션 한도" value="합산 노셔널 1.5× equity 까지 (개수 무제한)" />
        <KV label="SL/TP 방식" value="ATR(14) + ROI -40% cap" />
        <KV label="최소 net RR" value="1.8R" />
        <KV label="최대 보유 시간" value="무제한 (TP/SL 만)" />
        <KV label="청산 안전버퍼" value="0.7 × liqDist" />
        <KV label="비용 가정" value="수수료 0.08% + 슬립 0.05%" />
        <KV label="일/주/MDD 한도" value={`-${dayLimitPct.toFixed(0)}% / -${weekLimitPct.toFixed(0)}% / -${mddLimitPct.toFixed(0)}%`} />
        <KV label="연속손실 쿨다운" value={`${breakerLimits.consecLossThreshold}회 → 24h`} />
        <KV label="심볼 선택" value="exchangeInfo 동적 필터" />
      </div>
      <div style={{
        marginTop: 14, padding: 12, background: "var(--z-blue-bg)",
        border: `1px solid var(--z-blue)33`, borderRadius: "var(--z-r-sm)",
        fontSize: 14, color: "var(--z-text-2)", lineHeight: 1.6,
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
    // 모바일: 무거운 분석 카드(차트·도넛·거래내역·히트맵)는 별도 탭으로 분리 → 대시보드 짧게 유지
    ...(isMobile ? [{ id: "analysis", label: "상세분석" }] : []),
    { id: "positions", label: `포지션 (${positions.length})` },
  ];

  return (
    <div style={{
      minHeight: "100vh",
      padding: "20px 16px 80px",
      color: "var(--z-text)",
      fontFamily: "var(--z-font-sans)",
    }} className="z-anim-in z-glass-scope">
      <div style={{ maxWidth: 1280, margin: "0 auto" }}>
        {header}

        {/* 바이낸스 키 등록 — 미연결 시 최상단에 강조 노출. 연결됨이면 작은 상태 카드 */}
        <div style={{ margin: "0 0 16px" }}>
          <BinanceConnect
            userId={userId}
            theme="dark"
            useToastFn={useToast}
            onConnected={() => { refresh(); }}
          />
        </div>

        {kpiBar}
        {controlPanel}

        <div style={{ margin: "18px 0 12px" }}>
          <Tabs value={section} onChange={setSection} items={tabs} variant="underline" />
        </div>

        {section === "dashboard" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {/* Widget 7: 시스템 상태 표시등 (대시보드 진입 즉시 보이게 상단) */}
            <SystemStatusIndicator status={status?.systemHealth || {}} isMobile={isMobile} />

            {/* ★ 2026-06-03 정보위계: '오늘 얼마 벌었나'를 최상단으로 — 진입 즉시 핵심부터 (대표 지시: 딱딱딱) */}
            {/* ★ 2026-05-11: 기간별 수익 (일/주/월/누적) — 가장 먼저 보고 싶은 정보 */}
            <Card title="기간별 수익" icon={<TrendUp size={16} />}
              subtitle="일·주·월·누적 수익률 + 금액 한눈에 (입출금 제외 순수 매매손익)">
              <PeriodReturnsCard equity={equity} breaker={breaker} transfers={transfers} isMobile={isMobile} />
            </Card>

            {/* ★ 2026-06-01: 코인별 롱숏 점수 — 엔진이 보는 양방향 신호를 한눈에 (대표 지시) */}
            <Card title="코인별 롱숏 점수" icon={<Target size={16} />}
              subtitle="엔진이 보는 시그널 — 코인별 롱(초록)·숏(빨강) 방향과 강도 (60초 갱신)">
              <CoinDirectionScores coins={coinScores.coins} counts={coinScores.counts} loading={coinScores.loading} isMobile={isMobile} />
            </Card>

            {/* ★ 2026-05-11: 운영 메트릭 (평균 보유, 24h 거래, 마진 사용률, 노출, 미실현 손익) */}
            <Card title="운영 메트릭" icon={<Activity size={16} />}
              subtitle="포지션 운영 상태 한눈에 — 마진 사용률 80% 이상 시 빨강 경고">
              <OperationalMetrics positions={positions} orders={orders || []} equity={equity || 0} isMobile={isMobile} />
            </Card>

            {/* 안전장치(서킷브레이커)는 핵심이라 모바일 대시보드에도 노출 */}
            {isMobile && breakerCard}

            {/* ── 무거운 분석 카드: 데스크톱은 대시보드에 그대로, 모바일은 '상세분석' 탭으로 분리 ── */}
            {!isMobile && (
              <>
                {/* Widget 1: 30일 자산 추이 라인 차트 + Widget 2: 라이브 성과 메트릭 */}
                <Card title="포트폴리오 성과" icon={<TrendUp size={16} />}
                  subtitle="자동매매 30일 자산 곡선 + 누적 거래 메트릭">
                  <EquityCurveChart
                    history={breaker.equityHistory || []}
                    currentEquity={equity}
                    peakEquity={breaker.equityHigh30d || breaker.equityHigh}
                    isMobile={isMobile}
                  />
                  <div style={{ marginTop: 14 }}>
                    <LiveMetricsRow orders={orders || []} isMobile={isMobile} />
                  </div>
                </Card>

                <div style={{ display: "grid", gap: 14, gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr)" }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                    <Card title="포트폴리오 분산" icon={<Wallet size={16} />}
                      subtitle={`${positions.length}개 포지션 · 자산 ${fmtUsd(equity)}`}>
                      <PositionDonutChart positions={positions} equity={equity || 0} isMobile={isMobile} />
                    </Card>
                    <Card title="최근 거래" icon={<Activity size={16} />}
                      subtitle="최근 10건 (체결·미체결·청산 포함)">
                      <TradeHistoryTable orders={orders || []} maxRows={10} isMobile={isMobile} />
                    </Card>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                    {breakerCard}
                  </div>
                </div>

                <Card title="일별 손익 히트맵" icon={<Gauge size={16} />}
                  subtitle="최근 30일 일자별 실현손익 강도 — 잘 한 날 vs 잃은 날 한눈에">
                  <DailyPnLHeatmap orders={orders || []} days={30} isMobile={isMobile} />
                </Card>
              </>
            )}
          </div>
        )}
        {section === "analysis" && isMobile && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <Card title="포트폴리오 성과" icon={<TrendUp size={16} />}
              subtitle="30일 자산 곡선 + 누적 거래 메트릭">
              <EquityCurveChart
                history={breaker.equityHistory || []}
                currentEquity={equity}
                peakEquity={breaker.equityHigh30d || breaker.equityHigh}
                isMobile={isMobile}
              />
              <div style={{ marginTop: 14 }}>
                <LiveMetricsRow orders={orders || []} isMobile={isMobile} />
              </div>
            </Card>
            <Card title="포트폴리오 분산" icon={<Wallet size={16} />}
              subtitle={`${positions.length}개 포지션 · 자산 ${fmtUsd(equity)}`}>
              <PositionDonutChart positions={positions} equity={equity || 0} isMobile={isMobile} />
            </Card>
            <Card title="최근 거래" icon={<Activity size={16} />}
              subtitle="최근 10건 (체결·미체결·청산 포함)">
              <TradeHistoryTable orders={orders || []} maxRows={10} isMobile={isMobile} />
            </Card>
            <Card title="일별 손익 히트맵" icon={<Gauge size={16} />}
              subtitle="최근 30일 일자별 실현손익 강도">
              <DailyPnLHeatmap orders={orders || []} days={30} isMobile={isMobile} />
            </Card>
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
