// ════════════════════════════════════════════════════════════════════
// AdBanner — 쿠팡 파트너스 광고 컴포넌트
// 쿠팡파트너스 ID: AF0857541
// ════════════════════════════════════════════════════════════════════
import { useEffect, useRef, useState } from "react";

const COUPANG_PARTNER_ID = "AF0857541";
const COUPANG_SUBID = "toit";

// ── 쿠팡 파트너스 정식 어필리에이트 링크 ──
// partners.coupang.com 대시보드에서 생성한 link.coupang.com 형태의 링크가 수수료 추적됨
// 추가 링크는 파트너스 대시보드에서 카테고리별로 생성 후 아래 배열에 추가
const COUPANG_AFFILIATE_LINK = "https://link.coupang.com/a/ebqKhn";

// ── 쿠팡 파트너스 추천 상품 (카테고리별) ──
// partnerLink가 있으면 정식 파트너스 링크 사용, 없으면 검색 URL + subId 폴백
const COUPANG_PRODUCTS = [
  // 📚 투자/재테크 도서
  { title: "투자 베스트셀러", desc: "올해 가장 많이 읽힌 투자 도서", url: "https://www.coupang.com/np/search?component=&q=투자+책+베스트셀러&channel=user", category: "book" },
  { title: "주식 투자 입문서", desc: "처음 시작하는 주식 투자", url: "https://www.coupang.com/np/search?component=&q=주식+투자+입문&channel=user", category: "book" },
  { title: "워렌 버핏 투자법", desc: "가치투자의 바이블", url: "https://www.coupang.com/np/search?component=&q=워렌버핏+투자&channel=user", category: "book" },
  { title: "재테크 베스트셀러", desc: "돈 관리의 첫걸음", url: "https://www.coupang.com/np/search?component=&q=재테크+책+베스트셀러&channel=user", category: "book" },
  { title: "경제 경영 도서", desc: "시장 흐름을 읽는 법", url: "https://www.coupang.com/np/search?component=&q=경제+경영+도서&channel=user", category: "book" },
  // 🖥️ 트레이딩/IT 장비
  { title: "트레이딩 모니터", desc: "듀얼 모니터로 효율 2배", url: "https://www.coupang.com/np/search?component=&q=트레이딩+모니터&channel=user", category: "tech" },
  { title: "울트라와이드 모니터", desc: "차트 한눈에 보기", url: "https://www.coupang.com/np/search?component=&q=울트라와이드+모니터&channel=user", category: "tech" },
  { title: "무선 키보드 마우스", desc: "깔끔한 데스크 셋업", url: "https://www.coupang.com/np/search?component=&q=무선+키보드+마우스+세트&channel=user", category: "tech" },
  { title: "노이즈캔슬링 이어폰", desc: "집중 투자를 위한 필수템", url: "https://www.coupang.com/np/search?component=&q=노이즈캔슬링+이어폰&channel=user", category: "tech" },
  { title: "아이패드 + 거치대", desc: "보조 스크린으로 활용", url: "https://www.coupang.com/np/search?component=&q=아이패드+거치대&channel=user", category: "tech" },
  { title: "무선 충전기 세트", desc: "스마트한 충전 경험", url: "https://www.coupang.com/np/search?component=&q=무선+충전기&channel=user", category: "tech" },
  // 🪑 오피스/생활
  { title: "에르고 의자", desc: "장시간 트레이딩도 편안하게", url: "https://www.coupang.com/np/search?component=&q=사무용+의자+인체공학&channel=user", category: "office" },
  { title: "LED 데스크 조명", desc: "눈 피로 줄이는 스마트 조명", url: "https://www.coupang.com/np/search?component=&q=LED+데스크+조명&channel=user", category: "office" },
  { title: "모니터 받침대", desc: "목 건강을 위한 높이 조절", url: "https://www.coupang.com/np/search?component=&q=모니터+받침대&channel=user", category: "office" },
  { title: "책상 정리용품", desc: "효율적인 작업 공간 구성", url: "https://www.coupang.com/np/search?component=&q=책상+정리용품&channel=user", category: "office" },
  { title: "공기청정기", desc: "쾌적한 트레이딩 환경 조성", url: "https://www.coupang.com/np/search?component=&q=공기청정기&channel=user", category: "office" },
  // 🎁 쿠팡 이벤트
  { title: "오늘의 골드박스", desc: "쿠팡 특가 상품 모음", url: "https://www.coupang.com/np/goldbox", category: "deal" },
  { title: "로켓배송 베스트", desc: "내일 도착 인기 상품", url: "https://www.coupang.com/np/search?component=&q=로켓배송+베스트&channel=user", category: "deal" },
  { title: "쿠팡 와우 멤버십", desc: "로켓배송 무료 이용", url: "https://www.coupang.com/np/search?component=&q=로켓와우+추천&channel=user", category: "deal" },
  // ☕ 카페/간식 (트레이딩 라이프)
  { title: "캡슐 커피머신", desc: "트레이딩하며 한 잔의 여유", url: "https://www.coupang.com/np/search?component=&q=캡슐+커피머신&channel=user", category: "lifestyle" },
  { title: "건강 간식 세트", desc: "집중력 유지 에너지 간식", url: "https://www.coupang.com/np/search?component=&q=건강+간식+세트&channel=user", category: "lifestyle" },
  { title: "프리미엄 초콜릿", desc: "스트레스 해소 선물", url: "https://www.coupang.com/np/search?component=&q=프리미엄+초콜릿&channel=user", category: "lifestyle" },
  { title: "비타민 영양제", desc: "건강한 투자 생활", url: "https://www.coupang.com/np/search?component=&q=비타민+영양제&channel=user", category: "lifestyle" },
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
// 정식 파트너스 링크(link.coupang.com)가 있으면 우선 사용 → 수수료 정상 추적
// product에 partnerLink 필드가 있으면 해당 링크 사용, 없으면 메인 어필리에이트 링크로 연결
function makeCoupangLink(url, product) {
  if (product?.partnerLink) return product.partnerLink;
  // 메인 어필리에이트 링크 사용 (정식 수수료 추적)
  return COUPANG_AFFILIATE_LINK;
}

// ── 쿠팡 파트너스 공식 배너 (이미지 배너 — React SPA 호환) ──
// 쿠팡 파트너스 대시보드에서 생성한 배너 HTML을 그대로 사용
// bannerId: 배너 ID (대시보드에서 확인)
// linkUrl: 어필리에이트 링크 (link.coupang.com/a/xxx)
const COUPANG_BANNERS = [
  {
    bannerId: 975392,
    linkUrl: "https://link.coupang.com/a/ebqKhn",
    imgUrl: "https://ads-partners.coupang.com/banners/975392?subId=&traceId=V0-301-879dd1202e5c73b2-I975392&w=728&h=90",
  },
  {
    bannerId: 975393,
    linkUrl: "https://link.coupang.com/a/ebrk3s",
    imgUrl: "https://ads-partners.coupang.com/banners/975393?subId=&traceId=V0-301-879dd1202e5c73b2-I975393&w=728&h=90",
  },
];

export function CoupangOfficialBanner({ bannerId = 975392, style = {} }) {
  const banner = COUPANG_BANNERS.find(b => b.bannerId === bannerId) || COUPANG_BANNERS[0];

  return (
    <div style={{
      textAlign: "center",
      overflow: "hidden",
      maxWidth: "100%",
      borderRadius: "8px",
      ...style,
    }}>
      <a
        href={banner.linkUrl}
        target="_blank"
        rel="noopener noreferrer"
        referrerPolicy="unsafe-url"
        style={{ display: "inline-block", maxWidth: "100%" }}
      >
        <img
          src={banner.imgUrl}
          alt="쿠팡 파트너스 배너"
          style={{
            maxWidth: "100%",
            height: "auto",
            display: "block",
            borderRadius: "4px",
          }}
        />
      </a>
      <div style={{
        fontSize: "8px", color: "#888", marginTop: "4px", textAlign: "center",
      }}>이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.</div>
    </div>
  );
}

// ── 쿠팡 파트너스 사이드바 배너 (실제 광고 단위 스타일) ──
export function CoupangBanner({ theme = "dark", style = {}, context = "home" }) {
  const isDark = theme === "dark";
  const products = getContextualProducts(context);
  const [currentIdx, setCurrentIdx] = useState(() => Math.floor(Math.random() * products.length));
  const product = products[currentIdx % products.length];

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentIdx(prev => (prev + 1) % products.length);
    }, 15000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div style={{
      borderRadius: "2px",
      background: isDark ? "#1A1A1A" : "#FFFFFF",
      border: `1px solid ${isDark ? "#333333" : "#DDDDDD"}`,
      padding: "12px",
      position: "relative",
      overflow: "hidden",
      ...style,
    }}>
      {/* 광고 라벨 */}
      <div style={{
        fontSize: "8px", fontWeight: 700, padding: "2px 4px",
        background: isDark ? "#333333" : "#F0F0F0",
        color: isDark ? "#888888" : "#999999",
        borderRadius: "2px",
        marginBottom: "8px",
        display: "inline-block",
        letterSpacing: "0.5px",
      }}>광고</div>

      {/* 상품 카테고리 */}
      <div style={{
        fontSize: "12px", fontWeight: 600,
        color: isDark ? "#CCCCCC" : "#333333",
        marginBottom: "8px",
        lineHeight: 1.3,
      }}>{product.title}</div>

      {/* CTA 버튼 - 심플 */}
      <a
        href={makeCoupangLink(product.url, product)}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: "block",
          padding: "8px 12px",
          borderRadius: "2px",
          background: isDark ? "#3B82F6" : "#0066CC",
          color: "#FFFFFF",
          fontSize: "12px",
          fontWeight: 600,
          textDecoration: "none",
          textAlign: "center",
          transition: "all 0.2s ease",
          border: "none",
          cursor: "pointer",
          marginBottom: "6px",
        }}
        onMouseEnter={e => {
          e.currentTarget.style.opacity = "0.9";
        }}
        onMouseLeave={e => {
          e.currentTarget.style.opacity = "1";
        }}
      >
        쿠팡에서 확인하기
      </a>

      {/* 공시 */}
      <div style={{
        fontSize: "8px",
        color: isDark ? "#666666" : "#999999",
        textAlign: "center",
        lineHeight: 1.3,
      }}>
        쿠팡 파트너스 활동
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
      href={makeCoupangLink(product.url, product)}
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

