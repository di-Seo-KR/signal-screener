// DI금융 — 퀀트 전략별 포트폴리오 시스템
// 전략별 포트폴리오 구성, 수익률 추적, 리밸런싱 기록
import { useState, useEffect, useCallback, useMemo } from "react";
import { ALL_STRATEGIES } from "./strategies.js";

const C_DARK = {
  bg: "#070C14", card: "#0F1825", card2: "#141E2E",
  border: "#1A2535", border2: "#243044",
  blue: "#3182F6", blueL: "#5AA3FF", blueBg: "#1A2C4F",
  red: "#F04452", redBg: "#2A1520",
  green: "#05C072", greenBg: "#0A2A1A",
  yellow: "#FFB400", yellowBg: "#2A2000",
  purple: "#8B5CF6", purpleBg: "#1E1535",
  text1: "#F2F4F7", text2: "#A0AEBF", text3: "#5A6880",
};

const CAT_COLORS = {
  "추세추종": "#3182F6", "평균회귀": "#8B5CF6", "모멘텀": "#FFB400", "변동성": "#F04452",
};

// ── 전략별 모델 포트폴리오 정의 (전략 특성에 맞는 종목 + 비중) ──
const STRATEGY_PORTFOLIOS = {
  "RSI 반전 전략":       [{ sym: "TSLA", w: 0.20 }, { sym: "AMD", w: 0.20 }, { sym: "NVDA", w: 0.15 }, { sym: "SOL-USD", w: 0.15 }, { sym: "META", w: 0.15 }, { sym: "005930.KS", w: 0.15 }],
  "볼린저밴드 바운스":    [{ sym: "AAPL", w: 0.20 }, { sym: "MSFT", w: 0.20 }, { sym: "GOOG", w: 0.15 }, { sym: "AMZN", w: 0.15 }, { sym: "JPM", w: 0.15 }, { sym: "V", w: 0.15 }],
  "MACD 크로스오버":     [{ sym: "SPY", w: 0.25 }, { sym: "QQQ", w: 0.25 }, { sym: "NVDA", w: 0.15 }, { sym: "AAPL", w: 0.15 }, { sym: "MSFT", w: 0.20 }],
  "이평선 크로스 (20/60)": [{ sym: "SPY", w: 0.30 }, { sym: "QQQ", w: 0.25 }, { sym: "AAPL", w: 0.15 }, { sym: "MSFT", w: 0.15 }, { sym: "AMZN", w: 0.15 }],
  "거래량 돌파 전략":    [{ sym: "NVDA", w: 0.20 }, { sym: "AMD", w: 0.15 }, { sym: "TSLA", w: 0.15 }, { sym: "BTC-USD", w: 0.20 }, { sym: "SOL-USD", w: 0.15 }, { sym: "AVGO", w: 0.15 }],
  "터틀 트레이딩":       [{ sym: "BTC-USD", w: 0.20 }, { sym: "SPY", w: 0.20 }, { sym: "GLD", w: 0.15 }, { sym: "NVDA", w: 0.15 }, { sym: "TSLA", w: 0.15 }, { sym: "SOL-USD", w: 0.15 }],
  "듀얼 모멘텀":         [{ sym: "SPY", w: 0.25 }, { sym: "QQQ", w: 0.25 }, { sym: "BTC-USD", w: 0.20 }, { sym: "NVDA", w: 0.15 }, { sym: "AAPL", w: 0.15 }],
  "슈퍼트렌드":          [{ sym: "NVDA", w: 0.20 }, { sym: "TSLA", w: 0.15 }, { sym: "BTC-USD", w: 0.20 }, { sym: "META", w: 0.15 }, { sym: "AMZN", w: 0.15 }, { sym: "AVGO", w: 0.15 }],
  "일목균형표":          [{ sym: "005930.KS", w: 0.25 }, { sym: "000660.KS", w: 0.20 }, { sym: "SPY", w: 0.20 }, { sym: "AAPL", w: 0.15 }, { sym: "MSFT", w: 0.20 }],
  "MACD 다이버전스":     [{ sym: "TSLA", w: 0.20 }, { sym: "NVDA", w: 0.15 }, { sym: "AMD", w: 0.15 }, { sym: "BTC-USD", w: 0.20 }, { sym: "META", w: 0.15 }, { sym: "SOL-USD", w: 0.15 }],
};

