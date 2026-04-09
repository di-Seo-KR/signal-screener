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
  const v = BTN_VARIANTS[variant] || BTN_VARIANTS.default;
  const s = BTN_SIZES[size] || BTN_SIZES.md;
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
        fontSize: s.fs,
        minHeight: s.h,
        width: fullWidth ? "100%" : undefined,
        textDecoration: variant === "link" ? "underline" : "none",
        borderRadius: "var(--z-r-md)",
        boxShadow: focus && !disabled ? "var(--z-sh-glow-blue)" : undefined,
        ...style,
      }}
      {...rest}
    >
      {loading && <Spinner size={s.fs + 2} />}
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
export function Card({ children, title, subtitle, actions, icon, tone, pad = 18, style, noBorder, onClick }) {
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
        <header style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "14px 18px", borderBottom: `1px solid var(--z-border)`, gap: 12,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            {icon && <div style={{ color: "var(--z-text-2)" }}>{icon}</div>}
            <div style={{ minWidth: 0 }}>
              {title && (
                <div style={{ fontSize: 14, fontWeight: 700, color: "var(--z-text)", letterSpacing: "-0.01em" }}>
                  {title}
                </div>
              )}
              {subtitle && (
                <div style={{ fontSize: 11, color: "var(--z-text-3)", marginTop: 2 }}>{subtitle}</div>
              )}
            </div>
          </div>
          {actions && <div style={{ display: "flex", gap: 6, alignItems: "center" }}>{actions}</div>}
        </header>
      )}
      <div style={{ padding: pad }}>{children}</div>
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
  const fs = size === "sm" ? 12 : 13;
  const pd = size === "sm" ? "8px 12px" : "10px 16px";
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
  const w = size === "sm" ? 32 : 40;
  const h = size === "sm" ? 18 : 22;
  const k = h - 4;
  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: 10, cursor: disabled ? "not-allowed" : "pointer" }}>
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
        position: "fixed", inset: 0, zIndex: 1000,
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

// ───────────────────────────── Skeleton ─────────────────────────────
export function Skeleton({ width = "100%", height = 14, rounded = 6, style }) {
  return (
    <div className="z-skel" style={{ width, height, borderRadius: rounded, ...style }} />
  );
}

// ───────────────────────────── Empty State ─────────────────────────────
export function EmptyState({ icon, title, description, action }) {
  return (
    <div style={{
      padding: "40px 20px", textAlign: "center",
      display: "flex", flexDirection: "column", alignItems: "center", gap: 10,
    }}>
      {icon && <div style={{ color: "var(--z-text-3)", opacity: 0.7 }}>{icon}</div>}
      {title && <div style={{ fontSize: 14, fontWeight: 700, color: "var(--z-text-2)" }}>{title}</div>}
      {description && (
        <div style={{ fontSize: 12, color: "var(--z-text-3)", maxWidth: 360, lineHeight: 1.6 }}>
          {description}
        </div>
      )}
      {action && <div style={{ marginTop: 6 }}>{action}</div>}
    </div>
  );
}

// ───────────────────────────── Toast ─────────────────────────────
const ToastCtx = createContext({ push: () => {} });
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((msg, opts = {}) => {
    const id = Math.random().toString(36).slice(2);
    const tone = opts.tone || "default";
    const duration = opts.duration || 3500;
    setToasts((xs) => [...xs, { id, msg, tone, title: opts.title }]);
    setTimeout(() => setToasts((xs) => xs.filter((t) => t.id !== id)), duration);
  }, []);
  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <div style={{
        position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)",
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
              padding: "10px 14px", minWidth: 260, maxWidth: 420,
              color: "var(--z-text)", fontSize: 13, fontWeight: 600,
              animation: "z-fade-in var(--z-dur) var(--z-ease)",
              pointerEvents: "auto",
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
