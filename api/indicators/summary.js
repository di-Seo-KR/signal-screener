// ════════════════════════════════════════════════════════════════════
// GET /api/indicators/summary — 지표 허브 집계 API (정보 피벗 2차)
// ────────────────────────────────────────────────────────────────────
// 프론트 계약 (지표 허브 화면이 소비):
//   { ok: true,
//     indicators: [{ id, title, value, unit, label,
//                    tone: "up"|"down"|"neutral"|"hot"|"cold",
//                    market: "crypto"|"stock"|"macro",  // ★ 2026-08-02 양축 확장
//                    desc,    // 한 줄 상태 서술 (행동 지시 금지)
//                    detail,  // 2~3줄 근거 — L2 확장용
//                    updatedAt }],
//     updatedAt }
//   가용한 지표만 포함 — 결측 항목은 배열에서 제외 (값 조작 금지).
//   전 항목 결측 시 { ok:false, error, indicators: [] } (HTTP 503).
//
// ★ market 필드 (2026-08-02, 대표 지시 "주식+코인 양축"):
//   crypto — 코인 시장에서만 의미를 갖는 지표
//   stock  — 주식 시장에서만 의미를 갖는 지표
//   macro  — 양쪽에 함께 걸리는 거시·심리 지표 (허브의 코인/주식 필터 양쪽에 노출)
//   기존 계약은 그대로 두고 필드만 추가했습니다 (하위 호환).
//
// 포함 지표 (id):
//   market-temp          마켓 온도 1호 (_shared/market-temp.js 재사용)        [crypto]
//   kr-market-temp       국내증시 온도 5호 (_shared/market-indices.js 신설)    [stock]
//   fear-greed           공포·탐욕 (크립토 Alternative.me + 주식 CNN/VIX)      [macro]
//   fx-pressure          환율 압력 지수 6호 (동상 — 원/달러 수준·속도)          [macro]
//   kimchi               BTC 김치프리미엄 (di:kimp:cache — kimchi-premium 60초 캐시 재사용,
//                        캐시 부재 시 제외: 수집 로직 중복 금지)              [crypto]
//   funding-squeeze      펀딩 스퀴즈 지수 3호                                 [crypto]
//   alt-heat             알트 과열 지수 4호                                   [crypto]
//   funding-avg          유니버스 평균 펀딩·극단 비율 (3호 결과 파생 — 추가 fetch 0회) [crypto]
//   stablecoin-liquidity 스테이블코인 유동성 (_shared/onchain.js — DefiLlama, 무키) [crypto]
//   exchange-netflow     BTC 거래소 순흐름 (cryptoquantEnabled() && LIVE 게이트 시만) [crypto]
//
// KV 캐시 5분 (di:indicators:summary-cache-v2) + CDN s-maxage=120.
//   ※ v2 로 키를 올린 이유: market 필드가 없는 구 스키마 캐시가 남아 있으면
//     허브의 코인/주식 필터가 5분간 어긋나기 때문입니다.
// ════════════════════════════════════════════════════════════════════

import { getMarketTempCached, fetchCryptoFearGreed } from "../_shared/market-temp.js";
import {
  getFundingSqueezeCached, getAltHeatCached, fetchStockFearGreed,
  getKrMarketTempCached, getFxPressureCached,
} from "../_shared/market-indices.js";
import { fetchStablecoinLiquidity, fetchExchangeNetflow, cryptoquantEnabled } from "../_shared/onchain.js";

// KV 핸들 — env 미설정 환경에서도 죽지 않는 graceful 획득 (kimchi-premium.js 와 동일 패턴).
async function getKv() {
  try {
    const { kv } = await import("@vercel/kv");
    const get = kv.get.bind(kv); // env 미설정이면 이 접근에서 throw → catch → null
    const set = kv.set.bind(kv);
    return { get, set };
  } catch { return null; }
}

export const config = { maxDuration: 30 };

