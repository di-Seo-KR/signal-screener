// ════════════════════════════════════════════════════════════════════
// 지표 허브 (/indicators) — 2026-07 정보 피벗 Phase 2
//
// 핵심 시장 지표를 IndicatorCard 규격(제목·큰 숫자·상태 배지·한줄 해석)으로
// 한 화면에 요약합니다. 카드 클릭 시 L2(detail 2~3줄 + updatedAt) 인라인 확장.
//
// 데이터: GET /api/indicators/summary
//   계약: { ok, indicators: [{ id, title, value, unit, label, tone, market, desc, detail, updatedAt }] }
// 상태: 로딩 스켈레톤 / 실패 시 재시도 버튼 (빈 화면 금지) / 섹션 상한 MAX_VISIBLE
//
// ★ 2026-08-02 (주식+코인 양축 확장, 대표 지시): 상단에 [전체 | 코인 | 주식]
//   세그먼트 토글을 추가하고, API 의 market 필드로 필터합니다.
//   기존 디자인(C 테마 토큰 · uiKit)은 그대로 두고 정보 구조만 확장했습니다.
//
// 전부 uiKit(디자인 시스템 v1) 컴포넌트로 구성 — 다크/라이트 자동.
//
// ★ 2026-08-09 모바일 디자인 시안 적용 (대표 제공 "Zepta Mobile App"):
//   · 상단 시장 토글을 mobileKit `Segment` 로 교체 (값·개수 배지 로직은 그대로).
//   · 0~100 스케일 지표는 `GaugeCard`(그라데이션 바 + 노브)로 렌더해 "지금 어디쯤인지"를
//     숫자가 아니라 위치로 먼저 읽히게 했습니다. 판정은 값 범위가 아니라 지표 id
//     화이트리스트(GAUGE_META)로만 합니다 — API 가 새 스케일 지표를 추가해도 오판 없음.
//   · 그 외(김프·평균 펀딩·스테이블 유동성처럼 스케일이 0~100 이 아닌 지표)는 기존
//     IndicatorCard 를 그대로 유지합니다. 카드 규격이 바뀐 지표는 하나도 없습니다.
//   · 화면 하단에 공통 면책(Disclaimer) 한 줄.
// ════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useThemeTokens, RADIUS } from "../ui/theme.jsx";
import { Card, SectionHeader, IndicatorCard, toneColor } from "../components/uiKit.jsx";
import { Segment, GaugeCard, Num, Disclaimer } from "../components/mobileKit.jsx";

// 섹션 상한 — 지표가 더 와도 상위 N개만 노출
// (주식 축 지표 편입으로 8 → 12. 전체 탭에서 뒤쪽 지표가 통째로 잘리지 않도록)
const MAX_VISIBLE = 12;

// 시장 세그먼트 — API 의 market 필드("crypto" | "stock" | "macro")로 필터
const MARKET_TABS = [
  { id: "all", label: "전체" },
  { id: "crypto", label: "코인" },
  { id: "stock", label: "주식" },
];

/**
 * 지표 → 선택 시장 매칭.
 * - macro(환율·공포탐욕처럼 두 시장에 함께 걸리는 거시 지표)는 코인·주식 양쪽에 노출합니다.
 * - market 필드가 없는 지표(구 스키마 캐시 응답)는 숨기지 않고 항상 노출합니다 — 빈 화면 방지.
 */
function matchesMarket(ind, selected) {
  if (selected === "all") return true;
  const m = ind?.market;
  if (!m) return true;
  return m === selected || m === "macro";
}

