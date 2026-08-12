/**
 * Zepta GNB Header — shadcn/ui + Tailwind, 모바일 퍼스트
 *
 * 모바일: Sheet(좌측 드로어) + 하단 safe-area
 * 데스크탑: 수평 네비 + CSS absolute 드롭다운 (Floating-UI 미사용)
 *
 * NOTE: Radix DropdownMenu의 Floating-UI Popper가 App.jsx의 빈번한
 *       리렌더링으로 인해 위치 계산 실패 → translate(0,-200%) 고정 문제 발생.
 *       이를 해결하기 위해 순수 CSS absolute 포지셔닝 드롭다운으로 대체.
 */
import { useState, useRef, useCallback, useEffect, memo } from "react";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/i18n/LanguageContext";
import { Button } from "@/components/ui/button";
import {
  Sheet, SheetTrigger, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import {
  Menu, X, Search, ChevronDown, ChevronRight, Sun, Moon, LogOut, User,
  Bot, Shield, Briefcase, MessageSquare,
  CalendarDays, Bell, Zap, Target, FileText, LineChart,
  LayoutDashboard, TrendingUp, Activity, BookOpen,
  // ★ 2026-05-11: 신규 페이지 아이콘
  Sparkles, Trophy, Share2, GitCompare, PieChart, Save, Crown,
  Coins, // ★ 2026-08-12 IA v3: 코인 축 아이콘 (GNB 직행 + 시트)
} from "lucide-react";

/* ═══════════════════════════════════════════════════════════════
   커스텀 드롭다운 (Floating-UI 미사용, CSS absolute 포지셔닝)
   ═══════════════════════════════════════════════════════════════ */
function CssDropdown({ trigger, children, align = "start", className }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const handleKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      {trigger({ open, toggle: () => setOpen((v) => !v) })}
      {open && (
        <div
          className={cn(
            "absolute top-full mt-1 z-[999] min-w-[180px] rounded-lg bg-popover p-1 text-popover-foreground shadow-lg ring-1 ring-foreground/10",
            "animate-in fade-in-0 zoom-in-95 duration-100",
            align === "end" ? "right-0" : "left-0",
            className
          )}
          role="menu"
        >
          {typeof children === "function" ? children(() => setOpen(false)) : children}
        </div>
      )}
    </div>
  );
}

/* 드롭다운 메뉴 아이템 */
function CssDropdownItem({ children, onClick, className, variant }) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm font-medium outline-none transition-colors",
        "hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground",
        variant === "destructive" && "text-destructive hover:bg-destructive/10 focus:bg-destructive/10",
        className
      )}
    >
      {children}
    </button>
  );
}

/* ── 네비게이션 데이터 정의 (다국어 대응 — t 함수 주입) ── */
/* ★ 2026-08-12 IA v3 (대표 확정 — docs/design/screen-spec-v3.md §0, 시안 1h 플로우 맵):
   GNB 를 하단 탭과 동일한 5축 [홈 · 코인 · 주식 · 지표 · MY]로 재편 (자산군 이원화).
   코인·주식은 1클릭 직행, 장기꼬리 목적지는 지표·MY 드롭다운에 수납 (밀도 절제).
   기존 목적지는 하나도 삭제하지 않고 새 축으로 "매핑"만 했습니다:
     · 구 '시장' 카테고리 → 주식 축으로 승계 (스펙 §0 표 "시장 → 주식")
     · 이상 탐지·리스크 맵·시장 리포트·시장 심리 → 지표 (자산군 불문 시장 상태 도구)
     · '저장한 조건' → MY (스펙 §3 "저장한 조건은 MY 로")
     · '경제 일정' 별도 항목 → 지표 탭 캘린더 서브탭이 흡수 (스펙 §4, 이중 노출 제거;
       /econ-calendar URL 자체는 App.jsx validTabs 에 그대로 유효)
     · /coin SEO 대시보드 → 유저 진입로 미수록 (역할은 코인 탭이 단일 목적지로 대체, 스펙 §2;
       페이지 자체는 sitemap·검색 유입으로 유지, 인앱 진입은 코인 탭 컨텍스트 카드로 후속)
   탭 id 는 기존 id 를 그대로 사용합니다 — 스펙 §8 "기존 URL 유지 + 리다이렉트
   (/news → /crypto, /screener → /stocks 등)" 계약에 따라 v3 이후에도 유효해야 합니다:
     · "news"       = 코인 탭 슬롯 (구 뉴스 자리 → 코인 시그널+지표)
     · "screener"   = 주식 탭 슬롯 (주식 시그널 + 스크리너 한 화면)
     · "indicators" = 지표 탭 (캘린더|뉴스 서브탭)
   트레이딩 카테고리는 내부 운영(owner) 전용 그대로 유지(비owner 비노출). */
