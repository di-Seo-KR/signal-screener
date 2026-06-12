// Vercel Serverless — 경제 캘린더 API (v2: 병렬 멀티소스 + BLS 실시간 + KV 캐싱)
// GET /api/econ-calendar
//
// 데이터 소스 (병렬 실행):
//   A. Finnhub   — 전체 경제 캘린더 (actual 포함)
//   B. FMP       — 전체 경제 캘린더 (actual 포함)
//   C. BLS API   — CPI/고용 실시간 actual (발표 즉시 반영)
//   D. FRED API  — 추가 actual 보완
//
// 전략: 모든 소스를 병렬 호출 → actual 값이 있는 소스 우선 → curated 이벤트에 병합
// KV 키: di:econ:actuals — 발표된 수치를 영구 저장

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  // 발표 시간대(미국 8:30AM ET = 한국 21:30~22:30)에는 30초 캐시로 단축
  // ★ 2026-06-12 fix: %24 정규화 — 이전엔 9~32 범위라 (hourKST>=0 && <=2) 분기가 영원히 false
  const hourKST = (new Date().getUTCHours() + 9) % 24;
  const isAnnouncementWindow = (hourKST >= 21 && hourKST <= 24) || (hourKST >= 0 && hourKST <= 2);
  const cacheSeconds = isAnnouncementWindow ? 30 : 600;
  res.setHeader("Cache-Control", `s-maxage=${cacheSeconds}, stale-while-revalidate=${Math.floor(cacheSeconds * 1.5)}`);

  const now = new Date();
  const from = new Date(now); from.setDate(from.getDate() - 30);
  const to   = new Date(now); to.setDate(to.getDate() + 30);
  const fmtDate = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  const todayStr = fmtDate(now);

  // ── 유틸리티 ──
  const majorKeywords = [
    "CPI", "Consumer Price Index", "Nonfarm Payrolls", "Non-Farm", "NFP",
    "GDP", "Gross Domestic Product", "PCE", "Personal Consumption",
    "FOMC", "Fed Interest Rate", "Federal Funds Rate",
    "Retail Sales", "Unemployment Rate", "PPI", "Producer Price Index",
    "ISM Manufacturing", "ISM Services", "Initial Jobless Claims", "Jobless Claims",
    "Housing Starts", "Building Permits", "Industrial Production",
    "Consumer Confidence", "Durable Goods",
  ];
  const isMajorEvent = (name) => majorKeywords.some(kw => (name || "").toLowerCase().includes(kw.toLowerCase()));
  const getUnit = (n) => {
    const l = (n || "").toLowerCase();
    if (l.includes("rate") || l.includes("yoy") || l.includes("mom") || l.includes("pce") || l.includes("cpi") || l.includes("ppi") || l.includes("gdp")) return "%";
    if (l.includes("payrolls") || l.includes("nfp") || l.includes("claims")) return "K";
    return "";
  };
  const getType = (n) => {
    const l = (n || "").toLowerCase();
    if (l.includes("fomc") || l.includes("fed") || l.includes("federal funds")) return "FOMC";
    if (l.includes("cpi") || l.includes("consumer price")) return "CPI";
    if (l.includes("nonfarm") || l.includes("non-farm") || l.includes("nfp") || l.includes("payrolls") || l.includes("unemployment") || l.includes("jobless")) return "NFP";
    if (l.includes("gdp")) return "GDP";
    if (l.includes("pce")) return "PCE";
    return "경제지표";
  };

  // ── KV 연결 ──
  let kv = null;
  let kvActuals = {};
  try {
    const kvModule = await import("@vercel/kv");
    kv = kvModule.kv;
    kvActuals = (await kv.get("di:econ:actuals")) || {};
  } catch { /* KV 없으면 캐싱 없이 진행 */ }

  const saveActualsToKV = async (newActuals) => {
    if (!kv || Object.keys(newActuals).length === 0) return;
    let updated = false;
    for (const [key, val] of Object.entries(newActuals)) {
      if (val != null && kvActuals[key] == null) {
        kvActuals[key] = val;
        updated = true;
      }
    }
    if (updated) { try { await kv.set("di:econ:actuals", kvActuals); } catch {} }
  };

  // ══════════════════════════════════════════════════════════════
  // 모든 소스를 병렬로 호출
  // ══════════════════════════════════════════════════════════════
  const [finnhubResult, fmpResult, blsResult, fredResult] = await Promise.allSettled([
    fetchFinnhub(fmtDate(from), fmtDate(to)),
    fetchFMP(fmtDate(from), fmtDate(to)),
    fetchBLSActuals(),
    fetchFREDActuals(todayStr, getCuratedEvents2026()),
  ]);

  // ── 소스별 결과 정리 ──
  const finnhubEvents = finnhubResult.status === "fulfilled" ? finnhubResult.value : [];
  const fmpEvents     = fmpResult.status === "fulfilled" ? fmpResult.value : [];
  const blsActuals    = blsResult.status === "fulfilled" ? blsResult.value : {};
  const fredActuals   = fredResult.status === "fulfilled" ? fredResult.value : {};

  // ── 풀 캘린더 소스 선택 (Finnhub > FMP > Curated) ──
  let baseEvents;
  let source;
  if (finnhubEvents.length > 5) {
    baseEvents = finnhubEvents;
    source = "finnhub";
  } else if (fmpEvents.length > 5) {
    baseEvents = fmpEvents;
    source = "fmp";
  } else {
    baseEvents = getCuratedEvents2026();
    source = "curated";
  }

  // ── 모든 actual 값 통합: BLS → FRED → KV → API 소스 순으로 우선순위 ──
  const allActuals = { ...kvActuals };

  // FRED actuals 병합
  for (const [key, val] of Object.entries(fredActuals)) {
    if (val != null && allActuals[key] == null) allActuals[key] = val;
  }

  // BLS actuals 병합 (최우선 — 발표 즉시 반영)
  for (const [key, val] of Object.entries(blsActuals)) {
    if (val != null) allActuals[key] = val; // BLS는 무조건 덮어쓰기 (가장 정확)
  }

  // API 소스에서 actual 있는 것도 수집
  const apiSourceActuals = {};
  for (const evt of [...finnhubEvents, ...fmpEvents]) {
    if (evt.actual != null && evt.date && evt.event) {
      const key = `${evt.date}::${evt.event}`;
      if (allActuals[key] == null) allActuals[key] = evt.actual;
      apiSourceActuals[key] = evt.actual;
    }
  }

  // ── baseEvents에 actual 값 병합 ──
  const finalEvents = baseEvents.map(e => {
    if (e.actual != null) return e;
    const key = `${e.date}::${e.event}`;
    if (allActuals[key] != null) {
      return { ...e, actual: allActuals[key] };
    }
    return e;
  });

  // ── KV에 새로운 actual 저장 ──
  await saveActualsToKV({ ...apiSourceActuals, ...fredActuals, ...blsActuals });

  const sourceList = [
    source,
    finnhubEvents.length > 0 ? "finnhub" : null,
    fmpEvents.length > 0 ? "fmp" : null,
    Object.keys(blsActuals).length > 0 ? "bls" : null,
    Object.keys(fredActuals).length > 0 ? "fred" : null,
  ].filter(Boolean);

  return res.status(200).json({
    events: finalEvents,
    source: sourceList.join("+"),
    updatedAt: now.toISOString(),
    actualsCount: Object.keys(allActuals).length,
  });
}

