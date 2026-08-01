// ════════════════════════════════════════════════════════════════════
// Zepta 자체 지수 3호~6호 — 펀딩 스퀴즈 / 알트 과열 / 국내증시 온도 / 환율 압력
// (계산 공유 모듈)
// ────────────────────────────────────────────────────────────────────
// 2026-07-30 (정보 피벗 2차): 마켓 온도(1호, market-temp.js)와 동일한 패턴으로
// 순수 계산 함수 + KV 10분 캐시 게터를 제공합니다.
// 2026-08-02 (주식+코인 양축 확장, 대표 지시): 코인 편중을 해소하기 위해
//   주식 축 지수 2종(5호 국내증시 온도 · 6호 환율 압력 지수)을 같은 패턴으로 신설.
// 사용처: api/indicators/summary.js (지표 허브 집계 API), api/index-page.js (공개 페이지).
//
// ── 지수 3호: 펀딩 스퀴즈 지수 (0~100) ─────────────────────────────
// 유니버스 펀딩비 분포에서 "숏 포지션 과밀 정도"를 요약합니다. 50=중립,
// 70 이상 "숏 과밀(스퀴즈 잠재)", 30 이하 "롱 과밀". 값이 높을수록 음수
// 펀딩(숏이 롱에게 지불) 쪽으로 쏠려 있다는 뜻입니다.
//
// 산식 (재현 가능성을 위해 명시 — 구성요소는 스펙 3요소: 음수 비율·극단 음수·평균):
//   EXT  = ±0.05%/8h (통상 기본 펀딩 0.01% 의 5배 = 뚜렷한 쏠림, market-temp 와 동일 기준)
//   BASE_NEG = 0.25 — 통상 시장의 음수 펀딩 비율 기준선.
//     (무기한 선물 펀딩은 기본 +0.01% 양수 구조라 평시에도 음수 비율이 10~30% 존재.
//      2026-07-30 바이낸스 전 심볼 실측 ~20%. 50% 를 중립으로 잡으면 평시가
//      '롱 과밀'로 오라벨되므로 통상치 25% 를 중립 기준선으로 사용.)
//   negRatio    = 펀딩비 < 0 심볼 비율          (USDT 마진만, 0~1)
//   extNegRatio = 펀딩비 ≤ −EXT 심볼 비율
//   extPosRatio = 펀딩비 ≥ +EXT 심볼 비율       (롱 과밀 대칭 감산용)
//   avg         = 평균 펀딩비
//   value = clamp( 50
//                 + clamp((negRatio − BASE_NEG) × 80, −40, 40) ← 음수 비율 편차 (기여 ±40)
//                 + min(extNegRatio × 150, 15)     ← 극단 음수 가산 (cap 15)
//                 − min(extPosRatio × 150, 15)     ← 극단 양수 감산 (cap 15, 대칭)
//                 + clamp(−avg ÷ EXT, −1, 1) × 10  ← 평균 펀딩의 음수 정도 (±10)
//                 , 0, 100 )
//   → 전 심볼 음수·극단 다수·평균 −0.05% 면 100, 통상 시장(음수 ~25%·평균 ≈0)이면 50 부근,
//     전 심볼 양수 극단(롱 과밀)이면 0 근처. 표본 10개 미만이면 null (부분 데이터로 조작 금지).
//
// ── 지수 4호: 알트 과열 지수 (0~100) ───────────────────────────────
// BTC 를 제외한 알트의 신호 우위가 BTC 대비 얼마나 달아올랐는지 요약합니다.
// 라벨: 30 이하 냉각 / 70 이상 과열 / 그 외 중립.
//
// 산식 (가용 구성요소만 가중 재정규화 — market-temp 와 동일 방식):
//   재료: di:signals:realtime-pool-mtf (btc-cron 멀티TF 종합 스코어 풀 — 심볼당
//         최신 1건·4h cutoff 정규화는 market-temp.computeBreadthFromPool 재사용)
//   altLongRatio = 알트 중 LONG 우위 비율                       → breadth (가중 0.40)
//   altAvgSigned = 알트 평균 부호 스코어 (−100~+100)             → avg     (가중 0.30)
//   gap = altAvgSigned − btcSigned (BTC 부호 스코어와의 격차)     → gap     (가중 0.20)
//         gapScore = clamp(50 + gap × 0.5, 0, 100)  — BTC 풀 부재 시 제외
//   altVolShare = 1 − BTC 거래대금 ÷ 유니버스 총 거래대금          → vol     (가중 0.10)
//         (di:signals:futures-universe 의 24h quoteVolume. MTF 풀에는 거래대금이
//          없음을 실측 확인 — 유니버스 KV 부재 시 이 항목 제외)
//         volScore = clamp(50 + (altVolShare − 0.65) × 250, 0, 100)
//         (상위 50 선물 유니버스에서 알트 비중 0.65 부근이 통상 — 그 이상이면 과열 방향)
//   value = Σ(가중 × 점수) ÷ Σ(가중)   — 알트 표본 5개 미만이면 null (조작 금지)
//
// ── 지수 5호: 국내증시 온도 (0~100) ───────────────────────────────
// 국내 증시(코스피·코스닥)의 하루 체감 온도를 0~100 한 숫자로 요약합니다.
// 라벨은 마켓 온도(1호)와 동일 체계: ≤20 냉각 / ≤40 위축 / ≤60 중립 / ≤80 가열 / >80 과열.
//
// 산식 (가용 구성요소만 가중 재정규화 — market-temp 와 동일 방식):
//   ① index   (가중 0.40) — 코스피·코스닥 등락률 평균
//        chgPct = 최근 일봉 종가 대비 직전 일봉 종가의 변화율(%). 두 지수 중
//        가용한 것만 평균(하나만 있어도 계산). 둘 다 없으면 이 항목 제외.
//        idxScore = clamp(50 + avgChgPct × 12.5, 0, 100)
//        → ±4% 에서 0/100 포화 (국내 지수 일간 변동의 사실상 상단).
//   ② breadth (가중 0.40) — 국내 대표 30종목(KR_BREADTH_UNIVERSE) 상승 비율
//        upRatio = 직전 종가 대비 상승한 종목 수 ÷ 유효 종목 수
//        breadthScore = upRatio × 100
//        유효 종목 10개 미만이면 이 항목 제외 (부분 데이터로 조작 금지).
//   ③ fng     (가중 0.20) — 주식 공포·탐욕 (CNN, 실패 시 VIX 근사)
//        fngScore = 값 그대로 (0~100).
//        ※ CNN/VIX 는 미국 지수 기반이라 '국내' 지표가 아닙니다. 국내 증시는
//          외국인 수급을 통해 글로벌 위험선호에 강하게 연동돼 온 점을 반영해
//          보조 항목(가중 0.20)으로만 사용하고, detail 에 출처를 명시합니다.
//   value = Σ(가중 × 점수) ÷ Σ(가중)  — 전 구성요소 결측이면 null (값 조작 금지)
//
// 데이터 소스: Yahoo Finance (인증 불필요 공개 엔드포인트 — 2026-08-02 curl 실측)
//   지수:   GET /v8/finance/chart/%5EKS11 · %5EKQ11 ?interval=1d&range=5d
//   브레드스: GET /v7/finance/spark?symbols=...&range=5d&interval=1d
//            (심볼 20개 상한 실측 — 21개 이상 400 Bad Request → 20개씩 분할)
//
// ── 지수 6호: 환율 압력 지수 (0~100) ──────────────────────────────
// 원/달러 환율의 '수준'과 '속도'를 합쳐 원화 약세 압력을 0~100 으로 요약합니다.
// 고환율·급등일수록 값이 높고, 국내 증시에서는 외국인 수급 부담 요인으로
// 관찰돼 온 맥락입니다. 라벨: ≥70 원화 약세 압력 / ≤30 원화 강세 / 그 외 중립.
//
// 산식 (가용 구성요소만 가중 재정규화):
//   ① level (가중 0.50) — 최근 1년 일봉 종가 분포 내 현재 환율의 백분위 × 100
//        (52주 신고가 부근이면 100, 신저가 부근이면 0)
//   ② chg20 (가중 0.30) — 20거래일 변화율 → clamp(50 + chg20Pct × 10, 0, 100)
//        → ±5% 에서 포화
//   ③ chg5  (가중 0.20) — 5거래일 변화율  → clamp(50 + chg5Pct × 25, 0, 100)
//        → ±2% 에서 포화
//   종가 표본 60개 미만이면 null (백분위가 의미를 갖지 못함 — 조작 금지)
//
// 데이터 소스: GET /v8/finance/chart/USDKRW=X?interval=1d&range=1y (Yahoo, 실측 확인)
//
// KV 캐시: 각 10분 (btc-cron 갱신 주기 스케일과 동일). 결측 시 ok:false — 값 조작 금지.
// ════════════════════════════════════════════════════════════════════

