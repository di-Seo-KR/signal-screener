// ════════════════════════════════════════════════════════════════════
// display-hysteresis — 표시 풀 side(방향 라벨) 전환 히스테리시스 (표시 전용)
// ────────────────────────────────────────────────────────────────────
// ★ 2026-08-17 (대표 지시 "시그널이 수시로 바뀌면 서비스에 안 좋다"):
//   표시 풀(di:signals:realtime-pool-mtf / di:signals:stock-pool-mtf)의
//   방향 라벨(side)이 사이클마다 자유롭게 뒤집히는 문제를 히스테리시스로 완화.
//
//   ■ 원칙 — "점수는 사실, 방향 라벨은 해석 — 해석의 안정성만 관리한다"
//     · 점수(score)·TF 분해(breakdown)·근거(reason)는 실계산 그대로 노출합니다.
//       점수를 스무딩하면 실측이 아닌 가공 수치가 되므로 절대 하지 않습니다.
//     · side 는 점수의 부호를 사람이 읽는 "해석 라벨"입니다. borderline 에서
//       라벨이 10분마다 깜빡이는 것은 정보가 아니라 잡음이므로, 라벨 전환만
//       2사이클 연속 + 점수 임계 조건으로 지연합니다. 전환 관찰 중이라는
//       사실 자체는 stability.pendingSide 로 정직하게 표기합니다.
//
//   ■ 전환 확정 규칙 (2사이클 연속 + 점수 임계)
//     · 새 raw 방향이 직전 표시 방향과 다르면 즉시 뒤집지 않고 pendingSide 로 기록.
//     · 다음 사이클에도 같은 raw 방향이 관찰되고(2연속), 그 사이클의 점수가
//       전환 임계(기본 58, ZEPTA_FLIP_SCORE_MIN) 이상일 때만 전환 확정.
//     · raw 가 표시 방향으로 되돌아오면 pendingSide 리셋(휩쏘 무시 성공).
//     · pendingSide 유효기간(기본 25분 = 10분 사이클 2회 + 여유): 심볼이 풀에서 몇
//       사이클 빠졌다 재등장하면 "2사이클 연속"이 "2관측 연속(불연속 허용)"으로
//       드리프트하므로, 직전 엔트리가 유효기간보다 오래됐으면 전환 후보를 무시하고
//       홀드(관찰 1사이클째)부터 다시 시작합니다.
//
//   ■ additive 필드 — stability: {
//       sideSince   : 현재 표시 side 가 시작된 시각(ms)
//       pendingSide : 전환 관찰 중인 방향("LONG"|"SHORT") | null
//       flips24h    : 최근 24h 내 확정 전환 횟수
//       flipTs      : (내부 추적용) 확정 전환 시각 배열 — flips24h 산출 근거.
//                     24h 창 밖은 매 사이클 폐기, 최대 50개로 캡.
//     }
//
//   ■ 매매 엔진 무영향 — 이 모듈은 표시 풀 엔트리에만 적용됩니다.
//     엔진이 읽는 di:signals:realtime-pool(거래 풀) 경로에는 어떤 크론도 이
//     모듈을 적용하지 않습니다(btc-cron 은 MTF 표시 풀 적재부에서만 호출).
//   ■ 킬스위치 — ZEPTA_DISPLAY_HYSTERESIS=0 이면 호출측이 통째로 건너뜀(기존 동작).
// ════════════════════════════════════════════════════════════════════

const FLIP_SCORE_MIN_DEFAULT = 58;
const FLIP_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_FLIP_TS = 50; // flipTs 배열 상한 — KV 엔트리 비대 방지(10분 크론 24h 최대 ~72건 대비)
const PENDING_TTL_MS_DEFAULT = 25 * 60 * 1000; // pendingSide 유효기간 — 10분 사이클 2회 + 여유 5분

export function hysteresisEnabled() {
  return process.env.ZEPTA_DISPLAY_HYSTERESIS !== "0";
}

export function flipScoreMin() {
  const v = Number(process.env.ZEPTA_FLIP_SCORE_MIN);
  return Number.isFinite(v) && v > 0 && v <= 100 ? v : FLIP_SCORE_MIN_DEFAULT;
}

// side 정규화 — coin-scores/stock-scores 의 normSide 와 동일 규칙
function normSide(s) {
  const v = String(s || "").toUpperCase();
  return v === "LONG" || v === "SHORT" ? v : null;
}

