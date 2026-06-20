// api/real-trading/position-monitor.js
//
// 실전 포지션 + Bracket(SL/TP) 상태를 주기적으로 확인.
// 부분 체결/고아 SL/TP 주문을 감지하고, 포지션 청산이 확인되면
// circuit-breaker 에 realizedPnL 을 기록.
//
// 역할 정리:
//  1) getPositionRisk → 현재 포지션
//  2) getOpenOrders → 남아있는 SL/TP 주문
//  3) 포지션이 0 인데 SL/TP 가 살아있으면 cancelAllOpenOrders (고아 정리)
//  4) 포지션이 0 되었고 직전 engine-log 에 해당 심볼이 있으면
//     대략적인 realizedPnL 을 orders 로그에서 찾아 breaker.recordTradeResult 호출

import { loadUserCredentials, respondError } from "../_shared/binance-auth.js";
import {
  getPositionRisk,
  getOpenOrders,
  cancelAllOpenOrders,
  cancelOrder,
  placeStopOrder,
  placeOrder,
  getUserTrades,
  getAccountInfo,
} from "../_shared/binance-client.js";
import { recordTradeResult } from "../_shared/circuit-breaker.js";
import { recordLiveTrade } from "../_shared/live-summary.js";
import {
  evaluateTimeStop,
  evaluateTrailingStop,
  RISK_CONFIG,
} from "../_shared/risk-manager.js";
import { getSymbolFilter } from "../_shared/exchange-info.js";
import { evaluateMtfExitSignals } from "../_shared/exit-signals.js";
import { evaluateDrawdownGuard } from "./drawdown-guard.js";
import { recordReentryCooldown } from "../_shared/reentry-cooldown.js";

export const config = { maxDuration: 60 };

async function getKv() {
  return (await import("@vercel/kv")).kv;
}

