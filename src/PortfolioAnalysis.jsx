// ══════════════════════════════════════════════════════════════════
// Zepta — 포트폴리오 분석 페이지 (/portfolio-analysis)
// ──────────────────────────────────────────────────────────────────
// PLAN-SVC #3 (2026-05-11)
//
// 표시 항목:
//   1) 자산 배분 도넛 — 종목별 + 카테고리별
//   2) 상관관계 히트맵 (30일 일일 수익률)
//   3) 분산 점수 (0~100) — HHI 기반 + 상관관계 페널티
//   4) 리밸런싱 추천 텍스트
//   5) 변동성 메트릭 (ATR/MDD/Sharpe)
//   6) 섹터 노출
//
// 데이터: POST /api/portfolio-analysis { holdings | userId }
// ══════════════════════════════════════════════════════════════════
import React, { useEffect, useMemo, useState, useCallback } from "react";
import { useThemeTokens, RADIUS } from "./ui/theme.jsx";
import { useAuth } from "./AuthProvider.jsx";
import { useIsMobile } from "./ui/useBreakpoint.jsx";
import { MetricInfo } from "./ui/primitives.jsx";

// ────────────────────────────────────────────────
// 기본 holdings — 빈 상태 분기 시 비교에 사용
// ────────────────────────────────────────────────
const DEFAULT_HOLDINGS = [
  { symbol: "BTC", quantity: 0.1, type: "crypto" },
  { symbol: "ETH", quantity: 2, type: "crypto" },
  { symbol: "AAPL", quantity: 10, type: "stock" },
];

function isDefaultHoldings(holdings) {
  if (!Array.isArray(holdings) || holdings.length !== DEFAULT_HOLDINGS.length) return false;
  return DEFAULT_HOLDINGS.every((d, i) => {
    const h = holdings[i];
    return h && h.symbol === d.symbol && h.quantity === d.quantity && h.type === d.type;
  });
}

// ────────────────────────────────────────────────
// 색상 팔레트 — 도넛/히트맵 공통
// ────────────────────────────────────────────────
const PALETTE = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899", "#84cc16", "#f97316", "#14b8a6"];

// ────────────────────────────────────────────────
// 도넛 차트 — SVG 기반, 외부 라이브러리 의존 X
// ────────────────────────────────────────────────
function DonutChart({ segments, total, size = 200, label = "총 자산", C }) {
  // 모바일에선 자동으로 더 작게 — caller 가 명시한 size 가 200 이상이면 150 으로 줄임
  // (호출처에서 isMobile flag 로 직접 size prop 넘기는 편이 더 명확)
  const radius = size / 2 - 12;
  const cx = size / 2, cy = size / 2;
  const inner = radius * 0.6;
  let acc = 0;
  const paths = segments.map((s, i) => {
    const startAngle = (acc / total) * 2 * Math.PI - Math.PI / 2;
    const endAngle = ((acc + s.value) / total) * 2 * Math.PI - Math.PI / 2;
    acc += s.value;
    const x1 = cx + radius * Math.cos(startAngle);
    const y1 = cy + radius * Math.sin(startAngle);
    const x2 = cx + radius * Math.cos(endAngle);
    const y2 = cy + radius * Math.sin(endAngle);
    const xi1 = cx + inner * Math.cos(startAngle);
    const yi1 = cy + inner * Math.sin(startAngle);
    const xi2 = cx + inner * Math.cos(endAngle);
    const yi2 = cy + inner * Math.sin(endAngle);
    const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
    const d = [
      `M ${x1} ${y1}`,
      `A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2}`,
      `L ${xi2} ${yi2}`,
      `A ${inner} ${inner} 0 ${largeArc} 0 ${xi1} ${yi1}`,
      "Z",
    ].join(" ");
    return <path key={i} d={d} fill={s.color} />;
  });
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {paths}
      <text x={cx} y={cy - 4} textAnchor="middle" fontSize="12" fill={C.text3}>{label}</text>
      <text x={cx} y={cy + 14} textAnchor="middle" fontSize="16" fontWeight="700" fill={C.text1}>
        ${(total || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
      </text>
    </svg>
  );
}

// ────────────────────────────────────────────────
// 상관관계 히트맵 셀 색상
//   +1.0 진초록 / 0 회색 / -1.0 진빨강
// ────────────────────────────────────────────────
function corrColor(r) {
  const abs = Math.min(1, Math.abs(r));
  if (r >= 0) {
    const g = Math.round(180 - abs * 60);
    return `rgba(16, ${g}, 129, ${0.25 + abs * 0.65})`;
  }
  return `rgba(239, 68, ${Math.round(68 + abs * 30)}, ${0.25 + abs * 0.65})`;
}

// ────────────────────────────────────────────────
// 분산 점수 게이지
// ────────────────────────────────────────────────
function DiversityGauge({ score, label, C }) {
  const color = score >= 70 ? C.green : score >= 40 ? C.yellow : C.red;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "8px" }}>
      <div style={{ position: "relative", width: "140px", height: "70px" }}>
        <svg width="140" height="80" viewBox="0 0 140 80">
          <path d="M 12 70 A 58 58 0 0 1 128 70" stroke={`${C.text3}30`} strokeWidth="10" fill="none" strokeLinecap="round" />
          <path
            d={`M 12 70 A 58 58 0 0 1 ${12 + (Math.sin((score / 100) * Math.PI) * 58 + (1 - Math.cos((score / 100) * Math.PI)) * 58)} ${70 - Math.sin((score / 100) * Math.PI) * 58}`}
            stroke={color}
            strokeWidth="10"
            fill="none"
            strokeLinecap="round"
          />
          <text x="70" y="62" textAnchor="middle" fontSize="22" fontWeight="800" fill={C.text1}>{score}</text>
        </svg>
      </div>
      <div style={{ fontSize: "13px", fontWeight: 700, color }}>{label}</div>
      <div style={{ fontSize: "11px", color: C.text3 }}>0=집중 위험 · 100=완전 분산</div>
    </div>
  );
}