import { computeBreadthFromPool } from "./market-temp.js";
import { getMarketContext } from "./binance-client.js";

const MTF_POOL_KEY = "di:signals:realtime-pool-mtf";
const UNIVERSE_KEY = "di:signals:futures-universe";
const FS_CACHE_KEY = "di:index:funding-squeeze-cache";
const AH_CACHE_KEY = "di:index:alt-heat-cache";
const KRT_CACHE_KEY = "di:index:kr-market-temp-cache"; // 5호
const FXP_CACHE_KEY = "di:index:fx-pressure-cache";    // 6호
const CACHE_TTL_MS = 10 * 60 * 1000; // 10분
const FUNDING_EXT = 0.0005; // ±0.05%/8h — 극단 펀딩 기준 (market-temp 와 동일)
const BASE_NEG_RATIO = 0.25; // 통상 시장의 음수 펀딩 비율 기준선 (상단 산식 주석 참조)

// ── Yahoo Finance 공개 엔드포인트 (인증 불필요 — fetchStockFearGreed 의 VIX 폴백과 동일 경로) ──
const YF_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
const YF_SPARK_MAX = 20; // 심볼 상한 실측치 (21개 이상 → 400 "less than or equal to 20")
const KOSPI_SYMBOL = "^KS11";
const KOSDAQ_SYMBOL = "^KQ11";
const USDKRW_SYMBOL = "USDKRW=X";

