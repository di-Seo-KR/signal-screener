// ══════════════════════════════════════════════════════════════════
// Zepta — 입문자 온보딩 5스텝 (PLAN-SVC #5, 2026-05-11)
// ──────────────────────────────────────────────────────────────────
// 가입 직후 1회 자동 표시되는 풀스크린 모달.
//
// 5스텝:
//   1) 환영      — Zepta 소개 + 면책 명시
//   2) 관심 자산 — 주식/코인 토글 + 카테고리
//   3) 위험 성향 — 안정/균형/공격 + 추천 봇 1개
//   4) Binance  — 연결 안내 (선택, "나중에" 옵션)
//   5) 첫 시그널 — 추천 strategy 미리보기 + 다음 행동 CTA
//
// 저장:
//   - KV (Supabase user_metadata): `di:onboarding:<uid>`
//     { completed: bool, completedAt: ISO, step: number,
//       interests: string[], risk: 'safe'|'balanced'|'aggressive',
//       binanceConnected: bool }
//   - localStorage 캐시: `di:onboarding:<uid>` (즉시 반영)
//
// 호출 측 (App.jsx):
//   const [showOnboarding, setShowOnboarding] = useState(false);
//   useEffect(() => { if (user && !user_metadata.onboarding?.completed) setShowOnboarding(true); }, [user]);
//   {showOnboarding && <Onboarding onClose={...} onNavigate={(tab) => setTab(tab)} />}
// ══════════════════════════════════════════════════════════════════
import React, { useState, useCallback, useEffect } from "react";
import { useThemeTokens, FONT, RADIUS } from "./ui/theme.jsx";
import { useBreakpoint } from "./ui/useBreakpoint.jsx";
import { useAuth } from "./AuthProvider.jsx";
import { supabase } from "./supabaseClient.js";
import { ga } from "./lib/analytics.js";

const TOTAL_STEPS = 5;

// ── 관심 자산 카테고리 ──
const ASSET_CATEGORIES = {
  stock: [
    { id: "us-megacap",  label: "미국 메가캡",   desc: "애플 · 엔비디아 · MS 등" },
    { id: "kr-megacap",  label: "한국 대형주",   desc: "삼성전자 · SK하이닉스 등" },
    { id: "growth",      label: "성장주",        desc: "테슬라 · 팔란티어 등" },
    { id: "dividend",    label: "배당주",        desc: "안정적 현금흐름 종목" },
  ],
  coin: [
    { id: "btc-eth",     label: "BTC · ETH",     desc: "가장 큰 두 코인" },
    { id: "defi",        label: "DeFi",          desc: "UNI · AAVE · LDO 등" },
    { id: "meme",        label: "밈코인",        desc: "DOGE · SHIB · PEPE 등 (고위험)" },
    { id: "alt-major",   label: "메이저 알트",   desc: "SOL · BNB · XRP 등" },
  ],
};

// ── 위험 성향 → 추천 봇 매핑 ──
const RISK_PROFILES = [
  {
    id: "safe", emoji: "🛡️", label: "안정형",
    desc: "원금 보전이 1순위. 큰 손실 없이 꾸준한 수익을 선호해요.",
    botRecommend: "stable-dca",
    botLabel: "안정 DCA — 분할 매수로 변동성 흡수",
    expectedAnnual: "연 8~15%",
    drawdownGuide: "예상 최대 손실: 10% 이내",
  },
  {
    id: "balanced", emoji: "⚖️", label: "균형형",
    desc: "어느 정도 변동성은 감수. 시장 평균보다 나은 수익을 원해요.",
    botRecommend: "trend-momentum",
    botLabel: "추세 모멘텀 — 시장 흐름 따라 매매",
    expectedAnnual: "연 15~30%",
    drawdownGuide: "예상 최대 손실: 15~20%",
  },
  {
    id: "aggressive", emoji: "🚀", label: "공격형",
    desc: "큰 손실도 감내할 수 있음. 높은 수익률을 추구해요.",
    botRecommend: "breakout-leverage",
    botLabel: "돌파 매매 — 강한 신호에 집중 베팅",
    expectedAnnual: "연 30~60%",
    drawdownGuide: "예상 최대 손실: 25~40%",
  },
];

// 진행률 바
function ProgressBar({ step, total, C }) {
  const pct = (step / total) * 100;
  return (
    <div style={{ width: "100%", height: 6, background: C.card2, borderRadius: RADIUS.full, overflow: "hidden" }}>
      <div style={{
        height: "100%",
        width: `${pct}%`,
        background: `linear-gradient(90deg, ${C.blue} 0%, ${C.purple} 100%)`,
        transition: "width 0.4s cubic-bezier(0.16, 1, 0.3, 1)",
      }} />
    </div>
  );
}

