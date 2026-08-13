// ════════════════════════════════════════════════════════════════════
// stock-signals-cron — 주식 멀티TF 정보 시그널 풀 생성 크론 (표시 전용)
// ────────────────────────────────────────────────────────────────────
// ★ 2026-08-11 (대표 지시 "코인 50개만 있고 주식은 없다"): 코인 풀
//   (di:signals:realtime-pool-mtf)과 동일 스키마의 주식 풀
//   "di:signals:stock-pool-mtf" 를 적재합니다.
//
// ★ 2026-08-13 (대표 지시 "51종밖에 지원 안 하는데 전 종목"): 유니버스 51종 →
//   1,016종. 한 런에 다 담을 수 없으므로 **KV 커서 라운드로빈 분할 스캔**으로
//   전 유니버스를 순환 커버합니다. 스캔되지 않은 종목의 엔트리는 last-known
//   으로 남고, 신선도는 엔트리별 dataTs(마지막 반영 캔들 시각)로 정직 표기됩니다.
//
//   ■ 규모 산정 근거 (2026-08-13 실측 — 지어낸 수치 아님)
//     · 야후 v8 chart 후보 1,118 심볼 연속 조회(동시성 12, 심볼당 1콜):
//       22.4초 · 429 0건 · 404 6건. 초당 약 50콜까지 조임 없음.
//     · 실제 스캔 프로필(심볼당 3콜 = 1wk/1d/1h 병렬):
//       기존 51종 전량 — 동시성 4 → 8.5초 / 8 → 2.5초 / 16 → 1.3초 (429 0건).
//       400종 1런(1,200콜) — 12~14초 (429 0건).
//     · 심볼당 CPU(파싱+지표 4TF+지지저항) 약 49ms.
//     · **한계도 실측했습니다**: 400종 런을 쉬는 시간 없이 3회 연달아 돌려
//       누적 약 2,700콜에 도달하자 야후가 429 를 쏟아냈고(285콜 중 132건),
//       약 2분 뒤 완전히 회복됐습니다. 정기 크론은 런 간격이 30분이라 이
//       구간과 듀티사이클이 전혀 다르지만, 아래 429 관측·중단 로직은 이
//       실측을 근거로 넣은 것입니다(중단돼도 커서가 남아 다음 런이 이어받음).
//     → 위는 전부 *로컬 측정*입니다. Vercel 함수는 vCPU 가 느리고 egress IP 가
//       공용이라 429 를 더 맞을 수 있으므로, 고정 심볼 수로 못 박지 않고
//       **시간 예산(TIME_BUDGET_MS) + 커서**로 자를 만큼만 자릅니다. 빠른 환경은
//       더 많이 훑고, 느려지면 적게 훑고 다음 런이 이어받습니다(타임아웃 불가).
//
//   ■ 실측 커버리지
//     미국 677종(상장 초기 19종 제외) = 400종 × 2런 → 스캔 창 안에서 16런/일이므로
//     약 1시간 주기로 전 종목 갱신. 한국 320종 = 1런이라 30분 주기(크론 간격과 동일,
//     창 안 15런/일). 전 유니버스 1바퀴 후 풀 716건 / 약 509KB (엔트리당 약 720B).
//
//   ■ 정직 고지 — "전 종목(수천)"은 불가
//     미국 상장 종목만 5,000개가 넘고 한국까지 더하면 8,000개 이상입니다.
//     심볼당 3콜 기준 24,000콜/사이클이라 30분 크론 1회로는 야후 부하·함수
//     실행시간 어느 쪽도 감당할 수 없습니다. 그래서 "실제로 거래되는 대형주 +
//     신규 상장"으로 1,016종을 골랐습니다(선정 기준은 _shared/stock-universe.js).
//
//   - 매매 엔진과 완전 무관: btc-cron 거래 경로·api/real-trading/* 는 이 키를
//     읽지 않으며, 이 크론은 어떤 매매 키도 쓰지 않습니다
//     (read/write: 자기 풀 1키 + 자기 스캔 커서 1키뿐).
//   - 데이터: 야후 v8 chart 직접 호출(_shared/stock-signals.js — yahoo.js 패턴).
//   - 실패 심볼은 건너뛰고 성공분만 저장 — 부분 실패가 전체를 죽이지 않음.
//     실패/미스캔 심볼의 기존 엔트리는 last-known 으로 유지(dataTs 로 신선도 표기),
//     성공 스캔에서 "방향 합의 없음(중립)"이 나온 심볼의 옛 엔트리는 제거(정직).
//   - 스케줄(vercel.json): "0,30 0-7,13-22 * * 1-5" 단일 행 — 30분 간격.
//     동일 path 다중 스케줄 등록의 배포 거부 리스크를 피하려고 1행으로 통합했고,
//     서머타임(EDT/EST) 양쪽 장 시간을 모두 덮도록 UTC 시간대를 넓게 겁니다.
//     ★ 2026-08-13 리뷰 수리: 실제 스캔 여부는 아래 MARKET_HOURS 게이트(현지
//     정규장 + 마감 후 여유)가 결정합니다. 창 밖 런은 야후 호출 0으로 즉시 종료
//     — 이전에는 한국 마감 후 2런·미국 개장 전 런이 그대로 돌아 하루 약 3,300콜을
//     "값이 바뀔 수 없는 재스캔"에 썼습니다. ?market= 로 강제 스캔은 여전히 가능.
//   - 킬스위치: ZEPTA_STOCK_SIGNALS=0 이면 즉시 no-op (기본 켜짐).
// ════════════════════════════════════════════════════════════════════

