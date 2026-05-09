// ══════════════════════════════════════════════════════════════════
// Zepta — 실거래 대시보드 위젯 모음 (Option D)
// 7개 위젯: 자산곡선·라이브메트릭·포지션도넛·거래내역·일별히트맵·
//          시그널워치리스트·시스템상태
// ══════════════════════════════════════════════════════════════════
import React, { useMemo } from "react";

// ═══════════════════════════════════════════════════════════════════
// 공통 포맷터
// ═══════════════════════════════════════════════════════════════════
const fmtUsd = (v, d = 2) => {
  if (v == null || !isFinite(v)) return "—";
  const n = Number(v);
  return (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d });
};
const fmtPct = (v, d = 2) => (v == null || !isFinite(v)) ? "—" : (v >= 0 ? "+" : "") + Number(v).toFixed(d) + "%";
const fmtTimeShort = (ts) => {
  if (!ts) return "—";
  const d = new Date(ts);
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

// ═══════════════════════════════════════════════════════════════════
// Widget 1 — 자산 추이 라인 차트 (30일 equity curve)
// ═══════════════════════════════════════════════════════════════════
export function EquityCurveChart({ history = [], currentEquity, peakEquity, isMobile = false, days = 30 }) {
  const chartData = useMemo(() => {
    if (!Array.isArray(history) || history.length === 0) return null;
    // 최근 days 일치 필터
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const filtered = history.filter((s) => s.ts >= cutoff && isFinite(s.equity));
    if (filtered.length < 2) {
      // 데이터가 1개 이하면 현재 잔고만 마커로 표시
      if (currentEquity && filtered.length === 1) {
        return { points: [filtered[0], { ts: Date.now(), equity: currentEquity }], single: true };
      }
      return null;
    }
    return { points: filtered, single: false };
  }, [history, currentEquity, days]);

  if (!chartData) {
    return (
      <div style={{
        padding: 28, textAlign: "center", fontSize: 12,
        color: "var(--z-text-3)", border: "1px dashed var(--z-border)",
        borderRadius: "var(--z-r-md)",
      }}>
        자산 추이 데이터를 모으는 중이에요. 자동매매가 30분 이상 돌아가면 그래프가 표시됩니다.
      </div>
    );
  }

  const { points } = chartData;
  const equities = points.map((p) => p.equity);
  const minE = Math.min(...equities) * 0.995;
  const maxE = Math.max(...equities) * 1.005;
  const range = maxE - minE || 1;
  const W = isMobile ? 320 : 720;
  const H = isMobile ? 120 : 160;
  const PAD = 8;

  const minTs = points[0].ts;
  const maxTs = points[points.length - 1].ts;
  const tsRange = maxTs - minTs || 1;
  const xOf = (ts) => PAD + ((ts - minTs) / tsRange) * (W - PAD * 2);
  const yOf = (eq) => H - PAD - ((eq - minE) / range) * (H - PAD * 2);

  const pathPts = points.map((p) => `${xOf(p.ts).toFixed(1)},${yOf(p.equity).toFixed(1)}`);
  const linePath = `M${pathPts.join(" L")}`;
  const areaPath = `${linePath} L${xOf(maxTs).toFixed(1)},${(H - PAD).toFixed(1)} L${PAD},${(H - PAD).toFixed(1)} Z`;

  const first = points[0].equity;
  const last = points[points.length - 1].equity;
  const totalReturn = ((last - first) / first) * 100;
  const isUp = last >= first;
  const lineColor = isUp ? "var(--z-green-hi)" : "var(--z-red-hi)";
  const peakY = peakEquity && peakEquity > 0 && peakEquity >= minE && peakEquity <= maxE ? yOf(peakEquity) : null;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
        <div style={{ fontSize: 11, color: "var(--z-text-3)", fontWeight: 600 }}>
          최근 {days}일 자산 추이
        </div>
        <div style={{
          fontSize: isMobile ? 13 : 15, fontWeight: 800,
          color: lineColor, fontFamily: "var(--z-font-mono)",
        }}>
          {isUp ? "+" : ""}{totalReturn.toFixed(2)}%
        </div>
      </div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ display: "block" }}>
        <defs>
          <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={isUp ? "rgba(34,197,94,0.28)" : "rgba(239,68,68,0.28)"} />
            <stop offset="100%" stopColor={isUp ? "rgba(34,197,94,0)" : "rgba(239,68,68,0)"} />
          </linearGradient>
        </defs>
        {/* y축 그리드 — 4분할 */}
        {[0.25, 0.5, 0.75].map((p, i) => (
          <line key={i} x1={PAD} y1={PAD + p * (H - PAD * 2)} x2={W - PAD} y2={PAD + p * (H - PAD * 2)}
            stroke="var(--z-border)" strokeWidth="0.5" strokeDasharray="2 3" opacity="0.5" />
        ))}
        {/* peak 라인 */}
        {peakY && (
          <line x1={PAD} y1={peakY} x2={W - PAD} y2={peakY}
            stroke="var(--z-purple)" strokeWidth="1" strokeDasharray="3 4" opacity="0.55" />
        )}
        <path d={areaPath} fill="url(#eqGrad)" />
        <path d={linePath} fill="none" stroke={lineColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        {/* 마지막 점 */}
        <circle cx={xOf(maxTs)} cy={yOf(last)} r="3.5" fill={lineColor} />
        <circle cx={xOf(maxTs)} cy={yOf(last)} r="6" fill={lineColor} opacity="0.2" />
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--z-text-3)", marginTop: 4 }}>
        <span>{fmtTimeShort(minTs)}</span>
        {peakEquity && <span style={{ color: "var(--z-purple)" }}>· · · 30일 peak {fmtUsd(peakEquity)}</span>}
        <span>{fmtTimeShort(maxTs)}</span>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Widget 2 — 라이브 성과 메트릭 행
