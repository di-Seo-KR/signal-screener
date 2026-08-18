// ════════════════════════════════════════════════════════════════════
// mobileKit — 모바일 디자인 시안(대표 제공 "Zepta Mobile App") 컴포넌트 세트
// ────────────────────────────────────────────────────────────────────
// 시안이 정의한 "정보 카드의 문법"을 재사용 가능한 단위로 옮긴 것입니다.
// 색은 전부 기존 테마 토큰(useThemeTokens)에서 가져오므로 다크/라이트가 함께 동작합니다.
//
// 시안에서 가져온 규칙(임의로 바꾸지 마세요 — 화면 간 일관성의 근거입니다):
//   · 수치는 항상 mono + tabular-nums (자릿수 흔들림 방지)
//   · 방향성 카드는 왼쪽 3px accent 보더 + 상단 accent 그라데이션(42% 지점에서 소멸)
//   · 카드 radius 16 / 내부 요소 12~14 / 칩 6~8 / 알약 9999
//   · 상태 배지는 accentBg(10~14% 알파) 위에 accentHi(밝은 짝) 텍스트
//   · 섹션 헤더의 라이브 도트는 2초 pulse — "지금 갱신되는 데이터"의 신호
// ════════════════════════════════════════════════════════════════════
import React from "react";
import { useThemeTokens } from "../ui/theme.jsx";
import { useLanguage } from "../i18n/LanguageContext.jsx";

/** 수치 전용 폰트 스택 — 시안의 JetBrains Mono. 표·리스트에서 자릿수를 고정합니다. */
export const MONO = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace";

/**
 * i18n 안전 조회 훅 — 공용 컴포넌트의 내장 문구를 ko/en.json(mobile.kit.*)에 연결합니다.
 * LanguageProvider 밖(프리뷰·테스트)이거나 키가 아직 없으면 한국어 기본값으로 동작하므로
 * 배선 순서와 무관하게 깨지지 않습니다. AssetDetailSheet 등 시안 계열 화면이 함께 씁니다.
 */
export function useKitText() {
  const ctx = useLanguage();
  const t = ctx?.t;
  return React.useCallback((key, fallback, params) => {
    // 미등록 키 폴백에도 동일한 {{param}} 치환을 적용합니다 (사전 등록 전후 표기 일치).
    const fill = (s) => (params && typeof s === "string"
      ? s.replace(/\{\{(\w+)\}\}/g, (_, k) => params[k] ?? "")
      : s);
    if (typeof t !== "function") return fill(fallback);
    const v = t(key, params);
    // t() 는 미등록 키를 키 문자열 그대로 돌려줍니다 — 그 경우 기본값으로 대체합니다.
    return v === key ? fill(fallback) : v;
  }, [t]);
}

/** 데스크탑(정밀 포인터) 여부 — 모듈 로드 시 1회 판정. 터치 기기에선 hover 핸들러를
 *  아예 붙이지 않아 탭 후 hover 잔상이 남지 않습니다(@media (hover: hover) 와 동일 판정). */
const HOVER_OK = typeof window !== "undefined"
  && typeof window.matchMedia === "function"
  && window.matchMedia("(hover: hover)").matches;

/** 클릭 가능한 카드 공용 hover 피드백 — 커서 모양만으로는 '눌리는 것'이 전달되지 않아
 *  배경/보더를 살짝 강조합니다. clickable 이 없거나 터치 환경이면 빈 객체를 돌려줍니다. */
function hoverProps(clickable, enter, leave) {
  if (!clickable || !HOVER_OK) return {};
  return {
    onMouseEnter: (e) => enter(e.currentTarget.style),
    onMouseLeave: (e) => leave(e.currentTarget.style),
  };
}

/** 방향(up/down/neutral) → 시안 색 3종 세트. side 는 "LONG"|"SHORT"|null 도 허용합니다. */
export function accentOf(C, dir) {
  const d = dir === "LONG" ? "up" : dir === "SHORT" ? "down" : dir;
  if (d === "up") return { base: C.green, hi: C.greenL || C.green, bg: `${C.green}1A` };
  if (d === "down") return { base: C.red, hi: C.redL || C.red, bg: `${C.red}1A` };
  return { base: C.text3, hi: C.text2, bg: `${C.text3}1F` };
}

