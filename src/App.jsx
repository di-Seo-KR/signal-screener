// DI금융 v4.0 — 투자 스크리너 + 퀀트 엔진 + 백테스트
// Features: 스크리닝, 캔들차트, 12개 전략, 백테스트, 포트폴리오, 뉴스, 텔레그램 알림
import { useState, useEffect, useCallback } from "react";
import ChartModal from "./ChartModal.jsx";
import StrategyPanel from "./StrategyPanel.jsx";
import BacktestPanel from "./BacktestPanel.jsx";

// ════════════════════════════════════════════════════════════════════
// 데이터 정의
// ════════════════════════════════════════════════════════════════════
const US_ASSETS = [
  { symbol: "AAPL", name: "Apple" }, { symbol: "MSFT", name: "Microsoft" },
  { symbol: "GOOGL", name: "Alphabet" }, { symbol: "AMZN", name: "Amazon" },
  { symbol: "NVDA", name: "NVIDIA" }, { symbol: "META", name: "Meta" },
  { symbol: "TSLA", name: "Tesla" }, { symbol: "AMD", name: "AMD" },
  { symbol: "NFLX", name: "Netflix" }, { symbol: "INTC", name: "Intel" },
  { symbol: "BA", name: "Boeing" }, { symbol: "DIS", name: "Disney" },
  { symbol: "PYPL", name: "PayPal" }, { symbol: "SNAP", name: "Snap" },
  { symbol: "UBER", name: "Uber" }, { symbol: "COIN", name: "Coinbase" },
  { symbol: "SQ", name: "Block" }, { symbol: "PLTR", name: "Palantir" },
  { symbol: "V", name: "Visa" }, { symbol: "MA", name: "Mastercard" },
  { symbol: "JPM", name: "JPMorgan" }, { symbol: "GS", name: "Goldman Sachs" },
  { symbol: "CRM", name: "Salesforce" }, { symbol: "ORCL", name: "Oracle" },
  { symbol: "ADBE", name: "Adobe" }, { symbol: "QCOM", name: "Qualcomm" },
  // ETF
  { symbol: "SPY", name: "S&P 500 ETF" }, { symbol: "QQQ", name: "나스닥 100 ETF" },
  { symbol: "ARKK", name: "ARK Innovation" }, { symbol: "SOXL", name: "반도체 3x" },
  { symbol: "TQQQ", name: "나스닥 3x" }, { symbol: "BITI", name: "ProShares Short BTC" },
  { symbol: "BITO", name: "ProShares BTC Strategy" }, { symbol: "GLD", name: "Gold ETF" },
  { symbol: "TLT", name: "미국 장기채 ETF" }, { symbol: "VIX", name: "VIX 변동성" },
  { symbol: "SCHD", name: "배당 ETF" }, { symbol: "JEPI", name: "JP모건 인컴 ETF" },
];

const KR_ASSETS = [
  { symbol: "005930.KS", name: "삼성전자" }, { symbol: "000660.KS", name: "SK하이닉스" },
  { symbol: "035420.KS", name: "NAVER" },    { symbol: "035720.KS", name: "카카오" },
  { symbol: "051910.KS", name: "LG화학" },   { symbol: "006400.KS", name: "삼성SDI" },
  { symbol: "003670.KS", name: "포스코퓨처엠" }, { symbol: "105560.KS", name: "KB금융" },
  { symbol: "055550.KS", name: "신한지주" }, { symbol: "068270.KS", name: "셀트리온" },
  { symbol: "207940.KS", name: "삼성바이오로직스" }, { symbol: "066570.KS", name: "LG전자" },
  { symbol: "005380.KS", name: "현대차" },   { symbol: "000270.KS", name: "기아" },
  { symbol: "086790.KS", name: "하나금융지주" },
];

