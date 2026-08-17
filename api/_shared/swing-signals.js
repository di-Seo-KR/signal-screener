// ════════════════════════════════════════════════════════════════════
// Zepta — 스윙·중장기 관점 시그널 규칙 (정보 제공 전용)
// ────────────────────────────────────────────────────────────────────
// 대표 지시(2026-08-17): "자동매매 기준이 아닌, 스윙이나 장투에 걸맞는
// 시그널로 진입하기에 매력적인 코인과 주식이 있을 때마다 알림".
//
// ★ 완전 분리 고지 (정직성):
//   이 모듈은 표시·알림 전용입니다. 매매 엔진(api/real-trading/engine.js)이
//   소비하는 어떤 키·필드도 읽거나 쓰지 않습니다. 입력은 기존 *표시* 풀
//   (di:signals:realtime-pool-mtf / di:signals:stock-pool-mtf) 읽기 전용이며
//   신규 외부 API 호출도 없습니다. 알림의 모든 수치는 풀에 적재된
//   실계산 값(breakdown·score·sr)만 사용합니다 — 추정치·가공 성과 없음.
//
// ★ 사전등록 2026-08-17 — 튜닝 금지.
//   아래 SWING_RULES 상수와 규칙 ①~⑥은 결과를 보고 사후 조정하지 않습니다
//   (오버피팅·체리피킹 방지). 변경이 필요하면 새 version 문자열로 별도
//   등록하고 di:swing:log 의 세대 구분에 남깁니다.
//
//   LONG 기준 (SHORT 는 대칭):
//   ① 주봉(1w)·일봉(1d) side 합의 — 둘 다 LONG 이고, 종합(MTF) 방향도 일치
//   ② 종합 score ≥ 65
//   ③ 4h 가 반대(SHORT)면 감점이 아니라 '대기'(WAIT) — 추격 진입 방지
//   ④ sr 기준 가장 가까운 지지까지 거리 ≤ 4%  또는
//      피벗(piv) 상방 돌파 후 리테스트 구간(피벗 위 ≤ 2%) — 돌파된 저항이
//      지지로 전환된 직후를 피벗 근접으로 근사(사전등록 정의)
//   ⑤ 과열 배제 — 4h·1h 가 *같은 방향으로* 극단(score ≥ 90)이 아닐 것.
//      (반대 방향 극단은 ③의 '대기'가 담당 — 여기의 '극단'은 단기 과열
//       상태에서의 추격 진입 위험을 뜻함. 사전등록 해석 고정)
//   ⑥ 신선도 — 주식은 dataTs 가 직전 거래 세션 이내(24h, '당일성'의
//      사전등록 정의: 주말·휴장 뒤 낡은 데이터로는 알림하지 않음).
//      코인은 풀 유지 윈도우(4h) 이내. 코인 유동성 조건은 풀 자체가
//      btc-cron 의 유동성 상위 동적 유니버스(~50종)만 적재하므로 충족.
// ════════════════════════════════════════════════════════════════════

export const SWING_RULES = Object.freeze({
  version: "2026-08-17.v1",       // 사전등록 세대 — 규칙 변경 시에만 올림
  MIN_SCORE: 65,                  // ② 종합 스코어 하한 (0~100)
  SR_NEAR_PCT: 4.0,               // ④ 지지(롱)/저항(숏)까지 허용 거리 %
  RETEST_PIVOT_PCT: 2.0,          // ④' 피벗 돌파 후 리테스트 인정 폭 %
  OVERHEAT_TF_SCORE: 90,          // ⑤ 4h·1h 같은 방향 극단 점수
  COIN_FRESH_MS: 4 * 3600 * 1000,       // ⑥ 코인 — 풀 유지 윈도우와 동일
  STOCK_FRESH_MS: 24 * 3600 * 1000,     // ⑥ 주식 — dataTs 당일성(직전 세션)
  COOLDOWN_MS: 7 * 24 * 3600 * 1000,    // 동일 심볼 재알림 쿨다운 7일
  MAX_PICKS: 3,                   // 1회 발송 최대 종목 수(코인+주식 합산)
});

