#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════
// 배포 전 검출 — 경제 캘린더 큐레이션 골격 규격 검사
// ────────────────────────────────────────────────────────────────────
// api/econ-calendar.js 의 getCuratedEvents2026() 내부 런타임 가드
// (수치 하드코딩 금지·주말 발표일 금지)는 요청 시점에 throw 하므로,
// 위반이 다시 들어오면 /api/econ-calendar 전체가 500 이 되는 구조입니다.
// 이 스크립트는 같은 가드를 빌드 단계에서 먼저 실행해, 위반이
// 프로덕션 전면 장애가 아니라 빌드 실패로 걸러지게 합니다.
//
// 사용: node scripts/check-econ-skeleton.mjs
//   (package.json "build" 앞단에 && 로 연결해 주세요 —
//    예: "node scripts/check-econ-skeleton.mjs && vite build && ...")
// ════════════════════════════════════════════════════════════════════
import { getCuratedEvents2026 } from "../api/econ-calendar.js";

try {
  // 호출 자체가 런타임 가드(수치 하드코딩·주말 발표일 검사)를 실행합니다.
  const events = getCuratedEvents2026();

  // 보조 검사 — 날짜 형식·필수 필드 확인
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const bad = events.filter((e) => !DATE_RE.test(e.date) || !e.event || !e.type);
  if (bad.length > 0) {
    throw new Error(`날짜/이벤트명 형식 위반 ${bad.length}건 — 첫 건: ${JSON.stringify(bad[0])}`);
  }

  const dates = events.map((e) => e.date).sort();
  console.log(
    `[check-econ-skeleton] 통과 — ${events.length}행, ${dates[0]} ~ ${dates[dates.length - 1]} (수치 하드코딩 0건·주말 발표일 0건)`,
  );
} catch (err) {
  console.error(`[check-econ-skeleton] 실패 — ${err?.message || err}`);
  console.error("큐레이션 골격 규격 위반입니다. api/econ-calendar.js 의 getCuratedEvents2026() 를 수정해 주세요.");
  process.exit(1);
}
