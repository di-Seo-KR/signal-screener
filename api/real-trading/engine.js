// api/real-trading/engine.js
//
// Phase 1 실전매매 엔진 (Vercel cron).
//
// 역할:
//  1) 킬스위치 + 서킷브레이커 체크
//  2) 가상매매 봇의 BUY 로그에서 최근 시그널 후보 수집
//  3) canonical 변환 + 최상 신호 선택
//  4) Option A(절대수익형) 리스크 매니저로 수량/SL/TP 산출
//  5) executeOrderPlan 로 집행 (bracket atomic + retry)
//  6) 모든 스텝을 engine-log 에 기록. shadow 면 shadow-ledger 에 추가 기록.
//
// ★ dry run / shadow 분리 원칙 ★
//  - forceDryRun: 실제 Binance 주문은 안 나감. 킬스위치/phase1 체크 우회.
//                 lastSeen 커서를 건드리지 않아 반복 호출 가능.
//                 lookback 기본 24h, PHASE1 strict 해제. 진단용.
//  - shadow: forceDryRun 과 동일하지만, plan 을 shadow-ledger 에 기록해서
//            shadow-monitor cron 이 가상 손익을 추적하게 함.
//  - probe(옵션): 아무 시그널도 없을 때 ETHUSDT LONG 합성 시그널을 만들어
//                 파이프라인 전체가 도는지 확인할 수 있게 함.
//
// cron 기본 동작 (GET): phase1_enabled 유저 순회, 실전 집행.

import { loadUserCredentials, respondError } from "../_shared/binance-auth.js";
// ★ 2026-05-09 audit N2: pickBestSignal 미사용 (rankSignals 만 사용) — dead import 제거
import { extractSignal, rankSignals } from "../_shared/signal-extractor.js";
import { loadFamilyWeightsRobust, applyWeightsToRanking } from "../_shared/strategy-weights.js";
import { planTrade, RISK_CONFIG, SWING_EXITS, checkAggregateExposure, checkPyramidGuard, checkSameSymbolNotional, inSameCorrelationGroup } from "../_shared/risk-manager.js";
import { preTradeCheck } from "../_shared/circuit-breaker.js";
import { getSymbolFilter, isSymbolAffordable } from "../_shared/exchange-info.js";
import { getTickerPrice, getAccountInfo, getKlines, getPositionRisk, placeOrder } from "../_shared/binance-client.js";
import { UNIVERSE_KV_KEY } from "../_shared/futures-universe.js";
import { executeOrderPlan } from "../binance/order.js";
import { checkReentryCooldown } from "../_shared/reentry-cooldown.js";
import { getStrategyStatus, STRATEGY_STATUS } from "../_shared/dynamic-config.js";

export const config = { maxDuration: 60 };

// 글로벌 probe 유저 — KV 등록 없이도 cron 이 항상 dry-run+shadow 로 실행
export const GLOBAL_PROBE_USER = "__zepta_global_probe__";

async function getKv() {
  const mod = await import("@vercel/kv");
  return mod.kv;
}

/**
 * 최근 봇 trades 로그에서 미처리 BUY 시그널 후보 수집.
 * @param {object} args
 * @param {string} args.userId
 * @param {number} args.lookbackMs    최근 몇 밀리초 이내만 (기본 30분)
 * @param {boolean} args.advanceCursor lastSeen 을 advance 할지 (dry run 은 false)
 */
// ★ 2026-05-11: lookback 30분 → 4시간 확장.
//   가상 포트폴리오 노출 한도(80%) 도달로 btc-cron 이 신호 생성해도 perf.trades 에
//   BUY 가 매번 기록되진 않음. 30분 lookback 이라 시그널 풀이 자주 비어 진입 못 함.
//   4시간으로 늘려 최근 사이클의 시그널까지 진입 후보로 사용.
async function pullRecentSignals({ userId, lookbackMs = 4 * 60 * 60 * 1000, advanceCursor = true }) {
  const kv = await getKv();
  // ★ 2026-05-13 architectural fix: 시그널 풀 SSOT 우선 사용.
  //   대표 지시: "다시는 실제매매 쪽이 이런 이슈들로 영향받지 않게"
  //   기존 di:bot:*:perf 의존성은 가상 포트폴리오 한도/skip 에 영향 받음 → 풀 empty 위험.
  //   di:signals:realtime-pool 은 btc-cron 이 시그널 생성 시 항상 push (가상매매 결과 무관)
  //   → real-trading engine 이 이 풀에서 직접 fetch 하면 가상매매와 완전 분리.
  //   fallback 으로 di:bot:*:perf 도 유지 (옛 데이터 또는 풀 미적재 케이스 대비).
  const activeBots = (await kv.get("di:active-bots")) || [];
  const cryptoBots = activeBots.filter((b) =>
    /^(btc-alpha|highcap-momentum|defi-infra|meme-trend|l2-emerging|crypto-diversity|crypto-swing)/
      .test(b.id || b.botId || "")
  );
  const lastSeenKey = `di:real:user:${userId}:last-signal-ts`;
  const lastSeen = advanceCursor ? ((await kv.get(lastSeenKey)) || 0) : 0;
  const now = Date.now();
  // ★ 2026-05-11 fix: cursor 와 lookback 둘 다 적용.
  //   이전: advanceCursor=true 면 lastSeen 만 보고 lookback 무시 →
  //         가상 포트폴리오 한도로 cursor 가 14:46 같이 너무 앞에 가있으면
  //         다음 cron 마다 "그 이후 시그널만" 봐서 풀 빔.
  //   현재: minTs = min(lastSeen, now - lookbackMs).
  //         cursor 와 lookback 중 더 오래된 시점을 minTs 로 → lookback 윈도우 안의 시그널은 항상 잡힘.
  //   (작을수록 더 많이 보는 게 minTs 의미)
  const minTs = advanceCursor
    ? Math.min(lastSeen, now - lookbackMs)
    : (now - lookbackMs);

  // ★ 2026-05-09 audit M2: BUY 만 수집하던 게 SHORT 시그널 영구 누락 원인.
  //   가상매매 봇이 SELL 시그널을 만들어도 실전 엔진이 절대 못 봄 → 약세장 알파 0.
  //   현재: BUY/SELL 둘 다 수집. signal-extractor 가 LONG/SHORT 매핑 처리.
  const diag = { activeBots: activeBots.length, cryptoBots: cryptoBots.length, tradesScanned: 0, buyFound: 0, sellFound: 0, inWindow: 0, perBotDedup: 0, poolHits: 0, perfHits: 0 };
  const candidates = [];
  const seenAssetType = new Set(); // (asset:type) dedup — 풀과 perf 양쪽에서 최신 1개만

  // ★ 2026-05-13 architectural fix: 시그널 풀 SSOT 우선 사용 (가상매매와 완전 분리).
  //   di:signals:realtime-pool 은 btc-cron 이 시그널 생성 시마다 push (가상 포트폴리오 한도/skip 무관).
  //   pool 이 비어있으면 fallback 으로 di:bot:*:perf 사용 → 다중 소스 fail-safe.
  try {
    const pool = (await kv.get("di:signals:realtime-pool")) || [];
    // 최신순 정렬 (방어적 — btc-cron 에서 prepend 하므로 이미 최신순이지만 확실히)
    const sortedPool = [...pool].sort((a, b) => (b.ts || 0) - (a.ts || 0));
    for (const entry of sortedPool) {
      const ts = entry.ts || 0;
      if (ts <= minTs) continue;
      if (now - ts > lookbackMs) continue;
      const isBuy = entry.type === "BUY";
      const isSell = entry.type === "SELL";
      if (!isBuy && !isSell) continue;
      const key = `${entry.asset}:${entry.type}`;
      if (seenAssetType.has(key)) continue; // 최신 1개만
      seenAssetType.add(key);
      diag.poolHits += 1;
      if (isBuy) diag.buyFound += 1;
      if (isSell) diag.sellFound += 1;
      diag.inWindow += 1;
      candidates.push({
        asset: entry.asset,
        source: entry.source || "signal-pool",
        signal: {
          type: entry.type,
          confidence: entry.confidence || "B",
          score: entry.score ?? 60,
          reason: entry.reason || `${entry.source || "pool"} ${entry.type}`,
          family: entry.family || undefined,
          timeframe: entry.timeframe || undefined,
          positionSize: entry.positionSize || 0.5,
          // ★ 2026-06-14: 진입 게이트 메타(btc-cron enrich) — extractSignal 통해 cand 로 전달
          rsi1h: entry.rsi1h ?? null,
          htfConfirm: entry.htfConfirm === true,
          quoteVolume: entry.quoteVolume ?? null,
        },
        ts,
      });
    }
  } catch (poolErr) {
    diag.poolError = poolErr?.message;
  }

  // Fallback: di:bot:*:perf 의 trades — 풀 미적재 케이스 대비 (fail-safe 원래 목적).
  // ★ 2026-07-08 (진단 F3 우회 구멍 봉합): 풀이 살아있으면 perf 폴백을 아예 안 탄다.
  //   btc-cron 은 F3(레짐+ER+ATR) 필터로 차단된 신호도 가상매매 perf.trades 에는 기록하므로,
  //   폴백이 항상 돌면 필터 우회 경로가 됨(실측: 필터 배포 후에도 마이크로캡 유입).
  // ★ 리뷰 A(critical) 반영: poolHits=0 은 "장애"와 "전 신호 필터 차단"을 구분 못 함 —
  //   횡보장에 필터가 전량 차단하면 풀이 비는 게 정상이고 그때 폴백이 차단 신호를 재유입시킴.
  //   btc-cron 하트비트(di:signals:pool-heartbeat, 매 런 기록)가 30분 넘게 정체일 때만
  //   진짜 장애로 판정해 폴백 가동. 하트비트 키 부재(구버전)는 장애 취급(하위호환 fail-safe).
  let cronStale = true;
  try {
    const hb = await kv.get("di:signals:pool-heartbeat");
    cronStale = !Number.isFinite(hb) || (now - hb) > 30 * 60 * 1000;
  } catch { cronStale = true; }
  const usePerfFallback = diag.poolHits === 0 && cronStale;
  if (!usePerfFallback && cryptoBots.length) diag.perfFallbackSkipped = true;
  diag.cronStale = cronStale;
  for (const b of usePerfFallback ? cryptoBots : []) {
    const botId = b.id || b.botId;
    const perf = await kv.get(`di:bot:${botId}:perf`);
    if (!perf || !Array.isArray(perf.trades)) continue;
    // ★ 봇별 종목 dedup — 한 봇이 같은 심볼로 5분마다 17번 시그널 만든 케이스
    // (2026-05-03 진단: 17개 시그널 모두 AVAXUSDT) → 최신 1개만 유지
    const seenAssetsThisBot = new Set();
    for (const t of perf.trades.slice(0, 20)) {
      diag.tradesScanned += 1;
      if (!t || !t.time) continue;
      const isBuy = t.type === "BUY";
      const isSell = t.type === "SELL";
      if (!isBuy && !isSell) continue;
      if (isBuy) diag.buyFound += 1;
      if (isSell) diag.sellFound += 1;
      const ts = new Date(t.time).getTime();
      if (!Number.isFinite(ts)) continue;
      if (ts <= minTs) continue;
      if (now - ts > lookbackMs) continue;
      diag.inWindow += 1;
      // 봇별 종목 dedup — perf.trades 가 시간 역순(최신 우선)이므로 첫 등장이 최신
      if (seenAssetsThisBot.has(t.asset)) {
        diag.perBotDedup += 1;
        continue;
      }
      // ★ 전역 (asset:type) dedup — 시그널 풀에서 이미 가져왔으면 중복 적재 방지
      const globalKey = `${t.asset}:${t.type}`;
      if (seenAssetType.has(globalKey)) {
        diag.perBotDedup += 1;
        continue;
      }
      seenAssetsThisBot.add(t.asset);
      seenAssetType.add(globalKey);
      diag.perfHits += 1;
      candidates.push({
        asset: t.asset,
        source: `bot:${botId}`,
        signal: {
          type: t.type,  // "BUY" | "SELL" — extractSignal 이 LONG/SHORT 로 변환
          confidence: t.signal?.confidence || t.confidence || "B",
          score: t.signal?.score || t.score || 60,
          reason: t.signal?.reason || `${botId} ${t.type}`,
          // ★ 2026-05-11: strategy dispatcher 가 채워주는 family/timeframe 전달
          family: t.signal?.family || undefined,
          timeframe: t.signal?.timeframe || undefined,
          positionSize: 0.5,
        },
        ts,
      });
    }
  }
  if (advanceCursor) {
    // ★ 감사 P2: 커서 advance 실패를 관측 가능하게(기존 빈 catch=무음 실패). 비치명적 —
    //   다음 사이클은 minTs=Math.min(lastSeen, now-lookback) 의 lookback 윈도우 + seenAssetType
    //   dedup + same-symbol notional cap(checkSameSymbolNotional)이 *실 가드*로 중복/과다진입을 차단.
    //   ★ 적대감사 P1-8 정정: clientOrderId(p1-${best.id})는 generatedAt 포함이라 런마다 바뀌어 멱등
    //   백스톱이 실제로는 미작동 — 위 가드들이 진짜 방어선. 안정 id 백스톱은 ZEPTA_STABLE_CLIENT_ORDER_ID(아래).
    try { await kv.set(lastSeenKey, now); }
    catch (e) { console.warn(`[engine] lastSeen 커서 advance 실패 (${userId}): ${e?.message} — lookback 윈도우로 dedup 보호됨`); }
  }
  return { candidates, diag };
}

