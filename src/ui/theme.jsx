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
export const THEME_TOKENS = {
  dark: {
    bg: "#070B14", card: "#101828", card2: "#161F33",
    border: "#1E2A42", border2: "#2A3A58",
    blue: "#3B82F6", blueL: "#60A5FA", blueBg: "#0F1F3D",
    red: "#FF4D64", redBg: "#2C1520",
    green: "#10D884", greenBg: "#0B2E1E",
    yellow: "#FFB020", yellowBg: "#2B2100",
    purple: "#9B6FFF", purpleBg: "#201840",
    orange: "#FF6B2C", orangeBg: "#2A1A0A",
    text1: "#F1F5FB", text2: "#9AA7BD", text3: "#64728C", text4: "#3A455C",
    isDark: true,
    cardShadow: "0 4px 16px rgba(0,0,0,.32), 0 1px 3px rgba(0,0,0,.16)",
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