/** 숫자 표기 — mono·tabular 고정. 색/크기만 바꿔 쓰세요. */
export function Num({ children, size = "14px", weight = 700, color, style }) {
  const C = useThemeTokens();
  return (
    <span style={{
      fontFamily: MONO, fontVariantNumeric: "tabular-nums",
      fontSize: size, fontWeight: weight, color: color || C.text1,
      letterSpacing: "-0.01em", ...style,
    }}>{children}</span>
  );
}

/** 등락률 — 부호와 색을 함께 표기(색약 대비: 색만으로 방향을 전달하지 않습니다). */
export function ChangeNum({ value, size = "12px", style }) {
  const C = useThemeTokens();
  const n = Number(value);
  if (!Number.isFinite(n)) return <Num size={size} color={C.text3} style={style}>—</Num>;
  const a = accentOf(C, n >= 0 ? "up" : "down");
  return <Num size={size} color={a.hi} style={style}>{n >= 0 ? "+" : ""}{n.toFixed(2)}%</Num>;
}

/** 상태 알약 — LONG/SHORT/중립 및 임의 라벨. */
export function SidePill({ dir, children, size = "11px", style }) {
  const C = useThemeTokens();
  const a = accentOf(C, dir);
  return (
    <span style={{
      fontSize: size, fontWeight: 800, padding: "2px 9px", borderRadius: "9999px",
      background: a.bg, color: a.hi, whiteSpace: "nowrap", lineHeight: 1.6, ...style,
    }}>{children}</span>
  );
}

/** 타임프레임 칩(주/일/4시간/1시간 방향) — 시안의 ▲▼ 표기를 그대로 씁니다. */
export function TimeframeChips({ items = [], style }) {
  const C = useThemeTokens();
  if (!items.length) return null;
  return (
    <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", ...style }}>
      {items.map((t, i) => {
        const a = accentOf(C, t.dir);
        const has = t.dir === "up" || t.dir === "down" || t.dir === "LONG" || t.dir === "SHORT";
        return (
          <span key={`${t.label}-${i}`} style={{
            fontSize: "11px", fontWeight: 700, padding: "3px 8px", borderRadius: "6px",
            background: has ? a.bg : C.card2, color: has ? a.hi : C.text4, lineHeight: 1.6,
          }}>
            {t.label} {has ? (a.base === C.green ? "▲" : "▼") : "—"}
          </span>
        );
      })}
    </div>
  );
}

/**
 * 시그널 카드 — 시안의 핵심 단위.
 * 좌측 accent 보더 + 상단 그라데이션 + 종합 점수 + TF 칩 + 지지/저항 라인.
 * 행동 지시 문구는 넣지 않습니다(상태 서술만 — 서비스 표현 원칙).
 */
