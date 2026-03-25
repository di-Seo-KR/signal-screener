import React, { useState, useCallback } from "react";
import PaperTrading from "./PaperTrading.jsx";
import BTCTrading from "./BTCTrading.jsx";
import { useAuth } from "./AuthProvider.jsx";

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

function BotCatalog({ onActivate, theme }) {
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
          AI 퀀트 자동매매
        </h1>
        <p style={{ margin: "0", color: c.text2, fontSize: "18px" }}>
          전문 트레이딩 봇으로 24/7 시장을 모니터링하고 자동으로 수익을 창출하세요
        </p>
      </div>

      {/* Stock Bots Section */}
      <div style={{ marginBottom: "80px" }}>
        <h2 style={{ color: c.text1, fontSize: "24px", fontWeight: "600", marginBottom: "32px" }}>
          📊 주식 자동매매 봇
        </h2>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
            gap: "24px",
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
        <h2 style={{ color: c.text1, fontSize: "24px", fontWeight: "600", marginBottom: "32px" }}>
          💰 크립토 자동매매 봇
        </h2>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
            gap: "24px",
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

// ActiveBotPanel removed — logic moved inline to AutoTrading component

export default function AutoTrading({ theme = "dark", user }) {
  const c = colors[theme];
  const { showToast } = useAuth();
  const [activeBot, setActiveBot] = useState(null);

  const handleActivateBot = useCallback((bot) => {
    if (!user) {
      showToast("error", "로그인이 필요합니다. 먼저 로그인해주세요.");
      return;
    }
    setActiveBot(bot);
  }, [user, showToast]);

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

            {/* Trading Panel */}
            {STOCK_BOTS.some((b) => b.id === activeBot.id) ? (
              <PaperTrading theme={theme} user={user} botPreset={activeBot} />
            ) : (
              <BTCTrading theme={theme} user={user} botPreset={activeBot} />
            )}
          </div>
        ) : (
          <BotCatalog onActivate={handleActivateBot} theme={theme} />
        )}
      </div>
    </div>
  );
}
