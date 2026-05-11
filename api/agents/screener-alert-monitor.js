// ════════════════════════════════════════════════════════════════════
// Zepta — 저장된 스크리너 조건 매칭 감지 cron
// ──────────────────────────────────────────────────────────────────
// 15분마다 실행 (vercel.json crons).
// 모든 활성 사용자의 saved-screeners 를 순회하면서 조건을 평가.
// 매칭되면:
//   1) 텔레그램 메시지 발송 (channels.telegram == true)
//   2) 알림 센터 KV(di:notifications:user:<uid>) 에 push
//
// KV 키:
//   di:saved-screeners:users   → 활성 사용자 uid 의 Set (회원이 첫 스크리너 저장 시 자동 추가)
//   di:saved-screeners:<uid>
//   di:screener-alert:last-match:<uid>:<screener_id>  → 중복 알람 방지 (TTL 6h)
//
// 안전장치:
//   - 매 cron 실행마다 사용자 최대 50명 처리 (over-budget 방지)
//   - 사용자당 스크리너 최대 5개 평가
//   - 종목 풀은 watchlist + sample universe (BTC, ETH, SPY, AAPL, NVDA, TSLA)
// ════════════════════════════════════════════════════════════════════

import { sendTelegram } from "../_shared/telegram.js";
import { pushNotification } from "../notifications/list.js";
import { getPrefs } from "../notifications/preferences.js";
import { summarizeConditions } from "../screeners/suggested.js";

// 평가 대상 풀 (cron 가 무거워지지 않게 작게 유지)
const SAMPLE_SYMBOLS = [
  // 미국 주식 (대형주)
  { symbol: "AAPL", market: "us" },
  { symbol: "NVDA", market: "us" },
  { symbol: "TSLA", market: "us" },
  { symbol: "MSFT", market: "us" },
  { symbol: "GOOGL", market: "us" },
  { symbol: "META", market: "us" },
  { symbol: "AMZN", market: "us" },
  { symbol: "SPY", market: "us" },
  { symbol: "QQQ", market: "us" },
  // 크립토
  { symbol: "BTC-USD", market: "crypto" },
  { symbol: "ETH-USD", market: "crypto" },
  { symbol: "SOL-USD", market: "crypto" },
];

const MAX_USERS_PER_RUN = 50;
const MAX_SCREENERS_PER_USER = 5;
const ALERT_DEDUP_TTL = 6 * 3600; // 6시간 중복 알람 방지

async function getKv() {
  try {
    const m = await import("@vercel/kv");
    if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) return null;
    return m.kv;
  } catch {
    return null;
  }
}