/**
 * 국내증시 브레드스 유니버스 — 코스피 22 + 코스닥 8 (시총·거래대금 상위 대표주).
 * src/App.jsx 의 KR_ASSETS 상위 종목에서 발췌해 20개씩 2회 spark 호출로 커버합니다.
 * (전 종목 상승/하락 집계 API 가 없어 대표 표본으로 근사 — detail 에 표본 수 명시)
 */
export const KR_BREADTH_UNIVERSE = [
  // 코스피 대형주
  "005930.KS", "000660.KS", "373220.KS", "207940.KS", "005380.KS",
  "000270.KS", "068270.KS", "035420.KS", "035720.KS", "051910.KS",
  "006400.KS", "066570.KS", "105560.KS", "055550.KS", "086790.KS",
  "316140.KS", "012330.KS", "096770.KS", "017670.KS", "028260.KS",
  "259960.KS", "018260.KS",
  // 코스닥 대표주
  "086520.KQ", "403870.KQ", "240810.KQ", "357780.KQ",
  "196170.KQ", "140860.KQ", "039030.KQ", "005290.KQ",
];

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;

/** 펀딩 스퀴즈 지수 → 상태 라벨 (행동 지시 아님 — 상태 서술만) */
export function fundingSqueezeLabel(value) {
  if (value >= 70) return "숏 과밀(스퀴즈 잠재)";
  if (value <= 30) return "롱 과밀";
  return "중립";
}

/** 알트 과열 지수 → 상태 라벨 */
export function altHeatLabel(value) {
  if (value >= 70) return "과열";
  if (value <= 30) return "냉각";
  return "중립";
}

/** 국내증시 온도 → 상태 라벨 (마켓 온도 1호와 동일 5단계 체계) */
export function krMarketTempLabel(value) {
  if (value <= 20) return "냉각";
  if (value <= 40) return "위축";
  if (value <= 60) return "중립";
  if (value <= 80) return "가열";
  return "과열";
}

/** 환율 압력 지수 → 상태 라벨 (행동 지시 아님 — 상태 서술만) */
export function fxPressureLabel(value) {
  if (value >= 70) return "원화 약세 압력";
  if (value <= 30) return "원화 강세";
  return "중립";
}

/**
 * 지수 3호 실계산 (순수 함수 — 단위 테스트 주입 지점).
 * @param {Object<string, number>} fundingMap 심볼→펀딩비 (getMarketContext().funding 형식)
 * @returns {{value:number, label:string, components:object}|null} 표본 부족 시 null
 */
