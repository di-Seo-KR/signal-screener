// ════════════════════════════════════════════════════════════════════
// Zepta — 실전매매 (Real Trading) 관제 센터
// Phase 1: 단일 유저 전용 Binance Futures 실거래 대시보드
//
// 기능:
//  1. 실시간 상태 (equity, open positions, killswitch/phase1 플래그)
//  2. 안전장치 토글 (Phase 1 enable/disable, killswitch, halt/resume)
//  3. 최근 엔진 실행 로그 + 최근 주문 내역
//  4. 긴급 정지 (모든 포지션 즉시 청산)
//  5. 전략 아카이브 랭킹
//  6. 리스크 설정 프리셋 (읽기 전용)
// ════════════════════════════════════════════════════════════════════

import React, { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "./AuthProvider.jsx";

const DARK = {
  bg: "#0B0F19", card: "#131B2E", card2: "#1A2438",
  border: "#1F2E42", border2: "#2A3F58",
  blue: "#3B8BFF", blueL: "#64ABFF",
  red: "#FF4D5E", redBg: "#2C1520",
  green: "#00D47E", greenBg: "#0B2E1E",
  yellow: "#FFC233", yellowBg: "#2B2100",
  purple: "#9B6FFF",
  text1: "#F0F2F7", text2: "#94A3B8", text3: "#64748B",
};
const LIGHT = {
  bg: "#F8F9FB", card: "#FFFFFF", card2: "#F1F3F6",
  border: "#E2E5EA", border2: "#D1D5DC",
  blue: "#2563EB", blueL: "#3B82F6",
  red: "#DC2626", redBg: "#FEF2F2",
  green: "#16A34A", greenBg: "#F0FDF4",
  yellow: "#D97706", yellowBg: "#FFFBEB",
  purple: "#7C3AED",
  text1: "#0F172A", text2: "#475569", text3: "#94A3B8",
};

const API = ""; // same origin

async function jget(url) {
  const r = await fetch(url, { credentials: "same-origin" });
  return await r.json();
}
async function jpost(url, body) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  return await r.json();
}

function fmtUsd(v) {
  if (v == null || !isFinite(v)) return "-";
  const n = Number(v);
  return (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 });
}
function fmtPct(v, digits = 2) {
  if (v == null || !isFinite(v)) return "-";
  return (v >= 0 ? "+" : "") + Number(v).toFixed(digits) + "%";
}

// ── 재사용 Pill ──
function Pill({ c, bg, color, children }) {
  return (
    <span style={{
      display: "inline-block", padding: "3px 10px", borderRadius: 999,
      fontSize: 11, fontWeight: 700, letterSpacing: 0.3,
      background: bg, color,
      border: `1px solid ${color}33`,
    }}>{children}</span>
  );
}

function StatusBadge({ label, on, c, onColor = c.green, offColor = c.red }) {
  return (
    <div style={{
      padding: "10px 14px", borderRadius: 10, background: c.card2,
      border: `1px solid ${c.border}`, minWidth: 140,
    }}>
      <div style={{ fontSize: 11, color: c.text3, marginBottom: 4, letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: on ? onColor : offColor }}>
        {on ? "● ON" : "○ OFF"}
      </div>
    </div>
  );
}

function Card({ c, title, actions, children, pad = 16 }) {
  return (
    <div style={{
      background: c.card, border: `1px solid ${c.border}`, borderRadius: 14,
      padding: pad, marginBottom: 14,
    }}>
      {title && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: c.text1 }}>{title}</div>
          {actions}
        </div>
      )}
      {children}
    </div>
  );
}

function Btn({ c, onClick, disabled, variant = "default", children, size = "md" }) {
  const pal = {
    default: { bg: c.card2, fg: c.text1, bd: c.border },
    primary: { bg: c.blue, fg: "#fff", bd: c.blue },
    danger: { bg: c.red, fg: "#fff", bd: c.red },
    success: { bg: c.green, fg: "#03120A", bd: c.green },
    warning: { bg: c.yellow, fg: "#1A1200", bd: c.yellow },
    ghost: { bg: "transparent", fg: c.text1, bd: c.border },
  }[variant];
  const fs = size === "sm" ? 12 : 13;
  const pd = size === "sm" ? "6px 12px" : "9px 16px";
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        background: pal.bg, color: pal.fg,
        border: `1px solid ${pal.bd}`, borderRadius: 8,
        padding: pd, fontSize: fs, fontWeight: 700,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        transition: "all 0.15s ease",
      }}
    >{children}</button>
  );
}

