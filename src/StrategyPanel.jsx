// Zepta — 전략 추천 패널
// 시장 진단 → 전략 추천 → 상세 전략 카드
import { useState, useCallback, useEffect } from "react";
import { ALL_STRATEGIES, diagnoseMarket, recommendStrategies } from "./strategies.js";

// ── Zepta 토큰 기반 (theme-responsive) ──
// 모든 색상은 src/ui/tokens.css 의 --z-* CSS 변수를 참조한다.
// data-theme=light 전환 시 자동으로 라이트 팔레트로 바뀜.
const C = {
  bg: "var(--z-bg)", card: "var(--z-card)", card2: "var(--z-card-2)",
  border: "var(--z-border)", border2: "var(--z-border-2)",
  blue: "var(--z-blue)", blueL: "var(--z-blue-hi)", blueBg: "var(--z-blue-bg)",
  red: "var(--z-red)", redBg: "var(--z-red-bg)",
  green: "var(--z-green)", greenBg: "var(--z-green-bg)",
  yellow: "var(--z-yellow)", yellowBg: "var(--z-yellow-bg)",
  purple: "var(--z-purple)", purpleBg: "var(--z-purple-bg)",
  text1: "var(--z-text)", text2: "var(--z-text-2)", text3: "var(--z-text-3)",
};

// 모바일 감지 훅
function useMobile() {
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.innerWidth <= 640);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const handler = (e) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return isMobile;
}

const REGIME_COLORS = {
  "안정적 상승": { bg: C.greenBg, color: C.green, icon: "📈" },
  "변동성 상승": { bg: C.yellowBg, color: C.yellow, icon: "🎢" },
  "급락":        { bg: C.redBg, color: C.red, icon: "📉" },
  "완만한 하락":  { bg: C.redBg, color: C.red, icon: "🔻" },
  "저변동 횡보":  { bg: C.blueBg, color: C.blue, icon: "➡️" },
  "변동성 횡보":  { bg: C.yellowBg, color: C.yellow, icon: "↔️" },
  "혼조":        { bg: C.purpleBg, color: C.purple, icon: "🌀" },
  "unknown":     { bg: C.card2, color: C.text3, icon: "❓" },
};

const CAT_COLORS = {
  "추세추종": C.blue, "평균회귀": C.purple, "모멘텀": C.yellow, "변동성": C.red,
};
// 카테고리별 배경 (var() 와 alpha hex 를 합칠 수 없어 별도 매핑)
const CAT_BG = {
  "추세추종": "var(--z-blue-bg)",
  "평균회귀": "var(--z-purple-bg)",
  "모멘텀":   "var(--z-yellow-bg)",
  "변동성":   "var(--z-red-bg)",
};

