// ══════════════════════════════════════════════════════════════════
// Zepta — 가격 페이지 (/pricing) — PLAN-BIZ Q3 #1, 2026-05-11
// ──────────────────────────────────────────────────────────────────
// Free / Pro / Premium 3 tier 비교 + FAQ + 면책 + 약관 링크.
//
// 법적 포지셔닝:
//   - "도구 사용권" SaaS — 수익 보장 표현 절대 사용 X
//   - "투자자문" 라벨 X (자본시장법 인가 없음)
//   - 환불 정책 / 정기결제 / 해지 방법 명시 → terms.html 링크
//
// 결제는 1단계 mock (실제 결제 통합은 후속 sprint).
// "Pro 14일 무료 체험" CTA 가능 — useTrial=true.
// ══════════════════════════════════════════════════════════════════
import React, { useState, useCallback, useMemo } from "react";
import { useThemeTokens, FONT, RADIUS } from "./ui/theme.jsx";
import { useBreakpoint } from "./ui/useBreakpoint.jsx";
import { useAuth } from "./AuthProvider.jsx";
import {
  TIER_LABELS,
  TIER_LIMITS,
  getTier,
  getTrialDaysLeft,
  requestUpgrade,
} from "./lib/subscription.js";
import { ga } from "./lib/analytics.js";

// ── Tier feature matrix (UI 출력용) ───────────────────────────────
const FEATURE_MATRIX = [
  {
    section: "스크리너",
    rows: [
      { label: "기본 스크리닝",         free: true,   pro: true,           premium: true },
      { label: "즐겨찾기 저장",         free: "3개",  pro: "무제한",        premium: "무제한" },
    ],
  },
  {
    section: "자동매매 봇",
    rows: [
      { label: "활성 봇 수",            free: "1개",  pro: "5개",          premium: "무제한" },
      { label: "DCA 봇",                free: "X",    pro: "5개",          premium: "무제한" },
    ],
  },
  {
    section: "백테스트 / AlphaLab",
    rows: [
      { label: "백테스트 기간",         free: "30일", pro: "90일",          premium: "무제한" },
      { label: "전략 비교 뷰",          free: "X",    pro: "최대 4개",      premium: "무제한" },
      { label: "AlphaLab 풀 액세스",    free: "조회만", pro: "전체",        premium: "전체 + grid" },
      { label: "파라미터 grid search",  free: "X",    pro: "X",             premium: "사용자 트리거" },
    ],
  },
  {
    section: "알림",
    rows: [
      { label: "알림 채널",             free: "가격만", pro: "가격·신호·뉴스·포트폴리오", premium: "전체" },
      { label: "알림 개수",             free: "3개",  pro: "무제한",        premium: "무제한" },
      { label: "텔레그램 시그널 / 일",   free: "5건",  pro: "50건",         premium: "무제한" },
    ],
  },
  {
    section: "카피트레이딩",
    rows: [
      { label: "Follow 가능 봇",        free: "X",    pro: "10개",          premium: "무제한" },
    ],
  },
  {
    section: "기타",
    rows: [
      { label: "광고 제거",             free: "X",    pro: "O",             premium: "O" },
      { label: "API 액세스",            free: "X",    pro: "X",             premium: "O (높은 limit)" },
      { label: "고객 지원",             free: "커뮤니티", pro: "이메일",     premium: "우선 지원" },
    ],
  },
];

// ── FAQ ──────────────────────────────────────────────────────────
const FAQ = [
  {
    q: "수익을 보장하나요?",
    a: "아니요. Zepta 는 투자 도구를 제공할 뿐, 수익을 보장하지 않습니다. 모든 투자 판단과 결과 책임은 사용자에게 있습니다. 자본시장법상 투자자문업이 아닙니다.",
  },
  {
    q: "14일 무료 체험은 어떻게 동작하나요?",
    a: "Pro tier 가입 시 1회에 한해 14일 무료 사용이 가능합니다. 체험 기간 종료 후 자동 결제로 전환되며, 종료 전 언제든 취소 가능합니다.",
  },
  {
    q: "언제든 해지할 수 있나요?",
    a: "네. 마이페이지 → 구독 관리에서 즉시 해지 가능합니다. 해지 후에도 현재 결제 주기 종료일까지 Pro/Premium 기능을 사용할 수 있습니다.",
  },
  {
    q: "환불 정책은 어떻게 되나요?",
    a: "결제일로부터 7일 이내 100% 환불, 7일 후에는 잔여기간에 비례하여 환불됩니다. 단, 14일 무료 체험은 결제 발생 전이므로 환불 대상이 아닙니다.",
  },
  {
    q: "Tier 변경은 자유로운가요?",
    a: "Free → Pro → Premium 업그레이드는 즉시 가능합니다. 다운그레이드는 현재 결제 주기 종료 시점에 적용됩니다.",
  },
  {
    q: "결제 수단은 무엇이 있나요?",
    a: "현재는 출시 준비 단계로 결제 시뮬레이션만 가능합니다. 토스 페이먼츠 / Stripe 카드 결제 통합이 곧 출시될 예정입니다.",
  },
];

