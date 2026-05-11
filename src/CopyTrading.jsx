// ══════════════════════════════════════════════════════════════════
// Zepta — 카피트레이딩 페이지 (/copy-trading)
// ──────────────────────────────────────────────────────────────────
// ⚠️ 법적 안전 모드:
//   한국 자본시장법: 투자일임업 인가 없이 사용자 대신 매매 X.
//   이 페이지는 두 가지 모드만 지원:
//   1) 신호 알림(alert): 다른 봇 진입/청산 시 알림만 푸시 — 매매는 본인이
//   2) 설정 복사(copy): 그 봇의 strategy/parameter 만 복사 — 이후 독립 운영
//
//   자동 미러 매매는 절대 제공하지 않습니다.
//
// UI:
//   1) 노란색 면책 배너 (상단 고정)
//   2) 팔로우 가능한 봇 리스트 (leaderboard API 활용)
//   3) 각 봇 카드: 누적 수익률 + Sharpe + 익명 닉네임 + 팔로우 버튼
//   4) 팔로우 모드 선택 (radio: alert | copy)
//   5) 면책 모달 — 팔로우 누르기 전 강제 표시
//   6) 내가 팔로우 중인 봇 섹션
//
// API:
//   - GET  /api/leaderboard         (팔로우 가능한 봇 ranking)
//   - GET  /api/follow/list?uid=    (내 팔로우 목록)
//   - POST /api/follow/list         (추가/해제/모드 변경)
//   - POST /api/follow/copy-config  (설정 복사)
// ══════════════════════════════════════════════════════════════════
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useThemeTokens, FONT, RADIUS } from "./ui/theme.jsx";
import { useAuth } from "./AuthProvider.jsx";

// ── 한국어 라벨 ────────────────────────────────────────────────────
const BOT_NAME_KO = {
  "btc-alpha":        "BTC 알파",
  "highcap-momentum": "대형코인 모멘텀",
  "defi-infra":       "DeFi 인프라",
  "meme-trend":       "밈코인 트렌드",
  "l2-emerging":      "L2 신흥",
  "crypto-diversity": "크립토 분산",
  "crypto-swing":     "크립토 스윙",
  "stable-quant":     "안정형 퀀트",
  "balanced-quant":   "균형형 퀀트",
  "aggressive-quant": "공격형 퀀트",
  "trend-follow":     "추세 추종",
  "mean-reversion":   "평균 회귀",
  "ensemble-signal":  "앙상블 시그널",
};

// ── 헬퍼 ──────────────────────────────────────────────────────────
const fmtPct = (v, d = 1) => (v == null || !isFinite(v)) ? "—" : `${Number(v) >= 0 ? "+" : ""}${Number(v).toFixed(d)}%`;
const fmtNum = (v, d = 2) => (v == null || !isFinite(v)) ? "—" : Number(v).toFixed(d);

// ── primitives ────────────────────────────────────────────────────
function Card({ children, style, ...rest }) {
  const C = useThemeTokens();
  return (
    <div
      style={{
        background: C.card, border: `1px solid ${C.border}`,
        borderRadius: RADIUS.lg, padding: 16,
        boxShadow: C.cardShadow, ...style,
      }}
      {...rest}
    >{children}</div>
  );
}

