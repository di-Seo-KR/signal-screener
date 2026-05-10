// api/_shared/live-summary.js
//
// ★ 2026-05-09 audit M7: 실거래(live) summary KV — shadow-summary 와 별도.
//
// 현재 시스템은 자동 차단(winRate<30% & n>=20)과 가중치 학습이 shadow-summary 만
// 의존. 그런데 shadow 와 live 의 시그널 분포·체결 가격·슬리피지가 다르면
// 자동 차단 기준이 misaligned. 시나리오:
//   shadow 에서 SOL winRate 18.5% → 차단됨 → live 에서 SOL 시그널 무시
//   하지만 live 에서는 SOL 이 잘 굴렀을 수도 있음 (다른 분포)
//
// 해결: live ledger (orders + position close) 를 별도 집계 →
//      자동 차단 기준은 live 우선 + shadow 보조.
//
// KV: di:real:user:<uid>:live-summary
//   {
//     trades, wins, losses, netPnL, grossWin, grossLoss,
//     bySymbol: { BTCUSDT: { trades, wins, netPnL }, ... },
//     byFamily, byConfidence, byTimeframe,
//     winRate, profitFactor,
//     updatedAt
//   }

async function getKv() {
  return (await import("@vercel/kv")).kv;
}

/**
 * 실거래 청산 1건을 live-summary 에 누적.
 * @param {string} userId
 * @param {object} closeInfo
 *   - symbol, side, family?, confidence?, timeframe?
 *   - realizedPnL (USDT, 양/음)
 *   - openedAt, closedAt
 */
export async function recordLiveTrade(userId, closeInfo) {
  try {
    const kv = await getKv();
    const key = `di:real:user:${userId}:live-summary`;
    const sum = (await kv.get(key)) || {
      trades: 0, wins: 0, losses: 0, netPnL: 0, grossWin: 0, grossLoss: 0,
      bySymbol: {}, byFamily: {}, byConfidence: {}, byTimeframe: {},
      updatedAt: null,
    };
    // backfill
    sum.bySymbol = sum.bySymbol || {};
    sum.byFamily = sum.byFamily || {};
    sum.byConfidence = sum.byConfidence || {};
    sum.byTimeframe = sum.byTimeframe || {};

    const pnl = parseFloat(closeInfo.realizedPnL || 0);
    sum.trades += 1;
    sum.netPnL += pnl;
    if (pnl > 0) {
      sum.wins += 1;
      sum.grossWin += pnl;
    } else if (pnl < 0) {
      sum.losses += 1;
      sum.grossLoss += Math.abs(pnl);
    }
    // bySymbol
    if (closeInfo.symbol) {
      const s = sum.bySymbol[closeInfo.symbol] = sum.bySymbol[closeInfo.symbol] || { trades: 0, wins: 0, netPnL: 0, lastClosedAt: null };
      s.trades += 1;
      s.netPnL += pnl;
      if (pnl > 0) s.wins += 1;
      s.lastClosedAt = closeInfo.closedAt || new Date().toISOString();
    }
    // byFamily
    if (closeInfo.family) {
      const f = sum.byFamily[closeInfo.family] = sum.byFamily[closeInfo.family] || { trades: 0, wins: 0, netPnL: 0 };
      f.trades += 1;
      f.netPnL += pnl;
      if (pnl > 0) f.wins += 1;
    }
    // byConfidence (A/B/C 또는 숫자)
    if (closeInfo.confidence != null) {
      const ck = typeof closeInfo.confidence === "number"
        ? (closeInfo.confidence >= 0.85 ? "A" : closeInfo.confidence >= 0.65 ? "B" : "C")
        : String(closeInfo.confidence).toUpperCase();
      const c = sum.byConfidence[ck] = sum.byConfidence[ck] || { trades: 0, wins: 0, netPnL: 0 };
      c.trades += 1;
      c.netPnL += pnl;
      if (pnl > 0) c.wins += 1;
    }
    // byTimeframe
    const tf = closeInfo.timeframe || "unknown";
    const t = sum.byTimeframe[tf] = sum.byTimeframe[tf] || { trades: 0, wins: 0, netPnL: 0 };
    t.trades += 1;
    t.netPnL += pnl;
    if (pnl > 0) t.wins += 1;

    sum.winRate = sum.trades > 0 ? sum.wins / sum.trades : 0;
    sum.profitFactor = sum.grossLoss > 0 ? sum.grossWin / sum.grossLoss : null;
    sum.updatedAt = new Date().toISOString();
    await kv.set(key, sum);
    return sum;
  } catch (e) {
    console.error("[live-summary] recordLiveTrade failed:", e?.message);
    return null;
  }
}

/**
 * 자동 차단 판단 — live 우선 + shadow 보조.
 * @param {string} userId
 * @param {string} symbol
 * @returns {Promise<{blocked: boolean, reason?: string, liveStats?, shadowStats?}>}
 */
export async function shouldAutoBlock(userId, symbol) {
  const kv = await getKv();
  const live = (await kv.get(`di:real:user:${userId}:live-summary`)) || {};
  const shadow = (await kv.get(`di:real:user:${userId}:shadow-summary`)) || {};
  const liveSym = live.bySymbol?.[symbol];
  const shadowSym = shadow.bySymbol?.[symbol];

  // 1) live 데이터가 충분(>=10) 하면 그것만 본다.
  if (liveSym && liveSym.trades >= 10) {
    const wr = liveSym.wins / liveSym.trades;
    if (wr < 0.30) {
      return { blocked: true, reason: `live winRate ${(wr*100).toFixed(1)}% < 30% (n=${liveSym.trades})`, liveStats: liveSym };
    }
    return { blocked: false, liveStats: liveSym };
  }
  // 2) live 데이터 부족하면 shadow 보조 (>=20)
  if (shadowSym && shadowSym.trades >= 20) {
    const wr = shadowSym.wins / shadowSym.trades;
    if (wr < 0.30) {
      return { blocked: true, reason: `shadow winRate ${(wr*100).toFixed(1)}% < 30% (n=${shadowSym.trades}, live n=${liveSym?.trades || 0})`, shadowStats: shadowSym };
    }
  }
  return { blocked: false, liveStats: liveSym, shadowStats: shadowSym };
}

export default { recordLiveTrade, shouldAutoBlock };
