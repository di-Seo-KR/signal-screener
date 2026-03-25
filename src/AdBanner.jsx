// ════════════════════════════════════════════════════════════════════
// AdBanner — 쿠팡 파트너스 광고 컴포넌트
// 쿠팡파트너스 ID: AF0857541
// ════════════════════════════════════════════════════════════════════
import { useEffect, useRef, useState } from "react";

const COUPANG_PARTNER_ID = "AF0857541";
const COUPANG_SUBID = "di-finance";

// ── 쿠팡 파트너스 추천 상품 (카테고리별 풍부한 상품 풀) ──
const COUPANG_PRODUCTS = [
  // 📚 투자/재테크 도서
  { title: "투자 베스트셀러", desc: "올해 가장 많이 읽힌 투자 도서", emoji: "📚", url: "https://www.coupang.com/np/search?component=&q=투자+책+베스트셀러&channel=user", category: "book" },
  { title: "주식 투자 입문서", desc: "처음 시작하는 주식 투자", emoji: "📖", url: "https://www.coupang.com/np/search?component=&q=주식+투자+입문&channel=user", category: "book" },
  { title: "워렌 버핏 투자법", desc: "가치투자의 바이블", emoji: "📕", url: "https://www.coupang.com/np/search?component=&q=워렌버핏+투자&channel=user", category: "book" },
  { title: "재테크 베스트셀러", desc: "돈 관리의 첫걸음", emoji: "💰", url: "https://www.coupang.com/np/search?component=&q=재테크+책+베스트셀러&channel=user", category: "book" },
  // 🖥️ 트레이딩/IT 장비
  { title: "트레이딩 모니터", desc: "듀얼 모니터로 효율 2배", emoji: "🖥️", url: "https://www.coupang.com/np/search?component=&q=트레이딩+모니터&channel=user", category: "tech" },
  { title: "울트라와이드 모니터", desc: "차트 한눈에 보기", emoji: "🖥️", url: "https://www.coupang.com/np/search?component=&q=울트라와이드+모니터&channel=user", category: "tech" },
  { title: "무선 키보드 마우스", desc: "깔끔한 데스크 셋업", emoji: "⌨️", url: "https://www.coupang.com/np/search?component=&q=무선+키보드+마우스+세트&channel=user", category: "tech" },
  { title: "노이즈캔슬링 이어폰", desc: "집중 투자를 위한 필수템", emoji: "🎧", url: "https://www.coupang.com/np/search?component=&q=노이즈캔슬링+이어폰&channel=user", category: "tech" },
  { title: "아이패드 + 거치대", desc: "보조 스크린으로 활용", emoji: "📱", url: "https://www.coupang.com/np/search?component=&q=아이패드+거치대&channel=user", category: "tech" },
  // 🪑 오피스/생활
  { title: "에르고 의자", desc: "장시간 트레이딩도 편안하게", emoji: "🪑", url: "https://www.coupang.com/np/search?component=&q=사무용+의자+인체공학&channel=user", category: "office" },
  { title: "LED 데스크 조명", desc: "눈 피로 줄이는 스마트 조명", emoji: "💡", url: "https://www.coupang.com/np/search?component=&q=LED+데스크+조명&channel=user", category: "office" },
  { title: "모니터 받침대", desc: "목 건강을 위한 높이 조절", emoji: "🗄️", url: "https://www.coupang.com/np/search?component=&q=모니터+받침대&channel=user", category: "office" },
  // 🎁 쿠팡 이벤트
  { title: "오늘의 골드박스", desc: "쿠팡 특가 상품 모음", emoji: "🎁", url: "https://www.coupang.com/np/goldbox", category: "deal" },
  { title: "로켓배송 베스트", desc: "내일 도착 인기 상품", emoji: "🚀", url: "https://www.coupang.com/np/search?component=&q=로켓배송+베스트&channel=user", category: "deal" },
  // ☕ 카페/간식 (트레이딩 라이프)
  { title: "캡슐 커피머신", desc: "트레이딩하며 한 잔의 여유", emoji: "☕", url: "https://www.coupang.com/np/search?component=&q=캡슐+커피머신&channel=user", category: "lifestyle" },
  { title: "건강 간식 세트", desc: "집중력 유지 에너지 간식", emoji: "🥜", url: "https://www.coupang.com/np/search?component=&q=건강+간식+세트&channel=user", category: "lifestyle" },
];

// 탭/컨텍스트에 따른 상품 추천 로직
function getContextualProducts(context = "default") {
  const contextMap = {
    screener: ["tech", "book"],
    news: ["book", "deal", "lifestyle"],
    strategy: ["book", "tech"],
    portfolio: ["tech", "office"],
    home: ["deal", "tech", "book"],
    default: COUPANG_PRODUCTS.map(p => p.category),
  };
  const cats = contextMap[context] || contextMap.default;
  const filtered = COUPANG_PRODUCTS.filter(p => cats.includes(p.category));
  return filtered.length > 0 ? filtered : COUPANG_PRODUCTS;
}

