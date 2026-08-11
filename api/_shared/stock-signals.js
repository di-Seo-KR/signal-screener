// ════════════════════════════════════════════════════════════════════
// stock-signals — 주식 멀티TF 정보 시그널 공유 모듈 (표시 전용, 매매 무관)
// ────────────────────────────────────────────────────────────────────
// ★ 2026-08-11 (대표 지시 "코인 50개만 있고 주식은 없다"): 코인 풀
//   (di:signals:realtime-pool-mtf, api/btc-cron.js)과 동일 스키마의 주식 풀을
//   만들기 위한 유니버스·데이터 로드·TF 스코어링·종합 스코어 계산 모듈.
//
//   - 이 모듈은 *정보 표시 전용*입니다. 매매 엔진(btc-cron 거래 경로,
//     api/real-trading/*)은 이 모듈·이 풀을 일절 읽지 않습니다.
//   - 스코어는 "기술적 지표 종합"입니다 — 추세(EMA 배열·크로스)·모멘텀(RSI·MACD·
//     스토캐스틱)·거래량(OBV·거래량 서지)·변동성(ATR·BB) 팩터만 사용.
//     주식에는 펀딩비·온체인 데이터가 없으므로 코인 스코어의 해당 보정
//     (applyFuturesContext 등)은 존재하지 않습니다. 팩터별 가중치는
//     btc-cron 의 analyzeLatest(레짐 분기 tally)와 같은 계열로 맞췄습니다.
//   - 데이터: 야후 파이낸스 v8 chart API 를 서버에서 직접 호출
//     (api/yahoo.js 의 인증·호출 패턴 재사용). 2026-08-11 실측 curl 확인:
//     chart.result[0].timestamp + indicators.quote[0].{open,high,low,close,volume},
//     meta 에 marketState 없음 → currentTradingPeriod.regular 로 개장 여부 유도.
//   - TF 는 야후가 실제 제공하는 것만 정직하게: 1wk(주봉)·1d(일봉)·1h(1시간).
//     4h 는 야후에 없으므로 1h 완결 캔들을 거래일 단위 정방향 4개씩 묶어
//     집계합니다(아래 aggregate4h 주석 참조). 1h 부족 시 4h 없이 3TF 로 동작.
// ════════════════════════════════════════════════════════════════════

import {
  calcSMA, calcEMA, calcRSI, calcBB, calcMACD, calcADX, calcATR,
  calcStochastic, calcOBV, calcHurst, calcEfficiencyRatio,
  gradeConfidence, scaleScore, detectDivergence,
} from "./strategies/_indicators.js";
import { computeSRLevels } from "./sr-levels.js";

