// ══════════════════════════════════════════════════════════════════
// Zepta UI Primitives — Shadcn aesthetic, --z-* token backed
// • 모든 색/간격은 tokens.css 의 --z-* (또는 Shadcn bridge 변수) 사용
// • Shadcn UI 와 시각적 일관 (ring-1 카드, focus-visible blue glow,
//   rounded-xl, font-medium 등) 을 inline style 로 재현
// • API 는 RealTrading.jsx 가 그대로 쓸 수 있도록 변경 없음
// 사용: import { Button, Card, Badge, Stat, Tabs, ... } from "./ui/primitives";
// ══════════════════════════════════════════════════════════════════
import React, { useEffect, useState, useCallback, useRef, createContext, useContext } from "react";
import { Cross, ChevronR } from "./icons.jsx";
import { useBreakpoint } from "./useBreakpoint.jsx";

// ── 모바일 우선 컴포넌트 re-export (BottomSheet/ActionSheet/Stepper)
//    구현은 ./bottom-sheet.jsx 에 있고, primitives 의 단일 import 경로 보존.
export { BottomSheet, ActionSheet, Stepper } from "./bottom-sheet.jsx";

// ───────────────────────────── Button ─────────────────────────────
const BTN_VARIANTS = {
  default: { bg: "var(--z-card-2)", fg: "var(--z-text)",   bd: "var(--z-border)", hover: "var(--z-card-hi)" },
  primary: { bg: "var(--z-blue)",   fg: "#fff",            bd: "var(--z-blue)",   hover: "var(--z-blue-hi)" },
  success: { bg: "var(--z-green)",  fg: "#021B10",         bd: "var(--z-green)",  hover: "var(--z-green-hi)" },
  danger:  { bg: "var(--z-red)",    fg: "#fff",            bd: "var(--z-red)",    hover: "var(--z-red-hi)" },
  warn:    { bg: "var(--z-yellow)", fg: "#1B1200",         bd: "var(--z-yellow)", hover: "var(--z-yellow-hi)" },
  ghost:   { bg: "transparent",     fg: "var(--z-text)",   bd: "var(--z-border)", hover: "var(--z-card-2)" },
  outline: { bg: "transparent",     fg: "var(--z-text)",   bd: "var(--z-border-hi)", hover: "var(--z-card-2)" },
  subtle:  { bg: "var(--z-blue-bg)",fg: "var(--z-blue-hi)",bd: "transparent",     hover: "var(--z-blue-bg)" },
  link:    { bg: "transparent",     fg: "var(--z-blue-hi)",bd: "transparent",     hover: "transparent" },
};
const BTN_SIZES = {
  xs: { p: "4px 10px",  fs: 11, h: 26 },
  sm: { p: "6px 12px",  fs: 12, h: 32 },
  md: { p: "9px 16px",  fs: 13, h: 38 },
  lg: { p: "12px 20px", fs: 14, h: 44 },
};

export function Button({
  variant = "default", size = "md", leftIcon, rightIcon, loading, disabled, fullWidth,
  onClick, children, style, title, type = "button", ...rest
}) {
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const { isTouchDevice } = useBreakpoint();
  const v = BTN_VARIANTS[variant] || BTN_VARIANTS.default;
  const s = BTN_SIZES[size] || BTN_SIZES.md;
  // WCAG 2.5.5 / iOS HIG — 터치 디바이스에선 최소 44px 강제 (xs/sm 사이즈도 보정)
  const minH = isTouchDevice ? Math.max(s.h, 44) : s.h;
  // 터치 디바이스에선 폰트도 살짝 키워서 시인성 확보 (xs/sm 만)
  const fs = isTouchDevice && s.fs < 13 ? 13 : s.fs;
  return (
    <button
      type={type}
      className="z-btn"
      onClick={onClick}
      disabled={disabled || loading}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={(e) => { setFocus(true); rest.onFocus?.(e); }}
      onBlur={(e) => { setFocus(false); rest.onBlur?.(e); }}
      title={title}
      style={{
        background: hover && !disabled ? v.hover : v.bg,
        color: v.fg,
        borderColor: v.bd,
        padding: s.p,
        fontSize: fs,
        minHeight: minH,
        width: fullWidth ? "100%" : undefined,
        textDecoration: variant === "link" ? "underline" : "none",
        borderRadius: "var(--z-r-md)",
        boxShadow: focus && !disabled ? "var(--z-sh-glow-blue)" : undefined,
        ...style,
      }}
      {...rest}
    >
      {loading && <Spinner size={fs + 2} />}
      {!loading && leftIcon}
      {children}
      {!loading && rightIcon}
    </button>
  );
}