// ── 쿠팡 버튼 광고 (CTA 버튼) ──
export function CoupangButtonAd({ theme = "dark", context = "default" }) {
  const isDark = theme === "dark";
  const products = getContextualProducts(context);
  const product = products[Math.floor(Math.random() * products.length)];
  const [isHovered, setIsHovered] = useState(false);

  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center", gap: "8px",
      padding: "12px 0",
    }}>
      <a
        href={makeCoupangLink(product.url, product)}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: "inline-flex", alignItems: "center", gap: "6px",
          padding: "10px 20px",
          borderRadius: "3px",
          background: isHovered ? "#0052A3" : "#0066CC",
          color: "#FFFFFF",
          fontSize: "13px",
          fontWeight: 600,
          textDecoration: "none",
          transition: "all 0.2s",
          border: "none",
          cursor: "pointer",
          boxShadow: isHovered ? "0 4px 8px rgba(0, 102, 204, 0.3)" : "0 2px 4px rgba(0, 102, 204, 0.2)",
          transform: isHovered ? "translateY(-1px)" : "translateY(0)",
          position: "relative",
          overflow: "hidden",
        }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {product.title}
        <span style={{
          transition: "transform 0.2s ease",
          transform: isHovered ? "translateX(2px)" : "translateX(0)",
        }}>›</span>
      </a>

      {/* 공시 */}
      <div style={{
        fontSize: "8px",
        color: isDark ? "#666666" : "#999999",
        textAlign: "center",
        lineHeight: 1.3,
      }}>
        쿠팡 파트너스
      </div>
    </div>
  );
}

