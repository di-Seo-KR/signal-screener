// ════════════════════════════════════════════════════════════════════
// SectionTabs — 흩어진 화면들을 하나의 허브로 묶는 공용 세그먼트 내비
// ★ 2026-06-08 (대표 지시 — 전면 개편): 포트폴리오 3탭(내 자산·자산 분석·퀀트 포트)
//   통합에 첫 사용. TradingModeSwitch 와 같은 검증된 패턴 — 라우트·데이터 흐름은
//   그대로 두고 상단 세그먼트로 한 화면 경험을 만든다.
// ════════════════════════════════════════════════════════════════════
import { THEME_TOKENS } from "../ui/theme.jsx";

export default function SectionTabs({ items, active, onNavigate, theme = "dark", title }) {
  const C = THEME_TOKENS[theme === "dark" ? "dark" : "light"];
  return (
    <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 16 }}>
      {title && <span style={{ fontSize: 18, fontWeight: 800, color: C.text1, marginRight: 4 }}>{title}</span>}
      <div style={{ display: "inline-flex", background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 4, gap: 2, flexWrap: "wrap" }}>
        {items.map((t) => {
          const isActive = t.tab === active;
          return (
            <button
              key={t.tab}
              onClick={() => { if (!isActive && onNavigate) onNavigate(t.tab); }}
              style={{
                padding: "8px 16px", borderRadius: 9, border: "none", cursor: "pointer",
                fontSize: 14, fontWeight: 700, lineHeight: 1.2, whiteSpace: "nowrap",
                background: isActive ? C.blue : "transparent",
                color: isActive ? "#fff" : C.text2,
                transition: "background .15s, color .15s",
                WebkitTapHighlightColor: "transparent",
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
