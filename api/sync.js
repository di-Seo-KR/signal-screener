// Vercel Serverless — 포트폴리오 동기화 (기기간 동기화)
// 간단한 메모리 + edge-cache 방식
// POST /api/sync?pin=1234 body: { portfolio, settings }
// GET  /api/sync?pin=1234

// 실제 프로덕션에서는 Vercel KV 또는 외부 DB 사용 권장
// 여기서는 Vercel의 tmp 디렉토리를 사용하는 임시 솔루션
import { promises as fs } from "fs";
import path from "path";

const SYNC_DIR = "/tmp/di-sync";

async function ensureDir() {
  try { await fs.mkdir(SYNC_DIR, { recursive: true }); } catch {}
}

function sanitizePin(pin) {
  return (pin || "").replace(/[^a-zA-Z0-9]/g, "").slice(0, 20);
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const pin = sanitizePin(req.query.pin);
  if (!pin || pin.length < 4) {
    return res.status(400).json({ error: "PIN 4자리 이상 필요" });
  }

  await ensureDir();
  const filePath = path.join(SYNC_DIR, `${pin}.json`);

  if (req.method === "GET") {
    try {
      const data = await fs.readFile(filePath, "utf8");
      return res.status(200).json(JSON.parse(data));
    } catch {
      return res.status(404).json({ error: "데이터 없음", portfolio: [], settings: {} });
    }
  }

  if (req.method === "POST") {
    try {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      const payload = {
        portfolio: body.portfolio || [],
        settings: body.settings || {},
        updatedAt: new Date().toISOString(),
      };
      await fs.writeFile(filePath, JSON.stringify(payload), "utf8");
      return res.status(200).json({ ok: true, updatedAt: payload.updatedAt });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
