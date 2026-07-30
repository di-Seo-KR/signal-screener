// ════════════════════════════════════════════════════════════════════
// Zepta 디자인 시스템 v1 — 공통 UI 킷 (2026-07 정보 피벗 Phase 2)
//
// 신규 화면(지표 허브 등)부터 적용하는 공통 컴포넌트 모음입니다.
// 기존 화면 재도색은 하지 않습니다 — 새 화면·새 블록에서만 사용하세요.
//
// 구성:
//   Card          — 표준 섹션 카드 (THEME_TOKENS 기반, 다크/라이트 자동)
//   SectionHeader — 섹션 제목 + "더보기" 액션 규격
//   StatBadge     — 상태 배지 (tone → 색: up/down/neutral/hot/cold)
//   TrendNumber   — 부호(＋/−)와 색을 동시에 표기하는 숫자 (tabular-nums)
//   IndicatorCard — 지표 카드 규격: 제목 · 큰 숫자(+단위) · 상태 배지 ·
//                   한줄 해석(desc), 클릭 시 L2(detail + updatedAt) 인라인 확장
//
// 색은 전부 기존 C 테마 토큰(useThemeTokens)을 재사용합니다.
// 알파 합성 패턴(`${color}1A` 등)을 쓰므로 토큰은 hex 문자열이어야 합니다.
// ════════════════════════════════════════════════════════════════════
import { useState } from "react";
import { useThemeTokens, RADIUS } from "../ui/theme.jsx";

/** tone → 테마 색 매핑 (SSOT)
 *  up=green(상승·긍정) / down=red(하락·부정) / neutral=text3(중립) /
 *  hot=orange(과열) / cold=blue(냉각) */
export function toneColor(C, tone) {
  switch (tone) {
    case "up": return C.green;
    case "down": return C.red;
    case "hot": return C.orange;
    case "cold": return C.blue;
    case "neutral":
    default: return C.text3;
  }
}

/* ── Card — 표준 섹션 카드 ─────────────────────────────────────────── */
export function Card({ children, onClick, padding = "20px", style, ...rest }) {
  const C = useThemeTokens();
  return (
    <div
      onClick={onClick}
      style={{
        background: C.card,
        border: `1px solid ${C.border}${C.isDark ? "18" : "40"}`,
        borderRadius: RADIUS.xl,
        padding,
        ...(onClick ? { cursor: "pointer" } : null),
        ...style,
      }}
      {...rest}
    >
      {children}
    </div>
  );
}

/* ── SectionHeader — 제목 + 더보기 규격 ────────────────────────────── */
export function SectionHeader({ title, sub, moreLabel = "더보기 →", onMore, style }) {
  const C = useThemeTokens();
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      gap: "10px", marginBottom: "10px", ...style,
    }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 800, fontSize: "16px", color: C.text1, letterSpacing: "-0.3px" }}>{title}</div>
        {sub && <div style={{ fontSize: "12px", color: C.text3, marginTop: "3px", lineHeight: 1.4 }}>{sub}</div>}
      </div>
      {onMore && (
        <button
          onClick={onMore}
          style={{
            fontSize: "13px", fontWeight: 700, color: C.blue,
            background: `${C.blue}10`, border: `1px solid ${C.blue}25`,
            borderRadius: RADIUS.md, padding: "4px 12px", cursor: "pointer",
            whiteSpace: "nowrap", flexShrink: 0,
          }}
        >
          {moreLabel}
        </button>
      )}
    </div>
  );
}

/* ── StatBadge — 상태 배지 (tone → 색) ─────────────────────────────── */
export function StatBadge({ tone = "neutral", children, style }) {
  const C = useThemeTokens();
  const color = toneColor(C, tone);
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: "4px",
      padding: "3px 8px", borderRadius: RADIUS.sm,
      fontSize: "12px", fontWeight: 700, lineHeight: 1.3,
      color, background: `${color}${C.isDark ? "1A" : "14"}`,
      border: `1px solid ${color}30`, whiteSpace: "nowrap", flexShrink: 0,
      ...style,
    }}>
      {children}
    </span>
  );
}

