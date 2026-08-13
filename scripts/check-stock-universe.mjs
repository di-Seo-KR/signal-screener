// scripts/check-stock-universe.mjs
//
// 주식 유니버스 무결성 빌드 가드 — check-econ-skeleton.mjs 와 같은 자리(빌드 선행)에서 돕니다.
//
// ★ 왜 필요한가 (2026-08-13): 유니버스를 51종 → 1,081종으로 확대하면서 종목을 배치로
//   덧붙이게 됐는데, 2차 보강 때 같은 티커가 조사 결과의 ready/accumulating 양쪽에
//   분류돼 배열에 **중복 1건**이 실제로 들어갔습니다. 중복이 있으면 스캔 예산을 헛되이
//   쓰고 보드에 같은 종목이 두 번 뜹니다. 사람 눈으로 1,000줄을 세는 대신 빌드가 막습니다.
//
// 검사 항목 (실패 시 빌드 중단):
//   1. symbol 중복
//   2. 필수 필드 결손 (symbol/name 이 비었거나 market 이 us|kr 이 아님)
//   3. 이름 자리에 "미확인/미제공" 류 플레이스홀더 — 등재되면 화면에 빈 이름이 렌더됨
//   4. listedAt 형식(YYYY-MM-DD) 및 미래 날짜 여부
//   5. 한국 티커의 접미사(.KS/.KQ) 정합 — market:"kr" 인데 접미사가 없으면 야후가 못 찾음

import { STOCK_UNIVERSE } from "../api/_shared/stock-universe.js";

const errors = [];
const warns = [];

// 1. 중복
const seen = new Map();
for (const u of STOCK_UNIVERSE) seen.set(u.symbol, (seen.get(u.symbol) || 0) + 1);
for (const [sym, n] of seen) if (n > 1) errors.push(`중복 심볼: ${sym} (${n}회)`);

// 2~5
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PLACEHOLDER = /미확인|미제공|이름\s*없음|^\s*$|^null$|^undefined$/i;
const today = new Date().toISOString().slice(0, 10);

for (const u of STOCK_UNIVERSE) {
  const at = `[${u.symbol || "(심볼없음)"}]`;
  if (!u.symbol || typeof u.symbol !== "string") errors.push(`${at} symbol 결손`);
  if (!u.name || typeof u.name !== "string") errors.push(`${at} name 결손`);
  else if (PLACEHOLDER.test(u.name)) errors.push(`${at} name 이 플레이스홀더: "${u.name}"`);
  if (!["us", "kr"].includes(u.market)) errors.push(`${at} market 이 us|kr 이 아님: ${u.market}`);

  if (u.listedAt != null) {
    if (!DATE_RE.test(u.listedAt)) errors.push(`${at} listedAt 형식 오류: ${u.listedAt}`);
    else if (u.listedAt > today) warns.push(`${at} listedAt 이 미래: ${u.listedAt} (상장 예정이면 정상)`);
  }

  if (u.market === "kr" && !/\.(KS|KQ)$/.test(u.symbol || "")) {
    errors.push(`${at} market:"kr" 인데 .KS/.KQ 접미사 없음 — 야후 조회 불가`);
  }
  if (u.market === "us" && /\.(KS|KQ)$/.test(u.symbol || "")) {
    errors.push(`${at} market:"us" 인데 한국 접미사가 붙음`);
  }
}

const us = STOCK_UNIVERSE.filter((u) => u.market === "us").length;
const kr = STOCK_UNIVERSE.filter((u) => u.market === "kr").length;

if (warns.length) {
  console.warn(`[check-stock-universe] 경고 ${warns.length}건`);
  for (const w of warns.slice(0, 10)) console.warn(`  · ${w}`);
}

if (errors.length) {
  console.error(`\n[check-stock-universe] ✗ 무결성 실패 — ${errors.length}건`);
  for (const e of errors.slice(0, 30)) console.error(`  · ${e}`);
  if (errors.length > 30) console.error(`  … 외 ${errors.length - 30}건`);
  process.exit(1);
}

console.log(
  `[check-stock-universe] ✓ ${STOCK_UNIVERSE.length}종 무결성 통과 ` +
    `(미국 ${us} / 한국 ${kr}, listedAt 보유 ${STOCK_UNIVERSE.filter((u) => u.listedAt).length})`
);
