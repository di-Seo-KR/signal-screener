// Zepta v11.3 — 투자 스크리너 + 퀀트 엔진 + 전략 운용 + 리스크 관리 + 스크리너 프리셋
// Features: 스크리닝, 캔들차트, 33개 전략(BTC 알파 포함), 백테스트, 전략별 포트폴리오, 리스크 히트맵, 뉴스, 실전 전략 매매 알림
// v11.3: 퀀트 엔진 v4.1 고변동장 전략 최적화 + 투자진단 v2.2 하락추세 감지 강화
// v11.2: 퀀트 엔진 v3.9 하위전략 2차 안전필터 + 모바일 터치 UX 개선
// v11.1: 다중 타임프레임 RSI 스크리닝 조건 + 퀀트 엔진 v3.8 하위전략 안전필터
// v11.0: 토스증권 벤치마킹 기반 대개편 — 스크리너 프리셋, 글로벌 검색, 위험종목 필터, 실시간 티커
import { useState, useEffect, useCallback, useRef, useMemo, Component, lazy, Suspense } from "react";
import AuthProvider, { useAuth } from "./AuthProvider.jsx";
import { LanguageProvider, useLanguage } from "./i18n/LanguageContext.jsx";
import AuthPage from "./AuthPage.jsx";
import { CoupangOfficialBanner, CoupangSearchWidget, CoupangInterstitial, GoogleAd, GoogleAdInterstitial } from "./AdBanner.jsx";
import Header from "./components/Header.jsx";
import PortfolioTab from "./components/PortfolioTab.jsx";
import { supabase } from "./supabaseClient.js";
import { THEME_TOKENS } from "./ui/theme.jsx";
import { useIsMobile } from "./ui/useBreakpoint.jsx";
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
      setError("닉네임을 입력해주세요");
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
      setError(err?.message || "저장 실패");
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
      <div className="px-5 py-3.5 text-sm font-bold text-muted-foreground uppercase tracking-wider">닉네임</div>
      {!editing ? (
        <div className="flex justify-between items-center px-5 py-3.5 border-t" style={{ borderTopColor: `${C.border}20` }}>
          <span className="text-base font-semibold text-foreground">{user?.user_metadata?.nickname || "미설정"}</span>
          <button
            onClick={() => setEditing(true)}
            style={{
              padding: "6px 14px", borderRadius: "8px", fontSize: "14px", fontWeight: 600,
              background: C.blue, color: "#fff", border: "none", cursor: "pointer",
            }}
          >
            편집
          </button>
        </div>
      ) : (
        <div className="px-5 py-4 border-t" style={{ borderTopColor: `${C.border}20` }}>
          <div className="flex gap-2 mb-3">
            <input
              type="text"
              value={nickname}
              onChange={(e) => { setNickname(e.target.value); setError(null); }}
              placeholder="닉네임 입력"
              style={{
                flex: 1, padding: "8px 12px", borderRadius: "8px",
                border: `1px solid ${C.border}40`, background: "transparent",
                color: C.text1, fontSize: "14px",
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
              🎲 생성
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
              {loading ? "저장중..." : "저장"}
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
              취소
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
  componentDidCatch(error, info) { console.error("[Zepta ErrorBoundary]", error, info.componentStack); }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center",
          justifyContent: "center", background: "#0A0E17", color: "#F7F8FA", padding: "24px", textAlign: "center",
        }}>
          <div style={{ fontSize: "48px", marginBottom: "16px" }}>⚠️</div>
          <h2 style={{ fontWeight: 800, fontSize: "20px", marginBottom: "8px" }}>앱 오류가 발생했습니다</h2>
          <p style={{ color: "#6B7D8E", fontSize: "16px", marginBottom: "20px", maxWidth: "360px" }}>
            일시적인 오류입니다. 새로고침하면 정상 작동합니다.
          </p>
          <button onClick={() => window.location.reload()} style={{
            padding: "12px 28px", borderRadius: "12px", fontSize: "16px", fontWeight: 700,
            background: "#3182F6", color: "#fff", border: "none", cursor: "pointer",
          }}>새로고침</button>
          <details style={{ marginTop: "16px", fontSize: "14px", color: "#6B7D8E", maxWidth: "360px" }}>
            <summary style={{ cursor: "pointer" }}>오류 상세</summary>
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
import { ALL_STRATEGIES } from "./strategies.js";

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
  // ── 시총 상위 10개만 ──
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
// 크립토 한글명
const CRYPTO_KO_NAMES = {
  "bitcoin": "비트코인", "ethereum": "이더리움", "solana": "솔라나",
  "binancecoin": "바이낸스코인", "ripple": "리플", "cardano": "카르다노",
  "dogecoin": "도지코인", "tron": "트론", "avalanche-2": "아발란체",
  "toncoin": "톤코인",
};

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
            {refreshing ? "새로고침 중..." : pullDistance >= THRESHOLD ? "놓으면 새로고침" : "아래로 당기기"}
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
  const meta = CONDITION_META[triggerKey];
  let color = TAG_COLORS[triggerKey] || C.blue;
  if (!meta) return null;
  // 다이버전스에 bullish/bearish 타입 표시 + 색상 분기
  let label = meta.label;
  let icon = meta.icon;
  if (triggerKey === "macd_divergence" && asset?.macdDivType) {
    label = asset.macdDivType === "bullish" ? "MACD 상승 다이버전스" : "MACD 하락 다이버전스";
    color = asset.macdDivType === "bullish" ? C.green : C.red;
    icon = asset.macdDivType === "bullish" ? "📈" : "📉";
  }
  if (triggerKey === "rsi_divergence" && asset?.rsiDivType) {
    label = asset.rsiDivType === "bullish" ? "RSI 상승 다이버전스" : "RSI 하락 다이버전스";
    color = asset.rsiDivType === "bullish" ? C.green : C.red;
    icon = asset.rsiDivType === "bullish" ? "📈" : "📉";
  }
  if (triggerKey === "obv_divergence" && asset?.obvDivType) {
    label = asset.obvDivType === "bullish" ? "OBV 매집 다이버전스" : "OBV 분산 다이버전스";
    color = asset.obvDivType === "bullish" ? C.green : C.red;
    icon = asset.obvDivType === "bullish" ? "📊" : "📊";
  }
  if (triggerKey === "near_poc" && asset?.pocPrice) {
    label = `POC 근접 ($${asset.pocPrice})`;
  }
  return (
    <span title={meta.desc} style={{
      padding: "2px 7px", borderRadius: "6px", fontSize: "15px", fontWeight: 700,
      background: `${color}22`, color, border: `1px solid ${color}44`, whiteSpace: "nowrap",
      cursor: "help",
    }}>{icon} {label}</span>
  );
}

// ════════════════════════════════════════════════════════════════════
// 서브 컴포넌트: SearchBar (글로벌 종목 검색 + 자동완성)
// ════════════════════════════════════════════════════════════════════
function SearchBar({ onSelect, placeholder = "종목 검색 (예: AAPL, 삼성전자, BTC...)", compact = false }) {
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const inputRef = useRef(null);
  const dropRef = useRef(null);

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
          style={{
            width: compact ? "120px" : "100%",
            padding: compact ? "6px 10px" : "13px 16px 13px 42px",
            borderRadius: compact ? "8px" : "14px",
            fontSize: compact ? "12px" : "14px",
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
      {showDrop && (
        <div ref={dropRef} style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 200,
          background: C.card, border: `1px solid ${C.border}`, borderRadius: "12px",
          boxShadow: "0 8px 32px rgba(0,0,0,.5)", overflow: "hidden", maxHeight: "380px", overflowY: "auto",
        }}>
          {suggestions.map((asset, i) => {
            const flag = asset.market === "us" ? "🇺🇸" : asset.market === "kr" ? "🇰🇷" : "₿";
            const isActive = i === selectedIdx;
            return (
              <div key={`${asset.symbol}-${asset.market}-${i}`}
                onClick={() => { onSelect(asset); setQuery(""); setFocused(false); setSelectedIdx(-1); }}
                onMouseEnter={() => setSelectedIdx(i)}
                style={{
                  display: "flex", alignItems: "center", gap: "12px",
                  padding: "14px 16px", minHeight: "56px", cursor: "pointer",
                  background: isActive ? C.blueBg : "transparent",
                  borderBottom: i < suggestions.length - 1 ? `1px solid ${C.border}` : "none",
                  transition: "background .15s",
                }}>
                <div style={{
                  width: "36px", height: "36px", borderRadius: "10px", flexShrink: 0,
                  background: asset.market === "us" ? "#1A2C4F" : asset.market === "kr" ? "#1A2A1E" : "#1E1A2A",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontWeight: 800, fontSize: "14px",
                  color: asset.market === "us" ? C.blue : asset.market === "kr" ? C.green : C.purple,
                }}>
                  {asset.symbol.length <= 5 ? asset.symbol : asset.symbol.slice(0, 5)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: "18px", color: C.text1 }}>{asset.name}</div>
                  <div style={{ fontSize: "16px", color: C.text3 }}>
                    {flag} {asset.symbol}{asset.market === "kr" ? ".KS" : ""}
                    {asset.koName ? ` · ${asset.koName}` : ""}
                  </div>
                </div>
                <div style={{
                  padding: "3px 8px", borderRadius: "6px", fontSize: "15px", fontWeight: 600,
                  background: asset.market === "us" ? `${C.blue}18` : asset.market === "kr" ? `${C.green}18` : `${C.purple}18`,
                  color: asset.market === "us" ? C.blue : asset.market === "kr" ? C.green : C.purple,
                }}>
                  {asset.market === "us" ? "US" : asset.market === "kr" ? "KR" : "Crypto"}
                </div>
              </div>
            );
          })}
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

// ════════════════════════════════════════════════════════════════════
// 매수 진입 가격 레벨 계산 (3단계 진입 전략)
// ════════════════════════════════════════════════════════════════════
function calcBuyLevels(asset) {
  // 필요한 데이터 추출
  const currentPrice = asset.price || 0;
  const ma50 = asset.ma50 || null;
  const ma200 = asset.ma200 || null;
  const weeklyHigh = asset.high52w || asset.weeklyHigh52 || null;
  const weeklyLow = asset.low52w || asset.weeklyLow52 || null;

  if (!currentPrice || currentPrice <= 0) {
    return {
      levels: [],
      summary: "현재가 정보 부재로 매수 타점 계산 불가"
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
    rationaleL1 = "50일 이동평균선(MA50) 반등 진입";
    confidenceL1 = 75;
  } else if (weeklyLow && weeklyLow > 0) {
    // 52주 저점 기반: 현재가 대비 3% 하락
    priceL1 = Math.max(weeklyLow, currentPrice * 0.97);
    rationaleL1 = "52주 저점 근처 강한 지지";
    confidenceL1 = 70;
  } else {
    // 최근 저점 기반: 3% 풀백
    priceL1 = currentPrice * 0.97;
    rationaleL1 = "최근 저점 반등 기회";
    confidenceL1 = 55;
  }

  if (priceL1 && priceL1 < currentPrice) {
    const distanceFromCurrent = ((currentPrice - priceL1) / currentPrice) * 100;
    const distanceConfidence = Math.max(0, 100 - distanceFromCurrent * 5);
    confidenceL1 = Math.min(100, Math.round((confidenceL1 + distanceConfidence) / 2));

    levels.push({
      price: Math.round(priceL1 * 100) / 100,
      label: "1차 매수",
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
    rationaleL2 = "200일 이동평균선(MA200) 지지";
    confidenceL2 = 80;
  } else if (weeklyHigh && weeklyLow && weeklyHigh > weeklyLow) {
    // Fibonacci 38.2% 되돌림
    const fibLevel = weeklyLow + (weeklyHigh - weeklyLow) * 0.382;
    if (fibLevel < currentPrice) {
      priceL2 = fibLevel;
      rationaleL2 = "피보나치 38.2% 되돌림 레벨";
      confidenceL2 = 65;
    } else {
      priceL2 = currentPrice * 0.92;
      rationaleL2 = "중기 조정 목표 8% 풀백";
      confidenceL2 = 50;
    }
  } else {
    // 폴백: 8% 풀백
    priceL2 = currentPrice * 0.92;
    rationaleL2 = "중기 조정 목표 8% 풀백";
    confidenceL2 = 50;
  }

  if (priceL2 && priceL2 < currentPrice) {
    const distanceFromCurrent = ((currentPrice - priceL2) / currentPrice) * 100;
    const distanceConfidence = Math.max(0, 100 - distanceFromCurrent * 3);
    confidenceL2 = Math.min(100, Math.round((confidenceL2 + distanceConfidence) / 2));

    levels.push({
      price: Math.round(priceL2 * 100) / 100,
      label: "2차 매수",
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
      rationaleL3 = "피보나치 61.8% 되돌림 (강력한 지지)";
      confidenceL3 = 85;
    } else {
      // 52주 저점 위 5%
      priceL3 = weeklyLow * 1.05;
      rationaleL3 = "52주 저점 위 5% 안전 마진";
      confidenceL3 = 75;
    }
  } else if (weeklyLow && weeklyLow > 0) {
    priceL3 = weeklyLow * 1.05;
    rationaleL3 = "52주 저점 위 5% 안전 마진";
    confidenceL3 = 75;
  } else {
    // 폴백: 15% 풀백
    priceL3 = currentPrice * 0.85;
    rationaleL3 = "극단적 조정 목표 15% 풀백";
    confidenceL3 = 45;
  }

  if (priceL3 && priceL3 < currentPrice) {
    const distanceFromCurrent = ((currentPrice - priceL3) / currentPrice) * 100;
    const distanceConfidence = Math.max(0, 100 - distanceFromCurrent * 2);
    confidenceL3 = Math.min(100, Math.round((confidenceL3 + distanceConfidence) / 2));

    levels.push({
      price: Math.round(priceL3 * 100) / 100,
      label: "3차 매수",
      type: "bottom",
      confidence: confidenceL3,
      rationale: rationaleL3,
      discount: Math.round(((currentPrice - priceL3) / currentPrice) * 1000) / 10
    });
  }

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
    summary = `현재가 대비 -${minDiscount.toFixed(1)}%~-${maxDiscount.toFixed(1)}% 구간에 매수 타점 형성`;
  } else if (levels.length > 0) {
    const discounts = levels.map(l => l.discount);
    const minDiscount = Math.min(...discounts);
    const maxDiscount = Math.max(...discounts);
    summary = `현재가 대비 -${minDiscount.toFixed(1)}%~-${maxDiscount.toFixed(1)}% 구간 진입 추천`;
  } else {
    summary = "충분한 데이터 부재로 매수 타점 계산 불가";
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
  const [expanded, setExpanded] = useState(false);
  const isPos = asset.weekChange >= 0;
  const mcBg = asset.market === "us" ? "#1A2C4F" : asset.market === "kr" ? "#1A2A1E" : "#1E1A2A";
  const mcColor = asset.market === "us" ? C.blue : asset.market === "kr" ? C.green : C.purple;
  const borderColor = asset.triggers && asset.triggers.length > 0
    ? (asset.triggers.some(t => t.includes("buy") || t.includes("bullish")) ? C.green : C.red)
    : C.border;

  // 퀵 진단 (항상 계산 — 카드 미리보기 + 정렬용)
  const diag = useMemo(() => quickDiagnosis(asset), [asset]);

  return (
    <div className="asset-card" style={{
      background: C.card,
      border: `1px solid ${C.border}`,
      borderLeft: `4px solid ${borderColor}`,
      borderRadius: "12px",
      overflow: "hidden",
      transition: "all 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease",
      cursor: "pointer"
    }}
    onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = `0 8px 16px ${borderColor}25`; }}
    onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "none"; }}>
      <div onClick={() => setExpanded(!expanded)}
        style={{ display: "flex", alignItems: "center", padding: isMobile ? "10px 12px" : "14px 18px", cursor: "pointer", gap: isMobile ? "8px" : "12px" }}>
        <div style={{
          width: isMobile ? "36px" : "42px", height: isMobile ? "36px" : "42px", borderRadius: "12px", background: mcBg, flexShrink: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontWeight: 800, fontSize: isMobile ? "12px" : "15px", color: mcColor, letterSpacing: "-0.5px",
        }}>
          {asset.symbol.length <= 4 ? asset.symbol : asset.symbol.slice(0, 4)}
        </div>
        <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", gap: isMobile ? "4px" : "8px", marginBottom: "4px", flexWrap: "nowrap" }}>
            <span style={{ fontWeight: 700, fontSize: isMobile ? "14px" : "18px", color: C.text1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: isMobile ? "80px" : "none" }}>{asset.name}</span>
            {!isMobile && <span style={{ fontSize: "16px", color: C.text3 }}>{asset.symbol}</span>}
            {diag && (
              <span style={{
                fontSize: isMobile ? "12px" : "15px", fontWeight: 800, padding: "2px 7px", borderRadius: "6px", marginLeft: "auto", whiteSpace: "nowrap", flexShrink: 0,
                background: diag.score >= 68 ? `${C.green}20` : diag.score >= 42 ? `${C.yellow}20` : `${C.red}20`,
                color: diag.score >= 68 ? C.green : diag.score >= 42 ? C.yellow : C.red,
              }}>{diag.score}점 {diag.opinion}</span>
            )}
          </div>
          <div style={{ display: "flex", gap: "4px", flexWrap: "wrap", alignItems: "center" }}>
            {asset.triggers.map(t => <SignalTag key={t} triggerKey={t} asset={asset} />)}
            {/* v6.9.1: 복합 다이버전스 뱃지 */}
            {(() => {
              const bd = [asset.macdDivType === "bullish", asset.rsiDivType === "bullish", asset.obvDivType === "bullish"].filter(Boolean).length;
              const sd = [asset.macdDivType === "bearish", asset.rsiDivType === "bearish", asset.obvDivType === "bearish"].filter(Boolean).length;
              if (bd >= 2) return <span style={{ fontSize: "14px", fontWeight: 800, padding: "2px 7px", borderRadius: "6px", background: `${C.green}28`, color: C.green, border: `1px solid ${C.green}44` }}>{bd === 3 ? "⚡3중 강세" : "복합 강세"}</span>;
              if (sd >= 2) return <span style={{ fontSize: "14px", fontWeight: 800, padding: "2px 7px", borderRadius: "6px", background: `${C.red}28`, color: C.red, border: `1px solid ${C.red}44` }}>{sd === 3 ? "⚡3중 약세" : "복합 약세"}</span>;
              return null;
            })()}
          </div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontWeight: 700, fontSize: isMobile ? "15px" : "18px", color: C.text1 }}>{fmtPrice(asset.price, asset.market)}</div>
          <div style={{ fontSize: isMobile ? "14px" : "18px", fontWeight: 600, color: isPos ? C.green : C.red }}>
            {isPos ? "▲" : "▼"} {Math.abs(asset.weekChange)}%
          </div>
          {/* 수급 미니 인디케이터 (CMF/MFI) */}
          <div style={{ display: "flex", gap: "4px", justifyContent: "flex-end", marginTop: "3px" }}>
            {asset.cmf != null && (Math.abs(asset.cmf) > 0.05) && (
              <span title={`CMF: ${asset.cmf > 0 ? "+" : ""}${asset.cmf.toFixed(3)}`} style={{
                fontSize: "14px", fontWeight: 700, padding: "1px 5px", borderRadius: "4px",
                background: asset.cmf > 0.1 ? `${C.green}22` : asset.cmf < -0.1 ? `${C.red}22` : `${C.yellow}18`,
                color: asset.cmf > 0.1 ? C.green : asset.cmf < -0.1 ? C.red : C.yellow,
              }}>{asset.cmf > 0 ? "매집" : "분산"}</span>
            )}
            {asset.mfi != null && (asset.mfi < 25 || asset.mfi > 75) && (
              <span title={`MFI: ${asset.mfi}`} style={{
                fontSize: "14px", fontWeight: 700, padding: "1px 5px", borderRadius: "4px",
                background: asset.mfi < 20 ? `${C.purple}22` : asset.mfi < 25 ? `${C.green}18` : asset.mfi > 80 ? `${C.red}22` : `${C.yellow}18`,
                color: asset.mfi < 20 ? C.purple : asset.mfi < 25 ? C.green : asset.mfi > 80 ? C.red : C.yellow,
              }}>{asset.mfi < 25 ? "수급▲" : "수급▼"}</span>
            )}
          </div>
        </div>
      </div>
      {expanded && (
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
                    <span style={{ fontSize: "16px", fontWeight: 700, color: C.text3 }}>🩺 투자진단</span>
                    <span style={{
                      fontSize: "16px", fontWeight: 700,
                      color: diag.score >= 70 ? C.green : diag.score >= 40 ? C.yellow : C.red,
                    }}>{diag.verdict}</span>
                    <span style={{
                      fontSize: "15px", fontWeight: 700, padding: "2px 8px", borderRadius: "4px",
                      background: diag.opinionColor === "green" ? `${C.green}18` : diag.opinionColor === "red" ? `${C.red}18` : `${C.yellow}18`,
                      color: diag.opinionColor === "green" ? C.green : diag.opinionColor === "red" ? C.red : C.yellow,
                    }}>{diag.opinion}</span>
                  </div>
                  {/* 카테고리 미니 바 */}
                  <div style={{ display: "grid", gridTemplateColumns: diag.categories.length > 5 ? "1fr 1fr 1fr" : "1fr 1fr", gap: "4px" }}>
                    {diag.categories.map(cat => (
                      <div key={cat.name} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <span style={{ fontSize: "14px", color: C.text3, width: "36px" }}>{cat.name}</span>
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
              <span style={{ fontSize: "15px", fontWeight: 700, color: C.text3, whiteSpace: "nowrap" }}>💧 수급</span>
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
                }}>{asset.macdDivType === "bullish" ? "📈 MACD 상승전환" : "📉 MACD 하락전환"}</span>
              )}
              {asset.rsiDivType && (
                <span style={{
                  fontSize: "14px", fontWeight: 700, padding: "2px 7px", borderRadius: "6px",
                  background: asset.rsiDivType === "bullish" ? `${C.green}22` : `${C.red}22`,
                  color: asset.rsiDivType === "bullish" ? C.green : C.red,
                }}>{asset.rsiDivType === "bullish" ? "📈 RSI 상승전환" : "📉 RSI 하락전환"}</span>
              )}
              {asset.obvDivType && (
                <span style={{
                  fontSize: "14px", fontWeight: 700, padding: "2px 7px", borderRadius: "6px",
                  background: asset.obvDivType === "bullish" ? `${C.green}22` : `${C.red}22`,
                  color: asset.obvDivType === "bullish" ? C.green : C.red,
                }}>{asset.obvDivType === "bullish" ? "📊 OBV 매집" : "📊 OBV 분산"}</span>
              )}
              {asset.adx != null && asset.adx >= 25 && (
                <span style={{
                  fontSize: "14px", fontWeight: 700, padding: "2px 7px", borderRadius: "6px",
                  background: asset.plusDI > asset.minusDI ? `${C.green}22` : `${C.red}22`,
                  color: asset.plusDI > asset.minusDI ? C.green : C.red,
                }}>{asset.plusDI > asset.minusDI ? "🔼" : "🔽"} ADX {asset.adx} ({asset.plusDI > asset.minusDI ? "매수세" : "매도세"})</span>
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
              { label: "RSI(14) 주간", value: asset.rsi ?? "—",  color: asset.rsi != null && asset.rsi <= 30 ? C.purple : asset.rsi != null && asset.rsi >= 70 ? C.red : C.text2 },
              { label: "RSI(14) 일간", value: asset.dailyRsi ?? "—", color: asset.dailyRsi != null && asset.dailyRsi <= 30 ? C.purple : asset.dailyRsi != null && asset.dailyRsi >= 70 ? C.red : C.text2,
                sub: asset.rsi != null && asset.dailyRsi != null ? (asset.rsi <= 30 && asset.dailyRsi <= 30 ? "MTF 과매도 ✓" : asset.rsi >= 70 && asset.dailyRsi >= 70 ? "MTF 과매수 ✓" : null) : null },
              { label: "200일선 대비", value: asset.ma200Dist != null ? `${asset.ma200Dist > 0 ? "+" : ""}${asset.ma200Dist}%` : "—" },
              { label: "거래량 비율", value: `${asset.volRatio}x`, color: asset.volRatio >= 2 ? C.red : C.text2 },
              { label: "스토캐스틱%K", value: asset.stoch ? `${asset.stoch.k.toFixed(1)}` : "—", color: asset.stoch?.k < 20 ? C.purple : C.text2 },
              { label: "Williams %R", value: asset.wr != null ? `${asset.wr}` : "—", color: asset.wr != null && asset.wr < -80 ? C.purple : C.text2 },
              { label: "52주 저가 대비", value: asset.low52w ? `${(((asset.price - asset.low52w) / asset.low52w) * 100) >= 0 ? "+" : ""}${(((asset.price - asset.low52w) / asset.low52w) * 100).toFixed(1)}%` : "—",
                color: asset.low52w ? ((asset.price - asset.low52w) / asset.low52w * 100 < 5 ? C.purple : C.text2) : C.text2 },
              { label: "CMF", value: asset.cmf != null ? `${asset.cmf > 0 ? "+" : ""}${asset.cmf.toFixed(3)}` : "—", color: asset.cmf != null ? (asset.cmf > 0.1 ? C.green : asset.cmf < -0.1 ? C.red : C.text2) : C.text2 },
              { label: "MFI(14)", value: asset.mfi != null ? `${asset.mfi}` : "—", color: asset.mfi != null ? (asset.mfi < 20 ? C.purple : asset.mfi > 80 ? C.red : C.text2) : C.text2 },
              { label: "ADX", value: asset.adx != null ? `${asset.adx}` : "—",
                color: asset.adx != null ? (asset.adx >= 25 ? (asset.plusDI > asset.minusDI ? C.green : C.red) : C.text3) : C.text2,
                sub: asset.adx != null && asset.adx >= 25 ? (asset.plusDI > asset.minusDI ? "+DI 우세" : "-DI 우세") : asset.adx != null ? "추세 약함" : null },
              { label: "TTM Squeeze", value: asset.bbSqueeze ? "ON" : "OFF",
                color: asset.bbSqueeze ? C.yellow : C.text3,
                sub: asset.bbSqueeze ? "변동성 폭발 임박" : "정상 상태" },
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
            }}>📈 차트 보기</button>
            <a href={asset.market === "crypto"
                ? `https://www.coingecko.com/en/coins/${asset.symbolRaw}`
                : `https://finance.yahoo.com/quote/${asset.symbolRaw || asset.symbol}`}
              target="_blank" rel="noopener" onClick={e => e.stopPropagation()}
              style={{
                padding: "10px 20px", borderRadius: "10px", fontSize: "18px", fontWeight: 600, minHeight: "44px",
                background: C.card, color: C.text3, border: `1px solid ${C.border2}`, textDecoration: "none",
                display: "inline-flex", alignItems: "center",
              }}>🔗 상세 정보</a>
          </div>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// 서브 컴포넌트: AssetDetailPopup (종목 상세 팝업 + 투자진단)
// ════════════════════════════════════════════════════════════════════
function AssetDetailPopup({ asset, onClose, onChart, hotAssets = [], extendedHours = {}, isWatched = false, onToggleWatch = () => {} }) {
  const [techData, setTechData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [fundamentals, setFundamentals] = useState(null);
  const [fundLoading, setFundLoading] = useState(false);

  // 팝업 열릴 때 배경 스크롤 차단
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);
  const flag = asset.market === "us" ? "🇺🇸" : asset.market === "kr" ? "🇰🇷" : "₿";
  const mcBg = asset.market === "us" ? "#1A2C4F" : asset.market === "kr" ? "#1A2A1E" : "#1E1A2A";
  const mcColor = asset.market === "us" ? C.blue : asset.market === "kr" ? C.green : C.purple;

  // 가격 정보 (hotAssets에서 찾기)
  const hot = hotAssets.find(h => h.symbol === asset.symbol);
  const price = asset.price || hot?.price;
  const change = asset.change ?? hot?.change;
  const isPos = (change ?? 0) >= 0;
  const ext = extendedHours[asset.symbol];

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
          models.push({ name: "기술적 평균회귀", value: techFV, weight: 0.20, icon: "📐" });
        }

        // 모델 2: 통계적 적정가 (Z-Score 기반 평균회귀)
        if (closes.length >= 60) {
          const mean60 = sma(closes, 60);
          const std60 = Math.sqrt(closes.slice(-60).reduce((a, v) => a + (v - mean60) ** 2, 0) / 60);
          const zScore = std60 > 0 ? (last - mean60) / std60 : 0;
          // 평균회귀 목표: z-score를 0으로 되돌림
          const statFV = mean60 + std60 * Math.max(-1, Math.min(1, zScore * 0.3));
          models.push({ name: "통계적 평균회귀", value: statFV, weight: 0.15, icon: "📊" });
        }

        // 모델 3: 애널리스트 컨센서스 (Yahoo Finance)
        if (analystQ.targetMean && analystQ.analystCount >= 3) {
          models.push({ name: `애널리스트 컨센서스 (${analystQ.analystCount}명)`, value: analystQ.targetMean, weight: 0.30, icon: "🏦" });
        } else if (analystQ.targetMedian && analystQ.analystCount >= 1) {
          models.push({ name: `애널리스트 목표가 (${analystQ.analystCount}명)`, value: analystQ.targetMedian, weight: 0.20, icon: "🏦" });
        }

        // 모델 4: PER 기반 적정가 (Forward EPS × 섹터 평균 PER)
        if (analystQ.forwardEps && analystQ.forwardEps > 0) {
          // 섹터 평균 PER 근사치: S&P500 평균 ~20, 성장주 ~25-30, 가치주 ~15
          const currentPE = analystQ.forwardPE || (last / analystQ.forwardEps);
          const targetPE = currentPE > 35 ? currentPE * 0.85 : currentPE < 10 ? currentPE * 1.15 : currentPE;
          const perFV = analystQ.forwardEps * Math.min(35, Math.max(12, targetPE));
          if (perFV > 0 && isFinite(perFV)) {
            models.push({ name: "Forward PER 밸류에이션", value: perFV, weight: 0.20, icon: "💹" });
          }
        } else if (analystQ.trailingEps && analystQ.trailingEps > 0 && analystQ.trailingPE) {
          // Trailing EPS fallback
          const historicalPE = analystQ.trailingPE;
          const adjPE = historicalPE > 40 ? historicalPE * 0.8 : historicalPE < 8 ? historicalPE * 1.2 : historicalPE;
          const perFV = analystQ.trailingEps * adjPE;
          if (perFV > 0 && isFinite(perFV)) {
            models.push({ name: "Trailing PER 밸류에이션", value: perFV, weight: 0.15, icon: "💹" });
          }
        }

        // 모델 5: PBR 기반 적정가 (장부가치 × 적정 PBR)
        if (analystQ.bookValue && analystQ.bookValue > 0 && analystQ.priceToBook) {
          const currentPBR = analystQ.priceToBook;
          const targetPBR = currentPBR > 10 ? currentPBR * 0.85 : currentPBR < 1 ? Math.max(1, currentPBR * 1.2) : currentPBR;
          const pbrFV = analystQ.bookValue * targetPBR;
          if (pbrFV > 0 && isFinite(pbrFV)) {
            models.push({ name: "PBR 밸류에이션", value: pbrFV, weight: 0.10, icon: "📘" });
          }
        }

        // 모델 6: 52주 레인지 중심값 (피보나치 기반)
        if (high52w && low52w && high52w > low52w) {
          const range52 = high52w - low52w;
          // 피보나치 50% + 61.8% 가중평균
          const fib50 = low52w + range52 * 0.5;
          const fib618 = low52w + range52 * 0.618;
          const rangeFV = fib50 * 0.6 + fib618 * 0.4;
          models.push({ name: "52주 피보나치 중심", value: rangeFV, weight: 0.10, icon: "🎯" });
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
  const buyLevels = useMemo(() => calcBuyLevels(enriched), [enriched]);

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
      zIndex: 9998, padding: "20px", overscrollBehavior: "contain",
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: C.card, borderRadius: "20px", width: "100%", maxWidth: "420px",
        maxHeight: "80vh", overflow: "auto", border: `1px solid ${C.border}`,
        boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
        overscrollBehavior: "contain", WebkitOverflowScrolling: "touch",
      }}>
        {/* 헤더 */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "18px 20px 14px", borderBottom: `1px solid ${C.border}`,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <div style={{
              width: "44px", height: "44px", borderRadius: "12px", background: mcBg,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontWeight: 800, fontSize: "16px", color: mcColor, flexShrink: 0,
            }}>
              {asset.symbol.replace(".KS","").slice(0, 4)}
            </div>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span style={{ fontWeight: 700, fontSize: "18px", color: C.text1 }}>{asset.name}</span>
                <span style={{ fontSize: "16px" }}>{flag}</span>
              </div>
              <div style={{ fontSize: "16px", color: C.text3 }}>{asset.symbol.replace(".KS","")}</div>
            </div>
          </div>
          <button onClick={onClose} style={{
            width: "32px", height: "32px", borderRadius: "50%", border: "none",
            background: C.card2, color: C.text3, fontSize: "18px", cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>✕</button>
        </div>

        {/* 가격 */}
        {(price != null || techData?.price != null) && (
          <div style={{ padding: "14px 20px", borderBottom: `1px solid ${C.border}` }}>
            <div style={{ fontSize: "24px", fontWeight: 800, color: C.text1, marginBottom: "4px" }}>
              {(() => { const p = techData?.price || price; return asset.market === "kr" ? `₩${Number(p).toLocaleString()}` : asset.market === "crypto" ? `$${Number(p).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}` : `$${Number(p).toFixed(2)}`; })()}
            </div>
            {(change != null || techData?.weekChange != null) && (
              <span style={{
                fontSize: "18px", fontWeight: 600,
                color: (techData?.weekChange ?? change ?? 0) >= 0 ? C.green : C.red,
              }}>
                {(techData?.weekChange ?? change ?? 0) >= 0 ? "▲" : "▼"} {Math.abs(techData?.weekChange ?? change ?? 0).toFixed(2)}%
              </span>
            )}
            {ext && (ext.price) && (
              <div style={{ marginTop: "6px", fontSize: "16px", color: C.text3, display: "flex", alignItems: "center", gap: "6px" }}>
                <span style={{ background: C.card2, padding: "2px 6px", borderRadius: "4px" }}>
                  {ext.isPreMarket ? "프리" : "애프터"} ${Number(ext.price).toFixed(2)}
                  {ext.change != null && (
                    <span style={{ color: ext.change >= 0 ? C.green : C.red, marginLeft: "4px" }}>
                      {ext.change >= 0 ? "+" : ""}{ext.change.toFixed(2)}%
                    </span>
                  )}
                </span>
              </div>
            )}
          </div>
        )}

        {/* 투자진단 */}
        <div style={{ padding: "16px 20px" }}>
          {loading ? (
            <div style={{
              background: C.bg, borderRadius: "12px", padding: "24px", textAlign: "center",
              border: `1px solid ${C.border}`,
            }}>
              <div style={{ fontSize: "20px", marginBottom: "8px", animation: "spin 1s linear infinite" }}>⏳</div>
              <div style={{ fontSize: "16px", color: C.text3 }}>기술적 지표 분석 중...</div>
            </div>
          ) : (
            <div style={{
              background: C.bg, borderRadius: "12px", padding: "16px",
              border: `1px solid ${C.border}`,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "14px", marginBottom: "14px" }}>
                <div style={{ position: "relative", width: "64px", height: "64px", flexShrink: 0 }}>
                  <svg viewBox="0 0 64 64" width="64" height="64">
                    <circle cx="32" cy="32" r="26" fill="none" stroke={C.border} strokeWidth="5" />
                    <circle cx="32" cy="32" r="26" fill="none"
                      stroke={diag.score >= 70 ? C.green : diag.score >= 40 ? C.yellow : C.red}
                      strokeWidth="5" strokeLinecap="round"
                      strokeDasharray={`${(diag.score / 100) * 163.4} 163.4`}
                      transform="rotate(-90 32 32)"
                      style={{ transition: "stroke-dasharray 0.6s ease" }}
                    />
                    <text x="32" y="30" textAnchor="middle" fill={C.text1} fontSize="16" fontWeight="800">{diag.score}</text>
                    <text x="32" y="41" textAnchor="middle" fill={C.text3} fontSize="8">/100</text>
                  </svg>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
                    <span style={{ fontSize: "18px", fontWeight: 700, color: C.text3 }}>🩺 투자진단</span>
                    <span style={{
                      fontSize: "18px", fontWeight: 800,
                      color: diag.score >= 70 ? C.green : diag.score >= 40 ? C.yellow : C.red,
                    }}>{diag.verdict}</span>
                  </div>
                  {/* 매수/매도/중립 의견 */}
                  <div style={{
                    display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px",
                    padding: "6px 10px", borderRadius: "8px",
                    background: diag.opinionColor === "green" ? `${C.green}12` : diag.opinionColor === "red" ? `${C.red}12` : `${C.yellow}12`,
                  }}>
                    <span style={{
                      fontSize: "18px", fontWeight: 800,
                      color: diag.opinionColor === "green" ? C.green : diag.opinionColor === "red" ? C.red : C.yellow,
                    }}>
                      {diag.opinion === "매수" ? "🟢" : diag.opinion === "매도" ? "🔴" : diag.opinion === "중립" ? "🟡" : diag.opinionColor === "green" ? "🟢" : "🔴"} {diag.opinion}
                    </span>
                    <span style={{ fontSize: "15px", color: C.text3 }}>{diag.rationale}</span>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: diag.categories.length > 5 ? "1fr 1fr 1fr" : "1fr 1fr", gap: "5px" }}>
                    {diag.categories.map(cat => (
                      <div key={cat.name} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <span style={{ fontSize: "15px", color: C.text3, width: "36px" }}>{cat.name}</span>
                        <div style={{ flex: 1, height: "5px", background: C.border, borderRadius: "4px", overflow: "hidden" }}>
                          <div style={{
                            height: "100%", borderRadius: "4px",
                            width: `${cat.score}%`,
                            background: cat.score >= 70 ? C.green : cat.score >= 40 ? C.yellow : C.red,
                            transition: "width 0.4s ease",
                          }} />
                        </div>
                        <span style={{ fontSize: "15px", fontWeight: 700, color: C.text3, width: "20px", textAlign: "right" }}>{cat.score}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              {diag.signals.length > 0 && (
                <div style={{ display: "flex", gap: "5px", flexWrap: "wrap" }}>
                  {diag.signals.map((sig, i) => (
                    <span key={i} style={{
                      fontSize: "15px", fontWeight: 600, padding: "4px 8px", borderRadius: "6px",
                      background: sig.type === "bullish" ? `${C.green}18` : sig.type === "bearish" ? `${C.red}18` : `${C.yellow}18`,
                      color: sig.type === "bullish" ? C.green : sig.type === "bearish" ? C.red : C.yellow,
                    }}>{sig.type === "bullish" ? "▲" : sig.type === "bearish" ? "▼" : "●"} {sig.name}</span>
                  ))}
                </div>
              )}

              {/* 매수 추천가 3단계 */}
              {buyLevels.levels.length > 0 && (
                <div style={{ marginTop: "12px", padding: "14px", borderRadius: "12px", background: `${C.blueBg}60`, border: `1px solid ${C.blue}20` }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
                    <span style={{ fontSize: "18px", fontWeight: 700, color: C.text1 }}>🎯 매수 추천가</span>
                    <span style={{ fontSize: "15px", color: C.text3 }}>{buyLevels.summary}</span>
                  </div>
                  <div style={{ display: "flex", gap: "8px" }}>
                    {buyLevels.levels.map((lv, li) => {
                      const lvColors = [C.blue, C.purple, C.green];
                      const lvIcons = ["1️⃣", "2️⃣", "3️⃣"];
                      return (
                        <div key={li} style={{
                          flex: 1, padding: "10px 8px", borderRadius: "12px",
                          background: `${lvColors[li]}12`, textAlign: "center",
                          border: `1px solid ${lvColors[li]}20`,
                        }}>
                          <div style={{ fontSize: "16px", fontWeight: 700, color: lvColors[li], marginBottom: "4px" }}>{lvIcons[li]} {lv.label}</div>
                          <div style={{ fontSize: "18px", fontWeight: 800, color: C.text1 }}>
                            {asset.market === "kr" ? `₩${Math.round(lv.price).toLocaleString()}` : `$${lv.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
                          </div>
                          <div style={{ fontSize: "16px", fontWeight: 700, color: C.red, marginTop: "2px" }}>-{lv.discount}%</div>
                          <div style={{ fontSize: "14px", color: C.text3, marginTop: "4px", lineHeight: 1.3 }}>{lv.rationale}</div>
                          <div style={{ marginTop: "4px" }}>
                            <div style={{ height: "3px", borderRadius: "4px", background: `${C.border}40`, overflow: "hidden" }}>
                              <div style={{ height: "100%", width: `${lv.confidence}%`, background: lvColors[li], borderRadius: "4px" }} />
                            </div>
                            <div style={{ fontSize: "14px", color: C.text3, marginTop: "2px" }}>신뢰도 {lv.confidence}%</div>
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
          <div style={{ padding: "0 20px 12px" }}>
            {/* ── 섹션 헤더 ── */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
              <span style={{ fontSize: "18px", fontWeight: 800, color: C.text1 }}>기업 정보</span>
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
                <div style={{ fontSize: "16px", fontWeight: 700, color: C.text3, marginBottom: "10px" }}>실적 요약</div>
                {/* 매출/영업이익/순이익 */}
                <div style={{ display: "flex", gap: "0", marginBottom: "12px" }}>
                  {[
                    { label: "매출", value: fd.revenue, growth: fd.revGrowthYoY },
                    { label: "영업이익", value: fd.operatingIncome, growth: null },
                    { label: "순이익", value: fd.netIncome, growth: fd.niGrowthYoY },
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
                      { label: "매출총이익률", value: fd.grossMargin, color: C.blue },
                      { label: "영업이익률", value: fd.operatingMargin, color: C.green },
                      { label: "순이익률", value: fd.netMargin, color: fd.netMargin >= 0 ? C.purple : C.red },
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
                      { label: "매출 QoQ", value: fd.revGrowthQoQ },
                      { label: "매출 YoY", value: fd.revGrowthYoY },
                      { label: "순이익 YoY", value: fd.niGrowthYoY },
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
                      <div style={{ fontSize: "15px", color: C.text3, marginBottom: "8px" }}>분기별 추이</div>
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
                        <span style={{ fontSize: "14px", color: C.text3 }}><span style={{ display: "inline-block", width: "8px", height: "8px", borderRadius: "4px", background: `${C.blue}80`, marginRight: "3px", verticalAlign: "middle" }} />매출</span>
                        <span style={{ fontSize: "14px", color: C.text3 }}><span style={{ display: "inline-block", width: "8px", height: "8px", borderRadius: "4px", background: `${C.green}80`, marginRight: "3px", verticalAlign: "middle" }} />순이익</span>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}

            {/* ── 2. 밸류에이션 ── */}
            {(per != null || pbr != null || psr != null || evEbitda != null) && (
              <div style={{ background: C.card, borderRadius: "12px", padding: "16px", marginBottom: "8px", border: `1px solid ${C.border}` }}>
                <div style={{ fontSize: "16px", fontWeight: 700, color: C.text3, marginBottom: "10px" }}>밸류에이션</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0" }}>
                  {[
                    { label: "PER", value: per, desc: per ? (per < 15 ? "저평가" : per < 25 ? "적정" : per < 40 ? "고평가" : "매우 고평가") : null,
                      color: per ? (per < 15 ? C.green : per < 25 ? C.text1 : per < 40 ? C.yellow : C.red) : C.text3 },
                    { label: "PBR", value: pbr, desc: pbr ? (pbr < 1 ? "저평가" : pbr < 3 ? "적정" : "고평가") : null,
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
                    { label: "EPS", value: eps, fmt: v => `$${v.toFixed(2)}` },
                    { label: "시총", value: mcap, fmt: v => v >= 1e12 ? `$${(v/1e12).toFixed(1)}T` : v >= 1e9 ? `$${(v/1e9).toFixed(0)}B` : `$${(v/1e6).toFixed(0)}M` },
                    { label: "배당률", value: divYield, fmt: v => `${(v * 100).toFixed(2)}%` },
                    { label: "베타", value: beta, fmt: v => v.toFixed(2) },
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
                <div style={{ fontSize: "16px", fontWeight: 700, color: C.text3, marginBottom: "10px" }}>수익성 & 재무건전성</div>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {[
                    { label: "ROE", value: roe, scale: 100, suffix: "%", good: v => v > 15, bad: v => v < 0, barMax: 40, barColor: C.green },
                    { label: "ROA", value: roa, scale: 100, suffix: "%", good: v => v > 8, bad: v => v < 0, barMax: 25, barColor: C.blue },
                    { label: "부채비율", value: dte, scale: 1, suffix: "", good: v => v < 1, bad: v => v > 3, barMax: 5, barColor: C.orange, invert: true },
                    { label: "유동비율", value: cr, scale: 1, suffix: "", good: v => v > 1.5, bad: v => v < 1, barMax: 4, barColor: C.purple },
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

              const recLabels = { buy: "매수", strongBuy: "적극 매수", strong_buy: "적극 매수", hold: "보유", sell: "매도", underperform: "비중축소", overweight: "비중확대" };
              const recColors = { buy: C.green, strongBuy: C.green, strong_buy: C.green, hold: C.yellow, sell: C.red, underperform: C.red, overweight: C.green };

              return (
              <div style={{ background: C.card, borderRadius: "12px", padding: "16px", marginBottom: "8px", border: `1px solid ${C.border}` }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
                  <span style={{ fontSize: "16px", fontWeight: 700, color: C.text3 }}>애널리스트 컨센서스</span>
                  {cnt > 0 && <span style={{ fontSize: "15px", color: C.text3, background: C.card2, padding: "2px 6px", borderRadius: "4px" }}>{cnt}명</span>}
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
                        점수 {recScore.toFixed(1)}/5
                      </span>
                    )}
                  </div>
                )}

                {/* 목표주가 요약 */}
                {tgt && (
                  <div style={{ display: "flex", gap: "0", marginBottom: "12px" }}>
                    {[
                      { label: "목표가", value: tgt, main: true },
                      { label: "최고", value: tgtHigh },
                      { label: "최저", value: tgtLow },
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
                      <div style={{ fontSize: "14px", fontWeight: 700, color: C.text2, whiteSpace: "nowrap" }}>현재</div>
                      <div style={{ width: "3px", height: "16px", background: C.text1, borderRadius: "4px" }} />
                    </div>
                    {/* 목표가 마커 */}
                    {tgtPct != null && (
                      <div style={{
                        position: "absolute", top: "6px", left: `${Math.min(Math.max(tgtPct, 2), 98)}%`, transform: "translateX(-50%)",
                        display: "flex", flexDirection: "column", alignItems: "center",
                      }}>
                        <div style={{ fontSize: "14px", fontWeight: 700, color: C.blue, whiteSpace: "nowrap" }}>목표</div>
                        <div style={{ width: "3px", height: "16px", background: C.blue, borderRadius: "4px" }} />
                      </div>
                    )}
                  </div>
                )}

                {/* Financial Datasets 추가 정보 */}
                {fd?.estRevenue && (
                  <div style={{ display: "flex", gap: "12px", paddingTop: "8px", borderTop: `1px solid ${C.border}40` }}>
                    {fd.estRevenue && <span style={{ fontSize: "15px", color: C.text3 }}>예상매출 <span style={{ fontWeight: 700, color: C.text1 }}>{fmtMoney(fd.estRevenue)}</span></span>}
                    {fd.estEps && <span style={{ fontSize: "15px", color: C.text3 }}>예상EPS <span style={{ fontWeight: 700, color: C.text1 }}>${fd.estEps.toFixed(2)}</span></span>}
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
              return (
              <div style={{ background: C.card, borderRadius: "12px", padding: "16px", marginBottom: "8px", border: `1px solid ${C.border}` }}>
                <div style={{ fontSize: "16px", fontWeight: 700, color: C.text3, marginBottom: "10px" }}>적정주가 분석</div>
                <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "10px" }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: "15px", color: C.text3 }}>종합 적정주가</div>
                    <div style={{ fontSize: "20px", fontWeight: 800, color: C.text1 }}>${fv.toFixed(2)}</div>
                  </div>
                  <div style={{
                    padding: "6px 14px", borderRadius: "10px", textAlign: "center",
                    background: fp > 10 ? `${C.red}15` : fp > 5 ? `${C.yellow}15` : fp < -10 ? `${C.green}15` : fp < -5 ? `${C.green}10` : `${C.text3}10`,
                  }}>
                    <div style={{ fontSize: "15px", color: C.text3 }}>현재가 괴리</div>
                    <div style={{
                      fontSize: "18px", fontWeight: 800,
                      color: fp > 5 ? C.red : fp < -5 ? C.green : C.yellow,
                    }}>{fp > 0 ? "+" : ""}{fp}%</div>
                    <div style={{
                      fontSize: "14px", fontWeight: 700,
                      color: fp > 5 ? C.red : fp < -5 ? C.green : C.yellow,
                    }}>
                      {fp > 15 ? "매우 고평가" : fp > 10 ? "고평가" : fp > 5 ? "약간 고평가" : fp < -15 ? "매우 저평가" : fp < -10 ? "저평가" : fp < -5 ? "약간 저평가" : "적정 범위"}
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
                          <span style={{ fontWeight: 700, color: C.text1 }}>${m.value.toFixed(2)}</span>
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
              {techData?.earningsDate && ` · 다음 실적 ${new Date(techData.earningsDate * 1000).toLocaleDateString("ko-KR")}`}
            </div>
            </>
            )}
          </div>
          );
        })()}

        {/* ═══ 투자 전략 (Advanced Investment Strategy) ═══ */}
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

          return (
            <>
            {/* 전략 + 핵심 레벨 */}
            <div style={{ padding: "0 20px 12px" }}>
              <div style={{ background: C.bg, borderRadius: "12px", padding: "16px", border: `1px solid ${C.border}` }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <span style={{ fontSize: "16px", fontWeight: 700, color: C.text3 }}>🎯 퀀트 전략</span>
                    <span style={{
                      fontSize: "15px", fontWeight: 700, padding: "2px 8px", borderRadius: "4px",
                      background: diag.opinionColor === "green" ? `${C.green}18` : diag.opinionColor === "red" ? `${C.red}18` : `${C.yellow}18`,
                      color: diag.opinionColor === "green" ? C.green : diag.opinionColor === "red" ? C.red : C.yellow,
                    }}>{diag.opinion}</span>
                  </div>
                  {freshMin != null && <span style={{ fontSize: "14px", color: C.text3 }}>{freshMin < 1 ? "방금" : `${freshMin}분 전`} 분석</span>}
                </div>

                {/* 전략 요약 */}
                <div style={{
                  fontSize: "16px", color: C.text2, lineHeight: 1.7, marginBottom: "14px",
                  padding: "10px 12px", borderRadius: "10px", background: C.card,
                  borderLeft: `3px solid ${diag.opinionColor === "green" ? C.green : diag.opinionColor === "red" ? C.red : C.yellow}`,
                }}>
                  {isBullish && targetPrice
                    ? `기술적 상승 신호 우세. 목표가 ${fmtP(targetPrice)}(+${upside}%)까지 상승 여력, 손절 ${fmtP(stopLoss)} 이탈 시 청산 권장.${riskReward ? ` R:R 1:${riskReward}.` : ""}`
                    : isBullish
                    ? `상승 추세 감지. 분할 매수 접근 유효. ${fmtP(stopLoss)} 하회 시 리스크 관리 필요.`
                    : isBearish
                    ? `하락 신호 우세. 관망 또는 ${fmtP(sup1?.price || stopLoss)} 지지 확인 후 진입 권장.`
                    : `혼조 구간. 지지 ${fmtP(sup1?.price || stopLoss)}·저항 ${fmtP(res1?.price)} 돌파 확인 후 대응.`}
                </div>

                {/* 목표가 + 손절가 (근거 표시) */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px", marginBottom: "8px" }}>
                  <div style={{ background: C.card, borderRadius: "8px", padding: "10px" }}>
                    <div style={{ fontSize: "14px", color: C.text3, marginBottom: "3px" }}>목표가</div>
                    <div style={{ fontSize: "18px", fontWeight: 800, color: C.green }}>{fmtP(targetPrice || techData.analystTarget)}</div>
                    {upside && <div style={{ fontSize: "15px", color: C.green, marginTop: "2px" }}>+{upside}%</div>}
                    {lv?.targetSources && <div style={{ fontSize: "14px", color: C.text3, marginTop: "4px", lineHeight: 1.4 }}>{lv.targetSources.slice(0, 3).join(" · ")}</div>}
                  </div>
                  <div style={{ background: C.card, borderRadius: "8px", padding: "10px" }}>
                    <div style={{ fontSize: "14px", color: C.text3, marginBottom: "3px" }}>손절가</div>
                    <div style={{ fontSize: "18px", fontWeight: 800, color: C.red }}>{fmtP(stopLoss)}</div>
                    {downside > 0 && <div style={{ fontSize: "15px", color: C.red, marginTop: "2px" }}>-{downside}%</div>}
                    {lv?.stopSources && <div style={{ fontSize: "14px", color: C.text3, marginTop: "4px", lineHeight: 1.4 }}>{lv.stopSources.slice(0, 3).join(" · ")}</div>}
                  </div>
                </div>

                {/* 지지선 + 저항선 (다중 레벨, 근거 표시) */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px", marginBottom: "10px" }}>
                  <div style={{ background: C.card, borderRadius: "8px", padding: "10px" }}>
                    <div style={{ fontSize: "14px", color: C.text3, marginBottom: "5px" }}>지지선</div>
                    {sup1 ? (
                      <>
                        <div style={{ fontSize: "18px", fontWeight: 700, color: C.blue }}>{fmtP(sup1.price)}</div>
                        <div style={{ fontSize: "14px", color: C.text3, marginTop: "2px" }}>{sup1.sources.slice(0, 2).join(" · ")} <span style={{ color: C.blue }}>×{sup1.weight.toFixed(0)}</span></div>
                        {sup2 && <div style={{ fontSize: "15px", color: C.text3, marginTop: "4px" }}>2차: {fmtP(sup2.price)} <span style={{ fontSize: "14px" }}>({sup2.sources[0]})</span></div>}
                      </>
                    ) : <div style={{ fontSize: "16px", color: C.text3 }}>—</div>}
                  </div>
                  <div style={{ background: C.card, borderRadius: "8px", padding: "10px" }}>
                    <div style={{ fontSize: "14px", color: C.text3, marginBottom: "5px" }}>저항선</div>
                    {res1 ? (
                      <>
                        <div style={{ fontSize: "18px", fontWeight: 700, color: C.purple }}>{fmtP(res1.price)}</div>
                        <div style={{ fontSize: "14px", color: C.text3, marginTop: "2px" }}>{res1.sources.slice(0, 2).join(" · ")} <span style={{ color: C.purple }}>×{res1.weight.toFixed(0)}</span></div>
                        {res2 && <div style={{ fontSize: "15px", color: C.text3, marginTop: "4px" }}>2차: {fmtP(res2.price)} <span style={{ fontSize: "14px" }}>({res2.sources[0]})</span></div>}
                      </>
                    ) : <div style={{ fontSize: "16px", color: C.text3 }}>—</div>}
                  </div>
                </div>

                {/* 리스크:리워드 + 진입 + 포지션 */}
                <div style={{ display: "flex", gap: "6px" }}>
                  {riskReward && (
                    <div style={{ flex: 1, padding: "8px 10px", borderRadius: "8px", background: riskReward >= 2 ? `${C.green}12` : riskReward >= 1 ? `${C.yellow}12` : `${C.red}12`, textAlign: "center" }}>
                      <div style={{ fontSize: "14px", color: C.text3 }}>R:R</div>
                      <div style={{ fontSize: "18px", fontWeight: 800, color: riskReward >= 2 ? C.green : riskReward >= 1 ? C.yellow : C.red }}>1:{riskReward}</div>
                    </div>
                  )}
                  <div style={{ flex: 1, padding: "8px 10px", borderRadius: "8px", background: C.card, textAlign: "center" }}>
                    <div style={{ fontSize: "14px", color: C.text3 }}>진입</div>
                    <div style={{ fontSize: "16px", fontWeight: 700, color: C.text1, marginTop: "2px" }}>{isBullish ? "분할매수" : isBearish ? "관망" : "확인 후"}</div>
                  </div>
                  <div style={{ flex: 1, padding: "8px 10px", borderRadius: "8px", background: C.card, textAlign: "center" }}>
                    <div style={{ fontSize: "14px", color: C.text3 }}>포지션</div>
                    <div style={{ fontSize: "16px", fontWeight: 700, color: C.text1, marginTop: "2px" }}>{diag.score >= 70 ? "비중확대" : diag.score >= 55 ? "소량매수" : diag.score >= 40 ? "비중유지" : "비중축소"}</div>
                  </div>
                </div>
              </div>
            </div>

            {/* ═══ 퀀트 전략 백테스트 결과 (상위 5개) ═══ */}
            {bt.length > 0 && (
              <div style={{ padding: "0 20px 12px" }}>
                <div style={{ background: C.bg, borderRadius: "12px", padding: "16px", border: `1px solid ${C.border}` }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
                    <span style={{ fontSize: "16px", fontWeight: 700, color: C.text3 }}>📊 퀀트 전략 백테스트 (1년)</span>
                    <span style={{ fontSize: "14px", color: C.text3 }}>상위 {bt.length}개</span>
                  </div>
                  {bt.map((s, i) => {
                    const isTop = i === 0;
                    const retColor = s.totalReturn >= 0 ? C.green : C.red;
                    return (
                      <div key={s.name} style={{
                        padding: "10px 12px", borderRadius: "10px", marginBottom: i < bt.length - 1 ? "6px" : 0,
                        background: isTop ? `${C.blue}08` : C.card,
                        border: isTop ? `1px solid ${C.blue}30` : `1px solid ${C.border}`,
                      }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                            <span style={{ fontSize: "16px", fontWeight: 700, color: isTop ? C.blue : C.text1 }}>
                              {isTop ? "🏆" : `${i + 1}.`} {s.name}
                            </span>
                          </div>
                          <span style={{ fontSize: "18px", fontWeight: 800, color: retColor }}>
                            {s.totalReturn >= 0 ? "+" : ""}{s.totalReturn}%
                          </span>
                        </div>
                        <div style={{ fontSize: "15px", color: C.text3, marginBottom: "6px" }}>{s.desc}</div>
                        <div style={{ display: "flex", gap: "8px", flexWrap: isMobile ? "nowrap" : "wrap", overflowX: isMobile ? "auto" : "visible", paddingBottom: isMobile ? "8px" : "0" }}>
                          <span style={{ fontSize: mf(15), padding: "2px 6px", borderRadius: "4px", background: C.card2 }}>
                            샤프 <span style={{ fontWeight: 700, color: s.sharpe >= 1 ? C.green : s.sharpe >= 0 ? C.yellow : C.red }}>{s.sharpe}</span>
                          </span>
                          <span style={{ fontSize: mf(15), padding: "2px 6px", borderRadius: "4px", background: C.card2 }}>
                            승률 <span style={{ fontWeight: 700, color: s.winRate >= 60 ? C.green : s.winRate >= 40 ? C.yellow : C.red }}>{s.winRate}%</span>
                          </span>
                          <span style={{ fontSize: mf(15), padding: "2px 6px", borderRadius: "4px", background: C.card2 }}>
                            MDD <span style={{ fontWeight: 700, color: s.maxDD <= 10 ? C.green : s.maxDD <= 20 ? C.yellow : C.red }}>-{s.maxDD}%</span>
                          </span>
                          <span style={{ fontSize: mf(15), padding: "2px 6px", borderRadius: "4px", background: C.card2 }}>
                            {s.trades}회
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            </>
          );
        })()}

        {/* 적정주가 섹션은 위 토스 스타일 기업정보 5번 섹션으로 통합됨 */}

        {/* ═══ 기술적 지표 요약 ═══ */}
        {techData && (
          <div style={{ padding: "0 20px 16px" }}>
            <div style={{ background: C.card, borderRadius: "12px", padding: "16px", border: `1px solid ${C.border}` }}>
              <div style={{ fontSize: "16px", fontWeight: 700, color: C.text3, marginBottom: "10px" }}>기술적 지표</div>
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(3, 1fr)", gap: "6px" }}>
                {[
                  { label: "RSI(14)", value: techData.rsi, color: techData.rsi <= 30 ? C.purple : techData.rsi >= 70 ? C.red : C.text2 },
                  { label: "200일선 괴리", value: techData.ma200Dist != null ? `${techData.ma200Dist > 0 ? "+" : ""}${techData.ma200Dist}%` : "—", color: techData.ma200Dist > 10 ? C.red : techData.ma200Dist < -10 ? C.green : C.text2 },
                  { label: "거래량 비율", value: `${techData.volRatio}x`, color: techData.volRatio >= 2 ? C.red : C.text2 },
                  { label: "스토캐스틱", value: techData.stoch ? `${techData.stoch.k}` : "—", color: techData.stoch?.k < 20 ? C.purple : techData.stoch?.k > 80 ? C.red : C.text2 },
                  { label: "W%R", value: techData.wr != null ? `${techData.wr}` : "—", color: techData.wr < -80 ? C.purple : techData.wr > -20 ? C.red : C.text2 },
                  { label: "52주 위치", value: techData.high52w && techData.low52w ? `${((techData.price - techData.low52w) / (techData.high52w - techData.low52w) * 100).toFixed(0)}%` : "—" },
                  { label: "CMF", value: enriched.cmf != null ? `${enriched.cmf > 0 ? "+" : ""}${enriched.cmf.toFixed(3)}` : "—", color: enriched.cmf != null ? (enriched.cmf > 0.1 ? C.green : enriched.cmf < -0.1 ? C.red : C.text2) : C.text2, sub: enriched.cmf != null ? (enriched.cmf > 0.1 ? "매집 강세" : enriched.cmf < -0.1 ? "분산 경고" : "중립") : null },
                  { label: "MFI(14)", value: enriched.mfi != null ? `${Math.round(enriched.mfi)}` : "—", color: enriched.mfi != null ? (enriched.mfi < 20 ? C.purple : enriched.mfi > 80 ? C.red : C.text2) : C.text2, sub: enriched.mfi != null ? (enriched.mfi < 20 ? "과매도" : enriched.mfi > 80 ? "과매수" : enriched.mfi < 40 ? "약세" : enriched.mfi > 60 ? "강세" : "중립") : null },
                  { label: "ADX", value: enriched.adx != null ? `${enriched.adx}` : "—", color: enriched.adx != null ? (enriched.adx >= 25 ? (enriched.plusDI > enriched.minusDI ? C.green : C.red) : C.text3) : C.text2, sub: enriched.adx != null ? (enriched.adx >= 25 ? (enriched.plusDI > enriched.minusDI ? "+DI 우세" : "-DI 우세") : "추세 약함") : null },
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
                    <span style={{ fontSize: "15px", fontWeight: 700, color: C.text3 }}>수급 흐름</span>
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
                  📅 다음 실적 발표 <span style={{ fontWeight: 700, color: C.text2 }}>{new Date(techData.earningsDate * 1000).toLocaleDateString("ko-KR", { year: "numeric", month: "short", day: "numeric" })}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* 액션 버튼 */}
        <div style={{ padding: "0 20px 12px", display: "flex", gap: "8px" }}>
          <button onClick={() => onToggleWatch(asset.symbol)} style={{
            width: "44px", height: "44px", borderRadius: "12px", fontSize: "18px",
            background: isWatched ? `${C.yellow}22` : C.card2, border: `1px solid ${isWatched ? C.yellow : C.border2}`,
            cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          }}>{isWatched ? "⭐" : "☆"}</button>
          <button onClick={() => { onChart(); onClose(); }} style={{
            flex: 1, padding: "12px 0", borderRadius: "12px", fontSize: "18px", fontWeight: 700,
            background: C.blue, color: "#fff", border: "none", cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", gap: "6px",
          }}>📈 차트 보기</button>
          <a href={asset.market === "crypto"
              ? `https://www.coingecko.com/en/coins/${asset.id || asset.symbolRaw || asset.symbol.toLowerCase()}`
              : `https://finance.yahoo.com/quote/${asset.symbolRaw || asset.symbol}`}
            target="_blank" rel="noopener"
            style={{
              flex: 1, padding: "12px 0", borderRadius: "12px", fontSize: "18px", fontWeight: 700,
              background: C.card2, color: C.text2, border: `1px solid ${C.border2}`,
              textDecoration: "none", textAlign: "center",
              display: "flex", alignItems: "center", justifyContent: "center", gap: "6px",
            }}>🔗 상세 정보</a>
        </div>
        {/* 공유 버튼 — 바이럴 */}
        <div style={{ padding: "0 20px 20px" }}>
          <button onClick={() => {
            const score = techData?.overallScore || 0;
            const verdict = score >= 80 ? "강력매수" : score >= 65 ? "매수" : score >= 50 ? "중립" : score >= 35 ? "주의" : "매도";
            const shareText = `[Zepta AI 진단] ${asset.name}(${asset.symbol}) — 투자점수 ${score}점 (${verdict})\n\nAI 퀀트 33개 전략 분석 결과입니다.\n무료로 확인해보세요 👉 https://zepta.app`;
            if (navigator.share) {
              navigator.share({ title: `${asset.name} AI 투자 진단`, text: shareText, url: "https://zepta.app" }).catch(() => {});
            } else {
              navigator.clipboard.writeText(shareText).then(() => showToast("진단 결과가 복사되었습니다!", "success")).catch(() => {});
            }
          }} style={{
            width: "100%", padding: "10px 0", borderRadius: "10px", fontSize: "18px", fontWeight: 600,
            background: "transparent", color: C.text3, border: `1px solid ${C.border}${C.isDark ? '30' : '50'}`,
            cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px",
            transition: "all .15s",
          }}
          onMouseEnter={e => { e.currentTarget.style.background = C.card2; e.currentTarget.style.color = C.text2; }}
          onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = C.text3; }}
          >📤 진단 결과 공유</button>
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

function AppInner() {
  const { t } = useLanguage();
  const { user, loading: authLoading, signOut, refreshUser } = useAuth();
  const isOwner = (user?.email || "").toLowerCase() === OWNER_EMAIL;
  const [themeMode, setThemeMode] = useState(loadTheme);
  const [showCoupangCTA, setShowCoupangCTA] = useState(false);
  const [showGoogleCTA, setShowGoogleCTA] = useState(false);
  const ctaCountRef = useRef(0); // 쿠팡/구글 번갈아 표시
  C = themeMode === "dark" ? DARK : LIGHT;


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
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3000);
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

  const validTabs = ["home","auto-trading","real-trading","portfolio","screener","alerts","news","quant-portfolio","quant-port","risk-map","sector-flow","backtest","sentiment","strategy","anomaly","quant-report","econ-calendar","profile","dev","about","privacy","terms","contact"];
  const [tab, setTabRaw] = useState(() => {
    try {
      // 1순위: URL pathname (/screener, /auto-trading 등)
      const path = window.location.pathname.replace(/^\//, "").replace(/\/$/, "");
      if (path && validTabs.includes(path)) return path;
      // 2순위: URL ?tab= 파라미터 (레거시 호환)
      const p = new URLSearchParams(window.location.search);
      const t = p.get("tab");
      if (t && validTabs.includes(t)) return t;
      // 3순위: sessionStorage (새로고침 시 복원)
      const saved = sessionStorage.getItem("zepta_tab");
      if (saved && validTabs.includes(saved)) return saved;
    } catch {}
    return "home";
  });
  const setTab = useCallback((newTab) => {
    setTabRaw(newTab);
    try {
      sessionStorage.setItem("zepta_tab", newTab);
      // URL을 경로 기반으로 업데이트 (페이지 리로드 없이)
      const newPath = newTab === "home" ? "/" : `/${newTab}`;
      if (window.location.pathname !== newPath) {
        window.history.pushState({ tab: newTab }, "", newPath);
      }
    } catch {}
    // 탭 전환 시 스크롤 최상단으로 이동
    window.scrollTo({ top: 0, behavior: "instant" });
  }, []);

  // ── 브라우저 뒤로가기/앞으로가기 지원 ──
  useEffect(() => {
    const onPopState = () => {
      const path = window.location.pathname.replace(/^\//, "").replace(/\/$/, "");
      if (path && validTabs.includes(path)) { setTabRaw(path); try { sessionStorage.setItem("zepta_tab", path); } catch {} }
      else { setTabRaw("home"); }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  // ── 탭별 SEO 메타 정보 (제목, 설명, OG 태그용) ──
  const TAB_META = {
    home: { title: "Zepta — AI 퀀트 투자 플랫폼", desc: "실시간 주식/코인 스크리너, 33개 알파 전략 자동매매, 백테스트, 리스크 관리" },
    screener: { title: "주식 스크리너 | Zepta", desc: "AI 기반 주식 스크리닝 — 모멘텀, 변동성, 수급 조건으로 종목 필터링" },
    "auto-trading": { title: "AI 자동매매 | Zepta", desc: "33개 퀀트 전략 기반 암호화폐 자동매매 봇" },
    portfolio: { title: "포트폴리오 | Zepta", desc: "실시간 포트폴리오 추적 및 벤치마크 비교" },
    news: { title: "마켓 뉴스 | Zepta", desc: "AI 센티먼트 분석이 포함된 실시간 글로벌 투자 뉴스" },
    "econ-calendar": { title: "경제 캘린더 | Zepta", desc: "주요 경제 지표 발표 일정 및 영향 분석" },
    sentiment: { title: "소셜 센티먼트 | Zepta", desc: "StockTwits · Reddit 기반 실시간 투자 심리 분석" },
    alerts: { title: "매매 알림 | Zepta", desc: "실시간 AI 매매 신호 알림 및 텔레그램 연동" },
    anomaly: { title: "이상 탐지 | Zepta", desc: "AI 기반 시장 이상 징후 실시간 탐지" },
    strategy: { title: "전략 분석 | Zepta", desc: "33개 퀀트 전략 상세 분석 및 성과 비교" },
    backtest: { title: "백테스트 | Zepta", desc: "전략별 과거 수익률 시뮬레이션" },
    "quant-port": { title: "퀀트 포트폴리오 | Zepta", desc: "전략 기반 포트폴리오 자동 구성" },
    "risk-map": { title: "리스크 맵 | Zepta", desc: "시장 리스크 종합 분석 히트맵" },
    "quant-report": { title: "퀀트 리포트 | Zepta", desc: "AI 기반 실시간 시장 분석 리포트" },
    profile: { title: "프로필 | Zepta", desc: "투자 성적표 및 계정 설정" },
    about: { title: "서비스 소개 | Zepta", desc: "Zepta AI 퀀트 투자 플랫폼 소개" }
  };

  // ── GNB 카테고리 상태 ──
  const gnbCategoryMap = {
    "home": "home",
    "screener": "analysis",
    "anomaly": "analysis",
    "strategy": "analysis",
    "quant-report": "analysis",
    "backtest": "analysis",
    "quant-port": "management",
    "risk-map": "management",
    "portfolio": "management",
    "auto-trading": "ai-quant",
    "real-trading": "ai-quant",
    "news": "info",
    "sentiment": "info",
    "alerts": "info",
    "econ-calendar": "info",
  };
  const [gnbCategory, setGnbCategory] = useState(() => gnbCategoryMap[tab] || "home");

  // ── GNB 카테고리 동기화 (tab 변경 시) ──
  useEffect(() => {
    const newCategory = gnbCategoryMap[tab] || "home";
    setGnbCategory(newCategory);
  }, [tab]);

  const [gnbHover, setGnbHover] = useState(null); // GNB 호버 드롭다운 상태
  const gnbHoverTimeout = useRef(null);
  const [userDropOpen, setUserDropOpen] = useState(false); // 유저 드롭다운 상태
  const userDropTimeout = useRef(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [sbCollapsed, setSbCollapsed] = useState({ main: false, ops: false, info: false });

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
    })();
  }, [user, writeUserLocal, syncUserDataToSupabase]);

  // 유저 변경 시 플래그 리셋
  useEffect(() => { userDataLoaded.current = false; }, [user?.id]);

  // ── 스크롤 및 UX 상태 ──
  const [showScrollTop, setShowScrollTop] = useState(false);

  // ── 스크리너 상태 ─────────────────────────────────────────────
  const [results, setResults]         = useState([]);
  const [scanning, setScanning]       = useState(false);
  const [scanProgress, setScanProgress] = useState({ done: 0, total: 0 });
  const [conditions, setConditions]   = useState([]);
  const [mode, setMode]               = useState("or");
  const [filterMarket, setFilterMarket] = useState("all");
  const [sortBy, setSortBy]           = useState("rsi");
  const [scanErrors, setScanErrors]   = useState([]);
  const [activePreset, setActivePreset] = useState(null);
  const [lastScan, setLastScan]       = useState(null);
  const [chartAsset, setChartAsset]   = useState(null);
  const [selectedAsset, setSelectedAsset] = useState(null); // 종목 상세 팝업
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);

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

  // 전략 이름 → 전략 객체 매핑 (generate() 호출용)
  const STRATEGY_NAME_MAP = useMemo(() => {
    const m = {};
    for (const s of ALL_STRATEGIES) m[s.name] = s;
    return m;
  }, []);

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
  const [aiChatOpen, setAiChatOpen] = useState(false);
  const [aiMessages, setAiMessages] = useState([]);
  const [aiInput, setAiInput] = useState("");
  const [aiLoading, setAiLoading] = useState(false);

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
      const canonicalUrl = tab === "home" ? "https://zepta.app/" : `https://zepta.app/${tab}`;
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
        reasons.push(`변동률 ${asset.change >= 0 ? "+" : ""}${asset.change}% (평균의 ${(Math.abs(asset.change) / Math.max(avgChange, 0.1)).toFixed(1)}배)`);
      }
      // 2) 거래량 스파이크 (volume 비율 기반)
      if (asset.volRatio && asset.volRatio > 3) {
        reasons.push(`거래량 ${asset.volRatio.toFixed(1)}x 폭증`);
      }
      // 3) 급격한 갭
      if (asset.gap && Math.abs(asset.gap) > 3) {
        reasons.push(`갭 ${asset.gap > 0 ? "+" : ""}${asset.gap.toFixed(1)}%`);
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
  }, [hotAssets]);

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

  // ── AI 투자 어시스턴트 ──
  const handleAiChat = useCallback((userMsg) => {
    if (!userMsg.trim()) return;
    const msg = userMsg.trim();
    setAiMessages(prev => [...prev, { role: "user", text: msg }]);
    setAiInput("");
    setAiLoading(true);

    // v9.1 — 고도화된 로컬 퀀트 데이터 기반 응답
    setTimeout(() => {
      let reply = "";
      const msgLow = msg.toLowerCase();
      // 종목 검색 (더 넓은 매칭)
      const matchedAsset = hotAssets.find(a =>
        msgLow.includes(a.name.toLowerCase()) || msgLow.includes(a.symbol.toLowerCase().replace(".ks",""))
      ) || watchlist.find(w => msgLow.includes(w.name?.toLowerCase()) || msgLow.includes(w.symbol.toLowerCase().replace(".ks","")));

      if (matchedAsset) {
        const hot = hotAssets.find(h => h.symbol === matchedAsset.symbol || h.symbol === matchedAsset.symbolRaw);
        const diag = hot ? quickDiagnosis(hot) : null;
        const buyLvls = hot ? calcBuyLevels(hot) : null;
        const pick = dailyPicks.find(p => p.symbol === matchedAsset.symbol);
        const ext = extendedHours[matchedAsset.symbolRaw || matchedAsset.symbol];
        reply = `📊 ${matchedAsset.name} (${matchedAsset.symbol.replace(".KS","")}) 분석\n\n`;
        if (hot) {
          reply += `현재가: ${fmtPrice(hot.price, matchedAsset.market)} (${hot.change >= 0 ? "+" : ""}${hot.change}%)\n`;
          if (ext) reply += `${ext.isPreMarket ? "프리마켓" : "애프터마켓"}: ${ext.price ? fmtPrice(ext.price, matchedAsset.market) : ""} ${ext.change != null ? `(${ext.change >= 0 ? "+" : ""}${ext.change.toFixed(1)}%)` : ""}\n`;
        }
        if (diag) {
          reply += `\n퀀트 점수: ${diag.score}/100 → ${diag.opinion}\n`;
          if (diag.categories) {
            reply += `${diag.categories.map(c => `${c.name}: ${c.score}점`).join(" | ")}\n`;
          }
          reply += `분석: ${diag.rationale}\n`;
        }
        if (buyLvls?.levels?.length > 0) {
          reply += `\n🎯 분할 매수 타점:\n`;
          buyLvls.levels.forEach(lv => {
            reply += `  ${lv.label}: ${matchedAsset.market === "kr" ? "₩" : "$"}${lv.price < 1 ? lv.price.toFixed(4) : lv.price.toLocaleString()} (-${lv.discount}%)\n`;
          });
        }
        if (pick) {
          reply += `\n추천 순위: ${dailyPicks.indexOf(pick) + 1}위 — ${pick.reason}\n`;
        }
        const anomaly = anomalies.find(a => a.symbol === matchedAsset.symbol);
        if (anomaly) {
          reply += `\n⚠️ 이상 탐지: ${anomaly.anomalyReasons.join(", ")}\n`;
        }
        // 전략적 제안
        if (diag) {
          reply += `\n💡 `;
          if (diag.score >= 68) {
            reply += "매수 시그널이 우세합니다. 1차 매수 타점에서 분할 진입을 고려해보세요. 목표가까지 2~3차에 걸쳐 비중을 확대하는 전략이 유효합니다.";
          } else if (diag.score >= 50) {
            reply += "혼조 구간입니다. 현재가보다는 2차 매수 타점까지 기다리며, 거래량 변화와 추세 전환 신호를 확인한 후 진입하세요.";
          } else if (diag.score >= 35) {
            reply += "약세 신호가 우세합니다. 신규 진입보다는 관망하세요. 3차 매수 타점까지 하락 시 소량 분할 매수를 검토할 수 있습니다.";
          } else {
            reply += "강한 하락 신호입니다. 보유 중이라면 손절선 준수, 미보유라면 반등 확인 전까지 관망을 권합니다.";
          }
        }
      } else if (msgLow.includes("시장") || msgLow.includes("마켓") || msgLow.includes("현황") || msgLow.includes("오늘")) {
        const sp = marketIndices.find(i => i.symbol === "^GSPC");
        const nq = marketIndices.find(i => i.symbol === "^IXIC");
        const ks = marketIndices.find(i => i.symbol === "^KS11");
        const vix = marketIndices.find(i => i.symbol === "^VIX");
        const fg = fearGreed.stock?.value;
        const upCnt = hotAssets.filter(a => a.change > 0).length;
        const dnCnt = hotAssets.filter(a => a.change < 0).length;
        reply = `📈 시장 현황 요약\n\n`;
        if (sp) reply += `S&P 500: ${sp.price?.toLocaleString(undefined, {maximumFractionDigits: 0})} (${sp.change >= 0 ? "+" : ""}${sp.change}%)\n`;
        if (nq) reply += `나스닥: ${nq.price?.toLocaleString(undefined, {maximumFractionDigits: 0})} (${nq.change >= 0 ? "+" : ""}${nq.change}%)\n`;
        if (ks) reply += `코스피: ${ks.price?.toLocaleString(undefined, {maximumFractionDigits: 0})} (${ks.change >= 0 ? "+" : ""}${ks.change}%)\n`;
        if (vix) reply += `VIX: ${vix.price?.toFixed(1)} (${vix.price > 30 ? "고변동" : vix.price > 20 ? "보통" : "안정"})\n`;
        if (fg) reply += `공포탐욕: ${fg} (${fg <= 25 ? "극도의 공포" : fg <= 40 ? "공포" : fg <= 60 ? "중립" : fg <= 75 ? "탐욕" : "극도의 탐욕"})\n`;
        reply += `\n등락: 상승 ${upCnt} / 하락 ${dnCnt} (${hotAssets.length > 0 ? `상승률 ${(upCnt / hotAssets.length * 100).toFixed(0)}%` : ""})`;
        if (anomalies.length > 0) reply += `\n\n⚡ 이상 탐지 ${anomalies.length}건:\n${anomalies.slice(0, 3).map(a => `  ${a.name} ${a.change >= 0 ? "+" : ""}${a.change}%`).join("\n")}`;
        // 종합 판단
        let mktScore = 50;
        if (sp) mktScore += sp.change > 1 ? 10 : sp.change > 0.3 ? 5 : sp.change > -0.3 ? 0 : -5;
        if (fg) mktScore += fg > 55 ? 5 : fg > 40 ? 0 : -5;
        mktScore += (upCnt / Math.max(upCnt + dnCnt, 1)) > 0.55 ? 5 : -5;
        mktScore = Math.max(0, Math.min(100, mktScore));
        reply += `\n\n💡 ${mktScore >= 60 ? "매수 우위 장세입니다. 관심종목 1차 진입을 검토하세요." : mktScore >= 45 ? "혼조 장세입니다. 방향성 확인 후 접근하세요." : "약세 장세입니다. 비중 축소와 현금 확보를 권합니다."}`;
      } else if (msgLow.includes("추천") || msgLow.includes("뭐 살") || msgLow.includes("매수") || msgLow.includes("top") || msgLow.includes("best")) {
        const top5 = dailyPicks.slice(0, 5);
        reply = `🎯 오늘의 추천 TOP ${Math.min(5, top5.length)}\n\n`;
        top5.forEach((p, i) => {
          const hot = hotAssets.find(h => h.symbol === p.symbol);
          const d = hot ? quickDiagnosis(hot) : null;
          reply += `${i + 1}. ${p.name} — ${p.reason}\n`;
          reply += `   ${p.change >= 0 ? "+" : ""}${p.change}%${d ? ` · 퀀트 ${d.score}점 (${d.opinion})` : ""}\n`;
        });
        reply += `\n총 ${dailyPicks.length}개 분석 완료. 상세 분석은 종목명을 물어봐주세요.`;
      } else if (msgLow.includes("포트폴리오") || msgLow.includes("내 자산") || msgLow.includes("수익") || msgLow.includes("성과")) {
        if (portfolio.length > 0 && benchmarkData) {
          reply = `💼 포트폴리오 현황\n\n`;
          reply += `보유 종목: ${portfolio.length}개\n`;
          reply += `총 수익률: ${benchmarkData.myReturn >= 0 ? "+" : ""}${benchmarkData.myReturn.toFixed(2)}%\n`;
          if (benchmarkData.spReturn != null) reply += `vs S&P 500: ${benchmarkData.alpha >= 0 ? "+" : ""}${benchmarkData.alpha.toFixed(2)}% ${benchmarkData.beatsSP ? "(아웃퍼폼)" : "(언더퍼폼)"}\n`;
          // 관심종목 진단 요약
          if (watchlist.length > 0) {
            const wDiags = watchlist.map(w => {
              const h = hotAssets.find(x => x.symbol === w.symbol || x.symbol === w.symbolRaw);
              return h ? { name: w.name, ...quickDiagnosis(h) } : null;
            }).filter(Boolean);
            if (wDiags.length > 0) {
              const avgScore = Math.round(wDiags.reduce((s, d) => s + d.score, 0) / wDiags.length);
              reply += `\n관심종목 평균 퀀트 점수: ${avgScore}/100\n`;
              const best = wDiags.sort((a, b) => b.score - a.score)[0];
              const worst = wDiags.sort((a, b) => a.score - b.score)[0];
              if (best) reply += `최고: ${best.name} ${best.score}점 (${best.opinion})\n`;
              if (worst && worst.name !== best?.name) reply += `최저: ${worst.name} ${worst.score}점 (${worst.opinion})\n`;
            }
          }
          reply += `\n💡 ${benchmarkData.myReturn >= 5 ? "좋은 성과입니다! 수익 구간에서 일부 차익실현을 고려해보세요." : benchmarkData.myReturn >= 0 ? "양호합니다. 리밸런싱 시점을 확인해보세요." : "손실 구간입니다. 손절선을 점검하고 비중 조절을 고려하세요."}`;
        } else if (portfolio.length > 0) {
          reply = "포트폴리오가 있지만 벤치마크 데이터가 아직 로딩 중입니다. 잠시 후 다시 물어봐주세요.";
        } else {
          reply = "포트폴리오에 종목을 추가하면 수익률 분석, 벤치마킹, 리밸런싱 제안을 해드릴게요.\n\n홈 화면 > 포트폴리오 탭에서 종목을 추가할 수 있어요.";
        }
      } else if (msgLow.includes("이상") || msgLow.includes("anomaly") || msgLow.includes("비정상") || msgLow.includes("급등") || msgLow.includes("급락")) {
        if (anomalies.length > 0) {
          reply = `⚡ 이상 탐지 현황 (${anomalies.length}건)\n\n`;
          anomalies.slice(0, 5).forEach((a, i) => {
            const d = quickDiagnosis(a);
            reply += `${i + 1}. ${a.name} ${a.change >= 0 ? "+" : ""}${a.change}%\n`;
            reply += `   사유: ${a.anomalyReasons.join(", ")}\n`;
            reply += `   퀀트: ${d.score}점 (${d.opinion})\n\n`;
          });
          reply += `💡 이상 변동이 감지된 종목은 추가 조사 후 진입을 결정하세요. 급등 종목은 추격 매수보다 눌림목을 기다리는 것이 유리합니다.`;
        } else {
          reply = "현재 이상 탐지된 종목이 없습니다. 시장이 비교적 안정적인 상태예요.";
        }
      } else if (msgLow.includes("관심") || msgLow.includes("워치") || msgLow.includes("watch")) {
        if (watchlist.length > 0) {
          reply = `📌 관심종목 현황 (${watchlist.length}개)\n\n`;
          watchlist.forEach((w, i) => {
            const hot = hotAssets.find(h => h.symbol === w.symbol || h.symbol === w.symbolRaw);
            const d = hot ? quickDiagnosis(hot) : null;
            reply += `${i + 1}. ${w.name} — ${hot ? `${hot.change >= 0 ? "+" : ""}${hot.change}%` : "데이터 없음"}`;
            if (d) reply += ` · ${d.score}점 (${d.opinion})`;
            reply += "\n";
          });
          const avgScore = watchlist.reduce((s, w) => {
            const h = hotAssets.find(x => x.symbol === w.symbol || x.symbol === w.symbolRaw);
            return h ? s + quickDiagnosis(h).score : s;
          }, 0) / Math.max(watchlist.filter(w => hotAssets.find(h => h.symbol === w.symbol || h.symbol === w.symbolRaw)).length, 1);
          reply += `\n평균 퀀트 점수: ${Math.round(avgScore)}/100`;
        } else {
          reply = "관심종목이 비어있어요. 홈 화면에서 종목을 추가해보세요!";
        }
      } else if (msgLow.includes("리스크") || msgLow.includes("위험") || msgLow.includes("risk")) {
        const vix = marketIndices.find(i => i.symbol === "^VIX");
        const fg = fearGreed.stock?.value;
        reply = `🛡️ 리스크 점검\n\n`;
        if (vix) reply += `VIX: ${vix.price?.toFixed(1)} — ${vix.price > 30 ? "⚠️ 고변동성 경고" : vix.price > 20 ? "보통 수준" : "안정적"}\n`;
        if (fg) reply += `공포탐욕: ${fg} — ${fg <= 25 ? "극도의 공포 (역발상 매수 고려)" : fg <= 40 ? "공포 (저가 매수 기회 탐색)" : fg >= 75 ? "극도의 탐욕 (과열 경고)" : fg >= 60 ? "탐욕 (차익실현 고려)" : "중립"}\n`;
        const anomCnt = anomalies.length;
        reply += `이상 탐지: ${anomCnt}건\n`;
        if (portfolio.length > 0 && benchmarkData) {
          reply += `포트폴리오: ${benchmarkData.myReturn >= 0 ? "+" : ""}${benchmarkData.myReturn.toFixed(2)}%\n`;
        }
        let riskLevel = "보통";
        if ((vix?.price > 25) || (fg && fg <= 30) || anomCnt > 3) riskLevel = "높음";
        else if ((vix?.price < 15) && (fg && fg > 40 && fg < 70) && anomCnt === 0) riskLevel = "낮음";
        reply += `\n종합 리스크: ${riskLevel === "높음" ? "🔴" : riskLevel === "낮음" ? "🟢" : "🟡"} ${riskLevel}\n`;
        reply += `\n💡 ${riskLevel === "높음" ? "현금 비중을 확대하고 보유 종목의 손절선을 재점검하세요." : riskLevel === "낮음" ? "시장이 안정적입니다. 계획대로 투자를 이어가세요." : "일반적 리스크 수준입니다. 포지션 사이즈를 적절히 관리하세요."}`;
      } else if (msgLow.includes("비교") || msgLow.includes("compare") || msgLow.includes("vs")) {
        // 두 종목 비교
        const tokens = msgLow.replace(/vs|비교|와|과|,/g, " ").split(/\s+/).filter(Boolean);
        const found = tokens.map(t => hotAssets.find(a => a.name.toLowerCase() === t || a.symbol.toLowerCase().replace(".ks","") === t)).filter(Boolean);
        if (found.length >= 2) {
          const [a, b] = found;
          const da = quickDiagnosis(a), db = quickDiagnosis(b);
          reply = `⚖️ ${a.name} vs ${b.name}\n\n`;
          reply += `변동률: ${a.change >= 0 ? "+" : ""}${a.change}% vs ${b.change >= 0 ? "+" : ""}${b.change}%\n`;
          reply += `퀀트: ${da.score}점 (${da.opinion}) vs ${db.score}점 (${db.opinion})\n`;
          if (da.categories && db.categories) {
            da.categories.forEach((c, i) => {
              const bc = db.categories[i];
              if (bc) reply += `${c.name}: ${c.score} vs ${bc.score}\n`;
            });
          }
          const winner = da.score > db.score ? a : b;
          reply += `\n💡 퀀트 기준 ${winner.name}이(가) 더 유리한 상황입니다.`;
        } else {
          reply = "두 종목을 비교하려면 'AAPL vs MSFT' 또는 'Apple 비교 Microsoft'처럼 입력해주세요.";
        }
      } else if (msgLow.includes("섹터") || msgLow.includes("업종") || msgLow.includes("산업") || msgLow.includes("sector") || msgLow.includes("industry")) {
        // 섹터 분석
        reply = `🏭 섹터 분석\n\n`;
        const sectorMap = {};
        hotAssets.forEach(a => {
          const sector = a.sector || "기타";
          if (!sectorMap[sector]) sectorMap[sector] = [];
          sectorMap[sector].push(a);
        });
        const sectorStats = Object.entries(sectorMap).map(([sector, assets]) => {
          const avgChange = assets.reduce((s, a) => s + a.change, 0) / assets.length;
          const bestAsset = assets.sort((a, b) => b.change - a.change)[0];
          const worstAsset = assets.sort((a, b) => a.change - b.change)[0];
          return { sector, assets: assets.length, avgChange, best: bestAsset, worst: worstAsset };
        }).sort((a, b) => b.avgChange - a.avgChange);

        sectorStats.forEach((s, i) => {
          const emoji = s.avgChange >= 0 ? "📈" : "📉";
          reply += `${emoji} ${s.sector} (${s.assets}개) — 평균 ${s.avgChange >= 0 ? "+" : ""}${s.avgChange.toFixed(2)}%\n`;
          if (s.best) reply += `  최고: ${s.best.name} +${s.best.change}%\n`;
          if (s.worst && s.worst.symbol !== s.best.symbol) reply += `  최저: ${s.worst.name} ${s.worst.change}%\n`;
        });
        const topSector = sectorStats[0];
        const bottomSector = sectorStats[sectorStats.length - 1];
        reply += `\n💡 ${topSector.sector}이(가) 강세이고 ${bottomSector.sector}이(가) 약세입니다. 섹터 로테이션 기회를 살펴보세요.`;
        reply += `\n\n💬 이어서 물어보기: "기술주 추천" · "금융주 분석" · "에너지 업종"`;
      } else if (msgLow.includes("타이밍") || msgLow.includes("매매 시점") || msgLow.includes("언제 사") || msgLow.includes("entry") || msgLow.includes("timing")) {
        // 매매 타이밍 분석
        const vix = marketIndices.find(i => i.symbol === "^VIX");
        const fg = fearGreed.stock?.value;
        const sp = marketIndices.find(i => i.symbol === "^GSPC");
        const upCnt = hotAssets.filter(a => a.change > 0).length;
        const dnCnt = hotAssets.filter(a => a.change < 0).length;

        let timingScore = 50;
        if (vix) timingScore += vix.price > 30 ? 10 : vix.price > 20 ? 0 : -5;
        if (fg) timingScore += fg <= 30 ? 15 : fg <= 45 ? 10 : fg >= 75 ? -10 : 0;
        if (sp) timingScore += sp.change > 1 ? 5 : sp.change < -1 ? -5 : 0;
        timingScore += (upCnt / (upCnt + dnCnt)) > 0.6 ? 5 : (upCnt / (upCnt + dnCnt)) < 0.4 ? -5 : 0;
        timingScore = Math.max(0, Math.min(100, timingScore));

        reply = `⏰ 매매 타이밍 분석\n\n`;
        reply += `VIX: ${vix?.price?.toFixed(1)} — ${vix?.price > 30 ? "고변동 (역발상 기회)" : vix?.price > 20 ? "중간" : "안정"}\n`;
        reply += `공포탐욕: ${fg} — ${fg <= 30 ? "극도 공포 (매수 기회!)" : fg <= 45 ? "공포 (저가 매수)" : fg >= 75 ? "극도 탐욕 (조심)" : "중립"}\n`;
        reply += `시장 방향: S&P 500 ${sp?.change >= 0 ? "+" : ""}${sp?.change}% | 상승 ${upCnt} 하락 ${dnCnt}\n`;
        reply += `\n타이밍 점수: ${timingScore}/100\n`;
        reply += `\n💡 `;
        if (timingScore >= 70) {
          reply += "매수 신호가 강합니다! 관심종목 1차 진입을 시작하기 좋은 시점입니다.";
        } else if (timingScore >= 50) {
          reply += "혼합 신호입니다. 분할 매수 전략으로 진입을 시작하세요.";
        } else if (timingScore >= 30) {
          reply += "약세 신호가 우세합니다. 추가 조정을 기다리거나 매우 제한적으로 진입하세요.";
        } else {
          reply += "매도 신호가 강합니다. 기존 포지션을 정리하고 관망하세요.";
        }
        reply += `\n\n💬 이어서 물어보기: "추천 종목" · "섹터 분석" · "리스크 점검"`;
      } else if (msgLow.includes("최적화") || msgLow.includes("리밸런싱") || msgLow.includes("rebalance") || msgLow.includes("optimize")) {
        // 포트폴리오 최적화 제안
        if (portfolio.length === 0) {
          reply = "포트폴리오에 종목이 없어서 최적화 제안을 드릴 수 없습니다. 먼저 종목을 추가해주세요.";
        } else {
          reply = `🎯 포트폴리오 최적화 제안\n\n`;
          const sectorConc = {};
          let totalBuySignals = 0, totalSellSignals = 0;
          portfolio.forEach(item => {
            const hot = hotAssets.find(h => h.symbol === item.symbol || h.symbol === item.symbolRaw);
            if (hot) {
              const sector = hot.sector || "기타";
              sectorConc[sector] = (sectorConc[sector] || 0) + 1;
              const diag = quickDiagnosis(hot);
              if (diag.score >= 60) totalBuySignals++;
              else if (diag.score < 40) totalSellSignals++;
            }
          });

          reply += `현재 구성: ${portfolio.length}{t("tabs.home.items")}\n`;
          Object.entries(sectorConc).forEach(([sector, count]) => {
            const pct = (count / portfolio.length * 100).toFixed(0);
            reply += `  ${sector}: ${count}개 (${pct}%)\n`;
          });

          const maxSectorPct = Math.max(...Object.values(sectorConc).map(c => c / portfolio.length));
          if (maxSectorPct > 0.4) {
            reply += `\n⚠️ ${Object.entries(sectorConc).find(([, c]) => c / portfolio.length === maxSectorPct)[0]} 집중도가 높습니다. 분산을 권장합니다.\n`;
          }

          reply += `\n강한 신호: ${totalBuySignals}개 매수신호, ${totalSellSignals}개 약세신호\n`;
          reply += `\n💡 `;
          if (totalSellSignals > portfolio.length * 0.3) {
            reply += "약세 신호가 많습니다. 약한 종목부터 정리하고 신규 종목으로 교체를 고려하세요.";
          } else if (totalBuySignals > portfolio.length * 0.6) {
            reply += "강한 매수신호가 많습니다. 현재 포지션을 유지하거나 강한 종목에 비중을 확대하세요.";
          } else {
            reply += "포트폴리오가 균형 상태입니다. 분기별 리밸런싱으로 섹터 가중치를 조정하세요.";
          }
          reply += `\n\n💬 이어서 물어보기: "포트폴리오 현황" · "리스크 점검" · "추천 종목"`;
        }
      } else if (msgLow.includes("모멘텀") || msgLow.includes("추세") || msgLow.includes("momentum") || msgLow.includes("trend")) {
        // 모멘텀 분석
        reply = `🚀 모멘텀 분석\n\n`;
        const sorted = [...hotAssets].sort((a, b) => b.change - a.change);
        const gainers = sorted.slice(0, 5);
        const losers = sorted.slice(-5).reverse();

        reply += `📈 강한 모멘텀 (TOP 5 상승주)\n`;
        gainers.forEach((g, i) => {
          const diag = quickDiagnosis(g);
          reply += `${i + 1}. ${g.name} +${g.change}% (퀀트: ${diag.score}점)\n`;
          if (g.volRatio) reply += `   거래량: ${g.volRatio.toFixed(1)}배\n`;
        });

        reply += `\n📉 약한 모멘텀 (TOP 5 하락주)\n`;
        losers.forEach((l, i) => {
          const diag = quickDiagnosis(l);
          reply += `${i + 1}. ${l.name} ${l.change}% (퀀트: ${diag.score}점)\n`;
          if (l.volRatio) reply += `   거래량: ${l.volRatio.toFixed(1)}배\n`;
        });

        const momentumStrength = gainers.reduce((s, g) => s + g.change, 0) / gainers.length;
        reply += `\n💡 `;
        if (momentumStrength > 5) {
          reply += "상승 모멘텀이 강합니다. 하지만 추격 매수는 피하고, 조정 후 진입을 권합니다.";
        } else if (momentumStrength < -2) {
          reply += "하락 모멘텀이 우세입니다. 저점 테스트까지 기다리세요.";
        } else {
          reply += "모멘텀이 약세 상태입니다. 추세 전환 신호를 확인 후 진입하세요.";
        }
        reply += `\n\n💬 이어서 물어보기: "매매 타이밍" · "섹터 분석" · "시장 현황"`;
      } else if (msgLow.includes("배당") || msgLow.includes("가치주") || msgLow.includes("dividend") || msgLow.includes("value")) {
        // 배당/가치 분석
        reply = `💰 배당/가치주 분석\n\n`;
        const valueAssets = hotAssets.filter(a => {
          const diag = quickDiagnosis(a);
          return diag.score > 55 && a.change < 5 && a.pe && a.pe < 20;
        }).slice(0, 10);

        if (valueAssets.length > 0) {
          reply += `가치주 후보 (${valueAssets.length}개)\n`;
          valueAssets.forEach((v, i) => {
            const diag = quickDiagnosis(v);
            reply += `${i + 1}. ${v.name}\n`;
            reply += `   가격: ${fmtPrice(v.price, v.market)} | 변동: ${v.change >= 0 ? "+" : ""}${v.change}%\n`;
            if (v.pe) reply += `   PER: ${v.pe.toFixed(1)}배 | 퀀트: ${diag.score}점\n`;
          });
          reply += `\n💡 저평가 구간의 안정적인 종목들입니다. 배당 재투자로 복리 효과를 극대화하세요.`;
        } else {
          reply += `현재 저평가 가치주 후보가 부족합니다.\n시장 조정 시점까지 기다리거나, 특정 섹터의 방어주를 검토하세요.`;
        }
        reply += `\n\n💬 이어서 물어보기: "섹터 분석" · "추천 종목" · "매매 타이밍"`;
      } else if (msgLow.includes("종합") || msgLow.includes("전체분석") || msgLow.includes("overview") || msgLow.includes("진단")) {
        // 종합 진단
        const sp = marketIndices.find(i => i.symbol === "^GSPC");
        const ks = marketIndices.find(i => i.symbol === "^KS11");
        const vix = marketIndices.find(i => i.symbol === "^VIX");
        const fg = fearGreed.stock?.value;
        const upCnt = hotAssets.filter(a => a.change > 0).length;
        const dnCnt = hotAssets.filter(a => a.change < 0).length;

        reply = `🔍 시장 & 포트폴리오 종합 진단\n\n`;
        reply += `── 시장 상황 ──\n`;
        reply += `S&P 500: ${sp?.price?.toLocaleString()} (${sp?.change >= 0 ? "+" : ""}${sp?.change}%)\n`;
        reply += `코스피: ${ks?.price?.toLocaleString()} (${ks?.change >= 0 ? "+" : ""}${ks?.change}%)\n`;
        reply += `VIX: ${vix?.price?.toFixed(1)} (${vix?.price > 30 ? "고변동" : vix?.price > 20 ? "중간" : "안정"})\n`;
        reply += `공포탐욕: ${fg} (${fg <= 30 ? "극도 공포" : fg >= 75 ? "극도 탐욕" : "중립"})\n`;
        reply += `상승/하락: ${upCnt} / ${dnCnt}\n`;

        reply += `\n── 포트폴리오 상황 ──\n`;
        if (portfolio.length > 0 && benchmarkData) {
          reply += `수익률: ${benchmarkData.myReturn >= 0 ? "+" : ""}${benchmarkData.myReturn.toFixed(2)}%\n`;
          if (benchmarkData.spReturn != null) reply += `vs S&P: ${benchmarkData.alpha >= 0 ? "+" : ""}${benchmarkData.alpha.toFixed(2)}% (${benchmarkData.beatsSP ? "아웃퍼폼" : "언더퍼폼"})\n`;
        } else {
          reply += `포트폴리오가 비어있거나 로딩 중입니다.\n`;
        }

        reply += `\n── 리스크 평가 ──\n`;
        let riskLevel = "보통";
        if ((vix?.price > 25) || (fg && fg <= 30) || anomalies.length > 3) riskLevel = "높음";
        else if ((vix?.price < 15) && (fg && fg > 40 && fg < 70) && anomalies.length === 0) riskLevel = "낮음";
        reply += `종합 리스크: ${riskLevel === "높음" ? "🔴" : riskLevel === "낮음" ? "🟢" : "🟡"} ${riskLevel}\n`;
        reply += `이상 탐지: ${anomalies.length}건\n`;

        reply += `\n── 전략 제안 ──\n`;
        let strategyMsg = "";
        if (riskLevel === "높음") {
          strategyMsg = "• 현금 비중 확대\n• 강한 종목에 집중\n• 손절선 재점검";
        } else if (riskLevel === "낮음") {
          strategyMsg = "• 신규 진입 기회 활용\n• 적극적 리밸런싱\n• 성장주 비중 확대";
        } else {
          strategyMsg = "• 분할 매수 지속\n• 섹터 로테이션 검토\n• 분산투자 유지";
        }
        reply += strategyMsg;
        reply += `\n\n💬 이어서 물어보기: "추천 종목" · "리스크 점검" · "포트폴리오 현황"`;
      } else {
        reply = `안녕하세요! Zepta AI 어시스턴트입니다.\n\n이런 것들을 물어보세요:\n\n── 기본 분석 ──\n• 종목명 → "NVDA 분석해줘", "삼성전자 어때?"\n• 시장 현황 → "시장 현황", "오늘 마켓"\n• 추천 종목 → "뭐 살까?", "오늘 TOP"\n\n── 고도화 기능 ──\n• 섹터 분석 → "섹터 분석", "tech sector"\n• 매매 타이밍 → "언제 사?", "진입 타이밍"\n• 포트폴리오 최적화 → "최적화", "리밸런싱"\n• 모멘텀 분석 → "모멘텀", "추세"\n• 가치주/배당 → "가치주", "배당"\n• 종합 진단 → "종합분석", "전체 진단"\n\n── 기타 ──\n• 포트폴리오 → "내 자산", "수익률"\n• 이상 탐지 → "급등락", "비정상"\n• 관심종목 → "관심종목"\n• 리스크 점검 → "리스크", "위험도"\n• 종목 비교 → "AAPL vs MSFT"`;
      }
      setAiMessages(prev => [...prev, { role: "ai", text: reply }]);
      setAiLoading(false);
    }, 500);
  }, [hotAssets, watchlist, dailyPicks, marketIndices, fearGreed, anomalies, benchmarkData, portfolio, extendedHours]);

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
    // Hot assets 병렬 fetch (배치 분할)
    const hotResults = [];
    const hotChunkSize = 30;
    for (let ci = 0; ci < hots.length; ci += hotChunkSize) {
      const hotChunk = hots.slice(ci, ci + hotChunkSize);
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
              hotResults.push({ ...h, price: cur, change: +( ((cur - prev) / prev) * 100 ).toFixed(2), symbolRaw: h.symbol });
            }
          }
        }
      } catch {}
    }
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

    // ── 공포/탐욕 지수 ──
    const fgData = { stock: null, crypto: null };
    // CNN Fear & Greed (via proxy API)
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
    setFearGreed(fgData);

    // ── 장외(프리/포스트마켓) 가격 — 전체 US 종목 + 관심종목 ──
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
    const extSymArr = [...extSymSet];
    const chunkSize = 40;
    for (let ci = 0; ci < extSymArr.length; ci += chunkSize) {
      const chunk = extSymArr.slice(ci, ci + chunkSize).join(",");
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
    }
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

    // ── 오늘의 종목 추천 (핵심 50종목 스캔) ──
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

    setMarketLoading(false);
    fetchingRef.current = false;
  }, []);

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
        const rawDate = String(e.date || "");
        const dateOnly = rawDate.slice(0, 10); // "YYYY-MM-DD"
        const hasTime = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(rawDate);
        let d = null;
        if (hasTime) {
          // API 시간 정보 활용 — 공백을 T 로 치환 + UTC 표시 Z 추가
          const iso = rawDate.replace(" ", "T") + (rawDate.endsWith("Z") ? "" : "Z");
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
        const evtName = e.event.replace(/\(.*?\)\s*/g, "").trim();
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

  // 경제 캘린더 탭 진입 시 즉시 로드 + 발표 시간대 자동 갱신
  useEffect(() => {
    if (tab !== "econ-calendar") return;
    fetchEconCalendar();
    // 발표 시간대(KST 21:00~02:00)에는 30초 간격, 그 외 5분 간격 자동 갱신
    const hourKST = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" })).getHours();
    const isAnnouncementWindow = hourKST >= 21 || hourKST <= 2;
    const interval = isAnnouncementWindow ? 30000 : 300000;
    const iv = setInterval(fetchEconCalendar, interval);
    return () => clearInterval(iv);
  }, [tab]);

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
  const generateStrategyAlerts = useCallback((candleMap) => {
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
  }, [STRATEGY_NAME_MAP, settings]);

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
        setTgStatus("✅ 자동 알림 전송 완료");
      } catch { setTgStatus("❌ 텔레그램 전송 실패"); }
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

  useEffect(() => { if (tab === "news") fetchNews(); }, [tab]);

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
      if (!isInputFocused) {
        if (e.key === "1") setTab("home");
        else if (e.key === "2") setTab("screener");
        else if (e.key === "3") setTab("auto-trading");
        else if (e.key === "4") setTab("portfolio");
        else if (e.key === "5") setTab("news");
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  // ── 스크롤 감지 (맨 위로 버튼) ──
  useEffect(() => {
    const handler = () => setShowScrollTop(window.scrollY > 300);
    window.addEventListener("scroll", handler, { passive: true });
    return () => window.removeEventListener("scroll", handler);
  }, []);


  // ── 포트폴리오 동기화 ─────────────────────────────────────────
  const syncUpload = useCallback(async () => {
    if (!syncPin || syncPin.length < 4) { setSyncStatus("❌ PIN 4자리 이상 필요"); return; }
    setSyncStatus("⏳ 업로드 중...");
    try {
      const r = await fetch(`/api/sync?pin=${encodeURIComponent(syncPin)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ portfolio, settings: { ...settings, syncPin } }),
      });
      if (r.ok) setSyncStatus("✅ 동기화 완료");
      else setSyncStatus("❌ 업로드 실패");
    } catch (e) { setSyncStatus(`❌ ${e.message}`); }
  }, [syncPin, portfolio, settings]);

  const syncDownload = useCallback(async () => {
    if (!syncPin || syncPin.length < 4) { setSyncStatus("❌ PIN 4자리 이상 필요"); return; }
    setSyncStatus("⏳ 다운로드 중...");
    try {
      const r = await fetch(`/api/sync?pin=${encodeURIComponent(syncPin)}`);
      if (r.ok) {
        const data = await r.json();
        if (data.portfolio?.length) { setPortfolio(data.portfolio); savePortfolio(data.portfolio); }
        if (data.settings) { setSettings(p => ({ ...p, ...data.settings })); saveSettings({ ...settings, ...data.settings }); }
        setSyncStatus(`✅ 동기화 완료 (${data.updatedAt ? new Date(data.updatedAt).toLocaleString("ko-KR") : ""})`);
      } else setSyncStatus("❌ 데이터 없음");
    } catch (e) { setSyncStatus(`❌ ${e.message}`); }
  }, [syncPin, settings]);

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

  const filtered = results.filter(a => filterMarket === "all" || a.market === filterMarket);

  const pStats = portfolio.reduce((acc, item) => {
    const cur = portfolioPrices[item.symbol];
    const invested = item.qty * item.avgPrice;
    return {
      invested: acc.invested + invested,
      current:  acc.current + (cur ? item.qty * cur : 0),
      pnl:      acc.pnl    + (cur ? item.qty * cur - invested : 0),
      hasPrices: acc.hasPrices || !!cur,
    };
  }, { invested: 0, current: 0, pnl: 0, hasPrices: false });

  // 뉴스 카테고리 필터 + 정렬
  const filteredNews = useMemo(() => {
    if (newsCat === "all") return newsItems;
    return newsItems.filter(n => {
      const title = (n.title || "").toLowerCase();
      const tags = (n.tags || []).map(t => t.toLowerCase()).join(" ");
      const src = (n.source || "").toLowerCase();
      const txt = title + " " + tags + " " + src;
      if (newsCat === "crypto") return txt.match(/crypto|bitcoin|btc|ethereum|eth|solana|sol|코인|가상화폐|비트코인|이더리움|크립토|coingecko|트렌딩/);
      if (newsCat === "kr") return txt.match(/코스피|코스닥|한국|삼성|현대|sk|lg|카카오|네이버|한화|포스코|🇰🇷/);
      if (newsCat === "us") return !txt.match(/crypto|bitcoin|btc|ethereum|eth|solana|코인|가상화폐|비트코인|코스피|코스닥/) || txt.match(/s&p|nasdaq|nyse|미국|뉴욕증시|🇺🇸/);
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

  // ── 인증 로딩 중이면 스플래시 (hooks 뒤에 배치해야 hook 수 일관) ──
  if (authLoading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: C.bg }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: "48px", marginBottom: "12px" }}>🐋</div>
          <div style={{ color: C.text2, fontSize: "18px" }}>로딩 중...</div>
        </div>
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
        @keyframes fabPulse { 0%,100%{box-shadow:0 4px 20px rgba(59,130,246,0.4)} 50%{box-shadow:0 4px 28px rgba(59,130,246,0.7)} }
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
        /* 모바일 하단탭 존재 시 상단 햄버거 숨김 */
        @media (max-width: 640px) {
          .mobile-hamburger { display: none !important; }
        }
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
          /* 하단 ticker 모바일 최적화 */
          [style*="position: fixed"][style*="bottom: 0"] { padding: 4px 0 !important; }
          [style*="position: fixed"][style*="bottom: 0"] span { font-size: 11px !important; gap: 4px !important; }
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
        else if (tab === "news") await fetchNews();
        else window.location.reload();
      }}>
      <main className="px-4 py-4 pb-8 sm:px-6 sm:py-6 sm:pb-10" style={{ maxWidth: "1400px", margin: "0 auto" }}>

        {/* ═══════════════════════════════════════════════════════════
            TAB: 홈 (토스 스타일 — 깔끔하고 정보 밀도 최적화)
        ═══════════════════════════════════════════════════════════ */}
        {tab === "home" && (
          <div className="tab-content">
            {/* 2컬럼 그리드 (데스크톱) / 1컬럼 (모바일) */}
            <div className="home-grid">
            <div className="home-left card-stagger" style={{ display: "flex", flexDirection: "column", gap: "20px" }}>

            {/* ── 개인화 인사 + 스트릭 ─── */}
            {/* ★ 비로그인 유저는 인사 카드 스킵 — 빈 그리팅 어색함 해소 + 헤로/추천이 첫 카드로 */}
            {user && (() => {
              const hour = new Date().getHours();
              const greetText = hour < 12 ? (t("tabs.home.goodMorning") || "좋은 아침이에요") : hour < 18 ? (t("tabs.home.goodAfternoon") || "좋은 오후에요") : (t("tabs.home.goodEvening") || "좋은 저녁이에요");
              const displayName = user?.user_metadata?.nickname || user?.email?.split("@")[0] || "";
              // 스트릭 계산
              const todayKey = new Date().toISOString().slice(0, 10);
              const streakData = (() => {
                try {
                  const stored = JSON.parse(localStorage.getItem("zepta:streak") || "{}");
                  if (stored.lastDate === todayKey) return stored;
                  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
                  const newStreak = stored.lastDate === yesterday ? (stored.count || 0) + 1 : 1;
                  const updated = { lastDate: todayKey, count: newStreak };
                  localStorage.setItem("zepta:streak", JSON.stringify(updated));
                  syncUserDataToSupabase();
                  return updated;
                } catch { return { count: 1 }; }
              })();
              return (
                <div className="hero-gradient" style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "20px 24px", borderRadius: "24px",
                  border: `1px solid ${C.blue}18`,
                  boxShadow: `0 4px 20px rgba(0,0,0,${C.isDark ? 0.2 : 0.08}), inset 0 1px 0 ${C.blue}20`,
                  overflow: "hidden",
                  position: "relative",
                }}>
                  <div>
                    <div style={{ fontSize: "19px", fontWeight: 800, color: C.text1, marginBottom: "4px", letterSpacing: "-0.5px" }}>
                      {displayName ? `${displayName}님, ${greetText}` : greetText} 👋
                    </div>
                    <div style={{ fontSize: "14px", color: C.text3, fontWeight: 500 }}>
                      {new Date().toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "long" })}
                    </div>
                  </div>
                  <div style={{
                    display: "flex", alignItems: "center", gap: "8px",
                    padding: "8px 16px", borderRadius: "12px",
                    background: streakData.count > 3
                      ? `linear-gradient(135deg, ${C.orange}30 0%, #FF6B3520 50%, ${C.red}20 100%)`
                      : `${C.orange}20`,
                    border: `1px solid ${streakData.count > 3 ? C.red : C.orange}35`,
                    boxShadow: `0 0 12px ${streakData.count > 3 ? C.red : C.orange}30`,
                    animation: streakData.count > 0 ? "streakPulse 2s ease-in-out infinite" : "none",
                  }}>
                    <span style={{ fontSize: "20px", display: "inline-block" }}>🔥</span>
                    <div>
                      <div style={{ fontSize: "18px", fontWeight: 800, color: streakData.count > 3 ? C.red : C.orange, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{streakData.count}</div>
                      <div style={{ fontSize: "12px", color: C.text3, fontWeight: 600 }}>{t("tabs.home.streakDays") || "일 연속"}</div>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* ── 비로그인 유저 웰컴 배너 — 가입 유도 */}
            {!user && (
              <div style={{
                background: `linear-gradient(135deg, ${C.blueBg} 0%, ${C.purpleBg} 50%, ${C.blueBg} 100%)`,
                borderRadius: "20px", padding: isMobile ? "20px" : "28px 32px",
                border: `1px solid ${C.purple}20`,
                boxShadow: `0 4px 24px rgba(155,111,255,0.12)`,
                position: "relative", overflow: "hidden",
              }}>
                <div style={{ position: "absolute", top: "-30px", right: "-20px", fontSize: "100px", opacity: 0.06 }}>🚀</div>
                <h2 style={{ fontSize: isMobile ? "20px" : "24px", fontWeight: 900, color: C.text1, marginBottom: "8px" }}>
                  AI가 찾아주는 최적의 매수 타점
                </h2>
                <p style={{ fontSize: "15px", color: C.text2, marginBottom: "16px", lineHeight: 1.5 }}>
                  33개 퀀트 전략으로 주식·코인을 자동 분석합니다. 무료로 시작하세요.
                </p>
                <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                  <button onClick={() => setShowAuthModal(true)} style={{
                    padding: "12px 28px", borderRadius: "12px", fontSize: "15px", fontWeight: 800,
                    background: `linear-gradient(135deg, ${C.blue}, ${C.purple})`,
                    color: "#fff", border: "none", cursor: "pointer",
                    boxShadow: `0 4px 16px ${C.blue}30`,
                    transition: "all 0.2s",
                  }}>무료 가입하기</button>
                  <button onClick={() => setTab("screener")} style={{
                    padding: "12px 28px", borderRadius: "12px", fontSize: "15px", fontWeight: 700,
                    background: `${C.card2}`, color: C.text2,
                    border: `1px solid ${C.border}`,
                    cursor: "pointer", transition: "all 0.2s",
                  }}>둘러보기</button>
                </div>
              </div>
            )}

            {/* ── 모바일 빠른 접근 버튼 ─── */}
            {isMobile && (
              <div style={{
                display: "flex", gap: "8px", overflowX: "auto",
                scrollbarWidth: "none", msOverflowStyle: "none",
                WebkitOverflowScrolling: "touch", paddingBottom: "4px",
              }} className="hscroll">
                {[
                  { icon: "🔍", label: "스크리너", tab: "screener" },
                  { icon: "🤖", label: "AI매매", tab: "auto-trading" },
                  { icon: "📊", label: "전략분석", tab: "strategy" },
                  { icon: "📰", label: "뉴스", tab: "news" },
                  { icon: "📅", label: "캘린더", tab: "econ-calendar" },
                  { icon: "🎯", label: "백테스트", tab: "backtest" },
                ].map((item) => (
                  <button key={item.tab} onClick={() => setTab(item.tab)} style={{
                    display: "flex", flexDirection: "column", alignItems: "center", gap: "6px",
                    padding: "12px 16px", borderRadius: "16px", border: "none",
                    background: `linear-gradient(135deg, ${C.card} 0%, ${C.card2} 100%)`,
                    boxShadow: `0 2px 8px rgba(0,0,0,${C.isDark ? '0.3' : '0.08'})`,
                    cursor: "pointer", flexShrink: 0, minWidth: "72px",
                    transition: "all 0.15s ease", color: C.text1, fontWeight: 600,
                  }}
                  onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = `0 4px 16px rgba(0,0,0,${C.isDark ? '0.4' : '0.12'})`; }}
                  onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = `0 2px 8px rgba(0,0,0,${C.isDark ? '0.3' : '0.08'})`; }}>
                    <span style={{ fontSize: "24px" }}>{item.icon}</span>
                    <span style={{ fontSize: "12px", fontWeight: 700, color: C.text2, whiteSpace: "nowrap" }}>{item.label}</span>
                  </button>
                ))}
              </div>
            )}

            {/* ── 마켓 브리핑 (3×2 그리드 — 6개 지수 동등 표시) ─── */}
            {(() => {
              const sp = marketIndices.find(i => i.symbol === "^GSPC");
              const nq = marketIndices.find(i => i.symbol === "^IXIC");
              const dj = marketIndices.find(i => i.symbol === "^DJI");
              const ks = marketIndices.find(i => i.symbol === "^KS11");
              const kq = marketIndices.find(i => i.symbol === "^KQ11");
              const fx = marketIndices.find(i => i.symbol === "USDKRW=X");
              const upCount = hotAssets.filter(h => h.change > 0).length;
              const dnCount = hotAssets.filter(h => h.change < 0).length;
              const total = Math.max(upCount + dnCount, 1);
              const upPct = Math.round((upCount / total) * 100);
              const fgVal = fearGreed.stock?.value;
              const fgColor = fgVal ? (fgVal <= 25 ? C.red : fgVal <= 40 ? "#FF8C42" : fgVal <= 60 ? C.yellow : fgVal <= 75 ? C.green : C.green) : C.text3;
              const fgLabel = fgVal ? (fgVal <= 25 ? t("tabs.home.extremeFear") || "극도의 공포" : fgVal <= 40 ? t("tabs.home.fear") || "공포" : fgVal <= 60 ? t("tabs.home.neutral") || "중립" : fgVal <= 75 ? t("tabs.home.greed") || "탐욕" : t("tabs.home.extremeGreed") || "극도의 탐욕") : "—";

              const indexCards = [
                { idx: sp, symbol: "^GSPC", name: "S&P 500", flag: "🇺🇸", market: "us" },
                { idx: nq, symbol: "^IXIC", name: "NASDAQ", flag: "🇺🇸", market: "us" },
                { idx: dj, symbol: "^DJI", name: t("tabs.home.dowLabel") || "다우존스", flag: "🇺🇸", market: "us" },
                { idx: ks, symbol: "^KS11", name: t("tabs.home.kospiLabel") || "코스피", flag: "🇰🇷", market: "kr" },
                { idx: kq, symbol: "^KQ11", name: t("tabs.home.kosdaqLabel") || "코스닥", flag: "🇰🇷", market: "kr" },
                { idx: fx, symbol: "USDKRW=X", name: "KRW/USD", flag: "💱", market: "fx" },
              ];

              return (
                <div style={{
                  background: C.isDark
                    ? `linear-gradient(135deg, ${C.card} 0%, ${C.card}ee 50%, ${C.card2}88 100%)`
                    : C.card,
                  borderRadius: "20px", overflow: "hidden",
                  border: `1px solid ${C.isDark ? `${C.border}30` : `${C.border}60`}`,
                  boxShadow: `0 4px 24px rgba(0,0,0,${C.isDark ? 0.3 : 0.08}), inset 0 1px 0 ${C.border}15`,
                  backdropFilter: "blur(12px)",
                  WebkitBackdropFilter: "blur(12px)",
                  position: "relative",
                }}>
                  {/* 상단 선 */}
                  <div style={{
                    position: "absolute", top: 0, left: 0, right: 0, height: "1px",
                    background: `linear-gradient(90deg, transparent 0%, ${C.blue}40 50%, transparent 100%)`,
                  }} />
                  <div style={{ padding: "20px 24px" }}>
                    {/* 헤더 */}
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        <span style={{ fontSize: "16px", color: C.text1, fontWeight: 800, letterSpacing: "-0.5px" }}>{t("tabs.home.marketBriefing")}</span>
                        {marketIndices.length > 0 && (
                          <span style={{ display: "inline-flex", alignItems: "center", gap: "3px", padding: "2px 7px", borderRadius: "6px", background: `${C.green}12`, fontSize: "12px", fontWeight: 700, color: C.green }}>
                            <span style={{ width: "4px", height: "4px", borderRadius: "50%", background: C.green, animation: "livePulse 1.5s ease-in-out infinite" }} /> LIVE
                          </span>
                        )}
                      </div>
                      <div style={{ display: "flex", gap: "8px" }}>
                        <button
                          onClick={() => {
                            if (navigator.share) {
                              navigator.share({
                                title: "Zepta 마켓 브리핑",
                                text: "실시간 글로벌 시장 현황을 확인하세요",
                                url: window.location.href
                              }).catch(() => {});
                            } else {
                              navigator.clipboard.writeText(window.location.href);
                              showToast("링크가 복사되었습니다", "success");
                            }
                          }}
                          style={{
                            background: "none", border: "none", fontSize: "16px", color: C.text3,
                            cursor: "pointer", fontWeight: 500, padding: "4px 8px", borderRadius: "6px",
                            transition: "all .2s",
                          }}
                          onMouseEnter={e => { e.currentTarget.style.background = `${C.blue}15`; e.currentTarget.style.color = C.blue; }}
                          onMouseLeave={e => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = C.text3; }}
                        >
                          📤
                        </button>
                        <button onClick={fetchMarketOverview} disabled={marketLoading} style={{
                          background: "none", border: "none", fontSize: "14px", color: C.text3, cursor: "pointer", fontWeight: 500, padding: "2px 6px",
                        }}>{marketLoading ? "..." : "↻"}</button>
                      </div>
                    </div>

                    {/* 3×2 그리드 (데스크톱) / 수평 스크롤 (모바일): 6개 지수 카드 */}
                    <div style={{
                      display: isMobile ? "flex" : "grid",
                      gridTemplateColumns: !isMobile ? "repeat(3, 1fr)" : undefined,
                      gap: isMobile ? "10px" : "12px",
                      overflowX: isMobile ? "auto" : "visible",
                      scrollSnapType: isMobile ? "x mandatory" : "none",
                      WebkitOverflowScrolling: "touch",
                      paddingBottom: isMobile ? "8px" : "0",
                      scrollbarWidth: "none",
                      msOverflowStyle: "none",
                      marginBottom: "14px",
                    }} className="hscroll">
                      {marketLoading ? (
                        // 스켈레톤 로더 표시
                        Array.from({ length: 6 }).map((_, i) => (
                          <div key={`skeleton-${i}`} style={{
                            padding: "14px 16px",
                            borderRadius: "16px",
                            background: C.card2,
                            minWidth: isMobile ? "140px" : undefined,
                            flexShrink: isMobile ? 0 : undefined,
                          }}>
                            <Skeleton width="80px" height="12px" />
                            <div style={{ marginTop: "10px" }}>
                              <Skeleton width="100%" height="24px" />
                            </div>
                            <div style={{ marginTop: "6px" }}>
                              <Skeleton width="60px" height="16px" />
                            </div>
                          </div>
                        ))
                      ) : (
                        indexCards.map((item) => {
                        const isUp = item.idx?.change >= 0;
                        return (
                          <div
                            key={item.symbol}
                            onClick={() => item.idx && setChartAsset({ symbol: item.idx.symbol, name: item.name, market: item.market, symbolRaw: item.idx.symbol })}
                            style={{
                              cursor: item.idx ? "pointer" : "default",
                              padding: "14px 16px",
                              borderRadius: "16px",
                              background: `${isUp ? C.green : C.red}08`,
                              borderLeft: `3px solid ${isUp ? C.green : C.red}`,
                              border: `1px solid ${isUp ? C.green : C.red}18`,
                              borderLeftWidth: "3px",
                              transition: "all .2s ease",
                              position: "relative",
                              overflow: "hidden",
                              minWidth: isMobile ? "140px" : undefined,
                              flexShrink: isMobile ? 0 : undefined,
                              scrollSnapAlign: isMobile ? "start" : undefined,
                            }}
                            onMouseEnter={(e) => {
                              if (item.idx) {
                                e.currentTarget.style.transform = "translateY(-3px)";
                                e.currentTarget.style.background = `${isUp ? C.green : C.red}12`;
                                e.currentTarget.style.boxShadow = `0 6px 20px ${isUp ? C.green : C.red}25, inset 0 1px 0 ${isUp ? C.green : C.red}10`;
                              }
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.transform = "translateY(0)";
                              e.currentTarget.style.background = `${isUp ? C.green : C.red}08`;
                              e.currentTarget.style.boxShadow = "none";
                            }}
                          >
                            <div style={{ fontSize: "12px", color: C.text3, fontWeight: 600, marginBottom: "7px" }}>
                              {item.flag} {item.name}
                            </div>
                            <div style={{
                              fontSize: "28px",
                              fontWeight: 800,
                              color: C.text1,
                              letterSpacing: "-0.5px",
                              marginBottom: "3px",
                              lineHeight: 1,
                            }}>
                              {item.idx ? (
                                item.symbol === "USDKRW=X"
                                  ? `₩${Math.round(item.idx.price).toLocaleString()}`
                                  : item.idx.price?.toLocaleString(undefined, { maximumFractionDigits: 0 })
                              ) : "—"}
                            </div>
                            <div style={{
                              fontSize: "16px",
                              fontWeight: 800,
                              color: isUp ? C.green : C.red,
                              letterSpacing: "-0.3px",
                            }}>
                              {item.idx ? `${isUp ? "+" : ""}${item.idx.change}%` : "—"}
                            </div>
                          </div>
                        );
                      })
                      )}
                    </div>

                    {/* 마켓 한줄 요약 */}
                    {marketIndices.length > 0 && (() => {
                      const sp = marketIndices.find(i => i.symbol === "^GSPC");
                      const nq = marketIndices.find(i => i.symbol === "^IXIC");
                      const spChg = sp?.change || 0;
                      const nqChg = nq?.change || 0;
                      const avgChg = (spChg + nqChg) / 2;
                      const sentiment = avgChg > 0.5 ? "강세" : avgChg > 0 ? "소폭 상승" : avgChg > -0.5 ? "소폭 하락" : "약세";
                      const emoji = avgChg > 0.5 ? "🚀" : avgChg > 0 ? "📈" : avgChg > -0.5 ? "📉" : "⚠️";
                      return (
                        <div style={{
                          padding: "12px 16px", borderRadius: "12px", fontSize: "14px",
                          background: `linear-gradient(90deg, ${avgChg >= 0 ? C.greenBg : C.redBg} 0%, transparent 100%)`,
                          color: C.text2, fontWeight: 600,
                          borderLeft: `3px solid ${avgChg >= 0 ? C.green : C.red}`,
                          marginBottom: "14px",
                        }}>
                          {emoji} 오늘 미국 증시는 <span style={{ color: avgChg >= 0 ? C.green : C.red, fontWeight: 800 }}>{sentiment}</span> 흐름
                          {sp && <span> · S&P 500 {spChg >= 0 ? "+" : ""}{spChg.toFixed(2)}%</span>}
                        </div>
                      );
                    })()}

                    {/* 하단: 등락 바 + 투자심리 */}
                    <div style={{ display: "flex", alignItems: "center", gap: "16px", paddingTop: "16px", borderTop: `1px solid ${C.border}15` }}>
                      {/* 등락 바 */}
                      <div style={{ flex: 1, display: "flex", alignItems: "center", gap: "8px" }}>
                        <span style={{ fontSize: "12px", fontWeight: 700, color: C.green, minWidth: "32px" }}>{upCount}↑</span>
                        <div style={{ flex: 1, height: "6px", borderRadius: "4px", background: C.card2, overflow: "hidden", display: "flex", boxShadow: `inset 0 1px 2px rgba(0,0,0,0.2)` }}>
                          <div style={{ width: `${upPct}%`, background: C.green, borderRadius: "4px 0 0 3px", transition: "width .5s" }} />
                          <div style={{ flex: 1, background: C.red, borderRadius: "0 3px 3px 0" }} />
                        </div>
                        <span style={{ fontSize: "12px", fontWeight: 700, color: C.red, minWidth: "32px", textAlign: "right" }}>{dnCount}↓</span>
                      </div>
                      {/* 투자심리 배지 — 더 큰 숫자 + 글로우 */}
                      {fgVal && (
                        <div style={{
                          display: "flex", flexDirection: "column", alignItems: "center", gap: "2px",
                          padding: "8px 14px", borderRadius: "12px",
                          background: `${fgColor}15`,
                          border: `1px solid ${fgColor}30`,
                          boxShadow: `0 0 12px ${fgColor}25, inset 0 1px 0 ${fgColor}15`,
                          minWidth: "80px",
                        }}>
                          <span style={{ fontSize: "24px", fontWeight: 900, color: fgColor, lineHeight: 1, letterSpacing: "-0.5px" }}>{fgVal}</span>
                          <span style={{ fontSize: "12px", fontWeight: 700, color: fgColor, opacity: 0.9 }}>{fgLabel}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* ── AI 시장 한줄 인사이트 (공유 유도 → 바이럴 유입) ─── */}
            {marketIndices.length > 0 && (() => {
              const sp = marketIndices.find(i => i.symbol === "^GSPC");
              const nq = marketIndices.find(i => i.symbol === "^IXIC");
              const ks = marketIndices.find(i => i.symbol === "^KS11");
              const spChg = sp?.change || 0;
              const nqChg = nq?.change || 0;
              const insights = [];
              if (Math.abs(spChg) > 1.5) insights.push(`S&P 500이 ${spChg > 0 ? "+" : ""}${spChg.toFixed(1)}% ${spChg > 0 ? "급등" : "급락"}했습니다. ${spChg > 0 ? "기술주 주도의 강세장이 지속" : "투자 심리 위축에 주의"}이 필요합니다.`);
              else if (Math.abs(nqChg) > 2) insights.push(`나스닥이 ${nqChg > 0 ? "+" : ""}${nqChg.toFixed(1)}% ${nqChg > 0 ? "상승" : "하락"}하며 ${nqChg > 0 ? "AI·반도체 섹터가 주도" : "성장주 약세가 뚜렷"}합니다.`);
              else insights.push(`미국 증시가 ${Math.abs(spChg) < 0.3 ? "보합권에서 움직이고 있습니다. 방향성 확인이 필요" : spChg > 0 ? "소폭 상승하며 안정적 흐름을 유지" : "소폭 하락하며 관망세가 짙어지고 있"}합니다.`);
              if (ks) {
                const ksChg = ks.change || 0;
                insights.push(`코스피 ${ksChg >= 0 ? "+" : ""}${ksChg.toFixed(1)}% · ${ksChg > 1 ? "외국인 순매수 주도 강세" : ksChg < -1 ? "외국인 매도 압력 상승" : "기관·외국인 혼조세 지속"}`);
              }
              const shareText = `[Zepta AI 인사이트] ${insights[0]} ${insights[1] || ""}\n\nhttps://zepta.app`;

              return (
                <div style={{
                  background: `linear-gradient(135deg, ${C.isDark ? '#0A1628' : '#F0F4FF'} 0%, ${C.isDark ? '#141024' : '#F5F0FF'} 100%)`,
                  borderRadius: "16px", padding: isMobile ? "16px" : "18px 20px",
                  border: `1px solid ${C.purple}12`,
                  position: "relative", overflow: "hidden",
                }}>
                  <div style={{ position: "absolute", bottom: "-15px", right: "10px", fontSize: "60px", opacity: 0.04, pointerEvents: "none" }}>🤖</div>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px" }}>
                    <div style={{
                      width: "28px", height: "28px", borderRadius: "8px",
                      background: `linear-gradient(135deg, ${C.blue}25, ${C.purple}20)`,
                      display: "flex", alignItems: "center", justifyContent: "center", fontSize: "14px",
                    }}>🤖</div>
                    <span style={{ fontWeight: 800, fontSize: "14px", color: C.text1 }}>AI 시장 인사이트</span>
                    <span style={{ fontSize: "12px", color: C.text3, marginLeft: "auto" }}>방금 업데이트</span>
                  </div>
                  {insights.map((txt, i) => (
                    <div key={i} style={{
                      fontSize: "14px", color: i === 0 ? C.text1 : C.text2,
                      fontWeight: i === 0 ? 600 : 500, lineHeight: 1.5,
                      marginBottom: i < insights.length - 1 ? "6px" : "0",
                    }}>{txt}</div>
                  ))}
                  <div style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
                    <button onClick={() => {
                      if (navigator.share) navigator.share({ title: "Zepta AI 인사이트", text: shareText });
                      else { navigator.clipboard?.writeText(shareText); }
                    }} style={{
                      padding: "6px 14px", borderRadius: "8px", fontSize: "12px", fontWeight: 700,
                      background: `${C.blue}12`, color: C.blue, border: `1px solid ${C.blue}20`,
                      cursor: "pointer", transition: "all .15s",
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = `${C.blue}20`}
                    onMouseLeave={e => e.currentTarget.style.background = `${C.blue}12`}
                    >공유하기 📤</button>
                    <button onClick={() => setTab("news")} style={{
                      padding: "6px 14px", borderRadius: "8px", fontSize: "12px", fontWeight: 700,
                      background: `${C.card2}60`, color: C.text2, border: `1px solid ${C.border}20`,
                      cursor: "pointer", transition: "all .15s",
                    }}>뉴스 더보기 →</button>
                  </div>
                </div>
              );
            })()}

            {/* ── 데일리 투자 챌린지 (XP 누적 시스템 연동) ─── */}
            {(() => {
              const todayKey = new Date().toISOString().slice(0, 10);
              const uid = user?.id?.slice(0, 8) || "anon";
              const challenges = [
                { id: "check-market", icon: "📊", title: "마켓 체크", desc: "마켓 브리핑 확인", points: 10, tab: null },
                { id: "run-screener", icon: "🔍", title: "스크리닝", desc: "스크리너 1회 실행", points: 20, tab: "screener" },
                { id: "read-news", icon: "📰", title: "뉴스 읽기", desc: "뉴스 탭 확인", points: 10, tab: "news" },
                { id: "check-strategy", icon: "🧠", title: "전략 분석", desc: "전략 패널 확인", points: 15, tab: "strategy" },
              ];
              let completed = [];
              let xpGrantedToday = [];
              try {
                const s = JSON.parse(localStorage.getItem("zepta:daily-quest") || "{}");
                if (s.date === todayKey) { completed = s.done || []; xpGrantedToday = s.xpGranted || []; }
              } catch {}

              // 마켓 브리핑 자동 완료 + XP 적립
              if (!completed.includes("check-market")) {
                completed = [...completed, "check-market"];
                if (!xpGrantedToday.includes("check-market")) {
                  addXp(uid, 10, "데일리 미션: 마켓 체크", syncUserDataToSupabase);
                  xpGrantedToday = [...xpGrantedToday, "check-market"];
                }
                try { localStorage.setItem("zepta:daily-quest", JSON.stringify({ date: todayKey, done: completed, xpGranted: xpGrantedToday })); syncUserDataToSupabase(); } catch {}
              }

              const totalPoints = challenges.reduce((s, c) => s + (completed.includes(c.id) ? c.points : 0), 0);
              const maxPoints = challenges.reduce((s, c) => s + c.points, 0);
              const pct = Math.round((totalPoints / maxPoints) * 100);

              // 누적 XP 표시
              const xpData = readTotalXp(uid);
              const xpInfo = getXpInfo(xpData.total);

              return (
                <div style={{
                  background: `linear-gradient(135deg, ${C.card} 0%, ${C.isDark ? '#0D1520' : '#F8FAFF'} 100%)`,
                  borderRadius: "20px", padding: isMobile ? "16px" : "20px",
                  border: `1px solid ${C.blue}15`,
                  position: "relative", overflow: "hidden",
                }}>
                  <div style={{ position: "absolute", top: "-20px", right: "-10px", fontSize: "80px", opacity: 0.04, pointerEvents: "none" }}>🎯</div>

                  {/* 헤더: 미션 타이틀 + XP 정보 */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <span style={{ fontSize: "18px" }}>🎯</span>
                      <span style={{ fontWeight: 800, fontSize: "16px", color: C.text1 }}>오늘의 투자 미션</span>
                    </div>
                    <button onClick={() => setTab("profile")} style={{
                      display: "flex", alignItems: "center", gap: "4px",
                      fontSize: "12px", fontWeight: 700, padding: "4px 10px", borderRadius: "10px",
                      background: `${xpInfo.tier.color}15`, color: xpInfo.tier.color,
                      border: "none", cursor: "pointer",
                    }}>
                      <span>{xpInfo.tier.icon}</span>
                      <span>Lv.{xpInfo.level}</span>
                      <span style={{ color: C.text3, fontWeight: 500 }}>·</span>
                      <span style={{ color: C.blue }}>{xpData.total} XP</span>
                    </button>
                  </div>

                  {/* 오늘 진행률 */}
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
                    <div style={{ flex: 1, height: "4px", borderRadius: "4px", background: `${C.border}30`, overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${pct}%`, borderRadius: "4px",
                        background: pct === 100 ? C.green : `linear-gradient(90deg, ${C.blue}, ${C.purple})`,
                        transition: "width .5s ease",
                      }} />
                    </div>
                    <span style={{ fontSize: "12px", fontWeight: 700, color: pct === 100 ? C.green : C.text3, whiteSpace: "nowrap" }}>
                      {totalPoints}/{maxPoints}
                    </span>
                  </div>

                  {/* 퀘스트 목록 */}
                  <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4, 1fr)", gap: "8px" }}>
                    {challenges.map(c => {
                      const done = completed.includes(c.id);
                      return (
                        <button key={c.id} onClick={() => {
                          if (c.tab && !done) {
                            setTab(c.tab);
                            const newDone = [...completed, c.id];
                            const newXpGranted = [...xpGrantedToday];
                            if (!newXpGranted.includes(c.id)) {
                              addXp(uid, c.points, `데일리 미션: ${c.title}`, syncUserDataToSupabase);
                              newXpGranted.push(c.id);
                            }
                            // 올클리어 보너스 확인
                            const allDone = challenges.every(ch => newDone.includes(ch.id));
                            if (allDone && !newXpGranted.includes("all-clear")) {
                              addXp(uid, XP_REWARDS.daily_all_clear, "데일리 올클리어 보너스", syncUserDataToSupabase);
                              newXpGranted.push("all-clear");
                            }
                            try { localStorage.setItem("zepta:daily-quest", JSON.stringify({ date: todayKey, done: newDone, xpGranted: newXpGranted })); syncUserDataToSupabase(); } catch {}
                          }
                        }} style={{
                          display: "flex", alignItems: "center", gap: "8px",
                          padding: "10px 12px", borderRadius: "12px", border: "none", cursor: done ? "default" : "pointer",
                          background: done ? `${C.green}10` : `${C.card2 || C.card}60`,
                          transition: "all .2s", opacity: done ? 0.7 : 1,
                          textAlign: "left",
                        }}
                        onMouseEnter={e => { if (!done) e.currentTarget.style.background = `${C.blue}12`; }}
                        onMouseLeave={e => { if (!done) e.currentTarget.style.background = `${C.card2 || C.card}60`; }}
                        >
                          <span style={{ fontSize: "16px" }}>{done ? "✅" : c.icon}</span>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: "14px", fontWeight: 700, color: done ? C.green : C.text1, lineHeight: 1.2 }}>{c.title}</div>
                            <div style={{ fontSize: "12px", color: C.text3, lineHeight: 1.2 }}>{done ? `+${c.points}XP 획득` : c.desc}</div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  {pct === 100 && (
                    <div style={{
                      marginTop: "10px", padding: "8px 14px", borderRadius: "10px", textAlign: "center",
                      background: `linear-gradient(90deg, ${C.green}15, ${C.blue}10)`,
                      fontSize: "14px", fontWeight: 700, color: C.green,
                    }}>🏆 올클리어! +{XP_REWARDS.daily_all_clear}XP 보너스 획득</div>
                  )}
                </div>
              );
            })()}

            {/* ── 이상 탐지 알림 (Anomaly Detection) ─── */}
            {anomalies.length > 0 && (
              <div style={{
                borderRadius: "20px", overflow: "hidden", position: "relative",
                border: `1px solid ${anomalies[0].anomalyType === "surge" ? C.green : C.red}18`,
              }}>
                {/* 배경 그라데이션 */}
                <div style={{ position: "absolute", inset: 0,
                  background: `linear-gradient(160deg, ${C.card} 0%, ${anomalies[0].anomalyType === "surge" ? '#071A12' : '#1A0710'} 60%, ${C.card} 100%)`,
                  pointerEvents: "none" }} />
                <div style={{ position: "absolute", top: "-30px", right: "10%", width: "120px", height: "120px",
                  borderRadius: "50%", background: `${C.yellow}06`, filter: "blur(40px)", pointerEvents: "none" }} />

                <div style={{ position: "relative", padding: "20px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "14px" }}>
                    <div style={{
                      width: "32px", height: "32px", borderRadius: "10px",
                      background: `linear-gradient(135deg, ${C.yellow}30, ${C.orange}20)`,
                      display: "flex", alignItems: "center", justifyContent: "center", fontSize: "16px",
                    }}>⚡</div>
                    <span style={{ fontWeight: 700, fontSize: "18px", color: C.text1 }}>{t("tabs.home.anomalyDetection")}</span>
                    <span style={{
                      fontSize: "14px", padding: "2px 10px", borderRadius: "10px", fontWeight: 700,
                      background: `${C.red}18`, color: C.red, letterSpacing: "0.3px",
                    }}>{anomalies.length}{t("tabs.home.count") || "건"}</span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                    {anomalies.slice(0, 3).map((a, i) => (
                      <div key={a.symbol} onClick={() => { setSelectedAsset(a); if (Math.random() < 0.5) { ctaCountRef.current++; if (ctaCountRef.current % 3 === 0) setShowGoogleCTA(true); else setShowCoupangCTA(true); }; }} style={{
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        padding: "12px", cursor: "pointer", borderRadius: "12px",
                        transition: "all .2s", background: `${C.card2}30`,
                        border: `1px solid ${C.border}10`,
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = `${C.card2}70`; e.currentTarget.style.transform = "translateX(2px)"; }}
                      onMouseLeave={e => { e.currentTarget.style.background = `${C.card2}30`; e.currentTarget.style.transform = "none"; }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "12px", flex: 1, minWidth: 0 }}>
                          <div style={{
                            width: "40px", height: "40px", borderRadius: "12px", flexShrink: 0,
                            background: a.anomalyType === "surge"
                              ? `linear-gradient(135deg, ${C.green}20, ${C.green}08)`
                              : `linear-gradient(135deg, ${C.red}20, ${C.red}08)`,
                            display: "flex", alignItems: "center", justifyContent: "center",
                            fontSize: "20px",
                          }}>{a.anomalyType === "surge" ? "🚀" : "💥"}</div>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 700, fontSize: "16px", color: C.text1, marginBottom: "2px" }}>{a.name}</div>
                            <div style={{ fontSize: "14px", color: C.text3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {a.anomalyReasons[0]}
                            </div>
                          </div>
                        </div>
                        <div style={{ textAlign: "right", flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "2px" }}>
                          <div style={{
                            fontWeight: 800, fontSize: "18px", color: a.change >= 0 ? C.green : C.red,
                            letterSpacing: "-0.3px",
                          }}>
                            {a.change >= 0 ? "+" : ""}{a.change}%
                          </div>
                          {a.severity === "high" && (
                            <span style={{
                              fontSize: "12px", color: C.red, fontWeight: 700,
                              padding: "1px 6px", borderRadius: "4px", background: `${C.red}15`,
                            }}>{t("tabs.home.severe")}</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* ── 포트폴리오 벤치마킹 ─── */}
            {benchmarkData && (
              <div onClick={() => { setTab("portfolio"); if (Math.random() < 0.5) { ctaCountRef.current++; if (ctaCountRef.current % 3 === 0) setShowGoogleCTA(true); else setShowCoupangCTA(true); }; }} style={{
                background: C.card, borderRadius: "16px", padding: "18px 20px", cursor: "pointer",
                border: `1px solid ${C.border}${C.isDark ? '18' : '40'}`, transition: "transform .15s",
              }}
              onMouseEnter={e => e.currentTarget.style.transform = "translateY(-1px)"}
              onMouseLeave={e => e.currentTarget.style.transform = "translateY(0)"}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span style={{ fontSize: "18px" }}>📊</span>
                    <span style={{ fontWeight: 700, fontSize: "18px", color: C.text1 }}>{t("tabs.home.myPortfolio")}</span>
                  </div>
                  <span style={{ fontSize: "16px", color: C.text3 }}>{portfolio.length}{t("tabs.home.items")} →</span>
                </div>
                <div style={{ display: "flex", alignItems: "baseline", gap: "12px", marginBottom: "12px" }}>
                  <span style={{ fontWeight: 800, fontSize: "24px", color: C.text1 }}>
                    {benchmarkData.myReturn >= 0 ? "+" : ""}{benchmarkData.myReturn.toFixed(2)}%
                  </span>
                  {benchmarkData.alpha != null && (
                    <span style={{
                      fontSize: "16px", fontWeight: 700, padding: "3px 10px", borderRadius: "8px",
                      background: benchmarkData.beatsSP ? C.greenBg : C.redBg,
                      color: benchmarkData.beatsSP ? C.green : C.red,
                    }}>
                      vs S&P {benchmarkData.alpha >= 0 ? "+" : ""}{benchmarkData.alpha.toFixed(1)}%
                    </span>
                  )}
                </div>
                {/* 벤치마크 비교 바 */}
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                  {[
                    { label: "내 수익", value: benchmarkData.myReturn, color: benchmarkData.myReturn >= 0 ? C.green : C.red },
                    ...(benchmarkData.spReturn != null ? [{ label: "S&P 500", value: benchmarkData.spReturn, color: C.blue }] : []),
                    ...(benchmarkData.ksReturn != null ? [{ label: "코스피", value: benchmarkData.ksReturn, color: C.purple }] : []),
                  ].map(b => (
                    <div key={b.label} style={{ flex: 1, textAlign: "center" }}>
                      <div style={{ fontSize: "16px", color: C.text3, marginBottom: "4px" }}>{b.label}</div>
                      <div style={{
                        height: "4px", borderRadius: "4px", background: C.card2, overflow: "hidden",
                      }}>
                        <div style={{
                          width: `${Math.min(Math.max(Math.abs(b.value) * 5, 5), 100)}%`,
                          height: "100%", borderRadius: "4px", background: b.color, transition: "width .5s",
                        }} />
                      </div>
                      <div style={{ fontSize: "16px", fontWeight: 700, color: b.color, marginTop: "3px" }}>
                        {b.value >= 0 ? "+" : ""}{b.value.toFixed(1)}%
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── 커뮤니티 리더보드 (예측 통계 기반 + XP 레벨 연동) ─── */}
            {(() => {
              // 실제 유저 데이터가 없으면 → 예측 통계 기반 시뮬레이션 랭킹 생성
              const uid = user?.id?.slice(0, 8) || "anon";
              const myStats = (() => { try { return JSON.parse(localStorage.getItem("zepta:pred:stats") || '{"correct":0,"total":0}'); } catch { return { correct: 0, total: 0 }; } })();
              const myXp = readTotalXp(uid);
              const myInfo = getXpInfo(myXp.total);
              const myName = user?.user_metadata?.nickname || user?.user_metadata?.display_name || "나";
              const myWinRate = myStats.total > 0 ? Math.round((myStats.correct / myStats.total) * 100) : 0;

              // 시뮬레이션 랭킹 (유저들의 XP + 예측 적중률 기반)
              const simulatedUsers = [
                { name: "투자의신", xp: 4800, winRate: 78, predictions: 89, level: 28, tier: "플래티넘" },
                { name: "퀀트마스터", xp: 3200, winRate: 72, predictions: 65, level: 22, tier: "플래티넘" },
                { name: "알파헌터", xp: 2100, winRate: 68, predictions: 52, level: 16, tier: "골드" },
                { name: "스마트머니", xp: 1500, winRate: 65, predictions: 43, level: 12, tier: "골드" },
                { name: "데이터루크", xp: 800, winRate: 63, predictions: 31, level: 8, tier: "실버" },
              ];

              // 내 랭킹 위치 결정 (XP 기준)
              let leaderboard = simulatedUsers.map(u => ({
                ...u, isMe: false,
                tierInfo: [...XP_TIERS].reverse().find(t => u.level >= t.minLv) || XP_TIERS[0],
              }));

              // 로그인 유저면 내 순위 삽입
              if (user && myXp.total > 0) {
                const myEntry = {
                  name: myName, xp: myXp.total, winRate: myWinRate,
                  predictions: myStats.total, level: myInfo.level, tier: myInfo.tier.name,
                  isMe: true, tierInfo: myInfo.tier,
                };
                leaderboard.push(myEntry);
                leaderboard.sort((a, b) => b.xp - a.xp);
                leaderboard = leaderboard.slice(0, 5); // 상위 5명만
              }

              // 순위 부여
              leaderboard.forEach((u, i) => { u.rank = i + 1; });
              const badges = ["🏆", "🥈", "🥉"];

              return (
                <div style={{
                  background: C.card, borderRadius: "20px", padding: isMobile ? "16px" : "20px",
                  border: `1px solid ${C.border}${C.isDark ? '18' : '40'}`,
                  position: "relative", overflow: "hidden",
                }}>
                  <div style={{ position: "absolute", top: "-20px", right: "-10px", fontSize: "70px", opacity: 0.03, pointerEvents: "none" }}>🏆</div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "14px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <span style={{ fontSize: "18px" }}>🏅</span>
                      <span style={{ fontWeight: 800, fontSize: "16px", color: C.text1 }}>투자 랭킹</span>
                      <span style={{ fontSize: "12px", fontWeight: 600, color: C.text3, padding: "2px 8px", borderRadius: "6px", background: `${C.border}20` }}>XP 기준</span>
                    </div>
                    <button onClick={() => { setTab("profile"); setTimeout(() => { try { document.getElementById("ranking-section")?.scrollIntoView({ behavior: "smooth" }); } catch {} }, 200); }} style={{
                      fontSize: "12px", color: C.blue, background: `${C.blue}10`, border: `1px solid ${C.blue}20`,
                      borderRadius: "8px", cursor: "pointer", fontWeight: 600, padding: "4px 10px",
                    }}>전체 보기 →</button>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                    {leaderboard.map(u => (
                      <div key={u.rank} style={{
                        display: "flex", alignItems: "center", gap: "10px",
                        padding: "10px 12px", borderRadius: "12px",
                        background: u.isMe ? `${C.blue}10` : u.rank <= 3 ? `${u.tierInfo.color}08` : "transparent",
                        border: u.isMe ? `1px solid ${C.blue}25` : "1px solid transparent",
                        transition: "background .15s",
                      }}>
                        <span style={{ fontWeight: 800, fontSize: "14px", color: u.rank <= 3 ? u.tierInfo.color : C.text3, width: "20px", textAlign: "center" }}>
                          {badges[u.rank - 1] || u.rank}
                        </span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                            <span style={{ fontWeight: 700, fontSize: "14px", color: u.isMe ? C.blue : C.text1 }}>{u.name}{u.isMe ? " (나)" : ""}</span>
                            <span style={{
                              fontSize: "10px", fontWeight: 700, padding: "1px 6px", borderRadius: "6px",
                              background: `${u.tierInfo.color}15`, color: u.tierInfo.color,
                            }}>Lv.{u.level}</span>
                          </div>
                          <div style={{ fontSize: "12px", color: C.text3 }}>
                            적중률 {u.winRate}% · {u.predictions}회 예측
                          </div>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <div style={{ fontWeight: 800, fontSize: "14px", color: u.tierInfo.color, letterSpacing: "-0.3px" }}>{u.xp.toLocaleString()} XP</div>
                          <div style={{ fontSize: "10px", color: C.text3 }}>{u.tierInfo.icon} {u.tier}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                  {!user && (
                    <button onClick={() => setShowAuthModal(true)} style={{
                      width: "100%", marginTop: "12px", padding: "10px", borderRadius: "12px",
                      border: `1px dashed ${C.blue}40`, background: `${C.blue}08`,
                      color: C.blue, fontSize: "14px", fontWeight: 700, cursor: "pointer",
                      transition: "all .2s",
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = `${C.blue}15`}
                    onMouseLeave={e => e.currentTarget.style.background = `${C.blue}08`}
                    >로그인하고 랭킹에 도전하세요 →</button>
                  )}
                  {user && myXp.total === 0 && (
                    <div style={{
                      marginTop: "10px", padding: "10px 14px", borderRadius: "10px", textAlign: "center",
                      background: `${C.blue}08`, border: `1px dashed ${C.blue}20`,
                      fontSize: "12px", color: C.text3,
                    }}>미션을 완료하고 XP를 적립하면 랭킹에 참여할 수 있어요</div>
                  )}
                </div>
              );
            })()}

            {/* ── 오늘의 추천 ─── */}
            {dailyPicks.length > 0 && (
              <div className="ui-card" style={{
                borderRadius: "20px", overflow: "hidden", position: "relative",
              }}>
                <div style={{ position: "relative", padding: "20px" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <span style={{ fontWeight: 800, fontSize: "18px", color: C.text1 }}>{t("tabs.home.todayPicks") || "오늘의 추천"}</span>
                    </div>
                    <button onClick={() => setPicksExpanded(!picksExpanded)} style={{
                      fontSize: "14px", color: C.blue, background: `${C.blue}10`, border: `1px solid ${C.blue}25`,
                      borderRadius: "8px", cursor: "pointer", fontWeight: 600, padding: "4px 12px",
                      transition: "all .15s",
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = `${C.blue}20`}
                    onMouseLeave={e => e.currentTarget.style.background = `${C.blue}10`}
                    >{picksExpanded ? (t("tabs.home.collapse") || "접기") : `${t("tabs.home.seeMore") || "더보기"} (${dailyPicks.length})`}</button>
                  </div>
                  <div style={{
                    display: isMobile ? "flex" : "flex",
                    flexDirection: isMobile ? "row" : "column",
                    gap: isMobile ? "12px" : "4px",
                    overflowX: isMobile ? "auto" : "visible",
                    scrollSnapType: isMobile ? "x mandatory" : "none",
                    WebkitOverflowScrolling: "touch",
                    paddingBottom: isMobile ? "4px" : "0",
                    scrollbarWidth: "none",
                    msOverflowStyle: "none",
                  }} className={isMobile ? "hscroll" : ""}>
                    {dailyPicks.slice(0, picksExpanded ? 15 : 5).map((pick, i) => {
                      const flag = pick.market === "kr" ? "🇰🇷" : "🇺🇸";
                      const isPos = pick.change >= 0;
                      const isTop3 = i < 3;
                      return (
                        <div key={pick.symbol} onClick={() => { setSelectedAsset(pick); if (Math.random() < 0.5) { ctaCountRef.current++; if (ctaCountRef.current % 3 === 0) setShowGoogleCTA(true); else setShowCoupangCTA(true); }; }}
                          style={{
                            display: "flex", alignItems: "center", justifyContent: "space-between",
                            padding: "12px", cursor: "pointer", borderRadius: "12px",
                            transition: "all .2s", background: isTop3 ? `${C.card2}40` : "transparent",
                            border: `1px solid ${isTop3 ? C.border + '12' : 'transparent'}`,
                            minWidth: isMobile ? "280px" : undefined,
                            flexShrink: isMobile ? 0 : undefined,
                            scrollSnapAlign: isMobile ? "start" : undefined,
                            flexDirection: isMobile ? "column" : "row",
                          }}
                          onMouseEnter={e => { e.currentTarget.style.background = `${C.card2}70`; e.currentTarget.style.transform = "translateX(2px)"; }}
                          onMouseLeave={e => { e.currentTarget.style.background = isTop3 ? `${C.card2}40` : "transparent"; e.currentTarget.style.transform = "none"; }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "12px", flex: 1, minWidth: 0 }}>
                            <div style={{
                              width: "30px", height: "30px", borderRadius: "10px", flexShrink: 0,
                              background: isTop3
                                ? `linear-gradient(135deg, ${C.blue}30, ${C.purple}20)`
                                : `${C.card2}80`,
                              display: "flex", alignItems: "center", justifyContent: "center",
                              fontSize: "14px", fontWeight: 800, color: isTop3 ? C.blue : C.text3,
                            }}>{i + 1}</div>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontWeight: 600, fontSize: "16px", color: C.text1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{flag} {pick.name}</div>
                            </div>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
                            <span style={{
                              fontSize: "12px", padding: "3px 8px", borderRadius: "6px", fontWeight: 600,
                              background: pick.score >= 7 ? `${C.green}15` : pick.score >= 5 ? `${C.blue}15` : `${C.yellow}15`,
                              color: pick.score >= 7 ? C.green : pick.score >= 5 ? C.blue : C.yellow,
                              whiteSpace: "nowrap", maxWidth: "100px", overflow: "hidden", textOverflow: "ellipsis",
                            }}>{pick.reason}</span>
                            <span style={{
                              fontSize: "15px", fontWeight: 700, color: isPos ? C.green : C.red,
                              minWidth: "52px", textAlign: "right", letterSpacing: "-0.3px",
                            }}>
                              {isPos ? "+" : ""}{pick.change}%
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {/* 공유 버튼 */}
                  <button onClick={() => {
                    const top5 = dailyPicks.slice(0, 5).map((p, i) => `${i + 1}. ${p.name} (${p.symbol}) ${p.change >= 0 ? "+" : ""}${p.change}%`).join("\n");
                    const txt = `[Zepta AI ${t("tabs.home.todayPicks") || "오늘의 추천"}]\n\n${top5}\n\n${t("tabs.home.shareDesc") || "AI 퀀트 33개 전략이 실시간으로 찾아낸 종목입니다"}\n👉 https://zepta.app`;
                    if (navigator.share) navigator.share({ title: `Zepta AI ${t("tabs.home.todayPicks") || "오늘의 추천"}`, text: txt, url: "https://zepta.app" }).catch(() => {});
                    else navigator.clipboard.writeText(txt).then(() => showToast(t("tabs.home.copied") || "추천 종목이 복사되었습니다!", "success")).catch(() => {});
                  }} style={{
                    width: "100%", padding: "10px 0", marginTop: "12px", borderRadius: "12px",
                    fontSize: "14px", fontWeight: 600, color: C.text3, background: `${C.card2}40`,
                    border: `1px solid ${C.border}20`, cursor: "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center", gap: "6px",
                    transition: "all .15s",
                  }}
                  onMouseEnter={e => { e.currentTarget.style.color = C.blue; e.currentTarget.style.background = `${C.blue}10`; e.currentTarget.style.borderColor = `${C.blue}30`; }}
                  onMouseLeave={e => { e.currentTarget.style.color = C.text3; e.currentTarget.style.background = `${C.card2}40`; e.currentTarget.style.borderColor = `${C.border}20`; }}
                  >📤 {t("tabs.home.shareRecommendation") || "오늘의 추천 공유"}</button>
                </div>
              </div>
            )}

            {/* ── Google AdSense (Home - Responsive) ─── */}
            <div style={{ minHeight: 0, overflow: "hidden" }}>
              <GoogleAd format="responsive" slot="home-main" style={{ margin: "20px 0" }} />
            </div>

            {/* ── 주요 종목 (통합: 전체 / 급등 / 급락 탭) ─── */}
            {hotAssets.length > 0 && (() => {
              const sorted = [...hotAssets].sort((a, b) => b.change - a.change);
              const baseAssets = hideRisky ? [...hotAssets].filter(a => !RISKY_SYMBOLS.has(a.symbol?.replace(".KS",""))) : hotAssets;
              const baseSorted = hideRisky ? sorted.filter(a => !RISKY_SYMBOLS.has(a.symbol?.replace(".KS",""))) : sorted;
              const displayAssets = hotViewMode === "gainers" ? baseSorted.filter(a => a.change > 0).slice(0, hotExpanded ? 30 : 8)
                : hotViewMode === "losers" ? baseSorted.filter(a => a.change < 0).slice(0, hotExpanded ? 30 : 8)
                : baseAssets.slice(0, hotExpanded ? 50 : 10);
              return (
                <div style={{ background: C.card, borderRadius: "16px", padding: "20px", border: `1px solid ${C.border}${C.isDark ? '18' : '40'}` }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "14px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      {[["all", t("tabs.home.all")], ["gainers", t("tabs.home.gainers")], ["losers", t("tabs.home.losers")]].map(([k, l]) => (
                        <button key={k} onClick={() => setHotViewMode(k)} style={{
                          padding: "5px 12px", borderRadius: "8px", fontSize: "18px", fontWeight: 700,
                          background: hotViewMode === k ? (k === "gainers" ? C.greenBg : k === "losers" ? C.redBg : C.blueBg) : "transparent",
                          color: hotViewMode === k ? (k === "gainers" ? C.green : k === "losers" ? C.red : C.blue) : C.text3,
                          border: "none", cursor: "pointer", transition: "all .15s",
                        }}>{l}</button>
                      ))}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <label style={{ display: "flex", alignItems: "center", gap: "5px", cursor: "pointer", fontSize: "16px", color: C.text3 }}>
                        <span onClick={() => setHideRisky(!hideRisky)} style={{
                          width: "32px", height: "18px", borderRadius: "8px", position: "relative",
                          background: hideRisky ? C.blue : C.card2, border: `1px solid ${hideRisky ? C.blue : C.border2}`,
                          transition: "all 0.2s", display: "inline-block", cursor: "pointer",
                        }}>
                          <span style={{
                            position: "absolute", top: "2px", left: hideRisky ? "15px" : "2px",
                            width: "12px", height: "12px", borderRadius: "50%", background: "#fff",
                            transition: "left 0.2s", boxShadow: "0 1px 2px rgba(0,0,0,0.2)",
                          }} />
                        </span>
                        {t("tabs.home.hideRiskyAssets")}
                      </label>
                      <button onClick={() => setHotExpanded(!hotExpanded)} style={{
                        fontSize: "16px", color: C.blue, background: "none", border: "none", cursor: "pointer", fontWeight: 600,
                      }}>{hotExpanded ? t("tabs.home.collapse") : t("tabs.home.seeMore")}</button>
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    {displayAssets.map((asset, i) => {
                      const flag = asset.market === "us" ? "🇺🇸" : asset.market === "kr" ? "🇰🇷" : "₿";
                      const isPos = asset.change >= 0;
                      const ext = extendedHours[asset.symbolRaw || asset.symbol];
                      return (
                        <div key={asset.symbol} onClick={() => { setSelectedAsset(asset); if (Math.random() < 0.5) { ctaCountRef.current++; if (ctaCountRef.current % 3 === 0) setShowGoogleCTA(true); else setShowCoupangCTA(true); }; }}
                          style={{
                            display: "flex", alignItems: "center", justifyContent: "space-between",
                            padding: "12px 8px", cursor: "pointer", borderRadius: "10px",
                            transition: "background .15s",
                          }}
                          onMouseEnter={e => e.currentTarget.style.background = C.card2 + "60"}
                          onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                          <div style={{ display: "flex", alignItems: "center", gap: "12px", flex: 1, minWidth: 0 }}>
                            <div style={{
                              width: "36px", height: "36px", borderRadius: "10px", flexShrink: 0,
                              background: asset.market === "us" ? `${C.blue}14` : asset.market === "kr" ? `${C.green}14` : `${C.purple}14`,
                              display: "flex", alignItems: "center", justifyContent: "center",
                              fontWeight: 800, fontSize: "15px",
                              color: asset.market === "us" ? C.blue : asset.market === "kr" ? C.green : C.purple,
                            }}>{asset.symbol.replace(".KS","").slice(0,3)}</div>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontWeight: 600, fontSize: "18px", color: C.text1 }}>{asset.name}</div>
                              <div style={{ fontSize: "16px", color: C.text3 }}>{flag} {asset.symbol.replace(".KS","")}</div>
                            </div>
                          </div>
                          <div style={{ textAlign: "right" }}>
                            <div style={{ fontWeight: 600, fontSize: "18px", color: C.text1 }}>{fmtPrice(asset.price, asset.market)}</div>
                            <div style={{ display: "flex", alignItems: "center", gap: "6px", justifyContent: "flex-end" }}>
                              <span style={{ fontSize: "18px", fontWeight: 600, color: isPos ? C.green : C.red }}>
                                {isPos ? "+" : ""}{asset.change}%
                              </span>
                              {ext && (
                                <span style={{ fontSize: "16px", color: C.purple, fontWeight: 600 }}>
                                  {ext.isPreMarket ? "PRE" : "AH"} {ext.change != null ? `${ext.change >= 0 ? "+" : ""}${ext.change.toFixed(1)}%` : ""}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    {displayAssets.length === 0 && (
                      <div style={{ textAlign: "center", padding: "16px", color: C.text3, fontSize: "18px" }}>
                        해당 종목이 없습니다
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* 쿠팡 파트너스 배너 — 홈 중간 */}
            <div style={{ minHeight: 0, overflow: "hidden" }}>
              <CoupangOfficialBanner width="728" height="90" bannerId={975392} style={{ margin: "4px 0", borderRadius: "12px", overflow: "hidden" }} />
            </div>

            </div>{/* end home-left */}
            <div className="home-right" style={{ display: "flex", flexDirection: "column", gap: "20px" }}>

            {/* ── 오늘의 마켓 예측 (유저 리텐션 훅) ─── */}
            {(() => {
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
            })()}

            {/* ── 오늘의 마켓 퀴즈 (리텐션 훅) ─── */}
            {(() => {
              const todayKey = new Date().toISOString().slice(0, 10);
              const quizKey = `zepta:quiz:${todayKey}`;

              const quizPool = [
                { q: "VIX 지수가 30 이상이면 시장은?", options: ["공포 상태", "탐욕 상태", "중립"], answer: 0 },
                { q: "골든크로스란?", options: ["단기MA > 장기MA", "단기MA < 장기MA", "거래량 급증"], answer: 0 },
                { q: "PER이 높으면 주식은?", options: ["고평가", "저평가", "정상"], answer: 0 },
                { q: "RSI가 30 이하면?", options: ["과매도", "과매수", "중립"], answer: 0 },
                { q: "미국 기준금리를 결정하는 기관은?", options: ["SEC", "Fed (FOMC)", "IMF"], answer: 1 },
                { q: "코스피 시장이 열리는 시간은?", options: ["오전 8시", "오전 9시", "오전 10시"], answer: 1 },
                { q: "달러 강세 시 원화는?", options: ["약세", "강세", "무관"], answer: 0 },
                { q: "볼린저 밴드 상단 돌파 시?", options: ["과매수 신호", "과매도 신호", "추세 전환"], answer: 0 },
                { q: "S&P 500에 포함된 기업 수는?", options: ["100개", "500개", "1000개"], answer: 1 },
                { q: "채권 가격과 금리의 관계는?", options: ["반비례", "비례", "무관"], answer: 0 },
                { q: "MACD 골든크로스 발생 시?", options: ["매수 신호", "매도 신호", "관망"], answer: 0 },
                { q: "원유 가격 상승 시 수혜 섹터?", options: ["에너지", "기술", "유틸리티"], answer: 0 },
                { q: "시가총액 1위 기업은? (2025)", options: ["Apple", "Microsoft", "NVIDIA"], answer: 0 },
                { q: "나스닥 지수의 특징은?", options: ["기술주 중심", "산업주 중심", "금융주 중심"], answer: 0 },
              ];

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
            })()}

            {/* ── 투자 뱃지 ─── */}
            {(() => {
              const streakData = (() => { try { return JSON.parse(localStorage.getItem("zepta:streak") || "{}"); } catch { return {}; } })();
              const predStats = (() => { try { return JSON.parse(localStorage.getItem("zepta:pred:stats") || '{"total":0,"correct":0}'); } catch { return { total: 0, correct: 0 }; } })();
              const quizStatsLocal = (() => { try { return JSON.parse(localStorage.getItem("zepta:quiz:stats") || '{"total":0,"correct":0}'); } catch { return { total: 0, correct: 0 }; } })();

              const badges = [
                { icon: "🔥", name: t("tabs.home.badgeStreak3") || "3일 연속", earned: (streakData.count || 0) >= 3, progress: Math.min(streakData.count || 0, 3), target: 3 },
                { icon: "⚡", name: t("tabs.home.badgeStreak7") || "7일 연속", earned: (streakData.count || 0) >= 7, progress: Math.min(streakData.count || 0, 7), target: 7 },
                { icon: "🎯", name: t("tabs.home.badgePredictor") || "예측 5회", earned: predStats.total >= 5, progress: Math.min(predStats.total, 5), target: 5 },
                { icon: "🧠", name: t("tabs.home.badgeScholar") || "퀴즈 마스터", earned: quizStatsLocal.correct >= 5, progress: Math.min(quizStatsLocal.correct, 5), target: 5 },
                { icon: "📊", name: t("tabs.home.badgeAnalyst") || "분석가", earned: watchlist.length >= 5, progress: Math.min(watchlist.length, 5), target: 5 },
                { icon: "🏆", name: t("tabs.home.badgeChampion") || "챔피언", earned: predStats.total >= 10 && (predStats.correct / Math.max(predStats.total, 1)) >= 0.7, progress: predStats.correct, target: 7 },
              ];

              const earnedCount = badges.filter(b => b.earned).length;

              return (
                <div style={{ background: C.card, borderRadius: "16px", padding: "18px", border: `1px solid ${C.border}${C.isDark ? '18' : '40'}` }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "14px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <span style={{ fontSize: "16px" }}>🏆</span>
                      <span style={{ fontWeight: 700, fontSize: "16px", color: C.text1 }}>{t("tabs.home.investBadges") || "투자 뱃지"}</span>
                    </div>
                    <span style={{ fontSize: "12px", color: C.blue, fontWeight: 600 }}>{earnedCount}/{badges.length}</span>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "8px" }}>
                    {badges.map((b, i) => (
                      <div key={i} style={{
                        padding: "12px 8px", borderRadius: "12px", textAlign: "center",
                        background: b.earned ? `${C.blue}08` : `${C.card2}30`,
                        border: `1px solid ${b.earned ? C.blue + '20' : C.border + '10'}`,
                        opacity: b.earned ? 1 : 0.6,
                        transition: "all .2s",
                        boxShadow: b.earned ? `0 0 12px ${C.blue}20` : "none",
                      }}>
                        <div style={{ fontSize: "28px", marginBottom: "4px", filter: b.earned ? "none" : "grayscale(1)" }}>{b.icon}</div>
                        <div style={{ fontSize: "12px", fontWeight: 600, color: b.earned ? C.text1 : C.text3, lineHeight: 1.2 }}>{b.name}</div>
                        {!b.earned && (
                          <div style={{ marginTop: "4px", height: "5px", borderRadius: "4px", background: C.card2, overflow: "hidden" }}>
                            <div style={{ width: `${(b.progress / b.target) * 100}%`, height: "100%", background: C.blue, borderRadius: "4px", transition: "width .3s" }} />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* ── 관심종목 (v10.3 유저별 격리) ─── */}
            <div style={{ background: C.card, borderRadius: "16px", padding: "20px", border: `1px solid ${C.border}${C.isDark ? '18' : '40'}` }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: watchlist.length > 0 ? "14px" : "0" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span style={{ fontWeight: 700, fontSize: "18px", color: C.text1 }}>{t("tabs.home.watchlist")}</span>
                  {watchlist.length > 0 && <span style={{ fontSize: "16px", padding: "2px 8px", borderRadius: "10px", background: C.blueBg, color: C.blue, fontWeight: 700 }}>{watchlist.length}</span>}
                </div>
                {user && <SearchBar compact placeholder={t("tabs.home.addAssetPlaceholder")} onSelect={(asset) => {
                  if (!watchlist.some(w => w.symbol === asset.symbol)) {
                    setWatchlist(prev => [...prev, { symbol: asset.symbol, name: asset.name, market: asset.market, symbolRaw: asset.symbolRaw || asset.symbol, id: asset.id }]);
                    if (Math.random() < 0.5) { ctaCountRef.current++; if (ctaCountRef.current % 3 === 0) setShowGoogleCTA(true); else setShowCoupangCTA(true); };
                  }
                }} />}
              </div>
              {!user ? (
                <div style={{ textAlign: "center", padding: "32px 16px 20px" }}>
                  <div style={{ width: "56px", height: "56px", borderRadius: "16px", background: C.blueBg, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px", fontSize: "24px" }}>🔒</div>
                  <div style={{ fontSize: "18px", fontWeight: 700, color: C.text1, marginBottom: "6px" }}>{t("tabs.home.loginToManageWatchlist")}</div>
                  <div style={{ fontSize: "18px", color: C.text3, lineHeight: 1.6, marginBottom: "16px" }}>{t("tabs.home.realtimeQuantDescription")}</div>
                  <button onClick={() => setShowAuth(true)} style={{
                    padding: "10px 24px", borderRadius: "10px", fontSize: "18px", fontWeight: 700,
                    background: C.blue, color: "#fff", border: "none", cursor: "pointer",
                  }}>{t("tabs.home.loginOrSignup")}</button>
                </div>
              ) : watchlist.length === 0 ? (
                <div style={{
                  textAlign: "center",
                  padding: "48px 24px",
                  background: `linear-gradient(135deg, ${C.blueBg}20 0%, ${C.card2}40 100%)`,
                  borderRadius: "16px",
                  border: `1px solid ${C.border}20`,
                  marginBottom: "16px",
                }}>
                  <div style={{
                    width: "64px",
                    height: "64px",
                    borderRadius: "16px",
                    background: C.blueBg,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    margin: "0 auto 16px",
                    fontSize: "32px",
                    boxShadow: `0 4px 16px ${C.blue}20`,
                  }}>
                    📌
                  </div>
                  <div style={{ fontSize: "18px", fontWeight: 800, color: C.text1, marginBottom: "8px" }}>관심종목을 추가하세요</div>
                  <div style={{ fontSize: "15px", color: C.text3, lineHeight: 1.6, marginBottom: "24px" }}>
                    종목을 추가하면 실시간 시세, 퀀트 분석, 및 거래 신호를 한눈에 확인할 수 있습니다.
                  </div>
                  <div style={{ display: "flex", gap: "8px", justifyContent: "center", marginTop: "20px", flexWrap: "wrap" }}>
                    {["NVDA","AAPL","TSLA","MSFT"].map(s => {
                      const a = hotAssets.find(h => h.symbol === s);
                      return a ? (
                        <button
                          key={s}
                          onClick={() => {
                            setWatchlist(prev => [...prev, { symbol: a.symbol, name: a.name, market: a.market, symbolRaw: a.symbolRaw || a.symbol }]);
                            if (Math.random() < 0.5) { ctaCountRef.current++; if (ctaCountRef.current % 3 === 0) setShowGoogleCTA(true); else setShowCoupangCTA(true); };
                            showToast(`${a.name} 추가됨`, "success");
                          }}
                          style={{
                            padding: "8px 16px",
                            borderRadius: "10px",
                            fontSize: "14px",
                            fontWeight: 600,
                            background: C.blue,
                            color: "#fff",
                            border: "none",
                            cursor: "pointer",
                            transition: "all .2s",
                          }}
                          onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = `0 4px 12px ${C.blue}40`; }}
                          onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "none"; }}
                        >
                          + {a.name}
                        </button>
                      ) : null;
                    })}
                  </div>
                  <button
                    onClick={() => setTab("screener")}
                    style={{
                      marginTop: "16px",
                      padding: "10px 20px",
                      borderRadius: "10px",
                      fontSize: "15px",
                      fontWeight: 700,
                      background: `${C.blue}15`,
                      color: C.blue,
                      border: `1.5px solid ${C.blue}30`,
                      cursor: "pointer",
                      transition: "all .2s",
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = `${C.blue}25`; e.currentTarget.style.borderColor = C.blue; }}
                    onMouseLeave={e => { e.currentTarget.style.background = `${C.blue}15`; e.currentTarget.style.borderColor = `${C.blue}30`; }}
                  >
                    스크리너로 종목 찾기 →
                  </button>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column" }}>
                  {watchlist.map(w => {
                    const hot = hotAssets.find(h => h.symbol === w.symbol || h.symbol === w.symbolRaw);
                    const ext = extendedHours[w.symbolRaw || w.symbol];
                    const flag = w.market === "us" ? "🇺🇸" : w.market === "kr" ? "🇰🇷" : "₿";
                    const diag = hot ? quickDiagnosis(hot) : null;
                    const diagColor = diag ? (diag.score >= 60 ? C.green : diag.score >= 40 ? C.yellow : C.red) : C.text3;
                    return (
                      <div key={w.symbol} onClick={() => { setSelectedAsset(w); if (Math.random() < 0.5) { ctaCountRef.current++; if (ctaCountRef.current % 3 === 0) setShowGoogleCTA(true); else setShowCoupangCTA(true); }; }}
                        style={{
                          display: "flex", alignItems: "center", justifyContent: "space-between",
                          padding: "12px 8px", cursor: "pointer", borderRadius: "10px",
                          transition: "background .15s",
                        }}
                        onMouseEnter={e => e.currentTarget.style.background = `${C.card2}80`}
                        onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                        <div style={{ display: "flex", alignItems: "center", gap: "10px", flex: 1, minWidth: 0 }}>
                          {/* 퀀트 점수 미니뱃지 */}
                          {diag ? (
                            <div style={{
                              width: "32px", height: "32px", borderRadius: "10px", flexShrink: 0,
                              background: `${diagColor}14`, display: "flex", alignItems: "center", justifyContent: "center",
                              fontSize: "16px", fontWeight: 800, color: diagColor,
                            }}>{diag.score}</div>
                          ) : (
                            <span style={{ fontSize: mf(14), width: "32px", textAlign: "center", flexShrink: 0 }}>{flag}</span>
                          )}
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 600, fontSize: "18px", color: C.text1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{w.name || w.symbol}</div>
                            {diag && <div style={{ fontSize: "15px", color: diagColor, fontWeight: 600, marginTop: "1px" }}>{diag.opinion}</div>}
                          </div>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                          {hot && (
                            <div style={{ textAlign: "right" }}>
                              <div style={{ fontWeight: 600, fontSize: "18px", color: C.text1 }}>{fmtPrice(hot.price, w.market)}</div>
                              <div style={{ display: "flex", alignItems: "center", gap: "3px", justifyContent: "flex-end" }}>
                                <span style={{ fontSize: mf(11), fontWeight: 600, color: hot.change >= 0 ? C.green : C.red }}>
                                  {hot.change >= 0 ? "+" : ""}{hot.change}%
                                </span>
                                {ext && (
                                  <span style={{ fontSize: mf(9), color: C.purple, fontWeight: 600 }}>
                                    {ext.isPreMarket ? "PRE" : "AH"} {ext.change != null ? `${ext.change >= 0 ? "+" : ""}${ext.change.toFixed(1)}%` : ""}
                                  </span>
                                )}
                              </div>
                            </div>
                          )}
                          <button onClick={(e) => { e.stopPropagation(); setWatchlist(prev => prev.filter(x => x.symbol !== w.symbol)); }}
                            style={{ width: "24px", height: "24px", borderRadius: "8px", border: "none",
                              background: "transparent", color: C.text3, fontSize: mf(10), cursor: "pointer",
                              display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, opacity: 0.4,
                              transition: "opacity .15s, background .15s",
                            }}
                            onMouseEnter={e => { e.currentTarget.style.opacity = "1"; e.currentTarget.style.background = `${C.red}15`; e.currentTarget.style.color = C.red; }}
                            onMouseLeave={e => { e.currentTarget.style.opacity = "0.4"; e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = C.text3; }}>✕</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* ── 관심종목 투자 진단 + 매수 타점 (v9 고도화) ─── */}
            {watchlist.length > 0 && hotAssets.length > 0 && (() => {
              const watchDiags = watchlist.map(w => {
                const hot = hotAssets.find(h => h.symbol === w.symbol || h.symbol === w.symbolRaw);
                if (!hot) return null;
                const d = quickDiagnosis(hot);
                const buyLvls = calcBuyLevels(hot);
                return { ...w, ...hot, diag: d, buyLevels: buyLvls };
              }).filter(Boolean).sort((a, b) => b.diag.score - a.diag.score);
              if (!watchDiags.length) return null;
              return (
                <div style={{ background: C.card, borderRadius: "16px", padding: "20px", border: `1px solid ${C.border}${C.isDark ? '18' : '40'}` }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "14px" }}>
                    <span style={{ fontWeight: 700, fontSize: "18px", color: C.text1 }}>📊 투자 진단 & 매수 타점</span>
                    <span style={{ fontSize: mf(11), color: C.text3 }}>실시간 분석</span>
                  </div>
                  {watchDiags.map((w, i) => {
                    const d = w.diag;
                    const bl = w.buyLevels;
                    const opColor = d.opinionColor === "green" ? C.green : d.opinionColor === "red" ? C.red : C.yellow;
                    return (
                      <div key={w.symbol} style={{ marginBottom: i < watchDiags.length - 1 ? "8px" : 0 }}>
                        {/* 종목 헤더 */}
                        <div onClick={() => setSelectedAsset(w)} style={{
                          display: "flex", alignItems: "center", justifyContent: "space-between",
                          padding: "12px 8px", cursor: "pointer", borderRadius: "10px",
                          transition: "background .15s",
                        }}
                        onMouseEnter={e => e.currentTarget.style.background = `${C.card2}80`}
                        onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                          <div style={{ display: "flex", alignItems: "center", gap: "10px", flex: 1, minWidth: 0 }}>
                            <div style={{
                              width: "36px", height: "36px", borderRadius: "50%", flexShrink: 0,
                              background: `${opColor}18`, display: "flex", alignItems: "center", justifyContent: "center",
                              fontSize: "18px", fontWeight: 800, color: opColor,
                            }}>{d.score}</div>
                            <div style={{ minWidth: 0, flex: 1 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                <span style={{ fontWeight: 600, fontSize: "18px", color: C.text1 }}>{w.name}</span>
                                <span style={{ fontSize: "16px", color: C.text3 }}>${w.price?.toLocaleString(undefined, {maximumFractionDigits: 2})}</span>
                              </div>
                              <div style={{ fontSize: mf(11), color: C.text3, marginTop: "2px" }}>{d.rationale}</div>
                            </div>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                            <span style={{ fontSize: "16px", fontWeight: 700, color: w.change >= 0 ? C.green : C.red }}>
                              {w.change >= 0 ? "+" : ""}{w.change?.toFixed(2)}%
                            </span>
                            <span style={{
                              fontSize: "16px", fontWeight: 700, padding: "4px 10px", borderRadius: "8px",
                              background: `${opColor}18`, color: opColor, whiteSpace: "nowrap",
                            }}>{d.opinion}</span>
                          </div>
                        </div>

                        {/* 4축 미니 바 + 매수 타점 */}
                        <div style={{ padding: "6px 12px 10px", display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "flex-start" }}>
                          {/* 4축 진단 미니바 */}
                          <div style={{ display: "flex", gap: "6px", flex: "1 1 auto", minWidth: "140px" }}>
                            {d.categories.map(c => {
                              const catColor = c.score >= 60 ? C.green : c.score >= 40 ? C.yellow : C.red;
                              return (
                                <div key={c.name} style={{ flex: 1, textAlign: "center" }}>
                                  <div style={{ fontSize: "15px", color: C.text3, marginBottom: "3px" }}>{c.name}</div>
                                  <div style={{ height: "4px", borderRadius: "4px", background: `${C.border}40`, overflow: "hidden" }}>
                                    <div style={{ height: "100%", width: `${c.score}%`, background: catColor, borderRadius: "4px", transition: "width .5s" }} />
                                  </div>
                                  <div style={{ fontSize: "15px", fontWeight: 700, color: catColor, marginTop: "2px" }}>{c.score}</div>
                                </div>
                              );
                            })}
                          </div>

                          {/* 매수 타점 3단계 */}
                          {bl.levels.length > 0 && (
                            <div style={{ display: "flex", gap: "4px", flex: "0 0 auto" }}>
                              {bl.levels.map((lv, li) => {
                                const lvColor = li === 0 ? C.blue : li === 1 ? C.purple : C.green;
                                return (
                                  <div key={li} style={{
                                    padding: "4px 8px", borderRadius: "8px",
                                    background: `${lvColor}15`, textAlign: "center", minWidth: "58px",
                                  }}>
                                    <div style={{ fontSize: "14px", color: lvColor, fontWeight: 700 }}>{lv.label}</div>
                                    <div style={{ fontSize: "16px", fontWeight: 800, color: C.text1, marginTop: "1px" }}>
                                      ${lv.price < 1 ? lv.price.toFixed(4) : lv.price.toLocaleString(undefined, {maximumFractionDigits: 2})}
                                    </div>
                                    <div style={{ fontSize: "14px", color: C.red }}>-{lv.discount}%</div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}

            {/* ── 퀀트 리포트 ─── */}
            {marketIndices.length > 0 && (() => {
              const sp = marketIndices.find(i => i.symbol === "^GSPC");
              const nq = marketIndices.find(i => i.symbol === "^IXIC");
              const ks = marketIndices.find(i => i.symbol === "^KS11");
              const kq = marketIndices.find(i => i.symbol === "^KQ11");
              const fg = fearGreed.stock?.value;

              // 종목별 상승/하락 카운트
              const upCount = hotAssets.filter(a => a.change > 0).length;
              const dnCount = hotAssets.filter(a => a.change < 0).length;
              const flatCount = hotAssets.length - upCount - dnCount;
              const advDecl = hotAssets.length > 0 ? (upCount / hotAssets.length * 100) : 50;

              // 추천종목 기반 매수/매도 신호
              const buyPicks = dailyPicks.filter(p => p.score >= 6).length;
              const sellPicks = dailyPicks.filter(p => p.score <= 3).length;

              // 종합 시장 점수 (0~100)
              let mktScore = 50;
              if (sp) mktScore += sp.change > 1 ? 10 : sp.change > 0.3 ? 5 : sp.change > -0.3 ? 0 : sp.change > -1 ? -5 : -10;
              if (fg) mktScore += fg > 70 ? 8 : fg > 55 ? 4 : fg > 40 ? 0 : fg > 25 ? -4 : -8;
              mktScore += advDecl > 60 ? 8 : advDecl > 50 ? 3 : advDecl > 40 ? -3 : -8;
              if (buyPicks > 5) mktScore += 6; else if (buyPicks > 2) mktScore += 3;
              if (sellPicks > 5) mktScore -= 6; else if (sellPicks > 2) mktScore -= 3;
              mktScore = Math.max(0, Math.min(100, mktScore));

              const mktVerdict = mktScore >= 70 ? t("tabs.home.strongBullish") : mktScore >= 55 ? t("tabs.home.weakBullish") : mktScore >= 45 ? t("tabs.home.mixed") : mktScore >= 30 ? t("tabs.home.bearish") : t("tabs.home.strongBearish");
              const mktColor = mktScore >= 60 ? C.green : mktScore >= 45 ? C.yellow : C.red;
              const now = new Date();
              const reportTime = now.toLocaleString("ko-KR", { hour: "2-digit", minute: "2-digit" });

              return (
                <div onClick={() => { setTab("quant-report"); if (Math.random() < 0.5) { ctaCountRef.current++; if (ctaCountRef.current % 3 === 0) setShowGoogleCTA(true); else setShowCoupangCTA(true); }; }} style={{ background: `linear-gradient(135deg, ${C.card}, ${mktScore >= 55 ? (C.isDark ? "#0d2818" : "#e8f5e9") : mktScore < 45 ? (C.isDark ? "#28100d" : "#fce4ec") : (C.isDark ? "#1a1a0d" : "#fff8e1")})`, borderRadius: "16px", padding: "20px", cursor: "pointer", border: `1px solid ${C.border}${C.isDark ? '18' : '40'}` }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
                    <span style={{ fontWeight: 700, fontSize: "18px", color: C.text1 }}>{t("tabs.home.quantReport")}</span>
                    <span style={{ fontSize: mf(11), color: C.text3 }}>{reportTime} {t("tabs.home.asOf")} →</span>
                  </div>

                  {/* 시장 점수 게이지 */}
                  <div style={{ display: "flex", alignItems: "center", gap: "16px", marginBottom: "16px" }}>
                    <div style={{ position: "relative", width: "60px", height: "60px", flexShrink: 0 }}>
                      <svg viewBox="0 0 60 60" width="60" height="60">
                        <circle cx="30" cy="30" r="25" fill="none" stroke={C.border} strokeWidth="4" />
                        <circle cx="30" cy="30" r="25" fill="none" stroke={mktColor} strokeWidth="4" strokeLinecap="round"
                          strokeDasharray={`${(mktScore / 100) * 157} 157`} transform="rotate(-90 30 30)" />
                        <text x="30" y="28" textAnchor="middle" fill={C.text1} fontSize="15" fontWeight="800">{mktScore}</text>
                        <text x="30" y="39" textAnchor="middle" fill={C.text3} fontSize="8">/100</text>
                      </svg>
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: "18px", fontWeight: 800, color: mktColor, marginBottom: "5px" }}>{mktVerdict}</div>
                      <div style={{ fontSize: "16px", color: C.text3, lineHeight: 1.5 }}>
                        {sp ? `S&P ${sp.change >= 0 ? "+" : ""}${sp.change}%` : ""}{nq ? ` · ${t("tabs.home.nasdaqLabel")} ${nq.change >= 0 ? "+" : ""}${nq.change}%` : ""}
                        {ks ? ` · ${t("tabs.home.kospiLabel")} ${ks.change >= 0 ? "+" : ""}${ks.change}%` : ""}
                      </div>
                    </div>
                  </div>

                  {/* 지표 그리드 */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "14px" }}>
                    <div style={{ padding: "10px 12px", borderRadius: "10px", background: `${C.green}10` }}>
                      <div style={{ fontSize: mf(11), color: C.text3, marginBottom: "3px" }}>{t("tabs.home.risingAssets")}</div>
                      <div style={{ fontSize: "18px", fontWeight: 700, color: C.green }}>{upCount}개 <span style={{ fontSize: "16px", color: C.text3 }}>/ {hotAssets.length}</span></div>
                    </div>
                    <div style={{ padding: "10px 12px", borderRadius: "10px", background: `${C.red}10` }}>
                      <div style={{ fontSize: mf(11), color: C.text3, marginBottom: "3px" }}>{t("tabs.home.fallingAssets")}</div>
                      <div style={{ fontSize: "18px", fontWeight: 700, color: C.red }}>{dnCount}개 <span style={{ fontSize: "16px", color: C.text3 }}>/ {hotAssets.length}</span></div>
                    </div>
                    <div style={{ padding: "10px 12px", borderRadius: "10px", background: `${C.yellow}10` }}>
                      <div style={{ fontSize: mf(11), color: C.text3, marginBottom: "3px" }}>{t("tabs.home.fearGreedLabel")}</div>
                      <div style={{ fontSize: "18px", fontWeight: 700, color: fg ? (fg > 60 ? C.green : fg > 40 ? C.yellow : C.red) : C.text3 }}>{fg || "—"} <span style={{ fontSize: "16px", color: C.text3 }}>{fg ? (fg <= 25 ? t("tabs.home.extremeFear") : fg <= 40 ? t("tabs.home.fear") : fg <= 60 ? t("tabs.home.neutral") : fg <= 75 ? t("tabs.home.greed") : t("tabs.home.extremeGreed")) : ""}</span></div>
                    </div>
                    <div style={{ padding: "10px 12px", borderRadius: "10px", background: `${C.blue}10` }}>
                      <div style={{ fontSize: mf(11), color: C.text3, marginBottom: "3px" }}>{t("tabs.home.recommendedBuy")}</div>
                      <div style={{ fontSize: "18px", fontWeight: 700, color: C.blue }}>{buyPicks}개 <span style={{ fontSize: "16px", color: C.text3 }}>/ {dailyPicks.length}</span></div>
                    </div>
                  </div>

                  {/* 요약 */}
                  <div style={{ fontSize: "16px", color: C.text3, lineHeight: 1.6, padding: "10px 0 0", borderTop: `1px solid ${C.border}20` }}>
                    {mktScore >= 60
                      ? `매수 우위 장세 — 상승 종목 ${upCount}개, 추천 ${buyPicks}개 감지`
                      : mktScore >= 45
                      ? `혼조 장세 — 방향성 확인 후 진입 권장`
                      : `약세 장세 — 리스크 관리 필수, 하락 종목 ${dnCount}개`
                    }
                  </div>
                </div>
              );
            })()}

            {/* ── 포트폴리오 미니 (토스 자산 카드 스타일) ─── */}
            {portfolio.length > 0 && (() => {
              let totalValue = 0, totalCost = 0;
              for (const item of portfolio) {
                const curPrice = portfolioPrices[item.symbol] || 0;
                const qty = parseFloat(item.qty) || 0;
                const avg = parseFloat(item.avgPrice) || 0;
                totalValue += curPrice * qty;
                totalCost += avg * qty;
              }
              const pnl = totalCost > 0 ? ((totalValue - totalCost) / totalCost * 100) : 0;
              const pnlAmt = totalValue - totalCost;
              return (
                <div onClick={() => { setTab("portfolio"); if (Math.random() < 0.5) { ctaCountRef.current++; if (ctaCountRef.current % 3 === 0) setShowGoogleCTA(true); else setShowCoupangCTA(true); }; }} style={{
                  background: C.card, borderRadius: "16px", padding: "20px 22px", cursor: "pointer",
                  transition: "transform .15s", border: `1px solid ${C.border}${C.isDark ? '18' : '40'}`,
                }}
                onMouseEnter={e => e.currentTarget.style.transform = "translateY(-1px)"}
                onMouseLeave={e => e.currentTarget.style.transform = "translateY(0)"}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "14px" }}>
                    <span style={{ fontWeight: 700, fontSize: "18px", color: C.text1 }}>{t("tabs.home.myPortfolio")}</span>
                    <span style={{ fontSize: "18px", color: C.text3 }}>{portfolio.length}개 →</span>
                  </div>
                  {totalValue > 0 ? (
                    <div style={{ display: "flex", alignItems: "baseline", gap: "10px", flexWrap: "wrap" }}>
                      <span style={{ fontWeight: 800, fontSize: "24px", color: C.text1, letterSpacing: "-0.5px" }}>
                        {currency === "KRW" ? `₩${Math.round(totalValue * krwRate).toLocaleString()}` : `$${totalValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
                      </span>
                      <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                        <span style={{ fontSize: "18px", fontWeight: 700, color: pnl >= 0 ? C.green : C.red }}>
                          {pnl >= 0 ? "+" : ""}{pnl.toFixed(2)}%
                        </span>
                        <span style={{ fontSize: "16px", color: C.text3 }}>
                          ({pnlAmt >= 0 ? "+" : ""}{currency === "KRW" ? `₩${Math.round(Math.abs(pnlAmt) * krwRate).toLocaleString()}` : `$${Math.abs(pnlAmt).toLocaleString(undefined, { maximumFractionDigits: 0 })}`})
                        </span>
                      </div>
                    </div>
                  ) : portfolio.length > 0 ? (
                    // 보유 종목은 있는데 가격 아직 안 옴 → 스켈레톤
                    <div style={{ display: "flex", alignItems: "baseline", gap: "10px" }}>
                      <Skeleton width="140px" height="28px" />
                      <Skeleton width="80px" height="20px" />
                    </div>
                  ) : (
                    // 보유 종목 자체가 없음 → 친화적 엠티 스테이트
                    <div style={{ fontSize: "15px", color: C.text3, lineHeight: 1.5 }}>
                      관심 종목을 추가하면 한눈에 수익률을 볼 수 있어요 ✨
                    </div>
                  )}
                </div>
              );
            })()}

            {/* ── 경제 캘린더 (정렬/필터/년월일 표시) ─── */}
            {econEvents.length > 0 && (() => {
              const showEvents = econExpanded ? filteredEconEvents : filteredEconEvents.slice(0, 6);
              const filterTabs = [
                { key: "all", label: "전체" },
                { key: "upcoming", label: "예정" },
                { key: "past", label: "지난" },
                { key: "FOMC", label: "FOMC" },
                { key: "CPI", label: "CPI" },
                { key: "NFP", label: "고용" },
                { key: "GDP", label: "GDP" },
                { key: "PCE", label: "PCE" },
              ];

              return (
                <div style={{ background: C.card, borderRadius: "16px", padding: "20px", border: `1px solid ${C.border}${C.isDark ? '18' : '40'}` }}>
                  {/* 헤더 */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "14px" }}>
                    <span style={{ fontWeight: 700, fontSize: "18px", color: C.text1 }}>경제 캘린더 <span style={{ fontSize: "16px", fontWeight: 500, color: C.text3 }}>(KST)</span></span>
                    <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                      {/* 정렬 토글 */}
                      <button onClick={() => setEconSort(p => p === "date-asc" ? "date-desc" : p === "date-desc" ? "type" : "date-asc")}
                        style={{
                          background: C.card2, border: "none", borderRadius: "6px", padding: "4px 8px",
                          fontSize: mf(10), fontWeight: 600, color: C.text3, cursor: "pointer",
                        }}
                        title="정렬 변경">
                        {econSort === "date-asc" ? "날짜순 ↑" : econSort === "date-desc" ? "날짜순 ↓" : "유형별"}
                      </button>
                      <button onClick={() => setEconExpanded(p => !p)} style={{
                        background: "none", border: "none", fontSize: mf(11), color: C.blue, cursor: "pointer", padding: "4px 6px", fontWeight: 600,
                      }}>{econExpanded ? "접기" : `더보기 (${filteredEconEvents.length})`}</button>
                    </div>
                  </div>

                  {/* 필터 탭 */}
                  <div style={{ display: "flex", gap: "4px", marginBottom: "10px", overflow: "auto", paddingBottom: "2px" }}>
                    {filterTabs.map(ft => (
                      <button key={ft.key} onClick={() => setEconFilter(ft.key)} style={{
                        padding: "4px 10px", borderRadius: "6px", fontSize: mf(11), fontWeight: 600, flexShrink: 0,
                        background: econFilter === ft.key ? C.blueBg : "transparent",
                        color: econFilter === ft.key ? C.blue : C.text3,
                        border: `1px solid ${econFilter === ft.key ? `${C.blue}44` : "transparent"}`,
                        cursor: "pointer",
                      }}>{ft.label}</button>
                    ))}
                  </div>

                  {/* 테이블 헤더 */}
                  <div style={{
                    display: "grid", gridTemplateColumns: isMobile ? "60px 1fr 50px" : "90px 1fr 48px 48px 48px",
                    gap: "4px", padding: "6px 6px", marginBottom: "2px",
                    fontSize: mf(10), fontWeight: 700, color: C.text3, letterSpacing: "0.02em",
                    borderBottom: `1px solid ${C.border}20`,
                  }}>
                    <span>날짜</span>
                    <span>이벤트</span>
                    <span style={{ textAlign: "right" }}>실제</span>
                    {!isMobile && <span style={{ textAlign: "right" }}>예상</span>}
                    {!isMobile && <span style={{ textAlign: "right" }}>이전</span>}
                  </div>

                  {/* 이벤트 리스트 */}
                  {showEvents.length === 0 ? (
                    <div style={{ textAlign: "center", padding: "20px", color: C.text3, fontSize: "16px" }}>
                      해당 필터에 맞는 이벤트가 없습니다
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column" }}>
                      {showEvents.map((evt, i) => {
                        const statusColor = evt.status === "오늘" ? C.red : evt.status === "임박" ? C.yellow : evt.status === "완료" || evt.status === "어제" ? C.text3 : C.text2;
                        // CPI, PCE, PPI, 실업률 → 낮을수록 호재(역방향)
                        const invertedIndicator = /CPI|PCE|PPI|Unemployment/i.test(evt.event);
                        const hasActual = evt.actual != null && evt.estimate != null;
                        const beat = hasActual ? (invertedIndicator ? evt.actual < evt.estimate : evt.actual > evt.estimate) : null;
                        const miss = hasActual ? (invertedIndicator ? evt.actual > evt.estimate : evt.actual < evt.estimate) : null;
                        const surprise = hasActual ? Math.abs(evt.actual - evt.estimate).toFixed(1) : null;
                        const isPast = evt.daysUntil < 0;
                        // 한국 시간 기준 날짜 표시 (안전한 KST 시프트 헬퍼)
                        const k = kstParts(evt.date);
                        const y = k.valid ? k.year : "—";
                        const m = k.valid ? String(k.month + 1).padStart(2, "0") : "--";
                        const d = k.valid ? String(k.date).padStart(2, "0") : "--";
                        const dayName = k.valid ? ["일","월","화","수","목","금","토"][k.day] : "";
                        const kstHour = k.valid ? String(k.hour).padStart(2, "0") : "--";
                        const kstMin = k.valid ? String(k.min).padStart(2, "0") : "--";

                        return (
                          <div key={`${evt.event}-${y}${m}${d}-${i}`} style={{
                            display: "grid", gridTemplateColumns: isMobile ? "60px 1fr 50px" : "90px 1fr 48px 48px 48px",
                            gap: "4px", alignItems: "center",
                            padding: "9px 8px",
                            opacity: isPast ? 0.65 : 1,
                            borderBottom: i < showEvents.length - 1 ? `1px solid ${C.border}10` : "none",
                            background: evt.status === "오늘" ? `${C.red}08` : "transparent",
                            borderRadius: evt.status === "오늘" ? "8px" : "0",
                            transition: "background .15s",
                          }}
                          onMouseEnter={e => { if (evt.status !== "오늘") e.currentTarget.style.background = `${C.card2}80`; }}
                          onMouseLeave={e => { if (evt.status !== "오늘") e.currentTarget.style.background = "transparent"; }}>
                            {/* 날짜: YYYY.MM.DD (요일) */}
                            <div style={{ flexShrink: 0 }}>
                              <div style={{ fontSize: "16px", fontWeight: 700, color: C.text1, fontVariantNumeric: "tabular-nums" }}>
                                {y}.{m}.{d}
                              </div>
                              <div style={{ display: "flex", alignItems: "center", gap: "4px", marginTop: "1px" }}>
                                <span style={{ fontSize: mf(10), color: C.text3 }}>{dayName} {kstHour}:{kstMin}</span>
                                <span style={{
                                  fontSize: "14px", fontWeight: 700, padding: "1px 4px", borderRadius: "4px",
                                  background: evt.status === "오늘" ? C.redBg : evt.status === "임박" ? C.yellowBg : evt.status === "예정" ? C.blueBg : C.card2,
                                  color: evt.status === "오늘" ? C.red : evt.status === "임박" ? C.yellow : evt.status === "예정" ? C.blue : C.text3,
                                }}>{evt.status}</span>
                              </div>
                            </div>

                            {/* 이벤트명 + 아이콘 */}
                            <div style={{ minWidth: 0, overflow: "hidden" }}>
                              <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                                <span style={{ fontSize: "18px", flexShrink: 0 }}>{evt.icon}</span>
                                <span style={{
                                  fontWeight: 600, fontSize: "16px", color: C.text1,
                                  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                                }}>{evt.name}</span>
                              </div>
                              {evt.daysUntil > 0 && (
                                <div style={{ fontSize: mf(10), color: C.text3, marginTop: "1px" }}>{evt.daysUntil}일 후</div>
                              )}
                            </div>

                            {/* 실제 */}
                            <div style={{ textAlign: "right" }}>
                              {evt.actual != null ? (
                                <div>
                                  <div style={{
                                    fontSize: "16px", fontWeight: 700, fontVariantNumeric: "tabular-nums",
                                    color: beat ? C.green : miss ? C.red : C.text1,
                                  }}>
                                    {evt.actual}{evt.unit}
                                    {beat && <span style={{ fontSize: mf(9), marginLeft: "1px" }}>▲</span>}
                                    {miss && <span style={{ fontSize: mf(9), marginLeft: "1px" }}>▼</span>}
                                  </div>
                                  {surprise && surprise !== "0.0" && (
                                    <div style={{ fontSize: "14px", fontWeight: 600, color: beat ? C.green : C.red, opacity: 0.8 }}>
                                      {beat ? "호재" : "악재"} {surprise}p
                                    </div>
                                  )}
                                </div>
                              ) : (
                                isPast ? <span style={{ fontSize: mf(10), color: C.yellow }}>발표 대기</span> :
                                <span style={{ fontSize: mf(11), color: C.text3 }}>—</span>
                              )}
                            </div>

                            {/* 예상 */}
                            {!isMobile && <div style={{ textAlign: "right" }}>
                              {evt.estimate != null ? (
                                <span style={{ fontSize: "16px", color: C.text2, fontVariantNumeric: "tabular-nums" }}>
                                  {evt.estimate}{evt.unit}
                                </span>
                              ) : (
                                <span style={{ fontSize: mf(11), color: C.text3 }}>—</span>
                              )}
                            </div>}

                            {/* 이전 */}
                            {!isMobile && <div style={{ textAlign: "right" }}>
                              {evt.previous != null ? (
                                <span style={{ fontSize: "16px", color: C.text3, fontVariantNumeric: "tabular-nums" }}>
                                  {evt.previous}{evt.unit}
                                </span>
                              ) : (
                                <span style={{ fontSize: mf(11), color: C.text3 }}>—</span>
                              )}
                            </div>}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* 요약 바 */}
                  {filteredEconEvents.length > 6 && !econExpanded && (
                    <div style={{ textAlign: "center", paddingTop: "8px" }}>
                      <button onClick={() => setEconExpanded(true)} style={{
                        background: C.card2, border: "none", borderRadius: "8px", padding: "6px 16px",
                        fontSize: "16px", fontWeight: 600, color: C.text2, cursor: "pointer",
                      }}>+ {filteredEconEvents.length - 6}개 더 보기</button>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* 쿠팡 파트너스 배너 — 사이드바 */}
            <CoupangOfficialBanner width="320" height="100" bannerId={975393} style={{ margin: "4px 0", borderRadius: "12px", overflow: "hidden" }} />

            </div>{/* end home-right */}
            </div>{/* end home-grid */}

            {/* 홈 하단 광고 제거 — 다른 탭으로 분산 배치 */}

            {/* ═══ 하단 전체너비 섹션 (그리드 밖) ═══ */}

            {/* ── AI 퀀트 전략 하이라이트 (핵심 기능 → 최상단) ─── */}
            <div onClick={() => { setTab("auto-trading"); if (Math.random() < 0.5) { ctaCountRef.current++; if (ctaCountRef.current % 3 === 0) setShowGoogleCTA(true); else setShowCoupangCTA(true); }; }} className="ui-card-premium" style={{
              cursor: "pointer", transition: "all .2s",
              position: "relative", overflow: "hidden",
            }}
            onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-3px)"; e.currentTarget.style.boxShadow = `0 12px 40px ${C.purple}25`; }}
            onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = ""; }}>
              <div style={{ position: "absolute", top: "-20px", right: "-10px", fontSize: "80px", opacity: 0.06 }}>🤖</div>
              <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
                <div style={{
                  width: "48px", height: "48px", borderRadius: "12px",
                  background: `linear-gradient(135deg, ${C.purple}, #6D28D9)`,
                  display: "flex", alignItems: "center", justifyContent: "center", fontSize: "24px", flexShrink: 0,
                }}>🤖</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 800, fontSize: "18px", color: C.text1, marginBottom: "4px" }}>AI 퀀트 전략</div>
                  <div style={{ fontSize: "16px", color: C.text3, lineHeight: 1.4 }}>
                    AI 기반 자동매매 · 주식/크립토 통합 · 실시간 시그널
                  </div>
                </div>
                <div style={{
                  padding: "8px 16px", borderRadius: "10px", fontSize: "16px", fontWeight: 700,
                  background: `${C.purple}20`, color: C.purple, flexShrink: 0,
                }}>바로가기 →</div>
              </div>
            </div>

            {/* ── 전략 운용 + 리스크 바로가기 위젯 ─── */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
              <div onClick={() => { setTab("quant-port"); if (Math.random() < 0.5) { ctaCountRef.current++; if (ctaCountRef.current % 3 === 0) setShowGoogleCTA(true); else setShowCoupangCTA(true); }; }} style={{
                background: `linear-gradient(135deg, ${C.card} 0%, ${C.greenBg} 100%)`,
                borderRadius: "16px", padding: "20px", cursor: "pointer", transition: "all .2s",
                border: `1px solid ${C.border}20`,
              }}
              onMouseEnter={e => e.currentTarget.style.transform = "translateY(-2px)"}
              onMouseLeave={e => e.currentTarget.style.transform = "translateY(0)"}>
                <div style={{ fontSize: "24px", marginBottom: "8px" }}>📊</div>
                <div style={{ fontWeight: 700, fontSize: "18px", marginBottom: "5px", color: C.text1 }}>전략 운용</div>
                <div style={{ fontSize: "16px", color: C.text3 }}>33개 전략 포트폴리오</div>
                <div style={{ fontSize: "16px", color: C.green, fontWeight: 600, marginTop: "6px" }}>
                  실시간 수익률 추적 →
                </div>
              </div>
              <div onClick={() => { setTab("risk-map"); if (Math.random() < 0.5) { ctaCountRef.current++; if (ctaCountRef.current % 3 === 0) setShowGoogleCTA(true); else setShowCoupangCTA(true); }; }} style={{
                background: `linear-gradient(135deg, ${C.card} 0%, ${C.redBg} 100%)`,
                borderRadius: "16px", padding: "20px", cursor: "pointer", transition: "all .2s",
                border: `1px solid ${C.border}20`,
              }}
              onMouseEnter={e => e.currentTarget.style.transform = "translateY(-2px)"}
              onMouseLeave={e => e.currentTarget.style.transform = "translateY(0)"}>
                <div style={{ fontSize: "24px", marginBottom: "8px" }}>🛡️</div>
                <div style={{ fontWeight: 700, fontSize: "18px", marginBottom: "5px", color: C.text1 }}>리스크 관리</div>
                <div style={{ fontSize: "16px", color: C.text3 }}>8-Point 히트맵</div>
                <div style={{ fontSize: "16px", color: C.red, fontWeight: 600, marginTop: "6px" }}>
                  위험 수준 확인 →
                </div>
              </div>
            </div>

            {/* ── 섹터 히트맵 (접기/펼치기) ─── */}
            {sectorPerf.length > 0 && (
              <div style={{ background: C.card, borderRadius: "16px", padding: "20px", border: `1px solid ${C.border}${C.isDark ? '18' : '40'}` }}>
                <div onClick={() => toggleSection("sector")} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}>
                  <span style={{ fontWeight: 700, fontSize: "18px", color: C.text1 }}>섹터 성과</span>
                  <span style={{ fontSize: "16px", color: C.text3 }}>{homeSection.sector ? "▲" : "▼"}</span>
                </div>
                {!homeSection.sector && (
                  <div style={{ display: "flex", gap: "6px", marginTop: "8px", overflow: "auto", paddingBottom: "2px" }}>
                    {sectorPerf.slice(0, 5).map(sec => (
                      <div key={sec.symbol} style={{
                        padding: "6px 10px", borderRadius: "8px", fontSize: mf(11), fontWeight: 600, flexShrink: 0,
                        background: sec.change1d >= 0 ? C.greenBg : C.redBg,
                        color: sec.change1d >= 0 ? C.green : C.red,
                      }}>{sec.icon} {sec.change1d >= 0 ? "+" : ""}{sec.change1d}%</div>
                    ))}
                  </div>
                )}
                {homeSection.sector && (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(80px, 1fr))", gap: "6px", marginTop: "10px" }}>
                    {sectorPerf.map(sec => {
                      const intensity = Math.min(Math.abs(sec.change1d) / 3, 1);
                      const bg = sec.change1d >= 0
                        ? `rgba(5, 192, 114, ${0.08 + intensity * 0.22})`
                        : `rgba(240, 68, 82, ${0.08 + intensity * 0.22})`;
                      return (
                        <div key={sec.symbol} onClick={() => setChartAsset({ symbol: sec.symbol, name: `${sec.name} ETF`, market: "us", symbolRaw: sec.symbol })}
                          style={{ background: bg, borderRadius: "10px", padding: "10px 6px", textAlign: "center", cursor: "pointer" }}>
                          <div style={{ fontSize: "18px" }}>{sec.icon}</div>
                          <div style={{ fontSize: mf(10), fontWeight: 600, color: C.text2, margin: "2px 0" }}>{sec.name}</div>
                          <div style={{ fontSize: "18px", fontWeight: 800, color: sec.change1d >= 0 ? C.green : C.red }}>
                            {sec.change1d >= 0 ? "+" : ""}{sec.change1d}%
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* ── 전체 종목 (접기/펼치기) ─── */}
            <div style={{ background: C.card, borderRadius: "16px", padding: "20px", border: `1px solid ${C.border}${C.isDark ? '18' : '40'}` }}>
              <div onClick={() => toggleSection("allAssets")} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}>
                <span style={{ fontWeight: 700, fontSize: "18px", color: C.text1 }}>전체 종목</span>
                <span style={{ fontSize: "16px", color: C.text3 }}>{ALL_ASSETS.length}개 {homeSection.allAssets ? "▲" : "▼"}</span>
              </div>
              {homeSection.allAssets && (
                <>
                  <div style={{ display: "flex", gap: "6px", margin: "10px 0", flexWrap: "wrap" }}>
                    {[["all","전체"], ["us","🇺🇸 미국"], ["kr","🇰🇷 한국"], ["crypto","₿ 크립토"]].map(([v, l]) => (
                      <button key={v} onClick={() => setFilterMarket(v)} style={{
                        padding: "5px 12px", borderRadius: "8px", fontSize: mf(11), fontWeight: 600,
                        background: filterMarket === v ? C.blueBg : "transparent",
                        color: filterMarket === v ? C.blue : C.text3, border: `1px solid ${filterMarket === v ? C.blue : C.border2}`,
                      }}>{l}</button>
                    ))}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill, minmax(150px, 1fr))", gap: "4px", maxHeight: "280px", overflow: "auto" }}>
                    {ALL_ASSETS.filter(a => filterMarket === "all" || a.market === filterMarket).map((asset, i) => {
                      const flag = asset.market === "us" ? "🇺🇸" : asset.market === "kr" ? "🇰🇷" : "₿";
                      return (
                        <div key={`${asset.symbol}-${i}`}
                          onTouchStart={onTouchCardStart} onTouchMove={onTouchCardMove}
                          onClick={() => { if (isTouchTap()) { setSelectedAsset(asset); if (Math.random() < 0.5) { ctaCountRef.current++; if (ctaCountRef.current % 3 === 0) setShowGoogleCTA(true); else setShowCoupangCTA(true); }; } }}
                          style={{
                            padding: "8px 10px", borderRadius: "8px", cursor: "pointer",
                            display: "flex", alignItems: "center", gap: "6px", transition: "background .15s",
                          }}
                          onMouseEnter={e => e.currentTarget.style.background = C.card2}
                          onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                          <span style={{ fontSize: mf(11) }}>{flag}</span>
                          <div style={{ minWidth: 0, overflow: "hidden" }}>
                            <div style={{ fontWeight: 600, fontSize: "16px", color: C.text1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{asset.name}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>

            {/* 쿠팡 검색 위젯 — 홈 하단 */}
            <CoupangSearchWidget style={{ margin: "12px 0" }} />

            {/* ── 푸터 ── */}
            <div style={{
              marginTop: "32px", paddingTop: "24px",
              borderTop: `1px solid ${C.border}20`,
              display: "flex", flexWrap: "wrap", justifyContent: "center",
              gap: "16px", fontSize: "14px", color: C.text3,
            }}>
              <span onClick={() => setTab("about")} style={{ cursor: "pointer", transition: "color .15s" }}
                onMouseEnter={e => e.target.style.color = C.text2}
                onMouseLeave={e => e.target.style.color = C.text3}
              >서비스 소개</span>
              <span>·</span>
              <span onClick={() => setTab("privacy")} style={{ cursor: "pointer", transition: "color .15s" }}
                onMouseEnter={e => e.target.style.color = C.text2}
                onMouseLeave={e => e.target.style.color = C.text3}
              >개인정보처리방침</span>
              <span>·</span>
              <span onClick={() => setTab("terms")} style={{ cursor: "pointer", transition: "color .15s" }}
                onMouseEnter={e => e.target.style.color = C.text2}
                onMouseLeave={e => e.target.style.color = C.text3}
              >이용약관</span>
              <span>·</span>
              <span onClick={() => setTab("contact")} style={{ cursor: "pointer", transition: "color .15s" }}
                onMouseEnter={e => e.target.style.color = C.text2}
                onMouseLeave={e => e.target.style.color = C.text3}
              >문의하기</span>
            </div>
            <div style={{
              textAlign: "center", fontSize: "12px", color: C.text3,
              paddingTop: "12px", paddingBottom: "20px", opacity: 0.6,
            }}>
              © 2026 Zepta. All rights reserved.
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════
            TAB: 스크리너
        ═══════════════════════════════════════════════════════════ */}
        {tab === "screener" && (
          <div className="tab-content">
            {/* ── 스크리너 헤더 (그래디언트 히어로 스타일) ── */}
            <div style={{ background: `linear-gradient(135deg, ${C.blueBg} 0%, ${C.card} 100%)`, borderRadius: "24px", padding: "28px", marginBottom: "20px", boxShadow: `0 4px 16px ${C.blue}15` }}>
              <div style={{ fontWeight: 800, fontSize: "24px", color: C.text1 }}>{t("tabs.screener.title")}</div>
              <div style={{ fontSize: mf(14), color: C.text3, marginTop: "4px" }}>{t("tabs.screener.subtitle")}</div>
            </div>

            {/* ── 스크리너 프리셋 (토스 스타일) ── */}
            <div style={{ marginBottom: "16px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "14px" }}>
                <div style={{ fontWeight: 700, fontSize: mf(16), color: C.text1 }}>프리셋 선택</div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(auto-fill, minmax(200px, 1fr))", gap: "10px" }}>
                {SCREENER_PRESETS.map(preset => {
                  const isActive = activePreset === preset.id;
                  const presetColor = preset.color === "green" ? C.green : preset.color === "blue" ? C.blue : preset.color === "red" ? C.red : preset.color === "yellow" ? C.yellow : C.purple;
                  const presetBg = preset.color === "green" ? C.greenBg : preset.color === "blue" ? C.blueBg : preset.color === "red" ? C.redBg : preset.color === "yellow" ? C.yellowBg : C.purpleBg;
                  return (
                    <button key={preset.id} onClick={() => {
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
                      padding: isMobile ? "10px 12px" : "12px 14px", borderRadius: "12px", textAlign: "left", cursor: "pointer", minHeight: "44px", display: "flex", flexDirection: "column", justifyContent: "center",
                      background: isActive ? presetBg : `linear-gradient(135deg, ${C.card} 0%, ${C.card2} 100%)`,
                      border: `1px solid ${isActive ? `${presetColor}40` : `${C.border}20`}`,
                      transition: "all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)", position: "relative", overflow: "hidden",
                      boxShadow: isActive ? `0 8px 20px ${presetColor}40, inset 0 1px 0 ${presetColor}30` : "none",
                    }}
                    onMouseEnter={e => {
                      if (!isActive) {
                        e.currentTarget.style.transform = "scale(1.02) translateY(-3px)";
                        e.currentTarget.style.boxShadow = `0 12px 24px ${presetColor}30`;
                        e.currentTarget.style.borderColor = `${presetColor}50`;
                      } else {
                        e.currentTarget.style.boxShadow = `0 12px 28px ${presetColor}50, inset 0 1px 0 ${presetColor}40`;
                      }
                    }}
                    onMouseLeave={e => {
                      if (!isActive) {
                        e.currentTarget.style.transform = "scale(1) translateY(0)";
                        e.currentTarget.style.boxShadow = "none";
                        e.currentTarget.style.borderColor = `${C.border}20`;
                      } else {
                        e.currentTarget.style.boxShadow = `0 8px 20px ${presetColor}40, inset 0 1px 0 ${presetColor}30`;
                      }
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                        <span style={{ fontSize: mf(17) }}>{preset.icon}</span>
                        <span style={{ fontWeight: 700, fontSize: mf(15), color: isActive ? presetColor : C.text1 }}>{preset.name}</span>
                        {preset.popular && <span style={{ fontSize: "12px", padding: "2px 6px", borderRadius: "4px", background: `${C.red}20`, color: C.red, fontWeight: 700 }}>{t("tabs.screener.popular")}</span>}
                      </div>
                      <div style={{ fontSize: mf(13), color: isActive ? presetColor : C.text3, lineHeight: 1.4 }}>{preset.desc}</div>
                      {isActive && <div style={{ position: "absolute", top: "8px", right: "8px", width: "20px", height: "20px", borderRadius: "50%", background: presetColor, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "16px", color: "#fff" }}>✓</div>}
                    </button>
                  );
                })}
              </div>

              {/* ── 프리셋 선택 후 스캔 버튼 (프리셋 바로 아래) ── */}
              {activePreset && (
                <div style={{ display: "flex", alignItems: "center", gap: "10px", marginTop: "12px", flexWrap: "wrap" }}>
                  <button onClick={runScan} disabled={scanning || conditions.length === 0} style={{
                    padding: isMobile ? "12px 16px" : "10px 20px", borderRadius: "10px", fontSize: mf(15), fontWeight: 700,
                    background: scanning ? C.card2 : `linear-gradient(135deg, ${C.blue} 0%, ${C.purple} 100%)`, color: scanning ? C.text3 : "#fff",
                    border: "none", cursor: scanning ? "not-allowed" : "pointer", minWidth: isMobile ? "100%" : "100px", minHeight: "44px",
                    transition: "all 0.3s ease", boxShadow: !scanning ? `0 4px 12px ${C.blue}40` : "none",
                  }}
                  onMouseEnter={e => { if (!scanning) { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = `0 8px 20px ${C.blue}50`; } }}
                  onMouseLeave={e => { if (!scanning) { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = `0 4px 12px ${C.blue}40`; } }}>
                    {scanning
                      ? <span style={{ display: "flex", alignItems: "center", gap: "6px", justifyContent: "center" }}>
                          <span style={{ animation: "pulse 1s infinite" }}>⏳</span> {scanProgress.done}/{scanProgress.total}
                        </span>
                      : `🔍 스캔하기`}
                  </button>
                  {scanning && (
                    <div style={{ flex: 1, minWidth: "80px" }}>
                      <div style={{ height: "4px", background: C.border2, borderRadius: "4px", overflow: "hidden" }}>
                        <div style={{ height: "100%", background: C.blue, borderRadius: "4px", width: `${scanProgress.total ? (scanProgress.done / scanProgress.total) * 100 : 0}%`, transition: "width .3s" }} />
                      </div>
                    </div>
                  )}
                  {lastScan && !scanning && (
                    <span style={{ fontSize: mf(16), color: C.text3 }}>마지막: {lastScan.toLocaleTimeString("ko-KR")}</span>
                  )}
                  <span style={{ fontSize: "16px", color: C.text3 }}>{conditions.length}{t("tabs.screener.conditionsAppliedCount")}</span>
                </div>
              )}
            </div>

            {/* ── 직접 조건 설정 (접이식) ── */}
            <details style={{ marginBottom: "16px" }} open={!activePreset}>
              <summary style={{
                padding: "14px 20px", borderRadius: "12px", cursor: "pointer",
                background: C.card, border: `1px solid ${C.border}20`,
                fontWeight: 700, fontSize: "18px", color: C.text1,
                display: "flex", alignItems: "center", gap: "8px", listStyle: "none",
              }}>
                <span>⚙️ {t("tabs.screener.customSettings")}</span>
                <span style={{ fontSize: mf(16), color: C.text3, fontWeight: 500, marginLeft: "auto" }}>
                  {conditions.length > 0 ? `${conditions.length}${t("tabs.screener.conditionsApplied")}` : t("tabs.screener.selectConditions")}
                </span>
              </summary>
            <div style={{ background: C.card, border: `1px solid ${C.border}20`, borderRadius: "0 0 18px 18px", padding: "22px 24px", marginTop: "-1px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", marginBottom: "16px" }}>
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

              {/* 구조적 시그널 */}
              <div style={{ fontSize: "15px", color: C.text3, fontWeight: 600, letterSpacing: ".05em", marginBottom: "8px", marginTop: "12px" }}>구조적 시그널</div>
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
                  background: C.blueBg, border: `1px solid ${C.blue}33`, fontSize: "18px", color: C.blue,
                }}>
                  💡 위에서 스크리닝 조건을 1개 이상 선택한 후 스캔을 시작하세요
                </div>
              )}
              <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
                <button onClick={runScan} disabled={scanning || conditions.length === 0} style={{
                  padding: isMobile ? "14px 16px" : "11px 24px", borderRadius: "12px", fontSize: mf(18), fontWeight: 700,
                  background: scanning ? C.card2 : conditions.length === 0 ? C.card2 : C.blue,
                  color: scanning || conditions.length === 0 ? C.text3 : "#fff", border: "none",
                  minWidth: isMobile ? "100%" : "120px", minHeight: "48px", opacity: conditions.length === 0 ? 0.6 : 1,
                }}>
                  {scanning
                    ? <span style={{ display: "flex", alignItems: "center", gap: "8px", justifyContent: "center" }}>
                        <span style={{ animation: "pulse 1s infinite" }}>⏳</span> {scanProgress.done}/{scanProgress.total}
                      </span>
                    : `🔍 ${ALL_ASSETS.length}종목 스캔 ${conditions.length > 0 ? `(${conditions.length}개 조건)` : ""}`}
                </button>
                {scanning && (
                  <div style={{ flex: 1, minWidth: "120px" }}>
                    <div style={{ height: "4px", background: C.border2, borderRadius: "4px", overflow: "hidden" }}>
                      <div style={{
                        height: "100%", background: C.blue, borderRadius: "4px",
                        width: `${scanProgress.total ? (scanProgress.done / scanProgress.total) * 100 : 0}%`, transition: "width .3s",
                      }} />
                    </div>
                  </div>
                )}
                {lastScan && !scanning && (
                  <span style={{ fontSize: mf(16), color: C.text3 }}>마지막: {lastScan.toLocaleTimeString("ko-KR")}</span>
                )}
              </div>

              {scanErrors.length > 0 && (
                <details style={{ marginTop: "10px" }}>
                  <summary style={{ fontSize: "16px", color: C.text3, cursor: "pointer" }}>⚠️ {scanErrors.length}개 오류</summary>
                  <div style={{ marginTop: "6px", fontSize: "16px", color: C.red, lineHeight: 1.6, maxHeight: "80px", overflow: "auto" }}>
                    {scanErrors.map((e, i) => <div key={i}>{e}</div>)}
                  </div>
                </details>
              )}
            </div>
            </details>

            {/* 결과 필터 */}
            {results.length > 0 && (
              <div style={{ display: "flex", gap: "7px", alignItems: "center", marginBottom: "12px", flexWrap: "wrap" }}>
                <span style={{ fontSize: mf(17), color: C.text2, fontWeight: 600 }}>🎯 {filtered.length}개</span>
                {["all","us","kr","crypto"].map(m => (
                  <button key={m} onClick={() => setFilterMarket(m)} style={{
                    padding: "4px 10px", borderRadius: "8px", fontSize: mf(16), fontWeight: 600,
                    background: filterMarket === m ? C.blueBg : "transparent",
                    color: filterMarket === m ? C.blue : C.text3, border: `1px solid ${filterMarket === m ? C.blue : C.border2}`,
                  }}>{m === "all" ? "전체" : m === "us" ? "🇺🇸 미국" : m === "kr" ? "🇰🇷 한국" : "₿ 크립토"}</button>
                ))}
                <div style={{ marginLeft: "auto", display: "flex", gap: "5px", alignItems: "center" }}>
                  <span style={{ fontSize: mf(16), color: C.text3 }}>정렬</span>
                  {[["score","퀀트점수"], ["rsi","RSI"], ["change","변동률"], ["vol","거래량"], ["signals","시그널"]].map(([v, l]) => (
                    <button key={v} onClick={() => setSortBy(v)} style={{
                      padding: "3px 8px", borderRadius: "6px", fontSize: mf(16), fontWeight: 600,
                      background: sortBy === v ? C.blueBg : "transparent", color: sortBy === v ? C.blue : C.text3,
                      border: `1px solid ${sortBy === v ? C.blue : C.border2}`,
                    }}>{l}</button>
                  ))}
                </div>
              </div>
            )}

            {/* 대기 상태 */}
            {!scanning && results.length === 0 && (
              <div style={{ background: C.card, border: `1px solid ${C.border}20`, borderRadius: "16px", padding: "48px 24px", textAlign: "center" }}>
                <div style={{ fontSize: mf(44), marginBottom: "16px" }}>{lastScan ? "🔍" : "📡"}</div>
                <div style={{ fontWeight: 700, fontSize: mf(18), marginBottom: "8px", color: C.text1 }}>
                  {lastScan ? "시그널 없음" : "스캔 대기 중"}
                </div>
                <div style={{ color: C.text3, fontSize: mf(18), lineHeight: 1.7 }}>
                  {lastScan ? (
                    <>선택한 조건에 해당하는 종목이 없습니다<br />조건을 변경하거나 OR 모드를 사용해보세요</>
                  ) : (
                    <>조건 선택 후 <strong style={{ color: C.blue }}>스캔 시작</strong>을 눌러주세요<br />
                    미국 · 한국 주식 + 크립토 {US_ASSETS.length + KR_ASSETS.length + CRYPTO_ASSETS.length}개 자산 분석</>
                  )}
                </div>
                {lastScan && (
                  <div style={{ fontSize: "16px", color: C.text3, marginTop: "12px" }}>
                    마지막 스캔: {lastScan.toLocaleTimeString("ko-KR")}
                    {scanErrors.length > 0 && <span style={{ color: C.yellow, marginLeft: "8px" }}>⚠️ {scanErrors.length}건 오류</span>}
                  </div>
                )}
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {filtered.map((asset, i) => (
                <AssetCard key={`${asset.symbol}-${i}`} asset={asset} onChart={() => setChartAsset(asset)} isMobile={isMobile} />
              ))}
            </div>

            {/* ── Google AdSense (Screener - In-Feed) ─── */}
            {results.length > 0 && <GoogleAd format="in-feed" slot="screener-results" style={{ margin: "16px 0" }} />}

            {!scanning && results.length > 0 && filtered.length === 0 && (
              <div style={{ background: C.card, borderRadius: "16px", padding: "32px", textAlign: "center" }}>
                <div style={{ fontSize: "32px", marginBottom: "8px" }}>🏷️</div>
                <div style={{ fontWeight: 600, fontSize: mf(18), color: C.text2, marginBottom: "4px" }}>선택한 시장에 시그널 없음</div>
                <div style={{ fontSize: mf(16), color: C.text3 }}>다른 시장 필터를 선택해보세요 (전체 {results.length}건 발견)</div>
              </div>
            )}


            {/* ═══════════════════════════════════════════════════════
                저평가 종목 통합 조회
            ═══════════════════════════════════════════════════════ */}
            <div style={{ background: C.card, border: `1px solid ${C.border}20`, borderRadius: "16px", padding: "22px 24px", marginTop: "20px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px", flexWrap: "wrap", gap: "10px" }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: mf(18), marginBottom: "3px", color: C.text1 }}>💎 저평가 종목 통합 조회</div>
                  <div style={{ fontSize: mf(16), color: C.text3 }}>PER · PBR · 배당률 · 애널리스트 목표가 · 52주 위치 종합 분석</div>
                </div>
                <button onClick={runValueScan} disabled={valueScanning} style={{
                  padding: isMobile ? "12px 16px" : "10px 20px", borderRadius: "12px", fontSize: mf(17), fontWeight: 700,
                  background: valueScanning ? C.card2 : C.green, color: valueScanning ? C.text3 : "#fff",
                  border: "none", whiteSpace: "nowrap", minHeight: "44px",
                }}>
                  {valueScanning
                    ? <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <span style={{ animation: "pulse 1s infinite" }}>⏳</span> {valueScanProgress.done}/{valueScanProgress.total}
                      </span>
                    : "💎 저평가 스캔"}
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
                  마지막 스캔: {valueLastScan.toLocaleTimeString("ko-KR")} · 전체 {valueResults.length}개 분석 · 저평가 {filteredValue.length}개 발견
                </div>
              )}

              {/* 필터 + 정렬 */}
              {valueResults.length > 0 && (
                <div style={{ display: "flex", gap: "6px", alignItems: "center", marginBottom: "12px", flexWrap: "wrap" }}>
                  {[["all","전체"], ["us","🇺🇸 미국"], ["kr","🇰🇷 한국"]].map(([v, l]) => (
                    <button key={v} onClick={() => setValueFilter(v)} style={{
                      padding: "4px 10px", borderRadius: "8px", fontSize: mf(16), fontWeight: 600,
                      background: valueFilter === v ? C.greenBg : "transparent",
                      color: valueFilter === v ? C.green : C.text3, border: `1px solid ${valueFilter === v ? C.green : C.border2}`,
                    }}>{l}</button>
                  ))}
                  <div style={{ marginLeft: "auto", display: "flex", gap: "4px", alignItems: "center" }}>
                    <span style={{ fontSize: mf(16), color: C.text3 }}>정렬</span>
                    {[["score","종합"], ["per","PER↑"], ["pbr","PBR↑"], ["div","배당↓"], ["upside","목표가↓"]].map(([v, l]) => (
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
                    const scoreLabel = s.score >= 80 ? "강력 저평가" : s.score >= 70 ? "저평가" : s.score >= 60 ? "저평가 가능성" : "주의 관찰";
                    return (
                      <div key={s.symbol} onClick={() => { setSelectedAsset({ symbol: s.symbol, name: s.name }); if (Math.random() < 0.5) { ctaCountRef.current++; if (ctaCountRef.current % 3 === 0) setShowGoogleCTA(true); else setShowCoupangCTA(true); }; }} style={{
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
                            }}>{s.score}점</span>
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
                              배당 {s.divYield.toFixed(1)}%
                            </span>
                          )}
                          {s.upside != null && (
                            <span style={{ fontSize: mf(15), padding: "2px 6px", borderRadius: "4px", background: s.upside > 15 ? `${C.green}18` : s.upside > 0 ? `${C.blue}18` : `${C.red}18`, color: s.upside > 15 ? C.green : s.upside > 0 ? C.blue : C.red }}>
                              목표 {s.upside > 0 ? "+" : ""}{s.upside.toFixed(0)}%
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
                      상위 50개만 표시 (전체 {filteredValue.length}개)
                    </div>
                  )}
                </div>
              )}

              {!valueScanning && valueResults.length === 0 && (
                <div style={{ textAlign: "center", padding: "24px", color: C.text3 }}>
                  <div style={{ fontSize: mf(36), marginBottom: "10px" }}>💎</div>
                  <div style={{ fontSize: mf(17), lineHeight: 1.7 }}>
                    <strong style={{ color: C.green }}>저평가 스캔</strong>을 눌러 미국·한국 주식의<br />
                    밸류에이션을 종합 분석합니다
                  </div>
                  <div style={{ fontSize: mf(16), marginTop: "8px", color: C.text3 }}>
                    PER · PBR · 배당수익률 · Forward PE · 애널리스트 목표가 · 52주 위치 · 200일선 괴리 기반
                  </div>
                </div>
              )}

              {!valueScanning && valueResults.length > 0 && filteredValue.length === 0 && (
                <div style={{ textAlign: "center", padding: "20px", color: C.text3, fontSize: mf(17) }}>
                  선택한 시장에 저평가 기준 충족 종목 없음 — 필터를 변경해보세요
                </div>
              )}
            </div>

          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════
            TAB: 포트폴리오
        ═══════════════════════════════════════════════════════════ */}
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
                    통계적 이상치 기반 실시간 시장 모니터링
                  </div>
                </div>
                <div style={{ marginLeft: "auto", textAlign: "right" }}>
                  <div style={{
                    fontSize: "32px", fontWeight: 800,
                    color: anomalies.length > 0 ? C.red : C.green,
                  }}>{anomalies.length}</div>
                  <div style={{ fontSize: "16px", color: C.text3 }}>감지됨</div>
                </div>
              </div>

              {/* 통계 요약 3칸 — 대형화 및 색상 강화 */}
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr", gap: "12px" }}>
                {[
                  { label: "급등", value: anomalies.filter(a => a.anomalyType === "surge").length, icon: "🚀", color: C.green },
                  { label: "급락", value: anomalies.filter(a => a.anomalyType === "crash").length, icon: "💥", color: C.red },
                  { label: "고위험", value: anomalies.filter(a => a.severity === "high").length, icon: "🔴", color: C.yellow },
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
                { key: "all", label: "전체", icon: "📊" },
                { key: "surge", label: "급등", icon: "🚀" },
                { key: "crash", label: "급락", icon: "💥" },
                { key: "high", label: "고위험", icon: "🔴" },
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
                    {anomalies.length === 0 ? "이상 징후 없음" : "해당 필터 결과 없음"}
                  </div>
                  <div style={{ color: C.text3, fontSize: "18px", lineHeight: 1.7 }}>
                    {anomalies.length === 0
                      ? <>현재 시장에서 통계적 이상치가 감지되지 않았습니다<br/>2σ 이상 변동, 3x 이상 거래량 폭증 시 알림됩니다</>
                      : <>다른 필터를 선택하거나 전체 보기를 이용하세요</>}
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
                              ${a.price?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
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
                            a.volRatio != null && { label: "거래량 비율", value: `${a.volRatio.toFixed(1)}x`, color: a.volRatio > 3 ? C.red : C.text2 },
                            a.ma200Dist != null && { label: "MA200 괴리", value: `${a.ma200Dist > 0 ? "+" : ""}${a.ma200Dist.toFixed(1)}%`, color: a.ma200Dist > 20 ? C.red : a.ma200Dist < -20 ? C.green : C.text2 },
                            a.weeklyChange != null && { label: "주간 변동", value: `${a.weeklyChange > 0 ? "+" : ""}${a.weeklyChange.toFixed(1)}%`, color: a.weeklyChange >= 0 ? C.green : C.red },
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
                          감지: {a.detectedAt ? new Date(a.detectedAt).toLocaleTimeString("ko-KR") : "-"}
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
                <h3 style={{ margin: 0, fontSize: "18px", fontWeight: 700, color: C.text1 }}>📜 탐지 히스토리</h3>
                {anomalyHistory.length > 0 && (
                  <button onClick={() => {
                    if (!confirm("이상 탐지 히스토리를 전부 삭제하시겠습니까?")) return;
                    setAnomalyHistory([]); try { localStorage.removeItem("di_anomaly_history"); } catch {}
                  }} style={{
                    padding: "4px 12px", borderRadius: "8px", fontSize: "16px",
                    background: `${C.red}15`, color: C.red, border: "none", cursor: "pointer", fontWeight: 600,
                  }}>초기화</button>
                )}
              </div>
              {anomalyHistory.length === 0 ? (
                <div style={{ textAlign: "center", padding: "24px 0", color: C.text3, fontSize: "18px" }}>
                  아직 기록된 이상 탐지 히스토리가 없습니다
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
              <h3 style={{ margin: "0 0 12px", fontSize: "18px", fontWeight: 700, color: C.text1 }}>📐 탐지 기준</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {[
                  { icon: "📈", title: "가격 이상 변동", desc: "전체 평균 대비 2σ 이상 + 3% 이상 변동" },
                  { icon: "📊", title: "거래량 폭증", desc: "5일 평균 대비 3배 이상 거래량" },
                  { icon: "⬆️", title: "급격한 갭", desc: "전일 종가 대비 3% 이상 갭 발생" },
                  { icon: "🔴", title: "고위험 등급", desc: "평균 대비 3σ 이상 극단적 변동" },
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
        {tab === "strategy" && (
          <div style={{
            background: `linear-gradient(135deg, ${C.purpleBg} 0%, ${C.card} 100%)`,
            borderRadius: "24px", padding: "24px",
            boxShadow: `0 4px 20px rgba(155,111,255,0.08)`,
            display: "flex", flexDirection: "column", gap: "12px"
          }}>
            <Suspense fallback={<LazyTabFallback />}><StrategyPanel onRunBacktest={(strategy, symbol) => {
              setBtStrategy(strategy); setBtSymbol(symbol); setTab("backtest"); if (Math.random() < 0.5) { ctaCountRef.current++; if (ctaCountRef.current % 3 === 0) setShowGoogleCTA(true); else setShowCoupangCTA(true); };
            }} /></Suspense>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════
            TAB: 전략 운용 (퀀트 포트폴리오)
        ═══════════════════════════════════════════════════════════ */}
        {tab === "quant-port" && (
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
          if (buyPicks > 5) mktScore += 6; else if (buyPicks > 2) mktScore += 3;
          if (sellPicks > 5) mktScore -= 6; else if (sellPicks > 2) mktScore -= 3;
          mktScore = Math.max(0, Math.min(100, mktScore));
          const mktVerdict = mktScore >= 70 ? "강세" : mktScore >= 55 ? "약 강세" : mktScore >= 45 ? "혼조" : mktScore >= 30 ? "약세" : "강한 약세";
          const mktColor = mktScore >= 60 ? C.green : mktScore >= 45 ? C.yellow : C.red;
          const now = new Date();
          const reportTime = now.toLocaleString("ko-KR", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" });

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

          return (
            <div className="tab-content flex flex-col gap-3" style={{ maxWidth: "1200px", margin: "0 auto" }}>
              {/* 헤더 */}
              <div className="rounded-[16px] p-[22px_24px]" style={{ background: `linear-gradient(135deg, ${C.card}, ${mktScore >= 55 ? (C.isDark ? "#0d2818" : "#e8f5e9") : mktScore < 45 ? (C.isDark ? "#28100d" : "#fce4ec") : (C.isDark ? "#1a1a0d" : "#fff8e1")})` }}>
                <div className="flex items-center justify-between mb-1">
                  <span className="font-black text-xl" style={{ color: C.text1 }}>퀀트 리포트</span>
                  <div className="flex items-center gap-2">
                    <button onClick={() => {
                      const shareText = `[Zepta AI 시장 리포트] ${reportTime}\n\n시장 점수: ${mktScore}/100 (${mktVerdict})\n상승 ${upCount}개 · 하락 ${dnCount}개\n\nAI 퀀트 33개 전략 실시간 분석\n👉 https://zepta.app`;
                      if (navigator.share) {
                        navigator.share({ title: "Zepta AI 시장 리포트", text: shareText, url: "https://zepta.app" }).catch(() => {});
                      } else {
                        navigator.clipboard.writeText(shareText).then(() => showToast("리포트가 복사되었습니다!", "success")).catch(() => {});
                      }
                    }} className="rounded-lg px-2.5 py-1 text-base font-semibold cursor-pointer flex items-center gap-1 transition-all" style={{
                      background: "none", border: `1px solid ${C.border}${C.isDark ? '40' : '60'}`, color: C.text3,
                    }}
                    onMouseEnter={e => { e.currentTarget.style.color = C.blue; e.currentTarget.style.borderColor = C.blue; }}
                    onMouseLeave={e => { e.currentTarget.style.color = C.text3; e.currentTarget.style.borderColor = `${C.border}${C.isDark ? '40' : '60'}`; }}
                    >📤 공유</button>
                    <span className="text-xs" style={{ color: C.text3 }}>{reportTime} 기준</span>
                  </div>
                </div>
                <div className="text-base mb-4" style={{ color: C.text3 }}>AI 기반 실시간 시장 분석 리포트</div>

                {/* 시장 점수 대형 게이지 */}
                <div className="flex items-center gap-5 mb-4">
                  <div className="relative flex-shrink-0" style={{ width: "80px", height: "80px" }}>
                    <svg viewBox="0 0 80 80" width="80" height="80">
                      <circle cx="40" cy="40" r="33" fill="none" stroke={C.border} strokeWidth="6" />
                      <circle cx="40" cy="40" r="33" fill="none" stroke={mktColor} strokeWidth="6" strokeLinecap="round"
                        strokeDasharray={`${(mktScore / 100) * 207.3} 207.3`} transform="rotate(-90 40 40)"
                        style={{ transition: "stroke-dasharray 0.6s ease" }} />
                      <text x="40" y="37" textAnchor="middle" fill={C.text1} fontSize="22" fontWeight="800">{mktScore}</text>
                      <text x="40" y="50" textAnchor="middle" fill={C.text3} fontSize="9">/100</text>
                    </svg>
                  </div>
                  <div className="flex-1">
                    <div className="text-xl font-black mb-1.5" style={{ color: mktColor }}>{mktVerdict}</div>
                    <div className="text-base" style={{ color: C.text2, lineHeight: 1.6 }}>
                      {mktScore >= 60
                        ? `매수 우위 장세입니다. 상승 종목 ${upCount}개, 추천 매수 ${buyPicks}개가 감지되었습니다.`
                        : mktScore >= 45
                        ? `혼조 장세입니다. 방향성 확인 후 신중한 진입을 권장합니다.`
                        : `약세 장세입니다. 리스크 관리를 최우선으로 하세요. 하락 종목 ${dnCount}개.`}
                    </div>
                  </div>
                </div>
              </div>

              {/* 주요 지수 현황 */}
              <div className="rounded-[16px] p-5" style={{ background: C.card, border: `1px solid ${C.border}${C.isDark ? '18' : '40'}` }}>
                <div className="font-bold text-lg mb-3.5" style={{ color: C.text1 }}>주요 지수</div>
                <div className={isMobile ? "grid grid-cols-2 gap-2" : "grid grid-cols-3 gap-2"}>
                  {[
                    sp && { name: "S&P 500", value: sp.price, change: sp.change },
                    nq && { name: "나스닥", value: nq.price, change: nq.change },
                    dji && { name: "다우존스", value: dji.price, change: dji.change },
                    ks && { name: "코스피", value: ks.price, change: ks.change },
                    kq && { name: "코스닥", value: kq.price, change: kq.change },
                    vix && { name: "VIX", value: vix.price, change: vix.change },
                  ].filter(Boolean).map(idx => (
                    <div key={idx.name} className="rounded-[12px] p-3 text-center transition-all" style={{
                      background: C.bg,
                      cursor: "pointer",
                      border: `1px solid ${idx.change >= 0 ? C.green + "30" : C.red + "30"}`,
                    }}
                    onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = `0 4px 12px ${idx.change >= 0 ? C.green + "30" : C.red + "30"}`; }}
                    onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "none"; }}>
                      <div className="text-sm mb-1" style={{ color: C.text3 }}>{idx.name}</div>
                      <div className="text-base font-bold" style={{ color: C.text1 }}>{typeof idx.value === "number" ? idx.value.toLocaleString(undefined, { maximumFractionDigits: 0 }) : idx.value}</div>
                      <div className="text-sm font-semibold" style={{ color: idx.change >= 0 ? C.green : C.red }}>
                        {idx.change >= 0 ? "+" : ""}{idx.change}%
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* 시장 센티먼트 지표 */}
              <div className="rounded-[16px] p-5" style={{ background: C.card, border: `1px solid ${C.border}${C.isDark ? '18' : '40'}` }}>
                <div className="font-bold text-lg mb-3.5" style={{ color: C.text1 }}>센티먼트 지표</div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-[10px] p-3" style={{ background: C.bg }}>
                    <div className="text-sm mb-1" style={{ color: C.text3 }}>공포탐욕 지수</div>
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-2xl font-black" style={{ color: fg ? (fg > 60 ? C.green : fg > 40 ? C.yellow : C.red) : C.text3 }}>{fg || "—"}</span>
                      <span className="text-base" style={{ color: C.text3 }}>{fg ? (fg <= 25 ? "극도의 공포" : fg <= 40 ? "공포" : fg <= 60 ? "중립" : fg <= 75 ? "탐욕" : "극도의 탐욕") : ""}</span>
                    </div>
                    {fg && (
                      <div className="mt-1.5 h-1.5 rounded" style={{ background: C.border, overflow: "hidden" }}>
                        <div className="h-full rounded" style={{ width: `${fg}%`, background: `linear-gradient(90deg, ${C.red}, ${C.yellow}, ${C.green})` }} />
                      </div>
                    )}
                  </div>
                  <div className="rounded-[10px] p-3" style={{ background: C.bg }}>
                    <div className="text-sm mb-1" style={{ color: C.text3 }}>상승/하락 비율</div>
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-2xl font-black" style={{ color: advDecl > 55 ? C.green : advDecl < 45 ? C.red : C.yellow }}>{advDecl.toFixed(0)}%</span>
                      <span className="text-base" style={{ color: C.text3 }}>상승</span>
                    </div>
                    <div className="mt-1.5 h-1.5 rounded flex" style={{ background: C.border, overflow: "hidden" }}>
                      <div className="h-full" style={{ width: `${advDecl}%`, background: C.green }} />
                      <div className="h-full flex-1" style={{ background: C.red }} />
                    </div>
                    <div className="flex justify-between text-xs mt-0.5" style={{ color: C.text3 }}>
                      <span>상승 {upCount}</span>
                      <span>보합 {flatCount}</span>
                      <span>하락 {dnCount}</span>
                    </div>
                  </div>
                  {vix && (
                    <div className="rounded-[10px] p-3" style={{ background: C.bg }}>
                      <div className="text-sm mb-1" style={{ color: C.text3 }}>VIX (변동성)</div>
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-2xl font-black" style={{ color: vix.price > 30 ? C.red : vix.price > 20 ? C.yellow : C.green }}>{vix.price?.toFixed(1)}</span>
                        <span className="text-base" style={{ color: C.text3 }}>{vix.price > 30 ? "고변동" : vix.price > 20 ? "보통" : "안정"}</span>
                      </div>
                    </div>
                  )}
                  <div className="rounded-[10px] p-3" style={{ background: C.bg }}>
                    <div className="text-sm mb-1" style={{ color: C.text3 }}>추천 매수 신호</div>
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-2xl font-black" style={{ color: C.blue }}>{buyPicks}</span>
                      <span className="text-base" style={{ color: C.text3 }}>/ {dailyPicks.length} 종목</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* 시장별 현황 */}
              <div className="rounded-[16px] p-5" style={{ background: C.card, border: `1px solid ${C.border}${C.isDark ? '18' : '40'}` }}>
                <div className="font-bold text-lg mb-3.5" style={{ color: C.text1 }}>시장별 현황</div>
                <div className={isMobile ? "grid grid-cols-1 gap-2" : "grid grid-cols-3 gap-2"}>
                  {[
                    { name: "🇺🇸 미국", total: usStocks.length, up: usUp, color: C.blue },
                    { name: "🇰🇷 한국", total: krStocks.length, up: krUp, color: C.green },
                    { name: "₿ 크립토", total: cryptos.length, up: cryptoUp, color: C.purple },
                  ].map(m => (
                    <div key={m.name} className="rounded-[10px] p-3 text-center" style={{ background: C.bg }}>
                      <div className="text-base font-bold mb-1.5" style={{ color: C.text1 }}>{m.name}</div>
                      <div className="text-base mb-1" style={{ color: C.text3 }}>{m.total}개 종목</div>
                      <div className="h-1 rounded overflow-hidden" style={{ background: C.border }}>
                        <div className="h-full rounded" style={{ width: m.total > 0 ? `${(m.up / m.total * 100)}%` : "0%", background: m.color }} />
                      </div>
                      <div className="text-sm mt-0.5 font-semibold" style={{ color: m.color }}>
                        {m.total > 0 ? `${(m.up / m.total * 100).toFixed(0)}% 상승` : "—"}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* 섹터별 퍼포먼스 히트맵 (v9.1) */}
              {hotAssets.length > 0 && (() => {
                const sectors = {
                  "반도체": ["NVDA","AMD","INTC","AVGO","QCOM","MU","TSM","ASML","ARM","SMCI","MRVL","LRCX","KLAC","AMAT","ON","TXN","ADI"],
                  "빅테크": ["AAPL","MSFT","GOOGL","AMZN","META","NFLX","TSLA"],
                  "소프트웨어": ["CRM","ORCL","ADBE","NOW","SNOW","DDOG","NET","PLTR","PANW","CRWD"],
                  "핀테크": ["COIN","SQ","PYPL","AFRM","SOFI","HOOD","MSTR"],
                  "헬스케어": ["UNH","JNJ","LLY","NVO","ABBV","PFE","MRK","AMGN"],
                  "에너지": ["XOM","CVX","LNG","COP","SLB","OXY","EOG"],
                  "소비재": ["WMT","COST","HD","MCD","DIS","SBUX","NKE"],
                  "금융": ["JPM","GS","BAC","V","MA","BLK","MS"],
                  "EV/클린": ["RIVN","LCID","LI","NIO","XPEV","ENPH","FSLR"],
                  "중국ADR": ["BABA","JD","PDD","BIDU","NTES"],
                };
                const sectorData = Object.entries(sectors).map(([name, syms]) => {
                  const matched = syms.map(s => hotAssets.find(a => a.symbol === s)).filter(Boolean);
                  if (matched.length === 0) return null;
                  const avgChange = matched.reduce((s, a) => s + (a.change || 0), 0) / matched.length;
                  const upRatio = matched.filter(a => a.change > 0).length / matched.length;
                  return { name, avgChange: +avgChange.toFixed(2), count: matched.length, upRatio };
                }).filter(Boolean).sort((a, b) => b.avgChange - a.avgChange);
                if (sectorData.length === 0) return null;
                const maxAbs = Math.max(...sectorData.map(s => Math.abs(s.avgChange)), 1);
                return (
                  <div className="rounded-[16px] p-5" style={{ background: C.card, border: `1px solid ${C.border}${C.isDark ? '18' : '40'}` }}>
                    <div className="font-bold text-lg mb-3.5" style={{ color: C.text1 }}>섹터 퍼포먼스</div>
                    <div className="grid gap-1.5" style={{ gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(auto-fill, minmax(140px, 1fr))" }}>
                      {sectorData.map(s => {
                        const intensity = Math.min(Math.abs(s.avgChange) / maxAbs, 1);
                        const bgColor = s.avgChange >= 0
                          ? `rgba(${C.isDark ? "16,185,129" : "5,150,105"},${0.08 + intensity * 0.18})`
                          : `rgba(${C.isDark ? "239,68,68" : "220,38,38"},${0.08 + intensity * 0.18})`;
                        return (
                          <div key={s.name} className="px-3 py-2.5 rounded-[10px] text-center transition-transform" style={{
                            background: bgColor, cursor: "default",
                          }}>
                            <div className="text-base font-bold mb-0.5" style={{ color: C.text1 }}>{s.name}</div>
                            <div className="text-lg font-black" style={{ color: s.avgChange >= 0 ? C.green : C.red }}>
                              {s.avgChange >= 0 ? "+" : ""}{s.avgChange}%
                            </div>
                            <div className="text-xs mt-0.5" style={{ color: C.text3 }}>
                              {s.count}종목 · {(s.upRatio * 100).toFixed(0)}% 상승
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              {/* 급등/급락 TOP 5 */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div className="rounded-[16px] p-5" style={{ background: C.card, border: `1px solid ${C.border}${C.isDark ? '18' : '40'}` }}>
                  <div className="flex items-center gap-1 mb-2.5">
                    <span className="w-2 h-2 rounded-full" style={{ background: C.green }} />
                    <span className="font-bold text-lg" style={{ color: C.text1 }}>급등 TOP 5</span>
                  </div>
                  {topGainers.map((a, i) => (
                    <div key={a.symbol} onTouchStart={onTouchCardStart} onTouchMove={onTouchCardMove}
                      onClick={() => { if (isTouchTap()) setSelectedAsset(a); }} className="flex items-center justify-between py-2 cursor-pointer" style={{
                      borderBottom: i < 4 ? `1px solid ${C.border}08` : "none",
                    }}>
                      <div className="flex items-center gap-1.5 flex-1 min-w-0">
                        <span className="text-sm font-bold w-3.5" style={{ color: C.text3 }}>{i + 1}</span>
                        <span className="text-base font-semibold truncate" style={{ color: C.text1 }}>{a.market === "kr" ? "🇰🇷" : a.market === "crypto" ? "₿" : "🇺🇸"} {a.name}</span>
                      </div>
                      <span className="text-base font-bold flex-shrink-0" style={{ color: C.green }}>+{a.change}%</span>
                    </div>
                  ))}
                </div>
                <div className="rounded-[16px] p-5" style={{ background: C.card, border: `1px solid ${C.border}${C.isDark ? '18' : '40'}` }}>
                  <div className="flex items-center gap-1 mb-2.5">
                    <span className="w-2 h-2 rounded-full" style={{ background: C.red }} />
                    <span className="font-bold text-lg" style={{ color: C.text1 }}>급락 TOP 5</span>
                  </div>
                  {topLosers.map((a, i) => (
                    <div key={a.symbol} onTouchStart={onTouchCardStart} onTouchMove={onTouchCardMove}
                      onClick={() => { if (isTouchTap()) setSelectedAsset(a); }} className="flex items-center justify-between py-2 cursor-pointer" style={{
                      borderBottom: i < 4 ? `1px solid ${C.border}08` : "none",
                    }}>
                      <div className="flex items-center gap-1.5 flex-1 min-w-0">
                        <span className="text-sm font-bold w-3.5" style={{ color: C.text3 }}>{i + 1}</span>
                        <span className="text-base font-semibold truncate" style={{ color: C.text1 }}>{a.market === "kr" ? "🇰🇷" : a.market === "crypto" ? "₿" : "🇺🇸"} {a.name}</span>
                      </div>
                      <span className="text-base font-bold flex-shrink-0" style={{ color: C.red }}>{a.change}%</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* 추천 매수 종목 */}
              {topPicks.length > 0 && (
                <div className="rounded-[16px] p-5" style={{ background: C.card, border: `1px solid ${C.border}${C.isDark ? '18' : '40'}` }}>
                  <div className="font-bold text-lg mb-3.5" style={{ color: C.text1 }}>추천 매수 종목</div>
                  {topPicks.map((pick, i) => {
                    const flag = pick.market === "kr" ? "🇰🇷" : "🇺🇸";
                    return (
                      <div key={pick.symbol} role="button" tabIndex={0}
                        onClick={() => setSelectedAsset(pick)}
                        onTouchEnd={(e) => { e.preventDefault(); setSelectedAsset(pick); }}
                        className="flex items-center justify-between py-2.5 cursor-pointer" style={{
                          borderBottom: i < topPicks.length - 1 ? `1px solid ${C.border}08` : "none",
                          WebkitTapHighlightColor: "transparent",
                      }}>
                        <div className="flex items-center gap-2.5 flex-1 min-w-0">
                          <div className="size-7 rounded-lg flex-shrink-0 flex items-center justify-center text-base font-black" style={{
                            background: `${C.blue}18`, color: C.blue,
                          }}>{i + 1}</div>
                          <div className="min-w-0">
                            <div className="font-semibold text-lg" style={{ color: C.text1 }}>{flag} {pick.name}</div>
                            <div className="text-sm" style={{ color: C.text3 }}>{pick.reason}</div>
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <div className="text-base font-bold px-2 py-0.5 rounded" style={{
                            background: C.greenBg, color: C.green,
                          }}>점수 {pick.score}</div>
                          <div className="text-base font-semibold mt-1" style={{ color: pick.change >= 0 ? C.green : C.red }}>
                            {pick.change >= 0 ? "+" : ""}{pick.change}%
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* 종목별 퀀트 전략 Top 10 — 클릭하면 상세 팝업에서 백테스트 확인 */}
              {topPicks.length > 0 && (
                <div className="rounded-[16px] p-5" style={{ background: C.card, border: `1px solid ${C.border}${C.isDark ? '18' : '40'}` }}>
                  <div className="flex items-center justify-between mb-3">
                    <span className="font-bold text-lg" style={{ color: C.text1 }}>종목별 퀀트 전략</span>
                    <span className="text-sm" style={{ color: C.text3 }}>종목 터치 → 백테스트 상세</span>
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
                              }}>{d.opinion}</span>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm" style={{ color: C.text3 }}>{pick.reason}</span>
                            {d && <span className="text-sm" style={{ color: C.text3 }}>진단 {d.score}점</span>}
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <div className="text-lg font-bold" style={{ color: pick.change >= 0 ? C.green : C.red }}>
                            {pick.change >= 0 ? "+" : ""}{pick.change}%
                          </div>
                          <div className="text-sm font-bold px-2.5 py-0.5 rounded text-center mt-1" style={{ color: C.blue, background: `${C.blue}12`, border: `1px solid ${C.blue}30` }}>📊 백테스트</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* 오늘의 액션 플랜 */}
              <div className="rounded-[16px] p-5" style={{ background: C.card, border: `1px solid ${C.border}${C.isDark ? '18' : '40'}` }}>
                <div className="font-bold text-lg mb-3.5" style={{ color: C.text1 }}>📋 오늘의 액션 플랜</div>
                <div className="flex flex-col gap-2">
                  {(() => {
                    const actions = [];
                    if (mktScore >= 60) actions.push({ icon: "🟢", text: "매수 우위 — 관심종목 1차 진입 검토", color: C.green });
                    else if (mktScore >= 45) actions.push({ icon: "🟡", text: "혼조세 — 신규 진입보다 관망 우선", color: C.yellow });
                    else actions.push({ icon: "🔴", text: "약세장 — 비중 축소 및 현금 확보", color: C.red });
                    if (anomalies.length > 0) actions.push({ icon: "⚡", text: `이상 탐지 ${anomalies.length}건 — 급등락 종목 주의`, color: C.yellow });
                    if (buyPicks > 3) actions.push({ icon: "🎯", text: `매수 신호 ${buyPicks}건 — 상위 종목 분할 매수 고려`, color: C.green });
                    if (sellPicks > 3) actions.push({ icon: "🛡️", text: `매도 신호 ${sellPicks}건 — 보유 종목 점검 필요`, color: C.red });
                    if (fg && fg <= 25) actions.push({ icon: "💎", text: "극도의 공포 — 역발상 매수 기회 탐색", color: C.purple });
                    if (fg && fg >= 75) actions.push({ icon: "⚠️", text: "극도의 탐욕 — 차익실현 고려", color: C.red });
                    const vix = marketIndices.find(i => i.symbol === "^VIX");
                    if (vix?.price > 30) actions.push({ icon: "🌊", text: `VIX ${vix.price.toFixed(1)} — 고변동성, 포지션 축소`, color: C.red });
                    if (portfolio.length > 0 && benchmarkData) {
                      if (benchmarkData.myReturn < -5) actions.push({ icon: "📊", text: "포트폴리오 손실 중 — 리밸런싱 검토", color: C.yellow });
                      else if (benchmarkData.alpha > 3) actions.push({ icon: "🏆", text: `시장 대비 +${benchmarkData.alpha.toFixed(1)}% 초과 수익`, color: C.green });
                    }
                    return actions.map((a, i) => (
                      <div key={i} className="flex items-center gap-2.5 py-2.5 px-3 rounded-[10px]" style={{
                        background: `${a.color}08`, border: `1px solid ${a.color}15`,
                      }}>
                        <span className="text-lg flex-shrink-0">{a.icon}</span>
                        <span className="text-lg font-semibold" style={{ color: C.text1 }}>{a.text}</span>
                      </div>
                    ));
                  })()}
                </div>
              </div>

              {/* 종합 의견 */}
              <div className="rounded-[16px] p-5" style={{
                background: `linear-gradient(135deg, ${C.card}, ${mktScore >= 55 ? (C.isDark ? "#0d2818" : "#e8f5e9") : mktScore < 45 ? (C.isDark ? "#28100d" : "#fce4ec") : (C.isDark ? "#1a1a0d" : "#fff8e1")})`,
              }}>
                <div className="font-bold text-lg mb-3.5" style={{ color: C.text1 }}>종합 의견</div>
                <div className="text-lg" style={{ color: C.text2, lineHeight: 1.8 }}>
                  {mktScore >= 70
                    ? `현재 시장은 강세 국면입니다. S&P500 ${sp ? `${sp.change >= 0 ? "+" : ""}${sp.change}%` : ""}, 상승종목 비율 ${advDecl.toFixed(0)}%로 매수 우위 환경입니다. ${buyPicks}개 종목에서 매수 신호가 감지되었으며, 적극적인 포지션 확대를 고려할 수 있습니다.${fg && fg > 75 ? " 다만 공포탐욕 지수가 극단적 탐욕 구간으로, 과열 리스크에 유의하세요." : ""}`
                    : mktScore >= 55
                    ? `시장은 약한 강세를 보이고 있습니다. 상승 종목이 ${upCount}개로 하락 종목(${dnCount}개)보다 많으나, 확실한 방향성은 아직 형성되지 않았습니다. 분할 매수 접근이 적절하며, ${fg ? `공포탐욕 ${fg}(${fg <= 40 ? "공포" : fg <= 60 ? "중립" : "탐욕"})` : "시장 심리"}를 참고하여 비중을 조절하세요.`
                    : mktScore >= 45
                    ? `혼조 장세입니다. 상승(${upCount})과 하락(${dnCount}) 종목이 팽팽하게 대치하고 있으며, 뚜렷한 방향성이 없습니다. 신규 진입보다는 관망하거나 기존 포지션 리밸런싱에 집중하세요. 주요 지지/저항선 돌파 여부를 확인한 후 대응하는 것이 유리합니다.`
                    : mktScore >= 30
                    ? `약세 장세입니다. 하락 종목(${dnCount}개)이 우세하며 시장 심리가 위축되고 있습니다. 비중 축소와 현금 비율 확대를 권장합니다.${fg && fg <= 30 ? " 공포 지수가 낮은 구간이므로 역발상 투자를 위한 관심 종목 리스트를 준비해두세요." : ""}`
                    : `강한 약세 장세입니다. 대부분의 종목이 하락세이며, 시장 전반적으로 매도 압력이 강합니다. 방어적 포지션을 취하고, 현금 비율을 높이세요. 패닉 매도보다는 손절 기준을 엄격히 적용하여 체계적으로 대응하세요.`}
                </div>
                <div className="flex gap-2 mt-3.5 flex-wrap">
                  <span className="text-base px-2.5 py-1 rounded font-bold" style={{
                    background: `${mktColor}18`, color: mktColor,
                  }}>
                    시장점수 {mktScore}/100
                  </span>
                  <span className="text-base px-2.5 py-1 rounded" style={{
                    background: C.card2, color: C.text3,
                  }}>
                    상승률 {advDecl.toFixed(0)}%
                  </span>
                  {fg && <span className="text-base px-2.5 py-1 rounded" style={{
                    background: C.card2, color: C.text3,
                  }}>
                    공포탐욕 {fg}
                  </span>}
                  <span className="text-base px-2.5 py-1 rounded" style={{
                    background: C.card2, color: C.text3,
                  }}>
                    매수신호 {buyPicks}건
                  </span>
                </div>
              </div>
            </div>
          );
        })()}


        {/* ═══════════════════════════════════════════════════════════
            TAB: 백테스트
        ═══════════════════════════════════════════════════════════ */}
        {tab === "backtest" && (
          <div style={{
            background: `linear-gradient(135deg, ${C.blueBg} 0%, ${C.card} 100%)`,
            borderRadius: "24px", padding: "24px",
            boxShadow: `0 4px 20px rgba(59,130,246,0.08)`,
          }}>
            <Suspense fallback={<LazyTabFallback />}><BacktestPanel initialStrategy={btStrategy} initialSymbol={btSymbol} /></Suspense>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════
            TAB: 뉴스
        ═══════════════════════════════════════════════════════════ */}
        {tab === "news" && (
          <div className="tab-content">
            {/* 뉴스 헤더 (그래디언트 강화) */}
            <div style={{ background: `linear-gradient(135deg, ${C.greenBg} 0%, ${C.card} 100%)`, border: `1px solid ${C.border}20`, borderRadius: "24px", padding: "28px", marginBottom: "16px", boxShadow: `0 4px 16px ${C.green}15` }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", flexWrap: "wrap", marginBottom: "14px" }}>
                <div>
                  <div style={{ fontWeight: 800, fontSize: "24px", color: C.text1, marginBottom: "4px" }}>{t("tabs.news.title")}</div>
                  <div style={{ fontSize: "14px", color: C.text3 }}>{t("tabs.news.subtitle")}</div>
                </div>
                <button onClick={fetchNews} disabled={newsLoading} style={{
                  padding: "8px 16px", borderRadius: "10px", fontSize: "14px", fontWeight: 700,
                  background: newsLoading ? C.card2 : C.blue, color: newsLoading ? C.text3 : "#fff",
                  border: "none", cursor: newsLoading ? "default" : "pointer",
                }}>{newsLoading ? "로딩 중..." : "새로고침"}</button>
              </div>
              {/* 센티먼트 요약 바 */}
              {sortedNews.length > 0 && (() => {
                const posCnt = sortedNews.filter(n => analyzeSentiment(n.title) === "positive").length;
                const negCnt = sortedNews.filter(n => analyzeSentiment(n.title) === "negative").length;
                const neuCnt = sortedNews.length - posCnt - negCnt;
                return (
                  <div>
                    <div style={{ display: "flex", height: "8px", borderRadius: "4px", overflow: "hidden", marginBottom: "8px", boxShadow: `inset 0 1px 2px rgba(0,0,0,0.1)` }}>
                      <div style={{ width: `${(posCnt / sortedNews.length) * 100}%`, background: C.green, transition: "width .5s", boxShadow: "0 0 8px rgba(0,255,100,0.3)" }} />
                      <div style={{ width: `${(neuCnt / sortedNews.length) * 100}%`, background: C.text3 + "40", transition: "width .5s" }} />
                      <div style={{ width: `${(negCnt / sortedNews.length) * 100}%`, background: C.red, transition: "width .5s", boxShadow: "0 0 8px rgba(255,0,100,0.3)" }} />
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "14px" }}>
                      <span style={{ color: C.green, fontWeight: 600 }}>긍정 {posCnt}</span>
                      <span style={{ color: C.text3 }}>중립 {neuCnt}</span>
                      <span style={{ color: C.red, fontWeight: 600 }}>부정 {negCnt}</span>
                    </div>
                  </div>
                );
              })()}
              {/* 카테고리 필터 — 모바일에서 수평 스크롤 가능 */}
              <div className={isMobile ? "hscroll" : ""} style={{ display: "flex", gap: "6px", marginTop: "12px", flexWrap: isMobile ? "nowrap" : "wrap", overflowX: isMobile ? "auto" : "visible", WebkitOverflowScrolling: "touch" }}>
                {[
                  ["all", "전체"],
                  ["us", "🇺🇸 미국"],
                  ["kr", "🇰🇷 한국"],
                  ["crypto", "₿ 크립토"],
                ].map(([v, l]) => (
                  <button key={v} onClick={() => setNewsCat(v)} style={{
                    padding: "6px 14px", borderRadius: "10px", fontSize: "14px", fontWeight: 600,
                    background: newsCat === v ? C.blue : C.card2,
                    color: newsCat === v ? "#fff" : C.text3,
                    border: `1px solid ${newsCat === v ? C.blue : C.border2}`,
                    cursor: "pointer", transition: "all .15s", flexShrink: 0,
                    boxShadow: newsCat === v ? `0 2px 12px ${C.blue}40` : "none",
                  }}>{l}</button>
                ))}
                <div style={{ width: "1px", background: C.border, margin: "0 4px", flexShrink: 0 }} />
                {[
                  ["time", "최신순"],
                  ["positive", "긍정"],
                  ["negative", "부정"],
                ].map(([v, l]) => (
                  <button key={v} onClick={() => setNewsSort(v)} style={{
                    padding: "5px 12px", borderRadius: "8px", fontSize: "14px", fontWeight: 600,
                    background: newsSort === v ? (v === "positive" ? C.greenBg : v === "negative" ? C.redBg : C.blueBg) : "transparent",
                    color: newsSort === v ? (v === "positive" ? C.green : v === "negative" ? C.red : C.blue) : C.text3,
                    border: "none", cursor: "pointer", transition: "all .15s",
                  }}>{l}</button>
                ))}
              </div>
            </div>

            {newsLoading ? (
              <div className="flex flex-col gap-2">
                {[1,2,3,4].map(i => <div key={i} className="skeleton rounded-[12px]" style={{ height: "100px" }} />)}
              </div>
            ) : sortedNews.length === 0 ? (
              <div style={{ background: C.card, border: `1px solid ${C.border}20`, textAlign: "center" }} className="rounded-[16px] p-12">
                <div style={{ background: C.blueBg }} className="w-14 h-14 rounded-[16px] flex items-center justify-center mx-auto mb-3.5 text-2xl">📰</div>
                <div className="font-bold text-lg mb-1.5 text-foreground" style={{color: C.text1}}>아직 받아온 뉴스가 없어요</div>
                <div className="text-base mb-5" style={{ color: C.text3 }}>오늘의 시장 뉴스를 한 번에 모아드릴게요</div>
                <button onClick={fetchNews} disabled={newsLoading} aria-label="뉴스 새로고침" style={{
                  padding: "12px 24px", minHeight: "48px", borderRadius: "12px",
                  fontSize: "15px", fontWeight: 700,
                  background: newsLoading ? C.card2 : C.blue, color: "#fff",
                  border: "none", cursor: newsLoading ? "default" : "pointer",
                  display: "inline-flex", alignItems: "center", gap: "8px",
                }}>
                  <span style={{ fontSize: "16px" }}>🔄</span>
                  {newsLoading ? "불러오는 중..." : "지금 새로고침"}
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {sortedNews.map((news, i) => {
                  const sentiment = analyzeSentiment(news.title);
                  const sentColor = sentiment === "positive" ? C.green : sentiment === "negative" ? C.red : C.text3;
                  const sentLabel = sentiment === "positive" ? "긍정" : sentiment === "negative" ? "부정" : "중립";
                  const sentIcon = sentiment === "positive" ? "▲" : sentiment === "negative" ? "▼" : "●";
                  const pubDate = new Date(news.date || news.publishedAt || news.pubDate || Date.now());
                  const timeAgo = (() => {
                    const diff = Date.now() - pubDate.getTime();
                    const mins = Math.floor(diff / 60000);
                    if (mins < 60) return `${mins}분 전`;
                    const hrs = Math.floor(mins / 60);
                    if (hrs < 24) return `${hrs}시간 전`;
                    return `${Math.floor(hrs / 24)}일 전`;
                  })();
                  return (<>
                    <a key={i} href={news.url || news.link || "#"} target="_blank" rel="noopener" onClick={() => { if (Math.random() < 0.5) { ctaCountRef.current++; if (ctaCountRef.current % 3 === 0) setShowGoogleCTA(true); else setShowCoupangCTA(true); }; }} style={{
                      background: C.card, border: `1px solid ${C.border}20`, borderRadius: "16px", padding: isMobile ? "14px" : "16px 18px",
                      textDecoration: "none", color: "inherit", display: "block", transition: "all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)",
                      borderLeft: `4px solid ${sentColor}`,
                      boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
                      cursor: "pointer",
                    }}
                    onMouseEnter={e => { e.currentTarget.style.boxShadow = `0 8px 24px ${sentColor}30`; e.currentTarget.style.transform = "translateY(-3px) scale(1.01)"; }}
                    onMouseLeave={e => { e.currentTarget.style.boxShadow = "0 1px 2px rgba(0,0,0,0.05)"; e.currentTarget.style.transform = "translateY(0) scale(1)"; }}>
                      <div style={{ display: "flex", gap: "12px", alignItems: "flex-start" }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: mf(16), marginBottom: "8px", color: C.text1, lineHeight: 1.5 }}>{news.title}</div>
                          {(news.desc || news.description) && (
                            <div style={{ fontSize: mf(16), color: C.text2, lineHeight: 1.6, marginBottom: "8px" }}>{(news.desc || news.description).slice(0, 150)}</div>
                          )}
                          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                            <span style={{ fontSize: "16px", fontWeight: 600, color: sentColor, display: "flex", alignItems: "center", gap: "3px" }}>
                              <span style={{ fontSize: "14px" }}>{sentIcon}</span> {sentLabel}
                            </span>
                            <span style={{ width: "1px", height: "10px", background: C.border }} />
                            <span style={{ fontSize: "16px", color: C.text3 }}>{news.source || "Unknown"}</span>
                            <span style={{ width: "1px", height: "10px", background: C.border }} />
                            <span style={{ fontSize: "16px", color: C.text3 }}>{timeAgo}</span>
                          </div>
                          {news.tags?.length > 0 && (
                            <div style={{ display: "flex", gap: "4px", flexWrap: "wrap", marginTop: "8px" }}>
                              {news.tags.slice(0, 4).map((tag, ti) => (
                                <span key={ti} style={{ padding: "2px 8px", borderRadius: "6px", fontSize: "15px", background: C.card2, color: C.text3, fontWeight: 500 }}>{tag}</span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </a>
                    {/* ── Google AdSense (News - In-Feed after 3rd item) ─── */}
                    {i === 2 && <GoogleAd format="in-feed" slot="news-feed" style={{ margin: "12px 0" }} />}
                  </>);
                })}
              </div>
            )}

            {/* 뉴스 하단 — 쿠팡 공식 배너 */}
            <CoupangOfficialBanner width="728" height="90" bannerId={975393} style={{ margin: "12px 0" }} />
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════
            TAB: 경제 캘린더 (토스증권 스타일)
        ═══════════════════════════════════════════════════════════ */}
        {tab === "econ-calendar" && (() => {
          // 오늘 기준 캘린더 데이터
          const today = new Date();
          const firstDay = new Date(calYear, calMonth, 1).getDay(); // 0=일
          const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
          const monthNames = ["1월","2월","3월","4월","5월","6월","7월","8월","9월","10월","11월","12월"];

          // 주차별 이벤트 그룹화
          const getWeekOfMonth = (date) => Math.ceil((date.getDate() + new Date(date.getFullYear(), date.getMonth(), 1).getDay()) / 7);
          const eventsByWeek = {};
          const calFilterTabs = [
            { key: "all", label: "전체" },
            { key: "경제지표", label: "경제지표" },
            { key: "FOMC", label: "FOMC" },
            { key: "CPI", label: "CPI" },
            { key: "NFP", label: "고용" },
            { key: "GDP", label: "GDP" },
          ];

          // 이벤트 필터링
          let calEvents = econEvents;
          if (econFilter !== "all") {
            calEvents = econEvents.filter(e => {
              if (econFilter === "경제지표") return true;
              return e.type === econFilter;
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
            const monthLabel = `${k.year}년 ${k.month+1}월`;
            const weekLabel = `${wk}주차`;
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

          // 이벤트가 있는 날짜 세트
          const eventDates = new Set();
          calEvents.forEach(evt => {
            const k = kstParts(evt.date);
            if (k.valid && k.month === calMonth && k.year === calYear) {
              eventDates.add(k.date);
            }
          });

          return (
            <div className="tab-content">
              {/* 경제 캘린더 히어로 헤더 — 극적인 그라데이션 */}
              <div style={{
                background: `linear-gradient(135deg, ${C.yellowBg} 0%, ${C.card} 100%)`,
                borderRadius: "24px",
                padding: "28px",
                marginBottom: "20px",
                boxShadow: `0 4px 20px rgba(255,176,32,0.08)`,
              }}>
                <div style={{
                  fontWeight: 900,
                  fontSize: "28px",
                  color: C.text1,
                  marginBottom: "8px",
                }}>📅 경제 캘린더</div>
                <div style={{
                  fontSize: "16px",
                  color: C.text2,
                }}>세계 주요 경제 지표와 이벤트를 한눈에 파악하세요</div>
              </div>

              <div className="grid gap-5 grid-cols-1 lg:grid-cols-[280px_1fr] items-start">

                {/* ── 좌측: 미니 캘린더 + AI 요약 ── */}
                <div className="flex flex-col gap-4 lg:sticky lg:top-20">
                  {/* 미니 캘린더 */}
                  <div style={{
                    background: `linear-gradient(135deg, ${C.card} 0%, ${C.card2} 100%)`,
                    border: `1px solid ${C.border}20`,
                    borderRadius: "16px",
                    padding: "5",
                    boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
                  }} className="rounded-[16px] p-5">
                    <div className="flex items-center justify-between mb-4">
                      <button onClick={() => { if (calMonth === 0) { setCalMonth(11); setCalYear(y => y-1); } else setCalMonth(m => m-1); }}
                        className="bg-transparent border-none text-lg cursor-pointer p-1" style={{color: C.text2}}>‹</button>
                      <span className="font-bold text-base text-foreground">{calYear}년 {monthNames[calMonth]}</span>
                      <button onClick={() => { if (calMonth === 11) { setCalMonth(0); setCalYear(y => y+1); } else setCalMonth(m => m+1); }}
                        className="bg-transparent border-none text-lg cursor-pointer p-1" style={{color: C.text2}}>›</button>
                    </div>
                    {/* 요일 헤더 */}
                    <div className="grid gap-0.5 mb-1" style={{ gridTemplateColumns: "repeat(7, 1fr)" }}>
                      {["월","화","수","목","금","토","일"].map(d => (
                        <div key={d} className="text-center text-base font-semibold text-muted-foreground py-1">{d}</div>
                      ))}
                    </div>
                    {/* 날짜 그리드 */}
                    <div className="grid gap-0.5" style={{ gridTemplateColumns: "repeat(7, 1fr)" }}>
                      {/* 빈칸 (월요일 기준) */}
                      {Array.from({ length: (firstDay + 6) % 7 }).map((_, i) => <div key={`e-${i}`} />)}
                      {Array.from({ length: daysInMonth }).map((_, i) => {
                        const day = i + 1;
                        const isToday = day === today.getDate() && calMonth === today.getMonth() && calYear === today.getFullYear();
                        const hasEvent = eventDates.has(day);
                        const isSelected = calSelectedDay === day && !isToday;
                        return (
                          <div key={day} onClick={() => {
                            if (hasEvent) {
                              setCalSelectedDay(day);
                              // 해당 날짜의 주차로 스크롤
                              const clickedDate = new Date(calYear, calMonth, day);
                              const weekNum = Math.ceil((clickedDate.getDate() + new Date(clickedDate.getFullYear(), clickedDate.getMonth(), 1).getDay()) / 7);
                              const weekId = `econ-week-${calYear}-${String(calMonth+1).padStart(2,"0")}-W${weekNum}`;
                              const el = document.getElementById(weekId);
                              if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
                            }
                          }} style={{
                            textAlign: "center", padding: "6px 0", borderRadius: "8px",
                            fontSize: "15px", fontWeight: isToday || isSelected ? 800 : 500, position: "relative",
                            color: isToday ? "#fff" : isSelected ? C.blue : hasEvent ? C.text1 : C.text3,
                            background: isToday ? C.blue : isSelected ? `${C.blue}20` : "transparent",
                            cursor: hasEvent ? "pointer" : "default",
                            transition: "all 0.15s",
                          }}
                          onMouseEnter={e => { if (hasEvent && !isToday && !isSelected) e.currentTarget.style.background = `${C.blue}10`; }}
                          onMouseLeave={e => { if (!isToday && !isSelected) e.currentTarget.style.background = "transparent"; }}>
                            {day}
                            {hasEvent && !isToday && (
                              <div style={{ width: "4px", height: "4px", borderRadius: "50%", background: C.blue, margin: "2px auto 0" }} />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* AI 오늘의 경제 이벤트 요약 */}
                  {importantToday.length > 0 && (
                    <div style={{
                      background: `linear-gradient(135deg, ${C.red}15 0%, ${C.red}05 100%)`,
                      border: `1px solid ${C.red}30`,
                    }} className="rounded-[16px] p-5">
                      <div className="flex items-center gap-1.5 mb-3">
                        <span className="text-lg">⚡</span>
                        <span className="font-bold text-base" style={{color: C.red}}>오늘의 경제 이벤트</span>
                      </div>
                      <div className="text-[14px] text-foreground leading-relaxed" style={{ color: C.text1 }}>
                        {importantToday.map((evt, i) => {
                          const k = kstParts(evt.date);
                          const timeStr = k.valid ? `${String(k.hour).padStart(2,"0")}:${String(k.min).padStart(2,"0")}` : "—";
                          const resultStr = evt.actual && evt.estimate
                            ? (parseFloat(evt.actual) > parseFloat(evt.estimate) ? "상승 💚" : "하락 📉")
                            : evt.status === "완료" ? "발표완료" : "예정";
                          return (
                            <div key={i} style={{ marginBottom: i < importantToday.length - 1 ? "10px" : 0 }}>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px" }}>
                                <div style={{ flex: 1 }}>
                                  <strong>{evt.icon} {evt.name}</strong>
                                  <div style={{ fontSize: "14px", color: C.text2, marginTop: "3px" }}>
                                    {timeStr} {evt.importance === "high" ? "🔴 높음" : "🟡 중간"}
                                  </div>
                                </div>
                                <div style={{ fontSize: "14px", fontWeight: 600, color: evt.actual && parseFloat(evt.actual) > parseFloat(evt.estimate) ? C.green : C.red }}>
                                  {resultStr}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* AI 이번주 요약 */}
                  {importantThisWeek.length > 0 && (
                    <div style={{
                      background: `linear-gradient(135deg, ${C.card} 0%, ${C.blue}0A 100%)`,
                      border: `1px solid ${C.blue}20`,
                    }} className="rounded-[16px] p-5">
                      <div className="flex items-center gap-1.5 mb-3">
                        <span className="text-lg">✦</span>
                        <span className="font-bold text-base" style={{color: C.blue}}>이번주 AI 요약</span>
                      </div>
                      <div className="text-[15px] text-foreground leading-relaxed"  style={{ color: C.text1 }}>
                        {importantThisWeek.map((evt, i) => {
                          const k = kstParts(evt.date);
                          const dayName = k.valid ? ["일","월","화","수","목","금","토"][k.day] : "";
                          return (
                            <div key={i} style={{ marginBottom: i < importantThisWeek.length - 1 ? "8px" : 0 }}>
                              <strong>{evt.name}</strong> 발표가 {k.valid ? `${k.date}일(${dayName})` : "곧"} 예정되어 있어요
                            </div>
                          );
                        })}
                      </div>
                      <div style={{ marginTop: "10px", fontSize: "16px", color: C.blue, cursor: "pointer", fontWeight: 600 }}>
                        자세히 보기 ›
                      </div>
                    </div>
                  )}

                  {/* ── Google AdSense (Economic Calendar - Rectangle, desktop only) ─── */}
                  {!isMobile && <GoogleAd format="rectangle" slot="calendar-sidebar" style={{ margin: "16px 0", maxWidth: "300px" }} />}
                </div>

                {/* ── 우측: 이벤트 목록 ── */}
                <div>
                  {/* 필터 탭 — 모바일에서 수평 스크롤 가능 | 극적인 디자인 강화 */}
                  <div className={`flex gap-1.5 mb-5 ${isMobile ? "hscroll overflow-x-auto" : "flex-wrap"}`} style={{ WebkitOverflowScrolling: "touch" }}>
                    {calFilterTabs.map(ft => (
                      <button key={ft.key} onClick={() => setEconFilter(ft.key)} className="px-4 py-2 rounded-[12px] text-base font-semibold cursor-pointer transition-all flex-shrink-0" style={{
                        background: econFilter === ft.key ? `linear-gradient(135deg, ${C.yellow}60 0%, ${C.yellow}40 100%)` : C.card2,
                        color: econFilter === ft.key ? "#000" : C.text2,
                        border: `2px solid ${econFilter === ft.key ? C.yellow : "transparent"}`,
                        boxShadow: econFilter === ft.key ? `0 4px 16px ${C.yellow}40` : "none",
                        fontWeight: econFilter === ft.key ? 800 : 600,
                      }}>{ft.label}</button>
                    ))}
                  </div>

                  {/* 주차별 이벤트 그룹 */}
                  {weekGroups.length === 0 ? (
                    <div style={{ textAlign: "center", padding: "60px 24px", color: C.text3 }}>
                      <div style={{ fontSize: "32px", marginBottom: "12px" }}>📅</div>
                      <div style={{ fontSize: "18px" }}>해당 필터에 맞는 이벤트가 없습니다</div>
                    </div>
                  ) : weekGroups.map((group, gi) => {
                    // 주차별 ID 생성 (날짜 클릭 → 스크롤 대상)
                    const firstEvtDate = group.events[0]?.date ? new Date(group.events[0].date.toLocaleString("en-US", { timeZone: "Asia/Seoul" })) : null;
                    const weekId = firstEvtDate ? `econ-week-${firstEvtDate.getFullYear()}-${String(firstEvtDate.getMonth()+1).padStart(2,"0")}-W${Math.ceil((firstEvtDate.getDate() + new Date(firstEvtDate.getFullYear(), firstEvtDate.getMonth(), 1).getDay()) / 7)}` : `econ-week-${gi}`;
                    return (
                    <div key={gi} id={weekId} className="mb-6" style={{ scrollMarginTop: "80px" }}>
                      {/* 주차 헤더 */}
                      <div className="text-base font-bold text-foreground mb-3 px-1" style={{color: C.text1}}>
                        {group.monthLabel} {group.weekLabel}
                      </div>

                      {/* 테이블 헤더 */}
                      <div className="grid gap-1 py-2 px-4 text-base font-bold text-muted-foreground rounded-t-[12px] border border-b-0" style={{
                        gridTemplateColumns: isMobile ? "40px 1fr 70px" : "60px 1fr 80px 80px 80px",
                        background: C.card, borderColor: `${C.border}20`
                      }}>
                        <span></span>
                        <span></span>
                        <span style={{ textAlign: "right" }}>발표</span>
                        {!isMobile && <span style={{ textAlign: "right" }}>예측</span>}
                        {!isMobile && <span style={{ textAlign: "right" }}>이전</span>}
                      </div>

                      {/* 이벤트 목록 */}
                      <div style={{
                        background: C.card, border: `1px solid ${C.border}20`, borderTop: `1px solid ${C.border}15`,
                        overflow: "hidden",
                      }} className="rounded-b-[12px]">
                        {group.events.map((evt, i) => {
                          const k = kstParts(evt.date);
                          const d = k.valid ? k.date : "—";
                          const dayName = k.valid ? ["일","월","화","수","목","금","토"][k.day] : "";
                          const invertedIndicator = /CPI|PCE|PPI|Unemployment/i.test(evt.event);
                          const hasActual = evt.actual != null && evt.estimate != null;
                          const beat = hasActual ? (invertedIndicator ? evt.actual < evt.estimate : evt.actual > evt.estimate) : null;
                          const miss = hasActual ? (invertedIndicator ? evt.actual > evt.estimate : evt.actual < evt.estimate) : null;
                          const isPast = evt.daysUntil < 0;
                          const isToday = evt.status === "오늘";
                          const kstHour = k.valid ? String(k.hour).padStart(2, "0") : "--";
                          const kstMin = k.valid ? String(k.min).padStart(2, "0") : "--";

                          const importanceColor = evt.importance === "high" ? C.red : evt.importance === "medium" ? C.yellow : C.green;
                          return (
                            <div key={`${evt.event}-${i}`} className="grid items-center py-3.5 px-4 transition-all" style={{
                              gridTemplateColumns: isMobile ? "40px 1fr 70px" : "60px 1fr 80px 80px 80px",
                              gap: "1px",
                              borderBottom: i < group.events.length - 1 ? `1px solid ${C.border}10` : "none",
                              borderLeft: `4px solid ${importanceColor}`,
                              opacity: isPast ? 0.6 : 1,
                              background: isToday ? `${C.blue}08` : "transparent",
                            }}
                            onMouseEnter={e => { if (!isToday) { e.currentTarget.style.background = `${importanceColor}15`; e.currentTarget.style.paddingLeft = "12px"; } }}
                            onMouseLeave={e => { if (!isToday) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.paddingLeft = "16px"; } }}
                            >
                              {/* 날짜 */}
                              <div>
                                <span className="text-base font-bold" style={{
                                  color: isToday ? C.blue : C.text1,
                                }}>{d}{dayName}</span>
                              </div>

                              {/* 이벤트명 */}
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="text-base flex-shrink-0">{evt.icon}</span>
                                <div className="min-w-0">
                                  <div className="font-semibold text-[15px] text-foreground whitespace-nowrap overflow-hidden text-ellipsis">
                                    {evt.name}
                                  </div>
                                  {evt.daysUntil >= 0 && (
                                    <div className="text-base text-muted-foreground">
                                      {isToday ? `오늘 ${kstHour}:${kstMin}` : `오후 ${kstHour}:${kstMin} 발표 예정`}
                                    </div>
                                  )}
                                </div>
                              </div>

                              {/* 발표 */}
                              <div className="text-right">
                                {evt.actual != null ? (
                                  <span className="text-[15px] font-bold" style={{ color: beat ? C.green : miss ? C.red : C.text1, fontVariantNumeric: "tabular-nums" }}>
                                    {evt.actual}{evt.unit}
                                  </span>
                                ) : (
                                  <span className="text-sm text-muted-foreground" style={{fontVariantNumeric: "tabular-nums"}}>
                                    {isPast ? "발표 대기" : `${kstHour}시 예정`}
                                  </span>
                                )}
                              </div>

                              {/* 예측 */}
                              {!isMobile && <div className="text-right">
                                <span className="text-[15px]" style={{ color: C.text2, fontVariantNumeric: "tabular-nums" }}>
                                  {evt.estimate != null ? `${evt.estimate}${evt.unit}` : "—"}
                                </span>
                              </div>}

                              {/* 이전 */}
                              {!isMobile && <div className="text-right">
                                <span className="text-[15px] text-muted-foreground" style={{fontVariantNumeric: "tabular-nums"}}>
                                  {evt.previous != null ? `${evt.previous}${evt.unit}` : "—"}
                                </span>
                              </div>}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                  })}
                </div>
              </div>
            </div>
          );
        })()}

        {/* ═══════════════════════════════════════════════════════════
            TAB: 알림
        ═══════════════════════════════════════════════════════════ */}
        {tab === "alerts" && (
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
              }}>🚨 실시간 매매 알림</div>
              <div style={{
                fontSize: "16px",
                color: C.text2,
              }}>33개 퀀트 전략의 시그널을 실시간으로 감지합니다</div>
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
                  <div className="font-bold text-lg">🚨 전략 매매 알림</div>
                  <div className="text-base text-muted-foreground mt-0.5">
                    33개 퀀트 전략의 generate() 함수로 실제 매매 시그널을 감지합니다
                  </div>
                </div>
                {tradeAlerts.length > 0 && (
                  <button onClick={() => {
                    if (!confirm("매매 알림을 전부 삭제하시겠습니까?")) return;
                    setTradeAlerts([]); setAlertBadge(0);
                  }} className="px-3 py-1.5 rounded-lg text-sm font-semibold cursor-pointer" style={{
                    background: C.card2, color: C.text3, border: `1px solid ${C.border2}`,
                  }}>전체 삭제</button>
                )}
              </div>

              {/* 알림 설정 토글 */}
              <div className="flex gap-3 mb-3 flex-wrap">
                <label className="flex items-center gap-1.5 cursor-pointer text-sm text-muted-foreground">
                  <input type="checkbox" checked={settings.strategyAlerts !== false}
                    onChange={e => setSettings(p => ({ ...p, strategyAlerts: e.target.checked }))}
                    className="cursor-pointer" />
                  <span>전략 매매 알림 활성화</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer text-sm text-muted-foreground">
                  <input type="checkbox" checked={settings.autoSend}
                    onChange={e => setSettings(p => ({ ...p, autoSend: e.target.checked }))}
                    className="cursor-pointer" />
                  <span>텔레그램 동시 발송</span>
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
                      <div style={{ fontWeight: 700, fontSize: "15px" }}>브라우저 푸시 알림</div>
                      <div style={{ fontSize: "14px", color: C.text3 }}>
                        {notiPerm === "granted" ? "활성화됨 — 매매 시그널 발생 시 알림이 표시됩니다"
                          : notiPerm === "denied" ? "차단됨 — 브라우저 설정에서 알림을 허용해주세요"
                          : notiPerm === "unsupported" ? "이 브라우저에서 지원되지 않습니다"
                          : "허용하면 백그라운드에서도 매매 알림을 받을 수 있습니다"}
                      </div>
                    </div>
                  </div>
                  {notiPerm === "default" && (
                    <button onClick={async () => {
                      const perm = await Notification.requestPermission();
                      setNotiPerm(perm);
                      if (perm === "granted") {
                        new Notification("Zepta 알림 활성화", {
                          body: "전략 매매 시그널이 감지되면 여기로 알림이 옵니다 🚀",
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
                    }}>알림 허용</button>
                  )}
                  {notiPerm === "granted" && (
                    <span style={{ padding: "4px 10px", borderRadius: "6px", fontSize: "16px", fontWeight: 700, background: C.green + "20", color: C.green }}>ON</span>
                  )}
                  {notiPerm === "denied" && (
                    <span style={{ padding: "4px 10px", borderRadius: "6px", fontSize: "16px", fontWeight: 700, background: C.red + "20", color: C.red }}>차단됨</span>
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
                      <div style={{ fontWeight: 700, fontSize: "18px" }}>자동 스캔</div>
                      <div style={{ fontSize: "16px", color: C.text3 }}>
                        {settings.autoScanEnabled
                          ? `${settings.autoScanInterval || 30}분 간격으로 자동 실행`
                          : "비활성화됨"}
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
                      <span style={{ fontSize: "16px", color: C.text2, minWidth: "50px" }}>간격</span>
                      <div style={{ display: "flex", gap: "6px", flex: 1 }}>
                        {[15, 30, 60, 120].map(m => (
                          <button key={m} onClick={() => setSettings(p => ({ ...p, autoScanInterval: m }))} style={{
                            flex: 1, padding: "6px 0", borderRadius: "8px", fontSize: "16px", fontWeight: 600, cursor: "pointer",
                            background: (settings.autoScanInterval || 30) === m ? C.blueBg : "transparent",
                            color: (settings.autoScanInterval || 30) === m ? C.blue : C.text3,
                            border: `1px solid ${(settings.autoScanInterval || 30) === m ? C.blue + "40" : C.border2}`,
                          }}>{m < 60 ? `${m}분` : `${m / 60}시간`}</button>
                        ))}
                      </div>
                    </div>
                    {nextAutoScan && (
                      <div style={{ fontSize: "16px", color: C.text3, display: "flex", alignItems: "center", gap: "4px" }}>
                        <span>⏰</span> 다음 스캔: {nextAutoScan.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}
                        {scanning && <span style={{ color: C.blue, fontWeight: 600 }}> — 스캔 중...</span>}
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* 마켓 타입 필터 */}
              {tradeAlerts.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "12px" }}>
                  <div style={{ fontSize: "16px", color: C.text3, fontWeight: 600, alignSelf: "center", marginRight: "4px" }}>마켓:</div>
                  {[
                    ["all", "전체"],
                    ["us", "🇺🇸 미국"],
                    ["kr", "🇰🇷 한국"],
                    ["crypto", "₿ 크립토"],
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
                  <div style={{ fontSize: "16px", color: C.text3, fontWeight: 600, alignSelf: "center", marginRight: "4px" }}>시그널:</div>
                  {[
                    ["all", "전체", tradeAlerts.length],
                    ["buy", "매수", tradeAlerts.filter(a => a.action === "매수").length],
                    ["sell", "매도", tradeAlerts.filter(a => a.action !== "매수").length],
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
                  <div style={{ fontSize: "18px", fontWeight: 600, marginBottom: "4px" }}>아직 전략 매매 알림이 없습니다</div>
                  <div style={{ fontSize: "16px" }}>스크리너를 실행하면 33개 퀀트 전략이 실제 generate() 시그널을 감지합니다</div>
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
                            }}>{isBuy ? "📈 매수" : "📉 매도"}</span>
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
                              최근 {alert.recentSignalCount}건 시그널
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
              <div style={{ fontWeight: 700, fontSize: "18px", marginBottom: "16px" }}>📱 텔레그램 연동</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                <div>
                  <div style={{ fontSize: "16px", color: C.text3, marginBottom: "6px", fontWeight: 600 }}>봇 토큰</div>
                  <input value={settings.botToken} onChange={e => setSettings(p => ({ ...p, botToken: e.target.value }))}
                    placeholder="123456789:ABCdefGHIjklMNOpqrSTUvwxyz" type="password" style={{
                      width: "100%", padding: "10px 12px", borderRadius: "10px", fontSize: "16px",
                      background: C.bg, border: `1px solid ${C.border2}`, color: C.text1, outline: "none",
                    }} />
                </div>
                <div>
                  <div style={{ fontSize: "16px", color: C.text3, marginBottom: "6px", fontWeight: 600 }}>채팅 ID</div>
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
                    setTgStatus("⏳ 전송 중...");
                    try {
                      const r = await fetch(`https://api.telegram.org/bot${settings.botToken}/sendMessage`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ chat_id: settings.chatId, text: "🚨 *Zepta 테스트*\n\n텔레그램 연결 테스트 성공!", parse_mode: "Markdown" }),
                      });
                      if (r.ok) setTgStatus("✅ 텔레그램 연결 완료");
                      else setTgStatus("❌ 전송 실패");
                    } catch (e) { setTgStatus(`❌ ${e.message}`); }
                  })();
                }} style={{
                  padding: "9px 20px", borderRadius: "10px", fontSize: "18px", fontWeight: 700,
                  background: C.blue, color: "#fff", border: "none",
                }}>📤 연결 테스트</button>
              </div>

              {tgStatus && (
                <div style={{ fontSize: "16px", color: tgStatus.includes("✅") ? C.green : C.red, fontWeight: 600, marginTop: "8px" }}>
                  {tgStatus}
                </div>
              )}
            </div>

            {/* ── 동기화 ── */}
            <div style={{ background: C.card, border: `1px solid ${C.border}20`, borderRadius: "16px", padding: "22px 24px" }}>
              <div style={{ fontWeight: 700, fontSize: "18px", marginBottom: "16px" }}>🔄 데이터 동기화</div>
              <div style={{ marginBottom: "12px" }}>
                <div style={{ fontSize: "16px", color: C.text3, marginBottom: "6px", fontWeight: 600 }}>동기화 PIN (4자리 이상)</div>
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
                }}>📤 업로드</button>
                <button onClick={syncDownload} style={{
                  padding: "9px 20px", borderRadius: "10px", fontSize: "18px", fontWeight: 700,
                  background: C.green, color: "#fff", border: "none", flex: 1,
                }}>📥 다운로드</button>
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
              }}>💬 소셜 센티먼트 분석</div>
              <div style={{
                fontSize: "16px",
                color: C.text2,
              }}>StockTwits · Reddit(WSB) 기반 실시간 투자 심리</div>
            </div>

            {/* 검색 헤더 */}
            <div style={{background:`linear-gradient(135deg, ${C.card} 0%, ${C.card2} 100%)`,border:`1px solid ${C.border}20`,borderRadius:"16px",padding:"22px 24px",marginBottom:"12px",boxShadow:"0 2px 12px rgba(0,0,0,0.2)"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:"12px"}}>
                <div>
                  <div style={{fontWeight:800,fontSize:"18px",marginBottom:"4px",color:C.text1}}>{t("sentiment.title")}</div>
                  <div style={{fontSize:"14px",color:C.text3}}>StockTwits · Reddit(WSB) 기반 실시간 투자 심리</div>
                </div>
                <div style={{display:"flex",gap:"8px",alignItems:"center"}}>
                  <input value={sentimentSymbol} onChange={e=>setSentimentSymbol(e.target.value.toUpperCase())}
                    placeholder="SPY" onKeyDown={e=>{if(e.key==="Enter")fetchSentiment(sentimentSymbol);}}
                    style={{width:isMobile?"80px":"100px",padding:"8px 12px",borderRadius:"8px",fontSize:"15px",fontWeight:700,
                      background:C.card2,border:`1px solid ${C.border2}`,color:C.text1,outline:"none",textAlign:"center"}} />
                  <button onClick={()=>fetchSentiment(sentimentSymbol)} disabled={sentimentLoading} style={{
                    padding:"8px 16px",borderRadius:"8px",fontSize:"14px",fontWeight:700,
                    background:sentimentLoading?C.card2:`linear-gradient(135deg,${C.purple},#6D28D9)`,
                    color:"#fff",border:"none",cursor:sentimentLoading?"default":"pointer",
                  }}>{sentimentLoading?"분석 중...":"분석"}</button>
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
                <div>소셜 데이터 수집 중...</div>
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
                    {sentimentData.symbol} 종합 센티먼트
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
                    <span style={{color:C.green,fontWeight:600}}>긍정 {sentimentData.sentiment.bullish}%</span>
                    <span style={{color:C.text3}}>중립 {sentimentData.sentiment.neutral}%</span>
                    <span style={{color:C.red,fontWeight:600}}>부정 {sentimentData.sentiment.bearish}%</span>
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
                    <span style={{fontSize:"14px",color:C.text3}}>{src.total}개 포스트 분석</span>
                  </div>
                  {/* 소스 센티먼트 바 */}
                  <div style={{display:"flex",gap:"8px",marginBottom:"16px"}}>
                    {[{label:"긍정",val:src.bullish,color:C.green,bg:C.greenBg},
                      {label:"중립",val:src.neutral,color:C.text3,bg:C.card2},
                      {label:"부정",val:src.bearish,color:C.red,bg:C.redBg}].map(s=>(
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
                  <div style={{fontWeight:700,fontSize:"18px",marginBottom:"12px"}}>트렌딩 심볼</div>
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
                  <div>'{sentimentData.symbol}'에 대한 센티먼트 데이터가 없습니다</div>
                  <div style={{fontSize:"16px",marginTop:"4px"}}>다른 심볼을 검색해보세요</div>
                </div>
              )}
            </>)}

            {/* 초기 상태 */}
            {!sentimentLoading && !sentimentData && (
              <div style={{textAlign:"center",padding:"60px 24px",color:C.text3}}>
                <div style={{fontSize:"48px",marginBottom:"12px"}}>💬</div>
                <div style={{fontWeight:600,fontSize:"18px",marginBottom:"4px"}}>소셜 센티먼트 분석</div>
                <div style={{fontSize:"16px"}}>심볼을 입력하고 "분석" 버튼을 클릭하세요</div>
              </div>
            )}

          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════
            TAB: AI 퀀트 전략 (주식 + 크립토 통합)
        ═══════════════════════════════════════════════════════════ */}
        {tab === "auto-trading" && (
          <div className="card-stagger">
            <Suspense fallback={<LazyTabFallback />}><AutoTrading theme={themeMode} user={user} isOwner={isOwner} onNavigate={setTab} /></Suspense>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════
            TAB: 실전매매 (Phase 1 — 단일 사용자 Binance Futures)
        ═══════════════════════════════════════════════════════════ */}
        {tab === "real-trading" && isOwner && (
          <Suspense fallback={<LazyTabFallback />}><RealTrading theme={themeMode} /></Suspense>
        )}
        {tab === "real-trading" && !isOwner && (
          <div style={{ maxWidth: 720, margin: "80px auto", padding: "40px 24px", textAlign: "center", color: C.text2 }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🔒</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: C.text1, marginBottom: 8 }}>접근 권한이 없는 페이지입니다</div>
            <div style={{ fontSize: 15, color: C.text3, marginBottom: 24 }}>요청하신 페이지는 존재하지 않거나 접근할 수 없습니다.</div>
            <button onClick={() => setTab("home")} style={{ padding: "10px 20px", borderRadius: 8, border: `1px solid ${C.border}`, background: C.card, color: C.text1, fontWeight: 700, cursor: "pointer" }}>홈으로</button>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════
            TAB: 개발/QA 대시보드 (zepta.app/dev)
        ═══════════════════════════════════════════════════════════ */}
        {tab === "dev" && (
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
        {tab === "profile" && (
          <div className="tab-content" style={{ maxWidth: "720px", margin: "0 auto" }}>

            {/* ── 상단: 유저 영역 ── */}
            {user ? (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "20px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                  <div style={{
                    width: "44px", height: "44px", borderRadius: "50%",
                    background: `linear-gradient(135deg, ${C.blue}, ${C.purple})`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: "18px", fontWeight: 900, color: "#fff",
                  }}>
                    {(user?.user_metadata?.avatar_url)
                      ? <img src={user.user_metadata.avatar_url} alt="사용자 프로필" width="44" height="44" style={{ width: 44, height: 44, borderRadius: "50%", objectFit: "cover" }} />
                      : (user?.user_metadata?.nickname || user?.user_metadata?.display_name || user?.email || "U")[0].toUpperCase()
                    }
                  </div>
                  <div>
                    <div style={{ fontSize: "18px", fontWeight: 800, color: C.text1 }}>
                      {user?.user_metadata?.nickname || user?.user_metadata?.display_name || user?.email?.split("@")[0] || "User"}
                    </div>
                    <div style={{ fontSize: "12px", color: C.text3 }}>
                      {(() => { const uid = user?.id?.slice(0,8) || "anon"; const xi = getXpInfo(readTotalXp(uid).total); return `${xi.tier.icon} ${xi.tier.name} · Lv.${xi.level}`; })()}
                    </div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: "8px" }}>
                  <button onClick={() => setTab("mypage")} style={{
                    padding: "7px 14px", borderRadius: "10px", fontSize: "14px", fontWeight: 600,
                    background: C.card, border: `1px solid ${C.border}30`, color: C.text2, cursor: "pointer",
                  }}>내 정보</button>
                  <button onClick={toggleTheme} style={{
                    padding: "7px 12px", borderRadius: "10px", fontSize: "14px", fontWeight: 600,
                    background: C.card, border: `1px solid ${C.border}30`, color: C.text2, cursor: "pointer",
                  }}>{themeMode === "dark" ? "🌙" : "☀️"}</button>
                </div>
              </div>
            ) : (
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                marginBottom: "20px", padding: "16px", borderRadius: "16px",
                background: `linear-gradient(135deg, ${C.blueBg}, ${C.purpleBg})`,
                border: `1px solid ${C.blue}15`,
              }}>
                <div>
                  <div style={{ fontSize: "16px", fontWeight: 800, color: C.text1, marginBottom: "4px" }}>로그인하고 시작하세요</div>
                  <div style={{ fontSize: "12px", color: C.text3 }}>XP 적립, 랭킹, 관심종목 동기화까지</div>
                </div>
                <button onClick={() => setShowAuthModal(true)} style={{
                  padding: "10px 20px", borderRadius: "12px", fontSize: "14px", fontWeight: 700,
                  background: C.blue, color: "#fff", border: "none", cursor: "pointer",
                  whiteSpace: "nowrap",
                }}>로그인</button>
              </div>
            )}

            {/* ── 서비스 그리드 (토스 스타일 아이콘 그리드) ── */}
            <div style={{
              background: C.card, borderRadius: "20px", padding: "20px 16px",
              border: `1px solid ${C.border}${C.isDark ? '18' : '40'}`,
              marginBottom: "16px",
            }}>
              <div style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, 1fr)",
                gap: "4px",
              }}>
                {[
                  { icon: <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={C.blue} strokeWidth="1.8"><circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="21" y2="21"/></svg>, label: "스크리너", tab: "screener" },
                  { icon: <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={C.purple} strokeWidth="1.8"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M8 12l3 3 5-6" strokeWidth="2"/></svg>, label: "AI매매", tab: "auto-trading" },
                  { icon: <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={C.green} strokeWidth="1.8"><path d="M3 3v18h18"/><path d="M7 16l4-6 4 3 5-7"/></svg>, label: "전략분석", tab: "strategy" },
                  { icon: <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#E67E22" strokeWidth="1.8"><rect x="2" y="3" width="20" height="18" rx="2"/><path d="M8 7h8M8 11h5M8 15h7"/></svg>, label: "뉴스", tab: "news" },
                  { icon: <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={C.red || "#ef4444"} strokeWidth="1.8"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>, label: "캘린더", tab: "calendar" },
                  { icon: <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={C.blue} strokeWidth="1.8"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" fill="none"/></svg>, label: "포트폴리오", tab: "portfolio" },
                  { icon: <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#FFD700" strokeWidth="1.8"><path d="M12 2l2.4 7.4H22l-6 4.6 2.3 7L12 16.4 5.7 21l2.3-7L2 9.4h7.6z"/></svg>, label: "랭킹", action: () => { setTab("profile"); setTimeout(() => document.getElementById("ranking-section")?.scrollIntoView({ behavior: "smooth" }), 100); } },
                  { icon: <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={C.text3} strokeWidth="1.8"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>, label: "설정", tab: "settings-sub" },
                ].map((item, i) => (
                  <button key={i} onClick={() => item.action ? item.action() : setTab(item.tab)} style={{
                    display: "flex", flexDirection: "column", alignItems: "center", gap: "6px",
                    padding: "12px 4px", borderRadius: "12px", border: "none",
                    background: "transparent", cursor: "pointer",
                    transition: "background .15s",
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = `${C.border}15`}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                  >
                    <div style={{
                      width: "52px", height: "52px", borderRadius: "16px",
                      background: `${C.isDark ? '#1a2235' : '#f0f4ff'}`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>{item.icon}</div>
                    <span style={{ fontSize: "12px", fontWeight: 600, color: C.text2, lineHeight: 1.2 }}>{item.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* ── XP 레벨 미니 카드 (로그인 시) ── */}
            {user && (() => {
              const uid = user?.id?.slice(0, 8) || "anon";
              const xpData = readTotalXp(uid);
              const xpInfo = getXpInfo(xpData.total);
              return (
                <div onClick={() => setTab("mypage")} style={{
                  background: C.card, borderRadius: "16px", padding: "16px",
                  border: `1px solid ${C.border}${C.isDark ? '18' : '40'}`,
                  marginBottom: "16px", cursor: "pointer",
                  display: "flex", alignItems: "center", gap: "14px",
                }}>
                  <div style={{
                    width: "48px", height: "48px", borderRadius: "12px",
                    background: `${xpInfo.tier.color}15`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: "24px",
                  }}>{xpInfo.tier.icon}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: "6px", marginBottom: "6px" }}>
                      <span style={{ fontSize: "16px", fontWeight: 800, color: xpInfo.tier.color }}>Lv.{xpInfo.level}</span>
                      <span style={{ fontSize: "12px", color: C.text3 }}>{xpInfo.tier.name}</span>
                      <span style={{ fontSize: "14px", fontWeight: 700, color: C.blue, marginLeft: "auto" }}>{xpData.total.toLocaleString()} XP</span>
                    </div>
                    <div style={{ height: "4px", borderRadius: "4px", background: `${C.border}30`, overflow: "hidden" }}>
                      <div style={{
                        height: "100%", width: `${Math.round(xpInfo.progress * 100)}%`,
                        borderRadius: "4px",
                        background: `linear-gradient(90deg, ${xpInfo.tier.color}, ${C.blue})`,
                      }} />
                    </div>
                  </div>
                  <span style={{ fontSize: "14px", color: C.text3 }}>›</span>
                </div>
              );
            })()}

            {/* ── 투자 서비스 리스트 ── */}
            <div style={{
              background: C.card, borderRadius: "16px", overflow: "hidden",
              border: `1px solid ${C.border}${C.isDark ? '18' : '40'}`,
              marginBottom: "16px",
            }}>
              <div style={{ padding: "14px 20px", fontSize: "14px", fontWeight: 800, color: C.text1 }}>투자 서비스</div>
              {[
                { icon: "📊", label: "마켓 브리핑", desc: "실시간 시장 현황", tab: "home" },
                { icon: "🎯", label: "오늘의 예측", desc: "내일 S&P 500 방향 맞추기", tab: "home" },
                { icon: "🧠", label: "퀀트 전략", desc: "33개 AI 전략 시그널", tab: "strategy" },
                { icon: "🤖", label: "AI 자동매매", desc: "봇 기반 퀀트 트레이딩", tab: "auto-trading" },
                { icon: "📰", label: "투자 뉴스", desc: "실시간 글로벌 뉴스", tab: "news" },
              ].map((item, i) => (
                <div key={i} onClick={() => setTab(item.tab)} style={{
                  display: "flex", alignItems: "center", gap: "14px",
                  padding: "14px 20px", borderTop: `1px solid ${C.border}15`, cursor: "pointer",
                  transition: "background .1s",
                }}
                onMouseEnter={e => e.currentTarget.style.background = `${C.border}10`}
                onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                >
                  <span style={{ fontSize: "20px", width: "28px", textAlign: "center" }}>{item.icon}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: "15px", fontWeight: 700, color: C.text1 }}>{item.label}</div>
                    <div style={{ fontSize: "12px", color: C.text3 }}>{item.desc}</div>
                  </div>
                  <span style={{ fontSize: "14px", color: C.text3 }}>›</span>
                </div>
              ))}
            </div>

            {/* ── 전체 랭킹 ── */}
            <div id="ranking-section" style={{
              background: C.card, borderRadius: "16px", overflow: "hidden",
              border: `1px solid ${C.border}${C.isDark ? '18' : '40'}`,
              marginBottom: "16px", padding: isMobile ? "16px" : "20px",
            }}>
              {(() => {
                const uid = user?.id?.slice(0, 8) || "anon";
                const myXp = readTotalXp(uid);
                const myInfo = getXpInfo(myXp.total);
                const myName = user?.user_metadata?.nickname || user?.user_metadata?.display_name || "나";
                const myStats = (() => { try { return JSON.parse(localStorage.getItem("zepta:pred:stats") || '{"correct":0,"total":0}'); } catch { return { correct: 0, total: 0 }; } })();
                const myWinRate = myStats.total > 0 ? Math.round((myStats.correct / myStats.total) * 100) : 0;
                const fullLb = [
                  { name: "투자의신", xp: 4800, winRate: 78, predictions: 89, level: 28 },
                  { name: "퀀트마스터", xp: 3200, winRate: 72, predictions: 65, level: 22 },
                  { name: "알파헌터", xp: 2100, winRate: 68, predictions: 52, level: 16 },
                  { name: "스마트머니", xp: 1500, winRate: 65, predictions: 43, level: 12 },
                  { name: "데이터루크", xp: 800, winRate: 63, predictions: 31, level: 8 },
                  { name: "머니메이커", xp: 600, winRate: 60, predictions: 25, level: 7 },
                  { name: "차트읽기장인", xp: 450, winRate: 58, predictions: 20, level: 5 },
                ].map(u => ({ ...u, isMe: false, tierInfo: [...XP_TIERS].reverse().find(t => u.level >= t.minLv) || XP_TIERS[0] }));
                if (user && myXp.total > 0) fullLb.push({ name: myName, xp: myXp.total, winRate: myWinRate, predictions: myStats.total, level: myInfo.level, isMe: true, tierInfo: myInfo.tier });
                fullLb.sort((a, b) => b.xp - a.xp);
                fullLb.forEach((u, i) => { u.rank = i + 1; });
                const badges = ["🏆", "🥈", "🥉"];
                return (
                  <>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "14px" }}>
                      <span style={{ fontSize: "18px" }}>🏅</span>
                      <span style={{ fontWeight: 800, fontSize: "16px", color: C.text1 }}>투자 랭킹</span>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                      {fullLb.map(u => (
                        <div key={u.rank} style={{
                          display: "flex", alignItems: "center", gap: "10px",
                          padding: "10px 12px", borderRadius: "12px",
                          background: u.isMe ? `${C.blue}10` : u.rank <= 3 ? `${u.tierInfo.color}08` : "transparent",
                          border: u.isMe ? `1px solid ${C.blue}25` : "1px solid transparent",
                        }}>
                          <span style={{ fontWeight: 800, fontSize: "14px", color: u.rank <= 3 ? u.tierInfo.color : C.text3, width: "24px", textAlign: "center" }}>{badges[u.rank - 1] || u.rank}</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                              <span style={{ fontWeight: 700, fontSize: "14px", color: u.isMe ? C.blue : C.text1 }}>{u.name}{u.isMe ? " (나)" : ""}</span>
                              <span style={{ fontSize: "10px", fontWeight: 700, padding: "1px 6px", borderRadius: "6px", background: `${u.tierInfo.color}15`, color: u.tierInfo.color }}>Lv.{u.level}</span>
                            </div>
                            <div style={{ fontSize: "12px", color: C.text3 }}>적중률 {u.winRate}% · {u.predictions}회 예측</div>
                          </div>
                          <div style={{ textAlign: "right" }}>
                            <div style={{ fontWeight: 800, fontSize: "14px", color: u.tierInfo.color }}>{u.xp.toLocaleString()} XP</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                );
              })()}
            </div>

            {/* ── 고객지원 / 정보 ── */}
            <div style={{
              background: C.card, borderRadius: "16px", overflow: "hidden",
              border: `1px solid ${C.border}${C.isDark ? '18' : '40'}`,
              marginBottom: "16px",
            }}>
              <div style={{ padding: "14px 20px", fontSize: "14px", fontWeight: 800, color: C.text1 }}>고객지원</div>
              {[
                { icon: "📋", label: "서비스 소개", tab: "about" },
                { icon: "📖", label: "투자 가이드", tab: "guide" },
                { icon: "🔒", label: "개인정보 처리방침", tab: "privacy" },
                { icon: "📄", label: "이용약관", tab: "terms" },
                { icon: "✉️", label: "문의하기", tab: "contact" },
              ].map((item, i) => (
                <div key={i} onClick={() => setTab(item.tab)} style={{
                  display: "flex", alignItems: "center", gap: "14px",
                  padding: "14px 20px", borderTop: `1px solid ${C.border}15`, cursor: "pointer",
                  transition: "background .1s",
                }}
                onMouseEnter={e => e.currentTarget.style.background = `${C.border}10`}
                onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                >
                  <span style={{ fontSize: "16px", width: "24px", textAlign: "center" }}>{item.icon}</span>
                  <span style={{ fontSize: "15px", fontWeight: 600, color: C.text2, flex: 1 }}>{item.label}</span>
                  <span style={{ fontSize: "14px", color: C.text3 }}>›</span>
                </div>
              ))}
            </div>

            {/* ── 로그아웃 (로그인 시에만) ── */}
            {user && (
              <button onClick={() => { if (confirm("로그아웃 하시겠습니까?")) { signOut(); setTab("home"); } }} style={{
                width: "100%", padding: "14px", borderRadius: "12px", fontSize: "15px", fontWeight: 700,
                background: `${C.red}08`, color: C.red, border: `1px solid ${C.red}15`, cursor: "pointer",
                marginBottom: "8px",
              }}>로그아웃</button>
            )}

            {/* 푸터 */}
            <div style={{ textAlign: "center", padding: "8px 0 24px" }}>
              <span style={{ fontSize: "12px", color: C.text3 }}>Zepta v11.3 · donginseo0421@gmail.com</span>
            </div>
          </div>
        )}

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
              }}>← 전체</button>
              <span style={{ fontSize: "18px", fontWeight: 800, color: C.text1 }}>내 정보</span>
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
                        ? <img src={user.user_metadata.avatar_url} alt="사용자 프로필" width="72" height="72" style={{ width: 72, height: 72, borderRadius: "50%", objectFit: "cover" }} />
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
                      <span>다음 레벨까지 {xpInfo.nextLevelXp - xpInfo.currentLevelXp} XP</span>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* 닉네임 */}
            <NicknameEditor user={user} supabase={supabase} onUpdate={refreshUser} />

            {/* 계정 정보 */}
            <div style={{ background: C.card, border: `1px solid ${C.border}` }} className="rounded-[16px] overflow-hidden">
              <div className="px-5 py-3.5 text-sm font-bold text-muted-foreground uppercase tracking-wider">계정 정보</div>
              {[
                { label: "이메일", value: user?.email || "—" },
                { label: "로그인 방식", value: user?.app_metadata?.provider === "google" ? "Google" : user?.app_metadata?.provider || "이메일" },
                { label: "가입일", value: user?.created_at ? new Date(user.created_at).toLocaleDateString("ko-KR") : "—" },
              ].map((item, i) => (
                <div key={i} className="flex justify-between items-center px-5 py-3.5 border-t" style={{ borderTopColor: `${C.border}20` }}>
                  <span style={{ fontSize: "14px", color: C.text3 }}>{item.label}</span>
                  <span style={{ fontSize: "14px", fontWeight: 600, color: C.text1 }}>{item.value}</span>
                </div>
              ))}
            </div>

            {/* 투자 성적표 */}
            <div style={{ background: `linear-gradient(135deg, ${C.blue}12, ${C.purple}12)`, borderRadius: "16px", padding: "24px", textAlign: "center", border: `1px solid ${C.blue}20` }}>
              <div style={{ fontSize: "16px", fontWeight: 800, color: C.text1, marginBottom: "16px" }}>내 투자 성적표</div>
              <div style={{ display: "flex", justifyContent: "center", gap: "24px", marginBottom: "16px" }}>
                {[
                  { val: watchlist.length, label: "관심종목", color: C.blue },
                  { val: (() => { try { return JSON.parse(localStorage.getItem(`zepta_${user.id.slice(0,8)}_active_bots`) || "[]").length; } catch { return 0; } })(), label: "운영봇", color: C.purple },
                  { val: (() => { try { return Math.floor((Date.now() - new Date(user.created_at).getTime()) / 86400000); } catch { return 0; } })(), label: "투자일", color: C.green },
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
                const txt = `[Zepta AI 투자 성적표]\n${user?.user_metadata?.nickname || "투자자"}님 · 관심종목 ${watchlist.length}개 | 봇 ${bots}개 | ${days}일째\n무료 시작 👉 https://zepta.app`;
                if (navigator.share) navigator.share({ title: "Zepta 성적표", text: txt }).catch(() => {});
                else navigator.clipboard.writeText(txt).then(() => showToast("복사되었습니다!", "success")).catch(() => {});
              }} style={{
                padding: "10px 24px", borderRadius: "10px", fontSize: "14px", fontWeight: 700,
                background: `linear-gradient(135deg, ${C.blue}, ${C.purple})`, color: "#fff",
                border: "none", cursor: "pointer",
              }}>📤 공유하기</button>
            </div>

            {/* 친구 초대 */}
            <div style={{ background: C.card, borderRadius: "16px", padding: "20px", border: `1px solid ${C.border}${C.isDark ? '18' : '40'}` }}>
              <div style={{ fontSize: "14px", fontWeight: 800, color: C.text1, marginBottom: "10px" }}>친구 초대</div>
              <div style={{ fontSize: "14px", color: C.text3, marginBottom: "12px" }}>AI 퀀트 전략을 무료로 이용할 수 있어요</div>
              <div style={{ display: "flex", gap: "8px" }}>
                <button onClick={() => {
                  const txt = "AI가 매수 타점 잡아주는 투자앱이야. 무료인데 한번 써봐 👉 https://zepta.app";
                  if (navigator.share) navigator.share({ text: txt }).catch(() => {});
                  else navigator.clipboard.writeText(txt).then(() => showToast("복사됨!", "success")).catch(() => {});
                }} style={{ flex: 1, padding: "10px", borderRadius: "10px", fontSize: "14px", fontWeight: 700, background: C.blue, color: "#fff", border: "none", cursor: "pointer" }}>공유하기</button>
                <button onClick={() => navigator.clipboard.writeText("https://zepta.app").then(() => showToast("링크 복사!", "success")).catch(() => {})} style={{
                  flex: 1, padding: "10px", borderRadius: "10px", fontSize: "14px", fontWeight: 700,
                  background: "transparent", color: C.text2, border: `1px solid ${C.border}30`, cursor: "pointer",
                }}>링크 복사</button>
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
                33개 퀀트 전략으로 24/7 자동 분석하고, 최적의 매수 타점을 찾아줍니다.
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
                  { icon: "🤖", title: "AI 퀀트 자동매매", desc: "33개 알파 전략으로 24/7 자동 매매" },
                  { icon: "📊", title: "실시간 스크리너", desc: "수백 개 지표로 매수 타점 자동 탐색" },
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
                  Zepta는 개인 투자자를 위한 종합 투자 정보 플랫폼입니다. 미국 주식과 글로벌 암호화폐 시장을 아우르는 실시간 데이터 분석, AI 기반 퀀트 전략, 자동매매 시스템을 제공하여 데이터 기반의 합리적인 투자 의사결정을 지원합니다.
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
                    <strong style={{ color: C.text1 }}>AI 퀀트 자동매매</strong> — 멀티팩터 시그널 분석을 기반으로 매수/매도 시점을 자동으로 판단합니다.
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
            <h1 style={{ fontSize: isMobile ? "24px" : "28px", fontWeight: 800, color: C.text1, marginBottom: "8px" }}>개인정보처리방침</h1>
            <p style={{ fontSize: isMobile ? "14px" : "15px", color: C.text3, marginBottom: "24px" }}>시행일: 2025년 1월 1일 · 최종 수정: 2026년 4월 5일</p>

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
                <p style={{ fontSize: isMobile ? "15px" : "16px", marginBottom: "0", lineHeight: 1.7 }}>서비스 제공: 관심 종목 저장, 자동매매 봇 설정 저장</p>
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
            <h1 style={{ fontSize: isMobile ? "24px" : "28px", fontWeight: 800, color: C.text1, marginBottom: "8px" }}>이용약관</h1>
            <p style={{ fontSize: isMobile ? "14px" : "15px", color: C.text3, marginBottom: "24px" }}>시행일: 2025년 1월 1일 · 최종 수정: 2026년 4월 5일</p>

            <section style={{ marginBottom: "28px", background: `linear-gradient(135deg, ${C.card} 0%, ${C.card2} 100%)`, borderRadius: "16px", padding: "20px", border: `1px solid ${C.border}20`, borderLeft: `4px solid ${C.blue}` }}>
              <h2 style={{ fontSize: isMobile ? "16px" : "18px", fontWeight: 700, color: C.text1, marginBottom: "10px" }}>제1조 (목적)</h2>
              <p style={{ fontSize: isMobile ? "15px" : "16px", lineHeight: 1.7, marginBottom: "0" }}>
                본 약관은 Zepta가 제공하는 투자 정보 서비스의 이용 조건 및 절차, 이용자와 서비스 간의 권리·의무·책임 사항을 규정함을 목적으로 합니다.
              </p>
            </section>

            <section style={{ marginBottom: "28px", background: `linear-gradient(135deg, ${C.card} 0%, ${C.card2} 100%)`, borderRadius: "16px", padding: "20px", border: `1px solid ${C.border}20`, borderLeft: `4px solid ${C.purple}` }}>
              <h2 style={{ fontSize: isMobile ? "16px" : "18px", fontWeight: 700, color: C.text1, marginBottom: "10px" }}>제2조 (서비스의 내용)</h2>
              <p style={{ fontSize: isMobile ? "15px" : "16px", lineHeight: 1.7, marginBottom: "0" }}>
                서비스는 실시간 시장 데이터 조회 및 분석, AI 기반 자동매매, 종목 스크리닝, 포트폴리오 관리, 경제 캘린더 및 뉴스를 제공합니다. 서비스는 투자 참고 자료를 제공하는 것이며, 투자 자문 서비스가 아닙니다.
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
            <h1 style={{ fontSize: isMobile ? "24px" : "28px", fontWeight: 800, color: C.text1, marginBottom: "24px" }}>문의하기</h1>
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

        {/* 차트 모달 */}
        {chartAsset && (
          <Suspense fallback={<LazyTabFallback />}>
            <ChartModal asset={chartAsset} onClose={() => setChartAsset(null)} krwRate={krwRate} theme={themeMode} />
          </Suspense>
        )}

        {/* ═══ 풋터 (토스 스타일) ═══ */}
        <footer style={{
          maxWidth: "1400px", margin: "60px auto 0",
          padding: "32px 24px calc(40px + env(safe-area-inset-bottom, 0px))",
          borderTop: `1px solid ${C.border}${C.isDark ? '20' : '40'}`,
        }}>
          {/* 상단: 네비게이션 링크 */}
          <div style={{ display: "flex", alignItems: "center", gap: "0", flexWrap: "wrap", marginBottom: "20px" }}>
            {[
              { label: "개인정보 처리방침", tab: "privacy", bold: true },
              { label: "이용약관", tab: "terms" },
              { label: "서비스 소개", tab: "about" },
              { label: "투자 가이드", href: "/guide" },
              { label: "문의하기", tab: "contact" },
            ].map((item, i) => (
              <span key={item.tab || item.href} style={{ display: "flex", alignItems: "center" }}>
                {i > 0 && <span style={{ margin: "0 10px", color: C.text2, opacity: 0.25 }}>|</span>}
                {item.href ? (
                  <a
                    href={item.href}
                    style={{
                      fontSize: "16px", color: C.text2, cursor: "pointer",
                      fontWeight: item.bold ? 700 : 400, textDecoration: "none",
                    }}
                    onMouseEnter={e => { e.target.style.color = C.text1; }}
                    onMouseLeave={e => { e.target.style.color = C.text2; }}
                  >{item.label}</a>
                ) : (
                  <span
                    onClick={() => setTab(item.tab)}
                    style={{
                      fontSize: "16px", color: C.text2, cursor: "pointer",
                      fontWeight: item.bold ? 700 : 400,
                    }}
                    onMouseEnter={e => { e.target.style.color = C.text1; }}
                    onMouseLeave={e => { e.target.style.color = C.text2; }}
                  >{item.label}</span>
                )}
              </span>
            ))}
          </div>

          {/* 중단: 사업자 정보 */}
          <div style={{ fontSize: "16px", color: C.text2, lineHeight: 1.8, marginBottom: "16px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "8px" }}>
              <img src="/zepta-icon-192.png" alt="Zepta" width="18" height="18" style={{ flexShrink: 0 }} />
              <span style={{ fontWeight: 600, fontSize: "16px", color: C.text1 }}>Zepta</span>
            </div>
            <span>대표: 서동인</span>
            <span style={{ margin: "0 8px", opacity: 0.3 }}>·</span>
            <span>문의: donginseo0421@gmail.com</span>
          </div>

          {/* 하단: 면책 + 저작권 */}
          <div style={{ fontSize: "16px", color: C.text3, lineHeight: 1.7 }}>
            <p style={{ margin: "0 0 6px" }}>
              Zepta에서 제공하는 투자 정보는 고객의 투자 판단을 위한 단순 참고용이며, 투자 제안 및 권유, 종목 추천을 위해 작성된 것이 아닙니다.
            </p>
            <p style={{ margin: 0 }}>© 2025-2026 Zepta. All rights reserved.</p>
          </div>
        </footer>
      </main>
      </PullToRefresh>

      {/* ── 하단 실시간 티커 바 (모바일: 탭바 위, 데스크톱: 바닥) ── */}
      {marketIndices.length > 0 && (
        <div style={{
          position: "fixed", bottom: isMobile ? "82px" : 0, left: 0, right: 0, zIndex: 90,
          background: `${C.bg}F0`, borderTop: `1px solid ${C.border}${C.isDark ? '30' : '50'}`,
          backdropFilter: "blur(8px)", padding: "6px 0", overflow: "hidden",
        }}>
          <div style={{
            display: "flex", gap: "24px", animation: "tickerScroll 30s linear infinite",
            whiteSpace: "nowrap", paddingLeft: "100%",
          }}>
            {[...marketIndices, ...marketIndices].map((idx, i) => (
              <span key={`${idx.symbol}-${i}`} style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "16px", flexShrink: 0 }}>
                <span style={{ color: C.text3, fontWeight: 500 }}>{idx.flag} {idx.name}</span>
                <span style={{ color: C.text1, fontWeight: 700 }}>{idx.price?.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                <span style={{ color: idx.change >= 0 ? C.green : C.red, fontWeight: 600 }}>{idx.change >= 0 ? "+" : ""}{idx.change}%</span>
              </span>
            ))}
          </div>
        </div>
      )}

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
          title="맨 위로"
        >
          ↑
        </button>
      )}

      {/* ═══ 모바일 하단 탭 네비게이션 바 (토스 스타일 — SVG 아이콘) ═══ */}
      {isMobile && (
        <nav className="mobile-bottom-nav" style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          height: "82px",
          background: C.isDark ? `${C.bg}F2` : `${C.bg}F8`,
          backdropFilter: "blur(20px) saturate(180%)",
          WebkitBackdropFilter: "blur(20px) saturate(180%)",
          borderTop: `0.5px solid ${C.border}${C.isDark ? '20' : '35'}`,
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-around",
          paddingTop: "6px",
          zIndex: 10000,
        }}>
          {[
            { id: "home", label: "홈", icon: (active) => <svg width="24" height="24" viewBox="0 0 24 24" fill={active ? "currentColor" : "none"} stroke="currentColor" strokeWidth={active ? "0" : "1.8"} strokeLinecap="round" strokeLinejoin="round"><path d={active ? "M3 10.5L12 3l9 7.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V10.5z" : "M3 10.5L12 3l9 7.5V20a1 1 0 0 1-1 1h-4.5v-6h-3v6H4a1 1 0 0 1-1-1V10.5z"} />{active && <rect x="9" y="14" width="6" height="7" rx="0.5" fill={C.isDark ? C.bg : "#fff"} />}</svg> },
            { id: "screener", label: "스크리너", icon: (active) => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? "2.2" : "1.8"} strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" fill={active ? "currentColor" : "none"} opacity={active ? 0.15 : 1}/><circle cx="11" cy="11" r="7" /><line x1="16.5" y1="16.5" x2="21" y2="21" /></svg> },
            { id: "auto-trading", label: "AI매매", icon: (active) => <svg width="24" height="24" viewBox="0 0 24 24" fill={active ? "currentColor" : "none"} stroke="currentColor" strokeWidth={active ? "0" : "1.8"} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="3" fill={active ? "currentColor" : "none"} /><path d="M8 12l3 3 5-6" stroke={active ? (C.isDark ? C.bg : "#fff") : "currentColor"} strokeWidth="2" fill="none" />{active && <circle cx="18" cy="6" r="3.5" fill={C.green} stroke="none" />}</svg> },
            { id: "portfolio", label: "포트폴리오", icon: (active) => <svg width="24" height="24" viewBox="0 0 24 24" fill={active ? "currentColor" : "none"} stroke="currentColor" strokeWidth={active ? "0" : "1.8"} strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" fill="none" stroke={active ? (C.isDark ? C.bg : "#fff") : "currentColor"} strokeWidth="1.8" /></svg> },
            { id: "more", label: "더보기", icon: (active) => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? "2.2" : "1.8"} strokeLinecap="round" strokeLinejoin="round"><line x1="4" y1="6" x2="20" y2="6" /><line x1="4" y1="12" x2="20" y2="12" /><line x1="4" y1="18" x2="20" y2="18" /></svg> },
          ].map(item => {
            const isActive = item.id === "more"
              ? !["home","screener","auto-trading","portfolio"].includes(tab)
              : tab === item.id;
            return (
              <button key={item.id} onClick={() => {
                if (item.id === "more") {
                  setTab("profile");
                } else {
                  setTab(item.id);
                }
              }} style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: "2px",
                padding: "6px 0 2px",
                background: "transparent",
                border: "none",
                cursor: "pointer",
                color: isActive ? C.blue : C.text3,
                transition: "color .2s",
                position: "relative",
                WebkitTapHighlightColor: "transparent",
              }}>
                <div style={{ width: 24, height: 24, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {item.icon(isActive)}
                </div>
                <span style={{
                  fontSize: "10px",
                  fontWeight: isActive ? 700 : 500,
                  lineHeight: 1,
                  letterSpacing: "-0.2px",
                  marginTop: "2px",
                }}>{item.label}</span>
              </button>
            );
          })}
        </nav>
      )}

      {/* FAB 버튼 */}
      <button onClick={() => setAiChatOpen(!aiChatOpen)} style={{
        position: "fixed", bottom: isMobile ? "100px" : "28px", right: isMobile ? "16px" : "28px",
        width: "56px", height: "56px", borderRadius: "16px", border: "none",
        background: `linear-gradient(135deg, ${C.blue}, ${C.purple})`,
        color: "#fff", fontSize: "24px", cursor: "pointer",
        boxShadow: "0 4px 20px rgba(59,130,246,0.4)",
        zIndex: 9998, display: "flex", alignItems: "center", justifyContent: "center",
        transition: "transform .2s, box-shadow .2s",
        animation: aiChatOpen ? "none" : "fabPulse 2s ease-in-out infinite",
      }}
      onMouseEnter={e => { e.currentTarget.style.transform = "scale(1.08)"; e.currentTarget.style.boxShadow = "0 6px 28px rgba(59,130,246,0.5)"; }}
      onMouseLeave={e => { e.currentTarget.style.transform = "scale(1)"; e.currentTarget.style.boxShadow = "0 4px 20px rgba(59,130,246,0.4)"; }}>
        {aiChatOpen ? "✕" : "🤖"}
      </button>

      {/* 채팅 패널 */}
      {aiChatOpen && (
        <div style={{
          position: "fixed", bottom: "90px", right: "28px",
          width: isMobile ? "calc(100vw - 56px)" : "400px", maxHeight: isMobile ? "calc(100vh - 200px)" : "540px",
          background: C.card, borderRadius: "20px", border: `1px solid ${C.border}`,
          boxShadow: `0 12px 48px ${C.isDark ? "rgba(0,0,0,0.5)" : "rgba(0,0,0,0.15)"}`,
          zIndex: 9999, display: "flex", flexDirection: "column", overflow: "hidden",
          maxWidth: "100vw",
        }}>
          {/* 헤더 */}
          <div style={{
            padding: "16px 20px", borderBottom: `1px solid ${C.border}20`,
            background: `linear-gradient(135deg, ${C.card} 0%, ${C.blueBg} 100%)`,
          }}>
            <div style={{ fontWeight: 700, fontSize: "18px", color: C.text1 }}>🤖 AI 투자 어시스턴트</div>
            <div style={{ fontSize: "16px", color: C.text3, marginTop: "2px" }}>퀀트 데이터 기반 실시간 분석</div>
          </div>

          {/* 메시지 영역 */}
          <div style={{ flex: 1, overflow: "auto", padding: "16px", display: "flex", flexDirection: "column", gap: "12px", minHeight: "200px" }}>
            {aiMessages.length === 0 && (
              <div style={{ textAlign: "center", padding: "16px 0", color: C.text3, fontSize: "18px" }}>
                <div style={{ fontSize: "28px", marginBottom: "8px" }}>👋</div>
                <div style={{ fontWeight: 600, color: C.text1, marginBottom: "4px" }}>무엇이든 물어보세요</div>
                <div style={{ fontSize: "16px", marginBottom: "14px" }}>종목 분석, 시장 현황, 리스크 점검까지</div>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  {[["시장 현황 요약", "📈"], ["추천 종목 TOP 5", "🎯"], ["리스크 점검", "🛡️"], ["관심종목 진단", "📌"], ["이상 탐지 현황", "⚡"]].map(([q, icon]) => (
                    <button key={q} onClick={() => handleAiChat(q)} style={{
                      padding: "8px 14px", borderRadius: "10px", fontSize: "16px", fontWeight: 600,
                      background: C.card2, color: C.text1, border: `1px solid ${C.border2}`, cursor: "pointer",
                      display: "flex", alignItems: "center", gap: "8px", textAlign: "left", transition: "all .15s",
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = C.blueBg; e.currentTarget.style.borderColor = C.blue + "40"; }}
                    onMouseLeave={e => { e.currentTarget.style.background = C.card2; e.currentTarget.style.borderColor = C.border2; }}>
                      <span>{icon}</span>
                      <span>{q}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {aiMessages.map((m, i) => (
              <div key={i} style={{
                alignSelf: m.role === "user" ? "flex-end" : "flex-start",
                maxWidth: "85%",
                padding: "10px 14px", borderRadius: m.role === "user" ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
                background: m.role === "user" ? C.blue : C.card2,
                color: m.role === "user" ? "#fff" : C.text1,
                fontSize: "18px", lineHeight: 1.6, whiteSpace: "pre-wrap",
              }}>
                {m.text}
              </div>
            ))}
            {aiLoading && (
              <div style={{ alignSelf: "flex-start", padding: "10px 14px", borderRadius: "12px 14px 14px 4px", background: C.card2 }}>
                <span style={{ animation: "pulse 1s infinite", fontSize: "18px", color: C.text3 }}>분석 중...</span>
              </div>
            )}
          </div>

          {/* 입력 */}
          <div style={{ padding: "12px 16px", borderTop: `1px solid ${C.border}20`, display: "flex", gap: "8px" }}>
            <input
              value={aiInput}
              onChange={e => setAiInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleAiChat(aiInput); } }}
              placeholder="종목명이나 질문을 입력하세요..."
              style={{
                flex: 1, padding: "10px 14px", borderRadius: "12px", fontSize: "18px",
                background: C.bg, border: `1px solid ${C.border2}`, color: C.text1,
                outline: "none", minHeight: "40px",
              }}
            />
            <button onClick={() => handleAiChat(aiInput)} disabled={aiLoading || !aiInput.trim()} style={{
              padding: "10px 18px", borderRadius: "12px", fontSize: "18px", fontWeight: 700,
              background: aiInput.trim() ? C.blue : C.card2,
              color: aiInput.trim() ? "#fff" : C.text3,
              border: "none", cursor: aiInput.trim() ? "pointer" : "default", whiteSpace: "nowrap",
              minHeight: "40px", display: "flex", alignItems: "center",
            }}>전송</button>
          </div>
        </div>
      )}

      </div>{/* di-app-body */}

      {/* ── 글로벌 검색 (/ 단축키) ── */}
      {globalSearchOpen && (() => {
        const popularStocks = [
          { symbol: "NVDA", name: "NVIDIA", market: "us", icon: "🟢" },
          { symbol: "AAPL", name: "Apple", market: "us", icon: "🍎" },
          { symbol: "TSLA", name: "Tesla", market: "us", icon: "⚡" },
          { symbol: "MSFT", name: "Microsoft", market: "us", icon: "🪟" },
          { symbol: "GOOG", name: "Alphabet", market: "us", icon: "🔍" },
          { symbol: "AMZN", name: "Amazon", market: "us", icon: "📦" },
        ];
        const cryptoQuick = [
          { symbol: "BTC-USD", name: "Bitcoin", market: "crypto", icon: "₿" },
          { symbol: "ETH-USD", name: "Ethereum", market: "crypto", icon: "Ξ" },
          { symbol: "SOL-USD", name: "Solana", market: "crypto", icon: "◎" },
        ];
        const categories = [
          { label: "AI/반도체", tab: "screener", icon: "🧠" },
          { label: "배당주", tab: "screener", icon: "💰" },
          { label: "성장주", tab: "screener", icon: "📈" },
          { label: "크립토", tab: "auto-trading", icon: "₿" },
        ];
        return (
          <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(6px)", display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: "12vh" }}
            onClick={(e) => { if (e.target === e.currentTarget) setGlobalSearchOpen(false); }}>
            <div style={{ width: "560px", maxWidth: "92vw", background: C.card, borderRadius: "20px", border: `1px solid ${C.border}`, boxShadow: "0 24px 80px rgba(0,0,0,0.5)", overflow: "hidden" }}>
              {/* 검색 헤더 */}
              <div style={{ padding: "16px 20px 12px" }}>
                <SearchBar onSelect={(asset) => { setSelectedAsset(asset); setGlobalSearchOpen(false); }} placeholder="종목명 또는 티커 입력 (예: NVDA, 삼성전자)" />
              </div>

              {/* 빠른 카테고리 */}
              <div style={{ padding: "0 20px 12px", display: "flex", gap: "8px" }}>
                {categories.map(cat => (
                  <button key={cat.label} onClick={() => { setTab(cat.tab); setGlobalSearchOpen(false); }} style={{
                    padding: "6px 14px", borderRadius: "20px", fontSize: "16px", fontWeight: 600,
                    background: C.card2, color: C.text2, border: `1px solid ${C.border}${C.isDark ? '30' : '50'}`, cursor: "pointer",
                    transition: "all 0.15s", display: "flex", alignItems: "center", gap: "4px",
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = C.blueBg; e.currentTarget.style.color = C.blue; }}
                  onMouseLeave={e => { e.currentTarget.style.background = C.card2; e.currentTarget.style.color = C.text2; }}
                  >
                    <span style={{ fontSize: "16px" }}>{cat.icon}</span>
                    {cat.label}
                  </button>
                ))}
                <span style={{ marginLeft: "auto", fontSize: "16px", color: C.text3, background: C.card2, padding: "6px 10px", borderRadius: "6px", alignSelf: "center" }}>ESC</span>
              </div>

              <div style={{ height: "1px", background: `${C.border}${C.isDark ? '30' : '50'}` }} />

              {/* 인기 종목 */}
              <div style={{ padding: "16px 20px 8px" }}>
                <div style={{ fontSize: "16px", fontWeight: 700, color: C.text3, marginBottom: "10px", letterSpacing: "0.5px", textTransform: "uppercase" }}>인기 종목</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" }}>
                  {popularStocks.map(s => {
                    const asset = ALL_ASSETS.find(a => a.symbol === s.symbol);
                    return (
                      <button key={s.symbol} onClick={() => { if (asset) { setSelectedAsset(asset); setGlobalSearchOpen(false); }}} style={{
                        display: "flex", alignItems: "center", gap: "10px", padding: "10px 12px",
                        borderRadius: "10px", background: "transparent", border: "none", cursor: "pointer",
                        transition: "all 0.12s", textAlign: "left", width: "100%",
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = C.card2}
                      onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                      >
                        <div style={{
                          width: "32px", height: "32px", borderRadius: "8px", flexShrink: 0,
                          background: "#1A2C4F", display: "flex", alignItems: "center", justifyContent: "center",
                          fontWeight: 800, fontSize: "14px", color: C.blue,
                        }}>{s.symbol.slice(0, 4)}</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: "18px", color: C.text1 }}>{s.name}</div>
                          <div style={{ fontSize: "16px", color: C.text3 }}>🇺🇸 {s.symbol}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 크립토 바로가기 */}
              <div style={{ padding: "8px 20px 16px" }}>
                <div style={{ fontSize: "16px", fontWeight: 700, color: C.text3, marginBottom: "10px", letterSpacing: "0.5px", textTransform: "uppercase" }}>크립토</div>
                <div style={{ display: "flex", gap: "8px" }}>
                  {cryptoQuick.map(c => {
                    const asset = ALL_ASSETS.find(a => a.symbol === c.symbol || a.symbol === c.symbol.replace("-USD", "/USD"));
                    return (
                      <button key={c.symbol} onClick={() => { if (asset) { setSelectedAsset(asset); setGlobalSearchOpen(false); } else { setTab("auto-trading"); setGlobalSearchOpen(false); }}} style={{
                        flex: 1, display: "flex", alignItems: "center", gap: "8px", padding: "10px 12px",
                        borderRadius: "10px", background: C.card2, border: `1px solid ${C.border}20`, cursor: "pointer",
                        transition: "all 0.12s",
                      }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = C.purple + "40"; e.currentTarget.style.background = `${C.purple}10`; }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = C.border + "20"; e.currentTarget.style.background = C.card2; }}
                      >
                        <span style={{ fontSize: "18px", fontWeight: 800, color: C.purple }}>{c.icon}</span>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: "16px", color: C.text1 }}>{c.name}</div>
                          <div style={{ fontSize: "15px", color: C.text3 }}>{c.symbol}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
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
            width: "100%", maxWidth: "440px", maxHeight: "90vh", overflowY: "auto",
            borderRadius: "20px", background: C.card,
            border: `1px solid ${C.border}`,
            boxShadow: C.isDark ? "0 20px 60px rgba(0,0,0,0.5)" : "0 20px 60px rgba(0,0,0,0.15)",
          }}>
            <div style={{ padding: "24px 24px 0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <img src="/zepta-icon-192.png" alt="Zepta" width="32" height="32" style={{ flexShrink: 0 }} />
                <div>
                  <h3 style={{ margin: 0, fontSize: "18px", fontWeight: 800, color: C.text1 }}>Zepta 로그인</h3>
                  <p style={{ margin: "2px 0 0", fontSize: "16px", color: C.text3 }}>투자 서비스를 이용하려면 로그인하세요</p>
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

      {/* ── CTA 광고 (쿠팡 인터스티셜) ── */}
      {showCoupangCTA && <CoupangInterstitial theme={themeMode} onClose={() => setShowCoupangCTA(false)} featureName="이 기능" />}

      {/* ── CTA 광고 (구글 애드센스 인터스티셜) ── */}
      {showGoogleCTA && <GoogleAdInterstitial onClose={() => setShowGoogleCTA(false)} />}

      {/* ── 토스트 알림 (향상된 시각) ── */}
      {toasts.length > 0 && (
        <div style={{ position: "fixed", top: "env(safe-area-inset-top, 16px)", left: "50%", transform: "translateX(-50%)",
          zIndex: 99999, display: "flex", flexDirection: "column", gap: "8px", pointerEvents: "none", padding: "16px" }}>
          {toasts.map(t => {
            const bgGradient = t.type === "error" ? `linear-gradient(135deg, #DC2626 0%, #991b1b 100%)` : t.type === "success" ? `linear-gradient(135deg, #16A34A 0%, #15803d 100%)` : `linear-gradient(135deg, #3B8BFF 0%, #1d4ed8 100%)`;
            const shadowColor = t.type === "error" ? "rgba(220, 38, 38, 0.4)" : t.type === "success" ? "rgba(22, 163, 74, 0.4)" : "rgba(59, 139, 255, 0.4)";
            const emoji = t.type === "error" ? "❌" : t.type === "success" ? "✅" : "ℹ️";
            return (
              <div key={t.id} style={{
                background: bgGradient,
                color: "#fff", padding: "14px 20px", borderRadius: "12px", fontSize: "15px", fontWeight: 600,
                boxShadow: `0 8px 28px ${shadowColor}`,
                pointerEvents: "auto", maxWidth: "min(360px, 90vw)",
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
