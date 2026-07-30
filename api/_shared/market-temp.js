// ════════════════════════════════════════════════════════════════════
// Zepta 마켓 온도 지수 (자체 지표 1호) — 계산 공유 모듈
// ────────────────────────────────────────────────────────────────────
// 2026-07-30 (정보 피벗 1차): 시장의 "체감 온도"를 0~100 단일 숫자로 요약.
// 사용처: api/market-temp.js (공개 API) + api/_shared/briefing.js (일일 브리핑).
//
// ── 산식 (재현 가능성을 위해 명시) ─────────────────────────────────
// temp = Σ(가중치_i × 점수_i) ÷ Σ(가중치_i)   — 사용 가능한 구성요소만 합산
//
// ① breadth (기본 가중 60%) — di:signals:realtime-pool-mtf (btc-cron 이 10분마다
//    적재하는 멀티TF 종합 스코어 풀, 4시간 윈도우·심볼당 최신 1건으로 중복 제거)
//      longRatio = 상승(LONG) 우위 심볼 수 ÷ 전체 심볼 수          (0~1)
//      avgSigned = 평균( LONG 이면 +score, SHORT 이면 −score )      (−100~+100)
//      breadthScore = 0.6 × (longRatio × 100) + 0.4 × ((avgSigned + 100) ÷ 2)
//    → 전 종목 LONG·평균 스코어 100 이면 100, 전 종목 SHORT·−100 이면 0.
//
// ② funding (기본 가중 20%) — 바이낸스 premiumIndex 전 심볼 1회 조회
//    (binance-client getMarketContext — 프록시 경유. Vercel 리전 직접 fetch 는
//    451 차단 이력이 있어 절대 금지). USDT 마진 심볼만 사용.
//      EXT = ±0.05%/8h (통상 기본 펀딩 0.01% 의 5배 = 뚜렷한 쏠림 기준)
//      posExt = 펀딩비 ≥ +EXT 심볼 비율,  negExt = 펀딩비 ≤ −EXT 심볼 비율
//      fundingScore = clamp( 50 + (posExt − negExt) × 250, 0, 100 )
//    → 롱 과열(양의 극단 펀딩)일수록 온도↑, 숏 쏠림일수록 온도↓.
//    데이터를 얻지 못하면(프록시 미설정 등) 이 항목을 제외하고 가중 재정규화.
//
// ③ fearGreed (기본 가중 20%) — Alternative.me Crypto Fear & Greed (0~100 그대로).
//    api/fear-greed.js 의 크립토 소스와 동일. 실패 시 제외 + 가중 재정규화.
//
// ── 라벨 ──
//   temp ≤ 20 냉각 / ≤ 40 위축 / ≤ 60 중립 / ≤ 80 가열 / > 80 과열
//
// KV 캐시: di:market:temp-cache — 10분. (btc-cron 갱신 주기와 동일 스케일)
// ════════════════════════════════════════════════════════════════════

import { getMarketContext } from "./binance-client.js";

const MTF_POOL_KEY = "di:signals:realtime-pool-mtf";
const CACHE_KEY = "di:market:temp-cache";
const CACHE_TTL_MS = 10 * 60 * 1000; // 10분
const POOL_WINDOW_MS = 4 * 60 * 60 * 1000; // MTF 풀 유지 윈도우와 동일 (coin-scores 와 통일)
const FUNDING_EXT = 0.0005; // ±0.05%/8h — 극단 펀딩 기준

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** 온도 → 한국어 라벨 */
export function tempLabel(temp) {
  if (temp <= 20) return "냉각";
  if (temp <= 40) return "위축";
  if (temp <= 60) return "중립";
  if (temp <= 80) return "가열";
  return "과열";
}

// ── 구성요소 ① breadth — MTF 풀 집계 ──
//   coin-scores.js 와 동일한 정규화(심볼당 최신 1건, 4h cutoff)를 적용해
//   공개 대시보드 숫자와 온도 지수의 모수(母數)가 일치하도록 유지합니다.
export function computeBreadthFromPool(poolMtf, now = Date.now()) {
  const cutoff = now - POOL_WINDOW_MS;
  const byAsset = new Map();
  for (const e of Array.isArray(poolMtf) ? poolMtf : []) {
    if (!e || (e.ts || 0) < cutoff) continue;
    const t = String(e.type || "").toUpperCase();
    const side = String(e.side || "").toUpperCase() === "SHORT" || t === "SELL" ? "SHORT"
      : String(e.side || "").toUpperCase() === "LONG" || t === "BUY" ? "LONG" : null;
    if (!side) continue;
    let a = String(e.asset || "").toUpperCase().trim();
    if (a.includes("/")) a = a.split("/")[0];
    a = a.replace(/USDT$/, "").replace(/USD$/, "");
    if (!a) continue;
    const prev = byAsset.get(a);
    if (!prev || (e.ts || 0) > prev.ts) {
      byAsset.set(a, { asset: a, side, score: clamp(parseFloat(e.score) || 0, 0, 100), ts: e.ts || 0 });
    }
  }
  const coins = Array.from(byAsset.values());
  if (coins.length === 0) return null;
  const long = coins.filter((c) => c.side === "LONG").length;
  const short = coins.length - long;
  const longRatio = long / coins.length;
  const avgSigned = clamp(
    coins.reduce((s, c) => s + (c.side === "LONG" ? c.score : -c.score), 0) / coins.length,
    -100, 100,
  );
  const score = clamp(0.6 * (longRatio * 100) + 0.4 * ((avgSigned + 100) / 2), 0, 100);
  return {
    score: Math.round(score * 10) / 10,
    long, short, total: coins.length,
    longRatio: Math.round(longRatio * 1000) / 1000,
    avgSigned: Math.round(avgSigned * 10) / 10,
    coins, // 브리핑에서 상위 변동 심볼 추출용 (API 응답에는 미포함)
  };
}

