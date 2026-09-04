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
//
// ★ 2026-08-13 (대표 지시 "51종밖에 지원 안 하는데 전 종목"): 유니버스를 51종 →
//   1,016종으로 확대하면서 이 모듈에 3가지를 추가했습니다.
//     ① 유니버스 데이터 분리(_shared/stock-universe.js) — 여기서 재수출
//     ② 호출 통계(readFetchStats) + 429 백오프 — 레이트리밋을 추정이 아니라 실측으로
//     ③ scanStockSymbol 반환에 status — "호출 실패"와 "상장 초기 봉 부족"을 구분
//     ④ (리뷰 수리) 인증 경로 방어 — 타임아웃 5초 + in-flight 중복 제거 + 실패 쿨다운.
//        동시성이 12로 올라가면서 콜드 스타트에 인증 요청이 최대 36건 동시 발사되고,
//        그중 하나라도 무한정 매달리면 크론이 커서를 저장하지 못한 채 강제 종료됩니다.
// ════════════════════════════════════════════════════════════════════

import {
  calcSMA, calcEMA, calcRSI, calcBB, calcMACD, calcADX, calcATR,
  calcStochastic, calcOBV, calcHurst, calcEfficiencyRatio,
  gradeConfidence, scaleScore, detectDivergence,
} from "./strategies/_indicators.js";
import { computeSRLevels } from "./sr-levels.js";

// ── 유니버스 ──
//   ★ 2026-08-13 (대표 지시 "51종밖에 지원 안 하는데 전 종목"): 51종 → 1,016종.
//   목록 자체는 정적 데이터라 리뷰 단위를 분리하려고 _shared/stock-universe.js 로
//   옮겼습니다(등재 근거·검증 방법은 그 파일 헤더에 기록). 기존 import 경로
//   (`from "./_shared/stock-signals.js"`)를 깨지 않도록 여기서 그대로 재수출합니다.
export { STOCK_UNIVERSE } from "./stock-universe.js";

// 스코어 산출 최소 봉 수 — scoreStockTF 의 하한과 동일 상수를 크론이 재사용합니다
// (상장 직후 종목을 호출 없이 걸러내는 판정에 사용).
export const MIN_BARS = 62;

// ★ 2026-09-04 (대표 제보 "주식 풀에 SPCX 가 없네"): 신규상장 부분 커버리지 하한.
//   기존엔 일봉 62개 미만이면 전면 스킵 → SPCX(2026-06-12 상장, 거래일 ~58개)처럼
//   인기 신규상장이 62봉 찰 때까지 몇 주간 보드에서 아예 안 보였습니다.
//   일봉 25~61개 구간은 스킵 대신 *부분 산출* 합니다: 1d/1w 신호는 결측(null) 처리하되
//   1h(3mo 범위 → 봉 수 충분)·4h 중심으로 종합 — 기존 결측 희석(coverage/covAdjScore)
//   아키텍처가 그대로 정직하게 반영하고, reason 의 "일—·주—" 표기로 투명 노출됩니다.
//   25개 미만(상장 ~5주 미만)은 극초기 변동성·표본 부족으로 기존대로 스킵.
export const NEW_LISTING_MIN_BARS = 25;

// 상장 직후라 아직 일봉이 NEW_LISTING_MIN_BARS 개도 안 쌓인 종목인지 — 야후 호출 0회로 판정.
//   거래일 수 ≤ 평일 수 이므로 "평일 수 < 하한" 이면 봉 수 부족이 *확정*입니다
//   (휴장일을 몰라도 안전한 하한 판정 — 반대로 평일이 충분하면 실제 스캔이
//   최종 판정을 하므로 종목이 영구히 누락될 일은 없습니다).
//   ★ 2026-09-04: 판정 기준 MIN_BARS(62) → NEW_LISTING_MIN_BARS(25) — 부분 커버리지
//   대상(일봉 25~61개)이 호출 전에 걸러지지 않도록 하한만 낮춥니다.
export function isTooNewToScore(listedAt, now = Date.now()) {
  if (!listedAt) return false;
  const t0 = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(t0)) return false;   // 형식 이상 — 스캔에서 최종 판정
  if (t0 > now) return true;                // 상장 예정
  const days = Math.floor((now - t0) / 86400000);
  if (days >= NEW_LISTING_MIN_BARS * 2) return false; // 평일만 세도 확실히 충분 — 루프 생략
  let weekdays = 0;
  for (let i = 0; i <= days; i++) {
    const d = new Date(t0 + i * 86400000).getUTCDay();
    if (d !== 0 && d !== 6) weekdays++;
  }
  return weekdays < NEW_LISTING_MIN_BARS;
}