// ───────────────────────────── Spinner ─────────────────────────────
export function Spinner({ size = 16, color = "currentColor" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ animation: "spin 0.8s linear infinite" }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <circle cx="12" cy="12" r="10" stroke={color} strokeOpacity="0.25" strokeWidth="3" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke={color} strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

// ───────────────────────────── Card ─────────────────────────────
export function Card({ children, title, subtitle, actions, icon, tone, pad = 18, style, noBorder, onClick, collapsible = false, defaultCollapsed = false }) {
  // ★ 접기 기능 (모바일 스크롤 축소용). collapsible=true 일 때만 헤더 클릭으로 본문 토글.
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const canCollapse = collapsible && !!title;
  const toneBorder = tone
    ? { danger: "var(--z-red)", warn: "var(--z-yellow)", success: "var(--z-green)", info: "var(--z-blue)" }[tone]
    : "var(--z-border)";
  // Shadcn Card 와 동일한 ring-1 ring-foreground/10 효과를 inset shadow 로 재현
  const ringShadow = tone
    ? `inset 0 0 0 1px ${toneBorder}66`
    : `inset 0 0 0 1px color-mix(in oklab, var(--z-text) 10%, transparent)`;
  return (
    <section
      onClick={onClick}
      style={{
        background: "var(--z-card)",
        border: noBorder ? "none" : "1px solid transparent",
        borderRadius: "var(--z-r-xl)",
        boxShadow: noBorder ? "var(--z-sh-sm)" : `${ringShadow}, var(--z-sh-sm)`,
        transition: "border-color var(--z-dur) var(--z-ease), transform var(--z-dur) var(--z-ease), box-shadow var(--z-dur) var(--z-ease)",
        cursor: onClick ? "pointer" : "default",
        ...style,
      }}
    >
      {(title || actions) && (
        <header
          onClick={canCollapse ? () => setCollapsed((v) => !v) : undefined}
          style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "14px 18px",
            borderBottom: collapsed ? "none" : `1px solid var(--z-border)`,
            gap: 12,
            cursor: canCollapse ? "pointer" : "default",
            userSelect: canCollapse ? "none" : "auto",
          }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            {icon && <div style={{ color: "var(--z-text-2)" }}>{icon}</div>}
            <div style={{ minWidth: 0 }}>
              {title && (
                <div style={{ fontSize: 14, fontWeight: 700, color: "var(--z-text)", letterSpacing: "-0.01em" }}>
                  {title}
                </div>
              )}
              {subtitle && !collapsed && (
                <div style={{ fontSize: 11, color: "var(--z-text-3)", marginTop: 2 }}>{subtitle}</div>
              )}
            </div>
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            {actions}
            {canCollapse && (
              <div style={{
                color: "var(--z-text-3)", display: "flex", alignItems: "center",
                transform: collapsed ? "rotate(90deg)" : "rotate(-90deg)",
                transition: "transform var(--z-dur) var(--z-ease)",
              }}>
                <ChevronR size={16} />
              </div>
            )}
          </div>
        </header>
      )}
      {!collapsed && <div style={{ padding: pad }}>{children}</div>}
    </section>
  );
}

// ───────────────────────────── Badge ─────────────────────────────
const BADGE_TONES = {
  default: { bg: "var(--z-card-hi)", fg: "var(--z-text-2)",  bd: "var(--z-border-2)" },
  blue:    { bg: "var(--z-blue-bg)", fg: "var(--z-blue-hi)", bd: "var(--z-blue)" },
  green:   { bg: "var(--z-green-bg)",fg: "var(--z-green-hi)",bd: "var(--z-green)" },
  red:     { bg: "var(--z-red-bg)",  fg: "var(--z-red-hi)",  bd: "var(--z-red)" },
  yellow:  { bg: "var(--z-yellow-bg)",fg:"var(--z-yellow-hi)",bd: "var(--z-yellow)" },
  purple:  { bg: "var(--z-purple-bg)",fg:"var(--z-purple-hi)",bd:"var(--z-purple)" },
  cyan:    { bg: "var(--z-cyan-bg)", fg: "var(--z-cyan)",    bd: "var(--z-cyan)" },
};
export function Badge({ children, tone = "default", size = "md", dot, solid, style }) {
  const t = BADGE_TONES[tone] || BADGE_TONES.default;
  const pad = size === "sm" ? "2px 8px" : "3px 10px";
  const fs = size === "sm" ? 10 : 11;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      padding: pad, fontSize: fs, fontWeight: 700,
      background: solid ? t.bd : t.bg,
      color: solid ? "#fff" : t.fg,
      border: `1px solid ${t.bd}${solid ? "" : "44"}`,
      borderRadius: "var(--z-r-full)",
      letterSpacing: 0.2,
      fontFamily: "var(--z-font-sans)",
      ...style,
    }}>
      {dot && <span style={{
        width: 6, height: 6, borderRadius: "50%",
        background: solid ? "#fff" : t.bd, boxShadow: `0 0 6px ${t.bd}`,
      }} />}
      {children}
    </span>
  );
}

