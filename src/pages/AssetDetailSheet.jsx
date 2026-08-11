// ════════════════════════════════════════════════════════════════════
// 자산 상세 시트 (Asset detail) — 2026-08 모바일 디자인 시안 이식
// ────────────────────────────────────────────────────────────────────
// 대표가 제공한 모바일 시안에는 있는데 서비스에는 대응 화면이 없던 "종목 하나를
// 끝까지 읽는 화면"입니다. 시안 순서를 그대로 옮겼습니다.
//
//   헤더(뒤로가기 · 심볼 · 관심 별) → 종목명 · 큰 가격 · 등락 알약 · 기준시각
//   → 추이 차트 + 기간 탭 → 종합 신호 카드 → 주요 레벨(S/R) → 보조지표 2×2
//   → 관련 뉴스 → 면책
//
// ★ 이 파일은 "순수 프레젠테이션 컴포넌트"입니다 — fetch·상태 저장·라우팅이 전혀 없고
//   모든 값을 props 로 받습니다.
//   ★ 배선 현황(2026-08): 시세·signal/levels/indicators 는 App.jsx 의
//      buildAssetDetailProps(coin-scores + sr 스키마)가, spark/range/onRangeChange 는
//      App.jsx 의 /api/coingecko OHLC 배선이 채우고 있습니다.
//      · news → 뉴스 탭이 쓰는 소스 — 유일한 미배선 잔여 과제입니다(섹션 자동 숨김).
//
// ── props 계약 ──────────────────────────────────────────────────────
//  symbol        : string            심볼 표기 (예: "BTCUSDT", "005930")
//  name          : string            종목명 (예: "비트코인", "삼성전자")
//  meta          : string            심볼 아래 보조 표기 (예: "바이낸스 · 무기한")
//  price         : string|number     표시용 가격 문자열 (통화기호·자릿수 포함해 완성된 값 권장)
//  changePct     : number            등락률(%) — 숫자만. 부호·색은 컴포넌트가 붙입니다
//  asOfLabel     : string            "10분 전 기준" 같은 기준시각 문구 (없으면 숨김)
//  isFavorite    : boolean           관심종목 여부 (별 채움)
//  onToggleFavorite : () => void     관심 토글 (없으면 별 버튼 숨김)
//  onBack        : () => void        뒤로가기 (없으면 뒤로가기 버튼 숨김)
//  spark         : { points: number[], dir: "up"|"down" }   추이 라인 (points 비면 차트 섹션 숨김)
//  ranges        : [{ value, label }]  기간 탭 목록 (기본 1D/1W/1M/1Y)
//  range         : string            현재 선택 기간 value
//  onRangeChange : (value) => void   기간 변경 (App.jsx 배선 완료 — 미전달 시 탭은 표시만 되고 동작 없음)
//  sparkPending  : boolean           기간 전환 등으로 새 차트 데이터를 불러오는 중 표시 —
//                                    이전 기간 차트를 흐리게 유지해 탭-차트 불일치 오해를 줄입니다
//  signal        : {
//                    dir: "up"|"down"|"neutral", sideLabel: string,  // 예: "상승 우세"
//                    score: number,                                  // 종합 점수
//                    timeframes: [{ label: "1주", dir: "up"|"down"|null }],
//                    reasons: string[]                               // 근거 2줄 권장
//                  }                 (없으면 섹션 숨김)
//  levels        : {
//                    positionPct: number,   // 0~100 — S2(0)~R2(100) 사이 현재가 위치. 없으면 바 숨김
//                    items: [{ tag: "R2"|"R1"|"S1"|"S2", price: string|number,
//                              distancePct: number, touches: number }]
//                  }                 (items 비면 섹션 숨김)
//  indicators    : [{ label: "RSI(14)", value: string|number, note: string,
//                     dir: "up"|"down"|"neutral" }]   2×2 그리드 (비면 섹션 숨김)
//  news          : [{ id, title, source, timeAgo,
//                     sentiment: "up"|"down"|"neutral", sentimentLabel: string,
//                     onClick?: () => void }]         (비면 섹션 숨김)
//
// 표현 원칙(서비스 공통): 행동 지시 워딩 금지. "매수/진입/사세요" 대신 "상승 신호 우세"
// 처럼 상태만 서술합니다. 데이터가 없으면 가짜 수치 대신 섹션째 숨깁니다.
// 색은 전부 테마 토큰(C.*) — 라이트 모드 동작 필수, 하드코딩 hex 없음.
// ════════════════════════════════════════════════════════════════════
import { ChevronLeft, Star } from "lucide-react";
import { useThemeTokens } from "../ui/theme.jsx";
import {
  accentOf, Num, ChangeNum, SidePill, TimeframeChips, Segment,
  IconButton, Disclaimer, Sparkline, useKitText,
} from "../components/mobileKit.jsx";

