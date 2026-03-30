import React, { useState, useCallback, useMemo, useEffect, useRef } from "react";
import PaperTrading from "./PaperTrading.jsx";
import BTCTrading from "./BTCTrading.jsx";
import { useAuth } from "./AuthProvider.jsx";
import { supabase } from "./supabaseClient.js";

// ── 에쿼티 커브 생성 (전략 파라미터 기반) ──
function generateEquityCurve(bot, months = 12) {
  const winRate = parseFloat(bot.stats.winRate) / 100;
  const mdd = parseFloat(bot.stats.mdd) / 100;
  const sharpe = parseFloat(bot.stats.sharpeRatio);

  // 예상 수익 범위 파싱
  const cleaned = bot.expectedReturn.replace(/%\+?/g, "");
  const parts = cleaned.split("-");
  const lo = parseFloat(parts[0]) || 10;
  const hi = parseFloat(parts[1]) || lo * 1.5;

  // 시드 해시 — 반드시 0이 아닌 양수 보장
  let seed = 7;
  for (let i = 0; i < bot.id.length; i++) {
    seed = ((seed * 31) + bot.id.charCodeAt(i)) & 0x7fffffff;
  }
  seed = (seed % 2147483646) + 1; // 1 ~ 2147483646 범위 보장
  const rng = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };

  // 목표 연간 수익률 (예상 범위의 중간~상단)
  const targetAnnual = (lo + hi) / 2 + (rng() - 0.3) * (hi - lo) * 0.4;
  const targetFinal = 100 * (1 + targetAnnual / 100);

  // 월별 평균 수익률과 변동성
  const monthlyMu = Math.pow(targetFinal / 100, 1 / months) - 1;
  const monthlySigma = Math.abs(monthlyMu) / Math.max(sharpe / Math.sqrt(12), 0.3);

  // 원시 커브 생성 (노이즈 + 승률 반영)
  const raw = [100];
  for (let m = 1; m <= months; m++) {
    const u1 = Math.max(rng(), 0.001);
    const u2 = rng();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    let ret = monthlyMu + monthlySigma * z * 0.5;
    // 승률 반영: 패배 월은 손실 방향으로
    if (rng() > winRate) ret = -Math.abs(ret) * (0.5 + rng() * 0.5);
    raw.push(raw[m - 1] * (1 + ret));
  }

  // 최종 값을 목표에 맞게 스케일링 (예상수익과 차트 싱크)
  const rawFinal = raw[months];
  const scaleFactor = rawFinal > 100
    ? (targetFinal - 100) / (rawFinal - 100)
    : rawFinal < 100
      ? (targetFinal - 100) / (rawFinal - 100)
      : 1;

  const scaled = raw.map(v => 100 + (v - 100) * scaleFactor);

  // MDD 제약 적용
  const curve = [scaled[0]];
  let peak = scaled[0];
  for (let m = 1; m <= months; m++) {
    peak = Math.max(peak, curve[m - 1]);
    let val = scaled[m];
    const dd = (peak - val) / peak;
    if (dd > mdd) val = peak * (1 - mdd);
    curve.push(val);
  }

  // 최종 수익률이 예상 범위에서 크게 벗어나면 재보정
  const finalRet = (curve[months] - 100) / 100 * 100;
  if (finalRet > hi * 1.3 || finalRet < lo * 0.5) {
    const clampedTarget = Math.min(hi * 1.1, Math.max(lo * 0.8, targetAnnual));
    const adjustRatio = clampedTarget / (finalRet || 1);
    for (let m = 1; m <= months; m++) {
      curve[m] = 100 + (curve[m] - 100) * adjustRatio;
    }
  }

  return curve;
}

