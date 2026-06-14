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
  return {
    enabled: (process.env.ZEPTA_REENTRY_COOLDOWN ?? "1") !== "0",
    lossMin: Number.isFinite(lossMin) ? lossMin : 120, // 손절 후 2시간
    winMin: Number.isFinite(winMin) ? winMin : 45,      // 익절 후 45분
    sameSideOnly: (process.env.ZEPTA_REENTRY_SAME_SIDE_ONLY ?? "1") !== "0",
  };
}

/**
 * 청산 시 호출 — 재진입 쿨다운 레코드 기록.
 * @param {object} kv  Vercel KV 인스턴스
 * @param {string} userId
 * @param {{symbol:string, side?:("LONG"|"SHORT"|null), pnl:number}} info
 */
export async function recordReentryCooldown(kv, userId, { symbol, side, pnl }) {
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
export async function checkReentryCooldown(kv, userId, symbol, side) {
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

  return {
    blocked: true,
    remainMin: Math.ceil(windowMin - elapsedMin),
    reason: rec.pnl < 0
      ? `최근 손절(-$${Math.abs(rec.pnl).toFixed(0)}) 후 ${windowMin}분 쿨다운`
      : `최근 청산 후 ${windowMin}분 쿨다운`,
  };
}
