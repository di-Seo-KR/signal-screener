// api/strategy-snapshot.js
//
// 매일 실행되는 전략/봇 아카이빙 cron.
// 책임:
//  - 현재 활성 bot 들의 `di:bot:<id>:perf` + `di:bot:<id>:snapshot` 를
//    하루짜리 스냅샷(`di:archive:bots:YYYY-MM-DD`) 으로 append-only 저장
//  - quant-research 에서 남긴 최신 결과가 있으면 `di:archive:quant:YYYY-MM-DD` 로 저장
//
// 이 cron 이 있어야 5일 rolling window 가 지나도 장기 성과를 분석할 수 있다.
// 이게 돌기 시작해야 Phase 2 전략 선택에 근거 데이터가 쌓인다.

import { archiveDailyBotSnapshots, archiveQuantResearch } from "./_shared/strategy-archive.js";

export const config = { maxDuration: 60 };

async function getKv() {
  return (await import("@vercel/kv")).kv;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  try {
    const kv = await getKv();

    // 1) 활성 bot 목록 수집
    const activeBots = (await kv.get("di:active-bots")) || [];
    const ids = activeBots
      .map((b) => b?.id || b?.botId)
      .filter(Boolean);

    const botResult = await archiveDailyBotSnapshots(ids);

    // 2) quant-research 최신 payload 는 별도 키에 저장돼 있으면 archive 로 복사.
    //    (quant-research.js 는 현재 Telegram 에만 전송. 후속 PR 에서 kv.set(`di:quant:latest`, payload) 추가 권장)
    let quantResult = null;
    const latestQuant = await kv.get("di:quant:latest");
    if (latestQuant) {
      quantResult = await archiveQuantResearch(latestQuant);
    }

    return res.status(200).json({
      ok: true,
      bots: botResult,
      quant: quantResult,
    });
  } catch (err) {
    console.error("[strategy-snapshot]", err);
    return res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
}