const getNavCategories = (t) => [
  { id: "home", label: t("nav.home"), catId: "home", icon: LayoutDashboard, directTab: "home" },
  // ★ 코인 — 직행 (v3 코인 탭: 코인 시그널 + 코인 지표. 구 뉴스 슬롯)
  //   라벨은 App.jsx 하단 탭바와 동일한 정식 내비 키(nav.coin/nav.stocks) 사용 (리뷰 반영 —
  //   EN 모드에서 GNB "Coins" vs 하단 탭 "Crypto" 로 갈라지던 표기 통일.
  //   tabs.home.segCoin/segStock 은 홈 '오늘의 시그널' 세그먼트 전용 키로 유지).
  { id: "coin", label: t("nav.coin"), catId: "coin", icon: Coins, directTab: "news" },
  // ★ 주식 — 직행 (v3 주식 탭: 주식 시그널 + 스크리너). 현행 통합 스크리너에는
  //   주식(미국+한국) 필터를 걸어 진입합니다 (screenerMarket → zepta:screener-market
  //   이벤트 → App.jsx 의 filterMarket). 코인 필터·진입점은 코인 탭으로 이동 (스펙 §3).
  { id: "stock", label: t("nav.stocks"), catId: "stock", icon: TrendingUp, directTab: "screener", screenerMarket: "stock" },
  {
    id: "indicators", label: t("nav.indicators"), catId: "indicators", icon: Activity,
    // ★ IA v3: 첫 항목 = v3 지표 탭(캘린더|뉴스). 나머지는 시장 상태 도구 승계분.
    items: [
      { id: "indicators", label: `${t("tabs.indicators.calendarTab")} · ${t("tabs.indicators.newsTab")}`, icon: CalendarDays },
      { id: "quant-report", label: t("tabs.home.marketReport"), icon: FileText },
      { id: "anomaly", label: t("nav.anomaly"), icon: Zap },
      { id: "risk-map", label: t("nav.riskMap"), icon: Shield },
      { id: "sentiment", label: t("nav.sentiment"), icon: MessageSquare },
    ],
  },
  {
    // ★ 2026-07 정보 서비스 피벗: 트레이딩 카테고리 전체 내부 운영(owner) 전용 — 비owner 완전 비노출
    id: "ai-quant", label: t("nav.tradingCat"), catId: "ai-quant", icon: Bot, ownerOnly: true,
    items: [
      { id: "auto-trading", label: "모의투자 (AI 자동매매)", icon: Bot },
      { id: "real-trading", label: "실전투자", icon: Activity, ownerOnly: true },
      { id: "alpha-lab", label: "🧬 알파 랩", icon: Sparkles },
      { id: "backtest", label: t("nav.backtest"), icon: LineChart },
      { id: "backtest-compare", label: "전략 비교", icon: GitCompare },
      { id: "leaderboard", label: "🏆 봇 랭킹", icon: Trophy },
      { id: "copy-trading", label: "카피트레이딩", icon: Share2 },
      { id: "reports", label: "봇 리포트", icon: FileText },
    ],
  },
  {
    // ★ MY: 개인화 영역 — 로그인 여부와 무관하게 카테고리 자체는 항상 표시
    id: "my", label: t("nav.my"), catId: "my", icon: User,
    items: [
      { id: "portfolio", label: t("nav.portfolio"), icon: Briefcase },
      { id: "portfolio-analysis", label: t("diag.menu.assetAnalysis"), icon: PieChart },
      { id: "saved-screeners", label: t("diag.menu.savedConditions"), icon: Save }, // ★ IA v3: 시장 → MY 이동 (스펙 §3)
      { id: "notifications", label: `🔔 ${t("nav.alerts")}`, icon: Bell },
      { id: "profile", label: t("header.myInfo"), icon: User },
      { id: "pricing", label: "👑 멤버십", icon: Crown, ownerOnly: true }, // ★ 내부 운영 전용
    ],
  },
];

