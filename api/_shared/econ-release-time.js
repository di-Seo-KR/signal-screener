// ════════════════════════════════════════════════════════════════════
// 경제지표 "발표 시각" 판정 공용 모듈 (SSOT)
// ────────────────────────────────────────────────────────────────────
// 왜 공용인가 — "미발표 지표가 발표 완료로 표시" 사고가 4번 재발했는데,
// 판정 규칙이 api/econ-calendar.js 안에만 있었습니다. 하류 소비자
// (api/agents/econ-results.js → /econ/{date}-{slug} 영구 페이지)는 여전히
// '날짜만' 비교하고 있어 같은 결함이 재현될 자리가 남아 있었습니다.
// 규칙을 한 곳에 두어 표류를 막습니다.
//
// ── 판정 우선순위 ────────────────────────────────────────────────
//   ① e.dt — ForexFactory 가 준 ISO+TZ 발표시각. 가장 정확합니다.
//   ② e.date 에 박힌 시각 — Finnhub/FMP 의 date 는 'YYYY-MM-DD HH:MM:SS'
//      (UTC) 형식으로 실제 발표시각을 담고 있습니다(src/App.jsx 의 응답
//      파서도 '형식 B: UTC 시각 포함'으로 같은 전제를 씁니다).
//      ★ 이전 구현은 slice(0,10) 으로 이 시각을 버리고 08:30 ET 로
//        추정했습니다. FF 가 dt 를 주는 건 이번 주 매칭 지표뿐이라 나머지
//        행이 전부 08:30 ET 추정으로 떨어졌고, 실제로는 더 늦게 발표되는
//        지표(산업생산 09:15 ET, 건축허가·재고 10:00 ET 등)의 가드가
//        실제보다 45~90분 먼저 열렸습니다.
//   ③ 지표별 ET 관례 시각 추정 — 대부분 08:30, 산업생산·설비가동률 09:15,
//      ISM·소비자심리·주택판매 10:00, 원유재고 10:30, FOMC 14:00.
//
//   ②와 ③이 모두 구해지면 **늦은 쪽**을 채택합니다. 가드는 보수적일수록
//   안전합니다 — "실제 발표치가 잠깐 늦게 뜨는 것" < "가짜 수치가 뜨는 것".
// ════════════════════════════════════════════════════════════════════

export const ET_TZ = "America/New_York";

/** 특정 시점(ts)에서 tz 의 UTC 오프셋(분). ICU 사용 불가 시 null */
export function tzOffsetMinutes(ts, tz = ET_TZ) {
  try {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hour12: false,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    const p = {};
    for (const part of dtf.formatToParts(new Date(ts))) p[part.type] = part.value;
    const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, (+p.hour) % 24, +p.minute, +p.second);
    if (!Number.isFinite(asUTC)) return null;
    return Math.round((asUTC - ts) / 60000);
  } catch { return null; }
}

/** 미국 동부시간 벽시계(dateStr hh:mm ET) → UTC epoch ms */
export function etWallClockToUtcMs(dateStr, hh, mm) {
  const naive = Date.parse(`${dateStr}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00Z`);
  if (!Number.isFinite(naive)) return null;
  let ts = naive;
  for (let i = 0; i < 2; i++) {
    const off = tzOffsetMinutes(ts, ET_TZ);
    // ICU 미탑재 등으로 오프셋을 못 구하면 EST(-5)로 보수 가정 — 발표시각을
    // 실제보다 늦게 잡아 가짜 수치가 새어나가지 않도록 합니다.
    if (off == null) return naive + 5 * 3600000;
    ts = naive - off * 60000;
  }
  return ts;
}

// 지표명 → ET 관례 발표시각. 위에서부터 먼저 걸리는 규칙을 씁니다.
export const RELEASE_TIME_ET = [
  { re: /fomc|federal funds|rate decision/i, h: 14, m: 0 },
  { re: /crude oil inventories|eia petroleum/i, h: 10, m: 30 },
  // 산업생산·설비가동률은 연준 발표라 09:15 ET (08:30 로 추정하면 45분 일찍 열립니다)
  { re: /industrial production|capacity utilization/i, h: 9, m: 15 },
  // \bism\b — 'optimism' 같은 단어에 걸리지 않도록 단어 경계로 제한합니다
  { re: /\bism\b|consumer confidence|consumer sentiment|michigan|jolts|factory orders|home sales|construction spending|business inventories|wholesale inventories/i, h: 10, m: 0 },
  // 그 외 미국 주요 지표(CPI·PPI·NFP·GDP·PCE·소매판매·실업수당)는 08:30 ET 관례
  //
  // ※ 건축허가·주택착공(Census 신규주택건설)은 공식 08:30 ET 라 여기 넣지 않습니다.
  //   벤더가 10:00 ET 로 표기하는 경우가 있는데, 그건 아래 embeddedReleaseMs 가
  //   date 필드의 실제 시각을 살려 max() 로 반영하므로 규칙을 틀리게 적을 필요가 없습니다.
];

/**
 * 벤더가 date 필드에 박아 보낸 발표시각(UTC) → epoch ms.
 * 'YYYY-MM-DD HH:MM(:SS)' 또는 ISO 형식만 인정하며, 오프셋 표기가 없으면
 * UTC 로 해석합니다(Finnhub/FMP 실측 규격). 시각이 없으면 NaN.
 */
export function embeddedReleaseMs(raw) {
  const s = String(raw || "");
  if (!/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(s)) return NaN;
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(s);
  const t = Date.parse(s.replace(" ", "T") + (hasZone ? "" : "Z"));
  return Number.isFinite(t) ? t : NaN;
}

/**
 * 이벤트의 발표(예정) 시각 epoch ms.
 * dt → date 내장 시각 / ET 관례 추정 중 늦은 쪽. 구할 수 없으면 null.
 */
export function estimateReleaseMs(e) {
  if (e?.dt) {
    const t = Date.parse(e.dt);
    if (Number.isFinite(t)) return t;
  }
  if (!e?.date) return null;
  const raw = String(e.date);
  const rule = RELEASE_TIME_ET.find(r => r.re.test(e.event || ""));
  const conv = etWallClockToUtcMs(raw.slice(0, 10), rule ? rule.h : 8, rule ? rule.m : 30);
  const emb = embeddedReleaseMs(raw);
  if (!Number.isFinite(emb)) return conv;
  return conv == null ? emb : Math.max(emb, conv); // 보수적으로 늦은 쪽
}

/**
 * 이미 발표된 이벤트인가.
 * 시각을 못 구하면 '미발표'로 간주합니다(귀속 대상에서 제외 — 보수적).
 */
export function isReleasedEvent(e, nowMs) {
  const t = estimateReleaseMs(e);
  return t != null && t <= nowMs;
}