// ────────────────────────────────────────────────
// 메인 컴포넌트
// ────────────────────────────────────────────────
export default function PortfolioAnalysis() {
  const C = useThemeTokens();
  const isMobile = useIsMobile();
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [manualHoldings, setManualHoldings] = useState(DEFAULT_HOLDINGS);
  const [editMode, setEditMode] = useState(false);
  // 사용자가 한 번이라도 holdings 를 수정했는지 추적 (가이드 카드 숨김 조건)
  const [userTouched, setUserTouched] = useState(false);
  const [newSymbol, setNewSymbol] = useState("");
  const [newQty, setNewQty] = useState("");
  const [newType, setNewType] = useState("crypto");

  // ── 분석 요청 ──
  const runAnalysis = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/portfolio-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user?.id || null,
          holdings: manualHoldings,
        }),
      });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || "분석 실패");
      setData(j);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [manualHoldings, user]);

  useEffect(() => { runAnalysis(); /* 초기 자동 실행 */ }, []); // eslint-disable-line

  const addHolding = () => {
    const sym = newSymbol.trim().toUpperCase();
    const qty = parseFloat(newQty);
    if (!sym || !qty || qty <= 0) return;
    setManualHoldings(prev => [...prev, { symbol: sym, quantity: qty, type: newType }]);
    setUserTouched(true);
    setNewSymbol("");
    setNewQty("");
  };
  const removeHolding = (idx) => {
    setManualHoldings(prev => prev.filter((_, i) => i !== idx));
    setUserTouched(true);
  };

  // 가이드 카드 표시 조건: 한 번도 편집 안 했고, holdings 가 default 와 동일
  const showStarterGuide = !userTouched && isDefaultHoldings(manualHoldings);

  // ── 도넛 segments ──
  const symbolSegments = useMemo(() => {
    if (!data?.allocation) return [];
    return data.allocation.map((a, i) => ({
      label: a.symbol,
      value: a.value,
      color: PALETTE[i % PALETTE.length],
      weight: a.weight,
    }));
  }, [data]);
  const categorySegments = useMemo(() => {
    if (!data?.categories) return [];
    return data.categories.map((c, i) => ({
      label: c.name,
      value: c.weight * (data.totalValue || 1),
      color: PALETTE[i % PALETTE.length],
      weight: c.weight,
    }));
  }, [data]);

  const card = {
    background: C.card,
    border: `1px solid ${C.border}`,
    borderRadius: RADIUS.md,
    padding: isMobile ? "16px" : "20px",
  };

  return (
    <div style={{
      backgroundColor: C.bg,
      color: C.text1,
      minHeight: "100vh",
      padding: isMobile ? "12px 10px" : "20px",
    }}>
      <div style={{ maxWidth: "1100px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "20px" }}>
        {/* 헤더 */}
        <div>
          <h1 style={{ margin: 0, fontSize: isMobile ? "22px" : "28px", color: C.text1, fontWeight: 700 }}>
            📊 포트폴리오 분석
          </h1>
          <p style={{ margin: "6px 0 0", color: C.text2, fontSize: isMobile ? "14px" : "15px" }}>
            보유 자산의 배분·상관관계·분산도를 한 눈에 확인하고, 리밸런싱 힌트를 받아보세요.
          </p>
        </div>

        {/* 첫 사용 가이드 — 사용자가 holdings 를 한 번도 안 만진 경우 */}
        {showStarterGuide && (
          <div style={{
            background: `linear-gradient(135deg, ${C.blue}12 0%, ${C.card} 100%)`,
            border: `1px solid ${C.blue}40`,
            borderRadius: RADIUS.md,
            padding: isMobile ? "16px" : "20px",
          }}>
            <div style={{ fontSize: isMobile ? "15px" : "16px", fontWeight: 800, color: C.text1, marginBottom: "10px" }}>
              🎯 포트폴리오 진단 시작하기
            </div>
            <div style={{
              display: "grid",
              gridTemplateColumns: isMobile ? "1fr" : "repeat(3, 1fr)",
              gap: "10px",
              marginBottom: "10px",
            }}>
              {[
                { n: "①", title: "보유 자산 입력", desc: "아래 ‘편집’ 버튼으로 본인 자산 추가" },
                { n: "②", title: "분석 실행", desc: "‘내 자산 분석하기’ 누르면 약 2~3초 소요" },
                { n: "③", title: "결과 해석", desc: "배분·상관·분산점수 확인 후 리밸런싱" },
              ].map((step, i) => (
                <div key={i} style={{
                  padding: "10px 12px",
                  background: C.card2,
                  border: `1px solid ${C.border}`,
                  borderRadius: RADIUS.sm,
                  display: "flex", flexDirection: "column", gap: "4px",
                }}>
                  <div style={{ fontSize: "13px", fontWeight: 800, color: C.blue }}>{step.n} {step.title}</div>
                  <div style={{ fontSize: "12px", color: C.text2, lineHeight: 1.5 }}>{step.desc}</div>
                </div>
              ))}
            </div>
            <div style={{ fontSize: "12px", color: C.text3, lineHeight: 1.5 }}>
              💡 지금은 <strong style={{ color: C.text2 }}>예시 데이터 (BTC·ETH·AAPL)</strong> 가 입력되어 있어요.
              본인 자산으로 바꾸려면 아래 <strong style={{ color: C.text2 }}>‘편집’</strong> 버튼을 눌러주세요.
            </div>
          </div>
        )}

        {/* Primary CTA — 분석 실행 강조 카드 */}
        <button
          onClick={runAnalysis}
          disabled={loading}
          style={{
            width: "100%",
            padding: isMobile ? "16px 20px" : "14px 24px",
            minHeight: 56,
            borderRadius: RADIUS.md,
            fontSize: isMobile ? "16px" : "16px",
            fontWeight: 800,
            background: loading ? C.card2 : C.blue,
            color: "#fff",
            border: "none",
            cursor: loading ? "default" : "pointer",
            opacity: loading ? 0.6 : 1,
            boxShadow: loading ? "none" : `0 4px 12px ${C.blue}40`,
            display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
            letterSpacing: "-0.01em",
          }}
        >
          {loading ? "분석 중…" : (
            <>
              <span>🚀</span>
              <span>내 자산 분석하기</span>
            </>
          )}
        </button>

        {/* 입력 영역 — 토글 */}
        <div style={card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
            <h2 style={{ margin: 0, fontSize: "16px", color: C.text1, fontWeight: 700 }}>분석 대상 종목</h2>
            <button
              onClick={() => setEditMode(!editMode)}
              style={{
                padding: "6px 14px", borderRadius: "999px", fontSize: "13px", fontWeight: 600,
                background: editMode ? C.blue : `${C.blue}15`,
                color: editMode ? "#fff" : C.blue,
                border: `1px solid ${C.blue}40`, cursor: "pointer",
              }}
            >{editMode ? "완료" : "편집"}</button>
          </div>

          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: editMode ? "12px" : 0 }}>
            {manualHoldings.map((h, i) => (
              <div key={i} style={{
                display: "flex", alignItems: "center", gap: "8px",
                padding: "6px 12px", borderRadius: "999px",
                background: C.card2, border: `1px solid ${C.border}`,
                fontSize: "13px", color: C.text1,
              }}>
                <span style={{ fontWeight: 600 }}>{h.symbol}</span>
                <span style={{ color: C.text3 }}>{h.quantity}</span>
                <span style={{ fontSize: "10px", color: C.text3, textTransform: "uppercase" }}>{h.type === "crypto" ? "코인" : "주식"}</span>
                {editMode && (
                  <button onClick={() => removeHolding(i)} style={{
                    background: "none", border: "none", cursor: "pointer", color: C.red,
                    fontSize: "14px", padding: 0, marginLeft: "2px",
                  }}>✕</button>
                )}
              </div>
            ))}
          </div>

          {editMode && (
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center", marginBottom: "12px" }}>
              <input
                value={newSymbol}
                onChange={e => setNewSymbol(e.target.value.toUpperCase())}
                placeholder="심볼 (예: BTC)"
                style={{
                  flex: "1 1 120px", minWidth: "120px",
                  padding: isMobile ? "12px 14px" : "8px 12px",
                  minHeight: 44,
                  borderRadius: "8px",
                  border: `1px solid ${C.border}`, background: C.card2, color: C.text1,
                  fontSize: isMobile ? 16 : 14, // iOS zoom 방지
                }}
              />
              <input
                value={newQty}
                onChange={e => setNewQty(e.target.value)}
                placeholder="수량"
                type="number"
                inputMode="decimal"
                style={{
                  flex: "1 1 100px", minWidth: "100px",
                  padding: isMobile ? "12px 14px" : "8px 12px",
                  minHeight: 44,
                  borderRadius: "8px",
                  border: `1px solid ${C.border}`, background: C.card2, color: C.text1,
                  fontSize: isMobile ? 16 : 14,
                }}
              />
              <select
                value={newType}
                onChange={e => setNewType(e.target.value)}
                style={{
                  padding: isMobile ? "12px 14px" : "8px 12px",
                  minHeight: 44,
                  borderRadius: "8px",
                  border: `1px solid ${C.border}`, background: C.card2, color: C.text1,
                  fontSize: isMobile ? 16 : 14,
                }}
              >
                <option value="crypto">코인</option>
                <option value="stock">주식</option>
              </select>
              <button onClick={addHolding} style={{
                padding: isMobile ? "12px 18px" : "8px 16px",
                minHeight: 44,
                borderRadius: "8px",
                fontSize: isMobile ? 15 : 14, fontWeight: 600,
                background: C.green, color: "#fff", border: "none", cursor: "pointer",
              }}>추가</button>
            </div>
          )}

          <button onClick={runAnalysis} disabled={loading} style={{
            width: "100%",
            padding: isMobile ? "12px" : "10px",
            minHeight: 44,
            borderRadius: "8px",
            fontSize: isMobile ? 14 : 13, fontWeight: 600,
            background: loading ? C.card2 : `${C.blue}15`,
            color: loading ? C.text3 : C.blue,
            border: `1px solid ${C.blue}40`,
            cursor: loading ? "default" : "pointer", opacity: loading ? 0.6 : 1,
          }}>{loading ? "분석 중..." : "↻ 다시 분석"}</button>
        </div>

        {/* 에러 */}
        {error && (
          <div style={{ ...card, background: `${C.red}10`, border: `1px solid ${C.red}30`, color: C.red }}>
            ⚠️ {error}
          </div>
        )}

        {/* 빈 상태 */}
        {data?.empty && (
          <div style={{ ...card, textAlign: "center", color: C.text2 }}>
            {data.message}
          </div>
        )}

        {/* 결과 */}
        {data && !data.empty && (
          <>
            {/* 행 1: 종목 도넛 + 카테고리 도넛 */}
            <div style={{
              display: "grid",
              gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
              gap: "16px",
            }}>
              <div style={card}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                  <h3 style={{ margin: 0, fontSize: "15px", color: C.text1, fontWeight: 700 }}>종목별 배분</h3>
                  <MetricInfo
                    label=""
                    hint="한 종목에 30% 이상 몰리면 위험합니다. 종목당 비중을 분산할수록 충격 흡수력이 커져요."
                    side="bottom"
                  />
                </div>
                <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", alignItems: "center", gap: "16px" }}>
                  <DonutChart segments={symbolSegments} total={data.totalValue} size={isMobile ? 160 : 200} C={C} />
                  <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "8px", width: isMobile ? "100%" : "auto" }}>
                    {symbolSegments.slice(0, 8).map((s, i) => (
                      <div key={i} style={{
                        display: "flex", alignItems: "center", gap: "8px",
                        fontSize: "13px", minHeight: isMobile ? 32 : undefined,
                      }}>
                        <span style={{ width: "10px", height: "10px", borderRadius: "2px", background: s.color, flexShrink: 0 }} />
                        <span style={{ color: C.text1, flex: 1 }}>{s.label}</span>
                        <span style={{ color: C.text2, fontWeight: 600 }}>{(s.weight * 100).toFixed(1)}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div style={card}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                  <h3 style={{ margin: 0, fontSize: "15px", color: C.text1, fontWeight: 700 }}>카테고리 배분</h3>
                  <MetricInfo
                    label=""
                    hint="자산 종류 (코인·주식·채권 등) 별 분포. 한 종류에 80% 이상 몰리면 시장 충격에 취약해요."
                    side="bottom"
                  />
                </div>
                <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", alignItems: "center", gap: "16px" }}>
                  <DonutChart segments={categorySegments} total={data.totalValue} size={isMobile ? 160 : 200} label="카테고리" C={C} />
                  <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "8px", width: isMobile ? "100%" : "auto" }}>
                    {categorySegments.map((s, i) => (
                      <div key={i} style={{
                        display: "flex", alignItems: "center", gap: "8px",
                        fontSize: "13px", minHeight: isMobile ? 32 : undefined,
                      }}>
                        <span style={{ width: "10px", height: "10px", borderRadius: "2px", background: s.color, flexShrink: 0 }} />
                        <span style={{ color: C.text1, flex: 1 }}>{s.label}</span>
                        <span style={{ color: C.text2, fontWeight: 600 }}>{(s.weight * 100).toFixed(1)}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* 행 2: 분산 점수 + 변동성 메트릭 */}
            <div style={{
              display: "grid",
              gridTemplateColumns: isMobile ? "1fr" : "1fr 2fr",
              gap: "16px",
            }}>
              <div style={card}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                  <h3 style={{ margin: 0, fontSize: "15px", color: C.text1, fontWeight: 700 }}>분산 점수</h3>
                  <MetricInfo
                    label=""
                    hint="0=한 종목 몰빵 / 100=완전 분산. 70 이상이면 양호. HHI 집중도 + 상관관계 페널티로 계산해요."
                    side="bottom"
                  />
                </div>
                <DiversityGauge score={data.diversityScore} label={data.diversityLabel} C={C} />
              </div>

              <div style={card}>
                <h3 style={{ margin: "0 0 12px", fontSize: "15px", color: C.text1, fontWeight: 700 }}>변동성 메트릭 (30일)</h3>
                {/* 모바일: 2열 — 첫 행 ATR/MDD, 둘째 행 Sharpe (단일) */}
                <div style={{
                  display: "grid",
                  gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(3, 1fr)",
                  gap: "10px",
                }}>
                  <Metric label="일일 변동성 (ATR)" value={data.volatility?.atr14} unit="%" color={C.yellow} C={C} hint="평균 일일 변동폭. 낮을수록 변동성 작음." />
                  <Metric label="최대 낙폭 (MDD)" value={data.volatility?.mdd30} unit="%" color={C.red} C={C} hint="30일 중 가장 큰 손실 폭." />
                  <div style={{ gridColumn: isMobile ? "span 2" : undefined }}>
                    <Metric label="안정성 (Sharpe)" value={data.volatility?.sharpe30} unit="" color={data.volatility?.sharpe30 >= 1 ? C.green : C.text2} C={C} hint="수익이 얼마나 안정적인지. 1.0 이상이면 양호." />
                  </div>
                </div>
              </div>
            </div>

            {/* 행 3: 리밸런싱 추천 */}
            <div style={card}>
              <h3 style={{ margin: "0 0 12px", fontSize: "15px", color: C.text1, fontWeight: 700 }}>💡 리밸런싱 추천</h3>
              <ul style={{ margin: 0, paddingLeft: "18px", color: C.text2, fontSize: "14px", lineHeight: 1.7 }}>
                {(data.rebalanceTips || []).map((t, i) => (<li key={i}>{t}</li>))}
              </ul>
            </div>

            {/* 행 4: 상관관계 히트맵 */}
            {data.correlation?.matrix?.length > 1 && (
              <div style={card}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                  <h3 style={{ margin: 0, fontSize: "15px", color: C.text1, fontWeight: 700 }}>상관관계 히트맵 (30일 일일 수익률)</h3>
                  <MetricInfo
                    label=""
                    hint="초록=같이 움직임 / 빨강=반대로 움직임. 자산 간 상관이 다양할수록 한 시장 충격에 안정적이에요."
                    side="bottom"
                  />
                </div>
                <p style={{ margin: "0 0 12px", fontSize: "12px", color: C.text3 }}>
                  +1 = 함께 움직임 · 0 = 무관 · −1 = 반대 움직임. 평균 절대 상관: <strong style={{ color: C.text1 }}>{data.correlation.avgAbs}</strong>
                </p>
                {isMobile && (
                  <div style={{ fontSize: 11, color: C.text3, marginBottom: 6 }}>
                    ← 좌우로 스크롤해서 모두 볼 수 있어요
                  </div>
                )}
                <div style={{
                  overflowX: "auto", WebkitOverflowScrolling: "touch",
                  margin: isMobile ? "0 -16px" : 0, padding: isMobile ? "0 16px" : 0,
                }}>
                  <table style={{ borderCollapse: "collapse", fontSize: isMobile ? "10px" : "11px", margin: isMobile ? 0 : "0 auto" }}>
                    <thead>
                      <tr>
                        <th></th>
                        {data.correlation.symbols.map(s => (
                          <th key={s} style={{ padding: "4px 6px", color: C.text2, fontWeight: 600, transform: "rotate(-30deg)", whiteSpace: "nowrap" }}>{s}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.correlation.matrix.map((row, i) => (
                        <tr key={i}>
                          <td style={{ padding: "4px 8px", color: C.text2, fontWeight: 600, textAlign: "right" }}>{data.correlation.symbols[i]}</td>
                          {row.map((r, j) => (
                            <td key={j} style={{
                              padding: "0", textAlign: "center",
                              background: i === j ? `${C.blue}25` : corrColor(r),
                              color: C.text1, fontWeight: i === j ? 700 : 500,
                              minWidth: isMobile ? "32px" : "44px",
                              height: isMobile ? "28px" : "32px",
                              border: `1px solid ${C.border}40`,
                            }}>{i === j ? "—" : r.toFixed(2)}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* 행 5: 섹터 노출 (주식만) */}
            {data.sectorExposure?.length > 0 && (
              <div style={card}>
                <h3 style={{ margin: "0 0 12px", fontSize: "15px", color: C.text1, fontWeight: 700 }}>주식 섹터 노출</h3>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {data.sectorExposure.map((s, i) => (
                    <div key={i}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px", marginBottom: "3px" }}>
                        <span style={{ color: C.text1 }}>{s.name}</span>
                        <span style={{ color: C.text2, fontWeight: 600 }}>{(s.weight * 100).toFixed(1)}%</span>
                      </div>
                      <div style={{ height: "6px", borderRadius: "3px", background: `${C.text3}20`, overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${s.weight * 100}%`, background: PALETTE[i % PALETTE.length], borderRadius: "3px" }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* 법적 면책 */}
        <div style={{
          ...card,
          background: `${C.yellow}08`,
          border: `1px solid ${C.yellow}25`,
          fontSize: "12px",
          color: C.text2,
          lineHeight: 1.65,
        }}>
          ⚠️ <strong style={{ color: C.text1 }}>면책 고지</strong>: 본 분석은 <strong>참고용</strong>이며 투자 권유가 아닙니다.
          상관관계·분산 점수는 과거 30일 데이터에 기반한 통계적 추정이고, 미래 수익을 보장하지 않습니다.
          모든 매매 결정은 본인 책임이며, 손실에 대한 책임은 Zepta가 부담하지 않습니다.
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────
// 메트릭 카드 - 라벨 + 값 + 힌트
// ────────────────────────────────────────────────
function Metric({ label, value, unit, color, C, hint }) {
  return (
    <div style={{
      padding: "10px 12px",
      borderRadius: RADIUS.sm,
      background: C.card2,
      border: `1px solid ${C.border}40`,
      textAlign: "center",
    }}>
      <div style={{ fontSize: "11px", color: C.text3, marginBottom: "4px", lineHeight: 1.3 }}>{label}</div>
      <div style={{ fontSize: "20px", fontWeight: 800, color, letterSpacing: "-0.01em" }}>
        {value == null ? "—" : `${value}${unit}`}
      </div>
      {hint && <div style={{ fontSize: "10px", color: C.text3, marginTop: "4px", lineHeight: 1.35 }}>{hint}</div>}
    </div>
  );
}