// ── 베이스 티커 추출 — coin-scores.js 와 동일 규칙 (풀의 asset 은
//    "BTC/USD"·"BTC"·"BTCUSDT" 등 혼재) ──
export function baseTicker(asset) {
  let a = String(asset || "").toUpperCase().trim();
  if (!a) return "";
  if (a.includes("/")) a = a.split("/")[0];
  a = a.replace(/USDT$/, "").replace(/USD$/, "");
  return a;
}

// breakdown 항목({type:"BUY"|"SELL", score}) → "LONG"|"SHORT"|null
function tfSide(item) {
  if (!item || !item.type) return null;
  if (item.type === "BUY") return "LONG";
  if (item.type === "SELL") return "SHORT";
  return null;
}
function tfScore(item) {
  const s = Math.round(parseFloat(item?.score) || 0);
  return Number.isFinite(s) ? s : 0;
}

// entry 의 side 정규화 (coin-scores / stock-scores 와 동일 규칙)
function entrySide(entry) {
  const s = String(entry?.side || "").toUpperCase();
  if (s === "LONG" || s === "SHORT") return s;
  const t = String(entry?.type || "").toUpperCase();
  if (t === "BUY") return "LONG";
  if (t === "SELL") return "SHORT";
  return null;
}

// ── 규칙 ④ 레벨 근접 판정 ──
// 반환: { pass, mode:"near-level"|"pivot-retest"|null, distPct, level }
//   distPct — near-level: 레벨까지 부호 거리(%). pivot-retest: 피벗과의 이격(%).
//   level   — 판정에 사용된 가격 레벨.
function levelProximity(sr, side, R) {
  if (!sr || !(sr.px > 0)) return { pass: false, mode: null, distPct: null, level: null };
  const px = sr.px;
  if (side === "LONG") {
    // 가장 가까운 지지: s[].d 는 음수(지지가 아래) — 0 에 가장 가까운 것
    const supports = (Array.isArray(sr.s) ? sr.s : []).filter((x) => x && Number.isFinite(x.d) && x.d < 0);
    if (supports.length > 0) {
      const nearest = supports.reduce((a, b) => (a.d > b.d ? a : b));
      if (Math.abs(nearest.d) <= R.SR_NEAR_PCT) {
        return { pass: true, mode: "near-level", distPct: Math.abs(nearest.d), level: nearest.p };
      }
    }
    // 리테스트 근사: 피벗 상방 돌파 직후(피벗 위 ≤ RETEST_PIVOT_PCT%)
    if (Number.isFinite(sr.piv) && sr.piv > 0 && px > sr.piv) {
      const above = (px / sr.piv - 1) * 100;
      if (above <= R.RETEST_PIVOT_PCT) {
        return { pass: true, mode: "pivot-retest", distPct: above, level: sr.piv };
      }
    }
    return { pass: false, mode: null, distPct: null, level: null };
  }
  // SHORT 대칭 — 가장 가까운 저항(r[].d 양수)
  const resists = (Array.isArray(sr.r) ? sr.r : []).filter((x) => x && Number.isFinite(x.d) && x.d > 0);
  if (resists.length > 0) {
    const nearest = resists.reduce((a, b) => (a.d < b.d ? a : b));
    if (nearest.d <= R.SR_NEAR_PCT) {
      return { pass: true, mode: "near-level", distPct: nearest.d, level: nearest.p };
    }
  }
  if (Number.isFinite(sr.piv) && sr.piv > 0 && px < sr.piv) {
    const below = (1 - px / sr.piv) * 100;
    if (below <= R.RETEST_PIVOT_PCT) {
      return { pass: true, mode: "pivot-retest", distPct: below, level: sr.piv };
    }
  }
  return { pass: false, mode: null, distPct: null, level: null };
}

