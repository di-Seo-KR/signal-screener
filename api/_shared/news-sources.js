// ════════════════════════════════════════════════════════════════════
// 네이버 검색 오픈 API 기반 뉴스 소싱 공유 모듈
// ────────────────────────────────────────────────────────────────────
// 2026-08 (대표 지시 — "지금 마켓 뉴스가 그냥 답이 없다"):
//   기존 /api/news 는 Yahoo·Google News RSS 를 긁어 키워드로 거르는 구조라
//   ① 기사 원문 언론사가 뭉개지고 ② 트렌딩 랭킹 알림이 뉴스로 섞이고
//   ③ 한국 시장 기사가 사실상 안 잡히는 문제가 있었습니다.
//   대표의 기존 프로젝트(KBCI 뉴스)가 쓰던 네이버 검색 오픈 API 구조를
//   Zepta(Vercel serverless + @vercel/kv, ESM) 로 번역해 이식합니다.
//
// ── 설계 요약 ─────────────────────────────────────────────────────
//   카테고리(4종) × 키워드(31개)를 순회 수집 → 정규화 → 품질 필터 →
//   중복 제거 → 카테고리별 상한(각 60건) → KV 풀(최근 300건) 적재.
//   수집은 크론(api/agents/news-collect.js)이, 배급은 api/news.js 가 맡습니다.
//
// ── 품질 필터 4단 ─────────────────────────────────────────────────
//   (a) link 기준 중복 + 제목 정규화(공백·특수문자 제거) 유사중복 제거
//   (b) 광고성·연예·스포츠 블랙리스트(정규식) 및 보도자료 배포처 도메인 제외
//   (c) 제목 15자 미만 제외 (단신·사진기사 등 정보량 없는 항목)
//   (d) 24시간 초과 기사 제외 (수집 시점 기준)
//   추가로 네이버 검색이 넘겨준 기사가 실제 그 키워드를 담고 있는지
//   재검증합니다(KBCI 의 strict keyword filter 이식 — 노이즈 체감 감소가 큽니다).
//
// ── 필요 환경변수 ─────────────────────────────────────────────────
//   NAVER_CLIENT_ID / NAVER_CLIENT_SECRET  (미설정 시 이 모듈은 무동작)
//   KV_REST_API_URL / KV_REST_API_TOKEN    (풀 적재/조회)
//
// 이 모듈의 모든 함수는 throw 하지 않습니다 — 실패는 반환값으로만 알립니다.
// ════════════════════════════════════════════════════════════════════

const NAVER_ENDPOINT = "https://openapi.naver.com/v1/search/news.json";

/** KV 키 — 수집기(news-collect)와 배급기(news.js)가 공유합니다. */
export const NEWS_POOL_KEY = "di:news:pool";
export const NEWS_UPDATED_KEY = "di:news:updatedAt";
export const NEWS_LOCK_KEY = "di:news:collect-lock";

/** 풀 유지 정책 */
export const POOL_MAX_ITEMS = 300;        // 전체 상한
export const POOL_PER_CATEGORY = 60;      // 카테고리별 상한(편중 방지)
export const POOL_MAX_AGE_MS = 48 * 60 * 60 * 1000; // 풀 보관 상한(48시간)
export const COLLECT_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 수집 편입 상한(24시간)

// ── 카테고리 · 키워드 세트 ────────────────────────────────────────
// 네이버 검색은 키워드가 일반적일수록 노이즈가 급증합니다.
// ("증시" 같은 단어는 광고·잡보가 절반) → 아래 수준의 구체성을 유지합니다.
// 공백이 들어간 키워드는 네이버에서 AND 검색으로 동작하므로,
// 본문 재검증도 동일하게 "모든 토큰 포함"으로 판정합니다.
export const NEWS_CATEGORIES = [
  {
    id: "crypto",
    label: "크립토",
    keywords: [
      "비트코인",
      "이더리움",
      "알트코인",
      "가상자산",
      "스테이블코인",
      "업비트",
      "빗썸",
      "코인 규제",
      "가상자산 ETF",
    ],
  },
  {
    id: "kr-stock",
    label: "한국증시",
    keywords: [
      "코스피",
      "코스닥",
      "삼성전자",
      "SK하이닉스",
      "개인 순매수",
      "외국인 수급",
      "공매도",
      "국내 증시",
    ],
  },
  {
    id: "us-stock",
    label: "미국증시",
    keywords: [
      "나스닥",
      "S&P500",
      "엔비디아",
      "테슬라",
      "애플",
      "미국 증시",
      "어닝 서프라이즈",
    ],
  },
  {
    id: "macro",
    label: "거시경제",
    keywords: [
      "연준",
      "기준금리",
      "FOMC",
      "CPI 물가",
      "환율 원달러",
      "국채 금리",
      "고용지표",
    ],
  },
];

