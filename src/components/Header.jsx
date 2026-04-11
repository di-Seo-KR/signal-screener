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
import { Button } from "@/components/ui/button";
import {
  Sheet, SheetTrigger, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import {
  Menu, X, Search, ChevronDown, Sun, Moon, LogOut, User,
  Bot, BarChart3, Shield, Briefcase, Newspaper, MessageSquare,
  CalendarDays, Bell, Zap, Target, FileText, LineChart,
  LayoutDashboard, TrendingUp, Activity,
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

/* ── 네비게이션 데이터 정의 ── */
const NAV_CATEGORIES = [
  { id: "home", label: "홈", catId: "home", icon: LayoutDashboard, directTab: "home" },
  { id: "ai-quant", label: "AI 퀀트", catId: "ai-quant", icon: Bot, directTab: "auto-trading" },
  {
    id: "analysis", label: "분석", catId: "analysis", icon: BarChart3,
    items: [
      { id: "screener", label: "종목 탐색", icon: Search },
      { id: "anomaly", label: "이상 탐지", icon: Zap },
      { id: "strategy", label: "퀀트 전략", icon: Target },
      { id: "quant-report", label: "퀀트 리포트", icon: FileText },
      { id: "backtest", label: "백테스트", icon: LineChart },
    ],
  },
  {
    id: "management", label: "운용", catId: "management", icon: Briefcase,
    items: [
      { id: "quant-port", label: "전략 운용", icon: TrendingUp },
      { id: "risk-map", label: "리스크맵", icon: Shield },
      { id: "portfolio", label: "포트폴리오", icon: Briefcase },
    ],
  },
  {
    id: "info", label: "정보", catId: "info", icon: Newspaper,
    items: [
      { id: "news", label: "마켓 뉴스", icon: Newspaper },
      { id: "sentiment", label: "센티먼트", icon: MessageSquare },
      { id: "econ-calendar", label: "경제 캘린더", icon: CalendarDays },
      { id: "alerts", label: "알림 설정", icon: Bell, locked: true },
    ],
  },
];

/* 모바일 메뉴 섹션 (3열 그리드용) */
const getMobileMenuSections = (isOwner) => [
  {
    section: "메인", items: [
      { id: "home", label: "홈", icon: LayoutDashboard },
      { id: "auto-trading", label: "AI 퀀트", icon: Bot },
      ...(isOwner ? [{ id: "real-trading", label: "실전매매", icon: Activity }] : []),
    ],
  },
  {
    section: "분석", items: [
      { id: "screener", label: "종목 탐색", icon: Search },
      { id: "anomaly", label: "이상 탐지", icon: Zap },
      { id: "strategy", label: "퀀트 전략", icon: Target },
      { id: "quant-report", label: "리포트", icon: FileText },
      { id: "backtest", label: "백테스트", icon: LineChart },
    ],
  },
  {
    section: "운용", items: [
      { id: "quant-port", label: "전략 운용", icon: TrendingUp },
      { id: "risk-map", label: "리스크맵", icon: Shield },
      { id: "portfolio", label: "포트폴리오", icon: Briefcase },
    ],
  },
  {
    section: "정보", items: [
      { id: "news", label: "뉴스", icon: Newspaper },
      { id: "sentiment", label: "센티먼트", icon: MessageSquare },
      { id: "econ-calendar", label: "경제캘린더", icon: CalendarDays },
      { id: "alerts", label: "알림", icon: Bell, locked: true },
    ],
  },
];

/* ── GNB 카테고리 매핑 ── */
const gnbCategoryMap = {
  home: "home", screener: "analysis", anomaly: "analysis", strategy: "analysis",
  "quant-report": "analysis", backtest: "analysis",
  "quant-port": "management", "risk-map": "management", portfolio: "management",
  "auto-trading": "ai-quant", "real-trading": "ai-quant",
  news: "info", sentiment: "info", alerts: "info", "econ-calendar": "info",
};

export default memo(function Header({
  tab, setTab, user, isOwner, themeMode, toggleTheme,
  signOut, setShowAuthModal, setGlobalSearchOpen,
  alertBadge = 0, anomalyCount = 0, requireLogin,
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const activeCategory = gnbCategoryMap[tab] || "home";

  const navigate = useCallback((tabId) => {
    setTab(tabId);
    setMobileOpen(false);
  }, [setTab]);

  /* ── 아바타 ── */
  const Avatar = ({ size = 28 }) => {
    const url = user?.user_metadata?.avatar_url;
    const initial = (user?.user_metadata?.display_name || user?.email || "U")[0].toUpperCase();
    return (
      <div className={cn(
        "flex items-center justify-center rounded-full bg-primary/10 text-primary font-bold shrink-0",
      )} style={{ width: size, height: size, fontSize: size * 0.55 }}>
        {url
          ? <img src={url} alt="" className="rounded-full object-cover" style={{ width: size, height: size }} />
          : initial
        }
      </div>
    );
  };

  const displayName = user?.user_metadata?.display_name || user?.email?.split("@")[0] || "User";

  return (
    <>
      {/* ━━━ 헤더 바 ━━━ */}
      <header className="fixed top-0 left-0 right-0 z-50 border-b border-border/30 bg-background">
        <div className="mx-auto flex h-12 max-w-[1400px] items-center justify-between gap-3 px-4 sm:h-14 sm:px-6">

          {/* ── 좌측: 로고 + 모바일 메뉴 ── */}
          <div className="flex items-center gap-2">
            {/* 모바일 햄버거 */}
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon-sm" className="relative lg:hidden">
                  <Menu className="size-5" />
                  {(alertBadge > 0 || anomalyCount > 0) && (
                    <span className="absolute top-0.5 right-0.5 size-2 rounded-full bg-destructive" />
                  )}
                </Button>
              </SheetTrigger>

              {/* ── 모바일 Sheet 드로어 ── */}
              <SheetContent side="left" showCloseButton={false} className="w-[300px] p-0 overflow-y-auto">
                <SheetHeader className="border-b border-border/30 px-4 py-3">
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
                      <SheetTitle className="text-primary font-extrabold">Zepta</SheetTitle>
                      <Button size="sm" onClick={() => { setShowAuthModal(true); setMobileOpen(false); }}>
                        로그인
                      </Button>
                    </div>
                  )}
                </SheetHeader>

                {/* 메뉴 섹션 */}
                <div className="flex flex-col gap-1 p-3">
                  {getMobileMenuSections(isOwner).map((group) => (
                    <div key={group.section}>
                      <p className="px-2 pt-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        {group.section}
                      </p>
                      <div className="grid grid-cols-3 gap-1.5">
                        {group.items.map((item) => {
                          const Icon = item.icon;
                          const isActive = tab === item.id;
                          return (
                            <button
                              key={item.id}
                              onClick={() => {
                                if (item.locked && requireLogin?.(item.id)) { setMobileOpen(false); return; }
                                navigate(item.id);
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
                <div className="mt-auto border-t border-border/30 p-3">
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" className="flex-1 gap-1.5" onClick={toggleTheme}>
                      {themeMode === "dark" ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
                      {themeMode === "dark" ? "라이트" : "다크"}
                    </Button>
                    {user && (
                      <>
                        <Button variant="outline" size="sm" className="flex-1 gap-1.5 text-primary"
                          onClick={() => navigate("profile")}>
                          <User className="size-3.5" />내 정보
                        </Button>
                        <Button variant="destructive" size="sm" className="flex-1 gap-1.5"
                          onClick={() => { if (confirm("로그아웃 하시겠습니까?")) { signOut(); setMobileOpen(false); } }}>
                          <LogOut className="size-3.5" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </SheetContent>
            </Sheet>

            {/* 로고 */}
            <div onClick={() => navigate("home")} className="flex cursor-pointer select-none items-center gap-2">
              <img src="/zepta-icon-192.png" alt="Zepta" className="size-7 sm:size-8 shrink-0" />
              <span className="text-base font-extrabold tracking-tight text-foreground sm:text-lg">Zepta</span>
            </div>
          </div>

          {/* ── 중앙: 데스크탑 GNB ── */}
          <nav className="hidden lg:flex items-center gap-1 flex-1 ml-6">
            {NAV_CATEGORIES.map((cat) => {
              const isActive = activeCategory === cat.catId;

              /* 홈, AI 퀀트: 직접 이동 */
              if (cat.directTab) {
                return (
                  <Button
                    key={cat.id}
                    variant="ghost"
                    size="sm"
                    onClick={() => navigate(cat.directTab)}
                    className={cn(
                      "text-sm font-semibold px-4",
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
                      size="sm"
                      onClick={toggle}
                      className={cn(
                        "text-sm font-semibold gap-1 px-4",
                        (isActive || open)
                          ? "bg-primary/10 text-primary hover:bg-primary/15"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {cat.label}
                      <ChevronDown className={cn("size-3.5 opacity-50 transition-transform", open && "rotate-180")} />
                    </Button>
                  )}
                >
                  {(close) => cat.items.map((item) => {
                    const Icon = item.icon;
                    return (
                      <CssDropdownItem
                        key={item.id}
                        onClick={() => {
                          if (item.locked && requireLogin?.(item.id)) return;
                          navigate(item.id);
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

          {/* ── 우측: 검색 + 사용자 ── */}
          <div className="flex items-center gap-1.5">
            {/* 검색 */}
            <Button variant="outline" size="sm"
              onClick={() => setGlobalSearchOpen(true)}
              className="gap-1.5 text-muted-foreground hidden sm:inline-flex"
            >
              <Search className="size-3.5" />
              <span className="text-xs">검색</span>
              <kbd className="ml-1 rounded bg-muted px-1 py-0.5 text-[10px] font-mono">/</kbd>
            </Button>
            <Button variant="ghost" size="icon-sm"
              onClick={() => setGlobalSearchOpen(true)}
              className="sm:hidden text-muted-foreground"
            >
              <Search className="size-4" />
            </Button>

            {/* 데스크탑: 사용자 드롭다운 */}
            {user ? (
              <CssDropdown
                align="end"
                className="min-w-[200px]"
                trigger={({ open, toggle }) => (
                  <Button variant="ghost" size="sm" onClick={toggle}
                    className="hidden lg:inline-flex gap-2 pl-1 pr-2">
                    <Avatar size={26} />
                    <span className="max-w-[80px] truncate text-xs text-muted-foreground">{displayName}</span>
                    <ChevronDown className={cn("size-3 opacity-50 transition-transform", open && "rotate-180")} />
                  </Button>
                )}
              >
                {(close) => (
                  <>
                    <div className="px-2 py-1.5">
                      <div className="font-semibold text-sm text-foreground">{displayName}</div>
                      <div className="text-xs text-muted-foreground">{user?.email}</div>
                    </div>
                    <Separator className="my-1" />
                    <CssDropdownItem onClick={() => { navigate("profile"); close(); }}>
                      <User className="size-4" />회원정보
                    </CssDropdownItem>
                    <CssDropdownItem onClick={() => { navigate("auto-trading"); close(); }}>
                      <Bot className="size-4" />봇 운영현황
                    </CssDropdownItem>
                    {isOwner && (
                      <CssDropdownItem onClick={() => { navigate("real-trading"); close(); }}>
                        <Activity className="size-4" />실전매매
                      </CssDropdownItem>
                    )}
                    <CssDropdownItem onClick={() => { navigate("portfolio"); close(); }}>
                      <Briefcase className="size-4" />포트폴리오
                    </CssDropdownItem>
                    <Separator className="my-1" />
                    <CssDropdownItem onClick={() => { toggleTheme(); close(); }}>
                      {themeMode === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
                      {themeMode === "dark" ? "라이트 모드" : "다크 모드"}
                    </CssDropdownItem>
                    <Separator className="my-1" />
                    <CssDropdownItem variant="destructive" onClick={() => {
                      if (confirm("로그아웃 하시겠습니까?")) { signOut(); close(); }
                    }}>
                      <LogOut className="size-4" />로그아웃
                    </CssDropdownItem>
                  </>
                )}
              </CssDropdown>
            ) : (
              <>
                <Button size="sm" onClick={() => setShowAuthModal(true)} className="hidden lg:inline-flex">
                  로그인
                </Button>
                <Button variant="ghost" size="icon-sm" onClick={toggleTheme}
                  className="hidden lg:inline-flex text-muted-foreground">
                  {themeMode === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      {/* 헤더 높이만큼 스페이서 */}
      <div className="h-12 sm:h-14" />
    </>
  );
});
