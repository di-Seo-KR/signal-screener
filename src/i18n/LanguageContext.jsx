import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import ko from "./ko.json";

// ★ 감사 배치3 (perf): en.json(약 21KB)은 기본 언어가 ko 라 대다수 사용자가 전혀 쓰지
//   않는데도 첫 페인트 번들에 정적으로 묶여 있었습니다 → 영어 선택 시에만 dynamic
//   import 로 받습니다. ko 는 기본 언어라 인라인 유지(영어 사용자에게 ko 33KB 가 남는
//   비대칭은 t() 의 ko 폴백 안전망을 지키기 위한 의도적 선택입니다).
//   모듈 스코프 캐시라 ko↔en 재전환 시 재다운로드하지 않습니다.
let enDictCache = null;

const LanguageContext = createContext();

export function LanguageProvider({ children }) {
  const [lang, setLang] = useState(() => {
    try { return localStorage.getItem("zepta:lang") || "ko"; } catch { return "ko"; }
  });
  // en 사전 로드 완료 시 리렌더를 트리거하기 위한 상태 (내용은 enDictCache 와 동일)
  const [enDict, setEnDict] = useState(enDictCache);

  // 영어 선택 시(초기 localStorage 복원 포함) 사전을 동적 로드 —
  // 로딩되는 짧은 시간 동안 t() 는 ko 문구로 폴백해 빈 화면·키 노출이 없습니다.
  useEffect(() => {
    if (lang !== "en" || enDictCache) return;
    let alive = true;
    import("./en.json")
      .then((m) => {
        enDictCache = m.default || m;
        if (alive) setEnDict(enDictCache);
      })
      .catch(() => {}); // 청크 로드 실패 시 ko 폴백 유지 (ko 전환 후 재선택하면 재시도)
    return () => { alive = false; };
  }, [lang]);

  const switchLang = useCallback((l) => {
    setLang(l);
    try { localStorage.setItem("zepta:lang", l); } catch {}
  }, []);

  const t = useCallback((key, params) => {
    const dict = lang === "en" ? (enDict || ko) : ko;
    const keys = key.split(".");
    let val = dict;
    for (const k of keys) {
      val = val?.[k];
      if (val == null) break;
    }
    // en 사전에 없는 키는 ko 로 한 번 더 폴백 — 기존(키 문자열 그대로 노출)보다 정직한 표기
    if (val == null && dict !== ko) {
      val = ko;
      for (const k of keys) {
        val = val?.[k];
        if (val == null) break;
      }
    }
    if (val == null) return key; // fallback: show key
    if (params && typeof val === "string") {
      return val.replace(/\{\{(\w+)\}\}/g, (_, k) => params[k] ?? "");
    }
    return val;
  }, [lang, enDict]);

  return (
    <LanguageContext.Provider value={{ lang, setLang: switchLang, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export const useLanguage = () => useContext(LanguageContext);
