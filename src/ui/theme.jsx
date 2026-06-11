// ══════════════════════════════════════════════════════════════════
// Zepta ThemeProvider — data-theme on <html>, persisted to localStorage
// + THEME_TOKENS (SSOT) — 모든 페이지가 useThemeTokens() 또는
//   getThemeTokens(theme) 로 접근. 로컬 재정의 금지.
// ══════════════════════════════════════════════════════════════════
import React, { createContext, useContext, useEffect, useState, useCallback } from "react";

const ThemeContext = createContext({ theme: "dark", setTheme: () => {}, toggle: () => {} });

// ── Theme tokens (SSOT) ────────────────────────────────────────────
// tokens.css 의 --z-* CSS 변수와 1:1 동기화. hex 그대로 둔 이유는
// 알파 합성 패턴 (e.g. `${C.blue}22`) 이 var() 와 호환 안 되기 때문.
// 라이트 모드 text3 는 WCAG AA 통과 (#F6F8FC bg 대비 5.4:1).
// ★ 2026-06-08 디자인 동기화 (대표 지시 — "디자인도 포함"):
//   tokens.css 는 이미 '모던 핀테크 미니멀(Toss·Linear)' 팔레트(#0A0B0F·#4D7CFF)로
//   개편됐는데 이 객체는 옛 네이비(#070B14·#3B82F6)에 머물러 있어, CSS 변수를 쓰는
//   화면과 인라인 스타일(C.*) 1,500곳이 서로 다른 팔레트로 렌더되고 있었음.
//   → 다크 토큰을 tokens.css :root 값과 1:1 재동기화. *Bg 계열은 알파 tint 를
//   bg(#0A0B0F) 위에 합성한 솔리드 hex (인라인에서 단색으로 쓰이기 때문).
export const THEME_TOKENS = {
  dark: {
    bg: "#0A0B0F", card: "#14151B", card2: "#1B1D25",
    border: "#23262F", border2: "#2E313C",
    blue: "#4D7CFF", blueL: "#6E92FF", blueBg: "#131B31",
    red: "#FF4D64", redBg: "#271319",
    green: "#10D884", greenBg: "#0B241D",
    yellow: "#FFB020", yellowBg: "#271F11",
    purple: "#9B6FFF", purpleBg: "#1B172C",
    orange: "#FF6B2C", orangeBg: "#271713",
    text1: "#F4F5F7", text2: "#A1A6B2", text3: "#6E7585", text4: "#474C5A",
    isDark: true,
    cardShadow: "0 1px 2px rgba(0,0,0,.4), 0 6px 18px rgba(0,0,0,.28)",
  },
  light: {
    bg: "#F6F8FC", card: "#FFFFFF", card2: "#F1F4F9",
    border: "#E2E6EF", border2: "#D0D6E1",
    blue: "#2563EB", blueL: "#3B82F6", blueBg: "#E8F1FE",
    red: "#E11D48", redBg: "#FFF0F1",
    green: "#059B64", greenBg: "#EDFBF2",
    yellow: "#D08300", yellowBg: "#FFF9EC",
    purple: "#7C3AED", purpleBg: "#F0EDFF",
    orange: "#E8590C", orangeBg: "#FFF7ED",
    text1: "#0A1224", text2: "#4C5870",
    text3: "#5A6478", // WCAG AA (#F6F8FC 대비 5.4:1) — 이전 #7D889D 는 3.6:1 미달
    text4: "#94A0B6",
    isDark: false,
    cardShadow: "0 2px 10px rgba(15,23,42,0.08), 0 1px 2px rgba(15,23,42,0.04)",
  },
};

/** 현재 테마에 맞는 토큰 객체 반환 (React 외부 / hook 사용 불가 시) */
export function getThemeTokens(theme) {
  return theme === "light" ? THEME_TOKENS.light : THEME_TOKENS.dark;
}

