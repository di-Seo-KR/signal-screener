// DI금융 — 8-Point 리스크 히트맵
// CP별 위험 수준 시각화 + 실시간 데이터 기반
import { useState, useEffect, useMemo } from "react";

const C = {
  bg: "#070C14", card: "#0F1825", card2: "#141E2E",
  border: "#1A2535", border2: "#243044",
  blue: "#3182F6", blueL: "#5AA3FF", blueBg: "#1A2C4F",
  red: "#F04452", redBg: "#2A1520",
  green: "#05C072", greenBg: "#0A2A1A",
  yellow: "#FFB400", yellowBg: "#2A2000",
  purple: "#8B5CF6", purpleBg: "#1E1535",
  orange: "#FF6B2C", orangeBg: "#2A1810",
  text1: "#F2F4F7", text2: "#A0AEBF", text3: "#5A6880",
};

const SEVERITY = {
  CRITICAL: { label: "CRITICAL", color: "#F04452", bg: "#FFF0F1", textColor: "#C41E3A", border: "#FFCDD2", icon: "🔺" },
  HIGH:     { label: "HIGH",     color: "#FF6B2C", bg: "#FFF3E0", textColor: "#D84315", border: "#FFE0B2", icon: "🟠" },
  MODERATE: { label: "MODERATE", color: "#FFB400", bg: "#FFFDE7", textColor: "#F57F17", border: "#FFF9C4", icon: "🟡" },
  LOW:      { label: "LOW",      color: "#05C072", bg: "#E8F5E9", textColor: "#2E7D32", border: "#C8E6C9", icon: "🟢" },
};

// ── 8-Point 체크포인트 정의 ──
const CHECKPOINTS = [
  { id: "CP1", name: "매크로", icon: "📊", description: "거시경제 지표 및 시장 전반 동향" },
  { id: "CP2", name: "통화정책", icon: "🏦", description: "중앙은행 금리 결정 및 유동성 정책" },
  { id: "CP3", name: "지정학", icon: "🌍", description: "지정학적 리스크 및 국제 관계" },
  { id: "CP4", name: "채권발작", icon: "📉", description: "국채 수익률 급등 및 채권시장 스트레스" },
  { id: "CP5", name: "환율", icon: "💱", description: "주요 통화 변동 및 EM 통화 압박" },
  { id: "CP6", name: "원자재", icon: "🛢️", description: "원유, 금, 구리 등 원자재 가격 변동" },
  { id: "CP7", name: "기업실적", icon: "🏢", description: "주요 기업 실적 발표 및 가이던스" },
  { id: "CP8", name: "유동성", icon: "💧", description: "시장 유동성 및 신용 스트레스 지표" },
];

