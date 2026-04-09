// ══════════════════════════════════════════════════════════════════
// Zepta ThemeProvider — data-theme on <html>, persisted to localStorage
// ══════════════════════════════════════════════════════════════════
import React, { createContext, useContext, useEffect, useState, useCallback } from "react";

const ThemeContext = createContext({ theme: "dark", setTheme: () => {}, toggle: () => {} });

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
