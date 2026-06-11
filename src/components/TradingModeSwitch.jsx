// ════════════════════════════════════════════════════════════════════
// TradingModeSwitch — 트레이딩 일원화 모드 스위치 (모의 ↔ 실전)
// ★ 2026-06-08 (대표 지시): 자동매매(모의)와 실전매매를 하나의 '트레이딩' 경험으로.
//   법적 분리는 유지 — 실전은 현재 운영 계정 전용(비owner 는 안내 화면으로 연결).
//   추후 법률 검토 통과 시 isOwner 게이트만 풀면 전면 개방되는 구조.
// ════════════════════════════════════════════════════════════════════
import { THEME_TOKENS } from "../ui/theme.jsx";

export default function TradingModeSwitch({ mode = "paper", onNavigate, isOwner = false, theme = "dark", compact = false }) {
  const C = THEME_TOKENS[theme === "dark" ? "dark" : "light"];
  const tabs = [
    { id: "paper", label: "모의투자", tab: "auto-trading", desc: "가상 자본으로 전략 검증 — 전 사용자" },
    { id: "live", label: "실전투자", tab: "real-trading", desc: "바이낸스 선물 실계좌 — 베타(운영 계정)" },
  ];
  return (
    <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
      <div style={{ display: "inline-flex", background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 4, gap: 2 }}>
        {tabs.map((t) => {
          const active = t.id === mode;
          const locked = t.id === "live" && !isOwner;
          return (
            <button
              key={t.id}
              onClick={() => { if (!active && onNavigate) onNavigate(t.tab); }}
              title={t.desc}
              style={{
                padding: compact ? "7px 14px" : "8px 18px",
                borderRadius: 9, border: "none", cursor: "pointer",
                fontSize: compact ? 13 : 14, fontWeight: 700, lineHeight: 1.2,
                background: active ? C.blue : "transparent",
                color: active ? "#fff" : locked ? C.text4 : C.text2,
                transition: "background .15s, color .15s",
                WebkitTapHighlightColor: "transparent",
              }}
            >
              {t.label}{locked ? " 🔒" : ""}
            </button>
          );
        })}
      </div>
      {!compact && (
        <span style={{ fontSize: 12, color: C.text3 }}>
          {mode === "paper" ? "가상 자본 모드 — 실제 돈이 들어가지 않습니다" : "실계좌 운영 모드 — 실제 자금이 거래됩니다"}
        </span>
      )}
    </div>
  );
}