// ───────────────────────────── Stat ─────────────────────────────
export function Stat({ label, value, sub, tone, icon, trend, mono = true, loading, compact, align = "left" }) {
  const color = tone
    ? { danger: "var(--z-red-hi)", warn: "var(--z-yellow-hi)", success: "var(--z-green-hi)", info: "var(--z-blue-hi)" }[tone]
    : "var(--z-text)";
  return (
    <div style={{
      background: "var(--z-card-2)",
      border: `1px solid var(--z-border)`,
      borderRadius: "var(--z-r-md)",
      padding: compact ? "10px 12px" : "14px 16px",
      display: "flex", flexDirection: "column", gap: 4,
      textAlign: align, minWidth: 0,
    }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 6,
        fontSize: 10, letterSpacing: 0.7, textTransform: "uppercase",
        color: "var(--z-text-3)", fontWeight: 700,
      }}>
        {icon}
        {label}
      </div>
      {loading ? (
        <div className="z-skel" style={{ height: compact ? 18 : 22, width: "60%" }} />
      ) : (
        <div style={{
          fontSize: compact ? 15 : 18, fontWeight: 800, color, letterSpacing: "-0.01em",
          fontFamily: mono ? "var(--z-font-mono)" : "var(--z-font-sans)",
          fontVariantNumeric: "tabular-nums",
          wordBreak: "break-word",
        }}>
          {value}
          {trend != null && (
            <span style={{
              marginLeft: 6, fontSize: 11, fontWeight: 700,
              color: trend >= 0 ? "var(--z-green-hi)" : "var(--z-red-hi)",
            }}>
              {trend >= 0 ? "▲" : "▼"} {Math.abs(trend).toFixed(2)}%
            </span>
          )}
        </div>
      )}
      {sub && (
        <div style={{ fontSize: 11, color: "var(--z-text-3)" }}>{sub}</div>
      )}
    </div>
  );
}

