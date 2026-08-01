// ════════════════════════════════════════════════════════════════════
// 지표 허브 (/indicators) — 2026-07 정보 피벗 Phase 2
//
// 핵심 시장 지표를 IndicatorCard 규격(제목·큰 숫자·상태 배지·한줄 해석)으로
// 한 화면에 요약합니다. 카드 클릭 시 L2(detail 2~3줄 + updatedAt) 인라인 확장.
//
// 데이터: GET /api/indicators/summary
//   계약: { ok, indicators: [{ id, title, value, unit, label, tone, market, desc, detail, updatedAt }] }
// 상태: 로딩 스켈레톤 / 실패 시 재시도 버튼 (빈 화면 금지) / 섹션 상한 MAX_VISIBLE
//
// ★ 2026-08-02 (주식+코인 양축 확장, 대표 지시): 상단에 [전체 | 코인 | 주식]
//   세그먼트 토글을 추가하고, API 의 market 필드로 필터합니다.
//   기존 디자인(C 테마 토큰 · uiKit)은 그대로 두고 정보 구조만 확장했습니다.
//
// 전부 uiKit(디자인 시스템 v1) 컴포넌트로 구성 — 다크/라이트 자동.
// ════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useThemeTokens, RADIUS } from "../ui/theme.jsx";
import { Card, SectionHeader, IndicatorCard } from "../components/uiKit.jsx";

// 섹션 상한 — 지표가 더 와도 상위 N개만 노출
// (주식 축 지표 편입으로 8 → 12. 전체 탭에서 뒤쪽 지표가 통째로 잘리지 않도록)
const MAX_VISIBLE = 12;

// 시장 세그먼트 — API 의 market 필드("crypto" | "stock" | "macro")로 필터
const MARKET_TABS = [
  { id: "all", label: "전체" },
  { id: "crypto", label: "코인" },
  { id: "stock", label: "주식" },
];

/**
 * 지표 → 선택 시장 매칭.
 * - macro(환율·공포탐욕처럼 두 시장에 함께 걸리는 거시 지표)는 코인·주식 양쪽에 노출합니다.
 * - market 필드가 없는 지표(구 스키마 캐시 응답)는 숨기지 않고 항상 노출합니다 — 빈 화면 방지.
 */
function matchesMarket(ind, selected) {
  if (selected === "all") return true;
  const m = ind?.market;
  if (!m) return true;
  return m === selected || m === "macro";
}

