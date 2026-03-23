// ════════════════════════════════════════════════════════════════════
// DI금융 — ₿ 비트코인 전용 자동매매 시스템 v1.0
// BTC 알파 멀티팩터 전략 기반 실시간 시그널 + 자동매매 시뮬레이션
// CoinGecko API + Yahoo Finance 연동
// ════════════════════════════════════════════════════════════════════
import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { ALL_STRATEGIES, runBacktest, diagnoseMarket } from "./strategies.js";

const DARK_C = {
  bg: "#0B0F19", card: "#131B2E", card2: "#1A2438",
  border: "#1F2E42", border2: "#2A3F58",
  blue: "#3B8BFF", blueL: "#64ABFF", blueBg: "#182D54",
  red: "#FF4D5E", redBg: "#2C1520",
  green: "#00D47E", greenBg: "#0B2E1E",
  yellow: "#FFC233", yellowBg: "#2B2100",
  purple: "#9B6FFF", purpleBg: "#201840",
  orange: "#FF6B2C", orangeBg: "#2A1A0A",
  text1: "#F0F2F7", text2: "#94A3B8", text3: "#64748B",
  isDark: true,
};
const LIGHT_C = {
  bg: "#F8F9FB", card: "#FFFFFF", card2: "#F1F3F6",
  border: "#E2E5EA", border2: "#D1D5DC",
  blue: "#2563EB", blueL: "#3B82F6", blueBg: "#DBEAFE",
  red: "#DC2626", redBg: "#FEF2F2",
  green: "#16A34A", greenBg: "#F0FDF4",
  yellow: "#D97706", yellowBg: "#FFFBEB",
  purple: "#7C3AED", purpleBg: "#F3F0FF",
  orange: "#EA580C", orangeBg: "#FFF7ED",
  text1: "#0F172A", text2: "#475569", text3: "#94A3B8",
  isDark: false,
};

// BTC 관련 심볼
const BTC_ASSETS = [
  { sym: "BTC-USD", name: "Bitcoin", icon: "₿", weight: 0.40 },
  { sym: "ETH-USD", name: "Ethereum", icon: "Ξ", weight: 0.25 },
  { sym: "SOL-USD", name: "Solana", icon: "◎", weight: 0.15 },
  { sym: "BNB-USD", name: "BNB", icon: "◆", weight: 0.10 },
  { sym: "XRP-USD", name: "XRP", icon: "✕", weight: 0.10 },
];

// BTC Alpha strategy reference
const BTC_STRATEGY = ALL_STRATEGIES.find(s => s.id === "btc_alpha");

// ── Storage ──
const KEYS = {
  btcConfig: "di_btc_trading_config",
  btcLog: "di_btc_trade_log",
  btcSettings: "di_btc_settings",
};
function load(key, fb) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fb; } catch { return fb; } }
function save(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} }

// ── Yahoo Finance 캔들 fetch ──
async function fetchCandles(symbol, range = "6mo") {
  try {
    const res = await fetch(`/api/yahoo-chart?symbol=${encodeURIComponent(symbol)}&range=${range}&interval=1d`);
    if (!res.ok) return [];
    const data = await res.json();
    const ts = data.chart?.result?.[0]?.timestamp;
    const q = data.chart?.result?.[0]?.indicators?.quote?.[0];
    if (!ts || !q) return [];
    return ts.map((t, i) => ({
      time: t, open: q.open?.[i], high: q.high?.[i], low: q.low?.[i], close: q.close?.[i], volume: q.volume?.[i],
    })).filter(c => c.close != null && c.high != null && c.low != null);
  } catch { return []; }
}