import { requireCronAuth } from "./_shared/require-cron.js";
import {
  STOCK_UNIVERSE, scanStockSymbol, isTooNewToScore,
  readFetchStats, resetFetchStats,
} from "./_shared/stock-signals.js";

export const config = { maxDuration: 300 };

const POOL_KEY = "di:signals:stock-pool-mtf";
const CURSOR_KEY = "di:signals:stock-scan-cursor"; // { us: <index>, kr: <index> }

// ── 런 예산 ──
//   TIME_BUDGET_MS: maxDuration 300초 중 스캔에 쓸 상한. 남은 90초는 KV 병합·
//     직렬화·응답 여유(Vercel 이 함수를 끊으면 커서 저장도 못 해 사이클이
//     제자리걸음 하므로 마진을 넉넉히 둡니다).
//   MAX_PER_RUN: 시간이 남아돌아도 한 런에 야후를 이 이상 두드리지 않는 상한.
//   CONCURRENCY: 실측상 16까지 429 0건이었으나, 공용 IP 리스크를 감안해 12에서
//     시작하고 429 가 관측되면 자동으로 낮춥니다(아래 적응 로직).
const TIME_BUDGET_MS = 210_000;
const MAX_PER_RUN = 400;
const CONCURRENCY_START = 12;
const BASE_DELAY_MS = 40;
const MAX_DELAY_MS = 1200;
//   ABORT_ON_R429: 실측(2026-08-13) 야후가 조이기 시작하면 거의 전량이 429 로
//     떨어졌습니다 — 몇 건 삼키고 버티는 게 아니라 빨리 멈추고 다음 런에
//     이어받는 편이 낫습니다. 일시적 1~2건에 과민 반응하지 않을 만큼만 여유.
const ABORT_ON_R429 = 25;

