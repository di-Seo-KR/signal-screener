#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════
// 회귀 테스트 — 경제 캘린더의 과거 오염 KV 자가치유 (api/econ-calendar.js)
// ────────────────────────────────────────────────────────────────────
// 배경: "미발표 지표가 발표 완료로 표시" 사고가 4번 재발했고, 그때마다
// di:econ:actuals 에 '직전 회차 수치(previous)'가 그 날의 발표치로 굳었습니다.
// 4번째 수정의 하드 가드는 '아직 발표 전' 키만 잡아서, 이미 굳은 과거 오염분은
// 영구히 남아 하류 크론(api/agents/econ-results.js)이 /econ/{date}-{slug}
// 영구 페이지로 계속 발행했습니다. 그 스윕이 실제로 도는지 고정합니다.
//
// 검증 시나리오 (실제 핸들러를 목 KV 위에서 종단 실행):
//   A. actual === previous 이고 살아 있는 소스가 재확인 못 함
//      → di:econ:actuals 에서 빠지고 di:econ:actuals:quarantine 으로 격리
//   B. 같은 키를 두 번째 요청에서 다시 격리하지 않음(무한 churn 방지)
//   C. actual !== previous 인 정상 키는 손대지 않음
//   D. 살아 있는 소스가 다른 값을 들고 있으면 격리가 아니라 실측으로 '교정'
//
// 외부 API 키가 없어야 결정적으로 돕니다(있으면 벤더가 값을 재확인해
// 시나리오 A 가 '교정'으로 갈 수 있습니다). 이 스크립트가 직접 비웁니다.
//
// 사용: node scripts/test-econ-kv-sweep.mjs
// ════════════════════════════════════════════════════════════════════
import http from "node:http";

// ── 외부 소스 차단 — 목 KV 만 보고 판정하도록 결정적 환경을 만듭니다 ──
for (const k of ["FINNHUB_API_KEY", "FMP_API_KEY", "FRED_API_KEY", "BLS_API_KEY"]) delete process.env[k];
const realFetch = globalThis.fetch;
let ffPayload = null; // 시나리오 D 에서만 ForexFactory 응답을 흉내 냅니다.
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.includes("127.0.0.1") || u.includes("localhost")) return realFetch(url, init);
  if (ffPayload && u.includes("ff_calendar_thisweek.json")) {
    return new Response(JSON.stringify(ffPayload), {
      status: 200, headers: { "content-type": "application/json" },
    });
  }
  // 그 외 외부 호출(BLS·FF 등)은 전부 실패시켜 KV 경로만 남깁니다.
  throw new Error("외부 네트워크 차단(테스트)");
};

// ── Upstash REST 호환 목 KV ──────────────────────────────────────
const store = new Map();
const exec = (cmd) => {
  const op = String(cmd[0]).toLowerCase();
  if (op === "get") return store.has(cmd[1]) ? store.get(cmd[1]) : null;
  if (op === "set") { store.set(cmd[1], cmd[2]); return "OK"; }
  return null;
};
const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => { body += c; });
  req.on("end", () => {
    let parsed = null;
    try { parsed = body ? JSON.parse(body) : null; } catch {}
    const pathCmd = req.url.split("?")[0].split("/").filter(Boolean).map(decodeURIComponent);
    res.setHeader("content-type", "application/json");
    if (pathCmd[0] === "pipeline" || pathCmd[0] === "multi-exec") {
      const cmds = Array.isArray(parsed) ? parsed : [];
      res.end(JSON.stringify(cmds.map((c) => ({ result: exec(c) }))));
      return;
    }
    const cmd = pathCmd.length > 0
      ? [...pathCmd, ...(Array.isArray(parsed) ? parsed : parsed != null ? [parsed] : [])]
      : (Array.isArray(parsed) ? parsed : []);
    res.end(JSON.stringify({ result: exec(cmd) }));
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
process.env.KV_REST_API_URL = `http://127.0.0.1:${server.address().port}`;
process.env.KV_REST_API_TOKEN = "test";

const readKey = (k) => {
  const raw = store.get(k);
  if (raw == null) return null;
  try { return typeof raw === "string" ? JSON.parse(raw) : raw; } catch { return raw; }
};
const writeKey = (k, v) => store.set(k, JSON.stringify(v));

// ── 픽스처 ──────────────────────────────────────────────────────
//   POISON: actual(2.4) === previous(2.4) — 오염의 지문. 과거 날짜라 하드 가드엔 안 걸립니다.
//   CLEAN : actual(3.1) !== previous(2.9) — 정상. 손대면 안 됩니다.
const POISON = "2026-06-10::CPI (YoY)";
const CLEAN = "2026-06-05::Nonfarm Payrolls";
writeKey("di:econ:actuals", { [POISON]: 2.4, [CLEAN]: 3.1 });
writeKey("di:econ:estimates", {
  [POISON]: { e: 2.6, p: 2.4, dt: "2026-06-10T08:30:00-04:00" },
  [CLEAN]: { e: 150, p: 2.9, dt: "2026-06-05T08:30:00-04:00" },
});

const { default: handler } = await import("../api/econ-calendar.js");
const callHandler = async () => {
  let payload = null;
  await handler(
    { query: { debug: "1" }, method: "GET" },
    { setHeader() {}, status() { return this; }, json(p) { payload = p; return this; } },
  );
  return payload;
};

let failed = 0;
const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failed++;
    console.error(`  ✗ ${name}\n      기대: ${JSON.stringify(expected)}\n      실제: ${JSON.stringify(actual)}`);
  } else {
    console.log(`  ✓ ${name}`);
  }
};

