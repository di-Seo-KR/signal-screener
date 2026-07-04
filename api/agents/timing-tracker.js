// ════════════════════════════════════════════════════════════════════
// 타점 신호 라이브 추적기 (일일 cron) — "신호가 적절한 위치인가"의 최종 심판
// ────────────────────────────────────────────────────────────────────
// 대표 의구심(2026-07-04) 대응: 과거 검증과 별개로, *배포된 규칙 그대로* 발화한
// 신호를 매일 기록하고 +24h/+48h 성과를 자동 채점해 누적 → 텔레그램 보고.
// 엣지가 죽으면 데이터가 먼저 말해주고, 그때 요소를 끄면 된다(재학습/킬스위치).
//
// KV:
//   di:timing:track  → [{id, sym, tf, dir, score, barTs, entry, e6, e12}] (최근 400)
//   di:timing:stats  → { "4h:long": {n, sum6, win6, sum12, win12}, ... }
// Cron: 30 20 * * * (KST 05:30 — 06:00 일일 스탠드업 직전)
// ════════════════════════════════════════════════════════════════════

import { getKlines } from "../_shared/binance-client.js";
import { computeTimingSignals } from "../_shared/timing-signals.js";
import { sendTelegram } from "../_shared/telegram.js";

async function getKv() { return (await import("@vercel/kv")).kv; }

export const config = { maxDuration: 120 };

const SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "AVAXUSDT", "LINKUSDT", "BNBUSDT", "DOGEUSDT", "ZECUSDT", "TAOUSDT", "SUIUSDT", "INJUSDT"];
const TFS = [
  { tf: "4h", limit: 140, minScore: 1.7, newWin: 7, barMs: 4 * 3600 * 1000 },  // 롱 진입(2요소) — 라이브 규칙 동일
  { tf: "1d", limit: 90, minScore: undefined, newWin: 2, barMs: 24 * 3600 * 1000 },
];
const TRACK_KEY = "di:timing:track";
const STATS_KEY = "di:timing:stats";

export default async function handler(req, res) {
  // CRON_SECRET 인증 (다른 에이전트와 동일 패턴)
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers?.authorization || "";
    const isCron = req.headers?.["x-vercel-cron"] != null;
    if (!isCron && auth !== `Bearer ${secret}` && req.query?.key !== secret) {
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }
  }

  const t0 = Date.now();
  try {
    const kv = await getKv();
    let track = (await kv.get(TRACK_KEY)) || [];
    if (!Array.isArray(track)) track = [];
    const stats = (await kv.get(STATS_KEY)) || {};
    const known = new Set(track.map((r) => r.id));
    let added = 0, matured = 0;

    for (const { tf, limit, minScore, newWin, barMs } of TFS) {
      for (const sym of SYMBOLS) {
        let kl;
        try { kl = await getKlines({ symbol: sym, interval: tf, limit }); }
        catch { continue; }
        const arr = { opens: [], highs: [], lows: [], closes: [], volumes: [], times: [] };
        for (const k of kl) { arr.opens.push(+k[1]); arr.highs.push(+k[2]); arr.lows.push(+k[3]); arr.closes.push(+k[4]); arr.volumes.push(+k[5]); arr.times.push(+k[0]); }
        for (const k of Object.keys(arr)) arr[k] = arr[k].slice(0, -1); // 진행봉 제거
        const n = arr.closes.length;
        if (n < 60) continue;

        // ① 신규 신호 기록 (어제 이후 발화분 — 라이브 표시 규칙 그대로)
        const { signals } = computeTimingSignals(arr, { tf, minScore });
        for (const s of signals) {
          if (s.i < n - newWin) continue; // 최근 발화만
          const id = `${sym}:${tf}:${s.dir}:${arr.times[s.i]}`;
          if (known.has(id)) continue;
          track.push({ id, sym, tf, dir: s.dir, score: s.score, barTs: arr.times[s.i], entry: arr.closes[s.i], e6: null, e12: null });
          known.add(id); added++;
        }

        // ② 성숙 신호 채점 (+6봉/+12봉 종가 — barTs 로 인덱스 매칭)
        for (const r of track) {
          if (r.sym !== sym || r.tf !== tf || (r.e6 != null && r.e12 != null)) continue;
          const idx = arr.times.indexOf(r.barTs);
          if (idx < 0) continue;
          const key = `${tf}:${r.dir > 0 ? "long" : "short"}`;
          if (!stats[key]) stats[key] = { n6: 0, sum6: 0, win6: 0, n12: 0, sum12: 0, win12: 0 };
          if (r.e6 == null && idx + 6 < n) {
            r.e6 = +(r.dir * ((arr.closes[idx + 6] - r.entry) / r.entry)).toFixed(6);
            stats[key].n6++; stats[key].sum6 += r.e6; if (r.e6 > 0) stats[key].win6++;
            matured++;
          }
          if (r.e12 == null && idx + 12 < n) {
            r.e12 = +(r.dir * ((arr.closes[idx + 12] - r.entry) / r.entry)).toFixed(6);
            stats[key].n12++; stats[key].sum12 += r.e12; if (r.e12 > 0) stats[key].win12++;
          }
        }
        await new Promise((r2) => setTimeout(r2, 100));
      }
    }

    track = track.slice(-400);
    await kv.set(TRACK_KEY, track);
    await kv.set(STATS_KEY, stats);

    // ③ 텔레그램 요약 (일일 스탠드업 직전)
    const fmt = (k) => {
      const s = stats[k];
      if (!s || !s.n6) return `${k}: 표본 없음`;
      const a6 = Math.round(s.sum6 / s.n6 * 1e4), w6 = Math.round(s.win6 / s.n6 * 100);
      const a12 = s.n12 ? Math.round(s.sum12 / s.n12 * 1e4) : 0, w12 = s.n12 ? Math.round(s.win12 / s.n12 * 100) : 0;
      return `${k}: +24h ${a6}bps/승률${w6}% (n${s.n6}) · +48h ${a12}bps/${w12}% (n${s.n12})`;
    };
    const lines = ["📐 타점 신호 라이브 추적 (배포 규칙 그대로 자동 채점)",
      `오늘 신규 ${added}건 · 채점 ${matured}건 · 추적 중 ${track.filter(r => r.e12 == null).length}건`,
      fmt("4h:long"), fmt("4h:short"), fmt("1d:long"),
      "→ 누적 엣지가 음전하면 해당 요소 재학습/비활성 판단"].join("\n");
    try { await sendTelegram({ text: lines }); } catch {}

    return res.status(200).json({ ok: true, added, matured, tracked: track.length, stats, ms: Date.now() - t0 });
  } catch (e) {
    return res.status(200).json({ ok: false, error: e?.message || String(e) });
  }
}
