// ══════════════════════════════════════════════════════════════════
// Zepta — useBreakpoint hook (반응형 SSOT)
// 이전: 9개 컴포넌트가 각자 isMobile useState + resize listener 등록.
//       단일 cutoff (640px) 만 사용해서 iPad/태블릿 사각지대 발생.
// 현재: 단일 hook 으로 통일. Tailwind sm/md/lg 와 일치하는 3-tier 분류.
//       기존 isMobile 시맨틱 (≤ 640px) 보존 → 마이그레이션 시 무수정.
// ══════════════════════════════════════════════════════════════════
import { useState, useEffect } from "react";

// Tailwind 기본 breakpoint 와 동기화
export const BREAKPOINTS = {
  sm: 640,   // 폰 한계 (Tailwind sm)
  md: 768,   // 태블릿 시작 (Tailwind md)
  lg: 1024,  // 데스크탑 시작 (Tailwind lg)
  xl: 1280,  // 큰 데스크탑 (Tailwind xl)
};

function getBreakpointState() {
  if (typeof window === "undefined") {
    return {
      isMobile: false, isTablet: false, isDesktop: true, isSmall: false,
      isTouchDevice: false, isLandscape: false,
      width: BREAKPOINTS.lg, height: 800,
    };
  }
  const w = window.innerWidth;
  const h = window.innerHeight;
  // pointer:coarse = 손가락 터치 (iPhone, Android, iPad). hover 없는 디바이스 식별에 신뢰성 높음
  const isTouchDevice = typeof window.matchMedia === "function"
    && window.matchMedia("(pointer: coarse)").matches;
  return {
    // 기존 시맨틱 유지 — 폰 (≤ 640px) — iPhone 16 (393pt) 포함
    isMobile: w <= BREAKPOINTS.sm,
    // 태블릿 (641~1023, iPad/갤탭 영역)
    isTablet: w > BREAKPOINTS.sm && w < BREAKPOINTS.lg,
    // 데스크탑 (≥ 1024)
    isDesktop: w >= BREAKPOINTS.lg,
    // 폰 + 태블릿 합집합 (작은 화면 일반)
    isSmall: w < BREAKPOINTS.lg,
    // 터치 디바이스 — 마우스 hover UX 분기에 활용
    isTouchDevice,
    // 가로 모드 (iPhone 가로, iPad 등) — fixed bottom 요소 노출 결정에 활용
    isLandscape: w > h,
    width: w,
    height: h,
  };
}

/**
 * 반응형 브레이크포인트 hook.
 *
 * 사용:
 *   const { isMobile } = useBreakpoint();          // 폰 (≤ 640)
 *   const { isTablet } = useBreakpoint();          // 태블릿 (641~1023)
 *   const { isMobile, isTablet } = useBreakpoint(); // 작은 화면 일반
 *
 * 성능: requestAnimationFrame 으로 throttle. 다중 hook 인스턴스가 있어도
 * 각자 자체 resize listener 등록하지만, 가벼우므로 문제 없음.
 */
export function useBreakpoint() {
  const [state, setState] = useState(getBreakpointState);
  useEffect(() => {
    let raf = null;
    const onResize = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setState(getBreakpointState()));
    };
    window.addEventListener("resize", onResize);
    // mount 시점 확정값 동기화 (SSR fallback 후 hydrate 차이 보정)
    setState(getBreakpointState());
    return () => {
      window.removeEventListener("resize", onResize);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);
  return state;
}

/**
 * 레거시 호환 — `const isMobile = useIsMobile()` 패턴 유지용.
 * 신규 코드는 useBreakpoint() 권장.
 */
export function useIsMobile() {
  return useBreakpoint().isMobile;
}