// ── 구성요소 ② funding — 극단 펀딩 비율 ──
export function computeFundingScore(fundingMap) {
  const rates = Object.entries(fundingMap || {})
    .filter(([sym]) => /USDT$/.test(sym))
    .map(([, r]) => r)
    .filter((r) => Number.isFinite(r));
  if (rates.length === 0) return null;
  const posExt = rates.filter((r) => r >= FUNDING_EXT).length / rates.length;
  const negExt = rates.filter((r) => r <= -FUNDING_EXT).length / rates.length;
  return {
    score: Math.round(clamp(50 + (posExt - negExt) * 250, 0, 100) * 10) / 10,
    posExtremeRatio: Math.round(posExt * 1000) / 1000,
    negExtremeRatio: Math.round(negExt * 1000) / 1000,
    sampled: rates.length,
  };
}

// ── 구성요소 ③ fearGreed — Alternative.me (api/fear-greed.js 크립토 소스와 동일) ──
//   2026-07-30 (정보 피벗 2차): 지표 허브(api/indicators/summary.js)에서도 재사용할 수
//   있도록 export 로 공개했습니다. 동작 변경 없음.
export async function fetchCryptoFearGreed() {
  try {
    const resp = await fetch("https://api.alternative.me/fng/?limit=1", {
      headers: { "User-Agent": "Zepta/1.0" },
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const d = data?.data?.[0];
    const v = parseInt(d?.value, 10);
    if (!Number.isFinite(v)) return null;
    return { score: clamp(v, 0, 100), value: v, label: d.value_classification || "" };
  } catch { return null; }
}

/**
 * 온도 지수 실계산 (캐시 미사용).
 * 테스트 주입 지점: deps 로 각 소스를 목으로 대체할 수 있습니다.
 * @returns {Promise<{ok:boolean, temp:number, label:string, components:object, updatedAt:string}|{ok:false, error:string}>}
 */
export async function computeMarketTemp(kv, deps = {}) {
  const getPool = deps.getPool || (async () => (await kv.get(MTF_POOL_KEY)) || []);
  const getFunding = deps.getFunding || (async () => (await getMarketContext()).funding || {});
  const getFng = deps.getFng || fetchCryptoFearGreed;
  const now = deps.now || Date.now();

  const [poolR, fundingR, fngR] = await Promise.allSettled([getPool(), getFunding(), getFng()]);

  const breadth = poolR.status === "fulfilled" ? computeBreadthFromPool(poolR.value, now) : null;
  const funding = fundingR.status === "fulfilled" ? computeFundingScore(fundingR.value) : null;
  const fearGreed = fngR.status === "fulfilled" ? fngR.value : null;

  // 사용 가능한 구성요소만으로 가중 재정규화 (기본 60/20/20)
  const parts = [];
  if (breadth) parts.push({ key: "breadth", weight: 0.6, score: breadth.score });
  if (funding) parts.push({ key: "funding", weight: 0.2, score: funding.score });
  if (fearGreed) parts.push({ key: "fearGreed", weight: 0.2, score: fearGreed.score });
  if (parts.length === 0) return { ok: false, error: "no components available" };

  const wSum = parts.reduce((s, p) => s + p.weight, 0);
  const temp = Math.round(parts.reduce((s, p) => s + p.weight * p.score, 0) / wSum);

  const components = {};
  for (const p of parts) {
    const effWeight = Math.round((p.weight / wSum) * 1000) / 1000;
    if (p.key === "breadth") {
      const { coins: _omit, ...pub } = breadth; // 내부용 coins 배열은 응답에서 제외
      components.breadth = { ...pub, weight: effWeight };
    } else if (p.key === "funding") {
      components.funding = { ...funding, weight: effWeight };
    } else {
      components.fearGreed = { ...fearGreed, weight: effWeight };
    }
  }
  // 제외된 항목은 null 로 명시 (프론트가 "데이터 없음"을 구분 표시할 수 있게)
  if (!breadth) components.breadth = null;
  if (!funding) components.funding = null;
  if (!fearGreed) components.fearGreed = null;

  return {
    ok: true,
    temp: clamp(temp, 0, 100),
    label: tempLabel(clamp(temp, 0, 100)),
    components,
    updatedAt: new Date(now).toISOString(),
    // 브리핑 조립용 내부 필드 (JSON 응답 전 삭제하지 않아도 무해하지만, 명시적으로 분리)
    _breadthCoins: breadth ? breadth.coins : [],
  };
}

/**
 * KV 10분 캐시를 얹은 온도 지수 조회. KV 불능 시 캐시 없이 실계산으로 폴백.
 */
export async function getMarketTempCached(kv, { force = false } = {}) {
  if (!force && kv) {
    try {
      const cached = await kv.get(CACHE_KEY);
      if (cached?.data?.ok && Date.now() - (cached.ts || 0) < CACHE_TTL_MS) {
        return { ...cached.data, cached: true };
      }
    } catch { /* 캐시 실패 → 실계산 */ }
  }
  const fresh = await computeMarketTemp(kv);
  if (fresh.ok && kv) {
    try {
      const { _breadthCoins: _omit, ...persist } = fresh;
      await kv.set(CACHE_KEY, { data: persist, ts: Date.now() }, { ex: 900 });
    } catch { /* 캐시 저장 실패 무시 */ }
  }
  return fresh;
}

export default { computeMarketTemp, getMarketTempCached, computeBreadthFromPool, computeFundingScore, tempLabel };