// ── 면책 모달 ──────────────────────────────────────────────────────
function DisclaimerModal({ open, targetBot, mode, setMode, onCancel, onConfirm, loading }) {
  const C = useThemeTokens();
  const [agreed, setAgreed] = useState(false);

  useEffect(() => {
    if (open) setAgreed(false);
  }, [open]);

  if (!open) return null;

  const modeLabel = mode === "alert" ? "신호 알림" : "설정 복사";
  const modeDesc = mode === "alert"
    ? "이 봇이 진입·청산할 때마다 알림만 받습니다. 매매는 본인이 직접 결정합니다."
    : "이 봇의 strategy / parameter 만 내 봇에 한 번 복사합니다. 이후 두 봇은 독립 운영됩니다.";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="카피트레이딩 면책 동의"
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "rgba(0,0,0,0.6)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 16,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div style={{
        background: C.card, borderRadius: RADIUS.xl,
        maxWidth: 520, width: "100%",
        maxHeight: "90vh", overflowY: "auto",
        border: `1px solid ${C.border}`,
        boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
      }}>
        {/* 헤더 */}
        <div style={{ padding: 20, borderBottom: `1px solid ${C.border}` }}>
          <div style={{ fontSize: FONT.xs, color: C.yellow, fontWeight: 800, marginBottom: 4 }}>
            ⚠️ 카피트레이딩 면책 동의
          </div>
          <h2 style={{ fontSize: FONT.lg, fontWeight: 800, color: C.text1, margin: 0 }}>
            {BOT_NAME_KO[targetBot] || targetBot}
          </h2>
        </div>

        {/* 본문 */}
        <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
          {/* 모드 선택 */}
          <div>
            <div style={{ fontSize: FONT.xs, color: C.text3, fontWeight: 700, marginBottom: 8 }}>팔로우 방식</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <label style={{
                display: "flex", alignItems: "flex-start", gap: 10,
                padding: 12, borderRadius: RADIUS.md,
                border: `1px solid ${mode === "alert" ? C.blue : C.border}`,
                background: mode === "alert" ? C.blueBg : "transparent",
                cursor: "pointer",
              }}>
                <input
                  type="radio"
                  name="copy-mode"
                  value="alert"
                  checked={mode === "alert"}
                  onChange={() => setMode("alert")}
                  style={{ marginTop: 3 }}
                />
                <div>
                  <div style={{ fontSize: FONT.sm, fontWeight: 700, color: C.text1 }}>신호 알림만 받기</div>
                  <div style={{ fontSize: FONT.xs, color: C.text3, marginTop: 2, lineHeight: 1.5 }}>
                    이 봇의 진입·청산 시점을 텔레그램·앱으로 알려드려요. <strong>매매 실행은 본인이 직접</strong> 합니다.
                  </div>
                </div>
              </label>
              <label style={{
                display: "flex", alignItems: "flex-start", gap: 10,
                padding: 12, borderRadius: RADIUS.md,
                border: `1px solid ${mode === "copy" ? C.purple : C.border}`,
                background: mode === "copy" ? C.purpleBg : "transparent",
                cursor: "pointer",
              }}>
                <input
                  type="radio"
                  name="copy-mode"
                  value="copy"
                  checked={mode === "copy"}
                  onChange={() => setMode("copy")}
                  style={{ marginTop: 3 }}
                />
                <div>
                  <div style={{ fontSize: FONT.sm, fontWeight: 700, color: C.text1 }}>설정 복사 (1회)</div>
                  <div style={{ fontSize: FONT.xs, color: C.text3, marginTop: 2, lineHeight: 1.5 }}>
                    이 봇의 strategy / parameter 를 내 봇에 한 번 복사합니다. <strong>이후 두 봇은 독립 운영</strong> 됩니다.
                    실시간 미러링은 하지 않아요.
                  </div>
                </div>
              </label>
            </div>
          </div>

          {/* 면책 텍스트 */}
          <div style={{
            background: C.yellowBg, border: `1px solid ${C.yellow}40`,
            borderRadius: RADIUS.md, padding: 14,
          }}>
            <div style={{ fontSize: FONT.xs, color: C.text2, lineHeight: 1.7 }}>
              <strong style={{ color: C.text1, display: "block", marginBottom: 6 }}>
                {modeLabel} 동의 사항
              </strong>
              <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4 }}>
                <li>{modeDesc}</li>
                <li>이 기능은 <strong>매매를 대신 실행하지 않습니다</strong>. Zepta 는 투자일임업이 아닙니다.</li>
                <li>신호 알림 / 설정 복사 후의 모든 매매와 결과는 <strong>본인 책임</strong>입니다.</li>
                <li>과거 성과는 미래 수익을 보장하지 않으며, <strong>손실이 발생할 수 있습니다</strong>.</li>
                <li>언제든 본인의 봇 설정을 직접 수정·중단할 수 있습니다.</li>
              </ul>
            </div>
          </div>

          {/* 체크박스 */}
          <label style={{ display: "flex", alignItems: "flex-start", gap: 8, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              style={{ marginTop: 3 }}
            />
            <span style={{ fontSize: FONT.sm, color: C.text2, lineHeight: 1.5 }}>
              위 내용을 모두 확인했고, <strong style={{ color: C.text1 }}>본인 책임 하에 진행</strong>하는 것에 동의합니다.
            </span>
          </label>
        </div>

        {/* 푸터 */}
        <div style={{
          padding: 16, borderTop: `1px solid ${C.border}`,
          display: "flex", justifyContent: "flex-end", gap: 8,
        }}>
          <button
            onClick={onCancel}
            disabled={loading}
            style={{
              padding: "8px 16px", borderRadius: RADIUS.md,
              background: "transparent", border: `1px solid ${C.border}`,
              color: C.text2, fontSize: FONT.sm, fontWeight: 600,
              cursor: "pointer",
            }}
          >취소</button>
          <button
            onClick={onConfirm}
            disabled={!agreed || loading}
            style={{
              padding: "8px 16px", borderRadius: RADIUS.md,
              background: agreed ? C.blue : C.border,
              border: "none", color: "#fff",
              fontSize: FONT.sm, fontWeight: 700,
              cursor: agreed && !loading ? "pointer" : "not-allowed",
              opacity: agreed && !loading ? 1 : 0.6,
            }}
          >{loading ? "처리 중…" : `${modeLabel}로 팔로우`}</button>
        </div>
      </div>
    </div>
  );
}

