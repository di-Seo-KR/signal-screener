// ═══════════════════════════════════════════════════════════════
// Zepta — 24/7 시장 감시 엔진 v1.1
// ═══════════════════════════════════════════════════════════════
// 10분마다 실행: 핵심 지표 스냅샷 → KV 누적 → 레짐 변화 감지 → 알림
// Hurst/ER/ATR 변화율을 연속 추적하여 "시장이 바뀌고 있는 순간" 포착
// 환경변수: KV_REST_API_URL, KV_REST_API_TOKEN, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
// 알림 포맷: api/_shared/telegram.js 의 buildCard/sendCards 사용 (사용자 친화)
// ═══════════════════════════════════════════════════════════════

import { sendCards, buildCard, fmtKSTShort } from "./_shared/telegram.js";

export const config = { maxDuration: 60 };

const CRYPTO_TICKERS = ["BTC-USD", "ETH-USD", "SOL-USD"];
const STOCK_TICKERS = ["AAPL", "MSFT", "NVDA", "TSLA", "AMZN", "META", "AMD", "AVGO", "SPY", "QQQ"];
const ALL_TICKERS = [...STOCK_TICKERS, ...CRYPTO_TICKERS];

// KV 키 프리픽스
const KV_PREFIX = "di:monitor:";
const KV_ALERT_PREFIX = "di:alert:";
const MAX_SNAPSHOTS = 144; // 24시간분 (10분 × 144 = 1440분)

