// ══════════════════════════════════════════════════════════════════
// Zepta — 통합 알림 센터 (/notifications)
// ──────────────────────────────────────────────────────────────────
// 모든 알림 종류를 한 곳에서 봅니다.
//   - category: price · signal · news · portfolio · screener · system
//   - 필터: 카테고리 · 읽음 상태 · 우선순위
//   - 알림 클릭 → 해당 페이지로 이동 (link 필드 활용)
//   - 알림 설정 모달: 임계값 + 채널 (텔레그램/이메일/앱푸시)
//
// 데이터 흐름:
//   GET  /api/notifications/list?uid=<uid>
//   POST /api/notifications/list   (read / clear)
//   GET  /api/notifications/preferences?uid=<uid>
//   POST /api/notifications/preferences
//
// 로그인 안된 게스트는 KV uid 가 "guest" 라서 데이터가 비어 보이게 됨.
// 그래서 빈 상태에서는 "로그인 안내" 메시지 표시.
// ══════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useState, useCallback } from "react";
import { useThemeTokens, FONT, RADIUS, pickFont } from "./ui/theme.jsx";
import { useBreakpoint } from "./ui/useBreakpoint.jsx";
import { BottomSheet } from "./ui/primitives.jsx";
import { useAuth } from "./AuthProvider.jsx";

const REFRESH_MS = 30_000;

const CATEGORY_META = {
  price:     { icon: "💰", label: "가격",   color: "blue" },
  signal:    { icon: "📈", label: "시그널", color: "green" },
  news:      { icon: "📰", label: "뉴스",   color: "purple" },
  portfolio: { icon: "📊", label: "포트폴리오", color: "orange" },
  screener:  { icon: "🎯", label: "스크리너", color: "blue" },
  system:    { icon: "⚙️", label: "시스템", color: "default" },
};

const PRIORITY_META = {
  high:   { label: "긴급", color: "red" },
  medium: { label: "보통", color: "yellow" },
  low:    { label: "참고", color: "default" },
};

function fmtAgo(iso) {
  if (!iso) return "—";
  const ms = Date.now() - Date.parse(iso);
  if (ms < 60_000) return "방금";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}분 전`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}시간 전`;
  return `${Math.floor(ms / 86_400_000)}일 전`;
}

