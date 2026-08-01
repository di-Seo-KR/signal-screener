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
  Bot, BarChart3, Shield, Briefcase, Newspaper, MessageSquare,
  CalendarDays, Bell, Zap, Target, FileText, LineChart,
  LayoutDashboard, TrendingUp, Activity, BookOpen,
  // ★ 2026-05-11: 신규 페이지 아이콘
  Sparkles, Trophy, Share2, GitCompare, PieChart, Save, Crown,
  Coins, // ★ 2026-06-08: 코인별 분석 페이지(/coin)
  Gauge, // ★ 2026-07 정보 피벗 Phase 2: 지표 허브(/indicators)
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
/* ★ 2026-07 정보 피벗 Phase 1 (대표 지시): GNB 5메뉴 재편.
   홈 / 뉴스(단일 직행 탭) / 시장 / 지표 / MY — 정보 소비 동선 중심.
   트레이딩 카테고리는 내부 운영(owner) 전용으로 기존 그대로 유지(비owner 비노출).
   어떤 탭 id 도 삭제하지 않고 메뉴 배치만 재편했습니다 (라우팅·북마크 호환). */
const getNavCategories = (t) => [
  { id: "home", label: t("nav.home"), catId: "home", icon: LayoutDashboard, directTab: "home" },
  // ★ 뉴스: 카테고리가 아닌 단일 직행 탭
  { id: "news-direct", label: t("nav.news"), catId: "news", icon: Newspaper, directTab: "news" },
  {
    // ★ 2026-08-02 (주식+코인 양축 확장, 대표 지시): '시장' 항목을 주식 축 포함으로 재정비.
    //   스크리너(주식+코인 전체) → 주식 분석 → 코인 분석 순으로 두 축을 나란히 노출합니다.
    //   '주식 분석'은 전용 화면이 없어 스크리너에 주식(미국+한국) 필터를 걸어 진입합니다
    //   (screenerMarket → zepta:screener-market 이벤트 → App.jsx 의 filterMarket).
    //   기존 항목은 하나도 제거하지 않고 순서만 조정했습니다.
    id: "market", label: t("nav.market"), catId: "market", icon: BarChart3,
    items: [
      { id: "screener", label: t("nav.screener"), icon: Search },
      { id: "screener", key: "screener-stock", label: "주식 분석", icon: TrendingUp, screenerMarket: "stock" },
      { id: "/coin", label: "코인 분석", icon: Coins },
      { id: "anomaly", label: t("nav.anomaly"), icon: Zap },
      { id: "risk-map", label: t("nav.riskMap"), icon: Shield },
      { id: "quant-report", label: "시장 리포트", icon: FileText },
      { id: "saved-screeners", label: "저장한 조건", icon: Save },
    ],
  },
  {
    id: "indicators", label: t("nav.indicators"), catId: "indicators", icon: Activity,
    // ★ 2026-07 정보 피벗 Phase 2: 지표 허브를 첫 항목으로 추가 (기존 2종 유지)
    items: [
      { id: "indicators", label: "지표 허브", icon: Gauge },
      { id: "econ-calendar", label: t("nav.econ"), icon: CalendarDays },
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
      { id: "portfolio-analysis", label: "자산 분석", icon: PieChart },
      { id: "notifications", label: "🔔 알림", icon: Bell },
      { id: "profile", label: "내 정보", icon: User },
      { id: "pricing", label: "👑 멤버십", icon: Crown, ownerOnly: true }, // ★ 내부 운영 전용
    ],
  },
];

/* 모바일 메뉴 섹션 (3열 그리드용)
   ★ real-trading 은 owner 전용 큰 배너로 분리 (Sheet 상단) — 여기 셀에서는 제외 */
const getMobileMenuSections = (isOwner, t) => [
  {
    // ★ 2026-07 정보 피벗 Phase 1: 시장(시장을 본다) — 뉴스는 직행 탭이지만
    //   시트 안에서도 찾을 수 있도록 첫 항목으로 포함 (하단 탭바에도 별도 존재)
    section: t("nav.market"), items: [
      { id: "news", label: t("nav.news"), icon: Newspaper },
      { id: "screener", label: t("nav.screener"), icon: Search },
      // ★ 2026-08-02 주식+코인 양축 — 데스크톱 GNB 와 동일 구성
      { id: "screener", key: "screener-stock", label: "주식 분석", icon: TrendingUp, screenerMarket: "stock" },
      { id: "/coin", label: "코인 분석", icon: Coins },
      { id: "anomaly", label: t("nav.anomaly"), icon: Zap },
      { id: "risk-map", label: t("nav.riskMap"), icon: Shield },
      { id: "quant-report", label: "시장 리포트", icon: FileText },
      { id: "saved-screeners", label: "저장한 조건", icon: Save },
    ],
  },
  {
    section: t("nav.indicators"), items: [
      { id: "indicators", label: "지표 허브", icon: Gauge }, // ★ Phase 2
      { id: "econ-calendar", label: t("nav.econ"), icon: CalendarDays },
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
      { id: "portfolio-analysis", label: "자산 분석", icon: PieChart },
      { id: "notifications", label: "🔔 알림", icon: Bell },
      { id: "profile", label: "내 정보", icon: User },
      { id: "/blog", label: "블로그", icon: BookOpen },
      { id: "pricing", label: "👑 멤버십", icon: Crown, ownerOnly: true }, // ★ 내부 운영 전용
    ],
  },
]
  // ★ 2026-07 정보 서비스 피벗: ownerOnly 항목 필터 → 항목이 전부 사라진 섹션은 섹션째 숨김
  .map((sec) => ({ ...sec, items: sec.items.filter((it) => !it.ownerOnly || isOwner) }))
  .filter((sec) => sec.items.length > 0);

