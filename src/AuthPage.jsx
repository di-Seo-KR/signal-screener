// ════════════════════════════════════════════════════════════════════
// AuthPage — 로그인 / 회원가입 / 비밀번호 재설정
// DI금융 다크/라이트 테마 호환
// ════════════════════════════════════════════════════════════════════
import { useState, useCallback } from "react";
import { useAuth } from "./AuthProvider.jsx";

const DARK = {
  bg: "#0B0F19", card: "#131B2E", card2: "#1A2438",
  border: "#1F2E42", border2: "#2A3F58",
  blue: "#3B8BFF", blueL: "#64ABFF", blueBg: "#182D54",
  red: "#FF4D5E", redBg: "#2C1520",
  green: "#00D47E", greenBg: "#0B2E1E",
  text1: "#F0F2F7", text2: "#94A3B8", text3: "#64748B",
  isDark: true,
};
const LIGHT = {
  bg: "#F8F9FB", card: "#FFFFFF", card2: "#F1F3F6",
  border: "#E2E5EA", border2: "#D1D5DC",
  blue: "#2563EB", blueL: "#3B82F6", blueBg: "#DBEAFE",
  red: "#DC2626", redBg: "#FEF2F2",
  green: "#16A34A", greenBg: "#F0FDF4",
  text1: "#0F172A", text2: "#475569", text3: "#94A3B8",
  isDark: false,
};