// ── 단일 엔트리 평가 ──
// kind: "coin" | "stock". 반환:
//   { symbol, displayName, kind, market, side, score, px,
//     status: "PASS"|"WAIT"|"FAIL", reasons: string[],   // FAIL/WAIT 사유(진단용)
//     basisLines: string[2]|null,                        // 알림 근거 2줄(실계산 값)
//     levels: { support, resistance } | null }
export function evaluateSwingEntry(entry, kind, now = Date.now(), R = SWING_RULES) {
  const reasons = [];
  const symbol = kind === "coin" ? baseTicker(entry?.asset) : String(entry?.asset || "");
  const name = kind === "stock" ? (entry?.name || null) : null;
  const displayName = name ? `${name}(${symbol})` : symbol;
  const market = kind === "coin" ? "coin" : (entry?.market || null);
  const score = Math.round(parseFloat(entry?.score) || 0);
  const sr = entry?.sr || null;
  const px = sr && Number.isFinite(sr.px) ? sr.px : null;
  const base = { symbol, displayName, kind, market, score, px, basisLines: null, levels: null };

  if (!symbol) return { ...base, side: null, status: "FAIL", reasons: ["심볼 없음"] };

  // ⑥ 신선도 (먼저 거름 — 낡은 데이터로는 어떤 판정도 하지 않음)
  if (kind === "coin") {
    if (!(entry.ts > 0) || now - entry.ts > R.COIN_FRESH_MS) reasons.push("신선도(코인 4h 초과)");
  } else {
    if (!(entry.dataTs > 0) || now - entry.dataTs > R.STOCK_FRESH_MS) reasons.push("신선도(주식 dataTs 당일성 미충족)");
  }

  // ① 주봉·일봉 합의 + 종합 방향 일치
  const bd = entry?.breakdown || null;
  const w = tfSide(bd?.["1w"]);
  const d = tfSide(bd?.["1d"]);
  const comp = entrySide(entry);
  let side = null;
  if (!w || !d || w !== d) {
    reasons.push("주봉·일봉 합의 없음");
  } else if (comp !== w) {
    reasons.push("종합 방향이 주·일봉 합의와 불일치");
  } else {
    side = w;
  }

  // ② 종합 스코어
  if (score < R.MIN_SCORE) reasons.push(`종합 ${score} < ${R.MIN_SCORE}`);

  // side 미확정이면 이하 방향 의존 규칙은 판정 불가 — 여기서 종료
  if (!side) return { ...base, side: null, status: "FAIL", reasons };

  // ⑤ 과열 배제 — 4h·1h 가 같은 방향으로 극단(≥ OVERHEAT_TF_SCORE)이면 제외
  const h4 = bd?.["4h"] || null;
  const h1 = bd?.["1h"] || null;
  const hot = (x) => x && tfSide(x) === side && tfScore(x) >= R.OVERHEAT_TF_SCORE;
  if (hot(h4) || hot(h1)) reasons.push("과열(4h/1h 극단)");

  // ④ 레벨 근접
  const prox = levelProximity(sr, side, R);
  if (!prox.pass) reasons.push("지지/저항 근접 조건 미충족");

  if (reasons.length > 0) return { ...base, side, status: "FAIL", reasons };

  // ③ 4h 반대 → '대기' (하드 탈락 전부 통과한 뒤에만 의미 — 추격 방지 보류)
  const h4Side = tfSide(h4);
  if (h4Side && h4Side !== side) {
    return { ...base, side, status: "WAIT", reasons: ["4h 반대 — 대기"] };
  }

  // ── 통과 — 알림 근거 2줄(실계산 값만) + 주요 레벨 ──
  const dirKo = side === "LONG" ? "상승" : "하락";
  const line1 = `주봉·일봉 모두 ${dirKo} 합의 (종합 ${score}점)`;
  const d1 = prox.distPct != null ? prox.distPct.toFixed(1) : "?";
  let line2;
  if (side === "LONG") {
    line2 = prox.mode === "near-level"
      ? `지지선이 ${d1}% 아래 — 빠져도 받쳐줄 수 있는 가격대가 가까워`
      : `저항 돌파 후 되돌림 구간 (기준선 위 ${d1}%)`;
  } else {
    line2 = prox.mode === "near-level"
      ? `저항선이 ${d1}% 위 — 반등해도 막힐 수 있는 가격대가 가까워`
      : `지지 이탈 후 되돌림 구간 (기준선 아래 ${d1}%)`;
  }

  const nearestSupport = (Array.isArray(sr?.s) && sr.s.length > 0)
    ? sr.s.reduce((a, b) => (a.d > b.d ? a : b)).p : null;
  const nearestResist = (Array.isArray(sr?.r) && sr.r.length > 0)
    ? sr.r.reduce((a, b) => (a.d < b.d ? a : b)).p : null;

  return {
    ...base, side, status: "PASS", reasons: [],
    basisLines: [line1, line2],
    levels: { support: nearestSupport, resistance: nearestResist },
  };
}

