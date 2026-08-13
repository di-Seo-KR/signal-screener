// Zepta — 리스크맵 v4 (시안 1e 적용)
// 6-Point CP 시스템 — 모든 체크포인트 실시간 시장 데이터 기반 동적 산출
// v3.1 정직성 로직(필수 시세 게이트 · 하드코딩 폴백 금지 · localStorage 실측 추이 ·
//      상태 서술 워딩)은 전부 유지 — v4 는 표현만 모바일 시안(1e) 문법으로 교체:
//      종합 점수 히어로(좌측 3px 보더 + 상단 그라데이션 + mono 숫자 + 게이지 노브),
//      리스크 항목 카드(등급 배지·수치·설명), 실측 추이 바 차트, 빈 상태 변형.
// 색은 하드코딩 hex 대신 useThemeTokens() — 라이트 모드는 토큰이 처리합니다.
//
// ── 2026-08 정직성 감사 반영 ──
// #2  등급 임계값이 히어로와 추이 기록 탭에 각각 박혀 있어 같은 점수가 다른 등급으로
//     표기되던 문제(61점 → "높음 수준" vs "보통 구간")를 제거했습니다.
//     점수를 등급으로 바꾸는 곳은 levelForScore() 하나뿐이며, 히어로 배지·CP 배지·
//     추이 바·요약 문구가 전부 이 함수 하나만 호출합니다.
// #6  '지정학' CP 제거 — 유가·금이라는 원자재 CP 와 동일한 입력만 쓰고 있어 지표 개수만
//     늘리는 중복이었습니다(둘 다 100점 포화 · 근거 문구 동일). 독립적인 지정학 데이터
//     소스가 없으므로 새 입력을 지어내지 않고 원자재로 통합했습니다.
//     원자재 CP 의 고정 달러 앵커($70 유가 / $2,500 금)도 함께 정리 — 앵커는 시간이 지나면
//     영구 포화되어 등급이 의미를 잃으므로, 앵커 없이 당일 변동률(실측)로 산출합니다.
// #12 통화정책 CP 의 '금리인하 확률 %' 삭제 — 장단기 스프레드를 선형 변환한 값을 확률처럼
//     표기한 근거 없는 수치였습니다. 등급·상태 문구·추세를 모두 같은 점수 하나에서
//     파생시켜(cp() 조립기) "낮음 / ↗악화 / 완화 전환" 같은 모순 조합이 생길 수 없게 했습니다.
//     추세는 스냅샷 규칙이 아니라 localStorage 실측 이력(직전 기록일 점수) 대비 변화입니다.
//
// ── 2026-08-13 재감사 반영 (위 수정의 잔여 결함) ──
// #A CP7 '유동성' 제거 → 6-Point. 고유 입력이 0개였습니다(vix·irx·dxy 전부 CP1·CP2·CP4 의
//    재조합). #6 에서 '지정학' 을 지운 기준을 그대로 적용했습니다. 동시에 CP3 의 VIX 항도
//    제거해 VIX 3중 계상(CP1·CP3·CP7)을 CP1 1회로 줄였습니다 — 종합 점수가 한 입력에
//    편중되던 문제와 CRITICAL 보너스 중복 발생을 함께 없앱니다.
// #B CP3 문구 귀속 정정 — VIX 항이 점수의 절반을 차지하면서 문구는 원인을 무조건
//    '장기금리'로 돌려, 10Y 3.5%·곡선 정상인데 "장기금리 부담 큼" 이 뜨던 모순을 제거했습니다.
//    이제 CP3 는 금리·곡선만 쓰고, 문구는 드라이버 기준(곡선 역전 시 앞에 명시)으로 만듭니다.
// #C CP2 의 '10Y 수익률' 지표·헤드라인 문구 삭제 — 점수 산출에 쓰이지 않는 값이 근거처럼
//    노출되던 문제(CP1 공포·탐욕 제거와 동일 사유)이자 CP3 지표와 완전 중복이었습니다.
// #D 등급 밴드 통일(#2)의 부작용으로 조용히 이동한 CP1·CP2 의 등급 경계를 점수식 재보정으로
//    되돌렸습니다. 각 CP 의 도메인 임계값이 밴드 경계(35/55/75)에 정확히 오도록 구간선형
//    보간(bandScore)을 씁니다 — 밴드만 통일하고 점수식을 두면 등급이 한 단계씩 인플레됩니다.
// #E 지표 점 색을 '등급 파생'에서 '그 지표 자신의 값 기준'으로 되돌렸습니다. 10Y 3.50% 에
//    빨간 점이 붙던 허위 신호가 사라집니다. CP5 원자재는 품목별 기여도를 같은 밴드에 대입해
//    칠하므로, 빨간 점이 켜지면 카드 등급도 반드시 '높음' 이상이 됩니다(문구와 불일치 불가).
// #F 추세 툴팁에 기준 기록일을 명시하고, 직전 기록이 7일을 넘게 지난 경우에는 추세를
//    표시하지 않습니다(이력은 '방문한 날'에만 쌓이므로 '어제 대비'로 오독됩니다).
// #G CP4 의 중복 지표('USD/KRW' + '원화 당일'이 같은 값·같은 판정) 통합.
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
// 가격뿐 아니라 '당일 변동률'까지 등급 산출에 직접 쓰는 심볼 —
// 변동률이 없으면 역시 등급을 만들지 않고 '데이터 없음'으로 처리합니다.
const CHANGE_REQUIRED = new Set(["^GSPC", "CL=F", "GC=F", "HG=F", "USDKRW=X"]);

