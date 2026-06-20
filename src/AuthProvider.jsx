// ════════════════════════════════════════════════════════════════════
// AuthProvider — Supabase 인증 상태 관리 (v2 — OAuth 완전 수정)
// ════════════════════════════════════════════════════════════════════
import { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "./supabaseClient.js";
import { ga } from "./lib/analytics.js";

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
      padding: "16px 20px", borderRadius: "12px",
      background: isError ? "#2C1520" : "#0B2E1E",
      border: `1px solid ${isError ? "#FF4D5E" : "#00D47E"}`,
      color: isError ? "#FF8A95" : "#6EE7A8",
      fontSize: "16px", fontWeight: 600,
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
  const wasSignedIn = useRef(false);

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
        console.log("[Zepta Auth] Event:", event, s?.user?.email ?? "(no user)");

        setSession(s);
        setUser(s?.user ?? null);

        if (event === "SIGNED_IN" && !wasSignedIn.current) {
          wasSignedIn.current = true;
          const displayName = s?.user?.user_metadata?.full_name
            || s?.user?.user_metadata?.display_name
            || s?.user?.email?.split("@")[0]
            || "사용자";
          showToast("success", `환영합니다, ${displayName}님! 🎉`);

          // GA4 — 로그인 성공 이벤트 (OAuth/이메일 모두 포함)
          const provider = s?.user?.app_metadata?.provider || "email";
          ga.signinSuccess(provider);

          // OAuth 리다이렉트 URL 정리
          const url = new URL(window.location.href);
          if (url.searchParams.has("code") || url.hash.includes("access_token")) {
            window.history.replaceState({}, "", url.origin + url.pathname);
          }
        } else if (event === "SIGNED_OUT") {
          wasSignedIn.current = false;
          showToast("success", "로그아웃 되었습니다.");
        }

        if (["SIGNED_IN", "SIGNED_OUT", "TOKEN_REFRESHED", "INITIAL_SESSION"].includes(event)) {
          setLoading(false);
        }

        // Mark as already signed in for session restoration (prevents duplicate toasts)
        if (event === "INITIAL_SESSION" && s?.user) {
          wasSignedIn.current = true;
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
          console.log("[Zepta Auth] OAuth code detected, exchanging for session...");

          const { data, error } = await supabase.auth.exchangeCodeForSession(code);

          if (error) {
            console.error("[Zepta Auth] Code exchange failed:", error.message);

            // 이미 사용된 코드이면 기존 세션 확인
            if (error.message.includes("already used") || error.message.includes("expired")) {
              console.log("[Zepta Auth] Code already used, checking existing session...");
            } else {
              if (mounted) showToast("error", `로그인 실패: ${error.message}`);
            }

            // URL 정리
            window.history.replaceState({}, "", url.origin + url.pathname);
          } else if (data?.session) {
            console.log("[Zepta Auth] Code exchange success:", data.session.user?.email);
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

        // URL에 error 파라미터가 있으면 (OAuth 거부 등) — 쿼리 + 해시 모두 체크
        const errorParam = url.searchParams.get("error");
        const errorDesc = url.searchParams.get("error_description");
        // Supabase는 해시에도 에러를 넣을 수 있음 (#error=...&error_description=...)
        const hashParams = new URLSearchParams(url.hash.replace("#", ""));
        const hashError = hashParams.get("error");
        const hashErrorDesc = hashParams.get("error_description");
        const finalError = errorParam || hashError;
        const finalErrorDesc = errorDesc || hashErrorDesc;

        if (finalError) {
          console.error("[Zepta Auth] OAuth error in URL:", finalError, finalErrorDesc);
          // 한글 에러 메시지 매핑
          let userMessage = "소셜 로그인 중 오류가 발생했습니다.";
          if (finalErrorDesc?.includes("Unable to exchange external code")) {
            userMessage = "Google 인증 코드 교환에 실패했습니다. Supabase 대시보드에서 Google OAuth Client Secret을 확인해주세요.";
          } else if (finalErrorDesc?.includes("access_denied")) {
            userMessage = "로그인이 취소되었습니다.";
          } else if (finalErrorDesc) {
            userMessage = finalErrorDesc;
          }
          if (mounted) showToast("error", userMessage, 8000);
          window.history.replaceState({}, "", url.origin + url.pathname);
        }

        // 기존 저장된 세션 확인
        const { data: { session: existingSession }, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) {
          console.error("[Zepta Auth] getSession error:", sessionError.message);
        }
        if (mounted) {
          setSession(existingSession);
          // getUser()로 서버에서 최신 user_metadata 가져오기 (닉네임 등 동기화)
          if (existingSession?.user) {
            const { data: { user: freshUser } } = await supabase.auth.getUser();
            setUser(freshUser ?? existingSession.user);
          } else {
            setUser(null);
          }
        }
      } catch (err) {
        console.error("[Zepta Auth] Init error:", err);
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
    // GA4 — 회원가입 시작
    ga.signupStarted("email");

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { display_name: displayName || email.split("@")[0] },
      },
    });

    if (error) {
      // 명시적 에러
      const msg = error.message === "User already registered"
        ? "이미 가입된 이메일입니다. 로그인을 이용해주세요."
        : error.message.includes("rate limit")
        ? "요청이 너무 많습니다. 잠시 후 다시 시도해주세요."
        : `회원가입 실패: ${error.message}`;
      showToast("error", msg);
      return { data, error: { ...error, userMessage: msg } };
    }

    if (data?.user) {
      // Supabase는 이미 존재하는 이메일로 signUp 시에도 에러를 안 줄 수 있음
      // 대신 identities 배열이 비어있으면 이미 가입된 유저
      const isExistingUser = data.user.identities && data.user.identities.length === 0;

      if (isExistingUser) {
        const msg = "이미 가입된 이메일입니다. 로그인을 이용해주세요.";
        showToast("error", msg);
        return { data, error: { message: msg, userMessage: msg } };
      }

      // GA4 — 회원가입 완료
      ga.signupCompleted("email");

      if (data.session) {
        // 이메일 확인 꺼져있으면 바로 로그인
        showToast("success", "회원가입 완료! 환영합니다! 🎉");
      } else {
        // 이메일 확인 필요
        showToast("success", "회원가입 완료! 이메일 인증 링크를 확인해주세요. 📧", 6000);
      }
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
    // GA4 — OAuth 시작 (= signup 시작과 의미상 동일)
    ga.signupStarted(provider);
    // ★ 마케팅 계측 수정: signInWithOAuth 가 즉시 full-page 리다이렉트(특히 iOS Safari)를 일으켜 위
    //   sendBeacon 이 flush 되기 전에 페이지가 떠나 signup_started 가 유실됨 → 퍼널 '가입시작 0'이 허위
    //   였음(signin_success 는 복귀 후 안정 페이지라 살아남아 데이터 모순 발생). 짧은 지연으로 beacon
    //   dispatch 보장. 200ms 는 사용자 체감 없음.
    await new Promise((r) => setTimeout(r, 200));

    const currentOrigin = window.location.origin;
    console.log("[Zepta Auth] Starting OAuth:", provider, "redirect:", currentOrigin);

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
      console.error("[Zepta Auth] OAuth initiation error:", error.message);
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

  // ── 유저 정보 새로고침 (서버에서 최신 user_metadata 가져오기) ──
  const refreshUser = useCallback(async () => {
    try {
      const { data: { user: freshUser }, error } = await supabase.auth.getUser();
      if (error) {
        console.error("[Zepta Auth] refreshUser error:", error.message);
        return;
      }
      if (freshUser) setUser(freshUser);
    } catch (err) {
      console.error("[Zepta Auth] refreshUser exception:", err);
    }
  }, []);

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
    refreshUser,
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
