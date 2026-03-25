// ════════════════════════════════════════════════════════════════════
// AuthProvider — Supabase 인증 상태 관리
// ════════════════════════════════════════════════════════════════════
import { createContext, useContext, useState, useEffect } from "react";
import { supabase } from "./supabaseClient.js";

const AuthContext = createContext(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

export default function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // ── 1. 세션 변경 리스너 (최우선 등록) ──
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, s) => {
        console.log("[DI금융 Auth]", event, s?.user?.email);
        setSession(s);
        setUser(s?.user ?? null);
        if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "TOKEN_REFRESHED" || event === "INITIAL_SESSION") {
          setLoading(false);
        }
        // OAuth 로그인 성공 후 URL 정리
        if (event === "SIGNED_IN") {
          const url = new URL(window.location.href);
          if (url.searchParams.has("code") || url.hash.includes("access_token")) {
            window.history.replaceState({}, "", window.location.origin + window.location.pathname);
          }
        }
      }
    );

    // ── 2. 현재 세션 확인 + URL 코드 교환 ──
    const initAuth = async () => {
      try {
        // URL에 code 파라미터가 있으면 PKCE 교환 시도
        const params = new URLSearchParams(window.location.search);
        const code = params.get("code");

        if (code) {
          console.log("[DI금융 Auth] OAuth code detected, exchanging...");
          const { data, error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) {
            console.error("[DI금융 Auth] Code exchange error:", error.message);
            // 코드 교환 실패 시 URL 정리
            window.history.replaceState({}, "", window.location.origin + window.location.pathname);
          } else {
            console.log("[DI금융 Auth] Code exchange success:", data?.user?.email);
            setSession(data.session);
            setUser(data.session?.user ?? null);
            setLoading(false);
            return;
          }
        }

        // URL hash에 access_token이 있는 경우 (implicit flow fallback)
        if (window.location.hash.includes("access_token")) {
          console.log("[DI금융 Auth] Hash token detected, getting session...");
        }

        // 기존 세션 확인
        const { data: { session: s }, error } = await supabase.auth.getSession();
        if (error) {
          console.error("[DI금융 Auth] getSession error:", error.message);
        }
        setSession(s);
        setUser(s?.user ?? null);
      } catch (err) {
        console.error("[DI금융 Auth] Init error:", err);
      } finally {
        setLoading(false);
      }
    };

    initAuth();

    return () => subscription.unsubscribe();
  }, []);

  // ── 이메일 회원가입 ──
  const signUp = async (email, password, displayName) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { display_name: displayName || email.split("@")[0] },
      },
    });
    return { data, error };
  };

  // ── 이메일 로그인 ──
  const signIn = async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    return { data, error };
  };

  // ── 소셜 로그인 (Google, GitHub) ──
  const signInWithOAuth = async (provider) => {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: window.location.origin,
        queryParams: {
          access_type: 'offline',
          prompt: 'consent',
        },
      },
    });
    if (error) console.error("[DI금융 Auth] OAuth error:", error.message);
    return { data, error };
  };

  // ── 로그아웃 ──
  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    return { error };
  };

  // ── 비밀번호 재설정 ──
  const resetPassword = async (email) => {
    const { data, error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}?tab=home`,
    });
    return { data, error };
  };

  const value = {
    user,
    session,
    loading,
    signUp,
    signIn,
    signInWithOAuth,
    signOut,
    resetPassword,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
