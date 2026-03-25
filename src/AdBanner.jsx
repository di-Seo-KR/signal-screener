// ════════════════════════════════════════════════════════════════════
// AdBanner — 쿠팡 파트너스 광고 컴포넌트
// 쿠팡파트너스 ID: AF0857541
// ════════════════════════════════════════════════════════════════════
import { useEffect, useRef, useState } from "react";

const COUPANG_PARTNER_ID = "AF0857541";
const COUPANG_SUBID = "di-finance";

// ── 쿠팡 파트너스 추천 상품 (투자/IT 카테고리) ──
const COUPANG_PRODUCTS = [
  {
    title: "투자 베스트셀러",
    desc: "올해 가장 많이 읽힌 투자 도서",
    emoji: "📚",
    url: `https://www.coupang.com/np/search?component=&q=투자+책+베스트셀러&channel=user`,
    category: "book",
  },
  {
    title: "트레이딩 모니터",
    desc: "듀얼 모니터로 효율 2배",
    emoji: "🖥️",
    url: `https://www.coupang.com/np/search?component=&q=트레이딩+모니터&channel=user`,
    category: "tech",
  },
  {
    title: "노이즈캔슬링 이어폰",
    desc: "집중 투자를 위한 필수템",
    emoji: "🎧",
    url: `https://www.coupang.com/np/search?component=&q=노이즈캔슬링+이어폰&channel=user`,
    category: "tech",
  },
  {
    title: "에르고 의자",
    desc: "장시간 트레이딩도 편안하게",
    emoji: "🪑",
    url: `https://www.coupang.com/np/search?component=&q=사무용+의자+인체공학&channel=user`,
    category: "office",
  },
  {
    title: "오늘의 골드박스",
    desc: "쿠팡 특가 상품 모음",
    emoji: "🎁",
    url: `https://www.coupang.com/np/goldbox`,
    category: "deal",
  },
];

