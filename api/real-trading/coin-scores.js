// api/real-trading/coin-scores.js
//
// 실거래 대시보드 — 코인별 롱숏 점수 (Long/Short Score Board).
// engine 이 실제로 보는 시그널 풀(di:signals:realtime-pool)을 읽어
// 코인별로 *양방향(LONG/SHORT)* 신호와 점수를 구분해서 반환한다.
//
// signal-watchlist 는 BUY(롱)만 보여줘서 숏 신호가 안 보였음 → 이 엔드포인트는
// 풀의 BUY/SELL 을 모두 집계해 코인별 방향·점수를 한눈에 구분한다.
//
// GET ?limit=30
//
// → {
//     ok, coins: [{ asset, symbol, side:"LONG"|"SHORT", type, score(0~100),
//                    confidence(0~1), family, timeframe, reason, ts }],
//     counts: { long, short, total }, updatedAt
//   }

async function getKv() {
  return (await import("@vercel/kv")).kv;
}

const POOL_KEY = "di:signals:realtime-pool";
const POOL_KEY_4H = "di:signals:realtime-pool-4h"; // ★ 2026-06-03: 4h 표시 전용 풀
const WINDOW_MS = 4 * 60 * 60 * 1000; // 풀 유지 윈도우와 동일

// confidence 정규화 → 0~1
function normConfidence(c) {
  if (typeof c === "number" && Number.isFinite(c)) return c > 1 ? c / 100 : c;
  const map = { A: 0.85, B: 0.65, C: 0.45, D: 0.3 };
  return map[String(c || "").toUpperCase()] ?? 0.5;
}

// side 정규화 → "LONG" | "SHORT" | null
function normSide(entry) {
  const s = String(entry.side || "").toUpperCase();
  if (s === "LONG" || s === "SHORT") return s;
  const t = String(entry.type || "").toUpperCase();
  if (t === "BUY") return "LONG";
  if (t === "SELL") return "SHORT";
  return null;
}

// 베이스 티커 추출 — 풀의 asset 은 "BTC/USD", "OP/USD", "BTC", "BTCUSDT" 등 다양.
//   "/" 앞부분 + 후행 USDT/USD 제거 → 순수 티커("BTC").
function baseTicker(asset) {
  let a = String(asset || "").toUpperCase().trim();
  if (!a) return "";
  if (a.includes("/")) a = a.split("/")[0];
  a = a.replace(/USDT$/, "").replace(/USD$/, "");
  return a;
}
function toSymbol(asset) {
  const b = baseTicker(asset);
  return b ? `${b}USDT` : "—";
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    const _lim = parseInt(req.query?.limit, 10);
    const limit = Math.min(Number.isFinite(_lim) && _lim > 0 ? _lim : 30, 60); // NaN/잘못된 입력 방어
    const kv = await getKv();
    const [pool, pool4h] = await Promise.all([
      kv.get(POOL_KEY).then((p) => p || []),
      kv.get(POOL_KEY_4H).then((p) => p || []),
    ]);

    const now = Date.now();
    const cutoff = now - WINDOW_MS;

    // ── 4h 보조 맵: 티커 → { side, score } (최신 ts 우선) ──
    const map4h = new Map();
    for (const e of (Array.isArray(pool4h) ? pool4h : [])) {
      if (!e || (e.ts || 0) < cutoff) continue;
      const side = normSide(e);
      if (!side) continue;
      const ticker = baseTicker(e.asset);
      if (!ticker) continue;
      const prev = map4h.get(ticker);
      if (!prev || (e.ts || 0) > prev.ts) {
        map4h.set(ticker, { side, score: parseFloat(e.score || 0) || 0, ts: e.ts || 0 });
      }
    }

    // 코인별로 가장 *최근* 신호 1개로 집계 (현재 방향·점수를 즉시 반영).
    //   주(主) 표시는 일봉(1d) 기준 — 메인 풀에 4h 거래 엔트리가 섞여도(플래그 ON 시)
    //   1d 를 우선으로 본다. (4h 는 보조 tf4h 로 별도 표시.)
    const byAsset = new Map();
    for (const e of pool) {
      if (!e || (e.ts || 0) < cutoff) continue;
      if (e.timeframe === "4h" || e.timeframe === "1h") continue; // 주 표시는 1d
      const side = normSide(e);
      if (!side) continue;
      const ticker = baseTicker(e.asset);
      if (!ticker) continue;
      const score = parseFloat(e.score || 0) || 0;
      const prev = byAsset.get(ticker);
      if (!prev || (e.ts || 0) > prev.ts) {
        byAsset.set(ticker, {
          asset: ticker,
          symbol: `${ticker}USDT`,
          side,
          type: String(e.type || (side === "LONG" ? "BUY" : "SELL")).toUpperCase(),
          score,                                  // 0~100 (풀 원본 스케일)
          confidence: normConfidence(e.confidence),
          family: e.family || null,
          timeframe: e.timeframe || "1d",
          reason: (e.reason || "").slice(0, 120),
          ts: e.ts || 0,
          // ★ 4h 보조 신호 (있으면) — 코인 카드에서 1d 옆에 함께 표시
          tf4h: map4h.has(ticker)
            ? { side: map4h.get(ticker).side, score: map4h.get(ticker).score }
            : null,
        });
      }
    }

    const coins = Array.from(byAsset.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    const counts = {
      long: coins.filter((c) => c.side === "LONG").length,
      short: coins.filter((c) => c.side === "SHORT").length,
      total: coins.length,
    };

    return res.status(200).json({
      ok: true,
      coins,
      counts,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[coin-scores]", err);
    return res.status(500).json({ error: err?.message || String(err) });
  }
}
