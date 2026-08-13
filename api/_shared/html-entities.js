// ════════════════════════════════════════════════════════════════════
// 공용 HTML 엔티티 디코더 (SSOT)
// ────────────────────────────────────────────────────────────────────
// 왜 공용 모듈인가 — 2026-08-13 감사에서 "엔티티가 화면에 그대로 노출"
// 결함이 뉴스·소셜 양쪽에서 각각 발견됐습니다. 원인은 같은 15줄 규칙이
// api/news.js · api/social-sentiment.js · api/_shared/briefing.js 에
// 독립적으로 복사돼 있었던 것입니다(한쪽만 고치면 다른 쪽에서 재발).
// 규칙을 여기 한 곳에만 두고 전부 이 모듈을 씁니다.
//
// 처리 범위
//   · 16진 숫자 엔티티  &#x27;  → '
//   · 10진 숫자 엔티티  &#39;   → '
//   · 주요 명명 엔티티  &amp; &lt; &gt; &quot; &apos; &nbsp;
//   · 이중 이스케이프(&amp;amp;)는 한 단계씩 풀립니다 — 명명 엔티티를
//     마지막에 처리하므로 "&amp;amp;" → "&amp;" 가 되고, 다음 수집분에서
//     다시 한 단계 풀립니다(무한 루프·과다 디코딩 방지).
//
// 안전성
//   유효 범위를 벗어난 코드포인트(0, 0x10FFFF 초과)는 String.fromCodePoint
//   가 RangeError 를 던지므로 원문을 그대로 남깁니다. 이전 briefing.js 사본은
//   이 검사가 없어 악성/깨진 입력 한 건에 브리핑 생성 전체가 죽을 수 있었습니다.
//
//   ※ 이 함수는 "표시용 텍스트 복원" 전용입니다. HTML 로 다시 삽입하는
//     용도가 아니므로(모든 소비자가 JSON 텍스트로만 사용) XSS 이스케이프
//     책임은 렌더링 측(React 기본 이스케이프)에 있습니다.
// ════════════════════════════════════════════════════════════════════

export const NAMED_ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** 코드포인트 → 문자. 범위를 벗어나면 null (호출부가 원문 유지) */
function safeFromCodePoint(cp) {
  if (!Number.isInteger(cp) || cp <= 0 || cp > 0x10ffff) return null;
  // 서로게이트 영역(U+D800~U+DFFF)은 단독으로 유효한 문자가 아닙니다.
  if (cp >= 0xd800 && cp <= 0xdfff) return null;
  try { return String.fromCodePoint(cp); } catch { return null; }
}

/**
 * HTML 엔티티를 실제 문자로 복원합니다.
 * @param {string|null|undefined} s
 * @returns {string|null|undefined} 입력이 falsy 면 그대로 반환합니다.
 */
export function decodeEntities(s) {
  if (!s) return s;
  return String(s)
    .replace(/&#x([0-9a-f]+);/gi, (m, hex) => safeFromCodePoint(parseInt(hex, 16)) ?? m)
    .replace(/&#(\d+);/g, (m, dec) => safeFromCodePoint(parseInt(dec, 10)) ?? m)
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/gi, (m, name) => NAMED_ENTITIES[name.toLowerCase()] ?? m);
}