console.log("[test-econ-kv-sweep] 과거 오염 KV 자가치유 회귀 테스트");

// ── 1회차 ──
const p1 = await callHandler();
check("A 오염 의심 1건 격리", p1.kvQuarantined, 1);
check("A 격리 대상은 actual === previous 인 키", p1.debug.kvSweep.quarantinedNow, [POISON]);
check("A 오염 키가 di:econ:actuals 에서 제거됨", readKey("di:econ:actuals")[POISON] ?? null, null);
check("A 격리 원본은 보존(되돌릴 수 있음)", readKey("di:econ:actuals:quarantine")[POISON]?.value, 2.4);
check("C 정상 키는 그대로", readKey("di:econ:actuals")[CLEAN], 3.1);
check("A 오염 키는 응답에서도 발표 대기", p1.events.find(e => `${e.date}::${e.event}` === POISON)?.actual ?? null, null);

// ── 2회차 (churn 방지) ──
const p2 = await callHandler();
check("B 두 번째 요청에서 재격리 없음", p2.kvQuarantined, 0);
check("B 누적 격리 건수는 유지", p2.debug.kvSweep.quarantineTotal, 1);

// ── D. 살아 있는 소스(FF previous 역산)가 다른 값을 들고 있으면 교정 ──
//   FF 의 previous = 직전 회차 실제 발표치. 오염된 2.4 대신 2.9 가 진실인 상황.
writeKey("di:econ:actuals", { [POISON]: 2.4 });
writeKey("di:econ:actuals:quarantine", {}); // 격리 이력 초기화
ffPayload = [
  { country: "USD", title: "CPI y/y", date: "2026-07-14T08:30:00-04:00", forecast: "2.7%", previous: "2.9%", impact: "High" },
];
const p4 = await callHandler();
ffPayload = null;
check("D 격리가 아니라 교정", p4.kvQuarantined, 0);
check("D 교정 1건", p4.kvCorrected, 1);
check("D 교정 내역(오염값 → 실측)", p4.debug.kvSweep.corrected, [{ key: POISON, from: 2.4, to: 2.9 }]);
check("D KV 가 실측으로 덮어써짐", readKey("di:econ:actuals")[POISON], 2.9);

// ── 킬스위치 ──
process.env.ZEPTA_ECON_KV_SWEEP = "off";
writeKey("di:econ:actuals", { [POISON]: 2.4 });
const p3 = await callHandler();
check("킬스위치 off — 스윕 비활성", p3.debug.kvSweep.enabled, false);
check("킬스위치 off — 격리 0건", p3.kvQuarantined, 0);
check("킬스위치 off — KV 원본 유지", readKey("di:econ:actuals")[POISON], 2.4);

server.close();
if (failed > 0) {
  console.error(`[test-econ-kv-sweep] 실패 ${failed}건`);
  process.exit(1);
}
console.log("[test-econ-kv-sweep] 통과 — 전 케이스 정상");
process.exit(0);