/** 카테고리 id → 정의 객체 */
export function getNewsCategory(id) {
  return NEWS_CATEGORIES.find((c) => c.id === id) || null;
}

/** 유효한 카테고리 id 인지 */
export function isNewsCategoryId(id) {
  return NEWS_CATEGORIES.some((c) => c.id === id);
}

// ── 텍스트 유틸 ───────────────────────────────────────────────────

/** 네이버 응답의 <b> 태그·HTML 엔티티를 제거합니다. */
export function stripHtml(text) {
  return String(text || "")
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** URL → 호스트명(www. 제거). 파싱 실패 시 원문을 그대로 돌려줍니다. */
export function hostOf(url) {
  try {
    return new URL(String(url)).hostname.replace(/^www\./, "");
  } catch {
    return String(url || "");
  }
}

// 주요 언론사 호스트 → 한글 표기.
// 화면에 "yna.co.kr" 대신 "연합뉴스"가 뜨도록 하기 위한 표시용 매핑입니다.
// 목록에 없으면 호스트명을 그대로 노출합니다(누락돼도 동작에는 지장 없음).
const PRESS_NAMES = {
  "yna.co.kr": "연합뉴스",
  "yonhapnewstv.co.kr": "연합뉴스TV",
  "hankyung.com": "한국경제",
  "wowtv.co.kr": "한국경제TV",
  "mk.co.kr": "매일경제",
  "sedaily.com": "서울경제",
  "edaily.co.kr": "이데일리",
  "fnnews.com": "파이낸셜뉴스",
  "mt.co.kr": "머니투데이",
  "moneys.co.kr": "머니S",
  "news1.kr": "뉴스1",
  "newsis.com": "뉴시스",
  "chosun.com": "조선일보",
  "biz.chosun.com": "조선비즈",
  "joongang.co.kr": "중앙일보",
  "donga.com": "동아일보",
  "hani.co.kr": "한겨레",
  "khan.co.kr": "경향신문",
  "seoul.co.kr": "서울신문",
  "kmib.co.kr": "국민일보",
  "munhwa.com": "문화일보",
  "segye.com": "세계일보",
  "hankookilbo.com": "한국일보",
  "asiae.co.kr": "아시아경제",
  "heraldcorp.com": "헤럴드경제",
  "etnews.com": "전자신문",
  "zdnet.co.kr": "ZDNet코리아",
  "dt.co.kr": "디지털타임스",
  "inews24.com": "아이뉴스24",
  "ajunews.com": "아주경제",
  "thebell.co.kr": "더벨",
  "infostockdaily.co.kr": "인포스탁데일리",
  "newspim.com": "뉴스핌",
  "ebn.co.kr": "EBN",
  "dailian.co.kr": "데일리안",
  "sbs.co.kr": "SBS",
  "sbsbiz.co.kr": "SBS Biz",
  "imbc.com": "MBC",
  "kbs.co.kr": "KBS",
  "ytn.co.kr": "YTN",
  "mbn.co.kr": "MBN",
  "jtbc.co.kr": "JTBC",
  "naver.com": "네이버뉴스",
  "tokenpost.kr": "토큰포스트",
  "blockmedia.co.kr": "블록미디어",
  "coinreaders.com": "코인리더스",
  "cointelegraph.co.kr": "코인텔레그래프",
  "decenter.kr": "디센터",
  "bloter.net": "블로터",
  "coindeskkorea.com": "코인데스크코리아",
};

/** 호스트 → 언론사 표기(서브도메인 허용). 매핑이 없으면 호스트 그대로. */
export function pressNameOf(host) {
  const h = String(host || "").toLowerCase();
  if (!h) return "";
  if (PRESS_NAMES[h]) return PRESS_NAMES[h];
  for (const key of Object.keys(PRESS_NAMES)) {
    if (h.endsWith("." + key)) return PRESS_NAMES[key];
  }
  return h;
}

/**
 * 제목 유사중복 판정용 정규화 키.
 * 대괄호·괄호 안 수식어와 모든 공백·특수문자를 지운 뒤 앞 30자만 사용합니다.
 * (같은 기사를 여러 매체가 받아쓴 경우를 하나로 묶는 목적입니다)
 */
export function normalizeTitleKey(title) {
  return stripHtml(title)
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/[^\p{L}\p{N}]/gu, "")
    .slice(0, 30);
}