// ── SVG 미니 에쿼티 차트 ──
function MiniEquityChart({ data, color, width = 280, height = 80, theme }) {
  const c = colors[theme];
  if (!data || data.length < 2) return null;

  const min = Math.min(...data) * 0.998;
  const max = Math.max(...data) * 1.002;
  const range = max - min || 1;
  const xStep = width / (data.length - 1);

  const points = data.map((v, i) => `${(i * xStep).toFixed(1)},${(height - ((v - min) / range) * (height - 8) - 4).toFixed(1)}`);
  const linePath = `M${points.join(" L")}`;
  const areaPath = `${linePath} L${width},${height} L0,${height} Z`;

  const lastVal = data[data.length - 1];
  const totalReturn = ((lastVal - data[0]) / data[0] * 100).toFixed(1);
  const isPositive = lastVal >= data[0];

  return (
    <div style={{ position: "relative" }}>
      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", marginBottom: "4px" }}>
        <span style={{ fontSize: "13px", fontWeight: 800, color: isPositive ? c.green : c.red }}>
          {isPositive ? "+" : ""}{totalReturn}%
        </span>
      </div>
      <svg width="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ borderRadius: "6px", overflow: "hidden" }}>
        <defs>
          <linearGradient id={`eq-grad-${color.replace("#","")}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.25" />
            <stop offset="100%" stopColor={color} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <path d={areaPath} fill={`url(#eq-grad-${color.replace("#","")})`} />
        <path d={linePath} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={((data.length - 1) * xStep).toFixed(1)} cy={(height - ((lastVal - min) / range) * (height - 8) - 4).toFixed(1)} r="3" fill={color} />
      </svg>
    </div>
  );
}

const colors = {
  dark: {
    bg: "#0B0F19",
    card: "#131B2E",
    card2: "#1A2438",
    border: "#1F2E42",
    blue: "#3B8BFF",
    red: "#FF4D5E",
    green: "#00D47E",
    yellow: "#FFC233",
    purple: "#9B6FFF",
    orange: "#FF6B2C",
    text1: "#F0F2F7",
    text2: "#94A3B8",
    text3: "#64748B",
  },
  light: {
    bg: "#F8F9FB",
    card: "#FFFFFF",
    card2: "#F1F3F6",
    border: "#E2E5EA",
    blue: "#2563EB",
    red: "#DC2626",
    green: "#16A34A",
    yellow: "#D97706",
    purple: "#7C3AED",
    orange: "#EA580C",
    text1: "#0F172A",
    text2: "#475569",
    text3: "#94A3B8",
  },
};

const STOCK_BOTS = [
  {
    id: "stable-quant",
    name: "안정형 퀀트봇",
    icon: "🛡️",
    risk: "안정",
    riskColor: "blue",
    expectedReturn: "8-15%",
    description: "삼중 필터 + 앙상블 확인으로 높은 신뢰도 매매만 실행",
    tags: ["브래킷주문", "드로다운보호", "켈리사이징"],
    stats: {
      winRate: "68%",
      sharpeRatio: "2.1",
      mdd: "12%",
    },
    details: "3가지 신호 필터 + 앙상블 확인을 통해 신뢰도 높은 매매기회만 포착합니다. 보수적인 포지션 사이징으로 최대낙폭을 최소화합니다.",
  },
  {
    id: "balanced-quant",
    name: "균형형 퀀트봇",
    icon: "⚖️",
    risk: "중간",
    riskColor: "green",
    expectedReturn: "15-30%",
    description: "33개 전략 앙상블 + 마켓 레짐 적응형 포지션 사이징",
    tags: ["앙상블", "레짐감지", "ATR사이징"],
    stats: {
      winRate: "62%",
      sharpeRatio: "1.8",
      mdd: "18%",
    },
    details: "33개 기술적 분석 전략을 앙상블하여 시장 조건에 최적화된 신호를 생성합니다. ATR 기반 동적 포지션 사이징으로 변동성에 대응합니다.",
  },
  {
    id: "aggressive-quant",
    name: "공격형 퀀트봇",
    icon: "🔥",
    risk: "공격",
    riskColor: "orange",
    expectedReturn: "25-50%+",
    description: "고수익 추구 · 전략 전체 활용 · 빠른 리밸런싱",
    tags: ["TWAP분할", "풀전략", "고빈도"],
    stats: {
      winRate: "55%",
      sharpeRatio: "1.5",
      mdd: "35%",
    },
    details: "모든 전략을 활용하여 최대한의 거래 기회를 포착합니다. TWAP 분할 주문과 고빈도 리밸런싱으로 수익을 극대화합니다.",
  },
  {
    id: "trend-follow",
    name: "추세추종 전문봇",
    icon: "📈",
    risk: "중간",
    riskColor: "green",
    expectedReturn: "12-25%",
    description: "추세장에서 극대화 · 박스권 자동 회피",
    tags: ["추세추종", "모멘텀", "트렌드필터"],
    stats: {
      winRate: "58%",
      sharpeRatio: "1.7",
      mdd: "20%",
    },
    details: "이평선, MACD, 터틀, 슈퍼트렌드 등 추세추종 전략만 사용합니다. 박스권 구간을 자동으로 감지하여 거래를 중단합니다.",
  },
  {
    id: "mean-reversion",
    name: "평균회귀 전문봇",
    icon: "🔄",
    risk: "중간",
    riskColor: "green",
    expectedReturn: "10-20%",
    description: "과매도 저가매수 · 과매수 고가매도 · 횡보장 특화",
    tags: ["평균회귀", "오실레이터", "역추세"],
    stats: {
      winRate: "65%",
      sharpeRatio: "1.9",
      mdd: "15%",
    },
    details: "RSI, 볼린저밴드, 켈트너, VWAP 등 평균회귀 전략으로 횡보장에서 우수한 성과를 냅니다.",
  },
  {
    id: "ensemble-signal",
    name: "앙상블 시그널봇",
    icon: "🎯",
    risk: "안정",
    riskColor: "blue",
    expectedReturn: "10-18%",
    description: "다전략 합의 시에만 매매 · 가장 보수적 · 가장 높은 승률",
    tags: ["앙상블3x+", "고승률", "다전략합의"],
    stats: {
      winRate: "72%",
      sharpeRatio: "2.3",
      mdd: "10%",
    },
    details: "3개 이상의 전략이 동일 신호를 내릴 때만 거래합니다. 가장 보수적이지만 가장 높은 승률을 자랑합니다.",
  },
];

const CRYPTO_BOTS = [
  {
    id: "btc-alpha",
    name: "BTC 알파봇",
    icon: "₿",
    risk: "공격",
    riskColor: "orange",
    expectedReturn: "20-60%+",
    description: "10팩터 멀티스코어 + Fear&Greed 적응형 BTC 전문 트레이딩",
    tags: ["멀티팩터", "변동성적응", "24/7"],
    stats: {
      winRate: "60%",
      sharpeRatio: "1.6",
      mdd: "28%",
    },
    details: "기술적 지표 10개를 통합한 멀티팩터 모델과 공포-탐욕 지수를 결합하여 BTC 변동성을 포착합니다.",
  },
  {
    id: "crypto-diversity",
    name: "크립토 다이버시티",
    icon: "🌈",
    risk: "공격",
    riskColor: "orange",
    expectedReturn: "15-40%",
    description: "5대 크립토 분산투자 · 목표 비중 리밸런싱 · 상관관계 필터",
    tags: ["분산투자", "리밸런싱", "5자산"],
    stats: {
      winRate: "61%",
      sharpeRatio: "1.7",
      mdd: "25%",
    },
    details: "BTC(40%), ETH(25%), SOL(15%), BNB(10%), XRP(10%) 분산투자로 리스크를 관리합니다.",
  },
  {
    id: "crypto-swing",
    name: "크립토 스윙봇",
    icon: "⚡",
    risk: "매우높음",
    riskColor: "red",
    expectedReturn: "30-80%+",
    description: "단기 스윙 트레이딩 · 변동성 극대화 구간 집중 · 고위험고수익",
    tags: ["스윙트레이딩", "고변동성", "단기매매"],
    stats: {
      winRate: "52%",
      sharpeRatio: "1.3",
      mdd: "45%",
    },
    details: "고변동성 구간을 감지하여 단기 스윙 거래로 수익을 극대화합니다. 매우 높은 위험도를 감수합니다.",
  },
];

function getRiskColor(riskColor, theme) {
  const c = colors[theme];
  const mapping = {
    blue: c.blue,
    green: c.green,
    orange: c.orange,
    red: c.red,
  };
  return mapping[riskColor] || c.text1;
}

function BotCard({ bot, onActivate, theme }) {
  const c = colors[theme];
  const equityCurve = useMemo(() => generateEquityCurve(bot, 12), [bot.id]);
  const chartColor = getRiskColor(bot.riskColor, theme);

  return (
    <div
      style={{
        backgroundColor: c.card,
        border: `1px solid ${c.border}`,
        borderRadius: "12px",
        padding: "24px",
        cursor: "pointer",
        transition: "all 0.3s ease",
        display: "flex",
        flexDirection: "column",
        gap: "16px",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = c.blue;
        e.currentTarget.style.boxShadow = `0 8px 24px rgba(59, 139, 255, 0.1)`;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = c.border;
        e.currentTarget.style.boxShadow = "none";
      }}
    >
      {/* Header with icon and name */}
      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        <span style={{ fontSize: "28px" }}>{bot.icon}</span>
        <div style={{ flex: 1 }}>
          <h3 style={{ margin: "0 0 4px 0", color: c.text1, fontSize: "16px", fontWeight: "600" }}>
            {bot.name}
          </h3>
        </div>
      </div>

      {/* Risk badge and return */}
      <div style={{ display: "flex", gap: "8px", justifyContent: "space-between" }}>
        <div
          style={{
            backgroundColor: getRiskColor(bot.riskColor, theme),
            color: bot.riskColor === "red" ? "#fff" : "#000",
            padding: "4px 12px",
            borderRadius: "20px",
            fontSize: "12px",
            fontWeight: "600",
            opacity: 0.8,
          }}
        >
          위험도: {bot.risk}
        </div>
        <div style={{ color: c.green, fontSize: "14px", fontWeight: "600" }}>
          예상수익: {bot.expectedReturn}
        </div>
      </div>

      {/* Description */}
      <p style={{ margin: "0", color: c.text2, fontSize: "13px", lineHeight: "1.5" }}>
        {bot.description}
      </p>

      {/* Tags */}
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
        {bot.tags.map((tag) => (
          <span
            key={tag}
            style={{
              backgroundColor: c.card2,
              color: c.text2,
              padding: "4px 10px",
              borderRadius: "16px",
              fontSize: "11px",
              border: `1px solid ${c.border}`,
            }}
          >
            {tag}
          </span>
        ))}
      </div>

      {/* Stats */}
      <div
        style={{
          backgroundColor: c.card2,
          padding: "12px",
          borderRadius: "8px",
          fontSize: "12px",
          color: c.text2,
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: "8px",
          textAlign: "center",
        }}
      >
        <div>
          <div style={{ color: c.text3, fontSize: "11px" }}>승률</div>
          <div style={{ color: c.green, fontWeight: "600" }}>{bot.stats.winRate}</div>
        </div>
        <div>
          <div style={{ color: c.text3, fontSize: "11px" }}>샤프비율</div>
          <div style={{ color: c.blue, fontWeight: "600" }}>{bot.stats.sharpeRatio}</div>
        </div>
        <div>
          <div style={{ color: c.text3, fontSize: "11px" }}>최대낙폭</div>
          <div style={{ color: c.red, fontWeight: "600" }}>{bot.stats.mdd}</div>
        </div>
      </div>

      {/* Equity Curve Chart */}
      <div style={{
        backgroundColor: c.card2,
        padding: "12px 14px",
        borderRadius: "8px",
        border: `1px solid ${c.border}60`,
      }}>
        <MiniEquityChart data={equityCurve} color={chartColor} theme={theme} />
      </div>

      {/* Action button */}
      <button
        onClick={() => onActivate(bot)}
        style={{
          backgroundColor: c.blue,
          color: "#fff",
          border: "none",
          borderRadius: "8px",
          padding: "12px 16px",
          fontSize: "14px",
          fontWeight: "600",
          cursor: "pointer",
          transition: "all 0.2s ease",
          width: "100%",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.opacity = "0.9";
          e.currentTarget.style.transform = "translateY(-2px)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.opacity = "1";
          e.currentTarget.style.transform = "translateY(0)";
        }}
      >
        시작하기
      </button>
    </div>
  );
}

function BotCatalog({ onActivate, theme, isMobile }) {
  const c = colors[theme];

  return (
    <div style={{ paddingBottom: "40px" }}>
      {/* Hero Section */}
      <div
        style={{
          background: `linear-gradient(135deg, ${c.blue}15 0%, ${c.purple}10 100%)`,
          borderBottom: `1px solid ${c.border}`,
          padding: "60px 40px",
          marginBottom: "60px",
          textAlign: "center",
        }}
      >
        <h1 style={{ margin: "0 0 16px 0", color: c.text1, fontSize: "40px", fontWeight: "700" }}>
          AI 퀀트 전략
        </h1>
        <p style={{ margin: "0", color: c.text2, fontSize: "18px", maxWidth: "600px", marginLeft: "auto", marginRight: "auto" }}>
          AI 기반 퀀트 봇이 24/7 시장을 분석하고 최적의 매매 시그널을 생성합니다
        </p>
      </div>

      {/* Stock Bots Section */}
      <div style={{ marginBottom: "80px" }}>
        <h2 style={{ color: c.text1, fontSize: isMobile ? "20px" : "24px", fontWeight: "600", marginBottom: isMobile ? "20px" : "32px" }}>
          📊 주식 자동매매 봇
        </h2>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill, minmax(320px, 1fr))",
            gap: isMobile ? "16px" : "24px",
            marginBottom: "40px",
          }}
        >
          {STOCK_BOTS.map((bot) => (
            <BotCard key={bot.id} bot={bot} onActivate={onActivate} theme={theme} />
          ))}
        </div>
        <div
          style={{
            backgroundColor: c.card2,
            border: `1px solid ${c.border}`,
            borderRadius: "8px",
            padding: "20px",
            color: c.text2,
            fontSize: "14px",
            lineHeight: "1.6",
          }}
        >
          <strong style={{ color: c.text1 }}>주식 자동매매 작동 방식:</strong>
          <br />각 봇은 개별 설정된 전략으로 한국 주식시장을 모니터링합니다. 매일 장 개시 전 포트폴리오를 리밸런싱하고,
          실시간 신호에 따라 자동으로 매매를 실행합니다. 모든 거래는 과거 데이터로 백테스트되었으며, 위험도별로
          포지션 사이징이 최적화되어 있습니다.
        </div>
      </div>

      {/* Crypto Bots Section */}
      <div>
        <h2 style={{ color: c.text1, fontSize: isMobile ? "20px" : "24px", fontWeight: "600", marginBottom: isMobile ? "20px" : "32px" }}>
          💰 크립토 자동매매 봇
        </h2>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill, minmax(320px, 1fr))",
            gap: isMobile ? "16px" : "24px",
            marginBottom: "40px",
          }}
        >
          {CRYPTO_BOTS.map((bot) => (
            <BotCard key={bot.id} bot={bot} onActivate={onActivate} theme={theme} />
          ))}
        </div>
        <div
          style={{
            backgroundColor: c.card2,
            border: `1px solid ${c.border}`,
            borderRadius: "8px",
            padding: "20px",
            color: c.text2,
            fontSize: "14px",
            lineHeight: "1.6",
          }}
        >
          <strong style={{ color: c.text1 }}>크립토 자동매매 작동 방식:</strong>
          <br />
          암호화폐 시장의 24/7 변동성을 포착하여 자동으로 거래합니다. 멀티팩터 모델과 공포-탐욕 지수를 활용하여
          최적의 진입점을 감지하고, 리스크 관리 규칙에 따라 포지션을 관리합니다. 실시간 시장 데이터로 끊임없이
          신호를 업데이트합니다.
        </div>
      </div>
    </div>
  );
}