/** 실 ATR(14). Wilder smoothing. */
async function computeAtr(symbol, interval = "4h", period = 14) {
  try {
    const kl = await getKlines({ symbol, interval, limit: period + 30 });
    if (!Array.isArray(kl) || kl.length < period + 1) return null;
    const highs = kl.map((k) => parseFloat(k[2]));
    const lows  = kl.map((k) => parseFloat(k[3]));
    const closes= kl.map((k) => parseFloat(k[4]));
    const trs = [];
    for (let i = 1; i < kl.length; i++) {
      const tr = Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - closes[i - 1]),
        Math.abs(lows[i] - closes[i - 1])
      );
      trs.push(tr);
    }
    let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < trs.length; i++) {
      atr = (atr * (period - 1) + trs[i]) / period;
    }
    return atr;
  } catch (e) {
    console.warn("[engine] ATR compute failed:", e?.message);
    return null;
  }
}
function defaultAtrApprox(price) { return price * 0.015; }

async function getEquityUsdt(creds) {
  try {
    const acct = await getAccountInfo(creds);
    const v = parseFloat(acct.totalWalletBalance || "0");
    const avail = parseFloat(acct.availableBalance || "0"); // ★ 신규 진입 가용 마진
    return { equity: Number.isFinite(v) ? v : 0, available: Number.isFinite(avail) ? avail : 0 };
  } catch (e) {
    console.warn("[engine] equity fetch failed:", e?.message);
    return { equity: 0, available: 0 };
  }
}

async function isPhase1Enabled(userId) {
  try {
    const kv = await getKv();
    return !!(await kv.get(`di:real:user:${userId}:phase1_enabled`));
  } catch { return false; }
}

/** 현재 오픈 포지션 수 (상관/동시 보유 제한용) */
async function countOpenPositions(userId) {
  try {
    const kv = await getKv();
    const last = (await kv.get(`di:real:user:${userId}:last-positions`)) || {};
    return Object.keys(last).length;
  } catch { return 0; }
}

/** 합성 probe 시그널 — 아무 신호도 없을 때 파이프라인 전체 점검용 */
function synthProbeSignal() {
  return {
    asset: "ETH",
    source: "probe:manual",
    signal: {
      type: "BUY",
      confidence: 0.7,
      score: 65,
      reason: "[4h] PROBE synthetic — pipeline smoke test",
      positionSize: 0.5,
    },
    ts: Date.now(),
  };
}

// ★ 2026-06-12: engine-log 기본 cap 200→600. 5분 cron(~288/일)+2분 청산이 같은 키를
//   경쟁해 어제 새벽~오전 활동이 일일보고(KST06:00) 전에 evict 되던 문제 완화.
//   (근본책 = 일자별 키 분리는 별도 PR.) shadow-ledger 호출은 cap=500 명시라 영향 없음.
async function appendLog(userId, key, entry, cap = 600) {
  try {
    const kv = await getKv();
    const log = (await kv.get(key)) || [];
    log.unshift(entry);
    await kv.set(key, log.slice(0, cap));
  } catch (e) {
    console.warn(`[engine] log save failed (${key}):`, e?.message);
  }
}

/**
 * 한 유저에 대해 한 번 집행.
 * @param {object} args
 * @param {string} args.userId
 * @param {boolean} [args.forceDryRun=false]  true 면 주문 안 나감, 킬스위치/phase1 우회
 * @param {boolean} [args.shadow=false]       shadow-ledger 에 기록
 * @param {boolean} [args.probe=false]        시그널 없을 때 합성 시그널 생성
 * @param {number} [args.lookbackMs]          dry run 에서 lookback 확장 (기본 24h when dry)
 */
