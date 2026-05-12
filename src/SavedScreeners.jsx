// ══════════════════════════════════════════════════════════════════
// Zepta — 저장한 스크리너 (/saved-screeners)
// ──────────────────────────────────────────────────────────────────
// 사용자가 저장한 스크리너 조건 목록.
//   - 카드: 이름, 조건 요약, 마지막 매칭, 알림 토글
//   - +추천 조건 버튼 → 4개 검증된 패턴 중 선택
//   - 클릭 시 /screener 로 이동
//   - Free 3개 제한, hint UI 표시
//
// API:
//   GET    /api/screeners/list?uid=
//   POST   /api/screeners/save        (저장/갱신/토글)
//   DELETE /api/screeners/save        (삭제)
// ══════════════════════════════════════════════════════════════════
import { useEffect, useState, useCallback, useRef } from "react";
import { useThemeTokens, FONT, RADIUS, pickFont } from "./ui/theme.jsx";
import { useBreakpoint } from "./ui/useBreakpoint.jsx";
import { BottomSheet } from "./ui/primitives.jsx";
import { useAuth } from "./AuthProvider.jsx";

const FREE_LIMIT = 3;

function summarizeConditions(conditions) {
  if (!conditions) return "조건 없음";
  const parts = [];
  if (conditions.rsi) parts.push(`RSI ${conditions.rsi.op} ${conditions.rsi.value}`);
  if (conditions.volume_ratio) parts.push(`거래량 ${conditions.volume_ratio.op} ${conditions.volume_ratio.value}배`);
  if (conditions.ma_state === "ma50_below_ma200") parts.push("MA50 < MA200");
  if (conditions.ma50_slope) parts.push(`MA50 기울기 ${conditions.ma50_slope.op} ${conditions.ma50_slope.value}`);
  if (conditions.bb_position === "lower") parts.push("BB 하단 터치");
  if (conditions.atr_ratio) parts.push(`ATR 비율 ${conditions.atr_ratio.op} ${conditions.atr_ratio.value}`);
  if (conditions.price_change_pct) parts.push(`등락 ${conditions.price_change_pct.op} ${conditions.price_change_pct.value}%`);
  return parts.length ? parts.join(" · ") : "사용자 정의";
}

function fmtAgo(iso) {
  if (!iso) return "아직 매칭 없음";
  const ms = Date.now() - Date.parse(iso);
  if (ms < 60_000) return "방금 매칭";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}분 전 매칭`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}시간 전 매칭`;
  return `${Math.floor(ms / 86_400_000)}일 전 매칭`;
}