// ── 품질 필터 ─────────────────────────────────────────────────────

// 광고성·연예·스포츠·생활 잡보 제외 패턴.
// 과잉 차단을 피하려고 단어 단독이 아니라 맥락이 드러나는 형태로만 잡습니다.
const BLOCK_PATTERNS = [
  // ① 투자 유인·광고성
  /리딩\s*방|무료\s*(추천|상담|체험|가입|강의)|추천\s*(주|종목)|급등주\s*(포착|공개)|수익률?\s*인증|회원\s*모집|투자\s*설명회/,
  /쿠폰|최저가|공동\s*구매|프로모션|사은품|경품\s*증정|당첨자\s*발표|특가\s*판매|모델하우스|분양\s*(안내|홍보)/,
  /대출\s*(상담|비교)|보험료\s*비교|카지노|바카라|스포츠\s*토토|로또|오늘의\s*운세|주간\s*운세|사주\s*풀이/,
  /에어드[랍롭]\s*이벤트|코인\s*무료\s*지급|텔레그램\s*(방|리딩)/,
  /\[(AD|광고|협찬|보도자료|PR|기고)\]/i,
  // ② 연예·문화
  /연예\s*(가|계)|아이돌|팬미팅|컴백\s*무대|뮤직비디오|열애설|결혼설|이혼\s*조정|시상식\s*레드카펫|드라마\s*시청률|예능\s*프로/,
  // ③ 스포츠
  /프로야구|프로축구|KBO\s*리그|MLB|EPL|손흥민|류현진|선발\s*투수|승부차기|올림픽\s*메달|월드컵\s*예선|프로농구|프로배구|골프\s*대회/,
  // ④ 정보량 없는 정형 기사
  /\[(부고|인사|동정|포토|화보|영상|카드뉴스|모집공고|알림)\]/,
  /별세|訃告/,
];

// 보도자료 배포 대행처 — 기사 형식이지만 실질은 홍보물이라 제외합니다.
const BLOCKED_HOSTS = [
  "newswire.co.kr",
  "prnewswire.com",
  "businesswire.com",
  "globenewswire.com",
];

/** 제목+요약이 블랙리스트에 걸리는지 */
export function isBlockedContent(title, desc) {
  const text = `${title || ""} ${desc || ""}`;
  return BLOCK_PATTERNS.some((re) => re.test(text));
}

/** 보도자료 배포처 도메인인지 */
export function isBlockedHost(host) {
  const h = String(host || "").toLowerCase();
  return BLOCKED_HOSTS.some((b) => h === b || h.endsWith("." + b));
}

/**
 * 기사 본문(제목+요약)이 검색 키워드를 실제로 담고 있는지 재검증합니다.
 * 네이버는 공백을 AND 로 처리하므로 여기서도 "모든 토큰 포함"으로 봅니다.
 */
