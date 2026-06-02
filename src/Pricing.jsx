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
import { useThemeTokens, FONT, RADIUS, FONT_MOBILE, pickFont } from "./ui/theme.jsx";
import { useBreakpoint } from "./ui/useBreakpoint.jsx";
import { useAuth } from "./AuthProvider.jsx";
import {
  TIER_LABELS,
  TIER_LIMITS,
  getTier,
  getTrialDaysLeft,
  // requestUpgrade — 베타 단계에서는 호출하지 않음. 정식 결제 오픈 시 재활성화.
} from "./lib/subscription.js";
import { ga, trackEvent } from "./lib/analytics.js";

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
    q: "현재 결제가 가능한가요?",
    a: "아니요, 아직 베타 단계입니다. Zepta 구독 결제는 현재 시뮬레이션만 제공하며, 실제 카드 결제 (토스 페이먼츠·Stripe) 는 2026 Q3 안에 정식 오픈 예정입니다. 베타 알림을 신청하시면 정식 결제가 열리는 즉시 가장 먼저 알려드릴게요.",
  },
  {
    q: "수익을 보장하나요?",
    a: "아니요. Zepta 는 투자 도구를 제공할 뿐, 수익을 보장하지 않습니다. 모든 투자 판단과 결과 책임은 사용자에게 있습니다. 자본시장법상 투자자문업이 아닙니다.",
  },
  {
    q: "14일 무료 체험은 어떻게 동작하나요?",
    a: "현재 베타 단계로 실제 결제와 무료 체험 모두 시뮬레이션만 제공됩니다. 정식 출시 (2026 Q3 예정) 시 Pro tier 가입자에게 1회 14일 무료 체험을 제공할 계획입니다.",
  },
  {
    q: "언제든 해지할 수 있나요?",
    a: "현재는 베타 단계이므로 실제 결제·해지가 발생하지 않습니다. 정식 출시 후에는 마이페이지 → 구독 관리에서 즉시 해지 가능하도록 준비 중입니다.",
  },
  {
    q: "환불 정책은 어떻게 되나요?",
    a: "베타 단계에서는 실제 결제가 진행되지 않아 환불 대상이 없습니다. 정식 출시 후 환불 정책은 결제일로부터 7일 이내 100% 환불, 이후 잔여기간 비례 환불을 적용할 예정입니다.",
  },
  {
    q: "Tier 변경은 자유로운가요?",
    a: "베타 단계에서는 시뮬레이션상 자유롭게 변경 가능합니다. 정식 출시 후 Free → Pro → Premium 업그레이드는 즉시, 다운그레이드는 현재 결제 주기 종료 시점에 적용될 예정입니다.",
  },
  {
    q: "결제 수단은 무엇이 있나요?",
    a: "현재는 출시 준비 단계로 결제 시뮬레이션만 가능합니다. 토스 페이먼츠 / Stripe 카드 결제 통합이 2026 Q3 안에 정식 오픈될 예정입니다.",
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

      {/* CTA — 모바일은 minHeight 48 (큰 터치 영역) */}
      <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
        {tier === "free" && (
          <button
            disabled={isCurrent || busy}
            onClick={() => onSelect(tier)}
            style={{
              padding: isMobile ? "14px 16px" : "12px 16px",
              minHeight: 48,
              background: isCurrent ? C.card2 : accentBg,
              color: isCurrent ? C.text3 : accent,
              border: `1px solid ${isCurrent ? C.border : accent}`,
              borderRadius: RADIUS.md,
              fontSize: pickFont("button", isMobile) ?? FONT.base, fontWeight: 700,
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
                padding: isMobile ? "14px 16px" : "12px 16px",
                minHeight: 48,
                background: accent,
                color: "#fff",
                border: "none",
                borderRadius: RADIUS.md,
                fontSize: pickFont("button", isMobile) ?? FONT.base, fontWeight: 700,
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
                padding: isMobile ? "12px 16px" : "10px 16px",
                minHeight: 44,
                background: "transparent",
                color: accent,
                border: `1px solid ${accent}`,
                borderRadius: RADIUS.md,
                fontSize: FONT.sm, fontWeight: 600,
                cursor: (isCurrent || busy) ? "default" : "pointer",
                display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
              }}
            >
              바로 구독
              <span style={{
                background: `${C.yellow}22`,
                border: `1px solid ${C.yellow}`,
                color: C.yellow,
                padding: "2px 6px",
                borderRadius: 999,
                fontSize: 11,
                fontWeight: 700,
                lineHeight: 1,
              }}>베타</span>
            </button>
          </>
        )}
        {tier === "premium" && (
          <button
            disabled={isCurrent || busy}
            onClick={() => onSelect(tier)}
            style={{
              padding: isMobile ? "14px 16px" : "12px 16px",
              minHeight: 48,
              background: accent,
              color: "#fff",
              border: "none",
              borderRadius: RADIUS.md,
              fontSize: pickFont("button", isMobile) ?? FONT.base, fontWeight: 700,
              cursor: (isCurrent || busy) ? "default" : "pointer",
              opacity: (isCurrent || busy) ? 0.6 : 1,
              display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
            }}
          >
            {busy ? "처리 중…" : "Premium 구독"}
            {!busy && (
              <span style={{
                background: `${C.yellow}22`,
                border: `1px solid ${C.yellow}`,
                color: C.yellow,
                padding: "2px 6px",
                borderRadius: 999,
                fontSize: 11,
                fontWeight: 700,
                lineHeight: 1,
              }}>베타</span>
            )}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Feature matrix 비교 표 ───────────────────────────────────────
function FeatureMatrix({ C, isMobile }) {
  // 모바일에선 기본 접힘 — 좁은 폭에서 너무 길어 화면 압박
  const [open, setOpen] = useState(!isMobile);
  return (
    <div style={{
      background: C.card,
      border: `1px solid ${C.border}`,
      borderRadius: RADIUS.xl,
      padding: isMobile ? 16 : 24,
      marginTop: 32,
    }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          gap: 12,
          background: "transparent", border: "none", padding: 0,
          margin: "0 0 16px",
          cursor: isMobile ? "pointer" : "default",
          textAlign: "left", minHeight: isMobile ? 44 : undefined,
        }}
        aria-expanded={open}
      >
        <h3 style={{ fontSize: FONT.xl, fontWeight: 700, color: C.text1, margin: 0 }}>
          기능 비교
        </h3>
        {isMobile && (
          <span style={{
            color: C.text2, fontSize: FONT.lg, fontWeight: 700,
            width: 32, height: 32, display: "inline-flex",
            alignItems: "center", justifyContent: "center",
          }}>{open ? "−" : "+"}</span>
        )}
      </button>
      {!open && (
        <p style={{ margin: 0, color: C.text3, fontSize: FONT.sm }}>
          탭하면 펼쳐서 자세히 볼 수 있어요.
        </p>
      )}
      {open && (
      <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
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
      )}
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
                  padding: isMobile ? "16px 14px" : 14,
                  minHeight: 52,
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
        Zepta 구독 결제는 현재 베타 단계로, 실제 결제는 2026 Q3 안에 정식 오픈됩니다.
        정식 결제 시작 시 <a href="/terms" style={{ color: C.blue, textDecoration: "underline" }}>이용약관</a>
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
  // 베타 결제 차단 모달 — 무료 플랜 외 모든 업그레이드 시도 시 노출
  const [betaModal, setBetaModal] = useState(null); // { targetTier, useTrial } | null

  const showToast = useCallback((msg, type = "info") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  }, []);

  // ── 핸들러 ──
  // 베타 단계: Pro/Premium 업그레이드 시 실제 결제 진행 전 안내 모달 강제 노출.
  // 사용자가 "베타 알림 신청" 을 선택하면 waitlist 에 등록만 진행. 실제 결제는 미진행.
  const handleUpgrade = useCallback((targetTier, useTrial = false) => {
    if (!user?.id) {
      if (onRequestLogin) onRequestLogin();
      else showToast("로그인 후 구독할 수 있어요.", "warn");
      return;
    }
    if (targetTier === "free") {
      showToast("이미 무료 플랜을 사용 중이세요.", "info");
      return;
    }
    // 베타 단계 — 실제 결제 호출 (requestUpgrade) 차단, 안내 모달만 표시
    try { trackEvent("subscription_beta_blocked", { tier: targetTier, trial: useTrial }); } catch {}
    setBetaModal({ targetTier, useTrial });
  }, [user, onRequestLogin, showToast]);

  // 베타 알림 신청 — localStorage + (선택) API
  const handleBetaWaitlist = useCallback(async () => {
    if (!betaModal) return;
    setBusy(true);
    try {
      const payload = {
        email: user?.email || null,
        uid: user?.id || null,
        targetTier: betaModal.targetTier,
        useTrial: betaModal.useTrial,
        requestedAt: new Date().toISOString(),
      };
      // 1차: localStorage 로컬 캐시 (서버 미배포 환경 대비)
      try {
        const key = "zepta:beta-waitlist:payment";
        const prev = JSON.parse(localStorage.getItem(key) || "[]");
        prev.push(payload);
        localStorage.setItem(key, JSON.stringify(prev));
      } catch {}
      // 2차: 서버 적재 시도 (실패해도 UX 진행)
      try {
        await fetch("/api/beta-waitlist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } catch (e) {
        // 서버 없음 — silent fallback
        // eslint-disable-next-line no-console
        console.info("[beta-waitlist] server未연결, localStorage 만 저장됨", e?.message);
      }
      try { trackEvent("subscription_beta_waitlist", { tier: betaModal.targetTier }); } catch {}
      showToast("베타 알림 신청 완료! 정식 결제가 열리면 가장 먼저 알려드릴게요.", "success");
      setBetaModal(null);
    } catch (e) {
      showToast(`신청 실패: ${e.message}`, "error");
    } finally {
      setBusy(false);
    }
  }, [betaModal, user, showToast]);

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
        {/* 🧪 베타 단계 배지 — 결제는 시뮬레이션만 가능 (A-1) */}
        <div style={{
          marginTop: 16,
          padding: isMobile ? "10px 14px" : "12px 18px",
          background: `${C.yellow}15`,
          border: `1px solid ${C.yellow}55`,
          borderRadius: RADIUS.lg,
          color: C.text1,
          fontSize: FONT.sm,
          fontWeight: 600,
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
          justifyContent: "center",
          lineHeight: 1.5,
          maxWidth: 720,
        }}>
          <span style={{ fontSize: 16 }}>🧪</span>
          <strong style={{ color: C.yellow }}>베타</strong>
          <span style={{ color: C.text2 }}>·</span>
          <span style={{ color: C.text2 }}>실제 결제는 2026 Q3 오픈 예정</span>
          <span style={{ color: C.text3 }}>·</span>
          <span style={{ color: C.text3 }}>지금은 기능 체험용</span>
        </div>
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

      {/* 3 tier 카드 — 모바일은 1컬럼 stack, Pro 카드를 맨 위로 */}
      <div style={{
        display: "flex",
        flexDirection: isMobile ? "column" : "row",
        gap: 16,
        flexWrap: "wrap",
        alignItems: "stretch",
      }}>
        {/* 모바일에선 Pro 를 먼저 보여줘서 추천 강조 */}
        {isMobile && (
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
        )}
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
        {!isMobile && (
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
        )}
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

      {/* 🧪 베타 결제 차단 안내 모달 (A-1) — 모든 Pro/Premium 구독 시도 시 강제 표시 */}
      {betaModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="beta-modal-title"
          onClick={() => !busy && setBetaModal(null)}
          style={{
            position: "fixed", inset: 0,
            background: "rgba(0,0,0,0.65)",
            display: "flex", alignItems: "center", justifyContent: "center",
            zIndex: 11000,
            padding: isMobile ? 16 : 0,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: C.card,
              border: `1px solid ${C.border}`,
              borderRadius: 16,
              padding: isMobile ? "24px 18px" : "32px 28px",
              maxWidth: 440,
              width: "100%",
              boxShadow: "0 20px 60px rgba(0,0,0,0.45)",
            }}
          >
            <div style={{ fontSize: 36, textAlign: "center", marginBottom: 12 }}>🧪</div>
            <h3
              id="beta-modal-title"
              style={{
                margin: "0 0 12px",
                fontSize: isMobile ? FONT.lg : FONT.xl,
                fontWeight: 800,
                color: C.text1,
                textAlign: "center",
                lineHeight: 1.4,
              }}
            >
              결제는 아직 베타 단계입니다
            </h3>
            <p style={{
              margin: "0 0 12px",
              fontSize: FONT.sm,
              color: C.text2,
              lineHeight: 1.7,
              textAlign: "center",
            }}>
              Zepta 구독 결제는 현재 <strong style={{ color: C.text1 }}>시뮬레이션만</strong> 제공하고 있어요.
            </p>
            <p style={{
              margin: "0 0 12px",
              fontSize: FONT.sm,
              color: C.text2,
              lineHeight: 1.7,
              textAlign: "center",
            }}>
              실제 카드 결제 (토스 페이먼츠·Stripe) 는 <strong style={{ color: C.text1 }}>2026 Q3</strong> 안에 정식 오픈 예정입니다.
            </p>
            <p style={{
              margin: "0 0 20px",
              fontSize: FONT.sm,
              color: C.text2,
              lineHeight: 1.7,
              textAlign: "center",
            }}>
              베타 알림을 신청하시면 정식 결제가 열리는 즉시 가장 먼저 알려드릴게요.
            </p>
            <div style={{ display: "flex", gap: 12, flexDirection: isMobile ? "column-reverse" : "row" }}>
              <button
                type="button"
                disabled={busy}
                onClick={() => setBetaModal(null)}
                style={{
                  flex: 1,
                  padding: "12px 16px",
                  minHeight: 44,
                  background: C.card2,
                  border: `1px solid ${C.border}`,
                  color: C.text1,
                  borderRadius: RADIUS.md,
                  fontSize: FONT.sm,
                  fontWeight: 700,
                  cursor: busy ? "default" : "pointer",
                  opacity: busy ? 0.6 : 1,
                }}
              >
                닫기
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={handleBetaWaitlist}
                style={{
                  flex: 1,
                  padding: "12px 16px",
                  minHeight: 44,
                  background: C.blue,
                  border: "none",
                  color: "#fff",
                  borderRadius: RADIUS.md,
                  fontSize: FONT.sm,
                  fontWeight: 700,
                  cursor: busy ? "default" : "pointer",
                  opacity: busy ? 0.7 : 1,
                }}
              >
                {busy ? "신청 중…" : "베타 알림 신청 →"}
              </button>
            </div>
          </div>
        </div>
      )}

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
          zIndex: 11000,
          maxWidth: "90vw",
        }}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}