/* ── GNB 카테고리 매핑 ── */
/* ★ 2026-07 정보 피벗 Phase 1: 홈/뉴스/시장/지표/MY (+owner 트레이딩) 재편.
   App.jsx 의 gnbCategoryMap 과 반드시 동기 유지해야 합니다. */
const gnbCategoryMap = {
  home: "home",
  // 뉴스 — 단일 직행 탭
  news: "news",
  // 시장 (시장을 본다)
  screener: "market", anomaly: "market", "saved-screeners": "market",
  "risk-map": "market", "quant-report": "market",
  // 지표 (거시·심리)
  indicators: "indicators", // ★ Phase 2 — 지표 허브
  "econ-calendar": "indicators", sentiment: "indicators",
  // 트레이딩 (내부 운영 전용) — 전략 검증 도구 포함
  "auto-trading": "ai-quant", "real-trading": "ai-quant",
  "alpha-lab": "ai-quant", backtest: "ai-quant", "backtest-compare": "ai-quant",
  "copy-trading": "ai-quant", "leaderboard": "ai-quant", "reports": "ai-quant",
  "bot-report": "ai-quant", strategy: "ai-quant",
  // MY (개인화)
  portfolio: "my", "portfolio-analysis": "my",
  "quant-port": "my", "quant-portfolio": "my",
  notifications: "my", alerts: "my", pricing: "my",
  profile: "my", mypage: "my",
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

  // ★ 2026-06-08: 모바일 하단 탭바의 '메뉴' 버튼이 이 시트를 열도록 — 커스텀 이벤트 수신
  useEffect(() => {
    const open = () => setMobileOpen(true);
    window.addEventListener("zepta:open-mobile-menu", open);
    return () => window.removeEventListener("zepta:open-mobile-menu", open);
  }, []);

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
                      <SheetTitle className="font-extrabold"><span style={{ color: "var(--z-blue)" }}>Z</span>epta</SheetTitle>
                      <Button size="sm" onClick={() => { setShowAuthModal(true); setMobileOpen(false); }}>
                        로그인
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

                {/* 메뉴 섹션 */}
                <div className="flex flex-col gap-1 p-3">
                  {mobileMenuSections.map((group) => (
                    <div key={group.section}>
                      <p className="px-2 pt-3 pb-1.5 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">
                        {group.section}
                      </p>
                      <div className="grid grid-cols-3 gap-1.5">
                        {group.items.map((item) => {
                          const Icon = item.icon;
                          // 같은 탭을 다른 필터로 여는 항목(주식 분석)은 활성 표시에서 제외 — 중복 하이라이트 방지
                          const isActive = tab === item.id && !item.screenerMarket;
                          return (
                            <button
                              key={item.key || item.id}
                              onClick={() => {
                                if (item.locked && requireLogin?.(item.id)) { setMobileOpen(false); return; }
                                navigate(item.id, item.screenerMarket);
                              }}
                              className={cn(
                                "flex flex-col items-center gap-1 rounded-xl p-2.5 text-xs font-semibold transition-colors",
                                isActive
                                  ? "bg-primary/10 text-primary border border-primary/20"
                                  : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground border border-transparent"
                              )}
                            >
                              <Icon className="size-4" />
                              <span className="leading-tight">{item.label}</span>
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

            {/* 로고 — ★ 2026-06-12 (대표 피드백): 블로그/정적페이지 텍스트 로고(Z 일렉트릭 블루
                강조)로 통일. 아이콘 이미지 제거, 트렌디·깔끔 */}
            <div onClick={() => navigate("home")} className="flex cursor-pointer select-none items-center lg:ml-6">
              <span className="text-lg font-extrabold tracking-tight text-foreground sm:text-xl" style={{ letterSpacing: "-0.02em" }}>
                <span style={{ color: "var(--z-blue)" }}>Z</span>epta
              </span>
            </div>
          </div>

          {/* ── 중앙: 데스크탑 GNB (반응형 간격/패딩 최적화) ── */}
          <nav className="hidden lg:flex items-center gap-0.5 xl:gap-1 flex-1 justify-center">
            {NAV_CATEGORIES.map((cat) => {
              const isActive = activeCategory === cat.catId;

              /* 홈, AI 퀀트: 직접 이동 */
              if (cat.directTab) {
                return (
                  <Button
                    key={cat.id}
                    variant="ghost"
                    size="default"
                    onClick={() => navigate(cat.directTab)}
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

              /* 분석, 운용, 정보: CSS 드롭다운 */
              return (
                <CssDropdown
                  key={cat.id}
                  trigger={({ open, toggle }) => (
                    <Button
                      variant="ghost"
                      size="default"
                      onClick={toggle}
                      className={cn(
                        "text-[14px] xl:text-[15px] font-semibold gap-1 xl:gap-1.5 px-3 xl:px-5",
                        (isActive || open)
                          ? "bg-primary/10 text-primary hover:bg-primary/15"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {cat.label}
                      <ChevronDown className={cn("size-3.5 xl:size-4 opacity-50 transition-transform", open && "rotate-180")} />
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
                        className={cn(tab === item.id && !item.screenerMarket && "bg-primary/10 text-primary")}
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
                      <BookOpen className="size-4" /><span>블로그</span>
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