// ── 쿠팡 인터스티셜 (CTA 팝업 - 3초 카운트다운) ──
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
      background: "rgba(0,0,0,0.5)",
      backdropFilter: "blur(2px)",
    }}>
      <div style={{
        width: "320px", maxWidth: "90vw",
        borderRadius: "4px",
        background: isDark ? "#1A1A1A" : "#FFFFFF",
        border: `1px solid ${isDark ? "#333333" : "#DDDDDD"}`,
        padding: "20px",
        textAlign: "center",
      }}>
        {/* 클로즈 버튼 */}
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "12px" }}>
          <button
            onClick={canClose ? onClose : undefined}
            style={{
              background: "none", border: "none", cursor: canClose ? "pointer" : "default",
              fontSize: "14px", fontWeight: 600,
              color: canClose ? (isDark ? "#CCCCCC" : "#333333") : (isDark ? "#666666" : "#AAAAAA"),
              padding: "2px 6px", borderRadius: "2px",
            }}
          >
            {canClose ? "✕" : countdown}
          </button>
        </div>

        {/* 광고 라벨 */}
        <div style={{
          fontSize: "9px", fontWeight: 700, color: isDark ? "#666666" : "#999999",
          marginBottom: "12px", letterSpacing: "0.5px",
        }}>광고</div>

        {/* 상품명 */}
        <div style={{
          fontSize: "14px", fontWeight: 600,
          color: isDark ? "#E0E0E0" : "#333333",
          marginBottom: "12px",
          lineHeight: 1.3,
        }}>{product.title}</div>

        {/* CTA */}
        <a
          href={makeCoupangLink(product.url, product)}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: "inline-block",
            padding: "8px 24px",
            borderRadius: "2px",
            background: isDark ? "#0066CC" : "#0066CC",
            color: "#FFFFFF",
            fontSize: "13px",
            fontWeight: 600,
            textDecoration: "none",
            transition: "all 0.2s",
          }}
        >
          쿠팡에서 보기
        </a>

        <div style={{
          fontSize: "8px",
          color: isDark ? "#666666" : "#999999",
          marginTop: "10px",
          lineHeight: 1.3,
        }}>
          쿠팡 파트너스
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
    <div style={{
      display: "flex", flexDirection: "column", gap: "10px",
      padding: "14px",
      borderRadius: "4px",
      background: isDark ? "#1F1F1F" : "#F8F8F8",
      border: `1px solid ${isDark ? "#2F2F2F" : "#E8E8E8"}`,
      textDecoration: "none",
      transition: "all 0.2s ease",
    }}>
      {/* 헤더: AD 배지 */}
      <div style={{
        display: "flex", alignItems: "center", gap: "6px",
        fontSize: "9px", fontWeight: 700,
        color: isDark ? "#888888" : "#AAAAAA",
      }}>
        <span style={{
          padding: "2px 4px", borderRadius: "2px",
          background: isDark ? "#2F2F2F" : "#EEEEEE",
        }}>AD</span>
        <span>쿠팡</span>
      </div>

      {/* 상품 정보 - 심플 */}
      <div style={{
        fontSize: "13px", fontWeight: 600,
        color: isDark ? "#E0E0E0" : "#333333",
        lineHeight: 1.3,
      }}>{product.title}</div>

      {/* CTA 버튼 */}
      <a
        href={makeCoupangLink(product.url, product)}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: "block",
          padding: "8px",
          borderRadius: "2px",
          background: isDark ? "#0066CC" : "#0066CC",
          color: "#FFFFFF",
          fontSize: "12px",
          fontWeight: 600,
          textDecoration: "none",
          textAlign: "center",
          transition: "all 0.2s ease",
          border: "none",
          cursor: "pointer",
        }}
        onMouseEnter={e => {
          e.currentTarget.style.opacity = "0.9";
        }}
        onMouseLeave={e => {
          e.currentTarget.style.opacity = "1";
        }}
      >
        쿠팡에서 보기
      </a>

      {/* 공시 */}
      <div style={{
        fontSize: "8px",
        color: isDark ? "#666666" : "#AAAAAA",
        textAlign: "center",
        lineHeight: 1.2,
      }}>
        쿠팡 파트너스
      </div>
    </div>
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
      display: "flex", gap: "6px", padding: "6px 0",
    }}>
      {[p1, p2].map((product, i) => (
        <a
          key={i}
          href={makeCoupangLink(product.url, product)}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            flex: 1, display: "flex", alignItems: "center", gap: "6px",
            padding: "8px 10px", borderRadius: "3px",
            background: isDark ? "#1F1F1F" : "#F5F5F5",
            border: `1px solid ${isDark ? "#333333" : "#E0E0E0"}`,
            textDecoration: "none",
            transition: "all 0.15s",
          }}
          onMouseEnter={e => { e.currentTarget.style.opacity = "0.9"; }}
          onMouseLeave={e => { e.currentTarget.style.opacity = "1"; }}
        >
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: "11px", fontWeight: 600, color: isDark ? "#D0D0D0" : "#333333", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{product.title}</div>
            <div style={{ fontSize: "8px", color: isDark ? "#666666" : "#999999" }}>쿠팡</div>
          </div>
        </a>
      ))}
    </div>
  );
}