// ── 유니버스 — src/App.jsx fetchDailyPicks 의 pickList 와 동일(순서 포함) ──
//   "오늘의 종목 추천" 50종과 같은 목록을 서버측에 하드코딩. 이름은 App.jsx 의
//   US_ASSETS/KR_ASSETS 매핑에서 복사. (실측 51종 = 미국 31 + 한국 20 —
//   pickList 원본과 1:1 동일 유지가 우선이라 그대로 둡니다.)
export const STOCK_UNIVERSE = [
  { symbol: "NVDA", name: "NVIDIA", market: "us" },
  { symbol: "AAPL", name: "Apple", market: "us" },
  { symbol: "TSLA", name: "Tesla", market: "us" },
  { symbol: "MSFT", name: "Microsoft", market: "us" },
  { symbol: "GOOGL", name: "Alphabet", market: "us" },
  { symbol: "AMZN", name: "Amazon", market: "us" },
  { symbol: "META", name: "Meta", market: "us" },
  { symbol: "AMD", name: "AMD", market: "us" },
  { symbol: "AVGO", name: "Broadcom", market: "us" },
  { symbol: "COIN", name: "Coinbase", market: "us" },
  { symbol: "NFLX", name: "Netflix", market: "us" },
  { symbol: "CRM", name: "Salesforce", market: "us" },
  { symbol: "PLTR", name: "Palantir", market: "us" },
  { symbol: "MSTR", name: "MicroStrategy", market: "us" },
  { symbol: "SOFI", name: "SoFi", market: "us" },
  { symbol: "HOOD", name: "Robinhood", market: "us" },
  { symbol: "ARM", name: "ARM Holdings", market: "us" },
  { symbol: "SMCI", name: "Super Micro", market: "us" },
  { symbol: "TSM", name: "TSMC", market: "us" },
  { symbol: "APP", name: "AppLovin", market: "us" },
  { symbol: "RDDT", name: "Reddit", market: "us" },
  { symbol: "BABA", name: "Alibaba", market: "us" },
  { symbol: "JPM", name: "JPMorgan", market: "us" },
  { symbol: "LLY", name: "Eli Lilly", market: "us" },
  { symbol: "BA", name: "Boeing", market: "us" },
  { symbol: "DIS", name: "Disney", market: "us" },
  { symbol: "IONQ", name: "IonQ", market: "us" },
  { symbol: "CPNG", name: "Coupang", market: "us" },
  { symbol: "SHOP", name: "Shopify", market: "us" },
  { symbol: "CRWD", name: "CrowdStrike", market: "us" },
  { symbol: "BITX", name: "BTC 2x 레버리지", market: "us" },
  { symbol: "005930.KS", name: "삼성전자", market: "kr" },
  { symbol: "000660.KS", name: "SK하이닉스", market: "kr" },
  { symbol: "035420.KS", name: "NAVER", market: "kr" },
  { symbol: "068270.KS", name: "셀트리온", market: "kr" },
  { symbol: "373220.KS", name: "LG에너지솔루션", market: "kr" },
  { symbol: "005380.KS", name: "현대차", market: "kr" },
  { symbol: "000270.KS", name: "기아", market: "kr" },
  { symbol: "035720.KS", name: "카카오", market: "kr" },
  { symbol: "051910.KS", name: "LG화학", market: "kr" },
  { symbol: "006400.KS", name: "삼성SDI", market: "kr" },
  { symbol: "207940.KS", name: "삼성바이오로직스", market: "kr" },
  { symbol: "259960.KS", name: "크래프톤", market: "kr" },
  { symbol: "352820.KS", name: "하이브", market: "kr" },
  { symbol: "105560.KS", name: "KB금융", market: "kr" },
  { symbol: "055550.KS", name: "신한지주", market: "kr" },
  { symbol: "042660.KS", name: "한화오션", market: "kr" },
  { symbol: "329180.KS", name: "HD현대중공업", market: "kr" },
  { symbol: "009540.KS", name: "HD한국조선해양", market: "kr" },
  { symbol: "196170.KQ", name: "알테오젠", market: "kr" },
  { symbol: "042700.KS", name: "한미반도체", market: "kr" },
];

// TF 가중치 — 코인 종합 스코어(btc-cron, 대표 지시 2026-06-03)와 동일:
//   주 0.30 · 일 0.25 · 4h 0.25 · 1h 0.20 (부호 가중합 → 합의 시 점수↑, 갈리면 상쇄)
export const TF_WEIGHTS = { "1w": 0.30, "1d": 0.25, "4h": 0.25, "1h": 0.20 };

// ════════════════════════════════════════════════════════
// 야후 차트 API 호출 — api/yahoo.js 의 인증(cookie+crumb)·헤더·host 폴백 패턴 재사용
// ════════════════════════════════════════════════════════
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

let _cookie = null;
let _crumb = null;
let _expires = 0;

async function getYahooAuth() {
  const now = Date.now();
  if (_cookie && _crumb && now < _expires) return { cookie: _cookie, crumb: _crumb };

  let cookies = "";
  try {
    const r1 = await fetch("https://fc.yahoo.com", { redirect: "manual", headers: { "User-Agent": UA } });
    cookies = r1.headers.get("set-cookie") || "";
  } catch {}
  if (!cookies) {
    try {
      const r2 = await fetch("https://finance.yahoo.com/", { redirect: "manual", headers: { "User-Agent": UA } });
      cookies = r2.headers.get("set-cookie") || "";
    } catch {}
  }

  for (const host of ["query2.finance.yahoo.com", "query1.finance.yahoo.com"]) {
    try {
      const crumbRes = await fetch(`https://${host}/v1/test/getcrumb`, {
        headers: { "User-Agent": UA, "Cookie": cookies },
      });
      if (crumbRes.ok) {
        const crumb = await crumbRes.text();
        _cookie = cookies; _crumb = crumb; _expires = now + 8 * 60 * 1000;
        return { cookie: _cookie, crumb: _crumb };
      }
    } catch {}
  }
  // 2026-08-11 실측: v8 chart 는 crumb 없이도 응답함 — 인증 실패 시 crumb 없이 진행(폴백)
  return { cookie: cookies, crumb: "" };
}

