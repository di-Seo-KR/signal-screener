// api/real-trading/shadow-monitor.js
//
// Shadow mode 포지션 모니터.
// shadow-ledger 에 기록된 OPEN 항목을 돌면서 현재가로 SL/TP 히트 또는 time-stop 판정.
// 가상 실현 손익(수수료·슬리피지 차감 후)을 기록.
//
// KV:
//  di:real:user:<uid>:shadow-ledger  → [{ id, openedAt, status, signal, plan, entryPrice, feeBps, slippageBps, closedAt?, closeReason?, netPnL? }]
//  di:real:user:<uid>:shadow-summary → { wins, losses, netPnL, totalRR, trades, updatedAt }
//
// cron: */5 분

import { getTickerPrice, getKlines } from "../_shared/binance-client.js";
import { respondError } from "../_shared/binance-auth.js";
import { RISK_CONFIG } from "../_shared/risk-manager.js";

export const config = { maxDuration: 60 };

// risk-manager 의 soft timeStops 를 shadow 에도 적용
// (이전엔 shadow 가 SL/TP/maxHold 만 봐서 6h/12h/24h 단계 컷이 무시되고 있었음 — 이게 31건 전손실의 한 축)
const SOFT_TIME_STOPS = RISK_CONFIG?.timeStops || [
  { afterMs: 6  * 3600000, minProfitR: 0.0 },
  { afterMs: 12 * 3600000, minProfitR: 0.5 },
  { afterMs: 24 * 3600000, minProfitR: 1.0 },
];

// 현재 가격에서 R 단위 수익률 계산 (양수=수익, 음수=손실)
function currentR(side, entry, mark, plan) {
  if (!entry || !mark) return 0;
  const grossPct = side === "LONG" ? (mark - entry) / entry : (entry - mark) / entry;
  const notional = plan?.notional || 0;
  const riskAmt = plan?.riskAmount || 0;
  if (riskAmt <= 0 || notional <= 0) return 0;
  const grossPnL = notional * grossPct;
  return grossPnL / riskAmt;
}

async function getKv() {
  const mod = await import("@vercel/kv");
  return mod.kv;
}

// ★ 2026-05-09 audit M4/N6: 5분 캔들의 high/low 까지 봐서 SL/TP wick 통과 검사.
//   이전: cron 시점 mark price 만 비교 → 5분 사이 SL 통과했다 회복하면 SL 미체결 기록 (TP 편향).
//   현재: 마지막 5분 캔들 high/low 가 SL/TP 통과했는지 확인. 둘 다 통과 시 SL 우선 (보수적).
//   그게 없으면 mark price 로 fallback (이전 동작).
function hitLong(entry, markPrice, sl, tp, candle) {
  // 5m candle 기준으로 wick 통과 확인 (있으면)
  if (candle && Number.isFinite(candle.low) && Number.isFinite(candle.high)) {
    const slHit = candle.low <= sl;
    const tpHit = candle.high >= tp;
    if (slHit && tpHit) return "SL";   // ← SL 우선 (보수적 — 둘 다 wick 통과 시 손실 가정)
    if (slHit) return "SL";
    if (tpHit) return "TP";
  }
  // fallback: mark price 비교
  if (markPrice <= sl) return "SL";
  if (markPrice >= tp) return "TP";
  return null;
}
function hitShort(entry, markPrice, sl, tp, candle) {
  if (candle && Number.isFinite(candle.low) && Number.isFinite(candle.high)) {
    const slHit = candle.high >= sl;
    const tpHit = candle.low <= tp;
    if (slHit && tpHit) return "SL";
    if (slHit) return "SL";
    if (tpHit) return "TP";
  }
  if (markPrice >= sl) return "SL";
  if (markPrice <= tp) return "TP";
  return null;
}

async function tickFor(symbol) {
  try {
    const r = await getTickerPrice({ symbol });
    return parseFloat(r.price);
  } catch {
    return null;
  }
}

// ★ 2026-05-09 audit M4: 5분 봉 1개의 high/low 가져옴 (가장 최근 closed 캔들).
async function lastCandleFor(symbol) {
  try {
    const kl = await getKlines({ symbol, interval: "5m", limit: 2 });
    if (!Array.isArray(kl) || kl.length === 0) return null;
    // 마지막 (현재 진행중) 캔들 사용 — high/low 가 가장 신선
    const c = kl[kl.length - 1];
    return {
      high: parseFloat(c[2]),
      low: parseFloat(c[3]),
      close: parseFloat(c[4]),
    };
  } catch {
    return null;
  }
}

