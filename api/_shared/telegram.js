// ════════════════════════════════════════════════════════════════════
// Zepta 텔레그램 공용 발송 모듈
//
// 모든 cron / agent 가 이 모듈을 통해서만 텔레그램을 보내도록 통일.
// 메시지는 자동으로 "사용자 친화 포맷" 으로 정규화됩니다.
//
// 핵심 원칙:
//   1) 한 줄 요약은 평어 한국어로 — 전문 용어 직역 금지
//   2) 구조: 제목 → 무엇이 일어났나 → 그래서 뭐 → (선택) 행동 가이드
//   3) 이모지는 의미 단위로만 — 장식용 남발 금지
//   4) 날짜/시간은 KST 기준 한국 사용자 친숙한 형태
//   5) 브랜드는 "Zepta" 로 통일 (구버전 "DI금융" 자동 치환)
// ════════════════════════════════════════════════════════════════════

const TG_API = "https://api.telegram.org";

// 전문 용어 → 평어 사전 (확장 가능)
const TERM_DICT = [
  { re: /허스트\s*(레짐|지수)?\s*변화\s*[: ]?\s*([\d.]+)\s*[→>]\s*([\d.]+)\s*\(?(상승|하락)?\)?/gi,
    fn: (_, _2, a, b, dir) => {
      const av = Number(a), bv = Number(b);
      const trendNow = bv >= 0.55 ? "추세장" : bv <= 0.45 ? "역추세장" : "혼조";
      const arrow = bv > av ? "강해지는" : "약해지는";
      return `시장 흐름이 ${arrow} 중 (${trendNow} 성격)`;
    } },
  { re: /추세\s*탄생\s*[: ]?\s*ER\s*[\d.]+\s*[→>]\s*([\d.]+)/gi,
    fn: (_, b) => `새로운 추세 시작 — 추세 추종 전략에 유리한 환경 (효율 ${Number(b).toFixed(2)})` },
  { re: /추세\s*소멸\s*[: ]?\s*ER\s*[\d.]+\s*[→>]\s*([\d.]+)/gi,
    fn: (_, b) => `추세가 약해지고 있어요 — 박스권 전략으로 전환 고려 (효율 ${Number(b).toFixed(2)})` },
  { re: /변동성\s*폭발\s*[: ]?\s*ATR\s*비율\s*[\d.]+\s*[→>]\s*([\d.]+)\s*x?/gi,
    fn: (_, b) => `변동성 급격히 확대 (평소의 ${Number(b).toFixed(1)}배) — 손절 폭 넓히고 포지션 축소 권장` },
  { re: /스마트머니\s*포착\s*[: ]?\s*가격\s*([+-]?[\d.]+)%\s*보합\s*\+\s*거래량\s*([\d.]+)x?/gi,
    fn: (_, p, v) => `가격은 ${p}% 거의 그대로인데 거래량 ${Number(v).toFixed(1)}배 — 큰 손이 조용히 모으는 신호일 수 있음` },
  { re: /RSI\s*(\d+(?:\.\d+)?)\s*(?:—|-)\s*(과매수|과매도|중립)/gi,
    fn: (_, val, zone) => {
      const v = Number(val);
      if (zone === "과매수") return `과열 상태 (RSI ${v.toFixed(0)}) — 단기 조정 가능성 주의`;
      if (zone === "과매도") return `과매도 (RSI ${v.toFixed(0)}) — 반등 가능성, 무리한 매도 금물`;
      return `중립 (RSI ${v.toFixed(0)})`;
    } },
  { re: /MACD\s*다이버전스/gi, fn: () => "가격과 모멘텀이 어긋남 (다이버전스) — 추세 전환 가능성" },
  { re: /이평선\s*(데드|골든)\s*크로스/gi, fn: (_, k) => k === "골든" ? "단기 이동평균이 장기를 상향돌파 — 강세 전환 신호" : "단기가 장기를 하향돌파 — 약세 전환 신호" },
  { re: /DI금융/g, fn: () => "Zepta" },
];

