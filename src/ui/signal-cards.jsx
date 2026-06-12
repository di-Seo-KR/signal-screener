// ════════════════════════════════════════════════════════════════════
// signal-cards — 시그널 종목 카드 + 매물대(지지·저항) 레벨바 (리뉴얼 V2)
//
// ★ 2026-06-12 (대표 지시): "롱숏 신호에 종목 카드 UI + 중요 매물대(지지·저항) 실시간".
//   단일 컴포넌트 2변형(full/compact)으로 3개 표면(실전매매·홈·허브)을 커버.
//   데이터: GET /api/real-trading/coin-scores — coin.sr { s:[{p,t,d}], r:[{p,t,d}], piv, px, m }
//   sr 은 10분(cron) 갱신 — 과장 금지: 카드에 "10분 갱신"으로 명시.
//   sr=null 가드 필수(배포 과도기·계산 실패) — 레벨 행을 통째로 숨김.
// ════════════════════════════════════════════════════════════════════
import React, { useState, useMemo, useEffect, useRef, useCallback } from "react";

const TF_LABEL = { "1w": "주", "1d": "일", "4h": "4h", "1h": "1h" };
const fmtPrice = (p) => {
  if (p == null || !Number.isFinite(p)) return "—";
  if (p >= 1000) return p.toLocaleString(undefined, { maximumFractionDigits: 1 });
  if (p >= 1) return p.toLocaleString(undefined, { maximumFractionDigits: 3 });
  return p.toPrecision(4);
};
const fmtTime = (ts) => {
  try { const d = new Date(ts); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; } catch { return ""; }
};

/* ── 매물대 표시 — 지지·저항 3분할 + 현재가 위치 바 ──
   ★ 2026-06-12 (대표 피드백 "매물대가 보기 불편"): 작은 틱 4개+도트 → 가장 가까운
   지지·저항 1쌍을 큰 글씨 3분할로, 가운데 바는 '현재가가 그 사이 어디인지'만 표현.
   S2·R2 등 전체 레벨은 카드 펼침 상세에서. */
function SRBand({ sr, accent }) {
  if (!sr || !(sr.px > 0)) return null;
  const s1 = sr.s?.[0], r1 = sr.r?.[0];
  if (!s1 && !r1) return null;
  const near = (x) => x && Math.abs(x.d) <= 1; // 1% 이내 근접 — 경고색
  // 현재가 위치: S1~R1 구간 선형 보간 (한쪽 없으면 끝단 고정)
  let posPct = 50;
  if (s1 && r1 && r1.p > s1.p) posPct = Math.max(4, Math.min(96, ((sr.px - s1.p) / (r1.p - s1.p)) * 100));
  else if (s1 && !r1) posPct = 92;
  else if (!s1 && r1) posPct = 8;
  const cell = (x, label, color) => (
    <div style={{ minWidth: 0, textAlign: label === "지지" ? "left" : "right" }}>
      <div style={{ fontSize: 10, color: near(x) ? "var(--z-yellow-hi)" : "var(--z-text-3)", fontWeight: 700 }}>
        {label}{near(x) ? " · 근접" : ""}
      </div>
      <div className="z-num" style={{ fontSize: 13, fontWeight: 800, fontFamily: "var(--z-font-mono)", color: near(x) ? "var(--z-yellow-hi)" : color, lineHeight: 1.3 }}>
        {x ? fmtPrice(x.p) : "—"}
      </div>
      <div className="z-num" style={{ fontSize: 10, color: "var(--z-text-4)", fontFamily: "var(--z-font-mono)" }}>
        {x ? `${x.d > 0 ? "+" : ""}${x.d}%` : ""}
      </div>
    </div>
  );
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(64px,auto) 1fr minmax(64px,auto)", gap: 10, alignItems: "center", margin: "4px 0 2px" }}>
      {cell(s1, "지지", "var(--z-green-hi)")}
      <div style={{ position: "relative", height: 16 }} aria-hidden="true">
        <div style={{ position: "absolute", top: 6, left: 0, right: 0, height: 4, borderRadius: "var(--z-r-full)",
          background: "linear-gradient(90deg, var(--z-green-bg), var(--z-card-hi) 35%, var(--z-card-hi) 65%, var(--z-red-bg))" }} />
        <div style={{
          position: "absolute", top: 3, width: 10, height: 10, borderRadius: "50%",
          left: `calc(${posPct}% - 5px)`, background: accent,
          boxShadow: "0 0 0 2px var(--z-card)", transition: "left var(--z-dur) var(--z-ease)",
        }} />
      </div>
      {cell(r1, "저항", "var(--z-red-hi)")}
    </div>
  );
}