// ───────────────────────────── Tabs ─────────────────────────────
export function Tabs({ value, onChange, items, variant = "underline", size = "md", fullWidth }) {
  const { isTouchDevice } = useBreakpoint();
  const fs = size === "sm" ? 12 : 13;
  // 터치 디바이스에선 최소 44px 높이 보장 (WCAG 2.5.5)
  const pd = isTouchDevice
    ? (size === "sm" ? "12px 14px" : "14px 18px")
    : (size === "sm" ? "8px 12px" : "10px 16px");
  if (variant === "pills") {
    return (
      <div style={{
        display: "inline-flex", background: "var(--z-card-2)",
        border: `1px solid var(--z-border)`, borderRadius: "var(--z-r-md)",
        padding: 4, gap: 2, width: fullWidth ? "100%" : undefined,
      }}>
        {items.map((it) => {
          const active = it.id === value;
          return (
            <button
              key={it.id}
              onClick={() => onChange?.(it.id)}
              style={{
                flex: fullWidth ? 1 : undefined,
                border: "none", cursor: "pointer",
                background: active ? "var(--z-card-hi)" : "transparent",
                color: active ? "var(--z-text)" : "var(--z-text-2)",
                padding: pd, fontSize: fs, fontWeight: 700,
                borderRadius: "var(--z-r-sm)",
                transition: "all var(--z-dur-fast) var(--z-ease)",
                fontFamily: "var(--z-font-sans)",
                boxShadow: active ? "var(--z-sh-sm)" : "none",
              }}
            >
              {it.label}
              {it.count != null && (
                <span style={{ marginLeft: 6, fontSize: 10, opacity: 0.7 }}>({it.count})</span>
              )}
            </button>
          );
        })}
      </div>
    );
  }
  // underline
  return (
    <div style={{
      display: "flex", borderBottom: `1px solid var(--z-border)`,
      gap: 4, overflowX: "auto", scrollbarWidth: "none",
    }}>
      {items.map((it) => {
        const active = it.id === value;
        return (
          <button
            key={it.id}
            onClick={() => onChange?.(it.id)}
            style={{
              border: "none", background: "transparent",
              padding: pd, fontSize: fs, fontWeight: 700,
              color: active ? "var(--z-text)" : "var(--z-text-3)",
              borderBottom: `2px solid ${active ? "var(--z-blue)" : "transparent"}`,
              marginBottom: -1, cursor: "pointer",
              fontFamily: "var(--z-font-sans)", whiteSpace: "nowrap",
              transition: "color var(--z-dur-fast) var(--z-ease)",
            }}
          >
            {it.label}
            {it.count != null && (
              <span style={{ marginLeft: 6, fontSize: 10, opacity: 0.6 }}>({it.count})</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ───────────────────────────── Switch ─────────────────────────────
export function Switch({ checked, onChange, disabled, label, size = "md" }) {
  const { isTouchDevice } = useBreakpoint();
  const w = size === "sm" ? 32 : 40;
  const h = size === "sm" ? 18 : 22;
  const k = h - 4;
  return (
    <label style={{
      display: "inline-flex", alignItems: "center", gap: 10,
      cursor: disabled ? "not-allowed" : "pointer",
      // 터치 디바이스에선 라벨 전체가 44px tap target 이 되도록
      minHeight: isTouchDevice ? 44 : undefined,
      padding: isTouchDevice ? "4px 0" : 0,
    }}>
      <span
        role="switch"
        aria-checked={checked}
        onClick={() => !disabled && onChange?.(!checked)}
        style={{
          width: w, height: h, borderRadius: h,
          background: checked ? "var(--z-green)" : "var(--z-border-2)",
          position: "relative", transition: "background var(--z-dur) var(--z-ease)",
          opacity: disabled ? 0.5 : 1, flexShrink: 0,
        }}
      >
        <span style={{
          position: "absolute", top: 2, left: checked ? w - k - 2 : 2,
          width: k, height: k, borderRadius: "50%",
          background: "#fff", transition: "left var(--z-dur) var(--z-ease)",
          boxShadow: "0 2px 6px rgba(0,0,0,0.3)",
        }} />
      </span>
      {label && <span style={{ fontSize: 13, color: "var(--z-text)", userSelect: "none" }}>{label}</span>}
    </label>
  );
}

// ───────────────────────────── Input ─────────────────────────────
export function Input({ leftIcon, rightIcon, style, ...rest }) {
  const [focus, setFocus] = useState(false);
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8,
      background: "var(--z-card-2)",
      border: `1px solid ${focus ? "var(--z-blue)" : "var(--z-border)"}`,
      borderRadius: "var(--z-r-sm)",
      padding: "0 12px", height: 38,
      transition: "border-color var(--z-dur-fast) var(--z-ease)",
      boxShadow: focus ? "var(--z-sh-glow-blue)" : "none",
      ...style,
    }}>
      {leftIcon && <div style={{ color: "var(--z-text-3)" }}>{leftIcon}</div>}
      <input
        {...rest}
        onFocus={(e) => { setFocus(true); rest.onFocus?.(e); }}
        onBlur={(e) => { setFocus(false); rest.onBlur?.(e); }}
        style={{
          flex: 1, background: "transparent", border: "none", outline: "none",
          color: "var(--z-text)", fontSize: 13, fontFamily: "var(--z-font-sans)",
          minWidth: 0,
        }}
      />
      {rightIcon && <div style={{ color: "var(--z-text-3)" }}>{rightIcon}</div>}
    </div>
  );
}

// ───────────────────────────── Dialog ─────────────────────────────
export function Dialog({ open, onClose, title, description, children, footer, maxWidth = 480, tone }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && onClose?.();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  const accent = tone
    ? { danger: "var(--z-red)", warn: "var(--z-yellow)", info: "var(--z-blue)" }[tone]
    : "var(--z-border-2)";
  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        // E-4 — Dialog 도 BottomSheet 와 동일 정책 (모바일 nav 10000 위)
        position: "fixed", inset: 0, zIndex: 11000,
        background: "rgba(4, 8, 16, 0.72)", backdropFilter: "blur(4px)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
        animation: "z-fade-in var(--z-dur) var(--z-ease)",
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--z-card)",
          border: `1px solid ${accent}`,
          borderRadius: "var(--z-r-xl)",
          boxShadow: "var(--z-sh-lg)",
          padding: 0, width: "100%", maxWidth,
          maxHeight: "calc(100vh - 32px)", overflow: "auto",
        }}
      >
        <div style={{ padding: "20px 22px 8px", display: "flex", alignItems: "flex-start", gap: 12 }}>
          <div style={{ flex: 1 }}>
            {title && <div style={{ fontSize: 16, fontWeight: 800, color: "var(--z-text)", letterSpacing: "-0.01em" }}>{title}</div>}
            {description && (
              <div style={{ marginTop: 6, fontSize: 13, color: "var(--z-text-2)", lineHeight: 1.55, whiteSpace: "pre-wrap" }}>
                {description}
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            style={{
              background: "transparent", border: "none", color: "var(--z-text-3)",
              cursor: "pointer", padding: 4, borderRadius: 6,
            }}
            aria-label="Close"
          ><Cross size={18} /></button>
        </div>
        {children && <div style={{ padding: "8px 22px 16px" }}>{children}</div>}
        {footer && (
          <div style={{
            padding: "14px 22px", borderTop: `1px solid var(--z-border)`,
            display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap",
          }}>{footer}</div>
        )}
      </div>
    </div>
  );
}

// ───────────────────────────── Tooltip ─────────────────────────────
export function Tooltip({ content, children, side = "top" }) {
  const [show, setShow] = useState(false);
  return (
    <span style={{ position: "relative", display: "inline-flex" }}
      onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      {children}
      {show && (
        <span style={{
          position: "absolute",
          bottom: side === "top" ? "calc(100% + 6px)" : undefined,
          top: side === "bottom" ? "calc(100% + 6px)" : undefined,
          left: "50%", transform: "translateX(-50%)",
          background: "var(--z-card-hi)", color: "var(--z-text)",
          padding: "6px 10px", fontSize: 11, fontWeight: 600,
          borderRadius: "var(--z-r-sm)", border: `1px solid var(--z-border-2)`,
          whiteSpace: "nowrap", boxShadow: "var(--z-sh)", zIndex: 500,
          pointerEvents: "none", animation: "z-fade-in var(--z-dur-fast) var(--z-ease)",
        }}>{content}</span>
      )}
    </span>
  );
}

// ───────────────────────────── MetricInfo ─────────────────────────────
// 어려운 금융 용어 (Sharpe, MDD, RR 등) 옆에 ⓘ 아이콘을 붙여 클릭/호버 시
// 한국어 풀이 보여줌. 데스크탑 hover + 모바일 tap 모두 지원.
//
// 사용:
//   <MetricInfo label="안정성 점수" hint="수익이 얼마나 안정적인지 보여주는 점수. 1.0 이상이면 양호, 2.0 이상이면 매우 우수" />
export function MetricInfo({ label, hint, side = "top", style, labelStyle }) {
  const [show, setShow] = useState(false);
  // 외부 클릭 시 닫기 (모바일 tap 후 자동 닫힘)
  useEffect(() => {
    if (!show) return;
    const onDocClick = () => setShow(false);
    // 다음 frame 부터 리스너 활성 — 토글 클릭이 즉시 닫히지 않도록
    const id = setTimeout(() => document.addEventListener("click", onDocClick), 0);
    return () => { clearTimeout(id); document.removeEventListener("click", onDocClick); };
  }, [show]);
  return (
    <span style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 4, ...style }}>
      <span style={labelStyle}>{label}</span>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setShow((v) => !v); }}
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        aria-label={`${label} 설명 보기`}
        style={{
          width: 16, height: 16, padding: 0, border: "none",
          background: "transparent", color: "var(--z-text-3)",
          cursor: "pointer", display: "inline-flex",
          alignItems: "center", justifyContent: "center",
          fontSize: 11, fontWeight: 700, opacity: 0.7,
          borderRadius: "50%",
        }}
      >
        <span style={{
          display: "inline-block", width: 14, height: 14, lineHeight: "14px",
          borderRadius: "50%", textAlign: "center",
          border: "1px solid var(--z-text-3)",
          fontSize: 10, fontStyle: "italic", fontFamily: "Georgia, serif",
        }}>i</span>
      </button>
      {show && (
        <span
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "absolute",
            bottom: side === "top" ? "calc(100% + 8px)" : undefined,
            top: side === "bottom" ? "calc(100% + 8px)" : undefined,
            left: "50%", transform: "translateX(-50%)",
            background: "var(--z-card-hi)", color: "var(--z-text)",
            padding: "10px 14px", fontSize: 12, fontWeight: 500, lineHeight: 1.5,
            borderRadius: "8px", border: `1px solid var(--z-border-2)`,
            width: "max-content", maxWidth: 260, textAlign: "left",
            boxShadow: "0 8px 24px rgba(0,0,0,0.16)", zIndex: 500,
            animation: "z-fade-in var(--z-dur-fast) var(--z-ease)",
            whiteSpace: "normal", wordBreak: "keep-all",
          }}
        >{hint}</span>
      )}
    </span>
  );
}

