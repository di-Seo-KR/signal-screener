#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════
// 회귀 테스트 — 경제지표 발표시각 판정 (api/_shared/econ-release-time.js)
// ────────────────────────────────────────────────────────────────────
// 같은 사고("미발표 지표가 발표 완료로 표시")가 4번 재발했고, 4번째 수정
// 직후의 코드 리뷰에서도 가드가 FMP/Finnhub 경로에서 뚫리는 것이 실측으로
// 재현됐습니다. 원인은 estimateReleaseMs 가 벤더의 date 필드에 담긴 실제
// 발표시각을 slice(0,10) 으로 잘라 버리고 08:30 ET 로 추정한 것입니다.
//   · Industrial Production  벤더 date 2026-08-13 13:15:00Z(= 09:15 ET)
//   · Building Permits       벤더 date 2026-08-13 14:00:00Z(= 10:00 ET)
// 둘 다 09:00 ET 시점에 '발표 완료'로 통과했고 actual === previous 였습니다.
// 이 두 케이스를 아래 T1/T2 로 고정합니다.
//
// 사용: node scripts/test-econ-release-time.mjs
// ════════════════════════════════════════════════════════════════════
import {
  estimateReleaseMs,
  isReleasedEvent,
  embeddedReleaseMs,
} from "../api/_shared/econ-release-time.js";

const ms = (iso) => Date.parse(iso);
let failed = 0;

function check(name, actual, expected) {
  const ok = actual === expected;
  if (!ok) {
    failed++;
    console.error(`  ✗ ${name}\n      기대: ${expected}\n      실제: ${actual}`);
  } else {
    console.log(`  ✓ ${name}`);
  }
}

// 2026-08-13 은 미국 서머타임(EDT, UTC-4) 구간입니다.
//   08:30 ET = 12:30Z / 09:15 ET = 13:15Z / 10:00 ET = 14:00Z / 14:00 ET = 18:00Z
const NOW_0900ET = ms("2026-08-13T13:00:00Z"); // 09:00 ET — 리뷰 실측 재현 시점

console.log("[test-econ-release-time] 발표시각 판정 회귀 테스트");

// ── T1 (리뷰 실측 재현): 산업생산 09:15 ET — 09:00 ET 에는 미발표여야 합니다 ──
const t1 = { date: "2026-08-13 13:15:00", event: "Industrial Production (MoM)" };
check("T1 산업생산 — 벤더 발표시각(13:15Z)을 살립니다", estimateReleaseMs(t1), ms("2026-08-13T13:15:00Z"));
check("T1 산업생산 — 09:00 ET 시점엔 미발표", isReleasedEvent(t1, NOW_0900ET), false);
check("T1 산업생산 — 09:20 ET 시점엔 발표됨", isReleasedEvent(t1, ms("2026-08-13T13:20:00Z")), true);

// ── T2 (리뷰 실측 재현): 건축허가 10:00 ET ──
const t2 = { date: "2026-08-13 14:00:00", event: "Building Permits" };
check("T2 건축허가 — 벤더 발표시각(14:00Z)을 살립니다", estimateReleaseMs(t2), ms("2026-08-13T14:00:00Z"));
check("T2 건축허가 — 09:00 ET 시점엔 미발표", isReleasedEvent(t2, NOW_0900ET), false);
check("T2 건축허가 — 10:05 ET 시점엔 발표됨", isReleasedEvent(t2, ms("2026-08-13T14:05:00Z")), true);

// ── T3: 시각 없는 날짜만 오면 종전대로 ET 관례시각 추정 (CPI 08:30 ET) ──
const t3 = { date: "2026-08-13", event: "CPI (YoY)" };
check("T3 CPI — 시각 없음 → 08:30 ET 추정", estimateReleaseMs(t3), ms("2026-08-13T12:30:00Z"));
check("T3 CPI — 08:00 ET 시점엔 미발표", isReleasedEvent(t3, ms("2026-08-13T12:00:00Z")), false);

// ── T4: 산업생산은 09:15 ET 규칙이 추가돼, 시각이 없어도 08:30 으로 열리지 않습니다 ──
check(
  "T4 산업생산 — 시각 없음 → 09:15 ET 추정(08:30 아님)",
  estimateReleaseMs({ date: "2026-08-13", event: "Industrial Production (MoM)" }),
  ms("2026-08-13T13:15:00Z"),
);

// ── T5: 벤더 시각이 관례보다 이르면 '늦은 쪽'을 채택합니다(보수적 방향 유지) ──
check(
  "T5 CPI — 벤더가 04:00Z 로 줘도 08:30 ET(12:30Z) 유지",
  estimateReleaseMs({ date: "2026-08-13 04:00:00", event: "CPI (YoY)" }),
  ms("2026-08-13T12:30:00Z"),
);

// ── T6: FF 가 준 dt(ISO+TZ)가 최우선 ──
check(
  "T6 FF dt 우선 — 08:30-04:00 = 12:30Z",
  estimateReleaseMs({ date: "2026-08-13", dt: "2026-08-13T08:30:00-04:00", event: "CPI (YoY)" }),
  ms("2026-08-13T12:30:00Z"),
);

// ── T7: FOMC 는 14:00 ET ──
check(
  "T7 FOMC — 14:00 ET(18:00Z)",
  estimateReleaseMs({ date: "2026-09-16", event: "FOMC Rate Decision" }),
  ms("2026-09-16T18:00:00Z"),
);

// ── T8: 겨울(EST, UTC-5) 구간도 정확히 ──
check(
  "T8 CPI 12월 — 08:30 EST = 13:30Z",
  estimateReleaseMs({ date: "2026-12-10", event: "CPI (YoY)" }),
  ms("2026-12-10T13:30:00Z"),
);

// ── T9: 시각 파싱 유틸 자체 ──
check("T9 embedded — 날짜만이면 NaN", Number.isNaN(embeddedReleaseMs("2026-08-13")), true);
check("T9 embedded — 오프셋 표기는 존중", embeddedReleaseMs("2026-08-13T08:30:00-04:00"), ms("2026-08-13T12:30:00Z"));

// ── T10: 시각을 못 구하면 '미발표'(보수적) ──
check("T10 date 없음 → null", estimateReleaseMs({ event: "CPI (YoY)" }), null);
check("T10 date 없음 → 미발표 처리", isReleasedEvent({ event: "CPI (YoY)" }, NOW_0900ET), false);

if (failed > 0) {
  console.error(`[test-econ-release-time] 실패 ${failed}건 — 발표시각 가드가 뚫립니다. 배포 금지.`);
  process.exit(1);
}
console.log("[test-econ-release-time] 통과 — 전 케이스 정상");
