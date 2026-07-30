// ════════════════════════════════════════════════════════════════════
// Zepta 자체 지수 3호·4호 — 펀딩 스퀴즈 지수 / 알트 과열 지수 (계산 공유 모듈)
// ────────────────────────────────────────────────────────────────────
// 2026-07-30 (정보 피벗 2차): 마켓 온도(1호, market-temp.js)와 동일한 패턴으로
// 순수 계산 함수 + KV 10분 캐시 게터를 제공합니다.
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
// KV 캐시: 각 10분 (btc-cron 갱신 주기 스케일과 동일). 결측 시 ok:false — 값 조작 금지.
// ════════════════════════════════════════════════════════════════════

import { computeBreadthFromPool } from "./market-temp.js";
import { getMarketContext } from "./binance-client.js";

const MTF_POOL_KEY = "di:signals:realtime-pool-mtf";
const UNIVERSE_KEY = "di:signals:futures-universe";
const FS_CACHE_KEY = "di:index:funding-squeeze-cache";
const AH_CACHE_KEY = "di:index:alt-heat-cache";
const CACHE_TTL_MS = 10 * 60 * 1000; // 10분
const FUNDING_EXT = 0.0005; // ±0.05%/8h — 극단 펀딩 기준 (market-temp 와 동일)
const BASE_NEG_RATIO = 0.25; // 통상 시장의 음수 펀딩 비율 기준선 (상단 산식 주석 참조)

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const r1 = (v) => Math.round(v * 10) / 10;
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
};