// ── 리스크 점수 실측 이력 저장 키 (이 브라우저 localStorage, 30일 롤링) ──
// v2: 2026-08 감사로 CP 구성(지정학 제거)과 점수 정의가 바뀌어 v1 기록과 같은 축에서
//     비교할 수 없으므로 키를 분리했습니다 (다른 정의의 점수를 한 차트에 섞지 않습니다).
// v3: 재감사로 CP 구성(유동성 제거)과 점수식(밴드 재보정·VIX 중복 계상 제거)이 다시 바뀌어
//     v2 기록과 같은 축에서 비교할 수 없으므로 키를 또 분리했습니다.
const HIST_KEY = "zepta:riskmap:history:v3";
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
    return parsed
      .filter(h => h && typeof h.d === "string" && h.scores && typeof h.scores === "object")
      .sort((a, b) => (a.d < b.d ? -1 : 1));
  } catch {
    return [];
  }
}

// ── 점수 → 등급 (단일 매핑) ──
// 이 파일에서 점수를 등급으로 바꾸는 곳은 여기 하나뿐입니다. 히어로·CP 배지·추이 바·
// 요약 문구가 모두 이 함수를 호출하므로 같은 점수가 다른 등급으로 표기될 수 없습니다. (감사 #2)
function levelForScore(s) {
  return s >= 75 ? "CRITICAL" : s >= 55 ? "HIGH" : s >= 35 ? "MODERATE" : "LOW";
}
const clampScore = (v) => Math.max(0, Math.min(100, Math.round(v)));
// 점수 → 지표 점 색 (CP5 원자재의 품목별 기여도 판정에 사용합니다)
const statusOfLevel = (lv) => (lv === "CRITICAL" || lv === "HIGH" ? "danger" : lv === "MODERATE" ? "warn" : "ok");

