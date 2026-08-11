// ════════════════════════════════════════════════════════════════════
// onchain — 온체인 시장 신호 (전략 적용용)
//
// ★ 2026-06-15 (대표 지시): 지금 전략(메이저 코인 선물 + MTF 기술적)에 적용할만한
//   *직교적* 온체인 알파만. 토큰안전성·dev활동 등 무의미한 건 제외.
//   신규 알파는 shadow-first — 검증 전 라이브 매매에 즉시 반영하지 않음(env 게이트).
//
// A. 스테이블코인 총공급 추세 (DefiLlama, 키 불필요) — 시장 매수여력/유동성 바이어스.
//    공급 확대 = 자본 유입(리스크온), 축소 = 이탈(리스크오프). 느린 매크로 신호.
// B. 거래소 순입출금 (CryptoQuant, CRYPTOQUANT_API_KEY 필요) — 매도/매수 압력(방향).
//    ※ 키 수령 후 라이브 계약(베이스/인증/응답) 확정 — 현재는 키 없으면 null(안전).
//
// C. 파생(선물) 컨텍스트 (바이낸스 futures/data, 키 불필요) — 2026-08-11 추가.
//    OI 24h 변화율 + 글로벌 롱숏 계정비. 표시 + 섀도 병행 기록 전용(위 정책 동일 적용).
//
// 모든 함수는 throw 안 함 — 실패/미설정 시 null(호출부 무해).
// ════════════════════════════════════════════════════════════════════

import crypto from "node:crypto";

const DAY_MS = 24 * 60 * 60 * 1000;

async function getKvSafe() {
  // @vercel/kv 는 env 없으면 접근 시점에 throw → 사전 체크로 graceful(로컬/KV장애 안전).
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) return null;
  try { return (await import("@vercel/kv")).kv; } catch { return null; }
}