const CRYPTO_ASSETS = [
  { id: "bitcoin", symbol: "BTC", name: "Bitcoin" },
  { id: "ethereum", symbol: "ETH", name: "Ethereum" },
  { id: "solana", symbol: "SOL", name: "Solana" },
  { id: "ripple", symbol: "XRP", name: "XRP" },
  { id: "cardano", symbol: "ADA", name: "Cardano" },
  { id: "avalanche-2", symbol: "AVAX", name: "Avalanche" },
  { id: "polkadot", symbol: "DOT", name: "Polkadot" },
  { id: "chainlink", symbol: "LINK", name: "Chainlink" },
  { id: "dogecoin", symbol: "DOGE", name: "Dogecoin" },
  { id: "uniswap", symbol: "UNI", name: "Uniswap" },
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

function analyzeAsset(weeklyCloses, dailyCloses, weeklyVolumes, weeklyHighs, weeklyLows, conditions) {
  const price = weeklyCloses[weeklyCloses.length - 1];
  const rsi = calcRSI(weeklyCloses, 14);
  const ma50daily  = calcSMA(dailyCloses, 50);
  const ma200daily = calcSMA(dailyCloses, 200);
  const bb   = calcBB(weeklyCloses);
  const macd = calcMACD(weeklyCloses);
  const stoch = calcStochastic(weeklyHighs, weeklyLows, weeklyCloses);
  const wr    = calcWilliamsR(weeklyHighs, weeklyLows, weeklyCloses);

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

  // 3주 연속 하락
  const threeWeekDown = weeklyCloses.length >= 4 &&
    weeklyCloses[weeklyCloses.length - 1] < weeklyCloses[weeklyCloses.length - 2] &&
    weeklyCloses[weeklyCloses.length - 2] < weeklyCloses[weeklyCloses.length - 3] &&
    weeklyCloses[weeklyCloses.length - 3] < weeklyCloses[weeklyCloses.length - 4];

  // 52주 신저가 근접
  const low52w = weeklyCloses.length >= 52
    ? Math.min(...weeklyCloses.slice(-52))
    : Math.min(...weeklyCloses);
  const near52wLow = price <= low52w * 1.05;

  const triggers = [];
  if (conditions.includes("rsi30")           && rsi != null && rsi <= 30)                          triggers.push("rsi30");
  if (conditions.includes("ma200")           && ma200Dist != null && Math.abs(ma200Dist) <= 2)     triggers.push("ma200");
  if (conditions.includes("bb_lower")        && bb && price <= bb.lower * 1.01)                   triggers.push("bb_lower");
  if (conditions.includes("macd_golden")     && macd.goldenCross)                                  triggers.push("macd_golden");
  if (conditions.includes("volume_spike")    && volRatio >= 2)                                     triggers.push("volume_spike");
  if (conditions.includes("stoch_oversold")  && stoch && stoch.k < 20 && stoch.d < 20)            triggers.push("stoch_oversold");
  if (conditions.includes("bb_squeeze")      && bbSqueeze)                                         triggers.push("bb_squeeze");
  if (conditions.includes("ma_golden")       && ma50daily && ma200daily && ma50daily > ma200daily) triggers.push("ma_golden");
  if (conditions.includes("three_week_down") && threeWeekDown)                                     triggers.push("three_week_down");
  if (conditions.includes("extreme_oversold")&& ma200Dist != null && ma200Dist <= -20)             triggers.push("extreme_oversold");
  if (conditions.includes("near_52w_low")    && near52wLow)                                        triggers.push("near_52w_low");

  return {
    triggers, price: +price.toFixed(6),
    rsi: rsi != null ? +rsi.toFixed(1) : null,
    weekChange: +weekChange.toFixed(2),
    ma200Dist: ma200Dist != null ? +ma200Dist.toFixed(2) : null,
    volRatio: +volRatio.toFixed(1),
    ma50: ma50daily, ma200: ma200daily,
    stoch, wr: wr != null ? +wr.toFixed(1) : null,
    low52w,
  };
}

// ════════════════════════════════════════════════════════════════════
// 조건 메타데이터
// ════════════════════════════════════════════════════════════════════
const CONDITION_META = {
  rsi30:           { label: "RSI ≤ 30",           icon: "📉", desc: "주봉 RSI가 30 이하 — 극단적 과매도 구간",  category: "기본" },
  ma200:           { label: "200일선 터치",         icon: "📊", desc: "현재가와 200일선 오차 ±2% 이내",         category: "기본" },
  bb_lower:        { label: "BB 하단 터치",         icon: "🎯", desc: "볼린저밴드 하단 이하 — 통계적 과매도",    category: "기본" },
  macd_golden:     { label: "MACD 골든크로스",      icon: "✨", desc: "MACD 라인이 시그널 위로 상향 돌파",       category: "기본" },
  volume_spike:    { label: "거래량 급증",           icon: "🔥", desc: "최근 거래량이 20주 평균의 2배 이상",      category: "기본" },
  stoch_oversold:  { label: "스토캐스틱 과매도",    icon: "🌊", desc: "Stochastic %K & %D 모두 20 이하",        category: "전문가" },
  bb_squeeze:      { label: "BB 스퀴즈",            icon: "⚡", desc: "밴드폭이 52주 최저 — 대폭발 전조",        category: "전문가" },
  ma_golden:       { label: "MA 골든크로스 50/200", icon: "🏆", desc: "50일선이 200일선 위 — 장기 상승전환",      category: "전문가" },
  three_week_down: { label: "3주 연속 하락",         icon: "📛", desc: "3주 연속 하락 — 단기 저점 탐색 구간",    category: "전문가" },
  extreme_oversold:{ label: "극단 과매도",           icon: "💥", desc: "200일선 대비 -20% — 역사적 저점권",       category: "전문가" },
  near_52w_low:    { label: "52주 신저가 근접",      icon: "🔔", desc: "52주 최저가 대비 5% 이내 — 매집 관심",   category: "전문가" },
};

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
// 색상 팔레트 (토스증권 스타일 다크 테마)
// ════════════════════════════════════════════════════════════════════
const C = {
  bg: "#070C14", card: "#0F1825", card2: "#141E2E",
  border: "#1A2535", border2: "#243044",
  blue: "#3182F6", blueL: "#5AA3FF", blueBg: "#1A2C4F",
  red: "#F04452", redBg: "#2A1520",
  green: "#05C072", greenBg: "#0A2A1A",
  yellow: "#FFB400", yellowBg: "#2A2000",
  purple: "#8B5CF6", purpleBg: "#1E1535",
  text1: "#F2F4F7", text2: "#A0AEBF", text3: "#5A6880",
};

// ════════════════════════════════════════════════════════════════════
// 서브 컴포넌트: Tag
// ════════════════════════════════════════════════════════════════════
const TAG_COLORS = {
  rsi30: C.purple, ma200: C.blue, bb_lower: C.yellow, macd_golden: C.green,
  volume_spike: C.red, stoch_oversold: C.purple, bb_squeeze: C.yellow,
  ma_golden: C.green, three_week_down: C.red, extreme_oversold: C.red, near_52w_low: C.yellow,
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
// 서브 컴포넌트: AssetCard
// ════════════════════════════════════════════════════════════════════
function AssetCard({ asset, onChart }) {
  const [expanded, setExpanded] = useState(false);
  const isPos = asset.weekChange >= 0;
  const mcBg = asset.market === "us" ? "#1A2C4F" : asset.market === "kr" ? "#1A2A1E" : "#1E1A2A";
  const mcColor = asset.market === "us" ? C.blue : asset.market === "kr" ? C.green : C.purple;

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
// 메인 앱
// ════════════════════════════════════════════════════════════════════
export default function App() {
  const [tab, setTab] = useState("screener");
  const [menuOpen, setMenuOpen] = useState(false);

  // ── 스크리너 상태 ─────────────────────────────────────────────
  const [results, setResults]         = useState([]);
  const [scanning, setScanning]       = useState(false);
  const [scanProgress, setScanProgress] = useState({ done: 0, total: 0 });
  const [conditions, setConditions]   = useState(["rsi30","ma200","bb_lower","macd_golden","volume_spike"]);
  const [mode, setMode]               = useState("or");
  const [filterMarket, setFilterMarket] = useState("all");
  const [sortBy, setSortBy]           = useState("rsi");
  const [scanErrors, setScanErrors]   = useState([]);
  const [lastScan, setLastScan]       = useState(null);
  const [chartAsset, setChartAsset]   = useState(null);

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

  useEffect(() => { saveSettings({ botToken: settings.botToken, chatId: settings.chatId, autoSend: settings.autoSend, syncPin }); }, [settings, syncPin]);
  useEffect(() => { savePortfolio(portfolio); }, [portfolio]);

  // ── 스크리너 실행 ─────────────────────────────────────────────
  const runScan = useCallback(async () => {
    if (scanning) return;
    setScanning(true); setScanErrors([]);
    const all = [
      ...US_ASSETS.map(a => ({ ...a, market: "us", symbolRaw: a.symbol })),
      ...KR_ASSETS.map(a => ({ ...a, market: "kr", symbolRaw: a.symbol, symbol: a.symbol.replace(".KS", "") })),
      ...CRYPTO_ASSETS.map(a => ({ ...a, market: "crypto", symbol: a.symbol, symbolRaw: a.id })),
    ];
    setScanProgress({ done: 0, total: all.length });
    const found = [], errors = [];

    for (let i = 0; i < all.length; i++) {
      const asset = all[i];
      try {
        let wCloses, wVolumes, wHighs, wLows, dCloses;
        if (asset.market === "crypto") {
          const r = await fetch(`/api/coingecko?id=${encodeURIComponent(asset.symbolRaw)}&days=365&_t=${Date.now()}`);
          if (!r.ok) throw new Error(`CoinGecko ${r.status}`);
          const j = await r.json();
          const dp = (j.prices || []).map(p => p[1]);
          const dv = (j.total_volumes || []).map(v => v[1]);
          wCloses = []; wVolumes = []; wHighs = []; wLows = [];
          for (let k = 6; k < dp.length; k += 7) {
            const sl = dp.slice(Math.max(0, k - 6), k + 1);
            wCloses.push(dp[k]);
            wVolumes.push(dv.slice(Math.max(0, k - 6), k + 1).reduce((a, b) => a + b, 0));
            wHighs.push(Math.max(...sl));
            wLows.push(Math.min(...sl));
          }
          dCloses = dp;
          await new Promise(r => setTimeout(r, 1200)); // CoinGecko 무료 API 레이트리밋 방지
        } else {
          // 주간 + 일간 데이터만 가져옴 (yahoo.js가 highs/lows 포함)
          const [wkR, dyR] = await Promise.all([
            fetch(`/api/yahoo?symbol=${encodeURIComponent(asset.symbolRaw)}&interval=1wk&range=2y&_t=${Date.now()}`),
            fetch(`/api/yahoo?symbol=${encodeURIComponent(asset.symbolRaw)}&interval=1d&range=1y&_t=${Date.now()}`),
          ]);
          if (!wkR.ok) throw new Error(`Yahoo ${wkR.status}`);
          if (!dyR.ok) throw new Error(`Yahoo daily ${dyR.status}`);
          const wk = await wkR.json();
          const dy = await dyR.json();
          wCloses  = wk.closes  || [];
          wVolumes = wk.volumes || [];
          wHighs   = wk.highs   || wCloses;
          wLows    = wk.lows    || wCloses;
          dCloses  = dy.closes  || [];
          // Yahoo 레이트 리밋 방지 딜레이
          await new Promise(r => setTimeout(r, 200));
        }
        if (!wCloses.length) throw new Error("데이터 없음");
        const result = analyzeAsset(wCloses, dCloses, wVolumes, wHighs, wLows, conditions);
        const match = mode === "or" ? result.triggers.length > 0 : conditions.every(c => result.triggers.includes(c));
        if (match) found.push({ ...asset, ...result });
      } catch (e) { errors.push(`${asset.market.toUpperCase()}:${asset.symbol} — ${e.message}`); }
      setScanProgress({ done: i + 1, total: all.length });
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

  // ────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text1, fontFamily: "'Pretendard', 'Apple SD Gothic Neo', system-ui, sans-serif" }}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }
        * { box-sizing: border-box; margin: 0; }
        ::-webkit-scrollbar { width: 4px; height: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: ${C.border2}; border-radius: 2px; }
        button, a { cursor: pointer; font-family: inherit; }
        input { font-family: inherit; }
        input:focus { border-color: ${C.blue} !important; }
        @media (max-width: 640px) {
          .desktop-nav { display: none !important; }
          .mobile-menu-btn { display: block !important; }
        }
        @media (min-width: 641px) {
          .mobile-dropdown { display: none !important; }
        }
      `}</style>

      {/* ── 헤더 ──────────────────────────────────────────────────── */}
      <header style={{
        position: "sticky", top: 0, zIndex: 100,
        background: `${C.bg}f0`, backdropFilter: "blur(12px)",
        borderBottom: `1px solid ${C.border}`,
      }}>
        <div style={{ maxWidth: "900px", margin: "0 auto", padding: "0 20px", display: "flex", alignItems: "center", justifyContent: "space-between", height: "56px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontSize: "20px" }}>📡</span>
            <span style={{ fontWeight: 800, fontSize: "17px" }}>DI금융</span>
            <span style={{ padding: "1px 7px", borderRadius: "4px", fontSize: "10px", fontWeight: 700, background: C.blueBg, color: C.blue }}>v4</span>
          </div>
          {/* 데스크톱 네비게이션 */}
          <nav className="desktop-nav" style={{ display: "flex", gap: "2px" }}>
            {[{ id: "screener", label: "스크리너", icon: "🔍" }, { id: "strategy", label: "전략", icon: "🎯" }, { id: "backtest", label: "백테스트", icon: "📊" }, { id: "portfolio", label: "포트폴리오", icon: "💼" }, { id: "news", label: "뉴스", icon: "📰" }, { id: "alerts", label: "알림", icon: "🔔" }].map(t => (
              <button key={t.id} onClick={() => setTab(t.id)} style={{
                padding: "6px 10px", borderRadius: "8px", fontSize: "12px", fontWeight: 600,
                background: tab === t.id ? C.blueBg : "transparent",
                color: tab === t.id ? C.blue : C.text3, border: "none", whiteSpace: "nowrap",
              }}>{t.icon} {t.label}</button>
            ))}
          </nav>
          {/* 모바일 햄버거 */}
          <button className="mobile-menu-btn" onClick={() => setMenuOpen(!menuOpen)} style={{
            display: "none", background: "none", border: "none", color: C.text2,
            fontSize: "22px", padding: "4px 8px", cursor: "pointer",
          }}>
            {menuOpen ? "✕" : "☰"}
          </button>
        </div>
        {/* 모바일 드롭다운 메뉴 */}
        {menuOpen && (
          <div className="mobile-dropdown" style={{
            background: C.card, borderTop: `1px solid ${C.border}`,
            padding: "8px 16px 12px", display: "flex", flexDirection: "column", gap: "2px",
          }}>
            {[{ id: "screener", label: "스크리너", icon: "🔍" }, { id: "strategy", label: "전략", icon: "🎯" }, { id: "backtest", label: "백테스트", icon: "📊" }, { id: "portfolio", label: "포트폴리오", icon: "💼" }, { id: "news", label: "뉴스", icon: "📰" }, { id: "alerts", label: "알림", icon: "🔔" }].map(t => (
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

      <main style={{ maxWidth: "900px", margin: "0 auto", padding: "20px" }}>

        {/* ═══════════════════════════════════════════════════════════
            TAB: 스크리너
        ═══════════════════════════════════════════════════════════ */}
        {tab === "screener" && (
          <div>
            {/* 조건 선택 패널 */}
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "16px", padding: "20px", marginBottom: "16px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "14px" }}>
                <div style={{ fontWeight: 700, fontSize: "15px" }}>⚙️ 스크리닝 조건</div>
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

              <div style={{ fontSize: "11px", color: C.text3, fontWeight: 600, letterSpacing: ".05em", marginBottom: "8px" }}>기본 조건</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "7px", marginBottom: "14px" }}>
                {Object.entries(CONDITION_META).filter(([, v]) => v.category === "기본").map(([key, meta]) => {
                  const on = conditions.includes(key);
                  return (
                    <button key={key} onClick={() => setConditions(p => on ? p.filter(c => c !== key) : [...p, key])}
                      title={meta.desc} style={{
                        padding: "6px 12px", borderRadius: "10px", fontSize: "12px", fontWeight: 600,
                        background: on ? `${C.blue}22` : C.card2, color: on ? C.blue : C.text3,
                        border: `1px solid ${on ? C.blue : C.border2}`,
                      }}>{meta.icon} {meta.label}</button>
                  );
                })}
              </div>

              <div style={{ fontSize: "11px", color: C.text3, fontWeight: 600, letterSpacing: ".05em", marginBottom: "8px" }}>전문가 조건</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "7px", marginBottom: "18px" }}>
                {Object.entries(CONDITION_META).filter(([, v]) => v.category === "전문가").map(([key, meta]) => {
                  const on = conditions.includes(key);
                  return (
                    <button key={key} onClick={() => setConditions(p => on ? p.filter(c => c !== key) : [...p, key])}
                      title={meta.desc} style={{
                        padding: "6px 12px", borderRadius: "10px", fontSize: "12px", fontWeight: 600,
                        background: on ? `${C.purple}22` : C.card2, color: on ? C.purple : C.text3,
                        border: `1px solid ${on ? C.purple : C.border2}`,
                      }}>{meta.icon} {meta.label}</button>
                  );
                })}
              </div>

              <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
                <button onClick={runScan} disabled={scanning || conditions.length === 0} style={{
                  padding: "11px 24px", borderRadius: "12px", fontSize: "14px", fontWeight: 700,
                  background: scanning ? C.card2 : C.blue, color: scanning ? C.text3 : "#fff", border: "none",
                  minWidth: "120px",
                }}>
                  {scanning
                    ? <span style={{ display: "flex", alignItems: "center", gap: "8px", justifyContent: "center" }}>
                        <span style={{ animation: "pulse 1s infinite" }}>⏳</span> {scanProgress.done}/{scanProgress.total}
                      </span>
                    : "🔍 스캔 시작"}
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
                <div style={{ fontSize: "44px", marginBottom: "16px" }}>📡</div>
                <div style={{ fontWeight: 700, fontSize: "18px", marginBottom: "8px" }}>스캔 대기 중</div>
                <div style={{ color: C.text3, fontSize: "14px", lineHeight: 1.7 }}>
                  조건 선택 후 <strong style={{ color: C.blue }}>스캔 시작</strong>을 눌러주세요<br />
                  미국 · 한국 주식 + 크립토 {US_ASSETS.length + KR_ASSETS.length + CRYPTO_ASSETS.length}개 자산 분석
                </div>
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {filtered.map((asset, i) => (
                <AssetCard key={`${asset.symbol}-${i}`} asset={asset} onChart={() => setChartAsset(asset)} />
              ))}
            </div>

            {!scanning && results.length > 0 && filtered.length === 0 && (
              <div style={{ textAlign: "center", padding: "32px", color: C.text3 }}>선택한 시장에 시그널 없음</div>
            )}
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════
            TAB: 포트폴리오
        ═══════════════════════════════════════════════════════════ */}
        {tab === "portfolio" && (
          <div>
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
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "12px" }}>
                  {[
                    { k: "symbol",   label: "심볼 (예: AAPL, 005930)", ph: "심볼 입력" },
                    { k: "name",     label: "이름 (예: Apple, 삼성전자)", ph: "자산명" },
                    { k: "qty",      label: "보유 수량", ph: "0.00" },
                    { k: "avgPrice", label: "평균 매입가", ph: "0.00" },
                  ].map(({ k, label, ph }) => (
                    <div key={k}>
                      <div style={{ fontSize: "11px", color: C.text3, marginBottom: "4px" }}>{label}</div>
                      <input value={newAsset[k]} onChange={e => setNewAsset(p => ({ ...p, [k]: e.target.value }))}
                        placeholder={ph} style={{
                          width: "100%", padding: "9px 12px", borderRadius: "10px", fontSize: "13px",
                          background: C.bg, border: `1px solid ${C.border2}`, color: C.text1, outline: "none",
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
                  }} style={{ padding: "9px 20px", borderRadius: "10px", fontSize: "13px", fontWeight: 700, background: C.blue, color: "#fff", border: "none" }}>추가하기</button>
                  <button onClick={() => setShowAddAsset(false)} style={{ padding: "9px 16px", borderRadius: "10px", fontSize: "13px", background: C.card2, color: C.text3, border: `1px solid ${C.border2}` }}>취소</button>
                </div>
              </div>
            )}

            {/* 포트폴리오 빈 상태 */}
            {portfolio.length === 0 && !showAddAsset && (
              <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "16px", padding: "48px 24px", textAlign: "center" }}>
                <div style={{ fontSize: "40px", marginBottom: "16px" }}>💼</div>
                <div style={{ fontWeight: 700, fontSize: "17px", marginBottom: "8px" }}>포트폴리오가 비어 있어요</div>
                <div style={{ color: C.text3, fontSize: "13px", marginBottom: "20px", lineHeight: 1.7 }}>
                  토스증권에서 보유 중인 자산을 추가하면<br />수익률을 실시간으로 추적할 수 있어요
                </div>
                <button onClick={() => setShowAddAsset(true)} style={{
                  padding: "11px 24px", borderRadius: "12px", fontSize: "14px", fontWeight: 700,
                  background: C.blue, color: "#fff", border: "none",
                }}>+ 첫 자산 추가하기</button>
              </div>
            )}

            {/* 포트폴리오 아이템 */}
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {portfolio.map((item, idx) => {
                const cur = portfolioPrices[item.symbol];
                const invested = item.qty * item.avgPrice;
                const current  = cur ? item.qty * cur : null;
                const pnl      = current != null ? current - invested : null;
                const pnlPct   = pnl != null && invested > 0 ? (pnl / invested) * 100 : null;
                const isUp = pnl != null && pnl >= 0;
                const mcBg = item.market === "us" ? "#1A2C4F" : item.market === "kr" ? "#1A2A1E" : "#1E1A2A";
                const mcC  = item.market === "us" ? C.blue : item.market === "kr" ? C.green : C.purple;
                return (
                  <div key={idx} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "14px", padding: "16px 20px" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                        <div style={{ width: "42px", height: "42px", borderRadius: "12px", background: mcBg, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: "10px", color: mcC }}>
                          {item.symbol.slice(0, 4)}
                        </div>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: "15px" }}>{item.name || item.symbol}</div>
                          <div style={{ fontSize: "12px", color: C.text3 }}>{item.symbol} · {item.qty.toLocaleString()} 주</div>
                        </div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontWeight: 700, fontSize: "16px" }}>
                          {cur ? toDisplay(cur, item.market) : <span style={{ color: C.text3 }}>—</span>}
                        </div>
                        {pnlPct != null && (
                          <div style={{ fontSize: "13px", color: isUp ? C.green : C.red, fontWeight: 600 }}>
                            {isUp ? "▲" : "▼"} {Math.abs(pnlPct).toFixed(2)}%
                          </div>
                        )}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: "16px", marginTop: "12px", paddingTop: "12px", borderTop: `1px solid ${C.border}`, flexWrap: "wrap" }}>
                      {[
                        { label: "평균 매입가",   value: toDisplay(item.avgPrice, item.market) },
                        { label: "총 투자금액",   value: toDisplay(invested, item.market) },
                        { label: "현재 평가금액", value: current != null ? toDisplay(current, item.market) : "—" },
                        { label: "손익",          value: pnl != null ? `${isUp ? "+" : ""}${toDisplay(Math.abs(pnl), item.market)}` : "—", color: pnl != null ? (isUp ? C.green : C.red) : C.text2 },
                      ].map(({ label, value, color }) => (
                        <div key={label}>
                          <div style={{ fontSize: "10px", color: C.text3, marginBottom: "2px" }}>{label}</div>
                          <div style={{ fontSize: "13px", fontWeight: 600, color: color || C.text2 }}>{value}</div>
                        </div>
                      ))}
                      <button onClick={() => setPortfolio(p => p.filter((_, i) => i !== idx))} style={{
                        marginLeft: "auto", alignSelf: "flex-end", padding: "4px 10px", borderRadius: "7px",
                        fontSize: "11px", background: "transparent", color: C.text3, border: `1px solid ${C.border2}`,
                      }}>삭제</button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* 기기간 동기화 */}
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "16px", padding: "20px", marginTop: "16px" }}>
              <div style={{ fontWeight: 700, fontSize: "15px", marginBottom: "12px" }}>🔄 기기간 동기화</div>
              <div style={{ fontSize: "12px", color: C.text3, marginBottom: "12px", lineHeight: 1.6 }}>
                PIN을 설정하면 PC/모바일 간 포트폴리오와 설정을 동기화할 수 있어요.<br />
                같은 PIN을 입력하면 어느 기기에서든 같은 데이터를 불러올 수 있어요.
              </div>
              <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                <input value={syncPin} onChange={e => { setSyncPin(e.target.value); setSettings(p => ({ ...p, syncPin: e.target.value })); }}
                  placeholder="동기화 PIN (4자리 이상)" style={{
                    padding: "9px 14px", borderRadius: "10px", fontSize: "13px", width: "180px",
                    background: C.bg, border: `1px solid ${C.border2}`, color: C.text1, outline: "none",
                  }} />
                <button onClick={syncUpload} style={{
                  padding: "9px 14px", borderRadius: "10px", fontSize: "12px", fontWeight: 700,
                  background: C.blueBg, color: C.blue, border: `1px solid ${C.blue}44`, cursor: "pointer",
                }}>⬆️ 업로드</button>
                <button onClick={syncDownload} style={{
                  padding: "9px 14px", borderRadius: "10px", fontSize: "12px", fontWeight: 700,
                  background: C.greenBg, color: C.green, border: `1px solid ${C.green}44`, cursor: "pointer",
                }}>⬇️ 다운로드</button>
              </div>
              {syncStatus && (
                <div style={{ marginTop: "8px", fontSize: "12px", color: syncStatus.startsWith("✅") ? C.green : syncStatus.startsWith("❌") ? C.red : C.blue }}>
                  {syncStatus}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════
            TAB: 전략
        ═══════════════════════════════════════════════════════════ */}
        {tab === "strategy" && (
          <StrategyPanel onRunBacktest={(strategy, symbol) => {
            setBtStrategy(strategy);
            setBtSymbol(symbol);
            setTab("backtest");
          }} />
        )}

        {/* ═══════════════════════════════════════════════════════════
            TAB: 백테스트
        ═══════════════════════════════════════════════════════════ */}
        {tab === "backtest" && (
          <BacktestPanel initialStrategy={btStrategy} initialSymbol={btSymbol} />
        )}

        {/* ═══════════════════════════════════════════════════════════
            TAB: 뉴스
        ═══════════════════════════════════════════════════════════ */}
        {tab === "news" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
              <div style={{ fontWeight: 700, fontSize: "16px" }}>📰 금융 뉴스 & 트렌딩</div>
              <button onClick={fetchNews} style={{
                padding: "6px 12px", borderRadius: "8px", fontSize: "12px", fontWeight: 600,
                background: C.blueBg, color: C.blue, border: `1px solid ${C.blue}44`,
              }}>{newsLoading ? "⏳ 로딩 중" : "🔄 새로고침"}</button>
            </div>

            {newsLoading && newsItems.length === 0 && (
              <div style={{ textAlign: "center", padding: "40px", color: C.text3 }}>
                <div style={{ fontSize: "24px", marginBottom: "8px" }}>📡</div>
                뉴스를 불러오는 중...
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {newsItems.map((item, i) => (
                <a key={i} href={item.url} target="_blank" rel="noopener noreferrer"
                  style={{
                    background: C.card, border: `1px solid ${C.border}`, borderRadius: "14px",
                    padding: "16px 20px", textDecoration: "none", color: "inherit",
                    display: "block", transition: "border-color .15s",
                  }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = C.border2}
                  onMouseLeave={e => e.currentTarget.style.borderColor = C.border}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px" }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: "14px", color: C.text1, marginBottom: "6px", lineHeight: 1.5 }}>
                        {item.title}
                      </div>
                      {item.desc && (
                        <div style={{ fontSize: "12px", color: C.text3, lineHeight: 1.5, marginBottom: "6px" }}>
                          {item.desc}
                        </div>
                      )}
                      <div style={{ display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" }}>
                        <span style={{
                          padding: "2px 8px", borderRadius: "6px", fontSize: "10px", fontWeight: 700,
                          background: item.source?.includes("CoinGecko") ? `${C.purple}22` : `${C.blue}22`,
                          color: item.source?.includes("CoinGecko") ? C.purple : C.blue,
                        }}>{item.source}</span>
                        {(item.tags || []).map((tag, ti) => (
                          <span key={ti} style={{
                            padding: "1px 6px", borderRadius: "4px", fontSize: "9px", fontWeight: 600,
                            background: `${C.yellow}15`, color: C.yellow,
                          }}>{tag}</span>
                        ))}
                        {item.date && (
                          <span style={{ fontSize: "11px", color: C.text3 }}>
                            {(() => {
                              try {
                                const d = new Date(item.date);
                                const diff = Math.floor((Date.now() - d.getTime()) / 60000);
                                if (diff < 60) return `${diff}분 전`;
                                if (diff < 1440) return `${Math.floor(diff / 60)}시간 전`;
                                return d.toLocaleDateString("ko-KR");
                              } catch { return ""; }
                            })()}
                          </span>
                        )}
                      </div>
                    </div>
                    <span style={{ color: C.text3, fontSize: "16px", flexShrink: 0, marginTop: "2px" }}>→</span>
                  </div>
                </a>
              ))}
            </div>

            {!newsLoading && newsItems.length === 0 && (
              <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "16px", padding: "48px 24px", textAlign: "center" }}>
                <div style={{ fontSize: "40px", marginBottom: "16px" }}>📰</div>
                <div style={{ fontWeight: 700, fontSize: "17px", marginBottom: "8px" }}>뉴스를 불러올 수 없어요</div>
                <div style={{ color: C.text3, fontSize: "13px" }}>새로고침을 눌러 다시 시도해 주세요</div>
              </div>
            )}
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════
            TAB: 알림 설정
        ═══════════════════════════════════════════════════════════ */}
        {tab === "alerts" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "16px", padding: "20px" }}>
              <div style={{ fontWeight: 700, fontSize: "16px", marginBottom: "16px" }}>🔔 텔레그램 알림 설정</div>

              <div style={{ background: C.blueBg, borderRadius: "12px", padding: "14px", marginBottom: "18px", fontSize: "13px", color: C.text2, lineHeight: 1.8 }}>
                <strong style={{ color: C.blue }}>설정 방법</strong><br />
                1️⃣ 텔레그램 → <strong>@BotFather</strong> → /newbot → 봇 생성<br />
                2️⃣ 발급받은 <strong>Bot Token</strong> 입력<br />
                3️⃣ 생성한 봇에게 메시지 전송 후 아래 링크에서 Chat ID 확인<br />
                <a href={`https://api.telegram.org/bot${settings.botToken}/getUpdates`}
                  target="_blank" rel="noopener" style={{ color: C.blueL, wordBreak: "break-all" }}>
                  https://api.telegram.org/bot{"<TOKEN>"}/getUpdates
                </a>
              </div>

              {[{ k: "botToken", label: "Bot Token", ph: "8749984490:AAH..." }, { k: "chatId", label: "Chat ID", ph: "5202880452" }].map(({ k, label, ph }) => (
                <div key={k} style={{ marginBottom: "14px" }}>
                  <div style={{ fontSize: "12px", color: C.text3, marginBottom: "5px", fontWeight: 600 }}>{label}</div>
                  <input value={settings[k]} onChange={e => setSettings(p => ({ ...p, [k]: e.target.value }))}
                    placeholder={ph} style={{
                      width: "100%", padding: "10px 14px", borderRadius: "10px", fontSize: "13px",
                      background: C.bg, border: `1px solid ${C.border2}`, color: C.text1, outline: "none",
                    }} />
                </div>
              ))}

              <div style={{ padding: "8px 14px", background: `${C.green}15`, borderRadius: "8px", marginBottom: "14px", fontSize: "12px", color: C.green, display: "flex", alignItems: "center", gap: "6px" }}>
                <span>💾</span> 설정은 자동 저장됩니다 — 새로고침해도 유지돼요
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "12px 14px", background: C.bg, borderRadius: "12px", marginBottom: "16px" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: "13px", marginBottom: "2px" }}>스캔 완료 시 자동 전송</div>
                  <div style={{ fontSize: "12px", color: C.text3 }}>시그널 감지 시 자동으로 알림 전송</div>
                </div>
                <div onClick={() => setSettings(p => ({ ...p, autoSend: !p.autoSend }))} style={{
                  width: "44px", height: "24px", borderRadius: "12px", cursor: "pointer",
                  background: settings.autoSend ? C.blue : C.border2, position: "relative", transition: "background .2s",
                }}>
                  <div style={{
                    position: "absolute", top: "2px", width: "20px", height: "20px", borderRadius: "10px",
                    background: "#fff", transition: "left .2s", left: settings.autoSend ? "22px" : "2px",
                  }} />
                </div>
              </div>

              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                <button onClick={async () => {
                  if (!settings.botToken || !settings.chatId) { setTgStatus("❌ 토큰과 Chat ID를 입력하세요"); return; }
                  setTgStatus("📡 전송 중...");
                  try {
                    const r = await sendTelegramAlert(settings.botToken, settings.chatId,
                      [{ name: "DI금융", symbol: "TEST", market: "us", price: 100, weekChange: 0.5, rsi: 28.5, triggers: ["rsi30"] }], ["rsi30"]);
                    setTgStatus(r.ok ? "✅ 테스트 메시지 전송 완료!" : `❌ ${r.description}`);
                  } catch (e) { setTgStatus(`❌ ${e.message}`); }
                }} style={{
                  padding: "10px 20px", borderRadius: "10px", fontSize: "13px", fontWeight: 700,
                  background: C.blue, color: "#fff", border: "none",
                }}>📤 테스트 전송</button>

                {results.length > 0 && (
                  <button onClick={async () => {
                    if (!settings.botToken || !settings.chatId) { setTgStatus("❌ 설정 필요"); return; }
                    setTgStatus("📡 전송 중...");
                    try {
                      const r = await sendTelegramAlert(settings.botToken, settings.chatId, results, conditions);
                      setTgStatus(r.ok ? `✅ ${results.length}개 전송 완료!` : `❌ ${r.description}`);
                    } catch (e) { setTgStatus(`❌ ${e.message}`); }
                  }} style={{
                    padding: "10px 20px", borderRadius: "10px", fontSize: "13px", fontWeight: 700,
                    background: C.greenBg, color: C.green, border: `1px solid ${C.green}44`,
                  }}>📊 스캔 결과 전송 ({results.length}개)</button>
                )}
              </div>

              {tgStatus && (
                <div style={{
                  marginTop: "12px", padding: "10px 14px", borderRadius: "10px", fontSize: "13px",
                  background: tgStatus.startsWith("✅") ? C.greenBg : tgStatus.startsWith("❌") ? C.redBg : C.blueBg,
                  color: tgStatus.startsWith("✅") ? C.green : tgStatus.startsWith("❌") ? C.red : C.blue,
                  border: `1px solid ${tgStatus.startsWith("✅") ? C.green : tgStatus.startsWith("❌") ? C.red : C.blue}44`,
                }}>{tgStatus}</div>
              )}
            </div>

            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "16px", padding: "20px" }}>
              <div style={{ fontWeight: 700, fontSize: "15px", marginBottom: "12px" }}>⏰ 자동 스캔 (Vercel Cron)</div>
              <div style={{ fontSize: "13px", color: C.text2, lineHeight: 1.9 }}>
                현재 <strong style={{ color: C.green }}>평일 오전 9시</strong> 자동 스캔 예약됨<br />
                스케줄 변경: <code style={{ background: C.bg, padding: "1px 6px", borderRadius: "4px", fontSize: "12px" }}>vercel.json</code> → cron 표현식 수정 후 재배포<br />
                환경변수: Vercel Dashboard → Settings → Environment Variables<br />
                <code style={{ background: C.bg, padding: "1px 6px", borderRadius: "4px", fontSize: "12px" }}>TELEGRAM_BOT_TOKEN</code> ·{" "}
                <code style={{ background: C.bg, padding: "1px 6px", borderRadius: "4px", fontSize: "12px" }}>TELEGRAM_CHAT_ID</code>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* 캔들 차트 모달 */}
      {chartAsset && <ChartModal asset={chartAsset} onClose={() => setChartAsset(null)} />}
    </div>
  );
}