// ── 풀 상한 ──
//   엔트리 1건 실측 약 720~760 B. @vercel/kv 는 요청 본문이 커지면 실패하므로
//   건수와 바이트를 동시에 제한합니다(초과 시 스코어 낮은 순으로 잘라냄 —
//   공개 API(stock-scores)가 점수 상위만 노출하므로 사용자 영향 없음).
const POOL_MAX_ENTRIES = 1200;
const POOL_MAX_BYTES = 800_000;
//   신선도 상한 — 상장폐지·장기 실패 종목의 엔트리가 영구히 남지 않도록.
const STALE_MS = 14 * 24 * 60 * 60 * 1000;

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// ── 시장별 스캔 창 — "값이 실제로 바뀔 수 있는 시간"에만 훑습니다 ──
//   ★ 2026-08-13 리뷰 수리: 이전 판정은 UTC 시(hour)만 봐서 창이 실제 정규장보다
//     넓었습니다. 한국은 06:30 UTC 마감인데 07:00·07:30 UTC 두 런이 더 돌았고
//     (KR 320종은 매 런 전량 스캔이라 하루 약 1,920콜을 데이터가 바뀔 수 없는
//     재스캔에 소모), 미국도 개장 전 런이 포함돼 있었습니다. 이번 확대의 유일한
//     실측 병목이 야후 429 예산이므로 그 예산을 여기서 회수합니다.
//   판정 규칙(정직 고지):
//     · 개장 전 런 — 데이터가 전날 종가 그대로라 스캔해도 결과가 같음 → 제외.
//     · 마감 후 런 — 야후 시세는 지연 표기라 마감 *직후* 값은 아직 확정 종가가
//       아닙니다. 그래서 정규장 + 마감 후 여유(graceMin)까지는 포함하고 그 뒤만
//       잘라냅니다. 여유는 "한 바퀴 도는 데 필요한 런 수 × 크론 간격 30분"으로
//       잡았습니다 — 한국 320종은 1런(≤ MAX_PER_RUN)이라 30분, 미국 677종은
//       2런이라 60분. (여유를 0으로 두면 확정 종가를 아예 못 받습니다.)
//     · 서머타임은 Intl 타임존 변환으로 자동 반영합니다 — UTC 고정 창으로 두면
//       겨울(EST)에 미국 창이 1시간 어긋납니다.
//   ※ 크론(vercel.json)은 서머타임 양쪽을 덮도록 넓게 걸고, 실제 게이트는 여기입니다.
//     창 밖 런은 야후 호출 0으로 즉시 종료합니다(handler 상단 out-of-session 분기).
const MARKET_HOURS = {
  kr: { tz: "Asia/Seoul", open: 9 * 60, close: 15 * 60 + 30, graceMin: 30 },        // KRX 정규장 09:00~15:30 KST
  us: { tz: "America/New_York", open: 9 * 60 + 30, close: 16 * 60, graceMin: 60 },  // 미국 정규장 09:30~16:00 ET
};

// 해당 타임존의 현지 시각 — { mins: 0시부터 경과 분, weekend: 토·일 여부 }.
//   판정 불가면 null (지어내지 않음). 공휴일은 판정하지 않습니다 — 휴장일엔 야후가
//   같은 값을 돌려줘 결과가 틀리지는 않고, 국가별 휴장 달력을 하드코딩하면 해마다
//   썩기 때문입니다(정직 고지).
function localTime(tz, now) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hour12: false, hour: "2-digit", minute: "2-digit", weekday: "short",
    }).formatToParts(now);
    const h = Number(parts.find((p) => p.type === "hour")?.value);
    const m = Number(parts.find((p) => p.type === "minute")?.value);
    const wd = parts.find((p) => p.type === "weekday")?.value || "";
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
    // hour12:false 가 자정을 "24" 로 주는 런타임 대비해 %24
    return { mins: (h % 24) * 60 + m, weekend: wd === "Sat" || wd === "Sun" };
  } catch { return null; }
}

function inScanWindow(market, now) {
  const cfg = MARKET_HOURS[market];
  if (!cfg) return false;
  const lt = localTime(cfg.tz, now);
  if (!lt) return true;          // 타임존 판정 실패 — 스캔을 막지는 않습니다(가용성 우선)
  if (lt.weekend) return false;  // 정기 크론은 평일만 돌지만 수동 트리거 대비
  return lt.mins >= cfg.open && lt.mins <= cfg.close + cfg.graceMin;
}

// 현재 시각 기준 스캔 대상 시장 — 창 밖이면 빈 배열(= 이번 런은 야후 호출 0)
function defaultMarkets(now = new Date()) {
  return ["kr", "us"].filter((m) => inScanWindow(m, now));
}

