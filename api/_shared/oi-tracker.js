// api/_shared/oi-tracker.js
//
// 선물 미결제약정(Open Interest) 변화 추적 — OI/가격 확인 알파용.
//   고전 규칙: 추세 방향 신호 + OI↑ = 새 자금 유입(확신), OI↓ = 청산/커버(소진).
//   → 신호 방향을 OI 변화가 확인하면 확신 소폭↑, 발산하면↓ (btc-cron 에서 적용).
//
// 직전 cron 실행 때의 OI 를 KV 스냅샷에 저장해두고, 이번 OI 와 비교해 변화율 산출.
// (openInterestHist 같은 별도 history 엔드포인트 없이 cron 간 diff 로 가볍게.)
//
// KV: di:market:oi-snapshot = { [SYMBOL]: { oi:number, ts:number } }

import { getOpenInterest } from "./binance-client.js";

const SNAPSHOT_KEY = "di:market:oi-snapshot";
const MAX_AGE_MS = 6 * 60 * 60 * 1000; // 6시간 넘은 스냅샷은 비교 안 함(신뢰도↓)

/**
 * 심볼별 OI 변화율 맵 반환 + 스냅샷 갱신.
 * @param {object} kv  @vercel/kv 인스턴스
 * @param {string[]} symbols  바이낸스 심볼 (예: ["BTCUSDT", ...])
 * @returns {Promise<{changeMap: object, fetched: number}>}  changeMap[SYMBOL] = 변화율(소수, 예 +0.04)
 */
export async function getOIChangeMap(kv, symbols) {
  const changeMap = {};
  let prev = {};
  try { prev = (await kv.get(SNAPSHOT_KEY)) || {}; } catch { prev = {}; }

  const now = Date.now();
  const next = {};
  // 병렬 fetch (실패분은 자동 제외 → cron 안전)
  const results = await Promise.allSettled(symbols.map((s) => getOpenInterest({ symbol: s })));
  let fetched = 0;
  symbols.forEach((sym, i) => {
    const r = results[i];
    const oi = r.status === "fulfilled" ? r.value : null;
    if (oi == null || !(oi > 0)) return;
    fetched += 1;
    next[sym] = { oi, ts: now };
    const p = prev[sym];
    if (p && p.oi > 0 && (now - (p.ts || 0)) <= MAX_AGE_MS) {
      changeMap[sym] = (oi - p.oi) / p.oi; // 직전 대비 변화율
    }
  });

  // 이번 OI 스냅샷 저장 (다음 회차 비교용). 못 받은 심볼은 직전 값 유지하되,
  //   MAX_AGE 초과한 stale 키는 정리 → KV 객체 무한 누적 방지.
  const merged = { ...prev, ...next };
  for (const k of Object.keys(merged)) {
    if (!next[k] && (now - (merged[k]?.ts || 0)) > MAX_AGE_MS) delete merged[k];
  }
  try { await kv.set(SNAPSHOT_KEY, merged); } catch { /* 무시 */ }

  return { changeMap, fetched };
}

export default { getOIChangeMap };
