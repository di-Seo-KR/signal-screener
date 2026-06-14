// ─────────────────────────────────────────────────────────────────────────────
// Zepta 퍼스트파티 애널리틱스 (GA4 대체 — 2026-06-12 대표 지시 "GA를 우리가 만든다")
// ─────────────────────────────────────────────────────────────────────────────
// 수집: navigator.sendBeacon → POST /api/track → KV 일별 집계 (api/track.js 참고)
// 대시보드: /marketing (오너 전용, src/MarketingDashboard.jsx)
//
// 원칙:
//   - 무쿠키 · PII 없음: 익명 랜덤 vid(localStorage)만 사용, IP/이메일 미수집
//   - 절대 본 서비스에 영향 X — 전부 try/catch no-op
//   - 기존 ga.* 호출부 API 100% 호환 (GA4 시절 시그니처 유지)
//
// 이벤트 카탈로그 (기존 GA4 전환 이벤트 그대로):
//   signup_started / signup_completed / signin_success
//   binance_connect_clicked / _success / bot_activated / real_trading_started
//   alpha_lab_viewed / cta_click / blog_post_read / page_view
// ─────────────────────────────────────────────────────────────────────────────

function uuid() {
  return (typeof crypto !== "undefined" && crypto.randomUUID)
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function getVid() {
  try {
    let v = localStorage.getItem("z_vid");
    if (!v) { v = uuid(); localStorage.setItem("z_vid", v); }
    return v;
  } catch { return null; }
}

// 세션 ID — sessionStorage 기반(탭 닫으면 소멸 = GA4 세션 개념). 세션당 첫 PV 표시(sfirst).
function getSession() {
  try {
    let sid = sessionStorage.getItem("z_sid");
    let isFirst = false;
    if (!sid) { sid = uuid(); sessionStorage.setItem("z_sid", sid); isFirst = true; }
    return { sid, isFirst };
  } catch { return { sid: null, isFirst: false }; }
}

// 세션당 1회만 referrer/UTM 전송 (내부 이동을 외부 유입으로 오집계 방지)
let _sessionMetaSent = false;
let _lastPvPath = null;

function send(payload) {
  try {
    if (typeof window === "undefined") return;
    const body = JSON.stringify(payload);
    if (navigator.sendBeacon) {
      navigator.sendBeacon("/api/track", new Blob([body], { type: "application/json" }));
    } else {
      fetch("/api/track", { method: "POST", body, keepalive: true, headers: { "Content-Type": "application/json" } }).catch(() => {});
    }
  } catch { /* no-op */ }
}

/**
 * 행동 이벤트 전송. (기존 GA4 trackEvent 시그니처 호환)
 * @param {string} eventName
 * @param {object} params - { location, label, ... } → 대표 라벨 1개만 채택
 */
export function trackEvent(eventName, params = {}) {
  try {
    if (typeof window === "undefined") return;
    const label = params.label || params.location || params.bot_name || params.method || params.mode || null;
    send({ t: "ev", ev: eventName, label });
  } catch { /* no-op */ }
}

/** 페이지뷰. 동일 경로 연속 호출은 1회만 집계. */
export function trackPageView(path) {
  try {
    if (typeof window === "undefined") return;
    const p = path || window.location.pathname;
    if (p === _lastPvPath) return;
    _lastPvPath = p;
    const sess = getSession();
    const payload = {
      t: "pv",
      path: p,
      vid: getVid(),
      dev: window.innerWidth <= 640 ? "m" : "d",
      sid: sess.sid,            // 세션 단위 집계용
      sfirst: sess.isFirst ? 1 : 0, // 세션 첫 PV 여부(세션 수·신규/재방문)
    };
    if (!_sessionMetaSent) {
      _sessionMetaSent = true;
      payload.ref = document.referrer || null;
      try {
        const q = new URLSearchParams(window.location.search);
        payload.utm = q.get("utm_source") || null;
      } catch {}
    }
    send(payload);
  } catch { /* no-op */ }
}

// 자주 쓰는 이벤트 — 기존 호출부 호환 유지
export const ga = {
  signupStarted: (method = "email") => trackEvent("signup_started", { method }),
  signupCompleted: (method = "email") => trackEvent("signup_completed", { method }),
  signinSuccess: (method = "email") => trackEvent("signin_success", { method }),

  binanceConnectClicked: () => trackEvent("binance_connect_clicked"),
  binanceConnectSuccess: () => trackEvent("binance_connect_success"),

  botActivated: (botName = "default") => trackEvent("bot_activated", { bot_name: botName }),
  realTradingStarted: (mode = "shadow") => trackEvent("real_trading_started", { mode }),

  alphaLabViewed: () => trackEvent("alpha_lab_viewed"),

  ctaClick: (location, label) => trackEvent("cta_click", { location, label }),

  // SPA 라우트 전환 — App 의 탭 전환 effect 에서 호출
  pageView: (path) => trackPageView(path),
};