// ── 메인 ──────────────────────────────────────────────────────────
export default function CopyTrading({ onNavigate } = {}) {
  const C = useThemeTokens();
  const { user } = useAuth();
  const uid = user?.id || null;

  const [leaderboard, setLeaderboard] = useState(null);
  const [follows, setFollows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  // 면책 모달 상태
  const [modalBot, setModalBot] = useState(null);
  const [modalMode, setModalMode] = useState("alert");
  const [modalLoading, setModalLoading] = useState(false);

  const loadLeaderboard = useCallback(async () => {
    try {
      const r = await fetch("/api/leaderboard?type=overall&sort=sharpe&limit=20");
      const json = await r.json();
      setLeaderboard(json);
    } catch (e) {
      setErr(e?.message || String(e));
    }
  }, []);

  const loadFollows = useCallback(async () => {
    if (!uid) { setFollows([]); return; }
    try {
      const r = await fetch(`/api/follow/list?uid=${encodeURIComponent(uid)}`);
      const json = await r.json();
      if (json?.ok) setFollows(json.follows || []);
    } catch (e) {
      console.warn("[CopyTrading] loadFollows failed:", e);
    }
  }, [uid]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await Promise.all([loadLeaderboard(), loadFollows()]);
      setLoading(false);
    })();
  }, [loadLeaderboard, loadFollows]);

  // 팔로우 시작 (모달 열기)
  const startFollow = useCallback((botId) => {
    if (!uid) {
      alert("로그인 후 이용해주세요.");
      return;
    }
    setModalBot(botId);
    setModalMode("alert");
  }, [uid]);

  // 모달 confirm
  const confirmFollow = useCallback(async () => {
    if (!modalBot || !uid) return;
    setModalLoading(true);
    try {
      // 1) follow/list 에 추가
      const r1 = await fetch("/api/follow/list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          uid, action: "add",
          targetBotId: modalBot,
          mode: modalMode,
          ackDisclaimer: true,
        }),
      });
      const j1 = await r1.json();
      if (!j1.ok && !j1.alreadyFollowing) throw new Error(j1.error || "팔로우 실패");

      // 2) 설정 복사 모드면 copy-config 도 호출
      if (modalMode === "copy") {
        const r2 = await fetch("/api/follow/copy-config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            uid,
            sourceBotId: modalBot,
            ackDisclaimer: true,
          }),
        });
        const j2 = await r2.json();
        if (!j2.ok && r2.status !== 429) {
          console.warn("[copy-config] failed:", j2.error);
        }
      }

      await loadFollows();
      setModalBot(null);
    } catch (e) {
      alert(`팔로우 실패: ${e?.message || String(e)}`);
    } finally {
      setModalLoading(false);
    }
  }, [modalBot, modalMode, uid, loadFollows]);

  const unfollow = useCallback(async (targetBotId) => {
    if (!uid) return;
    if (!confirm("이 봇 팔로우를 해제할까요?")) return;
    try {
      await fetch("/api/follow/list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uid, action: "remove", targetBotId }),
      });
      await loadFollows();
    } catch (e) {
      console.warn("[unfollow] failed:", e);
    }
  }, [uid, loadFollows]);

  const changeMode = useCallback(async (targetBotId, mode) => {
    if (!uid) return;
    try {
      await fetch("/api/follow/list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uid, action: "set-mode", targetBotId, mode }),
      });
      await loadFollows();
    } catch (e) {
      console.warn("[set-mode] failed:", e);
    }
  }, [uid, loadFollows]);

  // leaderboard 엔트리 중 봇별로 상위 1개씩만 표시 (사용자 봇 vs 서비스 봇 혼재)
  const followableBots = useMemo(() => {
    if (!leaderboard?.entries) return [];
    const seen = new Map();
    for (const e of leaderboard.entries) {
      if (!seen.has(e.botId)) seen.set(e.botId, e);
    }
    return Array.from(seen.values()).sort((a, b) => (b.sharpe || 0) - (a.sharpe || 0));
  }, [leaderboard]);

  const followedSet = useMemo(() => new Set(follows.map(f => f.targetBotId)), [follows]);

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "16px", display: "flex", flexDirection: "column", gap: 12 }}>
      {/* 헤더 */}
      <div>
        <h1 style={{ fontSize: FONT["2xl"], fontWeight: 800, color: C.text1, margin: 0 }}>
          카피트레이딩
        </h1>
        <p style={{ fontSize: FONT.sm, color: C.text3, margin: "6px 0 0 0" }}>
          다른 봇의 진입·청산을 알림으로 받거나, strategy / parameter 만 복사해 내 봇을 운영해보세요.
        </p>
      </div>

      {/* ⚠️ 노란색 면책 배너 — 페이지 최상단 (법적 안전) */}
      <Card style={{ background: C.yellowBg, border: `1px solid ${C.yellow}` }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
          <div style={{ fontSize: FONT.xl, lineHeight: 1 }}>⚠️</div>
          <div style={{ fontSize: FONT.xs, color: C.text2, lineHeight: 1.7 }}>
            <strong style={{ color: C.text1 }}>투자 권유 아님 · 본인 책임 원칙.</strong>{" "}
            Zepta 카피트레이딩은 <strong>신호 알림</strong> 또는 <strong>설정 복사</strong>만 제공합니다.
            매매는 사용자가 직접 결정·실행하며, Zepta 는 자동 미러 매매를 제공하지 않습니다.
            과거 수익률은 미래를 보장하지 않으며, 손실 가능성이 있습니다.
          </div>
        </div>
      </Card>

      {/* 로그인 안내 */}
      {!uid && (
        <Card style={{ background: C.blueBg, border: `1px solid ${C.blueL}40` }}>
          <div style={{ fontSize: FONT.sm, color: C.text2, lineHeight: 1.6 }}>
            팔로우 기능을 사용하려면 <strong style={{ color: C.text1 }}>로그인이 필요</strong>합니다.
            상단 메뉴에서 로그인해주세요.
          </div>
        </Card>
      )}

      {/* 내가 팔로우 중인 봇 */}
      {uid && follows.length > 0 && (
        <Card>
          <div style={{ marginBottom: 12 }}>
            <h2 style={{ fontSize: FONT.lg, fontWeight: 700, color: C.text1, margin: 0 }}>
              내가 팔로우 중인 봇 ({follows.length})
            </h2>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {follows.map(f => (
              <div key={f.targetBotId} style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                gap: 12, flexWrap: "wrap",
                padding: 12, borderRadius: RADIUS.md,
                background: C.card2, border: `1px solid ${C.border}`,
              }}>
                <div>
                  <div style={{ fontSize: FONT.sm, fontWeight: 700, color: C.text1 }}>
                    {BOT_NAME_KO[f.targetBotId] || f.targetBotId}
                  </div>
                  <div style={{ fontSize: FONT.xs, color: C.text3, marginTop: 2 }}>
                    {f.mode === "alert" ? "신호 알림" : "설정 복사 완료"}
                    {f.followedAt && ` · ${new Date(f.followedAt).toLocaleDateString("ko-KR")}`}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <select
                    value={f.mode}
                    onChange={(e) => changeMode(f.targetBotId, e.target.value)}
                    style={{
                      padding: "6px 10px", borderRadius: RADIUS.sm,
                      background: C.card, border: `1px solid ${C.border}`,
                      color: C.text1, fontSize: FONT.xs, cursor: "pointer",
                    }}
                  >
                    <option value="alert">신호 알림</option>
                    <option value="copy">설정 복사</option>
                  </select>
                  <button
                    onClick={() => unfollow(f.targetBotId)}
                    style={{
                      padding: "6px 12px", borderRadius: RADIUS.sm,
                      background: "transparent", border: `1px solid ${C.red}40`,
                      color: C.red, fontSize: FONT.xs, fontWeight: 700, cursor: "pointer",
                    }}
                  >해제</button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* 팔로우 가능한 봇 리스트 */}
      <Card>
        <div style={{ marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <h2 style={{ fontSize: FONT.lg, fontWeight: 700, color: C.text1, margin: 0 }}>
            팔로우 가능한 봇
          </h2>
          <div style={{ fontSize: FONT.xs, color: C.text3 }}>
            안정성(Sharpe) 순 · {followableBots.length}개
          </div>
        </div>

        {err && (
          <div style={{ padding: 16, color: C.red, fontSize: FONT.sm }}>오류: {err}</div>
        )}

        {!err && loading && (
          <div style={{ padding: 24, textAlign: "center", color: C.text3, fontSize: FONT.sm }}>
            불러오는 중…
          </div>
        )}

        {!err && !loading && followableBots.length === 0 && (
          <div style={{ padding: 24, textAlign: "center", color: C.text3, fontSize: FONT.sm }}>
            아직 등록된 봇이 없습니다. 리더보드가 누적된 후 다시 확인해주세요.
          </div>
        )}

        {!err && !loading && followableBots.length > 0 && (
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
            gap: 12,
          }}>
            {followableBots.map(b => {
              const isFollowing = followedSet.has(b.botId);
              const followRec = follows.find(f => f.targetBotId === b.botId);
              return (
                <div key={b.botId} style={{
                  padding: 14, borderRadius: RADIUS.md,
                  background: C.card2,
                  border: `1px solid ${isFollowing ? C.blue : C.border}`,
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                    <div>
                      <div style={{ fontSize: FONT.sm, fontWeight: 700, color: C.text1 }}>
                        {BOT_NAME_KO[b.botId] || b.botId}
                      </div>
                      <div style={{ fontSize: FONT.xs, color: C.text3, marginTop: 2 }}>
                        {b.nick || b.userHash || "익명"}
                      </div>
                    </div>
                    {isFollowing && (
                      <span style={{
                        fontSize: FONT.xs, fontWeight: 700,
                        color: C.blue,
                        padding: "2px 8px", borderRadius: RADIUS.full,
                        background: C.blueBg, border: `1px solid ${C.blue}40`,
                      }}>{followRec?.mode === "copy" ? "복사 중" : "알림 중"}</span>
                    )}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 12 }}>
                    <div>
                      <div style={{ fontSize: FONT.xs, color: C.text3 }}>수익률</div>
                      <div style={{ fontSize: FONT.sm, fontWeight: 700, color: (b.returnPct || 0) >= 0 ? C.green : C.red }}>
                        {fmtPct(b.returnPct, 1)}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: FONT.xs, color: C.text3 }}>안정성</div>
                      <div style={{ fontSize: FONT.sm, fontWeight: 700, color: C.text1 }}>
                        {fmtNum(b.sharpe)}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: FONT.xs, color: C.text3 }}>MDD</div>
                      <div style={{ fontSize: FONT.sm, fontWeight: 700, color: C.red }}>
                        {fmtPct(-Math.abs(b.mdd || 0), 1)}
                      </div>
                    </div>
                  </div>
                  {isFollowing ? (
                    <button
                      onClick={() => unfollow(b.botId)}
                      style={{
                        width: "100%", padding: "8px 12px", borderRadius: RADIUS.sm,
                        background: "transparent", border: `1px solid ${C.border}`,
                        color: C.text2, fontSize: FONT.xs, fontWeight: 700, cursor: "pointer",
                      }}
                    >팔로우 해제</button>
                  ) : (
                    <button
                      onClick={() => startFollow(b.botId)}
                      disabled={!uid}
                      style={{
                        width: "100%", padding: "8px 12px", borderRadius: RADIUS.sm,
                        background: uid ? C.blue : C.border,
                        border: "none", color: "#fff",
                        fontSize: FONT.xs, fontWeight: 700,
                        cursor: uid ? "pointer" : "not-allowed",
                        opacity: uid ? 1 : 0.6,
                      }}
                    >팔로우</button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* 푸터 안내 */}
      <div style={{ fontSize: FONT.xs, color: C.text3, lineHeight: 1.6, padding: "8px 4px" }}>
        ※ <strong>신호 알림</strong> 은 따라가고 싶은 봇의 진입·청산 시점을 알려드립니다.{" "}
        매매는 본인이 직접 결정·실행합니다.{" "}
        <strong>설정 복사</strong> 는 그 봇의 strategy / parameter 만 한 번 복사하며, 이후 두 봇은 독립 운영됩니다.{" "}
        Zepta 는 사용자 대신 매매를 실행하지 않습니다 (한국 자본시장법 준수).
      </div>

      {/* 면책 모달 */}
      <DisclaimerModal
        open={!!modalBot}
        targetBot={modalBot}
        mode={modalMode}
        setMode={setModalMode}
        onCancel={() => { setModalBot(null); setModalLoading(false); }}
        onConfirm={confirmFollow}
        loading={modalLoading}
      />
    </div>
  );
}