// ───────────────────────────── Skeleton ─────────────────────────────
export function Skeleton({ width = "100%", height = 14, rounded = 6, style }) {
  return (
    <div className="z-skel" style={{ width, height, borderRadius: rounded, ...style }} />
  );
}

// ───────────────────────────── Empty State ─────────────────────────────
// 빈 상태 표준 컴포넌트 — 친절한 카피 + 다음 액션 가이드.
// 사용:
//   <EmptyState icon="✨" title="저장된 조건이 없어요"
//     description="추천 조건 4개 중 마음에 드는 것을 골라 시작해보세요."
//     action={<Button variant="primary" onClick={...}>추천 조건 보기</Button>} />
//
// props.bordered=true 시 dashed border + card2 bg 컨테이너로 감싸짐 (페이지 inline 용).
// props.icon 은 emoji string 또는 ReactNode 모두 지원.
export function EmptyState({ icon, title, description, action, bordered, compact, style }) {
  const isEmoji = typeof icon === "string";
  const containerStyle = bordered ? {
    background: "var(--z-card-2)",
    border: "1px dashed var(--z-border-2)",
    borderRadius: "var(--z-r-lg)",
    margin: "8px 0",
  } : {};
  return (
    <div style={{
      padding: compact ? "24px 16px" : "44px 24px",
      textAlign: "center",
      display: "flex", flexDirection: "column", alignItems: "center", gap: 10,
      ...containerStyle,
      ...style,
    }}>
      {icon && (
        isEmoji
          ? <div style={{ fontSize: 36, lineHeight: 1, opacity: 0.85 }}>{icon}</div>
          : <div style={{ color: "var(--z-text-3)", opacity: 0.7 }}>{icon}</div>
      )}
      {title && (
        <div style={{
          fontSize: 15, fontWeight: 800, color: "var(--z-text)",
          letterSpacing: "-0.01em", marginTop: icon ? 4 : 0,
        }}>{title}</div>
      )}
      {description && (
        <div style={{
          fontSize: 13, color: "var(--z-text-2)",
          maxWidth: 380, lineHeight: 1.6, wordBreak: "keep-all",
        }}>
          {description}
        </div>
      )}
      {action && <div style={{ marginTop: 8 }}>{action}</div>}
    </div>
  );
}