// ── Radius tokens ──────────────────────────────────────────────────
// 이전엔 14변종 (2/3/4/5/6/8/9/10/12/14/16/18/20/24 px) 무작위 사용 →
// 6단계로 정규화. 신규 코드는 RADIUS.* 사용 권고.
export const RADIUS = {
  xs: "4px",     // 작은 칩·태그 (이전 2/3 도 여기로 정규화)
  sm: "6px",     // 작은 카드·버튼 (이전 5 도 여기로)
  md: "8px",     // 표준 카드·버튼 (이전 9 도 여기로)
  lg: "12px",    // 큰 카드·모달 (이전 14 도 여기로)
  xl: "16px",    // 페이지 섹션 카드
  "2xl": "20px",
  "3xl": "24px",
  full: "9999px", // pill / circle
};

// ── Font size tokens ───────────────────────────────────────────────
// 이전엔 15+ 변종 (10/11/12/13/14/15/16/17/18/20/22/24/28/32/48 px) 사용 →
// Tailwind text-* 스케일 + 모바일 가독성 최소 12px 기준으로 정규화.
export const FONT = {
  xs: "12px",     // 캡션·라벨 (이전 10/11 도 여기로 — 모바일 가독성)
  sm: "14px",     // 보조 텍스트 (이전 13 도 여기로)
  base: "16px",   // 본문
  lg: "18px",     // 강조 텍스트 (이전 17 도 여기로)
  xl: "20px",     // 카드 제목
  "2xl": "24px",  // 섹션 제목 (이전 22/26 도 여기로)
  "3xl": "30px",  // 페이지 제목
  "4xl": "36px",
  display: "48px", // 큰 숫자 (잔액 표시 등)
};

// ── Mobile-first font size tokens (iPhone 16 393pt 기준) ────────────
// 모바일에선 입문자 친화 + 시인성 우선 — 데스크탑에선 컴팩트.
// useBreakpoint().isMobile 와 함께 사용:
//   const { isMobile } = useBreakpoint();
//   <h1 style={{ fontSize: isMobile ? FONT_MOBILE.h1.mobile : FONT_MOBILE.h1.desktop }}>
//
// 본문 16px = iOS 자동 zoom-in 방지 임계값 (input/textarea 는 항상 16px 권장).
export const FONT_MOBILE = {
  body:    { mobile: 15, desktop: 14 },  // 본문
  small:   { mobile: 13, desktop: 12 },  // 보조 텍스트, 캡션
  h1:      { mobile: 24, desktop: 32 },  // 페이지 제목
  h2:      { mobile: 19, desktop: 24 },  // 섹션 제목
  h3:      { mobile: 16, desktop: 18 },  // 카드 제목
  mono:    { mobile: 16, desktop: 14 },  // 모노스페이스 (숫자) — 본문 +1
  input:   { mobile: 16, desktop: 14 },  // input/textarea (iOS 자동 zoom-in 방지)
  button:  { mobile: 15, desktop: 13 },  // 버튼 라벨
};

/** 현재 breakpoint 에 맞는 폰트 사이즈 반환 (px 단위 number) */
export function pickFont(key, isMobile) {
  const t = FONT_MOBILE[key];
  if (!t) return undefined;
  return isMobile ? t.mobile : t.desktop;
}

const STORAGE_KEY = "zepta:theme";

function readInitial() {
  if (typeof window === "undefined") return "dark";
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "dark" || saved === "light") return saved;
  } catch {}
  if (window.matchMedia?.("(prefers-color-scheme: light)").matches) return "light";
  return "dark";
}

export function ThemeProvider({ children, defaultTheme }) {
  const [theme, setThemeState] = useState(defaultTheme || readInitial);

  useEffect(() => {
    const el = document.documentElement;
    el.setAttribute("data-theme", theme);
    // Shadcn 은 `.dark` class 기반이라 같이 토글해서 dark:* utility 도 활성화
    if (theme === "dark") el.classList.add("dark");
    else el.classList.remove("dark");
    try { localStorage.setItem(STORAGE_KEY, theme); } catch {}
  }, [theme]);

  const setTheme = useCallback((t) => setThemeState(t === "light" ? "light" : "dark"), []);
  const toggle = useCallback(() => setThemeState((t) => (t === "dark" ? "light" : "dark")), []);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}

/** 현재 테마에 맞는 토큰 객체를 반환하는 hook (컴포넌트 내부에서 사용) */
export function useThemeTokens() {
  const { theme } = useTheme();
  return getThemeTokens(theme);
}