export function matchesKeyword(title, desc, keyword) {
  const haystack = `${title || ""} ${desc || ""}`.toLowerCase();
  const tokens = String(keyword || "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length === 0) return false;
  return tokens.every((tk) => haystack.includes(tk));
}

// ── 네이버 API 호출 ───────────────────────────────────────────────

/** 네이버 오픈 API 키가 설정돼 있는지 */
export function hasNaverCredentials() {
  return Boolean(process.env.NAVER_CLIENT_ID && process.env.NAVER_CLIENT_SECRET);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 네이버 뉴스 검색 1회 호출. 429/5xx 는 1회 재시도합니다.
 * @returns {Promise<{ok:boolean, items:Array, status:number, error?:string}>}
 */
export async function fetchNaverNews({
  query,
  display = 30,
  sort = "date",
  timeoutMs = 3000,
  retryDelayMs = 600,
} = {}) {
  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return { ok: false, items: [], status: 0, error: "credentials-missing" };
  }
  const safeDisplay = Math.max(1, Math.min(100, Number(display) || 30));
  const safeSort = sort === "sim" ? "sim" : "date";
  const url =
    `${NAVER_ENDPOINT}?query=${encodeURIComponent(query)}` +
    `&display=${safeDisplay}&sort=${safeSort}`;

  let lastStatus = 0;
  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          "X-Naver-Client-Id": clientId,
          "X-Naver-Client-Secret": clientSecret,
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
      lastStatus = res.status;
      if (res.ok) {
        const data = await res.json();
        return { ok: true, items: Array.isArray(data?.items) ? data.items : [], status: res.status };
      }
      // 429(쿼터/속도 제한)·5xx(일시 장애)만 1회 재시도 — 4xx 는 재시도 무의미
      if ((res.status === 429 || res.status >= 500) && attempt === 0) {
        await sleep(retryDelayMs);
        continue;
      }
      return { ok: false, items: [], status: res.status, error: `http-${res.status}` };
    } catch (e) {
      lastError = e?.name === "TimeoutError" ? "timeout" : String(e?.message || e);
      if (attempt === 0) {
        await sleep(retryDelayMs);
        continue;
      }
    }
  }
  return { ok: false, items: [], status: lastStatus, error: lastError || "fetch-failed" };
}

// ── 정규화 ────────────────────────────────────────────────────────

/**
 * 네이버 원본 항목 → Zepta 뉴스 스키마.
 * 기존 프론트(App.jsx)가 쓰는 필드명을 그대로 유지합니다:
 *   title / url / date / desc / source / tags  (+ 이번에 추가한 category)
 * 품질 기준에 못 미치면 null 을 반환합니다.
 */
export function normalizeNaverItem(raw, { categoryId, categoryLabel, keyword, now = Date.now(), maxAgeMs = COLLECT_MAX_AGE_MS } = {}) {
  if (!raw) return null;

  const title = stripHtml(raw.title);
  const desc = stripHtml(raw.description).slice(0, 200);
  if (!title) return null;

  // (c) 제목 15자 미만 제외
  if (title.length < 15) return null;

  // 키워드 재검증 — 검색엔진이 넘겨준 무관 기사 제거
  if (keyword && !matchesKeyword(title, desc, keyword)) return null;

  // (b) 블랙리스트
  if (isBlockedContent(title, desc)) return null;

  // originallink(원문 언론사 URL) 우선 — 없으면 네이버 링크
  const url = String(raw.originallink || raw.link || "").trim();
  if (!url) return null;

  const host = hostOf(url);
  if (isBlockedHost(host)) return null;

  // pubDate → ISO. 파싱 실패·미래 시각(1시간 초과)·(d) 24시간 초과는 제외
  const parsed = new Date(raw.pubDate);
  const ts = parsed.getTime();
  if (!Number.isFinite(ts)) return null;
  if (ts > now + 60 * 60 * 1000) return null;
  if (maxAgeMs > 0 && now - ts > maxAgeMs) return null;

  const tags = [];
  if (categoryLabel) tags.push(categoryLabel);
  if (keyword && keyword !== categoryLabel) tags.push(keyword);

  return {
    title,
    url,
    date: parsed.toISOString(),
    desc,
    source: pressNameOf(host),
    tags,
    category: categoryId || "",
    categories: categoryId ? [categoryId] : [],
  };
}

// ── 중복 제거 ─────────────────────────────────────────────────────

/**
 * (a) link 기준 중복 + 제목 정규화 유사중복 제거.
 * 먼저 들어온 항목을 살리고, 뒤에 온 중복은 카테고리·태그만 병합합니다.
 * 입력 순서가 곧 우선순위이므로 호출 전에 원하는 순서로 정렬해 주세요.
 */