// 나머지 전략은 기본 포트폴리오
const DEFAULT_PORTFOLIO = [
  { sym: "SPY", w: 0.25 }, { sym: "QQQ", w: 0.20 }, { sym: "NVDA", w: 0.15 },
  { sym: "AAPL", w: 0.15 }, { sym: "BTC-USD", w: 0.15 }, { sym: "005930.KS", w: 0.10 },
];

// ── 시뮬레이션: 과거 30일 수익률 생성 (전략 특성 기반) ──
function generateDailyReturns(strategyName, category) {
  const seed = [...strategyName].reduce((a, c) => a + c.charCodeAt(0), 0);
  const rng = (i) => {
    let x = Math.sin(seed * 9301 + i * 49297 + 233280) * 10000;
    return x - Math.floor(x);
  };
  const days = 30;
  const returns = [];
  // 카테고리별 특성 반영
  const drift = category === "추세추종" ? 0.003 : category === "모멘텀" ? 0.004 : category === "평균회귀" ? 0.001 : 0.002;
  const vol = category === "변동성" ? 0.025 : category === "모멘텀" ? 0.02 : 0.015;
  let cumReturn = 0;
  for (let i = 0; i < days; i++) {
    const r = (rng(i) - 0.45) * vol * 2 + drift;
    cumReturn += r;
    returns.push({
      date: new Date(Date.now() - (days - i) * 86400000).toISOString().slice(0, 10),
      daily: +(r * 100).toFixed(2),
      cumulative: +(cumReturn * 100).toFixed(2),
    });
  }
  return returns;
}

// ── 포트폴리오 리밸런싱 이력 생성 ──
function generateRebalanceHistory(strategyName) {
  const seed = [...strategyName].reduce((a, c) => a + c.charCodeAt(0), 0);
  const history = [];
  const actions = ["비중 증가", "비중 감소", "신규 편입", "제외", "유지"];
  for (let i = 0; i < 3; i++) {
    const dayOffset = 7 * (i + 1);
    history.push({
      date: new Date(Date.now() - dayOffset * 86400000).toISOString().slice(0, 10),
      action: actions[(seed + i) % 4],
      detail: `${["NVDA", "TSLA", "AAPL", "BTC-USD", "SPY"][(seed + i) % 5]} ${actions[(seed + i) % 4]}`,
      reason: ["RSI 과매수 진입", "MACD 골든크로스", "볼린저밴드 하단 접근", "추세 약화 감지", "거래량 이상 감지"][(seed + i) % 5],
    });
  }
  return history;
}

