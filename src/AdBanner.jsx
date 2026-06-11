// ════════════════════════════════════════════════════════════════════
// AdBanner — Google AdSense 광고 컴포넌트
// ★ 2026-06-08 (대표 지시): 쿠팡 파트너스 광고 전면 제거.
//   인터스티셜(클릭 시 전면 팝업)도 쿠팡·구글 모두 제거 — 클릭마다 확률성 팝업은
//   UX 훼손 + 애드센스 Better Ads 정책 위험. 인라인 GoogleAd 유닛만 유지.
// ════════════════════════════════════════════════════════════════════
import { useEffect, useRef } from "react";

// ── Google AdSense 배너 ──
// 광고 형식: banner (728x90), rectangle (300x250), in-feed (responsive article), responsive (auto-size)
export function GoogleAd({ format = "responsive", slot = "auto", style = {} }) {
  const adRef = useRef(null);

  useEffect(() => {
    try {
      if (window.adsbygoogle && adRef.current) {
        (window.adsbygoogle = window.adsbygoogle || []).push({});
      }
    } catch (e) {
      // AdSense script not loaded yet
    }
  }, []);

  // 광고 형식에 따른 기본 스타일 지정
  const getAdStyle = () => {
    switch (format) {
      case "banner":
        return { minHeight: "90px", maxWidth: "728px", margin: "12px auto" };
      case "rectangle":
        return { minHeight: "250px", maxWidth: "300px", margin: "12px auto" };
      case "in-feed":
        return { minHeight: "250px", margin: "16px 0" };
      case "responsive":
      default:
        return { minHeight: "200px", margin: "12px 0" };
    }
  };

  return (
    <div style={{ textAlign: "center", overflow: "hidden", ...getAdStyle(), ...style }}>
      <ins
        ref={adRef}
        className="adsbygoogle"
        style={{ display: "block" }}
        data-ad-client="ca-pub-5897295133273451"
        data-ad-slot={slot}
        data-ad-format={format === "responsive" ? "auto" : format === "in-feed" ? "fluid" : format}
        data-full-width-responsive="true"
      />
    </div>
  );
}
