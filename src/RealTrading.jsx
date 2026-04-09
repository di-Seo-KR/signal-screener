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

  const runDry = async (probe = false) => {
    if (!userId) return;
    setBusy(true);
    try {
      const r = await jpost("/api/real-trading/engine", { userId, dryRun: true, probe });
      if (r?.ran) {
        toast.push(
          `${r.signal?.symbol || ""} ${r.signal?.side || ""} · plan qty ${fmtQty(r.plan?.qty)} @ ${r.plan?.leverage}×${r.plan?.bumpedToMin ? " · ⚠ bumped" : ""}`,
          { tone: "green", title: "✓ 모의 실행 완료", duration: 5000 }
        );
      } else {
        const msg = r?.reason || r?.error || "no action";
        const tail = r?.steps?.length ? `\n${r.steps.slice(-3).join(" · ")}` : "";
        toast.push(msg + tail, { tone: "yellow", title: "모의 실행 결과", duration: 6000 });
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
  // HEADER
  // ═════════════════════════════════════════════════════════
  const header = (
    <div style={{
      display: "flex", alignItems: "center", gap: 12, marginBottom: 14, flexWrap: "wrap",
    }}>
      <div style={{ flex: 1, minWidth: 240 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 10,
            background: "linear-gradient(135deg, var(--z-red) 0%, #C8102E 100%)",
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: "0 6px 20px rgba(255, 77, 100, 0.3)",
          }}>
            <Power size={18} color="#fff" />
          </div>
          <div style={{ fontSize: 20, fontWeight: 900, letterSpacing: "-0.02em" }}>
            실전매매 관제센터
          </div>
          {trulyLive ? (
            <Badge tone="red" dot solid>LIVE</Badge>
          ) : (
            <Badge tone="default">STANDBY</Badge>
          )}
          {shadowOn && <Badge tone="purple" dot>SHADOW</Badge>}
          {halted && <Badge tone="yellow">BREAKER</Badge>}
        </div>
        <div style={{ fontSize: 12, color: "var(--z-text-3)" }}>
          Binance USDⓈ-M Futures · Option A 절대수익형 · Owner only
          {lastRefresh && <> · 최근 {fmtTime(lastRefresh)}</>}
        </div>
      </div>

      <Segmented
        value={density}
        onChange={setDensity}
        items={[{ id: "simple", label: "초보자" }, { id: "pro", label: "트레이더" }]}
      />
      <Tooltip content={theme === "dark" ? "라이트 모드" : "다크 모드"}>
        <Button variant="ghost" size="sm" onClick={toggleTheme}
          leftIcon={theme === "dark" ? <Sun size={14} /> : <Moon size={14} />} />
      </Tooltip>
      <Button variant="ghost" size="sm" onClick={refresh} leftIcon={loading ? <Spinner size={14} /> : <Refresh size={14} />}>
        새로고침
      </Button>
    </div>
  );

  // ═════════════════════════════════════════════════════════
  // KPI BAR
  // ═════════════════════════════════════════════════════════
  const kpiBar = (
    <div style={{
      display: "grid", gap: 10, marginBottom: 14,
      gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
    }}>
      <Stat
        label="에쿼티"
        icon={<Wallet size={12} />}
        value={loading && equity == null ? <Skeleton width={80} height={20} /> : fmtUsd(equity)}
        sub={breaker.dayStartEquity ? `일 시작 ${fmtUsd(breaker.dayStartEquity)}` : null}
        trend={dayLossPct || null}
      />
      <Stat
        label="오픈 포지션"
        icon={<Activity size={12} />}
        value={positions.length}
        sub={`상관군 분리 · 최대 2개`}
        tone={positions.length >= 2 ? "warn" : undefined}
      />
      <Stat
        label="일 손익"
        icon={<TrendUp size={12} />}
        value={fmtPct(dayLossPct)}
        sub="한도 -4%"
        tone={dayLossPct <= -3 ? "danger" : dayLossPct < 0 ? "warn" : "success"}
      />
      <Stat
        label="MDD"
        icon={<TrendDown size={12} />}
        value={fmtPct(mddPct)}
        sub="한도 -15%"
        tone={mddPct <= -10 ? "danger" : undefined}
      />
      <Stat
        label="연속 손실"
        icon={<AlertIcon size={12} />}
        value={`${breaker.consecLosses || 0} / 5`}
        sub="5회 → 24h 쿨다운"
        tone={(breaker.consecLosses || 0) >= 3 ? "warn" : undefined}
      />
      <Stat
        label="Shadow 성과"
        icon={<Ghost size={12} />}
        value={shadow.summary?.trades ? fmtUsd(shadow.summary.netPnL || 0) : "—"}
        sub={shadow.summary?.trades ? `${shadow.summary.trades}건 · ${shadow.summary.wins || 0}W ${shadow.summary.losses || 0}L` : "기록 없음"}
        tone={(shadow.summary?.netPnL || 0) >= 0 ? "success" : "danger"}
      />
    </div>
  );

  // ═════════════════════════════════════════════════════════
  // CONTROL PANEL
  // ═════════════════════════════════════════════════════════
  const controlPanel = (
    <Card
      title="제어 패널"
      subtitle="활성 조건 = Phase 1 ON + Killswitch OFF + Breaker OK"
      icon={<Settings size={16} />}
      actions={trulyLive ? <Badge tone="green" dot>활성</Badge> : <Badge tone="default">대기</Badge>}
    >
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {!phase1On ? (
          <Button variant="primary" size="sm" disabled={busy}
            leftIcon={<Play size={14} />}
            onClick={() => setConfirm({
              title: "Phase 1 실거래 엔진 등록",
              desc: "이 계정을 실거래 엔진 순회 대상에 등록합니다.\n즉시 거래가 시작되지는 않습니다 — Killswitch 가 ON 이면 엔진은 스킵합니다.",
              confirmLabel: "등록",
              onConfirm: () => act("enable-phase1", {}, "Phase 1 등록 완료"),
            })}>
            Phase 1 등록
          </Button>
        ) : (
          <Button variant="ghost" size="sm" disabled={busy}
            onClick={() => setConfirm({
              tone: "danger",
              title: "Phase 1 전면 비활성화",
              desc: "유저를 allowlist 에서 제거하고 Killswitch 도 자동으로 ON 됩니다.\n오픈 포지션은 청산되지 않습니다.",
              confirmLabel: "비활성화",
              confirmVariant: "danger",
              onConfirm: () => act("disable-phase1", {}, "Phase 1 해제 완료"),
            })}>
            Phase 1 해제
          </Button>
        )}

        {killOn ? (
          <Button variant="danger" size="sm" disabled={busy || !phase1On}
            leftIcon={<Unlock size={14} />}
            onClick={() => setConfirm({
              tone: "danger",
              title: "Killswitch 해제 — 실거래 개시",
              desc: "이 버튼을 누르면 다음 cron 사이클(5분)부터 실거래가 발생할 수 있습니다.\n자본·리스크 파라미터를 확인하셨나요?",
              confirmLabel: "해제하고 실거래 시작",
              confirmVariant: "danger",
              onConfirm: () => act("enable", {}, "Killswitch 해제 완료"),
            })}>
            Killswitch 해제
          </Button>
        ) : (
          <Button variant="warn" size="sm" disabled={busy}
            leftIcon={<Lock size={14} />}
            onClick={() => act("disable", {}, "Killswitch ON")}>
            Killswitch ON
          </Button>
        )}

        {halted ? (
          <Button variant="success" size="sm" disabled={busy}
            leftIcon={<Play size={14} />}
            onClick={() => act("resume", {}, "Breaker 재개")}>
            Breaker 재개
          </Button>
        ) : (
          <Button variant="ghost" size="sm" disabled={busy}
            leftIcon={<Pause size={14} />}
            onClick={() => act("halt", { reason: "manual" }, "일시 정지")}>
            일시 정지
          </Button>
        )}

        <div style={{ width: 1, background: "var(--z-border)", margin: "0 4px" }} />

        <Button variant="ghost" size="sm" disabled={busy}
          leftIcon={<Flask size={14} />}
          onClick={() => runDry(false)}>모의실행</Button>
        <Button variant="subtle" size="sm" disabled={busy}
          leftIcon={<Zap size={14} />}
          onClick={() => runDry(true)}>probe</Button>

        <div style={{ width: 1, background: "var(--z-border)", margin: "0 4px" }} />

        {!shadowOn ? (
          <Button variant="subtle" size="sm" disabled={busy}
            leftIcon={<Ghost size={14} />}
            onClick={() => setConfirm({
              title: "Shadow 모드 시작",
              desc: "실제 주문 없이 전체 파이프라인을 가상 진입/청산으로 기록합니다.\n실거래와 병행 가능, 리스크 제로.",
              confirmLabel: "시작",
              onConfirm: () => act("enable-shadow", {}, "Shadow 모드 시작"),
            })}>Shadow 시작</Button>
        ) : (
          <Button variant="ghost" size="sm" disabled={busy}
            leftIcon={<Ghost size={14} />}
            onClick={() => act("disable-shadow", {}, "Shadow 모드 중지")}>Shadow 중지</Button>
        )}
        <Button variant="ghost" size="xs" disabled={busy}
          onClick={() => setConfirm({
            tone: "danger",
            title: "Shadow 기록 초기화",
            desc: "누적된 Shadow 원장·요약 통계를 모두 지웁니다. 되돌릴 수 없습니다.",
            confirmLabel: "초기화",
            confirmVariant: "danger",
            onConfirm: () => act("reset-shadow", {}, "Shadow 리셋"),
          })}>리셋</Button>

        <div style={{ flex: 1 }} />

        <Button variant="danger" size="sm"
          disabled={busy || positions.length === 0}
          leftIcon={<Stop size={14} />}
          onClick={emergencyStop}>
          긴급 정지 ({positions.length})
        </Button>
      </div>

      {halted && (
        <div style={{
          marginTop: 12, padding: 10, background: "var(--z-yellow-bg)",
          border: `1px solid var(--z-yellow)55`, borderRadius: "var(--z-r-sm)",
          color: "var(--z-yellow-hi)", fontSize: 12, display: "flex", alignItems: "center", gap: 8,
        }}>
          <AlertIcon size={14} />
          서킷브레이커 발동됨 — <b>{status?.haltedReason}</b>. '재개' 버튼으로 해제.
        </div>
      )}
      {error && (
        <div style={{
          marginTop: 12, padding: 10, background: "var(--z-red-bg)",
          border: `1px solid var(--z-red)55`, borderRadius: "var(--z-r-sm)",
          color: "var(--z-red-hi)", fontSize: 12,
        }}>
          오류: {error}
        </div>
      )}
    </Card>
  );

  // ═════════════════════════════════════════════════════════
  // SIMPLE MODE — 가이드 스텝
  // ═════════════════════════════════════════════════════════
  const simpleGuide = (
    <Card title="6단계 안전 활성화 가이드" subtitle="순서대로 따라가면 안전하게 실거래 시작할 수 있어요" icon={<Target size={16} />}>
      {[
        { n: 1, title: "모의실행 + probe", desc: "전체 파이프라인(시그널 → 플랜 → 브래킷 주문)이 에러 없이 돌아가는지 확인합니다.", done: engineLog.some(e => e.dryRun) },
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
        <EmptyState
          icon={<Activity size={28} />}
          title="오픈 포지션 없음"
          description="실거래가 활성화되면 여기에 포지션이 표시됩니다."
        />
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
      <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
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
      <div style={{ marginTop: 14, display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", fontSize: 12 }}>
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
          <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", marginBottom: 12 }}>
            <Stat compact label="총 트레이드" value={shadow.summary.trades || 0} />
            <Stat compact label="승 / 패" value={`${shadow.summary.wins || 0} / ${shadow.summary.losses || 0}`} />
            <Stat compact label="승률"
              value={(shadow.summary.trades > 0
                ? ((shadow.summary.wins || 0) / shadow.summary.trades * 100).toFixed(1) + "%" : "—")} />
            <Stat compact label="누적 netPnL"
              value={fmtUsd(shadow.summary.netPnL)}
              tone={(shadow.summary.netPnL || 0) >= 0 ? "success" : "danger"} />
            <Stat compact label="평균 RR"
              value={shadow.summary.trades > 0
                ? ((shadow.summary.totalRR || 0) / shadow.summary.trades).toFixed(2) + "R" : "—"} />
            <Stat compact label="오픈 중" value={shadow.openCount || 0} />
          </div>
        </>
      ) : (
        <EmptyState
          icon={<Ghost size={28} />}
          title="Shadow 기록 없음"
          description={`"Shadow 시작" 버튼으로 활성화하거나, "모의실행 + probe" 로 테스트 진입을 생성해 보세요.`}
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
      <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
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
    { id: "shadow",    label: "Shadow" },
    { id: "engine",    label: "엔진 로그" },
    { id: "config",    label: "설정" },
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
        {density === "simple" && simpleGuide}
        {controlPanel}

        <div style={{ margin: "18px 0 12px" }}>
          <Tabs value={section} onChange={setSection} items={tabs} variant="underline" />
        </div>

        {section === "dashboard" && (
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: density === "pro" ? "minmax(0, 2fr) minmax(0, 1fr)" : "1fr" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {positionsCard}
              {engineLogCard}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {breakerCard}
              {shadowCard}
              {reconcileCard}
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