export function dedupeArticles(articles) {
  const byUrl = new Map();
  const titleKeyToUrl = new Map();
  let dropped = 0;

  for (const a of Array.isArray(articles) ? articles : []) {
    if (!a || !a.url || !a.title) continue;
    const titleKey = normalizeTitleKey(a.title);
    const existing =
      byUrl.get(a.url) ||
      (titleKey && titleKeyToUrl.has(titleKey) ? byUrl.get(titleKeyToUrl.get(titleKey)) : undefined);

    if (existing) {
      dropped += 1;
      // 카테고리 병합 — 같은 기사가 여러 축에 걸릴 수 있습니다(예: 연준+미국증시)
      const cats = new Set([...(existing.categories || []), ...(a.categories || [])]);
      existing.categories = Array.from(cats);
      // 태그는 표시용이라 3개까지만 유지합니다
      const tags = new Set([...(existing.tags || []), ...(a.tags || [])]);
      existing.tags = Array.from(tags).slice(0, 3);
      continue;
    }

    const row = { ...a, categories: [...(a.categories || [])], tags: [...(a.tags || [])] };
    byUrl.set(row.url, row);
    if (titleKey) titleKeyToUrl.set(titleKey, row.url);
  }

  return { articles: Array.from(byUrl.values()), dropped };
}

/**
 * 최신순 정렬 + 카테고리별 상한 + 전체 상한 + 보관 기간 정리.
 * 한 카테고리(예: 코스피)가 풀을 독식하는 편중을 막습니다.
 */
export function capAndSortArticles(articles, {
  perCategory = POOL_PER_CATEGORY,
  total = POOL_MAX_ITEMS,
  maxAgeMs = POOL_MAX_AGE_MS,
  now = Date.now(),
} = {}) {
  const fresh = (Array.isArray(articles) ? articles : []).filter((a) => {
    if (!a || !a.date) return false;
    const ts = new Date(a.date).getTime();
    if (!Number.isFinite(ts)) return false;
    return maxAgeMs <= 0 || now - ts <= maxAgeMs;
  });

  fresh.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const counts = new Map();
  const out = [];
  for (const a of fresh) {
    const cat = a.category || "etc";
    const n = counts.get(cat) || 0;
    if (perCategory > 0 && n >= perCategory) continue;
    counts.set(cat, n + 1);
    out.push(a);
    if (total > 0 && out.length >= total) break;
  }
  return out;
}

// ── 수집 오케스트레이션 ───────────────────────────────────────────

/**
 * 전 카테고리 × 키워드 순회 수집.
 * 네이버 속도 제한을 피하려고 배치(기본 5개)로 나눠 호출하고 배치 간 지연을 둡니다.
 *
 * @param {object} opts
 *  - keywordsPerCategory: 카테고리당 사용할 키워드 수(0 = 전체). lazy 수집에서 축소용
 *  - display: 키워드당 요청 건수(최대 100)
 *  - batchSize / batchDelayMs: 병렬 배치 크기와 배치 간 지연
 *  - maxAgeMs: 편입 허용 기사 나이(기본 24시간)
 *  - timeoutMs: 개별 호출 타임아웃
 * @returns {Promise<{ok:boolean, reason?:string, articles:Array, stats:object}>}
 */
export async function collectNaverNews({
  categories = NEWS_CATEGORIES,
  keywordsPerCategory = 0,
  display = 30,
  batchSize = 5,
  batchDelayMs = 300,
  maxAgeMs = COLLECT_MAX_AGE_MS,
  timeoutMs = 3000,
  now = Date.now(),
} = {}) {
  const t0 = Date.now();
  if (!hasNaverCredentials()) {
    return { ok: false, reason: "naver-credentials-missing", articles: [], stats: { elapsedMs: 0 } };
  }

  const tasks = [];
  for (const cat of categories) {
    const kws = keywordsPerCategory > 0 ? cat.keywords.slice(0, keywordsPerCategory) : cat.keywords;
    for (const keyword of kws) {
      tasks.push({ categoryId: cat.id, categoryLabel: cat.label, keyword });
    }
  }

  let fetched = 0;
  let succeeded = 0;
  const failures = [];
  const collected = [];

  for (let i = 0; i < tasks.length; i += batchSize) {
    const batch = tasks.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(async (task) => ({
        task,
        res: await fetchNaverNews({ query: task.keyword, display, sort: "date", timeoutMs }),
      })),
    );
    for (const { task, res } of results) {
      if (!res.ok) {
        failures.push({ keyword: task.keyword, status: res.status, error: res.error });
        continue;
      }
      succeeded += 1;
      fetched += res.items.length;
      for (const raw of res.items) {
        const article = normalizeNaverItem(raw, {
          categoryId: task.categoryId,
          categoryLabel: task.categoryLabel,
          keyword: task.keyword,
          now,
          maxAgeMs,
        });
        if (article) collected.push(article);
      }
    }
    if (i + batchSize < tasks.length && batchDelayMs > 0) await sleep(batchDelayMs);
  }

  if (succeeded === 0) {
    return {
      ok: false,
      reason: "all-requests-failed",
      articles: [],
      stats: { tasks: tasks.length, fetched, failures, elapsedMs: Date.now() - t0 },
    };
  }

  const { articles, dropped } = dedupeArticles(collected);

  return {
    ok: true,
    articles,
    stats: {
      tasks: tasks.length,
      succeeded,
      fetched,                 // 네이버가 돌려준 원본 건수
      passedFilter: collected.length, // 품질 필터 통과 건수
      dedupDropped: dropped,
      unique: articles.length,
      failures,
      elapsedMs: Date.now() - t0,
    },
  };
}

