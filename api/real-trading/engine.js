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
import { extractSignal, pickBestSignal, rankSignals } from "../_shared/signal-extractor.js";
import { loadFamilyWeightsRobust, applyWeightsToRanking } from "../_shared/strategy-weights.js";
import { planTrade, RISK_CONFIG } from "../_shared/risk-manager.js";
import { preTradeCheck } from "../_shared/circuit-breaker.js";
import { getSymbolFilter, isSymbolAffordable } from "../_shared/exchange-info.js";
import { getTickerPrice, getAccountInfo, getKlines } from "../_shared/binance-client.js";
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
async function pullRecentSignals({ userId, lookbackMs = 30 * 60 * 1000, advanceCursor = true }) {
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

  const diag = { activeBots: activeBots.length, cryptoBots: cryptoBots.length, tradesScanned: 0, buyFound: 0, inWindow: 0, perBotDedup: 0 };
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
      if (!t || !t.time || t.type !== "BUY") continue;
      diag.buyFound += 1;
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
          type: "BUY",
          confidence: t.signal?.confidence || "B",
          score: t.signal?.score || 60,
          reason: t.signal?.reason || `${botId} BUY`,
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
  // dry run fallback: $1000 — 모든 메이저 알트 + BTC 거래 시뮬 가능
  const effectiveEquity = equity > 0 ? equity : (forceDryRun ? 1000 : 0);
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

  // 5) 시그널 수집 — dry run 은 24h lookback, cursor advance 안 함, strict 해제
  const lbMs = lookbackMs || (forceDryRun ? 24 * 60 * 60 * 1000 : 30 * 60 * 1000);
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
  const canonical = rawSignals
    .map((r) => extractSignal(r, { strict: !forceDryRun }))
    .filter(Boolean);
  S(`canonical=${canonical.length}`);
  let ranked = rankSignals(canonical);
  if (!ranked.length) {
    return { ok: true, userId, ran: false, reason: "no valid canonical signal", diag, steps };
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

  // ★ 자동 종목 차단 — shadow-summary.bySymbol 기반 winRate < 30% AND trades >= 20 인 심볼은 신규 진입 거부
  // (2026-05-03 진단: SOL 18.5%, XRP 11.5% 같은 명백한 손실 종목을 자동 정리)
  const blockedByPerf = new Set();
  try {
    const kvBlock = await getKv();
    const summary = (await kvBlock.get(`di:real:user:${userId}:shadow-summary`)) || null;
    const bySym = summary?.bySymbol || {};
    for (const [sym, s] of Object.entries(bySym)) {
      const trades = s?.trades || 0;
      const wins = s?.wins || 0;
      const wr = trades > 0 ? wins / trades : 0;
      if (trades >= 20 && wr < 0.3) blockedByPerf.add(sym);
    }
    if (blockedByPerf.size > 0) S(`auto-blocked symbols (winRate<30% n>=20): ${Array.from(blockedByPerf).join(", ")}`);
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

  // ★ 중복 진입 차단 — 이미 OPEN 인 심볼에는 신규 진입 안 함
  // (지난 진단에서 ADAUSDT 같은 종목이 5분마다 반복 진입돼 림보 200건 누적된 문제)
  const openSymbols = new Set();
  if (shadow) {
    try {
      const kvDup = await getKv();
      const ledger = (await kvDup.get(`di:real:user:${userId}:shadow-ledger`)) || [];
      for (const e of ledger) {
        if (e?.status !== "CLOSED" && e?.plan?.symbol) openSymbols.add(e.plan.symbol);
      }
      if (openSymbols.size > 0) S(`open positions: ${openSymbols.size} symbols (dedup will skip)`);
    } catch {}
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
      const klInterval = cand.timeframe === "1h" ? "1h" : cand.timeframe === "1d" ? "1d" : "4h";
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
      id: `sh-${Date.now()}-${best.id}`,
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

  // 11) engine-log
  await appendLog(userId, `di:real:user:${userId}:engine-log`, {
    time: startedAt,
    mode: shadow ? "shadow" : (dryRun ? "dry" : "live"),
    signal: best,
    plan: { ...plan.plan, log: undefined },
    result: result ? {
      ok: result.ok, orderId: result.orderId, dryRun: !!result.dryRun,
      bracket: result.bracket, bracketRescue: result.bracketRescue, shadow: !!result.shadow,
    } : null,
    dryRun,
    shadow,
  });

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