// ══════════════════════════════════════════════════════════════
// 데이터 소스: Finnhub
// ══════════════════════════════════════════════════════════════
async function fetchFinnhub(from, to) {
  const key = process.env.FINNHUB_API_KEY;
  if (!key || key === "demo") return [];
  try {
    const url = `https://finnhub.io/api/v1/calendar/economic?from=${from}&to=${to}&token=${key}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!resp.ok) return [];
    const json = await resp.json();
    const data = json?.economicCalendar || json?.data || [];
    if (!Array.isArray(data) || data.length < 3) return [];
    return data
      .filter(e => (e.country === "US" || e.country === "United States"))
      .filter(e => isMajorEventCheck(e.event || e.indicator))
      .map(e => ({
        date: e.date || e.time?.split("T")[0],
        event: e.event || e.indicator,
        actual: e.actual ?? e.actualValue ?? null,
        estimate: e.estimate ?? e.forecastValue ?? null,
        previous: e.previous ?? e.previousValue ?? null,
        impact: e.impact || "High",
        country: "US",
        unit: e.unit || getUnitHelper(e.event || e.indicator),
        type: getTypeHelper(e.event || e.indicator),
      }))
      .slice(0, 80);
  } catch { return []; }
}

// ══════════════════════════════════════════════════════════════
// 데이터 소스: FinancialModelingPrep
// ══════════════════════════════════════════════════════════════
async function fetchFMP(from, to) {
  const key = process.env.FMP_API_KEY;
  if (!key || key === "demo") return [];
  try {
    const url = `https://financialmodelingprep.com/api/v3/economic_calendar?from=${from}&to=${to}&apikey=${key}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!resp.ok) return [];
    const data = await resp.json();
    if (!Array.isArray(data) || data.length < 1) return [];
    return data
      .filter(e => e.country === "US")
      .filter(e => isMajorEventCheck(e.event))
      .map(e => ({
        date: e.date,
        event: e.event,
        actual: e.actual ?? null,
        estimate: e.estimate ?? null,
        previous: e.previous ?? null,
        impact: e.impact || "Medium",
        country: "US",
        unit: e.unit || getUnitHelper(e.event),
        type: getTypeHelper(e.event),
      }))
      .slice(0, 80);
  } catch { return []; }
}