/* ── 카드 펼침 상세 — S/R 표 + TF 막대 + reason + 면책 ── */
function CardDetail({ coin }) {
  const sr = coin.sr;
  const rows = [];
  if (sr) {
    for (const [arr, label, color] of [[sr.r, "저항", "var(--z-red-hi)"], [sr.s, "지지", "var(--z-green-hi)"]]) {
      (arr || []).forEach((x, i) => rows.push({ label: `${label}${i + 1}`, p: x.p, d: x.d, t: x.t, color }));
    }
    rows.sort((a, b) => b.p - a.p);
  }
  const bd = coin.breakdown || {};
  return (
    <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--z-border)", display: "flex", flexDirection: "column", gap: 8 }}>
      {rows.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {rows.map((row) => (
            <div key={row.label} style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
              <span style={{ color: row.color, fontWeight: 700, width: 42 }}>{row.label}</span>
              <span className="z-num" style={{ color: "var(--z-text)", fontFamily: "var(--z-font-mono)", flex: 1, textAlign: "right" }}>{fmtPrice(row.p)}</span>
              <span className="z-num" style={{ color: Math.abs(row.d) <= 1 ? "var(--z-yellow-hi)" : "var(--z-text-3)", fontFamily: "var(--z-font-mono)", width: 58, textAlign: "right" }}>
                {row.d > 0 ? "+" : ""}{row.d}%
              </span>
              <span style={{ color: "var(--z-text-4)", fontSize: 10, width: 48, textAlign: "right" }}>{row.t > 0 ? `터치 ${row.t}회` : "피봇"}</span>
            </div>
          ))}
          <div style={{ fontSize: 10, color: "var(--z-text-4)" }}>최근 60일 일봉 매물대 기준 · 10분마다 재계산</div>
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {["1w", "1d", "4h", "1h"].map((tf) => {
          const x = bd[tf];
          const isL = x?.side === "LONG";
          return (
            <div key={tf} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11 }}>
              <span style={{ width: 22, color: "var(--z-text-3)", fontWeight: 700 }}>{TF_LABEL[tf]}</span>
              <div style={{ flex: 1, height: 5, background: "var(--z-card-hi)", borderRadius: 3, overflow: "hidden" }}>
                {x && <div style={{ width: `${Math.min(100, x.score)}%`, height: "100%", background: isL ? "var(--z-green)" : "var(--z-red)" }} />}
              </div>
              <span className="z-num" style={{ width: 48, textAlign: "right", color: x ? (isL ? "var(--z-green-hi)" : "var(--z-red-hi)") : "var(--z-text-4)", fontFamily: "var(--z-font-mono)" }}>
                {x ? `${isL ? "롱" : "숏"} ${x.score}` : "—"}
              </span>
            </div>
          );
        })}
      </div>
      {coin.reason && <div style={{ fontSize: 11, color: "var(--z-text-3)", lineHeight: 1.5 }}>{coin.reason}</div>}
      <div style={{ fontSize: 10, color: "var(--z-text-4)" }}>투자 판단의 참고 지표이며 매수·매도 권유가 아닙니다.</div>
    </div>
  );
}

