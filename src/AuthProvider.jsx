// ════════════════════════════════════════════════════════════════════
// AuthProvider — Supabase 인증 상태 관리 (v2 — OAuth 완전 수정)
// ════════════════════════════════════════════════════════════════════
import { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "./supabaseClient.js";

const AuthContext = createContext(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

// ── 토스트 알림 컴포넌트 ──
function AuthToast({ toast, onClose }) {
  if (!toast) return null;
  const isError = toast.type === "error";
  return (
    <div style={{
      position: "fixed", top: "24px", left: "50%", transform: "translateX(-50%)",
      zIndex: 999999, minWidth: "320px", maxWidth: "480px",
      padding: "16px 20px", borderRadius: "14px",
      background: isError ? "#2C1520" : "#0B2E1E",
      border: `1px solid ${isError ? "#FF4D5E" : "#00D47E"}`,
      color: isError ? "#FF8A95" : "#6EE7A8",
      fontSize: "14px", fontWeight: 600,
      boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
      display: "flex", alignItems: "center", gap: "12px",
      animation: "slideDown 0.3s ease-out",
    }}>
      <span style={{ fontSize: "20px" }}>{isError ? "❌" : "✅"}</span>
      <span style={{ flex: 1 }}>{toast.message}</span>
      <button onClick={onClose} style={{
        background: "none", border: "none", color: "inherit",
        cursor: "pointer", fontSize: "18px", opacity: 0.7, padding: "0 4px",
      }}>✕</button>
    </div>
  );
}

export default function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const codeExchanged = useRef(false);
  const toastTimer = useRef(null);

  // ── 토스트 표시 함수 ──
  const showToast = useCallback((type, message, duration = 4000) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ type, message });
    toastTimer.current = setTimeout(() => setToast(null), duration);
  }, []);

  const clearToast = useCallback(() => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(null);
  }, []);

  useEffect(() => {
    let mounted = true;

    // ── 1. 인증 상태 변경 리스너 ──
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, s) => {
        if (!mounted) return;
        console.log("[DI금융 Auth] Event:", event, s?.user?.email ?? "(no user)");

        setSession(s);
        setUser(s?.user ?? null);

        if (event === "SIGNED_IN") {
          const displayName = s?.user?.user_metadata?.full_name
            || s?.user?.user_metadata?.display_name
            || s?.user?.email?.split("@")[0]
            || "사용자";
          showToast("success", `환영합니다, ${displayName}님! 🎉`);

          // OAuth 리다이렉트 URL 정리
          const url = new URL(window.location.href);
          if (url.searchParams.has("code") || url.hash.includes("access_token")) {
            window.history.replaceState({}, "", url.origin + url.pathname);
          }
        } else if (event === "SIGNED_OUT") {
          showToast("success", "로그아웃 되었습니다.");
        }

        if (["SIGNED_IN", "SIGNED_OUT", "TOKEN_REFRESHED", "INITIAL_SESSION"].includes(event)) {
          setLoading(false);
        }
      }
    );

    // ── 2. 초기 세션 확인 + OAuth 코드 교환 ──
    const initAuth = async () => {
      try {
        const url = new URL(window.location.href);
        const code = url.searchParams.get("code");

        // PKCE 코드가 URL에 있으면 세션 교환
        if (code && !codeExchanged.current) {
          codeExchanged.current = true;
          console.log("[DI금융 Auth] OAuth code detected, exchanging for session...");

          const { data, error } = await supabase.auth.exchangeCodeForSession(code);

          if (error) {
            console.error("[DI금융 Auth] Code exchange failed:", error.message);

            // 이미 사용된 코드이면 기존 세션 확인
            if (error.message.includes("already used") || error.message.includes("expired")) {
              console.log("[DI금융 Auth] Code already used, checking existing session...");
            } else {
              if (mounted) showToast("error", `로그인 실패: ${error.message}`);
            }

            // URL 정리
            window.history.replaceState({}, "", url.origin + url.pathname);
          } else if (data?.session) {
            console.log("[DI금융 Auth] Code exchange success:", data.session.user?.email);
            if (mounted) {
              setSession(data.session);
              setUser(data.session.user ?? null);
              setLoading(false);
            }
            // URL 정리
            window.history.replaceState({}, "", url.origin + url.pathname);
            return; // onAuthStateChange가 나머지 처리
          }
        }

        // URL에 error 파라미터가 있으면 (OAuth 거부 등)
        const errorParam = url.searchParams.get("error");
        const errorDesc = url.searchParams.get("error_description");
        if (errorParam) {
          console.error("[DI금융 Auth] OAuth error in URL:", errorParam, errorDesc);
          if (mounted) showToast("error", errorDesc || "소셜 로그인이 취소되었습니다.");
          window.history.replaceState({}, "", url.origin + url.pathname);
        }

        // 기존 저장된 세션 확인
        const { data: { session: existingSession }, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) {
          console.error("[DI금융 Auth] getSession error:", sessionError.message);
        }
        if (mounted) {
          setSession(existingSession);
          setUser(existingSession?.user ?? null);
        }
      } catch (err) {
        console.error("[DI금융 Auth] Init error:", err);
        if (mounted) showToast("error", "인증 초기화 오류가 발생했습니다.");
      } finally {
        if (mounted) setLoading(false);
      }
    };

    initAuth();

    return () => {
      mounted = false;
      subscription.unsubscribe();
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, [showToast]);

  // ── 이메일 회원가입 ──
  const signUp = async (email, password, displayName) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { display_name: displayName || email.split("@")[0] },
      },
    });
    if (!error && data?.user) {
      // Supabase 이메일 확인이 꺼져있으면 바로 로그인됨
      if (data.session) {
        showToast("success", "회원가입 완료! 환영합니다! 🎉");
      } else {
        showToast("success", "회원가입 완료! 이메일 인증 링크를 확인해주세요. 📧");
      }
    } else if (error) {
      showToast("error", error.message === "User already registered"
        ? "이미 등록된 이메일입니다."
        : `회원가입 실패: ${error.message}`);
    }
    return { data, error };
  };

  // ── 이메일 로그인 ──
  const signIn = async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) {
      showToast("error", error.message === "Invalid login credentials"
        ? "이메일 또는 비밀번호가 올바르지 않습니다."
        : `로그인 실패: ${error.message}`);
    }
    return { data, error };
  };

  // ── 소셜 로그인 (Google, GitHub) ──
  const signInWithOAuth = async (provider) => {
    const currentOrigin = window.location.origin;
    console.log("[DI금융 Auth] Starting OAuth:", provider, "redirect:", currentOrigin);

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: currentOrigin,
        queryParams: {
          access_type: 'offline',
          prompt: 'consent',
        },
      },
    });

    if (error) {
      console.error("[DI금융 Auth] OAuth initiation error:", error.message);
      showToast("error", `${provider} 로그인 시작 실패: ${error.message}`);
    }
    // OAuth는 리다이렉트 방식이므로 여기서 페이지가 이동됨
    return { data, error };
  };

  // ── 로그아웃 ──
  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (!error) {
      setUser(null);
      setSession(null);
    }
    return { error };
  };

  // ── 비밀번호 재설정 ──
  const resetPassword = async (email) => {
    const { data, error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}?tab=home`,
    });
    if (!error) {
      showToast("success", "비밀번호 재설정 링크가 이메일로 전송되었습니다. 📧");
    }
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
    showToast,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
      <AuthToast toast={toast} onClose={clearToast} />
      {/* CSS 애니메이션 for toast */}
      <style>{`
        @keyframes slideDown {
          from { opacity: 0; transform: translateX(-50%) translateY(-20px); }
          to { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
      `}</style>
    </AuthContext.Provider>
  );
}
