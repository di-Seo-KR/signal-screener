// ════════════════════════════════════════════════════════════════════
// Zepta — 재진입 쿨다운 (2026-06-12 대표 지시)
// ────────────────────────────────────────────────────────────────────
// 문제: 봇이 청산을 잘 하는데, 청산 직후 "동일 종목 · 동일 방향"을 즉시 재진입해
//   휩쏘 손실이 다발. 시그널 풀(di:signals:realtime-pool)에 같은 종목 신호가
//   10분마다 갱신되며 남아 있고, dedup 은 '지금 열린' 심볼만 막으므로 청산되면
//   곧바로 다시 들어가는 구조였다.
//
// 해결: 청산을 감지하는 position-monitor 가 청산 시 쿨다운 레코드를 기록하고,
//   engine 의 진입 루프가 그 심볼(+방향)을 쿨다운 시간 동안 차단한다.
//   = "진입 선별 강도 ↑" 의 가장 직접적 레버.
//
// 정책 (전부 env 로 조정·비활성 가능):
//   ZEPTA_REENTRY_COOLDOWN        = "1"(기본 활성) | "0"(끔)
//   ZEPTA_REENTRY_COOLDOWN_LOSS_MIN = 손절 청산 후 쿨다운(분, 기본 120)
//   ZEPTA_REENTRY_COOLDOWN_WIN_MIN  = 익절 청산 후 쿨다운(분, 기본 45)
//   ZEPTA_REENTRY_SAME_SIDE_ONLY  = "1"(기본, 동일 방향만 차단) | "0"(어느 방향이든 차단)
//
// 손익 인지: 손절(churn 손실의 본질)은 길게, 익절(모멘텀 지속은 정당)은 짧게.
// KV: di:real:user:<uid>:cooldown:<SYMBOL> = { side, closedAt, pnl, cooldownMin }
//     TTL 자동만료 — 쿨다운 끝나면 키가 사라져 별도 청소 불필요.
// ════════════════════════════════════════════════════════════════════

const KEY = (uid, sym) => `di:real:user:${uid}:cooldown:${sym}`;

export function reentryCfg() {
  const lossMin = Number(process.env.ZEPTA_REENTRY_COOLDOWN_LOSS_MIN);
  const winMin = Number(process.env.ZEPTA_REENTRY_COOLDOWN_WIN_MIN);
  const pricePct = Number(process.env.ZEPTA_REENTRY_PRICE_PCT);
  const scoreDelta = Number(process.env.ZEPTA_REENTRY_SCORE_DELTA);
  return {
    enabled: (process.env.ZEPTA_REENTRY_COOLDOWN ?? "1") !== "0",
    lossMin: Number.isFinite(lossMin) ? lossMin : 120, // 손절 후 2시간
    winMin: Number.isFinite(winMin) ? winMin : 45,      // 익절 후 45분
    sameSideOnly: (process.env.ZEPTA_REENTRY_SAME_SIDE_ONLY ?? "1") !== "0",
    // ★ 품질 게이트 (2026-06-14 대표 지시 — 트레이더 방식): 쿨다운 중이어도 "더 매력적 가격"
    //   또는 "더 강한 확신"이면 재진입 허용. 손절 후 무조건 시간만 기다리지 않고, 더 나은
    //   타점이면 들어간다. ZEPTA_REENTRY_QUALITY_GATE=0 으로 끔(순수 시간 쿨다운).
    qualityGate: (process.env.ZEPTA_REENTRY_QUALITY_GATE ?? "1") !== "0",
    pricePct: Number.isFinite(pricePct) ? pricePct : 1.0,   // 더 매력적 가격 임계(%)
    scoreDelta: Number.isFinite(scoreDelta) ? scoreDelta : 8, // 더 강한 신호 임계(점수차)
  };
}

/**
 * 청산 시 호출 — 재진입 쿨다운 레코드 기록.
 * @param {object} kv  Vercel KV 인스턴스
 * @param {string} userId
 * @param {{symbol:string, side?:("LONG"|"SHORT"|null), pnl:number}} info
 */