/* ── 시그널 종목 카드 ── */
export const SignalCoinCard = React.memo(function SignalCoinCard({ coin, variant = "full", expanded = false, onToggle }) {
  const isLong = coin.side === "LONG";
  const accent = isLong ? "var(--z-green)" : "var(--z-red)";
  const accentHi = isLong ? "var(--z-green-hi)" : "var(--z-red-hi)";
  const accentBg = isLong ? "var(--z-green-bg)" : "var(--z-red-bg)";
  const score = Math.round(Math.max(0, Math.min(100, parseFloat(coin.score || 0))));
  const strong = score >= 80;
  const ticker = (coin.symbol || coin.asset || "—").replace("USDT", "");
  const sr = coin.sr;
  const s1 = sr?.s?.[0], r1 = sr?.r?.[0];
  const bd = coin.breakdown || {};
  const compact = variant === "compact";

  return (
    <div
      role="button" tabIndex={0}
      aria-label={`${ticker} ${isLong ? "롱" : "숏"} 신호 ${score}점${s1 ? `, 지지 ${Math.abs(s1.d)}% 아래` : ""}${r1 ? `, 저항 ${r1.d}% 위` : ""}`}
      onClick={onToggle}
      onKeyDown={(e) => { if (e.key === "Enter" && onToggle) onToggle(); }}
      style={{
        background: `linear-gradient(180deg, ${accentBg}, transparent 40%), var(--z-card)`,
        border: strong ? `1px solid ${accent}` : "1px solid var(--z-border)",
        borderLeft: `3px solid ${accent}`,
        boxShadow: strong ? (isLong ? "var(--z-sh-glow-green)" : "var(--z-sh-glow-red)") : "none",
        borderRadius: "var(--z-r-lg)",
        padding: compact ? "10px 12px" : "12px 14px",
        cursor: onToggle ? "pointer" : "default",
        minWidth: compact ? 200 : 0,
        scrollSnapAlign: compact ? "start" : undefined,
        contentVisibility: "auto", containIntrinsicSize: "auto 120px",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      {/* Row 1 — 심볼 + 방향 + 점수 */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
          <span style={{ fontWeight: 800, color: "var(--z-text)", fontSize: compact ? 14 : 16 }}>{ticker}</span>
          <span style={{
            fontSize: 11, fontWeight: 800, padding: "2px 8px", borderRadius: "var(--z-r-full)",
            background: accentBg, color: accentHi, whiteSpace: "nowrap",
          }}>{isLong ? "▲ 롱" : "▼ 숏"}</span>
          {strong && !compact && (
            <span style={{ fontSize: 9, fontWeight: 800, padding: "2px 6px", borderRadius: "var(--z-r-full)", background: accentBg, color: accentHi }}>강한 신호</span>
          )}
        </div>
        <div style={{ textAlign: "right", lineHeight: 1 }}>
          <div style={{ fontSize: 10, color: "var(--z-text-3)", marginBottom: 2 }}>종합</div>
          <span className="z-num" style={{ fontSize: compact ? 17 : 20, fontWeight: 800, fontFamily: "var(--z-font-mono)", color: accentHi }}>{score}</span>
        </div>
      </div>

      {/* Row 2 — TF 칩 4개 */}
      <div style={{ display: "flex", gap: 6, margin: "8px 0 6px", flexWrap: "wrap" }}>
        {["1w", "1d", "4h", "1h"].map((tf) => {
          const x = bd[tf];
          const isL = x?.side === "LONG";
          return (
            <span key={tf} style={{
              fontSize: 11, fontWeight: 700, padding: "3px 8px", borderRadius: "var(--z-radius-xs)",
              background: x ? (isL ? "var(--z-green-bg)" : "var(--z-red-bg)") : "var(--z-card-2)",
              color: x ? (isL ? "var(--z-green-hi)" : "var(--z-red-hi)") : "var(--z-text-4)",
              whiteSpace: "nowrap",
            }}>
              {TF_LABEL[tf]} {x ? `${isL ? "▲" : "▼"}${compact ? "" : x.score}` : "—"}
            </span>
          );
        })}
      </div>

      {/* Row 3 — 매물대 (sr 없으면 통째로 숨김 — null 가드) */}
      {sr && (s1 || r1) && (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 10, color: "var(--z-text-4)" }}>매물대 (최근 60일)</span>
            <span className="z-num" style={{ fontSize: 12, fontFamily: "var(--z-font-mono)", color: "var(--z-text)" }}>현재 {fmtPrice(sr.px)}</span>
          </div>
          <SRBand sr={sr} accent={accentHi} />
        </>
      )}

      {/* Row 4 — 메타 */}
      {!compact && (
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 10, color: "var(--z-text-3)" }}>
          <span>{coin.ts ? `${fmtTime(coin.ts)} 기준 · 10분 갱신` : "10분 갱신"}</span>
          <span>확신 {coin.confidence != null ? `${Math.round(coin.confidence * 100)}%` : "—"}</span>
        </div>
      )}

      {expanded && <CardDetail coin={coin} />}
    </div>
  );
}, (prev, next) => prev.coin.ts === next.coin.ts && prev.coin.score === next.coin.score && prev.expanded === next.expanded && prev.variant === next.variant);

