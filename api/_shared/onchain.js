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
// 모든 함수는 throw 안 함 — 실패/미설정 시 null(호출부 무해).
// ════════════════════════════════════════════════════════════════════

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
 *   ※ CryptoQuant REST 계약은 키 수령 시 _source 식 실측으로 확정. 그 전까진 키 있어도 null
 *      반환하도록 보수적 — 추측 배선으로 잘못된 신호가 매매에 새지 않게(Massive 교훈).
 */
export async function fetchExchangeNetflow(asset) {
  if (!cryptoquantEnabled() || !asset) return null;
  // 계약 미확정 — 키 수령 후 이 블록을 실 endpoint/인증/파싱으로 교체 + 라이브 검증.
  // (현재는 의도적으로 null: 검증 안 된 추측 호출이 라이브 바이어스로 새는 것 방지)
  if (process.env.ZEPTA_CRYPTOQUANT_LIVE !== "1") return null;
  const sym = String(asset).toLowerCase();
  const json = await jget(`${CQ_BASE}/${sym}/exchange-flows/netflow?window=day&limit=1`, {
    headers: { Authorization: `Bearer ${String(process.env.CRYPTOQUANT_API_KEY).trim()}` },
  });
  const row = json?.result?.data?.[0] ?? json?.data?.[0];
  const nf = Number(row?.netflow_total ?? row?.netflow);
  if (!Number.isFinite(nf)) return null;
  return { netflow: nf, bias: nf > 0 ? -1 : nf < 0 ? 1 : 0 }; // 입금(+)→약세(-1), 출금(-)→강세(+1)
}

/** 통합 온체인 컨텍스트 — 일일보고/분석용. 실패 항목은 null. */
export async function getOnchainContext(asset = null) {
  const [liquidity, netflow] = await Promise.all([
    fetchStablecoinLiquidity().catch(() => null),
    asset ? fetchExchangeNetflow(asset).catch(() => null) : Promise.resolve(null),
  ]);
  return { liquidity, netflow };
}

export default { fetchStablecoinLiquidity, fetchExchangeNetflow, cryptoquantEnabled, getOnchainContext };
