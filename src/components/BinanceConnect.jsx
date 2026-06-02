// ════════════════════════════════════════════════════════════════════
// BinanceConnect — 바이낸스 Futures API 키 등록·연결 상태 UI
//
// 사용처:
//   - RealTrading.jsx 상단 (creds 없으면 노출)
//   - /settings 또는 별도 페이지에서도 단독 사용 가능
//
// 동작:
//   1) /api/binance/status 로 현재 연결 상태 조회 (mount + refreshKey 변경)
//   2) 미연결 → 폼 노출 (apiKey, apiSecret, testnet, label)
//   3) 연결됨 → 마스킹 키 + 잔고 + 해제 버튼
//   4) 폼 제출 → /api/binance/connect → 응답에 따라 토스트
//
// Props:
//   - userId (필수)
//   - onConnected?: () => void  연결 성공 시 부모에게 알림 (RealTrading refresh)
//   - theme?: "dark" | "light"
//   - useToastFn?: () => { push } useToast 훅 결과 전달 (없으면 alert fallback)
// ════════════════════════════════════════════════════════════════════

import { useState, useEffect, useCallback } from "react";
import { ga } from "../lib/analytics.js";
import { supabase } from "../supabaseClient.js";

const colors = {
  dark: {
    bg: "var(--color-bg, #060a12)",
    card: "var(--color-card, #1a1f2e)",
    card2: "var(--color-card2, #0f1521)",
    border: "var(--color-border, #2a3f5f)",
    blue: "var(--color-blue, #3182f6)",
    green: "var(--color-green, #00d47e)",
    red: "var(--color-red, #ff4d5e)",
    yellow: "var(--color-yellow, #ffb020)",
    text1: "var(--color-text1, #f7f8fa)",
    text2: "var(--color-text2, #b0b8c1)",
    text3: "var(--color-text3, #6b7d8e)",
  },
};

async function authHeaders() {
  try {
    const { data } = await supabase.auth.getSession();
    const t = data?.session?.access_token;
    return t ? { Authorization: `Bearer ${t}` } : {};
  } catch { return {}; }
}
async function jget(url) {
  const r = await fetch(url, { credentials: "same-origin", headers: { ...(await authHeaders()) } });
  return r.json();
}
async function jpost(url, body) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(body || {}),
  });
  return r.json();
}