// 사용자 친화 포맷팅
export function humanize(text) {
  if (!text) return text;
  let out = text;
  for (const { re, fn } of TERM_DICT) {
    out = out.replace(re, fn);
  }
  return out;
}

// KST 한국식 일시 문자열
export function fmtKST(date = new Date()) {
  const opts = { timeZone: "Asia/Seoul", year: "2-digit", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false };
  return new Intl.DateTimeFormat("ko-KR", opts).format(date).replace(/\. /g, "/").replace(/\.$/, "");
}

// 짧은 KST (오늘 같은 날이면 "HH:MM" 만)
export function fmtKSTShort(date = new Date()) {
  const today = new Date();
  const sameDay =
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate();
  if (sameDay) {
    return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
  }
  return fmtKST(date);
}

// 카드 형태 메시지 빌더
//   buildCard({ tag, title, lines, hint })
//   → 일관된 시각 패턴으로 텔레그램 카드 생성
export function buildCard({ tag = "📣", title, lines = [], hint, footer }) {
  const head = `${tag} <b>${escapeHtml(title)}</b>`;
  const body = lines.filter(Boolean).map((l) => `• ${escapeHtml(humanize(l))}`).join("\n");
  const tail = [
    hint ? `\n💡 <i>${escapeHtml(humanize(hint))}</i>` : "",
    footer ? `\n<code>${escapeHtml(footer)}</code>` : "",
  ].filter(Boolean).join("");
  return `${head}\n${body}${tail}`.trim();
}

// 여러 카드를 묶어 한 메시지로 전송
export function joinCards(cards) {
  return cards.filter(Boolean).join("\n━━━━━━━━━━\n");
}

// 텔레그램 HTML 안전 이스케이프
function escapeHtml(s) {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// 길이 제한 (텔레그램 4096자)
function clip(text, max = 3900) {
  if (!text) return text;
  if (text.length <= max) return text;
  return text.slice(0, max) + "\n...(이하 생략)";
}

// 가상매매(shadow/virtual portfolio) 채널 메시지 차단 가드.
// 사용자 요청(2026-05-03): "텔레그램은 실제매매 리포트 위주로, 가상매매는 끄고 직관적으로"
// btc-cron / stock-cron / portfolio-rebalance 등 가상매매 cron 의 sendCards 호출에
// channel: "virtual" 옵션을 붙이면 ZEPTA_TG_VIRTUAL_ENABLED!=="1" 일 때 무음.
// (실거래·시장알림·daily-standup 은 그대로 발송)
function isVirtualMuted() {
  return process.env.ZEPTA_TG_VIRTUAL_ENABLED !== "1";
}

// 단일 메시지 전송 — 모든 sender 가 이걸 거치게 권장
export async function sendTelegram({ text, parseMode = "HTML", token, chatId, channel } = {}) {
  if (channel === "virtual" && isVirtualMuted()) {
    return { ok: false, skipped: true, reason: "virtual channel muted" };
  }
  const TG_TOKEN = token || process.env.TELEGRAM_BOT_TOKEN;
  const TG_CHAT = chatId || process.env.TELEGRAM_CHAT_ID;
  if (!TG_TOKEN || !TG_CHAT) {
    console.warn("[telegram] BOT_TOKEN/CHAT_ID 미설정 — 발송 건너뜀");
    return { ok: false, skipped: true };
  }
  if (!text) return { ok: false, error: "empty text" };

  const body = {
    chat_id: TG_CHAT,
    text: clip(humanize(text)),
    parse_mode: parseMode,
    disable_web_page_preview: true,
  };

  try {
    const r = await fetch(`${TG_API}/bot${TG_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    if (!data.ok) {
      console.error("[telegram] send fail:", data.description);
      return { ok: false, error: data.description };
    }
    return { ok: true, message_id: data.result?.message_id };
  } catch (e) {
    console.error("[telegram] exception:", e.message);
    return { ok: false, error: e.message };
  }
}

// 여러 카드 묶어서 한 번에 전송
export async function sendCards(cards, opts = {}) {
  return sendTelegram({ text: joinCards(cards), ...opts });
}

export { isVirtualMuted };