// ── 쿠팡 플로팅 배너 (우측 하단 떠있는 배너 - 심플) ──
export function CoupangFloatingBanner({ theme = "dark", context = "default", autoShowDelay = 30000 }) {
  const isDark = theme === "dark";
  const products = getContextualProducts(context);
  const [visible, setVisible] = useState(false);
  const [product, setProduct] = useState(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setProduct(products[Math.floor(Math.random() * products.length)]);
      setVisible(true);
    }, autoShowDelay);

    return () => clearTimeout(timer);
  }, []);

  if (!visible || !product) return null;

  return (
    <div style={{
      position: "fixed",
      bottom: "20px",
      right: "20px",
      zIndex: 9999,
      animation: "slideIn 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)",
    }}>
      <div style={{
        borderRadius: "4px",
        background: isDark ? "#1F1F1F" : "#FFFFFF",
        border: `1px solid ${isDark ? "#333333" : "#DDDDDD"}`,
        padding: "12px",
        maxWidth: "240px",
        boxShadow: "0 8px 16px rgba(0,0,0,0.25)",
      }}>
        {/* 클로즈 버튼 */}
        <button
          onClick={() => setVisible(false)}
          style={{
            position: "absolute",
            top: "6px",
            right: "6px",
            background: "none",
            border: "none",
            fontSize: "14px",
            cursor: "pointer",
            color: isDark ? "#666666" : "#999999",
            padding: "0",
            width: "20px",
            height: "20px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transition: "all 0.2s",
          }}
          onMouseEnter={e => {
            e.currentTarget.style.color = isDark ? "#CCCCCC" : "#333333";
          }}
          onMouseLeave={e => {
            e.currentTarget.style.color = isDark ? "#666666" : "#999999";
          }}
        >
          x
        </button>

        {/* 광고 라벨 */}
        <div style={{
          fontSize: "8px",
          fontWeight: 700,
          color: isDark ? "#666666" : "#999999",
          marginBottom: "6px",
          letterSpacing: "0.5px",
        }}>광고</div>

        {/* 상품 정보 - 심플 */}
        <div style={{
          fontSize: "12px",
          fontWeight: 600,
          color: isDark ? "#D0D0D0" : "#333333",
          marginBottom: "8px",
          lineHeight: 1.3,
        }}>{product.title}</div>

        {/* CTA 버튼 */}
        <a
          href={makeCoupangLink(product.url, product)}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: "block",
            padding: "6px 10px",
            borderRadius: "2px",
            background: isDark ? "#0066CC" : "#0066CC",
            color: "#FFFFFF",
            fontSize: "11px",
            fontWeight: 600,
            textDecoration: "none",
            textAlign: "center",
            transition: "all 0.2s",
            border: "none",
            cursor: "pointer",
          }}
          onMouseEnter={e => {
            e.currentTarget.style.opacity = "0.9";
          }}
          onMouseLeave={e => {
            e.currentTarget.style.opacity = "1";
          }}
        >
          쿠팡 보기
        </a>

        {/* 공시 */}
        <div style={{
          fontSize: "7px",
          color: isDark ? "#666666" : "#999999",
          marginTop: "6px",
          textAlign: "center",
          lineHeight: 1.2,
        }}>
          쿠팡 파트너스
        </div>
      </div>

      <style>{`
        @keyframes slideIn {
          from {
            transform: translateX(280px) translateY(280px);
            opacity: 0;
          }
          to {
            transform: translateX(0) translateY(0);
            opacity: 1;
          }
        }
      `}</style>
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

export default {
  GoogleAd,
  CoupangBanner,
  CoupangOfficialBanner,
  CoupangInlineBanner,
  CoupangButtonAd,
  CoupangInterstitial,
  CoupangNativeCard,
  CoupangFloatingBanner,
  CoupangStripBanner,
};