export default function BinanceConnect({ userId, onConnected, theme = "dark", useToastFn }) {
  const c = colors[theme] || colors.dark;
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState(null); // {connected, label, masked, ...}
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ apiKey: "", apiSecret: "", testnet: false, label: "Binance Futures" });
  const [error, setError] = useState(null);

  const toast = useToastFn ? useToastFn() : null;
  const notify = useCallback((msg, opts = {}) => {
    if (toast?.push) toast.push(msg, opts);
    else if (opts.tone === "red") console.error(msg);
    else console.log(msg);
  }, [toast]);

  const refresh = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const s = await jget(`/api/binance/status?userId=${encodeURIComponent(userId)}`);
      setStatus(s || { connected: false });
    } catch (e) {
      setStatus({ connected: false, error: e?.message });
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { refresh(); }, [refresh]);

  const handleSubmit = async (e) => {
    e?.preventDefault?.();
    setError(null);
    if (!form.apiKey || form.apiKey.length < 10) { setError("API Key 가 너무 짧습니다."); return; }
    if (!form.apiSecret || form.apiSecret.length < 10) { setError("API Secret 이 너무 짧습니다."); return; }
    // GA4 — 바이낸스 연동 클릭 (폼 제출 시점)
    ga.binanceConnectClicked();
    setBusy(true);
    try {
      const r = await jpost("/api/binance/connect", {
        userId,
        apiKey: form.apiKey.trim(),
        apiSecret: form.apiSecret.trim(),
        testnet: !!form.testnet,
        label: form.label?.trim() || (form.testnet ? "Binance Testnet" : "Binance Futures"),
      });
      if (!r?.ok) {
        const msg = r?.error || "등록 실패";
        const detail = r?.detail ? ` — ${r.detail}` : "";
        const hint = r?.hint ? `\n💡 ${r.hint}` : "";
        setError(`${msg}${detail}${hint}`);
        notify(msg, { tone: "red", title: "연결 실패", duration: 6000 });
        return;
      }
      notify("바이낸스 API 키 등록 완료", { tone: "green", title: "✓ 연결 성공" });
      // GA4 — 바이낸스 연동 성공
      ga.binanceConnectSuccess();
      setShowForm(false);
      setForm({ apiKey: "", apiSecret: "", testnet: false, label: "Binance Futures" });
      await refresh();
      onConnected?.();
    } catch (err) {
      const msg = err?.message || String(err);
      setError(msg);
      notify(msg, { tone: "red", title: "오류" });
    } finally {
      setBusy(false);
    }
  };

  const handleDisconnect = async () => {
    if (!userId) return;
    if (!window.confirm("정말 키 연결을 해제하시겠습니까? 자동매매가 즉시 중단됩니다.")) return;
    setBusy(true);
    try {
      const r = await jpost("/api/binance/disconnect", { userId });
      if (r?.ok) {
        notify("연결 해제 완료", { tone: "yellow" });
        await refresh();
      } else {
        notify(r?.error || "해제 실패", { tone: "red" });
      }
    } finally {
      setBusy(false);
    }
  };

  const cardBase = {
    background: c.card,
    border: `1px solid ${c.border}`,
    borderRadius: "16px",
    padding: "20px",
  };

  if (loading && !status) {
    return (
      <div style={{ ...cardBase, color: c.text3, fontSize: "14px" }}>
        🔍 바이낸스 연결 상태 확인 중...
      </div>
    );
  }

  // ─── 연결됨 ───
  if (status?.connected) {
    return (
      <div style={cardBase}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div style={{
              width: "40px", height: "40px", borderRadius: "10px",
              background: `${c.green}18`,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: "20px",
            }}>✓</div>
            <div>
              <div style={{ fontSize: "15px", fontWeight: 700, color: c.text1, letterSpacing: "-0.01em" }}>
                바이낸스 연결됨
                {status.testnet && (
                  <span style={{
                    marginLeft: "8px", fontSize: "12px", padding: "2px 8px",
                    background: `${c.yellow}20`, color: c.yellow, borderRadius: "999px",
                    fontWeight: 700,
                  }}>TESTNET</span>
                )}
              </div>
              <div style={{ fontSize: "12px", color: c.text3, marginTop: "2px" }}>
                {status.label || "Binance Futures"}
                {status.masked && <span style={{ marginLeft: "8px", fontFamily: "monospace" }}>· {status.masked}</span>}
              </div>
            </div>
          </div>
          <button
            onClick={handleDisconnect}
            disabled={busy}
            style={{
              padding: "8px 14px", minHeight: "36px",
              background: c.card2, color: c.text2,
              border: `1px solid ${c.border}`, borderRadius: "8px",
              fontSize: "14px", fontWeight: 600, cursor: busy ? "default" : "pointer",
            }}
          >연결 해제</button>
        </div>

        {/* 잔고 / 권한 요약 */}
        {(status.totalWalletBalance != null || status.canTrade != null) && (
          <div style={{
            marginTop: "14px",
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
            gap: "8px",
          }}>
            {status.totalWalletBalance != null && (
              <Stat c={c} label="총 잔고" value={`$${Number(status.totalWalletBalance).toLocaleString(undefined, { maximumFractionDigits: 2 })}`} />
            )}
            {status.availableBalance != null && (
              <Stat c={c} label="가용 잔고" value={`$${Number(status.availableBalance).toLocaleString(undefined, { maximumFractionDigits: 2 })}`} />
            )}
            <Stat c={c} label="Futures 매매" value={status.canTrade ? "허용" : "거부"} ok={status.canTrade} />
            <Stat c={c} label="출금 권한" value={status.canWithdraw ? "있음 ⚠" : "없음 ✓"} ok={!status.canWithdraw} />
          </div>
        )}
        {status.canWithdraw && (
          <div style={{
            marginTop: "10px", padding: "10px 12px",
            background: `${c.red}10`, border: `1px solid ${c.red}30`,
            borderRadius: "8px", fontSize: "12px", color: c.red, lineHeight: 1.5,
          }}>
            ⚠ 이 API 키에 <b>출금 권한</b>이 있습니다. 보안을 위해 바이낸스에서 키 편집 → "Enable Withdrawals" 체크를 해제하세요.
          </div>
        )}
      </div>
    );
  }

  // ─── 미연결 / 폼 ───
  return (
    <div style={cardBase}>
      <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "10px" }}>
        <div style={{
          width: "40px", height: "40px", borderRadius: "10px",
          background: `${c.yellow}18`,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: "20px",
        }}>🔑</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: "15px", fontWeight: 700, color: c.text1 }}>
            바이낸스 API 키 미등록
          </div>
          <div style={{ fontSize: "12px", color: c.text3, marginTop: "2px" }}>
            실전 자동매매를 시작하려면 Binance Futures API 키를 등록하세요
          </div>
        </div>
      </div>

      {!showForm ? (
        <button
          onClick={() => setShowForm(true)}
          style={{
            width: "100%", padding: "12px 16px", minHeight: "48px",
            background: c.blue, color: "#fff",
            border: "none", borderRadius: "12px",
            fontSize: "15px", fontWeight: 700, cursor: "pointer",
            transition: "opacity 0.15s",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = "0.92"; }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = "1"; }}
        >+ API 키 등록하기</button>
      ) : (
        <form onSubmit={handleSubmit} style={{ marginTop: "8px", display: "flex", flexDirection: "column", gap: "12px" }}>
          <FormField c={c} label="API Key" required>
            <input
              type="text"
              value={form.apiKey}
              onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
              placeholder="64자 영숫자 (Binance API Key)"
              autoComplete="off"
              spellCheck={false}
              style={inputStyle(c)}
            />
          </FormField>
          <FormField c={c} label="API Secret" required>
            <input
              type="password"
              value={form.apiSecret}
              onChange={(e) => setForm({ ...form, apiSecret: e.target.value })}
              placeholder="시크릿 키 (마스킹 후 암호화 저장)"
              autoComplete="off"
              spellCheck={false}
              style={inputStyle(c)}
            />
          </FormField>
          <FormField c={c} label="별명 (선택)">
            <input
              type="text"
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
              placeholder="Binance Futures"
              style={inputStyle(c)}
            />
          </FormField>
          <label style={{
            display: "flex", alignItems: "center", gap: "8px",
            padding: "10px 12px",
            background: c.card2, border: `1px solid ${c.border}`,
            borderRadius: "8px", cursor: "pointer",
            fontSize: "14px", color: c.text2,
          }}>
            <input
              type="checkbox"
              checked={form.testnet}
              onChange={(e) => setForm({ ...form, testnet: e.target.checked })}
              style={{ width: "16px", height: "16px", accentColor: c.blue }}
            />
            <span>테스트넷 키 사용 (testnet.binancefuture.com — 가짜 자금)</span>
          </label>

          {/* 안전 안내 */}
          <div style={{
            padding: "12px",
            background: `${c.blue}08`, border: `1px solid ${c.blue}25`,
            borderRadius: "8px", fontSize: "12px", color: c.text2, lineHeight: 1.55,
          }}>
            <div style={{ fontWeight: 700, color: c.blue, marginBottom: "4px" }}>🔒 보안 체크리스트</div>
            <div>• 바이낸스에서 <b>Futures Trade 권한 ON</b>, <b>Withdrawals 권한 OFF</b> 로 설정하세요</div>
            <div>• 키는 AES-256-GCM 으로 암호화되어 저장됩니다 (서버 메모리에 평문 노출 없음)</div>
            <div>• 처음이라면 <b>테스트넷 키</b>로 1주일 운영 후 실키 전환을 권장합니다</div>
          </div>

          {error && (
            <div style={{
              padding: "10px 12px",
              background: `${c.red}10`, border: `1px solid ${c.red}30`,
              borderRadius: "8px", fontSize: "14px", color: c.red,
              whiteSpace: "pre-line",
            }}>{error}</div>
          )}

          <div style={{ display: "flex", gap: "8px" }}>
            <button
              type="button"
              onClick={() => { setShowForm(false); setError(null); }}
              disabled={busy}
              style={{
                flex: 1, padding: "12px 16px", minHeight: "48px",
                background: c.card2, color: c.text2,
                border: `1px solid ${c.border}`, borderRadius: "12px",
                fontSize: "14px", fontWeight: 600, cursor: busy ? "default" : "pointer",
              }}
            >취소</button>
            <button
              type="submit"
              disabled={busy}
              style={{
                flex: 2, padding: "12px 16px", minHeight: "48px",
                background: busy ? c.text3 : c.blue, color: "#fff",
                border: "none", borderRadius: "12px",
                fontSize: "15px", fontWeight: 700, cursor: busy ? "default" : "pointer",
              }}
            >{busy ? "검증 중..." : "검증 + 등록"}</button>
          </div>
        </form>
      )}
    </div>
  );
}

function Stat({ c, label, value, ok }) {
  const color = ok === undefined ? c.text1 : ok ? c.green : c.red;
  return (
    <div style={{
      padding: "10px 12px", background: c.card2,
      border: `1px solid ${c.border}40`, borderRadius: "10px",
    }}>
      <div style={{ fontSize: "12px", color: c.text3, marginBottom: "3px", textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</div>
      <div style={{ fontSize: "14px", fontWeight: 700, color, letterSpacing: "-0.01em" }}>{value}</div>
    </div>
  );
}

function FormField({ c, label, required, children }) {
  return (
    <div>
      <div style={{ fontSize: "12px", color: c.text3, marginBottom: "6px", fontWeight: 600 }}>
        {label}{required && <span style={{ color: c.red, marginLeft: "3px" }}>*</span>}
      </div>
      {children}
    </div>
  );
}

function inputStyle(c) {
  return {
    width: "100%",
    padding: "10px 12px",
    minHeight: "44px",
    background: c.card2,
    color: c.text1,
    border: `1px solid ${c.border}`,
    borderRadius: "8px",
    fontSize: "14px",
    fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
    boxSizing: "border-box",
    outline: "none",
  };
}