export async function recordReentryCooldown(kv, userId, { symbol, side, pnl, entryPrice, score }) {
  const c = reentryCfg();
  if (!c.enabled || !kv || !symbol) return;
  const realized = Number(pnl) || 0;
  const mins = realized < 0 ? c.lossMin : c.winMin;
  if (!(mins > 0)) return;
  const rec = {
    side: side || null,
    closedAt: Date.now(),
    pnl: realized,
    cooldownMin: mins,
    // ★ 품질 게이트용 — 청산된 포지션의 진입가·신호점수. 재진입 시 "더 매력적 가격/더 강한
    //   신호"인지 비교한다(없으면 게이트 미작동 → 순수 시간 쿨다운, 하위호환).
    entryPrice: Number.isFinite(Number(entryPrice)) && Number(entryPrice) > 0 ? Number(entryPrice) : null,
    score: Number.isFinite(Number(score)) ? Number(score) : null,
  };
  try {
    // TTL = 쿨다운 + 1분 여유 → 만료 후 키 자동 제거
    await kv.set(KEY(userId, symbol), rec, { ex: Math.ceil(mins * 60) + 60 });
  } catch { /* 쿨다운 기록 실패가 청산/엔진을 막아선 안 됨 */ }
}

/**
 * 진입 직전 호출 — 이 심볼/방향이 쿨다운 중인지 판정.
 * @returns {Promise<{blocked:boolean, remainMin?:number, reason?:string}>}
 */
export async function checkReentryCooldown(kv, userId, symbol, side, opts = {}) {
  const c = reentryCfg();
  if (!c.enabled || !kv || !symbol) return { blocked: false };
  let rec;
  try { rec = await kv.get(KEY(userId, symbol)); } catch { return { blocked: false }; }
  if (!rec || !rec.closedAt) return { blocked: false };

  // 동일 방향만 차단 옵션 — 단, 청산 시 방향을 몰랐으면(rec.side=null) 안전하게 전 방향 차단
  if (c.sameSideOnly && rec.side && side && rec.side !== side) return { blocked: false };

  const elapsedMin = (Date.now() - rec.closedAt) / 60000;
  const windowMin = Number(rec.cooldownMin) || (rec.pnl < 0 ? c.lossMin : c.winMin);
  if (elapsedMin >= windowMin) return { blocked: false };

  // ★ 품질 게이트 (대표 트레이딩 방식): 쿨다운 시간 중이어도 더 나은 타점이면 재진입 허용.
  //   ① 더 강한 확신 — 새 신호점수가 직전보다 scoreDelta 이상 높음.
  //   ② 더 매력적 가격 — 롱=더 싸게 / 숏=더 비싸게 pricePct% 이상 + 신호 안 약해짐(knife-catch 방지).
  //   기록에 entryPrice·score 가 모두 있어야 작동(없으면 순수 시간 쿨다운, 하위호환).
  if (c.qualityGate && Number.isFinite(rec.entryPrice) && rec.entryPrice > 0 && Number.isFinite(rec.score)) {
    const recScore = Number(rec.score);
    const newScore = Number(opts.score);
    const newPrice = Number(opts.price);
    const dir = (side || rec.side) === "LONG" ? 1 : (side || rec.side) === "SHORT" ? -1 : 0;
    const haveScores = Number.isFinite(newScore);
    const strongerConviction = haveScores && newScore >= recScore + c.scoreDelta;
    let betterPrice = false, improvePct = 0;
    if (Number.isFinite(newPrice) && newPrice > 0 && dir !== 0) {
      improvePct = (dir > 0 ? (rec.entryPrice - newPrice) : (newPrice - rec.entryPrice)) / rec.entryPrice * 100;
      betterPrice = improvePct >= c.pricePct && haveScores && newScore >= recScore; // 가격 개선 + 신호 안 약해짐
    }
    if (strongerConviction || betterPrice) {
      return {
        blocked: false,
        waived: true,
        reason: strongerConviction
          ? `재진입 허용 — 더 강한 신호(${recScore}→${newScore}, +${(newScore - recScore).toFixed(0)})`
          : `재진입 허용 — 더 매력적 타점(${dir > 0 ? "-" : "+"}${improvePct.toFixed(1)}%, 신호 유지)`,
      };
    }
  }

  return {
    blocked: true,
    remainMin: Math.ceil(windowMin - elapsedMin),
    reason: rec.pnl < 0
      ? `최근 손절(-$${Math.abs(rec.pnl).toFixed(0)}) 후 ${windowMin}분 쿨다운`
      : `최근 청산 후 ${windowMin}분 쿨다운`,
  };
}