// ───────────────────────────── PageHeader ─────────────────────────────
// 페이지 최상단 H1 + 부제 + action 의 표준 컴포넌트.
// raw <h1 fontSize: FONT["2xl"]> 패턴을 모두 대체.
//
// 모바일 24px / 데스크탑 30px (FONT_MOBILE.h1 기준)
// 사용:
//   <PageHeader
//     icon="🧬"
//     title="알파 랩"
//     subtitle="검증된 33개 전략을 한 자리에서 비교하세요"
//     badge={<Badge tone="purple">베타</Badge>}
//     action={<Button variant="primary">새 백테스트</Button>}
//   />
export function PageHeader({ title, subtitle, action, badge, icon, isMobile: isMobileProp, style }) {
  const { isMobile } = useBreakpoint();
  const mobile = typeof isMobileProp === "boolean" ? isMobileProp : isMobile;
  const isEmoji = typeof icon === "string";
  return (
    <header style={{
      display: "flex", alignItems: "flex-start", justifyContent: "space-between",
      gap: 16, marginBottom: mobile ? 16 : 20, flexWrap: "wrap",
      ...style,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0, flex: 1 }}>
        {icon && (
          isEmoji
            ? <span style={{ fontSize: mobile ? 26 : 32, lineHeight: 1, flexShrink: 0 }}>{icon}</span>
            : <span style={{ color: "var(--z-text)", flexShrink: 0 }}>{icon}</span>
        )}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <h1 style={{
              margin: 0,
              fontSize: mobile ? 24 : 30,
              fontWeight: 800,
              color: "var(--z-text)",
              letterSpacing: "-0.02em",
              lineHeight: 1.2,
              fontFamily: "var(--z-font-sans)",
            }}>{title}</h1>
            {badge}
          </div>
          {subtitle && (
            <p style={{
              margin: "6px 0 0",
              fontSize: mobile ? 13 : 14,
              color: "var(--z-text-2)",
              lineHeight: 1.55,
              wordBreak: "keep-all",
            }}>{subtitle}</p>
          )}
        </div>
      </div>
      {action && (
        <div style={{
          display: "flex", gap: 8, alignItems: "center", flexShrink: 0,
          marginLeft: mobile ? 0 : "auto",
        }}>{action}</div>
      )}
    </header>
  );
}

// ───────────────────────────── LoadingBlock ─────────────────────────────
// 로딩 표준 컴포넌트 — raw "불러오는 중…" 텍스트 대체.
// Skeleton 3개 카드 + 텍스트.
//
// 사용:
//   {loading ? <LoadingBlock label="알파 데이터 불러오는 중…" /> : <Result data={data} />}
export function LoadingBlock({ rows = 3, label = "불러오는 중…", height = 60, style }) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", gap: 10,
      padding: "12px 0",
      ...style,
    }} role="status" aria-live="polite" aria-busy="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="z-skel"
          style={{
            height,
            width: "100%",
            borderRadius: "var(--z-r-md)",
            opacity: 1 - i * 0.15,
          }}
        />
      ))}
      {label && (
        <div style={{
          textAlign: "center", marginTop: 4,
          fontSize: 12, color: "var(--z-text-3)", fontWeight: 600,
        }}>{label}</div>
      )}
    </div>
  );
}

