// ══════════════════════════════════════════════════════════════════
// Zepta — 백테스트 비교 페이지 (/backtest-compare)
// ──────────────────────────────────────────────────────────────────
// multi-strategy 동시 비교. 같은 자산·기간에 N개의 strategy 백테스트 결과를
// 한 차트에 overlay.
//
// UI:
//   1) 자산 선택 (BTC/ETH/SOL/AAPL/TSLA …)
//   2) 기간 선택 (30/60/90일)
//   3) Strategy 다중 선택 (8개 중 N개)
//   4) 결과:
//      - 누적 수익률 라인 차트 (SVG, 각 strategy 색 다름)
//      - 메트릭 테이블 (Sharpe / PF / MDD / 거래수 / 승률)
//      - 최고 strategy 하이라이트
//
// API: GET /api/backtest-compare?symbol=&period=&strategies=
// 캐시: 서버 5분 캐시 — UI 는 그대로 fetch.
// ══════════════════════════════════════════════════════════════════
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useThemeTokens, FONT, RADIUS, pickFont } from "./ui/theme.jsx";
import { useBreakpoint } from "./ui/useBreakpoint.jsx";
import { BottomSheet } from "./ui/primitives.jsx";

// ── 옵션 ───────────────────────────────────────────────────────────
const ASSETS = [
  { id: "BTC",  label: "BTC",  kind: "crypto" },
  { id: "ETH",  label: "ETH",  kind: "crypto" },
  { id: "SOL",  label: "SOL",  kind: "crypto" },
  { id: "BNB",  label: "BNB",  kind: "crypto" },
  { id: "AAPL", label: "AAPL", kind: "stock" },
  { id: "TSLA", label: "TSLA", kind: "stock" },
  { id: "NVDA", label: "NVDA", kind: "stock" },
  { id: "MSFT", label: "MSFT", kind: "stock" },
];

const PERIODS = [
  { value: 30, label: "30일" },
  { value: 60, label: "60일" },
  { value: 90, label: "90일" },
];

const STRATEGIES = [
  { id: "trend-follow",      label: "추세 추종",      color: "#3B82F6" },
  { id: "mean-revert",       label: "평균 회귀",      color: "#10D884" },
  { id: "breakout",          label: "돌파",          color: "#FF6B2C" },
  { id: "momentum-rotation", label: "모멘텀 로테이션", color: "#9B6FFF" },
  { id: "volatility-arb",    label: "변동성 차익",    color: "#FFB020" },
  { id: "hurst-trend",       label: "Hurst 추세",    color: "#FF4D64" },
  { id: "defi-momentum",     label: "DeFi 모멘텀",   color: "#60A5FA" },
  { id: "ensemble",          label: "앙상블 합의",    color: "#94A0B6" },
];

// ── 헬퍼 ──────────────────────────────────────────────────────────
const fmtPct = (v, d = 2) => (v == null || !isFinite(v)) ? "—" : `${Number(v) >= 0 ? "+" : ""}${Number(v).toFixed(d)}%`;
const fmtNum = (v, d = 2) => (v == null || !isFinite(v)) ? "—" : Number(v).toFixed(d);

// ── primitives ────────────────────────────────────────────────────
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

function Pill({ active, children, onClick, color }) {
  const C = useThemeTokens();
  const { isMobile } = useBreakpoint();
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: isMobile ? "10px 16px" : "6px 12px",
        minHeight: isMobile ? 44 : undefined,
        borderRadius: RADIUS.full,
        border: `1px solid ${active ? (color || C.blue) : C.border}`,
        background: active ? (color || C.blue) : "transparent",
        color: active ? "#fff" : C.text2,
        fontSize: isMobile ? FONT.sm : FONT.xs,
        fontWeight: 700, cursor: "pointer",
        transition: "all 120ms",
        whiteSpace: "nowrap",
        scrollSnapAlign: "start",
        flexShrink: 0,
      }}
    >{children}</button>
  );
}

// 가로 스크롤 chip 컨테이너 (모바일 전용)
function ChipRow({ children }) {
  return (
    <div style={{
      display: "flex", gap: 8,
      overflowX: "auto", flexWrap: "nowrap",
      scrollSnapType: "x mandatory",
      WebkitOverflowScrolling: "touch",
      paddingBottom: 2,
      // scrollbar 숨김
      msOverflowStyle: "none",
      scrollbarWidth: "none",
    }}>
      {children}
    </div>
  );
}