// ═══════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════
export default function RealTrading({ theme = "dark" }) {
  const c = theme === "dark" ? DARK : LIGHT;
  const { user } = useAuth();
  const userId = user?.id;

  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);
  const [confirmAction, setConfirmAction] = useState(null); // {title, desc, onConfirm}
  const timerRef = useRef(null);

  const showToast = (msg, kind = "info") => {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 3500);
  };

  const refresh = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const s = await jget(`/api/real-trading/status?userId=${encodeURIComponent(userId)}`);
      if (!s?.ok) throw new Error(s?.error || "상태 조회 실패");
      setStatus(s);
      setError(null);
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    refresh();
    timerRef.current = setInterval(refresh, 15_000);
    return () => clearInterval(timerRef.current);
  }, [refresh]);

  const sendAction = async (action, body = {}) => {
    if (!userId) return;
    setBusy(true);
    try {
      const r = await jpost("/api/real-trading/kill-switch", { userId, action, ...body });
      if (!r?.ok) throw new Error(r?.error || "요청 실패");
      showToast(`${action} 완료`, "success");
      await refresh();
    } catch (e) {
      showToast(e?.message || String(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const enablePhase1 = () => setConfirmAction({
    title: "Phase 1 실거래 활성화",
    desc: "이 작업은 이 계정을 자동 실거래 엔진 대상에 등록합니다.\n즉시 거래가 시작되지는 않습니다 — killswitch 가 여전히 ON 이라면 엔진은 스킵합니다.\n진행하시겠습니까?",
    variant: "warning",
    onConfirm: () => sendAction("enable-phase1"),
  });
  const disablePhase1 = () => setConfirmAction({
    title: "Phase 1 전면 비활성화",
    desc: "유저를 allowlist 에서 제거하고 killswitch 도 자동으로 ON 으로 돌립니다.\n오픈 포지션은 청산되지 않습니다 (필요시 '긴급정지' 버튼 사용).",
    variant: "danger",
    onConfirm: () => sendAction("disable-phase1"),
  });
  const killOn = () => sendAction("disable");  // killswitch ON = disable trading
  const killOff = () => setConfirmAction({
    title: "Killswitch 해제 (실거래 시작)",
    desc: "이 버튼을 누르면 다음 cron 사이클부터 실거래가 발생할 수 있습니다.\n현재 자본과 리스크 파라미터를 확인하셨나요?",
    variant: "danger",
    onConfirm: () => sendAction("enable"),
  });
  const halt = () => sendAction("halt", { reason: "manual" });
  const resume = () => sendAction("resume");

  const runDryRun = async (probe = false) => {
    if (!userId) return;
    setBusy(true);
    try {
      const r = await jpost("/api/real-trading/engine", { userId, dryRun: true, probe });
      showToast(r?.ran ? `모의 실행 완료 (${r.signal?.symbol || "no-signal"})` : `모의 실행: ${r?.reason || "no action"}`, r?.ran ? "success" : "info");
      await refresh();
    } catch (e) {
      showToast(e?.message || String(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const enableShadow = () => setConfirmAction({
    title: "Shadow 모드 시작",
    desc: "실제 주문 없이 시그널 파이프라인 → 플랜 → 가상 진입/청산까지 전체 워크플로를 기록합니다.\n실거래와 병행 가능하며, 리스크 제로입니다.",
    variant: "primary",
    onConfirm: () => sendAction("enable-shadow"),
  });
  const disableShadow = () => sendAction("disable-shadow");
  const resetShadow = () => setConfirmAction({
    title: "Shadow 기록 초기화",
    desc: "누적된 Shadow 원장과 요약 통계를 모두 초기화합니다. 되돌릴 수 없습니다.",
    variant: "danger",
    onConfirm: () => sendAction("reset-shadow"),
  });

  const emergencyStop = () => setConfirmAction({
    title: "⚠️ 긴급 정지 — 모든 포지션 청산",
    desc: "현재 오픈된 모든 Binance Futures 포지션을 시장가로 즉시 청산합니다.\n이 작업은 되돌릴 수 없습니다.",
    variant: "danger",
    onConfirm: async () => {
      setBusy(true);
      try {
        const r = await jpost("/api/binance/emergency-stop", { userId });
        showToast(r?.ok ? "긴급 정지 완료" : (r?.error || "실패"), r?.ok ? "success" : "error");
        await refresh();
      } catch (e) {
        showToast(e?.message || String(e), "error");
      } finally {
        setBusy(false);
      }
    },
  });

  if (!userId) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: c.text2 }}>
        로그인이 필요합니다.
      </div>
    );
  }

  const phase1On = !!status?.phase1Enabled;
  const shadowOn = !!status?.shadowEnabled;
  const killOnVal = !!status?.killswitchOn;
  const halted = !!status?.halted;
  const equity = status?.equity;
  const positions = status?.openPositions || [];
  const engineLog = status?.recentEngineLog || [];
  const orders = status?.recentOrders || [];
  const breaker = status?.breaker || {};
  const shadow = status?.shadow || { summary: null, openCount: 0, recent: [] };
  const reconcile = status?.reconcile || [];

  // 실제 거래 활성 여부 = phase1 ON + killswitch OFF + not halted
  const trulyLive = phase1On && !killOnVal && !halted;

  return (
    <div style={{ background: c.bg, minHeight: "100vh", padding: "20px 16px 80px", color: c.text1, fontFamily: "-apple-system, system-ui, sans-serif" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>

        {/* ── 헤더 ── */}
        <div style={{ marginBottom: 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: c.text1 }}>🔴 실전매매 관제센터</div>
            {trulyLive
              ? <Pill color={c.red} bg={c.redBg}>LIVE</Pill>
              : <Pill color={c.text2} bg={c.card2}>STANDBY</Pill>}
          </div>
          <div style={{ fontSize: 12, color: c.text2 }}>
            Binance USDⓈ-M Futures · 단일 사용자 모드 · Phase 1 ($100 자본 기준)
          </div>
        </div>

        {/* ── 상단 상태 배지 ── */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
          <StatusBadge c={c} label="PHASE 1 ENGINE" on={phase1On} />
          <StatusBadge c={c} label="KILLSWITCH" on={!killOnVal} onColor={c.green} offColor={c.red} />
          <StatusBadge c={c} label="BREAKER" on={!halted} onColor={c.green} offColor={c.yellow} />
          <div style={{
            padding: "10px 14px", borderRadius: 10, background: c.card2,
            border: `1px solid ${c.border}`, minWidth: 160,
          }}>
            <div style={{ fontSize: 11, color: c.text3, marginBottom: 4, letterSpacing: 0.5 }}>EQUITY</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: c.text1 }}>{fmtUsd(equity)}</div>
          </div>
          <div style={{
            padding: "10px 14px", borderRadius: 10, background: c.card2,
            border: `1px solid ${c.border}`, minWidth: 140,
          }}>
            <div style={{ fontSize: 11, color: c.text3, marginBottom: 4, letterSpacing: 0.5 }}>OPEN POS</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: c.text1 }}>{positions.length}</div>
          </div>
          <div style={{ marginLeft: "auto" }}>
            <Btn c={c} onClick={refresh} variant="ghost" size="sm">
              ↻ {loading ? "불러오는 중..." : "새로고침"}
            </Btn>
          </div>
        </div>

        {halted && (
          <div style={{
            padding: 12, background: c.yellowBg, border: `1px solid ${c.yellow}44`,
            borderRadius: 10, marginBottom: 14, color: c.yellow, fontSize: 13,
          }}>
            ⚠️ 서킷브레이커 발동 — <b>{status?.haltedReason}</b>. '재개' 버튼으로 해제.
          </div>
        )}
        {error && (
          <div style={{
            padding: 12, background: c.redBg, border: `1px solid ${c.red}44`,
            borderRadius: 10, marginBottom: 14, color: c.red, fontSize: 13,
          }}>
            오류: {error}
          </div>
        )}

        {/* ── 제어 패널 ── */}
        <Card c={c} title="🎛️ 제어 패널">
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {!phase1On
              ? <Btn c={c} onClick={enablePhase1} disabled={busy} variant="primary">Phase 1 등록</Btn>
              : <Btn c={c} onClick={disablePhase1} disabled={busy} variant="ghost">Phase 1 해제</Btn>}

            {killOnVal
              ? <Btn c={c} onClick={killOff} disabled={busy || !phase1On} variant="danger">🔓 Killswitch 해제 (실거래 ON)</Btn>
              : <Btn c={c} onClick={killOn} disabled={busy} variant="warning">🔒 Killswitch ON (거래 중단)</Btn>}

            {halted
              ? <Btn c={c} onClick={resume} disabled={busy} variant="success">브레이커 재개</Btn>
              : <Btn c={c} onClick={halt} disabled={busy} variant="ghost">일시 정지</Btn>}

            <Btn c={c} onClick={() => runDryRun(false)} disabled={busy} variant="ghost">🧪 모의실행</Btn>
            <Btn c={c} onClick={() => runDryRun(true)} disabled={busy} variant="ghost">🧪+probe</Btn>

            {!shadowOn
              ? <Btn c={c} onClick={enableShadow} disabled={busy} variant="primary">👻 Shadow 시작</Btn>
              : <Btn c={c} onClick={disableShadow} disabled={busy} variant="ghost">👻 Shadow 중지</Btn>}
            <Btn c={c} onClick={resetShadow} disabled={busy} variant="ghost" size="sm">Shadow 리셋</Btn>

            <div style={{ marginLeft: "auto" }}>
              <Btn c={c} onClick={emergencyStop} disabled={busy || positions.length === 0} variant="danger">
                🛑 긴급 정지 (전 포지션 청산)
              </Btn>
            </div>
          </div>
          <div style={{ marginTop: 10, fontSize: 11, color: c.text3, lineHeight: 1.6 }}>
            활성 조건: Phase 1 등록 + Killswitch 해제 + 브레이커 미발동 — <b style={{ color: trulyLive ? c.green : c.text2 }}>{trulyLive ? "모든 조건 충족 (LIVE)" : "STANDBY"}</b>
          </div>
        </Card>

        {/* ── 오픈 포지션 ── */}
        <Card c={c} title={`💼 오픈 포지션 (${positions.length})`}>
          {positions.length === 0 ? (
            <div style={{ color: c.text3, fontSize: 13, padding: "20px 0", textAlign: "center" }}>
              현재 오픈된 포지션이 없습니다.
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ color: c.text3, textAlign: "left" }}>
                    <th style={{ padding: "8px 6px" }}>심볼</th>
                    <th>수량</th>
                    <th>진입가</th>
                    <th>현재가</th>
                    <th>레버리지</th>
                    <th style={{ textAlign: "right" }}>손익</th>
                  </tr>
                </thead>
                <tbody>
                  {positions.map((p) => {
                    const pnl = p.unRealizedProfit;
                    const side = p.positionAmt > 0 ? "LONG" : "SHORT";
                    return (
                      <tr key={p.symbol} style={{ borderTop: `1px solid ${c.border}` }}>
                        <td style={{ padding: "10px 6px", fontWeight: 700 }}>
                          {p.symbol}{" "}
                          <Pill color={side === "LONG" ? c.green : c.red} bg={side === "LONG" ? c.greenBg : c.redBg}>{side}</Pill>
                        </td>
                        <td>{Math.abs(p.positionAmt)}</td>
                        <td>{fmtUsd(p.entryPrice)}</td>
                        <td>{fmtUsd(p.markPrice)}</td>
                        <td>{p.leverage}x</td>
                        <td style={{ textAlign: "right", color: pnl >= 0 ? c.green : c.red, fontWeight: 700 }}>
                          {fmtUsd(pnl)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {/* ── 브레이커 상태 ── */}
        <Card c={c} title="🛡️ 서킷브레이커 상태">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, fontSize: 12 }}>
            <Stat c={c} label="일 시작 에쿼티" val={fmtUsd(breaker.dayStartEquity)} />
            <Stat c={c} label="주 시작 에쿼티" val={fmtUsd(breaker.weekStartEquity)} />
            <Stat c={c} label="최고 에쿼티" val={fmtUsd(breaker.equityHigh)} />
            <Stat c={c} label="연속 손실" val={String(breaker.consecLosses || 0)} />
            <Stat c={c} label="쿨다운 종료"
              val={breaker.cooldownUntil && breaker.cooldownUntil > Date.now()
                ? new Date(breaker.cooldownUntil).toLocaleString()
                : "-"} />
            <Stat c={c} label="상태"
              val={halted ? `중단됨 (${status?.haltedReason || "manual"})` : "정상"}
              color={halted ? c.red : c.green} />
          </div>
          <div style={{ marginTop: 10, fontSize: 11, color: c.text3 }}>
            한도: 일 -4% · 주 -8% · MDD -15% · 5연속손실 → 24h 쿨다운
          </div>
        </Card>

        {/* ── 엔진 로그 ── */}
        <Card c={c} title={`📊 엔진 실행 로그 (최근 ${engineLog.length})`}>
          {engineLog.length === 0 ? (
            <div style={{ color: c.text3, fontSize: 13, padding: "14px 0", textAlign: "center" }}>로그 없음</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 320, overflowY: "auto" }}>
              {engineLog.map((e, i) => (
                <div key={i} style={{
                  padding: 10, background: c.card2, borderRadius: 8,
                  border: `1px solid ${c.border}`, fontSize: 12,
                }}>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 4 }}>
                    <span style={{ color: c.text3 }}>{new Date(e.time).toLocaleString()}</span>
                    {e.event === "position_closed" ? (
                      <Pill color={c.purple} bg={c.card}>CLOSED</Pill>
                    ) : e.dryRun ? (
                      <Pill color={c.yellow} bg={c.yellowBg}>DRY-RUN</Pill>
                    ) : (
                      <Pill color={c.green} bg={c.greenBg}>LIVE</Pill>
                    )}
                    {e.signal && (
                      <>
                        <Pill color={c.blue} bg={c.card}>{e.signal.symbol} {e.signal.side}</Pill>
                        <span style={{ color: c.text3 }}>conf {e.signal.confidence}</span>
                      </>
                    )}
                    {e.symbol && !e.signal && <Pill color={c.text2} bg={c.card}>{e.symbol}</Pill>}
                    {e.realizedPnL != null && (
                      <span style={{ color: e.realizedPnL >= 0 ? c.green : c.red, fontWeight: 700 }}>
                        {fmtUsd(e.realizedPnL)}
                      </span>
                    )}
                  </div>
                  {e.plan && (
                    <div style={{ color: c.text2, fontSize: 11 }}>
                      qty {e.plan.qty} · {e.plan.leverage}x · SL {fmtUsd(e.plan.slPrice)} · TP {fmtUsd(e.plan.tpPrice)}
                    </div>
                  )}
                  {e.result?.orderId && (
                    <div style={{ color: c.text3, fontSize: 11 }}>orderId: {e.result.orderId}</div>
                  )}
                  {e.result?.bracketRescue && (
                    <div style={{ color: c.red, fontSize: 11, fontWeight: 700, marginTop: 2 }}>
                      ⚠️ Bracket 실패 → 강제 청산 실행됨 ({e.result.bracketRescue.reason || "SL attach failed"})
                    </div>
                  )}
                  {e.mode && (
                    <div style={{ color: c.text3, fontSize: 10, marginTop: 2 }}>mode: {e.mode}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* ── 최근 주문 ── */}
        <Card c={c} title={`📑 최근 주문 (${orders.length})`}>
          {orders.length === 0 ? (
            <div style={{ color: c.text3, fontSize: 13, padding: "14px 0", textAlign: "center" }}>주문 없음</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ color: c.text3, textAlign: "left" }}>
                    <th style={{ padding: "8px 6px" }}>시간</th>
                    <th>심볼</th>
                    <th>방향</th>
                    <th>수량</th>
                    <th>체결가</th>
                    <th>상태</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.slice(0, 20).map((o, i) => (
                    <tr key={i} style={{ borderTop: `1px solid ${c.border}` }}>
                      <td style={{ padding: "8px 6px", color: c.text3 }}>{new Date(o.time).toLocaleTimeString()}</td>
                      <td style={{ fontWeight: 700 }}>{o.symbol}</td>
                      <td>
                        <Pill color={o.side === "LONG" ? c.green : c.red} bg={o.side === "LONG" ? c.greenBg : c.redBg}>
                          {o.side}
                        </Pill>
                      </td>
                      <td>{o.qty}</td>
                      <td>{fmtUsd(o.avgPrice || o.price)}</td>
                      <td><Pill color={c.text2} bg={c.card2}>{o.status || "-"}</Pill></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {/* ── Shadow 모드 패널 ── */}
        <Card c={c} title={`👻 Shadow 모드 ${shadowOn ? "(활성)" : "(비활성)"}`}>
          {shadow.summary ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10, fontSize: 12, marginBottom: 10 }}>
              <Stat c={c} label="총 트레이드" val={String(shadow.summary.trades || 0)} />
              <Stat c={c} label="승 / 패" val={`${shadow.summary.wins || 0} / ${shadow.summary.losses || 0}`} />
              <Stat c={c} label="승률" val={
                (shadow.summary.trades > 0
                  ? ((shadow.summary.wins || 0) / shadow.summary.trades * 100).toFixed(1) + "%"
                  : "-")
              } />
              <Stat c={c} label="누적 netPnL" val={fmtUsd(shadow.summary.netPnL)}
                color={(shadow.summary.netPnL || 0) >= 0 ? c.green : c.red} />
              <Stat c={c} label="평균 RR" val={
                (shadow.summary.trades > 0
                  ? ((shadow.summary.totalRR || 0) / shadow.summary.trades).toFixed(2) + "R"
                  : "-")
              } />
              <Stat c={c} label="오픈 중" val={String(shadow.openCount || 0)} />
            </div>
          ) : (
            <div style={{ color: c.text3, fontSize: 12, padding: "8px 0" }}>
              Shadow 기록 없음 — "Shadow 시작" 버튼으로 활성화하거나 "모의실행+probe" 로 테스트 진입을 만들어 보세요.
            </div>
          )}
          {shadow.recent?.length > 0 && (
            <div style={{ marginTop: 8, maxHeight: 260, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
              {shadow.recent.map((s, i) => (
                <div key={s.id || i} style={{
                  padding: 8, background: c.card2, borderRadius: 8, border: `1px solid ${c.border}`,
                  fontSize: 11, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center",
                }}>
                  <span style={{ color: c.text3 }}>{new Date(s.openedAt).toLocaleString()}</span>
                  <Pill color={s.status === "OPEN" ? c.blue : c.purple} bg={c.card}>{s.status}</Pill>
                  <Pill color={c.text1} bg={c.card}>{s.signal?.symbol} {s.signal?.side}</Pill>
                  {s.entryPrice && <span style={{ color: c.text3 }}>E {fmtUsd(s.entryPrice)}</span>}
                  {s.exitPrice && <span style={{ color: c.text3 }}>X {fmtUsd(s.exitPrice)}</span>}
                  {s.netPnL != null && (
                    <span style={{ color: s.netPnL >= 0 ? c.green : c.red, fontWeight: 700 }}>
                      {fmtUsd(s.netPnL)}
                    </span>
                  )}
                  {s.closeReason && <span style={{ color: c.text3 }}>· {s.closeReason}</span>}
                </div>
              ))}
            </div>
          )}
          <div style={{ marginTop: 10, fontSize: 11, color: c.text3, lineHeight: 1.6 }}>
            Shadow 모드는 실제 주문 없이 파이프라인 전체를 기록합니다. 수수료(8bps) + 슬리피지(5bps) 비용이 반영된 netPnL 로 집계됩니다.
          </div>
        </Card>

        {/* ── Reconcile 로그 ── */}
        {reconcile.length > 0 && (
          <Card c={c} title="🔄 일일 Reconcile (Binance = 진실)">
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {reconcile.map((r, i) => (
                <div key={i} style={{
                  padding: 10, background: c.card2, borderRadius: 8,
                  border: `1px solid ${c.border}`, fontSize: 12,
                }}>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <span style={{ color: c.text3 }}>{new Date(r.time).toLocaleString()}</span>
                    <Pill color={(r.drift && (r.drift.missing?.length || r.drift.extra?.length || r.drift.mismatch?.length)) ? c.yellow : c.green}
                      bg={c.card}>
                      {(r.drift && (r.drift.missing?.length || r.drift.extra?.length || r.drift.mismatch?.length)) ? "DRIFT" : "OK"}
                    </Pill>
                    {r.realizedToday != null && (
                      <span style={{ color: r.realizedToday >= 0 ? c.green : c.red, fontWeight: 700 }}>
                        Today {fmtUsd(r.realizedToday)}
                      </span>
                    )}
                  </div>
                  {r.drift && (
                    <div style={{ color: c.text2, fontSize: 11, marginTop: 4 }}>
                      missing {r.drift.missing?.length || 0} · extra {r.drift.extra?.length || 0} · mismatch {r.drift.mismatch?.length || 0}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* ── 리스크 설정 요약 (읽기 전용) ── */}
        <Card c={c} title="⚙️ 리스크 설정 (Option A — 절대수익형)">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, fontSize: 12 }}>
            <Stat c={c} label="트레이드당 리스크" val="0.8% of equity (≈$0.8)" />
            <Stat c={c} label="최대 증거금 비율" val="35% of equity" />
            <Stat c={c} label="레버리지 범위" val="2x ~ 5x (동적)" />
            <Stat c={c} label="동시 포지션 한도" val="최대 2개 (상관군 분리)" />
            <Stat c={c} label="SL / TP 방식" val="ATR(14) · 수수료+슬리피지 반영" />
            <Stat c={c} label="최소 net RR" val="1.8R (비용 차감 후)" />
            <Stat c={c} label="심볼 선택" val="exchangeInfo 동적 필터 + 상관군" />
            <Stat c={c} label="최대 보유 시간" val="48시간" />
            <Stat c={c} label="일 손실 한도" val="-4%" color={c.red} />
            <Stat c={c} label="주 손실 한도" val="-8%" color={c.red} />
            <Stat c={c} label="MDD 한도" val="-15%" color={c.red} />
            <Stat c={c} label="청산 안전버퍼" val="0.7 × liqDist" />
            <Stat c={c} label="연속손실 쿨다운" val="5회 → 24h" />
            <Stat c={c} label="비용 가정" val="0.08% 수수료 + 0.05% 슬리피지" />
          </div>
          <div style={{ marginTop: 12, fontSize: 11, color: c.text3, lineHeight: 1.6 }}>
            Option A 절대수익형 프리셋 — Killswitch 기본 fail-closed, Bracket 주문 실패 시 자동 강제청산, 일일 Reconcile 포함.
            이 값들은 <code>api/_shared/risk-manager.js::RISK_CONFIG</code> 에서 관리됩니다.
          </div>
        </Card>

        {/* ── 도움말 ── */}
        <Card c={c} title="📘 안전 활성화 순서 (권장)">
          <ol style={{ margin: 0, paddingLeft: 20, color: c.text2, fontSize: 12, lineHeight: 1.8 }}>
            <li><b>모의실행+probe</b> 로 전체 파이프라인(signal → plan → bracket) 이 에러 없이 돌아가는지 확인.</li>
            <li><b>Shadow 시작</b> — 실거래 없이 2~4주 가상 트레이드 축적, 요약 통계(승률·netPnL·평균 RR) 관찰.</li>
            <li>Shadow 결과가 기대치(양의 netPnL, RR≥1.5) 충족 시 <b>Phase 1 등록</b>.</li>
            <li><b>Killswitch 해제</b> — 이 시점부터 5분 내 실거래 발생 가능 (소액부터).</li>
            <li>오픈 포지션 / 엔진 로그 / Reconcile / 브레이커 상태 주기 확인.</li>
            <li>문제 발생 시 <b>긴급 정지</b> → <b>Phase 1 해제</b>.</li>
          </ol>
        </Card>
      </div>

      {/* ── Confirm Modal ── */}
      {confirmAction && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)",
          display: "flex", alignItems: "center", justifyContent: "center",
          zIndex: 1000, padding: 16,
        }}>
          <div style={{
            background: c.card, border: `1px solid ${c.border2}`,
            borderRadius: 14, padding: 22, maxWidth: 460, width: "100%",
          }}>
            <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 10, color: c.text1 }}>
              {confirmAction.title}
            </div>
            <div style={{ fontSize: 13, color: c.text2, whiteSpace: "pre-wrap", marginBottom: 18, lineHeight: 1.6 }}>
              {confirmAction.desc}
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <Btn c={c} onClick={() => setConfirmAction(null)} variant="ghost">취소</Btn>
              <Btn c={c} variant={confirmAction.variant || "primary"}
                onClick={async () => { setConfirmAction(null); await confirmAction.onConfirm(); }}>
                확인
              </Btn>
            </div>
          </div>
        </div>
      )}

      {/* ── Toast ── */}
      {toast && (
        <div style={{
          position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)",
          padding: "12px 20px", borderRadius: 10,
          background: toast.kind === "error" ? c.red : toast.kind === "success" ? c.green : c.blue,
          color: "#fff", fontWeight: 700, fontSize: 13, zIndex: 1001,
          boxShadow: "0 10px 30px rgba(0,0,0,0.3)",
        }}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}

function Stat({ c, label, val, color }) {
  return (
    <div style={{ padding: 10, background: c.card2, borderRadius: 8, border: `1px solid ${c.border}` }}>
      <div style={{ fontSize: 10, color: c.text3, marginBottom: 3, letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 700, color: color || c.text1, wordBreak: "break-word" }}>{val}</div>
    </div>
  );
}