// ── KV 접근 (env 없으면 조용히 null) ──────────────────────────────

/** @vercel/kv 는 env 미설정 시 접근 시점에 throw 하므로 사전 체크합니다. */
export async function getKvSafe() {
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) return null;
  try {
    return (await import("@vercel/kv")).kv;
  } catch {
    return null;
  }
}

/** KV 에서 뉴스 풀과 갱신 시각을 읽습니다. 실패 시 빈 풀. */
export async function readNewsPool() {
  const kv = await getKvSafe();
  if (!kv) return { pool: [], updatedAt: null, kv: null };
  try {
    const [pool, updatedAt] = await Promise.all([
      kv.get(NEWS_POOL_KEY),
      kv.get(NEWS_UPDATED_KEY),
    ]);
    return {
      pool: Array.isArray(pool) ? pool : [],
      updatedAt: typeof updatedAt === "string" ? updatedAt : null,
      kv,
    };
  } catch {
    return { pool: [], updatedAt: null, kv };
  }
}

/**
 * 새로 수집한 기사를 기존 풀에 병합해 저장합니다.
 * 새 기사를 앞에 두어(입력 순서 = 우선순위) 최신 정보가 살아남게 합니다.
 * @returns {Promise<{ok:boolean, size:number, added:number}>}
 */
export async function writeNewsPool(freshArticles, { existingPool = null, now = Date.now() } = {}) {
  const kv = await getKvSafe();
  if (!kv) return { ok: false, size: 0, added: 0, reason: "kv-unavailable" };

  let base = existingPool;
  if (!Array.isArray(base)) {
    try {
      const prev = await kv.get(NEWS_POOL_KEY);
      base = Array.isArray(prev) ? prev : [];
    } catch {
      base = [];
    }
  }

  const before = base.length;
  const merged = dedupeArticles([...(freshArticles || []), ...base]).articles;
  const pool = capAndSortArticles(merged, { now });

  try {
    await kv.set(NEWS_POOL_KEY, pool);
    await kv.set(NEWS_UPDATED_KEY, new Date(now).toISOString());
  } catch (e) {
    return { ok: false, size: pool.length, added: 0, reason: String(e?.message || e) };
  }
  return { ok: true, size: pool.length, added: Math.max(0, pool.length - before) };
}

/**
 * 동시 수집 방지 락(NX). 획득 실패 시 false — 호출부는 기존 풀을 그대로 씁니다.
 * KV 미설정 환경에서는 락 없이 진행합니다(true).
 */
export async function acquireCollectLock(ttlSec = 120) {
  const kv = await getKvSafe();
  if (!kv) return true;
  try {
    const ok = await kv.set(NEWS_LOCK_KEY, String(Date.now()), { nx: true, ex: ttlSec });
    return ok === "OK" || ok === true;
  } catch {
    return true; // 락 자체가 실패하면 수집을 막지 않습니다
  }
}

/** 수집 락 해제 (실패는 무시 — TTL 로 자동 만료됩니다) */
export async function releaseCollectLock() {
  const kv = await getKvSafe();
  if (!kv) return;
  try {
    await kv.del(NEWS_LOCK_KEY);
  } catch {
    /* TTL 만료에 맡깁니다 */
  }
}

export default {
  NEWS_CATEGORIES,
  NEWS_POOL_KEY,
  NEWS_UPDATED_KEY,
  getNewsCategory,
  isNewsCategoryId,
  hasNaverCredentials,
  fetchNaverNews,
  normalizeNaverItem,
  dedupeArticles,
  capAndSortArticles,
  collectNaverNews,
  readNewsPool,
  writeNewsPool,
};