export default function StrategyPanel({ onRunBacktest }) {
  const isMobile = useMobile();
  const [loading, setLoading] = useState(false);
  const [diagnosis, setDiagnosis] = useState(null);
  const [recs, setRecs] = useState([]);
  const [selectedSymbol, setSelectedSymbol] = useState("SPY");
  const [error, setError] = useState(null);
  const [expandedStrategy, setExpandedStrategy] = useState(null);

  const symbols = [
    { label: "S&P 500", value: "SPY" },
    { label: "나스닥 100", value: "QQQ" },
    { label: "BITX (BTC 2x)", value: "BITX" },
    { label: "삼성전자", value: "005930.KS" },
    { label: "SK하이닉스", value: "000660.KS" },
    { label: "Bitcoin", value: "BTC-USD" },
    { label: "Apple", value: "AAPL" },
    { label: "NVIDIA", value: "NVDA" },
    { label: "Tesla", value: "TSLA" },
    { label: "AMD", value: "AMD" },
    { label: "Meta", value: "META" },
    { label: "Broadcom", value: "AVGO" },
    { label: "Palantir", value: "PLTR" },
    { label: "Coinbase", value: "COIN" },
    { label: "Russell 2000", value: "IWM" },
  ];

  const runDiagnosis = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/yahoo-ohlc?symbol=${encodeURIComponent(selectedSymbol)}&interval=1d&range=6mo&_t=${Date.now()}`);
      if (!r.ok) throw new Error(`데이터 로드 실패 (${r.status})`);
      const j = await r.json();
      const candles = j.candles || [];
      if (candles.length < 60) throw new Error("데이터 부족 (최소 60봉 필요)");
      const diag = diagnoseMarket(candles);
      const recommended = recommendStrategies(diag);
      setDiagnosis(diag);
      setRecs(recommended);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [selectedSymbol]);

  const regimeStyle = diagnosis ? REGIME_COLORS[diagnosis.regime] || REGIME_COLORS["unknown"] : REGIME_COLORS["unknown"];

  return (
    <div>
      {/* 시장 진단 */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "16px", padding: "20px", marginBottom: "16px" }}>
        <div style={{ fontWeight: 700, fontSize: "17px", marginBottom: "14px" }}>🔬 시장 진단</div>
        <div style={{ display: "flex", gap: isMobile ? "6px" : "8px", alignItems: "center", flexWrap: "wrap", marginBottom: "14px", flexDirection: isMobile ? "column" : "row" }}>
          <select value={selectedSymbol} onChange={e => setSelectedSymbol(e.target.value)} style={{
            padding: isMobile ? "10px 8px" : "8px 12px", borderRadius: "10px", fontSize: isMobile ? "14px" : "15px", fontWeight: 600,
            background: C.card2, color: C.text1, border: `1px solid ${C.border2}`,
            outline: "none", cursor: "pointer", width: isMobile ? "100%" : "auto", minHeight: "44px", display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            {symbols.map(s => <option key={s.value} value={s.value}>{s.label} ({s.value})</option>)}
          </select>
          <button onClick={runDiagnosis} disabled={loading} style={{
            padding: isMobile ? "10px 14px" : "8px 20px", borderRadius: "10px", fontSize: isMobile ? "14px" : "15px", fontWeight: 700,
            background: loading ? C.card2 : C.blue, color: loading ? C.text3 : "#fff", border: "none", cursor: "pointer", width: isMobile ? "100%" : "auto", minHeight: "44px", display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            {loading ? "분석 중..." : "🔍 진단 실행"}
          </button>
        </div>

        {error && <div style={{ color: C.red, fontSize: "15px", marginBottom: "10px" }}>⚠️ {error}</div>}

        {diagnosis && (
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(auto-fit, minmax(140px, 1fr))", gap: isMobile ? "6px" : "10px" }}>
            <div style={{ background: regimeStyle.bg, borderRadius: "12px", padding: isMobile ? "10px 8px" : "14px", textAlign: "center" }}>
              <div style={{ fontSize: isMobile ? "20px" : "24px", marginBottom: "4px" }}>{regimeStyle.icon}</div>
              <div style={{ fontSize: isMobile ? "12px" : "14px", color: C.text3, marginBottom: "4px" }}>시장 국면</div>
              <div style={{ fontSize: isMobile ? "14px" : "17px", fontWeight: 700, color: regimeStyle.color }}>{diagnosis.regime}</div>
            </div>
            <div style={{ background: C.card2, borderRadius: "12px", padding: isMobile ? "10px 8px" : "14px", textAlign: "center" }}>
              <div style={{ fontSize: isMobile ? "20px" : "24px", marginBottom: "4px" }}>{diagnosis.trend === "상승" ? "📈" : diagnosis.trend === "하락" ? "📉" : "➡️"}</div>
              <div style={{ fontSize: isMobile ? "12px" : "14px", color: C.text3, marginBottom: "4px" }}>추세</div>
              <div style={{ fontSize: isMobile ? "14px" : "17px", fontWeight: 700, color: C.text1 }}>{diagnosis.trend}</div>
            </div>
            <div style={{ background: C.card2, borderRadius: "12px", padding: isMobile ? "10px 8px" : "14px", textAlign: "center" }}>
              <div style={{ fontSize: isMobile ? "20px" : "24px", marginBottom: "4px" }}>📊</div>
              <div style={{ fontSize: isMobile ? "12px" : "14px", color: C.text3, marginBottom: "4px" }}>변동성</div>
              <div style={{ fontSize: isMobile ? "14px" : "17px", fontWeight: 700, color: C.text1 }}>{diagnosis.volatility} ({diagnosis.atrPct}%)</div>
            </div>
            <div style={{ background: C.card2, borderRadius: "12px", padding: isMobile ? "10px 8px" : "14px", textAlign: "center" }}>
              <div style={{ fontSize: isMobile ? "20px" : "24px", marginBottom: "4px" }}>{diagnosis.momentum === "과매수" ? "🔴" : diagnosis.momentum === "과매도" ? "🟢" : "⚪"}</div>
              <div style={{ fontSize: isMobile ? "12px" : "14px", color: C.text3, marginBottom: "4px" }}>모멘텀</div>
              <div style={{ fontSize: isMobile ? "14px" : "17px", fontWeight: 700, color: C.text1 }}>{diagnosis.momentum} {diagnosis.rsi != null ? `(RSI ${diagnosis.rsi})` : ""}</div>
            </div>
          </div>
        )}
      </div>

      {/* 추천 전략 */}
      {recs.length > 0 && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "16px", padding: "20px", marginBottom: "16px" }}>
          <div style={{ fontWeight: 700, fontSize: "17px", marginBottom: "14px" }}>🎯 추천 전략 (시장 진단 기반)</div>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {recs.map((rec, idx) => {
              const s = rec.strategy;
              const catColor = CAT_COLORS[s.category] || C.blue;
              return (
                <div key={s.id} style={{
                  background: C.card2, borderRadius: "12px", padding: "14px",
                  border: `1px solid ${idx === 0 ? C.blue : C.border2}`,
                  cursor: "pointer",
                }} onClick={() => setExpandedStrategy(expandedStrategy === s.id ? null : s.id)}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px", flexWrap: isMobile ? "wrap" : "nowrap", gap: isMobile ? "4px" : "8px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: isMobile ? "4px" : "8px", minWidth: 0, flex: 1 }}>
                      <span style={{ fontSize: isMobile ? "16px" : "18px", flexShrink: 0 }}>{s.icon}</span>
                      <span style={{ fontWeight: 700, fontSize: isMobile ? "14px" : "16px", color: C.text1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</span>
                      <span style={{
                        padding: "2px 6px", borderRadius: "6px", fontSize: isMobile ? "11px" : "13px", fontWeight: 700,
                        background: CAT_BG[s.category] || C.blueBg, color: catColor, flexShrink: 0,
                      }}>{s.category}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <div style={{
                        width: "28px", height: "28px", borderRadius: "50%",
                        background: C.blueBg, display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: "14px", fontWeight: 800, color: C.blue,
                      }}>{rec.score}</div>
                    </div>
                  </div>
                  <div style={{ fontSize: "14px", color: C.text2, marginBottom: "4px" }}>{rec.reason}</div>
                  {expandedStrategy === s.id && (
                    <div style={{ marginTop: "10px", paddingTop: "10px", borderTop: `1px solid ${C.border}` }}>
                      <div style={{ fontSize: "14px", color: C.text2, marginBottom: "8px", lineHeight: 1.6 }}>{s.desc}</div>
                      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
                        <span style={{ padding: "3px 8px", borderRadius: "6px", fontSize: "13px", background: C.card, color: C.text3, border: `1px solid ${C.border}` }}>
                          위험도: {s.risk}
                        </span>
                        <span style={{ padding: "3px 8px", borderRadius: "6px", fontSize: "13px", background: CAT_BG[s.category] || C.blueBg, color: CAT_COLORS[s.category] || C.blue, fontWeight: 600 }}>
                          {s.category}
                        </span>
                        {onRunBacktest && (
                          <button onClick={(e) => { e.stopPropagation(); onRunBacktest(s, selectedSymbol); }} style={{
                            padding: isMobile ? "8px 10px" : "6px 14px", borderRadius: "8px", fontSize: isMobile ? "12px" : "14px", fontWeight: 700,
                            background: `linear-gradient(135deg, var(--z-blue), var(--z-blue-hi))`, color: "#fff",
                            border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: "4px", minHeight: isMobile ? "40px" : "auto",
                            boxShadow: `var(--z-sh)`,
                          }}>📊 백테스트 실행</button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 전체 전략 목록 */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "16px", padding: "20px" }}>
        <div style={{ fontWeight: 700, fontSize: "17px", marginBottom: "14px" }}>📋 전체 전략 목록 ({ALL_STRATEGIES.length}개)</div>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill, minmax(min(240px, 100%), 1fr))", gap: isMobile ? "8px" : "10px" }}>
          {ALL_STRATEGIES.map(s => {
            const catColor = CAT_COLORS[s.category] || C.blue;
            return (
              <div key={s.id} style={{
                background: C.card2, borderRadius: "12px", padding: "14px", border: `1px solid ${C.border2}`,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                  <span style={{ fontSize: "18px" }}>{s.icon}</span>
                  <span style={{ fontWeight: 700, fontSize: "15px", color: C.text1, flex: 1 }}>{s.name}</span>
                  <span style={{
                    padding: "2px 6px", borderRadius: "4px", fontSize: "13px", fontWeight: 600,
                    background: CAT_BG[s.category] || C.blueBg, color: catColor, flexShrink: 0,
                  }}>{s.category}</span>
                </div>
                <div style={{ fontSize: "14px", color: C.text2, marginBottom: "8px", lineHeight: 1.5 }}>{s.desc}</div>
                <div style={{ display: "flex", gap: "5px", flexWrap: "wrap", alignItems: "center" }}>
                  <span style={{
                    padding: "2px 6px", borderRadius: "4px", fontSize: "13px",
                    background: C.card, color: C.text3,
                  }}>위험도: {s.risk}</span>
                  {onRunBacktest && (
                    <button onClick={() => onRunBacktest(s, selectedSymbol)} style={{
                      padding: "4px 10px", borderRadius: "6px", fontSize: "13px", fontWeight: 700,
                      background: `linear-gradient(135deg, var(--z-blue), var(--z-blue-hi))`, color: "#fff",
                      border: "none", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: "3px",
                      boxShadow: `var(--z-sh-sm)`,
                    }}>📊 백테스트</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
