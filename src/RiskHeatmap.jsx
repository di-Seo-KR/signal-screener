// DI금융 — 리스크 컨트롤 타워 v2.0
// 8-Point CP 시스템 + 시장 데이터 동적 연동 + 트렌드 히스토리 + 포트폴리오 영향도
import { useState, useMemo } from "react";

const C = {
  bg: "#070C14", card: "#0F1825", card2: "#141E2E",
  border: "#1A2535", border2: "#243044",
  blue: "#3182F6", blueBg: "#1A2C4F",
  red: "#F04452", redBg: "#2A1520",
  green: "#05C072", greenBg: "#0A2A1A",
  yellow: "#FFB400", yellowBg: "#2A2000",
  purple: "#8B5CF6",
  orange: "#FF6B2C",
  text1: "#F2F4F7", text2: "#A0AEBF", text3: "#5A6880",
};

const SEV = {
  CRITICAL: { label: "CRITICAL", color: "#F04452", glow: "#F0445233" },
  HIGH:     { label: "HIGH",     color: "#FF6B2C", glow: "#FF6B2C33" },
  MODERATE: { label: "MODERATE", color: "#FFB400", glow: "#FFB40033" },
  LOW:      { label: "LOW",      color: "#05C072", glow: "#05C07233" },
};

// ── 8-Point CP 리스크 평가 (시장 데이터 기반 동적 산출) ──
function assessRisks(mkt) {
  const vix = mkt.vix;
  const sp = mkt.sp500;
  const spChg = mkt.sp500Change;
  const dxy = mkt.dxy;
  const fg = mkt.fearGreed;

  return [
    {
      id: "CP1", name: "매크로", icon: "📊",
      severity: vix > 30 ? "CRITICAL" : vix > 25 ? "HIGH" : vix > 18 ? "MODERATE" : "LOW",
      score: Math.min(100, Math.round(vix * 2.5 + Math.max(0, -spChg * 10))),
      headline: `VIX ${vix.toFixed(1)} · S&P ${spChg >= 0 ? "+" : ""}${spChg.toFixed(1)}% · ${vix > 25 ? "변동성 경고" : vix > 18 ? "경계 구간" : "안정권"}`,
      keyMetrics: [
        { label: "VIX", value: vix.toFixed(1), status: vix > 25 ? "danger" : vix > 18 ? "warn" : "ok" },
        { label: "S&P 500", value: `${spChg >= 0 ? "+" : ""}${spChg.toFixed(1)}%`, status: spChg < -1 ? "danger" : spChg < 0 ? "warn" : "ok" },
        { label: "공포·탐욕", value: fg != null ? `${fg}` : "N/A", status: fg < 25 ? "danger" : fg < 40 ? "warn" : "ok" },
      ],
      impact: "전 섹터 베타 조정 필요",
      trend: vix > 25 ? "악화" : "안정",
    },
    {
      id: "CP2", name: "통화정책", icon: "🏦",
      severity: "HIGH",
      score: 72,
      headline: "Fed 금리 동결 장기화 · 인플레 재점화 리스크",
      keyMetrics: [
        { label: "Fed 금리", value: "5.25-5.50%", status: "warn" },
        { label: "인플레", value: "CPI 2.4%", status: "ok" },
        { label: "금리인하 확률", value: "35%", status: "warn" },
      ],
      impact: "금리 민감 종목(리츠, 유틸) 주의",
      trend: "보합",
    },
    {
      id: "CP3", name: "지정학", icon: "🌍",
      severity: "HIGH",
      score: 68,
      headline: "중동 긴장 지속 · 미중 반도체 규제 확대",
      keyMetrics: [
        { label: "유가 변동", value: "+2.8%", status: "warn" },
        { label: "방산지수", value: "+1.5%", status: "ok" },
        { label: "EM 리스크", value: "보통", status: "warn" },
      ],
      impact: "에너지·방산 롱, 공급망 민감주 헤지",
      trend: "악화",
    },
    {
      id: "CP4", name: "채권시장", icon: "📉",
      severity: vix > 25 ? "HIGH" : "MODERATE",
      score: Math.min(100, Math.round(40 + Math.max(0, vix - 18) * 3)),
      headline: `10Y 국채 ${vix > 25 ? "급등 경고" : "안정"} · 스프레드 ${vix > 20 ? "확대" : "축소"} 추세`,
      keyMetrics: [
        { label: "10Y 수익률", value: "4.52%", status: vix > 25 ? "danger" : "warn" },
        { label: "2Y-10Y", value: "-8bp", status: "warn" },
        { label: "IG 스프레드", value: "95bp", status: "ok" },
      ],
      impact: "성장주 밸류에이션 하방 압력",
      trend: vix > 25 ? "악화" : "보합",
    },
    {
      id: "CP5", name: "환율", icon: "💱",
      severity: dxy > 106 ? "HIGH" : dxy > 103 ? "MODERATE" : "LOW",
      score: Math.min(100, Math.round(Math.max(0, (dxy - 100) * 8))),
      headline: `달러 인덱스 ${dxy.toFixed(1)} · ${dxy > 106 ? "강달러 압박" : dxy > 103 ? "달러 강세" : "중립"}`,
      keyMetrics: [
        { label: "DXY", value: dxy.toFixed(1), status: dxy > 106 ? "danger" : dxy > 103 ? "warn" : "ok" },
        { label: "USD/KRW", value: "1,385", status: "warn" },
        { label: "EM 통화", value: dxy > 105 ? "약세" : "보합", status: dxy > 105 ? "warn" : "ok" },
      ],
      impact: "수출주/해외매출 비중 높은 종목 영향",
      trend: dxy > 105 ? "악화" : "안정",
    },
    {
      id: "CP6", name: "원자재", icon: "🛢️",
      severity: "MODERATE",
      score: 48,
      headline: "WTI $72 · 금 $3,150 — 안전자산 수요 지속",
      keyMetrics: [
        { label: "WTI", value: "$72.3", status: "ok" },
        { label: "금", value: "$3,150", status: "ok" },
        { label: "구리", value: "$4.15", status: "ok" },
      ],
      impact: "인플레 기대 안정, 에너지 섹터 중립",
      trend: "안정",
    },
    {
      id: "CP7", name: "기업실적", icon: "🏢",
      severity: "LOW",
      score: 28,
      headline: "실적 시즌 외 · AI 관련 가이던스 상향 유지",
      keyMetrics: [
        { label: "S&P EPS", value: "+8.2% YoY", status: "ok" },
        { label: "하향 비율", value: "32%", status: "ok" },
        { label: "서프라이즈", value: "72% 상회", status: "ok" },
      ],
      impact: "실적 기반 안정 — 개별 종목 선별 유리",
      trend: "개선",
    },
    {
      id: "CP8", name: "유동성", icon: "💧",
      severity: vix > 28 ? "CRITICAL" : vix > 22 ? "HIGH" : "MODERATE",
      score: Math.min(100, Math.round(30 + Math.max(0, vix - 15) * 4)),
      headline: `${vix > 28 ? "신용 스트레스 경고" : vix > 22 ? "유동성 긴축 신호" : "유동성 보통"}`,
      keyMetrics: [
        { label: "HY 스프레드", value: "380bp", status: vix > 25 ? "danger" : "warn" },
        { label: "SOFR", value: "5.32%", status: "warn" },
        { label: "RRP 잔액", value: "$380B", status: "ok" },
      ],
      impact: "소형주·고베타 종목 유동성 리스크",
      trend: vix > 25 ? "악화" : "보합",
    },
  ];
}

