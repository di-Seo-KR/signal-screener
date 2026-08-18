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
  SectionHeader, KV, Progress, EmptyState, ToastProvider, useToast, Spinner,
} from "./ui/primitives.jsx";
import {
  Play, Stop, Pause, Refresh, Power, Shield, Ghost, Gauge, Alert as AlertIcon,
  Check, Flask, Lock, Unlock, Settings, Sun, Moon, ChevronR, Zap, Activity, Target,
  TrendUp, TrendDown,
} from "./ui/icons.jsx";
import { useTheme } from "./ui/theme.jsx";
import { useBreakpoint } from "./ui/useBreakpoint.jsx";
import BinanceConnect from "./components/BinanceConnect.jsx";
import TradingModeSwitch from "./components/TradingModeSwitch.jsx"; // ★ 트레이딩 일원화 (모의↔실전)
// ★ 2026-05-09: 옵션 D — 대시보드 강화 7개 위젯
// ★ 2026-05-11: PeriodReturnsCard + OperationalMetrics 추가 (대표 지시: 일/주/월 수익 + 운영 메트릭)
import {
  EquityCurveChart, LiveMetricsRow, PositionDonutChart,
  TradeHistoryTable, DailyPnLHeatmap, SystemStatusIndicator,
  PeriodReturnsCard, OperationalMetrics,
} from "./ui/dashboard-widgets.jsx";
import { SignalCoinBoard } from "./ui/signal-cards.jsx"; // ★ 리뉴얼 V2 — 시그널 카드+매물대

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
// 경과 표기 — 누적 지표가 언제 기준인지 함께 보여줘야 옛 수치를 현재로 오독하지 않습니다.
const daysSince = (t) => {
  const ms = typeof t === "number" ? t : Date.parse(t || "");
  if (!ms || !isFinite(ms)) return null;
  return Math.floor((Date.now() - ms) / 86400000);
};
const fmtSince = (t) => {
  const d = daysSince(t);
  if (d == null) return null;
  if (d <= 0) return "오늘";
  if (d === 1) return "어제";
  return `${d}일 전`;
};
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
function RealTradingInner({ onNavigate }) {
  const { user } = useAuth();
  const userId = user?.id;
  const { theme, toggle: toggleTheme } = useTheme();
  const toast = useToast();

  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
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
  // ★ 2026-06-03: 청산(실현) 거래 — 승률·손익비·Sharpe 집계용 (orders 엔 pnl 없어 income 사용)
  const [closedTrades, setClosedTrades] = useState(null);
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
    // 코인 점수 + 포지션 plan + 순입출금 + 청산(실현) 거래 병렬 조회
    const [cs, pp, pf, ct] = await Promise.allSettled([
      jget(`/api/real-trading/coin-scores?limit=60`), // ★ 동적 유니버스 ~50종 전체 표시 (30 캡 버그 수정)
      jget(`/api/real-trading/position-plans?userId=${encodeURIComponent(userId)}`),
      jget(`/api/real-trading/period-returns?userId=${encodeURIComponent(userId)}`),
      jget(`/api/real-trading/closed-trades?userId=${encodeURIComponent(userId)}`),
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
    const cl = ct.status === "fulfilled" ? ct.value : null;
    if (cl?.ok && Array.isArray(cl.trades)) setClosedTrades(cl.trades);
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
            자동매매 콘솔은 인증된 사용자만 접근할 수 있습니다.
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

  // ★ 2026-06-12 (전수조사): 리스크 프리셋 카드를 실 RISK_CONFIG(status.riskConfig SSOT)에서 렌더
  //   — 하드코딩이 또 드리프트(레버리지 10×↛5×, 합산마진 60%↛95%)하던 것 차단. 없으면 실값 폴백.
  const riskCfg = status?.riskConfig || {};
  const rcRiskPct = (riskCfg.riskPerTradePct ?? 0.10) * 100;
  const rcMarginSingle = (riskCfg.maxMarginPct ?? 0.5) * 100;
  const rcMarginTotal = (riskCfg.maxTotalMarginRatio ?? 0.95) * 100;
  const rcRoiCap = (riskCfg.maxRoiLossPct ?? 0.40) * 100;
  const rcMinLev = riskCfg.minLeverage ?? 5;
  const rcMaxLev = riskCfg.maxLeverage ?? 5;
  const rcLevLabel = rcMinLev === rcMaxLev ? `고정 ${rcMaxLev}×` : `${rcMinLev}~${rcMaxLev}× (확신도 기반)`;
  const rcMinRR = riskCfg.minNetRR ?? 1.8;
  // ★ 2026-08-18 (일일감사): 노셔널 가드는 "비활성" 이라고 하드코딩돼 있었지만 실제로는
  //   equity × maxTotalNotionalRatio 로 살아 있고, 지금 엔진 거절 사유의 대부분이 이 가드입니다.
  //   실값(riskConfig.maxTotalNotionalRatio)과 현재 자본으로 환산한 실 한도를 그대로 보여줍니다.
  const rcNotionalRatio = riskCfg.maxTotalNotionalRatio ?? null;
  const rcNotionalCap = (rcNotionalRatio != null && equity > 0) ? equity * rcNotionalRatio : null;

  // ═════════════════════════════════════════════════════════
  // ★ 2026-08-12 IA v3 (시안 1g): 콘솔형 상태 히어로
  //   브랜딩 헤더 + KPI 카드 5장을 히어로 1장으로 통합 — 가동 상태·총자산·일 손익.
  //   총자산·일 손익 노출 위치는 이 히어로 1곳뿐 (같은 정보 이중 노출 금지 규칙).
  //   기간·낙폭·연속손실 수치는 리스크 패널(안전장치 카드)로 일원화.
  //   ※ 시안의 uptime 은 서버가 내려주는 실데이터가 없어 생략 — 대신 실측 갱신 시각 표기.
  // ═════════════════════════════════════════════════════════
  const statusPill = trulyLive
    ? { dot: "var(--z-green)", label: "가동 중", color: "var(--z-green-hi)", pulse: true }
    : halted
      ? { dot: "var(--z-yellow)", label: "일시 정지 · 브레이커", color: "var(--z-yellow-hi)", pulse: false }
      : killOn
        ? { dot: "var(--z-text-3)", label: "대기 · 안전잠금", color: "var(--z-text-2)", pulse: false }
        : { dot: "var(--z-text-3)", label: "대기", color: "var(--z-text-2)", pulse: false };
  const header = (
    <div style={{
      background: "var(--z-card)",
      border: "1px solid var(--z-border)",
      borderRadius: "var(--z-r-lg)",
      padding: isMobile ? "16px 16px" : "18px 22px",
      marginBottom: isMobile ? 14 : 16,
      display: "flex", flexDirection: "column", gap: isMobile ? 14 : 12,
    }}>
      {/* 1행: 타이틀 + OWNER + 상태 필 + (우측) 보조 액션 */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <Power size={isMobile ? 16 : 18} color={trulyLive ? "var(--z-green-hi)" : "var(--z-text-3)"} style={{ flexShrink: 0 }} />
        <div style={{ fontSize: isMobile ? 17 : 19, fontWeight: 900, letterSpacing: "-0.02em", lineHeight: 1 }}>
          자동매매 콘솔
        </div>
        <span style={{
          fontSize: 10, fontWeight: 800, padding: "3px 8px", borderRadius: 8,
          background: "rgba(255, 176, 32, 0.13)", color: "var(--z-yellow-hi)", letterSpacing: "0.05em",
        }}>OWNER</span>
        <div style={{
          display: "flex", alignItems: "center", gap: 7,
          background: "var(--z-card-2)", border: "1px solid var(--z-border)",
          borderRadius: 9999, padding: "5px 12px",
        }}>
          <span className={statusPill.pulse ? "rt-pulse" : undefined}
            style={{ width: 7, height: 7, borderRadius: "50%", background: statusPill.dot, flexShrink: 0 }} />
          <span style={{ fontSize: 12, fontWeight: 800, color: statusPill.color, whiteSpace: "nowrap" }}>{statusPill.label}</span>
          {lastRefresh && (
            <span style={{ fontSize: 10.5, color: "var(--z-text-3)", fontFamily: "var(--z-font-mono)", whiteSpace: "nowrap" }}>
              {fmtTime(lastRefresh)}
            </span>
          )}
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          {/* Alpha Lab 진입 — 알파랩 발굴·튜닝 전략이 자동매매 신호에 반영됨 (기존 기능 유지) */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              try { window.location.href = "/alpha-lab"; } catch {}
            }}
            leftIcon={<Target size={13} />}
            title="알파랩이 2시간마다 발굴·검증한 최적 전략 파라미터가 자동매매 신호에 반영됩니다"
            style={{ whiteSpace: "nowrap", color: "var(--z-purple)" }}
          >
            🧬 Alpha Lab
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={refresh}
            leftIcon={loading ? <Spinner size={13} /> : <Refresh size={13} />}
            style={{ whiteSpace: "nowrap" }}
          >
            새로고침
          </Button>
        </div>
      </div>
      {/* 2행: 총자산 · 오늘 매매손익 */}
      <div style={{ display: "flex", gap: isMobile ? 20 : 32, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 11.5, color: "var(--z-text-3)", fontWeight: 700 }}>총자산 · 마진 잔고</div>
          <div style={{
            fontSize: isMobile ? 28 : 32, fontWeight: 900, lineHeight: 1.05,
            fontFamily: "var(--z-font-mono)", letterSpacing: "-0.02em", marginTop: 3,
          }}>
            {/* 상태 3종 규칙: 스켈레톤은 '로딩 중'일 때만 — 로딩 종료 후 null 이면 fmtUsd 가 '—'(빈 상태) 표시 */}
            {loading && marginBalance == null ? <Skeleton width={150} height={isMobile ? 28 : 32} /> : fmtUsd(marginBalance)}
          </div>
          {/* 바이낸스 '마진 잔고' = 지갑잔고 + 미실현 — 분해해 투명하게 표시 (기존 표기 유지) */}
          {marginBalance != null && unrealizedPnl != null && (
            <div style={{ fontSize: 11.5, color: "var(--z-text-3)", marginTop: 4 }}>
              지갑 {fmtUsd(equity, 2)}
              <span style={{ color: unrealizedPnl > 0 ? "var(--z-green-hi)" : unrealizedPnl < 0 ? "var(--z-red-hi)" : "var(--z-text-3)" }}>
                {" "}· 미실현 {unrealizedPnl >= 0 ? "+" : ""}{fmtUsd(unrealizedPnl, 2)}
              </span>
            </div>
          )}
        </div>
        <div>
          <div style={{ fontSize: 11.5, color: "var(--z-text-3)", fontWeight: 700 }}>오늘 매매손익 · 입금 제외</div>
          <div style={{
            fontSize: isMobile ? 22 : 26, fontWeight: 900, lineHeight: 1.1,
            fontFamily: "var(--z-font-mono)", letterSpacing: "-0.01em", marginTop: 3,
            color: todayPnlUsd == null ? "var(--z-text-3)" : todayPnlUsd >= 0 ? "var(--z-green-hi)" : "var(--z-red-hi)",
          }}>
            {todayPnlUsd == null ? "집계 중" : `${todayPnlUsd >= 0 ? "+" : ""}${fmtUsd(todayPnlUsd, 1)}`}
            {todayPnlPct != null && (
              <span style={{ fontSize: isMobile ? 12.5 : 14, fontWeight: 800, marginLeft: 6, opacity: 0.85 }}>
                {fmtPct(todayPnlPct, 1)}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  // ═════════════════════════════════════════════════════════
  // ★ 2026-08-12 IA v3 (1g): 기존 KPI 바(heroEquity + 보조 4카드)·Toss 히어로 폐지.
  //   총자산·일 손익 → 상태 히어로 / 낙폭·연속손실·시작잔고 → 안전장치(리스크 패널) /
  //   진행 거래 수 → 보유 포지션 카드 헤더 — 전부 기존 노출처와 중복이라 통합.
  // ═════════════════════════════════════════════════════════

  // ═════════════════════════════════════════════════════════
  // CONTROL PANEL (REDESIGNED - PROMINENT BUTTONS)
  // ═════════════════════════════════════════════════════════
  // ★ 2026-08-12 IA v3 (1g): 킬스위치 카드 — 우측 리스크 레일에 배치되므로 항상 세로 스택.
  //   버튼·핸들러·확인 다이얼로그는 기존 그대로 (배치만 변경).
  const controlPanel = (
    <div style={{
      background: "var(--z-card)",
      border: "1px solid rgba(239, 68, 68, 0.28)",
      borderRadius: "var(--z-r-lg)",
      padding: isMobile ? "14px 14px" : "16px",
      display: "flex", flexDirection: "column", gap: 12,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Settings size={18} color="var(--z-text-2)" />
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--z-text-2)" }}>
            매매 제어 · 킬스위치
          </div>
        </div>
        {trulyLive ? (
          <Badge tone="green" dot style={{ fontSize: 13, fontWeight: 700, padding: "5px 10px" }}>
            ✓ 실거래 중
          </Badge>
        ) : (
          <Badge tone="default" style={{ fontSize: 13, fontWeight: 700, padding: "5px 10px" }}>
            ⊙ 대기 중
          </Badge>
        )}
      </div>

      <div style={{
        display: "grid",
        gap: 10,
        gridTemplateColumns: "1fr",
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

        {/* EMERGENCY ACTION: STOP ALL — 발동 시 모든 포지션 시장가 청산 (확인 다이얼로그 필수) */}
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
  // OPEN POSITIONS — ★ 2026-08-12 IA v3 (1g): 데스크탑·모바일 공통 카드 형식.
  //   방향 보더 레일(롱=초록/숏=빨강) + 미실현 손익 + SL/TP 거리 — 기존 posPlans 배선 재사용.
  //   (이전 데스크탑 Table 은 카드 그리드로 통일 — 표현만 변경, 데이터 동일)
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
        borderLeft: `3px solid ${isLong ? "var(--z-green)" : "var(--z-red)"}`,
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
              {isFinite(pnlPct) ? `${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(2)}%` : "—"}
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
      title="보유 포지션"
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
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>진행 중 거래 없음</div>
          <div style={{ fontSize: 14, color: "var(--z-text-3)", lineHeight: 1.5 }}>
            실거래가 활성화되고 시그널이 발생하면<br />여기에 포지션이 표시됩니다.
          </div>
        </div>
      ) : (
        // ★ 1g: 데스크탑·모바일 공통 카드 그리드 — 방향 레일 + SL/TP 거리 (Table 폐지, 데이터 동일)
        <div style={{
          padding: 12, display: "grid", gap: 10,
          gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill, minmax(300px, 1fr))",
        }}>
          {positions.map((p, i) => renderPositionCard(p, i))}
        </div>
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
                  {e.plan.effectiveRR && isFinite(e.plan.effectiveRR) && <> · RR {e.plan.effectiveRR.toFixed(2)}</>}
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
          {/* ★ 누적 지표의 기준 시점 — 원장이 오래 멈춰 있으면 옛 수치를 현재 성과로 오독하게 됩니다. */}
          {(() => {
            const staleDays = daysSince(shadow.summary.updatedAt);
            if (staleDays == null) return null;
            const stale = staleDays >= 7;
            return (
              <div style={{
                marginBottom: 12, padding: "8px 10px", fontSize: 14, lineHeight: 1.5,
                background: stale ? "var(--z-yellow-bg)" : "var(--z-card-2)",
                border: `1px solid ${stale ? "var(--z-yellow)" : "var(--z-border)"}`,
                borderRadius: "var(--z-r-sm)",
                color: stale ? "var(--z-yellow-hi)" : "var(--z-text-3)",
              }}>
                마지막 기록 <strong>{fmtSince(shadow.summary.updatedAt)}</strong>
                {stale && " — 아래 누적 수치는 그 시점까지의 값이며 현재 성과가 아닙니다. 원장 적재가 멈췄는지 확인이 필요합니다."}
              </div>
            );
          })()}
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
                ? ((shadow.summary.avgR != null && isFinite(shadow.summary.avgR))
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
                      {fmtUsd(st.netPnL)} · {(st.trades || 0) > 0 ? `${st.wins || 0}/${st.trades}` : "—"}
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
        {/* ★ 2026-06-12: 하드코딩 드리프트 차단 — status.riskConfig(실 RISK_CONFIG SSOT)에서 렌더 */}
        <KV label="트레이드당 리스크" value={`${rcRiskPct.toFixed(0)}% equity`} />
        <KV label="최대 증거금 비율" value={`${rcMarginSingle.toFixed(0)}% (단일) · ${rcMarginTotal.toFixed(0)}% (합산)`} />
        <KV label="레버리지" value={rcLevLabel} />
        <KV label="동시 포지션 한도" value={`개수 ${riskCfg.maxConcurrentPositions ?? "—"}개 · 합산 마진 ${rcMarginTotal.toFixed(0)}%`} />
        <KV label="합산 노셔널 한도"
          value={rcNotionalRatio == null ? "—"
            : `자본의 ${(rcNotionalRatio * 100).toFixed(0)}%${rcNotionalCap ? ` (현재 ${fmtUsd(rcNotionalCap, 0)})` : ""}`} />
        <KV label="SL/TP 방식" value={`ATR(14) + ROI -${rcRoiCap.toFixed(0)}% cap`} />
        <KV label="최소 net RR" value={`${rcMinRR.toFixed(1)}R`} />
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
        Killswitch fail-closed · 봇 mark-price 모니터링(2분 주기)으로 SL/TP 청산 · 일일 Reconcile(Binance=진실)
        {/* ★ 2026-08-18 (일일감사): "상관군 제한" 표기 삭제 — inSameCorrelationGroup() 은
            risk-manager.js 에서 export 만 돼 있고 엔진 호출부가 0건(미배선)입니다.
            작동하지 않는 안전장치를 안전장치로 표기하지 않습니다. 배선은 돈 직결이라 대표 판단 영역. */}
      </div>
    </Card>
  );

  // ═════════════════════════════════════════════════════════
  // ★ 2026-08-12 IA v3 (1g) 공용 카드 — 모바일 탭/데스크탑 그리드에서 재사용 (이중 정의 방지)
  // ═════════════════════════════════════════════════════════
  // 1g ③ 시그널 후보 큐 — 엔진이 보는 종합 스코어 상위 후보 (coin-scores 기존 배선 그대로)
  const signalQueueCard = (
    <Card title="시그널 후보 큐" icon={<Target size={16} />}
      subtitle="주·일·4h·1h 가중 종합 + 매물대 — 엔진이 보는 후보 순위, 10분 갱신 · 카드 탭하면 상세">
      <SignalCoinBoard coins={coinScores.coins} counts={coinScores.counts} loading={coinScores.loading} isMobile={isMobile} variant="full" />
    </Card>
  );
  // 1g ⑤ 체결 타임라인 — recentOrders 단일 노출 (이전 '최근 거래'+'최근 주문' 이중 노출 통합)
  const fillsCard = (
    <Card title="최근 체결" icon={<Activity size={16} />}
      subtitle="최근 10건 (체결·미체결·청산 포함)">
      <TradeHistoryTable orders={orders || []} maxRows={10} isMobile={isMobile} />
    </Card>
  );
  // 1g ⑥ 리스크 패널 보조 — 마진 사용률·노출·보유시간 (기존 위젯 재사용)
  const opsMetricsCard = (
    <Card title="운영 메트릭" icon={<Activity size={16} />}
      subtitle="포지션 운영 상태 한눈에 — 마진 사용률 80% 이상 시 빨강 경고">
      <OperationalMetrics positions={positions} orders={orders || []} equity={equity || 0} isMobile={isMobile} />
    </Card>
  );
  // 1g ④ 성과 — 기간별 수익 + 자산 곡선 (기존 배선 그대로)
  const periodCard = (
    <Card title="기간별 수익" icon={<TrendUp size={16} />}
      subtitle="일·주·월·누적 수익률 + 금액 한눈에 (입출금 제외 순수 매매손익)">
      <PeriodReturnsCard equity={equity} breaker={breaker} transfers={transfers} isMobile={isMobile} />
    </Card>
  );
  const perfCard = (
    <Card title="포트폴리오 성과" icon={<TrendUp size={16} />}
      subtitle="자동매매 30일 자산 곡선 + 누적 거래 메트릭">
      <EquityCurveChart
        history={breaker.equityHistory || []}
        currentEquity={equity}
        peakEquity={breaker.equityHigh30d || breaker.equityHigh}
        isMobile={isMobile}
      />
      <div style={{ marginTop: 14 }}>
        <LiveMetricsRow orders={orders || []} realized={closedTrades} isMobile={isMobile} />
      </div>
    </Card>
  );
  // 1g 면책 캡션 (owner 전용 화면)
  const ownerDisclaimer = (
    <div style={{ fontSize: 11, color: "var(--z-text-3)", textAlign: "center", padding: "4px 0 8px", lineHeight: 1.5 }}>
      자동매매는 오너 계정 전용 기능이며 손실 위험이 있습니다.
    </div>
  );

  // ═════════════════════════════════════════════════════════
  // LAYOUT — ★ 1g: 데스크탑은 단일 콘솔 플로우(탭 없음), 모바일만 [대시보드|상세분석]
  //   기존 '포지션' 탭은 대시보드로 흡수 — 판독 순서: 히어로→포지션→큐→성과→체결→리스크
  // ═════════════════════════════════════════════════════════
  const tabs = [
    { id: "dashboard", label: "대시보드" },
    // 모바일: 무거운 분석 카드(차트·거래내역·운영 메트릭)는 별도 탭으로 분리 → 대시보드 짧게 유지
    ...(isMobile ? [{ id: "analysis", label: "상세분석" }] : []),
  ];

  return (
    <div style={{
      minHeight: "100vh",
      padding: "20px 16px 80px",
      color: "var(--z-text)",
      fontFamily: "var(--z-font-sans)",
    }} className="z-anim-in z-bento-scope">
      <div style={{ maxWidth: 1280, margin: "0 auto" }}>
        {/* ★ 2026-06-08 트레이딩 일원화 — 모의↔실전 모드 스위치 (대표 지시) */}
        <TradingModeSwitch mode="live" onNavigate={onNavigate} isOwner={true} theme={theme} compact={isMobile} />
        {header}

        {/* 바이낸스 키 등록 — 미연결 시 최상단에 강조 노출. 연결됨이면 작은 상태 카드 */}
        <div style={{ margin: "0 0 14px" }}>
          <BinanceConnect
            userId={userId}
            theme="dark"
            useToastFn={useToast}
            onConnected={() => { refresh(); }}
          />
        </div>

        {isMobile && (
          <div style={{ margin: "0 0 12px" }}>
            <Tabs value={section} onChange={setSection} items={tabs} variant="underline" />
          </div>
        )}

        {section === "dashboard" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {/* 시스템 상태 표시등 — 엔진 heartbeat 가드 상태 (진입 즉시 확인) */}
            <SystemStatusIndicator status={status?.systemHealth || {}} isMobile={isMobile} />

            {isMobile ? (
              // ★ 1g 모바일: 히어로 아래 [제어 → 포지션 → 후보 큐 → 리스크] 순 — 컴팩트 콘솔
              <>
                {controlPanel}
                {positionsCard}
                {signalQueueCard}
                {breakerCard}
              </>
            ) : (
              // ★ 1g 데스크탑: 좌(포지션+체결) / 우(제어·리스크 레일) 2열 → 아래 풀폭 운영 메트릭·큐·성과
              <>
                <div style={{ display: "grid", gap: 14, gridTemplateColumns: "minmax(0, 1.5fr) minmax(0, 1fr)", alignItems: "start" }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                    {positionsCard}
                    {fillsCard}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                    {controlPanel}
                    {breakerCard}
                  </div>
                </div>
                {/* 운영 메트릭은 데스크탑 5열 고정 그리드(OperationalMetrics)라 좁은 우측 레일에선
                   라벨 줄바꿈·값 넘침 발생 → 리스크 레일 바로 아래 풀폭 배치 (레일의 보조 패널 역할 유지) */}
                {opsMetricsCard}
                {signalQueueCard}
                {periodCard}
                {perfCard}
              </>
            )}
            {ownerDisclaimer}
          </div>
        )}
        {section === "analysis" && isMobile && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {periodCard}
            {perfCard}
            {fillsCard}
            {opsMetricsCard}
          </div>
        )}
        {/* ★ 1g: 기존 '포지션' 탭 폐지 — 포지션 카드는 대시보드로 흡수,
           '최근 주문' 테이블은 동일 orders 데이터의 이중 노출이라 '최근 체결'(fillsCard)로 통합. */}
        {/* ★ 2026-06-03 군더더기 정리(대표 지시): 기술/운영 로그류(Shadow·엔진로그·Reconcile)
           섹션 제거 — 탭/진입로가 없어 이미 비노출이던 죽은 코드. */}
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
