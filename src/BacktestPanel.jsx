// DI금융 — 백테스트 패널
// 전략 선택 → 데이터 로드 → 백테스트 실행 → 성과 시각화
import { useState, useCallback, useRef, useEffect } from "react";
import { ALL_STRATEGIES, runBacktest } from "./strategies.js";

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

function MetricCard({ label, value, color, sub }) {
  return (
    <div style={{ background: C.card2, borderRadius: "10px", padding: "12px", textAlign: "center", minWidth: "100px" }}>
      <div style={{ fontSize: "11px", color: C.text3, marginBottom: "4px" }}>{label}</div>
      <div style={{ fontSize: "18px", fontWeight: 800, color: color || C.text1 }}>{value}</div>
      {sub && <div style={{ fontSize: "10px", color: C.text3, marginTop: "2px" }}>{sub}</div>}
    </div>
  );
}

function EquityChart({ equity, buyHoldReturn, initialCapital }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !equity.length) return;
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);

    const values = equity.map(e => e.value);
    const min = Math.min(...values) * 0.98;
    const max = Math.max(...values) * 1.02;
    const range = max - min || 1;

    // Background
    ctx.fillStyle = C.card2;
    ctx.fillRect(0, 0, w, h);

    // Grid
    ctx.strokeStyle = C.border;
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 4; i++) {
      const y = (h / 4) * i;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }

    // Buy & Hold line
    if (buyHoldReturn != null) {
      ctx.strokeStyle = `${C.text3}66`;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      const bhFinal = initialCapital * (1 + buyHoldReturn / 100);
      for (let i = 0; i < equity.length; i++) {
        const x = (i / (equity.length - 1)) * w;
        const progress = i / (equity.length - 1);
        const bhValue = initialCapital + (bhFinal - initialCapital) * progress;
        const y = h - ((bhValue - min) / range) * h;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Equity curve
    ctx.strokeStyle = C.blue;
    ctx.lineWidth = 2;
    ctx.beginPath();
    equity.forEach((e, i) => {
      const x = (i / (equity.length - 1)) * w;
      const y = h - ((e.value - min) / range) * h;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Fill under curve
    const lastX = w;
    ctx.lineTo(lastX, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, `${C.blue}33`);
    grad.addColorStop(1, `${C.blue}05`);
    ctx.fillStyle = grad;
    ctx.fill();

    // Labels
    ctx.fillStyle = C.text3;
    ctx.font = "10px system-ui";
    ctx.textAlign = "left";
    ctx.fillText(`$${max.toFixed(0)}`, 4, 12);
    ctx.fillText(`$${min.toFixed(0)}`, 4, h - 4);

    // Legend
    ctx.fillStyle = C.blue;
    ctx.fillRect(w - 120, 6, 12, 2);
    ctx.fillStyle = C.text3;
    ctx.fillText("전략", w - 104, 11);
    if (buyHoldReturn != null) {
      ctx.strokeStyle = C.text3;
      ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(w - 120, 20); ctx.lineTo(w - 108, 20); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillText("Buy&Hold", w - 104, 24);
    }
  }, [equity, buyHoldReturn, initialCapital]);

  return (
    <canvas ref={canvasRef} style={{
      width: "100%", height: "200px", borderRadius: "10px", display: "block",
    }} />
  );
}

export default function BacktestPanel({ initialStrategy, initialSymbol }) {
  const [strategyId, setStrategyId] = useState(initialStrategy?.id || ALL_STRATEGIES[0].id);
  const [symbol, setSymbol] = useState(initialSymbol || "SPY");
  const [timeframe, setTimeframe] = useState("1d");
  const [range, setRange] = useState("1y");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [showTrades, setShowTrades] = useState(false);

  // Options
  const [capital, setCapital] = useState(10000);
  const [stopLoss, setStopLoss] = useState("");
  const [takeProfit, setTakeProfit] = useState("");

  useEffect(() => {
    if (initialStrategy) setStrategyId(initialStrategy.id);
    if (initialSymbol) setSymbol(initialSymbol);
  }, [initialStrategy, initialSymbol]);

  const execute = useCallback(async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const r = await fetch(`/api/yahoo-ohlc?symbol=${encodeURIComponent(symbol)}&interval=${timeframe}&range=${range}&_t=${Date.now()}`);
      if (!r.ok) throw new Error(`데이터 로드 실패 (${r.status})`);
      const j = await r.json();
      const candles = j.candles || [];
      if (candles.length < 30) throw new Error("데이터 부족 (최소 30봉 필요)");

      const strategy = ALL_STRATEGIES.find(s => s.id === strategyId);
      if (!strategy) throw new Error("전략을 찾을 수 없습니다");

      const signals = strategy.generate(candles);
      const btResult = runBacktest(candles, signals, {
        initialCapital: capital,
        positionSize: 1.0,
        stopLoss: stopLoss ? parseFloat(stopLoss) : null,
        takeProfit: takeProfit ? parseFloat(takeProfit) : null,
      });

      setResult({ ...btResult, strategyName: strategy.name, strategyIcon: strategy.icon, symbol, candles });
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [strategyId, symbol, timeframe, range, capital, stopLoss, takeProfit]);

  const strategy = ALL_STRATEGIES.find(s => s.id === strategyId);

  return (
    <div>
      {/* 설정 패널 */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "16px", padding: "20px", marginBottom: "16px" }}>
        <div style={{ fontWeight: 700, fontSize: "15px", marginBottom: "14px" }}>📊 백테스트 실행</div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: "10px", marginBottom: "14px" }}>
          <div>
            <label style={{ fontSize: "11px", color: C.text3, display: "block", marginBottom: "4px" }}>전략</label>
            <select value={strategyId} onChange={e => setStrategyId(e.target.value)} style={{
              width: "100%", padding: "8px 10px", borderRadius: "8px", fontSize: "13px",
              background: C.card2, color: C.text1, border: `1px solid ${C.border2}`, outline: "none",
            }}>
              {ALL_STRATEGIES.map(s => <option key={s.id} value={s.id}>{s.icon} {s.name}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: "11px", color: C.text3, display: "block", marginBottom: "4px" }}>종목 심볼</label>
            <input value={symbol} onChange={e => setSymbol(e.target.value.toUpperCase())} placeholder="SPY, AAPL, 005930.KS..."
              style={{
                width: "100%", padding: "8px 10px", borderRadius: "8px", fontSize: "13px",
                background: C.card2, color: C.text1, border: `1px solid ${C.border2}`, outline: "none",
                boxSizing: "border-box",
              }}
            />
          </div>
          <div>
            <label style={{ fontSize: "11px", color: C.text3, display: "block", marginBottom: "4px" }}>타임프레임</label>
            <div style={{ display: "flex", gap: "4px" }}>
              {[{ v: "1d", l: "일봉" }, { v: "1wk", l: "주봉" }].map(t => (
                <button key={t.v} onClick={() => setTimeframe(t.v)} style={{
                  flex: 1, padding: "8px", borderRadius: "8px", fontSize: "12px", fontWeight: 600,
                  background: timeframe === t.v ? C.blueBg : C.card2, color: timeframe === t.v ? C.blue : C.text3,
                  border: `1px solid ${timeframe === t.v ? C.blue : C.border2}`, cursor: "pointer",
                }}>{t.l}</button>
              ))}
            </div>
          </div>
          <div>
            <label style={{ fontSize: "11px", color: C.text3, display: "block", marginBottom: "4px" }}>기간</label>
            <div style={{ display: "flex", gap: "4px" }}>
              {[{ v: "6mo", l: "6개월" }, { v: "1y", l: "1년" }, { v: "2y", l: "2년" }, { v: "5y", l: "5년" }].map(r => (
                <button key={r.v} onClick={() => setRange(r.v)} style={{
                  flex: 1, padding: "8px", borderRadius: "8px", fontSize: "12px", fontWeight: 600,
                  background: range === r.v ? C.blueBg : C.card2, color: range === r.v ? C.blue : C.text3,
                  border: `1px solid ${range === r.v ? C.blue : C.border2}`, cursor: "pointer",
                }}>{r.l}</button>
              ))}
            </div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: "10px", marginBottom: "14px" }}>
          <div>
            <label style={{ fontSize: "11px", color: C.text3, display: "block", marginBottom: "4px" }}>초기 자본 ($)</label>
            <input type="number" value={capital} onChange={e => setCapital(+e.target.value || 10000)} style={{
              width: "100%", padding: "8px 10px", borderRadius: "8px", fontSize: "13px",
              background: C.card2, color: C.text1, border: `1px solid ${C.border2}`, outline: "none", boxSizing: "border-box",
            }} />
          </div>
          <div>
            <label style={{ fontSize: "11px", color: C.text3, display: "block", marginBottom: "4px" }}>손절 (%, 선택)</label>
            <input type="number" value={stopLoss} onChange={e => setStopLoss(e.target.value)} placeholder="예: 5" style={{
              width: "100%", padding: "8px 10px", borderRadius: "8px", fontSize: "13px",
              background: C.card2, color: C.text1, border: `1px solid ${C.border2}`, outline: "none", boxSizing: "border-box",
            }} />
          </div>
          <div>
            <label style={{ fontSize: "11px", color: C.text3, display: "block", marginBottom: "4px" }}>익절 (%, 선택)</label>
            <input type="number" value={takeProfit} onChange={e => setTakeProfit(e.target.value)} placeholder="예: 10" style={{
              width: "100%", padding: "8px 10px", borderRadius: "8px", fontSize: "13px",
              background: C.card2, color: C.text1, border: `1px solid ${C.border2}`, outline: "none", boxSizing: "border-box",
            }} />
          </div>
        </div>

        <button onClick={execute} disabled={loading} style={{
          padding: "11px 28px", borderRadius: "12px", fontSize: "14px", fontWeight: 700,
          background: loading ? C.card2 : C.blue, color: loading ? C.text3 : "#fff", border: "none", cursor: "pointer",
        }}>
          {loading ? "⏳ 백테스트 실행 중..." : `🚀 ${strategy?.name || "전략"} 백테스트 실행`}
        </button>
        {error && <div style={{ color: C.red, fontSize: "13px", marginTop: "10px" }}>⚠️ {error}</div>}
      </div>

      {/* 결과 */}
      {result && (
        <>
          {/* 성과 요약 */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "16px", padding: "20px", marginBottom: "16px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "14px" }}>
              <div style={{ fontWeight: 700, fontSize: "15px" }}>
                {result.strategyIcon} {result.strategyName} — {result.symbol}
              </div>
              <span style={{
                padding: "4px 10px", borderRadius: "8px", fontSize: "12px", fontWeight: 700,
                background: result.totalReturn >= 0 ? C.greenBg : C.redBg,
                color: result.totalReturn >= 0 ? C.green : C.red,
              }}>
                {result.totalReturn >= 0 ? "+" : ""}{result.totalReturn}%
              </span>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gap: "8px", marginBottom: "16px" }}>
              <MetricCard label="총 수익률" value={`${result.totalReturn >= 0 ? "+" : ""}${result.totalReturn}%`}
                color={result.totalReturn >= 0 ? C.green : C.red}
                sub={`$${result.initialCapital.toLocaleString()} → $${result.finalEquity.toLocaleString()}`} />
              <MetricCard label="Buy&Hold" value={`${result.buyHoldReturn >= 0 ? "+" : ""}${result.buyHoldReturn}%`}
                color={result.buyHoldReturn >= 0 ? C.green : C.red}
                sub={result.totalReturn > result.buyHoldReturn ? "전략 우위" : "시장 대비 저조"} />
              <MetricCard label="승률" value={`${result.winRate}%`}
                color={result.winRate >= 50 ? C.green : C.yellow}
                sub={`${result.totalTrades}건 거래`} />
              <MetricCard label="샤프 비율" value={result.sharpeRatio}
                color={result.sharpeRatio >= 1 ? C.green : result.sharpeRatio >= 0 ? C.yellow : C.red}
                sub={result.sharpeRatio >= 1.5 ? "우수" : result.sharpeRatio >= 1 ? "양호" : "개선필요"} />
              <MetricCard label="최대 낙폭" value={`-${result.maxDrawdown}%`}
                color={result.maxDrawdown <= 10 ? C.green : result.maxDrawdown <= 20 ? C.yellow : C.red} />
              <MetricCard label="프로핏 팩터" value={result.profitFactor === Infinity ? "∞" : result.profitFactor}
                color={result.profitFactor >= 1.5 ? C.green : result.profitFactor >= 1 ? C.yellow : C.red} />
              <MetricCard label="평균 수익" value={`${result.avgWin >= 0 ? "+" : ""}${result.avgWin}%`} color={C.green} />
              <MetricCard label="평균 손실" value={`${result.avgLoss}%`} color={C.red}
                sub={`최대연속: ${result.maxConsecLoss}회`} />
            </div>

            {/* 자산 곡선 */}
            <div style={{ marginBottom: "10px" }}>
              <div style={{ fontSize: "12px", color: C.text3, marginBottom: "6px" }}>자산 곡선 (Equity Curve)</div>
              <EquityChart equity={result.equity} buyHoldReturn={result.buyHoldReturn} initialCapital={result.initialCapital} />
            </div>
          </div>

          {/* 거래 내역 */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "16px", padding: "20px" }}>
            <div onClick={() => setShowTrades(!showTrades)} style={{
              display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer",
            }}>
              <div style={{ fontWeight: 700, fontSize: "15px" }}>📜 거래 내역 ({result.trades.length}건)</div>
              <span style={{ color: C.text3, fontSize: "18px" }}>{showTrades ? "▲" : "▼"}</span>
            </div>
            {showTrades && (
              <div style={{ marginTop: "12px", maxHeight: "400px", overflow: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${C.border2}` }}>
                      {["타입", "날짜", "가격", "수량", "수익", "사유"].map(h => (
                        <th key={h} style={{ padding: "8px 6px", textAlign: "left", color: C.text3, fontWeight: 600, fontSize: "11px" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.trades.map((t, i) => {
                      const date = t.time ? new Date(t.time * 1000).toLocaleDateString("ko-KR") : `#${t.index}`;
                      return (
                        <tr key={i} style={{ borderBottom: `1px solid ${C.border}` }}>
                          <td style={{
                            padding: "6px",
                            color: t.type === "BUY" ? C.green : C.red,
                            fontWeight: 700,
                          }}>{t.type === "BUY" ? "매수" : "매도"}</td>
                          <td style={{ padding: "6px", color: C.text2 }}>{date}</td>
                          <td style={{ padding: "6px", color: C.text1 }}>${t.price?.toFixed(2)}</td>
                          <td style={{ padding: "6px", color: C.text2 }}>{t.qty?.toFixed(4)}</td>
                          <td style={{
                            padding: "6px",
                            color: t.pnl != null ? (t.pnl >= 0 ? C.green : C.red) : C.text3,
                          }}>
                            {t.pnl != null ? `${t.pnl >= 0 ? "+" : ""}$${t.pnl.toFixed(2)} (${t.pnlPct >= 0 ? "+" : ""}${t.pnlPct.toFixed(1)}%)` : "—"}
                          </td>
                          <td style={{ padding: "6px", color: C.text3, maxWidth: "160px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {t.reason}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