async function jget(url, { timeoutMs = 8000, headers = {} } = {}) {
  try {
    const r = await fetch(url, { headers: { Accept: "application/json", ...headers }, signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) { console.warn(`[onchain] ${url.slice(0, 60)} HTTP ${r.status}`); return null; }
    return await r.json();
  } catch (e) {
    console.warn(`[onchain] fetch 실패: ${e?.message}`);
    return null;
  }
}

// ── A. 스테이블코인 유동성 (DefiLlama, 키 불필요) ──────────────────────
const STABLE_URL = "https://stablecoins.llama.fi/stablecoincharts/all";

/**
 * 스테이블코인 총공급 + 7일 추세 → 유동성 바이어스.
 * @returns {{totalB:number, chg7dPct:number, chg30dPct:number, bias:number, regime:string}|null}
 *   bias: +1 확대(리스크온) / 0 중립 / -1 축소(리스크오프). 실패 시 null.
 */
export async function fetchStablecoinLiquidity() {
  const kv = await getKvSafe();
  const cacheKey = "di:onchain:stable-liquidity";
  if (kv) { try { const c = await kv.get(cacheKey); if (c && Number.isFinite(c.totalB)) return c; } catch {} }

  const arr = await jget(STABLE_URL, { timeoutMs: 10000 });
  if (!Array.isArray(arr) || arr.length < 31) return null;
  const val = (e) => Number(e?.totalCirculatingUSD?.peggedUSD);
  const last = val(arr[arr.length - 1]);
  const d7 = val(arr[arr.length - 8]);   // 7일 전 (일 단위 시계열)
  const d30 = val(arr[arr.length - 31]); // 30일 전
  if (!Number.isFinite(last) || !(last > 0)) return null;
  const chg7dPct = Number.isFinite(d7) && d7 > 0 ? Number(((last / d7 - 1) * 100).toFixed(2)) : 0;
  const chg30dPct = Number.isFinite(d30) && d30 > 0 ? Number(((last / d30 - 1) * 100).toFixed(2)) : 0;
  // 7일 ±0.5% 임계로 바이어스(스테이블 공급은 변동 작음 → 0.5%도 유의미)
  const _t = Number(process.env.ZEPTA_ONCHAIN_LIQ_THRESH);
  const thresh = Number.isFinite(_t) && _t > 0 ? _t : 0.5;
  const bias = chg7dPct > thresh ? 1 : chg7dPct < -thresh ? -1 : 0;
  const regime = bias > 0 ? "확대(리스크온)" : bias < 0 ? "축소(리스크오프)" : "중립";
  const out = { totalB: Number((last / 1e9).toFixed(1)), chg7dPct, chg30dPct, bias, regime };
  if (kv) { try { await kv.set(cacheKey, out, { ex: 6 * 3600 }); } catch {} } // 6h (느린 신호)
  return out;
}

// ── B. 거래소 순입출금 (CryptoQuant, 키 필요) ──────────────────────────
// ★ 키 수령 후 라이브 계약 확정 예정. 현재 키 없으면 null(전혀 동작 안 함 → 안전).
const CQ_BASE = "https://api.cryptoquant.com/v1";

export function cryptoquantEnabled() {
  return !!(process.env.CRYPTOQUANT_API_KEY && String(process.env.CRYPTOQUANT_API_KEY).trim());
}

/**
 * 거래소 순입출금(netflow) → 방향 바이어스. (양수 입금=매도압력=약세 / 음수 출금=강세)
 * @returns {{netflow:number, bias:number}|null}
 *   계약(공식 문서 확정): GET /v1/{asset}/exchange-flows/netflow?exchange=all_exchange&window=day
 *   → result.data[].netflow_total. 인증 Authorization: Bearer. 무료 티어는 막힐 수 있음(403→null).
 *   ZEPTA_CRYPTOQUANT_LIVE=1 + 키 둘 다일 때만 호출(안전 게이트). 실패/파싱불가 시 null(매매 무해).
 */
export async function fetchExchangeNetflow(asset) {
  if (!cryptoquantEnabled() || !asset) return null;
  if (process.env.ZEPTA_CRYPTOQUANT_LIVE !== "1") return null; // 활성 게이트
  const sym = String(asset).toLowerCase();
  const kv = await getKvSafe();
  const cacheKey = `di:onchain:netflow:${sym}`;
  if (kv) { try { const c = await kv.get(cacheKey); if (c && Number.isFinite(c.netflow)) return c; } catch {} }
  // ★ exchange 파라미터 필수(공식 문서). all_exchange = 전 거래소 합산. window=day, 최신 1건.
  const json = await jget(`${CQ_BASE}/${sym}/exchange-flows/netflow?exchange=all_exchange&window=day&limit=1`, {
    headers: { Authorization: `Bearer ${String(process.env.CRYPTOQUANT_API_KEY).trim()}` },
  });
  if (!json) return null;
  const row = json?.result?.data?.[0] ?? json?.data?.[0];
  const nf = Number(row?.netflow_total ?? row?.netflow);
  if (!Number.isFinite(nf)) {
    // 진단: 무료 티어 막힘(status 403/구독)·필드명 변경 등 → 로그로 실체 노출(매매엔 무해, null)
    console.warn(`[onchain] cryptoquant ${sym} netflow 미파싱 — status:${json?.status?.code ?? "?"} keys:[${Object.keys(json || {}).join(",")}]`);
    return null;
  }
  const out = { netflow: Number(nf.toFixed(2)), bias: nf > 0 ? -1 : nf < 0 ? 1 : 0 }; // 입금(+)→약세(-1)/출금(-)→강세(+1)
  if (kv) { try { await kv.set(cacheKey, out, { ex: 3 * 3600 }); } catch {} } // 3h (일 단위 데이터)
  return out;
}

/** 통합 온체인 컨텍스트 — 일일보고/분석용. 실패 항목은 null. */
export async function getOnchainContext(asset = null) {
  const [liquidity, netflow] = await Promise.all([
    fetchStablecoinLiquidity().catch(() => null),
    asset ? fetchExchangeNetflow(asset).catch(() => null) : Promise.resolve(null),
  ]);
  return { liquidity, netflow };
}

// ── C. 파생(선물) 컨텍스트 — 바이낸스 futures/data (무료·무서명) ──────────
// ★ 2026-08-11 (대표 지시 — 온체인·파생 팩터 1단계): 시그널 "①표시 ②섀도 병행 기록" 전용.
//   상단 정책(신규 알파는 shadow-first)에 따라 종합 스코어·매매 경로에는 개입하지 않습니다.
//
//   실 응답 포맷 curl 확인(2026-08-11, 파싱 근거 — 과거 3회 반복 사고 교훈):
//   · GET /futures/data/openInterestHist?symbol=BTCUSDT&period=1h&limit=25
//     → [{ symbol, sumOpenInterest:"106288.035…", sumOpenInterestValue:"…", timestamp }] (timestamp 오름차순, 숫자는 문자열)
//   · GET /futures/data/globalLongShortAccountRatio?symbol=BTCUSDT&period=1h&limit=25
//     → [{ symbol, longAccount:"0.6216", longShortRatio:"1.6427", shortAccount:"0.3784", timestamp }] (오름차순)
//   OI 변화율은 sumOpenInterest(계약 수량) 기준 — sumOpenInterestValue(USD)는 가격 변동이
//   섞여 순수 포지셔닝 변화가 아니게 됨. ※ oi-tracker.js 는 cron 간(수 분) diff 라 재사용 불가
//   — 여기는 24h 지평이 필요해 openInterestHist 를 씁니다(읽기 전용 참조만).
//
//   바이낸스 직접 호출은 Vercel IP 차단(451) 이력 → binance-client.js 와 동일한 Fly.io
//   프록시(BINANCE_PROXY_URL/SECRET, POST /binance/request 무서명 GET 래핑) 경유.
//   binance-client.js 는 실매매 경로라 수정 금지 → 필요한 최소(무서명 GET)만 여기 복제.
//   프록시 env 미설정(로컬 등)이면 직접 호출 폴백.

const BINANCE_DATA_BASE = process.env.BINANCE_FAPI_BASE || "https://fapi.binance.com";

/** 바이낸스 무서명 GET (프록시 인식). 실패 시 null — throw 안 함. */
async function binanceDataGet(path, params = {}, { timeoutMs = 6000 } = {}) {
  const proxyUrl = process.env.BINANCE_PROXY_URL || "";
  const proxySecret = process.env.BINANCE_PROXY_SECRET || "";
  if (proxyUrl && proxySecret) {
    try {
      // 프록시 내부 인증 서명 — binance-proxy/server.js signInternal 과 동일 규칙
      const proxyPath = "/binance/request";
      const bodyStr = JSON.stringify({ method: "GET", path, params, testnet: false, signed: false });
      const timestamp = Date.now().toString();
      const sig = crypto.createHmac("sha256", proxySecret)
        .update(`${timestamp}\nPOST\n${proxyPath}\n${bodyStr}`).digest("hex");
      const r = await fetch(`${proxyUrl}${proxyPath}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Proxy-Timestamp": timestamp, "X-Proxy-Signature": sig },
        body: bodyStr,
        signal: AbortSignal.timeout(timeoutMs),
      });
      const wrapped = await r.json().catch(() => null);
      // 프록시는 { ok, status, data } 로 래핑 — ok=false(바이낸스/프록시 오류)는 null
      if (!wrapped || wrapped.ok === false) return null;
      return wrapped.data ?? null;
    } catch (e) {
      console.warn(`[onchain] proxy ${path} 실패: ${e?.message}`);
      return null;
    }
  }
  const qs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
  return jget(`${BINANCE_DATA_BASE}${path}${qs ? `?${qs}` : ""}`, { timeoutMs });
}

/** timestamp 오름차순 배열에서 마지막 값 + ~24h 전 베이스라인 추출. 24h±4h 밖이면 null. */
function pick24hBaseline(arr) {
  if (!Array.isArray(arr) || arr.length < 2) return null;
  const last = arr[arr.length - 1];
  const lastTs = Number(last?.timestamp);
  if (!Number.isFinite(lastTs)) return null;
  const target = lastTs - DAY_MS;
  let best = null, bestGap = Infinity;
  for (const e of arr) {
    const t = Number(e?.timestamp);
    if (!Number.isFinite(t)) continue;
    const gap = Math.abs(t - target);
    if (gap < bestGap) { bestGap = gap; best = e; }
  }
  // 24h 근접 베이스라인만 인정 — 아니면 "24h 변화"라는 라벨이 거짓이 됨(가짜 데이터 금지)
  if (!best || bestGap > 4 * 3600 * 1000) return null;
  return { last, base: best };
}

/** 단일 심볼 파생 지표 — { oiChg24h(%), lsRatio, lsChg } (산출 불가 필드는 null). */
async function fetchSymbolDeriv(symbol) {
  // period=1h·limit=25 → 마지막 버킷과 24h 전 버킷 비교 (심볼당 2콜)
  const [oiArr, lsArr] = await Promise.all([
    binanceDataGet("/futures/data/openInterestHist", { symbol, period: "1h", limit: 25 }),
    binanceDataGet("/futures/data/globalLongShortAccountRatio", { symbol, period: "1h", limit: 25 }),
  ]);
  let oiChg24h = null;
  const oiPick = pick24hBaseline(oiArr);
  if (oiPick) {
    const lastOi = Number(oiPick.last?.sumOpenInterest);
    const baseOi = Number(oiPick.base?.sumOpenInterest);
    if (Number.isFinite(lastOi) && Number.isFinite(baseOi) && baseOi > 0) {
      oiChg24h = Number(((lastOi / baseOi - 1) * 100).toFixed(2));
    }
  }
  let lsRatio = null, lsChg = null;
  if (Array.isArray(lsArr) && lsArr.length > 0) {
    const lastLs = Number(lsArr[lsArr.length - 1]?.longShortRatio);
    if (Number.isFinite(lastLs)) lsRatio = Number(lastLs.toFixed(3));
    const lsPick = pick24hBaseline(lsArr);
    const baseLs = Number(lsPick?.base?.longShortRatio);
    if (Number.isFinite(lastLs) && Number.isFinite(baseLs)) lsChg = Number((lastLs - baseLs).toFixed(3));
  }
  if (oiChg24h == null && lsRatio == null) return null; // 두 소스 모두 실패
  return { oiChg24h, lsRatio, lsChg };
}

const DERIV_CACHE_KEY = "di:onchain:deriv-ctx";
const DERIV_CACHE_FRESH_MS = 30 * 60 * 1000; // 30분 — btc-cron 10분 주기 대비 호출 수 1/3
const DERIV_MAX_SYMBOLS = 60;  // 유니버스 50종 + 여유 (심볼당 2콜 상한 가드)
const DERIV_CHUNK = 10;        // 동시 요청 심볼 수 (프록시 부하 분산)

/**
 * 파생·온체인 통합 컨텍스트 — 유니버스 심볼을 한 번에(KV 30분 캐시로 호출 수 최소화).
 * @param {string[]} symbols 바이낸스 선물 심볼 (예: ["BTCUSDT", ...])
 * @returns {Promise<{bySymbol: Object<string,{oiChg24h:number|null,lsRatio:number|null,lsChg:number|null}|null>,
 *   stableTrend:{bias:number,chg7dPct:number,regime:string}|null, ts:number}>}
 *   실패 필드는 null · throw 안 함(호출부 무해).
 */
export async function fetchDerivOnchainContext(symbols = []) {
  const now = Date.now();
  const want = [...new Set((Array.isArray(symbols) ? symbols : []).filter((s) => typeof s === "string" && s))]
    .slice(0, DERIV_MAX_SYMBOLS);
  // 글로벌 스테이블 유동성은 자체 KV 캐시(6h) 있음 — 심볼 조회와 병렬
  const stablePromise = fetchStablecoinLiquidity().catch(() => null);
  const bySymbol = {};
  try {
    if (want.length > 0) {
      const kv = await getKvSafe();
      let cached = null;
      if (kv) { try { cached = await kv.get(DERIV_CACHE_KEY); } catch { cached = null; } }
      const fresh = !!(cached && Number.isFinite(cached.ts) && now - cached.ts < DERIV_CACHE_FRESH_MS
        && cached.bySymbol && typeof cached.bySymbol === "object"
        && want.every((s) => s in cached.bySymbol));
      if (fresh) {
        for (const s of want) bySymbol[s] = cached.bySymbol[s] ?? null;
      } else {
        for (let i = 0; i < want.length; i += DERIV_CHUNK) {
          const chunk = want.slice(i, i + DERIV_CHUNK);
          const results = await Promise.allSettled(chunk.map((s) => fetchSymbolDeriv(s)));
          chunk.forEach((s, j) => { bySymbol[s] = results[j].status === "fulfilled" ? results[j].value : null; });
          // 첫 청크가 전멸(프록시/네트워크 다운)이면 잔여 청크 중단 — cron 지연 방지
          if (i === 0 && chunk.every((s) => bySymbol[s] == null)) break;
        }
        // 1건 이상 성공했을 때만 캐시 — 전멸 결과를 30분 캐시하면 복구가 늦어짐
        const okCount = Object.values(bySymbol).filter(Boolean).length;
        if (kv && okCount > 0) { try { await kv.set(DERIV_CACHE_KEY, { ts: now, bySymbol }, { ex: 3600 }); } catch {} }
      }
    }
  } catch (e) {
    console.warn(`[onchain] deriv context 실패: ${e?.message}`);
  }
  const liq = await stablePromise;
  const stableTrend = liq ? { bias: liq.bias, chg7dPct: liq.chg7dPct, regime: liq.regime } : null;
  return { bySymbol, stableTrend, ts: now };
}

// ── D. 청산 이력 (Coinalyze — 무료 API, COINALYZE_API_KEY 필요) ──────────
// ★ 2026-08-12 (대표 결정: 유료 보류, 무료 3축 진행): 알트 전체 청산 이력을 섀도 트랙에
//   추가합니다. **기록 전용** — 섀도 보정 규칙(사전등록)은 1주 분포 관찰 후 별도 커밋으로
//   붙입니다. 임계값 분포를 모른 채 규칙부터 박으면 사전등록 원칙이 무의미해집니다.
//
//   공식 OpenAPI 스펙(api.coinalyze.net/v1/doc/api-spec.json — 2026-08-12 직접 확인) 기준:
//   · GET /v1/liquidation-history?symbols=BTCUSDT_PERP.A,…&interval=1hour&from=&to=&convert_to_usd=true
//     → [{ symbol, history: [{ t(초 단위 구간 시작), l(롱 청산량), s(숏 청산량) }] }]
//   · 인증: api_key 헤더(또는 쿼리). 분당 40콜 — symbols 는 HTTP 1회에 최대 20개지만
//     "심볼당 1콜 소모" 규칙이라 예산은 심볼 수 기준으로 관리합니다.
//   · 심볼 표기: 거래소 접미사(.A=Binance — /exchanges 로 런타임 확인) — 하드코딩하지 않고
//     /future-markets 를 24h 캐시로 읽어 { BTCUSDT → BTCUSDT_PERP.A } 맵을 만듭니다.
//   키 미설정 시 전부 null(무동작) — CryptoQuant 와 동일 패턴이라 배포에 안전합니다.

const CA_BASE = "https://api.coinalyze.net/v1";
const CA_MARKETS_KEY = "di:onchain:ca-markets";  // 심볼 맵 캐시 (24h)
const CA_LIQ_KEY = "di:onchain:ca-liq";          // 청산 컨텍스트 캐시 (30분, 커서 포함)
const CA_LIQ_FRESH_MS = 30 * 60 * 1000;
const CA_CALL_BUDGET = 36;                       // 분당 40콜 한도 아래(여유 4)
const CA_CHUNK = 18;                             // HTTP 1회 심볼 상한 20 아래

export function coinalyzeEnabled() {
  return Boolean(process.env.COINALYZE_API_KEY);
}

async function caGet(path, params = {}) {
  const qs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
  return jget(`${CA_BASE}${path}${qs ? `?${qs}` : ""}`, {
    timeoutMs: 8000,
    headers: { api_key: process.env.COINALYZE_API_KEY },
  });
}

/** 바이낸스 USDT 무기한 → Coinalyze 심볼 맵 (KV 24h 캐시). 실패 시 null. */
async function loadCoinalyzeSymbolMap(kv) {
  if (kv) {
    try {
      const cached = await kv.get(CA_MARKETS_KEY);
      if (cached && typeof cached === "object" && Object.keys(cached).length > 0) return cached;
    } catch {}
  }
  const [exchanges, markets] = await Promise.all([caGet("/exchanges"), caGet("/future-markets")]);
  if (!Array.isArray(exchanges) || !Array.isArray(markets)) return null;
  const binance = exchanges.find((e) => /^binance$/i.test(String(e?.name || "")));
  if (!binance?.code) return null;
  const map = {};
  for (const m of markets) {
    // 바이낸스 USDT 무기한만 — symbol_on_exchange 가 우리 유니버스 표기(BTCUSDT)와 일치
    if (m?.exchange === binance.code && m?.is_perpetual && m?.quote_asset === "USDT" && m?.symbol_on_exchange && m?.symbol) {
      map[m.symbol_on_exchange] = m.symbol;
    }
  }
  if (Object.keys(map).length === 0) return null;
  if (kv) { try { await kv.set(CA_MARKETS_KEY, map, { ex: 24 * 3600 }); } catch {} }
  return map;
}

/**
 * 심볼별 24h 청산 컨텍스트 — { bySymbol: { BTCUSDT: { liqLongUsd, liqShortUsd, liqLongShare } }, ts }
 * liqLongShare = 롱 청산 비중(0~1) — 1에 가까우면 하락 캐스케이드로 롱이 쓸려나간 상태.
 * 콜 예산(36/사이클) 초과분은 KV 커서 라운드로빈으로 다음 사이클에 커버합니다.
 * 키 미설정·실패 시 bySymbol 빈 객체 — throw 하지 않습니다.
 */
export async function fetchLiquidationContext(symbols = []) {
  const now = Date.now();
  const empty = { bySymbol: {}, ts: now };
  if (!coinalyzeEnabled()) return empty;
  const want = [...new Set((Array.isArray(symbols) ? symbols : []).filter((s) => typeof s === "string" && s))];
  if (want.length === 0) return empty;
  try {
    const kv = await getKvSafe();
    let cached = null;
    if (kv) { try { cached = await kv.get(CA_LIQ_KEY); } catch { cached = null; } }
    const prev = (cached && typeof cached.bySymbol === "object" && cached.bySymbol) || {};
    if (cached && Number.isFinite(cached.ts) && now - cached.ts < CA_LIQ_FRESH_MS
      && want.every((s) => s in prev)) {
      return { bySymbol: Object.fromEntries(want.map((s) => [s, prev[s] ?? null])), ts: cached.ts };
    }
    const map = await loadCoinalyzeSymbolMap(kv);
    if (!map) return empty;
    // 커서 라운드로빈 — 예산 안에서 이번 사이클 분량을 고르고, 나머지는 이전 캐시값 유지
    const cursor = Number.isFinite(cached?.cursor) ? cached.cursor : 0;
    const rotated = want.slice(cursor % want.length).concat(want.slice(0, cursor % want.length));
    const batch = rotated.filter((s) => map[s]).slice(0, CA_CALL_BUDGET);
    const bySymbol = { ...prev };
    const from = Math.floor(now / 1000) - 25 * 3600;
    const to = Math.floor(now / 1000);
    for (let i = 0; i < batch.length; i += CA_CHUNK) {
      const chunk = batch.slice(i, i + CA_CHUNK);
      const rows = await caGet("/liquidation-history", {
        symbols: chunk.map((s) => map[s]).join(","),
        interval: "1hour", from, to, convert_to_usd: "true",
      });
      if (!Array.isArray(rows)) continue; // 429 등 — 이번 청크 스킵(이전 값 유지)
      const byCa = new Map(rows.map((r) => [r?.symbol, r]));
      for (const s of chunk) {
        const hist = byCa.get(map[s])?.history;
        if (!Array.isArray(hist) || hist.length === 0) { bySymbol[s] = bySymbol[s] ?? null; continue; }
        let L = 0, S = 0;
        for (const h of hist) {
          const l = Number(h?.l), sh = Number(h?.s);
          if (Number.isFinite(l)) L += l;
          if (Number.isFinite(sh)) S += sh;
        }
        const total = L + S;
        bySymbol[s] = {
          liqLongUsd: Number(L.toFixed(0)),
          liqShortUsd: Number(S.toFixed(0)),
          liqLongShare: total > 0 ? Number((L / total).toFixed(3)) : null,
        };
      }
    }
    const nextCursor = (cursor + batch.length) % Math.max(1, want.length);
    if (kv) { try { await kv.set(CA_LIQ_KEY, { ts: now, cursor: nextCursor, bySymbol }, { ex: 3600 }); } catch {} }
    return { bySymbol: Object.fromEntries(want.map((s) => [s, bySymbol[s] ?? null])), ts: now };
  } catch (e) {
    console.warn(`[onchain] coinalyze liq 실패: ${e?.message}`);
    return empty;
  }
}

export default { fetchStablecoinLiquidity, fetchExchangeNetflow, cryptoquantEnabled, getOnchainContext, fetchDerivOnchainContext, coinalyzeEnabled, fetchLiquidationContext };
