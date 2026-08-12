// Zepta v11.3 — 투자 스크리너 + 퀀트 엔진 + 전략 운용 + 리스크 관리 + 스크리너 프리셋
// Features: 스크리닝, 캔들차트, 41개 전략(BTC 알파 포함), 백테스트, 전략별 포트폴리오, 리스크 히트맵, 뉴스, 실전 전략 매매 알림
// v11.3: 퀀트 엔진 v4.1 고변동장 전략 최적화 + 투자진단 v2.2 하락추세 감지 강화
// v11.2: 퀀트 엔진 v3.9 하위전략 2차 안전필터 + 모바일 터치 UX 개선
// v11.1: 다중 타임프레임 RSI 스크리닝 조건 + 퀀트 엔진 v3.8 하위전략 안전필터
// v11.0: 토스증권 벤치마킹 기반 대개편 — 스크리너 프리셋, 글로벌 검색, 위험종목 필터, 실시간 티커
import { useState, useEffect, useCallback, useRef, useMemo, useId, Component, Fragment, lazy, Suspense } from "react";
import AuthProvider, { useAuth } from "./AuthProvider.jsx";
import { LanguageProvider, useLanguage } from "./i18n/LanguageContext.jsx";
import AuthPage from "./AuthPage.jsx";
import { GoogleAd } from "./AdBanner.jsx";
import Header from "./components/Header.jsx";
import SectionTabs from "./components/SectionTabs.jsx";
import { HomeSignalBoard } from "./ui/signal-cards.jsx"; // ★ 리뉴얼 V2 — 홈 라이브 시그널 보드
import PortfolioTab from "./components/PortfolioTab.jsx";
import { supabase } from "./supabaseClient.js";
import { THEME_TOKENS, useTheme } from "./ui/theme.jsx";
import { useIsMobile } from "./ui/useBreakpoint.jsx";
import { BottomSheet, ActionSheet } from "./ui/bottom-sheet.jsx";
import { ga } from "./lib/analytics.js"; // ★ 자체 애널리틱스 (GA 대체)
import { PageHeader } from "./ui/primitives.jsx";
// 기술 지표 (App.jsx 분리 1단계 — 순수 유틸)
import {
  calcRSI, calcRSIArray, calcVolumeProfile, calcSMA, calcBB,
  calcMACD, calcMACDHistogram, calcStochastic, calcWilliamsR,
  calcATR, calcSimpleADX, findSwingPoints,
} from "./lib/indicators.js";

// ════════════════════════════════════════════════════════════════════
// 닉네임 생성 및 관리 유틸
// ════════════════════════════════════════════════════════════════════
const generateRandomNickname = () => {
  const adjectives = ["용감한", "똑똑한", "빠른", "현명한", "대담한", "차분한", "활발한", "침착한", "꼼꼼한", "의리있는", "따뜻한", "신뢰할수있는"];
  const animals = ["호랑이", "독수리", "고래", "사자", "여우", "늑대", "매", "곰", "상어", "팬더", "치타", "원수"];
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const animal = animals[Math.floor(Math.random() * animals.length)];
  return `${adj}${animal}${Math.floor(Math.random() * 100)}`;
};

/* ── 닉네임 에디터 컴포넌트 ── */
function NicknameEditor({ user, supabase, onUpdate }) {
  const { t } = useLanguage();
  const [editing, setEditing] = useState(false);
  const [nickname, setNickname] = useState(user?.user_metadata?.nickname || "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleGenerateRandom = async () => {
    const newNickname = generateRandomNickname();
    setNickname(newNickname);
    await handleSave(newNickname);
  };

  const handleSave = async (nickValue = nickname) => {
    if (!nickValue.trim()) {
      setError(t("nickname.required"));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { error: err } = await supabase.auth.updateUser({
        data: { nickname: nickValue }
      });
      if (err) throw err;
      setEditing(false);
      if (onUpdate) onUpdate();
    } catch (err) {
      setError(err?.message || t("nickname.saveFailed"));
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    setNickname(user?.user_metadata?.nickname || "");
    setEditing(false);
    setError(null);
  };

  const isDirty = nickname !== (user?.user_metadata?.nickname || "");

  const C = {
    card: "var(--color-card, #1a1f2e)",
    border: "var(--color-border, #2a3f5f)",
    blue: "var(--color-blue, #3182f6)",
    text1: "var(--color-text1, #f7f8fa)",
    text3: "var(--color-text3, #6b7d8e)",
  };

  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "16px", overflow: "hidden" }}>
      <div className="px-5 py-3.5 text-sm font-bold text-muted-foreground uppercase tracking-wider">{t("nickname.title")}</div>
      {!editing ? (
        <div className="flex justify-between items-center px-5 py-3.5 border-t" style={{ borderTopColor: `${C.border}20` }}>
          <span className="text-base font-semibold text-foreground">{user?.user_metadata?.nickname || t("nickname.notSet")}</span>
          <button
            onClick={() => setEditing(true)}
            style={{
              padding: "6px 14px", borderRadius: "8px", fontSize: "14px", fontWeight: 600,
              background: C.blue, color: "#fff", border: "none", cursor: "pointer",
            }}
          >
            {t("common.edit")}
          </button>
        </div>
      ) : (
        <div className="px-5 py-4 border-t" style={{ borderTopColor: `${C.border}20` }}>
          <div className="flex gap-2 mb-3">
            <input
              type="text"
              value={nickname}
              onChange={(e) => { setNickname(e.target.value); setError(null); }}
              placeholder={t("nickname.placeholder")}
              style={{
                flex: 1, padding: "8px 12px", borderRadius: "8px",
                border: `1px solid ${C.border}40`, background: "transparent",
                color: C.text1,
                // iOS Safari zoom 방지 — input fontSize ≥ 16px
                fontSize: "16px",
              }}
            />
            <button
              onClick={handleGenerateRandom}
              disabled={loading}
              style={{
                padding: "8px 12px", borderRadius: "8px", fontSize: "14px", fontWeight: 600,
                background: "transparent", color: C.blue, border: `1px solid ${C.blue}40`,
                cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.6 : 1,
              }}
            >
              🎲 {t("nickname.generate")}
            </button>
          </div>
          {error && <div style={{ fontSize: "14px", color: "#ef4444", marginBottom: "10px" }}>{error}</div>}
          <div className="flex gap-2">
            <button
              onClick={() => handleSave()}
              disabled={loading || !isDirty}
              style={{
                flex: 1, padding: "8px", borderRadius: "8px", fontSize: "14px", fontWeight: 600,
                background: isDirty && !loading ? C.blue : `${C.blue}40`, color: "#fff",
                border: "none", cursor: isDirty && !loading ? "pointer" : "not-allowed",
                opacity: isDirty && !loading ? 1 : 0.5,
              }}
            >
              {loading ? t("nickname.saving") : t("common.save")}
            </button>
            <button
              onClick={handleCancel}
              disabled={loading}
              style={{
                flex: 1, padding: "8px", borderRadius: "8px", fontSize: "14px", fontWeight: 600,
                background: "transparent", color: C.text3, border: `1px solid ${C.border}40`,
                cursor: "pointer",
              }}
            >
              {t("common.cancel")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// XP 레벨 시스템 — 누적XP, 레벨, 티어, 보상
// ════════════════════════════════════════════════════════════════════
const XP_TIERS = [
  { name: "브론즈", minLv: 1, color: "#CD7F32", icon: "🥉", next: "실버" },
  { name: "실버", minLv: 5, color: "#C0C0C0", icon: "🥈", next: "골드" },
  { name: "골드", minLv: 10, color: "#FFD700", icon: "🏅", next: "플래티넘" },
  { name: "플래티넘", minLv: 20, color: "#A855F7", icon: "💎", next: "다이아몬드" },
  { name: "다이아몬드", minLv: 35, color: "#3182F6", icon: "👑", next: null },
];

// 레벨별 필요 XP (1→2: 100, 이후 레벨×80 증가)
function xpForLevel(lv) { return lv <= 1 ? 0 : 100 + (lv - 2) * 80; }
function totalXpForLevel(lv) { let s = 0; for (let i = 2; i <= lv; i++) s += xpForLevel(i); return s; }

function getXpInfo(totalXp) {
  let level = 1;
  let remaining = totalXp;
  while (remaining >= xpForLevel(level + 1)) {
    remaining -= xpForLevel(level + 1);
    level++;
    if (level >= 50) break; // max level 50
  }
  const needed = xpForLevel(level + 1);
  const tier = [...XP_TIERS].reverse().find(t => level >= t.minLv) || XP_TIERS[0];
  return { level, totalXp, currentLevelXp: remaining, nextLevelXp: needed, progress: needed > 0 ? remaining / needed : 1, tier };
}

// XP 적립 이벤트별 보상 테이블
const XP_REWARDS = {
  daily_quest_complete: 10,     // 데일리 퀘스트 1개 완료
  daily_all_clear: 30,          // 전 퀘스트 올클리어 보너스
  prediction_correct: 25,       // 주가 예측 적중
  prediction_attempt: 5,        // 예측 참여
  screener_run: 10,             // 스크리너 실행
  news_read: 5,                 // 뉴스 읽기
  streak_7day: 100,             // 7일 연속 접속 보너스
  streak_30day: 500,            // 30일 연속 접속 보너스
  first_watchlist: 20,          // 첫 관심종목 등록
  first_bot: 50,                // 첫 봇 활성화
};

// localStorage에서 누적 XP 읽기/쓰기
function readTotalXp(userId) {
  try { return JSON.parse(localStorage.getItem(`zepta:xp:${userId || "anon"}`) || '{"total":0,"history":[]}')} catch { return { total: 0, history: [] }; }
}
function addXp(userId, amount, reason, syncFn) {
  const data = readTotalXp(userId);
  data.total += amount;
  data.history.unshift({ amount, reason, ts: Date.now() });
  if (data.history.length > 100) data.history = data.history.slice(0, 100); // 최근 100개만
  try { localStorage.setItem(`zepta:xp:${userId || "anon"}`, JSON.stringify(data)); } catch {}
  if (syncFn) syncFn();
  return data;
}

// ════════════════════════════════════════════════════════════════════
// ErrorBoundary — 런타임 에러 시 앱 전체 크래시 방지
// ════════════════════════════════════════════════════════════════════
class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { hasError: false, error: null }; }
  static getDerivedStateFromError(error) { return { hasError: true, error }; }
  componentDidCatch(error, info) {
    console.error("[Zepta ErrorBoundary]", error, info?.componentStack);
    // ★ 2026-06-03: 청크 로드 실패(배포로 해시 바뀌어 stale 캐시가 옛 청크 못 부름) → 1회 자동 새로고침.
    //   "Importing a module script failed" / "Failed to fetch dynamically imported module" / ChunkLoadError.
    const msg = String(error?.message || error || "");
    const isChunkError = /Importing a module script failed|Failed to fetch dynamically imported module|error loading dynamically imported module|ChunkLoadError|Loading (?:CSS )?chunk .* failed/i.test(msg);
    if (isChunkError) {
      try {
        const KEY = "zepta:chunk-reload-at";
        const last = Number(sessionStorage.getItem(KEY) || 0);
        // 30초 내 중복 reload 차단(무한 루프 방지). 처음이면 즉시 최신 청크 받으러 새로고침.
        if (Date.now() - last > 30000) {
          sessionStorage.setItem(KEY, String(Date.now()));
          window.location.reload();
        }
      } catch { /* sessionStorage 불가 환경 — 수동 새로고침 버튼으로 폴백 */ }
    }
  }
  render() {
    if (this.state.hasError) {
      // ★ i18n: ErrorBoundary 는 LanguageProvider 바깥·크래시 상황에서 렌더되므로
      //   t() 대신 localStorage 의 언어 설정으로 직접 분기합니다(컨텍스트 의존 금지).
      let bLang = "ko";
      try { bLang = localStorage.getItem("zepta:lang") || "ko"; } catch {}
      const bMsg = bLang === "en"
        ? { title: "The app hit an error", desc: "This is a temporary error. Refreshing should fix it.", reload: "Refresh", detail: "Error details" }
        : { title: "앱 오류가 발생했습니다", desc: "일시적인 오류입니다. 새로고침하면 정상 작동합니다.", reload: "새로고침", detail: "오류 상세" };
      return (
        <div style={{
          minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center",
          justifyContent: "center", background: "#0A0E17", color: "#F7F8FA", padding: "24px", textAlign: "center",
        }}>
          <div style={{ fontSize: "48px", marginBottom: "16px" }}>⚠️</div>
          <h2 style={{ fontWeight: 800, fontSize: "20px", marginBottom: "8px" }}>{bMsg.title}</h2>
          <p style={{ color: "#6B7D8E", fontSize: "16px", marginBottom: "20px", maxWidth: "360px" }}>
            {bMsg.desc}
          </p>
          <button onClick={() => window.location.reload()} style={{
            padding: "12px 28px", borderRadius: "12px", fontSize: "16px", fontWeight: 700,
            background: "#3182F6", color: "#fff", border: "none", cursor: "pointer",
          }}>{bMsg.reload}</button>
          <details style={{ marginTop: "16px", fontSize: "14px", color: "#6B7D8E", maxWidth: "360px" }}>
            <summary style={{ cursor: "pointer" }}>{bMsg.detail}</summary>
            <pre style={{ textAlign: "left", fontSize: "14px", whiteSpace: "pre-wrap", wordBreak: "break-all", marginTop: "8px" }}>
              {this.state.error?.message}
            </pre>
          </details>
        </div>
      );
    }
    return this.props.children;
  }
}
// ── 코드 스플리팅: 무거운 페이지/모달은 lazy 로드 (초기 번들 -40~55% 목표) ──
const ChartModal = lazy(() => import("./ChartModal.jsx"));
const StrategyPanel = lazy(() => import("./StrategyPanel.jsx"));
const BacktestPanel = lazy(() => import("./BacktestPanel.jsx"));
const QuantPortfolio = lazy(() => import("./QuantPortfolio.jsx"));
const RiskHeatmap = lazy(() => import("./RiskHeatmap.jsx"));
const AutoTrading = lazy(() => import("./AutoTrading.jsx"));
const DevDashboard = lazy(() => import("./DevDashboard.jsx"));
const RealTrading = lazy(() => import("./RealTrading.jsx"));
const AlphaLab = lazy(() => import("./AlphaLab.jsx"));
const NotificationHub = lazy(() => import("./NotificationHub.jsx"));
const SavedScreeners = lazy(() => import("./SavedScreeners.jsx"));
const MarketingDashboard = lazy(() => import("./MarketingDashboard.jsx")); // ★ 자체 애널리틱스 (GA 대체)
const BotLeaderboard = lazy(() => import("./BotLeaderboard.jsx"));
const BotReport = lazy(() => import("./BotReport.jsx"));
const BacktestCompare = lazy(() => import("./BacktestCompare.jsx"));
const CopyTrading = lazy(() => import("./CopyTrading.jsx"));
const Onboarding = lazy(() => import("./Onboarding.jsx"));
// PLAN-SVC #3 (2026-05-11) — 포트폴리오 분석 페이지
const PortfolioAnalysis = lazy(() => import("./PortfolioAnalysis.jsx"));
// PLAN-BIZ Q3 #1 (2026-05-11) — 구독 모델 (Free / Pro / Premium)
const Pricing = lazy(() => import("./Pricing.jsx"));
// ★ 2026-08-12 IA v3: 지표 허브(IndicatorHub) 페이지 폐지 — 게이지 그리드는 코인 탭
//   컨텍스트 카드·홈 스냅샷이 흡수, /indicators 는 캘린더+뉴스 서브탭 화면으로 재구성.
const AssetDetailSheet = lazy(() => import("./pages/AssetDetailSheet.jsx")); // ★ 2026-08 모바일 시안 — 종목 상세 시트
// ★ 감사 배치3 (perf): strategies.js(압축 후 86KB)는 스캔 완료 후의 전략 알림 생성
//   (generateStrategyAlerts)에서만 쓰입니다 — 정적 import 를 제거하고 해당 함수 안에서
//   dynamic import 로 받아 첫 페인트 번들에서 분리했습니다. 나머지 소비처
//   (StrategyPanel·BacktestPanel·QuantPortfolio·BTCTrading·PaperTrading)는 전부
//   lazy 컴포넌트라 이 파일을 엔트리에 묶어두던 유일한 원인이 이 import 였습니다.
import { IndicatorCard } from "./components/uiKit.jsx"; // ★ 디자인 시스템 v1 — 홈 ④ 첫 적용
// ★ 2026-08 모바일 디자인 시안(Zepta Mobile App) 컴포넌트 세트 — src/components/mobileKit.jsx
//   시안이 정의한 "정보 카드 문법"을 그대로 씁니다. 색은 전부 테마 토큰이라 라이트도 함께 동작.
import {
  SignalCard, AssetRow, ListCard, IndexStrip, GaugeCard,
  MobileSectionHeader, IconButton, Segment, EventCard, Disclaimer, Num,
  MONO, accentOf, ChangeNum, Sparkline,
} from "./components/mobileKit.jsx";

// ════════════════════════════════════════════════════════════════════
// ★ 2026-08-12 IA v3 — 홈 섹션 카드 문법 (시안 zepta-ia-v3 1d · 설계서 v3 1장)
//   대표 지시: "섹션 = 카드 컨테이너로 명확히 구분 + 텍스트 링크 전부 칩/버튼화".
//   헤더 규격(통일안): 제목 15/800 + LIVE 도트(7px, 실시간 섹션만) + 우측 액션 정확히
//   1개(높이 28px 알약 칩). mobileKit 의 MobileSectionHeader 는 "떠 있는 제목 + 텍스트
//   버튼" 문법이라 홈에서는 이 카드 문법으로 대체합니다(다른 탭은 각 슬라이스가 정리).
//   색은 전부 모듈 C 토큰 — 칩 텍스트는 시안대로 다크 blueL(#9D8FFF)/라이트 blue(#6553E8)
//   (라이트 blueL 은 틴트 배경 위 4.5:1 미달이라 blue 를 써야 AA 통과).
// ════════════════════════════════════════════════════════════════════
function HomeActionChip({ label, onClick, href, disabled = false, ariaLabel, style }) {
  const common = {
    display: "inline-flex", alignItems: "center", height: "28px", padding: "0 11px",
    borderRadius: "9999px", border: "none", background: `${C.blue}1F`,
    color: C.isDark ? C.blueL : C.blue, fontSize: "11.5px", fontWeight: 800,
    whiteSpace: "nowrap", cursor: disabled ? "default" : "pointer",
    fontFamily: "inherit", textDecoration: "none", flexShrink: 0, lineHeight: 1,
    opacity: disabled ? 0.55 : 1, ...style,
  };
  if (href) return <a href={href} aria-label={ariaLabel} style={common}>{label}</a>;
  return <button type="button" onClick={onClick} disabled={disabled} aria-label={ariaLabel} style={common}>{label}</button>;
}

/** 홈 섹션 카드 — 헤더 행이 카드 "안"에 들어가고 본문과 1px 경계(C.card2)로 구분됩니다.
 *  action: { label, onClick?, href?, disabled? } — 헤더 우측 액션은 정확히 1개만 받습니다.
 *  리스트형 본문(행이 자체 패딩·구분선을 가짐)은 bodyStyle={{ padding: 0 }} 로 쓰세요. */
function HomeSection({ title, live = false, action, children, bodyStyle, style }) {
  return (
    <section style={{
      background: C.card, border: `1px solid ${C.border}`, borderRadius: "16px",
      overflow: "hidden", ...style,
    }}>
      <div style={{
        display: "flex", alignItems: "center", gap: "7px", minHeight: "46px",
        padding: "8px 14px", borderBottom: `1px solid ${C.card2}`,
      }}>
        <h2 style={{
          margin: 0, fontSize: "15px", fontWeight: 800, color: C.text1,
          minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>{title}</h2>
        {/* z-pulse: tokens.css 의 기존 2초 pulse 유틸(신규 keyframe 없음) */}
        {live && <span className="z-pulse" aria-hidden="true" style={{ width: "7px", height: "7px", borderRadius: "50%", background: C.green, flexShrink: 0 }} />}
        <span style={{ flex: 1 }} />
        {action && <HomeActionChip {...action} />}
      </div>
      <div style={{ padding: "12px 14px", ...bodyStyle }}>{children}</div>
    </section>
  );
}

/** MY 설정 알약 세그먼트 (★ 2026-08-12 IA v3 시안 1e) — 테마·언어 2옵션 토글 전용.
 *  값·핸들러는 호출부 배선(toggleTheme / setLang) 그대로 — 표현만 시안 알약입니다.
 *  활성 알약은 C.blue 바탕 + 흰 글자(기존 프리셋 버튼과 같은 조합, AA 통과). */
function SettingPills({ options, value, onSelect, ariaLabel }) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} style={{
      display: "inline-flex", gap: "2px", background: C.bg, border: `1px solid ${C.border}`,
      borderRadius: "9999px", padding: "3px", flexShrink: 0,
    }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button key={o.value} type="button" role="radio" aria-checked={on}
            onClick={() => { if (!on) onSelect(o.value); }}
            style={{
              border: "none", borderRadius: "9999px", padding: "5px 13px", minHeight: "30px",
              fontSize: "12px", fontWeight: on ? 800 : 700, fontFamily: "inherit", lineHeight: 1,
              background: on ? C.blue : "transparent", color: on ? "#fff" : C.text3,
              cursor: on ? "default" : "pointer",
            }}>{o.label}</button>
        );
      })}
    </div>
  );
}

// 공용 lazy fallback — 탭 전환 시 0.1~0.3초 노출
function LazyTabFallback() {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "60vh" }}>
      <div style={{
        width: 36, height: 36, borderRadius: "50%",
        border: "3px solid rgba(255,255,255,0.08)",
        borderTopColor: "#3182f6",
        animation: "spin 0.8s linear infinite",
      }} />
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// 데이터 정의
// ════════════════════════════════════════════════════════════════════
const US_ASSETS = [
  // ── Mega Cap Tech ──
  { symbol: "AAPL", name: "Apple" }, { symbol: "MSFT", name: "Microsoft" },
  { symbol: "GOOGL", name: "Alphabet" }, { symbol: "AMZN", name: "Amazon" },
  { symbol: "NVDA", name: "NVIDIA" }, { symbol: "META", name: "Meta" },
  { symbol: "TSLA", name: "Tesla" }, { symbol: "NFLX", name: "Netflix" },
  // ── Semiconductors ──
  { symbol: "AMD", name: "AMD" }, { symbol: "INTC", name: "Intel" },
  { symbol: "AVGO", name: "Broadcom" }, { symbol: "QCOM", name: "Qualcomm" },
  { symbol: "MU", name: "Micron" }, { symbol: "MRVL", name: "Marvell" },
  { symbol: "SMCI", name: "Super Micro" }, { symbol: "ARM", name: "ARM Holdings" },
  { symbol: "ASML", name: "ASML" }, { symbol: "TSM", name: "TSMC" },
  { symbol: "LRCX", name: "Lam Research" }, { symbol: "KLAC", name: "KLA" },
  { symbol: "AMAT", name: "Applied Materials" }, { symbol: "ON", name: "ON Semi" },
  { symbol: "TXN", name: "Texas Instruments" }, { symbol: "ADI", name: "Analog Devices" },
  // ── Software & Cloud ──
  { symbol: "CRM", name: "Salesforce" }, { symbol: "ORCL", name: "Oracle" },
  { symbol: "ADBE", name: "Adobe" }, { symbol: "NOW", name: "ServiceNow" },
  { symbol: "SHOP", name: "Shopify" }, { symbol: "SNOW", name: "Snowflake" },
  { symbol: "DDOG", name: "Datadog" }, { symbol: "NET", name: "Cloudflare" },
  { symbol: "ZS", name: "Zscaler" }, { symbol: "PANW", name: "Palo Alto" },
  { symbol: "CRWD", name: "CrowdStrike" }, { symbol: "FTNT", name: "Fortinet" },
  { symbol: "WDAY", name: "Workday" }, { symbol: "HUBS", name: "HubSpot" },
  { symbol: "TEAM", name: "Atlassian" }, { symbol: "MDB", name: "MongoDB" },
  { symbol: "PLTR", name: "Palantir" }, { symbol: "AI", name: "C3.ai" },
  { symbol: "PATH", name: "UiPath" }, { symbol: "DOCN", name: "DigitalOcean" },
  // ── Internet & Social ──
  { symbol: "SNAP", name: "Snap" }, { symbol: "PINS", name: "Pinterest" },
  { symbol: "UBER", name: "Uber" }, { symbol: "LYFT", name: "Lyft" },
  { symbol: "ABNB", name: "Airbnb" }, { symbol: "BKNG", name: "Booking" },
  { symbol: "DASH", name: "DoorDash" }, { symbol: "RBLX", name: "Roblox" },
  { symbol: "U", name: "Unity" }, { symbol: "TTWO", name: "Take-Two" },
  { symbol: "EA", name: "EA Games" }, { symbol: "ROKU", name: "Roku" },
  { symbol: "SPOT", name: "Spotify" },
  // ── Fintech & Crypto ──
  { symbol: "COIN", name: "Coinbase" }, { symbol: "SQ", name: "Block" },
  { symbol: "PYPL", name: "PayPal" }, { symbol: "AFRM", name: "Affirm" },
  { symbol: "SOFI", name: "SoFi" }, { symbol: "HOOD", name: "Robinhood" },
  { symbol: "MSTR", name: "MicroStrategy" },
  // ── Finance (Banks & Asset Mgmt) ──
  { symbol: "V", name: "Visa" }, { symbol: "MA", name: "Mastercard" },
  { symbol: "JPM", name: "JPMorgan" }, { symbol: "GS", name: "Goldman Sachs" },
  { symbol: "BAC", name: "BofA" }, { symbol: "WFC", name: "Wells Fargo" },
  { symbol: "MS", name: "Morgan Stanley" }, { symbol: "C", name: "Citigroup" },
  { symbol: "BLK", name: "BlackRock" }, { symbol: "SCHW", name: "Schwab" },
  { symbol: "AXP", name: "Amex" }, { symbol: "BX", name: "Blackstone" },
  { symbol: "KKR", name: "KKR" }, { symbol: "APO", name: "Apollo" },
  // ── Healthcare & Pharma ──
  { symbol: "UNH", name: "UnitedHealth" }, { symbol: "JNJ", name: "J&J" },
  { symbol: "LLY", name: "Eli Lilly" }, { symbol: "NVO", name: "Novo Nordisk" },
  { symbol: "ABBV", name: "AbbVie" }, { symbol: "PFE", name: "Pfizer" },
  { symbol: "MRK", name: "Merck" }, { symbol: "TMO", name: "Thermo Fisher" },
  { symbol: "ABT", name: "Abbott" }, { symbol: "BMY", name: "Bristol-Myers" },
  { symbol: "AMGN", name: "Amgen" }, { symbol: "GILD", name: "Gilead" },
  { symbol: "ISRG", name: "Intuitive Surgical" }, { symbol: "VRTX", name: "Vertex" },
  { symbol: "REGN", name: "Regeneron" }, { symbol: "MRNA", name: "Moderna" },
  // ── Industrials & Defense ──
  { symbol: "BA", name: "Boeing" }, { symbol: "CAT", name: "Caterpillar" },
  { symbol: "DE", name: "Deere" }, { symbol: "HON", name: "Honeywell" },
  { symbol: "RTX", name: "RTX (Raytheon)" }, { symbol: "LMT", name: "Lockheed Martin" },
  { symbol: "GE", name: "GE Aerospace" }, { symbol: "UPS", name: "UPS" },
  { symbol: "FDX", name: "FedEx" },
  // ── Energy ──
  { symbol: "XOM", name: "Exxon" }, { symbol: "CVX", name: "Chevron" },
  { symbol: "LNG", name: "Cheniere" }, { symbol: "COP", name: "ConocoPhillips" },
  { symbol: "SLB", name: "Schlumberger" }, { symbol: "OXY", name: "Occidental" },
  { symbol: "EOG", name: "EOG Resources" },
  // ── Consumer ──
  { symbol: "WMT", name: "Walmart" }, { symbol: "COST", name: "Costco" },
  { symbol: "HD", name: "Home Depot" }, { symbol: "MCD", name: "McDonalds" },
  { symbol: "DIS", name: "Disney" }, { symbol: "SBUX", name: "Starbucks" },
  { symbol: "NKE", name: "Nike" }, { symbol: "TGT", name: "Target" },
  { symbol: "LOW", name: "Lowe's" }, { symbol: "KO", name: "Coca-Cola" },
  { symbol: "PEP", name: "Pepsi" }, { symbol: "PG", name: "P&G" },
  { symbol: "PM", name: "Philip Morris" }, { symbol: "CL", name: "Colgate" },
  // ── Telecom & Media ──
  { symbol: "T", name: "AT&T" }, { symbol: "VZ", name: "Verizon" },
  { symbol: "TMUS", name: "T-Mobile" }, { symbol: "CMCSA", name: "Comcast" },
  { symbol: "WBD", name: "Warner Bros" }, { symbol: "PARA", name: "Paramount" },
  // ── Real Estate ──
  { symbol: "AMT", name: "American Tower" }, { symbol: "PLD", name: "Prologis" },
  { symbol: "O", name: "Realty Income" }, { symbol: "EQIX", name: "Equinix" },
  // ── EV & Clean Energy ──
  { symbol: "RIVN", name: "Rivian" }, { symbol: "LCID", name: "Lucid" },
  { symbol: "LI", name: "Li Auto" }, { symbol: "NIO", name: "NIO" },
  { symbol: "XPEV", name: "XPeng" }, { symbol: "ENPH", name: "Enphase" },
  { symbol: "FSLR", name: "First Solar" }, { symbol: "PLUG", name: "Plug Power" },
  // ── China ADRs ──
  { symbol: "BABA", name: "Alibaba" }, { symbol: "JD", name: "JD.com" },
  { symbol: "PDD", name: "PDD (Temu)" }, { symbol: "BIDU", name: "Baidu" },
  { symbol: "NTES", name: "NetEase" }, { symbol: "TME", name: "Tencent Music" },
  // ── ETFs — 주요 인덱스 ──
  { symbol: "SPY", name: "S&P 500 ETF" }, { symbol: "QQQ", name: "나스닥 100 ETF" },
  { symbol: "DIA", name: "다우 ETF" }, { symbol: "IWM", name: "Russell 2000" },
  { symbol: "VOO", name: "Vanguard S&P500" }, { symbol: "VTI", name: "US Total Market" },
  { symbol: "VT", name: "World Total" }, { symbol: "VEA", name: "선진국 ETF" },
  { symbol: "VWO", name: "이머징 Vanguard" }, { symbol: "EFA", name: "EAFE ETF" },
  // ── 레버리지/인버스 ──
  { symbol: "TQQQ", name: "나스닥 3x" }, { symbol: "SQQQ", name: "나스닥 -3x" },
  { symbol: "UPRO", name: "S&P 3x" }, { symbol: "SPXS", name: "S&P -3x" },
  { symbol: "SOXL", name: "반도체 3x" }, { symbol: "SOXS", name: "반도체 -3x" },
  { symbol: "TECL", name: "테크 3x" }, { symbol: "TECS", name: "테크 -3x" },
  { symbol: "FAS", name: "금융 3x" }, { symbol: "FAZ", name: "금융 -3x" },
  { symbol: "LABU", name: "바이오 3x" }, { symbol: "LABD", name: "바이오 -3x" },
  { symbol: "TNA", name: "Russell 3x" }, { symbol: "TZA", name: "Russell -3x" },
  { symbol: "SPXU", name: "S&P -3x Ultra" }, { symbol: "UDOW", name: "다우 3x" },
  { symbol: "SDOW", name: "다우 -3x" }, { symbol: "WEBL", name: "인터넷 3x" },
  { symbol: "WEBS", name: "인터넷 -3x" }, { symbol: "FNGU", name: "FANG+ 3x" },
  { symbol: "FNGD", name: "FANG+ -3x" }, { symbol: "NAIL", name: "주택건설 3x" },
  { symbol: "TMF", name: "장기채 3x" }, { symbol: "TMV", name: "장기채 -3x" },
  { symbol: "NUGT", name: "금광 2x" }, { symbol: "DUST", name: "금광 -2x" },
  { symbol: "JNUG", name: "주니어금광 2x" }, { symbol: "JDST", name: "주니어금광 -2x" },
  { symbol: "BOIL", name: "천연가스 2x" }, { symbol: "KOLD", name: "천연가스 -2x" },
  { symbol: "UCO", name: "원유 2x" }, { symbol: "SCO", name: "원유 -2x" },
  // ── 크립토 ETF ──
  { symbol: "BITX", name: "BTC 2x 레버리지" }, { symbol: "BITO", name: "ProShares BTC" },
  { symbol: "BITI", name: "ProShares Short BTC" }, { symbol: "IBIT", name: "iShares BTC Trust" },
  { symbol: "FBTC", name: "Fidelity BTC" }, { symbol: "GBTC", name: "Grayscale BTC" },
  { symbol: "ARKB", name: "ARK 21Shares BTC" }, { symbol: "BITB", name: "Bitwise BTC" },
  { symbol: "HODL", name: "VanEck BTC" }, { symbol: "BRRR", name: "Valkyrie BTC" },
  { symbol: "ETHE", name: "Grayscale ETH" }, { symbol: "ETHA", name: "iShares ETH" },
  { symbol: "FETH", name: "Fidelity ETH" }, { symbol: "ETHV", name: "VanEck ETH" },
  { symbol: "BTCW", name: "WisdomTree BTC" }, { symbol: "EZBC", name: "Franklin BTC" },
  { symbol: "SBIT", name: "ProShares Short BTC 2x" },
  // ── ARK 혁신 ETF ──
  { symbol: "ARKK", name: "ARK Innovation" }, { symbol: "ARKW", name: "ARK Next Gen" },
  { symbol: "ARKG", name: "ARK Genomic" }, { symbol: "ARKF", name: "ARK Fintech" },
  { symbol: "ARKQ", name: "ARK Autonomous" }, { symbol: "ARKX", name: "ARK Space" },
  // ── 원자재/금속 ──
  { symbol: "GLD", name: "Gold ETF" }, { symbol: "SLV", name: "Silver ETF" },
  { symbol: "IAU", name: "iShares Gold" }, { symbol: "SGOL", name: "Aberdeen Gold" },
  { symbol: "PPLT", name: "Platinum ETF" }, { symbol: "PALL", name: "Palladium ETF" },
  { symbol: "DBA", name: "농산물 ETF" }, { symbol: "WEAT", name: "밀 ETF" },
  { symbol: "CORN", name: "옥수수 ETF" }, { symbol: "CPER", name: "구리 ETF(US)" },
  { symbol: "UNG", name: "Natural Gas" }, { symbol: "USO", name: "원유 ETF" },
  { symbol: "COPX", name: "구리광산 ETF" }, { symbol: "LIT", name: "리튬&배터리" },
  { symbol: "URA", name: "우라늄 ETF" }, { symbol: "REMX", name: "희토류 ETF" },
  // ── 채권 ──
  { symbol: "TLT", name: "미국 장기채" }, { symbol: "SHY", name: "미국 단기채" },
  { symbol: "IEF", name: "미국 중기채" }, { symbol: "BND", name: "Total Bond" },
  { symbol: "AGG", name: "US Agg Bond" }, { symbol: "HYG", name: "High Yield Bond" },
  { symbol: "LQD", name: "Investment Grade" }, { symbol: "TIP", name: "물가연동채" },
  { symbol: "EMB", name: "이머징 채권" }, { symbol: "JNK", name: "정크 본드" },
  // ── 배당 ──
  { symbol: "SCHD", name: "배당 ETF" }, { symbol: "JEPI", name: "JP모건 인컴" },
  { symbol: "JEPQ", name: "JP모건 나스닥인컴" }, { symbol: "VIG", name: "배당 성장 ETF" },
  { symbol: "NOBL", name: "배당 귀족 ETF" }, { symbol: "DVY", name: "Select Dividend" },
  { symbol: "HDV", name: "iShares 고배당" }, { symbol: "DIVO", name: "Amplify 배당인컴" },
  { symbol: "QYLD", name: "나스닥 커버드콜" }, { symbol: "XYLD", name: "S&P 커버드콜" },
  { symbol: "RYLD", name: "Russell 커버드콜" }, { symbol: "NUSI", name: "나스닥 헤지인컴" },
  // ── 섹터 Select ──
  { symbol: "XLF", name: "금융 Select" }, { symbol: "XLE", name: "에너지 Select" },
  { symbol: "XLK", name: "테크 Select" }, { symbol: "XLV", name: "헬스케어 Select" },
  { symbol: "XLI", name: "산업재 Select" }, { symbol: "XLC", name: "커뮤니케이션 Select" },
  { symbol: "XLRE", name: "부동산 Select" }, { symbol: "XLU", name: "유틸리티 Select" },
  { symbol: "XLP", name: "필수소비재 Select" }, { symbol: "XLY", name: "임의소비재 Select" },
  { symbol: "XLB", name: "소재 Select" },
  // ── 테마 ETF ──
  { symbol: "KWEB", name: "China Internet" }, { symbol: "EEM", name: "Emerging Markets" },
  { symbol: "VNQ", name: "Real Estate" }, { symbol: "SOXX", name: "반도체 iShares" },
  { symbol: "SMH", name: "반도체 VanEck" }, { symbol: "IGV", name: "소프트웨어 ETF" },
  { symbol: "HACK", name: "사이버보안 ETF" }, { symbol: "BOTZ", name: "로봇&AI ETF" },
  { symbol: "ROBO", name: "로보틱스 ETF" }, { symbol: "AIQ", name: "AI ETF" },
  { symbol: "IRBO", name: "iShares 로보틱스" }, { symbol: "DRIV", name: "자율주행 ETF" },
  { symbol: "CLOU", name: "클라우드 ETF" }, { symbol: "SKYY", name: "클라우드 First Trust" },
  { symbol: "WCLD", name: "클라우드 SaaS" }, { symbol: "CIBR", name: "사이버보안 First Trust" },
  { symbol: "TAN", name: "태양광 ETF" }, { symbol: "ICLN", name: "클린에너지" },
  { symbol: "QCLN", name: "클린에너지 First Trust" }, { symbol: "PBW", name: "클린에너지 WilderHill" },
  { symbol: "FAN", name: "풍력 ETF" }, { symbol: "ERTH", name: "기후 ETF" },
  { symbol: "ESGU", name: "ESG ETF" }, { symbol: "KRMA", name: "ESG 글로벌" },
  { symbol: "IBB", name: "바이오 iShares" }, { symbol: "XBI", name: "바이오 SPDR" },
  { symbol: "GNOM", name: "게노믹스 ETF" }, { symbol: "ITA", name: "방산 ETF" }, { symbol: "PPA", name: "항공방산 ETF" },
  { symbol: "JETS", name: "항공사 ETF" }, { symbol: "AWAY", name: "여행 ETF" },
  { symbol: "BETZ", name: "스포츠베팅 ETF" }, { symbol: "HERO", name: "게임 ETF" },
  { symbol: "SOCL", name: "소셜미디어 ETF" }, { symbol: "MSOS", name: "대마 ETF" },
  // ── 변동성 ──
  { symbol: "UVXY", name: "VIX 1.5x" }, { symbol: "SVXY", name: "VIX Short" },
  { symbol: "VXX", name: "VIX 단기선물" }, { symbol: "VIXY", name: "VIX Short-Term" },
  // ── 국가/지역 ──
  { symbol: "FXI", name: "China Large Cap" }, { symbol: "MCHI", name: "China MSCI" },
  { symbol: "EWJ", name: "Japan ETF" }, { symbol: "EWY", name: "Korea ETF" },
  { symbol: "EWZ", name: "Brazil ETF" }, { symbol: "INDA", name: "India ETF" },
  { symbol: "EWT", name: "Taiwan ETF" }, { symbol: "EWG", name: "Germany ETF" },
  { symbol: "EWU", name: "UK ETF" }, { symbol: "EWA", name: "Australia ETF" },
  { symbol: "EWC", name: "Canada ETF" }, { symbol: "ERUS", name: "Russia ETF" },
  { symbol: "TUR", name: "Turkey ETF" }, { symbol: "RSX", name: "Russia VanEck" },
  { symbol: "GXC", name: "China SPDR" }, { symbol: "ASHR", name: "China A-Shares" },
  // ── 추가 대형주 ──
  { symbol: "BRK-B", name: "Berkshire Hathaway" }, { symbol: "LIN", name: "Linde" },
  { symbol: "INTU", name: "Intuit" }, { symbol: "SPGI", name: "S&P Global" },
  { symbol: "ICE", name: "Intercontinental Exchange" }, { symbol: "MCO", name: "Moody's" },
  { symbol: "CDNS", name: "Cadence Design" }, { symbol: "SNPS", name: "Synopsys" },
  { symbol: "ZM", name: "Zoom" }, { symbol: "OKTA", name: "Okta" },
  { symbol: "BILL", name: "Bill.com" }, { symbol: "TTD", name: "Trade Desk" },
  { symbol: "APP", name: "AppLovin" }, { symbol: "RDDT", name: "Reddit" },
  { symbol: "DUOL", name: "Duolingo" }, { symbol: "CELH", name: "Celsius Holdings" },
  { symbol: "MELI", name: "MercadoLibre" }, { symbol: "SE", name: "Sea Ltd" },
  { symbol: "GRAB", name: "Grab" }, { symbol: "NU", name: "Nu Holdings" },
  { symbol: "CPNG", name: "Coupang" }, { symbol: "GLOB", name: "Globant" },
  { symbol: "DKNG", name: "DraftKings" }, { symbol: "PENN", name: "Penn Entertainment" },
  { symbol: "CHWY", name: "Chewy" }, { symbol: "BROS", name: "Dutch Bros" },
  { symbol: "CAVA", name: "Cava Group" }, { symbol: "VST", name: "Vistra Energy" },
  { symbol: "CEG", name: "Constellation Energy" }, { symbol: "TLN", name: "Talen Energy" },
  { symbol: "IONQ", name: "IonQ" }, { symbol: "RGTI", name: "Rigetti Computing" },
  { symbol: "QBTS", name: "D-Wave Quantum" }, { symbol: "SMRT", name: "SmartRent" },
  // ── 추가 Large/Mid Cap (S&P500 채우기) ──
  { symbol: "ACN", name: "Accenture" }, { symbol: "CSCO", name: "Cisco" },
  { symbol: "IBM", name: "IBM" }, { symbol: "NXPI", name: "NXP Semi" },
  { symbol: "MCHP", name: "Microchip" }, { symbol: "SWKS", name: "Skyworks" },
  { symbol: "MPWR", name: "Monolithic Power" }, { symbol: "GFS", name: "GlobalFoundries" },
  { symbol: "WOLF", name: "Wolfspeed" }, { symbol: "CRUS", name: "Cirrus Logic" },
  { symbol: "ALGM", name: "Allegro MicroSystems" },
  { symbol: "DHR", name: "Danaher" }, { symbol: "SYK", name: "Stryker" },
  { symbol: "MDT", name: "Medtronic" }, { symbol: "BSX", name: "Boston Scientific" },
  { symbol: "EW", name: "Edwards Lifesciences" }, { symbol: "ZTS", name: "Zoetis" },
  { symbol: "DXCM", name: "DexCom" }, { symbol: "HOLX", name: "Hologic" },
  { symbol: "ILMN", name: "Illumina" }, { symbol: "BIIB", name: "Biogen" },
  { symbol: "SGEN", name: "Seagen" }, { symbol: "EXAS", name: "Exact Sciences" },
  { symbol: "NVCR", name: "NovoCure" }, { symbol: "HALO", name: "Halozyme" },
  { symbol: "ALNY", name: "Alnylam" }, { symbol: "PCVX", name: "Vaxcyte" },
  { symbol: "MMM", name: "3M" }, { symbol: "EMR", name: "Emerson" },
  { symbol: "ETN", name: "Eaton" }, { symbol: "GD", name: "General Dynamics" },
  { symbol: "NOC", name: "Northrop Grumman" }, { symbol: "HII", name: "Huntington Ingalls" },
  { symbol: "TDG", name: "TransDigm" }, { symbol: "WM", name: "Waste Management" },
  { symbol: "RSG", name: "Republic Services" }, { symbol: "IR", name: "Ingersoll Rand" },
  { symbol: "URI", name: "United Rentals" }, { symbol: "PWR", name: "Quanta Services" },
  { symbol: "AME", name: "Ametek" }, { symbol: "ROK", name: "Rockwell Automation" },
  { symbol: "DOV", name: "Dover" }, { symbol: "CMI", name: "Cummins" },
  { symbol: "PH", name: "Parker Hannifin" }, { symbol: "ITW", name: "Illinois Tool Works" },
  { symbol: "GPC", name: "Genuine Parts" }, { symbol: "SHW", name: "Sherwin-Williams" },
  { symbol: "ECL", name: "Ecolab" }, { symbol: "APD", name: "Air Products" },
  { symbol: "FCX", name: "Freeport-McMoRan" }, { symbol: "NEM", name: "Newmont" },
  { symbol: "GOLD", name: "Barrick Gold" }, { symbol: "AEM", name: "Agnico Eagle" },
  { symbol: "VALE", name: "Vale" }, { symbol: "RIO", name: "Rio Tinto" },
  { symbol: "BHP", name: "BHP Group" }, { symbol: "DD", name: "DuPont" },
  { symbol: "DOW", name: "Dow Inc" }, { symbol: "PPG", name: "PPG Industries" },
  { symbol: "ALB", name: "Albemarle" }, { symbol: "LTHM", name: "Livent" },
  { symbol: "NEE", name: "NextEra Energy" }, { symbol: "DUK", name: "Duke Energy" },
  { symbol: "SO", name: "Southern Co" }, { symbol: "AEP", name: "American Electric" },
  { symbol: "EXC", name: "Exelon" }, { symbol: "D", name: "Dominion Energy" },
  { symbol: "ED", name: "Consolidated Edison" }, { symbol: "PCG", name: "PG&E" },
  { symbol: "HAL", name: "Halliburton" }, { symbol: "BKR", name: "Baker Hughes" },
  { symbol: "DVN", name: "Devon Energy" }, { symbol: "FANG", name: "Diamondback Energy" },
  { symbol: "MPC", name: "Marathon Petroleum" }, { symbol: "VLO", name: "Valero Energy" },
  { symbol: "PSX", name: "Phillips 66" },
  { symbol: "CB", name: "Chubb" }, { symbol: "PGR", name: "Progressive" },
  { symbol: "TRV", name: "Travelers" }, { symbol: "ALL", name: "Allstate" },
  { symbol: "MET", name: "MetLife" }, { symbol: "AIG", name: "AIG" },
  { symbol: "PRU", name: "Prudential Financial" },
  { symbol: "CME", name: "CME Group" }, { symbol: "MSCI", name: "MSCI" },
  { symbol: "FIS", name: "Fidelity National" }, { symbol: "FISV", name: "Fiserv" },
  { symbol: "GPN", name: "Global Payments" }, { symbol: "WTW", name: "Willis Towers" },
  { symbol: "TROW", name: "T. Rowe Price" }, { symbol: "STT", name: "State Street" },
  { symbol: "NTRS", name: "Northern Trust" }, { symbol: "USB", name: "US Bancorp" },
  { symbol: "PNC", name: "PNC Financial" }, { symbol: "TFC", name: "Truist" },
  { symbol: "FITB", name: "Fifth Third" }, { symbol: "CFG", name: "Citizens Financial" },
  { symbol: "RF", name: "Regions Financial" }, { symbol: "KEY", name: "KeyCorp" },
  { symbol: "DG", name: "Dollar General" }, { symbol: "DLTR", name: "Dollar Tree" },
  { symbol: "ROST", name: "Ross Stores" }, { symbol: "TJX", name: "TJX Companies" },
  { symbol: "ORLY", name: "O'Reilly Auto" }, { symbol: "AZO", name: "AutoZone" },
  { symbol: "YUM", name: "Yum! Brands" }, { symbol: "CMG", name: "Chipotle" },
  { symbol: "DHI", name: "D.R. Horton" }, { symbol: "LEN", name: "Lennar" },
  { symbol: "PHM", name: "PulteGroup" }, { symbol: "TOL", name: "Toll Brothers" },
  { symbol: "EL", name: "Estee Lauder" }, { symbol: "LULU", name: "Lululemon" },
  { symbol: "DECK", name: "Deckers" }, { symbol: "F", name: "Ford" }, { symbol: "GM", name: "General Motors" },
  { symbol: "STLA", name: "Stellantis" }, { symbol: "TM", name: "Toyota" },
  { symbol: "HMC", name: "Honda" }, { symbol: "RACE", name: "Ferrari" },
  // ── 추가 Mid/Small Cap 성장주 ──
  { symbol: "MNST", name: "Monster Beverage" }, { symbol: "TOST", name: "Toast" },
  { symbol: "FOUR", name: "Shift4 Payments" }, { symbol: "RELY", name: "Remitly" },
  { symbol: "GLBE", name: "Global-e Online" }, { symbol: "CWAN", name: "Clearwater Analytics" },
  { symbol: "CFLT", name: "Confluent" }, { symbol: "GTLB", name: "GitLab" },
  { symbol: "ESTC", name: "Elastic" }, { symbol: "BRZE", name: "Braze" },
  { symbol: "S", name: "SentinelOne" }, { symbol: "RPD", name: "Rapid7" },
  { symbol: "VRNS", name: "Varonis" }, { symbol: "TENB", name: "Tenable" },
  { symbol: "PCOR", name: "Procore Tech" }, { symbol: "SMAR", name: "Smartsheet" },
  { symbol: "FROG", name: "JFrog" }, { symbol: "DT", name: "Dynatrace" },
  { symbol: "VEEV", name: "Veeva Systems" }, { symbol: "TYL", name: "Tyler Technologies" }, { symbol: "PAYC", name: "Paycom" },
  { symbol: "PCTY", name: "Paylocity" }, { symbol: "WK", name: "Workiva" },
  { symbol: "BLKB", name: "Blackbaud" }, { symbol: "SSNC", name: "SS&C Technologies" },
  { symbol: "ASAN", name: "Asana" }, { symbol: "MNDY", name: "Monday.com" },
  { symbol: "ZI", name: "ZoomInfo" }, { symbol: "TWLO", name: "Twilio" },
  // ── 추가 ETF ──
  { symbol: "MTUM", name: "모멘텀 ETF" }, { symbol: "QUAL", name: "퀄리티 ETF" },
  { symbol: "VLUE", name: "밸류 ETF" }, { symbol: "SIZE", name: "스몰캡 ETF" },
  { symbol: "USMV", name: "최소변동성 ETF" }, { symbol: "ACWI", name: "글로벌 ETF" },
  { symbol: "IEMG", name: "이머징 Core" }, { symbol: "SPDW", name: "선진국 ex-US" },
  { symbol: "GDX", name: "금광 ETF" }, { symbol: "GDXJ", name: "주니어 금광" },
  { symbol: "XME", name: "금속광산 ETF" }, { symbol: "SIL", name: "은광 ETF" },
  { symbol: "PICK", name: "금속광산 iShares" }, { symbol: "MOO", name: "농업 ETF" },
  { symbol: "PAVE", name: "인프라 ETF" }, { symbol: "IYT", name: "운송 ETF" },
  { symbol: "SRVR", name: "데이터센터 ETF" },
  // ── 추가 S&P500 / Mid Cap ──
  { symbol: "ADSK", name: "Autodesk" }, { symbol: "ANSS", name: "ANSYS" }, { symbol: "CPRT", name: "Copart" },
  { symbol: "CSGP", name: "CoStar Group" }, { symbol: "FAST", name: "Fastenal" },
  { symbol: "GEHC", name: "GE Healthcare" }, { symbol: "GEV", name: "GE Vernova" },
  { symbol: "GRMN", name: "Garmin" }, { symbol: "IDXX", name: "Idexx Labs" },
  { symbol: "KDP", name: "Keurig Dr Pepper" }, { symbol: "KHC", name: "Kraft Heinz" },
  { symbol: "KMB", name: "Kimberly-Clark" }, { symbol: "KVUE", name: "Kenvue" },
  { symbol: "MAR", name: "Marriott" }, { symbol: "MDLZ", name: "Mondelez" }, { symbol: "MKTX", name: "MarketAxess" },
  { symbol: "MLM", name: "Martin Marietta" }, { symbol: "ODFL", name: "Old Dominion" },
  { symbol: "OTIS", name: "Otis Worldwide" }, { symbol: "PCAR", name: "PACCAR" }, { symbol: "PTON", name: "Peloton" },
  { symbol: "RCL", name: "Royal Caribbean" }, { symbol: "RMD", name: "ResMed" },
  { symbol: "RVTY", name: "Revvity" }, { symbol: "SBAC", name: "SBA Communications" },
  { symbol: "SYY", name: "Sysco" }, { symbol: "TSCO", name: "Tractor Supply" }, { symbol: "UAL", name: "United Airlines" },
  { symbol: "VMC", name: "Vulcan Materials" }, { symbol: "VRSK", name: "Verisk" },
  { symbol: "VRSN", name: "VeriSign" }, { symbol: "WAB", name: "Westinghouse Air" },
  { symbol: "WYNN", name: "Wynn Resorts" }, { symbol: "XYL", name: "Xylem" },
  { symbol: "ZBH", name: "Zimmer Biomet" }, { symbol: "ZBRA", name: "Zebra Tech" },
  // ── Small Cap 성장주 추가 ──
  { symbol: "AMBA", name: "Ambarella" }, { symbol: "AXON", name: "Axon Enterprise" },
  { symbol: "BURL", name: "Burlington" }, { symbol: "CROX", name: "Crocs" },
  { symbol: "ELF", name: "e.l.f. Beauty" }, { symbol: "EXEL", name: "Exelixis" },
  { symbol: "FIVE", name: "Five Below" }, { symbol: "GDRX", name: "GoodRx" },
  { symbol: "HIMS", name: "Hims & Hers" }, { symbol: "IBKR", name: "Interactive Brokers" },
  { symbol: "IOT", name: "Samsara" }, { symbol: "KTOS", name: "Kratos Defense" },
  { symbol: "LAW", name: "CS Disco" }, { symbol: "LEGN", name: "Legend Biotech" },
  { symbol: "LW", name: "Lamb Weston" }, { symbol: "MARA", name: "Marathon Digital" },
  { symbol: "RIOT", name: "Riot Platforms" }, { symbol: "SEDG", name: "SolarEdge" }, { symbol: "SHAK", name: "Shake Shack" },
  { symbol: "SOUN", name: "SoundHound AI" }, { symbol: "UPST", name: "Upstart" },
  { symbol: "W", name: "Wayfair" }, { symbol: "WING", name: "Wingstop" },
  // ── 국제 ADR 추가 ──
  { symbol: "SAP", name: "SAP" }, { symbol: "SNY", name: "Sanofi" },
  { symbol: "AZN", name: "AstraZeneca" }, { symbol: "GSK", name: "GSK" },
  { symbol: "DEO", name: "Diageo" }, { symbol: "UL", name: "Unilever" },
  { symbol: "SONY", name: "Sony" }, { symbol: "TD", name: "TD Bank" }, { symbol: "RY", name: "Royal Bank Canada" },
  { symbol: "MUFG", name: "Mitsubishi UFJ" }, { symbol: "SMFG", name: "Sumitomo Mitsui" },
];

const KR_ASSETS = [
  // ── 시가총액 Top ──
  { symbol: "005930.KS", name: "삼성전자" }, { symbol: "000660.KS", name: "SK하이닉스" },
  { symbol: "373220.KS", name: "LG에너지솔루션" }, { symbol: "207940.KS", name: "삼성바이오로직스" },
  { symbol: "005380.KS", name: "현대차" }, { symbol: "000270.KS", name: "기아" },
  { symbol: "068270.KS", name: "셀트리온" }, { symbol: "035420.KS", name: "NAVER" },
  { symbol: "035720.KS", name: "카카오" }, { symbol: "051910.KS", name: "LG화학" },
  { symbol: "006400.KS", name: "삼성SDI" },
  // ── 반도체/전자 ──
  { symbol: "066570.KS", name: "LG전자" }, { symbol: "009150.KS", name: "삼성전기" },
  { symbol: "000990.KS", name: "DB하이텍" }, { symbol: "042700.KS", name: "한미반도체" },
  { symbol: "058470.KS", name: "리노공업" },
  // ── 2차전지/소재 ──
  { symbol: "003670.KS", name: "포스코퓨처엠" }, { symbol: "247540.KS", name: "에코프로비엠" },
  { symbol: "006260.KS", name: "LS" }, { symbol: "011170.KS", name: "롯데케미칼" },
  { symbol: "010130.KS", name: "고려아연" },
  // ── 금융 ──
  { symbol: "105560.KS", name: "KB금융" }, { symbol: "055550.KS", name: "신한지주" },
  { symbol: "086790.KS", name: "하나금융지주" }, { symbol: "316140.KS", name: "우리금융지주" },
  { symbol: "000810.KS", name: "삼성화재" }, { symbol: "032830.KS", name: "삼성생명" },
  { symbol: "024110.KS", name: "기업은행" }, { symbol: "138930.KS", name: "BNK금융지주" },
  // ── 자동차/모빌리티 ──
  { symbol: "012330.KS", name: "현대모비스" }, { symbol: "018880.KS", name: "한온시스템" },
  { symbol: "161390.KS", name: "한국타이어" },
  // ── 에너지/정유/화학 ──
  { symbol: "096770.KS", name: "SK이노베이션" }, { symbol: "034730.KS", name: "SK" },
  { symbol: "010950.KS", name: "S-Oil" }, { symbol: "078930.KS", name: "GS" },
  { symbol: "036460.KS", name: "한국가스공사" },
  // ── 통신 ──
  { symbol: "017670.KS", name: "SK텔레콤" }, { symbol: "030200.KS", name: "KT" },
  { symbol: "032640.KS", name: "LG유플러스" },
  // ── 건설/중공업 ──
  { symbol: "028260.KS", name: "삼성물산" }, { symbol: "000720.KS", name: "현대건설" },
  { symbol: "009540.KS", name: "HD한국조선해양" }, { symbol: "329180.KS", name: "HD현대중공업" },
  { symbol: "010620.KS", name: "HD현대미포" },
  // ── 게임/엔터 ──
  { symbol: "259960.KS", name: "크래프톤" }, { symbol: "263750.KS", name: "펄어비스" },
  { symbol: "036570.KS", name: "엔씨소프트" }, { symbol: "251270.KS", name: "넷마블" },
  { symbol: "041510.KS", name: "에스엠" }, { symbol: "352820.KS", name: "하이브" },
  { symbol: "122870.KS", name: "와이지엔터" }, { symbol: "035900.KS", name: "JYP Ent." },
  // ── 유통/소비재 ──
  { symbol: "004170.KS", name: "신세계" }, { symbol: "023530.KS", name: "롯데쇼핑" },
  { symbol: "069960.KS", name: "현대백화점" }, { symbol: "097950.KS", name: "CJ제일제당" },
  { symbol: "003230.KS", name: "삼양식품" }, { symbol: "271560.KS", name: "오리온" },
  // ── 바이오/헬스케어 ──
  { symbol: "128940.KS", name: "한미약품" }, { symbol: "326030.KS", name: "SK바이오팜" },
  { symbol: "302440.KS", name: "SK바이오사이언스" }, { symbol: "145020.KS", name: "휴젤" },
  { symbol: "091990.KS", name: "셀트리온헬스케어" },
  // ── IT서비스 ──
  { symbol: "018260.KS", name: "삼성SDS" }, { symbol: "034220.KS", name: "LG디스플레이" },
  { symbol: "377300.KS", name: "카카오페이" }, { symbol: "323410.KS", name: "카카오뱅크" },
  // ── 코스닥 주요 ──
  { symbol: "086520.KQ", name: "에코프로" }, { symbol: "403870.KQ", name: "HPSP" },
  { symbol: "240810.KQ", name: "원익IPS" }, { symbol: "357780.KQ", name: "솔브레인" },
  { symbol: "196170.KQ", name: "알테오젠" }, { symbol: "140860.KQ", name: "파크시스템스" },
  { symbol: "298380.KQ", name: "에이비엘바이오" }, { symbol: "039030.KQ", name: "이오테크닉스" },
  { symbol: "067160.KQ", name: "아프리카TV" }, { symbol: "005290.KQ", name: "동진쎄미켐" },
  // ── 추가 코스피 대형주 ──
  { symbol: "003550.KS", name: "LG" }, { symbol: "033780.KS", name: "KT&G" },
  { symbol: "015760.KS", name: "한국전력" }, { symbol: "034020.KS", name: "두산에너빌리티" },
  { symbol: "011200.KS", name: "HMM" }, { symbol: "003490.KS", name: "대한항공" },
  { symbol: "180640.KS", name: "한진칼" }, { symbol: "090430.KS", name: "아모레퍼시픽" },
  { symbol: "021240.KS", name: "코웨이" }, { symbol: "016360.KS", name: "삼성증권" },
  { symbol: "006800.KS", name: "미래에셋증권" }, { symbol: "030000.KS", name: "제일기획" },
  { symbol: "047050.KS", name: "포스코인터내셔널" }, { symbol: "000100.KS", name: "유한양행" },
  { symbol: "009830.KS", name: "한화솔루션" }, { symbol: "267250.KS", name: "HD현대" },
  { symbol: "042660.KS", name: "한화오션" }, { symbol: "000880.KS", name: "한화" },
  { symbol: "010140.KS", name: "삼성중공업" }, { symbol: "011790.KS", name: "SKC" },
  // ── 추가 코스닥/코스피 ──
  { symbol: "293490.KS", name: "카카오게임즈" }, { symbol: "241560.KQ", name: "두산퓨얼셀" },
  { symbol: "112040.KQ", name: "위메이드" }, { symbol: "095340.KQ", name: "ISC" },
  { symbol: "000150.KS", name: "두산" }, { symbol: "006360.KS", name: "GS건설" },
  { symbol: "028050.KS", name: "삼성엔지니어링" }, { symbol: "003410.KS", name: "쌍용C&E" },
  { symbol: "004020.KS", name: "현대제철" }, { symbol: "005830.KS", name: "DB손해보험" },
  { symbol: "001040.KS", name: "CJ" }, { symbol: "000120.KS", name: "CJ대한통운" },
  { symbol: "282330.KS", name: "BGF리테일" }, { symbol: "004370.KS", name: "농심" },
  { symbol: "051900.KS", name: "LG생활건강" }, { symbol: "088350.KS", name: "한화생명" },
  { symbol: "003240.KS", name: "태광산업" }, { symbol: "139480.KS", name: "이마트" },
  { symbol: "307950.KS", name: "현대오토에버" }, { symbol: "002790.KS", name: "아모레G" },
  { symbol: "004990.KS", name: "롯데지주" }, { symbol: "036830.KS", name: "솔브레인홀딩스" },
  { symbol: "402340.KS", name: "SK스퀘어" }, { symbol: "361610.KS", name: "SK아이이테크놀로지" },
  { symbol: "003030.KQ", name: "바이오니아" }, { symbol: "263720.KQ", name: "디앤씨미디어" },
  { symbol: "328130.KQ", name: "루닛" }, { symbol: "064550.KQ", name: "바이오니아" },
  { symbol: "078340.KQ", name: "컴투스" }, { symbol: "215600.KQ", name: "신라젠" },
  { symbol: "048410.KQ", name: "현대바이오" }, { symbol: "950210.KQ", name: "프레스티지바이오파마" },
  // ── 제약/바이오 추가 ──
  { symbol: "009290.KS", name: "광동제약" }, { symbol: "131030.KQ", name: "옵투스제약" },
  // ── 추가 코스피 중대형주 ──
  { symbol: "005490.KS", name: "POSCO홀딩스" }, { symbol: "028670.KS", name: "팬오션" },
  { symbol: "003620.KS", name: "쌍용차" }, { symbol: "005940.KS", name: "NH투자증권" }, { symbol: "005440.KS", name: "현대그린푸드" },
  { symbol: "069620.KS", name: "대웅제약" }, { symbol: "001450.KS", name: "현대해상" }, { symbol: "002380.KS", name: "KCC" },
  { symbol: "005387.KS", name: "현대차2우B" }, { symbol: "000240.KS", name: "한국앤컴퍼니" },
  { symbol: "006110.KS", name: "삼아알미늄" }, { symbol: "001740.KS", name: "SK네트웍스" },
  { symbol: "007070.KS", name: "GS리테일" }, { symbol: "003000.KS", name: "부광약품" },
  { symbol: "006650.KS", name: "대한유화" }, { symbol: "008770.KS", name: "호텔신라" },
  { symbol: "003850.KS", name: "보령" }, { symbol: "005180.KS", name: "빙그레" },
  { symbol: "192820.KS", name: "코스맥스" }, { symbol: "002710.KS", name: "TCC스틸" },
  { symbol: "000210.KS", name: "DL" }, { symbol: "069260.KS", name: "TW" },
  { symbol: "001120.KS", name: "LX인터내셔널" }, { symbol: "004800.KS", name: "효성" },
  { symbol: "006280.KS", name: "녹십자" }, { symbol: "138040.KS", name: "메리츠금융지주" },
  { symbol: "030610.KS", name: "교보증권" }, { symbol: "950130.KS", name: "엑셀세미콘" },
  { symbol: "001570.KS", name: "금양" }, { symbol: "000670.KS", name: "영풍" },
  { symbol: "071050.KS", name: "한국금융지주" }, { symbol: "161890.KS", name: "한국콜마" },
  { symbol: "010060.KS", name: "OCI홀딩스" }, { symbol: "036530.KS", name: "SNT모티브" }, { symbol: "383220.KS", name: "F&F" },
  { symbol: "011070.KS", name: "LG이노텍" }, { symbol: "052690.KS", name: "한전기술" },
  { symbol: "005850.KS", name: "에스엘" }, { symbol: "014680.KS", name: "한솔케미칼" },
  { symbol: "088980.KS", name: "맥쿼리인프라" }, { symbol: "003090.KS", name: "대웅" },
  { symbol: "036190.KS", name: "금화PSC" }, { symbol: "001800.KS", name: "오리온홀딩스" },
  { symbol: "011780.KS", name: "금호석유" }, { symbol: "005250.KS", name: "녹십자홀딩스" },
  // ── 추가 코스닥 ──
  { symbol: "293490.KQ", name: "카카오게임즈" }, { symbol: "060310.KQ", name: "3S" },
  { symbol: "035760.KQ", name: "CJ ENM" }, { symbol: "041920.KQ", name: "메디아나" },
  { symbol: "131970.KQ", name: "테스나" }, { symbol: "039440.KQ", name: "STMicroelectronics Korea" },
  { symbol: "214150.KQ", name: "클래시스" }, { symbol: "110990.KQ", name: "디아이티" },
  { symbol: "257720.KQ", name: "실리콘투" }, { symbol: "237880.KQ", name: "클리오" },
  { symbol: "041510.KQ", name: "에스엠" }, { symbol: "060280.KQ", name: "큐렉소" },
  { symbol: "317530.KQ", name: "캐리소프트" }, { symbol: "039200.KQ", name: "오스코텍" },
  { symbol: "950160.KQ", name: "코오롱티슈진" }, { symbol: "041190.KQ", name: "우리기술투자" },
  { symbol: "090460.KQ", name: "비에이치" }, { symbol: "222160.KQ", name: "NPX" },
  { symbol: "200710.KQ", name: "에이디테크놀로지" }, { symbol: "036540.KQ", name: "SFA반도체" },
  { symbol: "058610.KQ", name: "셀진" }, { symbol: "041020.KQ", name: "폴라리스오피스" },
  { symbol: "348210.KQ", name: "넥스틴" }, { symbol: "042000.KQ", name: "카페24" },
  { symbol: "053800.KQ", name: "안랩" }, { symbol: "098120.KQ", name: "마이크로컨텍솔" }, { symbol: "234340.KQ", name: "제이에스코퍼레이션" },
  { symbol: "340570.KQ", name: "티앤엘" }, { symbol: "352480.KQ", name: "씨앤씨인터내셔널" },
  { symbol: "141080.KQ", name: "레고켐바이오" }, { symbol: "115390.KQ", name: "락앤락" },
  { symbol: "039610.KQ", name: "화성밸브" }, { symbol: "389030.KQ", name: "지놈앤컴퍼니" },
  { symbol: "060150.KQ", name: "인사이트코리아" }, { symbol: "058820.KQ", name: "CMG제약" },
  { symbol: "322510.KQ", name: "제이엘케이" }, { symbol: "950220.KQ", name: "보로노이" },
  { symbol: "137950.KQ", name: "제이씨케미칼" }, { symbol: "052770.KQ", name: "아이톡시" },
  { symbol: "086900.KQ", name: "메디톡스" }, { symbol: "330350.KQ", name: "위세아이텍" },
  // ── 추가 코스피 산업재/소재 ──
  { symbol: "010120.KS", name: "LS일렉트릭" }, { symbol: "267260.KS", name: "HD현대일렉트릭" },
  { symbol: "298040.KS", name: "효성중공업" }, { symbol: "012450.KS", name: "한화에어로스페이스" },
  { symbol: "064350.KS", name: "현대로템" }, { symbol: "241560.KS", name: "두산퓨얼셀" },
  { symbol: "006890.KS", name: "태경케미칼" }, { symbol: "005070.KS", name: "코스모신소재" },
  { symbol: "018500.KS", name: "동원F&B" }, { symbol: "014820.KS", name: "동원시스템즈" },
  { symbol: "241590.KS", name: "화승엔터프라이즈" }, { symbol: "009420.KS", name: "한올바이오파마" },
  { symbol: "272210.KS", name: "한화시스템" }, { symbol: "003570.KS", name: "SNT다이내믹스" },
  { symbol: "000080.KS", name: "하이트진로" }, { symbol: "005300.KS", name: "롯데칠성" },
  { symbol: "004150.KS", name: "한솔제지" }, { symbol: "026960.KS", name: "동서" },
  { symbol: "044820.KS", name: "코스맥스비티아이" }, { symbol: "000500.KS", name: "가온전선" },
  { symbol: "007310.KS", name: "오뚜기" }, { symbol: "002840.KS", name: "미원상사" },
  { symbol: "004490.KS", name: "세방전지" }, { symbol: "009240.KS", name: "한샘" },
  { symbol: "017800.KS", name: "현대엘리베이터" }, { symbol: "092200.KS", name: "디아이씨" },
  { symbol: "002030.KS", name: "아세아" }, { symbol: "047810.KS", name: "한국항공우주" }, { symbol: "079550.KS", name: "LIG넥스원" },
  { symbol: "012800.KS", name: "대창" }, { symbol: "900140.KS", name: "엘브이엠씨홀딩스" },
  // ── 추가 코스피/코스닥 중소형 ──
  { symbol: "006120.KS", name: "SK디스커버리" }, { symbol: "017810.KS", name: "풀무원" },
  { symbol: "003960.KS", name: "사조대림" }, { symbol: "145990.KS", name: "삼양사" },
  { symbol: "002960.KS", name: "한국쉘석유" }, { symbol: "006060.KS", name: "화승인더" },
  { symbol: "014830.KS", name: "유니드" }, { symbol: "006380.KS", name: "동부건설" },
  { symbol: "016380.KS", name: "KG동부제철" }, { symbol: "000060.KS", name: "메리츠화재" },
  { symbol: "029780.KS", name: "삼성카드" }, { symbol: "003540.KS", name: "대신증권" },
  { symbol: "030790.KS", name: "비케이이" }, { symbol: "039490.KS", name: "키움증권" },
  { symbol: "006090.KS", name: "사조오양" }, { symbol: "004000.KS", name: "롯데정밀화학" },
  { symbol: "020150.KS", name: "일진머티리얼즈" }, { symbol: "003350.KS", name: "한국기업평가" },
  { symbol: "023000.KS", name: "삼원강재" }, { symbol: "214370.KS", name: "케어젠" },
  { symbol: "185750.KS", name: "종근당" }, { symbol: "000640.KS", name: "동아쏘시오홀딩스" },
  { symbol: "100220.KS", name: "비상교육" }, { symbol: "000050.KS", name: "경방" },
  { symbol: "002020.KS", name: "코오롱" }, { symbol: "001680.KS", name: "대상" },
  { symbol: "007700.KS", name: "F&F홀딩스" },
  // ── 추가 코스닥 성장주 ──
  { symbol: "226330.KQ", name: "신테카바이오" }, { symbol: "278280.KQ", name: "천보" },
  { symbol: "067310.KQ", name: "하나마이크론" }, { symbol: "336570.KQ", name: "원텍" },
  { symbol: "091990.KQ", name: "셀트리온헬스케어" }, { symbol: "145020.KQ", name: "휴젤" },
  { symbol: "238090.KQ", name: "앤디포스" }, { symbol: "046890.KQ", name: "서울반도체" },
  { symbol: "048260.KQ", name: "오스템임플란트" }, { symbol: "290650.KQ", name: "엘앤씨바이오" },
  { symbol: "108320.KQ", name: "LX세미콘" }, { symbol: "078600.KQ", name: "대주전자재료" },
  { symbol: "357550.KQ", name: "석경에이티" }, { symbol: "089860.KQ", name: "루트로닉" },
  { symbol: "217190.KQ", name: "제너셈" }, { symbol: "060370.KQ", name: "LS마린솔루션" },
  { symbol: "383310.KQ", name: "에코프로에이치엔" }, { symbol: "336260.KQ", name: "두산퓨얼셀" },
  { symbol: "377190.KQ", name: "디엘이앤씨" }, { symbol: "025320.KQ", name: "시노펙스" },
];

const CRYPTO_ASSETS = [
  // ── 시총 상위 10개 ──
  { id: "bitcoin", symbol: "BTC", name: "Bitcoin" },
  { id: "ethereum", symbol: "ETH", name: "Ethereum" },
  { id: "binancecoin", symbol: "BNB", name: "BNB" },
  { id: "solana", symbol: "SOL", name: "Solana" },
  { id: "ripple", symbol: "XRP", name: "XRP" },
  { id: "cardano", symbol: "ADA", name: "Cardano" },
  { id: "dogecoin", symbol: "DOGE", name: "Dogecoin" },
  { id: "tron", symbol: "TRX", name: "TRON" },
  { id: "avalanche-2", symbol: "AVAX", name: "Avalanche" },
  { id: "toncoin", symbol: "TON", name: "Toncoin" },
  // ── 시그널 유니버스(바이낸스 선물 유동성 상위) 커버 확장 (2026-08) ──
  // 종목 상세 시트의 한글 종목명·관심 별·추이 차트가 이 마스터의 coingecko id 에
  // 의존합니다. id 가 확실히 검증된 코인만 등록 — 불확실한 신생 코인은 넣지 않습니다
  // (잘못된 id 는 다른 자산의 차트를 그리는 사고로 이어집니다).
  { id: "zcash", symbol: "ZEC", name: "Zcash" },
  { id: "monero", symbol: "XMR", name: "Monero" },
  { id: "near", symbol: "NEAR", name: "NEAR Protocol" },
  { id: "chainlink", symbol: "LINK", name: "Chainlink" },
  { id: "uniswap", symbol: "UNI", name: "Uniswap" },
  { id: "sui", symbol: "SUI", name: "Sui" },
  { id: "bittensor", symbol: "TAO", name: "Bittensor" },
  { id: "aave", symbol: "AAVE", name: "Aave" },
  { id: "ethena", symbol: "ENA", name: "Ethena" },
  { id: "worldcoin-wld", symbol: "WLD", name: "Worldcoin" },
  { id: "hyperliquid", symbol: "HYPE", name: "Hyperliquid" },
  { id: "iotex", symbol: "IOTX", name: "IoTeX" },
  { id: "biconomy", symbol: "BICO", name: "Biconomy" },
];

// 미국 주식 한글명 매핑 (한글 검색 지원)
const US_KO_NAMES = {
  AAPL: "애플", MSFT: "마이크로소프트", NVDA: "엔비디아", TSLA: "테슬라", AMZN: "아마존",
  GOOG: "구글", GOOGL: "구글", META: "메타", AMD: "에이엠디", AVGO: "브로드컴",
  NFLX: "넷플릭스", CRM: "세일즈포스", ORCL: "오라클", CSCO: "시스코",
  INTC: "인텔", QCOM: "퀄컴", MU: "마이크론", MRVL: "마벨",
  LRCX: "램리서치", AMAT: "어플라이드", KLAC: "케이엘에이", SNPS: "시놉시스", CDNS: "케이던스",
  JPM: "제이피모건", GS: "골드만삭스", BAC: "뱅크오브아메리카", WFC: "웰스파고",
  MS: "모건스탠리", C: "씨티그룹", BLK: "블랙록", V: "비자", MA: "마스터카드",
  UNH: "유나이티드헬스", JNJ: "존슨앤존슨", LLY: "일라이릴리", ABBV: "애브비",
  PFE: "화이자", MRK: "머크", TMO: "써모피셔", AMGN: "암젠", GILD: "길리어드",
  ISRG: "인튜이티브서지컬", VRTX: "버텍스", REGN: "리제네론", MRNA: "모더나",
  BA: "보잉", CAT: "캐터필러", GE: "지이에어로", RTX: "레이시온", LMT: "록히드마틴",
  XOM: "엑슨모빌", CVX: "셰브론", COP: "코노코필립스",
  WMT: "월마트", COST: "코스트코", HD: "홈디포", MCD: "맥도날드",
  DIS: "디즈니", SBUX: "스타벅스", NKE: "나이키", KO: "코카콜라", PEP: "펩시",
  PG: "피앤지", PYPL: "페이팔", SQ: "블록스퀘어", SHOP: "쇼피파이",
  COIN: "코인베이스", MSTR: "마이크로스트래티지", UBER: "우버", ABNB: "에어비앤비",
  DASH: "도어대시", SNOW: "스노우플레이크", DDOG: "데이터독", NET: "클라우드플레어",
  CRWD: "크라우드스트라이크", PANW: "팔로알토", ZS: "지스케일러", NOW: "서비스나우",
  BABA: "알리바바", JD: "제이디닷컴", PDD: "테무핀둬둬", BIDU: "바이두",
  NIO: "니오", LI: "리오토", XPEV: "샤오펑", RIVN: "리비안", LCID: "루시드",
  ENPH: "엔페이즈", FSLR: "퍼스트솔라",
  SPY: "에스앤피500", QQQ: "나스닥100", IWM: "러셀2000",
  GLD: "금ETF", SLV: "은ETF", TLT: "미국채ETF",
  ARKK: "아크혁신", SOXX: "반도체ETF", SMH: "반도체밴에크",
  TQQQ: "나스닥3배", SQQQ: "나스닥인버스3배", SOXL: "반도체3배", SOXS: "반도체인버스3배",
};
// 크립토 한글명 (키 = coingecko id — CRYPTO_ASSETS 와 반드시 동기 유지)
const CRYPTO_KO_NAMES = {
  "bitcoin": "비트코인", "ethereum": "이더리움", "solana": "솔라나",
  "binancecoin": "바이낸스코인", "ripple": "리플", "cardano": "카르다노",
  "dogecoin": "도지코인", "tron": "트론", "avalanche-2": "아발란체",
  "toncoin": "톤코인",
  "zcash": "지캐시", "monero": "모네로", "near": "니어프로토콜",
  "chainlink": "체인링크", "uniswap": "유니스왑", "sui": "수이",
  "bittensor": "비트텐서", "aave": "에이브", "ethena": "에테나",
  "worldcoin-wld": "월드코인", "hyperliquid": "하이퍼리퀴드",
  "iotex": "아이오텍스", "biconomy": "비코노미",
};

// ════════════════════════════════════════════════════════════════════
// ★ 2026-08 모바일 시안 — 종목 상세 시트 데이터 빌더
// ────────────────────────────────────────────────────────────────────
// coin-scores 엔트리(멀티TF 스코어 + sr 매물대)를 AssetDetailSheet 의 props 계약으로
// 옮깁니다. 없는 값은 undefined 로 두면 시트가 해당 섹션을 통째로 숨깁니다 —
// 빈 칸이나 지어낸 수치가 화면에 남지 않게 하는 규칙입니다.
// ════════════════════════════════════════════════════════════════════

/** 매물대·시세 표기 — 코인은 BTC(6자리)~PEPE(소수 6자리)라 고정 자릿수를 못 씁니다. */
function fmtLevelPrice(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (n >= 1) return n.toFixed(2);
  if (n >= 0.01) return n.toFixed(4);
  return n.toFixed(6);
}

/** 주식 시세 표기 — KRX 는 원화 정수 관례, 미국 주식은 달러 소수 2자리 관례를 따릅니다. */
function fmtStockPrice(v, market) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (market === "kr") return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// KRX 6자리 코드 → 종목명 (홈 시그널 카드·상세 시트 공용).
// 코드만으론 어떤 종목인지 읽히지 않아, 자산 마스터에 있는 종목은 종목명으로 표기합니다.
const KR_NAME_BY_CODE = Object.fromEntries(
  KR_ASSETS.map((a) => [a.symbol.replace(/\.(KS|KQ)$/, ""), a.name])
);

// ★ 홈 시그널 주식 축 킬스위치 (2026-08 신설, 기본 켜짐) — 빌드 시
//   VITE_ZEPTA_STOCK_SIGNALS=0 으로 끄면 주식 탭·폴링이 모두 사라지고 기존 코인
//   화면 그대로 동작합니다. 서버 쪽은 /api/stock-scores 엔드포인트의 ZEPTA_* 게이트가 담당.
const STOCK_SIGNALS_ON = (import.meta.env.VITE_ZEPTA_STOCK_SIGNALS ?? "1") !== "0";
// ★ 코인 상세 시트 온체인 카드 킬스위치 (기본 켜짐, VITE_ZEPTA_ONCHAIN_UI=0 으로 끔).
const ONCHAIN_UI_ON = (import.meta.env.VITE_ZEPTA_ONCHAIN_UI ?? "1") !== "0";

const DETAIL_TF = [["1w", "1주"], ["1d", "1일"], ["4h", "4시간"], ["1h", "1시간"]];

/** coin-scores 산출 시각(ts, epoch ms) → "N분 전 집계" 실측 문구.
 *  ts 가 없거나 비정상이면 null — 신선도를 지어내지 않고 표기를 생략합니다.
 *  staleMin(기본 30분 = 코인 생성 주기 10분의 3배) 이상 밀리면 "갱신 지연"을
 *  덧붙여 정직하게 알립니다. ⚠️ 주식 풀은 크론 주기가 다릅니다(vercel.json —
 *  미국 30분·한국 60분): 30분 기준을 그대로 쓰면 KRX 정상 운영의 절반가량이
 *  상시 "갱신 지연"으로 표기되므로, 주식 경로는 staleMin=90(한국 주기의 1.5배)을
 *  넘겨 정시 운영을 지연으로 단정하지 않습니다.
 *  두 번째 인자로 i18n t() 를 넘기면 로케일 문구(tabs.home.aggregated*)로 표기합니다 —
 *  영어 화면에서 한국어 고정 문구가 섞이던 문제 방지. t 를 생략하면 기존 한국어
 *  문구 그대로라 아직 i18n 미적용 화면(상세 시트 asOfLabel)은 동작이 변하지 않습니다. */
function coinScoreFreshness(ts, t, staleMin = 30) {
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return null;
  const min = Math.max(0, Math.round((Date.now() - n) / 60000));
  const base = t
    ? (min < 1 ? t("tabs.home.aggregatedJustNow")
      : min < 60 ? t("tabs.home.aggregatedMinAgo", { n: min })
      : t("tabs.home.aggregatedHourAgo", { n: Math.floor(min / 60) }))
    : (min < 1 ? "방금 집계" : min < 60 ? `${min}분 전 집계` : `${Math.floor(min / 60)}시간 전 집계`);
  const stale = t ? t("tabs.home.staleSuffix") : "갱신 지연";
  return min >= staleMin ? `${base} · ${stale}` : base;
}

/** 풀 종류별 "갱신 지연" 임계(분) — 코인 30분(10분 주기×3), 주식 90분(한국 60분 주기×1.5). */
const STALE_MIN_STOCK = 90;

/** 정규장 세션 상태 (★ 2026-08-12 IA v3 시안 1b 장 상태 배지).
 *  현재 시각을 해당 시장 타임존으로 환산해(Intl — 미국 서머타임 자동 반영) 요일·시각만으로
 *  장전/장중/장후를 판정합니다. 시계 기반의 결정적 산출이라 외부 fetch 가 없습니다.
 *  ⚠️ 공휴일(휴장일) 캘린더는 배선이 없어 반영하지 못합니다 — 화면 캡션에
 *  "정규장 시각 기준"을 병기해 공휴일 오표기를 단정으로 만들지 않습니다.
 *  Intl 타임존 미지원 등 산출 실패 시 null — 배지 자체를 생략합니다(지어내지 않음). */
function marketSessionOf(tz, openMin, closeMin, now = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(now);
    const get = (type) => parts.find((p) => p.type === type)?.value;
    const wd = get("weekday");
    if (wd === "Sat" || wd === "Sun") return { phase: "weekend" };
    // hour12:false 라도 일부 엔진은 자정을 "24"로 내보냅니다 — %24 로 정규화.
    const mins = (Number(get("hour")) % 24) * 60 + Number(get("minute"));
    if (!Number.isFinite(mins)) return null;
    if (mins < openMin) return { phase: "pre", minsToOpen: openMin - mins };
    if (mins < closeMin) return { phase: "open", minsToClose: closeMin - mins };
    // 장 마감 후 다음 개장까지는 날짜 경계(익영업일)를 넘어 카운트다운을 지어내지 않습니다.
    return { phase: "closed" };
  } catch { return null; }
}

/** 상세 시트 기간 탭 → CoinGecko OHLC days 매핑 (탭마다 실제 다른 데이터를 불러옵니다). */
const DETAIL_RANGE_DAYS = { "1D": "1", "1W": "7", "1M": "30", "1Y": "365" };

/** 상세 시트 기간 탭 → 야후(/api/yahoo-batch) interval/range 매핑 (주식 전용).
 *  ⚠️ 네 조합 모두 2026-08-11 라이브 curl 로 실제 응답을 확인했습니다
 *  (5m/1d·30m/5d 는 미국·KRX 둘 다 동작). 야후가 거부하는 조합을 넣지 마세요. */
const DETAIL_STOCK_RANGE = {
  "1D": ["5m", "1d"], "1W": ["30m", "5d"], "1M": ["1d", "1mo"], "1Y": ["1d", "1y"],
};

// ★ 감사 배치3 (i18n): 두 번째 인자 t 를 받아 asOfLabel(집계 신선도 포함)을 로케일에
//   맞춥니다 — EN 화면에서 상세 시트 기준시각 문구가 한국어로 남던 문제. t 를 생략하면
//   기존 한국어 폴백 그대로 동작합니다(시트의 나머지 문구는 별도 i18n 과제).
function buildAssetDetailProps(sig, t) {
  if (!sig) return null;
  // ★ 2026-08 주식 확장: stock-scores 엔트리는 market("us"|"kr") 필드로 구분합니다.
  //   market 이 없거나 다른 값이면 기존 코인 경로 그대로 동작합니다(회귀 없음).
  const market = sig.market === "us" || sig.market === "kr" ? sig.market : "crypto";
  const isStock = market !== "crypto";
  const ticker = isStock
    ? String(sig.symbol || "").replace(/\.(KS|KQ)$/i, "").toUpperCase()
    : String(sig.asset || sig.symbol || "").replace(/USDT$/i, "").toUpperCase();
  const dir = sig.side === "LONG" ? "up" : sig.side === "SHORT" ? "down" : "neutral";
  // 가격 표기: 코인은 기존 규칙(6자리 소수까지), 주식은 시장 관례(₩ 정수 / $ 소수 2자리).
  const fmtPx = isStock ? (v) => fmtStockPrice(v, market) : fmtLevelPrice;

  // ── 지지·저항: sr.s / sr.r 은 "가까운 순". 시안은 위(R2)→아래(S2) 순서입니다. ──
  const sr = sig.sr || null;
  const sArr = Array.isArray(sr?.s) ? sr.s : [];
  const rArr = Array.isArray(sr?.r) ? sr.r : [];
  const mkLevel = (x, tag) => ({
    tag, price: fmtPx(x?.p),
    distancePct: Number(x?.d), touches: Number(x?.t),
  });
  const levelItems = [
    ...rArr.slice().reverse().map((x, i) => mkLevel(x, `R${rArr.length - i}`)),
    ...sArr.map((x, i) => mkLevel(x, `S${i + 1}`)),
  ].filter((x) => x.price);

  // ── 매물대 POC — 서버가 이미 계산해 내려주는 거래량 프로파일(sr.vp)을 함께 표기합니다.
  //    (VAH/VAL 은 시트의 지지/저항 색 규칙과 의미가 어긋나 POC 만 — 최다 거래 가격대)
  const pocPrice = fmtPx(sr?.vp?.poc);
  if (pocPrice) {
    const pocN = Number(sr.vp.poc);
    const pxN = Number(sr?.px);
    levelItems.push({
      tag: "POC", price: pocPrice,
      distancePct: (Number.isFinite(pocN) && Number.isFinite(pxN) && pxN > 0)
        ? ((pocN - pxN) / pxN) * 100
        : NaN,
      touches: NaN, // 터치 횟수 개념이 없는 지표 — 시트가 칸을 숨깁니다
    });
  }

  // 현재가가 가장 먼 지지(0%)~가장 먼 저항(100%) 사이 어디인지 — 양쪽이 다 있어야 계산합니다.
  const px = Number(sr?.px);
  const lo = sArr.length ? Number(sArr[sArr.length - 1].p) : NaN;
  const hi = rArr.length ? Number(rArr[rArr.length - 1].p) : NaN;
  const positionPct = (Number.isFinite(px) && Number.isFinite(lo) && Number.isFinite(hi) && hi > lo)
    ? ((px - lo) / (hi - lo)) * 100
    : undefined;

  // ── 타임프레임 정렬 + 근거 ──
  const bd = sig.breakdown || {};
  // 주식 breakdown 은 4h 등 일부 구간이 없을 수 있어 "응답에 있는 키만" 칩·지표로
  // 만듭니다(없는 구간의 빈 칩을 그리지 않음). 코인은 기존 4구간 고정 그대로입니다.
  const tfDefs = isStock ? DETAIL_TF.filter(([k]) => bd[k] != null) : DETAIL_TF;
  const timeframes = tfDefs.map(([k, label]) => ({
    label,
    dir: bd[k]?.side === "LONG" ? "up" : bd[k]?.side === "SHORT" ? "down" : null,
  }));
  // ⚠️ 엔진의 entryRefine.reasons 는 `mtfRsiOverbought: 1h RSI 78.2 ...` 같은 내부 진단
  //    문자열이라 사용자 화면에 그대로 노출하지 않습니다. 대신 같은 데이터에서 파생한
  //    한국어 사실 서술 두 줄을 만듭니다(행동 지시 워딩 없음).
  const reasons = [];
  const rated = timeframes.filter((t) => t.dir);
  if (rated.length) {
    const aligned = timeframes.filter((t) => t.dir === dir).length;
    const dirWord = dir === "up"
      ? (t ? t("diag.dirUp") : "상승")
      : (t ? t("diag.dirDown") : "하락");
    reasons.push(isStock
      // 주식은 구간 수가 응답에 따라 다르므로 실제 구간 이름을 그대로 나열합니다.
      ? (t ? t("diag.mtfAlignedTf", { tfList: tfDefs.map(([, l]) => l).join("·"), total: tfDefs.length, aligned, dir: dirWord })
           : `${tfDefs.map(([, l]) => l).join("·")} ${tfDefs.length}개 구간 중 ${aligned}개가 ${dirWord} 방향입니다.`)
      : (t ? t("diag.mtfAlignedDefault", { aligned, dir: dirWord })
           : `주·일·4시간·1시간 네 구간 중 ${aligned}개가 ${dirWord} 방향입니다.`));
  }
  const distParts = [];
  if (rArr[0] && Number.isFinite(Number(rArr[0].d))) distParts.push(t ? t("diag.toResistance", { pct: Math.abs(Number(rArr[0].d)).toFixed(1) }) : `가장 가까운 저항까지 +${Math.abs(Number(rArr[0].d)).toFixed(1)}%`);
  if (sArr[0] && Number.isFinite(Number(sArr[0].d))) distParts.push(t ? t("diag.toSupport", { pct: Math.abs(Number(sArr[0].d)).toFixed(1) }) : `지지까지 −${Math.abs(Number(sArr[0].d)).toFixed(1)}%`);
  if (distParts.length) reasons.push(t ? t("diag.remaining", { parts: distParts.join(", ") }) : `${distParts.join(", ")} 남아 있습니다.`);

  // ── 보조지표 2×2 = 타임프레임별 점수 (칩은 방향만, 여기는 점수까지) ──
  const indicators = tfDefs.map(([k, label]) => {
    const x = bd[k];
    const sc = Number(x?.score);
    if (!x || !Number.isFinite(sc)) return null;
    return {
      label: t ? t("diag.tfBand", { label }) : `${label} 구간`, value: Math.round(sc),
      // 주식은 현물이라 롱/숏 대신 상승/하락 우위로 서술합니다(파생 워딩 회피).
      note: x.side === "LONG" ? (isStock ? (t ? t("tabs.home.upDominant") : "상승 우위") : (t ? t("tabs.home.longDominant") : "롱 우위"))
        : x.side === "SHORT" ? (isStock ? (t ? t("tabs.home.downDominant") : "하락 우위") : (t ? t("tabs.home.shortDominant") : "숏 우위"))
        : (t ? t("tabs.home.neutral") : "중립"),
      dir: x.side === "LONG" ? "up" : x.side === "SHORT" ? "down" : "neutral",
    };
  }).filter(Boolean);

  // ── 온체인 보조 카드 (코인 전용 · coin-scores 의 additive oc 필드) ──
  //    값이 실려 온 항목만 카드를 만듭니다 — oc 자체가 없거나 값이 비면 카드도 없습니다
  //    (지어내지 않음). ⚠️ ocShadow(내부 평가용)는 어떤 경로로도 화면에 올리지 않습니다.
  if (ONCHAIN_UI_ON && !isStock && sig.oc && typeof sig.oc === "object") {
    const pickNum = (...vals) => {
      for (const v of vals) { const n = Number(v); if (Number.isFinite(n)) return n; }
      return null;
    };
    // 미결제약정 24h 변화율(%) — 실제 계약 필드 oiChg24h(btc-cron _oc) 1순위,
    // 나머지는 과거 표기 변형 방어용 폴백입니다.
    const oiPct = pickNum(sig.oc.oiChg24h, sig.oc.oiChg24hPct, sig.oc.oi24hPct, sig.oc.oi24h);
    if (oiPct != null) {
      indicators.push({
        label: t ? t("tabs.home.ocOiLabel") : "미결제약정 24h",
        value: `${oiPct >= 0 ? "+" : ""}${oiPct.toFixed(1)}%`,
        // 증감 색은 값 변화 방향 표기 관례(+초록/−빨강) — 방향성 해석은 덧붙이지 않습니다.
        dir: oiPct > 0 ? "up" : oiPct < 0 ? "down" : "neutral",
      });
    }
    // 롱숏 비율 — 1 초과면 롱 계정 우위, 미만이면 숏 계정 우위(사실 서술).
    // ⚠️ 실제 백엔드 계약 필드는 lsRatio (api/_shared/onchain.js fetchSymbolDeriv →
    //    btc-cron _oc 적재) — 반드시 1순위. 나머지는 과거 표기 변형 방어용 폴백입니다.
    const lsr = pickNum(sig.oc.lsRatio, sig.oc.lsr, sig.oc.longShortRatio, sig.oc.ls);
    if (lsr != null && lsr > 0) {
      indicators.push({
        label: t ? t("tabs.home.ocLsrLabel") : "롱숏 비율",
        value: lsr.toFixed(2),
        note: lsr > 1 ? (t ? t("tabs.home.longDominant") : "롱 우위")
          : lsr < 1 ? (t ? t("tabs.home.shortDominant") : "숏 우위")
          : (t ? t("tabs.home.neutral") : "중립"),
        dir: lsr > 1 ? "up" : lsr < 1 ? "down" : "neutral",
      });
    }
  }

  const priceStr = fmtPx(sr?.px);
  // known: 관심종목 토글이 가능한 자산 마스터 엔트리 — 코인은 CRYPTO_ASSETS,
  // 주식은 US/KR 마스터에 있는 종목만(마스터 밖 종목은 별 버튼 숨김 — 코인과 동일 원칙).
  const known = isStock
    ? (() => {
        const m = market === "us"
          ? US_ASSETS.find((a) => a.symbol === ticker)
          : KR_ASSETS.find((a) => a.symbol.replace(/\.(KS|KQ)$/, "") === ticker);
        return m ? { symbol: ticker, name: m.name, symbolRaw: m.symbol } : undefined;
      })()
    : CRYPTO_ASSETS.find((a) => a.symbol === ticker);
  const score = Number(sig.score);
  const dispName = isStock
    ? ((market === "us" ? US_KO_NAMES[ticker] : undefined) || known?.name
        || (typeof sig.name === "string" && sig.name ? sig.name : undefined))
    : known ? (CRYPTO_KO_NAMES[known.id] || known.name) : undefined;

  return {
    ticker,
    known,
    market,
    props: {
      symbol: ticker,
      name: dispName,
      meta: isStock
        ? (market === "us"
          ? (t ? t("tabs.home.stockMetaUs") : "나스닥·NYSE · 기술적 지표 종합")
          : (t ? t("tabs.home.stockMetaKr") : "KRX · 기술적 지표 종합"))
        : (t ? t("diag.binancePerp") : "바이낸스 선물 · 무기한"),
      price: priceStr ? `${market === "kr" ? "₩" : "$"}${priceStr}` : undefined,
      // ⚠️ coin-scores 에 등락률 필드가 없어 등락 알약은 넣지 않습니다(0% 를 지어내지 않음).
      // 갱신 표기는 엔진 산출 시각(ts) 실측 — "10분 주기 갱신" 고정 문구는 크론이 멈춰도
      // 신선한 척 보여 제거했습니다. ts 가 없으면 경과 표기 자체를 생략합니다.
      // 주식은 스코어 산출 기반(일봉/장중 혼합)을 단정할 수 없어 집계 신선도만 표기합니다.
      // 지연 임계는 주식 크론 주기(미국 30분·한국 60분)에 맞춘 90분 — 정시 운영을
      // "갱신 지연"으로 단정하지 않기 위함입니다.
      asOfLabel: isStock
        ? (coinScoreFreshness(sig.ts, t, STALE_MIN_STOCK) || undefined)
        : (priceStr
          ? [t ? t("tabs.home.asOfDailyClose") : "최근 일봉 종가 기준", coinScoreFreshness(sig.ts, t)].filter(Boolean).join(" · ")
          : undefined),
      signal: Number.isFinite(score) ? {
        dir,
        // 주식은 상승/하락 우위, 코인은 롱/숏 우위 — 홈 카드와 같은 워딩 규칙입니다.
        sideLabel: isStock
          ? (dir === "up" ? (t ? t("tabs.home.upDominant") : "상승 우위")
            : dir === "down" ? (t ? t("tabs.home.downDominant") : "하락 우위")
            : (t ? t("tabs.home.neutral") : "중립"))
          : (dir === "up" ? (t ? t("tabs.home.longDominant") : "롱 우위")
            : dir === "down" ? (t ? t("tabs.home.shortDominant") : "숏 우위")
            : (t ? t("tabs.home.neutral") : "중립")),
        score: Math.round(Math.max(0, Math.min(100, score))),
        timeframes: rated.length ? timeframes : [],
        reasons,
      } : undefined,
      levels: levelItems.length ? { positionPct, items: levelItems } : undefined,
      indicators,
    },
  };
}

// 전체 자산 통합 (검색용 — 한글명 포함)
const ALL_ASSETS = [
  ...US_ASSETS.map(a => {
    const ko = US_KO_NAMES[a.symbol] || "";
    return { ...a, market: "us", symbolRaw: a.symbol, koName: ko,
      searchKey: `${a.symbol} ${a.name} ${ko}`.toLowerCase() };
  }),
  ...KR_ASSETS.map(a => {
    const sym = a.symbol.replace(".KS", "").replace(".KQ", "");
    return { ...a, market: "kr", symbolRaw: a.symbol, symbol: sym,
      searchKey: `${sym} ${a.symbol} ${a.name}`.toLowerCase() };
  }),
  ...CRYPTO_ASSETS.map(a => {
    const ko = CRYPTO_KO_NAMES[a.id] || "";
    return { ...a, market: "crypto", symbolRaw: a.id, koName: ko,
      searchKey: `${a.symbol} ${a.name} ${a.id} ${ko}`.toLowerCase() };
  }),
];

// ★ 2026-08-02 (주식+코인 양축 확장, 대표 지시): 시장 필터 매칭 (SSOT)
//   기존 값(all/us/kr/crypto)에 "stock"(미국+한국 주식 묶음)을 추가했습니다.
//   GNB '주식 분석'·지표 허브의 주식 진입점이 이 값으로 스크리너에 딥링크합니다.
const MARKET_FILTERS = ["all", "stock", "us", "kr", "crypto"];
const matchMarketFilter = (asset, filter) => {
  if (filter === "all" || !filter) return true;
  if (filter === "stock") return asset?.market === "us" || asset?.market === "kr";
  return asset?.market === filter;
};
// 시장 → 표시용 배지 라벨 (홈 인기 종목 등 공용) — 국기/심볼 + 로케일 시장명
const MARKET_BADGE_ICON = { us: "🇺🇸", kr: "🇰🇷", crypto: "₿" };
function marketBadgeLabel(mkt, t) {
  const k = MARKET_BADGE_ICON[mkt] ? mkt : "us";
  return `${MARKET_BADGE_ICON[k]} ${t ? t(`diag.market.${k}`) : { us: "미국", kr: "한국", crypto: "코인" }[k]}`;
}

// 고위험 종목 (레버리지/인버스 ETF, 페니스톡 등)
const RISKY_SYMBOLS = new Set([
  // 레버리지/인버스 ETF
  "TQQQ","SQQQ","UPRO","SPXS","SOXL","SOXS","TECL","TECS","FAS","FAZ",
  "LABU","LABD","TNA","TZA","SPXU","UDOW","SDOW","WEBL","WEBS","FNGU","FNGD",
  "NAIL","TMF","TMV","NUGT","DUST","JNUG","JDST","BOIL","KOLD","UCO","SCO",
  "UVXY","SVXY","VXX","VIXY","BITX","SBIT",
  // SPACs & 고위험 소형주
  "SMRT","LAW","PLUG","LCID","RIVN","NVCR","WOLF",
]);


function analyzeAsset(weeklyCloses, dailyCloses, weeklyVolumes, weeklyHighs, weeklyLows, conditions) {
  const price = weeklyCloses[weeklyCloses.length - 1];
  const rsi = calcRSI(weeklyCloses, 14);
  const ma20daily = calcSMA(dailyCloses, 20);
  const ma50daily  = calcSMA(dailyCloses, 50);
  const ma200daily = calcSMA(dailyCloses, 200);
  const bb   = calcBB(weeklyCloses);
  const macd = calcMACD(weeklyCloses);
  const stoch = calcStochastic(weeklyHighs, weeklyLows, weeklyCloses);
  const wr    = calcWilliamsR(weeklyHighs, weeklyLows, weeklyCloses);
  const atr   = calcATR(weeklyHighs, weeklyLows, weeklyCloses);
  const adxResult = calcSimpleADX(weeklyHighs, weeklyLows, weeklyCloses);

  const avgVol  = weeklyVolumes.slice(-20).reduce((a, b) => a + b, 0) / Math.min(weeklyVolumes.length, 20);
  const curVol  = weeklyVolumes[weeklyVolumes.length - 1] || 0;
  const volRatio = avgVol > 0 ? curVol / avgVol : 0;
  const ma200Dist = ma200daily ? ((price - ma200daily) / ma200daily) * 100 : null;

  const prev = weeklyCloses.length >= 2 ? weeklyCloses[weeklyCloses.length - 2] : price;
  const weekChange = ((price - prev) / prev) * 100;

  // ── 다중 타임프레임 RSI: 일간 RSI(14) 추가 ──
  const dailyRsi = dailyCloses.length >= 15 ? calcRSI(dailyCloses, 14) : null;

  // BB 스퀴즈 (Keltner Channel 기반 고도화)
  // BB가 Keltner Channel 안에 들어오면 진정한 스퀴즈
  let bbSqueeze = false;
  if (weeklyCloses.length >= 20 && weeklyHighs.length >= 20) {
    const n = weeklyCloses.length;
    const bbPeriod = 20, bbMult = 2, kcEmaPeriod = 20, kcAtrPeriod = 10, kcAtrMult = 1.5;
    // BB 계산
    const bbSlice = weeklyCloses.slice(n - bbPeriod);
    const bbMean = bbSlice.reduce((a, b) => a + b, 0) / bbPeriod;
    const bbStd = Math.sqrt(bbSlice.reduce((a, b) => a + (b - bbMean) ** 2, 0) / bbPeriod);
    const bbUpper = bbMean + bbMult * bbStd;
    const bbLower = bbMean - bbMult * bbStd;
    // Keltner EMA
    const kcK = 2 / (kcEmaPeriod + 1);
    let kcEma = weeklyCloses[0];
    for (let i = 1; i < n; i++) kcEma = weeklyCloses[i] * kcK + kcEma * (1 - kcK);
    // Keltner ATR
    const atrN = Math.min(kcAtrPeriod, n - 1);
    let atrSum = 0;
    for (let i = n - atrN; i < n; i++) {
      atrSum += Math.max(weeklyHighs[i] - weeklyLows[i], Math.abs(weeklyHighs[i] - weeklyCloses[i - 1]), Math.abs(weeklyLows[i] - weeklyCloses[i - 1]));
    }
    const kcAtr = atrSum / atrN;
    const kcUpper = kcEma + kcAtrMult * kcAtr;
    const kcLower = kcEma - kcAtrMult * kcAtr;
    // 스퀴즈: BB가 KC 안에 있으면 true
    bbSqueeze = bbLower > kcLower && bbUpper < kcUpper;
    // 폴백: 기존 밴드폭 기준도 병합
    if (!bbSqueeze) {
      const bwArr = [];
      for (let i = 19; i < n; i++) {
        const sl = weeklyCloses.slice(i - 19, i + 1);
        const m = sl.reduce((a, b) => a + b, 0) / 20;
        const sd = Math.sqrt(sl.reduce((a, b) => a + (b - m) ** 2, 0) / 20);
        bwArr.push(m > 0 ? (sd * 4) / m : 0);
      }
      const curBW = bwArr[bwArr.length - 1];
      const minBW = Math.min(...bwArr.slice(-52));
      bbSqueeze = bwArr.length >= 4 && curBW <= minBW * 1.05;
    }
  }

  // 52주 신고/저가
  const high52w = weeklyCloses.length >= 52
    ? Math.max(...weeklyCloses.slice(-52))
    : Math.max(...weeklyCloses);
  const low52w = weeklyCloses.length >= 52
    ? Math.min(...weeklyCloses.slice(-52))
    : Math.min(...weeklyCloses);
  const near52wLow = price <= low52w * 1.05;
  const near52wHigh = price >= high52w * 0.98;

  // OBV (On-Balance Volume) - 간단한 구현
  let obv = 0;
  const obvArr = [];
  for (let i = 0; i < weeklyCloses.length; i++) {
    if (i === 0) obv = weeklyVolumes[i];
    else {
      if (weeklyCloses[i] > weeklyCloses[i-1]) obv += weeklyVolumes[i];
      else if (weeklyCloses[i] < weeklyCloses[i-1]) obv -= weeklyVolumes[i];
    }
    obvArr.push(obv);
  }

  // 최근 주간 변동폭 (ATR의 2배 이상인지 확인)
  const recentRange = weeklyHighs[weeklyHighs.length - 1] - weeklyLows[weeklyLows.length - 1];
  const atrBreakout = atr && recentRange > atr * 2;

  // 가격 채널 (52주 고/저 근처)
  const priceChannel = near52wHigh || near52wLow;

  // 갭 신호 — 마켓별 동적 임계값 (P2 수정: crypto 8%, kr 4%, us 3%)
  const marketType = conditions._marketType || "us"; // 호출 시 전달
  const gapThreshold = marketType === "crypto" ? 8 : marketType === "kr" ? 4 : 3;
  const gapSignal = Math.abs(weekChange) >= gapThreshold;

  // 거래량 극증
  const volumeClimax = volRatio >= 3;

  // 거래량 고갈
  const volumeDry = volRatio <= 0.3;

  // OBV 다이버전스 — 룩백 8주 + 선형회귀 기울기 비교 (P2 수정) + 방향성 추가 (v6.8)
  let obvDivergence = false;
  let obvDivType = null; // "bullish" | "bearish" — 가격↓+OBV↑ = bullish, 가격↑+OBV↓ = bearish
  const obvLookback = Math.min(obvArr.length, 8);
  if (obvArr.length >= obvLookback && obvLookback >= 4) {
    const priceSlice8 = weeklyCloses.slice(-obvLookback);
    const obvSlice8 = obvArr.slice(-obvLookback);
    // 선형회귀 기울기
    const linSlope = (arr) => {
      const n = arr.length;
      let sx = 0, sy = 0, sxy = 0, sx2 = 0;
      for (let i = 0; i < n; i++) { sx += i; sy += arr[i]; sxy += i * arr[i]; sx2 += i * i; }
      return (n * sxy - sx * sy) / (n * sx2 - sx * sx || 1);
    };
    const priceSlope = linSlope(priceSlice8);
    const obvSlope = linSlope(obvSlice8);
    if (priceSlope < 0 && obvSlope > 0) { obvDivergence = true; obvDivType = "bullish"; }
    else if (priceSlope > 0 && obvSlope < 0) { obvDivergence = true; obvDivType = "bearish"; }
  }

  // ── 신규 지표: CMF (Chaikin Money Flow) ──
  let cmf = null;
  const cmfPeriod = Math.min(20, weeklyCloses.length);
  if (cmfPeriod >= 10) {
    let mfvSum = 0, volSum = 0;
    for (let i = weeklyCloses.length - cmfPeriod; i < weeklyCloses.length; i++) {
      const h = weeklyHighs[i], l = weeklyLows[i], c = weeklyCloses[i], v = weeklyVolumes[i];
      const clv = h === l ? 0 : ((c - l) - (h - c)) / (h - l);
      mfvSum += clv * v;
      volSum += v;
    }
    cmf = volSum > 0 ? mfvSum / volSum : 0;
  }

  // ── 신규 지표: MFI (Money Flow Index) ──
  let mfi = null;
  const mfiPeriod = 14;
  if (weeklyCloses.length >= mfiPeriod + 1) {
    let posFlow = 0, negFlow = 0;
    for (let i = weeklyCloses.length - mfiPeriod; i < weeklyCloses.length; i++) {
      const tp = (weeklyHighs[i] + weeklyLows[i] + weeklyCloses[i]) / 3;
      const prevTp = (weeklyHighs[i-1] + weeklyLows[i-1] + weeklyCloses[i-1]) / 3;
      const rawFlow = tp * weeklyVolumes[i];
      if (tp > prevTp) posFlow += rawFlow;
      else negFlow += rawFlow;
    }
    mfi = negFlow === 0 ? 100 : 100 - 100 / (1 + posFlow / negFlow);
  }

  // CMF 기반 스크리닝 조건
  const cmfStrong = cmf != null && cmf > 0.1;     // 강한 매집
  const cmfWeak = cmf != null && cmf < -0.1;      // 강한 분산
  // MFI 기반 스크리닝 조건
  const mfiOversold = mfi != null && mfi < 20;     // 거래량 동반 과매도
  const mfiOverbought = mfi != null && mfi > 80;   // 거래량 동반 과매수

  // 평균회귀 (200일선 대비 ±15% 이상)
  const meanReversion = ma200Dist && Math.abs(ma200Dist) >= 15;

  // MACD 다이버전스 — peak/trough 비교 방식 (P1 수정 + 성능 최적화)
  let macdDivergence = false;
  let macdDivType = null; // "bullish" | "bearish"
  if (weeklyCloses.length >= 12) {
    // MACD 히스토그램 1회 계산 후 슬라이스 (기존 24회 반복 호출 제거)
    const lookback = Math.min(weeklyCloses.length, 24);
    const fullHist = calcMACDHistogram(weeklyCloses);
    const macdHist = fullHist.length >= lookback ? fullHist.slice(-lookback) : fullHist;
    const priceSlice = weeklyCloses.slice(-lookback);
    const priceHighs = findSwingPoints(priceSlice, "high");
    const priceLows = findSwingPoints(priceSlice, "low");
    const macdHighs = findSwingPoints(macdHist, "high");
    const macdLows = findSwingPoints(macdHist, "low");
    // Bearish: 가격 higher-high + MACD lower-high
    if (priceHighs.length >= 2 && macdHighs.length >= 2) {
      const [ph1, ph2] = priceHighs.slice(-2);
      const [mh1, mh2] = macdHighs.slice(-2);
      if (ph2.val > ph1.val && mh2.val < mh1.val) { macdDivergence = true; macdDivType = "bearish"; }
    }
    // Bullish: 가격 lower-low + MACD higher-low
    if (!macdDivergence && priceLows.length >= 2 && macdLows.length >= 2) {
      const [pl1, pl2] = priceLows.slice(-2);
      const [ml1, ml2] = macdLows.slice(-2);
      if (pl2.val < pl1.val && ml2.val > ml1.val) { macdDivergence = true; macdDivType = "bullish"; }
    }
  }

  // RSI 다이버전스 — MACD와 동일한 peak/trough 비교 방식
  let rsiDivergence = false;
  let rsiDivType = null; // "bullish" | "bearish"
  if (weeklyCloses.length >= 16) {
    const rsiLookback = Math.min(weeklyCloses.length, 24);
    const rsiArr = calcRSIArray(weeklyCloses);
    const rsiSlice = rsiArr.length >= rsiLookback ? rsiArr.slice(-rsiLookback) : rsiArr;
    const priceSliceRsi = weeklyCloses.slice(-rsiSlice.length);
    if (rsiSlice.length >= 6) {
      const pHighs = findSwingPoints(priceSliceRsi, "high");
      const pLows = findSwingPoints(priceSliceRsi, "low");
      const rHighs = findSwingPoints(rsiSlice, "high");
      const rLows = findSwingPoints(rsiSlice, "low");
      // Bearish RSI Divergence: 가격 higher-high + RSI lower-high
      if (pHighs.length >= 2 && rHighs.length >= 2) {
        const [ph1, ph2] = pHighs.slice(-2);
        const [rh1, rh2] = rHighs.slice(-2);
        if (ph2.val > ph1.val && rh2.val < rh1.val) { rsiDivergence = true; rsiDivType = "bearish"; }
      }
      // Bullish RSI Divergence: 가격 lower-low + RSI higher-low
      if (!rsiDivergence && pLows.length >= 2 && rLows.length >= 2) {
        const [pl1, pl2] = pLows.slice(-2);
        const [rl1, rl2] = rLows.slice(-2);
        if (pl2.val < pl1.val && rl2.val > rl1.val) { rsiDivergence = true; rsiDivType = "bullish"; }
      }
    }
  }

  // 볼륨 프로파일 — POC 근접 여부 (지지/저항 근접 감지)
  let nearPOC = false;
  let pocPrice = null;
  const vpResult = calcVolumeProfile(weeklyCloses, weeklyVolumes);
  if (vpResult) {
    pocPrice = vpResult.poc;
    const pocDist = Math.abs(price - pocPrice) / pocPrice * 100;
    nearPOC = pocDist <= 2; // POC ±2% 이내
  }

  // MA 리본 (정배열/역배열)
  let maRibbon = false;
  if (ma20daily && ma50daily && ma200daily) {
    const bullish = ma20daily > ma50daily && ma50daily > ma200daily;
    const bearish = ma20daily < ma50daily && ma50daily < ma200daily;
    maRibbon = bullish || bearish;
  }

  // ADX 강한 추세 + 방향성 (P2 수정: +DI/-DI 활용)
  const adxTrend = adxResult && adxResult.adx >= 25;
  const adxBullish = adxTrend && adxResult.plusDI > adxResult.minusDI;
  const adxBearish = adxTrend && adxResult.plusDI < adxResult.minusDI;

  // Golden/Death Cross — "이벤트" 감지로 전환 (P1 수정)
  // 이전 주와 현재 주의 MA50-MA200 관계 변화를 추적
  let goldenCross = false, deathCross = false;
  if (dailyCloses.length >= 205) {
    const prevMA50 = calcSMA(dailyCloses.slice(0, -5), 50);
    const prevMA200 = calcSMA(dailyCloses.slice(0, -5), 200);
    if (prevMA50 && prevMA200 && ma50daily && ma200daily) {
      goldenCross = prevMA50 <= prevMA200 && ma50daily > ma200daily; // 실제 크로스 이벤트
      deathCross = prevMA50 >= prevMA200 && ma50daily < ma200daily;
    }
    // 또는 최근 4주 이내에 크로스 발생 시에도 인정
    if (!goldenCross && !deathCross && dailyCloses.length >= 220) {
      for (let w = 1; w <= 4 && !goldenCross && !deathCross; w++) {
        const pM50 = calcSMA(dailyCloses.slice(0, -(w*5)), 50);
        const pM200 = calcSMA(dailyCloses.slice(0, -(w*5)), 200);
        const cM50 = calcSMA(dailyCloses.slice(0, -(w*5 - 5) || undefined), 50);
        const cM200 = calcSMA(dailyCloses.slice(0, -(w*5 - 5) || undefined), 200);
        if (pM50 && pM200 && cM50 && cM200) {
          if (pM50 <= pM200 && cM50 > cM200) goldenCross = true;
          if (pM50 >= pM200 && cM50 < cM200) deathCross = true;
        }
      }
    }
  }

  const triggers = [];
  if (conditions.includes("rsi_extreme")     && rsi != null && (rsi <= 25 || rsi >= 75))           triggers.push("rsi_extreme");
  if (conditions.includes("macd_divergence")  && macdDivergence)                                   triggers.push("macd_divergence");
  if (conditions.includes("ma_ribbon")        && maRibbon)                                         triggers.push("ma_ribbon");
  if (conditions.includes("adx_trend")        && adxTrend)                                         triggers.push("adx_trend");
  if (conditions.includes("bb_squeeze")       && bbSqueeze)                                        triggers.push("bb_squeeze");
  if (conditions.includes("atr_breakout")     && atrBreakout)                                      triggers.push("atr_breakout");
  if (conditions.includes("price_channel")    && priceChannel)                                     triggers.push("price_channel");
  if (conditions.includes("gap_signal")       && gapSignal)                                        triggers.push("gap_signal");
  if (conditions.includes("volume_climax")    && volumeClimax)                                     triggers.push("volume_climax");
  if (conditions.includes("obv_divergence")   && obvDivergence)                                    triggers.push("obv_divergence");
  if (conditions.includes("volume_dry")       && volumeDry)                                        triggers.push("volume_dry");
  if (conditions.includes("near_52w_low")     && near52wLow)                                       triggers.push("near_52w_low");
  if (conditions.includes("near_52w_high")    && near52wHigh)                                      triggers.push("near_52w_high");
  if (conditions.includes("death_cross")      && deathCross)                                       triggers.push("death_cross");
  if (conditions.includes("golden_cross")     && goldenCross)                                      triggers.push("golden_cross");
  if (conditions.includes("mean_reversion")   && meanReversion)                                    triggers.push("mean_reversion");
  if (conditions.includes("cmf_accumulation") && cmfStrong)                                        triggers.push("cmf_accumulation");
  if (conditions.includes("cmf_distribution") && cmfWeak)                                          triggers.push("cmf_distribution");
  if (conditions.includes("mfi_oversold")     && mfiOversold)                                      triggers.push("mfi_oversold");
  if (conditions.includes("mfi_overbought")   && mfiOverbought)                                    triggers.push("mfi_overbought");
  if (conditions.includes("adx_bullish")      && adxBullish)                                       triggers.push("adx_bullish");
  if (conditions.includes("adx_bearish")      && adxBearish)                                       triggers.push("adx_bearish");
  if (conditions.includes("rsi_divergence")   && rsiDivergence)                                    triggers.push("rsi_divergence");
  if (conditions.includes("near_poc")         && nearPOC)                                          triggers.push("near_poc");
  // v6.9: 다중 타임프레임 RSI 스크리닝 조건 추가
  const mtfOversold = rsi != null && dailyRsi != null && rsi <= 30 && dailyRsi <= 30;
  const mtfOverbought = rsi != null && dailyRsi != null && rsi >= 70 && dailyRsi >= 70;
  if (conditions.includes("mtf_rsi_oversold")  && mtfOversold)                                     triggers.push("mtf_rsi_oversold");
  if (conditions.includes("mtf_rsi_overbought") && mtfOverbought)                                  triggers.push("mtf_rsi_overbought");
  // v6.9.1: 복합 다이버전스 스크리닝 조건
  const compoundBullDiv = [macdDivType === "bullish", rsiDivType === "bullish", obvDivType === "bullish"].filter(Boolean).length >= 2;
  const compoundBearDiv = [macdDivType === "bearish", rsiDivType === "bearish", obvDivType === "bearish"].filter(Boolean).length >= 2;
  if (conditions.includes("compound_bull_div") && compoundBullDiv)                                 triggers.push("compound_bull_div");
  if (conditions.includes("compound_bear_div") && compoundBearDiv)                                 triggers.push("compound_bear_div");

  return {
    triggers, price: +price.toFixed(6),
    rsi: rsi != null ? +rsi.toFixed(1) : null,
    weekChange: +weekChange.toFixed(2),
    ma200Dist: ma200Dist != null ? +ma200Dist.toFixed(2) : null,
    volRatio: +volRatio.toFixed(1),
    ma50: ma50daily, ma200: ma200daily,
    stoch, wr: wr != null ? +wr.toFixed(1) : null,
    low52w, high52w,
    cmf: cmf != null ? +cmf.toFixed(3) : null,
    mfi: mfi != null ? +mfi.toFixed(1) : null,
    adxBullish, adxBearish,
    adx: adxResult ? +adxResult.adx.toFixed(1) : null,
    plusDI: adxResult ? +adxResult.plusDI.toFixed(1) : null,
    minusDI: adxResult ? +adxResult.minusDI.toFixed(1) : null,
    bbSqueeze,
    bbWidth: (() => { // BB 밴드폭 (v9)
      if (weeklyCloses.length < 20) return null;
      const sl = weeklyCloses.slice(-20);
      const m = sl.reduce((a, b) => a + b, 0) / 20;
      const sd = Math.sqrt(sl.reduce((a, b) => a + (b - m) ** 2, 0) / 20);
      return m > 0 ? +(sd * 4 / m).toFixed(4) : null;
    })(),
    atr14Pct: (() => { // ATR(14) 비율 (v9)
      const n = weeklyCloses.length;
      if (n < 15 || weeklyHighs.length < 15) return null;
      let sum = 0;
      for (let i = n - 14; i < n; i++) {
        sum += Math.max(weeklyHighs[i] - weeklyLows[i], Math.abs(weeklyHighs[i] - weeklyCloses[i - 1]), Math.abs(weeklyLows[i] - weeklyCloses[i - 1]));
      }
      const atr = sum / 14;
      return price > 0 ? +(atr / price * 100).toFixed(2) : null;
    })(),
    macdDivType, rsiDivType, obvDivType,
    pocPrice: pocPrice != null ? +pocPrice.toFixed(2) : null,
    nearPOC,
    dailyRsi: dailyRsi != null ? +dailyRsi.toFixed(1) : null,
  };
}

// ════════════════════════════════════════════════════════════════════
// 조건 메타데이터
// ════════════════════════════════════════════════════════════════════
const CONDITION_META = {
  // {t("tabs.screener.momentum")}
  rsi_extreme:     { label: "RSI 극단값",        icon: "⚡", desc: "RSI ≤ 25 또는 ≥ 75 — 극단적 과매수/과매도" },
  macd_divergence: { label: "MACD 다이버전스",    icon: "🔀", desc: "가격과 MACD 방향 불일치 — 추세 반전 선행지표" },
  ma_ribbon:       { label: "이평선 정배열/역배열", icon: "📐", desc: "MA20>MA50>MA200 정배열 또는 역배열 — 추세 강도 확인" },
  adx_trend:       { label: "ADX 강한 추세",      icon: "💪", desc: "ADX ≥ 25 + DI 방향 — 추세 존재 및 방향 확인" },
  // {t("tabs.screener.volatility")}
  bb_squeeze:      { label: "TTM 스퀴즈",         icon: "🔥", desc: "BB가 Keltner Channel 내부 수축 (TTM Squeeze) — 대규모 변동 폭발 임박" },
  atr_breakout:    { label: "ATR 돌파",           icon: "🚀", desc: "당일 변동폭이 ATR(14) 2배 초과 — 폭발적 움직임" },
  price_channel:   { label: "채널 돌파",          icon: "📊", desc: "52주 고가/저가 채널 돌파 — 신고가 또는 지지선 이탈" },
  gap_signal:      { label: "갭 시그널",          icon: "⬆️", desc: "전주 대비 ±3% 이상 갭 — 수급 불균형" },
  // {t("tabs.screener.volume")}
  volume_climax:   { label: "거래량 클라이맥스",   icon: "🌊", desc: "거래량 20주 평균 3배 이상 — 세력 매집/투매 신호" },
  obv_divergence:  { label: "OBV 다이버전스",     icon: "📈", desc: "OBV와 가격 방향 불일치 — 스마트머니 움직임 포착" },
  volume_dry:      { label: "거래량 고갈",         icon: "🏜️", desc: "거래량 20주 평균 30% 이하 — 바닥 형성 가능" },
  // 밸류에이션 & 상대강도
  near_52w_low:    { label: "52주 신저가 근접",    icon: "🔔", desc: "52주 최저가 대비 5% 이내" },
  near_52w_high:   { label: "52주 신고가 근접",    icon: "🏆", desc: "52주 최고가 대비 2% 이내 — 모멘텀 브레이크아웃" },
  death_cross:     { label: "데스크로스",          icon: "💀", desc: "50일선이 200일선 하향돌파 — 장기 하락전환 경고" },
  golden_cross:    { label: "골든크로스",          icon: "✨", desc: "50일선이 200일선 상향돌파 — 장기 상승전환" },
  mean_reversion:  { label: "평균회귀 신호",       icon: "🎯", desc: "200일선 대비 ±15% 이상 이탈 — 평균회귀 구간" },
  // 신규 조건 (v6.7)
  cmf_accumulation:{ label: "CMF 매집 감지",       icon: "💰", desc: "Chaikin Money Flow > 0.1 — 스마트머니 매집 구간" },
  cmf_distribution:{ label: "CMF 분산 감지",       icon: "💸", desc: "Chaikin Money Flow < -0.1 — 세력 매도 분산 구간" },
  mfi_oversold:    { label: "MFI 과매도",          icon: "🔋", desc: "거래량 가중 RSI(MFI) < 20 — 볼륨 동반 극단 과매도" },
  mfi_overbought:  { label: "MFI 과매수",          icon: "⚡", desc: "거래량 가중 RSI(MFI) > 80 — 볼륨 동반 극단 과매수" },
  adx_bullish:     { label: "ADX 강세 추세",       icon: "🐂", desc: "ADX≥25 + 매수 방향(+DI > -DI) — 강한 상승 추세 확인" },
  adx_bearish:     { label: "ADX 약세 추세",       icon: "🐻", desc: "ADX≥25 + 매도 방향(-DI > +DI) — 강한 하락 추세 확인" },
  // 신규 조건 (v6.8)
  rsi_divergence:  { label: "RSI 다이버전스",       icon: "🔄", desc: "가격과 RSI 방향 불일치 — MACD보다 빈번한 단기 반전 신호" },
  near_poc:        { label: "볼륨 POC 근접",        icon: "🎯", desc: "볼륨 프로파일 POC(고거래량 가격대) ±2% — 강한 지지/저항 구간" },
  // v6.9: 다중 타임프레임 RSI
  mtf_rsi_oversold: { label: "MTF RSI 과매도",     icon: "📊", desc: "주간+일간 RSI 동시 ≤30 — 다중 타임프레임 과매도 확인 (높은 신뢰도)" },
  mtf_rsi_overbought:{ label: "MTF RSI 과매수",    icon: "📊", desc: "주간+일간 RSI 동시 ≥70 — 다중 타임프레임 과매수 확인 (높은 신뢰도)" },
  // v6.9.1: 복합 다이버전스
  compound_bull_div: { label: "복합 강세 다이버전스", icon: "⚡", desc: "MACD+RSI+OBV 중 2개 이상 강세 다이버전스 동시 발생 — 고신뢰 반전 시그널" },
  compound_bear_div: { label: "복합 약세 다이버전스", icon: "⚡", desc: "MACD+RSI+OBV 중 2개 이상 약세 다이버전스 동시 발생 — 고신뢰 하락전환 시그널" },
};

// ════════════════════════════════════════════════════════════════════
// 감정 분석 헬퍼
// ════════════════════════════════════════════════════════════════════
function analyzeSentiment(title) {
  if (!title) return "neutral";
  const t = ` ${title.toLowerCase()} `;

  // ── 강한 {t("sentiment.bullish")} (가중치 2) ──
  const strongPos = ["surge","soar","record high","all-time high","skyrocket","boom","breakout",
    "급등","폭등","신고가","사상최고","돌파","대박","호실적","깜짝실적","어닝서프라이즈"];
  // ── 긍정 (가중치 1) ──
  const pos = ["rally","gain","jump","rise","bull","growth","profit","beat","outperform",
    "upgrade","buy","strong","positive","recover","rebound","advance","climb","up ",
    "상승","호재","성장","흑자","매수","상향","강세","반등","회복","호조","개선",
    "수혜","낙관","기대","확대","증가","호황","상승세","매출증가","이익증가"];
  // ── 강한 {t("sentiment.bearish")} (가중치 2) ──
  const strongNeg = ["crash","plunge","collapse","bankruptcy","default","crisis",
    "폭락","급락","파산","디폴트","위기","붕괴","대폭락","폭발적하락","서킷브레이커"];
  // ── 부정 (가중치 1) ──
  const neg = ["fall","drop","decline","loss","bear","sell","cut","miss","weak","concern",
    "recession","downgrade","warning","fear","risk","slump","slide","tumble","layoff",
    "하락","악재","적자","매도","하향","약세","침체","불안","우려","감소","축소",
    "둔화","손실","경고","감원","정리해고","하락세","부진","역풍"];
  // ── 부정어 앞 긍정을 뒤집는 문맥 (반전어) ──
  const negators = ["not ","no ","n't ","despite ","unlikely ","fails ","failed ",
    "않","못","없","아닌","불구","실패"];

  let score = 0;
  strongPos.forEach(w => { if (t.includes(w)) score += 2; });
  pos.forEach(w => { if (t.includes(w)) score += 1; });
  strongNeg.forEach(w => { if (t.includes(w)) score -= 2; });
  neg.forEach(w => { if (t.includes(w)) score -= 1; });

  // 반전어 감지: "not rise", "상승 않" 등
  const hasNegator = negators.some(n => t.includes(n));
  if (hasNegator && score !== 0) score = -score * 0.5;

  // "low risk" → {t("sentiment.neutral")} 보정, "high risk" → 부정 보정
  if (t.includes("low risk")) score += 1;
  if (t.includes("high risk")) score -= 1;
  // "cut rates" (금리인하) → 긍정 보정
  if (t.includes("cut rate") || t.includes("rate cut") || t.includes("금리인하") || t.includes("금리 인하")) score += 1;

  if (score >= 1) return "positive";
  if (score <= -1) return "negative";
  return "neutral";
}

// ════════════════════════════════════════════════════════════════════
// 텔레그램
// ════════════════════════════════════════════════════════════════════
async function sendTelegramAlert(botToken, chatId, assets, conditions) {
  const labels = Object.fromEntries(Object.entries(CONDITION_META).map(([k, v]) => [k, `${v.icon} ${v.label}`]));
  const now = new Date();
  const timeStr = now.toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "short", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit" });

  let msg = `🚨 *Zepta 시그널 알림*\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `📅 ${timeStr}\n`;
  msg += `📊 시그널 감지: *${assets.length}개* 자산\n\n`;

  // 시장별 요약 헤더
  const usAssets = assets.filter(a => a.market === "us");
  const krAssets = assets.filter(a => a.market === "kr");
  const cryptoAssets = assets.filter(a => a.market !== "us" && a.market !== "kr");
  if (usAssets.length > 0 || krAssets.length > 0 || cryptoAssets.length > 0) {
    msg += `📌 *시장별 분포*\n`;
    if (usAssets.length) msg += `   🇺🇸 미국 ${usAssets.length}종목`;
    if (krAssets.length) msg += `${usAssets.length ? " | " : "   "}🇰🇷 한국 ${krAssets.length}종목`;
    if (cryptoAssets.length) msg += `${(usAssets.length || krAssets.length) ? " | " : "   "}₿ 크립토 ${cryptoAssets.length}종목`;
    msg += `\n\n`;
  }

  // 시그널 강도 분류
  const strong = assets.filter(a => a.triggers && a.triggers.length >= 3);
  const moderate = assets.filter(a => a.triggers && a.triggers.length === 2);
  if (strong.length > 0) {
    msg += `🔥 *강력 시그널 (3개+)*\n`;
    strong.slice(0, 5).forEach(a => {
      const flag = a.market === "us" ? "🇺🇸" : a.market === "kr" ? "🇰🇷" : "₿";
      const price = a.market === "kr" ? `₩${Math.round(a.price).toLocaleString()}` : `$${a.price?.toLocaleString(undefined, { maximumFractionDigits: a.price < 1 ? 6 : 2 })}`;
      const chg = a.weekChange >= 0 ? `+${a.weekChange}%` : `${a.weekChange}%`;
      msg += `${flag} *${a.name}* \`${a.symbol}\`\n`;
      msg += `   ${price} | ${chg} | RSI ${a.rsi ?? "—"}\n`;
      msg += `   ${a.triggers.map(t => labels[t] || t).join(" · ")}\n\n`;
    });
  }

  // 나머지 종목
  const rest = assets.filter(a => !strong.includes(a));
  rest.slice(0, 10).forEach(a => {
    const flag = a.market === "us" ? "🇺🇸" : a.market === "kr" ? "🇰🇷" : "₿";
    const price = a.market === "kr" ? `₩${Math.round(a.price).toLocaleString()}` : `$${a.price?.toLocaleString(undefined, { maximumFractionDigits: a.price < 1 ? 6 : 2 })}`;
    const chg = a.weekChange >= 0 ? `+${a.weekChange}%` : `${a.weekChange}%`;
    msg += `${flag} *${a.name}* \`${a.symbol}\`\n`;
    msg += `   ${price} | ${chg} | RSI ${a.rsi ?? "—"}\n`;
    msg += `   ${a.triggers.map(t => labels[t] || t).join(" · ")}\n\n`;
  });
  const shown = strong.slice(0, 5).length + rest.slice(0, 10).length;
  if (assets.length > shown) msg += `_...외 ${assets.length - shown}개_\n\n`;

  msg += `━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `_⚠️ 기술적 지표 기반 참고 자료 — 투자 추천 아님_\n`;
  msg += `_Zepta Signal Screener_`;
  const r = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: msg, parse_mode: "Markdown" }),
  });
  return r.json();
}

// ════════════════════════════════════════════════════════════════════
// 로컬스토리지 헬퍼
// ════════════════════════════════════════════════════════════════════
const PORTFOLIO_KEY = "ss_portfolio_v3";
const SETTINGS_KEY  = "ss_settings_v3";
function loadPortfolio() { try { return JSON.parse(localStorage.getItem(PORTFOLIO_KEY)) || []; } catch { return []; } }
function savePortfolio(p) { localStorage.setItem(PORTFOLIO_KEY, JSON.stringify(p)); }
function loadSettings()  { try { return JSON.parse(localStorage.getItem(SETTINGS_KEY))  || {}; } catch { return {}; } }
function saveSettings(s) { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); }

// ════════════════════════════════════════════════════════════════════
// 포맷 헬퍼
// ════════════════════════════════════════════════════════════════════
function fmtPrice(price, market) {
  if (price == null) return "—";
  if (market === "kr") return `₩${Math.round(price).toLocaleString()}`;
  if (price < 0.01) return `$${price.toFixed(6)}`;
  if (price < 1) return `$${price.toFixed(4)}`;
  return `$${price.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

// ════════════════════════════════════════════════════════════════════
// 색상 팔레트 — 다크 / 라이트 테마
// ════════════════════════════════════════════════════════════════════
const THEME_KEY = "ss_theme";
// ★ Zepta 디자인 시스템 SSOT — src/ui/theme.jsx 의 THEME_TOKENS 가 단일 진실
//    이전엔 DARK/LIGHT 를 여기서 직접 정의해서 9개 파일이 따로 갖고 있었음.
//    이제 모든 파일이 THEME_TOKENS 에서 가져옴. 변경은 theme.jsx 에서만.
const DARK = THEME_TOKENS.dark;
const LIGHT = THEME_TOKENS.light;
function loadTheme() { try { return localStorage.getItem(THEME_KEY) || "dark"; } catch { return "dark"; } }
// C will be set dynamically in App component and passed through context
let C = DARK;

// ════════════════════════════════════════════════════════════════════
// 터치 가드: 스크롤 중 카드 오클릭 방지
// 터치 시작→이동(>8px)→끝 → 클릭 무시
// ════════════════════════════════════════════════════════════════════
const _touchState = { startX: 0, startY: 0, moved: false };
function onTouchCardStart(e) {
  const t = e.touches[0];
  _touchState.startX = t.clientX; _touchState.startY = t.clientY; _touchState.moved = false;
}
function onTouchCardMove(e) {
  if (_touchState.moved) return;
  const t = e.touches[0];
  const dx = Math.abs(t.clientX - _touchState.startX);
  const dy = Math.abs(t.clientY - _touchState.startY);
  if (dx > 8 || dy > 8) _touchState.moved = true;
}
function isTouchTap() { return !_touchState.moved; }

// ════════════════════════════════════════════════════════════════════
// 서브 컴포넌트: PullToRefresh (모바일 아래로 당겨서 새로고침)
// ════════════════════════════════════════════════════════════════════
function PullToRefresh({ onRefresh, children }) {
  const { t } = useLanguage();
  const containerRef = useRef(null);
  const [pulling, setPulling] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef(0);
  const startX = useRef(0);
  const isVertical = useRef(null); // null=미확정, true=수직, false=수평
  const THRESHOLD = 120; // 임계값 증가 (80→120) — 스크롤 중 오발동 방지

  const handleTouchStart = useCallback((e) => {
    if (window.scrollY <= 2) { // 2px 이내일 때만 (정확히 0이 아닌 경우 대비)
      startY.current = e.touches[0].clientY;
      startX.current = e.touches[0].clientX;
      isVertical.current = null;
      setPulling(true);
    } else {
      setPulling(false);
    }
  }, []);

  const handleTouchMove = useCallback((e) => {
    if (!pulling) return;
    const diffY = e.touches[0].clientY - startY.current;
    const diffX = e.touches[0].clientX - startX.current;

    // 방향 판단: 처음 10px 이동에서 수직/수평 결정
    if (isVertical.current === null && (Math.abs(diffY) > 10 || Math.abs(diffX) > 10)) {
      isVertical.current = Math.abs(diffY) > Math.abs(diffX) * 1.5; // 수직 이동이 수평의 1.5배 이상일 때만
    }
    // 수직 아래 방향 + 스크롤 최상단일 때만 pull-to-refresh 활성화
    if (isVertical.current && diffY > 15 && window.scrollY <= 2) {
      setPullDistance(Math.min((diffY - 15) * 0.35, 120)); // 감쇠 강화 (0.5→0.35) + 15px 데드존
    }
  }, [pulling]);

  const handleTouchEnd = useCallback(async () => {
    if (pullDistance >= THRESHOLD && !refreshing) {
      setRefreshing(true);
      setPullDistance(50);
      try { await onRefresh(); } catch {}
      setRefreshing(false);
    }
    setPulling(false);
    setPullDistance(0);
  }, [pullDistance, refreshing, onRefresh]);

  return (
    <div ref={containerRef} onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd}>
      {pullDistance > 0 && (
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          height: `${pullDistance}px`, overflow: "hidden",
          transition: pulling ? "none" : "height .3s ease",
        }}>
          <div style={{
            fontSize: "20px",
            transform: `rotate(${Math.min(pullDistance / THRESHOLD, 1) * 360}deg)`,
            transition: pulling ? "none" : "transform .3s ease",
            opacity: Math.min(pullDistance / THRESHOLD, 1),
          }}>
            {refreshing ? "⏳" : pullDistance >= THRESHOLD ? "↻" : "↓"}
          </div>
          <span style={{ marginLeft: "8px", fontSize: "18px", color: C.text3, fontWeight: 600 }}>
            {refreshing ? t("diag.refreshing") : pullDistance >= THRESHOLD ? t("diag.releaseToRefresh") : t("diag.pullDown")}
          </span>
        </div>
      )}
      {children}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// 서브 컴포넌트: Tag
// ════════════════════════════════════════════════════════════════════
const TAG_COLORS = {
  rsi_extreme: C.purple, macd_divergence: C.yellow, ma_ribbon: C.blue, adx_trend: C.green,
  bb_squeeze: C.red, atr_breakout: C.red, price_channel: C.blue, gap_signal: C.yellow,
  volume_climax: C.red, obv_divergence: C.purple, volume_dry: C.yellow,
  near_52w_low: C.green, near_52w_high: C.blue, death_cross: C.red, golden_cross: C.green,
  mean_reversion: C.purple,
  cmf_accumulation: C.green, cmf_distribution: C.red,
  mfi_oversold: C.purple, mfi_overbought: C.red,
  adx_bullish: C.green, adx_bearish: C.red,
  rsi_divergence: C.yellow, near_poc: C.purple,
  mtf_rsi_oversold: C.purple, mtf_rsi_overbought: C.red,
  compound_bull_div: C.green, compound_bear_div: C.red,
};

function SignalTag({ triggerKey, asset }) {
  const { t } = useLanguage();
  const meta = CONDITION_META[triggerKey];
  let color = TAG_COLORS[triggerKey] || C.blue;
  if (!meta) return null;
  // 다이버전스에 bullish/bearish 타입 표시 + 색상 분기
  let label = meta.label;
  let icon = meta.icon;
  if (triggerKey === "macd_divergence" && asset?.macdDivType) {
    label = asset.macdDivType === "bullish" ? t("diag.tags.macdBullDiv") : t("diag.tags.macdBearDiv");
    color = asset.macdDivType === "bullish" ? C.green : C.red;
    icon = asset.macdDivType === "bullish" ? "📈" : "📉";
  }
  if (triggerKey === "rsi_divergence" && asset?.rsiDivType) {
    label = asset.rsiDivType === "bullish" ? t("diag.tags.rsiBullDiv") : t("diag.tags.rsiBearDiv");
    color = asset.rsiDivType === "bullish" ? C.green : C.red;
    icon = asset.rsiDivType === "bullish" ? "📈" : "📉";
  }
  if (triggerKey === "obv_divergence" && asset?.obvDivType) {
    label = asset.obvDivType === "bullish" ? t("diag.tags.obvAccumDiv") : t("diag.tags.obvDistDiv");
    color = asset.obvDivType === "bullish" ? C.green : C.red;
    icon = asset.obvDivType === "bullish" ? "📊" : "📊";
  }
  if (triggerKey === "near_poc" && asset?.pocPrice) {
    label = t("diag.tags.pocNear", { price: `$${asset.pocPrice}` });
  }
  return (
    <span title={meta.desc} style={{
      // ★ 2026-06-12 (대표 피드백 — 종목 카드 정돈): 시그널 태그 15px 는 본문급이라
      //   카드가 시끄러웠음 → 보조 배지 위계(11px)로 정리
      padding: "2px 7px", borderRadius: "6px", fontSize: "11px", fontWeight: 700,
      background: `${color}22`, color, border: `1px solid ${color}44`, whiteSpace: "nowrap",
      cursor: "help", lineHeight: 1.6,
    }}>{icon} {label}</span>
  );
}

// ════════════════════════════════════════════════════════════════════
// 서브 컴포넌트: SearchBar (글로벌 종목 검색 + 자동완성)
// ════════════════════════════════════════════════════════════════════
function SearchBar({ onSelect, placeholder, compact = false }) {
  // ★ 감사 배치3 (i18n): listbox aria-label 이 한국어 하드코딩이라 EN 화면의 스크린리더
  //   사용자만 한국어를 듣는 문제 → SearchBar 는 항상 LanguageProvider 하위에서 렌더되므로
  //   useLanguage() 로 로케일 배선합니다.
  const { t } = useLanguage();
  // placeholder 기본값도 로케일 문구 (미지정 시)
  if (placeholder == null) placeholder = t("diag.searchPlaceholder");
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const inputRef = useRef(null);
  const dropRef = useRef(null);
  // ★ 감사 배치3 (a11y): WAI-ARIA combobox 패턴용 고유 id — SearchBar 가 한 화면에
  //   여러 개 뜰 수 있어(홈 compact + ⌘K 글로벌 검색) useId 로 인스턴스별 분리합니다.
  const listboxId = `${useId()}-sb-listbox`;

  const suggestions = useMemo(() => {
    if (!query || query.length < 1) return [];
    const q = query.toLowerCase().trim();
    const matched = ALL_ASSETS.filter(a => a.searchKey.includes(q));
    // 정렬: 심볼 정확 매치 > 심볼 시작 매치 > 이름 매치
    matched.sort((a, b) => {
      const aSymExact = a.symbol.toLowerCase() === q ? 0 : 1;
      const bSymExact = b.symbol.toLowerCase() === q ? 0 : 1;
      if (aSymExact !== bSymExact) return aSymExact - bSymExact;
      const aSymStart = a.symbol.toLowerCase().startsWith(q) ? 0 : 1;
      const bSymStart = b.symbol.toLowerCase().startsWith(q) ? 0 : 1;
      if (aSymStart !== bSymStart) return aSymStart - bSymStart;
      return a.symbol.localeCompare(b.symbol);
    });
    return matched.slice(0, 12);
  }, [query]);

  const handleKeyDown = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIdx(i => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIdx(i => Math.max(i - 1, -1));
    } else if (e.key === "Enter" && selectedIdx >= 0 && suggestions[selectedIdx]) {
      e.preventDefault();
      onSelect(suggestions[selectedIdx]);
      setQuery(""); setFocused(false); setSelectedIdx(-1);
      inputRef.current?.blur();
    } else if (e.key === "Escape") {
      setFocused(false); setSelectedIdx(-1);
      inputRef.current?.blur();
    }
  };

  // 클릭 밖 감지
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropRef.current && !dropRef.current.contains(e.target) && inputRef.current && !inputRef.current.contains(e.target)) {
        setFocused(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => { setSelectedIdx(-1); }, [query]);

  const showDrop = focused && suggestions.length > 0;
  // ★ 시안 1g 빈 상태 — 검색어가 있는데 결과가 없으면 상태 안내 + 실존 종목 예시 칩.
  //   예시는 ALL_ASSETS 에 실제로 존재하는 검색어만 남깁니다(없는 종목을 지어내지 않기).
  const showEmpty = focused && query.trim().length > 0 && suggestions.length === 0;
  const emptyExamples = useMemo(
    () => ["BTC", "엔비디아", "SK하이닉스"].filter(term => ALL_ASSETS.some(a => a.searchKey.includes(term.toLowerCase()))),
    []
  );
  // ★ 시안 1g 자동완성 하이라이트 — 질의와 일치하는 구간만 블루로 표기합니다.
  const renderHi = (text) => {
    const q = query.trim();
    const s = String(text ?? "");
    if (!q || !s) return text;
    const idx = s.toLowerCase().indexOf(q.toLowerCase());
    if (idx < 0) return text;
    return (
      <>
        {s.slice(0, idx)}
        <span style={{ color: C.blueL || C.blue }}>{s.slice(idx, idx + q.length)}</span>
        {s.slice(idx + q.length)}
      </>
    );
  };

  return (
    <div style={{ position: "relative", width: compact ? "auto" : "100%" }}>
      <div style={{ position: "relative" }}>
        {!compact && <span style={{ position: "absolute", left: "14px", top: "50%", transform: "translateY(-50%)", fontSize: "18px", color: C.text3, pointerEvents: "none" }}>🔍</span>}
        <input
          ref={inputRef}
          value={query}
          onChange={e => setQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          // ★ 감사 배치3 (a11y): combobox 시맨틱 — 스크린리더가 후보 개수·현재 선택
          //   항목을 읽을 수 있게 합니다. 키보드 동작(handleKeyDown)은 기존 그대로.
          role="combobox"
          aria-expanded={showDrop}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={showDrop && selectedIdx >= 0 ? `${listboxId}-opt-${selectedIdx}` : undefined}
          style={{
            width: compact ? "120px" : "100%",
            padding: compact ? "6px 10px" : "13px 16px 13px 42px",
            borderRadius: compact ? "8px" : "14px",
            // iOS Safari zoom 방지 — 모바일 input fontSize ≥ 16px (compact 모드도 동일)
            fontSize: "16px",
            background: compact ? C.card2 : C.card,
            border: `1px solid ${focused ? C.blue : compact ? C.border2 : C.border}`, color: C.text1,
            outline: "none", transition: "border-color .2s, box-shadow .2s, width .2s",
            boxShadow: focused ? `0 0 0 3px ${C.blue}22` : "none",
            boxSizing: "border-box",
            ...(compact && focused ? { width: "180px" } : {}),
          }}
        />
        {query && (
          <button onClick={() => { setQuery(""); inputRef.current?.focus(); }} style={{
            position: "absolute", right: "12px", top: "50%", transform: "translateY(-50%)",
            background: "none", border: "none", color: C.text3, fontSize: "18px", cursor: "pointer", padding: "4px",
          }}>✕</button>
        )}
      </div>
      {(showDrop || showEmpty) && (
        <div ref={dropRef} style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 200,
          background: C.card, border: `1px solid ${C.border}`, borderRadius: "16px",
          boxShadow: "0 8px 32px rgba(0,0,0,.5)", overflow: "hidden",
        }}>
          {showDrop ? (
          <div id={listboxId} role="listbox" aria-label={t("tabs.home.searchResultsAria")} style={{ maxHeight: "380px", overflowY: "auto" }}>
          {suggestions.map((asset, i) => {
            const flag = asset.market === "us" ? "🇺🇸" : asset.market === "kr" ? "🇰🇷" : "₿";
            const isActive = i === selectedIdx;
            return (
              <div key={`${asset.symbol}-${asset.market}-${i}`}
                id={`${listboxId}-opt-${i}`}
                role="option"
                aria-selected={isActive}
                onClick={() => { onSelect(asset); setQuery(""); setFocused(false); setSelectedIdx(-1); }}
                onMouseEnter={() => setSelectedIdx(i)}
                style={{
                  display: "flex", alignItems: "center", gap: "11px",
                  padding: "13px 14px", minHeight: "52px", cursor: "pointer",
                  background: isActive ? C.blueBg : "transparent",
                  // 선택 하이라이트를 배경색 하나로만 표현하지 않도록 좌측 accent bar 병기
                  // (색약 사용자 대응 — inset shadow 라 레이아웃 이동이 없습니다)
                  boxShadow: isActive ? `inset 3px 0 0 ${C.blue}` : "none",
                  borderBottom: i < suggestions.length - 1 ? `1px solid ${C.card2}` : "none",
                  transition: "background .15s",
                }}>
                <div style={{
                  width: "36px", height: "36px", borderRadius: "10px", flexShrink: 0,
                  // 다크 전용 hex 하드코딩 → 테마 알파 틴트 (라이트 모드에서 흰 카드 위 검은 사각형이 되던 문제 수정)
                  background: asset.market === "us" ? `${C.blue}1A` : asset.market === "kr" ? `${C.green}1A` : `${C.purple}1A`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  // 5글자 티커(GOOGL 등)가 36px 타일 밖으로 삐져나오지 않도록 폰트 축소 + overflow 보험
                  fontWeight: 800, fontSize: asset.market !== "kr" && asset.symbol.length > 4 ? "11px" : "14px",
                  overflow: "hidden",
                  color: asset.market === "us" ? C.blue : asset.market === "kr" ? C.green : C.purple,
                }}>
                  {/* 한국 종목은 숫자코드를 자르면 식별 불가("00081") — 종목명 앞 2글자로 표기 (전체 심볼은 옆 줄에 표기됨) */}
                  {asset.market === "kr" ? (asset.name || "").slice(0, 2) : asset.symbol.slice(0, 5)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {/* ★ 시안 1g: 일치 구간 블루 하이라이트 + 심볼 라인 mono */}
                  <div style={{ fontWeight: 700, fontSize: "15px", color: C.text1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{renderHi(asset.name)}</div>
                  <div style={{ fontSize: "12px", color: C.text3, fontFamily: MONO, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {flag} {renderHi(`${asset.symbol}${asset.market === "kr" ? ".KS" : ""}`)}
                    {asset.koName ? <span style={{ fontFamily: "inherit" }}> · {renderHi(asset.koName)}</span> : ""}
                  </div>
                </div>
                <div style={{
                  padding: "3px 8px", borderRadius: "6px", fontSize: "12px", fontWeight: 700, flexShrink: 0,
                  background: asset.market === "us" ? `${C.blue}18` : asset.market === "kr" ? `${C.green}18` : `${C.purple}18`,
                  color: asset.market === "us" ? C.blue : asset.market === "kr" ? C.green : C.purple,
                }}>
                  {asset.market === "us" ? "US" : asset.market === "kr" ? "KR" : "Crypto"}
                </div>
              </div>
            );
          })}
          </div>
          ) : (
          /* ★ 시안 1g 빈 상태 — '결과 없음' 상태 안내 + 실존 예시 칩.
             listbox 가 없는 상태라 combobox ARIA 로는 고지되지 않으므로 live region 으로 낭독합니다 */
          <div role="status" aria-live="polite" style={{ padding: "22px 16px", textAlign: "center" }}>
            <div style={{ width: "44px", height: "44px", borderRadius: "14px", background: C.card2, display: "flex", alignItems: "center", justifyContent: "center", color: C.text3, margin: "0 auto" }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /><line x1="8.5" y1="8.5" x2="13.5" y2="13.5" /><line x1="13.5" y1="8.5" x2="8.5" y2="13.5" /></svg>
            </div>
            <div style={{ fontSize: "15px", fontWeight: 800, color: C.text1, marginTop: "10px" }}>{t("searchOverlay.noResults", { q: query.trim() })}</div>
            <div style={{ fontSize: "12px", color: C.text3, marginTop: "4px", lineHeight: 1.6, wordBreak: "keep-all" }}>{t("searchOverlay.noResultsHint")}</div>
            {emptyExamples.length > 0 && (
              <div style={{ display: "flex", gap: "7px", marginTop: "12px", flexWrap: "wrap", justifyContent: "center" }}>
                {emptyExamples.map(term => (
                  <button key={term} onClick={() => { setQuery(term); inputRef.current?.focus(); }} style={{
                    fontSize: "12px", fontWeight: 700, padding: "7px 13px", borderRadius: "9999px",
                    background: C.card2, border: `1px solid ${C.border}`, color: C.text2, cursor: "pointer", fontFamily: "inherit",
                  }}>{term}</button>
                ))}
              </div>
            )}
          </div>
          )}
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// ── 퀵 투자진단 v2.2 (카드용 — API 호출 없이 기존 데이터로 즉시 계산, v4.1 최적화) ──
function quickDiagnosis(asset) {
  const signals = [];
  let trendScore = 50, momScore = 50, supScore = 50, posScore = 50;

  // ── 추세: MA 배열 + MA 거리 세분화 ──
  if (asset.ma200Dist != null) {
    if (asset.ma200Dist > 20) { trendScore += 15; signals.push({ type: "bullish", name: "200일선 크게 상회 (+20%+)" }); }
    else if (asset.ma200Dist > 10) { trendScore += 12; signals.push({ type: "bullish", name: "200일선 위 +10%" }); }
    else if (asset.ma200Dist > 3) trendScore += 8;
    else if (asset.ma200Dist > 0) trendScore += 4;
    else if (asset.ma200Dist > -5) trendScore -= 4;
    else if (asset.ma200Dist > -10) { trendScore -= 8; signals.push({ type: "bearish", name: `200일선 아래 ${asset.ma200Dist.toFixed(0)}%` }); } // v4.1: -15→-10 세분화 (고변동 조기 감지)
    else if (asset.ma200Dist > -15) { trendScore -= 12; signals.push({ type: "bearish", name: `200일선 크게 하회 ${asset.ma200Dist.toFixed(0)}%` }); } // v4.1: 추가 구간
    else { trendScore -= 15; signals.push({ type: "bearish", name: `200일선 극단 하회 (${asset.ma200Dist.toFixed(0)}%)` }); }
  }
  // MA 배열 상태
  const ma50 = asset.fiftyDayAvg || asset.ma50;
  const ma200 = asset.twoHundredDayAvg || asset.ma200;
  if (ma50 && ma200) {
    if (ma50 > ma200 && asset.price > ma50) { trendScore += 10; signals.push({ type: "bullish", name: "정배열 + 가격 위" }); }
    else if (ma50 > ma200) { trendScore += 5; signals.push({ type: "bullish", name: "골든크로스 구간" }); }
    else if (ma50 < ma200 && asset.price < ma50) { trendScore -= 10; signals.push({ type: "bearish", name: "역배열 + 가격 아래" }); } // v4.1: -8→-10 하락추세 가중
    else if (ma50 < ma200) { trendScore -= 5; signals.push({ type: "bearish", name: "데드크로스 구간" }); } // v4.1: -4→-5
  }
  // 단기 추세
  if (asset.weekChange > 8) trendScore += 6;
  else if (asset.weekChange > 3) trendScore += 3;
  else if (asset.weekChange < -8) trendScore -= 8; // v4.1: -6→-8 급락 가중
  else if (asset.weekChange < -3) trendScore -= 4; // v4.1: -3→-4
  trendScore = Math.max(0, Math.min(100, trendScore));

  // ── 모멘텀: RSI 연속 그라데이션 (v4.1 최적화) + 스토캐스틱 + W%R ──
  // v4.1: 5단계 변동성 레짐 기반 RSI 임계값 동적 조정 + 극단변동/고변동 임계값 미세조정
  const isExtremeVol = asset.atr14Pct != null && asset.atr14Pct > 4.5; // 극단 변동성 (위기 상황)
  const isHighVol = asset.atr14Pct != null && asset.atr14Pct > 3;
  const isMedVol = asset.atr14Pct != null && asset.atr14Pct >= 2 && asset.atr14Pct <= 3;
  const isLowVol = asset.atr14Pct != null && asset.atr14Pct < 1.2 && asset.atr14Pct >= 0.8;
  const isUltraLowVol = asset.atr14Pct != null && asset.atr14Pct < 0.8;
  const rsiOB = isExtremeVol ? 80 : isHighVol ? 76 : isMedVol ? 72 : isUltraLowVol ? 68 : isLowVol ? 70 : 73; // v4.1: 극단 78→80, 고변동 75→76
  const rsiOS = isExtremeVol ? 18 : isHighVol ? 23 : isMedVol ? 28 : isUltraLowVol ? 32 : isLowVol ? 30 : 27; // v4.1: 극단 20→18, 고변동 25→23 (패닉 반전 포착)
  if (asset.rsi != null) {
    if (asset.rsi >= 80) { momScore -= 18; signals.push({ type: "bearish", name: `RSI 극단 과매수 (${asset.rsi})` }); }
    else if (asset.rsi >= rsiOB) { momScore -= 12; signals.push({ type: "bearish", name: `RSI 과매수 (${asset.rsi}${isHighVol ? " · 고변동" : ""})` }); }
    else if (asset.rsi >= 65) momScore -= 4;
    else if (asset.rsi >= 55) momScore += 6;
    else if (asset.rsi >= 48) momScore += 2;  // v3.7: 중립 구간 축소 (48→55)
    else if (asset.rsi >= 42) momScore += 0;  // v3.7: 약세 중립 구간
    else if (asset.rsi >= 35) momScore += 4;  // v3.7: 약세 과매도 접근
    else if (asset.rsi >= rsiOS) { momScore += 10; signals.push({ type: "bullish", name: `RSI 과매도 (${asset.rsi}${isLowVol ? " · 저변동" : ""})` }); }
    else if (asset.rsi >= 20) { momScore += 16; signals.push({ type: "bullish", name: `RSI 강한 과매도 (${asset.rsi})` }); }
    else { momScore += 22; signals.push({ type: "bullish", name: `RSI 극단 과매도 (${asset.rsi})` }); }
    // v4.0: RSI 변화율 보너스 — 전주 대비 RSI 급반등/급락 시 추가 점수 (4단계, 중간 임계값 추가)
    if (asset.rsiPrev != null) {
      const rsiDelta = asset.rsi - asset.rsiPrev;
      if (rsiDelta > 20 && asset.rsi < 45) { momScore += 6; signals.push({ type: "bullish", name: `RSI 급반등 (+${rsiDelta.toFixed(0)})` }); }
      else if (rsiDelta > 15 && asset.rsi < 47) momScore += 5; // v4.0: 중간 반등 (15~20 갭 보완)
      else if (rsiDelta > 12 && asset.rsi < 50) momScore += 4; // 과매도→반등 가속
      else if (rsiDelta > 8 && asset.rsi < 40) momScore += 2; // 저RSI 완만 반등
      else if (rsiDelta < -20 && asset.rsi > 55) { momScore -= 6; signals.push({ type: "bearish", name: `RSI 급락 (${rsiDelta.toFixed(0)})` }); }
      else if (rsiDelta < -15 && asset.rsi > 53) momScore -= 5; // v4.0: 중간 하락 (15~20 갭 보완)
      else if (rsiDelta < -12 && asset.rsi > 50) momScore -= 4; // 과매수→하락 가속
      else if (rsiDelta < -8 && asset.rsi > 60) momScore -= 2; // 고RSI 완만 하락
    }
  }
  // v3.5: MACD 히스토그램 모멘텀 — 방향과 가속도 반영
  if (asset.macdHist != null && asset.macdHistPrev != null) {
    if (asset.macdHist > 0 && asset.macdHist > asset.macdHistPrev) momScore += 4; // 양의 가속
    else if (asset.macdHist < 0 && asset.macdHist < asset.macdHistPrev) momScore -= 4; // 음의 가속
    else if (asset.macdHist > 0) momScore += 2; // 양의 모멘텀
    else if (asset.macdHist < 0) momScore -= 2; // 음의 모멘텀
  }
  // MFI (거래량 가중 RSI) 추가 반영
  if (asset.mfi != null) {
    if (asset.mfi < 20) { momScore += 6; signals.push({ type: "bullish", name: `MFI 과매도 (${asset.mfi})` }); }
    else if (asset.mfi > 80) { momScore -= 6; signals.push({ type: "bearish", name: `MFI 과매수 (${asset.mfi})` }); }
  }
  if (asset.stoch?.k != null) {
    const sk = asset.stoch.k, sd = asset.stoch.d;
    if (sk < 20 && sd != null && sk > sd) { momScore += 8; signals.push({ type: "bullish", name: "스토캐스틱 과매도 반등" }); }
    else if (sk < 20) momScore += 5;
    if (sk > 80 && sd != null && sk < sd) { momScore -= 8; signals.push({ type: "bearish", name: "스토캐스틱 과매수 하락" }); }
    else if (sk > 80) momScore -= 5;
  }
  if (asset.wr != null) {
    if (asset.wr < -80) momScore += 4;
    if (asset.wr > -20) momScore -= 4;
  }
  // RSI 다이버전스 반영 — 반전 시그널이므로 모멘텀 점수에 영향
  if (asset.rsiDivType === "bullish") { momScore += 8; signals.push({ type: "bullish", name: "RSI 강세 다이버전스" }); }
  else if (asset.rsiDivType === "bearish") { momScore -= 8; signals.push({ type: "bearish", name: "RSI 약세 다이버전스" }); }
  // ── 다중 타임프레임 RSI 확인 (주간+일간 동시 과매도/과매수) ──
  if (asset.rsi != null && asset.dailyRsi != null) {
    if (asset.rsi <= 30 && asset.dailyRsi <= 30) {
      momScore += 6; signals.push({ type: "bullish", name: `MTF RSI 동시 과매도 (W:${asset.rsi} D:${asset.dailyRsi})` });
    } else if (asset.rsi >= 70 && asset.dailyRsi >= 70) {
      momScore -= 6; signals.push({ type: "bearish", name: `MTF RSI 동시 과매수 (W:${asset.rsi} D:${asset.dailyRsi})` });
    }
  }
  momScore = Math.max(0, Math.min(100, momScore));

  // ── 수급: 거래량 + 가격-거래량 상관 ──
  // 거래량 클라이맥스 — 방향 구분 (매집 vs 투매)
  if (asset.volRatio >= 3 && asset.weekChange > 0) { supScore += 18; signals.push({ type: "bullish", name: `거래량 폭증 매집 (${asset.volRatio.toFixed(1)}x)` }); }
  else if (asset.volRatio >= 3 && asset.weekChange < 0) { supScore -= 15; signals.push({ type: "bearish", name: `거래량 폭증 투매 (${asset.volRatio.toFixed(1)}x)` }); }
  else if (asset.volRatio >= 3) { supScore += 5; signals.push({ type: "neutral", name: `거래량 폭증 (${asset.volRatio.toFixed(1)}x)` }); }
  else if (asset.volRatio >= 2 && asset.weekChange > 0) { supScore += 14; signals.push({ type: "bullish", name: `거래량 급증 (${asset.volRatio.toFixed(1)}x)` }); }
  else if (asset.volRatio >= 2 && asset.weekChange < 0) { supScore -= 10; signals.push({ type: "bearish", name: `거래량 급증 하락 (${asset.volRatio.toFixed(1)}x)` }); }
  else if (asset.volRatio >= 2) supScore += 4;
  else if (asset.volRatio >= 1.5) supScore += 8;
  else if (asset.volRatio >= 1.0) supScore += 2;
  else if (asset.volRatio <= 0.3) {
    // v3.7: 거래량 극감 + BB 스퀴즈 = 돌파 임박 (방향 불명이므로 중립 점수, 시그널만)
    if (asset.bbWidth != null && asset.bbWidth < 0.08) { supScore += 2; signals.push({ type: "neutral", name: "거래량 극감 + BB스퀴즈 (돌파 임박)" }); }
    else { supScore -= 12; signals.push({ type: "neutral", name: "거래량 극감" }); }
  }
  else if (asset.volRatio <= 0.5) supScore -= 6;
  // 가격-거래량 상관
  if (asset.weekChange > 0 && asset.volRatio > 1.3) { supScore += 8; signals.push({ type: "bullish", name: "가격↑ + 거래량↑" }); }
  if (asset.weekChange < 0 && asset.volRatio > 1.5) { supScore -= 10; signals.push({ type: "bearish", name: "가격↓ + 거래량↑ (투매)" }); }
  if (asset.weekChange > 0 && asset.volRatio < 0.7) supScore -= 4; // 미확인 상승
  // CMF (Chaikin Money Flow) 추가 반영
  if (asset.cmf != null) {
    if (asset.cmf > 0.15) { supScore += 10; signals.push({ type: "bullish", name: `CMF 강한 매집 (${asset.cmf.toFixed(2)})` }); }
    else if (asset.cmf > 0.05) supScore += 5;
    else if (asset.cmf < -0.15) { supScore -= 10; signals.push({ type: "bearish", name: `CMF 강한 분산 (${asset.cmf.toFixed(2)})` }); }
    else if (asset.cmf < -0.05) supScore -= 5;
  }
  // ADX 방향성 추가 반영 (추세 점수에도)
  if (asset.adxBullish) { trendScore = Math.min(100, trendScore + 5); supScore += 3; }
  if (asset.adxBearish) { trendScore = Math.max(0, trendScore - 5); supScore -= 3; }
  // OBV 다이버전스 방향성 반영 (v6.8: 스마트머니 방향 포착)
  if (asset.obvDivType === "bullish") { supScore += 7; signals.push({ type: "bullish", name: "OBV 강세 다이버전스 (매집)" }); }
  else if (asset.obvDivType === "bearish") { supScore -= 7; signals.push({ type: "bearish", name: "OBV 약세 다이버전스 (분산)" }); }
  // ── v6.9.1: 복합 다이버전스 보너스 (MACD + RSI + OBV 정렬 시 고신뢰 시그널) ──
  const bullDivCount = [asset.macdDivType === "bullish", asset.rsiDivType === "bullish", asset.obvDivType === "bullish"].filter(Boolean).length;
  const bearDivCount = [asset.macdDivType === "bearish", asset.rsiDivType === "bearish", asset.obvDivType === "bearish"].filter(Boolean).length;
  if (bullDivCount >= 3) {
    supScore += 12; momScore = Math.min(100, momScore + 8);
    signals.push({ type: "bullish", name: `⚡ 3중 강세 다이버전스 (MACD+RSI+OBV)` });
  } else if (bullDivCount === 2) {
    supScore += 6; momScore = Math.min(100, momScore + 4);
    signals.push({ type: "bullish", name: `복합 강세 다이버전스 (${[asset.macdDivType === "bullish" && "MACD", asset.rsiDivType === "bullish" && "RSI", asset.obvDivType === "bullish" && "OBV"].filter(Boolean).join("+")})`});
  }
  if (bearDivCount >= 3) {
    supScore -= 12; momScore = Math.max(0, momScore - 8);
    signals.push({ type: "bearish", name: `⚡ 3중 약세 다이버전스 (MACD+RSI+OBV)` });
  } else if (bearDivCount === 2) {
    supScore -= 6; momScore = Math.max(0, momScore - 4);
    signals.push({ type: "bearish", name: `복합 약세 다이버전스 (${[asset.macdDivType === "bearish" && "MACD", asset.rsiDivType === "bearish" && "RSI", asset.obvDivType === "bearish" && "OBV"].filter(Boolean).join("+")})`});
  }
  supScore = Math.max(0, Math.min(100, supScore));

  // ── 가격위치: 52주 세분화 ──
  if (asset.low52w && asset.high52w) {
    const range = asset.high52w - asset.low52w;
    const pos52 = range > 0 ? ((asset.price - asset.low52w) / range) * 100 : 50;
    if (pos52 <= 10) { posScore += 18; signals.push({ type: "bullish", name: `52주 최저점 (${pos52.toFixed(0)}%)` }); }
    else if (pos52 <= 20) { posScore += 12; signals.push({ type: "bullish", name: `52주 저점대 (${pos52.toFixed(0)}%)` }); }
    else if (pos52 <= 40) posScore += 5;
    else if (pos52 >= 95 && !(pos52 >= 98 && asset.weekChange > 0)) { posScore -= 5; signals.push({ type: "neutral", name: `52주 최고점 (${pos52.toFixed(0)}%)` }); }
    else if (pos52 >= 85) posScore -= 2;
    const fromHigh = ((asset.price - asset.high52w) / asset.high52w) * 100;
    if (fromHigh < -40) { posScore += 12; signals.push({ type: "bullish", name: `고점 대비 ${fromHigh.toFixed(0)}%` }); }
    else if (fromHigh < -25) posScore += 6;
    // 신고가
    if (pos52 >= 98 && asset.weekChange > 0) { posScore += 8; signals.push({ type: "bullish", name: "52주 신고가 돌파" }); }
  }
  // 볼륨 프로파일 POC 근접 — 지지/저항 구간 강조
  if (asset.nearPOC && asset.pocPrice) {
    if (asset.weekChange > 0) { posScore += 6; signals.push({ type: "bullish", name: `VOL POC 지지 ($${asset.pocPrice})` }); }
    else if (asset.weekChange < 0) { posScore -= 4; signals.push({ type: "bearish", name: `VOL POC 저항 ($${asset.pocPrice})` }); }
    else { signals.push({ type: "neutral", name: `VOL POC 근접 ($${asset.pocPrice})` }); }
  }
  posScore = Math.max(0, Math.min(100, posScore));

  // ── 변동성 점수 (5th axis) ──
  let volScore = 50;
  if (asset.bbWidth != null) {
    if (asset.bbWidth < 0.05) { volScore += 12; signals.push({ type: "bullish", name: "BB 스퀴즈 (돌파 임박)" }); }
    else if (asset.bbWidth < 0.10) volScore += 5;
    else if (asset.bbWidth < 0.15) volScore += 2; // v4.0: 완만한 수축 구간 (기회 준비)
    else if (asset.bbWidth > 0.35) { volScore -= 12; signals.push({ type: "bearish", name: "BB 극단 확장 (고위험)" }); } // v4.0: 극단 확장 추가
    else if (asset.bbWidth > 0.25) { volScore -= 8; signals.push({ type: "neutral", name: "BB 확장 (높은 변동성)" }); }
  }
  if (asset.atr14Pct != null) {
    if (asset.atr14Pct > 5) volScore -= 10;
    else if (asset.atr14Pct > 3) volScore -= 5;
    else if (asset.atr14Pct < 1.5) volScore += 8;
  }
  volScore = Math.max(0, Math.min(100, volScore));

  // ── 펀더멘털 점수 (6th axis — 데이터 있을 때만 반영) ──
  let fundScore = 50;
  let hasFundData = false;
  // PER 밸류에이션
  const pe = asset.forwardPE || asset.trailingPE || asset.peRatio;
  if (pe != null && pe > 0) {
    hasFundData = true;
    if (pe < 10) { fundScore += 15; signals.push({ type: "bullish", name: `PER 매우 저평가 (${pe.toFixed(1)})` }); }
    else if (pe < 15) { fundScore += 8; signals.push({ type: "bullish", name: `PER 저평가 (${pe.toFixed(1)})` }); }
    else if (pe < 25) fundScore += 3;
    else if (pe < 35) fundScore -= 3;
    else if (pe < 50) { fundScore -= 8; signals.push({ type: "bearish", name: `PER 고평가 (${pe.toFixed(1)})` }); }
    else { fundScore -= 14; signals.push({ type: "bearish", name: `PER 극단 고평가 (${pe.toFixed(1)})` }); }
  }
  // 적정주가 괴리율 (fairPremium)
  if (asset.fairPremium != null) {
    hasFundData = true;
    if (asset.fairPremium < -15) { fundScore += 14; signals.push({ type: "bullish", name: `적정가 대비 ${asset.fairPremium}% 저평가` }); }
    else if (asset.fairPremium < -5) fundScore += 6;
    else if (asset.fairPremium > 15) { fundScore -= 12; signals.push({ type: "bearish", name: `적정가 대비 +${asset.fairPremium}% 고평가` }); }
    else if (asset.fairPremium > 5) fundScore -= 5;
  }
  // 영업이익률 (operatingMargin)
  if (asset.operatingMargin != null) {
    hasFundData = true;
    if (asset.operatingMargin > 25) fundScore += 6;
    else if (asset.operatingMargin > 15) fundScore += 3;
    else if (asset.operatingMargin < 0) fundScore -= 8;
    else if (asset.operatingMargin < 5) fundScore -= 3;
  }
  // 매출 성장률 (YoY)
  if (asset.revGrowthYoY != null) {
    hasFundData = true;
    if (asset.revGrowthYoY > 30) { fundScore += 10; signals.push({ type: "bullish", name: `매출 YoY +${asset.revGrowthYoY}%` }); }
    else if (asset.revGrowthYoY > 10) fundScore += 5;
    else if (asset.revGrowthYoY < -10) { fundScore -= 8; signals.push({ type: "bearish", name: `매출 YoY ${asset.revGrowthYoY}%` }); }
    else if (asset.revGrowthYoY < 0) fundScore -= 3;
  }
  // ROE
  if (asset.roe != null) {
    hasFundData = true;
    if (asset.roe > 0.2) fundScore += 5;
    else if (asset.roe > 0.1) fundScore += 2;
    else if (asset.roe < 0) fundScore -= 6;
  }
  // ── Piotroski F-Score 프록시 (재무 건전성 종합 평가) v3.8 ──
  let fScoreProxy = 0;
  if (asset.operatingMargin != null && asset.operatingMargin > 0) fScoreProxy++; // 영업이익 양수
  if (asset.roe != null && asset.roe > 0) fScoreProxy++; // ROE 양수
  if (asset.revGrowthYoY != null && asset.revGrowthYoY > 0) fScoreProxy++; // 매출 성장
  if (asset.operatingMargin != null && asset.operatingMarginPrev != null && asset.operatingMargin > asset.operatingMarginPrev) fScoreProxy++; // 마진 개선
  if (asset.debtToEquity != null && asset.debtToEquity < 100) fScoreProxy++; // 저부채
  if (asset.currentRatio != null && asset.currentRatio > 1) fScoreProxy++; // 유동비율 건전
  if (pe != null && pe > 0 && pe < 25) fScoreProxy++; // 합리적 밸류에이션
  if (fScoreProxy >= 6) { fundScore += 10; signals.push({ type: "bullish", name: `F-Score ${fScoreProxy}/7 (재무 우량)` }); }
  else if (fScoreProxy >= 5) { fundScore += 5; }
  else if (fScoreProxy <= 2) { fundScore -= 8; signals.push({ type: "bearish", name: `F-Score ${fScoreProxy}/7 (재무 취약)` }); }
  else if (fScoreProxy <= 3) { fundScore -= 4; }

  // ── 추세-펀더멘털 교차 검증 (기술적 vs 기본적 괴리 감지) v3.8 ──
  if (hasFundData && fundScore >= 65 && trendScore <= 35) {
    signals.push({ type: "neutral", name: "펀더멘털↑ vs 추세↓ (역행)", detail: "기본적 분석은 양호하나 기술적 하락 중 — 바닥 확인 후 매수 검토" });
  } else if (hasFundData && fundScore <= 35 && trendScore >= 65) {
    signals.push({ type: "neutral", name: "펀더멘털↓ vs 추세↑ (과열)", detail: "기술적 상승 중이나 기본적 분석 취약 — 차익실현 고려" });
  }

  fundScore = Math.max(0, Math.min(100, fundScore));

  // ── 종합 점수 (6축 가중 합산 — 시장유형 + 변동성 레짐 적응 가중치) v3.8 ──
  const mkt = asset.market || "us";
  const volRegime = isExtremeVol ? "extreme" : isHighVol ? "high" : isMedVol ? "med" : isLowVol ? "low" : "normal";
  let w, totalScore;
  if (hasFundData) {
    // v4.0: 변동성 레짐 3단계 가중치 (고/중/저) — 중간 변동성 독립 프로파일 추가
    // 고변동 시: 수급·변동성 가중치 ↑, 추세 가중치 ↓ (추세가 빠르게 변하므로)
    if (volRegime === "extreme" || volRegime === "high") {
      w = mkt === "crypto" ? { t: 0.14, m: 0.20, s: 0.24, p: 0.10, v: 0.12, f: 0.20 }
        : mkt === "kr"     ? { t: 0.16, m: 0.18, s: 0.20, p: 0.10, v: 0.12, f: 0.24 } // v4.0: KR 모멘텀 16→18, 펀더 26→24
        :                    { t: 0.18, m: 0.16, s: 0.18, p: 0.12, v: 0.12, f: 0.24 };
    } else if (volRegime === "med") {
      // v4.0: 중간 변동성 독립 가중치 — 추세·모멘텀 균형, 변동성 중간 반영
      w = mkt === "crypto" ? { t: 0.16, m: 0.21, s: 0.23, p: 0.10, v: 0.10, f: 0.20 }
        : mkt === "kr"     ? { t: 0.18, m: 0.18, s: 0.19, p: 0.10, v: 0.09, f: 0.26 }
        :                    { t: 0.20, m: 0.16, s: 0.16, p: 0.12, v: 0.10, f: 0.26 };
    } else {
      w = mkt === "crypto" ? { t: 0.18, m: 0.22, s: 0.22, p: 0.10, v: 0.08, f: 0.20 }
        : mkt === "kr"     ? { t: 0.20, m: 0.18, s: 0.18, p: 0.10, v: 0.08, f: 0.26 } // v4.0: KR 모멘텀 16→18, 펀더 28→26
        :                    { t: 0.22, m: 0.16, s: 0.14, p: 0.13, v: 0.08, f: 0.27 };
    }
    totalScore = Math.round(trendScore * w.t + momScore * w.m + supScore * w.s + posScore * w.p + volScore * w.v + fundScore * w.f);
  } else {
    // 기술적 지표만 (5축) — 변동성 레짐 3단계 적응
    if (volRegime === "extreme" || volRegime === "high") {
      w = mkt === "crypto" ? { t: 0.18, m: 0.26, s: 0.26, p: 0.14, v: 0.16 } // v4.0: crypto 수급 28→26, 위치 12→14
        : mkt === "kr"     ? { t: 0.22, m: 0.24, s: 0.24, p: 0.12, v: 0.18 } // v4.0: KR 모멘텀 22→24, 수급 26→24
        :                    { t: 0.24, m: 0.22, s: 0.22, p: 0.16, v: 0.16 };
    } else if (volRegime === "med") {
      // v4.0: 중간 변동성 독립 가중치 (5축)
      w = mkt === "crypto" ? { t: 0.20, m: 0.27, s: 0.27, p: 0.13, v: 0.13 }
        : mkt === "kr"     ? { t: 0.25, m: 0.23, s: 0.24, p: 0.13, v: 0.15 }
        :                    { t: 0.27, m: 0.22, s: 0.20, p: 0.17, v: 0.14 };
    } else {
      w = mkt === "crypto" ? { t: 0.22, m: 0.28, s: 0.28, p: 0.12, v: 0.10 }
        : mkt === "kr"     ? { t: 0.28, m: 0.22, s: 0.25, p: 0.13, v: 0.12 }
        :                    { t: 0.30, m: 0.22, s: 0.18, p: 0.18, v: 0.12 };
    }
    totalScore = Math.round(trendScore * w.t + momScore * w.m + supScore * w.s + posScore * w.p + volScore * w.v);
  }

  // v4.0: 변동성 레짐 적응 판정 임계값 — 고변동 시 매수 기준 상향, 중간 변동성 +1
  const buyThresholdAdj = (volRegime === "extreme" || volRegime === "high") ? 3 : volRegime === "med" ? 1 : 0;
  let verdict;
  if (totalScore >= 80 + buyThresholdAdj) verdict = "적극 매수";
  else if (totalScore >= 68 + buyThresholdAdj) verdict = "매수";
  else if (totalScore >= 58 + Math.floor(buyThresholdAdj / 2)) verdict = "매수 우위";
  else if (totalScore >= 42) verdict = "중립";
  else if (totalScore >= 32) verdict = "매도 우위";
  else if (totalScore >= 20) verdict = "매도";
  else verdict = "적극 매도";

  // ── 투자 의견 ──
  let opinion, opinionColor, rationale;
  const bullSigs = signals.filter(s => s.type === "bullish");
  const bearSigs = signals.filter(s => s.type === "bearish");
  if (totalScore >= 68) {
    opinion = "매수";
    opinionColor = "green";
    rationale = bullSigs.slice(0, 2).map(s => s.name).join(", ") || "상승 신호 우세";
  } else if (totalScore >= 58) {
    opinion = "매수 관망";
    opinionColor = "green";
    rationale = bullSigs.length > bearSigs.length
      ? `${bullSigs[0]?.name || "상승 신호"} 확인 중` : "상승 신호 있으나 확인 필요";
  } else if (totalScore >= 42) {
    opinion = "중립";
    opinionColor = "yellow";
    rationale = bullSigs.length > 0 && bearSigs.length > 0
      ? `${bullSigs[0]?.name} vs ${bearSigs[0]?.name}` : "방향성 불분명 — 추가 데이터 대기";
  } else if (totalScore >= 32) {
    opinion = "매도 관망";
    opinionColor = "red";
    rationale = bearSigs.length > bullSigs.length
      ? `${bearSigs[0]?.name || "하락 신호"} 주의` : "하락 신호 있으나 확인 필요";
  } else {
    opinion = "매도";
    opinionColor = "red";
    rationale = bearSigs.slice(0, 2).map(s => s.name).join(", ") || "하락 신호 우세";
  }

  // 핵심 시그널 요약 (최대 4개)
  const keySignals = signals.slice(0, 4).map(s => s.name);

  const categories = [
    { name: "추세", score: trendScore },
    { name: "모멘텀", score: momScore },
    { name: "수급", score: supScore },
    { name: "위치", score: posScore },
    { name: "변동성", score: volScore },
  ];
  if (hasFundData) categories.push({ name: "펀더멘털", score: fundScore });

  return { score: totalScore, verdict, opinion, opinionColor, rationale, signals, keySignals, categories, hasFundData };
}

// ── 표시용 상태 라벨 (표현 3원칙: 행동 지시 → 상태 서술) ─────────────
// quickDiagnosis 의 verdict 밴드를 사용자 화면·공유 텍스트가 공유하는 단일 매핑.
// "매수/매도" 같은 행동 지시 대신 신호 상태만 서술합니다 (유사투자자문 리스크 + 대표 지시).
// ★ i18n: verdict 내부 값(한국어)은 quickDiagnosis 의 시맨틱 키로 유지하고,
//   표시 문자열만 t() 로 로케일화합니다. t 미전달 시 기존 한국어 폴백(하위 호환).
const VERDICT_LABEL_KEYS = {
  "적극 매수": ["strongUp", "상승 신호 강함"],
  "매수": ["up", "상승 신호 우세"],
  "매수 우위": ["slightUp", "상승 신호 다소 우세"],
  "매수 관망": ["slightUp", "상승 신호 다소 우세"], // opinion 밴드(58~68)도 동일 어휘로 서술
  "중립": ["neutral", "중립"],
  "매도 관망": ["slightDown", "하락 신호 다소 우세"],
  "매도 우위": ["slightDown", "하락 신호 다소 우세"],
  "매도": ["down", "하락 신호 우세"],
  "적극 매도": ["strongDown", "하락 신호 강함"],
};
function verdictLabel(verdict, t) {
  const entry = VERDICT_LABEL_KEYS[verdict];
  if (!entry) return verdict || (t ? t("diag.verdictLabel.neutral") : "중립");
  return t ? t(`diag.verdictLabel.${entry[0]}`) : entry[1];
}

// 진단 카테고리(6축) 표시 라벨 — quickDiagnosis 의 한국어 축 이름은 내부 키로 유지,
// 렌더 시에만 로케일 라벨로 변환합니다.
const DIAG_CAT_KEYS = {
  "추세": "trend", "모멘텀": "momentum", "수급": "flow",
  "위치": "position", "변동성": "volatility", "펀더멘털": "fundamental",
};
function catLabel(name, t) {
  const k = DIAG_CAT_KEYS[name];
  return k && t ? t(`diag.cat.${k}`) : name;
}

// ════════════════════════════════════════════════════════════════════
// 매수 진입 가격 레벨 계산 (3단계 진입 전략)
// ════════════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════════════
// 경제지표 해석 가이드 (2026-06-12 대표 지시 — "그래서 호재야 악재야?" 명확한 해석)
//   방향성 결론은 명확히, 권유 어휘는 금지(참고용 면책 동반) — 컴플라이언스 정합.
// ════════════════════════════════════════════════════════════════════
const ECON_GUIDE = {
  CPI:   { ko: "소비자물가지수", desc: "미국 소비자가 체감하는 물가 상승률. 연준 금리 결정의 핵심 근거가 되는 인플레이션 대표 지표예요.", inverted: true,
           high: "물가가 예상보다 뜨겁다 → 금리 인하가 멀어진다 → 주식·코인에 통상 악재", low: "물가 둔화 → 금리 인하 기대 강화 → 통상 호재" },
  PCE:   { ko: "개인소비지출 물가", desc: "연준이 공식적으로 가장 중시하는 물가 지표. CPI와 같은 인플레이션 계열이에요.", inverted: true,
           high: "물가 압력 지속 → 긴축 우려 → 통상 악재", low: "물가 둔화 → 금리 인하 기대 → 통상 호재" },
  PPI:   { ko: "생산자물가지수", desc: "기업이 받는 도매 물가. 소비자물가(CPI)의 선행 지표로 읽혀요.", inverted: true,
           high: "생산 단계 물가 상승 → 인플레 재점화 우려 → 통상 악재", low: "물가 압력 완화 → 통상 호재" },
  FOMC:  { ko: "연준 금리 결정", desc: "미국 중앙은행(연준)의 기준금리 결정. 글로벌 자산시장 방향을 좌우하는 최대 이벤트예요.", inverted: true,
           high: "예상보다 높은 금리(매파) → 유동성 축소 → 통상 악재", low: "예상보다 낮은 금리·인하(비둘기) → 유동성 확대 → 통상 호재",
           note: "예상에 부합하면 금리 자체보다 성명서·점도표(향후 경로)가 시장을 움직여요." },
  NFP:   { ko: "비농업 고용", desc: "미국에서 한 달간 늘어난 일자리 수. 경기 체력을 보여주는 대표 고용 지표예요.",
           high: "고용 호조 → 경기 탄탄 → 통상 호재", low: "고용 둔화 → 경기 침체 우려 → 통상 악재",
           note: "단, 지나친 호조는 '금리 인하 지연' 우려로 반대로 움직일 때도 있어요." },
  GDP:   { ko: "국내총생산", desc: "미국 경제 전체의 성장률. 경기 방향의 종합 성적표예요.",
           high: "성장 견조 → 기업 실적 기대 → 통상 호재", low: "성장 둔화 → 침체 우려 → 통상 악재",
           note: "과열 수준의 서프라이즈는 금리 부담으로 해석되기도 해요." },
  RETAIL:{ ko: "소매판매", desc: "미국 소비자들의 지출 규모. 미국 경제의 70%를 차지하는 소비 경기를 직접 보여줘요.",
           high: "소비 견조 → 경기 호조 → 통상 호재", low: "소비 위축 → 경기 둔화 우려 → 통상 악재",
           note: "인플레 국면에선 '소비 과열 → 금리 부담'으로 반대 해석될 수 있어요." },
  ISM:   { ko: "ISM 제조업 지수", desc: "제조업 구매관리자들의 체감 경기. 50 위면 확장, 아래면 위축이에요.",
           high: "제조업 확장 → 경기 호조 → 통상 호재", low: "제조업 위축 → 경기 둔화 → 통상 악재" },
  UNEMP: { ko: "실업률", desc: "일자리를 구하지 못한 사람의 비율. 낮을수록 고용시장이 튼튼하다는 뜻이에요.", inverted: true,
           high: "실업 증가 → 경기 둔화 우려 → 통상 악재", low: "고용 탄탄 → 경기 호조 → 통상 호재" },
  CLAIMS:{ ko: "신규 실업수당 청구", desc: "한 주간 새로 실업수당을 신청한 사람 수. 고용시장의 주간 속보예요.", inverted: true,
           high: "실업 신청 증가 → 고용 악화 신호 → 통상 악재", low: "실업 신청 감소 → 고용 탄탄 → 통상 호재" },
  OTHER: { ko: "경제지표", desc: "미국 주요 경제지표예요. 예상치와의 차이(서프라이즈)가 시장을 움직여요.",
           high: "예상 상회 → 경기 호조 신호 → 통상 호재", low: "예상 하회 → 경기 둔화 신호 → 통상 악재" },
};

// 발표 후: 발표치 vs 예측치 → 위험자산 관점 결론 (호재/악재/중립)
// ★ i18n: t 를 넘기면 라벨·해설을 로케일 사전(tabs.econCalendar.*)에서 읽고,
//   tone("good"|"bad"|"neutral") 토큰으로 색 분기합니다(문자열 비교 제거).
function econVerdict(evt, t) {
  const gType = ECON_GUIDE[evt.type] ? evt.type : "OTHER";
  const g = ECON_GUIDE[gType];
  if (evt.actual == null || evt.estimate == null) return null;
  const gk = (field) => (t ? t(`tabs.econCalendar.guide.${gType}.${field}`) : g[field === "name" ? "ko" : field]);
  const noteStr = g.note ? gk("note") : null;
  // 동일(또는 ±0.5% 이내) → 예상 부합
  const base = Math.abs(evt.estimate) > 1e-9 ? Math.abs(evt.estimate) : 1;
  const surprise = (evt.actual - evt.estimate) / base;
  if (Math.abs(surprise) < 0.005) return { tone: "neutral", dir: t ? t("tabs.econCalendar.verdictNeutral") : "중립", emoji: "⚖️", reason: (t ? t("tabs.econCalendar.verdictMatch") : "예상치에 부합 — 서프라이즈 없음") + (noteStr ? `. ${noteStr}` : "") };
  const higher = evt.actual > evt.estimate;
  const good = g.inverted ? !higher : higher;
  return {
    tone: good ? "good" : "bad",
    dir: good ? (t ? t("tabs.econCalendar.verdictGood") : "통상 호재") : (t ? t("tabs.econCalendar.verdictBad") : "통상 악재"),
    emoji: good ? "📈" : "📉",
    reason: higher ? gk("high") : gk("low"),
    note: noteStr,
  };
}

function calcBuyLevels(asset, t) {
  // ★ i18n: t 가 있으면 사유·요약을 로케일 사전(diag.buyLevels.*)에서 읽습니다(ko 폴백 유지).
  const L = (key, fallback, params) => (t ? t(`diag.buyLevels.${key}`, params) : fallback);
  // 필요한 데이터 추출
  const currentPrice = asset.price || 0;
  const ma50 = asset.ma50 || null;
  const ma200 = asset.ma200 || null;
  const weeklyHigh = asset.high52w || asset.weeklyHigh52 || null;
  const weeklyLow = asset.low52w || asset.weeklyLow52 || null;

  if (!currentPrice || currentPrice <= 0) {
    return {
      levels: [],
      summary: L("noPrice", "현재가 정보 부재로 주요 지지 구간 계산 불가")
    };
  }

  const levels = [];
  let confidenceL1 = 0, confidenceL2 = 0, confidenceL3 = 0;

  // ── Level 1: "적극 매수" (Aggressive Entry) ──
  // 근처 지지선 기반
  let priceL1 = null;
  let rationaleL1 = "";

  if (ma50 && currentPrice > ma50) {
    priceL1 = ma50;
    rationaleL1 = L("ma50Bounce", "50일 이동평균선(MA50) 반등 진입");
    confidenceL1 = 75;
  } else if (weeklyLow && weeklyLow > 0) {
    // 52주 저점 기반: 현재가 대비 3% 하락
    priceL1 = Math.max(weeklyLow, currentPrice * 0.97);
    rationaleL1 = L("near52wLow", "52주 저점 근처 강한 지지");
    confidenceL1 = 70;
  } else {
    // 최근 저점 기반: 3% 풀백
    priceL1 = currentPrice * 0.97;
    rationaleL1 = L("recentLowBounce", "최근 저점 반등 기회");
    confidenceL1 = 55;
  }

  if (priceL1 && priceL1 < currentPrice) {
    const distanceFromCurrent = ((currentPrice - priceL1) / currentPrice) * 100;
    const distanceConfidence = Math.max(0, 100 - distanceFromCurrent * 5);
    confidenceL1 = Math.min(100, Math.round((confidenceL1 + distanceConfidence) / 2));

    levels.push({
      price: Math.round(priceL1 * 100) / 100,
      label: L("supportN", "1차 지지", { n: 1 }),
      type: "aggressive",
      confidence: confidenceL1,
      rationale: rationaleL1,
      discount: Math.round(((currentPrice - priceL1) / currentPrice) * 1000) / 10
    });
  }

  // ── Level 2: "분할 매수" (Scale-in Entry) ──
  // 중기 지지선
  let priceL2 = null;
  let rationaleL2 = "";

  if (ma200 && ma200 < currentPrice) {
    priceL2 = ma200;
    rationaleL2 = L("ma200Support", "200일 이동평균선(MA200) 지지");
    confidenceL2 = 80;
  } else if (weeklyHigh && weeklyLow && weeklyHigh > weeklyLow) {
    // Fibonacci 38.2% 되돌림
    const fibLevel = weeklyLow + (weeklyHigh - weeklyLow) * 0.382;
    if (fibLevel < currentPrice) {
      priceL2 = fibLevel;
      rationaleL2 = L("fib382", "피보나치 38.2% 되돌림 레벨");
      confidenceL2 = 65;
    } else {
      priceL2 = currentPrice * 0.92;
      rationaleL2 = L("pullback8", "중기 조정 목표 8% 풀백");
      confidenceL2 = 50;
    }
  } else {
    // 폴백: 8% 풀백
    priceL2 = currentPrice * 0.92;
    rationaleL2 = L("pullback8", "중기 조정 목표 8% 풀백");
    confidenceL2 = 50;
  }

  if (priceL2 && priceL2 < currentPrice) {
    const distanceFromCurrent = ((currentPrice - priceL2) / currentPrice) * 100;
    const distanceConfidence = Math.max(0, 100 - distanceFromCurrent * 3);
    confidenceL2 = Math.min(100, Math.round((confidenceL2 + distanceConfidence) / 2));

    levels.push({
      price: Math.round(priceL2 * 100) / 100,
      label: L("supportN", "2차 지지", { n: 2 }),
      type: "scale-in",
      confidence: confidenceL2,
      rationale: rationaleL2,
      discount: Math.round(((currentPrice - priceL2) / currentPrice) * 1000) / 10
    });
  }

  // ── Level 3: "바닥 매수" (Bottom Fishing) ──
  // 깊은 가치 레벨
  let priceL3 = null;
  let rationaleL3 = "";

  if (weeklyHigh && weeklyLow && weeklyHigh > weeklyLow) {
    // Fibonacci 61.8% 되돌림 (주요 레벨)
    const fib618 = weeklyLow + (weeklyHigh - weeklyLow) * 0.618;
    if (fib618 < currentPrice) {
      priceL3 = fib618;
      rationaleL3 = L("fib618", "피보나치 61.8% 되돌림 (강력한 지지)");
      confidenceL3 = 85;
    } else {
      // 52주 저점 위 5%
      priceL3 = weeklyLow * 1.05;
      rationaleL3 = L("safeMargin5", "52주 저점 위 5% 안전 마진");
      confidenceL3 = 75;
    }
  } else if (weeklyLow && weeklyLow > 0) {
    priceL3 = weeklyLow * 1.05;
    rationaleL3 = L("safeMargin5", "52주 저점 위 5% 안전 마진");
    confidenceL3 = 75;
  } else {
    // 폴백: 15% 풀백
    priceL3 = currentPrice * 0.85;
    rationaleL3 = L("pullback15", "극단적 조정 목표 15% 풀백");
    confidenceL3 = 45;
  }

  if (priceL3 && priceL3 < currentPrice) {
    const distanceFromCurrent = ((currentPrice - priceL3) / currentPrice) * 100;
    const distanceConfidence = Math.max(0, 100 - distanceFromCurrent * 2);
    confidenceL3 = Math.min(100, Math.round((confidenceL3 + distanceConfidence) / 2));

    levels.push({
      price: Math.round(priceL3 * 100) / 100,
      label: L("supportN", "3차 지지", { n: 3 }),
      type: "bottom",
      confidence: confidenceL3,
      rationale: rationaleL3,
      discount: Math.round(((currentPrice - priceL3) / currentPrice) * 1000) / 10
    });
  }

  // ── 정렬·중복 정리 (2026-06-12 대표 피드백) ──
  //   방법론 순서(L1/L2/L3)로만 push 하면 '3차'가 '1차'보다 현재가에 가까운 역전이 생김
  //   (예: 피보 61.8% -2.4% < 52주저점 -3%). 현재가에 가까운 순(할인율 오름차순)으로
  //   정렬하고, 0.8%p 이내로 붙은 레벨은 신뢰도 높은 쪽만 남긴 뒤 1·2·3차 재라벨링.
  levels.sort((a, b) => a.discount - b.discount);
  for (let i = levels.length - 1; i > 0; i--) {
    if (Math.abs(levels[i].discount - levels[i - 1].discount) < 0.8) {
      const keep = levels[i].confidence >= levels[i - 1].confidence ? levels[i] : levels[i - 1];
      levels.splice(i - 1, 2, keep);
    }
  }
  levels.forEach((lv, i) => { lv.label = L("supportN", `${i + 1}차 지지`, { n: i + 1 }); });

  // ── 요약 문구 생성 ──
  let summary = "";
  if (levels.length === 3) {
    const minDiscount = Math.min(
      levels[0].discount,
      levels[1].discount,
      levels[2].discount
    );
    const maxDiscount = Math.max(
      levels[0].discount,
      levels[1].discount,
      levels[2].discount
    );
    summary = L("summaryRange", `현재가 대비 -${minDiscount.toFixed(1)}%~-${maxDiscount.toFixed(1)}% 영역에 주요 지지 구간 형성`, { min: minDiscount.toFixed(1), max: maxDiscount.toFixed(1) });
  } else if (levels.length > 0) {
    const discounts = levels.map(l => l.discount);
    const minDiscount = Math.min(...discounts);
    const maxDiscount = Math.max(...discounts);
    summary = L("summaryRange", `현재가 대비 -${minDiscount.toFixed(1)}%~-${maxDiscount.toFixed(1)}% 구간에 주요 지지 형성`, { min: minDiscount.toFixed(1), max: maxDiscount.toFixed(1) });
  } else {
    summary = L("noData", "충분한 데이터 부재로 주요 지지 구간 계산 불가");
  }

  return {
    levels: levels,
    summary: summary
  };
}

// ════════════════════════════════════════════════════════════════════
// 퀀트 전략 백테스팅 엔진 (10개 전략 → 종목별 상위 10개 추천)
// ════════════════════════════════════════════════════════════════════
function runBacktest(closes, highs, lows, volumes) {
  const n = closes.length;
  if (n < 60) return [];

  // ── 공통 지표 사전 계산 ──
  const sma = (arr, p, idx) => { if (idx < p - 1) return null; let s = 0; for (let i = idx - p + 1; i <= idx; i++) s += arr[i]; return s / p; };
  const ema = (arr, p) => { const k = 2 / (p + 1); const out = [arr[0]]; for (let i = 1; i < arr.length; i++) out.push(arr[i] * k + out[i - 1] * (1 - k)); return out; };
  const rsiArr = (arr, p = 14) => {
    const out = new Array(arr.length).fill(50);
    if (arr.length < p + 1) return out;
    let ag = 0, al = 0;
    for (let i = 1; i <= p; i++) { const d = arr[i] - arr[i - 1]; if (d > 0) ag += d; else al -= d; }
    ag /= p; al /= p;
    out[p] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
    for (let i = p + 1; i < arr.length; i++) {
      const d = arr[i] - arr[i - 1];
      ag = (ag * (p - 1) + (d > 0 ? d : 0)) / p;
      al = (al * (p - 1) + (d < 0 ? -d : 0)) / p;
      out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
    }
    return out;
  };
  const atrArr = (cls, hi, lo, p = 14) => {
    const tr = [hi[0] - lo[0]];
    for (let i = 1; i < cls.length; i++) tr.push(Math.max(hi[i] - lo[i], Math.abs(hi[i] - cls[i - 1]), Math.abs(lo[i] - cls[i - 1])));
    const out = [tr[0]];
    for (let i = 1; i < tr.length; i++) out.push(i < p ? tr.slice(0, i + 1).reduce((a, b) => a + b) / (i + 1) : (out[i - 1] * (p - 1) + tr[i]) / p);
    return out;
  };
  const bbArr = (arr, p = 20, k = 2) => {
    const mid = [], upper = [], lower = [];
    for (let i = 0; i < arr.length; i++) {
      if (i < p - 1) { mid.push(null); upper.push(null); lower.push(null); continue; }
      const sl = arr.slice(i - p + 1, i + 1);
      const m = sl.reduce((a, b) => a + b) / p;
      const std = Math.sqrt(sl.reduce((a, v) => a + (v - m) ** 2, 0) / p);
      mid.push(m); upper.push(m + k * std); lower.push(m - k * std);
    }
    return { mid, upper, lower };
  };

  const ema12 = ema(closes, 12), ema26 = ema(closes, 26);
  const macd = ema12.map((v, i) => v - ema26[i]);
  const macdSignal = ema(macd, 9);
  const rsi = rsiArr(closes, 14);
  const atr = atrArr(closes, highs, lows, 14);
  const bb = bbArr(closes, 20, 2);
  const sma20cache = closes.map((_, i) => sma(closes, 20, i));
  const sma50cache = closes.map((_, i) => sma(closes, 50, i));
  const sma200cache = closes.map((_, i) => sma(closes, 200, i));

  // ── 전략 백테스트 러너 ──
  function simulate(signalFn, name, desc) {
    let cash = 10000, shares = 0, trades = 0, wins = 0, maxVal = 10000, maxDD = 0;
    const equity = [];
    let entryPrice = 0;
    const startIdx = 60; // 워밍업

    for (let i = startIdx; i < n; i++) {
      const sig = signalFn(i);
      const price = closes[i];
      if (sig === 1 && cash > 0) { // 매수
        shares = cash / price; cash = 0; entryPrice = price; trades++;
      } else if (sig === -1 && shares > 0) { // 매도
        cash = shares * price; if (price > entryPrice) wins++; shares = 0;
      }
      const val = cash + shares * price;
      equity.push(val);
      if (val > maxVal) maxVal = val;
      const dd = (maxVal - val) / maxVal;
      if (dd > maxDD) maxDD = dd;
    }
    // 미결 포지션 청산
    if (shares > 0) { cash = shares * closes[n - 1]; if (closes[n - 1] > entryPrice) wins++; shares = 0; }
    const finalVal = cash;
    const totalReturn = ((finalVal - 10000) / 10000) * 100;
    const daysHeld = n - startIdx;
    const annReturn = daysHeld > 0 ? (Math.pow(finalVal / 10000, 252 / daysHeld) - 1) * 100 : 0;
    // 일간 수익률 → Sharpe
    const dailyRet = [];
    for (let i = 1; i < equity.length; i++) dailyRet.push((equity[i] - equity[i - 1]) / equity[i - 1]);
    const avgRet = dailyRet.length > 0 ? dailyRet.reduce((a, b) => a + b, 0) / dailyRet.length : 0;
    const stdRet = dailyRet.length > 1 ? Math.sqrt(dailyRet.reduce((a, v) => a + (v - avgRet) ** 2, 0) / (dailyRet.length - 1)) : 1;
    const sharpe = stdRet > 0 ? (avgRet / stdRet) * Math.sqrt(252) : 0;
    const winRate = trades > 0 ? (wins / trades) * 100 : 0;

    return { name, desc, totalReturn: +totalReturn.toFixed(1), annReturn: +annReturn.toFixed(1), sharpe: +sharpe.toFixed(2), maxDD: +(maxDD * 100).toFixed(1), winRate: +winRate.toFixed(0), trades };
  }

  const strategies = [
    // 1) 골든/데드 크로스 (SMA 50/200)
    simulate(i => {
      if (!sma50cache[i] || !sma50cache[i - 1] || !sma200cache[i]) return 0;
      if (sma50cache[i] > sma200cache[i] && sma50cache[i - 1] <= sma200cache[i - 1]) return 1;
      if (sma50cache[i] < sma200cache[i] && sma50cache[i - 1] >= sma200cache[i - 1]) return -1;
      return 0;
    }, "골든/데드크로스", "SMA 50이 SMA 200 상향돌파 시 매수, 하향돌파 시 매도"),

    // 2) RSI 역추세
    simulate(i => {
      if (rsi[i] < 30 && rsi[i - 1] >= 30) return 1; // 과매도 진입
      if (rsi[i] > 70 && rsi[i - 1] <= 70) return -1; // 과매수 청산
      return 0;
    }, "RSI 역추세", "RSI 30 하향돌파 시 매수, 70 상향돌파 시 매도"),

    // 3) MACD 크로스오버
    simulate(i => {
      if (macd[i] > macdSignal[i] && macd[i - 1] <= macdSignal[i - 1]) return 1;
      if (macd[i] < macdSignal[i] && macd[i - 1] >= macdSignal[i - 1]) return -1;
      return 0;
    }, "MACD 크로스", "MACD가 시그널선 상향돌파 시 매수, 하향돌파 시 매도"),

    // 4) 볼린저밴드 반전
    simulate(i => {
      if (!bb.lower[i]) return 0;
      if (closes[i] < bb.lower[i] && closes[i - 1] >= bb.lower[i - 1]) return 1;
      if (closes[i] > bb.upper[i] && closes[i - 1] <= bb.upper[i - 1]) return -1;
      return 0;
    }, "볼린저밴드 반전", "가격이 하한선 이탈 시 매수, 상한선 돌파 시 매도"),

    // 5) 이동평균 3중 필터 (EMA 12/26 + SMA 200)
    simulate(i => {
      if (!sma200cache[i]) return 0;
      if (closes[i] > sma200cache[i] && ema12[i] > ema26[i] && ema12[i - 1] <= ema26[i - 1]) return 1;
      if (ema12[i] < ema26[i] && ema12[i - 1] >= ema26[i - 1]) return -1;
      return 0;
    }, "3중 이평선 필터", "SMA200 위에서 EMA12>EMA26 돌파 시 매수"),

    // 6) ATR 돌파 (변동성 돌파)
    simulate(i => {
      if (i < 2) return 0;
      const range = atr[i - 1] * 1.5;
      if (closes[i] > closes[i - 1] + range) return 1;
      if (closes[i] < closes[i - 1] - range) return -1;
      return 0;
    }, "ATR 변동성 돌파", "전일 종가 대비 1.5×ATR 돌파 시 매수/매도"),

    // 7) 거래량 돌파 + 추세확인
    simulate(i => {
      if (i < 21) return 0;
      const avgVol = volumes.slice(i - 20, i).reduce((a, b) => a + b, 0) / 20;
      const volSpike = volumes[i] > avgVol * 2;
      if (volSpike && closes[i] > closes[i - 1] && sma20cache[i] && closes[i] > sma20cache[i]) return 1;
      if (volSpike && closes[i] < closes[i - 1] && sma20cache[i] && closes[i] < sma20cache[i]) return -1;
      return 0;
    }, "거래량 돌파", "2배 이상 거래량 급증 + 추세방향 확인 시 진입"),

    // 8) 평균 회귀 (SMA20 기준)
    simulate(i => {
      if (!sma20cache[i]) return 0;
      const dist = (closes[i] - sma20cache[i]) / sma20cache[i] * 100;
      if (dist < -5 && (closes[i] - closes[i - 1]) > 0) return 1; // 과이탈 후 반등
      if (dist > 5 && (closes[i] - closes[i - 1]) < 0) return -1; // 과이탈 후 하락
      return 0;
    }, "평균회귀 (SMA20)", "SMA20 대비 5%+ 이탈 후 반전 캔들 시 진입"),

    // 9) 듀얼 모멘텀 (절대+상대)
    simulate(i => {
      if (i < 63) return 0;
      const mom1m = (closes[i] - closes[i - 21]) / closes[i - 21];
      const mom3m = (closes[i] - closes[i - 63]) / closes[i - 63];
      if (mom1m > 0 && mom3m > 0.05) return 1;
      if (mom1m < -0.03 || mom3m < -0.05) return -1;
      return 0;
    }, "듀얼 모멘텀", "1개월+3개월 수익률 모두 양수일 때 매수"),

    // 10) RSI + MACD 복합
    simulate(i => {
      if (rsi[i] < 40 && macd[i] > macdSignal[i] && macd[i - 1] <= macdSignal[i - 1]) return 1;
      if (rsi[i] > 60 && macd[i] < macdSignal[i] && macd[i - 1] >= macdSignal[i - 1]) return -1;
      return 0;
    }, "RSI+MACD 복합", "RSI 저역에서 MACD 매수신호 시 진입, RSI 고역에서 매도신호 시 청산"),
  ];

  // Sharpe 기준 정렬 후 상위 10개
  return strategies
    .filter(s => s.trades >= 2 && s.sharpe > -0.5 && s.totalReturn > -30 && s.maxDD < 50)
    .sort((a, b) => {
      // 복합 스코어: Sharpe 40% + 수익률 30% + 승률 20% + MDD(역) 10%
      const scoreA = a.sharpe * 0.4 + (a.totalReturn / 50) * 0.3 + (a.winRate / 100) * 0.2 + ((50 - a.maxDD) / 50) * 0.1;
      const scoreB = b.sharpe * 0.4 + (b.totalReturn / 50) * 0.3 + (b.winRate / 100) * 0.2 + ((50 - b.maxDD) / 50) * 0.1;
      return scoreB - scoreA;
    })
    .slice(0, 10);
}

// ════════════════════════════════════════════════════════════════════
// 고급 지지/저항/목표가/손절가 엔진 (Multi-Model)
// ════════════════════════════════════════════════════════════════════
function calcAdvancedLevels(closes, highs, lows, volumes, techData, fairValue, analystTarget, analystHigh, analystLow) {
  const n = closes.length;
  const last = closes[n - 1];
  if (n < 30) return null;

  // ── ATR 계산 ──
  const tr = [highs[0] - lows[0]];
  for (let i = 1; i < n; i++) tr.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
  const atr14 = tr.slice(-14).reduce((a, b) => a + b, 0) / 14;

  // ── 피벗포인트 (Traditional + Fibonacci) ──
  const pH = highs[n - 1], pL = lows[n - 1], pC = closes[n - 1];
  const pivot = (pH + pL + pC) / 3;
  const pivotR1 = 2 * pivot - pL;
  const pivotS1 = 2 * pivot - pH;
  const pivotR2 = pivot + (pH - pL);
  const pivotS2 = pivot - (pH - pL);
  // 피보나치 피벗
  const fibR1 = pivot + 0.382 * (pH - pL);
  const fibR2 = pivot + 0.618 * (pH - pL);
  const fibS1 = pivot - 0.382 * (pH - pL);
  const fibS2 = pivot - 0.618 * (pH - pL);

  // ── 볼린저밴드 ──
  const sma20 = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const std20 = Math.sqrt(closes.slice(-20).reduce((a, v) => a + (v - sma20) ** 2, 0) / 20);
  const bbUpper = sma20 + 2 * std20;
  const bbLower = sma20 - 2 * std20;

  // ── 52주 피보나치 리트레이스먼트 ──
  const high52w = Math.max(...highs);
  const low52w = Math.min(...lows);
  const range52 = high52w - low52w;
  const fib236 = high52w - range52 * 0.236;
  const fib382 = high52w - range52 * 0.382;
  const fib500 = high52w - range52 * 0.500;
  const fib618 = high52w - range52 * 0.618;

  // ── 볼륨프로파일 (간이: 가격대별 거래량 집중구간) ──
  const priceStep = range52 / 20;
  const volProfile = new Array(20).fill(0);
  for (let i = Math.max(0, n - 60); i < n; i++) {
    const bin = Math.min(19, Math.floor((closes[i] - low52w) / priceStep));
    if (bin >= 0) volProfile[bin] += volumes[i] || 0;
  }
  // POC (Point of Control) = 최대 거래량 가격대
  const pocBin = volProfile.indexOf(Math.max(...volProfile));
  const poc = low52w + (pocBin + 0.5) * priceStep;
  // VAH/VAL (70% 거래량 범위)
  const totalVol = volProfile.reduce((a, b) => a + b, 0);
  let cumVol = 0, vahBin = pocBin, valBin = pocBin;
  const sortedBins = volProfile.map((v, i) => ({ v, i })).sort((a, b) => b.v - a.v);
  for (const b of sortedBins) { cumVol += b.v; if (b.i > vahBin) vahBin = b.i; if (b.i < valBin) valBin = b.i; if (cumVol >= totalVol * 0.7) break; }
  const vah = low52w + (vahBin + 1) * priceStep;
  const val_ = low52w + valBin * priceStep;

  // ── SMA 지지/저항 ──
  const sma50 = n >= 50 ? closes.slice(-50).reduce((a, b) => a + b, 0) / 50 : null;
  const sma200 = n >= 200 ? closes.slice(-200).reduce((a, b) => a + b, 0) / 200 : null;

  // ── 지지선 후보 수집 + 가중 점수 ──
  const supports = [];
  const addSup = (price, weight, source) => { if (price && price < last * 0.999 && price > last * 0.5) supports.push({ price, weight, source }); };
  addSup(pivotS1, 3, "피벗 S1");
  addSup(pivotS2, 2, "피벗 S2");
  addSup(fibS1, 2.5, "피보나치 피벗 S1");
  addSup(fibS2, 1.5, "피보나치 피벗 S2");
  addSup(bbLower, 2.5, "볼린저 하한");
  addSup(fib382, 3, "52주 Fib 38.2%");
  addSup(fib500, 2.5, "52주 Fib 50%");
  addSup(fib618, 3, "52주 Fib 61.8%");
  addSup(poc < last ? poc : null, 3.5, "볼륨 POC");
  addSup(val_, 2, "볼륨 VAL");
  addSup(sma50 && sma50 < last ? sma50 : null, 2.5, "SMA 50");
  addSup(sma200 && sma200 < last ? sma200 : null, 3, "SMA 200");
  addSup(last - atr14 * 2, 2, "ATR 2배");
  // 클러스터링: 가격이 비슷한 것 묶기 (2% 이내)
  supports.sort((a, b) => a.price - b.price);
  const supClusters = [];
  for (const s of supports) {
    const existing = supClusters.find(c => Math.abs(c.price - s.price) / s.price < 0.02);
    if (existing) { existing.weight += s.weight; existing.sources.push(s.source); existing.price = (existing.price * (existing.sources.length - 1) + s.price) / existing.sources.length; }
    else supClusters.push({ price: s.price, weight: s.weight, sources: [s.source] });
  }
  supClusters.sort((a, b) => b.weight - a.weight);

  // ── 저항선 후보 수집 + 가중 점수 ──
  const resists = [];
  const addRes = (price, weight, source) => { if (price && price > last * 1.001 && price < last * 2) resists.push({ price, weight, source }); };
  addRes(pivotR1, 3, "피벗 R1");
  addRes(pivotR2, 2, "피벗 R2");
  addRes(fibR1, 2.5, "피보나치 피벗 R1");
  addRes(fibR2, 1.5, "피보나치 피벗 R2");
  addRes(bbUpper, 2.5, "볼린저 상한");
  addRes(fib236, 3, "52주 Fib 23.6%");
  addRes(fib382 > last ? fib382 : null, 2.5, "52주 Fib 38.2%");
  addRes(poc > last ? poc : null, 3.5, "볼륨 POC");
  addRes(vah > last ? vah : null, 2, "볼륨 VAH");
  addRes(high52w, 2, "52주 고점");
  addRes(sma50 && sma50 > last ? sma50 : null, 2.5, "SMA 50");
  addRes(sma200 && sma200 > last ? sma200 : null, 3, "SMA 200");
  addRes(last + atr14 * 2, 1.5, "ATR 2배");
  resists.sort((a, b) => a.price - b.price);
  const resClusters = [];
  for (const r of resists) {
    const existing = resClusters.find(c => Math.abs(c.price - r.price) / r.price < 0.02);
    if (existing) { existing.weight += r.weight; existing.sources.push(r.source); existing.price = (existing.price * (existing.sources.length - 1) + r.price) / existing.sources.length; }
    else resClusters.push({ price: r.price, weight: r.weight, sources: [r.source] });
  }
  resClusters.sort((a, b) => b.weight - a.weight);

  // ── 목표가 (Multi-Model 가중평균) ──
  const targets = [];
  if (fairValue && fairValue > last) targets.push({ price: fairValue, weight: 4, source: "적정주가 모델" });
  if (analystTarget && analystTarget > last) targets.push({ price: analystTarget, weight: 5, source: "애널리스트" });
  if (analystHigh && analystHigh > last) targets.push({ price: analystHigh, weight: 2, source: "애널리스트 최고" });
  if (resClusters[0]) targets.push({ price: resClusters[0].price, weight: 3, source: resClusters[0].sources[0] });
  if (resClusters[1]) targets.push({ price: resClusters[1].price, weight: 1.5, source: resClusters[1].sources[0] });
  // ATR 기반 목표가 (추세 지속 시)
  if (techData?.weekChange > 0) targets.push({ price: last + atr14 * 3, weight: 2, source: "ATR 3배 목표" });
  let targetPrice = null, targetSources = [];
  if (targets.length > 0) {
    const tw = targets.reduce((s, t) => s + t.weight, 0);
    targetPrice = targets.reduce((s, t) => s + t.price * (t.weight / tw), 0);
    targetSources = targets.map(t => t.source);
  }

  // ── 손절가 (ATR + 지지선 하단) ──
  const stopCandidates = [];
  stopCandidates.push({ price: last - atr14 * 2, weight: 4, source: "ATR 2배" });
  if (supClusters[0]) stopCandidates.push({ price: supClusters[0].price * 0.98, weight: 3, source: `${supClusters[0].sources[0]} 하단` });
  if (supClusters[1]) stopCandidates.push({ price: supClusters[1].price * 0.98, weight: 2, source: `${supClusters[1].sources[0]} 하단` });
  if (analystLow) stopCandidates.push({ price: analystLow, weight: 2.5, source: "애널리스트 저점" });
  stopCandidates.push({ price: last * 0.92, weight: 1, source: "고정 -8%" });
  const sw = stopCandidates.reduce((s, c) => s + c.weight, 0);
  const stopLoss = stopCandidates.reduce((s, c) => s + c.price * (c.weight / sw), 0);
  const stopSources = stopCandidates.map(c => c.source);

  const support1 = supClusters[0] || null;
  const support2 = supClusters[1] || null;
  const resist1 = resClusters[0] || null;
  const resist2 = resClusters[1] || null;

  const upside = targetPrice ? +((targetPrice - last) / last * 100).toFixed(1) : null;
  const downside = +((last - stopLoss) / last * 100).toFixed(1);
  const riskReward = upside && downside > 0 ? +(upside / downside).toFixed(1) : null;

  return {
    targetPrice, targetSources,
    stopLoss, stopSources,
    support1, support2,
    resist1, resist2,
    upside, downside, riskReward,
    atr14, pivot, poc, bbUpper, bbLower,
    vah, val: val_,
  };
}

// ════════════════════════════════════════════════════════════════════
// 서브 컴포넌트: AssetCard
// ════════════════════════════════════════════════════════════════════
function AssetCard({ asset, onChart, isMobile = false }) {
  const { t } = useLanguage();
  const [expanded, setExpanded] = useState(false);
  const isPos = asset.weekChange >= 0;
  // 다크 전용 hex 하드코딩 → 테마 알파 틴트 (라이트 모드 대비 유지)
  const mcBg = asset.market === "us" ? `${C.blue}1A` : asset.market === "kr" ? `${C.green}1A` : `${C.purple}1A`;
  const mcColor = asset.market === "us" ? C.blue : asset.market === "kr" ? C.green : C.purple;
  const mcLabel = asset.market === "us" ? t("diag.market.us") : asset.market === "kr" ? t("diag.market.kr") : t("diag.market.crypto");

  // 퀵 진단 (항상 계산 — 카드 미리보기 + 정렬용)
  const diag = useMemo(() => quickDiagnosis(asset), [asset]);
  // ★ 2026-08 시안 1f: 악센트는 진단 방향(상태 서술)을 따릅니다 — 좌측 3px 보더 + 상단 그라데이션.
  const acc = accentOf(C, diag ? (diag.opinionColor === "green" ? "up" : diag.opinionColor === "red" ? "down" : "neutral") : "neutral");
  const chg = (
    <span className="z-num" style={{ fontFamily: MONO, fontVariantNumeric: "tabular-nums", fontSize: isMobile ? "12px" : "12.5px", fontWeight: 700, color: isPos ? (C.greenL || C.green) : (C.redL || C.red), whiteSpace: "nowrap" }}>
      {isPos ? "▲" : "▼"} {Math.abs(asset.weekChange)}%
    </span>
  );
  // 기존 정보 요소(시그널 트리거·복합 다이버전스·수급 미니) — 기능 유지, 시안 칩 문법으로 감쌈
  const extraChips = ((asset.triggers?.length > 0) || asset.macdDivType || asset.rsiDivType || asset.obvDivType
    || (asset.cmf != null && Math.abs(asset.cmf) > 0.05) || (asset.mfi != null && (asset.mfi < 25 || asset.mfi > 75))) && (
    <div style={{ display: "flex", gap: "5px", flexWrap: "wrap", alignItems: "center" }}>
      {(asset.triggers || []).map(t => <SignalTag key={t} triggerKey={t} asset={asset} />)}
      {/* v6.9.1: 복합 다이버전스 뱃지 */}
      {(() => {
        const bd = [asset.macdDivType === "bullish", asset.rsiDivType === "bullish", asset.obvDivType === "bullish"].filter(Boolean).length;
        const sd = [asset.macdDivType === "bearish", asset.rsiDivType === "bearish", asset.obvDivType === "bearish"].filter(Boolean).length;
        if (bd >= 2) return <span style={{ fontSize: "11px", fontWeight: 800, padding: "2px 7px", borderRadius: "6px", background: `${C.green}28`, color: C.green, border: `1px solid ${C.green}44`, lineHeight: 1.6 }}>{bd === 3 ? `⚡${t("diag.tripleBull")}` : t("diag.comboBull")}</span>;
        if (sd >= 2) return <span style={{ fontSize: "11px", fontWeight: 800, padding: "2px 7px", borderRadius: "6px", background: `${C.red}28`, color: C.red, border: `1px solid ${C.red}44`, lineHeight: 1.6 }}>{sd === 3 ? `⚡${t("diag.tripleBear")}` : t("diag.comboBear")}</span>;
        return null;
      })()}
      {/* 수급 미니 인디케이터 (CMF/MFI) */}
      {asset.cmf != null && (Math.abs(asset.cmf) > 0.05) && (
        <span title={`CMF: ${asset.cmf > 0 ? "+" : ""}${asset.cmf.toFixed(3)}`} style={{
          fontSize: "11px", fontWeight: 700, padding: "1px 6px", borderRadius: "4px", lineHeight: 1.6,
          background: asset.cmf > 0.1 ? `${C.green}22` : asset.cmf < -0.1 ? `${C.red}22` : `${C.yellow}18`,
          color: asset.cmf > 0.1 ? C.green : asset.cmf < -0.1 ? C.red : C.yellow,
        }}>{asset.cmf > 0 ? t("diag.accumulation") : t("diag.distribution")}</span>
      )}
      {asset.mfi != null && (asset.mfi < 25 || asset.mfi > 75) && (
        <span title={`MFI: ${asset.mfi}`} style={{
          fontSize: "11px", fontWeight: 700, padding: "1px 6px", borderRadius: "4px", lineHeight: 1.6,
          background: asset.mfi < 20 ? `${C.purple}22` : asset.mfi < 25 ? `${C.green}18` : asset.mfi > 80 ? `${C.red}22` : `${C.yellow}18`,
          color: asset.mfi < 20 ? C.purple : asset.mfi < 25 ? C.green : asset.mfi > 80 ? C.red : C.yellow,
        }}>{asset.mfi < 25 ? `${t("diag.flowShort")}▲` : `${t("diag.flowShort")}▼`}</span>
      )}
    </div>
  );
  // 점수 진행바 — 시안의 64px 미니 바(데스크탑) / 가변 폭(모바일)
  const scoreBar = (w) => diag && (
    <div style={{ width: w, flex: w ? undefined : 1, height: "5px", borderRadius: "3px", background: C.card2, overflow: "hidden" }}>
      <div style={{ width: `${Math.max(0, Math.min(100, diag.score))}%`, height: "100%", borderRadius: "3px", background: acc.base }} />
    </div>
  );

  // 펼침 진단 패널 — 기존 로직·내용 그대로. 모바일 카드/데스크탑 행 양쪽이 공용으로 씁니다.
  const expandedPanel = expanded && (
        <div style={{ borderTop: `1px solid ${C.border}`, padding: "14px 18px", background: C.card2 }}>
          {/* ── 투자진단 ── */}
          {diag && (
            <div style={{
              background: C.bg, borderRadius: "12px", padding: "14px", marginBottom: "12px",
              border: `1px solid ${C.border}`,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "12px" }}>
                {/* 점수 게이지 */}
                <div style={{ position: "relative", width: "56px", height: "56px", flexShrink: 0 }}>
                  <svg viewBox="0 0 56 56" width="56" height="56">
                    <circle cx="28" cy="28" r="23" fill="none" stroke={C.border} strokeWidth="5" />
                    <circle cx="28" cy="28" r="23" fill="none"
                      stroke={diag.score >= 70 ? C.green : diag.score >= 40 ? C.yellow : C.red}
                      strokeWidth="5" strokeLinecap="round"
                      strokeDasharray={`${(diag.score / 100) * 144.5} 144.5`}
                      transform="rotate(-90 28 28)"
                      style={{ transition: "stroke-dasharray 0.6s ease" }}
                    />
                    <text x="28" y="26" textAnchor="middle" fill={C.text1} fontSize="14" fontWeight="800">{diag.score}</text>
                    <text x="28" y="36" textAnchor="middle" fill={C.text3} fontSize="7">/100</text>
                  </svg>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "6px" }}>
                    <span style={{ fontSize: "16px", fontWeight: 700, color: C.text3 }}>🩺 {t("diag.signalSummary")}</span>
                    <span style={{
                      fontSize: "16px", fontWeight: 700,
                      color: diag.score >= 70 ? C.green : diag.score >= 40 ? C.yellow : C.red,
                    }}>{verdictLabel(diag.verdict, t)}</span>
                    <span style={{
                      fontSize: "15px", fontWeight: 700, padding: "2px 8px", borderRadius: "4px",
                      background: diag.opinionColor === "green" ? `${C.green}18` : diag.opinionColor === "red" ? `${C.red}18` : `${C.yellow}18`,
                      color: diag.opinionColor === "green" ? C.green : diag.opinionColor === "red" ? C.red : C.yellow,
                    }}>{verdictLabel(diag.opinion, t)}</span>
                  </div>
                  {/* 카테고리 미니 바 — ★ 2026-06-12 (대표 피드백): 라벨 폭 36→50px + 줄바꿈 방지
                      (모멘텀·펀더멘털이 '모멘↵텀'으로 깨지던 문제) */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: "8px 10px" }}>
                    {diag.categories.map(cat => (
                      <div key={cat.name} style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
                        <span style={{ fontSize: "13px", color: C.text3, width: "50px", flexShrink: 0, whiteSpace: "nowrap", wordBreak: "keep-all" }}>{catLabel(cat.name, t)}</span>
                        <div style={{ flex: 1, height: "4px", background: C.border, borderRadius: "4px", overflow: "hidden" }}>
                          <div style={{
                            height: "100%", borderRadius: "4px",
                            width: `${cat.score}%`,
                            background: cat.score >= 70 ? C.green : cat.score >= 40 ? C.yellow : C.red,
                            transition: "width 0.4s ease",
                          }} />
                        </div>
                        <span style={{ fontSize: "14px", fontWeight: 700, color: C.text3, width: "18px", textAlign: "right" }}>{cat.score}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              {/* 시그널 칩 */}
              {diag.signals.length > 0 && (
                <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
                  {diag.signals.slice(0, 5).map((sig, i) => (
                    <span key={i} style={{
                      fontSize: "14px", fontWeight: 600, padding: "3px 7px", borderRadius: "6px",
                      background: sig.type === "bullish" ? `${C.green}18` : sig.type === "bearish" ? `${C.red}18` : `${C.yellow}18`,
                      color: sig.type === "bullish" ? C.green : sig.type === "bearish" ? C.red : C.yellow,
                    }}>{sig.type === "bullish" ? "▲" : sig.type === "bearish" ? "▼" : "●"} {sig.name}</span>
                  ))}
                </div>
              )}
            </div>
          )}
          {/* ── 수급 종합 (CMF + MFI 미니 게이지) ── */}
          {(asset.cmf != null || asset.mfi != null) && (
            <div style={{
              display: "flex", gap: "10px", marginBottom: "12px", padding: "10px 14px",
              background: C.bg, borderRadius: "10px", border: `1px solid ${C.border}`,
              alignItems: "center", flexWrap: "wrap",
            }}>
              <span style={{ fontSize: "15px", fontWeight: 700, color: C.text3, whiteSpace: "nowrap" }}>💧 {t("diag.cat.flow")}</span>
              {asset.cmf != null && (
                <div style={{ display: "flex", alignItems: "center", gap: "6px", flex: "1 1 120px", minWidth: "120px" }}>
                  <span style={{ fontSize: "14px", color: C.text3, width: "24px" }}>CMF</span>
                  <div style={{ flex: 1, height: "6px", background: C.border, borderRadius: "4px", overflow: "hidden", position: "relative" }}>
                    <div style={{ position: "absolute", left: "50%", top: 0, width: "1px", height: "100%", background: C.text3 + "44" }} />
                    <div style={{
                      position: "absolute", top: 0, height: "100%", borderRadius: "4px",
                      background: asset.cmf >= 0 ? C.green : C.red,
                      left: asset.cmf >= 0 ? "50%" : `${50 + (asset.cmf * 100)}%`,
                      width: `${Math.min(Math.abs(asset.cmf) * 100, 50)}%`,
                      transition: "all 0.4s ease",
                    }} />
                  </div>
                  <span style={{ fontSize: "15px", fontWeight: 700, color: asset.cmf > 0.1 ? C.green : asset.cmf < -0.1 ? C.red : C.text2, width: "40px", textAlign: "right" }}>
                    {asset.cmf > 0 ? "+" : ""}{asset.cmf.toFixed(3)}
                  </span>
                </div>
              )}
              {asset.mfi != null && (
                <div style={{ display: "flex", alignItems: "center", gap: "6px", flex: "1 1 120px", minWidth: "120px" }}>
                  <span style={{ fontSize: "14px", color: C.text3, width: "24px" }}>MFI</span>
                  <div style={{ flex: 1, height: "6px", background: C.border, borderRadius: "4px", overflow: "hidden" }}>
                    <div style={{
                      height: "100%", borderRadius: "4px",
                      width: `${asset.mfi}%`,
                      background: asset.mfi < 20 ? C.purple : asset.mfi > 80 ? C.red : asset.mfi < 30 ? C.green : asset.mfi > 70 ? C.yellow : C.blue,
                      transition: "width 0.4s ease",
                    }} />
                  </div>
                  <span style={{ fontSize: "15px", fontWeight: 700, color: asset.mfi < 20 ? C.purple : asset.mfi > 80 ? C.red : C.text2, width: "28px", textAlign: "right" }}>
                    {asset.mfi}
                  </span>
                </div>
              )}
              {/* 다이버전스 방향 뱃지 */}
              {asset.macdDivType && (
                <span style={{
                  fontSize: "14px", fontWeight: 700, padding: "2px 7px", borderRadius: "6px",
                  background: asset.macdDivType === "bullish" ? `${C.green}22` : `${C.red}22`,
                  color: asset.macdDivType === "bullish" ? C.green : C.red,
                }}>{asset.macdDivType === "bullish" ? `📈 ${t("diag.macdBullTurn")}` : `📉 ${t("diag.macdBearTurn")}`}</span>
              )}
              {asset.rsiDivType && (
                <span style={{
                  fontSize: "14px", fontWeight: 700, padding: "2px 7px", borderRadius: "6px",
                  background: asset.rsiDivType === "bullish" ? `${C.green}22` : `${C.red}22`,
                  color: asset.rsiDivType === "bullish" ? C.green : C.red,
                }}>{asset.rsiDivType === "bullish" ? `📈 ${t("diag.rsiBullTurn")}` : `📉 ${t("diag.rsiBearTurn")}`}</span>
              )}
              {asset.obvDivType && (
                <span style={{
                  fontSize: "14px", fontWeight: 700, padding: "2px 7px", borderRadius: "6px",
                  background: asset.obvDivType === "bullish" ? `${C.green}22` : `${C.red}22`,
                  color: asset.obvDivType === "bullish" ? C.green : C.red,
                }}>{asset.obvDivType === "bullish" ? `📊 OBV ${t("diag.accumulation")}` : `📊 OBV ${t("diag.distribution")}`}</span>
              )}
              {asset.adx != null && asset.adx >= 25 && (
                <span style={{
                  fontSize: "14px", fontWeight: 700, padding: "2px 7px", borderRadius: "6px",
                  background: asset.plusDI > asset.minusDI ? `${C.green}22` : `${C.red}22`,
                  color: asset.plusDI > asset.minusDI ? C.green : C.red,
                }}>{asset.plusDI > asset.minusDI ? "🔼" : "🔽"} ADX {asset.adx} ({asset.plusDI > asset.minusDI ? t("diag.buyPressure") : t("diag.sellPressure")})</span>
              )}
              {asset.bbSqueeze && (
                <span style={{
                  fontSize: "14px", fontWeight: 700, padding: "2px 7px", borderRadius: "6px",
                  background: `${C.yellow}22`, color: C.yellow,
                }}>⚡ TTM Squeeze ON</span>
              )}
            </div>
          )}
          {/* ── 지표 상세 ── */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gap: "8px", marginBottom: "12px" }}>
            {[
              { label: t("diag.ind.rsiWeekly"), value: asset.rsi ?? "—",  color: asset.rsi != null && asset.rsi <= 30 ? C.purple : asset.rsi != null && asset.rsi >= 70 ? C.red : C.text2 },
              { label: t("diag.ind.rsiDaily"), value: asset.dailyRsi ?? "—", color: asset.dailyRsi != null && asset.dailyRsi <= 30 ? C.purple : asset.dailyRsi != null && asset.dailyRsi >= 70 ? C.red : C.text2,
                sub: asset.rsi != null && asset.dailyRsi != null ? (asset.rsi <= 30 && asset.dailyRsi <= 30 ? `${t("diag.ind.mtfOversold")} ✓` : asset.rsi >= 70 && asset.dailyRsi >= 70 ? `${t("diag.ind.mtfOverbought")} ✓` : null) : null },
              { label: t("diag.ind.vsMa200"), value: asset.ma200Dist != null ? `${asset.ma200Dist > 0 ? "+" : ""}${asset.ma200Dist}%` : "—" },
              { label: t("diag.ind.volRatio"), value: `${asset.volRatio}x`, color: asset.volRatio >= 2 ? C.red : C.text2 },
              { label: t("diag.ind.stochK"), value: asset.stoch ? `${asset.stoch.k.toFixed(1)}` : "—", color: asset.stoch?.k < 20 ? C.purple : C.text2 },
              { label: "Williams %R", value: asset.wr != null ? `${asset.wr}` : "—", color: asset.wr != null && asset.wr < -80 ? C.purple : C.text2 },
              { label: t("diag.ind.vs52wLow"), value: asset.low52w ? `${(((asset.price - asset.low52w) / asset.low52w) * 100) >= 0 ? "+" : ""}${(((asset.price - asset.low52w) / asset.low52w) * 100).toFixed(1)}%` : "—",
                color: asset.low52w ? ((asset.price - asset.low52w) / asset.low52w * 100 < 5 ? C.purple : C.text2) : C.text2 },
              { label: "CMF", value: asset.cmf != null ? `${asset.cmf > 0 ? "+" : ""}${asset.cmf.toFixed(3)}` : "—", color: asset.cmf != null ? (asset.cmf > 0.1 ? C.green : asset.cmf < -0.1 ? C.red : C.text2) : C.text2 },
              { label: "MFI(14)", value: asset.mfi != null ? `${asset.mfi}` : "—", color: asset.mfi != null ? (asset.mfi < 20 ? C.purple : asset.mfi > 80 ? C.red : C.text2) : C.text2 },
              { label: "ADX", value: asset.adx != null ? `${asset.adx}` : "—",
                color: asset.adx != null ? (asset.adx >= 25 ? (asset.plusDI > asset.minusDI ? C.green : C.red) : C.text3) : C.text2,
                sub: asset.adx != null && asset.adx >= 25 ? (asset.plusDI > asset.minusDI ? t("diag.ind.plusDiDominant") : t("diag.ind.minusDiDominant")) : asset.adx != null ? t("diag.ind.weakTrend") : null },
              { label: "TTM Squeeze", value: asset.bbSqueeze ? "ON" : "OFF",
                color: asset.bbSqueeze ? C.yellow : C.text3,
                sub: asset.bbSqueeze ? t("diag.ind.squeezeImminent") : t("diag.ind.normalState") },
            ].map(({ label, value, color, sub }) => (
              <div key={label} style={{ background: C.bg, borderRadius: "10px", padding: "10px 12px" }}>
                <div style={{ fontSize: "15px", color: C.text3, marginBottom: "4px" }}>{label}</div>
                <div style={{ fontWeight: 700, fontSize: "18px", color: color || C.text1 }}>{value}</div>
                {sub && <div style={{ fontSize: "14px", color: C.text3, marginTop: "2px" }}>{sub}</div>}
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: "8px", flexWrap: isMobile ? "nowrap" : "wrap", overflowX: isMobile ? "auto" : "visible", paddingBottom: isMobile ? "8px" : "0" }}>
            <button onClick={(e) => { e.stopPropagation(); onChart(); }} style={{
              padding: "10px 20px", borderRadius: "10px", fontSize: "18px", fontWeight: 600, minHeight: "44px",
              background: C.blueBg, color: C.blue, border: `1px solid ${C.blue}44`, cursor: "pointer",
              transition: "background 0.15s ease",
            }}>📈 {t("diag.viewChart")}</button>
            <a href={asset.market === "crypto"
                ? `https://www.coingecko.com/en/coins/${asset.symbolRaw}`
                : `https://finance.yahoo.com/quote/${asset.symbolRaw || asset.symbol}`}
              target="_blank" rel="noopener" onClick={e => e.stopPropagation()}
              style={{
                padding: "10px 20px", borderRadius: "10px", fontSize: "18px", fontWeight: 600, minHeight: "44px",
                background: C.card, color: C.text3, border: `1px solid ${C.border2}`, textDecoration: "none",
                display: "inline-flex", alignItems: "center",
              }}>🔗 {t("diag.detailsLink")}</a>
          </div>
        </div>
  );

  return isMobile ? (
    /* ── 모바일: 시안 1f 카드 리스트 — 좌측 3px 악센트 + 상단 그라데이션 ── */
    <div style={{
      background: `linear-gradient(180deg, ${acc.bg}, transparent 42%), ${C.card}`,
      border: `1px solid ${C.border}`, borderLeft: `3px solid ${acc.base}`,
      borderRadius: "14px", overflow: "hidden",
    }}>
      <div onClick={() => setExpanded(!expanded)} style={{ padding: "12px 14px", cursor: "pointer" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: "7px", minWidth: 0 }}>
            <span style={{ fontSize: "15px", fontWeight: 800, color: C.text1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "118px" }}>{asset.name}</span>
            <span style={{ fontSize: "10.5px", color: C.text3, fontFamily: MONO, flexShrink: 0 }}>{asset.symbol}</span>
            <span style={{ fontSize: "10px", fontWeight: 700, padding: "1px 6px", borderRadius: "6px", background: mcBg, color: mcColor, flexShrink: 0 }}>{mcLabel}</span>
          </div>
          <div style={{ textAlign: "right", flexShrink: 0, whiteSpace: "nowrap" }}>
            <span className="z-num" style={{ fontFamily: MONO, fontVariantNumeric: "tabular-nums", fontSize: "14px", fontWeight: 700, color: C.text1 }}>{fmtPrice(asset.price, asset.market)}</span>
            <span style={{ marginLeft: "7px" }}>{chg}</span>
          </div>
        </div>
        {diag && (
          <div style={{ display: "flex", alignItems: "center", gap: "9px", marginTop: "9px" }}>
            {/* 상태 서술 배지 — 표현 3원칙 verdictLabel 유지 */}
            <span style={{ fontSize: "10px", fontWeight: 800, padding: "3px 8px", borderRadius: "8px", background: acc.bg, color: acc.hi, whiteSpace: "nowrap", flexShrink: 0 }}>{verdictLabel(diag.opinion, t)}</span>
            {scoreBar(null)}
            <span className="z-num" style={{ fontFamily: MONO, fontVariantNumeric: "tabular-nums", fontSize: "13px", fontWeight: 800, color: acc.hi }}>{diag.score}</span>
          </div>
        )}
        {extraChips && <div style={{ marginTop: "8px" }}>{extraChips}</div>}
      </div>
      {expandedPanel}
    </div>
  ) : (
    /* ── 데스크탑: 시안 1f 정렬 테이블의 행 — 부모(스크리너 결과)의 ListCard 컨테이너 안에서 렌더 ── */
    <div>
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          display: "grid", gridTemplateColumns: "2fr 1fr .9fr 1.1fr 1.2fr", alignItems: "center",
          padding: "12px 18px", borderBottom: `1px solid ${C.card2}`, cursor: "pointer",
          transition: "background .15s",
        }}
        onMouseEnter={e => { e.currentTarget.style.background = C.card2; }}
        onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}>
        <div style={{ minWidth: 0, paddingRight: "10px" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: "8px", minWidth: 0 }}>
            <span style={{ fontSize: "14px", fontWeight: 700, color: C.text1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{asset.name}</span>
            <span style={{ fontSize: "11px", color: C.text3, fontFamily: MONO, flexShrink: 0 }}>{asset.symbol}</span>
            <span style={{ fontSize: "10px", fontWeight: 700, padding: "1px 6px", borderRadius: "6px", background: mcBg, color: mcColor, flexShrink: 0 }}>{mcLabel}</span>
          </div>
          {extraChips && <div style={{ marginTop: "5px" }}>{extraChips}</div>}
        </div>
        <span className="z-num" style={{ fontFamily: MONO, fontVariantNumeric: "tabular-nums", fontSize: "13.5px", color: C.text1, textAlign: "right" }}>{fmtPrice(asset.price, asset.market)}</span>
        <span style={{ textAlign: "right" }}>{chg}</span>
        <span style={{ justifySelf: "center" }}>
          {diag
            ? <span style={{ fontSize: "10px", fontWeight: 800, padding: "3px 9px", borderRadius: "8px", background: acc.bg, color: acc.hi, whiteSpace: "nowrap" }}>{verdictLabel(diag.opinion, t)}</span>
            : <span style={{ fontSize: "11px", color: C.text4 }}>—</span>}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: "9px", justifyContent: "flex-end" }}>
          {scoreBar("64px")}
          {diag && <span className="z-num" style={{ fontFamily: MONO, fontVariantNumeric: "tabular-nums", fontSize: "14px", fontWeight: 800, color: acc.hi, minWidth: "26px", textAlign: "right" }}>{diag.score}</span>}
        </div>
      </div>
      {expandedPanel}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// 서브 컴포넌트: AssetDetailPopup (종목 상세 팝업 + 투자진단)
// ════════════════════════════════════════════════════════════════════
function AssetDetailPopup({ asset, onClose, onChart, hotAssets = [], extendedHours = {}, isWatched = false, onToggleWatch = () => {} }) {
  const isMobile = useIsMobile();
  // mf — 모바일 폰트 스케일 헬퍼 (line 4424 메인 컴포넌트와 동일 정의).
  // 2026-05-12 critical fix: AssetDetailPopup closure 에 mf 미정의 → line 4000~4009 의
  // mf(15) 4곳 호출 시 ReferenceError 발생 → 종목 카드 클릭 시 새로고침/오류.
  const mf = useCallback((px) => {
    if (isMobile) {
      if (px <= 9) return "12px";
      if (px <= 10) return "12px";
      if (px <= 11) return "14px";
      if (px <= 12) return "14px";
      return `${px}px`;
    }
    if (px <= 9) return "12px";
    if (px <= 10) return "14px";
    if (px <= 11) return "14px";
    if (px <= 12) return "14px";
    if (px <= 13) return "15px";
    if (px <= 14) return "16px";
    if (px <= 15) return "18px";
    return `${px}px`;
  }, [isMobile]);
  const [techData, setTechData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [fundamentals, setFundamentals] = useState(null);
  const [fundLoading, setFundLoading] = useState(false);
  // ★ 2026-08 시안 1a: 추이 차트 기간 탭 — 데이터는 이미 받는 1y 일봉(closes)을 슬라이스만 합니다.
  //   (일봉 소스라 1D 탭은 만들지 않습니다 — 없는 해상도를 지어내지 않기)
  const [chartRange, setChartRange] = useState("1M");
  const { t, lang } = useLanguage();

  // 팝업 열릴 때 배경 스크롤 차단
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);
  const flag = asset.market === "us" ? "🇺🇸" : asset.market === "kr" ? "🇰🇷" : "₿";
  // 다크 전용 hex 하드코딩 → 테마 알파 틴트 (라이트 모드 대비 유지)
  const mcBg = asset.market === "us" ? `${C.blue}1A` : asset.market === "kr" ? `${C.green}1A` : `${C.purple}1A`;
  const mcColor = asset.market === "us" ? C.blue : asset.market === "kr" ? C.green : C.purple;

  // 가격 정보 (hotAssets에서 찾기)
  const hot = hotAssets.find(h => h.symbol === asset.symbol);
  const price = asset.price || hot?.price;
  const change = asset.change ?? hot?.change;
  const isPos = (change ?? 0) >= 0;
  // ★ 2026-08-09: 전 종목 장외가 스캔이 owner 전용(Stage B)이 되면서, 비owner 는
  //   extendedHours 맵이 비어 있습니다. 팝업이 어차피 받는 yahoo-quote 응답에서
  //   직접 파생한 값(extSelf)을 폴백으로 씁니다 — 추가 요청 0회.
  const [extSelf, setExtSelf] = useState(null);
  const ext = extendedHours[asset.symbol] || extSelf;

  // 팝업 열릴 때 기술적 데이터 + 애널리스트 데이터 병렬 fetch
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const sym = asset.symbolRaw || asset.symbol;
        // 캔들 데이터 + 애널리스트 데이터 병렬 요청
        const isCrypto = asset.market === "crypto";
        const candlePromise = isCrypto
          ? fetch(`/api/coingecko?id=${asset.id || asset.symbolRaw || asset.symbol.toLowerCase()}&days=365`).then(r => r.ok ? r.json() : null)
          : fetch(`/api/yahoo-batch?symbols=${encodeURIComponent(sym)}&interval=1d&range=1y`).then(r => r.ok ? r.json() : null);
        const analystPromise = !isCrypto
          ? fetch(`/api/yahoo-quote?symbols=${encodeURIComponent(sym)}`).then(r => r.ok ? r.json() : null).catch(() => null)
          : Promise.resolve(null);
        const [candleData, analystData] = await Promise.all([candlePromise, analystPromise]);

        // 장외가 자가 파생 — 위 extSelf 주석 참조
        const selfQ = analystData?.quotes?.[sym];
        if (selfQ && !cancelled) {
          if (selfQ.marketState === "PRE" && selfQ.preMarketPrice) {
            setExtSelf({ price: selfQ.preMarketPrice, change: selfQ.preMarketChangePct, isPreMarket: true, isPostMarket: false });
          } else if ((selfQ.marketState === "POST" || selfQ.marketState === "POSTPOST" || selfQ.marketState === "CLOSED") && selfQ.postMarketPrice) {
            setExtSelf({ price: selfQ.postMarketPrice, change: selfQ.postMarketChangePct, isPreMarket: false, isPostMarket: true });
          }
        }

        let closes = [], volumes = [], highs = [], lows = [];
        if (isCrypto && candleData) {
          closes = (candleData.prices || []).map(p => p[1]);
          volumes = (candleData.total_volumes || []).map(v => v[1]);
          highs = closes; lows = closes;
        } else if (candleData) {
          const batch = candleData.results || {};
          const d = batch[sym];
          if (d) { closes = d.closes || []; volumes = d.volumes || []; highs = d.highs || closes; lows = d.lows || closes; }
        }
        if (cancelled || closes.length < 14) { if (!cancelled) setLoading(false); return; }

        const n = closes.length;
        const last = closes[n - 1];
        const sma = (arr, p) => arr.length >= p ? arr.slice(-p).reduce((a, b) => a + b, 0) / p : null;

        // ── 기술적 지표 계산 ──
        let gains = 0, losses = 0;
        for (let i = n - 14; i < n; i++) { const d = closes[i] - closes[i - 1]; if (d > 0) gains += d; else losses -= d; }
        const rs = losses === 0 ? 100 : (gains / 14) / (losses / 14);
        const rsi = +(100 - 100 / (1 + rs)).toFixed(1);
        const ma20 = sma(closes, 20), ma50 = sma(closes, 50), ma200 = sma(closes, 200);
        const ma200Dist = ma200 ? +((last - ma200) / ma200 * 100).toFixed(1) : null;
        const recentVol = volumes.length >= 5 ? volumes.slice(-5).reduce((a, b) => a + b, 0) / 5 : 0;
        const avgVol = volumes.length >= 20 ? volumes.slice(-20).reduce((a, b) => a + b, 0) / 20 : recentVol;
        const volRatio = avgVol > 0 ? +(recentVol / avgVol).toFixed(2) : 1;
        const h14 = Math.max(...highs.slice(-14)), l14 = Math.min(...lows.slice(-14).filter(l => l > 0));
        const stochK = h14 !== l14 ? +((last - l14) / (h14 - l14) * 100).toFixed(1) : 50;
        // Stochastic %D (3-period SMA of %K)
        let stochD = stochK;
        if (n >= 16 && highs.length >= 16 && lows.length >= 16) {
          const kVals = [];
          for (let si = 0; si < 3; si++) {
            const off = si;
            const sh = Math.max(...highs.slice(-14 - off, n - off)), sl = Math.min(...lows.slice(-14 - off, n - off).filter(l => l > 0));
            kVals.push(sh !== sl ? (closes[n - 1 - off] - sl) / (sh - sl) * 100 : 50);
          }
          stochD = +(kVals.reduce((a, b) => a + b, 0) / kVals.length).toFixed(1);
        }
        const wr = h14 !== l14 ? +(((h14 - last) / (h14 - l14)) * -100).toFixed(1) : -50;
        const high52w = Math.max(...highs), low52w = Math.min(...lows.filter(l => l > 0));
        const wkAgo = n >= 5 ? closes[n - 5] : closes[0];
        const weekChange = +((last - wkAgo) / wkAgo * 100).toFixed(2);

        // ── 추가 지표: bbWidth, atr14Pct, cmf, mfi, adx, rsiDivType ──
        // BB Width
        let bbWidth = null;
        if (closes.length >= 20 && ma20) {
          const bb20Std = Math.sqrt(closes.slice(-20).reduce((a, v) => a + (v - ma20) ** 2, 0) / 20);
          bbWidth = ma20 > 0 ? +(bb20Std * 4 / ma20).toFixed(4) : null;
        }
        // ATR(14) %
        let atr14Pct = null;
        if (n >= 15 && highs.length >= 15 && lows.length >= 15) {
          let atrSum = 0;
          for (let ai = n - 14; ai < n; ai++) {
            atrSum += Math.max(highs[ai] - lows[ai], Math.abs(highs[ai] - closes[ai - 1]), Math.abs(lows[ai] - closes[ai - 1]));
          }
          atr14Pct = last > 0 ? +(atrSum / 14 / last * 100).toFixed(2) : null;
        }
        // CMF (20일)
        let cmf = null;
        if (n >= 20 && volumes.length >= 20 && highs.length >= 20 && lows.length >= 20) {
          let mfvSum = 0, volCmfSum = 0;
          for (let ci = n - 20; ci < n; ci++) {
            const hl = highs[ci] - lows[ci];
            const mfm = hl > 0 ? ((closes[ci] - lows[ci]) - (highs[ci] - closes[ci])) / hl : 0;
            mfvSum += mfm * (volumes[ci] || 0);
            volCmfSum += volumes[ci] || 0;
          }
          cmf = volCmfSum > 0 ? +(mfvSum / volCmfSum).toFixed(3) : null;
        }
        // MFI (14일)
        let mfi = null;
        if (n >= 15 && volumes.length >= 15 && highs.length >= 15 && lows.length >= 15) {
          let posFlow = 0, negFlow = 0;
          for (let mi = n - 14; mi < n; mi++) {
            const tp = (highs[mi] + lows[mi] + closes[mi]) / 3;
            const prevTp = (highs[mi-1] + lows[mi-1] + closes[mi-1]) / 3;
            const mf = tp * (volumes[mi] || 0);
            if (tp > prevTp) posFlow += mf; else negFlow += mf;
          }
          mfi = negFlow > 0 ? Math.round(100 - 100 / (1 + posFlow / negFlow)) : 100;
        }
        // ADX (14일) — 간소화
        let adxBullish = false, adxBearish = false;
        if (n >= 28 && highs.length >= 28 && lows.length >= 28) {
          let sumPDM = 0, sumNDM = 0, sumTR = 0;
          for (let di = n - 14; di < n; di++) {
            const upMove = highs[di] - highs[di - 1];
            const downMove = lows[di - 1] - lows[di];
            sumPDM += upMove > downMove && upMove > 0 ? upMove : 0;
            sumNDM += downMove > upMove && downMove > 0 ? downMove : 0;
            sumTR += Math.max(highs[di] - lows[di], Math.abs(highs[di] - closes[di - 1]), Math.abs(lows[di] - closes[di - 1]));
          }
          const plusDI = sumTR > 0 ? sumPDM / sumTR * 100 : 0;
          const minusDI = sumTR > 0 ? sumNDM / sumTR * 100 : 0;
          const dx = (plusDI + minusDI) > 0 ? Math.abs(plusDI - minusDI) / (plusDI + minusDI) * 100 : 0;
          if (dx > 25 && plusDI > minusDI) adxBullish = true;
          if (dx > 25 && minusDI > plusDI) adxBearish = true;
        }
        // RSI 다이버전스
        let rsiDivType = null;
        if (n >= 28) {
          const prevCloses14 = closes.slice(-28, -14);
          if (prevCloses14.length >= 13) {
            let pGains = 0, pLosses = 0;
            for (let ri = 1; ri < prevCloses14.length; ri++) {
              const dd = prevCloses14[ri] - prevCloses14[ri-1];
              if (dd > 0) pGains += dd; else pLosses -= dd;
            }
            const pRsi = pLosses === 0 ? 100 : Math.round(100 - 100 / (1 + (pGains/13) / (pLosses/13)));
            if (last < closes[n - 14] && rsi > pRsi) rsiDivType = "bullish";
            else if (last > closes[n - 14] && rsi < pRsi) rsiDivType = "bearish";
          }
        }

        // ── 다중 모델 적정주가 (Multi-Model Fair Value Engine) ──
        const analystQ = analystData?.quotes?.[sym] || {};
        const models = [];

        // 모델 1: 기술적 평균회귀 (SMA 컨버전스)
        if (ma200 && ma50 && ma20) {
          // 볼린저밴드 중심 + MA 가중평균 + 평균회귀
          const bb20Std = closes.length >= 20
            ? Math.sqrt(closes.slice(-20).reduce((a, v) => a + (v - ma20) ** 2, 0) / 20)
            : 0;
          const techFV = ma200 * 0.35 + ma50 * 0.30 + ma20 * 0.20 + (ma20 + bb20Std * 0.5) * 0.075 + (ma20 - bb20Std * 0.5) * 0.075;
          models.push({ name: t("diag.model.techMeanReversion"), value: techFV, weight: 0.20, icon: "📐" });
        }

        // 모델 2: 통계적 적정가 (Z-Score 기반 평균회귀)
        if (closes.length >= 60) {
          const mean60 = sma(closes, 60);
          const std60 = Math.sqrt(closes.slice(-60).reduce((a, v) => a + (v - mean60) ** 2, 0) / 60);
          const zScore = std60 > 0 ? (last - mean60) / std60 : 0;
          // 평균회귀 목표: z-score를 0으로 되돌림
          const statFV = mean60 + std60 * Math.max(-1, Math.min(1, zScore * 0.3));
          models.push({ name: t("diag.model.statMeanReversion"), value: statFV, weight: 0.15, icon: "📊" });
        }

        // 모델 3: 애널리스트 컨센서스 (Yahoo Finance)
        if (analystQ.targetMean && analystQ.analystCount >= 3) {
          models.push({ name: `${t("diag.analystConsensus")} (${t("diag.analystCount", { n: analystQ.analystCount })})`, value: analystQ.targetMean, weight: 0.30, icon: "🏦" });
        } else if (analystQ.targetMedian && analystQ.analystCount >= 1) {
          models.push({ name: `${t("diag.model.analystTarget")} (${t("diag.analystCount", { n: analystQ.analystCount })})`, value: analystQ.targetMedian, weight: 0.20, icon: "🏦" });
        }

        // 모델 4: PER 기반 적정가 (Forward EPS × 섹터 평균 PER)
        if (analystQ.forwardEps && analystQ.forwardEps > 0) {
          // 섹터 평균 PER 근사치: S&P500 평균 ~20, 성장주 ~25-30, 가치주 ~15
          const currentPE = analystQ.forwardPE || (last / analystQ.forwardEps);
          const targetPE = currentPE > 35 ? currentPE * 0.85 : currentPE < 10 ? currentPE * 1.15 : currentPE;
          const perFV = analystQ.forwardEps * Math.min(35, Math.max(12, targetPE));
          if (perFV > 0 && isFinite(perFV)) {
            models.push({ name: `Forward PER ${t("diag.fin.valuation")}`, value: perFV, weight: 0.20, icon: "💹" });
          }
        } else if (analystQ.trailingEps && analystQ.trailingEps > 0 && analystQ.trailingPE) {
          // Trailing EPS fallback
          const historicalPE = analystQ.trailingPE;
          const adjPE = historicalPE > 40 ? historicalPE * 0.8 : historicalPE < 8 ? historicalPE * 1.2 : historicalPE;
          const perFV = analystQ.trailingEps * adjPE;
          if (perFV > 0 && isFinite(perFV)) {
            models.push({ name: `Trailing PER ${t("diag.fin.valuation")}`, value: perFV, weight: 0.15, icon: "💹" });
          }
        }

        // 모델 5: PBR 기반 적정가 (장부가치 × 적정 PBR)
        if (analystQ.bookValue && analystQ.bookValue > 0 && analystQ.priceToBook) {
          const currentPBR = analystQ.priceToBook;
          const targetPBR = currentPBR > 10 ? currentPBR * 0.85 : currentPBR < 1 ? Math.max(1, currentPBR * 1.2) : currentPBR;
          const pbrFV = analystQ.bookValue * targetPBR;
          if (pbrFV > 0 && isFinite(pbrFV)) {
            models.push({ name: `PBR ${t("diag.fin.valuation")}`, value: pbrFV, weight: 0.10, icon: "📘" });
          }
        }

        // 모델 6: 52주 레인지 중심값 (피보나치 기반)
        if (high52w && low52w && high52w > low52w) {
          const range52 = high52w - low52w;
          // 피보나치 50% + 61.8% 가중평균
          const fib50 = low52w + range52 * 0.5;
          const fib618 = low52w + range52 * 0.618;
          const rangeFV = fib50 * 0.6 + fib618 * 0.4;
          models.push({ name: t("diag.model.fib52w"), value: rangeFV, weight: 0.10, icon: "🎯" });
        }

        // ── 가중평균 종합 적정주가 계산 ──
        let fairValue = null, fairPremium = null;
        const analystTarget = analystQ.targetMean || analystQ.targetMedian || null;
        const analystHigh = analystQ.targetHigh || null;
        const analystLow = analystQ.targetLow || null;
        if (models.length > 0) {
          const totalWeight = models.reduce((s, m) => s + m.weight, 0);
          fairValue = models.reduce((s, m) => s + m.value * (m.weight / totalWeight), 0);
          fairPremium = +((last - fairValue) / fairValue * 100).toFixed(1);
        }

        if (!cancelled) {
          // 퀀트 백테스팅 (10개 전략 → 상위 10개)
          const btResults = runBacktest(closes, highs, lows, volumes);
          // 고급 지지/저항/목표가/손절가
          const enrichedForLevels = { weekChange, ma200Dist };
          const advLevels = calcAdvancedLevels(closes, highs, lows, volumes, enrichedForLevels, fairValue, analystTarget, analystHigh, analystLow);

          setTechData({
            price: last, rsi, ma50, ma200, fiftyDayAvg: ma50, twoHundredDayAvg: ma200,
            ma200Dist, volRatio,
            stoch: { k: stochK, d: stochD }, wr, high52w, low52w, weekChange,
            bbWidth, atr14Pct, cmf, mfi, adxBullish, adxBearish, rsiDivType,
            // 고도화된 적정주가 데이터
            fairValue, fairPremium, models,
            analystTarget, analystHigh, analystLow,
            analystCount: analystQ.analystCount || 0,
            recommendation: analystQ.recommendation,
            recommendationScore: analystQ.recommendationScore,
            // 밸류에이션 지표
            trailingPE: analystQ.trailingPE, forwardPE: analystQ.forwardPE,
            priceToBook: analystQ.priceToBook, forwardEps: analystQ.forwardEps,
            trailingEps: analystQ.trailingEps, bookValue: analystQ.bookValue,
            marketCap: analystQ.marketCap, dividendYield: analystQ.dividendYield,
            beta: analystQ.beta, earningsDate: analystQ.earningsDate,
            // 퀀트 백테스팅 + 고급 레벨
            backtestStrategies: btResults,
            advancedLevels: advLevels,
            dataTimestamp: Date.now(),
            // ★ 시안 1a 추이 차트용 원시 종가(1y 일봉) — 기간 탭이 슬라이스해 씁니다.
            closes,
          });
          setLoading(false);
        }
      } catch { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [asset.symbol]);

  // Financial Datasets API — 펀더멘털 데이터 (US 종목만)
  useEffect(() => {
    if (asset.market !== "us") return;
    let cancelled = false;
    const ticker = (asset.symbolRaw || asset.symbol || "").replace(".KS", "");
    if (!ticker || ticker.startsWith("^")) return;
    (async () => {
      setFundLoading(true);
      try {
        const [incomeRes, metricsRes, estimatesRes, snapRes] = await Promise.all([
          fetch(`/api/financial-datasets?type=income&ticker=${ticker}&period=quarterly&limit=4`).then(r => r.ok ? r.json() : null).catch(() => null),
          fetch(`/api/financial-datasets?type=metrics&ticker=${ticker}&period=quarterly&limit=4`).then(r => r.ok ? r.json() : null).catch(() => null),
          fetch(`/api/financial-datasets?type=estimates&ticker=${ticker}&period=quarterly&limit=4`).then(r => r.ok ? r.json() : null).catch(() => null),
          fetch(`/api/financial-datasets?type=metrics-snapshot&ticker=${ticker}`).then(r => r.ok ? r.json() : null).catch(() => null),
        ]);
        if (cancelled) return;
        const inc = incomeRes?.income_statements || incomeRes?.results || [];
        const met = metricsRes?.financial_metrics || metricsRes?.results || [];
        const est = estimatesRes?.analyst_estimates || estimatesRes?.results || [];
        const snap = snapRes?.snapshot || snapRes || {};
        if (inc.length === 0 && met.length === 0 && est.length === 0 && !snap.market_cap) {
          setFundLoading(false);
          return;
        }
        // 최신 분기 데이터
        const latest = inc[0] || {};
        const latestMetric = met[0] || {};
        const latestEstimate = est[0] || {};
        // 전분기 비교
        const prev = inc[1] || {};
        const revGrowthQoQ = latest.revenue && prev.revenue ? +((latest.revenue - prev.revenue) / Math.abs(prev.revenue) * 100).toFixed(1) : null;
        // YoY (4분기 전)
        const yoyQ = inc[3] || {};
        const revGrowthYoY = latest.revenue && yoyQ.revenue ? +((latest.revenue - yoyQ.revenue) / Math.abs(yoyQ.revenue) * 100).toFixed(1) : null;
        const niGrowthYoY = latest.net_income && yoyQ.net_income ? +((latest.net_income - yoyQ.net_income) / Math.abs(yoyQ.net_income) * 100).toFixed(1) : null;

        setFundamentals({
          // 손익계산서
          revenue: latest.revenue,
          netIncome: latest.net_income,
          grossProfit: latest.gross_profit,
          operatingIncome: latest.operating_income,
          eps: latest.earnings_per_share || latest.eps_diluted,
          grossMargin: latest.revenue ? +((latest.gross_profit || 0) / latest.revenue * 100).toFixed(1) : null,
          operatingMargin: latest.revenue ? +((latest.operating_income || 0) / latest.revenue * 100).toFixed(1) : null,
          netMargin: latest.revenue && latest.net_income ? +((latest.net_income) / latest.revenue * 100).toFixed(1) : null,
          period: latest.period || latest.report_period,
          fiscal_date: latest.report_period || latest.fiscal_date,
          // 성장률
          revGrowthQoQ, revGrowthYoY, niGrowthYoY,
          // Financial Metrics (historical quarterly → snapshot fallback)
          peRatio: latestMetric.pe_ratio || latestMetric.price_to_earnings_ratio || snap.pe_ratio,
          pbRatio: latestMetric.pb_ratio || latestMetric.price_to_book_ratio || snap.pb_ratio,
          psRatio: latestMetric.ps_ratio || latestMetric.price_to_sales_ratio || snap.ps_ratio,
          evToEbitda: latestMetric.ev_to_ebitda || latestMetric.enterprise_value_to_ebitda || snap.ev_to_ebitda,
          roe: latestMetric.return_on_equity || snap.return_on_equity,
          roa: latestMetric.return_on_assets || snap.return_on_assets,
          debtToEquity: latestMetric.debt_to_equity || latestMetric.total_debt_to_equity || snap.debt_to_equity,
          currentRatio: latestMetric.current_ratio || snap.current_ratio,
          freeCashFlowPerShare: latestMetric.free_cash_flow_per_share || snap.free_cash_flow_per_share,
          revenuePerShare: latestMetric.revenue_per_share || snap.revenue_per_share,
          marketCap: latestMetric.market_cap || latestMetric.market_capitalization || snap.market_cap,
          // Snapshot 추가 지표 (배당, EPS 등)
          dividendYield: snap.dividend_yield,
          earningsPerShare: snap.earnings_per_share,
          forwardPE: snap.forward_pe_ratio,
          // Analyst Estimates
          estRevenue: latestEstimate.estimated_revenue_avg || latestEstimate.revenue_estimate_avg,
          estEps: latestEstimate.estimated_eps_avg || latestEstimate.eps_estimate_avg,
          numAnalysts: latestEstimate.number_of_analysts,
          // 분기별 추이 (차트용)
          quarterlyRevenue: inc.map(q => ({ period: q.report_period || q.fiscal_date, revenue: q.revenue, netIncome: q.net_income })).reverse(),
          source: "Financial Datasets API",
        });
      } catch { /* silent */ }
      if (!cancelled) setFundLoading(false);
    })();
    return () => { cancelled = true; };
  }, [asset.symbol, asset.market]);

  // 진단: techData + fundamentals 병합
  const enriched = useMemo(() => {
    let e = techData ? { ...asset, ...techData } : { ...asset };
    if (fundamentals) {
      e.operatingMargin = fundamentals.operatingMargin;
      e.revGrowthYoY = fundamentals.revGrowthYoY;
      e.roe = fundamentals.roe;
      e.peRatio = fundamentals.peRatio || e.forwardPE || e.trailingPE;
    }
    return e;
  }, [asset, techData, fundamentals]);
  const diag = useMemo(() => quickDiagnosis(enriched), [enriched]);
  const buyLevels = useMemo(() => calcBuyLevels(enriched, t), [enriched, t]);

  // ★ 2026-08 시안 1a: 방향 강조 색 세트(좌측 3px 보더 + 상단 그라데이션 + 배지 공용).
  //   opinionColor(green/red/yellow)를 시안 accent 문법으로 옮깁니다 — 하드코딩 hex 없음.
  const acc = diag.opinionColor === "green" ? accentOf(C, "up")
    : diag.opinionColor === "red" ? accentOf(C, "down")
    : { base: C.yellow, hi: C.yellowL || C.yellow, bg: `${C.yellow}1A` };
  // 히어로 기준시각 — 실제 분석 시각(dataTimestamp)에서만 파생합니다(없으면 숨김).
  const heroFreshMin = techData?.dataTimestamp ? Math.round((Date.now() - techData.dataTimestamp) / 60000) : null;

  // Yahoo Finance 밸류에이션 fallback (Financial Datasets API 실패 시)
  const yahooFund = useMemo(() => {
    if (fundamentals) return null; // Financial Datasets API가 작동하면 불필요
    if (!techData) return null;
    const td = techData;
    const hasAny = td.trailingPE || td.forwardPE || td.priceToBook || td.marketCap;
    if (!hasAny) return null;
    return {
      peRatio: td.forwardPE || td.trailingPE,
      pbRatio: td.priceToBook,
      psRatio: null,
      evToEbitda: null,
      roe: null, roa: null, debtToEquity: null, currentRatio: null,
      marketCap: td.marketCap,
      dividendYield: td.dividendYield,
      beta: td.beta,
      eps: td.forwardEps || td.trailingEps,
      earningsDate: td.earningsDate,
      source: "Yahoo Finance",
    };
  }, [fundamentals, techData]);

  return (
    <div onClick={onClose} onTouchMove={e => e.stopPropagation()} style={{
      position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
      background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)",
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 11000, padding: "20px", overscrollBehavior: "contain",
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: C.bg, borderRadius: "20px", width: "100%", maxWidth: isMobile ? "420px" : "880px",
        maxHeight: "80dvh", overflow: "auto", border: `1px solid ${C.border}`,
        boxShadow: "0 32px 80px rgba(0,0,0,0.45)",
        overscrollBehavior: "contain", WebkitOverflowScrolling: "touch",
      }}>
        {/* ★ 시안 1a 헤더 — 닫기 · 심볼(mono) · 관심 토글 (관심 기능은 기존 onToggleWatch 그대로) */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 16px 0" }}>
          <IconButton onClick={onClose} ariaLabel={t("assetPopup.close")}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" /></svg>
          </IconButton>
          <Num size="15px" weight={800}>{asset.symbol.replace(".KS", "")}</Num>
          <IconButton
            onClick={() => onToggleWatch(asset.symbol)}
            ariaLabel={t(isWatched ? "mobile.kit.favRemove" : "mobile.kit.favAdd")}
            color={isWatched ? (C.yellowL || C.yellow) : C.text3}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill={isWatched ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>
          </IconButton>
        </div>

        {/* ★ 시안 1a 히어로 — 종목명 · 큰 가격(mono) · 등락 알약 · 기준시각 */}
        <div style={{ padding: "12px 16px 2px" }}>
          <div style={{ fontSize: "14px", color: C.text2, fontWeight: 600 }}>{asset.name} <span style={{ fontSize: "13px" }}>{flag}</span></div>
          {(price != null || techData?.price != null) && (
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginTop: "4px", flexWrap: "wrap" }}>
              <Num size="30px" weight={800} style={{ letterSpacing: "-0.02em" }}>
                {(() => { const p = techData?.price || price; return asset.market === "kr" ? `₩${Number(p).toLocaleString()}` : asset.market === "crypto" ? `$${Number(p).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}` : `$${Number(p).toFixed(2)}`; })()}
              </Num>
              {(change != null || techData?.weekChange != null) && (() => {
                const cv = techData?.weekChange ?? change ?? 0;
                const ca = accentOf(C, cv >= 0 ? "up" : "down");
                return (
                  <Num size="13px" weight={800} color={ca.hi} style={{ padding: "3px 9px", borderRadius: "8px", background: ca.bg }}>
                    {cv >= 0 ? "▲" : "▼"} {Math.abs(cv).toFixed(2)}%
                  </Num>
                );
              })()}
            </div>
          )}
          {ext && (ext.price) && (
            <div style={{ marginTop: "6px", fontSize: "13px", color: C.text3, display: "flex", alignItems: "center", gap: "6px" }}>
              <span style={{ background: C.card, border: `1px solid ${C.border}`, padding: "2px 8px", borderRadius: "6px", fontFamily: MONO, fontVariantNumeric: "tabular-nums" }}>
                {ext.isPreMarket ? t("diag.preMarket") : t("diag.afterHours")} ${Number(ext.price).toFixed(2)}
                {ext.change != null && (
                  <span style={{ color: ext.change >= 0 ? (C.greenL || C.green) : (C.redL || C.red), marginLeft: "4px" }}>
                    {ext.change >= 0 ? "+" : ""}{ext.change.toFixed(2)}%
                  </span>
                )}
              </span>
            </div>
          )}
          {heroFreshMin != null && (
            <div style={{ fontSize: "12px", color: C.text4, marginTop: "4px" }}>
              {heroFreshMin < 1 ? t("assetPopup.asOfNow") : t("assetPopup.asOf", { m: heroFreshMin })}
            </div>
          )}
        </div>

        {/* ★ 시안 1a 신호 요약 — 진단(diag) 배선은 그대로, 표현만 시안 문법으로 */}
        <div style={{ padding: "14px 16px 0", display: "flex", flexDirection: "column", gap: "14px" }}>
          {loading ? (
            <div style={{
              background: C.card, borderRadius: "16px", padding: "24px", textAlign: "center",
              border: `1px solid ${C.border}`,
            }}>
              <div style={{ fontSize: "20px", marginBottom: "8px", animation: "spin 1s linear infinite" }}>⏳</div>
              <div style={{ fontSize: "14px", color: C.text3 }}>{t("diag.analyzing")}</div>
            </div>
          ) : !techData ? (
            /* ★ 시안 1a 빈 상태 — 분석 데이터 부족: 가짜 수치 대신 상태 안내 + 관심 등록 CTA(기존 토글 배선) */
            <div style={{
              border: `1.5px dashed ${C.border}`, borderRadius: "16px", padding: "28px 24px",
              display: "flex", flexDirection: "column", alignItems: "center", gap: "6px", textAlign: "center",
            }}>
              <div style={{ width: "52px", height: "52px", borderRadius: "16px", background: C.card2, display: "flex", alignItems: "center", justifyContent: "center", color: C.text3 }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></svg>
              </div>
              <div style={{ fontSize: "15px", fontWeight: 800, color: C.text1, marginTop: "8px" }}>{t("assetPopup.emptyTitle")}</div>
              <div style={{ fontSize: "13px", color: C.text3, lineHeight: 1.6, maxWidth: "240px", wordBreak: "keep-all" }}>{t("assetPopup.emptyDesc")}</div>
              <button onClick={() => onToggleWatch(asset.symbol)} style={{
                marginTop: "10px", padding: "11px 18px", borderRadius: "12px",
                background: isWatched ? `${C.yellow}1F` : `${C.blue}24`,
                color: isWatched ? (C.yellowL || C.yellow) : (C.blueL || C.blue),
                border: "none", fontSize: "13px", fontWeight: 800, fontFamily: "inherit", cursor: "pointer",
              }}>{t(isWatched ? "mobile.kit.favRemove" : "mobile.kit.favAdd")}</button>
            </div>
          ) : (
            <div style={{
              background: `linear-gradient(180deg, ${acc.bg}, transparent 42%), ${C.card}`,
              border: `1px solid ${C.border}`, borderLeft: `3px solid ${acc.base}`,
              borderRadius: "16px", padding: "15px 16px",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "14px", marginBottom: "14px" }}>
                {/* 도넛 — conic-gradient 를 실제 점수(diag.score)로 채웁니다 */}
                <div style={{
                  width: "64px", height: "64px", borderRadius: "50%", flexShrink: 0,
                  background: `conic-gradient(${acc.base} ${diag.score * 3.6}deg, ${C.card2} 0)`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <div style={{ width: "48px", height: "48px", borderRadius: "50%", background: C.card, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", lineHeight: 1 }}>
                    <Num size="18px" weight={800} color={acc.hi}>{diag.score}</Num>
                    <span style={{ fontSize: "8px", color: C.text3 }}>/100</span>
                  </div>
                </div>
                <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "6px" }}>
                  {/* 상태 배지 — 표현 3원칙(상태 서술) verdictLabel 유지 */}
                  <span style={{ alignSelf: "flex-start", fontSize: "12px", fontWeight: 800, padding: "3px 10px", borderRadius: "8px", background: acc.bg, color: acc.hi }}>{verdictLabel(diag.verdict, t)}</span>
                  <span style={{ fontSize: "12px", color: C.text3 }}>{t("assetPopup.signalCaption")}</span>
                  {diag.signals.length > 0 && (
                    <div style={{ display: "flex", gap: "5px", flexWrap: "wrap" }}>
                      {diag.signals.map((sig, i) => (
                        <span key={i} style={{
                          fontSize: "12px", fontWeight: 700, padding: "3px 8px", borderRadius: "6px",
                          background: sig.type === "bullish" ? `${C.green}18` : sig.type === "bearish" ? `${C.red}18` : `${C.yellow}18`,
                          color: sig.type === "bullish" ? (C.greenL || C.green) : sig.type === "bearish" ? (C.redL || C.red) : (C.yellowL || C.yellow),
                        }}>{sig.type === "bullish" ? "▲" : sig.type === "bearish" ? "▼" : "●"} {sig.name}</span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              {/* 신호 상태 서술 + 근거 (표현 3원칙 — 상태만) */}
              <div style={{ fontSize: "12px", color: C.text3, lineHeight: 1.55, marginBottom: "11px" }}>
                <span style={{ fontWeight: 800, color: acc.hi }}>{verdictLabel(diag.opinion, t)}</span> · {diag.rationale}
              </div>
              {/* 카테고리 점수 바 — 기존 기능 유지(시안 문법 정리) */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(134px, 1fr))", gap: "9px 12px" }}>
                {diag.categories.map(cat => (
                  <div key={cat.name} style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
                    <span style={{ fontSize: "12px", color: C.text3, width: "52px", flexShrink: 0, whiteSpace: "nowrap", wordBreak: "keep-all" }}>{catLabel(cat.name, t)}</span>
                    <div style={{ flex: 1, height: "4px", background: C.card2, borderRadius: "9999px", overflow: "hidden" }}>
                      <div style={{
                        height: "100%", borderRadius: "9999px",
                        width: `${cat.score}%`,
                        background: cat.score >= 70 ? C.green : cat.score >= 40 ? C.yellow : C.red,
                        transition: "width 0.4s ease",
                      }} />
                    </div>
                    <Num size="12px" color={C.text3} style={{ width: "22px", textAlign: "right" }}>{cat.score}</Num>
                  </div>
                ))}
              </div>

              {/* 주요 지지 구간 3단계 — 기존 기능 유지 (시안 카드 내부 블록으로 정리) */}
              {buyLevels.levels.length > 0 && (
                <div style={{ marginTop: "12px", padding: isMobile ? "12px" : "14px", borderRadius: "12px", background: C.card2, border: `1px solid ${C.border}` }}>
                  <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", alignItems: isMobile ? "flex-start" : "center", justifyContent: "space-between", gap: isMobile ? 2 : 8, marginBottom: "10px" }}>
                    <span style={{ fontSize: "14px", fontWeight: 800, color: C.text1, whiteSpace: "nowrap" }}>{t("diag.majorSupportZone")}</span>
                    <span style={{ fontSize: "12px", color: C.text3, wordBreak: "keep-all", lineHeight: 1.4 }}>{buyLevels.summary}</span>
                  </div>
                  <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", gap: "8px" }}>
                    {buyLevels.levels.map((lv, li) => {
                      const lvColors = [C.blue, C.purple, C.green];
                      const lvIcons = ["1️⃣", "2️⃣", "3️⃣"];
                      const priceText = asset.market === "kr" ? `₩${Math.round(lv.price).toLocaleString()}` : `$${lv.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
                      if (isMobile) {
                        // 모바일: 좌(차수·가격·할인) + 우(근거·신뢰도) 가로 행 — 세로 깨짐 없음
                        return (
                          <div key={li} style={{
                            display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", borderRadius: "12px",
                            background: `${lvColors[li]}12`, border: `1px solid ${lvColors[li]}20`,
                          }}>
                            <div style={{ flexShrink: 0, minWidth: 92 }}>
                              <div style={{ fontSize: "13px", fontWeight: 700, color: lvColors[li], whiteSpace: "nowrap" }}>{lvIcons[li]} {lv.label}</div>
                              <div className="z-num" style={{ fontSize: "16px", fontWeight: 800, color: C.text1, marginTop: 2, fontVariantNumeric: "tabular-nums" }}>{priceText}</div>
                              <div style={{ fontSize: "13px", fontWeight: 700, color: C.red }}>-{lv.discount}%</div>
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: "13px", color: C.text3, lineHeight: 1.45, wordBreak: "keep-all" }}>{lv.rationale}</div>
                              <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 6 }}>
                                <div style={{ flex: 1, height: "3px", borderRadius: "4px", background: `${C.border}40`, overflow: "hidden" }}>
                                  <div style={{ height: "100%", width: `${lv.confidence}%`, background: lvColors[li], borderRadius: "4px" }} />
                                </div>
                                <span style={{ fontSize: "12px", color: C.text3, whiteSpace: "nowrap" }}>{t("diag.confidenceStrength")} {lv.confidence}</span>
                              </div>
                            </div>
                          </div>
                        );
                      }
                      return (
                        <div key={li} style={{
                          flex: 1, padding: "10px 8px", borderRadius: "12px",
                          background: `${lvColors[li]}12`, textAlign: "center",
                          border: `1px solid ${lvColors[li]}20`,
                        }}>
                          <div style={{ fontSize: "16px", fontWeight: 700, color: lvColors[li], marginBottom: "4px", whiteSpace: "nowrap" }}>{lvIcons[li]} {lv.label}</div>
                          <div style={{ fontSize: "18px", fontWeight: 800, color: C.text1 }}>{priceText}</div>
                          <div style={{ fontSize: "16px", fontWeight: 700, color: C.red, marginTop: "2px" }}>-{lv.discount}%</div>
                          <div style={{ fontSize: "14px", color: C.text3, marginTop: "4px", lineHeight: 1.3, wordBreak: "keep-all" }}>{lv.rationale}</div>
                          <div style={{ marginTop: "4px" }}>
                            <div style={{ height: "3px", borderRadius: "4px", background: `${C.border}40`, overflow: "hidden" }}>
                              <div style={{ height: "100%", width: `${lv.confidence}%`, background: lvColors[li], borderRadius: "4px" }} />
                            </div>
                            <div style={{ fontSize: "14px", color: C.text3, marginTop: "2px" }}>{t("diag.confidenceStrength")} {lv.confidence}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ★ 시안 1a — 지지·저항 레벨 + 추이 차트 + 백테스트 + 퀀트 전략.
            데이터 배선(advancedLevels·backtestStrategies·closes)은 기존 그대로, 표현만 시안 문법.
            데스크탑(1280)은 시안의 2열 그리드 변형을 씁니다. */}
        {techData && !loading && (() => {
          const lv = techData.advancedLevels;
          const bt = techData.backtestStrategies || [];
          const p = techData.price;
          const isBullish = diag.score >= 55;
          const isBearish = diag.score < 40;
          const fmtP = (v) => !v ? "—" : asset.market === "kr" ? `₩${Math.round(v).toLocaleString()}` : `$${v.toFixed(2)}`;
          const targetPrice = lv?.targetPrice;
          const stopLoss = lv?.stopLoss || p * 0.92;
          const upside = lv?.upside;
          const downside = lv?.downside || 8;
          const riskReward = lv?.riskReward;
          const sup1 = lv?.support1;
          const sup2 = lv?.support2;
          const res1 = lv?.resist1;
          const res2 = lv?.resist2;
          const freshMin = techData.dataTimestamp ? Math.round((Date.now() - techData.dataTimestamp) / 60000) : null;

          // ── 시안 S/R 레벨 행 (R2·R1·S1·S2) + 현재가 위치 바 ──
          const srRows = [];
          if (res2) srRows.push({ tag: "R2", lvl: res2, kind: "res" });
          if (res1) srRows.push({ tag: "R1", lvl: res1, kind: "res" });
          if (sup1) srRows.push({ tag: "S1", lvl: sup1, kind: "sup" });
          if (sup2) srRows.push({ tag: "S2", lvl: sup2, kind: "sup" });
          const srPrices = srRows.map(r => r.lvl.price).concat(p != null ? [p] : []);
          const srMin = Math.min(...srPrices);
          const srMax = Math.max(...srPrices);
          const srPos = p != null && srMax > srMin ? ((p - srMin) / (srMax - srMin)) * 100 : 50;

          // ── 추이 차트 — 이미 받아둔 1y 일봉(closes) 슬라이스. 목업 포인트 없음 ──
          const closesAll = techData.closes || [];
          const rangeLen = { "1W": 6, "1M": 22, "3M": 66, "1Y": closesAll.length };
          const sparkPts = closesAll.slice(-(rangeLen[chartRange] || closesAll.length));
          const sparkDir = sparkPts.length >= 2 && sparkPts[sparkPts.length - 1] >= sparkPts[0] ? "up" : "down";

          const srCard = srRows.length > 0 ? (
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "16px", padding: "15px 16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "10px", gap: "8px" }}>
                <span style={{ fontSize: "14px", fontWeight: 800, color: C.text1 }}>{t("assetPopup.levelsTitle")}</span>
                <span style={{ fontSize: "12px", color: C.text3, flexShrink: 0 }}>{t("assetPopup.levelsCaption")}</span>
              </div>
              <div style={{ position: "relative", height: "16px", marginBottom: "12px" }}>
                <div style={{ position: "absolute", top: "6px", left: 0, right: 0, height: "4px", borderRadius: "9999px", background: `linear-gradient(90deg, ${C.green}59, ${C.card2} 35%, ${C.card2} 65%, ${C.red}59)` }} />
                <div style={{ position: "absolute", top: "3px", width: "10px", height: "10px", borderRadius: "50%", left: `calc(${Math.min(Math.max(srPos, 2), 98)}% - 5px)`, background: acc.hi, boxShadow: `0 0 0 2px ${C.card}` }} />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "7px" }}>
                {srRows.map(r => {
                  const dist = p ? ((r.lvl.price - p) / p) * 100 : null;
                  return (
                    <div key={r.tag} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <Num size="12px" weight={800} color={r.kind === "res" ? (C.redL || C.red) : (C.greenL || C.green)} style={{ width: "26px", flexShrink: 0 }}>{r.tag}</Num>
                      <Num size="12px" style={{ flex: 1, textAlign: "right" }}>{fmtP(r.lvl.price)}</Num>
                      <Num size="12px" color={C.text3} style={{ width: "58px", textAlign: "right", flexShrink: 0 }}>{dist == null ? "—" : `${dist >= 0 ? "+" : ""}${dist.toFixed(1)}%`}</Num>
                      <span style={{ width: isMobile ? "84px" : "130px", textAlign: "right", fontSize: "11px", color: C.text4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flexShrink: 0 }}>
                        {(r.lvl.sources || [])[0] || ""}{r.lvl.weight ? ` ×${Math.round(r.lvl.weight)}` : ""}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: C.text4, marginTop: "9px" }}>
                <span>{t("mobile.kit.supportZone")}</span><span>{t("mobile.kit.resistanceZone")}</span>
              </div>
            </div>
          ) : null;

          const chartCard = sparkPts.length >= 2 ? (
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "16px", padding: "14px 14px 10px" }}>
              <Sparkline points={sparkPts} dir={sparkDir} height={isMobile ? 96 : 150} />
              <div style={{ display: "flex", gap: "6px", marginTop: "10px", maxWidth: isMobile ? "none" : "280px" }}>
                {["1W", "1M", "3M", "1Y"].map(r => (
                  <button key={r} onClick={() => setChartRange(r)} aria-pressed={chartRange === r} style={{
                    flex: 1, textAlign: "center", fontSize: "12px", fontWeight: chartRange === r ? 800 : 700,
                    padding: "6px 0", borderRadius: "8px", border: "none", cursor: "pointer", fontFamily: "inherit",
                    background: chartRange === r ? `${C.blue}24` : "transparent",
                    color: chartRange === r ? (C.blueL || C.blue) : C.text3,
                  }}>{t(`mobile.kit.range${r.toLowerCase()}`)}</button>
                ))}
              </div>
            </div>
          ) : null;

          const btCard = bt.length > 0 ? (
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "16px", padding: "15px 16px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px", gap: "8px" }}>
                <span style={{ fontSize: "14px", fontWeight: 800, color: C.text1 }}>{t("assetPopup.btTitle")}</span>
                <span style={{ fontSize: "11px", fontWeight: 800, padding: "3px 8px", borderRadius: "8px", background: `${C.yellow}1F`, color: C.yellowL || C.yellow, flexShrink: 0 }}>{t("assetPopup.btBadge")}</span>
              </div>
              {/* 백테스트 고지 — 성과 전시에는 시뮬레이션 한계 고지를 반드시 동반 (2026-08 전수 감사) */}
              <div style={{ fontSize: "12px", color: C.text4, lineHeight: 1.5, marginBottom: "10px" }}>
                {t("diag.btDisclaimer")}
              </div>
              {bt.map((s, i) => {
                const isTop = i === 0;
                const retAcc = accentOf(C, s.totalReturn >= 0 ? "up" : "down");
                return (
                  <div key={s.name} style={{
                    padding: "10px 12px", borderRadius: "12px", marginBottom: i < bt.length - 1 ? "6px" : 0,
                    background: C.card2, border: isTop ? `1px solid ${C.blue}30` : "1px solid transparent",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px", gap: "8px" }}>
                      <span style={{ fontSize: "13px", fontWeight: 700, color: isTop ? (C.blueL || C.blue) : C.text1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {isTop ? "🏆" : `${i + 1}.`} {s.name}
                      </span>
                      <Num size="14px" weight={800} color={retAcc.hi} style={{ flexShrink: 0 }}>{s.totalReturn >= 0 ? "+" : ""}{s.totalReturn}%</Num>
                    </div>
                    <div style={{ fontSize: "12px", color: C.text3, marginBottom: "6px" }}>{s.desc}</div>
                    <div style={{ display: "flex", gap: "6px", flexWrap: isMobile ? "nowrap" : "wrap", overflowX: isMobile ? "auto" : "visible", paddingBottom: isMobile ? "4px" : 0 }}>
                      <span style={{ fontSize: "12px", padding: "3px 8px", borderRadius: "6px", background: C.card, color: C.text3, whiteSpace: "nowrap" }}>
                        {t("diag.sharpe")} <Num size="12px" color={s.sharpe >= 1 ? (C.greenL || C.green) : s.sharpe >= 0 ? (C.yellowL || C.yellow) : (C.redL || C.red)}>{s.sharpe}</Num>
                      </span>
                      <span style={{ fontSize: "12px", padding: "3px 8px", borderRadius: "6px", background: C.card, color: C.text3, whiteSpace: "nowrap" }}>
                        {t("diag.winRate")} <Num size="12px" color={s.winRate >= 60 ? (C.greenL || C.green) : s.winRate >= 40 ? (C.yellowL || C.yellow) : (C.redL || C.red)}>{s.winRate}%</Num>
                      </span>
                      <span style={{ fontSize: "12px", padding: "3px 8px", borderRadius: "6px", background: C.card, color: C.text3, whiteSpace: "nowrap" }}>
                        MDD <Num size="12px" color={s.maxDD <= 10 ? (C.greenL || C.green) : s.maxDD <= 20 ? (C.yellowL || C.yellow) : (C.redL || C.red)}>-{s.maxDD}%</Num>
                      </span>
                      <span style={{ fontSize: "12px", padding: "3px 8px", borderRadius: "6px", background: C.card, color: C.text3, whiteSpace: "nowrap" }}><Num size="12px" color={C.text2}>{s.trades}</Num>{t("diag.tradesSuffix")}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null;

          // 기존 퀀트 전략 카드 — 시안에 없는 기존 기능(요약문·목표가·손절가·R:R)을 시안 문법으로 유지
          const stratCard = (
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "16px", padding: "15px 16px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px", gap: "8px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px", minWidth: 0 }}>
                  <span style={{ fontSize: "14px", fontWeight: 800, color: C.text1 }}>{t("diag.quantStrategy")}</span>
                  <span style={{ fontSize: "11px", fontWeight: 800, padding: "2px 8px", borderRadius: "9999px", background: acc.bg, color: acc.hi, whiteSpace: "nowrap" }}>{verdictLabel(diag.opinion, t)}</span>
                </div>
                {freshMin != null && <span style={{ fontSize: "12px", color: C.text4, flexShrink: 0 }}>{freshMin < 1 ? t("diag.analyzedJustNow") : t("diag.analyzedMinAgo", { n: freshMin })}</span>}
              </div>
              <div style={{
                fontSize: "13px", color: C.text2, lineHeight: 1.7, marginBottom: "14px",
                padding: "10px 12px", borderRadius: "12px", background: C.card2,
                borderLeft: `3px solid ${acc.base}`,
              }}>
                {isBullish && targetPrice
                  ? t("diag.stratBullTarget", { target: fmtP(targetPrice), upside, stop: fmtP(stopLoss) }) + (riskReward ? ` R:R 1:${riskReward}.` : "")
                  : isBullish
                  ? t("diag.stratBullNoTarget", { stop: fmtP(stopLoss) })
                  : isBearish
                  ? t("diag.stratBear", { support: fmtP(sup1?.price || stopLoss) })
                  : t("diag.stratMixed", { support: fmtP(sup1?.price || stopLoss), resistance: fmtP(res1?.price) })}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "8px", marginBottom: "8px" }}>
                <div style={{ background: C.card2, borderRadius: "12px", padding: "10px 12px" }}>
                  <div style={{ fontSize: "12px", color: C.text3, fontWeight: 700 }}>{t("diag.targetPrice")}</div>
                  <Num size="16px" weight={800} color={C.greenL || C.green} style={{ display: "block", marginTop: "3px" }}>{fmtP(targetPrice || techData.analystTarget)}</Num>
                  {upside && <Num size="12px" color={C.greenL || C.green} style={{ display: "block", marginTop: "2px" }}>+{upside}%</Num>}
                  {lv?.targetSources && <div style={{ fontSize: "11px", color: C.text4, marginTop: "4px", lineHeight: 1.4 }}>{lv.targetSources.slice(0, 3).join(" · ")}</div>}
                </div>
                <div style={{ background: C.card2, borderRadius: "12px", padding: "10px 12px" }}>
                  <div style={{ fontSize: "12px", color: C.text3, fontWeight: 700 }}>{t("diag.stopPrice")}</div>
                  <Num size="16px" weight={800} color={C.redL || C.red} style={{ display: "block", marginTop: "3px" }}>{fmtP(stopLoss)}</Num>
                  {downside > 0 && <Num size="12px" color={C.redL || C.red} style={{ display: "block", marginTop: "2px" }}>-{downside}%</Num>}
                  {lv?.stopSources && <div style={{ fontSize: "11px", color: C.text4, marginTop: "4px", lineHeight: 1.4 }}>{lv.stopSources.slice(0, 3).join(" · ")}</div>}
                </div>
              </div>
              <div style={{ display: "flex", gap: "8px" }}>
                {riskReward && (
                  <div style={{ flex: 1, padding: "9px 10px", borderRadius: "12px", background: C.card2, textAlign: "center" }}>
                    <div style={{ fontSize: "11px", color: C.text3, fontWeight: 700 }}>R:R</div>
                    <Num size="15px" weight={800} color={riskReward >= 2 ? (C.greenL || C.green) : riskReward >= 1 ? (C.yellowL || C.yellow) : (C.redL || C.red)}>1:{riskReward}</Num>
                  </div>
                )}
                <div style={{ flex: 1, padding: "9px 10px", borderRadius: "12px", background: C.card2, textAlign: "center" }}>
                  <div style={{ fontSize: "11px", color: C.text3, fontWeight: 700 }}>{t("diag.cat.trend")}</div>
                  <div style={{ fontSize: "13px", fontWeight: 800, color: C.text1, marginTop: "2px" }}>{isBullish ? t("diag.bullAligned") : isBearish ? t("diag.bearAligned") : t("diag.mixed")}</div>
                </div>
                <div style={{ flex: 1, padding: "9px 10px", borderRadius: "12px", background: C.card2, textAlign: "center" }}>
                  <div style={{ fontSize: "11px", color: C.text3, fontWeight: 700 }}>{t("mobile.kit.scoreLabel")}</div>
                  <div style={{ fontSize: "13px", fontWeight: 800, color: C.text1, marginTop: "2px" }}>{diag.score >= 70 ? t("diag.scoreStrong") : diag.score >= 55 ? t("diag.scoreSomewhatStrong") : diag.score >= 40 ? t("diag.verdictLabel.neutral") : t("diag.scoreWeak")}</div>
                </div>
              </div>
            </div>
          );

          return (
            <div style={{ padding: "14px 16px 0" }}>
              {isMobile ? (
                <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                  {srCard}{chartCard}{btCard}{stratCard}
                </div>
              ) : (
                /* 데스크탑 1280 변형 — 시안 1a: 좌(차트·레벨) 1.35fr / 우(전략·백테스트) 1fr */
                <div style={{ display: "grid", gridTemplateColumns: "1.35fr 1fr", gap: "14px", alignItems: "start" }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>{chartCard}{srCard}</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>{stratCard}{btCard}</div>
                </div>
              )}
            </div>
          );
        })()}

        {/* ═══ 펀더멘털 분석 (토스 증권 스타일) ═══ */}
        {(fundamentals || fundLoading || yahooFund) && (() => {
          const fd = fundamentals;
          const yf = yahooFund;
          const fmtMoney = (v) => v == null ? "—" : Math.abs(v) >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(0)}M` : `$${v.toLocaleString()}`;
          const fmtGrowth = (v) => v == null ? null : `${v > 0 ? "+" : ""}${v}%`;
          const growthColor = (v) => v == null ? C.text3 : v > 0 ? C.green : v < 0 ? C.red : C.text3;
          // 통합 데이터소스 (Financial Datasets 우선, Yahoo 폴백)
          const per = fd?.peRatio || yf?.peRatio || techData?.forwardPE || techData?.trailingPE;
          const pbr = fd?.pbRatio || yf?.pbRatio || techData?.priceToBook;
          const psr = fd?.psRatio;
          const evEbitda = fd?.evToEbitda;
          const mcap = fd?.marketCap || yf?.marketCap || techData?.marketCap;
          const divYield = yf?.dividendYield || techData?.dividendYield;
          const beta = yf?.beta || techData?.beta;
          const eps = fd?.eps || yf?.eps || techData?.forwardEps || techData?.trailingEps;
          const roe = fd?.roe;
          const roa = fd?.roa;
          const dte = fd?.debtToEquity;
          const cr = fd?.currentRatio;

          return (
          <div style={{ padding: "14px 16px 0" }}>
            {/* ── 섹션 헤더 ── */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
              <span style={{ fontSize: "16px", fontWeight: 800, color: C.text1 }}>{t("diag.fin.companyInfo")}</span>
              <span style={{ fontSize: "15px", color: C.text3, background: C.card2, padding: "2px 8px", borderRadius: "4px" }}>
                {fd?.fiscal_date || (fd ? "Financial Datasets" : "Yahoo Finance")}
              </span>
            </div>

            {fundLoading && !fd ? (
              <div style={{ display: "flex", gap: "8px", marginBottom: "12px" }}>
                {[1,2,3].map(i => <div key={i} className="skeleton" style={{ flex: 1, height: "70px", borderRadius: "12px" }} />)}
              </div>
            ) : (
            <>
            {/* ── 1. 실적 요약 (Financial Datasets만) ── */}
            {fd && fd.revenue != null && (
              <div style={{ background: C.card, borderRadius: "12px", padding: "16px", marginBottom: "8px", border: `1px solid ${C.border}` }}>
                <div style={{ fontSize: "16px", fontWeight: 700, color: C.text3, marginBottom: "10px" }}>{t("diag.fin.earningsSummary")}</div>
                {/* 매출/영업이익/순이익 */}
                <div style={{ display: "flex", gap: "0", marginBottom: "12px" }}>
                  {[
                    { label: t("diag.fin.revenue"), value: fd.revenue, growth: fd.revGrowthYoY },
                    { label: t("diag.fin.operatingIncome"), value: fd.operatingIncome, growth: null },
                    { label: t("diag.fin.netIncome"), value: fd.netIncome, growth: fd.niGrowthYoY },
                  ].map((item, idx) => (
                    <div key={item.label} style={{
                      flex: 1, textAlign: "center", position: "relative",
                      ...(idx < 2 ? { borderRight: `1px solid ${C.border}` } : {}),
                    }}>
                      <div style={{ fontSize: "15px", color: C.text3, marginBottom: "4px" }}>{item.label}</div>
                      <div style={{ fontSize: "18px", fontWeight: 800, color: item.value > 0 ? C.text1 : item.value < 0 ? C.red : C.text3 }}>
                        {fmtMoney(item.value)}
                      </div>
                      {item.growth != null && (
                        <div style={{ fontSize: "15px", fontWeight: 700, color: growthColor(item.growth), marginTop: "2px" }}>
                          YoY {fmtGrowth(item.growth)}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* 마진율 바 */}
                {(fd.grossMargin != null || fd.operatingMargin != null || fd.netMargin != null) && (
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    {[
                      { label: t("diag.fin.grossMargin"), value: fd.grossMargin, color: C.blue },
                      { label: t("diag.fin.operatingMargin"), value: fd.operatingMargin, color: C.green },
                      { label: t("diag.fin.netMargin"), value: fd.netMargin, color: fd.netMargin >= 0 ? C.purple : C.red },
                    ].filter(m => m.value != null).map(m => (
                      <div key={m.label} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <span style={{ fontSize: "15px", color: C.text3, width: "64px", flexShrink: 0 }}>{m.label}</span>
                        <div style={{ flex: 1, height: "6px", background: `${C.border}60`, borderRadius: "4px", overflow: "hidden" }}>
                          <div style={{
                            height: "100%", borderRadius: "4px", transition: "width 0.5s ease",
                            width: `${Math.min(Math.max(m.value, 0), 100)}%`, background: m.color,
                          }} />
                        </div>
                        <span style={{ fontSize: "16px", fontWeight: 700, color: m.value >= 0 ? C.text1 : C.red, width: "36px", textAlign: "right" }}>
                          {m.value}%
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {/* 성장률 */}
                {(fd.revGrowthQoQ != null || fd.revGrowthYoY != null) && (
                  <div style={{ display: "flex", gap: "8px", marginTop: "10px" }}>
                    {[
                      { label: `${t("diag.fin.revenue")} QoQ`, value: fd.revGrowthQoQ },
                      { label: `${t("diag.fin.revenue")} YoY`, value: fd.revGrowthYoY },
                      { label: `${t("diag.fin.netIncome")} YoY`, value: fd.niGrowthYoY },
                    ].filter(g => g.value != null).map(g => (
                      <div key={g.label} style={{
                        flex: 1, textAlign: "center", padding: "6px 4px", borderRadius: "8px",
                        background: g.value > 0 ? `${C.green}10` : g.value < 0 ? `${C.red}10` : C.card2,
                      }}>
                        <div style={{ fontSize: "14px", color: C.text3 }}>{g.label}</div>
                        <div style={{ fontSize: "18px", fontWeight: 800, color: growthColor(g.value) }}>{fmtGrowth(g.value)}</div>
                      </div>
                    ))}
                  </div>
                )}

                {/* 분기별 매출 추이 바 차트 */}
                {fd.quarterlyRevenue?.length >= 2 && (() => {
                  const qr = fd.quarterlyRevenue.filter(q => q.revenue);
                  if (qr.length < 2) return null;
                  const maxRev = Math.max(...qr.map(q => Math.abs(q.revenue)));
                  const maxNI = Math.max(...qr.filter(q => q.netIncome).map(q => Math.abs(q.netIncome)), 1);
                  return (
                    <div style={{ marginTop: "12px" }}>
                      <div style={{ fontSize: "15px", color: C.text3, marginBottom: "8px" }}>{t("diag.fin.quarterlyTrend")}</div>
                      <div style={{ display: "flex", gap: "6px", alignItems: "flex-end", height: "60px" }}>
                        {qr.map((q, i) => {
                          const revPct = maxRev > 0 ? Math.abs(q.revenue) / maxRev : 0;
                          const niPct = q.netIncome && maxNI > 0 ? Math.abs(q.netIncome) / maxRev : 0;
                          const prevQ = qr[i - 1];
                          const growth = prevQ?.revenue ? (q.revenue - prevQ.revenue) / Math.abs(prevQ.revenue) * 100 : 0;
                          return (
                            <div key={q.period || i} style={{ flex: 1, textAlign: "center" }}>
                              <div style={{ display: "flex", gap: "2px", justifyContent: "center", alignItems: "flex-end", height: "42px" }}>
                                <div style={{
                                  width: "45%", height: `${Math.max(revPct * 42, 3)}px`, borderRadius: "4px 3px 0 0",
                                  background: `${C.blue}80`, transition: "height 0.4s ease",
                                }} />
                                {q.netIncome != null && (
                                  <div style={{
                                    width: "45%", height: `${Math.max(niPct * 42, 2)}px`, borderRadius: "4px 3px 0 0",
                                    background: q.netIncome >= 0 ? `${C.green}80` : `${C.red}60`, transition: "height 0.4s ease",
                                  }} />
                                )}
                              </div>
                              <div style={{ fontSize: "14px", color: C.text3, marginTop: "4px", lineHeight: 1.2 }}>
                                {(q.period || "").slice(2, 4)}/{(q.period || "").slice(5, 7)}
                              </div>
                              <div style={{ fontSize: "14px", fontWeight: 700, color: growthColor(growth), marginTop: "1px" }}>
                                {i > 0 ? `${growth > 0 ? "+" : ""}${growth.toFixed(0)}%` : ""}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      <div style={{ display: "flex", gap: "12px", justifyContent: "center", marginTop: "6px" }}>
                        <span style={{ fontSize: "14px", color: C.text3 }}><span style={{ display: "inline-block", width: "8px", height: "8px", borderRadius: "4px", background: `${C.blue}80`, marginRight: "3px", verticalAlign: "middle" }} />{t("diag.fin.revenue")}</span>
                        <span style={{ fontSize: "14px", color: C.text3 }}><span style={{ display: "inline-block", width: "8px", height: "8px", borderRadius: "4px", background: `${C.green}80`, marginRight: "3px", verticalAlign: "middle" }} />{t("diag.fin.netIncome")}</span>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}

            {/* ── 2. 밸류에이션 ── */}
            {(per != null || pbr != null || psr != null || evEbitda != null) && (
              <div style={{ background: C.card, borderRadius: "12px", padding: "16px", marginBottom: "8px", border: `1px solid ${C.border}` }}>
                <div style={{ fontSize: "16px", fontWeight: 700, color: C.text3, marginBottom: "10px" }}>{t("diag.fin.valuation")}</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "0" }}>
                  {[
                    { label: "PER", value: per, desc: per ? (per < 15 ? t("diag.fin.undervalued") : per < 25 ? t("diag.fin.fair") : per < 40 ? t("diag.fin.overvalued") : t("diag.fin.veryOvervalued")) : null,
                      color: per ? (per < 15 ? C.green : per < 25 ? C.text1 : per < 40 ? C.yellow : C.red) : C.text3 },
                    { label: "PBR", value: pbr, desc: pbr ? (pbr < 1 ? t("diag.fin.undervalued") : pbr < 3 ? t("diag.fin.fair") : t("diag.fin.overvalued")) : null,
                      color: pbr ? (pbr < 1 ? C.green : pbr < 3 ? C.text1 : C.yellow) : C.text3 },
                    { label: "PSR", value: psr, desc: null, color: C.text1 },
                    { label: "EV/EBITDA", value: evEbitda, desc: null, color: C.text1 },
                  ].filter(v => v.value != null).map((item, idx) => (
                    <div key={item.label} style={{
                      padding: "10px 12px",
                      borderBottom: idx < 2 ? `1px solid ${C.border}40` : "none",
                      borderRight: idx % 2 === 0 ? `1px solid ${C.border}40` : "none",
                    }}>
                      <div style={{ fontSize: "15px", color: C.text3, marginBottom: "2px" }}>{item.label}</div>
                      <div style={{ display: "flex", alignItems: "baseline", gap: "4px" }}>
                        <span style={{ fontSize: "18px", fontWeight: 800, color: item.color }}>
                          {typeof item.value === "number" ? item.value.toFixed(1) : item.value}
                        </span>
                        {item.desc && <span style={{ fontSize: "14px", fontWeight: 600, color: item.color, opacity: 0.8 }}>{item.desc}</span>}
                      </div>
                    </div>
                  ))}
                </div>
                {/* 추가 지표 한 줄 */}
                <div style={{ display: "flex", gap: "0", marginTop: "8px", borderTop: `1px solid ${C.border}40`, paddingTop: "8px" }}>
                  {[
                    // ★ 2026-06-12 (대표 제보): KR 종목은 야후가 ₩값을 주는데 $로 표기되던 버그 — 시장별 통화
                    { label: "EPS", value: eps, fmt: v => asset.market === "kr" ? `₩${Math.round(v).toLocaleString()}` : `$${v.toFixed(2)}` },
                    { label: t("diag.fin.marketCap"), value: mcap, fmt: v => asset.market === "kr"
                        ? (v >= 1e12 ? `${(v/1e12).toFixed(1)}${t("diag.fin.trillionWon")}` : `${(v/1e8).toFixed(0)}${t("diag.fin.hundredMillionWon")}`)
                        : (v >= 1e12 ? `$${(v/1e12).toFixed(1)}T` : v >= 1e9 ? `$${(v/1e9).toFixed(0)}B` : `$${(v/1e6).toFixed(0)}M`) },
                    { label: t("diag.fin.dividendYield"), value: divYield, fmt: v => `${(v * 100).toFixed(2)}%` },
                    { label: t("diag.fin.beta"), value: beta, fmt: v => v.toFixed(2) },
                  ].filter(v => v.value != null).map(item => (
                    <div key={item.label} style={{ flex: 1, textAlign: "center" }}>
                      <div style={{ fontSize: "14px", color: C.text3 }}>{item.label}</div>
                      <div style={{ fontSize: "16px", fontWeight: 700, color: C.text1 }}>{item.fmt(item.value)}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── 3. 수익성 & 재무 건전성 ── */}
            {(roe != null || roa != null || dte != null || cr != null) && (
              <div style={{ background: C.card, borderRadius: "12px", padding: "16px", marginBottom: "8px", border: `1px solid ${C.border}` }}>
                <div style={{ fontSize: "16px", fontWeight: 700, color: C.text3, marginBottom: "10px" }}>{t("diag.fin.profitabilityHealth")}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {[
                    { label: "ROE", value: roe, scale: 100, suffix: "%", good: v => v > 15, bad: v => v < 0, barMax: 40, barColor: C.green },
                    { label: "ROA", value: roa, scale: 100, suffix: "%", good: v => v > 8, bad: v => v < 0, barMax: 25, barColor: C.blue },
                    { label: t("diag.fin.debtRatio"), value: dte, scale: 1, suffix: "", good: v => v < 1, bad: v => v > 3, barMax: 5, barColor: C.orange, invert: true },
                    { label: t("diag.fin.currentRatio"), value: cr, scale: 1, suffix: "", good: v => v > 1.5, bad: v => v < 1, barMax: 4, barColor: C.purple },
                  ].filter(m => m.value != null).map(m => {
                    const displayVal = m.scale !== 1 ? m.value * m.scale : m.value;
                    const barPct = Math.min(Math.abs(displayVal) / m.barMax * 100, 100);
                    const color = m.invert
                      ? (m.bad(displayVal) ? C.red : m.good(displayVal) ? C.green : m.barColor)
                      : (m.good(displayVal) ? C.green : m.bad(displayVal) ? C.red : m.barColor);
                    return (
                      <div key={m.label} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <span style={{ fontSize: "16px", color: C.text3, width: "52px", flexShrink: 0 }}>{m.label}</span>
                        <div style={{ flex: 1, height: "8px", background: `${C.border}40`, borderRadius: "4px", overflow: "hidden" }}>
                          <div style={{ height: "100%", borderRadius: "4px", width: `${barPct}%`, background: color, transition: "width 0.5s ease" }} />
                        </div>
                        <span style={{ fontSize: "16px", fontWeight: 800, color, width: "48px", textAlign: "right" }}>
                          {displayVal.toFixed(1)}{m.suffix}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── 4. 애널리스트 컨센서스 (목표주가 시각화) ── */}
            {(techData?.analystTarget || fd?.numAnalysts > 0 || fd?.estRevenue || fd?.estEps) && (() => {
              const curP = techData?.price || enriched.price;
              const tgt = techData?.analystTarget;
              const tgtHigh = techData?.analystHigh;
              const tgtLow = techData?.analystLow;
              const cnt = techData?.analystCount || fd?.numAnalysts || 0;
              const rec = techData?.recommendation;
              const recScore = techData?.recommendationScore;
              const upside = tgt && curP ? +((tgt - curP) / curP * 100).toFixed(1) : null;

              // 가격 범위 바 계산
              const minP = tgtLow || (curP * 0.7);
              const maxP = tgtHigh || (tgt ? tgt * 1.2 : curP * 1.3);
              const rangeP = maxP - minP || 1;
              const curPct = ((curP - minP) / rangeP) * 100;
              const tgtPct = tgt ? ((tgt - minP) / rangeP) * 100 : null;

              const recLabels = {
                buy: t("diag.rec.buy"), strongBuy: t("diag.rec.strongBuy"), strong_buy: t("diag.rec.strongBuy"),
                hold: t("diag.rec.hold"), sell: t("diag.rec.sell"),
                underperform: t("diag.rec.underperform"), overweight: t("diag.rec.overweight"),
              };
              const recColors = { buy: C.green, strongBuy: C.green, strong_buy: C.green, hold: C.yellow, sell: C.red, underperform: C.red, overweight: C.green };

              return (
              <div style={{ background: C.card, borderRadius: "12px", padding: "16px", marginBottom: "8px", border: `1px solid ${C.border}` }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
                  <span style={{ fontSize: "16px", fontWeight: 700, color: C.text3 }}>{t("diag.analystConsensus")}</span>
                  {cnt > 0 && <span style={{ fontSize: "15px", color: C.text3, background: C.card2, padding: "2px 6px", borderRadius: "4px" }}>{t("diag.analystCount", { n: cnt })}</span>}
                </div>

                {/* 투자의견 배지 */}
                {rec && (
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
                    <span style={{
                      fontSize: "18px", fontWeight: 800, padding: "4px 12px", borderRadius: "8px",
                      background: `${recColors[rec] || C.yellow}18`, color: recColors[rec] || C.yellow,
                    }}>
                      {recLabels[rec] || rec}
                    </span>
                    {recScore && (
                      <span style={{ fontSize: "15px", color: C.text3 }}>
                        {t("mobile.kit.score")} {recScore.toFixed(1)}/5
                      </span>
                    )}
                  </div>
                )}

                {/* 목표주가 요약 */}
                {tgt && (
                  <div style={{ display: "flex", gap: "0", marginBottom: "12px" }}>
                    {[
                      { label: t("diag.targetPrice"), value: tgt, main: true },
                      { label: t("diag.highest"), value: tgtHigh },
                      { label: t("diag.lowest"), value: tgtLow },
                    ].filter(v => v.value).map((item, idx) => (
                      <div key={item.label} style={{
                        flex: 1, textAlign: "center",
                        ...(idx < 2 ? { borderRight: `1px solid ${C.border}40` } : {}),
                      }}>
                        <div style={{ fontSize: "14px", color: C.text3 }}>{item.label}</div>
                        <div style={{ fontSize: item.main ? "18px" : "14px", fontWeight: 800, color: item.main ? (upside > 0 ? C.green : C.red) : C.text2 }}>
                          ${item.value.toFixed(2)}
                        </div>
                        {item.main && upside != null && (
                          <div style={{ fontSize: "16px", fontWeight: 700, color: upside > 0 ? C.green : C.red, marginTop: "1px" }}>
                            {upside > 0 ? "▲" : "▼"} {Math.abs(upside)}%
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* 가격 범위 바 (현재가 vs 목표가 시각화) */}
                {tgt && curP && (
                  <div style={{ position: "relative", height: "36px", marginBottom: "4px" }}>
                    {/* 바 배경 */}
                    <div style={{ position: "absolute", top: "14px", left: 0, right: 0, height: "8px", background: `${C.border}50`, borderRadius: "4px" }}>
                      {/* 목표 범위 (Low~High) */}
                      {tgtLow && tgtHigh && (
                        <div style={{
                          position: "absolute", top: 0, height: "100%", borderRadius: "4px",
                          left: `${Math.max(((tgtLow - minP) / rangeP) * 100, 0)}%`,
                          width: `${Math.min(((tgtHigh - tgtLow) / rangeP) * 100, 100)}%`,
                          background: `${C.blue}25`,
                        }} />
                      )}
                    </div>
                    {/* 현재가 마커 */}
                    <div style={{
                      position: "absolute", top: "6px", left: `${Math.min(Math.max(curPct, 2), 98)}%`, transform: "translateX(-50%)",
                      display: "flex", flexDirection: "column", alignItems: "center",
                    }}>
                      <div style={{ fontSize: "14px", fontWeight: 700, color: C.text2, whiteSpace: "nowrap" }}>{t("diag.currentMarker")}</div>
                      <div style={{ width: "3px", height: "16px", background: C.text1, borderRadius: "4px" }} />
                    </div>
                    {/* 목표가 마커 */}
                    {tgtPct != null && (
                      <div style={{
                        position: "absolute", top: "6px", left: `${Math.min(Math.max(tgtPct, 2), 98)}%`, transform: "translateX(-50%)",
                        display: "flex", flexDirection: "column", alignItems: "center",
                      }}>
                        <div style={{ fontSize: "14px", fontWeight: 700, color: C.blue, whiteSpace: "nowrap" }}>{t("diag.targetMarker")}</div>
                        <div style={{ width: "3px", height: "16px", background: C.blue, borderRadius: "4px" }} />
                      </div>
                    )}
                  </div>
                )}

                {/* Financial Datasets 추가 정보 */}
                {fd?.estRevenue && (
                  <div style={{ display: "flex", gap: "12px", paddingTop: "8px", borderTop: `1px solid ${C.border}40` }}>
                    {fd.estRevenue && <span style={{ fontSize: "15px", color: C.text3 }}>{t("diag.fin.estRevenue")} <span style={{ fontWeight: 700, color: C.text1 }}>{fmtMoney(fd.estRevenue)}</span></span>}
                    {fd.estEps && <span style={{ fontSize: "15px", color: C.text3 }}>{t("diag.fin.estEps")} <span style={{ fontWeight: 700, color: C.text1 }}>${fd.estEps.toFixed(2)}</span></span>}
                  </div>
                )}
              </div>
              );
            })()}

            {/* ── 5. 적정주가 ── */}
            {techData?.fairValue != null && (() => {
              const fv = techData.fairValue;
              const fp = techData.fairPremium;
              const curP = techData.price;
              const models = techData.models || [];
              // ★ 2026-06-12 (대표 제보): 한국 종목이 $247941.88 처럼 달러로 표기되던 버그 — 시장별 통화 포맷
              const fmtFv = (v) => asset.market === "kr" ? `₩${Math.round(v).toLocaleString()}` : `$${v.toFixed(2)}`;
              return (
              <div style={{ background: C.card, borderRadius: "12px", padding: "16px", marginBottom: "8px", border: `1px solid ${C.border}` }}>
                <div style={{ fontSize: "16px", fontWeight: 700, color: C.text3, marginBottom: "10px" }}>{t("diag.fin.fairValueAnalysis")}</div>
                <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "10px" }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: "15px", color: C.text3 }}>{t("diag.fin.compositeFairValue")}</div>
                    <div style={{ fontSize: "20px", fontWeight: 800, color: C.text1 }}>{fmtFv(fv)}</div>
                  </div>
                  <div style={{
                    padding: "6px 14px", borderRadius: "10px", textAlign: "center",
                    background: fp > 10 ? `${C.red}15` : fp > 5 ? `${C.yellow}15` : fp < -10 ? `${C.green}15` : fp < -5 ? `${C.green}10` : `${C.text3}10`,
                  }}>
                    <div style={{ fontSize: "15px", color: C.text3 }}>{t("diag.fin.priceGap")}</div>
                    <div style={{
                      fontSize: "18px", fontWeight: 800,
                      color: fp > 5 ? C.red : fp < -5 ? C.green : C.yellow,
                    }}>{fp > 0 ? "+" : ""}{fp}%</div>
                    <div style={{
                      fontSize: "14px", fontWeight: 700,
                      color: fp > 5 ? C.red : fp < -5 ? C.green : C.yellow,
                    }}>
                      {fp > 15 ? t("diag.fin.veryOvervalued") : fp > 10 ? t("diag.fin.overvalued") : fp > 5 ? t("diag.fin.slightlyOvervalued") : fp < -15 ? t("diag.fin.veryUndervalued") : fp < -10 ? t("diag.fin.undervalued") : fp < -5 ? t("diag.fin.slightlyUndervalued") : t("diag.fin.fairRange")}
                    </div>
                  </div>
                </div>
                {/* 모델별 상세 */}
                {models.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                    {models.map(m => {
                      const diff = curP ? ((curP - m.value) / m.value * 100) : 0;
                      return (
                        <div key={m.name} style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "15px" }}>
                          <span style={{ width: "14px" }}>{m.icon}</span>
                          <span style={{ color: C.text3, flex: 1 }}>{m.name}</span>
                          <span style={{ fontWeight: 700, color: C.text1 }}>{fmtFv(m.value)}</span>
                          <span style={{
                            fontWeight: 700, width: "42px", textAlign: "right",
                            color: diff > 5 ? C.red : diff < -5 ? C.green : C.text3,
                          }}>{diff > 0 ? "+" : ""}{diff.toFixed(0)}%</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              );
            })()}

            {/* 데이터 출처 */}
            <div style={{ fontSize: "14px", color: C.text3, textAlign: "right", opacity: 0.5, marginTop: "2px" }}>
              via {fd ? "Financial Datasets API" : "Yahoo Finance"}
              {techData?.earningsDate && ` · ${t("diag.nextEarnings")} ${new Date(techData.earningsDate * 1000).toLocaleDateString(lang === "en" ? "en-US" : "ko-KR")}`}
            </div>
            </>
            )}
          </div>
          );
        })()}

        {/* 적정주가 섹션은 위 토스 스타일 기업정보 5번 섹션으로 통합됨 */}

        {/* ═══ 기술적 지표 요약 ═══ */}
        {techData && (
          <div style={{ padding: "14px 16px 0" }}>
            <div style={{ background: C.card, borderRadius: "16px", padding: "16px", border: `1px solid ${C.border}` }}>
              <div style={{ fontSize: "14px", fontWeight: 800, color: C.text1, marginBottom: "10px" }}>{t("diag.technicalIndicators")}</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(96px, 1fr))", gap: "6px" }}>
                {[
                  { label: "RSI(14)", value: techData.rsi, color: techData.rsi <= 30 ? C.purple : techData.rsi >= 70 ? C.red : C.text2 },
                  { label: t("diag.ind.vsMa200"), value: techData.ma200Dist != null ? `${techData.ma200Dist > 0 ? "+" : ""}${techData.ma200Dist}%` : "—", color: techData.ma200Dist > 10 ? C.red : techData.ma200Dist < -10 ? C.green : C.text2 },
                  { label: t("diag.ind.volRatio"), value: `${techData.volRatio}x`, color: techData.volRatio >= 2 ? C.red : C.text2 },
                  { label: t("diag.ind.stochastic"), value: techData.stoch ? `${techData.stoch.k}` : "—", color: techData.stoch?.k < 20 ? C.purple : techData.stoch?.k > 80 ? C.red : C.text2 },
                  { label: "W%R", value: techData.wr != null ? `${techData.wr}` : "—", color: techData.wr < -80 ? C.purple : techData.wr > -20 ? C.red : C.text2 },
                  { label: t("diag.ind.pos52w"), value: techData.high52w && techData.low52w ? `${((techData.price - techData.low52w) / (techData.high52w - techData.low52w) * 100).toFixed(0)}%` : "—" },
                  { label: "CMF", value: enriched.cmf != null ? `${enriched.cmf > 0 ? "+" : ""}${enriched.cmf.toFixed(3)}` : "—", color: enriched.cmf != null ? (enriched.cmf > 0.1 ? C.green : enriched.cmf < -0.1 ? C.red : C.text2) : C.text2, sub: enriched.cmf != null ? (enriched.cmf > 0.1 ? t("diag.ind.accumStrong") : enriched.cmf < -0.1 ? t("diag.ind.distWarning") : t("tabs.home.neutral")) : null },
                  { label: "MFI(14)", value: enriched.mfi != null ? `${Math.round(enriched.mfi)}` : "—", color: enriched.mfi != null ? (enriched.mfi < 20 ? C.purple : enriched.mfi > 80 ? C.red : C.text2) : C.text2, sub: enriched.mfi != null ? (enriched.mfi < 20 ? t("diag.ind.oversold") : enriched.mfi > 80 ? t("diag.ind.overbought") : enriched.mfi < 40 ? t("diag.ind.weak") : enriched.mfi > 60 ? t("diag.ind.strong") : t("tabs.home.neutral")) : null },
                  { label: "ADX", value: enriched.adx != null ? `${enriched.adx}` : "—", color: enriched.adx != null ? (enriched.adx >= 25 ? (enriched.plusDI > enriched.minusDI ? C.green : C.red) : C.text3) : C.text2, sub: enriched.adx != null ? (enriched.adx >= 25 ? (enriched.plusDI > enriched.minusDI ? t("diag.ind.plusDiDominant") : t("diag.ind.minusDiDominant")) : t("diag.ind.weakTrend")) : null },
                ].map(({ label, value, color, sub }) => (
                  <div key={label} style={{ background: C.card2, borderRadius: "10px", padding: "8px 10px", textAlign: "center" }}>
                    <div style={{ fontSize: "14px", color: C.text3, marginBottom: "3px" }}>{label}</div>
                    <div style={{ fontWeight: 700, fontSize: "18px", color: color || C.text1 }}>{value}</div>
                    {sub && <div style={{ fontSize: "14px", color: C.text3, marginTop: "2px" }}>{sub}</div>}
                  </div>
                ))}
              </div>
              {/* 수급 지표 (CMF/MFI) */}
              {(enriched.cmf != null || enriched.mfi != null) && (
                <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: "10px", paddingTop: "10px", borderTop: `1px solid ${C.border}40` }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <span style={{ fontSize: "15px", fontWeight: 700, color: C.text3 }}>{t("diag.flowSection")}</span>
                    {enriched.macdDivType && (
                      <span style={{ fontSize: "14px", fontWeight: 700, padding: "2px 7px", borderRadius: "6px",
                        background: enriched.macdDivType === "bullish" ? `${C.green}18` : `${C.red}18`,
                        color: enriched.macdDivType === "bullish" ? C.green : C.red,
                      }}>{enriched.macdDivType === "bullish" ? "MACD ↑" : "MACD ↓"}</span>
                    )}
                    {enriched.obvDivType && (
                      <span style={{ fontSize: "14px", fontWeight: 700, padding: "2px 7px", borderRadius: "6px",
                        background: enriched.obvDivType === "bullish" ? `${C.green}18` : `${C.red}18`,
                        color: enriched.obvDivType === "bullish" ? C.green : C.red,
                      }}>{enriched.obvDivType === "bullish" ? "OBV ↑" : "OBV ↓"}</span>
                    )}
                  </div>
                  {enriched.cmf != null && (
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <span style={{ fontSize: "15px", color: C.text3, width: "30px", flexShrink: 0 }}>CMF</span>
                      <div style={{ flex: 1, height: "6px", background: `${C.border}40`, borderRadius: "4px", overflow: "hidden", position: "relative" }}>
                        <div style={{ position: "absolute", left: "50%", top: 0, width: "1px", height: "100%", background: C.text3 + "44" }} />
                        <div style={{
                          position: "absolute", top: 0, height: "100%", borderRadius: "4px",
                          background: enriched.cmf >= 0 ? C.green : C.red,
                          left: enriched.cmf >= 0 ? "50%" : `${50 + (enriched.cmf * 100)}%`,
                          width: `${Math.min(Math.abs(enriched.cmf) * 100, 50)}%`,
                        }} />
                      </div>
                      <span style={{ fontSize: "16px", fontWeight: 700, color: enriched.cmf > 0.1 ? C.green : enriched.cmf < -0.1 ? C.red : C.text2, width: "42px", textAlign: "right" }}>
                        {enriched.cmf > 0 ? "+" : ""}{enriched.cmf.toFixed(3)}
                      </span>
                    </div>
                  )}
                  {enriched.mfi != null && (
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <span style={{ fontSize: "15px", color: C.text3, width: "30px", flexShrink: 0 }}>MFI</span>
                      <div style={{ flex: 1, height: "6px", background: `${C.border}40`, borderRadius: "4px", overflow: "hidden" }}>
                        <div style={{
                          height: "100%", borderRadius: "4px",
                          width: `${enriched.mfi}%`,
                          background: enriched.mfi < 20 ? C.purple : enriched.mfi > 80 ? C.red : enriched.mfi < 30 ? C.green : enriched.mfi > 70 ? C.yellow : C.blue,
                        }} />
                      </div>
                      <span style={{ fontSize: "16px", fontWeight: 700, color: enriched.mfi < 20 ? C.purple : enriched.mfi > 80 ? C.red : C.text2, width: "24px", textAlign: "right" }}>
                        {Math.round(enriched.mfi)}
                      </span>
                    </div>
                  )}
                </div>
              )}
              {/* 실적 발표일 */}
              {techData.earningsDate && (
                <div style={{ marginTop: "8px", paddingTop: "8px", borderTop: `1px solid ${C.border}40`, fontSize: "15px", color: C.text3, textAlign: "center" }}>
                  📅 {t("diag.nextEarningsAnnouncement")} <span style={{ fontWeight: 700, color: C.text2 }}>{new Date(techData.earningsDate * 1000).toLocaleDateString(lang === "en" ? "en-US" : "ko-KR", { year: "numeric", month: "short", day: "numeric" })}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* 액션 버튼 — 관심 토글은 시안 1a 헤더 별 버튼으로 이동(기능 동일), 차트·상세는 유지 */}
        <div style={{ padding: "14px 16px 12px", display: "flex", gap: "8px" }}>
          <button onClick={() => { onChart(); onClose(); }} style={{
            flex: 1, padding: "12px 0", borderRadius: "12px", fontSize: "15px", fontWeight: 800,
            background: C.blue, color: "#fff", border: "none", cursor: "pointer", fontFamily: "inherit",
            display: "flex", alignItems: "center", justifyContent: "center", gap: "6px",
          }}>📈 {t("diag.viewChart")}</button>
          <a href={asset.market === "crypto"
              ? `https://www.coingecko.com/en/coins/${asset.id || asset.symbolRaw || asset.symbol.toLowerCase()}`
              : `https://finance.yahoo.com/quote/${asset.symbolRaw || asset.symbol}`}
            target="_blank" rel="noopener"
            style={{
              flex: 1, padding: "12px 0", borderRadius: "12px", fontSize: "15px", fontWeight: 800,
              background: C.card, color: C.text2, border: `1px solid ${C.border}`,
              textDecoration: "none", textAlign: "center",
              display: "flex", alignItems: "center", justifyContent: "center", gap: "6px",
            }}>🔗 {t("diag.detailsLink")}</a>
        </div>
        {/* 공유 버튼 — 바이럴 */}
        <div style={{ padding: "0 16px 16px" }}>
          <button onClick={() => {
            // ★ 2026-08-10 (전수 감사): techData.overallScore 는 존재하지 않는 필드라 항상
            //   "0점 (매도)" 로 공유되던 실버그. 화면 게이지와 같은 diag 를 단일 진실원천으로 쓰고,
            //   출처 문구도 실제 산출 방식(기술적 지표 종합)으로 정정. 라벨은 상태 서술(3원칙).
            const shareText = t("diag.shareText", { name: asset.name, symbol: asset.symbol, score: diag.score, verdict: verdictLabel(diag.verdict, t) });
            if (navigator.share) {
              navigator.share({ title: t("diag.shareDiagTitle", { name: asset.name }), text: shareText, url: "https://zepta.app" }).catch(() => {});
            } else {
              navigator.clipboard.writeText(shareText).then(() => showToast(t("diag.diagCopied"), "success")).catch(() => {});
            }
          }} style={{
            width: "100%", padding: "10px 0", borderRadius: "12px", fontSize: "14px", fontWeight: 700, fontFamily: "inherit",
            background: "transparent", color: C.text3, border: `1px solid ${C.border}${C.isDark ? '30' : '50'}`,
            cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px",
            transition: "all .15s",
          }}
          onMouseEnter={e => { e.currentTarget.style.background = C.card2; e.currentTarget.style.color = C.text2; }}
          onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = C.text3; }}
          >📤 {t("diag.shareDiag")}</button>
        </div>
        {/* 면책 — 이 팝업은 전역 푸터 면책을 가리는 오버레이라 화면 내 고지가 필요합니다 (2026-08 전수 감사) */}
        <div style={{ padding: "0 16px 18px" }}>
          <Disclaimer style={{ fontSize: "12px", textAlign: "center", padding: 0 }}>
            {t("diag.popupDisclaimer")}
          </Disclaimer>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// 스크리너 프리셋 설정
// ════════════════════════════════════════════════════════════════════
const SCREENER_PRESETS = [
  { id: "momentum_up", name: "연속 상승세", icon: "🚀", desc: "강한 상승 모멘텀 종목", popular: true,
    conditions: ["adx_bullish", "ma_ribbon", "volume_climax"], mode: "and", color: "green" },
  { id: "undervalued_growth", name: "저평가 성장주", icon: "💎", desc: "성장성 대비 저평가 종목", popular: true,
    conditions: ["rsi_extreme", "mean_reversion", "obv_divergence"], mode: "or", color: "blue" },
  { id: "value_cheap", name: "아직 저렴한 가치주", icon: "🏷️", desc: "52주 저점 근처 반등 가능",
    conditions: ["near_52w_low", "rsi_extreme", "volume_dry"], mode: "or", color: "purple" },
  { id: "dividend_steady", name: "꾸준한 배당주", icon: "💰", desc: "안정적 배당 + 저변동성", popular: true,
    conditions: ["mean_reversion", "near_poc"], mode: "and", color: "green" },
  { id: "money_maker", name: "돈 잘버는 회사", icon: "🏦", desc: "높은 수익성 + 상승 추세",
    conditions: ["adx_trend", "ma_ribbon", "cmf_accumulation"], mode: "and", color: "blue" },
  { id: "reversal", name: "저평가 탈출", icon: "🔄", desc: "반등 시그널 포착",
    conditions: ["rsi_extreme", "bb_squeeze", "golden_cross"], mode: "or", color: "yellow" },
  { id: "future_dividend", name: "미래의 배당왕", icon: "👑", desc: "배당 성장 잠재력",
    conditions: ["adx_bullish", "cmf_accumulation", "volume_climax"], mode: "and", color: "purple" },
  { id: "growth_expect", name: "성장 기대주", icon: "🌱", desc: "고성장 모멘텀 종목",
    conditions: ["macd_divergence", "atr_breakout", "volume_climax"], mode: "or", color: "green" },
  { id: "double_buy", name: "쌍끌이 매수", icon: "🎯", desc: "기관 + 외인 동시 매수 시그널",
    conditions: ["cmf_accumulation", "obv_divergence", "adx_bullish"], mode: "and", color: "blue" },
  { id: "high_yield_underval", name: "고수익 저평가", icon: "⚡", desc: "수익률 높은 저평가 종목",
    conditions: ["near_52w_low", "bb_squeeze", "mfi_oversold"], mode: "or", color: "red" },
  { id: "stable_growth", name: "안정 성장주", icon: "🛡️", desc: "낮은 변동성 + 꾸준한 상승",
    conditions: ["adx_trend", "ma_ribbon", "near_poc"], mode: "and", color: "green" },
];

// ════════════════════════════════════════════════════════════════════
// 메인 앱
// ════════════════════════════════════════════════════════════════════
// 소유자 전용 기능 게이트 (실전매매 탭) — 이 이메일로 로그인한 사용자에게만 노출
const OWNER_EMAIL = "donginseo0421@gmail.com";

// ★ 2026-07 정보 서비스 피벗: 매매 관련 탭 전체를 내부 운영(owner) 전용으로 게이트
//   비owner 접근 시 렌더 차단 + 안내 화면 (real-trading 기존 게이트 패턴 확장)
//   quant-portfolio 는 quant-port 의 별칭 라우트라 함께 포함.
const OWNER_ONLY_TABS = new Set([
  "auto-trading", "real-trading", "alpha-lab", "copy-trading", "leaderboard",
  "reports", "bot-report", "backtest", "backtest-compare", "strategy",
  "quant-port", "quant-portfolio", "alerts", "pricing",
]);

function AppInner() {
  // ★ 2026-08-12 IA v3 (시안 1e): MY 설정 섹션의 언어 토글이 lang/setLang 을 씁니다 —
  //   LanguageContext 의 기존 switchLang(localStorage 영속 포함) 배선을 그대로 노출.
  const { t, lang, setLang } = useLanguage();
  const { user, loading: authLoading, signOut, refreshUser } = useAuth();
  const isOwner = (user?.email || "").toLowerCase() === OWNER_EMAIL;
  const [themeMode, setThemeMode] = useState(loadTheme);
  C = themeMode === "dark" ? DARK : LIGHT;

  // ── 테마 SSOT 동기화 (★ 2026-08 모바일 시안 적용 시 발견) ──
  // App.jsx 는 자체 themeMode(localStorage "ss_theme")로 인라인 C 를 고르는데,
  // ThemeProvider(ui/theme.jsx)는 별도 키("zepta:theme" + prefers-color-scheme)를 씁니다.
  // 그래서 OS 가 라이트 선호면 useThemeTokens() 를 쓰는 컴포넌트(uiKit·mobileKit)만
  // 라이트로 렌더돼 한 화면에 두 팔레트가 섞였습니다. App 의 themeMode 를 단일 진실로
  // 삼아 <html data-theme> 과 토큰 훅을 따라오게 맞춥니다(단방향 — 기존 토글 로직 유지).
  const { setTheme: syncDocTheme } = useTheme();
  useEffect(() => { syncDocTheme(themeMode); }, [themeMode, syncDocTheme]);

  // ── Skeleton 로딩 컴포넌트 ──
  const Skeleton = ({ width = "100%", height = "20px" }) => (
    <div style={{
      width, height, borderRadius: "8px",
      background: `linear-gradient(90deg, ${C.card2} 25%, ${C.border}20 50%, ${C.card2} 75%)`,
      backgroundSize: "200% 100%",
      animation: "shimmer 1.5s infinite",
    }} />
  );


  // ── 토스트 알림 시스템 ──
  const [toasts, setToasts] = useState([]);
  const showToast = useCallback((msg, type = "info") => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev.slice(-4), { id, msg, type }]);
    // ★ 2026-05-12 PLAN-SVC J: 토스트 표시 시간 3000ms → 4000ms (헤더 아래 노출 + 가독성 확보)
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
  }, []);

  // ── 로그인 필요 탭 정의 ──
  const LOGIN_REQUIRED_TABS = ["alerts"];
  const [showAuthModal, setShowAuthModal] = useState(false);

  // 로그인 성공 시 모달 자동 닫기
  useEffect(() => {
    if (user && showAuthModal) {
      setShowAuthModal(false);
    }
  }, [user, showAuthModal]);

  // ── 베타 가입자 수 (MKT-LEAD 2026-05-12) ──
  // ★ 2026-06-14 (대표 지시): 가짜 베타 가입자 추산값(BASELINE 1200) 노출 제거.
  //   실제 가입수는 마케팅 대시보드(/marketing)에서만 표기 — 홈 배너는 '베타 무료' 정직 표기.

  // ── 입문자 온보딩 (PLAN-SVC #5, 2026-05-11) ──
  // 가입 직후 1회 자동 표시. user_metadata.onboarding.completed 로 1회 가드.
  const [showOnboarding, setShowOnboarding] = useState(false);
  const onboardingChecked = useRef(false);
  useEffect(() => {
    if (!user || onboardingChecked.current) return;
    onboardingChecked.current = true;
    try {
      const meta = user.user_metadata || {};
      const remote = meta.onboarding;
      const local = (() => { try { return JSON.parse(localStorage.getItem(`di:onboarding:${user.id}`) || "null"); } catch { return null; } })();
      const completed = !!(remote?.completed || local?.completed);
      if (!completed) setShowOnboarding(true);
    } catch (e) { console.warn("[Onboarding] check failed:", e?.message); }
  }, [user]);
  // 유저 변경 시 가드 리셋
  useEffect(() => { onboardingChecked.current = false; }, [user?.id]);

  // 게스트 접근 허용 — 로그인 필요 기능만 제한
  const requireLogin = useCallback((targetTab) => {
    if (!user && LOGIN_REQUIRED_TABS.includes(targetTab)) {
      setShowAuthModal(true);
      return true;
    }
    return false;
  }, [user]);

  const toggleTheme = useCallback(() => {
    setThemeMode(prev => {
      const next = prev === "dark" ? "light" : "dark";
      try { localStorage.setItem(THEME_KEY, next); } catch {}
      return next;
    });
  }, []);

  // ★ 2026-07 정보 피벗 Phase 1: mypage 추가 — 이전엔 setTab("mypage") 로 진입 후
  //   새로고침하면 홈으로 튕기던 문제(경로 미등록) 해소. 기존 탭 id 는 전부 유지.
  // ★ 2026-07 정보 피벗 Phase 2: indicators(지표 허브) 추가.
  const validTabs = ["home","auto-trading","real-trading","alpha-lab","portfolio","portfolio-analysis","screener","alerts","notifications","saved-screeners","news","quant-portfolio","quant-port","risk-map","backtest","backtest-compare","copy-trading","sentiment","strategy","anomaly","quant-report","econ-calendar","indicators","leaderboard","reports","bot-report","profile","mypage","dev","pricing","about","privacy","terms","contact","marketing"];

  // ★ 2026-08-12 IA v3 (설계서 v3 0장·8장 — 대표 확정 "자산군 이원화"): 하단 탭이
  //   [홈 · 코인 · 주식 · 지표 · MY] 로 재편됩니다. 내부 탭 id(news/screener)는 setTab
  //   배선 수십 곳과 Header.jsx gnbCategoryMap 호환을 위해 그대로 두고, 사용자에게
  //   보이는 "URL 경로"만 새 IA 로 이원화합니다.
  //   · /crypto ↔ news(코인 탭) · /stocks ↔ screener(주식 탭)
  //   · 구 URL(/news·/screener·?tab=)은 계속 해석(북마크 무효화 금지) + 진입 직후
  //     replaceState 로 새 경로 정정. sessionStorage 복원값은 내부 id 라 그대로 호환.
  const TAB_TO_PATH = { news: "crypto", screener: "stocks" }; // 내부 id → 새 경로
  const PATH_TO_TAB = { crypto: "news", stocks: "screener" }; // 새 경로 → 내부 id

  // ── 경로 → tab 변환 ──
  //   /reports             → "reports"
  //   /reports/stable-quant → "bot-report" (botId 별도 state)
  //   /crypto·/stocks      → IA v3 새 경로 (내부 id 로 역매핑)
  //   그 외                 → validTabs 매칭 (구 경로 /news·/screener 포함)
  const resolvePathToTab = (rawPath) => {
    const path = String(rawPath || "").replace(/^\//, "").replace(/\/$/, "");
    if (!path) return { tab: null, botId: null };
    const reportsMatch = path.match(/^reports\/([a-zA-Z0-9_-]+)$/);
    if (reportsMatch) return { tab: "bot-report", botId: reportsMatch[1] };
    if (path === "reports") return { tab: "reports", botId: null };
    if (PATH_TO_TAB[path]) return { tab: PATH_TO_TAB[path], botId: null };
    if (validTabs.includes(path)) return { tab: path, botId: null };
    return { tab: null, botId: null };
  };

  const [reportBotId, setReportBotId] = useState(() => {
    try { return resolvePathToTab(window.location.pathname).botId; } catch { return null; }
  });

  const [tab, setTabRaw] = useState(() => {
    try {
      // 1순위: URL pathname (/screener, /auto-trading, /reports/<botId> 등)
      const resolved = resolvePathToTab(window.location.pathname);
      if (resolved.tab) return resolved.tab;
      // 2순위: URL ?tab= 파라미터 (레거시 호환 — IA v3 새 이름 crypto/stocks 도 수용)
      const p = new URLSearchParams(window.location.search);
      const t0 = p.get("tab");
      const t = t0 ? (PATH_TO_TAB[t0] || t0) : null;
      if (t && validTabs.includes(t)) return t;
      // 사이트링크 검색박스(?q=) 진입 → 스크리너로 (검색어는 assetQuery 가 시드)
      if (p.get("q")) return "screener";
      // 3순위: sessionStorage (새로고침 시 복원)
      const saved = sessionStorage.getItem("zepta_tab");
      if (saved && validTabs.includes(saved)) return saved;
    } catch {}
    return "home";
  });
  const setTab = useCallback((newTab) => {
    // "reports/<botId>" 형식 허용 — bot-report 페이지 + botId 동시 설정
    let actualTab = newTab;
    let botId = null;
    if (typeof newTab === "string" && newTab.startsWith("reports/")) {
      botId = newTab.split("/")[1] || null;
      actualTab = "bot-report";
    }
    setTabRaw(actualTab);
    setReportBotId(botId);
    try {
      sessionStorage.setItem("zepta_tab", actualTab);
      // URL을 경로 기반으로 업데이트 (페이지 리로드 없이) — IA v3 새 경로 우선
      let newPath;
      if (actualTab === "home") newPath = "/";
      else if (actualTab === "bot-report" && botId) newPath = `/reports/${botId}`;
      else newPath = `/${TAB_TO_PATH[actualTab] || actualTab}`;
      if (window.location.pathname !== newPath) {
        window.history.pushState({ tab: actualTab, botId }, "", newPath);
      }
    } catch {}
    // 탭 전환 시 스크롤 최상단으로 이동
    window.scrollTo({ top: 0, behavior: "instant" });
  }, []);

  // ★ 2026-08-12 (대표 실보고: "MY 누르면 가끔 아래쪽부터 보임"): 위 scrollTo 는 클릭
  //   "시점"에만 실행돼, iOS 모멘텀 스크롤이 진행 중이면 관성이 이겨서 새 탭이 중간
  //   위치에서 열렸습니다. 새 탭 콘텐츠가 실제로 커밋된 "이후"에 한 번 더 고정합니다.
  //   브라우저의 SPA 히스토리 스크롤 복원도 수동으로 전환(이중 안전).
  useEffect(() => {
    try { if ("scrollRestoration" in window.history) window.history.scrollRestoration = "manual"; } catch {}
  }, []);
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }, [tab]);

  // ── 브라우저 뒤로가기/앞으로가기 지원 ──
  useEffect(() => {
    const onPopState = () => {
      const resolved = resolvePathToTab(window.location.pathname);
      if (resolved.tab) {
        setTabRaw(resolved.tab);
        setReportBotId(resolved.botId);
        try { sessionStorage.setItem("zepta_tab", resolved.tab); } catch {}
      } else {
        setTabRaw("home");
        setReportBotId(null);
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  // ── IA v3 구 URL 정정: /news·/screener 로 들어온 세션의 주소창을 새 경로로 교체 ──
  //   탭 해석은 위 initializer 가 이미 끝냈으므로 여기서는 주소만 replaceState 로
  //   조용히 바꿉니다(리로드·히스토리 오염 없음, 쿼리·해시 보존 — 북마크 무효화 금지).
  useEffect(() => {
    try {
      const path = window.location.pathname.replace(/^\//, "").replace(/\/$/, "");
      if (TAB_TO_PATH[path]) {
        window.history.replaceState(
          { tab: path, botId: null }, "",
          `/${TAB_TO_PATH[path]}${window.location.search}${window.location.hash}`
        );
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ★ IA v3 (설계서 v3 4장): 지표 탭 서브뷰 [캘린더|뉴스].
  //   딥링크 /indicators?view=news 를 시드로 받고, 홈의 "톱 뉴스 더보기"가
  //   setIndicatorsView("news") → setTab("indicators") 로 직행합니다.
  //   렌더 소비(서브탭 UI)는 슬라이스 2(지표 탭 재구성)가 담당 — prop 계약: view.
  const [indicatorsView, setIndicatorsView] = useState(() => {
    try {
      return new URLSearchParams(window.location.search).get("view") === "news" ? "news" : "calendar";
    } catch { return "calendar"; }
  });
  // ★ 서브탭 ↔ URL 동기화: setTab 은 pushState("/indicators") 만 하므로, 홈 "뉴스 더보기"로
  //   들어오면 ?view=news 가 URL 에 남지 않아 새로고침·공유 시 캘린더로 착지했습니다
  //   (적대 리뷰 지적). 지표 탭에 있는 동안 현재 서브뷰를 replaceState 로 반영합니다.
  useEffect(() => {
    if (tab !== "indicators") return;
    try {
      const want = indicatorsView === "news" ? "/indicators?view=news" : "/indicators";
      if (window.location.pathname + window.location.search !== want) {
        window.history.replaceState({ tab: "indicators", view: indicatorsView }, "", want);
      }
    } catch {}
  }, [tab, indicatorsView]);

  // ★ IA v3 (설계서 v3 4장): 구 경제 캘린더 탭(econ-calendar)은 지표 탭 캘린더 서브탭이
  //   흡수했습니다. 수십 곳의 기존 setTab("econ-calendar") 배선·북마크(/econ-calendar)는
  //   그대로 두고, 진입 시 여기서 지표 탭으로 정정합니다(캘린더 서브탭 강제 — 기능 동일).
  //   ⚠️ setTab(pushState)이 아니라 replaceState — 뒤로가기가 /econ-calendar 로 돌아와
  //   다시 밀려나는 히스토리 루프를 만들지 않기 위함입니다.
  useEffect(() => {
    if (tab === "econ-calendar") {
      setIndicatorsView("calendar");
      setTabRaw("indicators");
      try {
        sessionStorage.setItem("zepta_tab", "indicators");
        window.history.replaceState({ tab: "indicators", botId: null }, "", "/indicators");
      } catch {}
    }
  }, [tab]);

  // 서브탭 전환 — 딥링크(/indicators?view=news)가 공유·복원되도록 주소만 조용히 동기화.
  const setIndicatorsViewWithUrl = useCallback((v) => {
    setIndicatorsView(v);
    try {
      window.history.replaceState(window.history.state, "",
        v === "news" ? "/indicators?view=news" : "/indicators");
    } catch {}
  }, []);

  // ── 탭별 SEO 메타 정보 (제목, 설명, OG 태그용) ──
  // ★ i18n: 탭 키 → seo.<slug>.title/desc 사전 조회 (한/영 로케일 대응 — 대표 지시)
  const TAB_META = Object.fromEntries([
    ["home", "home"],
    // ★ 2026-08-12 IA v3 (자산군 이원화): screener=주식 탭(/stocks) · news=코인 탭(/crypto).
    //   내부 id 는 유지하고 노출 메타만 새 탭 정체성에 맞춥니다.
    ["screener", "screener"], ["auto-trading", "autoTrading"], ["portfolio", "portfolio"],
    ["news", "coin"], ["econ-calendar", "econCalendar"], ["indicators", "indicators"],
    ["sentiment", "sentiment"], ["alerts", "alerts"], ["anomaly", "anomaly"],
    ["strategy", "strategy"], ["backtest", "backtest"], ["quant-port", "quantPort"],
    ["risk-map", "riskMap"], ["quant-report", "quantReport"], ["profile", "profile"],
    ["about", "about"],
  ].map(([tabId, slug]) => [tabId, { title: t(`seo.${slug}.title`), desc: t(`seo.${slug}.desc`) }]));

  // ── GNB 카테고리 상태 ──
  // ★ 2026-08-12 IA v3: 홈 / 코인 / 주식 / 지표 / MY (+owner 트레이딩)
  //   Header.jsx 의 gnbCategoryMap 과 반드시 동기 유지해야 합니다 (동일 그룹 재편 반영 —
  //   anomaly·risk-map·quant-report 는 지표 축, saved-screeners 는 MY 축으로 이동).
  const gnbCategoryMap = {
    "home": "home",
    // 코인 — 구 뉴스 슬롯이 코인 탭으로 (설계서 v3 2장)
    "news": "coin",
    // 주식 — 구 '시장'(스크리너) 승계 (설계서 v3 3장)
    "screener": "stock",
    // 지표 — 캘린더|뉴스 + 시장 상태 도구 (자산군 불문)
    "indicators": "indicators",
    "econ-calendar": "indicators",
    "sentiment": "indicators",
    "anomaly": "indicators",
    "risk-map": "indicators",
    "quant-report": "indicators",
    // 트레이딩 (내부 운영 전용) — 전략 검증 도구 포함
    "auto-trading": "ai-quant",
    "real-trading": "ai-quant",
    "alpha-lab": "ai-quant",
    "backtest": "ai-quant",
    "backtest-compare": "ai-quant",
    "copy-trading": "ai-quant",
    "leaderboard": "ai-quant",
    "reports": "ai-quant",
    "bot-report": "ai-quant",
    "strategy": "ai-quant",
    // MY (개인화) — ★ IA v3: saved-screeners 가 시장 → MY 로 이동
    "portfolio": "my",
    "portfolio-analysis": "my",
    "saved-screeners": "my",
    "quant-port": "my",
    "quant-portfolio": "my",
    "notifications": "my",
    "alerts": "my",
    "pricing": "my",
    "profile": "my",
    "mypage": "my",
  };
  const [gnbCategory, setGnbCategory] = useState(() => gnbCategoryMap[tab] || "home");

  // ── GNB 카테고리 동기화 (tab 변경 시) ──
  useEffect(() => {
    const newCategory = gnbCategoryMap[tab] || "home";
    setGnbCategory(newCategory);
  }, [tab]);

  // (구 인앱 GNB 의 호버·드롭다운·사이드바 state 는 Header.jsx 자체 state 로 이관 완료되어
  //  2026-08 정리에서 제거했습니다 — GNB 를 손볼 때는 src/components/Header.jsx 를 보세요.)

  // ── 모바일 감지 (폰트 크기 보정용) ──
  // ★ SSOT — useIsMobile (src/ui/useBreakpoint.jsx). 이전 자체 useState +
  //   matchMedia 6곳 중복 → 단일 hook 으로 통일.
  const isMobile = useIsMobile();
  // 폰트 크기 헬퍼: PC/모바일 가독성 자동 보정
  // PC: 작은 폰트 전체적으로 2~3px 스케일업
  // 모바일: 최소 가독성 보장
  const mf = useCallback((px) => {
    if (isMobile) {
      if (px <= 9) return "12px";
      if (px <= 10) return "12px";
      if (px <= 11) return "14px";
      if (px <= 12) return "14px";
      return `${px}px`;
    }
    // PC: 전체적으로 폰트 스케일업 (웹접근성 개선)
    if (px <= 9) return "12px";
    if (px <= 10) return "14px";
    if (px <= 11) return "14px";
    if (px <= 12) return "14px";
    if (px <= 13) return "15px";
    if (px <= 14) return "16px";
    if (px <= 15) return "18px";
    if (px <= 16) return "18px";
    return `${Math.round(px * 1.12)}px`;
  }, [isMobile]);

  // ── AbortController & 요청 중복 방지 refs ──
  const abortRef = useRef(null);
  const fetchingRef = useRef(false);
  // ★ 2026-08-09 (대표 실보고 "로딩이 너무 오래 걸려") — fetchMarketOverview 2단 분리용.
  //   ownerRef: useCallback([]) 안에서 최신 isOwner 를 읽기 위한 미러(스테일 클로저 방지).
  //   marketExtrasAtRef: owner 대시보드 확장 데이터(장외가·섹터·추천)의 마지막 갱신 시각 — 5분 스로틀.
  const ownerRef = useRef(false);
  const marketExtrasAtRef = useRef(0);
  useEffect(() => { ownerRef.current = isOwner; }, [isOwner]);
  // ★ 2026-08-10 (#215 회귀 수정): /quant-report 는 공개 탭인데 dailyPicks 가 owner 게이트
  //   뒤에 있어 비owner 에게 "상승 신호 감지 0 / 0 종목"이 표시됐습니다. 추천 스캔(yahoo 2회)만
  //   게이트 밖으로 분리 — tab 미러와 전용 스로틀(공유하면 owner 경로와 서로 굶깁니다)을 씁니다.
  const tabForFetchRef = useRef("home");
  const picksAtRef = useRef(0);
  useEffect(() => { tabForFetchRef.current = tab; }, [tab]);

  // ── 홈 대시보드 상태 ───────────────────────────────────────────
  const [marketIndices, setMarketIndices] = useState([]);
  const [marketLoading, setMarketLoading] = useState(false);
  const [hotAssets, setHotAssets] = useState([]);
  const [dailyPicks, setDailyPicks] = useState([]);
  const [fearGreed, setFearGreed] = useState({ stock: null, crypto: null });
  const [extendedHours, setExtendedHours] = useState({});
  const [sectorPerf, setSectorPerf] = useState([]);
  const [econEvents, setEconEvents] = useState([]);
  const [econExpanded, setEconExpanded] = useState(false);
  const [hotExpanded, setHotExpanded] = useState(false);
  const [picksExpanded, setPicksExpanded] = useState(false);
  const [econSort, setEconSort] = useState("date-asc"); // date-asc, date-desc, type
  const [econFilter, setEconFilter] = useState("all"); // all, upcoming, past, FOMC, CPI, NFP, GDP, PCE
  const [calYear, setCalYear] = useState(() => new Date().getFullYear());
  const [calMonth, setCalMonth] = useState(() => new Date().getMonth());
  const [calSelectedDay, setCalSelectedDay] = useState(null); // 경제캘린더 선택된 날짜
  const [calWeekAnchorMs, setCalWeekAnchorMs] = useState(null); // 시안 1c: 모바일 주간 스트립 앵커(ms) — null = 오늘이 속한 주
  const [econExpandedKey, setEconExpandedKey] = useState(null); // 경제캘린더 해석 펼침 행
  const [predictionState, setPredictionState] = useState(() => {
    try {
      const todayKey = new Date().toISOString().slice(0, 10);
      return JSON.parse(localStorage.getItem(`zepta:pred:${todayKey}`));
    } catch { return null; }
  });
  const [quizAnswered, setQuizAnswered] = useState(() => {
    try {
      const todayKey = new Date().toISOString().slice(0, 10);
      return JSON.parse(localStorage.getItem(`zepta:quiz:${todayKey}`));
    } catch { return null; }
  });
  const [homeSection, setHomeSection] = useState({
    market: true, watchlist: true, calendar: false, fearGreed: false,
    sector: false, signal: false, hotAssets: true, allAssets: false,
  });
  const toggleSection = useCallback((key) => setHomeSection(p => ({ ...p, [key]: !p[key] })), []);

  // ═══════════════════════════════════════════════════════════════
  // 개인화 데이터 Supabase 동기화 시스템
  // localStorage(즉시) + Supabase user_metadata(디바운스) 이중 저장
  // 로그인 시 서버 데이터 우선 머지, 비로그인 시 localStorage만 사용
  // ═══════════════════════════════════════════════════════════════
  const userDataLoaded = useRef(false);
  const userDataSaveTimer = useRef(null);
  // 서버 → localStorage 복원 완료 신호 — 복원 전에 streak 등을 증가시키면
  // 뒤늦게 도착한 서버 값이 증가분을 덮어쓰는 race 가 생겨, 완료 후에만 기록합니다.
  const [userDataRestored, setUserDataRestored] = useState(false);

  // 개인화 데이터 localStorage 읽기 헬퍼
  const readUserLocal = useCallback((key, fallback = null) => {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
  }, []);

  // 개인화 데이터 localStorage 쓰기 + Supabase 동기화 헬퍼
  const writeUserLocal = useCallback((key, value) => {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  }, []);

  // Supabase에 개인화 데이터 통합 저장 (디바운스 500ms)
  const syncUserDataToSupabase = useCallback(() => {
    if (!user) return;
    if (userDataSaveTimer.current) clearTimeout(userDataSaveTimer.current);
    userDataSaveTimer.current = setTimeout(async () => {
      try {
        const todayKey = new Date().toISOString().slice(0, 10);
        const payload = {
          streak: readUserLocal("zepta:streak", {}),
          daily_quest: readUserLocal("zepta:daily-quest", {}),
          pred_stats: readUserLocal("zepta:pred:stats", { total: 0, correct: 0 }),
          quiz_stats: readUserLocal("zepta:quiz:stats", { total: 0, correct: 0 }),
          pred_today: readUserLocal(`zepta:pred:${todayKey}`, null),
          quiz_today: readUserLocal(`zepta:quiz:${todayKey}`, null),
          xp_data: readUserLocal(`zepta:xp:${user?.id?.slice(0,8) || "anon"}`, { total: 0, history: [] }),
          synced_at: new Date().toISOString(),
        };
        await supabase.auth.updateUser({ data: { user_data: payload } });
      } catch (e) { console.warn("[Sync] Supabase 동기화 실패:", e); }
    }, 500);
  }, [user, readUserLocal]);

  // 로그인 시 Supabase → localStorage 동기화 (서버 우선)
  useEffect(() => {
    if (!user || userDataLoaded.current) return;
    (async () => {
      try {
        await supabase.auth.refreshSession();
        const { data } = await supabase.auth.getUser();
        const remote = data?.user?.user_metadata?.user_data;
        if (remote && typeof remote === "object") {
          const todayKey = new Date().toISOString().slice(0, 10);
          // 서버 데이터가 있으면 localStorage에 머지 (서버 우선)
          if (remote.streak) writeUserLocal("zepta:streak", remote.streak);
          if (remote.daily_quest) writeUserLocal("zepta:daily-quest", remote.daily_quest);
          if (remote.pred_stats) writeUserLocal("zepta:pred:stats", remote.pred_stats);
          if (remote.quiz_stats) writeUserLocal("zepta:quiz:stats", remote.quiz_stats);
          if (remote.pred_today) writeUserLocal(`zepta:pred:${todayKey}`, remote.pred_today);
          if (remote.quiz_today) writeUserLocal(`zepta:quiz:${todayKey}`, remote.quiz_today);
          if (remote.xp_data) writeUserLocal(`zepta:xp:${user?.id?.slice(0,8) || "anon"}`, remote.xp_data);
          // 상태 갱신
          setPredictionState(remote.pred_today || null);
          setQuizAnswered(remote.quiz_today || null);
        } else {
          // 서버에 데이터가 없으면 현재 localStorage를 서버에 업로드
          syncUserDataToSupabase();
        }
      } catch (e) { console.warn("[Sync] 초기 동기화 실패:", e); }
      userDataLoaded.current = true;
      setUserDataRestored(true);
    })();
  }, [user, writeUserLocal, syncUserDataToSupabase]);

  // 유저 변경 시 플래그 리셋
  useEffect(() => { userDataLoaded.current = false; setUserDataRestored(false); }, [user?.id]);

  // ── 연속 접속(streak) 기록 — 로그인 사용자 공용 경로 ──────────────
  // ★ 2026-08 정비: 기록 코드가 owner 홈 렌더 IIFE 안에만 있어 일반 사용자는
  //   매일 접속해도 streak 이 영원히 쌓이지 않았습니다(MY 스탯 칸 영구 미표시).
  //   탭과 무관하게 서버 복원 완료 후 1회 기록하는 공용 effect 로 옮깁니다.
  //   하루 1회 멱등(lastDate === 오늘이면 증가 없이 읽기만)이라 owner 홈의
  //   기존 렌더 내 계산과 겹쳐 실행돼도 이중 증가는 없습니다.
  const [streakInfo, setStreakInfo] = useState(null);
  useEffect(() => {
    if (!user?.id || !userDataRestored) return;
    const todayKey = new Date().toISOString().slice(0, 10);
    try {
      const stored = JSON.parse(localStorage.getItem("zepta:streak") || "{}");
      if (stored.lastDate === todayKey) { setStreakInfo(stored); return; }
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      const updated = { lastDate: todayKey, count: stored.lastDate === yesterday ? (stored.count || 0) + 1 : 1 };
      localStorage.setItem("zepta:streak", JSON.stringify(updated));
      setStreakInfo(updated);
      syncUserDataToSupabase();
    } catch {}
  }, [user?.id, userDataRestored, syncUserDataToSupabase]);

  // ── 스크롤 및 UX 상태 ──
  const [showScrollTop, setShowScrollTop] = useState(false);

  // ── 스크리너 상태 ─────────────────────────────────────────────
  const [results, setResults]         = useState([]);
  const [scanning, setScanning]       = useState(false);
  const [scanProgress, setScanProgress] = useState({ done: 0, total: 0 });
  const [conditions, setConditions]   = useState([]);
  const [mode, setMode]               = useState("or");
  // ★ 2026-06-12 (전수 감사): 저장한 스크리너 → 조건 주입·자동 스캔 루프용
  const [pendingScreenerKeys, setPendingScreenerKeys] = useState(null);
  const [filterMarket, setFilterMarket] = useState("all");
  const [sortBy, setSortBy]           = useState("rsi");
  // 모바일 스크리너 — 정렬 ActionSheet open
  const [sortSheetOpen, setSortSheetOpen] = useState(false);
  // ★ 2026-08-12 IA v3 (시안 1b): 조건 편집 바텀 시트 — 기존 인라인 details 조건 패널을
  //   시트로 수납(핸들러 보존). 탭 이탈 시 닫아 재진입 잔상을 막습니다.
  const [condSheetOpen, setCondSheetOpen] = useState(false);
  useEffect(() => { setCondSheetOpen(false); }, [tab]);
  const [scanErrors, setScanErrors]   = useState([]);
  const [activePreset, setActivePreset] = useState(null);
  const [lastScan, setLastScan]       = useState(null);
  const [chartAsset, setChartAsset]   = useState(null);
  const [selectedAsset, setSelectedAsset] = useState(null); // 종목 상세 팝업
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  // ── 스크리너 종목 빠른 검색 — 사이트링크 검색박스(?q=) 실연동 ──
  //   구조화데이터 WebSite.SearchAction(target /screener?q=)이 선언만 하고 미동작이던 것을 실배선.
  //   진입 시 ?q 를 읽어 시드(최대 40자, XSS 방지 위해 표시 외 용도 없음).
  const [assetQuery, setAssetQuery] = useState(() => {
    try { return (new URLSearchParams(window.location.search).get("q") || "").slice(0, 40); }
    catch { return ""; }
  });

  // ── 저평가 종목 스캔 ──
  const [valueResults, setValueResults] = useState([]);
  const [valueScanning, setValueScanning] = useState(false);
  const [valueScanProgress, setValueScanProgress] = useState({ done: 0, total: 0 });
  const [valueFilter, setValueFilter] = useState("all"); // all, us, kr
  const [valueSortBy, setValueSortBy] = useState("score"); // score, per, pbr, div, upside
  const [valueLastScan, setValueLastScan] = useState(null);
  // 관심종목: userId 기반 격리 (비로그인 시 빈 배열)
  const watchlistKey = user ? `di_${user.id.slice(0, 8)}_watchlist` : null;
  const [watchlist, setWatchlist] = useState(() => {
    if (!watchlistKey) return [];
    try { return JSON.parse(localStorage.getItem(watchlistKey) || "[]"); } catch { return []; }
  });
  // ★ 2026-06-12 (대표 지시): 내 정보 — 운용 중 모의봇/실전 실적 요약 데이터
  const [profilePerf, setProfilePerf] = useState({ bots: null, real: null, loading: false });

  // ★ 2026-06-12 (대표 아이디어): 트레이딩뷰식 우측 왓치리스트 도크 (데스크톱 전용)
  const [watchDockOpen, setWatchDockOpen] = useState(() => {
    try { return localStorage.getItem("zepta_watchdock") === "1"; } catch { return false; }
  });
  const toggleWatchDock = useCallback(() => {
    setWatchDockOpen(prev => { try { localStorage.setItem("zepta_watchdock", prev ? "0" : "1"); } catch {} return !prev; });
  }, []);

  // ── 포트폴리오 상태 ───────────────────────────────────────────
  const [portfolio, setPortfolio]         = useState(loadPortfolio);
  const [portfolioPrices, setPortfolioPrices] = useState({});
  const [portfolioLoading, setPortfolioLoading] = useState(false);
  const [showAddAsset, setShowAddAsset]   = useState(false);
  const [newAsset, setNewAsset]           = useState({ symbol: "", name: "", market: "us", qty: "", avgPrice: "" });

  // ── 알림 설정 ─────────────────────────────────────────────────
  const [settings, setSettings] = useState(() => ({ botToken: "", chatId: "", autoSend: false, strategyAlerts: true, autoScanEnabled: false, autoScanInterval: 30, ...loadSettings() }));
  const [tgStatus, setTgStatus] = useState("");

  // ── 전략 매매 알림 (실시간 푸시) ──────────────────────────────
  const [tradeAlerts, setTradeAlerts] = useState(() => {
    try { return JSON.parse(localStorage.getItem("di_trade_alerts") || "[]"); } catch { return []; }
  });
  const [alertBadge, setAlertBadge] = useState(0); // 읽지 않은 알림 수
  const [alertFilter, setAlertFilter] = useState("all"); // all, buy, sell
  const [alertMarketFilter, setAlertMarketFilter] = useState("all"); // all, us, kr, crypto
  const [notiPerm, setNotiPerm] = useState(() => ("Notification" in window) ? Notification.permission : "unsupported");
  const scanCandleCache = useRef({}); // 스캔 중 수집된 캔들 데이터 캐시 {symbol: {closes, highs, lows, volumes}}

  // 전략 이름 → 전략 객체 매핑은 generateStrategyAlerts 안에서 dynamic import 후
  // 지역 계산합니다 (감사 배치3 perf — strategies.js 를 첫 페인트 번들에서 분리).

  // ── 백테스트/전략 상태 ─────────────────────────────────────────
  const [btStrategy, setBtStrategy] = useState(null);
  const [btSymbol, setBtSymbol] = useState(null);


  // ── 통화 (KRW/USD) ──────────────────────────────────────────
  const [currency, setCurrency] = useState("USD");
  const [krwRate, setKrwRate] = useState(1350); // 기본 환율

  // ── 동기화 PIN ───────────────────────────────────────────────
  const [syncPin, setSyncPin] = useState(() => loadSettings().syncPin || "");
  const [syncStatus, setSyncStatus] = useState("");

  // ── 뉴스 상태 ─────────────────────────────────────────────────
  const [newsItems, setNewsItems] = useState([]);
  const [newsLoading, setNewsLoading] = useState(false);
  const [newsSort, setNewsSort] = useState("time"); // time, positive, negative
  const [newsCat, setNewsCat] = useState("all"); // all, us, kr, crypto

  // 소셜 센티먼트
  const [sentimentData, setSentimentData] = useState(null);
  const [sentimentLoading, setSentimentLoading] = useState(false);
  const [sentimentSymbol, setSentimentSymbol] = useState("SPY");

  // ── 이상 탐지 (Anomaly Detection) ──
  const [anomalies, setAnomalies] = useState([]);
  const [anomalyHistory, setAnomalyHistory] = useState(() => { try { return JSON.parse(localStorage.getItem("di_anomaly_history") || "[]"); } catch { return []; } });
  const [anomalyFilter, setAnomalyFilter] = useState("all"); // all, surge, crash, high
  const [hotViewMode, setHotViewMode] = useState("all"); // all, gainers, losers
  const [hideRisky, setHideRisky] = useState(false);

  // ── 포트폴리오 벤치마킹 ──
  const [benchmarkData, setBenchmarkData] = useState(null);

  // ── AI 투자 어시스턴트 ──

  useEffect(() => { saveSettings({ botToken: settings.botToken, chatId: settings.chatId, autoSend: settings.autoSend, strategyAlerts: settings.strategyAlerts, autoScanEnabled: settings.autoScanEnabled, autoScanInterval: settings.autoScanInterval, syncPin }); }, [settings, syncPin]);
  useEffect(() => { savePortfolio(portfolio); }, [portfolio]);
  // 전략 알림 저장 (최대 100개 유지)
  useEffect(() => { try { localStorage.setItem("di_trade_alerts", JSON.stringify(tradeAlerts.slice(0, 100))); } catch {} }, [tradeAlerts]);

  // 로그인/로그아웃 시 관심종목 재로드 (Supabase 서버 우선 머지)
  const watchlistLoaded = useRef(false);
  useEffect(() => {
    if (watchlistKey) {
      // 1) localStorage에서 먼저 로드
      let local = [];
      try { local = JSON.parse(localStorage.getItem(watchlistKey) || "[]"); } catch {}
      setWatchlist(local);

      // 2) Supabase에서 관심종목 복원 (서버 우선)
      if (user) {
        (async () => {
          try {
            const { data } = await supabase.auth.getUser();
            const remote = data?.user?.user_metadata?.watchlist;
            if (Array.isArray(remote) && remote.length > 0) {
              setWatchlist(remote);
              localStorage.setItem(watchlistKey, JSON.stringify(remote));
            } else if (local.length > 0) {
              // 서버에 없으면 로컬을 업로드
              await supabase.auth.updateUser({ data: { watchlist: local } });
            }
          } catch {}
        })();
      }
    } else {
      setWatchlist([]);
    }
    // 로드 직후에는 저장 방지 (빈 배열이 기존 데이터를 덮어쓰는 것 방지)
    watchlistLoaded.current = false;
    const t = setTimeout(() => { watchlistLoaded.current = true; }, 500);
    return () => clearTimeout(t);
  }, [watchlistKey, user]);
  // 관심종목 저장 (로그인 시에만, 로드 직후 덮어쓰기 방지) + Supabase 동기화
  const watchlistSaveTimer = useRef(null);
  useEffect(() => {
    if (watchlistKey && watchlistLoaded.current) {
      try { localStorage.setItem(watchlistKey, JSON.stringify(watchlist)); } catch {}
      // Supabase user_metadata에 관심종목 동기화 (디바운스)
      if (user) {
        if (watchlistSaveTimer.current) clearTimeout(watchlistSaveTimer.current);
        watchlistSaveTimer.current = setTimeout(async () => {
          try { await supabase.auth.updateUser({ data: { watchlist } }); } catch {}
        }, 800);
      }
    }
  }, [watchlist, watchlistKey, user]);

  // ── 자체 애널리틱스: SPA 라우트 전환 페이지뷰 (GA 대체) ──
  //   IA v3: 주소창과 동일한 새 경로(/crypto·/stocks)로 기록합니다.
  useEffect(() => {
    ga.pageView(tab === "home" ? "/" : `/${TAB_TO_PATH[tab] || tab}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // ── 내 정보: 운용 현황 요약 로드 (모의봇 + 실전, 진입 시 1회) ──
  useEffect(() => {
    if (tab !== "profile" || profilePerf.loading || profilePerf.bots) return;
    setProfilePerf(p => ({ ...p, loading: true }));
    (async () => {
      let bots = null, real = null;
      try {
        const r = await fetch("/api/bot-performance?all=1");
        const j = await r.json();
        if (j?.ok && j.bots) bots = j.bots;
      } catch {}
      if (isOwner && user?.id) {
        try {
          const r2 = await fetch(`/api/real-trading/status?userId=${encodeURIComponent(user.id)}`);
          const j2 = await r2.json();
          if (j2?.ok) real = { equity: j2.equity, unrealizedPnl: j2.unrealizedPnl, positions: (j2.openPositions || []).length };
        } catch {}
      }
      setProfilePerf({ bots, real, loading: false });
    })();
  }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 탭 타이틀 및 메타태그 실시간 업데이트 (토스증권 스타일 + SEO) ──
  useEffect(() => {
    const meta = TAB_META[tab] || TAB_META.home;
    let title = meta.title;

    if (selectedAsset && hotAssets.length > 0 && tab !== "home") {
      const h = hotAssets.find(a => a.symbol === selectedAsset.symbol);
      if (h) {
        const sign = h.change >= 0 ? "+" : "";
        const price = h.market === "kr" ? `₩${h.price?.toLocaleString()}` : `$${h.price?.toLocaleString()}`;
        title = `${h.name} ${price} ${sign}${h.change}% | Zepta`;
      }
    }

    // 문서 title 설정
    document.title = title;

    // description 메타태그 동적 수정
    const descMeta = document.querySelector('meta[name="description"]');
    if (descMeta) descMeta.setAttribute("content", meta.desc);

    // og:title 동적 수정
    const ogTitle = document.querySelector('meta[property="og:title"]');
    if (ogTitle) ogTitle.setAttribute("content", title);

    // og:description 동적 수정
    const ogDesc = document.querySelector('meta[property="og:description"]');
    if (ogDesc) ogDesc.setAttribute("content", meta.desc);

    // canonical URL 동적 설정
    const canonical = document.querySelector('link[rel="canonical"]');
    if (canonical) {
      // IA v3: canonical 은 새 경로(/crypto·/stocks) 기준 — 구 경로와 중복 색인 방지
      const canonicalUrl = tab === "home" ? "https://zepta.app/" : `https://zepta.app/${TAB_TO_PATH[tab] || tab}`;
      canonical.setAttribute("href", canonicalUrl);
    }
  }, [marketIndices, tab, selectedAsset, hotAssets]);

  // ── 이상 탐지: hotAssets에서 비정상 변동/거래량 감지 ──
  useEffect(() => {
    if (hotAssets.length < 5) return;
    const detected = [];
    const changes = hotAssets.map(a => Math.abs(a.change));
    const avgChange = changes.reduce((s, v) => s + v, 0) / changes.length;
    const stdDev = Math.sqrt(changes.reduce((s, v) => s + (v - avgChange) ** 2, 0) / changes.length);
    for (const asset of hotAssets) {
      const reasons = [];
      // 1) 가격 변동 이상: 2σ 이상
      if (Math.abs(asset.change) > avgChange + 2 * stdDev && Math.abs(asset.change) >= 3) {
        reasons.push(t("tabs.anomaly.reasonChange", { chg: `${asset.change >= 0 ? "+" : ""}${asset.change}`, mult: (Math.abs(asset.change) / Math.max(avgChange, 0.1)).toFixed(1) }));
      }
      // 2) 거래량 스파이크 (volume 비율 기반)
      if (asset.volRatio && asset.volRatio > 3) {
        reasons.push(t("tabs.anomaly.reasonVolume", { ratio: asset.volRatio.toFixed(1) }));
      }
      // 3) 급격한 갭
      if (asset.gap && Math.abs(asset.gap) > 3) {
        reasons.push(t("tabs.anomaly.reasonGap", { gap: `${asset.gap > 0 ? "+" : ""}${asset.gap.toFixed(1)}` }));
      }
      if (reasons.length > 0) {
        detected.push({
          ...asset,
          anomalyType: asset.change >= 0 ? "surge" : "crash",
          anomalyReasons: reasons,
          severity: Math.abs(asset.change) > avgChange + 3 * stdDev ? "high" : "medium",
          detectedAt: new Date(),
        });
      }
    }
    detected.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
    const top = detected.slice(0, 10);
    setAnomalies(top);
    // 히스토리 저장
    if (top.length > 0) {
      setAnomalyHistory(prev => {
        const now = new Date().toISOString();
        const newEntries = top.map(a => ({
          symbol: a.symbol, name: a.name, change: a.change,
          type: a.anomalyType, severity: a.severity, date: now,
        }));
        const merged = [...newEntries, ...prev.filter(p => !newEntries.some(n => n.symbol === p.symbol && n.date?.slice(0, 10) === p.date?.slice(0, 10)))].slice(0, 50);
        try { localStorage.setItem("di_anomaly_history", JSON.stringify(merged)); } catch {}
        return merged;
      });
    }
  }, [hotAssets, t]); // t: 언어 전환 시 사유 칩 재생성

  // ── 포트폴리오 벤치마킹 계산 ──
  useEffect(() => {
    if (portfolio.length === 0 || !Object.keys(portfolioPrices).length) { setBenchmarkData(null); return; }
    const sp = marketIndices.find(i => i.symbol === "^GSPC");
    const ks = marketIndices.find(i => i.symbol === "^KS11");
    let totalValue = 0, totalCost = 0;
    for (const item of portfolio) {
      const curPrice = portfolioPrices[item.symbol] || 0;
      const qty = parseFloat(item.qty) || 0;
      const avg = parseFloat(item.avgPrice) || 0;
      totalValue += curPrice * qty;
      totalCost += avg * qty;
    }
    const myReturn = totalCost > 0 ? ((totalValue - totalCost) / totalCost * 100) : 0;
    setBenchmarkData({
      myReturn: myReturn,
      spReturn: sp?.change ?? null,
      ksReturn: ks?.change ?? null,
      totalValue, totalCost,
      alpha: sp ? myReturn - sp.change : null,
      beatsSP: sp ? myReturn > sp.change : null,
      beatsKS: ks ? myReturn > ks.change : null,
    });
  }, [portfolio, portfolioPrices, marketIndices]);

  // ── useMemo: 경제 캘린더 필터/정렬 결과 ──
  const filteredEconEvents = useMemo(() => {
    let filtered = econEvents;
    if (econFilter === "upcoming") filtered = econEvents.filter(e => e.daysUntil >= 0);
    else if (econFilter === "past") filtered = econEvents.filter(e => e.daysUntil < 0);
    else if (econFilter !== "all") filtered = econEvents.filter(e => e.type === econFilter);
    const sorted = [...filtered].sort((a, b) => {
      if (econSort === "date-desc") return b.date - a.date;
      if (econSort === "type") return a.type.localeCompare(b.type) || a.date - b.date;
      return a.date - b.date;
    });
    return sorted;
  }, [econEvents, econFilter, econSort]);

  // ── useMemo: 스크리너 결과 정렬 (퀀트점수 추가) ──
  const sortedResults = useMemo(() => {
    return [...results].sort((a, b) => {
      if (sortBy === "score") {
        const da = quickDiagnosis(a), db = quickDiagnosis(b);
        return db.score - da.score;
      }
      if (sortBy === "rsi")     return (a.rsi ?? 999) - (b.rsi ?? 999);
      if (sortBy === "change")  return a.weekChange - b.weekChange;
      if (sortBy === "vol")     return b.volRatio - a.volRatio;
      return b.triggers.length - a.triggers.length;
    });
  }, [results, sortBy]);

  // ── 오늘의 종목 추천 (핵심 50종목 스캔) ───────────────────────
  // ★ 2026-08-10: fetchMarketOverview 의 owner 게이트 뒤에 있던 블록을 분리.
  //   /quant-report(공개 탭)가 dailyPicks 를 소비하므로 비owner 도 채울 수 있어야 합니다.
  //   비용은 yahoo-batch 2회뿐이라 #215 가 잡은 유니버스 스캔 낭비와는 무관합니다.
  const fetchDailyPicks = useCallback(async () => {
    const pickList = [
      "NVDA","AAPL","TSLA","MSFT","GOOGL","AMZN","META","AMD","AVGO","COIN",
      "NFLX","CRM","PLTR","MSTR","SOFI","HOOD","ARM","SMCI","TSM","APP",
      "RDDT","BABA","JPM","LLY","BA","DIS","IONQ","CPNG","SHOP","CRWD","BITX",
      "005930.KS","000660.KS","035420.KS","068270.KS","373220.KS","005380.KS",
      "000270.KS","035720.KS","051910.KS","006400.KS","207940.KS","259960.KS",
      "352820.KS","105560.KS","055550.KS","042660.KS","329180.KS","009540.KS",
      "196170.KQ","042700.KS",
    ];
    const picks = [];
    const pickChunkSize = 25;
    for (let ci = 0; ci < pickList.length; ci += pickChunkSize) {
      const pickChunk = pickList.slice(ci, ci + pickChunkSize).join(",");
      try {
        const pr = await fetch(`/api/yahoo-batch?symbols=${encodeURIComponent(pickChunk)}&interval=1d&range=1mo`);
        if (pr.ok) {
          const pBatch = (await pr.json()).results || {};
          for (const [sym, data] of Object.entries(pBatch)) {
            if (!data?.closes?.length || data.closes.length < 10) continue;
            const closes = data.closes;
            const n = closes.length;
            const last = closes[n - 1];
            const prev = closes[n - 2];
            const change1d = ((last - prev) / prev) * 100;
            const change5d = n >= 5 ? ((last - closes[n - 5]) / closes[n - 5]) * 100 : 0;
            const sma10 = closes.slice(-10).reduce((a, b) => a + b, 0) / 10;
            const sma20 = closes.slice(-20).reduce((a, b) => a + b, 0) / Math.min(20, n);
            // 14일 RSI 간이 계산
            let ag = 0, al = 0;
            for (let ri = n - 14; ri < n; ri++) { const d = closes[ri] - closes[ri - 1]; if (d > 0) ag += d; else al -= d; }
            const rsiV = al === 0 ? 100 : 100 - 100 / (1 + (ag / 14) / (al / 14));
            let score = 0;
            if (last > sma10) score += 2;
            if (last > sma20) score += 2;
            if (change5d > 0 && change5d < 10) score += 3;
            if (change1d > -2 && change1d < 5) score += 1;
            if (sma10 > sma20) score += 2;
            if (rsiV >= 30 && rsiV <= 65) score += 1; // 과매수 아닌 건강 구간
            if (rsiV < 30) score += 2; // 과매도 반등 기회
            const isKR = sym.includes(".KS") || sym.includes(".KQ");
            const assetInfo = [...US_ASSETS, ...KR_ASSETS].find(a => a.symbol === sym);
            if (!assetInfo) continue;
            picks.push({
              symbol: sym, name: assetInfo.name,
              market: isKR ? "kr" : "us",
              symbolRaw: sym,
              price: last, change: +change1d.toFixed(2),
              score, change5d: +change5d.toFixed(2),
              reason: score >= 8 ? "강한 상승 추세" : score >= 6 ? "긍정적 모멘텀" : score >= 4 ? "관심 구간" : "모니터링",
            });
          }
        }
      } catch {}
    }
    picks.sort((a, b) => b.score - a.score);
    setDailyPicks(picks);
  }, []);

  // ── 홈 대시보드 데이터 ─────────────────────────────────────────
  const fetchMarketOverview = useCallback(async () => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    // 이전 요청 취소
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const signal = controller.signal;
    setMarketLoading(true);
    // ★ 2026-08-09 홈 로딩 다이어트 (대표 실보고 "로딩이 너무 오래 걸려") —
    //   공포/탐욕은 지수·핫 종목과 독립이라 지금 발사해 두고, 홈 필수 데이터가
    //   끝나는 지점에서 결과만 받습니다(직렬 대기 제거).
    const fgPromise = (async () => {
      const fgData = { stock: null, crypto: null };
      try {
        const fgRes = await fetch("/api/fear-greed?_t=" + Date.now());
        if (fgRes.ok) {
          const fgJson = await fgRes.json();
          if (fgJson.stock) fgData.stock = fgJson.stock;
          if (fgJson.crypto) fgData.crypto = fgJson.crypto;
        }
      } catch {}
      // Fallback: Alternative.me Crypto Fear & Greed
      if (!fgData.crypto) {
        try {
          const altRes = await fetch("https://api.alternative.me/fng/?limit=1");
          if (altRes.ok) {
            const altJson = await altRes.json();
            const d = altJson?.data?.[0];
            if (d) fgData.crypto = { value: parseInt(d.value), label: d.value_classification, ts: d.timestamp };
          }
        } catch {}
      }
      return fgData;
    })();
    const indices = [
      { symbol: "^GSPC", name: "S&P 500", flag: "🇺🇸" },
      { symbol: "^IXIC", name: "NASDAQ", flag: "🇺🇸" },
      { symbol: "^DJI", name: "다우존스", flag: "🇺🇸" },
      { symbol: "^KS11", name: "코스피", flag: "🇰🇷" },
      { symbol: "^KQ11", name: "코스닥", flag: "🇰🇷" },
      { symbol: "USDKRW=X", name: "원/달러 환율", flag: "💱" },
      // 리스크 컨트롤 타워용 추가 지표
      { symbol: "^VIX", name: "VIX", flag: "📊", hidden: true },
      { symbol: "DX-Y.NYB", name: "달러인덱스", flag: "💲", hidden: true },
      { symbol: "^TNX", name: "10Y 국채", flag: "📉", hidden: true },
      { symbol: "^FVX", name: "5Y 국채", flag: "📉", hidden: true },
      { symbol: "^IRX", name: "13W T-Bill", flag: "📉", hidden: true },
      { symbol: "CL=F", name: "WTI 원유", flag: "🛢️", hidden: true },
      { symbol: "GC=F", name: "금", flag: "🥇", hidden: true },
      { symbol: "HG=F", name: "구리", flag: "🔶", hidden: true },
    ];
    // 지수 병렬 fetch
    const idxSyms = indices.map(i => i.symbol).join(",");
    let results = [];
    try {
      const r = await fetch(`/api/yahoo-batch?symbols=${encodeURIComponent(idxSyms)}&interval=1d&range=5d`, { signal });
      if (r.ok) {
        const batch = (await r.json()).results || {};
        for (const idx of indices) {
          const d = batch[idx.symbol];
          if (d && d.closes?.length >= 2) {
            const cur = d.closes[d.closes.length - 1];
            const prev = d.closes[d.closes.length - 2];
            results.push({ ...idx, price: cur, change: +( ((cur - prev) / prev) * 100 ).toFixed(2) });
          }
        }
      }
    } catch {}
    if (signal.aborted) { fetchingRef.current = false; return; }
    setMarketIndices(results);
    // Hot assets — 핵심 종목 (US 30 + KR 15 = 45)
    const hots = [
      // US Mega Cap + 반도체 + 인기주
      { symbol: "NVDA", name: "NVIDIA", market: "us" },
      { symbol: "AAPL", name: "Apple", market: "us" },
      { symbol: "TSLA", name: "Tesla", market: "us" },
      { symbol: "MSFT", name: "Microsoft", market: "us" },
      { symbol: "GOOGL", name: "Alphabet", market: "us" },
      { symbol: "AMZN", name: "Amazon", market: "us" },
      { symbol: "META", name: "Meta", market: "us" },
      { symbol: "AMD", name: "AMD", market: "us" },
      { symbol: "AVGO", name: "Broadcom", market: "us" },
      { symbol: "NFLX", name: "Netflix", market: "us" },
      { symbol: "CRM", name: "Salesforce", market: "us" },
      { symbol: "PLTR", name: "Palantir", market: "us" },
      { symbol: "COIN", name: "Coinbase", market: "us" },
      { symbol: "MSTR", name: "MicroStrategy", market: "us" },
      { symbol: "SOFI", name: "SoFi", market: "us" },
      { symbol: "HOOD", name: "Robinhood", market: "us" },
      { symbol: "JPM", name: "JPMorgan", market: "us" },
      { symbol: "V", name: "Visa", market: "us" },
      { symbol: "LLY", name: "Eli Lilly", market: "us" },
      { symbol: "UNH", name: "UnitedHealth", market: "us" },
      { symbol: "BA", name: "Boeing", market: "us" },
      { symbol: "DIS", name: "Disney", market: "us" },
      { symbol: "BABA", name: "Alibaba", market: "us" },
      { symbol: "TSM", name: "TSMC", market: "us" },
      { symbol: "APP", name: "AppLovin", market: "us" },
      { symbol: "RDDT", name: "Reddit", market: "us" },
      { symbol: "CPNG", name: "Coupang", market: "us" },
      { symbol: "ARM", name: "ARM Holdings", market: "us" },
      { symbol: "IONQ", name: "IonQ", market: "us" },
      { symbol: "SMCI", name: "Super Micro", market: "us" },
      { symbol: "BITX", name: "BTC 2x 레버리지", market: "us" },
      // KR Top 15
      { symbol: "005930.KS", name: "삼성전자", market: "kr" },
      { symbol: "000660.KS", name: "SK하이닉스", market: "kr" },
      { symbol: "373220.KS", name: "LG에너지솔루션", market: "kr" },
      { symbol: "207940.KS", name: "삼성바이오로직스", market: "kr" },
      { symbol: "005380.KS", name: "현대차", market: "kr" },
      { symbol: "000270.KS", name: "기아", market: "kr" },
      { symbol: "068270.KS", name: "셀트리온", market: "kr" },
      { symbol: "035420.KS", name: "NAVER", market: "kr" },
      { symbol: "035720.KS", name: "카카오", market: "kr" },
      { symbol: "051910.KS", name: "LG화학", market: "kr" },
      { symbol: "006400.KS", name: "삼성SDI", market: "kr" },
      { symbol: "105560.KS", name: "KB금융", market: "kr" },
      { symbol: "055550.KS", name: "신한지주", market: "kr" },
      { symbol: "259960.KS", name: "크래프톤", market: "kr" },
      { symbol: "352820.KS", name: "하이브", market: "kr" },
    ];
    // Hot assets 병렬 fetch — ★ 청크를 동시에 발사하고 결과는 청크 순서대로 병합
    //   (순차 await 는 청크 수만큼 왕복 지연이 쌓입니다)
    const hotChunkSize = 30;
    const hotChunkList = [];
    for (let ci = 0; ci < hots.length; ci += hotChunkSize) hotChunkList.push(hots.slice(ci, ci + hotChunkSize));
    const hotChunkResults = await Promise.all(hotChunkList.map(async (hotChunk) => {
      const acc = [];
      const hotSyms = hotChunk.map(h => h.symbol).join(",");
      try {
        const hr = await fetch(`/api/yahoo-batch?symbols=${encodeURIComponent(hotSyms)}&interval=1d&range=5d`, { signal });
        if (hr.ok) {
          const hBatch = (await hr.json()).results || {};
          for (const h of hotChunk) {
            const d = hBatch[h.symbol];
            if (d && d.closes?.length >= 2) {
              const cur = d.closes[d.closes.length - 1];
              const prev = d.closes[d.closes.length - 2];
              acc.push({ ...h, price: cur, change: +( ((cur - prev) / prev) * 100 ).toFixed(2), symbolRaw: h.symbol });
            }
          }
        }
      } catch {}
      return acc;
    }));
    const hotResults = hotChunkResults.flat();
    // Crypto hots — 병렬
    const cryptoHots = [
      { id: "bitcoin", sym: "BTC", name: "Bitcoin" },
      { id: "ethereum", sym: "ETH", name: "Ethereum" },
      { id: "solana", sym: "SOL", name: "Solana" },
    ];
    const cryptoResults = await Promise.allSettled(
      cryptoHots.map(c => fetch(`/api/coingecko?id=${c.id}&days=2`).then(r => r.ok ? r.json() : null))
    );
    cryptoHots.forEach((c, i) => {
      const r = cryptoResults[i];
      if (r.status === "fulfilled" && r.value) {
        const dp = (r.value.prices || []).map(p => p[1]);
        if (dp.length >= 2) {
          const cur = dp[dp.length - 1], prev = dp[0];
          hotResults.push({ symbol: c.sym, name: c.name, market: "crypto", price: cur, change: +( ((cur - prev) / prev) * 100 ).toFixed(2), symbolRaw: c.id });
        }
      }
    });
    setHotAssets(hotResults);

    // ── 공포/탐욕 — Stage A 시작 시 발사해 둔 병렬 요청의 결과 수령 ──
    setFearGreed(await fgPromise);

    // ★ 홈 필수 데이터 끝 — 여기서 로딩을 해제합니다. 아래는 owner 홈 전용 확장입니다.
    setMarketLoading(false);
    // ── 오늘의 추천: owner 이거나 공개 /quant-report 를 보고 있으면 채웁니다 ──
    //   (홈 30초 인터벌은 tab==="home" 안에서만 돌아 비owner 홈 추가 호출 0건.
    //    quant-report 딥링크는 marketIndices 빈 경우 fetchMarketOverview 를 1회 부르므로 이 경로로 채워짐)
    if ((ownerRef.current || tabForFetchRef.current === "quant-report") &&
        Date.now() - picksAtRef.current > 5 * 60 * 1000) {
      picksAtRef.current = Date.now();
      await fetchDailyPicks();
    }

    // 지표 보강·장외가 전 종목 스캔·섹터는 owner 홈에서만 렌더됩니다
    // (비owner 홈·검색 팝업은 자체 per-symbol 조회로 동작 — extendedHours 미의존 확인).
    // 일반 사용자 세션에서 30초마다 ~15회의 yahoo 호출이 낭비되고 있었습니다.
    // → owner 게이트 + 5분 스로틀.
    if (!ownerRef.current || Date.now() - marketExtrasAtRef.current < 5 * 60 * 1000) {
      fetchingRef.current = false;
      return;
    }
    marketExtrasAtRef.current = Date.now();

    // ── 관심종목 + 핫 종목 기술적 지표 보강 (1년 데이터 기반) ──
    const enrichSymbols = [...new Set([
      ...watchlist.map(w => w.symbol),
      ...hotResults.slice(0, 15).map(h => h.symbol),
    ])].filter(s => !s.startsWith("BTC") && !s.startsWith("ETH") && !s.startsWith("SOL")); // 크립토는 별도
    if (enrichSymbols.length > 0) {
      const enrichChunkSize = 10;
      for (let ei = 0; ei < enrichSymbols.length; ei += enrichChunkSize) {
        const eChunk = enrichSymbols.slice(ei, ei + enrichChunkSize);
        const eSyms = eChunk.join(",");
        try {
          const er = await fetch(`/api/yahoo-batch?symbols=${encodeURIComponent(eSyms)}&interval=1d&range=1y`, { signal });
          if (er.ok) {
            const eBatch = (await er.json()).results || {};
            setHotAssets(prev => {
              const updated = [...prev];
              for (const sym of eChunk) {
                const d = eBatch[sym];
                if (!d || !d.closes || d.closes.length < 20) continue;
                const idx = updated.findIndex(a => a.symbol === sym || a.symbolRaw === sym);
                if (idx === -1) continue;
                const closes = d.closes, volumes = d.volumes || [], highs = d.highs || [], lows = d.lows || [];
                const n = closes.length;

                // RSI (14)
                let rsi = null;
                if (n >= 15) {
                  let gains = 0, losses = 0;
                  for (let i = n - 14; i < n; i++) {
                    const diff = closes[i] - closes[i - 1];
                    if (diff > 0) gains += diff; else losses -= diff;
                  }
                  const avgGain = gains / 14, avgLoss = losses / 14;
                  rsi = avgLoss === 0 ? 100 : Math.round(100 - 100 / (1 + avgGain / avgLoss));
                }

                // MA50, MA200
                const ma50 = n >= 50 ? closes.slice(-50).reduce((s, v) => s + v, 0) / 50 : null;
                const ma200 = n >= 200 ? closes.slice(-200).reduce((s, v) => s + v, 0) / 200 : null;
                const curPrice = closes[n - 1];
                const ma200Dist = ma200 ? ((curPrice - ma200) / ma200 * 100) : null;

                // 52주 고저
                const yearHighs = highs.length >= 200 ? highs.slice(-252) : highs;
                const yearLows = lows.length >= 200 ? lows.slice(-252) : lows;
                const high52w = Math.max(...yearHighs);
                const low52w = Math.min(...yearLows.filter(l => l > 0));

                // 거래량 비율 (최근 5일 평균 / 20일 평균)
                let volRatio = null;
                if (volumes.length >= 20) {
                  const vol5 = volumes.slice(-5).reduce((s, v) => s + v, 0) / 5;
                  const vol20 = volumes.slice(-20).reduce((s, v) => s + v, 0) / 20;
                  volRatio = vol20 > 0 ? +(vol5 / vol20).toFixed(2) : null;
                }

                // 주간 변동률
                const weekChange = n >= 6 ? +((curPrice - closes[n - 6]) / closes[n - 6] * 100).toFixed(2) : null;

                // 스토캐스틱 (14일)
                let stoch = null;
                if (n >= 14 && highs.length >= 14 && lows.length >= 14) {
                  const h14 = Math.max(...highs.slice(-14));
                  const l14 = Math.min(...lows.slice(-14).filter(l => l > 0));
                  const k = h14 - l14 > 0 ? Math.round((curPrice - l14) / (h14 - l14) * 100) : 50;
                  stoch = { k, d: k }; // 단순 K만 (D는 K의 3일 MA이지만 근사)
                }

                // MFI (14일) - Money Flow Index
                let mfi = null;
                if (n >= 15 && volumes.length >= 15 && highs.length >= 15 && lows.length >= 15) {
                  let posFlow = 0, negFlow = 0;
                  for (let i = n - 14; i < n; i++) {
                    const tp = (highs[i] + lows[i] + closes[i]) / 3;
                    const prevTp = (highs[i-1] + lows[i-1] + closes[i-1]) / 3;
                    const mf = tp * (volumes[i] || 0);
                    if (tp > prevTp) posFlow += mf; else negFlow += mf;
                  }
                  mfi = negFlow > 0 ? Math.round(100 - 100 / (1 + posFlow / negFlow)) : 100;
                }

                // Williams %R (14일)
                let wr = null;
                if (n >= 14 && highs.length >= 14 && lows.length >= 14) {
                  const hh = Math.max(...highs.slice(-14));
                  const ll = Math.min(...lows.slice(-14).filter(l => l > 0));
                  wr = hh - ll > 0 ? Math.round((hh - curPrice) / (hh - ll) * -100) : -50;
                }

                // RSI 다이버전스 (간단 버전: 가격 하락 + RSI 상승 = bullish)
                let rsiDivType = null;
                if (n >= 28 && rsi != null) {
                  const prevCloses14 = closes.slice(-28, -14);
                  let prevGains = 0, prevLosses = 0;
                  for (let i = 1; i < prevCloses14.length; i++) {
                    const diff = prevCloses14[i] - prevCloses14[i-1];
                    if (diff > 0) prevGains += diff; else prevLosses -= diff;
                  }
                  const prevRsi = prevLosses === 0 ? 100 : Math.round(100 - 100 / (1 + (prevGains/13) / (prevLosses/13)));
                  if (curPrice < closes[n - 14] && rsi > prevRsi) rsiDivType = "bullish";
                  else if (curPrice > closes[n - 14] && rsi < prevRsi) rsiDivType = "bearish";
                }

                // CMF (20일)
                let cmf = null;
                if (n >= 20 && volumes.length >= 20 && highs.length >= 20 && lows.length >= 20) {
                  let mfvSum = 0, volSum = 0;
                  for (let i = n - 20; i < n; i++) {
                    const hl = highs[i] - lows[i];
                    const mfm = hl > 0 ? ((closes[i] - lows[i]) - (highs[i] - closes[i])) / hl : 0;
                    mfvSum += mfm * (volumes[i] || 0);
                    volSum += volumes[i] || 0;
                  }
                  cmf = volSum > 0 ? +(mfvSum / volSum).toFixed(3) : null;
                }

                // GAP (전일 종가 vs 당일 시가)
                let gap = null;
                if (d.opens && d.opens.length >= 2) {
                  const todayOpen = d.opens[d.opens.length - 1];
                  const prevClose = closes[n - 2];
                  if (prevClose > 0) gap = +((todayOpen - prevClose) / prevClose * 100).toFixed(2);
                }

                // BB Width (20일)
                let bbWidth = null;
                const ma20h = n >= 20 ? closes.slice(-20).reduce((s, v) => s + v, 0) / 20 : null;
                if (ma20h) {
                  const bbStd = Math.sqrt(closes.slice(-20).reduce((a, v) => a + (v - ma20h) ** 2, 0) / 20);
                  bbWidth = ma20h > 0 ? +(bbStd * 4 / ma20h).toFixed(4) : null;
                }

                // ATR(14) %
                let atr14Pct = null;
                if (n >= 15 && highs.length >= 15 && lows.length >= 15) {
                  let atrS = 0;
                  for (let ai = n - 14; ai < n; ai++) {
                    atrS += Math.max(highs[ai] - lows[ai], Math.abs(highs[ai] - closes[ai - 1]), Math.abs(lows[ai] - closes[ai - 1]));
                  }
                  atr14Pct = curPrice > 0 ? +(atrS / 14 / curPrice * 100).toFixed(2) : null;
                }

                // ADX (간소화)
                let adxBullish = false, adxBearish = false;
                if (n >= 28 && highs.length >= 28 && lows.length >= 28) {
                  let sPDM = 0, sNDM = 0, sTR = 0;
                  for (let di = n - 14; di < n; di++) {
                    const upM = highs[di] - highs[di - 1];
                    const downM = lows[di - 1] - lows[di];
                    sPDM += upM > downM && upM > 0 ? upM : 0;
                    sNDM += downM > upM && downM > 0 ? downM : 0;
                    sTR += Math.max(highs[di] - lows[di], Math.abs(highs[di] - closes[di - 1]), Math.abs(lows[di] - closes[di - 1]));
                  }
                  const pDI = sTR > 0 ? sPDM / sTR * 100 : 0;
                  const mDI = sTR > 0 ? sNDM / sTR * 100 : 0;
                  const dxV = (pDI + mDI) > 0 ? Math.abs(pDI - mDI) / (pDI + mDI) * 100 : 0;
                  if (dxV > 25 && pDI > mDI) adxBullish = true;
                  if (dxV > 25 && mDI > pDI) adxBearish = true;
                }

                updated[idx] = {
                  ...updated[idx],
                  rsi, fiftyDayAvg: ma50, twoHundredDayAvg: ma200, ma50, ma200, ma200Dist,
                  high52w, low52w, volRatio, weekChange, stoch, mfi, wr,
                  rsiDivType, cmf, gap, bbWidth, atr14Pct, adxBullish, adxBearish,
                };
              }
              return updated;
            });
          }
        } catch {}
      }
    }

    // ── 장외(프리/포스트마켓) 가격 — 전체 US 종목 + 관심종목 (owner 전용 Stage B) ──
    const extSymSet = new Set();
    // 기본 주요 종목 + hotAssets에서 가져온 종목 (hotResults 참조 — 최신 데이터)
    ["NVDA","AAPL","TSLA","MSFT","GOOGL","AMZN","META","AMD","AVGO","COIN","MSTR",
     "BITX","TQQQ","SOXL","IBIT","BITO","MARA","RIOT","SOFI","HOOD","PLTR",
     "SQQQ","SOXS","UVXY","FNGU","LABU","TMF"].forEach(s => extSymSet.add(s));
    // hotResults (방금 fetch한 최신 데이터)에서 US 종목 추가
    for (const h of hotResults) {
      if (h.market === "us" && h.symbolRaw && !h.symbolRaw.includes(".KS")) extSymSet.add(h.symbolRaw);
    }
    // watchlist에서 US 종목 추가 (유저별 키)
    try {
      const wlKey = user ? `di_${user.id.slice(0, 8)}_watchlist` : null;
      const wl = wlKey ? JSON.parse(localStorage.getItem(wlKey) || "[]") : [];
      for (const w of wl) {
        if (w.market === "us" && w.symbolRaw && !w.symbolRaw.includes(".KS")) extSymSet.add(w.symbolRaw);
        else if (w.market === "us" && w.symbol && !w.symbol.includes(".KS")) extSymSet.add(w.symbol);
      }
    } catch {}
    // US_ASSETS 전체에서도 추가 (레버리지/크립토 ETF 포함)
    for (const a of US_ASSETS) {
      if (!a.symbol.includes(".KS")) extSymSet.add(a.symbol);
    }
    const extResults = {};
    // yahoo-quote API는 한번에 최대 50개 정도 처리 가능, 필요시 분할
    // ★ 청크 순차 await → 동시 발사 (8청크 × ~350ms 직렬 3초가 최장 1청크 시간으로 단축)
    const extSymArr = [...extSymSet];
    const chunkSize = 40;
    const extChunks = [];
    for (let ci = 0; ci < extSymArr.length; ci += chunkSize) extChunks.push(extSymArr.slice(ci, ci + chunkSize).join(","));
    await Promise.all(extChunks.map(async (chunk) => {
      try {
        const er = await fetch(`/api/yahoo-quote?symbols=${encodeURIComponent(chunk)}`);
        if (er.ok) {
          const { quotes = {} } = await er.json();
          for (const [sym, q] of Object.entries(quotes)) {
            if (q.marketState === "PRE" && q.preMarketPrice) {
              extResults[sym] = { price: q.preMarketPrice, change: q.preMarketChangePct, isPreMarket: true, isPostMarket: false };
            } else if ((q.marketState === "POST" || q.marketState === "POSTPOST" || q.marketState === "CLOSED") && q.postMarketPrice) {
              extResults[sym] = { price: q.postMarketPrice, change: q.postMarketChangePct, isPreMarket: false, isPostMarket: true };
            }
          }
        }
      } catch {}
    }));
    setExtendedHours(extResults);

    // ── 섹터/테마 ETF 성과 ──
    const sectorETFs = [
      { symbol: "XLK", name: "기술", icon: "💻" },
      { symbol: "XLF", name: "금융", icon: "🏦" },
      { symbol: "XLV", name: "헬스케어", icon: "🏥" },
      { symbol: "XLE", name: "에너지", icon: "⛽" },
      { symbol: "XLI", name: "산업재", icon: "🏭" },
      { symbol: "XLY", name: "경기소비", icon: "🛒" },
      { symbol: "XLP", name: "필수소비", icon: "🧴" },
      { symbol: "XLU", name: "유틸리티", icon: "💡" },
      { symbol: "XLRE", name: "부동산", icon: "🏠" },
      { symbol: "XLC", name: "커뮤니케이션", icon: "📱" },
      { symbol: "XLB", name: "소재", icon: "🪨" },
    ];
    const sectorResults = [];
    try {
      const sSyms = sectorETFs.map(s => s.symbol).join(",");
      const sr = await fetch(`/api/yahoo-batch?symbols=${encodeURIComponent(sSyms)}&interval=1d&range=5d`);
      if (sr.ok) {
        const sBatch = (await sr.json()).results || {};
        for (const etf of sectorETFs) {
          const d = sBatch[etf.symbol];
          if (d && d.closes?.length >= 2) {
            const cur = d.closes[d.closes.length - 1];
            const prev = d.closes[d.closes.length - 2];
            const wkAgo = d.closes[0];
            sectorResults.push({
              ...etf, price: cur,
              change1d: +((cur - prev) / prev * 100).toFixed(2),
              changeWk: +((cur - wkAgo) / wkAgo * 100).toFixed(2),
            });
          }
        }
      }
    } catch {}
    sectorResults.sort((a, b) => b.change1d - a.change1d);
    setSectorPerf(sectorResults);

    // marketLoading 은 Stage A 끝에서 이미 해제됨 — 여기선 재진입 가드만 풉니다.
    fetchingRef.current = false;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 경제 캘린더 KST 파트 헬퍼 ──
  // toLocaleString 트릭은 fragile (locale·browser 의존) — UTC+9 시프트 후 getUTC* 로 안전 추출.
  // Invalid Date 면 모든 필드 NaN 대신 표시용 fallback 값 반환.
  const kstParts = (d) => {
    if (!(d instanceof Date) || isNaN(d.getTime())) {
      return { valid: false, year: 0, month: 0, date: 0, day: 0, hour: 0, min: 0 };
    }
    const k = new Date(d.getTime() + 9 * 3600000);
    return {
      valid: true,
      year: k.getUTCFullYear(),
      month: k.getUTCMonth(),       // 0-11
      date: k.getUTCDate(),
      day: k.getUTCDay(),           // 0=일
      hour: k.getUTCHours(),
      min: k.getUTCMinutes(),
    };
  };

  // ── 경제 캘린더 (API 기반 + 실제/예상 수치) ──
  const fetchEconCalendar = useCallback(async () => {
    try {
      const resp = await fetch("/api/econ-calendar");
      const data = await resp.json();
      const now = new Date();
      const events = (data.events || []).map(e => {
        // API 응답 date 형식 두 종류 호환:
        //   A) "2026-04-15"            (날짜만)
        //   B) "2026-04-02 12:30:00"   (UTC 시각 포함)
        // 시간이 있으면 그대로 UTC 로 파싱, 없으면 ET 표준 발표시간(8:30/14:00) 합성
        const isForFed = /FOMC|Fed.*Rate|Interest Rate/i.test(e.event);
        const etHour = isForFed ? 14 : 8;
        const etMin = isForFed ? 0 : 30;
        // ★ 2026-06-12: dt(ForexFactory 실제 발표시각, TZ 포함) 우선 — ET 합성 추정보다 정확
        const rawDate = String(e.dt || e.date || "");
        const dateOnly = rawDate.slice(0, 10); // "YYYY-MM-DD"
        const hasTime = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(rawDate);
        let d = null;
        if (hasTime) {
          // API 시간 정보 활용 — 공백을 T 로 치환 + UTC 표시 Z 추가
          // TZ 오프셋(+09:00/-04:00) 또는 Z 가 이미 있으면 그대로, 없으면 UTC 로 간주해 Z 부착
          const hasTz = /(?:Z|[+-]\d{2}:?\d{2})$/.test(rawDate);
          const iso = rawDate.replace(" ", "T") + (hasTz ? "" : "Z");
          d = new Date(iso);
        }
        if (!d || isNaN(d.getTime())) {
          // 시간 없거나 파싱 실패 — ET 표준 시간 + DST 자동 보정해서 UTC 합성
          const md = dateOnly.match(/^(\d{4})-(\d{2})-(\d{2})$/);
          if (md) {
            const month = Number(md[2]);
            const day = Number(md[3]);
            const etOffset =
              (month < 3 || month > 11) ? 5 :
              (month > 3 && month < 11) ? 4 :
              (month === 3) ? (day >= 8 ? 4 : 5) :
              (month === 11) ? (day >= 1 && day < 8 ? 4 : 5) :
              5;
            const utcHour = etHour + etOffset;
            d = new Date(`${dateOnly}T${String(utcHour).padStart(2,"0")}:${String(etMin).padStart(2,"0")}:00Z`);
          }
        }
        if (!d || isNaN(d.getTime())) {
          // 마지막 안전망 — 자정 UTC
          d = new Date(`${dateOnly}T00:00:00Z`);
        }
        // 한국 시간 기준 날짜 차이 계산 (KST = UTC+9 시프트로 안전 추출)
        const KST_MS = 9 * 3600000;
        const kstNow = new Date(now.getTime() + KST_MS);
        const kstEvt = new Date(d.getTime() + KST_MS);
        const nowDay = Date.UTC(kstNow.getUTCFullYear(), kstNow.getUTCMonth(), kstNow.getUTCDate());
        const evtDay = Date.UTC(kstEvt.getUTCFullYear(), kstEvt.getUTCMonth(), kstEvt.getUTCDate());
        const diff = Math.floor((evtDay - nowDay) / 86400000);
        // ★ 2026-06-12 (대표 제보): (YoY)/(MoM) 을 전부 떼면 'CPI' 가 중복으로 보임
        //   → 전년/전월 한글 구분 유지, 그 외 괄호(분기 표기 등)만 제거
        const evtName = e.event
          .replace(/\s*\(YoY\)/i, " · 전년")
          .replace(/\s*\(MoM\)/i, " · 전월")
          .replace(/\s*\(QoQ\)/i, " · 전분기")
          .replace(/\(.*?\)\s*/g, "")
          .trim();
        let icon = "📊";
        let type = "OTHER";
        if (/FOMC|Fed.*Rate|Interest Rate/i.test(e.event)) { icon = "🏛️"; type = "FOMC"; }
        else if (/\bCPI\b|Consumer Price/i.test(e.event)) { icon = "📊"; type = "CPI"; }
        else if (/Nonfarm|Non-Farm|NFP/i.test(e.event)) { icon = "👷"; type = "NFP"; }
        else if (/\bGDP\b|Gross Domestic/i.test(e.event)) { icon = "📈"; type = "GDP"; }
        else if (/\bPCE\b|Personal Consumption/i.test(e.event)) { icon = "💰"; type = "PCE"; }
        else if (/Retail Sales/i.test(e.event)) { icon = "🛍️"; type = "RETAIL"; }
        else if (/Unemployment/i.test(e.event)) { icon = "👥"; type = "UNEMP"; }
        else if (/\bPPI\b|Producer Price/i.test(e.event)) { icon = "🏭"; type = "PPI"; }
        else if (/\bISM\b/i.test(e.event)) { icon = "🏭"; type = "ISM"; }
        else if (/Jobless/i.test(e.event)) { icon = "📋"; type = "CLAIMS"; }
        return {
          ...e, icon, type, name: evtName, date: d, daysUntil: diff,
          status: diff < -1 ? "완료" : diff < 0 ? "어제" : diff === 0 ? "오늘" : diff <= 3 ? "임박" : "예정",
          importance: e.impact === "High" ? "high" : "medium",
          actual: e.actual, estimate: e.estimate, previous: e.previous, unit: e.unit || "",
        };
      });
      events.sort((a, b) => a.date - b.date);
      setEconEvents(events);
    } catch {
      setEconEvents([]);
    }
  }, []);

  // ── 모바일 핀치 줌 / 더블탭 줌 차단 (앱처럼 동작) ──
  useEffect(() => {
    // iOS Safari에서 gesturestart (핀치) 차단
    const preventGesture = (e) => e.preventDefault();
    document.addEventListener("gesturestart", preventGesture, { passive: false });
    document.addEventListener("gesturechange", preventGesture, { passive: false });
    // 2+ 손가락 터치 줌 차단
    const preventMultiTouch = (e) => { if (e.touches.length > 1) e.preventDefault(); };
    document.addEventListener("touchstart", preventMultiTouch, { passive: false });
    // 더블탭 줌 차단 (300ms 이내 연속 터치)
    let lastTouchEnd = 0;
    const preventDoubleTap = (e) => {
      const now = Date.now();
      if (now - lastTouchEnd <= 300) e.preventDefault();
      lastTouchEnd = now;
    };
    document.addEventListener("touchend", preventDoubleTap, { passive: false });
    return () => {
      document.removeEventListener("gesturestart", preventGesture);
      document.removeEventListener("gesturechange", preventGesture);
      document.removeEventListener("touchstart", preventMultiTouch);
      document.removeEventListener("touchend", preventDoubleTap);
    };
  }, []);

  // ★ 2026-06-12 (전수 감사): anomaly·quant-report·risk-map 딥링크 직행 시 hotAssets/지수가
  //   영원히 비어 '이상 없음' 같은 거짓 화면이 렌더되던 문제 — 진입 시 1회 로드.
  useEffect(() => {
    if (!["anomaly", "quant-report", "risk-map"].includes(tab)) return;
    if (marketIndices.length === 0 && !marketLoading) fetchMarketOverview();
    // ★ 2026-08-10 (#215 회귀): 홈을 먼저 봤으면 지수가 이미 차 있어 위 호출이 스킵되는데,
    //   비owner 는 dailyPicks 가 여전히 비어 있습니다. quant-report 는 직접 채웁니다.
    if (tab === "quant-report" && Date.now() - picksAtRef.current > 5 * 60 * 1000) {
      picksAtRef.current = Date.now();
      fetchDailyPicks();
    }
  }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  // 홈 탭 진입 시 즉시 로드 + 30초 간격 자동 갱신
  // ★ 백그라운드 탭 가드 — document.hidden 일 땐 fetch 건너뜀 (모바일 배터리·데이터 절약)
  useEffect(() => {
    if (tab !== "home") return;
    if (marketIndices.length === 0) fetchMarketOverview();
    fetchEconCalendar();
    if (portfolio.length > 0) fetchPortfolioPrices();
    const iv = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      fetchMarketOverview();
    }, 30000);
    // 탭 다시 visible 될 때 즉시 갱신 (정확성 회복)
    const onVis = () => { if (!document.hidden) fetchMarketOverview(); };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(iv);
      document.removeEventListener("visibilitychange", onVis);
      // 탭 떠날 때 진행 중인 요청 취소
      if (abortRef.current) abortRef.current.abort();
      fetchingRef.current = false;
    };
  }, [tab]);

  // 경제 캘린더 진입 시 즉시 로드 + 발표 시간대 자동 갱신
  // ★ 2026-08-12 IA v3: 캘린더 화면이 지표 탭의 캘린더 서브탭으로 이동 — 트리거도 이동.
  //   (구 /econ-calendar 진입은 아래 리다이렉트 효과가 지표 탭으로 정정합니다)
  useEffect(() => {
    if (!(tab === "indicators" && indicatorsView === "calendar")) return;
    fetchEconCalendar();
    // 발표 시간대(KST 21:00~02:00)에는 30초 간격, 그 외 5분 간격 자동 갱신
    const hourKST = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" })).getHours();
    const isAnnouncementWindow = hourKST >= 21 || hourKST <= 2;
    const interval = isAnnouncementWindow ? 30000 : 300000;
    const iv = setInterval(fetchEconCalendar, interval);
    return () => clearInterval(iv);
  }, [tab, indicatorsView]);

  // ── 전략 매매 알림 생성 함수 ──────────────────────────────────
  // 스크리닝 결과에서 전략 포트폴리오 종목의 시그널을 찾아 알림 생성
  const STRATEGY_PORTFOLIO_SYMBOLS = useMemo(() => {
    // 전략별 포트폴리오 종목 매핑 (QuantPortfolio.jsx의 포트폴리오에서 추출)
    const map = {};
    const portfolios = {
      "RSI 반전 전략": ["GOOGL","AMD","TSLA","AAPL","DIS","PYPL","INTC","005930.KS","035720.KS","ETH-USD","SOL-USD"],
      "볼린저밴드 바운스": ["AAPL","MSFT","JPM","JNJ","PG","V","KO","PEP","MRK","COST","105560.KS","055550.KS"],
      "MACD 크로스오버": ["SPY","QQQ","NVDA","AVGO","MSFT","META","LLY","COST","005930.KS","035420.KS","BTC-USD"],
      "이평선 크로스 (20/60)": ["SPY","QQQ","DIA","AAPL","MSFT","AMZN","JNJ","BTC-USD","GLD","005930.KS"],
      "거래량 돌파 전략": ["NVDA","AMD","TSLA","AVGO","BTC-USD","SOL-USD","ETH-USD","005930.KS","042700.KS"],
      "터틀 트레이딩": ["BTC-USD","ETH-USD","SOL-USD","GLD","XOM","CVX","SPY","CAT","005380.KS","009540.KS"],
      "듀얼 모멘텀": ["SPY","QQQ","IWM","BTC-USD","GLD","NVDA","AAPL","005930.KS","TLT"],
      "슈퍼트렌드": ["BTC-USD","SOL-USD","NVDA","TSLA","AMD","COIN","META","005930.KS","042700.KS"],
      "일목균형표": ["005930.KS","000660.KS","035420.KS","005380.KS","068270.KS","SPY","BTC-USD","NVDA"],
      "BB 스퀴즈 돌파": ["NVDA","TSLA","AMD","AVGO","BTC-USD","SOL-USD","META","005930.KS","000660.KS"],
      "ATR 스윙": ["TSLA","NVDA","BTC-USD","SOL-USD","GLD","TLT","XOM","SPY","005930.KS"],
      "스토캐스틱+RSI 콤보": ["AMZN","META","NFLX","CRM","068270.KS","BTC-USD","MA"],
      "VWAP 반전": ["NVDA","AMD","MRVL","MU","QCOM","SOXX","000660.KS","042700.KS","AVGO"],
      "피보나치 되돌림": ["SPY","QQQ","AAPL","MSFT","BTC-USD","GLD","005930.KS","000660.KS"],
      "MACD 다이버전스": ["TSLA","AMD","GOOGL","BTC-USD","ETH-USD","SOL-USD","005930.KS","035720.KS"],
      "레짐 전환 적응형": ["SPY","TLT","GLD","IWM","QQQ","BTC-USD","005930.KS","AAPL"],
      "헤이킨 아시 추세": ["NVDA","META","AVGO","LLY","BTC-USD","SOL-USD","005930.KS","NFLX"],
      "파라볼릭 SAR": ["SPY","QQQ","NVDA","AAPL","BTC-USD","GLD","005930.KS","XOM"],
      "캔들 패턴 (엔궐핑)": ["TSLA","NVDA","AMD","SOL-USD","BTC-USD","005380.KS","000270.KS","BA"],
      "채널 돌파 모멘텀": ["BTC-USD","SOL-USD","NVDA","TSLA","AMD","005930.KS","042700.KS","COIN"],
      "모멘텀·거래량 가중": ["NVDA","AVGO","META","LLY","BTC-USD","005930.KS","SPY"],
      "CCI 오실레이터": ["AMZN","GOOG","AAPL","NFLX","BTC-USD","005930.KS","035420.KS","JPM"],
    };
    for (const [strategy, syms] of Object.entries(portfolios)) {
      for (const sym of syms) {
        const cleanSym = sym.replace(".KS", "").replace("-USD", "");
        if (!map[cleanSym]) map[cleanSym] = [];
        map[cleanSym].push(strategy);
      }
    }
    return map;
  }, []);

  const US_KO = useMemo(() => US_KO_NAMES, []);

  // ═══════════════════════════════════════════════════════════════
  // 진짜 퀀트 전략 기반 매매 알림 생성
  // 각 전략의 generate(candles) 함수를 실제 호출하여 BUY/SELL 시그널 감지
  // ═══════════════════════════════════════════════════════════════
  const generateStrategyAlerts = useCallback(async (candleMap) => {
    // ★ 감사 배치3 (perf): 전략 엔진(86KB)은 이 함수가 처음 불릴 때(=스캔 완료 후)에만
    //   동적 로드합니다. 브라우저 모듈 캐시 덕에 두 번째 호출부터는 비용이 없습니다.
    //   호출부(runScan 말미)는 결과를 await 하지 않는 fire-and-forget 이라
    //   async 전환이 시그니처 영향을 주지 않습니다.
    let STRATEGY_NAME_MAP;
    try {
      const { ALL_STRATEGIES } = await import("./strategies.js");
      STRATEGY_NAME_MAP = {};
      for (const s of ALL_STRATEGIES) STRATEGY_NAME_MAP[s.name] = s;
    } catch {
      return; // 오프라인 등으로 청크 로드 실패 시 알림 생성만 조용히 생략 (스캔 결과는 무관)
    }
    const newAlerts = [];
    const now = new Date();
    const RECENT_WINDOW = 5; // 최근 5봉 이내 시그널만 알림 대상

    // 포트폴리오별 전략 실행
    const portfolios = {
      "RSI 반전 전략": ["GOOGL","AMD","TSLA","AAPL","DIS","PYPL","INTC","005930","035720","ETH","SOL"],
      "볼린저밴드 바운스": ["AAPL","MSFT","JPM","JNJ","PG","V","KO","PEP","MRK","COST","105560","055550"],
      "MACD 크로스오버": ["SPY","QQQ","NVDA","AVGO","MSFT","META","LLY","COST","005930","035420","BTC"],
      "이평선 크로스 (20/60)": ["SPY","QQQ","DIA","AAPL","MSFT","AMZN","JNJ","BTC","GLD","005930"],
      "거래량 돌파 전략": ["NVDA","AMD","TSLA","AVGO","BTC","SOL","ETH","005930","042700"],
      "터틀 트레이딩": ["BTC","ETH","SOL","GLD","XOM","CVX","SPY","CAT","005380","009540"],
      "듀얼 모멘텀": ["SPY","QQQ","IWM","BTC","GLD","NVDA","AAPL","005930","TLT"],
      "슈퍼트렌드": ["BTC","SOL","NVDA","TSLA","AMD","COIN","META","005930","042700"],
      "일목균형표": ["005930","000660","035420","005380","068270","SPY","BTC","NVDA"],
      "BB 스퀴즈 돌파": ["NVDA","TSLA","AMD","AVGO","BTC","SOL","META","005930","000660"],
      "ATR 스윙": ["TSLA","NVDA","BTC","SOL","GLD","TLT","XOM","SPY","005930"],
      "스토캐스틱+RSI 콤보": ["AMZN","META","NFLX","CRM","068270","BTC","MA"],
      "VWAP 반전": ["NVDA","AMD","MRVL","MU","QCOM","SOXX","000660","042700","AVGO"],
      "피보나치 되돌림": ["SPY","QQQ","AAPL","MSFT","BTC","GLD","005930","000660"],
      "MACD 다이버전스": ["TSLA","AMD","GOOGL","BTC","ETH","SOL","005930","035720"],
      "레짐 전환 적응형": ["SPY","TLT","GLD","IWM","QQQ","BTC","005930","AAPL"],
      "헤이킨 아시 추세": ["NVDA","META","AVGO","LLY","BTC","SOL","005930","NFLX"],
      "파라볼릭 SAR": ["SPY","QQQ","NVDA","AAPL","BTC","GLD","005930","XOM"],
      "캔들 패턴 (엔궐핑)": ["TSLA","NVDA","AMD","SOL","BTC","005380","000270","BA"],
      "채널 돌파 모멘텀": ["BTC","SOL","NVDA","TSLA","AMD","005930","042700","COIN"],
      "모멘텀·거래량 가중": ["NVDA","AVGO","META","LLY","BTC","005930","SPY"],
      "CCI 오실레이터": ["AMZN","GOOG","AAPL","NFLX","BTC","005930","035420","JPM"],
    };

    for (const [stratName, symbols] of Object.entries(portfolios)) {
      const stratObj = STRATEGY_NAME_MAP[stratName];
      if (!stratObj || typeof stratObj.generate !== "function") continue;

      for (const sym of symbols) {
        const data = candleMap[sym];
        if (!data || !data.closes || data.closes.length < 30) continue;

        try {
          // 일간 데이터를 candle 객체 배열로 변환
          const candles = data.closes.map((c, i) => ({
            close: c,
            high: data.highs?.[i] ?? c,
            low: data.lows?.[i] ?? c,
            open: i > 0 ? data.closes[i - 1] : c,
            volume: data.volumes?.[i] ?? 0,
          }));

          // 전략 generate() 실제 호출
          const signals = stratObj.generate(candles);
          if (!signals || signals.length === 0) continue;

          // 최근 RECENT_WINDOW 봉 이내 시그널만 필터
          const totalLen = candles.length;
          const recentSignals = signals.filter(s => s.index >= totalLen - RECENT_WINDOW);
          if (recentSignals.length === 0) continue;

          // 가장 최근 시그널 사용
          const lastSignal = recentSignals[recentSignals.length - 1];
          const action = lastSignal.type === "BUY" ? "매수" : "매도";
          const lastPrice = candles[candles.length - 1]?.close;
          const prevPrice = candles.length > 5 ? candles[candles.length - 6]?.close : lastPrice;
          const change = prevPrice ? ((lastPrice - prevPrice) / prevPrice * 100) : 0;

          const assetName = data.name || US_KO_NAMES[sym] || sym;
          const isKr = data.market === "kr";
          const isCrypto = data.market === "crypto";
          const flag = isKr ? "🇰🇷" : isCrypto ? "₿" : "🇺🇸";

          newAlerts.push({
            id: `${now.getTime()}-${sym}-${stratName}`,
            timestamp: now.toISOString(),
            strategy: stratName,
            strategyIcon: stratObj.icon || "📊",
            symbol: sym,
            symbolRaw: data.symbolRaw || sym,
            name: assetName,
            market: data.market || "us",
            flag,
            action,
            signalType: lastSignal.type,
            price: lastPrice,
            signalPrice: lastSignal.price,
            change: change.toFixed(2),
            reason: lastSignal.reason || `${stratName} ${action} 시그널`,
            signalIndex: lastSignal.index,
            totalCandles: totalLen,
            recentSignalCount: recentSignals.length,
            allRecentSignals: recentSignals.slice(-3).map(s => ({
              type: s.type, reason: s.reason, index: s.index,
            })),
            read: false,
          });
        } catch (err) {
          // 전략 실행 오류 (무시 — 일부 전략은 특정 데이터에서 에러 가능)
          console.warn(`[전략알림] ${stratName}/${sym} 오류:`, err.message);
        }
      }
    }

    if (newAlerts.length > 0) {
      // 중요도 정렬: 시그널이 더 최근일수록, 복수 시그널이 있을수록 상위
      newAlerts.sort((a, b) => {
        const recencyA = a.totalCandles - a.signalIndex;
        const recencyB = b.totalCandles - b.signalIndex;
        if (recencyA !== recencyB) return recencyA - recencyB;
        return b.recentSignalCount - a.recentSignalCount;
      });

      setTradeAlerts(prev => [...newAlerts, ...prev].slice(0, 200));
      setAlertBadge(prev => prev + newAlerts.length);

      // ── 브라우저 푸시 알림 ──
      if ("Notification" in window && Notification.permission === "granted") {
        const buys = newAlerts.filter(a => a.action === "매수");
        const sells = newAlerts.filter(a => a.action === "매도");
        // 전략별로 그룹핑해서 알림
        const grouped = {};
        for (const a of newAlerts) {
          if (!grouped[a.strategy]) grouped[a.strategy] = [];
          grouped[a.strategy].push(a);
        }
        const stratCount = Object.keys(grouped).length;
        // 메인 요약 알림
        const title = `Zepta 매매 시그널 ${newAlerts.length}건`;
        const lines = [];
        for (const [strat, items] of Object.entries(grouped).slice(0, 5)) {
          const icon = items[0]?.strategyIcon || "📊";
          const syms = items.map(a => `${a.action === "매수" ? "🟢" : "🔴"}${a.name}`).join(", ");
          lines.push(`${icon} ${strat}: ${syms}`);
        }
        if (stratCount > 5) lines.push(`⋯ +${stratCount - 5}개 전략`);
        try {
          const noti = new Notification(title, {
            body: lines.join("\n"),
            icon: "/favicon.ico",
            badge: "/favicon.ico",
            tag: "di-strategy-alert",
            renotify: true,
            requireInteraction: false,
            silent: false,
          });
          noti.onclick = () => { window.focus(); noti.close(); };
          // 개별 전략 알림 (상위 3개 전략만)
          let delay = 300;
          for (const [strat, items] of Object.entries(grouped).slice(0, 3)) {
            setTimeout(() => {
              const icon = items[0]?.strategyIcon || "📊";
              const body = items.slice(0, 4).map(a => {
                const emoji = a.action === "매수" ? "🟢 매수" : "🔴 매도";
                const priceStr = a.market === "kr" ? `₩${Math.round(a.price || 0).toLocaleString()}` : `$${(a.price || 0).toFixed(2)}`;
                return `${emoji} ${a.flag}${a.name} ${priceStr}\n  📌 ${a.reason}`;
              }).join("\n");
              try {
                const n2 = new Notification(`${icon} ${strat}`, {
                  body: body + (items.length > 4 ? `\n⋯ +${items.length - 4}건` : ""),
                  icon: "/favicon.ico",
                  tag: `di-strat-${strat}`,
                  renotify: true,
                });
                n2.onclick = () => { window.focus(); n2.close(); };
              } catch {}
            }, delay);
            delay += 500;
          }
        } catch {}
      }

      // 텔레그램 동시 발송 (전략 매매 알림)
      if (settings.botToken && settings.chatId && settings.strategyAlerts) {
        const tgMsg = formatStrategyAlertTelegram(newAlerts.slice(0, 15));
        fetch(`/api/telegram-send`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ botToken: settings.botToken, chatId: settings.chatId, text: tgMsg, parseMode: "Markdown" }),
        }).catch(() => {});
      }
    }
  }, [settings]);

  // 전략 매매 알림 텔레그램 포맷 (실제 전략 시그널 기반)
  function formatStrategyAlertTelegram(alerts) {
    const now = new Date();
    const timeStr = now.toLocaleString("ko-KR", { month: "short", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit" });
    let msg = `🚨 *Zepta 퀀트 전략 매매 시그널*\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `📅 ${timeStr}\n`;
    msg += `⚙️ _실제 전략 generate() 시그널 기반_\n\n`;

    const grouped = {};
    for (const a of alerts) {
      if (!grouped[a.strategy]) grouped[a.strategy] = [];
      grouped[a.strategy].push(a);
    }

    // 전략별 신뢰도 표시
    for (const [strategy, items] of Object.entries(grouped)) {
      const icon = items[0]?.strategyIcon || "📊";
      const buyCount = items.filter(i => i.action === "매수").length;
      const sellCount = items.filter(i => i.action === "매도").length;
      msg += `*${icon} ${strategy}* (매수${buyCount}/매도${sellCount})\n`;
      msg += `┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈\n`;

      for (const a of items.slice(0, 5)) {
        const emoji = a.action === "매수" ? "🟢" : "🔴";
        const priceStr = a.market === "kr" ? `₩${Math.round(a.price || 0).toLocaleString()}` : `$${(a.price || 0).toLocaleString(undefined, {maximumFractionDigits: 2})}`;
        const changeEmoji = Number(a.change) >= 2 ? "🔥" : Number(a.change) >= 0 ? "▲" : Number(a.change) <= -2 ? "💧" : "▼";
        const changeStr = `${Number(a.change) >= 0 ? "+" : ""}${a.change}%`;
        // 신뢰도 바 (강도 기반)
        const strength = a.strength || a.score || 5;
        const bar = strength >= 8 ? "🟩🟩🟩" : strength >= 6 ? "🟩🟩⬜" : strength >= 4 ? "🟨🟨⬜" : "🟥⬜⬜";
        msg += `${emoji} *${a.name}* (\`${a.symbol}\`)\n`;
        msg += `   ${priceStr} ${changeEmoji}${changeStr} — *${a.action}* ${bar}\n`;
        msg += `   📌 ${a.reason}\n\n`;
      }
      if (items.length > 5) msg += `  ⋯ +${items.length - 5}건 더\n`;
      msg += `\n`;
    }

    const buys = alerts.filter(a => a.action === "매수").length;
    const sells = alerts.filter(a => a.action === "매도").length;

    // 시장 센티먼트 게이지
    const sentiment = alerts.length > 0 ? (buys / alerts.length * 100) : 50;
    const sentimentIcon = sentiment >= 70 ? "🟢" : sentiment >= 50 ? "🟡" : sentiment >= 30 ? "🟠" : "🔴";
    const sentimentLabel = sentiment >= 70 ? "강세" : sentiment >= 50 ? "중립~강세" : sentiment >= 30 ? "중립~약세" : "약세";

    msg += `━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `📊 *총 ${alerts.length}건* 시그널\n`;
    msg += `   🟢 매수 ${buys}건 | 🔴 매도 ${sells}건\n`;
    msg += `   ${sentimentIcon} 센티먼트: *${sentimentLabel}* (매수 ${sentiment.toFixed(0)}%)\n`;

    // 가장 강한 시그널 하이라이트
    const strongest = alerts.reduce((best, a) => {
      const s = a.strength || a.score || 0;
      return s > (best.strength || best.score || 0) ? a : best;
    }, alerts[0]);
    if (strongest) {
      msg += `\n⭐ *최강 시그널*: ${strongest.action} ${strongest.name} (${strongest.strategy})\n`;
    }

    msg += `\n_⚠️ 본 시그널은 참고용이며 투자 결정은 본인 판단에 따르세요_\n`;
    msg += `_Zepta 퀀트 전략 엔진_`;
    return msg;
  }

  // ── 일간 데이터 → 주간 데이터 자체 변환 (API 호출 50% 감소) ──
  function dailyToWeekly(dy) {
    const wCloses = [], wVolumes = [], wHighs = [], wLows = [];
    if (!dy?.closes?.length) return { wCloses, wVolumes, wHighs, wLows };
    const c = dy.closes, h = dy.highs || c, l = dy.lows || c, v = dy.volumes || [];
    // 5일 단위로 주간 데이터 생성
    for (let i = 4; i < c.length; i += 5) {
      const start = Math.max(0, i - 4);
      wCloses.push(c[i]);
      let wh = -Infinity, wl = Infinity, wv = 0;
      for (let j = start; j <= i; j++) {
        if (h[j] > wh) wh = h[j];
        if (l[j] < wl) wl = l[j];
        wv += v[j] || 0;
      }
      wHighs.push(wh); wLows.push(wl); wVolumes.push(wv);
    }
    return { wCloses, wVolumes, wHighs, wLows };
  }

  // ── 스크리너 실행 (초고속 병렬 최적화 v2) ──────────────────────
  // 일간 데이터만 1회 fetch → 주간 자체계산 | 배치 25개 × 5동시 실행
  const runScan = useCallback(async () => {
    if (scanning) return;
    setScanning(true); setScanErrors([]);
    const yahooAssets = [
      ...US_ASSETS.map(a => ({ ...a, market: "us", symbolRaw: a.symbol })),
      ...KR_ASSETS.map(a => ({ ...a, market: "kr", symbolRaw: a.symbol, symbol: a.symbol.replace(".KS", "").replace(".KQ", "") })),
    ];
    const cryptoAssets = CRYPTO_ASSETS.map(a => ({ ...a, market: "crypto", symbol: a.symbol, symbolRaw: a.id }));
    const totalCount = yahooAssets.length + cryptoAssets.length;
    setScanProgress({ done: 0, total: totalCount });
    const found = [], errors = [];
    const candleMap = {};
    let doneCount = 0;

    // ── Yahoo 초고속 배치 (20개 × 8 동시 = 160종목/라운드) ──
    const BATCH_SIZE = 20;
    const CONCURRENT = 8;
    const batches = [];
    for (let b = 0; b < yahooAssets.length; b += BATCH_SIZE) {
      batches.push(yahooAssets.slice(b, b + BATCH_SIZE));
    }

    for (let g = 0; g < batches.length; g += CONCURRENT) {
      const group = batches.slice(g, g + CONCURRENT);
      const groupResults = await Promise.allSettled(group.map(async (batch) => {
        const syms = batch.map(a => a.symbolRaw);
        // 일간 데이터만 1회 fetch (주간은 클라이언트에서 계산)
        const res = await fetch(`/api/yahoo-batch?symbols=${encodeURIComponent(syms.join(","))}&interval=1d&range=1y`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const dyData = (await res.json()).results || {};
        return { batch, dyData };
      }));

      for (const gr of groupResults) {
        if (gr.status !== "fulfilled") {
          const failBatch = group[groupResults.indexOf(gr)] || [];
          failBatch.forEach?.(a => { errors.push(`${a?.market?.toUpperCase()}:${a?.symbol} — batch fail`); doneCount++; });
          continue;
        }
        const { batch, dyData } = gr.value;
        for (const asset of batch) {
          try {
            const dy = dyData[asset.symbolRaw];
            if (!dy || dy.error || !dy.closes?.length || dy.closes.length < 20) throw new Error("데이터 없음");
            // 일간 → 주간 자체 변환
            const { wCloses, wVolumes, wHighs, wLows } = dailyToWeekly(dy);
            const dCloses = dy.closes || [];
            if (!wCloses.length) throw new Error("주간 변환 실패");
            const conditionsWithMkt = [...conditions]; conditionsWithMkt._marketType = asset.market;
            const result = analyzeAsset(wCloses, dCloses, wVolumes, wHighs, wLows, conditionsWithMkt);
            result.market = asset.market;
            const match = mode === "or" ? result.triggers.length > 0 : conditions.every(c => result.triggers.includes(c));
            if (match) found.push({ ...asset, ...result });
            // 전략 알림용 캔들 캐시
            const cleanSym = asset.symbol.replace(".KS", "").replace(".KQ", "");
            candleMap[cleanSym] = {
              closes: dy.closes, highs: dy.highs || dy.closes, lows: dy.lows || dy.closes,
              volumes: dy.volumes || [], market: asset.market, name: asset.name, symbolRaw: asset.symbolRaw,
            };
          } catch (e) { errors.push(`${asset.market.toUpperCase()}:${asset.symbol} — ${e.message}`); }
          doneCount++;
        }
      }
      setScanProgress({ done: doneCount, total: totalCount });
    }

    // ── 크립토 전체 병렬 (10개 동시) ──
    const cryptoResults = await Promise.allSettled(cryptoAssets.map(async (asset) => {
      const r = await fetch(`/api/coingecko?id=${encodeURIComponent(asset.symbolRaw)}&days=365`);
      if (!r.ok) throw new Error(`CoinGecko ${r.status}`);
      const j = await r.json();
      const dp = (j.prices || []).map(p => p[1]);
      const dv = (j.total_volumes || []).map(v => v[1]);
      const wCloses = [], wVolumes = [], wHighs = [], wLows = [];
      for (let k = 6; k < dp.length; k += 7) {
        const sl = dp.slice(Math.max(0, k - 6), k + 1);
        wCloses.push(dp[k]);
        wVolumes.push(dv.slice(Math.max(0, k - 6), k + 1).reduce((a, c) => a + c, 0));
        wHighs.push(Math.max(...sl)); wLows.push(Math.min(...sl));
      }
      return { asset, wCloses, wVolumes, wHighs, wLows, dCloses: dp, dVolumes: dv };
    }));

    for (let i = 0; i < cryptoResults.length; i++) {
      const r = cryptoResults[i];
      const asset = cryptoAssets[i];
      if (r.status === "fulfilled") {
        try {
          const { wCloses, wVolumes, wHighs, wLows, dCloses, dVolumes } = r.value;
          if (!wCloses.length) throw new Error("데이터 없음");
          const conditionsWithMkt = [...conditions]; conditionsWithMkt._marketType = "crypto";
          const result = analyzeAsset(wCloses, dCloses, wVolumes, wHighs, wLows, conditionsWithMkt);
          result.market = "crypto";
          const match = mode === "or" ? result.triggers.length > 0 : conditions.every(c => result.triggers.includes(c));
          if (match) found.push({ ...asset, ...result });
          if (dCloses.length > 20) {
            candleMap[asset.symbol] = { closes: dCloses, highs: dCloses, lows: dCloses, volumes: dVolumes || [], market: "crypto", name: asset.name, symbolRaw: asset.symbolRaw };
          }
        } catch (e) { errors.push(`CRYPTO:${asset.symbol} — ${e.message}`); }
      } else {
        errors.push(`CRYPTO:${asset.symbol} — ${r.reason?.message || "fetch 실패"}`);
      }
      doneCount++;
    }
    setScanProgress({ done: doneCount, total: totalCount });

    const sorted = found.sort((a, b) => {
      if (sortBy === "rsi")     return (a.rsi ?? 999) - (b.rsi ?? 999);
      if (sortBy === "change")  return a.weekChange - b.weekChange;
      if (sortBy === "vol")     return b.volRatio - a.volRatio;
      return b.triggers.length - a.triggers.length;
    });
    setResults(sorted); setScanErrors(errors); setLastScan(new Date()); setScanning(false);

    // ── 전략 매매 알림 생성 (실제 전략 시그널 기반) ──
    scanCandleCache.current = candleMap;
    if (settings.strategyAlerts !== false) {
      generateStrategyAlerts(candleMap);
    }

    if (settings.autoSend && settings.botToken && settings.chatId && sorted.length > 0) {
      try {
        await sendTelegramAlert(settings.botToken, settings.chatId, sorted, conditions);
        setTgStatus(`✅ ${t("diag.tgAutoSent")}`);
      } catch { setTgStatus(`❌ ${t("diag.tgSendFailed")}`); }
    }
  }, [scanning, conditions, mode, sortBy, settings]);

  // ── 프리셋 선택 시 자동 스캔 ──────────────────────────
  const prevPresetRef = useRef(null);
  useEffect(() => {
    if (activePreset && activePreset !== prevPresetRef.current && conditions.length > 0 && !scanning) {
      runScan();
    }
    prevPresetRef.current = activePreset;
  }, [activePreset, conditions, scanning, runScan]);

  // ── 현재 스크리너 조건 저장 (전수 감사 — 저장→재실행 루프 완성) ──
  const saveCurrentScreener = useCallback(async () => {
    if (!user?.id) { showToast(t("diag.loginToSaveConditions"), "info"); return; }
    if (!conditions.length) { showToast(t("diag.selectConditionsFirst"), "info"); return; }
    const name = `${t("diag.myConditions", { n: conditions.length })} · ${new Date().toLocaleTimeString(lang === "en" ? "en-US" : "ko-KR", { hour: "2-digit", minute: "2-digit" })}`;
    try {
      const r = await fetch("/api/screeners/save", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uid: user.id, screener: { name, conditions: {}, conditionKeys: conditions, mode } }),
      });
      const j = await r.json();
      if (j?.ok) showToast(t("diag.conditionsSaved"), "success");
      else showToast(j?.error || t("nickname.saveFailed"), "error");
    } catch { showToast(t("nickname.saveFailed"), "error"); }
  }, [user, conditions, mode, showToast, t, lang]);

  // ── 저장한 스크리너 열기 → 조건 주입 후 자동 스캔 (전수 감사 — 저장 루프 완성) ──
  useEffect(() => {
    if (tab === "screener" && Array.isArray(pendingScreenerKeys)) {
      const keys = pendingScreenerKeys;
      setPendingScreenerKeys(null);
      setActivePreset(null);
      setConditions(keys);
      if (keys.length > 0) setTimeout(() => runScan(), 60);
    }
  }, [tab, pendingScreenerKeys]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 자동 스캔 타이머 (30분 간격 등) ──────────────────────────
  const autoScanTimerRef = useRef(null);
  const [nextAutoScan, setNextAutoScan] = useState(null);

  useEffect(() => {
    // 기존 타이머 정리
    if (autoScanTimerRef.current) {
      clearInterval(autoScanTimerRef.current);
      autoScanTimerRef.current = null;
    }
    if (!settings.autoScanEnabled || !settings.autoScanInterval) {
      setNextAutoScan(null);
      return;
    }

    const intervalMs = (settings.autoScanInterval || 30) * 60 * 1000;
    const updateNext = () => setNextAutoScan(new Date(Date.now() + intervalMs));
    updateNext();

    autoScanTimerRef.current = setInterval(() => {
      runScan();
      updateNext();
    }, intervalMs);

    return () => {
      if (autoScanTimerRef.current) clearInterval(autoScanTimerRef.current);
    };
  }, [settings.autoScanEnabled, settings.autoScanInterval, runScan]);

  // ── 저평가 종목 통합 스캔 ─────────────────────────────────────
  const runValueScan = useCallback(async () => {
    if (valueScanning) return;
    setValueScanning(true);
    setValueResults([]);

    // ETF/레버리지/인버스/크립토 제외 — 개별 주식만
    const etfKeywords = ["ETF","3x","-3x","2x","-2x","Select","커버드콜","인컴","레버리지","인버스",
      "VIX","Bond","채권","배당","물가연동","정크","클린에너지","태양광","풍력","ESG","게노믹스",
      "사이버보안","클라우드","로봇","AI ETF","방산 ETF","항공사","여행","게임 ETF","소셜미디어","대마",
      "Gold","Silver","Platinum","Palladium","농산물","밀 ETF","옥수수","구리","Natural Gas","원유",
      "우라늄","희토류","리튬","S&P 500 ETF","나스닥 100","다우 ETF","Russell","Vanguard","Total Market",
      "World Total","선진국","이머징","EAFE","China","Japan ETF","Korea ETF","Brazil","India ETF",
      "Taiwan ETF","Germany ETF","UK ETF","Australia ETF","Canada ETF","Russia","Turkey","A-Shares",
      "Real Estate","반도체 iShares","반도체 VanEck","소프트웨어 ETF","BTC","ETH","ProShares","iShares",
      "Fidelity","Grayscale","ARK 21","Bitwise","VanEck","Valkyrie","WisdomTree","Franklin",
      "Short BTC","ARK Innovation","ARK Next","ARK Genomic","ARK Fintech","ARK Autonomous","ARK Space"];
    const isETF = (name) => etfKeywords.some(k => name.includes(k));

    const stocks = [
      ...US_ASSETS.filter(a => !isETF(a.name)).map(a => ({ ...a, market: "us" })),
      ...KR_ASSETS.map(a => ({ ...a, market: "kr" })),
    ];
    setValueScanProgress({ done: 0, total: stocks.length });

    const allResults = [];
    const BATCH = 20; // yahoo-quote는 최대 50개, 20씩 안전하게
    let done = 0;

    for (let b = 0; b < stocks.length; b += BATCH) {
      const batch = stocks.slice(b, b + BATCH);
      const symbols = batch.map(a => a.symbol).join(",");
      try {
        const r = await fetch(`/api/yahoo-quote?symbols=${encodeURIComponent(symbols)}&_t=${Date.now()}`);
        if (r.ok) {
          const { quotes } = await r.json();
          for (const asset of batch) {
            const q = quotes[asset.symbol];
            if (!q || !q.price) { done++; continue; }

            // ── 밸류에이션 스코어 계산 ──
            let score = 50; // 기본 중립
            let reasons = [];

            // 1) PER (Trailing)
            const per = q.trailingPE;
            if (per != null && per > 0) {
              if (per < 8)       { score += 18; reasons.push(`PER ${per.toFixed(1)} 초저평가`); }
              else if (per < 12) { score += 14; reasons.push(`PER ${per.toFixed(1)} 저평가`); }
              else if (per < 16) { score += 8;  reasons.push(`PER ${per.toFixed(1)} 양호`); }
              else if (per < 22) { score += 2; }
              else if (per < 35) { score -= 5; }
              else               { score -= 12; reasons.push(`PER ${per.toFixed(1)} 고평가`); }
            }

            // 2) Forward PER (성장 할인)
            const fpe = q.forwardPE;
            if (fpe != null && per != null && fpe > 0 && per > 0) {
              const pegLike = fpe / per; // <1 = 이익 성장 예상
              if (pegLike < 0.7)      { score += 10; reasons.push("Forward PE 대폭 할인"); }
              else if (pegLike < 0.9)  { score += 5;  reasons.push("Forward PE 할인"); }
              else if (pegLike > 1.2)  { score -= 5; }
            }

            // 3) PBR
            const pbr = q.priceToBook;
            if (pbr != null && pbr > 0) {
              if (pbr < 0.7)      { score += 15; reasons.push(`PBR ${pbr.toFixed(2)} 초저평가`); }
              else if (pbr < 1.0) { score += 12; reasons.push(`PBR ${pbr.toFixed(2)} 순자산 이하`); }
              else if (pbr < 1.5) { score += 6;  reasons.push(`PBR ${pbr.toFixed(2)} 양호`); }
              else if (pbr < 3.0) { score += 0; }
              else                { score -= 8; }
            }

            // 4) 배당수익률
            const dy = q.dividendYield ? q.dividendYield * 100 : 0;
            if (dy > 5)       { score += 12; reasons.push(`배당 ${dy.toFixed(1)}% 고배당`); }
            else if (dy > 3)  { score += 8;  reasons.push(`배당 ${dy.toFixed(1)}%`); }
            else if (dy > 2)  { score += 4; }
            else if (dy > 1)  { score += 1; }

            // 5) 애널리스트 목표가 대비 업사이드
            const upside = q.targetMean && q.price ? ((q.targetMean - q.price) / q.price * 100) : null;
            if (upside != null) {
              if (upside > 40)       { score += 14; reasons.push(`목표가 +${upside.toFixed(0)}% 대폭 상향`); }
              else if (upside > 25)  { score += 10; reasons.push(`목표가 +${upside.toFixed(0)}%`); }
              else if (upside > 15)  { score += 6; }
              else if (upside > 5)   { score += 2; }
              else if (upside < -10) { score -= 8; reasons.push(`목표가 ${upside.toFixed(0)}% 하향`); }
            }

            // 6) 52주 저점 대비 위치
            const low52 = q.fiftyTwoWeekLow;
            const high52 = q.fiftyTwoWeekHigh;
            if (low52 && high52 && high52 > low52) {
              const pos = (q.price - low52) / (high52 - low52); // 0=저점, 1=고점
              if (pos < 0.15)      { score += 12; reasons.push("52주 최저점 근접"); }
              else if (pos < 0.30) { score += 8;  reasons.push("52주 하단권"); }
              else if (pos < 0.50) { score += 3; }
              else if (pos > 0.90) { score -= 8; }
            }

            // 7) 200일 이동평균 대비
            if (q.twoHundredDayAvg && q.price) {
              const vs200 = (q.price - q.twoHundredDayAvg) / q.twoHundredDayAvg * 100;
              if (vs200 < -30)      { score += 10; reasons.push(`200일선 -${Math.abs(vs200).toFixed(0)}% 괴리`); }
              else if (vs200 < -15) { score += 6; }
              else if (vs200 < -5)  { score += 2; }
            }

            // 8) 이익률 (Profit Margin) — 수익 품질 평가
            const margin = q.profitMargin;
            if (margin != null) {
              if (margin > 0.25)       { score += 8; reasons.push(`이익률 ${(margin * 100).toFixed(0)}% 고수익`); }
              else if (margin > 0.15)  { score += 5; }
              else if (margin > 0.05)  { score += 2; }
              else if (margin < -0.05) { score -= 6; reasons.push(`적자 (이익률 ${(margin * 100).toFixed(0)}%)`); }
              else if (margin < 0)     { score -= 3; }
            }

            // 9) 매출 성장률 — 성장성 가산
            const revGrowth = q.revenueGrowth;
            if (revGrowth != null) {
              if (revGrowth > 0.30)       { score += 8; reasons.push(`매출성장 +${(revGrowth * 100).toFixed(0)}%`); }
              else if (revGrowth > 0.15)  { score += 5; }
              else if (revGrowth > 0.05)  { score += 2; }
              else if (revGrowth < -0.10) { score -= 5; reasons.push(`매출감소 ${(revGrowth * 100).toFixed(0)}%`); }
            }

            // 10) 밸류 + 모멘텀 복합 — 가격이 반등 중인 저평가주 가산
            if (q.fiftyDayAvg && q.twoHundredDayAvg && q.price) {
              const above50d = q.price > q.fiftyDayAvg;
              const below200d = q.price < q.twoHundredDayAvg;
              if (above50d && below200d && per && per < 20) {
                score += 6; reasons.push("밸류+모멘텀 복합 (50일선↑ + 200일선↓ + 저PER)");
              }
            }

            // 11) 애널리스트 컨센서스 신뢰도 (분석가 수 가중)
            if (q.analystCount && q.analystCount >= 10 && upside && upside > 20) {
              score += 4; reasons.push(`컨센서스 강력 (${q.analystCount}명 커버)`);
            } else if (q.analystCount && q.analystCount < 3 && upside) {
              score -= 2; // 커버리지 부족 시 목표가 신뢰도 감점
            }

            // 12) ROE (자기자본이익률) — 수익 품질 보강
            const roe = q.returnOnEquity;
            if (roe != null) {
              if (roe > 0.25)       { score += 7; reasons.push(`ROE ${(roe * 100).toFixed(0)}% 고효율`); }
              else if (roe > 0.15)  { score += 4; }
              else if (roe > 0.08)  { score += 1; }
              else if (roe < 0)     { score -= 6; reasons.push(`ROE ${(roe * 100).toFixed(0)}% 적자`); }
              else if (roe < 0.03)  { score -= 3; }
            }

            // 13) 부채비율 — 밸류 트랩 감지 (고부채 + 저PER는 위험)
            const debtEquity = q.debtToEquity;
            if (debtEquity != null) {
              if (debtEquity > 300)     { score -= 10; reasons.push(`부채비율 ${debtEquity.toFixed(0)}% 위험`); }
              else if (debtEquity > 200) { score -= 6; reasons.push(`부채비율 ${debtEquity.toFixed(0)}% 과다`); }
              else if (debtEquity > 150) { score -= 3; }
              else if (debtEquity < 30)  { score += 4; reasons.push("저부채 우량"); }
              else if (debtEquity < 50)  { score += 2; }
            }

            // 14) 밸류 트랩 감지 — 저PER + 적자/매출감소 = 함정
            if (per && per < 10 && margin != null && margin < 0) {
              score -= 12; reasons.push("밸류 트랩 경고 (저PER + 적자)");
            } else if (per && per < 12 && revGrowth != null && revGrowth < -0.15) {
              score -= 8; reasons.push("밸류 트랩 주의 (저PER + 매출 급감)");
            }

            // 15) FCF Yield 대용 — 이익률 + 저PER 시너지
            if (margin != null && margin > 0.15 && per != null && per > 0 && per < 15) {
              const impliedFCFYield = (margin * 100) / per;
              if (impliedFCFYield > 2) { score += 6; reasons.push(`높은 수익효율 (이익률/PER ${impliedFCFYield.toFixed(1)})`); }
              else if (impliedFCFYield > 1.2) { score += 3; }
            }

            // 16) 시가총액 크기별 안정성 보정
            if (q.marketCap) {
              if (q.marketCap >= 200e9) { score += 3; } // 초대형 안정성
              else if (q.marketCap >= 50e9) { score += 1; }
              else if (q.marketCap < 2e9) { score -= 3; reasons.push("소형주 리스크"); }
            }

            // 17) EV/EBITDA 프록시 — 기업가치 대비 수익성
            const evToEbitda = q.enterpriseToEbitda;
            if (evToEbitda != null && evToEbitda > 0) {
              if (evToEbitda < 6)       { score += 10; reasons.push(`EV/EBITDA ${evToEbitda.toFixed(1)} 초저평가`); }
              else if (evToEbitda < 10) { score += 6; reasons.push(`EV/EBITDA ${evToEbitda.toFixed(1)} 저평가`); }
              else if (evToEbitda < 15) { score += 2; }
              else if (evToEbitda > 30) { score -= 6; reasons.push(`EV/EBITDA ${evToEbitda.toFixed(1)} 고평가`); }
              else if (evToEbitda > 20) { score -= 3; }
            }

            // 18) PEG Ratio 프록시 — 성장 대비 밸류에이션
            if (per != null && per > 0 && revGrowth != null && revGrowth > 0.05) {
              const pegProxy = per / (revGrowth * 100);
              if (pegProxy < 0.8)       { score += 8; reasons.push(`PEG ${pegProxy.toFixed(1)} 초저평가`); }
              else if (pegProxy < 1.2)  { score += 5; reasons.push(`PEG ${pegProxy.toFixed(1)} 양호`); }
              else if (pegProxy > 2.5)  { score -= 5; reasons.push(`PEG ${pegProxy.toFixed(1)} 성장둔화 대비 고평가`); }
            }

            // 19) 이익 안정성 — 고마진 + 성장 시너지 (Quality Factor)
            if (margin != null && margin > 0.10 && roe != null && roe > 0.12 && revGrowth != null && revGrowth > 0) {
              score += 6; reasons.push("퀄리티 팩터 (고마진+고ROE+성장)");
            }

            // 20) 역발상 지표 — 급락 후 펀더멘탈 건전 종목
            if (q.fiftyTwoWeekHigh && q.price && q.fiftyTwoWeekHigh > 0) {
              const drawdown = (q.price - q.fiftyTwoWeekHigh) / q.fiftyTwoWeekHigh;
              if (drawdown < -0.30 && margin != null && margin > 0.05 && roe != null && roe > 0.08) {
                score += 10; reasons.push(`급락 후 건전 (낙폭 ${(drawdown * 100).toFixed(0)}% + 흑자)`);
              } else if (drawdown < -0.20 && margin != null && margin > 0.10) {
                score += 5; reasons.push(`조정 후 건전 (낙폭 ${(drawdown * 100).toFixed(0)}%)`);
              }
            }

            // 21) 현금흐름 건전성 프록시 — 저부채 + 고마진 + 고배당
            if (debtEquity != null && debtEquity < 50 && margin != null && margin > 0.15 && dy > 2) {
              score += 5; reasons.push("현금흐름 우량 (저부채+고마진+배당)");
            }

            // 22) 배당 안전성 검증 — 고배당이지만 적자/고부채면 감점 (배당 컷 위험)
            if (dy > 5 && margin != null && margin < 0) {
              score -= 8; reasons.push("배당 지속성 위험 (고배당 + 적자)");
            } else if (dy > 6 && debtEquity != null && debtEquity > 200) {
              score -= 6; reasons.push("배당 안전성 경고 (고배당 + 고부채)");
            }

            // 23) EPS 성장 가속도 — Forward PE vs Trailing PE 비율로 추정
            if (fpe != null && per != null && fpe > 0 && per > 0) {
              const earningsAccel = (per - fpe) / per; // 양수 = 이익 성장 가속
              if (earningsAccel > 0.30) { score += 7; reasons.push(`이익 가속 (Forward PE ${fpe.toFixed(1)} << Trailing ${per.toFixed(1)})`); }
              else if (earningsAccel > 0.15) { score += 4; reasons.push("이익 성장 가속"); }
              else if (earningsAccel < -0.20) { score -= 5; reasons.push("이익 감속 경고"); }
            }

            // 24) 시가총액 대비 밸류에이션 세그먼트 보정 — 대형주와 소형주의 적정 PER 차등
            if (per != null && per > 0 && q.marketCap) {
              const isLargeCap = q.marketCap >= 50e9;
              const isSmallCap = q.marketCap < 5e9;
              if (isLargeCap && per < 15 && margin != null && margin > 0.10) {
                score += 4; reasons.push("대형주 저PER 매력");
              } else if (isSmallCap && per < 8 && roe != null && roe > 0.10) {
                score += 5; reasons.push("소형 가치주 (저PER + 고ROE)");
              }
            }

            // 25) 매출 + 이익 동시 성장 — 진정한 성장 품질
            if (revGrowth != null && revGrowth > 0.10 && margin != null && margin > 0.10 &&
                fpe != null && per != null && fpe < per) {
              score += 5; reasons.push("매출+이익 동시 성장 (품질 성장)");
            }

            // 26) 그로스마진 기반 경쟁 우위 (Moat Proxy)
            const grossMargin = q.grossMargin;
            if (grossMargin != null) {
              if (grossMargin > 0.60)       { score += 6; reasons.push(`그로스마진 ${(grossMargin * 100).toFixed(0)}% 경쟁우위`); }
              else if (grossMargin > 0.40)  { score += 3; }
              else if (grossMargin < 0.20)  { score -= 4; reasons.push(`그로스마진 ${(grossMargin * 100).toFixed(0)}% 취약`); }
            }

            // 27) 매출성장 + 마진확대 동시 — 최상위 퀄리티 성장
            if (revGrowth != null && revGrowth > 0.10 && margin != null && grossMargin != null) {
              // 이전 마진 대비 현재 마진이 개선된 경우 (Forward PE 할인 = 이익 성장 = 마진 확대 프록시)
              if (fpe != null && per != null && fpe < per * 0.85 && margin > 0.10) {
                score += 5; reasons.push("마진 확대 + 매출 성장 (프리미엄 성장주)");
              }
            }

            // 28) 멀티팩터 밸류 트랩 강화 감지 — 저PER + 고부채 + 마진축소
            if (per != null && per < 10 && debtEquity != null && debtEquity > 150 &&
                fpe != null && fpe > per) {
              score -= 10; reasons.push("밸류 트랩 고위험 (저PER+고부채+이익감소)");
            }

            // 29) 배당 성장 기대 — 낮은 Payout Ratio 프록시 (저배당+고ROE+저부채)
            if (dy > 0.5 && dy < 3 && roe != null && roe > 0.15 && debtEquity != null && debtEquity < 80) {
              score += 4; reasons.push("배당 성장 잠재력 (저배당+고ROE+저부채)");
            }

            // 30) 역발상 심화 — 52주 저점 근처 + 애널리스트 업사이드 큰 종목
            if (low52 && high52 && q.price && upside != null) {
              const pos52 = (q.price - low52) / (high52 - low52);
              if (pos52 < 0.25 && upside > 30 && margin != null && margin > 0) {
                score += 7; reasons.push(`역발상 적격 (52주 하단 ${(pos52 * 100).toFixed(0)}% + 목표가 +${upside.toFixed(0)}% + 흑자)`);
              }
            }

            // 31) Altman Z-Score 프록시 — 파산 위험 조기 감지
            // Z' = 3.25 + 6.56*(WC/TA) + 3.26*(RE/TA) + 6.72*(EBIT/TA) + 1.05*(BV/TL)
            // 여기선 가용 데이터로 근사: 마진+부채비율+ROE 복합 평가
            if (margin != null && debtEquity != null && roe != null) {
              const zProxy = (margin > 0 ? 1 : 0) + (debtEquity < 200 ? 1 : 0) + (roe > 0 ? 1 : 0) +
                (margin > 0.10 ? 1 : 0) + (debtEquity < 100 ? 1 : 0);
              if (zProxy <= 1) { score -= 12; reasons.push("파산 위험 경고 (Z-Score 프록시 취약)"); }
              else if (zProxy <= 2) { score -= 6; reasons.push("재무 건전성 주의"); }
              else if (zProxy >= 5) { score += 5; reasons.push("재무 건전성 우수"); }
            }

            // 32) 주주환원율 — 자사주 매입 + 배당 복합 프록시
            if (dy > 1 && q.sharesOutstanding && q.sharesFloatShort != null) {
              // 자사주매입 기업은 유통주식 감소 → 주당가치 증가
              if (dy > 2 && margin != null && margin > 0.10 && debtEquity != null && debtEquity < 80) {
                score += 4; reasons.push("주주환원 우량 (배당+건전재무)");
              }
            }

            // 33) 기술적 모멘텀 보정 — 50일선 기울기로 단기 추세 확인
            if (q.fiftyDayAvg && q.twoHundredDayAvg) {
              const maSpread = (q.fiftyDayAvg - q.twoHundredDayAvg) / q.twoHundredDayAvg * 100;
              // 골든크로스 초기 (50일선이 200일선 살짝 상회) + 저평가 = 최적 매수 타이밍
              if (maSpread > 0 && maSpread < 5 && score >= 55) {
                score += 5; reasons.push("골든크로스 초기 + 저평가 (최적 진입)");
              }
              // 데드크로스 심화 + 건전 펀더멘털 = 역발상 기회
              if (maSpread < -10 && margin != null && margin > 0.10 && roe != null && roe > 0.10) {
                score += 4; reasons.push("기술적 약세 + 건전 펀더멘털 (역발상)");
              }
            }

            // 34) 다팩터 종합 등급 — 밸류+퀄리티+모멘텀 3축 동시 만족 보너스
            const isValue = (per != null && per < 18 && pbr != null && pbr < 2);
            const isQuality = (margin != null && margin > 0.12 && roe != null && roe > 0.12);
            const hasMomentum = (q.fiftyDayAvg && q.price > q.fiftyDayAvg);
            if (isValue && isQuality && hasMomentum) {
              score += 8; reasons.push("3팩터 프리미엄 (밸류+퀄리티+모멘텀)");
            } else if (isValue && isQuality) {
              score += 4; reasons.push("밸류+퀄리티 복합");
            }

            // 35) 이익 품질 복합 점수 (Earnings Quality Composite)
            // 높은 그로스마진 + 높은 이익률 + 이익 가속 = 최고 품질 이익
            if (grossMargin != null && margin != null && fpe != null && per != null && per > 0) {
              const earningsQuality = (grossMargin > 0.50 ? 1 : 0) + (margin > 0.15 ? 1 : 0) + (fpe < per ? 1 : 0) + (roe != null && roe > 0.15 ? 1 : 0);
              if (earningsQuality >= 4 && per < 25) {
                score += 7; reasons.push("이익 품질 최상위 (고마진+이익가속+고ROE)");
              } else if (earningsQuality >= 3 && per < 20) {
                score += 4; reasons.push("이익 품질 우수");
              }
            }

            // 36) NCAV 프록시 — 청산가치 대비 할인 (넷넷 전략)
            // PBR < 0.7 + 저부채 = 순유동자산가치 이하 근사
            if (pbr != null && pbr < 0.7 && debtEquity != null && debtEquity < 80 && margin != null && margin > 0) {
              score += 8; reasons.push(`NCAV 프록시 (PBR ${pbr.toFixed(2)} + 저부채 + 흑자) — 청산가치 할인`);
            } else if (pbr != null && pbr < 0.5 && margin != null && margin > -0.05) {
              score += 5; reasons.push(`초저PBR 심화 (${pbr.toFixed(2)}) — 자산가치 대비 극단 할인`);
            }

            // 37) 단기 가격 반전 감지 — 급락 후 반등 초기 (기술적 바닥 확인)
            if (q.fiftyDayAvg && q.twoHundredDayAvg && q.price && low52 && high52) {
              const drawdown52 = high52 > 0 ? (q.price - high52) / high52 : 0;
              const reboundFromLow = low52 > 0 ? (q.price - low52) / low52 : 0;
              // 52주 고점 대비 -25% 이상 하락했으나, 저점에서 +10% 이상 반등 중
              if (drawdown52 < -0.25 && reboundFromLow > 0.10 && q.price > q.fiftyDayAvg) {
                score += 6; reasons.push(`기술적 바닥 반등 (저점+${(reboundFromLow * 100).toFixed(0)}%, 50일선↑)`);
              }
            }

            // 38) EV/Sales 프록시 — 매출 대비 기업가치 (성장주 밸류에이션 보완)
            if (q.enterpriseToRevenue != null && q.enterpriseToRevenue > 0) {
              if (q.enterpriseToRevenue < 1.5 && margin != null && margin > 0.05) {
                score += 6; reasons.push(`EV/Sales ${q.enterpriseToRevenue.toFixed(1)} 초저평가`);
              } else if (q.enterpriseToRevenue < 3 && revGrowth != null && revGrowth > 0.10) {
                score += 3; reasons.push(`EV/Sales ${q.enterpriseToRevenue.toFixed(1)} 양호`);
              } else if (q.enterpriseToRevenue > 15 && revGrowth != null && revGrowth < 0.20) {
                score -= 5; reasons.push(`EV/Sales ${q.enterpriseToRevenue.toFixed(1)} 과다`);
              }
            }

            // 39) 밸류 트랩 최종 방어 — 다중 적신호 동시 감지 시 강력 감점
            const trapSignals = [
              per != null && per < 8 && margin != null && margin < 0,
              debtEquity != null && debtEquity > 250,
              revGrowth != null && revGrowth < -0.20,
              roe != null && roe < -0.10,
            ].filter(Boolean).length;
            if (trapSignals >= 3) {
              score -= 15; reasons.push("다중 밸류 트랩 경고 (3+ 위험 신호 동시 감지)");
            } else if (trapSignals >= 2 && per != null && per < 10) {
              score -= 8; reasons.push("밸류 트랩 복합 주의 (2+ 위험 신호)");
            }

            score = Math.max(0, Math.min(100, score));

            allResults.push({
              symbol: asset.symbol,
              name: asset.name,
              market: asset.market,
              price: q.price,
              change: q.changePct,
              score,
              per: per || null,
              fpe: fpe || null,
              pbr: pbr || null,
              divYield: dy || 0,
              upside: upside || null,
              targetMean: q.targetMean || null,
              analystCount: q.analystCount || 0,
              marketCap: q.marketCap || null,
              low52: low52 || null,
              high52: high52 || null,
              profitMargin: margin || null,
              revenueGrowth: revGrowth || null,
              roe: roe || null,
              debtToEquity: debtEquity || null,
              reasons,
            });
            done++;
          }
        } else {
          done += batch.length;
        }
      } catch {
        done += batch.length;
      }
      setValueScanProgress({ done, total: stocks.length });
    }

    // 점수순 정렬, 상위만
    allResults.sort((a, b) => b.score - a.score);
    setValueResults(allResults);
    setValueLastScan(new Date());
    setValueScanning(false);
  }, [valueScanning]);

  const filteredValue = valueResults.filter(a => {
    if (valueFilter === "all") return a.score >= 60;
    if (valueFilter === "us") return a.market === "us" && a.score >= 55;
    if (valueFilter === "kr") return a.market === "kr" && a.score >= 55;
    return true;
  }).sort((a, b) => {
    if (valueSortBy === "score") return b.score - a.score;
    if (valueSortBy === "per") return (a.per || 999) - (b.per || 999);
    if (valueSortBy === "pbr") return (a.pbr || 999) - (b.pbr || 999);
    if (valueSortBy === "div") return (b.divYield || 0) - (a.divYield || 0);
    if (valueSortBy === "upside") return (b.upside || -999) - (a.upside || -999);
    return b.score - a.score;
  });

  // ── 포트폴리오 가격 갱신 ──────────────────────────────────────
  const fetchPortfolioPrices = useCallback(async () => {
    if (!portfolio.length) return;
    setPortfolioLoading(true);
    const prices = {};
    for (const item of portfolio) {
      try {
        if (item.market === "crypto") {
          const r = await fetch(`/api/coingecko?id=${encodeURIComponent(item.cryptoId || item.symbol.toLowerCase())}&days=7&_t=${Date.now()}`);
          const j = await r.json();
          const dp = j.prices || [];
          if (dp.length) prices[item.symbol] = dp[dp.length - 1][1];
        } else {
          const r = await fetch(`/api/yahoo?symbol=${encodeURIComponent(item.symbolRaw || item.symbol)}&interval=1d&range=5d&_t=${Date.now()}`);
          const j = await r.json();
          if (j.closes?.length) prices[item.symbol] = j.closes[j.closes.length - 1];
        }
      } catch {}
    }
    setPortfolioPrices(prices);
    setPortfolioLoading(false);
  }, [portfolio]);

  useEffect(() => { if (tab === "portfolio") fetchPortfolioPrices(); }, [tab, portfolio.length]);

  // ── 뉴스 fetch ────────────────────────────────────────────────
  const fetchNews = useCallback(async () => {
    setNewsLoading(true);
    try {
      const r = await fetch(`/api/news?lang=ko&_t=${Date.now()}`);
      if (r.ok) {
        const j = await r.json();
        setNewsItems(j.news || []);
      }
    } catch {}
    setNewsLoading(false);
  }, []);

  // ★ 2026-07 정보 피벗 Phase 1: 비owner 새 홈의 '톱 뉴스 3행' 블록도 같은 데이터를
  //   재사용 — 홈 진입 시 뉴스가 비어 있으면 1회 로드.
  // ★ 2026-08-12 IA v3 (설계서 v3 4장): 뉴스 피드가 뉴스 탭 → 지표 탭 뉴스 서브탭으로
  //   이동 — 갱신 트리거도 함께 이동합니다 (서브탭 진입마다 갱신, 기존 뉴스 탭과 동일 정책).
  useEffect(() => {
    if (tab === "indicators" && indicatorsView === "news") fetchNews();
    else if (tab === "home" && newsItems.length === 0) fetchNews(); // v3: 홈 단일화로 owner 도 톱뉴스 사용
  }, [tab, indicatorsView, isOwner]); // eslint-disable-line react-hooks/exhaustive-deps

  // ══ 코인 탭 (IA v3 — 구 뉴스 슬롯, 시안 1a · 설계서 v3 2장) 데이터 배선 ══════════
  // ① 시장 컨텍스트(온도·공포탐욕·김프·펀딩) + 스테이블 — GET /api/indicators/summary.
  //    기존 지표 허브가 쓰던 동일 엔드포인트(김프·펀딩 배선 승계). 실패 시 null 유지 —
  //    컨텍스트 구역만 조용히 생략하고 시그널 리스트는 정상 동작합니다(부분 실패 원칙).
  const [coinCtx, setCoinCtx] = useState(null); // null=미적재 | indicators 배열
  const fetchCoinCtx = useCallback(async () => {
    // ★ 실패 시 빈 배열로 확정 — null 을 유지하면 스켈레톤이 영구 셔머링되어
    //   "로딩 중"이라는 거짓 상태를 보여줍니다(적대 리뷰 지적). 빈 배열이면 구역만
    //   생략되고, 5분 폴링이 성공하는 순간 자연 복구됩니다.
    try {
      const r = await fetch("/api/indicators/summary");
      if (!r.ok) { setCoinCtx((prev) => prev ?? []); return; }
      const j = await r.json();
      if (j?.ok && Array.isArray(j.indicators)) setCoinCtx(j.indicators);
      else setCoinCtx((prev) => prev ?? []);
    } catch { setCoinCtx((prev) => prev ?? []); }
  }, []);
  useEffect(() => {
    if (tab !== "news") return;
    fetchCoinCtx();
    const iv = setInterval(fetchCoinCtx, 5 * 60 * 1000);
    return () => clearInterval(iv);
  }, [tab, fetchCoinCtx]);
  // 컨텍스트 카드 탭 → 산식·해설 확장 시트 (indicators/summary 의 desc/detail 실데이터)
  const [coinCtxSheet, setCoinCtxSheet] = useState(null);
  useEffect(() => { setCoinCtxSheet(null); }, [tab]);

  // ② 코인 시그널 풀 전체 — 홈 미리보기(limit=12)와 같은 소스의 전 유니버스 조회.
  //    GET /api/real-trading/coin-scores?limit=60 (엔드포인트 상한 60 = 유동성 상위 풀 전체).
  //    파생 지표 바(OI·롱숏·24h 청산)도 이 응답의 oc 필드를 집계해 그립니다 — 추가 fetch 없음.
  const [coinTabSignals, setCoinTabSignals] = useState(() => {
    // 홈·시그널 보드와 같은 캐시 키 — 첫 페인트에서 빈 화면이 깜빡이지 않게 합니다.
    try {
      const c = JSON.parse(localStorage.getItem("zepta:coin-scores:cache") || "null");
      return Array.isArray(c?.coins) ? c.coins : [];
    } catch { return []; }
  });
  const [coinTabStatus, setCoinTabStatus] = useState("idle"); // idle | loading | ready | error
  const fetchCoinTabSignals = useCallback(async () => {
    setCoinTabStatus((prev) => (prev === "ready" ? "ready" : "loading"));
    try {
      const r = await fetch("/api/real-trading/coin-scores?limit=60");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      if (!j?.ok || !Array.isArray(j.coins)) throw new Error("bad payload");
      setCoinTabSignals(j.coins);
      setCoinTabStatus("ready");
      try { localStorage.setItem("zepta:coin-scores:cache", JSON.stringify(j)); } catch {}
    } catch {
      // 캐시가 이미 화면에 있으면 유지(ready), 아무것도 없으면 error 로 재시도 안내
      setCoinTabStatus((prev) => (prev === "ready" ? "ready" : "error"));
    }
  }, []);
  useEffect(() => {
    if (tab !== "news") return;
    fetchCoinTabSignals();
    const iv = setInterval(fetchCoinTabSignals, 5 * 60 * 1000); // 생성 주기 10분 → 5분 폴링
    return () => clearInterval(iv);
  }, [tab, fetchCoinTabSignals]);

  // ── Zepta 마켓 온도 (비owner 새 홈 ④ 시장 지표 스냅샷) ──
  // 계약: GET /api/market-temp → { ok, temp: 0~100, label, updatedAt }
  // 백엔드 병렬 구현 중 — 실패/404 시 온도 부분만 조용히 숨깁니다 (null 유지).
  const [marketTemp, setMarketTemp] = useState(null);
  useEffect(() => {
    if (tab !== "home") return; // ★ v3: 홈 단일화 — owner 도 같은 홈을 보므로 게이트 해제
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/market-temp");
        if (!r.ok) { if (!cancelled) setMarketTemp(null); return; }
        const j = await r.json();
        if (!cancelled) {
          setMarketTemp(j && j.ok && Number.isFinite(Number(j.temp)) ? j : null);
        }
      } catch {
        if (!cancelled) setMarketTemp(null);
      }
    })();
    return () => { cancelled = true; };
  }, [tab, isOwner]);

  // ── 주식 축 지표 1종 (비owner 새 홈 ④ 시장 지표 스냅샷) ──
  // ★ 2026-08-02 (대표 지시 "주식+코인 양축"): ④ 스냅샷이 코인 지표에만 쏠리지 않도록
  //   지표 허브 집계에서 market:"stock" 지표(국내증시 온도)를 하나 골라 함께 노출합니다.
  //   계약: GET /api/indicators/summary → { ok, indicators: [{ id, market, value, ... }] }
  //   실패/결측 시 null 유지 — 해당 카드만 조용히 숨깁니다 (값 조작 금지).
  const [stockIndicator, setStockIndicator] = useState(null);
  useEffect(() => {
    if (tab !== "home") return; // ★ v3: 홈 단일화 — owner 도 같은 홈을 보므로 게이트 해제
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/indicators/summary");
        if (!r.ok) { if (!cancelled) setStockIndicator(null); return; }
        const j = await r.json();
        const list = Array.isArray(j?.indicators) ? j.indicators : [];
        const pick = list.find(i => i?.market === "stock" && i.value != null) || null;
        if (!cancelled) setStockIndicator(pick);
      } catch {
        if (!cancelled) setStockIndicator(null);
      }
    })();
    return () => { cancelled = true; };
  }, [tab, isOwner]);

  // ── 오늘의 시그널 (비owner 새 홈 — 2026-08 모바일 시안 신설 블록) ──
  // 소스는 owner 홈의 HomeSignalBoard 와 동일한 멀티TF 시그널 풀입니다.
  //   GET /api/real-trading/coin-scores?limit=12
  //   → { ok, coins:[{ symbol, side:"LONG"|"SHORT", score(0~100),
  //        breakdown:{1w,1d,4h,1h:{side,score}|null}, sr:{ s:[{p}], r:[{p}], px } }] }
  // 공개 엔드포인트(엣지 60s 캐시)라 비로그인도 조회 가능합니다.
  // 실패하거나 코인이 0건이면 state 를 빈 배열로 두어 섹션 자체를 렌더하지 않습니다.
  const [homeSignals, setHomeSignals] = useState(() => {
    // HomeSignalBoard 와 같은 캐시 키 — 첫 페인트에서 빈 섹션이 깜빡이지 않게 합니다.
    try {
      const c = JSON.parse(localStorage.getItem("zepta:coin-scores:cache") || "null");
      return Array.isArray(c?.coins) ? c.coins : [];
    } catch { return []; }
  });
  useEffect(() => {
    if (tab !== "home") return; // ★ v3: 홈 단일화 — owner 도 같은 홈을 보므로 게이트 해제
    let cancelled = false;
    const load = async () => {
      try {
        const r = await fetch("/api/real-trading/coin-scores?limit=12");
        if (!r.ok) return;
        const j = await r.json();
        if (cancelled || !j?.ok || !Array.isArray(j.coins)) return;
        setHomeSignals(j.coins);
        try { localStorage.setItem("zepta:coin-scores:cache", JSON.stringify(j)); } catch {}
      } catch {}
    };
    load();
    const timer = setInterval(load, 5 * 60 * 1000); // 생성 주기 10분 → 5분 폴링
    return () => { cancelled = true; clearInterval(timer); };
  }, [tab, isOwner]);

  // ── 오늘의 시그널 · 주식 축 (2026-08 주식+온체인 확장) ──
  // 코인과 같은 패턴(5분 폴링 + localStorage 캐시)으로 주식 스코어 풀을 조회합니다.
  //   GET /api/stock-scores?limit=12
  //   → { ok, stocks:[{ symbol, market:"us"|"kr", side, score,
  //        breakdown:{1w,1d,(4h),1h}, sr:{s,r,px}, ts }] }  — coin-scores 와 동일 스키마.
  // 엔드포인트 부재(배포 전)·장애·빈 응답이면 빈 배열 유지 → 주식 세그먼트 자체가
  // 나타나지 않고 기존 코인 화면 그대로입니다(가짜 데이터 금지).
  const [homeSignalMarket, setHomeSignalMarket] = useState("crypto"); // "crypto" | "stock"
  const [homeStockSignals, setHomeStockSignals] = useState(() => {
    if (!STOCK_SIGNALS_ON) return [];
    try {
      const c = JSON.parse(localStorage.getItem("zepta:stock-scores:cache") || "null");
      return Array.isArray(c?.stocks) ? c.stocks : [];
    } catch { return []; }
  });
  useEffect(() => {
    if (!STOCK_SIGNALS_ON || tab !== "home") return;
    let cancelled = false;
    const load = async () => {
      try {
        const r = await fetch("/api/stock-scores?limit=12");
        if (!r.ok) return;
        const j = await r.json();
        if (cancelled || !j?.ok) return;
        const arr = Array.isArray(j.stocks) ? j.stocks : Array.isArray(j.items) ? j.items : null;
        if (!arr) return;
        // market 필드 정규화 — 계약상 엔트리마다 market("us"|"kr")이 실립니다.
        // 혹시 빠진 엔트리는 KRX 6자리 코드 형식 여부로만 분류합니다(형식 기반 판정).
        const rows = arr.filter(Boolean).map((s) => s.market ? s
          : { ...s, market: /^\d{6}(\.(KS|KQ))?$/i.test(String(s.symbol || "")) ? "kr" : "us" });
        setHomeStockSignals(rows);
        try { localStorage.setItem("zepta:stock-scores:cache", JSON.stringify({ ...j, stocks: rows })); } catch {}
      } catch {}
    };
    load();
    const timer = setInterval(load, 5 * 60 * 1000); // 코인과 동일한 5분 폴링
    return () => { cancelled = true; clearInterval(timer); };
  }, [tab, isOwner]);

  // ── 주식 탭 시그널 풀 (★ 2026-08-12 IA v3 시안 1b · 설계서 v3 3장) ──
  // 홈 미리보기(limit=12)와 같은 소스의 전 유니버스 조회 — GET /api/stock-scores?limit=60
  // (엔드포인트 상한 60 = 미국·한국 유니버스 51종 전체 커버). 코인 탭(fetchCoinTabSignals)과
  // 동일 패턴: 5분 폴링 + localStorage 캐시(홈 미리보기와 키 공유 — 첫 페인트 깜빡임 방지).
  const [stockTabSignals, setStockTabSignals] = useState(() => {
    if (!STOCK_SIGNALS_ON) return [];
    try {
      const c = JSON.parse(localStorage.getItem("zepta:stock-scores:cache") || "null");
      return Array.isArray(c?.stocks) ? c.stocks : [];
    } catch { return []; }
  });
  const [stockTabStatus, setStockTabStatus] = useState("idle"); // idle | loading | ready | error
  const [stockSigFilter, setStockSigFilter] = useState("all"); // all | us | kr — 시안 1b 필터 칩
  const fetchStockTabSignals = useCallback(async () => {
    setStockTabStatus((prev) => (prev === "ready" ? "ready" : "loading"));
    try {
      const r = await fetch("/api/stock-scores?limit=60");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      const arr = Array.isArray(j?.stocks) ? j.stocks : Array.isArray(j?.items) ? j.items : null;
      if (!j?.ok || !arr) throw new Error("bad payload");
      // market 필드 정규화 — 홈 폴링과 같은 규칙(누락 엔트리는 KRX 6자리 코드 형식으로만 판정).
      const rows = arr.filter(Boolean).map((s) => s.market ? s
        : { ...s, market: /^\d{6}(\.(KS|KQ))?$/i.test(String(s.symbol || "")) ? "kr" : "us" });
      setStockTabSignals(rows);
      setStockTabStatus("ready");
      try { localStorage.setItem("zepta:stock-scores:cache", JSON.stringify({ ...j, stocks: rows })); } catch {}
    } catch {
      // 캐시가 이미 화면에 있으면 유지(ready), 아무것도 없으면 error 로 재시도 안내
      setStockTabStatus((prev) => (prev === "ready" ? "ready" : "error"));
    }
  }, []);
  useEffect(() => {
    if (!STOCK_SIGNALS_ON || tab !== "screener") return;
    fetchStockTabSignals();
    const iv = setInterval(fetchStockTabSignals, 5 * 60 * 1000); // 크론 주기(30~60분)보다 촘촘한 폴링
    return () => clearInterval(iv);
  }, [tab, fetchStockTabSignals]);

  // ── 종목 상세 시트 (2026-08 모바일 시안) ──
  // 홈 "오늘의 시그널" 카드를 누르면 그 종목 하나를 끝까지 읽는 화면을 띄웁니다.
  // 값은 이미 받아둔 coin-scores 엔트리에서 전부 파생 — 추가 fetch 가 없습니다.
  const [detailSignal, setDetailSignal] = useState(null);
  // 시트 오버레이 컨테이너 ref — 열릴 때 포커스를 옮기고 Tab 순환의 기준점이 됩니다.
  const sheetRef = useRef(null);
  // 탭이 바뀌면(검색 이동 등) 시트를 닫아 이전 화면의 잔상이 남지 않게 합니다.
  useEffect(() => { setDetailSignal(null); }, [tab]);
  useEffect(() => {
    if (!detailSignal) return;
    // aria-modal 다이얼로그 접근성: 열릴 때 포커스를 시트 안으로 옮기고(스크린리더가
    // aria-label 을 읽음), Tab 이 시트 뒤 배경 요소로 새지 않게 순환시키고, 닫힐 때 복원합니다.
    const prevFocus = document.activeElement;
    // 시트 본문은 lazy(Suspense)라 첫 오픈 시 아직 없습니다 —
    // 컨테이너(tabIndex=-1)에 포커스를 주면 aria-label 이 읽히고 Tab 기준점이 생깁니다.
    sheetRef.current?.focus();

    const onKey = (e) => {
      if (e.key === "Escape") { setDetailSignal(null); return; }
      if (e.key !== "Tab") return;
      const root = sheetRef.current;
      if (!root) return;
      const f = Array.from(root.querySelectorAll(
        'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
      )).filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (!f.length) { e.preventDefault(); root.focus(); return; }
      const first = f[0], last = f[f.length - 1];
      const cur = document.activeElement;
      if (e.shiftKey && (cur === first || cur === root)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (cur === last || cur === root)) { e.preventDefault(); first.focus(); }
      // 배경에 포커스가 남아 있으면 시트 안 첫 요소로 끌어옵니다 (배경 tab order 유출 방지)
      else if (!root.contains(cur)) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKey);
    // 시트가 전체 화면을 덮는 동안 뒤 페이지가 같이 스크롤되지 않게 잠급니다.
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      // 탭 전환으로 시트가 닫히면 원래 카드가 이미 언마운트돼 있을 수 있어 문서 잔존 시에만 복원합니다.
      if (prevFocus && document.contains(prevFocus)) prevFocus.focus?.();
    };
  }, [detailSignal]);

  // ── 상세 시트 추이 차트 (2026-08 배선) ─────────────────────────────
  // 자산 마스터(CRYPTO_ASSETS)에 coingecko id 가 있는 코인만 /api/coingecko OHLC 로
  // 실데이터를 불러옵니다. id 매핑이 없는 코인은 spark 를 넘기지 않아 차트 섹션이
  // 기존처럼 통째로 숨겨집니다(가짜 차트 금지). 기간 탭은 탭마다 days 를 바꿔
  // 실제 다른 데이터를 다시 불러옵니다 — 표시만 되는 죽은 탭이 아닙니다.
  const [detailRange, setDetailRange] = useState("1M");
  const [detailSpark, setDetailSpark] = useState(null); // { symbol, range, points }
  useEffect(() => {
    if (!detailSignal) { setDetailSpark(null); return; }

    // ── 주식 분기 (2026-08 주식 확장): /api/yahoo-batch 로 실데이터 차트 ──
    // 기간 탭 → interval/range 는 DETAIL_STOCK_RANGE(라이브 curl 검증 조합)만 씁니다.
    if (detailSignal.market === "us" || detailSignal.market === "kr") {
      const raw = String(detailSignal.symbol || "");
      const dispTicker = raw.replace(/\.(KS|KQ)$/i, "").toUpperCase();
      // 야후 심볼: 응답이 이미 야후 형식(005930.KS)이면 그대로, 아니면 자산 마스터의
      // symbolRaw 로 보정합니다. 둘 다 없으면 코드 그대로 시도(미국 주식은 코드=야후 심볼).
      const master = ALL_ASSETS.find((a) => a.market === detailSignal.market
        && (a.symbol === dispTicker || a.symbolRaw === raw));
      const yahooSym = /\.(KS|KQ)$/i.test(raw) ? raw : (master?.symbolRaw || raw);
      if (!yahooSym) { setDetailSpark(null); return; }
      if (detailSpark && detailSpark.symbol !== dispTicker) { setDetailSpark(null); return; }
      if (detailSpark && detailSpark.symbol === dispTicker && detailSpark.range === detailRange) return;
      const [iv, rg] = DETAIL_STOCK_RANGE[detailRange] || DETAIL_STOCK_RANGE["1M"];
      let cancelled = false;
      (async () => {
        try {
          const r = await fetch(`/api/yahoo-batch?symbols=${encodeURIComponent(yahooSym)}&interval=${iv}&range=${rg}`);
          if (r.ok) {
            const j = await r.json();
            if (cancelled) return;
            // 응답 계약(2026-08-11 라이브 확인): { results: { [symbol]: { closes:[...] } } }
            const entry = j?.results?.[yahooSym]
              || (j?.results && Object.keys(j.results).length === 1 ? Object.values(j.results)[0] : null);
            const pts = Array.isArray(entry?.closes)
              ? entry.closes.map(Number).filter(Number.isFinite)
              : [];
            if (pts.length >= 2) { setDetailSpark({ symbol: dispTicker, range: detailRange, points: pts }); return; }
          }
        } catch {}
        // 실패 시: 코인 경로와 동일하게, 이미 그려 둔 기간이 있으면 탭 선택을 되돌립니다.
        if (!cancelled) {
          setDetailRange((cur) => (detailSpark && detailSpark.symbol === dispTicker ? detailSpark.range : cur));
        }
      })();
      return () => { cancelled = true; };
    }

    const ticker = String(detailSignal.asset || detailSignal.symbol || "").replace(/USDT$/i, "").toUpperCase();
    const knownAsset = CRYPTO_ASSETS.find((a) => a.symbol === ticker);
    if (!knownAsset) { setDetailSpark(null); return; }
    // 종목이 바뀌면 이전 종목 차트를 즉시 비우고 재실행에 맡깁니다
    // (다른 자산의 차트가 잠깐 보이는 것 방지 + fetch 중복 방지).
    if (detailSpark && detailSpark.symbol !== ticker) { setDetailSpark(null); return; }
    if (detailSpark && detailSpark.symbol === ticker && detailSpark.range === detailRange) return;
    const days = DETAIL_RANGE_DAYS[detailRange] || "30";
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/coingecko?id=${encodeURIComponent(knownAsset.id)}&days=${days}&type=ohlc`);
        if (r.ok) {
          const j = await r.json();
          if (cancelled) return;
          const pts = Array.isArray(j?.candles)
            ? j.candles.map((c) => Number(c?.close)).filter(Number.isFinite)
            : [];
          if (pts.length >= 2) { setDetailSpark({ symbol: ticker, range: detailRange, points: pts }); return; }
        }
      } catch {}
      // 실패 시: 이미 그려 둔 기간이 있으면 탭 선택을 그 기간으로 되돌려
      // "탭은 1년인데 차트는 1개월" 같은 어긋난 표시가 남지 않게 합니다.
      if (!cancelled) {
        setDetailRange((cur) => (detailSpark && detailSpark.symbol === ticker ? detailSpark.range : cur));
      }
    })();
    return () => { cancelled = true; };
  }, [detailSignal, detailRange, detailSpark]);

  // ── MY 화면 스탯: 저장한 조건 수 (2026-08 모바일 시안 — 프로필 상단 3열) ──
  // 저장한 스크리너는 App state 가 아니라 KV 에 있습니다(GET /api/screeners/list?uid=).
  // 조회 실패·미로그인 시 null 을 유지해 해당 칸을 통째로 숨깁니다(0 을 지어내지 않습니다).
  const [savedScreenerCount, setSavedScreenerCount] = useState(null);
  useEffect(() => {
    if (tab !== "profile" || !user?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/screeners/list?uid=${encodeURIComponent(user.id)}`);
        if (!r.ok) return;
        const j = await r.json();
        if (!cancelled && j?.ok && Array.isArray(j.screeners)) setSavedScreenerCount(j.screeners.length);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [tab, user?.id]);

  // ── 스크리너 시장 필터 딥링크 (GNB '주식 분석' 진입 버튼) ──
  // ★ 2026-08-02: Header 가 zepta:screener-market 이벤트로 필터를 전달합니다.
  //   (구 지표 허브의 동일 이벤트 발신처는 IA v3 에서 페이지 폐지로 제거 — 수신부는 유지)
  useEffect(() => {
    const onScreenerMarket = (e) => {
      const m = e?.detail;
      if (MARKET_FILTERS.includes(m)) setFilterMarket(m);
    };
    window.addEventListener("zepta:screener-market", onScreenerMarket);
    return () => window.removeEventListener("zepta:screener-market", onScreenerMarket);
  }, []);

  // ★ IA v3: 주식 탭은 주식 전용 화면이므로 진입 시 코인/전체 필터를 주식으로 정정합니다.
  //   (코인 조건 검색은 코인 탭 진입점이 crypto 를 시드해 같은 스크리너를 엽니다)
  useEffect(() => {
    if (tab !== "screener") return;
    setFilterMarket((prev) => (prev === "crypto" || prev === "all" ? "stock" : prev));
  }, [tab]);

  // ── 소셜 센티먼트 ──
  const fetchSentiment = useCallback(async (sym) => {
    setSentimentLoading(true);
    try {
      const r = await fetch(`/api/social-sentiment?symbol=${sym || sentimentSymbol}&_t=${Date.now()}`);
      if (r.ok) setSentimentData(await r.json());
    } catch {}
    setSentimentLoading(false);
  }, [sentimentSymbol]);

  useEffect(() => { if (tab === "sentiment") fetchSentiment(); }, [tab]);

  // ── 환율 가져오기 ──────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/yahoo-ohlc?symbol=USDKRW=X&interval=1d&range=5d&_t=" + Date.now());
        if (r.ok) {
          const j = await r.json();
          const candles = j.candles || [];
          if (candles.length) setKrwRate(candles[candles.length - 1].close);
        }
      } catch {}
    })();
  }, []);

  // ── 글로벌 검색 단축키 (/ 키) + 탭 단축키 (1-5) ──
  useEffect(() => {
    const handleKeyDown = (e) => {
      // 종목 상세 시트(z 10001)가 열려 있으면 전역 단축키를 중단합니다 —
      // 검색 오버레이(z 9999)가 시트 뒤에 보이지 않게 뜨는 문제 방지. 시트 전용 키는 별도 이펙트가 처리합니다.
      if (detailSignal) return;
      const isInputFocused = ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName);

      // 글로벌 검색 (/)
      if (e.key === "/" && !e.ctrlKey && !e.metaKey && !isInputFocused) {
        e.preventDefault();
        setGlobalSearchOpen(true);
      }
      // Escape: 검색 창 닫기
      if (e.key === "Escape") {
        setGlobalSearchOpen(false);
      }
      // 탭 단축키 (1-5) — 입력창 포커스 시 제외
      // ★ 2026-08-12 IA v3: 하단 탭 [홈·코인·주식·지표·MY] 순서를 그대로 미러링.
      //   owner 의 '3' → 자동매매 콘솔 특례는 유지 (대표 주 사용 흐름).
      if (!isInputFocused) {
        if (e.key === "1") setTab("home");
        else if (e.key === "2") setTab("news"); // 코인 탭 (내부 id 유지)
        else if (e.key === "3") setTab(isOwner ? "auto-trading" : "screener"); // 주식 탭
        else if (e.key === "4") setTab("indicators");
        else if (e.key === "5") setTab("profile");
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOwner, detailSignal]);

  // ── 스크롤 감지 (맨 위로 버튼) ──
  useEffect(() => {
    const handler = () => setShowScrollTop(window.scrollY > 300);
    window.addEventListener("scroll", handler, { passive: true });
    return () => window.removeEventListener("scroll", handler);
  }, []);


  // ── 포트폴리오 동기화 ─────────────────────────────────────────
  const syncUpload = useCallback(async () => {
    if (!syncPin || syncPin.length < 4) { setSyncStatus(`❌ ${t("diag.sync.pinRequired")}`); return; }
    setSyncStatus(`⏳ ${t("diag.sync.uploading")}`);
    try {
      const r = await fetch(`/api/sync?pin=${encodeURIComponent(syncPin)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ portfolio, settings: { ...settings, syncPin } }),
      });
      if (r.ok) setSyncStatus(`✅ ${t("diag.sync.done")}`);
      else setSyncStatus(`❌ ${t("diag.sync.uploadFailed")}`);
    } catch (e) { setSyncStatus(`❌ ${e.message}`); }
  }, [syncPin, portfolio, settings, t]);

  const syncDownload = useCallback(async () => {
    if (!syncPin || syncPin.length < 4) { setSyncStatus(`❌ ${t("diag.sync.pinRequired")}`); return; }
    setSyncStatus(`⏳ ${t("diag.sync.downloading")}`);
    try {
      const r = await fetch(`/api/sync?pin=${encodeURIComponent(syncPin)}`);
      if (r.ok) {
        const data = await r.json();
        if (data.portfolio?.length) { setPortfolio(data.portfolio); savePortfolio(data.portfolio); }
        if (data.settings) { setSettings(p => ({ ...p, ...data.settings })); saveSettings({ ...settings, ...data.settings }); }
        setSyncStatus(`✅ ${t("diag.sync.done")} (${data.updatedAt ? new Date(data.updatedAt).toLocaleString(lang === "en" ? "en-US" : "ko-KR") : ""})`);
      } else setSyncStatus(`❌ ${t("diag.sync.noData")}`);
    } catch (e) { setSyncStatus(`❌ ${e.message}`); }
  }, [syncPin, settings, t, lang]);

  // ── 통화 변환 헬퍼 ──────────────────────────────────────────────
  const toDisplay = (val, market) => {
    if (val == null) return "—";
    if (currency === "KRW") {
      const krw = market === "kr" ? val : val * krwRate;
      return `₩${Math.round(krw).toLocaleString()}`;
    }
    if (market === "kr") return `₩${Math.round(val).toLocaleString()}`;
    if (val < 0.01) return `$${val.toFixed(6)}`;
    if (val < 1) return `$${val.toFixed(4)}`;
    return `$${val.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  };

  // ★ 2026-06-12 (전수 감사): 정렬 버튼이 한 번도 동작한 적 없던 버그 — sortedResults 가
  //   계산만 되고 raw results 를 렌더하고 있었음 → 정렬 결과 기반으로 필터.
  const filtered = sortedResults.filter(a => matchMarketFilter(a, filterMarket));

  // ★ 2026-06-12 (전수 감사 — 치명 버그): KR 종목(₩ 단위)과 US/크립토($ 단위)를 환산 없이
  //   합산해 혼합 보유 시 총액이 수백 배 틀리던 문제 → KR 은 USD 로 정규화 후 합산.
  //   (표시부 PortfolioTab 은 pStats 를 USD 로 가정하고 KRW 표시 시 ×krwRate — 기존 그대로)
  const pStats = portfolio.reduce((acc, item) => {
    const cur = portfolioPrices[item.symbol];
    const fx = item.market === "kr" && krwRate > 0 ? 1 / krwRate : 1;
    const invested = item.qty * item.avgPrice * fx;
    return {
      invested: acc.invested + invested,
      current:  acc.current + (cur ? item.qty * cur * fx : 0),
      pnl:      acc.pnl    + (cur ? item.qty * cur * fx - invested : 0),
      hasPrices: acc.hasPrices || !!cur,
    };
  }, { invested: 0, current: 0, pnl: 0, hasPrices: false });

  // 뉴스 카테고리 필터 + 정렬
  // ★ 감사 배치3 (오분류 수정): 종전 부분일치 정규식은 'sk' 가 SanDi**sk**·Ri**sk** 에
  //   매칭돼 영어 기사를 '한국' 탭에 넣었고, us 탭은 "제외 or 포함" 구조라 전체의 88%
  //   를 그대로 통과시켰습니다. → ① 수집기(api/_shared/news-sources.js NEWS_CATEGORIES)
  //   가 붙여 준 category/categories 필드를 최우선으로 신뢰하고, ② 미분류 기사(RSS
  //   폴백 경로는 category 가 빈 값)만 단어 경계(\b) 키워드로 보수적으로 판정합니다.
  //   어느 축에도 해당하지 않는 기사는 오분류 대신 '전체' 탭에만 노출합니다.
  //   (macro 카테고리는 국가 축이 아니라서 us/kr 어느 탭에도 강제 배정하지 않습니다)
  const filteredNews = useMemo(() => {
    if (newsCat === "all") return newsItems;
    const wanted = { kr: "kr-stock", us: "us-stock", crypto: "crypto" }[newsCat];
    return newsItems.filter(n => {
      // ① 수집기 분류가 있으면 그대로 사용 (네이버 풀 경로 — 키워드 추정 불필요)
      const cats = [n.category, ...(Array.isArray(n.categories) ? n.categories : [])].filter(Boolean);
      if (cats.length) return cats.includes(wanted);
      // ② 미분류(RSS 폴백) — 제목·태그·매체명에서 단어 경계 키워드로 판정
      const title = (n.title || "").toLowerCase();
      const tags = (n.tags || []).map(t => t.toLowerCase()).join(" ");
      const src = (n.source || "").toLowerCase();
      const txt = title + " " + tags + " " + src;
      // \b 는 ASCII 기준이라 "sk하이닉스"의 sk 는 잡고 "sandisk/risk" 는 거릅니다.
      // eth/sol 도 종전에는 method/solution 등에 부분일치하던 것을 경계로 고정합니다.
      if (newsCat === "crypto") return /crypto|bitcoin|\bbtc\b|ethereum|\beth\b|solana|\bsol\b|코인|가상화폐|가상자산|비트코인|이더리움|크립토/.test(txt);
      if (newsCat === "kr") return /코스피|코스닥|한국|삼성|현대|\bsk\b|\blg\b|카카오|네이버|한화|포스코|하이닉스|🇰🇷/.test(txt);
      if (newsCat === "us") return /s&p|nasdaq|nyse|\bdow\b|wall street|미국|뉴욕증시|나스닥|다우|월가|엔비디아|테슬라|애플|nvidia|tesla|\bapple\b|microsoft|amazon|broadcom|alphabet|🇺🇸/.test(txt);
      return true;
    });
  }, [newsItems, newsCat]);

  const sortedNews = [...filteredNews].sort((a, b) => {
    if (newsSort === "time") {
      return new Date(b.date || b.publishedAt || b.pubDate || 0) - new Date(a.date || a.publishedAt || a.pubDate || 0);
    } else if (newsSort === "positive") {
      const sentA = analyzeSentiment(a.title);
      const sentB = analyzeSentiment(b.title);
      const scoreA = sentA === "positive" ? 3 : sentA === "neutral" ? 2 : 1;
      const scoreB = sentB === "positive" ? 3 : sentB === "neutral" ? 2 : 1;
      return scoreB - scoreA;
    } else if (newsSort === "negative") {
      const sentA = analyzeSentiment(a.title);
      const sentB = analyzeSentiment(b.title);
      const scoreA = sentA === "negative" ? 3 : sentA === "neutral" ? 2 : 1;
      const scoreB = sentB === "negative" ? 3 : sentB === "neutral" ? 2 : 1;
      return scoreB - scoreA;
    }
    return 0;
  });

  // ────────────────────────────────────────────────────────────────

  // ── 리텐션 콘텐츠 카드 렌더러 (★ 2026-07 정보 피벗 Phase 1) ──
  // 새 홈(비owner 6블록 상한)에서 빠진 '오늘의 마켓 예측·퀴즈'를 기능 삭제 없이
  // 마이페이지(내 정보)로 이관하기 위해 홈 인라인 IIFE 를 공용 렌더러로 추출했습니다.
  // owner 홈과 mypage 두 곳에서 동일하게 호출합니다 (로직 변경 없음).
  const renderMarketPredictionCard = () => {
    const todayKey = new Date().toISOString().slice(0, 10);
    const predKey = `zepta:pred:${todayKey}`;
    const pred = predictionState;
    // 어제 예측 결과
    const yesterdayKey = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    let yesterdayPred = null;
    try { yesterdayPred = JSON.parse(localStorage.getItem(`zepta:pred:${yesterdayKey}`)); } catch {}
    const sp = marketIndices.find(i => i.symbol === "^GSPC");
    const spChange = sp?.change || 0;
    // 어제 예측이 있고 오늘 결과가 나왔으면 판정
    let yesterdayResult = null;
    if (yesterdayPred && sp) {
      const correct = (yesterdayPred.dir === "up" && spChange >= 0) || (yesterdayPred.dir === "down" && spChange < 0);
      yesterdayResult = correct;
    }
    // 적중률 계산
    let totalPreds = 0, correctPreds = 0;
    try {
      const stats = JSON.parse(localStorage.getItem("zepta:pred:stats") || '{"total":0,"correct":0}');
      totalPreds = stats.total; correctPreds = stats.correct;
    } catch {}
    const accuracy = totalPreds > 0 ? Math.round((correctPreds / totalPreds) * 100) : 0;

    const handlePredict = (dir) => {
      const data = { dir, timestamp: Date.now() };
      localStorage.setItem(predKey, JSON.stringify(data));
      setPredictionState(data);
      // 어제 결과 업데이트
      if (yesterdayPred && yesterdayResult !== null && !yesterdayPred.scored) {
        try {
          const stats = JSON.parse(localStorage.getItem("zepta:pred:stats") || '{"total":0,"correct":0}');
          stats.total += 1;
          if (yesterdayResult) stats.correct += 1;
          localStorage.setItem("zepta:pred:stats", JSON.stringify(stats));
          yesterdayPred.scored = true;
          localStorage.setItem(`zepta:pred:${yesterdayKey}`, JSON.stringify(yesterdayPred));
        } catch {}
      }
      syncUserDataToSupabase();
    };

    return (
      <div style={{
        background: `linear-gradient(135deg, ${C.card} 0%, ${C.purple}08 100%)`,
        borderRadius: "16px", padding: "18px", border: `1px solid ${C.purple}15`,
        position: "relative", overflow: "hidden", flexShrink: 0,
      }}>
        <div style={{ position: "absolute", top: "-30px", right: "-20px", width: "100px", height: "100px",
          borderRadius: "50%", background: `${C.purple}06`, filter: "blur(30px)", pointerEvents: "none" }} />
        <div style={{ position: "relative" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ fontSize: "16px" }}>🎯</span>
              <span style={{ fontWeight: 700, fontSize: "16px", color: C.text1 }}>{t("tabs.home.marketPrediction") || "오늘의 예측"}</span>
            </div>
            {totalPreds > 0 && (
              <span style={{ fontSize: "12px", color: C.text3, fontWeight: 500 }}>
                {t("tabs.home.accuracy") || "적중률"} <span style={{ color: accuracy >= 60 ? C.green : accuracy >= 40 ? C.yellow : C.red, fontWeight: 700 }}>{accuracy}%</span>
                <span style={{ color: C.text3 }}> ({correctPreds}/{totalPreds})</span>
              </span>
            )}
          </div>

          {/* 어제 결과 */}
          {yesterdayResult !== null && (
            <div style={{
              padding: "8px 12px", borderRadius: "10px", marginBottom: "10px",
              background: yesterdayResult ? `${C.green}10` : `${C.red}10`,
              border: `1px solid ${yesterdayResult ? C.green : C.red}20`,
              display: "flex", alignItems: "center", gap: "6px",
              fontSize: "14px", color: yesterdayResult ? C.green : C.red, fontWeight: 600,
            }}>
              {yesterdayResult ? "✅" : "❌"} {t("tabs.home.yesterdayPrediction") || "어제 예측"}: {yesterdayResult ? (t("tabs.home.correct") || "적중!") : (t("tabs.home.wrong") || "빗나감")}
              <span style={{ color: C.text3, fontWeight: 400 }}>
                (S&P {spChange >= 0 ? "+" : ""}{spChange}%)
              </span>
            </div>
          )}

          <div style={{ fontSize: "16px", color: C.text3, marginBottom: "10px", fontWeight: 500 }}>
            {t("tabs.home.tomorrowSP") || "내일 S&P 500은?"}
          </div>

          {pred ? (
            <div style={{
              padding: "12px", borderRadius: "12px", textAlign: "center",
              background: pred.dir === "up" ? `${C.green}10` : `${C.red}10`,
              border: `1px solid ${pred.dir === "up" ? C.green : C.red}25`,
            }}>
              <span style={{ fontSize: "20px" }}>{pred.dir === "up" ? "📈" : "📉"}</span>
              <div style={{ fontSize: "15px", fontWeight: 700, color: pred.dir === "up" ? C.green : C.red, marginTop: "4px" }}>
                {pred.dir === "up" ? (t("tabs.home.predictedUp") || "상승 예측 완료!") : (t("tabs.home.predictedDown") || "하락 예측 완료!")}
              </div>
              <div style={{ fontSize: "12px", color: C.text3, marginTop: "2px" }}>{t("tabs.home.checkTomorrow") || "내일 결과를 확인하세요"}</div>
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
              <button onClick={() => handlePredict("up")} style={{
                padding: "18px", borderRadius: "12px", cursor: "pointer", transition: "all .15s",
                background: `linear-gradient(135deg, ${C.green}12, ${C.green}04)`, border: `1px solid ${C.green}20`,
                display: "flex", flexDirection: "column", alignItems: "center", gap: "4px", boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
              }}
              onMouseEnter={e => { e.currentTarget.style.boxShadow = `0 4px 20px ${C.green}20`; e.currentTarget.style.transform = "scale(1.02)"; }}
              onMouseLeave={e => { e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.1)"; e.currentTarget.style.transform = "none"; }}>
                <span style={{ fontSize: "32px" }}>📈</span>
                <span style={{ fontSize: "15px", fontWeight: 700, color: C.green }}>{t("tabs.home.bullish") || "상승"}</span>
              </button>
              <button onClick={() => handlePredict("down")} style={{
                padding: "18px", borderRadius: "12px", cursor: "pointer", transition: "all .15s",
                background: `linear-gradient(135deg, ${C.red}12, ${C.red}04)`, border: `1px solid ${C.red}20`,
                display: "flex", flexDirection: "column", alignItems: "center", gap: "4px", boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
              }}
              onMouseEnter={e => { e.currentTarget.style.boxShadow = `0 4px 20px ${C.red}20`; e.currentTarget.style.transform = "scale(1.02)"; }}
              onMouseLeave={e => { e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.1)"; e.currentTarget.style.transform = "none"; }}>
                <span style={{ fontSize: "32px" }}>📉</span>
                <span style={{ fontSize: "15px", fontWeight: 700, color: C.red }}>{t("tabs.home.bearishPred") || "하락"}</span>
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderMarketQuizCard = () => {
    const todayKey = new Date().toISOString().slice(0, 10);
    const quizKey = `zepta:quiz:${todayKey}`;

    // ★ i18n: 퀴즈 문항·보기를 로케일 사전으로 이관 — t() 는 배열/객체 값을 그대로 반환합니다.
    //   answer 인덱스는 ko/en 사전 양쪽에 동일하게 유지해야 합니다 (패리티 검사 대상).
    const quizPool = t("diag.quizPool");

    const dayOfYear = Math.floor((new Date() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
    const todayQuiz = quizPool[dayOfYear % quizPool.length];

    let quizStats = { total: 0, correct: 0 };
    try { quizStats = JSON.parse(localStorage.getItem("zepta:quiz:stats") || '{"total":0,"correct":0}'); } catch {}

    const handleQuizAnswer = (idx) => {
      const isCorrect = idx === todayQuiz.answer;
      const result = { answered: idx, correct: isCorrect, timestamp: Date.now() };
      localStorage.setItem(quizKey, JSON.stringify(result));
      try {
        const stats = JSON.parse(localStorage.getItem("zepta:quiz:stats") || '{"total":0,"correct":0}');
        stats.total += 1;
        if (isCorrect) stats.correct += 1;
        localStorage.setItem("zepta:quiz:stats", JSON.stringify(stats));
      } catch {}
      setQuizAnswered(result);
      syncUserDataToSupabase();
    };

    return (
      <div style={{
        background: `linear-gradient(135deg, ${C.card} 0%, ${C.blue}08 100%)`,
        borderRadius: "16px", padding: "18px", border: `1px solid ${C.blue}15`,
        position: "relative", overflow: "hidden", flexShrink: 0,
      }}>
        <div style={{ position: "absolute", top: "-20px", left: "-15px", width: "80px", height: "80px",
          borderRadius: "50%", background: `${C.blue}06`, filter: "blur(25px)", pointerEvents: "none" }} />
        <div style={{ position: "relative" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "14px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ fontSize: "16px" }}>🧠</span>
              <span style={{ fontWeight: 700, fontSize: "16px", color: C.text1 }}>{t("tabs.home.dailyQuiz") || "오늘의 퀴즈"}</span>
            </div>
            {quizStats.total > 0 && (
              <span style={{ fontSize: "12px", color: C.text3, fontWeight: 500 }}>
                {Math.round((quizStats.correct / quizStats.total) * 100)}% ({quizStats.correct}/{quizStats.total})
              </span>
            )}
          </div>

          <div style={{ fontSize: "15px", fontWeight: 600, color: C.text1, marginBottom: "12px", lineHeight: 1.4 }}>
            {todayQuiz.q}
          </div>

          {quizAnswered ? (
            <div style={{
              padding: "14px", borderRadius: "12px", textAlign: "center",
              background: quizAnswered.correct ? `${C.green}10` : `${C.red}10`,
              border: `1px solid ${quizAnswered.correct ? C.green : C.red}25`,
            }}>
              <span style={{ fontSize: "20px" }}>{quizAnswered.correct ? "🎉" : "📚"}</span>
              <div style={{ fontSize: "15px", fontWeight: 700, color: quizAnswered.correct ? C.green : C.red, marginTop: "4px" }}>
                {quizAnswered.correct ? (t("tabs.home.quizCorrect") || "정답입니다!") : (t("tabs.home.quizWrong") || "아쉽네요!")}
              </div>
              <div style={{ fontSize: "14px", color: C.text3, marginTop: "4px" }}>
                {t("tabs.home.correctAnswer") || "정답"}: {todayQuiz.options[todayQuiz.answer]}
              </div>
              <div style={{ fontSize: "12px", color: C.text3, marginTop: "6px" }}>
                {t("tabs.home.quizTomorrow") || "내일 새로운 퀴즈가 준비됩니다"}
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {todayQuiz.options.map((opt, idx) => (
                <button key={idx} onClick={() => handleQuizAnswer(idx)} style={{
                  padding: "14px 16px", borderRadius: "10px", cursor: "pointer",
                  background: `${C.card2}40`, border: `1px solid ${C.border}20`,
                  textAlign: "left", fontSize: "15px", fontWeight: 600, color: C.text2,
                  transition: "all .15s", display: "flex", alignItems: "center", gap: "10px",
                }}
                onMouseEnter={e => { e.currentTarget.style.background = `${C.blue}12`; e.currentTarget.style.borderColor = `${C.blue}30`; e.currentTarget.style.color = C.text1; e.currentTarget.style.borderLeft = `3px solid ${C.blue}`; }}
                onMouseLeave={e => { e.currentTarget.style.background = `${C.card2}40`; e.currentTarget.style.borderColor = `${C.border}20`; e.currentTarget.style.color = C.text2; e.currentTarget.style.borderLeft = "none"; }}>
                  <span style={{ width: "28px", height: "28px", borderRadius: "50%", background: `${C.blue}15`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "14px", fontWeight: 700, color: C.blue, flexShrink: 0 }}>
                    {String.fromCharCode(65 + idx)}
                  </span>
                  {opt}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  };

  // ★ 2026-08-11: index.html 의 부트 스플래시 제거 — React 가 첫 페인트를 그리는 순간
  //   (인증 스플래시든 본화면이든) 인계가 끝났으므로 오버레이를 걷습니다.
  //   부트 스플래시와 인증 스플래시가 같은 모양이라 전환이 이어져 보입니다.
  useEffect(() => {
    document.getElementById("boot-splash")?.remove();
    // 부트 워치독 재시도 플래그 초기화 — 정상 마운트했으므로 다음 부트는 깨끗한 상태에서 시작
    try { sessionStorage.removeItem("zepta:boot-retry"); } catch {}
  }, []);

  // ── 인증 로딩 중이면 스플래시 (hooks 뒤에 배치해야 hook 수 일관) ──
  if (authLoading) {
    // ★ 2026-08-12: index.html 부트 스플래시(v2 시그널 바)와 동일한 모양 —
    //   부트 → 인증 스플래시 전환이 눈에 보이지 않게(유저 플로우 연속성, 대표 지시).
    //   인증은 로컬 세션 복원만 기다리므로 보통 수백 ms 안에 지나갑니다.
    return (
      <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "18px", background: C.bg }}>
        <style>{`@keyframes bsBar { 0%,100%{transform:scaleY(.3)} 50%{transform:scaleY(1)} }`}</style>
        <div style={{ display: "flex", gap: "7px", alignItems: "flex-end", height: "44px" }}>
          {[["20px", C.blue, "0s"], ["32px", C.isDark ? "#8F80FF" : "#7565F0", ".15s"], ["44px", C.blueL, ".3s"]].map(([h, bg, d], i) => (
            <div key={i} style={{ width: "10px", height: h, borderRadius: "5px", background: bg, transformOrigin: "bottom", animation: `bsBar 1.1s ease-in-out ${d} infinite` }} />
          ))}
        </div>
        <div style={{ color: C.text1, fontSize: "22px", fontWeight: 800, letterSpacing: "-0.03em" }}>Zepta</div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text1, fontFamily: "'Pretendard', 'Apple SD Gothic Neo', system-ui, sans-serif" }}>
      <style>{`
        @keyframes shimmer { 0%{background-position:-200% 0} 100%{background-position:200% 0} }
        @keyframes livePulse { 0%,100%{opacity:1} 50%{opacity:.4} }
        @keyframes float { 0%,100%{transform:translateY(0px)} 50%{transform:translateY(-8px)} }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }
        @keyframes fadeIn { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
        @keyframes streakPulse { 0%,100%{box-shadow:0 0 12px rgba(255,107,53,0.3)} 50%{box-shadow:0 0 24px rgba(255,107,53,0.6)} }
        @keyframes toastSlideIn { from{opacity:0;transform:translateY(-20px)} to{opacity:1;transform:translateY(0)} }
        /* 모바일 앱처럼 전체 화면 확대/축소 방지 */
        html, body { touch-action: manipulation; -ms-touch-action: manipulation; }
        * { -webkit-touch-callout: none; }
        /* ── v4.0: 헤더 높이 CSS 변수 — 단일 소스로 모든 breakpoint 동기화 ── */
        :root {
          --header-h: 56px;
          --header-gap: 16px;
        }
        @media (min-width: 1024px) {
          :root { --header-h: 64px; --header-gap: 16px; }
        }
        @media (max-width: 640px) {
          :root { --header-h: 48px; --header-gap: 12px; }
        }
        @media (max-width: 380px) {
          :root { --header-h: 48px; --header-gap: 10px; }
        }
        /* v4.3: 헤더 — safe-area 완전 분리 방식 */
        /* safe-area 커버: 헤더 위에 깔리는 배경 블록 */
        .safe-area-cover {
          position: fixed !important;
          top: 0 !important;
          left: 0 !important;
          right: 0 !important;
          height: env(safe-area-inset-top, 0px) !important;
          z-index: 101 !important;
          pointer-events: none;
        }
        /* 헤더: safe-area 아래에 위치 */
        header {
          position: fixed !important;
          top: env(safe-area-inset-top, 0px) !important;
          left: 0 !important;
          right: 0 !important;
          height: var(--header-h) !important;
          min-height: var(--header-h) !important;
          box-sizing: border-box !important;
          padding-top: 0 !important;
        }
        /* 메인 콘텐츠 영역: safe-area + 간격만 (Header spacer가 이미 헤더 높이 확보) */
        main {
          padding-top: calc(env(safe-area-inset-top, 0px) + var(--header-gap)) !important;
        }
        body { padding-bottom: env(safe-area-inset-bottom, 0px); }
        /* 모바일 하단 탭바 safe-area */
        .mobile-bottom-nav {
          padding-bottom: env(safe-area-inset-bottom, 0px) !important;
        }
        @keyframes slideUp { from{opacity:0;transform:translateY(16px)} to{opacity:1;transform:translateY(0)} }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        @keyframes slideDown { from{opacity:0;transform:translateY(-16px)} to{opacity:1;transform:translateY(0)} }
        /* ── 접근성: 포커스 표시, 터치 타깃 ── */
        *:focus-visible { outline: 2px solid ${C.blue}; outline-offset: 2px; border-radius: 4px; }
        button:focus:not(:focus-visible), a:focus:not(:focus-visible) { outline: none; }
        @media (pointer: coarse) { button, a, [role="button"] { min-height: 44px; min-width: 44px; } }
        /* skip-to-content 링크 (키보드 접근성) */
        .skip-link { position: absolute; top: -100px; left: 16px; padding: 8px 16px; background: ${C.blue}; color: #fff; border-radius: 8px; font-size: 14px; font-weight: 700; z-index: 9999; text-decoration: none; transition: top 0.2s; }
        .skip-link:focus { top: 8px; }
        * { box-sizing: border-box; margin: 0; -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; }
        html { font-size: 16px; line-height: 1.5; scroll-behavior: smooth; }
        body { letter-spacing: -0.01em; transition: background 0.3s ease, color 0.3s ease; }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: ${C.border2}; border-radius: 3px; }
        button, a { cursor: pointer; font-family: inherit; transition: all 0.15s ease; }
        button:active { transform: scale(0.96); transition-duration: 0.08s; }
        button:focus-visible { outline: 2px solid ${C.blue}; outline-offset: 2px; }
        input, select { font-family: inherit; font-size: 14px; transition: border-color 0.2s ease, box-shadow 0.2s ease; }
        input:focus { border-color: ${C.blue} !important; box-shadow: 0 0 0 3px ${C.blue}30; outline: none; }
        select:focus { border-color: ${C.blue} !important; box-shadow: 0 0 0 3px ${C.blue}30; outline: none; }
        /* 부드러운 테마 전환 */
        *, *::before, *::after { transition-property: background-color, border-color, color; transition-duration: 0.15s; transition-timing-function: ease; }
        .skeleton { background: linear-gradient(90deg, ${C.card2} 25%, ${C.border} 50%, ${C.card2} 75%);
          background-size: 200% 100%; animation: shimmer 1.5s infinite; border-radius: 8px; }
        .tab-content { animation: slideUp 0.25s ease; display: flex; flex-direction: column; gap: 16px; }
        .card-hover { transition: transform 0.2s ease, box-shadow 0.2s ease; ${!C.isDark ? 'box-shadow: 0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.02);' : ''} }
        .card-hover:hover { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(0,0,0,${C.isDark ? '0.25' : '0.10'}); }
        .card-hover:active { transform: translateY(0); }
        @keyframes countUp { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
        .score-animate { animation: countUp 0.4s ease-out; }
        /* ── 기본 홈 그리드 (모바일 1컬럼) ── */
        .home-grid { display: flex; flex-direction: column; gap: 20px; }
        .home-left, .home-right { display: flex; flex-direction: column; gap: 12px; }
        .home-full { display: flex; flex-direction: column; gap: 16px; }
        /* 가로 스크롤 영역 스크롤바 숨김 */
        .hscroll { overflow-x: auto; -webkit-overflow-scrolling: touch; scrollbar-width: none; -ms-overflow-style: none; }
        .hscroll::-webkit-scrollbar { display: none; }
        /* 수평 스크롤 우측 페이드 효과 */
        .hscroll-fade { position: relative; }
        .hscroll-fade::after { content: ""; position: absolute; right: 0; top: 0; bottom: 0; width: 32px; background: linear-gradient(to right, transparent, ${C.bg}); pointer-events: none; z-index: 1; }
        /* 터치 피드백 개선 — 모든 인터랙티브 요소 */
        @media (pointer: coarse) {
          .ui-card-compact:active { transform: scale(0.98); }
          .ui-list-item:active { background: ${C.card2}90; transform: scale(0.99); }
        }
        /* 좌측 네비게이션 바 (LNB) */
        .lnb-sidebar { display: flex !important; }
        .lnb-sidebar::-webkit-scrollbar { display: none; }
        /* 사이드바 (기본 숨김) */
        .di-sidebar { display: none; }
        .di-app-body { display: flex; flex-direction: column; }
        .di-main-wrap { flex: 1; }
        .gnb-inner { margin-left: auto !important; margin-right: auto !important; }
        /* ★ 하단탭 도입 시 넣었던 640px 이하 햄버거 숨김 규칙은 삭제했습니다 —
           하단 5탭 밖의 화면(자산 분석·저장한 조건·포트폴리오)과 비로그인 테마 전환이
           폰에서 도달 불가(고아)가 되던 회귀. 전체 메뉴 시트는 상단 햄버거로 진입합니다. */
        /* v7.5: 공통 카드 스타일 — 개선된 간격 ── */
        .ui-card {
          background: ${C.isDark
            ? `linear-gradient(135deg, ${C.card} 0%, ${C.card}ee 50%, ${C.card2}88 100%)`
            : C.card};
          border-radius: 20px;
          padding: 24px;
          border: 1px solid ${C.isDark ? `${C.border}30` : `${C.border}60`};
          box-shadow: ${C.isDark
            ? `0 4px 24px rgba(0,0,0,0.3), 0 1px 4px rgba(0,0,0,0.2), inset 0 1px 0 ${C.border}15`
            : `0 2px 12px rgba(15,23,42,0.08), 0 1px 3px rgba(15,23,42,0.04)`};
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          transition: transform 0.2s ease, box-shadow 0.2s ease;
          overflow: hidden;
          position: relative;
        }
        .ui-card::before {
          content: "";
          position: absolute;
          top: 0; left: 0; right: 0;
          height: 1px;
          background: linear-gradient(90deg, transparent 0%, ${C.isDark ? `${C.blue}40` : `${C.blue}20`} 50%, transparent 100%);
        }
        .ui-card:hover {
          transform: translateY(-3px);
          box-shadow: ${C.isDark
            ? `0 12px 40px rgba(0,0,0,0.4), 0 4px 12px rgba(59,130,246,0.1)`
            : `0 8px 30px rgba(15,23,42,0.12), 0 4px 8px rgba(15,23,42,0.06)`};
        }
        .ui-card-compact { background: ${C.card}; border-radius: 12px; padding: 16px; border: 1px solid ${C.border}${C.isDark ? '18' : '40'}; overflow: hidden; }
        /* 프리미엄 카드 — AI/중요 섹션용 그래디언트 */
        .ui-card-premium {
          background: ${C.isDark
            ? `linear-gradient(145deg, ${C.purpleBg} 0%, ${C.card} 40%, ${C.blueBg} 100%)`
            : `linear-gradient(145deg, #F5F0FF 0%, #FFFFFF 40%, #EBF4FF 100%)`};
          border-radius: 20px;
          padding: 24px;
          border: 1px solid ${C.isDark ? `${C.purple}25` : `${C.purple}15`};
          box-shadow: ${C.isDark
            ? `0 4px 24px rgba(155,111,255,0.12), 0 1px 4px rgba(0,0,0,0.2)`
            : `0 2px 12px rgba(124,58,237,0.08)`};
          overflow: hidden;
          position: relative;
        }
        .ui-card-premium::before {
          content: "";
          position: absolute;
          top: 0; left: 0; right: 0;
          height: 1px;
          background: linear-gradient(90deg, transparent, ${C.purple}60, ${C.blue}40, transparent);
        }
        /* 섹션 헤더 악센트 */
        .section-header {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 16px;
          font-size: 18px;
          font-weight: 800;
          color: ${C.text1};
          letter-spacing: -0.02em;
        }
        .section-header::after {
          content: "";
          flex: 1;
          height: 1px;
          background: linear-gradient(90deg, ${C.border}40, transparent);
        }
        /* 그래디언트 애니메이션 배경 */
        @keyframes gradientShift {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
        .hero-gradient {
          background: ${C.isDark
            ? `linear-gradient(-45deg, ${C.blueBg}, ${C.purpleBg}, ${C.card}, ${C.blueBg})`
            : `linear-gradient(-45deg, #EBF4FF, #F5F0FF, #FFFFFF, #EBF4FF)`};
          background-size: 400% 400%;
          animation: gradientShift 15s ease infinite;
        }
        /* 카드 스태거드 진입 애니메이션 */
        @keyframes cardEnter {
          from { opacity: 0; transform: translateY(16px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .card-stagger > * { animation: cardEnter 0.4s ease backwards; }
        .card-stagger > *:nth-child(1) { animation-delay: 0s; }
        .card-stagger > *:nth-child(2) { animation-delay: 0.06s; }
        .card-stagger > *:nth-child(3) { animation-delay: 0.12s; }
        .card-stagger > *:nth-child(4) { animation-delay: 0.18s; }
        .card-stagger > *:nth-child(5) { animation-delay: 0.24s; }
        .card-stagger > *:nth-child(6) { animation-delay: 0.30s; }
        .card-stagger > *:nth-child(7) { animation-delay: 0.36s; }
        .card-stagger > *:nth-child(8) { animation-delay: 0.42s; }
        /* 글로우 이펙트 */
        .glow-green { box-shadow: 0 0 12px ${C.green}40, 0 0 4px ${C.green}20; }
        .glow-red { box-shadow: 0 0 12px ${C.red}40, 0 0 4px ${C.red}20; }
        .glow-blue { box-shadow: 0 0 12px ${C.blue}40, 0 0 4px ${C.blue}20; }
        .glow-purple { box-shadow: 0 0 12px ${C.purple}40, 0 0 4px ${C.purple}20; }
        .ui-divider { height: 1px; background: ${C.border}; opacity: 0.2; margin: 12px 0; }
        .ui-list-item { display: flex; align-items: center; padding: 12px 10px; cursor: pointer; border-radius: 8px; transition: background 0.15s; gap: 8px; }
        .ui-list-item:hover { background: ${C.card2}60; }
        .ui-list-item:active { background: ${C.card2}90; }
        .asset-card { border-radius: 12px; transition: all 0.15s ease; }
        .asset-card:hover { border-color: ${C.blue}44 !important; box-shadow: 0 2px 12px ${C.blue}12; transform: translateY(-1px); }
        .asset-card:active { transform: scale(0.995); }
        .ui-section-title { font-size: 16px; font-weight: 700; color: ${C.text1}; margin-bottom: 12px; }
        .ui-section-sub { font-size: 13px; color: ${C.text3}; margin-bottom: 8px; }
        /* ── 모바일 (≤640px) — 폰트/간격 확대 + 터치 최적화 (v9.2 개선) ── */
        @media (max-width: 640px) {
          header { padding: 0 6px !important; height: auto !important; min-height: 48px !important; }
          header > div { padding: 0 6px !important; height: 48px !important; gap: 6px !important; }
          /* 모바일: 로고 + 검색 + 햄버거만. 유저칩/테마/로그인 버튼 숨김 → 햄버거 메뉴로 이동 */
          .desktop-only { display: none !important; }
          .header-search-label { display: none !important; }
          .header-search-btn { padding: 7px 9px !important; }
          .desktop-nav { display: none !important; }
          .mobile-menu-btn { display: flex !important; }
          .lnb-sidebar { display: none !important; }
          main { padding-left: 14px !important; padding-right: 14px !important; padding-bottom: 160px !important; font-size: 15px !important; }
          .tab-content { font-size: 15px; padding-bottom: 120px !important; gap: 12px !important; }
          button { min-height: 44px; }
          select { min-height: 44px; }
          .screener-cond-btn { padding: 10px 16px !important; font-size: 13px !important; min-height: 44px !important; border-radius: 12px !important; }
          /* 모바일에서 스크리닝 옵션 버튼 터치 최적화 */
          .tab-content button { min-height: 44px; }
          /* 지표 그리드 3열→2열 전환 */
          .tech-grid-popup { grid-template-columns: repeat(2, 1fr) !important; }
          .home-grid { gap: 16px !important; }
          .home-left { gap: 14px !important; }
          .home-right { gap: 14px !important; }
          /* 모바일에서 사이드바는 메인 콘텐츠 아래에 자연 배치 */
          .ui-card { padding: 16px !important; border-radius: 14px !important; }
          .ui-card-compact { padding: 14px !important; }
          .ui-list-item { padding: 12px 8px; }
          /* 모바일에서 지표 그리드 2열로 축소 */
          .indicator-grid { grid-template-columns: repeat(2, 1fr) !important; }
          /* 시그널 태그 터치 영역 확대 */
          span[title] { padding: 6px 12px !important; font-size: 12px !important; }
          /* 뉴스 카드 패딩 최적화 */
          .tab-content a { padding: 14px !important; }
          /* 섹터 히트맵 모바일 2열 */
          .sector-heatmap-grid { grid-template-columns: repeat(2, 1fr) !important; }
          /* (제거됨 2026-06-12 모달 전수감사 P1: 하단 ticker 용 광역 [style*=...] 규칙 2줄 —
             티커는 이미 삭제됐는데 top/left/right/bottom 개별 지정 fixed 요소 전체(상세 팝업·
             로그인 모달·탭바·PaperTrading 모달)에 padding 4px·span 11px 를 강제 오염시키던 죽은 규칙) */
          /* v3.7: 스크리너 카드 모바일 가독성 개선 */
          .asset-card { padding: 14px 12px !important; }
          .asset-card .indicator-grid { gap: 6px !important; }
          /* v3.7: 수급 게이지 모바일 최소 높이 확보 */
          .asset-card div[style*="gap: 3px"] { gap: 5px !important; }
          /* 섹션 제목 모바일 폰트 축소 */
          .ui-section-title { font-size: 15px !important; }
        }
        /* ── 매우 작은 화면 (≤380px) — 극저해상도 최적화 ── */
        @media (max-width: 380px) {
          main { padding-left: 10px !important; padding-right: 10px !important; padding-bottom: 90px !important; }
          .ui-card { padding: 12px !important; border-radius: 12px !important; }
          .ui-card-compact { padding: 10px !important; }
          .home-grid { gap: 12px !important; }
          .home-left { gap: 12px !important; }
          .home-right { gap: 12px !important; }
          .ui-section-title { font-size: 15px !important; margin-bottom: 3px; }
          h2, h3 { font-size: 15px !important; }
        }
        /* ── 태블릿 (641~899px) — 중간화면 최적화 ── */
        @media (min-width: 641px) and (max-width: 899px) {
          main { padding-left: 20px !important; padding-right: 20px !important; padding-bottom: 80px !important; }
          .desktop-nav { gap: 4px !important; overflow: visible !important; }
          .desktop-nav::-webkit-scrollbar { display: none; }
          .desktop-nav button { padding: 7px 10px !important; font-size: 12px !important; }
          .home-grid { display: grid !important; grid-template-columns: 1fr !important; gap: 18px !important; align-items: start !important; }
          .ui-card { padding: 16px !important; }
          .home-left { gap: 14px !important; }
          .home-right { gap: 14px !important; }
        }
        /* ── 데스크톱 중간 (900~1199px) — 두 컬럼 레이아웃 ── */
        @media (min-width: 900px) and (max-width: 1199px) {
          main { padding-left: 28px !important; padding-right: 28px !important; padding-bottom: 32px !important; }
          .home-grid { display: grid !important; grid-template-columns: 1fr 360px !important; gap: 20px !important; align-items: start !important; }
          .home-right { position: sticky; top: calc(var(--header-h) + var(--header-gap) + env(safe-area-inset-top, 0px)); max-height: calc(100vh - var(--header-h) - var(--header-gap) - env(safe-area-inset-top, 0px) - 16px); overflow-y: auto; overflow-x: hidden; scroll-behavior: smooth;
            scrollbar-width: none; -ms-overflow-style: none; }
          .home-right::-webkit-scrollbar { display: none; }
          .ui-card { padding: 18px !important; }
          .home-left { gap: 16px !important; }
          .home-right { gap: 16px !important; }
        }
        /* ── 데스크톱 (≥1200px) — 전체폭 헤더 + 와이드 레이아웃 ── */
        @media (min-width: 1200px) {
          .desktop-nav { display: flex !important; }
          .mobile-menu-btn { display: none !important; }
          .di-app-body { flex-direction: column !important; }
          .di-main-wrap { margin-left: 0; flex: 1; width: 100%; }
          .di-main-wrap header { left: 0 !important; width: 100% !important; }
          .di-main-wrap main { max-width: 1400px !important; padding-left: 36px !important; padding-right: 36px !important; padding-bottom: 36px !important; }
          .gnb-inner { max-width: 1400px !important; padding-left: 36px !important; padding-right: 36px !important; margin-left: auto !important; margin-right: auto !important; }
          .home-grid { display: grid !important; grid-template-columns: 1fr 400px !important; gap: 24px !important; align-items: start !important; }
          .home-right { position: sticky; top: calc(var(--header-h) + var(--header-gap) + env(safe-area-inset-top, 0px)); max-height: calc(100vh - var(--header-h) - var(--header-gap) - env(safe-area-inset-top, 0px) - 16px); overflow-y: auto; overflow-x: hidden; scroll-behavior: smooth;
            scrollbar-width: none; -ms-overflow-style: none; }
          .home-right::-webkit-scrollbar { display: none; }
          .ui-card { padding: 20px !important; }
          .home-left { gap: 18px !important; }
          .home-right { gap: 18px !important; }
        }
        /* ── 초와이드 (≥1600px) — 최대 폭 레이아웃 ── */
        @media (min-width: 1600px) {
          .di-main-wrap main { max-width: 1600px !important; padding-left: 48px !important; padding-right: 48px !important; padding-bottom: 40px !important; }
          .gnb-inner { max-width: 1600px !important; padding-left: 48px !important; padding-right: 48px !important; margin-left: auto !important; margin-right: auto !important; }
          .home-grid { grid-template-columns: 1fr 480px !important; gap: 28px !important; }
          .ui-card { padding: 22px !important; }
          .home-left { gap: 20px !important; }
          .home-right { gap: 20px !important; }
        }
        @keyframes tickerScroll {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        @keyframes cardPulse {
          0% { transform: scale(1); }
          50% { transform: scale(1.02); }
          100% { transform: scale(1); }
        }
        @keyframes badgeUnlock {
          0% { transform: scale(0.8); opacity: 0.5; }
          50% { transform: scale(1.1); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes shimmerNew {
          0% { background-position: -200px 0; }
          100% { background-position: 200px 0; }
        }
        .card-enter { animation: fadeInUp 0.3s ease-out; }
        .card-pulse-hover:hover { animation: cardPulse 0.4s ease-in-out; }
        .badge-unlock { animation: badgeUnlock 0.5s cubic-bezier(0.34, 1.56, 0.64, 1); }
        .button-press:active { animation: cardPulse 0.2s ease-out; }
      `}</style>


      <div className="di-app-body">
      <div className="di-main-wrap">

      {/* ── safe-area 배경 커버 (상태바 영역) ── */}
      <div className="safe-area-cover" style={{ background: C.bg }} />

      {/* ── GNB 헤더 (shadcn 기반 컴포넌트) ── */}
      <Header
        tab={tab}
        setTab={setTab}
        user={user}
        isOwner={isOwner}
        themeMode={themeMode}
        toggleTheme={toggleTheme}
        signOut={signOut}
        setShowAuthModal={setShowAuthModal}
        setGlobalSearchOpen={setGlobalSearchOpen}
        alertBadge={alertBadge}
        anomalyCount={anomalies?.length || 0}
        requireLogin={requireLogin}
      />

      <PullToRefresh onRefresh={async () => {
        if (tab === "home") await fetchMarketOverview();
        else if (tab === "portfolio") await fetchPortfolioPrices();
        // ★ IA v3: "news" 내부 id = 코인 탭 — 시그널 풀 + 시장 컨텍스트 동시 갱신
        else if (tab === "news") await Promise.all([fetchCoinTabSignals(), fetchCoinCtx()]);
        // ★ IA v3: "screener" 내부 id = 주식 탭 — 시그널 풀 갱신 (스캔 결과는 수동 액션 유지)
        else if (tab === "screener") await fetchStockTabSignals();
        else if (tab === "indicators") await (indicatorsView === "news" ? fetchNews() : fetchEconCalendar());
        else window.location.reload();
      }}>
      <main className="px-4 py-4 pb-8 sm:px-6 sm:py-6 sm:pb-10" style={{ maxWidth: "1400px", margin: "0 auto" }}>

        {/* ═══════════════════════════════════════════════════════════
            TAB: 홈 (토스 스타일 — 깔끔하고 정보 밀도 최적화)
        ═══════════════════════════════════════════════════════════ */}
        {/* ═══════════════════════════════════════════════════════════
            TAB: 홈 (비owner) — ★ 2026-08-12 IA v3 (시안 1d): 모든 섹션을
            HomeSection 카드 컨테이너(헤더 행 내장 + 액션 칩 1개)로 감쌌습니다.
            인사/헤드라인
            ① 마켓 브리핑(IndexStrip) ★오늘의 시그널(SignalCard, [코인|주식] 세그먼트)
            ② 톱 뉴스 3행 → 지표 탭(뉴스) ③ 경제 캘린더 → 지표 탭(캘린더)
            ④ 시장 지표 스냅샷(GaugeCard+IndicatorCard) → 코인 탭
            ⑤ 관심종목/인기 종목(AssetRow) → 주식 탭 ⑥ 시장 리포트 진입 · Disclaimer
            블록 구성과 데이터 소스는 그대로 — 표현·진입점만 v3 로 재구성했습니다.
            (owner 는 아래 기존 홈 그대로 유지)
        ═══════════════════════════════════════════════════════════ */}
        {tab === "home" && (() => {
          const idxOf = (sym) => marketIndices.find(i => i.symbol === sym);
          const indexCards = [
            { idx: idxOf("^GSPC"), symbol: "^GSPC", name: "S&P 500", flag: "🇺🇸", market: "us" },
            { idx: idxOf("^IXIC"), symbol: "^IXIC", name: "NASDAQ", flag: "🇺🇸", market: "us" },
            { idx: idxOf("^DJI"), symbol: "^DJI", name: t("tabs.home.dowLabel") || "다우존스", flag: "🇺🇸", market: "us" },
            { idx: idxOf("^KS11"), symbol: "^KS11", name: t("tabs.home.kospiLabel") || "코스피", flag: "🇰🇷", market: "kr" },
            { idx: idxOf("^KQ11"), symbol: "^KQ11", name: t("tabs.home.kosdaqLabel") || "코스닥", flag: "🇰🇷", market: "kr" },
            { idx: idxOf("USDKRW=X"), symbol: "USDKRW=X", name: "KRW/USD", flag: "💱", market: "fx" },
          ];
          const fgVal = fearGreed.stock?.value;
          const fgCryptoVal = fearGreed.crypto?.value;
          // ★ 지표 허브(IndicatorHub)와 색 문법 통일 — 같은 지표가 홈에서는 빨강→초록,
          //   허브에서는 파랑→주황으로 달리 보이던 문제. 허브의 temp 램프(냉각 파랑 ~ 과열 주황)와
          //   tone 임계값(≤25 cold / ≥75 hot / 그 외 중립)을 그대로 따릅니다.
          const fgColorOf = (v) => v == null ? C.text3 : (v <= 25 ? C.blue : v >= 75 ? C.orange : C.text3);
          const fgRamp = `linear-gradient(90deg, ${C.blue}, ${C.yellow} 50%, ${C.orange})`;
          const fgLabelOf = (v) => v == null ? "—" : (v <= 25 ? t("tabs.home.extremeFear") : v <= 40 ? t("tabs.home.fear") : v <= 60 ? t("tabs.home.neutral") : v <= 75 ? t("tabs.home.greed") : t("tabs.home.extremeGreed"));
          // ★ Phase 2 — ④ 블록 uiKit IndicatorCard 용 tone·한줄 해석 매핑
          //   (tone 규격: up=green / down=red / neutral / hot=orange / cold=blue)
          const tempToneOf = (v) => v == null ? "neutral" : v <= 25 ? "cold" : v <= 50 ? "up" : v <= 75 ? "hot" : "down";
          const tempDescOf = (v) => v == null ? ""
            : v <= 25 ? t("tabs.home.tempDescCalm")
            : v <= 50 ? t("tabs.home.tempDescMild")
            : v <= 75 ? t("tabs.home.tempDescHot")
            : t("tabs.home.tempDescOverheat");
          // ② 톱 뉴스 3행 — 뉴스 탭과 동일 데이터(newsItems) 재사용
          const topNews = [...newsItems].sort((a, b) =>
            new Date(b.date || b.publishedAt || b.pubDate || 0) - new Date(a.date || a.publishedAt || a.pubDate || 0)
          ).slice(0, 3);
          // ③ 경제 캘린더 — 오늘·내일 이벤트 우선, 없으면 가장 가까운 예정 3건
          const nearEvents = econEvents.filter(e => e.daysUntil === 0 || e.daysUntil === 1);
          const calRows = (nearEvents.length > 0 ? nearEvents : econEvents.filter(e => e.daysUntil >= 0))
            .slice()
            .sort((a, b) => (a.daysUntil - b.daysUntil) || ((b.importance === "high" ? 1 : 0) - (a.importance === "high" ? 1 : 0)))
            .slice(0, 3);
          // ④ Zepta 마켓 온도 — API 실패 시 온도 부분만 조용히 숨김
          const tempVal = marketTemp ? Math.max(0, Math.min(100, Number(marketTemp.temp))) : null;
          const tempUpdated = (() => {
            if (!marketTemp?.updatedAt) return null;
            const d = new Date(marketTemp.updatedAt);
            return isNaN(d.getTime()) ? null : t("tabs.home.asOfShort", { time: `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}` });
          })();
          const hasSnapshot = fgVal != null || fgCryptoVal != null || !!stockIndicator || tempVal != null;
          // ⑤ 관심종목 요약(로그인+보유 시) / 인기 종목(기존 주요종목 데이터 재사용)
          const watchRows = user && watchlist.length > 0
            ? watchlist.slice(0, 5).map(w => ({ ...w, hot: hotAssets.find(h => h.symbol === w.symbol || h.symbol === w.symbolRaw) }))
            : null;
          // ★ 2026-08-02 (대표 지시 "주식+코인 양축"): 이전엔 변동률 절대값 상위만 뽑아
          //   변동성이 큰 코인이 목록을 독점하는 일이 잦았습니다. 미국 주식·한국 주식·코인
          //   버킷에서 각각 변동률 상위를 뽑아 라운드로빈으로 섞습니다(버킷 소진 시 자동 축소).
          const popularRows = (() => {
            const byAbsChg = (m) => hotAssets
              .filter(a => a.market === m)
              .sort((a, b) => Math.abs(b.change || 0) - Math.abs(a.change || 0));
            const buckets = [byAbsChg("us"), byAbsChg("kr"), byAbsChg("crypto")];
            const LIMIT = 6;
            const out = [];
            for (let i = 0; out.length < LIMIT; i++) {
              let added = false;
              for (const b of buckets) {
                if (b[i] && out.length < LIMIT) { out.push(b[i]); added = true; }
              }
              if (!added) break; // 모든 버킷 소진
            }
            return out;
          })();
          const cardBase = { background: C.card, borderRadius: "16px", padding: "20px", border: `1px solid ${C.border}${C.isDark ? '18' : '40'}` };
          const newsTime = (n) => {
            const d = new Date(n.date || n.publishedAt || n.pubDate || 0);
            return isNaN(d.getTime()) ? "--:--" : `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
          };

          // ── 인사 + 헤드라인 ──────────────────────────────────────
          // 헤드라인은 "상태 서술"만 합니다(행동 지시 금지 — 서비스 표현 3원칙).
          const hour = new Date().getHours();
          const greetText = hour < 6 ? t("tabs.home.greetDawn")
            : hour < 12 ? (t("tabs.home.goodMorning") || "좋은 아침이에요")
            : hour < 18 ? (t("tabs.home.goodAfternoon") || "좋은 오후예요")
            : (t("tabs.home.goodEvening") || "오늘도 고생 많으셨어요");
          const displayName = user?.user_metadata?.nickname || user?.email?.split("@")[0] || "";
          // 지수 방향의 폭(breadth)으로 시장 온도를 한 단어로 요약 — 환율은 방향 판정에서 제외.
          const biasSamples = indexCards
            .filter(c => c.market !== "fx" && c.idx && Number.isFinite(Number(c.idx.change)))
            .map(c => Number(c.idx.change));
          const upRatio = biasSamples.length ? biasSamples.filter(v => v > 0).length / biasSamples.length : null;
          const bias = upRatio == null ? null : upRatio >= 0.6 ? "up" : upRatio <= 0.4 ? "down" : "flat";
          const biasWord = bias === "up" ? t("tabs.home.upDominant") : bias === "down" ? t("tabs.home.downDominant") : t("tabs.home.mixed");
          const biasColor = bias === "up" ? C.greenL : bias === "down" ? C.redL : C.yellowL;

          // ── ① 지수 스트립 데이터 ────────────────────────────────
          const indexItems = indexCards.map(c => ({
            label: `${c.flag} ${c.name}`,
            value: c.idx
              ? (c.symbol === "USDKRW=X"
                ? `₩${Math.round(c.idx.price).toLocaleString()}`
                : Number(c.idx.price).toLocaleString(undefined, { maximumFractionDigits: 0 }))
              : "—",
            change: c.idx && Number.isFinite(Number(c.idx.change)) ? Number(c.idx.change) : null,
            // 카드별 클릭 → 차트 열기. IndexStrip 이 item.onClick 을 직접 받으므로
            // DOM 위임 우회 없이 안전하게 연결됩니다(키보드 Enter/Space 도 지원).
            onClick: c.idx
              ? () => setChartAsset({ symbol: c.idx.symbol, name: c.name, market: c.market, symbolRaw: c.idx.symbol })
              : undefined,
          }));

          // ── 오늘의 시그널 (멀티TF 시그널 풀 — 없으면 섹션 자체를 렌더하지 않습니다) ──
          const TF_KO = { "1w": t("tabs.coin.tf1w"), "1d": t("tabs.coin.tf1d"), "4h": t("tabs.coin.tf4h"), "1h": t("tabs.coin.tf1h") };
          const srFmt = fmtLevelPrice; // 상세 시트와 같은 표기 규칙 (모듈 상단 SSOT)
          // ★ 2026-08 주식 확장: [코인|주식] 세그먼트. 두 풀 모두 같은 필터를 거칩니다.
          const signalRowsOf = (arr) => (Array.isArray(arr) ? arr : [])
            .filter(s => s && (s.side === "LONG" || s.side === "SHORT") && Number.isFinite(Number(s.score)))
            .slice(0, 3);
          const coinSignalRows = signalRowsOf(homeSignals);
          const stockSignalRows = STOCK_SIGNALS_ON
            ? signalRowsOf(homeStockSignals).filter(s => s.market === "us" || s.market === "kr")
            : [];
          // 세그먼트는 두 풀이 모두 있을 때만 노출 — 주식 응답이 아직 없으면(배포 전·장애)
          // 기존 코인 화면 그대로입니다. 선택한 풀이 비면 남은 풀로 자동 대체합니다.
          const showSignalSegment = coinSignalRows.length > 0 && stockSignalRows.length > 0;
          const activeSignalMarket =
            homeSignalMarket === "stock" && stockSignalRows.length > 0 ? "stock"
            : coinSignalRows.length > 0 ? "crypto"
            : stockSignalRows.length > 0 ? "stock" : "crypto";
          const signalRows = activeSignalMarket === "stock" ? stockSignalRows : coinSignalRows;

          // 섹션 간격 — 시안 1d 모바일 12px / 데스크탑은 기존 18px 유지
          return (
            <div className="tab-content" style={{ maxWidth: "860px", margin: "0 auto", display: "flex", flexDirection: "column", gap: isMobile ? "12px" : "18px" }}>

              {/* ── 인사 + 헤드라인 + 알림 (상태 서술만 — 행동 지시 없음) ──
                   시안의 브랜드 헤더는 네이티브 앱 전제라 워드마크를 직접 그리지만,
                   웹은 상단 GNB 가 이미 브랜드를 표시합니다. 같은 화면에 "Zepta" 가
                   두 번 나오지 않도록 인페이지 워드마크는 두지 않고, 알림 버튼만
                   인사 줄 오른쪽에 붙여 진입점을 보존했습니다. */}
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px" }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: "13px", color: C.text3, fontWeight: 600 }}>
                    {displayName ? `${displayName}${t("tabs.home.nameSuffix")}${greetText}` : greetText}
                  </div>
                  <div style={{ fontSize: "21px", fontWeight: 800, color: C.text1, letterSpacing: "-0.03em", marginTop: "4px", lineHeight: 1.3 }}>
                    {bias
                      ? <>{t("tabs.home.todayMarketPrefix")}<span style={{ color: biasColor }}>{biasWord}</span>{t("tabs.home.todayMarketSuffix")}</>
                      : t("tabs.home.headlineLoading")}
                  </div>
                </div>
                <IconButton ariaLabel={t("nav.alerts")} badge={alertBadge > 0} onClick={() => setTab("notifications")} style={{ flexShrink: 0, marginTop: "2px" }}>
                  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                  </svg>
                </IconButton>
              </div>

              {/* ── ① 마켓 브리핑 — 6지수 스트립 (시안 1d "시장 현황" 카드 문법) ──
                   섹션 = 카드 컨테이너 + 통일 헤더(제목·LIVE 도트·액션 칩 1개). */}
              <HomeSection
                title={t("tabs.home.marketBriefing") || "마켓 브리핑"}
                live={marketIndices.length > 0}
                // ★ 정돈 패스(대표 "컴포넌트 과다" 지시): 이 카드의 주요 액션은 "브리핑 전문
                //   보기" 하나로 집중합니다. 수동 새로고침은 30초 자동 폴링이 이미 담당하므로
                //   헤더에서 아이콘 전용(라벨 없음)으로 축소해 시각 무게를 낮췄습니다.
                action={{
                  label: marketLoading ? "···" : "↻",
                  ariaLabel: t("tabs.home.refresh"),
                  onClick: marketLoading ? undefined : fetchMarketOverview,
                  disabled: marketLoading,
                  style: { width: "28px", padding: 0, justifyContent: "center", fontSize: "13px" },
                }}
              >
                {marketIndices.length === 0 ? (
                  <div style={{ display: "flex", gap: "8px", overflow: "hidden" }}>
                    {[0, 1, 2, 3].map(i => (
                      <div key={`nh-skel-${i}`} style={{ flexShrink: 0, minWidth: "108px" }}>
                        <Skeleton width="108px" height="76px" />
                      </div>
                    ))}
                  </div>
                ) : (
                  // 데스크탑은 가로 스크롤 스트립 대신 3열 그리드로 전폭을 채웁니다
                  // (좌측 몰림 + 우측 빈 공간 회귀 수정 — 모바일은 시안 그대로 스크롤).
                  // IndexStrip 의 style prop 이 컨테이너 기본값을 덮으므로 grid 전환이 안전합니다.
                  <IndexStrip
                    items={indexItems}
                    style={!isMobile ? { display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", overflowX: "visible" } : undefined}
                  />
                )}
                {/* 브리핑 전문(서버 렌더 SEO 페이지) 진입 — 텍스트 링크 → 칩 (1d "텍스트 링크 금지") */}
                <div style={{ marginTop: "10px", display: "flex", justifyContent: "flex-end" }}>
                  <HomeActionChip href="/briefing" label={t("tabs.home.briefingLink")} />
                </div>
              </HomeSection>

              {/* ── ★ 오늘의 시그널 (멀티TF 시그널 풀 · 데이터 없으면 섹션 자체가 사라집니다) ── */}
              {signalRows.length > 0 && (
                <HomeSection
                  title={t("tabs.home.todaySignals")}
                  // 주식 스코어는 장 마감 후 마지막 장중 데이터가 유지되는 설계(주말 60시간+)라
                  // 실시간을 시사하는 펄스 점을 켜지 않습니다 — 캡션의 "N시간 전 집계"와
                  // 모순되지 않도록 코인 풀 표시 중에만 켭니다.
                  live={activeSignalMarket !== "stock"}
                  // ★ IA v3: "전체 보기"는 활성 세그먼트를 따라 코인/주식 "탭"으로 갑니다
                  //   (설계서 v3 0장 — 구 /coin 정적 대시보드 역할은 코인 탭이 대체.
                  //    주식은 기존 스크리너 주식 필터 시드 유지 → 주식 탭).
                  action={{
                    label: t("tabs.home.viewAll"),
                    onClick: activeSignalMarket === "stock"
                      ? () => { setFilterMarket("stock"); setTab("screener"); }
                      : () => setTab("news"),
                  }}
                >
                  {/* [코인|주식] 세그먼트 — 두 풀이 모두 있을 때만 (mobileKit Segment) */}
                  {showSignalSegment && (
                    <Segment
                      value={activeSignalMarket}
                      onChange={setHomeSignalMarket}
                      options={[
                        { value: "crypto", label: t("tabs.home.segCoin") },
                        { value: "stock", label: t("tabs.home.segStock") },
                      ]}
                      style={{ marginBottom: "10px" }}
                    />
                  )}
                  <div style={{ display: "flex", flexDirection: "column", gap: "9px" }}>
                    {signalRows.map((sig, i) => {
                      const isStockSig = sig.market === "us" || sig.market === "kr";
                      const dir = sig.side === "LONG" ? "up" : "down";
                      const bd = sig.breakdown || {};
                      // 주식 breakdown 은 4h 가 없을 수 있어 응답에 있는 키만 칩으로 만듭니다
                      // (없는 구간의 "—" 빈 칩을 그리지 않음). 코인은 기존 4칩 고정 그대로.
                      const tfKeys = isStockSig
                        ? Object.keys(TF_KO).filter(k => bd[k] != null)
                        : ["1w", "1d", "4h", "1h"];
                      const tfs = tfKeys.map(tf => ({
                        label: TF_KO[tf],
                        dir: bd[tf]?.side === "LONG" ? "up" : bd[tf]?.side === "SHORT" ? "down" : null,
                      }));
                      const sup = srFmt(sig.sr?.s?.[0]?.p);
                      const res = srFmt(sig.sr?.r?.[0]?.p);
                      // 지지·저항이 하나도 없으면 현재가 줄까지 통째로 숨깁니다(빈 칸 방지).
                      const px = (sup || res) ? srFmt(sig.sr?.px) : null;
                      // 표기: KRX 는 6자리 코드 대신 종목명(마스터에 있으면), 미국은 티커 그대로.
                      const symText = isStockSig
                        ? (sig.market === "kr"
                          ? (KR_NAME_BY_CODE[String(sig.symbol || "").replace(/\.(KS|KQ)$/i, "")]
                            || String(sig.symbol || "—").replace(/\.(KS|KQ)$/i, ""))
                          : String(sig.symbol || "—"))
                        : String(sig.symbol || sig.asset || "—").replace("USDT", "");
                      return (
                        <SignalCard
                          key={`${sig.symbol || sig.asset || "sig"}-${i}`}
                          symbol={symText}
                          // 주식은 현물이라 롱/숏 대신 상승/하락 우위로 서술합니다.
                          sideLabel={sig.side === "LONG"
                            ? t(isStockSig ? "tabs.home.upDominant" : "tabs.home.longDominant")
                            : t(isStockSig ? "tabs.home.downDominant" : "tabs.home.shortDominant")}
                          dir={dir}
                          score={Math.round(Math.max(0, Math.min(100, Number(sig.score))))}
                          timeframes={tfs.some(x => x.dir) ? tfs : []}
                          support={sup}
                          price={px}
                          resistance={res}
                          onClick={() => setDetailSignal(sig)}
                        />
                      );
                    })}
                  </div>
                  <div style={{ fontSize: "11px", color: C.text4, marginTop: "8px" }}>
                    {/* 엔진 산출 시각(ts) 실측 병기 — 크론이 멈춰 스코어가 밀리면
                        "N시간 전 집계 · 갱신 지연"이 그대로 드러납니다. ts 없으면 병기 생략. */}
                    {(() => {
                      const newestTs = signalRows.reduce((m, s) => Math.max(m, Number(s?.ts) || 0), 0);
                      // t 를 넘겨 신선도 문구도 로케일을 따릅니다 (영어 화면 혼합 언어 방지).
                      // 지연 임계는 활성 풀의 크론 주기를 따릅니다 — 코인 30분 / 주식 90분
                      // (주식 크론은 미국 30분·한국 60분 주기라 30분 기준이면 정상 운영도 지연 표기).
                      const fresh = coinScoreFreshness(newestTs, t,
                        activeSignalMarket === "stock" ? STALE_MIN_STOCK : 30);
                      // 출처 캡션도 활성 풀을 따릅니다 (코인=바이낸스 / 주식=미국·한국 50종).
                      const src = t(activeSignalMarket === "stock"
                        ? "tabs.home.stockSignalSourceNote" : "tabs.home.signalSourceNote");
                      return fresh ? `${src} · ${fresh}` : src;
                    })()}
                  </div>
                </HomeSection>
              )}

              {/* ── ② 톱 뉴스 3행 (뉴스 데이터 재사용 — 타임라인 행 스타일) ──
                   ★ IA v3: "더보기"는 지표 탭 뉴스 서브탭으로 (설계서 v3 1장 구역 4). */}
              <HomeSection
                title={t("tabs.home.topNews")}
                action={{
                  label: t("tabs.home.more"),
                  onClick: () => { setIndicatorsView("news"); setTab("indicators"); },
                }}
                bodyStyle={topNews.length > 0 ? { padding: 0 } : undefined}
              >
                {newsLoading && topNews.length === 0 ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    {[1, 2, 3].map(i => <Skeleton key={i} width="100%" height="40px" />)}
                  </div>
                ) : topNews.length === 0 ? (
                  <div style={{ fontSize: "14px", color: C.text3 }}>{t("tabs.home.noNews")}</div>
                ) : (
                  topNews.map((n, i) => {
                    const senti = analyzeSentiment(n.title);
                    const sColor = senti === "positive" ? C.green : senti === "negative" ? C.red : C.text3;
                    const sLabel = senti === "positive" ? t("tabs.home.sentiPositive") : senti === "negative" ? t("tabs.home.sentiNegative") : t("tabs.home.neutral");
                    return (
                      // 뉴스 탭 타임라인 행과 동일한 '제목 먼저, 메타 아래' 구조 —
                      // 긴 언론사명이 제목을 압착하던 문제와 색 점만으로 감성을 전달하던 문제를 함께 해소합니다.
                      <a key={i} href={n.url || n.link || "#"} target="_blank" rel="noopener" style={{
                        display: "flex", alignItems: "flex-start", gap: "10px",
                        padding: "11px 14px", textDecoration: "none",
                        borderBottom: i < topNews.length - 1 ? `1px solid ${C.card2}` : "none",
                      }}>
                        {/* 시간 + 감성 도트 (도트는 장식 — 감성은 아래 텍스트 배지가 전달) */}
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "4px", flexShrink: 0, paddingTop: "2px" }}>
                          <Num size="12px" weight={700} color={C.text3}>{newsTime(n)}</Num>
                          <span aria-hidden="true" style={{ width: "6px", height: "6px", borderRadius: "50%", background: sColor }} />
                        </div>
                        {/* 제목 전폭 → 아래 메타(감성 텍스트 배지 · 언론사) */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: "15px", fontWeight: 600, color: C.text1, lineHeight: 1.45, overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{n.title}</div>
                          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "3px", minWidth: 0 }}>
                            <span style={{ fontSize: "11px", fontWeight: 700, padding: "1px 7px", borderRadius: "5px", background: `${sColor}14`, color: sColor, flexShrink: 0 }}>{sLabel}</span>
                            {n.source ? (
                              <span style={{ fontSize: "12px", color: C.text3, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{n.source}</span>
                            ) : null}
                          </div>
                        </div>
                      </a>
                    );
                  })
                )}
              </HomeSection>

              {/* ── Google AdSense (②아래 — 기존 홈 슬롯 재배치) ── */}
              <div style={{ minHeight: 0, overflow: "hidden" }}>
                <GoogleAd format="responsive" slot="home-main" style={{ margin: "4px 0" }} />
              </div>

              {/* ── ③ 경제 캘린더 — 오늘·내일 상위 3 (시안 1d "다음 일정" 카드 문법) ──
                   ★ IA v3: "전체 일정"은 지표 탭(캘린더 서브탭)으로 (설계서 v3 1장 구역 5).
                   이전의 '첫 건만 EventCard 강조 + 나머지 별도 ListCard' 이중 구조를
                   행 규격 하나로 통일 — 같은 정보의 표현 변주를 줄입니다(밀도 절제). */}
              <HomeSection
                title={`${t("tabs.home.economicCalendar")} (KST)`}
                action={{
                  label: t("tabs.home.fullSchedule"),
                  onClick: () => { setIndicatorsView("calendar"); setTab("indicators"); },
                }}
                bodyStyle={calRows.length > 0 ? { padding: 0 } : undefined}
              >
                {calRows.length === 0 ? (
                  <div style={{ fontSize: "14px", color: C.text3 }}>{t("tabs.home.noEvents")}</div>
                ) : calRows.map((evt, i) => {
                  const k = kstParts(evt.date);
                  const dayLabel = evt.daysUntil === 0 ? t("tabs.home.today") : evt.daysUntil === 1 ? t("tabs.home.tomorrow")
                    : (k.valid ? `${String(k.month + 1).padStart(2, "0")}.${String(k.date).padStart(2, "0")}` : "—");
                  const hhmm = k.valid ? `${String(k.hour).padStart(2, "0")}:${String(k.min).padStart(2, "0")}` : "--:--";
                  // 트레일링은 1개만(375px 행 넘침 방지 — 기존 로직 유지): 예측치 우선, 없으면 '중요' 배지
                  const tail = evt.estimate != null ? `${t("tabs.home.forecastCol")} ${evt.estimate}${evt.unit}` : "";
                  return (
                    <div key={`${evt.name}-${i}`} style={{
                      display: "flex", alignItems: "center", gap: "10px", padding: "12px 14px",
                      borderBottom: i < calRows.length - 1 ? `1px solid ${C.card2}` : "none",
                    }}>
                      <span style={{
                        fontSize: "11px", fontWeight: 800, padding: "3px 8px", borderRadius: "6px", flexShrink: 0,
                        background: evt.daysUntil === 0 ? `${C.red}1A` : `${C.blue}1A`,
                        color: evt.daysUntil === 0 ? C.redL : C.blueL,
                      }}>{dayLabel}</span>
                      <Num size="12px" weight={600} color={C.text3} style={{ flexShrink: 0 }}>{hhmm}</Num>
                      <span style={{ flex: 1, minWidth: 0, fontSize: "14px", fontWeight: 600, color: C.text1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{evt.icon} {evt.name}</span>
                      {tail ? (
                        <span style={{ fontSize: "12px", color: C.text3, flexShrink: 0 }}>{tail}</span>
                      ) : evt.importance === "high" ? (
                        <span style={{
                          fontSize: "10px", fontWeight: 800, padding: "3px 8px", borderRadius: "9999px",
                          background: `${C.red}1A`, color: C.redL, flexShrink: 0,
                        }}>{t("tabs.home.important")}</span>
                      ) : null}
                    </div>
                  );
                })}
              </HomeSection>

              {/* ── ④ 시장 지표 스냅샷 — 공포·탐욕은 시안 GaugeCard, 온도류는 uiKit IndicatorCard ──
                   ★ IA v3: 지표 허브(게이지 그리드)는 폐지 — 게이지는 이 스냅샷과 코인 탭
                   컨텍스트 구역이 흡수합니다(설계서 v3 4장). 헤더 액션은 코인 탭 1개로
                   통일하고, 게이지 카드 개별 클릭(구 허브 진입)은 목적지가 사라져 뗐습니다. */}
              {hasSnapshot && (
                <HomeSection
                  title={t("tabs.home.marketSnapshot")}
                  action={{
                    label: t("tabs.home.coinIndicatorsLink"),
                    onClick: () => setTab("news"),
                  }}
                >
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    {/* 공포·탐욕 — 주식/크립토 각각 게이지. 값이 없는 쪽은 카드째 빠집니다. */}
                    {(fgVal != null || fgCryptoVal != null) && (
                      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fit, minmax(260px, 1fr))", gap: "10px" }}>
                        {fgVal != null && (
                          <GaugeCard
                            title={t("tabs.home.fgStock")}
                            value={fgVal}
                            label={fgLabelOf(fgVal)}
                            valueColor={fgColorOf(fgVal)}
                            gradient={fgRamp}
                            scaleLeft={`0 ${t("tabs.home.fear")}`}
                            scaleRight={`${t("tabs.home.greed")} 100`}
                          />
                        )}
                        {fgCryptoVal != null && (
                          <GaugeCard
                            title={t("tabs.home.fgCrypto")}
                            value={fgCryptoVal}
                            label={fgLabelOf(fgCryptoVal)}
                            valueColor={fgColorOf(fgCryptoVal)}
                            gradient={fgRamp}
                            scaleLeft={`0 ${t("tabs.home.fear")}`}
                            scaleRight={`${t("tabs.home.greed")} 100`}
                          />
                        )}
                      </div>
                    )}
                    {/* ★ 2026-08-02 주식+코인 양축: 주식 지표(국내증시 온도)와 코인 지표(마켓 온도). */}
                    {(stockIndicator || tempVal != null) && (
                      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fit, minmax(230px, 1fr))", gap: "10px" }}>
                        {stockIndicator && (
                          <IndicatorCard
                            title={stockIndicator.title}
                            value={stockIndicator.value}
                            unit={stockIndicator.unit}
                            label={stockIndicator.label}
                            tone={stockIndicator.tone}
                            desc={stockIndicator.desc}
                            detail={stockIndicator.detail}
                          />
                        )}
                        {tempVal != null && (
                          <IndicatorCard
                            title={t("tabs.home.marketTempCoin")}
                            value={Math.round(tempVal)}
                            unit="°"
                            label={marketTemp.label || "—"}
                            tone={tempToneOf(tempVal)}
                            desc={tempDescOf(tempVal)}
                            updatedAt={tempUpdated}
                          />
                        )}
                      </div>
                    )}
                    {/* ★ 감사 배치3 (고아 페이지): /index/market-temp(마켓 온도 지수 해설·산식,
                        서버 렌더 공개 페이지)는 앱 어디에서도 링크되지 않아 검색엔진으로만
                        도달 가능했습니다 — 게이지가 실제로 표시될 때만 해설 진입점을 병기합니다.
                        (해설 페이지가 /index/alt-heat·/index/funding-squeeze 를 관련 링크로
                        상호 연결하고 있어 이 한 곳으로 지수 해설 3종이 모두 도달 가능해집니다) */}
                    {tempVal != null && (
                      <div style={{ display: "flex", justifyContent: "flex-end" }}>
                        {/* 해설 페이지(서버 렌더 SEO) 진입 — 텍스트 링크 → 칩 (1d 규격) */}
                        <HomeActionChip href="/index/market-temp" label={t("tabs.home.marketTempPageLink")} />
                      </div>
                    )}
                  </div>
                </HomeSection>
              )}

              {/* ── ⑤ 관심종목 요약 (로그인+보유 시) / 인기 종목 (기존 주요종목 데이터 재사용) ──
                   ★ IA v3: 스크리너는 주식 탭 안으로 — 액션은 주식 탭 진입 1개 (설계서 v3 3장). */}
              <HomeSection
                title={watchRows ? t("tabs.home.watchlistSummary") : t("tabs.home.bigMovers")}
                action={{
                  label: t("tabs.home.screenerLink"),
                  onClick: () => setTab("screener"),
                }}
                bodyStyle={(watchRows || popularRows).length > 0 ? { padding: 0 } : undefined}
              >
                {(watchRows || popularRows).length === 0 ? (
                  <div style={{ fontSize: "14px", color: C.text3 }}>{t("tabs.home.loadingQuotes")}</div>
                ) : (
                  <>
                    {(watchRows || popularRows).map((row, i, arr) => {
                      const hot = watchRows ? row.hot : row;
                      const name = row.name || row.symbol;
                      // ★ 2026-08-02 양축 확장: 이모지 하나 대신 시장 구분 배지 (기존 검색 결과 배지 스타일 재사용)
                      const mkt = row.market || hot?.market || "us";
                      const mktLabel = marketBadgeLabel(mkt, t);
                      const chg = hot && Number.isFinite(Number(hot.change)) ? Number(hot.change) : null;
                      // 시안의 38px 심볼 타일 — 글로벌 검색 결과와 같은 규칙
                      // (한국 주식은 숫자 코드라 종목명 앞 2글자, 그 외는 티커 앞 4글자).
                      const iconText = mkt === "kr"
                        ? String(name || "").slice(0, 2)
                        : String(row.symbol || "").slice(0, 4).toUpperCase();
                      const iconColor = mkt === "kr" ? C.green : mkt === "crypto" ? C.purple : C.blue;
                      return (
                        <AssetRow
                          key={row.symbol || i}
                          rank={watchRows ? null : i + 1}
                          icon={iconText || undefined}
                          iconColor={iconColor}
                          name={name}
                          meta={hot ? null : t("tabs.home.quotePreparing")}
                          badge={
                            <span style={{
                              fontSize: "11px", fontWeight: 700, padding: "3px 7px", borderRadius: "6px",
                              background: C.card2, color: C.text3, flexShrink: 0, whiteSpace: "nowrap",
                            }}>{mktLabel}</span>
                          }
                          price={hot ? fmtPrice(hot.price, hot.market || row.market) : null}
                          change={chg}
                          onClick={() => setSelectedAsset(watchRows ? row : hot)}
                          last={i === arr.length - 1}
                        />
                      );
                    })}
                  </>
                )}
              </HomeSection>

              {/* ── Google AdSense (⑤아래 — 기존 홈 슬롯 재배치) ── */}
              <div style={{ minHeight: 0, overflow: "hidden" }}>
                <GoogleAd format="responsive" slot="home-main" style={{ margin: "4px 0" }} />
              </div>

              {/* ── ⑥ 시장 리포트 진입 카드 (카드 전체가 단일 액션 — 키보드 접근 보강) ── */}
              <div onClick={() => setTab("quant-report")}
              role="button" tabIndex={0}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setTab("quant-report"); } }}
              style={{
                ...cardBase, cursor: "pointer", display: "flex", alignItems: "center", gap: "14px",
                background: `linear-gradient(135deg, ${C.card} 0%, ${C.blueBg} 100%)`,
              }}
              onMouseEnter={e => e.currentTarget.style.transform = "translateY(-2px)"}
              onMouseLeave={e => e.currentTarget.style.transform = "translateY(0)"}>
                <div style={{
                  width: "44px", height: "44px", borderRadius: "12px", flexShrink: 0,
                  background: `linear-gradient(135deg, ${C.blue}25, ${C.purple}20)`,
                  display: "flex", alignItems: "center", justifyContent: "center", fontSize: "22px",
                }}>📊</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 800, fontSize: "16px", color: C.text1, marginBottom: "2px" }}>{t("tabs.home.marketReport")}</div>
                  <div style={{ fontSize: "13px", color: C.text3, lineHeight: 1.4 }}>{t("tabs.home.marketReportDesc")}</div>
                </div>
                <span style={{ fontSize: "14px", fontWeight: 700, color: C.blueL, flexShrink: 0 }}>{t("tabs.home.goView")}</span>
              </div>

              {/* ── owner 전용: 매매 콘솔 진입 (구 owner 홈 폐지의 대체 동선) ──
                   일반 사용자에겐 렌더 자체가 없습니다(isOwner 게이트). 홈 → 콘솔 1탭. */}
              {isOwner && (
                <div
                  role="button" tabIndex={0}
                  onClick={() => setTab("real-trading")}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setTab("real-trading"); } }}
                  style={{
                    display: "flex", alignItems: "center", gap: "12px", cursor: "pointer",
                    background: `linear-gradient(180deg, ${C.purpleBg}, transparent 60%), ${C.card}`,
                    border: `1px solid ${C.border}`, borderLeft: `3px solid ${C.purple}`,
                    borderRadius: "16px", padding: "14px 16px",
                  }}>
                  <div style={{
                    width: "44px", height: "44px", borderRadius: "12px", flexShrink: 0,
                    background: `${C.purple}22`, color: C.purpleL,
                    display: "flex", alignItems: "center", justifyContent: "center", fontSize: "20px",
                  }}>🤖</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "7px", marginBottom: "2px" }}>
                      <span style={{ fontWeight: 800, fontSize: "16px", color: C.text1 }}>{t("tabs.home.ownerConsole")}</span>
                      <span style={{
                        fontSize: "10px", fontWeight: 800, padding: "2px 6px", borderRadius: "6px",
                        background: `${C.purple}22`, color: C.purpleL, letterSpacing: ".04em",
                      }}>OWNER</span>
                    </div>
                    <div style={{ fontSize: "13px", color: C.text3, lineHeight: 1.4 }}>{t("tabs.home.ownerConsoleDesc")}</div>
                  </div>
                  <span aria-hidden="true" style={{ fontSize: "17px", color: C.text4, flexShrink: 0 }}>›</span>
                </div>
              )}

              {/* ── 면책 (시안: 모든 정보 화면 끝의 한 줄) ── */}
              <Disclaimer style={{ marginTop: "2px" }}>{t("tabs.home.disclaimer")}</Disclaimer>
            </div>
          );
        })()}

        {/* ★ 2026-08-13 IA v3 (대표 지시 "로그인 후 화면들이 또 다 달라서"):
            owner 전용 홈(구 대시보드 1,578줄)을 폐지하고 홈을 v3 단일 화면으로 통일했습니다.
            로그인 여부는 화면 구조가 아니라 "개인화 섹션 유무"로만 갈립니다(관심종목 등).
            구 owner 홈의 매매 정보는 자동매매 콘솔(RealTrading, 시안 1g)이 수납하며,
            홈·MY 의 owner 전용 진입 카드가 그 목적지로 연결합니다. */}

        {/* ═══════════════════════════════════════════════════════════
            TAB: 스크리너
        ═══════════════════════════════════════════════════════════ */}
        {/* ═══════════════════════════════════════════════════════════
            TAB: 주식 (내부 id "screener") — ★ 2026-08-12 IA v3 (시안 1b · 설계서 v3 3장)
            헤더(제목+신선도 알약) → 장 상태 배지 2칸 → 종목 빠른 검색
            → 주식 시그널 리스트(stock-scores 전 유니버스 · 전체/미국/한국 필터 칩)
            → "조건으로 찾기" 스크리너(프리셋 칩 한 줄 + 조건 편집 시트) → 결과.
            구 버튼 그리드·인라인 details 조건 패널은 전면 대체 — 조건 칩·스캔·저장
            핸들러는 전부 바텀 시트로 이동(기능 보존, 버튼 다이어트).
        ═══════════════════════════════════════════════════════════ */}
        {tab === "screener" && (() => {
          // ── 주식 시그널 리스트 파생 (점수순 고정 — 코인 탭과 같은 문법) ──
          const stockPool = STOCK_SIGNALS_ON && Array.isArray(stockTabSignals) ? stockTabSignals : [];
          const stockRowsAll = stockPool
            .filter(s => s && (s.side === "LONG" || s.side === "SHORT")
              && Number.isFinite(Number(s.score)) && (s.market === "us" || s.market === "kr"))
            .slice()
            .sort((a, b) => Number(b.score) - Number(a.score));
          const stockRows = stockRowsAll.filter(s => stockSigFilter === "all" || s.market === stockSigFilter);
          const stockNewestTs = stockRowsAll.reduce((m, s) => Math.max(m, Number(s?.ts) || 0), 0);
          const stockFresh = coinScoreFreshness(stockNewestTs, t, STALE_MIN_STOCK);
          const STOCK_TF_LABEL = { "1w": t("tabs.coin.tf1w"), "1d": t("tabs.coin.tf1d"), "4h": t("tabs.coin.tf4h"), "1h": t("tabs.coin.tf1h") };
          // ── 장 상태 배지 (marketSessionOf — 정규장 시각 기준, 휴장일 캘린더 미배선) ──
          const krSession = marketSessionOf("Asia/Seoul", 9 * 60, 15 * 60 + 30);
          const usSession = marketSessionOf("America/New_York", 9 * 60 + 30, 16 * 60);
          const fmtDur = (min) => {
            const h = Math.floor(min / 60), m = min % 60;
            return h > 0 ? t("tabs.screener.durHM", { h, m }) : t("tabs.screener.durM", { m });
          };
          const sessionCells = [
            { key: "kr", label: t("tabs.screener.marketKr"), s: krSession },
            { key: "us", label: t("tabs.screener.marketUs"), s: usSession },
          ].filter(c => c.s).map(c => ({
            ...c,
            phaseText: c.s.phase === "open" ? t("tabs.screener.mktOpen")
              : c.s.phase === "pre" ? t("tabs.screener.mktPre")
              : c.s.phase === "weekend" ? t("tabs.screener.mktWeekend")
              : t("tabs.screener.mktClosed"),
            subText: c.s.phase === "open" ? t("tabs.screener.mktToClose", { d: fmtDur(c.s.minsToClose) })
              : c.s.phase === "pre" ? t("tabs.screener.mktToOpen", { d: fmtDur(c.s.minsToOpen) })
              : t("tabs.screener.mktHoursNote"),
            on: c.s.phase === "open",
          }));
          // 조건 편집 칩 라벨 — 스캔 결과가 있으면 실측 종목 수를 병기 (시안 "조건 편집 · N종목")
          const editChipLabel = results.length > 0
            ? t("tabs.screener.editConditionsCount", { n: filtered.length })
            : t("tabs.screener.editConditions");
          return (
          <div className="tab-content">
            {/* ── 헤더 — 시안 1b: 타이틀 + 신선도 알약(실측 ts — 없으면 생략) ── */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", marginBottom: "13px" }}>
              <h1 style={{ margin: 0, fontSize: isMobile ? "22px" : "24px", fontWeight: 800, color: C.text1, letterSpacing: "-0.01em" }}>{t("nav.stocks")}</h1>
              {stockFresh && (
                <span style={{
                  fontSize: mf(11), fontWeight: 800, padding: "6px 11px", borderRadius: "9999px",
                  background: `${C.blue}1F`, color: C.isDark ? C.blueL : C.blue, whiteSpace: "nowrap", flexShrink: 0,
                }}>↻ {stockFresh}</span>
              )}
            </div>

            {/* ── 장 상태 배지 2칸 (시안 1b) — 시계 기반 결정적 산출, Intl 실패 시 생략 ── */}
            {sessionCells.length > 0 && (
              <div style={{ display: "flex", gap: "8px", marginBottom: "13px" }}>
                {sessionCells.map(c => (
                  <div key={c.key} style={{
                    flex: 1, display: "flex", alignItems: "center", gap: "8px", minWidth: 0,
                    background: C.card, border: `1px solid ${C.border}`, borderRadius: "12px", padding: "10px 12px",
                  }}>
                    <span className={c.on ? "z-pulse" : undefined} aria-hidden="true" style={{
                      width: "7px", height: "7px", borderRadius: "50%", flexShrink: 0,
                      background: c.on ? C.green : C.border2,
                    }} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: mf(12), fontWeight: 800, color: C.text1, whiteSpace: "nowrap" }}>{c.label} {c.phaseText}</div>
                      <div style={{ fontSize: mf(10), color: C.text3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.subText}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {/* ★ 휴장일 캘린더 미배선 고지 — 장중/개장전 분기에서도 항상 보이게 배지 아래 상시 노출.
                 (분기별 subText 안에만 두면 정작 오표기가 나는 공휴일 낮에 안 보였습니다 — 적대 리뷰 지적) */}
            {sessionCells.length > 0 && (
              <div style={{ fontSize: mf(10), color: C.text4, marginTop: "-8px", marginBottom: "13px" }}>
                {t("tabs.screener.mktHoursNote")}
              </div>
            )}

            {/* ── 종목 빠른 검색 — 사이트링크 검색박스(?q=) 실연동 진입점 ──
                 ★ 2026-08 모바일 시안 Discover 패턴: 카드 배경 + 돋보기 아이콘(SVG).
                 값·검색 로직은 그대로, 표현만 시안에 맞췄습니다. */}
            <div style={{ marginBottom: "16px" }}>
              <div style={{ position: "relative" }}>
                <span style={{
                  position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)",
                  color: C.text3, pointerEvents: "none", display: "flex", alignItems: "center",
                }} aria-hidden="true">
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="11" cy="11" r="7" /><line x1="16.5" y1="16.5" x2="21" y2="21" />
                  </svg>
                </span>
                <input
                  value={assetQuery}
                  onChange={(e) => setAssetQuery(e.target.value.slice(0, 40))}
                  placeholder={t("tabs.screener.searchPlaceholder")}
                  aria-label={t("tabs.screener.searchAria")}
                  style={{
                    width: "100%", boxSizing: "border-box", padding: "13px 38px 13px 42px", borderRadius: 14,
                    background: C.card, border: `1px solid ${C.border}`, color: C.text1, fontSize: mf(15), outline: "none",
                  }}
                  onFocus={(e) => { e.currentTarget.style.borderColor = C.blue; }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = C.border; }}
                />
                {assetQuery && (
                  <button onClick={() => setAssetQuery("")} aria-label={t("tabs.screener.clearSearch")} style={{
                    position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)",
                    background: "none", border: "none", color: C.text3, fontSize: 18, cursor: "pointer", lineHeight: 1, padding: 4,
                  }}>✕</button>
                )}
              </div>
              {assetQuery.trim() && (() => {
                const q = assetQuery.toLowerCase().trim();
                const matches = ALL_ASSETS.filter((a) => a.searchKey.includes(q)).slice(0, 24);
                if (matches.length === 0) {
                  return <div style={{ marginTop: 10, padding: "14px", textAlign: "center", fontSize: mf(14), color: C.text3, background: C.card, border: `1px solid ${C.border}`, borderRadius: 12 }}>
                    {t("tabs.screener.searchNoMatch", { q: assetQuery })}
                  </div>;
                }
                const marketLabel = { us: t("tabs.news.catUs"), kr: t("tabs.news.catKr"), crypto: t("tabs.news.catCrypto") };
                return (
                  <div style={{ marginTop: 10 }}>
                    <div style={{ fontSize: mf(13), color: C.text3, marginBottom: 8 }}>{t("tabs.screener.searchResultMeta", { q: assetQuery, n: matches.length })}</div>
                    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill, minmax(220px, 1fr))", gap: 8 }}>
                      {matches.map((a) => (
                        <button key={`${a.market}-${a.symbol}`} onClick={() => setSelectedAsset(a)} style={{
                          display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", textAlign: "left",
                          background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, cursor: "pointer", minHeight: 48,
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.borderColor = C.blue; }}
                        onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.border; }}>
                          <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 6, background: C.card2, color: C.text3, flexShrink: 0 }}>{marketLabel[a.market] || a.market}</span>
                          <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                            <span style={{ fontSize: mf(14), fontWeight: 700, color: C.text1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.symbol}</span>
                            <span style={{ fontSize: mf(12), color: C.text3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.koName || a.name}</span>
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* ── 주식 시그널 (시안 1b — stock-scores 전 유니버스, 점수순 고정) ──
                 홈 미리보기(3개)와 달리 전체 풀을 보여주는 유일한 위치입니다(설계서 v3 3장).
                 킬스위치 VITE_ZEPTA_STOCK_SIGNALS=0 이면 섹션째 사라집니다. */}
            {STOCK_SIGNALS_ON && (
              <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "18px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "7px" }}>
                  {/* 주식 스코어는 장 마감 후 마지막 장중 데이터가 유지되는 설계라 실시간 펄스
                      점을 켜지 않습니다(홈과 동일 원칙) — 신선도는 상단 알약이 전달합니다. */}
                  <h2 style={{ margin: 0, fontSize: mf(14), fontWeight: 800, color: C.text1, whiteSpace: "nowrap" }}>{t("tabs.screener.signalsTitle")}</h2>
                  <span style={{ flex: 1 }} />
                  {/* 정렬은 점수순 고정 — 상태 서술 알약(죽은 드롭다운을 두지 않습니다) */}
                  {stockRows.length > 0 && (
                    <span style={{
                      fontSize: mf(11), fontWeight: 800, padding: "5px 11px", borderRadius: "9999px",
                      background: C.card, border: `1px solid ${C.border}`, color: C.text3, whiteSpace: "nowrap",
                    }}>{t("tabs.screener.sortByScore")}</span>
                  )}
                </div>
                {/* [전체|미국|한국] 필터 칩 — 건수는 실제 풀에서 집계 (mobileKit Segment) */}
                {stockRowsAll.length > 0 && (
                  <Segment
                    value={stockSigFilter}
                    onChange={setStockSigFilter}
                    options={[
                      { value: "all", label: t("tabs.screener.sigAll"), count: stockRowsAll.length },
                      { value: "us", label: t("tabs.screener.marketUs"), count: stockRowsAll.filter(s => s.market === "us").length },
                      { value: "kr", label: t("tabs.screener.marketKr"), count: stockRowsAll.filter(s => s.market === "kr").length },
                    ]}
                  />
                )}
                {stockRowsAll.length === 0 ? (
                  stockTabStatus === "loading" || stockTabStatus === "idle" ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: "9px" }}>
                      {[0, 1, 2].map(i => <Skeleton key={`stk-skel-${i}`} width="100%" height="72px" />)}
                    </div>
                  ) : (
                    /* 빈 상태 — 집계 전·전체 실패 공용. 문구는 실제 산출 주기(크론 30~60분) 서술 */
                    <div style={{ border: `1.5px dashed ${C.border2}`, borderRadius: "16px", padding: "30px 24px", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: "6px" }}>
                      <div style={{ fontSize: mf(15), fontWeight: 800, color: C.text1 }}>{t("tabs.screener.sigEmptyTitle")}</div>
                      <div style={{ fontSize: mf(12), color: C.text3, lineHeight: 1.6, maxWidth: "260px" }}>{t("tabs.screener.sigEmptyDesc")}</div>
                      <button onClick={fetchStockTabSignals} style={{
                        marginTop: "10px", padding: "11px 18px", borderRadius: "12px",
                        background: `${C.blue}1F`, color: C.isDark ? C.blueL : C.blue, border: "none",
                        fontSize: mf(13), fontWeight: 800, fontFamily: "inherit", cursor: "pointer", minHeight: "44px",
                      }}>{t("tabs.coin.retry")}</button>
                    </div>
                  )
                ) : (
                  <div style={isMobile
                    ? { display: "flex", flexDirection: "column", gap: "9px" }
                    : { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: "10px", alignItems: "start" }}>
                    {stockRows.map((sig, i) => {
                      const dir = sig.side === "LONG" ? "up" : "down";
                      const bd = sig.breakdown || {};
                      // 주식 breakdown 은 4h 가 없을 수 있어 응답에 있는 키만 칩으로 (홈과 동일 규칙)
                      const tfs = Object.keys(STOCK_TF_LABEL).filter(k => bd[k] != null).map(tf => ({
                        label: STOCK_TF_LABEL[tf],
                        dir: bd[tf]?.side === "LONG" ? "up" : bd[tf]?.side === "SHORT" ? "down" : null,
                      }));
                      const sup = fmtLevelPrice(sig.sr?.s?.[0]?.p);
                      const res = fmtLevelPrice(sig.sr?.r?.[0]?.p);
                      const px = (sup || res) ? fmtLevelPrice(sig.sr?.px) : null;
                      // KRX 는 6자리 코드 대신 종목명(마스터에 있으면), 미국은 티커 그대로 (홈과 동일)
                      const symText = sig.market === "kr"
                        ? (KR_NAME_BY_CODE[String(sig.symbol || "").replace(/\.(KS|KQ)$/i, "")]
                          || String(sig.symbol || "—").replace(/\.(KS|KQ)$/i, ""))
                        : String(sig.symbol || "—");
                      return (
                        <SignalCard
                          key={`${sig.symbol || "sig"}-${i}`}
                          symbol={symText}
                          // 주식은 현물이라 롱/숏 대신 상승/하락 우위로 서술 (표현 3원칙 — 홈과 동일)
                          sideLabel={t(sig.side === "LONG" ? "tabs.home.upDominant" : "tabs.home.downDominant")}
                          dir={dir}
                          score={Math.round(Math.max(0, Math.min(100, Number(sig.score))))}
                          timeframes={tfs.some(x => x.dir) ? tfs : []}
                          support={sup}
                          price={px}
                          resistance={res}
                          onClick={() => setDetailSignal(sig)}
                        />
                      );
                    })}
                  </div>
                )}
                {/* 필터 결과 0건 — 풀은 있으나 선택 시장에 시그널이 없는 경우(칩 건수와 일치) */}
                {stockRowsAll.length > 0 && stockRows.length === 0 && (
                  <div style={{ fontSize: mf(12), color: C.text3, textAlign: "center", padding: "14px 0" }}>
                    {t("tabs.screener.sigFilterEmpty")}
                  </div>
                )}
                {stockRows.length > 0 && (
                  <div style={{ fontSize: mf(11), color: C.text4 }}>
                    {/* 신선도(실측 ts)는 헤더 알약이 전달 — 여기는 출처만 서술해 이중 노출을 피합니다 */}
                    {t("tabs.home.stockSignalSourceNote")}
                  </div>
                )}
              </div>
            )}

            {/* ── 조건으로 찾기 (스크리너) — 시안 1b: 프리셋 칩 한 줄 + "조건 편집" 버튼 1개.
                 구 2열 프리셋 버튼 그리드 + 인라인 상세 조건 패널 전면 대체(버튼 다이어트).
                 프리셋 클릭 → 조건 주입 → 기존 자동 스캔 effect 가 즉시 실행(제로 클릭 결과). */}
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "16px", overflow: "hidden", marginBottom: "13px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "7px", minHeight: "46px", padding: "8px 14px", borderBottom: `1px solid ${C.card2}` }}>
                <h2 style={{ margin: 0, fontSize: "15px", fontWeight: 800, color: C.text1, whiteSpace: "nowrap" }}>{t("tabs.screener.findByCondition")}</h2>
                <span style={{ flex: 1 }} />
                <HomeActionChip label={editChipLabel} onClick={() => setCondSheetOpen(true)} />
              </div>
              {/* 프리셋 칩 한 줄 — 가로 스크롤. 핸들러는 구 그리드와 동일(토글 + 조건·모드 주입) */}
              <div style={{ display: "flex", gap: "6px", overflowX: "auto", padding: "12px 14px", WebkitOverflowScrolling: "touch" }}>
                {SCREENER_PRESETS.map(preset => {
                  const isActive = activePreset === preset.id;
                  return (
                    <button key={preset.id} title={t(`diag.presets.${preset.id}.desc`)} onClick={() => {
                      if (isActive) {
                        setActivePreset(null);
                        setConditions([]);
                        setMode("or");
                      } else {
                        setActivePreset(preset.id);
                        setConditions(preset.conditions);
                        setMode(preset.mode);
                      }
                    }} style={{
                      flexShrink: 0, padding: "8px 14px", borderRadius: "9999px", minHeight: "36px",
                      fontSize: mf(12), fontWeight: isActive ? 800 : 700, fontFamily: "inherit", cursor: "pointer",
                      background: isActive ? C.blue : C.card2, color: isActive ? "#fff" : C.text2,
                      border: `1px solid ${isActive ? C.blue : C.border}`, whiteSpace: "nowrap",
                    }}>{preset.icon} {t(`diag.presets.${preset.id}.name`)}</button>
                  );
                })}
              </div>
              {/* 스캔 진행률 — 프리셋 자동 스캔·시트 스캔 공용 (실측 done/total) */}
              {scanning && (
                <div style={{ padding: "0 14px 12px" }}>
                  <div style={{ fontSize: mf(11), color: C.text3, fontWeight: 700, marginBottom: "6px" }}>
                    {t("tabs.screener.scanning")} {scanProgress.done}/{scanProgress.total}
                  </div>
                  <div style={{ height: "4px", background: C.border2, borderRadius: "4px", overflow: "hidden" }}>
                    <div style={{ height: "100%", background: C.blue, borderRadius: "4px", width: `${scanProgress.total ? (scanProgress.done / scanProgress.total) * 100 : 0}%`, transition: "width .3s" }} />
                  </div>
                </div>
              )}
            </div>

            {/* ── 조건 편집 바텀 시트 (시안 1b) — 구 인라인 details 조건 패널을 시트로
                 이동했습니다. 조건 칩 토글·OR/AND·스캔·조건 저장·오류 목록 핸들러 전부
                 보존 — 화면 상시 점유만 제거(버튼 다이어트). ── */}
            <BottomSheet
              open={condSheetOpen}
              onClose={() => setCondSheetOpen(false)}
              title={t("tabs.screener.editConditions")}
              description={conditions.length > 0 ? `${conditions.length}${t("tabs.screener.conditionsApplied")}` : t("tabs.screener.selectConditions")}
              footer={
                <div style={{ display: "flex", gap: "9px" }}>
                  <button onClick={() => { setConditions([]); setActivePreset(null); setMode("or"); }} style={{
                    height: "46px", padding: "0 18px", borderRadius: "12px", background: "transparent",
                    border: `1px solid ${C.border2}`, color: C.text2, fontSize: mf(14), fontWeight: 700,
                    fontFamily: "inherit", cursor: "pointer",
                  }}>{t("tabs.screener.reset")}</button>
                  {/* 적용 = 기존 runScan — 시트를 닫고 스캔 시작(진행률은 스크리너 카드가 표시) */}
                  <button onClick={() => { setCondSheetOpen(false); runScan(); }} disabled={scanning || conditions.length === 0} style={{
                    flex: 1, height: "46px", borderRadius: "12px", border: "none",
                    background: scanning || conditions.length === 0 ? C.card2 : C.blue,
                    color: scanning || conditions.length === 0 ? C.text3 : "#fff",
                    fontSize: mf(14), fontWeight: 800, fontFamily: "inherit",
                    cursor: scanning || conditions.length === 0 ? "not-allowed" : "pointer",
                  }}>
                    {scanning ? `${scanProgress.done}/${scanProgress.total}` : t("tabs.screener.applyScan", { n: conditions.length })}
                  </button>
                </div>
              }
            >
            <div style={{ padding: "2px 2px 10px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", marginBottom: "12px" }}>
                <div style={{ display: "flex", gap: "6px" }}>
                  {["or", "and"].map(m => (
                    <button key={m} onClick={() => setMode(m)} style={{
                      padding: "6px 14px", borderRadius: "8px", fontSize: mf(16), fontWeight: 700, minHeight: "36px",
                      background: mode === m ? C.blue : C.card2, color: mode === m ? "#fff" : C.text3,
                      border: `1px solid ${mode === m ? C.blue : C.border2}`,
                    }}>{m.toUpperCase()}</button>
                  ))}
                </div>
              </div>

              {/* {t("tabs.screener.momentum")} */}
              <div style={{ fontSize: "15px", color: C.text3, fontWeight: 600, letterSpacing: ".05em", marginBottom: "8px", marginTop: "12px" }}>{t("tabs.screener.momentum")}</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "7px", marginBottom: "14px" }}>
                {["rsi_extreme","macd_divergence","rsi_divergence","mtf_rsi_oversold","mtf_rsi_overbought","ma_ribbon","adx_trend","adx_bullish","adx_bearish"].map(key => {
                  const meta = CONDITION_META[key];
                  const on = conditions.includes(key);
                  return (
                    <button key={key} onClick={() => setConditions(p => on ? p.filter(c => c !== key) : [...p, key])}
                      title={meta?.desc} style={{
                        padding: isMobile ? "10px 12px" : "8px 12px", borderRadius: "10px", fontSize: mf(13), fontWeight: 600, minHeight: "44px", display: "flex", alignItems: "center", gap: "6px",
                        background: on ? `linear-gradient(135deg, ${C.blue}40 0%, ${C.blue}20 100%)` : C.card2,
                        color: on ? C.blue : C.text3,
                        border: `1px solid ${on ? C.blue : C.border2}`,
                        transition: "all 0.2s ease",
                      }}
                      onMouseEnter={e => { if (!on) e.currentTarget.style.borderColor = C.blue; }}
                      onMouseLeave={e => { if (!on) e.currentTarget.style.borderColor = C.border2; }}
                    >{meta?.icon} {meta?.label}</button>
                  );
                })}
              </div>

              {/* {t("tabs.screener.volatility")} */}
              <div style={{ fontSize: "15px", color: C.text3, fontWeight: 600, letterSpacing: ".05em", marginBottom: "8px", marginTop: "12px" }}>{t("tabs.screener.volatility")}</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "7px", marginBottom: "14px" }}>
                {["bb_squeeze","atr_breakout","price_channel","gap_signal"].map(key => {
                  const meta = CONDITION_META[key];
                  const on = conditions.includes(key);
                  return (
                    <button key={key} onClick={() => setConditions(p => on ? p.filter(c => c !== key) : [...p, key])}
                      title={meta?.desc} style={{
                        padding: isMobile ? "10px 12px" : "8px 12px", borderRadius: "10px", fontSize: mf(13), fontWeight: 600, minHeight: "44px", display: "flex", alignItems: "center", gap: "6px",
                        background: on ? `linear-gradient(135deg, ${C.red}40 0%, ${C.red}20 100%)` : C.card2,
                        color: on ? C.red : C.text3,
                        border: `1px solid ${on ? C.red : C.border2}`,
                        transition: "all 0.2s ease",
                      }}
                      onMouseEnter={e => { if (!on) e.currentTarget.style.borderColor = C.red; }}
                      onMouseLeave={e => { if (!on) e.currentTarget.style.borderColor = C.border2; }}
                    >{meta?.icon} {meta?.label}</button>
                  );
                })}
              </div>

              {/* {t("tabs.screener.volume")} */}
              <div style={{ fontSize: "15px", color: C.text3, fontWeight: 600, letterSpacing: ".05em", marginBottom: "8px", marginTop: "12px" }}>{t("tabs.screener.volume")}</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "7px", marginBottom: "14px" }}>
                {["volume_climax","obv_divergence","volume_dry","cmf_accumulation","cmf_distribution","mfi_oversold","mfi_overbought"].map(key => {
                  const meta = CONDITION_META[key];
                  const on = conditions.includes(key);
                  const volColor = on ? C.green : C.text3;
                  return (
                    <button key={key} onClick={() => setConditions(p => on ? p.filter(c => c !== key) : [...p, key])}
                      title={meta?.desc} style={{
                        padding: isMobile ? "10px 12px" : "8px 12px", borderRadius: "10px", fontSize: mf(13), fontWeight: 600, minHeight: "44px", display: "flex", alignItems: "center", gap: "6px",
                        background: on ? `linear-gradient(135deg, ${C.green}40 0%, ${C.green}20 100%)` : C.card2,
                        color: volColor,
                        border: `1px solid ${on ? C.green : C.border2}`,
                        transition: "all 0.2s ease",
                      }}
                      onMouseEnter={e => { if (!on) e.currentTarget.style.borderColor = C.green; }}
                      onMouseLeave={e => { if (!on) e.currentTarget.style.borderColor = C.border2; }}
                    >{meta?.icon} {meta?.label}</button>
                  );
                })}
              </div>

              {/* 구조적 시그널 — i18n 키(tabs.screener.structural) 기존 보유분 연결 */}
              <div style={{ fontSize: "15px", color: C.text3, fontWeight: 600, letterSpacing: ".05em", marginBottom: "8px", marginTop: "12px" }}>{t("tabs.screener.structural")}</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "7px", marginBottom: "18px" }}>
                {["near_52w_low","near_52w_high","death_cross","golden_cross","mean_reversion","near_poc"].map(key => {
                  const meta = CONDITION_META[key];
                  const on = conditions.includes(key);
                  return (
                    <button key={key} onClick={() => setConditions(p => on ? p.filter(c => c !== key) : [...p, key])}
                      title={meta?.desc} style={{
                        padding: isMobile ? "10px 12px" : "8px 12px", borderRadius: "10px", fontSize: mf(13), fontWeight: 600, minHeight: "44px", display: "flex", alignItems: "center", gap: "6px",
                        background: on ? `linear-gradient(135deg, ${C.purple}40 0%, ${C.purple}20 100%)` : C.card2,
                        color: on ? C.purple : C.text3,
                        border: `1px solid ${on ? C.purple : C.border2}`,
                        transition: "all 0.2s ease",
                      }}
                      onMouseEnter={e => { if (!on) e.currentTarget.style.borderColor = C.purple; }}
                      onMouseLeave={e => { if (!on) e.currentTarget.style.borderColor = C.border2; }}
                    >{meta?.icon} {meta?.label}</button>
                  );
                })}
              </div>

              {conditions.length === 0 && !scanning && !results.length && (
                <div style={{
                  textAlign: "center", padding: "14px", borderRadius: "10px", marginBottom: "10px",
                  background: C.blueBg, border: `1px solid ${C.blue}33`, fontSize: mf(13), color: C.isDark ? C.blueL : C.blue,
                }}>
                  💡 {t("tabs.screener.selectConditionsHint")}
                </div>
              )}
              {/* 스캔 버튼은 시트 footer("스캔 · 조건 N개")로 일원화 — 여기는 보조 액션(저장)만 */}
              {conditions.length > 0 && !scanning && (
                <button onClick={saveCurrentScreener} title={t("tabs.screener.saveConditionsTitle")} style={{
                  width: "100%", padding: "12px 14px", borderRadius: "12px", fontSize: mf(14), fontWeight: 700,
                  background: "transparent", color: C.isDark ? C.blueL : C.blue, border: `1px solid ${C.blue}55`, minHeight: "46px", cursor: "pointer",
                  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "6px", whiteSpace: "nowrap", fontFamily: "inherit",
                }}
                onMouseEnter={e => { e.currentTarget.style.background = `${C.blue}14`; }}
                onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}>
                  💾 {t("tabs.screener.saveConditions")}
                </button>
              )}

              {scanErrors.length > 0 && (
                <details style={{ marginTop: "10px" }}>
                  <summary style={{ fontSize: mf(13), color: C.text3, cursor: "pointer" }}>⚠️ {t("tabs.screener.errorsCount", { n: scanErrors.length })}</summary>
                  <div style={{ marginTop: "6px", fontSize: mf(12), color: C.red, lineHeight: 1.6, maxHeight: "80px", overflow: "auto" }}>
                    {scanErrors.map((e, i) => <div key={i}>{e}</div>)}
                  </div>
                </details>
              )}
            </div>
            </BottomSheet>

            {/* 결과 필터 — 모바일: 필터 가로 스크롤 + 정렬은 ActionSheet 트리거 */}
            {results.length > 0 && (() => {
              const sortOptions = [
                { v: "score", l: t("tabs.screener.sortScore") }, { v: "rsi", l: "RSI" },
                { v: "change", l: t("tabs.screener.sortChange") }, { v: "vol", l: t("tabs.screener.sortVolume") },
                { v: "signals", l: t("tabs.screener.sortSignals") },
              ];
              const curSort = sortOptions.find(o => o.v === sortBy);
              // ★ 2026-08 모바일 시안: 시장 필터를 mobileKit Segment 로 교체.
              //   값(all/stock/us/kr/crypto)·필터 로직(matchMarketFilter)은 그대로,
              //   각 칸의 건수는 정렬된 결과에서 실제로 세어 표시합니다.
              const MARKET_SEG_LABEL = { all: t("diag.seg.all"), stock: t("diag.seg.stock"), us: t("diag.market.us"), kr: t("diag.market.kr"), crypto: t("diag.seg.crypto") };
              // ★ IA v3 정합(대표 "짬뽕 금지"): 주식 탭에서는 코인 세그먼트를 노출하지 않습니다.
              //   코인 조건 검색은 코인 탭의 "조건으로 코인 찾기" 진입점이 담당 — 기능 이동이지 제거 아님.
              //   (필터 로직 matchMarketFilter·값 자체는 그대로라 코인 탭 진입 시 crypto 필터가 정상 동작)
              const STOCK_SEG_FILTERS = MARKET_FILTERS.filter(m => m !== "crypto" && m !== "all");
              const marketSegOptions = STOCK_SEG_FILTERS.map(m => ({
                value: m,
                label: MARKET_SEG_LABEL[m] || m,
                count: sortedResults.filter(a => matchMarketFilter(a, m)).length,
              }));
              // ★ 2026-08 시안 1f: 결과 헤더 — 활성 프리셋 이름 + 조건 충족 종목 수 + 마지막 갱신 (전부 실데이터)
              const presetMeta = SCREENER_PRESETS.find(p => p.id === activePreset) || null;
              const presetColor = presetMeta
                ? (presetMeta.color === "green" ? C.green : presetMeta.color === "blue" ? C.blue : presetMeta.color === "red" ? C.red : presetMeta.color === "yellow" ? C.yellow : C.purple)
                : C.blue;
              return (
                <div style={{ marginBottom: "12px", display: "flex", flexDirection: "column", gap: "10px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <span style={{
                      width: "34px", height: "34px", borderRadius: "10px", background: `${presetColor}1A`, color: presetColor,
                      display: "flex", alignItems: "center", justifyContent: "center", fontSize: "15px", fontWeight: 800, flexShrink: 0,
                    }}>{presetMeta?.icon || "🔍"}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: isMobile ? "17px" : "18px", fontWeight: 800, color: C.text1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{presetMeta ? t(`diag.presets.${presetMeta.id}.name`) : t("diag.scanResults")}</div>
                      <div style={{ fontSize: "11px", color: C.text3 }}>
                        {t("diag.matchedCount", { n: filtered.length })}{lastScan ? ` · ${t("diag.lastUpdatedAt", { time: lastScan.toLocaleTimeString(lang === "en" ? "en-US" : "ko-KR", { hour: "2-digit", minute: "2-digit" }) })}` : ""}
                      </div>
                    </div>
                    {isMobile && (
                      // 모바일: 정렬을 ActionSheet 트리거 단일 버튼으로 압축 (가로 폭 절약)
                      <button onClick={() => setSortSheetOpen(true)} style={{
                        padding: "6px 11px", borderRadius: 9999, fontSize: mf(11), fontWeight: 700,
                        background: C.card, color: C.text3, border: `1px solid ${C.border}`,
                        display: "inline-flex", alignItems: "center", gap: 5, minHeight: 32, flexShrink: 0, whiteSpace: "nowrap", cursor: "pointer",
                      }}>
                        <span style={{ color: C.blueL || C.blue, fontWeight: 800 }}>{t("tabs.screener.sortBySuffix", { label: curSort?.l || "—" })}</span>
                        <span style={{ fontSize: 9, color: C.text3 }}>▼</span>
                      </button>
                    )}
                  </div>
                  <Segment options={marketSegOptions} value={filterMarket} onChange={setFilterMarket} />
                  {!isMobile && (
                    <div style={{ display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" }}>
                      <span style={{ fontSize: "11px", color: C.text3, fontWeight: 700 }}>{t("tabs.screener.sortLabel")}</span>
                      {sortOptions.map(({ v, l }) => (
                        <button key={v} onClick={() => setSortBy(v)} style={{
                          padding: "6px 12px", borderRadius: "9999px", fontSize: "12px", fontWeight: 700,
                          background: sortBy === v ? `${C.blue}1F` : C.card, color: sortBy === v ? (C.blueL || C.blue) : C.text3,
                          border: `1px solid ${sortBy === v ? `${C.blue}59` : C.border}`, cursor: "pointer", transition: "all .15s",
                        }}>{l}{sortBy === v ? " ▼" : ""}</button>
                      ))}
                    </div>
                  )}
                  {/* 정렬 ActionSheet — 모바일 전용 */}
                  {isMobile && (
                    <ActionSheet
                      open={sortSheetOpen}
                      onClose={() => setSortSheetOpen(false)}
                      title={t("tabs.screener.sortSheetTitle")}
                      value={sortBy}
                      items={sortOptions.map(({ v, l }) => ({
                        id: v, label: l, onSelect: () => setSortBy(v),
                      }))}
                    />
                  )}
                </div>
              );
            })()}

            {/* 대기 상태 + 조건 완화 추천 (DEV-IMPL 2026-05-12) — ★ 2026-08 시안 1f 빈 상태 문법(점선 컨테이너 + 아이콘 타일) */}
            {!scanning && results.length === 0 && (
              <div style={{ border: `1.5px dashed ${C.border2}`, borderRadius: "16px", padding: "36px 24px", textAlign: "center" }}>
                <div style={{
                  width: "52px", height: "52px", borderRadius: "16px", background: C.card2, color: C.text3,
                  display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto", fontSize: "22px",
                }} aria-hidden="true">{lastScan ? (
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
                ) : "📡"}</div>
                <div style={{ fontWeight: 800, fontSize: mf(15), margin: "14px 0 6px", color: C.text1 }}>
                  {lastScan ? t("tabs.screener.noMatchTitle") : t("tabs.screener.idleTitle")}
                </div>
                <div style={{ color: C.text3, fontSize: mf(13), lineHeight: 1.6, maxWidth: "280px", margin: "0 auto" }}>
                  {lastScan ? (
                    <>{t("tabs.screener.noMatchDesc1")}<br />{t("tabs.screener.noMatchDesc2")}</>
                  ) : (
                    /* 새 플로우 안내(시안 1b): 프리셋 칩 = 즉시 스캔 · 세부 조정은 조건 편집 시트.
                       자산 수는 실제 유니버스 합계(하드코딩 아님). */
                    t("tabs.screener.idleDesc", { n: US_ASSETS.length + KR_ASSETS.length + CRYPTO_ASSETS.length })
                  )}
                </div>

                {/* ── 조건 완화 추천 (lastScan 이후, results 0건일 때만) ── */}
                {lastScan && (
                  <div style={{
                    marginTop: "20px",
                    display: "flex", flexDirection: "column", gap: "8px",
                    maxWidth: "360px", margin: "20px auto 0",
                  }}>
                    {/* 진단 1: AND 모드 + 조건 다수 → OR 모드로 전환 */}
                    {mode === "and" && conditions.length >= 2 && (
                      <button
                        onClick={() => setMode("or")}
                        style={{
                          padding: "12px 16px", borderRadius: "12px", fontSize: mf(15), fontWeight: 700,
                          background: C.blueBg, color: C.blue,
                          border: `1px solid ${C.blue}40`, cursor: "pointer",
                          textAlign: "left", display: "flex", alignItems: "center", gap: "8px",
                          minHeight: "44px",
                        }}
                      >
                        <span>🔀</span>
                        <span>{t("tabs.screener.relaxToOr")}</span>
                      </button>
                    )}
                    {/* 진단 2: 조건이 4개 이상 → 절반으로 줄이기 */}
                    {conditions.length >= 4 && (
                      <button
                        onClick={() => setConditions(prev => prev.slice(0, Math.ceil(prev.length / 2)))}
                        style={{
                          padding: "12px 16px", borderRadius: "12px", fontSize: mf(15), fontWeight: 700,
                          background: C.purpleBg, color: C.purple,
                          border: `1px solid ${C.purple}40`, cursor: "pointer",
                          textAlign: "left", display: "flex", alignItems: "center", gap: "8px",
                          minHeight: "44px",
                        }}
                      >
                        <span>✂️</span>
                        <span>{t("tabs.screener.relaxHalve", { from: conditions.length, to: Math.ceil(conditions.length / 2) })}</span>
                      </button>
                    )}
                    {/* 진단 3: 시장 필터가 적용중 → 전체로 확장 */}
                    {filterMarket !== "all" && (
                      <button
                        onClick={() => setFilterMarket("all")}
                        style={{
                          padding: "12px 16px", borderRadius: "12px", fontSize: mf(15), fontWeight: 700,
                          background: C.greenBg || `${C.green}15`, color: C.green,
                          border: `1px solid ${C.green}40`, cursor: "pointer",
                          textAlign: "left", display: "flex", alignItems: "center", gap: "8px",
                          minHeight: "44px",
                        }}
                      >
                        <span>🌍</span>
                        <span>{t("tabs.screener.relaxMarket")}</span>
                      </button>
                    )}
                    {/* 진단 4: 조건 1개 이상 → 전체 초기화 fallback */}
                    {conditions.length > 0 && (
                      <button
                        onClick={() => { setConditions([]); setActivePreset(null); }}
                        style={{
                          padding: "12px 16px", borderRadius: "12px", fontSize: mf(14), fontWeight: 600,
                          background: "transparent", color: C.text3,
                          border: `1px solid ${C.border}`, cursor: "pointer",
                          minHeight: "44px",
                        }}
                      >
                        {t("tabs.screener.resetAllConditions")}
                      </button>
                    )}
                    {/* 진단 5: 모든 진단이 false 인 경우 — 기본 안내 */}
                    {mode === "or" && conditions.length < 2 && filterMarket === "all" && (
                      <div style={{
                        padding: "12px 16px", borderRadius: "12px",
                        background: `${C.yellow}15`, color: C.text2,
                        border: `1px solid ${C.yellow}40`,
                        fontSize: mf(14), fontWeight: 600,
                        textAlign: "center",
                      }}>
                        💡 {t("tabs.screener.relaxFallback")}
                      </div>
                    )}
                  </div>
                )}

                {lastScan && (
                  <div style={{ fontSize: "16px", color: C.text3, marginTop: "12px" }}>
                    {t("tabs.screener.lastScanAt", { time: lastScan.toLocaleTimeString(lang === "en" ? "en-US" : "ko-KR") })}
                    {scanErrors.length > 0 && <span style={{ color: C.yellow, marginLeft: "8px" }}>⚠️ {t("tabs.screener.errorsCount", { n: scanErrors.length })}</span>}
                  </div>
                )}
              </div>
            )}

            {/* ★ 2026-08 시안 1f: 데스크탑 = 정렬 테이블(ListCard) / 모바일 = 카드 리스트.
                정렬·필터·행 펼침 진단 등 로직은 그대로 — 표현만 교체했습니다. */}
            {isMobile ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "9px" }}>
                {filtered.map((asset, i) => (
                  <AssetCard key={`${asset.symbol}-${i}`} asset={asset} onChart={() => setChartAsset(asset)} isMobile={isMobile} />
                ))}
              </div>
            ) : filtered.length > 0 && (
              <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "16px", overflow: "hidden" }}>
                {/* 헤더 행 — 정렬 가능한 컬럼(등락→change · 신호 요약→signals · 점수→score)은 클릭 배선 */}
                <div style={{
                  display: "grid", gridTemplateColumns: "2fr 1fr .9fr 1.1fr 1.2fr", alignItems: "center",
                  padding: "11px 18px", borderBottom: `1px solid ${C.border}`,
                  fontSize: "11px", fontWeight: 800, color: C.text3, letterSpacing: ".05em",
                }}>
                  <span>{t("tabs.screener.colAsset")}</span>
                  <span style={{ textAlign: "right" }}>{t("tabs.screener.colPrice")}</span>
                  {[["change", t("tabs.screener.colChange"), "right"], ["signals", t("tabs.screener.colSignals"), "center"], ["score", t("tabs.screener.colScore"), "right"]].map(([v, l, align]) => (
                    <button key={v} onClick={() => setSortBy(v)} style={{
                      background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: "inherit",
                      fontSize: "11px", fontWeight: 800, letterSpacing: ".05em",
                      color: sortBy === v ? (C.blueL || C.blue) : C.text3, textAlign: align,
                    }}>{l} {sortBy === v ? "▼" : "↕"}</button>
                  ))}
                </div>
                {filtered.map((asset, i) => (
                  <AssetCard key={`${asset.symbol}-${i}`} asset={asset} onChart={() => setChartAsset(asset)} isMobile={isMobile} />
                ))}
              </div>
            )}

            {/* ── Google AdSense (Screener - In-Feed) ─── */}
            {results.length > 0 && <GoogleAd format="in-feed" slot="screener-results" style={{ margin: "16px 0" }} />}

            {/* 면책은 탭 하단 1회로 일원화 (이중 노출 방지 — IA v3) */}

            {!scanning && results.length > 0 && filtered.length === 0 && (
              <div style={{ border: `1.5px dashed ${C.border2}`, borderRadius: "16px", padding: "32px 24px", textAlign: "center" }}>
                <div style={{
                  width: "52px", height: "52px", borderRadius: "16px", background: C.card2, color: C.text3,
                  display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto",
                }} aria-hidden="true">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
                </div>
                <div style={{ fontWeight: 800, fontSize: mf(15), color: C.text1, margin: "14px 0 4px" }}>{t("tabs.screener.marketEmptyTitle")}</div>
                <div style={{ fontSize: mf(13), color: C.text3, marginBottom: "16px", lineHeight: 1.6 }}>{t("tabs.screener.marketEmptyDesc", { n: results.length })}</div>
                <button
                  onClick={() => setFilterMarket("all")}
                  style={{
                    padding: "11px 18px", borderRadius: "12px", fontSize: mf(13), fontWeight: 800,
                    background: `${C.blue}1F`, color: C.blueL || C.blue, border: "none", fontFamily: "inherit",
                    cursor: "pointer", minHeight: "44px",
                  }}
                >
                  {t("tabs.screener.marketEmptyCta", { n: results.length })}
                </button>
              </div>
            )}


            {/* ═══════════════════════════════════════════════════════
                저평가 종목 통합 조회 — ★ IA v3 밀도 절제: 기능은 그대로 두고
                접이식(details)으로 수납했습니다(시안 1b 는 시그널+스크리너가 주역).
            ═══════════════════════════════════════════════════════ */}
            <details style={{ marginTop: "20px" }}>
              <summary style={{
                listStyle: "none", cursor: "pointer", background: C.card, border: `1px solid ${C.border}`,
                borderRadius: "16px", padding: "13px 16px", display: "flex", alignItems: "center", gap: "10px",
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 800, fontSize: mf(14), color: C.text1 }}>💎 {t("tabs.screener.valueTitle")}</div>
                  <div style={{ fontSize: mf(11), color: C.text3, marginTop: "2px" }}>{t("tabs.screener.valueDesc")}</div>
                </div>
                <span style={{ fontSize: "12px", color: C.text3, flexShrink: 0 }} aria-hidden="true">▾</span>
              </summary>
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "16px", padding: "18px 16px", marginTop: "8px" }}>
              {/* 제목·설명은 summary 가 전달 — 본문은 실행 버튼부터(이중 노출 방지) */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", marginBottom: "16px", flexWrap: "wrap", gap: "10px" }}>
                <button onClick={runValueScan} disabled={valueScanning} style={{
                  padding: isMobile ? "12px 16px" : "10px 20px", borderRadius: "12px", fontSize: mf(17), fontWeight: 700,
                  background: valueScanning ? C.card2 : C.green, color: valueScanning ? C.text3 : "#fff",
                  border: "none", whiteSpace: "nowrap", minHeight: "44px",
                }}>
                  {valueScanning
                    ? <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <span style={{ animation: "pulse 1s infinite" }}>⏳</span> {valueScanProgress.done}/{valueScanProgress.total}
                      </span>
                    : `💎 ${t("tabs.screener.valueScanBtn")}`}
                </button>
              </div>

              {valueScanning && (
                <div style={{ height: "4px", background: C.border2, borderRadius: "4px", overflow: "hidden", marginBottom: "12px" }}>
                  <div style={{
                    height: "100%", background: C.green, borderRadius: "4px",
                    width: `${valueScanProgress.total ? (valueScanProgress.done / valueScanProgress.total) * 100 : 0}%`,
                    transition: "width .3s",
                  }} />
                </div>
              )}

              {valueLastScan && !valueScanning && (
                <div style={{ fontSize: mf(16), color: C.text3, marginBottom: "10px" }}>
                  {t("tabs.screener.valueScanMeta", { time: valueLastScan.toLocaleTimeString(lang === "en" ? "en-US" : "ko-KR"), total: valueResults.length, found: filteredValue.length })}
                </div>
              )}

              {/* 필터 + 정렬 */}
              {valueResults.length > 0 && (
                <div style={{ display: "flex", gap: "6px", alignItems: "center", marginBottom: "12px", flexWrap: "wrap" }}>
                  {[["all", t("tabs.home.all")], ["us", t("tabs.quantReport.us")], ["kr", t("tabs.quantReport.kr")]].map(([v, l]) => (
                    <button key={v} onClick={() => setValueFilter(v)} style={{
                      padding: "4px 10px", borderRadius: "8px", fontSize: mf(16), fontWeight: 600,
                      background: valueFilter === v ? C.greenBg : "transparent",
                      color: valueFilter === v ? C.green : C.text3, border: `1px solid ${valueFilter === v ? C.green : C.border2}`,
                    }}>{l}</button>
                  ))}
                  <div style={{ marginLeft: "auto", display: "flex", gap: "4px", alignItems: "center" }}>
                    <span style={{ fontSize: mf(16), color: C.text3 }}>{t("tabs.screener.sortLabel")}</span>
                    {[["score", t("tabs.screener.valueSortTotal")], ["per","PER↑"], ["pbr","PBR↑"], ["div", t("tabs.screener.valueSortDiv")], ["upside", t("tabs.screener.valueSortUpside")]].map(([v, l]) => (
                      <button key={v} onClick={() => setValueSortBy(v)} style={{
                        padding: "3px 7px", borderRadius: "6px", fontSize: mf(15), fontWeight: 600,
                        background: valueSortBy === v ? C.greenBg : "transparent", color: valueSortBy === v ? C.green : C.text3,
                        border: `1px solid ${valueSortBy === v ? C.green : C.border2}`,
                      }}>{l}</button>
                    ))}
                  </div>
                </div>
              )}

              {/* 결과 리스트 */}
              {filteredValue.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  {filteredValue.slice(0, 50).map((s, i) => {
                    const scoreColor = s.score >= 80 ? C.green : s.score >= 65 ? C.blue : C.yellow;
                    const scoreLabel = s.score >= 80 ? t("tabs.screener.valueStrong") : s.score >= 70 ? t("tabs.screener.valueUndervalued") : s.score >= 60 ? t("tabs.screener.valuePossible") : t("tabs.screener.valueWatch");
                    return (
                      <div key={s.symbol} onClick={() => { setSelectedAsset({ symbol: s.symbol, name: s.name }); }} style={{
                        background: C.card2, borderRadius: "12px", padding: isMobile ? "12px 12px" : "12px 14px",
                        border: `1px solid ${C.border}`, cursor: "pointer", transition: "all .15s",
                      }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                            <span style={{ fontSize: mf(16), fontWeight: 700, color: C.text3, minWidth: "20px" }}>{i + 1}</span>
                            <span style={{ fontSize: "16px" }}>{s.market === "us" ? "🇺🇸" : "🇰🇷"}</span>
                            <span style={{ fontWeight: 700, fontSize: mf(17), color: C.text1 }}>{s.name}</span>
                            <span style={{ fontSize: mf(16), color: C.text3 }}>{s.symbol.replace(".KS","").replace(".KQ","")}</span>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                            <span style={{ fontSize: mf(17), fontWeight: 700, color: C.text1 }}>
                              {s.market === "kr" ? `₩${Math.round(s.price).toLocaleString()}` : `$${s.price?.toFixed(2)}`}
                            </span>
                            <span style={{
                              padding: "2px 8px", borderRadius: "6px", fontSize: "16px", fontWeight: 700,
                              background: `${scoreColor}22`, color: scoreColor,
                            }}>{t("tabs.screener.scorePts", { n: s.score })}</span>
                          </div>
                        </div>
                        {/* 지표 행 */}
                        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "4px" }}>
                          {s.per != null && (
                            <span style={{ fontSize: mf(15), padding: "2px 6px", borderRadius: "4px", background: s.per < 12 ? `${C.green}18` : s.per < 20 ? `${C.blue}18` : `${C.text3}18`, color: s.per < 12 ? C.green : s.per < 20 ? C.blue : C.text3 }}>
                              PER {s.per.toFixed(1)}
                            </span>
                          )}
                          {s.pbr != null && (
                            <span style={{ fontSize: mf(15), padding: "2px 6px", borderRadius: "4px", background: s.pbr < 1 ? `${C.green}18` : s.pbr < 2 ? `${C.blue}18` : `${C.text3}18`, color: s.pbr < 1 ? C.green : s.pbr < 2 ? C.blue : C.text3 }}>
                              PBR {s.pbr.toFixed(2)}
                            </span>
                          )}
                          {s.divYield > 0 && (
                            <span style={{ fontSize: mf(15), padding: "2px 6px", borderRadius: "4px", background: s.divYield > 3 ? `${C.yellow}18` : `${C.text3}18`, color: s.divYield > 3 ? C.yellow : C.text3 }}>
                              {t("tabs.screener.divShort")} {s.divYield.toFixed(1)}%
                            </span>
                          )}
                          {s.upside != null && (
                            <span style={{ fontSize: mf(15), padding: "2px 6px", borderRadius: "4px", background: s.upside > 15 ? `${C.green}18` : s.upside > 0 ? `${C.blue}18` : `${C.red}18`, color: s.upside > 15 ? C.green : s.upside > 0 ? C.blue : C.red }}>
                              {t("tabs.screener.targetShort")} {s.upside > 0 ? "+" : ""}{s.upside.toFixed(0)}%
                            </span>
                          )}
                          {s.fpe != null && s.per != null && s.fpe < s.per * 0.85 && (
                            <span style={{ fontSize: mf(15), padding: "2px 6px", borderRadius: "4px", background: `${C.green}18`, color: C.green }}>
                              F-PER {s.fpe.toFixed(1)}
                            </span>
                          )}
                        </div>
                        {/* 이유 */}
                        {s.reasons.length > 0 && (
                          <div style={{ fontSize: mf(15), color: C.text3, lineHeight: 1.6 }}>
                            {s.reasons.slice(0, 3).join(" · ")}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {filteredValue.length > 50 && (
                    <div style={{ textAlign: "center", fontSize: mf(16), color: C.text3, padding: "8px" }}>
                      {t("tabs.screener.top50Only", { n: filteredValue.length })}
                    </div>
                  )}
                </div>
              )}

              {!valueScanning && valueResults.length === 0 && (
                <div style={{ textAlign: "center", padding: "24px", color: C.text3 }}>
                  <div style={{ fontSize: mf(36), marginBottom: "10px" }}>💎</div>
                  <div style={{ fontSize: mf(17), lineHeight: 1.7 }}>
                    <strong style={{ color: C.green }}>{t("tabs.screener.valueScanBtn")}</strong>{t("tabs.screener.valueEmptyDesc1")}<br />
                    {t("tabs.screener.valueEmptyDesc2")}
                  </div>
                  <div style={{ fontSize: mf(16), marginTop: "8px", color: C.text3 }}>
                    {t("tabs.screener.valueBasis")}
                  </div>
                </div>
              )}

              {!valueScanning && valueResults.length > 0 && filteredValue.length === 0 && (
                <div style={{ textAlign: "center", padding: "20px", color: C.text3, fontSize: mf(17) }}>
                  {t("tabs.screener.valueMarketEmpty")}
                </div>
              )}
            </div>
            </details>

            {/* 시안 1b 하단 면책 — 시그널·스크리너 공용 1회(이중 노출 방지) */}
            <Disclaimer style={{ marginTop: "14px" }}>{t("tabs.coin.disclaimer")}</Disclaimer>

          </div>
          );
        })()}

        {/* ═══════════════════════════════════════════════════════════
            TAB: 포트폴리오
        ═══════════════════════════════════════════════════════════ */}
        {/* ★ 2026-06-08 포트폴리오 허브 — 흩어져 있던 3탭(내 자산·자산 분석·퀀트 포트)을
            세그먼트로 통합. 라우트·데이터 흐름은 그대로, 상단 내비만 공유 (대표 지시). */}
        {(tab === "portfolio" || tab === "portfolio-analysis" || tab === "quant-port" || tab === "quant-portfolio") && (
          <SectionTabs
            title="포트폴리오"
            items={[
              { tab: "portfolio", label: "내 자산" },
              { tab: "portfolio-analysis", label: "자산 분석" },
              // ★ 2026-07 정보 서비스 피벗: 퀀트 포트폴리오는 내부 운영 전용
              ...(isOwner ? [{ tab: "quant-port", label: "퀀트 포트폴리오" }] : []),
            ]}
            active={tab} onNavigate={setTab} theme={themeMode}
          />
        )}
        {tab === "portfolio" && (
          <PortfolioTab
            C={C}
            portfolio={portfolio} setPortfolio={setPortfolio}
            portfolioPrices={portfolioPrices}
            portfolioLoading={portfolioLoading}
            showAddAsset={showAddAsset} setShowAddAsset={setShowAddAsset}
            newAsset={newAsset} setNewAsset={setNewAsset}
            currency={currency} setCurrency={setCurrency}
            krwRate={krwRate}
            toDisplay={toDisplay}
            pStats={pStats}
            fetchPortfolioPrices={fetchPortfolioPrices}
            CRYPTO_ASSETS={CRYPTO_ASSETS}
            SearchBar={SearchBar}
            setSelectedAsset={setSelectedAsset}
            setTab={setTab}
          />
        )}

        {/* ═══════════════════════════════════════════════════════════
            TAB: 이상 탐지 (Anomaly Detection)
        ═══════════════════════════════════════════════════════════ */}
        {tab === "anomaly" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            {/* 헤더 — 긴급 이상 탐지 분위기 강화 */}
            <div style={{
              background: `linear-gradient(135deg, ${C.redBg} 0%, ${C.yellowBg} 50%, ${C.card} 100%)`,
              borderRadius: "24px", padding: isMobile ? "24px 18px" : "28px 28px", border: `1px solid ${C.red}30`,
              boxShadow: `0 4px 20px rgba(255,77,100,0.12)`,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "14px" }}>
                <div style={{ width: "48px", height: "48px", borderRadius: "12px",
                  background: `linear-gradient(135deg, ${C.red}, ${C.yellow})`,
                  display: "flex", alignItems: "center", justifyContent: "center", fontSize: "24px"
                }}>⚠️</div>
                <div>
                  <h2 style={{ margin: 0, fontSize: isMobile ? mf(20) : "24px", fontWeight: 800, color: C.text1 }}>{t("tabs.home.anomalyDetection")}</h2>
                  <div style={{ fontSize: "16px", color: C.text3, marginTop: "2px" }}>
                    {t("tabs.anomaly.subtitle")}
                  </div>
                </div>
                <div style={{ marginLeft: "auto", textAlign: "right" }}>
                  <div style={{
                    fontSize: "32px", fontWeight: 800,
                    color: anomalies.length > 0 ? C.red : C.green,
                  }}>{anomalies.length}</div>
                  <div style={{ fontSize: "16px", color: C.text3 }}>{t("tabs.anomaly.detected")}</div>
                </div>
              </div>

              {/* 통계 요약 3칸 — 대형화 및 색상 강화 */}
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr", gap: "12px" }}>
                {[
                  { label: t("tabs.anomaly.surge"), value: anomalies.filter(a => a.anomalyType === "surge").length, icon: "🚀", color: C.green },
                  { label: t("tabs.anomaly.plunge"), value: anomalies.filter(a => a.anomalyType === "crash").length, icon: "💥", color: C.red },
                  { label: t("tabs.anomaly.highRisk"), value: anomalies.filter(a => a.severity === "high").length, icon: "🔴", color: C.yellow },
                ].map((s, i) => (
                  <div key={i} style={{
                    background: `linear-gradient(135deg, ${C.card} 0%, ${C.card2} 100%)`,
                    borderRadius: "16px", padding: "14px",
                    textAlign: "center", border: `1px solid ${C.border}60`,
                    boxShadow: `0 2px 12px rgba(0,0,0,0.2)`,
                  }}>
                    <div style={{ fontSize: "24px", marginBottom: "6px" }}>{s.icon}</div>
                    <div style={{ fontSize: "24px", fontWeight: 800, color: s.color }}>{s.value}</div>
                    <div style={{ fontSize: "16px", color: C.text3 }}>{s.label}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* 필터 탭 */}
            <div style={{ display: "flex", gap: "8px", flexWrap: isMobile ? "nowrap" : "wrap", overflowX: isMobile ? "auto" : "visible", paddingBottom: isMobile ? "8px" : "0" }}>
              {[
                { key: "all", label: t("tabs.anomaly.all"), icon: "📊" },
                { key: "surge", label: t("tabs.anomaly.surge"), icon: "🚀" },
                { key: "crash", label: t("tabs.anomaly.plunge"), icon: "💥" },
                { key: "high", label: t("tabs.anomaly.highRisk"), icon: "🔴" },
              ].map(f => {
                const count = f.key === "all" ? anomalies.length
                  : f.key === "high" ? anomalies.filter(a => a.severity === "high").length
                  : anomalies.filter(a => a.anomalyType === f.key).length;
                return (
                  <button key={f.key} onClick={() => setAnomalyFilter(f.key)} style={{
                    padding: "8px 16px", borderRadius: "12px", fontSize: "18px", fontWeight: 600,
                    background: anomalyFilter === f.key ? C.blueBg : C.card,
                    color: anomalyFilter === f.key ? C.blue : C.text2,
                    border: `1px solid ${anomalyFilter === f.key ? C.blue : C.border}40`,
                    cursor: "pointer", display: "flex", alignItems: "center", gap: "6px", flexShrink: 0,
                  }}>
                    {f.icon} {f.label}
                    <span style={{
                      background: anomalyFilter === f.key ? `${C.blue}30` : `${C.text3}20`,
                      padding: "1px 7px", borderRadius: "8px", fontSize: "16px",
                    }}>{count}</span>
                  </button>
                );
              })}
            </div>

            {/* 이상 탐지 리스트 */}
            {(() => {
              const filtered = anomalyFilter === "all" ? anomalies
                : anomalyFilter === "high" ? anomalies.filter(a => a.severity === "high")
                : anomalies.filter(a => a.anomalyType === anomalyFilter);
              if (filtered.length === 0) return (
                <div style={{
                  background: C.card, borderRadius: "16px", padding: "48px 24px",
                  textAlign: "center", border: `1px solid ${C.border}20`,
                }}>
                  <div style={{ fontSize: "48px", marginBottom: "16px" }}>
                    {anomalies.length === 0 ? "✅" : "🔍"}
                  </div>
                  <div style={{ fontWeight: 700, fontSize: "18px", color: C.text1, marginBottom: "8px" }}>
                    {anomalies.length === 0 ? t("tabs.anomaly.emptyTitle") : t("tabs.anomaly.emptyFilterTitle")}
                  </div>
                  <div style={{ color: C.text3, fontSize: "18px", lineHeight: 1.7 }}>
                    {anomalies.length === 0
                      ? <>{t("tabs.anomaly.emptyDesc1")}<br/>{t("tabs.anomaly.emptyDesc2")}</>
                      : <>{t("tabs.anomaly.emptyFilterDesc")}</>}
                  </div>
                </div>
              );
              return (
                <div style={{ display: "flex", flexDirection: "column", gap: isMobile ? "8px" : "10px" }}>
                  {filtered.map((a, i) => {
                    const isSurge = a.anomalyType === "surge";
                    const accentColor = isSurge ? C.green : C.red;
                    return (
                      <div key={`${a.symbol}-${i}`} style={{
                        background: `linear-gradient(135deg, ${C.card} 0%, ${C.card2} 100%)`,
                        borderRadius: "12px", borderLeft: `4px solid ${accentColor}`,
                        padding: isMobile ? "14px" : "18px 20px", border: `1px solid ${accentColor}40`,
                        cursor: "pointer", transition: "all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)",
                        boxShadow: `0 2px 8px rgba(0,0,0,0.15)`,
                      }}
                      onClick={() => setChartAsset(a)}
                      onMouseEnter={e => {
                        e.currentTarget.style.borderColor = `${accentColor}60`;
                        e.currentTarget.style.transform = "translateY(-3px) scale(1.01)";
                        e.currentTarget.style.boxShadow = `0 8px 20px ${accentColor}30`;
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.borderColor = `${accentColor}40`;
                        e.currentTarget.style.transform = "translateY(0) scale(1)";
                        e.currentTarget.style.boxShadow = `0 2px 8px rgba(0,0,0,0.15)`;
                      }}
                      >
                        {/* 상단: 종목명 + 변동률 + 심각도 */}
                        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px" }}>
                          <div style={{
                            width: "36px", height: "36px", borderRadius: "12px",
                            background: `${accentColor}15`, display: "flex",
                            alignItems: "center", justifyContent: "center", fontSize: "18px",
                          }}>{isSurge ? "🚀" : "💥"}</div>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: 700, fontSize: "18px", color: C.text1 }}>{a.name}</div>
                            <div style={{ fontSize: "16px", color: C.text3, marginTop: "1px" }}>{a.symbol}</div>
                          </div>
                          <div style={{ textAlign: "right" }}>
                            <div style={{ fontWeight: 800, fontSize: "18px", color: accentColor }}>
                              {a.change >= 0 ? "+" : ""}{a.change?.toFixed(2)}%
                            </div>
                            <div style={{ fontSize: "16px", color: C.text3 }}>
                              {/* ★ 전수 감사: KR 종목에 $ 하드코딩 → ₩ 분기 (삼성전자 '$60,000' 표기 버그) */}
                              {a.market === "kr" ? `₩${Math.round(a.price || 0).toLocaleString()}` : `$${a.price?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                            </div>
                          </div>
                          <div style={{
                            padding: "4px 10px", borderRadius: "8px", fontSize: "16px", fontWeight: 700,
                            background: a.severity === "high" ? `${C.red}20` : `${C.yellow}20`,
                            color: a.severity === "high" ? C.red : C.yellow,
                          }}>
                            {a.severity === "high" ? "🔴 HIGH" : "🟡 MED"}
                          </div>
                        </div>

                        {/* 이상 탐지 이유 */}
                        <div style={{
                          display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "12px",
                        }}>
                          {a.anomalyReasons.map((r, ri) => (
                            <span key={ri} style={{
                              padding: "4px 10px", borderRadius: "8px", fontSize: "16px",
                              background: `${accentColor}12`, color: accentColor, fontWeight: 600,
                            }}>⚠️ {r}</span>
                          ))}
                        </div>

                        {/* 지표 그리드 */}
                        <div style={{
                          display: "grid", gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(auto-fit, minmax(100px, 1fr))",
                          gap: "8px", padding: "12px", background: `${C.card2}80`,
                          borderRadius: "12px",
                        }}>
                          {[
                            a.rsi != null && { label: "RSI", value: a.rsi.toFixed(1), color: a.rsi > 70 ? C.red : a.rsi < 30 ? C.green : C.text2 },
                            a.volRatio != null && { label: t("tabs.anomaly.volRatio"), value: `${a.volRatio.toFixed(1)}x`, color: a.volRatio > 3 ? C.red : C.text2 },
                            a.ma200Dist != null && { label: t("tabs.anomaly.ma200Gap"), value: `${a.ma200Dist > 0 ? "+" : ""}${a.ma200Dist.toFixed(1)}%`, color: a.ma200Dist > 20 ? C.red : a.ma200Dist < -20 ? C.green : C.text2 },
                            a.weeklyChange != null && { label: t("tabs.anomaly.weeklyChange"), value: `${a.weeklyChange > 0 ? "+" : ""}${a.weeklyChange.toFixed(1)}%`, color: a.weeklyChange >= 0 ? C.green : C.red },
                            a.stochasticK != null && { label: "Stoch K", value: a.stochasticK.toFixed(1), color: a.stochasticK > 80 ? C.red : a.stochasticK < 20 ? C.green : C.text2 },
                            a.williamsR != null && { label: "Williams %R", value: a.williamsR.toFixed(1), color: a.williamsR > -20 ? C.red : a.williamsR < -80 ? C.green : C.text2 },
                          ].filter(Boolean).map((ind, ii) => (
                            <div key={ii} style={{ textAlign: "center" }}>
                              <div style={{ fontSize: "16px", color: C.text3, marginBottom: "3px" }}>{ind.label}</div>
                              <div style={{ fontSize: "18px", fontWeight: 700, color: ind.color }}>{ind.value}</div>
                            </div>
                          ))}
                        </div>

                        {/* 감지 시간 */}
                        <div style={{ fontSize: "16px", color: C.text3, marginTop: "10px", textAlign: "right" }}>
                          {t("tabs.anomaly.detectedAt", { time: a.detectedAt ? new Date(a.detectedAt).toLocaleTimeString(lang === "en" ? "en-US" : "ko-KR") : "-" })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}

            {/* ── 이상 탐지 히스토리 ── */}
            <div style={{
              background: C.card, borderRadius: "16px", padding: "20px",
              border: `1px solid ${C.border}20`,
            }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "14px" }}>
                <h3 style={{ margin: 0, fontSize: "18px", fontWeight: 700, color: C.text1 }}>📜 {t("tabs.anomaly.history")}</h3>
                {anomalyHistory.length > 0 && (
                  <button onClick={() => {
                    if (!confirm(t("tabs.anomaly.historyClearConfirm"))) return;
                    setAnomalyHistory([]); try { localStorage.removeItem("di_anomaly_history"); } catch {}
                  }} style={{
                    padding: "4px 12px", borderRadius: "8px", fontSize: "16px",
                    background: `${C.red}15`, color: C.red, border: "none", cursor: "pointer", fontWeight: 600,
                  }}>{t("tabs.anomaly.historyReset")}</button>
                )}
              </div>
              {anomalyHistory.length === 0 ? (
                <div style={{ textAlign: "center", padding: "24px 0", color: C.text3, fontSize: "18px" }}>
                  {t("tabs.anomaly.historyEmpty")}
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "6px", maxHeight: "300px", overflowY: "auto" }}>
                  {anomalyHistory.slice(0, 20).map((h, i) => (
                    <div key={i} style={{
                      display: "flex", alignItems: "center", gap: "10px",
                      padding: "10px 12px", borderRadius: "10px",
                      background: `${C.card2}60`, fontSize: "18px",
                    }}>
                      <span>{h.type === "surge" ? "🚀" : "💥"}</span>
                      <span style={{ fontWeight: 600, color: C.text1, flex: 1 }}>{h.name}</span>
                      <span style={{ fontWeight: 700, color: h.change >= 0 ? C.green : C.red }}>
                        {h.change >= 0 ? "+" : ""}{h.change?.toFixed(2)}%
                      </span>
                      <span style={{ fontSize: "16px", color: C.text3 }}>
                        {h.date ? new Date(h.date).toLocaleDateString("ko-KR", { month: "short", day: "numeric" }) : "-"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 탐지 기준 설명 */}
            <div style={{
              background: C.card, borderRadius: "16px", padding: "18px 20px",
              border: `1px solid ${C.border}20`,
            }}>
              <h3 style={{ margin: "0 0 12px", fontSize: "18px", fontWeight: 700, color: C.text1 }}>📐 {t("tabs.anomaly.criteria")}</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {[
                  { icon: "📈", title: t("tabs.anomaly.critPrice"), desc: t("tabs.anomaly.critPriceDesc") },
                  { icon: "📊", title: t("tabs.anomaly.critVolume"), desc: t("tabs.anomaly.critVolumeDesc") },
                  { icon: "⬆️", title: t("tabs.anomaly.critGap"), desc: t("tabs.anomaly.critGapDesc") },
                  { icon: "🔴", title: t("tabs.anomaly.critHigh"), desc: t("tabs.anomaly.critHighDesc") },
                ].map((c, i) => (
                  <div key={i} style={{
                    padding: "12px", borderRadius: "12px",
                    background: `${C.card2}60`, border: `1px solid ${C.border}20`,
                  }}>
                    <div style={{ fontSize: "18px", marginBottom: "6px" }}>{c.icon}</div>
                    <div style={{ fontSize: "18px", fontWeight: 600, color: C.text1, marginBottom: "3px" }}>{c.title}</div>
                    <div style={{ fontSize: "16px", color: C.text3, lineHeight: 1.5 }}>{c.desc}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════
            TAB: 전략
        ═══════════════════════════════════════════════════════════ */}
        {tab === "strategy" && isOwner && (
          <div style={{
            background: `linear-gradient(135deg, ${C.purpleBg} 0%, ${C.card} 100%)`,
            borderRadius: "24px", padding: "24px",
            boxShadow: `0 4px 20px rgba(155,111,255,0.08)`,
            display: "flex", flexDirection: "column", gap: "12px"
          }}>
            <Suspense fallback={<LazyTabFallback />}><StrategyPanel onRunBacktest={(strategy, symbol) => {
              setBtStrategy(strategy); setBtSymbol(symbol); setTab("backtest");            }} /></Suspense>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════
            TAB: 전략 운용 (퀀트 포트폴리오)
        ═══════════════════════════════════════════════════════════ */}
        {(tab === "quant-port" || tab === "quant-portfolio") && isOwner && (
          <div style={{
            background: `linear-gradient(135deg, ${C.purpleBg} 0%, ${C.blueBg} 100%)`,
            borderRadius: "24px", padding: "24px",
            boxShadow: `0 4px 20px rgba(155,111,255,0.08)`,
            display: "flex", flexDirection: "column", gap: "12px"
          }}>
            <Suspense fallback={<LazyTabFallback />}><QuantPortfolio theme={themeMode} /></Suspense>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════
            TAB: 리스크 히트맵
        ═══════════════════════════════════════════════════════════ */}
        {tab === "risk-map" && (
          <div style={{
            background: `linear-gradient(135deg, ${C.redBg} 0%, ${C.card} 100%)`,
            borderRadius: "24px", padding: "24px",
            boxShadow: `0 4px 20px rgba(255,77,100,0.08)`,
            display: "flex", flexDirection: "column", gap: "12px"
          }}>
            <Suspense fallback={<LazyTabFallback />}><RiskHeatmap marketIndices={marketIndices} fearGreed={fearGreed} /></Suspense>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════
            TAB: 퀀트 리포트
        ═══════════════════════════════════════════════════════════ */}
        {tab === "quant-report" && (() => {
          const sp = marketIndices.find(i => i.symbol === "^GSPC");
          const nq = marketIndices.find(i => i.symbol === "^IXIC");
          const dji = marketIndices.find(i => i.symbol === "^DJI");
          const ks = marketIndices.find(i => i.symbol === "^KS11");
          const kq = marketIndices.find(i => i.symbol === "^KQ11");
          const vix = marketIndices.find(i => i.symbol === "^VIX");
          const fg = fearGreed.stock?.value;
          const upCount = hotAssets.filter(a => a.change > 0).length;
          const dnCount = hotAssets.filter(a => a.change < 0).length;
          const flatCount = hotAssets.length - upCount - dnCount;
          const advDecl = hotAssets.length > 0 ? (upCount / hotAssets.length * 100) : 50;
          const buyPicks = dailyPicks.filter(p => p.score >= 6).length;
          const sellPicks = dailyPicks.filter(p => p.score <= 3).length;
          let mktScore = 50;
          if (sp) mktScore += sp.change > 1 ? 10 : sp.change > 0.3 ? 5 : sp.change > -0.3 ? 0 : sp.change > -1 ? -5 : -10;
          if (fg) mktScore += fg > 70 ? 8 : fg > 55 ? 4 : fg > 40 ? 0 : fg > 25 ? -4 : -8;
          mktScore += advDecl > 60 ? 8 : advDecl > 50 ? 3 : advDecl > 40 ? -3 : -8;
          // ★ 스캔 미완료(dailyPicks 빈 배열)면 0건이 점수를 끌어내리지 않게 가산 자체를 건너뜁니다
          //   — 이 점수는 공유 텍스트에도 실려 나가므로 owner/일반 사용자 간 불일치 방지.
          if (dailyPicks.length > 0) {
            if (buyPicks > 5) mktScore += 6; else if (buyPicks > 2) mktScore += 3;
            if (sellPicks > 5) mktScore -= 6; else if (sellPicks > 2) mktScore -= 3;
          }
          mktScore = Math.max(0, Math.min(100, mktScore));
          const mktVerdict = mktScore >= 70 ? t("tabs.quantReport.verdictStrongBull") : mktScore >= 55 ? t("tabs.quantReport.verdictWeakBull") : mktScore >= 45 ? t("tabs.quantReport.verdictMixed") : mktScore >= 30 ? t("tabs.quantReport.verdictWeakBear") : t("tabs.quantReport.verdictStrongBear");
          const mktColor = mktScore >= 60 ? C.green : mktScore >= 45 ? C.yellow : C.red;
          const now = new Date();
          const reportTime = now.toLocaleString(lang === "en" ? "en-US" : "ko-KR", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" });

          // 섹터별 분류
          const usStocks = hotAssets.filter(a => a.market === "us");
          const krStocks = hotAssets.filter(a => a.market === "kr");
          const cryptos = hotAssets.filter(a => a.market === "crypto");
          const usUp = usStocks.filter(a => a.change > 0).length;
          const krUp = krStocks.filter(a => a.change > 0).length;
          const cryptoUp = cryptos.filter(a => a.change > 0).length;

          // 상위 상승/하락 5개 (마켓별 분리)
          const sorted = [...hotAssets].sort((a, b) => b.change - a.change);
          const usGainers = usStocks.sort((a, b) => b.change - a.change).slice(0, 3);
          const krGainers = krStocks.sort((a, b) => b.change - a.change).slice(0, 3);
          const cryptoGainers = cryptos.sort((a, b) => b.change - a.change).slice(0, 3);
          const topGainers = [...usGainers, ...krGainers, ...cryptoGainers].sort((a, b) => b.change - a.change).slice(0, 5);
          const usLosers = [...usStocks].sort((a, b) => a.change - b.change).slice(0, 3);
          const krLosers = [...krStocks].sort((a, b) => a.change - b.change).slice(0, 3);
          const cryptoLosers = [...cryptos].sort((a, b) => a.change - b.change).slice(0, 3);
          const topLosers = [...usLosers, ...krLosers, ...cryptoLosers].sort((a, b) => a.change - b.change).slice(0, 5);

          // 추천 종목 상위
          const topPicks = dailyPicks.filter(p => p.score >= 6).slice(0, 5);

          // ★ 시안 1b: 데이터 집계 전(지수·핫종목 모두 빈 상태)에는 가짜 50점 히어로 대신
          //   "발행 전" 빈 상태를 렌더합니다. 딥링크 진입 시 fetchMarketOverview 1회가 채웁니다.
          const hasData = marketIndices.length > 0 || hotAssets.length > 0;
          // 시안의 accent 밝은 짝(텍스트용) — 라이트 모드에선 L 계열이 진한 접근성 색입니다.
          const mktColorHi = mktScore >= 60 ? (C.greenL || C.green) : mktScore >= 45 ? (C.yellowL || C.yellow) : (C.redL || C.red);

          return (
            <div className="tab-content flex flex-col gap-3" style={{ maxWidth: "1200px", margin: "0 auto" }}>
              {/* ── 헤더 — 시안 1b: 타이틀 + 기준 시각 알약 + 공유(기존 로직 유지) ── */}
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span style={{ fontSize: "22px", fontWeight: 800, letterSpacing: "-0.01em", color: C.text1 }}>{t("tabs.quantReport.marketReportTitle")}</span>
                <div className="flex items-center gap-2">
                  <span style={{ fontSize: "11px", fontWeight: 700, padding: "5px 11px", borderRadius: "9999px", background: C.card, border: `1px solid ${C.border}`, color: C.text2 }}>{t("tabs.quantReport.asOfTime", { time: reportTime })}</span>
                  <button onClick={() => {
                    const shareText = t("tabs.quantReport.shareText", { time: reportTime, score: mktScore, verdict: mktVerdict, up: upCount, dn: dnCount });
                    if (navigator.share) {
                      navigator.share({ title: t("tabs.quantReport.shareTitle"), text: shareText, url: "https://zepta.app" }).catch(() => {});
                    } else {
                      navigator.clipboard.writeText(shareText).then(() => showToast(t("tabs.quantReport.copied"), "success")).catch(() => {});
                    }
                  }} style={{
                    fontSize: "12px", fontWeight: 800, padding: "5px 12px", borderRadius: "9999px",
                    background: `${C.blue}1A`, color: C.blueL || C.blue, border: "none", cursor: "pointer", fontFamily: "inherit",
                  }}>📤 {t("tabs.quantReport.share")}</button>
                </div>
              </div>

              {!hasData ? (
                <>
                  {/* ── 빈 상태(시안 1b "발행 전") — 스켈레톤 + 집계 중 안내 ── */}
                  <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "16px", padding: "16px", display: "flex", flexDirection: "column", gap: "9px" }}>
                    <div style={{ width: "38%", height: "10px", borderRadius: "5px", background: C.card2 }} />
                    <div style={{ width: "64%", height: "22px", borderRadius: "6px", background: C.card2 }} />
                    <div style={{ width: "100%", height: "8px", borderRadius: "4px", background: C.card2 }} />
                  </div>
                  <div style={{ border: `1.5px dashed ${C.border2}`, borderRadius: "16px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "6px", padding: "44px 24px", textAlign: "center" }}>
                    <div style={{ width: "52px", height: "52px", borderRadius: "16px", background: C.card2, display: "flex", alignItems: "center", justifyContent: "center", color: C.text3 }}>
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15 14" /></svg>
                    </div>
                    <div style={{ fontSize: "15px", fontWeight: 800, color: C.text1, marginTop: "8px" }}>{t("tabs.quantReport.emptyTitle")}</div>
                    <div style={{ fontSize: "12.5px", color: C.text3, lineHeight: 1.6, maxWidth: "240px" }}>{t("tabs.quantReport.emptyDesc")}</div>
                  </div>
                </>
              ) : (
                <>
              {/* ── 시장 종합 점수 히어로 — 좌측 3px 보더 + 상단 그라데이션 + mono 점수 ── */}
              <div style={{
                background: `linear-gradient(180deg, ${mktColor}1A, transparent 42%), ${C.card}`,
                border: `1px solid ${C.border}`, borderLeft: `3px solid ${mktColor}`,
                borderRadius: "16px", padding: "16px",
              }}>
                <div style={{ fontSize: "11px", color: C.text3, fontWeight: 700 }}>{t("tabs.quantReport.overallScore")}</div>
                <div className="flex items-baseline gap-2" style={{ marginTop: "4px" }}>
                  <Num size="38px" weight={800} color={mktColorHi}>{mktScore}</Num>
                  <Num size="13px" color={C.text3}>/ 100</Num>
                  <span style={{ marginLeft: "auto", fontSize: "12px", fontWeight: 800, padding: "3px 10px", borderRadius: "8px", background: `${mktColor}1A`, color: mktColorHi }}>{mktVerdict}</span>
                </div>
                <div style={{ position: "relative", height: "16px", marginTop: "10px" }}>
                  <div style={{ position: "absolute", top: "5px", left: 0, right: 0, height: "6px", borderRadius: "9999px", background: `linear-gradient(90deg, ${C.red}, ${C.yellow} 45%, ${C.green})` }} />
                  <div style={{ position: "absolute", top: "1px", left: `calc(${mktScore}% - 7px)`, width: "14px", height: "14px", borderRadius: "50%", background: mktColorHi, boxShadow: `0 0 0 3px ${C.card}` }} />
                </div>
                <div style={{ fontSize: "13px", color: C.text2, marginTop: "10px", lineHeight: 1.6 }}>
                  {mktScore >= 60
                    ? (dailyPicks.length > 0
                        ? t("tabs.quantReport.messagesBullish", { upCount, buyPicks })
                        : t("tabs.quantReport.messagesBullishNoScan", { upCount }))
                    : mktScore >= 45
                    ? t("tabs.quantReport.messagesMixed")
                    : t("tabs.quantReport.messagesBearish", { dnCount })}
                </div>
                <div style={{ fontSize: "11px", color: C.text3, marginTop: "6px" }}>{t("tabs.quantReport.aiAnalysis")}</div>
              </div>

              {/* ── 주요 지수 — 시안 타일(모바일 스크롤 / 데스크탑 그리드) ── */}
              {marketIndices.length > 0 && (
                <div>
                  <MobileSectionHeader title={t("tabs.quantReport.marketIndices")} style={{ marginBottom: "8px" }} />
                  <IndexStrip layout={isMobile ? "scroll" : "grid"} numSize={isMobile ? "15px" : "18px"} items={[
                    sp && { label: "S&P 500", value: typeof sp.price === "number" ? sp.price.toLocaleString(undefined, { maximumFractionDigits: 0 }) : sp.price, change: sp.change },
                    nq && { label: t("tabs.home.nasdaqLabel"), value: typeof nq.price === "number" ? nq.price.toLocaleString(undefined, { maximumFractionDigits: 0 }) : nq.price, change: nq.change },
                    dji && { label: t("tabs.home.dowLabel"), value: typeof dji.price === "number" ? dji.price.toLocaleString(undefined, { maximumFractionDigits: 0 }) : dji.price, change: dji.change },
                    ks && { label: t("tabs.home.kospiLabel"), value: typeof ks.price === "number" ? ks.price.toLocaleString(undefined, { maximumFractionDigits: 0 }) : ks.price, change: ks.change },
                    kq && { label: t("tabs.home.kosdaqLabel"), value: typeof kq.price === "number" ? kq.price.toLocaleString(undefined, { maximumFractionDigits: 0 }) : kq.price, change: kq.change },
                    vix && { label: "VIX", value: typeof vix.price === "number" ? vix.price.toFixed(1) : vix.price, change: vix.change },
                  ].filter(Boolean)} />
                </div>
              )}

              {/* ── 핵심 지표 타일 — 시안 2열 그리드, mono 수치 + 상태 서술 ── */}
              <div>
                <MobileSectionHeader title={t("tabs.quantReport.sentimentIndicators")} style={{ marginBottom: "8px" }} />
                <div className={isMobile ? "grid grid-cols-2 gap-2.5" : "grid grid-cols-4 gap-2.5"}>
                  <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "14px", padding: "12px 14px" }}>
                    <div style={{ fontSize: "11px", color: C.text3, fontWeight: 700 }}>{t("tabs.quantReport.fearGreedIndex")}</div>
                    <div style={{ marginTop: "3px" }}>
                      <Num size="18px" weight={800} color={fg ? (fg > 60 ? (C.greenL || C.green) : fg > 40 ? (C.yellowL || C.yellow) : (C.redL || C.red)) : C.text3}>{fg || "—"}</Num>
                    </div>
                    <div style={{ fontSize: "11px", fontWeight: 700, marginTop: "2px", color: C.text3 }}>{fg ? (fg <= 25 ? t("tabs.home.extremeFear") : fg <= 40 ? t("tabs.home.fear") : fg <= 60 ? t("tabs.home.neutral") : fg <= 75 ? t("tabs.home.greed") : t("tabs.home.extremeGreed")) : t("tabs.quantReport.noData")}</div>
                    {fg && (
                      <div style={{ position: "relative", height: "12px", marginTop: "6px" }}>
                        <div style={{ position: "absolute", top: "3px", left: 0, right: 0, height: "6px", borderRadius: "9999px", background: `linear-gradient(90deg, ${C.red}, ${C.yellow}, ${C.green})` }} />
                        <div style={{ position: "absolute", top: "1px", left: `calc(${fg}% - 5px)`, width: "10px", height: "10px", borderRadius: "50%", background: C.text1, boxShadow: `0 0 0 2px ${C.card}` }} />
                      </div>
                    )}
                  </div>
                  {hotAssets.length > 0 && (
                    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "14px", padding: "12px 14px" }}>
                      <div style={{ fontSize: "11px", color: C.text3, fontWeight: 700 }}>{t("tabs.quantReport.upDownRatio")}</div>
                      <div style={{ marginTop: "3px" }}>
                        <Num size="18px" weight={800} color={advDecl > 55 ? (C.greenL || C.green) : advDecl < 45 ? (C.redL || C.red) : (C.yellowL || C.yellow)}>{advDecl.toFixed(0)}%</Num>
                      </div>
                      <div className="flex mt-1.5 h-1.5 rounded overflow-hidden" style={{ background: C.card2 }}>
                        <div className="h-full" style={{ width: `${advDecl}%`, background: C.green }} />
                        <div className="h-full flex-1" style={{ background: C.red }} />
                      </div>
                      <div style={{ fontSize: "11px", fontWeight: 700, marginTop: "4px", color: C.text3 }}>{t("tabs.quantReport.upFlatDown", { up: upCount, flat: flatCount, dn: dnCount })}</div>
                    </div>
                  )}
                  {vix && (
                    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "14px", padding: "12px 14px" }}>
                      <div style={{ fontSize: "11px", color: C.text3, fontWeight: 700 }}>{t("tabs.quantReport.vixVolatility")}</div>
                      <div style={{ marginTop: "3px" }}>
                        <Num size="18px" weight={800} color={vix.price > 30 ? (C.redL || C.red) : vix.price > 20 ? (C.yellowL || C.yellow) : (C.greenL || C.green)}>{vix.price?.toFixed(1)}</Num>
                      </div>
                      <div style={{ fontSize: "11px", fontWeight: 700, marginTop: "2px", color: vix.price > 30 ? (C.redL || C.red) : vix.price > 20 ? (C.yellowL || C.yellow) : (C.greenL || C.green) }}>{vix.price > 30 ? t("tabs.quantReport.vixHigh") : vix.price > 20 ? t("tabs.quantReport.vixMid") : t("tabs.quantReport.vixLow")}</div>
                    </div>
                  )}
                  {/* 스캔 전(빈 배열)에는 "0 / 0 종목" 같은 거짓 수치 대신 타일을 숨깁니다 */}
                  {dailyPicks.length > 0 && (
                    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "14px", padding: "12px 14px" }}>
                      <div style={{ fontSize: "11px", color: C.text3, fontWeight: 700 }}>{t("tabs.quantReport.buySignals")}</div>
                      <div style={{ marginTop: "3px" }}>
                        <Num size="18px" weight={800} color={C.blueL || C.blue}>{buyPicks}</Num>
                      </div>
                      <div style={{ fontSize: "11px", fontWeight: 700, marginTop: "2px", color: C.text3 }}>{t("tabs.quantReport.scannedOf", { n: dailyPicks.length })}</div>
                    </div>
                  )}
                </div>
              </div>

              {/* ── 시장별 현황 — 시안 태그 칩 + 상태 서술 + 등락 칩 ── */}
              {hotAssets.length > 0 && (
                <div>
                  <MobileSectionHeader title={t("tabs.quantReport.marketStatus")} style={{ marginBottom: "8px" }} />
                  <div className={isMobile ? "flex flex-col gap-2.5" : "grid grid-cols-3 gap-2.5"}>
                    {[
                      { tag: "US", name: t("tabs.quantReport.usStocks"), color: C.blue, hi: C.blueL || C.blue, total: usStocks.length, up: usUp, movers: usGainers },
                      { tag: "KR", name: t("tabs.quantReport.krStocks"), color: C.green, hi: C.greenL || C.green, total: krStocks.length, up: krUp, movers: krGainers },
                      { tag: "₿", name: t("tabs.quantReport.cryptoName"), color: C.purple, hi: C.purpleL || C.purple, total: cryptos.length, up: cryptoUp, movers: cryptoGainers },
                    ].map(m => (
                      <div key={m.name} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "16px", padding: "14px 15px" }}>
                        <div className="flex items-center gap-2">
                          <span style={{ width: "30px", height: "30px", borderRadius: "9px", background: `${m.color}1A`, color: m.hi, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "11px", fontWeight: 800, flexShrink: 0 }}>{m.tag}</span>
                          <span style={{ fontSize: "14px", fontWeight: 800, color: C.text1 }}>{m.name}</span>
                          <Num size="12px" color={C.text2} style={{ marginLeft: "auto" }}>{m.total > 0 ? t("tabs.quantReport.upOfTotal", { up: m.up, total: m.total }) : "—"}</Num>
                        </div>
                        <div style={{ fontSize: "12px", color: C.text3, marginTop: "8px" }}>
                          {m.total > 0 ? t("tabs.quantReport.breadthDesc", { total: m.total, pct: (m.up / m.total * 100).toFixed(0) }) : t("tabs.quantReport.noAggregated")}
                        </div>
                        {m.total > 0 && (
                          <div style={{ height: "4px", borderRadius: "9999px", background: C.card2, overflow: "hidden", marginTop: "8px" }}>
                            <div style={{ height: "100%", borderRadius: "9999px", width: `${(m.up / m.total * 100)}%`, background: m.color }} />
                          </div>
                        )}
                        {m.movers.length > 0 && (
                          <div className="flex gap-1.5 flex-wrap" style={{ marginTop: "9px" }}>
                            {m.movers.map(v => (
                              <span key={v.symbol} style={{ fontSize: "11px", fontWeight: 700, fontFamily: MONO, padding: "4px 9px", borderRadius: "9999px", background: C.card2, color: v.change >= 0 ? (C.greenL || C.green) : (C.redL || C.red) }}>
                                {v.market === "kr" ? v.name : v.symbol.replace(/-USD$|USDT$/, "")} {v.change >= 0 ? "+" : ""}{v.change}%
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 섹터별 퍼포먼스 히트맵 (v9.1) */}
              {hotAssets.length > 0 && (() => {
                // 섹터 키는 i18n 토큰(tabs.quantReport.sector.*) — 표시 라벨은 t() 로 해석
                const sectors = {
                  semi: ["NVDA","AMD","INTC","AVGO","QCOM","MU","TSM","ASML","ARM","SMCI","MRVL","LRCX","KLAC","AMAT","ON","TXN","ADI"],
                  bigTech: ["AAPL","MSFT","GOOGL","AMZN","META","NFLX","TSLA"],
                  software: ["CRM","ORCL","ADBE","NOW","SNOW","DDOG","NET","PLTR","PANW","CRWD"],
                  fintech: ["COIN","SQ","PYPL","AFRM","SOFI","HOOD","MSTR"],
                  healthcare: ["UNH","JNJ","LLY","NVO","ABBV","PFE","MRK","AMGN"],
                  energy: ["XOM","CVX","LNG","COP","SLB","OXY","EOG"],
                  consumer: ["WMT","COST","HD","MCD","DIS","SBUX","NKE"],
                  financials: ["JPM","GS","BAC","V","MA","BLK","MS"],
                  evClean: ["RIVN","LCID","LI","NIO","XPEV","ENPH","FSLR"],
                  chinaAdr: ["BABA","JD","PDD","BIDU","NTES"],
                };
                const sectorData = Object.entries(sectors).map(([key, syms]) => {
                  const matched = syms.map(s => hotAssets.find(a => a.symbol === s)).filter(Boolean);
                  if (matched.length === 0) return null;
                  const avgChange = matched.reduce((s, a) => s + (a.change || 0), 0) / matched.length;
                  const upRatio = matched.filter(a => a.change > 0).length / matched.length;
                  return { name: t(`tabs.quantReport.sector.${key}`), avgChange: +avgChange.toFixed(2), count: matched.length, upRatio };
                }).filter(Boolean).sort((a, b) => b.avgChange - a.avgChange);
                if (sectorData.length === 0) return null;
                const maxAbs = Math.max(...sectorData.map(s => Math.abs(s.avgChange)), 1);
                return (
                  <div className="rounded-[16px] p-5" style={{ background: C.card, border: `1px solid ${C.border}` }}>
                    <div style={{ fontSize: "15px", fontWeight: 800, color: C.text1, marginBottom: "12px" }}>{t("tabs.quantReport.sectorPerf")}</div>
                    <div className="grid gap-1.5" style={{ gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(auto-fill, minmax(140px, 1fr))" }}>
                      {sectorData.map(s => {
                        const intensity = Math.min(Math.abs(s.avgChange) / maxAbs, 1);
                        // 하드코딩 rgb 대신 테마 토큰 + 알파(강도 비례) — 라이트 모드도 토큰이 처리합니다.
                        const alphaHex = Math.round((0.08 + intensity * 0.18) * 255).toString(16).padStart(2, "0");
                        const bgColor = `${s.avgChange >= 0 ? C.green : C.red}${alphaHex}`;
                        return (
                          <div key={s.name} className="px-3 py-2.5 rounded-[10px] text-center transition-transform" style={{
                            background: bgColor, cursor: "default",
                          }}>
                            <div className="text-base font-bold mb-0.5" style={{ color: C.text1 }}>{s.name}</div>
                            <div className="text-lg font-black" style={{ color: s.avgChange >= 0 ? (C.greenL || C.green) : (C.redL || C.red), fontFamily: MONO, fontVariantNumeric: "tabular-nums" }}>
                              {s.avgChange >= 0 ? "+" : ""}{s.avgChange}%
                            </div>
                            <div className="text-xs mt-0.5" style={{ color: C.text3 }}>
                              {t("tabs.quantReport.sectorCellMeta", { count: s.count, pct: (s.upRatio * 100).toFixed(0) })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              {/* ── 급등/급락 TOP 5 — 시안 리스트 카드 어법(도트 헤더 + mono 등락) ── */}
              {hotAssets.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {[
                    { title: t("tabs.quantReport.surgeTop5"), dot: C.green, rows: topGainers },
                    { title: t("tabs.quantReport.plungeTop5"), dot: C.red, rows: topLosers },
                  ].map(sec => (
                    <ListCard key={sec.title}>
                      <div className="flex items-center gap-2" style={{ padding: "13px 14px", borderBottom: `1px solid ${C.card2}` }}>
                        <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: sec.dot }} />
                        <span style={{ fontSize: "14px", fontWeight: 800, color: C.text1 }}>{sec.title}</span>
                      </div>
                      {sec.rows.map((a, i) => (
                        <div key={a.symbol} onTouchStart={onTouchCardStart} onTouchMove={onTouchCardMove}
                          onClick={() => { if (isTouchTap()) setSelectedAsset(a); }}
                          className="flex items-center gap-2.5 cursor-pointer" style={{
                            padding: "11px 14px",
                            borderBottom: i < sec.rows.length - 1 ? `1px solid ${C.card2}` : "none",
                          }}>
                          <Num size="12px" weight={800} color={C.text4} style={{ width: "18px", flexShrink: 0 }}>{i + 1}</Num>
                          <span className="flex-1 min-w-0 truncate" style={{ fontSize: "14px", fontWeight: 700, color: C.text1 }}>{a.market === "kr" ? "🇰🇷" : a.market === "crypto" ? "₿" : "🇺🇸"} {a.name}</span>
                          <ChangeNum value={a.change} size="13px" />
                        </div>
                      ))}
                    </ListCard>
                  ))}
                </div>
              )}

              {/* ── 오늘 상승 신호 종목 — 시안 리스트(이름·티커 / ▲점수 / 가격·등락) ── */}
              {topPicks.length > 0 && (
                <div>
                  <MobileSectionHeader title={t("tabs.quantReport.todayBuySignalStocks")} live style={{ marginBottom: "8px" }} />
                  <ListCard>
                    {topPicks.map((pick, i) => {
                      const flag = pick.market === "kr" ? "🇰🇷" : "🇺🇸";
                      return (
                        <div key={pick.symbol} role="button" tabIndex={0}
                          onClick={() => setSelectedAsset(pick)}
                          onTouchEnd={(e) => { e.preventDefault(); setSelectedAsset(pick); }}
                          className="flex items-center gap-3 cursor-pointer" style={{
                            padding: "13px 14px",
                            borderBottom: i < topPicks.length - 1 ? `1px solid ${C.card2}` : "none",
                            WebkitTapHighlightColor: "transparent",
                          }}>
                          <div className="flex-1 min-w-0">
                            <div className="truncate" style={{ fontSize: "14px", fontWeight: 700, color: C.text1 }}>{flag} {pick.name}</div>
                            <div style={{ fontSize: "11px", color: C.text3, marginTop: "1px" }}>
                              <span style={{ fontFamily: MONO }}>{pick.symbol.replace(/\.(KS|KQ)$/, "")}</span> · {pick.reason}
                            </div>
                          </div>
                          <span style={{ fontSize: "10px", fontWeight: 800, padding: "3px 8px", borderRadius: "8px", background: `${C.green}1A`, color: C.greenL || C.green, flexShrink: 0 }}>▲ {pick.score}</span>
                          <div style={{ textAlign: "right", flexShrink: 0, minWidth: "72px" }}>
                            {pick.price != null && (
                              <div><Num size="13px">{pick.market === "kr" ? `₩${Math.round(pick.price).toLocaleString()}` : `$${pick.price.toFixed(2)}`}</Num></div>
                            )}
                            <div style={{ marginTop: "1px" }}><ChangeNum value={pick.change} size="11px" /></div>
                          </div>
                        </div>
                      );
                    })}
                  </ListCard>
                </div>
              )}

              {/* 종목별 퀀트 전략 Top 10 — 클릭하면 상세 팝업에서 백테스트 확인 */}
              {topPicks.length > 0 && (
                <div className="rounded-[16px] p-5" style={{ background: C.card, border: `1px solid ${C.border}` }}>
                  <div className="flex items-center justify-between mb-3">
                    <span style={{ fontSize: "15px", fontWeight: 800, color: C.text1 }}>{t("tabs.quantReport.perStockStrategies")}</span>
                    <span className="text-sm" style={{ color: C.text3 }}>{t("tabs.quantReport.touchForBacktest")}</span>
                  </div>
                  {topPicks.map((pick, i) => {
                    const flag = pick.market === "kr" ? "🇰🇷" : "🇺🇸";
                    const hot = hotAssets.find(h => h.symbol === pick.symbol);
                    const d = hot ? quickDiagnosis(hot) : null;
                    return (
                      <div key={pick.symbol} role="button" tabIndex={0}
                        onClick={() => setSelectedAsset(pick)}
                        onTouchEnd={(e) => { e.preventDefault(); setSelectedAsset(pick); }}
                        className="flex items-center gap-2.5 py-3 cursor-pointer rounded-lg" style={{
                          borderBottom: i < topPicks.length - 1 ? `1px solid ${C.border}08` : "none",
                          WebkitTapHighlightColor: "transparent",
                      }}>
                        <div className="size-8 rounded-[10px] flex-shrink-0 flex items-center justify-center text-lg font-black" style={{
                          background: `${C.blue}15`, color: C.blue,
                        }}>{i + 1}</div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <span className="font-bold text-lg" style={{ color: C.text1 }}>{flag} {pick.name}</span>
                            {d && (
                              <span className="text-sm font-bold px-1.5 py-0.5 rounded" style={{
                                background: d.opinionColor === "green" ? `${C.green}18` : d.opinionColor === "red" ? `${C.red}18` : `${C.yellow}18`,
                                color: d.opinionColor === "green" ? C.green : d.opinionColor === "red" ? C.red : C.yellow,
                              }}>{verdictLabel(d.opinion, t)}</span>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm" style={{ color: C.text3 }}>{pick.reason}</span>
                            {d && <span className="text-sm" style={{ color: C.text3 }}>{t("tabs.quantReport.diagScore", { score: d.score })}</span>}
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <div><ChangeNum value={pick.change} size="14px" /></div>
                          <div className="text-sm font-bold px-2.5 py-0.5 rounded text-center mt-1" style={{ color: C.blueL || C.blue, background: `${C.blue}12`, border: `1px solid ${C.blue}30` }}>📊 {t("tabs.quantReport.backtestBadge")}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* 오늘의 시장 상태 요약 (표현 3원칙 — 행동 지시 대신 상태 서술만) */}
              <div className="rounded-[16px] p-5" style={{ background: C.card, border: `1px solid ${C.border}` }}>
                <div style={{ fontSize: "15px", fontWeight: 800, color: C.text1, marginBottom: "10px" }}>{t("tabs.quantReport.todaySummaryTitle")}</div>
                <div className="flex flex-col gap-2">
                  {(() => {
                    const actions = [];
                    if (mktScore >= 60) actions.push({ icon: "🟢", text: t("tabs.quantReport.sumBull"), color: C.green });
                    else if (mktScore >= 45) actions.push({ icon: "🟡", text: t("tabs.quantReport.sumMixed"), color: C.yellow });
                    else actions.push({ icon: "🔴", text: t("tabs.quantReport.sumBear"), color: C.red });
                    if (anomalies.length > 0) actions.push({ icon: "⚡", text: t("tabs.quantReport.sumAnomaly", { n: anomalies.length }), color: C.yellow });
                    if (buyPicks > 3) actions.push({ icon: "🎯", text: t("tabs.quantReport.sumBuySignals", { n: buyPicks }), color: C.green });
                    if (sellPicks > 3) actions.push({ icon: "🛡️", text: t("tabs.quantReport.sumSellSignals", { n: sellPicks }), color: C.red });
                    if (fg && fg <= 25) actions.push({ icon: "💎", text: t("tabs.quantReport.sumExtremeFear"), color: C.purple });
                    if (fg && fg >= 75) actions.push({ icon: "⚠️", text: t("tabs.quantReport.sumExtremeGreed"), color: C.red });
                    const vix = marketIndices.find(i => i.symbol === "^VIX");
                    if (vix?.price > 30) actions.push({ icon: "🌊", text: t("tabs.quantReport.sumVixHigh", { v: vix.price.toFixed(1) }), color: C.red });
                    if (portfolio.length > 0 && benchmarkData) {
                      if (benchmarkData.myReturn < -5) actions.push({ icon: "📊", text: t("tabs.quantReport.sumPortfolioLoss"), color: C.yellow });
                      else if (benchmarkData.alpha > 3) actions.push({ icon: "🏆", text: t("tabs.quantReport.sumAlpha", { a: benchmarkData.alpha.toFixed(1) }), color: C.green });
                    }
                    return actions.map((a, i) => (
                      <div key={i} className="flex items-center gap-2.5" style={{
                        padding: "10px 12px", borderRadius: "12px",
                        background: `${a.color}0D`, border: `1px solid ${a.color}1F`,
                      }}>
                        <span style={{ fontSize: "16px", flexShrink: 0 }}>{a.icon}</span>
                        <span style={{ fontSize: "14px", fontWeight: 600, color: C.text1 }}>{a.text}</span>
                      </div>
                    ));
                  })()}
                </div>
              </div>

              {/* 시장 상태 종합 (표현 3원칙 — 행동 지시 대신 상태 서술만) */}
              <div className="rounded-[16px] p-5" style={{
                background: `linear-gradient(180deg, ${mktColor}14, transparent 42%), ${C.card}`,
                border: `1px solid ${C.border}`, borderLeft: `3px solid ${mktColor}`,
              }}>
                <div style={{ fontSize: "15px", fontWeight: 800, color: C.text1, marginBottom: "10px" }}>{t("tabs.quantReport.overallStatusTitle")}</div>
                <div style={{ fontSize: "14px", color: C.text2, lineHeight: 1.8 }}>
                  {mktScore >= 70
                    ? t("tabs.quantReport.statusStrongBull", { sp: sp ? `${sp.change >= 0 ? "+" : ""}${sp.change}%` : "", pct: advDecl.toFixed(0), buyPicks }) + (fg && fg > 75 ? " " + t("tabs.quantReport.statusOverheatNote") : "")
                    : mktScore >= 55
                    ? t("tabs.quantReport.statusWeakBull", { upCount, dnCount, fgPart: fg ? t("tabs.quantReport.statusFgPart", { fg, label: fg <= 40 ? t("tabs.home.fear") : fg <= 60 ? t("tabs.home.neutral") : t("tabs.home.greed") }) : t("tabs.quantReport.statusFgFallback") })
                    : mktScore >= 45
                    ? t("tabs.quantReport.statusMixed", { upCount, dnCount })
                    : mktScore >= 30
                    ? t("tabs.quantReport.statusWeakBear", { dnCount }) + (fg && fg <= 30 ? " " + t("tabs.quantReport.statusFearNote") : "")
                    : t("tabs.quantReport.statusStrongBear")}
                </div>
                <div className="flex gap-2 mt-3.5 flex-wrap">
                  <span style={{ fontSize: "12px", fontWeight: 800, padding: "4px 10px", borderRadius: "8px", background: `${mktColor}1A`, color: mktColorHi, fontFamily: MONO, fontVariantNumeric: "tabular-nums" }}>{t("tabs.quantReport.chipScore", { score: mktScore })}</span>
                  <span style={{ fontSize: "12px", fontWeight: 700, padding: "4px 10px", borderRadius: "8px", background: C.card2, color: C.text3, fontFamily: MONO, fontVariantNumeric: "tabular-nums" }}>{t("tabs.quantReport.chipAdv", { pct: advDecl.toFixed(0) })}</span>
                  {fg && <span style={{ fontSize: "12px", fontWeight: 700, padding: "4px 10px", borderRadius: "8px", background: C.card2, color: C.text3, fontFamily: MONO, fontVariantNumeric: "tabular-nums" }}>{t("tabs.quantReport.chipFg", { fg })}</span>}
                  {dailyPicks.length > 0 && (
                    <span style={{ fontSize: "12px", fontWeight: 700, padding: "4px 10px", borderRadius: "8px", background: C.card2, color: C.text3, fontFamily: MONO, fontVariantNumeric: "tabular-nums" }}>{t("tabs.quantReport.chipBuy", { n: buyPicks })}</span>
                  )}
                </div>
              </div>
                </>
              )}

              {/* 면책 — quant-report 는 공개 탭이므로 탭 내부 고지 필수 (2026-08 전수 감사) */}
              <Disclaimer style={{ fontSize: "13px", padding: "0 4px" }}>
                {t("tabs.quantReport.disclaimer")}
              </Disclaimer>
            </div>
          );
        })()}


        {/* ═══════════════════════════════════════════════════════════
            TAB: 백테스트
        ═══════════════════════════════════════════════════════════ */}
        {tab === "backtest" && isOwner && (
          <div style={{
            background: `linear-gradient(135deg, ${C.blueBg} 0%, ${C.card} 100%)`,
            borderRadius: "24px", padding: "24px",
            boxShadow: `0 4px 20px rgba(59,130,246,0.08)`,
          }}>
            <Suspense fallback={<LazyTabFallback />}><BacktestPanel initialStrategy={btStrategy} initialSymbol={btSymbol} /></Suspense>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════
            TAB: 코인 (/crypto · 내부 id "news") — ★ 2026-08-12 IA v3 (시안 1a ·
            설계서 v3 2장). 구 뉴스 슬롯을 자산군 이원화에 따라 코인 탭으로 재편.
            ① 시장 컨텍스트 4카드(온도·공포탐욕·김프·펀딩 — indicators/summary,
               탭 → 산식·해설 확장 시트. 구 지표 허브 게이지 데이터를 흡수)
            ② 파생 지표 바(coin-scores oc 유니버스 집계: OI 24h·롱숏·24h 청산
               롱/숏 게이지(Coinalyze 실데이터) + 스테이블 유동성)
            ③ 코인 시그널 카드 리스트(전 유니버스, 점수순 — 홈 미리보기와 동일 소스·카드 문법)
            ④ 신선도 캡션(실측 ts) + 면책. 뉴스 피드는 지표 탭 뉴스 서브탭으로 이동.
            청산 "맵"(가격대 클러스터)은 데이터 소스 확보 전 — 24h 요약까지만(가짜 금지).
        ═══════════════════════════════════════════════════════════ */}
        {tab === "news" && (() => {
          // tone → 텍스트 하이라이트 색 (uiKit toneColor 의 텍스트 대비 보정판 — AA)
          const toneHi = (tone) => tone === "up" ? (C.greenL || C.green)
            : tone === "down" ? (C.redL || C.red)
            : tone === "hot" ? C.orange
            : tone === "cold" ? (C.blueL || C.blue) : C.text3;
          const ctxById = {};
          (coinCtx || []).forEach(ind => { if (ind?.id) ctxById[ind.id] = ind; });
          // ① 컨텍스트 4카드 — 값이 실린 지표만 (부분 실패는 해당 카드만 생략)
          const ctxCards = [
            { id: "market-temp", label: t("tabs.coin.ctxTemp") },
            { id: "fear-greed", label: t("tabs.coin.ctxFearGreed") },
            { id: "kimchi", label: t("tabs.coin.ctxKimchi") },
            { id: "funding-avg", label: t("tabs.coin.ctxFunding") },
          ].map(c => ({ ...c, ind: ctxById[c.id] })).filter(c => c.ind && c.ind.value != null);
          // ② 파생 지표 — 시그널 풀의 oc 필드(btc-cron 적재 실데이터)를 표본이 있는 것만 집계
          const pool = Array.isArray(coinTabSignals) ? coinTabSignals : [];
          const ocOf = (s) => (s && s.oc && typeof s.oc === "object") ? s.oc : null;
          const oiVals = pool.map(s => Number(ocOf(s)?.oiChg24h)).filter(Number.isFinite);
          const lsVals = pool.map(s => Number(ocOf(s)?.lsRatio)).filter(v => Number.isFinite(v) && v > 0);
          const avgOf = (a) => a.reduce((x, y) => x + y, 0) / a.length;
          const oiAvg = oiVals.length ? avgOf(oiVals) : null;
          const lsAvg = lsVals.length ? avgOf(lsVals) : null;
          let liqLongUsd = 0, liqShortUsd = 0, liqSampled = 0;
          pool.forEach(s => {
            const lq = ocOf(s)?.liq;
            const L = Number(lq?.liqLongUsd), S = Number(lq?.liqShortUsd);
            if (Number.isFinite(L) && Number.isFinite(S)) { liqLongUsd += L; liqShortUsd += S; liqSampled++; }
          });
          const liqTotal = liqLongUsd + liqShortUsd;
          const liqLongPct = liqTotal > 0 ? Math.round((liqLongUsd / liqTotal) * 100) : null;
          const fmtUsdCompact = (v) => v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B`
            : v >= 1e6 ? `$${Math.round(v / 1e6)}M`
            : `$${Math.round(v / 1e3).toLocaleString()}K`;
          const stableInd = ctxById["stablecoin-liquidity"];
          const derivRows = [];
          if (oiAvg != null) derivRows.push({
            k: t("tabs.coin.oiAvg"),
            v: `${oiAvg >= 0 ? "+" : ""}${oiAvg.toFixed(1)}%`,
            s: oiAvg > 0 ? t("tabs.coin.oiUp") : oiAvg < 0 ? t("tabs.coin.oiDown") : t("tabs.home.neutral"),
            c: oiAvg > 0 ? (C.greenL || C.green) : oiAvg < 0 ? (C.redL || C.red) : C.text3,
          });
          if (lsAvg != null) derivRows.push({
            k: t("tabs.coin.globalLs"),
            v: lsAvg.toFixed(2),
            s: lsAvg > 1 ? t("tabs.home.longDominant") : lsAvg < 1 ? t("tabs.home.shortDominant") : t("tabs.home.neutral"),
            c: lsAvg > 1 ? (C.greenL || C.green) : lsAvg < 1 ? (C.redL || C.red) : C.text3,
          });
          if (stableInd && stableInd.value != null) derivRows.push({
            k: t("tabs.coin.stable"),
            v: `${stableInd.value}${stableInd.unit || ""}`,
            s: stableInd.label || "—",
            c: toneHi(stableInd.tone),
          });
          const derivSampled = Math.max(oiVals.length, lsVals.length, liqSampled);
          const hasDeriv = derivRows.length > 0 || (liqLongPct != null);
          // ③ 시그널 리스트 — score 내림차순 (설계서: 전 유니버스, 점수순)
          const rows = pool
            .filter(s => s && (s.side === "LONG" || s.side === "SHORT") && Number.isFinite(Number(s.score)))
            .slice()
            .sort((a, b) => Number(b.score) - Number(a.score));
          const newestTs = rows.reduce((m, s) => Math.max(m, Number(s?.ts) || 0), 0);
          const fresh = coinScoreFreshness(newestTs, t);
          const TF_LABEL = { "1w": t("tabs.coin.tf1w"), "1d": t("tabs.coin.tf1d"), "4h": t("tabs.coin.tf4h"), "1h": t("tabs.coin.tf1h") };
          // updatedAt(ISO) → "MM.DD HH:MM 기준" (확장 시트용 — 파싱 실패 시 표기 생략)
          const fmtCtxUpdated = (iso) => {
            if (!iso) return null;
            const d = new Date(iso);
            if (isNaN(d.getTime())) return null;
            const p = (n) => String(n).padStart(2, "0");
            return t("tabs.coin.asOf", { time: `${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}` });
          };
          // 자체 지수 해설(서버 렌더 SEO 페이지) — 구 지표 허브의 진입 링크 승계 (설계서 v3 4장)
          const INDEX_PAGE_BY_ID = { "market-temp": "/index/market-temp", "funding-squeeze": "/index/funding-squeeze", "alt-heat": "/index/alt-heat" };
          const ctxSkeleton = coinCtx === null;
          return (
            <div className="tab-content">
              {/* ── 헤더 — 시안 1a: 타이틀 + 신선도 알약(실측 ts — 없으면 생략) ── */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", marginBottom: "13px" }}>
                <h1 style={{ margin: 0, fontSize: isMobile ? "22px" : "24px", fontWeight: 800, color: C.text1, letterSpacing: "-0.01em" }}>{t("tabs.coin.title")}</h1>
                {fresh && (
                  <span style={{
                    fontSize: mf(11), fontWeight: 800, padding: "6px 11px", borderRadius: "9999px",
                    background: `${C.blue}1F`, color: C.isDark ? C.blueL : C.blue, whiteSpace: "nowrap", flexShrink: 0,
                  }}>↻ {fresh}</span>
                )}
              </div>

              <div style={!isMobile
                ? { display: "grid", gridTemplateColumns: "340px minmax(0, 1fr)", gap: "16px", alignItems: "start" }
                : { display: "flex", flexDirection: "column", gap: "13px" }}>

                {/* ── 좌측(데스크탑) / 상단(모바일): 컨텍스트 + 파생 지표 ── */}
                <div className={!isMobile ? "lg:sticky lg:top-20" : undefined} style={{ display: "flex", flexDirection: "column", gap: "13px" }}>
                  {/* ① 시장 컨텍스트 미니 카드 4 — 탭 → 산식·해설 시트 */}
                  {ctxSkeleton ? (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "9px" }}>
                      {[0, 1, 2, 3].map(i => <Skeleton key={`ctx-skel-${i}`} width="100%" height="72px" />)}
                    </div>
                  ) : ctxCards.length > 0 && (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "9px" }}>
                      {ctxCards.map(({ id, label, ind }) => (
                        <div key={id}
                          role="button" tabIndex={0}
                          aria-label={`${label} ${ind.value}${ind.unit || ""} — ${ind.label || ""}`}
                          onClick={() => setCoinCtxSheet(ind)}
                          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setCoinCtxSheet(ind); } }}
                          style={{
                            background: C.card, border: `1px solid ${C.border}`, borderRadius: "14px",
                            padding: "11px 13px", cursor: "pointer", WebkitTapHighlightColor: "transparent",
                          }}>
                          <div style={{ fontSize: mf(10), color: C.text3, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</div>
                          <div style={{ marginTop: "3px" }}><Num size="17px" weight={800}>{ind.value}{ind.unit || ""}</Num></div>
                          <div style={{ fontSize: mf(10), fontWeight: 700, marginTop: "2px", color: toneHi(ind.tone), whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{ind.label || "—"}</div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* ② 파생 지표 바 — oc 표본이 하나도 없으면 카드째 생략(빈 껍데기 금지) */}
                  {hasDeriv && (
                    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "16px", padding: "13px 14px" }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "9px" }}>
                        <span style={{ fontSize: mf(13), fontWeight: 800, color: C.text1 }}>{t("tabs.coin.derivTitle")}</span>
                        {derivSampled > 0 && <span style={{ fontSize: mf(10), color: C.text3 }}>{t("tabs.coin.sampleNote", { n: derivSampled })}</span>}
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                        {derivRows.map((d) => (
                          <div key={d.k} style={{ display: "flex", alignItems: "baseline", gap: "8px", fontSize: mf(12) }}>
                            <span style={{ width: "96px", flexShrink: 0, color: C.text3, fontWeight: 700 }}>{d.k}</span>
                            <Num size={mf(12)} weight={800}>{d.v}</Num>
                            <span style={{ marginLeft: "auto", fontWeight: 700, color: d.c }}>{d.s}</span>
                          </div>
                        ))}
                      </div>
                      {/* 24h 청산 요약 게이지 — Coinalyze 실데이터(oc.liq) 합산. 표본 없으면 생략 */}
                      {liqLongPct != null && (
                        <div style={{ marginTop: derivRows.length > 0 ? "11px" : 0, paddingTop: derivRows.length > 0 ? "11px" : 0, borderTop: derivRows.length > 0 ? `1px solid ${C.card2}` : "none" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "8px", fontSize: mf(11), marginBottom: "6px" }}>
                            <span style={{ color: C.text3, fontWeight: 700 }}>{t("tabs.coin.liq24h")} <Num size={mf(11)} weight={800}>{fmtUsdCompact(liqTotal)}</Num></span>
                            <span style={{ whiteSpace: "nowrap" }}>
                              <Num size={mf(11)} weight={800} color={C.redL || C.red}>{t("tabs.coin.liqLong", { n: liqLongPct })}</Num>
                              <span style={{ color: C.text4 }}> · </span>
                              <Num size={mf(11)} weight={800} color={C.greenL || C.green}>{t("tabs.coin.liqShort", { n: 100 - liqLongPct })}</Num>
                            </span>
                          </div>
                          {/* 롱 청산 = 하락 쓸림(빨강) / 숏 청산 = 상승 쓸림(초록) — 비중은 위 텍스트가 전달(색 단독 전달 아님) */}
                          <div aria-hidden="true" style={{ display: "flex", height: "8px", borderRadius: "4px", overflow: "hidden", gap: "2px" }}>
                            <span style={{ width: `${liqLongPct}%`, background: C.red, opacity: .85 }} />
                            <span style={{ flex: 1, background: C.green, opacity: .85 }} />
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* 지수 해설 링크 — 구 지표 허브 게이지(펀딩 스퀴즈·알트 과열 포함)의 진입점 승계.
                      /index/* 서버 렌더 SEO 페이지가 현재값+산식을 보여줍니다(고아 페이지 방지). */}
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                    <span style={{ fontSize: mf(11), color: C.text3, fontWeight: 700 }}>{t("tabs.coin.indexLinksLabel")}</span>
                    <HomeActionChip href="/index/market-temp" label={t("tabs.coin.indexTempLink")} />
                    <HomeActionChip href="/index/funding-squeeze" label={t("tabs.coin.indexFundingLink")} />
                    <HomeActionChip href="/index/alt-heat" label={t("tabs.coin.indexAltLink")} />
                  </div>
                </div>

                {/* ── 우측(데스크탑) / 하단(모바일): 코인 시그널 리스트 ── */}
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "7px" }}>
                    {rows.length > 0 && <span className="z-pulse" aria-hidden="true" style={{ width: "7px", height: "7px", borderRadius: "50%", background: C.green, flexShrink: 0 }} />}
                    <h2 style={{ margin: 0, fontSize: mf(14), fontWeight: 800, color: C.text1, whiteSpace: "nowrap" }}>{t("tabs.coin.signalsTitle")}</h2>
                    <span style={{ flex: 1 }} />
                    {/* 정렬은 점수순 고정 — 상태 서술 알약(죽은 드롭다운을 두지 않습니다) */}
                    {rows.length > 0 && (
                      <span style={{
                        fontSize: mf(11), fontWeight: 800, padding: "5px 11px", borderRadius: "9999px",
                        background: C.card, border: `1px solid ${C.border}`, color: C.text3, whiteSpace: "nowrap",
                      }}>{t("tabs.coin.sortByScore")}</span>
                    )}
                  </div>

                  {rows.length === 0 ? (
                    coinTabStatus === "loading" || coinTabStatus === "idle" ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: "9px" }}>
                        {[0, 1, 2].map(i => <Skeleton key={`cs-skel-${i}`} width="100%" height="96px" />)}
                      </div>
                    ) : (
                      /* 빈 상태(시안 1a) — 집계 전·전체 실패 공용. 문구는 실제 산출 주기 서술 */
                      <div style={{ border: `1.5px dashed ${C.border2}`, borderRadius: "16px", padding: "36px 24px", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: "6px" }}>
                        <div style={{ fontSize: mf(15), fontWeight: 800, color: C.text1 }}>{t("tabs.coin.emptyTitle")}</div>
                        <div style={{ fontSize: mf(12), color: C.text3, lineHeight: 1.6, maxWidth: "260px" }}>{t("tabs.coin.emptyDesc")}</div>
                        <button onClick={fetchCoinTabSignals} style={{
                          marginTop: "10px", padding: "11px 18px", borderRadius: "12px",
                          background: `${C.blue}1F`, color: C.isDark ? C.blueL : C.blue, border: "none",
                          fontSize: mf(13), fontWeight: 800, fontFamily: "inherit", cursor: "pointer", minHeight: "44px",
                        }}>{t("tabs.coin.retry")}</button>
                      </div>
                    )
                  ) : (
                    <div style={isMobile
                      ? { display: "flex", flexDirection: "column", gap: "9px" }
                      : { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: "10px", alignItems: "start" }}>
                      {rows.map((sig, i) => {
                        const dir = sig.side === "LONG" ? "up" : "down";
                        const bd = sig.breakdown || {};
                        const tfs = ["1w", "1d", "4h", "1h"].map(tf => ({
                          label: TF_LABEL[tf],
                          dir: bd[tf]?.side === "LONG" ? "up" : bd[tf]?.side === "SHORT" ? "down" : null,
                        }));
                        const sup = fmtLevelPrice(sig.sr?.s?.[0]?.p);
                        const res = fmtLevelPrice(sig.sr?.r?.[0]?.p);
                        const px = (sup || res) ? fmtLevelPrice(sig.sr?.px) : null;
                        return (
                          <Fragment key={`${sig.symbol || sig.asset || "sig"}-${i}`}>
                            <SignalCard
                              symbol={String(sig.symbol || sig.asset || "—").replace("USDT", "")}
                              sideLabel={t(sig.side === "LONG" ? "tabs.home.longDominant" : "tabs.home.shortDominant")}
                              dir={dir}
                              score={Math.round(Math.max(0, Math.min(100, Number(sig.score))))}
                              timeframes={tfs.some(x => x.dir) ? tfs : []}
                              support={sup}
                              price={px}
                              resistance={res}
                              onClick={() => setDetailSignal(sig)}
                            />
                            {/* ── Google AdSense (기존 뉴스 탭 in-feed 슬롯 승계 — 3번째 카드 뒤) ──
                                미채움 시 GoogleAd 가 0 높이로 접히므로, 그리드 자리는 항상
                                전폭 래퍼가 차지해 카드 사이 구멍이 생기지 않게 합니다. */}
                            {i === 2 && (
                              <div style={!isMobile ? { gridColumn: "1 / -1" } : undefined}>
                                <GoogleAd format="in-feed" slot="news-feed" />
                              </div>
                            )}
                          </Fragment>
                        );
                      })}
                    </div>
                  )}

                  {rows.length > 0 && (
                    <div style={{ fontSize: mf(11), color: C.text4 }}>
                      {/* 신선도(실측 ts)는 헤더 알약과 동일 값 — 여기는 출처만 서술해 이중 노출을 피합니다 */}
                      {t("tabs.home.signalSourceNote")}
                    </div>
                  )}

                  {/* ★ IA v3: 코인 조건 검색 진입점 — 주식 탭에서 걷어낸 코인 세그먼트의 대체 경로.
                       같은 스크리너를 crypto 필터로 열어 기능을 보존합니다(이동이지 제거 아님). */}
                  <button
                    onClick={() => { setFilterMarket("crypto"); setTab("screener"); }}
                    style={{
                      display: "flex", alignItems: "center", justifyContent: "center", gap: "7px",
                      width: "100%", padding: "12px", borderRadius: "12px", cursor: "pointer",
                      background: C.card, border: `1px solid ${C.border}`, color: C.text2,
                      fontSize: mf(13), fontWeight: 700, fontFamily: "inherit",
                    }}>
                    {t("tabs.coin.findByConditions")}
                    <span aria-hidden="true" style={{ color: C.blueL }}>→</span>
                  </button>
                </div>
              </div>

              <Disclaimer style={{ marginTop: "14px" }}>{t("tabs.coin.disclaimer")}</Disclaimer>

              {/* ── 컨텍스트 지표 확장 시트 — indicators/summary 의 desc/detail 실데이터 ── */}
              <BottomSheet open={!!coinCtxSheet} onClose={() => setCoinCtxSheet(null)} title={coinCtxSheet?.title || ""}>
                {coinCtxSheet && (
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "4px 2px 10px" }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: "8px" }}>
                      <Num size="28px" weight={800} color={toneHi(coinCtxSheet.tone)}>{coinCtxSheet.value}{coinCtxSheet.unit || ""}</Num>
                      {coinCtxSheet.label && <span style={{ fontSize: mf(13), fontWeight: 800, color: toneHi(coinCtxSheet.tone) }}>{coinCtxSheet.label}</span>}
                    </div>
                    {coinCtxSheet.desc && <div style={{ fontSize: mf(13), color: C.text2, lineHeight: 1.6 }}>{coinCtxSheet.desc}</div>}
                    {coinCtxSheet.detail && <div style={{ fontSize: mf(12), color: C.text3, lineHeight: 1.6, whiteSpace: "pre-line" }}>{coinCtxSheet.detail}</div>}
                    {fmtCtxUpdated(coinCtxSheet.updatedAt) && (
                      <div style={{ fontSize: mf(11), color: C.text4 }}>{fmtCtxUpdated(coinCtxSheet.updatedAt)}</div>
                    )}
                    {INDEX_PAGE_BY_ID[coinCtxSheet.id] && (
                      <div><HomeActionChip href={INDEX_PAGE_BY_ID[coinCtxSheet.id]} label={t("tabs.coin.indexDetailLink")} /></div>
                    )}
                  </div>
                )}
              </BottomSheet>
            </div>
          );
        })()}

        {/* ═══════════════════════════════════════════════════════════
            TAB: 지표 — 뉴스 서브탭 (/indicators?view=news)
            ★ 2026-08-12 IA v3 (시안 1c · 설계서 v3 4장): 구 뉴스 탭 구현을
            코드 이동(기능 보존) — 카테고리 칩·감성 정렬·요약 바·타임라인·
            빈 상태·읽을거리 전부 그대로, 헤더만 지표 탭 공통 규격으로 교체.
        ═══════════════════════════════════════════════════════════ */}
        {tab === "indicators" && indicatorsView === "news" && (
          <div className="tab-content">
            {/* 헤더 — 시안 1c: 타이틀 + 우측 액션 1개(새로고침 칩) */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", marginBottom: "13px" }}>
              <h1 style={{ margin: 0, fontSize: isMobile ? "22px" : "24px", fontWeight: 800, color: C.text1, letterSpacing: "-0.01em" }}>{t("tabs.indicators.title")}</h1>
              <button onClick={fetchNews} disabled={newsLoading} style={{
                padding: "8px 15px", borderRadius: "9999px", fontSize: mf(13), fontWeight: 800, fontFamily: "inherit",
                background: newsLoading ? C.card2 : `${C.blue}1F`, color: newsLoading ? C.text3 : (C.blueL || C.blue),
                border: "none", cursor: newsLoading ? "default" : "pointer", flexShrink: 0,
              }}>{newsLoading ? t("tabs.news.refreshing") : t("tabs.news.refresh")}</button>
            </div>

            {/* 서브탭 [캘린더|뉴스] — mobileKit Segment (딥링크 URL 동기화) */}
            <Segment
              value={indicatorsView}
              onChange={setIndicatorsViewWithUrl}
              options={[
                { value: "calendar", label: t("tabs.indicators.calendarTab") },
                { value: "news", label: t("tabs.indicators.newsTab") },
              ]}
              style={{ marginBottom: "13px" }}
            />

            {/* 카테고리 칩 — 값·핸들러 유지, 시안 알약 문법 (모바일 가로 스크롤) */}
            <div className={isMobile ? "hscroll" : ""} style={{ display: "flex", gap: "6px", flexWrap: isMobile ? "nowrap" : "wrap", overflowX: isMobile ? "auto" : "visible", WebkitOverflowScrolling: "touch", marginBottom: "10px" }}>
              {[
                ["all", t("tabs.news.all")],
                ["us", t("tabs.news.us")],
                ["kr", t("tabs.news.kr")],
                ["crypto", t("tabs.news.crypto")],
              ].map(([v, l]) => (
                <button key={v} onClick={() => setNewsCat(v)} style={{
                  padding: "8px 15px", borderRadius: "9999px", fontSize: mf(13), fontWeight: newsCat === v ? 800 : 700,
                  background: newsCat === v ? C.blue : C.card,
                  color: newsCat === v ? "#fff" : C.text3,
                  border: `1px solid ${newsCat === v ? C.blue : C.border}`,
                  cursor: "pointer", transition: "all .15s", flexShrink: 0, whiteSpace: "nowrap", fontFamily: "inherit",
                }}>{l}</button>
              ))}
            </div>

            {/* 감성 정렬 — 시안의 도트 알약 (기존 newsSort 값·핸들러 유지) */}
            <div style={{ display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap", marginBottom: "13px" }}>
              <span style={{ fontSize: mf(11), color: C.text3, fontWeight: 700 }}>{t("tabs.news.sortLabel")}</span>
              {[
                ["time", t("tabs.news.latest"), C.blue, C.blueL || C.blue],
                ["positive", t("tabs.news.positive"), C.green, C.greenL || C.green],
                ["negative", t("tabs.news.negative"), C.red, C.redL || C.red],
              ].map(([v, l, base, hi]) => {
                const on = newsSort === v;
                return (
                  <button key={v} onClick={() => setNewsSort(v)} style={{
                    display: "inline-flex", alignItems: "center", gap: "5px",
                    padding: "6px 12px", borderRadius: "9999px", fontSize: mf(12), fontWeight: 700, fontFamily: "inherit",
                    background: on ? `${base}1A` : C.card,
                    border: `1px solid ${on ? `${base}59` : C.border}`,
                    color: on ? hi : C.text3,
                    cursor: "pointer", transition: "all .15s", flexShrink: 0, whiteSpace: "nowrap",
                  }}>
                    <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: base, flexShrink: 0 }} />
                    {l}
                  </button>
                );
              })}
            </div>

            {/* 센티먼트 요약 바 — 기존 기능 유지, 시안 카드 문법으로 감쌈 (상태 서술) */}
            {sortedNews.length > 0 && (() => {
              const posCnt = sortedNews.filter(n => analyzeSentiment(n.title) === "positive").length;
              const negCnt = sortedNews.filter(n => analyzeSentiment(n.title) === "negative").length;
              const neuCnt = sortedNews.length - posCnt - negCnt;
              return (
                <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "12px", padding: "10px 13px", marginBottom: "13px" }}>
                  <div style={{ display: "flex", height: "6px", borderRadius: "9999px", overflow: "hidden" }}>
                    <div style={{ width: `${(posCnt / sortedNews.length) * 100}%`, background: C.green, transition: "width .5s" }} />
                    <div style={{ width: `${(neuCnt / sortedNews.length) * 100}%`, background: `${C.text3}40`, transition: "width .5s" }} />
                    <div style={{ width: `${(negCnt / sortedNews.length) * 100}%`, background: C.red, transition: "width .5s" }} />
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: mf(11), marginTop: "6px" }}>
                    <span style={{ color: C.greenL || C.green, fontWeight: 700 }}>{t("tabs.news.positive")} {posCnt}</span>
                    <span style={{ color: C.text3 }}>{t("tabs.news.neutral")} {neuCnt}</span>
                    <span style={{ color: C.redL || C.red, fontWeight: 700 }}>{t("tabs.news.negative")} {negCnt}</span>
                  </div>
                </div>
              );
            })()}

            {newsLoading ? (
              <div className="flex flex-col gap-2">
                {[1,2,3,4].map(i => <div key={i} className="skeleton rounded-[12px]" style={{ height: "100px" }} />)}
              </div>
            ) : sortedNews.length === 0 ? (
              /* ★ 2026-08 시안 1d 빈 상태 — 점선 컨테이너 + 아이콘 타일.
                 ① 필터 결과 없음(수신 데이터는 있음) → 필터 초기화  ② 수신 자체가 없음 → 새로고침 */
              newsItems.length > 0 ? (
                <div style={{ border: `1.5px dashed ${C.border2}`, borderRadius: "16px", padding: "36px 24px", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: "6px" }}>
                  <div style={{ width: "52px", height: "52px", borderRadius: "16px", background: C.card2, color: C.text3, display: "flex", alignItems: "center", justifyContent: "center" }} aria-hidden="true">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /><line x1="8" y1="11" x2="14" y2="11" /></svg>
                  </div>
                  <div style={{ fontSize: mf(15), fontWeight: 800, color: C.text1, marginTop: "8px" }}>{t("tabs.news.emptyFilterTitle")}</div>
                  {/* 감성(newsSort)은 정렬만 하므로 빈 결과의 원인은 카테고리 필터뿐 — 문구를 실제 동작에 맞춤 */}
                  <div style={{ fontSize: mf(12), color: C.text3, lineHeight: 1.6, maxWidth: "260px" }}>{t("tabs.news.emptyFilterDesc")}</div>
                  <button onClick={() => { setNewsCat("all"); setNewsSort("time"); }} style={{
                    marginTop: "10px", padding: "11px 18px", borderRadius: "12px",
                    background: `${C.blue}1F`, color: C.blueL || C.blue, border: "none",
                    fontSize: mf(13), fontWeight: 800, fontFamily: "inherit", cursor: "pointer", minHeight: "44px",
                  }}>{t("tabs.news.resetFilter")}</button>
                </div>
              ) : (
                <div style={{ border: `1.5px dashed ${C.border2}`, borderRadius: "16px", padding: "36px 24px", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: "6px" }}>
                  <div style={{ width: "52px", height: "52px", borderRadius: "16px", background: C.card2, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "22px" }} aria-hidden="true">📰</div>
                  <div style={{ fontSize: mf(15), fontWeight: 800, color: C.text1, marginTop: "8px" }}>{t("tabs.news.emptyTitle")}</div>
                  <div style={{ fontSize: mf(12), color: C.text3, lineHeight: 1.6, maxWidth: "260px" }}>{t("tabs.news.emptyDesc")}</div>
                  <button onClick={fetchNews} disabled={newsLoading} aria-label={t("tabs.news.refreshAria")} style={{
                    marginTop: "10px", padding: "11px 18px", borderRadius: "12px",
                    background: newsLoading ? C.card2 : `${C.blue}1F`, color: newsLoading ? C.text3 : (C.blueL || C.blue), border: "none",
                    fontSize: mf(13), fontWeight: 800, fontFamily: "inherit", cursor: newsLoading ? "default" : "pointer", minHeight: "44px",
                  }}>{newsLoading ? t("tabs.news.loadingBtn") : t("tabs.news.refreshNow")}</button>
                </div>
              )
            ) : (
              /* ★ 2026-07 정보 피벗 Phase 1: 카드 그리드 → 코인니스식 타임라인 리스트
                 (시간 HH:MM · 제목 · 소스 · 센티먼트 배지 — fetch 로직·데이터는 기존 그대로)
                 ★ 2026-08 시안 1d: 행 문법 재정렬 — 시간·감성 도트+타임라인 줄기 / 감성 텍스트 배지+카테고리
                 / 제목 2줄 클램프 / 출처. API 분류(category) 우선 — 미분류는 카테고리 표기 생략. */
              <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "16px", overflow: "hidden" }}>
                {sortedNews.map((news, i) => {
                  const sentiment = analyzeSentiment(news.title);
                  const sentColor = sentiment === "positive" ? C.green : sentiment === "negative" ? C.red : C.text3;
                  const sentHi = sentiment === "positive" ? (C.greenL || C.green) : sentiment === "negative" ? (C.redL || C.red) : C.text3;
                  const sentLabel = sentiment === "positive" ? t("tabs.news.positive") : sentiment === "negative" ? t("tabs.news.negative") : t("tabs.news.neutral");
                  const catKey = news.category || (Array.isArray(news.categories) ? news.categories[0] : null);
                  const catLabel = ({ "us-stock": t("tabs.news.catUs"), "kr-stock": t("tabs.news.catKr"), "crypto": t("tabs.news.catCrypto"), "macro": t("tabs.news.catMacro") })[catKey] || null;
                  const pubDate = new Date(news.date || news.publishedAt || news.pubDate || 0);
                  const validDate = !isNaN(pubDate.getTime()) && pubDate.getTime() > 0;
                  const hhmm = validDate ? `${String(pubDate.getHours()).padStart(2, "0")}:${String(pubDate.getMinutes()).padStart(2, "0")}` : "--:--";
                  // 날짜 구분선 — 최신순 정렬일 때만 (다른 정렬은 날짜가 뒤섞여 무의미)
                  const dateLabelOf = (d) => {
                    const today = new Date(); const yst = new Date(Date.now() - 86400000);
                    const same = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
                    if (same(d, today)) return t("tabs.news.today");
                    if (same(d, yst)) return t("tabs.news.yesterday");
                    return t("tabs.news.dateMd", { m: d.getMonth() + 1, d: d.getDate() });
                  };
                  const showDateDivider = newsSort === "time" && validDate && (() => {
                    if (i === 0) return true;
                    const prev = new Date(sortedNews[i - 1].date || sortedNews[i - 1].publishedAt || sortedNews[i - 1].pubDate || 0);
                    return isNaN(prev.getTime()) || prev.toDateString() !== pubDate.toDateString();
                  })();
                  return (<div key={i}>
                    {showDateDivider && (
                      <div style={{
                        padding: "10px 16px 6px", fontSize: mf(12), fontWeight: 800, color: C.text3,
                        background: `${C.card2}50`, borderBottom: `1px solid ${C.card2}`,
                        letterSpacing: "0.3px",
                      }}>{dateLabelOf(pubDate)}</div>
                    )}
                    <a href={news.url || news.link || "#"} target="_blank" rel="noopener" style={{
                      display: "flex", gap: "11px", alignItems: "stretch",
                      padding: isMobile ? "13px 14px" : "13px 18px",
                      textDecoration: "none", color: "inherit",
                      borderBottom: i < sortedNews.length - 1 ? `1px solid ${C.card2}` : "none",
                      transition: "background .15s",
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = `${C.card2}60`}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                      {/* 시간 + 감성 도트 + 타임라인 줄기 */}
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "5px", flexShrink: 0, paddingTop: "2px" }}>
                        <span className="z-num" style={{ fontSize: mf(11), fontWeight: 700, color: C.text3, fontFamily: MONO, fontVariantNumeric: "tabular-nums" }}>{hhmm}</span>
                        <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: sentColor, flexShrink: 0 }} />
                        <span style={{ flex: 1, width: "1px", background: C.card2 }} />
                      </div>
                      {/* 감성 배지 + 카테고리 → 제목(2줄) → 요약 → 출처·태그 */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                          <span style={{
                            fontSize: mf(10), fontWeight: 800, padding: "2px 7px", borderRadius: "8px",
                            background: `${sentColor}1A`, color: sentHi,
                          }}>{sentLabel}</span>
                          {catLabel && <span style={{ fontSize: mf(10), color: C.text4, fontWeight: 700 }}>{catLabel}</span>}
                        </div>
                        <div style={{
                          fontWeight: 700, fontSize: mf(14), color: C.text1, lineHeight: 1.45, marginTop: "5px",
                          display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
                        }}>{news.title}</div>
                        {!isMobile && (news.desc || news.description) && (
                          <div style={{ fontSize: mf(13), color: C.text3, lineHeight: 1.5, marginTop: "3px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {(news.desc || news.description).slice(0, 120)}
                          </div>
                        )}
                        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "5px", flexWrap: "wrap" }}>
                          <span style={{ fontSize: mf(11), color: C.text3 }}>{news.source || "Unknown"}</span>
                          {news.tags?.length > 0 && news.tags.slice(0, 2).map((tag, ti) => (
                            <span key={ti} style={{ padding: "1px 7px", borderRadius: "5px", fontSize: mf(11), background: C.card2, color: C.text3, fontWeight: 500 }}>{tag}</span>
                          ))}
                        </div>
                      </div>
                    </a>
                    {/* ── Google AdSense (News - In-Feed after 3rd item) ─── */}
                    {i === 2 && <GoogleAd format="in-feed" slot="news-feed" style={{ margin: "12px 0" }} />}
                  </div>);
                })}
              </div>
            )}

            {/* 시안 1d 하단 면책 — 감성 분류 상태 서술 */}
            <Disclaimer style={{ marginTop: "12px" }}>{t("tabs.news.sentimentDisclaimer")}</Disclaimer>

            {/* ── 읽을거리 — 블로그 아티클 진입 (★ 2026-07 정보 피벗 Phase 1) ── */}
            <div style={{ background: C.card, border: `1px solid ${C.border}20`, borderRadius: "16px", padding: "20px", marginTop: "16px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
                <span style={{ fontWeight: 800, fontSize: "16px", color: C.text1 }}>📚 {t("tabs.news.readings")}</span>
                <a href="/blog" style={{ fontSize: "13px", fontWeight: 700, color: C.blue, textDecoration: "none" }}>{t("tabs.news.blogAll")}</a>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(2, 1fr)", gap: "8px" }}>
                {[
                  { href: "/blog/rsi-divergence.html", title: "RSI 다이버전스 — 추세 전환을 미리 알아채는 법" },
                  { href: "/blog/macd-golden-cross.html", title: "MACD 골든크로스 — 실전 백테스트 검증" },
                  { href: "/blog/portfolio-rebalancing.html", title: "포트폴리오 리밸런싱이란? 자동화 방법까지" },
                  { href: "/blog/korea-vs-us-stocks.html", title: "한국 주식 vs 미국 주식 — 진짜 차이점 7가지" },
                  { href: "/blog/sharpe-ratio-profit-factor.html", title: "Sharpe Ratio · Profit Factor — 전략 평가 핵심 지표" },
                  { href: "/blog/hurst-explained.html", title: "Hurst 지수란? 추세장과 박스권 구분하는 법" },
                ].map((post, i) => (
                  <a key={i} href={post.href} style={{
                    display: "flex", alignItems: "center", gap: "10px",
                    padding: "12px 14px", borderRadius: "12px",
                    background: `${C.card2}50`, border: `1px solid ${C.border}15`,
                    textDecoration: "none", transition: "all .15s",
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = `${C.blue}10`; e.currentTarget.style.borderColor = `${C.blue}30`; }}
                  onMouseLeave={e => { e.currentTarget.style.background = `${C.card2}50`; e.currentTarget.style.borderColor = `${C.border}15`; }}>
                    <span style={{ fontSize: "16px", flexShrink: 0 }}>📄</span>
                    <span style={{ fontSize: mf(13), fontWeight: 600, color: C.text2, lineHeight: 1.4, overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{post.title}</span>
                  </a>
                ))}
              </div>
            </div>

          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════
            TAB: 지표 — 캘린더 서브탭 (/indicators)
            ★ 2026-08-12 IA v3 (시안 1c · 설계서 v3 4장): 구 경제 캘린더 탭 구현을
            코드 이동(기능 보존) — 주간 스트립·미니캘린더·AI 요약·해석 펼침 전부
            그대로, 헤더만 지표 탭 공통 규격([캘린더|뉴스] 서브탭)으로 교체.
            구 지표 허브(IndicatorHub 게이지 그리드)는 폐지 — 게이지 데이터는 코인 탭
            컨텍스트 카드·홈 스냅샷이 흡수했고 /index/* 해설 링크는 코인 탭이 승계.
        ═══════════════════════════════════════════════════════════ */}
        {tab === "indicators" && indicatorsView === "calendar" && (() => {
          // 오늘 기준 캘린더 데이터
          const today = new Date();
          const firstDay = new Date(calYear, calMonth, 1).getDay(); // 0=일
          const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
          const calLocale = lang === "en" ? "en-US" : "ko-KR";
          // 요일 짧은 표기 — 2024-01-01(월) 기준 결정적 산출 (로케일 대응)
          const weekdayShortMon = Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 1 + i).toLocaleDateString(calLocale, { weekday: "short" }));
          const weekdayShortSun = Array.from({ length: 7 }, (_, i) => new Date(2023, 11, 31 + i).toLocaleDateString(calLocale, { weekday: "short" }));

          // 주차별 이벤트 그룹화
          const getWeekOfMonth = (date) => Math.ceil((date.getDate() + new Date(date.getFullYear(), date.getMonth(), 1).getDay()) / 7);
          const eventsByWeek = {};
          const calFilterTabs = [
            { key: "all", label: t("tabs.econCalendar.filterAll") },
            { key: "경제지표", label: t("tabs.econCalendar.economicIndicators") },
            { key: "FOMC", label: t("tabs.econCalendar.fomc") },
            { key: "CPI", label: t("tabs.econCalendar.cpi") },
            { key: "NFP", label: t("tabs.econCalendar.employment") },
            { key: "GDP", label: t("tabs.econCalendar.gdp") },
          ];

          // 이벤트 필터링
          let calEvents = econEvents;
          if (econFilter !== "all") {
            calEvents = econEvents.filter(e => {
              if (econFilter === "경제지표") return true;
              return e.type === econFilter;
            });
          }
          // ★ 날짜 필터 적용 '전' 목록 보존 — 미니캘린더 점/클릭 가능 판정용
          //   (대표 제보: 10일 선택 중엔 11일이 클릭 불가였던 버그 — eventDates 가
          //    날짜 필터 후 목록으로 계산돼 다른 날짜의 hasEvent 가 사라졌음)
          const calEventsAllDays = calEvents;
          // ★ 2026-06-12 (대표 지시): 날짜 선택 시 해당일 이벤트만 — 전체 주차 나열·과스크롤 제거
          if (calSelectedDay != null) {
            calEvents = calEvents.filter(e => {
              const k = kstParts(e.date);
              return k.valid && k.year === calYear && k.month === calMonth && k.date === calSelectedDay;
            });
          }

          // 주차 계산용 헬퍼 (KST 기준 — kstParts 결과 사용)
          const kstWeekOf = (k) => {
            // 해당 월 1일의 KST 요일 + 일자로 주차 계산
            // (실제 Date 객체 없이 산술만 — 안전)
            const firstDayKstShift = new Date(Date.UTC(k.year, k.month, 1) + 9 * 3600000);
            const firstDayKey = firstDayKstShift.getUTCDay();
            return Math.ceil((k.date + firstDayKey) / 7);
          };
          calEvents.forEach(evt => {
            const k = kstParts(evt.date);
            if (!k.valid) return; // invalid 이벤트는 그룹화에서 제외
            const wk = kstWeekOf(k);
            const weekKey = `${k.year}-${String(k.month+1).padStart(2,"0")}-W${wk}`;
            const monthLabel = t("tabs.econCalendar.yearMonth", { y: k.year, m: k.month + 1 });
            const weekLabel = t("tabs.econCalendar.weekN", { n: wk });
            if (!eventsByWeek[weekKey]) eventsByWeek[weekKey] = { monthLabel, weekLabel, events: [] };
            eventsByWeek[weekKey].events.push(evt);
          });
          const weekGroups = Object.values(eventsByWeek).sort((a, b) => {
            const aFirst = a.events[0]?.date || 0;
            const bFirst = b.events[0]?.date || 0;
            return aFirst - bFirst;
          });

          // 오늘 이벤트 AI 요약
          const todayEvents = econEvents.filter(e => e.daysUntil === 0);
          const importantToday = todayEvents.filter(e => /FOMC|CPI|NFP|GDP|PCE|ISM|PMI/i.test(e.name)).slice(0, 5);

          // 이번주 핵심 이벤트 AI 요약
          const thisWeekEvents = econEvents.filter(e => e.daysUntil >= 0 && e.daysUntil <= 7);
          const importantThisWeek = thisWeekEvents.filter(e => /FOMC|CPI|NFP|GDP|PCE|ISM|PMI/i.test(e.name)).slice(0, 3);

          // 이벤트가 있는 날짜 세트 — 날짜 필터 '전' 목록 기준 (다른 날짜 직접 전환 가능)
          const eventDates = new Set();
          calEventsAllDays.forEach(evt => {
            const k = kstParts(evt.date);
            if (k.valid && k.month === calMonth && k.year === calYear) {
              eventDates.add(k.date);
            }
          });

          // ── 시안 1c: 모바일 주간 날짜 스트립 데이터 (월~일) ──
          //   미니캘린더의 날짜 필터·달 이동 기능은 주 단위 내비게이션으로 그대로 유지합니다.
          //   주가 월 경계를 걸칠 수 있어 이벤트 유무는 연·월·일 키로 판정합니다.
          const stripAnchor = calWeekAnchorMs != null ? new Date(calWeekAnchorMs) : new Date();
          const stripMon = new Date(stripAnchor.getFullYear(), stripAnchor.getMonth(), stripAnchor.getDate() - ((stripAnchor.getDay() + 6) % 7));
          const stripDays = Array.from({ length: 7 }, (_, i) => {
            const dd = new Date(stripMon.getFullYear(), stripMon.getMonth(), stripMon.getDate() + i);
            return { y: dd.getFullYear(), m: dd.getMonth(), d: dd.getDate(), w: weekdayShortMon[i] };
          });
          const eventDayKeys = new Set();
          calEventsAllDays.forEach(evt => {
            const k = kstParts(evt.date);
            if (k.valid) eventDayKeys.add(`${k.year}-${k.month}-${k.date}`);
          });
          const moveWeek = (dir) => {
            // DST 타임존에서도 정오/자정 경계 밀림 없이 정확히 7일 이동하도록
            // 밀리초 산술 대신 달력 산술을 사용합니다 (fall-back 주간 무동작 버그 방지)
            const nd = new Date(stripMon.getFullYear(), stripMon.getMonth(), stripMon.getDate() + dir * 7);
            setCalWeekAnchorMs(nd.getTime());
            setCalSelectedDay(null);
            // 헤더의 조회 월 알약·선택일 필터 기준을 새 주의 월요일 기준으로 동기화
            setCalYear(nd.getFullYear());
            setCalMonth(nd.getMonth());
          };

          return (
            <div className="tab-content">
              {/* ── 헤더 — 시안 1c: 지표 타이틀 + 조회 월 알약(상태 표시 — 액션 아님) ── */}
              <div className="flex items-center justify-between gap-2" style={{ marginBottom: "13px" }}>
                <h1 style={{ margin: 0, fontSize: isMobile ? "22px" : "24px", fontWeight: 800, letterSpacing: "-0.01em", color: C.text1 }}>{t("tabs.indicators.title")}</h1>
                <span style={{ fontSize: "12px", fontWeight: 800, padding: "5px 12px", borderRadius: "9999px", background: C.card, border: `1px solid ${C.border}`, color: C.text2, fontFamily: MONO }}>{t("tabs.indicators.monthPill", { y: calYear, m: calMonth + 1 })}</span>
              </div>

              {/* 서브탭 [캘린더|뉴스] — mobileKit Segment (딥링크 URL 동기화) */}
              <Segment
                value={indicatorsView}
                onChange={setIndicatorsViewWithUrl}
                options={[
                  { value: "calendar", label: t("tabs.indicators.calendarTab") },
                  { value: "news", label: t("tabs.indicators.newsTab") },
                ]}
                style={{ marginBottom: "13px" }}
              />

              {/* 캡션 + 발표 결과 아카이브(/econ 서버 렌더 SEO 페이지) 진입 승계 */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", flexWrap: "wrap", marginBottom: "16px" }}>
                <span style={{ fontSize: "13px", color: C.text3 }}>{t("tabs.indicators.calendarCaption")}</span>
                <HomeActionChip href="/econ" label={t("tabs.indicators.econArchiveLink")} />
              </div>

              <div className="grid gap-7 grid-cols-1 lg:grid-cols-[280px_1fr] items-start">

                {/* ── 좌측: 미니 캘린더 + AI 요약 ── */}
                <div className="flex flex-col gap-4 lg:sticky lg:top-20">
                  {/* ── 시안 1c: 주간 날짜 스트립(모바일) — 날짜 필터·주(월) 이동은 미니캘린더와 동일 배선 ── */}
                  {isMobile && (
                    <div>
                      <div className="flex items-center justify-between" style={{ marginBottom: "8px" }}>
                        <button onClick={() => moveWeek(-1)} aria-label={t("tabs.econCalendar.prevWeek")}
                          className="bg-transparent border-none text-lg cursor-pointer p-1" style={{ color: C.text2 }}>‹</button>
                        <Num size="12px" weight={800} color={C.text2}>{stripMon.getMonth() + 1}.{stripMon.getDate()} – {stripDays[6].m + 1}.{stripDays[6].d}</Num>
                        <button onClick={() => moveWeek(1)} aria-label={t("tabs.econCalendar.nextWeek")}
                          className="bg-transparent border-none text-lg cursor-pointer p-1" style={{ color: C.text2 }}>›</button>
                      </div>
                      <div className="grid" style={{ gridTemplateColumns: "repeat(7, 1fr)", gap: "5px" }}>
                        {stripDays.map(sd => {
                          const cellToday = sd.d === today.getDate() && sd.m === today.getMonth() && sd.y === today.getFullYear();
                          const hasEvent = eventDayKeys.has(`${sd.y}-${sd.m}-${sd.d}`);
                          const cellSelected = calSelectedDay === sd.d && calMonth === sd.m && calYear === sd.y;
                          return (
                            <div key={`${sd.y}-${sd.m}-${sd.d}`} onClick={() => {
                              if (!hasEvent) return;
                              if (cellSelected) setCalSelectedDay(null);
                              else { setCalYear(sd.y); setCalMonth(sd.m); setCalSelectedDay(sd.d); }
                            }} style={{
                              display: "flex", flexDirection: "column", alignItems: "center", gap: "4px",
                              padding: "9px 0 7px", borderRadius: "12px",
                              background: cellToday ? C.blue : cellSelected ? `${C.blue}1F` : C.card,
                              border: `1px solid ${cellToday ? C.blue : cellSelected ? `${C.blue}55` : C.border}`,
                              cursor: hasEvent ? "pointer" : "default", transition: "all 0.15s",
                            }}>
                              <span style={{ fontSize: "10px", fontWeight: 700, color: cellToday ? "rgba(255,255,255,.8)" : C.text3 }}>{sd.w}</span>
                              <Num size="14px" weight={800} color={cellToday ? "#fff" : cellSelected ? (C.blueL || C.blue) : hasEvent ? C.text1 : C.text4}>{sd.d}</Num>
                              <span style={{ width: "4px", height: "4px", borderRadius: "50%", background: hasEvent ? (cellToday ? "#fff" : C.blue) : "transparent" }} />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* 미니 캘린더(데스크탑) — 시안 셀 어법(mono 날짜 + 이벤트 도트) */}
                  {!isMobile && (
                  <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "16px", padding: "16px" }}>
                    <div className="flex items-center justify-between mb-4">
                      <button onClick={() => { setCalSelectedDay(null); if (calMonth === 0) { setCalMonth(11); setCalYear(y => y-1); } else setCalMonth(m => m-1); }}
                        className="bg-transparent border-none text-lg cursor-pointer p-1" style={{color: C.text2}}>‹</button>
                      <span style={{ fontSize: "15px", fontWeight: 800, color: C.text1 }}>{new Date(calYear, calMonth, 1).toLocaleDateString(calLocale, { year: "numeric", month: "long" })}</span>
                      <button onClick={() => { setCalSelectedDay(null); if (calMonth === 11) { setCalMonth(0); setCalYear(y => y+1); } else setCalMonth(m => m+1); }}
                        className="bg-transparent border-none text-lg cursor-pointer p-1" style={{color: C.text2}}>›</button>
                    </div>
                    {/* 요일 헤더 */}
                    <div className="grid gap-1 mb-1" style={{ gridTemplateColumns: "repeat(7, 1fr)" }}>
                      {weekdayShortMon.map(d => (
                        <div key={d} className="text-center py-1" style={{ fontSize: "10px", fontWeight: 700, color: C.text3 }}>{d}</div>
                      ))}
                    </div>
                    {/* 날짜 그리드 */}
                    <div className="grid gap-1" style={{ gridTemplateColumns: "repeat(7, 1fr)" }}>
                      {/* 빈칸 (월요일 기준) */}
                      {Array.from({ length: (firstDay + 6) % 7 }).map((_, i) => <div key={`e-${i}`} />)}
                      {Array.from({ length: daysInMonth }).map((_, i) => {
                        const day = i + 1;
                        const isToday = day === today.getDate() && calMonth === today.getMonth() && calYear === today.getFullYear();
                        const hasEvent = eventDates.has(day);
                        const isSelected = calSelectedDay === day && !isToday;
                        return (
                          <div key={day} onClick={() => {
                            // ★ 2026-06-12 (대표 지시): 날짜 클릭 = 해당일만 필터 (스크롤 이동 → 필터 토글)
                            if (hasEvent) setCalSelectedDay(prev => prev === day ? null : day);
                          }} style={{
                            textAlign: "center", padding: "6px 0 4px", borderRadius: "10px",
                            fontFamily: MONO, fontVariantNumeric: "tabular-nums",
                            fontSize: "13px", fontWeight: isToday || isSelected ? 800 : 600,
                            color: isToday ? "#fff" : isSelected ? (C.blueL || C.blue) : hasEvent ? C.text1 : C.text4,
                            background: isToday ? C.blue : isSelected ? `${C.blue}1F` : "transparent",
                            cursor: hasEvent ? "pointer" : "default",
                            transition: "all 0.15s",
                          }}
                          onMouseEnter={e => { if (hasEvent && !isToday && !isSelected) e.currentTarget.style.background = `${C.blue}10`; }}
                          onMouseLeave={e => { if (!isToday && !isSelected) e.currentTarget.style.background = "transparent"; }}>
                            {day}
                            {/* 도트 슬롯은 항상 렌더 — 줄 높이 흔들림 방지(시안 셀 규격) */}
                            <div style={{ width: "4px", height: "4px", borderRadius: "50%", background: hasEvent ? (isToday ? "#fff" : C.blue) : "transparent", margin: "2px auto 0" }} />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  )}

                  {/* AI 오늘의 경제 이벤트 요약 — 좌측 3px 보더 + 상단 그라데이션(시안 카드 어법) */}
                  {importantToday.length > 0 && (
                    <div style={{
                      background: `linear-gradient(180deg, ${C.red}14, transparent 42%), ${C.card}`,
                      border: `1px solid ${C.border}`, borderLeft: `3px solid ${C.red}`,
                      borderRadius: "16px", padding: "14px 16px",
                    }}>
                      <div className="flex items-center gap-2 mb-3">
                        <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: C.red }} />
                        <span style={{ fontSize: "14px", fontWeight: 800, color: C.text1 }}>{t("tabs.econCalendar.todayEvents")}</span>
                      </div>
                      <div style={{ fontSize: "13px", color: C.text1, lineHeight: 1.55 }}>
                        {importantToday.map((evt, i) => {
                          const k = kstParts(evt.date);
                          const timeStr = k.valid ? `${String(k.hour).padStart(2,"0")}:${String(k.min).padStart(2,"0")}` : "—";
                          const resultStr = evt.actual && evt.estimate
                            ? (parseFloat(evt.actual) > parseFloat(evt.estimate) ? `${t("tabs.econCalendar.resultUp")} 💚` : `${t("tabs.econCalendar.resultDown")} 📉`)
                            : evt.status === "완료" ? t("tabs.econCalendar.resultDone") : t("tabs.econCalendar.resultScheduled");
                          return (
                            <div key={i} style={{ marginBottom: i < importantToday.length - 1 ? "10px" : 0 }}>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px" }}>
                                <div style={{ flex: 1 }}>
                                  <strong>{evt.icon} {evt.name}</strong>
                                  <div style={{ fontSize: "12px", color: C.text2, marginTop: "3px" }}>
                                    <span style={{ fontFamily: MONO, fontVariantNumeric: "tabular-nums" }}>{timeStr}</span> {evt.importance === "high" ? `🔴 ${t("tabs.econCalendar.impHigh")}` : `🟡 ${t("tabs.econCalendar.impMid")}`}
                                  </div>
                                </div>
                                <div style={{ fontSize: "13px", fontWeight: 700, color: evt.actual && parseFloat(evt.actual) > parseFloat(evt.estimate) ? (C.greenL || C.green) : (C.redL || C.red) }}>
                                  {resultStr}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* AI 이번주 요약 — 블루 accent 카드(시안 어법) */}
                  {importantThisWeek.length > 0 && (
                    <div style={{
                      background: `linear-gradient(180deg, ${C.blue}12, transparent 42%), ${C.card}`,
                      border: `1px solid ${C.border}`, borderLeft: `3px solid ${C.blue}`,
                      borderRadius: "16px", padding: "14px 16px",
                    }}>
                      <div className="flex items-center gap-1.5 mb-3">
                        <span style={{ fontSize: "14px", fontWeight: 800, color: C.blueL || C.blue }}>✦ {t("tabs.econCalendar.weeklyAiSummary")}</span>
                      </div>
                      <div style={{ fontSize: "13.5px", color: C.text1, lineHeight: 1.6 }}>
                        {importantThisWeek.map((evt, i) => {
                          const k = kstParts(evt.date);
                          const dayName = k.valid ? weekdayShortSun[k.day] : "";
                          return (
                            <div key={i} style={{ marginBottom: i < importantThisWeek.length - 1 ? "8px" : 0 }}>
                              <strong>{evt.name}</strong> {k.valid ? t("tabs.econCalendar.scheduledOn", { d: k.date, day: dayName }) : t("tabs.econCalendar.scheduledSoon")}
                            </div>
                          );
                        })}
                      </div>
                      {/* "자세히 보기 ›" 가짜 링크 제거(2026-08) — onClick 없는 순수 텍스트가
                          링크처럼 보였고, 우측 컬럼이 이미 전체 이벤트 목록을 보여줘 기능 중복입니다. */}
                    </div>
                  )}

                  {/* ── Google AdSense (Economic Calendar - Rectangle, desktop only) ─── */}
                  {!isMobile && <GoogleAd format="rectangle" slot="calendar-sidebar" style={{ margin: "16px 0", maxWidth: "300px" }} />}
                </div>

                {/* ── 우측: 이벤트 목록 ── */}
                <div>
                  {/* 필터 — mobileKit Segment (기존 econFilter 상태·핸들러 유지) */}
                  <Segment
                    options={calFilterTabs.map(ft => ({ value: ft.key, label: ft.label }))}
                    value={econFilter}
                    onChange={setEconFilter}
                    style={{ marginBottom: "16px" }}
                  />

                  {/* 선택일 필터 안내 칩 */}
                  {calSelectedDay != null && (
                    <div style={{
                      display: "flex", alignItems: "center", gap: 8, marginBottom: 12,
                      padding: "10px 14px", borderRadius: 12, background: C.blueBg, border: `1px solid ${C.blue}30`,
                    }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: C.blue }}>
                        📌 {t("tabs.econCalendar.dayFilterNotice", { m: calMonth + 1, d: calSelectedDay })}
                      </span>
                      <button onClick={() => setCalSelectedDay(null)} style={{
                        marginLeft: "auto", padding: "6px 12px", borderRadius: 8, border: `1px solid ${C.blue}40`,
                        background: "transparent", color: C.blue, fontSize: 13, fontWeight: 700, cursor: "pointer", minHeight: 32,
                      }}>{t("tabs.econCalendar.viewAllX")}</button>
                    </div>
                  )}

                  {/* 주차별 이벤트 그룹 — 시안 1c 이벤트 카드 어법 */}
                  {weekGroups.length === 0 ? (
                    <div style={{ border: `1.5px dashed ${C.border2}`, borderRadius: "16px", padding: "44px 24px", display: "flex", flexDirection: "column", alignItems: "center", gap: "6px", textAlign: "center" }}>
                      <div style={{ width: "52px", height: "52px", borderRadius: "16px", background: C.card2, display: "flex", alignItems: "center", justifyContent: "center", color: C.text3 }}>
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
                      </div>
                      <div style={{ fontSize: "15px", fontWeight: 800, color: C.text1, marginTop: "8px" }}>{calSelectedDay != null ? t("tabs.econCalendar.emptyDayTitle") : t("tabs.econCalendar.emptyFilterTitle")}</div>
                      <div style={{ fontSize: "12.5px", color: C.text3, lineHeight: 1.6, maxWidth: "260px" }}>{t("tabs.econCalendar.emptyDesc")}</div>
                      {(calSelectedDay != null || econFilter !== "all") && (
                        <button onClick={() => { setCalSelectedDay(null); setEconFilter("all"); }} style={{ marginTop: "10px", padding: "11px 18px", borderRadius: "12px", background: `${C.blue}1A`, color: C.blueL || C.blue, border: "none", fontSize: "13px", fontWeight: 800, fontFamily: "inherit", cursor: "pointer" }}>{t("tabs.econCalendar.viewAllEvents")}</button>
                      )}
                    </div>
                  ) : weekGroups.map((group, gi) => {
                    // 주차별 ID 생성 (날짜 클릭 → 스크롤 대상)
                    const firstEvtDate = group.events[0]?.date ? new Date(group.events[0].date.toLocaleString("en-US", { timeZone: "Asia/Seoul" })) : null;
                    const weekId = firstEvtDate ? `econ-week-${firstEvtDate.getFullYear()}-${String(firstEvtDate.getMonth()+1).padStart(2,"0")}-W${Math.ceil((firstEvtDate.getDate() + new Date(firstEvtDate.getFullYear(), firstEvtDate.getMonth(), 1).getDay()) / 7)}` : `econ-week-${gi}`;
                    return (
                    <div key={gi} id={weekId} className="mb-8" style={{ scrollMarginTop: "80px" }}>{/* 간격 보강 (대표 피드백) */}
                      {/* 주차 헤더 */}
                      <div style={{ fontSize: "13px", fontWeight: 800, color: C.text2, margin: "0 2px 10px" }}>
                        {group.monthLabel} {group.weekLabel}
                      </div>

                      {/* 이벤트 카드 목록 */}
                      <div className="flex flex-col" style={{ gap: "9px" }}>
                        {group.events.map((evt, i) => {
                          const k = kstParts(evt.date);
                          const d = k.valid ? k.date : "—";
                          const dayName = k.valid ? weekdayShortSun[k.day] : "";
                          const invertedIndicator = /CPI|PCE|PPI|Unemployment|Jobless/i.test(evt.event); // 낮을수록 호재 계열
                          const hasActual = evt.actual != null && evt.estimate != null;
                          const beat = hasActual ? (invertedIndicator ? evt.actual < evt.estimate : evt.actual > evt.estimate) : null;
                          const miss = hasActual ? (invertedIndicator ? evt.actual > evt.estimate : evt.actual < evt.estimate) : null;
                          const isPast = evt.daysUntil < 0;
                          const isToday = evt.status === "오늘";
                          const kstHour = k.valid ? String(k.hour).padStart(2, "0") : "--";
                          const kstMin = k.valid ? String(k.min).padStart(2, "0") : "--";

                          // ★ 2026-06-12 (대표 지시): 행 클릭 → 지표 해석 펼침 ("그래서 호재야 악재야?")
                          const gType = ECON_GUIDE[evt.type] ? evt.type : "OTHER";
                          const guideT = (field) => t(`tabs.econCalendar.guide.${gType}.${field}`);
                          const guideHasNote = !!ECON_GUIDE[gType].note;
                          const verdict = econVerdict(evt, t);
                          const rowKey = `${evt.event}-${evt.date?.getTime?.() ?? i}`;
                          const expanded = econExpandedKey === rowKey;
                          const verdictColor = verdict ? (verdict.tone === "good" ? C.green : verdict.tone === "bad" ? C.red : C.yellow) : C.text3;
                          const verdictHi = verdict ? (verdict.tone === "good" ? (C.greenL || C.green) : verdict.tone === "bad" ? (C.redL || C.red) : (C.yellowL || C.yellow)) : C.text3;
                          // 중요도 배지 — 색+텍스트 병기(색만으로 전달하지 않음, 시안 배지 어법)
                          const impBg = evt.importance === "high" ? `${C.red}1A` : `${C.yellow}1A`;
                          const impColor = evt.importance === "high" ? (C.redL || C.red) : (C.yellowL || C.yellow);
                          const cardBorder = expanded ? `${C.blue}55` : evt.importance === "high" && !isPast ? `${C.red}30` : C.border;
                          return (
                            <div key={rowKey}
                              onClick={() => setEconExpandedKey(prev => prev === rowKey ? null : rowKey)}
                              style={{
                                background: isToday ? `linear-gradient(180deg, ${C.blue}0D, transparent 42%), ${C.card}` : C.card,
                                border: `1px solid ${cardBorder}`, borderRadius: "14px", padding: "13px 14px",
                                opacity: isPast && !expanded ? 0.65 : 1, cursor: "pointer", transition: "border-color .15s",
                              }}>
                              {/* 행 1: 날짜·시각(mono) / 시장 칩 / 지표명 / 중요도 배지 */}
                              <div className="flex items-center gap-2">
                                <div style={{ flexShrink: 0, minWidth: "40px" }}>
                                  <Num size="12px" weight={800} color={isToday ? (C.blueL || C.blue) : C.text2}>{d}{dayName}</Num>
                                  <div><Num size="10px" color={C.text3}>{kstHour}:{kstMin}</Num></div>
                                </div>
                                <span style={{ fontSize: "9.5px", fontWeight: 800, padding: "2px 6px", borderRadius: "6px", background: C.card2, color: C.text3, flexShrink: 0 }}>{evt.country || "US"}</span>
                                <span className="flex-1 min-w-0" style={{ fontSize: "13.5px", fontWeight: 700, color: C.text1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{evt.name}</span>
                                <span style={{ fontSize: "10px", fontWeight: 800, padding: "3px 8px", borderRadius: "8px", background: impBg, color: impColor, flexShrink: 0 }}>{evt.importance === "high" ? t("tabs.econCalendar.impHigh") : t("tabs.econCalendar.impMid")}</span>
                              </div>

                              {/* 행 2: 예측 · 이전 · 발표 (시안 3분할 박스, mono 수치) */}
                              <div className="flex gap-2" style={{ marginTop: "10px" }}>
                                <div style={{ flex: 1, background: C.card2, borderRadius: "10px", padding: "7px 10px" }}>
                                  <div style={{ fontSize: "9.5px", color: C.text3, fontWeight: 700 }}>{t("tabs.econCalendar.colForecast")}</div>
                                  <div style={{ marginTop: "1px" }}><Num size="13px" weight={800}>{evt.estimate != null ? `${evt.estimate}${evt.unit}` : "—"}</Num></div>
                                </div>
                                <div style={{ flex: 1, background: C.card2, borderRadius: "10px", padding: "7px 10px" }}>
                                  <div style={{ fontSize: "9.5px", color: C.text3, fontWeight: 700 }}>{t("tabs.econCalendar.colPrevious")}</div>
                                  <div style={{ marginTop: "1px" }}><Num size="13px" weight={800} color={C.text2}>{evt.previous != null ? `${evt.previous}${evt.unit}` : "—"}</Num></div>
                                </div>
                                <div style={{ flex: 1, background: C.card2, borderRadius: "10px", padding: "7px 10px" }}>
                                  <div style={{ fontSize: "9.5px", color: C.text3, fontWeight: 700 }}>{t("tabs.econCalendar.colActual")}</div>
                                  {evt.actual != null ? (
                                    <div style={{ marginTop: "1px" }}><Num size="13px" weight={800} color={beat ? (C.greenL || C.green) : miss ? (C.redL || C.red) : C.text1}>{evt.actual}{evt.unit}</Num></div>
                                  ) : (
                                    <div style={{ fontSize: "11px", fontWeight: 700, color: C.text3, marginTop: "3px" }}>
                                      {/* 3일 넘게 지난 지표에 "발표 대기"(아직 발표 전)는 사실과 다른 서술 —
                                          수치를 못 채운 상태를 "집계 없음"으로 정직하게 표기합니다. */}
                                      {isPast ? (evt.daysUntil < -3 ? t("tabs.econCalendar.noAggregate") : t("tabs.econCalendar.awaitingRelease")) : t("tabs.econCalendar.scheduledAtHour", { h: kstHour })}
                                    </div>
                                  )}
                                </div>
                              </div>

                              {/* 행 3: 해석 토글 — ★ 2026-06-12 (대표 피드백): 펼침 어포던스 항상 노출 유지 */}
                              <div style={{ fontSize: "11px", fontWeight: 700, color: C.blueL || C.blue, marginTop: "10px" }}>
                                {expanded ? t("tabs.econCalendar.guideCollapse") : t("tabs.econCalendar.guideExpand")}
                              </div>

                              {/* ── 해석 패널 (펼침) — 시안 블루 틴트 패널 */}
                              {expanded && (
                                <div onClick={(e) => e.stopPropagation()} style={{ marginTop: "11px", background: `${C.blue}0F`, border: `1px solid ${C.blue}40`, borderRadius: "12px", padding: "12px 13px", cursor: "default" }}>
                                  <div className="flex items-center gap-1.5">
                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={C.blueL || C.blue} strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><line x1="12" y1="11" x2="12" y2="16" /><line x1="12" y1="8" x2="12" y2="8.01" /></svg>
                                    <span style={{ fontSize: "11px", fontWeight: 800, color: C.blueL || C.blue }}>{t("tabs.econCalendar.guideTitle")}</span>
                                  </div>
                                  {/* 지표 설명 */}
                                  <div style={{ fontSize: 13, fontWeight: 700, color: C.text1, marginTop: 8, marginBottom: 4 }}>{t("tabs.econCalendar.whatIsThis", { name: guideT("name") })}</div>
                                  <div style={{ fontSize: 13, color: C.text2, lineHeight: 1.55, wordBreak: "keep-all" }}>{guideT("desc")}</div>

                                  {verdict ? (
                                    /* 발표 후 — 명확한 결론 */
                                    <div style={{ marginTop: 10, padding: "10px 12px", borderRadius: 10, background: `${verdictColor}12`, border: `1px solid ${verdictColor}30` }}>
                                      <div style={{ fontSize: 14, fontWeight: 800, color: verdictHi }}>
                                        {verdict.emoji} {t("tabs.econCalendar.riskAssetVerdict", { dir: verdict.dir })}
                                      </div>
                                      <div style={{ fontSize: 13, color: C.text2, marginTop: 4, lineHeight: 1.5, wordBreak: "keep-all" }}>
                                        {t("tabs.econCalendar.actualVsForecast", { actual: `${evt.actual}${evt.unit}`, est: `${evt.estimate}${evt.unit}` })}{evt.previous != null ? ` ${t("tabs.econCalendar.prevParen", { prev: `${evt.previous}${evt.unit}` })}` : ""} — {verdict.reason}
                                      </div>
                                      {verdict.note && <div style={{ fontSize: 12, color: C.text3, marginTop: 4, lineHeight: 1.5, wordBreak: "keep-all" }}>💡 {verdict.note}</div>}
                                    </div>
                                  ) : (
                                    /* 발표 전 — 방향 가이드 */
                                    <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
                                      <div style={{ fontSize: 13, lineHeight: 1.5, wordBreak: "keep-all" }}>
                                        <span style={{ fontWeight: 800, color: C.redL || C.red }}>{t("tabs.econCalendar.ifHigher")}</span>
                                        <span style={{ color: C.text2 }}> → {guideT("high")}</span>
                                      </div>
                                      <div style={{ fontSize: 13, lineHeight: 1.5, wordBreak: "keep-all" }}>
                                        <span style={{ fontWeight: 800, color: C.greenL || C.green }}>{t("tabs.econCalendar.ifLower")}</span>
                                        <span style={{ color: C.text2 }}> → {guideT("low")}</span>
                                      </div>
                                      {guideHasNote && <div style={{ fontSize: 12, color: C.text3, lineHeight: 1.5, wordBreak: "keep-all" }}>💡 {guideT("note")}</div>}
                                    </div>
                                  )}

                                  <div style={{ fontSize: 11, color: C.text3, marginTop: 8 }}>{t("tabs.econCalendar.guideDisclaimer")}</div>
                                  {/* 시안의 "관련" 링크 — 실제 배선(리스크맵 탭 이동)으로 연결 */}
                                  <button onClick={(e) => { e.stopPropagation(); setTab("risk-map"); }} style={{ display: "block", background: "none", border: "none", padding: 0, marginTop: 8, fontSize: 11, fontWeight: 700, color: C.blueL || C.blue, cursor: "pointer", fontFamily: "inherit" }}>{t("tabs.econCalendar.relatedRiskMap")}</button>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                  })}
                </div>
              </div>

              {/* 화면 하단 면책 — 시안 공통 한 줄 */}
              <Disclaimer style={{ marginTop: "16px" }}>{t("tabs.econCalendar.disclaimer")}</Disclaimer>
            </div>
          );
        })()}

        {/* ═══════════════════════════════════════════════════════════
            TAB: 알림
        ═══════════════════════════════════════════════════════════ */}
        {tab === "alerts" && isOwner && (
          <div className="tab-content">
            {/* 알림 히어로 헤더 — 극적인 그라데이션과 섀도우 */}
            <div style={{
              background: `linear-gradient(135deg, ${C.redBg} 0%, ${C.card} 100%)`,
              borderRadius: "24px",
              padding: "28px",
              marginBottom: "20px",
              boxShadow: `0 4px 20px rgba(255,77,100,0.08)`,
            }}>
              <div style={{
                fontWeight: 900,
                fontSize: "28px",
                color: C.text1,
                marginBottom: "8px",
              }}>🚨 {t("alerts.heroTitle")}</div>
              <div style={{
                fontSize: "16px",
                color: C.text2,
              }}>{t("alerts.heroDesc")}</div>
            </div>

            {/* ── 전략 매매 알림 피드 ── */}
            <div style={{
              background: `linear-gradient(135deg, ${C.card} 0%, ${C.card2} 100%)`,
              border: `1px solid ${C.border}20`,
              borderRadius: "16px",
              padding: "24px",
              marginBottom: "20px",
              boxShadow: "0 2px 12px rgba(0,0,0,0.2)",
            }} className="rounded-[16px]">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="font-bold text-lg">🚨 {t("alerts.tradeAlerts")}</div>
                  <div className="text-base text-muted-foreground mt-0.5">
                    {t("alerts.description")}
                  </div>
                </div>
                {tradeAlerts.length > 0 && (
                  <button onClick={() => {
                    if (!confirm(t("alerts.deleteConfirm"))) return;
                    setTradeAlerts([]); setAlertBadge(0);
                  }} className="px-3 py-1.5 rounded-lg text-sm font-semibold cursor-pointer" style={{
                    background: C.card2, color: C.text3, border: `1px solid ${C.border2}`,
                  }}>{t("alerts.deleteAll")}</button>
                )}
              </div>

              {/* 알림 설정 토글 */}
              <div className="flex gap-3 mb-3 flex-wrap">
                <label className="flex items-center gap-1.5 cursor-pointer text-sm text-muted-foreground">
                  <input type="checkbox" checked={settings.strategyAlerts !== false}
                    onChange={e => setSettings(p => ({ ...p, strategyAlerts: e.target.checked }))}
                    className="cursor-pointer" />
                  <span>{t("alerts.enableStrategyAlerts")}</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer text-sm text-muted-foreground">
                  <input type="checkbox" checked={settings.autoSend}
                    onChange={e => setSettings(p => ({ ...p, autoSend: e.target.checked }))}
                    className="cursor-pointer" />
                  <span>{t("alerts.enableTelegram")}</span>
                </label>
              </div>

              {/* ── 브라우저 푸시 알림 ── */}
              <div style={{
                background: notiPerm === "granted" ? C.greenBg : C.card2,
                borderRadius: "12px", padding: isMobile ? "16px" : "22px 24px", marginBottom: "12px",
                border: `1px solid ${notiPerm === "granted" ? C.green + "30" : notiPerm === "denied" ? C.red + "30" : C.border2}`,
              }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span style={{ fontSize: "18px" }}>{notiPerm === "granted" ? "🔔" : notiPerm === "denied" ? "🔕" : "🔔"}</span>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: "15px" }}>{t("alerts.pushNotification")}</div>
                      <div style={{ fontSize: "14px", color: C.text3 }}>
                        {notiPerm === "granted" ? `${t("alerts.enabled")} — ${t("alerts.enabledDesc")}`
                          : notiPerm === "denied" ? `${t("alerts.blocked")} — ${t("alerts.blockedDesc")}`
                          : notiPerm === "unsupported" ? t("alerts.unsupported")
                          : t("alerts.allowAlert")}
                      </div>
                    </div>
                  </div>
                  {notiPerm === "default" && (
                    <button onClick={async () => {
                      const perm = await Notification.requestPermission();
                      setNotiPerm(perm);
                      if (perm === "granted") {
                        new Notification(t("alerts.notifTitle"), {
                          body: t("alerts.notifBody"),
                          icon: "/favicon.ico",
                        });
                      }
                    }} style={{
                      padding: "10px 20px",
                      borderRadius: "12px",
                      fontSize: "16px",
                      fontWeight: 700,
                      cursor: "pointer",
                      background: `linear-gradient(135deg, ${C.blue}, ${C.purple})`,
                      color: "#fff",
                      border: "none",
                      whiteSpace: "nowrap",
                      minHeight: "44px",
                      boxShadow: `0 4px 16px ${C.blue}30`,
                      transition: "all .2s",
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.boxShadow = `0 6px 20px ${C.blue}40`;
                      e.currentTarget.style.transform = "translateY(-2px)";
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.boxShadow = `0 4px 16px ${C.blue}30`;
                      e.currentTarget.style.transform = "translateY(0)";
                    }}>{t("alerts.allowBtn")}</button>
                  )}
                  {notiPerm === "granted" && (
                    <span style={{ padding: "4px 10px", borderRadius: "6px", fontSize: "16px", fontWeight: 700, background: C.green + "20", color: C.green }}>ON</span>
                  )}
                  {notiPerm === "denied" && (
                    <span style={{ padding: "4px 10px", borderRadius: "6px", fontSize: "16px", fontWeight: 700, background: C.red + "20", color: C.red }}>{t("alerts.blocked_status")}</span>
                  )}
                </div>
              </div>

              {/* ── 자동 스캔 설정 ── */}
              <div style={{
                background: C.card2, borderRadius: "12px", padding: "14px", marginBottom: "16px",
                border: `1px solid ${settings.autoScanEnabled ? C.blue + "40" : C.border2}`,
              }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: settings.autoScanEnabled ? "12px" : "0" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span style={{ fontSize: "18px" }}>{settings.autoScanEnabled ? "🔄" : "⏸️"}</span>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: "18px" }}>{t("alerts.autoScan")}</div>
                      <div style={{ fontSize: "16px", color: C.text3 }}>
                        {settings.autoScanEnabled
                          ? t("alerts.autoScanEvery", { m: settings.autoScanInterval || 30 })
                          : t("alerts.disabled")}
                      </div>
                    </div>
                  </div>
                  <button onClick={() => setSettings(p => ({ ...p, autoScanEnabled: !p.autoScanEnabled }))} style={{
                    padding: "6px 14px", borderRadius: "8px", fontSize: "16px", fontWeight: 700, cursor: "pointer",
                    background: settings.autoScanEnabled ? C.blue : C.card, border: `1px solid ${settings.autoScanEnabled ? C.blue : C.border2}`,
                    color: settings.autoScanEnabled ? "#fff" : C.text2,
                  }}>{settings.autoScanEnabled ? "ON" : "OFF"}</button>
                </div>
                {settings.autoScanEnabled && (
                  <>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
                      <span style={{ fontSize: "16px", color: C.text2, minWidth: "50px" }}>{t("alerts.interval")}</span>
                      <div style={{ display: "flex", gap: "6px", flex: 1 }}>
                        {[15, 30, 60, 120].map(m => (
                          <button key={m} onClick={() => setSettings(p => ({ ...p, autoScanInterval: m }))} style={{
                            flex: 1, padding: "6px 0", borderRadius: "8px", fontSize: "16px", fontWeight: 600, cursor: "pointer",
                            background: (settings.autoScanInterval || 30) === m ? C.blueBg : "transparent",
                            color: (settings.autoScanInterval || 30) === m ? C.blue : C.text3,
                            border: `1px solid ${(settings.autoScanInterval || 30) === m ? C.blue + "40" : C.border2}`,
                          }}>{m < 60 ? t("alerts.intervalMin", { m }) : t("alerts.intervalHour", { h: m / 60 })}</button>
                        ))}
                      </div>
                    </div>
                    {nextAutoScan && (
                      <div style={{ fontSize: "16px", color: C.text3, display: "flex", alignItems: "center", gap: "4px" }}>
                        <span>⏰</span> {t("alerts.nextScan")}: {nextAutoScan.toLocaleTimeString(lang === "en" ? "en-US" : "ko-KR", { hour: "2-digit", minute: "2-digit" })}
                        {scanning && <span style={{ color: C.blue, fontWeight: 600 }}> — {t("alerts.scanning")}</span>}
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* 마켓 타입 필터 */}
              {tradeAlerts.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "12px" }}>
                  <div style={{ fontSize: "16px", color: C.text3, fontWeight: 600, alignSelf: "center", marginRight: "4px" }}>{t("alerts.marketFilter")}</div>
                  {[
                    ["all", t("alerts.all")],
                    ["us", t("alerts.us")],
                    ["kr", t("alerts.kr")],
                    ["crypto", t("alerts.crypto")],
                  ].map(([v, l]) => (
                    <button key={v} onClick={() => setAlertMarketFilter(v)} style={{
                      padding: "5px 12px", borderRadius: "8px", fontSize: "16px", fontWeight: 600,
                      background: alertMarketFilter === v ? C.blueBg : C.card2,
                      color: alertMarketFilter === v ? C.blue : C.text3,
                      border: `1px solid ${alertMarketFilter === v ? C.blue + "40" : "transparent"}`,
                      cursor: "pointer", transition: "all .15s",
                    }}>{l}</button>
                  ))}
                </div>
              )}

              {/* 시그널 타입 필터 탭 */}
              {tradeAlerts.length > 0 && (
                <div style={{ display: "flex", gap: "6px", marginBottom: "12px" }}>
                  <div style={{ fontSize: "16px", color: C.text3, fontWeight: 600, alignSelf: "center", marginRight: "4px" }}>{t("alerts.signalFilter")}</div>
                  {[
                    ["all", t("alerts.all"), tradeAlerts.length],
                    ["buy", t("alerts.buy"), tradeAlerts.filter(a => a.action === "매수").length],
                    ["sell", t("alerts.sell"), tradeAlerts.filter(a => a.action !== "매수").length],
                  ].map(([v, l, cnt]) => (
                    <button key={v} onClick={() => setAlertFilter(v)} style={{
                      padding: "6px 14px", borderRadius: "8px", fontSize: "16px", fontWeight: 600,
                      background: alertFilter === v ? (v === "buy" ? C.greenBg : v === "sell" ? C.redBg : C.blueBg) : C.card2,
                      color: alertFilter === v ? (v === "buy" ? C.green : v === "sell" ? C.red : C.blue) : C.text3,
                      border: `1px solid ${alertFilter === v ? (v === "buy" ? C.green + "40" : v === "sell" ? C.red + "40" : C.blue + "40") : "transparent"}`,
                      cursor: "pointer", transition: "all .15s",
                    }}>{l} <span style={{ opacity: 0.7 }}>{cnt}</span></button>
                  ))}
                </div>
              )}

              {/* 알림 피드 */}
              {tradeAlerts.length === 0 ? (
                <div style={{ textAlign: "center", padding: "40px 24px", color: C.text3 }}>
                  <div style={{ fontSize: "40px", marginBottom: "12px" }}>🔕</div>
                  <div style={{ fontSize: "18px", fontWeight: 600, marginBottom: "4px" }}>{t("alerts.noAlerts")}</div>
                  <div style={{ fontSize: "16px" }}>{t("alerts.noAlertsDesc")}</div>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "6px", maxHeight: "520px", overflow: "auto" }}>
                  {tradeAlerts.filter(a => {
                    const signalMatch = alertFilter === "all" ? true : alertFilter === "buy" ? a.action === "매수" : a.action !== "매수";
                    const marketMatch = alertMarketFilter === "all" ? true : a.market === alertMarketFilter;
                    return signalMatch && marketMatch;
                  }).slice(0, 50).map((alert, i) => {
                    const isBuy = alert.action === "매수";
                    const time = new Date(alert.timestamp);
                    const timeStr = time.toLocaleString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
                    return (
                      <div key={alert.id || i}
                        onTouchStart={onTouchCardStart} onTouchMove={onTouchCardMove}
                        onClick={() => {
                        if (!isTouchTap()) return;
                        // 클릭 시 해당 종목 상세로 이동
                        const asset = ALL_ASSETS.find(a => a.symbol === alert.symbol || a.symbolRaw === alert.symbolRaw);
                        if (asset) { setSelectedAsset(asset); setTab("screener"); }
                      }} style={{
                        background: `linear-gradient(135deg, ${C.card} 0%, ${C.card2} 100%)`,
                        borderRadius: "12px",
                        padding: "16px",
                        borderLeft: `4px solid ${isBuy ? C.green : C.red}`,
                        cursor: "pointer",
                        transition: "all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)",
                        opacity: alert.read ? 0.7 : 1,
                        minHeight: "44px",
                        boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
                      }}
                      onMouseEnter={e => {
                        const color = isBuy ? C.green : C.red;
                        e.currentTarget.style.boxShadow = `0 8px 20px ${color}30`;
                        e.currentTarget.style.transform = "translateY(-3px) scale(1.01)";
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.15)";
                        e.currentTarget.style.transform = "translateY(0) scale(1)";
                      }}>
                        {/* 상단: 전략명 + 시간 */}
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                            <span style={{
                              padding: "2px 8px", borderRadius: "6px", fontSize: "15px", fontWeight: 700,
                              background: isBuy ? C.greenBg : C.redBg,
                              color: isBuy ? C.green : C.red,
                            }}>{isBuy ? `📈 ${t("alerts.buy_badge")}` : `📉 ${t("alerts.sell_badge")}`}</span>
                            <span style={{ fontSize: "16px", fontWeight: 700, color: C.blue }}>{alert.strategy}</span>
                          </div>
                          <span style={{ fontSize: "15px", color: C.text3 }}>{timeStr}</span>
                        </div>
                        {/* 중단: 종목 정보 */}
                        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "6px" }}>
                          <div style={{
                            width: "32px", height: "32px", borderRadius: "8px", flexShrink: 0,
                            background: isBuy ? C.greenBg : C.redBg,
                            display: "flex", alignItems: "center", justifyContent: "center",
                            fontWeight: 800, fontSize: "16px", color: isBuy ? C.green : C.red,
                          }}>{alert.strategyIcon || alert.symbol.slice(0, 2)}</div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 700, fontSize: "18px" }}>
                              {alert.flag} {alert.name}
                            </div>
                            <div style={{ fontSize: "16px", color: C.text3 }}>
                              {alert.symbol} · {alert.market === "kr" ? `₩${Math.round(alert.price || 0).toLocaleString()}` : `$${(alert.price || 0).toLocaleString(undefined, {maximumFractionDigits: 2})}`}
                              {alert.change ? ` · ${Number(alert.change) >= 0 ? "+" : ""}${alert.change}%` : ""}
                            </div>
                          </div>
                        </div>
                        {/* 하단: 전략 시그널 사유 (실제 generate() 결과) */}
                        <div style={{ fontSize: "16px", color: C.text2, display: "flex", alignItems: "center", gap: "4px", flexWrap: "wrap" }}>
                          <span style={{ color: C.yellow }}>📌</span>
                          <span style={{ fontWeight: 600 }}>{alert.reason}</span>
                          {alert.recentSignalCount > 1 && (
                            <span style={{ padding: "1px 5px", borderRadius: "4px", fontSize: "14px", fontWeight: 700, background: isBuy ? C.greenBg : C.redBg, color: isBuy ? C.green : C.red }}>
                              {t("alerts.recentSignals", { n: alert.recentSignalCount })}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* ── 텔레그램 설정 ── */}
            <div style={{ background: C.card, border: `1px solid ${C.border}20`, borderRadius: "16px", padding: "22px 24px", marginBottom: "12px" }}>
              <div style={{ fontWeight: 700, fontSize: "18px", marginBottom: "16px" }}>📱 {t("alerts.telegram")}</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                <div>
                  <div style={{ fontSize: "16px", color: C.text3, marginBottom: "6px", fontWeight: 600 }}>{t("alerts.botToken")}</div>
                  <input value={settings.botToken} onChange={e => setSettings(p => ({ ...p, botToken: e.target.value }))}
                    placeholder="123456789:ABCdefGHIjklMNOpqrSTUvwxyz" type="password" style={{
                      width: "100%", padding: "10px 12px", borderRadius: "10px", fontSize: "16px",
                      background: C.bg, border: `1px solid ${C.border2}`, color: C.text1, outline: "none",
                    }} />
                </div>
                <div>
                  <div style={{ fontSize: "16px", color: C.text3, marginBottom: "6px", fontWeight: 600 }}>{t("alerts.chatId")}</div>
                  <input value={settings.chatId} onChange={e => setSettings(p => ({ ...p, chatId: e.target.value }))}
                    placeholder="1234567890" type="password" style={{
                      width: "100%", padding: "10px 12px", borderRadius: "10px", fontSize: "16px",
                      background: C.bg, border: `1px solid ${C.border2}`, color: C.text1, outline: "none",
                    }} />
                </div>
              </div>

              <div style={{ display: "flex", gap: "8px" }}>
                <button onClick={() => {
                  if (!settings.botToken || !settings.chatId) return;
                  (async () => {
                    setTgStatus(`⏳ ${t("alerts.sending")}`);
                    try {
                      const r = await fetch(`https://api.telegram.org/bot${settings.botToken}/sendMessage`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ chat_id: settings.chatId, text: "🚨 *Zepta 테스트*\n\n텔레그램 연결 테스트 성공!", parse_mode: "Markdown" }),
                      });
                      if (r.ok) setTgStatus(`✅ ${t("alerts.connectionSuccess")}`);
                      else setTgStatus(`❌ ${t("alerts.sendFailed")}`);
                    } catch (e) { setTgStatus(`❌ ${e.message}`); }
                  })();
                }} style={{
                  padding: "9px 20px", borderRadius: "10px", fontSize: "18px", fontWeight: 700,
                  background: C.blue, color: "#fff", border: "none",
                }}>📤 {t("alerts.testConnection")}</button>
              </div>

              {tgStatus && (
                <div style={{ fontSize: "16px", color: tgStatus.includes("✅") ? C.green : C.red, fontWeight: 600, marginTop: "8px" }}>
                  {tgStatus}
                </div>
              )}
            </div>

            {/* ── 동기화 ── */}
            <div style={{ background: C.card, border: `1px solid ${C.border}20`, borderRadius: "16px", padding: "22px 24px" }}>
              <div style={{ fontWeight: 700, fontSize: "18px", marginBottom: "16px" }}>🔄 {t("alerts.dataSync")}</div>
              <div style={{ marginBottom: "12px" }}>
                <div style={{ fontSize: "16px", color: C.text3, marginBottom: "6px", fontWeight: 600 }}>{t("alerts.syncPin")}</div>
                <input value={syncPin} onChange={e => setSyncPin(e.target.value)} type="password" placeholder="1234"
                  style={{
                    width: "100%", padding: "10px 12px", borderRadius: "10px", fontSize: "18px",
                    background: C.bg, border: `1px solid ${C.border2}`, color: C.text1, outline: "none", marginBottom: "12px",
                  }} />
              </div>
              <div style={{ display: "flex", gap: "8px", marginBottom: "12px" }}>
                <button onClick={syncUpload} style={{
                  padding: "9px 20px", borderRadius: "10px", fontSize: "18px", fontWeight: 700,
                  background: C.blue, color: "#fff", border: "none", flex: 1,
                }}>📤 {t("alerts.upload")}</button>
                <button onClick={syncDownload} style={{
                  padding: "9px 20px", borderRadius: "10px", fontSize: "18px", fontWeight: 700,
                  background: C.green, color: "#fff", border: "none", flex: 1,
                }}>📥 {t("alerts.download")}</button>
              </div>
              {syncStatus && (
                <div style={{ fontSize: "16px", color: syncStatus.includes("✅") ? C.green : C.red, fontWeight: 600 }}>
                  {syncStatus}
                </div>
              )}
            </div>
          </div>
        )}


        {/* ═══════════════════════════════════════════════════════════
            TAB: 소셜 센티먼트 분석
        ═══════════════════════════════════════════════════════════ */}
        {tab === "sentiment" && (
          <div className="tab-content">
            {/* 센티먼트 히어로 헤더 — 극적인 그라데이션과 섀도우 */}
            <div style={{
              background: `linear-gradient(135deg, ${C.blueBg} 0%, ${C.purpleBg} 100%)`,
              borderRadius: "24px",
              padding: "28px",
              marginBottom: "20px",
              boxShadow: `0 4px 20px rgba(59,130,246,0.08)`,
            }}>
              <div style={{
                fontWeight: 900,
                fontSize: "28px",
                color: C.text1,
                marginBottom: "8px",
              }}>💬 {t("sentiment.title")}</div>
              <div style={{
                fontSize: "16px",
                color: C.text2,
              }}>{t("sentiment.subtitle")}</div>
            </div>

            {/* 검색 헤더 */}
            <div style={{background:`linear-gradient(135deg, ${C.card} 0%, ${C.card2} 100%)`,border:`1px solid ${C.border}20`,borderRadius:"16px",padding:"22px 24px",marginBottom:"12px",boxShadow:"0 2px 12px rgba(0,0,0,0.2)"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:"12px"}}>
                <div>
                  <div style={{fontWeight:800,fontSize:"18px",marginBottom:"4px",color:C.text1}}>{t("sentiment.title")}</div>
                  <div style={{fontSize:"14px",color:C.text3}}>{t("sentiment.subtitle")}</div>
                </div>
                <div style={{display:"flex",gap:"8px",alignItems:"center"}}>
                  <input value={sentimentSymbol} onChange={e=>setSentimentSymbol(e.target.value.toUpperCase())}
                    placeholder="SPY" onKeyDown={e=>{if(e.key==="Enter")fetchSentiment(sentimentSymbol);}}
                    style={{width:isMobile?"80px":"100px",padding:"8px 12px",borderRadius:"8px",fontSize:"16px",fontWeight:700,
                      background:C.card2,border:`1px solid ${C.border2}`,color:C.text1,outline:"none",textAlign:"center"}} />
                  <button onClick={()=>fetchSentiment(sentimentSymbol)} disabled={sentimentLoading} style={{
                    padding:"8px 16px",borderRadius:"8px",fontSize:"14px",fontWeight:700,
                    background:sentimentLoading?C.card2:`linear-gradient(135deg,${C.purple},#6D28D9)`,
                    color:"#fff",border:"none",cursor:sentimentLoading?"default":"pointer",
                  }}>{sentimentLoading?t("sentiment.analyzing"):t("sentiment.analyze")}</button>
                </div>
              </div>
              {/* 빠른 심볼 버튼 — 모바일에서 수평 스크롤 가능 */}
              <div className={isMobile ? "hscroll" : ""} style={{display:"flex",gap:"6px",marginTop:"12px",flexWrap:isMobile?"nowrap":"wrap",overflowX:isMobile?"auto":"visible",WebkitOverflowScrolling:"touch"}}>
                {["SPY","AAPL","NVDA","TSLA","MSFT","AMZN","META","AMD","GOOG","COIN"].map(s=>(
                  <button key={s} onClick={()=>{setSentimentSymbol(s);fetchSentiment(s);}} style={{
                    padding:"4px 10px",borderRadius:"6px",fontSize:"14px",fontWeight:600,
                    background:sentimentSymbol===s?C.blueBg:C.card2,color:sentimentSymbol===s?C.blue:C.text3,
                    border:`1px solid ${sentimentSymbol===s?C.blue+"55":C.border2}`,cursor:"pointer",flexShrink:0
                  }}>{s}</button>
                ))}
              </div>
            </div>

            {sentimentLoading && (
              <div style={{textAlign:"center",padding:"60px 24px",color:C.text3}}>
                <div style={{fontSize:"40px",marginBottom:"12px",animation:"pulse 1.5s infinite"}}>💬</div>
                <div>{t("sentiment.collecting")}</div>
              </div>
            )}

            {!sentimentLoading && sentimentData && (<>
              {/* 종합 센티먼트 게이지 — 극적인 디자인 */}
              {sentimentData.sentiment && (
                <div style={{
                  background:`linear-gradient(135deg, ${C.card} 0%, ${C.card2} 100%)`,
                  border:`1px solid ${C.border}20`,
                  borderRadius:"16px",
                  padding:"28px",
                  marginBottom:"12px",
                  textAlign:"center",
                  maxWidth:"800px",
                  margin:"0 auto 12px",
                  boxShadow:"0 4px 20px rgba(0,0,0,0.2)",
                }}>
                  <div style={{fontSize:"16px",color:C.text3,marginBottom:"12px",fontWeight:600}}>
                    {sentimentData.symbol} {t("sentiment.sentiment")}
                  </div>
                  <div style={{
                    fontSize:isMobile?"48px":"64px",
                    fontWeight:900,
                    background: `linear-gradient(135deg, ${sentimentData.sentiment.score>=60?C.green:sentimentData.sentiment.score>=40?C.yellow:C.red}, ${sentimentData.sentiment.score>=60?C.blue:sentimentData.sentiment.score>=40?C.orange:"#FF6B6B"})`,
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                    backgroundClip: "text",
                    letterSpacing:"-2px",
                    marginBottom:"8px",
                    textShadow: `0 0 30px ${sentimentData.sentiment.score>=60?C.green:sentimentData.sentiment.score>=40?C.yellow:C.red}60`,
                    filter: "drop-shadow(0 0 12px " + (sentimentData.sentiment.score>=60?C.green:sentimentData.sentiment.score>=40?C.yellow:C.red) + "40)",
                  }}>
                    {sentimentData.sentiment.score}
                  </div>
                  <div style={{fontSize:"18px",fontWeight:700,color:
                    sentimentData.sentiment.score>=60?C.green:sentimentData.sentiment.score>=40?C.yellow:C.red,marginBottom:"16px"}}>
                    {sentimentData.sentiment.label}
                  </div>
                  {/* 센티먼트 바 */}
                  <div style={{display:"flex",height:"10px",borderRadius:"6px",overflow:"hidden",marginBottom:"12px",boxShadow:`inset 0 1px 2px rgba(0,0,0,0.2)`}}>
                    <div style={{width:`${sentimentData.sentiment.bullish}%`,background:`linear-gradient(90deg, ${C.green}80 0%, ${C.green} 100%)`,transition:"width 0.5s",boxShadow:`0 0 8px ${C.green}40`}} />
                    <div style={{width:`${sentimentData.sentiment.neutral}%`,background:C.text3+"50",transition:"width 0.5s"}} />
                    <div style={{width:`${sentimentData.sentiment.bearish}%`,background:`linear-gradient(90deg, ${C.red} 0%, ${C.red}80 100%)`,transition:"width 0.5s",boxShadow:`0 0 8px ${C.red}40`}} />
                  </div>
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:"14px"}}>
                    <span style={{color:C.green,fontWeight:600}}>{t("sentiment.bullish")} {sentimentData.sentiment.bullish}%</span>
                    <span style={{color:C.text3}}>{t("sentiment.neutral")} {sentimentData.sentiment.neutral}%</span>
                    <span style={{color:C.red,fontWeight:600}}>{t("sentiment.bearish")} {sentimentData.sentiment.bearish}%</span>
                  </div>
                </div>
              )}

              {/* 소스별 상세 — 극적인 카드 디자인 */}
              <div style={{maxWidth:"800px",margin:"0 auto"}}>
              {sentimentData.sources?.map((src,i)=>(
                <div key={i} style={{
                  background:`linear-gradient(135deg, ${C.card} 0%, ${C.card2} 100%)`,
                  border:`1px solid ${C.border}20`,
                  borderRadius:"16px",
                  padding:isMobile?"16px":"22px 24px",
                  marginBottom:"12px",
                  boxShadow:"0 2px 12px rgba(0,0,0,0.2)",
                  transition:"all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)",
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.boxShadow = "0 8px 24px rgba(0,0,0,0.3)";
                  e.currentTarget.style.transform = "translateY(-3px) scale(1.01)";
                  e.currentTarget.style.borderColor = C.blue + "40";
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.boxShadow = "0 2px 12px rgba(0,0,0,0.2)";
                  e.currentTarget.style.transform = "translateY(0) scale(1)";
                  e.currentTarget.style.borderColor = C.border + "20";
                }}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"12px"}}>
                    <div style={{fontWeight:700,fontSize:"15px"}}>{src.name}</div>
                    <span style={{fontSize:"14px",color:C.text3}}>{src.total}{t("sentiment.posts")}</span>
                  </div>
                  {/* 소스 센티먼트 바 */}
                  <div style={{display:"flex",gap:"8px",marginBottom:"16px"}}>
                    {[{label:t("sentiment.bullish"),val:src.bullish,color:C.green,bg:C.greenBg},
                      {label:t("sentiment.neutral"),val:src.neutral,color:C.text3,bg:C.card2},
                      {label:t("sentiment.bearish"),val:src.bearish,color:C.red,bg:C.redBg}].map(s=>(
                      <div key={s.label} style={{flex:1,background:s.bg,borderRadius:"8px",padding:"10px",textAlign:"center"}}>
                        <div style={{fontSize:"18px",fontWeight:800,color:s.color}}>{s.val}%</div>
                        <div style={{fontSize:"15px",color:s.color,fontWeight:600}}>{s.label}</div>
                      </div>
                    ))}
                  </div>
                  {/* 최근 포스트 */}
                  {(src.posts?.length > 0 ? src.posts : src.allPosts || []).slice(0,6).map((p,j)=>(
                    <div key={j} style={{background:C.card2,borderRadius:"8px",padding:"10px 12px",marginBottom:"6px",
                      borderLeft:`3px solid ${p.sentiment==="bullish"||p.sentiment==="Bullish"?C.green:p.sentiment==="bearish"||p.sentiment==="Bearish"?C.red:C.text3}`}}>
                      <div style={{fontSize:"16px",color:C.text2,lineHeight:1.5}}>
                        {(p.title || p.body || "").slice(0, 150)}
                      </div>
                      <div style={{display:"flex",gap:"8px",marginTop:"4px",fontSize:"15px",color:C.text3}}>
                        <span style={{fontWeight:600,color:p.sentiment==="bullish"||p.sentiment==="Bullish"?C.green:p.sentiment==="bearish"||p.sentiment==="Bearish"?C.red:C.text3}}>
                          {p.sentiment==="bullish"||p.sentiment==="Bullish"?"BULL":p.sentiment==="bearish"||p.sentiment==="Bearish"?"BEAR":"NEUTRAL"}
                        </span>
                        {p.user && <span>@{p.user}</span>}
                        {p.score > 0 && <span>{p.score} pts</span>}
                        {p.likes > 0 && <span>{p.likes} likes</span>}
                        {p.comments > 0 && <span>{p.comments} comments</span>}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
              </div>

              {/* 트렌딩 심볼 — 극적한 카드 */}
              {sentimentData.trending?.length > 0 && (
                <div style={{
                  background:`linear-gradient(135deg, ${C.card} 0%, ${C.card2} 100%)`,
                  border:`1px solid ${C.border}20`,
                  borderRadius:"16px",
                  padding:"22px 24px",
                  maxWidth:"800px",
                  margin:"0 auto",
                  boxShadow:"0 2px 12px rgba(0,0,0,0.2)",
                }}>
                  <div style={{fontWeight:700,fontSize:"18px",marginBottom:"12px"}}>{t("sentiment.trending")}</div>
                  <div style={{display:"flex",flexWrap:"wrap",gap:"8px"}}>
                    {sentimentData.trending.map((t,i)=>(
                      <button key={i} onClick={()=>{setSentimentSymbol(t.symbol);fetchSentiment(t.symbol);}} style={{
                        padding:"8px 14px",borderRadius:"8px",fontSize:"16px",fontWeight:600,
                        background:C.card2,border:`1px solid ${C.border2}`,color:C.text1,cursor:"pointer",
                        display:"flex",alignItems:"center",gap:"6px",
                      }}>
                        <span style={{fontWeight:800}}>{t.symbol}</span>
                        {t.watchers && <span style={{fontSize:"15px",color:C.text3}}>{(t.watchers/1000).toFixed(0)}K</span>}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* 데이터 없는 경우 */}
              {(!sentimentData.sources || sentimentData.sources.length === 0) && !sentimentData.sentiment && (
                <div style={{textAlign:"center",padding:"40px 24px",color:C.text3}}>
                  <div style={{fontSize:"40px",marginBottom:"8px"}}>📭</div>
                  <div>{t("sentiment.noData", { symbol: sentimentData.symbol })}</div>
                  <div style={{fontSize:"16px",marginTop:"4px"}}>{t("sentiment.tryOther")}</div>
                </div>
              )}
            </>)}

            {/* 초기 상태 */}
            {!sentimentLoading && !sentimentData && (
              <div style={{textAlign:"center",padding:"60px 24px",color:C.text3}}>
                <div style={{fontSize:"48px",marginBottom:"12px"}}>💬</div>
                <div style={{fontWeight:600,fontSize:"18px",marginBottom:"4px"}}>{t("sentiment.title")}</div>
                <div style={{fontSize:"16px"}}>{t("sentiment.initialState")}</div>
              </div>
            )}

          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════
            TAB: AI 퀀트 전략 (주식 + 크립토 통합)
        ═══════════════════════════════════════════════════════════ */}
        {tab === "auto-trading" && isOwner && (
          <div className="card-stagger">
            <Suspense fallback={<LazyTabFallback />}><AutoTrading theme={themeMode} user={user} isOwner={isOwner} onNavigate={setTab} /></Suspense>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════
            TAB: 실전매매 (Phase 1 — 단일 사용자 Binance Futures)
        ═══════════════════════════════════════════════════════════ */}
        {tab === "real-trading" && isOwner && (
          <Suspense fallback={<LazyTabFallback />}><RealTrading theme={themeMode} onNavigate={setTab} /></Suspense>
        )}
        {/* ★ 2026-07 정보 서비스 피벗: 매매 탭 공통 게이트 — 비owner 는 OWNER_ONLY_TABS 전체 렌더 차단 */}
        {!isOwner && OWNER_ONLY_TABS.has(tab) && (
          <div style={{ maxWidth: 720, margin: "80px auto", padding: "40px 24px", textAlign: "center", color: C.text2 }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🔒</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: C.text1, marginBottom: 8 }}>이 기능은 내부 운영 전용입니다</div>
            <div style={{ fontSize: 15, color: C.text3, marginBottom: 24 }}>요청하신 페이지는 존재하지 않거나 접근할 수 없습니다.</div>
            <button onClick={() => setTab("home")} style={{ padding: "10px 20px", borderRadius: 8, border: `1px solid ${C.border}`, background: C.card, color: C.text1, fontWeight: 700, cursor: "pointer" }}>홈으로</button>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════
            TAB: Alpha Lab — 24/7 알파 추적 + 자동 개선 시스템
        ═══════════════════════════════════════════════════════════ */}
        {tab === "alpha-lab" && isOwner && (
          <Suspense fallback={<LazyTabFallback />}><AlphaLab onRequestLogin={() => setShowAuthModal(true)} /></Suspense>
        )}

        {/* ═══════════════════════════════════════════════════════════
            TAB: 포트폴리오 분석 (/portfolio-analysis) — PLAN-SVC #3
            자산 배분 · 상관관계 · 분산 점수 · 리밸런싱 추천
        ═══════════════════════════════════════════════════════════ */}
        {tab === "portfolio-analysis" && (
          <Suspense fallback={<LazyTabFallback />}><PortfolioAnalysis portfolio={portfolio} /></Suspense>
        )}

        {/* ═══════════════════════════════════════════════════════════
            TAB: 통합 알림 센터 (/notifications)
        ═══════════════════════════════════════════════════════════ */}
        {tab === "notifications" && (
          <Suspense fallback={<LazyTabFallback />}>
            <NotificationHub onNavigate={setTab} />
          </Suspense>
        )}

        {/* ═══════════════════════════════════════════════════════════
            TAB: 저장한 스크리너 (/saved-screeners)
        ═══════════════════════════════════════════════════════════ */}
        {tab === "saved-screeners" && (
          <Suspense fallback={<LazyTabFallback />}>
            <SavedScreeners onNavigate={setTab} onOpenScreener={(keys) => { setPendingScreenerKeys(keys); setTab("screener"); }} />
          </Suspense>
        )}

        {/* ═══════════════════════════════════════════════════════════
            TAB: 마케팅 대시보드 (/marketing — 오너 전용, 자체 애널리틱스)
        ═══════════════════════════════════════════════════════════ */}
        {tab === "marketing" && (
          <Suspense fallback={<LazyTabFallback />}>
            <MarketingDashboard />
          </Suspense>
        )}

        {/* ═══════════════════════════════════════════════════════════
            TAB: 봇 리더보드 (/leaderboard)
        ═══════════════════════════════════════════════════════════ */}
        {tab === "leaderboard" && isOwner && (
          <Suspense fallback={<LazyTabFallback />}>
            <BotLeaderboard onNavigate={setTab} />
          </Suspense>
        )}

        {/* ═══════════════════════════════════════════════════════════
            TAB: 봇 리포트 목록 (/reports)
        ═══════════════════════════════════════════════════════════ */}
        {tab === "reports" && isOwner && (
          <Suspense fallback={<LazyTabFallback />}>
            <BotReport onNavigate={setTab} />
          </Suspense>
        )}

        {/* ═══════════════════════════════════════════════════════════
            TAB: 봇 리포트 상세 (/reports/<botId>)
        ═══════════════════════════════════════════════════════════ */}
        {tab === "bot-report" && isOwner && (
          <Suspense fallback={<LazyTabFallback />}>
            <BotReport botId={reportBotId} onNavigate={setTab} />
          </Suspense>
        )}

        {/* ═══════════════════════════════════════════════════════════
            TAB: 백테스트 비교 (/backtest-compare)
        ═══════════════════════════════════════════════════════════ */}
        {tab === "backtest-compare" && isOwner && (
          <Suspense fallback={<LazyTabFallback />}>
            <BacktestCompare onNavigate={setTab} />
          </Suspense>
        )}

        {/* ═══════════════════════════════════════════════════════════
            TAB: 카피트레이딩 (/copy-trading) — 법적 안전 모드 (알림 + 설정 복사)
        ═══════════════════════════════════════════════════════════ */}
        {tab === "copy-trading" && isOwner && (
          <Suspense fallback={<LazyTabFallback />}>
            <CopyTrading onNavigate={setTab} />
          </Suspense>
        )}

        {/* ═══════════════════════════════════════════════════════════
            TAB: 구독 가격 (/pricing) — PLAN-BIZ Q3 #1
            Free / Pro / Premium 3 tier 비교 · FAQ · 14일 trial CTA
        ═══════════════════════════════════════════════════════════ */}
        {tab === "pricing" && isOwner && (
          <Suspense fallback={<LazyTabFallback />}>
            <Pricing onRequestLogin={() => setShowAuthModal(true)} />
          </Suspense>
        )}

        {/* ═══════════════════════════════════════════════════════════
            TAB: 개발/QA 대시보드 (zepta.app/dev)
        ═══════════════════════════════════════════════════════════ */}
        {tab === "dev" && isOwner && (
          <Suspense fallback={<LazyTabFallback />}><DevDashboard theme={themeMode} /></Suspense>
        )}

        {/* 종목 상세 팝업 */}
        {selectedAsset && (
          <AssetDetailPopup
            asset={selectedAsset}
            onClose={() => setSelectedAsset(null)}
            onChart={() => setChartAsset(selectedAsset)}
            hotAssets={hotAssets}
            extendedHours={extendedHours}
            isWatched={watchlist.some(w => w.symbol === selectedAsset.symbol)}
            onToggleWatch={(sym) => setWatchlist(prev => prev.some(w => w.symbol === sym) ? prev.filter(w => w.symbol !== sym) : [...prev, { symbol: selectedAsset.symbol, name: selectedAsset.name, market: selectedAsset.market, symbolRaw: selectedAsset.symbolRaw || selectedAsset.symbol, id: selectedAsset.id }])}
          />
        )}

        {/* ═══════════════════════════════════════════════════════════
            TAB: 전체 (더보기) — 토스 스타일 서비스 허브
        ═══════════════════════════════════════════════════════════ */}
        {/* ═══════════════════════════════════════════════════════════
            TAB: MY — ★ 2026-08-12 IA v3 리뉴얼 (시안 1e · 설계서 v3 5장)
            프로필 헤더(비로그인=가입 CTA) → 스탯 3열 → 바로가기 →
            설정(테마·언어 토글 — 최초 UI 노출) → (owner) 매매 콘솔 → 고객지원 → 로그아웃.
            데이터 배선(watchlist·savedScreenerCount·streakInfo·profilePerf)은 전부 기존 그대로.
        ═══════════════════════════════════════════════════════════ */}
        {tab === "profile" && (() => {
          // 스탯은 "실제로 값이 있는 칸"만 렌더합니다 — 없는 지표를 0 으로 지어내지 않습니다.
          //   · 관심종목: App state(watchlist) — 로그인 사용자면 항상 실측값
          //   · 저장한 조건: /api/screeners/list (조회 실패 시 null → 칸 자체를 숨김)
          //   · 연속 접속: 공용 streak effect 의 streakInfo (기록 없으면 칸을 숨김 — 0 을 지어내지 않음)
          const streakCount = (() => {
            const n = Number(streakInfo?.count);
            return Number.isFinite(n) && n > 0 ? n : null;
          })();
          const statCells = [
            { label: t("profile.watchlistCount"), value: `${watchlist.length}` },
            savedScreenerCount != null ? { label: t("profile.savedConditions"), value: `${savedScreenerCount}` } : null,
            streakCount != null ? { label: t("profile.streakDays"), value: t("profile.daysUnit", { n: streakCount }) } : null,
          ].filter(Boolean);
          // 바로가기 — 실제 목적지가 있는 항목만 배선합니다.
          //   · 관심종목: 전용 관리 화면이 없어 관리 UI 가 있는 홈 관심종목 섹션으로 (죽은 링크 금지)
          //   · 저장한 조건: saved-screeners 탭(SavedScreeners — 재실행 루프)
          //   · 알림: notifications 탭 (전략 알림 내역)
          const shortcutRows = [
            {
              key: "watchlist", label: t("profile.shortcutWatchlist"), hint: t("profile.shortcutWatchlistHint"),
              onGo: () => setTab("home"),
              icon: <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />,
            },
            {
              key: "saved", label: t("profile.shortcutSaved"), hint: null,
              onGo: () => setTab("saved-screeners"),
              icon: <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />,
            },
            {
              key: "alerts", label: t("profile.shortcutAlerts"), hint: null,
              onGo: () => setTab("notifications"),
              icon: <><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></>,
            },
          ];
          return (
          <div className="tab-content" style={{ maxWidth: "720px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "12px" }}>
            {/* 페이지 타이틀 — 시안 1e */}
            <h1 style={{ margin: 0, fontSize: isMobile ? "22px" : "24px", fontWeight: 800, color: C.text1, letterSpacing: "-0.01em" }}>{t("nav.my")}</h1>

            {/* ── ① 프로필 헤더 / 비로그인 가입 CTA (시안 1e) ── */}
            {user ? (
              <div style={{
                background: C.card, border: `1px solid ${C.border}`, borderRadius: "16px",
                padding: "15px", display: "flex", alignItems: "center", gap: "13px",
              }}>
                <div style={{
                  width: "52px", height: "52px", borderRadius: "50%", flexShrink: 0,
                  background: `linear-gradient(135deg, ${C.blueL || C.blue}, ${C.blue})`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: "21px", fontWeight: 800, color: "#fff", overflow: "hidden",
                }}>
                  {(user?.user_metadata?.avatar_url)
                    ? <img src={user.user_metadata.avatar_url} alt={t("profile.avatarAlt")} width="52" height="52" style={{ width: 52, height: 52, borderRadius: "50%", objectFit: "cover" }} />
                    : (user?.user_metadata?.nickname || user?.user_metadata?.display_name || user?.email || "U")[0].toUpperCase()
                  }
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: "16px", fontWeight: 800, color: C.text1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {user?.user_metadata?.nickname || user?.user_metadata?.display_name || user?.email?.split("@")[0] || "User"}
                  </div>
                  {/* ★ 2026-06-12 (대표 지시): 레벨/티어 표기 제거 — 이메일로 대체 */}
                  <div style={{ fontSize: "12px", color: C.text3, marginTop: "2px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{user?.email || ""}</div>
                </div>
                {/* 헤더 액션은 1개만 — 테마 버튼은 아래 설정 섹션으로 이동(시안 1e) */}
                <button onClick={() => setTab("mypage")} style={{
                  flexShrink: 0, padding: "7px 12px", borderRadius: "9999px", fontSize: "12px", fontWeight: 800,
                  background: C.card2, border: `1px solid ${C.border2}`, color: C.text2, cursor: "pointer",
                  fontFamily: "inherit", whiteSpace: "nowrap",
                }}>{t("profile.editProfile")}</button>
              </div>
            ) : (
              /* 비로그인 가입 CTA — 시안 1e: 헤드라인 + 설명 + [시작하기|로그인] */
              <div style={{
                background: `radial-gradient(260px 160px at 0% 0%, ${C.blue}2E, transparent 70%), ${C.card}`,
                border: `1px solid ${C.blue}59`, borderRadius: "18px", padding: "18px 16px",
              }}>
                <div style={{ fontSize: "17px", fontWeight: 800, color: C.text1, lineHeight: 1.35 }}>{t("profile.guestTitle")}</div>
                <div style={{ fontSize: "12px", color: C.text2, lineHeight: 1.6, marginTop: "6px" }}>{t("profile.guestDesc")}</div>
                <div style={{ display: "flex", gap: "8px", marginTop: "14px" }}>
                  <button onClick={() => setShowAuthModal(true)} style={{
                    flex: 1, height: "44px", borderRadius: "12px", background: C.blue, color: "#fff",
                    border: "none", fontSize: "14px", fontWeight: 800, fontFamily: "inherit", cursor: "pointer",
                  }}>{t("profile.guestStart")}</button>
                  <button onClick={() => setShowAuthModal(true)} style={{
                    height: "44px", padding: "0 16px", borderRadius: "12px", background: "transparent",
                    border: `1px solid ${C.border2}`, color: C.text2, fontSize: "13px", fontWeight: 700,
                    fontFamily: "inherit", cursor: "pointer",
                  }}>{t("profile.guestLogin")}</button>
                </div>
              </div>
            )}

            {/* ── ② 활동 스탯 3열 (시안 1e — 값 있는 칸만, 로그인 시) ── */}
            {user && statCells.length > 0 && (
              <div style={{ display: "grid", gridTemplateColumns: `repeat(${statCells.length}, 1fr)`, gap: "9px" }}>
                {statCells.map((s) => (
                  <div key={s.label} style={{
                    background: C.card, border: `1px solid ${C.border}`, borderRadius: "14px",
                    padding: "12px 8px", textAlign: "center",
                  }}>
                    <Num size="18px" weight={800}>{s.value}</Num>
                    <div style={{ fontSize: "11px", color: C.text3, fontWeight: 700, marginTop: "2px" }}>{s.label}</div>
                  </div>
                ))}
              </div>
            )}

            {/* ── ③ 바로가기 (시안 1e — 로그인 시: 계정 종속 데이터 목적지) ── */}
            {user && (
              <ListCard>
                {shortcutRows.map((r, i) => (
                  <div key={r.key} onClick={r.onGo} role="button" tabIndex={0}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); r.onGo(); } }}
                    style={{
                      display: "flex", alignItems: "center", gap: "11px", padding: "13px 14px",
                      borderTop: i > 0 ? `1px solid ${C.card2}` : "none", cursor: "pointer", transition: "background .1s",
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = C.card2}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                  >
                    <span aria-hidden="true" style={{
                      width: "34px", height: "34px", borderRadius: "10px", background: `${C.blue}1F`,
                      display: "flex", alignItems: "center", justifyContent: "center", color: C.isDark ? C.blueL : C.blue, flexShrink: 0,
                    }}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{r.icon}</svg>
                    </span>
                    <span style={{ flex: 1, fontSize: "13.5px", fontWeight: 700, color: C.text1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.label}</span>
                    {r.hint && <span style={{ fontSize: "11px", color: C.text3, flexShrink: 0 }}>{r.hint}</span>}
                    <span style={{ fontSize: "13px", color: C.text3, flexShrink: 0 }} aria-hidden="true">›</span>
                  </div>
                ))}
              </ListCard>
            )}

            {/* ── ④ 설정 — 테마·언어 토글 (설계서 v3 5장: 최초 UI 노출).
                 테마 = 기존 ThemeProvider 동기 toggleTheme, 언어 = LanguageContext setLang. ── */}
            <ListCard>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "11px 14px", borderBottom: `1px solid ${C.card2}` }}>
                <span style={{ flex: 1, fontSize: "13.5px", fontWeight: 700, color: C.text1 }}>{t("profile.theme")}</span>
                <SettingPills
                  ariaLabel={t("profile.theme")}
                  value={themeMode}
                  onSelect={() => toggleTheme()}
                  options={[
                    { value: "dark", label: t("profile.themeDark") },
                    { value: "light", label: t("profile.themeLight") },
                  ]}
                />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "11px 14px" }}>
                <span style={{ flex: 1, fontSize: "13.5px", fontWeight: 700, color: C.text1 }}>{t("profile.language")}</span>
                <SettingPills
                  ariaLabel={t("profile.language")}
                  value={lang}
                  onSelect={(v) => setLang(v)}
                  options={[
                    { value: "ko", label: t("profile.langKo") },
                    { value: "en", label: t("profile.langEn") },
                  ]}
                />
              </div>
            </ListCard>

            {/* ── ⑤ 매매 콘솔 (owner 전용 — 설계서 v3 5장: 진입 카드 1개로 통합).
                 구 3장 카드(모의봇 상세·실전 실적·마케팅)를 리스트 행 3개로 압축 —
                 profilePerf 배선·목적지(auto-trading/real-trading/marketing)는 그대로,
                 상세 수치는 각 콘솔 화면이 담당합니다. 비owner 는 렌더 자체가 없습니다. ── */}
            {isOwner && user && (() => {
              const botsObj = profilePerf.bots;
              const botRows = botsObj ? Object.entries(botsObj).map(([id, b]) => ({
                id,
                pl: Number(b?.perf?.realizedPL || 0) + Number(b?.snapshot?.unrealizedPL || 0),
              })) : [];
              const totalPl = botRows.reduce((a, r) => a + r.pl, 0);
              const consoleRows = [
                {
                  key: "auto", icon: "🤖", label: t("profile.consoleAuto"), badge: t("profile.consoleSim"), badgeColor: C.yellow,
                  // 누적 손익(실현+평가) — 데이터 없으면 값 미표기(지어내지 않음)
                  value: botsObj
                    ? `${totalPl >= 0 ? "+" : ""}$${Math.round(totalPl).toLocaleString()}`
                    : (profilePerf.loading ? "…" : null),
                  valueColor: botsObj ? (totalPl >= 0 ? C.greenL || C.green : C.redL || C.red) : C.text3,
                  onGo: () => setTab("auto-trading"),
                },
                {
                  key: "real", icon: "⚡", label: t("profile.consoleReal"), badge: t("profile.consoleLive"), badgeColor: C.red,
                  value: profilePerf.real
                    ? `$${Number(profilePerf.real.equity || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                    : (profilePerf.loading ? "…" : null),
                  valueColor: C.text1,
                  onGo: () => setTab("real-trading"),
                },
                {
                  key: "mkt", icon: "📊", label: t("profile.consoleMarketing"), badge: null,
                  value: null, onGo: () => setTab("marketing"),
                },
              ];
              return (
                <ListCard>
                  <div style={{ padding: "12px 14px", fontSize: "12px", fontWeight: 800, color: C.text3, letterSpacing: "0.02em" }}>{t("profile.ownerConsole")}</div>
                  {consoleRows.map((r) => (
                    <div key={r.key} onClick={r.onGo} role="button" tabIndex={0}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); r.onGo(); } }}
                      style={{
                        display: "flex", alignItems: "center", gap: "10px", padding: "13px 14px",
                        borderTop: `1px solid ${C.card2}`, cursor: "pointer", transition: "background .1s",
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = C.card2}
                      onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                    >
                      <span style={{ fontSize: "16px", width: "24px", textAlign: "center", flexShrink: 0 }} aria-hidden="true">{r.icon}</span>
                      <span style={{ fontSize: "13.5px", fontWeight: 700, color: C.text1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.label}</span>
                      {r.badge && (
                        <span style={{ fontSize: "10px", fontWeight: 800, padding: "2px 7px", borderRadius: "9999px", background: `${r.badgeColor}1F`, color: r.badgeColor, flexShrink: 0 }}>{r.badge}</span>
                      )}
                      <span style={{ flex: 1 }} />
                      {r.value != null && (
                        <Num size="13px" weight={800} color={r.valueColor}>{r.value}</Num>
                      )}
                      <span style={{ fontSize: "13px", color: C.text3, flexShrink: 0 }} aria-hidden="true">›</span>
                    </div>
                  ))}
                </ListCard>
              );
            })()}

            {/* ── ⑥ 고객지원 / 정보 (시안 1e 리스트 카드 문법 — 라벨 i18n 이관) ── */}
            <ListCard>
              <div style={{ padding: "12px 14px", fontSize: "12px", fontWeight: 800, color: C.text3, letterSpacing: "0.02em" }}>{t("profile.supportTitle")}</div>
              {[
                { icon: "📋", label: t("info.about"), tab: "about" },
                { icon: "📖", label: t("profile.supportGuide"), href: "/guide" }, // ★ guide 는 정적 페이지 — setTab 하면 빈 화면이던 죽은 링크 수정
                { icon: "🔒", label: t("info.privacy"), tab: "privacy" },
                { icon: "📄", label: t("info.terms"), tab: "terms" },
                { icon: "✉️", label: t("profile.supportContact"), tab: "contact" },
              ].map((item, i) => (
                <div key={i} onClick={() => { if (item.href) window.location.href = item.href; else setTab(item.tab); }}
                  role="button" tabIndex={0}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (item.href) window.location.href = item.href; else setTab(item.tab); } }}
                  style={{
                    display: "flex", alignItems: "center", gap: "12px",
                    padding: "13px 14px", borderTop: `1px solid ${C.card2}`, cursor: "pointer",
                    transition: "background .1s",
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = C.card2}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                >
                  <span style={{ fontSize: "16px", width: "24px", textAlign: "center" }} aria-hidden="true">{item.icon}</span>
                  <span style={{ fontSize: "13.5px", fontWeight: 700, color: C.text1, flex: 1 }}>{item.label}</span>
                  <span style={{ fontSize: "13px", color: C.text3 }} aria-hidden="true">›</span>
                </div>
              ))}
            </ListCard>

            {/* ── ⑦ 로그아웃 (로그인 시에만 — 기존 confirm 핸들러 유지) ── */}
            {user && (
              <button onClick={() => { if (confirm(t("profile.logoutConfirm"))) { signOut(); setTab("home"); } }} style={{
                width: "100%", padding: "14px", borderRadius: "12px", fontSize: "15px", fontWeight: 700,
                background: `${C.red}08`, color: C.redL || C.red, border: `1px solid ${C.red}15`, cursor: "pointer",
                fontFamily: "inherit",
              }}>{t("profile.logout")}</button>
            )}

            {/* 푸터 */}
            <div style={{ textAlign: "center", padding: "4px 0 24px" }}>
              <span style={{ fontSize: "12px", color: C.text3 }}>Zepta v11.3 · donginseo0421@gmail.com</span>
            </div>
          </div>
          );
        })()}

        {/* ═══════════════════════════════════════════════════════════
            TAB: 마이페이지 (회원정보 상세 — 더보기 > 내 정보)
        ═══════════════════════════════════════════════════════════ */}
        {tab === "mypage" && user && (
          <div className="tab-content flex flex-col gap-4" style={{ maxWidth: "720px", margin: "0 auto" }}>
            {/* 뒤로가기 헤더 */}
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
              <button onClick={() => setTab("profile")} style={{
                padding: "6px 10px", borderRadius: "8px", border: "none",
                background: C.card, cursor: "pointer", fontSize: "14px", color: C.text2,
                display: "flex", alignItems: "center", gap: "4px",
              }}>← {t("profile.backToMy")}</button>
              <span style={{ fontSize: "18px", fontWeight: 800, color: C.text1 }}>{t("header.myInfo")}</span>
            </div>

            {/* XP 레벨 카드 */}
            {(() => {
              const uid = user?.id?.slice(0, 8) || "anon";
              const xpData = readTotalXp(uid);
              const xpInfo = getXpInfo(xpData.total);
              const displayName = user?.user_metadata?.nickname || user?.user_metadata?.display_name || user?.email?.split("@")[0] || "User";
              return (
                <div style={{
                  background: `linear-gradient(135deg, ${C.blueBg} 0%, ${C.purpleBg} 100%)`,
                  borderRadius: "20px", padding: "24px", textAlign: "center",
                  border: `1px solid ${C.blue}15`, position: "relative", overflow: "hidden",
                }}>
                  <div style={{ position: "absolute", top: "-10px", right: "-10px", fontSize: "100px", opacity: 0.05, pointerEvents: "none" }}>{xpInfo.tier.icon}</div>
                  <div style={{ position: "relative", display: "inline-block", marginBottom: "12px" }}>
                    <div style={{
                      width: "72px", height: "72px", borderRadius: "50%",
                      background: `linear-gradient(135deg, ${xpInfo.tier.color}, ${C.purple || "#a855f7"})`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: "28px", fontWeight: 900, color: "#fff",
                      border: "3px solid rgba(255,255,255,0.3)",
                    }}>
                      {(user?.user_metadata?.avatar_url)
                        ? <img src={user.user_metadata.avatar_url} alt={t("profile.avatarAlt")} width="72" height="72" style={{ width: 72, height: 72, borderRadius: "50%", objectFit: "cover" }} />
                        : displayName[0].toUpperCase()}
                    </div>
                    <div style={{ position: "absolute", bottom: "-4px", right: "-8px", background: C.card, border: `2px solid ${xpInfo.tier.color}`, borderRadius: "8px", padding: "1px 6px", fontSize: "12px", fontWeight: 800, color: xpInfo.tier.color }}>{xpInfo.tier.icon} Lv.{xpInfo.level}</div>
                  </div>
                  <h2 style={{ margin: "0 0 4px", fontSize: "20px", fontWeight: 900, color: C.text1 }}>{displayName}</h2>
                  <div style={{ fontSize: "14px", color: C.text3, marginBottom: "14px" }}>{user?.email}</div>
                  <div style={{ background: `${C.card}CC`, borderRadius: "12px", padding: "12px", textAlign: "left" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
                      <span style={{ fontSize: "14px", fontWeight: 700, color: xpInfo.tier.color }}>Lv.{xpInfo.level} {xpInfo.tier.name}</span>
                      <span style={{ fontSize: "14px", fontWeight: 700, color: C.blue }}>{xpData.total.toLocaleString()} XP</span>
                    </div>
                    <div style={{ height: "5px", borderRadius: "4px", background: `${C.border}30`, overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${Math.round(xpInfo.progress * 100)}%`, borderRadius: "4px", background: `linear-gradient(90deg, ${xpInfo.tier.color}, ${C.blue})` }} />
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: "4px", fontSize: "12px", color: C.text3 }}>
                      <span>{xpInfo.currentLevelXp}/{xpInfo.nextLevelXp} XP</span>
                      <span>{t("profile.xpToNext", { xp: xpInfo.nextLevelXp - xpInfo.currentLevelXp })}</span>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* 닉네임 */}
            <NicknameEditor user={user} supabase={supabase} onUpdate={refreshUser} />

            {/* 계정 정보 */}
            <div style={{ background: C.card, border: `1px solid ${C.border}` }} className="rounded-[16px] overflow-hidden">
              <div className="px-5 py-3.5 text-sm font-bold text-muted-foreground uppercase tracking-wider">{t("profile.accountInfo")}</div>
              {[
                { label: t("profile.email"), value: user?.email || "—" },
                { label: t("profile.loginMethod"), value: user?.app_metadata?.provider === "google" ? "Google" : user?.app_metadata?.provider || t("profile.emailLogin") },
                { label: t("profile.joinDate"), value: user?.created_at ? new Date(user.created_at).toLocaleDateString(lang === "en" ? "en-US" : "ko-KR") : "—" },
              ].map((item, i) => (
                <div key={i} className="flex justify-between items-center px-5 py-3.5 border-t" style={{ borderTopColor: `${C.border}20` }}>
                  <span style={{ fontSize: "14px", color: C.text3 }}>{item.label}</span>
                  <span style={{ fontSize: "14px", fontWeight: 600, color: C.text1 }}>{item.value}</span>
                </div>
              ))}
            </div>

            {/* 투자 성적표 */}
            <div style={{ background: `linear-gradient(135deg, ${C.blue}12, ${C.purple}12)`, borderRadius: "16px", padding: "24px", textAlign: "center", border: `1px solid ${C.blue}20` }}>
              <div style={{ fontSize: "16px", fontWeight: 800, color: C.text1, marginBottom: "16px" }}>{t("profile.investmentPerformance")}</div>
              <div style={{ display: "flex", justifyContent: "center", gap: "24px", marginBottom: "16px" }}>
                {[
                  { val: watchlist.length, label: t("profile.watchlistCount"), color: C.blue },
                  { val: (() => { try { return JSON.parse(localStorage.getItem(`zepta_${user.id.slice(0,8)}_active_bots`) || "[]").length; } catch { return 0; } })(), label: t("profile.activeBots"), color: C.purple },
                  { val: (() => { try { return Math.floor((Date.now() - new Date(user.created_at).getTime()) / 86400000); } catch { return 0; } })(), label: t("profile.investmentDays"), color: C.green },
                ].map((s, i) => (
                  <div key={i} className="text-center">
                    <div style={{ fontSize: "32px", fontWeight: 900, color: s.color }}>{s.val}</div>
                    <div style={{ fontSize: "12px", color: C.text3, fontWeight: 600 }}>{s.label}</div>
                  </div>
                ))}
              </div>
              <button onClick={() => {
                const days = (() => { try { return Math.floor((Date.now() - new Date(user.created_at).getTime()) / 86400000); } catch { return 0; } })();
                const bots = (() => { try { return JSON.parse(localStorage.getItem(`zepta_${user.id.slice(0,8)}_active_bots`) || "[]").length; } catch { return 0; } })();
                const txt = t("profile.reportShareText", { name: user?.user_metadata?.nickname || t("profile.investorFallback"), watch: watchlist.length, bots, days });
                if (navigator.share) navigator.share({ title: t("profile.reportShareTitle"), text: txt }).catch(() => {});
                else navigator.clipboard.writeText(txt).then(() => showToast(t("profile.copiedToast"), "success")).catch(() => {});
              }} style={{
                padding: "10px 24px", borderRadius: "10px", fontSize: "14px", fontWeight: 700,
                background: `linear-gradient(135deg, ${C.blue}, ${C.purple})`, color: "#fff",
                border: "none", cursor: "pointer",
              }}>📤 {t("profile.shareBtn")}</button>
            </div>

            {/* ── 오늘의 참여 콘텐츠 (★ 2026-07 정보 피벗 Phase 1: 새 홈 6블록 상한으로
                 홈에서 빠진 '마켓 예측·퀴즈'를 기능 삭제 없이 이곳으로 이관) ── */}
            <div style={{ fontSize: "14px", fontWeight: 800, color: C.text3, letterSpacing: "0.4px", margin: "8px 4px 0" }}>{t("profile.todayEngage")}</div>
            {renderMarketPredictionCard()}
            {renderMarketQuizCard()}

            {/* ── 콘텐츠 바로가기 — 새 홈에서 빠진 정보 블록의 상위 화면 진입 링크 목록 ── */}
            <div style={{ background: C.card, borderRadius: "16px", overflow: "hidden", border: `1px solid ${C.border}${C.isDark ? '18' : '40'}` }}>
              <div style={{ padding: "14px 20px", fontSize: "14px", fontWeight: 800, color: C.text1 }}>{t("profile.contentShortcuts")}</div>
              {[
                { icon: "⚡", label: t("nav.anomaly"), tab: "anomaly" },
                { icon: "🗺️", label: t("nav.riskMap"), tab: "risk-map" },
                { icon: "🔍", label: t("profile.shortcutScreener"), tab: "screener" },
                { icon: "📊", label: t("tabs.quantReport.marketReportTitle"), tab: "quant-report" },
              ].map((item, i) => (
                // 고객지원 리스트와 동일한 키보드 접근성 처리 (role/tabIndex/onKeyDown)
                <div key={i} onClick={() => setTab(item.tab)}
                  role="button" tabIndex={0}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setTab(item.tab); } }}
                  style={{
                    display: "flex", alignItems: "center", gap: "14px",
                    padding: "13px 20px", borderTop: `1px solid ${C.border}15`, cursor: "pointer",
                    transition: "background .1s",
                  }}
                onMouseEnter={e => e.currentTarget.style.background = `${C.border}10`}
                onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                  <span style={{ fontSize: "16px", width: "24px", textAlign: "center" }}>{item.icon}</span>
                  <span style={{ fontSize: "15px", fontWeight: 600, color: C.text2, flex: 1 }}>{item.label}</span>
                  <span style={{ fontSize: "14px", color: C.text3 }}>›</span>
                </div>
              ))}
            </div>

            {/* 친구 초대 */}
            <div style={{ background: C.card, borderRadius: "16px", padding: "20px", border: `1px solid ${C.border}${C.isDark ? '18' : '40'}` }}>
              <div style={{ fontSize: "14px", fontWeight: 800, color: C.text1, marginBottom: "10px" }}>{t("profile.invite")}</div>
              {/* "AI 퀀트 전략" 표현은 룰베이스 산출을 AI 로 표기하는 역량 과장이라 사실 서술로 정정했습니다.
                  (구 profile.inviteDesc 키는 AI 문구가 남아 있어 재사용하지 않고 inviteDesc2 로 분리) */}
              <div style={{ fontSize: "14px", color: C.text3, marginBottom: "12px" }}>{t("profile.inviteDesc2")}</div>
              <div style={{ display: "flex", gap: "8px" }}>
                <button onClick={() => {
                  const txt = t("profile.inviteShareText");
                  if (navigator.share) navigator.share({ text: txt }).catch(() => {});
                  else navigator.clipboard.writeText(txt).then(() => showToast(t("profile.copiedShort"), "success")).catch(() => {});
                }} style={{ flex: 1, padding: "10px", borderRadius: "10px", fontSize: "14px", fontWeight: 700, background: C.blue, color: "#fff", border: "none", cursor: "pointer" }}>{t("profile.shareBtn")}</button>
                <button onClick={() => navigator.clipboard.writeText("https://zepta.app").then(() => showToast(t("profile.linkCopied"), "success")).catch(() => {})} style={{
                  flex: 1, padding: "10px", borderRadius: "10px", fontSize: "14px", fontWeight: 700,
                  background: "transparent", color: C.text2, border: `1px solid ${C.border}30`, cursor: "pointer",
                }}>{t("profile.copyLink")}</button>
              </div>
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════
            정적 콘텐츠 페이지 (AdSense 승인용)
        ═══════════════════════════════════════════════════════════ */}
        {tab === "about" && (
          <div className="tab-content">
            {/* ── 히어로 섹션 ── */}
            <div style={{
              background: `linear-gradient(135deg, ${C.blueBg} 0%, ${C.purpleBg} 100%)`,
              borderRadius: "24px", padding: isMobile ? "32px 20px" : "48px 40px",
              marginBottom: "32px", textAlign: "center",
              border: `1px solid ${C.purple}20`,
              boxShadow: `0 8px 32px rgba(155,111,255,0.15)`,
            }}>
              <h1 style={{
                fontSize: isMobile ? "28px" : "36px", fontWeight: 900, color: C.text1,
                marginBottom: "12px", letterSpacing: "-1px"
              }}>AI가 만드는 투자의 미래</h1>
              <p style={{
                fontSize: isMobile ? "15px" : "18px", color: C.text2,
                marginBottom: "0", lineHeight: 1.6, maxWidth: "600px", margin: "0 auto"
              }}>
                퀀트 지표를 24/7 자동 분석하고, 주요 지지 구간과 시장 신호를 짚어줍니다.
              </p>
            </div>

            {/* ── 핵심 기능 카드 그리드 ── */}
            <div style={{ marginBottom: "40px" }}>
              <h2 style={{
                fontSize: isMobile ? "24px" : "24px", fontWeight: 800, color: C.text1,
                marginBottom: "24px", textAlign: "center"
              }}>Zepta의 핵심 기능</h2>
              <div style={{
                display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3, 1fr)",
                gap: "16px", marginBottom: "24px"
              }}>
                {[
                  { icon: "🤖", title: "AI 시장 신호 분석", desc: "다양한 알파 신호를 24/7 자동 분석" },
                  { icon: "📊", title: "실시간 스크리너", desc: "수백 개 지표로 주요 지지 구간 자동 탐색" },
                  { icon: "🎯", title: "백테스트 엔진", desc: "과거 데이터로 전략 성과 검증" },
                  { icon: "⚡", title: "이상 감지", desc: "통계적 이상치 실시간 모니터링" },
                  { icon: "🌍", title: "글로벌 커버리지", desc: "미국·한국 주식 + 주요 암호화폐" },
                  { icon: "🔒", title: "안전한 투자", desc: "리스크 관리 + 포트폴리오 최적화" },
                ].map((f, i) => (
                  <div key={i} style={{
                    background: `linear-gradient(135deg, ${C.card} 0%, ${C.card2} 100%)`,
                    borderRadius: "16px", padding: "20px",
                    border: `1px solid ${C.border}20`,
                    borderLeft: `4px solid ${[C.blue, C.purple, C.green, C.blue, C.purple, C.green][i]}`,
                    boxShadow: `0 2px 12px rgba(0,0,0,${C.isDark ? 0.15 : 0.08})`,
                    transition: "all 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
                  }}
                  onMouseEnter={e => {
                    if (!isMobile) {
                      e.currentTarget.style.transform = "translateY(-4px) scale(1.01)";
                      e.currentTarget.style.boxShadow = `0 8px 24px rgba(0,0,0,${C.isDark ? 0.25 : 0.12})`;
                    }
                  }}
                  onMouseLeave={e => {
                    if (!isMobile) {
                      e.currentTarget.style.transform = "translateY(0) scale(1)";
                      e.currentTarget.style.boxShadow = `0 2px 12px rgba(0,0,0,${C.isDark ? 0.15 : 0.08})`;
                    }
                  }}>
                    <div style={{ fontSize: "36px", marginBottom: "12px" }}>{f.icon}</div>
                    <h3 style={{ fontSize: "16px", fontWeight: 800, color: C.text1, marginBottom: "6px" }}>{f.title}</h3>
                    <p style={{ fontSize: "14px", color: C.text3, lineHeight: 1.5, margin: 0 }}>{f.desc}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* ── 서비스 개요 섹션 ── */}
            <div style={{
              maxWidth: "800px", margin: "0 auto",
              padding: isMobile ? "16px" : "32px 40px",
              lineHeight: 1.7, color: C.text2
            }}>
              <section style={{ marginBottom: "32px", background: `linear-gradient(135deg, ${C.card} 0%, ${C.card2} 100%)`, borderRadius: "16px", padding: "24px", border: `1px solid ${C.border}20`, borderLeft: `4px solid ${C.blue}` }}>
                <h2 style={{ fontSize: isMobile ? "18px" : "20px", fontWeight: 700, color: C.text1, marginBottom: "12px" }}>서비스 개요</h2>
                <p style={{ fontSize: isMobile ? "15px" : "16px", marginBottom: "14px", lineHeight: 1.7 }}>
                  Zepta는 개인 투자자를 위한 종합 투자 정보 플랫폼입니다. 미국·한국 주식과 글로벌 암호화폐 시장을 아우르는 실시간 데이터 분석, AI 기반 퀀트 시장 신호, 리스크 지표를 제공하여 데이터 기반의 합리적인 투자 의사결정을 지원합니다.
                </p>
                <p style={{ fontSize: isMobile ? "15px" : "16px", marginBottom: "0", lineHeight: 1.7 }}>
                  기존 금융 서비스의 복잡하고 전문가 중심적인 인터페이스에서 벗어나, 투자 초보자부터 전문 트레이더까지 누구나 쉽게 사용할 수 있는 직관적인 경험을 제공하는 것이 Zepta의 핵심 가치입니다.
                </p>
              </section>

              <section style={{ marginBottom: "32px", background: `linear-gradient(135deg, ${C.card} 0%, ${C.card2} 100%)`, borderRadius: "16px", padding: "24px", border: `1px solid ${C.border}20`, borderLeft: `4px solid ${C.purple}` }}>
                <h2 style={{ fontSize: isMobile ? "18px" : "20px", fontWeight: 700, color: C.text1, marginBottom: "16px" }}>주요 기능 상세</h2>
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  <p style={{ fontSize: isMobile ? "15px" : "16px", marginBottom: "0", lineHeight: 1.7 }}>
                    <strong style={{ color: C.text1 }}>실시간 시장 모니터링</strong> — S&P 500, 나스닥, 다우존스 등 주요 지수와 개별 종목의 실시간 시세를 한눈에 확인할 수 있습니다.
                  </p>
                  <p style={{ fontSize: isMobile ? "15px" : "16px", marginBottom: "0", lineHeight: 1.7 }}>
                    <strong style={{ color: C.text1 }}>AI 시장 신호 분석</strong> — 멀티팩터 시그널 분석으로 상승·하락 신호 상태를 자동 산출합니다.
                  </p>
                  <p style={{ fontSize: isMobile ? "15px" : "16px", marginBottom: "0", lineHeight: 1.7 }}>
                    <strong style={{ color: C.text1 }}>종목 스크리너</strong> — 기술적 분석 지표와 펀더멘털 데이터를 조합하여 투자 기회를 탐색합니다.
                  </p>
                  <p style={{ fontSize: isMobile ? "15px" : "16px", marginBottom: "0", lineHeight: 1.7 }}>
                    <strong style={{ color: C.text1 }}>포트폴리오 관리</strong> — 보유 자산의 수익률, 배분 비율, 리스크 지표를 실시간으로 모니터링합니다.
                  </p>
                  <p style={{ fontSize: isMobile ? "15px" : "16px", marginBottom: "0", lineHeight: 1.7 }}>
                    <strong style={{ color: C.text1 }}>경제 캘린더 및 뉴스</strong> — 주요 경제 이벤트 일정과 실시간 금융 뉴스를 제공합니다.
                  </p>
                </div>
              </section>

              <section style={{ marginBottom: "32px", background: `linear-gradient(135deg, ${C.card} 0%, ${C.card2} 100%)`, borderRadius: "16px", padding: "24px", border: `1px solid ${C.border}20`, borderLeft: `4px solid ${C.green}` }}>
                <h2 style={{ fontSize: isMobile ? "18px" : "20px", fontWeight: 700, color: C.text1, marginBottom: "12px" }}>운영 정보</h2>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  <p style={{ fontSize: isMobile ? "15px" : "16px", marginBottom: "0" }}>운영자: <strong style={{ color: C.text1 }}>서동인</strong></p>
                  <p style={{ fontSize: isMobile ? "15px" : "16px", marginBottom: "0" }}>이메일: <strong style={{ color: C.text1 }}>donginseo0421@gmail.com</strong></p>
                  <p style={{ fontSize: isMobile ? "15px" : "16px", marginBottom: "0" }}>서비스 URL: <strong style={{ color: C.text1 }}>zepta.app</strong></p>
                </div>
              </section>

              <section style={{ background: `linear-gradient(135deg, ${C.red}15 0%, ${C.red}08 100%)`, borderRadius: "16px", padding: "24px", border: `1px solid ${C.red}20`, borderLeft: `4px solid ${C.red}` }}>
                <h2 style={{ fontSize: isMobile ? "18px" : "20px", fontWeight: 700, color: C.text1, marginBottom: "12px" }}>면책 조항</h2>
                <p style={{ fontSize: isMobile ? "15px" : "16px", lineHeight: 1.7, marginBottom: "0" }}>
                  Zepta에서 제공하는 모든 정보와 분석은 투자 참고 자료로만 활용되어야 하며, 특정 금융 상품의 매수 또는 매도를 권유하지 않습니다. 모든 투자의 판단과 책임은 이용자 본인에게 있으며, Zepta는 투자 결과에 대한 법적 책임을 지지 않습니다.
                </p>
              </section>
            </div>
          </div>
        )}

        {tab === "privacy" && (
          <div className="tab-content" style={{ maxWidth: "800px", margin: "0 auto", padding: isMobile ? "16px" : "32px 40px", lineHeight: 1.7, color: C.text2 }}>
            <PageHeader
              title="개인정보처리방침"
              subtitle="시행일: 2025년 1월 1일 · 최종 수정: 2026년 4월 5일"
              isMobile={isMobile}
              style={{ marginBottom: 24 }}
            />

            <section style={{ marginBottom: "28px", background: `linear-gradient(135deg, ${C.card} 0%, ${C.card2} 100%)`, borderRadius: "16px", padding: "20px", border: `1px solid ${C.border}20`, borderLeft: `4px solid ${C.blue}` }}>
              <h2 style={{ fontSize: isMobile ? "16px" : "18px", fontWeight: 700, color: C.text1, marginBottom: "10px" }}>1. 수집하는 개인정보 항목</h2>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <p style={{ fontSize: isMobile ? "15px" : "16px", marginBottom: "0", lineHeight: 1.7 }}>Zepta는 서비스 제공을 위해 다음과 같은 개인정보를 수집합니다.</p>
                <p style={{ fontSize: isMobile ? "15px" : "16px", marginBottom: "0", lineHeight: 1.7 }}>필수 항목: 이메일 주소 (회원가입 및 로그인 시)</p>
                <p style={{ fontSize: isMobile ? "15px" : "16px", marginBottom: "0", lineHeight: 1.7 }}>선택 항목: 프로필 이름, 프로필 이미지 (소셜 로그인 시 제공)</p>
                <p style={{ fontSize: isMobile ? "15px" : "16px", marginBottom: "0", lineHeight: 1.7 }}>자동 수집: 서비스 이용 기록, 접속 로그, 기기 정보</p>
              </div>
            </section>

            <section style={{ marginBottom: "28px", background: `linear-gradient(135deg, ${C.card} 0%, ${C.card2} 100%)`, borderRadius: "16px", padding: "20px", border: `1px solid ${C.border}20`, borderLeft: `4px solid ${C.purple}` }}>
              <h2 style={{ fontSize: isMobile ? "16px" : "18px", fontWeight: 700, color: C.text1, marginBottom: "10px" }}>2. 개인정보의 수집 및 이용 목적</h2>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <p style={{ fontSize: isMobile ? "15px" : "16px", marginBottom: "0", lineHeight: 1.7 }}>회원 관리: 회원 식별, 인증, 계정 관리</p>
                <p style={{ fontSize: isMobile ? "15px" : "16px", marginBottom: "0", lineHeight: 1.7 }}>서비스 제공: 관심 종목 저장, 사용자 설정 저장</p>
                <p style={{ fontSize: isMobile ? "15px" : "16px", marginBottom: "0", lineHeight: 1.7 }}>서비스 개선: 이용 통계 분석, 서비스 품질 향상</p>
                <p style={{ fontSize: isMobile ? "15px" : "16px", marginBottom: "0", lineHeight: 1.7 }}>광고 게재: Google AdSense를 통한 맞춤형 광고 제공</p>
              </div>
            </section>

            <section style={{ marginBottom: "28px", background: `linear-gradient(135deg, ${C.card} 0%, ${C.card2} 100%)`, borderRadius: "16px", padding: "20px", border: `1px solid ${C.border}20`, borderLeft: `4px solid ${C.green}` }}>
              <h2 style={{ fontSize: isMobile ? "16px" : "18px", fontWeight: 700, color: C.text1, marginBottom: "10px" }}>3. 개인정보의 보유 및 이용 기간</h2>
              <p style={{ fontSize: isMobile ? "15px" : "16px", lineHeight: 1.7, marginBottom: "0" }}>
                회원 탈퇴 시 즉시 파기합니다. 단, 관련 법령에 따라 보존이 필요한 경우 해당 기간 동안 보관합니다. 전자상거래법에 따른 계약은 5년, 소비자 불만 처리는 3년, 접속 기록은 3개월간 보관합니다.
              </p>
            </section>

            <section style={{ marginBottom: "28px", background: `linear-gradient(135deg, ${C.card} 0%, ${C.card2} 100%)`, borderRadius: "16px", padding: "20px", border: `1px solid ${C.border}20`, borderLeft: `4px solid ${C.blue}` }}>
              <h2 style={{ fontSize: isMobile ? "16px" : "18px", fontWeight: 700, color: C.text1, marginBottom: "10px" }}>4. 개인정보의 제3자 제공</h2>
              <p style={{ fontSize: isMobile ? "15px" : "16px", lineHeight: 1.7, marginBottom: "0" }}>
                Zepta는 이용자의 개인정보를 원칙적으로 제3자에게 제공하지 않습니다. 다만, 이용자의 사전 동의가 있는 경우와 법령에 의해 요구되는 경우에는 예외로 합니다.
              </p>
            </section>

            <section style={{ marginBottom: "28px", background: `linear-gradient(135deg, ${C.card} 0%, ${C.card2} 100%)`, borderRadius: "16px", padding: "20px", border: `1px solid ${C.border}20`, borderLeft: `4px solid ${C.purple}` }}>
              <h2 style={{ fontSize: isMobile ? "16px" : "18px", fontWeight: 700, color: C.text1, marginBottom: "10px" }}>5. 쿠키 및 광고 관련 안내</h2>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <p style={{ fontSize: isMobile ? "15px" : "16px", marginBottom: "0", lineHeight: 1.7 }}>
                  Zepta는 Google AdSense를 통해 광고를 게재하며, Google은 쿠키를 사용하여 맞춤형 광고를 제공할 수 있습니다.
                </p>
                <p style={{ fontSize: isMobile ? "15px" : "16px", marginBottom: "0", lineHeight: 1.7 }}>
                  쿠키는 브라우저 설정을 통해 거부할 수 있으며, 쿠키 저장을 거부할 경우 일부 서비스 이용에 어려움이 있을 수 있습니다.
                </p>
              </div>
            </section>

            <section style={{ marginBottom: "28px", background: `linear-gradient(135deg, ${C.card} 0%, ${C.card2} 100%)`, borderRadius: "16px", padding: "20px", border: `1px solid ${C.border}20`, borderLeft: `4px solid ${C.green}` }}>
              <h2 style={{ fontSize: isMobile ? "16px" : "18px", fontWeight: 700, color: C.text1, marginBottom: "10px" }}>6. 개인정보의 안전성 확보 조치</h2>
              <p style={{ fontSize: isMobile ? "15px" : "16px", lineHeight: 1.7, marginBottom: "0" }}>
                Zepta는 개인정보의 안전성 확보를 위해 HTTPS 암호화 통신, Supabase 인증 시스템 활용, 비밀번호 암호화 저장, 접근 권한 관리 등의 조치를 시행하고 있습니다.
              </p>
            </section>

            <section style={{ background: `linear-gradient(135deg, ${C.card} 0%, ${C.card2} 100%)`, borderRadius: "16px", padding: "20px", border: `1px solid ${C.border}20`, borderLeft: `4px solid ${C.blue}` }}>
              <h2 style={{ fontSize: isMobile ? "16px" : "18px", fontWeight: 700, color: C.text1, marginBottom: "10px" }}>7. 개인정보 보호 책임자</h2>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <p style={{ fontSize: isMobile ? "15px" : "16px", marginBottom: "0", lineHeight: 1.7 }}>이름: <strong style={{ color: C.text1 }}>서동인</strong></p>
                <p style={{ fontSize: isMobile ? "15px" : "16px", marginBottom: "0", lineHeight: 1.7 }}>이메일: <strong style={{ color: C.text1 }}>donginseo0421@gmail.com</strong></p>
                <p style={{ fontSize: isMobile ? "15px" : "16px", marginBottom: "0", lineHeight: 1.7 }}>개인정보 관련 문의는 위 이메일로 연락 부탁드립니다.</p>
              </div>
            </section>
          </div>
        )}

        {tab === "terms" && (
          <div className="tab-content" style={{ maxWidth: "800px", margin: "0 auto", padding: isMobile ? "16px" : "32px 40px", lineHeight: 1.7, color: C.text2 }}>
            <PageHeader
              title="이용약관"
              subtitle="시행일: 2025년 1월 1일 · 최종 수정: 2026년 4월 5일"
              isMobile={isMobile}
              style={{ marginBottom: 24 }}
            />

            <section style={{ marginBottom: "28px", background: `linear-gradient(135deg, ${C.card} 0%, ${C.card2} 100%)`, borderRadius: "16px", padding: "20px", border: `1px solid ${C.border}20`, borderLeft: `4px solid ${C.blue}` }}>
              <h2 style={{ fontSize: isMobile ? "16px" : "18px", fontWeight: 700, color: C.text1, marginBottom: "10px" }}>제1조 (목적)</h2>
              <p style={{ fontSize: isMobile ? "15px" : "16px", lineHeight: 1.7, marginBottom: "0" }}>
                본 약관은 Zepta가 제공하는 투자 정보 서비스의 이용 조건 및 절차, 이용자와 서비스 간의 권리·의무·책임 사항을 규정함을 목적으로 합니다.
              </p>
            </section>

            <section style={{ marginBottom: "28px", background: `linear-gradient(135deg, ${C.card} 0%, ${C.card2} 100%)`, borderRadius: "16px", padding: "20px", border: `1px solid ${C.border}20`, borderLeft: `4px solid ${C.purple}` }}>
              <h2 style={{ fontSize: isMobile ? "16px" : "18px", fontWeight: 700, color: C.text1, marginBottom: "10px" }}>제2조 (서비스의 내용)</h2>
              <p style={{ fontSize: isMobile ? "15px" : "16px", lineHeight: 1.7, marginBottom: "0" }}>
                서비스는 실시간 시장 데이터 조회 및 분석, AI 기반 시장 신호 분석, 종목 스크리닝, 포트폴리오 관리, 경제 캘린더 및 뉴스를 제공합니다. 서비스는 투자 참고 자료를 제공하는 것이며, 투자 자문 서비스가 아닙니다.
              </p>
            </section>

            <section style={{ marginBottom: "28px", background: `linear-gradient(135deg, ${C.card} 0%, ${C.card2} 100%)`, borderRadius: "16px", padding: "20px", border: `1px solid ${C.border}20`, borderLeft: `4px solid ${C.green}` }}>
              <h2 style={{ fontSize: isMobile ? "16px" : "18px", fontWeight: 700, color: C.text1, marginBottom: "10px" }}>제3조 (이용자의 의무)</h2>
              <p style={{ fontSize: isMobile ? "15px" : "16px", lineHeight: 1.7, marginBottom: "0" }}>
                이용자는 본 약관 및 관련 법령을 준수해야 합니다. 서비스의 정상적인 운영을 방해하는 행위, 개인정보를 부정하게 수집하는 행위, 불법 행위는 금지됩니다. 계정 무단 사용을 발견한 경우 즉시 서비스에 알려야 합니다.
              </p>
            </section>

            <section style={{ marginBottom: "28px", background: `linear-gradient(135deg, ${C.red}15 0%, ${C.red}08 100%)`, borderRadius: "16px", padding: "20px", border: `1px solid ${C.red}20`, borderLeft: `4px solid ${C.red}` }}>
              <h2 style={{ fontSize: isMobile ? "16px" : "18px", fontWeight: 700, color: C.text1, marginBottom: "10px" }}>제4조 (투자 관련 면책)</h2>
              <p style={{ fontSize: isMobile ? "15px" : "16px", lineHeight: 1.7, marginBottom: "0" }}>
                서비스의 모든 정보는 투자 참고 자료일 뿐이며, 특정 금융 상품 매수/매도를 권유하지 않습니다. 모든 투자 의사결정의 책임은 이용자에게 있습니다. 자동매매 기능을 통해 실제 자금이 거래되며, 거래 손실에 대한 모든 책임은 이용자에게 있습니다.
              </p>
            </section>

            <section style={{ marginBottom: "28px", background: `linear-gradient(135deg, ${C.card} 0%, ${C.card2} 100%)`, borderRadius: "16px", padding: "20px", border: `1px solid ${C.border}20`, borderLeft: `4px solid ${C.blue}` }}>
              <h2 style={{ fontSize: isMobile ? "16px" : "18px", fontWeight: 700, color: C.text1, marginBottom: "10px" }}>제5조 (서비스의 변경 및 중단)</h2>
              <p style={{ fontSize: isMobile ? "15px" : "16px", lineHeight: 1.7, marginBottom: "0" }}>
                서비스는 운영상 필요한 경우 변경하거나 중단할 수 있습니다. 변경 또는 중단 시 가능한 범위에서 사전에 공지합니다. 불가항력적 사유로 중단되는 경우 별도의 통보 없이 중단될 수 있습니다.
              </p>
            </section>

            <section style={{ marginBottom: "28px", background: `linear-gradient(135deg, ${C.card} 0%, ${C.card2} 100%)`, borderRadius: "16px", padding: "20px", border: `1px solid ${C.border}20`, borderLeft: `4px solid ${C.purple}` }}>
              <h2 style={{ fontSize: isMobile ? "16px" : "18px", fontWeight: 700, color: C.text1, marginBottom: "10px" }}>제6조 (지적재산권)</h2>
              <p style={{ fontSize: isMobile ? "15px" : "16px", lineHeight: 1.7, marginBottom: "0" }}>
                서비스의 콘텐츠에 대한 저작권 및 지적재산권은 서비스에 귀속됩니다. 이용자는 개인적 용도로만 사용할 수 있으며, 무단 복제, 배포, 상업적 이용은 금지됩니다.
              </p>
            </section>

            <section style={{ background: `linear-gradient(135deg, ${C.card} 0%, ${C.card2} 100%)`, borderRadius: "16px", padding: "20px", border: `1px solid ${C.border}20`, borderLeft: `4px solid ${C.green}` }}>
              <h2 style={{ fontSize: isMobile ? "16px" : "18px", fontWeight: 700, color: C.text1, marginBottom: "10px" }}>제7조 (분쟁 해결)</h2>
              <p style={{ fontSize: isMobile ? "15px" : "16px", lineHeight: 1.7, marginBottom: "0" }}>
                본 약관과 관련된 분쟁은 대한민국 법률에 따라 해석되며, 분쟁 발생 시 서울중앙지방법원을 관할 법원으로 합니다. 문의사항은 donginseo0421@gmail.com으로 연락 부탁드립니다.
              </p>
            </section>
          </div>
        )}

        {tab === "contact" && (
          <div className="tab-content" style={{ maxWidth: "800px", margin: "0 auto", padding: isMobile ? "16px" : "32px 40px", lineHeight: 1.7, color: C.text2 }}>
            <PageHeader
              title="문의하기"
              isMobile={isMobile}
              style={{ marginBottom: 24 }}
            />
            <section style={{ marginBottom: "32px" }}>
              <p style={{ fontSize: isMobile ? "15px" : "16px", marginBottom: "14px", lineHeight: 1.7 }}>
                Zepta 서비스에 대한 문의, 건의, 불편 사항은 아래 연락처로 연락해 주세요. 최대한 빠르게 답변 드리겠습니다.
              </p>
              <div style={{ background: `linear-gradient(135deg, ${C.blue}15 0%, ${C.blue}08 100%)`, border: `1px solid ${C.blue}30`, borderRadius: "16px", padding: isMobile ? "16px" : "24px", marginBottom: "24px", borderLeft: `4px solid ${C.blue}` }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  <p style={{ fontSize: isMobile ? "15px" : "16px", marginBottom: "0", lineHeight: 1.7 }}><strong style={{ color: C.text1 }}>이메일</strong>: donginseo0421@gmail.com</p>
                  <p style={{ fontSize: isMobile ? "15px" : "16px", marginBottom: "0", lineHeight: 1.7 }}><strong style={{ color: C.text1 }}>운영자</strong>: 서동인</p>
                  <p style={{ fontSize: isMobile ? "15px" : "16px", marginBottom: "0", lineHeight: 1.7 }}><strong style={{ color: C.text1 }}>응답 시간</strong>: 보통 1~2 영업일 이내</p>
                </div>
              </div>
            </section>
            <section style={{ marginBottom: "32px", background: `linear-gradient(135deg, ${C.card} 0%, ${C.card2} 100%)`, borderRadius: "16px", padding: "20px", border: `1px solid ${C.border}20`, borderLeft: `4px solid ${C.purple}` }}>
              <h2 style={{ fontSize: isMobile ? "18px" : "20px", fontWeight: 700, color: C.text1, marginBottom: "16px" }}>문의 유형별 안내</h2>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <p style={{ fontSize: isMobile ? "15px" : "16px", marginBottom: "0", lineHeight: 1.7 }}><strong style={{ color: C.text1 }}>서비스 이용 관련</strong>: 기능 사용법, 계정 문제, 데이터 관련 문의</p>
                <p style={{ fontSize: isMobile ? "15px" : "16px", marginBottom: "0", lineHeight: 1.7 }}><strong style={{ color: C.text1 }}>버그 리포트</strong>: 서비스 오류나 비정상 동작 신고</p>
                <p style={{ fontSize: isMobile ? "15px" : "16px", marginBottom: "0", lineHeight: 1.7 }}><strong style={{ color: C.text1 }}>기능 제안</strong>: 새로운 기능이나 개선 사항 제안</p>
                <p style={{ fontSize: isMobile ? "15px" : "16px", marginBottom: "0", lineHeight: 1.7 }}><strong style={{ color: C.text1 }}>광고 및 제휴</strong>: 광고 게재, 비즈니스 제휴 관련 문의</p>
                <p style={{ fontSize: isMobile ? "15px" : "16px", marginBottom: "0", lineHeight: 1.7 }}><strong style={{ color: C.text1 }}>개인정보 관련</strong>: 개인정보 열람, 수정, 삭제 요청</p>
              </div>
            </section>
          </div>
        )}

        {/* ── 종목 상세 시트 (모바일 시안) — 전체 화면 오버레이 ── */}
        {detailSignal && (() => {
          // t 를 넘겨 asOfLabel(기준시각·신선도)이 로케일을 따르게 합니다 (감사 배치3 i18n)
          const built = buildAssetDetailProps(detailSignal, t);
          if (!built) return null;
          // 관심종목은 자산 마스터에 있는 종목만 토글합니다 — 코인은 CRYPTO_ASSETS,
          // 주식은 US/KR 마스터(코인과 동일 원칙). 매핑이 없으면 별 버튼을 숨깁니다
          // (마스터 밖 종목을 담으면 관심목록에서 시세를 못 불러옵니다).
          const wl = built.market === "crypto"
            ? (built.known
              ? { symbol: built.known.symbol, name: CRYPTO_KO_NAMES[built.known.id] || built.known.name, market: "crypto", symbolRaw: built.known.id }
              : null)
            : (built.known
              ? { symbol: built.known.symbol, name: built.known.name, market: built.market, symbolRaw: built.known.symbolRaw || built.known.symbol }
              : null);
          const isFav = wl ? watchlist.some((w) => w.symbol === wl.symbol) : false;
          return (
            <div
              ref={sheetRef}
              tabIndex={-1}
              role="dialog"
              aria-modal="true"
              aria-label={`${built.ticker} 종목 상세`}
              style={{
                // 하단 탭바가 z-index 10000 이라 그보다 위여야 시트가 화면을 온전히 덮습니다.
                position: "fixed", inset: 0, zIndex: 10001, background: C.bg,
                overflowY: "auto", WebkitOverflowScrolling: "touch",
                paddingBottom: "env(safe-area-inset-bottom, 0px)",
                outline: "none",
              }}
            >
              {/* 375px 시안 전제 시트가 데스크탑에서 1440px 전폭으로 늘어지지 않도록
                  폭만 제한합니다 (모바일은 none — 현행 동일). 스크롤 컨테이너가 아니라
                  내부 sticky 헤더는 계속 오버레이 기준으로 동작합니다. */}
              <div style={{ maxWidth: isMobile ? "none" : "560px", margin: "0 auto", minHeight: "100%" }}>
                <Suspense fallback={<LazyTabFallback />}>
                  {/* spark: coingecko id 가 있는 코인만 실데이터 차트 —
                      symbol 일치 가드로 이전 종목의 응답이 새 종목 화면에 남지 않게 합니다. */}
                  <AssetDetailSheet
                    {...built.props}
                    spark={(() => {
                      if (!(detailSpark && detailSpark.symbol === built.ticker && detailSpark.points.length >= 2)) return undefined;
                      const pts = detailSpark.points;
                      // 라인 색은 시그널 방향이 아니라 "선택 기간의 실제 등락"을 따릅니다
                      // (숏 시그널이어도 기간 내 상승했으면 상승색 — 사실 서술 원칙).
                      return { points: pts, dir: pts[pts.length - 1] >= pts[0] ? "up" : "down" };
                    })()}
                    range={detailRange}
                    onRangeChange={setDetailRange}
                    // 기간 탭을 바꿔 새 데이터를 불러오는 동안(보유 spark 의 range ≠ 선택 range)
                    // 이전 기간 차트를 흐리게 표시합니다. 실패 시 detailRange 가 보유 기간으로
                    // 되돌아가므로 흐림도 함께 풀립니다.
                    sparkPending={!!(detailSpark && detailSpark.symbol === built.ticker && detailSpark.range !== detailRange)}
                    onBack={() => setDetailSignal(null)}
                    isFavorite={isFav}
                    onToggleFavorite={wl ? () => setWatchlist((prev) =>
                      prev.some((w) => w.symbol === wl.symbol)
                        ? prev.filter((w) => w.symbol !== wl.symbol)
                        : [...prev, wl]
                    ) : undefined}
                  />
                </Suspense>
              </div>
            </div>
          );
        })()}

        {/* 차트 모달 */}
        {chartAsset && (
          <Suspense fallback={<LazyTabFallback />}>
            <ChartModal asset={chartAsset} onClose={() => setChartAsset(null)} krwRate={krwRate} theme={themeMode} />
          </Suspense>
        )}

        {/* ═══ 풋터 (토스 스타일) — 모바일 column / 데스크탑 가로 ═══ */}
        <footer style={{
          maxWidth: "1400px", margin: "60px auto 0",
          padding: isMobile
            ? "24px 16px calc(100px + env(safe-area-inset-bottom, 0px))"
            : "32px 24px calc(40px + env(safe-area-inset-bottom, 0px))",
          borderTop: `1px solid ${C.border}${C.isDark ? '20' : '40'}`,
        }}>
          {/* 상단: 네비게이션 링크 — 모바일 column / 데스크탑 가로 wrap */}
          <div style={{
            display: "flex",
            flexDirection: isMobile ? "column" : "row",
            alignItems: isMobile ? "flex-start" : "center",
            gap: isMobile ? "10px" : "0",
            flexWrap: "wrap",
            marginBottom: isMobile ? "16px" : "20px",
          }}>
            {[
              { label: t("footer.privacy"), tab: "privacy", bold: true },
              { label: t("footer.terms"), tab: "terms" },
              { label: t("footer.about"), tab: "about" },
              { label: t("footer.blog"), href: "/blog" },
              { label: t("footer.guide"), href: "/guide" },
              // ★ 감사 배치3 (고아 페이지): /econ(경제지표 발표 결과, 하위 16종 포함)은
              //   서버 렌더 공개 페이지인데 앱 어디에서도 링크되지 않아 검색엔진으로만
              //   도달 가능했습니다 — 정보성 링크(블로그·가이드) 뒤에 진입점을 둡니다.
              { label: t("footer.econResults"), href: "/econ" },
              { label: t("footer.contact"), tab: "contact" },
            ].map((item, i) => (
              <span key={item.tab || item.href} style={{ display: "flex", alignItems: "center" }}>
                {!isMobile && i > 0 && <span style={{ margin: "0 10px", color: C.text2, opacity: 0.25 }}>|</span>}
                {item.href ? (
                  <a
                    href={item.href}
                    style={{
                      fontSize: isMobile ? "14px" : "16px", color: C.text2, cursor: "pointer",
                      fontWeight: item.bold ? 700 : 400, textDecoration: "none",
                      minHeight: isMobile ? "32px" : "auto",
                      display: "flex", alignItems: "center",
                    }}
                  >{item.label}</a>
                ) : (
                  // span onClick → 앵커: 키보드·스크린리더 도달성과 새 탭 열기를 살립니다.
                  // setTab 이 같은 경로로 pushState 하므로 좌클릭 동작·URL 은 현행과 동일합니다.
                  <a
                    href={`/${item.tab}`}
                    onClick={(e) => { e.preventDefault(); setTab(item.tab); }}
                    style={{
                      fontSize: isMobile ? "14px" : "16px", color: C.text2, cursor: "pointer",
                      fontWeight: item.bold ? 700 : 400, textDecoration: "none",
                      minHeight: isMobile ? "32px" : "auto",
                      display: "flex", alignItems: "center",
                    }}
                  >{item.label}</a>
                )}
              </span>
            ))}
          </div>

          {/* 중단: 사업자 정보 */}
          <div style={{ fontSize: isMobile ? "13px" : "16px", color: C.text2, lineHeight: 1.7, marginBottom: "16px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "6px" }}>
              <img src="/zepta-icon-192.png" alt="Zepta" width="18" height="18" style={{ flexShrink: 0 }} />
              <span style={{ fontWeight: 600, fontSize: isMobile ? "14px" : "16px", color: C.text1 }}>Zepta</span>
            </div>
            <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", gap: isMobile ? "2px" : "0" }}>
              <span>{t("footer.ceoLine")}</span>
              {!isMobile && <span style={{ margin: "0 8px", opacity: 0.3 }}>·</span>}
              <span>{t("footer.contactLine")}</span>
            </div>
          </div>

          {/* 하단: 면책 + 저작권 — 법적 안전장치 강화 (2026-05-09) */}
          <div style={{ fontSize: isMobile ? "12px" : "14px", color: C.text3, lineHeight: 1.7 }}>
            <p style={{ margin: "0 0 6px", fontWeight: 600 }}>
              ⚠️ {t("footer.disclaimerTitle")}
            </p>
            <p style={{ margin: "0 0 6px" }}>
              {t("footer.disclaimerP1")}
            </p>
            <p style={{ margin: "0 0 6px" }}>
              {t("footer.disclaimerP2")}
            </p>
            <p style={{ margin: 0 }}>© 2025-2026 Zepta. All rights reserved.</p>
          </div>
        </footer>
      </main>
      </PullToRefresh>

      {/* ★ 2026-06-12 (대표 지시): 하단 실시간 티커 띠배너 제거 */}

      </div>{/* di-main-wrap */}

      {/* ═══ AI 투자 어시스턴트 플로팅 채팅 ═══ */}

      {/* 맨 위로 버튼 */}
      {showScrollTop && (
        <button
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          style={{
            position: "fixed",
            bottom: isMobile ? "100px" : "100px",
            right: isMobile ? "16px" : "28px",
            width: "44px",
            height: "44px",
            borderRadius: "50%",
            background: `${C.card}E0`,
            border: `1px solid ${C.border}30`,
            backdropFilter: "blur(8px)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "18px",
            color: C.text2,
            zIndex: 9990,
            transition: "all .2s",
            boxShadow: `0 4px 12px ${C.bg}80`,
          }}
          onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.background = C.blue; e.currentTarget.style.color = "#fff"; e.currentTarget.style.boxShadow = `0 6px 20px ${C.blue}40`; }}
          onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.background = `${C.card}E0`; e.currentTarget.style.color = C.text2; e.currentTarget.style.boxShadow = `0 4px 12px ${C.bg}80`; }}
          title={t("common.scrollTop")}
        >
          ↑
        </button>
      )}

      {/* ═══ 왓치리스트 도크 — 트레이딩뷰식 우측 패널 (데스크톱 전용, 2026-06-12 대표 아이디어) ═══ */}
      {!isMobile && (
        <>
          {/* 가장자리 핸들 — 어느 탭에서든 보임 */}
          <button onClick={toggleWatchDock} aria-label={t("watchDock.toggleAria")} style={{
            position: "fixed", right: watchDockOpen ? "300px" : 0, top: "50%", transform: "translateY(-50%)",
            width: "28px", height: "92px", borderRadius: "10px 0 0 10px", border: `1px solid ${C.border}`,
            borderRight: "none", background: C.card, color: watchlist.length ? C.yellow : C.text3,
            cursor: "pointer", zIndex: 9000, display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center", gap: "4px",
            boxShadow: "-4px 0 16px rgba(0,0,0,0.25)", transition: "right .2s ease",
          }}>
            <span style={{ fontSize: "14px", lineHeight: 1 }}>{watchDockOpen ? "›" : "⭐"}</span>
            {!watchDockOpen && watchlist.length > 0 && (
              <span style={{ fontSize: "11px", fontWeight: 800, color: C.blue }}>{watchlist.length}</span>
            )}
          </button>

          {/* 패널 */}
          {watchDockOpen && (
            <div style={{
              position: "fixed", right: 0, top: "72px", bottom: "16px", width: "300px",
              background: C.card, borderLeft: `1px solid ${C.border}`, borderTop: `1px solid ${C.border}`,
              borderBottom: `1px solid ${C.border}`, borderRadius: "14px 0 0 14px", zIndex: 9000,
              display: "flex", flexDirection: "column", boxShadow: "-8px 0 32px rgba(0,0,0,0.35)",
            }}>
              <div style={{ padding: "14px 14px 10px", borderBottom: `1px solid ${C.border}30`, flexShrink: 0 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: user ? 10 : 0 }}>
                  <span style={{ fontWeight: 800, fontSize: "15px", color: C.text1 }}>⭐ {t("tabs.home.watchlist")} {watchlist.length > 0 && <span style={{ color: C.blue }}>{watchlist.length}</span>}</span>
                  <button onClick={toggleWatchDock} aria-label={t("common.close")} style={{ background: "none", border: "none", color: C.text3, fontSize: "16px", cursor: "pointer", padding: 4 }}>✕</button>
                </div>
                {user && <SearchBar compact placeholder={t("tabs.home.addAssetPlaceholder")} onSelect={(asset) => {
                  if (!watchlist.some(w => w.symbol === asset.symbol)) {
                    setWatchlist(prev => [...prev, { symbol: asset.symbol, name: asset.name, market: asset.market, symbolRaw: asset.symbolRaw || asset.symbol, id: asset.id }]);
                    showToast(t("watchDock.addedToast", { name: asset.name }), "success");
                  }
                }} />}
              </div>

              <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "6px 8px" }}>
                {!user ? (
                  <div style={{ textAlign: "center", padding: "32px 14px", color: C.text3, fontSize: "13px", lineHeight: 1.6 }}>
                    {t("watchDock.loginPrompt1")}<br />{t("watchDock.loginPrompt2")}
                    <div><button onClick={() => setShowAuthModal(true)} style={{ marginTop: 12, padding: "8px 18px", borderRadius: 9, background: C.blue, color: "#fff", border: "none", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>{t("header.login")}</button></div>
                  </div>
                ) : watchlist.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "32px 14px", color: C.text3, fontSize: "13px", lineHeight: 1.6 }}>
                    📌 {t("watchDock.emptyHint1")}<br />{t("watchDock.emptyHint2")}
                  </div>
                ) : watchlist.map(w => {
                  const hot = hotAssets.find(h => h.symbol === w.symbol || h.symbol === w.symbolRaw);
                  const diag = hot ? quickDiagnosis(hot) : null;
                  const diagColor = diag ? (diag.score >= 60 ? C.green : diag.score >= 40 ? C.yellow : C.red) : C.text3;
                  return (
                    <div key={w.symbol} onClick={() => setSelectedAsset(w)} style={{
                      display: "flex", alignItems: "center", gap: 8, padding: "9px 8px",
                      borderRadius: 10, cursor: "pointer", transition: "background .12s",
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = `${C.card2}90`}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                      <div style={{
                        width: 28, height: 28, borderRadius: 8, flexShrink: 0, fontSize: 13, fontWeight: 800,
                        background: `${diagColor}14`, color: diagColor, display: "flex", alignItems: "center", justifyContent: "center",
                      }}>{diag ? diag.score : (w.market === "us" ? "🇺🇸" : w.market === "kr" ? "🇰🇷" : "₿")}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 13, color: C.text1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{w.name || w.symbol}</div>
                        {diag && <div style={{ fontSize: 11, color: diagColor, fontWeight: 600 }}>{verdictLabel(diag.opinion, t)}</div>}
                      </div>
                      {hot && (
                        <div style={{ textAlign: "right", flexShrink: 0 }}>
                          <div className="z-num" style={{ fontWeight: 700, fontSize: 13, color: C.text1, fontVariantNumeric: "tabular-nums" }}>{fmtPrice(hot.price, w.market)}</div>
                          <div style={{ fontSize: 11, fontWeight: 700, color: hot.change >= 0 ? C.green : C.red }}>{hot.change >= 0 ? "+" : ""}{hot.change}%</div>
                        </div>
                      )}
                      <button onClick={(e) => { e.stopPropagation(); setWatchlist(prev => prev.filter(x => x.symbol !== w.symbol)); }}
                        aria-label={t("watchDock.removeAria", { name: w.name || w.symbol })} style={{
                          width: 20, height: 20, borderRadius: 6, border: "none", background: "transparent",
                          color: C.text3, fontSize: 10, cursor: "pointer", opacity: 0.35, flexShrink: 0,
                        }}
                        onMouseEnter={e => { e.currentTarget.style.opacity = "1"; e.currentTarget.style.color = C.red; }}
                        onMouseLeave={e => { e.currentTarget.style.opacity = "0.35"; e.currentTarget.style.color = C.text3; }}>✕</button>
                    </div>
                  );
                })}
              </div>

              <div style={{ padding: "8px 14px", borderTop: `1px solid ${C.border}30`, fontSize: "11px", color: C.text3, flexShrink: 0 }}>
                {t("watchDock.footNote")}
              </div>
            </div>
          )}
        </>
      )}

      {/* ═══ 모바일 하단 탭 네비게이션 바 (2026-08 모바일 시안 스타일) ═══
           높이 82px 은 그대로 유지합니다 — PaperTrading·SavedScreeners 의 바닥 시트가
           calc(82px + safe-area) 로 이 값을 하드코딩해 참조하고 있어 바꾸면 겹칩니다.
           시안 반영: card2 경계선 · bg .92 + blur(14px) · 버튼 50px · 아이콘 21 · 라벨 10/700 */}
      {isMobile && (
        <nav className="mobile-bottom-nav" style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          height: "82px",
          background: `${C.bg}EB`, // .92 알파
          backdropFilter: "blur(14px)",
          WebkitBackdropFilter: "blur(14px)",
          borderTop: `1px solid ${C.card2}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-around",
          zIndex: 10000,
        }}>
          {/* ★ 2026-08-12 IA v3 (설계서 v3 0장): [홈 · 코인 · 주식 · 지표 · MY] 자산군 이원화.
              내부 id 는 유지(news=코인 탭 /crypto, screener=주식 탭 /stocks) — 라벨·아이콘만
              새 IA. 활성 판정은 gnbCategoryMap 카테고리 일치 그대로. 라벨은 i18n(nav.*). */}
          {[
            { id: "home", cat: "home", label: t("nav.home"), icon: (active) => <svg width="21" height="21" viewBox="0 0 24 24" fill={active ? "currentColor" : "none"} stroke="currentColor" strokeWidth={active ? "0" : "1.8"} strokeLinecap="round" strokeLinejoin="round"><path d={active ? "M3 10.5L12 3l9 7.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V10.5z" : "M3 10.5L12 3l9 7.5V20a1 1 0 0 1-1 1h-4.5v-6h-3v6H4a1 1 0 0 1-1-1V10.5z"} />{active && <rect x="9" y="14" width="6" height="7" rx="0.5" fill={C.isDark ? C.bg : "#fff"} />}</svg> },
            // 코인 — 동전 실루엣 (원 + 통화 기호 획). 활성 시 15% 틴트 채움(기존 문법).
            { id: "news", cat: "coin", label: t("nav.coin"), icon: (active) => <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? "2.2" : "1.8"} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" fill={active ? "currentColor" : "none"} opacity={active ? 0.15 : 1} /><circle cx="12" cy="12" r="9" /><path d="M14.8 9.7h-3.9a1.75 1.75 0 0 0 0 3.5h2.2a1.75 1.75 0 0 1 0 3.5H9.2" /><path d="M12 7.6v1.9M12 16.9v-2" /></svg> },
            // 주식 — 상승 추세선. 선형 아이콘이라 활성은 굵기 강조(라벨 색·aria-current 병행).
            { id: "screener", cat: "stock", label: t("nav.stocks"), icon: (active) => <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? "2.4" : "1.8"} strokeLinecap="round" strokeLinejoin="round"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17" /><polyline points="16 7 22 7 22 13" /></svg> },
            // 지표 — 캘린더 (IA v3: 지표 탭 = 경제 캘린더 + 뉴스)
            { id: "indicators", cat: "indicators", label: t("nav.indicators"), icon: (active) => <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? "2.2" : "1.8"} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="17" rx="2" fill={active ? "currentColor" : "none"} opacity={active ? 0.15 : 1} /><rect x="3" y="4" width="18" height="17" rx="2" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="16" y1="2" x2="16" y2="6" /></svg> },
            { id: "profile", cat: "my", label: t("nav.my"), icon: (active) => <svg width="21" height="21" viewBox="0 0 24 24" fill={active ? "currentColor" : "none"} stroke="currentColor" strokeWidth={active ? "2.2" : "1.8"} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4" fill={active ? "currentColor" : "none"} opacity={active ? 0.15 : 1} /><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" /></svg> },
          ].map(item => {
            const isActive = item.cat === gnbCategory;
            return (
              <button key={item.id} onClick={() => {
                setTab(item.id);
              }}
              // 스크린리더가 현재 탭 위치를 알 수 있도록 노출 (색·아이콘 fill 만으로는 전달 안 됨)
              aria-current={isActive ? "page" : undefined}
              style={{
                flex: 1,
                minHeight: "50px",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: "3px",
                padding: "4px 0",
                background: "transparent",
                border: "none",
                cursor: "pointer",
                color: isActive ? C.blueL : C.text3,
                transition: "color .2s",
                position: "relative",
                WebkitTapHighlightColor: "transparent",
              }}>
                <div style={{ width: 21, height: 21, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {item.icon(isActive)}
                </div>
                <span style={{
                  fontSize: "10px",
                  fontWeight: 700,
                  lineHeight: 1,
                  letterSpacing: "-0.2px",
                  // 비활성 라벨은 text3(4.26:1)로 AA 4.5:1 미달 — 텍스트만 text2 로 올립니다.
                  // 아이콘은 그래픽(3:1 기준 충족)이라 버튼 상속색(text3) 유지.
                  color: isActive ? C.blueL : C.text2,
                }}>{item.label}</span>
              </button>
            );
          })}
        </nav>
      )}


      </div>{/* di-app-body */}

      {/* ── 글로벌 검색 (/ 단축키) — 2026-06-12 대표 피드백: 모바일 UI 정돈 ── */}
      {globalSearchOpen && (() => {
        const popularStocks = [
          { symbol: "NVDA", name: "NVIDIA", flag: "🇺🇸" },
          { symbol: "AAPL", name: "Apple", flag: "🇺🇸" },
          { symbol: "TSLA", name: "Tesla", flag: "🇺🇸" },
          { symbol: "MSFT", name: "Microsoft", flag: "🇺🇸" },
          { symbol: "005930", name: "삼성전자", flag: "🇰🇷" },
          { symbol: "000660", name: "SK하이닉스", flag: "🇰🇷" },
        ];
        const cryptoQuick = [
          { symbol: "BTC-USD", name: "비트코인", icon: "₿" },
          { symbol: "ETH-USD", name: "이더리움", icon: "Ξ" },
          { symbol: "SOL-USD", name: "솔라나", icon: "◎" },
        ];
        const categories = [
          // ★ IA v3: 스크리너 = 주식 탭 안 — 목적지 동일(내부 id screener), 라벨 유지
          { label: t("searchOverlay.catScreener"), tab: "screener", icon: "🔍" },
          // ★ 2026-07 정보 서비스 피벗: 비owner 는 홈 시그널 보드로
          { label: t("searchOverlay.catSignalBoard"), tab: isOwner ? "real-trading" : "home", icon: "📡" },
          // ★ IA v3: 구 /coin 정적 대시보드(전체 리로드) → 코인 탭 인앱 전환 (SEO 페이지는 유지)
          { label: t("searchOverlay.catCoin"), tab: "news", icon: "🪙" },
          { label: t("searchOverlay.catEcon"), tab: "econ-calendar", icon: "📅" },
        ];
        return (
          <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(6px)", display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: isMobile ? "5vh" : "12vh" }}
            onClick={(e) => { if (e.target === e.currentTarget) setGlobalSearchOpen(false); }}>
            {/* ★ 시안 1g — 오버레이 표면은 페이지 톤(C.bg), 타일은 카드 톤(C.card) */}
            <div style={{ width: "560px", maxWidth: "94vw", maxHeight: isMobile ? "85dvh" : "80vh", overflowY: "auto", background: C.bg, borderRadius: "20px", border: `1px solid ${C.border}`, boxShadow: "0 24px 80px rgba(0,0,0,0.5)" }}>
              {/* 검색 헤더 + 닫기 */}
              <div style={{ padding: "14px 16px 10px", display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <SearchBar onSelect={(asset) => { setSelectedAsset(asset); setGlobalSearchOpen(false); }} placeholder={isMobile ? t("diag.searchShort") : t("diag.searchLong")} />
                </div>
                <button onClick={() => setGlobalSearchOpen(false)} aria-label={t("searchOverlay.closeAria")} style={{
                  flexShrink: 0, width: 38, height: 38, borderRadius: 12, border: `1px solid ${C.border}`,
                  background: C.card, color: C.text3, fontSize: 16, cursor: "pointer", lineHeight: 1,
                }}>✕</button>
              </div>

              {/* 빠른 이동 — 가로 스크롤 칩 (모바일 잘림 제거, 실제 기능 페이지로 연결) */}
              <div className="hscroll" style={{ padding: "0 16px 12px", display: "flex", gap: "8px", overflowX: "auto", scrollbarWidth: "none", WebkitOverflowScrolling: "touch" }}>
                {categories.map(cat => (
                  <button key={cat.label} onClick={() => {
                    if (cat.href) { window.location.href = cat.href; return; }
                    setTab(cat.tab); setGlobalSearchOpen(false);
                  }} style={{
                    padding: "8px 14px", borderRadius: "9999px", fontSize: "13px", fontWeight: 700, whiteSpace: "nowrap", flexShrink: 0,
                    background: C.card, color: C.text2, border: `1px solid ${C.border}`, cursor: "pointer",
                    transition: "all 0.15s", display: "inline-flex", alignItems: "center", gap: "5px", minHeight: 36,
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = C.blueBg; e.currentTarget.style.color = C.blue; }}
                  onMouseLeave={e => { e.currentTarget.style.background = C.card; e.currentTarget.style.color = C.text2; }}
                  >
                    <span style={{ fontSize: "14px" }}>{cat.icon}</span>
                    {cat.label}
                  </button>
                ))}
                {!isMobile && <span style={{ marginLeft: "auto", fontSize: "12px", color: C.text3, background: C.card, border: `1px solid ${C.border}`, padding: "5px 10px", borderRadius: "8px", alignSelf: "center", flexShrink: 0, fontFamily: MONO }}>ESC</span>}
              </div>

              <div style={{ height: "1px", background: `${C.border}${C.isDark ? '30' : '50'}` }} />

              {/* ★ 시안 1g 인기 종목 — 순위 + 종목명 + 실측 등락(hotAssets, 없으면 심볼 표기) 3열 타일 */}
              <div style={{ padding: "14px 16px 6px" }}>
                <div style={{ fontSize: "13px", fontWeight: 800, color: C.text3, marginBottom: "9px" }}>{t("searchOverlay.popularStocks")}</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "8px" }}>
                  {popularStocks.map((s, si) => {
                    const asset = ALL_ASSETS.find(a => a.symbol === s.symbol);
                    // 등락률은 실측(hotAssets)이 있을 때만 — 없으면 지어내지 않고 심볼을 표기합니다.
                    const hot = hotAssets.find(h => h.symbol === s.symbol);
                    return (
                      <button key={s.symbol} onClick={() => { if (asset) { setSelectedAsset(asset); setGlobalSearchOpen(false); }}} style={{
                        background: C.card, border: `1px solid ${C.border}`, borderRadius: "12px",
                        padding: "10px 11px", cursor: "pointer", textAlign: "left", minWidth: 0, minHeight: 56,
                        transition: "all 0.12s", fontFamily: "inherit",
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = C.card2; e.currentTarget.style.borderColor = C.border2; }}
                      onMouseLeave={e => { e.currentTarget.style.background = C.card; e.currentTarget.style.borderColor = C.border; }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: "5px", minWidth: 0 }}>
                          <Num size="12px" weight={800} color={C.text4}>{si + 1}</Num>
                          <span style={{ fontSize: "12px", fontWeight: 800, color: C.text1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.name}</span>
                        </div>
                        <div style={{ marginTop: "4px" }}>
                          {hot?.change != null
                            ? <ChangeNum value={hot.change} size="12px" />
                            : <Num size="12px" color={C.text4}>{s.flag} {s.symbol}</Num>}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 크립토 바로가기 — 시안 1g 타일 문법 */}
              <div style={{ padding: "6px 16px 14px" }}>
                <div style={{ fontSize: "13px", fontWeight: 800, color: C.text3, marginBottom: "9px" }}>{t("searchOverlay.crypto")}</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "8px" }}>
                  {cryptoQuick.map(c => {
                    const asset = ALL_ASSETS.find(a => a.symbol === c.symbol || a.symbol === c.symbol.replace("-USD", "/USD"));
                    // ★ IA v3: 자산 미등재 폴백은 /coin 전체 리로드 대신 코인 탭 인앱 전환
                    return (
                      <button key={c.symbol} onClick={() => { if (asset) { setSelectedAsset(asset); } else { setTab("news"); } setGlobalSearchOpen(false); }} style={{
                        display: "flex", flexDirection: "column", alignItems: "center", gap: "4px", padding: "10px 6px",
                        borderRadius: "12px", background: C.card, border: `1px solid ${C.border}`, cursor: "pointer",
                        transition: "all 0.12s", minWidth: 0, minHeight: 64, fontFamily: "inherit",
                      }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = C.purple + "40"; e.currentTarget.style.background = `${C.purple}10`; }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.background = C.card; }}
                      >
                        <span style={{ fontSize: "18px", fontWeight: 800, color: C.purple, lineHeight: 1, fontFamily: MONO }}>{c.icon}</span>
                        <span style={{ fontWeight: 700, fontSize: "13px", color: C.text1, whiteSpace: "nowrap" }}>{c.name}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 시안 1g 하단 면책 한 줄 */}
              <div style={{ padding: "0 16px 14px" }}>
                <Disclaimer />
              </div>
            </div>
          </div>
        );
      })()}

      {/* ═══ 로그인 필요 모달 ═══ */}
      {showAuthModal && (
        <div style={{
          position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
          background: "rgba(0,0,0,0.6)", backdropFilter: "blur(8px)",
          zIndex: 99999, display: "flex", alignItems: "center", justifyContent: "center",
          padding: "24px",
        }} onClick={(e) => { if (e.target === e.currentTarget) setShowAuthModal(false); }}>
          <div style={{
            width: "100%", maxWidth: "440px", maxHeight: "calc(100dvh - 48px)", overflowY: "auto",
            borderRadius: "20px", background: C.card,
            border: `1px solid ${C.border}`,
            boxShadow: C.isDark ? "0 20px 60px rgba(0,0,0,0.5)" : "0 20px 60px rgba(0,0,0,0.15)",
          }}>
            <div style={{ padding: "24px 24px 0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <img src="/zepta-icon-192.png" alt="Zepta" width="32" height="32" style={{ flexShrink: 0 }} />
                <div>
                  <h3 style={{ margin: 0, fontSize: "18px", fontWeight: 800, color: C.text1 }}>{t("auth.modalTitle")}</h3>
                  <p style={{ margin: "2px 0 0", fontSize: "16px", color: C.text3 }}>{t("auth.modalDesc")}</p>
                </div>
              </div>
              <button onClick={() => setShowAuthModal(false)} style={{
                background: "none", border: "none", color: C.text3, fontSize: "20px", cursor: "pointer", padding: "4px",
              }}>✕</button>
            </div>
            <div style={{ padding: "16px 24px 24px" }}>
              <AuthPage theme={themeMode} embedded onClose={() => setShowAuthModal(false)} />
            </div>
          </div>
        </div>
      )}

      {/* ── 입문자 온보딩 5스텝 (가입 직후 1회) ── */}
      {showOnboarding && (
        <Suspense fallback={null}>
          <Onboarding
            onClose={() => setShowOnboarding(false)}
            onNavigate={(targetTab) => { try { setTab(targetTab); } catch {} }}
            isOwner={isOwner}
          />
        </Suspense>
      )}

      {/* ── 토스트 알림 (향상된 시각) ── */}
      {/* ★ 2026-05-12 PLAN-SVC J: 위치를 헤더 아래로 명확히 + max-width 키움 (다이내믹 아일랜드 비간섭 + 가독성) */}
      {toasts.length > 0 && (
        <div style={{
          position: "fixed",
          top: "calc(env(safe-area-inset-top, 0px) + var(--header-h, 56px) + 12px)",
          left: "50%", transform: "translateX(-50%)",
          zIndex: 99999, display: "flex", flexDirection: "column", gap: "8px",
          pointerEvents: "none", padding: "0 16px",
        }}>
          {toasts.map(t => {
            const bgGradient = t.type === "error" ? `linear-gradient(135deg, #DC2626 0%, #991b1b 100%)` : t.type === "success" ? `linear-gradient(135deg, #16A34A 0%, #15803d 100%)` : `linear-gradient(135deg, #3B8BFF 0%, #1d4ed8 100%)`;
            const shadowColor = t.type === "error" ? "rgba(220, 38, 38, 0.4)" : t.type === "success" ? "rgba(22, 163, 74, 0.4)" : "rgba(59, 139, 255, 0.4)";
            const emoji = t.type === "error" ? "❌" : t.type === "success" ? "✅" : "ℹ️";
            return (
              <div key={t.id} style={{
                background: bgGradient,
                color: "#fff", padding: "14px 20px", borderRadius: "12px", fontSize: "15px", fontWeight: 600,
                boxShadow: `0 8px 28px ${shadowColor}`,
                pointerEvents: "auto", maxWidth: "min(440px, 92vw)",
                textAlign: "center", animation: "toastSlideIn 0.35s ease-out",
                display: "flex", alignItems: "center", gap: "10px", justifyContent: "center",
              }}>
                <span style={{ fontSize: "16px" }}>{emoji}</span>
                {t.msg}
              </div>
            );
          })}
        </div>
      )}

    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// 앱 진입점 — ErrorBoundary 래핑
// ════════════════════════════════════════════════════════════════════
export default function App() {
  return (
    <ErrorBoundary>
      <LanguageProvider>
        <AuthProvider>
          <AppInner />
        </AuthProvider>
      </LanguageProvider>
    </ErrorBoundary>
  );
}