// recentOrders + recentEngineLog 에서 라이브 계산
// ═══════════════════════════════════════════════════════════════════
function computeLiveMetrics(orders) {
  // orders: [{ symbol, side, qty, price, pnl?, time, status, ... }]
  if (!Array.isArray(orders) || orders.length === 0) {
    return { totalTrades: 0, closedTrades: 0, winRate: 0, profitFactor: 0, avgWin: 0, avgLoss: 0, totalPnL: 0, sharpeApprox: 0 };
  }
  let wins = 0, losses = 0, grossWin = 0, grossLoss = 0, totalPnL = 0;
  const pnls = [];
  for (const o of orders) {
    const pnl = parseFloat(o.pnl || o.realizedPnl || 0);
    const isClose = (o.side === "SELL" || o.reduceOnly === true || o.closing === true) && isFinite(pnl) && pnl !== 0;
    if (!isClose) continue;
    pnls.push(pnl);
    totalPnL += pnl;
    if (pnl > 0) { wins++; grossWin += pnl; }
    else if (pnl < 0) { losses++; grossLoss += Math.abs(pnl); }
  }
  const closedTrades = wins + losses;
  const winRate = closedTrades > 0 ? (wins / closedTrades) * 100 : 0;
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? Infinity : 0);
  const avgWin = wins > 0 ? grossWin / wins : 0;
  const avgLoss = losses > 0 ? grossLoss / losses : 0;
  // Sharpe 근사: mean / stdev × √(거래수). 변동성·수익률 단위 PNL.
  let sharpeApprox = 0;
  if (pnls.length > 1) {
    const mean = totalPnL / pnls.length;
    const variance = pnls.reduce((s, p) => s + (p - mean) ** 2, 0) / pnls.length;
    const std = Math.sqrt(variance);
    sharpeApprox = std > 0 ? (mean / std) * Math.sqrt(pnls.length) : 0;
  }
  return {
    totalTrades: orders.length, closedTrades, wins, losses,
    winRate, profitFactor, avgWin, avgLoss, totalPnL, sharpeApprox,
  };
}

// Sharpe → 등급 (AutoTrading.jsx 와 동일 규칙)
function sharpeGrade(s) {
  if (!isFinite(s)) return { label: "—", grade: "—", color: "var(--z-text-3)" };
  if (s >= 2.0) return { label: "매우 우수", grade: "S", color: "var(--z-green-hi)" };
  if (s >= 1.5) return { label: "우수", grade: "A", color: "var(--z-green-hi)" };
  if (s >= 1.0) return { label: "양호", grade: "B", color: "var(--z-blue-hi)" };
  if (s >= 0.5) return { label: "보통", grade: "C", color: "var(--z-yellow-hi)" };
  if (s > -0.5) return { label: "관찰", grade: "D", color: "var(--z-text-3)" };
  return { label: "주의", grade: "E", color: "var(--z-red-hi)" };
}