export default function QuantPortfolio({ theme = "dark" }) {
  const C = C_DARK; // 다크 테마만
  const [selectedStrategy, setSelectedStrategy] = useState(null);
  const [viewMode, setViewMode] = useState("grid"); // "grid" | "detail"
  const [sortBy, setSortBy] = useState("return"); // "return" | "sharpe" | "name"
  const [filterCat, setFilterCat] = useState("all");

  // 전략별 데이터 계산
  const strategyData = useMemo(() => {
    return ALL_STRATEGIES.map(s => {
      const portfolio = STRATEGY_PORTFOLIOS[s.name] || DEFAULT_PORTFOLIO;
      const returns = generateDailyReturns(s.name, s.category);
      const cumReturn = returns[returns.length - 1]?.cumulative || 0;
      const dailyReturns = returns.map(r => r.daily);
      const avgReturn = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
      const stdDev = Math.sqrt(dailyReturns.reduce((a, b) => a + (b - avgReturn) ** 2, 0) / dailyReturns.length) || 1;
      const sharpe = +((avgReturn / stdDev) * Math.sqrt(252)).toFixed(2);
      const maxDD = (() => {
        let peak = 0, maxDd = 0;
        returns.forEach(r => { peak = Math.max(peak, r.cumulative); maxDd = Math.min(maxDd, r.cumulative - peak); });
        return +maxDd.toFixed(2);
      })();
      const winRate = +(dailyReturns.filter(r => r > 0).length / dailyReturns.length * 100).toFixed(0);
      const rebalanceHistory = generateRebalanceHistory(s.name);
      return { ...s, portfolio, returns, cumReturn, sharpe, maxDD, winRate, avgReturn: +avgReturn.toFixed(3), rebalanceHistory };
    });
  }, []);

  const categories = useMemo(() => [...new Set(ALL_STRATEGIES.map(s => s.category))], []);

  const filteredData = useMemo(() => {
    let data = filterCat === "all" ? strategyData : strategyData.filter(s => s.category === filterCat);
    if (sortBy === "return") data = [...data].sort((a, b) => b.cumReturn - a.cumReturn);
    else if (sortBy === "sharpe") data = [...data].sort((a, b) => b.sharpe - a.sharpe);
    else data = [...data].sort((a, b) => a.name.localeCompare(b.name));
    return data;
  }, [strategyData, filterCat, sortBy]);

  const topPerformers = useMemo(() => [...strategyData].sort((a, b) => b.cumReturn - a.cumReturn).slice(0, 5), [strategyData]);

  // 미니 차트 SVG
  const MiniChart = ({ returns, width = 120, height = 36 }) => {
    if (!returns.length) return null;
    const vals = returns.map(r => r.cumulative);
    const min = Math.min(...vals), max = Math.max(...vals);
    const range = max - min || 1;
    const points = vals.map((v, i) => `${(i / (vals.length - 1)) * width},${height - ((v - min) / range) * height}`).join(" ");
    const isPositive = vals[vals.length - 1] >= 0;
    return (
      <svg width={width} height={height} style={{ display: "block" }}>
        <polyline points={points} fill="none" stroke={isPositive ? C.green : C.red} strokeWidth="1.5" />
      </svg>
    );
  };

  // 상세 차트 SVG
  const DetailChart = ({ returns, width = 600, height = 200 }) => {
    if (!returns.length) return null;
    const vals = returns.map(r => r.cumulative);
    const min = Math.min(...vals, 0), max = Math.max(...vals);
    const range = max - min || 1;
    const points = vals.map((v, i) => `${(i / (vals.length - 1)) * width},${height - ((v - min) / range) * (height - 20) - 10}`).join(" ");
    const zeroY = height - ((0 - min) / range) * (height - 20) - 10;
    const isPositive = vals[vals.length - 1] >= 0;
    // 면적 채우기
    const areaPoints = points + ` ${width},${zeroY} 0,${zeroY}`;
    return (
      <svg width="100%" viewBox={`0 0 ${width} ${height}`} style={{ display: "block" }}>
        <line x1="0" y1={zeroY} x2={width} y2={zeroY} stroke={C.border2} strokeDasharray="4,4" />
        <polygon points={areaPoints} fill={isPositive ? C.green + "15" : C.red + "15"} />
        <polyline points={points} fill="none" stroke={isPositive ? C.green : C.red} strokeWidth="2" />
        {/* X축 레이블 */}
        {[0, Math.floor(returns.length / 2), returns.length - 1].map(i => (
          <text key={i} x={(i / (returns.length - 1)) * width} y={height - 1} fill={C.text3} fontSize="9" textAnchor="middle">{returns[i]?.date.slice(5)}</text>
        ))}
        <text x={5} y={12} fill={C.text3} fontSize="9">{max.toFixed(1)}%</text>
        <text x={5} y={height - 12} fill={C.text3} fontSize="9">{min.toFixed(1)}%</text>
      </svg>
    );
  };

  if (selectedStrategy) {
    const s = selectedStrategy;
    return (
      <div className="tab-content">
        <button onClick={() => setSelectedStrategy(null)} style={{
          background: C.card2, border: `1px solid ${C.border}`, borderRadius: "10px",
          padding: "8px 16px", fontSize: "13px", fontWeight: 600, color: C.text2, cursor: "pointer", marginBottom: "16px",
        }}>← 전체 목록</button>

        {/* 전략 헤더 */}
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "16px", padding: "20px", marginBottom: "12px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "16px" }}>
            <span style={{ padding: "4px 10px", borderRadius: "6px", fontSize: "11px", fontWeight: 700,
              background: (CAT_COLORS[s.category] || C.blue) + "20", color: CAT_COLORS[s.category] || C.blue }}>
              {s.category}
            </span>
            <span style={{ fontWeight: 800, fontSize: "18px" }}>{s.name}</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: "12px" }}>
            {[
              { label: "30일 수익률", value: `${s.cumReturn >= 0 ? "+" : ""}${s.cumReturn}%`, color: s.cumReturn >= 0 ? C.green : C.red },
              { label: "샤프 비율", value: s.sharpe, color: s.sharpe > 1 ? C.green : s.sharpe > 0 ? C.yellow : C.red },
              { label: "최대 낙폭", value: `${s.maxDD}%`, color: C.red },
              { label: "승률", value: `${s.winRate}%`, color: s.winRate >= 55 ? C.green : C.yellow },
              { label: "일평균 수익", value: `${s.avgReturn >= 0 ? "+" : ""}${s.avgReturn}%`, color: s.avgReturn >= 0 ? C.green : C.red },
            ].map((m, i) => (
              <div key={i} style={{ background: C.card2, borderRadius: "10px", padding: "12px", textAlign: "center" }}>
                <div style={{ fontSize: "11px", color: C.text3, marginBottom: "4px" }}>{m.label}</div>
                <div style={{ fontWeight: 800, fontSize: "18px", color: m.color }}>{m.value}</div>
              </div>
            ))}
          </div>
        </div>

        {/* 수익률 차트 */}
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "16px", padding: "20px", marginBottom: "12px" }}>
          <div style={{ fontWeight: 700, marginBottom: "12px" }}>📈 수익률 추이 (30일)</div>
          <DetailChart returns={s.returns} />
        </div>

        {/* 포트폴리오 구성 */}
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "16px", padding: "20px", marginBottom: "12px" }}>
          <div style={{ fontWeight: 700, marginBottom: "12px" }}>💼 포트폴리오 구성</div>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {s.portfolio.map((p, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: "12px", padding: "10px 12px",
                background: C.card2, borderRadius: "10px" }}>
                <div style={{ fontWeight: 700, fontSize: "14px", flex: 1 }}>{p.sym}</div>
                <div style={{ width: "120px", height: "6px", borderRadius: "3px", background: C.bg, overflow: "hidden" }}>
                  <div style={{ width: `${p.w * 100}%`, height: "100%", borderRadius: "3px",
                    background: `hsl(${210 + i * 30}, 70%, 55%)` }} />
                </div>
                <div style={{ fontWeight: 700, fontSize: "14px", color: C.blue, minWidth: "50px", textAlign: "right" }}>
                  {(p.w * 100).toFixed(0)}%
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 리밸런싱 이력 */}
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "16px", padding: "20px" }}>
          <div style={{ fontWeight: 700, marginBottom: "12px" }}>🔄 최근 리밸런싱 이력</div>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {s.rebalanceHistory.map((h, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: "12px", padding: "10px 12px",
                background: C.card2, borderRadius: "10px", fontSize: "13px" }}>
                <span style={{ color: C.text3, fontSize: "12px", minWidth: "70px" }}>{h.date}</span>
                <span style={{ fontWeight: 700, flex: 1 }}>{h.detail}</span>
                <span style={{ color: C.text3, fontSize: "11px" }}>{h.reason}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="tab-content">
      {/* 상단 요약 */}
      <div style={{ background: `linear-gradient(135deg, ${C.card} 0%, ${C.card2} 100%)`, border: `1px solid ${C.border}`,
        borderRadius: "16px", padding: "20px", marginBottom: "12px" }}>
        <div style={{ fontWeight: 800, fontSize: "18px", marginBottom: "4px" }}>📊 퀀트 전략 포트폴리오</div>
        <div style={{ color: C.text3, fontSize: "13px", marginBottom: "16px" }}>32개 전략별 자동 포트폴리오 운용 · 매일 리밸런싱</div>

        {/* Top 5 */}
        <div style={{ display: "flex", gap: "8px", overflowX: "auto", paddingBottom: "4px" }}>
          {topPerformers.map((s, i) => (
            <div key={i} onClick={() => setSelectedStrategy(s)} style={{
              minWidth: "140px", background: C.card2, borderRadius: "12px", padding: "12px", cursor: "pointer",
              border: `1px solid ${C.border2}`, flexShrink: 0,
            }}>
              <div style={{ fontSize: "11px", color: C.text3, marginBottom: "2px" }}>#{i + 1}</div>
              <div style={{ fontWeight: 700, fontSize: "13px", marginBottom: "6px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.name}</div>
              <MiniChart returns={s.returns} width={116} height={28} />
              <div style={{ fontWeight: 800, fontSize: "16px", color: s.cumReturn >= 0 ? C.green : C.red, marginTop: "4px" }}>
                {s.cumReturn >= 0 ? "+" : ""}{s.cumReturn}%
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 필터 + 정렬 */}
      <div style={{ display: "flex", gap: "6px", marginBottom: "12px", flexWrap: "wrap", alignItems: "center" }}>
        <button onClick={() => setFilterCat("all")} style={{
          padding: "6px 12px", borderRadius: "8px", fontSize: "12px", fontWeight: 600,
          background: filterCat === "all" ? C.blueBg : "transparent", color: filterCat === "all" ? C.blue : C.text3,
          border: `1px solid ${filterCat === "all" ? C.blue : C.border2}`, cursor: "pointer",
        }}>전체</button>
        {categories.map(cat => (
          <button key={cat} onClick={() => setFilterCat(cat)} style={{
            padding: "6px 12px", borderRadius: "8px", fontSize: "12px", fontWeight: 600,
            background: filterCat === cat ? (CAT_COLORS[cat] || C.blue) + "20" : "transparent",
            color: filterCat === cat ? (CAT_COLORS[cat] || C.blue) : C.text3,
            border: `1px solid ${filterCat === cat ? (CAT_COLORS[cat] || C.blue) : C.border2}`, cursor: "pointer",
          }}>{cat}</button>
        ))}
        <div style={{ flex: 1 }} />
        <select value={sortBy} onChange={e => setSortBy(e.target.value)} style={{
          padding: "6px 10px", borderRadius: "8px", fontSize: "12px", fontWeight: 600,
          background: C.card2, color: C.text2, border: `1px solid ${C.border2}`,
        }}>
          <option value="return">수익률순</option>
          <option value="sharpe">샤프비율순</option>
          <option value="name">이름순</option>
        </select>
      </div>

      {/* 전략 카드 그리드 */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "10px" }}>
        {filteredData.map((s, i) => (
          <div key={i} onClick={() => setSelectedStrategy(s)} style={{
            background: C.card, border: `1px solid ${C.border}`, borderRadius: "14px",
            padding: "16px", cursor: "pointer", transition: "all 0.2s",
          }}
          onMouseEnter={e => e.currentTarget.style.borderColor = C.blue}
          onMouseLeave={e => e.currentTarget.style.borderColor = C.border}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
              <div>
                <span style={{ padding: "2px 8px", borderRadius: "4px", fontSize: "10px", fontWeight: 700,
                  background: (CAT_COLORS[s.category] || C.blue) + "20", color: CAT_COLORS[s.category] || C.blue,
                  marginRight: "6px" }}>{s.category}</span>
                <span style={{ fontWeight: 700, fontSize: "14px" }}>{s.name}</span>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "8px" }}>
              <div>
                <div style={{ fontSize: "11px", color: C.text3 }}>30일 수익률</div>
                <div style={{ fontWeight: 800, fontSize: "20px", color: s.cumReturn >= 0 ? C.green : C.red }}>
                  {s.cumReturn >= 0 ? "+" : ""}{s.cumReturn}%
                </div>
              </div>
              <MiniChart returns={s.returns} />
            </div>

            <div style={{ display: "flex", gap: "12px", fontSize: "11px", color: C.text3 }}>
              <span>샤프 <b style={{ color: s.sharpe > 1 ? C.green : C.text2 }}>{s.sharpe}</b></span>
              <span>MDD <b style={{ color: C.red }}>{s.maxDD}%</b></span>
              <span>승률 <b style={{ color: s.winRate >= 55 ? C.green : C.text2 }}>{s.winRate}%</b></span>
            </div>

            <div style={{ display: "flex", gap: "4px", marginTop: "8px", flexWrap: "wrap" }}>
              {s.portfolio.slice(0, 4).map((p, j) => (
                <span key={j} style={{ padding: "2px 6px", borderRadius: "4px", fontSize: "10px",
                  background: C.card2, color: C.text3 }}>{p.sym}</span>
              ))}
              {s.portfolio.length > 4 && (
                <span style={{ padding: "2px 6px", borderRadius: "4px", fontSize: "10px",
                  background: C.card2, color: C.text3 }}>+{s.portfolio.length - 4}</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
