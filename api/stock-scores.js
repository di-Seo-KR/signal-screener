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
// GET ?limit=60&offset=0&market=us|kr&side=LONG|SHORT&q=<검색어>
//   ★ 2026-08-13 (유니버스 51→1016종 확대에 맞춘 개편)
//     · limit 상한을 60 → 300 으로 올리고 offset 페이지네이션을 추가했습니다.
//       유니버스가 20배가 됐는데 응답이 60종에서 잘리면 확대분이 화면에 영원히
//       안 나옵니다(확대 작업 자체가 무의미해짐). 반대로 1016종을 한 번에
//       내리면 엔트리당 ~740B × 1016 ≈ 730KB 라 모바일에서 부담이므로,
//       "상한을 올리되 페이지로 나눠 받는" 방식으로 잡았습니다.
//     · market/side/q 서버측 필터 — 클라이언트가 전량을 받아 거르지 않도록.
//     · **counts 를 슬라이스 *전* 기준으로 계산**하도록 정정했습니다. 기존에는
//       slice(0,limit) 이후 배열로 세어서 "상승 N / 전체 M" 이 화면에 보이는
//       페이지 크기를 따라다녔습니다(대표 점검 #4 "28/41 인데 실제 39" 와 동일 계열).
//       이제 counts 는 필터 적용 후 **전집합** 기준이고, 이번 응답에 실제로 담긴
//       건수는 returned 로 따로 내려갑니다.
// → {
//     ok, stocks: [{ asset, symbol, name, market:"us"|"kr", side:"LONG"|"SHORT",
//                    type, score(0~100), confidence(0~1 — coin-scores 와 동일 정규화),
//                    family, timeframe:"MTF", reason, ts(스캔 시각 ms),
//                    dataTs(마지막 반영 캔들 시각 ms | null),
//                    breakdown{1w,1d,4h,1h}, sr, marketState }],
//     counts: { long, short, total },   // 필터 적용 후 전집합 기준 (페이지 아님)
//     page: { offset, limit, returned, hasMore },
//     updatedAt, meta
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
    // 페이지 파라미터 — 상한 300 은 응답 크기(엔트리 ~740B × 300 ≈ 220KB)에서 온 값
    const _lim = parseInt(req.query?.limit, 10);
    const limit = Math.min(Number.isFinite(_lim) && _lim > 0 ? _lim : 60, 300);
    const _off = parseInt(req.query?.offset, 10);
    const offset = Number.isFinite(_off) && _off > 0 ? _off : 0;
    // 서버측 필터 — 클라이언트가 1016종을 통째로 받아 거르는 낭비를 막습니다
    const fMarket = ["us", "kr"].includes(String(req.query?.market || "").toLowerCase())
      ? String(req.query.market).toLowerCase() : null;
    const fSide = ["LONG", "SHORT"].includes(String(req.query?.side || "").toUpperCase())
      ? String(req.query.side).toUpperCase() : null;
    const fq = String(req.query?.q || "").trim().toLowerCase().slice(0, 40) || null;
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

    // 필터 → 정렬 → 페이지. counts 는 **페이지를 자르기 전** 전집합에서 셉니다
    // (자른 뒤에 세면 "상승 N / 전체 M" 이 페이지 크기를 따라다니는 #4 계열 버그가 됩니다).
    const filtered = Array.from(byAsset.values()).filter((s) => {
      if (fMarket && s.market !== fMarket) return false;
      if (fSide && s.side !== fSide) return false;
      if (fq) {
        const hay = `${s.symbol || ""} ${s.asset || ""} ${s.name || ""}`.toLowerCase();
        if (!hay.includes(fq)) return false;
      }
      return true;
    });

    const counts = {
      long: filtered.filter((s) => s.side === "LONG").length,
      short: filtered.filter((s) => s.side === "SHORT").length,
      total: filtered.length,
    };

    const sorted = filtered.sort((a, b) => b.score - a.score);
    const stocks = sorted.slice(offset, offset + limit);

    return res.status(200).json({
      ok: true,
      stocks,
      counts,
      page: {
        offset,
        limit,
        returned: stocks.length,
        hasMore: offset + stocks.length < counts.total,
      },
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