/* 모바일 메뉴 시트 섹션 (리스트 문법)
   ★ 2026-08-12 IA v3: 하단 탭 5축 [홈·코인·주식·지표·MY]과 동일한 계층으로 재편.
     코인/주식 첫 항목은 하단 탭바와 같은 목적지지만, 시트가 "전체 메뉴" 역할이라
     의도적으로 중복 수록합니다 (기존 뉴스 항목과 동일한 관례).
   ★ real-trading 은 owner 전용 큰 배너로 분리 (Sheet 상단) — 여기 셀에서는 제외 */
const getMobileMenuSections = (isOwner, t) => [
  {
    // ★ 코인 축 — v3 코인 탭("news" 슬롯). /coin SEO 대시보드 항목은 리뷰 반영으로 제거:
    //   스펙 §0·§2 "구 /coin 의 역할은 코인 탭이 대체(단일 목적지)" — 겹치는 콘텐츠의
    //   이중 목적지를 두지 않습니다. SEO 페이지 자체는 sitemap·검색 유입으로 유지되며,
    //   인앱 진입이 필요해지면 스펙 §2·§4의 '코인 탭 컨텍스트 카드' 링크로 후속 이관.
    section: t("nav.coin"), items: [
      { id: "news", label: t("tabs.coin.signalsTitle"), icon: Coins },
    ],
  },
  {
    // ★ 주식 축 — 주식 시그널 + 스크리너 한 화면 (주식 필터를 걸어 진입, 스펙 §3)
    section: t("nav.stocks"), items: [
      { id: "screener", label: t("nav.screener"), icon: Search, screenerMarket: "stock" },
    ],
  },
  {
    // ★ 지표 — 첫 항목 = v3 지표 탭(캘린더|뉴스). 시장 상태 도구 승계분 수납.
    section: t("nav.indicators"), items: [
      { id: "indicators", label: `${t("tabs.indicators.calendarTab")} · ${t("tabs.indicators.newsTab")}`, icon: CalendarDays },
      { id: "quant-report", label: t("tabs.home.marketReport"), icon: FileText },
      { id: "anomaly", label: t("nav.anomaly"), icon: Zap },
      { id: "risk-map", label: t("nav.riskMap"), icon: Shield },
      { id: "sentiment", label: t("nav.sentiment"), icon: MessageSquare },
    ],
  },
  {
    // ★ 2026-07 정보 서비스 피벗: 트레이딩 섹션 전체 내부 운영 전용 (항목 전부 숨김 → 섹션 자동 제거)
    section: t("nav.tradingCat"), items: [
      { id: "auto-trading", label: "모의투자", icon: Bot, ownerOnly: true },
      { id: "real-trading", label: "실전투자", icon: Activity, ownerOnly: true },
      { id: "alpha-lab", label: "🧬 알파 랩", icon: Sparkles, ownerOnly: true },
      { id: "backtest", label: t("nav.backtest"), icon: LineChart, ownerOnly: true },
      { id: "backtest-compare", label: "전략 비교", icon: GitCompare, ownerOnly: true },
      { id: "leaderboard", label: "🏆 봇 랭킹", icon: Trophy, ownerOnly: true },
      { id: "copy-trading", label: "카피트레이딩", icon: Share2, ownerOnly: true },
      { id: "reports", label: "봇 리포트", icon: FileText, ownerOnly: true },
    ],
  },
  {
    section: t("nav.my"), items: [
      { id: "portfolio", label: t("nav.portfolio"), icon: Briefcase },
      { id: "portfolio-analysis", label: t("diag.menu.assetAnalysis"), icon: PieChart },
      { id: "saved-screeners", label: t("diag.menu.savedConditions"), icon: Save }, // ★ IA v3: 시장 → MY 이동 (스펙 §3)
      { id: "notifications", label: `🔔 ${t("nav.alerts")}`, icon: Bell },
      { id: "profile", label: t("header.myInfo"), icon: User },
      { id: "pricing", label: "👑 멤버십", icon: Crown, ownerOnly: true }, // ★ 내부 운영 전용
    ],
  },
  {
    // ★ IA v3 (리뷰 반영): 정책·지원 문서(about/privacy/terms/contact)는 시트에서 제거 —
    //   동일 목적지가 이미 MY 탭 고객지원 리스트(스펙 §5-6 배정 위치)와 푸터에 있어
    //   3중 노출이었습니다. 진입은 그 두 곳으로 일원화하고(같은 정보 이중 노출 금지),
    //   본 섹션은 정적 콘텐츠(블로그) 바로가기만 수록합니다.
    //   섹션명은 기존 키(profile.contentShortcuts) 재사용 — 신규 i18n 키 없이 ko/en 패리티.
    section: t("profile.contentShortcuts"), items: [
      { id: "/blog", label: t("footer.blog"), icon: BookOpen },
    ],
  },
]
  // ★ 2026-07 정보 서비스 피벗: ownerOnly 항목 필터 → 항목이 전부 사라진 섹션은 섹션째 숨김
  .map((sec) => ({ ...sec, items: sec.items.filter((it) => !it.ownerOnly || isOwner) }))
  .filter((sec) => sec.items.length > 0);

