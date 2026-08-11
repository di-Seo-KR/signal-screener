// Zepta — 리스크맵 v4 (시안 1e 적용)
// 8-Point CP 시스템 — 모든 체크포인트 실시간 시장 데이터 기반 동적 산출
// v3.1 정직성 로직(필수 시세 게이트 · 하드코딩 폴백 금지 · localStorage 실측 추이 ·
//      상태 서술 워딩)은 전부 유지 — v4 는 표현만 모바일 시안(1e) 문법으로 교체:
//      종합 점수 히어로(좌측 3px 보더 + 상단 그라데이션 + mono 숫자 + 게이지 노브),
//      리스크 항목 카드(등급 배지·수치·설명), 실측 추이 바 차트, 빈 상태 변형.
// 색은 하드코딩 hex 대신 useThemeTokens() — 라이트 모드는 토큰이 처리합니다.
import { useState, useMemo, useEffect } from "react";
import { useThemeTokens } from "./ui/theme.jsx";
import { useIsMobile } from "./ui/useBreakpoint.jsx";
import { Num, Segment, Disclaimer } from "./components/mobileKit.jsx";

// ── 등급 → 시안 색 세트 (base: 보더·바, hi: 텍스트 강조 짝, bg: 알파 틴트) ──
// 라벨은 상태 서술만 (시안 1e 의 "중립 수준" 어법) — 운용 지시 워딩 금지.
function sevOf(C) {
  return {
    CRITICAL: { label: "위험", base: C.red,    hi: C.redL || C.red,       bg: `${C.red}1A` },
    HIGH:     { label: "높음", base: C.orange, hi: C.orange,              bg: `${C.orange}1A` },
    MODERATE: { label: "중립", base: C.yellow, hi: C.yellowL || C.yellow, bg: `${C.yellow}1A` },
    LOW:      { label: "낮음", base: C.green,  hi: C.greenL || C.green,   bg: `${C.green}1A` },
  };
}

// ── 등급 산출에 반드시 필요한 시세 심볼 목록 ──
// 하나라도 누락되면 임의 폴백 수치로 계산하지 않고 '데이터 없음' 상태를 표시합니다.
const REQUIRED_SYMBOLS = ["^VIX", "^GSPC", "DX-Y.NYB", "^TNX", "^FVX", "^IRX", "CL=F", "GC=F", "HG=F", "USDKRW=X"];

// ── 리스크 점수 실측 이력 저장 키 (이 브라우저 localStorage, 30일 롤링) ──
const HIST_KEY = "zepta:riskmap:history:v1";
const HIST_MAX_DAYS = 30;

// 로컬 기준 일자 키 (YYYY-MM-DD)
function localDateKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// "YYYY-MM-DD" → "M/D" (추이 차트 축 라벨용)
function shortDate(key) {
  const parts = String(key).split("-");
  if (parts.length !== 3) return key;
  return `${Number(parts[1])}/${Number(parts[2])}`;
}