export default function NotificationHub({ onNavigate }) {
  const C = useThemeTokens();
  const { isMobile } = useBreakpoint();
  const { user } = useAuth();
  const uid = user?.id || "guest";

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all"); // all | unread | priority:high | category:<k>
  const [showSettings, setShowSettings] = useState(false);
  const [visibleCount, setVisibleCount] = useState(20);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/notifications/list?uid=${encodeURIComponent(uid)}&limit=100`);
      const data = await r.json();
      if (data?.ok) setItems(data.notifications || []);
    } catch (e) {
      console.warn("[NotificationHub] load failed:", e);
    } finally {
      setLoading(false);
    }
  }, [uid]);

  useEffect(() => {
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  const markRead = useCallback(async (id) => {
    setItems(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
    try {
      await fetch("/api/notifications/list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uid, action: "read", id }),
      });
    } catch {}
  }, [uid]);

  const markAllRead = useCallback(async () => {
    setItems(prev => prev.map(n => ({ ...n, read: true })));
    try {
      await fetch("/api/notifications/list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uid, action: "read-all" }),
      });
    } catch {}
  }, [uid]);

  const clearAll = useCallback(async () => {
    if (!confirm("모든 알림을 삭제할까요?")) return;
    setItems([]);
    try {
      await fetch("/api/notifications/list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uid, action: "clear" }),
      });
    } catch {}
  }, [uid]);

  const filtered = useMemo(() => {
    if (filter === "all") return items;
    if (filter === "unread") return items.filter(n => !n.read);
    if (filter.startsWith("priority:")) {
      const p = filter.split(":")[1];
      return items.filter(n => n.priority === p);
    }
    if (filter.startsWith("category:")) {
      const c = filter.split(":")[1];
      return items.filter(n => n.category === c);
    }
    return items;
  }, [items, filter]);

  const unreadCount = items.filter(n => !n.read).length;

  const handleClick = useCallback((n) => {
    if (!n.read) markRead(n.id);
    if (n.link && onNavigate) {
      const tab = n.link.replace(/^\//, "");
      onNavigate(tab);
    }
  }, [markRead, onNavigate]);

  return (
    <div style={{ maxWidth: 920, margin: "0 auto", padding: "16px" }}>
      {/* 헤더 */}
      <div style={{
        background: `linear-gradient(135deg, ${C.blueBg} 0%, ${C.card} 100%)`,
        borderRadius: RADIUS["3xl"],
        padding: "24px",
        marginBottom: "16px",
        border: `1px solid ${C.border}`,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: FONT["2xl"], fontWeight: 900, color: C.text1 }}>🔔 알림 센터</div>
            <div style={{ fontSize: FONT.sm, color: C.text2, marginTop: 4 }}>
              가격·시그널·뉴스·포트폴리오·스크리너 알림을 한 곳에서 확인하세요
              {unreadCount > 0 && (
                <span style={{ marginLeft: 8, padding: "2px 8px", background: C.red, color: "#fff",
                  borderRadius: RADIUS.full, fontSize: FONT.xs, fontWeight: 700 }}>
                  안 읽음 {unreadCount}
                </span>
              )}
            </div>
          </div>
          <button onClick={() => setShowSettings(true)} style={{
            padding: isMobile ? "12px 16px" : "8px 16px",
            minHeight: 44,
            borderRadius: RADIUS.md,
            background: C.card, color: C.text1, border: `1px solid ${C.border2}`,
            fontWeight: 600,
            fontSize: pickFont("button", isMobile) ?? FONT.sm,
            cursor: "pointer",
          }}>⚙️ 알림 설정</button>
        </div>
      </div>

      {/* 필터 — 모바일은 가로 스크롤 */}
      <div style={{
        display: "flex", gap: 8, alignItems: "center", marginBottom: 12,
        flexWrap: isMobile ? "nowrap" : "wrap",
        overflowX: isMobile ? "auto" : undefined,
        scrollSnapType: isMobile ? "x mandatory" : undefined,
        WebkitOverflowScrolling: "touch",
        scrollbarWidth: "none",
        paddingBottom: isMobile ? 2 : 0,
      }}>
        <FilterChip C={C} active={filter === "all"} onClick={() => setFilter("all")} isMobile={isMobile}>전체</FilterChip>
        <FilterChip C={C} active={filter === "unread"} onClick={() => setFilter("unread")} isMobile={isMobile}>
          안 읽음 {unreadCount > 0 && `(${unreadCount})`}
        </FilterChip>
        <FilterChip C={C} active={filter === "priority:high"} onClick={() => setFilter("priority:high")} isMobile={isMobile}>🚨 긴급</FilterChip>
        {Object.entries(CATEGORY_META).map(([k, m]) => (
          <FilterChip key={k} C={C} active={filter === `category:${k}`} onClick={() => setFilter(`category:${k}`)} isMobile={isMobile}>
            {m.icon} {m.label}
          </FilterChip>
        ))}
      </div>

      {/* 액션 (모두 읽음, 전체 삭제) — 모바일은 별도 줄 */}
      {(unreadCount > 0 || items.length > 0) && (
        <div style={{ display: "flex", gap: 8, justifyContent: isMobile ? "stretch" : "flex-end", marginBottom: 10 }}>
          {unreadCount > 0 && (
            <button onClick={markAllRead} style={btnGhost(C, isMobile)}>모두 읽음</button>
          )}
          {items.length > 0 && (
            <button onClick={clearAll} style={btnGhost(C, isMobile)}>전체 삭제</button>
          )}
        </div>
      )}

      {/* 리스트 */}
      {loading ? (
        <EmptyBox C={C} title="불러오는 중…" />
      ) : !uid || uid === "guest" ? (
        <EmptyBox
          C={C}
          icon="🔐"
          title="로그인 후 알림을 받으실 수 있어요"
          desc="로그인하면 시그널·가격·뉴스 알림이 이 페이지에 누적됩니다."
        />
      ) : filtered.length === 0 ? (
        <EmptyBox
          C={C}
          icon="🌙"
          title={items.length === 0 ? "아직 받은 알림이 없어요" : "이 필터에 해당하는 알림이 없어요"}
          desc={items.length === 0
            ? "관심 종목을 등록하고 알림 설정을 켜면 여기로 메시지가 도착합니다."
            : "다른 필터를 선택해 보세요."}
        />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {filtered.slice(0, visibleCount).map(n => (
            <NotificationCard key={n.id} n={n} C={C} isMobile={isMobile} onClick={() => handleClick(n)} />
          ))}
          {filtered.length > visibleCount && (
            <button
              onClick={() => setVisibleCount(c => c + 20)}
              style={{
                marginTop: 4,
                padding: isMobile ? "14px 16px" : "10px 16px",
                minHeight: 48,
                width: "100%",
                background: C.card2, border: `1px solid ${C.border}`,
                borderRadius: RADIUS.md,
                color: C.text2,
                fontSize: pickFont("button", isMobile) ?? FONT.sm, fontWeight: 700,
                cursor: "pointer",
              }}
            >
              더보기 ({filtered.length - visibleCount}건)
            </button>
          )}
        </div>
      )}

      {showSettings && (
        <SettingsModal C={C} uid={uid} isMobile={isMobile} onClose={() => setShowSettings(false)} />
      )}
    </div>
  );
}

function btnGhost(C, isMobile = false) {
  return {
    flex: isMobile ? 1 : undefined,
    padding: isMobile ? "12px 14px" : "6px 12px",
    minHeight: isMobile ? 44 : undefined,
    borderRadius: RADIUS.md,
    background: C.card2, color: C.text2, border: `1px solid ${C.border}`,
    fontSize: isMobile ? FONT.sm : FONT.xs,
    fontWeight: 600, cursor: "pointer",
  };
}

function FilterChip({ C, active, onClick, children, isMobile }) {
  return (
    <button onClick={onClick} style={{
      padding: isMobile ? "10px 16px" : "6px 12px",
      minHeight: isMobile ? 44 : undefined,
      borderRadius: RADIUS.full,
      background: active ? C.blue : C.card2,
      color: active ? "#fff" : C.text2,
      border: `1px solid ${active ? C.blue : C.border}`,
      fontSize: isMobile ? FONT.sm : FONT.xs,
      fontWeight: 600, cursor: "pointer",
      whiteSpace: "nowrap",
      scrollSnapAlign: isMobile ? "start" : undefined,
      flexShrink: 0,
    }}>{children}</button>
  );
}

function NotificationCard({ n, C, onClick, isMobile }) {
  const cat = CATEGORY_META[n.category] || CATEGORY_META.system;
  const pri = PRIORITY_META[n.priority] || PRIORITY_META.medium;
  const accent = n.priority === "high" ? C.red : n.priority === "low" ? C.text3 : C.blueL;

  return (
    <div onClick={onClick} style={{
      background: n.read ? C.card : `linear-gradient(90deg, ${C.blueBg}55 0%, ${C.card} 30%)`,
      border: `1px solid ${n.read ? C.border : accent + "60"}`,
      borderLeft: `4px solid ${accent}`,
      borderRadius: RADIUS.lg,
      padding: isMobile ? 14 : 14,
      minHeight: isMobile ? 72 : undefined,
      cursor: n.link ? "pointer" : "default",
      transition: "transform 0.1s",
    }}
    onMouseEnter={e => { if (n.link) e.currentTarget.style.transform = "translateY(-1px)"; }}
    onMouseLeave={e => { e.currentTarget.style.transform = "none"; }}
    >
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
        <div style={{ fontSize: 24, lineHeight: 1 }}>{cat.icon}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
            <span style={{ fontSize: FONT.base, fontWeight: 700, color: C.text1 }}>{n.title}</span>
            {n.symbol && (
              <span style={{
                fontSize: FONT.xs, fontWeight: 600,
                padding: "2px 6px", borderRadius: RADIUS.sm,
                background: C.card2, color: C.text2,
              }}>{n.symbol}</span>
            )}
            {n.priority === "high" && (
              <span style={{
                fontSize: FONT.xs, fontWeight: 700,
                padding: "2px 6px", borderRadius: RADIUS.sm,
                background: C.redBg, color: C.red,
              }}>{pri.label}</span>
            )}
          </div>
          {n.summary && (
            <div style={{ fontSize: FONT.sm, color: C.text2, lineHeight: 1.5, marginBottom: 4 }}>
              {n.summary}
            </div>
          )}
          <div style={{ display: "flex", gap: 12, alignItems: "center", fontSize: FONT.xs, color: C.text3 }}>
            <span>{cat.label}</span>
            <span>·</span>
            <span>{fmtAgo(n.ts)}</span>
            {!n.read && (
              <>
                <span>·</span>
                <span style={{ color: C.blueL, fontWeight: 600 }}>● 새 알림</span>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function EmptyBox({ C, icon = "📭", title, desc }) {
  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg,
      padding: "48px 24px", textAlign: "center",
    }}>
      <div style={{ fontSize: 40, marginBottom: 8 }}>{icon}</div>
      <div style={{ fontSize: FONT.lg, fontWeight: 700, color: C.text1, marginBottom: 4 }}>{title}</div>
      {desc && <div style={{ fontSize: FONT.sm, color: C.text3 }}>{desc}</div>}
    </div>
  );
}

// ────────────────────────────────────────────────
// 알림 설정 모달
// ────────────────────────────────────────────────
function SettingsModal({ C, uid, isMobile, onClose }) {
  const [prefs, setPrefs] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch(`/api/notifications/preferences?uid=${encodeURIComponent(uid)}`);
        const data = await r.json();
        if (alive && data?.ok) setPrefs(data.prefs);
      } catch {
        if (alive) setPrefs({
          price: { enabled: false, threshold_pct: 5 },
          signal: { enabled: true, min_score: 80 },
          news: { enabled: true, min_impact: "high" },
          portfolio: { enabled: false, threshold_pct: -5 },
          channels: { telegram: false, email: false, push: true },
        });
      }
    })();
    return () => { alive = false; };
  }, [uid]);

  const save = async () => {
    if (!prefs) return;
    setSaving(true);
    try {
      const r = await fetch("/api/notifications/preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uid, prefs }),
      });
      const data = await r.json();
      if (data?.ok) onClose();
    } catch {} finally {
      setSaving(false);
    }
  };

  const body = !prefs ? (
    <div style={{ padding: "32px 0", textAlign: "center", color: C.text3 }}>불러오는 중…</div>
  ) : (
    <SettingsForm C={C} prefs={prefs} setPrefs={setPrefs} isMobile={isMobile} />
  );

  const footer = (
    <>
      <button onClick={onClose} style={{
        flex: isMobile ? 1 : undefined,
        padding: isMobile ? "14px 16px" : "8px 16px",
        minHeight: 48, borderRadius: RADIUS.md,
        background: C.card2, color: C.text2, border: `1px solid ${C.border}`,
        fontSize: pickFont("button", isMobile) ?? FONT.sm, fontWeight: 600, cursor: "pointer",
      }}>취소</button>
      <button onClick={save} disabled={saving || !prefs} style={{
        flex: isMobile ? 2 : undefined,
        padding: isMobile ? "14px 20px" : "8px 20px",
        minHeight: 48, borderRadius: RADIUS.md,
        background: C.blue, color: "#fff", border: "none",
        fontWeight: 700, fontSize: pickFont("button", isMobile) ?? FONT.sm,
        cursor: saving ? "wait" : "pointer", opacity: saving ? 0.6 : 1,
      }}>{saving ? "저장 중…" : "저장"}</button>
    </>
  );

  if (isMobile) {
    return (
      <BottomSheet
        open={true}
        onClose={onClose}
        title="⚙️ 알림 설정"
        footer={footer}
        maxHeight="92vh"
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
        padding: 24, maxWidth: 520, width: "100%", maxHeight: "90vh", overflow: "auto",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div style={{ fontSize: FONT.xl, fontWeight: 800, color: C.text1 }}>⚙️ 알림 설정</div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: C.text2, fontSize: 22, cursor: "pointer" }}>✕</button>
        </div>
        {body}
        {prefs && (
          <div style={{ display: "flex", gap: 8, marginTop: 20, justifyContent: "flex-end" }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

// 설정 폼 — Modal/BottomSheet 공유 (footer 버튼은 wrapper 가 표시)
function SettingsForm({ C, prefs, setPrefs, isMobile }) {
  return (
    <>
      <PrefRow C={C}
        icon="💰"
        label="가격 변동 알림"
        hint={`${prefs.price.threshold_pct}% 이상 변동 시 알림`}
        enabled={prefs.price.enabled}
        onToggle={() => setPrefs(p => ({ ...p, price: { ...p.price, enabled: !p.price.enabled } }))}
      >
        <NumberInput C={C} value={prefs.price.threshold_pct} min={0.5} max={50} step={0.5} unit="%" isMobile={isMobile}
          onChange={v => setPrefs(p => ({ ...p, price: { ...p.price, threshold_pct: v } }))}
        />
      </PrefRow>

      <PrefRow C={C}
        icon="📈"
        label="시그널 알림"
        hint={`score ${prefs.signal.min_score} 이상 시그널만`}
        enabled={prefs.signal.enabled}
        onToggle={() => setPrefs(p => ({ ...p, signal: { ...p.signal, enabled: !p.signal.enabled } }))}
      >
        <NumberInput C={C} value={prefs.signal.min_score} min={50} max={100} step={5} isMobile={isMobile}
          onChange={v => setPrefs(p => ({ ...p, signal: { ...p.signal, min_score: v } }))}
        />
      </PrefRow>

      <PrefRow C={C}
        icon="📰"
        label="뉴스 영향도"
        hint="시장 영향이 큰 뉴스만 받기"
        enabled={prefs.news.enabled}
        onToggle={() => setPrefs(p => ({ ...p, news: { ...p.news, enabled: !p.news.enabled } }))}
      >
        <select value={prefs.news.min_impact}
          onChange={e => setPrefs(p => ({ ...p, news: { ...p.news, min_impact: e.target.value } }))}
          style={selectStyle(C, isMobile)}>
          <option value="low">낮음 이상</option>
          <option value="medium">보통 이상</option>
          <option value="high">높음만</option>
        </select>
      </PrefRow>

      <PrefRow C={C}
        icon="📊"
        label="포트폴리오 손실 알림"
        hint={`${prefs.portfolio.threshold_pct}% 도달 시 알림`}
        enabled={prefs.portfolio.enabled}
        onToggle={() => setPrefs(p => ({ ...p, portfolio: { ...p.portfolio, enabled: !p.portfolio.enabled } }))}
      >
        <NumberInput C={C} value={prefs.portfolio.threshold_pct} min={-50} max={0} step={1} unit="%" isMobile={isMobile}
          onChange={v => setPrefs(p => ({ ...p, portfolio: { ...p.portfolio, threshold_pct: v } }))}
        />
      </PrefRow>

      <div style={{
        marginTop: 16, padding: 14, background: C.card2, border: `1px solid ${C.border}`,
        borderRadius: RADIUS.lg,
      }}>
        <div style={{ fontSize: FONT.sm, fontWeight: 700, color: C.text1, marginBottom: 10 }}>전달 채널</div>
        <ChannelChk C={C} label="📱 앱 알림 (브라우저 푸시)"
          checked={prefs.channels.push}
          onChange={v => setPrefs(p => ({ ...p, channels: { ...p.channels, push: v } }))} />
        <ChannelChk C={C} label="✈️ 텔레그램"
          checked={prefs.channels.telegram}
          onChange={v => setPrefs(p => ({ ...p, channels: { ...p.channels, telegram: v } }))} />
        <ChannelChk C={C} label="✉️ 이메일 (준비 중)"
          checked={prefs.channels.email} disabled
          onChange={v => setPrefs(p => ({ ...p, channels: { ...p.channels, email: v } }))} />
      </div>
    </>
  );
}

function PrefRow({ C, icon, label, hint, enabled, onToggle, children }) {
  return (
    <div style={{
      padding: 14, marginBottom: 10,
      background: C.card2, border: `1px solid ${C.border}`,
      borderRadius: RADIUS.lg,
      opacity: enabled ? 1 : 0.6,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 18 }}>{icon}</span>
          <div>
            <div style={{ fontSize: FONT.sm, fontWeight: 700, color: C.text1 }}>{label}</div>
            <div style={{ fontSize: FONT.xs, color: C.text3 }}>{hint}</div>
          </div>
        </div>
        <label style={{ position: "relative", display: "inline-block", width: 42, height: 22, cursor: "pointer" }}>
          <input type="checkbox" checked={enabled} onChange={onToggle} style={{ opacity: 0, width: 0, height: 0 }} />
          <span style={{
            position: "absolute", inset: 0, borderRadius: 11,
            background: enabled ? C.blue : C.border2, transition: "0.15s",
          }} />
          <span style={{
            position: "absolute", top: 2, left: enabled ? 22 : 2,
            width: 18, height: 18, borderRadius: "50%", background: "#fff",
            transition: "0.15s",
          }} />
        </label>
      </div>
      {enabled && <div style={{ marginTop: 4 }}>{children}</div>}
    </div>
  );
}

function NumberInput({ C, value, onChange, min, max, step = 1, unit, isMobile }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <input type="number" value={value} min={min} max={max} step={step}
        inputMode="decimal"
        onChange={e => onChange(parseFloat(e.target.value))}
        style={{
          padding: isMobile ? "10px 12px" : "6px 10px",
          minHeight: isMobile ? 44 : undefined,
          borderRadius: RADIUS.sm,
          background: C.card, border: `1px solid ${C.border2}`,
          color: C.text1,
          fontSize: isMobile ? 16 : FONT.sm,
          width: isMobile ? 110 : 90,
        }} />
      {unit && <span style={{ fontSize: FONT.sm, color: C.text3 }}>{unit}</span>}
    </div>
  );
}

function ChannelChk({ C, label, checked, onChange, disabled }) {
  return (
    <label style={{
      display: "flex", alignItems: "center", gap: 10, padding: "10px 0",
      minHeight: 44,
      fontSize: FONT.sm, color: disabled ? C.text3 : C.text1,
      cursor: disabled ? "not-allowed" : "pointer",
    }}>
      <input type="checkbox" checked={checked} disabled={disabled}
        onChange={e => onChange(e.target.checked)}
        style={{ width: 20, height: 20, cursor: disabled ? "not-allowed" : "pointer" }} />
      <span>{label}</span>
    </label>
  );
}

function selectStyle(C, isMobile) {
  return {
    padding: isMobile ? "10px 12px" : "6px 10px",
    minHeight: isMobile ? 44 : undefined,
    borderRadius: RADIUS.sm,
    background: C.card, border: `1px solid ${C.border2}`,
    color: C.text1,
    fontSize: isMobile ? 16 : FONT.sm,
  };
}