// 쿠팡 파트너스 링크 생성 함수
function makeCoupangLink(url) {
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}subId=${COUPANG_PARTNER_ID}&subId1=${COUPANG_SUBID}`;
}

// ── 쿠팡 파트너스 사이드바 배너 (세련된 카드형) ──
export function CoupangBanner({ theme = "dark", style = {} }) {
  const isDark = theme === "dark";
  const [currentIdx, setCurrentIdx] = useState(() => Math.floor(Math.random() * COUPANG_PRODUCTS.length));
  const product = COUPANG_PRODUCTS[currentIdx];

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentIdx(prev => (prev + 1) % COUPANG_PRODUCTS.length);
    }, 12000); // 12초마다 상품 로테이션
    return () => clearInterval(timer);
  }, []);

  return (
    <div style={{
      borderRadius: "14px",
      background: isDark
        ? "linear-gradient(135deg, #131B2E 0%, #0F1724 100%)"
        : "linear-gradient(135deg, #F8FAFF 0%, #F0F4FA 100%)",
      border: `1px solid ${isDark ? "#1F2E42" : "#E2E5EA"}`,
      padding: "16px",
      position: "relative",
      overflow: "hidden",
      ...style,
    }}>
      {/* AD 라벨 */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: "12px",
      }}>
        <span style={{
          fontSize: "9px", fontWeight: 700, padding: "2px 6px", borderRadius: "4px",
          background: isDark ? "#1E2D45" : "#E8EDF4",
          color: isDark ? "#5A7A9A" : "#8B9CB8",
          letterSpacing: "0.5px",
        }}>SPONSORED</span>
        <span style={{ fontSize: "10px", color: isDark ? "#3B5068" : "#B0BEC5" }}>쿠팡파트너스</span>
      </div>

      {/* 상품 카드 */}
      <a
        href={makeCoupangLink(product.url)}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: "flex", alignItems: "center", gap: "12px",
          textDecoration: "none",
          padding: "10px 12px",
          borderRadius: "10px",
          background: isDark ? "#182236" : "#FFFFFF",
          border: `1px solid ${isDark ? "#243350" : "#E8ECF2"}`,
          transition: "all 0.2s ease",
        }}
        onMouseEnter={e => {
          e.currentTarget.style.transform = "translateY(-1px)";
          e.currentTarget.style.borderColor = isDark ? "#3B82F6" : "#93C5FD";
        }}
        onMouseLeave={e => {
          e.currentTarget.style.transform = "translateY(0)";
          e.currentTarget.style.borderColor = isDark ? "#243350" : "#E8ECF2";
        }}
      >
        <span style={{ fontSize: "24px", flexShrink: 0 }}>{product.emoji}</span>
        <div>
          <div style={{
            fontSize: "13px", fontWeight: 700,
            color: isDark ? "#E2E8F0" : "#1E293B",
            lineHeight: 1.3,
          }}>{product.title}</div>
          <div style={{
            fontSize: "11px",
            color: isDark ? "#64748B" : "#94A3B8",
            marginTop: "2px",
          }}>{product.desc}</div>
        </div>
        <span style={{
          marginLeft: "auto", fontSize: "14px",
          color: isDark ? "#475569" : "#CBD5E1",
        }}>›</span>
      </a>

      {/* 로테이션 인디케이터 */}
      <div style={{
        display: "flex", gap: "4px", justifyContent: "center", marginTop: "10px",
      }}>
        {COUPANG_PRODUCTS.map((_, i) => (
          <div key={i} style={{
            width: i === currentIdx ? "12px" : "4px",
            height: "4px",
            borderRadius: "2px",
            background: i === currentIdx
              ? (isDark ? "#3B82F6" : "#2563EB")
              : (isDark ? "#1E2D45" : "#D1D5DC"),
            transition: "all 0.3s ease",
          }} />
        ))}
      </div>

      {/* 공시 */}
      <div style={{
        fontSize: "9px",
        color: isDark ? "#2A3F58" : "#C0C8D4",
        marginTop: "8px",
        textAlign: "center",
        lineHeight: 1.4,
      }}>
        이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.
      </div>
    </div>
  );
}

// ── 쿠팡 인라인 배너 (기능 사이 삽입형 - 덜 침습적) ──
export function CoupangInlineBanner({ theme = "dark" }) {
  const isDark = theme === "dark";
  const product = COUPANG_PRODUCTS[Math.floor(Math.random() * COUPANG_PRODUCTS.length)];

  return (
    <a
      href={makeCoupangLink(product.url)}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        display: "flex", alignItems: "center", gap: "10px",
        padding: "10px 14px",
        borderRadius: "10px",
        background: isDark ? "#0F1724" : "#F5F7FA",
        border: `1px solid ${isDark ? "#1A2740" : "#E2E8F0"}`,
        textDecoration: "none",
        transition: "all 0.2s",
      }}
    >
      <span style={{ fontSize: "9px", fontWeight: 700, color: isDark ? "#4A6080" : "#94A3B8", letterSpacing: "0.5px" }}>AD</span>
      <span style={{ width: "1px", height: "14px", background: isDark ? "#1E2D45" : "#D1D5DC" }} />
      <span style={{ fontSize: "18px" }}>{product.emoji}</span>
      <span style={{ fontSize: "12px", color: isDark ? "#94A3B8" : "#64748B", fontWeight: 500 }}>{product.title}</span>
      <span style={{ marginLeft: "auto", fontSize: "11px", color: isDark ? "#3B82F6" : "#2563EB", fontWeight: 600 }}>보기 ›</span>
    </a>
  );
}

// ── 쿠팡 인터스티셜 (기능 잠금 해제 전 표시) ──
export function CoupangInterstitial({ theme = "dark", onClose, featureName = "이 기능" }) {
  const isDark = theme === "dark";
  const [countdown, setCountdown] = useState(3);
  const [canClose, setCanClose] = useState(false);

  useEffect(() => {
    if (countdown > 0) {
      const t = setTimeout(() => setCountdown(c => c - 1), 1000);
      return () => clearTimeout(t);
    } else {
      setCanClose(true);
    }
  }, [countdown]);

  const product = COUPANG_PRODUCTS[Math.floor(Math.random() * COUPANG_PRODUCTS.length)];

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 10000,
      display: "flex", alignItems: "center", justifyContent: "center",
      background: "rgba(0,0,0,0.7)",
      backdropFilter: "blur(4px)",
    }}>
      <div style={{
        width: "380px", maxWidth: "90vw",
        borderRadius: "20px",
        background: isDark ? "#0F1724" : "#FFFFFF",
        border: `1px solid ${isDark ? "#1F2E42" : "#E2E5EA"}`,
        padding: "28px 24px",
        textAlign: "center",
      }}>
        {/* 클로즈 버튼 */}
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "8px" }}>
          <button
            onClick={canClose ? onClose : undefined}
            style={{
              background: "none", border: "none", cursor: canClose ? "pointer" : "default",
              fontSize: "12px", fontWeight: 600,
              color: canClose ? (isDark ? "#94A3B8" : "#64748B") : (isDark ? "#2A3F58" : "#CBD5E1"),
              padding: "4px 8px", borderRadius: "6px",
            }}
          >
            {canClose ? "닫기 ✕" : `${countdown}초 후 닫기`}
          </button>
        </div>

        <div style={{ fontSize: "36px", marginBottom: "12px" }}>{product.emoji}</div>
        <div style={{
          fontSize: "11px", fontWeight: 600, color: isDark ? "#4A6080" : "#94A3B8",
          marginBottom: "16px", letterSpacing: "0.5px",
        }}>SPONSORED</div>

        <div style={{
          fontSize: "15px", fontWeight: 700,
          color: isDark ? "#F0F2F7" : "#0F172A",
          marginBottom: "6px",
        }}>{product.title}</div>
        <div style={{
          fontSize: "13px",
          color: isDark ? "#64748B" : "#94A3B8",
          marginBottom: "20px",
        }}>{product.desc}</div>

        <a
          href={makeCoupangLink(product.url)}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: "inline-block",
            padding: "12px 32px",
            borderRadius: "12px",
            background: "#3B82F6",
            color: "#FFFFFF",
            fontSize: "14px",
            fontWeight: 700,
            textDecoration: "none",
            transition: "all 0.2s",
          }}
        >
          쿠팡에서 보기
        </a>

        <div style={{
          fontSize: "9px",
          color: isDark ? "#2A3F58" : "#C0C8D4",
          marginTop: "16px",
          lineHeight: 1.4,
        }}>
          이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.
        </div>
      </div>
    </div>
  );
}

// ── Google AdSense 배너 (향후 사용) ──
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
        data-ad-client="ca-pub-XXXXXXXXXXXXXXXX" /* TODO: AdSense 퍼블리셔 ID */
        data-ad-slot={slot}
        data-ad-format={format}
        data-full-width-responsive="true"
      />
    </div>
  );
}

export default { GoogleAd, CoupangBanner, CoupangInlineBanner, CoupangInterstitial };