// 단일 심볼 차트 1회 호출 (yahoo.js fetchOne 패턴 — host 폴백 + 타임아웃)
async function fetchChartJson(symbol, interval, range, auth) {
  for (const host of ["query2.finance.yahoo.com", "query1.finance.yahoo.com"]) {
    const crumbQ = auth.crumb ? `&crumb=${encodeURIComponent(auth.crumb)}` : "";
    const url = `https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}${crumbQ}&includePrePost=false`;
    try {
      const r = await fetch(url, {
        headers: { "User-Agent": UA, "Accept": "application/json", "Cookie": auth.cookie || "" },
        signal: AbortSignal.timeout(8000),
      });
      if (r.ok) return r.json();
    } catch {}
  }
  return null;
}

// v8 chart JSON → 캔들 배열 (yahoo.js parseCandles 와 동일 규칙: close 없는 봉 스킵)
function parseChartCandles(json) {
  const result = json?.chart?.result?.[0];
  if (!result) return null;
  const timestamps = result.timestamp || [];
  const q = result.indicators?.quote?.[0] || {};
  const { open = [], high = [], low = [], close = [], volume = [] } = q;
  const candles = [];
  for (let i = 0; i < timestamps.length; i++) {
    if (close[i] == null) continue;
    candles.push({
      time: timestamps[i],
      open: open[i] != null ? open[i] : close[i],
      high: high[i] != null ? high[i] : close[i],
      low: low[i] != null ? low[i] : close[i],
      close: close[i],
      volume: volume[i] || 0,
    });
  }
  return candles;
}

// 개장 여부 유도 — chart meta 에는 marketState 필드가 없음(실측).
//   currentTradingPeriod.regular {start,end} 와 현재 시각 비교로 정직하게 판정.
//   판정 불가면 null (지어내지 않음).
function deriveMarketState(json) {
  const reg = json?.chart?.result?.[0]?.meta?.currentTradingPeriod?.regular;
  if (!reg || !Number.isFinite(reg.start) || !Number.isFinite(reg.end)) return null;
  const now = Date.now() / 1000;
  return now >= reg.start && now < reg.end ? "REGULAR" : "CLOSED";
}