export function SignalCard({
  symbol, sideLabel, dir, score, timeframes = [],
  support, price, resistance, onClick, style,
}) {
  const C = useThemeTokens();
  const a = accentOf(C, dir);
  const tt = useKitText();
  return (
    <div
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(e); } } : undefined}
      {...hoverProps(onClick,
        // 왼쪽 3px accent 보더는 방향 정보라 건드리지 않고, 나머지 3면만 강조합니다.
        (s) => { s.borderTopColor = C.border2; s.borderRightColor = C.border2; s.borderBottomColor = C.border2; },
        (s) => { s.borderTopColor = C.border; s.borderRightColor = C.border; s.borderBottomColor = C.border; })}
      style={{
        background: `linear-gradient(180deg, ${a.bg}, transparent 42%), ${C.card}`,
        border: `1px solid ${C.border}`, borderLeft: `3px solid ${a.base}`,
        borderRadius: "14px", padding: "12px 14px",
        cursor: onClick ? "pointer" : "default", ...style,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
          <span style={{ fontSize: "16px", fontWeight: 800, color: C.text1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{symbol}</span>
          {sideLabel && <SidePill dir={dir}>{sideLabel}</SidePill>}
        </div>
        {score != null && (
          <div style={{ textAlign: "right", lineHeight: 1, flexShrink: 0 }}>
            <div style={{ fontSize: "10px", color: C.text3, marginBottom: "2px" }}>{tt("mobile.kit.scoreLabel", "종합 점수")}</div>
            <Num size="20px" weight={800} color={a.hi}>{score}</Num>
          </div>
        )}
      </div>
      {timeframes.length > 0 && <TimeframeChips items={timeframes} style={{ marginTop: "9px" }} />}
      {(support || price || resistance) && (
        // maxWidth 상한: 데스크탑 넓은 카드(860px)에서 space-between 이 값 사이를 300px 이상
        // 벌려 놓아 라벨 없는 현재가가 무슨 숫자인지 읽히지 않던 문제의 가드입니다.
        // 모바일 카드 폭(≤420px)에서는 기존과 동일하게 전폭을 씁니다.
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "8px", marginTop: "9px", fontSize: "11px", color: C.text3, maxWidth: "420px" }}>
          <span>{tt("mobile.kit.support", "지지")} <Num size="11px" color={C.greenL || C.green}>{support ?? "—"}</Num></span>
          {price != null && <Num size="11px" weight={600} color={C.text2}>{price}</Num>}
          <span>{tt("mobile.kit.resistance", "저항")} <Num size="11px" color={C.redL || C.red}>{resistance ?? "—"}</Num></span>
        </div>
      )}
    </div>
  );
}

/** 종목 행 — 관심종목·트렌딩 리스트 공용. 리스트 컨테이너(ListCard) 안에 넣어 씁니다. */
export function AssetRow({
  icon, iconColor, name, meta, price, change, badge, rank, onClick, last = false,
}) {
  const C = useThemeTokens();
  return (
    <div
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      // role="button" 은 Enter·Space 모두에 반응해야 합니다(ARIA button 패턴).
      // preventDefault 는 Space 의 기본 동작(페이지 스크롤)을 막습니다 — SignalCard 와 동일 형태.
      onKeyDown={onClick ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(e); } } : undefined}
      {...hoverProps(onClick,
        (s) => { s.background = C.card2; },
        // 원래 배경 미지정(ListCard 상속) — 빈 값으로 인라인 오버라이드를 제거해 원복합니다.
        (s) => { s.background = ""; })}
      style={{
        display: "flex", alignItems: "center", gap: "12px", padding: "13px 14px",
        borderBottom: last ? "none" : `1px solid ${C.card2}`,
        cursor: onClick ? "pointer" : "default",
      }}
    >
      {rank != null && <Num size="12px" weight={800} color={C.text4} style={{ width: "18px", flexShrink: 0 }}>{rank}</Num>}
      {icon && (
        <div style={{
          width: "38px", height: "38px", borderRadius: "12px", background: C.card2,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: "12px", fontWeight: 800, color: iconColor || C.text2, flexShrink: 0,
        }}>{icon}</div>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: "14px", fontWeight: 700, color: C.text1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{name}</div>
        {meta && <div style={{ fontSize: "11px", color: C.text3, marginTop: "1px" }}>{meta}</div>}
      </div>
      {badge}
      <div style={{ textAlign: "right", flexShrink: 0 }}>
        {price != null && <div><Num size="14px">{price}</Num></div>}
        {change != null && <div style={{ marginTop: "1px" }}>{typeof change === "number" ? <ChangeNum value={change} /> : change}</div>}
      </div>
    </div>
  );
}

