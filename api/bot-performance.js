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
        return { equityCurve: [], pnlCurve: [], dayLabels: [] };
      }
      // 1) 에쿼티 합리 범위 필터 (구버전 손상 데이터 방어)
      const maxEq = alloc * 3;
      const minEq = alloc * 0.1;
      const valid = history.filter(h => {
        const eq = h.equity;
        if (eq == null || eq <= 0) return false;
        if (eq > maxEq || eq < minEq) return false;
        return true;
      });
      if (valid.length < 2) {
        return { equityCurve: [], pnlCurve: [], dayLabels: [] };
      }
      // 2) KST 일자별 그룹핑 — 같은 날의 마지막 스냅샷만 사용 (일종가 효과)
      // KST = UTC+9. h.time 은 ISO 문자열.
      const KST_MS = 9 * 3600000;
      const dayMap = new Map(); // key: "YYYY-MM-DD" (KST), value: 마지막 entry
      for (const h of valid) {
        const t = h.time ? new Date(h.time).getTime() : NaN;
        if (!Number.isFinite(t)) continue;
        const k = new Date(t + KST_MS);
        const key = `${k.getUTCFullYear()}-${String(k.getUTCMonth() + 1).padStart(2, "0")}-${String(k.getUTCDate()).padStart(2, "0")}`;
        // 같은 날이면 항상 마지막(시간 큰) 값으로 덮어쓰기 — history 가 시간순이라고 가정
        dayMap.set(key, h);
      }
      const dailySorted = Array.from(dayMap.entries()).sort(([a], [b]) => a.localeCompare(b));
      if (dailySorted.length < 2) {
        // 일자 수 부족 시 기존 raw 시계열 fallback (스파크라인이라도 보이도록)
        const equityCurve = valid.map(h => ((h.equity || alloc) / alloc) * 100);
        const pnlCurve = valid.map(h => (h.equity || alloc) - alloc);
        return { equityCurve, pnlCurve, dayLabels: [] };
      }
      const equityCurve = dailySorted.map(([, h]) => ((h.equity || alloc) / alloc) * 100);
      const pnlCurve = dailySorted.map(([, h]) => (h.equity || alloc) - alloc);
      const dayLabels = dailySorted.map(([key]) => key); // "YYYY-MM-DD" 형태 (KST)
      return { equityCurve, pnlCurve, dayLabels };
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
          const { equityCurve, pnlCurve, dayLabels } = buildCurves(hist, alloc);
          // snapshot에서 큰 history 배열 제외 (응답 크기 절감)
          const snapClean = snapshot ? { ...snapshot, history: undefined, historyLength: hist.length } : null;
          results[id] = { perf: perf || null, snapshot: snapClean, equityCurve, pnlCurve, dayLabels };
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
      const { equityCurve, pnlCurve, dayLabels } = buildCurves(hist, alloc);
      const snapClean = snapshot ? { ...snapshot, history: undefined, historyLength: hist.length } : null;
      return res.status(200).json({
        ok: true,
        botId,
        perf: perf || { botId, trades: [], tradeCount: 0, realizedPL: 0 },
        snapshot: snapClean || { botId, marketValue: 0, unrealizedPL: 0, positionCount: 0, dd: 0, mdd: 0 },
        equityCurve,
        pnlCurve,
        dayLabels,
      });
    }

    return res.status(400).json({ ok: false, error: "botId or all=1 required" });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