// ── 단일 tier 카드 ──────────────────────────────────────────────
function TierCard({ tier, isCurrent, isRecommended, onSelect, onTrial, lang, C, isMobile, busy }) {
  const meta = TIER_LABELS[tier];
  const limits = TIER_LIMITS[tier];

  const accent =
    tier === "premium" ? C.purple :
    tier === "pro"     ? C.blue   : C.text2;
  const accentBg =
    tier === "premium" ? C.purpleBg :
    tier === "pro"     ? C.blueBg   : C.card2;

  const features = useMemo(() => {
    if (tier === "free") {
      return [
        "기본 스크리너",
        `자동매매 봇 ${limits.botCount}개`,
        `백테스트 ${limits.backtestLookbackDays}일`,
        `알림 ${limits.alertCount}개 (가격만)`,
        "AlphaLab 결과 조회",
      ];
    }
    if (tier === "pro") {
      return [
        "스크리너 즐겨찾기 무제한",
        `봇 ${limits.botCount}개 + DCA ${limits.dcaBotCount}개`,
        `백테스트 ${limits.backtestLookbackDays}일 + 비교 뷰`,
        "알림 무제한 (가격·신호·뉴스·포트폴리오)",
        "AlphaLab 풀 액세스",
        "광고 제거",
        `카피트레이딩 ${limits.copyTradingFollows} follow`,
      ];
    }
    return [
      "Pro 의 모든 기능",
      "봇 무제한",
      "백테스트 무제한 + grid search",
      "텔레그램 시그널 무제한",
      "카피트레이딩 무제한",
      "API 액세스 (높은 limit)",
      "우선 고객 지원",
    ];
  }, [tier, limits]);

  const priceLabel = lang === "en"
    ? `$${meta.usd.toFixed(2)}`
    : `₩${meta.krw.toLocaleString()}`;

  return (
    <div
      style={{
        flex: "1 1 280px",
        minWidth: isMobile ? "100%" : 260,
        background: C.card,
        border: `2px solid ${isRecommended ? accent : C.border}`,
        borderRadius: RADIUS.xl,
        padding: 24,
        boxShadow: isRecommended ? `0 8px 32px ${accent}33` : C.cardShadow,
        position: "relative",
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      {isRecommended && (
        <div style={{
          position: "absolute", top: -12, left: 24,
          background: accent, color: "#fff",
          fontSize: FONT.xs, fontWeight: 700,
          padding: "4px 12px", borderRadius: RADIUS.full,
        }}>
          가장 인기
        </div>
      )}
      {isCurrent && (
        <div style={{
          position: "absolute", top: -12, right: 24,
          background: C.green, color: "#fff",
          fontSize: FONT.xs, fontWeight: 700,
          padding: "4px 12px", borderRadius: RADIUS.full,
        }}>
          현재 플랜
        </div>
      )}

      {/* 헤더 */}
      <div>
        <div style={{ fontSize: FONT.xl, fontWeight: 700, color: accent }}>{meta.ko}</div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 8 }}>
          <span style={{ fontSize: FONT["3xl"], fontWeight: 800, color: C.text1 }}>
            {priceLabel}
          </span>
          {tier !== "free" && (
            <span style={{ fontSize: FONT.sm, color: C.text2 }}>/ 월</span>
          )}
        </div>
      </div>

      {/* 기능 리스트 */}
      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 10 }}>
        {features.map((f, i) => (
          <li key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: FONT.sm, color: C.text1 }}>
            <span style={{ color: accent, marginTop: 1, fontWeight: 800 }}>✓</span>
            <span>{f}</span>
          </li>
        ))}
      </ul>

      {/* CTA */}
      <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
        {tier === "free" && (
          <button
            disabled={isCurrent || busy}
            onClick={() => onSelect(tier)}
            style={{
              padding: "12px 16px",
              background: isCurrent ? C.card2 : accentBg,
              color: isCurrent ? C.text3 : accent,
              border: `1px solid ${isCurrent ? C.border : accent}`,
              borderRadius: RADIUS.md,
              fontSize: FONT.base, fontWeight: 700,
              cursor: isCurrent ? "default" : "pointer",
            }}
          >
            {isCurrent ? "사용 중" : "Free 로 시작"}
          </button>
        )}
        {tier === "pro" && (
          <>
            <button
              disabled={isCurrent || busy}
              onClick={() => onTrial(tier)}
              style={{
                padding: "12px 16px",
                background: accent,
                color: "#fff",
                border: "none",
                borderRadius: RADIUS.md,
                fontSize: FONT.base, fontWeight: 700,
                cursor: (isCurrent || busy) ? "default" : "pointer",
                opacity: (isCurrent || busy) ? 0.6 : 1,
              }}
            >
              {busy ? "처리 중…" : "Pro 14일 무료 체험"}
            </button>
            <button
              disabled={isCurrent || busy}
              onClick={() => onSelect(tier)}
              style={{
                padding: "10px 16px",
                background: "transparent",
                color: accent,
                border: `1px solid ${accent}`,
                borderRadius: RADIUS.md,
                fontSize: FONT.sm, fontWeight: 600,
                cursor: (isCurrent || busy) ? "default" : "pointer",
              }}
            >
              바로 구독
            </button>
          </>
        )}
        {tier === "premium" && (
          <button
            disabled={isCurrent || busy}
            onClick={() => onSelect(tier)}
            style={{
              padding: "12px 16px",
              background: accent,
              color: "#fff",
              border: "none",
              borderRadius: RADIUS.md,
              fontSize: FONT.base, fontWeight: 700,
              cursor: (isCurrent || busy) ? "default" : "pointer",
              opacity: (isCurrent || busy) ? 0.6 : 1,
            }}
          >
            {busy ? "처리 중…" : "Premium 구독"}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Feature matrix 비교 표 ───────────────────────────────────────
function FeatureMatrix({ C, isMobile }) {
  return (
    <div style={{
      background: C.card,
      border: `1px solid ${C.border}`,
      borderRadius: RADIUS.xl,
      padding: isMobile ? 16 : 24,
      marginTop: 32,
    }}>
      <h3 style={{ fontSize: FONT.xl, fontWeight: 700, color: C.text1, margin: "0 0 16px" }}>
        기능 비교
      </h3>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 600 }}>
          <thead>
            <tr style={{ borderBottom: `2px solid ${C.border}` }}>
              <th style={{ textAlign: "left", padding: 12, fontSize: FONT.sm, color: C.text2, fontWeight: 600 }}>기능</th>
              <th style={{ textAlign: "center", padding: 12, fontSize: FONT.sm, color: C.text2, fontWeight: 600 }}>Free</th>
              <th style={{ textAlign: "center", padding: 12, fontSize: FONT.sm, color: C.blue, fontWeight: 700 }}>Pro</th>
              <th style={{ textAlign: "center", padding: 12, fontSize: FONT.sm, color: C.purple, fontWeight: 700 }}>Premium</th>
            </tr>
          </thead>
          <tbody>
            {FEATURE_MATRIX.map((section, si) => (
              <React.Fragment key={si}>
                <tr>
                  <td colSpan={4} style={{
                    padding: "16px 12px 8px",
                    fontSize: FONT.xs,
                    color: C.text3,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                  }}>
                    {section.section}
                  </td>
                </tr>
                {section.rows.map((row, ri) => (
                  <tr key={ri} style={{ borderTop: `1px solid ${C.border}` }}>
                    <td style={{ padding: 12, fontSize: FONT.sm, color: C.text1 }}>{row.label}</td>
                    <td style={{ padding: 12, fontSize: FONT.sm, color: C.text2, textAlign: "center" }}>
                      {renderCell(row.free, C)}
                    </td>
                    <td style={{ padding: 12, fontSize: FONT.sm, color: C.text1, textAlign: "center" }}>
                      {renderCell(row.pro, C)}
                    </td>
                    <td style={{ padding: 12, fontSize: FONT.sm, color: C.text1, textAlign: "center" }}>
                      {renderCell(row.premium, C)}
                    </td>
                  </tr>
                ))}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function renderCell(v, C) {
  if (v === true) return <span style={{ color: C.green, fontWeight: 700 }}>✓</span>;
  if (v === false || v === "X") return <span style={{ color: C.text4 }}>—</span>;
  return v;
}

// ── FAQ 아코디언 ──────────────────────────────────────────────
function FAQSection({ C, isMobile }) {
  const [openIdx, setOpenIdx] = useState(-1);
  return (
    <div style={{
      background: C.card,
      border: `1px solid ${C.border}`,
      borderRadius: RADIUS.xl,
      padding: isMobile ? 16 : 24,
      marginTop: 32,
    }}>
      <h3 style={{ fontSize: FONT.xl, fontWeight: 700, color: C.text1, margin: "0 0 16px" }}>
        자주 묻는 질문
      </h3>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {FAQ.map((item, i) => {
          const isOpen = openIdx === i;
          return (
            <div key={i} style={{ border: `1px solid ${C.border}`, borderRadius: RADIUS.md, overflow: "hidden" }}>
              <button
                onClick={() => setOpenIdx(isOpen ? -1 : i)}
                style={{
                  width: "100%",
                  padding: 14,
                  background: isOpen ? C.card2 : "transparent",
                  border: "none",
                  textAlign: "left",
                  fontSize: FONT.base,
                  fontWeight: 600,
                  color: C.text1,
                  cursor: "pointer",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 12,
                }}
              >
                <span>{item.q}</span>
                <span style={{ color: C.text2, fontSize: FONT.sm }}>{isOpen ? "−" : "+"}</span>
              </button>
              {isOpen && (
                <div style={{
                  padding: "0 14px 14px",
                  fontSize: FONT.sm,
                  color: C.text2,
                  lineHeight: 1.6,
                }}>
                  {item.a}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── 면책 / 약관 푸터 ──────────────────────────────────────────
function LegalFooter({ C }) {
  return (
    <div style={{
      marginTop: 32,
      padding: 20,
      background: C.card2,
      border: `1px solid ${C.border}`,
      borderRadius: RADIUS.lg,
      fontSize: FONT.xs,
      color: C.text3,
      lineHeight: 1.6,
    }}>
      <p style={{ margin: "0 0 8px" }}>
        <strong style={{ color: C.text2 }}>중요 안내</strong> — Zepta 는 투자 도구를 제공하는 SaaS 서비스입니다.
        제공되는 신호·전략·백테스트 결과는 과거 데이터에 기반한 참고용이며, 미래 수익을 보장하지 않습니다.
        모든 투자 판단과 결과 책임은 사용자에게 있습니다.
      </p>
      <p style={{ margin: "0 0 8px" }}>
        Zepta 는 자본시장법상 투자자문업·투자일임업 인가를 받지 않았습니다.
        개별 종목 매매 추천이나 자산 운용 위임을 받지 않으며, 사용자가 도구를 활용하여 직접 매매 결정을 내립니다.
      </p>
      <p style={{ margin: 0 }}>
        결제 진행 시 <a href="/terms" style={{ color: C.blue, textDecoration: "underline" }}>이용약관</a>
        {" · "}
        <a href="/privacy" style={{ color: C.blue, textDecoration: "underline" }}>개인정보처리방침</a>
        {" 에 동의한 것으로 간주합니다."}
      </p>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// 메인 컴포넌트
// ══════════════════════════════════════════════════════════════════
export default function Pricing({ onRequestLogin } = {}) {
  const C = useThemeTokens();
  const { isMobile } = useBreakpoint();
  let auth = null;
  try { auth = useAuth(); } catch {}
  const user = auth?.user || null;

  const currentTier = getTier(user);
  const trialDaysLeft = getTrialDaysLeft(user);

  // 언어 — i18n 통합 전 ko 기본
  const lang = "ko";

  // 상태
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);

  const showToast = useCallback((msg, type = "info") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  }, []);

  // ── 핸들러 ──
  const handleUpgrade = useCallback(async (targetTier, useTrial = false) => {
    if (!user?.id) {
      if (onRequestLogin) onRequestLogin();
      else showToast("로그인 후 구독할 수 있어요.", "warn");
      return;
    }
    if (targetTier === "free") {
      showToast("이미 무료 플랜을 사용 중이세요.", "info");
      return;
    }
    setBusy(true);
    try {
      const newSub = await requestUpgrade({
        uid: user.id,
        targetTier,
        useTrial,
        paymentToken: useTrial ? null : `mock-${Date.now()}`,
      });
      try { ga.event("subscription_upgrade", { tier: targetTier, trial: useTrial }); } catch {}
      showToast(
        useTrial
          ? `14일 Pro 무료 체험이 시작되었어요. (만료: ${new Date(newSub.trialEndsAt).toLocaleDateString("ko-KR")})`
          : `${TIER_LABELS[targetTier].ko} 구독이 활성화되었어요.`,
        "success"
      );
      // 사용자 객체 갱신 — App.jsx 가 polling 으로 반영하거나 새로고침 권장
      setTimeout(() => window.location.reload(), 1500);
    } catch (e) {
      showToast(`업그레이드 실패: ${e.message}`, "error");
    } finally {
      setBusy(false);
    }
  }, [user, onRequestLogin, showToast]);

  return (
    <div style={{
      padding: isMobile ? 16 : 32,
      maxWidth: 1200,
      margin: "0 auto",
    }}>
      {/* 헤더 */}
      <div style={{ textAlign: "center", marginBottom: 32 }}>
        <h1 style={{
          fontSize: isMobile ? FONT["2xl"] : FONT["3xl"],
          fontWeight: 800,
          color: C.text1,
          margin: "0 0 8px",
        }}>
          Zepta 구독 플랜
        </h1>
        <p style={{ fontSize: FONT.base, color: C.text2, margin: 0, lineHeight: 1.6 }}>
          투자 도구를 더 강력하게. 언제든 시작하고, 언제든 해지하세요.
        </p>
        {trialDaysLeft > 0 && (
          <div style={{
            display: "inline-block",
            marginTop: 12,
            padding: "6px 14px",
            background: C.yellowBg,
            color: C.yellow,
            borderRadius: RADIUS.full,
            fontSize: FONT.sm,
            fontWeight: 600,
          }}>
            Pro 체험 잔여 {trialDaysLeft}일
          </div>
        )}
      </div>

      {/* 3 tier 카드 */}
      <div style={{
        display: "flex",
        gap: 16,
        flexWrap: "wrap",
        alignItems: "stretch",
      }}>
        <TierCard
          tier="free"
          isCurrent={currentTier === "free"}
          isRecommended={false}
          onSelect={() => handleUpgrade("free")}
          onTrial={() => {}}
          lang={lang}
          C={C}
          isMobile={isMobile}
          busy={busy}
        />
        <TierCard
          tier="pro"
          isCurrent={currentTier === "pro"}
          isRecommended={true}
          onSelect={(t) => handleUpgrade(t, false)}
          onTrial={(t) => handleUpgrade(t, true)}
          lang={lang}
          C={C}
          isMobile={isMobile}
          busy={busy}
        />
        <TierCard
          tier="premium"
          isCurrent={currentTier === "premium"}
          isRecommended={false}
          onSelect={(t) => handleUpgrade(t, false)}
          onTrial={() => {}}
          lang={lang}
          C={C}
          isMobile={isMobile}
          busy={busy}
        />
      </div>

      {/* Feature matrix */}
      <FeatureMatrix C={C} isMobile={isMobile} />

      {/* FAQ */}
      <FAQSection C={C} isMobile={isMobile} />

      {/* 면책 */}
      <LegalFooter C={C} />

      {/* Toast */}
      {toast && (
        <div style={{
          position: "fixed",
          bottom: 24,
          left: "50%",
          transform: "translateX(-50%)",
          padding: "12px 20px",
          background: toast.type === "error" ? C.redBg :
                      toast.type === "success" ? C.greenBg :
                      toast.type === "warn" ? C.yellowBg : C.card,
          color: toast.type === "error" ? C.red :
                 toast.type === "success" ? C.green :
                 toast.type === "warn" ? C.yellow : C.text1,
          border: `1px solid ${C.border}`,
          borderRadius: RADIUS.md,
          boxShadow: C.cardShadow,
          fontSize: FONT.sm,
          fontWeight: 600,
          zIndex: 9999,
          maxWidth: "90vw",
        }}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}