// ── 풀 → 자산별 최신 1개 dedupe (coin-scores / stock-scores 와 동일 규칙) ──
function dedupeLatest(pool, keyFn) {
  const by = new Map();
  for (const e of (Array.isArray(pool) ? pool : [])) {
    if (!e) continue;
    const k = keyFn(e);
    if (!k) continue;
    const prev = by.get(k);
    if (!prev || (e.ts || 0) > (prev.ts || 0)) by.set(k, e);
  }
  return Array.from(by.values());
}

// ── 두 풀 종합 평가 ──
// 반환: { pass: 후보[], wait: 후보[], counts: { coins, stocks, pass, wait, fail } }
export function selectSwingCandidates({ coinPool, stockPool, now = Date.now(), rules = SWING_RULES }) {
  const coins = dedupeLatest(coinPool, (e) => baseTicker(e.asset));
  const stocks = dedupeLatest(stockPool, (e) => e.asset);
  const pass = [], wait = [];
  let fail = 0;
  for (const e of coins) {
    const r = evaluateSwingEntry(e, "coin", now, rules);
    if (r.status === "PASS") pass.push(r);
    else if (r.status === "WAIT") wait.push(r);
    else fail++;
  }
  for (const e of stocks) {
    const r = evaluateSwingEntry(e, "stock", now, rules);
    if (r.status === "PASS") pass.push(r);
    else if (r.status === "WAIT") wait.push(r);
    else fail++;
  }
  return {
    pass, wait,
    counts: { coins: coins.length, stocks: stocks.length, pass: pass.length, wait: wait.length, fail },
  };
}

// 쿨다운 키 — 코인·주식 티커 충돌 방지(kind 접두)
export function cooldownKey(c) {
  return `${c.kind}:${c.symbol}`;
}

// 쿨다운 필터 — notifiedMap: { [cooldownKey]: lastNotifiedTs(ms) }
export function filterByCooldown(candidates, notifiedMap, now = Date.now(), R = SWING_RULES) {
  const m = notifiedMap && typeof notifiedMap === "object" ? notifiedMap : {};
  return (candidates || []).filter((c) => {
    const last = m[cooldownKey(c)];
    return !(Number.isFinite(last) && now - last < R.COOLDOWN_MS);
  });
}

// 상위 선별 — 점수순, 최대 max (코인+주식 합산)
export function pickTop(candidates, max = SWING_RULES.MAX_PICKS) {
  return [...(candidates || [])].sort((a, b) => b.score - a.score).slice(0, max);
}

export default {
  SWING_RULES, baseTicker, evaluateSwingEntry, selectSwingCandidates,
  cooldownKey, filterByCooldown, pickTop,
};
