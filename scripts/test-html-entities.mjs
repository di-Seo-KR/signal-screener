#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════
// 회귀 테스트 — 공용 HTML 엔티티 디코더 (api/_shared/html-entities.js)
// ────────────────────────────────────────────────────────────────────
// 2026-08-13 감사 #7 은 "엔티티가 화면에 그대로 노출" 결함이었고, 같은 규칙이
// news.js · social-sentiment.js · _shared/briefing.js 에 각각 복사돼 있어
// 한쪽만 고치면 다른 화면에서 재발하는 구조였습니다. 규칙을 공용 모듈로
// 단일화하면서, 테스트도 여기 한 벌만 둡니다.
//
// 사용: node scripts/test-html-entities.mjs
// ════════════════════════════════════════════════════════════════════
import { decodeEntities } from "../api/_shared/html-entities.js";

let failed = 0;
function check(name, actual, expected) {
  if (actual !== expected) {
    failed++;
    console.error(`  ✗ ${name}\n      기대: ${JSON.stringify(expected)}\n      실제: ${JSON.stringify(actual)}`);
  } else {
    console.log(`  ✓ ${name}`);
  }
}

console.log("[test-html-entities] 엔티티 디코딩 회귀 테스트");

// ① 명명 엔티티 — RSS 의 "S&amp;P500" 이 화면에 그대로 뜨던 케이스
check("명명 엔티티 &amp;", decodeEntities("S&amp;P500 &gt;&gt; 신고가"), "S&P500 >> 신고가");

// ② 10진 숫자 엔티티 — Reddit/StockTwits 본문의 &#39;
check("10진 숫자 엔티티 &#39;", decodeEntities("it&#39;s a squeeze"), "it's a squeeze");

// ③ 16진 숫자 엔티티
check("16진 숫자 엔티티 &#x27;", decodeEntities("don&#x27;t &#x26; won&#x27;t"), "don't & won't");

// ④ 이중 이스케이프는 한 단계만 — 다음 수집분에서 또 한 단계 풀립니다
check("이중 이스케이프 한 단계", decodeEntities("A&amp;amp;B"), "A&amp;B");

// ⑤ 범위를 벗어난 코드포인트는 원문 유지 (예전 briefing.js 사본은 여기서
//    RangeError 를 던져 뉴스 수집 전체가 죽을 수 있었습니다)
check("잘못된 코드포인트는 원문 유지", decodeEntities("bad &#1114112; end"), "bad &#1114112; end");
check("코드포인트 0 은 원문 유지", decodeEntities("nul &#0; end"), "nul &#0; end");
check("단독 서로게이트는 원문 유지", decodeEntities("sur &#xD800; end"), "sur &#xD800; end");

// ⑥ 알 수 없는 엔티티는 건드리지 않습니다
check("미지원 엔티티는 그대로", decodeEntities("a &copy; b"), "a &copy; b");

// ⑦ falsy 입력은 그대로 통과 (호출부가 `|| "unknown"` 등으로 처리)
check("빈 문자열 통과", decodeEntities(""), "");
check("undefined 통과", decodeEntities(undefined), undefined);
check("null 통과", decodeEntities(null), null);

if (failed > 0) {
  console.error(`[test-html-entities] 실패 ${failed}건`);
  process.exit(1);
}
console.log("[test-html-entities] 통과 — 전 케이스 정상");
