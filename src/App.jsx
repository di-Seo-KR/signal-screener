// DI금융 v6.6 — 투자 스크리너 + 퀀트 엔진 + 백테스트
// Features: 스크리닝, 캔들차트, 28개 전략, 백테스트, 포트폴리오, 뉴스, 텔레그램 알림
import { useState, useEffect, useCallback, useRef, useMemo, Component } from "react";

// ════════════════════════════════════════════════════════════════════
// ErrorBoundary — 런타임 에러 시 앱 전체 크래시 방지
// ════════════════════════════════════════════════════════════════════
class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { hasError: false, error: null }; }
  static getDerivedStateFromError(error) { return { hasError: true, error }; }
  componentDidCatch(error, info) { console.error("[DI금융 ErrorBoundary]", error, info.componentStack); }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center",
          justifyContent: "center", background: "#0A0E17", color: "#F7F8FA", padding: "24px", textAlign: "center",
        }}>
          <div style={{ fontSize: "48px", marginBottom: "16px" }}>⚠️</div>
          <h2 style={{ fontWeight: 800, fontSize: "20px", marginBottom: "8px" }}>앱 오류가 발생했습니다</h2>
          <p style={{ color: "#6B7D8E", fontSize: "14px", marginBottom: "20px", maxWidth: "360px" }}>
            일시적인 오류입니다. 새로고침하면 정상 작동합니다.
          </p>
          <button onClick={() => window.location.reload()} style={{
            padding: "12px 28px", borderRadius: "12px", fontSize: "14px", fontWeight: 700,
            background: "#3182F6", color: "#fff", border: "none", cursor: "pointer",
          }}>새로고침</button>
          <details style={{ marginTop: "16px", fontSize: "11px", color: "#6B7D8E", maxWidth: "360px" }}>
            <summary style={{ cursor: "pointer" }}>오류 상세</summary>
            <pre style={{ textAlign: "left", fontSize: "10px", whiteSpace: "pre-wrap", wordBreak: "break-all", marginTop: "8px" }}>
              {this.state.error?.message}
            </pre>
          </details>
        </div>
      );
    }
    return this.props.children;
  }
}
import ChartModal from "./ChartModal.jsx";
import StrategyPanel from "./StrategyPanel.jsx";
import BacktestPanel from "./BacktestPanel.jsx";

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
  { symbol: "ARKG", name: "ARK Genomic" }, { symbol: "GNOM", name: "게노믹스 ETF" },
  { symbol: "ITA", name: "방산 ETF" }, { symbol: "PPA", name: "항공방산 ETF" },
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
];

const CRYPTO_ASSETS = [
  // ── Top 10 ──
  { id: "bitcoin", symbol: "BTC", name: "Bitcoin" },
  { id: "ethereum", symbol: "ETH", name: "Ethereum" },
  { id: "binancecoin", symbol: "BNB", name: "BNB" },
  { id: "solana", symbol: "SOL", name: "Solana" },
  { id: "ripple", symbol: "XRP", name: "XRP" },
  { id: "cardano", symbol: "ADA", name: "Cardano" },
  { id: "dogecoin", symbol: "DOGE", name: "Dogecoin" },
  { id: "tron", symbol: "TRX", name: "TRON" },
  { id: "avalanche-2", symbol: "AVAX", name: "Avalanche" },
  { id: "polkadot", symbol: "DOT", name: "Polkadot" },
  // ── DeFi ──
  { id: "chainlink", symbol: "LINK", name: "Chainlink" },
  { id: "uniswap", symbol: "UNI", name: "Uniswap" },
  { id: "aave", symbol: "AAVE", name: "Aave" },
  { id: "maker", symbol: "MKR", name: "Maker" },
  { id: "lido-dao", symbol: "LDO", name: "Lido" },
  { id: "the-graph", symbol: "GRT", name: "The Graph" },
  { id: "compound-governance-token", symbol: "COMP", name: "Compound" },
  { id: "1inch", symbol: "1INCH", name: "1inch" },
  { id: "curve-dao-token", symbol: "CRV", name: "Curve" },
  { id: "pendle", symbol: "PENDLE", name: "Pendle" },
  { id: "jupiter-exchange-solana", symbol: "JUP", name: "Jupiter" },
  // ── L1/L2 ──
  { id: "near", symbol: "NEAR", name: "NEAR" },
  { id: "sui", symbol: "SUI", name: "Sui" },
  { id: "aptos", symbol: "APT", name: "Aptos" },
  { id: "cosmos", symbol: "ATOM", name: "Cosmos" },
  { id: "internet-computer", symbol: "ICP", name: "Internet Computer" },
  { id: "filecoin", symbol: "FIL", name: "Filecoin" },
  { id: "arbitrum", symbol: "ARB", name: "Arbitrum" },
  { id: "optimism", symbol: "OP", name: "Optimism" },
  { id: "polygon-ecosystem-token", symbol: "POL", name: "Polygon" },
  { id: "starknet", symbol: "STRK", name: "Starknet" },
  { id: "mantle", symbol: "MNT", name: "Mantle" },
  { id: "sei-network", symbol: "SEI", name: "Sei" },
  { id: "celestia", symbol: "TIA", name: "Celestia" },
  // ── AI & Data ──
  { id: "render-token", symbol: "RNDR", name: "Render" },
  { id: "fetch-ai", symbol: "FET", name: "Fetch.ai" },
  { id: "injective-protocol", symbol: "INJ", name: "Injective" },
  { id: "akash-network", symbol: "AKT", name: "Akash" },
  { id: "artificial-superintelligence-alliance", symbol: "ASI", name: "ASI Alliance" },
  { id: "bittensor", symbol: "TAO", name: "Bittensor" },
  // ── Meme ──
  { id: "pepe", symbol: "PEPE", name: "Pepe" },
  { id: "shiba-inu", symbol: "SHIB", name: "Shiba Inu" },
  { id: "floki", symbol: "FLOKI", name: "Floki" },
  { id: "bonk", symbol: "BONK", name: "Bonk" },
  { id: "dogwifcoin", symbol: "WIF", name: "dogwifhat" },
  // ── Stablecoins & Misc ──
  { id: "wrapped-bitcoin", symbol: "WBTC", name: "Wrapped BTC" },
  { id: "litecoin", symbol: "LTC", name: "Litecoin" },
  { id: "bitcoin-cash", symbol: "BCH", name: "Bitcoin Cash" },
  { id: "stellar", symbol: "XLM", name: "Stellar" },
  { id: "hedera-hashgraph", symbol: "HBAR", name: "Hedera" },
  { id: "algorand", symbol: "ALGO", name: "Algorand" },
  { id: "eos", symbol: "EOS", name: "EOS" },
  { id: "the-sandbox", symbol: "SAND", name: "The Sandbox" },
  { id: "decentraland", symbol: "MANA", name: "Decentraland" },
  { id: "axie-infinity", symbol: "AXS", name: "Axie Infinity" },
  { id: "gala", symbol: "GALA", name: "Gala" },
  { id: "ondo-finance", symbol: "ONDO", name: "Ondo Finance" },
  // ── RWA & Infrastructure ──
  { id: "worldcoin-wld", symbol: "WLD", name: "Worldcoin" },
  { id: "pyth-network", symbol: "PYTH", name: "Pyth Network" },
  { id: "jito-governance-token", symbol: "JTO", name: "Jito" },
  { id: "ethena", symbol: "ENA", name: "Ethena" },
  { id: "dymension", symbol: "DYM", name: "Dymension" },
  { id: "wormhole", symbol: "W", name: "Wormhole" },
  { id: "stacks", symbol: "STX", name: "Stacks" },
  { id: "thorchain", symbol: "RUNE", name: "THORChain" },
  { id: "kaspa", symbol: "KAS", name: "Kaspa" },
  { id: "beam-2", symbol: "BEAM", name: "Beam" },
  { id: "immutable-x", symbol: "IMX", name: "Immutable" },
  { id: "ronin", symbol: "RON", name: "Ronin" },
  { id: "toncoin", symbol: "TON", name: "Toncoin" },
  { id: "monero", symbol: "XMR", name: "Monero" },
  // ── Gaming & Social ──
  { id: "stepn", symbol: "GMT", name: "STEPN" },
  { id: "apecoin", symbol: "APE", name: "ApeCoin" },
  { id: "blur", symbol: "BLUR", name: "Blur" },
  { id: "magic", symbol: "MAGIC", name: "MAGIC" },
  { id: "illuvium", symbol: "ILV", name: "Illuvium" },
];

// 전체 자산 통합 (검색용)
const ALL_ASSETS = [
  ...US_ASSETS.map(a => ({ ...a, market: "us", symbolRaw: a.symbol, searchKey: `${a.symbol} ${a.name}`.toLowerCase() })),
  ...KR_ASSETS.map(a => ({ ...a, market: "kr", symbolRaw: a.symbol, symbol: a.symbol.replace(".KS", ""), searchKey: `${a.symbol.replace(".KS","")} ${a.name}`.toLowerCase() })),
  ...CRYPTO_ASSETS.map(a => ({ ...a, market: "crypto", symbolRaw: a.id, searchKey: `${a.symbol} ${a.name} ${a.id}`.toLowerCase() })),
];

// ════════════════════════════════════════════════════════════════════
// 기술 지표 계산
// ════════════════════════════════════════════════════════════════════
function calcRSI(closes, period = 14) {
  if (closes.length < period + 1) return null;
  let ag = 0, al = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) ag += d; else al -= d;
  }
  ag /= period; al /= period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    ag = (ag * (period - 1) + Math.max(d, 0)) / period;
    al = (al * (period - 1) + Math.max(-d, 0)) / period;
  }
  return al === 0 ? 100 : 100 - 100 / (1 + ag / al);
}

function calcSMA(data, period) {
  if (data.length < period) return null;
  return data.slice(-period).reduce((a, b) => a + b, 0) / period;
}

function calcBB(closes, period = 20, mult = 2) {
  if (closes.length < period) return null;
  const s = closes.slice(-period);
  const mean = s.reduce((a, b) => a + b, 0) / period;
  const std = Math.sqrt(s.reduce((a, b) => a + (b - mean) ** 2, 0) / period);
  return { upper: mean + mult * std, middle: mean, lower: mean - mult * std };
}

function calcMACD(closes) {
  if (closes.length < 35) return { goldenCross: false };
  const k12 = 2 / 13, k26 = 2 / 27, k9 = 2 / 10;
  let e12 = closes.slice(0, 12).reduce((a, b) => a + b, 0) / 12;
  let e26 = closes.slice(0, 26).reduce((a, b) => a + b, 0) / 26;
  const macdArr = [];
  for (let i = 0; i < closes.length; i++) {
    if (i >= 12) e12 = closes[i] * k12 + e12 * (1 - k12);
    if (i >= 26) { e26 = closes[i] * k26 + e26 * (1 - k26); macdArr.push(e12 - e26); }
  }
  if (macdArr.length < 9) return { goldenCross: false };
  let sig = macdArr.slice(0, 9).reduce((a, b) => a + b, 0) / 9;
  let prevSig = sig;
  for (let i = 9; i < macdArr.length - 1; i++) prevSig = macdArr[i] * k9 + prevSig * (1 - k9);
  for (let i = 9; i < macdArr.length; i++) sig = macdArr[i] * k9 + sig * (1 - k9);
  const cur = macdArr[macdArr.length - 1], prev = macdArr[macdArr.length - 2];
  return { goldenCross: prev <= prevSig && cur > sig, macdLine: cur, signalLine: sig };
}

function calcStochastic(highs, lows, closes, kPeriod = 14, dPeriod = 3) {
  if (closes.length < kPeriod) return null;
  const kArr = [];
  for (let i = kPeriod - 1; i < closes.length; i++) {
    const hh = Math.max(...highs.slice(i - kPeriod + 1, i + 1));
    const ll = Math.min(...lows.slice(i - kPeriod + 1, i + 1));
    kArr.push(hh === ll ? 50 : ((closes[i] - ll) / (hh - ll)) * 100);
  }
  if (kArr.length < dPeriod) return null;
  const kLast = kArr[kArr.length - 1];
  const dLast = kArr.slice(-dPeriod).reduce((a, b) => a + b, 0) / dPeriod;
  return { k: kLast, d: dLast };
}

function calcWilliamsR(highs, lows, closes, period = 14) {
  if (closes.length < period) return null;
  const hh = Math.max(...highs.slice(-period));
  const ll = Math.min(...lows.slice(-period));
  if (hh === ll) return -50;
  return ((hh - closes[closes.length - 1]) / (hh - ll)) * -100;
}

function calcATR(highs, lows, closes, period = 14) {
  if (closes.length < period + 1) return null;
  const trs = [];
  for (let i = 1; i < closes.length; i++) {
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i-1]),
      Math.abs(lows[i] - closes[i-1])
    );
    trs.push(tr);
  }
  if (trs.length < period) return null;
  let atr = trs.slice(0, period).reduce((a,b) => a+b, 0) / period;
  for (let i = period; i < trs.length; i++) {
    atr = (atr * (period - 1) + trs[i]) / period;
  }
  return atr;
}

function calcSimpleADX(highs, lows, closes, period = 14) {
  if (closes.length < period + 2) return null;
  let plusDM = 0, minusDM = 0, tr = 0;
  for (let i = 1; i <= period; i++) {
    const upMove = highs[i] - highs[i-1];
    const downMove = lows[i-1] - lows[i];
    plusDM += (upMove > downMove && upMove > 0) ? upMove : 0;
    minusDM += (downMove > upMove && downMove > 0) ? downMove : 0;
    tr += Math.max(highs[i]-lows[i], Math.abs(highs[i]-closes[i-1]), Math.abs(lows[i]-closes[i-1]));
  }
  for (let i = period + 1; i < closes.length; i++) {
    const upMove = highs[i] - highs[i-1];
    const downMove = lows[i-1] - lows[i];
    plusDM = plusDM - plusDM/period + ((upMove > downMove && upMove > 0) ? upMove : 0);
    minusDM = minusDM - minusDM/period + ((downMove > upMove && downMove > 0) ? downMove : 0);
    tr = tr - tr/period + Math.max(highs[i]-lows[i], Math.abs(highs[i]-closes[i-1]), Math.abs(lows[i]-closes[i-1]));
  }
  const plusDI = tr > 0 ? (plusDM / tr) * 100 : 0;
  const minusDI = tr > 0 ? (minusDM / tr) * 100 : 0;
  const dx = (plusDI + minusDI) > 0 ? Math.abs(plusDI - minusDI) / (plusDI + minusDI) * 100 : 0;
  return { adx: dx, plusDI, minusDI };
}

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

  // BB 스퀴즈
  let bbSqueeze = false;
  if (weeklyCloses.length >= 20) {
    const bwArr = [];
    for (let i = 19; i < weeklyCloses.length; i++) {
      const sl = weeklyCloses.slice(i - 19, i + 1);
      const m  = sl.reduce((a, b) => a + b, 0) / 20;
      const sd = Math.sqrt(sl.reduce((a, b) => a + (b - m) ** 2, 0) / 20);
      bwArr.push(m > 0 ? (sd * 4) / m : 0);
    }
    const curBW = bwArr[bwArr.length - 1];
    const minBW = Math.min(...bwArr.slice(-52));
    bbSqueeze = bwArr.length >= 4 && curBW <= minBW * 1.05;
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

  // 갭 신호 (주간 변화 ±3% 이상)
  const gapSignal = Math.abs(weekChange) >= 3;

  // 거래량 극증
  const volumeClimax = volRatio >= 3;

  // 거래량 고갈
  const volumeDry = volRatio <= 0.3;

  // OBV 다이버전스 - 최근 4주 가격 추세 vs OBV 추세
  let obvDivergence = false;
  if (obvArr.length >= 4) {
    const priceTrend = weeklyCloses[weeklyCloses.length - 1] > weeklyCloses[weeklyCloses.length - 4] ? 1 : -1;
    const obvTrend = obvArr[obvArr.length - 1] > obvArr[obvArr.length - 4] ? 1 : -1;
    obvDivergence = priceTrend !== obvTrend;
  }

  // 평균회귀 (200일선 대비 ±15% 이상)
  const meanReversion = ma200Dist && Math.abs(ma200Dist) >= 15;

  // MACD 다이버전스 - 간단한 구현: 지난 2주 가격 방향 vs MACD 방향
  let macdDivergence = false;
  if (weeklyCloses.length >= 2) {
    const priceTrend = weeklyCloses[weeklyCloses.length - 1] > weeklyCloses[weeklyCloses.length - 2] ? 1 : -1;
    const macdVal = macd.macdLine || 0;
    const prevMacdVal = macd.signalLine || 0;
    const macdTrend = macdVal > prevMacdVal ? 1 : -1;
    macdDivergence = priceTrend !== macdTrend;
  }

  // MA 리본 (정배열/역배열)
  let maRibbon = false;
  if (ma20daily && ma50daily && ma200daily) {
    const bullish = ma20daily > ma50daily && ma50daily > ma200daily;
    const bearish = ma20daily < ma50daily && ma50daily < ma200daily;
    maRibbon = bullish || bearish;
  }

  // ADX 강한 추세
  const adxTrend = adxResult && adxResult.adx >= 25;

  // 골든크로스
  const goldenCross = ma50daily && ma200daily && ma50daily > ma200daily;

  // 데스크로스
  const deathCross = ma50daily && ma200daily && ma50daily < ma200daily;

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

  return {
    triggers, price: +price.toFixed(6),
    rsi: rsi != null ? +rsi.toFixed(1) : null,
    weekChange: +weekChange.toFixed(2),
    ma200Dist: ma200Dist != null ? +ma200Dist.toFixed(2) : null,
    volRatio: +volRatio.toFixed(1),
    ma50: ma50daily, ma200: ma200daily,
    stoch, wr: wr != null ? +wr.toFixed(1) : null,
    low52w, high52w,
  };
}

// ════════════════════════════════════════════════════════════════════
// 조건 메타데이터
// ════════════════════════════════════════════════════════════════════
const CONDITION_META = {
  // 모멘텀 & 추세
  rsi_extreme:     { label: "RSI 극단값",        icon: "⚡", desc: "RSI ≤ 25 또는 ≥ 75 — 극단적 과매수/과매도" },
  macd_divergence: { label: "MACD 다이버전스",    icon: "🔀", desc: "가격과 MACD 방향 불일치 — 추세 반전 선행지표" },
  ma_ribbon:       { label: "이평선 정배열/역배열", icon: "📐", desc: "MA20>MA50>MA200 정배열 또는 역배열 — 추세 강도 확인" },
  adx_trend:       { label: "ADX 강한 추세",      icon: "💪", desc: "ADX ≥ 25 + DI 방향 — 추세 존재 및 방향 확인" },
  // 변동성 & 가격 구조
  bb_squeeze:      { label: "볼린저 스퀴즈",      icon: "🔥", desc: "밴드폭 52주 최저 — 대규모 변동 임박 신호" },
  atr_breakout:    { label: "ATR 돌파",           icon: "🚀", desc: "당일 변동폭이 ATR(14) 2배 초과 — 폭발적 움직임" },
  price_channel:   { label: "채널 돌파",          icon: "📊", desc: "52주 고가/저가 채널 돌파 — 신고가 또는 지지선 이탈" },
  gap_signal:      { label: "갭 시그널",          icon: "⬆️", desc: "전주 대비 ±3% 이상 갭 — 수급 불균형" },
  // 수급 & 거래량
  volume_climax:   { label: "거래량 클라이맥스",   icon: "🌊", desc: "거래량 20주 평균 3배 이상 — 세력 매집/투매 신호" },
  obv_divergence:  { label: "OBV 다이버전스",     icon: "📈", desc: "OBV와 가격 방향 불일치 — 스마트머니 움직임 포착" },
  volume_dry:      { label: "거래량 고갈",         icon: "🏜️", desc: "거래량 20주 평균 30% 이하 — 바닥 형성 가능" },
  // 밸류에이션 & 상대강도
  near_52w_low:    { label: "52주 신저가 근접",    icon: "🔔", desc: "52주 최저가 대비 5% 이내" },
  near_52w_high:   { label: "52주 신고가 근접",    icon: "🏆", desc: "52주 최고가 대비 2% 이내 — 모멘텀 브레이크아웃" },
  death_cross:     { label: "데스크로스",          icon: "💀", desc: "50일선이 200일선 하향돌파 — 장기 하락전환 경고" },
  golden_cross:    { label: "골든크로스",          icon: "✨", desc: "50일선이 200일선 상향돌파 — 장기 상승전환" },
  mean_reversion:  { label: "평균회귀 신호",       icon: "🎯", desc: "200일선 대비 ±15% 이상 이탈 — 평균회귀 구간" },
};

