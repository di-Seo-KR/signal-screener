// ══════════════════════════════════════════════════════════════════
// Zepta — BottomSheet / ActionSheet / Stepper (모바일 우선 컴포넌트)
//
// iPhone 16 (393pt) 기준 설계.
// • BottomSheet : 모바일 Modal 대체 (iOS 네이티브 패턴)
// • ActionSheet : 옵션 리스트 (정렬/필터/언어 선택 등) — iOS Action Sheet
// • Stepper     : 1/N 진행도 표시 (온보딩 5스텝 등)
//
// 사용 예시는 각 컴포넌트 doc-comment 참조.
// ══════════════════════════════════════════════════════════════════
import React, { useEffect, useRef, useState, useCallback } from "react";
import { Cross } from "./icons.jsx";

// ─────────────────────────────────────────────────────────────────
// BottomSheet
// ─────────────────────────────────────────────────────────────────
/**
 * 모바일 우선 시트. 화면 하단에서 슬라이드 업.
 *
 * Props:
 *  - open        : boolean
 *  - onClose     : () => void
 *  - title       : 헤더 제목 (선택)
 *  - description : 헤더 부제 (선택)
 *  - children    : 시트 본문 (scroll 가능)
 *  - footer      : sticky 하단 액션 영역 (선택, 보통 Button)
 *  - maxHeight   : "70vh" 등 (기본 "85vh")
 *  - draggable   : true 면 드래그-다운으로 닫기 (기본 true)
 *  - dismissOnBackdrop : true 면 backdrop 클릭으로 닫기 (기본 true)
 *
 * 동작:
 *  • Escape 키로 닫힘
 *  • backdrop 클릭으로 닫힘 (옵션)
 *  • 드래그 다운 60px 초과 시 닫힘
 *  • safe-area-inset-bottom 자동 추가 (홈 인디케이터 영역 회피)
 *  • body scroll lock (open 동안)
 */