export function computeFundingSqueeze(fundingMap) {
  const rates = Object.entries(fundingMap || {})
    .filter(([sym]) => /USDT$/.test(sym)) // USDT 마진만 (market-temp 와 동일)
    .map(([, r]) => r)
    .filter((r) => Number.isFinite(r));
  if (rates.length < 10) return null; // 표본 부족 — 결측 처리 (조작 금지)

  const n = rates.length;
  const negRatio = rates.filter((r) => r < 0).length / n;
  const extNegRatio = rates.filter((r) => r <= -FUNDING_EXT).length / n;
  const extPosRatio = rates.filter((r) => r >= FUNDING_EXT).length / n;
  const avg = rates.reduce((s, r) => s + r, 0) / n;

  const value = Math.round(clamp(
    50
    + clamp((negRatio - BASE_NEG_RATIO) * 80, -40, 40)
    + Math.min(extNegRatio * 150, 15)
    - Math.min(extPosRatio * 150, 15)
    + clamp(-avg / FUNDING_EXT, -1, 1) * 10,
    0, 100,
  ));

  return {
    value,
    label: fundingSqueezeLabel(value),
    components: {
      negRatio: r3(negRatio),
      extNegRatio: r3(extNegRatio),
      extPosRatio: r3(extPosRatio),
      avgFundingPct: Math.round(avg * 100 * 10000) / 10000, // %/8h 단위 (예: 0.0100)
      sampled: n,
    },
  };
}

/**
 * 지수 4호 실계산 (순수 함수).
 * @param {Array} poolMtf   di:signals:realtime-pool-mtf 배열
 * @param {object|null} universe di:signals:futures-universe ({entries:[{base, quoteVolume}]}) — 없어도 계산 가능
 * @param {number} [now]
 * @returns {{value:number, label:string, components:object}|null} 알트 표본 부족 시 null
 */
export function computeAltHeat(poolMtf, universe = null, now = Date.now()) {
  const breadth = computeBreadthFromPool(poolMtf, now);
  if (!breadth || !Array.isArray(breadth.coins)) return null;

  const btc = breadth.coins.find((c) => c.asset === "BTC") || null;
  const alts = breadth.coins.filter((c) => c.asset !== "BTC");
  if (alts.length < 5) return null; // 표본 부족 — 결측 처리

  const altLongRatio = alts.filter((c) => c.side === "LONG").length / alts.length;
  const altAvgSigned = clamp(
    alts.reduce((s, c) => s + (c.side === "LONG" ? c.score : -c.score), 0) / alts.length,
    -100, 100,
  );
  const btcSigned = btc ? clamp(btc.side === "LONG" ? btc.score : -btc.score, -100, 100) : null;
  const gap = btcSigned != null ? clamp(altAvgSigned - btcSigned, -100, 100) : null;

  // 알트 거래대금 비중 — 유니버스 KV 가 있을 때만 (BTC 항목이 있어야 비중이 의미 있음)
  let altVolShare = null;
  const entries = Array.isArray(universe?.entries) ? universe.entries : [];
  if (entries.length > 0) {
    let total = 0, btcVol = 0;
    for (const e of entries) {
      const v = Number(e?.quoteVolume);
      if (!Number.isFinite(v) || v <= 0) continue;
      total += v;
      const base = String(e?.base || e?.asset || "").toUpperCase();
      if (base === "BTC" || base.startsWith("BTC/")) btcVol += v;
    }
    if (total > 0 && btcVol > 0) altVolShare = clamp(1 - btcVol / total, 0, 1);
  }

  // 가용 구성요소만 가중 재정규화 (기본 0.40 / 0.30 / 0.20 / 0.10)
  const parts = [
    { key: "breadth", weight: 0.40, score: altLongRatio * 100 },
    { key: "avg", weight: 0.30, score: (altAvgSigned + 100) / 2 },
  ];
  if (gap != null) parts.push({ key: "gap", weight: 0.20, score: clamp(50 + gap * 0.5, 0, 100) });
  if (altVolShare != null) parts.push({ key: "vol", weight: 0.10, score: clamp(50 + (altVolShare - 0.65) * 250, 0, 100) });

  const wSum = parts.reduce((s, p) => s + p.weight, 0);
  const value = Math.round(clamp(parts.reduce((s, p) => s + p.weight * p.score, 0) / wSum, 0, 100));

  return {
    value,
    label: altHeatLabel(value),
    components: {
      altCount: alts.length,
      altLongRatio: r3(altLongRatio),
      altAvgSigned: r1(altAvgSigned),
      btcSigned: btcSigned != null ? r1(btcSigned) : null,
      gap: gap != null ? r1(gap) : null,
      altVolShare: altVolShare != null ? r3(altVolShare) : null,
      usedParts: parts.map((p) => p.key),
    },
  };
}