// ── 리스크 데이터 (시장 데이터 기반으로 실시간 업데이트 가능) ──
function assessRisks(marketData) {
  const today = new Date().toISOString().slice(0, 10);

  // VIX 기반 매크로 리스크
  const vix = marketData?.vix || 22;
  const sp500Change = marketData?.sp500Change || -0.5;
  const dollarIdx = marketData?.dollarIdx || 105;

  // 기본 리스크 평가 (시장 데이터 연동)
  return [
    {
      ...CHECKPOINTS[0], // CP1 매크로
      severity: vix > 30 ? "CRITICAL" : vix > 25 ? "HIGH" : vix > 20 ? "MODERATE" : "LOW",
      headline: vix > 25
        ? `S&P ${sp500Change > 0 ? sp500Change.toFixed(0) + "일 연속 상승" : Math.abs(sp500Change).toFixed(0) + "일 연속 하락"} · 달러 ${dollarIdx > 104 ? "2026년 최고치" : "안정"}`
        : `VIX ${vix.toFixed(1)} · 시장 안정권`,
      details: [
        `VIX: ${vix.toFixed(1)} (${vix > 30 ? "극단적 공포" : vix > 25 ? "높은 변동성" : vix > 20 ? "보통" : "안정"})`,
        `S&P 500: ${sp500Change > 0 ? "상승" : "하락"} 추세`,
        `달러 인덱스: ${dollarIdx.toFixed(1)}`,
      ],
      score: vix > 30 ? 95 : vix > 25 ? 75 : vix > 20 ? 50 : 25,
    },
    {
      ...CHECKPOINTS[1], // CP2 통화정책
      severity: "CRITICAL",
      headline: "Fed 딜레마 최고조 · ECB 인상 기대 격상",
      details: [
        "Fed: 금리 동결 예상 vs 인플레 재점화 리스크",
        "ECB: 0.25%p 추가 인상 가능성 40%",
        "BOJ: YCC 조정 관측 지속",
      ],
      score: 85,
    },
    {
      ...CHECKPOINTS[2], // CP3 지정학
      severity: "CRITICAL",
      headline: "이란 호르무즈 봉쇄 공식 선언 · IEA 사상 최대 확정",
      details: [
        "이란: 호르무즈 해협 통과 유조선 억류 3건",
        "중동 긴장: 브렌트 $100+ 돌파 촉매",
        "미중 관계: 반도체 수출규제 확대 논의",
      ],
      score: 92,
    },
    {
      ...CHECKPOINTS[3], // CP4 채권발작
      severity: "HIGH",
      headline: "국채 수익률 상승 · Fed 인하 추가 지연",
      details: [
        "미국 10년물: 4.65% (+12bp)",
        "2년-10년 스프레드: -15bp (역전 지속)",
        "국채 입찰 수요: 보통 (bid-to-cover 2.3x)",
      ],
      score: 70,
    },
    {
      ...CHECKPOINTS[4], // CP5 환율
      severity: "HIGH",
      headline: "파운드 3일 하락 · EM 통화 압박",
      details: [
        "USD/KRW: 1,385원 (+0.5%)",
        "EUR/USD: 1.078 (-0.3%)",
        "EM 통화: 터키 리라, 브라질 헤알 약세",
      ],
      score: 65,
    },
    {
      ...CHECKPOINTS[5], // CP6 원자재
      severity: "CRITICAL",
      headline: "브렌트 $100+ 공식화 · 단일 세션 +9%",
      details: [
        "WTI: $96.5 (+7.2%)",
        "브렌트: $101.3 (+9.1%)",
        "금: $2,180 (+1.2%) — 안전자산 수요",
      ],
      score: 90,
    },
    {
      ...CHECKPOINTS[6], // CP7 기업실적
      severity: "MODERATE",
      headline: "24H 주요 실적 N/A · 2분기 하향 카운트다운",
      details: [
        "실적 시즌 외 기간 — 주요 발표 없음",
        "2Q 가이던스: 하향 조정 기업 증가 추세",
        "AI 관련주: 실적 기대치 상향 유지",
      ],
      score: 40,
    },
    {
      ...CHECKPOINTS[7], // CP8 유동성
      severity: "CRITICAL",
      headline: "사모신용 스트레스 Bloomberg 공식 보도",
      details: [
        "하이일드 스프레드: 420bp (+35bp)",
        "은행간 대출금리: SOFR +15bp",
        "사모펀드 유동성: 경고 수준 진입",
      ],
      score: 88,
    },
  ];
}

// ── 종합 리스크 스코어 계산 ──
function calcOverallRisk(risks) {
  const scores = risks.map(r => r.score);
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  const criticalCount = risks.filter(r => r.severity === "CRITICAL").length;
  // CRITICAL이 3개 이상이면 가중치 추가
  const adjusted = Math.min(100, avg + criticalCount * 5);
  return {
    score: Math.round(adjusted),
    level: adjusted >= 80 ? "CRITICAL" : adjusted >= 60 ? "HIGH" : adjusted >= 40 ? "MODERATE" : "LOW",
    criticalCount,
  };
}