// ── 도메인 임계값을 등급 밴드에 맞추는 구간선형 보간 ──
// 밴드를 levelForScore() 하나로 통일(감사 #2)하면서 옛 점수식을 그대로 두면, 같은 시장
// 상태의 등급이 한 단계씩 올라갑니다(예: VIX 22 가 '중립'→'높음'). 그래서 각 CP 가 원래
// 쓰던 도메인 임계값이 밴드 경계(35/55/75)에 정확히 놓이도록 앵커를 두고 그 사이를 선형
// 보간합니다. (재감사 #D)
// anchors 는 [입력값, 점수] 오름차순이며, 양 끝 바깥은 가장 가까운 구간의 기울기로 연장합니다.
// 음수는 0 으로 막습니다 — 한 항목이 '마이너스 기여'로 다른 항목의 위험을 상쇄하면 안 됩니다.
// (상단은 다른 항목과 합산한 뒤 clampScore() 가 100 으로 잘라냅니다)
function bandScore(x, anchors) {
  if (!Number.isFinite(x)) return 0;
  let i = 0;
  while (i < anchors.length - 2 && x > anchors[i + 1][0]) i += 1;
  const [x0, y0] = anchors[i];
  const [x1, y1] = anchors[i + 1];
  return Math.max(0, y0 + ((x - x0) * (y1 - y0)) / (x1 - x0));
}

// 각 표의 35 / 55 / 75 지점이 곧 '중립 / 높음 / 위험' 의 시작점입니다.
// 지표 점 색(status)도 아래와 같은 임계값을 쓰므로 배지와 점이 어긋나지 않습니다.
const VIX_BANDS = [[10, 0], [18, 35], [25, 55], [30, 75], [45, 100]];      // 변동성지수
const IRX_BANDS = [[0, 0], [4, 35], [5, 55], [6, 75], [8, 100]];           // 13주 국채금리(%)
const TNX_BANDS = [[1, 0], [4, 35], [4.5, 55], [5, 75], [6, 100]];         // 10년 국채금리(%)
const DXY_BANDS = [[95, 0], [103, 35], [106, 55], [110, 75], [118, 100]];  // 달러인덱스

// ── 추세: 규칙이 아니라 '실측 이력'에서만 나옵니다 ──
// 직전 기록일의 같은 CP 점수와 비교한 변화이며, 기록이 없으면 null(화면에는 '추세 대기').
// 스냅샷 값으로 추세를 단정하지 않으므로 등급과 추세가 어긋나는 조합이 생기지 않습니다. (감사 #12)
const TREND_EPS = 2; // ±2점 미만은 반올림 노이즈로 보고 보합 처리합니다
// 이력은 '화면을 연 날'에만 쌓이므로 직전 기록이 몇 주 전일 수 있습니다. 사용자는 추세를
// 관행적으로 '어제 대비'로 읽으므로, 기준일이 이 일수를 넘으면 추세를 표시하지 않습니다. (재감사 #F)
const TREND_MAX_GAP_DAYS = 7;
function makeTrend(score, prev) {
  if (!Number.isFinite(score) || !Number.isFinite(prev)) return { trend: null, delta: null };
  const d = Math.round(score - prev);
  return { trend: d >= TREND_EPS ? "악화" : d <= -TREND_EPS ? "개선" : "보합", delta: d };
}

// "YYYY-MM-DD" 두 개의 일수 차 (파싱 실패 시 null)
function daysBetween(from, to) {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86400000);
}

// 부호 포함 퍼센트 표기
const pct = (v) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;

// CP3 장기금리 수준 문구 — 곡선 기여분을 뺀 '금리 그 자체'의 등급으로만 고릅니다. (재감사 #B)
const CP3_RATE_WORDS = {
  CRITICAL: "장기금리 부담 큼", HIGH: "장기금리 부담 확대",
  MODERATE: "장기금리 부담 보통", LOW: "장기금리 부담 낮음",
};