// updatedAt(ISO) → "MM.DD HH:MM 기준" (파싱 실패 시 숨김)
function fmtUpdated(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())} 기준`;
}

export default function IndicatorHub({ onNavigate }) {
  const C = useThemeTokens();
  // status: "loading" | "ready" | "error"
  const [state, setState] = useState({ status: "loading", indicators: [] });
  const [market, setMarket] = useState("all");
  const aliveRef = useRef(true);

  // 진입 버튼 공통 이동 — "/coin" 같은 정적 경로는 페이지 이동, 그 외는 탭 전환
  const go = useCallback((target, screenerMarket) => {
    if (typeof target === "string" && target.startsWith("/")) {
      window.location.href = target;
      return;
    }
    // 스크리너로 보낼 때 시장 필터를 함께 지정 (App.jsx 가 이 이벤트를 받아 filterMarket 설정)
    if (screenerMarket) {
      try { window.dispatchEvent(new CustomEvent("zepta:screener-market", { detail: screenerMarket })); } catch { /* 무시 */ }
    }
    if (onNavigate) onNavigate(target);
  }, [onNavigate]);

  const fetchSummary = useCallback(async () => {
    setState({ status: "loading", indicators: [] });
    try {
      const r = await fetch("/api/indicators/summary");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      if (!j || j.ok !== true || !Array.isArray(j.indicators)) throw new Error("bad payload");
      if (aliveRef.current) setState({ status: "ready", indicators: j.indicators });
    } catch {
      if (aliveRef.current) setState({ status: "error", indicators: [] });
    }
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    fetchSummary();
    return () => { aliveRef.current = false; };
  }, [fetchSummary]);

  // 세그먼트별 개수 (탭 라벨 옆 배지) + 현재 선택 시장의 지표
  const counts = useMemo(() => {
    const c = {};
    for (const t of MARKET_TABS) c[t.id] = state.indicators.filter((i) => matchesMarket(i, t.id)).length;
    return c;
  }, [state.indicators]);

  const inMarket = useMemo(
    () => state.indicators.filter((i) => matchesMarket(i, market)),
    [state.indicators, market],
  );
  const visible = inMarket.slice(0, MAX_VISIBLE);
  const hasMore = inMarket.length > MAX_VISIBLE;

  // 그리드: 모바일 1열 / 데스크톱 2~3열 (auto-fill 로 자동 반응형)
  const gridStyle = {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(270px, 1fr))",
    gap: "12px",
  };

  const shortcutBtnStyle = {
    display: "inline-flex", alignItems: "center", gap: "6px",
    padding: "9px 16px", borderRadius: RADIUS.lg,
    fontSize: "14px", fontWeight: 700, cursor: "pointer",
    background: C.card2, color: C.text2,
    border: `1px solid ${C.border}${C.isDark ? "30" : "60"}`,
    WebkitTapHighlightColor: "transparent",
  };

  return (
    <div className="tab-content" style={{
      maxWidth: "1000px", margin: "0 auto",
      display: "flex", flexDirection: "column", gap: "16px",
    }}>
      <style>{`@keyframes zihPulse { 0%,100%{opacity:1} 50%{opacity:.45} }`}</style>

      {/* ── 페이지 헤더 + 시장 세그먼트 + 관련 페이지 연결 행 ── */}
      <Card>
        <SectionHeader
          title="📊 지표 허브"
          sub="주식·코인 시장의 온도와 심리를 한 화면에서 — 카드를 누르면 자세한 설명이 열립니다"
        />

        {/* 시장 세그먼트 [전체 | 코인 | 주식] */}
        <div
          role="tablist"
          aria-label="시장 선택"
          style={{
            display: "inline-flex", gap: "4px", padding: "4px",
            background: C.card2, borderRadius: RADIUS.lg,
            border: `1px solid ${C.border}${C.isDark ? "22" : "45"}`,
            marginBottom: "12px", maxWidth: "100%", flexWrap: "wrap",
          }}
        >
          {MARKET_TABS.map((tab) => {
            const active = market === tab.id;
            return (
              <button
                key={tab.id}
                role="tab"
                aria-selected={active}
                onClick={() => setMarket(tab.id)}
                style={{
                  display: "inline-flex", alignItems: "center", gap: "5px",
                  padding: "7px 16px", borderRadius: RADIUS.md,
                  fontSize: "14px", fontWeight: 700, cursor: "pointer",
                  border: `1px solid ${active ? `${C.blue}35` : "transparent"}`,
                  background: active ? C.card : "transparent",
                  color: active ? C.blue : C.text3,
                  WebkitTapHighlightColor: "transparent",
                }}
              >
                {tab.label}
                {state.status === "ready" && (
                  <span style={{ fontSize: "12px", fontWeight: 700, color: active ? C.blue : C.text3, opacity: 0.75 }}>
                    {counts[tab.id] ?? 0}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {market !== "all" && (
          <div style={{ fontSize: "12px", color: C.text3, marginBottom: "12px", lineHeight: 1.5 }}>
            환율·공포탐욕처럼 두 시장에 함께 걸리는 거시 지표는 코인·주식 양쪽에 표시됩니다.
          </div>
        )}

        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <button onClick={() => go("screener")} style={shortcutBtnStyle}>
            🔍 스크리너
          </button>
          <button onClick={() => go("screener", "stock")} style={shortcutBtnStyle}>
            📈 주식 분석
          </button>
          <button onClick={() => go("/coin")} style={shortcutBtnStyle}>
            🪙 코인 분석
          </button>
          <button onClick={() => go("econ-calendar")} style={shortcutBtnStyle}>
            📅 경제 캘린더
          </button>
          <button onClick={() => go("sentiment")} style={shortcutBtnStyle}>
            💬 시장 심리
          </button>
        </div>
      </Card>

      {/* ── 로딩 스켈레톤 ── */}
      {state.status === "loading" && (
        <div style={gridStyle}>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={`zih-skel-${i}`} style={{
              background: C.card,
              border: `1px solid ${C.border}${C.isDark ? "18" : "40"}`,
              borderRadius: RADIUS.xl, padding: "16px 18px",
              animation: "zihPulse 1.4s ease-in-out infinite",
            }}>
              <div style={{ width: "42%", height: "12px", borderRadius: "6px", background: C.card2 }} />
              <div style={{ width: "55%", height: "30px", borderRadius: "8px", background: C.card2, marginTop: "12px" }} />
              <div style={{ width: "82%", height: "12px", borderRadius: "6px", background: C.card2, marginTop: "12px" }} />
            </div>
          ))}
        </div>
      )}

      {/* ── 실패 — 빈 화면 금지: 안내 + 재시도 ── */}
      {state.status === "error" && (
        <Card style={{ textAlign: "center", padding: "44px 20px" }}>
          <div style={{ fontSize: "28px", lineHeight: 1 }}>⚠️</div>
          <div style={{ marginTop: "10px", fontSize: "15px", fontWeight: 700, color: C.text1 }}>
            지표를 불러오지 못했습니다
          </div>
          <div style={{ marginTop: "4px", fontSize: "13px", color: C.text3 }}>
            네트워크 상태를 확인한 뒤 다시 시도해 주세요.
          </div>
          <button onClick={fetchSummary} style={{
            marginTop: "16px", padding: "9px 22px", borderRadius: RADIUS.lg,
            border: "none", background: C.blue, color: "#fff",
            fontSize: "14px", fontWeight: 700, cursor: "pointer",
          }}>
            다시 시도
          </button>
        </Card>
      )}

      {/* ── 지표 그리드 (상한 8) ── */}
      {state.status === "ready" && (
        visible.length === 0 ? (
          <Card style={{ textAlign: "center", padding: "44px 20px" }}>
            <div style={{ fontSize: "15px", fontWeight: 700, color: C.text1 }}>
              {state.indicators.length > 0 ? "이 시장의 지표가 아직 없습니다" : "표시할 지표가 아직 없습니다"}
            </div>
            <div style={{ marginTop: "4px", fontSize: "13px", color: C.text3 }}>
              {state.indicators.length > 0
                ? "데이터 소스가 일시적으로 응답하지 않을 수 있습니다. 전체 보기로 다른 지표를 확인해 보세요."
                : "지표 데이터가 준비되는 대로 이곳에 표시됩니다."}
            </div>
            {state.indicators.length > 0 && market !== "all" && (
              <button onClick={() => setMarket("all")} style={{
                marginTop: "16px", padding: "9px 22px", borderRadius: RADIUS.lg,
                border: "none", background: C.blue, color: "#fff",
                fontSize: "14px", fontWeight: 700, cursor: "pointer",
              }}>
                전체 보기
              </button>
            )}
          </Card>
        ) : (
          <>
            <div style={gridStyle}>
              {visible.map((ind, i) => (
                <IndicatorCard
                  key={ind.id || `${ind.title}-${i}`}
                  title={ind.title}
                  value={ind.value}
                  unit={ind.unit}
                  label={ind.label}
                  tone={ind.tone}
                  desc={ind.desc}
                  detail={ind.detail}
                  updatedAt={fmtUpdated(ind.updatedAt)}
                />
              ))}
            </div>
            {hasMore && (
              <div style={{ textAlign: "center", fontSize: "13px", color: C.text3, padding: "2px 0 6px" }}>
                더 많은 지표 준비 중
              </div>
            )}
          </>
        )
      )}
    </div>
  );
}