// ════════════════════════════════════════════════════════════════════
// 지수 5호·6호 (주식 축) — 순수 계산 함수 + Yahoo 소스 어댑터
// ════════════════════════════════════════════════════════════════════

/**
 * 지수 5호 실계산 (순수 함수 — 단위 테스트 주입 지점).
 * 가용 구성요소만 가중 재정규화합니다. 전 항목 결측이면 null.
 * @param {object} input
 * @param {number|null} input.kospiChgPct   코스피 등락률(%) — 없으면 null
 * @param {number|null} input.kosdaqChgPct  코스닥 등락률(%) — 없으면 null
 * @param {{up:number, down:number, total:number}|null} input.breadth 유니버스 상승/하락 집계
 * @param {number|null} input.fngStockValue 주식 공포·탐욕 (0~100) — 없으면 null
 * @returns {{value:number, label:string, components:object}|null}
 */
export function computeKrMarketTemp({ kospiChgPct = null, kosdaqChgPct = null, breadth = null, fngStockValue = null } = {}) {
  const chgs = [kospiChgPct, kosdaqChgPct].filter((v) => Number.isFinite(v));
  const avgChgPct = chgs.length > 0 ? chgs.reduce((s, v) => s + v, 0) / chgs.length : null;

  // 브레드스는 유효 표본 10개 이상일 때만 채택 (부분 데이터로 조작 금지)
  const bTotal = Number(breadth?.total);
  const bUp = Number(breadth?.up);
  const upRatio = Number.isFinite(bTotal) && bTotal >= 10 && Number.isFinite(bUp) ? bUp / bTotal : null;

  const fng = Number.isFinite(fngStockValue) ? clamp(fngStockValue, 0, 100) : null;

  const parts = [];
  if (avgChgPct != null) parts.push({ key: "index", weight: 0.40, score: clamp(50 + avgChgPct * 12.5, 0, 100) });
  if (upRatio != null) parts.push({ key: "breadth", weight: 0.40, score: upRatio * 100 });
  if (fng != null) parts.push({ key: "fng", weight: 0.20, score: fng });
  if (parts.length === 0) return null; // 전 구성요소 결측 — 값 조작 금지

  const wSum = parts.reduce((s, p) => s + p.weight, 0);
  const value = Math.round(clamp(parts.reduce((s, p) => s + p.weight * p.score, 0) / wSum, 0, 100));

  return {
    value,
    label: krMarketTempLabel(value),
    components: {
      kospiChgPct: Number.isFinite(kospiChgPct) ? r2(kospiChgPct) : null,
      kosdaqChgPct: Number.isFinite(kosdaqChgPct) ? r2(kosdaqChgPct) : null,
      avgChgPct: avgChgPct != null ? r2(avgChgPct) : null,
      breadthUp: upRatio != null ? bUp : null,
      breadthTotal: upRatio != null ? bTotal : null,
      upRatio: upRatio != null ? r3(upRatio) : null,
      fngStock: fng,
      usedParts: parts.map((p) => p.key),
    },
  };
}

/**
 * 지수 6호 실계산 (순수 함수).
 * @param {number[]} closes 원/달러 일봉 종가 (오름차순, 최근이 마지막). 60개 미만이면 null
 * @returns {{value:number, label:string, components:object}|null}
 */