// updatedAt(ISO) → "MM.DD HH:MM 기준" (파싱 실패 시 숨김)
function fmtUpdated(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())} 기준`;
}

// ── 게이지 지표 화이트리스트 ────────────────────────────────────────
// "값이 0~100 이면 게이지" 같은 값 범위 추론은 하지 않습니다. 예를 들어 김치프리미엄
// 0.8%, 스테이블 유동성 210B$ 도 0~100 안에 들어올 수 있어 오판이 나기 때문입니다.
// api/indicators/summary.js 의 지표 id 를 실측해 0~100 스케일인 6종만 등록합니다.
//   lo/hi : 게이지 바 좌(0)·우(100) 끝의 의미 — 사용자가 방향을 헷갈리지 않게 항상 표기
//   ramp  : 바 그라데이션 종류. 노브 색(= 지표 tone 색)과 바 색이 같은 계열로 맞물리도록
//           각 지표가 실제로 쓰는 tone 임계값에 맞춰 지정합니다.
//             "temp" → cold(파랑) ~ neutral ~ hot(주황)  : tone 이 hot/cold 인 지표
//             "fx"   → up(초록) ~ neutral ~ down(빨강)   : 값이 클수록 부담(tone down)인 지표
const GAUGE_META = {
  "market-temp":     { lo: "냉각", hi: "과열", ramp: "temp" },
  "kr-market-temp":  { lo: "냉각", hi: "과열", ramp: "temp" },
  "alt-heat":        { lo: "냉각", hi: "과열", ramp: "temp" },
  "funding-squeeze": { lo: "롱 과밀", hi: "숏 과밀", ramp: "temp" },
  "fear-greed":      { lo: "공포", hi: "탐욕", ramp: "temp" },
  "fx-pressure":     { lo: "원화 강세", hi: "원화 약세", ramp: "fx" },
};

/** 게이지 바 그라데이션 — 전부 테마 토큰 조합(하드코딩 hex 없음). */
function rampOf(C, ramp) {
  if (ramp === "fx") return `linear-gradient(90deg, ${C.green}, ${C.yellow} 50%, ${C.red})`;
  return `linear-gradient(90deg, ${C.blue}, ${C.yellow} 50%, ${C.orange})`;
}

/**
 * 게이지형 지표 카드 — mobileKit GaugeCard(큰 수치 + 그라데이션 바 + 노브) 위에
 * 기존 IndicatorCard 와 동일한 정보 계층(L1 한줄 해석 / L2 자세히 + 기준시각)을 얹습니다.
 * 카드 껍데기(배경·보더·radius)는 바깥 컨테이너가 맡고, GaugeCard 는 내용만 그리도록
 * style 로 배경·보더를 걷어냅니다(GaugeCard 가 style 을 마지막에 펼쳐 override 가능).
 */
function GaugeIndicatorCard({ ind, meta }) {
  const C = useThemeTokens();
  const [open, setOpen] = useState(false);
  const color = toneColor(C, ind.tone);
  const updated = fmtUpdated(ind.updatedAt);
  const hasL2 = Boolean(ind.detail || updated);
  const toggle = () => setOpen((v) => !v);

  return (
    <div
      role={hasL2 ? "button" : undefined}
      tabIndex={hasL2 ? 0 : undefined}
      aria-expanded={hasL2 ? open : undefined}
      onClick={hasL2 ? toggle : undefined}
      onKeyDown={hasL2 ? (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); }
      } : undefined}
      style={{
        background: C.card,
        border: `1px solid ${color}${C.isDark ? "28" : "35"}`,
        borderRadius: RADIUS.xl,
        cursor: hasL2 ? "pointer" : "default",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      <GaugeCard
        title={ind.title}
        value={ind.value}
        unit={ind.unit}          /* 마켓 온도의 ° 처럼 단위가 있으면 큰 숫자에 붙여 표기합니다 */
        label={ind.label}
        valueColor={color}
        gradient={rampOf(C, meta.ramp)}
        style={{ background: "transparent", border: "none", borderRadius: 0, padding: "16px 18px 0", cursor: "inherit" }}
      />

      {/* 스케일 양 끝 의미 — 바 바로 아래에 붙여 방향을 즉시 읽히게 합니다 */}
      <div style={{
        display: "flex", justifyContent: "space-between", gap: "8px",
        padding: "4px 18px 0", fontSize: "11px", color: C.text4, lineHeight: 1.4,
      }}>
        <span><Num size="11px" weight={700} color={C.text4}>0</Num> {meta.lo}</span>
        <span>{meta.hi} <Num size="11px" weight={700} color={C.text4}>100</Num></span>
      </div>

      <div style={{ padding: "0 18px 16px" }}>
        {ind.desc && (
          <div style={{ marginTop: "10px", fontSize: "13px", color: C.text2, lineHeight: 1.5 }}>{ind.desc}</div>
        )}
        {hasL2 && open && (
          <div style={{ marginTop: "10px", paddingTop: "10px", borderTop: `1px solid ${C.border}${C.isDark ? "30" : "60"}` }}>
            {ind.detail && (
              <div style={{ fontSize: "13px", color: C.text2, lineHeight: 1.6, whiteSpace: "pre-line" }}>{ind.detail}</div>
            )}
            {updated && (
              <div style={{ marginTop: ind.detail ? "6px" : 0, fontSize: "12px", color: C.text3 }}>{updated}</div>
            )}
          </div>
        )}
        {hasL2 && (
          <div style={{ marginTop: "8px", fontSize: "12px", fontWeight: 600, color: C.text3, userSelect: "none" }}>
            {open ? "접기 ▴" : "자세히 ▾"}
          </div>
        )}
      </div>
    </div>
  );
}

export default function IndicatorHub({ onNavigate }) {
  const C = useThemeTokens();
  // status: "loading" | "ready" | "error"
  const [state, setState] = useState({ status: "loading", indicators: [] });
  const [market, setMarket] = useState("all");
  const aliveRef = useRef(true);

  // 진입 버튼 공통 이동 — "/coin" 같은 정적 경로는 페이지 이동, 그 외는 탭 전환
  const go = useCallback((target, screenerMarket) => {
    if (typeof target === "string" && target.startsWith("/")) {
      window.location.href = target;
      return;
    }
    // 스크리너로 보낼 때 시장 필터를 함께 지정 (App.jsx 가 이 이벤트를 받아 filterMarket 설정)
    if (screenerMarket) {
      try { window.dispatchEvent(new CustomEvent("zepta:screener-market", { detail: screenerMarket })); } catch { /* 무시 */ }
    }
    if (onNavigate) onNavigate(target);
  }, [onNavigate]);

  const fetchSummary = useCallback(async () => {
    setState({ status: "loading", indicators: [] });
    try {
      const r = await fetch("/api/indicators/summary");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      if (!j || j.ok !== true || !Array.isArray(j.indicators)) throw new Error("bad payload");
      if (aliveRef.current) setState({ status: "ready", indicators: j.indicators });
    } catch {
      if (aliveRef.current) setState({ status: "error", indicators: [] });
    }
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    fetchSummary();
    return () => { aliveRef.current = false; };
  }, [fetchSummary]);

  // 세그먼트별 개수 (탭 라벨 옆 배지) + 현재 선택 시장의 지표
  const counts = useMemo(() => {
    const c = {};
    for (const t of MARKET_TABS) c[t.id] = state.indicators.filter((i) => matchesMarket(i, t.id)).length;
    return c;
  }, [state.indicators]);

  const inMarket = useMemo(
    () => state.indicators.filter((i) => matchesMarket(i, market)),
    [state.indicators, market],
  );
  const visible = inMarket.slice(0, MAX_VISIBLE);
  const hasMore = inMarket.length > MAX_VISIBLE;

  // 그리드: 모바일 1열 / 데스크톱 2~3열 (auto-fill 로 자동 반응형)
  const gridStyle = {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(270px, 1fr))",
    gap: "12px",
  };

  const shortcutBtnStyle = {
    display: "inline-flex", alignItems: "center", gap: "6px",
    padding: "9px 16px", borderRadius: RADIUS.lg,
    fontSize: "14px", fontWeight: 700, cursor: "pointer",
    background: C.card2, color: C.text2,
    border: `1px solid ${C.border}${C.isDark ? "30" : "60"}`,
    WebkitTapHighlightColor: "transparent",
  };

  return (
    <div className="tab-content" style={{
      maxWidth: "1000px", margin: "0 auto",
      display: "flex", flexDirection: "column", gap: "16px",
    }}>
      <style>{`@keyframes zihPulse { 0%,100%{opacity:1} 50%{opacity:.45} }`}</style>

      {/* ── 페이지 헤더 + 시장 세그먼트 + 관련 페이지 연결 행 ── */}
      <Card>
        <SectionHeader
          title="📊 지표 허브"
          sub="주식·코인 시장의 온도와 심리를 한 화면에서 — 카드를 누르면 자세한 설명이 열립니다"
        />

        {/* 시장 세그먼트 [전체 | 코인 | 주식] — 시안 Segment 문법.
            값(all/crypto/stock)과 개수 배지 로직은 기존 그대로이고 껍데기만 교체했습니다.
            개수는 로딩·실패 중에는 숨겨 0 이 잘못 읽히지 않게 합니다. */}
        <div
          role="group"
          aria-label={`시장 선택 — 현재 ${MARKET_TABS.find((t) => t.id === market)?.label || "전체"}`}
          style={{ display: "flex", position: "relative", marginBottom: "12px" }}
        >
          <Segment
            value={market}
            onChange={setMarket}
            options={MARKET_TABS.map((tab) => ({
              value: tab.id,
              label: tab.label,
              count: state.status === "ready" ? (counts[tab.id] ?? 0) : null,
            }))}
            style={{ background: C.card2 }}
          />
          {/* Segment 버튼에는 선택 상태를 나타내는 aria 속성이 없어(공용 컴포넌트라 이 파일에서
              손대지 않습니다) 스크린리더용 상태 안내를 라이브 영역으로 대신 전달합니다. */}
          <span aria-live="polite" style={{
            position: "absolute", width: "1px", height: "1px", overflow: "hidden",
            clip: "rect(0 0 0 0)", whiteSpace: "nowrap", border: 0, padding: 0, margin: "-1px",
          }}>
            {state.status === "ready"
              ? `${MARKET_TABS.find((t) => t.id === market)?.label || "전체"} 지표 ${inMarket.length}개 표시 중`
              : ""}
          </span>
        </div>
        {market !== "all" && (
          <div style={{ fontSize: "12px", color: C.text3, marginBottom: "12px", lineHeight: 1.5 }}>
            환율·공포탐욕처럼 두 시장에 함께 걸리는 거시 지표는 코인·주식 양쪽에 표시됩니다.
          </div>
        )}

        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <button onClick={() => go("screener")} style={shortcutBtnStyle}>
            🔍 스크리너
          </button>
          <button onClick={() => go("screener", "stock")} style={shortcutBtnStyle}>
            📈 주식 분석
          </button>
          <button onClick={() => go("/coin")} style={shortcutBtnStyle}>
            🪙 코인 분석
          </button>
          <button onClick={() => go("econ-calendar")} style={shortcutBtnStyle}>
            📅 경제 캘린더
          </button>
          <button onClick={() => go("sentiment")} style={shortcutBtnStyle}>
            💬 시장 심리
          </button>
        </div>
      </Card>

      {/* ── 로딩 스켈레톤 ── */}
      {state.status === "loading" && (
        <div style={gridStyle}>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={`zih-skel-${i}`} style={{
              background: C.card,
              border: `1px solid ${C.border}${C.isDark ? "18" : "40"}`,
              borderRadius: RADIUS.xl, padding: "16px 18px",
              animation: "zihPulse 1.4s ease-in-out infinite",
            }}>
              <div style={{ width: "42%", height: "12px", borderRadius: "6px", background: C.card2 }} />
              <div style={{ width: "55%", height: "30px", borderRadius: "8px", background: C.card2, marginTop: "12px" }} />
              <div style={{ width: "82%", height: "12px", borderRadius: "6px", background: C.card2, marginTop: "12px" }} />
            </div>
          ))}
        </div>
      )}

      {/* ── 실패 — 빈 화면 금지: 안내 + 재시도 ── */}
      {state.status === "error" && (
        <Card style={{ textAlign: "center", padding: "44px 20px" }}>
          <div style={{ fontSize: "28px", lineHeight: 1 }}>⚠️</div>
          <div style={{ marginTop: "10px", fontSize: "15px", fontWeight: 700, color: C.text1 }}>
            지표를 불러오지 못했습니다
          </div>
          <div style={{ marginTop: "4px", fontSize: "13px", color: C.text3 }}>
            네트워크 상태를 확인한 뒤 다시 시도해 주세요.
          </div>
          <button onClick={fetchSummary} style={{
            marginTop: "16px", padding: "9px 22px", borderRadius: RADIUS.lg,
            border: "none", background: C.blue, color: "#fff",
            fontSize: "14px", fontWeight: 700, cursor: "pointer",
          }}>
            다시 시도
          </button>
        </Card>
      )}

      {/* ── 지표 그리드 (상한 8) ── */}
      {state.status === "ready" && (
        visible.length === 0 ? (
          <Card style={{ textAlign: "center", padding: "44px 20px" }}>
            <div style={{ fontSize: "15px", fontWeight: 700, color: C.text1 }}>
              {state.indicators.length > 0 ? "이 시장의 지표가 아직 없습니다" : "표시할 지표가 아직 없습니다"}
            </div>
            <div style={{ marginTop: "4px", fontSize: "13px", color: C.text3 }}>
              {state.indicators.length > 0
                ? "데이터 소스가 일시적으로 응답하지 않을 수 있습니다. 전체 보기로 다른 지표를 확인해 보세요."
                : "지표 데이터가 준비되는 대로 이곳에 표시됩니다."}
            </div>
            {state.indicators.length > 0 && market !== "all" && (
              <button onClick={() => setMarket("all")} style={{
                marginTop: "16px", padding: "9px 22px", borderRadius: RADIUS.lg,
                border: "none", background: C.blue, color: "#fff",
                fontSize: "14px", fontWeight: 700, cursor: "pointer",
              }}>
                전체 보기
              </button>
            )}
          </Card>
        ) : (
          <>
            <div style={gridStyle}>
              {visible.map((ind, i) => {
                const key = ind.id || `${ind.title}-${i}`;
                // 0~100 스케일로 등록된 지표만 게이지 — 그 외는 기존 카드 규격 그대로
                const meta = GAUGE_META[ind.id];
                if (meta) return <GaugeIndicatorCard key={key} ind={ind} meta={meta} />;
                return (
                  <IndicatorCard
                    key={key}
                    title={ind.title}
                    value={ind.value}
                    unit={ind.unit}
                    label={ind.label}
                    tone={ind.tone}
                    desc={ind.desc}
                    detail={ind.detail}
                    updatedAt={fmtUpdated(ind.updatedAt)}
                  />
                );
              })}
            </div>
            {hasMore && (
              <div style={{ textAlign: "center", fontSize: "13px", color: C.text3, padding: "2px 0 6px" }}>
                더 많은 지표 준비 중
              </div>
            )}
          </>
        )
      )}

      {/* ── 공통 면책 — 시안이 모든 정보 화면 끝에 두는 한 줄 ── */}
      <Disclaimer style={{ paddingBottom: "8px" }}>
        지표는 시장 상태를 요약한 참고 정보이며 투자 조언이 아닙니다. 투자 판단과 책임은 본인에게 있습니다.
      </Disclaimer>
    </div>
  );
}
