// ════════════════════════════════════════════════════════════════════
// Zepta — 발굴 워커 (Hetzner 전용 박스)  [P4, 2026-06-02]
// ────────────────────────────────────────────────────────────────────
// Vercel 서버리스의 300초 타임아웃을 벗어나 *연속·무제한* 발굴을 돌린다.
// Vercel cron 과 동일한 runDiscoveryCycle 로직을 재사용(분기 없음).
//
// 동작: 한 사이클 실행 → 결과 로그 → INTERVAL 만큼 쉬고 반복.
// 결과는 Vercel 과 동일한 Upstash KV(di:alpha:*)에 기록 → 웹 UI 자동 반영.
//
// 필수 env (Vercel 프로젝트 env 에서 복사):
//   KV_REST_API_URL, KV_REST_API_TOKEN          ← Upstash KV (필수)
// 선택 env:
//   BINANCE_PROXY_URL, BINANCE_PROXY_SECRET      ← klines 를 프록시 경유로 (없으면 바이낸스 public 직접)
//   DISCOVERY_SYMBOLS_PER_RUN  (기본 13 = 전 심볼)
//   DISCOVERY_BUDGET_MS        (기본 1200000 = 20분, 사실상 무제한)
//   DISCOVERY_INTERVAL_MS      (기본 300000 = 사이클 사이 5분 휴식)
//
// 실행: node worker/discovery-worker.mjs  (또는 Docker — worker/Dockerfile 참고)
// ════════════════════════════════════════════════════════════════════

import { runDiscoveryCycle } from "../api/agents/continuous-backtest.js";

const SYMBOLS_PER_RUN = parseInt(process.env.DISCOVERY_SYMBOLS_PER_RUN || "13", 10);
const BUDGET_MS       = parseInt(process.env.DISCOVERY_BUDGET_MS || "1200000", 10);
const INTERVAL_MS     = parseInt(process.env.DISCOVERY_INTERVAL_MS || "300000", 10);

function checkEnv() {
  const missing = [];
  if (!process.env.KV_REST_API_URL && !process.env.UPSTASH_REDIS_REST_URL) missing.push("KV_REST_API_URL");
  if (!process.env.KV_REST_API_TOKEN && !process.env.UPSTASH_REDIS_REST_TOKEN) missing.push("KV_REST_API_TOKEN");
  if (missing.length) {
    console.error(`[worker] FATAL — 필수 env 누락: ${missing.join(", ")}. Vercel 프로젝트 env 에서 복사하세요.`);
    process.exit(1);
  }
}

let running = true;
for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, () => { console.log(`[worker] ${sig} 수신 — 현재 사이클 후 종료`); running = false; });
}

async function loop() {
  checkEnv();
  console.log(`[worker] 발굴 워커 시작 — symbolsPerRun=${SYMBOLS_PER_RUN}, budget=${Math.round(BUDGET_MS/1000)}s, interval=${Math.round(INTERVAL_MS/1000)}s`);
  let cycle = 0;
  while (running) {
    cycle += 1;
    const t0 = Date.now();
    try {
      const r = await runDiscoveryCycle({ budgetMs: BUDGET_MS, symbolsPerRun: SYMBOLS_PER_RUN, dryRun: false });
      const inj = (r.injected || []).map((i) => i.family).join(",") || "0";
      console.log(`[worker] #${cycle} ${r.ok ? "OK" : "FAIL"} ${r.durationMs}ms — 후보 ${(r.newCandidates||[]).length}, 주입 ${(r.injected||[]).length}(${inj}), 정리 ${(r.revalidated?.cleared||[]).length}`);
      if (!r.ok) console.error(`[worker] #${cycle} error: ${r.error}`);
    } catch (e) {
      console.error(`[worker] #${cycle} 예외:`, e?.message || e);
    }
    if (!running) break;
    const wait = Math.max(5000, INTERVAL_MS - (Date.now() - t0));
    await new Promise((res) => setTimeout(res, wait));
  }
  console.log("[worker] 종료됨");
  process.exit(0);
}

loop();
