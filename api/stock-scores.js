// api/stock-scores.js
//
// 주식 멀티TF 정보 시그널 보드 — 코인의 coin-scores.js 를 본뜬 공개 GET 엔드포인트.
// stock-signals-cron 이 적재한 풀(di:signals:stock-pool-mtf)을 읽어
// 종목별 방향·종합 스코어·TF 분해·지지저항을 반환한다. *표시 전용* — 매매 엔진 무관.
//
// ★ 스코어 성격(정직 고지): 순수 기술적 지표 종합(추세·모멘텀·거래량·변동성)이며
//   주식에는 펀딩·온체인 데이터가 없어 해당 팩터는 포함되지 않는다. TF 가중은
//   코인 종합과 동일(주30·일25·4h25·1h20). 장 마감 후에는 마지막 장중 데이터
//   기준 스코어가 유지된다 — ts(스캔 시각)와 dataTs(데이터 시각)를 분리 표기:
//   마감 시장 재스캔 런에서 ts 는 갱신돼도 dataTs 는 마지막 반영 캔들 시각 그대로.
//
// GET ?limit=60
// → {
//     ok, stocks: [{ asset, symbol, name, market:"us"|"kr", side:"LONG"|"SHORT",
//                    type, score(0~100), confidence(0~1 — coin-scores 와 동일 정규화),
//                    family, timeframe:"MTF", reason, ts(스캔 시각 ms),
//                    dataTs(마지막 반영 캔들 시각 ms | null),
//                    breakdown{1w,1d,4h,1h}, sr, marketState }],
//     counts: { long, short, total }, updatedAt, meta
//   }

async function getKv() {
  return (await import("@vercel/kv")).kv;
}

const POOL_KEY = "di:signals:stock-pool-mtf";

// confidence 정규화 → 0~1 (coin-scores.js normConfidence 와 동일 맵 — 코인·주식
// 보드를 한 컴포넌트로 합칠 때 타입이 어긋나지 않도록 계약을 일치시킴)
function normConfidence(c) {
  if (typeof c === "number" && Number.isFinite(c)) return c > 1 ? c / 100 : c;
  const map = { A: 0.85, B: 0.65, C: 0.45, D: 0.3 };
  return map[String(c || "").toUpperCase()] ?? 0.5;
}

// side 정규화 → "LONG" | "SHORT" | null (coin-scores 와 동일 규칙)
function normSide(entry) {
  const s = String(entry.side || "").toUpperCase();
  if (s === "LONG" || s === "SHORT") return s;
  const t = String(entry.type || "").toUpperCase();
  if (t === "BUY") return "LONG";
  if (t === "SELL") return "SHORT";
  return null;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  // 크론 생성 주기 30분 — 60s 엣지 캐시 무손실, KV 읽기 비용을 엣지가 흡수 (coin-scores 동일)
  res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    const _lim = parseInt(req.query?.limit, 10);
    const limit = Math.min(Number.isFinite(_lim) && _lim > 0 ? _lim : 60, 60); // 유니버스 51종 전체 커버
    const kv = await getKv();
    const pool = (await kv.get(POOL_KEY)) || [];

    // breakdown(주·일·4h·1h) 의 {type,score} → {side,score} 변환 (coin-scores 동일)
    const normBreakdown = (bd) => {
      if (!bd || typeof bd !== "object") return null;
      const out = {};
      for (const tf of ["1w", "1d", "4h", "1h"]) {
        const x = bd[tf];
        out[tf] = x && x.type ? { side: x.type === "BUY" ? "LONG" : "SHORT", score: Math.round(parseFloat(x.score) || 0) } : null;
      }
      return out;
    };

    // 종목별 최신 1개 — 주식 풀은 장 마감 후 last-known 유지가 설계라 시간 cutoff 없음
    // (신선도는 엔트리별 ts 로 정직하게 표기)
    const byAsset = new Map();
    for (const e of (Array.isArray(pool) ? pool : [])) {
      if (!e || !e.asset) continue;
      const side = normSide(e);
      if (!side) continue;
      const prev = byAsset.get(e.asset);
      if (!prev || (e.ts || 0) > prev.ts) {
        byAsset.set(e.asset, {
          asset: e.asset,
          symbol: e.symbol || e.asset,
          name: e.name || null,
          market: e.market || null,          // "us" | "kr"
          side,
          type: String(e.type || (side === "LONG" ? "BUY" : "SELL")).toUpperCase(),
          score: parseFloat(e.score || 0) || 0, // 종합 스코어 0~100
          confidence: normConfidence(e.confidence), // 0~1 정규화 (coin-scores 동일 규칙)
          family: "composite",
          timeframe: "MTF",
          reason: (e.reason || "").slice(0, 180),
          ts: e.ts || 0,                     // 스캔(적재) 시각 ms — 신선도 표기용
          dataTs: e.dataTs ?? null,          // 데이터 시각 ms — 마지막 반영 캔들 기준(구 엔트리는 null)
          breakdown: normBreakdown(e.breakdown), // { 1w,1d,4h,1h: {side,score}|null }
          sr: e.sr || null,                  // 지지·저항 { s, r, piv, px, m } | null
          marketState: e.marketState ?? null, // 스캔 시점 개장 여부 — "REGULAR"|"CLOSED"|null
        });
      }
    }

    const stocks = Array.from(byAsset.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    const counts = {
      long: stocks.filter((s) => s.side === "LONG").length,
      short: stocks.filter((s) => s.side === "SHORT").length,
      total: stocks.length,
    };

    return res.status(200).json({
      ok: true,
      stocks,
      counts,
      updatedAt: new Date().toISOString(),
      meta: {
        // 정직 고지 — 스코어 산출 근거와 한계
        basis: "기술적 지표 종합(추세·모멘텀·거래량·변동성) — 주식에는 펀딩·온체인 데이터가 없어 미포함",
        tfWeights: { "1w": 0.30, "1d": 0.25, "4h": 0.25, "1h": 0.20 }, // 코인 종합과 동일 가중
        tfNote: "4h 는 야후 미제공으로 1h 완결 캔들을 거래일 단위 정방향 4개씩 집계 합성 (거래일 말미 잔여는 짧은 봉 유지, 최신 거래일 말미는 제외)",
        staleNote: "장 마감 후에는 마지막 장중 데이터 기준 스코어가 유지됩니다 — ts 는 스캔 시각, dataTs 는 마지막 반영 캔들 시각(엔트리별 marketState 와 함께 참조)",
      },
    });
  } catch (err) {
    console.error("[stock-scores]", err);
    return res.status(500).json({ error: err?.message || String(err) });
  }
}