/* ── 시그널 보드 — 헤더 게이지 + 필터 + 카드 목록 ── */
export function SignalCoinBoard({ coins = [], counts = {}, loading = false, variant = "full", isMobile = false, updatedAt = null }) {
  const [filter, setFilter] = useState("all");   // all | long | short
  const [sortBy, setSortBy] = useState("score"); // score | level
  const [showAll, setShowAll] = useState(false);
  const [openKey, setOpenKey] = useState(null);

  const total = counts.total ?? coins.length;
  const long = counts.long ?? coins.filter((c) => c.side === "LONG").length;
  const short = counts.short ?? coins.filter((c) => c.side === "SHORT").length;
  const longPct = total > 0 ? Math.round((long / total) * 100) : 50;
  const bias = longPct >= 60 ? { label: "롱 우위", color: "var(--z-green-hi)" } : longPct <= 40 ? { label: "숏 우위", color: "var(--z-red-hi)" } : { label: "중립", color: "var(--z-text-2)" };

  const visible = useMemo(() => {
    let arr = coins;
    if (filter === "long") arr = arr.filter((c) => c.side === "LONG");
    if (filter === "short") arr = arr.filter((c) => c.side === "SHORT");
    if (sortBy === "level") {
      const dist = (c) => {
        const ds = [c.sr?.s?.[0]?.d, c.sr?.r?.[0]?.d].filter((d) => Number.isFinite(d)).map(Math.abs);
        return ds.length ? Math.min(...ds) : Infinity;
      };
      arr = [...arr].sort((a, b) => dist(a) - dist(b));
    }
    return arr;
  }, [coins, filter, sortBy]);

  const collapsedLimit = variant === "compact" ? 8 : isMobile ? 12 : 18;
  const shown = showAll ? visible : visible.slice(0, collapsedLimit);
  const hidden = visible.length - shown.length;

  if (loading && coins.length === 0) {
    return (
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill, minmax(300px, 1fr))", gap: 10 }}>
        {Array.from({ length: 6 }).map((_, i) => <div key={i} className="z-skel" style={{ height: 120, borderRadius: "var(--z-r-lg)" }} />)}
      </div>
    );
  }
  if (!coins.length) {
    return (
      <div style={{ padding: 24, textAlign: "center", fontSize: 14, color: "var(--z-text-3)", border: "1px dashed var(--z-border)", borderRadius: "var(--z-r-md)" }}>
        신호 집계 중이에요 — 10분마다 갱신됩니다.
      </div>
    );
  }

  const segBtn = (key, label, color) => (
    <button key={key} role="tab" aria-selected={filter === key} onClick={() => { setFilter(key); setShowAll(false); }}
      style={{
        padding: "7px 13px", borderRadius: 9, border: filter === key ? `1px solid ${color || "var(--z-blue)"}` : "1px solid transparent",
        background: filter === key ? (key === "long" ? "var(--z-green-bg)" : key === "short" ? "var(--z-red-bg)" : "var(--z-blue-bg)") : "var(--z-card-2)",
        color: filter === key ? (color || "var(--z-blue-hi)") : "var(--z-text-2)",
        fontSize: 13, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap",
      }}>{label}</button>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {/* 헤더 — 분포 게이지 + 바이어스 */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, fontWeight: 800, color: "var(--z-green-hi)" }}>▲ 롱 {long}</span>
          <div style={{ flex: 1, minWidth: 80, height: 8, borderRadius: "var(--z-r-full)", overflow: "hidden", display: "flex", background: "var(--z-card-hi)" }}>
            <div style={{ width: `${longPct}%`, background: "var(--z-green)" }} />
            <div style={{ flex: 1, background: "var(--z-red)" }} />
          </div>
          <span style={{ fontSize: 12, fontWeight: 800, color: "var(--z-red-hi)" }}>숏 {short} ▼</span>
          <span style={{ fontSize: 11, fontWeight: 800, padding: "2px 8px", borderRadius: "var(--z-r-full)", border: "1px solid var(--z-border)", color: bias.color }}>{bias.label}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
          <div style={{ display: "inline-flex", gap: 4, background: "var(--z-card)", border: "1px solid var(--z-border)", borderRadius: 12, padding: 3 }}>
            {segBtn("all", `전체 ${total}`)}
            {segBtn("long", `롱 ${long}`, "var(--z-green-hi)")}
            {segBtn("short", `숏 ${short}`, "var(--z-red-hi)")}
          </div>
          {variant === "full" && (
            <div style={{ display: "flex", gap: 10, fontSize: 12 }}>
              {[["score", "점수순"], ["level", "매물대 근접순"]].map(([k, label]) => (
                <button key={k} onClick={() => setSortBy(k)} style={{
                  background: "transparent", border: "none", cursor: "pointer", padding: "4px 2px",
                  color: sortBy === k ? "var(--z-blue-hi)" : "var(--z-text-3)", fontWeight: sortBy === k ? 800 : 600,
                }}>{label}</button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 카드 목록 — compact=가로 스냅 캐러셀 / full=반응형 그리드.
          ★ 2026-06-12 (대표 피드백): alignItems start — 한 카드를 펼쳐도 같은 행/줄의
          다른 카드가 따라 늘어나지 않게(stretch 기본값 제거). 펼친 카드만 커진다. */}
      <div style={variant === "compact" ? {
        display: "flex", gap: 10, overflowX: "auto", scrollSnapType: "x mandatory",
        paddingBottom: 4, WebkitOverflowScrolling: "touch", alignItems: "flex-start",
      } : {
        display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill, minmax(300px, 1fr))", gap: 10,
        alignItems: "start",
      }}>
        {shown.map((c) => {
          const key = `${c.asset}:${c.side}`;
          return (
            <SignalCoinCard key={key} coin={c} variant={variant}
              expanded={openKey === key}
              onToggle={() => setOpenKey(openKey === key ? null : key)} />
          );
        })}
      </div>

      {variant === "full" && (hidden > 0 || showAll) && visible.length > collapsedLimit && (
        <button onClick={() => setShowAll((v) => !v)} style={{
          padding: "9px 10px", width: "100%", background: "transparent",
          border: "1px dashed var(--z-border)", borderRadius: "var(--z-r-md)",
          color: "var(--z-text-2)", fontSize: 12, fontWeight: 700, cursor: "pointer",
        }}>{showAll ? "접기" : `전체 ${visible.length}개 보기 (+${hidden})`}</button>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--z-text-4)" }}>
        <span>주 30% · 일 25% · 4h 25% · 1h 20% 가중 종합 + 최근 60일 매물대 · 10분 갱신{updatedAt ? ` · ${fmtTime(updatedAt)} 기준` : ""}</span>
        <span>투자 권유 아님</span>
      </div>
    </div>
  );
}

/* ── 홈 리드 모듈 — 자급식(fetch+캐시) 라이브 시그널 보드 ── */
export function HomeSignalBoard({ isMobile = false, onNavigate }) {
  const [data, setData] = useState(() => {
    try { return JSON.parse(localStorage.getItem("zepta:coin-scores:cache") || "null"); } catch { return null; }
  });
  const [loading, setLoading] = useState(!data);
  const timerRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/real-trading/coin-scores?limit=60");
      const j = await r.json();
      if (j?.ok && Array.isArray(j.coins)) {
        setData(j);
        try { localStorage.setItem("zepta:coin-scores:cache", JSON.stringify(j)); } catch {}
      }
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => {
    load();
    timerRef.current = setInterval(load, 5 * 60 * 1000); // 홈은 5분 폴링(생성 주기 10분)
    return () => clearInterval(timerRef.current);
  }, [load]);

  return (
    <div className="ui-card" style={{ background: "var(--z-card)", border: "1px solid var(--z-border)", borderRadius: 16, padding: isMobile ? 14 : 18 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ position: "relative", width: 8, height: 8 }}>
            <span className="z-pulse" style={{ position: "absolute", inset: 0, borderRadius: "50%", background: "var(--z-green)" }} />
          </span>
          <span style={{ fontWeight: 800, fontSize: 17, color: "var(--z-text)" }}>라이브 시그널</span>
          <span style={{ fontSize: 11, color: "var(--z-text-3)" }}>바이낸스 선물 상위 코인 · 10분 갱신</span>
        </div>
        {onNavigate && (
          <button onClick={() => onNavigate("real-trading")} style={{
            background: "transparent", border: "none", cursor: "pointer",
            color: "var(--z-blue-hi)", fontSize: 12, fontWeight: 700,
          }}>전체 보기 →</button>
        )}
      </div>
      <SignalCoinBoard
        coins={data?.coins || []} counts={data?.counts || {}}
        loading={loading} variant="compact" isMobile={isMobile}
        updatedAt={data?.updatedAt || null}
      />
    </div>
  );
}