// ══════════════════════════════════════════════════════════════
// 데이터 소스: BLS (Bureau of Labor Statistics) — 실시간 CPI/고용
// BLS Public Data API v2: 발표 당일 8:30 AM ET 직후 반영
// ══════════════════════════════════════════════════════════════
async function fetchBLSActuals() {
  const actuals = {};
  const blsKey = process.env.BLS_API_KEY;

  // BLS 시리즈: CPI, Core CPI, 실업률, NFP
  const series = [
    { id: "CUSR0000SA0",    match: "CPI (YoY)",        calc: "yoy" },    // CPI-U All Items (SA)
    { id: "CUSR0000SA0L1E", match: "Core CPI (YoY)",   calc: "yoy" },    // CPI-U Less Food & Energy (SA)
    { id: "LNS14000000",    match: "Unemployment Rate", calc: "direct" }, // Civilian Unemployment Rate (SA)
    { id: "CES0000000001",  match: "Nonfarm Payrolls",  calc: "diff" },   // Total Nonfarm (SA, thousands)
  ];

  const now = new Date();
  const curYear = now.getFullYear();

  try {
    // BLS API v2 POST: startyear/endyear 필수, latest는 GET 전용
    // YoY 계산을 위해 작년~올해 2년치 요청 (최소 13개월 필요)
    const body = {
      seriesid: series.map(s => s.id),
      startyear: String(curYear - 1),
      endyear: String(curYear),
    };

    // v2는 registrationkey 필요, v1은 키 없이 사용 (하루 25회)
    const url = blsKey
      ? "https://api.bls.gov/publicAPI/v2/timeseries/data/"
      : "https://api.bls.gov/publicAPI/v2/timeseries/data/";

    if (blsKey) body.registrationkey = blsKey;

    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });

    if (!resp.ok) return actuals;
    const json = await resp.json();
    if (json.status !== "REQUEST_SUCCEEDED") return actuals;

    const curatedEvents = getCuratedEvents2026();
    const todayStr = `${curYear}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;

    for (const seriesData of (json.Results?.series || [])) {
      const sid = seriesData.seriesID;
      const config = series.find(s => s.id === sid);
      if (!config) continue;

      // BLS 데이터: 최신 → 오래된 순 (year desc, period desc)
      const rawData = (seriesData.data || [])
        .filter(d => d.period !== "M13") // M13 = annual average, 제외
        .sort((a, b) => {
          const ya = parseInt(a.year), yb = parseInt(b.year);
          if (ya !== yb) return yb - ya;
          const pa = parseInt(a.period.replace("M", "")), pb = parseInt(b.period.replace("M", ""));
          return pb - pa;
        });

      if (rawData.length < 2) continue;

      const latestVal = parseFloat(rawData[0]?.value);
      const prevVal   = parseFloat(rawData[1]?.value);
      if (isNaN(latestVal) || isNaN(prevVal)) continue;

      let actual;
      if (config.calc === "direct") {
        actual = latestVal;
      } else if (config.calc === "diff") {
        actual = latestVal - prevVal; // NFP: 월간 변동 (K단위)
      } else if (config.calc === "yoy") {
        // YoY: 12개월 전 데이터와 비교
        // 최신 데이터의 year/period 파악
        const latestYear = parseInt(rawData[0].year);
        const latestMonth = parseInt(rawData[0].period.replace("M", ""));
        // 12개월 전 찾기
        const targetYear = latestMonth <= 12 ? latestYear - 1 : latestYear;
        const targetMonth = latestMonth; // 같은 월
        const prev12Entry = rawData.find(d =>
          parseInt(d.year) === targetYear &&
          parseInt(d.period.replace("M", "")) === targetMonth
        );
        if (!prev12Entry) continue;
        const prev12Val = parseFloat(prev12Entry.value);
        if (isNaN(prev12Val) || prev12Val <= 0) continue;
        actual = Math.round(((latestVal - prev12Val) / prev12Val) * 1000) / 10;
      }

      if (actual == null || isNaN(actual)) continue;

      // curated 이벤트에서 actual이 null인 가장 최근 과거 이벤트와 매칭
      const matching = curatedEvents.filter(e =>
        e.event === config.match && e.actual == null && e.date <= todayStr
      );
      if (matching.length > 0) {
        const target = matching[matching.length - 1];
        actuals[`${target.date}::${target.event}`] = actual;
      }
    }
  } catch { /* BLS 실패 무시 */ }

  return actuals;
}

// ══════════════════════════════════════════════════════════════
// 데이터 소스: FRED (Federal Reserve) — 추가 actual 보완
// ══════════════════════════════════════════════════════════════
async function fetchFREDActuals(todayStr, curated) {
  const actuals = {};
  const fredKey = process.env.FRED_API_KEY;
  if (!fredKey) return actuals;

  const fredSeries = [
    { id: "CPIAUCSL",         eventMatch: "CPI (YoY)",                   yoy: true },
    { id: "CPILFESL",         eventMatch: "Core CPI (YoY)",              yoy: true },
    { id: "PAYEMS",           eventMatch: "Nonfarm Payrolls",            diff: true },
    { id: "UNRATE",           eventMatch: "Unemployment Rate",           direct: true },
    { id: "A191RL1Q225SBEA",  eventMatch: "GDP Growth Rate",             direct: true },
    { id: "PCEPI",            eventMatch: "PCE Price Index (YoY)",       yoy: true },
    { id: "RSAFS",            eventMatch: "Retail Sales (MoM)",          mom: true },
  ];

  const fetches = fredSeries.map(async (series) => {
    try {
      const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${series.id}&sort_order=desc&limit=14&api_key=${fredKey}&file_type=json`;
      const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!resp.ok) return;
      const json = await resp.json();
      const obs = json?.observations?.filter(o => o.value !== ".");
      if (!obs || obs.length < 2) return;

      const latest = parseFloat(obs[0].value);
      const prev   = parseFloat(obs[1].value);
      if (isNaN(latest) || isNaN(prev)) return;

      let actual;
      if (series.direct) actual = latest;
      else if (series.diff) actual = latest - prev;
      else if (series.yoy) {
        const obs12 = obs.length >= 13 ? parseFloat(obs[12].value) : null;
        if (obs12 && !isNaN(obs12) && obs12 > 0) {
          actual = Math.round(((latest - obs12) / obs12) * 1000) / 10;
        } else return;
      } else if (series.mom) {
        actual = prev > 0 ? Math.round(((latest - prev) / prev) * 1000) / 10 : 0;
      }

      if (actual == null || isNaN(actual)) return;

      // GDP는 부분 매칭 (Q1 Advance, Q4 Final 등)
      const matchingEvents = curated.filter(e =>
        (series.id === "A191RL1Q225SBEA"
          ? e.event.startsWith("GDP Growth Rate")
          : e.event === series.eventMatch)
        && e.actual == null && e.date <= todayStr
      );

      if (matchingEvents.length > 0) {
        const target = matchingEvents[matchingEvents.length - 1];
        actuals[`${target.date}::${target.event}`] = actual;
      }
    } catch { /* 개별 시리즈 실패 무시 */ }
  });

  await Promise.allSettled(fetches);
  return actuals;
}