// ════════════════════════════════════════════════════════
// 4h 집계 — 야후에 4h interval 이 없어 1h 완결 캔들로 합성
// ────────────────────────────────────────────────────────
// 집계 규칙(명시): *거래일(UTC 날짜) 단위로 세션 시작부터 정방향* 4봉씩 한 묶음 →
//   { time: 묶음 첫 캔들 time, open: 첫 open, high: max(high), low: min(low),
//     close: 마지막 close, volume: volume 합 }.
//   - 달력 4시간 정렬(00/04/08시…)이 아니라 *거래시간 기준* 연속 4봉입니다.
//     미국 정규장 13:30~21:00 UTC · 한국 00:00~06:30 UTC 모두 UTC 자정을 넘지
//     않으므로 캔들의 UTC 날짜가 곧 거래일 — 날짜 경계는 절대 기준이라
//     새 1h 봉이 생겨도 과거 4h 봉의 구성이 밀리지 않습니다(런 간 안정,
//     리페인팅 아티팩트 방지). ※ 이전 구현(최신부터 역방향 묶기)은 새 1h 봉마다
//     과거 봉 경계가 1봉씩 밀려 4h 지표가 런 간 요동하는 문제가 있어 교체.
//   - 거래일 말미의 4개 미만 잔여 묶음 처리(정직 고지):
//     · 과거 거래일(세션 마감 확정) — 짧은 봉(1~3봉 집계)으로 유지. 정규장
//       6.5시간 = 1h 봉 약 7개라 매일 잔여가 생기는데, 이를 버리면 오후장
//       데이터가 통째로 빠져 더 큰 왜곡이므로 짧은 봉으로 보존합니다.
//     · 마지막(최신) 거래일 — 장중이면 아직 형성 중일 수 있어 버림(리페인팅
//       방지). 마감 후에도 동일하게 버려 런 간 결과가 항상 같게 유지합니다
//       (해당 말미 정보는 1h·1d TF 가 커버).
// ════════════════════════════════════════════════════════
export function aggregate4h(candles1h) {
  if (!Array.isArray(candles1h) || candles1h.length < 4) return [];
  // 거래일(UTC 날짜)별 그룹 — 날짜 경계가 절대 앵커라 런 간 안정
  const days = [];
  let curDay = null, curKey = null;
  for (const c of candles1h) {
    const key = new Date(c.time * 1000).toISOString().slice(0, 10);
    if (key !== curKey) { curDay = []; days.push(curDay); curKey = key; }
    curDay.push(c);
  }
  const out = [];
  for (let d = 0; d < days.length; d++) {
    const bars = days[d];
    for (let i = 0; i < bars.length; i += 4) {
      const grp = bars.slice(i, i + 4);
      // 최신 거래일의 4개 미만 잔여 묶음은 형성 중일 수 있어 버림(위 주석 참조)
      if (grp.length < 4 && d === days.length - 1) break;
      out.push({
        time: grp[0].time,
        open: grp[0].open,
        high: Math.max(...grp.map((c) => c.high)),
        low: Math.min(...grp.map((c) => c.low)),
        close: grp[grp.length - 1].close,
        volume: grp.reduce((s, c) => s + (c.volume || 0), 0),
      });
    }
  }
  return out;
}

