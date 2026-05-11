// ══════════════════════════════════════════════════════════════════
// Zepta — Bot Leaderboard 페이지
// ──────────────────────────────────────────────────────────────────
// /leaderboard 경로. 익명 닉네임으로 모든 사용자×봇 성과 ranking 표시.
//
// 필터: 봇 종류 (all/crypto/stock) / 기간 (7/30/90) / Top N
// 정렬: 수익률 / Sharpe / 승률
// 본인 봇: userId 의 SHA-256 prefix 와 일치 시 highlight
// opt-out 안내: 메타 텍스트로 표시 (실제 토글은 별도)
//
// API: GET /api/leaderboard
// 갱신: 폴링 없음 — cron 이 시간당 갱신. 새로고침 버튼 제공.
// ══════════════════════════════════════════════════════════════════
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useThemeTokens, FONT, RADIUS, pickFont } from "./ui/theme.jsx";
import { useBreakpoint } from "./ui/useBreakpoint.jsx";
import { useAuth } from "./AuthProvider.jsx";

// ── 한국어 라벨 ────────────────────────────────────────────────────
const BOT_KIND_LABEL = { all: "전체", crypto: "코인", stock: "주식" };
const SORT_LABEL = { return: "수익률순", sharpe: "안정성순", winrate: "승률순" };
const PERIOD_LABEL = { 7: "최근 7일", 30: "최근 30일", 90: "최근 90일" };
const LIMIT_LABEL = { 10: "Top 10", 50: "Top 50", 100: "Top 100" };

const BOT_NAME_KO = {
  "btc-alpha":        "BTC 알파",
  "highcap-momentum": "대형코인 모멘텀",
  "defi-infra":       "DeFi 인프라",
  "meme-trend":       "밈코인 트렌드",
  "l2-emerging":      "L2 신흥",
  "crypto-diversity": "크립토 분산",
  "crypto-swing":     "크립토 스윙",
  "stable-quant":     "안정형 퀀트",
  "balanced-quant":   "균형형 퀀트",
  "aggressive-quant": "공격형 퀀트",
  "trend-follow":     "추세 추종",
  "mean-reversion":   "평균 회귀",
  "ensemble-signal":  "앙상블 시그널",
};

// ── 헬퍼 ──────────────────────────────────────────────────────────
const fmtPct = (v, d = 1) => (v == null || !isFinite(v)) ? "—" : `${Number(v) >= 0 ? "+" : ""}${Number(v).toFixed(d)}%`;
const fmtNum = (v, d = 2) => (v == null || !isFinite(v)) ? "—" : Number(v).toFixed(d);
const fmtAgo = (iso) => {
  if (!iso) return "—";
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 60000) return "방금";
  if (ms < 3600000) return `${Math.floor(ms / 60000)}분 전`;
  if (ms < 86400000) return `${Math.floor(ms / 3600000)}시간 전`;
  return `${Math.floor(ms / 86400000)}일 전`;
};

// 브라우저 환경에서 SHA-256 prefix(8 hex) 계산. SubtleCrypto 미지원 fallback 포함.
async function userHash8(userId) {
  if (!userId) return "";
  try {
    if (typeof window !== "undefined" && window.crypto?.subtle) {
      const enc = new TextEncoder().encode(String(userId));
      const buf = await window.crypto.subtle.digest("SHA-256", enc);
      const hex = Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
      return hex.slice(0, 8);
    }
  } catch {}
  return "";
}

// ── UI primitives (AlphaLab 패턴과 동일) ───────────────────────────
function Card({ children, style, ...rest }) {
  const C = useThemeTokens();
  return (
    <div
      style={{
        background: C.card, border: `1px solid ${C.border}`,
        borderRadius: RADIUS.lg, padding: 16,
        boxShadow: C.cardShadow, ...style,
      }}
      {...rest}
    >{children}</div>
  );
}

function Pill({ active, children, onClick, color }) {
  const C = useThemeTokens();
  const { isMobile } = useBreakpoint();
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: isMobile ? "10px 14px" : "6px 12px",
        minHeight: isMobile ? 44 : undefined,
        borderRadius: RADIUS.full,
        border: `1px solid ${active ? (color || C.blue) : C.border}`,
        background: active ? (color || C.blue) : "transparent",
        color: active ? "#fff" : C.text2,
        fontSize: isMobile ? FONT.sm : FONT.xs,
        fontWeight: 700, cursor: "pointer",
        transition: "all 120ms",
        whiteSpace: "nowrap",
        scrollSnapAlign: "start",
        flexShrink: 0,
      }}
    >{children}</button>
  );
}