// 커서 위치부터 시작하는 라운드로빈 슬라이스 (유니버스 끝에서 앞으로 되감김)
function rotate(list, start) {
  const n = list.length;
  if (n === 0) return [];
  const s = ((start % n) + n) % n;
  return s === 0 ? list.slice() : [...list.slice(s), ...list.slice(0, s)];
}

export default async function handler(req, res) {
  if (!requireCronAuth(req, res)) return; // 크론/내부 전용 가드 (timing-tracker 패턴)

  // 킬스위치 — 기본 켜짐, ZEPTA_STOCK_SIGNALS=0 으로 즉시 무동작
  if (process.env.ZEPTA_STOCK_SIGNALS === "0") {
    return res.status(200).json({ ok: true, skipped: "ZEPTA_STOCK_SIGNALS=0" });
  }

  const startedAt = Date.now();
  resetFetchStats();
  try {
    // ── 스캔 대상 결정 ──
    //   ?symbols=NVDA,005930.KS — 수동 디버그용 부분 스캔 (크론 가드 뒤라 외부 남용 불가)
    //   ?market=us|kr|all — 시장 강제 지정 (기본: MARKET_HOURS 스캔 창 자동 판정)
    //   ?limit=<n> — 이 런에서 훑을 심볼 수 상한 (기본 MAX_PER_RUN)
    const qSymbols = String(req.query?.symbols || "").split(",").map((s) => s.trim()).filter(Boolean);
    const qMarket = String(req.query?.market || "").toLowerCase();
    const qLimit = parseInt(req.query?.limit, 10);
    const perRun = Math.min(Number.isFinite(qLimit) && qLimit > 0 ? qLimit : MAX_PER_RUN, MAX_PER_RUN);
    const markets = qMarket === "all" ? ["us", "kr"]
      : qMarket === "us" || qMarket === "kr" ? [qMarket]
      : defaultMarkets(new Date());

    // 장 시간 밖 런 — 야후를 두드려도 값이 바뀌지 않으므로 즉시 종료(호출 0, KV 접근 0).
    //   ?symbols= / ?market= 수동 지정은 이 게이트를 우회합니다(디버그 목적).
    if (markets.length === 0 && qSymbols.length === 0) {
      return res.status(200).json({ ok: true, scanned: 0, skipped: "out-of-session", note: "장 시간 밖 — 스캔 생략" });
    }

    const { kv } = await import("@vercel/kv");

    // 상장 직후(일봉 62개 미만 확정) 종목은 호출 자체를 건너뜁니다 — 야후 3콜을
    // 써도 신호가 나올 수 없기 때문. 봉이 차면 자동으로 대상에 편입됩니다.
    const now = Date.now();
    const pendingNew = [];
    const eligible = STOCK_UNIVERSE.filter((u) => {
      if (!isTooNewToScore(u.listedAt, now)) return true;
      pendingNew.push({ symbol: u.symbol, name: u.name, listedAt: u.listedAt });
      return false;
    });

    // 수동 지정(?symbols=)은 상장 초기 필터를 우회합니다 — 디버그 목적상 유니버스의
    // 어떤 심볼이든 강제로 찔러볼 수 있어야 하기 때문(결과는 status 로 정직 보고).
    const manual = qSymbols.length > 0;
    const pools = manual
      ? [{ market: "manual", list: STOCK_UNIVERSE.filter((u) => qSymbols.includes(u.symbol)), cursor: 0 }]
      : null;

    const prevCursor = manual ? {} : ((await kv.get(CURSOR_KEY)) || {});
    const plan = pools || markets.map((m) => {
      const list = eligible.filter((u) => u.market === m);
      const c = Number(prevCursor?.[m]);
      return { market: m, list, cursor: Number.isFinite(c) ? c : 0 };
    });

    const totalEligible = plan.reduce((s, p) => s + p.list.length, 0);
    if (totalEligible === 0) {
      return res.status(200).json({ ok: true, scanned: 0, note: "스캔 대상 없음", markets, pendingNew: pendingNew.length });
    }

    // ── 심볼별 스캔 (동시성 제한 풀 + 시간 예산) ──
    //   실패는 수집만 하고 계속 진행. 예산 초과·429 폭주 시 즉시 멈추고
    //   훑은 만큼만 커서를 전진시켜 다음 런이 이어받습니다.
    const entries = [];           // 이번 런에 신호가 나온 엔트리
    const scannedOk = new Set();  // 스캔 성공(중립 포함 — 옛 엔트리 교체/제거 대상)
    const failed = [];            // 야후 응답 실패
    const shortHistory = [];      // 응답은 왔으나 일봉 62개 미만(상장 초기)
    const nextCursor = { ...(prevCursor || {}) };
    let concurrency = CONCURRENCY_START;
    let delayMs = BASE_DELAY_MS;
    let seenR429 = 0;
    let aborted = null;
    let processedTotal = 0;

    const budgetLeft = () => TIME_BUDGET_MS - (Date.now() - startedAt);

    for (let pi = 0; pi < plan.length; pi++) {
      const p = plan[pi];
      if (p.list.length === 0) continue;
      if (budgetLeft() <= 0) { aborted = aborted || "time-budget"; break; }

      const ordered = rotate(p.list, p.cursor);
      // 남은 예산을 남은 시장 수로 나눠 배분 — ?market=all 로 두 시장을 함께 돌릴 때
      // 앞 시장이 상한을 다 먹고 뒤 시장이 영원히 안 도는 걸 막습니다.
      // (정기 크론은 시장 1개라 share === perRun 으로 동작이 같습니다.)
      const share = Math.ceil((perRun - processedTotal) / (plan.length - pi));
      const quota = Math.min(share, ordered.length);
      if (quota <= 0) { aborted = aborted || "per-run-limit"; break; }

      let idx = 0;
      let done = 0; // 이 시장에서 실제로 처리한 수 (커서 전진량)
      const worker = async () => {
        while (true) {
          if (idx >= quota || budgetLeft() <= 0 || aborted) break;
          const t = ordered[idx++];
          try {
            const r = await scanStockSymbol(t);
            if (r?.status === "ok") {
              scannedOk.add(t.symbol);
              if (r.entry) entries.push(r.entry);
            } else if (r?.status === "insufficient-data") {
              shortHistory.push(t.symbol);
            } else {
              failed.push(t.symbol);
            }
          } catch (e) {
            failed.push(t.symbol);
            console.warn(`[stock-signals-cron] ${t.symbol} 스캔 실패: ${e?.message}`);
          }
          done++;

          // ── 429 적응 — 추정이 아니라 실측 카운터로 판단 ──
          const s = readFetchStats();
          if (s.r429 > seenR429) {
            seenR429 = s.r429;
            // delayMs 는 공유 변수라 진행 중인 워커에도 다음 심볼부터 즉시 반영됩니다.
            // concurrency 는 이미 뜬 워커 수를 줄이지 못하므로 "다음 시장 풀"에만 반영.
            delayMs = Math.min(delayMs * 2, MAX_DELAY_MS);
            concurrency = Math.max(4, concurrency - 1);
            if (s.r429 >= ABORT_ON_R429) { aborted = "rate-limited"; break; }
          }
          await delay(delayMs);
        }
      };
      await Promise.all(Array.from({ length: Math.min(concurrency, quota) }, worker));

      processedTotal += done;
      if (p.market !== "manual") nextCursor[p.market] = (p.cursor + done) % p.list.length;
      if (aborted === "rate-limited") break;
      if (budgetLeft() <= 0) { aborted = aborted || "time-budget"; break; }
    }

    // ── KV 병합 적재 — 성공분만 교체, 실패/미스캔 심볼은 last-known 유지 ──
    //   (분할 스캔이라 매 런 대부분의 심볼이 "미스캔"입니다. 옛 엔트리를 보존해
    //    풀이 비지 않게 하되, 스캔 성공했는데 중립인 심볼의 옛 엔트리는 제거하고
    //    STALE_MS 를 넘긴(상장폐지·장기 실패) 엔트리도 정리합니다.)
    const universeSet = new Set(STOCK_UNIVERSE.map((u) => u.symbol));
    const prevPool = (await kv.get(POOL_KEY)) || [];
    const staleCut = Date.now() - STALE_MS;
    let evicted = 0;
    const kept = (Array.isArray(prevPool) ? prevPool : []).filter((e) => {
      if (!e || !e.asset || !universeSet.has(e.asset) || scannedOk.has(e.asset)) return false;
      if ((e.dataTs || e.ts || 0) < staleCut) { evicted++; return false; }
      return true;
    });

    // 점수 높은 순으로 정렬한 뒤 건수·바이트 상한 적용 (초과분은 점수 하위부터 절삭).
    //   바이트 계산은 엔트리별 1회씩만 — 매번 전체를 직렬화하며 pop 하면 O(n²) 이라
    //   1,000건 규모에서 수백 ms 를 낭비합니다.
    const ranked = [...entries, ...kept]
      .sort((a, b) => (parseFloat(b.score) || 0) - (parseFloat(a.score) || 0))
      .slice(0, POOL_MAX_ENTRIES);
    const merged = [];
    let poolBytes = 2; // "[]"
    let trimmedForBytes = 0;
    for (const e of ranked) {
      const b = Buffer.byteLength(JSON.stringify(e)) + 1; // + 구분자
      if (poolBytes + b > POOL_MAX_BYTES) { trimmedForBytes++; continue; }
      poolBytes += b;
      merged.push(e);
    }
    await kv.set(POOL_KEY, merged);
    if (!manual) await kv.set(CURSOR_KEY, nextCursor);

    const stats = readFetchStats();
    const took = Date.now() - startedAt;
    const cycleRuns = processedTotal > 0 ? Math.ceil(totalEligible / processedTotal) : null;
    console.log(
      `[stock-signals-cron] markets=${markets.join(",")} 처리 ${processedTotal}/${totalEligible}종 ` +
      `(성공 ${scannedOk.size}, 신호 ${entries.length}, 유지 ${kept.length}, 실패 ${failed.length}, ` +
      `봉부족 ${shortHistory.length}, 429 ${stats.r429}) 커서 ${JSON.stringify(nextCursor)} ${took}ms` +
      (aborted ? ` [중단: ${aborted}]` : ""),
    );
    return res.status(200).json({
      ok: true,
      markets,
      universe: STOCK_UNIVERSE.length,
      eligible: totalEligible,          // 이번 런의 스캔 후보(상장 초기 제외)
      processed: processedTotal,        // 이번 런에서 실제로 훑은 심볼 수
      scanned: scannedOk.size,          // 그중 야후 응답까지 성공
      loaded: entries.length,           // 방향 합의가 있어 새로 적재된 엔트리
      neutral: scannedOk.size - entries.length, // 스캔 성공했으나 방향 합의 없음
      kept: kept.length,                // last-known 유지(미스캔·실패 심볼)
      evicted,                          // 14일 초과 노후 엔트리 정리
      failed: failed.slice(0, 40),      // 응답 실패 (전량 아님 — 응답 비대화 방지)
      failedCount: failed.length,
      shortHistory: shortHistory.slice(0, 40), // 상장 초기(일봉 62개 미만)
      shortHistoryCount: shortHistory.length,
      pendingNew: pendingNew.length,    // 상장일 기준으로 호출조차 생략한 신규 상장
      cursor: nextCursor,
      cycleRuns,                        // 전 유니버스 1바퀴에 필요한 런 수(추정)
      aborted,                          // null | "time-budget" | "per-run-limit" | "rate-limited"
      yahoo: stats,                     // 호출 통계 — 429 관측 실측치
      poolSize: merged.length,
      poolBytes,
      trimmedForBytes,
      tookMs: took,
    });
  } catch (err) {
    console.error("[stock-signals-cron]", err);
    return res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
}
