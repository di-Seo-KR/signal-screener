// Vercel Serverless — 개발/QA용 시스템 상태 진단 API
// GET /api/dev-status → KV 데이터, 봇 상태, 포트폴리오, cron 이력 전체 조회
// 프로덕션에서도 접근 가능 (관리자 전용 페이지에서 사용)

export default async function handler(req, res) {
  const startTime = Date.now();
  const status = {
    timestamp: new Date().toISOString(),
    kv: { connected: false },
    portfolio: null,
    activeBots: null,
    botPerformance: {},
    botSnapshots: {},
    prevEquity: null,
    prevEquityDate: null,
    prices: { crypto: {}, stock: {} },
    cronLog: null,
    errors: [],
  };

  try {
    const kvModule = await import("@vercel/kv");
    const kv = kvModule.kv;
    status.kv.connected = true;

    // 1. 가상 포트폴리오
    try {
      status.portfolio = await kv.get("di:virtual:portfolio");
    } catch (e) { status.errors.push(`portfolio: ${e.message}`); }

    // 2. 활성 봇
    try {
      status.activeBots = await kv.get("di:active-bots");
    } catch (e) { status.errors.push(`activeBots: ${e.message}`); }

    // 3. 봇별 성과 + 스냅샷
    const botIds = [
      "btc-alpha", "highcap-momentum", "defi-infra",
      "meme-trend", "l2-emerging", "crypto-diversity", "crypto-swing",
      "us-stable", "us-balanced", "us-aggressive", "us-trend", "us-meanrev",
    ];
    for (const id of botIds) {
      try {
        const [perf, snap] = await Promise.all([
          kv.get(`di:bot:${id}:perf`),
          kv.get(`di:bot:${id}:snapshot`),
        ]);
        if (perf) status.botPerformance[id] = {
          tradeCount: perf.tradeCount || 0,
          realizedPL: perf.realizedPL || 0,
          totalBuyCost: perf.totalBuyCost || 0,
          totalSellRevenue: perf.totalSellRevenue || 0,
          winCount: perf.winCount || 0,
          lastUpdated: perf.lastUpdated,
          recentTrades: (perf.trades || []).slice(0, 5),
        };
        if (snap) status.botSnapshots[id] = {
          marketValue: snap.marketValue,
          unrealizedPL: snap.unrealizedPL,
          positionCount: snap.positionCount,
          dd: snap.dd,
          mdd: snap.mdd,
          peakEquity: snap.peakEquity,
          botEquity: snap.botEquity,
          botAllocation: snap.botAllocation,
          realizedPL: snap.realizedPL,
          historyLength: (snap.history || []).length,
          lastUpdated: snap.lastUpdated,
        };
      } catch (e) { status.errors.push(`bot:${id}: ${e.message}`); }
    }

    // 4. 일간 P&L 데이터
    try {
      status.prevEquity = await kv.get("di:virtual:crypto-prev-equity");
      status.prevEquityDate = await kv.get("di:virtual:crypto-prev-equity-date");
    } catch (e) { status.errors.push(`prevEquity: ${e.message}`); }

    // 5. 마켓 모니터 레짐
    try {
      status.marketRegime = await kv.get("di:market:regime");
    } catch (e) { status.errors.push(`regime: ${e.message}`); }

    // 6. 가격 소스 테스트 (간단히)
    try {
      const cgRes = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd", {
        signal: AbortSignal.timeout(5000),
      });
      const cgData = await cgRes.json();
      status.prices.crypto = {
        source: "coingecko",
        btc: cgData?.bitcoin?.usd,
        eth: cgData?.ethereum?.usd,
        ok: !!(cgData?.bitcoin?.usd),
      };
    } catch (e) {
      status.prices.crypto = { source: "coingecko", ok: false, error: e.message };
    }

    // 7. 포트폴리오 검증
    if (status.portfolio) {
      const p = status.portfolio;
      const posCount = Object.keys(p.positions || {}).length;
      const totalPositionValue = Object.entries(p.positions || {}).reduce((s, [, pos]) => {
        return s + (pos.qty || 0) * (pos.avgPrice || 0);
      }, 0);
      status.portfolioHealth = {
        cash: p.cash,
        positionCount: posCount,
        totalPositionCostBasis: Math.round(totalPositionValue),
        totalTrades: p.totalTrades || 0,
        initialCash: p.initialCash || 100000,
        cashRatio: p.cash / (p.initialCash || 100000),
        positions: Object.entries(p.positions || {}).map(([asset, pos]) => ({
          asset,
          qty: pos.qty,
          avgPrice: pos.avgPrice,
          costBasis: Math.round(pos.qty * pos.avgPrice),
          entryTime: pos.entryTime,
        })),
      };
    }

  } catch (e) {
    status.errors.push(`kv_init: ${e.message}`);
  }

  status.responseTime = `${Date.now() - startTime}ms`;
  return res.status(200).json(status);
}
