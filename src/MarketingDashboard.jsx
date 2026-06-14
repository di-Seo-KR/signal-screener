// ══════════════════════════════════════════════════════════════════
// Zepta — 마케팅 대시보드 (/marketing, 오너 전용) · GA4급 v2
// ──────────────────────────────────────────────────────────────────
// 자체 퍼스트파티 애널리틱스(GA 대체). 데이터: /api/marketing-stats.
// 구성: 가입수·실시간 KPI / PV·UV 추이(영역+선) / 전환 퍼널 /
//       신규vs재방문·디바이스·유입 도넛 / 일별 현황 표 / 국가·OS·브라우저 /
//       인기페이지·유입·UTM·이벤트 랭킹. 차트는 순수 SVG(번들 영향 0).
// ══════════════════════════════════════════════════════════════════
import { useEffect, useState, useCallback } from "react";
import { useThemeTokens, FONT, RADIUS } from "./ui/theme.jsx";
import { useBreakpoint } from "./ui/useBreakpoint.jsx";
import { LoadingBlock } from "./ui/primitives.jsx";
import { useAuth } from "./AuthProvider.jsx";

const fmtN = (v) => (v == null ? "—" : Number(v).toLocaleString());
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0);
const COUNTRY_KO = { KR: "한국", US: "미국", JP: "일본", CN: "중국", GB: "영국", DE: "독일", IN: "인도", VN: "베트남", CA: "캐나다", AU: "호주", FR: "프랑스", SG: "싱가포르", TW: "대만", HK: "홍콩", 기타: "기타", "": "기타" };

function Card({ C, title, sub, right, children, style }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: RADIUS.xl, padding: 16, ...style }}>
      {(title || right) && (
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 12, gap: 8 }}>
          <div>
            <div style={{ fontSize: FONT.base, fontWeight: 800, color: C.text1 }}>{title}</div>
            {sub && <div style={{ fontSize: FONT.xs, color: C.text3, marginTop: 2 }}>{sub}</div>}
          </div>
          {right}
        </div>
      )}
      {children}
    </div>
  );
}

// ── PV(영역) + UV(선) 추이 차트 ──
function TrendChart({ C, days, isMobile }) {
  if (!days || days.length === 0) return null;
  const W = 100, H = 42; // viewBox 단위 (반응형 — width 100%)
  const maxPv = Math.max(...days.map(d => d.pv), 1);
  const maxUv = Math.max(...days.map(d => d.uv), 1);
  const n = days.length;
  const x = (i) => (n <= 1 ? 0 : (i / (n - 1)) * W);
  const yPv = (v) => H - (v / maxPv) * (H - 4) - 2;
  const yUv = (v) => H - (v / maxUv) * (H - 4) - 2;
  const pvLine = days.map((d, i) => `${x(i)},${yPv(d.pv)}`).join(" ");
  const pvArea = `0,${H} ${pvLine} ${W},${H}`;
  const uvLine = days.map((d, i) => `${x(i)},${yUv(d.uv)}`).join(" ");
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: "100%", height: isMobile ? 120 : 150, display: "block" }}>
        <polygon points={pvArea} fill={`${C.blue}22`} />
        <polyline points={pvLine} fill="none" stroke={C.blue} strokeWidth="0.8" vectorEffect="non-scaling-stroke" />
        <polyline points={uvLine} fill="none" stroke={C.green} strokeWidth="0.8" strokeDasharray="2 1.5" vectorEffect="non-scaling-stroke" />
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: C.text3, marginTop: 4 }}>
        <span>{days[0]?.date.slice(5)}</span>
        <span style={{ display: "flex", gap: 12 }}>
          <span><span style={{ color: C.blue }}>■</span> 페이지뷰</span>
          <span><span style={{ color: C.green }}>┄</span> 방문자</span>
        </span>
        <span>{days[n - 1]?.date.slice(5)} (오늘)</span>
      </div>
    </div>
  );
}