export function computeFxPressure(closes) {
  const xs = (Array.isArray(closes) ? closes : []).filter((v) => Number.isFinite(v) && v > 0);
  if (xs.length < 60) return null; // 백분위가 의미를 갖지 못하는 표본 — 결측 처리

  const last = xs[xs.length - 1];
  // ① 수준: 최근 1년(가용 표본) 종가 분포 내 백분위 (중간 순위 방식)
  //   동일값(ties)에 0.5 가중을 주는 표준 percentile rank —
  //   전 구간 같은 값(변동 없음)일 때 0 이 아니라 50(중립)이 되도록 하기 위함입니다.
  //   (단순 '미만 개수' 방식은 평탄 구간을 '원화 강세'로 오분류함 — 2026-08-02 단위검증에서 발견)
  const below = xs.filter((v) => v < last).length;
  const ties = xs.filter((v) => v === last).length - 1; // 자기 자신 제외
  const levelScore = clamp(((below + 0.5 * ties) / xs.length) * 100, 0, 100);

  // ②③ 속도: 20 / 5 거래일 변화율
  const pctBack = (n) => {
    if (xs.length <= n) return null;
    const prev = xs[xs.length - 1 - n];
    return prev > 0 ? ((last - prev) / prev) * 100 : null;
  };
  const chg20Pct = pctBack(20);
  const chg5Pct = pctBack(5);

  const parts = [{ key: "level", weight: 0.50, score: levelScore }];
  if (chg20Pct != null) parts.push({ key: "chg20", weight: 0.30, score: clamp(50 + chg20Pct * 10, 0, 100) });
  if (chg5Pct != null) parts.push({ key: "chg5", weight: 0.20, score: clamp(50 + chg5Pct * 25, 0, 100) });

  const wSum = parts.reduce((s, p) => s + p.weight, 0);
  const value = Math.round(clamp(parts.reduce((s, p) => s + p.weight * p.score, 0) / wSum, 0, 100));

  return {
    value,
    label: fxPressureLabel(value),
    components: {
      rate: r2(last),
      levelPct: Math.round(levelScore),
      chg20Pct: chg20Pct != null ? r2(chg20Pct) : null,
      chg5Pct: chg5Pct != null ? r2(chg5Pct) : null,
      low52w: r2(Math.min(...xs)),
      high52w: r2(Math.max(...xs)),
      sampled: xs.length,
      usedParts: parts.map((p) => p.key),
    },
  };
}

// ── Yahoo 소스 어댑터 (실패 시 항상 null — throw 안 함) ──

/** 단일 심볼 일봉 종가 배열. 실패 시 null. */
export async function fetchYahooCloses(symbol, { range = "5d", interval = "1d", timeoutMs = 8000 } = {}) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`;
    const resp = await fetch(url, { headers: { "User-Agent": YF_UA, Accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
    if (!resp.ok) return null;
    const json = await resp.json();
    const res = json?.chart?.result?.[0];
    const closes = (res?.indicators?.quote?.[0]?.close || []).filter((v) => Number.isFinite(v));
    return closes.length > 0 ? closes : null;
  } catch { return null; }
}

/** 종가 배열 → 직전 대비 등락률(%). 표본 2개 미만이면 null. */
function lastChgPct(closes) {
  if (!Array.isArray(closes) || closes.length < 2) return null;
  const last = closes[closes.length - 1];
  const prev = closes[closes.length - 2];
  return prev > 0 ? ((last - prev) / prev) * 100 : null;
}

/**
 * 다중 심볼 일봉 종가 — Yahoo spark (20개씩 분할). 실패한 청크는 건너뜁니다.
 * @returns {Promise<Object<string, number[]>>} 심볼 → 종가 배열
 */
export async function fetchYahooSparkCloses(symbols, { range = "5d", interval = "1d", timeoutMs = 8000 } = {}) {
  const list = (Array.isArray(symbols) ? symbols : []).filter(Boolean);
  const chunks = [];
  for (let i = 0; i < list.length; i += YF_SPARK_MAX) chunks.push(list.slice(i, i + YF_SPARK_MAX));

  const results = await Promise.allSettled(chunks.map(async (chunk) => {
    const url = `https://query1.finance.yahoo.com/v7/finance/spark?symbols=${encodeURIComponent(chunk.join(","))}&range=${range}&interval=${interval}`;
    const resp = await fetch(url, { headers: { "User-Agent": YF_UA, Accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
    if (!resp.ok) return [];
    const json = await resp.json();
    return Array.isArray(json?.spark?.result) ? json.spark.result : [];
  }));

  const out = {};
  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    for (const row of r.value) {
      const sym = row?.symbol;
      const closes = (row?.response?.[0]?.indicators?.quote?.[0]?.close || []).filter((v) => Number.isFinite(v));
      if (sym && closes.length >= 2) out[sym] = closes;
    }
  }
  return out;
}