// localStorage 이력 로드 — 파싱 실패·비정상 형태는 빈 배열로 처리합니다
function loadHistory() {
  try {
    const raw = localStorage.getItem(HIST_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(h => h && typeof h.d === "string" && h.scores && typeof h.scores === "object");
  } catch {
    return [];
  }
}

// ── 8-Point CP 리스크 평가 (100% 시장 데이터 기반 동적 산출) ──
function assessRisks(mkt) {
  const { vix, sp500Change, dxy, fearGreed, tnx, fvx, irx, wti, gold, copper, usdkrw } = mkt;

  // ── CP1: 매크로 ──
  const cp1Sev = vix > 30 ? "CRITICAL" : vix > 25 ? "HIGH" : vix > 18 ? "MODERATE" : "LOW";
  const cp1Score = Math.min(100, Math.round(vix * 2.5 + Math.max(0, -sp500Change * 10)));

  // ── CP2: 통화정책 (국채 수익률 기반 추론) ──
  // 13W T-Bill(IRX)은 시장이 예상하는 단기 금리 수준을 반영
  // 10Y-IRX 스프레드로 금리 인하 기대 추론
  const impliedRate = irx; // 13W T-Bill ≈ 시장 내재 기준금리
  const rateCutSpread = tnx - irx; // 음수면 인하 기대, 양수면 장기 프리미엄
  const rateCutProb = Math.max(0, Math.min(100, Math.round(50 - rateCutSpread * 30)));
  const cp2Sev = impliedRate > 5 ? "HIGH" : impliedRate > 4 ? "MODERATE" : "LOW";
  const cp2Score = Math.min(100, Math.round(impliedRate * 12 + Math.max(0, (impliedRate - 4) * 15)));

  // ── CP3: 지정학 (유가 변동 + 금 가격 + VIX 복합) ──
  // 유가 급등 + 금 급등 + VIX 상승 = 지정학 리스크 증가
  const oilStress = Math.max(0, (wti - 70) * 2); // $70 기준 초과분
  const goldSafe = Math.max(0, (gold - 2800) / 20); // $2800 기준 안전자산 수요
  const geoScore = Math.min(100, Math.round(20 + oilStress + goldSafe + Math.max(0, vix - 18) * 2));
  const cp3Sev = geoScore > 75 ? "CRITICAL" : geoScore > 55 ? "HIGH" : geoScore > 35 ? "MODERATE" : "LOW";

  // ── CP4: 채권시장 ──
  const yieldSpread = tnx - fvx; // 10Y-5Y 스프레드
  const termSpread = tnx - irx; // 장단기 스프레드
  const inverted = termSpread < 0;
  const cp4Sev = tnx > 5 ? "CRITICAL" : tnx > 4.5 ? "HIGH" : tnx > 4 ? "MODERATE" : "LOW";
  const cp4Score = Math.min(100, Math.round(tnx * 15 + (inverted ? 20 : 0) + Math.max(0, vix - 18) * 2));

  // ── CP5: 환율 ──
  const cp5Sev = dxy > 106 ? "HIGH" : dxy > 103 ? "MODERATE" : "LOW";
  const cp5Score = Math.min(100, Math.round(Math.max(0, (dxy - 100) * 8)));
  const krwStatus = usdkrw > 1400 ? "danger" : usdkrw > 1350 ? "warn" : "ok";

  // ── CP6: 원자재 ──
  // WTI, Gold, Copper 종합
  const oilLevel = wti > 90 ? "CRITICAL" : wti > 80 ? "HIGH" : wti > 70 ? "MODERATE" : "LOW";
  const cp6Score = Math.min(100, Math.round(
    Math.max(0, (wti - 65) * 1.5) + Math.max(0, (gold - 2500) / 30) + Math.max(0, (copper - 4) * 10)
  ));
  const cp6Sev = cp6Score > 75 ? "CRITICAL" : cp6Score > 55 ? "HIGH" : cp6Score > 35 ? "MODERATE" : "LOW";

  // ── CP7: 기업실적 (S&P 변동성 + 시장 심리 기반 추론) ──
  // 공포·탐욕 지수가 없으면 임의 대체값(50) 대신 '데이터 없음'으로 정직하게 처리하고
  // 종합 점수 산출에서 제외합니다.
  const cp7HasData = fearGreed != null;
  const earningsSentiment = cp7HasData ? fearGreed : null;
  const cp7Score = cp7HasData
    ? Math.max(0, Math.min(100, Math.round(100 - earningsSentiment - Math.max(0, sp500Change * 5))))
    : null;
  const cp7Sev = cp7HasData ? (cp7Score > 65 ? "HIGH" : cp7Score > 40 ? "MODERATE" : "LOW") : null;

  // ── CP8: 유동성 ──
  // VIX + 금리 수준 + 달러 강세 복합
  const liqStress = vix * 1.5 + Math.max(0, (impliedRate - 4) * 10) + Math.max(0, (dxy - 103) * 3);
  const cp8Score = Math.min(100, Math.round(liqStress));
  const cp8Sev = cp8Score > 75 ? "CRITICAL" : cp8Score > 55 ? "HIGH" : cp8Score > 35 ? "MODERATE" : "LOW";

  return [
    {
      id: "CP1", name: "매크로", icon: "📊",
      severity: cp1Sev, score: cp1Score,
      headline: `VIX ${vix.toFixed(1)} · S&P ${sp500Change >= 0 ? "+" : ""}${sp500Change.toFixed(1)}% · ${vix > 25 ? "변동성 경고" : vix > 18 ? "경계 구간" : "안정권"}`,
      keyMetrics: [
        { label: "VIX", value: vix.toFixed(1), status: vix > 25 ? "danger" : vix > 18 ? "warn" : "ok" },
        { label: "S&P 500", value: `${sp500Change >= 0 ? "+" : ""}${sp500Change.toFixed(1)}%`, status: sp500Change < -1 ? "danger" : sp500Change < 0 ? "warn" : "ok" },
        { label: "공포·탐욕", value: fearGreed != null ? `${fearGreed}` : "N/A", status: fearGreed != null ? (fearGreed < 25 ? "danger" : fearGreed < 40 ? "warn" : "ok") : "warn" },
      ],
      impact: "전 섹터 변동성에 영향",
      trend: vix > 25 ? "악화" : sp500Change > 0.5 ? "개선" : "안정",
    },
    {
      id: "CP2", name: "통화정책", icon: "🏦",
      severity: cp2Sev, score: cp2Score,
      headline: `내재 기준금리 ${impliedRate.toFixed(2)}% · 금리인하 확률 ${rateCutProb}% · ${impliedRate > 5 ? "긴축 지속" : impliedRate > 4 ? "고금리 유지" : "완화 전환"}`,
      keyMetrics: [
        { label: "내재금리(13W)", value: `${impliedRate.toFixed(2)}%`, status: impliedRate > 5 ? "danger" : impliedRate > 4 ? "warn" : "ok" },
        { label: "10Y 수익률", value: `${tnx.toFixed(2)}%`, status: tnx > 4.5 ? "danger" : tnx > 4 ? "warn" : "ok" },
        { label: "인하 확률", value: `${rateCutProb}%`, status: rateCutProb < 30 ? "warn" : rateCutProb > 60 ? "ok" : "warn" },
      ],
      impact: "금리 민감 종목(리츠, 유틸)에 영향",
      trend: rateCutProb > 50 ? "개선" : rateCutProb < 25 ? "악화" : "보합",
    },
    {
      id: "CP3", name: "지정학", icon: "🌍",
      severity: cp3Sev, score: geoScore,
      headline: `유가 $${wti.toFixed(1)} · 금 $${gold.toFixed(0)} · ${geoScore > 55 ? "긴장 고조" : geoScore > 35 ? "경계 유지" : "안정"}`,
      keyMetrics: [
        { label: "WTI 원유", value: `$${wti.toFixed(1)}`, status: wti > 85 ? "danger" : wti > 75 ? "warn" : "ok" },
        { label: "금(안전자산)", value: `$${gold.toFixed(0)}`, status: gold > 3200 ? "warn" : gold > 3000 ? "warn" : "ok" },
        { label: "VIX(불안지수)", value: vix.toFixed(1), status: vix > 25 ? "danger" : vix > 18 ? "warn" : "ok" },
      ],
      impact: "에너지·방산 섹터 및 공급망 민감 종목에 영향",
      trend: geoScore > 60 ? "악화" : geoScore < 30 ? "개선" : "보합",
    },
    {
      id: "CP4", name: "채권시장", icon: "📉",
      severity: cp4Sev, score: cp4Score,
      headline: `10Y ${tnx.toFixed(2)}% · 장단기 스프레드 ${(termSpread * 100).toFixed(0)}bp · ${inverted ? "역전 경고" : termSpread < 0.5 ? "플랫닝" : "정상"}`,
      keyMetrics: [
        { label: "10Y 수익률", value: `${tnx.toFixed(2)}%`, status: tnx > 4.5 ? "danger" : tnx > 4 ? "warn" : "ok" },
        { label: "10Y-IRX", value: `${(termSpread * 100).toFixed(0)}bp`, status: inverted ? "danger" : termSpread < 0.3 ? "warn" : "ok" },
        { label: "10Y-5Y", value: `${(yieldSpread * 100).toFixed(0)}bp`, status: Math.abs(yieldSpread) > 0.5 ? "warn" : "ok" },
      ],
      impact: "성장주 밸류에이션 하방 압력",
      trend: tnx > 4.5 ? "악화" : tnx < 3.5 ? "개선" : "보합",
    },
    {
      id: "CP5", name: "환율", icon: "💱",
      severity: cp5Sev, score: cp5Score,
      headline: `DXY ${dxy.toFixed(1)} · USD/KRW ${usdkrw.toFixed(0)} · ${dxy > 106 ? "강달러 압박" : dxy > 103 ? "달러 강세" : "중립"}`,
      keyMetrics: [
        { label: "DXY", value: dxy.toFixed(1), status: dxy > 106 ? "danger" : dxy > 103 ? "warn" : "ok" },
        { label: "USD/KRW", value: `₩${usdkrw.toFixed(0)}`, status: krwStatus },
        { label: "EM 통화", value: dxy > 105 ? "약세" : "보합", status: dxy > 105 ? "warn" : "ok" },
      ],
      impact: "수출주/해외매출 비중 높은 종목 영향",
      trend: dxy > 105 ? "악화" : dxy < 101 ? "개선" : "안정",
    },
    {
      id: "CP6", name: "원자재", icon: "🛢️",
      severity: cp6Sev, score: cp6Score,
      headline: `WTI $${wti.toFixed(1)} · 금 $${gold.toFixed(0)} · 구리 $${copper.toFixed(2)}`,
      keyMetrics: [
        { label: "WTI", value: `$${wti.toFixed(1)}`, status: wti > 85 ? "danger" : wti > 75 ? "warn" : "ok" },
        { label: "금", value: `$${gold.toFixed(0)}`, status: gold > 3200 ? "warn" : "ok" },
        { label: "구리", value: `$${copper.toFixed(2)}`, status: copper > 4.5 ? "warn" : "ok" },
      ],
      impact: "인플레 기대 반영 · 에너지 섹터 연동",
      trend: wti > 80 ? "악화" : wti < 65 ? "개선" : "안정",
    },
    cp7HasData ? {
      id: "CP7", name: "기업실적", icon: "🏢",
      severity: cp7Sev, score: cp7Score,
      headline: `시장 심리 ${earningsSentiment} · S&P ${sp500Change >= 0 ? "+" : ""}${sp500Change.toFixed(1)}% · ${earningsSentiment > 60 ? "낙관" : earningsSentiment > 40 ? "중립" : "비관"}`,
      keyMetrics: [
        { label: "투자심리", value: `${earningsSentiment}`, status: earningsSentiment < 25 ? "danger" : earningsSentiment < 40 ? "warn" : "ok" },
        { label: "S&P 추세", value: `${sp500Change >= 0 ? "+" : ""}${sp500Change.toFixed(1)}%`, status: sp500Change < -1 ? "danger" : sp500Change < 0 ? "warn" : "ok" },
        { label: "시장 상태", value: earningsSentiment > 60 ? "탐욕" : earningsSentiment > 40 ? "중립" : earningsSentiment > 25 ? "공포" : "극공포", status: earningsSentiment < 25 ? "danger" : earningsSentiment < 40 ? "warn" : "ok" },
      ],
      impact: "실적 기대감(시장 심리) 반영 지표",
      trend: earningsSentiment > 55 ? "개선" : earningsSentiment < 35 ? "악화" : "보합",
    } : {
      // 공포·탐욕 지수 미수신 — 대체값 없이 '데이터 없음'으로 표시하고 종합 산출에서 제외합니다
      id: "CP7", name: "기업실적", icon: "🏢",
      noData: true, severity: null, score: null,
      headline: "공포·탐욕 지수 미수신 — 등급 산출에서 제외됩니다",
      keyMetrics: [],
      impact: null,
      trend: null,
    },
    {
      id: "CP8", name: "유동성", icon: "💧",
      severity: cp8Sev, score: cp8Score,
      headline: `${cp8Sev === "CRITICAL" ? "신용 스트레스 경고" : cp8Sev === "HIGH" ? "유동성 긴축 신호" : "유동성 보통"} · VIX ${vix.toFixed(1)} · 금리 ${impliedRate.toFixed(2)}%`,
      keyMetrics: [
        { label: "VIX", value: vix.toFixed(1), status: vix > 25 ? "danger" : vix > 18 ? "warn" : "ok" },
        { label: "기준금리", value: `${impliedRate.toFixed(2)}%`, status: impliedRate > 5 ? "danger" : impliedRate > 4 ? "warn" : "ok" },
        { label: "DXY", value: dxy.toFixed(1), status: dxy > 106 ? "danger" : dxy > 103 ? "warn" : "ok" },
      ],
      impact: "소형주·고베타 종목 유동성 리스크",
      trend: cp8Score > 65 ? "악화" : cp8Score < 30 ? "개선" : "보합",
    },
  ];
}

// 점수 → 등급 키 (종합 점수·추이 차트 공용 임계값)
function levelForScore(s) {
  return s >= 75 ? "CRITICAL" : s >= 55 ? "HIGH" : s >= 35 ? "MODERATE" : "LOW";
}

function calcOverall(risks) {
  // '데이터 없음' CP 는 종합 점수 산출에서 제외합니다
  const scored = risks.filter(r => !r.noData);
  if (scored.length === 0) return { score: 0, level: "LOW", crit: 0 };
  const avg = scored.reduce((a, r) => a + r.score, 0) / scored.length;
  const crit = scored.filter(r => r.severity === "CRITICAL").length;
  const adj = Math.min(100, avg + crit * 5);
  return { score: Math.round(adj), level: levelForScore(adj), crit };
}

// 실측 이력 기반 미니 스파크라인 — localStorage 에 기록된 일자별 점수만 사용하며,
// 기록이 2일치 미만이면 아무것도 그리지 않습니다 (합성·의사난수 데이터 사용 금지).
// 색은 토큰을 props 로 받습니다 (리스크 점수 상승 = upColor, 하락 = downColor).
function MiniSparkline({ points, width = 64, height = 20, upColor, downColor }) {
  if (!Array.isArray(points) || points.length < 2) return null;
  const min = Math.min(...points), max = Math.max(...points);
  const range = max - min || 1;
  const path = points.map((v, i) => `${(i / (points.length - 1)) * width},${height - ((v - min) / range) * (height - 4) - 2}`).join(" ");
  const isUp = points[points.length - 1] > points[0];
  return (
    <svg width={width} height={height} style={{ display: "block" }} aria-hidden="true">
      <polyline points={path} fill="none" stroke={isUp ? upColor : downColor} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

// 빈 상태 아이콘 — 시안 1e 의 방패 아웃라인
function ShieldIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" />
    </svg>
  );
}

export default function RiskHeatmap({ marketIndices = [], fearGreed = {}, onRetry }) {
  const C = useThemeTokens();
  const isMobile = useIsMobile();
  const SEVC = useMemo(() => sevOf(C), [C]);
  const [expandedCP, setExpandedCP] = useState(null);
  const [tab, setTab] = useState("dashboard"); // "dashboard" | "matrix" | "history"
  const [loadTimedOut, setLoadTimedOut] = useState(false);
  const [history, setHistory] = useState(loadHistory);

  // ── 필수 시세 완전성 검사 ──
  // 누락 심볼이 하나라도 있으면 등급을 산출·표시하지 않습니다 (폴백 수치 금지).
  const missing = useMemo(() => REQUIRED_SYMBOLS.filter(sym => {
    const item = marketIndices.find(i => i.symbol === sym);
    if (!item || !Number.isFinite(item.price)) return true;
    if (sym === "^GSPC" && !Number.isFinite(item.change)) return true;
    return false;
  }), [marketIndices]);
  const isComplete = missing.length === 0;

  // 시세 로딩 실패 판별 — 일정 시간 내 필수 시세가 채워지지 않으면 '데이터 없음' 상태로 전환합니다
  useEffect(() => {
    if (isComplete) { setLoadTimedOut(false); return undefined; }
    const timer = setTimeout(() => setLoadTimedOut(true), 8000);
    return () => clearTimeout(timer);
  }, [isComplete]);

  const mkt = useMemo(() => {
    const find = (sym) => marketIndices.find(i => i.symbol === sym);
    // 폴백 상수 없이 실측값만 전달합니다 — 누락 시 상위 게이트에서 렌더가 차단됩니다
    return {
      vix: find("^VIX")?.price ?? null,
      sp500Change: find("^GSPC")?.change ?? null,
      dxy: find("DX-Y.NYB")?.price ?? null,
      fearGreed: fearGreed?.stock?.value ?? null,
      tnx: find("^TNX")?.price ?? null, // 10Y Treasury Yield
      fvx: find("^FVX")?.price ?? null, // 5Y Treasury Yield
      irx: find("^IRX")?.price ?? null, // 13-Week T-Bill Rate
      wti: find("CL=F")?.price ?? null,
      gold: find("GC=F")?.price ?? null,
      copper: find("HG=F")?.price ?? null,
      usdkrw: find("USDKRW=X")?.price ?? null,
    };
  }, [marketIndices, fearGreed]);

  // 필수 시세가 모두 있을 때만 등급을 산출합니다
  const risks = useMemo(() => (isComplete ? assessRisks(mkt) : []), [isComplete, mkt]);
  const overall = useMemo(() => calcOverall(risks), [risks]);
  const ov = SEVC[overall.level];

  // ── 리스크 점수 실측 이력 적재 (일자별 1건, 같은 날은 최신값으로 갱신, 30일 롤링) ──
  useEffect(() => {
    if (!isComplete || risks.length === 0) return;
    const dateKey = localDateKey();
    const scores = {};
    risks.forEach(r => { scores[r.id] = Number.isFinite(r.score) ? r.score : null; });
    const entry = { d: dateKey, scores, overall: overall.score };
    setHistory(prev => {
      const existing = prev.find(h => h.d === dateKey);
      if (existing && JSON.stringify(existing) === JSON.stringify(entry)) return prev;
      const next = prev.filter(h => h.d !== dateKey).concat([entry]);
      next.sort((a, b) => (a.d < b.d ? -1 : 1));
      const trimmed = next.slice(-HIST_MAX_DAYS);
      try { localStorage.setItem(HIST_KEY, JSON.stringify(trimmed)); } catch { /* 저장 불가 환경은 무시 */ }
      return trimmed;
    });
  }, [isComplete, risks, overall]);

  const sorted = useMemo(() => {
    const ord = { CRITICAL: 0, HIGH: 1, MODERATE: 2, LOW: 3 };
    return [...risks].sort((a, b) => (ord[a.severity] ?? 4) - (ord[b.severity] ?? 4));
  }, [risks]);

  // 해당 CP 의 일자별 실측 점수 시계열 (기록된 유효값만)
  const seriesFor = (cpId) => history.map(h => h?.scores?.[cpId]).filter(v => Number.isFinite(v));

  // 종합 점수 실측 시계열 (추이 바 차트용)
  const overallSeries = useMemo(
    () => history.filter(h => Number.isFinite(h?.overall)),
    [history]
  );

  const StatusDot = ({ status }) => (
    <span style={{ width: "6px", height: "6px", borderRadius: "50%", display: "inline-block", flexShrink: 0,
      background: status === "danger" ? C.red : status === "warn" ? C.yellow : C.green }} />
  );

  // 등급 배지 — 시안 항목 카드의 우상단 칩 어법
  const SevBadge = ({ sevKey }) => {
    const sv = sevKey ? SEVC[sevKey] : null;
    return (
      <span style={{ fontSize: "10px", fontWeight: 800, padding: "2px 8px", borderRadius: "8px", whiteSpace: "nowrap",
        background: sv ? sv.bg : C.card2, color: sv ? sv.hi : C.text3 }}>
        {sv ? sv.label : "데이터 없음"}
      </span>
    );
  };

  const trendColor = (t) => (t === "악화" ? C.redL || C.red : t === "개선" ? C.greenL || C.green : C.text3);
  const metricColor = (s) => (s === "danger" ? C.redL || C.red : s === "warn" ? C.yellowL || C.yellow : C.text1);

  const dateStr = new Date().toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "short" });

  // 페이지 헤더 — 시안 1e: 타이틀 + 우측 상태 알약 (상태 서술만)
  const pageHeader = (statusPill) => (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", marginBottom: "14px" }}>
      <span style={{ fontSize: "22px", fontWeight: 800, color: C.text1 }}>리스크맵</span>
      {statusPill}
    </div>
  );

  // 면책 — 시안의 하단 한 줄 어법 (기존 정직성 문구 유지)
  const disclaimer = (
    <Disclaimer style={{ marginTop: "16px" }}>
      리스크 점수는 VIX, 국채 수익률, 공포·탐욕 지수, 달러 인덱스, 원자재 가격 등 공개 시장 데이터를 기반으로
      실시간 자동 산출됩니다. 투자 판단의 근거가 아닌 참고 자료로만 활용하시기 바랍니다.
    </Disclaimer>
  );

  // ── 렌더 게이트: 필수 시세가 준비되기 전에는 등급·게이지를 표시하지 않습니다 ──
  // 시안 1e "빈 상태 — 수집 중" 변형: 스켈레톤 카드 4개 + 점선 안내 블록
  if (!isComplete) {
    return (
      <div className="tab-content">
        {pageHeader(
          <span style={{ fontSize: "11px", fontWeight: 700, padding: "5px 11px", borderRadius: "9999px",
            background: C.card, border: `1px solid ${C.border}`,
            color: loadTimedOut ? (C.yellowL || C.yellow) : C.text2 }}>
            {loadTimedOut ? "데이터 없음" : `수집 중 · ${dateStr} 기준`}
          </span>
        )}

        {/* 스켈레톤 카드 — 수치·등급을 흉내내지 않는 무지 플레이스홀더입니다 */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "12px" }}>
          {[[52, 38], [60, 34], [44, 42], [56, 30]].map(([w1, w2], i) => (
            <div key={i} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "14px",
              padding: "12px 13px", display: "flex", flexDirection: "column", gap: "8px" }}>
              <div style={{ width: `${w1}%`, height: "9px", borderRadius: "5px", background: C.card2 }} />
              <div style={{ width: `${w2}%`, height: "14px", borderRadius: "5px", background: C.card2 }} />
            </div>
          ))}
        </div>

        <div style={{ border: `1.5px dashed ${C.border2}`, borderRadius: "16px", display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", gap: "6px", padding: "36px 24px", textAlign: "center" }}>
          <div style={{ width: "52px", height: "52px", borderRadius: "16px", background: C.card2,
            display: "flex", alignItems: "center", justifyContent: "center", color: C.text3 }}>
            <ShieldIcon />
          </div>
          {loadTimedOut ? (
            <>
              <div style={{ fontSize: "15px", fontWeight: 800, marginTop: "8px", color: C.text1 }}>시세 데이터를 불러오지 못했습니다</div>
              <div style={{ fontSize: "12.5px", color: C.text3, lineHeight: 1.6, maxWidth: "260px", textWrap: "pretty" }}>
                필수 시세가 준비되지 않아 리스크 등급을 산출하지 않습니다.
              </div>
              <div style={{ fontSize: "11px", color: C.text4, wordBreak: "break-all", maxWidth: "280px" }}>
                누락 심볼: {missing.join(", ")}
              </div>
              <button onClick={() => (typeof onRetry === "function" ? onRetry() : window.location.reload())} style={{
                marginTop: "10px", padding: "10px 20px", borderRadius: "10px", fontSize: "14px", fontWeight: 700,
                fontFamily: "inherit", background: C.blueBg, color: C.blue, border: `1px solid ${C.blue}`,
                cursor: "pointer", minHeight: "44px",
              }}>다시 시도</button>
            </>
          ) : (
            <>
              <div style={{ fontSize: "15px", fontWeight: 800, marginTop: "8px", color: C.text1 }}>리스크 데이터를 수집하고 있어요</div>
              <div style={{ fontSize: "12.5px", color: C.text3, lineHeight: 1.6, maxWidth: "260px", textWrap: "pretty" }}>
                필수 시세가 모두 도착하면 종합 리스크 점수가 표시됩니다.
              </div>
            </>
          )}
        </div>

        {disclaimer}
      </div>
    );
  }

  return (
    <div className="tab-content">
      {pageHeader(
        <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "11px", fontWeight: 700,
          padding: "5px 11px", borderRadius: "9999px", background: C.card, border: `1px solid ${C.border}`, color: C.text2 }}>
          {/* 필수 시세 전체 수신 확인 후에만 도달하는 화면이므로 LIVE 로 표기합니다 */}
          <span className="z-pulse" style={{ width: "6px", height: "6px", borderRadius: "50%", background: C.green, flexShrink: 0 }} />
          {dateStr} 기준 · <span style={{ color: C.greenL || C.green }}>LIVE</span>
        </span>
      )}

      {/* ═══ 종합 리스크 점수 히어로 — 좌측 3px 보더 + 상단 등급색 그라데이션 ═══ */}
      <div style={{
        background: `linear-gradient(180deg, ${ov.bg}, transparent 42%), ${C.card}`,
        border: `1px solid ${C.border}`, borderLeft: `3px solid ${ov.base}`,
        borderRadius: "16px", padding: "16px", marginBottom: "14px",
      }}>
        <div style={{ fontSize: "11px", color: C.text3, fontWeight: 700 }}>종합 리스크 점수</div>
        <div style={{ display: "flex", alignItems: "baseline", gap: "8px", marginTop: "4px" }}>
          <Num size="38px" weight={800} color={ov.hi}>{overall.score}</Num>
          <Num size="13px" weight={600} color={C.text3}>/ 100</Num>
          <span style={{ marginLeft: "auto", fontSize: "12px", fontWeight: 800, padding: "3px 10px",
            borderRadius: "8px", background: ov.bg, color: ov.hi, whiteSpace: "nowrap" }}>{ov.label} 수준</span>
        </div>
        {/* 게이지 — 낮음(초록) → 높음(빨강), 노브는 현재 점수 위치 */}
        <div style={{ position: "relative", height: "16px", marginTop: "10px" }}>
          <div style={{ position: "absolute", top: "5px", left: 0, right: 0, height: "6px", borderRadius: "9999px",
            background: `linear-gradient(90deg, ${C.green}, ${C.yellow} 50%, ${C.red})` }} />
          <div style={{ position: "absolute", top: "1px", left: `calc(${Math.max(0, Math.min(100, overall.score))}% - 7px)`,
            width: "14px", height: "14px", borderRadius: "50%", background: ov.hi, boxShadow: `0 0 0 3px ${C.card}` }} />
        </div>
        <div style={{ fontSize: "11px", color: C.text3, marginTop: "10px" }}>
          점수가 높을수록 시장 전반의 위험 요인이 많다는 뜻이에요.
        </div>
        {/* 등급 분포 — 기존 카운트 바 유지 (시안 칩 어법으로 래핑) */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "6px", marginTop: "12px" }}>
          {Object.entries(SEVC).map(([key, sv]) => {
            const cnt = risks.filter(r => r.severity === key).length;
            return (
              <div key={key} style={{
                background: cnt > 0 ? sv.bg : C.card2, borderRadius: "10px",
                padding: "7px 4px", textAlign: "center",
              }}>
                <Num size="16px" weight={800} color={cnt > 0 ? sv.hi : C.text3}>{cnt}</Num>
                <div style={{ fontSize: "10px", fontWeight: 700, color: cnt > 0 ? sv.hi : C.text3, marginTop: "1px" }}>{sv.label}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 서브 탭 — mobileKit Segment
          minHeight 54px = 컨테이너 보더 1px×2 + 패딩 4px×2 + 버튼 44px.
          Segment 버튼은 flex stretch 로 컨테이너를 채우므로, 이 화면이 유지하던
          44px 권장 터치 타겟(WCAG 2.5.5)을 컨테이너 높이로 보장합니다. */}
      <Segment
        options={[
          { value: "dashboard", label: "대시보드" },
          { value: "matrix", label: "매트릭스" },
          { value: "history", label: "추이 기록" },
        ]}
        value={tab}
        onChange={setTab}
        style={{ marginBottom: "14px", minHeight: "54px" }}
      />

      {/* ═══ 대시보드 뷰 — 리스크 항목 카드 (등급 배지·수치·설명) ═══ */}
      {tab === "dashboard" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {sorted.map(risk => {
            // '데이터 없음' CP — 점수·등급 없이 상태만 표시합니다
            if (risk.noData) {
              return (
                <div key={risk.id} style={{
                  background: C.card, border: `1px solid ${C.border}`, borderLeft: `3px solid ${C.border2}`,
                  borderRadius: "14px", padding: "12px 14px", opacity: 0.75,
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: isMobile ? "8px" : "12px" }}>
                    <div style={{ fontSize: isMobile ? "16px" : "18px", width: isMobile ? "32px" : "36px", height: isMobile ? "32px" : "36px",
                      borderRadius: "10px", background: C.card2, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      {risk.icon}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "2px", flexWrap: "wrap" }}>
                        <span style={{ fontWeight: 800, fontSize: isMobile ? "14px" : "15px" }}>{risk.name}</span>
                        <SevBadge sevKey={null} />
                      </div>
                      <div style={{ fontSize: "12px", color: C.text3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {risk.headline}
                      </div>
                    </div>
                  </div>
                </div>
              );
            }
            const sv = SEVC[risk.severity];
            const isOpen = expandedCP === risk.id;
            return (
              <div key={risk.id}
                onClick={() => setExpandedCP(isOpen ? null : risk.id)}
                role="button" tabIndex={0} aria-expanded={isOpen}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setExpandedCP(isOpen ? null : risk.id); } }}
                style={{
                  background: `linear-gradient(180deg, ${sv.bg}, transparent 42%), ${C.card}`,
                  border: `1px solid ${C.border}`, borderLeft: `3px solid ${sv.base}`,
                  borderRadius: "14px", padding: "12px 14px", cursor: "pointer", transition: "border-color .2s",
                }}>
                <div style={{ display: "flex", alignItems: "center", gap: isMobile ? "8px" : "12px" }}>
                  <div style={{ fontSize: isMobile ? "16px" : "18px", width: isMobile ? "32px" : "36px", height: isMobile ? "32px" : "36px",
                    borderRadius: "10px", background: sv.bg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    {risk.icon}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "2px", flexWrap: "wrap" }}>
                      <span style={{ fontWeight: 800, fontSize: isMobile ? "14px" : "15px" }}>{risk.name}</span>
                      <SevBadge sevKey={risk.severity} />
                      <span style={{ fontSize: "11px", color: trendColor(risk.trend), fontWeight: 700 }}>
                        {risk.trend === "악화" ? "↗ 악화" : risk.trend === "개선" ? "↘ 개선" : "→ 보합"}
                      </span>
                    </div>
                    <div style={{ fontSize: "12px", color: C.text3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {risk.headline}
                    </div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "2px" }}>
                    <Num size={isMobile ? "18px" : "20px"} weight={800} color={sv.hi}>{risk.score}</Num>
                    {/* 실측 이력이 2일치 이상 쌓인 경우에만 표시됩니다 */}
                    <MiniSparkline points={seriesFor(risk.id)} upColor={C.red} downColor={C.green} />
                  </div>
                </div>

                {isOpen && (
                  <div style={{ marginTop: "12px", paddingTop: "12px", borderTop: `1px solid ${C.border}` }}>
                    {/* 핵심 지표 */}
                    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(3, 1fr)", gap: isMobile ? "6px" : "8px", marginBottom: "10px" }}>
                      {risk.keyMetrics.map((m, j) => (
                        <div key={j} style={{ background: C.card2, borderRadius: "10px", padding: "10px", textAlign: "center" }}>
                          <div style={{ fontSize: "11px", color: C.text3, fontWeight: 700, marginBottom: "4px",
                            display: "flex", alignItems: "center", justifyContent: "center", gap: "4px" }}>
                            <StatusDot status={m.status} /> {m.label}
                          </div>
                          <Num size="14px" weight={800} color={metricColor(m.status)}>{m.value}</Num>
                        </div>
                      ))}
                    </div>
                    {/* 포트폴리오 영향 */}
                    <div style={{ background: C.card2, borderRadius: "10px", padding: "10px 12px",
                      fontSize: "12.5px", color: C.text2, lineHeight: 1.5 }}>
                      <b style={{ color: C.text1 }}>포트폴리오 영향</b> · {risk.impact}
                    </div>
                    {/* 리스크 바 */}
                    <div style={{ marginTop: "10px" }}>
                      <div style={{ height: "4px", borderRadius: "4px", background: C.card2, overflow: "hidden" }}>
                        <div style={{ width: `${risk.score}%`, height: "100%", borderRadius: "4px", background: sv.base,
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

      {/* ═══ 매트릭스 뷰 — 시안 1e 의 2열 항목 카드 그리드 ═══ */}
      {tab === "matrix" && (
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "14px" }}>
            {sorted.map(risk => {
              // '데이터 없음' CP — 강도 표시 없이 상태만 표시합니다
              if (risk.noData) {
                return (
                  <div key={risk.id} style={{
                    background: C.card, border: `1px solid ${C.border}`, borderRadius: "14px",
                    padding: "12px 13px", opacity: 0.75,
                  }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "6px" }}>
                      <span style={{ fontSize: "13px", fontWeight: 800, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{risk.name}</span>
                      <SevBadge sevKey={null} />
                    </div>
                    <div style={{ marginTop: "7px" }}><Num size="16px" weight={800} color={C.text3}>–</Num></div>
                    <div style={{ fontSize: "11px", color: C.text3, marginTop: "3px", lineHeight: 1.45 }}>{risk.headline}</div>
                  </div>
                );
              }
              const sv = SEVC[risk.severity];
              const isOpen = expandedCP === risk.id;
              return (
                <div key={risk.id}
                  onClick={() => setExpandedCP(isOpen ? null : risk.id)}
                  role="button" tabIndex={0} aria-expanded={isOpen}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setExpandedCP(isOpen ? null : risk.id); } }}
                  style={{
                    background: `linear-gradient(180deg, ${sv.bg}, transparent 42%), ${C.card}`,
                    border: `1px solid ${C.border}`, borderRadius: "14px",
                    padding: "12px 13px", cursor: "pointer", transition: "border-color .2s",
                  }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "6px" }}>
                    <span style={{ fontSize: "13px", fontWeight: 800, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{risk.name}</span>
                    <SevBadge sevKey={risk.severity} />
                  </div>
                  <div style={{ marginTop: "7px", display: "flex", alignItems: "baseline", gap: "5px" }}>
                    <Num size="16px" weight={800} color={sv.hi}>{risk.score}</Num>
                    <span style={{ fontSize: "11px", color: trendColor(risk.trend), fontWeight: 700 }} aria-label={`추세 ${risk.trend}`}>
                      {risk.trend === "악화" ? "▲" : risk.trend === "개선" ? "▼" : "−"}
                    </span>
                  </div>
                  <div style={{ fontSize: "11px", color: C.text3, marginTop: "3px", lineHeight: 1.45 }}>{risk.headline}</div>

                  {isOpen && (
                    <div style={{ marginTop: "10px", paddingTop: "10px", borderTop: `1px solid ${C.border}` }}>
                      {risk.keyMetrics.map((m, j) => (
                        <div key={j} style={{ display: "flex", justifyContent: "space-between", gap: "6px", fontSize: "12px", padding: "3px 0" }}>
                          <span style={{ color: C.text3, display: "flex", alignItems: "center", gap: "4px", minWidth: 0,
                            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            <StatusDot status={m.status} /> {m.label}
                          </span>
                          <Num size="12px" weight={700} color={metricColor(m.status)}>{m.value}</Num>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* 범례 */}
          <div style={{ display: "flex", gap: "12px", justifyContent: "center", padding: "4px", flexWrap: "wrap" }}>
            {Object.entries(SEVC).map(([key, sv]) => (
              <div key={key} style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "11px", fontWeight: 700, color: C.text3 }}>
                <span style={{ width: "8px", height: "8px", borderRadius: "4px", background: sv.base }} />
                {sv.label}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ═══ 추이 기록 뷰 — localStorage 실측 이력 기반 ═══ */}
      {tab === "history" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {/* 종합 점수 추이 — 시안 1e 의 바 차트를 실측 기록으로 그립니다 */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "16px", padding: "15px 16px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "8px", marginBottom: "4px" }}>
              <span style={{ fontSize: "14px", fontWeight: 800 }}>점수 추이</span>
              <span style={{ fontSize: "11px", color: C.text3 }}>최근 {history.length}일 기록</span>
            </div>
            <div style={{ fontSize: "11px", color: C.text4, marginBottom: "12px", lineHeight: 1.5 }}>
              이 브라우저에서 방문 시점에 산출된 점수를 일자별로 기록한 실측 이력입니다.
            </div>
            {overallSeries.length < 2 ? (
              <div style={{ padding: "16px 0", textAlign: "center", fontSize: "13px", color: C.text3, lineHeight: 1.6 }}>
                아직 기록된 이력이 충분하지 않습니다.<br />2일 이상 방문하면 실제 기록 기반 추이가 표시됩니다.
              </div>
            ) : (
              <>
                <div style={{ display: "flex", gap: "4px", alignItems: "flex-end", height: "56px" }}>
                  {overallSeries.map((h, i) => {
                    const lv = SEVC[levelForScore(h.overall)];
                    const isLast = i === overallSeries.length - 1;
                    return (
                      <div key={h.d} title={`${h.d} · ${h.overall}점`} style={{
                        flex: 1, height: `${Math.max(4, Math.min(100, h.overall))}%`,
                        background: isLast ? lv.hi : `${lv.base}66`, borderRadius: "3px",
                      }} />
                    );
                  })}
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "10px", color: C.text4, marginTop: "7px" }}>
                  <span>{shortDate(overallSeries[0].d)}</span>
                  <Num size="10px" weight={800} color={ov.hi}>오늘 {overall.score}</Num>
                </div>
              </>
            )}
          </div>

          {/* CP 별 추이 — 실측 기록이 2일치 이상일 때만 행이 표시됩니다 */}
          {overallSeries.length >= 2 && (
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "16px", padding: "15px 16px" }}>
              <div style={{ fontSize: "14px", fontWeight: 800, marginBottom: "8px" }}>항목별 추이</div>
              {risks.map((risk, idx) => {
                const sv = risk.noData ? null : SEVC[risk.severity];
                return (
                  <div key={risk.id} style={{ display: "flex", alignItems: "center", gap: "10px",
                    padding: "9px 0", borderBottom: idx === risks.length - 1 ? "none" : `1px solid ${C.card2}` }}>
                    <span style={{ fontSize: "16px", width: "26px", textAlign: "center", flexShrink: 0 }}>{risk.icon}</span>
                    <span style={{ fontWeight: 700, fontSize: "13px", width: "62px", flexShrink: 0 }}>{risk.name}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <MiniSparkline points={seriesFor(risk.id)} width={100} height={24} upColor={C.red} downColor={C.green} />
                    </div>
                    <Num size="14px" weight={800} color={sv ? sv.hi : C.text3} style={{ display: "inline-block", width: "30px", textAlign: "right", flexShrink: 0 }}>
                      {risk.noData ? "–" : risk.score}
                    </Num>
                    <SevBadge sevKey={risk.noData ? null : risk.severity} />
                  </div>
                );
              })}
            </div>
          )}

          {/* 종합 요약 — 현재 상태의 사실 서술만 표시합니다 (운용 지시 워딩 금지) */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "16px", padding: "15px 16px" }}>
            <div style={{ fontSize: "14px", fontWeight: 800, marginBottom: "10px" }}>리스크 요약</div>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {[
                { color: C.redL || C.red, text: `위험 구간(위험·높음) CP ${risks.filter(r => r.severity === "CRITICAL" || r.severity === "HIGH").length}개` },
                { color: C.greenL || C.green, text: `안정 구간(낮음) CP ${risks.filter(r => r.severity === "LOW").length}개` },
                { color: C.yellowL || C.yellow, text: `종합 리스크 ${overall.score}점 — ${overall.score > 65 ? "높음" : overall.score > 40 ? "보통" : "낮음"} 구간` },
              ].map((item, i) => (
                <div key={i} style={{ display: "flex", gap: "8px", alignItems: "center", fontSize: "13px", color: C.text2 }}>
                  <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: item.color, flexShrink: 0 }} />
                  {item.text}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 면책 */}
      {disclaimer}
    </div>
  );
}