async function checkUser(userId) {
  const creds = await loadUserCredentials(userId);
  const positions = await getPositionRisk({ ...creds });
  const nonZero = (positions || []).filter((p) => Math.abs(parseFloat(p.positionAmt || 0)) > 0);

  const kv = await getKv();
  const lastPosKey = `di:real:user:${userId}:last-positions`;
  const lastPosRaw = (await kv.get(lastPosKey)) || {};
  // 레거시 array 형태 호환
  const lastPos = Array.isArray(lastPosRaw)
    ? Object.fromEntries(lastPosRaw.map((p) => [p.symbol, p]))
    : lastPosRaw;

  // ★ 2026-05-09 audit M5: closed 를 처음부터 객체 배열로 만들어 buggy map 회피.
  //   이전: closed = ["BTC", "ETH"] (string) → 처리 후 첫 심볼만 객체 변환되고 나머지 누락.
  //   현재: closed = [{ sym, realizedPnL? }] 일관 형태.
  const report = { userId, positions: nonZero.length, closed: [], orphansCleaned: [] };

  // 1) 고아 SL/TP 정리 — 포지션 없는 심볼에 남은 reduce-only 주문 취소
  const symbolsWithPos = new Set(nonZero.map((p) => p.symbol));
  // 직전에 포지션이 있었지만 지금은 없는 것 = 최근 청산된 심볼
  const lastSymbols = new Set(Object.keys(lastPos));
  for (const sym of lastSymbols) {
    if (!symbolsWithPos.has(sym)) {
      // 고아 주문 확인 후 취소
      try {
        const open = await getOpenOrders({ ...creds, symbol: sym });
        if (Array.isArray(open) && open.length > 0) {
          await cancelAllOpenOrders({ ...creds, symbol: sym });
          report.orphansCleaned.push({ sym, cancelled: open.length });
        }
      } catch (e) {
        report.orphansCleaned.push({ sym, error: e?.message });
      }
      report.closed.push({ sym });  // ← 객체 형태로 통일
    }
  }

  // 2) realizedPnL 계산 — userTrades 에서 최근 청산 트레이드의 realizedPnl 합산
  // ★ 2026-05-08: lookback 10분 → 60분 (cron 주기 3분 + binance 지연 + 사용자 인지
  //    시간 여유 확보). realized=0 케이스도 fallback 알림 (감지만이라도).
  if (report.closed.length) {
    const lookbackMs = 60 * 60 * 1000; // 60분 (이전 10분 → 너무 좁아 청산 감지 누락)
    const startTime = Date.now() - lookbackMs;
    for (const closedEntry of report.closed) {
      const sym = closedEntry.sym;
      let realized = null;
      try {
        const trades = await getUserTrades({ ...creds, symbol: sym, startTime, limit: 50 });
        // ★ 감사 P2: 프록시 에러 시 비배열 객체({ok:false,...}) 반환 가능 → Array.isArray 가드
        const _arr = Array.isArray(trades) ? trades : [];
        const sum = _arr.reduce((s, t) => s + parseFloat(t.realizedPnl || 0), 0);
        // ★ 적대감사 P2-3: API 성공이지만 거래 0건(룩백 밖/일시 조회실패)을 realized=0 으로 단정하면
        //   recordTradeResult(0)이 연속손실 streak 을 거짓 리셋(서킷브레이커 무력화). 빈 결과는
        //   null(unavailable) 유지 → recordTradeResult 미호출(streak 보존). 실제 break-even(거래有,합0)만 0.
        if (_arr.length > 0 && Number.isFinite(sum)) realized = sum;
      } catch (e) {
        console.warn(`[monitor] userTrades ${sym} failed:`, e?.message);
      }

      // ★ realized 가 null (API 실패) 또는 0 이어도 청산 자체는 발생했으니 로그 + 알림.
      // ★ 2026-05-09: realized=0 도 recordTradeResult 호출 → 연속손실 streak 끊김.
      //   (이전: !=null && !==0 가드로 0 거래는 카운터 영향 0 → streak 영원히 안 끊김)
      const realizedSafe = Number.isFinite(realized) ? realized : 0;
      if (realized != null) {
        await recordTradeResult(userId, realized);
        // ★ 2026-05-09 audit M7: live-summary 누적 — 자동 차단 기준 (live 우선) + 가중치 학습 input
        try {
          // plan KV 에서 진입 시점 메타 가져오기 (family/confidence/timeframe)
          const planForMeta = await kv.get(`di:real:user:${userId}:plan:${sym}`);
          await recordLiveTrade(userId, {
            symbol: sym,
            side: planForMeta?.side,
            family: planForMeta?.strategyFamily,
            confidence: planForMeta?.confidence,
            timeframe: planForMeta?.timeframe,
            realizedPnL: realized,
            openedAt: planForMeta?.openedAt,
            closedAt: new Date().toISOString(),
          });
        } catch (e) {
          console.warn(`[live-summary] update failed for ${sym}:`, e?.message);
        }
      }
      // 청산 이벤트 engine-log 기록 (realized 0/null 도 항상 기록)
      const logKey = `di:real:user:${userId}:engine-log`;
      const log = (await kv.get(logKey)) || [];
      log.unshift({
        time: new Date().toISOString(),
        event: "position_closed",
        symbol: sym,
        realizedPnL: Number(realizedSafe.toFixed(4)),
        pnlSource: realized != null ? "userTrades" : "unavailable",
      });
      await kv.set(logKey, log.slice(0, 600)); // engine-log cap 600 (어제활동 보존)
      // ★ M5 fix: 객체 배열 직접 mutate (이전엔 string vs 객체 비교 버그)
      closedEntry.realizedPnL = realizedSafe;

      // ★ 2026-06-12 (대표 지시): 재진입 쿨다운 기록 — 청산 직후 동일 종목·방향 즉시
      //   재진입 churn 손실 방지. 손절은 길게(120m), 익절은 짧게(45m). plan 삭제(아래
      //   텔레그램 블록 line ~181) 전에 side 를 확보. plan 없으면 side=null(전방향 차단).
      try {
        const planForSide = await kv.get(`di:real:user:${userId}:plan:${sym}`);
        await recordReentryCooldown(kv, userId, {
          // ★ 적대감사 P2-18: realized==null(userTrades API 실패)을 realizedSafe=0 으로 넘기면 손절
          //   쿨다운(120m)이 익절 윈도우(45m)로 단축 → churn. pnl 미상 시 보수적 손절(-1)로 긴 쿨다운 유지.
          symbol: sym, side: planForSide?.side, pnl: Number.isFinite(realized) ? realized : -1,
          entryPrice: planForSide?.entryPrice, score: planForSide?.score, // ★ 품질 게이트용
        });
      } catch {}

      // ★ 청산 감지 텔레그램 알림 (수동·봇 구분, realized 누락도 fallback)
      try {
        const planKey = `di:real:user:${userId}:plan:${sym}`;
        const plan = await kv.get(planKey);
        const isBotEntry = !!(plan && plan.openedAt);
        // ★ 2026-05-11 fix: plan.botClosedAt 이 set 됐으면 직전 cron 에서 봇이 가격
        //   SL/TP 도달로 청산한 케이스 → 정확한 사유 라벨 + 알림 톤 조정.
        const wasBotClose = !!(plan && plan.botClosedAt);
        const botReason = plan?.botCloseReason; // "price_sl_hit" | "price_tp_hit"
        const { sendCards, buildCard } = await import("../_shared/telegram.js");
        const hasPnl = realized != null && realized !== 0;
        const sign = realizedSafe >= 0 ? "+" : "";
        const tag = !hasPnl ? "🔔" : realizedSafe >= 0 ? "✅" : "🔻";

        // 제목 결정: 봇 SL/TP 청산이면 정확한 사유, 일반 봇 진입이면 "봇 포지션 청산", 그 외 "수동"
        let title;
        if (wasBotClose) {
          const label = botReason === "price_tp_hit" ? "익절 확정" : botReason === "price_sl_hit" ? "손절 확정" : "봇 청산 확정";
          title = `${label} — ${sym}`;
        } else if (isBotEntry) {
          title = `봇 포지션 청산 — ${sym}`;
        } else {
          title = `수동 포지션 청산 — ${sym}`;
        }

        await sendCards([
          buildCard({
            tag,
            title,
            lines: [
              hasPnl
                ? `실현 손익 ${sign}$${realizedSafe.toFixed(2)}`
                : "실현 손익은 잠시 후 binance 거래 내역 확인 가능 (API 지연)",
              isBotEntry
                ? `봇 진입 시점: ${new Date(plan.openedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}`
                : "사용자가 직접 청산하신 포지션입니다.",
            ],
            hint: wasBotClose
              ? "봇이 mark price 모니터링으로 SL/TP 가격 도달 시 시장가 청산했습니다."
              : isBotEntry
                ? "봇이 진입한 포지션이지만 사용자가 직접 청산하거나 외부 요인으로 닫혔습니다."
                : null,
          }),
        ]);
        // 봇 진입이었으면 plan KV 정리 (botClosedAt 포함)
        if (isBotEntry) {
          await kv.del(planKey);
        }
      } catch (e) {
        console.warn(`[monitor] telegram close alert failed:`, e?.message);
      }
    }
  }

  // 3) ── 트레일링 스탑 + 시간 손절 평가 ──
  // engine 이 진입할 때 plan(slPct, openedAt 등)을 di:real:user:{uid}:plan:{symbol} 에 저장.
  // 여기서 그 plan 을 읽어 trailing/timeStop 판정.
  report.timeStopped = [];
  report.trailed = [];
  for (const p of nonZero) {
    const sym = p.symbol;
    const planKey = `di:real:user:${userId}:plan:${sym}`;
    const plan = await kv.get(planKey);
    if (!plan || !plan.openedAt || !plan.slPct) continue;

    // ★ 2026-05-11 대표 지시로 force-close 로직 제거.
    //   이전 (audit C3): bracket SL attach 실패 시 5분 후 자동 force-close.
    //   문제: 거의 항상 SL attach 가 실패하는 환경이라 매 진입마다 5분 만에 청산됨.
    //   복구: bracket attach 실패해도 청산 안 함. 아래 mark-price 기반 SL/TP 모니터링
    //         (slHit/tpHit 블록) 이 plan.slPrice/tpPrice 도달 시 시장가 청산함.
    //         즉 binance bracket 없어도 봇이 직접 가격 보고 청산하는 fallback 동작.

    const side = parseFloat(p.positionAmt) > 0 ? "LONG" : "SHORT";
    const entryPrice = parseFloat(p.entryPrice);
    const markPrice = parseFloat(p.markPrice);

    // ★ 2026-06-14 (대표 제보 — RIF 청산 직후 롱 재진입): 봇 자체 청산(SL/TP·MTF·시간손절)이
    //   쿨다운을 *즉시* 기록하지 않고, 다음 런의 청산 *감지*(line ~150, 최대 2분 지연)에만
    //   의존하던 게 churn 의 근본 원인. 그 공백에 engine(5분 cron)이 재진입하면, 재진입 후엔
    //   포지션이 다시 열려 '청산'으로 감지되지도 않아 쿨다운이 영영 안 걸렸다. → 봇이 직접
    //   청산하는 지점에서 *즉시* 기록해 공백 제거. pnl 부호(손절/익절 구분)는 mark·entry·수량
    //   으로 추정(SL=음수→120분, TP/이익=양수→45분). recordReentryCooldown 내부 try-catch + 여기 .catch.
    const recordCooldownNow = () =>
      recordReentryCooldown(kv, userId, {
        symbol: sym, side,
        pnl: (markPrice - entryPrice) * parseFloat(p.positionAmt),
        entryPrice,                 // ★ 재진입 품질 게이트용 — 청산된 포지션 진입가
        score: plan?.score,         // ★ 진입 시 신호점수 (engine 이 plan 에 저장)
      }).catch(() => {});

    // ── highWater 갱신 (LONG=max, SHORT=min) ──
    const prevHW = plan.highWater || markPrice;
    const newHW = side === "LONG" ? Math.max(prevHW, markPrice) : Math.min(prevHW, markPrice);
    if (newHW !== prevHW) {
      plan.highWater = newHW;
      await kv.set(planKey, plan);
    }

    // ── ★ (a-pre) 가격 SL/TP — binance bracket endpoint 가 reject 되는
    //   계정 케이스 대응. 봇이 매 cron (3분) 마다 mark price 와 plan.slPrice/
    //   plan.tpPrice 비교 → 도달 시 즉시 시장가 청산.
    //   binance API 변화에 면역. SL endpoint 의존성 0.
    const slHit = plan.slPrice && (
      side === "LONG" ? markPrice <= plan.slPrice : markPrice >= plan.slPrice
    );
    const tpHit = plan.tpPrice && (
      side === "LONG" ? markPrice >= plan.tpPrice : markPrice <= plan.tpPrice
    );
    if (slHit || tpHit) {
      const reason = slHit ? "price_sl_hit" : "price_tp_hit";
      const refPrice = slHit ? plan.slPrice : plan.tpPrice;
      try {
        const closeQty = Math.abs(parseFloat(p.positionAmt));
        // ★ 적대감사 P2-4: 시장가 청산 전 기존 bracket(STOP/TP) 취소 — MTF/시간손절 경로와 동일.
        //   잔여 SL 이 시장가 청산과 동시 체결되거나, 청산 후 고아 주문으로 남는 것 방지.
        await cancelAllOpenOrders({ ...creds, symbol: sym }).catch(() => {});
        await placeOrder({
          ...creds,
          params: {
            symbol: sym,
            side: side === "LONG" ? "SELL" : "BUY",
            type: "MARKET",
            quantity: closeQty,
            reduceOnly: "true",
            newOrderRespType: "RESULT",
          },
        });
        const logKey = `di:real:user:${userId}:engine-log`;
        const log = (await kv.get(logKey)) || [];
        log.unshift({
          time: new Date().toISOString(),
          event: reason,
          symbol: sym,
          markPrice, refPrice,
          side,
        });
        await kv.set(logKey, log.slice(0, 600)); // engine-log cap 600 (어제활동 보존)
        // 텔레그램 알림 — 봇 자체 SL/TP 청산 (binance bracket 없이도 작동)
        try {
          const { sendCards, buildCard } = await import("../_shared/telegram.js");
          const tag = tpHit ? "🎯" : "🛑";
          const label = tpHit ? "익절" : "손절";
          await sendCards([
            buildCard({
              tag,
              title: `봇 ${label} 발동 — ${sym}`,
              lines: [
                `mark $${markPrice.toFixed(4)} → ${tpHit ? "익절" : "손절"}라인 $${refPrice} 도달`,
                `시장가 청산 주문 발송 (실현 손익은 잠시 후 확인)`,
                `봇 진입 시점: ${new Date(plan.openedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}`,
              ],
              hint: "봇이 직접 mark price 모니터링으로 청산 (binance bracket endpoint 우회).",
            }),
          ]);
        } catch {}
        // ★ 2026-05-11 fix: plan KV 즉시 삭제하지 않고 botClosedAt 플래그 set.
        //   이전 (kv.del): 다음 cron 의 close detection 이 plan 못 찾아 "수동 청산" 으로 잘못 분류 + 알림 중복 발송.
        //   현재: 플래그만 set → 다음 cron 이 플래그 보고 봇 청산으로 인지 + 실현 PnL 알림 후 plan 정리.
        plan.botClosedAt = Date.now();
        plan.botCloseReason = reason;
        await kv.set(planKey, plan);
        await recordCooldownNow(); // ★ 청산 즉시 쿨다운 — 재진입 공백 제거 (RIF churn 수정)
        continue; // 시간손절·트레일링 평가 스킵
      } catch (e) {
        console.warn(`[monitor] price SL/TP close failed for ${sym}:`, e?.message);
      }
    }

    // ── ★ (a-mtf) 다중 timeframe 청산 시그널 (2026-05-17 — QUANT-PLAN) ──
    //   1h/4h RSI, MACD, ATR, regime flip, profit-lock trail 등 5개 시그널.
    //   confidence >= 2 → 즉시 시장가 청산. confidence == 1 → plan.exitWatch 마킹만.
    //
    //   ZEPTA_MTF_EXIT_MODE: off | soft | strict (기본 soft)
    //     - off: 평가 안 함
    //     - soft: confidence >= 2 일 때만 청산
    //     - strict: confidence >= 1 일 때 청산 (가장 공격적)
    const mtfMode = (process.env.ZEPTA_MTF_EXIT_MODE || "soft").toLowerCase();
    if (mtfMode !== "off") {
      try {
        const mtf = await evaluateMtfExitSignals({
          symbol: sym,
          side,
          entryPrice,
          markPrice,
          highWater: newHW,
          entryRegime: plan.regime || null,
        });
        const triggerClose =
          (mtfMode === "soft" && mtf.shouldClose) ||
          (mtfMode === "strict" && mtf.confidence >= 1);
        if (triggerClose) {
          try {
            await cancelAllOpenOrders({ ...creds, symbol: sym }).catch(() => {});
            const closeQty = Math.abs(parseFloat(p.positionAmt));
            await placeOrder({
              ...creds,
              params: {
                symbol: sym,
                side: side === "LONG" ? "SELL" : "BUY",
                type: "MARKET",
                quantity: closeQty,
                reduceOnly: "true",
                newOrderRespType: "RESULT",
              },
            });
            const logKey = `di:real:user:${userId}:engine-log`;
            const log = (await kv.get(logKey)) || [];
            log.unshift({
              time: new Date().toISOString(),
              event: "mtf_exit",
              symbol: sym,
              side,
              confidence: mtf.confidence,
              reasons: mtf.reasons,
            });
            await kv.set(logKey, log.slice(0, 600)); // engine-log cap 600 (어제활동 보존)
            // 알림
            try {
              const { sendCards, buildCard } = await import("../_shared/telegram.js");
              await sendCards([
                buildCard({
                  tag: "🚨",
                  title: `다중 시그널 청산 — ${sym}`,
                  lines: [
                    `${mtf.confidence}개 시그널 일치 (mode=${mtfMode}):`,
                    ...mtf.reasons.slice(0, 4).map((r) => `· ${r}`),
                    `시장가 청산 주문 발송`,
                  ],
                  hint: "1h/4h RSI·MACD·ATR + 시장 regime + profit-lock trail 5개 신호 중 2개 이상 동시 발생.",
                }),
              ]);
            } catch {}
            plan.botClosedAt = Date.now();
            plan.botCloseReason = "mtf_exit";
            await kv.set(planKey, plan);
            await recordCooldownNow(); // ★ 청산 즉시 쿨다운 — 재진입 공백 제거 (RIF churn 수정)
            if (!report.mtfClosed) report.mtfClosed = [];
            report.mtfClosed.push({ sym, confidence: mtf.confidence, reasons: mtf.reasons });
            continue; // 후속 평가 skip
          } catch (e) {
            console.warn(`[monitor] mtf exit close failed for ${sym}:`, e?.message);
          }
        } else if (mtf.watchOnly) {
          // 1개 시그널만 — plan KV 에 마킹만 (다음 cron 에서 다시 평가)
          plan.exitWatch = {
            confidence: mtf.confidence,
            reasons: mtf.reasons,
            markedAt: Date.now(),
          };
          await kv.set(planKey, plan);
        }
      } catch (e) {
        console.warn(`[monitor] mtf eval skipped for ${sym}:`, e?.message);
      }
    }

    // ── (a) 시간 손절 ──
    const ts = evaluateTimeStop({
      openedAt: plan.openedAt,
      entryPrice,
      markPrice,
      side,
      slPct: plan.slPct,
      cfg: RISK_CONFIG,
    });
    if (ts.shouldClose) {
      try {
        // bracket 취소 후 시장가 청산
        await cancelAllOpenOrders({ ...creds, symbol: sym });
        const closeQty = Math.abs(parseFloat(p.positionAmt));
        await placeOrder({
          ...creds,
          params: {
            symbol: sym,
            side: side === "LONG" ? "SELL" : "BUY",
            type: "MARKET",
            quantity: closeQty,
            reduceOnly: "true",
            newOrderRespType: "RESULT",
          },
        });
        report.timeStopped.push({ sym, reason: ts.reason, currentR: ts.currentR });
        // 엔진 로그
        const logKey = `di:real:user:${userId}:engine-log`;
        const log = (await kv.get(logKey)) || [];
        log.unshift({
          time: new Date().toISOString(),
          event: "time_stop",
          symbol: sym,
          reason: ts.reason,
        });
        await kv.set(logKey, log.slice(0, 600)); // engine-log cap 600 (어제활동 보존)
        await recordCooldownNow(); // ★ 청산 즉시 쿨다운 — 재진입 공백 제거 (RIF churn 수정)
        // 다음 단계 평가 skip
        continue;
      } catch (e) {
        report.timeStopped.push({ sym, error: e?.message });
      }
    }

    // ── (b) 트레일링 SL ──
    // 현재 active SL 주문 찾아서 stopPrice 비교
    let currentSlPrice = plan.currentSlPrice || plan.slPrice;
    const trail = evaluateTrailingStop({
      entryPrice,
      markPrice,
      side,
      slPct: plan.slPct,
      currentSlPrice,
      highWater: newHW,
      cfg: RISK_CONFIG,
    });
    if (trail.shouldUpdate && trail.newSlPrice) {
      try {
        // tickSize 라운딩
        const filter = await getSymbolFilter(sym).catch(() => null);
        const tick = filter?.tickSize || 0;
        const pricePrec = filter?.pricePrecision ?? 2;
        let newSL = trail.newSlPrice;
        if (tick > 0) newSL = Math.round(newSL / tick) * tick;
        newSL = Number(newSL.toFixed(pricePrec));

        // ★ CRITICAL SAFETY: 새 SL 을 먼저 배치하고, 성공 후 기존 SL 을 취소.
        // 이렇게 하면 새 SL 배치 실패 시에도 기존 SL 이 유지되어
        // 포지션이 SL 보호 없이 방치되는 갭을 완전히 제거한다.
        const closeQty = Math.abs(parseFloat(p.positionAmt));
        const newSlClientId = `trail-${Date.now()}-${sym}`;
        const newSlResult = await placeStopOrder({
          ...creds,
          symbol: sym,
          type: "STOP_MARKET",
          side: side === "LONG" ? "SELL" : "BUY",
          stopPrice: newSL,
          quantity: closeQty,
          closePosition: true,
          reduceOnly: true,
          clientOrderId: newSlClientId,
        });
        // ★ 적대감사 P1-2: mark-price 청산 fallback(L250)이 plan.slPrice 로 청산하므로, 트레일링 SL 을
        //   plan.slPrice 에도 one-way ratchet 으로 반영해야 이익보호가 fallback 에서도 작동한다.
        //   (bracket-reject 계정은 STOP 이 항상 실패하는데 그 계정의 유일 보호가 fallback — 여기서
        //   안 올리면 트레일링/브레이크이븐이 완전 무력화. STOP 성공/실패 *무관* 으로 갱신.)
        const _ratchet = side === "LONG" ? newSL > (plan.slPrice ?? -Infinity) : newSL < (plan.slPrice ?? Infinity);
        // 새 SL 배치 성공 확인 후에만 기존 SL 취소
        if (!newSlResult || newSlResult?.code) {
          // 새 SL(Binance STOP) 실패 — 그래도 fallback enforce 위해 plan.slPrice ratchet.
          if (_ratchet) {
            plan.slPrice = newSL; plan.currentSlPrice = newSL;
            await kv.set(planKey, plan);
            report.trailed.push({ sym, newSL, reason: trail.reason, currentR: trail.currentR, fallbackOnly: true, sl_order_failed: newSlResult?.msg || "unknown" });
          } else {
            report.trailed.push({ sym, error: `new SL placement failed: ${newSlResult?.msg || "unknown"}`, kept_old_sl: true });
          }
        } else {
          // 새 SL 성공 → 이전 SL 주문들 취소 (새 것 제외)
          const opens = await getOpenOrders({ ...creds, symbol: sym });
          const oldSlOrders = (opens || []).filter((o) =>
            (o.type === "STOP_MARKET" || o.type === "STOP")
            && (o.reduceOnly || o.closePosition === "true" || o.closePosition === true)
            && o.clientOrderId !== newSlClientId
          );
          for (const o of oldSlOrders) {
            try { await cancelOrder({ ...creds, symbol: sym, orderId: o.orderId }); }
            catch (ce) { console.warn(`[trail] old SL cancel failed: ${o.orderId}`, ce?.message); }
          }
          if (_ratchet) plan.slPrice = newSL; // ★ P1-2: mark-price fallback 도 트레일링 SL enforce
          plan.currentSlPrice = newSL;
          await kv.set(planKey, plan);
          report.trailed.push({ sym, newSL, reason: trail.reason, currentR: trail.currentR });

          const logKey = `di:real:user:${userId}:engine-log`;
          const log = (await kv.get(logKey)) || [];
          log.unshift({
            time: new Date().toISOString(),
            event: "trailing_stop",
            symbol: sym,
            newSL,
            reason: trail.reason,
          });
          await kv.set(logKey, log.slice(0, 600)); // engine-log cap 600 (어제활동 보존)
        } // end if newSlResult ok
      } catch (e) {
        report.trailed.push({ sym, error: e?.message });
      }
    }
  }

  // 4) 현재 포지션 저장 (symbol → info 맵 형태, reconcile.js 와 공유)
  const nextMap = {};
  for (const p of nonZero) {
    nextMap[p.symbol] = {
      symbol: p.symbol,
      positionAmt: parseFloat(p.positionAmt),
      entryPrice: parseFloat(p.entryPrice),
      markPrice: parseFloat(p.markPrice),
      unRealizedProfit: parseFloat(p.unRealizedProfit),
      leverage: parseInt(p.leverage || "0", 10),
    };
  }
  await kv.set(lastPosKey, nextMap);
  // ★ 2026-06-14 (감사 P2): daily-standup 이 읽는 di:real:user:<uid>:open-positions(배열)
  //   적재 — 미적재로 일일보고 '오픈 포지션 수'가 항상 0 이던 데이터계약 누락 보완. 표시/통계 전용.
  await kv.set(`di:real:user:${userId}:open-positions`, Object.values(nextMap));

  // ── ★ 5) drawdown guard (2026-05-17 — QUANT-PLAN) ──
  //   peak (equityHigh30d) 대비 현재 equity 의 drawdown 평가.
  //   10/15/20% 단계별 자동 청산 + cooldown.
  try {
    const acct = await getAccountInfo(creds);
    const currentEquity = parseFloat(acct?.totalWalletBalance || "0")
      + (Array.isArray(nonZero) ? nonZero.reduce((s, p) => s + parseFloat(p.unRealizedProfit || 0), 0) : 0);
    if (Number.isFinite(currentEquity) && currentEquity > 0) {
      const dd = await evaluateDrawdownGuard({
        userId, creds, positions: nonZero, currentEquity,
      });
      report.drawdownGuard = dd;
    }
  } catch (e) {
    report.drawdownGuard = { triggered: false, error: e?.message };
  }

  return report;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  try {
    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
      const { userId } = body;
      if (!userId) return res.status(400).json({ error: "userId required" });
      const out = await checkUser(userId);
      return res.status(200).json({ ok: true, ...out });
    }
    const kv = await getKv();
    const users = (await kv.get("di:real:phase1-users")) || [];
    const results = [];
    for (const uid of users.slice(0, 10)) {
      try {
        results.push(await checkUser(uid));
      } catch (e) {
        results.push({ userId: uid, error: e?.message });
      }
    }
    return res.status(200).json({ ok: true, count: results.length, results });
  } catch (err) {
    return respondError(res, err);
  }
}