// TF 가중치 — 코인 종합 스코어(btc-cron, 대표 지시 2026-06-03)와 동일:
//   주 0.30 · 일 0.25 · 4h 0.25 · 1h 0.20 (부호 가중합 → 합의 시 점수↑, 갈리면 상쇄)
export const TF_WEIGHTS = { "1w": 0.30, "1d": 0.25, "4h": 0.25, "1h": 0.20 };

// ════════════════════════════════════════════════════════
// 야후 차트 API 호출 — api/yahoo.js 의 인증(cookie+crumb)·헤더·host 폴백 패턴 재사용
// ════════════════════════════════════════════════════════
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// ── 호출 통계 (레이트리밋 관측용) ──
//   유니버스가 1,000종대로 커지면서 "야후가 실제로 조여오는가"를 눈으로 봐야
//   합니다. 크론이 런 단위로 읽어 응답에 그대로 실어 정직하게 보고합니다.
//   (지어낸 안전 마진 대신 실측 429 카운트로 판단하기 위한 계기판)
//   ★ 2026-08-13 리뷰 수리 — 필드별 집계 대상을 분리해 정직하게 표기합니다.
//     · calls / ok / r404 / other / err / retried — v8 chart 호출만
//     · auth / authOk / authErr — 인증 플로우(fc.yahoo.com·finance.yahoo.com·getcrumb)만.
//       authOk 는 "응답이 도착함" 기준입니다. fc.yahoo.com 은 3xx·404 로도 쿠키를 주므로
//       HTTP 상태로 성공을 판정하지 않습니다(지어낸 성공률 대신 도착 여부만 셉니다).
//     · r429 — 두 경로 합산. 레이트리밋은 경로를 가리지 않고, 크론의 적응 백오프가
//       인증 429 도 보고 반응해야 하기 때문입니다.
//     이전에는 인증 호출이 어디에도 안 잡혀 대표 보고용 yahoo 지표에서 보이지 않았습니다.
const _stats = { calls: 0, ok: 0, r429: 0, r404: 0, other: 0, err: 0, retried: 0, auth: 0, authOk: 0, authErr: 0 };
export function readFetchStats() { return { ..._stats }; }
export function resetFetchStats() { for (const k of Object.keys(_stats)) _stats[k] = 0; }

let _cookie = null;
let _crumb = null;
let _expires = 0;
//   ★ 2026-08-13 리뷰 수리 ① 타임아웃: 인증 요청에는 타임아웃이 없어서, 야후 인증
//     엔드포인트가 지연되면 undici 기본 헤더 타임아웃(300초)까지 워커가 묶입니다.
//     그러면 크론이 maxDuration 300초를 태우고 강제 종료돼 **커서 저장까지 날아가**
//     분할 스캔이 그 런 동안 전혀 전진하지 못합니다(차트 호출은 8초 타임아웃이
//     있는데 인증 경로만 무방비였음).
//     인증 플로우는 최대 4요청(fc → finance 폴백 → crumb 호스트 2개)이 순차라
//     최악 지연이 4×5초 = 20초로 묶입니다(스텁 검증 실측 20.0초). 210초 예산 안이고,
//     아래 in-flight 공유 덕분에 런당 1회만 발생합니다.
const AUTH_TIMEOUT_MS = 5000;
//   ★ 리뷰 수리 ② in-flight 중복 제거: 콜드 스타트 시점엔 워커 12개가 동시에
//     _expires=0 을 보고 전원이 인증에 진입합니다(첫 차트 호출 전에 최대 36건).
//     진행 중 프라미스를 공유해 런당 1회로 축약합니다.
let _authInflight = null;
//   ★ 리뷰 수리 ③ 실패 쿨다운: 인증이 실패하면 crumb 캐시가 비어 심볼마다 인증
//     플로우를 다시 돌게 됩니다(400종 런이면 최대 1,200건 추가 요청). 실패 결과도
//     짧게 캐시해 폭주를 막습니다 — 차트는 crumb 없이도 응답하므로 스캔은 계속됩니다.
let _authFallback = null;
let _authFallbackUntil = 0;
const AUTH_FAIL_COOLDOWN_MS = 60 * 1000;

