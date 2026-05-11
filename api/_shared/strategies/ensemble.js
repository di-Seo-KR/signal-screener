// ════════════════════════════════════════════════════════
// Strategy: ensemble (다전략 합의)
// 봇: meme-trend (기본 fallback) + 추후 안정 봇용
// ────────────────────────────────────────────────────────
// 핵심 아이디어: trend-follow / mean-revert / breakout / momentum-rotation
// 의 시그널을 동시에 돌려서 3개 이상이 같은 방향에 합의할 때만 발동.
// 가장 보수적이지만 가장 신뢰도 높은 신호. confidence 자동 A 부여.
//
// meme-trend 봇에 매핑: 밈코인은 노이즈가 많아 단일 전략으론 자주 잘못
// 진입 → 다전략 합의로 신뢰도 끌어올림.
// ════════════════════════════════════════════════════════

import { runTrendFollow } from "./trend-follow.js";
import { runMeanRevert } from "./mean-revert.js";
import { runBreakout } from "./breakout.js";
import { runMomentumRotation } from "./momentum-rotation.js";

const FAMILY = "ensemble";

export function runEnsemble(input) {
  const sigs = [
    runTrendFollow(input),
    runMeanRevert(input),
    runBreakout(input),
    runMomentumRotation(input),
  ].filter(Boolean);

  if (sigs.length < 2) return null; // 최소 2개 전략 합의 필요

  // 방향 합의 카운트
  let longCount = 0, shortCount = 0;
  const families = new Set();
  const reasons = [];
  let avgScore = 0;
  for (const s of sigs) {
    if (s.side === "LONG") longCount++;
    if (s.side === "SHORT") shortCount++;
    families.add(s.family);
    reasons.push(`${s.family}=${s.side}`);
    avgScore += s.score || 0;
  }
  avgScore = sigs.length > 0 ? avgScore / sigs.length : 0;

  const agree = Math.max(longCount, shortCount);
  // 3 전략 합의 시 강 신호, 2 전략은 약 신호 (반대 신호 없어야 함)
  const conflicting = longCount > 0 && shortCount > 0;
  if (agree < 2 || conflicting) return null;

  const side = longCount > shortCount ? "LONG" : "SHORT";
  const confidence = agree >= 3 ? "A" : "B";
  const finalScore = Math.min(95, avgScore + (agree >= 3 ? 5 : 0));
  const timeframe = input.timeframe || "1d";

  return {
    side,
    score: Math.round(finalScore),
    confidence,
    family: FAMILY,
    timeframe,
    reason: `[${timeframe}|ensemble ${agree}/${sigs.length} 합의] ` + reasons.join(", "),
    sizeHint: agree >= 3 ? 0.7 : 0.5,
    type: side === "LONG" ? "BUY" : "SELL",
    positionSize: agree >= 3 ? 0.7 : 0.5,
  };
}

export default { runEnsemble, FAMILY };