/* ── GNB 카테고리 매핑 (탭 id → GNB 활성 축) ── */
/* ★ 2026-08-12 IA v3: 홈/코인/주식/지표/MY (+owner 트레이딩).
   App.jsx 의 gnbCategoryMap(하단 탭바 활성 판정)과 논리 그룹을 동기 유지해야 합니다. */
const gnbCategoryMap = {
  home: "home",
  // 코인 — 구 뉴스 슬롯이 코인 탭으로 (스펙 §2)
  news: "coin",
  // 주식 — 구 '시장'(스크리너) 승계 (스펙 §0)
  screener: "stock",
  // 지표 — 캘린더|뉴스 + 시장 상태 도구 (자산군 불문)
  indicators: "indicators", "econ-calendar": "indicators", sentiment: "indicators",
  anomaly: "indicators", "risk-map": "indicators", "quant-report": "indicators",
  // 트레이딩 (내부 운영 전용) — 전략 검증 도구 포함
  "auto-trading": "ai-quant", "real-trading": "ai-quant",
  "alpha-lab": "ai-quant", backtest: "ai-quant", "backtest-compare": "ai-quant",
  "copy-trading": "ai-quant", "leaderboard": "ai-quant", "reports": "ai-quant",
  "bot-report": "ai-quant", strategy: "ai-quant",
  // MY (개인화) — ★ IA v3: saved-screeners 가 시장 → MY 로 이동
  portfolio: "my", "portfolio-analysis": "my", "saved-screeners": "my",
  "quant-port": "my", "quant-portfolio": "my",
  notifications: "my", alerts: "my", pricing: "my",
  profile: "my", mypage: "my",
  // ★ 콘텐츠·정책 정적 화면 (리뷰 반영): 어느 GNB 축에도 속하지 않는 sentinel "content" 로
  //   명시 매핑 — `|| "home"` 폴백이 홈 버튼에 잘못된 활성 스타일 + aria-current="page"
  //   (스크린리더 오정보)를 부여하는 것을 차단합니다. App.jsx 하단 탭바의 gnbCategoryMap
  //   에도 동일 매핑이 필요합니다 (동기 유지 규칙 — 파일 배정상 후속 반영 대상).
  about: "content", privacy: "content", terms: "content", contact: "content",
  marketing: "content",
};