const CACHE_KEY = "di:indicators:summary-cache-v2"; // ★ market 필드 추가로 v2
const CACHE_TTL_MS = 5 * 60 * 1000;  // 5분
const KIMP_CACHE_KEY = "di:kimp:cache";
const KIMP_MAX_AGE_MS = 10 * 60 * 1000; // 김프 캐시가 10분 이상 낡았으면 제외

// 노출 순서 — 코인 축과 주식 축이 상단에 번갈아 보이도록 고정합니다.
// (허브가 상한 N개만 그리므로, 주식 지표가 뒤로 밀려 안 보이는 상황을 막는 목적)
const DISPLAY_ORDER = [
  "market-temp", "kr-market-temp", "fear-greed", "fx-pressure",
  "kimchi", "funding-squeeze", "alt-heat", "funding-avg",
  "stablecoin-liquidity", "exchange-netflow",
];

const nowIso = () => new Date().toISOString();
const fmt = (v, d = 1) => (Number.isFinite(v) ? Number(v.toFixed(d)) : null);

// ── 공포·탐욕 영문 라벨 → 한국어 상태 서술 ──
const FNG_KO = {
  "extreme fear": "극단 공포", "fear": "공포", "neutral": "중립",
  "greed": "탐욕", "extreme greed": "극단 탐욕",
};
const fngKo = (label) => FNG_KO[String(label || "").toLowerCase()] || String(label || "");