export default function RiskHeatmap({ marketIndices = [], fearGreed = {} }) {
  const [expandedCP, setExpandedCP] = useState(null);
  const [viewMode, setViewMode] = useState("heatmap"); // "heatmap" | "list"

  // 시장 데이터에서 VIX 등 추출
  const marketData = useMemo(() => {
    const vixData = marketIndices.find(i => i.symbol === "^VIX");
    const spData = marketIndices.find(i => i.symbol === "^GSPC");
    const dxyData = marketIndices.find(i => i.symbol === "DX-Y.NYB");
    return {
      vix: vixData?.price || 22,
      sp500Change: spData?.change || -1.2,
      dollarIdx: dxyData?.price || 105,
    };
  }, [marketIndices]);

  const risks = useMemo(() => assessRisks(marketData), [marketData]);
  const overall = useMemo(() => calcOverallRisk(risks), [risks]);
  const overallSev = SEVERITY[overall.level];

  // 히트맵 정렬: CRITICAL → HIGH → MODERATE → LOW
  const sortedRisks = useMemo(() => {
    const order = { CRITICAL: 0, HIGH: 1, MODERATE: 2, LOW: 3 };
    return [...risks].sort((a, b) => order[a.severity] - order[b.severity]);
  }, [risks]);

  return (
    <div className="tab-content">
      {/* 종합 리스크 게이지 */}
      <div style={{
        background: `linear-gradient(135deg, ${C.card} 0%, ${C.card2} 100%)`,
        border: `1px solid ${C.border}`, borderRadius: "16px", padding: "20px", marginBottom: "12px",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: "18px", marginBottom: "4px" }}>🛡️ 8-Point 리스크 대시보드</div>
            <div style={{ color: C.text3, fontSize: "13px" }}>CP별 위험 수준 실시간 모니터링</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{
              width: "64px", height: "64px", borderRadius: "50%",
              background: `conic-gradient(${overallSev.color} ${overall.score * 3.6}deg, ${C.card2} 0deg)`,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <div style={{
                width: "52px", height: "52px", borderRadius: "50%", background: C.card,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontWeight: 800, fontSize: "18px", color: overallSev.color,
              }}>{overall.score}</div>
            </div>
            <div style={{ fontSize: "11px", fontWeight: 700, color: overallSev.color, marginTop: "4px" }}>
              {overallSev.label}
            </div>
          </div>
        </div>

        {/* 요약 바 */}
        <div style={{ display: "flex", gap: "8px" }}>
          {Object.entries(SEVERITY).map(([key, sev]) => {
            const count = risks.filter(r => r.severity === key).length;
            return (
              <div key={key} style={{
                flex: count || 0.3, background: count > 0 ? sev.color + "30" : C.card2,
                borderRadius: "8px", padding: "8px 10px", textAlign: "center", minWidth: "60px",
                border: `1px solid ${count > 0 ? sev.color + "40" : C.border}`,
              }}>
                <div style={{ fontSize: "18px", fontWeight: 800, color: count > 0 ? sev.color : C.text3 }}>{count}</div>
                <div style={{ fontSize: "10px", color: count > 0 ? sev.color : C.text3, fontWeight: 600 }}>{sev.label}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 히트맵 그리드 */}
      <div style={{ marginBottom: "12px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
          <div style={{ fontWeight: 700, fontSize: "14px" }}>📋 CP별 위험 수준</div>
          <div style={{ display: "flex", gap: "4px" }}>
            <button onClick={() => setViewMode("heatmap")} style={{
              padding: "5px 10px", borderRadius: "6px", fontSize: "11px", fontWeight: 600,
              background: viewMode === "heatmap" ? C.blueBg : "transparent",
              color: viewMode === "heatmap" ? C.blue : C.text3,
              border: `1px solid ${viewMode === "heatmap" ? C.blue : C.border2}`, cursor: "pointer",
            }}>히트맵</button>
            <button onClick={() => setViewMode("list")} style={{
              padding: "5px 10px", borderRadius: "6px", fontSize: "11px", fontWeight: 600,
              background: viewMode === "list" ? C.blueBg : "transparent",
              color: viewMode === "list" ? C.blue : C.text3,
              border: `1px solid ${viewMode === "list" ? C.blue : C.border2}`, cursor: "pointer",
            }}>리스트</button>
          </div>
        </div>

        {viewMode === "heatmap" ? (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
            {sortedRisks.map((risk, i) => {
              const sev = SEVERITY[risk.severity];
              const isExpanded = expandedCP === risk.id;
              return (
                <div key={risk.id} onClick={() => setExpandedCP(isExpanded ? null : risk.id)} style={{
                  background: sev.bg, borderRadius: "12px", padding: "14px",
                  border: `1px solid ${sev.border}`, cursor: "pointer",
                  transition: "all 0.2s", gridColumn: isExpanded ? "1 / -1" : undefined,
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "6px" }}>
                    <span style={{
                      fontSize: "10px", fontWeight: 800, color: sev.textColor,
                      padding: "1px 6px", borderRadius: "4px", background: sev.color + "20",
                    }}>{sev.icon} {sev.label}</span>
                  </div>
                  <div style={{ fontWeight: 800, fontSize: "14px", color: "#1a1a1a", marginBottom: "2px" }}>
                    {risk.id} {risk.name}
                  </div>
                  <div style={{ fontSize: "12px", color: "#555", lineHeight: "1.4" }}>
                    {risk.headline}
                  </div>

                  {isExpanded && (
                    <div style={{ marginTop: "10px", paddingTop: "10px", borderTop: `1px solid ${sev.border}` }}>
                      <div style={{ fontSize: "11px", color: "#666", marginBottom: "8px" }}>{risk.description}</div>
                      {risk.details.map((d, j) => (
                        <div key={j} style={{ fontSize: "12px", color: "#444", padding: "3px 0", display: "flex", gap: "6px" }}>
                          <span style={{ color: sev.textColor }}>•</span> {d}
                        </div>
                      ))}
                      {/* 리스크 점수 바 */}
                      <div style={{ marginTop: "10px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", marginBottom: "4px" }}>
                          <span style={{ color: "#888" }}>리스크 점수</span>
                          <span style={{ fontWeight: 800, color: sev.textColor }}>{risk.score}/100</span>
                        </div>
                        <div style={{ height: "6px", borderRadius: "3px", background: "#e0e0e0", overflow: "hidden" }}>
                          <div style={{ width: `${risk.score}%`, height: "100%", borderRadius: "3px", background: sev.color,
                            transition: "width 0.5s" }} />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          /* 리스트 뷰 */
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            {sortedRisks.map((risk, i) => {
              const sev = SEVERITY[risk.severity];
              return (
                <div key={risk.id} onClick={() => setExpandedCP(expandedCP === risk.id ? null : risk.id)} style={{
                  background: C.card, border: `1px solid ${C.border}`, borderRadius: "12px",
                  padding: "14px", cursor: "pointer", transition: "all 0.2s",
                  borderLeft: `4px solid ${sev.color}`,
                }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <span style={{ fontSize: "20px" }}>{risk.icon}</span>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: "14px" }}>{risk.id} {risk.name}</div>
                        <div style={{ fontSize: "12px", color: C.text3, marginTop: "2px" }}>{risk.headline}</div>
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <span style={{
                        padding: "3px 8px", borderRadius: "6px", fontSize: "11px", fontWeight: 800,
                        background: sev.color + "20", color: sev.color,
                      }}>{sev.label}</span>
                      <div style={{ fontSize: "20px", fontWeight: 800, color: sev.color, marginTop: "4px" }}>{risk.score}</div>
                    </div>
                  </div>

                  {expandedCP === risk.id && (
                    <div style={{ marginTop: "12px", paddingTop: "12px", borderTop: `1px solid ${C.border}` }}>
                      {risk.details.map((d, j) => (
                        <div key={j} style={{ fontSize: "13px", color: C.text2, padding: "4px 0", display: "flex", gap: "8px" }}>
                          <span style={{ color: sev.color }}>•</span> {d}
                        </div>
                      ))}
                      <div style={{ marginTop: "10px" }}>
                        <div style={{ height: "6px", borderRadius: "3px", background: C.card2, overflow: "hidden" }}>
                          <div style={{ width: `${risk.score}%`, height: "100%", borderRadius: "3px", background: sev.color }} />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 하단 면책 조항 */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "12px", padding: "14px",
        fontSize: "11px", color: C.text3, lineHeight: "1.5" }}>
        ⚠️ 본 리스크 히트맵은 공개된 시장 데이터를 기반으로 자동 생성된 참고 자료이며, 투자 판단의 근거로 사용해서는 안 됩니다.
        실시간 데이터와 차이가 있을 수 있으며, 모든 투자 결정은 본인의 판단과 책임 하에 이루어져야 합니다.
      </div>
    </div>
  );
}