// ── 6-Point CP 리스크 평가 (100% 시장 데이터 기반 동적 산출) ──
// prevScores: 직전 기록일의 CP 별 점수 (없으면 null) — 추세 산출에만 사용합니다.
function assessRisks(mkt, prevScores) {
  const { vix, sp500Change, dxy, fearGreed, tnx, fvx, irx,
    wti, wtiChg, gold, goldChg, copper, copperChg, usdkrw, krwChg } = mkt;

  // CP 조립기 — 등급·상태 문구·추세가 모두 '점수 하나'에서 파생됩니다.
  // phrases 는 등급 키 사전이거나, 드라이버를 밝혀야 하는 CP(=CP3)를 위한 함수입니다.
  // 어느 쪽이든 배지와 같은 점수에서 출발하므로 배지와 서술이 어긋날 수 없습니다. (감사 #2/#12)
  const cp = (id, name, icon, rawScore, phrases, facts, metrics, impact) => {
    const score = clampScore(rawScore);
    const severity = levelForScore(score);
    const { trend, delta } = makeTrend(score, prevScores?.[id]);
    return {
      id, name, icon, score, severity,
      headline: `${facts} · ${typeof phrases === "function" ? phrases(severity) : phrases[severity]}`,
      keyMetrics: metrics,
      impact, trend, trendDelta: delta,
    };
  };

  // ── CP1: 매크로 (VIX 수준 + 당일 S&P 낙폭) ──
  // VIX 를 쓰는 CP 는 여기 하나뿐입니다 — 이전에는 CP3·CP7 에서도 재사용해 종합 점수가
  // 한 입력에 편중됐습니다. (재감사 #A)
  const cp1 = cp("CP1", "매크로", "📊",
    bandScore(vix, VIX_BANDS) + Math.max(0, -sp500Change * 10),
    { CRITICAL: "변동성 급등", HIGH: "변동성 경고", MODERATE: "경계 구간", LOW: "안정권" },
    `VIX ${vix.toFixed(1)} · S&P ${pct(sp500Change)}`,
    [
      { label: "VIX", value: vix.toFixed(1), status: vix >= 25 ? "danger" : vix >= 18 ? "warn" : "ok" },
      { label: "S&P 500", value: pct(sp500Change), status: sp500Change < -1 ? "danger" : sp500Change < 0 ? "warn" : "ok" },
    ],
    "전 섹터 변동성에 영향");

  // ── CP2: 통화정책 (단기 국채금리 수준) ──
  // 13주 T-Bill(IRX)은 정책금리와 거의 같이 움직이는 초단기 시장금리입니다.
  // 이전 버전의 '금리인하 확률 %'는 장단기 스프레드를 선형 변환한 값을 확률처럼
  // 표기한 것이라 삭제했습니다 — 인하 확률을 산출할 수 있는 데이터(금리선물)가 없습니다.
  // 장기금리·곡선(장단기 스프레드) 해석은 전부 CP3 채권시장이 담당하므로, 점수에 쓰지 않는
  // 10Y 를 근거처럼 노출하던 지표·문구도 제거했습니다. (재감사 #C)
  const cp2 = cp("CP2", "통화정책", "🏦",
    bandScore(irx, IRX_BANDS),
    { CRITICAL: "단기금리 부담 큼", HIGH: "단기금리 부담 확대", MODERATE: "단기금리 부담 보통", LOW: "단기금리 부담 낮음" },
    `13주 국채금리 ${irx.toFixed(2)}%`,
    [
      { label: "13주 국채금리", value: `${irx.toFixed(2)}%`, status: irx >= 5 ? "danger" : irx >= 4 ? "warn" : "ok" },
    ],
    "금리 민감 종목(리츠·유틸)에 영향");

  // ── CP3: 채권시장 (장기금리 수준 + 수익률 곡선) ──
  // VIX 항을 제거해 순수 금리·곡선 CP 로 정리했습니다(변동성은 CP1 이 담당).
  // 문구는 드라이버를 그대로 밝힙니다 — 금리 수준 문구는 곡선 기여분을 뺀 금리 점수에서
  // 고르고, 곡선이 역전이면 앞에 명시합니다. (재감사 #B)
  const termSpread = tnx - irx;   // 10Y − 13W
  const yieldSpread = tnx - fvx;  // 10Y − 5Y
  const inverted = termSpread < 0;
  // 역전일 때는 문구가 '곡선 역전'을 직접 말하므로 괄호 표기를 중복해서 붙이지 않습니다.
  const curveNote = inverted ? "" : termSpread < 0.5 ? "(플랫)" : "(정상)";
  const tnxScore = bandScore(tnx, TNX_BANDS);
  const rateWord = CP3_RATE_WORDS[levelForScore(clampScore(tnxScore))];
  // 역전은 그 자체가 경고 신호이므로 금리 수준이 낮아도 최소 '중립' 밴드를 지킵니다 —
  // 10Y−13W 지표에 빨간 점이 켜졌는데 카드만 '낮음'(안전해 보이는 초록)인 조합을 막습니다.
  const cp3Raw = inverted ? Math.max(35, tnxScore + 20) : tnxScore;
  const cp3 = cp("CP3", "채권시장", "📉",
    cp3Raw,
    () => (inverted ? `곡선 역전 · ${rateWord}` : rateWord),
    `10Y ${tnx.toFixed(2)}% · 10Y−13W ${(termSpread * 100).toFixed(0)}bp${curveNote}`,
    [
      { label: "10Y 수익률", value: `${tnx.toFixed(2)}%`, status: tnx >= 4.5 ? "danger" : tnx >= 4 ? "warn" : "ok" },
      { label: "10Y−13W", value: `${(termSpread * 100).toFixed(0)}bp`, status: inverted ? "danger" : termSpread < 0.3 ? "warn" : "ok" },
      { label: "10Y−5Y", value: `${(yieldSpread * 100).toFixed(0)}bp`, status: Math.abs(yieldSpread) > 0.5 ? "warn" : "ok" },
    ],
    "성장주 밸류에이션 하방 압력");

  // ── CP4: 환율 (달러인덱스 수준 + 원화 당일 약세폭) ──
  // 헤드라인과 똑같은 값을 두 번 반복하던 '원화 당일' 지표는 USD/KRW 하나로 합쳤습니다. (재감사 #G)
  const krwStatus = krwChg > 0.6 ? "danger" : krwChg > 0.2 ? "warn" : "ok";
  const cp4 = cp("CP4", "환율", "💱",
    bandScore(dxy, DXY_BANDS) + Math.max(0, krwChg) * 6,
    { CRITICAL: "달러 강세 압박 큼", HIGH: "달러 강세 압박", MODERATE: "달러 강세 진행", LOW: "달러 부담 낮음" },
    `DXY ${dxy.toFixed(1)} · USD/KRW ₩${usdkrw.toFixed(0)} ${pct(krwChg)}`,
    [
      { label: "DXY", value: dxy.toFixed(1), status: dxy >= 106 ? "danger" : dxy >= 103 ? "warn" : "ok" },
      { label: "USD/KRW", value: `₩${usdkrw.toFixed(0)} (${pct(krwChg)})`, status: krwStatus },
    ],
    "수출주·해외매출 비중 높은 종목에 영향");

  // ── CP5: 원자재 (구 '지정학' CP 통합) ──
  // 고정 달러 앵커 대신 당일 변동률로 '가격 충격' 강도를 산출합니다.
  // (앵커 방식은 금 $4,000대처럼 물가·환경이 바뀌면 매일 100점으로 포화되어 등급이 무의미해집니다)
  // 점수 = 품목별 기여도 합계 + 최대 기여도. 최대 기여도를 한 번 더 더하는 이유는, 한 품목만
  // 급변한 날(예: WTI +3.8%)이 '변동 완만'으로 서술되면서 그 품목 점만 빨갛게 켜지던 모순을
  // 없애기 위해서입니다. 지표 점은 '그 품목만 움직였을 때의 카드 점수(기여도×2)'를 같은 밴드에
  // 대입해 칠하므로, 카드 점수 ≥ 기여도×2 관계상 빨간 점이 켜지면 카드도 반드시 '높음' 이상입니다.
  // (재감사 #E)
  const commodities = [
    { label: "WTI", value: `$${wti.toFixed(1)}`, part: Math.abs(wtiChg) * 6 },
    { label: "금", value: `$${gold.toFixed(0)}`, part: Math.abs(goldChg) * 7.5 },
    { label: "구리", value: `$${copper.toFixed(2)}`, part: Math.abs(copperChg) * 6 },
  ];
  const cmdtSum = commodities.reduce((a, c) => a + c.part, 0);
  const cmdtMax = Math.max(...commodities.map(c => c.part));
  const cp5 = cp("CP5", "원자재", "🛢️",
    cmdtSum + cmdtMax,
    { CRITICAL: "가격 충격 큼", HIGH: "변동 확대", MODERATE: "변동 보통", LOW: "변동 완만" },
    `당일 WTI ${pct(wtiChg)} · 금 ${pct(goldChg)} · 구리 ${pct(copperChg)}`,
    commodities.map(c => ({
      label: c.label, value: c.value,
      status: statusOfLevel(levelForScore(clampScore(c.part * 2))),
    })),
    "인플레 기대·에너지/소재 섹터에 영향");

  // ── CP6: 투자심리 ──
  // 공포·탐욕 지수가 없으면 임의 대체값(50) 대신 '데이터 없음'으로 정직하게 처리하고
  // 종합 점수 산출에서 제외합니다.
  const cp6 = fearGreed != null
    ? cp("CP6", "투자심리", "🧠",
      100 - fearGreed - Math.max(0, sp500Change * 5),
      { CRITICAL: "심리 극도 위축", HIGH: "심리 위축", MODERATE: "심리 중립", LOW: "심리 양호" },
      `공포·탐욕 ${fearGreed} · S&P ${pct(sp500Change)}`,
      [
        // 지표 점은 공포·탐욕 지수 자신의 값 기준 (25 이하 극단적 공포 / 45 이하 공포)
        { label: "공포·탐욕", value: `${fearGreed}`, status: fearGreed <= 25 ? "danger" : fearGreed <= 45 ? "warn" : "ok" },
        { label: "S&P 추세", value: pct(sp500Change), status: sp500Change < -1 ? "danger" : sp500Change < 0 ? "warn" : "ok" },
      ],
      "위험자산 선호도(투자 심리)에 영향")
    : {
      // 공포·탐욕 지수 미수신 — 대체값 없이 '데이터 없음'으로 표시하고 종합 산출에서 제외합니다
      id: "CP6", name: "투자심리", icon: "🧠",
      noData: true, severity: null, score: null,
      headline: "공포·탐욕 지수 미수신 — 등급 산출에서 제외됩니다",
      keyMetrics: [],
      impact: null,
      trend: null, trendDelta: null,
    };

  // ── (삭제) CP7 유동성 ──
  // vix·irx·dxy 만 쓰고 고유 입력이 하나도 없어(각각 CP1·CP2·CP4 와 동일 입력) 지표 개수만
  // 늘리는 재조합이었습니다. '지정학' CP 를 지운 것과 같은 기준으로 제거했습니다.
  // 유동성만의 고유 입력(크레딧 스프레드·VIX 기간구조)을 수집하게 되면 그때 되살립니다.
  // 없는 입력을 지어내거나 기존 입력을 다시 섞어 CP 개수를 채우지 않습니다. (재감사 #A)

  return [cp1, cp2, cp3, cp4, cp5, cp6];
}