/** 각 소스 결과 → indicators 배열 조립 (순수 함수 — 단위 테스트 주입 지점) */
export function buildIndicators({ temp, kimp, squeeze, altHeat, fngCrypto, fngStock, stable, netflow, krTemp, fxp }) {
  const out = [];

  // ① 마켓 온도 (1호) — 코인 축
  if (temp?.ok && Number.isFinite(temp.temp)) {
    const b = temp.components?.breadth;
    const tone = temp.temp > 60 ? "hot" : temp.temp <= 40 ? "cold" : "neutral";
    out.push({
      id: "market-temp",
      title: "마켓 온도 (코인)",
      value: temp.temp, unit: "°",
      label: temp.label, tone, market: "crypto",
      desc: `시장 종합 온도가 ${temp.temp}° '${temp.label}' 구간에 있습니다.`,
      detail: [
        b ? `상승 우위 ${b.long}/${b.total}종목(${Math.round((b.longRatio || 0) * 100)}%), 평균 부호 스코어 ${b.avgSigned}.` : "시장 폭 데이터는 이번 집계에서 제외됐습니다.",
        "시장 폭·펀딩 극단 비율·공포탐욕을 60/20/20 가중(가용 항목 재정규화)으로 합산한 Zepta 자체 지수입니다.",
      ].join(" "),
      updatedAt: temp.updatedAt || nowIso(),
    });
  }

  // ② BTC 김치프리미엄 (kimchi-premium 캐시 재사용)
  const kp = kimp?.btc?.premiumPct;
  if (kimp?.ok && Number.isFinite(kp)) {
    const tone = kp > 0.5 ? "up" : kp < -0.5 ? "down" : "neutral";
    out.push({
      id: "kimchi",
      title: "BTC 김치프리미엄",
      value: fmt(kp, 2), unit: "%",
      label: kp >= 0 ? "프리미엄" : "역프리미엄",
      tone, market: "crypto",
      desc: `BTC 국내 가격이 해외 대비 ${Math.abs(kp).toFixed(2)}% ${kp >= 0 ? "높은" : "낮은"} 상태입니다.`,
      detail: [
        `업비트 ${Math.round(kimp.btc.upbitKrw).toLocaleString("ko-KR")}원 vs 바이낸스 $${Math.round(kimp.btc.binanceUsdt).toLocaleString("ko-KR")} (KRW-USDT ${Math.round(kimp.usdtKrw).toLocaleString("ko-KR")}원 환산).`,
        Number.isFinite(kimp?.eth?.premiumPct) ? `ETH 김프는 ${kimp.eth.premiumPct >= 0 ? "+" : ""}${kimp.eth.premiumPct.toFixed(2)}% 입니다.` : "",
      ].filter(Boolean).join(" "),
      updatedAt: kimp.updatedAt || nowIso(),
    });
  }

  // ③ 펀딩 스퀴즈 지수 (3호)
  if (squeeze?.ok && Number.isFinite(squeeze.value)) {
    const c = squeeze.components || {};
    const tone = squeeze.value >= 70 ? "hot" : squeeze.value <= 30 ? "cold" : "neutral";
    const desc = squeeze.value >= 70
      ? "음수 펀딩 심볼이 많아 숏 포지션 자금조달료가 과밀한 상태입니다."
      : squeeze.value <= 30
        ? "양수 펀딩 우위로 롱 포지션 쪽 자금조달료 부담이 큰 상태입니다."
        : "유니버스 펀딩비 분포가 중립 범위에 있습니다.";
    out.push({
      id: "funding-squeeze",
      title: "펀딩 스퀴즈 지수",
      value: squeeze.value, unit: "",
      label: squeeze.label, tone, market: "crypto", desc,
      detail: [
        `${c.sampled}개 심볼 중 음수 펀딩 ${Math.round((c.negRatio || 0) * 100)}%, 극단 음수(≤−0.05%/8h) ${Math.round((c.extNegRatio || 0) * 100)}%.`,
        `평균 펀딩비 ${c.avgFundingPct >= 0 ? "+" : ""}${c.avgFundingPct}%/8h.`,
        "50=중립, 70 이상은 숏 과밀(스퀴즈 잠재), 30 이하는 롱 과밀 상태를 뜻합니다.",
      ].join(" "),
      updatedAt: squeeze.updatedAt || nowIso(),
    });
  }

  // ④ 알트 과열 지수 (4호)
  if (altHeat?.ok && Number.isFinite(altHeat.value)) {
    const c = altHeat.components || {};
    const tone = altHeat.value >= 70 ? "hot" : altHeat.value <= 30 ? "cold" : "neutral";
    const desc = altHeat.value >= 70
      ? "BTC 대비 알트코인의 상승 신호 우위가 뚜렷한 과열 구간입니다."
      : altHeat.value <= 30
        ? "알트코인 신호가 BTC 대비 위축된 냉각 구간입니다."
        : "알트코인과 BTC 의 신호 격차가 중립 범위에 있습니다.";
    out.push({
      id: "alt-heat",
      title: "알트 과열 지수",
      value: altHeat.value, unit: "",
      label: altHeat.label, tone, market: "crypto", desc,
      detail: [
        `알트 ${c.altCount}종목 중 상승 우위 ${Math.round((c.altLongRatio || 0) * 100)}%, 알트 평균 부호 스코어 ${c.altAvgSigned}.`,
        c.gap != null ? `BTC(${c.btcSigned}) 대비 격차 ${c.gap >= 0 ? "+" : ""}${c.gap}.` : "이번 집계에는 BTC 신호가 없어 격차 항목이 제외됐습니다.",
        c.altVolShare != null ? `유니버스 거래대금 중 알트 비중 ${Math.round(c.altVolShare * 100)}%.` : "",
      ].filter(Boolean).join(" "),
      updatedAt: altHeat.updatedAt || nowIso(),
    });
  }

  // ⑤ 유니버스 평균 펀딩 (3호 계산 결과에서 파생 — 추가 조회 없음)
  const fc = squeeze?.ok ? squeeze.components : null;
  if (fc && Number.isFinite(fc.avgFundingPct)) {
    const avg = fc.avgFundingPct;
    // 데드존: 통상 기본 펀딩 +0.01% 부근(−0.005~+0.02)은 중립권 — 0 근처 미세 음수를
    // '숏 쏠림'으로 과장하지 않기 위한 기준 (기본 펀딩의 ±절반~2배 스케일)
    const tone = avg >= 0.02 ? "up" : avg < -0.005 ? "down" : "neutral";
    out.push({
      id: "funding-avg",
      title: "평균 펀딩비",
      value: avg, unit: "%/8h",
      label: avg >= 0.02 ? "롱 쏠림" : avg < -0.005 ? "숏 쏠림" : "중립권",
      tone, market: "crypto",
      desc: `유동성 상위 유니버스의 평균 펀딩비가 8시간당 ${avg >= 0 ? "+" : ""}${avg}% 입니다.`,
      detail: [
        `극단 양수(≥+0.05%/8h) ${Math.round((fc.extPosRatio || 0) * 100)}% · 극단 음수 ${Math.round((fc.extNegRatio || 0) * 100)}% (${fc.sampled}개 심볼).`,
        "통상 기본 펀딩은 +0.01%/8h 로, 그 이상은 롱 쪽 자금조달료 부담이 커진 상태를 뜻합니다.",
      ].join(" "),
      updatedAt: squeeze.updatedAt || nowIso(),
    });
  }

  // ⑥ 공포·탐욕 (크립토 대표값 + 주식은 detail)
  if (fngCrypto && Number.isFinite(fngCrypto.value)) {
    const v = fngCrypto.value;
    const tone = v >= 75 ? "hot" : v <= 25 ? "cold" : "neutral";
    out.push({
      id: "fear-greed",
      title: "공포·탐욕 지수",
      value: v, unit: "",
      label: fngKo(fngCrypto.label), tone, market: "macro",
      desc: `크립토 공포·탐욕 지수가 ${v} (${fngKo(fngCrypto.label)}) 입니다.`,
      detail: [
        fngStock && Number.isFinite(fngStock.value)
          ? `주식(미국) 공포·탐욕 지수는 ${fngStock.value} (${fngKo(fngStock.label)})${fngStock.source === "vix" ? " — VIX 근사값" : ""} 입니다.`
          : "주식 쪽 지수는 이번 집계에서 확보되지 않았습니다.",
        "0에 가까울수록 공포, 100에 가까울수록 탐욕 심리가 강한 상태입니다. 출처: Alternative.me · CNN.",
      ].join(" "),
      updatedAt: nowIso(),
    });
  }

  // ⑦ 스테이블코인 유동성 (onchain.js — DefiLlama, 무키)
  if (stable && Number.isFinite(stable.totalB)) {
    const tone = stable.bias > 0 ? "up" : stable.bias < 0 ? "down" : "neutral";
    out.push({
      id: "stablecoin-liquidity",
      title: "스테이블코인 유동성",
      value: stable.totalB, unit: "B$",
      label: stable.regime || "중립", tone, market: "crypto",
      desc: `스테이블코인 총공급이 ${stable.totalB}B$ 로 7일간 ${stable.chg7dPct >= 0 ? "+" : ""}${stable.chg7dPct}% ${stable.bias > 0 ? "확대된" : stable.bias < 0 ? "축소된" : "보합인"} 상태입니다.`,
      detail: [
        `30일 변화 ${stable.chg30dPct >= 0 ? "+" : ""}${stable.chg30dPct}%.`,
        "총공급 확대는 시장 대기 자금 유입, 축소는 이탈로 해석되는 경향이 관찰돼 온 느린 매크로 신호입니다. 출처: DefiLlama.",
      ].join(" "),
      updatedAt: nowIso(),
    });
  }

  // ⑧ BTC 거래소 순흐름 (CryptoQuant — env 게이트 시만 포함)
  if (netflow && Number.isFinite(netflow.netflow)) {
    const nf = netflow.netflow;
    const tone = nf > 0 ? "down" : nf < 0 ? "up" : "neutral";
    out.push({
      id: "exchange-netflow",
      title: "BTC 거래소 순흐름",
      value: nf, unit: "BTC",
      label: nf > 0 ? "순입금" : nf < 0 ? "순출금" : "중립",
      tone, market: "crypto",
      desc: `전 거래소 합산 BTC 가 일 단위 ${Math.abs(nf).toLocaleString("ko-KR")} BTC ${nf > 0 ? "순입금" : nf < 0 ? "순출금" : "중립"} 상태입니다.`,
      detail: [
        "거래소 순입금은 매도 대기 물량 증가, 순출금은 외부 보관 수요로 해석되는 경향이 있습니다.",
        "출처: CryptoQuant (일 단위, 전 거래소 합산).",
      ].join(" "),
      updatedAt: nowIso(),
    });
  }

  // ⑨ 국내증시 온도 (5호) — 주식 축
  if (krTemp?.ok && Number.isFinite(krTemp.value)) {
    const c = krTemp.components || {};
    const v = krTemp.value;
    const tone = v > 60 ? "hot" : v <= 40 ? "cold" : "neutral";
    const sign = (n) => (n >= 0 ? "+" : "");
    out.push({
      id: "kr-market-temp",
      title: "국내증시 온도 (주식)",
      value: v, unit: "°",
      label: krTemp.label, tone, market: "stock",
      desc: `코스피·코스닥 종합 체감 온도가 ${v}° '${krTemp.label}' 구간에 있습니다.`,
      detail: [
        (() => {
          const idx = [
            Number.isFinite(c.kospiChgPct) ? `코스피 ${sign(c.kospiChgPct)}${c.kospiChgPct}%` : null,
            Number.isFinite(c.kosdaqChgPct) ? `코스닥 ${sign(c.kosdaqChgPct)}${c.kosdaqChgPct}%` : null,
          ].filter(Boolean).join(" · ");
          return idx ? `${idx}.` : "지수 등락률은 이번 집계에서 제외됐습니다.";
        })(),
        c.upRatio != null
          ? `대표 ${c.breadthTotal}종목 중 ${c.breadthUp}종목 상승(${Math.round(c.upRatio * 100)}%).`
          : "종목 상승/하락 집계는 이번 집계에서 제외됐습니다.",
        c.fngStock != null
          ? `보조 항목으로 주식 공포·탐욕(${c.fngStock})을 20% 가중으로 반영했습니다 — 출처 CNN·VIX, 글로벌 위험선호 대리지표입니다.`
          : "",
        "지수 등락률 40% · 종목 상승비율 40% · 공포탐욕 20% 가중(가용 항목 재정규화)으로 합산한 Zepta 자체 지수입니다.",
      ].filter(Boolean).join(" "),
      updatedAt: krTemp.updatedAt || nowIso(),
    });
  }

  // ⑩ 환율 압력 지수 (6호) — 주식·코인 양쪽 맥락(macro)
  if (fxp?.ok && Number.isFinite(fxp.value)) {
    const c = fxp.components || {};
    const v = fxp.value;
    // 고환율(원화 약세)은 국내 증시에 부담 요인으로 관찰돼 온 맥락 → tone down
    const tone = v >= 70 ? "down" : v <= 30 ? "up" : "neutral";
    const desc = v >= 70
      ? `원/달러가 ${Math.round(c.rate).toLocaleString("ko-KR")}원으로 최근 1년 구간 상단에 있어 원화 약세 압력이 큰 상태입니다.`
      : v <= 30
        ? `원/달러가 ${Math.round(c.rate).toLocaleString("ko-KR")}원으로 최근 1년 구간 하단에 있어 원화가 강세인 상태입니다.`
        : `원/달러가 ${Math.round(c.rate).toLocaleString("ko-KR")}원으로 최근 1년 구간의 중간 범위에 있습니다.`;
    const sign = (n) => (n >= 0 ? "+" : "");
    out.push({
      id: "fx-pressure",
      title: "환율 압력 지수",
      value: v, unit: "",
      label: fxp.label, tone, market: "macro", desc,
      detail: [
        `최근 1년 종가 분포 상 ${c.levelPct}% 지점 (52주 ${Math.round(c.low52w).toLocaleString("ko-KR")}~${Math.round(c.high52w).toLocaleString("ko-KR")}원, 표본 ${c.sampled}일).`,
        (() => {
          const spd = [
            c.chg20Pct != null ? `20일 ${sign(c.chg20Pct)}${c.chg20Pct}%` : null,
            c.chg5Pct != null ? `5일 ${sign(c.chg5Pct)}${c.chg5Pct}%` : null,
          ].filter(Boolean).join(" · ");
          return spd ? `${spd} 변동.` : "";
        })(),
        "환율 수준 50% · 20일 변화 30% · 5일 변화 20% 가중. 값이 높을수록 원화 약세로, 국내 증시에서는 외국인 수급 부담 요인으로 관찰돼 온 맥락입니다. 출처: Yahoo Finance.",
      ].filter(Boolean).join(" "),
      updatedAt: fxp.updatedAt || nowIso(),
    });
  }

  // ── 노출 순서 정렬 (DISPLAY_ORDER 미등재 지표는 뒤로) ──
  return out.sort((a, b) => {
    const ia = DISPLAY_ORDER.indexOf(a.id); const ib = DISPLAY_ORDER.indexOf(b.id);
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
  });
}