// ════════════════════════════════════════════════════════════════════
// 감정 분석 헬퍼
// ════════════════════════════════════════════════════════════════════
function analyzeSentiment(title) {
  if (!title) return "neutral";
  const t = ` ${title.toLowerCase()} `;

  // ── 강한 긍정 (가중치 2) ──
  const strongPos = ["surge","soar","record high","all-time high","skyrocket","boom","breakout",
    "급등","폭등","신고가","사상최고","돌파","대박","호실적","깜짝실적","어닝서프라이즈"];
  // ── 긍정 (가중치 1) ──
  const pos = ["rally","gain","jump","rise","bull","growth","profit","beat","outperform",
    "upgrade","buy","strong","positive","recover","rebound","advance","climb","up ",
    "상승","호재","성장","흑자","매수","상향","강세","반등","회복","호조","개선",
    "수혜","낙관","기대","확대","증가","호황","상승세","매출증가","이익증가"];
  // ── 강한 부정 (가중치 2) ──
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

  // "low risk" → 중립 보정, "high risk" → 부정 보정
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
  let msg = `🚨 *DI금융 알림*\n\n`;
  msg += `📅 ${new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}\n`;
  msg += `📊 시그널 감지: *${assets.length}개* 자산\n\n`;
  assets.slice(0, 15).forEach(a => {
    const flag = a.market === "us" ? "🇺🇸" : a.market === "kr" ? "🇰🇷" : "₿";
    const price = a.market === "kr"
      ? `₩${Math.round(a.price).toLocaleString()}`
      : `$${a.price?.toLocaleString(undefined, { maximumFractionDigits: a.price < 1 ? 6 : 2 })}`;
    const chg = a.weekChange >= 0 ? `+${a.weekChange}%` : `${a.weekChange}%`;
    msg += `${flag} *${a.name}* \`${a.symbol}\`\n`;
    msg += `   ${price} | ${chg} | RSI ${a.rsi ?? "—"}\n`;
    msg += `   ${a.triggers.map(t => labels[t] || t).join(" · ")}\n\n`;
  });
  if (assets.length > 15) msg += `_...외 ${assets.length - 15}개_\n\n`;
  msg += `_⚠️ 기술적 지표 기반 — 투자 추천 아님_`;
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
const DARK = {
  bg: "#0A0E17", card: "#111927", card2: "#1A2332",
  border: "#1E2D3D", border2: "#283B50",
  blue: "#3182F6", blueL: "#5AA3FF", blueBg: "#1A2C4F",
  red: "#F04452", redBg: "#2A1520",
  green: "#05C072", greenBg: "#0A2A1A",
  yellow: "#FFB400", yellowBg: "#2A2000",
  purple: "#8B5CF6", purpleBg: "#1E1535",
  text1: "#F7F8FA", text2: "#B0BEC5", text3: "#6B7D8E",
  isDark: true,
};
const LIGHT = {
  bg: "#F5F6F8", card: "#FFFFFF", card2: "#F0F2F5",
  border: "#E0E3E8", border2: "#D0D4DB",
  blue: "#2563EB", blueL: "#3B82F6", blueBg: "#DBEAFE",
  red: "#DC2626", redBg: "#FEE2E2",
  green: "#16A34A", greenBg: "#DCFCE7",
  yellow: "#D97706", yellowBg: "#FEF3C7",
  purple: "#7C3AED", purpleBg: "#EDE9FE",
  text1: "#111827", text2: "#4B5563", text3: "#9CA3AF",
  isDark: false,
};
function loadTheme() { try { return localStorage.getItem(THEME_KEY) || "dark"; } catch { return "dark"; } }
// C will be set dynamically in App component and passed through context
let C = DARK;

// ════════════════════════════════════════════════════════════════════
// 서브 컴포넌트: PullToRefresh (모바일 아래로 당겨서 새로고침)
// ════════════════════════════════════════════════════════════════════
function PullToRefresh({ onRefresh, children }) {
  const containerRef = useRef(null);
  const [pulling, setPulling] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef(0);
  const THRESHOLD = 80;

  const handleTouchStart = useCallback((e) => {
    if (window.scrollY === 0) {
      startY.current = e.touches[0].clientY;
      setPulling(true);
    }
  }, []);

  const handleTouchMove = useCallback((e) => {
    if (!pulling) return;
    const diff = e.touches[0].clientY - startY.current;
    if (diff > 0 && window.scrollY === 0) {
      setPullDistance(Math.min(diff * 0.5, 120));
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
          <span style={{ marginLeft: "8px", fontSize: "13px", color: C.text3, fontWeight: 600 }}>
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
};

function SignalTag({ triggerKey }) {
  const meta = CONDITION_META[triggerKey];
  const color = TAG_COLORS[triggerKey] || C.blue;
  if (!meta) return null;
  return (
    <span style={{
      padding: "2px 7px", borderRadius: "6px", fontSize: "10px", fontWeight: 700,
      background: `${color}22`, color, border: `1px solid ${color}44`, whiteSpace: "nowrap",
    }}>{meta.icon} {meta.label}</span>
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
        {!compact && <span style={{ position: "absolute", left: "14px", top: "50%", transform: "translateY(-50%)", fontSize: "16px", color: C.text3, pointerEvents: "none" }}>🔍</span>}
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
            fontSize: compact ? "11px" : "14px",
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
            background: "none", border: "none", color: C.text3, fontSize: "16px", cursor: "pointer", padding: "4px",
          }}>✕</button>
        )}
      </div>
      {showDrop && (
        <div ref={dropRef} style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 200,
          background: C.card, border: `1px solid ${C.border}`, borderRadius: "14px",
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
                  padding: "12px 16px", cursor: "pointer",
                  background: isActive ? C.blueBg : "transparent",
                  borderBottom: i < suggestions.length - 1 ? `1px solid ${C.border}` : "none",
                  transition: "background .15s",
                }}>
                <div style={{
                  width: "36px", height: "36px", borderRadius: "10px", flexShrink: 0,
                  background: asset.market === "us" ? "#1A2C4F" : asset.market === "kr" ? "#1A2A1E" : "#1E1A2A",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontWeight: 800, fontSize: "9px",
                  color: asset.market === "us" ? C.blue : asset.market === "kr" ? C.green : C.purple,
                }}>
                  {asset.symbol.length <= 5 ? asset.symbol : asset.symbol.slice(0, 5)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: "14px", color: C.text1 }}>{asset.name}</div>
                  <div style={{ fontSize: "12px", color: C.text3 }}>{flag} {asset.symbol}{asset.market === "kr" ? ".KS" : ""}</div>
                </div>
                <div style={{
                  padding: "3px 8px", borderRadius: "6px", fontSize: "10px", fontWeight: 600,
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
// ── 퀵 투자진단 v2 (카드용 — API 호출 없이 기존 데이터로 즉시 계산, 정밀 산출) ──
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
    else if (asset.ma200Dist > -15) { trendScore -= 10; signals.push({ type: "bearish", name: `200일선 아래 ${asset.ma200Dist.toFixed(0)}%` }); }
    else { trendScore -= 15; signals.push({ type: "bearish", name: `200일선 크게 하회 (${asset.ma200Dist.toFixed(0)}%)` }); }
  }
  // MA 배열 상태
  const ma50 = asset.fiftyDayAvg || asset.ma50;
  const ma200 = asset.twoHundredDayAvg || asset.ma200;
  if (ma50 && ma200) {
    if (ma50 > ma200 && asset.price > ma50) { trendScore += 10; signals.push({ type: "bullish", name: "정배열 + 가격 위" }); }
    else if (ma50 > ma200) { trendScore += 5; signals.push({ type: "bullish", name: "골든크로스 구간" }); }
    else if (ma50 < ma200 && asset.price < ma50) { trendScore -= 8; signals.push({ type: "bearish", name: "역배열 + 가격 아래" }); }
    else if (ma50 < ma200) { trendScore -= 4; signals.push({ type: "bearish", name: "데드크로스 구간" }); }
  }
  // 단기 추세
  if (asset.weekChange > 8) trendScore += 6;
  else if (asset.weekChange > 3) trendScore += 3;
  else if (asset.weekChange < -8) trendScore -= 6;
  else if (asset.weekChange < -3) trendScore -= 3;
  trendScore = Math.max(0, Math.min(100, trendScore));

  // ── 모멘텀: RSI 세분화 + 스토캐스틱 + W%R ──
  if (asset.rsi != null) {
    if (asset.rsi >= 80) { momScore -= 18; signals.push({ type: "bearish", name: `RSI 극단 과매수 (${asset.rsi})` }); }
    else if (asset.rsi >= 70) { momScore -= 10; signals.push({ type: "bearish", name: `RSI 과매수 (${asset.rsi})` }); }
    else if (asset.rsi >= 55) momScore += 6;
    else if (asset.rsi >= 45) momScore += 0;
    else if (asset.rsi >= 30) momScore -= 4;
    else if (asset.rsi >= 20) { momScore += 12; signals.push({ type: "bullish", name: `RSI 과매도 (${asset.rsi})` }); }
    else { momScore += 16; signals.push({ type: "bullish", name: `RSI 극단 과매도 (${asset.rsi})` }); }
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
  momScore = Math.max(0, Math.min(100, momScore));

  // ── 수급: 거래량 + 가격-거래량 상관 ──
  if (asset.volRatio >= 3) { supScore += 18; signals.push({ type: "bullish", name: `거래량 폭증 (${asset.volRatio.toFixed(1)}x)` }); }
  else if (asset.volRatio >= 2) { supScore += 14; signals.push({ type: "bullish", name: `거래량 급증 (${asset.volRatio.toFixed(1)}x)` }); }
  else if (asset.volRatio >= 1.5) supScore += 8;
  else if (asset.volRatio >= 1.0) supScore += 2;
  else if (asset.volRatio <= 0.3) { supScore -= 12; signals.push({ type: "neutral", name: "거래량 극감" }); }
  else if (asset.volRatio <= 0.5) supScore -= 6;
  // 가격-거래량 상관
  if (asset.weekChange > 0 && asset.volRatio > 1.3) { supScore += 8; signals.push({ type: "bullish", name: "가격↑ + 거래량↑" }); }
  if (asset.weekChange < 0 && asset.volRatio > 1.5) { supScore -= 10; signals.push({ type: "bearish", name: "가격↓ + 거래량↑ (투매)" }); }
  if (asset.weekChange > 0 && asset.volRatio < 0.7) supScore -= 4; // 미확인 상승
  supScore = Math.max(0, Math.min(100, supScore));

  // ── 가격위치: 52주 세분화 ──
  if (asset.low52w && asset.high52w) {
    const range = asset.high52w - asset.low52w;
    const pos52 = range > 0 ? ((asset.price - asset.low52w) / range) * 100 : 50;
    if (pos52 <= 10) { posScore += 18; signals.push({ type: "bullish", name: `52주 최저점 (${pos52.toFixed(0)}%)` }); }
    else if (pos52 <= 20) { posScore += 12; signals.push({ type: "bullish", name: `52주 저점대 (${pos52.toFixed(0)}%)` }); }
    else if (pos52 <= 40) posScore += 5;
    else if (pos52 >= 95) { posScore -= 5; signals.push({ type: "neutral", name: `52주 최고점 (${pos52.toFixed(0)}%)` }); }
    else if (pos52 >= 85) posScore -= 2;
    const fromHigh = ((asset.price - asset.high52w) / asset.high52w) * 100;
    if (fromHigh < -40) { posScore += 12; signals.push({ type: "bullish", name: `고점 대비 ${fromHigh.toFixed(0)}%` }); }
    else if (fromHigh < -25) posScore += 6;
    // 신고가
    if (pos52 >= 98 && asset.weekChange > 0) { posScore += 8; signals.push({ type: "bullish", name: "52주 신고가 돌파" }); }
  }
  posScore = Math.max(0, Math.min(100, posScore));

  // ── 종합 점수 (가중 평균) ──
  const totalScore = Math.round(trendScore * 0.30 + momScore * 0.30 + supScore * 0.20 + posScore * 0.20);
  let verdict;
  if (totalScore >= 80) verdict = "적극 매수";
  else if (totalScore >= 68) verdict = "매수";
  else if (totalScore >= 58) verdict = "매수 우위";
  else if (totalScore >= 42) verdict = "중립";
  else if (totalScore >= 32) verdict = "매도 우위";
  else if (totalScore >= 20) verdict = "매도";
  else verdict = "적극 매도";

  // ── 매수/매도/중립 투자 의견 ──
  let opinion, opinionColor, rationale;
  if (totalScore >= 68) {
    opinion = "매수";
    opinionColor = "green";
    rationale = signals.filter(s => s.type === "bullish").slice(0, 2).map(s => s.name).join(", ") || "기술적 상승 신호 우세";
  } else if (totalScore >= 58) {
    opinion = "매수 관망";
    opinionColor = "green";
    rationale = "상승 신호 있으나 확인 필요";
  } else if (totalScore >= 42) {
    opinion = "중립";
    opinionColor = "yellow";
    rationale = "방향성 불분명 — 추가 데이터 대기";
  } else if (totalScore >= 32) {
    opinion = "매도 관망";
    opinionColor = "red";
    rationale = "하락 신호 있으나 확인 필요";
  } else {
    opinion = "매도";
    opinionColor = "red";
    rationale = signals.filter(s => s.type === "bearish").slice(0, 2).map(s => s.name).join(", ") || "기술적 하락 신호 우세";
  }

  return { score: totalScore, verdict, opinion, opinionColor, rationale, signals, categories: [
    { name: "추세", score: trendScore },
    { name: "모멘텀", score: momScore },
    { name: "수급", score: supScore },
    { name: "위치", score: posScore },
  ]};
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
function AssetCard({ asset, onChart }) {
  const [expanded, setExpanded] = useState(false);
  const isPos = asset.weekChange >= 0;
  const mcBg = asset.market === "us" ? "#1A2C4F" : asset.market === "kr" ? "#1A2A1E" : "#1E1A2A";
  const mcColor = asset.market === "us" ? C.blue : asset.market === "kr" ? C.green : C.purple;

  // 퀵 진단 (카드 펼칠 때 계산)
  const diag = useMemo(() => expanded ? quickDiagnosis(asset) : null, [expanded, asset]);

  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "14px", overflow: "hidden" }}>
      <div onClick={() => setExpanded(!expanded)}
        style={{ display: "flex", alignItems: "center", padding: "14px 18px", cursor: "pointer", gap: "12px" }}>
        <div style={{
          width: "42px", height: "42px", borderRadius: "12px", background: mcBg, flexShrink: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontWeight: 800, fontSize: "10px", color: mcColor, letterSpacing: "-0.5px",
        }}>
          {asset.symbol.length <= 4 ? asset.symbol : asset.symbol.slice(0, 4)}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
            <span style={{ fontWeight: 700, fontSize: "15px", color: C.text1 }}>{asset.name}</span>
            <span style={{ fontSize: "12px", color: C.text3 }}>{asset.symbol}</span>
          </div>
          <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
            {asset.triggers.map(t => <SignalTag key={t} triggerKey={t} />)}
          </div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontWeight: 700, fontSize: "16px", color: C.text1 }}>{fmtPrice(asset.price, asset.market)}</div>
          <div style={{ fontSize: "13px", fontWeight: 600, color: isPos ? C.green : C.red }}>
            {isPos ? "▲" : "▼"} {Math.abs(asset.weekChange)}%
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
                    <span style={{ fontSize: "11px", fontWeight: 700, color: C.text3 }}>🩺 투자진단</span>
                    <span style={{
                      fontSize: "12px", fontWeight: 700,
                      color: diag.score >= 70 ? C.green : diag.score >= 40 ? C.yellow : C.red,
                    }}>{diag.verdict}</span>
                    <span style={{
                      fontSize: "10px", fontWeight: 700, padding: "2px 8px", borderRadius: "4px",
                      background: diag.opinionColor === "green" ? `${C.green}18` : diag.opinionColor === "red" ? `${C.red}18` : `${C.yellow}18`,
                      color: diag.opinionColor === "green" ? C.green : diag.opinionColor === "red" ? C.red : C.yellow,
                    }}>{diag.opinion}</span>
                  </div>
                  {/* 카테고리 미니 바 */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px" }}>
                    {diag.categories.map(cat => (
                      <div key={cat.name} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <span style={{ fontSize: "9px", color: C.text3, width: "28px" }}>{cat.name}</span>
                        <div style={{ flex: 1, height: "4px", background: C.border, borderRadius: "2px", overflow: "hidden" }}>
                          <div style={{
                            height: "100%", borderRadius: "2px",
                            width: `${cat.score}%`,
                            background: cat.score >= 70 ? C.green : cat.score >= 40 ? C.yellow : C.red,
                            transition: "width 0.4s ease",
                          }} />
                        </div>
                        <span style={{ fontSize: "9px", fontWeight: 700, color: C.text3, width: "18px", textAlign: "right" }}>{cat.score}</span>
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
                      fontSize: "9px", fontWeight: 600, padding: "3px 7px", borderRadius: "5px",
                      background: sig.type === "bullish" ? `${C.green}18` : sig.type === "bearish" ? `${C.red}18` : `${C.yellow}18`,
                      color: sig.type === "bullish" ? C.green : sig.type === "bearish" ? C.red : C.yellow,
                    }}>{sig.type === "bullish" ? "▲" : sig.type === "bearish" ? "▼" : "●"} {sig.name}</span>
                  ))}
                </div>
              )}
            </div>
          )}
          {/* ── 지표 상세 ── */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gap: "8px", marginBottom: "12px" }}>
            {[
              { label: "RSI(14)",    value: asset.rsi ?? "—",   color: asset.rsi != null && asset.rsi <= 30 ? C.purple : C.text2 },
              { label: "200일선 대비", value: asset.ma200Dist != null ? `${asset.ma200Dist > 0 ? "+" : ""}${asset.ma200Dist}%` : "—" },
              { label: "거래량 비율", value: `${asset.volRatio}x`, color: asset.volRatio >= 2 ? C.red : C.text2 },
              { label: "스토캐스틱%K", value: asset.stoch ? `${asset.stoch.k.toFixed(1)}` : "—", color: asset.stoch?.k < 20 ? C.purple : C.text2 },
              { label: "Williams %R", value: asset.wr != null ? `${asset.wr}` : "—", color: asset.wr != null && asset.wr < -80 ? C.purple : C.text2 },
              { label: "52주 저가 대비", value: asset.low52w ? `+${(((asset.price - asset.low52w) / asset.low52w) * 100).toFixed(1)}%` : "—" },
            ].map(({ label, value, color }) => (
              <div key={label} style={{ background: C.bg, borderRadius: "10px", padding: "10px 12px" }}>
                <div style={{ fontSize: "10px", color: C.text3, marginBottom: "4px" }}>{label}</div>
                <div style={{ fontWeight: 700, fontSize: "14px", color: color || C.text1 }}>{value}</div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: "8px" }}>
            <button onClick={(e) => { e.stopPropagation(); onChart(); }} style={{
              padding: "8px 16px", borderRadius: "10px", fontSize: "13px", fontWeight: 600,
              background: C.blueBg, color: C.blue, border: `1px solid ${C.blue}44`,
            }}>📈 차트 보기</button>
            <a href={asset.market === "crypto"
                ? `https://www.coingecko.com/en/coins/${asset.symbolRaw}`
                : `https://finance.yahoo.com/quote/${asset.symbolRaw || asset.symbol}`}
              target="_blank" rel="noopener" onClick={e => e.stopPropagation()}
              style={{
                padding: "8px 16px", borderRadius: "10px", fontSize: "13px", fontWeight: 600,
                background: C.card, color: C.text3, border: `1px solid ${C.border2}`, textDecoration: "none",
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
        const h14 = Math.max(...highs.slice(-14)), l14 = Math.min(...lows.slice(-14));
        const stochK = h14 !== l14 ? +((last - l14) / (h14 - l14) * 100).toFixed(1) : 50;
        const wr = h14 !== l14 ? +(((h14 - last) / (h14 - l14)) * -100).toFixed(1) : -50;
        const high52w = Math.max(...highs), low52w = Math.min(...lows);
        const wkAgo = n >= 5 ? closes[n - 5] : closes[0];
        const weekChange = +((last - wkAgo) / wkAgo * 100).toFixed(2);

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
            price: last, rsi, ma50, ma200, ma200Dist, volRatio,
            stoch: { k: stochK }, wr, high52w, low52w, weekChange,
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

  // 진단: techData가 있으면 enriched, 없으면 기본 asset
  const enriched = techData ? { ...asset, ...techData } : asset;
  const diag = useMemo(() => quickDiagnosis(enriched), [enriched]);

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
              fontWeight: 800, fontSize: "11px", color: mcColor, flexShrink: 0,
            }}>
              {asset.symbol.replace(".KS","").slice(0, 4)}
            </div>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span style={{ fontWeight: 700, fontSize: "17px", color: C.text1 }}>{asset.name}</span>
                <span style={{ fontSize: "11px" }}>{flag}</span>
              </div>
              <div style={{ fontSize: "12px", color: C.text3 }}>{asset.symbol.replace(".KS","")}</div>
            </div>
          </div>
          <button onClick={onClose} style={{
            width: "32px", height: "32px", borderRadius: "50%", border: "none",
            background: C.card2, color: C.text3, fontSize: "16px", cursor: "pointer",
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
                fontSize: "13px", fontWeight: 600,
                color: (techData?.weekChange ?? change ?? 0) >= 0 ? C.green : C.red,
              }}>
                {(techData?.weekChange ?? change ?? 0) >= 0 ? "▲" : "▼"} {Math.abs(techData?.weekChange ?? change ?? 0).toFixed(2)}%
              </span>
            )}
            {ext && (ext.price) && (
              <div style={{ marginTop: "6px", fontSize: "11px", color: C.text3, display: "flex", alignItems: "center", gap: "6px" }}>
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
              background: C.bg, borderRadius: "14px", padding: "24px", textAlign: "center",
              border: `1px solid ${C.border}`,
            }}>
              <div style={{ fontSize: "20px", marginBottom: "8px", animation: "spin 1s linear infinite" }}>⏳</div>
              <div style={{ fontSize: "12px", color: C.text3 }}>기술적 지표 분석 중...</div>
            </div>
          ) : (
            <div style={{
              background: C.bg, borderRadius: "14px", padding: "16px",
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
                    <span style={{ fontSize: "13px", fontWeight: 700, color: C.text3 }}>🩺 투자진단</span>
                    <span style={{
                      fontSize: "14px", fontWeight: 800,
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
                      fontSize: "13px", fontWeight: 800,
                      color: diag.opinionColor === "green" ? C.green : diag.opinionColor === "red" ? C.red : C.yellow,
                    }}>
                      {diag.opinion === "매수" ? "🟢" : diag.opinion === "매도" ? "🔴" : diag.opinion === "중립" ? "🟡" : diag.opinionColor === "green" ? "🟢" : "🔴"} {diag.opinion}
                    </span>
                    <span style={{ fontSize: "10px", color: C.text3 }}>{diag.rationale}</span>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "5px" }}>
                    {diag.categories.map(cat => (
                      <div key={cat.name} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <span style={{ fontSize: "10px", color: C.text3, width: "30px" }}>{cat.name}</span>
                        <div style={{ flex: 1, height: "5px", background: C.border, borderRadius: "3px", overflow: "hidden" }}>
                          <div style={{
                            height: "100%", borderRadius: "3px",
                            width: `${cat.score}%`,
                            background: cat.score >= 70 ? C.green : cat.score >= 40 ? C.yellow : C.red,
                            transition: "width 0.4s ease",
                          }} />
                        </div>
                        <span style={{ fontSize: "10px", fontWeight: 700, color: C.text3, width: "20px", textAlign: "right" }}>{cat.score}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              {diag.signals.length > 0 && (
                <div style={{ display: "flex", gap: "5px", flexWrap: "wrap" }}>
                  {diag.signals.map((sig, i) => (
                    <span key={i} style={{
                      fontSize: "10px", fontWeight: 600, padding: "4px 8px", borderRadius: "6px",
                      background: sig.type === "bullish" ? `${C.green}18` : sig.type === "bearish" ? `${C.red}18` : `${C.yellow}18`,
                      color: sig.type === "bullish" ? C.green : sig.type === "bearish" ? C.red : C.yellow,
                    }}>{sig.type === "bullish" ? "▲" : sig.type === "bearish" ? "▼" : "●"} {sig.name}</span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

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
              <div style={{ background: C.bg, borderRadius: "14px", padding: "16px", border: `1px solid ${C.border}` }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <span style={{ fontSize: "11px", fontWeight: 700, color: C.text3 }}>🎯 퀀트 전략</span>
                    <span style={{
                      fontSize: "10px", fontWeight: 700, padding: "2px 8px", borderRadius: "4px",
                      background: diag.opinionColor === "green" ? `${C.green}18` : diag.opinionColor === "red" ? `${C.red}18` : `${C.yellow}18`,
                      color: diag.opinionColor === "green" ? C.green : diag.opinionColor === "red" ? C.red : C.yellow,
                    }}>{diag.opinion}</span>
                  </div>
                  {freshMin != null && <span style={{ fontSize: "9px", color: C.text3 }}>{freshMin < 1 ? "방금" : `${freshMin}분 전`} 분석</span>}
                </div>

                {/* 전략 요약 */}
                <div style={{
                  fontSize: "12px", color: C.text2, lineHeight: 1.7, marginBottom: "14px",
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
                    <div style={{ fontSize: "9px", color: C.text3, marginBottom: "3px" }}>목표가</div>
                    <div style={{ fontSize: "15px", fontWeight: 800, color: C.green }}>{fmtP(targetPrice || techData.analystTarget)}</div>
                    {upside && <div style={{ fontSize: "10px", color: C.green, marginTop: "2px" }}>+{upside}%</div>}
                    {lv?.targetSources && <div style={{ fontSize: "8px", color: C.text3, marginTop: "4px", lineHeight: 1.4 }}>{lv.targetSources.slice(0, 3).join(" · ")}</div>}
                  </div>
                  <div style={{ background: C.card, borderRadius: "8px", padding: "10px" }}>
                    <div style={{ fontSize: "9px", color: C.text3, marginBottom: "3px" }}>손절가</div>
                    <div style={{ fontSize: "15px", fontWeight: 800, color: C.red }}>{fmtP(stopLoss)}</div>
                    {downside > 0 && <div style={{ fontSize: "10px", color: C.red, marginTop: "2px" }}>-{downside}%</div>}
                    {lv?.stopSources && <div style={{ fontSize: "8px", color: C.text3, marginTop: "4px", lineHeight: 1.4 }}>{lv.stopSources.slice(0, 3).join(" · ")}</div>}
                  </div>
                </div>

                {/* 지지선 + 저항선 (다중 레벨, 근거 표시) */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px", marginBottom: "10px" }}>
                  <div style={{ background: C.card, borderRadius: "8px", padding: "10px" }}>
                    <div style={{ fontSize: "9px", color: C.text3, marginBottom: "5px" }}>지지선</div>
                    {sup1 ? (
                      <>
                        <div style={{ fontSize: "13px", fontWeight: 700, color: C.blue }}>{fmtP(sup1.price)}</div>
                        <div style={{ fontSize: "8px", color: C.text3, marginTop: "2px" }}>{sup1.sources.slice(0, 2).join(" · ")} <span style={{ color: C.blue }}>×{sup1.weight.toFixed(0)}</span></div>
                        {sup2 && <div style={{ fontSize: "10px", color: C.text3, marginTop: "4px" }}>2차: {fmtP(sup2.price)} <span style={{ fontSize: "8px" }}>({sup2.sources[0]})</span></div>}
                      </>
                    ) : <div style={{ fontSize: "12px", color: C.text3 }}>—</div>}
                  </div>
                  <div style={{ background: C.card, borderRadius: "8px", padding: "10px" }}>
                    <div style={{ fontSize: "9px", color: C.text3, marginBottom: "5px" }}>저항선</div>
                    {res1 ? (
                      <>
                        <div style={{ fontSize: "13px", fontWeight: 700, color: C.purple }}>{fmtP(res1.price)}</div>
                        <div style={{ fontSize: "8px", color: C.text3, marginTop: "2px" }}>{res1.sources.slice(0, 2).join(" · ")} <span style={{ color: C.purple }}>×{res1.weight.toFixed(0)}</span></div>
                        {res2 && <div style={{ fontSize: "10px", color: C.text3, marginTop: "4px" }}>2차: {fmtP(res2.price)} <span style={{ fontSize: "8px" }}>({res2.sources[0]})</span></div>}
                      </>
                    ) : <div style={{ fontSize: "12px", color: C.text3 }}>—</div>}
                  </div>
                </div>

                {/* 리스크:리워드 + 진입 + 포지션 */}
                <div style={{ display: "flex", gap: "6px" }}>
                  {riskReward && (
                    <div style={{ flex: 1, padding: "8px 10px", borderRadius: "8px", background: riskReward >= 2 ? `${C.green}12` : riskReward >= 1 ? `${C.yellow}12` : `${C.red}12`, textAlign: "center" }}>
                      <div style={{ fontSize: "9px", color: C.text3 }}>R:R</div>
                      <div style={{ fontSize: "14px", fontWeight: 800, color: riskReward >= 2 ? C.green : riskReward >= 1 ? C.yellow : C.red }}>1:{riskReward}</div>
                    </div>
                  )}
                  <div style={{ flex: 1, padding: "8px 10px", borderRadius: "8px", background: C.card, textAlign: "center" }}>
                    <div style={{ fontSize: "9px", color: C.text3 }}>진입</div>
                    <div style={{ fontSize: "11px", fontWeight: 700, color: C.text1, marginTop: "2px" }}>{isBullish ? "분할매수" : isBearish ? "관망" : "확인 후"}</div>
                  </div>
                  <div style={{ flex: 1, padding: "8px 10px", borderRadius: "8px", background: C.card, textAlign: "center" }}>
                    <div style={{ fontSize: "9px", color: C.text3 }}>포지션</div>
                    <div style={{ fontSize: "11px", fontWeight: 700, color: C.text1, marginTop: "2px" }}>{diag.score >= 70 ? "비중확대" : diag.score >= 55 ? "소량매수" : diag.score >= 40 ? "비중유지" : "비중축소"}</div>
                  </div>
                </div>
              </div>
            </div>

            {/* ═══ 퀀트 전략 백테스트 결과 (상위 5개) ═══ */}
            {bt.length > 0 && (
              <div style={{ padding: "0 20px 12px" }}>
                <div style={{ background: C.bg, borderRadius: "14px", padding: "16px", border: `1px solid ${C.border}` }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
                    <span style={{ fontSize: "11px", fontWeight: 700, color: C.text3 }}>📊 퀀트 전략 백테스트 (1년)</span>
                    <span style={{ fontSize: "9px", color: C.text3 }}>상위 {bt.length}개</span>
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
                            <span style={{ fontSize: "12px", fontWeight: 700, color: isTop ? C.blue : C.text1 }}>
                              {isTop ? "🏆" : `${i + 1}.`} {s.name}
                            </span>
                          </div>
                          <span style={{ fontSize: "14px", fontWeight: 800, color: retColor }}>
                            {s.totalReturn >= 0 ? "+" : ""}{s.totalReturn}%
                          </span>
                        </div>
                        <div style={{ fontSize: "10px", color: C.text3, marginBottom: "6px" }}>{s.desc}</div>
                        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                          <span style={{ fontSize: "10px", padding: "2px 6px", borderRadius: "4px", background: C.card2 }}>
                            샤프 <span style={{ fontWeight: 700, color: s.sharpe >= 1 ? C.green : s.sharpe >= 0 ? C.yellow : C.red }}>{s.sharpe}</span>
                          </span>
                          <span style={{ fontSize: "10px", padding: "2px 6px", borderRadius: "4px", background: C.card2 }}>
                            승률 <span style={{ fontWeight: 700, color: s.winRate >= 60 ? C.green : s.winRate >= 40 ? C.yellow : C.red }}>{s.winRate}%</span>
                          </span>
                          <span style={{ fontSize: "10px", padding: "2px 6px", borderRadius: "4px", background: C.card2 }}>
                            MDD <span style={{ fontWeight: 700, color: s.maxDD <= 10 ? C.green : s.maxDD <= 20 ? C.yellow : C.red }}>-{s.maxDD}%</span>
                          </span>
                          <span style={{ fontSize: "10px", padding: "2px 6px", borderRadius: "4px", background: C.card2 }}>
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

        {/* ═══ 적정주가 (Multi-Model Fair Value) ═══ */}
        {techData?.fairValue != null && (
          <div style={{ padding: "0 20px 12px" }}>
            <div style={{ background: C.bg, borderRadius: "14px", padding: "16px", border: `1px solid ${C.border}` }}>
              {/* 종합 적정주가 헤더 */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
                <div>
                  <div style={{ fontSize: "10px", color: C.text3, marginBottom: "4px", display: "flex", alignItems: "center", gap: "4px" }}>
                    📊 종합 적정주가 <span style={{ fontSize: "8px", padding: "1px 5px", borderRadius: "3px", background: C.card2 }}>{techData.models?.length || 0}개 모델</span>
                  </div>
                  <div style={{ fontSize: "22px", fontWeight: 800, color: C.text1 }}>
                    {asset.market === "kr" ? `₩${Math.round(techData.fairValue).toLocaleString()}` : `$${techData.fairValue.toFixed(2)}`}
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{
                    fontSize: "18px", fontWeight: 800,
                    color: techData.fairPremium > 5 ? C.red : techData.fairPremium < -5 ? C.green : C.yellow,
                  }}>
                    {techData.fairPremium > 0 ? "+" : ""}{techData.fairPremium}%
                  </div>
                  <div style={{
                    fontSize: "11px", fontWeight: 700, padding: "2px 8px", borderRadius: "4px", display: "inline-block",
                    background: techData.fairPremium > 10 ? C.redBg : techData.fairPremium > 5 ? `${C.red}12` : techData.fairPremium < -10 ? C.greenBg : techData.fairPremium < -5 ? `${C.green}12` : C.yellowBg,
                    color: techData.fairPremium > 5 ? C.red : techData.fairPremium < -5 ? C.green : C.yellow,
                  }}>
                    {techData.fairPremium > 15 ? "매우 고평가" : techData.fairPremium > 10 ? "고평가" : techData.fairPremium > 5 ? "약간 고평가" : techData.fairPremium < -15 ? "매우 저평가" : techData.fairPremium < -10 ? "저평가" : techData.fairPremium < -5 ? "약간 저평가" : "적정 범위"}
                  </div>
                </div>
              </div>

              {/* 적정주가 바 시각화 (현재가 위치) */}
              {techData.analystLow && techData.analystHigh && (
                <div style={{ marginBottom: "12px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "9px", color: C.text3, marginBottom: "4px" }}>
                    <span>저점 {asset.market === "kr" ? `₩${Math.round(techData.analystLow).toLocaleString()}` : `$${techData.analystLow.toFixed(0)}`}</span>
                    <span>고점 {asset.market === "kr" ? `₩${Math.round(techData.analystHigh).toLocaleString()}` : `$${techData.analystHigh.toFixed(0)}`}</span>
                  </div>
                  <div style={{ position: "relative", height: "8px", background: C.border, borderRadius: "4px", overflow: "visible" }}>
                    {/* 적정주가 범위 */}
                    <div style={{
                      position: "absolute", left: "20%", right: "20%", top: 0, bottom: 0,
                      background: `${C.blue}30`, borderRadius: "4px",
                    }} />
                    {/* 현재가 마커 */}
                    {(() => {
                      const pos = Math.max(0, Math.min(100, ((techData.price - techData.analystLow) / (techData.analystHigh - techData.analystLow)) * 100));
                      return (
                        <div style={{
                          position: "absolute", left: `${pos}%`, top: "-3px",
                          width: "14px", height: "14px", borderRadius: "50%",
                          background: C.blue, border: `2px solid ${C.card}`,
                          transform: "translateX(-7px)", boxShadow: `0 0 6px ${C.blue}66`,
                        }} />
                      );
                    })()}
                    {/* 적정주가 마커 */}
                    {(() => {
                      const fvPos = Math.max(0, Math.min(100, ((techData.fairValue - techData.analystLow) / (techData.analystHigh - techData.analystLow)) * 100));
                      return (
                        <div style={{
                          position: "absolute", left: `${fvPos}%`, top: "-2px",
                          width: "12px", height: "12px", borderRadius: "2px", transform: "translateX(-6px) rotate(45deg)",
                          background: C.yellow, border: `2px solid ${C.card}`,
                        }} />
                      );
                    })()}
                  </div>
                  <div style={{ display: "flex", justifyContent: "center", gap: "12px", marginTop: "6px", fontSize: "9px", color: C.text3 }}>
                    <span><span style={{ display: "inline-block", width: "8px", height: "8px", borderRadius: "50%", background: C.blue, marginRight: "3px", verticalAlign: "middle" }}/>현재가</span>
                    <span><span style={{ display: "inline-block", width: "7px", height: "7px", borderRadius: "1px", background: C.yellow, marginRight: "3px", verticalAlign: "middle", transform: "rotate(45deg)" }}/>적정가</span>
                  </div>
                </div>
              )}

              {/* 개별 모델 브레이크다운 */}
              {techData.models?.length > 0 && (
                <div style={{ marginBottom: "10px" }}>
                  <div style={{ fontSize: "10px", color: C.text3, fontWeight: 600, marginBottom: "6px" }}>모델별 산출가</div>
                  {techData.models.map((m, i) => {
                    const prem = +((techData.price - m.value) / m.value * 100).toFixed(1);
                    return (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "5px 0", borderBottom: i < techData.models.length - 1 ? `1px solid ${C.border}` : "none" }}>
                        <span style={{ fontSize: "13px", width: "20px", textAlign: "center" }}>{m.icon}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: "11px", color: C.text2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.name}</div>
                        </div>
                        <div style={{ fontSize: "12px", fontWeight: 700, color: C.text1, whiteSpace: "nowrap" }}>
                          {asset.market === "kr" ? `₩${Math.round(m.value).toLocaleString()}` : `$${m.value.toFixed(2)}`}
                        </div>
                        <div style={{
                          fontSize: "10px", fontWeight: 600, width: "48px", textAlign: "right",
                          color: prem > 5 ? C.red : prem < -5 ? C.green : C.text3,
                        }}>
                          {prem > 0 ? "+" : ""}{prem}%
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* 애널리스트 컨센서스 요약 */}
              {techData.analystCount > 0 && (
                <div style={{
                  background: C.card, borderRadius: "10px", padding: "10px 12px",
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  border: `1px solid ${C.border}`,
                }}>
                  <div>
                    <div style={{ fontSize: "9px", color: C.text3, marginBottom: "2px" }}>🏦 애널리스트 ({techData.analystCount}명)</div>
                    <div style={{ fontSize: "13px", fontWeight: 700, color: C.text1 }}>
                      {asset.market === "kr" ? `₩${Math.round(techData.analystTarget).toLocaleString()}` : `$${techData.analystTarget?.toFixed(2) || "—"}`}
                    </div>
                  </div>
                  {techData.recommendation && (
                    <div style={{
                      padding: "4px 10px", borderRadius: "6px", fontSize: "11px", fontWeight: 700,
                      background: techData.recommendation === "buy" || techData.recommendation === "strong_buy" ? C.greenBg : techData.recommendation === "sell" || techData.recommendation === "strong_sell" ? C.redBg : C.yellowBg,
                      color: techData.recommendation === "buy" || techData.recommendation === "strong_buy" ? C.green : techData.recommendation === "sell" || techData.recommendation === "strong_sell" ? C.red : C.yellow,
                    }}>
                      {techData.recommendation === "strong_buy" ? "적극 매수" : techData.recommendation === "buy" ? "매수" : techData.recommendation === "hold" ? "보유" : techData.recommendation === "sell" ? "매도" : techData.recommendation === "strong_sell" ? "적극 매도" : techData.recommendation}
                    </div>
                  )}
                  {techData.analystLow && techData.analystHigh && (
                    <div style={{ textAlign: "right", fontSize: "10px", color: C.text3, lineHeight: 1.5 }}>
                      <div>{asset.market === "kr" ? `₩${Math.round(techData.analystLow).toLocaleString()}` : `$${techData.analystLow.toFixed(0)}`} ~ {asset.market === "kr" ? `₩${Math.round(techData.analystHigh).toLocaleString()}` : `$${techData.analystHigh.toFixed(0)}`}</div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ═══ 밸류에이션 + 기술적 지표 ═══ */}
        {techData && (
          <div style={{ padding: "0 20px 16px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "6px" }}>
              {[
                { label: "RSI(14)", value: techData.rsi, color: techData.rsi <= 30 ? C.purple : techData.rsi >= 70 ? C.red : C.text2 },
                { label: "200일선", value: techData.ma200Dist != null ? `${techData.ma200Dist > 0 ? "+" : ""}${techData.ma200Dist}%` : "—" },
                { label: "거래량", value: `${techData.volRatio}x`, color: techData.volRatio >= 2 ? C.red : C.text2 },
                techData.forwardPE ? { label: "Forward PE", value: techData.forwardPE.toFixed(1), color: techData.forwardPE > 30 ? C.red : techData.forwardPE < 15 ? C.green : C.text2 } : { label: "스토캐스틱", value: `${techData.stoch.k}`, color: techData.stoch.k < 20 ? C.purple : techData.stoch.k > 80 ? C.red : C.text2 },
                techData.priceToBook ? { label: "PBR", value: techData.priceToBook.toFixed(2), color: techData.priceToBook > 5 ? C.red : techData.priceToBook < 1.5 ? C.green : C.text2 } : { label: "W%R", value: `${techData.wr}`, color: techData.wr < -80 ? C.purple : techData.wr > -20 ? C.red : C.text2 },
                techData.beta ? { label: "베타", value: techData.beta.toFixed(2), color: techData.beta > 1.5 ? C.red : techData.beta < 0.8 ? C.green : C.text2 } : { label: "52주 위치", value: techData.high52w && techData.low52w ? `${((techData.price - techData.low52w) / (techData.high52w - techData.low52w) * 100).toFixed(0)}%` : "—" },
              ].map(({ label, value, color }) => (
                <div key={label} style={{ background: C.bg, borderRadius: "10px", padding: "8px 10px", textAlign: "center" }}>
                  <div style={{ fontSize: "9px", color: C.text3, marginBottom: "3px" }}>{label}</div>
                  <div style={{ fontWeight: 700, fontSize: "13px", color: color || C.text1 }}>{value}</div>
                </div>
              ))}
            </div>
            {/* 시가총액 + 배당 + 실적 */}
            {(techData.marketCap || techData.dividendYield || techData.earningsDate) && (
              <div style={{ display: "flex", gap: "6px", marginTop: "6px", flexWrap: "wrap" }}>
                {techData.marketCap && (
                  <span style={{ fontSize: "10px", padding: "3px 8px", borderRadius: "6px", background: C.card2, color: C.text3 }}>
                    시총 {asset.market === "kr"
                      ? (techData.marketCap >= 1e12 ? `₩${(techData.marketCap / 1e12).toFixed(1)}조` : techData.marketCap >= 1e8 ? `₩${(techData.marketCap / 1e8).toFixed(0)}억` : `₩${Math.round(techData.marketCap).toLocaleString()}`)
                      : (techData.marketCap >= 1e12 ? `$${(techData.marketCap / 1e12).toFixed(1)}T` : techData.marketCap >= 1e9 ? `$${(techData.marketCap / 1e9).toFixed(1)}B` : `$${(techData.marketCap / 1e6).toFixed(0)}M`)}
                  </span>
                )}
                {techData.dividendYield && techData.dividendYield > 0 && (
                  <span style={{ fontSize: "10px", padding: "3px 8px", borderRadius: "6px", background: `${C.green}12`, color: C.green }}>
                    배당 {(techData.dividendYield * 100).toFixed(2)}%
                  </span>
                )}
                {techData.earningsDate && (
                  <span style={{ fontSize: "10px", padding: "3px 8px", borderRadius: "6px", background: C.card2, color: C.text3 }}>
                    실적 {new Date(techData.earningsDate * 1000).toLocaleDateString("ko-KR", { month: "short", day: "numeric" })}
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        {/* 액션 버튼 */}
        <div style={{ padding: "0 20px 20px", display: "flex", gap: "8px" }}>
          <button onClick={() => onToggleWatch(asset.symbol)} style={{
            width: "44px", height: "44px", borderRadius: "12px", fontSize: "18px",
            background: isWatched ? `${C.yellow}22` : C.card2, border: `1px solid ${isWatched ? C.yellow : C.border2}`,
            cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          }}>{isWatched ? "⭐" : "☆"}</button>
          <button onClick={() => { onChart(); onClose(); }} style={{
            flex: 1, padding: "12px 0", borderRadius: "12px", fontSize: "14px", fontWeight: 700,
            background: C.blue, color: "#fff", border: "none", cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", gap: "6px",
          }}>📈 차트 보기</button>
          <a href={asset.market === "crypto"
              ? `https://www.coingecko.com/en/coins/${asset.id || asset.symbolRaw || asset.symbol.toLowerCase()}`
              : `https://finance.yahoo.com/quote/${asset.symbolRaw || asset.symbol}`}
            target="_blank" rel="noopener"
            style={{
              flex: 1, padding: "12px 0", borderRadius: "12px", fontSize: "14px", fontWeight: 700,
              background: C.card2, color: C.text2, border: `1px solid ${C.border2}`,
              textDecoration: "none", textAlign: "center",
              display: "flex", alignItems: "center", justifyContent: "center", gap: "6px",
            }}>🔗 상세 정보</a>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// 메인 앱
// ════════════════════════════════════════════════════════════════════
function AppInner() {
  const [themeMode, setThemeMode] = useState(loadTheme);
  C = themeMode === "dark" ? DARK : LIGHT;
  const toggleTheme = useCallback(() => {
    setThemeMode(prev => {
      const next = prev === "dark" ? "light" : "dark";
      try { localStorage.setItem(THEME_KEY, next); } catch {}
      return next;
    });
  }, []);

  const [tab, setTab] = useState("home");
  const [menuOpen, setMenuOpen] = useState(false);

  // ── 모바일 감지 (폰트 크기 보정용) ──
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.innerWidth <= 640);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const handler = (e) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  // 폰트 크기 헬퍼: 모바일에서 작은 폰트 자동 보정
  // 8→10, 9→11, 10→11, 11→12 (px)
  const mf = useCallback((px) => {
    if (!isMobile) return `${px}px`;
    if (px <= 8) return "10px";
    if (px <= 9) return "11px";
    if (px <= 10) return "11px";
    if (px <= 11) return "12px";
    return `${px}px`;
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
  const [homeSection, setHomeSection] = useState({
    market: true, watchlist: true, calendar: false, fearGreed: false,
    sector: false, signal: false, hotAssets: true, allAssets: false,
  });
  const toggleSection = useCallback((key) => setHomeSection(p => ({ ...p, [key]: !p[key] })), []);

  // ── 스크리너 상태 ─────────────────────────────────────────────
  const [results, setResults]         = useState([]);
  const [scanning, setScanning]       = useState(false);
  const [scanProgress, setScanProgress] = useState({ done: 0, total: 0 });
  const [conditions, setConditions]   = useState([]);
  const [mode, setMode]               = useState("or");
  const [filterMarket, setFilterMarket] = useState("all");
  const [sortBy, setSortBy]           = useState("rsi");
  const [scanErrors, setScanErrors]   = useState([]);
  const [lastScan, setLastScan]       = useState(null);
  const [chartAsset, setChartAsset]   = useState(null);
  const [selectedAsset, setSelectedAsset] = useState(null); // 종목 상세 팝업

  // ── 저평가 종목 스캔 ──
  const [valueResults, setValueResults] = useState([]);
  const [valueScanning, setValueScanning] = useState(false);
  const [valueScanProgress, setValueScanProgress] = useState({ done: 0, total: 0 });
  const [valueFilter, setValueFilter] = useState("all"); // all, us, kr
  const [valueSortBy, setValueSortBy] = useState("score"); // score, per, pbr, div, upside
  const [valueLastScan, setValueLastScan] = useState(null);
  const [watchlist, setWatchlist] = useState(() => { try { return JSON.parse(localStorage.getItem("di_watchlist") || "[]"); } catch { return []; } });

  // ── 포트폴리오 상태 ───────────────────────────────────────────
  const [portfolio, setPortfolio]         = useState(loadPortfolio);
  const [portfolioPrices, setPortfolioPrices] = useState({});
  const [portfolioLoading, setPortfolioLoading] = useState(false);
  const [showAddAsset, setShowAddAsset]   = useState(false);
  const [newAsset, setNewAsset]           = useState({ symbol: "", name: "", market: "us", qty: "", avgPrice: "" });

  // ── 알림 설정 ─────────────────────────────────────────────────
  const [settings, setSettings] = useState(() => ({ botToken: "", chatId: "", autoSend: false, ...loadSettings() }));
  const [tgStatus, setTgStatus] = useState("");

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

  useEffect(() => { saveSettings({ botToken: settings.botToken, chatId: settings.chatId, autoSend: settings.autoSend, syncPin }); }, [settings, syncPin]);
  useEffect(() => { savePortfolio(portfolio); }, [portfolio]);

  // 관심종목 저장
  useEffect(() => { try { localStorage.setItem("di_watchlist", JSON.stringify(watchlist)); } catch {} }, [watchlist]);

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

  // ── useMemo: 스크리너 결과 정렬 ──
  const sortedResults = useMemo(() => {
    return [...results].sort((a, b) => {
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
    // watchlist에서 US 종목 추가 (올바른 키: di_watchlist)
    try {
      const wl = JSON.parse(localStorage.getItem("di_watchlist") || "[]");
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

  // ── 경제 캘린더 (API 기반 + 실제/예상 수치) ──
  const fetchEconCalendar = useCallback(async () => {
    try {
      const resp = await fetch("/api/econ-calendar");
      const data = await resp.json();
      const now = new Date();
      const events = (data.events || []).map(e => {
        // 미국 동부시간 기준 발표 → 한국 시간(KST, UTC+9)으로 변환
        // 대부분 경제지표는 8:30 AM ET 발표 → KST 22:30 (전날 or 당일)
        const usET = new Date(e.date + "T08:30:00-05:00"); // US Eastern
        const d = new Date(usET.getTime()); // KST로 자동 변환 (브라우저 시간대)
        // 한국 시간 기준 날짜 차이 계산
        const koNow = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
        const koEvt = new Date(d.toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
        const diff = Math.floor((new Date(koEvt.getFullYear(), koEvt.getMonth(), koEvt.getDate()) - new Date(koNow.getFullYear(), koNow.getMonth(), koNow.getDate())) / 86400000);
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
  useEffect(() => {
    if (tab !== "home") return;
    if (marketIndices.length === 0) fetchMarketOverview();
    fetchEconCalendar();
    if (portfolio.length > 0) fetchPortfolioPrices();
    const iv = setInterval(() => { fetchMarketOverview(); }, 30000);
    return () => {
      clearInterval(iv);
      // 탭 떠날 때 진행 중인 요청 취소
      if (abortRef.current) abortRef.current.abort();
      fetchingRef.current = false;
    };
  }, [tab]);

  // ── 스크리너 실행 (병렬 배치 최적화) ──────────────────────────
  const runScan = useCallback(async () => {
    if (scanning) return;
    setScanning(true); setScanErrors([]);
    const yahooAssets = [
      ...US_ASSETS.map(a => ({ ...a, market: "us", symbolRaw: a.symbol })),
      ...KR_ASSETS.map(a => ({ ...a, market: "kr", symbolRaw: a.symbol, symbol: a.symbol.replace(".KS", "") })),
    ];
    const cryptoAssets = CRYPTO_ASSETS.map(a => ({ ...a, market: "crypto", symbol: a.symbol, symbolRaw: a.id }));
    const totalCount = yahooAssets.length + cryptoAssets.length;
    setScanProgress({ done: 0, total: totalCount });
    const found = [], errors = [];
    let doneCount = 0;

    // ── Yahoo 배치 병렬 처리 (10개씩 배치 → batch API) ──
    const YAHOO_BATCH = 10;
    for (let b = 0; b < yahooAssets.length; b += YAHOO_BATCH) {
      const batch = yahooAssets.slice(b, b + YAHOO_BATCH);
      const syms = batch.map(a => a.symbolRaw);
      try {
        // 주간 + 일간 배치를 동시 요청
        const [wkRes, dyRes] = await Promise.all([
          fetch(`/api/yahoo-batch?symbols=${encodeURIComponent(syms.join(","))}&interval=1wk&range=2y`),
          fetch(`/api/yahoo-batch?symbols=${encodeURIComponent(syms.join(","))}&interval=1d&range=1y`),
        ]);
        const wkData = wkRes.ok ? (await wkRes.json()).results || {} : {};
        const dyData = dyRes.ok ? (await dyRes.json()).results || {} : {};

        for (const asset of batch) {
          try {
            const wk = wkData[asset.symbolRaw];
            const dy = dyData[asset.symbolRaw];
            if (!wk || wk.error || !wk.closes?.length) throw new Error("데이터 없음");
            const wCloses = wk.closes || [];
            const wVolumes = wk.volumes || [];
            const wHighs = wk.highs || wCloses;
            const wLows = wk.lows || wCloses;
            const dCloses = dy?.closes || [];
            const result = analyzeAsset(wCloses, dCloses, wVolumes, wHighs, wLows, conditions);
            const match = mode === "or" ? result.triggers.length > 0 : conditions.every(c => result.triggers.includes(c));
            if (match) found.push({ ...asset, ...result });
          } catch (e) { errors.push(`${asset.market.toUpperCase()}:${asset.symbol} — ${e.message}`); }
          doneCount++;
        }
      } catch (e) {
        // 배치 전체 실패 시 개별 에러 기록
        batch.forEach(a => { errors.push(`${a.market.toUpperCase()}:${a.symbol} — batch ${e.message}`); doneCount++; });
      }
      setScanProgress({ done: doneCount, total: totalCount });
    }

    // ── 크립토 병렬 처리 (3개 동시) ──
    const CRYPTO_CONCURRENT = 3;
    for (let b = 0; b < cryptoAssets.length; b += CRYPTO_CONCURRENT) {
      const batch = cryptoAssets.slice(b, b + CRYPTO_CONCURRENT);
      const results = await Promise.allSettled(batch.map(async (asset) => {
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
          wHighs.push(Math.max(...sl));
          wLows.push(Math.min(...sl));
        }
        return { asset, wCloses, wVolumes, wHighs, wLows, dCloses: dp };
      }));

      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        const asset = batch[i];
        if (r.status === "fulfilled") {
          try {
            const { wCloses, wVolumes, wHighs, wLows, dCloses } = r.value;
            if (!wCloses.length) throw new Error("데이터 없음");
            const result = analyzeAsset(wCloses, dCloses, wVolumes, wHighs, wLows, conditions);
            const match = mode === "or" ? result.triggers.length > 0 : conditions.every(c => result.triggers.includes(c));
            if (match) found.push({ ...asset, ...result });
          } catch (e) { errors.push(`CRYPTO:${asset.symbol} — ${e.message}`); }
        } else {
          errors.push(`CRYPTO:${asset.symbol} — ${r.reason?.message || "fetch 실패"}`);
        }
        doneCount++;
      }
      setScanProgress({ done: doneCount, total: totalCount });
      // CoinGecko 레이트 리밋: 배치 간 800ms
      if (b + CRYPTO_CONCURRENT < cryptoAssets.length) await new Promise(r => setTimeout(r, 800));
    }

    const sorted = found.sort((a, b) => {
      if (sortBy === "rsi")     return (a.rsi ?? 999) - (b.rsi ?? 999);
      if (sortBy === "change")  return a.weekChange - b.weekChange;
      if (sortBy === "vol")     return b.volRatio - a.volRatio;
      return b.triggers.length - a.triggers.length;
    });
    setResults(sorted); setScanErrors(errors); setLastScan(new Date()); setScanning(false);

    if (settings.autoSend && settings.botToken && settings.chatId && sorted.length > 0) {
      try {
        await sendTelegramAlert(settings.botToken, settings.chatId, sorted, conditions);
        setTgStatus("✅ 자동 알림 전송 완료");
      } catch { setTgStatus("❌ 텔레그램 전송 실패"); }
    }
  }, [scanning, conditions, mode, sortBy, settings]);

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

  // 뉴스 정렬
  const sortedNews = [...newsItems].sort((a, b) => {
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
  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text1, fontFamily: "'Pretendard', 'Apple SD Gothic Neo', system-ui, sans-serif" }}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }
        @keyframes livePulse { 0%,100%{opacity:1} 50%{opacity:.4} }
        @keyframes fadeIn { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
        @keyframes shimmer { 0%{background-position:-200% 0} 100%{background-position:200% 0} }
        /* 모바일 앱처럼 전체 화면 확대/축소 방지 */
        html, body { touch-action: manipulation; -ms-touch-action: manipulation; }
        * { -webkit-touch-callout: none; }
        @keyframes slideUp { from{opacity:0;transform:translateY(16px)} to{opacity:1;transform:translateY(0)} }
        * { box-sizing: border-box; margin: 0; -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; }
        html { font-size: 16px; line-height: 1.5; scroll-behavior: smooth; }
        body { letter-spacing: -0.01em; transition: background 0.3s ease, color 0.3s ease; }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: ${C.border2}; border-radius: 3px; }
        button, a { cursor: pointer; font-family: inherit; transition: all 0.15s ease; }
        button:active { transform: scale(0.97); }
        input, select { font-family: inherit; font-size: 14px; transition: border-color 0.2s ease; }
        input:focus { border-color: ${C.blue} !important; box-shadow: 0 0 0 3px ${C.blue}18; outline: none; }
        .skeleton { background: linear-gradient(90deg, ${C.card2} 25%, ${C.border} 50%, ${C.card2} 75%);
          background-size: 200% 100%; animation: shimmer 1.5s infinite; border-radius: 8px; }
        .tab-content { animation: slideUp 0.25s ease; }
        .card-hover:hover { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(0,0,0,0.15); }
        /* ── 기본 홈 그리드 (모바일 1컬럼) ── */
        .home-grid { display: flex; flex-direction: column; gap: 12px; }
        .home-left, .home-right { display: flex; flex-direction: column; gap: 12px; }
        .home-full { display: flex; flex-direction: column; gap: 12px; }
        /* ── 모바일 (≤640px) — 폰트/간격 확대 ── */
        @media (max-width: 640px) {
          .desktop-nav { display: none !important; }
          .mobile-menu-btn { display: flex !important; }
          main { padding-left: 14px !important; padding-right: 14px !important;
            font-size: 15px !important; }
          .tab-content { font-size: 15px; }
        }
        /* ── 태블릿 (641~899px) ── */
        @media (min-width: 641px) and (max-width: 899px) {
        }
        /* ── 데스크톱 (≥900px) ── */
        @media (min-width: 900px) {
          .home-grid { display: grid !important; grid-template-columns: 1fr 360px !important; gap: 16px !important; align-items: start !important; }
          .home-right { position: sticky; top: 72px; max-height: calc(100vh - 88px); overflow-y: auto; overflow-x: hidden;
            scrollbar-width: none; -ms-overflow-style: none; }
          .home-right::-webkit-scrollbar { display: none; }
        }
      `}</style>

      {/* ── 헤더 ──────────────────────────────────────────────────── */}
      <header style={{
        position: "sticky", top: 0, zIndex: 100,
        background: `${C.bg}f0`, backdropFilter: "blur(12px)",
        borderBottom: `1px solid ${C.border}`,
        paddingTop: "env(safe-area-inset-top, 0px)",
      }}>
        <div style={{ maxWidth: "1080px", margin: "0 auto", padding: "0 20px", display: "flex", alignItems: "center", justifyContent: "space-between", height: "56px" }}>
          <div onClick={() => setTab("home")} style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", userSelect: "none" }}
            title="홈으로 이동">
            <span style={{ fontSize: "20px" }}>📡</span>
            <span style={{ fontWeight: 800, fontSize: "17px", letterSpacing: "-0.5px" }}>DI금융</span>
            <span style={{ padding: "1px 7px", borderRadius: "4px", fontSize: mf(10), fontWeight: 700, background: C.blueBg, color: C.blue }}>v6.6</span>
          </div>
          {/* 데스크톱 네비게이션 */}
          <nav className="desktop-nav" style={{ display: "flex", gap: "2px" }}>
            {[{ id: "home", label: "홈", icon: "🏠" }, { id: "screener", label: "스크리너", icon: "🔍" }, { id: "strategy", label: "퀀트 전략", icon: "🎯" }, { id: "quant-report", label: "퀀트 리포트", icon: "📋" }, { id: "backtest", label: "백테스트", icon: "📊" }, { id: "portfolio", label: "포트폴리오", icon: "💼" }, { id: "news", label: "뉴스", icon: "📰" }, { id: "alerts", label: "알림", icon: "🔔" }].map(t => (
              <button key={t.id} onClick={() => setTab(t.id)} style={{
                padding: "6px 10px", borderRadius: "8px", fontSize: "12px", fontWeight: 600,
                background: tab === t.id ? C.blueBg : "transparent",
                color: tab === t.id ? C.blue : C.text3, border: "none", whiteSpace: "nowrap",
              }}>{t.icon} {t.label}</button>
            ))}
          </nav>
          {/* 테마 토글 + 햄버거 */}
          <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <button onClick={toggleTheme} title={themeMode === "dark" ? "라이트 모드" : "다크 모드"} style={{
              background: C.card2, border: `1px solid ${C.border}`, borderRadius: "10px",
              width: "36px", height: "36px", display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: "16px", cursor: "pointer", color: C.text1, transition: "all 0.2s",
            }}>
              {themeMode === "dark" ? "\u2600\uFE0F" : "\uD83C\uDF19"}
            </button>
            <button className="mobile-menu-btn" onClick={() => setMenuOpen(!menuOpen)} style={{
              display: "none", alignItems: "center", justifyContent: "center",
              background: "none", border: "none", color: C.text2,
              fontSize: "22px", width: "36px", height: "36px", cursor: "pointer",
            }}>
              {menuOpen ? "\u2715" : "\u2630"}
            </button>
          </div>
        </div>
        {/* 모바일 햄버거 드롭다운 */}
        {menuOpen && (
          <div style={{
            background: C.card, borderTop: `1px solid ${C.border}`,
            padding: "8px 16px 12px", display: "flex", flexDirection: "column", gap: "2px",
          }}>
            {[{ id: "home", label: "홈", icon: "🏠" }, { id: "screener", label: "스크리너", icon: "🔍" }, { id: "strategy", label: "퀀트 전략", icon: "🎯" }, { id: "quant-report", label: "퀀트 리포트", icon: "📋" }, { id: "backtest", label: "백테스트", icon: "📊" }, { id: "portfolio", label: "포트폴리오", icon: "💼" }, { id: "news", label: "뉴스", icon: "📰" }, { id: "alerts", label: "알림", icon: "🔔" }].map(t => (
              <button key={t.id} onClick={() => { setTab(t.id); setMenuOpen(false); }} style={{
                padding: "10px 14px", borderRadius: "10px", fontSize: "14px", fontWeight: 600,
                background: tab === t.id ? C.blueBg : "transparent",
                color: tab === t.id ? C.blue : C.text2, border: "none",
                textAlign: "left", cursor: "pointer",
              }}>{t.icon} {t.label}</button>
            ))}
          </div>
        )}
      </header>

      <PullToRefresh onRefresh={async () => {
        if (tab === "home") await fetchMarketOverview();
        else if (tab === "portfolio") await fetchPortfolioPrices();
        else if (tab === "news") await fetchNews();
        else window.location.reload();
      }}>
      <main style={{ maxWidth: "1080px", margin: "0 auto", padding: "16px 20px 24px" }}>

        {/* ═══════════════════════════════════════════════════════════
            TAB: 홈 (토스 스타일 — 깔끔하고 정보 밀도 최적화)
        ═══════════════════════════════════════════════════════════ */}
        {tab === "home" && (
          <div className="tab-content" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {/* 검색바 */}
            <SearchBar onSelect={(asset) => setSelectedAsset(asset)} />

            {/* 2컬럼 그리드 (데스크톱) / 1컬럼 (모바일) */}
            <div className="home-grid">
            <div className="home-left" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>

            {/* ── 마켓 서머리 배너 (토스 스타일 한줄 요약) ─── */}
            {marketIndices.length > 0 && (() => {
              const sp = marketIndices.find(i => i.symbol === "^GSPC");
              const nq = marketIndices.find(i => i.symbol === "^IXIC");
              const ks = marketIndices.find(i => i.symbol === "^KS11");
              const main = sp || nq;
              const mainName = sp ? "S&P 500" : "나스닥";
              const trend = main?.change > 1 ? "급등" : main?.change > 0.3 ? "상승" : main?.change > -0.3 ? "보합" : main?.change > -1 ? "하락" : "급락";
              const trendColor = main?.change > 0.3 ? C.green : main?.change > -0.3 ? C.text2 : C.red;
              const hour = new Date().getHours();
              const greeting = hour < 12 ? "오전" : hour < 18 ? "오후" : "저녁";
              const upCount = hotAssets.filter(h => h.change > 0).length;
              const dnCount = hotAssets.filter(h => h.change < 0).length;
              return (
                <div style={{
                  background: `linear-gradient(135deg, ${C.card} 0%, ${main?.change >= 0 ? C.greenBg : C.redBg} 100%)`,
                  borderRadius: "16px", padding: "18px 20px",
                }}>
                  <div style={{ fontSize: "13px", color: C.text3, marginBottom: "6px" }}>
                    {greeting} 마켓 브리핑
                  </div>
                  <div style={{ fontSize: "16px", fontWeight: 700, color: C.text1, lineHeight: 1.5, marginBottom: "8px" }}>
                    {mainName} <span style={{ color: trendColor }}>{main?.change >= 0 ? "+" : ""}{main?.change}% {trend}</span>
                    {ks && <span style={{ color: C.text3, fontSize: "13px" }}> · 코스피 {ks.change >= 0 ? "+" : ""}{ks.change}%</span>}
                  </div>
                  {/* 등락 비율 바 */}
                  {hotAssets.length > 0 && (
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <span style={{ fontSize: mf(11), color: C.green, fontWeight: 600 }}>{upCount}↑</span>
                      <div style={{ flex: 1, height: "4px", borderRadius: "2px", background: C.card2, overflow: "hidden", display: "flex" }}>
                        <div style={{ width: `${(upCount / Math.max(upCount + dnCount, 1)) * 100}%`, background: C.green, borderRadius: "2px 0 0 2px", transition: "width .5s ease" }} />
                        <div style={{ flex: 1, background: hotAssets.length > 0 ? C.red : C.card2, borderRadius: "0 2px 2px 0" }} />
                      </div>
                      <span style={{ fontSize: mf(11), color: C.red, fontWeight: 600 }}>{dnCount}↓</span>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* ── 시장 현황 (컴팩트 가로 스크롤) ─── */}
            <div style={{ borderRadius: "16px", overflow: "hidden" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <span style={{ fontWeight: 700, fontSize: "15px", color: C.text1 }}>시장 현황</span>
                  {marketIndices.length > 0 && (
                    <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: C.green, display: "inline-block", animation: "livePulse 1.5s ease-in-out infinite" }} />
                  )}
                </div>
                <button onClick={fetchMarketOverview} disabled={marketLoading} style={{
                  background: "none", border: "none", fontSize: "13px", color: C.text3, cursor: "pointer", padding: "4px 8px",
                }}>{marketLoading ? "..." : "새로고침"}</button>
              </div>
              {marketIndices.length === 0 ? (
                marketLoading ? (
                  <div style={{ display: "flex", gap: "8px", overflow: "auto" }}>
                    {[1,2,3,4].map(i => <div key={i} className="skeleton" style={{ minWidth: "120px", height: "64px", borderRadius: "12px", flexShrink: 0 }} />)}
                  </div>
                ) : null
              ) : (
                <div style={{ display: "flex", gap: "8px", overflow: "auto", paddingBottom: "4px", WebkitOverflowScrolling: "touch" }}>
                  {marketIndices.map(idx => (
                    <div key={idx.symbol} onClick={() => {
                      if (!idx.symbol.includes("=X")) setChartAsset({ symbol: idx.symbol, name: idx.name, market: "us", symbolRaw: idx.symbol });
                    }} style={{
                      minWidth: "110px", padding: "12px 14px", borderRadius: "12px", flexShrink: 0,
                      background: C.card, cursor: idx.symbol.includes("=X") ? "default" : "pointer",
                      transition: "transform .15s",
                    }}
                    onMouseEnter={e => { if (!idx.symbol.includes("=X")) e.currentTarget.style.transform = "scale(1.03)"; }}
                    onMouseLeave={e => e.currentTarget.style.transform = "scale(1)"}>
                      <div style={{ fontSize: mf(11), color: C.text3, marginBottom: "4px", whiteSpace: "nowrap" }}>{idx.flag} {idx.name}</div>
                      <div style={{ fontWeight: 700, fontSize: "14px", color: C.text1 }}>
                        {idx.name.includes("환율") ? `₩${Math.round(idx.price).toLocaleString()}` : idx.price.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </div>
                      <div style={{ fontSize: "12px", fontWeight: 600, color: idx.change >= 0 ? C.green : C.red }}>
                        {idx.change >= 0 ? "+" : ""}{idx.change}%
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* ── 투자 시그널 (컴팩트 2x2) ─── */}
            {marketIndices.length > 0 && (() => {
              const sp = marketIndices.find(i => i.symbol === "^GSPC");
              const nq = marketIndices.find(i => i.symbol === "^IXIC");
              const fx = marketIndices.find(i => i.symbol === "USDKRW=X");
              const avgChange = sp && nq ? (sp.change + nq.change) / 2 : sp?.change ?? nq?.change ?? 0;
              const direction = avgChange > 1 ? "강세" : avgChange > 0.2 ? "상승" : avgChange > -0.2 ? "보합" : avgChange > -1 ? "하락" : "급락";
              const dirColor = avgChange > 0.5 ? C.green : avgChange > -0.5 ? C.yellow : C.red;
              const fgVal = fearGreed.stock?.value;
              const fgColor = fgVal ? (fgVal <= 25 ? C.red : fgVal <= 40 ? "#FF8C42" : fgVal <= 60 ? C.yellow : fgVal <= 75 ? C.green : C.green) : C.text3;
              const fgLabel = fgVal ? (fgVal <= 25 ? "극도의 공포" : fgVal <= 40 ? "공포" : fgVal <= 60 ? "중립" : fgVal <= 75 ? "탐욕" : "극도의 탐욕") : "—";
              const topSec = sectorPerf[0];
              return (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                  <div style={{ background: C.card, borderRadius: "14px", padding: "14px" }}>
                    <div style={{ fontSize: mf(11), color: C.text3, marginBottom: "4px" }}>시장 방향</div>
                    <div style={{ fontSize: "18px", fontWeight: 800, color: dirColor }}>{direction}</div>
                    <div style={{ fontSize: mf(11), color: C.text3, marginTop: "2px" }}>
                      S&P {sp ? `${sp.change >= 0 ? "+" : ""}${sp.change}%` : "—"}
                    </div>
                  </div>
                  <div style={{ background: C.card, borderRadius: "14px", padding: "14px" }}>
                    <div style={{ fontSize: mf(11), color: C.text3, marginBottom: "4px" }}>투자심리</div>
                    <div style={{ fontSize: "18px", fontWeight: 800, color: fgColor }}>{fgVal ?? "—"}</div>
                    <div style={{ fontSize: mf(11), color: C.text3, marginTop: "2px" }}>{fgLabel}</div>
                  </div>
                  {fx && (
                    <div style={{ background: C.card, borderRadius: "14px", padding: "14px" }}>
                      <div style={{ fontSize: mf(11), color: C.text3, marginBottom: "4px" }}>원/달러</div>
                      <div style={{ fontSize: "18px", fontWeight: 800, color: C.text1 }}>₩{Math.round(fx.price).toLocaleString()}</div>
                      <div style={{ fontSize: mf(11), color: fx.change >= 0 ? C.red : C.green, marginTop: "2px" }}>
                        {fx.change >= 0 ? "+" : ""}{fx.change}%
                      </div>
                    </div>
                  )}
                  {topSec && (
                    <div style={{ background: C.card, borderRadius: "14px", padding: "14px" }}>
                      <div style={{ fontSize: mf(11), color: C.text3, marginBottom: "4px" }}>강세 섹터</div>
                      <div style={{ fontSize: "16px", fontWeight: 800, color: C.green }}>{topSec.icon} {topSec.name}</div>
                      <div style={{ fontSize: mf(11), color: C.text3, marginTop: "2px" }}>+{topSec.change1d}% 오늘</div>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* ── 오늘의 추천 ─── */}
            {dailyPicks.length > 0 && (
              <div style={{ background: C.card, borderRadius: "16px", padding: "16px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
                  <span style={{ fontWeight: 700, fontSize: "15px", color: C.text1 }}>오늘의 추천</span>
                  <button onClick={() => setPicksExpanded(!picksExpanded)} style={{
                    fontSize: mf(11), color: C.blue, background: "none", border: "none", cursor: "pointer", fontWeight: 600,
                  }}>{picksExpanded ? "접기" : `더보기 (${dailyPicks.length})`}</button>
                </div>
                <div style={{ display: "flex", flexDirection: "column" }}>
                  {dailyPicks.slice(0, picksExpanded ? 40 : 8).map((pick, i) => {
                    const flag = pick.market === "kr" ? "🇰🇷" : "🇺🇸";
                    const isPos = pick.change >= 0;
                    return (
                      <div key={pick.symbol} onClick={() => setSelectedAsset(pick)}
                        style={{
                          display: "flex", alignItems: "center", justifyContent: "space-between",
                          padding: "10px 4px", cursor: "pointer",
                          borderBottom: i < Math.min(dailyPicks.length, picksExpanded ? 40 : 8) - 1 ? `1px solid ${C.border}08` : "none",
                        }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "10px", flex: 1, minWidth: 0 }}>
                          <div style={{
                            width: "24px", height: "24px", borderRadius: "8px", flexShrink: 0,
                            background: i < 3 ? `${C.blue}18` : C.card2,
                            display: "flex", alignItems: "center", justifyContent: "center",
                            fontSize: mf(11), fontWeight: 800, color: i < 3 ? C.blue : C.text3,
                          }}>{i + 1}</div>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 600, fontSize: "13px", color: C.text1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{flag} {pick.name}</div>
                          </div>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
                          <span style={{
                            fontSize: mf(9), padding: "2px 6px", borderRadius: "4px", fontWeight: 600,
                            background: pick.score >= 7 ? C.greenBg : pick.score >= 5 ? C.blueBg : C.yellowBg,
                            color: pick.score >= 7 ? C.green : pick.score >= 5 ? C.blue : C.yellow,
                            whiteSpace: "nowrap", maxWidth: "90px", overflow: "hidden", textOverflow: "ellipsis",
                          }}>{pick.reason}</span>
                          <span style={{ fontSize: "12px", fontWeight: 600, color: isPos ? C.green : C.red, minWidth: "50px", textAlign: "right" }}>
                            {isPos ? "+" : ""}{pick.change}%
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── 주요 종목 (토스 스타일 리스트) ─── */}
            {hotAssets.length > 0 && (
              <div style={{ background: C.card, borderRadius: "16px", padding: "16px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
                  <span style={{ fontWeight: 700, fontSize: "15px", color: C.text1 }}>주요 종목</span>
                  <button onClick={() => setHotExpanded(!hotExpanded)} style={{
                    fontSize: mf(11), color: C.blue, background: "none", border: "none", cursor: "pointer", fontWeight: 600,
                  }}>{hotExpanded ? "접기" : `더보기 (${hotAssets.length})`}</button>
                </div>
                <div style={{ display: "flex", flexDirection: "column" }}>
                  {hotAssets.slice(0, hotExpanded ? 50 : 10).map((asset, i) => {
                    const flag = asset.market === "us" ? "🇺🇸" : asset.market === "kr" ? "🇰🇷" : "₿";
                    const isPos = asset.change >= 0;
                    const ext = extendedHours[asset.symbolRaw || asset.symbol];
                    return (
                      <div key={asset.symbol} onClick={() => setSelectedAsset(asset)}
                        style={{
                          display: "flex", alignItems: "center", justifyContent: "space-between",
                          padding: "11px 4px", cursor: "pointer",
                          borderBottom: i < (hotExpanded ? 49 : 9) ? `1px solid ${C.border}08` : "none",
                        }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "10px", flex: 1, minWidth: 0 }}>
                          <div style={{
                            width: "32px", height: "32px", borderRadius: "8px", flexShrink: 0,
                            background: asset.market === "us" ? `${C.blue}12` : asset.market === "kr" ? `${C.green}12` : `${C.purple}12`,
                            display: "flex", alignItems: "center", justifyContent: "center",
                            fontWeight: 800, fontSize: mf(9),
                            color: asset.market === "us" ? C.blue : asset.market === "kr" ? C.green : C.purple,
                          }}>{asset.symbol.replace(".KS","").slice(0,3)}</div>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 600, fontSize: "13px", color: C.text1 }}>{asset.name}</div>
                            <div style={{ fontSize: mf(11), color: C.text3 }}>{flag} {asset.symbol.replace(".KS","")}</div>
                          </div>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <div style={{ fontWeight: 600, fontSize: "14px", color: C.text1 }}>{fmtPrice(asset.price, asset.market)}</div>
                          <div style={{ display: "flex", alignItems: "center", gap: "4px", justifyContent: "flex-end" }}>
                            <span style={{ fontSize: "12px", fontWeight: 600, color: isPos ? C.green : C.red }}>
                              {isPos ? "+" : ""}{asset.change}%
                            </span>
                            {ext && (
                              <span style={{ fontSize: mf(9), color: C.purple, fontWeight: 600 }}>
                                {ext.isPreMarket ? "PRE" : "AH"} {ext.change != null ? `${ext.change >= 0 ? "+" : ""}${ext.change.toFixed(1)}%` : ""}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── 급등/급락 TOP (토스 스타일) ─── */}
            {hotAssets.length >= 4 && (() => {
              const sorted = [...hotAssets].sort((a, b) => b.change - a.change);
              const topGainers = sorted.slice(0, 3);
              const topLosers = sorted.slice(-3).reverse();
              return (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                  {/* 급등 */}
                  <div style={{ background: C.card, borderRadius: "16px", padding: "14px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "4px", marginBottom: "10px" }}>
                      <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: C.green }} />
                      <span style={{ fontWeight: 700, fontSize: "13px", color: C.text1 }}>급등</span>
                    </div>
                    {topGainers.map((a, i) => (
                      <div key={a.symbol} onClick={() => setSelectedAsset(a)} style={{
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        padding: "6px 0", cursor: "pointer",
                        borderBottom: i < 2 ? `1px solid ${C.border}10` : "none",
                      }}>
                        <span style={{ fontSize: "12px", fontWeight: 600, color: C.text1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "70px" }}>{a.name}</span>
                        <span style={{ fontSize: "12px", fontWeight: 700, color: C.green }}>+{a.change}%</span>
                      </div>
                    ))}
                  </div>
                  {/* 급락 */}
                  <div style={{ background: C.card, borderRadius: "16px", padding: "14px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "4px", marginBottom: "10px" }}>
                      <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: C.red }} />
                      <span style={{ fontWeight: 700, fontSize: "13px", color: C.text1 }}>급락</span>
                    </div>
                    {topLosers.map((a, i) => (
                      <div key={a.symbol} onClick={() => setSelectedAsset(a)} style={{
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        padding: "6px 0", cursor: "pointer",
                        borderBottom: i < 2 ? `1px solid ${C.border}10` : "none",
                      }}>
                        <span style={{ fontSize: "12px", fontWeight: 600, color: C.text1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "70px" }}>{a.name}</span>
                        <span style={{ fontSize: "12px", fontWeight: 700, color: C.red }}>{a.change}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            </div>{/* end home-left */}
            <div className="home-right" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>

            {/* ── 관심종목 ─── */}
            <div style={{ background: C.card, borderRadius: "16px", padding: "16px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: watchlist.length > 0 ? "10px" : "0" }}>
                <span style={{ fontWeight: 700, fontSize: "15px", color: C.text1 }}>관심종목</span>
                <SearchBar compact placeholder="+ 종목 추가" onSelect={(asset) => {
                  if (!watchlist.some(w => w.symbol === asset.symbol)) {
                    setWatchlist(prev => [...prev, { symbol: asset.symbol, name: asset.name, market: asset.market, symbolRaw: asset.symbolRaw || asset.symbol, id: asset.id }]);
                  }
                }} />
              </div>
              {watchlist.length === 0 ? (
                <div style={{ textAlign: "center", padding: "16px 0 8px", color: C.text3, fontSize: "13px" }}>
                  검색으로 관심종목을 추가해보세요
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column" }}>
                  {watchlist.map(w => {
                    const hot = hotAssets.find(h => h.symbol === w.symbol || h.symbol === w.symbolRaw);
                    const ext = extendedHours[w.symbolRaw || w.symbol];
                    const flag = w.market === "us" ? "🇺🇸" : w.market === "kr" ? "🇰🇷" : "₿";
                    return (
                      <div key={w.symbol} onClick={() => setSelectedAsset(w)}
                        style={{
                          display: "flex", alignItems: "center", justifyContent: "space-between",
                          padding: "10px 4px", cursor: "pointer",
                          borderBottom: `1px solid ${C.border}08`,
                        }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "10px", flex: 1, minWidth: 0 }}>
                          <span style={{ fontSize: mf(11) }}>{flag}</span>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 600, fontSize: "13px", color: C.text1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{w.name || w.symbol}</div>
                          </div>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          {hot && (
                            <div style={{ textAlign: "right" }}>
                              <div style={{ fontWeight: 600, fontSize: "13px", color: C.text1 }}>{fmtPrice(hot.price, w.market)}</div>
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
                            style={{ width: "20px", height: "20px", borderRadius: "50%", border: "none",
                              background: "transparent", color: C.text3, fontSize: mf(10), cursor: "pointer",
                              display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, opacity: 0.5,
                            }}>✕</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* ── 관심종목 퀀트 전략 (quickDiagnosis 기반) ─── */}
            {watchlist.length > 0 && hotAssets.length > 0 && (() => {
              const watchDiags = watchlist.map(w => {
                const hot = hotAssets.find(h => h.symbol === w.symbol || h.symbol === w.symbolRaw);
                if (!hot) return null;
                const d = quickDiagnosis(hot);
                return { ...w, ...hot, diag: d };
              }).filter(Boolean).sort((a, b) => b.diag.score - a.diag.score);
              if (!watchDiags.length) return null;
              return (
                <div style={{ background: C.card, borderRadius: "16px", padding: "16px" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
                    <span style={{ fontWeight: 700, fontSize: "15px", color: C.text1 }}>관심종목 퀀트 전략</span>
                    <span style={{ fontSize: mf(10), color: C.text3 }}>자동 분석</span>
                  </div>
                  {watchDiags.map((w, i) => {
                    const d = w.diag;
                    const opColor = d.opinionColor === "green" ? C.green : d.opinionColor === "red" ? C.red : C.yellow;
                    return (
                      <div key={w.symbol} onClick={() => setSelectedAsset(w)} style={{
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        padding: "10px 4px", cursor: "pointer",
                        borderBottom: i < watchDiags.length - 1 ? `1px solid ${C.border}08` : "none",
                      }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "10px", flex: 1, minWidth: 0 }}>
                          <div style={{
                            width: "28px", height: "28px", borderRadius: "50%", flexShrink: 0,
                            background: `${opColor}18`, display: "flex", alignItems: "center", justifyContent: "center",
                            fontSize: "12px", fontWeight: 800, color: opColor,
                          }}>{d.score}</div>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 600, fontSize: "13px", color: C.text1 }}>{w.name}</div>
                            <div style={{ fontSize: mf(10), color: C.text3 }}>{d.rationale}</div>
                          </div>
                        </div>
                        <span style={{
                          fontSize: "11px", fontWeight: 700, padding: "3px 10px", borderRadius: "6px",
                          background: `${opColor}18`, color: opColor, whiteSpace: "nowrap",
                        }}>{d.opinion}</span>
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

              const mktVerdict = mktScore >= 70 ? "강세" : mktScore >= 55 ? "약 강세" : mktScore >= 45 ? "혼조" : mktScore >= 30 ? "약세" : "강한 약세";
              const mktColor = mktScore >= 60 ? C.green : mktScore >= 45 ? C.yellow : C.red;
              const now = new Date();
              const reportTime = now.toLocaleString("ko-KR", { hour: "2-digit", minute: "2-digit" });

              return (
                <div onClick={() => setTab("quant-report")} style={{ background: `linear-gradient(135deg, ${C.card}, ${mktScore >= 55 ? "#0d2818" : mktScore < 45 ? "#28100d" : "#1a1a0d"})`, borderRadius: "16px", padding: "16px", cursor: "pointer" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
                    <span style={{ fontWeight: 700, fontSize: "15px", color: C.text1 }}>퀀트 리포트</span>
                    <span style={{ fontSize: mf(10), color: C.text3 }}>{reportTime} 기준 →</span>
                  </div>

                  {/* 시장 점수 게이지 */}
                  <div style={{ display: "flex", alignItems: "center", gap: "14px", marginBottom: "14px" }}>
                    <div style={{ position: "relative", width: "56px", height: "56px", flexShrink: 0 }}>
                      <svg viewBox="0 0 56 56" width="56" height="56">
                        <circle cx="28" cy="28" r="23" fill="none" stroke={C.border} strokeWidth="4" />
                        <circle cx="28" cy="28" r="23" fill="none" stroke={mktColor} strokeWidth="4" strokeLinecap="round"
                          strokeDasharray={`${(mktScore / 100) * 144.5} 144.5`} transform="rotate(-90 28 28)" />
                        <text x="28" y="26" textAnchor="middle" fill={C.text1} fontSize="14" fontWeight="800">{mktScore}</text>
                        <text x="28" y="36" textAnchor="middle" fill={C.text3} fontSize="7">/100</text>
                      </svg>
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: "16px", fontWeight: 800, color: mktColor, marginBottom: "4px" }}>{mktVerdict}</div>
                      <div style={{ fontSize: "11px", color: C.text3, lineHeight: 1.5 }}>
                        {sp ? `S&P ${sp.change >= 0 ? "+" : ""}${sp.change}%` : ""}{nq ? ` · 나스닥 ${nq.change >= 0 ? "+" : ""}${nq.change}%` : ""}
                        {ks ? ` · 코스피 ${ks.change >= 0 ? "+" : ""}${ks.change}%` : ""}
                      </div>
                    </div>
                  </div>

                  {/* 지표 그리드 */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px", marginBottom: "10px" }}>
                    <div style={{ padding: "8px 10px", borderRadius: "8px", background: `${C.green}10` }}>
                      <div style={{ fontSize: mf(10), color: C.text3, marginBottom: "2px" }}>상승 종목</div>
                      <div style={{ fontSize: "14px", fontWeight: 700, color: C.green }}>{upCount}개 <span style={{ fontSize: "10px", color: C.text3 }}>/ {hotAssets.length}</span></div>
                    </div>
                    <div style={{ padding: "8px 10px", borderRadius: "8px", background: `${C.red}10` }}>
                      <div style={{ fontSize: mf(10), color: C.text3, marginBottom: "2px" }}>하락 종목</div>
                      <div style={{ fontSize: "14px", fontWeight: 700, color: C.red }}>{dnCount}개 <span style={{ fontSize: "10px", color: C.text3 }}>/ {hotAssets.length}</span></div>
                    </div>
                    <div style={{ padding: "8px 10px", borderRadius: "8px", background: `${C.yellow}10` }}>
                      <div style={{ fontSize: mf(10), color: C.text3, marginBottom: "2px" }}>공포탐욕</div>
                      <div style={{ fontSize: "14px", fontWeight: 700, color: fg ? (fg > 60 ? C.green : fg > 40 ? C.yellow : C.red) : C.text3 }}>{fg || "—"} <span style={{ fontSize: "10px", color: C.text3 }}>{fg ? (fg <= 25 ? "극도의 공포" : fg <= 40 ? "공포" : fg <= 60 ? "중립" : fg <= 75 ? "탐욕" : "극도의 탐욕") : ""}</span></div>
                    </div>
                    <div style={{ padding: "8px 10px", borderRadius: "8px", background: `${C.blue}10` }}>
                      <div style={{ fontSize: mf(10), color: C.text3, marginBottom: "2px" }}>추천 매수</div>
                      <div style={{ fontSize: "14px", fontWeight: 700, color: C.blue }}>{buyPicks}개 <span style={{ fontSize: "10px", color: C.text3 }}>/ {dailyPicks.length} 분석</span></div>
                    </div>
                  </div>

                  {/* 요약 */}
                  <div style={{ fontSize: "11px", color: C.text3, lineHeight: 1.6, padding: "8px 0 0", borderTop: `1px solid ${C.border}` }}>
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
                <div onClick={() => setTab("portfolio")} style={{
                  background: C.card, borderRadius: "16px", padding: "18px 20px", cursor: "pointer",
                  transition: "transform .15s",
                }}
                onMouseEnter={e => e.currentTarget.style.transform = "translateY(-1px)"}
                onMouseLeave={e => e.currentTarget.style.transform = "translateY(0)"}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
                    <span style={{ fontWeight: 700, fontSize: "15px", color: C.text1 }}>내 포트폴리오</span>
                    <span style={{ fontSize: "12px", color: C.text3 }}>{portfolio.length}개 →</span>
                  </div>
                  {totalValue > 0 ? (
                    <div style={{ display: "flex", alignItems: "baseline", gap: "10px", flexWrap: "wrap" }}>
                      <span style={{ fontWeight: 800, fontSize: "22px", color: C.text1, letterSpacing: "-0.5px" }}>
                        {currency === "KRW" ? `₩${Math.round(totalValue * krwRate).toLocaleString()}` : `$${totalValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
                      </span>
                      <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                        <span style={{ fontSize: "13px", fontWeight: 700, color: pnl >= 0 ? C.green : C.red }}>
                          {pnl >= 0 ? "+" : ""}{pnl.toFixed(2)}%
                        </span>
                        <span style={{ fontSize: "11px", color: C.text3 }}>
                          ({pnlAmt >= 0 ? "+" : ""}{currency === "KRW" ? `₩${Math.round(Math.abs(pnlAmt) * krwRate).toLocaleString()}` : `$${Math.abs(pnlAmt).toLocaleString(undefined, { maximumFractionDigits: 0 })}`})
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div style={{ fontSize: "13px", color: C.text3 }}>가격 로딩 중...</div>
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
                <div style={{ background: C.card, borderRadius: "16px", padding: "16px" }}>
                  {/* 헤더 */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
                    <span style={{ fontWeight: 700, fontSize: "15px", color: C.text1 }}>경제 캘린더 <span style={{ fontSize: "10px", fontWeight: 500, color: C.text3 }}>(KST)</span></span>
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
                    display: "grid", gridTemplateColumns: "90px 1fr 48px 48px 48px",
                    gap: "4px", padding: "6px 6px", marginBottom: "2px",
                    fontSize: mf(10), fontWeight: 700, color: C.text3, letterSpacing: "0.02em",
                    borderBottom: `1px solid ${C.border}20`,
                  }}>
                    <span>날짜</span>
                    <span>이벤트</span>
                    <span style={{ textAlign: "right" }}>실제</span>
                    <span style={{ textAlign: "right" }}>예상</span>
                    <span style={{ textAlign: "right" }}>이전</span>
                  </div>

                  {/* 이벤트 리스트 */}
                  {showEvents.length === 0 ? (
                    <div style={{ textAlign: "center", padding: "20px", color: C.text3, fontSize: "12px" }}>
                      해당 필터에 맞는 이벤트가 없습니다
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column" }}>
                      {showEvents.map((evt, i) => {
                        const statusColor = evt.status === "오늘" ? C.red : evt.status === "임박" ? C.yellow : evt.status === "완료" || evt.status === "어제" ? C.text3 : C.text2;
                        const beat = evt.actual != null && evt.estimate != null ? evt.actual > evt.estimate : null;
                        const miss = evt.actual != null && evt.estimate != null ? evt.actual < evt.estimate : null;
                        const isPast = evt.daysUntil < 0;
                        // 한국 시간 기준 날짜 표시
                        const kstStr = evt.date.toLocaleString("en-US", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false });
                        const kstDate = new Date(evt.date.toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
                        const y = kstDate.getFullYear();
                        const m = String(kstDate.getMonth() + 1).padStart(2, "0");
                        const d = String(kstDate.getDate()).padStart(2, "0");
                        const dayName = ["일","월","화","수","목","금","토"][kstDate.getDay()];
                        const kstHour = String(kstDate.getHours()).padStart(2, "0");
                        const kstMin = String(kstDate.getMinutes()).padStart(2, "0");

                        return (
                          <div key={`${evt.event}-${y}${m}${d}-${i}`} style={{
                            display: "grid", gridTemplateColumns: "90px 1fr 48px 48px 48px",
                            gap: "6px", alignItems: "center",
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
                              <div style={{ fontSize: "12px", fontWeight: 700, color: C.text1, fontVariantNumeric: "tabular-nums" }}>
                                {y}.{m}.{d}
                              </div>
                              <div style={{ display: "flex", alignItems: "center", gap: "4px", marginTop: "1px" }}>
                                <span style={{ fontSize: mf(10), color: C.text3 }}>{dayName} {kstHour}:{kstMin}</span>
                                <span style={{
                                  fontSize: "8px", fontWeight: 700, padding: "1px 4px", borderRadius: "3px",
                                  background: evt.status === "오늘" ? C.redBg : evt.status === "임박" ? C.yellowBg : evt.status === "예정" ? C.blueBg : C.card2,
                                  color: evt.status === "오늘" ? C.red : evt.status === "임박" ? C.yellow : evt.status === "예정" ? C.blue : C.text3,
                                }}>{evt.status}</span>
                              </div>
                            </div>

                            {/* 이벤트명 + 아이콘 */}
                            <div style={{ minWidth: 0, overflow: "hidden" }}>
                              <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                                <span style={{ fontSize: "13px", flexShrink: 0 }}>{evt.icon}</span>
                                <span style={{
                                  fontWeight: 600, fontSize: "12px", color: C.text1,
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
                                <div style={{
                                  fontSize: "12px", fontWeight: 700, fontVariantNumeric: "tabular-nums",
                                  color: beat ? C.green : miss ? C.red : C.text1,
                                }}>
                                  {evt.actual}{evt.unit}
                                  {beat && <span style={{ fontSize: mf(9), marginLeft: "1px" }}>▲</span>}
                                  {miss && <span style={{ fontSize: mf(9), marginLeft: "1px" }}>▼</span>}
                                </div>
                              ) : (
                                <span style={{ fontSize: mf(11), color: C.text3 }}>—</span>
                              )}
                            </div>

                            {/* 예상 */}
                            <div style={{ textAlign: "right" }}>
                              {evt.estimate != null ? (
                                <span style={{ fontSize: "12px", color: C.text2, fontVariantNumeric: "tabular-nums" }}>
                                  {evt.estimate}{evt.unit}
                                </span>
                              ) : (
                                <span style={{ fontSize: mf(11), color: C.text3 }}>—</span>
                              )}
                            </div>

                            {/* 이전 */}
                            <div style={{ textAlign: "right" }}>
                              {evt.previous != null ? (
                                <span style={{ fontSize: "12px", color: C.text3, fontVariantNumeric: "tabular-nums" }}>
                                  {evt.previous}{evt.unit}
                                </span>
                              ) : (
                                <span style={{ fontSize: mf(11), color: C.text3 }}>—</span>
                              )}
                            </div>
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
                        fontSize: "11px", fontWeight: 600, color: C.text2, cursor: "pointer",
                      }}>+ {filteredEconEvents.length - 6}개 더 보기</button>
                    </div>
                  )}
                </div>
              );
            })()}

            </div>{/* end home-right */}
            </div>{/* end home-grid */}

            {/* ═══ 하단 전체너비 섹션 (그리드 밖) ═══ */}

            {/* ── 섹터 히트맵 (접기/펼치기) ─── */}
            {sectorPerf.length > 0 && (
              <div style={{ background: C.card, borderRadius: "16px", padding: "16px" }}>
                <div onClick={() => toggleSection("sector")} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}>
                  <span style={{ fontWeight: 700, fontSize: "15px", color: C.text1 }}>섹터 성과</span>
                  <span style={{ fontSize: "12px", color: C.text3 }}>{homeSection.sector ? "▲" : "▼"}</span>
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
                          <div style={{ fontSize: "14px" }}>{sec.icon}</div>
                          <div style={{ fontSize: mf(10), fontWeight: 600, color: C.text2, margin: "2px 0" }}>{sec.name}</div>
                          <div style={{ fontSize: "13px", fontWeight: 800, color: sec.change1d >= 0 ? C.green : C.red }}>
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
            <div style={{ background: C.card, borderRadius: "16px", padding: "16px" }}>
              <div onClick={() => toggleSection("allAssets")} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}>
                <span style={{ fontWeight: 700, fontSize: "15px", color: C.text1 }}>전체 종목</span>
                <span style={{ fontSize: "12px", color: C.text3 }}>{ALL_ASSETS.length}개 {homeSection.allAssets ? "▲" : "▼"}</span>
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
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: "4px", maxHeight: "280px", overflow: "auto" }}>
                    {ALL_ASSETS.filter(a => filterMarket === "all" || a.market === filterMarket).map((asset, i) => {
                      const flag = asset.market === "us" ? "🇺🇸" : asset.market === "kr" ? "🇰🇷" : "₿";
                      return (
                        <div key={`${asset.symbol}-${i}`} onClick={() => setSelectedAsset(asset)}
                          style={{
                            padding: "8px 10px", borderRadius: "8px", cursor: "pointer",
                            display: "flex", alignItems: "center", gap: "6px", transition: "background .15s",
                          }}
                          onMouseEnter={e => e.currentTarget.style.background = C.card2}
                          onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                          <span style={{ fontSize: mf(11) }}>{flag}</span>
                          <div style={{ minWidth: 0, overflow: "hidden" }}>
                            <div style={{ fontWeight: 600, fontSize: "12px", color: C.text1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{asset.name}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════
            TAB: 스크리너
        ═══════════════════════════════════════════════════════════ */}
        {tab === "screener" && (
          <div className="tab-content">
            {/* 조건 선택 패널 */}
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "16px", padding: "20px", marginBottom: "16px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "14px" }}>
                <div style={{ fontWeight: 700, fontSize: "15px" }}>⚙️ 스크리닝 옵션</div>
                <div style={{ display: "flex", gap: "6px" }}>
                  {["or", "and"].map(m => (
                    <button key={m} onClick={() => setMode(m)} style={{
                      padding: "5px 12px", borderRadius: "8px", fontSize: "12px", fontWeight: 700,
                      background: mode === m ? C.blue : C.card2, color: mode === m ? "#fff" : C.text3,
                      border: `1px solid ${mode === m ? C.blue : C.border2}`,
                    }}>{m.toUpperCase()}</button>
                  ))}
                </div>
              </div>

              {/* 모멘텀 & 추세 */}
              <div style={{ fontSize: "10px", color: C.text3, fontWeight: 600, letterSpacing: ".05em", marginBottom: "8px", marginTop: "12px" }}>모멘텀 & 추세</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "7px", marginBottom: "14px" }}>
                {["rsi_extreme","macd_divergence","ma_ribbon","adx_trend"].map(key => {
                  const meta = CONDITION_META[key];
                  const on = conditions.includes(key);
                  return (
                    <button key={key} onClick={() => setConditions(p => on ? p.filter(c => c !== key) : [...p, key])}
                      title={meta?.desc} style={{
                        padding: "6px 12px", borderRadius: "10px", fontSize: "12px", fontWeight: 600,
                        background: on ? `${C.blue}22` : C.card2, color: on ? C.blue : C.text3,
                        border: `1px solid ${on ? C.blue : C.border2}`,
                      }}>{meta?.icon} {meta?.label}</button>
                  );
                })}
              </div>

              {/* 변동성 & 가격 구조 */}
              <div style={{ fontSize: "10px", color: C.text3, fontWeight: 600, letterSpacing: ".05em", marginBottom: "8px", marginTop: "12px" }}>변동성 & 가격 구조</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "7px", marginBottom: "14px" }}>
                {["bb_squeeze","atr_breakout","price_channel","gap_signal"].map(key => {
                  const meta = CONDITION_META[key];
                  const on = conditions.includes(key);
                  return (
                    <button key={key} onClick={() => setConditions(p => on ? p.filter(c => c !== key) : [...p, key])}
                      title={meta?.desc} style={{
                        padding: "6px 12px", borderRadius: "10px", fontSize: "12px", fontWeight: 600,
                        background: on ? `${C.red}22` : C.card2, color: on ? C.red : C.text3,
                        border: `1px solid ${on ? C.red : C.border2}`,
                      }}>{meta?.icon} {meta?.label}</button>
                  );
                })}
              </div>

              {/* 수급 & 거래량 */}
              <div style={{ fontSize: "10px", color: C.text3, fontWeight: 600, letterSpacing: ".05em", marginBottom: "8px", marginTop: "12px" }}>수급 & 거래량</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "7px", marginBottom: "14px" }}>
                {["volume_climax","obv_divergence","volume_dry"].map(key => {
                  const meta = CONDITION_META[key];
                  const on = conditions.includes(key);
                  return (
                    <button key={key} onClick={() => setConditions(p => on ? p.filter(c => c !== key) : [...p, key])}
                      title={meta?.desc} style={{
                        padding: "6px 12px", borderRadius: "10px", fontSize: "12px", fontWeight: 600,
                        background: on ? `${C.yellow}22` : C.card2, color: on ? C.yellow : C.text3,
                        border: `1px solid ${on ? C.yellow : C.border2}`,
                      }}>{meta?.icon} {meta?.label}</button>
                  );
                })}
              </div>

              {/* 구조적 시그널 */}
              <div style={{ fontSize: "10px", color: C.text3, fontWeight: 600, letterSpacing: ".05em", marginBottom: "8px", marginTop: "12px" }}>구조적 시그널</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "7px", marginBottom: "18px" }}>
                {["near_52w_low","near_52w_high","death_cross","golden_cross","mean_reversion"].map(key => {
                  const meta = CONDITION_META[key];
                  const on = conditions.includes(key);
                  return (
                    <button key={key} onClick={() => setConditions(p => on ? p.filter(c => c !== key) : [...p, key])}
                      title={meta?.desc} style={{
                        padding: "6px 12px", borderRadius: "10px", fontSize: "12px", fontWeight: 600,
                        background: on ? `${C.green}22` : C.card2, color: on ? C.green : C.text3,
                        border: `1px solid ${on ? C.green : C.border2}`,
                      }}>{meta?.icon} {meta?.label}</button>
                  );
                })}
              </div>

              {conditions.length === 0 && !scanning && !results.length && (
                <div style={{
                  textAlign: "center", padding: "14px", borderRadius: "10px", marginBottom: "10px",
                  background: C.blueBg, border: `1px solid ${C.blue}33`, fontSize: "13px", color: C.blue,
                }}>
                  💡 위에서 스크리닝 조건을 1개 이상 선택한 후 스캔을 시작하세요
                </div>
              )}
              <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
                <button onClick={runScan} disabled={scanning || conditions.length === 0} style={{
                  padding: "11px 24px", borderRadius: "12px", fontSize: "14px", fontWeight: 700,
                  background: scanning ? C.card2 : conditions.length === 0 ? C.card2 : C.blue,
                  color: scanning || conditions.length === 0 ? C.text3 : "#fff", border: "none",
                  minWidth: "120px", opacity: conditions.length === 0 ? 0.6 : 1,
                }}>
                  {scanning
                    ? <span style={{ display: "flex", alignItems: "center", gap: "8px", justifyContent: "center" }}>
                        <span style={{ animation: "pulse 1s infinite" }}>⏳</span> {scanProgress.done}/{scanProgress.total}
                      </span>
                    : `🔍 스캔 시작 ${conditions.length > 0 ? `(${conditions.length}개 조건)` : ""}`}
                </button>
                {scanning && (
                  <div style={{ flex: 1, minWidth: "120px" }}>
                    <div style={{ height: "4px", background: C.border2, borderRadius: "2px", overflow: "hidden" }}>
                      <div style={{
                        height: "100%", background: C.blue, borderRadius: "2px",
                        width: `${scanProgress.total ? (scanProgress.done / scanProgress.total) * 100 : 0}%`, transition: "width .3s",
                      }} />
                    </div>
                  </div>
                )}
                {lastScan && !scanning && (
                  <span style={{ fontSize: "12px", color: C.text3 }}>마지막: {lastScan.toLocaleTimeString("ko-KR")}</span>
                )}
              </div>

              {scanErrors.length > 0 && (
                <details style={{ marginTop: "10px" }}>
                  <summary style={{ fontSize: "12px", color: C.text3, cursor: "pointer" }}>⚠️ {scanErrors.length}개 오류</summary>
                  <div style={{ marginTop: "6px", fontSize: "11px", color: C.red, lineHeight: 1.6, maxHeight: "80px", overflow: "auto" }}>
                    {scanErrors.map((e, i) => <div key={i}>{e}</div>)}
                  </div>
                </details>
              )}
            </div>

            {/* 결과 필터 */}
            {results.length > 0 && (
              <div style={{ display: "flex", gap: "7px", alignItems: "center", marginBottom: "12px", flexWrap: "wrap" }}>
                <span style={{ fontSize: "13px", color: C.text2, fontWeight: 600 }}>🎯 {filtered.length}개</span>
                {["all","us","kr","crypto"].map(m => (
                  <button key={m} onClick={() => setFilterMarket(m)} style={{
                    padding: "4px 10px", borderRadius: "8px", fontSize: "12px", fontWeight: 600,
                    background: filterMarket === m ? C.blueBg : "transparent",
                    color: filterMarket === m ? C.blue : C.text3, border: `1px solid ${filterMarket === m ? C.blue : C.border2}`,
                  }}>{m === "all" ? "전체" : m === "us" ? "🇺🇸 미국" : m === "kr" ? "🇰🇷 한국" : "₿ 크립토"}</button>
                ))}
                <div style={{ marginLeft: "auto", display: "flex", gap: "5px", alignItems: "center" }}>
                  <span style={{ fontSize: "11px", color: C.text3 }}>정렬</span>
                  {[["rsi","RSI"], ["change","변동률"], ["vol","거래량"], ["signals","시그널"]].map(([v, l]) => (
                    <button key={v} onClick={() => setSortBy(v)} style={{
                      padding: "3px 8px", borderRadius: "6px", fontSize: "11px", fontWeight: 600,
                      background: sortBy === v ? C.blueBg : "transparent", color: sortBy === v ? C.blue : C.text3,
                      border: `1px solid ${sortBy === v ? C.blue : C.border2}`,
                    }}>{l}</button>
                  ))}
                </div>
              </div>
            )}

            {/* 대기 상태 */}
            {!scanning && results.length === 0 && (
              <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "16px", padding: "48px 24px", textAlign: "center" }}>
                <div style={{ fontSize: "44px", marginBottom: "16px" }}>{lastScan ? "🔍" : "📡"}</div>
                <div style={{ fontWeight: 700, fontSize: "18px", marginBottom: "8px" }}>
                  {lastScan ? "시그널 없음" : "스캔 대기 중"}
                </div>
                <div style={{ color: C.text3, fontSize: "14px", lineHeight: 1.7 }}>
                  {lastScan ? (
                    <>선택한 조건에 해당하는 종목이 없습니다<br />조건을 변경하거나 OR 모드를 사용해보세요</>
                  ) : (
                    <>조건 선택 후 <strong style={{ color: C.blue }}>스캔 시작</strong>을 눌러주세요<br />
                    미국 · 한국 주식 + 크립토 {US_ASSETS.length + KR_ASSETS.length + CRYPTO_ASSETS.length}개 자산 분석</>
                  )}
                </div>
                {lastScan && (
                  <div style={{ fontSize: "11px", color: C.text3, marginTop: "12px" }}>
                    마지막 스캔: {lastScan.toLocaleTimeString("ko-KR")}
                    {scanErrors.length > 0 && <span style={{ color: C.yellow, marginLeft: "8px" }}>⚠️ {scanErrors.length}건 오류</span>}
                  </div>
                )}
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {filtered.map((asset, i) => (
                <AssetCard key={`${asset.symbol}-${i}`} asset={asset} onChart={() => setChartAsset(asset)} />
              ))}
            </div>

            {!scanning && results.length > 0 && filtered.length === 0 && (
              <div style={{ background: C.card, borderRadius: "16px", padding: "32px", textAlign: "center" }}>
                <div style={{ fontSize: "32px", marginBottom: "8px" }}>🏷️</div>
                <div style={{ fontWeight: 600, fontSize: "14px", color: C.text2, marginBottom: "4px" }}>선택한 시장에 시그널 없음</div>
                <div style={{ fontSize: "12px", color: C.text3 }}>다른 시장 필터를 선택해보세요 (전체 {results.length}건 발견)</div>
              </div>
            )}

            {/* ═══════════════════════════════════════════════════════
                저평가 종목 통합 조회
            ═══════════════════════════════════════════════════════ */}
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "16px", padding: "20px", marginTop: "20px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "14px", flexWrap: "wrap", gap: "8px" }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: "15px", marginBottom: "2px" }}>💎 저평가 종목 통합 조회</div>
                  <div style={{ fontSize: "11px", color: C.text3 }}>PER · PBR · 배당률 · 애널리스트 목표가 · 52주 위치 종합 분석</div>
                </div>
                <button onClick={runValueScan} disabled={valueScanning} style={{
                  padding: "10px 20px", borderRadius: "12px", fontSize: "13px", fontWeight: 700,
                  background: valueScanning ? C.card2 : C.green, color: valueScanning ? C.text3 : "#fff",
                  border: "none", whiteSpace: "nowrap",
                }}>
                  {valueScanning
                    ? <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <span style={{ animation: "pulse 1s infinite" }}>⏳</span> {valueScanProgress.done}/{valueScanProgress.total}
                      </span>
                    : "💎 저평가 스캔"}
                </button>
              </div>

              {valueScanning && (
                <div style={{ height: "4px", background: C.border2, borderRadius: "2px", overflow: "hidden", marginBottom: "12px" }}>
                  <div style={{
                    height: "100%", background: C.green, borderRadius: "2px",
                    width: `${valueScanProgress.total ? (valueScanProgress.done / valueScanProgress.total) * 100 : 0}%`,
                    transition: "width .3s",
                  }} />
                </div>
              )}

              {valueLastScan && !valueScanning && (
                <div style={{ fontSize: "11px", color: C.text3, marginBottom: "10px" }}>
                  마지막 스캔: {valueLastScan.toLocaleTimeString("ko-KR")} · 전체 {valueResults.length}개 분석 · 저평가 {filteredValue.length}개 발견
                </div>
              )}

              {/* 필터 + 정렬 */}
              {valueResults.length > 0 && (
                <div style={{ display: "flex", gap: "6px", alignItems: "center", marginBottom: "12px", flexWrap: "wrap" }}>
                  {[["all","전체"], ["us","🇺🇸 미국"], ["kr","🇰🇷 한국"]].map(([v, l]) => (
                    <button key={v} onClick={() => setValueFilter(v)} style={{
                      padding: "4px 10px", borderRadius: "8px", fontSize: "12px", fontWeight: 600,
                      background: valueFilter === v ? C.greenBg : "transparent",
                      color: valueFilter === v ? C.green : C.text3, border: `1px solid ${valueFilter === v ? C.green : C.border2}`,
                    }}>{l}</button>
                  ))}
                  <div style={{ marginLeft: "auto", display: "flex", gap: "4px", alignItems: "center" }}>
                    <span style={{ fontSize: "11px", color: C.text3 }}>정렬</span>
                    {[["score","종합"], ["per","PER↑"], ["pbr","PBR↑"], ["div","배당↓"], ["upside","목표가↓"]].map(([v, l]) => (
                      <button key={v} onClick={() => setValueSortBy(v)} style={{
                        padding: "3px 7px", borderRadius: "6px", fontSize: "10px", fontWeight: 600,
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
                      <div key={s.symbol} onClick={() => setSelectedAsset({ symbol: s.symbol, name: s.name })} style={{
                        background: C.card2, borderRadius: "12px", padding: "12px 14px",
                        border: `1px solid ${C.border}`, cursor: "pointer", transition: "all .15s",
                      }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                            <span style={{ fontSize: "12px", fontWeight: 700, color: C.text3, minWidth: "20px" }}>{i + 1}</span>
                            <span style={{ fontSize: "11px" }}>{s.market === "us" ? "🇺🇸" : "🇰🇷"}</span>
                            <span style={{ fontWeight: 700, fontSize: "13px", color: C.text1 }}>{s.name}</span>
                            <span style={{ fontSize: "11px", color: C.text3 }}>{s.symbol.replace(".KS","").replace(".KQ","")}</span>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                            <span style={{ fontSize: "13px", fontWeight: 700, color: C.text1 }}>
                              {s.market === "kr" ? `₩${Math.round(s.price).toLocaleString()}` : `$${s.price?.toFixed(2)}`}
                            </span>
                            <span style={{
                              padding: "2px 8px", borderRadius: "6px", fontSize: "11px", fontWeight: 700,
                              background: `${scoreColor}22`, color: scoreColor,
                            }}>{s.score}점</span>
                          </div>
                        </div>
                        {/* 지표 행 */}
                        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "4px" }}>
                          {s.per != null && (
                            <span style={{ fontSize: "10px", padding: "2px 6px", borderRadius: "4px", background: s.per < 12 ? `${C.green}18` : s.per < 20 ? `${C.blue}18` : `${C.text3}18`, color: s.per < 12 ? C.green : s.per < 20 ? C.blue : C.text3 }}>
                              PER {s.per.toFixed(1)}
                            </span>
                          )}
                          {s.pbr != null && (
                            <span style={{ fontSize: "10px", padding: "2px 6px", borderRadius: "4px", background: s.pbr < 1 ? `${C.green}18` : s.pbr < 2 ? `${C.blue}18` : `${C.text3}18`, color: s.pbr < 1 ? C.green : s.pbr < 2 ? C.blue : C.text3 }}>
                              PBR {s.pbr.toFixed(2)}
                            </span>
                          )}
                          {s.divYield > 0 && (
                            <span style={{ fontSize: "10px", padding: "2px 6px", borderRadius: "4px", background: s.divYield > 3 ? `${C.yellow}18` : `${C.text3}18`, color: s.divYield > 3 ? C.yellow : C.text3 }}>
                              배당 {s.divYield.toFixed(1)}%
                            </span>
                          )}
                          {s.upside != null && (
                            <span style={{ fontSize: "10px", padding: "2px 6px", borderRadius: "4px", background: s.upside > 15 ? `${C.green}18` : s.upside > 0 ? `${C.blue}18` : `${C.red}18`, color: s.upside > 15 ? C.green : s.upside > 0 ? C.blue : C.red }}>
                              목표 {s.upside > 0 ? "+" : ""}{s.upside.toFixed(0)}%
                            </span>
                          )}
                          {s.fpe != null && s.per != null && s.fpe < s.per * 0.85 && (
                            <span style={{ fontSize: "10px", padding: "2px 6px", borderRadius: "4px", background: `${C.green}18`, color: C.green }}>
                              F-PER {s.fpe.toFixed(1)}
                            </span>
                          )}
                        </div>
                        {/* 이유 */}
                        {s.reasons.length > 0 && (
                          <div style={{ fontSize: "10px", color: C.text3, lineHeight: 1.6 }}>
                            {s.reasons.slice(0, 3).join(" · ")}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {filteredValue.length > 50 && (
                    <div style={{ textAlign: "center", fontSize: "12px", color: C.text3, padding: "8px" }}>
                      상위 50개만 표시 (전체 {filteredValue.length}개)
                    </div>
                  )}
                </div>
              )}

              {!valueScanning && valueResults.length === 0 && (
                <div style={{ textAlign: "center", padding: "24px", color: C.text3 }}>
                  <div style={{ fontSize: "36px", marginBottom: "10px" }}>💎</div>
                  <div style={{ fontSize: "13px", lineHeight: 1.7 }}>
                    <strong style={{ color: C.green }}>저평가 스캔</strong>을 눌러 미국·한국 주식의<br />
                    밸류에이션을 종합 분석합니다
                  </div>
                  <div style={{ fontSize: "11px", marginTop: "8px", color: C.text3 }}>
                    PER · PBR · 배당수익률 · Forward PE · 애널리스트 목표가 · 52주 위치 · 200일선 괴리 기반
                  </div>
                </div>
              )}

              {!valueScanning && valueResults.length > 0 && filteredValue.length === 0 && (
                <div style={{ textAlign: "center", padding: "20px", color: C.text3, fontSize: "13px" }}>
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
          <div className="tab-content">
            {/* 요약 헤더 */}
            <div style={{
              background: `linear-gradient(135deg, ${C.card}, #0d1f35)`,
              border: `1px solid ${C.border}`, borderRadius: "16px", padding: "20px", marginBottom: "16px",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: portfolio.length ? "16px" : "0" }}>
                <div style={{ fontWeight: 700, fontSize: "16px" }}>💼 내 포트폴리오</div>
                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                  <button onClick={() => setCurrency(c => c === "USD" ? "KRW" : "USD")} style={{
                    padding: "6px 10px", borderRadius: "8px", fontSize: "11px", fontWeight: 700,
                    background: C.card2, color: C.yellow, border: `1px solid ${C.yellow}44`,
                  }}>{currency === "USD" ? "🇺🇸 USD" : "🇰🇷 KRW"}</button>
                  <button onClick={fetchPortfolioPrices} style={{
                    padding: "6px 12px", borderRadius: "8px", fontSize: "12px", fontWeight: 600,
                    background: C.blueBg, color: C.blue, border: `1px solid ${C.blue}44`,
                  }}>{portfolioLoading ? "⏳ 갱신 중" : "🔄 가격 갱신"}</button>
                  <button onClick={() => setShowAddAsset(true)} style={{
                    padding: "6px 14px", borderRadius: "8px", fontSize: "12px", fontWeight: 700,
                    background: C.blue, color: "#fff", border: "none",
                  }}>+ 추가</button>
                </div>
              </div>
              {portfolio.length > 0 && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "10px" }}>
                  {[
                    { label: "총 투자금액", value: currency === "KRW" ? `₩${Math.round(pStats.invested * krwRate).toLocaleString()}` : `$${pStats.invested.toLocaleString(undefined, { maximumFractionDigits: 0 })}` },
                    { label: "현재 평가금액", value: pStats.hasPrices ? (currency === "KRW" ? `₩${Math.round(pStats.current * krwRate).toLocaleString()}` : `$${pStats.current.toLocaleString(undefined, { maximumFractionDigits: 0 })}`) : "—" },
                    { label: "총 손익", value: pStats.hasPrices ? `${pStats.pnl >= 0 ? "+" : ""}${currency === "KRW" ? `₩${Math.round(Math.abs(pStats.pnl) * krwRate).toLocaleString()}` : `$${pStats.pnl.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}` : "—", color: pStats.pnl >= 0 ? C.green : C.red },
                  ].map(({ label, value, color }) => (
                    <div key={label} style={{ background: C.bg, borderRadius: "12px", padding: "14px" }}>
                      <div style={{ fontSize: "11px", color: C.text3, marginBottom: "4px" }}>{label}</div>
                      <div style={{ fontWeight: 700, fontSize: "17px", color: color || C.text1 }}>{value}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 자산 추가 폼 */}
            {showAddAsset && (
              <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "16px", padding: "20px", marginBottom: "16px" }}>
                <div style={{ fontWeight: 700, marginBottom: "14px" }}>📌 자산 추가</div>
                {/* 종목 검색으로 자동 입력 */}
                <div style={{ marginBottom: "12px" }}>
                  <div style={{ fontSize: "11px", color: C.text3, marginBottom: "6px" }}>종목 검색 (심볼 또는 이름 입력)</div>
                  <SearchBar placeholder="종목 검색 (예: AAPL, 삼성, BTC...)" onSelect={(asset) => {
                    const sym = asset.symbol.toUpperCase();
                    setNewAsset(p => ({
                      ...p,
                      symbol: sym,
                      name: asset.name,
                      market: asset.market,
                    }));
                  }} />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "12px" }}>
                  {[
                    { k: "symbol",   label: "심볼", ph: "AAPL, 005930..." },
                    { k: "name",     label: "자산명", ph: "Apple, 삼성전자..." },
                    { k: "qty",      label: "보유 수량", ph: "0.00" },
                    { k: "avgPrice", label: "평균 매입가", ph: "0.00" },
                  ].map(({ k, label, ph }) => (
                    <div key={k}>
                      <div style={{ fontSize: "11px", color: C.text3, marginBottom: "4px" }}>{label}</div>
                      <input value={newAsset[k]} onChange={e => setNewAsset(p => ({ ...p, [k]: e.target.value }))}
                        placeholder={ph} style={{
                          width: "100%", padding: "9px 12px", borderRadius: "10px", fontSize: "13px",
                          background: C.bg, border: `1px solid ${C.border2}`, color: C.text1, outline: "none",
                          boxSizing: "border-box",
                        }} />
                    </div>
                  ))}
                </div>
                <div style={{ marginBottom: "12px" }}>
                  <div style={{ fontSize: "11px", color: C.text3, marginBottom: "6px" }}>시장</div>
                  <div style={{ display: "flex", gap: "6px" }}>
                    {[["us","🇺🇸 미국"], ["kr","🇰🇷 한국"], ["crypto","₿ 크립토"]].map(([v, l]) => (
                      <button key={v} onClick={() => setNewAsset(p => ({ ...p, market: v }))} style={{
                        padding: "6px 14px", borderRadius: "8px", fontSize: "12px", fontWeight: 600,
                        background: newAsset.market === v ? C.blueBg : C.card2,
                        color: newAsset.market === v ? C.blue : C.text3,
                        border: `1px solid ${newAsset.market === v ? C.blue : C.border2}`,
                      }}>{l}</button>
                    ))}
                  </div>
                </div>
                <div style={{ display: "flex", gap: "8px" }}>
                  <button onClick={() => {
                    if (!newAsset.symbol || !newAsset.qty || !newAsset.avgPrice) return;
                    const sym = newAsset.symbol.toUpperCase();
                    const symbolRaw = newAsset.market === "kr" && !sym.includes(".KS") ? `${sym}.KS` : sym;
                    const cryptoA = CRYPTO_ASSETS.find(c => c.symbol === sym || c.id === sym.toLowerCase());
                    setPortfolio(p => [...p, {
                      ...newAsset, symbol: sym, symbolRaw, cryptoId: cryptoA?.id || sym.toLowerCase(),
                      qty: parseFloat(newAsset.qty), avgPrice: parseFloat(newAsset.avgPrice), addedAt: Date.now(),
                    }]);
                    setNewAsset({ symbol: "", name: "", market: "us", qty: "", avgPrice: "" });
                    setShowAddAsset(false);
                  }} style={{
                    padding: "9px 20px", borderRadius: "10px", fontSize: "13px", fontWeight: 700,
                    background: C.blue, color: "#fff", border: "none", flex: 1,
                  }}>추가</button>
                  <button onClick={() => setShowAddAsset(false)} style={{
                    padding: "9px 20px", borderRadius: "10px", fontSize: "13px", fontWeight: 600,
                    background: C.card2, color: C.text3, border: `1px solid ${C.border2}`, flex: 1,
                  }}>취소</button>
                </div>
              </div>
            )}

            {/* 포트폴리오 아이템 */}
            {portfolio.length === 0 ? (
              <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "16px", padding: "48px 24px", textAlign: "center" }}>
                <div style={{ fontSize: "44px", marginBottom: "16px" }}>💼</div>
                <div style={{ fontWeight: 700, fontSize: "18px", marginBottom: "8px" }}>포트폴리오 비어있음</div>
                <div style={{ color: C.text3, fontSize: "14px" }}>자산을 추가하여 시작하세요</div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {portfolio.map((item, idx) => {
                  const cur = portfolioPrices[item.symbol];
                  const gain = cur ? ((cur - item.avgPrice) / item.avgPrice) * 100 : null;
                  const gainVal = cur ? item.qty * (cur - item.avgPrice) : null;
                  const invested = item.qty * item.avgPrice;
                  const evalVal = cur ? item.qty * cur : null;
                  const isPos = gainVal != null ? gainVal >= 0 : true;
                  const mcColor = item.market === "us" ? C.blue : item.market === "kr" ? C.green : C.purple;
                  const mcBg = item.market === "us" ? "#1A2C4F" : item.market === "kr" ? "#1A2A1E" : "#1E1A2A";
                  const flag = item.market === "us" ? "🇺🇸" : item.market === "kr" ? "🇰🇷" : "₿";
                  return (
                    <div key={idx} style={{
                      background: C.card, border: `1px solid ${C.border}`, borderRadius: "16px", overflow: "hidden",
                    }}>
                      <div style={{ display: "flex", alignItems: "center", padding: "16px 18px", gap: "14px" }}>
                        {/* 심볼 아이콘 */}
                        <div style={{
                          width: "44px", height: "44px", borderRadius: "12px", background: mcBg, flexShrink: 0,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontWeight: 800, fontSize: "10px", color: mcColor,
                        }}>
                          {item.symbol.replace(".KS","").slice(0,4)}
                        </div>
                        {/* 종목 정보 */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "3px" }}>
                            <span style={{ fontWeight: 700, fontSize: "15px", color: C.text1 }}>{item.name || item.symbol}</span>
                            <span style={{ fontSize: "12px", color: C.text3 }}>{flag} {item.symbol}</span>
                          </div>
                          <div style={{ fontSize: "13px", color: C.text3 }}>
                            {item.qty.toLocaleString()}주 · 평균 {toDisplay(item.avgPrice, item.market)}
                          </div>
                        </div>
                        {/* 현재가 & 수익률 */}
                        <div style={{ textAlign: "right", flexShrink: 0 }}>
                          <div style={{ fontWeight: 700, fontSize: "16px", color: C.text1, marginBottom: "2px" }}>
                            {toDisplay(cur, item.market)}
                          </div>
                          {gain != null && (
                            <div style={{ fontSize: "13px", fontWeight: 700, color: isPos ? C.green : C.red }}>
                              {isPos ? "+" : ""}{gain.toFixed(2)}%
                            </div>
                          )}
                        </div>
                      </div>

                      {/* 손익 상세 정보 */}
                      {cur != null && (
                        <div style={{
                          display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "6px",
                          padding: "0 18px 12px", fontSize: "11px",
                        }}>
                          <div style={{ background: C.bg, borderRadius: "8px", padding: "8px 10px" }}>
                            <div style={{ color: C.text3, marginBottom: "2px" }}>투자금</div>
                            <div style={{ color: C.text1, fontWeight: 700, fontSize: "13px" }}>
                              {toDisplay(invested, item.market)}
                            </div>
                          </div>
                          <div style={{ background: C.bg, borderRadius: "8px", padding: "8px 10px" }}>
                            <div style={{ color: C.text3, marginBottom: "2px" }}>평가금</div>
                            <div style={{ color: C.text1, fontWeight: 700, fontSize: "13px" }}>
                              {toDisplay(evalVal, item.market)}
                            </div>
                          </div>
                          <div style={{ background: isPos ? C.greenBg : C.redBg, borderRadius: "8px", padding: "8px 10px" }}>
                            <div style={{ color: C.text3, marginBottom: "2px" }}>손익</div>
                            <div style={{ color: isPos ? C.green : C.red, fontWeight: 700, fontSize: "13px" }}>
                              {isPos ? "+" : ""}{toDisplay(Math.abs(gainVal), item.market)}
                            </div>
                          </div>
                        </div>
                      )}

                      {/* 하단 액션 바 */}
                      <div style={{
                        display: "flex", gap: "8px", padding: "0 18px 14px",
                        borderTop: "none",
                      }}>
                        <button onClick={() => {
                          const cryptoA = CRYPTO_ASSETS.find(c => c.symbol === item.symbol);
                          setSelectedAsset({
                            symbol: item.symbol, name: item.name || item.symbol,
                            market: item.market, symbolRaw: item.symbolRaw || item.symbol,
                            ...(cryptoA ? { id: cryptoA.id } : {}),
                          });
                        }} style={{
                          flex: 1, padding: "9px 0", borderRadius: "10px", fontSize: "13px", fontWeight: 600,
                          background: C.blueBg, color: C.blue, border: `1px solid ${C.blue}33`,
                          display: "flex", alignItems: "center", justifyContent: "center", gap: "6px",
                        }}>🩺 진단</button>
                        <button onClick={() => {
                          const sym = item.market === "crypto"
                            ? `https://www.coingecko.com/en/coins/${item.cryptoId || item.symbol.toLowerCase()}`
                            : `https://finance.yahoo.com/quote/${item.symbolRaw || item.symbol}`;
                          window.open(sym, "_blank");
                        }} style={{
                          flex: 1, padding: "9px 0", borderRadius: "10px", fontSize: "13px", fontWeight: 600,
                          background: C.card2, color: C.text2, border: `1px solid ${C.border2}`,
                          display: "flex", alignItems: "center", justifyContent: "center", gap: "6px",
                        }}>🔗 상세</button>
                        <button onClick={() => setPortfolio(p => p.filter((_, i) => i !== idx))} style={{
                          padding: "9px 14px", borderRadius: "10px", fontSize: "13px", fontWeight: 600,
                          background: C.redBg, color: C.red, border: `1px solid ${C.red}33`,
                        }}>삭제</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════
            TAB: 전략
        ═══════════════════════════════════════════════════════════ */}
        {tab === "strategy" && <StrategyPanel onRunBacktest={(strategy, symbol) => {
          setBtStrategy(strategy); setBtSymbol(symbol); setTab("backtest");
        }} />}

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

          // 상위 상승/하락 5개
          const sorted = [...hotAssets].sort((a, b) => b.change - a.change);
          const topGainers = sorted.slice(0, 5);
          const topLosers = sorted.slice(-5).reverse();

          // 추천 종목 상위
          const topPicks = dailyPicks.filter(p => p.score >= 6).slice(0, 5);

          return (
            <div className="tab-content" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              {/* 헤더 */}
              <div style={{ background: `linear-gradient(135deg, ${C.card}, ${mktScore >= 55 ? "#0d2818" : mktScore < 45 ? "#28100d" : "#1a1a0d"})`, borderRadius: "16px", padding: "20px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "4px" }}>
                  <span style={{ fontWeight: 800, fontSize: "20px", color: C.text1 }}>퀀트 리포트</span>
                  <span style={{ fontSize: mf(10), color: C.text3 }}>{reportTime} 기준</span>
                </div>
                <div style={{ fontSize: "12px", color: C.text3, marginBottom: "16px" }}>AI 기반 실시간 시장 분석 리포트</div>

                {/* 시장 점수 대형 게이지 */}
                <div style={{ display: "flex", alignItems: "center", gap: "20px", marginBottom: "16px" }}>
                  <div style={{ position: "relative", width: "80px", height: "80px", flexShrink: 0 }}>
                    <svg viewBox="0 0 80 80" width="80" height="80">
                      <circle cx="40" cy="40" r="33" fill="none" stroke={C.border} strokeWidth="6" />
                      <circle cx="40" cy="40" r="33" fill="none" stroke={mktColor} strokeWidth="6" strokeLinecap="round"
                        strokeDasharray={`${(mktScore / 100) * 207.3} 207.3`} transform="rotate(-90 40 40)"
                        style={{ transition: "stroke-dasharray 0.6s ease" }} />
                      <text x="40" y="37" textAnchor="middle" fill={C.text1} fontSize="22" fontWeight="800">{mktScore}</text>
                      <text x="40" y="50" textAnchor="middle" fill={C.text3} fontSize="9">/100</text>
                    </svg>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: "22px", fontWeight: 800, color: mktColor, marginBottom: "6px" }}>{mktVerdict}</div>
                    <div style={{ fontSize: "12px", color: C.text2, lineHeight: 1.6 }}>
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
              <div style={{ background: C.card, borderRadius: "16px", padding: "16px" }}>
                <div style={{ fontWeight: 700, fontSize: "15px", color: C.text1, marginBottom: "12px" }}>주요 지수</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px" }}>
                  {[
                    sp && { name: "S&P 500", value: sp.price, change: sp.change },
                    nq && { name: "나스닥", value: nq.price, change: nq.change },
                    dji && { name: "다우존스", value: dji.price, change: dji.change },
                    ks && { name: "코스피", value: ks.price, change: ks.change },
                    kq && { name: "코스닥", value: kq.price, change: kq.change },
                    vix && { name: "VIX", value: vix.price, change: vix.change },
                  ].filter(Boolean).map(idx => (
                    <div key={idx.name} style={{ background: C.bg, borderRadius: "10px", padding: "10px", textAlign: "center" }}>
                      <div style={{ fontSize: "10px", color: C.text3, marginBottom: "4px" }}>{idx.name}</div>
                      <div style={{ fontSize: "14px", fontWeight: 700, color: C.text1 }}>{typeof idx.value === "number" ? idx.value.toLocaleString(undefined, { maximumFractionDigits: 0 }) : idx.value}</div>
                      <div style={{ fontSize: "11px", fontWeight: 600, color: idx.change >= 0 ? C.green : C.red }}>
                        {idx.change >= 0 ? "+" : ""}{idx.change}%
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* 시장 센티먼트 지표 */}
              <div style={{ background: C.card, borderRadius: "16px", padding: "16px" }}>
                <div style={{ fontWeight: 700, fontSize: "15px", color: C.text1, marginBottom: "12px" }}>센티먼트 지표</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                  <div style={{ background: C.bg, borderRadius: "10px", padding: "12px" }}>
                    <div style={{ fontSize: "10px", color: C.text3, marginBottom: "4px" }}>공포탐욕 지수</div>
                    <div style={{ display: "flex", alignItems: "baseline", gap: "6px" }}>
                      <span style={{ fontSize: "22px", fontWeight: 800, color: fg ? (fg > 60 ? C.green : fg > 40 ? C.yellow : C.red) : C.text3 }}>{fg || "—"}</span>
                      <span style={{ fontSize: "11px", color: C.text3 }}>{fg ? (fg <= 25 ? "극도의 공포" : fg <= 40 ? "공포" : fg <= 60 ? "중립" : fg <= 75 ? "탐욕" : "극도의 탐욕") : ""}</span>
                    </div>
                    {fg && (
                      <div style={{ marginTop: "6px", height: "6px", background: C.border, borderRadius: "3px", overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${fg}%`, borderRadius: "3px", background: `linear-gradient(90deg, ${C.red}, ${C.yellow}, ${C.green})` }} />
                      </div>
                    )}
                  </div>
                  <div style={{ background: C.bg, borderRadius: "10px", padding: "12px" }}>
                    <div style={{ fontSize: "10px", color: C.text3, marginBottom: "4px" }}>상승/하락 비율</div>
                    <div style={{ display: "flex", alignItems: "baseline", gap: "6px" }}>
                      <span style={{ fontSize: "22px", fontWeight: 800, color: advDecl > 55 ? C.green : advDecl < 45 ? C.red : C.yellow }}>{advDecl.toFixed(0)}%</span>
                      <span style={{ fontSize: "11px", color: C.text3 }}>상승</span>
                    </div>
                    <div style={{ marginTop: "6px", height: "6px", background: C.border, borderRadius: "3px", overflow: "hidden", display: "flex" }}>
                      <div style={{ height: "100%", width: `${advDecl}%`, background: C.green }} />
                      <div style={{ height: "100%", flex: 1, background: C.red }} />
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "9px", color: C.text3, marginTop: "3px" }}>
                      <span>상승 {upCount}</span>
                      <span>보합 {flatCount}</span>
                      <span>하락 {dnCount}</span>
                    </div>
                  </div>
                  {vix && (
                    <div style={{ background: C.bg, borderRadius: "10px", padding: "12px" }}>
                      <div style={{ fontSize: "10px", color: C.text3, marginBottom: "4px" }}>VIX (변동성)</div>
                      <div style={{ display: "flex", alignItems: "baseline", gap: "6px" }}>
                        <span style={{ fontSize: "22px", fontWeight: 800, color: vix.price > 30 ? C.red : vix.price > 20 ? C.yellow : C.green }}>{vix.price?.toFixed(1)}</span>
                        <span style={{ fontSize: "11px", color: C.text3 }}>{vix.price > 30 ? "고변동" : vix.price > 20 ? "보통" : "안정"}</span>
                      </div>
                    </div>
                  )}
                  <div style={{ background: C.bg, borderRadius: "10px", padding: "12px" }}>
                    <div style={{ fontSize: "10px", color: C.text3, marginBottom: "4px" }}>추천 매수 신호</div>
                    <div style={{ display: "flex", alignItems: "baseline", gap: "6px" }}>
                      <span style={{ fontSize: "22px", fontWeight: 800, color: C.blue }}>{buyPicks}</span>
                      <span style={{ fontSize: "11px", color: C.text3 }}>/ {dailyPicks.length} 종목</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* 시장별 현황 */}
              <div style={{ background: C.card, borderRadius: "16px", padding: "16px" }}>
                <div style={{ fontWeight: 700, fontSize: "15px", color: C.text1, marginBottom: "12px" }}>시장별 현황</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px" }}>
                  {[
                    { name: "🇺🇸 미국", total: usStocks.length, up: usUp, color: C.blue },
                    { name: "🇰🇷 한국", total: krStocks.length, up: krUp, color: C.green },
                    { name: "₿ 크립토", total: cryptos.length, up: cryptoUp, color: C.purple },
                  ].map(m => (
                    <div key={m.name} style={{ background: C.bg, borderRadius: "10px", padding: "12px", textAlign: "center" }}>
                      <div style={{ fontSize: "12px", fontWeight: 700, color: C.text1, marginBottom: "6px" }}>{m.name}</div>
                      <div style={{ fontSize: "11px", color: C.text3, marginBottom: "4px" }}>{m.total}개 종목</div>
                      <div style={{ height: "4px", background: C.border, borderRadius: "2px", overflow: "hidden" }}>
                        <div style={{ height: "100%", width: m.total > 0 ? `${(m.up / m.total * 100)}%` : "0%", background: m.color, borderRadius: "2px" }} />
                      </div>
                      <div style={{ fontSize: "10px", color: m.color, marginTop: "3px", fontWeight: 600 }}>
                        {m.total > 0 ? `${(m.up / m.total * 100).toFixed(0)}% 상승` : "—"}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* 급등/급락 TOP 5 */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                <div style={{ background: C.card, borderRadius: "16px", padding: "16px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "4px", marginBottom: "10px" }}>
                    <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: C.green }} />
                    <span style={{ fontWeight: 700, fontSize: "14px", color: C.text1 }}>급등 TOP 5</span>
                  </div>
                  {topGainers.map((a, i) => (
                    <div key={a.symbol} onClick={() => setSelectedAsset(a)} style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      padding: "8px 0", cursor: "pointer",
                      borderBottom: i < 4 ? `1px solid ${C.border}08` : "none",
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px", flex: 1, minWidth: 0 }}>
                        <span style={{ fontSize: "10px", fontWeight: 700, color: C.text3, width: "14px" }}>{i + 1}</span>
                        <span style={{ fontSize: "12px", fontWeight: 600, color: C.text1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</span>
                      </div>
                      <span style={{ fontSize: "12px", fontWeight: 700, color: C.green, flexShrink: 0 }}>+{a.change}%</span>
                    </div>
                  ))}
                </div>
                <div style={{ background: C.card, borderRadius: "16px", padding: "16px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "4px", marginBottom: "10px" }}>
                    <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: C.red }} />
                    <span style={{ fontWeight: 700, fontSize: "14px", color: C.text1 }}>급락 TOP 5</span>
                  </div>
                  {topLosers.map((a, i) => (
                    <div key={a.symbol} onClick={() => setSelectedAsset(a)} style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      padding: "8px 0", cursor: "pointer",
                      borderBottom: i < 4 ? `1px solid ${C.border}08` : "none",
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px", flex: 1, minWidth: 0 }}>
                        <span style={{ fontSize: "10px", fontWeight: 700, color: C.text3, width: "14px" }}>{i + 1}</span>
                        <span style={{ fontSize: "12px", fontWeight: 600, color: C.text1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</span>
                      </div>
                      <span style={{ fontSize: "12px", fontWeight: 700, color: C.red, flexShrink: 0 }}>{a.change}%</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* 추천 매수 종목 */}
              {topPicks.length > 0 && (
                <div style={{ background: C.card, borderRadius: "16px", padding: "16px" }}>
                  <div style={{ fontWeight: 700, fontSize: "15px", color: C.text1, marginBottom: "12px" }}>추천 매수 종목</div>
                  {topPicks.map((pick, i) => {
                    const flag = pick.market === "kr" ? "🇰🇷" : "🇺🇸";
                    return (
                      <div key={pick.symbol} onClick={() => setSelectedAsset(pick)} style={{
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        padding: "10px 4px", cursor: "pointer",
                        borderBottom: i < topPicks.length - 1 ? `1px solid ${C.border}08` : "none",
                      }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "10px", flex: 1, minWidth: 0 }}>
                          <div style={{
                            width: "28px", height: "28px", borderRadius: "8px", flexShrink: 0,
                            background: `${C.blue}18`, display: "flex", alignItems: "center", justifyContent: "center",
                            fontSize: "12px", fontWeight: 800, color: C.blue,
                          }}>{i + 1}</div>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 600, fontSize: "13px", color: C.text1 }}>{flag} {pick.name}</div>
                            <div style={{ fontSize: "10px", color: C.text3 }}>{pick.reason}</div>
                          </div>
                        </div>
                        <div style={{ textAlign: "right", flexShrink: 0 }}>
                          <div style={{
                            fontSize: "11px", fontWeight: 700, padding: "3px 8px", borderRadius: "6px",
                            background: C.greenBg, color: C.green,
                          }}>점수 {pick.score}</div>
                          <div style={{ fontSize: "11px", fontWeight: 600, color: pick.change >= 0 ? C.green : C.red, marginTop: "4px" }}>
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
                <div style={{ background: C.card, borderRadius: "16px", padding: "16px" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
                    <span style={{ fontWeight: 700, fontSize: "15px", color: C.text1 }}>종목별 퀀트 전략</span>
                    <span style={{ fontSize: "10px", padding: "3px 8px", borderRadius: "6px", background: `${C.blue}15`, color: C.blue, fontWeight: 600 }}>백테스트 상세 →</span>
                  </div>
                  <div style={{ fontSize: "11px", color: C.text3, marginBottom: "10px", lineHeight: 1.5 }}>
                    각 종목을 클릭하면 10개 퀀트 전략 백테스트 결과(1년), 고급 지지/저항/목표/손절가, 리스크:리워드 분석을 확인할 수 있습니다.
                  </div>
                  {topPicks.map((pick, i) => {
                    const flag = pick.market === "kr" ? "🇰🇷" : "🇺🇸";
                    const hot = hotAssets.find(h => h.symbol === pick.symbol);
                    const d = hot ? quickDiagnosis(hot) : null;
                    return (
                      <div key={pick.symbol} onClick={() => setSelectedAsset(pick)} style={{
                        display: "flex", alignItems: "center", gap: "10px",
                        padding: "12px 8px", cursor: "pointer",
                        borderBottom: i < topPicks.length - 1 ? `1px solid ${C.border}08` : "none",
                        borderRadius: "8px",
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = `${C.blue}06`}
                      onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                        <div style={{
                          width: "32px", height: "32px", borderRadius: "10px", flexShrink: 0,
                          background: `${C.blue}15`, display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: "14px", fontWeight: 800, color: C.blue,
                        }}>{i + 1}</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "3px" }}>
                            <span style={{ fontWeight: 700, fontSize: "13px", color: C.text1 }}>{flag} {pick.name}</span>
                            {d && (
                              <span style={{
                                fontSize: "10px", fontWeight: 700, padding: "2px 6px", borderRadius: "4px",
                                background: d.opinionColor === "green" ? `${C.green}18` : d.opinionColor === "red" ? `${C.red}18` : `${C.yellow}18`,
                                color: d.opinionColor === "green" ? C.green : d.opinionColor === "red" ? C.red : C.yellow,
                              }}>{d.opinion}</span>
                            )}
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                            <span style={{ fontSize: "10px", color: C.text3 }}>{pick.reason}</span>
                            {d && <span style={{ fontSize: "10px", color: C.text3 }}>진단 {d.score}점</span>}
                          </div>
                        </div>
                        <div style={{ textAlign: "right", flexShrink: 0 }}>
                          <div style={{ fontSize: "13px", fontWeight: 700, color: pick.change >= 0 ? C.green : C.red }}>
                            {pick.change >= 0 ? "+" : ""}{pick.change}%
                          </div>
                          <button style={{ fontSize: "10px", color: C.blue, fontWeight: 700, background: `${C.blue}12`, border: `1px solid ${C.blue}30`, borderRadius: "6px", padding: "3px 10px", cursor: "pointer" }}>📊 백테스트</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* 종합 의견 */}
              <div style={{
                background: `linear-gradient(135deg, ${C.card}, ${mktScore >= 55 ? "#0d2818" : mktScore < 45 ? "#28100d" : "#1a1a0d"})`,
                borderRadius: "16px", padding: "20px",
              }}>
                <div style={{ fontWeight: 700, fontSize: "15px", color: C.text1, marginBottom: "12px" }}>종합 의견</div>
                <div style={{ fontSize: "13px", color: C.text2, lineHeight: 1.8 }}>
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
                <div style={{ display: "flex", gap: "8px", marginTop: "14px", flexWrap: "wrap" }}>
                  <span style={{ fontSize: "11px", padding: "4px 10px", borderRadius: "6px", background: `${mktColor}18`, color: mktColor, fontWeight: 700 }}>
                    시장점수 {mktScore}/100
                  </span>
                  <span style={{ fontSize: "11px", padding: "4px 10px", borderRadius: "6px", background: C.card2, color: C.text3 }}>
                    상승률 {advDecl.toFixed(0)}%
                  </span>
                  {fg && <span style={{ fontSize: "11px", padding: "4px 10px", borderRadius: "6px", background: C.card2, color: C.text3 }}>
                    공포탐욕 {fg}
                  </span>}
                  <span style={{ fontSize: "11px", padding: "4px 10px", borderRadius: "6px", background: C.card2, color: C.text3 }}>
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
        {tab === "backtest" && <BacktestPanel initialStrategy={btStrategy} initialSymbol={btSymbol} />}

        {/* ═══════════════════════════════════════════════════════════
            TAB: 뉴스
        ═══════════════════════════════════════════════════════════ */}
        {tab === "news" && (
          <div className="tab-content">
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "16px", padding: "16px", marginBottom: "12px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span style={{ fontWeight: 700 }}>📰 투자 뉴스</span>
                  <button onClick={fetchNews} disabled={newsLoading} style={{
                    padding: "4px 10px", borderRadius: "6px", fontSize: "11px", fontWeight: 600,
                    background: C.card2, color: C.text3, border: `1px solid ${C.border2}`, cursor: "pointer",
                  }}>{newsLoading ? "⏳" : "🔄 새로고침"}</button>
                </div>
                <div style={{ display: "flex", gap: "4px" }}>
                  {[
                    ["time", "시간순"],
                    ["positive", "긍정순"],
                    ["negative", "부정순"],
                  ].map(([v, l]) => (
                    <button key={v} onClick={() => setNewsSort(v)} style={{
                      padding: "4px 10px", borderRadius: "8px", fontSize: "11px", fontWeight: 600,
                      background: newsSort === v ? C.blueBg : "transparent",
                      color: newsSort === v ? C.blue : C.text3,
                      border: `1px solid ${newsSort === v ? C.blue : C.border2}`,
                    }}>{l}</button>
                  ))}
                </div>
              </div>
            </div>

            {newsLoading ? (
              <div style={{ textAlign: "center", padding: "32px", color: C.text3 }}>뉴스 로딩 중...</div>
            ) : sortedNews.length === 0 ? (
              <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "16px", padding: "48px 24px", textAlign: "center" }}>
                <div style={{ fontSize: "44px", marginBottom: "16px" }}>📰</div>
                <div style={{ fontWeight: 700, fontSize: "16px", marginBottom: "8px" }}>뉴스 없음</div>
                <div style={{ color: C.text3, fontSize: "14px" }}>최신 뉴스가 없습니다</div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {sortedNews.map((news, i) => {
                  const sentiment = analyzeSentiment(news.title);
                  const sentimentBadge = sentiment === "positive" ? "🟢 긍정" : sentiment === "negative" ? "🔴 부정" : "⚪ 중립";
                  const pubDate = new Date(news.date || news.publishedAt || news.pubDate || Date.now());
                  return (
                    <a key={i} href={news.url || news.link || "#"} target="_blank" rel="noopener" style={{
                      background: C.card, border: `1px solid ${C.border}`, borderRadius: "12px", padding: "14px",
                      textDecoration: "none", color: "inherit", display: "block", transition: "all .2s",
                    }}
                    onMouseEnter={e => e.currentTarget.style.borderColor = C.blue}
                    onMouseLeave={e => e.currentTarget.style.borderColor = C.border}>
                      <div style={{ display: "flex", gap: "8px", alignItems: "flex-start" }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: "13px", marginBottom: "6px", color: C.text1, lineHeight: 1.4 }}>{news.title}</div>
                          <div style={{ fontSize: "12px", color: C.text3, marginBottom: "8px", display: "flex", gap: "8px", flexWrap: "wrap" }}>
                            <span>{news.source || "Unknown"}</span>
                            <span>·</span>
                            <span>{pubDate.toLocaleString("ko-KR")}</span>
                          </div>
                          {(news.desc || news.description) && (
                            <div style={{ fontSize: "12px", color: C.text2, lineHeight: 1.5 }}>{(news.desc || news.description).slice(0, 120)}</div>
                          )}
                          {news.tags?.length > 0 && (
                            <div style={{ display: "flex", gap: "4px", flexWrap: "wrap", marginTop: "6px" }}>
                              {news.tags.map((tag, ti) => (
                                <span key={ti} style={{ padding: "2px 6px", borderRadius: "4px", fontSize: "10px", background: C.card2, color: C.text3 }}>{tag}</span>
                              ))}
                            </div>
                          )}
                        </div>
                        <div style={{ fontSize: "11px", whiteSpace: "nowrap", color: C.text2, padding: "4px 8px", background: C.card2, borderRadius: "6px" }}>{sentimentBadge}</div>
                      </div>
                    </a>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════
            TAB: 알림
        ═══════════════════════════════════════════════════════════ */}
        {tab === "alerts" && (
          <div className="tab-content">
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "16px", padding: "20px", marginBottom: "16px" }}>
              <div style={{ fontWeight: 700, fontSize: "16px", marginBottom: "16px" }}>🔔 텔레그램 알림</div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "12px" }}>
                <div>
                  <div style={{ fontSize: "11px", color: C.text3, marginBottom: "6px", fontWeight: 600 }}>봇 토큰</div>
                  <input value={settings.botToken} onChange={e => setSettings(p => ({ ...p, botToken: e.target.value }))}
                    placeholder="123456789:ABCdefGHIjklMNOpqrSTUvwxyz" type="password" style={{
                      width: "100%", padding: "10px 12px", borderRadius: "10px", fontSize: "12px",
                      background: C.bg, border: `1px solid ${C.border2}`, color: C.text1, outline: "none",
                    }} />
                </div>
                <div>
                  <div style={{ fontSize: "11px", color: C.text3, marginBottom: "6px", fontWeight: 600 }}>채팅 ID</div>
                  <input value={settings.chatId} onChange={e => setSettings(p => ({ ...p, chatId: e.target.value }))}
                    placeholder="1234567890" type="password" style={{
                      width: "100%", padding: "10px 12px", borderRadius: "10px", fontSize: "12px",
                      background: C.bg, border: `1px solid ${C.border2}`, color: C.text1, outline: "none",
                    }} />
                </div>
              </div>

              <div style={{ marginBottom: "12px" }}>
                <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", fontSize: "13px" }}>
                  <input type="checkbox" checked={settings.autoSend} onChange={e => setSettings(p => ({ ...p, autoSend: e.target.checked }))}
                    style={{ cursor: "pointer" }} />
                  <span>스캔 완료 시 자동 알림</span>
                </label>
              </div>

              <div style={{ display: "flex", gap: "8px", marginBottom: "12px" }}>
                <button onClick={() => {
                  if (!settings.botToken || !settings.chatId) return;
                  (async () => {
                    setTgStatus("⏳ 전송 중...");
                    try {
                      const r = await fetch(`https://api.telegram.org/bot${settings.botToken}/sendMessage`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ chat_id: settings.chatId, text: "🚨 *DI금융 테스트*\n\n테스트 알림입니다.", parse_mode: "Markdown" }),
                      });
                      if (r.ok) setTgStatus("✅ 테스트 완료");
                      else setTgStatus("❌ 전송 실패");
                    } catch (e) { setTgStatus(`❌ ${e.message}`); }
                  })();
                }} style={{
                  padding: "9px 20px", borderRadius: "10px", fontSize: "13px", fontWeight: 700,
                  background: C.blue, color: "#fff", border: "none",
                }}>📤 테스트</button>
              </div>

              {tgStatus && (
                <div style={{ fontSize: "12px", color: tgStatus.includes("✅") ? C.green : C.red, fontWeight: 600 }}>
                  {tgStatus}
                </div>
              )}
            </div>

            {/* 동기화 */}
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "16px", padding: "20px" }}>
              <div style={{ fontWeight: 700, fontSize: "16px", marginBottom: "16px" }}>🔄 데이터 동기화</div>
              <div style={{ marginBottom: "12px" }}>
                <div style={{ fontSize: "11px", color: C.text3, marginBottom: "6px", fontWeight: 600 }}>동기화 PIN (4자리 이상)</div>
                <input value={syncPin} onChange={e => setSyncPin(e.target.value)} type="password" placeholder="1234"
                  style={{
                    width: "100%", padding: "10px 12px", borderRadius: "10px", fontSize: "13px",
                    background: C.bg, border: `1px solid ${C.border2}`, color: C.text1, outline: "none", marginBottom: "12px",
                  }} />
              </div>
              <div style={{ display: "flex", gap: "8px", marginBottom: "12px" }}>
                <button onClick={syncUpload} style={{
                  padding: "9px 20px", borderRadius: "10px", fontSize: "13px", fontWeight: 700,
                  background: C.blue, color: "#fff", border: "none", flex: 1,
                }}>📤 업로드</button>
                <button onClick={syncDownload} style={{
                  padding: "9px 20px", borderRadius: "10px", fontSize: "13px", fontWeight: 700,
                  background: C.green, color: "#fff", border: "none", flex: 1,
                }}>📥 다운로드</button>
              </div>
              {syncStatus && (
                <div style={{ fontSize: "12px", color: syncStatus.includes("✅") ? C.green : C.red, fontWeight: 600 }}>
                  {syncStatus}
                </div>
              )}
            </div>
          </div>
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

        {/* 차트 모달 */}
        {chartAsset && <ChartModal asset={chartAsset} onClose={() => setChartAsset(null)} krwRate={krwRate} theme={themeMode} />}
      </main>
      </PullToRefresh>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// 앱 진입점 — ErrorBoundary 래핑
// ════════════════════════════════════════════════════════════════════
export default function App() {
  return (
    <ErrorBoundary>
      <AppInner />
    </ErrorBoundary>
  );
}