/** spark 결과 → 상승/하락 집계 (직전 종가 대비) */
export function computeKrBreadth(closesBySymbol) {
  let up = 0, down = 0, flat = 0;
  for (const closes of Object.values(closesBySymbol || {})) {
    const chg = lastChgPct(closes);
    if (chg == null) continue;
    if (chg > 0) up++; else if (chg < 0) down++; else flat++;
  }
  const total = up + down + flat;
  return total > 0 ? { up, down, flat, total } : null;
}

// ── KV 캐시 게터 (market-temp.getMarketTempCached 와 동일 패턴) ──

async function readCache(kv, key) {
  if (!kv) return null;
  try {
    const c = await kv.get(key);
    if (c?.data?.ok && Date.now() - (c.ts || 0) < CACHE_TTL_MS) return { ...c.data, cached: true };
  } catch { /* 캐시 실패 → 실계산 */ }
  return null;
}

async function writeCache(kv, key, data) {
  if (!kv || !data?.ok) return; // 실패 결과는 캐시하지 않음 — 복구 즉시 반영
  try { await kv.set(key, { data, ts: Date.now() }, { ex: 900 }); } catch { /* 무시 */ }
}

/**
 * 펀딩 스퀴즈 지수 — KV 10분 캐시. 결측 시 { ok:false, error } (값 조작 금지).
 * deps.getFunding 으로 테스트 목 주입 가능.
 */
export async function getFundingSqueezeCached(kv, deps = {}) {
  const cached = deps.force ? null : await readCache(kv, FS_CACHE_KEY);
  if (cached) return cached;
  const getFunding = deps.getFunding || (async () => (await getMarketContext()).funding || {});
  let fundingMap = {};
  try { fundingMap = await getFunding(); } catch { fundingMap = {}; }
  const calc = computeFundingSqueeze(fundingMap);
  if (!calc) return { ok: false, error: "funding data unavailable" };
  const data = { ok: true, ...calc, updatedAt: new Date().toISOString() };
  await writeCache(kv, FS_CACHE_KEY, data);
  return data;
}

/**
 * 알트 과열 지수 — KV 10분 캐시. 결측 시 { ok:false, error }.
 * deps.getPool / deps.getUniverse 로 테스트 목 주입 가능.
 */
export async function getAltHeatCached(kv, deps = {}) {
  const cached = deps.force ? null : await readCache(kv, AH_CACHE_KEY);
  if (cached) return cached;
  const getPool = deps.getPool || (async () => (kv ? (await kv.get(MTF_POOL_KEY)) || [] : []));
  const getUniverse = deps.getUniverse || (async () => (kv ? await kv.get(UNIVERSE_KEY) : null));
  let pool = [], universe = null;
  try { pool = await getPool(); } catch { pool = []; }
  try { universe = await getUniverse(); } catch { universe = null; } // 유니버스는 선택 재료
  const calc = computeAltHeat(pool, universe, deps.now || Date.now());
  if (!calc) return { ok: false, error: "mtf pool unavailable" };
  const data = { ok: true, ...calc, updatedAt: new Date().toISOString() };
  await writeCache(kv, AH_CACHE_KEY, data);
  return data;
}

/**
 * 국내증시 온도 (5호) — KV 10분 캐시. 결측 시 { ok:false, error } (값 조작 금지).
 * deps.getIndexCloses / deps.getBreadthCloses / deps.getFngStock 로 테스트 목 주입 가능.
 */