// ── CoinGecko 가격 fetch ──
async function fetchCryptoPrices() {
  try {
    const res = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana,binancecoin,ripple&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true&include_market_cap=true");
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

const GECKO_MAP = { "BTC-USD": "bitcoin", "ETH-USD": "ethereum", "SOL-USD": "solana", "BNB-USD": "binancecoin", "XRP-USD": "ripple" };

export default function BTCTrading({ theme = "dark" }) {
  const C = theme === "dark" ? DARK_C : LIGHT_C;

  // ── State ──
  const [prices, setPrices] = useState({});
  const [signals, setSignals] = useState([]);
  const [btResult, setBtResult] = useState(null);
  const [marketDiag, setMarketDiag] = useState(null);
  const [loading, setLoading] = useState(true);
  const [autoMode, setAutoMode] = useState(load(KEYS.btcSettings, { enabled: false }).enabled);
  const [tradeLog, setTradeLog] = useState(load(KEYS.btcLog, []));
  const [simCapital, setSimCapital] = useState(load(KEYS.btcConfig, { capital: 10000 }).capital);
  const [subTab, setSubTab] = useState("overview"); // overview, signals, backtest, log
  const [lastUpdate, setLastUpdate] = useState(null);
  const [btcCandles, setBtcCandles] = useState([]);
  const timerRef = useRef(null);

  // ── 가격 + 시그널 로드 ──
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      // 1) CoinGecko 실시간 가격
      const geckoData = await fetchCryptoPrices();
      if (geckoData) {
        const priceMap = {};
        for (const asset of BTC_ASSETS) {
          const gId = GECKO_MAP[asset.sym];
          if (geckoData[gId]) {
            priceMap[asset.sym] = {
              price: geckoData[gId].usd,
              change24h: geckoData[gId].usd_24h_change,
              volume24h: geckoData[gId].usd_24h_vol,
              marketCap: geckoData[gId].usd_market_cap,
            };
          }
        }
        setPrices(priceMap);
      }

      // 2) BTC 캔들 → 시그널 생성
      const candles = await fetchCandles("BTC-USD", "1y");
      if (candles.length > 60) {
        setBtcCandles(candles);

        // BTC Alpha 시그널
        if (BTC_STRATEGY) {
          const sigs = BTC_STRATEGY.generate(candles);
          setSignals(sigs);

          // 백테스트
          const bt = runBacktest(candles, sigs, {
            initialCapital: simCapital,
            positionSize: 0.9,
            commission: 0.001,
            slippage: 0.001,
            stopLoss: 8,
            takeProfit: 15,
          });
          setBtResult(bt);
        }

        // 시장 진단
        const diag = diagnoseMarket(candles);
        setMarketDiag(diag);
      }

      setLastUpdate(new Date());
    } catch (e) {
      console.error("[BTC Trading] loadData error:", e);
    }
    setLoading(false);
  }, [simCapital]);

  useEffect(() => { loadData(); }, [loadData]);

  // 5분 자동 갱신
  useEffect(() => {
    timerRef.current = setInterval(loadData, 5 * 60 * 1000);
    return () => clearInterval(timerRef.current);
  }, [loadData]);

  // Auto mode toggle
  const toggleAuto = () => {
    const next = !autoMode;
    setAutoMode(next);
    save(KEYS.btcSettings, { enabled: next });
    if (next && signals.length > 0) {
      const latest = signals[signals.length - 1];
      const newLog = [...tradeLog, {
        time: new Date().toISOString(),
        type: latest.type,
        price: latest.price,
        reason: latest.reason,
        symbol: "BTC-USD",
        auto: true,
      }];
      setTradeLog(newLog);
      save(KEYS.btcLog, newLog);
    }
  };

  // 최근 시그널 (마지막 10개)
  const recentSignals = useMemo(() => {
    return signals.slice(-15).reverse().map(s => ({
      ...s,
      date: btcCandles[s.index]?.time ? new Date(btcCandles[s.index].time * 1000) : null,
    }));
  }, [signals, btcCandles]);

  // 최신 시그널
  const latestSignal = signals.length > 0 ? signals[signals.length - 1] : null;
  const latestSignalDate = latestSignal && btcCandles[latestSignal.index]?.time
    ? new Date(btcCandles[latestSignal.index].time * 1000) : null;

  // ── 통계 ──
  const btcPrice = prices["BTC-USD"]?.price;
  const btcChange = prices["BTC-USD"]?.change24h;
  const totalMarketCap = Object.values(prices).reduce((s, p) => s + (p.marketCap || 0), 0);

  // ════════════════════════════════════════════════════════════
  // RENDER
  // ════════════════════════════════════════════════════════════

  const cardStyle = {
    background: C.card, borderRadius: "16px", border: `1px solid ${C.border}`,
    padding: "20px", marginBottom: "16px",
  };
  const statBox = (label, value, color, sub) => (
    <div style={{ flex: 1, minWidth: "120px", padding: "14px 16px", borderRadius: "12px", background: C.card2, border: `1px solid ${C.border}` }}>
      <div style={{ fontSize: "11px", color: C.text3, marginBottom: "4px", fontWeight: 500 }}>{label}</div>
      <div style={{ fontSize: "18px", fontWeight: 800, color: color || C.text1 }}>{value}</div>
      {sub && <div style={{ fontSize: "10px", color: C.text3, marginTop: "2px" }}>{sub}</div>}
    </div>
  );

  return (
    <div style={{ maxWidth: "900px", margin: "0 auto" }}>
      {/* ── 헤더 ── */}
      <div style={{ ...cardStyle, background: `linear-gradient(135deg, ${C.orange}12, ${C.yellow}08)`, border: `1px solid ${C.orange}30` }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "12px" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "6px" }}>
              <span style={{ fontSize: "28px" }}>₿</span>
              <span style={{ fontSize: "20px", fontWeight: 800, color: C.text1 }}>BTC 자동매매</span>
              <span style={{ fontSize: "11px", padding: "3px 8px", borderRadius: "6px", background: C.orange + "20", color: C.orange, fontWeight: 700 }}>알파 전략</span>
            </div>
            <div style={{ fontSize: "12px", color: C.text3, maxWidth: "500px" }}>
              RSI·BB·MACD·EMA·거래량 멀티팩터 스코어링 — 비트코인 고변동성 최적화 자동매매
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            {/* Auto Toggle */}
            <div
              onClick={toggleAuto}
              style={{
                width: "52px", height: "28px", borderRadius: "14px", cursor: "pointer",
                background: autoMode ? C.green : C.card2, border: `1px solid ${autoMode ? C.green : C.border}`,
                position: "relative", transition: "all .3s",
              }}
            >
              <div style={{
                width: "22px", height: "22px", borderRadius: "50%", background: "#fff",
                position: "absolute", top: "2px", left: autoMode ? "27px" : "2px",
                transition: "left .3s", boxShadow: "0 1px 4px rgba(0,0,0,.2)",
              }} />
            </div>
            <span style={{ fontSize: "12px", fontWeight: 700, color: autoMode ? C.green : C.text3 }}>
              {autoMode ? "자동매매 ON" : "자동매매 OFF"}
            </span>
          </div>
        </div>
      </div>

      {/* ── BTC 실시간 가격 + 포트폴리오 ── */}
      <div style={{ ...cardStyle }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
          <span style={{ fontSize: "14px", fontWeight: 700, color: C.text1 }}>실시간 크립토 가격</span>
          {lastUpdate && <span style={{ fontSize: "10px", color: C.text3 }}>{lastUpdate.toLocaleTimeString("ko-KR")} 기준</span>}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {BTC_ASSETS.map(asset => {
            const p = prices[asset.sym];
            if (!p) return (
              <div key={asset.sym} style={{ display: "flex", alignItems: "center", padding: "10px 14px", borderRadius: "10px", background: C.card2, gap: "10px" }}>
                <span style={{ fontSize: "20px", width: "28px", textAlign: "center" }}>{asset.icon}</span>
                <span style={{ flex: 1, fontSize: "13px", fontWeight: 600, color: C.text2 }}>{asset.name}</span>
                <span style={{ fontSize: "12px", color: C.text3 }}>로딩중...</span>
              </div>
            );
            const isUp = p.change24h >= 0;
            return (
              <div key={asset.sym} style={{
                display: "flex", alignItems: "center", padding: "10px 14px", borderRadius: "10px",
                background: C.card2, gap: "10px", border: asset.sym === "BTC-USD" ? `1px solid ${C.orange}30` : "none",
              }}>
                <span style={{ fontSize: "20px", width: "28px", textAlign: "center" }}>{asset.icon}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <span style={{ fontSize: "13px", fontWeight: 700, color: C.text1 }}>{asset.name}</span>
                    <span style={{ fontSize: "10px", color: C.text3 }}>{asset.sym}</span>
                    <span style={{ fontSize: "9px", padding: "1px 5px", borderRadius: "4px", background: C.purpleBg, color: C.purple, fontWeight: 600 }}>{(asset.weight * 100).toFixed(0)}%</span>
                  </div>
                  {p.volume24h && <div style={{ fontSize: "10px", color: C.text3, marginTop: "2px" }}>24h Vol: ${(p.volume24h / 1e9).toFixed(1)}B</div>}
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: "14px", fontWeight: 800, color: C.text1 }}>${p.price?.toLocaleString()}</div>
                  <div style={{ fontSize: "11px", fontWeight: 700, color: isUp ? C.green : C.red }}>
                    {isUp ? "+" : ""}{p.change24h?.toFixed(2)}%
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── 탭 네비게이션 ── */}
      <div style={{ display: "flex", gap: "6px", marginBottom: "16px", overflowX: "auto", padding: "2px" }}>
        {[
          { id: "overview", label: "전략 개요", icon: "📊" },
          { id: "signals", label: "매매 시그널", icon: "🔔" },
          { id: "backtest", label: "백테스트", icon: "📈" },
          { id: "log", label: "매매 기록", icon: "📋" },
        ].map(t => (
          <button key={t.id} onClick={() => setSubTab(t.id)} style={{
            padding: "8px 14px", borderRadius: "10px", fontSize: "12px", fontWeight: 700,
            background: subTab === t.id ? C.blueBg : C.card2,
            color: subTab === t.id ? C.blue : C.text3,
            border: `1px solid ${subTab === t.id ? C.blue + "40" : C.border}`,
            cursor: "pointer", whiteSpace: "nowrap", transition: "all .2s",
          }}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* ═══ SUB: 전략 개요 ═══ */}
      {subTab === "overview" && (
        <>
          {/* 최신 시그널 카드 */}
          {latestSignal && (
            <div style={{
              ...cardStyle,
              background: latestSignal.type === "BUY"
                ? `linear-gradient(135deg, ${C.green}12, ${C.green}05)`
                : `linear-gradient(135deg, ${C.red}12, ${C.red}05)`,
              border: `1px solid ${latestSignal.type === "BUY" ? C.green : C.red}30`,
            }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span style={{
                    padding: "4px 10px", borderRadius: "6px", fontSize: "12px", fontWeight: 800,
                    background: latestSignal.type === "BUY" ? C.greenBg : C.redBg,
                    color: latestSignal.type === "BUY" ? C.green : C.red,
                  }}>
                    {latestSignal.type === "BUY" ? "매수" : "매도"} 시그널
                  </span>
                  <span style={{ fontSize: "11px", color: C.text3 }}>최신</span>
                </div>
                {latestSignalDate && (
                  <span style={{ fontSize: "11px", color: C.text3 }}>
                    {latestSignalDate.toLocaleDateString("ko-KR")}
                  </span>
                )}
              </div>
              <div style={{ fontSize: "13px", color: C.text2, lineHeight: 1.5 }}>
                {latestSignal.reason}
              </div>
              <div style={{ fontSize: "12px", color: C.text3, marginTop: "6px" }}>
                시그널 가격: ${latestSignal.price?.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </div>
            </div>
          )}

          {/* 시장 진단 */}
          {marketDiag && (
            <div style={cardStyle}>
              <div style={{ fontSize: "13px", fontWeight: 700, color: C.text1, marginBottom: "12px" }}>₿ BTC 시장 진단</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                {statBox("시장 국면", marketDiag.regime, C.blue)}
                {statBox("추세", marketDiag.trend, marketDiag.trend === "상승" ? C.green : marketDiag.trend === "하락" ? C.red : C.yellow)}
                {statBox("변동성", marketDiag.volatility, marketDiag.volatility === "높음" ? C.red : C.green)}
                {statBox("모멘텀", marketDiag.momentum, C.purple)}
                {statBox("RSI", marketDiag.rsi?.toFixed(1) || "-", marketDiag.rsi > 70 ? C.red : marketDiag.rsi < 30 ? C.green : C.text1)}
                {statBox("ATR%", marketDiag.atrPct?.toFixed(2) + "%", C.orange)}
              </div>
            </div>
          )}

          {/* 전략 설명 */}
          <div style={cardStyle}>
            <div style={{ fontSize: "13px", fontWeight: 700, color: C.text1, marginBottom: "10px" }}>₿ BTC 알파 전략 구성</div>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {[
                { icon: "📉", name: "RSI (25/75)", desc: "크립토 조정 과매수/과매도 임계값" },
                { icon: "🎯", name: "BB (2.5σ)", desc: "고변동성 대응 볼린저밴드" },
                { icon: "📊", name: "MACD 가속도", desc: "히스토그램 방향전환 모멘텀 확인" },
                { icon: "📈", name: "EMA 21/55", desc: "중기 추세필터 + 골든/데드크로스" },
                { icon: "🔥", name: "거래량 2x 폭증", desc: "평균 대비 2배 이상 거래량 감지" },
                { icon: "💥", name: "스퀴즈 브레이크아웃", desc: "BB 밴드폭 40% 축소 후 방향성 돌파" },
                { icon: "🔀", name: "RSI 다이버전스", desc: "가격-RSI 괴리 강세/약세 전환 감지" },
                { icon: "💪", name: "ADX 추세강도", desc: "ADX 20+ 추세 확인 보너스" },
              ].map((f, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "8px 12px", borderRadius: "8px", background: C.card2 }}>
                  <span style={{ fontSize: "16px" }}>{f.icon}</span>
                  <div>
                    <div style={{ fontSize: "12px", fontWeight: 700, color: C.text1 }}>{f.name}</div>
                    <div style={{ fontSize: "11px", color: C.text3 }}>{f.desc}</div>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: "12px", padding: "10px 14px", borderRadius: "8px", background: C.orangeBg, border: `1px solid ${C.orange}20` }}>
              <div style={{ fontSize: "11px", color: C.orange, fontWeight: 600 }}>
                멀티팩터 스코어링: 각 팩터에 1~3점 배점 → 합산 5점 이상 시 시그널 발생
              </div>
            </div>
          </div>
        </>
      )}

      {/* ═══ SUB: 매매 시그널 ═══ */}
      {subTab === "signals" && (
        <div style={cardStyle}>
          <div style={{ fontSize: "13px", fontWeight: 700, color: C.text1, marginBottom: "4px" }}>
            매매 시그널 히스토리
          </div>
          <div style={{ fontSize: "11px", color: C.text3, marginBottom: "14px" }}>
            BTC 알파 전략이 감지한 최근 시그널 (일봉 기준)
          </div>
          {loading ? (
            <div style={{ textAlign: "center", padding: "40px", color: C.text3 }}>로딩중...</div>
          ) : recentSignals.length === 0 ? (
            <div style={{ textAlign: "center", padding: "40px", color: C.text3 }}>시그널 없음</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              {recentSignals.map((s, i) => (
                <div key={i} style={{
                  display: "flex", alignItems: "center", gap: "10px", padding: "10px 14px",
                  borderRadius: "10px", background: C.card2,
                  borderLeft: `3px solid ${s.type === "BUY" ? C.green : C.red}`,
                }}>
                  <span style={{
                    padding: "3px 8px", borderRadius: "5px", fontSize: "11px", fontWeight: 800,
                    background: s.type === "BUY" ? C.greenBg : C.redBg,
                    color: s.type === "BUY" ? C.green : C.red, minWidth: "36px", textAlign: "center",
                  }}>
                    {s.type === "BUY" ? "매수" : "매도"}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "12px", color: C.text2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {s.reason}
                    </div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div style={{ fontSize: "12px", fontWeight: 700, color: C.text1 }}>${s.price?.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
                    {s.date && <div style={{ fontSize: "10px", color: C.text3 }}>{s.date.toLocaleDateString("ko-KR", { month: "short", day: "numeric" })}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ═══ SUB: 백테스트 ═══ */}
      {subTab === "backtest" && (
        <div style={cardStyle}>
          <div style={{ fontSize: "13px", fontWeight: 700, color: C.text1, marginBottom: "4px" }}>
            백테스트 결과 (1년)
          </div>
          <div style={{ fontSize: "11px", color: C.text3, marginBottom: "14px" }}>
            BTC-USD · 일봉 · 초기자본 ${simCapital.toLocaleString()} · 손절 8% · 익절 15%
          </div>
          {!btResult ? (
            <div style={{ textAlign: "center", padding: "40px", color: C.text3 }}>데이터 로딩중...</div>
          ) : (
            <>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "16px" }}>
                {statBox("총 수익률", `${btResult.totalReturn >= 0 ? "+" : ""}${btResult.totalReturn}%`,
                  btResult.totalReturn >= 0 ? C.green : C.red)}
                {statBox("최종 자산", `$${btResult.finalEquity.toLocaleString()}`,
                  btResult.finalEquity > simCapital ? C.green : C.red,
                  `초기 $${simCapital.toLocaleString()}`)}
                {statBox("승률", `${btResult.winRate}%`, btResult.winRate >= 50 ? C.green : C.red)}
                {statBox("총 거래", `${btResult.totalTrades}회`, C.blue)}
                {statBox("샤프비율", btResult.sharpeRatio.toFixed(2), btResult.sharpeRatio > 1 ? C.green : C.yellow)}
                {statBox("프로핏팩터", btResult.profitFactor === Infinity ? "∞" : btResult.profitFactor.toFixed(2),
                  btResult.profitFactor > 1.5 ? C.green : C.yellow)}
                {statBox("최대 낙폭", `-${btResult.maxDrawdown}%`, C.red)}
                {statBox("Buy&Hold", `${btResult.buyHoldReturn >= 0 ? "+" : ""}${btResult.buyHoldReturn}%`,
                  btResult.buyHoldReturn >= 0 ? C.green : C.red, "비교 벤치마크")}
                {statBox("평균 수익", `${btResult.avgWin >= 0 ? "+" : ""}${btResult.avgWin}%`, C.green, "승리 거래")}
                {statBox("평균 손실", `${btResult.avgLoss}%`, C.red, "패배 거래")}
                {statBox("연속 손실", `${btResult.maxConsecLoss}회`, C.red, "최대 연속")}
              </div>

              {/* 전략 vs Buy & Hold */}
              <div style={{
                padding: "12px 16px", borderRadius: "10px",
                background: btResult.totalReturn > btResult.buyHoldReturn ? C.greenBg : C.redBg,
                border: `1px solid ${btResult.totalReturn > btResult.buyHoldReturn ? C.green : C.red}20`,
              }}>
                <div style={{
                  fontSize: "12px", fontWeight: 700,
                  color: btResult.totalReturn > btResult.buyHoldReturn ? C.green : C.red,
                }}>
                  {btResult.totalReturn > btResult.buyHoldReturn
                    ? `전략이 Buy&Hold 대비 +${(btResult.totalReturn - btResult.buyHoldReturn).toFixed(1)}%p 초과 수익`
                    : `Buy&Hold 대비 ${(btResult.totalReturn - btResult.buyHoldReturn).toFixed(1)}%p — 리스크 관리로 낙폭 제한`
                  }
                </div>
              </div>

              {/* 거래 히스토리 */}
              {btResult.trades.length > 0 && (
                <div style={{ marginTop: "16px" }}>
                  <div style={{ fontSize: "12px", fontWeight: 700, color: C.text2, marginBottom: "8px" }}>최근 거래 ({Math.min(btResult.trades.length, 20)}건)</div>
                  <div style={{ maxHeight: "300px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "4px" }}>
                    {btResult.trades.slice(-20).reverse().map((t, i) => (
                      <div key={i} style={{
                        display: "flex", alignItems: "center", gap: "8px", padding: "6px 10px",
                        borderRadius: "6px", background: C.card2, fontSize: "11px",
                      }}>
                        <span style={{
                          padding: "2px 6px", borderRadius: "4px", fontWeight: 800, fontSize: "10px",
                          background: t.type === "BUY" ? C.greenBg : C.redBg,
                          color: t.type === "BUY" ? C.green : C.red,
                        }}>{t.type === "BUY" ? "매수" : "매도"}</span>
                        <span style={{ color: C.text2, flex: 1 }}>{t.reason}</span>
                        <span style={{ fontWeight: 700, color: C.text1 }}>${t.price?.toFixed(0)}</span>
                        {t.pnlPct != null && (
                          <span style={{ fontWeight: 700, color: t.pnlPct >= 0 ? C.green : C.red, minWidth: "50px", textAlign: "right" }}>
                            {t.pnlPct >= 0 ? "+" : ""}{t.pnlPct.toFixed(1)}%
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ═══ SUB: 매매 기록 ═══ */}
      {subTab === "log" && (
        <div style={cardStyle}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "14px" }}>
            <div>
              <div style={{ fontSize: "13px", fontWeight: 700, color: C.text1 }}>자동매매 기록</div>
              <div style={{ fontSize: "11px", color: C.text3 }}>시뮬레이션 매매 히스토리</div>
            </div>
            {tradeLog.length > 0 && (
              <button onClick={() => { setTradeLog([]); save(KEYS.btcLog, []); }} style={{
                padding: "5px 10px", borderRadius: "6px", fontSize: "11px", fontWeight: 600,
                background: C.card2, color: C.text3, border: `1px solid ${C.border}`, cursor: "pointer",
              }}>초기화</button>
            )}
          </div>
          {tradeLog.length === 0 ? (
            <div style={{ textAlign: "center", padding: "40px", color: C.text3 }}>
              <div style={{ fontSize: "28px", marginBottom: "8px" }}>₿</div>
              <div style={{ fontSize: "13px", fontWeight: 600, marginBottom: "4px" }}>아직 매매 기록이 없습니다</div>
              <div style={{ fontSize: "11px" }}>자동매매를 켜면 시그널 발생 시 자동으로 기록됩니다</div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              {tradeLog.slice().reverse().map((t, i) => (
                <div key={i} style={{
                  display: "flex", alignItems: "center", gap: "8px", padding: "8px 12px",
                  borderRadius: "8px", background: C.card2, fontSize: "11px",
                }}>
                  <span style={{
                    padding: "2px 6px", borderRadius: "4px", fontWeight: 800, fontSize: "10px",
                    background: t.type === "BUY" ? C.greenBg : C.redBg,
                    color: t.type === "BUY" ? C.green : C.red,
                  }}>{t.type === "BUY" ? "매수" : "매도"}</span>
                  <span style={{ color: C.text2, flex: 1 }}>{t.reason}</span>
                  <span style={{ fontWeight: 700, color: C.text1 }}>${t.price?.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                  <span style={{ color: C.text3, fontSize: "10px" }}>{new Date(t.time).toLocaleDateString("ko-KR")}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── 푸터 ── */}
      <div style={{ textAlign: "center", padding: "16px", fontSize: "10px", color: C.text3, lineHeight: 1.5 }}>
        ₿ BTC 알파 전략 · 멀티팩터 스코어링 시스템<br/>
        시뮬레이션 전용 — 실제 투자 판단은 본인의 책임입니다
      </div>
    </div>
  );
}