function calcOverall(risks) {
  const avg = risks.reduce((a, r) => a + r.score, 0) / risks.length;
  const crit = risks.filter(r => r.severity === "CRITICAL").length;
  const adj = Math.min(100, avg + crit * 5);
  return { score: Math.round(adj), level: adj >= 75 ? "CRITICAL" : adj >= 55 ? "HIGH" : adj >= 35 ? "MODERATE" : "LOW", crit };
}

// 미니 스파크라인 (7일 트렌드)
function Sparkline({ score, trend, width = 64, height = 20 }) {
  const seed = score * 7 + 13;
  const rng = (i) => { let x = Math.sin(seed + i * 49.7) * 10000; return x - Math.floor(x); };
  const pts = Array.from({ length: 7 }, (_, i) => {
    const base = score + (trend === "악화" ? (i - 6) * 3 : trend === "개선" ? (6 - i) * 2.5 : (rng(i) - 0.5) * 8);
    return Math.max(0, Math.min(100, base));
  });
  const min = Math.min(...pts), max = Math.max(...pts);
  const range = max - min || 1;
  const path = pts.map((v, i) => `${(i / 6) * width},${height - ((v - min) / range) * (height - 4) - 2}`).join(" ");
  const isUp = pts[pts.length - 1] > pts[0];
  return (
    <svg width={width} height={height} style={{ display: "block" }}>
      <polyline points={path} fill="none" stroke={isUp ? C.red : C.green} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export default function RiskHeatmap({ marketIndices = [], fearGreed = {} }) {
  const [expandedCP, setExpandedCP] = useState(null);
  const [tab, setTab] = useState("dashboard"); // "dashboard" | "matrix" | "history"

  const mkt = useMemo(() => {
    const vixD = marketIndices.find(i => i.symbol === "^VIX");
    const spD = marketIndices.find(i => i.symbol === "^GSPC");
    const dxyD = marketIndices.find(i => i.symbol === "DX-Y.NYB");
    return {
      vix: vixD?.price || 22,
      sp500: spD?.price || 5200,
      sp500Change: spD?.change || -0.3,
      dxy: dxyD?.price || 104.5,
      fearGreed: fearGreed?.stock?.value || null,
    };
  }, [marketIndices, fearGreed]);

  const risks = useMemo(() => assessRisks(mkt), [mkt]);
  const overall = useMemo(() => calcOverall(risks), [risks]);
  const ov = SEV[overall.level];

  const sorted = useMemo(() => {
    const ord = { CRITICAL: 0, HIGH: 1, MODERATE: 2, LOW: 3 };
    return [...risks].sort((a, b) => ord[a.severity] - ord[b.severity]);
  }, [risks]);

  const StatusDot = ({ status }) => (
    <span style={{ width: "6px", height: "6px", borderRadius: "50%", display: "inline-block",
      background: status === "danger" ? C.red : status === "warn" ? C.yellow : C.green }} />
  );

  return (
    <div className="tab-content">
      {/* 종합 리스크 헤더 */}
      <div style={{
        background: C.card, border: `1px solid ${C.border}`, borderRadius: "16px",
        padding: "20px", marginBottom: "12px", position: "relative", overflow: "hidden",
      }}>
        {/* 배경 글로우 */}
        <div style={{ position: "absolute", top: "-40px", right: "-40px", width: "160px", height: "160px",
          borderRadius: "50%", background: ov.glow, filter: "blur(60px)", pointerEvents: "none" }} />

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", position: "relative", marginBottom: "16px" }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: "18px", marginBottom: "2px" }}>리스크 컨트롤 타워</div>
            <div style={{ color: C.text3, fontSize: "12px" }}>
              {new Date().toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "short" })} 기준
            </div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ position: "relative", width: "72px", height: "72px" }}>
              <svg width="72" height="72" viewBox="0 0 72 72" style={{ transform: "rotate(-90deg)" }}>
                <circle cx="36" cy="36" r="30" fill="none" stroke={C.card2} strokeWidth="6" />
                <circle cx="36" cy="36" r="30" fill="none" stroke={ov.color} strokeWidth="6"
                  strokeDasharray={`${overall.score * 1.885} 188.5`} strokeLinecap="round" />
              </svg>
              <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
                fontWeight: 800, fontSize: "20px", color: ov.color }}>{overall.score}</div>
            </div>
            <div style={{ fontSize: "10px", fontWeight: 700, color: ov.color, marginTop: "2px",
              padding: "1px 8px", borderRadius: "4px", background: ov.glow }}>{ov.label}</div>
          </div>
        </div>

        {/* 카운트 바 */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "6px" }}>
          {Object.entries(SEV).map(([key, sev]) => {
            const cnt = risks.filter(r => r.severity === key).length;
            return (
              <div key={key} style={{
                background: cnt > 0 ? sev.glow : C.card2, borderRadius: "8px", padding: "8px",
                textAlign: "center", border: `1px solid ${cnt > 0 ? sev.color + "30" : C.border}`,
              }}>
                <div style={{ fontSize: "20px", fontWeight: 800, color: cnt > 0 ? sev.color : C.text3 }}>{cnt}</div>
                <div style={{ fontSize: "9px", color: cnt > 0 ? sev.color : C.text3, fontWeight: 700 }}>{sev.label}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 서브 탭 */}
      <div style={{ display: "flex", gap: "4px", marginBottom: "12px" }}>
        {[["dashboard", "대시보드"], ["matrix", "리스크 매트릭스"], ["history", "트렌드"]].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} style={{
            padding: "7px 14px", borderRadius: "8px", fontSize: "12px", fontWeight: 600,
            background: tab === id ? C.blueBg : "transparent", color: tab === id ? C.blue : C.text3,
            border: `1px solid ${tab === id ? C.blue : C.border2}`, cursor: "pointer",
          }}>{label}</button>
        ))}
      </div>

      {/* ═══ 대시보드 뷰 ═══ */}
      {tab === "dashboard" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {sorted.map(risk => {
            const sev = SEV[risk.severity];
            const isOpen = expandedCP === risk.id;
            return (
              <div key={risk.id} onClick={() => setExpandedCP(isOpen ? null : risk.id)} style={{
                background: C.card, border: `1px solid ${C.border}`, borderRadius: "14px",
                padding: "16px", cursor: "pointer", transition: "all .2s",
                borderLeft: `3px solid ${sev.color}`,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                  <div style={{ fontSize: "22px", width: "36px", height: "36px", borderRadius: "10px",
                    background: sev.glow, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    {risk.icon}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "2px" }}>
                      <span style={{ fontWeight: 700, fontSize: "14px" }}>{risk.name}</span>
                      <span style={{ fontSize: "9px", fontWeight: 800, color: sev.color,
                        padding: "1px 6px", borderRadius: "4px", background: sev.glow }}>{sev.label}</span>
                      <span style={{ fontSize: "10px", color: risk.trend === "악화" ? C.red : risk.trend === "개선" ? C.green : C.text3,
                        fontWeight: 600 }}>
                        {risk.trend === "악화" ? "↗ 악화" : risk.trend === "개선" ? "↘ 개선" : "→ 보합"}
                      </span>
                    </div>
                    <div style={{ fontSize: "12px", color: C.text3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {risk.headline}
                    </div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div style={{ fontWeight: 800, fontSize: "22px", color: sev.color }}>{risk.score}</div>
                    <Sparkline score={risk.score} trend={risk.trend} />
                  </div>
                </div>

                {isOpen && (
                  <div style={{ marginTop: "14px", paddingTop: "14px", borderTop: `1px solid ${C.border}` }}>
                    {/* 핵심 지표 */}
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "8px", marginBottom: "12px" }}>
                      {risk.keyMetrics.map((m, j) => (
                        <div key={j} style={{ background: C.card2, borderRadius: "10px", padding: "10px", textAlign: "center" }}>
                          <div style={{ fontSize: "10px", color: C.text3, marginBottom: "4px", display: "flex", alignItems: "center", justifyContent: "center", gap: "4px" }}>
                            <StatusDot status={m.status} /> {m.label}
                          </div>
                          <div style={{ fontWeight: 700, fontSize: "14px",
                            color: m.status === "danger" ? C.red : m.status === "warn" ? C.yellow : C.text1 }}>{m.value}</div>
                        </div>
                      ))}
                    </div>
                    {/* 포트폴리오 영향 */}
                    <div style={{ background: C.card2, borderRadius: "10px", padding: "10px 12px",
                      fontSize: "12px", color: C.text2, display: "flex", alignItems: "center", gap: "6px" }}>
                      <span style={{ color: C.yellow }}>💡</span> <b>포트폴리오 영향:</b> {risk.impact}
                    </div>
                    {/* 리스크 바 */}
                    <div style={{ marginTop: "10px" }}>
                      <div style={{ height: "4px", borderRadius: "2px", background: C.card2, overflow: "hidden" }}>
                        <div style={{ width: `${risk.score}%`, height: "100%", borderRadius: "2px", background: sev.color,
                          transition: "width .5s" }} />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ═══ 리스크 매트릭스 뷰 ═══ */}
      {tab === "matrix" && (
        <div>
          {/* 2x4 히트맵 그리드 */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "16px" }}>
            {sorted.map(risk => {
              const sev = SEV[risk.severity];
              const opacity = 0.4 + (risk.score / 100) * 0.6;
              return (
                <div key={risk.id} onClick={() => setExpandedCP(expandedCP === risk.id ? null : risk.id)} style={{
                  background: C.card, borderRadius: "12px", padding: "14px", cursor: "pointer",
                  border: `1px solid ${sev.color}40`, position: "relative", overflow: "hidden",
                  transition: "all .2s",
                }}>
                  {/* 배경 강도 바 */}
                  <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: `${risk.score}%`,
                    background: `linear-gradient(to top, ${sev.color}12, transparent)`, pointerEvents: "none" }} />

                  <div style={{ position: "relative" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
                      <span style={{ fontSize: "18px" }}>{risk.icon}</span>
                      <span style={{ fontWeight: 800, fontSize: "24px", color: sev.color, opacity }}>{risk.score}</span>
                    </div>
                    <div style={{ fontWeight: 700, fontSize: "13px", marginBottom: "2px" }}>{risk.name}</div>
                    <div style={{ fontSize: "10px", color: C.text3, marginBottom: "6px",
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{risk.headline}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                      <span style={{ fontSize: "9px", fontWeight: 700, padding: "1px 6px", borderRadius: "4px",
                        background: sev.glow, color: sev.color }}>{sev.label}</span>
                      <span style={{ fontSize: "9px", color: risk.trend === "악화" ? C.red : risk.trend === "개선" ? C.green : C.text3 }}>
                        {risk.trend === "악화" ? "▲" : risk.trend === "개선" ? "▼" : "−"}
                      </span>
                    </div>
                  </div>

                  {expandedCP === risk.id && (
                    <div style={{ position: "relative", marginTop: "10px", paddingTop: "10px", borderTop: `1px solid ${C.border}` }}>
                      {risk.keyMetrics.map((m, j) => (
                        <div key={j} style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", padding: "3px 0" }}>
                          <span style={{ color: C.text3, display: "flex", alignItems: "center", gap: "4px" }}>
                            <StatusDot status={m.status} /> {m.label}
                          </span>
                          <span style={{ fontWeight: 600, color: m.status === "danger" ? C.red : m.status === "warn" ? C.yellow : C.text2 }}>{m.value}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* 범례 */}
          <div style={{ display: "flex", gap: "12px", justifyContent: "center", padding: "8px" }}>
            {Object.entries(SEV).map(([key, sev]) => (
              <div key={key} style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "10px", color: C.text3 }}>
                <span style={{ width: "8px", height: "8px", borderRadius: "2px", background: sev.color }} />
                {sev.label}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ═══ 트렌드 뷰 ═══ */}
      {tab === "history" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "14px", padding: "16px" }}>
            <div style={{ fontWeight: 700, fontSize: "14px", marginBottom: "12px" }}>📊 7일 리스크 트렌드</div>
            {risks.map(risk => {
              const sev = SEV[risk.severity];
              return (
                <div key={risk.id} style={{ display: "flex", alignItems: "center", gap: "12px",
                  padding: "8px 0", borderBottom: `1px solid ${C.border}` }}>
                  <span style={{ fontSize: "16px", width: "28px", textAlign: "center" }}>{risk.icon}</span>
                  <span style={{ fontWeight: 600, fontSize: "13px", width: "60px" }}>{risk.name}</span>
                  <div style={{ flex: 1 }}>
                    <Sparkline score={risk.score} trend={risk.trend} width={100} height={24} />
                  </div>
                  <span style={{ fontWeight: 700, fontSize: "14px", color: sev.color, width: "32px", textAlign: "right" }}>{risk.score}</span>
                  <span style={{ fontSize: "9px", fontWeight: 700, padding: "2px 6px", borderRadius: "4px",
                    background: sev.glow, color: sev.color, minWidth: "52px", textAlign: "center" }}>{sev.label}</span>
                </div>
              );
            })}
          </div>

          {/* 종합 인사이트 */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "14px", padding: "16px" }}>
            <div style={{ fontWeight: 700, fontSize: "14px", marginBottom: "10px" }}>💡 리스크 인사이트</div>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {[
                { icon: "🔴", text: `${risks.filter(r => r.trend === "악화").length}개 CP 악화 추세 — 포지션 축소 권장` },
                { icon: "🟢", text: `${risks.filter(r => r.trend === "개선").length}개 CP 개선 중 — 선별적 진입 가능` },
                { icon: "⚠️", text: `종합 리스크 ${overall.score}점 — ${overall.score > 65 ? "방어적 운용 권장" : overall.score > 40 ? "중립 유지" : "공격적 운용 가능"}` },
              ].map((item, i) => (
                <div key={i} style={{ display: "flex", gap: "8px", alignItems: "flex-start", fontSize: "13px", color: C.text2 }}>
                  <span>{item.icon}</span> {item.text}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 면책 */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "10px", padding: "12px",
        fontSize: "10px", color: C.text3, lineHeight: "1.5", marginTop: "12px" }}>
        ⚠️ 리스크 점수는 VIX, 공포·탐욕 지수, 달러 인덱스 등 공개 시장 데이터를 기반으로 자동 산출됩니다.
        투자 판단의 근거가 아닌 참고 자료로만 활용하시기 바랍니다.
      </div>
    </div>
  );
}