/** 행을 담는 카드 컨테이너 — 내부 구분선이 카드 모서리를 넘지 않게 overflow 를 잘라둡니다. */
export function ListCard({ children, style }) {
  const C = useThemeTokens();
  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`, borderRadius: "16px",
      overflow: "hidden", ...style,
    }}>{children}</div>
  );
}

/**
 * 지수 스트립 — 가로 스크롤, 스냅. 모바일에서 화면 밖으로 흘려보내는 게 시안 의도입니다.
 *  · layout="grid" : 데스크탑처럼 폭이 넉넉한 화면에서 스크롤 대신 자동 줄바꿈 그리드로 배치
 *  · numSize       : 지수 숫자 크기 — 데스크탑 grid 전환 시 15px 가 작아 18~20px 권장
 */
export function IndexStrip({ items = [], numSize = "15px", layout = "scroll", style }) {
  const C = useThemeTokens();
  if (!items.length) return null;
  const isGrid = layout === "grid";
  return (
    // ⚠️ 화면 끝까지 흘리는 bleed(음수 마진 + 같은 크기 패딩)를 쓰지 않습니다.
    //    홈 컨테이너의 좌우 여백이 16px 이 아니라, 프리뷰에서 첫 카드가 화면 왼쪽으로
    //    6px 잘려 나갔습니다(2026-08 실측). 부모 여백을 그대로 따르는 편이 안전합니다.
    <div style={isGrid ? {
      display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
      gap: "8px", ...style,
    } : {
      display: "flex", gap: "8px", overflowX: "auto",
      paddingBottom: "2px", scrollSnapType: "x proximity",
      scrollbarWidth: "none", ...style,
    }}>
      {items.map((ix, i) => (
        <div key={`${ix.label}-${i}`}
          onClick={ix.onClick}
          role={ix.onClick ? "button" : undefined}
          tabIndex={ix.onClick ? 0 : undefined}
          onKeyDown={ix.onClick ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); ix.onClick(e); } } : undefined}
          {...hoverProps(ix.onClick,
            (s) => { s.background = C.card2; s.borderColor = C.border2; },
            (s) => { s.background = C.card; s.borderColor = C.border; })}
          style={{
            ...(isGrid ? {} : { flexShrink: 0, scrollSnapAlign: "start", minWidth: "108px" }),
            background: C.card,
            border: `1px solid ${C.border}`, borderRadius: "12px",
            padding: "10px 13px",
            cursor: ix.onClick ? "pointer" : "default",
          }}>
          <div style={{ fontSize: "11px", color: C.text3, fontWeight: 700, whiteSpace: "nowrap" }}>{ix.label}</div>
          <div style={{ marginTop: "3px" }}><Num size={numSize} weight={800}>{ix.value}</Num></div>
          <div>{typeof ix.change === "number" ? <ChangeNum value={ix.change} /> : <Num size="12px" color={C.text3}>{ix.change ?? "—"}</Num>}</div>
        </div>
      ))}
    </div>
  );
}

/**
 * 게이지 카드 — 공포·탐욕처럼 0~100 스케일 지표.
 * 빨강→노랑→초록 그라데이션 바 위에 현재 위치를 노브로 표시합니다.
 */
export function GaugeCard({
  title, value, label, valueColor, note, gradient, unit, scaleLeft, scaleRight,
  children, onClick, style,
}) {
  const C = useThemeTokens();
  const v = Number.isFinite(Number(value)) ? Math.max(0, Math.min(100, Number(value))) : null;
  const col = valueColor || C.yellowL || C.yellow;
  return (
    // onClick 이 없으면 role/tabIndex/onKeyDown 전부 undefined — 비인터랙티브 사용처
    // (예: IndicatorHub 의 GaugeIndicatorCard 는 바깥 래퍼가 버튼 역할)에서 중첩되지 않습니다.
    <div
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(e); } } : undefined}
      {...hoverProps(onClick,
        // 노브 링(boxShadow)이 C.card 기준이라 배경은 유지하고 보더만 강조합니다.
        (s) => { s.borderColor = C.border2; },
        (s) => { s.borderColor = C.border; })}
      style={{
        background: C.card, border: `1px solid ${C.border}`, borderRadius: "16px",
        padding: "15px 16px", cursor: onClick ? "pointer" : "default", ...style,
      }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
        <div style={{ fontSize: "14px", fontWeight: 800, color: C.text1 }}>{title}</div>
        {note && <div style={{ fontSize: "12px", color: C.text3 }}>{note}</div>}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: "8px", marginTop: "8px" }}>
        {/* unit(°, % 등)은 숫자에 바로 붙여야 한 덩어리로 읽힙니다 — 라벨과는 간격을 둡니다. */}
        <span style={{ display: "inline-flex", alignItems: "baseline" }}>
          <Num size="34px" weight={800} color={col}>{v ?? "—"}</Num>
          {unit && v != null && <Num size="20px" weight={800} color={col} style={{ marginLeft: "1px" }}>{unit}</Num>}
        </span>
        {label && <span style={{ fontSize: "14px", fontWeight: 800, color: col }}>{label}</span>}
      </div>
      <div style={{ position: "relative", height: "16px", marginTop: "8px" }}>
        <div style={{
          position: "absolute", top: "5px", left: 0, right: 0, height: "6px", borderRadius: "9999px",
          background: gradient || `linear-gradient(90deg, ${C.red}, ${C.yellow} 45%, ${C.green})`,
        }} />
        {v != null && (
          <div style={{
            position: "absolute", top: "1px", left: `calc(${v}% - 7px)`,
            width: "14px", height: "14px", borderRadius: "50%",
            background: col, boxShadow: `0 0 0 3px ${C.card}`,
          }} />
        )}
      </div>
      {/* 스케일 양끝 라벨 — 0/100 이 무엇을 뜻하는지 밝혀야 게이지가 해석 가능해집니다. */}
      {(scaleLeft || scaleRight) && (
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: "2px", fontSize: "10px", color: C.text4 }}>
          <span>{scaleLeft}</span><span>{scaleRight}</span>
        </div>
      )}
      {children}
    </div>
  );
}

/** 섹션 헤더 — 라이브 도트(선택) + 더보기. 시안의 "Today's Top Signals" 패턴. */
export function MobileSectionHeader({ title, live = false, actionLabel, onAction, style }) {
  const C = useThemeTokens();
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px", ...style }}>
      <div style={{ display: "flex", alignItems: "center", gap: "7px", minWidth: 0 }}>
        {/* z-pulse 는 tokens.css 의 기존 2초 pulse 유틸입니다(신규 keyframe 추가 없음). */}
        {live && <span className="z-pulse" style={{ width: "7px", height: "7px", borderRadius: "50%", background: C.green, flexShrink: 0 }} />}
        <span style={{ fontSize: "16px", fontWeight: 800, color: C.text1 }}>{title}</span>
      </div>
      {actionLabel && (
        <button onClick={onAction} style={{
          background: "none", border: "none", color: C.blueL, fontSize: "12px",
          fontWeight: 700, cursor: "pointer", fontFamily: "inherit", padding: "4px 0", flexShrink: 0,
        }}>{actionLabel}</button>
      )}
    </div>
  );
}

/** 아이콘 원형 버튼 — 헤더 우측 알림/설정 등. */
export function IconButton({ children, onClick, color, badge = false, ariaLabel, style }) {
  const C = useThemeTokens();
  return (
    <button onClick={onClick} aria-label={ariaLabel} style={{
      position: "relative", width: "38px", height: "38px", borderRadius: "12px",
      background: C.card, border: `1px solid ${C.border}`, color: color || C.text2,
      cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
      flexShrink: 0, ...style,
    }}>
      {children}
      {badge && (
        <span style={{
          position: "absolute", top: "8px", right: "9px", width: "7px", height: "7px",
          borderRadius: "50%", background: C.red, border: `2px solid ${C.card}`,
        }} />
      )}
    </button>
  );
}

/** 세그먼트 컨트롤 — 시안의 [전체|코인|주식] 필터. */
export function Segment({ options = [], value, onChange, style }) {
  const C = useThemeTokens();
  return (
    <div style={{
      display: "inline-flex", gap: "4px", background: C.card, border: `1px solid ${C.border}`,
      borderRadius: "12px", padding: "4px", alignSelf: "flex-start", maxWidth: "100%",
      overflowX: "auto", scrollbarWidth: "none", ...style,
    }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          // aria-pressed 로 선택 상태를 스크린리더에 직접 전달합니다(색만으로 상태를 전하지 않기).
          <button key={o.value} onClick={() => onChange?.(o.value)} aria-pressed={on} style={{
            padding: "8px 15px", borderRadius: "9px", border: "none", cursor: "pointer",
            fontSize: "13px", fontWeight: 700, fontFamily: "inherit", whiteSpace: "nowrap",
            background: on ? C.blue : "transparent", color: on ? "#fff" : C.text3,
          }}>{o.label}{o.count != null && <span style={{ opacity: .75, marginLeft: "5px" }}>{o.count}</span>}</button>
        );
      })}
    </div>
  );
}

/** 강조 이벤트 카드 — 다가오는 경제 일정 등 "한 줄 알림" 카드. */
export function EventCard({ icon, title, meta, badge, badgeTone = "down", onClick, style }) {
  const C = useThemeTokens();
  const a = accentOf(C, badgeTone);
  return (
    // GaugeCard 와 동일 — 클릭 가능할 때만 button 3종 세트를 붙입니다(ARIA button 패턴).
    <div
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(e); } } : undefined}
      {...hoverProps(onClick,
        (s) => { s.background = C.card2; s.borderColor = C.border2; },
        (s) => { s.background = C.card; s.borderColor = C.border; })}
      style={{
        background: C.card, border: `1px solid ${C.border}`, borderRadius: "16px",
        padding: "14px 16px", display: "flex", alignItems: "center", gap: "12px",
        cursor: onClick ? "pointer" : "default", ...style,
      }}>
      {icon && (
        <div style={{
          width: "40px", height: "40px", borderRadius: "12px", flexShrink: 0,
          background: `${C.yellow}1A`, color: C.yellowL || C.yellow,
          display: "flex", alignItems: "center", justifyContent: "center", fontSize: "18px",
        }}>{icon}</div>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: "14px", fontWeight: 700, color: C.text1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</div>
        {meta && <div style={{ fontSize: "12px", color: C.text3, marginTop: "1px" }}>{meta}</div>}
      </div>
      {badge && (
        <span style={{
          fontSize: "10px", fontWeight: 800, padding: "3px 8px", borderRadius: "9999px",
          background: a.bg, color: a.hi, flexShrink: 0,
        }}>{badge}</span>
      )}
    </div>
  );
}

/** 화면 하단 면책 — 시안이 모든 정보 화면 끝에 두는 한 줄. children 으로 오버라이드 가능. */
export function Disclaimer({ children, style }) {
  const C = useThemeTokens();
  const tt = useKitText();
  return (
    <div style={{
      fontSize: "10px", color: C.text4, textAlign: "center",
      padding: "0 20px", lineHeight: 1.5, ...style,
    }}>{children || tt("mobile.kit.disclaimerDefault", "표시되는 신호와 지표는 참고 정보이며 투자 조언이 아닙니다.")}</div>
  );
}

/** 스파크라인 — 상세/카드용 미니 추이. points 는 0~100 정규화 숫자 배열. */
export function Sparkline({ points = [], dir = "up", height = 96, style }) {
  const C = useThemeTokens();
  if (!points.length) return null;
  const a = accentOf(C, dir);
  const W = 320, H = 96;
  const max = Math.max(...points), min = Math.min(...points);
  const span = max - min || 1;
  const step = points.length > 1 ? W / (points.length - 1) : W;
  const coords = points.map((p, i) => `${(i * step).toFixed(1)},${(H - ((p - min) / span) * (H - 12) - 6).toFixed(1)}`);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"
      style={{ width: "100%", height: `${height}px`, display: "block", ...style }} aria-hidden="true">
      <polyline points={`${coords.join(" ")} ${W},${H} 0,${H}`} fill={a.bg} stroke="none" />
      <polyline points={coords.join(" ")} fill="none" stroke={a.base} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default {
  MONO, accentOf, useKitText, Num, ChangeNum, SidePill, TimeframeChips, SignalCard,
  AssetRow, ListCard, IndexStrip, GaugeCard, MobileSectionHeader,
  IconButton, Segment, EventCard, Disclaimer, Sparkline,
};