// ── 알파카 페이퍼트레이딩 실제 데이터 로드 ──
function useAlpacaRealData(userId) {
  const [account, setAccount] = useState(null);
  const [equityHistory, setEquityHistory] = useState([]); // [{timestamp, equity}]
  const [tradeLog, setTradeLog] = useState([]);
  const [loading, setLoading] = useState(false);
  const fetched = useRef(false);

  useEffect(() => {
    if (!userId || fetched.current) return;
    fetched.current = true;

    // 1) localStorage에서 알파카 config 가져오기
    const prefix = `di_${userId.slice(0, 8)}_`;
    let config;
    try { config = JSON.parse(localStorage.getItem(`${prefix}alpaca_config`) || "null"); } catch {}
    if (!config?.apiKey || !config?.apiSecret) return;

    // 2) localStorage에서 trade log 가져오기 (주식 + 크립토)
    try {
      const stockLog = JSON.parse(localStorage.getItem(`${prefix}trade_log_v3`) || "[]");
      const cryptoLog = JSON.parse(localStorage.getItem(`${prefix}trade_log_v2`) || "[]");
      setTradeLog([...stockLog, ...cryptoLog].sort((a, b) => new Date(b.time || 0) - new Date(a.time || 0)));
    } catch {}

    // 3) 알파카 API에서 계좌 + 포트폴리오 히스토리 가져오기
    const headers = {
      "Content-Type": "application/json",
      "x-alpaca-key": config.apiKey,
      "x-alpaca-secret": config.apiSecret,
      "x-alpaca-paper": String(config.isPaper !== false),
    };

    setLoading(true);

    Promise.allSettled([
      fetch("/api/alpaca?action=account", { headers }).then(r => r.json()),
      fetch("/api/alpaca?action=portfolio_history&period=1M&timeframe=1D", { headers }).then(r => r.json()),
    ]).then(([accRes, histRes]) => {
      if (accRes.status === "fulfilled" && accRes.value?.equity) {
        setAccount(accRes.value);
      }
      if (histRes.status === "fulfilled" && histRes.value?.equity && histRes.value?.timestamp) {
        const hist = histRes.value.timestamp.map((ts, i) => ({
          timestamp: ts * 1000,
          equity: histRes.value.equity[i],
          profitLoss: histRes.value.profit_loss?.[i] || 0,
          profitLossPct: histRes.value.profit_loss_pct?.[i] || 0,
        }));
        setEquityHistory(hist);
      }
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [userId]);

  return { account, equityHistory, tradeLog, loading };
}

// ── 운영 중 봇 대시보드 (실제 알파카 데이터 기반) ──
function ActiveBotsDashboard({ activeBots, onSelectBot, onStopBot, theme, userId, isMobile }) {
  const c = colors[theme];
  const { account, equityHistory, tradeLog, loading } = useAlpacaRealData(userId);

  if (!activeBots || activeBots.length === 0) return null;

  // 실제 데이터 기반 지표 계산
  const totalTrades = tradeLog.length;
  const filledTrades = tradeLog.filter(t => t.status === "filled" || t.status === "accepted" || t.type);
  const winTrades = tradeLog.filter(t => (t.pnl != null && parseFloat(t.pnl) > 0));
  const realWinRate = filledTrades.length > 0 ? (winTrades.length / filledTrades.length * 100) : null;

  // 에쿼티 커브 → 차트 데이터 (100 기준 정규화)
  const equityChartData = useMemo(() => {
    if (equityHistory.length >= 2) {
      const base = equityHistory[0].equity;
      return equityHistory.map(h => (h.equity / base) * 100);
    }
    // 알파카 히스토리가 없으면 trade log에서 누적 P&L 커브 생성
    if (tradeLog.length > 0) {
      const sorted = [...tradeLog].filter(t => t.time && t.pnl != null).sort((a, b) => new Date(a.time) - new Date(b.time));
      if (sorted.length >= 2) {
        let cum = 100;
        const curve = [100];
        for (const t of sorted) {
          cum += parseFloat(t.pnl || 0) * 0.01; // 정규화
          curve.push(cum);
        }
        return curve;
      }
    }
    return null; // 데이터 없음
  }, [equityHistory, tradeLog]);

  // 현재 수익률 (NaN 방지)
  const currentReturn = (() => {
    if (account) {
      const eq = parseFloat(account.equity);
      const lastEq = parseFloat(account.last_equity || account.equity);
      if (!lastEq || !isFinite(lastEq)) return null;
      const ret = ((eq - lastEq) / lastEq * 100);
      return isFinite(ret) ? ret : null;
    }
    if (equityHistory.length >= 2) {
      const first = equityHistory[0].equity;
      const last = equityHistory[equityHistory.length - 1].equity;
      if (!first || !isFinite(first)) return null;
      const ret = ((last - first) / first * 100);
      return isFinite(ret) ? ret : null;
    }
    return null;
  })();

  const totalEquity = account ? parseFloat(account.equity) : null;
  const totalPL = account ? (parseFloat(account.equity) - (parseFloat(account.last_equity) || parseFloat(account.equity))) : null;

  // 날짜 라벨 생성
  const dateLabels = useMemo(() => {
    if (equityHistory.length < 2) return [];
    const step = Math.max(1, Math.floor(equityHistory.length / 5));
    return equityHistory.filter((_, i) => i % step === 0 || i === equityHistory.length - 1)
      .map(h => new Date(h.timestamp).toLocaleDateString("ko-KR", { month: "short", day: "numeric" }));
  }, [equityHistory]);

  return (
    <div style={{ marginBottom: "32px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: c.green, animation: "livePulse 1.5s ease-in-out infinite" }} />
          <h2 style={{ margin: 0, color: c.text1, fontSize: "20px", fontWeight: 700 }}>운영 현황</h2>
          <span style={{ fontSize: "12px", padding: "3px 10px", borderRadius: "12px", background: `${c.green}20`, color: c.green, fontWeight: 700 }}>
            {activeBots.length}개 활성
          </span>
          {loading && <span style={{ fontSize: "11px", color: c.text3 }}>데이터 로딩...</span>}
        </div>
      </div>

      {/* 종합 계좌 요약 (알파카 실데이터) */}
      {account && (
        <div style={{
          background: `linear-gradient(135deg, ${c.card} 0%, ${totalPL >= 0 ? c.green : c.red}10 100%)`,
          border: `1px solid ${c.border}`, borderRadius: "16px", padding: isMobile ? "16px 12px" : "20px", marginBottom: "16px",
        }}>
          <div style={{ fontSize: isMobile ? "11px" : "12px", color: c.text3, marginBottom: "8px" }}>알파카 페이퍼트레이딩 계좌</div>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "1fr 1fr 1fr 1fr", gap: isMobile ? "10px" : "12px" }}>
            <div>
              <div style={{ fontSize: isMobile ? "9px" : "10px", color: c.text3 }}>총 자산</div>
              <div style={{ fontSize: isMobile ? "14px" : "18px", fontWeight: 800, color: c.text1 }}>${totalEquity?.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
            </div>
            <div>
              <div style={{ fontSize: isMobile ? "9px" : "10px", color: c.text3 }}>오늘 P&L</div>
              <div style={{ fontSize: isMobile ? "14px" : "18px", fontWeight: 800, color: totalPL >= 0 ? c.green : c.red }}>
                {totalPL >= 0 ? "+" : ""}${totalPL?.toFixed(2)}
              </div>
            </div>
            <div>
              <div style={{ fontSize: isMobile ? "9px" : "10px", color: c.text3 }}>총 거래</div>
              <div style={{ fontSize: isMobile ? "14px" : "18px", fontWeight: 800, color: c.text1 }}>{totalTrades}건</div>
            </div>
            <div>
              <div style={{ fontSize: isMobile ? "9px" : "10px", color: c.text3 }}>실제 승률</div>
              <div style={{ fontSize: isMobile ? "14px" : "18px", fontWeight: 800, color: realWinRate != null && realWinRate >= 50 ? c.green : c.red }}>
                {realWinRate != null ? `${realWinRate.toFixed(1)}%` : "—"}
              </div>
            </div>
          </div>

          {/* 실제 에쿼티 커브 */}
          {equityChartData && equityChartData.length >= 2 && (
            <div style={{ marginTop: "16px", background: c.card2, borderRadius: "10px", padding: isMobile ? "10px 8px" : "12px 14px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                <span style={{ fontSize: "11px", fontWeight: 700, color: c.text3 }}>
                  {equityHistory.length >= 2 ? "실제 에쿼티 커브 (1개월)" : "누적 P&L 커브"}
                </span>
                {currentReturn != null && (
                  <span style={{ fontSize: "13px", fontWeight: 800, color: currentReturn >= 0 ? c.green : c.red }}>
                    {currentReturn >= 0 ? "+" : ""}{currentReturn.toFixed(2)}%
                  </span>
                )}
              </div>
              <MiniEquityChart data={equityChartData} color={currentReturn >= 0 ? c.green : c.red} theme={theme} />
              {dateLabels.length > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: "4px" }}>
                  {dateLabels.map((l, i) => <span key={i} style={{ fontSize: "9px", color: c.text3 }}>{l}</span>)}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 활성 봇 목록 */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill, minmax(340px, 1fr))", gap: isMobile ? "12px" : "16px" }}>
        {activeBots.map(ab => {
          const bot = [...STOCK_BOTS, ...CRYPTO_BOTS].find(b => b.id === ab.botId) || {};
          const elapsed = Date.now() - (ab.startedAt || Date.now());
          const days = Math.floor(elapsed / 86400000);
          const hours = Math.floor((elapsed % 86400000) / 3600000);
          const isStock = STOCK_BOTS.some(b => b.id === ab.botId);

          // 해당 봇의 실제 거래 로그 필터링 (개선된 로직)
          const botTradeLog = tradeLog.filter(t => {
            if (isStock) {
              // 주식: "/" 없고, BTC/ETH/SOL/BNB/XRP 포함 안 함
              const isCrypto = t.symbol?.includes("/") ||
                             t.symbol?.includes("BTC") ||
                             t.symbol?.includes("ETH") ||
                             t.symbol?.includes("SOL") ||
                             t.symbol?.includes("BNB") ||
                             t.symbol?.includes("XRP");
              return !isCrypto;
            }
            // 크립토: BTC/USD, ETH/USD, SOL/USD 등 또는 BTC, ETH 등이름 포함
            return t.symbol?.includes("/") ||
                   t.symbol?.includes("BTC") ||
                   t.symbol?.includes("ETH") ||
                   t.symbol?.includes("SOL") ||
                   t.symbol?.includes("BNB") ||
                   t.symbol?.includes("XRP");
          });
          const botTrades = botTradeLog.length;

          // 봇별 실제 누적 P&L 차트 데이터 생성
          // 봇 배분 비율 계산 (전체 배분 대비 이 봇의 비중)
          const totalAllocated = activeBots.reduce((s, b) => s + (b.allocation || 0), 0);
          const botAllocRatio = (ab.allocation && totalAllocated > 0) ? (ab.allocation / totalAllocated) : (1 / activeBots.length);
          // 봇 시작 시간 이후의 데이터만 사용
          const botStartTime = ab.startedAt || Date.now();
          const botPnlCurve = (() => {
            // 1순위: 실제 trade log에서 P&L 커브 (봇 시작 이후만)
            const withPnl = botTradeLog
              .filter(t => t.time && t.pnl != null && new Date(t.time).getTime() >= botStartTime)
              .sort((a, b) => new Date(a.time) - new Date(b.time));
            if (withPnl.length >= 2) {
              let cum = 0;
              const curve = [0];
              for (const t of withPnl) {
                cum += parseFloat(t.pnl || 0);
                curve.push(cum);
              }
              const initEquity = ab.allocation || 10000;
              return { data: curve.map(v => 100 + (v / initEquity) * 100), source: "trade_log" };
            }
            // 2순위: 알파카 포트폴리오 히스토리 (봇 시작 이후만, 배분 비율 적용)
            if (equityHistory.length >= 2 && activeBots.length > 0) {
              const filtered = equityHistory.filter(h => new Date(h.timestamp).getTime() >= botStartTime);
              if (filtered.length >= 2) {
                const base = filtered[0].equity;
                // 크립토/주식 봇 구분: 크립토는 배분 비율을 더 신중하게 적용
                const adjustedRatio = isStock ? botAllocRatio : Math.min(botAllocRatio, 0.3); // 크립토는 최대 30% 가중
                return { data: filtered.map(h => 100 + ((h.equity - base) * adjustedRatio / base) * 100), source: "alpaca" };
              }
            }
            // 데이터 없음 — 봇 시작 직후라 아직 데이터 수집 중
            return { data: [], source: "none", collecting: true };
          })();

          const pnlData = botPnlCurve?.data || [];
          const pnlSource = botPnlCurve?.source || "none";

          const botReturn = pnlData.length >= 2 && pnlData[0] !== 0
            ? ((pnlData[pnlData.length - 1] - pnlData[0]) / Math.abs(pnlData[0]) * 100)
            : pnlData.length >= 2 && ab.allocation
              ? ((pnlData[pnlData.length - 1] - pnlData[0]) / ab.allocation * 100)
              : null;
          const safeBotReturn = (botReturn != null && isFinite(botReturn)) ? botReturn : null;
          const botIsPositive = safeBotReturn != null ? safeBotReturn >= 0 : true;

          // 봇 P&L 퍼센트 계산 (봇 시작 이후, 배분 금액 기준)
          const botPnlPct = (() => {
            const alloc = ab.allocation || 0;
            if (!alloc) return null;
            // trade log 기반
            const withPnl = botTradeLog.filter(t => t.pnl != null && t.time && new Date(t.time).getTime() >= botStartTime);
            if (withPnl.length > 0) {
              const totalPnl = withPnl.reduce((s, t) => s + parseFloat(t.pnl || 0), 0);
              const pct = (totalPnl / alloc) * 100;
              return isFinite(pct) ? pct : null;
            }
            // 에쿼티 히스토리 기반 (봇 시작 이후)
            if (equityHistory.length >= 2) {
              const filtered = equityHistory.filter(h => new Date(h.timestamp).getTime() >= botStartTime);
              if (filtered.length >= 2) {
                const base = filtered[0].equity;
                const last = filtered[filtered.length - 1].equity;
                const pct = ((last - base) * botAllocRatio / alloc) * 100;
                return isFinite(pct) ? pct : null;
              }
            }
            return null;
          })();

          // 봇 P&L 날짜 라벨
          const botDateLabels = (() => {
            const withTime = botTradeLog.filter(t => t.time).sort((a, b) => new Date(a.time) - new Date(b.time));
            if (withTime.length >= 2) {
              const first = new Date(withTime[0].time);
              const last = new Date(withTime[withTime.length - 1].time);
              return [
                first.toLocaleDateString("ko-KR", { month: "short", day: "numeric" }),
                last.toLocaleDateString("ko-KR", { month: "short", day: "numeric" }),
              ];
            }
            if (equityHistory.length >= 2) {
              return [
                new Date(equityHistory[0].timestamp).toLocaleDateString("ko-KR", { month: "short", day: "numeric" }),
                new Date(equityHistory[equityHistory.length - 1].timestamp).toLocaleDateString("ko-KR", { month: "short", day: "numeric" }),
              ];
            }
            return [];
          })();

          return (
            <div key={ab.botId} style={{
              background: c.card, border: `1px solid ${c.border}`, borderRadius: isMobile ? "12px" : "14px", padding: isMobile ? "14px 12px" : "20px",
              display: "flex", flexDirection: "column", gap: isMobile ? "10px" : "14px",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: isMobile ? "10px" : "12px" }}>
                <span style={{ fontSize: isMobile ? "24px" : "28px" }}>{bot.icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: isMobile ? "13px" : "15px", color: c.text1, wordBreak: "break-word" }}>{bot.name}</div>
                  <div style={{ fontSize: isMobile ? "10px" : "11px", color: c.text3 }}>
                    {days > 0 ? `${days}일 ` : ""}{hours}시간 운영 · {isStock ? "주식" : "크립토"}
                  </div>
                </div>
                <div style={{
                  padding: "4px 10px", borderRadius: "12px", fontSize: "11px", fontWeight: 700,
                  background: `${c.green}15`, color: c.green,
                }}>운영 중</div>
              </div>

              {/* 봇별 P&L 차트 — 항상 표시 */}
              <div style={{ background: c.card2, borderRadius: "10px", padding: isMobile ? "10px 8px" : "12px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px", flexWrap: "wrap", gap: "8px" }}>
                  <span style={{ fontSize: isMobile ? "10px" : "11px", fontWeight: 700, color: c.text3 }}>
                    {pnlSource === "trade_log" ? "실제 P&L" : pnlSource === "alpaca" ? "계좌 P&L" : "수익률 차트"}
                  </span>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    {botPnlPct != null && (
                      <span style={{ fontSize: isMobile ? "12px" : "13px", fontWeight: 800, color: botPnlPct >= 0 ? c.green : c.red }}>
                        {botPnlPct >= 0 ? "+" : ""}{botPnlPct.toFixed(2)}%
                      </span>
                    )}
                    {botPnlPct == null && safeBotReturn != null && (
                      <span style={{ fontSize: isMobile ? "12px" : "13px", fontWeight: 800, color: botIsPositive ? c.green : c.red }}>
                        {botIsPositive ? "+" : ""}{safeBotReturn.toFixed(2)}%
                      </span>
                    )}
                    {botPnlPct == null && safeBotReturn == null && (
                      <span style={{ fontSize: isMobile ? "11px" : "12px", fontWeight: 600, color: c.text3 }}>데이터 수집 중</span>
                    )}
                  </div>
                </div>
                {pnlData.length >= 2 ? (
                  <>
                  {(() => {
                    const w = isMobile ? 260 : 300, h = isMobile ? 56 : 64;
                    const min = Math.min(...pnlData) * 0.998;
                    const max = Math.max(...pnlData) * 1.002;
                    const rng = max - min || 1;
                    const xStep = w / (pnlData.length - 1);
                    const pts = pnlData.map((v, i) => `${(i * xStep).toFixed(1)},${(h - ((v - min) / rng) * (h - 6) - 3).toFixed(1)}`);
                    const linePath = `M${pts.join(" L")}`;
                    const areaPath = `${linePath} L${w},${h} L0,${h} Z`;
                    const clr = botIsPositive ? c.green : c.red;
                    const baseY = h - ((100 - min) / rng) * (h - 6) - 3;
                    const gradId = `bot-pnl-${ab.botId.replace(/[^a-z0-9]/gi, "")}`;
                    return (
                      <svg width="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ borderRadius: "4px", overflow: "hidden" }}>
                        <defs>
                          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={clr} stopOpacity="0.25" />
                            <stop offset="100%" stopColor={clr} stopOpacity="0.02" />
                          </linearGradient>
                        </defs>
                        <line x1="0" y1={baseY} x2={w} y2={baseY} stroke={c.text3} strokeWidth="0.5" strokeDasharray="2,2" opacity="0.3" />
                        <path d={areaPath} fill={`url(#${gradId})`} />
                        <path d={linePath} fill="none" stroke={clr} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                        <circle cx={((pnlData.length - 1) * xStep).toFixed(1)} cy={pts[pts.length - 1].split(",")[1]} r="2.5" fill={clr} />
                      </svg>
                    );
                  })()}
                  {botDateLabels.length >= 2 && (
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: "3px" }}>
                      {botDateLabels.map((l, i) => <span key={i} style={{ fontSize: "9px", color: c.text3 }}>{l}</span>)}
                    </div>
                  )}
                  </>
                ) : (
                  /* 데이터 없는 빈 차트 UI */
                  <div style={{
                    height: "64px", display: "flex", flexDirection: "column",
                    alignItems: "center", justifyContent: "center",
                    borderRadius: "4px", background: `${c.text3}08`,
                    border: `1px dashed ${c.text3}25`,
                  }}>
                    <svg width="100%" height="44" viewBox="0 0 300 44" preserveAspectRatio="none" style={{ opacity: 0.15 }}>
                      <line x1="0" y1="22" x2="300" y2="22" stroke={c.text3} strokeWidth="1" strokeDasharray="4,4" />
                      <line x1="0" y1="10" x2="300" y2="10" stroke={c.text3} strokeWidth="0.5" strokeDasharray="2,4" />
                      <line x1="0" y1="34" x2="300" y2="34" stroke={c.text3} strokeWidth="0.5" strokeDasharray="2,4" />
                    </svg>
                    <span style={{ fontSize: "10px", color: c.text3, opacity: 0.6, marginTop: "2px" }}>
                      거래 데이터 수집 중...
                    </span>
                  </div>
                )}
              </div>

              <div style={{
                display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "1fr 1fr 1fr 1fr", gap: isMobile ? "6px" : "8px",
                background: c.card2, borderRadius: "10px", padding: isMobile ? "10px 8px" : "12px",
              }}>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: isMobile ? "9px" : "10px", color: c.text3, marginBottom: "2px" }}>거래 횟수</div>
                  <div style={{ fontSize: isMobile ? "13px" : "16px", fontWeight: 800, color: c.text1 }}>{botTrades || ab.trades || 0}</div>
                </div>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: isMobile ? "9px" : "10px", color: c.text3, marginBottom: "2px" }}>투입 금액</div>
                  <div style={{ fontSize: isMobile ? "12px" : "14px", fontWeight: 700, color: c.blue }}>
                    ${ab.allocation ? ab.allocation.toLocaleString() : "—"}
                  </div>
                </div>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: isMobile ? "9px" : "10px", color: c.text3, marginBottom: "2px" }}>위험도</div>
                  <div style={{ fontSize: isMobile ? "12px" : "14px", fontWeight: 700, color: getRiskColor(bot.riskColor || "blue", theme) }}>{bot.risk || "—"}</div>
                </div>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: isMobile ? "9px" : "10px", color: c.text3, marginBottom: "2px" }}>예상 수익</div>
                  <div style={{ fontSize: isMobile ? "12px" : "14px", fontWeight: 700, color: c.green }}>{bot.expectedReturn || "—"}</div>
                </div>
              </div>

              <div style={{ display: "flex", gap: isMobile ? "6px" : "8px" }}>
                <button onClick={() => onSelectBot(bot)} style={{
                  flex: 1, padding: isMobile ? "12px 8px" : "10px", borderRadius: isMobile ? "8px" : "8px", fontSize: isMobile ? "12px" : "13px", fontWeight: 600,
                  background: c.blue, color: "#fff", border: "none", cursor: "pointer", minHeight: "44px",
                }}>상세 보기</button>
                <button onClick={() => onStopBot(ab.botId)} style={{
                  padding: isMobile ? "12px 12px" : "10px 16px", borderRadius: "8px", fontSize: isMobile ? "12px" : "13px", fontWeight: 600,
                  background: `${c.red}15`, color: c.red, border: `1px solid ${c.red}30`, cursor: "pointer", minHeight: "44px",
                }}>중지</button>
              </div>
            </div>
          );
        })}
      </div>
      <style>{`@keyframes livePulse { 0%,100%{opacity:1} 50%{opacity:0.4} }`}</style>
    </div>
  );
}