export default function SavedScreeners({ onNavigate }) {
  const C = useThemeTokens();
  const { isMobile } = useBreakpoint();
  const { user, showToast } = useAuth();
  const uid = user?.id || "guest";

  const [screeners, setScreeners] = useState([]);
  const [suggested, setSuggested] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showSuggested, setShowSuggested] = useState(false);
  // 커스텀 confirm 모달 — 네이티브 confirm 대체
  const [confirmState, setConfirmState] = useState(null);
  // 최신 screeners 참조 (낙관적 업데이트의 length 체크에 활용)
  const screenersRef = useRef(screeners);
  useEffect(() => { screenersRef.current = screeners; }, [screeners]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/screeners/list?uid=${encodeURIComponent(uid)}`);
      const data = await r.json();
      if (data?.ok) {
        setScreeners(data.screeners || []);
        setSuggested(data.suggested || []);
      }
    } catch {} finally {
      setLoading(false);
    }
  }, [uid]);

  useEffect(() => { load(); }, [load]);

  const toggleAlert = useCallback(async (id) => {
    // 이전 상태 스냅샷 (실패 시 롤백)
    let prevState = null;
    setScreeners(prev => {
      prevState = prev;
      return prev.map(s => s.id === id ? { ...s, alert_enabled: !s.alert_enabled } : s);
    });
    try {
      const r = await fetch("/api/screeners/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uid, id, action: "toggle-alert" }),
      });
      if (!r.ok) throw new Error("toggle failed");
    } catch {
      // 롤백
      if (prevState) setScreeners(prevState);
      showToast?.("error", "알림 설정 변경에 실패했어요. 다시 시도해주세요.");
    }
  }, [uid, showToast]);

  const doRemove = useCallback(async (id) => {
    // 낙관적 제거 + 실패 시 롤백
    let prevState = null;
    setScreeners(prev => {
      prevState = prev;
      return prev.filter(s => s.id !== id);
    });
    try {
      const r = await fetch("/api/screeners/save", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uid, id }),
      });
      if (!r.ok) throw new Error("delete failed");
    } catch {
      if (prevState) setScreeners(prevState);
      showToast?.("error", "삭제에 실패했어요. 다시 시도해주세요.");
    }
  }, [uid, showToast]);

  const remove = useCallback((id) => {
    setConfirmState({
      id,
      title: "이 스크리너를 삭제할까요?",
      desc: "삭제하면 알림 발송도 함께 중단돼요. 되돌릴 수 없어요.",
    });
  }, []);

  const addSuggested = useCallback(async (s) => {
    if (screenersRef.current.length >= FREE_LIMIT) {
      showToast?.(
        "error",
        `무료 플랜은 ${FREE_LIMIT}개까지만 저장할 수 있어요. 기존 항목을 삭제하거나 Pro 로 업그레이드하세요.`,
        6000,
      );
      return;
    }
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const tempCard = {
      id: tempId,
      name: s.name,
      conditions: s.conditions,
      alert_enabled: true,
      template_id: s.template_id,
      last_matched_at: null,
      last_match_count: 0,
      _pending: true,
      _failed: false,
      _retryPayload: s,
    };

    // 1) 즉시 임시 카드 추가 — 사용자 인지 0ms
    setScreeners(prev => [tempCard, ...prev]);
    // 2) 추천 BottomSheet 닫기
    setShowSuggested(false);

    const screener = {
      name: s.name,
      conditions: s.conditions,
      alert_enabled: true,
      template_id: s.template_id,
    };

    try {
      const r = await fetch("/api/screeners/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uid, screener }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data?.ok) {
        throw new Error(data?.message || "저장 실패");
      }
      // 응답이 screener 객체를 포함하면 임시 카드 in-place 교체
      if (data?.screener?.id) {
        setScreeners(prev => prev.map(x => x.id === tempId ? data.screener : x));
      } else {
        // fallback — 풀 refetch
        await load();
      }
    } catch (err) {
      // 실패 시 임시 카드 제거 + 토스트
      setScreeners(prev => prev.filter(x => x.id !== tempId));
      showToast?.("error", err.message?.includes("FREE_LIMIT")
        ? err.message
        : "저장에 실패했어요. 다시 시도해주세요.");
    }
  }, [uid, load, showToast]);

  const isGuest = !uid || uid === "guest";
  const remaining = FREE_LIMIT - screeners.length;

  return (
    <div style={{ maxWidth: 920, margin: "0 auto", padding: 16 }}>
      {/* 헤더 */}
      <div style={{
        background: `linear-gradient(135deg, ${C.purpleBg} 0%, ${C.card} 100%)`,
        borderRadius: RADIUS["3xl"],
        padding: 24,
        marginBottom: 16,
        border: `1px solid ${C.border}`,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: FONT["2xl"], fontWeight: 900, color: C.text1 }}>📌 저장한 스크리너</div>
            <div style={{ fontSize: FONT.sm, color: C.text2, marginTop: 4 }}>
              관심 조건을 저장하면 매칭되는 종목이 생길 때 알림이 와요
            </div>
          </div>
          <button onClick={() => setShowSuggested(true)} style={{
            padding: isMobile ? "14px 18px" : "10px 18px",
            minHeight: 48,
            borderRadius: RADIUS.md,
            background: C.purple, color: "#fff", border: "none",
            fontWeight: 700,
            fontSize: pickFont("button", isMobile) ?? FONT.sm,
            cursor: "pointer",
            width: isMobile ? "100%" : undefined,
          }}>+ 추천 조건 추가</button>
        </div>

        {/* Free hint */}
        <div style={{
          marginTop: 16, padding: 10,
          background: C.card2, borderRadius: RADIUS.md,
          fontSize: FONT.xs, color: C.text2,
          display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap",
        }}>
          <span>
            <strong style={{ color: C.text1 }}>무료 플랜</strong>: 최대 {FREE_LIMIT}개 저장 ·
            현재 <strong style={{ color: remaining > 0 ? C.green : C.red }}>{screeners.length} / {FREE_LIMIT}</strong>
          </span>
          <span style={{ color: C.text3 }}>Pro 로 업그레이드하면 무제한 (곧 출시)</span>
        </div>
      </div>

      {/* 콘텐츠 */}
      {loading ? (
        <EmptyBox C={C} title="불러오는 중…" />
      ) : isGuest ? (
        <EmptyBox C={C} icon="🔐"
          title="로그인 후 저장할 수 있어요"
          desc="로그인하면 조건을 저장하고 매칭 시 알림을 받으실 수 있습니다." />
      ) : screeners.length === 0 ? (
        <EmptyBox C={C} icon="✨"
          title="저장된 스크리너가 없어요"
          desc="추천 조건 4개 중 마음에 드는 것을 골라 시작해보세요."
          action={
            <button onClick={() => setShowSuggested(true)} style={{
              padding: "10px 18px", borderRadius: RADIUS.md,
              background: C.purple, color: "#fff", border: "none",
              fontWeight: 700, fontSize: FONT.sm, cursor: "pointer", marginTop: 12,
            }}>+ 추천 조건 보기</button>
          }
        />
      ) : (
        <div style={{
          display: "grid",
          gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill, minmax(280px, 1fr))",
          gap: 12,
        }}>
          {screeners.map(s => (
            <ScreenerCard
              key={s.id}
              s={s}
              C={C}
              isMobile={isMobile}
              onToggleAlert={() => toggleAlert(s.id)}
              onRemove={() => remove(s.id)}
              onOpen={() => onNavigate && onNavigate("screener")}
            />
          ))}
        </div>
      )}

      {/* 추천 조건 — 모바일 BottomSheet (가로 chip 미리보기도 시각) */}
      {showSuggested && (
        <SuggestedModal
          C={C}
          isMobile={isMobile}
          suggested={suggested}
          remaining={remaining}
          onClose={() => setShowSuggested(false)}
          onAdd={addSuggested}
        />
      )}

      {/* 삭제 확인 모달 — 네이티브 confirm 대체 */}
      {confirmState && (
        <ConfirmModal
          C={C}
          isMobile={isMobile}
          title={confirmState.title}
          desc={confirmState.desc}
          confirmLabel="삭제"
          cancelLabel="취소"
          danger
          onConfirm={() => {
            const id = confirmState.id;
            setConfirmState(null);
            doRemove(id);
          }}
          onCancel={() => setConfirmState(null)}
        />
      )}
    </div>
  );
}

function ScreenerCard({ s, C, isMobile, onToggleAlert, onRemove, onOpen }) {
  const pending = !!s._pending;
  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`,
      borderRadius: RADIUS.xl, padding: 16,
      boxShadow: C.cardShadow,
      display: "flex", flexDirection: "column", gap: 10,
      opacity: pending ? 0.7 : 1,
      position: "relative",
      transition: "opacity 0.2s ease",
      pointerEvents: pending ? "none" : "auto",
    }}>
      {pending && (
        <div style={{
          position: "absolute", top: 8, right: 12,
          fontSize: FONT.xs, color: C.purple, fontWeight: 700,
          display: "flex", alignItems: "center", gap: 4,
          background: C.purpleBg, padding: "2px 8px", borderRadius: RADIUS.full,
          border: `1px solid ${C.purple}55`,
        }}>
          <span style={{
            display: "inline-block", width: 6, height: 6, borderRadius: "50%",
            background: C.purple, animation: "z-pulse 1.2s ease-in-out infinite",
          }} />
          저장 중…
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: FONT.base, fontWeight: 800, color: C.text1, marginBottom: 4 }}>{s.name}</div>
          <div style={{ fontSize: FONT.xs, color: C.text3, lineHeight: 1.5 }}>{summarizeConditions(s.conditions)}</div>
        </div>
        <button onClick={onRemove} disabled={pending} style={{
          background: "none", border: "none", color: C.text3,
          fontSize: 20, cursor: pending ? "not-allowed" : "pointer", padding: 8,
          minWidth: 44, minHeight: 44, opacity: pending ? 0.4 : 1,
        }} title="삭제">🗑</button>
      </div>

      <div style={{
        padding: "10px 12px", background: C.card2, borderRadius: RADIUS.sm,
        fontSize: FONT.xs, color: C.text2,
      }}>
        {s.last_matched_at
          ? `${fmtAgo(s.last_matched_at)} · ${s.last_match_count}개 종목`
          : "아직 매칭된 종목이 없어요"}
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between" }}>
        {/* 알림 토글 — 큰 터치 영역 */}
        <label style={{
          display: "flex", alignItems: "center", gap: 10,
          cursor: "pointer", minHeight: 44, padding: "4px 0",
        }}>
          <span style={{
            position: "relative", display: "inline-block",
            width: 44, height: 24,
          }}>
            <input type="checkbox" checked={s.alert_enabled} onChange={onToggleAlert}
              style={{ opacity: 0, width: 0, height: 0 }} />
            <span style={{
              position: "absolute", inset: 0, borderRadius: 12,
              background: s.alert_enabled ? C.green : C.border2, transition: "0.15s",
            }} />
            <span style={{
              position: "absolute", top: 2, left: s.alert_enabled ? 22 : 2,
              width: 20, height: 20, borderRadius: "50%", background: "#fff",
              transition: "0.15s", boxShadow: "0 2px 4px rgba(0,0,0,0.2)",
            }} />
          </span>
          <span style={{ fontSize: FONT.sm, color: C.text2, fontWeight: 600 }}>
            {s.alert_enabled ? "🔔 알림 ON" : "🔕 알림 OFF"}
          </span>
        </label>
        <button onClick={onOpen} style={{
          padding: isMobile ? "10px 14px" : "6px 12px",
          minHeight: 44,
          borderRadius: RADIUS.sm,
          background: C.blueBg, color: C.blueL, border: `1px solid ${C.blue}40`,
          fontSize: pickFont("button", isMobile) ?? FONT.xs,
          fontWeight: 700, cursor: "pointer",
        }}>스크리너 열기 →</button>
      </div>
    </div>
  );
}

