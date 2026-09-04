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
const POOL_KEY_MTF = "di:signals:realtime-pool-mtf"; // ★ 2026-06-03: 멀티TF 종합 스코어 풀(주·일·4h·1h)
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

// stability 공개 형상 — 내부 산출근거 flipTs(확정 전환 타임스탬프 배열, 최대 50개)는
//   응답에서 제외합니다. 문서 스키마 { sideSince, pendingSide, flips24h } 와 실제 응답을
//   일치시키고, 심볼당 최대 ~400B 의 불필요한 페이로드를 방지합니다 (stock-scores.js 동일 규칙).
function pubStability(st) {
  if (!st || typeof st !== "object") return null;
  return {
    sideSince: st.sideSince ?? null,
    pendingSide: st.pendingSide ?? null,
    flips24h: st.flips24h ?? 0,
  };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  // ★ 2026-06-12: 홈/코인페이지 공개 노출 대비 CDN 캐시 — 생성 주기 10분이라 60s 캐시 무손실,
  //   KV 읽기 비용을 엣지가 흡수. stale-while-revalidate 로 갱신 중에도 즉시 응답.
  res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    const _lim = parseInt(req.query?.limit, 10);
    // ★ 2026-06-12 (대표 제보): 동적 유니버스 전환 후에도 기본 30 캡이 남아 일부만 표시되던 버그.
    // ★ 2026-09-04: 유니버스 65+히스테리시스 버퍼 15(최대 80종) 확대에 맞춰 상한 60 → 100.
    const limit = Math.min(Number.isFinite(_lim) && _lim > 0 ? _lim : 100, 100); // NaN/잘못된 입력 방어
    const kv = await getKv();
    const [pool, poolMtf] = await Promise.all([
      kv.get(POOL_KEY).then((p) => p || []),
      kv.get(POOL_KEY_MTF).then((p) => p || []),
    ]);

    const now = Date.now();
    const cutoff = now - WINDOW_MS;

    // breakdown(주·일·4h·1h) 의 {type,score} → {side, score} 변환
    const normBreakdown = (bd) => {
      if (!bd || typeof bd !== "object") return null;
      const out = {};
      for (const tf of ["1w", "1d", "4h", "1h"]) {
        const x = bd[tf];
        out[tf] = x && x.type ? { side: x.type === "BUY" ? "LONG" : "SHORT", score: Math.round(parseFloat(x.score) || 0) } : null;
      }
      return out;
    };

    // ── 주 소스: 종합(MTF) 풀. 코인별 최신 1개. ──
    const byAsset = new Map();
    const mtfArr = Array.isArray(poolMtf) ? poolMtf : [];
    for (const e of mtfArr) {
      if (!e || (e.ts || 0) < cutoff) continue;
      const side = normSide(e);
      if (!side) continue;
      const ticker = baseTicker(e.asset);
      if (!ticker) continue;
      const prev = byAsset.get(ticker);
      if (!prev || (e.ts || 0) > prev.ts) {
        byAsset.set(ticker, {
          asset: ticker, symbol: `${ticker}USDT`, side,
          type: String(e.type || (side === "LONG" ? "BUY" : "SELL")).toUpperCase(),
          score: parseFloat(e.score || 0) || 0,   // 종합 스코어 0~100
          confidence: normConfidence(e.confidence),
          family: "composite", timeframe: "MTF",
          // ★ 2026-09-04: 180→220 — 안정성 보정 사유(" | 안정성 0.95×(…)")까지 잘리지 않게
          reason: (e.reason || "").slice(0, 220),
          ts: e.ts || 0,
          breakdown: normBreakdown(e.breakdown), // { 1w,1d,4h,1h: {side,score}|null }
          entryRefine: e.entryRefine || null, // ★ MTF 소진·차트구조 정제 { mult, reasons, before }
          sr: e.sr || null, // ★ 지지·저항 { s:[{p,t,d}], r:[{p,t,d}], piv, px, m } | null
          // ★ 2026-08-11 온체인·파생 표시 컨텍스트 통과 (additive·표시 전용 — UI 는 sig.oc 를 읽음).
          //   ocShadow(내부 섀도 평가용)는 의도적으로 통과시키지 않습니다(화면 미노출 원칙).
          oc: e.oc || null,
          // ★ 2026-08-17 side 라벨 히스테리시스 상태 통과 — { sideSince, pendingSide, flips24h }
          //   (btc-cron 표시 풀에서 부여. 없으면 null — 킬스위치 OFF·구 엔트리 하위호환.
          //    내부 산출근거 flipTs 는 pubStability 가 제거 — 공개 응답 미노출)
          stability: pubStability(e.stability),
          // ★ 2026-09-04 신호 안정성 보정 { mult, before } — 보정 전 점수 투명 노출 (없으면 null)
          stabilityAdjust: e.stabilityAdjust || null,
        });
      }
    }

    // ── 폴백: MTF 풀이 아직 안 찼으면 기존 1d 풀로 (하위호환) ──
    if (byAsset.size === 0) {
      for (const e of (Array.isArray(pool) ? pool : [])) {
        if (!e || (e.ts || 0) < cutoff) continue;
        if (e.timeframe === "4h" || e.timeframe === "1h" || e.timeframe === "MTF") continue;
        const side = normSide(e);
        if (!side) continue;
        const ticker = baseTicker(e.asset);
        if (!ticker) continue;
        const prev = byAsset.get(ticker);
        if (!prev || (e.ts || 0) > prev.ts) {
          byAsset.set(ticker, {
            asset: ticker, symbol: `${ticker}USDT`, side,
            type: String(e.type || (side === "LONG" ? "BUY" : "SELL")).toUpperCase(),
            score: parseFloat(e.score || 0) || 0,
            confidence: normConfidence(e.confidence),
            family: e.family || null, timeframe: e.timeframe || "1d",
            reason: (e.reason || "").slice(0, 140), ts: e.ts || 0, breakdown: null,
            sr: e.sr || null, // ★ 지지·저항 (1d 폴백 풀에도 동일 주입됨)
            stability: pubStability(e.stability), // ★ 스키마 일관 — 거래 풀엔 없어 항상 null(히스테리시스 미적용 풀)
          });
        }
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