// 인증 경로 전용 fetch — 타임아웃 + 통계 카운트. 실패 시 예외 대신 null 을 돌려줍니다.
async function fetchAuthReq(url, headers, opts = {}) {
  _stats.auth++;
  try {
    const r = await fetch(url, { ...opts, headers, signal: AbortSignal.timeout(AUTH_TIMEOUT_MS) });
    _stats.authOk++;
    if (r.status === 429) _stats.r429++;
    return r;
  } catch { _stats.authErr++; return null; }
}

async function runYahooAuth() {
  const now = Date.now();
  let cookies = "";
  const r1 = await fetchAuthReq("https://fc.yahoo.com", { "User-Agent": UA }, { redirect: "manual" });
  if (r1) cookies = r1.headers.get("set-cookie") || "";
  if (!cookies) {
    const r2 = await fetchAuthReq("https://finance.yahoo.com/", { "User-Agent": UA }, { redirect: "manual" });
    if (r2) cookies = r2.headers.get("set-cookie") || "";
  }

  for (const host of ["query2.finance.yahoo.com", "query1.finance.yahoo.com"]) {
    const crumbRes = await fetchAuthReq(`https://${host}/v1/test/getcrumb`, { "User-Agent": UA, "Cookie": cookies });
    if (!crumbRes?.ok) continue;
    let crumb = "";
    try { crumb = await crumbRes.text(); } catch { crumb = ""; } // 본문 읽는 중 타임아웃 — 다음 호스트로
    if (crumb) {
      _cookie = cookies; _crumb = crumb; _expires = now + 8 * 60 * 1000;
      _authFallback = null; _authFallbackUntil = 0;
      return { cookie: _cookie, crumb: _crumb };
    }
  }
  // 2026-08-11 실측: v8 chart 는 crumb 없이도 응답함 — 인증 실패 시 crumb 없이 진행(폴백)
  _authFallback = { cookie: cookies, crumb: "" };
  _authFallbackUntil = now + AUTH_FAIL_COOLDOWN_MS;
  return _authFallback;
}

async function getYahooAuth() {
  const now = Date.now();
  if (_cookie && _crumb && now < _expires) return { cookie: _cookie, crumb: _crumb };
  if (_authFallback && now < _authFallbackUntil) return _authFallback; // 최근 실패 — 쿨다운 동안 재시도 안 함
  if (_authInflight) return _authInflight;                             // 이미 누가 인증 중 — 결과를 나눠 씁니다
  _authInflight = runYahooAuth().catch(() => ({ cookie: "", crumb: "" }));
  try {
    return await _authInflight;
  } finally {
    _authInflight = null;
  }
}