// ── 도넛 (카테고리 비율) ──
function Donut({ C, data, colors, label }) {
  const total = data.reduce((a, d) => a + d.v, 0);
  if (total === 0) return <div style={{ fontSize: FONT.sm, color: C.text3, padding: "20px 0", textAlign: "center" }}>데이터 수집 중…</div>;
  const R = 16, CC = 21, sw = 9;
  const circ = 2 * Math.PI * R;
  let off = 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
      <svg viewBox="0 0 42 42" width="84" height="84" style={{ flexShrink: 0, transform: "rotate(-90deg)" }}>
        {data.map((d, i) => {
          const frac = d.v / total;
          const dash = frac * circ;
          const seg = (
            <circle key={i} cx={CC} cy={CC} r={R} fill="none" stroke={colors[i % colors.length]}
              strokeWidth={sw} strokeDasharray={`${dash} ${circ - dash}`} strokeDashoffset={-off} />
          );
          off += dash;
          return seg;
        })}
      </svg>
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 5 }}>
        {data.map((d, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
            <span style={{ width: 9, height: 9, borderRadius: 3, background: colors[i % colors.length], flexShrink: 0 }} />
            <span style={{ color: C.text2, flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{d.k}</span>
            <span style={{ color: C.text1, fontWeight: 700 }}>{pct(d.v, total)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── 전환 퍼널 (가로 막대 + 잔존율) ──
function Funnel({ C, steps }) {
  const top = steps[0]?.n || 0;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {steps.map((s, i) => {
        const w = top > 0 ? Math.max(4, (s.n / top) * 100) : 4;
        const fromPrev = i > 0 && steps[i - 1].n > 0 ? pct(s.n, steps[i - 1].n) : null;
        return (
          <div key={s.step}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 3 }}>
              <span style={{ color: C.text2, fontWeight: 600 }}>{s.step}</span>
              <span style={{ color: C.text1, fontWeight: 700 }}>
                {fmtN(s.n)}{fromPrev != null && <span style={{ color: fromPrev >= 50 ? C.green : fromPrev >= 20 ? C.yellow : C.red, marginLeft: 6 }}>{fromPrev}%</span>}
              </span>
            </div>
            <div style={{ height: 14, borderRadius: 6, background: `${C.border}30`, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${w}%`, background: `linear-gradient(90deg, ${C.blue}, ${C.purple})`, borderRadius: 6, transition: "width .4s" }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function RankTable({ C, rows, unit = "회", emptyText = "데이터 수집 중…", mapKey }) {
  if (!rows || rows.length === 0) return <div style={{ padding: "16px 0", textAlign: "center", color: C.text3, fontSize: FONT.sm }}>{emptyText}</div>;
  const max = Math.max(...rows.map(r => r.v), 1);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {rows.map((r) => (
        <div key={r.k} style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: FONT.sm, color: C.text1, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{mapKey ? mapKey(r.k) : r.k}</div>
            <div style={{ height: 4, borderRadius: 4, background: `${C.border}40`, marginTop: 3, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${Math.max(3, (r.v / max) * 100)}%`, background: C.blue, borderRadius: 4 }} />
            </div>
          </div>
          <span className="z-num" style={{ fontSize: FONT.sm, fontWeight: 700, color: C.text2, flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{fmtN(r.v)}{unit}</span>
        </div>
      ))}
    </div>
  );
}

function KpiCard({ C, label, value, sub, color, isMobile }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, padding: 14 }}>
      <div className="z-num" style={{ fontSize: isMobile ? 20 : 24, fontWeight: 900, color: color || C.text1, fontVariantNumeric: "tabular-nums", lineHeight: 1.15 }}>{value}</div>
      <div style={{ fontSize: FONT.xs, color: C.text3, marginTop: 2 }}>{label}</div>
      {sub && <div style={{ fontSize: 11, color: C.text3, marginTop: 1 }}>{sub}</div>}
    </div>
  );
}

export default function MarketingDashboard() {
  const C = useThemeTokens();
  const { isMobile } = useBreakpoint();
  const { user } = useAuth();
  const [days, setDays] = useState(14);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  const load = useCallback(async () => {
    if (!user?.id) { setLoading(false); setErr("login"); return; }
    setLoading(true);
    try {
      const r = await fetch(`/api/marketing-stats?uid=${encodeURIComponent(user.id)}&days=${days}`);
      if (r.status === 403) { setErr("forbidden"); setData(null); return; }
      const j = await r.json();
      if (j?.ok) { setData(j); setErr(null); } else setErr(j?.error || "load");
    } catch { setErr("load"); } finally { setLoading(false); }
  }, [user, days]);

  useEffect(() => { load(); }, [load]);
  // 실시간 활성 30초 갱신
  useEffect(() => {
    if (!data) return;
    const iv = setInterval(load, 30000);
    return () => clearInterval(iv);
  }, [data, load]);

  if (err === "login" || err === "forbidden") {
    return (
      <div style={{ maxWidth: 720, margin: "0 auto", padding: 24, textAlign: "center" }}>
        <div style={{ fontSize: 40, margin: "40px 0 12px" }}>🔒</div>
        <div style={{ fontSize: FONT.lg, fontWeight: 800, color: C.text1 }}>마케팅 대시보드는 운영자 전용입니다</div>
        <div style={{ fontSize: FONT.sm, color: C.text3, marginTop: 6 }}>운영자 계정으로 로그인하면 방문·유입·전환 지표를 볼 수 있어요.</div>
      </div>
    );
  }

  const d = data;
  const today = d?.days?.[d.days.length - 1];
  const yest = d?.days?.[d.days.length - 2];
  const devTotal = (d?.totals?.m || 0) + (d?.totals?.d || 0);
  const mPct = pct(d?.totals?.m || 0, devTotal);
  const usersSrc = d?.users?.source;
  const usersApprox = usersSrc === "kv-fallback";
  const newUv = d?.totals?.newUv || 0;
  const returningUv = Math.max(0, (d?.totals?.uvSum || 0) - newUv);

  const dchg = (a, b) => {
    if (b == null || b === 0) return null;
    const v = Math.round(((a - b) / b) * 100);
    return v;
  };
  const pvChg = today && yest ? dchg(today.pv, yest.pv) : null;
  const uvChg = today && yest ? dchg(today.uv, yest.uv) : null;
  const ChgBadge = ({ v }) => v == null ? null : (
    <span style={{ fontSize: 11, fontWeight: 700, color: v >= 0 ? C.green : C.red }}> {v >= 0 ? "▲" : "▼"}{Math.abs(v)}%</span>
  );

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto", padding: 16 }}>
      {/* 헤더 */}
      <div style={{
        background: `linear-gradient(135deg, ${C.blueBg} 0%, ${C.card} 100%)`,
        borderRadius: RADIUS["2xl"], padding: isMobile ? 18 : 24, marginBottom: 16,
        display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10,
      }}>
        <div>
          <div style={{ fontSize: isMobile ? FONT.xl : FONT["2xl"], fontWeight: 900, color: C.text1, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            📊 마케팅 대시보드
            {d && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 700, color: C.green, background: `${C.green}15`, padding: "3px 10px", borderRadius: 999 }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: C.green, animation: "z-pulse 1.4s ease-in-out infinite" }} />
                실시간 {d.realtimeActive || 0}명
              </span>
            )}
          </div>
          <div style={{ fontSize: FONT.xs, color: C.text3, marginTop: 4 }}>
            자체 수집(무쿠키·익명) · {d?.generatedAt ? new Date(d.generatedAt).toLocaleTimeString("ko-KR") + " 기준 · 30초 자동갱신" : ""}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {[7, 14, 30].map(n => (
            <button key={n} onClick={() => setDays(n)} style={{
              padding: "8px 14px", borderRadius: 10, fontSize: FONT.sm, fontWeight: 700, minHeight: 36,
              background: days === n ? C.blue : C.card2, color: days === n ? "#fff" : C.text3,
              border: `1px solid ${days === n ? C.blue : C.border}`, cursor: "pointer",
            }}>{n}일</button>
          ))}
        </div>
      </div>

      {loading && !d ? <LoadingBlock rows={5} height={100} label="지표 불러오는 중…" /> : !d ? (
        <div style={{ textAlign: "center", padding: 40, color: C.text3 }}>데이터를 불러오지 못했어요</div>
      ) : (
        <>
          {/* KPI: 가입수 강조 + 핵심 4종 */}
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(5, 1fr)", gap: 10, marginBottom: 14 }}>
            <div style={{ background: `linear-gradient(135deg, ${C.purple}1A, ${C.card})`, border: `1px solid ${C.purple}40`, borderRadius: RADIUS.lg, padding: 14, gridColumn: isMobile ? "span 2" : "span 1" }}>
              <div className="z-num" style={{ fontSize: isMobile ? 24 : 26, fontWeight: 900, color: C.purple, fontVariantNumeric: "tabular-nums", lineHeight: 1.1 }}>
                {d.users?.total != null ? fmtN(d.users.total) : "—"}
              </div>
              <div style={{ fontSize: FONT.xs, color: C.text2, marginTop: 2, fontWeight: 700 }}>
                {usersApprox ? "가입 유저 (추적 이후 신규)" : "총 가입 유저"}
              </div>
              <div style={{ fontSize: 11, color: C.text3, marginTop: 1 }}>
                오늘 +{d.users?.today || 0} · 7일 +{d.users?.last7 || 0}
                {usersApprox && " · 근사치"}
                {usersSrc === "supabase-error" && " · 키 오류"}
              </div>
            </div>
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, padding: 14 }}>
              <div className="z-num" style={{ fontSize: isMobile ? 20 : 24, fontWeight: 900, color: C.blue, fontVariantNumeric: "tabular-nums", lineHeight: 1.15 }}>{fmtN(today?.pv)}<ChgBadge v={pvChg} /></div>
              <div style={{ fontSize: FONT.xs, color: C.text3, marginTop: 2 }}>오늘 페이지뷰</div>
            </div>
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, padding: 14 }}>
              <div className="z-num" style={{ fontSize: isMobile ? 20 : 24, fontWeight: 900, color: C.green, fontVariantNumeric: "tabular-nums", lineHeight: 1.15 }}>{fmtN(today?.uv)}<ChgBadge v={uvChg} /></div>
              <div style={{ fontSize: FONT.xs, color: C.text3, marginTop: 2 }}>오늘 방문자</div>
            </div>
            <KpiCard C={C} isMobile={isMobile} label="오늘 신규방문" value={fmtN(today?.newUv)} sub={`세션 ${fmtN(today?.sessions)}`} />
            <KpiCard C={C} isMobile={isMobile} label={`${d.rangeDays}일 페이지뷰`} value={fmtN(d.totals?.pv)} sub={`모바일 ${mPct}%`} color={C.text1} />
          </div>

          {/* 방문 추이 */}
          <Card C={C} title="방문 추이" sub={`페이지뷰(영역)·방문자(선) — 최근 ${d.rangeDays}일`} style={{ marginBottom: 12 }}>
            <TrendChart C={C} days={d.days} isMobile={isMobile} />
          </Card>

          {/* 퍼널 + 도넛 3종 */}
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <Card C={C} title="전환 퍼널" sub="방문 → 가입 → 봇 활성 → 실거래">
              <Funnel C={C} steps={d.funnel || []} />
            </Card>
            <Card C={C} title="신규 vs 재방문" sub={`기간 고유 방문자 ${fmtN(d.totals?.uvSum)}명 (일별 합)`}>
              <Donut C={C} colors={[C.blue, C.purple]} data={[{ k: "신규", v: newUv }, { k: "재방문", v: returningUv }]} />
            </Card>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <Card C={C} title="디바이스">
              <Donut C={C} colors={[C.green, C.blue]} data={[{ k: "모바일", v: d.totals?.m || 0 }, { k: "데스크톱", v: d.totals?.d || 0 }]} />
            </Card>
            <Card C={C} title="유입 채널" sub="외부 도메인 (내부 이동 제외)">
              {(d.refs && d.refs.length) ? <Donut C={C} colors={[C.purple, C.blue, C.green, C.yellow, C.red, C.text3]} data={d.refs.slice(0, 6)} /> : <div style={{ fontSize: FONT.sm, color: C.text3, padding: "20px 0", textAlign: "center" }}>외부 유입 수집 중 (직접 방문은 미집계)</div>}
            </Card>
          </div>

          {/* 일별 현황 표 */}
          <Card C={C} title="일별 현황" sub="날짜별 방문·신규·세션·가입" style={{ marginBottom: 12, overflowX: "auto" }}>
            <div style={{ minWidth: isMobile ? 420 : "auto" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 1fr 1fr 1fr 1fr", gap: 4, fontSize: 11, color: C.text3, fontWeight: 700, padding: "0 4px 8px", borderBottom: `1px solid ${C.border}30` }}>
                <span>날짜</span><span style={{ textAlign: "right" }}>PV</span><span style={{ textAlign: "right" }}>방문자</span><span style={{ textAlign: "right" }}>신규</span><span style={{ textAlign: "right" }}>세션</span><span style={{ textAlign: "right" }}>가입</span>
              </div>
              {[...d.days].reverse().map((r, i) => (
                <div key={r.date} style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 1fr 1fr 1fr 1fr", gap: 4, fontSize: 13, padding: "7px 4px", borderBottom: i < d.days.length - 1 ? `1px solid ${C.border}14` : "none", background: i === 0 ? `${C.blue}08` : "transparent" }}>
                  <span style={{ color: C.text2, fontWeight: i === 0 ? 700 : 500 }}>{r.date.slice(5)}{i === 0 ? " ·오늘" : ""}</span>
                  <span className="z-num" style={{ textAlign: "right", color: C.text1, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{fmtN(r.pv)}</span>
                  <span className="z-num" style={{ textAlign: "right", color: C.green, fontVariantNumeric: "tabular-nums" }}>{fmtN(r.uv)}</span>
                  <span className="z-num" style={{ textAlign: "right", color: C.text3, fontVariantNumeric: "tabular-nums" }}>{fmtN(r.newUv)}</span>
                  <span className="z-num" style={{ textAlign: "right", color: C.text3, fontVariantNumeric: "tabular-nums" }}>{fmtN(r.sessions)}</span>
                  <span className="z-num" style={{ textAlign: "right", color: r.signups > 0 ? C.purple : C.text3, fontWeight: r.signups > 0 ? 700 : 400, fontVariantNumeric: "tabular-nums" }}>{fmtN(r.signups)}</span>
                </div>
              ))}
            </div>
          </Card>

          {/* 국가 / OS / 브라우저 */}
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3, 1fr)", gap: 12, marginBottom: 12 }}>
            <Card C={C} title="국가"><RankTable C={C} rows={d.geo} mapKey={(k) => COUNTRY_KO[k] || k} /></Card>
            <Card C={C} title="OS"><RankTable C={C} rows={d.os} /></Card>
            <Card C={C} title="브라우저"><RankTable C={C} rows={d.browser} /></Card>
          </div>

          {/* 인기 페이지 / 이벤트 */}
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <Card C={C} title="인기 페이지" sub="기간 내 페이지뷰 상위"><RankTable C={C} rows={d.topPaths} /></Card>
            <Card C={C} title="전환·행동 이벤트" sub="가입·로그인·봇 활성·CTA"><RankTable C={C} rows={d.events} /></Card>
          </div>

          {/* UTM */}
          {d.utm && d.utm.length > 0 && (
            <Card C={C} title="UTM 캠페인" sub="utm_source 기준" style={{ marginBottom: 12 }}>
              <RankTable C={C} rows={d.utm} />
            </Card>
          )}

          <div style={{ fontSize: FONT.xs, color: C.text3, textAlign: "center", padding: "4px 0 16px", lineHeight: 1.6 }}>
            익명 집계만 저장(쿠키·IP·개인정보 미수집) · 방문자=일별 고유 기준
            {usersApprox && <><br />가입 유저수는 추적 시작 이후 신규 가입 근사치입니다. 정확한 누적값은 Supabase service-role 키 설정 시 자동 전환됩니다.</>}
          </div>
        </>
      )}
    </div>
  );
}