export async function getKrMarketTempCached(kv, deps = {}) {
  const cached = deps.force ? null : await readCache(kv, KRT_CACHE_KEY);
  if (cached) return cached;

  const getIndexCloses = deps.getIndexCloses || ((sym) => fetchYahooCloses(sym, { range: "5d", interval: "1d" }));
  const getBreadthCloses = deps.getBreadthCloses || (() => fetchYahooSparkCloses(KR_BREADTH_UNIVERSE));
  const getFngStock = deps.getFngStock || (() => fetchStockFearGreed());

  const [ksR, kqR, brR, fngR] = await Promise.allSettled([
    getIndexCloses(KOSPI_SYMBOL),
    getIndexCloses(KOSDAQ_SYMBOL),
    getBreadthCloses(),
    getFngStock(),
  ]);
  const val = (r) => (r.status === "fulfilled" ? r.value : null);

  const calc = computeKrMarketTemp({
    kospiChgPct: lastChgPct(val(ksR)),
    kosdaqChgPct: lastChgPct(val(kqR)),
    breadth: computeKrBreadth(val(brR)),
    fngStockValue: val(fngR)?.value ?? null,
  });
  if (!calc) return { ok: false, error: "kr market data unavailable" };

  const data = { ok: true, ...calc, updatedAt: new Date().toISOString() };
  await writeCache(kv, KRT_CACHE_KEY, data);
  return data;
}

/**
 * 환율 압력 지수 (6호) — KV 10분 캐시. 결측 시 { ok:false, error }.
 * deps.getCloses 로 테스트 목 주입 가능.
 */
export async function getFxPressureCached(kv, deps = {}) {
  const cached = deps.force ? null : await readCache(kv, FXP_CACHE_KEY);
  if (cached) return cached;

  const getCloses = deps.getCloses || (() => fetchYahooCloses(USDKRW_SYMBOL, { range: "1y", interval: "1d" }));
  let closes = null;
  try { closes = await getCloses(); } catch { closes = null; }

  const calc = computeFxPressure(closes);
  if (!calc) return { ok: false, error: "usdkrw history unavailable" };

  const data = { ok: true, ...calc, updatedAt: new Date().toISOString() };
  await writeCache(kv, FXP_CACHE_KEY, data);
  return data;
}

// ── 주식 공포·탐욕 (CNN, 실패 시 VIX 근사) — api/fear-greed.js 로직의 축약 복제 ──
//   (fear-greed.js 는 핸들러 전용이라 import 불가 — 소유권 밖 파일 수정 대신 복제.
//    크립토 쪽은 market-temp.fetchCryptoFearGreed 재사용)
export async function fetchStockFearGreed() {
  try {
    const resp = await fetch("https://production.dataviz.cnn.io/index/fearandgreed/graphdata", {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36", "Accept": "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (resp.ok) {
      const data = await resp.json();
      const cur = data?.fear_and_greed;
      const v = Math.round(Number(cur?.score));
      if (Number.isFinite(v)) return { value: clamp(v, 0, 100), label: cur.rating || "", source: "cnn" };
    }
  } catch { /* 폴백으로 */ }
  // 폴백: VIX → 공포·탐욕 근사 (api/fear-greed.js 와 동일 매핑)
  try {
    const resp = await fetch("https://query1.finance.yahoo.com/v8/finance/chart/%5EVIX?interval=1d&range=5d", {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) return null;
    const json = await resp.json();
    const closes = json?.chart?.result?.[0]?.indicators?.quote?.[0]?.close || [];
    const vix = closes.filter((v) => v != null).pop();
    if (!vix) return null;
    let score;
    if (vix <= 12) score = 90;
    else if (vix <= 17) score = 70 + (17 - vix) / 5 * 20;
    else if (vix <= 22) score = 50 + (22 - vix) / 5 * 20;
    else if (vix <= 30) score = 20 + (30 - vix) / 8 * 30;
    else score = Math.max(5, 20 - (vix - 30) * 1.5);
    score = Math.round(Math.min(99, Math.max(1, score)));
    const label = score <= 25 ? "Extreme Fear" : score <= 40 ? "Fear" : score <= 60 ? "Neutral" : score <= 75 ? "Greed" : "Extreme Greed";
    return { value: score, label, vix: +Number(vix).toFixed(1), source: "vix" };
  } catch { return null; }
}

export default {
  computeFundingSqueeze, computeAltHeat,
  getFundingSqueezeCached, getAltHeatCached,
  fundingSqueezeLabel, altHeatLabel, fetchStockFearGreed,
  // ── 주식 축 (2026-08-02 양축 확장) ──
  computeKrMarketTemp, computeFxPressure, computeKrBreadth,
  getKrMarketTempCached, getFxPressureCached,
  krMarketTempLabel, fxPressureLabel,
  fetchYahooCloses, fetchYahooSparkCloses, KR_BREADTH_UNIVERSE,
};
