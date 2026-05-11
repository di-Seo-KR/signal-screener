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
import { planTrade, RISK_CONFIG, checkAggregateExposure, checkPyramidGuard } from "../_shared/risk-manager.js";
import { preTradeCheck } from "../_shared/circuit-breaker.js";
import { getSymbolFilter, isSymbolAffordable } from "../_shared/exchange-info.js";
import { getTickerPrice, getAccountInfo, getKlines, getPositionRisk } from "../_shared/binance-client.js";
import { executeOrderPlan } from "../binance/order.js";

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
  const activeBots = (await kv.get("di:active-bots")) || [];
  const cryptoBots = activeBots.filter((b) =>
    /^(btc-alpha|highcap-momentum|defi-infra|meme-trend|l2-emerging|crypto-diversity|crypto-swing)/
      .test(b.id || b.botId || "")
  );
  const lastSeenKey = `di:real:user:${userId}:last-signal-ts`;
  const lastSeen = advanceCursor ? ((await kv.get(lastSeenKey)) || 0) : 0;
  const now = Date.now();
  const minTs = advanceCursor ? lastSeen : (now - lookbackMs);

  // ★ 2026-05-09 audit M2: BUY 만 수집하던 게 SHORT 시그널 영구 누락 원인.
  //   가상매매 봇이 SELL 시그널을 만들어도 실전 엔진이 절대 못 봄 → 약세장 알파 0.
  //   현재: BUY/SELL 둘 다 수집. signal-extractor 가 LONG/SHORT 매핑 처리.
  const diag = { activeBots: activeBots.length, cryptoBots: cryptoBots.length, tradesScanned: 0, buyFound: 0, sellFound: 0, inWindow: 0, perBotDedup: 0 };
  const candidates = [];
  for (const b of cryptoBots) {
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
      seenAssetsThisBot.add(t.asset);
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
    try { await kv.set(lastSeenKey, now); } catch {}
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
    return Number.isFinite(v) ? v : 0;
  } catch (e) {
    console.warn("[engine] equity fetch failed:", e?.message);
    return 0;
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

async function appendLog(userId, key, entry, cap = 200) {
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
  if (creds) {
    equity = await getEquityUsdt(creds);
    S(`equity=$${equity.toFixed(2)}`);
  } else {
    S(`dry-run: skipping equity fetch (no creds)`);
  }
  // Phase 1 최저 원금 = $200 (BTCUSDT minNotional $100 거래 가능 + 안전 마진)
  if (equity < 200 && !forceDryRun) {
    S(`equity < $200 — skip (Phase 1 minimum)`);
    return { ok: true, userId, ran: false, reason: "insufficient equity (min $200)", equity, steps };
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
  const rejectStats = {};
  const canonical = rawSignals
    .map((r) => extractSignal(r, { strict: !forceDryRun, rejectStats }))
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

  // ★ 자동 종목 차단 — 2026-05-09 audit M7: live-summary 우선 + shadow 보조.
  //   이전: shadow-summary.bySymbol 만 사용 → shadow 와 live 분포 다르면 misaligned.
  //   현재: live-summary (>=10건) 면 그것만 본다, 부족하면 shadow (>=20건) 보조.
  //   (2026-05-03 진단: SOL 18.5%, XRP 11.5% 같은 명백한 손실 종목을 자동 정리)
  const blockedByPerf = new Set();
  try {
    const kvBlock = await getKv();
    const liveSummary = (await kvBlock.get(`di:real:user:${userId}:live-summary`)) || null;
    const shadowSummary = (await kvBlock.get(`di:real:user:${userId}:shadow-summary`)) || null;
    const liveBySym = liveSummary?.bySymbol || {};
    const shadowBySym = shadowSummary?.bySymbol || {};
    // 모든 등장 심볼 합집합
    const allSyms = new Set([...Object.keys(liveBySym), ...Object.keys(shadowBySym)]);
    for (const sym of allSyms) {
      const live = liveBySym[sym];
      const shadow = shadowBySym[sym];
      // 우선순위 1: live n>=10
      if (live && live.trades >= 10) {
        const wr = live.wins / live.trades;
        if (wr < 0.30) {
          blockedByPerf.add(sym);
          continue;
        }
      } else if (shadow && shadow.trades >= 20) {
        // 우선순위 2: shadow n>=20 (live 부족 시)
        const wr = shadow.wins / shadow.trades;
        if (wr < 0.30) blockedByPerf.add(sym);
      }
    }
    if (blockedByPerf.size > 0) S(`auto-blocked symbols (live n>=10 또는 shadow n>=20, winRate<30%): ${Array.from(blockedByPerf).join(", ")}`);
  } catch (e) {
    S(`auto-block skipped: ${e?.message}`);
  }

  // ★ Regime Filter — Hurst 지수 기반 시장 레짐 가드
  // di:market:regime (market-monitor 가 10분마다 업데이트) 의 avgHurst 활용:
  //   > 0.55 추세장 → 모멘텀 봇 진입 OK
  //   < 0.45 역추세장 → 모멘텀(unknown/trend/breakout) 차단 (가격 평균회귀)
  //   0.45-0.55 혼조 → 약한 추세, 신중하게
  //
  // 모드 (env ZEPTA_REGIME_FILTER_MODE, 기본 "log"):
  //   "off"    가드 없음 (안전 폴백)
  //   "log"    레짐만 로그 노출, 차단 안 함 (관찰 모드, 데이터 누적용)
  //   "soft"   강한 역추세 (avgHurst < 0.40) 만 모멘텀 차단
  //   "strict" 추세장 (avgHurst > 0.55) 아니면 모멘텀 모두 차단
  const regimeFilterMode = process.env.ZEPTA_REGIME_FILTER_MODE || "log";
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
  //   ZEPTA_DEDUP_MODE = "off" (default) | "live-only" | "always"
  //     - "off": shadow + live 모두 dedup 안 함. 같은 종목 averaging 허용 + shadow
  //             가 같은 종목으로 시그널 풀 다양화 차단하지 않게.
  //     - "live-only": 옛 동작. shadow 만 dedup, live 는 averaging 허용.
  //     - "always": 둘 다 dedup. 옛옛 동작.
  //
  //   shadow 통계 왜곡 우려가 있지만 시그널 다양성 부족 (같은 6개 종목 만 반복)
  //   이 더 큰 문제라 대표 지시로 OFF 기본.
  const dedupMode = (process.env.ZEPTA_DEDUP_MODE || "off").toLowerCase();
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

  // 7-9) ★ ranked 시그널 순회 — 1순위가 affordability/risk reject 되어도
  // 차순위로 fallback. 첫 번째로 plan.ok 가 나오는 시그널을 채택.
  let best = null, price = null, atr = null, filter = null, plan = null;
  const tried = [];
  for (const cand of ranked.slice(0, 6)) {  // 최대 6개 시도
    // 자동 차단 — 성과 부진으로 자동 디머지된 종목
    if (blockedByPerf.has(cand.symbol)) {
      S(`  ↳ ${cand.symbol}: 부진 자동 차단 (winRate<30% AND n>=20)`);
      tried.push({ symbol: cand.symbol, reason: "auto-blocked by performance" });
      continue;
    }
    // 중복 진입 차단 — 이미 같은 심볼에 OPEN 포지션 있으면 skip
    if (openSymbols.has(cand.symbol)) {
      S(`  ↳ ${cand.symbol}: 이미 OPEN 포지션 존재 — 중복 진입 차단`);
      tried.push({ symbol: cand.symbol, reason: "already open" });
      continue;
    }
    S(`try: ${cand.symbol} ${cand.side} conf=${cand.confidence} fam=${cand.strategyFamily}`);
    try {
      const tick = await getTickerPrice({ symbol: cand.symbol });
      const pr = parseFloat(tick.price);
      // ★ 2026-05-09 audit N1: family-aware ATR interval.
      //   mean-revert 는 4h 시그널이라도 더 짧은 1h ATR 이 적절 (회귀는 단기 변동성 ↑).
      //   trend/breakout 은 4h 가 적절. timeframe 명시 우선.
      const klInterval = cand.timeframe === "1h" ? "1h"
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
      const p = planTrade({ signal: cand, equity: effectiveEquity, price: pr, atr: a, filter: f, cfg: RISK_CONFIG });
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
        const aggCheck = checkAggregateExposure({
          plan: p.plan, openPositions: liveOpenPositions, equity: effectiveEquity, cfg: RISK_CONFIG,
        });
        if (!aggCheck.ok) {
          S(`  ↳ 합산 노출 reject: ${aggCheck.reason}`);
          tried.push({ symbol: cand.symbol, reason: aggCheck.reason });
          continue;
        }
        // ★ audit M1: 같은 심볼 averaging 가드 (피라미딩만 허용, 물타기 차단)
        const samePos = (liveOpenPositions || []).find((pos) => pos.symbol === p.plan.symbol);
        if (samePos) {
          const pyrCheck = checkPyramidGuard({ plan: p.plan, existingPos: samePos });
          if (!pyrCheck.ok) {
            S(`  ↳ pyramid guard reject: ${pyrCheck.reason}`);
            tried.push({ symbol: cand.symbol, reason: pyrCheck.reason });
            continue;
          }
          if (pyrCheck.currentR != null) {
            S(`  ↳ averaging 허용: 기존 ${p.plan.side} R=${pyrCheck.currentR.toFixed(2)} (피라미딩)`);
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
        clientOrderId: `p1-${best.id}`,
      });
    } catch (e) {
      S(`execute failed: ${e.message}`);
      result = { ok: false, error: e.message };
    }
  }

  // 11a) live 진입 성공이면 plan 을 KV 에 저장 — position-monitor 가
  // trailing stop / time stop 평가에 사용. dry/shadow 는 저장 안 함.
  if (!dryRun && !shadow && result?.ok && !result?.error) {
    try {
      const kv = await getKv();
      const planKey = `di:real:user:${userId}:plan:${plan.plan.symbol}`;
      // ★ 같은 심볼에 기존 plan 이 있으면 덮어쓰지 않음 (포지션 추적 보호)
      const existingPlan = await kv.get(planKey);
      if (existingPlan && existingPlan.openedAt) {
        S(`plan already exists for ${plan.plan.symbol} (opened ${new Date(existingPlan.openedAt).toISOString()}) — skip overwrite`);
      } else {
      // ★ 2026-05-11 대표 지시: slMissingSince 제거.
      //   bracket SL attach 실패해도 position-monitor 가 plan.slPrice/tpPrice 로
      //   mark-price 모니터링하면서 도달 시 시장가 청산하므로 force-close 불필요.
      await kv.set(planKey, {
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
        regime: regimeSnapshot, // ★ 진입 시점 시장 레짐 스냅샷 (Hurst bucket 분석용)
      });
      S(`plan persisted to ${planKey}`);
      } // end else (no existing plan)
    } catch (e) {
      S(`plan persist failed: ${e.message}`);
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
  // dry/shadow 는 알림 안 보냄 (스팸 방지). live 만 발송.
  if (!dryRun && !shadow && result?.ok && !result?.error) {
    try {
      const { sendCards, buildCard } = await import("../_shared/telegram.js");
      const sideKr = plan.plan.side === "LONG" ? "롱(상승)" : "숏(하락)";
      const slPct = (plan.plan.slPct * 100).toFixed(2);
      const tpPct = (plan.plan.tpPct * 100).toFixed(2);
      // ★ bracket SL/TP 상태 점검 — rescue 발동 또는 SL attach 실패 시 경고
      const bracketInfo = result.bracket || {};
      const bracketRescue = result.bracketRescue;
      const slAttached = bracketInfo.sl?.ok;
      const tpAttached = bracketInfo.tp?.ok;
      const slMode = bracketInfo.slMode; // "quantity_fallback" 등

      // ROI% (마진 대비 손익률, Binance UI 기준) 계산
      const slRoiPct = (plan.plan.slPct * plan.plan.leverage * 100).toFixed(0);
      const tpRoiPct = (plan.plan.tpPct * plan.plan.leverage * 100).toFixed(0);
      const lines = [
        `진입가 $${plan.plan.entryPrice} · 수량 ${plan.plan.qty}`,
        `노출 $${plan.plan.notional?.toFixed(2)} · 마진 $${plan.plan.marginRequired.toFixed(2)} (레버리지 ${plan.plan.leverage}x)`,
        `손절라인 $${plan.plan.slPrice} (가격 -${slPct}% / ROI -${slRoiPct}%)`,
        `익절라인 $${plan.plan.tpPrice} (가격 +${tpPct}% / ROI +${tpRoiPct}%)`,
        `손익비 ${plan.plan.effectiveRR?.toFixed(2) || "?"}배 · 감내 손실 $${plan.plan.riskAmount?.toFixed(2) || "?"}`,
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