function SuggestedModal({ C, isMobile, suggested, remaining, onClose, onAdd }) {
  const body = suggested.length === 0 ? (
    <div style={{ padding: "32px 0", textAlign: "center", color: C.text3 }}>
      ✅ 추천 조건을 모두 추가하셨네요!
    </div>
  ) : (
    <>
      {/* 모바일: 가로 chip 스크롤 미리보기 */}
      {isMobile && (
        <div style={{
          display: "flex", gap: 8, overflowX: "auto",
          flexWrap: "nowrap", paddingBottom: 8, marginBottom: 12,
          WebkitOverflowScrolling: "touch", scrollbarWidth: "none",
          scrollSnapType: "x mandatory",
        }}>
          {suggested.map(s => (
            <button
              key={`chip-${s.template_id}`}
              onClick={() => onAdd(s)}
              disabled={remaining <= 0}
              style={{
                padding: "8px 14px", minHeight: 36, flexShrink: 0,
                background: remaining > 0 ? C.purpleBg : C.card2,
                color: remaining > 0 ? C.purple : C.text3,
                border: `1px solid ${remaining > 0 ? C.purple + "55" : C.border}`,
                borderRadius: RADIUS.full,
                fontSize: FONT.sm, fontWeight: 700,
                cursor: remaining > 0 ? "pointer" : "not-allowed",
                whiteSpace: "nowrap",
                scrollSnapAlign: "start",
              }}
            >+ {s.name}</button>
          ))}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {suggested.map(s => (
          <div key={s.template_id} style={{
            background: C.card2, border: `1px solid ${C.border}`,
            borderRadius: RADIUS.lg, padding: 14,
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: FONT.base, fontWeight: 700, color: C.text1, marginBottom: 4 }}>
                  {s.name}
                </div>
                <div style={{ fontSize: FONT.sm, color: C.text2, marginBottom: 4 }}>{s.summary}</div>
                <div style={{ fontSize: FONT.xs, color: C.text3, lineHeight: 1.5 }}>{s.description}</div>
              </div>
              <button onClick={() => onAdd(s)} disabled={remaining <= 0} style={{
                padding: isMobile ? "10px 14px" : "6px 12px",
                minHeight: 44,
                borderRadius: RADIUS.sm,
                background: remaining > 0 ? C.purple : C.card,
                color: remaining > 0 ? "#fff" : C.text3,
                border: "none",
                fontSize: pickFont("button", isMobile) ?? FONT.xs,
                fontWeight: 700,
                cursor: remaining > 0 ? "pointer" : "not-allowed",
                whiteSpace: "nowrap", flexShrink: 0,
              }}>+ 추가</button>
            </div>
          </div>
        ))}
      </div>
    </>
  );

  if (isMobile) {
    return (
      <BottomSheet
        open={true}
        onClose={onClose}
        title="✨ 추천 스크리너"
        description={`검증된 4개 패턴 · 남은 슬롯 ${remaining}개`}
        maxHeight="88vh"
      >
        {body}
      </BottomSheet>
    );
  }

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 11000,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: C.card, border: `1px solid ${C.border}`, borderRadius: RADIUS["2xl"],
        padding: 24, maxWidth: 560, width: "100%", maxHeight: "90vh", overflow: "auto",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: FONT.xl, fontWeight: 800, color: C.text1 }}>✨ 추천 스크리너</div>
            <div style={{ fontSize: FONT.xs, color: C.text3, marginTop: 2 }}>
              검증된 4개 패턴 · 남은 슬롯 {remaining}개
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: C.text2, fontSize: 22, cursor: "pointer" }}>✕</button>
        </div>
        {body}
      </div>
    </div>
  );
}