// 선택 칩 (다중 선택)
function ChipMulti({ active, onClick, children, C }) {
  return (
    <button onClick={onClick} style={{
      padding: "10px 16px",
      background: active ? C.blueBg : C.card2,
      color: active ? C.blueL : C.text2,
      border: `1.5px solid ${active ? C.blue : C.border}`,
      borderRadius: RADIUS.full,
      fontSize: FONT.sm, fontWeight: 600,
      cursor: "pointer",
      transition: "all 0.18s",
    }}>
      {children}
    </button>
  );
}

// 큰 옵션 카드 (단일 선택)
function OptionCard({ active, onClick, emoji, label, desc, sub, C }) {
  return (
    <button onClick={onClick} style={{
      padding: 16,
      background: active ? C.blueBg : C.card2,
      border: `2px solid ${active ? C.blue : C.border}`,
      borderRadius: RADIUS.lg,
      cursor: "pointer",
      textAlign: "left",
      display: "flex", flexDirection: "column", gap: 8,
      transition: "all 0.18s",
      width: "100%",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {emoji && <span style={{ fontSize: 22 }}>{emoji}</span>}
        <span style={{ fontSize: FONT.lg, fontWeight: 700, color: C.text1 }}>{label}</span>
      </div>
      {desc && <div style={{ fontSize: FONT.sm, color: C.text2, lineHeight: 1.5 }}>{desc}</div>}
      {sub && <div style={{ fontSize: FONT.xs, color: C.text3 }}>{sub}</div>}
    </button>
  );
}

// 면책 배너 (모든 스텝에 깔리는 안내)
function DisclaimerBanner({ C }) {
  return (
    <div style={{
      padding: "8px 12px",
      background: C.yellowBg,
      border: `1px solid ${C.yellow}40`,
      borderRadius: RADIUS.sm,
      fontSize: FONT.xs, color: C.text2, lineHeight: 1.5,
    }}>
      ⚠ Zepta 는 매매 신호를 찾아주는 분석 도구입니다. 투자 권유가 아니며, 매매 결정과 손익은 본인 책임입니다.
    </div>
  );
}

export default function Onboarding({ onClose, onNavigate }) {
  const C = useThemeTokens();
  const { isMobile } = useBreakpoint();
  let auth = null;
  try { auth = useAuth(); } catch { auth = null; }
  const user = auth?.user;

  const [step, setStep] = useState(1);
  const [assetType, setAssetType] = useState("stock"); // 'stock' | 'coin'
  const [interests, setInterests] = useState([]); // ['us-megacap', ...]
  const [risk, setRisk] = useState(null);
  const [binanceConnected, setBinanceConnected] = useState(false);
  const [saving, setSaving] = useState(false);

  // ── KV 저장 함수 — Supabase user_metadata.onboarding ──
  const saveOnboarding = useCallback(async (partial = {}) => {
    if (!user?.id) return;
    const uid = user.id;
    const payload = {
      completed: partial.completed ?? false,
      completedAt: partial.completedAt || (partial.completed ? new Date().toISOString() : null),
      step: partial.step ?? step,
      interests: partial.interests ?? interests,
      risk: partial.risk ?? risk,
      binanceConnected: partial.binanceConnected ?? binanceConnected,
      version: 1,
    };
    // localStorage 즉시 반영
    try { localStorage.setItem(`di:onboarding:${uid}`, JSON.stringify(payload)); } catch {}
    // Supabase user_metadata 저장 (best-effort)
    try {
      const current = user.user_metadata || {};
      await supabase.auth.updateUser({ data: { ...current, onboarding: payload } });
    } catch (e) {
      console.warn("[Onboarding] save failed:", e?.message);
    }
  }, [user, step, interests, risk, binanceConnected]);

  // GA — 진입 1회
  useEffect(() => {
    ga.ctaClick("onboarding", "start");
  }, []);

  const handleSkip = useCallback(async () => {
    await saveOnboarding({ completed: true, completedAt: new Date().toISOString(), step });
    ga.ctaClick("onboarding", `skip-step-${step}`);
    if (typeof onClose === "function") onClose();
  }, [saveOnboarding, step, onClose]);

  const handleNext = useCallback(async () => {
    if (step < TOTAL_STEPS) {
      const next = step + 1;
      await saveOnboarding({ step: next });
      ga.ctaClick("onboarding", `next-step-${step}`);
      setStep(next);
    } else {
      // 완료
      setSaving(true);
      await saveOnboarding({ completed: true, completedAt: new Date().toISOString(), step: TOTAL_STEPS });
      ga.ctaClick("onboarding", "completed");
      setSaving(false);
      if (typeof onClose === "function") onClose();
    }
  }, [step, saveOnboarding, onClose]);

  const handlePrev = useCallback(() => {
    if (step > 1) setStep(step - 1);
  }, [step]);

  const toggleInterest = useCallback((id) => {
    setInterests(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }, []);

  // ── 각 스텝 콘텐츠 ──
  const StepContent = () => {
    if (step === 1) {
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ fontSize: isMobile ? 48 : 56, textAlign: "center", marginTop: 8 }}>👋</div>
          <div style={{ fontSize: isMobile ? FONT["2xl"] : FONT["3xl"], fontWeight: 800, color: C.text1, textAlign: "center" }}>
            Zepta 에 오신 걸 환영해요
          </div>
          <div style={{ fontSize: FONT.base, color: C.text2, lineHeight: 1.7, textAlign: "center" }}>
            Zepta 는 <b style={{ color: C.blueL }}>AI 가 매매 신호를 찾아주는 분석 도구</b>예요.<br/>
            시장을 24시간 추적하고, 가장 잘 작동하는 전략을 자동으로 골라줍니다.
          </div>
          <div style={{
            padding: 16, background: C.card2, borderRadius: RADIUS.lg,
            border: `1px solid ${C.border}`,
            display: "flex", flexDirection: "column", gap: 8,
          }}>
            <div style={{ fontSize: FONT.sm, fontWeight: 700, color: C.text1 }}>꼭 알아두세요</div>
            <ul style={{ margin: 0, padding: "0 0 0 20px", color: C.text2, fontSize: FONT.sm, lineHeight: 1.7 }}>
              <li>매매는 본인 의사로 직접 하셔야 해요</li>
              <li>표시되는 수치는 과거 데이터 시뮬레이션이에요</li>
              <li>수익률은 미래를 보장하지 않습니다</li>
              <li>손실이 발생할 수 있고, 모든 책임은 본인에게 있어요</li>
            </ul>
          </div>
          <div style={{ fontSize: FONT.xs, color: C.text3, textAlign: "center", lineHeight: 1.5 }}>
            5단계로 빠르게 설정해드릴게요 · 약 1분 소요
          </div>
        </div>
      );
    }

    if (step === 2) {
      const list = ASSET_CATEGORIES[assetType] || [];
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <div style={{ fontSize: isMobile ? FONT.xl : FONT["2xl"], fontWeight: 800, color: C.text1 }}>관심 있는 자산은?</div>
            <div style={{ fontSize: FONT.sm, color: C.text3, marginTop: 4 }}>
              여러 개 선택할 수 있어요. 이 정보로 맞춤 시그널을 보여드릴게요.
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setAssetType("stock")} style={{
              flex: 1, padding: "10px 16px",
              background: assetType === "stock" ? C.blueBg : C.card2,
              color: assetType === "stock" ? C.blueL : C.text2,
              border: `1.5px solid ${assetType === "stock" ? C.blue : C.border}`,
              borderRadius: RADIUS.md, fontSize: FONT.sm, fontWeight: 700, cursor: "pointer",
            }}>📈 주식</button>
            <button onClick={() => setAssetType("coin")} style={{
              flex: 1, padding: "10px 16px",
              background: assetType === "coin" ? C.blueBg : C.card2,
              color: assetType === "coin" ? C.blueL : C.text2,
              border: `1.5px solid ${assetType === "coin" ? C.blue : C.border}`,
              borderRadius: RADIUS.md, fontSize: FONT.sm, fontWeight: 700, cursor: "pointer",
            }}>🪙 코인</button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 10 }}>
            {list.map((c) => (
              <OptionCard
                key={c.id}
                active={interests.includes(c.id)}
                onClick={() => toggleInterest(c.id)}
                label={c.label}
                desc={c.desc}
                C={C}
              />
            ))}
          </div>
          <DisclaimerBanner C={C} />
        </div>
      );
    }

    if (step === 3) {
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <div style={{ fontSize: isMobile ? FONT.xl : FONT["2xl"], fontWeight: 800, color: C.text1 }}>위험 성향을 알려주세요</div>
            <div style={{ fontSize: FONT.sm, color: C.text3, marginTop: 4 }}>
              감내할 수 있는 손실 범위에 따라 맞춤 봇을 추천해드릴게요.
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {RISK_PROFILES.map((p) => (
              <OptionCard
                key={p.id}
                active={risk === p.id}
                onClick={() => setRisk(p.id)}
                emoji={p.emoji}
                label={p.label}
                desc={p.desc}
                sub={`추천 봇: ${p.botLabel} · ${p.expectedAnnual} · ${p.drawdownGuide}`}
                C={C}
              />
            ))}
          </div>
          <DisclaimerBanner C={C} />
        </div>
      );
    }

    if (step === 4) {
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <div style={{ fontSize: isMobile ? FONT.xl : FONT["2xl"], fontWeight: 800, color: C.text1 }}>Binance 연결 (선택)</div>
            <div style={{ fontSize: FONT.sm, color: C.text3, marginTop: 4 }}>
              자동매매 봇을 실제 거래소에 연결하려면 API 키가 필요해요. 지금 연결하지 않아도 시그널 분석은 모두 사용할 수 있어요.
            </div>
          </div>
          <div style={{
            padding: 16, background: C.card2, borderRadius: RADIUS.lg,
            border: `1px solid ${C.border}`,
          }}>
            <div style={{ fontSize: FONT.sm, fontWeight: 700, color: C.text1, marginBottom: 8 }}>🔒 안전합니다</div>
            <ul style={{ margin: 0, padding: "0 0 0 20px", color: C.text2, fontSize: FONT.sm, lineHeight: 1.7 }}>
              <li>API 키는 암호화되어 저장됩니다</li>
              <li>출금 권한은 절대 받지 않습니다 (매매 권한만)</li>
              <li>언제든 거래소에서 해당 키를 폐기할 수 있어요</li>
            </ul>
          </div>
          <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", gap: 10 }}>
            <button onClick={() => {
              setBinanceConnected(false);
              ga.ctaClick("onboarding", "binance-later");
              handleNext();
            }} style={{
              flex: 1, padding: "12px 18px",
              background: C.card2, color: C.text1,
              border: `1.5px solid ${C.border}`,
              borderRadius: RADIUS.md, fontSize: FONT.sm, fontWeight: 700, cursor: "pointer",
            }}>
              나중에 연결하기
            </button>
            <button onClick={() => {
              setBinanceConnected(true);
              ga.binanceConnectClicked();
              ga.ctaClick("onboarding", "binance-now");
              // 자동매매 탭으로 이동 + 온보딩은 완료로 마킹
              saveOnboarding({ completed: true, completedAt: new Date().toISOString(), step: 4, binanceConnected: true }).then(() => {
                if (typeof onNavigate === "function") onNavigate("auto-trading");
                if (typeof onClose === "function") onClose();
              });
            }} style={{
              flex: 1, padding: "12px 18px",
              background: C.blue, color: "#fff",
              border: "none",
              borderRadius: RADIUS.md, fontSize: FONT.sm, fontWeight: 700, cursor: "pointer",
            }}>
              지금 연결하러 가기
            </button>
          </div>
          <DisclaimerBanner C={C} />
        </div>
      );
    }

    if (step === 5) {
      const profile = RISK_PROFILES.find(p => p.id === risk) || RISK_PROFILES[1];
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ fontSize: 48, textAlign: "center", marginTop: 4 }}>🎉</div>
          <div style={{ fontSize: isMobile ? FONT.xl : FONT["2xl"], fontWeight: 800, color: C.text1, textAlign: "center" }}>
            설정 완료! 첫 시그널을 보여드릴게요
          </div>
          <div style={{
            padding: 16, background: C.blueBg, borderRadius: RADIUS.lg,
            border: `1.5px solid ${C.blue}40`,
          }}>
            <div style={{ fontSize: FONT.xs, color: C.text3, marginBottom: 4 }}>회원님께 추천하는 전략</div>
            <div style={{ fontSize: FONT.lg, fontWeight: 700, color: C.text1 }}>
              {profile.emoji} {profile.botLabel}
            </div>
            <div style={{ fontSize: FONT.sm, color: C.text2, marginTop: 8, lineHeight: 1.6 }}>
              {profile.desc}
            </div>
            <div style={{ display: "flex", gap: 12, marginTop: 12, flexWrap: "wrap" }}>
              <span style={{ fontSize: FONT.xs, color: C.text3 }}>예상 연 수익: <b style={{ color: C.green }}>{profile.expectedAnnual}</b></span>
              <span style={{ fontSize: FONT.xs, color: C.text3 }}>{profile.drawdownGuide}</span>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", gap: 10 }}>
            <button onClick={() => {
              ga.ctaClick("onboarding", "go-screener");
              saveOnboarding({ completed: true, completedAt: new Date().toISOString(), step: 5 }).then(() => {
                if (typeof onNavigate === "function") onNavigate("screener");
                if (typeof onClose === "function") onClose();
              });
            }} style={{
              flex: 1, padding: "12px 18px",
              background: C.card2, color: C.text1,
              border: `1.5px solid ${C.border}`,
              borderRadius: RADIUS.md, fontSize: FONT.sm, fontWeight: 700, cursor: "pointer",
            }}>
              📊 스크리너 둘러보기
            </button>
            <button onClick={() => {
              ga.ctaClick("onboarding", "go-auto-trading");
              saveOnboarding({ completed: true, completedAt: new Date().toISOString(), step: 5 }).then(() => {
                if (typeof onNavigate === "function") onNavigate("auto-trading");
                if (typeof onClose === "function") onClose();
              });
            }} style={{
              flex: 1, padding: "12px 18px",
              background: C.blue, color: "#fff",
              border: "none",
              borderRadius: RADIUS.md, fontSize: FONT.sm, fontWeight: 700, cursor: "pointer",
            }}>
              🤖 자동매매 살펴보기
            </button>
          </div>
          <DisclaimerBanner C={C} />
        </div>
      );
    }

    return null;
  };

  // 다음 버튼 활성화 조건
  const canProceed = (() => {
    if (step === 2) return interests.length > 0;
    if (step === 3) return !!risk;
    if (step === 4) return true; // step 4 는 내부 버튼이 처리
    return true;
  })();

  // step 4 / 5 는 내부 자체 버튼으로 navigate — 외부 nav 버튼 숨김
  const hideExternalNav = step === 4 || step === 5;

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 100000,
      background: "rgba(0,0,0,0.7)",
      backdropFilter: "blur(8px)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: isMobile ? 0 : 24,
      overflowY: "auto",
    }} onClick={(e) => { /* 배경 클릭으로는 닫지 않음 (의도적 skip 만 허용) */ }}>
      <div style={{
        width: "100%",
        maxWidth: isMobile ? "100%" : 560,
        height: isMobile ? "100%" : "auto",
        maxHeight: isMobile ? "100%" : "92vh",
        background: C.card,
        border: isMobile ? "none" : `1px solid ${C.border}`,
        borderRadius: isMobile ? 0 : RADIUS["2xl"],
        boxShadow: C.cardShadow,
        display: "flex", flexDirection: "column",
        overflow: "hidden",
      }}>
        {/* 헤더 */}
        <div style={{
          padding: "16px 20px",
          borderBottom: `1px solid ${C.border}`,
          display: "flex", flexDirection: "column", gap: 10,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: FONT.xs, color: C.text3, fontWeight: 600 }}>
              {step} / {TOTAL_STEPS} 단계
            </span>
            <button onClick={handleSkip} style={{
              background: "none", border: "none",
              color: C.text3, fontSize: FONT.xs, fontWeight: 600,
              cursor: "pointer", padding: "4px 8px",
            }}>
              건너뛰기 ✕
            </button>
          </div>
          <ProgressBar step={step} total={TOTAL_STEPS} C={C} />
        </div>

        {/* 바디 */}
        <div style={{ padding: "20px", flex: 1, overflowY: "auto" }}>
          <StepContent />
        </div>

        {/* 푸터 (네비게이션) */}
        {!hideExternalNav && (
          <div style={{
            padding: "12px 20px 20px",
            borderTop: `1px solid ${C.border}`,
            display: "flex", gap: 10, justifyContent: "space-between",
          }}>
            <button onClick={handlePrev} disabled={step === 1} style={{
              padding: "10px 18px",
              background: "transparent", color: step === 1 ? C.text4 : C.text2,
              border: `1px solid ${C.border}`,
              borderRadius: RADIUS.md, fontSize: FONT.sm, fontWeight: 600,
              cursor: step === 1 ? "not-allowed" : "pointer",
              opacity: step === 1 ? 0.4 : 1,
            }}>
              ← 이전
            </button>
            <button onClick={handleNext} disabled={!canProceed || saving} style={{
              flex: 1, maxWidth: 220,
              padding: "10px 18px",
              background: canProceed ? C.blue : C.card2,
              color: canProceed ? "#fff" : C.text3,
              border: "none",
              borderRadius: RADIUS.md, fontSize: FONT.sm, fontWeight: 700,
              cursor: canProceed ? "pointer" : "not-allowed",
            }}>
              {saving ? "저장 중…" : (step === TOTAL_STEPS ? "완료" : "다음 →")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