async function computeSummary(kv) {
  const [tempR, kimpR, fsR, ahR, fngCR, fngSR, stableR, nfR, krtR, fxpR] = await Promise.allSettled([
    getMarketTempCached(kv),
    kv ? kv.get(KIMP_CACHE_KEY) : Promise.resolve(null),
    getFundingSqueezeCached(kv),
    getAltHeatCached(kv),
    fetchCryptoFearGreed(),
    fetchStockFearGreed(),
    fetchStablecoinLiquidity(),
    cryptoquantEnabled() ? fetchExchangeNetflow("btc") : Promise.resolve(null),
    getKrMarketTempCached(kv),  // ★ 5호 (주식)
    getFxPressureCached(kv),    // ★ 6호 (거시)
  ]);
  const val = (r) => (r.status === "fulfilled" ? r.value : null);

  // 김프 캐시: { data, ts } 래핑 (kimchi-premium.js 실측) — 10분 이내만 채택
  const kimpRaw = val(kimpR);
  const kimp = kimpRaw?.data?.ok && Date.now() - (kimpRaw.ts || 0) < KIMP_MAX_AGE_MS ? kimpRaw.data : null;

  const indicators = buildIndicators({
    temp: val(tempR),
    kimp,
    squeeze: val(fsR),
    altHeat: val(ahR),
    fngCrypto: val(fngCR),
    fngStock: val(fngSR),
    stable: val(stableR),
    netflow: val(nfR),
    krTemp: val(krtR),
    fxp: val(fxpR),
  });

  if (indicators.length === 0) return { ok: false, error: "no indicators available", indicators: [] };
  return { ok: true, indicators, updatedAt: nowIso() };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });

  try {
    const kv = await getKv();
    const force = req.query?.force === "1";

    // ── KV 5분 캐시 ──
    if (kv && !force) {
      try {
        const c = await kv.get(CACHE_KEY);
        if (c?.data?.ok && Date.now() - (c.ts || 0) < CACHE_TTL_MS) {
          res.setHeader("Cache-Control", "public, s-maxage=120, stale-while-revalidate=600");
          return res.status(200).json({ ...c.data, cached: true });
        }
      } catch { /* 캐시 실패 → 실계산 */ }
    }

    const data = await computeSummary(kv);
    if (!data.ok) {
      res.setHeader("Cache-Control", "no-store");
      return res.status(503).json(data);
    }
    if (kv) {
      try { await kv.set(CACHE_KEY, { data, ts: Date.now() }, { ex: 600 }); } catch { /* 무시 */ }
    }
    res.setHeader("Cache-Control", "public, s-maxage=120, stale-while-revalidate=600");
    return res.status(200).json(data);
  } catch (err) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
}