export default function AuthPage({ theme = "dark", embedded = false, onClose }) {
  const C = theme === "dark" ? DARK : LIGHT;
  const { signIn, signUp, signInWithOAuth, resetPassword } = useAuth();
  const [mode, setMode] = useState("login"); // login | signup | reset
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  const validateEmail = (emailStr) => {
    return emailStr.includes("@") && emailStr.includes(".");
  };

  const handleSubmit = useCallback(async (e) => {
    e.preventDefault();
    setError(""); setSuccess(""); setLoading(true);

    if (!validateEmail(email)) {
      setError("유효한 이메일을 입력해주세요. (예: name@example.com)");
      setLoading(false);
      return;
    }

    try {
      if (mode === "login") {
        const { error: err } = await signIn(email, password);
        if (err) setError(err.message === "Invalid login credentials"
          ? "이메일 또는 비밀번호가 올바르지 않습니다."
          : err.message);
      } else if (mode === "signup") {
        if (password.length < 6) { setError("비밀번호는 최소 6자 이상이어야 합니다."); setLoading(false); return; }
        const { error: err } = await signUp(email, password, displayName);
        if (err) {
          setError(err.message === "User already registered"
            ? "이미 등록된 이메일입니다."
            : err.message);
        } else {
          setSuccess("가입 완료! 이메일 인증 링크를 확인해주세요.");
          setMode("login");
        }
      } else if (mode === "reset") {
        const { error: err } = await resetPassword(email);
        if (err) setError(err.message);
        else setSuccess("비밀번호 재설정 링크가 이메일로 전송되었습니다.");
      }
    } catch (ex) {
      setError("서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요.");
    }
    setLoading(false);
  }, [mode, email, password, displayName, signIn, signUp, resetPassword]);

  const handleOAuth = useCallback(async (provider) => {
    setError(""); setLoading(true);
    const { error: err } = await signInWithOAuth(provider);
    if (err) setError(err.message);
    setLoading(false);
  }, [signInWithOAuth]);

  // ── 스타일 ──
  const S = {
    wrap: {
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      background: C.bg, padding: "24px", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    },
    container: {
      width: "100%", maxWidth: "420px",
    },
    logo: {
      textAlign: "center", marginBottom: "32px",
    },
    logoIcon: {
      fontSize: "40px", marginBottom: "8px",
    },
    logoTitle: {
      fontSize: "28px", fontWeight: 800, color: C.text1, margin: 0,
      letterSpacing: "-0.5px",
    },
    logoVer: {
      display: "inline-block", marginLeft: "8px",
      fontSize: "11px", fontWeight: 700, color: C.blue,
      background: C.blueBg, padding: "2px 8px", borderRadius: "6px",
    },
    logoSub: {
      fontSize: "13px", color: C.text3, marginTop: "6px",
    },
    card: {
      background: C.card, borderRadius: "16px", border: `1px solid ${C.border}`,
      padding: "32px", boxShadow: C.isDark ? "0 8px 32px rgba(0,0,0,0.3)" : "0 4px 16px rgba(0,0,0,0.06)",
    },
    tabRow: {
      display: "flex", gap: "4px", marginBottom: "24px",
      background: C.card2, borderRadius: "10px", padding: "4px",
    },
    tab: (active) => ({
      flex: 1, textAlign: "center", padding: "10px", borderRadius: "8px",
      fontSize: "14px", fontWeight: 600, cursor: "pointer", border: "none",
      transition: "all 0.2s",
      background: active ? C.blue : "transparent",
      color: active ? "#fff" : C.text3,
    }),
    label: {
      display: "block", fontSize: "13px", fontWeight: 600,
      color: C.text2, marginBottom: "6px",
    },
    input: {
      width: "100%", padding: "12px 14px", borderRadius: "10px",
      border: `1px solid ${C.border}`, background: C.card2,
      color: C.text1, fontSize: "14px", outline: "none",
      transition: "border-color 0.2s", boxSizing: "border-box",
    },
    inputGroup: {
      marginBottom: "16px",
    },
    btn: {
      width: "100%", padding: "14px", borderRadius: "12px",
      fontSize: "15px", fontWeight: 700, border: "none", cursor: "pointer",
      background: C.blue, color: "#fff", transition: "all 0.2s",
      opacity: loading ? 0.6 : 1, marginTop: "8px",
    },
    divider: {
      display: "flex", alignItems: "center", gap: "12px",
      margin: "20px 0", color: C.text3, fontSize: "12px",
    },
    divLine: {
      flex: 1, height: "1px", background: C.border,
    },
    oauthRow: {
      display: "flex", gap: "10px",
    },
    error: {
      background: C.redBg, color: C.red, padding: "10px 14px", borderRadius: "10px",
      fontSize: "13px", marginBottom: "16px", textAlign: "center",
    },
    success: {
      background: C.greenBg, color: C.green, padding: "10px 14px", borderRadius: "10px",
      fontSize: "13px", marginBottom: "16px", textAlign: "center",
    },
    link: {
      color: C.blue, cursor: "pointer", fontSize: "13px", fontWeight: 600,
      background: "none", border: "none", padding: 0,
    },
    footer: {
      textAlign: "center", marginTop: "20px", fontSize: "13px", color: C.text3,
    },
  };

  const content = (
    <>
        {/* ── 카드 ── */}
        <div style={embedded ? {} : S.card}>
          {/* 탭 (reset 모드에선 숨김) */}
          {mode !== "reset" && (
            <div style={S.tabRow}>
              <button style={S.tab(mode === "login")} onClick={() => { setMode("login"); setError(""); setSuccess(""); }}>
                로그인
              </button>
              <button style={S.tab(mode === "signup")} onClick={() => { setMode("signup"); setError(""); setSuccess(""); }}>
                회원가입
              </button>
            </div>
          )}

          {mode === "reset" && (
            <div style={{ marginBottom: "20px" }}>
              <button onClick={() => { setMode("login"); setError(""); setSuccess(""); }}
                style={{ ...S.link, fontSize: "13px", display: "flex", alignItems: "center", gap: "4px" }}>
                ← 로그인으로 돌아가기
              </button>
              <h3 style={{ color: C.text1, fontSize: "18px", fontWeight: 700, margin: "12px 0 4px" }}>
                비밀번호 재설정
              </h3>
              <p style={{ color: C.text3, fontSize: "13px", margin: 0 }}>
                가입한 이메일을 입력하면 재설정 링크를 보내드립니다.
              </p>
            </div>
          )}

          {error && <div style={S.error}>{error}</div>}
          {success && <div style={S.success}>{success}</div>}

          <form onSubmit={handleSubmit}>
            {mode === "signup" && (
              <div style={S.inputGroup}>
                <label style={S.label}>닉네임</label>
                <input
                  type="text" placeholder="표시될 이름" value={displayName}
                  onChange={e => setDisplayName(e.target.value)}
                  style={S.input}
                  onFocus={e => e.target.style.borderColor = C.blue}
                  onBlur={e => e.target.style.borderColor = C.border}
                />
              </div>
            )}
            <div style={S.inputGroup}>
              <label style={S.label}>이메일</label>
              <input
                type="email" placeholder="name@example.com" value={email}
                onChange={e => setEmail(e.target.value)} required
                style={{...S.input, borderColor: email && !validateEmail(email) ? C.red : C.border}}
                onFocus={e => e.target.style.borderColor = C.blue}
                onBlur={e => e.target.style.borderColor = email && !validateEmail(email) ? C.red : C.border}
              />
              {email && !validateEmail(email) && (
                <div style={{ color: C.red, fontSize: "12px", marginTop: "4px", fontWeight: 500 }}>
                  유효한 이메일 형식을 입력해주세요
                </div>
              )}
            </div>
            {mode !== "reset" && (
              <div style={S.inputGroup}>
                <label style={S.label}>비밀번호</label>
                <input
                  type="password" placeholder={mode === "signup" ? "6자 이상" : "비밀번호 입력"}
                  value={password} onChange={e => setPassword(e.target.value)} required
                  style={S.input}
                  onFocus={e => e.target.style.borderColor = C.blue}
                  onBlur={e => e.target.style.borderColor = C.border}
                />
              </div>
            )}

            <button type="submit" style={S.btn} disabled={loading}>
              {loading ? "처리 중..." : mode === "login" ? "로그인" : mode === "signup" ? "가입하기" : "재설정 링크 보내기"}
            </button>
          </form>

          {mode === "login" && (
            <div style={{ textAlign: "right", marginTop: "10px" }}>
              <button onClick={() => { setMode("reset"); setError(""); setSuccess(""); }} style={S.link}>
                비밀번호를 잊으셨나요?
              </button>
            </div>
          )}

          {/* ── 소셜 로그인 (Google만) ── */}
          {mode !== "reset" && (
            <>
              <div style={S.divider}>
                <div style={S.divLine} />
                <span>또는</span>
                <div style={S.divLine} />
              </div>
              <button onClick={() => handleOAuth("google")} disabled={loading} style={{
                width: "100%", display: "flex", alignItems: "center", justifyContent: "center",
                gap: "10px", padding: "13px", borderRadius: "12px", fontSize: "14px",
                fontWeight: 600, border: `1px solid ${C.border}`, cursor: loading ? "default" : "pointer",
                background: C.isDark ? "#fff" : "#fff", color: "#333", transition: "all 0.2s",
              }}>
                <svg width="18" height="18" viewBox="0 0 24 24">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
                Google 계정으로 {mode === "signup" ? "가입하기" : "로그인"}
              </button>
            </>
          )}
        </div>

        {/* ── 풋터 ── */}
        <div style={S.footer}>
          {mode === "login"
            ? <span>계정이 없으신가요? <button onClick={() => { setMode("signup"); setError(""); setSuccess(""); }} style={S.link}>가입하기</button></span>
            : mode === "signup"
            ? <span>이미 계정이 있으신가요? <button onClick={() => { setMode("login"); setError(""); setSuccess(""); }} style={S.link}>로그인</button></span>
            : null}
        </div>
    </>
  );

  if (embedded) return content;

  return (
    <div style={S.wrap}>
      <div style={S.container}>
        {/* ── 로고 ── */}
        <div style={S.logo}>
          <div style={S.logoIcon}>🐋</div>
          <h1 style={S.logoTitle}>
            DI금융 <span style={S.logoVer}>v10.2</span>
          </h1>
          <p style={S.logoSub}>전문 투자 스크리너 & 퀀트 엔진</p>
        </div>
        {content}
      </div>
    </div>
  );
}