function calcOverall(risks) {
  // '데이터 없음' CP 는 종합 점수 산출에서 제외합니다
  const scored = risks.filter(r => !r.noData);
  if (scored.length === 0) return { score: 0, level: "LOW", crit: 0 };
  const avg = scored.reduce((a, r) => a + r.score, 0) / scored.length;
  const crit = scored.filter(r => r.severity === "CRITICAL").length;
  const score = clampScore(avg + crit * 5);
  // 등급은 '화면에 표시되는 점수'에서 파생시킵니다 — 반올림 전 값으로 등급을 매기면
  // 표시 점수와 등급이 경계에서 어긋납니다. (감사 #2)
  return { score, level: levelForScore(score), crit };
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
    if (CHANGE_REQUIRED.has(sym) && !Number.isFinite(item.change)) return true;
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
      wtiChg: find("CL=F")?.change ?? null,
      gold: find("GC=F")?.price ?? null,
      goldChg: find("GC=F")?.change ?? null,
      copper: find("HG=F")?.price ?? null,
      copperChg: find("HG=F")?.change ?? null,
      usdkrw: find("USDKRW=X")?.price ?? null,
      krwChg: find("USDKRW=X")?.change ?? null,
    };
  }, [marketIndices, fearGreed]);

  // 오늘 이전에 기록된 가장 최근 이력 — 추세(직전 기록일 대비)의 유일한 근거입니다.
  // 오늘 항목을 제외하므로 오늘 기록이 적재되어도 값이 흔들리지 않습니다.
  const todayKey = localDateKey();
  const prevEntry = useMemo(() => {
    const prior = history.filter(h => h.d < todayKey);
    return prior.length > 0 ? prior[prior.length - 1] : null;
  }, [history, todayKey]);
  // 기준일이 며칠 전인지 — 이력은 '화면을 연 날'에만 쌓이므로 직전 기록이 몇 주 전일 수 있습니다.
  // 7일을 넘으면 '어제 대비'로 오독될 여지가 커서 추세를 표시하지 않습니다. (재감사 #F)
  const prevGap = useMemo(() => (prevEntry ? daysBetween(prevEntry.d, todayKey) : null), [prevEntry, todayKey]);
  const trendStale = !prevEntry || !Number.isFinite(prevGap) || prevGap > TREND_MAX_GAP_DAYS;
  const prevScores = trendStale ? null : prevEntry.scores;

  // 필수 시세가 모두 있을 때만 등급을 산출합니다
  const risks = useMemo(() => (isComplete ? assessRisks(mkt, prevScores) : []), [isComplete, mkt, prevScores]);
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
  // 추세 툴팁 — 어느 날짜 기록과 비교한 값인지까지 밝힙니다 (재감사 #F)
  const trendTitle = (risk) => {
    if (risk.trend) return `${shortDate(prevEntry.d)} 기록 대비 ${risk.trendDelta > 0 ? "+" : ""}${risk.trendDelta}점 (오늘 기준)`;
    if (prevEntry && trendStale) return `직전 기록이 ${prevGap}일 전(${shortDate(prevEntry.d)})이라 추세를 표시하지 않습니다`;
    if (prevEntry) return `${shortDate(prevEntry.d)} 기록에 이 항목 점수가 없어 추세를 표시하지 않습니다`;
    return "직전 기록일이 없어 추세를 표시하지 않습니다";
  };

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
      리스크 점수는 VIX, 국채 수익률, 공포·탐욕 지수, 달러 인덱스, 원자재 가격·변동률 등 공개 시장 데이터를 기반으로
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
                      {/* 추세는 실측 이력이 있을 때만 — 없으면 단정하지 않고 '추세 대기' */}
                      <span title={trendTitle(risk)}
                        style={{ fontSize: "11px", fontWeight: 700, color: risk.trend ? trendColor(risk.trend) : C.text4 }}>
                        {risk.trend === "악화" ? "↗ 악화" : risk.trend === "개선" ? "↘ 개선" : risk.trend === "보합" ? "→ 보합" : "추세 대기"}
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
                    {/* 핵심 지표 — 근거가 하나뿐인 CP(통화정책)는 한 칸으로 꽉 채웁니다 */}
                    <div style={{ display: "grid",
                      gridTemplateColumns: risk.keyMetrics.length === 1 ? "1fr" : isMobile ? "repeat(2, 1fr)" : "repeat(3, 1fr)",
                      gap: isMobile ? "6px" : "8px", marginBottom: "10px" }}>
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
                    <span style={{ fontSize: "11px", fontWeight: 700, color: risk.trend ? trendColor(risk.trend) : C.text4 }}
                      title={trendTitle(risk)} aria-label={risk.trend ? `추세 ${risk.trend}` : "추세 기록 대기"}>
                      {risk.trend === "악화" ? "▲" : risk.trend === "개선" ? "▼" : risk.trend === "보합" ? "−" : "·"}
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
                // 등급 표기는 히어로와 동일한 levelForScore() 결과(ov)만 사용합니다 — 임계값 이원화 금지 (감사 #2)
                { color: ov.hi, text: `종합 리스크 ${overall.score}점 — ${ov.label} 수준` },
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
