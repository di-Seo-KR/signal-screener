// GET /api/real-trading/period-returns?userId=xxx
// 기간별(오늘/이번주/이번달/누적) *순입출금(TRANSFER)* 합계를 반환.
//   왜 필요한가: 수익률 카드는 (현재자산 − 기간시작자산)/기간시작자산 으로 계산하는데,
//   equity 는 totalWalletBalance(미실현 제외) 라서, 입금이 들어오면 자산이 점프 → 입금이
//   "수익"으로 잡혀 수익률이 부풀려진다(예: $700 입금에 +340%). 실제로는
//   "자산변화 − 순입출금 = 순수 실현 매매손익" 이므로, 프런트가 이 netFlow 를 빼면 정확해진다.
//
//   TRANSFER income = 현물↔선물 지갑 이동. 입금(선물로 이동)=+, 출금(선물에서 빼냄)=−.
//   경계는 KST 기준(서버 UTC → +9h 보정)으로 카드의 일/주 reset 시점과 맞춘다.

import { loadUserCredentials, respondError } from "../_shared/binance-auth.js";
import { getIncome } from "../_shared/binance-client.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

// KST 자정(오늘 시작)의 UTC epoch ms
function kstDayStart(now) {
  const kst = now + KST_OFFSET_MS;
  return Math.floor(kst / DAY_MS) * DAY_MS - KST_OFFSET_MS;
}
// KST 이번 주 월요일 자정의 UTC epoch ms
function kstWeekStart(now) {
  const dayStart = kstDayStart(now);
  // dayStart 는 KST 자정 → 거기에 +9h 하면 KST 자정의 "UTC 달력상 요일"이 나온다.
  const dow = new Date(dayStart + KST_OFFSET_MS).getUTCDay(); // 0=일 … 6=토
  const sinceMon = (dow + 6) % 7; // 월=0
  return dayStart - sinceMon * DAY_MS;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "private, no-store"); // ★ 사용자 입출금·수익 데이터 — 캐시 원천 차단
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    const userId = req.query.userId;
    const { apiKey, apiSecret, testnet } = await loadUserCredentials(userId, req); // 인증 게이트

    const now = Date.now();
    const dayB = kstDayStart(now);
    const weekB = kstWeekStart(now);
    const monthB = now - 30 * DAY_MS;
    const allB = now - 40 * DAY_MS; // equityHistory 가 30일까지라 40일이면 '누적'을 충분히 덮음

    // 최근 ~41일 TRANSFER 내역만 (입출금은 드물어 1000건 한도 안에 충분히 들어옴)
    const startTime = now - 41 * DAY_MS;
    let rows = [];
    try {
      rows = await getIncome({ apiKey, apiSecret, incomeType: "TRANSFER", startTime, limit: 1000, testnet });
    } catch (e) {
      // 권한/네트워크 실패 시에도 수익률 카드는 그대로(보정만 생략) 돌아가게 — 빈 netFlow.
      return res.status(200).json({
        ok: true, available: false, reason: e?.message || String(e),
        netFlows: { day: 0, week: 0, month: 0, all: 0 }, transfers: [],
      });
    }

    const transfers = (Array.isArray(rows) ? rows : [])
      .map((r) => ({ time: Number(r.time) || 0, amount: Number(r.income) || 0, asset: r.asset || "USDT" }))
      .filter((t) => t.time > 0 && t.amount !== 0)
      .sort((a, b) => a.time - b.time);

    const sumSince = (b) => transfers.reduce((s, t) => (t.time >= b ? s + t.amount : s), 0);
    const round2 = (n) => Number(n.toFixed(2));

    return res.status(200).json({
      ok: true,
      available: true,
      netFlows: {
        day: round2(sumSince(dayB)),
        week: round2(sumSince(weekB)),
        month: round2(sumSince(monthB)),
        all: round2(sumSince(allB)),
      },
      transfers,
      boundaries: { day: dayB, week: weekB, month: monthB, all: allB },
      note: "netFlows = 각 기간 시작 이후 순입출금(입금+ / 출금−). 수익률 = (자산변화 − netFlow) / 기간시작자산. 입금이 수익으로 잡히는 왜곡을 제거.",
    });
  } catch (err) {
    return respondError(res, err);
  }
}