// 기간 탭 기본값 — 시안과 동일. 라벨은 렌더 시 언어 설정(mobile.kit.range*)을 따르고,
// 키 미등록·Provider 부재 시 여기 한국어 기본값으로 동작합니다.
const DEFAULT_RANGES = [
  { value: "1D", key: "mobile.kit.range1d", label: "1일" },
  { value: "1W", key: "mobile.kit.range1w", label: "1주" },
  { value: "1M", key: "mobile.kit.range1m", label: "1개월" },
  { value: "1Y", key: "mobile.kit.range1y", label: "1년" },
];

/** 섹션 껍데기 — 제목 + 카드. 시안의 카드 radius 16 / 내부 여백 규칙을 씁니다. */
function Section({ title, children, style }) {
  const C = useThemeTokens();
  return (
    <section style={style}>
      {title && (
        <div style={{ fontSize: "14px", fontWeight: 800, color: C.text1, marginBottom: "9px" }}>{title}</div>
      )}
      {children}
    </section>
  );
}

/** 기본 카드 — 배경·보더·radius 만 담당 */
function Panel({ children, style }) {
  const C = useThemeTokens();
  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`, borderRadius: "16px",
      padding: "14px 16px", ...style,
    }}>{children}</div>
  );
}

/** 주요 레벨 한 행 — 태그 · 가격 · 거리% · 터치 횟수 */
function LevelRow({ item, last }) {
  const C = useThemeTokens();
  const tt = useKitText();
  const isRes = String(item.tag || "").toUpperCase().startsWith("R");
  const a = accentOf(C, isRes ? "down" : "up"); // 저항=빨강 / 지지=초록 (시안 규칙)
  const dist = Number(item.distancePct);
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: "10px", padding: "11px 0",
      borderBottom: last ? "none" : `1px solid ${C.card2}`,
    }}>
      <span style={{
        fontSize: "11px", fontWeight: 800, padding: "3px 8px", borderRadius: "6px",
        background: a.bg, color: a.hi, flexShrink: 0, minWidth: "32px", textAlign: "center",
      }}>{item.tag}</span>
      <Num size="14px" style={{ flex: 1, minWidth: 0 }}>{item.price ?? "—"}</Num>
      {Number.isFinite(dist) && (
        <span style={{ fontSize: "11px", color: C.text3, flexShrink: 0 }}>
          {tt("mobile.kit.vsPrice", "현재가 대비")} <Num size="11px" weight={700} color={C.text2}>{dist >= 0 ? "+" : ""}{dist.toFixed(2)}%</Num>
        </span>
      )}
      {Number.isFinite(Number(item.touches)) && (
        // 숫자(Num 스타일)를 사이에 끼우기 위해 접두/접미 2키로 분리 — en 은 접미가 빈 문자열
        <span style={{ fontSize: "11px", color: C.text4, flexShrink: 0 }}>
          {tt("mobile.kit.touchPrefix", "터치")} <Num size="11px" weight={700} color={C.text3}>{item.touches}</Num>{tt("mobile.kit.touchSuffix", "회")}
        </span>
      )}
    </div>
  );
}

export default function AssetDetailSheet({
  symbol, name, meta, price, changePct, asOfLabel,
  isFavorite = false, onToggleFavorite, onBack,
  spark, ranges, range, onRangeChange, sparkPending = false,
  signal, levels, indicators = [], news = [],
}) {
  const C = useThemeTokens();
  const tt = useKitText();
  const rangeOptions = ranges && ranges.length
    ? ranges
    : DEFAULT_RANGES.map((r) => ({ value: r.value, label: tt(r.key, r.label) }));
  const sparkPoints = Array.isArray(spark?.points) ? spark.points : [];
  const levelItems = Array.isArray(levels?.items) ? levels.items : [];
  const pos = Number(levels?.positionPct);
  const hasPos = Number.isFinite(pos);
  const sigAccent = accentOf(C, signal?.dir);
  const reasons = Array.isArray(signal?.reasons) ? signal.reasons.filter(Boolean) : [];

  return (
    <div style={{
      background: C.bg, color: C.text1, minHeight: "100%",
      display: "flex", flexDirection: "column",
    }}>
      {/* ── 헤더: 뒤로가기 · 심볼 · 관심 추가 ──
           ⚠️ <header> 태그를 쓰면 안 됩니다. App 의 전역 스타일이 GNB 를 위해
           `header { position: fixed !important; top: 0 !important }` 를 걸어 두어서,
           이 시트의 sticky 헤더가 화면 최상단에 고정되며 아래 종목명 줄을 덮습니다.
           (2026-08 프리뷰에서 실제로 재현 — div 로 두고 sticky 를 직접 지정합니다.) */}
      <div style={{
        position: "sticky", top: 0, zIndex: 5, background: C.bg,
        borderBottom: `1px solid ${C.border}`,
        display: "flex", alignItems: "center", gap: "10px", padding: "10px 16px",
      }}>
        {onBack && (
          <IconButton onClick={onBack} ariaLabel={tt("mobile.kit.back", "뒤로 가기")}>
            <ChevronLeft size={18} />
          </IconButton>
        )}
        <div style={{ flex: 1, minWidth: 0, fontSize: "16px", fontWeight: 800, color: C.text1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {symbol || name || "—"}
        </div>
        {onToggleFavorite && (
          <IconButton
            onClick={onToggleFavorite}
            ariaLabel={isFavorite ? tt("mobile.kit.favRemove", "관심종목에서 제거") : tt("mobile.kit.favAdd", "관심종목에 추가")}
            color={isFavorite ? (C.yellowL || C.yellow) : C.text3}
          >
            <Star size={18} fill={isFavorite ? "currentColor" : "none"} />
          </IconButton>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "18px", padding: "16px 16px 28px" }}>

        {/* ── 종목명 · 큰 가격 · 등락 · 기준시각 ── */}
        <div>
          {(name || meta) && (
            <div style={{ fontSize: "13px", color: C.text3, fontWeight: 600 }}>
              {name}{name && meta ? " · " : ""}{meta}
            </div>
          )}
          <div style={{ display: "flex", alignItems: "baseline", gap: "10px", marginTop: "6px", flexWrap: "wrap" }}>
            <Num size="32px" weight={800}>{price ?? "—"}</Num>
            {Number.isFinite(Number(changePct)) && (
              <SidePill dir={Number(changePct) >= 0 ? "up" : "down"} size="12px">
                <ChangeNum value={changePct} size="12px" />
              </SidePill>
            )}
          </div>
          {asOfLabel && (
            <div style={{ fontSize: "11px", color: C.text4, marginTop: "5px" }}>{asOfLabel}</div>
          )}
        </div>

        {/* ── 추이 차트 + 기간 탭 (데이터 없으면 섹션째 숨김) ── */}
        {sparkPoints.length > 0 && (
          <Panel style={{ padding: "14px 16px 12px" }}>
            {/* 새 기간 데이터를 불러오는 동안 이전 기간 차트를 흐리게 유지합니다 —
                "탭은 1년인데 차트는 1개월" 짧은 불일치 구간을 로딩 중으로 읽히게 처리. */}
            <div style={{ opacity: sparkPending ? 0.4 : 1, transition: "opacity .15s ease" }}>
              <Sparkline points={sparkPoints} dir={spark?.dir || "up"} height={110} />
            </div>
            <div style={{ display: "flex", marginTop: "12px" }}>
              <Segment
                value={range || rangeOptions[0].value}
                onChange={onRangeChange}
                options={rangeOptions}
                style={{ background: C.card2, border: "none" }}
              />
            </div>
          </Panel>
        )}

        {/* ── 종합 신호 카드 — 시안의 accent 전체 보더 + 상단 그라데이션 ── */}
        {signal && (
          <Section title={tt("mobile.kit.sectionSignal", "종합 신호")}>
            <div style={{
              background: `linear-gradient(180deg, ${sigAccent.bg}, transparent 42%), ${C.card}`,
              border: `1px solid ${sigAccent.base}`, borderRadius: "16px", padding: "14px 16px",
            }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px" }}>
                {/* 섹션 제목이 이미 "종합 신호" 라서 카드 안에는 방향 배지만 둡니다(중복 제거). */}
                <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
                  {signal.sideLabel && <SidePill dir={signal.dir}>{signal.sideLabel}</SidePill>}
                </div>
                {Number.isFinite(Number(signal.score)) && (
                  <div style={{ textAlign: "right", lineHeight: 1, flexShrink: 0 }}>
                    <div style={{ fontSize: "10px", color: C.text3, marginBottom: "3px" }}>{tt("mobile.kit.score", "점수")}</div>
                    <Num size="28px" weight={800} color={sigAccent.hi}>{signal.score}</Num>
                  </div>
                )}
              </div>

              {Array.isArray(signal.timeframes) && signal.timeframes.length > 0 && (
                <TimeframeChips items={signal.timeframes} style={{ marginTop: "11px" }} />
              )}

              {reasons.length > 0 && (
                <ul style={{
                  listStyle: "none", margin: "12px 0 0", padding: "12px 0 0",
                  borderTop: `1px solid ${C.card2}`, display: "flex", flexDirection: "column", gap: "6px",
                }}>
                  {reasons.map((r, i) => (
                    <li key={`reason-${i}`} style={{ display: "flex", gap: "7px", fontSize: "12px", color: C.text2, lineHeight: 1.5 }}>
                      <span aria-hidden="true" style={{ color: sigAccent.hi, flexShrink: 0 }}>·</span>
                      <span>{r}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Section>
        )}

        {/* ── 주요 레벨 (지지·저항) ── */}
        {levelItems.length > 0 && (
          <Section title={tt("mobile.kit.sectionLevels", "주요 레벨")}>
            <Panel>
              {/* S/R 사이 현재가 위치 바 — positionPct 가 없으면 바만 숨기고 행은 그대로 표시 */}
              {hasPos && (
                <div style={{ marginBottom: "10px" }}>
                  <div style={{ position: "relative", height: "16px" }}>
                    <div style={{
                      position: "absolute", top: "5px", left: 0, right: 0, height: "6px", borderRadius: "9999px",
                      background: `linear-gradient(90deg, ${C.green}, ${C.text4} 50%, ${C.red})`,
                    }} />
                    <div style={{
                      position: "absolute", top: "1px", left: `calc(${Math.max(0, Math.min(100, pos))}% - 7px)`,
                      width: "14px", height: "14px", borderRadius: "50%",
                      background: C.text1, boxShadow: `0 0 0 3px ${C.card}`,
                    }} />
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: C.text4, marginTop: "3px" }}>
                    <span>{tt("mobile.kit.supportZone", "지지 구간")}</span>
                    <span>{tt("mobile.kit.resistanceZone", "저항 구간")}</span>
                  </div>
                </div>
              )}
              {levelItems.map((it, i) => (
                <LevelRow key={`${it.tag}-${i}`} item={it} last={i === levelItems.length - 1} />
              ))}
            </Panel>
          </Section>
        )}

        {/* ── 보조지표 2×2 ── */}
        {indicators.length > 0 && (
          <Section title={tt("mobile.kit.sectionIndicators", "보조지표")}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "10px" }}>
              {indicators.map((ind, i) => {
                const a = accentOf(C, ind.dir);
                return (
                  <Panel key={ind.label || `ind-${i}`} style={{ padding: "12px 14px" }}>
                    <div style={{ fontSize: "11px", color: C.text3, fontWeight: 700 }}>{ind.label}</div>
                    <div style={{ marginTop: "5px" }}>
                      <Num size="19px" weight={800} color={ind.dir ? a.hi : C.text1}>{ind.value ?? "—"}</Num>
                    </div>
                    {ind.note && (
                      <div style={{ fontSize: "11px", color: C.text3, marginTop: "3px", lineHeight: 1.4 }}>{ind.note}</div>
                    )}
                  </Panel>
                );
              })}
            </div>
          </Section>
        )}

        {/* ── 관련 뉴스 ── */}
        {news.length > 0 && (
          <Section title={tt("mobile.kit.sectionNews", "관련 뉴스")}>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {news.map((n, i) => (
                <Panel
                  key={n.id || `news-${i}`}
                  style={{ cursor: n.onClick ? "pointer" : "default" }}
                >
                  <div
                    onClick={n.onClick}
                    role={n.onClick ? "button" : undefined}
                    tabIndex={n.onClick ? 0 : undefined}
                    onKeyDown={n.onClick ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); n.onClick(e); } } : undefined}
                  >
                    <div style={{ fontSize: "13px", fontWeight: 700, color: C.text1, lineHeight: 1.45 }}>{n.title}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "7px", flexWrap: "wrap" }}>
                      <span style={{ fontSize: "11px", color: C.text3 }}>{n.source}</span>
                      {n.timeAgo && <span style={{ fontSize: "11px", color: C.text4 }}>{n.timeAgo}</span>}
                      {n.sentimentLabel && (
                        <SidePill dir={n.sentiment} size="10px" style={{ marginLeft: "auto" }}>{n.sentimentLabel}</SidePill>
                      )}
                    </div>
                  </div>
                </Panel>
              ))}
            </div>
          </Section>
        )}

        <Disclaimer>
          {tt("mobile.kit.disclaimerDetail", "표시되는 신호·레벨·지표는 과거 데이터를 요약한 참고 정보이며 투자 조언이 아닙니다. 투자 판단과 책임은 본인에게 있습니다.")}
        </Disclaimer>
      </div>
    </div>
  );
}
