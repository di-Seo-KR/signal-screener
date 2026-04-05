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
    stats: { winRate: "60%", sharpeRatio: "1.6", mdd: "28%" },
    details: "기술적 지표 10개를 통합한 멀티팩터 모델과 공포-탐욕 지수를 결합하여 BTC 변동성을 포착합니다.",
  },
  {
    id: "highcap-momentum",
    name: "하이캡 모멘텀",
    icon: "🏛️",
    risk: "중간",
    riskColor: "green",
    expectedReturn: "15-35%",
    description: "BTC·ETH·SOL·XRP·ADA·AVAX — 시총 상위 추세추종 전략",
    tags: ["Top6", "추세추종", "레짐적응"],
    stats: { winRate: "63%", sharpeRatio: "1.8", mdd: "20%" },
    details: "시가총액 상위 6개 코인에 집중하여 ADX 추세장에서 모멘텀을 추종합니다. 횡보 시 자동 포지션 축소.",
  },
  {
    id: "defi-infra",
    name: "DeFi 인프라봇",
    icon: "🔗",
    risk: "공격",
    riskColor: "orange",
    expectedReturn: "20-50%",
    description: "LINK·UNI·AAVE·DOT — DeFi/인프라 섹터 집중 알파 전략",
    tags: ["DeFi", "인프라", "섹터집중"],
    stats: { winRate: "58%", sharpeRatio: "1.5", mdd: "32%" },
    details: "DeFi 프로토콜과 블록체인 인프라 토큰에 집중합니다. 온체인 메트릭과 기술적 분석을 결합한 섹터 알파.",
  },
  {
    id: "meme-trend",
    name: "밈코인 트렌드봇",
    icon: "🐕",
    risk: "매우높음",
    riskColor: "red",
    expectedReturn: "30-100%+",
    description: "DOGE·SHIB·PEPE — 밈코인 변동성 극대화 단기매매",
    tags: ["밈코인", "고변동성", "단기매매"],
    stats: { winRate: "51%", sharpeRatio: "1.2", mdd: "50%" },
    details: "밈코인 특유의 높은 변동성을 활용합니다. 소셜 모멘텀 + 기술적 분석으로 급등 구간을 포착합니다.",
  },
  {
    id: "l2-emerging",
    name: "L2 이머징봇",
    icon: "🚀",
    risk: "공격",
    riskColor: "orange",
    expectedReturn: "25-60%",
    description: "ARB·OP·MATIC — Layer2 신흥 프로젝트 성장 전략",
    tags: ["Layer2", "이머징", "성장투자"],
    stats: { winRate: "56%", sharpeRatio: "1.4", mdd: "35%" },
    details: "이더리움 L2 생태계의 핵심 토큰에 투자합니다. 기술 채택률과 TVL 성장을 반영한 중기 전략.",
  },
  {
    id: "crypto-diversity",
    name: "크립토 올웨더",
    icon: "🌈",
    risk: "중간",
    riskColor: "green",
    expectedReturn: "15-30%",
    description: "16개 자산 분산투자 · 레짐 적응형 리밸런싱 · 올웨더 전략",
    tags: ["분산투자", "리밸런싱", "16자산"],
    stats: { winRate: "61%", sharpeRatio: "1.7", mdd: "22%" },
    details: "하이캡부터 밈코인까지 16개 자산에 분산투자합니다. 시장 레짐에 따라 자동 리밸런싱합니다.",
  },
  {
    id: "crypto-swing",
    name: "크립토 스윙봇",
    icon: "⚡",
    risk: "매우높음",
    riskColor: "red",
    expectedReturn: "30-80%+",
    description: "전 코인 단기 스윙 · 변동성 극대화 구간 집중 · 고위험고수익",
    tags: ["스윙트레이딩", "전종목", "고빈도"],
    stats: { winRate: "52%", sharpeRatio: "1.3", mdd: "45%" },
    details: "16개 코인 전체를 대상으로 고변동성 구간을 감지하여 단기 스윙 거래합니다.",
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

// ── 봇 섹션: 모바일=수평 스와이프 캐러셀, PC=그리드 ──
function BotSection({ title, subtitle, bots, onActivate, theme, isMobile, description }) {
  const c = colors[theme];
  const scrollRef = useRef(null);
  const [scrollIdx, setScrollIdx] = useState(0);

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const el = scrollRef.current;
    const cardW = el.firstChild?.offsetWidth || 280;
    const gap = 12;
    const idx = Math.round(el.scrollLeft / (cardW + gap));
    setScrollIdx(idx);
  };

  return (
    <div style={{ marginBottom: "60px" }}>
      <h2 style={{ color: c.text1, fontSize: isMobile ? "20px" : "24px", fontWeight: "600", marginBottom: "4px" }}>
        {title}
      </h2>
      {subtitle && <p style={{ margin: "0 0 20px", color: c.text3, fontSize: "13px" }}>{subtitle}</p>}
      {!subtitle && <div style={{ marginBottom: "20px" }} />}

      {/* 모바일: 수평 스와이프 캐러셀 */}
      {isMobile ? (
        <>
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            style={{
              display: "flex", gap: "12px", overflowX: "auto", scrollSnapType: "x mandatory",
              WebkitOverflowScrolling: "touch", paddingBottom: "8px",
              scrollbarWidth: "none", msOverflowStyle: "none",
            }}
          >
            <style>{`.bot-carousel::-webkit-scrollbar { display: none; }`}</style>
            {bots.map((bot) => (
              <div key={bot.id} style={{ minWidth: "min(280px, 85vw)", maxWidth: "300px", scrollSnapAlign: "start", flex: "0 0 auto" }}>
                <BotCard bot={bot} onActivate={onActivate} theme={theme} />
              </div>
            ))}
          </div>
          {/* 페이지 인디케이터 */}
          <div style={{ display: "flex", justifyContent: "center", gap: "6px", marginTop: "12px" }}>
            {bots.map((_, i) => (
              <div key={i} style={{
                width: scrollIdx === i ? "16px" : "6px", height: "6px",
                borderRadius: "3px", transition: "all 0.3s",
                background: scrollIdx === i ? c.blue : `${c.text3}40`,
              }} />
            ))}
          </div>
        </>
      ) : (
        /* PC: 기존 그리드 */
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
          gap: "24px",
        }}>
          {bots.map((bot) => (
            <BotCard key={bot.id} bot={bot} onActivate={onActivate} theme={theme} />
          ))}
        </div>
      )}

      {description && (
        <div style={{
          marginTop: "24px", backgroundColor: c.card2, border: `1px solid ${c.border}`,
          borderRadius: "8px", padding: "16px", color: c.text2, fontSize: "13px", lineHeight: "1.6",
        }}>
          <strong style={{ color: c.text1 }}>작동 방식:</strong> {description}
        </div>
      )}
    </div>
  );
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

