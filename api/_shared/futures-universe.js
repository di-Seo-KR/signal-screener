// api/_shared/futures-universe.js
//
// 바이낸스 USDⓈ-M 선물 동적 코인 유니버스 — 유동성(24h 거래대금) 상위 N종 자동 선별.
//
// ★ 2026-06-11 (대표 승인 2안): 기존 하드코딩 30종 → 거래소 메타 기반 자동 선별로 전환.
//   - exchangeInfo 에서 status=TRADING · PERPETUAL · USDT 마진 페어만 → 폐지 심볼 자동 제외
//     (MATICUSDT 같은 상장폐지 잔존 문제가 구조적으로 재발 불가)
//   - 24h quoteVolume 상위 N종만 → 저유동성 알트(슬리피지·노이즈) 자동 배제
//   - 스테이블-스테이블 페어(USDC/USDT 등) 제외 — 신호 의미 없음
//
// KV: di:signals:futures-universe = { generatedAt, size, entries: [{asset, base, symbol, quoteVolume}] }
//   - asset  : "BTC/USD" 포맷 (btc-cron CRYPTO_ASSETS 하위호환)
//   - base   : 바이낸스 선물 baseAsset ("BTC", "1000SHIB" 등 — 1000-단위 페어는 그대로)
//   - symbol : 실제 선물 심볼 ("BTCUSDT", "1000SHIBUSDT")
//
// 갱신 주기: btc-cron 이 6시간 초과 시 refresh. 거래소 fetch 실패 시 stale 캐시 사용,
// 캐시도 없으면 null → 호출부가 정적 리스트로 폴백 (fail-safe, 신호 파이프라인 무중단).

import { getExchangeInfo, get24hrTickers } from "./binance-client.js";

export const UNIVERSE_KV_KEY = "di:signals:futures-universe";
// ★ 2026-09-04 (대표 지시 "코인 시그널 갯수 늘려줘" → 같은 날 "100종까지"): 50 → 65 → 100.
//   env ZEPTA_UNIVERSE_SIZE 로 조정(10~120). 100+버퍼 15 = 최대 115종은 btc-cron 300s 예산의
//   ~2.3배 부하라, btc-cron 쪽에 스캔 시간예산 가드(240s) + 순환 시작 오프셋을 함께 배선 —
//   예산 초과로 뒤쪽 자산이 밀려도 런마다 시작점이 돌아 몇 런 안에 전 자산이 커버됩니다.
export const UNIVERSE_SIZE = (() => {
  const v = Number(process.env.ZEPTA_UNIVERSE_SIZE);
  return Number.isFinite(v) && v >= 10 && v <= 120 ? Math.round(v) : 100;
})();
// ★ 멤버십 히스테리시스 — 대표 제보 "몇몇 코인이 있다가 없어지고 자주 그래":
//   순위 경계(기존 50위) 부근 코인이 6시간마다 거래대금 순위로 들락거리며 보드에서
//   깜빡이던 문제. 신규 편입은 상위 SIZE 위까지만, **기존 멤버는 SIZE+버퍼 위까지 유지**.
const EXIT_BUFFER = 15;
const REFRESH_MS = 6 * 60 * 60 * 1000; // 6시간

// 스테이블코인 베이스 — 유동성 상위에 들어와도 매매 신호 대상 아님
const STABLE_BASES = new Set(["USDC", "FDUSD", "TUSD", "BUSD", "DAI", "USDP", "EUR", "AEUR", "USD1", "USDE", "XUSD"]);