// ───────────────────────────── TrustRow ─────────────────────────────
// 신뢰 시그널 노출용 mini-row. 비로그인 랜딩 / 가입 배너 직하단에 사용.
//
// 사용:
//   <TrustRow items={[
//     { icon: "👥", label: "베타 가입자", value: "1,200+" },
//     { icon: "🧪", label: "검증 전략", value: "33개" },
//     { icon: "📡", label: "데이터", value: "Yahoo · Binance Live" },
//     { icon: "🔒", label: "보안", value: "TLS 1.3" },
//   ]} />
export function TrustRow({ items, dense, style }) {
  const { isMobile } = useBreakpoint();
  if (!items?.length) return null;
  return (
    <div style={{
      display: "flex",
      gap: isMobile ? 8 : 12,
      overflowX: isMobile ? "auto" : "visible",
      scrollbarWidth: "none",
      WebkitOverflowScrolling: "touch",
      flexWrap: isMobile ? "nowrap" : "wrap",
      ...style,
    }}>
      {items.map((it, i) => (
        <div
          key={i}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: dense ? "8px 12px" : "10px 14px",
            background: "var(--z-card-2)",
            border: "1px solid var(--z-border)",
            borderRadius: "var(--z-r-full)",
            flexShrink: 0,
            whiteSpace: "nowrap",
            boxShadow: "var(--z-sh-sm)",
          }}
          title={it.label}
        >
          {it.icon && (
            typeof it.icon === "string"
              ? <span style={{ fontSize: 14, lineHeight: 1 }}>{it.icon}</span>
              : it.icon
          )}
          <span style={{
            fontSize: 11, fontWeight: 700, color: "var(--z-text-3)",
            letterSpacing: 0.3, textTransform: "uppercase",
          }}>{it.label}</span>
          <span style={{
            fontSize: 13, fontWeight: 800, color: "var(--z-text)",
            fontFamily: "var(--z-font-mono)", fontVariantNumeric: "tabular-nums",
            letterSpacing: "-0.01em",
          }}>{it.value}</span>
        </div>
      ))}
    </div>
  );
}

// ───────────────────────────── Toast ─────────────────────────────
const ToastCtx = createContext({ push: () => {} });
const TOAST_EXIT_MS = 280; // out 애니메이션 길이와 동기화
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((msg, opts = {}) => {
    const id = Math.random().toString(36).slice(2);
    const tone = opts.tone || "default";
    const duration = opts.duration || 3500;
    setToasts((xs) => [...xs, { id, msg, tone, title: opts.title, exiting: false }]);
    // duration 시점에 exiting=true 로 표시 → 애니메이션 후 실제 제거
    setTimeout(() => {
      setToasts((xs) => xs.map((t) => t.id === id ? { ...t, exiting: true } : t));
      setTimeout(() => {
        setToasts((xs) => xs.filter((t) => t.id !== id));
      }, TOAST_EXIT_MS);
    }, duration);
  }, []);
  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <style>{`
        @keyframes z-toast-in {
          from { opacity: 0; transform: translateX(40px) scale(0.96); }
          to   { opacity: 1; transform: translateX(0) scale(1); }
        }
        @keyframes z-toast-out {
          from { opacity: 1; transform: translateX(0) scale(1); }
          to   { opacity: 0; transform: translateX(40px) scale(0.96); }
        }
      `}</style>
      <div style={{
        position: "fixed", bottom: 24, right: 24, left: "auto", transform: "none",
        display: "flex", flexDirection: "column", gap: 8, zIndex: 2000,
        pointerEvents: "none", maxWidth: "calc(100vw - 32px)",
      }}>
        {toasts.map((t) => {
          const accent = BADGE_TONES[t.tone] || BADGE_TONES.default;
          return (
            <div key={t.id} style={{
              background: "var(--z-card)",
              border: `1px solid ${accent.bd}`,
              borderLeft: `3px solid ${accent.bd}`,
              boxShadow: "var(--z-sh-lg)",
              borderRadius: "var(--z-r-md)",
              padding: "12px 16px", minWidth: 260, maxWidth: 420,
              color: "var(--z-text)", fontSize: 13, fontWeight: 600,
              animation: t.exiting
                ? `z-toast-out ${TOAST_EXIT_MS}ms ease-in forwards`
                : `z-toast-in 280ms cubic-bezier(0.34, 1.56, 0.64, 1) forwards`,
              pointerEvents: "auto",
              willChange: "transform, opacity",
            }}>
              {t.title && <div style={{ fontSize: 12, color: accent.fg, marginBottom: 2, fontWeight: 800 }}>{t.title}</div>}
              {t.msg}
            </div>
          );
        })}
      </div>
    </ToastCtx.Provider>
  );
}
export function useToast() { return useContext(ToastCtx); }