// 쿠팡 파트너스 링크 생성 함수
function makeCoupangLink(url) {
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}subId=${COUPANG_PARTNER_ID}&subId1=${COUPANG_SUBID}`;
}

// ── 쿠팡 파트너스 사이드바 배너 (세련된 카드형) ──
export function CoupangBanner({ theme = "dark", style = {}, context = "home" }) {
  const isDark = theme === "dark";
  const products = getContextualProducts(context);
  const [currentIdx, setCurrentIdx] = useState(() => Math.floor(Math.random() * products.length));
  const product = products[currentIdx % products.length];

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentIdx(prev => (prev + 1) % products.length);
    }, 15000); // 15초마다 상품 로테이션 (덜 산만하게)
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
        {products.map((_, i) => (
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

// ── 네이티브 피드 광고 (콘텐츠 사이에 자연스럽게 삽입) ──
export function CoupangNativeCard({ theme = "dark", context = "default" }) {
  const isDark = theme === "dark";
  const products = getContextualProducts(context);
  const [idx, setIdx] = useState(() => Math.floor(Math.random() * products.length));
  const product = products[idx % products.length];

  return (
    <a
      href={makeCoupangLink(product.url)}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        display: "flex", alignItems: "center", gap: "14px",
        padding: "14px 16px",
        borderRadius: "14px",
        background: isDark ? "#131B2E" : "#FFFFFF",
        border: `1px solid ${isDark ? "#1F2E42" : "#E2E5EA"}18`,
        textDecoration: "none",
        transition: "all 0.2s ease",
        cursor: "pointer",
      }}
      onMouseEnter={e => {
        e.currentTarget.style.background = isDark ? "#182236" : "#F8FAFF";
        e.currentTarget.style.transform = "translateY(-1px)";
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = isDark ? "#131B2E" : "#FFFFFF";
        e.currentTarget.style.transform = "translateY(0)";
      }}
    >
      <div style={{
        width: "42px", height: "42px", borderRadius: "12px", flexShrink: 0,
        background: isDark ? "#1A2438" : "#F1F3F6",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: "20px",
      }}>{product.emoji}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "2px" }}>
          <span style={{
            fontSize: "13px", fontWeight: 600,
            color: isDark ? "#E2E8F0" : "#1E293B",
          }}>{product.title}</span>
          <span style={{
            fontSize: "8px", fontWeight: 700, padding: "1px 5px", borderRadius: "3px",
            background: isDark ? "#1E2D4520" : "#E8EDF420",
            color: isDark ? "#4A6080" : "#94A3B8",
          }}>AD</span>
        </div>
        <div style={{
          fontSize: "11px", color: isDark ? "#64748B" : "#94A3B8",
        }}>{product.desc}</div>
      </div>
      <span style={{
        fontSize: "12px", color: isDark ? "#3B82F6" : "#2563EB",
        fontWeight: 600, flexShrink: 0,
      }}>보기 ›</span>
    </a>
  );
}

// ── 배너 스트립 (뉴스/리포트 하단에 가로형) ──
export function CoupangStripBanner({ theme = "dark", context = "default" }) {
  const isDark = theme === "dark";
  const products = getContextualProducts(context);
  const [idx] = useState(() => Math.floor(Math.random() * products.length));
  const p1 = products[idx % products.length];
  const p2 = products[(idx + 1) % products.length];

  return (
    <div style={{
      display: "flex", gap: "8px", padding: "6px 0",
    }}>
      {[p1, p2].map((product, i) => (
        <a
          key={i}
          href={makeCoupangLink(product.url)}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            flex: 1, display: "flex", alignItems: "center", gap: "8px",
            padding: "8px 12px", borderRadius: "10px",
            background: isDark ? "#0F172440" : "#F8F9FB",
            border: `1px solid ${isDark ? "#1E2D45" : "#E2E5EA"}30`,
            textDecoration: "none",
            transition: "all 0.15s",
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = isDark ? "#3B82F640" : "#93C5FD40"; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = isDark ? "#1E2D4530" : "#E2E5EA30"; }}
        >
          <span style={{ fontSize: "16px" }}>{product.emoji}</span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: "11px", fontWeight: 600, color: isDark ? "#CBD5E1" : "#334155", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{product.title}</div>
            <div style={{ fontSize: "9px", color: isDark ? "#475569" : "#94A3B8" }}>AD · 쿠팡</div>
          </div>
        </a>
      ))}
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

export default { GoogleAd, CoupangBanner, CoupangInlineBanner, CoupangInterstitial, CoupangNativeCard, CoupangStripBanner };