// ── 간단 지표 (외부 의존 없이 cron 안에서 평가) ──
function calcRSI(closes, period = 14) {
  if (!closes || closes.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff;
    else losses -= diff;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function calcSMA(arr, period) {
  if (!arr || arr.length < period) return null;
  const slice = arr.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function calcATR(highs, lows, closes, period = 14) {
  if (!highs || highs.length < period + 1) return null;
  const trs = [];
  for (let i = 1; i < highs.length; i++) {
    const h = highs[i], l = lows[i], pc = closes[i - 1];
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  return calcSMA(trs, period);
}

function calcBBLower(closes, period = 20, mult = 2) {
  if (!closes || closes.length < period) return null;
  const slice = closes.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((s, v) => s + (v - mean) ** 2, 0) / period;
  const std = Math.sqrt(variance);
  return mean - mult * std;
}

// ── Yahoo Finance OHLC fetch (cron 내 self-call 회피, 직접 호출) ──
async function fetchOHLC(symbol) {
  const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1y`;
    const r = await fetch(url, {
      headers: { "User-Agent": UA, "Accept": "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return null;
    const json = await r.json();
    const result = json?.chart?.result?.[0];
    if (!result) return null;
    const q = result.indicators?.quote?.[0] || {};
    const closes = [], highs = [], lows = [], volumes = [];
    const ts = result.timestamp || [];
    for (let i = 0; i < ts.length; i++) {
      if (q.close?.[i] == null) continue;
      closes.push(q.close[i]);
      highs.push(q.high?.[i] ?? q.close[i]);
      lows.push(q.low?.[i] ?? q.close[i]);
      volumes.push(q.volume?.[i] ?? 0);
    }
    if (closes.length < 50) return null;
    return { closes, highs, lows, volumes };
  } catch {
    return null;
  }
}

// ── 조건 평가 ──
function evaluateConditions(conditions, data) {
  const { closes, highs, lows, volumes } = data;
  const lastClose = closes[closes.length - 1];

  // RSI
  if (conditions.rsi) {
    const rsi = calcRSI(closes, 14);
    if (rsi == null) return false;
    if (!compare(rsi, conditions.rsi.op, conditions.rsi.value)) return false;
  }

  // Volume ratio (현재 / 20일 평균)
  if (conditions.volume_ratio) {
    const lastVol = volumes[volumes.length - 1];
    const avgVol = calcSMA(volumes, 20);
    if (!avgVol) return false;
    const ratio = lastVol / avgVol;
    if (!compare(ratio, conditions.volume_ratio.op, conditions.volume_ratio.value)) return false;
  }

  // MA50 < MA200
  if (conditions.ma_state === "ma50_below_ma200") {
    const ma50 = calcSMA(closes, 50);
    const ma200 = calcSMA(closes, 200);
    if (ma50 == null || ma200 == null) return false;
    if (ma50 >= ma200) return false;
  }

  // MA50 기울기 (지난 5일 변화율)
  if (conditions.ma50_slope) {
    if (closes.length < 56) return false;
    const ma50Now = calcSMA(closes, 50);
    const ma50Prev = calcSMA(closes.slice(0, -5), 50);
    if (ma50Prev == null || ma50Now == null) return false;
    const slope = (ma50Now - ma50Prev) / ma50Prev;
    if (!compare(slope, conditions.ma50_slope.op, conditions.ma50_slope.value)) return false;
  }

  // 볼린저밴드 하단 터치
  if (conditions.bb_position === "lower") {
    const bbLower = calcBBLower(closes);
    if (bbLower == null) return false;
    if (lastClose > bbLower) return false;
  }

  // ATR 비율
  if (conditions.atr_ratio) {
    const atrNow = calcATR(highs, lows, closes, 14);
    if (atrNow == null) return false;
    // ATR(14) 의 20-period SMA — 단순화 위해 ATR 만 비교 (전일 atr 대비)
    const atrPrev = calcATR(highs.slice(0, -20), lows.slice(0, -20), closes.slice(0, -20), 14);
    if (atrPrev == null) return false;
    const ratio = atrNow / atrPrev;
    if (!compare(ratio, conditions.atr_ratio.op, conditions.atr_ratio.value)) return false;
  }

  // 가격 변동률
  if (conditions.price_change_pct) {
    if (closes.length < 2) return false;
    const pct = ((lastClose - closes[closes.length - 2]) / closes[closes.length - 2]) * 100;
    if (!compare(pct, conditions.price_change_pct.op, conditions.price_change_pct.value)) return false;
  }

  return true;
}

function compare(value, op, target) {
  if (!isFinite(value) || !isFinite(target)) return false;
  switch (op) {
    case ">": return value > target;
    case ">=": return value >= target;
    case "<": return value < target;
    case "<=": return value <= target;
    case "=": case "==": return Math.abs(value - target) < 1e-9;
    default: return false;
  }
}

// ── 사용자별 처리 ──
async function processUser(kv, uid) {
  const screeners = (await kv.get(`di:saved-screeners:${uid}`)) || [];
  if (!Array.isArray(screeners) || screeners.length === 0) return { matched: 0 };

  const activeScreeners = screeners.filter(s => s.alert_enabled).slice(0, MAX_SCREENERS_PER_USER);
  if (!activeScreeners.length) return { matched: 0 };

  const prefs = await getPrefs(uid);
  const universe = SAMPLE_SYMBOLS; // 추후 사용자 watchlist 연동 가능

  // OHLC 한 번씩만 fetch (캐시)
  const dataCache = new Map();
  for (const sym of universe) {
    const data = await fetchOHLC(sym.symbol);
    if (data) dataCache.set(sym.symbol, { ...sym, data });
  }

  let matchedCount = 0;
  const updatedScreeners = [...screeners];

  for (const scr of activeScreeners) {
    const matches = [];
    for (const [sym, entry] of dataCache) {
      if (evaluateConditions(scr.conditions, entry.data)) {
        matches.push(sym);
      }
    }
    if (matches.length === 0) continue;

    // 중복 알람 방지
    const dedupKey = `di:screener-alert:last-match:${uid}:${scr.id}`;
    const lastSent = await kv.get(dedupKey);
    if (lastSent) continue;

    matchedCount += matches.length;

    // 알림 센터에 push
    await pushNotification(uid, {
      category: "screener",
      priority: "high",
      title: `🎯 "${scr.name}" 조건 매칭`,
      summary: `${matches.length}개 종목 일치: ${matches.slice(0, 3).join(", ")}${matches.length > 3 ? "…" : ""}`,
      link: "/saved-screeners",
    });

    // 텔레그램
    if (prefs.channels?.telegram) {
      const lines = [
        `🎯 <b>스크리너 매칭</b> — ${scr.name}`,
        `조건: ${summarizeConditions(scr.conditions)}`,
        `매칭 종목 (${matches.length}): ${matches.slice(0, 5).join(", ")}${matches.length > 5 ? "…" : ""}`,
        `→ zepta.app/saved-screeners`,
      ];
      await sendTelegram({ text: lines.join("\n") });
    }

    // 중복 방지 TTL
    await kv.set(dedupKey, Date.now(), { ex: ALERT_DEDUP_TTL });

    // 스크리너 last_matched_at 갱신
    const idx = updatedScreeners.findIndex(s => s.id === scr.id);
    if (idx >= 0) {
      updatedScreeners[idx] = {
        ...updatedScreeners[idx],
        last_matched_at: new Date().toISOString(),
        last_match_count: matches.length,
      };
    }
  }

  if (matchedCount > 0) {
    await kv.set(`di:saved-screeners:${uid}`, updatedScreeners, { ex: 365 * 24 * 60 * 60 });
  }

  return { matched: matchedCount };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const kv = await getKv();
  if (!kv) {
    return res.status(200).json({ ok: false, skipped: true, reason: "KV not configured" });
  }

  try {
    // 활성 사용자 목록
    const users = (await kv.get("di:saved-screeners:users")) || [];
    const list = Array.isArray(users) ? users.slice(0, MAX_USERS_PER_RUN) : [];

    let processed = 0;
    let totalMatched = 0;
    const errors = [];

    for (const uid of list) {
      try {
        const r = await processUser(kv, uid);
        totalMatched += r.matched;
        processed++;
      } catch (e) {
        errors.push({ uid, error: e.message });
      }
    }

    return res.status(200).json({
      ok: true,
      processed,
      totalUsers: list.length,
      totalMatched,
      errors: errors.slice(0, 5),
      ts: new Date().toISOString(),
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