// ── 라인 차트 (SVG) ────────────────────────────────────────────────
function CompareChart({ series, baselineCurve, height = 280 }) {
  const C = useThemeTokens();
  const width = 800;
  const padL = 48, padR = 12, padT = 16, padB = 28;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;

  // 모든 series 와 baseline 의 범위 계산
  const all = [];
  series.forEach(s => { if (Array.isArray(s.equityCurve)) all.push(...s.equityCurve); });
  if (Array.isArray(baselineCurve)) all.push(...baselineCurve);
  if (all.length === 0) return null;

  const yMin = Math.min(...all);
  const yMax = Math.max(...all);
  const yRange = yMax - yMin || 1;
  const padY = yRange * 0.08;
  const yLo = yMin - padY;
  const yHi = yMax + padY;

  const yScale = (v) => padT + innerH - ((v - yLo) / (yHi - yLo)) * innerH;

  // x 축은 series 길이 다를 수 있으므로 series별 정규화
  function pathOf(curve) {
    if (!Array.isArray(curve) || curve.length === 0) return "";
    return curve.map((v, i) => {
      const x = padL + (i / Math.max(1, curve.length - 1)) * innerW;
      const y = yScale(v);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");
  }

  // y축 grid (5단계)
  const gridLines = [];
  for (let i = 0; i <= 4; i++) {
    const yVal = yLo + (yHi - yLo) * (i / 4);
    const y = yScale(yVal);
    const pct = ((yVal - 1) * 100).toFixed(1);
    gridLines.push({ y, label: `${pct >= 0 ? "+" : ""}${pct}%` });
  }

  return (
    <div style={{ width: "100%", overflowX: "auto" }}>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet" style={{ width: "100%", maxWidth: "100%", display: "block" }} role="img" aria-label="strategy 비교 차트">
        {/* y grid */}
        {gridLines.map((g, i) => (
          <g key={i}>
            <line x1={padL} x2={width - padR} y1={g.y} y2={g.y} stroke={C.border} strokeWidth="1" strokeDasharray="3 4" />
            <text x={padL - 6} y={g.y + 4} fill={C.text3} fontSize="11" textAnchor="end">{g.label}</text>
          </g>
        ))}
        {/* baseline (buy & hold) — 연한 점선 */}
        {Array.isArray(baselineCurve) && baselineCurve.length > 1 && (
          <path d={pathOf(baselineCurve)} stroke={C.text4 || C.text3} strokeWidth="1.5" fill="none" strokeDasharray="4 4" opacity="0.7" />
        )}
        {/* strategy 라인들 */}
        {series.map((s, i) => (
          <path
            key={s.strategy}
            d={pathOf(s.equityCurve)}
            stroke={s.color}
            strokeWidth="2"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
        {/* x축 baseline (1.0) */}
        <line x1={padL} x2={width - padR} y1={yScale(1.0)} y2={yScale(1.0)} stroke={C.text3} strokeWidth="1" opacity="0.5" />
      </svg>
    </div>
  );
}

// ── 메인 ──────────────────────────────────────────────────────────
export default function BacktestCompare({ onNavigate } = {}) {
  const C = useThemeTokens();
  const { isMobile } = useBreakpoint();

  const [symbol, setSymbol] = useState("BTC");
  const [period, setPeriod] = useState(60);
  const [selected, setSelected] = useState(["trend-follow", "breakout", "ensemble"]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [strategySheetOpen, setStrategySheetOpen] = useState(false);

  const toggleStrategy = useCallback((id) => {
    setSelected(prev => {
      if (prev.includes(id)) {
        if (prev.length <= 1) return prev; // 최소 1개
        return prev.filter(x => x !== id);
      }
      if (prev.length >= 6) return prev; // 최대 6개 (차트 가독성)
      return [...prev, id];
    });
  }, []);

  const run = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const params = new URLSearchParams({
        symbol,
        period: String(period),
        strategies: selected.join(","),
      });
      const r = await fetch(`/api/backtest-compare?${params.toString()}`);
      const json = await r.json();
      if (!json.ok) throw new Error(json.error || "백테스트 실패");
      setData(json);
    } catch (e) {
      setErr(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [symbol, period, selected]);

  // 자동 실행 (selected/period/symbol 변경 시)
  useEffect(() => {
    if (selected.length === 0) return;
    const t = setTimeout(run, 300); // debounce
    return () => clearTimeout(t);
  }, [run, selected.length]);

  const results = data?.results || [];
  const best = data?.best;
  const baseline = data?.baselineReturnPct;

  // strategy 결과를 selected 와 동일 색상 매핑 (서버 응답 color 사용)
  const seriesForChart = useMemo(() => {
    return results.map(r => {
      const def = STRATEGIES.find(s => s.id === r.strategy);
      return {
        strategy: r.strategy,
        color: r.color || def?.color || C.blue,
        equityCurve: r.equityCurve || [],
      };
    });
  }, [results, C.blue]);

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "16px", display: "flex", flexDirection: "column", gap: 12 }}>
      {/* 헤더 */}
      <div>
        <h1 style={{ fontSize: FONT["2xl"], fontWeight: 800, color: C.text1, margin: 0 }}>
          백테스트 비교
        </h1>
        <p style={{ fontSize: FONT.sm, color: C.text3, margin: "6px 0 0 0" }}>
          같은 자산·기간에 여러 전략을 한 번에 백테스트해서 결과를 비교해드려요.
        </p>
      </div>

      {/* 안내 배너 */}
      <Card style={{ background: C.blueBg, border: `1px solid ${C.blueL}40` }}>
        <div style={{ fontSize: FONT.xs, color: C.text2, lineHeight: 1.6 }}>
          <strong style={{ color: C.text1 }}>참고.</strong>{" "}
          코인은 4시간봉, 주식은 일봉 기준입니다. 손절 4% / 익절 8% / 최대 보유 24봉의 기본 룰을 모든 전략에 동일하게 적용합니다.
          수수료·슬리피지 0.1% 가정.
        </div>
      </Card>

      {/* 필터 — 자산 / 기간 / 전략 */}
      <Card>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* 자산 — 모바일은 가로 스크롤 */}
          <div>
            <div style={{ fontSize: FONT.xs, color: C.text3, fontWeight: 700, marginBottom: 6 }}>자산</div>
            {isMobile ? (
              <ChipRow>
                {ASSETS.map(a => (
                  <Pill key={a.id} active={symbol === a.id} onClick={() => setSymbol(a.id)} color={a.kind === "crypto" ? C.orange : C.blue}>
                    {a.label}
                  </Pill>
                ))}
              </ChipRow>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                {ASSETS.map(a => (
                  <Pill key={a.id} active={symbol === a.id} onClick={() => setSymbol(a.id)} color={a.kind === "crypto" ? C.orange : C.blue}>
                    {a.label}
                  </Pill>
                ))}
              </div>
            )}
          </div>

          {/* 기간 */}
          <div>
            <div style={{ fontSize: FONT.xs, color: C.text3, fontWeight: 700, marginBottom: 6 }}>기간</div>
            {isMobile ? (
              <ChipRow>
                {PERIODS.map(p => (
                  <Pill key={p.value} active={period === p.value} onClick={() => setPeriod(p.value)}>
                    {p.label}
                  </Pill>
                ))}
              </ChipRow>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                {PERIODS.map(p => (
                  <Pill key={p.value} active={period === p.value} onClick={() => setPeriod(p.value)}>
                    {p.label}
                  </Pill>
                ))}
              </div>
            )}
          </div>

          {/* 전략 — 모바일은 BottomSheet 트리거 + 선택 미리보기 */}
          <div>
            <div style={{ fontSize: FONT.xs, color: C.text3, fontWeight: 700, marginBottom: 6 }}>전략 ({selected.length})</div>
            {isMobile ? (
              <>
                <button
                  type="button"
                  onClick={() => setStrategySheetOpen(true)}
                  style={{
                    width: "100%",
                    padding: "14px 16px",
                    minHeight: 48,
                    background: C.card2,
                    border: `1px solid ${C.border}`,
                    borderRadius: RADIUS.md,
                    color: C.text1,
                    fontSize: FONT.sm, fontWeight: 700,
                    cursor: "pointer", textAlign: "left",
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    gap: 8,
                  }}
                >
                  <span style={{
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    flex: 1, minWidth: 0,
                  }}>
                    {selected.map(id => STRATEGIES.find(s => s.id === id)?.label || id).join(", ") || "선택하세요"}
                  </span>
                  <span style={{ color: C.text3, fontSize: FONT.xs }}>변경 ▸</span>
                </button>
              </>
            ) : (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {STRATEGIES.map(s => (
                  <Pill key={s.id} active={selected.includes(s.id)} onClick={() => toggleStrategy(s.id)} color={s.color}>
                    {s.label}
                  </Pill>
                ))}
              </div>
            )}
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button
              onClick={run}
              disabled={loading || selected.length === 0}
              style={{
                padding: isMobile ? "14px 18px" : "8px 16px",
                minHeight: 48,
                width: isMobile ? "100%" : undefined,
                borderRadius: RADIUS.md,
                background: C.blue, color: "#fff", border: "none",
                fontSize: pickFont("button", isMobile) ?? FONT.sm,
                fontWeight: 700, cursor: loading ? "wait" : "pointer",
                opacity: loading || selected.length === 0 ? 0.6 : 1,
              }}
            >{loading ? "분석 중…" : "다시 실행"}</button>
          </div>
        </div>
      </Card>

      {/* 전략 선택 BottomSheet — 모바일 */}
      <BottomSheet
        open={strategySheetOpen}
        onClose={() => setStrategySheetOpen(false)}
        title="전략 선택"
        description="최소 1개, 최대 6개까지 선택할 수 있어요."
        footer={
          <button
            onClick={() => setStrategySheetOpen(false)}
            style={{
              width: "100%", padding: "14px 16px", minHeight: 48,
              borderRadius: RADIUS.md, background: C.blue,
              border: "none", color: "#fff",
              fontSize: 15, fontWeight: 700, cursor: "pointer",
            }}
          >확인 ({selected.length}개 선택)</button>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {STRATEGIES.map(s => {
            const active = selected.includes(s.id);
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => toggleStrategy(s.id)}
                style={{
                  display: "flex", alignItems: "center", gap: 12,
                  padding: "14px 16px", minHeight: 52,
                  border: `1px solid ${active ? s.color : C.border}`,
                  background: active ? `${s.color}22` : C.card2,
                  borderRadius: RADIUS.md,
                  cursor: "pointer", textAlign: "left",
                }}
              >
                <span style={{
                  width: 14, height: 14, borderRadius: "50%",
                  background: s.color, flexShrink: 0,
                }} />
                <span style={{
                  flex: 1, fontSize: 15, fontWeight: 700,
                  color: C.text1,
                }}>{s.label}</span>
                {active && (
                  <span style={{
                    width: 24, height: 24, borderRadius: "50%",
                    background: s.color, color: "#fff",
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    fontSize: 14, fontWeight: 800,
                  }}>✓</span>
                )}
              </button>
            );
          })}
        </div>
      </BottomSheet>

      {/* 차트 + 결과 */}
      {err && (
        <Card style={{ background: C.redBg, border: `1px solid ${C.red}40` }}>
          <div style={{ color: C.red, fontSize: FONT.sm }}>오류: {err}</div>
        </Card>
      )}

      {!err && loading && (
        <Card>
          <div style={{ padding: 32, textAlign: "center", color: C.text3, fontSize: FONT.sm }}>
            백테스트 실행 중… (5분 캐시 적용, 첫 호출만 시간이 걸려요)
          </div>
        </Card>
      )}

      {!err && !loading && data && results.length > 0 && (
        <>
          {/* 베스트 강조 */}
          {best && (() => {
            const bestRes = results.find(r => r.strategy === best.strategy);
            const def = STRATEGIES.find(s => s.id === best.strategy);
            return (
              <Card style={{ borderColor: bestRes?.color || def?.color || C.blue, borderWidth: 2 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontSize: FONT.xs, color: bestRes?.color || C.blue, fontWeight: 700, marginBottom: 4 }}>최고 성과 전략</div>
                    <div style={{ fontSize: FONT.lg, fontWeight: 800, color: C.text1 }}>
                      {bestRes?.label || best.strategy}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 24 }}>
                    <div>
                      <div style={{ fontSize: FONT.xs, color: C.text3 }}>수익률</div>
                      <div style={{ fontSize: FONT.xl, fontWeight: 700, color: best.netReturn >= 0 ? C.green : C.red }}>
                        {fmtPct(best.netReturn)}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: FONT.xs, color: C.text3 }}>안정성</div>
                      <div style={{ fontSize: FONT.xl, fontWeight: 700, color: C.text1 }}>
                        {fmtNum(best.sharpe)}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: FONT.xs, color: C.text3 }}>벤치 (보유)</div>
                      <div style={{ fontSize: FONT.xl, fontWeight: 700, color: baseline >= 0 ? C.green : C.red }}>
                        {fmtPct(baseline)}
                      </div>
                    </div>
                  </div>
                </div>
              </Card>
            );
          })()}

          {/* 차트 */}
          <Card>
            <div style={{ marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
              <h2 style={{ fontSize: FONT.lg, fontWeight: 700, color: C.text1, margin: 0 }}>
                누적 수익률 비교 — {symbol} / {period}일
              </h2>
              <div style={{ fontSize: FONT.xs, color: C.text3 }}>
                {data.bars}봉 · {data.timeframe}
              </div>
            </div>
            <CompareChart series={seriesForChart} baselineCurve={data.baselineCurve} />
            {/* 범례 */}
            <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 12 }}>
              {results.map(r => (
                <div key={r.strategy} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ display: "inline-block", width: 14, height: 3, background: r.color, borderRadius: 2 }} />
                  <span style={{ fontSize: FONT.xs, color: C.text2, fontWeight: 600 }}>{r.label}</span>
                </div>
              ))}
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ display: "inline-block", width: 14, height: 0, borderTop: `2px dashed ${C.text3}` }} />
                <span style={{ fontSize: FONT.xs, color: C.text3, fontWeight: 600 }}>그냥 보유 (벤치)</span>
              </div>
            </div>
          </Card>

          {/* 메트릭 — 모바일 카드 / 데스크탑 테이블 */}
          {isMobile ? (
            <Card style={{ padding: 12 }}>
              <h2 style={{ fontSize: FONT.lg, fontWeight: 700, color: C.text1, margin: "0 0 12px" }}>
                전략별 성과
              </h2>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {results
                  .slice()
                  .sort((a, b) => (b.metrics?.sharpe || 0) - (a.metrics?.sharpe || 0))
                  .map(r => {
                    const isBest = best && r.strategy === best.strategy;
                    const m = r.metrics || {};
                    return (
                      <div key={r.strategy} style={{
                        padding: 12,
                        background: isBest ? C.blueBg : C.card2,
                        border: `1px solid ${isBest ? r.color : C.border}`,
                        borderLeft: `4px solid ${r.color}`,
                        borderRadius: RADIUS.md,
                      }}>
                        <div style={{
                          display: "flex", alignItems: "center", gap: 8,
                          marginBottom: 10,
                        }}>
                          <span style={{
                            width: 12, height: 12, borderRadius: "50%",
                            background: r.color,
                          }} />
                          <span style={{ fontSize: 15, fontWeight: 700, color: C.text1, flex: 1 }}>
                            {r.label}
                          </span>
                          {isBest && (
                            <span style={{
                              fontSize: 11, color: "#fff", fontWeight: 800,
                              padding: "2px 8px", borderRadius: RADIUS.full,
                              background: r.color,
                            }}>BEST</span>
                          )}
                        </div>
                        <div style={{
                          display: "grid", gridTemplateColumns: "1fr 1fr",
                          gap: 8,
                        }}>
                          <Metric label="수익률" value={fmtPct(m.netReturn)}
                            color={(m.netReturn || 0) >= 0 ? C.green : C.red} C={C} />
                          <Metric label="안정성" value={fmtNum(m.sharpe)} C={C} />
                          <Metric label="PF" value={m.profitFactor != null ? fmtNum(m.profitFactor) : "—"} C={C} />
                          <Metric label="MDD" value={fmtPct(-Math.abs(m.maxDD || 0), 1)} color={C.red} C={C} />
                          <Metric label="거래수" value={(m.trades || 0).toLocaleString()} C={C} />
                          <Metric label="승률" value={`${fmtNum(m.winRate, 1)}%`} C={C} />
                        </div>
                      </div>
                    );
                  })}
              </div>
            </Card>
          ) : (
          <Card style={{ padding: 0 }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
                <thead>
                  <tr style={{ background: C.card2 }}>
                    <th style={thStyle(C)}>전략</th>
                    <th style={{ ...thStyle(C), textAlign: "right" }}>수익률</th>
                    <th style={{ ...thStyle(C), textAlign: "right" }}>안정성</th>
                    <th style={{ ...thStyle(C), textAlign: "right" }}>PF</th>
                    <th style={{ ...thStyle(C), textAlign: "right" }}>MDD</th>
                    <th style={{ ...thStyle(C), textAlign: "right" }}>거래수</th>
                    <th style={{ ...thStyle(C), textAlign: "right" }}>승률</th>
                    <th style={{ ...thStyle(C), textAlign: "right" }}>평균 보유</th>
                  </tr>
                </thead>
                <tbody>
                  {results
                    .slice()
                    .sort((a, b) => (b.metrics?.sharpe || 0) - (a.metrics?.sharpe || 0))
                    .map(r => {
                      const isBest = best && r.strategy === best.strategy;
                      const m = r.metrics || {};
                      return (
                        <tr key={r.strategy} style={{
                          background: isBest ? C.blueBg : "transparent",
                          borderLeft: isBest ? `3px solid ${r.color}` : "3px solid transparent",
                        }}>
                          <td style={tdStyle(C)}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: r.color }} />
                              <span style={{ fontSize: FONT.sm, fontWeight: 700, color: C.text1 }}>{r.label}</span>
                              {isBest && <span style={{ fontSize: FONT.xs, color: r.color, fontWeight: 800 }}>BEST</span>}
                            </div>
                          </td>
                          <td style={{ ...tdStyle(C), textAlign: "right", color: (m.netReturn || 0) >= 0 ? C.green : C.red, fontWeight: 700 }}>
                            {fmtPct(m.netReturn)}
                          </td>
                          <td style={{ ...tdStyle(C), textAlign: "right" }}>{fmtNum(m.sharpe)}</td>
                          <td style={{ ...tdStyle(C), textAlign: "right" }}>{m.profitFactor != null ? fmtNum(m.profitFactor) : "—"}</td>
                          <td style={{ ...tdStyle(C), textAlign: "right", color: C.red }}>{fmtPct(-Math.abs(m.maxDD || 0), 1)}</td>
                          <td style={{ ...tdStyle(C), textAlign: "right" }}>{(m.trades || 0).toLocaleString()}</td>
                          <td style={{ ...tdStyle(C), textAlign: "right" }}>{fmtNum(m.winRate, 1)}%</td>
                          <td style={{ ...tdStyle(C), textAlign: "right" }}>{fmtNum(m.avgHoldHours, 1)}h</td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </Card>
          )}
        </>
      )}

      {!err && !loading && data && results.length === 0 && (
        <Card>
          <div style={{ padding: 32, textAlign: "center", color: C.text3, fontSize: FONT.sm }}>
            결과가 없어요. 다른 전략 또는 기간을 선택해보세요.
          </div>
        </Card>
      )}

      {/* 푸터 */}
      <div style={{ fontSize: FONT.xs, color: C.text3, lineHeight: 1.6, padding: "8px 4px" }}>
        ※ <strong>안정성 (Sharpe)</strong> 은 1.0 이상이면 양호, 2.0 이상이면 매우 우수.{" "}
        <strong>PF (Profit Factor)</strong> 는 1.5 이상이면 안정적인 알파.{" "}
        <strong>MDD</strong> 는 고점 대비 최대 낙폭. 과거 성과가 미래를 보장하지 않습니다.
      </div>
    </div>
  );
}

// ── 모바일 카드용 메트릭 셀 ──────────────────────────────────────
function Metric({ label, value, color, C }) {
  return (
    <div style={{
      background: "rgba(0,0,0,0.06)",
      borderRadius: RADIUS.sm,
      padding: "8px 10px",
      display: "flex", flexDirection: "column", gap: 2,
    }}>
      <span style={{ fontSize: 11, color: C.text3, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase" }}>
        {label}
      </span>
      <span style={{
        fontSize: 16, fontWeight: 800,
        color: color || C.text1,
        fontFamily: "var(--z-font-mono)",
        fontVariantNumeric: "tabular-nums",
      }}>{value}</span>
    </div>
  );
}

// ── table 스타일 헬퍼 ──────────────────────────────────────────────
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
    padding: "12px",
    fontSize: FONT.sm, color: C.text1,
    borderBottom: `1px solid ${C.border}40`,
    whiteSpace: "nowrap",
  };
}
