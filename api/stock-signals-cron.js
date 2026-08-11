// ════════════════════════════════════════════════════════════════════
// stock-signals-cron — 주식 51종 멀티TF 정보 시그널 풀 생성 크론 (표시 전용)
// ────────────────────────────────────────────────────────────────────
// ★ 2026-08-11 (대표 지시 "코인 50개만 있고 주식은 없다"): 코인 풀
//   (di:signals:realtime-pool-mtf)과 동일 스키마의 주식 풀
//   "di:signals:stock-pool-mtf" 를 적재합니다.
//
//   - 매매 엔진과 완전 무관: btc-cron 거래 경로·api/real-trading/* 는 이 키를
//     읽지 않으며, 이 크론은 어떤 매매 키도 쓰지 않습니다(read: 자기 풀 1키,
//     write: 자기 풀 1키뿐).
//   - 데이터: 야후 v8 chart 직접 호출(_shared/stock-signals.js — yahoo.js 패턴).
//   - 실패 심볼은 건너뛰고 성공분만 저장 — 부분 실패가 전체를 죽이지 않음.
//     실패/미스캔 심볼의 기존 엔트리는 last-known 으로 유지(ts 로 신선도 표기),
//     성공 스캔에서 "방향 합의 없음(중립)"이 나온 심볼의 옛 엔트리는 제거(정직).
//   - 스케줄(vercel.json): "0,30 0-7,13-21 * * 1-5" 단일 행 — 한국(0~7 UTC)·
//     미국(13~21 UTC) 장중 30분 간격. 동일 path 다중 스케줄 등록의 배포 거부
//     리스크를 피하려고 1행으로 통합(KR 창 호출 2배 트레이드오프 수용).
//     야후 호출량 절감을 위해 현재 UTC 시각이 속한 장의 심볼만 스캔
//     (마감된 시장은 데이터가 변하지 않으므로 재스캔이 낭비 — ?market= 로 강제 가능).
//   - 킬스위치: ZEPTA_STOCK_SIGNALS=0 이면 즉시 no-op (기본 켜짐).
// ════════════════════════════════════════════════════════════════════

import { requireCronAuth } from "./_shared/require-cron.js";
import { STOCK_UNIVERSE, scanStockSymbol } from "./_shared/stock-signals.js";

export const config = { maxDuration: 300 }; // 51종 × TF 3회 호출 — 동시성 4로 수 분 여유

const POOL_KEY = "di:signals:stock-pool-mtf";
const CONCURRENCY = 4; // 심볼 동시 처리 수 (심볼당 야후 3콜 병렬 → 최대 12콜 동시)

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// 현재 UTC 시각 기준 스캔 대상 시장 선택 — 마감 시장 재스캔 낭비 방지.
//   한국 정규장 09:00~15:30 KST = 00:00~06:30 UTC → 0~7시 런은 kr
//   미국 정규장 09:30~16:00 ET = 13:30~21:00 UTC(서머타임 여부 포함) → 12~23시 런은 us
//   그 외 시각(수동 트리거 등)은 전체.
function defaultMarkets(hourUTC) {
  if (hourUTC >= 0 && hourUTC < 9) return ["kr"];
  if (hourUTC >= 12) return ["us"];
  return ["us", "kr"];
}

export default async function handler(req, res) {
  if (!requireCronAuth(req, res)) return; // 크론/내부 전용 가드 (timing-tracker 패턴)

  // 킬스위치 — 기본 켜짐, ZEPTA_STOCK_SIGNALS=0 으로 즉시 무동작
  if (process.env.ZEPTA_STOCK_SIGNALS === "0") {
    return res.status(200).json({ ok: true, skipped: "ZEPTA_STOCK_SIGNALS=0" });
  }

  const startedAt = Date.now();
  try {
    // ── 스캔 대상 결정 ──
    //   ?symbols=NVDA,005930.KS — 수동 디버그용 부분 스캔 (크론 가드 뒤라 외부 남용 불가)
    //   ?market=us|kr|all — 시장 강제 지정 (기본: UTC 시각 기반 자동)
    const qSymbols = String(req.query?.symbols || "").split(",").map((s) => s.trim()).filter(Boolean);
    const qMarket = String(req.query?.market || "").toLowerCase();
    const markets = qMarket === "all" ? ["us", "kr"]
      : qMarket === "us" || qMarket === "kr" ? [qMarket]
      : defaultMarkets(new Date().getUTCHours());
    const targets = qSymbols.length > 0
      ? STOCK_UNIVERSE.filter((u) => qSymbols.includes(u.symbol))
      : STOCK_UNIVERSE.filter((u) => markets.includes(u.market));

    if (targets.length === 0) {
      return res.status(200).json({ ok: true, scanned: 0, note: "스캔 대상 없음", markets });
    }

    // ── 심볼별 스캔 (동시성 제한 풀) — 실패는 수집만 하고 계속 진행 ──
    const entries = [];        // 이번 런에 신호가 나온 엔트리
    const scannedOk = new Set(); // 성공적으로 스캔된 심볼(중립 포함 — 옛 엔트리 교체/제거 대상)
    const failed = [];
    let idx = 0;
    const worker = async () => {
      while (idx < targets.length) {
        const t = targets[idx++];
        try {
          const r = await scanStockSymbol(t);
          if (r === null) { failed.push(t.symbol); continue; } // 데이터 부족/호출 실패 — 건너뜀
          scannedOk.add(t.symbol);
          if (r.entry) entries.push(r.entry);
        } catch (e) {
          failed.push(t.symbol);
          console.warn(`[stock-signals-cron] ${t.symbol} 스캔 실패: ${e?.message}`);
        }
        await delay(80); // 야후 부하 분산 소량 딜레이
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker));

    // ── KV 병합 적재 — 성공분만 교체, 실패/미스캔 심볼은 last-known 유지 ──
    //   (장 마감 시장·부분 실패 심볼의 옛 엔트리를 보존해 풀이 절대 비지 않게.
    //    스캔 성공했는데 중립인 심볼의 옛 엔트리는 제거 — 현재 데이터가 "방향 없음"이므로.)
    const { kv } = await import("@vercel/kv");
    const universeSet = new Set(STOCK_UNIVERSE.map((u) => u.symbol));
    const prevPool = (await kv.get(POOL_KEY)) || [];
    const kept = (Array.isArray(prevPool) ? prevPool : []).filter(
      (e) => e && e.asset && universeSet.has(e.asset) && !scannedOk.has(e.asset)
    );
    const merged = [...entries, ...kept].slice(0, 120); // 유니버스 51종 — 여유 캡
    await kv.set(POOL_KEY, merged);

    const took = Date.now() - startedAt;
    console.log(`[stock-signals-cron] markets=${markets.join(",")} 스캔 ${scannedOk.size}/${targets.length}, 신호 ${entries.length}건, 유지 ${kept.length}건, 실패 ${failed.length}건, ${took}ms`);
    return res.status(200).json({
      ok: true,
      markets,
      scanned: scannedOk.size,
      targets: targets.length,
      loaded: entries.length,          // 이번 런 신규 적재(방향 합의 있는 심볼)
      neutral: scannedOk.size - entries.length, // 스캔 성공했으나 방향 합의 없음
      kept: kept.length,               // last-known 유지(마감 시장/실패 심볼)
      failed,
      poolSize: merged.length,
      tookMs: took,
    });
  } catch (err) {
    console.error("[stock-signals-cron]", err);
    return res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
}
