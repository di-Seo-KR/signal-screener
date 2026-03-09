// Vercel Serverless — 포트폴리오 영구 동기화
// POST /api/sync?pin=1234 body: { portfolio, settings }
// GET  /api/sync?pin=1234
//
// 1순위: Vercel KV (Upstash Redis) — 영구 저장
// 2순위: /tmp 파일 — KV 미설정 시 임시 폴백
//
// Vercel KV 설정 방법:
//   Vercel Dashboard → Storage → Create Database → KV (Upstash)
//   환경변수 KV_REST_API_URL, KV_REST_API_TOKEN 자동 설정됨

let kv = null;
try {
  const kvModule = await import("@vercel/kv");
  kv = kvModule.kv;
} catch {
  // @vercel/kv 모듈이 없거나 env 미설정 → fallback
}

// ── /tmp 파일 폴백 ──
import { promises as fs } from "fs";
import path from "path";
const SYNC_DIR = "/tmp/di-sync";

async function ensureDir() {
  try { await fs.mkdir(SYNC_DIR, { recursive: true }); } catch {}
}

function sanitizePin(pin) {
  return (pin || "").replace(/[^a-zA-Z0-9]/g, "").slice(0, 20);
}

function kvKey(pin) {
  return `di-sync:${pin}`;
}

// ── KV 사용 가능 여부 체크 ──
function canUseKV() {
  return kv && process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN;
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

  const useKV = canUseKV();

  if (req.method === "GET") {
    try {
      // KV 우선
      if (useKV) {
        const data = await kv.get(kvKey(pin));
        if (data) return res.status(200).json(data);
        return res.status(404).json({ error: "데이터 없음", portfolio: [], settings: {} });
      }
      // /tmp 폴백
      await ensureDir();
      const filePath = path.join(SYNC_DIR, `${pin}.json`);
      const raw = await fs.readFile(filePath, "utf8");
      return res.status(200).json(JSON.parse(raw));
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

      if (useKV) {
        // KV에 저장 (TTL: 90일)
        await kv.set(kvKey(pin), payload, { ex: 90 * 24 * 60 * 60 });
      }

      // 항상 /tmp에도 저장 (같은 인스턴스 내 빠른 캐시)
      await ensureDir();
      const filePath = path.join(SYNC_DIR, `${pin}.json`);
      await fs.writeFile(filePath, JSON.stringify(payload), "utf8");

      return res.status(200).json({
        ok: true,
        updatedAt: payload.updatedAt,
        storage: useKV ? "permanent" : "temporary",
      });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
