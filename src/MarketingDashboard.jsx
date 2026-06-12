// ══════════════════════════════════════════════════════════════════
// Zepta — 마케팅 대시보드 (/marketing, 오너 전용)
// ──────────────────────────────────────────────────────────────────
// 자체 퍼스트파티 애널리틱스(GA 대체, 2026-06-12 대표 지시).
// 데이터: /api/marketing-stats (오너 uid 게이트) ← /api/track 일별 KV 집계.
//
// 구성: 기간 선택(7/14/30) · 핵심 KPI 카드 · PV/UV 추이 바 · 인기 페이지 ·
//       유입 출처 · UTM 캠페인 · 디바이스 비율 · 전환 이벤트
// ══════════════════════════════════════════════════════════════════
import { useEffect, useState, useCallback } from "react";
import { useThemeTokens, FONT, RADIUS } from "./ui/theme.jsx";
import { useBreakpoint } from "./ui/useBreakpoint.jsx";
import { LoadingBlock } from "./ui/primitives.jsx";
import { useAuth } from "./AuthProvider.jsx";

const fmtN = (v) => (v == null ? "—" : Number(v).toLocaleString());

function Card({ C, title, sub, children, style }) {
  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`, borderRadius: RADIUS.xl,
      padding: 16, ...style,
    }}>
      {title && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: FONT.base, fontWeight: 800, color: C.text1 }}>{title}</div>
          {sub && <div style={{ fontSize: FONT.xs, color: C.text3, marginTop: 2 }}>{sub}</div>}
        </div>
      )}
      {children}
    </div>
  );
}

function RankTable({ C, rows, unit = "회", emptyText = "데이터 수집 중…" }) {
  if (!rows || rows.length === 0) {
    return <div style={{ padding: "18px 0", textAlign: "center", color: C.text3, fontSize: FONT.sm }}>{emptyText}</div>;
  }
  const max = Math.max(...rows.map(r => r.v), 1);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {rows.map((r) => (
        <div key={r.k} style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: FONT.sm, color: C.text1, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.k}</div>
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
      if (j?.ok) { setData(j); setErr(null); }
      else setErr(j?.error || "load");
    } catch { setErr("load"); }
    finally { setLoading(false); }
  }, [user, days]);

  useEffect(() => { load(); }, [load]);

  if (err === "login" || err === "forbidden") {
    return (
      <div style={{ maxWidth: 720, margin: "0 auto", padding: 24, textAlign: "center" }}>
        <div style={{ fontSize: 40, margin: "40px 0 12px" }}>🔒</div>
        <div style={{ fontSize: FONT.lg, fontWeight: 800, color: C.text1 }}>마케팅 대시보드는 운영자 전용입니다</div>
        <div style={{ fontSize: FONT.sm, color: C.text3, marginTop: 6 }}>운영자 계정으로 로그인하면 방문·유입·전환 지표를 볼 수 있어요.</div>
      </div>
    );
  }

  const today = data?.days?.[data.days.length - 1];
  const maxPv = Math.max(...(data?.days || []).map(d => d.pv), 1);
  const devTotal = (data?.totals?.m || 0) + (data?.totals?.d || 0);
  const mPct = devTotal ? Math.round((data.totals.m / devTotal) * 100) : 0;

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto", padding: 16 }}>
      {/* 헤더 */}
      <div style={{
        background: `linear-gradient(135deg, ${C.blueBg} 0%, ${C.card} 100%)`,
        borderRadius: RADIUS["2xl"], padding: isMobile ? 18 : 24, marginBottom: 16,
        display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10,
      }}>
        <div>
          <div style={{ fontSize: isMobile ? FONT.xl : FONT["2xl"], fontWeight: 900, color: C.text1 }}>📊 마케팅 대시보드</div>
          <div style={{ fontSize: FONT.xs, color: C.text3, marginTop: 4 }}>
            자체 수집(무쿠키·익명) · 90일 보관 · {data?.generatedAt ? new Date(data.generatedAt).toLocaleTimeString("ko-KR") + " 기준" : ""}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {[7, 14, 30].map(d => (
            <button key={d} onClick={() => setDays(d)} style={{
              padding: "8px 14px", borderRadius: 10, fontSize: FONT.sm, fontWeight: 700, minHeight: 36,
              background: days === d ? C.blue : C.card2, color: days === d ? "#fff" : C.text3,
              border: `1px solid ${days === d ? C.blue : C.border}`, cursor: "pointer",
            }}>{d}일</button>
          ))}
        </div>
      </div>

      {loading ? <LoadingBlock rows={4} height={110} label="지표 불러오는 중…" /> : !data ? (
        <div style={{ textAlign: "center", padding: 40, color: C.text3 }}>데이터를 불러오지 못했어요</div>
      ) : (
        <>
          {/* KPI 카드 */}
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(4, 1fr)", gap: 10, marginBottom: 12 }}>
            {[
              { l: "오늘 페이지뷰", v: today?.pv, c: C.blue },
              { l: "오늘 방문자", v: today?.uv, c: C.green },
              { l: `${data.rangeDays}일 페이지뷰`, v: data.totals.pv, c: C.text1 },
              { l: "모바일 비율", v: `${mPct}%`, c: C.purple, raw: true },
            ].map(k => (
              <div key={k.l} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, padding: 14, textAlign: "center" }}>
                <div className="z-num" style={{ fontSize: isMobile ? 20 : 24, fontWeight: 900, color: k.c, fontVariantNumeric: "tabular-nums" }}>{k.raw ? k.v : fmtN(k.v)}</div>
                <div style={{ fontSize: FONT.xs, color: C.text3, marginTop: 2 }}>{k.l}</div>
              </div>
            ))}
          </div>

          {/* PV/UV 추이 */}
          <Card C={C} title="방문 추이" sub={`일별 페이지뷰(막대) · 방문자(점) — 최근 ${data.rangeDays}일`} style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 120, padding: "4px 0" }}>
              {data.days.map(d => (
                <div key={d.date} title={`${d.date} · PV ${d.pv} · UV ${d.uv}`} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2, minWidth: 0 }}>
                  <div style={{ fontSize: 9, color: C.green, fontWeight: 700 }}>{d.uv > 0 ? d.uv : ""}</div>
                  <div style={{
                    width: "100%", maxWidth: 26, borderRadius: "4px 4px 0 0",
                    height: `${Math.max(2, (d.pv / maxPv) * 90)}px`,
                    background: d === today ? C.blue : `${C.blue}70`,
                  }} />
                </div>
              ))}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: C.text3 }}>
              <span>{data.days[0]?.date.slice(5)}</span>
              <span>{today?.date.slice(5)} (오늘)</span>
            </div>
          </Card>

          {/* 2열: 인기 페이지 / 유입 출처 */}
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <Card C={C} title="인기 페이지" sub="기간 내 페이지뷰 상위">
              <RankTable C={C} rows={data.topPaths} />
            </Card>
            <Card C={C} title="유입 출처" sub="외부 도메인 기준 (내부 이동 제외)">
              <RankTable C={C} rows={data.refs} emptyText="외부 유입 수집 중… (직접 방문은 direct)" />
            </Card>
          </div>

          {/* 2열: UTM / 전환 이벤트 */}
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <Card C={C} title="UTM 캠페인" sub="utm_source 기준">
              <RankTable C={C} rows={data.utm} emptyText="캠페인 유입 없음 — 링크에 ?utm_source= 를 붙여 추적" />
            </Card>
            <Card C={C} title="전환·행동 이벤트" sub="가입/로그인/봇 활성/CTA 클릭 등">
              <RankTable C={C} rows={data.events} />
            </Card>
          </div>

          <div style={{ fontSize: FONT.xs, color: C.text3, textAlign: "center", padding: "4px 0 16px" }}>
            익명 집계만 저장합니다(쿠키·IP·개인정보 미수집) · 방문자 수는 일별 고유 기준
          </div>
        </>
      )}
    </div>
  );
}
