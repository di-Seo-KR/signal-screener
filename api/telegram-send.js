// Vercel API — 텔레그램 메시지 발송 프록시
// POST /api/telegram-send { "text": "메시지" }
// 환경변수: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { text } = req.body || {};
  if (!text) return res.status(400).json({ error: "text required" });

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    return res.status(500).json({ error: "Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID" });
  }

  try {
    const tgRes = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
    const tgData = await tgRes.json();
    if (tgData.ok) {
      return res.status(200).json({ success: true, message_id: tgData.result?.message_id });
    } else {
      return res.status(200).json({ success: false, error: tgData.description });
    }
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
}
