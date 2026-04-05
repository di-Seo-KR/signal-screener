// Vercel Serverless — 봇별 성과 데이터 API
// KV에 저장된 봇별 거래 기록 + 포지션 스냅샷을 조회
// GET /api/bot-performance?botId=btc-alpha  → 단일 봇
// GET /api/bot-performance?all=1            → 전체 봇

export default async function handler(req, res) {
  try {
    const kvModule = await import("@vercel/kv");
    const kv = kvModule.kv;

    const { botId, all } = req.query;

    // ── 유틸: 손상된 히스토리 필터링 + 커브 추출 ──
    // 구버전 크론이 봇별 에쿼티가 아닌 전체 포트폴리오 에쿼티를 저장해
    // alloc 대비 비정상 값(>3x 또는 <0)이 들어있을 수 있음 → 필터
    function buildCurves(history, alloc) {
      if (!history || history.length < 2 || !alloc || alloc <= 0) {
        return { equityCurve: [], pnlCurve: [] };
      }
      // 에쿼티가 배분금액 대비 합리적 범위(0 ~ 3배)인 항목만 사용
      const maxEq = alloc * 3;   // 200% 이익까지 허용
      const minEq = alloc * 0.1; // 90% 손실까지 허용
      const valid = history.filter(h => {
        const eq = h.equity;
        if (eq == null || eq <= 0) return false;
        // 전체 포트폴리오 에쿼티가 섞인 경우 배분금액 대비 극단적 차이
        if (eq > maxEq || eq < minEq) return false;
        return true;
      });
      if (valid.length < 2) {
        return { equityCurve: [], pnlCurve: [] };
      }
      const equityCurve = valid.map(h => ((h.equity || alloc) / alloc) * 100);
      const pnlCurve = valid.map(h => (h.equity || alloc) - alloc);
      return { equityCurve, pnlCurve };
    }

    // 전체 봇 조회
    if (all === "1" || all === "true") {
      const botIds = [
        // 크립토 봇
        "btc-alpha", "highcap-momentum", "defi-infra",
        "meme-trend", "l2-emerging", "crypto-diversity", "crypto-swing",
        // 주식 봇
        "stable-quant", "balanced-quant", "aggressive-quant", "trend-follow", "mean-reversion", "ensemble-signal",
      ];
      const results = {};
      for (const id of botIds) {
        const [perf, snapshot] = await Promise.all([
          kv.get(`di:bot:${id}:perf`),
          kv.get(`di:bot:${id}:snapshot`),
        ]);
        if (perf || snapshot) {
          const hist = snapshot?.history || [];
          const alloc = snapshot?.botAllocation || 0;
          const { equityCurve, pnlCurve } = buildCurves(hist, alloc);
          // snapshot에서 큰 history 배열 제외 (응답 크기 절감)
          const snapClean = snapshot ? { ...snapshot, history: undefined, historyLength: hist.length } : null;
          results[id] = { perf: perf || null, snapshot: snapClean, equityCurve, pnlCurve };
        }
      }
      return res.status(200).json({ ok: true, bots: results });
    }

    // 단일 봇 조회
    if (botId) {
      const [perf, snapshot] = await Promise.all([
        kv.get(`di:bot:${botId}:perf`),
        kv.get(`di:bot:${botId}:snapshot`),
      ]);
      const hist = snapshot?.history || [];
      const alloc = snapshot?.botAllocation || 0;
      const { equityCurve, pnlCurve } = buildCurves(hist, alloc);
      const snapClean = snapshot ? { ...snapshot, history: undefined, historyLength: hist.length } : null;
      return res.status(200).json({
        ok: true,
        botId,
        perf: perf || { botId, trades: [], tradeCount: 0, realizedPL: 0 },
        snapshot: snapClean || { botId, marketValue: 0, unrealizedPL: 0, positionCount: 0, dd: 0, mdd: 0 },
        equityCurve,
        pnlCurve,
      });
    }

    return res.status(400).json({ ok: false, error: "botId or all=1 required" });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