function ConfirmModal({ C, isMobile, title, desc, confirmLabel = "확인", cancelLabel = "취소", danger = false, onConfirm, onCancel }) {
  // ESC 키 처리 + body scroll 잠금
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onCancel?.(); };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onCancel]);

  const confirmColor = danger ? C.red : C.blue;

  return (
    <div
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 10000,
        display: "flex", alignItems: isMobile ? "flex-end" : "center", justifyContent: "center",
        padding: isMobile ? 0 : 16,
      }}
    >
      <div onClick={e => e.stopPropagation()} style={{
        background: C.card, border: `1px solid ${C.border}`,
        borderRadius: isMobile ? `${RADIUS.xl} ${RADIUS.xl} 0 0` : RADIUS["2xl"],
        padding: 24, maxWidth: 420, width: "100%",
        boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
      }}>
        <div style={{ fontSize: FONT.lg, fontWeight: 800, color: C.text1, marginBottom: 8 }}>
          {title}
        </div>
        {desc && (
          <div style={{ fontSize: FONT.sm, color: C.text2, marginBottom: 20, lineHeight: 1.55 }}>
            {desc}
          </div>
        )}
        <div style={{ display: "flex", gap: 8, flexDirection: isMobile ? "column-reverse" : "row", justifyContent: "flex-end" }}>
          <button
            onClick={onCancel}
            style={{
              padding: isMobile ? "14px 20px" : "10px 18px",
              minHeight: 48,
              borderRadius: RADIUS.md,
              background: C.card2, color: C.text1,
              border: `1px solid ${C.border}`,
              fontSize: FONT.sm, fontWeight: 600, cursor: "pointer",
              flex: isMobile ? 1 : "0 0 auto",
            }}
          >{cancelLabel}</button>
          <button
            onClick={onConfirm}
            autoFocus
            style={{
              padding: isMobile ? "14px 20px" : "10px 18px",
              minHeight: 48,
              borderRadius: RADIUS.md,
              background: confirmColor, color: "#fff",
              border: "none",
              fontSize: FONT.sm, fontWeight: 700, cursor: "pointer",
              flex: isMobile ? 1 : "0 0 auto",
            }}
          >{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

function EmptyBox({ C, icon = "📭", title, desc, action }) {
  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg,
      padding: "48px 24px", textAlign: "center",
    }}>
      <div style={{ fontSize: 40, marginBottom: 8 }}>{icon}</div>
      <div style={{ fontSize: FONT.lg, fontWeight: 700, color: C.text1, marginBottom: 4 }}>{title}</div>
      {desc && <div style={{ fontSize: FONT.sm, color: C.text3 }}>{desc}</div>}
      {action}
    </div>
  );
}