// ════════════════════════════════════════════════════════
// TF별 0~100 스코어 — btc-cron analyzeLatest 의 레짐 분기 tally 와 같은 계열.
// ────────────────────────────────────────────────────────
// 코인 대비 제외한 팩터(주식에 실데이터가 없거나 크립토 전용): FNG 센티먼트,
//   market-monitor 알림 부스트, 캔들패턴 융합(크립토 캘리브레이션), 펀딩·OI·
//   베이시스·온체인. 나머지 순수 기술적 팩터는 btc-cron 과 동일 가중치:
//   [TRENDING]    EMA21/55 배열 ±3 · 골든/데드크로스 ±3 · RSI(MACD 확인) ±1~2 ·
//                 MACD 방향 ±1 · 히스토그램 가속 ±1 · 20봉 고/저점 돌파 ±2 · Hurst ±1
//   [MEAN_REVERT] RSI 역추세 ±1~3 · BB 상/하단 ±1~2 · 스토캐스틱 크로스 ±1~2 ·
//                 Hurst 회귀 ±1 · RSI 다이버전스 ±2
//   [공통]        ER 가속 ±2 · ATR 폭발 ±1 · 거래량+OBV(스마트머니) ±2 · EMA200 ±1
// 점수 변환도 공유 규칙 재사용: scaleScore(|net|) → 0~100, gradeConfidence → A/B/C.
// ════════════════════════════════════════════════════════
export function scoreStockTF({ closes, highs, lows, volumes }, tf = "1d") {
  if (!Array.isArray(closes) || closes.length < 62) return null; // 코인 sigForTF 와 동일 최소 봉 수
  const L = closes.length - 1;
  const price = closes[L];
  const prev = closes[L - 1];
  if (!(price > 0) || !(prev > 0)) return null;

  // 지표 — btc-cron 과 동일 파라미터 (공유 라이브러리 재사용)
  const rsi = calcRSI(closes, 14);
  const bb = calcBB(closes, 20, 2.0);
  const ema21 = calcEMA(closes, 21);
  const ema55 = calcEMA(closes, 55);
  const ema200 = closes.length > 200 ? calcEMA(closes, 200) : [];
  const { macdLine, signal: macdSig, histogram } = calcMACD(closes);
  const adx = calcADX(highs, lows, closes, 14);
  const atr = calcATR(highs, lows, closes, 14);
  const stoch = calcStochastic(highs, lows, closes, 14, 3);
  const obv = calcOBV(closes, volumes);
  const obvEma = calcEMA(obv, 20);
  const volSMA = calcSMA(volumes, 20);
  if (rsi[L] == null || ema21[L] == null || ema55[L] == null || macdLine[L] == null || macdSig[L] == null) return null;

  // 레짐 판별 — btc-cron STEP2 동일 (ADX>25 / Hurst>0.55 / ER>0.4 중 2개 이상 = 추세)
  const curADX = adx[L] || 20;
  const hurst = calcHurst(closes.slice(-100));
  const er = calcEfficiencyRatio(closes, 10);
  const curER = er[er.length - 1] || 0;
  const trendCount = [curADX > 25, hurst > 0.55, curER > 0.4].filter(Boolean).length;
  const regime = trendCount >= 2 ? "TRENDING" : "MEAN_REVERT";

  const reasons = [`[${regime}] ADX${curADX.toFixed(0)} H${hurst.toFixed(2)}`];
  let buyScore = 0, sellScore = 0;

  if (regime === "TRENDING") {
    // EMA 정/역배열 (±3)
    if (ema21[L] > ema55[L]) { buyScore += 3; reasons.push("EMA정배열"); }
    else { sellScore += 3; reasons.push("EMA역배열"); }
    // 골든/데드 크로스 당봉 발생 (±3)
    if (ema21[L] > ema55[L] && ema21[L - 1] != null && ema55[L - 1] != null && ema21[L - 1] <= ema55[L - 1]) { buyScore += 3; reasons.push("골든크로스"); }
    if (ema21[L] < ema55[L] && ema21[L - 1] != null && ema55[L - 1] != null && ema21[L - 1] >= ema55[L - 1]) { sellScore += 3; reasons.push("데드크로스"); }
    // RSI 모멘텀 (MACD/EMA 확인 필수, ±1~2)
    if (rsi[L] > 70 && macdLine[L] > macdSig[L] && ema21[L] > ema55[L]) { buyScore += 2; reasons.push(`RSI${rsi[L].toFixed(0)} 강세`); }
    else if (rsi[L] > 55 && macdLine[L] > macdSig[L]) { buyScore += 1; reasons.push(`RSI${rsi[L].toFixed(0)} 상승`); }
    else if (rsi[L] < 30 && macdLine[L] < macdSig[L]) { sellScore += 2; reasons.push(`RSI${rsi[L].toFixed(0)} 약세`); }
    else if (rsi[L] < 45 && macdLine[L] < macdSig[L]) { sellScore += 1; reasons.push(`RSI${rsi[L].toFixed(0)} 하락`); }
    // MACD 방향(±1) + 히스토그램 가속(±1)
    if (macdLine[L] > macdSig[L]) { buyScore += 1; reasons.push("MACD↑"); }
    else { sellScore += 1; reasons.push("MACD↓"); }
    if (histogram[L] != null && histogram[L - 1] != null) {
      if (histogram[L] > 0 && histogram[L] > histogram[L - 1]) { buyScore += 1; reasons.push("MACD가속↑"); }
      if (histogram[L] < 0 && histogram[L] < histogram[L - 1]) { sellScore += 1; reasons.push("MACD가속↓"); }
    }
    // 20봉 고점/저점 돌파 (±2)
    const high20 = Math.max(...highs.slice(-20));
    const low20 = Math.min(...lows.slice(-20));
    if (price >= high20 * 0.99) { buyScore += 2; reasons.push("20봉고점돌파"); }
    if (price <= low20 * 1.01) { sellScore += 2; reasons.push("20봉저점이탈"); }
    // Hurst 추세 지속 (±1)
    if (hurst > 0.55) {
      if (price > prev) { buyScore += 1; reasons.push("Hurst추세↑"); }
      else { sellScore += 1; reasons.push("Hurst추세↓"); }
    }
  } else {
    // MEAN_REVERT — RSI 역추세 (BB 확인, ±1~3)
    const bbLower = bb[L] ? bb[L].lower : null;
    const bbTouched = bbLower != null && price <= bbLower * 1.02;
    const priceBouncing = closes[L - 2] != null && price > closes[L - 2];
    if (rsi[L] < 30 && (bbTouched || priceBouncing)) { buyScore += 3; reasons.push(`RSI${rsi[L].toFixed(0)} 과매도`); }
    else if (rsi[L] < 40 && rsi[L - 1] != null && rsi[L] > rsi[L - 1] && priceBouncing) { buyScore += 2; reasons.push(`RSI${rsi[L].toFixed(0)} 반등`); }
    else if (rsi[L] < 45) { buyScore += 1; reasons.push(`RSI${rsi[L].toFixed(0)} 매수권`); }
    if (rsi[L] > 70) { sellScore += 3; reasons.push(`RSI${rsi[L].toFixed(0)} 과매수`); }
    else if (rsi[L] > 60 && rsi[L - 1] != null && rsi[L] < rsi[L - 1]) { sellScore += 2; reasons.push(`RSI${rsi[L].toFixed(0)} 꺾임`); }
    else if (rsi[L] > 55) { sellScore += 1; reasons.push(`RSI${rsi[L].toFixed(0)} 매도권`); }
    // 볼린저 밴드 (±1~2)
    if (bb[L]) {
      if (price <= bb[L].lower * 1.02) { buyScore += 2; reasons.push("BB하단접근"); }
      else if (price <= bb[L].lower * 1.05) { buyScore += 1; reasons.push("BB하단근처"); }
      if (price >= bb[L].upper * 0.98) { sellScore += 2; reasons.push("BB상단접근"); }
      else if (price >= bb[L].upper * 0.95) { sellScore += 1; reasons.push("BB상단근처"); }
    }
    // 스토캐스틱 %K/%D 크로스 (±1~2) — 공유 라이브러리는 {k[],d[]} 배열 반환
    const curK = stoch.k[L], curD = stoch.d[L], prevK = stoch.k[L - 1], prevD = stoch.d[L - 1];
    if (curK != null && curD != null && prevK != null && prevD != null) {
      if (curK < 25 && curK > curD && prevK <= prevD) { buyScore += 2; reasons.push("Stoch골든"); }
      if (curK > 75 && curK < curD && prevK >= prevD) { sellScore += 2; reasons.push("Stoch데드"); }
      if (curK < 30) { buyScore += 1; reasons.push("Stoch과매도"); }
      if (curK > 70) { sellScore += 1; reasons.push("Stoch과매수"); }
    }
    // Hurst 회귀 확인 (±1)
    if (hurst < 0.45) {
      if (rsi[L] < 45) { buyScore += 1; reasons.push("Hurst회귀→매수"); }
      if (rsi[L] > 55) { sellScore += 1; reasons.push("Hurst회귀→매도"); }
    }
    // RSI 다이버전스 (±2) — 공유 detectDivergence 재사용
    const div = detectDivergence(closes, rsi, L, 15);
    if (div.bullish) { buyScore += 2; reasons.push("강세다이버전스"); }
    if (div.bearish) { sellScore += 2; reasons.push("약세다이버전스"); }
  }

  // ── 공통 알파 레이어 (레짐 무관 — btc-cron STEP4 동일 가중) ──
  // ER 급변 = 추세 탄생/소멸 (±2)
  const prevER = ((er[er.length - 2] || 0) + (er[er.length - 3] || 0) + (er[er.length - 4] || 0)) / 3;
  if (curER - prevER > 0.15 && closes[L - 5] != null) {
    if (price > closes[L - 5]) { buyScore += 2; reasons.push("ER가속↑"); }
    else { sellScore += 2; reasons.push("ER가속↓"); }
  }
  // ATR 폭발 (±1)
  const atrVal = atr[L] || 0;
  const atrLongMA = calcSMA(atr.map((v) => v || 0), 50);
  const atrBase = atrLongMA[atrLongMA.length - 1];
  if (atrVal > 0 && atrBase > 0 && atrVal / atrBase > 1.5) {
    if (price > prev) { buyScore += 1; reasons.push("ATR폭발↑"); }
    else { sellScore += 1; reasons.push("ATR폭발↓"); }
  }
  // 스마트머니 (거래량 서지 + OBV 방향, ±2)
  const volAvg = volSMA[L] || 0;
  const volSurge = volAvg > 0 && volumes[L] > volAvg * 1.5;
  const obvUp = obv[L] > (obvEma[obvEma.length - 1] || 0);
  if (volSurge && obvUp && price > prev) { buyScore += 2; reasons.push("거래량매집"); }
  if (volSurge && !obvUp && price < prev) { sellScore += 2; reasons.push("거래량분산"); }
  // EMA200 장기 추세 (±1)
  if (ema200.length > 0 && ema200[L] != null) {
    if (price > ema200[L]) { buyScore += 1; reasons.push("EMA200위"); }
    else { sellScore += 1; reasons.push("EMA200아래"); }
  }

  // ── 판정 — btc-cron STEP6 동일 (노이즈 필터 + net 부호) ──
  const net = buyScore - sellScore;
  const absNet = Math.abs(net);
  if (Math.max(buyScore, sellScore) < 2) return null; // 최소 확신 미달
  let type;
  if (net > 0) type = "BUY";
  else if (net < 0) type = "SELL";
  else {
    // 동점: 코인은 FNG(크립토 전용 센티먼트)로 방향을 정했지만 주식엔 해당 실데이터가
    // 없음 → 추세장만 EMA 방향(btc-cron 동일 규칙), 횡보장 동점은 신호 없음(지어내지 않음).
    if (regime === "TRENDING" && ema21[L] !== ema55[L]) type = ema21[L] > ema55[L] ? "BUY" : "SELL";
    else return null;
  }
  return {
    type,
    side: type === "BUY" ? "LONG" : "SHORT",
    score: scaleScore(absNet),            // 0~100 정규화 — 코인 전략 공통 규칙 재사용
    confidence: gradeConfidence(absNet),  // A/B/C — 코인 공통 규칙 재사용
    timeframe: tf,
    family: "stock-ta",                   // 기술적 지표 종합(펀딩·온체인 미포함) 표식
    reason: reasons.join("+").slice(0, 160),
  };
}

