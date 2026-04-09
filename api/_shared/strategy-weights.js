// ════════════════════════════════════════════════════════════════════
// Zepta — Strategy Family Weight Tuner
// shadow-summary 의 byFamily 성과를 읽어 family 별 가중치를 산출.
// engine 의 rankSignals 정렬에 곱해서 잘 작동하는 family 를 우선시킨다.
//
// 가중치 산출 로직:
//   trades < MIN_TRADES (10)        → 1.0  (데이터 부족, 중립)
//   winRate + PF + avgPnL>0 평가    → 0.6 ~ 1.5 사이 clamp
// ════════════════════════════════════════════════════════════════════

const MIN_TRADES = 10;
const WEIGHT_MIN = 0.6;
const WEIGHT_MAX = 1.5;
const NEUTRAL = 1.0;

const GLOBAL_PROBE_USER = "__zepta_global_probe__";

/**
 * shadow-summary 한 건에서 family 별 가중치 맵을 산출.
 * @param {object} sum  shadow-summary 객체 (byFamily 포함)
 * @returns {Record<string, number>}  { trend: 1.2, breakout: 0.8, ... }
 */
export function computeWeightsFromSummary(sum) {
  const out = {};
  if (!sum || !sum.byFamily) return out;
  for (const [fam, s] of Object.entries(sum.byFamily)) {
    if (!s || (s.trades || 0) < MIN_TRADES) {
      out[fam] = NEUTRAL;
      continue;
    }
    const winRate = s.trades > 0 ? (s.wins || 0) / s.trades : 0;
    const avgPnL = s.trades > 0 ? (s.netPnL || 0) / s.trades : 0;
    // 0.5 winRate = neutral; +0.5 winRate adds 0.4
    const wrBonus = (winRate - 0.5) * 0.8;
    const pnlBonus = avgPnL > 0 ? 0.2 : -0.2;
    const raw = NEUTRAL + wrBonus + pnlBonus;
    out[fam] = Math.max(WEIGHT_MIN, Math.min(WEIGHT_MAX, raw));
  }
  return out;
}

/**
 * KV 에서 user 의 shadow-summary → 가중치 맵.
 * 실패 시 빈 객체(=모두 neutral) 반환. 가중치는 항상 안전.
 */
export async function loadFamilyWeights(kv, userId) {
  try {
    const key = `di:real:user:${userId}:shadow-summary`;
    const sum = await kv.get(key);
    if (!sum) return {};
    return computeWeightsFromSummary(sum);
  } catch {
    return {};
  }
}

/**
 * 글로벌 probe + 본인 ledger 를 합쳐 더 강건한 가중치 산출.
 * 본인 데이터가 부족하면 글로벌 probe 데이터로 보정.
 */
export async function loadFamilyWeightsRobust(kv, userId) {
  const own = await loadFamilyWeights(kv, userId);
  if (userId === GLOBAL_PROBE_USER) return own;
  const probe = await loadFamilyWeights(kv, GLOBAL_PROBE_USER);
  // 머지: own 우선, 없는 family 만 probe 로 채움
  return { ...probe, ...own };
}

/**
 * rankSignals 결과에 family 가중치를 적용해 재정렬한다.
 * 정렬 키 = (confidence + score/100) * weight  (sizeHint tiebreak 유지)
 *
 * @param {Array} rankedSignals   signal-extractor.rankSignals(...) 결과
 * @param {Record<string,number>} weights  computeWeightsFromSummary 결과
 * @returns {Array}  재정렬된 시그널 배열
 */
export function applyWeightsToRanking(rankedSignals, weights) {
  if (!Array.isArray(rankedSignals) || rankedSignals.length === 0) return rankedSignals;
  if (!weights || Object.keys(weights).length === 0) return rankedSignals;
  const scored = rankedSignals.map((s) => {
    const fam = s.strategyFamily || s.family || "unknown";
    const w = weights[fam] ?? NEUTRAL;
    const baseScore = (s.confidence || 0) + (s.score || 0) / 100;
    return { sig: s, sortKey: baseScore * w, weight: w };
  });
  scored.sort((a, b) => {
    if (b.sortKey !== a.sortKey) return b.sortKey - a.sortKey;
    return (b.sig.sizeHint || 0) - (a.sig.sizeHint || 0);
  });
  return scored.map((x) => ({ ...x.sig, _famWeight: x.weight }));
}

export default {
  computeWeightsFromSummary,
  loadFamilyWeights,
  loadFamilyWeightsRobust,
  applyWeightsToRanking,
};