async function monitorUser(userId) {
  const kv = await getKv();
  const ledgerKey = `di:real:user:${userId}:shadow-ledger`;
  const summaryKey = `di:real:user:${userId}:shadow-summary`;
  const equityKey = `di:real:user:${userId}:shadow-equity`;
  const ledger = (await kv.get(ledgerKey)) || [];
  if (!ledger.length) return { userId, scanned: 0, closed: 0 };

  const now = Date.now();
  const closed = [];
  let mutated = false; // ★ 적대감사 P1-3: MFE/MAE·트레일링 SL 변경 추적 → 청산 없어도 영속화
  const symbolPrice = {};

  // ★ M4: 심볼별 5분 캔들 캐시 (한 번 fetch 해서 재사용)
  const symbolCandle = {};
  for (const e of ledger) {
    if (e.status !== "OPEN") continue;
    const sym = e.plan?.symbol;
    if (!sym) continue;
    if (!(sym in symbolPrice)) symbolPrice[sym] = await tickFor(sym);
    if (!(sym in symbolCandle)) symbolCandle[sym] = await lastCandleFor(sym);
    const mark = symbolPrice[sym];
    const candle = symbolCandle[sym];
    if (!mark || !Number.isFinite(mark)) continue;

    const side = e.plan.side;
    const tp = e.plan.tpPrice;
    const entry = e.entryPrice;

    // ── MFE / MAE 트래킹 (best/worst 가격) ──
    const _oldMfe = e.mfePrice, _oldMae = e.maePrice, _oldSl = e.plan.slPrice;
    e.mfePrice = side === "LONG"
      ? Math.max(e.mfePrice || mark, mark)
      : Math.min(e.mfePrice || mark, mark);
    e.maePrice = side === "LONG"
      ? Math.min(e.maePrice || mark, mark)
      : Math.max(e.maePrice || mark, mark);
    if (e.mfePrice !== _oldMfe || e.maePrice !== _oldMae) mutated = true; // ★ P1-3

    // ── 트레일링 스탑 적용 (RISK_CONFIG.trailingStop) — hit 체크 전에 SL 업데이트 ──
    // MFE 기반으로 최고점에서 일정 R 만큼 떨어진 위치로 SL 끌어올림.
    // 한 번 올린 SL 은 절대 내리지 않음 (one-way ratchet).
    // 기존 SL 을 e.plan.slPrice 로 덮어쓰며, 다음 hitLong/hitShort 에서 즉시 반영.
    const trail = RISK_CONFIG?.trailingStop;
    if (trail?.enabled && e.mfePrice && entry > 0) {
      const riskAmt = e.plan?.riskAmount || 0;
      const notional = e.plan?.notional || 0;
      if (riskAmt > 0 && notional > 0) {
        // 현재까지 도달한 최고 R (MFE 기준)
        const mfePct = side === "LONG"
          ? (e.mfePrice - entry) / entry
          : (entry - e.mfePrice) / entry;
        const peakR = (mfePct * notional) / riskAmt;
        // 1) 브레이크이븐 — peakR ≥ breakEvenAtR 이면 SL 을 최소 entry 로 이동
        if (peakR >= (trail.breakEvenAtR ?? 0.7)) {
          if (side === "LONG" && e.plan.slPrice < entry) e.plan.slPrice = entry;
          if (side === "SHORT" && e.plan.slPrice > entry) e.plan.slPrice = entry;
        }
        // 2) 트레일링 — peakR ≥ activationR 이면 SL 을 peak - trailDistanceR 로 끌어올림
        if (peakR >= (trail.activationR ?? 1.0)) {
          const lockR = peakR - (trail.trailDistanceR ?? 0.5);
          // lockR 을 가격으로 환산
          const lockPct = (lockR * riskAmt) / notional;
          const newSl = side === "LONG"
            ? entry * (1 + lockPct)  // LONG: 진입가 + lockR%
            : entry * (1 - lockPct); // SHORT: 진입가 - lockR%
          // ratchet — 한 번 올린 SL 은 절대 내리지 않음
          if (side === "LONG" && newSl > e.plan.slPrice) e.plan.slPrice = newSl;
          if (side === "SHORT" && newSl < e.plan.slPrice) e.plan.slPrice = newSl;
        }
      }
    }

    if (e.plan.slPrice !== _oldSl) mutated = true; // ★ P1-3: 트레일링/브레이크이븐 SL 변경 영속화

    // 트레일링이 SL 끌어올린 결과 반영해서 hit 체크 (즉시 효과)
    // ★ M4: candle high/low 까지 함께 검사 (TP 편향 제거)
    const sl = e.plan.slPrice;
    const hit = side === "LONG" ? hitLong(entry, mark, sl, tp, candle) : hitShort(entry, mark, sl, tp, candle);

    const openedAt = new Date(e.openedAt || now).getTime();
    const ageMs = now - openedAt;
    const tooOld = ageMs > (e.plan.maxHoldMs || 48 * 60 * 60 * 1000);

    // ── soft timeStops 체크: 일정 시간 지났는데 수익이 충분치 않으면 조기 청산 ──
    // 가장 큰 단계부터 검사 (24h → 12h → 6h) — 첫 매칭에서 결정.
    let softTimeHit = null;
    if (!tooOld) {
      const r = currentR(side, entry, mark, e.plan);
      // 큰 시간 단계부터 검사하면, 늦은 단계 일수록 R 기준이 엄격
      const sorted = [...SOFT_TIME_STOPS].sort((a, b) => b.afterMs - a.afterMs);
      for (const stop of sorted) {
        if (ageMs >= stop.afterMs && r < (stop.minProfitR ?? 0)) {
          softTimeHit = { ageMs, r, threshold: stop.minProfitR, afterMs: stop.afterMs };
          break;
        }
      }
    }

    let close = null;
    if (hit === "TP") {
      close = {
        closeReason: "TP",
        exitPrice: tp,
        grossPct: side === "LONG" ? (tp - entry) / entry : (entry - tp) / entry,
      };
    } else if (hit === "SL") {
      close = {
        closeReason: "SL",
        exitPrice: sl,
        grossPct: side === "LONG" ? (sl - entry) / entry : (entry - sl) / entry,
      };
    } else if (tooOld) {
      close = {
        closeReason: "TIME",
        exitPrice: mark,
        grossPct: side === "LONG" ? (mark - entry) / entry : (entry - mark) / entry,
      };
    } else if (softTimeHit) {
      // soft timeStop 발동 — 진입 후 N시간 지났는데 R 미달 → 조기 청산
      close = {
        closeReason: "SOFT_TIME",
        exitPrice: mark,
        grossPct: side === "LONG" ? (mark - entry) / entry : (entry - mark) / entry,
      };
    }
    if (close) {
      const costPct = ((e.feeBps || 8) + (e.slippageBps || 5)) / 10000;
      const netPct = close.grossPct - costPct;
      const netPnL = (e.plan.notional || 0) * netPct;
      const holdMs = now - openedAt;
      e.status = "CLOSED";
      e.closedAt = new Date(now).toISOString();
      e.closeReason = close.closeReason;
      e.exitPrice = close.exitPrice;
      e.grossPct = close.grossPct;
      e.netPct = netPct;
      e.netPnL = netPnL;
      e.holdMs = holdMs;
      // R 단위 결과
      const riskAmt = e.plan?.riskAmount || 0;
      e.rMultiple = riskAmt > 0 ? netPnL / riskAmt : 0;
      // MFE/MAE 를 R 로 변환
      if (riskAmt > 0 && e.plan?.notional) {
        const mfePct = side === "LONG"
          ? ((e.mfePrice || entry) - entry) / entry
          : (entry - (e.mfePrice || entry)) / entry;
        const maePct = side === "LONG"
          ? ((e.maePrice || entry) - entry) / entry
          : (entry - (e.maePrice || entry)) / entry;
        e.mfeR = (mfePct * e.plan.notional) / riskAmt;
        e.maeR = (maePct * e.plan.notional) / riskAmt;
      }
      closed.push(e);
    }
  }

  // ★ 적대감사 P1-3(영속화)+P1-4(race): 청산 없어도 MFE/MAE·SL 변경이면 저장. 통짜 덮어쓰기 전
  //   최신 ledger 재조회 후 id 기준 머지 — engine append(같은 키)와의 lost-update 완화(그 사이
  //   추가된 OPEN 보존). monitor 변경분(closed/MFE/MAE/SL)은 해당 id 에 우선 적용.
  if (closed.length || mutated) {
    let _fresh;
    try { _fresh = await kv.get(ledgerKey); } catch {}
    if (!Array.isArray(_fresh)) _fresh = ledger;
    const _mut = new Map();
    for (const _e of ledger) if (_e?.id) _mut.set(_e.id, _e);
    const _merged = _fresh.map((fe) => (fe?.id && _mut.has(fe.id)) ? _mut.get(fe.id) : fe);
    await kv.set(ledgerKey, _merged.slice(0, 500));
  }

  if (closed.length) {
    // ── 마감 거래 아카이브 (retro 분석용) ──
    // ledger 는 500개 cap 이라 오래된 closed 가 새 OPEN 에 밀려 사라짐.
    // archive 는 최근 1000건 마감 거래만 보존 (entry/exit/MFE/MAE/closeReason 등 디테일).
    // shadow-debug retro 시뮬, daily-standup QUANT-RES 백테스트 자동화에 사용.
    const archiveKey = `di:real:user:${userId}:shadow-closed-archive`;
    try {
      const prevArchive = (await kv.get(archiveKey)) || [];
      // closed 항목에서 retro 시뮬에 필요한 필드만 추려 저장 (응답 크기 최적화)
      const lite = closed.map((c) => ({
        id: c.id,
        openedAt: c.openedAt,
        closedAt: c.closedAt,
        symbol: c.plan?.symbol,
        side: c.plan?.side,
        family: c.plan?.strategyFamily || c.signal?.strategyFamily || c.signal?.source,
        entryPrice: c.entryPrice,
        exitPrice: c.exitPrice,
        slPrice: c.plan?.slPrice,
        tpPrice: c.plan?.tpPrice,
        slPct: c.plan?.slPct,
        tpPct: c.plan?.tpPct,
        notional: c.plan?.notional,
        riskAmount: c.plan?.riskAmount,
        mfePrice: c.mfePrice,
        maePrice: c.maePrice,
        mfeR: c.mfeR,
        maeR: c.maeR,
        closeReason: c.closeReason,
        grossPct: c.grossPct,
        netPct: c.netPct,
        netPnL: c.netPnL,
        rMultiple: c.rMultiple,
        holdMs: c.holdMs,
        feeBps: c.feeBps,
        slippageBps: c.slippageBps,
        regime: c.regime || null, // ★ 진입 시점 시장 레짐 스냅샷 (Hurst bucket 분석용)
      }));
      // 새 항목을 앞에 추가 (시간 역순). 1000개로 cap.
      const merged = [...lite, ...prevArchive].slice(0, 1000);
      await kv.set(archiveKey, merged);
    } catch (err) {
      console.error("[shadow-monitor] archive failed:", err?.message || err);
    }
    // ── 풍부한 summary 업데이트 ──
    const sum = (await kv.get(summaryKey)) || {
      wins: 0, losses: 0, netPnL: 0, trades: 0, totalRR: 0,
      bestR: 0, worstR: 0, totalHoldMs: 0,
      byFamily: {}, byCloseReason: { TP: 0, SL: 0, TIME: 0, SOFT_TIME: 0 },
      grossWin: 0, grossLoss: 0,
    };
    // 신규 필드 backfill
    sum.byFamily = sum.byFamily || {};
    sum.bySymbol = sum.bySymbol || {}; // ★ 종목별 영구 누적 — 자동 차단/가중치에 사용
    sum.byCloseReason = sum.byCloseReason || { TP: 0, SL: 0, TIME: 0 };
    sum.totalHoldMs = sum.totalHoldMs || 0;
    sum.bestR = sum.bestR || 0;
    sum.worstR = sum.worstR || 0;
    sum.grossWin = sum.grossWin || 0;
    sum.grossLoss = sum.grossLoss || 0;
    // ★ 2026-05-09 audit M3: confidence·timeframe 별 누적 (가중치 학습 input)
    sum.byConfidence = sum.byConfidence || {};
    sum.byTimeframe = sum.byTimeframe || {};

    for (const c of closed) {
      sum.trades += 1;
      sum.netPnL += c.netPnL || 0;
      sum.totalHoldMs += c.holdMs || 0;
      if ((c.netPnL || 0) > 0) {
        sum.wins += 1;
        sum.grossWin += c.netPnL || 0;
      } else {
        sum.losses += 1;
        sum.grossLoss += Math.abs(c.netPnL || 0);
      }
      if ((c.rMultiple || 0) > sum.bestR) sum.bestR = c.rMultiple;
      if ((c.rMultiple || 0) < sum.worstR) sum.worstR = c.rMultiple;
      sum.totalRR += c.rMultiple || 0;
      sum.byCloseReason[c.closeReason] = (sum.byCloseReason[c.closeReason] || 0) + 1;
      const fam = c.plan?.strategyFamily || "unknown";
      sum.byFamily[fam] = sum.byFamily[fam] || { trades: 0, wins: 0, netPnL: 0 };
      sum.byFamily[fam].trades += 1;
      sum.byFamily[fam].netPnL += c.netPnL || 0;
      if ((c.netPnL || 0) > 0) sum.byFamily[fam].wins += 1;
      // ★ 종목별 누적 (자동 차단/가중치 시스템 input)
      const sym = c.plan?.symbol;
      if (sym) {
        sum.bySymbol[sym] = sum.bySymbol[sym] || { trades: 0, wins: 0, netPnL: 0, lastClosedAt: null };
        sum.bySymbol[sym].trades += 1;
        sum.bySymbol[sym].netPnL += c.netPnL || 0;
        if ((c.netPnL || 0) > 0) sum.bySymbol[sym].wins += 1;
        sum.bySymbol[sym].lastClosedAt = c.closedAt || new Date(now).toISOString();
      }
      // ★ M3: confidence 별 누적 (signal 의 conf 값 기준 — A/B/C 또는 숫자)
      const conf = c.signal?.confidence ?? c.plan?.confidence;
      if (conf != null) {
        const confKey = typeof conf === "number"
          ? (conf >= 0.85 ? "A" : conf >= 0.65 ? "B" : "C")
          : String(conf).toUpperCase();
        sum.byConfidence[confKey] = sum.byConfidence[confKey] || { trades: 0, wins: 0, netPnL: 0 };
        sum.byConfidence[confKey].trades += 1;
        sum.byConfidence[confKey].netPnL += c.netPnL || 0;
        if ((c.netPnL || 0) > 0) sum.byConfidence[confKey].wins += 1;
      }
      // ★ M3: timeframe 별 누적
      const tf = c.signal?.timeframe || c.plan?.timeframe || "unknown";
      sum.byTimeframe[tf] = sum.byTimeframe[tf] || { trades: 0, wins: 0, netPnL: 0 };
      sum.byTimeframe[tf].trades += 1;
      sum.byTimeframe[tf].netPnL += c.netPnL || 0;
      if ((c.netPnL || 0) > 0) sum.byTimeframe[tf].wins += 1;
    }
    sum.profitFactor = sum.grossLoss > 0 ? sum.grossWin / sum.grossLoss : null;
    sum.avgHoldHours = sum.trades > 0 ? sum.totalHoldMs / sum.trades / 3600000 : 0;
    sum.avgR = sum.trades > 0 ? sum.totalRR / sum.trades : 0;
    sum.winRate = sum.trades > 0 ? sum.wins / sum.trades : 0;
    sum.updatedAt = new Date().toISOString();
    await kv.set(summaryKey, sum);

    // ── equity curve append ──
    const curve = (await kv.get(equityKey)) || [];
    curve.push({
      t: now,
      cum: sum.netPnL,
      trades: sum.trades,
    });
    // 최근 1000 포인트만
    await kv.set(equityKey, curve.slice(-1000));
  }

  return {
    userId,
    scanned: ledger.length,
    closed: closed.length,
    closedReasons: closed.map((c) => c.closeReason),
  };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  try {
    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
      const { userId } = body;
      if (!userId) return res.status(400).json({ error: "userId required" });
      return res.status(200).json(await monitorUser(userId));
    }
    const kv = await getKv();
    // shadow 모드는 phase1 enroll 없어도 돈다 — 별도 리스트
    // GLOBAL_PROBE_USER 를 항상 포함시켜 대표님 조작 없이도 자동 평가
    const GLOBAL_PROBE_USER = "__zepta_global_probe__";
    const users = (await kv.get("di:real:shadow-users")) || (await kv.get("di:real:phase1-users")) || [];
    if (!users.includes(GLOBAL_PROBE_USER)) users.unshift(GLOBAL_PROBE_USER);
    const results = [];
    for (const uid of users.slice(0, 20)) {
      try { results.push(await monitorUser(uid)); }
      catch (e) { results.push({ userId: uid, error: e?.message }); }
    }
    return res.status(200).json({ ok: true, results });
  } catch (err) {
    return respondError(res, err);
  }
}