export default async function handler(req, res) {
  const start = Date.now();
  const log = [];
  const L = (m) => { log.push(m); console.log(m); };

  try {
    // ── KV 연결 ──
    let kv = null;
    try {
      const kvModule = await import("@vercel/kv");
      kv = kvModule.kv;
    } catch {
      L("⚠️ KV 미설정 — 상태 누적 불가, 스냅샷만 실행");
    }

    const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const TG_CHAT = process.env.TELEGRAM_CHAT_ID;
    const now = Date.now();
    const nowISO = new Date().toISOString();

    // 미장 시간 체크 (주식은 장중에만)
    const utcHour = new Date().getUTCHours();
    const utcDay = new Date().getUTCDay();
    const isUSMarketHours = utcDay >= 1 && utcDay <= 5 && utcHour >= 13 && utcHour <= 21;

    // 감시 대상 결정: 크립토는 항상, 주식은 장중에만
    const activeTickers = isUSMarketHours ? ALL_TICKERS : CRYPTO_TICKERS;
    L(`🔍 마켓 모니터 시작 (${activeTickers.length}종목) ${isUSMarketHours ? "[미장 운영중]" : "[크립토만]"}`);

    // ── 종목별 실시간 스냅샷 수집 ──
    const snapshots = {};
    const alerts = [];

    for (const ticker of activeTickers) {
      try {
        const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?range=6mo&interval=1d`;
        const yahooRes = await fetch(yahooUrl, {
          headers: { "User-Agent": "Mozilla/5.0 (DI-Monitor)" },
        });
        const yahooData = await yahooRes.json();
        const result = yahooData?.chart?.result?.[0];
        if (!result?.timestamp) continue;

        const q = result.indicators.quote[0];
        const closes = result.timestamp.map((_, i) => q.close[i]).filter(v => v != null);
        const highs = result.timestamp.map((_, i) => q.high[i]).filter(v => v != null);
        const lows = result.timestamp.map((_, i) => q.low[i]).filter(v => v != null);
        const volumes = result.timestamp.map((_, i) => q.volume[i] || 0);

        if (closes.length < 60) continue;

        const lastPrice = closes[closes.length - 1];
        const prevPrice = closes[closes.length - 2];
        const pricePctChange = ((lastPrice - prevPrice) / prevPrice) * 100;

        // ── 핵심 알파 지표 계산 ──
        const hurst = calcHurst(closes.slice(-100));
        const er = calcER(closes, 10);
        const curER = er[er.length - 1] || 0;
        const atr = calcATR(highs, lows, closes, 14);
        const lastATR = atr[atr.length - 1] || 0;
        const atrPct = lastPrice > 0 ? (lastATR / lastPrice) * 100 : 0;
        const rsi = calcRSI(closes, 14);
        const lastRSI = rsi[rsi.length - 1] || 50;

        // 변동성 군집 비율
        const atrSMA50 = calcSMASimple(atr.filter(v => v != null), 50);
        const atrRatio = atrSMA50 > 0 ? lastATR / atrSMA50 : 1;

        // 모멘텀 1차 도함수
        const mom10 = closes.length > 10 ? ((lastPrice - closes[closes.length - 11]) / closes[closes.length - 11]) * 100 : 0;

        // 거래량 이상 감지
        const volSMA = calcSMASimple(volumes.slice(-20), 20);
        const volRatio = volSMA > 0 ? volumes[volumes.length - 1] / volSMA : 1;

        const snapshot = {
          t: now,
          price: lastPrice,
          pctChange: pricePctChange,
          hurst,
          er: curER,
          atrPct,
          atrRatio,
          rsi: lastRSI,
          mom10,
          volRatio,
        };
        snapshots[ticker] = snapshot;

        // ── KV에 스냅샷 누적 ──
        if (kv) {
          const kvKey = `${KV_PREFIX}${ticker}`;
          let history = [];
          try { history = (await kv.get(kvKey)) || []; } catch {}
          history.push(snapshot);
          if (history.length > MAX_SNAPSHOTS) history = history.slice(-MAX_SNAPSHOTS);
          await kv.set(kvKey, history, { ex: 86400 * 3 }); // 3일 TTL

          // ── 레짐 변화 감지 (이전 스냅샷과 비교) ──
          if (history.length >= 6) {
            const prev6 = history.slice(-7, -1);
            const avgPrevHurst = prev6.reduce((s, h) => s + (h.hurst || 0.5), 0) / prev6.length;
            const avgPrevER = prev6.reduce((s, h) => s + (h.er || 0), 0) / prev6.length;
            const avgPrevATRRatio = prev6.reduce((s, h) => s + (h.atrRatio || 1), 0) / prev6.length;

            // Hurst 레짐 전환 감지
            if (Math.abs(hurst - avgPrevHurst) > 0.08) {
              const direction = hurst > avgPrevHurst ? "추세 강화" : "평균회귀 전환";
              alerts.push({
                ticker, type: "REGIME_SHIFT",
                msg: `🧬 ${ticker} Hurst 레짐 변화: ${avgPrevHurst.toFixed(2)}→${hurst.toFixed(2)} (${direction})`,
                severity: "high",
              });
            }

            // ER 급변 감지 (추세 탄생/소멸)
            if (curER > 0.6 && avgPrevER < 0.35) {
              alerts.push({
                ticker, type: "TREND_BIRTH",
                msg: `📐 ${ticker} 추세 탄생: ER ${avgPrevER.toFixed(2)}→${curER.toFixed(2)}`,
                severity: "high",
              });
            } else if (curER < 0.2 && avgPrevER > 0.5) {
              alerts.push({
                ticker, type: "TREND_DEATH",
                msg: `📐 ${ticker} 추세 소멸: ER ${avgPrevER.toFixed(2)}→${curER.toFixed(2)}`,
                severity: "medium",
              });
            }

            // 변동성 폭발 감지
            if (atrRatio > 1.8 && avgPrevATRRatio < 1.3) {
              alerts.push({
                ticker, type: "VOL_EXPLOSION",
                msg: `⚡ ${ticker} 변동성 폭발: ATR비율 ${avgPrevATRRatio.toFixed(1)}→${atrRatio.toFixed(1)}x`,
                severity: "high",
              });
            }

            // 스마트머니 감지 (가격 보합 + 거래량 급증)
            if (Math.abs(pricePctChange) < 0.5 && volRatio > 2.5) {
              alerts.push({
                ticker, type: "SMART_MONEY",
                msg: `🔮 ${ticker} 스마트머니 포착: 가격 ${pricePctChange > 0 ? '+' : ''}${pricePctChange.toFixed(1)}% 보합 + 거래량 ${volRatio.toFixed(1)}x`,
                severity: "medium",
              });
            }

            // RSI 극단 경고
            if (lastRSI < 20 || lastRSI > 80) {
              const zone = lastRSI < 20 ? "극도 과매도 (매수 기회?)" : "극도 과매수 (매도 주의)";
              alerts.push({
                ticker, type: "RSI_EXTREME",
                msg: `📊 ${ticker} RSI ${lastRSI.toFixed(0)} — ${zone}`,
                severity: "low",
              });
            }
          }
        }

        L(`  ✅ ${ticker}: $${lastPrice.toFixed(2)} H=${hurst.toFixed(2)} ER=${curER.toFixed(2)} ATR=${atrPct.toFixed(1)}% RSI=${lastRSI.toFixed(0)}`);
      } catch (e) {
        L(`  ❌ ${ticker}: ${e.message}`);
      }
    }

    // ── 시장 전체 레짐 요약 KV 저장 ──
    if (kv && Object.keys(snapshots).length > 0) {
      const allHursts = Object.values(snapshots).map(s => s.hurst);
      const allERs = Object.values(snapshots).map(s => s.er);
      const avgHurst = allHursts.reduce((a, b) => a + b, 0) / allHursts.length;
      const avgER = allERs.reduce((a, b) => a + b, 0) / allERs.length;

      const marketRegime = avgHurst > 0.55 ? "trending" : avgHurst < 0.45 ? "mean_reverting" : "transitional";
      const marketEfficiency = avgER > 0.5 ? "directional" : avgER < 0.25 ? "noisy" : "mixed";

      const regimeSummary = {
        t: now,
        regime: marketRegime,
        efficiency: marketEfficiency,
        avgHurst,
        avgER,
        alertCount: alerts.length,
        activeTickers: activeTickers.length,
      };

      await kv.set("di:market:regime", regimeSummary, { ex: 86400 });

      // cron 엔진이 참조할 수 있도록 최신 알림 저장
      if (alerts.length > 0) {
        await kv.set("di:market:alerts", alerts.slice(0, 20), { ex: 3600 });
      }

      L(`\n📡 시장 레짐: ${marketRegime} (Hurst ${avgHurst.toFixed(2)}) | 효율성: ${marketEfficiency} (ER ${avgER.toFixed(2)})`);
    }

    // ── 중요 알림만 텔레그램 전송 (high severity만) ──
    const highAlerts = alerts.filter(a => a.severity === "high");
    if (highAlerts.length > 0 && TG_TOKEN && TG_CHAT) {
      // 중복 알림 방지: 같은 종목+타입 1시간 내 재알림 금지
      const alertsToSend = [];
      for (const alert of highAlerts) {
        const alertKey = `${KV_ALERT_PREFIX}${alert.ticker}:${alert.type}`;
        let lastAlertTime = 0;
        if (kv) {
          try { lastAlertTime = (await kv.get(alertKey)) || 0; } catch {}
        }
        if (now - lastAlertTime > 3600000) { // 1시간
          alertsToSend.push(alert);
          if (kv) await kv.set(alertKey, now, { ex: 7200 });
        }
      }

      if (alertsToSend.length > 0) {
        // 친화 포맷 카드: humanize() 가 알림별 전문 용어를 평어로 자동 변환
        const card = buildCard({
          tag: "🚨",
          title: `시장에서 주목할 신호 ${alertsToSend.length}건`,
          lines: alertsToSend.map((a) => a.msg),
          hint: alertsToSend.length >= 3
            ? "여러 종목·지표가 동시에 흔들리는 중 — 무리한 진입은 잠시 보류하시는 게 안전합니다"
            : undefined,
          footer: `${fmtKSTShort()} · 10분 간격 자동 감시 · Zepta`,
        });

        await sendCards([card]);
        L(`📨 텔레그램 알림 ${alertsToSend.length}건 전송`);
      }
    }

    const duration = ((Date.now() - start) / 1000).toFixed(1);
    L(`\n✅ 모니터 완료 (${duration}s) — ${Object.keys(snapshots).length}종목 스캔, ${alerts.length}건 감지`);

    return res.status(200).json({
      ok: true,
      tickers: Object.keys(snapshots).length,
      alertCount: alerts.length,
      highAlertCount: highAlerts.length,
      duration: `${duration}s`,
      snapshots,
      alerts,
      log,
    });

  } catch (e) {
    L(`💥 에러: ${e.message}`);
    return res.status(200).json({ ok: false, error: e.message, log });
  }
}

// ════════════════════════════════════════════════════════
// 지표 계산 (경량 버전)
// ════════════════════════════════════════════════════════

function calcHurst(data) {
  const n = data.length;
  if (n < 20) return 0.5;
  const lr = [];
  for (let i = 1; i < n; i++) lr.push(Math.log(data[i] / data[i - 1]));
  const mean = lr.reduce((a, b) => a + b, 0) / lr.length;
  const dev = lr.map(r => r - mean);
  const cd = []; let cum = 0;
  for (const d of dev) { cum += d; cd.push(cum); }
  const R = Math.max(...cd) - Math.min(...cd);
  const S = Math.sqrt(dev.reduce((a, b) => a + b * b, 0) / dev.length);
  if (S === 0) return 0.5;
  return Math.log(R / S) / Math.log(n);
}

function calcER(closes, period = 10) {
  const er = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < period) { er.push(0); continue; }
    const dir = Math.abs(closes[i] - closes[i - period]);
    let vol = 0;
    for (let j = 1; j <= period; j++) vol += Math.abs(closes[i - j + 1] - closes[i - j]);
    er.push(vol > 0 ? dir / vol : 0);
  }
  return er;
}

function calcRSI(closes, period = 14) {
  const result = new Array(closes.length).fill(null);
  if (closes.length < period + 1) return result;
  let gS = 0, lS = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gS += d; else lS -= d;
  }
  let ag = gS / period, al = lS / period;
  result[period] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    ag = (ag * (period - 1) + (d > 0 ? d : 0)) / period;
    al = (al * (period - 1) + (d < 0 ? -d : 0)) / period;
    result[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  }
  return result;
}

function calcATR(highs, lows, closes, period = 14) {
  const tr = [highs[0] - lows[0]];
  for (let i = 1; i < closes.length; i++) {
    tr.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
  }
  // EMA of TR
  const result = new Array(tr.length).fill(null);
  const k = 2 / (period + 1);
  let sum = 0;
  for (let i = 0; i < period; i++) sum += tr[i];
  result[period - 1] = sum / period;
  for (let i = period; i < tr.length; i++) {
    result[i] = tr[i] * k + result[i - 1] * (1 - k);
  }
  return result;
}

function calcSMASimple(arr, period) {
  if (arr.length < period) return 0;
  let sum = 0;
  for (let i = arr.length - period; i < arr.length; i++) sum += (arr[i] || 0);
  return sum / period;
}

// (구버전 sendTelegram 제거 — _shared/telegram.js 의 sendCards 로 대체됨)
