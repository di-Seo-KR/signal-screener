import React, { useState, useEffect, useCallback } from "react";

// Zepta tokens.css 와 동기화
const colors = {
  dark: {
    bg: "#070B14", card: "#101828", card2: "#161F33", border: "#1E2A42",
    text1: "#F1F5FB", text2: "#9AA7BD", text3: "#64728C",
    green: "#10D884", red: "#FF4D64", yellow: "#FFB020", blue: "#3B82F6",
    orange: "#FF6B2C", purple: "#9B6FFF",
  },
};

function StatusBadge({ ok, label }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: "5px",
      padding: "3px 10px", borderRadius: "12px", fontSize: "14px", fontWeight: 700,
      background: ok ? "#22c55e20" : "#ef444420",
      color: ok ? "#22c55e" : "#ef4444",
    }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: ok ? "#22c55e" : "#ef4444" }} />
      {label}
    </span>
  );
}

function Section({ title, badge, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  const c = colors.dark;
  return (
    <div style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: "12px", marginBottom: "12px", overflow: "hidden" }}>
      <div
        onClick={() => setOpen(!open)}
        style={{
          padding: "14px 18px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between",
          borderBottom: open ? `1px solid ${c.border}` : "none",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span style={{ fontSize: "16px", fontWeight: 700, color: c.text1 }}>{title}</span>
          {badge}
        </div>
        <span style={{ color: c.text3, fontSize: "14px" }}>{open ? "▼" : "▶"}</span>
      </div>
      {open && <div style={{ padding: "14px 18px" }}>{children}</div>}
    </div>
  );
}

function KVValue({ label, value, color }) {
  const c = colors.dark;
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: `1px solid ${c.border}22` }}>
      <span style={{ fontSize: "14px", color: c.text2 }}>{label}</span>
      <span style={{ fontSize: "14px", fontWeight: 600, color: color || c.text1, fontFamily: "monospace" }}>
        {typeof value === "number" ? value.toLocaleString(undefined, { maximumFractionDigits: 2 }) : String(value ?? "—")}
      </span>
    </div>
  );
}

