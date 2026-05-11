// ─────────────────────────────────────────────────────────────────────────────
// GA4 이벤트 트래킹 헬퍼 (MKT-LEAD Phase E, 2026-05-11)
// ─────────────────────────────────────────────────────────────────────────────
// index.html 에서 gtag('config', 'G-BMP34JQ649') 로 GA4 가 이미 초기화돼 있습니다.
// 이 모듈은 컴포넌트에서 깔끔하게 호출할 수 있는 wrapper 만 제공합니다.
//
// SSR / GA 미로드 환경에서도 안전하게 동작 (no-op) — try/catch 로 감싸 운영 코드에
// 영향을 안 주도록 설계.
//
// 등록한 전환 이벤트:
//   - signup_started / signup_completed       — 회원가입 funnel
//   - signin_success                          — 로그인 성공
//   - binance_connect_clicked / _success      — 바이낸스 연동
//   - bot_activated                           — 자동매매 봇 활성
//   - real_trading_started                    — 실거래 활성
//   - alpha_lab_viewed                        — Alpha Lab 페이지 진입
//   - cta_click                               — 홈/블로그 CTA 클릭 (label 로 위치 구분)
//   - blog_post_read (75% scroll)             — 블로그 글 정독 (HTML 안에서 직접 호출)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GA4 이벤트 전송. window.gtag 가 없으면 조용히 무시.
 * @param {string} eventName - 예: 'signup_completed'
 * @param {object} params    - 추가 파라미터 (선택)
 */
export function trackEvent(eventName, params = {}) {
  try {
    if (typeof window === "undefined") return;
    if (typeof window.gtag !== "function") return;
    window.gtag("event", eventName, params);
  } catch (e) {
    // 운영 코드 절대 영향 X
    console.warn("[GA4] event failed:", eventName, e?.message);
  }
}

// 자주 쓰는 이벤트 — 일관된 이름 유지를 위해 함수로 래핑
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

  // 일반 페이지 전환 — Router 가 없을 때 수동 호출용
  pageView: (path) => trackEvent("page_view", { page_path: path }),
};