export function LiveMetricsRow({ orders = [], isMobile = false }) {
  const m = useMemo(() => computeLiveMetrics(orders), [orders]);
  const sg = sharpeGrade(m.sharpeApprox);
  const pfStr = m.profitFactor === Infinity ? "∞" : m.profitFactor > 0 ? m.profitFactor.toFixed(2) : "--";
  const pfColor = m.profitFactor === Infinity ? "var(--z-green-hi)"
                : m.profitFactor >= 1.5 ? "var(--z-green-hi)"
                : m.profitFactor >= 1.0 ? "var(--z-yellow-hi)"
                : m.closedTrades > 0 ? "var(--z-red-hi)" : "var(--z-text-3)";
  const cards = [
    { label: "총 거래", value: m.totalTrades, sub: `청산 ${m.closedTrades}건`, color: "var(--z-text-1)" },
    { label: "승률", value: m.closedTrades > 0 ? `${m.winRate.toFixed(0)}%` : "—",
      sub: m.closedTrades > 0 ? `${m.wins}승 ${m.losses}패` : "거래 후 집계",
      color: m.winRate >= 60 ? "var(--z-green-hi)" : m.winRate >= 50 ? "var(--z-yellow-hi)" : m.closedTrades > 0 ? "var(--z-red-hi)" : "var(--z-text-3)" },
    { label: "손익비 (PF)", value: pfStr, sub: m.closedTrades > 0 ? `${fmtUsd(m.avgWin, 1)} / ${fmtUsd(m.avgLoss, 1)}` : "PF=GrossWin/GrossLoss", color: pfColor },
    { label: "안정성 등급", value: m.closedTrades >= 2 ? `${sg.grade} ${sg.label}` : "—",
      sub: m.closedTrades >= 2 ? `Sharpe ≈ ${m.sharpeApprox.toFixed(2)}` : "최소 2거래 필요", color: sg.color },
    { label: "누적 실현손익", value: fmtUsd(m.totalPnL),
      sub: m.closedTrades > 0 ? `평균 ${fmtUsd(m.totalPnL / m.closedTrades, 2)}/건` : "—",
      color: m.totalPnL > 0 ? "var(--z-green-hi)" : m.totalPnL < 0 ? "var(--z-red-hi)" : "var(--z-text-1)" },
  ];

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(5, 1fr)",
      gap: 8,
    }}>
      {cards.map((c, i) => (
        <div key={i} style={{
          background: "var(--z-card-2)", border: "1px solid var(--z-border)",
          borderRadius: "var(--z-r-md)", padding: isMobile ? "10px 12px" : "12px 14px",
          minHeight: isMobile ? 76 : 84, display: "flex", flexDirection: "column", justifyContent: "center",
        }}>
          <div style={{ fontSize: 10, color: "var(--z-text-3)", fontWeight: 600, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.4 }}>
            {c.label}
          </div>
          <div style={{ fontSize: isMobile ? 16 : 19, fontWeight: 800, color: c.color, fontFamily: "var(--z-font-mono)", lineHeight: 1.1 }}>
            {c.value}
          </div>
          <div style={{ fontSize: 10, color: "var(--z-text-3)", marginTop: 3, lineHeight: 1.3 }}>
            {c.sub}
          </div>
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Widget 3 — 포지션 비중 도넛 차트
// ═══════════════════════════════════════════════════════════════════
const POS_COLORS = [
  "#3b82f6", "#a855f7", "#22c55e", "#f59e0b", "#ef4444", "#06b6d4",
  "#ec4899", "#14b8a6", "#84cc16", "#f97316",
];

export function PositionDonutChart({ positions = [], equity = 0, isMobile = false }) {
  const slices = useMemo(() => {
    const arr = (positions || []).map((p) => {
      const mv = Math.abs((p.markPrice || p.entryPrice || 0) * (p.positionAmt || 0));
      return { symbol: p.symbol, value: mv, side: p.positionAmt > 0 ? "L" : "S", pnl: p.unRealizedProfit || 0 };
    }).filter((s) => s.value > 0);
    arr.sort((a, b) => b.value - a.value);
    return arr;
  }, [positions]);
  const totalPos = slices.reduce((s, x) => s + x.value, 0);
  const cash = Math.max(0, equity - totalPos);
  const all = totalPos > 0 ? [...slices, { symbol: "현금", value: cash, side: "C", pnl: 0 }] : [];
  const grandTotal = totalPos + cash;

  if (totalPos === 0 || grandTotal === 0) {
    return (
      <div style={{
        padding: 28, textAlign: "center", fontSize: 12,
        color: "var(--z-text-3)", border: "1px dashed var(--z-border)",
        borderRadius: "var(--z-r-md)",
      }}>
        보유 포지션이 없어요. 자동매매가 진입하면 비중 도넛이 표시됩니다.
      </div>
    );
  }

  const SIZE = isMobile ? 140 : 160;
  const STROKE = isMobile ? 22 : 26;
  const R = (SIZE - STROKE) / 2;
  const C = 2 * Math.PI * R;
  let offset = 0;

  return (
    <div style={{ display: "flex", gap: isMobile ? 12 : 20, alignItems: "center", flexWrap: "wrap" }}>
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} style={{ flexShrink: 0 }}>
        <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke="var(--z-card-2)" strokeWidth={STROKE} />
        {all.map((s, i) => {
          const pct = s.value / grandTotal;
          const len = pct * C;
          const color = s.symbol === "현금" ? "rgba(148,163,184,0.35)" : POS_COLORS[i % POS_COLORS.length];
          const el = (
            <circle key={i} cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none"
              stroke={color} strokeWidth={STROKE}
              strokeDasharray={`${len.toFixed(2)} ${(C - len).toFixed(2)}`}
              strokeDashoffset={-offset}
              transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`} />
          );
          offset += len;
          return el;
        })}
        <text x="50%" y="46%" textAnchor="middle" style={{ fontSize: isMobile ? 10 : 11, fill: "var(--z-text-3)" }}>총 자산</text>
        <text x="50%" y="58%" textAnchor="middle" style={{ fontSize: isMobile ? 14 : 16, fontWeight: 800, fill: "var(--z-text-1)", fontFamily: "var(--z-font-mono)" }}>
          {fmtUsd(grandTotal, 0)}
        </text>
      </svg>
      <div style={{ flex: 1, minWidth: 180, display: "flex", flexDirection: "column", gap: 5 }}>
        {all.map((s, i) => {
          const pct = (s.value / grandTotal) * 100;
          const color = s.symbol === "현금" ? "rgba(148,163,184,0.6)" : POS_COLORS[i % POS_COLORS.length];
          return (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: color, flexShrink: 0 }} />
              <span style={{ flex: 1, color: "var(--z-text-1)", fontWeight: s.symbol === "현금" ? 400 : 600 }}>
                {s.symbol}
                {s.side === "L" && <span style={{ marginLeft: 4, fontSize: 9, color: "var(--z-green-hi)" }}>L</span>}
                {s.side === "S" && <span style={{ marginLeft: 4, fontSize: 9, color: "var(--z-red-hi)" }}>S</span>}
              </span>
              <span style={{ fontFamily: "var(--z-font-mono)", color: "var(--z-text-2)", fontSize: 11 }}>{pct.toFixed(1)}%</span>
              <span style={{ fontFamily: "var(--z-font-mono)", color: "var(--z-text-3)", fontSize: 10, minWidth: 56, textAlign: "right" }}>
                {fmtUsd(s.value, 0)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Widget 4 — 거래 히스토리 강화 테이블
// ═══════════════════════════════════════════════════════════════════
export function TradeHistoryTable({ orders = [], maxRows = 10, isMobile = false }) {
  const rows = useMemo(() => (orders || []).slice(0, maxRows), [orders, maxRows]);
  if (rows.length === 0) {
    return (
      <div style={{
        padding: 24, textAlign: "center", fontSize: 12,
        color: "var(--z-text-3)", border: "1px dashed var(--z-border)",
        borderRadius: "var(--z-r-md)",
      }}>
        아직 체결된 거래가 없어요.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {/* 헤더 */}
      {!isMobile && (
        <div style={{
          display: "grid",
          gridTemplateColumns: "90px 80px 50px 1fr 90px 70px",
          gap: 8, fontSize: 10, color: "var(--z-text-3)", fontWeight: 600,
          padding: "0 10px", textTransform: "uppercase", letterSpacing: 0.3,
        }}>
          <span>시간</span><span>심볼</span><span>Side</span><span style={{ textAlign: "right" }}>가격</span>
          <span style={{ textAlign: "right" }}>P&L</span><span style={{ textAlign: "right" }}>상태</span>
        </div>
      )}
      {rows.map((o, i) => {
        const pnl = parseFloat(o.pnl || o.realizedPnl || 0);
        const hasPnl = isFinite(pnl) && pnl !== 0;
        const pnlColor = pnl > 0 ? "var(--z-green-hi)" : pnl < 0 ? "var(--z-red-hi)" : "var(--z-text-3)";
        const sideColor = o.side === "BUY" ? "var(--z-green-hi)" : "var(--z-red-hi)";
        const statusColor = o.status === "filled" || o.status === "FILLED" ? "var(--z-green-hi)"
                          : o.status === "rejected" || o.status === "REJECTED" ? "var(--z-red-hi)"
                          : "var(--z-text-3)";
        if (isMobile) {
          return (
            <div key={i} style={{
              padding: "8px 10px", background: "var(--z-card-2)",
              border: "1px solid var(--z-border)", borderRadius: "var(--z-r-md)",
              fontSize: 11,
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                <span style={{ fontWeight: 700, color: "var(--z-text-1)" }}>{o.symbol || "—"}</span>
                <span style={{ color: sideColor, fontWeight: 700 }}>{o.side}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", color: "var(--z-text-3)", fontFamily: "var(--z-font-mono)" }}>
                <span>{fmtTimeShort(o.time)}</span>
                <span>{fmtUsd(parseFloat(o.price || 0), 2)}</span>
                {hasPnl && <span style={{ color: pnlColor, fontWeight: 700 }}>{pnl >= 0 ? "+" : ""}{fmtUsd(pnl, 2)}</span>}
              </div>
            </div>
          );
        }
        return (
          <div key={i} style={{
            display: "grid", gridTemplateColumns: "90px 80px 50px 1fr 90px 70px", gap: 8,
            padding: "8px 10px", background: i % 2 === 0 ? "var(--z-card-2)" : "transparent",
            border: "1px solid var(--z-border)", borderRadius: "var(--z-r-md)",
            fontSize: 12, alignItems: "center",
          }}>
            <span style={{ color: "var(--z-text-3)", fontFamily: "var(--z-font-mono)", fontSize: 11 }}>
              {fmtTimeShort(o.time)}
            </span>
            <span style={{ fontWeight: 700, color: "var(--z-text-1)" }}>{o.symbol || "—"}</span>
            <span style={{ color: sideColor, fontWeight: 700 }}>{o.side || "—"}</span>
            <span style={{ textAlign: "right", fontFamily: "var(--z-font-mono)", color: "var(--z-text-2)" }}>
              {fmtUsd(parseFloat(o.price || 0), 2)} × {o.qty || "—"}
            </span>
            <span style={{ textAlign: "right", color: pnlColor, fontWeight: hasPnl ? 700 : 400, fontFamily: "var(--z-font-mono)" }}>
              {hasPnl ? `${pnl >= 0 ? "+" : ""}${fmtUsd(pnl, 2)}` : "—"}
            </span>
            <span style={{ textAlign: "right", fontSize: 10, color: statusColor, fontWeight: 600 }}>
              {o.status || "—"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Widget 5 — 일별 손익 캘린더 히트맵 (최근 30일)
// ═══════════════════════════════════════════════════════════════════
export function DailyPnLHeatmap({ orders = [], days = 30, isMobile = false }) {
  const dayBuckets = useMemo(() => {
    const buckets = {};
    for (const o of orders || []) {
      const pnl = parseFloat(o.pnl || o.realizedPnl || 0);
      if (!isFinite(pnl) || pnl === 0) continue;
      const t = o.time ? new Date(o.time) : null;
      if (!t || isNaN(t.getTime())) continue;
      // KST 자정 기준 일자
      const kst = new Date(t.getTime() + 9 * 3600000);
      const key = `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, "0")}-${String(kst.getUTCDate()).padStart(2, "0")}`;
      if (!buckets[key]) buckets[key] = { pnl: 0, trades: 0, date: key };
      buckets[key].pnl += pnl;
      buckets[key].trades += 1;
    }
    // 최근 days 일치 array
    const arr = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today.getTime() - i * 24 * 3600000);
      const kst = new Date(d.getTime() + 9 * 3600000);
      const key = `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, "0")}-${String(kst.getUTCDate()).padStart(2, "0")}`;
      arr.push(buckets[key] || { pnl: 0, trades: 0, date: key });
    }
    return arr;
  }, [orders, days]);

  const totalPnl = dayBuckets.reduce((s, d) => s + d.pnl, 0);
  const maxAbs = Math.max(...dayBuckets.map((d) => Math.abs(d.pnl)), 1);
  const winDays = dayBuckets.filter((d) => d.pnl > 0).length;
  const lossDays = dayBuckets.filter((d) => d.pnl < 0).length;
  const tradeDays = dayBuckets.filter((d) => d.trades > 0).length;

  const colorOf = (pnl) => {
    if (pnl === 0) return "var(--z-card-2)";
    const intensity = Math.min(1, Math.abs(pnl) / maxAbs);
    if (pnl > 0) {
      const a = 0.15 + intensity * 0.6;
      return `rgba(34, 197, 94, ${a.toFixed(2)})`;
    } else {
      const a = 0.15 + intensity * 0.6;
      return `rgba(239, 68, 68, ${a.toFixed(2)})`;
    }
  };

  const cellSize = isMobile ? 14 : 18;
  const cellGap = 3;
  const cols = isMobile ? 10 : days;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8, flexWrap: "wrap", gap: 6 }}>
        <div style={{ fontSize: 11, color: "var(--z-text-3)", fontWeight: 600 }}>
          최근 {days}일 일별 손익 ({tradeDays}일 거래)
        </div>
        <div style={{ display: "flex", gap: 10, fontSize: 11, fontFamily: "var(--z-font-mono)" }}>
          <span style={{ color: "var(--z-green-hi)", fontWeight: 700 }}>+{winDays}일</span>
          <span style={{ color: "var(--z-red-hi)", fontWeight: 700 }}>-{lossDays}일</span>
          <span style={{ color: totalPnl >= 0 ? "var(--z-green-hi)" : "var(--z-red-hi)", fontWeight: 800 }}>
            합계 {fmtUsd(totalPnl)}
          </span>
        </div>
      </div>
      <div style={{
        display: "grid",
        gridTemplateColumns: `repeat(${cols}, ${cellSize}px)`,
        gap: `${cellGap}px`,
        justifyContent: "start",
      }}>
        {dayBuckets.map((d, i) => (
          <div
            key={i}
            title={`${d.date} · ${d.trades}건 · ${fmtUsd(d.pnl)}`}
            style={{
              width: cellSize, height: cellSize,
              background: colorOf(d.pnl),
              borderRadius: 3,
              border: d.trades === 0 ? "1px solid var(--z-border)" : "none",
              cursor: d.trades > 0 ? "help" : "default",
            }}
          />
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 9, color: "var(--z-text-3)" }}>
        <span>{days}일 전</span>
        <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
          <span style={{ fontSize: 9 }}>적음</span>
          {[0.15, 0.35, 0.55, 0.75].map((a, i) => (
            <span key={i} style={{ width: 8, height: 8, background: `rgba(34, 197, 94, ${a})`, borderRadius: 2 }} />
          ))}
          <span style={{ fontSize: 9 }}>많음</span>
        </span>
        <span>오늘</span>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Widget 6 — 시그널 워치리스트
// ═══════════════════════════════════════════════════════════════════
export function SignalWatchlist({ signals = [], loading = false, isMobile = false }) {
  if (loading) {
    return (
      <div style={{
        padding: 18, textAlign: "center", fontSize: 12,
        color: "var(--z-text-3)",
      }}>
        시그널 분석 중...
      </div>
    );
  }
  if (!Array.isArray(signals) || signals.length === 0) {
    return (
      <div style={{
        padding: 24, textAlign: "center", fontSize: 12,
        color: "var(--z-text-3)", border: "1px dashed var(--z-border)",
        borderRadius: "var(--z-r-md)",
      }}>
        현재 진입 후보 시그널이 없어요. 5분마다 갱신됩니다.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {signals.slice(0, 8).map((s, i) => {
        const sideColor = s.side === "buy" || s.side === "BUY" || s.side === "long" ? "var(--z-green-hi)"
                        : s.side === "sell" || s.side === "SELL" || s.side === "short" ? "var(--z-red-hi)"
                        : "var(--z-text-3)";
        const score = parseFloat(s.score || 0);
        const scoreColor = score >= 8 ? "var(--z-green-hi)" : score >= 6 ? "var(--z-yellow-hi)" : "var(--z-text-3)";
        return (
          <div key={i} style={{
            display: "grid",
            gridTemplateColumns: isMobile ? "1fr 70px 60px" : "70px 50px 1fr 60px 80px",
            gap: 8, alignItems: "center",
            padding: "7px 10px", background: "var(--z-card-2)",
            border: "1px solid var(--z-border)", borderRadius: "var(--z-r-md)",
            fontSize: 12,
          }}>
            <span style={{ fontWeight: 700, color: "var(--z-text-1)" }}>{s.symbol || s.asset || "—"}</span>
            {!isMobile && <span style={{ color: sideColor, fontWeight: 700, fontSize: 11 }}>{s.side?.toUpperCase() || "—"}</span>}
            {!isMobile && (
              <span style={{ color: "var(--z-text-3)", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {s.reason || s.strategy || "—"}
              </span>
            )}
            <span style={{ textAlign: "right", color: scoreColor, fontWeight: 700, fontFamily: "var(--z-font-mono)" }}>
              {score > 0 ? score.toFixed(1) : "—"}
            </span>
            <span style={{ textAlign: "right", color: "var(--z-text-3)", fontSize: 10, fontFamily: "var(--z-font-mono)" }}>
              {s.confidence ? `${(parseFloat(s.confidence) * 100).toFixed(0)}%` : "—"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Widget 7 — 시스템 상태 표시등
// ═══════════════════════════════════════════════════════════════════
export function SystemStatusIndicator({ status = {}, isMobile = false }) {
  // status: { kvOk, binanceOk, lastCronTs, lastErrorAt, engineLastRunAt }
  const dots = [
    {
      label: "KV", ok: status.kvOk !== false,
      detail: status.kvOk === false ? "연결 실패" : "정상",
    },
    {
      label: "Binance", ok: status.binanceOk !== false,
      detail: status.binanceOk === false ? "API 응답 없음" : "정상",
    },
    {
      label: "엔진",
      ok: status.engineLastRunAt && (Date.now() - new Date(status.engineLastRunAt).getTime()) < 30 * 60 * 1000,
      detail: status.engineLastRunAt ? `${fmtTimeShort(status.engineLastRunAt)}` : "미실행",
    },
    {
      label: "최근 오류",
      ok: !status.lastErrorAt || (Date.now() - new Date(status.lastErrorAt).getTime()) > 60 * 60 * 1000,
      detail: status.lastErrorAt ? fmtTimeShort(status.lastErrorAt) : "없음",
    },
  ];

  return (
    <div style={{
      display: "flex", gap: isMobile ? 8 : 14, flexWrap: "wrap",
      padding: "8px 12px", background: "var(--z-card-2)",
      border: "1px solid var(--z-border)", borderRadius: "var(--z-r-md)",
    }}>
      {dots.map((d, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11 }}>
          <span style={{
            width: 8, height: 8, borderRadius: "50%",
            background: d.ok ? "var(--z-green-hi)" : "var(--z-red-hi)",
            boxShadow: d.ok ? "0 0 6px rgba(34,197,94,0.5)" : "0 0 6px rgba(239,68,68,0.5)",
            flexShrink: 0,
          }} />
          <span style={{ color: "var(--z-text-2)", fontWeight: 600 }}>{d.label}</span>
          <span style={{ color: "var(--z-text-3)", fontFamily: "var(--z-font-mono)", fontSize: 10 }}>{d.detail}</span>
        </div>
      ))}
    </div>
  );
}