function BotRecommender({ onActivate, theme, isMobile }) {
  const c = colors[theme];
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState({});
  const [result, setResult] = useState(null);

  const questions = [
    { key: "market", q: "어떤 시장에 관심이 있으신가요?", options: [
      { value: "stock", label: "🏦 주식", desc: "미국 대형 우량주 (AAPL, NVDA, TSLA 등)" },
      { value: "crypto", label: "₿ 크립토", desc: "BTC, ETH, SOL 등 암호화폐" },
      { value: "both", label: "📊 둘 다", desc: "주식과 크립토 동시 운영" },
    ]},
    { key: "risk", q: "투자 성향은 어떻게 되시나요?", options: [
      { value: "low", label: "🛡️ 안정 추구", desc: "낮은 변동성, 꾸준한 수익" },
      { value: "mid", label: "⚖️ 균형 투자", desc: "적당한 리스크, 적당한 수익" },
      { value: "high", label: "🔥 공격 투자", desc: "높은 변동성 감수, 높은 수익 추구" },
    ]},
    { key: "style", q: "선호하는 전략 스타일은?", options: [
      { value: "trend", label: "📈 추세추종", desc: "상승장에서 타고 가는 전략" },
      { value: "mean", label: "🔄 평균회귀", desc: "과매도 매수, 과매수 매도" },
      { value: "ensemble", label: "🎯 앙상블", desc: "여러 전략의 합의 기반" },
      { value: "any", label: "🤖 AI 추천", desc: "자동으로 최적 매칭" },
    ]},
  ];

  const recommend = (ans) => {
    const recs = [];
    const allBots = [...STOCK_BOTS.map(b => ({...b, type: "stock"})), ...CRYPTO_BOTS.map(b => ({...b, type: "crypto"}))];
    for (const bot of allBots) {
      let score = 0;
      // 시장 매칭
      if (ans.market === "both" || (ans.market === "stock" && bot.type === "stock") || (ans.market === "crypto" && bot.type === "crypto")) score += 3;
      else continue;
      // 리스크 매칭
      if (ans.risk === "low" && (bot.riskColor === "blue")) score += 3;
      else if (ans.risk === "low" && (bot.riskColor === "green")) score += 2;
      else if (ans.risk === "mid" && (bot.riskColor === "green")) score += 3;
      else if (ans.risk === "mid" && (bot.riskColor === "blue" || bot.riskColor === "orange")) score += 1;
      else if (ans.risk === "high" && (bot.riskColor === "orange" || bot.riskColor === "red")) score += 3;
      else if (ans.risk === "high" && bot.riskColor === "green") score += 1;
      // 스타일 매칭
      if (ans.style === "any") score += 2;
      else if (ans.style === "trend" && bot.tags?.some(t => t.includes("추세"))) score += 2;
      else if (ans.style === "mean" && bot.tags?.some(t => t.includes("평균회귀") || t.includes("오실레이터"))) score += 2;
      else if (ans.style === "ensemble" && bot.tags?.some(t => t.includes("앙상블") || t.includes("다전략"))) score += 2;
      recs.push({ ...bot, score });
    }
    return recs.sort((a, b) => b.score - a.score).slice(0, 3);
  };

  const selectAnswer = (key, value) => {
    const newAnswers = { ...answers, [key]: value };
    setAnswers(newAnswers);
    if (step < questions.length - 1) {
      setStep(step + 1);
    } else {
      setResult(recommend(newAnswers));
    }
  };

  if (result) {
    return (
      <div style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: "16px", padding: isMobile ? "20px" : "32px", marginBottom: "40px" }}>
        <div style={{ textAlign: "center", marginBottom: "24px" }}>
          <div style={{ fontSize: "28px", marginBottom: "8px" }}>🎯</div>
          <h3 style={{ margin: "0 0 8px", color: c.text1, fontSize: "18px" }}>추천 봇</h3>
          <p style={{ margin: 0, color: c.text3, fontSize: "13px" }}>투자 성향에 맞는 봇을 찾았습니다</p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginBottom: "16px" }}>
          {result.map((bot, i) => (
            <div key={bot.id} onClick={() => onActivate(bot)} style={{
              display: "flex", alignItems: "center", gap: "12px", padding: "16px", borderRadius: "12px",
              background: i === 0 ? `${c.blue}10` : c.card2, border: `1px solid ${i === 0 ? c.blue : c.border}`,
              cursor: "pointer", transition: "all 0.2s",
            }}>
              <span style={{ fontSize: "28px" }}>{bot.icon}</span>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span style={{ fontWeight: 700, fontSize: "14px", color: c.text1 }}>{bot.name}</span>
                  {i === 0 && <span style={{ fontSize: "10px", padding: "2px 8px", borderRadius: "8px", background: `${c.green}20`, color: c.green, fontWeight: 700 }}>BEST</span>}
                  <span style={{ fontSize: "10px", padding: "2px 8px", borderRadius: "8px", background: `${getRiskColor(bot.riskColor, theme)}20`, color: getRiskColor(bot.riskColor, theme) }}>{bot.risk}</span>
                </div>
                <div style={{ fontSize: "11px", color: c.text3, marginTop: "2px" }}>{bot.description}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: "12px", color: c.green, fontWeight: 600 }}>{bot.expectedReturn}</div>
                <div style={{ fontSize: "10px", color: c.text3 }}>예상수익</div>
              </div>
            </div>
          ))}
        </div>
        <button onClick={() => { setResult(null); setStep(0); setAnswers({}); }} style={{
          width: "100%", padding: "10px", borderRadius: "8px", fontSize: "12px", fontWeight: 600,
          background: "transparent", color: c.text3, border: `1px solid ${c.border}`, cursor: "pointer",
        }}>다시 선택하기</button>
      </div>
    );
  }

  const q = questions[step];
  return (
    <div style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: "16px", padding: isMobile ? "20px" : "32px", marginBottom: "40px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
        <h3 style={{ margin: 0, color: c.text1, fontSize: "16px" }}>🤖 나에게 맞는 봇 찾기</h3>
        <span style={{ fontSize: "12px", color: c.text3 }}>{step + 1} / {questions.length}</span>
      </div>
      <div style={{ display: "flex", gap: "4px", marginBottom: "20px" }}>
        {questions.map((_, i) => (
          <div key={i} style={{ flex: 1, height: "3px", borderRadius: "2px", background: i <= step ? c.blue : c.border }} />
        ))}
      </div>
      <p style={{ margin: "0 0 16px", color: c.text2, fontSize: "15px", fontWeight: 600 }}>{q.q}</p>
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {q.options.map(opt => (
          <button key={opt.value} onClick={() => selectAnswer(q.key, opt.value)} style={{
            display: "flex", alignItems: "center", gap: "12px", padding: "14px 16px", borderRadius: "12px",
            background: answers[q.key] === opt.value ? `${c.blue}10` : "transparent",
            border: `1px solid ${answers[q.key] === opt.value ? c.blue : c.border}`,
            cursor: "pointer", textAlign: "left", transition: "all 0.2s",
          }}>
            <span style={{ fontSize: "20px" }}>{opt.label.split(" ")[0]}</span>
            <div>
              <div style={{ fontWeight: 600, fontSize: "13px", color: c.text1 }}>{opt.label.split(" ").slice(1).join(" ")}</div>
              <div style={{ fontSize: "11px", color: c.text3 }}>{opt.desc}</div>
            </div>
          </button>
        ))}
      </div>
      {step > 0 && (
        <button onClick={() => setStep(step - 1)} style={{
          marginTop: "12px", padding: "8px", fontSize: "12px", color: c.text3, background: "transparent",
          border: "none", cursor: "pointer",
        }}>← 이전</button>
      )}
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
          padding: isMobile ? "40px 20px" : "60px 40px",
          marginBottom: "40px",
          textAlign: "center",
        }}
      >
        <h1 style={{ margin: "0 0 16px 0", color: c.text1, fontSize: isMobile ? "28px" : "40px", fontWeight: "700" }}>
          AI 퀀트 전략
        </h1>
        <p style={{ margin: "0", color: c.text2, fontSize: isMobile ? "14px" : "18px", maxWidth: "600px", marginLeft: "auto", marginRight: "auto" }}>
          AI 기반 퀀트 봇이 24/7 시장을 분석하고 최적의 매매 시그널을 생성합니다
        </p>
      </div>

      {/* 봇 추천 플로우 */}
      <div style={{ maxWidth: "700px", margin: "0 auto", padding: isMobile ? "0 16px" : "0 40px" }}>
        <BotRecommender onActivate={onActivate} theme={theme} isMobile={isMobile} />
      </div>

      {/* Stock Bots Section */}
      <BotSection
        title="📊 주식 자동매매 봇"
        bots={STOCK_BOTS}
        onActivate={onActivate}
        theme={theme}
        isMobile={isMobile}
        description="각 봇은 개별 설정된 전략으로 한국 주식시장을 모니터링합니다. 매일 장 개시 전 포트폴리오를 리밸런싱하고, 실시간 신호에 따라 자동으로 매매를 실행합니다."
      />

      {/* Crypto Bots Section */}
      <BotSection
        title="💰 크립토 자동매매 봇"
        subtitle="16개 코인 · Binance 실시간 데이터 · 24/7 운영"
        bots={CRYPTO_BOTS}
        onActivate={onActivate}
        theme={theme}
        isMobile={isMobile}
        description="16개 코인(BTC, ETH, SOL, XRP, ADA, AVAX, LINK, UNI, AAVE, DOT, DOGE, SHIB, PEPE, ARB, OP, MATIC)을 Binance 실시간 데이터로 분석합니다. ADX 기반 레짐 판별로 추세장/횡보장 전략을 자동 스위칭합니다."
      />
    </div>
  );
}