/* ── TrendNumber — ＋/− 부호 + 색 동시 표기 숫자 ───────────────────── */
export function TrendNumber({ value, unit = "%", digits = 2, fontSize = "14px", style }) {
  const C = useThemeTokens();
  const n = Number(value);
  const valid = Number.isFinite(n);
  const color = !valid ? C.text3 : n > 0 ? C.green : n < 0 ? C.red : C.text3;
  const sign = !valid ? "" : n > 0 ? "+" : n < 0 ? "−" : "";
  const body = valid
    ? Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: digits })
    : "—";
  return (
    <span className="z-num" style={{
      fontVariantNumeric: "tabular-nums", fontWeight: 800, fontSize, color, ...style,
    }}>
      {sign}{body}{valid && unit ? unit : ""}
    </span>
  );
}

/* ── IndicatorCard — 지표 카드 규격 ─────────────────────────────────
   L1: 제목 · 큰 숫자(+unit) · 상태 배지(label, tone 색) · 한줄 해석(desc)
   L2: 카드 클릭 시 인라인 확장 — detail(2~3줄) + updatedAt              */
export function IndicatorCard({
  title, value, unit, label, tone = "neutral", desc, detail, updatedAt, style,
}) {
  const C = useThemeTokens();
  const [open, setOpen] = useState(false);
  const color = toneColor(C, tone);
  const hasL2 = Boolean(detail || updatedAt);
  const shown = value == null || value === "" ? "—" : value;
  const toggle = () => setOpen((v) => !v);
  return (
    <div
      role={hasL2 ? "button" : undefined}
      tabIndex={hasL2 ? 0 : undefined}
      aria-expanded={hasL2 ? open : undefined}
      onClick={hasL2 ? toggle : undefined}
      onKeyDown={hasL2 ? (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); }
      } : undefined}
      style={{
        background: C.card,
        border: `1px solid ${color}${C.isDark ? "28" : "35"}`,
        borderRadius: RADIUS.xl,
        padding: "16px 18px",
        cursor: hasL2 ? "pointer" : "default",
        WebkitTapHighlightColor: "transparent",
        ...style,
      }}
    >
      {/* 제목 + 상태 배지 */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "8px" }}>
        <div style={{ fontSize: "13px", fontWeight: 700, color: C.text3, lineHeight: 1.4 }}>{title}</div>
        {label != null && label !== "" && <StatBadge tone={tone}>{label}</StatBadge>}
      </div>
      {/* 큰 숫자 + 단위 */}
      <div className="z-num" style={{
        marginTop: "8px", fontSize: "30px", fontWeight: 900, lineHeight: 1,
        color, fontVariantNumeric: "tabular-nums", letterSpacing: "-0.5px",
      }}>
        {shown}
        {unit && shown !== "—" && (
          <span style={{ fontSize: "16px", fontWeight: 700, marginLeft: "2px" }}>{unit}</span>
        )}
      </div>
      {/* 한줄 해석 */}
      {desc && (
        <div style={{ marginTop: "8px", fontSize: "13px", color: C.text2, lineHeight: 1.5 }}>{desc}</div>
      )}
      {/* L2 확장 — detail + updatedAt */}
      {hasL2 && open && (
        <div style={{ marginTop: "10px", paddingTop: "10px", borderTop: `1px solid ${C.border}${C.isDark ? "30" : "60"}` }}>
          {detail && (
            <div style={{ fontSize: "13px", color: C.text2, lineHeight: 1.6, whiteSpace: "pre-line" }}>{detail}</div>
          )}
          {updatedAt && (
            <div style={{ marginTop: detail ? "6px" : 0, fontSize: "12px", color: C.text3 }}>{updatedAt}</div>
          )}
        </div>
      )}
      {hasL2 && (
        <div style={{ marginTop: "8px", fontSize: "12px", fontWeight: 600, color: C.text3, userSelect: "none" }}>
          {open ? "접기 ▴" : "자세히 ▾"}
        </div>
      )}
    </div>
  );
}