async function runOnce({ userId, forceDryRun = false, shadow = false, probe = false, lookbackMs }) {
  const steps = [];
  const S = (m) => steps.push(m);
  const startedAt = new Date().toISOString();

  // ★ 2026-05-13 fix: engine heartbeat — 진입 즉시 timestamp KV 갱신.
  //   대시보드의 "엔진" dot 가 engine-log[0]?.time 으로 판정하는데, "no recent signals"
  //   사이클은 engine-log 에 push 안 함 → 30분 빈 사이클 연속 시 dot 빨강 표시.
  //   heartbeat 는 어떤 종료 사유든 무관하게 매 cron 마다 update → dot 정확 표시.
  //   shadow/dry-run/probe 도 모두 heartbeat 갱신 (엔진이 살아있다는 사실 표시).
  try {
    const kvHb = await getKv();
    await kvHb.set(`di:real:user:${userId}:engine-heartbeat`, {
      time: startedAt,
      mode: shadow ? "shadow" : (forceDryRun ? "dry" : "live"),
      probe: !!probe,
    });
  } catch (hbErr) {
    // heartbeat 실패는 정상 흐름 막지 않음
    S(`heartbeat failed: ${hbErr?.message}`);
  }

  // 1) phase1_enabled (dry run 은 우회)
  if (!forceDryRun) {
    const enabled = await isPhase1Enabled(userId);
    if (!enabled) {
      S("skip: phase1_enabled=false");
      return { ok: true, userId, ran: false, reason: "phase1 disabled", steps };
    }
  } else {
    S("dry-run: phase1 check skipped");
  }

  // 2) 크레덴셜 — dry run 은 creds 없어도 파이프라인 전체가 돌아가야 함
  let creds = null;
  try {
    creds = await loadUserCredentials(userId);
    S(`credentials loaded`);
  } catch (e) {
    if (forceDryRun) {
      S(`dry-run: credentials unavailable (${e.message}) — continuing with fallback equity`);
    } else {
      S(`credentials error: ${e.message}`);
      return { ok: false, userId, ran: false, reason: `credentials: ${e.message}`, error: e.message, steps };
    }
  }

  // 3) 에쿼티 — creds 있으면 진짜 조회, 없으면 $100 fallback (dry run)
  let equity = 0;
  let availMargin = 0; // ★ 2026-06-03: 가용 마진(신규 진입 한도) — planTrade 가 이 안으로 사이징
  if (creds) {
    const acc = await getEquityUsdt(creds);
    equity = acc.equity; availMargin = acc.available;
    S(`equity=$${equity.toFixed(2)} available=$${availMargin.toFixed(2)}`);
  } else {
    S(`dry-run: skipping equity fetch (no creds)`);
  }
  // 최저 원금 하한선 — env ZEPTA_MIN_EQUITY (기본 $50, 대표 지시로 $200→$50 하향).
  //   실거래 가능 최소치 근처. 이 아래에선 minNotional 대비 사이징이 의미 없어 진입 안 함.
  //   개별 종목 affordability(minNotional) 체크가 추가 backstop 으로 동작.
  const _minEq = parseFloat(process.env.ZEPTA_MIN_EQUITY);
  const MIN_EQUITY = Number.isFinite(_minEq) ? _minEq : 50; // =0 도 허용(|| 안티패턴 수정)
  if (equity < MIN_EQUITY && !forceDryRun) {
    S(`equity < $${MIN_EQUITY} — skip (min equity)`);
    return { ok: true, userId, ran: false, reason: `insufficient equity (min $${MIN_EQUITY})`, equity, steps };
  }
  // ★ 2026-05-09 audit N3: dry-run fallback equity 환경변수화.
  //   기본 $1000 은 실제 자본 ~$370 과 차이 커서 plan 시뮬이 실거래와 다름.
  //   ZEPTA_DRYRUN_EQUITY 로 조정 가능. 미설정 시 $370 (현재 실자본 근사).
  const dryRunFallback = parseFloat(process.env.ZEPTA_DRYRUN_EQUITY || "370") || 370;
  const effectiveEquity = equity > 0 ? equity : (forceDryRun ? dryRunFallback : 0);
  if (forceDryRun && equity <= 0) S(`dry-run: using $${effectiveEquity} fallback equity`);

  // 4) 서킷브레이커 — dry run 은 조회만 하고 차단은 안 함
  if (!forceDryRun) {
    const gate = await preTradeCheck(userId, effectiveEquity);
    if (!gate.allowed) {
      S(`breaker blocked: ${gate.reason}`);
      return { ok: true, userId, ran: false, reason: gate.reason, blocked: true, steps };
    }
    // 동시 보유 제한 (Option A: max 2)
    const openCount = await countOpenPositions(userId);
    if (openCount >= (RISK_CONFIG.maxConcurrentPositions || 2)) {
      S(`max concurrent positions reached (${openCount})`);
      return { ok: true, userId, ran: false, reason: "max concurrent positions", steps };
    }
  } else {
    S("dry-run: breaker/killswitch/concurrency checks skipped");
  }

  // 5) 시그널 수집 — dry run 은 24h lookback, live 는 4h (이전 30분).
  //    가상 포트폴리오 노출 한도(80%) 로 btc-cron 의 신호 기록 빈도가 낮아 30분 너무 짧음.
  const lbMs = lookbackMs || (forceDryRun ? 24 * 60 * 60 * 1000 : 4 * 60 * 60 * 1000);
  const { candidates, diag } = await pullRecentSignals({
    userId,
    lookbackMs: lbMs,
    advanceCursor: !forceDryRun,
  });
  S(`scan: bots=${diag.cryptoBots} trades=${diag.tradesScanned} buys=${diag.buyFound} inWindow=${diag.inWindow}`);

  let rawSignals = candidates;
  if (!rawSignals.length && forceDryRun && probe) {
    rawSignals = [synthProbeSignal()];
    S("dry-run: injecting synthetic probe signal (ETH LONG)");
  }
  if (!rawSignals.length) {
    return { ok: true, userId, ran: false, reason: "no recent signals", diag, steps };
  }

  // 6) canonical — dry run 은 strict 해제 (더 많은 심볼 통과)
  // rejectStats 로 시그널이 떨어진 원인 카운트 (디버깅 + engine-log 노출)
  // ★ 2026-06-11 (대표 승인 2안): 동적 유니버스(유동성 상위 50종) 심볼맵/허용셋 주입.
  //   KV 미존재·읽기 실패 시 null → 기존 정적 30종과 동일 동작 (fail-safe).
  let dynSymbolMap = null, dynAllowed = null;
  try {
    const kvU = await getKv();
    const uni = await kvU.get(UNIVERSE_KV_KEY);
    if (Array.isArray(uni?.entries) && uni.entries.length) {
      dynSymbolMap = {};
      dynAllowed = new Set();
      for (const e of uni.entries) {
        if (e?.base && e?.symbol) { dynSymbolMap[e.base] = e.symbol; dynAllowed.add(e.symbol); }
      }
      S(`dynamic universe loaded: ${dynAllowed.size} symbols`);
    }
  } catch { /* 정적 폴백 */ }
  const rejectStats = {};
  const canonical = rawSignals
    .map((r) => extractSignal(r, { strict: !forceDryRun, rejectStats, symbolMap: dynSymbolMap, allowedSymbols: dynAllowed }))
    .filter(Boolean);
  // reject 사유 요약 (notAllowedSymbols 는 Set 이라 toArray)
  const rejectSummary = (() => {
    const out = { ...rejectStats };
    if (out.notAllowedSymbols instanceof Set) {
      out.notAllowedSymbols = Array.from(out.notAllowedSymbols);
    }
    return out;
  })();
  S(`canonical=${canonical.length}` + (canonical.length === 0 && rawSignals.length > 0 ? ` (rejected: ${JSON.stringify(rejectSummary).slice(0, 200)})` : ""));
  let ranked = rankSignals(canonical);
  if (!ranked.length) {
    // ★ engine-log 에도 reject 사유 기록 — 추후 분석 가능
    try {
      await appendLog(userId, `di:real:user:${userId}:engine-log`, {
        time: startedAt,
        mode: shadow ? "shadow" : (forceDryRun ? "dry" : "live"),
        ran: false,
        reason: "no valid canonical signal",
        diag,
        rejectStats: rejectSummary,
        rawSignalsCount: rawSignals.length,
      });
    } catch {}
    return { ok: true, userId, ran: false, reason: "no valid canonical signal", diag, rejectStats: rejectSummary, steps };
  }
  // family 가중치 적용 — shadow ledger 성과 기반 자동 튜닝
  try {
    const kvForWeights = await getKv();
    const weights = await loadFamilyWeightsRobust(kvForWeights, userId);
    if (weights && Object.keys(weights).length > 0) {
      const before = ranked[0]?.symbol;
      ranked = applyWeightsToRanking(ranked, weights);
      const after = ranked[0]?.symbol;
      const wstr = Object.entries(weights).map(([k, v]) => `${k}=${v.toFixed(2)}`).join(",");
      S(`family weights applied: ${wstr}${before !== after ? ` (rerank: ${before}→${after})` : ""}`);
    }
  } catch (e) {
    S(`family weights skipped: ${e?.message}`);
  }

  // ★ 2026-06-14 (대표 승인): 전략 상태(WATCH/DISABLED) 실거래 배선.
  //   auto-promote 가 성과 기반으로 분류한 di:alpha:strategy-status:<family> 를 실거래
  //   선별에 반영 — 그동안 기록만 하고 실거래에서 안 읽어 성과미달 전략이 full 가중치로
  //   진입하던 누락(종합감사 P1-2) 보완.
  //     • DISABLED → 실거래 차단(정의상 shadow 만 운영).
  //     • WATCH    → 절반 가중치(0.5×)로 de-prioritize — 후순위로 밀려 덜 채택됨.
  //   ★ shadow 미적용: 안 좋은 전략도 shadow 에선 계속 돌려 개선·회복을 관찰(대표 라이프
  //     사이클 지시 "개선하거나 정 안되면 폐기"). 회복하면 auto-promote 가 ACTIVE 로 재승급.
  //   ★ fail-safe: getStrategyStatus 는 KV 오류 시 ACTIVE 반환 → 오류로 인한 오차단 없음.
  //   ZEPTA_STATUS_FILTER=0 으로 끔.
  if (!shadow && process.env.ZEPTA_STATUS_FILTER !== "0" && ranked.length > 0) {
    try {
      const famOf = (r) => r.strategyFamily || r.family || "unknown";
      const fams = [...new Set(ranked.map(famOf))];
      const statusByFam = {};
      await Promise.all(fams.map(async (f) => { statusByFam[f] = await getStrategyStatus(f); }));
      const beforeN = ranked.length;
      const kept = ranked.filter((r) => statusByFam[famOf(r)] !== STRATEGY_STATUS.DISABLED);
      const disabledN = beforeN - kept.length;
      // WATCH → 절반 가중치로 재정렬 (applyWeightsToRanking 와 동일 sortKey 공식 · status weight 추가)
      const rescored = kept
        .map((r) => {
          const sw = statusByFam[famOf(r)] === STRATEGY_STATUS.WATCH ? 0.5 : 1;
          const base = (r.confidence || 0) + (r.score || 0) / 100;
          return { sig: { ...r, _statusWeight: sw }, key: base * (r._famWeight ?? 1) * sw };
        })
        .sort((a, b) => b.key - a.key);
      const watchN = rescored.filter((x) => x.sig._statusWeight === 0.5).length;
      ranked = rescored.map((x) => x.sig); // 전 후보 DISABLED 면 [] → 진입 안 함(의도된 차단, 후처리 안전)
      if (disabledN > 0 || watchN > 0) {
        S(`strategy-status (라이브): DISABLED ${disabledN}건 차단, WATCH ${watchN}건 0.5×${ranked.length === 0 ? " — 전 후보 차단, 진입 없음" : ""}`);
      }
    } catch (e) {
      S(`strategy-status skip: ${e?.message}`);
    }
  }

  // ★ 자동 종목 차단 — 2026-05-09 audit M7: live-summary 우선 + shadow 보조.
  //   이전: shadow-summary.bySymbol 만 사용 → shadow 와 live 분포 다르면 misaligned.
  //   현재: live-summary (>=10건) 면 그것만 본다, 부족하면 shadow (>=20건) 보조.
  //   (2026-05-03 진단: SOL 18.5%, XRP 11.5% 같은 명백한 손실 종목을 자동 정리)
  // ★ 2026-06-15 (item2 — 대표 "저승률 코인 배제보다 보수적 접근"): 자동차단을 티어화.
  //   파국(WR<catCut, 기본 25%) = 하드 차단 / 저조(catCut~penUpper, 기본 25~30%) = 사이즈 페널티(×0.5)
  //   그 외 = 정상. ZEPTA_PERFORMANCE_PENALTY_ENABLED=0 이면 레거시(<30% 하드 차단)로 복귀.
  const blockedByPerf = new Set();
  const perfPenalty = new Map(); // sym → sizeMult (저조 종목 보수 사이징)
  const _blockCacheKey = `di:real:user:${userId}:perf-blocklist-cache`; // ★ P2-2 fail-safe 캐시
  try {
    const kvBlock = await getKv();
    const liveSummary = (await kvBlock.get(`di:real:user:${userId}:live-summary`)) || null;
    const shadowSummary = (await kvBlock.get(`di:real:user:${userId}:shadow-summary`)) || null;
    const liveBySym = liveSummary?.bySymbol || {};
    const shadowBySym = shadowSummary?.bySymbol || {};
    const PENALTY_ON = process.env.ZEPTA_PERFORMANCE_PENALTY_ENABLED !== "0";
    const _cc = Number(process.env.ZEPTA_CATASTROPHIC_WR_CUTOFF);
    const catCut = (Number.isFinite(_cc) && _cc > 0 && _cc < 1) ? _cc : 0.25;
    const _pm = Number(process.env.ZEPTA_LOW_WR_SIZE_MULT);
    const penMult = (Number.isFinite(_pm) && _pm > 0 && _pm < 1) ? _pm : 0.5;
    const _pu = Number(process.env.ZEPTA_LOW_WR_PENALTY_UPPER);
    const penUpper = (Number.isFinite(_pu) && _pu > catCut && _pu <= 1) ? _pu : 0.30;
    // 모든 등장 심볼 합집합
    const allSyms = new Set([...Object.keys(liveBySym), ...Object.keys(shadowBySym)]);
    for (const sym of allSyms) {
      const live = liveBySym[sym];
      const shadow = shadowBySym[sym];
      // 유효 WR: live n>=10 우선, 아니면 shadow n>=20 보조. 둘 다 부족하면 판단 보류.
      let wr = null;
      if (live && live.trades >= 10) wr = live.wins / live.trades;
      else if (shadow && shadow.trades >= 20) wr = shadow.wins / shadow.trades;
      if (wr == null) continue;
      if (!PENALTY_ON) {
        if (wr < 0.30) blockedByPerf.add(sym); // 레거시: <30% 하드 차단
        continue;
      }
      if (wr < catCut) blockedByPerf.add(sym);               // 파국 → 차단
      else if (wr < penUpper) perfPenalty.set(sym, penMult); // 저조 → 사이즈 페널티(배제 X)
    }
    if (blockedByPerf.size > 0) S(`auto-blocked (파국 WR<${(catCut*100).toFixed(0)}%, live n>=10|shadow n>=20): ${Array.from(blockedByPerf).join(", ")}`);
    if (perfPenalty.size > 0) S(`사이즈 페널티 (저조 WR ${(catCut*100).toFixed(0)}~${(penUpper*100).toFixed(0)}%, ×${penMult}): ${Array.from(perfPenalty.keys()).join(", ")}`);
    // ★ 적대감사 P2-2: 성공 시 파국 차단목록 캐시 — 다음 사이클 조회 실패 시 fail-safe 복원용.
    try { await kvBlock.set(_blockCacheKey, { syms: Array.from(blockedByPerf), at: Date.now() }); } catch {}
  } catch (e) {
    // ★ 적대감사 P2-2: 실적 데이터 조회 실패 시 빈 Set 으로 게이트 우회(파국 저승률 종목 통과) 금지 —
    //   마지막 캐시(24h 이내) 복원해 보호 유지 + ⚠️ 로깅(무음 우회 방지).
    S(`⚠️ auto-block 데이터 조회 실패 (${e?.message}) — 캐시 복원 시도`);
    try {
      const kvR = await getKv();
      const cached = await kvR.get(_blockCacheKey);
      if (cached?.syms && (Date.now() - (cached.at || 0) < 24 * 3600 * 1000)) {
        cached.syms.forEach((s) => blockedByPerf.add(s));
        S(`auto-block 캐시 복원(${cached.syms.length}종): ${cached.syms.join(", ") || "(빈 목록)"}`);
      }
    } catch {}
  }

  // ★ Regime Filter — Hurst 지수 기반 시장 레짐 가드
  // di:market:regime (market-monitor 가 10분마다 업데이트) 의 avgHurst 활용:
  //   > 0.55 추세장 → 모멘텀 봇 진입 OK
  //   < 0.45 역추세장 → 모멘텀(unknown/trend/breakout) 차단 (가격 평균회귀)
  //   0.45-0.55 혼조 → 약한 추세, 신중하게
  //
  // 모드 (env ZEPTA_REGIME_FILTER_MODE, 기본 "soft"):
  //   "off"    가드 없음 (안전 폴백)
  //   "log"    레짐만 로그 노출, 차단 안 함 (관찰 모드, 데이터 누적용)
  //   "soft"   강한 역추세 (avgHurst < 0.40) 만 모멘텀 차단  ← 기본
  //   "strict" 추세장 (avgHurst > 0.55) 아니면 모멘텀 모두 차단
  //
  //   ★ 2026-05-17 (QUANT-PLAN): 대표 보고 "장 하락할때는 손을 못 쓸정도" 대응.
  //     기본값을 "log" → "soft" 로 변경. 강한 역추세장(Hurst<0.40)만 모멘텀 차단.
  //     env 미설정 시에도 보호 자동 활성 — env 명시로만 비활성 가능.
  const regimeFilterMode = process.env.ZEPTA_REGIME_FILTER_MODE || "soft";
  let regimeBlock = null; // 차단 결정 (null = 통과)
  let regimeSnapshot = null; // entry 에 첨부할 스냅샷 (분석용)
  try {
    const kvR = await getKv();
    const regime = await kvR.get("di:market:regime");
    if (regime && Number.isFinite(regime.avgHurst)) {
      const h = regime.avgHurst;
      // ★ entry 시점 regime 스냅샷 — shadow-ledger / live plan KV 에 첨부.
      //   1주 후 daily-standup 이 "어떤 Hurst 구간에서 들어간 거래가 이겼는지"
      //   bucket 분석 → soft/strict 모드 승급 결정의 직접 근거.
      regimeSnapshot = {
        mode: regimeFilterMode,
        avgHurst: Number(h.toFixed(3)),
        regime: regime.regime || null,         // trending | transitional | mean_reverting
        efficiency: regime.efficiency || null, // directional | mixed | noisy
        avgER: Number.isFinite(regime.avgER) ? Number(regime.avgER.toFixed(3)) : null,
        capturedAt: regime.t || Date.now(),
      };
      const tag = `regime: avgHurst=${h.toFixed(2)} ${regime.regime || ""}`;
      if (regimeFilterMode === "off" || regimeFilterMode === "log") {
        S(`${tag} (mode=${regimeFilterMode}, no block)`);
      } else if (regimeFilterMode === "soft") {
        if (h < 0.40) {
          regimeBlock = `강한 역추세 (Hurst ${h.toFixed(2)} < 0.40) — 모멘텀 봇 진입 차단`;
          S(`${tag} → ${regimeBlock}`);
        } else {
          S(`${tag} (soft mode, no block)`);
        }
      } else if (regimeFilterMode === "strict") {
        if (h <= 0.55) {
          regimeBlock = `추세장 아님 (Hurst ${h.toFixed(2)} ≤ 0.55) — 모멘텀 봇 진입 차단`;
          S(`${tag} → ${regimeBlock}`);
        } else {
          S(`${tag} (strict mode, trend ok)`);
        }
      }
    } else {
      S(`regime: data not available — skip filter`);
    }
  } catch (e) {
    S(`regime filter skipped: ${e?.message}`);
  }
  // 모멘텀 family 차단 시 — 이번 cron 종료
  if (regimeBlock) {
    return {
      ok: true, userId, ran: false,
      reason: `regime filter: ${regimeBlock}`,
      regimeBlocked: true, steps,
    };
  }

  // ★ 2026-05-11 대표 지시: dedup OFF 모드 전면 도입.
  //   ZEPTA_DEDUP_MODE = "off" | "live-only" | "always" (default)
  //     - "off": shadow + live 모두 dedup 안 함. 같은 종목 averaging 허용 + shadow
  //             가 같은 종목으로 시그널 풀 다양화 차단하지 않게.
  //     - "live-only": 옛 동작. shadow 만 dedup, live 는 averaging 허용.
  //     - "always": 둘 다 dedup. 옛옛 동작.
  //
  // ★ 2026-07-08 스윙 전환으로 기본값 off → always 변경 (대표 지시 "스윙에 초점"이
  //   2026-05-11 "다양성 우선 off" 지시를 대체). 진단 실측: off 상태에서 TLM 동일 방향
  //   9포지션 동시 스택(3.25h 내, 간격 중위 17.5분) — 스윙은 심볼당 1포지션이 정합.
  //   averaging 재개는 ZEPTA_DEDUP_MODE=off 로 즉시 원복.
  const dedupMode = (process.env.ZEPTA_DEDUP_MODE || "always").toLowerCase();
  const openSymbols = new Set();
  if (shadow && dedupMode === "always") {
    // shadow always dedup mode
    try {
      const kvDup = await getKv();
      const ledger = (await kvDup.get(`di:real:user:${userId}:shadow-ledger`)) || [];
      for (const e of ledger) {
        if (e?.status !== "CLOSED" && e?.plan?.symbol) openSymbols.add(e.plan.symbol);
      }
      if (openSymbols.size > 0) S(`shadow dedup ON: ${openSymbols.size} symbols open (skip)`);
    } catch {}
  } else if (shadow && dedupMode === "live-only") {
    // 옛 default — shadow always dedup, live not
    try {
      const kvDup = await getKv();
      const ledger = (await kvDup.get(`di:real:user:${userId}:shadow-ledger`)) || [];
      for (const e of ledger) {
        if (e?.status !== "CLOSED" && e?.plan?.symbol) openSymbols.add(e.plan.symbol);
      }
      if (openSymbols.size > 0) S(`shadow dedup (live-only mode): ${openSymbols.size} symbols open (skip)`);
    } catch {}
  } else if (shadow && dedupMode === "off") {
    // ★ 새 default — shadow 도 dedup OFF. 같은 종목 매매 통계 누적 허용.
    S(`shadow mode: dedup OFF (다양성 풀 확보 우선)`);
  } else if (!forceDryRun && (dedupMode === "always" || dedupMode === "live-only")) {
    // 실거래 dedup — always 또는 live-only
    try {
      const positions = await getPositionRisk(creds);
      for (const p of positions || []) {
        const amt = parseFloat(p.positionAmt || 0);
        if (Math.abs(amt) > 0 && p.symbol) openSymbols.add(p.symbol);
      }
      if (openSymbols.size > 0) {
        S(`live dedup: ${openSymbols.size} symbols [${Array.from(openSymbols).join(", ")}] (skip)`);
      }
    } catch (e) {
      S(`live dedup skipped: ${e?.message || String(e)}`);
    }
  } else if (!forceDryRun && dedupMode === "off") {
    // ★ 새 default — live 도 dedup OFF. averaging 허용 (pyramid guard 가 마틴게일 차단)
    S(`live mode: dedup OFF (averaging 허용, pyramid guard 가 마틴게일 차단)`);
  }

  // ★ 2026-05-12 averaging 자유화 가드 임계값 로그.
  //   pyramid guard 임계값 (R) 과 같은 심볼 합산 노시오날 cap 표기.
  {
    const envMinR = Number(process.env.ZEPTA_PYRAMID_MIN_R);
    const minR = Number.isFinite(envMinR)
      ? envMinR
      : (typeof RISK_CONFIG.pyramidMinR === "number" ? RISK_CONFIG.pyramidMinR : 0.0);
    const envPct = Number(process.env.ZEPTA_SAME_SYMBOL_MAX_PCT);
    const capPct = Number.isFinite(envPct)
      ? envPct
      : (typeof RISK_CONFIG.sameSymbolMaxNotionalPct === "number" ? RISK_CONFIG.sameSymbolMaxNotionalPct : 0.30);
    S(`pyramid minR threshold = ${minR.toFixed(2)}R (0.0 = averaging 자유)`);
    S(`same-symbol notional cap = ${(capPct * 100).toFixed(0)}% of equity`);
  }

  // ★ 2026-06-16 (대표 지시): 수동 관리 종목 하드 제외 — 봇이 절대 진입/평단추가 안 함.
  //   대표가 수동으로 잡은 ETH·ZEC 포지션 보호(position-monitor 는 plan 없어 이미 스킵하지만,
  //   engine 은 유니버스+averaging 으로 끼어들 수 있어 후보 단계에서 원천 차단). env 로 조정.
  const _manRaw = (process.env.ZEPTA_MANUAL_SYMBOLS ?? "ETHUSDT,ZECUSDT").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  const manualExcluded = new Set(_manRaw);
  const manualBases = new Set(_manRaw.map((s) => s.replace(/USDT$|USD$|PERP$/, "").replace(/^1000/, "")));
  const isManualSymbol = (sym) => {
    const u = String(sym || "").toUpperCase();
    return manualExcluded.has(u) || manualBases.has(u.replace(/USDT$|USD$|PERP$/, "").replace(/^1000/, ""));
  };
  if (manualExcluded.size) S(`수동 관리 종목 제외(봇 진입 금지): ${[..._manRaw].join(", ")}`);

  // 7-9) ★ ranked 시그널 순회 — 1순위가 affordability/risk reject 되어도
  // 차순위로 fallback. 첫 번째로 plan.ok 가 나오는 시그널을 채택.
  let best = null, price = null, atr = null, filter = null, plan = null;
  const tried = [];
  for (const cand of ranked.slice(0, 6)) {  // 최대 6개 시도
    // 자동 차단 — 성과 부진으로 자동 디머지된 종목
    if (blockedByPerf.has(cand.symbol)) {
      S(`  ↳ ${cand.symbol}: 부진 자동 차단 (파국 저승률, n>=10/20)`);
      tried.push({ symbol: cand.symbol, reason: "auto-blocked by performance" });
      continue;
    }
    // 중복 진입 차단 — dedupMode 가 always/live-only 일 때만 openSymbols 가 채워짐.
    // dedupMode='off' (기본) 이면 이 set 은 비어있어 통과 → averaging 허용.
    if (openSymbols.has(cand.symbol)) {
      S(`  ↳ ${cand.symbol}: dedup mode '${dedupMode}' — 같은 심볼 OPEN 상태로 스킵`);
      tried.push({ symbol: cand.symbol, reason: `dedup '${dedupMode}': already open` });
      continue;
    }
    // ★ 2026-06-14 (대표 지시): 진입 품질 게이트 3종 — 데이터(btc-cron enrich) 없으면
    //   pass-through(안전·하위호환). 전부 env 킬스위치. ticker 조회 전에 둬서 조기 컷.
    // ★ 2026-07-08 스윙 전환: shadow 에도 동일 적용(미러링). 진단 실측 — shadow 만 게이트가
    //   없어 마이크로캡 스팸이 통계를 오염(라이브 규칙과 다른 조건의 성과). shadow 통계가
    //   라이브 규칙의 성과를 말하려면 게이트가 같아야 함. ZEPTA_SHADOW_MIRROR_GATES=0 으로 원복.
    const _mirrorGates = process.env.ZEPTA_SHADOW_MIRROR_GATES !== "0";
    if (!shadow || _mirrorGates) {
      // ① 최소점수 게이트 — 약한 신호 진입 차단 (보수 디폴트 55, breadthCap confirms 0 수준)
      if (process.env.ZEPTA_SCORE_GATE !== "0") {
        const _ms = Number(process.env.ZEPTA_MIN_SCORE);
        const minScore = Number.isFinite(_ms) ? _ms : 55;
        if (Number.isFinite(cand.score) && cand.score < minScore) {
          S(`  ↳ ${cand.symbol} ${cand.side}: 점수 ${cand.score} < ${minScore} (약신호) — 스킵`);
          tried.push({ symbol: cand.symbol, reason: `score gate ${cand.score}<${minScore}` });
          continue;
        }
      }
      // ⑤ 거래량 게이트 — thin 코인 차단 (quoteVolume 없으면 pass-through). ★ != null 심층방어(F1).
      if (process.env.ZEPTA_VOLUME_GATE !== "0" && cand.quoteVolume != null && Number.isFinite(cand.quoteVolume)) {
        const _mv = Number(process.env.ZEPTA_MIN_QUOTE_VOLUME_USD);
        const minVol = Number.isFinite(_mv) ? _mv : 200000;
        if (cand.quoteVolume < minVol) {
          S(`  ↳ ${cand.symbol}: 거래대금 $${Math.round(cand.quoteVolume / 1000)}K < $${Math.round(minVol / 1000)}K (thin) — 스킵`);
          tried.push({ symbol: cand.symbol, reason: `volume gate ${Math.round(cand.quoteVolume)}<${minVol}` });
          continue;
        }
      }
      // ⑦ 1h RSI 극단 + 상위TF 미확인 → 차단(추격 방지). 상위TF(4h/1d)가 같은 방향 확인하면
      //   극단이어도 통과(강한 추세는 태움 — 대표 결정 "추세 미확인 시만 차단").
      if (process.env.ZEPTA_ENTRY_RSI_GATE !== "0" && cand.rsi1h != null && Number.isFinite(cand.rsi1h) && cand.htfConfirm !== true) {
        const _ob = Number(process.env.ZEPTA_ENTRY_RSI_OB); const obT = Number.isFinite(_ob) ? _ob : 80;
        const _os = Number(process.env.ZEPTA_ENTRY_RSI_OS); const osT = Number.isFinite(_os) ? _os : 20;
        if ((cand.side === "LONG" && cand.rsi1h >= obT) || (cand.side === "SHORT" && cand.rsi1h <= osT)) {
          S(`  ↳ ${cand.symbol} ${cand.side}: 1h RSI ${cand.rsi1h} 극단 + 상위TF 미확인 — 스킵(추격 방지)`);
          tried.push({ symbol: cand.symbol, reason: `1h RSI extreme ${cand.rsi1h} htf-unconfirmed` });
          continue;
        }
      }
    }
    // ★ 재진입 쿨다운 체크는 아래 ticker 가격 조회 직후로 이동(2026-06-14) — 품질 게이트가
    //   '더 매력적 가격'을 비교하려면 현재가(pr)가 필요하기 때문.
    S(`try: ${cand.symbol} ${cand.side} conf=${cand.confidence} fam=${cand.strategyFamily}`);
    try {
      const tick = await getTickerPrice({ symbol: cand.symbol });
      const pr = parseFloat(tick.price);

      // ★ 2026-06-12/14 (대표 지시): 재진입 쿨다운 + 품질 게이트. 청산 직후 동일 종목·방향
      //   재진입 차단(churn 방지). 단 "더 매력적 가격(롱=더 싸게/숏=더 비싸게) 또는 더 강한
      //   신호"면 쿨다운 면제 — 트레이더처럼 더 나은 타점엔 들어간다(가격 비교 위해 ticker 후 체크).
      //   ZEPTA_REENTRY_COOLDOWN=0 / _QUALITY_GATE=0 으로 끔.
      // ★ 2026-07-08 스윙 전환: shadow 에도 미러링(shadow-monitor 가 청산 시 쿨다운 기록하는
      //   것과 세트 — 진단 실측 TLM 9스택 방지). ZEPTA_SHADOW_MIRROR_GATES=0 으로 원복.
      if (!shadow || _mirrorGates) {
        try {
          const kvCd = await getKv();
          // ★ 리뷰 E 반영: shadow 쿨다운은 별도 네임스페이스(#shadow) — 같은 KV 키를 쓰면
          //   가상 청산이 실돈 진입을 최대 120분 차단하는 교차 오염 발생. live 는 기존 키 그대로.
          const cdUser = shadow ? `${userId}#shadow` : userId;
          const cd = await checkReentryCooldown(kvCd, cdUser, cand.symbol, cand.side, { price: pr, score: cand.score });
          if (cd.blocked) {
            S(`  ↳ ${cand.symbol} ${cand.side}: 재진입 쿨다운 — ${cd.remainMin}분 남음 (${cd.reason})`);
            tried.push({ symbol: cand.symbol, reason: `reentry cooldown ${cd.remainMin}m: ${cd.reason}` });
            continue;
          }
          if (cd.waived) S(`  ↳ ${cand.symbol} ${cand.side}: 쿨다운 면제 — ${cd.reason}`);
        } catch (e) {
          S(`  ↳ 재진입 쿨다운 체크 skip: ${e?.message || String(e)}`);
        }
      }
      // ★ 2026-05-09 audit N1: family-aware ATR interval.
      //   mean-revert 는 4h 시그널이라도 더 짧은 1h ATR 이 적절 (회귀는 단기 변동성 ↑).
      //   trend/breakout 은 4h 가 적절. timeframe 명시 우선.
      // ★ 2026-07-08 리뷰 D 반영: 스윙 모드는 4h ATR 고정 — S3 그리드 검증(SL 2×ATR·트레일
      //   +1R/2R)이 전부 4h ATR 기준이라, 1d 신호에 1d ATR 을 쓰면 SL 기하·R 단위가 검증
      //   조건과 달라짐(1d ATR 2×는 7.5% 캡에 잘려 'SL 설계 불가' 상태 재발). btc-cron 의
      //   ATR 적합성 가드(4h 기준)와도 이걸로 정합. ZEPTA_SWING_EXITS=0 이면 기존 분기.
      const klInterval = SWING_EXITS ? "4h"
                       : cand.timeframe === "1h" ? "1h"
                       : cand.timeframe === "1d" ? "1d"
                       : cand.strategyFamily === "mean-revert" ? "1h"
                       : "4h";
      let a = await computeAtr(cand.symbol, klInterval, 14);
      if (!a || a <= 0) a = defaultAtrApprox(pr);

      // ★ 변동성 임계값 — 박스권 종목 차단
      // 백테스트 분석에서 모든 거래가 24h 안에 SL/TP 안 닿고 TIME 청산됨 (가격 박스권).
      // ATR / price < 1.5% 면 24h 동안 의미 있는 가격 변동 발생할 가능성 낮음 → skip.
      // 환경변수 ZEPTA_MIN_ATR_PCT 로 조정 (기본 1.5%).
      const minAtrPct = Number(process.env.ZEPTA_MIN_ATR_PCT) || 1.5;
      const atrPct = (a / pr) * 100;
      if (atrPct < minAtrPct) {
        S(`  ↳ low volatility (ATR ${atrPct.toFixed(2)}% < ${minAtrPct}%) — 박스권 차단`);
        tried.push({ symbol: cand.symbol, reason: `low ATR ${atrPct.toFixed(2)}%` });
        continue;
      }

      const f = await getSymbolFilter(cand.symbol);
      if (!isSymbolAffordable({ equity: effectiveEquity, filter: f, cfg: RISK_CONFIG })) {
        S(`  ↳ unaffordable (minNotional=${f.minNotional}, equity=${effectiveEquity})`);
        tried.push({ symbol: cand.symbol, reason: "unaffordable" });
        continue;
      }
      // ★ 2026-05-17 (QUANT-RES): regime 을 planTrade 로 전달 — 동적 SL/TP 보정.
      //   trending 시 TP +30%, mean_reverting 시 양쪽 -20% 자동 적용.
      // ★ item2 성과 페널티는 live-only (shadow 는 full-size 유지 → 깨끗한 통계·Live↔Shadow 비교).
      const p = planTrade({ signal: cand, equity: effectiveEquity, price: pr, atr: a, filter: f, regime: regimeSnapshot, availableMargin: availMargin, cfg: RISK_CONFIG, sizeMult: shadow ? 1 : (perfPenalty.get(cand.symbol) ?? 1) });
      if (!p.ok) {
        S(`  ↳ risk reject: ${p.reason}`);
        tried.push({ symbol: cand.symbol, reason: p.reason });
        continue;
      }

      // ★ 2026-05-09 audit C1: 합산 노셔널/마진 가드.
      //   단일 plan 은 통과해도 기존 오픈 포지션과 합쳐 자본 한도 초과면 reject.
      //   shadow/dryRun 모드는 오픈 포지션 조회 안 됨 → 스킵.
      if (!forceDryRun && !shadow) {
        let liveOpenPositions = [];
        try {
          liveOpenPositions = await getPositionRisk(creds);
        } catch (e) {
          S(`  ↳ aggregate check skipped (positionRisk fetch failed): ${e?.message}`);
        }
        // ★ 2026-05-30 (QUANT-PLAN) — 롱/숏 한 방향 과밀 차단.
        //   대표 관찰: "계속 숏만 잡는다". 약세 알트 + 혼조 레짐이면 전 종목이 한 방향으로
        //   쏠려 진입 → 시장 반전 시 동반 손실. env ZEPTA_MAX_PER_SIDE (기본 0=비활성).
        //   예: 4 로 두면 같은 방향 4개까지만, 5번째부터 차단 → 자연스레 방향 분산 유도.
        // ★ 2026-06-02 (대표 지시 "부족한 부분 다 보완") — 기본 활성화(0→5).
        //   안전 ceiling: 같은 방향 5개까지 허용(추세 추종 충분), 6번째부터 차단 → 극단
        //   한 방향 쏠림(−47% 의 한 축) 방지. 현 자본/5x 에선 거의 안 걸리고 자본 커질 때 보호.
        //   더 강하게 분산하려면 env ZEPTA_MAX_PER_SIDE=3~4 로 조이면 됨.
        const _mps = Number(process.env.ZEPTA_MAX_PER_SIDE);
        const maxPerSide = Number.isFinite(_mps) ? _mps : 5; // =0 이면 비활성(|| 안티패턴 수정)
        if (maxPerSide > 0 && Array.isArray(liveOpenPositions) && liveOpenPositions.length) {
          const sameSideCount = liveOpenPositions.filter((pos) => {
            const amt = parseFloat(pos.positionAmt || 0);
            if (!amt) return false;
            return (amt > 0 ? "LONG" : "SHORT") === cand.side;
          }).length;
          if (sameSideCount >= maxPerSide) {
            S(`  ↳ 방향 과밀 차단: ${cand.side} 이미 ${sameSideCount}개 (한도 ${maxPerSide})`);
            tried.push({ symbol: cand.symbol, reason: `side concentration: ${sameSideCount} ${cand.side} ≥ ${maxPerSide}` });
            continue;
          }
        }
        // ★ 2026-08-18 (대표 지시 "전략 개선 반영"): 상관군 가드 배선.
        //   UI 가 "상관군 제한" 을 안전장치로 표기해 왔으나 실제 호출부가 0건이던 것을
        //   오늘 배선. 같은 상관 그룹(메가캡/L1/밈·페이먼트/DeFi 인프라)에서 이미 포지션이
        //   열려 있으면 신규 진입 차단 — 사실상 같은 방향 베팅의 중복 노출 방지.
        //   env ZEPTA_CORRELATION_GUARD=0 으로 즉시 비활성 (risk-manager 내부 킬스위치).
        {
          const openSyms = (liveOpenPositions || [])
            .filter((pos) => parseFloat(pos.positionAmt || 0) !== 0)
            .map((pos) => pos.symbol);
          if (openSyms.length && inSameCorrelationGroup(cand.symbol, openSyms, RISK_CONFIG)) {
            S(`  ↳ 상관군 차단: ${cand.symbol} 이 오픈 포지션과 같은 상관 그룹`);
            tried.push({ symbol: cand.symbol, reason: `correlation group: 같은 상관군 포지션 보유 중` });
            continue;
          }
        }
        const aggCheck = checkAggregateExposure({
          plan: p.plan, openPositions: liveOpenPositions, equity: effectiveEquity, availableMargin: availMargin, cfg: RISK_CONFIG,
        });
        if (!aggCheck.ok) {
          S(`  ↳ 합산 노출 reject: ${aggCheck.reason}`);
          tried.push({ symbol: cand.symbol, reason: aggCheck.reason });
          continue;
        }
        // ★ audit M1: 같은 심볼 averaging 가드 (cfg.pyramidMinR / env ZEPTA_PYRAMID_MIN_R).
        //   2026-05-12 기본 0.0R → averaging 자유. 1.0 으로 옛 보수 모드 복원.
        const samePos = (liveOpenPositions || []).find((pos) => pos.symbol === p.plan.symbol);
        if (samePos) {
          const pyrCheck = checkPyramidGuard({ plan: p.plan, existingPos: samePos, cfg: RISK_CONFIG });
          if (!pyrCheck.ok) {
            S(`  ↳ pyramid guard reject: ${pyrCheck.reason}`);
            tried.push({ symbol: cand.symbol, reason: pyrCheck.reason });
            continue;
          }
          if (pyrCheck.currentR != null) {
            S(`  ↳ averaging 허용: 기존 ${p.plan.side} R=${pyrCheck.currentR.toFixed(2)}`);
          }
          // ★ 2026-05-12 신규: 같은 심볼 합산 노시오날 cap (마틴게일 폭주 방지).
          //   pyramid guard 가 0.0R 로 풀린 만큼 별도 안전망 필수.
          const symNotCheck = checkSameSymbolNotional({
            plan: p.plan, existingPos: samePos, equity: effectiveEquity, cfg: RISK_CONFIG,
          });
          if (!symNotCheck.ok) {
            S(`  ↳ same-symbol notional reject: ${symNotCheck.reason}`);
            tried.push({ symbol: cand.symbol, reason: symNotCheck.reason });
            continue;
          }
        }
      }

      // 채택!
      best = cand; price = pr; atr = a; filter = f; plan = p;
      S(`✓ picked: ${cand.symbol} ${cand.side} (after ${tried.length} reject${tried.length === 1 ? "" : "s"})`);
      break;
    } catch (e) {
      S(`  ↳ error: ${e.message}`);
      tried.push({ symbol: cand.symbol, reason: e.message });
      continue;
    }
  }
  if (!best || !plan) {
    // ★ engine-log 에 reject 사유 기록 — 어떤 시그널이 왜 떨어졌는지 추후 분석 가능
    try {
      await appendLog(userId, `di:real:user:${userId}:engine-log`, {
        time: startedAt,
        mode: shadow ? "shadow" : (forceDryRun ? "dry" : "live"),
        ran: false,
        reason: `all ${tried.length} signals rejected`,
        tried,
        equity: effectiveEquity,
        candidatesScanned: ranked.length,
      });
    } catch {}
    return {
      ok: true, userId, ran: false,
      reason: `all ${tried.length} signals rejected`,
      rejected: true, tried, steps,
    };
  }
  S(`plan: qty=${plan.plan.qty} notional=$${plan.plan.notional.toFixed(2)} lev=${plan.plan.leverage}x margin=$${plan.plan.marginRequired.toFixed(2)}`);
  S(`SL=${plan.plan.slPrice} TP=${plan.plan.tpPrice} effRR=${plan.plan.effectiveRR?.toFixed(2) || "?"}`);

  // 10) 집행 or shadow 기록
  const dryRun = !!forceDryRun;
  let result;
  if (shadow) {
    // shadow: 주문 안 보내고 ledger 에 기록
    const entry = {
      // ★ 2026-05-09 audit (bonus): 같은 ts 에 같은 시그널 두 번 진입 시 id 충돌 방지 — random 8자 추가
      id: `sh-${Date.now()}-${best.id}-${Math.random().toString(36).slice(2, 10)}`,
      openedAt: startedAt,
      status: "OPEN",
      signal: best,
      plan: { ...plan.plan, log: undefined },
      entryPrice: price,
      feeBps: 8, // 왕복 taker 0.08%
      slippageBps: 5, // 왕복 예상 슬리피지 0.05%
      regime: regimeSnapshot, // ★ 진입 시점 시장 레짐 스냅샷 (Hurst bucket 분석용)
    };
    await appendLog(userId, `di:real:user:${userId}:shadow-ledger`, entry, 500);
    S(`shadow: ledger entry ${entry.id}`);
    result = { ok: true, shadow: true, id: entry.id };
  } else {
    try {
      result = await executeOrderPlan({
        userId,
        symbol: plan.plan.symbol,
        side: plan.plan.side,
        usdt: plan.plan.marginRequired,
        leverage: plan.plan.leverage,
        marginType: "ISOLATED",
        stopLossPrice: plan.plan.slPrice,
        takeProfitPrice: plan.plan.tpPrice,
        dryRun,
        // ★ 적대감사 P1-8: 안정 멱등 id 백스톱(옵션). 기본은 기존 best.id(런마다 변동) — 켜면 same
        //   asset+side+score+10분버킷으로 안정화해 재처리(cursor 실패)/churn 을 Binance 가 reject.
        //   ※ 같은 버킷 내 *의도된 averaging* 도 차단될 수 있어 기본 OFF(과다진입 가드는 notional cap 담당).
        clientOrderId: process.env.ZEPTA_STABLE_CLIENT_ORDER_ID === "1"
          ? `p1-${best.symbol}-${best.side}-${Math.round(Number(best.score) || 0)}-${Math.floor(Date.now() / 600000)}`
          : `p1-${best.id}`,
      });
    } catch (e) {
      S(`execute failed: ${e.message}`);
      result = { ok: false, error: e.message };
    }
  }

  // 11a) live 진입 성공이면 plan 을 KV 에 저장 — position-monitor 가
  // trailing stop / time stop 평가에 사용. dry/shadow 는 저장 안 함.
  if (!dryRun && !shadow && result?.ok && !result?.error) {
    const planKey = `di:real:user:${userId}:plan:${plan.plan.symbol}`;
    // ★ 적대감사 P1-1: plan 영속화 실패 = 무방비(naked) 포지션 — bracket 비활성 계정에서 SL/TP/
    //   시간손절이 전적으로 plan 에 의존하는데, kv.set throw(KV 일시장애) 시 catch 가 로깅만 하고
    //   삼켜 SL 없는 5x 포지션이 남았음. → 재시도(backoff) 후 최종 실패 + Binance SL 미부착이면
    //   reduceOnly 강제청산으로 노출 차단. (Binance SL 부착 시엔 무방비 아님 — 경보만, 오청산 방지.)
    const planObj = {
      symbol: plan.plan.symbol,
      side: plan.plan.side,
      entryPrice: plan.plan.entryPrice,
      slPrice: plan.plan.slPrice,
      tpPrice: plan.plan.tpPrice,
      slPct: plan.plan.slPct,
      tpPct: plan.plan.tpPct,
      leverage: plan.plan.leverage,
      qty: plan.plan.qty,
      openedAt: Date.now(),
      currentSlPrice: plan.plan.slPrice,
      highWater: plan.plan.entryPrice,
      strategyFamily: plan.plan.strategyFamily,
      // confidence/timeframe/score/regime — position-monitor·live-summary·쿨다운·레짐분석 input
      confidence: plan.plan.confidence,
      timeframe: best.timeframe || undefined, // ★ best(=채택 cand). 루프 밖이라 cand 직접참조 금지(#155 교훈)
      score: Number.isFinite(Number(best.score)) ? Number(best.score) : null,
      regime: regimeSnapshot,
    };
    let kv2 = null, skipOverwrite = false, persisted = false;
    try {
      kv2 = await getKv();
      const existingPlan = await kv2.get(planKey); // 기존 plan 있으면 덮어쓰지 않음(포지션 추적 보호)
      if (existingPlan && existingPlan.openedAt) {
        skipOverwrite = true;
        S(`plan already exists for ${plan.plan.symbol} (opened ${new Date(existingPlan.openedAt).toISOString()}) — skip overwrite`);
      }
    } catch (e) {
      S(`plan existing-check 실패(set 은 시도): ${e.message}`);
      if (!kv2) { try { kv2 = await getKv(); } catch {} }
    }
    if (!skipOverwrite) {
      for (let attempt = 0; attempt < 3 && !persisted && kv2; attempt++) {
        try {
          if (attempt) await new Promise((r) => setTimeout(r, 250 * attempt)); // backoff
          await kv2.set(planKey, planObj);
          persisted = true;
          S(`plan persisted to ${planKey}${attempt ? ` (재시도 ${attempt})` : ""}`);
        } catch (e) {
          S(`⚠️ plan 영속화 실패(시도 ${attempt + 1}/3): ${e.message}`);
        }
      }
      if (!persisted) {
        result.planPersistFailed = true;
        // ★ 재검증 P3: stop_limit 폴백 SL 은 갭장 미체결 가능 → '보장 청산' 아님. STOP_MARKET 만 보호 인정.
        const slAttached = result.bracket?.sl?.ok === true && result.bracket?.slMode !== "stop_limit_fallback";
        if (slAttached) {
          S(`🚨 plan 영속화 실패 — ${plan.plan.symbol}: Binance SL 부착됨(무방비 아님). 트레일링/시간손절 유실 — 수동 점검.`);
        } else if (creds?.apiKey && process.env.ZEPTA_NAKED_FORCE_CLOSE === "0") {
          // 강제청산 비활성(env) — 무방비 인지하되 자동청산 안 함. 수동 개입 경보만.
          S(`🚨 CRITICAL: plan 영속화 실패 + 무방비, 강제청산 비활성(ZEPTA_NAKED_FORCE_CLOSE=0) → ${plan.plan.symbol} 즉시 수동청산 필요!`);
        } else if (creds?.apiKey) {
          S(`🚨 CRITICAL: plan 영속화 3회 실패 + Binance SL 미부착 → ${plan.plan.symbol} 무방비. reduceOnly 강제청산 시도.`);
          try {
            // ★ 재검증 P1: plan.plan.qty 가 아니라 *실제 체결량*(result.executedQty)으로 청산 —
            //   집행시점 재산출/라운딩 차이로 plan.qty < 실제량이면 부분청산 잔여 무방비가 됨.
            const _closeQty = Number(result.executedQty) > 0 ? Number(result.executedQty) : plan.plan.qty;
            await placeOrder({
              apiKey: creds.apiKey, apiSecret: creds.apiSecret, testnet: creds.testnet,
              params: { symbol: plan.plan.symbol, side: plan.plan.side === "LONG" ? "SELL" : "BUY", type: "MARKET", quantity: _closeQty, reduceOnly: true },
            });
            result.nakedClosed = true;
            S(`🚨 무방비 포지션 강제청산 완료: ${plan.plan.symbol} (SL 없이 노출 방지)`);
          } catch (e2) {
            result.nakedCloseFailed = true;
            S(`🚨🚨 강제청산도 실패: ${e2.message} — ${plan.plan.symbol} 즉시 수동청산 필요!`);
          }
        } else {
          S(`🚨 plan 영속화 실패 + creds 없음 — ${plan.plan.symbol} 강제청산 불가, 수동 점검 요망.`);
        }
      }
    }
  }

  // 11) engine-log — ★ result.error 도 기록 (실패 사유 추적)
  await appendLog(userId, `di:real:user:${userId}:engine-log`, {
    time: startedAt,
    mode: shadow ? "shadow" : (dryRun ? "dry" : "live"),
    signal: best,
    plan: { ...plan.plan, log: undefined },
    result: result ? {
      ok: result.ok,
      orderId: result.orderId,
      dryRun: !!result.dryRun,
      bracket: result.bracket,
      bracketRescue: result.bracketRescue,
      shadow: !!result.shadow,
      // ★ 진입 실패 시 binance 에러 메시지 보존 — 추후 디버깅 핵심
      error: result.error || null,
      errorCode: result.errorCode || null,
      // executeOrderPlan 에서 단계별 로그를 result.steps 로 반환할 경우
      steps: Array.isArray(result.steps) ? result.steps.slice(0, 10) : undefined,
    } : null,
    dryRun,
    shadow,
  });

  // 11c) ★ 봇 진입 실패 시 텔레그램 알림 (왜 실패했는지 즉시 인지)
  if (!dryRun && !shadow && (!result?.ok || result?.error)) {
    try {
      const { sendCards, buildCard } = await import("../_shared/telegram.js");
      const sideKr = plan.plan.side === "LONG" ? "롱" : "숏";
      await sendCards([
        buildCard({
          tag: "⚠️",
          title: `봇 진입 실패 — ${plan.plan.symbol} ${sideKr}`,
          lines: [
            `사유: ${result?.error || "알 수 없음 (orderId 없음)"}`,
            `시도한 plan: qty ${plan.plan.qty} · 투입 $${plan.plan.marginRequired.toFixed(2)} · ${plan.plan.leverage}x`,
            `시그널: ${best.source || "봇"} (conf ${best.confidence})`,
          ],
          hint: "다음 cycle에서 재시도. 자본·minNotional·시장 상태 확인 권장.",
        }),
      ]);
    } catch (e) {
      console.warn("[engine] telegram fail alert error:", e?.message);
    }
  }

  // 11b) ★ 실거래 진입 성공 시 텔레그램 알림 (모바일에서 즉시 인지)
  // ★ 재검증 P2: plan 영속화 실패(무방비/강제청산)는 모바일 CRITICAL 알림 필수 (S 로그는 모바일 미도달).
  if (!dryRun && !shadow && result?.planPersistFailed) {
    try {
      const { sendCards, buildCard } = await import("../_shared/telegram.js");
      const _sym = plan.plan.symbol;
      const _msg = result.nakedCloseFailed ? `🚨 강제청산 실패 — ${_sym} 즉시 수동청산 필요!`
                 : result.nakedClosed ? `무방비 감지 → reduceOnly 강제청산 완료 (${_sym})`
                 : `Binance SL 은 있으나 plan 저장 실패 (${_sym}) — 트레일링/시간손절 추적 점검`;
      await sendCards([buildCard({ tag: "🚨", title: "실거래 CRITICAL — plan 영속화 실패", lines: [_msg, `${_sym} · ${plan.plan.side} · 진입 후 plan KV write 3회 실패`] })]);
    } catch (e) { console.warn("[engine] naked-alert telegram error:", e?.message); }
  }

  // dry/shadow 는 알림 안 보냄 (스팸 방지). live 만 발송.
  if (!dryRun && !shadow && result?.ok && !result?.error && !result?.planPersistFailed) { // ★ 재검증 P2: 강제청산/무방비 건은 '성공' 카드 미발송
    try {
      const { sendCards, buildCard } = await import("../_shared/telegram.js");
      const sideKr = plan.plan.side === "LONG" ? "롱(상승)" : "숏(하락)";
      const slPct = (plan.plan.slPct * 100).toFixed(2);
      // ★ 스윙 전환: TP 미설치(null) 지원 — 트레일 청산 안내로 대체
      const _hasTp = plan.plan.tpPct != null && plan.plan.tpPrice != null;
      const tpPct = _hasTp ? (plan.plan.tpPct * 100).toFixed(2) : null;
      // ★ bracket SL/TP 상태 점검 — rescue 발동 또는 SL attach 실패 시 경고
      const bracketInfo = result.bracket || {};
      const bracketRescue = result.bracketRescue;
      const slAttached = bracketInfo.sl?.ok;
      const tpAttached = bracketInfo.tp?.ok;
      const slMode = bracketInfo.slMode; // "quantity_fallback" 등

      // ROI% (마진 대비 손익률, Binance UI 기준) 계산
      const slRoiPct = (plan.plan.slPct * plan.plan.leverage * 100).toFixed(0);
      const tpRoiPct = _hasTp ? (plan.plan.tpPct * plan.plan.leverage * 100).toFixed(0) : null;
      const lines = [
        `진입가 $${plan.plan.entryPrice} · 수량 ${plan.plan.qty}`,
        `노출 $${plan.plan.notional?.toFixed(2)} · 마진 $${plan.plan.marginRequired.toFixed(2)} (레버리지 ${plan.plan.leverage}x)`,
        `손절라인 $${plan.plan.slPrice} (가격 -${slPct}% / ROI -${slRoiPct}%)`,
        _hasTp
          ? `익절라인 $${plan.plan.tpPrice} (가격 +${tpPct}% / ROI +${tpRoiPct}%)`
          : `익절: 고정 TP 없음 — +1R 후 트레일링(최고점 추적)으로 청산 (스윙 모드)`,
        `${_hasTp ? `손익비 ${plan.plan.effectiveRR?.toFixed(2) || "?"}배` : "손익비 트레일 기반(상방 무제한)"} · 감내 손실 $${plan.plan.riskAmount?.toFixed(2) || "?"}`,
        `시그널: ${best.source || "봇"} (conf ${best.confidence})`,
      ];
      // SL/TP attach 상태 명시
      if (slAttached && tpAttached) {
        lines.push(`✅ Binance 손절·익절 자동 주문 등록됨${slMode ? ` (${slMode})` : ""}`);
      } else if (slAttached && !tpAttached) {
        lines.push(`⚠️ 손절은 binance 등록 / 익절은 봇 모니터링 (3분 주기)`);
      } else if (!slAttached) {
        // ★ Binance bracket endpoint 가 reject (Algo Order API 요구) 한 케이스.
        //   대신 봇이 position-monitor 에서 mark price 와 plan.slPrice/tpPrice
        //   직접 비교 → 도달 시 시장가 청산. binance bracket 의존성 0.
        lines.push(`🛡️ 손절·익절 모두 봇이 직접 모니터링 (3분 주기 mark price 체크)`);
        if (bracketRescue?.slError) {
          lines.push(`ℹ️ Binance API: "${bracketRescue.slError.slice(0, 80)}"`);
        }
      }

      await sendCards([
        buildCard({
          tag: "🤖",
          title: `봇 진입 — ${plan.plan.symbol} ${sideKr}`,
          lines,
          hint: slAttached
            ? "포지션은 손절라인·익절라인까지 자동 추적됩니다. 필요시 안전잠금으로 즉시 차단 가능."
            : "Binance bracket 미지원 계정 — 봇이 3분마다 mark price 체크해 손절·익절 발동. 안전잠금으로 즉시 차단도 가능.",
        }),
      ]);
    } catch (e) {
      console.warn("[engine] telegram entry alert failed:", e?.message);
    }
  }

  return { ok: true, userId, ran: true, dryRun, shadow, signal: best, plan: plan.plan, result, diag, steps };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  try {
    // POST: 수동 호출 — dry run / shadow / probe 지원
    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
      const { userId, dryRun = true, shadow = false, probe = false, lookbackMs } = body;
      if (!userId) return res.status(400).json({ error: "userId required" });
      const out = await runOnce({
        userId,
        forceDryRun: !!dryRun || !!shadow, // shadow 는 항상 dry
        shadow: !!shadow,
        probe: !!probe,
        lookbackMs,
      });
      return res.status(200).json(out);
    }

    // GET: cron — phase1 유저는 live, shadow-only 유저는 shadow 모드로 순회
    // + GLOBAL_PROBE_USER 는 KV 등록 없이도 항상 shadow 로 강제 실행
    //   (대표님이 dry-run 버튼을 매일 누르지 않아도 shadow-ledger 가 자동 누적됨)
    const kv = await getKv();
    const phase1Users = (await kv.get("di:real:phase1-users")) || [];
    const shadowUsers = (await kv.get("di:real:shadow-users")) || [];
    const results = [];
    for (const uid of phase1Users.slice(0, 10)) {
      try {
        results.push(await runOnce({ userId: uid, forceDryRun: false }));
      } catch (e) {
        results.push({ userId: uid, ok: false, error: e?.message });
      }
    }
    // 글로벌 probe — 등록 안 된 상태에서도 항상 1회 자동 dry-run+shadow
    try {
      results.push(await runOnce({
        userId: GLOBAL_PROBE_USER,
        forceDryRun: true,
        shadow: true,
        probe: true,
      }));
    } catch (e) {
      results.push({ userId: GLOBAL_PROBE_USER, ok: false, error: e?.message });
    }
    for (const uid of shadowUsers.slice(0, 20)) {
      if (phase1Users.includes(uid)) continue;
      if (uid === GLOBAL_PROBE_USER) continue;
      try {
        results.push(await runOnce({ userId: uid, forceDryRun: true, shadow: true }));
      } catch (e) {
        results.push({ userId: uid, ok: false, error: e?.message });
      }
    }
    // probe 유저를 shadow-users 에 멱등 등록 → shadow-monitor 도 자동 순회
    try {
      const cur = (await kv.get("di:real:shadow-users")) || [];
      if (!cur.includes(GLOBAL_PROBE_USER)) {
        await kv.set("di:real:shadow-users", [GLOBAL_PROBE_USER, ...cur]);
      }
    } catch {}
    return res.status(200).json({ ok: true, count: results.length, results });
  } catch (err) {
    return respondError(res, err);
  }
}
