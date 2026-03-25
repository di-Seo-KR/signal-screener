// ════════════════════════════════════════════════════════════════════
// AdBanner — Google AdSense + 쿠팡 파트너스 광고 컴포넌트
// ════════════════════════════════════════════════════════════════════
import { useEffect, useRef } from "react";

// ── 쿠팡 파트너스 배너 광고 ──
// 가입 후 발급받은 파트너 ID와 광고 코드로 교체하세요
// https://partners.coupang.com/
const COUPANG_PARTNER_ID = "YOUR_PARTNER_ID"; // TODO: 실제 파트너 ID로 교체
const COUPANG_SUBID = "di-finance";

// 쿠팡 파트너스 추천 상품 링크 (카테고리별)
const COUPANG_LINKS = {
  finance: [
    { title: "투자 필독서 베스트셀러", url: `https://link.coupang.com/a/PLACEHOLDER`, img: "" },
    { title: "듀얼 모니터 거래용", url: `https://link.coupang.com/a/PLACEHOLDER`, img: "" },
  ],
};

// ── Google AdSense 배너 ──
export function GoogleAd({ slot, format = "auto", style = {} }) {
  const adRef = useRef(null);
  const pushed = useRef(false);

  useEffect(() => {
    if (pushed.current) return;
    try {
      if (window.adsbygoogle && adRef.current) {
        (window.adsbygoogle = window.adsbygoogle || []).push({});
        pushed.current = true;
      }
    } catch (e) {
      console.warn("[AdSense]", e);
    }
  }, []);

  return (
    <div style={{ textAlign: "center", overflow: "hidden", ...style }}>
      <ins
        ref={adRef}
        className="adsbygoogle"
        style={{ display: "block" }}
        data-ad-client="ca-pub-XXXXXXXXXXXXXXXX" /* TODO: 실제 AdSense 퍼블리셔 ID */
        data-ad-slot={slot}
        data-ad-format={format}
        data-full-width-responsive="true"
      />
    </div>
  );
}

// ── 쿠팡 파트너스 배너 (Dynamic Banner) ──
export function CoupangBanner({ theme = "dark", style = {} }) {
  const isDark = theme === "dark";

  return (
    <div style={{
      borderRadius: "12px",
      background: isDark ? "#131B2E" : "#F8F9FB",
      border: `1px solid ${isDark ? "#1F2E42" : "#E2E5EA"}`,
      padding: "16px",
      textAlign: "center",
      ...style,
    }}>
      <div style={{
        fontSize: "11px",
        color: isDark ? "#64748B" : "#94A3B8",
        marginBottom: "8px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "4px",
      }}>
        <span>AD</span>
        <span style={{ width: "1px", height: "10px", background: isDark ? "#2A3F58" : "#D1D5DC" }} />
        <span>쿠팡 파트너스</span>
      </div>
      {/* 쿠팡 파트너스 Dynamic Banner iframe */}
      {/* 아래는 플레이스홀더입니다. 실제 쿠팡 파트너스 가입 후 발급받은 배너 코드로 교체하세요 */}
      <a
        href={`https://link.coupang.com/a/PLACEHOLDER?subid=${COUPANG_SUBID}`}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: "inline-block",
          padding: "10px 20px",
          borderRadius: "8px",
          background: isDark ? "#182D54" : "#DBEAFE",
          color: isDark ? "#64ABFF" : "#2563EB",
          fontSize: "13px",
          fontWeight: 600,
          textDecoration: "none",
          transition: "all 0.2s",
        }}
      >
        투자 관련 추천 상품 보기
      </a>
      <div style={{
        fontSize: "10px",
        color: isDark ? "#475569" : "#94A3B8",
        marginTop: "8px",
      }}>
        이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.
      </div>
    </div>
  );
}

// ── 네이티브 광고 (콘텐츠 사이 삽입형) ──
export function NativeAd({ theme = "dark", position = "sidebar" }) {
  const isDark = theme === "dark";
  const C = {
    bg: isDark ? "#131B2E" : "#F8F9FB",
    border: isDark ? "#1F2E42" : "#E2E5EA",
    text1: isDark ? "#F0F2F7" : "#0F172A",
    text2: isDark ? "#94A3B8" : "#475569",
    text3: isDark ? "#64748B" : "#94A3B8",
    blue: isDark ? "#3B8BFF" : "#2563EB",
    blueBg: isDark ? "#182D54" : "#DBEAFE",
  };

  return (
    <div style={{
      borderRadius: "12px",
      background: C.bg,
      border: `1px solid ${C.border}`,
      padding: position === "sidebar" ? "12px" : "16px",
      marginBottom: "16px",
    }}>
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: "4px",
        marginBottom: "8px",
      }}>
        <span style={{ fontSize: "10px", color: C.text3, fontWeight: 600, padding: "1px 6px", borderRadius: "4px", background: C.blueBg }}>AD</span>
      </div>
      {/* Google AdSense 네이티브 광고 또는 쿠팡 배너 */}
      <GoogleAd slot="XXXXXXXXXX" format="fluid" />
    </div>
  );
}

export default { GoogleAd, CoupangBanner, NativeAd };