export default memo(function Header({
  tab, setTab, user, isOwner, themeMode, toggleTheme,
  signOut, setShowAuthModal, setGlobalSearchOpen,
  alertBadge = 0, anomalyCount = 0, requireLogin,
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { lang, setLang, t } = useLanguage();
  const activeCategory = gnbCategoryMap[tab] || "home";
  // ★ 2026-07 정보 서비스 피벗: ownerOnly 카테고리/항목은 비owner 에게 비노출
  //   (항목이 전부 숨겨진 카테고리는 카테고리째 숨김)
  const NAV_CATEGORIES = getNavCategories(t)
    .filter((cat) => !cat.ownerOnly || isOwner)
    .map((cat) => (cat.items ? { ...cat, items: cat.items.filter((it) => !it.ownerOnly || isOwner) } : cat))
    .filter((cat) => cat.directTab || (cat.items && cat.items.length > 0));
  const mobileMenuSections = getMobileMenuSections(isOwner, t);

  const navigate = useCallback((tabId, screenerMarket) => {
    // 외부 path (블로그처럼 정적 HTML) — 새 페이지로 이동
    if (typeof tabId === "string" && tabId.startsWith("/")) {
      window.location.href = tabId;
      return;
    }
    // ★ 2026-08-02: '주식 분석'처럼 시장 필터를 미리 걸고 진입하는 항목 지원.
    //   App.jsx 가 이 이벤트를 받아 스크리너의 filterMarket 을 설정합니다.
    if (screenerMarket) {
      try { window.dispatchEvent(new CustomEvent("zepta:screener-market", { detail: screenerMarket })); } catch { /* 무시 */ }
    }
    setTab(tabId);
    setMobileOpen(false);
  }, [setTab]);

  /* ── 아바타 ── */
  const Avatar = ({ size = 28 }) => {
    const url = user?.user_metadata?.avatar_url;
    const initial = (user?.user_metadata?.nickname || user?.user_metadata?.display_name || user?.email || "U")[0].toUpperCase();
    return (
      <div className={cn(
        "flex items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary/70 text-white font-bold shrink-0 ring-2 ring-primary/20 transition-all",
      )} style={{ width: size, height: size, fontSize: size * 0.55 }}>
        {url
          ? <img src={url} alt="사용자 프로필" width={size} height={size} className="rounded-full object-cover" style={{ width: size, height: size }} />
          : initial
        }
      </div>
    );
  };

  const displayName = user?.user_metadata?.nickname || user?.user_metadata?.display_name || user?.email?.split("@")[0] || "User";

  return (
    <>
      {/* ━━━ 헤더 바 ━━━ */}
      <header className="fixed top-0 left-0 right-0 z-50 border-b border-border/30 bg-background">
        <div className="gnb-inner mx-auto flex h-12 max-w-[1400px] items-center justify-between gap-3 px-4 sm:h-14 lg:h-16 sm:px-6">

          {/* ── 좌측: 로고 + 모바일 메뉴 ── */}
          <div className="flex items-center gap-2">
            {/* 모바일 햄버거 */}
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon-sm" className="relative lg:hidden mobile-hamburger">
                  <Menu className="size-5" />
                  {(alertBadge > 0 || anomalyCount > 0) && (
                    <span className="absolute top-0.5 right-0.5 size-2 rounded-full bg-destructive" />
                  )}
                </Button>
              </SheetTrigger>

              {/* ── 모바일 Sheet 드로어 ── */}
              {/* ★ 2026-06-12 (대표 제보): 사이드바 맨 아래(로그아웃)까지 스크롤이 안 내려가던 문제 —
                  루트 overflow 대신 '고정 헤더 + flex-1 내부 스크롤 영역' 표준 구조로 재구성 */}
              <SheetContent side="left" showCloseButton={false} className="w-[300px] p-0 flex flex-col">
                <SheetHeader className="shrink-0 border-b border-border/30 px-4 py-3">
                  {user ? (
                    <div className="flex items-center gap-3">
                      <Avatar size={36} />
                      <div className="min-w-0">
                        <SheetTitle className="truncate text-sm">{displayName}</SheetTitle>
                        <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between">
                      <SheetTitle className="flex items-center gap-2 font-extrabold">
                        <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"
                          style={{ color: "var(--z-blue-hi)" }} fill="none" stroke="currentColor"
                          strokeWidth="8" strokeLinecap="round">
                          <path d="M12 28v8M24 19v17M36 10v26" />
                        </svg>
                        Zepta
                      </SheetTitle>
                      <Button size="sm" onClick={() => { setShowAuthModal(true); setMobileOpen(false); }}>
                        {t("header.login")}
                      </Button>
                    </div>
                  )}
                </SheetHeader>

                {/* ★ 2026-06-12 (대표 재제보): 하단 탭바(82px, z10000)가 시트(z50) 위를 덮어
                    마지막 줄(내정보·로그아웃)이 가려짐 → 스크롤 패딩을 탭바+세이프에어리어만큼 확보 */}
                <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain pb-[calc(env(safe-area-inset-bottom,0px)+96px)]">
                {/* ★ Owner 전용 실전매매 빠른 진입 배너 (모바일 햄버거 상단)
                    이전엔 햄버거 → 홈 섹션의 3분할 셀로 들어가 있어서 잘 안 보임. */}
                {user && isOwner && (
                  <div className="px-3 pt-3">
                    <button
                      onClick={() => navigate("real-trading")}
                      className={cn(
                        "w-full flex items-center gap-3 rounded-xl p-3.5 text-left transition-all",
                        tab === "real-trading"
                          ? "bg-primary/15 border border-primary/30 ring-1 ring-primary/20"
                          : "bg-gradient-to-br from-primary/10 to-primary/5 hover:from-primary/15 hover:to-primary/10 border border-primary/20"
                      )}
                      style={{ minHeight: "56px" }}
                    >
                      <div className="flex size-10 items-center justify-center rounded-lg bg-primary/20 shrink-0">
                        <Activity className="size-5 text-primary" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-[14px] font-bold text-foreground">실전매매 관제센터</div>
                        <div className="text-[12px] text-muted-foreground mt-0.5">
                          실시간 포지션·자동 청산·엔진 로그
                        </div>
                      </div>
                      <ChevronRight className="size-4 text-muted-foreground shrink-0" />
                    </button>
                  </div>
                )}

                {/* 메뉴 섹션
                    ★ 2026-08-09 모바일 디자인 시안 정합 (스타일만 — 메뉴 구성·항목·순서·동작 무변경):
                      3열 아이콘 그리드 → 시안의 리스트 문법으로 교체했습니다.
                      행 세로 패딩 14px(py-3.5) · 구분선 border-muted(= --z-card-2, C.card2 와 동일 토큰)
                      · 우측 chevron. 라벨이 두 줄로 접히거나 말줄임되던 문제도 함께 해소됩니다.
                      색은 전부 Tailwind 시맨틱 토큰이라 라이트 모드에서 그대로 동작합니다. */}
                <div className="flex flex-col gap-1 p-3">
                  {mobileMenuSections.map((group) => (
                    <div key={group.section}>
                      <p className="px-2 pt-3 pb-1.5 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">
                        {group.section}
                      </p>
                      <div className="overflow-hidden rounded-xl border border-border/40 bg-card">
                        {group.items.map((item) => {
                          const Icon = item.icon;
                          // ★ IA v3: 스크리너 항목이 하나로 합쳐져(주식 축) 과거의
                          //   screenerMarket 중복 하이라이트 특례가 불필요해졌습니다.
                          const isActive = tab === item.id;
                          return (
                            <button
                              key={item.key || item.id}
                              onClick={() => {
                                if (item.locked && requireLogin?.(item.id)) { setMobileOpen(false); return; }
                                navigate(item.id, item.screenerMarket);
                              }}
                              aria-current={isActive ? "page" : undefined}
                              className={cn(
                                "flex w-full items-center gap-3 border-b border-muted px-3.5 py-3.5 text-left text-[14px] font-semibold transition-colors last:border-b-0",
                                isActive
                                  ? "bg-primary/10 text-primary"
                                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                              )}
                            >
                              <Icon className="size-4 shrink-0" />
                              <span className="min-w-0 flex-1 truncate leading-tight">{item.label}</span>
                              <ChevronRight className={cn("size-4 shrink-0", isActive ? "opacity-60" : "opacity-30")} />
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>

                {/* 하단 도구 */}
                <div className="mt-auto border-t border-border/30 p-3 flex flex-col gap-2">
                  {!user && (
                    <Button size="default" className="w-full gap-2 font-bold"
                      onClick={() => { setShowAuthModal(true); setMobileOpen(false); }}>
                      <User className="size-4" />
                      {t("header.login")}
                    </Button>
                  )}
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" className="flex-1 gap-1.5" onClick={toggleTheme}>
                      {themeMode === "dark" ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
                      {themeMode === "dark" ? t("header.lightMode") : t("header.darkMode")}
                    </Button>
                    {user && (
                      <>
                        <Button variant="outline" size="sm" className="flex-1 gap-1.5 text-primary"
                          onClick={() => navigate("profile")}>
                          <User className="size-3.5" />{t("header.myInfo")}
                        </Button>
                        <Button variant="destructive" size="sm" className="flex-1 gap-1.5"
                          onClick={() => { if (confirm(t("header.logout") + "?")) { signOut(); setMobileOpen(false); } }}>
                          <LogOut className="size-3.5" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
                </div>{/* ★ 내부 스크롤 영역 닫기 */}
              </SheetContent>
            </Sheet>

            {/* 로고 — ★ 2026-08-12 브랜드 v2 (대표 확정 B-2 시그널 바): 심볼 + 워드마크.
                심볼은 SVG 인라인(테마색 var(--z-blue-hi) 상속 — 다크 퍼플하이/라이트 딥퍼플 자동) */}
            <div onClick={() => navigate("home")} className="flex cursor-pointer select-none items-center gap-2 lg:ml-6">
              <svg width="22" height="22" viewBox="0 0 48 48" aria-hidden="true"
                style={{ color: "var(--z-blue-hi)" }} fill="none" stroke="currentColor"
                strokeWidth="8" strokeLinecap="round">
                <path d="M12 28v8M24 19v17M36 10v26" />
              </svg>
              <span className="text-lg font-extrabold tracking-tight text-foreground sm:text-xl" style={{ letterSpacing: "-0.02em" }}>
                Zepta
              </span>
            </div>
          </div>

          {/* ── 중앙: 데스크탑 GNB (반응형 간격/패딩 최적화) ── */}
          <nav className="hidden lg:flex items-center gap-0.5 xl:gap-1 flex-1 justify-center">
            {NAV_CATEGORIES.map((cat) => {
              const isActive = activeCategory === cat.catId;

              /* 홈·코인·주식: 1클릭 직행 (★ IA v3 — 주식은 스크리너에 주식 필터를 걸어 진입) */
              if (cat.directTab) {
                return (
                  <Button
                    key={cat.id}
                    variant="ghost"
                    size="default"
                    onClick={() => navigate(cat.directTab, cat.screenerMarket)}
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      "text-[14px] xl:text-[15px] font-semibold px-3 xl:px-5",
                      isActive && cat.catId === "ai-quant"
                        ? "bg-purple-500/10 text-purple-400 hover:bg-purple-500/15 hover:text-purple-300"
                        : isActive
                          ? "bg-primary/10 text-primary hover:bg-primary/15"
                          : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {cat.label}
                  </Button>
                );
              }

              /* 지표 · 트레이딩(owner) · MY: CSS 드롭다운 */
              return (
                <CssDropdown
                  key={cat.id}
                  trigger={({ open, toggle }) => (
                    <Button
                      variant="ghost"
                      size="default"
                      onClick={toggle}
                      aria-expanded={open}
                      aria-haspopup="true"
                      className={cn(
                        "text-[14px] xl:text-[15px] font-semibold gap-1 xl:gap-1.5 px-3 xl:px-5",
                        (isActive || open)
                          ? "bg-primary/10 text-primary hover:bg-primary/15"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {cat.label}
                      <ChevronDown aria-hidden="true" className={cn("size-3.5 xl:size-4 opacity-50 transition-transform", open && "rotate-180")} />
                    </Button>
                  )}
                >
                  {(close) => cat.items.map((item) => {
                    const Icon = item.icon;
                    return (
                      <CssDropdownItem
                        key={item.key || item.id}
                        onClick={() => {
                          if (item.locked && requireLogin?.(item.id)) return;
                          navigate(item.id, item.screenerMarket);
                          close();
                        }}
                        className={cn(tab === item.id && "bg-primary/10 text-primary")}
                      >
                        <Icon className="size-4" />
                        {item.label}
                        {item.locked && !user && (
                          <span className="ml-auto text-xs opacity-40">🔒</span>
                        )}
                      </CssDropdownItem>
                    );
                  })}
                </CssDropdown>
              );
            })}
          </nav>

          {/* ── 우측: 검색 + 언어 + 사용자 ── */}
          <div className="flex items-center gap-2 sm:gap-3">
            {/* 검색 — 아이콘 (xl 미만) / 확장형 (xl 이상) */}
            <Button variant="ghost" size="icon-sm"
              onClick={() => setGlobalSearchOpen(true)}
              className="xl:hidden min-h-[44px] min-w-[44px] text-muted-foreground hover:text-foreground transition-colors"
              title="Search (⌘K)"
              aria-label="검색"
            >
              <Search className="size-5" />
            </Button>
            <Button variant="outline" size="default"
              onClick={() => setGlobalSearchOpen(true)}
              className="gap-2 text-muted-foreground hidden xl:inline-flex px-3 py-1.5 h-9"
            >
              <span className="text-sm font-medium">{t("common.search")}</span>
              <kbd className="rounded px-1.5 py-0.5 text-[10px] font-mono bg-muted text-muted-foreground">/</kbd>
            </Button>

            {/* 언어 토글 — 모던 피루 스타일 */}
            <button
              onClick={() => setLang(lang === "ko" ? "en" : "ko")}
              className="inline-flex items-center px-3 py-1.5 h-9 text-xs font-semibold rounded-full bg-muted/50 hover:bg-muted border border-border/40 transition-all duration-200 text-muted-foreground hover:text-foreground"
              title={lang === "ko" ? "Switch to English" : "한국어로 전환"}
            >
              {lang === "ko" ? "EN" : "KR"}
            </button>

            {/* 데스크탑: 사용자 드롭다운 */}
            {user ? (
              <CssDropdown
                align="end"
                className="min-w-[220px]"
                trigger={({ open, toggle }) => (
                  <Button variant="ghost" size="default" onClick={toggle}
                    aria-expanded={open} aria-haspopup="true"
                    className="hidden lg:inline-flex gap-2.5 pl-1 pr-3 h-9 hover:bg-muted/50"
                  >
                    <Avatar size={32} />
                    <span className="max-w-[110px] truncate text-sm font-medium text-foreground">{displayName}</span>
                  </Button>
                )}
              >
                {(close) => (
                  <>
                    <div className="px-3 py-2.5 border-b border-border/20">
                      <div className="font-semibold text-sm text-foreground">{displayName}</div>
                      <div className="text-xs text-muted-foreground mt-0.5 truncate">{user?.email}</div>
                    </div>
                    <CssDropdownItem onClick={() => { navigate("profile"); close(); }}>
                      <User className="size-4" /><span>{t("header.profile")}</span>
                    </CssDropdownItem>
                    {isOwner && (
                      <CssDropdownItem onClick={() => { navigate("auto-trading"); close(); }}>
                        <Bot className="size-4" /><span>{t("header.botStatus")}</span>
                      </CssDropdownItem>
                    )}
                    {isOwner && (
                      <CssDropdownItem onClick={() => { navigate("real-trading"); close(); }}>
                        <Activity className="size-4" /><span>{t("header.liveTrading")}</span>
                      </CssDropdownItem>
                    )}
                    <CssDropdownItem onClick={() => { navigate("portfolio"); close(); }}>
                      <Briefcase className="size-4" /><span>{t("nav.portfolio")}</span>
                    </CssDropdownItem>
                    <CssDropdownItem onClick={() => { navigate("/blog"); close(); }}>
                      <BookOpen className="size-4" /><span>{t("footer.blog")}</span>
                    </CssDropdownItem>
                    <div className="border-t border-border/20 my-1" />
                    <CssDropdownItem onClick={() => { toggleTheme(); close(); }}>
                      {themeMode === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
                      <span>{themeMode === "dark" ? t("header.lightMode") : t("header.darkMode")}</span>
                    </CssDropdownItem>
                    <div className="border-t border-border/20 my-1" />
                    <CssDropdownItem variant="destructive" onClick={() => {
                      if (confirm(t("header.logout") + "?")) { signOut(); close(); }
                    }}>
                      <LogOut className="size-4" /><span>{t("header.logout")}</span>
                    </CssDropdownItem>
                  </>
                )}
              </CssDropdown>
            ) : (
              <>
                <Button size="default" onClick={() => setShowAuthModal(true)} className="hidden lg:inline-flex text-sm h-9">
                  {t("header.login")}
                </Button>
                <Button variant="ghost" size="icon-sm" onClick={toggleTheme}
                  className="hidden lg:inline-flex text-muted-foreground hover:text-foreground">
                  {themeMode === "dark" ? <Sun className="size-5" /> : <Moon className="size-5" />}
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      {/* 헤더 높이 + safe-area-inset-top 스페이서 */}
      <div style={{ height: "calc(env(safe-area-inset-top, 0px) + var(--header-h))" }} />
    </>
  );
});