export function BottomSheet({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  maxHeight = "85vh",
  draggable = true,
  dismissOnBackdrop = true,
}) {
  const sheetRef = useRef(null);
  const startYRef = useRef(null);
  const [dragY, setDragY] = useState(0);

  // ESC 키
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && onClose?.();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Body scroll lock
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  // 드래그 핸들러
  const onTouchStart = useCallback((e) => {
    if (!draggable) return;
    startYRef.current = e.touches[0].clientY;
  }, [draggable]);

  const onTouchMove = useCallback((e) => {
    if (!draggable || startYRef.current == null) return;
    const dy = e.touches[0].clientY - startYRef.current;
    if (dy > 0) setDragY(dy);
  }, [draggable]);

  const onTouchEnd = useCallback(() => {
    if (!draggable) return;
    if (dragY > 60) onClose?.();
    setDragY(0);
    startYRef.current = null;
  }, [draggable, dragY, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? "bs-title" : undefined}
      style={{
        // E-4 — 모바일 하단 nav (10000) 위로 올림. 토스트(99999) > Modal(11000) > nav(10000)
        position: "fixed", inset: 0, zIndex: 11000,
        background: "rgba(4, 8, 16, 0.6)",
        backdropFilter: "blur(2px)",
        display: "flex", alignItems: "flex-end", justifyContent: "center",
        animation: "z-fade-in var(--z-dur) var(--z-ease)",
      }}
      onClick={dismissOnBackdrop ? onClose : undefined}
    >
      <div
        ref={sheetRef}
        onClick={(e) => e.stopPropagation()}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        style={{
          width: "100%",
          maxWidth: 640,
          background: "var(--z-card)",
          borderTopLeftRadius: "var(--z-r-xl)",
          borderTopRightRadius: "var(--z-r-xl)",
          boxShadow: "var(--z-sh-lg)",
          maxHeight,
          // safe-area-inset-bottom 자동 반영 — 홈 인디케이터(34pt) 회피
          paddingBottom: "var(--z-safe-bottom)",
          display: "flex", flexDirection: "column",
          transform: dragY ? `translateY(${dragY}px)` : "translateY(0)",
          transition: dragY ? "none" : "transform var(--z-dur) var(--z-ease)",
          animation: "z-sheet-up 260ms var(--z-ease)",
          overflow: "hidden",
        }}
      >
        <style>{`
          @keyframes z-sheet-up {
            from { transform: translateY(100%); }
            to   { transform: translateY(0); }
          }
        `}</style>

        {/* drag handle (시각적 affordance) */}
        {draggable && (
          <div style={{ display: "flex", justifyContent: "center", padding: "8px 0 4px" }}>
            <div style={{
              width: 36, height: 4, borderRadius: 999,
              background: "var(--z-border-2)",
            }} />
          </div>
        )}

        {/* 헤더 */}
        {(title || description) && (
          <header style={{
            display: "flex", alignItems: "flex-start", gap: 12,
            padding: "12px 18px 8px",
            borderBottom: title ? `1px solid var(--z-border)` : "none",
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              {title && (
                <div id="bs-title" style={{
                  fontSize: 17, fontWeight: 800,
                  color: "var(--z-text)", letterSpacing: "-0.01em",
                }}>{title}</div>
              )}
              {description && (
                <div style={{
                  marginTop: 4, fontSize: 13,
                  color: "var(--z-text-2)", lineHeight: 1.5,
                }}>{description}</div>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="닫기"
              style={{
                background: "transparent", border: "none",
                color: "var(--z-text-3)", cursor: "pointer",
                width: 44, height: 44, // WCAG 2.5.5
                display: "flex", alignItems: "center", justifyContent: "center",
                borderRadius: "var(--z-r-sm)", flexShrink: 0,
              }}
            ><Cross size={20} /></button>
          </header>
        )}

        {/* 본문 (scroll 가능) */}
        <div style={{
          flex: 1, overflowY: "auto", padding: "12px 18px 16px",
          WebkitOverflowScrolling: "touch",
          overscrollBehavior: "contain",
        }}>
          {children}
        </div>

        {/* 하단 sticky 액션 */}
        {footer && (
          <div style={{
            padding: "12px 18px",
            borderTop: `1px solid var(--z-border)`,
            background: "var(--z-card)",
            display: "flex", gap: 8, flexWrap: "wrap",
          }}>{footer}</div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// ActionSheet — iOS 패턴 (옵션 리스트)
// ─────────────────────────────────────────────────────────────────
/**
 * 옵션 리스트를 하단 시트로 표시 (정렬 선택, 필터 선택, 언어 선택 등).
 *
 * Props:
 *  - open    : boolean
 *  - onClose : () => void
 *  - title   : 제목 (선택)
 *  - items   : [{ id, label, icon?, tone?, disabled?, onSelect? }, ...]
 *              tone: "default" | "danger" — 빨강은 위험한 액션 (삭제 등)
 *  - value   : 현재 선택값 (체크 표시용, 선택)
 *  - cancelLabel : "취소" 버튼 라벨 (기본 "취소")
 *
 * 사용:
 *   <ActionSheet
 *     open={open} onClose={close}
 *     title="정렬 방식"
 *     items={[
 *       { id: "asc", label: "오름차순", onSelect: () => setSort("asc") },
 *       { id: "desc", label: "내림차순", onSelect: () => setSort("desc") },
 *     ]}
 *     value={sort}
 *   />
 */
export function ActionSheet({
  open,
  onClose,
  title,
  items = [],
  value,
  cancelLabel = "취소",
}) {
  // ESC + scroll lock 은 BottomSheet 와 동일 패턴 (중복 회피 위해 별도 구현)
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && onClose?.();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        // E-4 — ActionSheet 도 BottomSheet 와 동일 정책 (nav 10000 위)
        position: "fixed", inset: 0, zIndex: 11000,
        background: "rgba(4, 8, 16, 0.5)",
        display: "flex", alignItems: "flex-end", justifyContent: "center",
        padding: "0 8px",
        paddingBottom: "calc(8px + var(--z-safe-bottom))",
        animation: "z-fade-in var(--z-dur) var(--z-ease)",
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: 480,
          display: "flex", flexDirection: "column", gap: 8,
          animation: "z-action-up 240ms var(--z-ease)",
        }}
      >
        <style>{`
          @keyframes z-action-up {
            from { transform: translateY(40px); opacity: 0; }
            to   { transform: translateY(0); opacity: 1; }
          }
        `}</style>

        {/* 옵션 그룹 */}
        <div style={{
          background: "var(--z-card)",
          borderRadius: "var(--z-r-lg)",
          overflow: "hidden",
          boxShadow: "var(--z-sh-lg)",
        }}>
          {title && (
            <div style={{
              padding: "12px 16px",
              fontSize: 12, fontWeight: 600,
              color: "var(--z-text-3)",
              textAlign: "center",
              borderBottom: `1px solid var(--z-border)`,
              letterSpacing: 0.2,
            }}>{title}</div>
          )}
          {items.map((it, idx) => {
            const isDanger = it.tone === "danger";
            const isSelected = value != null && value === it.id;
            return (
              <button
                key={it.id ?? idx}
                type="button"
                disabled={it.disabled}
                onClick={() => {
                  it.onSelect?.();
                  onClose?.();
                }}
                style={{
                  width: "100%", border: "none",
                  background: "transparent",
                  padding: "16px 16px",
                  minHeight: 52, // 44 + 여유
                  fontSize: 16, fontWeight: 600,
                  color: isDanger ? "var(--z-red-hi)" : "var(--z-text)",
                  cursor: it.disabled ? "not-allowed" : "pointer",
                  opacity: it.disabled ? 0.5 : 1,
                  display: "flex", alignItems: "center", gap: 12,
                  borderTop: idx > 0 ? `1px solid var(--z-border)` : "none",
                  fontFamily: "var(--z-font-sans)",
                  transition: "background var(--z-dur-fast) var(--z-ease)",
                  textAlign: "left",
                }}
                onTouchStart={(e) => { e.currentTarget.style.background = "var(--z-card-hi)"; }}
                onTouchEnd={(e) => { e.currentTarget.style.background = "transparent"; }}
              >
                {it.icon && <span style={{ color: isDanger ? "var(--z-red-hi)" : "var(--z-text-2)" }}>{it.icon}</span>}
                <span style={{ flex: 1 }}>{it.label}</span>
                {isSelected && (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
                    stroke="var(--z-blue-hi)" strokeWidth="2.5"
                    strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12l5 5L20 7" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>

        {/* 취소 (iOS 패턴 — 별도 그룹) */}
        <button
          type="button"
          onClick={onClose}
          style={{
            width: "100%", border: "none",
            background: "var(--z-card)",
            padding: "16px 16px",
            minHeight: 52,
            fontSize: 16, fontWeight: 700,
            color: "var(--z-text)",
            cursor: "pointer",
            borderRadius: "var(--z-r-lg)",
            boxShadow: "var(--z-sh-lg)",
            fontFamily: "var(--z-font-sans)",
          }}
        >{cancelLabel}</button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Stepper — 1/N 진행도 표시
// ─────────────────────────────────────────────────────────────────
/**
 * 온보딩 등 단계 진행 인디케이터.
 *
 * Props:
 *  - current     : 현재 step (1-indexed)
 *  - total       : 전체 step 수
 *  - orientation : "horizontal" | "vertical" (기본 horizontal)
 *  - showLabel   : "1/5" 텍스트 표시 (기본 true)
 *  - labels      : ["기본", "프로필", ...] — 각 step 라벨 (선택)
 *  - onStepClick : (idx) => void — 이미 지나간 step 클릭 시 이동 (선택)
 *
 * 사용:
 *   <Stepper current={2} total={5} />
 *   <Stepper current={3} total={5} labels={["환영","계좌","목표","리스크","완료"]} />
 */
export function Stepper({
  current = 1,
  total = 5,
  orientation = "horizontal",
  showLabel = true,
  labels,
  onStepClick,
}) {
  const isV = orientation === "vertical";
  const steps = Array.from({ length: total }, (_, i) => i + 1);

  return (
    <div style={{
      display: "flex",
      flexDirection: isV ? "column" : "row",
      alignItems: isV ? "stretch" : "center",
      gap: isV ? 0 : 8,
      width: "100%",
    }}>
      {showLabel && !isV && (
        <div style={{
          fontSize: 12, fontWeight: 700,
          color: "var(--z-text-3)",
          fontVariantNumeric: "tabular-nums",
          marginRight: 8,
          minWidth: 32,
        }}>{current}/{total}</div>
      )}

      <div style={{
        display: "flex",
        flexDirection: isV ? "column" : "row",
        alignItems: isV ? "flex-start" : "center",
        gap: isV ? 12 : 0,
        flex: 1,
        width: "100%",
      }}>
        {steps.map((step, idx) => {
          const isActive = step === current;
          const isDone = step < current;
          const isClickable = onStepClick && isDone;
          const dotColor = isActive
            ? "var(--z-blue)"
            : isDone
              ? "var(--z-blue-hi)"
              : "var(--z-border-2)";
          const dotSize = isActive ? 10 : 8;

          return (
            <React.Fragment key={step}>
              <div style={{
                display: "flex",
                flexDirection: isV ? "row" : "column",
                alignItems: "center",
                gap: isV ? 12 : 4,
                cursor: isClickable ? "pointer" : "default",
                minHeight: isClickable ? 44 : undefined,
                padding: isClickable ? "0 4px" : 0,
              }}
                onClick={() => isClickable && onStepClick(step)}
                role={isClickable ? "button" : undefined}
                aria-current={isActive ? "step" : undefined}
                aria-label={labels?.[idx] ? `${labels[idx]} (${step}/${total})` : `Step ${step}/${total}`}
              >
                <span style={{
                  width: dotSize, height: dotSize,
                  borderRadius: "50%",
                  background: dotColor,
                  transition: "all var(--z-dur) var(--z-ease)",
                  boxShadow: isActive ? "0 0 0 3px rgba(59,130,246,0.20)" : "none",
                  flexShrink: 0,
                }} />
                {labels?.[idx] && (
                  <span style={{
                    fontSize: 12,
                    fontWeight: isActive ? 700 : 500,
                    color: isActive ? "var(--z-text)" : "var(--z-text-3)",
                    whiteSpace: "nowrap",
                  }}>{labels[idx]}</span>
                )}
              </div>
              {idx < steps.length - 1 && (
                <span style={{
                  flex: isV ? "0 0 auto" : 1,
                  height: isV ? 16 : 2,
                  width: isV ? 2 : "auto",
                  margin: isV ? "0 0 0 4px" : "0 4px",
                  background: isDone ? "var(--z-blue-hi)" : "var(--z-border-2)",
                  transition: "background var(--z-dur) var(--z-ease)",
                }} />
              )}
            </React.Fragment>
          );
        })}
      </div>

      {showLabel && isV && (
        <div style={{
          fontSize: 12, fontWeight: 700,
          color: "var(--z-text-3)",
          fontVariantNumeric: "tabular-nums",
          marginTop: 8,
        }}>{current}/{total}</div>
      )}
    </div>
  );
}
