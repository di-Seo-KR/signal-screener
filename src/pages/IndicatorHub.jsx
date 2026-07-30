// ════════════════════════════════════════════════════════════════════
// 지표 허브 (/indicators) — 2026-07 정보 피벗 Phase 2
//
// 핵심 시장 지표를 IndicatorCard 규격(제목·큰 숫자·상태 배지·한줄 해석)으로
// 한 화면에 요약합니다. 카드 클릭 시 L2(detail 2~3줄 + updatedAt) 인라인 확장.
//
// 데이터: GET /api/indicators/summary (백엔드 팀 병렬 구현)
//   계약: { ok, indicators: [{ id, title, value, unit, label, tone, desc, detail, updatedAt }] }
// 상태: 로딩 스켈레톤 / 실패 시 재시도 버튼 (빈 화면 금지) / 섹션 상한 8
//
// 전부 uiKit(디자인 시스템 v1) 컴포넌트로 구성 — 다크/라이트 자동.
// ════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useRef, useState } from "react";
import { useThemeTokens, RADIUS } from "../ui/theme.jsx";
import { Card, SectionHeader, IndicatorCard } from "../components/uiKit.jsx";

// 섹션 상한 — 지표가 더 와도 상위 8개만 노출
const MAX_VISIBLE = 8;

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
  const aliveRef = useRef(true);

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

  const visible = state.indicators.slice(0, MAX_VISIBLE);
  const hasMore = state.indicators.length > MAX_VISIBLE;

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

      {/* ── 페이지 헤더 + 기존 페이지 연결 행 (경제 캘린더 · 시장 심리) ── */}
      <Card>
        <SectionHeader
          title="📊 지표 허브"
          sub="시장의 온도와 심리를 한 화면에서 — 카드를 누르면 자세한 설명이 열립니다"
        />
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <button onClick={() => onNavigate && onNavigate("econ-calendar")} style={shortcutBtnStyle}>
            📅 경제 캘린더
          </button>
          <button onClick={() => onNavigate && onNavigate("sentiment")} style={shortcutBtnStyle}>
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
            <div style={{ fontSize: "15px", fontWeight: 700, color: C.text1 }}>표시할 지표가 아직 없습니다</div>
            <div style={{ marginTop: "4px", fontSize: "13px", color: C.text3 }}>
              지표 데이터가 준비되는 대로 이곳에 표시됩니다.
            </div>
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
