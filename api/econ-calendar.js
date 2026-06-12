// Vercel Serverless — 경제 캘린더 API (v3: ForexFactory 실 컨센서스 + 병렬 멀티소스)
// GET /api/econ-calendar
//
// 데이터 소스 (병렬 실행):
//   A. Finnhub      — 전체 경제 캘린더 (actual 포함, 키 필요)
//   B. FMP          — 전체 경제 캘린더 (actual 포함, 키 필요)
//   C. BLS API      — CPI/고용 실시간 actual (발표 즉시 반영)
//   D. FRED API     — 추가 actual 보완
//   E. ForexFactory — 이번 주 실제 컨센서스(forecast)·정확한 발표시각 (무키)
//      ★ 2026-06-12 (대표 제보): 큐레이션 추측치(CPI 6/11·est 2.6%)가 실제
//        (6/10 21:30 KST·컨센서스 4.2%, 트레이딩뷰 동일)와 어긋남 → FF 주간
//        JSON 으로 이번 주 이벤트의 날짜·시각·예측·이전치를 실값으로 보정.
//
// 전략: curated 골격(±30일) + FF 가 이번 주 실값 덮어쓰기 + actual 은 BLS/FRED/API.
// KV 키: di:econ:actuals — 발표 수치 영구 저장
//        di:econ:estimates — FF 에서 한 번 관측한 컨센서스 영구 저장(주 경과 후에도 유지)

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
  let kvEstimates = {};
  try {
    const kvModule = await import("@vercel/kv");
    kv = kvModule.kv;
    const [a, est] = await Promise.all([
      kv.get("di:econ:actuals"),
      kv.get("di:econ:estimates"),
    ]);
    kvActuals = a || {};
    kvEstimates = est || {};
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
  const [finnhubResult, fmpResult, blsResult, fredResult, ffResult] = await Promise.allSettled([
    fetchFinnhub(fmtDate(from), fmtDate(to)),
    fetchFMP(fmtDate(from), fmtDate(to)),
    fetchBLSActuals(),
    fetchFREDActuals(todayStr, getCuratedEvents2026()),
    fetchForexFactory(),
  ]);

  // ── 소스별 결과 정리 ──
  const finnhubEvents = finnhubResult.status === "fulfilled" ? finnhubResult.value : [];
  const fmpEvents     = fmpResult.status === "fulfilled" ? fmpResult.value : [];
  const blsOut        = blsResult.status === "fulfilled" ? (blsResult.value || {}) : {};
  const blsActuals    = blsOut.actuals || {};
  const blsByName     = blsOut.byName || {}; // curated 외 이벤트(MoM 행 등) 이름 폴백
  const fredOut       = fredResult.status === "fulfilled" ? (fredResult.value || {}) : {};
  const fredActuals   = fredOut.actuals || {};
  const fredByName    = fredOut.byName || {};
  const ffEvents      = ffResult.status === "fulfilled" ? ffResult.value : [];

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

  // ── ForexFactory 보정: 이번 주 이벤트의 컨센서스·정확한 발표시각(dt)·이전치 덮어쓰기 ──
  //   ① KV 에 저장된 과거 관측 컨센서스 먼저 적용(주 경과 후에도 예측치 유지)
  //   ② FF 라이브가 최우선 — 같은 canonical 이벤트(±3일)에 estimate/previous/dt 주입
  //   ③ curated 에 없는 이번 주 High/Medium 이벤트(근원 CPI·PPI·실업수당 등)는 추가
  const newEstimates = {};
  for (const e of baseEvents) {
    const k = `${e.date}::${e.event}`;
    const saved = kvEstimates[k];
    if (saved) {
      if (e.estimate == null && saved.e != null) e.estimate = saved.e;
      if (e.previous == null && saved.p != null) e.previous = saved.p;
      if (!e.dt && saved.dt) e.dt = saved.dt;
    }
  }
  const D3 = 3 * 86400000;
  for (const f of ffEvents) {
    const match = baseEvents.find(e =>
      e.event === f.event && Math.abs(Date.parse(e.date) - Date.parse(f.date)) <= D3);
    if (match) {
      if (f.estimate != null) match.estimate = f.estimate;
      if (f.previous != null) match.previous = f.previous;
      match.dt = f.dt;
      // 날짜가 다르면 FF(실제 발표일)가 진실 — curated 추측 날짜 교정
      if (match.date !== f.date) match.date = f.date;
      newEstimates[`${f.date}::${f.event}`] = { e: f.estimate ?? null, p: f.previous ?? null, dt: f.dt };
    } else if (f.impact === "High" || f.impact === "Medium") {
      baseEvents.push(f);
      newEstimates[`${f.date}::${f.event}`] = { e: f.estimate ?? null, p: f.previous ?? null, dt: f.dt };
    }
  }
  // ── FF previous 역산 백필 (2026-06-12 대표 질문 "다른 지표들은 어떻게?") ──
  //   FF 의 previous = 직전 회차의 실제 발표치. 이걸로 지난 이벤트의 actual 을
  //   역산해 채우면 ISM·소비자심리 등 BLS/FRED 에 없는 민간지표까지 무키로 커버
  //   (한 발표 사이클 지연). 채운 값은 di:econ:actuals 에 영구 저장돼 누적된다.
  const ffBackfill = {};
  const CYCLE_MAX = 45 * 86400000; // 직전 회차 가드 — 주간·월간만 (한 사이클 건너뛴 오귀속 방지)
  for (const f of ffEvents) {
    if (f.previous == null) continue;
    const prior = baseEvents.filter(e =>
      e.event === f.event && e.actual == null &&
      Date.parse(e.date) < Date.parse(f.date) - D3 &&
      Date.parse(f.date) - Date.parse(e.date) <= CYCLE_MAX);
    if (prior.length > 0) {
      const t = prior[prior.length - 1]; // 직전 회차
      t.actual = f.previous;
      ffBackfill[`${t.date}::${t.event}`] = f.previous;
    }
  }

  // 관측 컨센서스 영구 저장 (best-effort)
  if (kv && Object.keys(newEstimates).length > 0) {
    try {
      let changed = false;
      for (const [k, v] of Object.entries(newEstimates)) {
        const old = kvEstimates[k];
        if (!old || old.e !== v.e || old.p !== v.p) { kvEstimates[k] = v; changed = true; }
      }
      if (changed) await kv.set("di:econ:estimates", kvEstimates);
    } catch {}
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

  // ── 이름 폴백 적용 — curated 에 없는 행(FF 런타임 추가 등)의 '발표 대기' 해소 ──
  //   FRED 먼저, BLS 가 나중(BLS 가 더 정확 — 같은 이벤트면 BLS 가 덮어씀)
  const byNameKeyed = {};
  for (const dict of [fredByName, blsByName]) {
    for (const [name, val] of Object.entries(dict)) {
      const cands = finalEvents.filter(e => e.event === name && (e.actual == null || dict === blsByName) && e.date <= todayStr);
      if (cands.length > 0) {
        const target = cands[cands.length - 1]; // 가장 최근 과거 이벤트
        target.actual = val;
        byNameKeyed[`${target.date}::${target.event}`] = val;
      }
    }
  }

  // ── KV에 새로운 actual 저장 (FF 역산 백필 포함) ──
  await saveActualsToKV({ ...apiSourceActuals, ...fredActuals, ...blsActuals, ...byNameKeyed, ...ffBackfill });

  const sourceList = [
    source,
    finnhubEvents.length > 0 ? "finnhub" : null,
    fmpEvents.length > 0 ? "fmp" : null,
    Object.keys(blsActuals).length > 0 ? "bls" : null,
    Object.keys(fredActuals).length > 0 ? "fred" : null,
    ffEvents.length > 0 ? "ff" : null,
  ].filter(Boolean);

  const payload = {
    events: finalEvents,
    source: sourceList.join("+"),
    updatedAt: now.toISOString(),
    actualsCount: Object.keys(allActuals).length,
  };
  // ?debug=1 — 소스별 기여·오류 진단 (FRED 키 재설정 시 1분 검증용)
  if (req.query?.debug === "1") {
    payload.debug = {
      finnhub: finnhubEvents.length,
      fmp: fmpEvents.length,
      bls: { keyed: Object.keys(blsActuals).length, byName: Object.keys(blsByName).length },
      fred: { keyed: Object.keys(fredActuals).length, byName: Object.keys(fredByName).length, error: fredOut.error || null },
      ff: ffEvents.length,
      ffBackfill: Object.keys(ffBackfill).length,
      kvActualsTotal: Object.keys(kvActuals).length,
    };
  }
  return res.status(200).json(payload);
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
  const byName = {}; // curated 에 없는 이벤트(런타임 추가 MoM 행 등) 이름 기반 폴백
  const blsKey = process.env.BLS_API_KEY;

  // BLS 시리즈: CPI(전년/전월), Core CPI(전년/전월), 실업률, NFP
  //   ★ 2026-06-12 (대표 제보): FF 가 추가한 MoM 행이 '발표 대기'로 남던 것 — 전월비도 산출
  const series = [
    { id: "CUSR0000SA0",    match: "CPI (YoY)",        calc: "yoy" },    // CPI-U All Items (SA)
    { id: "CUSR0000SA0",    match: "CPI (MoM)",        calc: "mom" },
    { id: "CUSR0000SA0L1E", match: "Core CPI (YoY)",   calc: "yoy" },    // CPI-U Less Food & Energy (SA)
    { id: "CUSR0000SA0L1E", match: "Core CPI (MoM)",   calc: "mom" },
    // ★ 2026-06-12 (대표 제보 2차): 6/11 PPI 가 '발표 대기'로 남음 — PPI 전월비 배선.
    //   시리즈 ID 는 BLS API 실측으로 확정 (WPS=SA): WPSFD4=Final Demand(헤드라인),
    //   WPSFD49104=Less Foods & Energy(코어). 2026-M05 데이터 수신 확인.
    { id: "WPSFD4",         match: "PPI (MoM)",        calc: "mom" },
    { id: "WPSFD49104",     match: "Core PPI (MoM)",   calc: "mom" },
    { id: "LNS14000000",    match: "Unemployment Rate", calc: "direct" }, // Civilian Unemployment Rate (SA)
    { id: "CES0000000001",  match: "Nonfarm Payrolls",  calc: "diff" },   // Total Nonfarm (SA, thousands)
  ];

  const now = new Date();
  const curYear = now.getFullYear();

  try {
    // BLS API v2 POST: startyear/endyear 필수, latest는 GET 전용
    // YoY 계산을 위해 작년~올해 2년치 요청 (최소 13개월 필요)
    const body = {
      seriesid: [...new Set(series.map(s => s.id))], // 같은 시리즈로 YoY/MoM 양쪽 산출 — 중복 요청 제거
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

    if (!resp.ok) return { actuals, byName };
    const json = await resp.json();
    if (json.status !== "REQUEST_SUCCEEDED") return { actuals, byName };

    const curatedEvents = getCuratedEvents2026();
    const todayStr = `${curYear}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;

    // 응답을 시리즈 ID 로 색인 — 같은 시리즈에서 YoY/MoM 두 config 가 읽도록
    const byId = {};
    for (const sd of (json.Results?.series || [])) byId[sd.seriesID] = sd;

    for (const config of series) {
      const seriesData = byId[config.id];
      if (!seriesData) continue;

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
      } else if (config.calc === "mom") {
        // 전월비 % — FF 가 추가하는 'CPI (MoM)'/'Core CPI (MoM)' 행의 발표치
        if (!(prevVal > 0)) continue;
        actual = Math.round(((latestVal - prevVal) / prevVal) * 1000) / 10;
      }

      if (actual == null || isNaN(actual)) continue;

      // curated 이벤트에서 actual이 null인 가장 최근 과거 이벤트와 매칭
      const matching = curatedEvents.filter(e =>
        e.event === config.match && e.actual == null && e.date <= todayStr
      );
      if (matching.length > 0) {
        const target = matching[matching.length - 1];
        actuals[`${target.date}::${target.event}`] = actual;
      } else {
        // curated 에 없는 이벤트(FF 가 런타임 추가하는 MoM 행 등) — 이름 기반 폴백
        byName[config.match] = actual;
      }
    }
  } catch { /* BLS 실패 무시 */ }

  return { actuals, byName };
}

// ══════════════════════════════════════════════════════════════
// 데이터 소스: FRED (Federal Reserve) — 추가 actual 보완
//   ★ 2026-06-12 확장 (대표 질문 "다른 지표들은 어떻게?"):
//   - 커버리지 7→14 시리즈 (전월비·코어 PCE·실업수당·산업생산·기준금리 추가)
//   - BLS 와 동일한 byName 폴백 — FF 가 런타임 추가한 행도 매칭
//   - error 캡처 반환 — ?debug=1 로 키 문제를 1분 안에 진단 가능
//     (이전에 "키 넣어도 안 되던" 원인: 당시 큐레이션에 발표치가 하드코딩돼
//      있어 채울 빈칸이 없었고, 이름 완전일치 매칭이라 효과가 안 보였음)
// ══════════════════════════════════════════════════════════════
async function fetchFREDActuals(todayStr, curated) {
  const actuals = {};
  const byName = {};
  const fredKey = process.env.FRED_API_KEY;
  if (!fredKey) return { actuals, byName, error: "FRED_API_KEY 미설정" };
  let firstError = null;

  const fredSeries = [
    // 물가 (BLS 가 1순위 — FRED 는 백업)
    { id: "CPIAUCSL",         eventMatch: "CPI (YoY)",                yoy: true },
    { id: "CPIAUCSL",         eventMatch: "CPI (MoM)",                mom: true },
    { id: "CPILFESL",         eventMatch: "Core CPI (YoY)",           yoy: true },
    { id: "CPILFESL",         eventMatch: "Core CPI (MoM)",           mom: true },
    // 고용
    { id: "PAYEMS",           eventMatch: "Nonfarm Payrolls",         diff: true },
    { id: "UNRATE",           eventMatch: "Unemployment Rate",        direct: true },
    { id: "ICSA",             eventMatch: "Initial Jobless Claims",   directK: true }, // 주간 신규 청구(명) → K
    // 성장·소비
    { id: "A191RL1Q225SBEA",  eventMatch: "GDP Growth Rate",          direct: true, gdpPrefix: true },
    { id: "RSAFS",            eventMatch: "Retail Sales (MoM)",       mom: true },
    { id: "INDPRO",           eventMatch: "Industrial Production (MoM)", mom: true },
    // PCE (연준 선호 물가)
    { id: "PCEPI",            eventMatch: "PCE Price Index (YoY)",    yoy: true },
    { id: "PCEPILFE",         eventMatch: "Core PCE (YoY)",           yoy: true },
    { id: "PCEPILFE",         eventMatch: "Core PCE (MoM)",           mom: true },
    // 금리 (FOMC 결정 후 상단 목표)
    { id: "DFEDTARU",         eventMatch: "FOMC Rate Decision",       direct: true },
  ];

  // 같은 시리즈 중복 호출 제거 — 관측치 캐시
  const obsCache = {};
  const fetchObs = async (id) => {
    if (obsCache[id]) return obsCache[id];
    const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${id}&sort_order=desc&limit=16&api_key=${fredKey}&file_type=json`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!resp.ok) {
      const t = await resp.text().catch(() => "");
      throw new Error(`${id} HTTP ${resp.status}${t ? ` — ${t.slice(0, 80)}` : ""}`);
    }
    const json = await resp.json();
    const obs = (json?.observations || []).filter(o => o.value !== ".");
    obsCache[id] = obs;
    return obs;
  };

  const fetches = fredSeries.map(async (series) => {
    try {
      const obs = await fetchObs(series.id);
      if (!obs || obs.length < 2) return;

      const latest = parseFloat(obs[0].value);
      const prev   = parseFloat(obs[1].value);
      if (isNaN(latest) || isNaN(prev)) return;

      let actual;
      if (series.direct) actual = latest;
      else if (series.directK) actual = Math.round(latest / 1000); // 명 → K
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

      // ① curated 이름 매칭 (GDP 는 접두 매칭 — Q1 Advance 등)
      const matchingEvents = curated.filter(e =>
        (series.gdpPrefix ? e.event.startsWith("GDP Growth Rate") : e.event === series.eventMatch)
        && e.actual == null && e.date <= todayStr
      );
      if (matchingEvents.length > 0) {
        const target = matchingEvents[matchingEvents.length - 1];
        actuals[`${target.date}::${target.event}`] = actual;
      } else {
        // ② 이름 폴백 — FF 런타임 행(curated 에 없음)도 핸들러에서 귀속
        byName[series.eventMatch] = actual;
      }
    } catch (e) {
      if (!firstError) firstError = e?.message || String(e);
    }
  });

  await Promise.allSettled(fetches);
  return { actuals, byName, error: firstError };
}

// ══════════════════════════════════════════════════════════════
// 데이터 소스: ForexFactory 주간 캘린더 (무키, 이번 주만)
//   실제 컨센서스(트레이딩뷰와 동일 계열)·정확한 발표시각(TZ 포함)을 제공.
//   nextweek 엔드포인트는 404 — thisweek 만 존재 (2026-06-12 curl 실측).
// ══════════════════════════════════════════════════════════════
const FF_MAP = [
  { re: /^CPI y\/y$/i,                  event: "CPI (YoY)",               type: "CPI",      unit: "%" },
  { re: /^Core CPI y\/y$/i,             event: "Core CPI (YoY)",          type: "CPI",      unit: "%" },
  { re: /^CPI m\/m$/i,                  event: "CPI (MoM)",               type: "CPI",      unit: "%" },
  { re: /^Core CPI m\/m$/i,             event: "Core CPI (MoM)",          type: "CPI",      unit: "%" },
  { re: /^PPI m\/m$/i,                  event: "PPI (MoM)",               type: "경제지표", unit: "%" },
  { re: /^Core PPI m\/m$/i,             event: "Core PPI (MoM)",          type: "경제지표", unit: "%" },
  { re: /^Non-Farm Employment Change$/i, event: "Nonfarm Payrolls",       type: "NFP",      unit: "K" },
  { re: /^Unemployment Rate$/i,         event: "Unemployment Rate",       type: "NFP",      unit: "%" },
  { re: /^Federal Funds Rate$/i,        event: "FOMC Rate Decision",      type: "FOMC",     unit: "%" },
  { re: /^Retail Sales m\/m$/i,         event: "Retail Sales (MoM)",      type: "경제지표", unit: "%" },
  { re: /^Core Retail Sales m\/m$/i,    event: "Core Retail Sales (MoM)", type: "경제지표", unit: "%" },
  { re: /GDP q\/q$/i,                   event: "GDP Growth Rate (QoQ)",   type: "GDP",      unit: "%" },
  { re: /^ISM Manufacturing PMI$/i,     event: "ISM Manufacturing PMI",   type: "경제지표", unit: "" },
  { re: /^ISM Services PMI$/i,          event: "ISM Services PMI",        type: "경제지표", unit: "" },
  { re: /^Unemployment Claims$/i,       event: "Initial Jobless Claims",  type: "경제지표", unit: "K" },
  { re: /^Core PCE Price Index m\/m$/i, event: "Core PCE (MoM)",          type: "PCE",      unit: "%" },
  { re: /^Industrial Production m\/m$/i, event: "Industrial Production (MoM)", type: "경제지표", unit: "%" },
];

function parseFFNum(s) {
  if (s == null || s === "") return null;
  const m = String(s).match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}

async function fetchForexFactory() {
  try {
    const resp = await fetch("https://nfs.faireconomy.media/ff_calendar_thisweek.json", {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ZeptaBot/1.0)" },
      signal: AbortSignal.timeout(6000),
    });
    if (!resp.ok) return [];
    const data = await resp.json();
    if (!Array.isArray(data)) return [];
    const out = [];
    for (const e of data) {
      if (e.country !== "USD") continue;
      const map = FF_MAP.find(m => m.re.test(e.title || ""));
      if (!map) continue;
      const dt = e.date; // ISO + TZ (예: 2026-06-10T08:30:00-04:00)
      if (!dt) continue;
      out.push({
        date: String(dt).slice(0, 10),
        dt,
        event: map.event,
        actual: null,
        estimate: parseFFNum(e.forecast),
        previous: parseFFNum(e.previous),
        impact: e.impact || "Medium",
        country: "US",
        unit: map.unit,
        type: map.type,
      });
    }
    return out;
  } catch { return []; }
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
    // ★ 2026-06-12 (대표 제보): CPI 날짜 06-11(추측) → 06-10(실제, ET 8:30 = KST 21:30)로 정정.
    //   미래 이벤트의 손으로 적은 추측 예측치는 제거(null) — 실제 컨센서스는 발표 주에
    //   ForexFactory 가 공급하고 di:econ:estimates 에 영구 보존됨 (추측치 노출 금지).
    { date: "2026-06-05", event: "Nonfarm Payrolls", actual: null, estimate: 155, previous: null, impact: "High", unit: "K", type: "NFP" },
    { date: "2026-06-10", event: "CPI (YoY)", actual: null, estimate: null, previous: null, impact: "High", unit: "%", type: "CPI" },
    { date: "2026-06-10", event: "Core CPI (YoY)", actual: null, estimate: null, previous: null, impact: "High", unit: "%", type: "CPI" },
    { date: "2026-06-17", event: "FOMC Rate Decision", actual: null, estimate: null, previous: null, impact: "High", unit: "%", type: "FOMC" },
    { date: "2026-06-17", event: "Retail Sales (MoM)", actual: null, estimate: null, previous: null, impact: "High", unit: "%", type: "경제지표" },
    { date: "2026-06-27", event: "PCE Price Index (YoY)", actual: null, estimate: null, previous: null, impact: "High", unit: "%", type: "PCE" },
  ];
}