// 모바일 chip row — 라벨 + 가로 스크롤
function ChipRow({ label, C, children }) {
  return (
    <div>
      <div style={{ fontSize: FONT.xs, color: C.text3, fontWeight: 700, marginBottom: 6 }}>{label}</div>
      <div style={{
        display: "flex", gap: 8, overflowX: "auto",
        flexWrap: "nowrap", WebkitOverflowScrolling: "touch",
        scrollSnapType: "x mandatory", scrollbarWidth: "none",
        paddingBottom: 2,
      }}>
        {children}
      </div>
    </div>
  );
}

function Stat({ label, value, sub, color }) {
  const C = useThemeTokens();
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: FONT.xs, color: C.text3 }}>{label}</div>
      <div style={{ fontSize: FONT.xl, fontWeight: 700, color: color || C.text1, marginTop: 2 }}>{value}</div>
      {sub && <div style={{ fontSize: FONT.xs, color: C.text3, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

// ── 메인 ──────────────────────────────────────────────────────────
export default function BotLeaderboard({ onNavigate } = {}) {
  const C = useThemeTokens();
  const { isMobile } = useBreakpoint();
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [myHash, setMyHash] = useState("");

  // 필터 상태
  const [botKind, setBotKind] = useState("all");
  const [period, setPeriod] = useState(30);
  const [sort, setSort] = useState("return");
  const [limit, setLimit] = useState(50);

  // 본인 hash 계산
  useEffect(() => {
    let alive = true;
    (async () => {
      const h = await userHash8(user?.id);
      if (alive) setMyHash(h);
    })();
    return () => { alive = false; };
  }, [user?.id]);

  // fetch
  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const params = new URLSearchParams({
        type: "overall",
        botKind, sort, period: String(period), limit: String(limit),
      });
      const res = await fetch(`/api/leaderboard?${params.toString()}`);
      const json = await res.json();
      setData(json);
    } catch (e) {
      setErr(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [botKind, sort, period, limit]);

  useEffect(() => { load(); }, [load]);

  const entries = data?.entries || [];
  const total = data?.total || 0;
  const userCount = data?.userCount || 0;
  const generatedAt = data?.generatedAt;
  const empty = !!data?.empty || (entries.length === 0 && !loading && !err);

  // 본인 ranking (전체 ranking 에서 검색)
  const myEntry = useMemo(() => {
    if (!myHash) return null;
    return entries.find((e) => e.userHash === myHash) || null;
  }, [entries, myHash]);

  // ── 렌더 ────────────────────────────────────────────────────────
  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "16px", display: "flex", flexDirection: "column", gap: 12 }}>
      {/* 헤더 */}
      <div>
        <h1 style={{ fontSize: FONT["2xl"], fontWeight: 800, color: C.text1, margin: 0 }}>
          봇 리더보드
        </h1>
        <p style={{ fontSize: FONT.sm, color: C.text3, margin: "6px 0 0 0" }}>
          모든 사용자의 봇 성과를 익명으로 보여드려요. 본인 봇은 자동으로 강조됩니다.
        </p>
      </div>

      {/* opt-out 안내 */}
      <Card style={{ background: C.blueBg, border: `1px solid ${C.blueL}40` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
          <div style={{ fontSize: FONT.xs, color: C.text2, lineHeight: 1.6 }}>
            <strong style={{ color: C.text1 }}>익명 공개 안내.</strong>{" "}
            사용자 식별 정보는 SHA-256 해시 8자로만 표현되며, 닉네임은 자동 생성됩니다.{" "}
            리더보드에 포함되지 않으려면 <strong>설정 → 개인정보 → 리더보드 공개 끄기</strong>{" "}
            (별도 토글 준비 중)
          </div>
          <button
            onClick={load}
            disabled={loading}
            style={{
              padding: isMobile ? "10px 16px" : "6px 12px",
              minHeight: 44,
              borderRadius: RADIUS.sm,
              background: C.card, border: `1px solid ${C.border}`,
              color: C.text2,
              fontSize: pickFont("button", isMobile) ?? FONT.xs,
              fontWeight: 700, cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >{loading ? "갱신 중…" : "새로고침"}</button>
        </div>
      </Card>

      {/* 본인 봇 highlight */}
      {myEntry && (
        <Card style={{ borderColor: C.blue, borderWidth: 2 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: FONT.xs, color: C.blueL, fontWeight: 700, marginBottom: 4 }}>내 봇</div>
              <div style={{ fontSize: FONT.lg, fontWeight: 800, color: C.text1 }}>
                {myEntry.nick} · {BOT_NAME_KO[myEntry.botId] || myEntry.botId}
              </div>
              <div style={{ fontSize: FONT.xs, color: C.text3, marginTop: 2 }}>
                {entries.findIndex((e) => e === myEntry) + 1}위 / {total}명
              </div>
            </div>
            <div style={{ display: "flex", gap: 16 }}>
              <Stat
                label="수익률"
                value={fmtPct(myEntry.returnPct, 1)}
                color={myEntry.returnPct >= 0 ? C.green : C.red}
              />
              <Stat label="안정성" value={fmtNum(myEntry.sharpe, 2)} />
              <Stat label="MDD" value={fmtPct(-Math.abs(myEntry.mdd), 1)} color={C.red} />
            </div>
          </div>
        </Card>
      )}

      {/* 요약 통계 */}
      <Card>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
          <Stat label="등록된 봇" value={total ? `${total}개` : "—"} sub="익명 기준 entry 수" />
          <Stat label="참여 사용자" value={userCount ? `${userCount}명` : "—"} sub="해시 기준 추정" />
          <Stat label="기간" value={PERIOD_LABEL[period]} sub={period !== 30 ? "* 현재 30일 데이터만 적재" : ""} />
          <Stat label="갱신" value={fmtAgo(generatedAt)} sub="매시간 자동 집계" />
        </div>
      </Card>

      {/* 필터 컨트롤 — 모바일: 가로 스크롤 chip / 데스크탑: wrap */}
      <Card>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {isMobile ? (
            <>
              <ChipRow label="봇 종류" C={C}>
                {Object.entries(BOT_KIND_LABEL).map(([k, label]) => (
                  <Pill key={k} active={botKind === k} onClick={() => setBotKind(k)}>{label}</Pill>
                ))}
              </ChipRow>
              <ChipRow label="정렬" C={C}>
                {Object.entries(SORT_LABEL).map(([k, label]) => (
                  <Pill key={k} active={sort === k} onClick={() => setSort(k)}>{label}</Pill>
                ))}
              </ChipRow>
              <ChipRow label="기간" C={C}>
                {[7, 30, 90].map((p) => (
                  <Pill key={p} active={period === p} onClick={() => setPeriod(p)}>{PERIOD_LABEL[p]}</Pill>
                ))}
              </ChipRow>
              <ChipRow label="표시 (Top N)" C={C}>
                {[10, 50, 100].map((n) => (
                  <Pill key={n} active={limit === n} onClick={() => setLimit(n)}>{LIMIT_LABEL[n]}</Pill>
                ))}
              </ChipRow>
            </>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: FONT.xs, color: C.text3, fontWeight: 700, minWidth: 64 }}>봇 종류</span>
                {Object.entries(BOT_KIND_LABEL).map(([k, label]) => (
                  <Pill key={k} active={botKind === k} onClick={() => setBotKind(k)}>{label}</Pill>
                ))}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: FONT.xs, color: C.text3, fontWeight: 700, minWidth: 64 }}>정렬</span>
                {Object.entries(SORT_LABEL).map(([k, label]) => (
                  <Pill key={k} active={sort === k} onClick={() => setSort(k)}>{label}</Pill>
                ))}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: FONT.xs, color: C.text3, fontWeight: 700, minWidth: 64 }}>기간</span>
                {[7, 30, 90].map((p) => (
                  <Pill key={p} active={period === p} onClick={() => setPeriod(p)}>{PERIOD_LABEL[p]}</Pill>
                ))}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: FONT.xs, color: C.text3, fontWeight: 700, minWidth: 64 }}>표시</span>
                {[10, 50, 100].map((n) => (
                  <Pill key={n} active={limit === n} onClick={() => setLimit(n)}>{LIMIT_LABEL[n]}</Pill>
                ))}
              </div>
            </>
          )}
        </div>
      </Card>

      {/* 본문 — 테이블 */}
      <Card style={{ padding: 0 }}>
        {err && (
          <div style={{ padding: 24, color: C.red, fontSize: FONT.sm }}>
            데이터를 불러오지 못했습니다. ({err})
          </div>
        )}
        {!err && loading && entries.length === 0 && (
          <div style={{ padding: 32, textAlign: "center", color: C.text3, fontSize: FONT.sm }}>
            리더보드 불러오는 중…
          </div>
        )}
        {!err && !loading && empty && (
          <div style={{ padding: 32, textAlign: "center", color: C.text3, fontSize: FONT.sm }}>
            아직 표시할 데이터가 없어요. 봇이 활성화되고 매매 기록이 쌓이면 매시간 자동 집계됩니다.
          </div>
        )}
        {!err && entries.length > 0 && isMobile && (
          <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
            {entries.map((e, i) => {
              const isMe = myHash && e.userHash === myHash;
              const rank = i + 1;
              const rankBadge = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : `#${rank}`;
              return (
                <div
                  key={`m-${e.userHash}-${e.botId}-${i}`}
                  onClick={() => onNavigate && onNavigate(`reports/${e.botId}`)}
                  style={{
                    padding: 14,
                    background: isMe ? `${C.blueBg}` : C.card2,
                    border: `1px solid ${isMe ? C.blue : C.border}`,
                    borderLeft: isMe ? `5px solid ${C.blue}` : `5px solid ${rank <= 3 ? C.yellow : C.border2}`,
                    borderRadius: RADIUS.md,
                    cursor: "pointer",
                    minHeight: 88,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                    <span style={{
                      fontSize: 18, fontWeight: 800,
                      color: rank <= 3 ? C.yellow : C.text2,
                      minWidth: 36,
                    }}>{rankBadge}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: 15, fontWeight: 800,
                        color: isMe ? C.blueL : C.text1,
                        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                      }}>
                        {e.nick}{isMe && <span style={{ color: C.blueL, marginLeft: 6, fontSize: 12 }}>(나)</span>}
                      </div>
                      <div style={{ fontSize: 12, color: C.text3 }}>
                        {BOT_NAME_KO[e.botId] || e.botId} · {e.botKind === "crypto" ? "코인" : e.botKind === "stock" ? "주식" : ""}
                      </div>
                    </div>
                  </div>
                  <div style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr 1fr",
                    gap: 8,
                  }}>
                    <div>
                      <div style={{ fontSize: 11, color: C.text3 }}>수익률</div>
                      <div style={{
                        fontSize: 15, fontWeight: 800,
                        color: e.returnPct >= 0 ? C.green : C.red,
                      }}>{fmtPct(e.returnPct, 1)}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 11, color: C.text3 }}>안정성</div>
                      <div style={{
                        fontSize: 15, fontWeight: 800,
                        color: e.sharpe >= 1.5 ? C.green : e.sharpe <= 0 ? C.red : C.text1,
                      }}>{fmtNum(e.sharpe)}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 11, color: C.text3 }}>MDD</div>
                      <div style={{ fontSize: 15, fontWeight: 800, color: C.red }}>
                        {fmtPct(-Math.abs(e.mdd), 0)}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {!err && entries.length > 0 && !isMobile && (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
              <thead>
                <tr style={{ background: C.card2 }}>
                  <th style={thStyle(C)}>순위</th>
                  <th style={thStyle(C)}>닉네임</th>
                  <th style={thStyle(C)}>봇</th>
                  <th style={{ ...thStyle(C), textAlign: "right" }}>수익률</th>
                  <th style={{ ...thStyle(C), textAlign: "right" }}>안정성</th>
                  <th style={{ ...thStyle(C), textAlign: "right" }}>MDD</th>
                  <th style={{ ...thStyle(C), textAlign: "right" }}>거래수</th>
                  <th style={{ ...thStyle(C), textAlign: "right" }}>승률</th>
                  <th style={{ ...thStyle(C), textAlign: "right" }}>상세</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e, i) => {
                  const isMe = myHash && e.userHash === myHash;
                  const rank = i + 1;
                  const rankBadge = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : `${rank}`;
                  return (
                    <tr
                      key={`${e.userHash}-${e.botId}-${i}`}
                      style={{
                        background: isMe ? `${C.blueBg}` : "transparent",
                        borderLeft: isMe ? `3px solid ${C.blue}` : "3px solid transparent",
                      }}
                    >
                      <td style={tdStyle(C)}>
                        <span style={{ fontSize: FONT.sm, fontWeight: 700, color: rank <= 3 ? C.yellow : C.text2 }}>
                          {rankBadge}
                        </span>
                      </td>
                      <td style={tdStyle(C)}>
                        <div style={{ fontWeight: 700, color: isMe ? C.blueL : C.text1, fontSize: FONT.sm }}>
                          {e.nick}{isMe && <span style={{ color: C.blueL, marginLeft: 6, fontSize: FONT.xs }}>(나)</span>}
                        </div>
                        <div style={{ fontSize: FONT.xs, color: C.text3 }}>{e.userHash}</div>
                      </td>
                      <td style={tdStyle(C)}>
                        <div style={{ fontWeight: 600, color: C.text1, fontSize: FONT.sm }}>{BOT_NAME_KO[e.botId] || e.botId}</div>
                        <div style={{ fontSize: FONT.xs, color: C.text3 }}>
                          {e.botKind === "crypto" ? "코인" : e.botKind === "stock" ? "주식" : ""} · {e.botFamily}
                        </div>
                      </td>
                      <td style={{ ...tdStyle(C), textAlign: "right", color: e.returnPct >= 0 ? C.green : C.red, fontWeight: 800 }}>
                        {fmtPct(e.returnPct, 2)}
                      </td>
                      <td style={{ ...tdStyle(C), textAlign: "right", color: e.sharpe >= 1.5 ? C.green : e.sharpe <= 0 ? C.red : C.text1 }}>
                        {fmtNum(e.sharpe, 2)}
                      </td>
                      <td style={{ ...tdStyle(C), textAlign: "right", color: C.red }}>{fmtPct(-Math.abs(e.mdd), 1)}</td>
                      <td style={{ ...tdStyle(C), textAlign: "right" }}>{e.tradeCount.toLocaleString()}</td>
                      <td style={{ ...tdStyle(C), textAlign: "right" }}>{fmtNum(e.winRate, 1)}%</td>
                      <td style={{ ...tdStyle(C), textAlign: "right" }}>
                        <a
                          href={`/reports/${e.botId}`}
                          onClick={(ev) => {
                            // SPA 라우팅 — App.jsx 가 popstate 로 처리
                            if (onNavigate) {
                              ev.preventDefault();
                              onNavigate(`reports/${e.botId}`);
                            }
                          }}
                          style={{
                            fontSize: FONT.xs, color: C.blueL,
                            textDecoration: "none", fontWeight: 700,
                          }}
                        >리포트 →</a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* 푸터 안내 */}
      <div style={{ fontSize: FONT.xs, color: C.text3, lineHeight: 1.6, padding: "8px 4px" }}>
        ※ 안정성 (Sharpe) 은 수익률을 변동성으로 나눈 값입니다. 1.0 이상이면 양호,{" "}
        2.0 이상이면 매우 우수해요. MDD 는 고점 대비 최대 낙폭을 의미합니다.{" "}
        리더보드는 매시간 15분에 자동 갱신되며, 본인 계정으로 로그인하면 본인 봇이 자동 강조됩니다.
      </div>
    </div>
  );
}

// table 스타일 헬퍼
function thStyle(C) {
  return {
    textAlign: "left", padding: "10px 12px",
    fontSize: FONT.xs, color: C.text3, fontWeight: 700,
    borderBottom: `1px solid ${C.border}`,
    whiteSpace: "nowrap",
  };
}
function tdStyle(C) {
  return {
    padding: "12px",
    fontSize: FONT.sm, color: C.text1,
    borderBottom: `1px solid ${C.border}40`,
    whiteSpace: "nowrap",
  };
}