// ══════════════════════════════════════════════════════════════
// 유틸리티 (모듈 레벨)
// ══════════════════════════════════════════════════════════════
const _majorKW = [
  "CPI", "Consumer Price Index", "Nonfarm Payrolls", "Non-Farm", "NFP",
  "GDP", "Gross Domestic Product", "PCE", "Personal Consumption",
  "FOMC", "Fed Interest Rate", "Federal Funds Rate",
  "Retail Sales", "Unemployment Rate", "PPI", "Producer Price Index",
  "ISM Manufacturing", "ISM Services", "Initial Jobless Claims", "Jobless Claims",
  "Housing Starts", "Building Permits", "Industrial Production",
  "Consumer Confidence", "Durable Goods",
];

function isMajorEventCheck(name) {
  return _majorKW.some(kw => (name || "").toLowerCase().includes(kw.toLowerCase()));
}

function getUnitHelper(n) {
  const l = (n || "").toLowerCase();
  if (l.includes("rate") || l.includes("yoy") || l.includes("mom") || l.includes("pce") || l.includes("cpi") || l.includes("ppi") || l.includes("gdp")) return "%";
  if (l.includes("payrolls") || l.includes("nfp") || l.includes("claims")) return "K";
  return "";
}

function getTypeHelper(n) {
  const l = (n || "").toLowerCase();
  if (l.includes("fomc") || l.includes("fed") || l.includes("federal funds")) return "FOMC";
  if (l.includes("cpi") || l.includes("consumer price")) return "CPI";
  if (l.includes("nonfarm") || l.includes("non-farm") || l.includes("nfp") || l.includes("payrolls") || l.includes("unemployment") || l.includes("jobless")) return "NFP";
  if (l.includes("gdp")) return "GDP";
  if (l.includes("pce")) return "PCE";
  return "경제지표";
}