export default function DevDashboard({ theme = "dark" }) {
  const c = colors.dark;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [lastFetched, setLastFetched] = useState(null);
  const [autoRefresh, setAutoRefresh] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/dev-status");
      const json = await res.json();
      setData(json);
      setLastFetched(new Date());
    } catch (e) {
      console.error("Dev status fetch failed:", e);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(fetchData, 15000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchData]);

  if (!data) return (
    <div style={{ background: c.bg, color: c.text1, minHeight: "100vh", padding: "40px 20px", textAlign: "center" }}>
      <div style={{ fontSize: "16px", color: c.text2 }}>시스템 상태 로딩 중...</div>
    </div>
  );

  const p = data.portfolio;
  const ph = data.portfolioHealth;
  const activeBots = data.activeBots || [];
  const errors = data.errors || [];

  // 전체 포지션 시가 (avgPrice 기반, 실시간 아님)
  const totalCostBasis = ph?.totalPositionCostBasis || 0;

  return (
    <div style={{ background: c.bg, color: c.text1, minHeight: "100vh", padding: "20px" }}>
      <div style={{ maxWidth: "900px", margin: "0 auto" }}>

        {/* 헤더 */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "20px", flexWrap: "wrap", gap: "10px" }}>
          <div>
            <h1 style={{ margin: 0, fontSize: "22px", fontWeight: 800, color: c.text1 }}>
              Zepta Dev/QA Dashboard
            </h1>
            <div style={{ fontSize: "14px", color: c.text3, marginTop: "4px" }}>
              마지막 조회: {lastFetched?.toLocaleTimeString() || "—"} · 응답: {data.responseTime}
            </div>
          </div>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <button onClick={fetchData} disabled={loading} style={{
              padding: "8px 16px", borderRadius: "8px", fontSize: "14px", fontWeight: 700,
              background: c.blue, color: "#fff", border: "none", cursor: "pointer",
              opacity: loading ? 0.5 : 1,
            }}>
              {loading ? "로딩..." : "새로고침"}
            </button>
            <button onClick={async () => {
              if (!confirm("포트폴리오를 $100,000으로 초기화합니다. 모든 포지션이 삭제됩니다.")) return;
              const r = await fetch("/api/dev-status?action=reset-portfolio", { method: "POST" });
              const d = await r.json();
              alert(d.message || d.error);
              fetchData();
            }} style={{
              padding: "8px 16px", borderRadius: "8px", fontSize: "14px", fontWeight: 700,
              background: c.red, color: "#fff", border: "none", cursor: "pointer",
            }}>
              포트폴리오 초기화
            </button>
            <button onClick={async () => {
              if (!confirm("모든 봇의 성과 데이터(거래기록, DD/MDD)를 초기화합니다.")) return;
              const r = await fetch("/api/dev-status?action=reset-bots", { method: "POST" });
              const d = await r.json();
              alert(d.message || d.error);
              fetchData();
            }} style={{
              padding: "8px 16px", borderRadius: "8px", fontSize: "14px", fontWeight: 700,
              background: c.orange, color: "#fff", border: "none", cursor: "pointer",
            }}>
              봇 성과 초기화
            </button>
            <button onClick={() => setAutoRefresh(!autoRefresh)} style={{
              padding: "8px 16px", borderRadius: "8px", fontSize: "14px", fontWeight: 700,
              background: autoRefresh ? c.green : c.card2, color: autoRefresh ? "#fff" : c.text2,
              border: `1px solid ${autoRefresh ? c.green : c.border}`, cursor: "pointer",
            }}>
              {autoRefresh ? "자동갱신 ON" : "자동갱신 OFF"}
            </button>
          </div>
        </div>

        {/* 에러 */}
        {errors.length > 0 && (
          <div style={{
            background: `${c.red}10`, border: `1px solid ${c.red}30`, borderRadius: "10px",
            padding: "12px 16px", marginBottom: "12px",
          }}>
            <div style={{ fontSize: "14px", fontWeight: 700, color: c.red, marginBottom: "6px" }}>오류 {errors.length}건</div>
            {errors.map((e, i) => (
              <div key={i} style={{ fontSize: "14px", color: c.red, fontFamily: "monospace", padding: "2px 0" }}>{e}</div>
            ))}
          </div>
        )}

        {/* 시스템 상태 요약 */}
        <div style={{
          display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "8px", marginBottom: "16px",
        }}>
          {[
            { label: "KV 연결", ok: data.kv?.connected },
            { label: "가격 소스", ok: data.prices?.crypto?.ok },
            { label: "포트폴리오", ok: !!p },
            { label: "활성 봇", ok: Array.isArray(activeBots) },
            { label: "마켓 레짐", ok: !!data.marketRegime },
            { label: "오류", ok: errors.length === 0 },
          ].map((s, i) => (
            <div key={i} style={{
              background: c.card, border: `1px solid ${c.border}`, borderRadius: "10px",
              padding: "12px", textAlign: "center",
            }}>
              <div style={{ fontSize: "13px", color: c.text3, marginBottom: "6px" }}>{s.label}</div>
              <StatusBadge ok={s.ok} label={s.ok ? "OK" : "FAIL"} />
            </div>
          ))}
        </div>

        {/* 포트폴리오 */}
        <Section
          title="가상 포트폴리오"
          badge={<StatusBadge ok={!!p} label={p ? `$${Math.round(p.cash + totalCostBasis).toLocaleString()}` : "없음"} />}
        >
          {ph ? (
            <>
              <KVValue label="현금" value={`$${ph.cash?.toLocaleString()}`} color={c.green} />
              <KVValue label="포지션 수" value={ph.positionCount} />
              <KVValue label="포지션 원가 합계" value={`$${ph.totalPositionCostBasis?.toLocaleString()}`} />
              <KVValue label="총 거래 횟수" value={ph.totalTrades} />
              <KVValue label="초기 자금" value={`$${ph.initialCash?.toLocaleString()}`} />
              <KVValue label="현금 비율" value={`${(ph.cashRatio * 100).toFixed(1)}%`} color={ph.cashRatio < 0.2 ? c.red : c.green} />

              {ph.positions?.length > 0 && (
                <div style={{ marginTop: "12px" }}>
                  <div style={{ fontSize: "14px", fontWeight: 700, color: c.text1, marginBottom: "8px" }}>보유 포지션 ({ph.positions.length})</div>
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "14px" }}>
                      <thead>
                        <tr style={{ borderBottom: `1px solid ${c.border}` }}>
                          {["자산", "수량", "평균가", "원가", "진입일"].map(h => (
                            <th key={h} style={{ padding: "6px 8px", textAlign: "left", color: c.text3, fontWeight: 600 }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {ph.positions.map((pos, i) => (
                          <tr key={i} style={{ borderBottom: `1px solid ${c.border}15` }}>
                            <td style={{ padding: "6px 8px", color: c.blue, fontWeight: 600 }}>{pos.asset}</td>
                            <td style={{ padding: "6px 8px", color: c.text1, fontFamily: "monospace" }}>{pos.qty?.toFixed(6)}</td>
                            <td style={{ padding: "6px 8px", color: c.text1, fontFamily: "monospace" }}>${pos.avgPrice?.toLocaleString()}</td>
                            <td style={{ padding: "6px 8px", color: c.text1, fontFamily: "monospace" }}>${pos.costBasis?.toLocaleString()}</td>
                            <td style={{ padding: "6px 8px", color: c.text3 }}>{pos.entryTime?.slice(0, 10)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div style={{ fontSize: "14px", color: c.text3 }}>포트폴리오 데이터 없음</div>
          )}
        </Section>

        {/* 활성 봇 */}
        <Section
          title="활성 봇 (KV)"
          badge={<StatusBadge ok={activeBots.length > 0} label={`${activeBots.length}개`} />}
        >
          {activeBots.length > 0 ? activeBots.map((ab, i) => (
            <div key={i} style={{
              background: c.card2, borderRadius: "8px", padding: "10px 14px", marginBottom: "6px",
              border: `1px solid ${c.border}`,
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: "15px", fontWeight: 700, color: c.text1 }}>{ab.botId}</span>
                <span style={{
                  fontSize: "13px", padding: "2px 8px", borderRadius: "8px",
                  background: ab.status === "paused" ? `${c.yellow}20` : `${c.green}20`,
                  color: ab.status === "paused" ? c.yellow : c.green,
                  fontWeight: 700,
                }}>{ab.status === "paused" ? "일시정지" : "활성"}</span>
              </div>
              <div style={{ display: "flex", gap: "16px", marginTop: "6px", fontSize: "14px", color: c.text2 }}>
                <span>배분: ${(ab.allocation || 0).toLocaleString()}</span>
                <span>시작: {ab.startedAt ? new Date(ab.startedAt).toLocaleDateString() : "—"}</span>
              </div>
            </div>
          )) : (
            <div style={{ fontSize: "14px", color: c.text3 }}>활성 봇 없음 (KV에 di:active-bots 데이터 없음)</div>
          )}
        </Section>

        {/* 봇별 성과 */}
        <Section title="봇별 성과 (KV)" defaultOpen={false}>
          {Object.keys(data.botPerformance).length > 0 ? Object.entries(data.botPerformance).map(([id, perf]) => (
            <div key={id} style={{
              background: c.card2, borderRadius: "8px", padding: "10px 14px", marginBottom: "6px",
              border: `1px solid ${c.border}`,
            }}>
              <div style={{ fontSize: "15px", fontWeight: 700, color: c.blue, marginBottom: "6px" }}>{id}</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "4px", fontSize: "14px" }}>
                <KVValue label="거래 수" value={perf.tradeCount} />
                <KVValue label="실현 P&L" value={`$${perf.realizedPL?.toFixed(2)}`} color={perf.realizedPL >= 0 ? c.green : c.red} />
                <KVValue label="승 횟수" value={perf.winCount} />
                <KVValue label="매수 총액" value={`$${Math.round(perf.totalBuyCost).toLocaleString()}`} />
                <KVValue label="매도 총액" value={`$${Math.round(perf.totalSellRevenue).toLocaleString()}`} />
                <KVValue label="갱신" value={perf.lastUpdated?.slice(11, 19) || "—"} />
              </div>
              {perf.recentTrades?.length > 0 && (
                <div style={{ marginTop: "8px", fontSize: "13px", color: c.text3 }}>
                  <div style={{ fontWeight: 600, marginBottom: "4px" }}>최근 거래:</div>
                  {perf.recentTrades.map((t, i) => (
                    <div key={i} style={{ padding: "2px 0", fontFamily: "monospace" }}>
                      <span style={{ color: t.type === "BUY" ? c.green : c.red }}>{t.type}</span>{" "}
                      {t.asset} ${t.amount?.toFixed(0)} — {t.signal?.slice(0, 40)}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )) : (
            <div style={{ fontSize: "14px", color: c.text3 }}>봇 성과 데이터 없음</div>
          )}
        </Section>

        {/* 봇별 스냅샷 (DD/MDD) */}
        <Section title="봇별 스냅샷 (DD/MDD)" defaultOpen={false}>
          {Object.keys(data.botSnapshots).length > 0 ? Object.entries(data.botSnapshots).map(([id, snap]) => (
            <div key={id} style={{
              background: c.card2, borderRadius: "8px", padding: "10px 14px", marginBottom: "6px",
              border: `1px solid ${c.border}`,
            }}>
              <div style={{ fontSize: "15px", fontWeight: 700, color: c.purple, marginBottom: "6px" }}>{id}</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px", fontSize: "14px" }}>
                <KVValue label="시장 가치" value={`$${(snap.marketValue || 0).toFixed(0)}`} />
                <KVValue label="미실현 P&L" value={`$${(snap.unrealizedPL || 0).toFixed(2)}`} color={(snap.unrealizedPL || 0) >= 0 ? c.green : c.red} />
                <KVValue label="DD" value={`${(snap.dd || 0).toFixed(2)}%`} color={(snap.dd || 0) > 5 ? c.red : c.green} />
                <KVValue label="MDD" value={`${(snap.mdd || 0).toFixed(2)}%`} color={(snap.mdd || 0) > 10 ? c.red : c.green} />
                <KVValue label="Peak Equity" value={`$${(snap.peakEquity || 0).toFixed(0)}`} />
                <KVValue label="Bot Equity" value={`$${(snap.botEquity || 0).toFixed(0)}`} />
                <KVValue label="배분금액" value={`$${(snap.botAllocation || 0).toLocaleString()}`} />
                <KVValue label="실현 P&L" value={`$${(snap.realizedPL || 0).toFixed(2)}`} color={(snap.realizedPL || 0) >= 0 ? c.green : c.red} />
                <KVValue label="포지션 수" value={snap.positionCount} />
                <KVValue label="히스토리" value={`${snap.historyLength}건`} />
              </div>
            </div>
          )) : (
            <div style={{ fontSize: "14px", color: c.text3 }}>스냅샷 데이터 없음</div>
          )}
        </Section>

        {/* 가격 소스 */}
        <Section title="가격 소스 상태" defaultOpen={false}>
          <KVValue label="크립토 소스" value={data.prices?.crypto?.source} />
          <KVValue label="BTC 가격" value={data.prices?.crypto?.btc ? `$${data.prices.crypto.btc.toLocaleString()}` : "실패"} color={data.prices?.crypto?.ok ? c.green : c.red} />
          <KVValue label="ETH 가격" value={data.prices?.crypto?.eth ? `$${data.prices.crypto.eth.toLocaleString()}` : "실패"} color={data.prices?.crypto?.ok ? c.green : c.red} />
        </Section>

        {/* 마켓 레짐 */}
        <Section title="마켓 레짐" defaultOpen={false}>
          {data.marketRegime ? (
            <>
              <KVValue label="레짐" value={data.marketRegime.regime} color={
                data.marketRegime.regime === "trending" ? c.green :
                data.marketRegime.regime === "mean_reverting" ? c.blue : c.yellow
              } />
              <KVValue label="Avg Hurst" value={data.marketRegime.avgHurst?.toFixed(3)} />
              <KVValue label="Avg ER" value={data.marketRegime.avgER?.toFixed(3)} />
              <KVValue label="갱신" value={data.marketRegime.updatedAt || "—"} />
            </>
          ) : (
            <div style={{ fontSize: "14px", color: c.text3 }}>레짐 데이터 없음</div>
          )}
        </Section>

        {/* 일간 P&L 기준 */}
        <Section title="일간 P&L 기준" defaultOpen={false}>
          <KVValue label="prevEquity" value={data.prevEquity ? `$${data.prevEquity.toLocaleString()}` : "없음"} />
          <KVValue label="prevEquityDate" value={data.prevEquityDate || "없음"} />
        </Section>

        {/* Raw JSON */}
        <Section title="Raw JSON 데이터" defaultOpen={false}>
          <pre style={{
            fontSize: "13px", color: c.text2, background: c.bg, padding: "12px",
            borderRadius: "8px", overflow: "auto", maxHeight: "400px", fontFamily: "monospace",
            whiteSpace: "pre-wrap", wordBreak: "break-all",
          }}>
            {JSON.stringify(data, null, 2)}
          </pre>
        </Section>

      </div>
    </div>
  );
}
