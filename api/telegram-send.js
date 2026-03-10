// Vercel Serverless — Telegram 메시지 전송 프록시
// POST /api/telegram-send
// Body: { "text": "...", "parse_mode": "HTML" | "Markdown" (optional) }
// Cowork VM에서 api.telegram.org 직접 접근이 차단되므로
// Vercel을 경유하여 텔레그램 봇 메시지를 전송합니다.

const BOT_TOKEN = "8749984490:AAHcYiqyxDQMZyAzhQTA21SzZP0j85I8h90";
const CHAT_ID = "5202880452";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only" });
  }

  const { text, parse_mode } = req.body || {};
  if (!text) return res.status(400).json({ error: "text required" });

  // Telegram 메시지 최대 4096자 — 초과 시 분할 전송
  const MAX_LEN = 4000;
  const chunks = [];
  if (text.length <= MAX_LEN) {
    chunks.push(text);
  } else {
    let remaining = text;
    while (remaining.length > 0) {
      if (remaining.length <= MAX_LEN) {
        chunks.push(remaining);
        break;
      }
      // 줄바꿈 기준으로 분할
      let cutIdx = remaining.lastIndexOf("\n", MAX_LEN);
      if (cutIdx < MAX_LEN * 0.5) cutIdx = MAX_LEN;
      chunks.push(remaining.slice(0, cutIdx));
      remaining = remaining.slice(cutIdx).trimStart();
    }
  }

  const results = [];
  for (const chunk of chunks) {
    try {
      const body = {
        chat_id: CHAT_ID,
        text: chunk,
      };
      if (parse_mode) body.parse_mode = parse_mode;

      const r = await fetch(
        `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(10000),
        }
      );
      const json = await r.json();
      results.push({ ok: json.ok, message_id: json.result?.message_id });
    } catch (err) {
      results.push({ ok: false, error: err.message });
    }
  }

  const allOk = results.every((r) => r.ok);
  return res.status(allOk ? 200 : 502).json({
    success: allOk,
    chunks: results.length,
    results,
  });
}