// ───────────────────────────── Table ─────────────────────────────
export function Table({ columns, rows, emptyText = "데이터 없음", striped = true, compact, onRowClick }) {
  if (!rows || rows.length === 0) {
    return <EmptyState description={emptyText} />;
  }
  return (
    <div style={{ overflowX: "auto", borderRadius: "var(--z-r-md)" }}>
      <table style={{
        width: "100%", borderCollapse: "separate", borderSpacing: 0,
        fontSize: compact ? 11 : 12, fontFamily: "var(--z-font-sans)",
      }}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} style={{
                textAlign: c.align || "left",
                padding: compact ? "8px 10px" : "10px 14px",
                fontSize: 10, fontWeight: 700, letterSpacing: 0.6,
                textTransform: "uppercase", color: "var(--z-text-3)",
                background: "var(--z-card-2)",
                borderBottom: `1px solid var(--z-border)`,
                position: "sticky", top: 0,
              }}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={r.id || i}
              onClick={() => onRowClick?.(r)}
              style={{
                background: striped && i % 2 === 1 ? "var(--z-card-2)" : "transparent",
                cursor: onRowClick ? "pointer" : undefined,
                transition: "background var(--z-dur-fast) var(--z-ease)",
              }}
            >
              {columns.map((c) => (
                <td key={c.key} style={{
                  padding: compact ? "8px 10px" : "12px 14px",
                  borderBottom: `1px solid var(--z-border)`,
                  color: "var(--z-text)", textAlign: c.align || "left",
                  fontFamily: c.mono ? "var(--z-font-mono)" : "var(--z-font-sans)",
                  fontVariantNumeric: "tabular-nums",
                  whiteSpace: c.wrap ? "normal" : "nowrap",
                }}>
                  {c.render ? c.render(r) : r[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ───────────────────────────── Section Header ─────────────────────────────
export function SectionHeader({ title, subtitle, action, icon }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      gap: 12, marginBottom: 12, padding: "2px 0", flexWrap: "wrap",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
        {icon && <div style={{ color: "var(--z-text-2)" }}>{icon}</div>}
        <div>
          <div style={{ fontSize: 16, fontWeight: 800, color: "var(--z-text)", letterSpacing: "-0.01em" }}>{title}</div>
          {subtitle && <div style={{ fontSize: 12, color: "var(--z-text-3)", marginTop: 2 }}>{subtitle}</div>}
        </div>
      </div>
      {action}
    </div>
  );
}

// ───────────────────────────── KeyValue list ─────────────────────────────
export function KV({ label, value, mono = true, color }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "8px 0", borderBottom: `1px dashed var(--z-border)`, gap: 12,
    }}>
      <span style={{ fontSize: 11, color: "var(--z-text-3)", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 700 }}>
        {label}
      </span>
      <span style={{
        fontSize: 13, fontWeight: 700, color: color || "var(--z-text)",
        fontFamily: mono ? "var(--z-font-mono)" : "var(--z-font-sans)",
        fontVariantNumeric: "tabular-nums", textAlign: "right",
      }}>{value}</span>
    </div>
  );
}

// ───────────────────────────── Progress ─────────────────────────────
export function Progress({ value = 0, max = 100, tone = "blue", height = 6, label }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const color = { blue: "var(--z-blue)", green: "var(--z-green)", red: "var(--z-red)", yellow: "var(--z-yellow)" }[tone] || "var(--z-blue)";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
      {label && (
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--z-text-3)", fontWeight: 600 }}>
          <span>{label}</span><span>{pct.toFixed(0)}%</span>
        </div>
      )}
      <div style={{
        width: "100%", height, background: "var(--z-card-hi)",
        borderRadius: height, overflow: "hidden",
      }}>
        <div style={{
          width: `${pct}%`, height: "100%", background: color,
          transition: "width var(--z-dur-slow) var(--z-ease)",
        }} />
      </div>
    </div>
  );
}

// ───────────────────────────── Segmented ─────────────────────────────
export function Segmented({ value, onChange, items, size = "md" }) {
  return (
    <div style={{
      display: "inline-flex", padding: 3,
      background: "var(--z-card-2)", border: `1px solid var(--z-border)`,
      borderRadius: "var(--z-r-sm)", gap: 2,
    }}>
      {items.map((it) => {
        const active = it.id === value;
        return (
          <button
            key={it.id}
            onClick={() => onChange?.(it.id)}
            style={{
              border: "none", cursor: "pointer",
              padding: size === "sm" ? "4px 10px" : "6px 14px",
              fontSize: size === "sm" ? 11 : 12, fontWeight: 700,
              color: active ? "var(--z-text)" : "var(--z-text-3)",
              background: active ? "var(--z-card-hi)" : "transparent",
              borderRadius: "var(--z-r-xs)",
              fontFamily: "var(--z-font-sans)",
              boxShadow: active ? "var(--z-sh-sm)" : "none",
              transition: "all var(--z-dur-fast) var(--z-ease)",
            }}
          >{it.label}</button>
        );
      })}
    </div>
  );
}