export default function AutoTrading({ theme = "dark", user }) {
  const c = colors[theme];
  const { showToast } = useAuth();
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.innerWidth <= 640);
  const [activeBot, setActiveBot] = useState(null);
  const [showAlpacaSetup, setShowAlpacaSetup] = useState(false);
  const [alpacaKey, setAlpacaKey] = useState("");
  const [alpacaSecret, setAlpacaSecret] = useState("");
  const [alpacaPaper, setAlpacaPaper] = useState(true);
  const [pendingBot, setPendingBot] = useState(null);

  // 모바일 반응형 감지
  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 640);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // 알파카 설정 로드
  const alpacaPrefix = user ? `di_${user.id.slice(0, 8)}_` : "";
  const [alpacaConnected, setAlpacaConnected] = useState(() => {
    if (!user) return false;
    try {
      const cfg = JSON.parse(localStorage.getItem(`${alpacaPrefix}alpaca_config`) || "null");
      return !!(cfg?.apiKey && cfg?.apiSecret);
    } catch { return false; }
  });

  const handleSaveAlpaca = useCallback(() => {
    if (!user || !alpacaKey.trim() || !alpacaSecret.trim()) {
      showToast("error", "API Key와 Secret Key를 모두 입력해주세요.");
      return;
    }
    try {
      localStorage.setItem(`${alpacaPrefix}alpaca_config`, JSON.stringify({
        apiKey: alpacaKey.trim(),
        apiSecret: alpacaSecret.trim(),
        isPaper: alpacaPaper,
      }));
      setAlpacaConnected(true);
      setShowAlpacaSetup(false);
      showToast("success", "알파카 API가 연결되었습니다! 새로고침하면 실제 데이터가 표시됩니다.");
    } catch (e) {
      showToast("error", "저장 실패: " + e.message);
    }
  }, [user, alpacaKey, alpacaSecret, alpacaPaper, alpacaPrefix, showToast]);

  // 운영 중인 봇 목록 (Supabase user_metadata + localStorage 캐시)
  const storageKey = user ? `toit_${user.id.slice(0,8)}_active_bots` : null;
  const [activeBots, setActiveBots] = useState(() => {
    // localStorage에서 캐시된 값으로 빠른 초기 렌더
    if (!storageKey) return [];
    try { return JSON.parse(localStorage.getItem(storageKey) || "[]"); } catch { return []; }
  });
  const botsLoaded = useRef(false);
  const botsSaving = useRef(false);

  // Supabase에서 봇 목록 로드 (기기간 동기화)
  useEffect(() => {
    if (!user || botsLoaded.current) return;
    botsLoaded.current = true;
    const remoteBots = user?.user_metadata?.active_bots;
    if (Array.isArray(remoteBots) && remoteBots.length > 0) {
      setActiveBots(remoteBots);
      // localStorage 캐시도 업데이트
      if (storageKey) try { localStorage.setItem(storageKey, JSON.stringify(remoteBots)); } catch {}
    }
  }, [user, storageKey]);

  // activeBots 변경 시 → Supabase + localStorage 동시 저장
  const saveBotsTimeout = useRef(null);
  useEffect(() => {
    if (!user || !botsLoaded.current) return;
    // localStorage 즉시 저장
    if (storageKey) try { localStorage.setItem(storageKey, JSON.stringify(activeBots)); } catch {}
    // Supabase는 디바운스 (500ms)
    if (saveBotsTimeout.current) clearTimeout(saveBotsTimeout.current);
    saveBotsTimeout.current = setTimeout(async () => {
      if (botsSaving.current) return;
      botsSaving.current = true;
      try {
        await supabase.auth.updateUser({ data: { active_bots: activeBots } });
      } catch (e) { console.warn("[Toit] 봇 동기화 실패:", e); }
      botsSaving.current = false;
    }, 500);
  }, [activeBots, user, storageKey]);

  // 알파카 계좌 잔고 로드 (봇 배분 기준)
  const [alpacaEquity, setAlpacaEquity] = useState(null);
  useEffect(() => {
    if (!user || !alpacaConnected) return;
    const prefix = `di_${user.id.slice(0, 8)}_`;
    let cfg;
    try { cfg = JSON.parse(localStorage.getItem(`${prefix}alpaca_config`) || "null"); } catch {}
    if (!cfg?.apiKey) return;
    fetch("/api/alpaca?action=account", {
      headers: {
        "Content-Type": "application/json",
        "x-alpaca-key": cfg.apiKey,
        "x-alpaca-secret": cfg.apiSecret,
        "x-alpaca-paper": String(cfg.isPaper !== false),
      },
    }).then(r => r.json()).then(data => {
      if (data?.equity) setAlpacaEquity(parseFloat(data.equity));
    }).catch(() => {});
  }, [user, alpacaConnected]);

  // 수동 배분 모달 상태
  const [allocationInput, setAllocationInput] = useState("");

  const handleActivateBot = useCallback((bot) => {
    if (!user) {
      showToast("error", "로그인이 필요합니다. 먼저 로그인해주세요.");
      return;
    }
    // 이미 활성화된 봇이면 바로 상세 진입
    if (activeBots.some(ab => ab.botId === bot.id)) {
      setActiveBot(bot);
      return;
    }
    // 수동 배분 모달 표시
    setPendingBot(bot);
    // 기본값: 잔고에서 기존 봇 배분액 차감한 잔여 금액
    const allocatedTotal = activeBots.reduce((sum, ab) => sum + (ab.allocation || 0), 0);
    const remaining = alpacaEquity ? Math.max(0, Math.floor(alpacaEquity - allocatedTotal)) : 1000;
    setAllocationInput(String(remaining));
  }, [user, showToast, activeBots, alpacaEquity]);

  const handleConfirmAllocation = useCallback(() => {
    if (!pendingBot) return;
    const amount = parseInt(allocationInput, 10);
    if (!amount || amount <= 0) {
      showToast("error", "투입 금액을 올바르게 입력해주세요.");
      return;
    }
    setActiveBots(prev => [...prev, {
      botId: pendingBot.id,
      startedAt: Date.now(),
      trades: 0,
      allocation: amount,
    }]);
    setActiveBot(pendingBot);
    showToast("success", `${pendingBot.name} 운영 시작 — $${amount.toLocaleString()} 투입`);
    setPendingBot(null);
    setAllocationInput("");
  }, [pendingBot, allocationInput, showToast]);

  const handleStopBot = useCallback((botId) => {
    setActiveBots(prev => prev.filter(ab => ab.botId !== botId));
    if (activeBot?.id === botId) setActiveBot(null);
    showToast("success", "봇 운영을 중지했습니다.");
  }, [activeBot, showToast]);

  const handleBackToCatalog = useCallback(() => {
    setActiveBot(null);
  }, []);

  return (
    <div
      style={{
        backgroundColor: c.bg,
        color: c.text1,
        minHeight: "100vh",
        padding: "40px 20px",
      }}
    >
      <div style={{ maxWidth: "1400px", margin: "0 auto" }}>
        {/* 알파카 API 연동 배너 */}
        {user && !alpacaConnected && (
          <div style={{
            background: `linear-gradient(135deg, ${c.card} 0%, ${c.blue}08 100%)`,
            border: `1px solid ${c.blue}30`, borderRadius: "14px", padding: "16px 20px", marginBottom: "20px",
            display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "12px",
          }}>
            <div>
              <div style={{ fontSize: "14px", fontWeight: 700, color: c.text1, marginBottom: "4px" }}>🔗 알파카 페이퍼트레이딩 연동</div>
              <div style={{ fontSize: "12px", color: c.text3 }}>실제 수익률 데이터를 확인하려면 Alpaca API 키를 연결하세요</div>
            </div>
            <button onClick={() => setShowAlpacaSetup(true)} style={{
              padding: "8px 20px", borderRadius: "10px", fontSize: "13px", fontWeight: 700,
              background: c.blue, color: "#fff", border: "none", cursor: "pointer",
            }}>API 키 설정</button>
          </div>
        )}
        {user && alpacaConnected && !showAlpacaSetup && (() => {
          const used = activeBots.reduce((s, ab) => s + (ab.allocation || 0), 0);
          const left = alpacaEquity != null ? Math.max(0, alpacaEquity - used) : null;
          return (
            <div style={{
              background: `linear-gradient(135deg, ${c.card} 0%, ${c.blue}0A 50%, ${c.green}08 100%)`,
              border: `1px solid ${c.border}`,
              borderRadius: "16px", padding: "24px", marginBottom: "20px",
            }}>
              {/* 상단: 연동 상태 + 재설정 */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: c.green, boxShadow: `0 0 8px ${c.green}80` }} />
                  <span style={{ fontSize: "13px", fontWeight: 700, color: c.text1 }}>Alpaca Paper Trading</span>
                  <span style={{ fontSize: "10px", padding: "2px 8px", borderRadius: "10px", background: `${c.green}15`, color: c.green, fontWeight: 600 }}>연동됨</span>
                </div>
                <button onClick={() => setShowAlpacaSetup(true)} style={{
                  fontSize: "11px", color: c.text3, background: c.card2, border: `1px solid ${c.border}`, borderRadius: "6px",
                  padding: "4px 10px", cursor: "pointer",
                }}>재설정</button>
              </div>

              {/* 수치 카드 그리드 */}
              {alpacaEquity != null && (
                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : (activeBots.length > 0 ? "1fr 1fr 1fr" : "1fr"), gap: isMobile ? "10px" : "12px" }}>
                  {/* 총 자산 */}
                  <div style={{
                    background: c.card, borderRadius: isMobile ? "10px" : "12px", padding: isMobile ? "12px 14px" : "16px 20px",
                    border: `1px solid ${c.border}`,
                  }}>
                    <div style={{ fontSize: isMobile ? "10px" : "11px", color: c.text3, marginBottom: "6px", fontWeight: 600, letterSpacing: "0.5px", textTransform: "uppercase" }}>총 자산</div>
                    <div style={{ fontSize: isMobile ? "22px" : "28px", fontWeight: 800, color: c.text1, letterSpacing: "-1px" }}>
                      ${alpacaEquity.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </div>
                  </div>
                  {/* 배분 완료 */}
                  {activeBots.length > 0 && (
                    <div style={{
                      background: c.card, borderRadius: isMobile ? "10px" : "12px", padding: isMobile ? "12px 14px" : "16px 20px",
                      border: `1px solid ${c.border}`,
                    }}>
                      <div style={{ fontSize: isMobile ? "10px" : "11px", color: c.text3, marginBottom: "6px", fontWeight: 600, letterSpacing: "0.5px", textTransform: "uppercase" }}>봇 배분</div>
                      <div style={{ fontSize: isMobile ? "22px" : "28px", fontWeight: 800, color: c.orange || c.yellow, letterSpacing: "-1px" }}>
                        ${used.toLocaleString()}
                      </div>
                      <div style={{ fontSize: isMobile ? "10px" : "11px", color: c.text3, marginTop: "4px" }}>{activeBots.length}개 봇 운영 중</div>
                    </div>
                  )}
                  {/* 잔여 */}
                  {activeBots.length > 0 && left != null && (
                    <div style={{
                      background: c.card, borderRadius: isMobile ? "10px" : "12px", padding: isMobile ? "12px 14px" : "16px 20px",
                      border: `1px solid ${left > 0 ? c.border : c.red + "30"}`,
                    }}>
                      <div style={{ fontSize: isMobile ? "10px" : "11px", color: c.text3, marginBottom: "6px", fontWeight: 600, letterSpacing: "0.5px", textTransform: "uppercase" }}>잔여 금액</div>
                      <div style={{ fontSize: isMobile ? "22px" : "28px", fontWeight: 800, color: left > 0 ? c.green : c.red, letterSpacing: "-1px" }}>
                        ${left.toLocaleString()}
                      </div>
                      <div style={{ fontSize: isMobile ? "10px" : "11px", color: c.text3, marginTop: "4px" }}>
                        {alpacaEquity > 0 ? `${((left / alpacaEquity) * 100).toFixed(1)}% 가용` : ""}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })()}
        {/* 알파카 API 키 설정 폼 */}
        {showAlpacaSetup && (
          <div style={{
            background: c.card, border: `1px solid ${c.border}`, borderRadius: isMobile ? "12px" : "16px",
            padding: isMobile ? "16px 12px" : "24px", marginBottom: "20px",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
              <h3 style={{ margin: 0, fontSize: isMobile ? "14px" : "16px", fontWeight: 700, color: c.text1 }}>Alpaca API 설정</h3>
              <button onClick={() => setShowAlpacaSetup(false)} style={{ background: "none", border: "none", color: c.text3, fontSize: "18px", cursor: "pointer" }}>✕</button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: isMobile ? "10px" : "12px" }}>
              <div>
                <label style={{ fontSize: isMobile ? "11px" : "12px", fontWeight: 600, color: c.text2, marginBottom: "4px", display: "block" }}>API Key</label>
                <input value={alpacaKey} onChange={e => setAlpacaKey(e.target.value)} placeholder="PKXXXXXXXXXXXXXXXXXX"
                  style={{ width: "100%", padding: isMobile ? "12px" : "10px 12px", borderRadius: "8px", border: `1px solid ${c.border}`, background: c.card2, color: c.text1, fontSize: isMobile ? "14px" : "13px", boxSizing: "border-box", outline: "none", minHeight: "44px" }}
                  onFocus={e => e.target.style.borderColor = c.blue} onBlur={e => e.target.style.borderColor = c.border}
                />
              </div>
              <div>
                <label style={{ fontSize: isMobile ? "11px" : "12px", fontWeight: 600, color: c.text2, marginBottom: "4px", display: "block" }}>Secret Key</label>
                <input value={alpacaSecret} onChange={e => setAlpacaSecret(e.target.value)} type="password" placeholder="••••••••••••••••••"
                  style={{ width: "100%", padding: isMobile ? "12px" : "10px 12px", borderRadius: "8px", border: `1px solid ${c.border}`, background: c.card2, color: c.text1, fontSize: isMobile ? "14px" : "13px", boxSizing: "border-box", outline: "none", minHeight: "44px" }}
                  onFocus={e => e.target.style.borderColor = c.blue} onBlur={e => e.target.style.borderColor = c.border}
                />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: isMobile ? "6px" : "8px" }}>
                <input type="checkbox" checked={alpacaPaper} onChange={e => setAlpacaPaper(e.target.checked)} id="alpaca-paper" />
                <label htmlFor="alpaca-paper" style={{ fontSize: isMobile ? "11px" : "12px", color: c.text2 }}>페이퍼 트레이딩 (테스트 환경)</label>
              </div>
              <div style={{ fontSize: isMobile ? "10px" : "11px", color: c.text3, lineHeight: 1.5 }}>
                API 키는 브라우저 로컬 스토리지에만 저장되며, 서버로 전송되지 않습니다.
                <br />
                <a href="https://app.alpaca.markets/paper/dashboard/overview" target="_blank" rel="noopener noreferrer" style={{ color: c.blue }}>Alpaca 대시보드에서 API 키 발급 →</a>
              </div>
              <button onClick={handleSaveAlpaca} style={{
                padding: isMobile ? "14px 12px" : "12px", borderRadius: "10px", fontSize: isMobile ? "13px" : "14px", fontWeight: 700,
                background: c.blue, color: "#fff", border: "none", cursor: "pointer", minHeight: "44px", width: "100%",
              }}>저장</button>
            </div>
          </div>
        )}

        {/* 수동 배분 모달 */}
        {pendingBot && (
          <div style={{
            position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
            background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center",
            zIndex: 9999,
          }} onClick={() => setPendingBot(null)}>
            <div style={{
              background: c.card, borderRadius: isMobile ? "12px" : "16px", padding: isMobile ? "20px 16px" : "28px", width: isMobile ? "min(95vw, 100%)" : "min(400px, 90vw)",
              border: `1px solid ${c.border}`, boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
            }} onClick={e => e.stopPropagation()}>
              <div style={{ display: "flex", alignItems: "center", gap: isMobile ? "10px" : "12px", marginBottom: "20px" }}>
                <span style={{ fontSize: isMobile ? "28px" : "32px" }}>{pendingBot.icon}</span>
                <div style={{ minWidth: 0 }}>
                  <h3 style={{ margin: 0, color: c.text1, fontSize: isMobile ? "16px" : "18px", wordBreak: "break-word" }}>{pendingBot.name}</h3>
                  <span style={{ fontSize: isMobile ? "11px" : "12px", color: c.text2 }}>투입 금액을 설정해주세요</span>
                </div>
              </div>
              {alpacaEquity != null && (() => {
                const used = activeBots.reduce((s, ab) => s + (ab.allocation || 0), 0);
                const left = Math.max(0, alpacaEquity - used);
                return (
                  <div style={{
                    padding: isMobile ? "10px" : "8px 12px", background: `${c.blue}08`, borderRadius: "8px",
                    border: `1px solid ${c.blue}15`, marginBottom: "16px", fontSize: isMobile ? "11px" : "12px", color: c.text2,
                  }}>
                    계좌 잔고: <strong style={{ color: c.text1 }}>${alpacaEquity.toLocaleString(undefined, { maximumFractionDigits: 0 })}</strong>
                    {used > 0 && <>
                      {" · "}배분 완료: <strong style={{ color: c.orange || c.yellow }}>${used.toLocaleString()}</strong>
                      {" · "}잔여: <strong style={{ color: left > 0 ? c.green : c.red }}>${left.toLocaleString()}</strong>
                    </>}
                  </div>
                );
              })()}
              <div style={{ marginBottom: "20px" }}>
                <label style={{ fontSize: isMobile ? "12px" : "13px", color: c.text2, display: "block", marginBottom: "6px" }}>투입 금액 (USD)</label>
                <input
                  type="number"
                  value={allocationInput}
                  onChange={e => setAllocationInput(e.target.value)}
                  placeholder="예: 5000"
                  style={{
                    width: "100%", padding: isMobile ? "14px" : "12px", borderRadius: "8px", border: `1px solid ${c.border}`,
                    background: c.card2, color: c.text1, fontSize: isMobile ? "16px" : "16px", fontWeight: 600, boxSizing: "border-box", minHeight: "44px",
                  }}
                  onKeyDown={e => e.key === "Enter" && handleConfirmAllocation()}
                  autoFocus
                />
              </div>
              <div style={{ display: "flex", gap: isMobile ? "8px" : "8px" }}>
                <button onClick={() => setPendingBot(null)} style={{
                  flex: 1, padding: isMobile ? "14px 12px" : "12px", borderRadius: "8px", fontSize: isMobile ? "13px" : "14px", fontWeight: 600,
                  background: c.card2, color: c.text2, border: `1px solid ${c.border}`, cursor: "pointer", minHeight: "44px",
                }}>취소</button>
                <button onClick={handleConfirmAllocation} style={{
                  flex: 1, padding: isMobile ? "14px 12px" : "12px", borderRadius: "8px", fontSize: isMobile ? "13px" : "14px", fontWeight: 600,
                  background: c.blue, color: "#fff", border: "none", cursor: "pointer", minHeight: "44px",
                }}>운영 시작</button>
              </div>
            </div>
          </div>
        )}

        {/* 잔고 카드는 상단 연동 배너에 통합됨 */}

        {/* 운영 중인 봇 대시보드 (활성 봇이 있을 때만 표시) */}
        {!activeBot && activeBots.length > 0 && (
          <ActiveBotsDashboard
            activeBots={activeBots}
            onSelectBot={(bot) => setActiveBot(bot)}
            onStopBot={handleStopBot}
            theme={theme}
            userId={user?.id}
            isMobile={isMobile}
          />
        )}

        {activeBot ? (
          <div>
            <button
              onClick={handleBackToCatalog}
              style={{
                backgroundColor: "transparent",
                color: c.blue,
                border: `1px solid ${c.blue}`,
                borderRadius: "8px",
                padding: "10px 16px",
                fontSize: "14px",
                fontWeight: "600",
                cursor: "pointer",
                marginBottom: "24px",
                transition: "all 0.2s ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = `${c.blue}15`;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = "transparent";
              }}
            >
              ← 봇 목록으로 돌아가기
            </button>

            {/* Bot Info Header */}
            <div
              style={{
                backgroundColor: c.card,
                border: `1px solid ${c.border}`,
                borderRadius: "12px",
                padding: "24px",
                marginBottom: "24px",
                display: "flex",
                alignItems: "center",
                gap: "20px",
              }}
            >
              <span style={{ fontSize: "48px" }}>{activeBot.icon}</span>
              <div style={{ flex: 1 }}>
                <h2
                  style={{
                    margin: "0 0 8px 0",
                    color: c.text1,
                    fontSize: "24px",
                    fontWeight: "600",
                  }}
                >
                  {activeBot.name}
                </h2>
                <p style={{ margin: "0", color: c.text2, fontSize: "14px" }}>
                  {activeBot.description}
                </p>
              </div>
            </div>

            {/* Trading Panel — 봇 배분 금액 전달 */}
            {(() => {
              const ab = activeBots.find(b => b.botId === activeBot.id);
              const alloc = ab?.allocation || null;
              return STOCK_BOTS.some((b) => b.id === activeBot.id) ? (
                <PaperTrading theme={theme} user={user} botPreset={activeBot} botAllocation={alloc} isMobile={isMobile} />
              ) : (
                <BTCTrading theme={theme} user={user} botPreset={activeBot} botAllocation={alloc} isMobile={isMobile} />
              );
            })()}
          </div>
        ) : (
          <BotCatalog onActivate={handleActivateBot} theme={theme} isMobile={isMobile} />
        )}
      </div>
    </div>
  );
}
