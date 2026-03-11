// DI금융 — 전략 추천 패널
// 시장 진단 → 전략 추천 → 상세 전략 카드
import { useState, useCallback } from "react";
import { ALL_STRATEGIES, diagnoseMarket, recommendStrategies } from "./strategies.js";

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

export default function StrategyPanel({ onRunBacktest }) {
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
        <div style={{ fontWeight: 700, fontSize: "15px", marginBottom: "14px" }}>🔬 시장 진단</div>
        <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap", marginBottom: "14px" }}>
          <select value={selectedSymbol} onChange={e => setSelectedSymbol(e.target.value)} style={{
            padding: "8px 12px", borderRadius: "10px", fontSize: "13px", fontWeight: 600,
            background: C.card2, color: C.text1, border: `1px solid ${C.border2}`,
            outline: "none", cursor: "pointer",
          }}>
            {symbols.map(s => <option key={s.value} value={s.value}>{s.label} ({s.value})</option>)}
          </select>
          <button onClick={runDiagnosis} disabled={loading} style={{
            padding: "8px 20px", borderRadius: "10px", fontSize: "13px", fontWeight: 700,
            background: loading ? C.card2 : C.blue, color: loading ? C.text3 : "#fff", border: "none", cursor: "pointer",
          }}>
            {loading ? "분석 중..." : "🔍 진단 실행"}
          </button>
        </div>

        {error && <div style={{ color: C.red, fontSize: "13px", marginBottom: "10px" }}>⚠️ {error}</div>}

        {diagnosis && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "10px" }}>
            <div style={{ background: regimeStyle.bg, borderRadius: "12px", padding: "14px", textAlign: "center" }}>
              <div style={{ fontSize: "24px", marginBottom: "4px" }}>{regimeStyle.icon}</div>
              <div style={{ fontSize: "11px", color: C.text3, marginBottom: "4px" }}>시장 국면</div>
              <div style={{ fontSize: "15px", fontWeight: 700, color: regimeStyle.color }}>{diagnosis.regime}</div>
            </div>
            <div style={{ background: C.card2, borderRadius: "12px", padding: "14px", textAlign: "center" }}>
              <div style={{ fontSize: "24px", marginBottom: "4px" }}>{diagnosis.trend === "상승" ? "📈" : diagnosis.trend === "하락" ? "📉" : "➡️"}</div>
              <div style={{ fontSize: "11px", color: C.text3, marginBottom: "4px" }}>추세</div>
              <div style={{ fontSize: "15px", fontWeight: 700, color: C.text1 }}>{diagnosis.trend}</div>
            </div>
            <div style={{ background: C.card2, borderRadius: "12px", padding: "14px", textAlign: "center" }}>
              <div style={{ fontSize: "24px", marginBottom: "4px" }}>📊</div>
              <div style={{ fontSize: "11px", color: C.text3, marginBottom: "4px" }}>변동성</div>
              <div style={{ fontSize: "15px", fontWeight: 700, color: C.text1 }}>{diagnosis.volatility} ({diagnosis.atrPct}%)</div>
            </div>
            <div style={{ background: C.card2, borderRadius: "12px", padding: "14px", textAlign: "center" }}>
              <div style={{ fontSize: "24px", marginBottom: "4px" }}>{diagnosis.momentum === "과매수" ? "🔴" : diagnosis.momentum === "과매도" ? "🟢" : "⚪"}</div>
              <div style={{ fontSize: "11px", color: C.text3, marginBottom: "4px" }}>모멘텀</div>
              <div style={{ fontSize: "15px", fontWeight: 700, color: C.text1 }}>{diagnosis.momentum} {diagnosis.rsi != null ? `(RSI ${diagnosis.rsi})` : ""}</div>
            </div>
          </div>
        )}
      </div>

      {/* 추천 전략 */}
      {recs.length > 0 && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "16px", padding: "20px", marginBottom: "16px" }}>
          <div style={{ fontWeight: 700, fontSize: "15px", marginBottom: "14px" }}>🎯 추천 전략 (시장 진단 기반)</div>
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
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <span style={{ fontSize: "18px" }}>{s.icon}</span>
                      <span style={{ fontWeight: 700, fontSize: "14px", color: C.text1 }}>{s.name}</span>
                      <span style={{
                        padding: "2px 7px", borderRadius: "6px", fontSize: "10px", fontWeight: 700,
                        background: `${catColor}22`, color: catColor,
                      }}>{s.category}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <div style={{
                        width: "28px", height: "28px", borderRadius: "50%",
                        background: `${C.blue}22`, display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: "12px", fontWeight: 800, color: C.blue,
                      }}>{rec.score}</div>
                    </div>
                  </div>
                  <div style={{ fontSize: "12px", color: C.text2, marginBottom: "4px" }}>{rec.reason}</div>
                  {expandedStrategy === s.id && (
                    <div style={{ marginTop: "10px", paddingTop: "10px", borderTop: `1px solid ${C.border}` }}>
                      <div style={{ fontSize: "12px", color: C.text2, marginBottom: "8px", lineHeight: 1.6 }}>{s.desc}</div>
                      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
                        <span style={{ padding: "3px 8px", borderRadius: "6px", fontSize: "10px", background: C.card, color: C.text3, border: `1px solid ${C.border}` }}>
                          위험도: {s.risk}
                        </span>
                        <span style={{ padding: "3px 8px", borderRadius: "6px", fontSize: "10px", background: `${CAT_COLORS[s.category] || C.blue}15`, color: CAT_COLORS[s.category] || C.blue, fontWeight: 600 }}>
                          {s.category}
                        </span>
                        {onRunBacktest && (
                          <button onClick={(e) => { e.stopPropagation(); onRunBacktest(s, selectedSymbol); }} style={{
                            padding: "6px 14px", borderRadius: "8px", fontSize: "11px", fontWeight: 700,
                            background: `linear-gradient(135deg, ${C.blue}, ${C.blueL})`, color: "#fff",
                            border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: "4px",
                            boxShadow: `0 2px 8px ${C.blue}40`,
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
        <div style={{ fontWeight: 700, fontSize: "15px", marginBottom: "14px" }}>📋 전체 전략 목록 ({ALL_STRATEGIES.length}개)</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "10px" }}>
          {ALL_STRATEGIES.map(s => {
            const catColor = CAT_COLORS[s.category] || C.blue;
            return (
              <div key={s.id} style={{
                background: C.card2, borderRadius: "12px", padding: "14px", border: `1px solid ${C.border2}`,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                  <span style={{ fontSize: "16px" }}>{s.icon}</span>
                  <span style={{ fontWeight: 700, fontSize: "13px", color: C.text1 }}>{s.name}</span>
                </div>
                <div style={{ fontSize: "11px", color: C.text2, marginBottom: "8px", lineHeight: 1.5 }}>{s.desc}</div>
                <div style={{ display: "flex", gap: "5px", flexWrap: "wrap" }}>
                  <span style={{
                    padding: "2px 6px", borderRadius: "4px", fontSize: "10px", fontWeight: 600,
                    background: `${catColor}22`, color: catColor,
                  }}>{s.category}</span>
                  <span style={{
                    padding: "2px 6px", borderRadius: "4px", fontSize: "10px",
                    background: C.card, color: C.text3,
                  }}>위험도: {s.risk}</span>
                  {onRunBacktest && (
                    <button onClick={() => onRunBacktest(s, selectedSymbol)} style={{
                      padding: "4px 10px", borderRadius: "6px", fontSize: "10px", fontWeight: 700,
                      background: `linear-gradient(135deg, ${C.blue}, ${C.blueL})`, color: "#fff",
                      border: "none", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: "3px",
                      boxShadow: `0 1px 4px ${C.blue}30`,
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