// ── KV 가상 포트폴리오 데이터 로드 (주식 + 크립토 통합) ──
function useVirtualPortfolio(userId) {
  const [cryptoPortfolio, setCryptoPortfolio] = useState(null);
  const [stockPortfolio, setStockPortfolio] = useState(null);
  const [loading, setLoading] = useState(false);
  const fetched = useRef(false);

  useEffect(() => {
    if (!userId || fetched.current) return;
    fetched.current = true;

    setLoading(true);
    fetch(`/api/virtual-portfolio?type=all`)
      .then(r => r.json())
      .then(data => {
        if (data?.ok) {
          setCryptoPortfolio(data.crypto || null);
          setStockPortfolio(data.stock || null);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [userId]);

  return { cryptoPortfolio, stockPortfolio, loading };
}

// ── SVG 도넛 차트 (Asset Preferences) ──
function DonutChart({ data, size = 140, theme }) {
  const c = colors[theme];
  const chartColors = [c.blue, "#FCD535", "#85C4FF", c.purple, c.orange, c.green, c.red];
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) return null;
  const cx = size / 2, cy = size / 2, r = size * 0.38, strokeW = size * 0.15;
  let cumAngle = -Math.PI / 2;
  const arcs = data.map((d, i) => {
    const pct = d.value / total;
    const angle = pct * 2 * Math.PI;
    const startAngle = cumAngle;
    cumAngle += angle;
    const endAngle = cumAngle;
    const largeArc = angle > Math.PI ? 1 : 0;
    const x1 = cx + r * Math.cos(startAngle);
    const y1 = cy + r * Math.sin(startAngle);
    const x2 = cx + r * Math.cos(endAngle - 0.001);
    const y2 = cy + r * Math.sin(endAngle - 0.001);
    return (
      <path key={i} d={`M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`}
        fill="none" stroke={chartColors[i % chartColors.length]} strokeWidth={strokeW}
        strokeLinecap="butt" />
    );
  });
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={`${c.text3}15`} strokeWidth={strokeW} />
      {arcs}
    </svg>
  );
}

// ── 운영 중 봇 대시보드 (바이낸스 카피트레이딩 스타일) ──
function ActiveBotsDashboard({ activeBots, stoppedBots, onSelectBot, onStopBot, onAddFund, onUpdateBotStatus, theme, userId, isMobile }) {
  const c = colors[theme];
  const { cryptoPortfolio, stockPortfolio, loading } = useVirtualPortfolio(userId);

  // ── 봇별 독립 성과 데이터 (KV) ──
  const [allBotPerf, setAllBotPerf] = useState({});
  useEffect(() => {
    let cancelled = false;
    const fetchAll = async () => {
      try {
        const res = await fetch("/api/bot-performance?all=1");
        const data = await res.json();
        if (!cancelled && data.ok) setAllBotPerf(data.bots || {});
      } catch { /* 실패해도 기존 fallback */ }
    };
    fetchAll();
    const interval = setInterval(fetchAll, 60000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  const hasActiveBots = activeBots && activeBots.some(ab => ab.status !== "paused");
  const hasPausedBots = activeBots && activeBots.some(ab => ab.status === "paused");

  // BOT_ASSET_MAP (프론트엔드 참조용)
  const BOT_ASSET_MAP = {
    "btc-alpha": ["BTC/USD"],
    "highcap-momentum": ["BTC/USD", "ETH/USD", "SOL/USD", "XRP/USD", "ADA/USD", "AVAX/USD"],
    "defi-infra": ["LINK/USD", "UNI/USD", "AAVE/USD", "DOT/USD"],
    "meme-trend": ["DOGE/USD", "SHIB/USD", "PEPE/USD"],
    "l2-emerging": ["ARB/USD", "OP/USD", "MATIC/USD"],
    "crypto-diversity": ["BTC/USD", "ETH/USD", "SOL/USD", "XRP/USD", "ADA/USD", "AVAX/USD", "LINK/USD", "UNI/USD", "AAVE/USD", "DOT/USD", "DOGE/USD", "SHIB/USD", "PEPE/USD", "ARB/USD", "OP/USD", "MATIC/USD"],
    "crypto-swing": ["BTC/USD", "ETH/USD", "SOL/USD", "XRP/USD", "ADA/USD", "AVAX/USD", "LINK/USD", "UNI/USD", "AAVE/USD", "DOT/USD", "DOGE/USD", "SHIB/USD", "PEPE/USD", "ARB/USD", "OP/USD", "MATIC/USD"],
  };

  // 공통 카드 스타일
  const cardStyle = {
    background: c.card,
    border: `1px solid ${c.border}`,
    borderRadius: "16px",
    padding: isMobile ? "16px" : "24px",
  };

  // ── 활성 봇 없음 or 일시정지만 있을 때 ──
  if (!activeBots || activeBots.length === 0 || (!hasActiveBots && hasPausedBots)) {
    const totalEquity = (cryptoPortfolio?.equity || 0) + (stockPortfolio?.equity || 0) || 100000;
    const totalAllocated = activeBots ? activeBots.reduce((s, ab) => s + (ab.allocation || 0), 0) : 0;
    const available = Math.max(0, totalEquity - totalAllocated);
    return (
      <div style={{ marginBottom: "32px" }}>
        <h2 style={{ margin: "0 0 16px", color: c.text1, fontSize: isMobile ? "18px" : "20px", fontWeight: 700 }}>계좌 현황</h2>
        <div style={{ ...cardStyle, marginBottom: "16px" }}>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "1fr 1fr 1fr", gap: "16px" }}>
            <div>
              <div style={{ fontSize: "12px", color: c.text3, marginBottom: "6px" }}>가상 포트폴리오 잔고</div>
              <div style={{ fontSize: isMobile ? "18px" : "24px", fontWeight: 800, color: c.text1 }}>${totalEquity.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
            </div>
            <div>
              <div style={{ fontSize: "12px", color: c.text3, marginBottom: "6px" }}>투입 가능 금액</div>
              <div style={{ fontSize: isMobile ? "18px" : "24px", fontWeight: 800, color: c.green }}>${available.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
            </div>
            {hasPausedBots && (
              <div>
                <div style={{ fontSize: "12px", color: c.text3, marginBottom: "6px" }}>일시정지된 봇</div>
                <div style={{ fontSize: isMobile ? "18px" : "24px", fontWeight: 800, color: c.yellow }}>{activeBots.filter(ab => ab.status === "paused").length}개</div>
              </div>
            )}
          </div>
        </div>
        {/* 일시정지된 봇 목록 */}
        {hasPausedBots && (
          <>
            <div style={{ fontSize: "14px", fontWeight: 600, color: c.text1, marginBottom: "12px" }}>일시정지된 봇</div>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill, minmax(340px, 1fr))", gap: "12px" }}>
              {activeBots.filter(ab => ab.status === "paused").map(ab => {
                const bot = [...STOCK_BOTS, ...CRYPTO_BOTS].find(b => b.id === ab.botId) || {};
                return (
                  <div key={ab.botId} style={{ ...cardStyle, display: "flex", flexDirection: "column", gap: "12px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                      <span style={{ fontSize: "24px" }}>{bot.icon}</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 700, fontSize: "14px", color: c.text1 }}>{bot.name}</div>
                        <div style={{ fontSize: "11px", color: c.text3 }}>일시정지 상태</div>
                      </div>
                      <span style={{ padding: "4px 10px", borderRadius: "12px", fontSize: "11px", fontWeight: 700, background: `${c.yellow}20`, color: c.yellow }}>일시정지</span>
                    </div>
                    <div style={{ display: "flex", gap: "8px" }}>
                      <button onClick={() => onUpdateBotStatus(ab.botId, "active")} style={{
                        flex: 1, padding: "12px", borderRadius: "8px", fontSize: "13px", fontWeight: 600,
                        background: c.green, color: "#fff", border: "none", cursor: "pointer",
                      }}>재시작</button>
                      <button onClick={() => onStopBot(ab.botId)} style={{
                        padding: "12px 16px", borderRadius: "8px", fontSize: "13px", fontWeight: 600,
                        background: `${c.red}15`, color: c.red, border: `1px solid ${c.red}30`, cursor: "pointer",
                      }}>삭제</button>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    );
  }

  // ── 활성 봇이 있을 때: 바이낸스 카피트레이딩 스타일 대시보드 ──
  const totalAllocated = activeBots.reduce((sum, ab) => sum + (ab.allocation || 0), 0);

  return (
    <div style={{ marginBottom: "32px" }}>
      {/* 헤더 */}
      <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "20px" }}>
        <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: c.green, animation: "livePulse 1.5s ease-in-out infinite" }} />
        <h2 style={{ margin: 0, color: c.text1, fontSize: isMobile ? "18px" : "22px", fontWeight: 700 }}>운영 현황</h2>
        <span style={{ fontSize: "12px", padding: "3px 10px", borderRadius: "12px", background: `${c.green}20`, color: c.green, fontWeight: 700 }}>
          {activeBots.filter(ab => ab.status !== "paused").length}개 활성
        </span>
        {loading && <span style={{ fontSize: "11px", color: c.text3 }}>로딩 중...</span>}
      </div>

      {/* ── 통합 포트폴리오 요약 카드 ── */}
      {(() => {
        const runningBots = activeBots.filter(ab => ab.status !== "paused");
        let grandTotalPL = 0, grandUnrealized = 0, grandRealized = 0, grandTrades = 0, grandWins = 0;
        runningBots.forEach(ab => {
          const bp = allBotPerf[ab.botId];
          grandTrades += bp?.perf?.tradeCount || 0;
          grandWins += bp?.perf?.winCount || 0;
          grandUnrealized += bp?.snapshot?.unrealizedPL || 0;
          grandRealized += bp?.perf?.realizedPL || 0;
        });
        grandTotalPL = grandUnrealized + grandRealized;
        const grandROI = totalAllocated > 0 ? (grandTotalPL / totalAllocated) * 100 : 0;
        const grandWinRate = grandTrades > 0 ? (grandWins / grandTrades) * 100 : 0;

        return (
          <div style={{ ...cardStyle, marginBottom: "20px" }}>
            {/* 상단: 총 자산 + ROI */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "20px", flexWrap: "wrap", gap: "12px" }}>
              <div>
                <div style={{ fontSize: "12px", color: c.text3, marginBottom: "4px" }}>총 투입 금액</div>
                <div style={{ fontSize: isMobile ? "28px" : "36px", fontWeight: 800, color: c.text1, letterSpacing: "-1px" }}>
                  ${totalAllocated.toLocaleString()}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: "12px", color: c.text3, marginBottom: "4px" }}>총 수익률 (ROI)</div>
                <div style={{ fontSize: isMobile ? "24px" : "32px", fontWeight: 800, color: grandROI >= 0 ? c.green : c.red }}>
                  {grandROI >= 0 ? "+" : ""}{grandROI.toFixed(2)}%
                </div>
              </div>
            </div>

            {/* 핵심 지표 그리드 */}
            <div style={{
              display: "grid", gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(5, 1fr)",
              gap: "12px", marginBottom: "4px",
            }}>
              {[
                { label: "총 수익 (PnL)", value: `${grandTotalPL >= 0 ? "+" : ""}$${grandTotalPL.toFixed(2)}`, color: grandTotalPL >= 0 ? c.green : c.red },
                { label: "미실현 손익", value: `${grandUnrealized >= 0 ? "+" : ""}$${grandUnrealized.toFixed(2)}`, color: grandUnrealized >= 0 ? c.green : c.red },
                { label: "실현 손익", value: `${grandRealized >= 0 ? "+" : ""}$${grandRealized.toFixed(2)}`, color: grandRealized >= 0 ? c.green : c.red },
                { label: "승률", value: grandTrades > 0 ? `${grandWinRate.toFixed(1)}%` : "--", color: grandWinRate >= 50 ? c.green : c.text1 },
                { label: "총 거래", value: `${grandTrades}회`, color: c.text1 },
              ].map((m, i) => (
                <div key={i} style={{ padding: "10px 12px", borderRadius: "10px", background: c.card2 }}>
                  <div style={{ fontSize: "11px", color: c.text3, marginBottom: "4px" }}>{m.label}</div>
                  <div style={{ fontSize: isMobile ? "14px" : "16px", fontWeight: 700, color: m.color }}>{m.value}</div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── 봇별 요약 리스트 ── */}
      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        {activeBots.filter(ab => ab.status !== "paused").map(ab => {
          const bot = [...STOCK_BOTS, ...CRYPTO_BOTS].find(b => b.id === ab.botId) || {};
          const elapsed = Date.now() - (ab.startedAt || Date.now());
          const days = Math.floor(elapsed / 86400000);
          const hours = Math.floor((elapsed % 86400000) / 3600000);
          const isStock = STOCK_BOTS.some(b => b.id === ab.botId);
          const bp = allBotPerf[ab.botId];
          const kvTrades = bp?.perf?.tradeCount || 0;
          const kvWinCount = bp?.perf?.winCount || 0;
          const kvUnrealized = bp?.snapshot?.unrealizedPL || 0;
          const realizedPL = bp?.perf?.realizedPL || 0;
          const totalPL = kvUnrealized + realizedPL;
          const allocation = ab.allocation || 0;
          const roiPct = allocation > 0 ? (totalPL / allocation) * 100 : 0;
          const rawDD = bp?.snapshot?.dd || 0;
          const rawMDD = bp?.snapshot?.mdd || 0;
          const kvMDD = rawMDD >= 99.9 ? 0 : rawMDD;
          const pnlData = bp?.equityCurve && bp.equityCurve.length >= 2 ? bp.equityCurve : [];
          const botIsPositive = roiPct >= 0;

          return (
            <div key={ab.botId} style={{
              ...cardStyle, display: "flex", flexDirection: "column", gap: isMobile ? "12px" : "14px",
            }}>
              {/* 봇 헤더 */}
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <span style={{
                  fontSize: "28px", width: "44px", height: "44px",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  background: `${c.blue}10`, borderRadius: "12px", flexShrink: 0,
                }}>{bot.icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 700, fontSize: isMobile ? "15px" : "16px", color: c.text1 }}>{bot.name}</span>
                    <span style={{
                      padding: "2px 8px", borderRadius: "4px", fontSize: "10px", fontWeight: 600,
                      background: `${getRiskColor(bot.riskColor, theme)}15`,
                      color: getRiskColor(bot.riskColor, theme),
                    }}>{bot.risk}</span>
                  </div>
                  <div style={{ fontSize: "11px", color: c.text3, marginTop: "2px" }}>
                    {days > 0 ? `${days}일 ` : ""}{hours}시간 운영 · {isStock ? "주식" : "크립토"} · {kvTrades}회 거래
                  </div>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <div style={{ fontSize: isMobile ? "16px" : "18px", fontWeight: 800, color: botIsPositive ? c.green : c.red }}>
                    {roiPct >= 0 ? "+" : ""}{roiPct.toFixed(2)}%
                  </div>
                  <div style={{ fontSize: "11px", color: totalPL >= 0 ? c.green : c.red, fontWeight: 600 }}>
                    {totalPL >= 0 ? "+" : ""}${totalPL.toFixed(2)}
                  </div>
                </div>
              </div>

              {/* 미니 지표 + 차트 */}
              <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
                {/* 미니 지표 */}
                <div style={{
                  display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px",
                  flex: isMobile ? "1" : "0 0 200px",
                }}>
                  {[
                    { label: "투입", value: `$${allocation.toLocaleString()}`, color: c.text1 },
                    { label: "MDD", value: kvMDD > 0 ? `${kvMDD.toFixed(1)}%` : "--", color: kvMDD > 10 ? c.red : kvMDD > 5 ? c.yellow : c.green },
                    { label: "승률", value: kvTrades > 0 ? `${(kvWinCount/kvTrades*100).toFixed(0)}%` : "--", color: c.text1 },
                    { label: "승/패", value: `${kvWinCount}/${kvTrades - kvWinCount}`, color: c.text1 },
                  ].map((m, i) => (
                    <div key={i} style={{ padding: "6px 8px", borderRadius: "6px", background: c.card2 }}>
                      <div style={{ fontSize: "9px", color: c.text3 }}>{m.label}</div>
                      <div style={{ fontSize: "12px", fontWeight: 700, color: m.color }}>{m.value}</div>
                    </div>
                  ))}
                </div>

                {/* 미니 ROI 차트 */}
                {!isMobile && (
                  <div style={{ flex: 1, minWidth: 0, height: "72px" }}>
                    {pnlData.length >= 2 ? (() => {
                      const w = 300, h = 64;
                      const min = Math.min(...pnlData) * 0.998;
                      const max = Math.max(...pnlData) * 1.002;
                      const rng = max - min || 1;
                      const xStep = w / (pnlData.length - 1);
                      const pts = pnlData.map((v, i) => `${(i * xStep).toFixed(1)},${(h - ((v - min) / rng) * (h - 6) - 3).toFixed(1)}`);
                      const linePath = `M${pts.join(" L")}`;
                      const areaPath = `${linePath} L${w},${h} L0,${h} Z`;
                      const clr = botIsPositive ? c.green : c.red;
                      const gradId = `mini-${ab.botId.replace(/[^a-z0-9]/gi, "")}`;
                      return (
                        <svg width="100%" height="64" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid meet" style={{ borderRadius: "6px", display: "block" }}>
                          <defs>
                            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor={clr} stopOpacity="0.2" />
                              <stop offset="100%" stopColor={clr} stopOpacity="0.01" />
                            </linearGradient>
                          </defs>
                          <path d={areaPath} fill={`url(#${gradId})`} />
                          <path d={linePath} fill="none" stroke={clr} strokeWidth="1.5" strokeLinecap="round" />
                        </svg>
                      );
                    })() : (
                      <div style={{ height: "64px", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "6px", background: `${c.text3}06` }}>
                        <span style={{ fontSize: "11px", color: c.text3 }}>데이터 수집 중...</span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* 액션 버튼 */}
              <div style={{ display: "flex", gap: "8px" }}>
                <button onClick={() => onSelectBot(bot)} style={{
                  flex: 2, padding: "10px", borderRadius: "8px", fontSize: "13px", fontWeight: 700,
                  background: c.blue, color: "#fff", border: "none", cursor: "pointer",
                }}>상세 보기</button>
                <button onClick={() => onAddFund(ab.botId)} style={{
                  flex: 1, padding: "10px", borderRadius: "8px", fontSize: "12px", fontWeight: 600,
                  background: `${c.green}12`, color: c.green, border: `1px solid ${c.green}30`, cursor: "pointer",
                }}>+ 추가</button>
                <button onClick={() => onStopBot(ab.botId)} style={{
                  padding: "10px 14px", borderRadius: "8px", fontSize: "12px", fontWeight: 600,
                  background: `${c.red}12`, color: c.red, border: `1px solid ${c.red}30`, cursor: "pointer",
                }}>중지</button>
              </div>
            </div>
          );
        })}
      </div>

      {/* 일시정지된 봇 */}
      {hasPausedBots && (
        <div style={{ marginTop: "24px" }}>
          <div style={{ fontSize: "14px", fontWeight: 600, color: c.text1, marginBottom: "12px" }}>일시정지된 봇</div>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill, minmax(340px, 1fr))", gap: "12px" }}>
            {activeBots.filter(ab => ab.status === "paused").map(ab => {
              const bot = [...STOCK_BOTS, ...CRYPTO_BOTS].find(b => b.id === ab.botId) || {};
              return (
                <div key={ab.botId} style={{ ...cardStyle, display: "flex", flexDirection: "column", gap: "12px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                    <span style={{ fontSize: "24px" }}>{bot.icon}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700, fontSize: "14px", color: c.text1 }}>{bot.name}</div>
                      <div style={{ fontSize: "11px", color: c.text3 }}>일시정지 상태</div>
                    </div>
                    <span style={{ padding: "4px 10px", borderRadius: "12px", fontSize: "11px", fontWeight: 700, background: `${c.yellow}20`, color: c.yellow }}>일시정지</span>
                  </div>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <button onClick={() => onUpdateBotStatus(ab.botId, "active")} style={{
                      flex: 1, padding: "12px", borderRadius: "8px", fontSize: "13px", fontWeight: 600,
                      background: c.green, color: "#fff", border: "none", cursor: "pointer",
                    }}>재시작</button>
                    <button onClick={() => onStopBot(ab.botId)} style={{
                      padding: "12px 16px", borderRadius: "8px", fontSize: "13px", fontWeight: 600,
                      background: `${c.red}15`, color: c.red, border: `1px solid ${c.red}30`, cursor: "pointer",
                    }}>삭제</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <style>{`@keyframes livePulse { 0%,100%{opacity:1} 50%{opacity:0.4} }`}</style>
    </div>
  );
}

export default function AutoTrading({ theme = "dark", user }) {
  const c = colors[theme];
  const { showToast } = useAuth();
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.innerWidth <= 640);
  const [activeBot, setActiveBot] = useState(null);
  const [pendingBot, setPendingBot] = useState(null);

  // 모바일 반응형 감지
  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 640);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);


  // 운영 중인 봇 목록 (Supabase user_metadata + localStorage 캐시)
  const storageKey = user ? `zepta_${user.id.slice(0,8)}_active_bots` : null;
  const stoppedBotsStorageKey = user ? `zepta_${user.id.slice(0,8)}_stopped_bots` : null;
  const [activeBots, setActiveBots] = useState(() => {
    // localStorage에서 캐시된 값으로 빠른 초기 렌더
    if (!storageKey) return [];
    try { return JSON.parse(localStorage.getItem(storageKey) || "[]"); } catch { return []; }
  });
  const [stoppedBots, setStoppedBots] = useState(() => {
    // localStorage에서 캐시된 정지된 봇 목록
    if (!stoppedBotsStorageKey) return [];
    try { return JSON.parse(localStorage.getItem(stoppedBotsStorageKey) || "[]"); } catch { return []; }
  });
  const botsLoaded = useRef(false);
  const activeBotsSaving = useRef(false);
  const stoppedBotsSaving = useRef(false);

  // Supabase에서 봇 목록 로드 (기기간 동기화 — 항상 서버 우선)
  useEffect(() => {
    if (!user || botsLoaded.current) return;
    (async () => {
      try {
        // 세션 강제 새로고침 → 다른 기기에서 변경한 user_metadata 반영
        await supabase.auth.refreshSession();
        const { data } = await supabase.auth.getUser();
        const remoteBots = data?.user?.user_metadata?.active_bots;
        const remoteStoppedBots = data?.user?.user_metadata?.stopped_bots;
        const localBots = (() => {
          if (!storageKey) return [];
          try { return JSON.parse(localStorage.getItem(storageKey) || "[]"); } catch { return []; }
        })();
        const localStoppedBots = (() => {
          if (!stoppedBotsStorageKey) return [];
          try { return JSON.parse(localStorage.getItem(stoppedBotsStorageKey) || "[]"); } catch { return []; }
        })();

        // 병합 전략: 서버 우선, 단 서버가 비어있고 로컬에 데이터가 있으면 로컬 복원
        // (이전 저장 버그로 서버에 빈 배열이 남아있을 수 있으므로 안전 장치)
        if (Array.isArray(remoteBots) && remoteBots.length > 0) {
          // 서버에 봇 데이터가 있으면 서버 우선 (refreshSession으로 최신 보장)
          setActiveBots(remoteBots);
          if (storageKey) try { localStorage.setItem(storageKey, JSON.stringify(remoteBots)); } catch {}
        } else if (localBots.length > 0) {
          // 서버 비어있지만 로컬에 데이터 있음 → 로컬 유지 + 서버 복원
          setActiveBots(localBots);
          await supabase.auth.updateUser({ data: { active_bots: localBots } });
          // KV에도 즉시 동기화
          try {
            const activeForCron = localBots.filter(ab => ab.status !== "paused");
            await fetch("/api/sync-active-bots", {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ activeBots: activeForCron }),
            });
          } catch {}
        }
        // else: 둘 다 비어있으면 기본값 [] 유지

        // 정지된 봇 목록 로드 (동일 전략)
        if (Array.isArray(remoteStoppedBots) && remoteStoppedBots.length > 0) {
          setStoppedBots(remoteStoppedBots);
          if (stoppedBotsStorageKey) try { localStorage.setItem(stoppedBotsStorageKey, JSON.stringify(remoteStoppedBots)); } catch {}
        } else if (localStoppedBots.length > 0) {
          setStoppedBots(localStoppedBots);
          await supabase.auth.updateUser({ data: { stopped_bots: localStoppedBots } });
        }
      } catch (e) {
        console.warn("[Zepta] 봇 목록 로드 실패:", e);
      }
      botsLoaded.current = true;
    })();
  }, [user, storageKey, stoppedBotsStorageKey]);

  // activeBots 변경 시 → Supabase + localStorage + KV 동시 저장 (로드 완료 후에만)
  const saveBotsTimeout = useRef(null);
  useEffect(() => {
    if (!user || !botsLoaded.current) return;
    // localStorage 즉시 저장
    if (storageKey) try { localStorage.setItem(storageKey, JSON.stringify(activeBots)); } catch {}
    // Supabase는 디바운스 (500ms)
    if (saveBotsTimeout.current) clearTimeout(saveBotsTimeout.current);
    saveBotsTimeout.current = setTimeout(async () => {
      activeBotsSaving.current = true;
      try {
        await supabase.auth.updateUser({ data: { active_bots: activeBots } });
      } catch (e) { console.warn("[Zepta] 봇 Supabase 동기화 실패:", e); }
      // KV에도 동기화 (btc-cron이 활성 봇 확인용) - paused 상태가 아닌 봇만 전달
      try {
        const activeForCron = activeBots.filter(ab => ab.status !== "paused");
        await fetch("/api/sync-active-bots", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ activeBots: activeForCron }),
        });
      } catch (e) { console.warn("[Zepta] 봇 KV 동기화 실패:", e); }
      activeBotsSaving.current = false;
    }, 500);
    return () => { if (saveBotsTimeout.current) clearTimeout(saveBotsTimeout.current); };
  }, [activeBots, user, storageKey]);

  // stoppedBots 변경 시 → Supabase + localStorage 동시 저장
  const saveStoppedBotsTimeout = useRef(null);
  useEffect(() => {
    if (!user || !botsLoaded.current) return;
    // localStorage 즉시 저장
    if (stoppedBotsStorageKey) try { localStorage.setItem(stoppedBotsStorageKey, JSON.stringify(stoppedBots)); } catch {}
    // Supabase는 디바운스 (500ms)
    if (saveStoppedBotsTimeout.current) clearTimeout(saveStoppedBotsTimeout.current);
    saveStoppedBotsTimeout.current = setTimeout(async () => {
      stoppedBotsSaving.current = true;
      try {
        await supabase.auth.updateUser({ data: { stopped_bots: stoppedBots } });
      } catch (e) { console.warn("[Zepta] 정지봇 Supabase 동기화 실패:", e); }
      stoppedBotsSaving.current = false;
    }, 500);
    return () => { if (saveStoppedBotsTimeout.current) clearTimeout(saveStoppedBotsTimeout.current); };
  }, [stoppedBots, user, stoppedBotsStorageKey]);


  // 수동 배분 모달 상태
  const [allocationInput, setAllocationInput] = useState("");

  // 금액 추가 모달 상태
  const [addFundBotId, setAddFundBotId] = useState(null);
  const [addFundInput, setAddFundInput] = useState("");
  const [stopBotConfirm, setStopBotConfirm] = useState(null); // { botId, botName, icon }

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
    // 기본값: 1000 USD
    setAllocationInput("1000");
  }, [user, showToast, activeBots]);

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

  // 금액 추가 핸들러
  const handleAddFund = useCallback((botId) => {
    setAddFundBotId(botId);
    setAddFundInput("");
  }, []);

  const handleConfirmAddFund = useCallback(() => {
    if (!addFundBotId) return;
    const amount = parseInt(addFundInput, 10);
    if (!amount || amount <= 0) {
      showToast("error", "추가 금액을 올바르게 입력해주세요.");
      return;
    }
    setActiveBots(prev => prev.map(ab =>
      ab.botId === addFundBotId
        ? { ...ab, allocation: (ab.allocation || 0) + amount, fundHistory: [...(ab.fundHistory || []), { amount, date: Date.now() }] }
        : ab
    ));
    const bot = [...STOCK_BOTS, ...CRYPTO_BOTS].find(b => b.id === addFundBotId);
    showToast("success", `${bot?.name || "봇"}에 $${amount.toLocaleString()} 추가 완료`);
    setAddFundBotId(null);
    setAddFundInput("");
  }, [addFundBotId, addFundInput, showToast]);

  const handleStopBot = useCallback((botId) => {
    const bot = [...STOCK_BOTS, ...CRYPTO_BOTS].find(b => b.id === botId);
    const activeBot = activeBots.find(ab => ab.botId === botId);
    // 일시정지된 봇이면 완전 삭제 모드, 활성 봇이면 일시정지 모드
    const isPaused = activeBot?.status === "paused";
    setStopBotConfirm({
      botId,
      botName: bot?.name || "봇",
      icon: bot?.icon || "🤖",
      positionCount: 0,
      mode: isPaused ? "delete" : "pause"
    });
  }, [activeBots]);

  const confirmPauseBot = useCallback(async () => {
    if (!stopBotConfirm) return;
    const { botId } = stopBotConfirm;
    // 봇을 "paused" 상태로 변경
    let updatedBots = [];
    setActiveBots(prev => {
      updatedBots = prev.map(ab =>
        ab.botId === botId ? { ...ab, status: "paused" } : ab
      );
      if (storageKey) try { localStorage.setItem(storageKey, JSON.stringify(updatedBots)); } catch {}
      return updatedBots;
    });
    if (user) {
      try {
        if (saveBotsTimeout.current) { clearTimeout(saveBotsTimeout.current); saveBotsTimeout.current = null; }
        await supabase.auth.updateUser({ data: { active_bots: updatedBots } });
      } catch (e) { console.warn("봇 일시정지 Supabase 동기화 실패:", e); }
    }
    setStopBotConfirm(null);
    const botName = [...STOCK_BOTS, ...CRYPTO_BOTS].find(b => b.id === botId)?.name || "봇";
    showToast("success", `${botName}을(를) 자동매매 중단했습니다.`);
  }, [stopBotConfirm, user, storageKey, showToast]);

  const confirmDeleteBot = useCallback(async () => {
    if (!stopBotConfirm) return;
    const { botId } = stopBotConfirm;
    const botToDelete = activeBots.find(ab => ab.botId === botId);

    if (!botToDelete) return;

    // 정지된 봇 목록에 추가
    const deletedBotRecord = {
      botId: botId,
      botName: stopBotConfirm.botName,
      allocation: botToDelete.allocation || 0,
      startedAt: botToDelete.startedAt,
      stoppedAt: Date.now(),
      trades: botToDelete.trades || 0,
      realizedPL: botToDelete.realizedPL || 0,
    };

    let updatedBots = [];
    setActiveBots(prev => {
      updatedBots = prev.filter(ab => ab.botId !== botId);
      if (storageKey) try { localStorage.setItem(storageKey, JSON.stringify(updatedBots)); } catch {}
      return updatedBots;
    });

    // 정지된 봇 히스토리에 추가
    setStoppedBots(prev => {
      const updated = [deletedBotRecord, ...prev];
      if (stoppedBotsStorageKey) try { localStorage.setItem(stoppedBotsStorageKey, JSON.stringify(updated)); } catch {}
      return updated;
    });

    if (user) {
      try {
        if (saveBotsTimeout.current) { clearTimeout(saveBotsTimeout.current); saveBotsTimeout.current = null; }
        await supabase.auth.updateUser({ data: { active_bots: updatedBots } });
      } catch (e) { console.warn("봇 삭제 Supabase 동기화 실패:", e); }
    }

    if (activeBot?.id === botId) setActiveBot(null);
    setStopBotConfirm(null);
    showToast("success", `${stopBotConfirm.botName} 봇이 완전히 삭제되었습니다.`);
  }, [stopBotConfirm, activeBot, activeBots, user, storageKey, stoppedBotsStorageKey, showToast]);

  const handleUpdateBotStatus = useCallback((botId, newStatus) => {
    let updatedBots = [];
    setActiveBots(prev => {
      updatedBots = prev.map(ab =>
        ab.botId === botId ? { ...ab, status: newStatus } : ab
      );
      if (storageKey) try { localStorage.setItem(storageKey, JSON.stringify(updatedBots)); } catch {}
      return updatedBots;
    });
    if (user) {
      try {
        if (saveBotsTimeout.current) { clearTimeout(saveBotsTimeout.current); saveBotsTimeout.current = null; }
        supabase.auth.updateUser({ data: { active_bots: updatedBots } });
      } catch (e) { console.warn("봇 상태 Supabase 동기화 실패:", e); }
    }
    const botName = [...STOCK_BOTS, ...CRYPTO_BOTS].find(b => b.id === botId)?.name || "봇";
    if (newStatus === "active") {
      showToast("success", `${botName}을(를) 재시작했습니다.`);
    }
  }, [user, storageKey, showToast]);

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
              {(() => {
                const used = activeBots.reduce((s, ab) => s + (ab.allocation || 0), 0);
                return used > 0 ? (
                  <div style={{
                    padding: isMobile ? "10px" : "8px 12px", background: `${c.blue}08`, borderRadius: "8px",
                    border: `1px solid ${c.blue}15`, marginBottom: "16px", fontSize: isMobile ? "11px" : "12px", color: c.text2,
                  }}>
                    배분 완료: <strong style={{ color: c.orange || c.yellow }}>${used.toLocaleString()}</strong>
                  </div>
                ) : null;
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

        {/* 금액 추가 모달 */}
        {addFundBotId && (() => {
          const targetBot = activeBots.find(ab => ab.botId === addFundBotId);
          const botDef = [...STOCK_BOTS, ...CRYPTO_BOTS].find(b => b.id === addFundBotId);
          if (!targetBot || !botDef) return null;
          const currentAlloc = targetBot.allocation || 0;
          const used = activeBots.reduce((s, ab) => s + (ab.allocation || 0), 0);
          const quickAmounts = [500, 1000, 2000, 5000];
          return (
            <div style={{
              position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
              background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center",
              zIndex: 9999,
            }} onClick={() => { setAddFundBotId(null); setAddFundInput(""); }}>
              <div style={{
                background: c.card, borderRadius: isMobile ? "12px" : "16px", padding: isMobile ? "20px 16px" : "28px", width: isMobile ? "min(95vw, 100%)" : "min(420px, 90vw)",
                border: `1px solid ${c.border}`, boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
              }} onClick={e => e.stopPropagation()}>
                <div style={{ display: "flex", alignItems: "center", gap: isMobile ? "10px" : "12px", marginBottom: "16px" }}>
                  <span style={{ fontSize: isMobile ? "28px" : "32px" }}>{botDef.icon}</span>
                  <div style={{ minWidth: 0 }}>
                    <h3 style={{ margin: 0, color: c.text1, fontSize: isMobile ? "16px" : "18px", wordBreak: "break-word" }}>{botDef.name}</h3>
                    <span style={{ fontSize: isMobile ? "11px" : "12px", color: c.text2 }}>추가 금액을 입력해주세요</span>
                  </div>
                </div>

                {/* 현재 배분 현황 */}
                <div style={{
                  padding: isMobile ? "12px" : "12px 14px", background: `${c.blue}08`, borderRadius: "10px",
                  border: `1px solid ${c.blue}15`, marginBottom: "16px", fontSize: isMobile ? "12px" : "13px", color: c.text2,
                  display: "flex", flexDirection: "column", gap: "6px",
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span>현재 투입 금액</span>
                    <strong style={{ color: c.text1 }}>${currentAlloc.toLocaleString()}</strong>
                  </div>
                </div>

                {/* 빠른 금액 선택 */}
                <div style={{ display: "flex", gap: "8px", marginBottom: "12px", flexWrap: "wrap" }}>
                  {quickAmounts.map(amt => (
                    <button key={amt} onClick={() => setAddFundInput(String(amt))} style={{
                      flex: "1 1 auto", padding: isMobile ? "10px 8px" : "8px 12px", borderRadius: "8px",
                      fontSize: isMobile ? "12px" : "13px", fontWeight: 600, cursor: "pointer", minHeight: "40px",
                      background: addFundInput === String(amt) ? `${c.green}20` : c.card2,
                      color: addFundInput === String(amt) ? c.green : c.text2,
                      border: `1px solid ${addFundInput === String(amt) ? c.green + "50" : c.border}`,
                      transition: "all 0.15s ease",
                    }}>${amt.toLocaleString()}</button>
                  ))}
                </div>

                {/* 직접 입력 */}
                <div style={{ marginBottom: "20px" }}>
                  <label style={{ fontSize: isMobile ? "12px" : "13px", color: c.text2, display: "block", marginBottom: "6px" }}>직접 입력 (USD)</label>
                  <input
                    type="number"
                    value={addFundInput}
                    onChange={e => setAddFundInput(e.target.value)}
                    placeholder="추가할 금액 입력"
                    style={{
                      width: "100%", padding: isMobile ? "14px" : "12px", borderRadius: "8px", border: `1px solid ${c.border}`,
                      background: c.card2, color: c.text1, fontSize: isMobile ? "16px" : "16px", fontWeight: 600, boxSizing: "border-box", minHeight: "44px",
                    }}
                    onKeyDown={e => e.key === "Enter" && handleConfirmAddFund()}
                    autoFocus
                  />
                  {addFundInput && parseInt(addFundInput, 10) > 0 && (
                    <div style={{ marginTop: "8px", fontSize: isMobile ? "11px" : "12px", color: c.text2 }}>
                      추가 후 총 투입 금액: <strong style={{ color: c.green }}>${(currentAlloc + parseInt(addFundInput, 10)).toLocaleString()}</strong>
                    </div>
                  )}
                </div>

                {/* 버튼 */}
                <div style={{ display: "flex", gap: isMobile ? "8px" : "8px" }}>
                  <button onClick={() => { setAddFundBotId(null); setAddFundInput(""); }} style={{
                    flex: 1, padding: isMobile ? "14px 12px" : "12px", borderRadius: "8px", fontSize: isMobile ? "13px" : "14px", fontWeight: 600,
                    background: c.card2, color: c.text2, border: `1px solid ${c.border}`, cursor: "pointer", minHeight: "44px",
                  }}>취소</button>
                  <button onClick={handleConfirmAddFund} style={{
                    flex: 1, padding: isMobile ? "14px 12px" : "12px", borderRadius: "8px", fontSize: isMobile ? "13px" : "14px", fontWeight: 700,
                    background: c.green, color: "#fff", border: "none", cursor: "pointer", minHeight: "44px",
                    opacity: (!addFundInput || parseInt(addFundInput, 10) <= 0) ? 0.5 : 1,
                  }}>금액 추가</button>
                </div>
              </div>
            </div>
          );
        })()}

        {/* 봇 중지 / 삭제 확인 모달 */}
        {stopBotConfirm && (
          <div style={{
            position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
            background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center",
            zIndex: 9999,
          }} onClick={() => setStopBotConfirm(null)}>
            <div style={{
              background: c.card, borderRadius: isMobile ? "14px" : "16px", padding: isMobile ? "24px 20px" : "32px",
              width: isMobile ? "min(90vw, 100%)" : "min(420px, 90vw)",
              border: `1px solid ${c.border}`, boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
              textAlign: "center",
            }} onClick={e => e.stopPropagation()}>
              <div style={{ fontSize: "48px", marginBottom: "12px" }}>{stopBotConfirm.icon}</div>
              {stopBotConfirm.mode === "pause" ? (
                <>
                  <h3 style={{ margin: "0 0 8px", color: c.text1, fontSize: isMobile ? "17px" : "19px", fontWeight: 800 }}>
                    자동매매 중단
                  </h3>
                  <p style={{ margin: "0 0 20px", color: c.text2, fontSize: isMobile ? "13px" : "14px", lineHeight: 1.5 }}>
                    <strong style={{ color: c.text1 }}>{stopBotConfirm.botName}</strong>
                  </p>

                  {/* 일시정지 단계 설명 */}
                  <div style={{
                    background: `${c.blue}08`, border: `1px solid ${c.blue}20`, borderRadius: "10px",
                    padding: isMobile ? "12px 14px" : "14px 16px", marginBottom: "20px", textAlign: "left",
                  }}>
                    <div style={{ fontSize: isMobile ? "12px" : "13px", color: c.blue, fontWeight: 600, marginBottom: "8px" }}>다음 단계 진행</div>
                    <div style={{ fontSize: isMobile ? "11px" : "12px", color: c.text2, lineHeight: 1.6 }}>
                      <div style={{ marginBottom: "6px" }}>
                        <strong>1단계: 자동매매 중단</strong><br/>
                        새로운 매매를 중지합니다. 봇이 목록에 표시되며 재시작 가능합니다.
                      </div>
                      <div>
                        <strong>2단계: 봇 삭제</strong><br/>
                        일시정지된 봇을 목록에서 완전히 제거합니다.
                      </div>
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: "10px", flexDirection: isMobile ? "column" : "row" }}>
                    <button onClick={() => setStopBotConfirm(null)} style={{
                      flex: 1, padding: isMobile ? "14px" : "12px", borderRadius: "10px", fontSize: isMobile ? "14px" : "14px", fontWeight: 600,
                      background: c.card2, color: c.text2, border: `1px solid ${c.border}`, cursor: "pointer", minHeight: "48px",
                    }}>취소</button>
                    <button onClick={confirmPauseBot} style={{
                      flex: 1, padding: isMobile ? "14px" : "12px", borderRadius: "10px", fontSize: isMobile ? "14px" : "14px", fontWeight: 700,
                      background: c.yellow, color: "#000", border: "none", cursor: "pointer", minHeight: "48px",
                    }}>자동매매만 중단</button>
                  </div>
                </>
              ) : (
                <>
                  <h3 style={{ margin: "0 0 8px", color: c.text1, fontSize: isMobile ? "17px" : "19px", fontWeight: 800 }}>
                    봇을 삭제하시겠습니까?
                  </h3>
                  <p style={{ margin: "0 0 20px", color: c.text2, fontSize: isMobile ? "13px" : "14px", lineHeight: 1.5 }}>
                    <strong style={{ color: c.text1 }}>{stopBotConfirm.botName}</strong>
                  </p>

                  <div style={{
                    background: `${c.red}08`, border: `1px solid ${c.red}20`, borderRadius: "10px",
                    padding: isMobile ? "12px 14px" : "14px 16px", marginBottom: "20px", textAlign: "left",
                  }}>
                    <div style={{ fontSize: isMobile ? "11px" : "12px", color: c.red, fontWeight: 600, marginBottom: "6px" }}>주의사항</div>
                    <ul style={{ margin: 0, paddingLeft: "16px", fontSize: isMobile ? "11px" : "12px", color: c.text2, lineHeight: 1.6 }}>
                      <li>봇이 목록에서 완전히 제거됩니다</li>
                      <li>운영 기록은 보관됩니다</li>
                      <li>이 작업은 취소할 수 없습니다</li>
                    </ul>
                  </div>

                  <div style={{ display: "flex", gap: "10px", flexDirection: isMobile ? "column" : "row" }}>
                    <button onClick={() => setStopBotConfirm(null)} style={{
                      flex: 1, padding: isMobile ? "14px" : "12px", borderRadius: "10px", fontSize: isMobile ? "14px" : "14px", fontWeight: 600,
                      background: c.card2, color: c.text2, border: `1px solid ${c.border}`, cursor: "pointer", minHeight: "48px",
                    }}>취소</button>
                    <button onClick={confirmDeleteBot} style={{
                      flex: 1, padding: isMobile ? "14px" : "12px", borderRadius: "10px", fontSize: isMobile ? "14px" : "14px", fontWeight: 700,
                      background: c.red, color: "#fff", border: "none", cursor: "pointer", minHeight: "48px",
                    }}>봇 완전 삭제</button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* 잔고 카드는 상단 연동 배너에 통합됨 */}

        {/* 운영 중인 봇 대시보드 (활성 봇이 있을 때만 표시) */}
        {!activeBot && (
          <ActiveBotsDashboard
            activeBots={activeBots}
            stoppedBots={stoppedBots}
            onSelectBot={(bot) => setActiveBot(bot)}
            onStopBot={handleStopBot}
            onAddFund={handleAddFund}
            onUpdateBotStatus={handleUpdateBotStatus}
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