/** 거래소 메타 + 24h 거래대금으로 유니버스 재산출 → KV 적재. 실패 시 throw. */
export async function refreshUniverse(kv, { size = UNIVERSE_SIZE } = {}) {
  const [info, tickers] = await Promise.all([getExchangeInfo(), get24hrTickers()]);
  const symbols = Array.isArray(info?.symbols) ? info.symbols : [];

  const volBySym = {};
  for (const t of Array.isArray(tickers) ? tickers : []) {
    const v = parseFloat(t?.quoteVolume);
    if (t?.symbol && Number.isFinite(v)) volBySym[t.symbol] = v;
  }

  // ★ 2026-07-08 스윙 전환 — 상장연령 가드 (진단: 30일 손실 100%가 마이크로캡 롱,
  //   TRIA/BIRB/ALLO/4 는 전부 상장 9개월 미만 신규). 신규 상장은 24h 거래대금 스파이크로
  //   top50 에 자동 편입되지만 가격 이력이 짧아 전략·백테스트 분포 밖 → 유니버스에서 제외.
  //   exchangeInfo 의 onboardDate(ms) 실측 확인(2026-07-08). 필드 누락 시 통과(포맷 변경 내성).
  //   ZEPTA_UNIVERSE_MIN_AGE_DAYS 로 조정, 0 이면 비활성.
  const _minAgeDaysRaw = Number(process.env.ZEPTA_UNIVERSE_MIN_AGE_DAYS);
  const minAgeDays = Number.isFinite(_minAgeDaysRaw) ? _minAgeDaysRaw : 180;
  const minAgeMs = minAgeDays * 24 * 60 * 60 * 1000;
  const nowMs = Date.now();

  const ranked = symbols
    .filter((s) =>
      s?.status === "TRADING" &&
      s?.contractType === "PERPETUAL" &&
      s?.quoteAsset === "USDT" &&
      s?.baseAsset && !STABLE_BASES.has(s.baseAsset) &&
      (minAgeDays <= 0 || !Number.isFinite(s?.onboardDate) || nowMs - s.onboardDate >= minAgeMs)
    )
    .map((s) => ({
      asset: `${s.baseAsset}/USD`,
      base: s.baseAsset,
      symbol: s.symbol,
      quoteVolume: volBySym[s.symbol] || 0,
    }))
    .filter((e) => e.quoteVolume > 0)
    .sort((a, b) => b.quoteVolume - a.quoteVolume);

  // ★ 멤버십 히스테리시스 — 진입: 순위 ≤ size, 유지: 기존 멤버는 순위 ≤ size+EXIT_BUFFER.
  //   경계 churn(들락거림)만 막는 규칙이라 진짜로 유동성이 빠진 코인은 버퍼 밖에서 자연 이탈.
  let prevBases = new Set();
  try {
    const prev = await kv.get(UNIVERSE_KV_KEY);
    for (const e of prev?.entries || []) if (e?.base) prevBases.add(e.base);
  } catch { /* 이전 캐시 없으면 순수 top-N (초기 1회) */ }
  const entries = ranked.filter((e, rank) =>
    rank < size || (rank < size + EXIT_BUFFER && prevBases.has(e.base))
  );

  // 거래소 응답이 비정상적으로 작으면(부분 장애 등) 기존 캐시를 덮어쓰지 않도록 거부
  if (entries.length < 10) throw new Error(`universe too small: ${entries.length}`);

  const payload = { generatedAt: new Date().toISOString(), size: entries.length, entries };
  try { await kv.set(UNIVERSE_KV_KEY, payload); } catch { /* 캐시 실패해도 이번 회차 사용은 가능 */ }
  return payload;
}

/** 캐시 우선 로드 — 6시간 넘으면 refresh 시도, 실패 시 stale 캐시, 그것도 없으면 null. */
export async function loadUniverse(kv, { maxAgeMs = REFRESH_MS } = {}) {
  let cached = null;
  try { cached = await kv.get(UNIVERSE_KV_KEY); } catch { cached = null; }
  const age = cached?.generatedAt ? Date.now() - Date.parse(cached.generatedAt) : Infinity;
  // ★ 2026-09-04: 사이즈 설정이 커졌는데 캐시가 옛 규모면 TTL 을 기다리지 않고 즉시 재산출
  //   (50→100 확대가 최대 6시간 지연되던 문제). 축소 방향은 TTL 대로(불필요한 재산출 방지).
  const sizeOutdated = Array.isArray(cached?.entries) && cached.entries.length < UNIVERSE_SIZE * 0.9;
  if (Array.isArray(cached?.entries) && cached.entries.length && age < maxAgeMs && !sizeOutdated) return cached;
  try {
    return await refreshUniverse(kv);
  } catch {
    return Array.isArray(cached?.entries) && cached.entries.length ? cached : null;
  }
}

/** 유니버스 → { BASE: SYMBOL } 매핑 (예: { BTC: "BTCUSDT", "1000SHIB": "1000SHIBUSDT" }) */
export function universeSymbolMap(universe) {
  const map = {};
  for (const e of universe?.entries || []) {
    if (e?.base && e?.symbol) map[e.base] = e.symbol;
  }
  return map;
}

export default { refreshUniverse, loadUniverse, universeSymbolMap, UNIVERSE_KV_KEY, UNIVERSE_SIZE };