// 풀 배열 → asset 별 최신(ts 최대) 엔트리 맵 — 직전 사이클 상태 조회용
export function latestByAsset(pool) {
  const map = new Map();
  for (const e of Array.isArray(pool) ? pool : []) {
    if (!e || !e.asset) continue;
    const prev = map.get(e.asset);
    if (!prev || (e.ts || 0) > (prev.ts || 0)) map.set(e.asset, e);
  }
  return map;
}

/**
 * 새 표시 엔트리 1건에 히스테리시스 적용 — 엔트리를 제자리(in-place)에서 수정.
 *
 * @param {object} entry      이번 사이클의 새 엔트리 (side/type/score 는 raw 실계산값)
 * @param {object} prevEntry  직전 풀에서 찾은 같은 asset 의 최신 엔트리 (없으면 undefined)
 * @param {object} [opts]     { now, flipScoreMin, pendingTtlMs } — 단위 테스트용 주입
 * @returns {{ flipped: boolean, held: boolean }}
 *   flipped — 이번 사이클에 전환이 확정됨 / held — raw 는 반대지만 이전 라벨 유지
 */
export function applySideHysteresis(entry, prevEntry, opts = {}) {
  const now = Number.isFinite(opts.now) ? opts.now : Date.now();
  const minScore = Number.isFinite(opts.flipScoreMin) ? opts.flipScoreMin : flipScoreMin();

  const rawSide = normSide(entry?.side)
    || (entry?.type === "BUY" ? "LONG" : entry?.type === "SELL" ? "SHORT" : null);
  if (!entry || !rawSide) return { flipped: false, held: false };

  const prevSide = normSide(prevEntry?.side);
  const prevStab = prevEntry && prevEntry.stability && typeof prevEntry.stability === "object"
    ? prevEntry.stability : null;
  // 확정 전환 이력 — 24h 창 밖은 폐기 (flips24h 는 항상 이 배열 길이 = 실측 카운트)
  const flipTs = (Array.isArray(prevStab?.flipTs) ? prevStab.flipTs : [])
    .filter((t) => Number.isFinite(t) && now - t < FLIP_WINDOW_MS)
    .slice(-MAX_FLIP_TS);

  // 직전 상태 없음(신규 상장·풀 공백 후 재등장) — raw 그대로 확정 시작
  if (!prevSide) {
    entry.stability = { sideSince: now, pendingSide: null, flips24h: flipTs.length, flipTs };
    return { flipped: false, held: false };
  }

  const sideSince = Number.isFinite(prevStab?.sideSince) ? prevStab.sideSince : (prevEntry.ts || now);

  // 방향 유지 — 관찰 중이던 전환 후보 리셋(휩쏘가 실제로 되돌아온 케이스)
  if (rawSide === prevSide) {
    entry.stability = { sideSince, pendingSide: null, flips24h: flipTs.length, flipTs };
    return { flipped: false, held: false };
  }

  // raw 가 반대 방향 — 전환 확정: 직전 사이클도 같은 방향 관찰(pendingSide) + 이번 점수 ≥ 임계
  const score = parseFloat(entry.score) || 0;
  // ★ pendingSide 유효기간 가드 — 직전 엔트리가 오래됐으면(풀 이탈 등 관측 공백) 전환
  //   후보를 무시하고 홀드부터 재시작. "2사이클 연속" 규칙이 불연속 2관측으로 드리프트 방지.
  const pendingTtl = Number.isFinite(opts.pendingTtlMs) ? opts.pendingTtlMs : PENDING_TTL_MS_DEFAULT;
  const prevPending = now - (prevEntry.ts || 0) <= pendingTtl ? normSide(prevStab?.pendingSide) : null;
  if (prevPending === rawSide && score >= minScore) {
    entry.side = rawSide; // type-only 엔트리 방어적 정규화 (일반 엔트리는 이미 rawSide — 무해)
    const nextFlipTs = [...flipTs, now].slice(-MAX_FLIP_TS);
    entry.stability = { sideSince: now, pendingSide: null, flips24h: nextFlipTs.length, flipTs: nextFlipTs };
    return { flipped: true, held: false };
  }

  // 미확정 — 라벨만 이전 side 유지. 점수·근거·TF 분해는 실계산 그대로(스무딩 금지).
  entry.side = prevSide;
  entry.type = prevSide === "LONG" ? "BUY" : "SELL";
  entry.stability = { sideSince, pendingSide: rawSide, flips24h: flipTs.length, flipTs };
  return { flipped: false, held: true };
}