// 단일 심볼 차트 1회 호출 (yahoo.js fetchOne 패턴 — host 폴백 + 타임아웃)
//   ★ 2026-08-13 유니버스 확대: 429/5xx 를 삼키지 않고 카운트하고, 429 는 짧은
//     지터 백오프 후 1회만 재시도합니다(런 전체를 늦추지 않는 선).
//     실측(2026-08-13): 단발 1,118심볼 연속 조회(동시성 12)는 429 0건이었지만,
//     400심볼 런을 쉬는 시간 없이 3회 연달아 돌리자(누적 약 2,700콜) 야후가
//     본격적으로 조이기 시작했습니다. 그래서 ① 이미 조여오는 게 확인된 뒤엔
//     재시도를 멈추고(재시도가 오히려 호출을 2배로 늘림) ② 크론이 런을 중단해
//     다음 런에서 이어받게 합니다. 정기 크론은 런 간격이 30분이라 이 구간과는
//     듀티사이클이 전혀 다르지만, 안전장치는 실측대로 둡니다.
const RETRY_429_UNTIL = 10; // 429 누적이 이보다 많으면 재시도 포기(확실히 조이는 상태)
async function fetchChartJson(symbol, interval, range, auth) {
  for (const host of ["query2.finance.yahoo.com", "query1.finance.yahoo.com"]) {
    const crumbQ = auth.crumb ? `&crumb=${encodeURIComponent(auth.crumb)}` : "";
    const url = `https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}${crumbQ}&includePrePost=false`;
    for (let attempt = 0; attempt < 2; attempt++) {
      _stats.calls++;
      try {
        const r = await fetch(url, {
          headers: { "User-Agent": UA, "Accept": "application/json", "Cookie": auth.cookie || "" },
          signal: AbortSignal.timeout(8000),
        });
        if (r.ok) { _stats.ok++; return r.json(); }
        if (r.status === 429) {
          _stats.r429++;
          if (attempt === 0 && _stats.r429 <= RETRY_429_UNTIL) {
            _stats.retried++;
            await new Promise((s) => setTimeout(s, 400 + Math.random() * 600));
            continue;
          }
        } else if (r.status === 404) { _stats.r404++; return null; } // 상장폐지·오탈자 — 호스트 폴백해도 동일
        else _stats.other++;
      } catch { _stats.err++; }
      break; // 429 재시도 외에는 다음 호스트로
    }
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
  if (!Array.isArray(closes) || closes.length < MIN_BARS) return null; // 코인 sigForTF 와 동일 최소 봉 수
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
  //   ★ 2026-08-19 경계 케이스 교정: 기존 calcSMA(atr.map(v=>v||0), 50) 은 워밍업
  //     구간의 null 을 0 으로 치환해 평균했기 때문에, 봉 수가 정확히 최소치(62봉)인
  //     심볼만 last-50 윈도우에 null 1개가 포함돼(calcATR=EMA(tr,14) → null 인덱스
  //     0~12, 62봉 윈도우는 12~61) 기준선이 49/50 로 하향 왜곡 → atrVal/atrBase
  //     비율 과대 → "ATR폭발" ±1 이 과발화했습니다. null 제외 실측 평균으로 교정 —
  //     63봉 이상은 윈도우(13~…)에 null 이 없어 신·구 결과가 완전히 동일합니다(회귀 0).
  const atrVal = atr[L] || 0;
  const atrWin = atr.slice(-50).filter((v) => v != null);
  const atrBase = atrWin.length > 0 ? atrWin.reduce((a, b) => a + b, 0) / atrWin.length : 0;
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
// 종합 조립 — btc-cron compositeSignal 과 동일 공식(부호 가중합, 임계 ±0.5)의
// 순수 함수 분리(단위 테스트 가능). 2026-08-19 스코어링 감사 + 리뷰 2차 수리 2건:
//
// ★ TF 결측 희석(감사 발견 — v1 산술 결함): compScore = round(|가중합|) 은 가중치
//   합이 4TF 전제(1.0)라, 데이터 자체가 결측인 TF(예: 상장 14.3개월 미만 → 주봉
//   62개 미충족)는 합의 강도와 무관하게 결측 가중치만큼 점수가 *희석*됩니다.
//   예: 1w 결측 + 3TF 전원 BUY 80 → 종합 56 (완전 합의인데 30% 감점),
//       1d 만 존재 BUY 55 → 종합 14 (TF 개별 점수 바닥이 50인 스케일에서 14 는
//       사용자에게 "계산이 깨진 값"으로 보임 — 신뢰 문제).
//   '결측'은 반대 의견이 아니므로, 가용 TF 가중치 합(coverage)으로 나눈 재정규화
//   점수를 covAdjScore 로 산출합니다. 4TF 모두 있으면 coverage=1 → 산식상 동일값.
//
// ★ 리뷰 2차 수리 ① — coverage 는 "신호 존재"가 아니라 "데이터 충분성" 기준:
//   scoreStockTF 는 봉 수 부족(진짜 결측)뿐 아니라 확신 미달(max(buy,sell)<2)·횡보
//   동점 등 *데이터를 전부 보고 '방향 없음'이라 판정한 중립*에도 null 을 반환합니다.
//   신호 존재로 coverage 를 세면 중립 TF 까지 분모에서 빠져 나머지 TF 합의가
//   부풀려집니다(예: 1w BUY70·1d BUY70 + 4h·1h 데이터 충분-중립 → 39점이 70점으로).
//   그래서 호출부가 hasW/hasD/has4/has1(봉 수 ≥ MIN_BARS)을 전달하고, 데이터는
//   충분하나 중립-null 인 TF 는 분모에 남아 기여 0 — v1 과 동일한 희석('합의 부재'
//   의미론)을 보존합니다. 봉 수는 충분하나 지표 산출 불능(가격≤0 등)으로 null 인
//   극귀한 케이스도 같은 취급(보수적 희석 — 지어내지 않음).
//
// ★ 리뷰 2차 수리 ② — 사전등록 게이트 보호(covAdjScore 는 additive 로만 적재):
//   entry.score 는 표시 외에 ⓐ 스윙 알림 사전등록 게이트 ②(swing-signals.js
//   SWING_RULES 2026-08-17.v1, score≥65 — 라이브 크론 swing-alert 소비)와
//   ⓑ 표시 히스테리시스 side 전환 확정 임계(display-hysteresis.js, 기본 58)가
//   그대로 소비합니다. 재정규화 점수가 이 경로로 흐르면 v1 에서 구조적으로 불가능
//   했던 발화가 생깁니다 — 구 공식에서 coverage 0.55(1w+1d만) 심볼은 최대 ~52점이라
//   ② 통과·ⓑ 전환 확정이 불가했는데(암묵적 커버리지 하한), 재정규화 시 통과 가능
//   해지고 그때 게이트 ③(4h 반대→WAIT)·⑤(4h/1h 과열 배제)는 해당 TF 가 null 이라
//   판정 불능입니다(야후 1h 일시 장애만으로 이전에 불가능했던 알림 발화 가능).
//   SWING_RULES 는 "규칙 변경 시 새 version 등록"을 사전등록해 두었으므로, 소비
//   필드(score·confidence·reason)는 v1 산식(compScore = round(min(100,|raw|)))
//   비트 동일로 유지하고, 재정규화 점수는 additive 필드(covAdjScore·tfCoverage)로만
//   실어 둡니다 — 현재 소비 경로 0, 전 소비자 델타 0. 표시 채택(stock-scores→App)
//   또는 게이트 전환(covAdjScore ?? score)은 QUANT-PLAN 의 SWING_RULES v2 사전등록과
//   함께 별도 결재로 진행합니다(사전등록 개체군 무단 변경 금지).
//   방향(compType)·적재 여부·breakdown 도 기존 raw 기준 그대로 불변입니다.
// ════════════════════════════════════════════════════════
export function composeStockScore({ sigW = null, sigD = null, sig4 = null, sig1 = null,
                                    hasW = undefined, hasD = undefined, has4 = undefined, has1 = undefined }) {
  const signed = (s) => (!s ? 0 : (s.type === "BUY" ? 1 : s.type === "SELL" ? -1 : 0) * (parseFloat(s.score) || 0));
  const raw = TF_WEIGHTS["1w"] * signed(sigW) + TF_WEIGHTS["1d"] * signed(sigD)
    + TF_WEIGHTS["4h"] * signed(sig4) + TF_WEIGHTS["1h"] * signed(sig1);
  const compType = raw > 0.5 ? "BUY" : raw < -0.5 ? "SELL" : null; // 방향 — 기존 raw 기준 불변
  // coverage — 데이터 충분성 기준(위 수리 ①). 신호가 있으면 데이터 충분이 함의되므로 OR
  //   (신호 존재 TF 가 분모에서 빠지는 모순 방지). has* 미전달 레거시 호출은 신호
  //   존재로 폴백 — 이 폴백은 additive 인 covAdjScore/coverage 에만 영향.
  const avail = (has, sig) => sig != null || has === true;
  const coverage = (avail(hasW, sigW) ? TF_WEIGHTS["1w"] : 0) + (avail(hasD, sigD) ? TF_WEIGHTS["1d"] : 0)
    + (avail(has4, sig4) ? TF_WEIGHTS["4h"] : 0) + (avail(has1, sig1) ? TF_WEIGHTS["1h"] : 0);
  const compScore = Math.round(Math.min(100, Math.abs(raw))); // v1 산식 그대로 — 사전등록 소비 경로 비트 동일
  const covAdjScore = coverage > 0 ? Math.round(Math.min(100, Math.abs(raw) / coverage)) : 0;
  return { raw, coverage, compScore, covAdjScore, compType };
}

// ════════════════════════════════════════════════════════
// 심볼 1개 스캔 → 코인 풀(realtime-pool-mtf)과 동일 스키마의 엔트리 생성
// ────────────────────────────────────────────────────────
// 완결봉 정책(코인 btc-cron 과 동일 계열):
//   1w — 마지막(형성 중인 이번 주) 봉 제외, 1h/4h — 개장 중이면 형성 중 마지막 봉
//   제외(리페인팅 방지), 1d — 진행봉 포함(코인 sig1d 경로와 동일, 반응성 보존).
// 반환: { status, entry, marketState }
//   status "ok"                — 스캔 성공 (entry 는 방향 합의 없으면 null)
//   status "fetch-failed"      — 야후 응답 자체를 못 받음 (일시 장애·차단)
//   status "insufficient-data" — 응답은 받았으나 일봉이 MIN_BARS 개 미만
//                                (상장 직후 종목 — 봉이 쌓이면 자동 편입)
//   ★ 2026-08-13: 예전엔 두 실패를 모두 bare null 로 반환해 크론이 "호출 실패"와
//     "상장 초기라 봉 부족"을 구분하지 못했습니다(1,016종으로 늘리면 신규 상장이
//     상시 섞이므로 실패 리포트가 오염됨). 사유를 분리해 정직하게 보고합니다.
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
  if (!jsonD || !candles1d) return { status: "fetch-failed", entry: null, marketState: null };
  // ★ 2026-09-04 신규상장 부분 커버리지: 일봉 25~61개는 스킵하지 않고 계속 진행 —
  //   sigD 는 scoreStockTF 의 MIN_BARS 하한으로 자연히 null(결측)이 되고, 종합은
  //   4h/1h 중심으로 산출됩니다(coverage 희석·breakdown "일—" 정직 표기는 기존 배선).
  //   지지·저항은 computeSRLevels 자체 폴백(15봉~)이 실데이터 범위에서 산출합니다.
  if (candles1d.length < NEW_LISTING_MIN_BARS) { // 극초기(상장 ~5주 미만)만 스킵
    return { status: "insufficient-data", entry: null, marketState: deriveMarketState(jsonD), bars: candles1d.length };
  }

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

  // 데이터 충분성 플래그 — coverage 판정용(신호 존재와 구분: 봉이 충분해도 중립이면
  //   신호는 null. 결측≠중립 — composeStockScore 헤더 수리 ① 참조).
  const hasW = !!(candles1w && candles1w.length >= MIN_BARS);
  const hasD = candles1d.length >= MIN_BARS; // 위 조기 반환 통과 시 항상 true
  const has4 = candles4h.length >= MIN_BARS;
  const has1 = !!(candles1h && candles1h.length >= MIN_BARS);

  const sigW = hasW ? scoreStockTF(toArrays(candles1w), "1w") : null;
  const sigD = scoreStockTF(toArrays(candles1d), "1d");
  const sig4 = has4 ? scoreStockTF(toArrays(candles4h), "4h") : null;
  const sig1 = has1 ? scoreStockTF(toArrays(candles1h), "1h") : null;

  // ── 종합 — composeStockScore(위 순수 함수: btc-cron 동일 공식. compScore 는 v1
  //   산식 비트 동일, 결측 재정규화는 additive covAdjScore — 헤더 수리 ② 참조) ──
  const { coverage, compScore, covAdjScore, compType } = composeStockScore({ sigW, sigD, sig4, sig1, hasW, hasD, has4, has1 });
  if (!compType) return { status: "ok", entry: null, marketState }; // 방향 합의 없음 — 코인 풀과 동일하게 미적재

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
    score: compScore,            // v1 산식 유지 — 스윙 게이트 ②·히스테리시스 소비 경로 비트 동일(수리 ②)
    confidence: compScore >= 80 ? "A" : compScore >= 60 ? "B" : "C",
    family: "composite",
    timeframe: "MTF",
    covAdjScore,                 // ★ additive — TF 결측 재정규화 점수(소비 경로 0, 표시 채택·v2 사전등록 대기)
    tfCoverage: Math.round(coverage * 100) / 100, // ★ additive — 데이터 충분성 기준 가용 TF 가중치 합(1.0=4TF 전부)
    breakdown,
    reason: `종합 ${compScore} (주${tfTag(sigW)}·일${tfTag(sigD)}·4h${tfTag(sig4)}·1h${tfTag(sig1)}) — 기술적 지표 종합`,
    source: "stock-signals-cron",
    sr,
    marketState,                 // "REGULAR" | "CLOSED" | null — 장 마감 후엔 마지막 데이터 기준 유지(정직 표기)
  };
  return { status: "ok", entry, marketState };
}