// ══════════════════════════════════════════════════════════════
// 큐레이션 이벤트 (폴백 + 이벤트 일정 기준)
// ══════════════════════════════════════════════════════════════
function getCuratedEvents2026() {
  return [
    // ── January 2026 ──
    { date: "2026-01-02", event: "ISM Manufacturing PMI", actual: 49.3, estimate: 48.8, previous: 48.4, impact: "High", type: "경제지표" },
    { date: "2026-01-10", event: "Nonfarm Payrolls", actual: 227, estimate: 200, previous: 199, impact: "High", unit: "K", type: "NFP" },
    { date: "2026-01-10", event: "Unemployment Rate", actual: 4.2, estimate: 4.2, previous: 4.2, impact: "High", unit: "%", type: "NFP" },
    { date: "2026-01-14", event: "CPI (YoY)", actual: 2.9, estimate: 2.8, previous: 2.7, impact: "High", unit: "%", type: "CPI" },
    { date: "2026-01-14", event: "Core CPI (YoY)", actual: 3.2, estimate: 3.3, previous: 3.3, impact: "High", unit: "%", type: "CPI" },
    { date: "2026-01-16", event: "Retail Sales (MoM)", actual: 0.4, estimate: 0.5, previous: 0.7, impact: "High", unit: "%", type: "경제지표" },
    { date: "2026-01-29", event: "FOMC Rate Decision", actual: 4.50, estimate: 4.50, previous: 4.50, impact: "High", unit: "%", type: "FOMC" },
    { date: "2026-01-30", event: "GDP Growth Rate (Q4, Advance)", actual: 2.3, estimate: 2.5, previous: 3.1, impact: "High", unit: "%", type: "GDP" },
    { date: "2026-01-31", event: "PCE Price Index (YoY)", actual: 2.6, estimate: 2.5, previous: 2.4, impact: "High", unit: "%", type: "PCE" },

    // ── February 2026 ──
    { date: "2026-02-06", event: "Nonfarm Payrolls", actual: 143, estimate: 175, previous: 227, impact: "High", unit: "K", type: "NFP" },
    { date: "2026-02-06", event: "Unemployment Rate", actual: 4.0, estimate: 4.2, previous: 4.2, impact: "High", unit: "%", type: "NFP" },
    { date: "2026-02-12", event: "CPI (YoY)", actual: 3.0, estimate: 2.9, previous: 2.9, impact: "High", unit: "%", type: "CPI" },
    { date: "2026-02-12", event: "Core CPI (YoY)", actual: 3.3, estimate: 3.2, previous: 3.2, impact: "High", unit: "%", type: "CPI" },
    { date: "2026-02-14", event: "Retail Sales (MoM)", actual: -0.9, estimate: -0.2, previous: 0.7, impact: "High", unit: "%", type: "경제지표" },
    { date: "2026-02-28", event: "PCE Price Index (YoY)", actual: 2.5, estimate: 2.5, previous: 2.6, impact: "High", unit: "%", type: "PCE" },
    { date: "2026-02-28", event: "GDP Growth Rate (Q4, Second)", actual: 2.3, estimate: 2.3, previous: 2.3, impact: "High", unit: "%", type: "GDP" },

    // ── March 2026 ──
    { date: "2026-03-06", event: "Nonfarm Payrolls", actual: 151, estimate: 160, previous: 143, impact: "High", unit: "K", type: "NFP" },
    { date: "2026-03-06", event: "Unemployment Rate", actual: 4.1, estimate: 4.0, previous: 4.0, impact: "High", unit: "%", type: "NFP" },
    { date: "2026-03-11", event: "CPI (YoY)", actual: 2.4, estimate: 2.4, previous: 2.4, impact: "High", unit: "%", type: "CPI" },
    { date: "2026-03-11", event: "Core CPI (YoY)", actual: 2.5, estimate: 2.5, previous: 2.6, impact: "High", unit: "%", type: "CPI" },
    { date: "2026-03-17", event: "Retail Sales (MoM)", actual: 0.2, estimate: 0.6, previous: -0.9, impact: "High", unit: "%", type: "경제지표" },
    { date: "2026-03-18", event: "FOMC Rate Decision", actual: 4.50, estimate: 4.50, previous: 4.50, impact: "High", unit: "%", type: "FOMC" },
    { date: "2026-03-27", event: "GDP Growth Rate (Q4, Final)", actual: 2.4, estimate: 2.3, previous: 2.3, impact: "High", unit: "%", type: "GDP" },
    { date: "2026-03-28", event: "PCE Price Index (YoY)", actual: 2.5, estimate: 2.5, previous: 2.5, impact: "High", unit: "%", type: "PCE" },

    // ── April 2026 ──
    { date: "2026-04-03", event: "Nonfarm Payrolls", actual: 178, estimate: 170, previous: 151, impact: "High", unit: "K", type: "NFP" },
    { date: "2026-04-03", event: "Unemployment Rate", actual: 4.3, estimate: 4.1, previous: 4.1, impact: "High", unit: "%", type: "NFP" },
    { date: "2026-04-10", event: "CPI (YoY)", actual: null, estimate: 2.8, previous: 2.4, impact: "High", unit: "%", type: "CPI" },
    { date: "2026-04-10", event: "Core CPI (YoY)", actual: null, estimate: 2.6, previous: 2.5, impact: "High", unit: "%", type: "CPI" },
    { date: "2026-04-16", event: "Retail Sales (MoM)", actual: null, estimate: 0.3, previous: 0.2, impact: "High", unit: "%", type: "경제지표" },
    { date: "2026-04-29", event: "GDP Growth Rate (Q1, Advance)", actual: null, estimate: 2.1, previous: 2.4, impact: "High", unit: "%", type: "GDP" },
    { date: "2026-04-30", event: "PCE Price Index (YoY)", actual: null, estimate: 2.4, previous: 2.5, impact: "High", unit: "%", type: "PCE" },

    // ── May 2026 ──
    { date: "2026-05-01", event: "Nonfarm Payrolls", actual: null, estimate: 165, previous: null, impact: "High", unit: "K", type: "NFP" },
    { date: "2026-05-06", event: "FOMC Rate Decision", actual: null, estimate: 4.25, previous: 4.50, impact: "High", unit: "%", type: "FOMC" },
    { date: "2026-05-13", event: "CPI (YoY)", actual: null, estimate: 2.7, previous: null, impact: "High", unit: "%", type: "CPI" },
    { date: "2026-05-15", event: "Retail Sales (MoM)", actual: null, estimate: 0.4, previous: null, impact: "High", unit: "%", type: "경제지표" },
    { date: "2026-05-30", event: "PCE Price Index (YoY)", actual: null, estimate: 2.4, previous: null, impact: "High", unit: "%", type: "PCE" },

    // ── June 2026 ──
    { date: "2026-06-05", event: "Nonfarm Payrolls", actual: null, estimate: 155, previous: null, impact: "High", unit: "K", type: "NFP" },
    { date: "2026-06-11", event: "CPI (YoY)", actual: null, estimate: 2.6, previous: null, impact: "High", unit: "%", type: "CPI" },
    { date: "2026-06-17", event: "FOMC Rate Decision", actual: null, estimate: 4.25, previous: null, impact: "High", unit: "%", type: "FOMC" },
    { date: "2026-06-17", event: "Retail Sales (MoM)", actual: null, estimate: 0.3, previous: null, impact: "High", unit: "%", type: "경제지표" },
    { date: "2026-06-27", event: "PCE Price Index (YoY)", actual: null, estimate: 2.3, previous: null, impact: "High", unit: "%", type: "PCE" },
  ];
}