// ════════════════════════════════════════════════════════
// 심볼 1개 스캔 → 코인 풀(realtime-pool-mtf)과 동일 스키마의 엔트리 생성
// ────────────────────────────────────────────────────────
// 완결봉 정책(코인 btc-cron 과 동일 계열):
//   1w — 마지막(형성 중인 이번 주) 봉 제외, 1h/4h — 개장 중이면 형성 중 마지막 봉
//   제외(리페인팅 방지), 1d — 진행봉 포함(코인 sig1d 경로와 동일, 반응성 보존).
// 반환: { entry, marketState } | null (일봉 데이터 부족 등 스캔 불가 시 null)
// ════════════════════════════════════════════════════════
export async function scanStockSymbol({ symbol, name, market }) {
  const auth = await getYahooAuth();
  // TF별 병렬 로드 — 야후가 실제 제공하는 interval 만 (1wk/1d/1h)
  const [rW, rD, rH] = await Promise.allSettled([
    fetchChartJson(symbol, "1wk", "2y", auth),
    fetchChartJson(symbol, "1d", "1y", auth),
    fetchChartJson(symbol, "1h", "3mo", auth),
  ]);
  const jsonW = rW.status === "fulfilled" ? rW.value : null;
  const jsonD = rD.status === "fulfilled" ? rD.value : null;
  const jsonH = rH.status === "fulfilled" ? rH.value : null;

  const candles1d = jsonD ? parseChartCandles(jsonD) : null;
  if (!candles1d || candles1d.length < 62) return null; // 일봉은 필수(스코어+지지저항 기준)

  const marketState = deriveMarketState(jsonD) ?? deriveMarketState(jsonH) ?? null;
  const marketOpen = marketState === "REGULAR";

  let candles1w = jsonW ? parseChartCandles(jsonW) : null;
  if (candles1w && candles1w.length > 1) candles1w = candles1w.slice(0, -1); // 형성 중인 이번 주 봉 제외

  let candles1h = jsonH ? parseChartCandles(jsonH) : null;
  if (candles1h && candles1h.length > 1 && marketOpen) candles1h = candles1h.slice(0, -1); // 형성 중 봉 제외
  const candles4h = candles1h ? aggregate4h(candles1h) : [];

  const toArrays = (cs) => ({
    closes: cs.map((c) => c.close),
    highs: cs.map((c) => c.high),
    lows: cs.map((c) => c.low),
    volumes: cs.map((c) => c.volume || 0),
  });

  const sigW = candles1w && candles1w.length >= 62 ? scoreStockTF(toArrays(candles1w), "1w") : null;
  const sigD = scoreStockTF(toArrays(candles1d), "1d");
  const sig4 = candles4h.length >= 62 ? scoreStockTF(toArrays(candles4h), "4h") : null;
  const sig1 = candles1h && candles1h.length >= 62 ? scoreStockTF(toArrays(candles1h), "1h") : null;

  // ── 종합 — btc-cron compositeSignal 과 동일 공식(부호 가중합, 임계 ±0.5) ──
  const signed = (s) => (!s ? 0 : (s.type === "BUY" ? 1 : s.type === "SELL" ? -1 : 0) * (parseFloat(s.score) || 0));
  const raw = TF_WEIGHTS["1w"] * signed(sigW) + TF_WEIGHTS["1d"] * signed(sigD)
    + TF_WEIGHTS["4h"] * signed(sig4) + TF_WEIGHTS["1h"] * signed(sig1);
  const compScore = Math.round(Math.min(100, Math.abs(raw)));
  const compType = raw > 0.5 ? "BUY" : raw < -0.5 ? "SELL" : null;
  if (!compType) return { entry: null, marketState }; // 방향 합의 없음 — 코인 풀과 동일하게 미적재

  const tfTag = (s) => (!s ? "—" : `${s.type === "BUY" ? "롱" : "숏"}${Math.round(s.score)}`);
  const breakdown = {
    "1w": sigW ? { type: sigW.type, score: Math.round(sigW.score) } : null,
    "1d": sigD ? { type: sigD.type, score: Math.round(sigD.score) } : null,
    "4h": sig4 ? { type: sig4.type, score: Math.round(sig4.score) } : null,
    "1h": sig1 ? { type: sig1.type, score: Math.round(sig1.score) } : null,
  };

  // 지지·저항 — 코인과 동일 공유 모듈에 일봉 캔들 전달 (표시 전용, 실패해도 null)
  let sr = null;
  try {
    sr = computeSRLevels(candles1d, candles1d[candles1d.length - 1]?.close);
  } catch { sr = null; }

  // 데이터 시각(dataTs) — 스캔 시각(ts)과 분리한 정직 표기. 마감 시장을 재스캔하는
  // 엣지 런에서는 데이터가 그대로인데 ts 만 갱신되므로, 스코어에 실제 반영된
  // 캔들 중 가장 최신 캔들의 시각(ms)을 별도 필드로 남깁니다. 형성 중 봉을
  // 제외한 뒤의 배열 기준(실제 사용 데이터와 일치). 산출 불가 시 null.
  const lastCandleTime = (cs) => (Array.isArray(cs) && cs.length > 0 ? cs[cs.length - 1].time : 0);
  const dataTsSec = Math.max(lastCandleTime(candles1d), lastCandleTime(candles1h), lastCandleTime(candles1w));
  const dataTs = Number.isFinite(dataTsSec) && dataTsSec > 0 ? dataTsSec * 1000 : null;

  // 코인 풀(newMtfEntries) 필드명 통일 + 주식 식별 필드(symbol/name/market) 추가
  const entry = {
    ts: Date.now(),
    time: new Date().toISOString(),
    dataTs,                      // 데이터 시각(ms) — 마지막 반영 캔들 기준, ts(스캔 시각)와 분리
    asset: symbol,               // 코인 풀의 asset 위치 — 주식은 티커 그대로
    symbol,
    name,
    market,                      // "us" | "kr"
    type: compType,
    side: compType === "BUY" ? "LONG" : "SHORT",
    score: compScore,
    confidence: compScore >= 80 ? "A" : compScore >= 60 ? "B" : "C",
    family: "composite",
    timeframe: "MTF",
    breakdown,
    reason: `종합 ${compScore} (주${tfTag(sigW)}·일${tfTag(sigD)}·4h${tfTag(sig4)}·1h${tfTag(sig1)}) — 기술적 지표 종합`,
    source: "stock-signals-cron",
    sr,
    marketState,                 // "REGULAR" | "CLOSED" | null — 장 마감 후엔 마지막 데이터 기준 유지(정직 표기)
  };
  return { entry, marketState };
}
