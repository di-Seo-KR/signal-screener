import React, { createContext, useContext, useState, useCallback } from "react";
import ko from "./ko.json";
import en from "./en.json";

const translations = { ko, en };
const LanguageContext = createContext();

export function LanguageProvider({ children }) {
  const [lang, setLang] = useState(() => {
    try { return localStorage.getItem("zepta:lang") || "ko"; } catch { return "ko"; }
  });

  const switchLang = useCallback((l) => {
    setLang(l);
    try { localStorage.setItem("zepta:lang", l); } catch {}
  }, []);

  const t = useCallback((key, params) => {
    const keys = key.split(".");
    let val = translations[lang];
    for (const k of keys) {
      val = val?.[k];
      if (val == null) return key; // fallback: show key
    }
    if (params && typeof val === "string") {
      return val.replace(/\{\{(\w+)\}\}/g, (_, k) => params[k] ?? "");
    }
    return val;
  }, [lang]);

  return (
    <LanguageContext.Provider value={{ lang, setLang: switchLang, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export const useLanguage = () => useContext(LanguageContext);
