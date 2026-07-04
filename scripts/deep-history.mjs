// ════════════════════════════════════════════════════════════════════
// 딥 히스토리 페처 — 상장 이후 전체 klines + 펀딩비 히스토리 (2026-07-04)
// ────────────────────────────────────────────────────────────────────
// 목적: 캘리브레이션 표본 확대(일봉 검증력↑) + 2021 고점·2022 약세장 포함
// (숏 요소가 진짜 약세장에서 작동하는지 최초 검증) + 펀딩비 요소 데이터.
// 캐시: 스크래치패드에 JSON (24h 내 재사용 — 재실행 빠르게).
// ════════════════════════════════════════════════════════════════════

import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { getKlines } from "../api/_shared/binance-client.js";

const CACHE_DIR = process.env.ZEPTA_KLINES_CACHE
  || "/private/tmp/claude-501/-Users-kaneseo-Desktop-signal-screener-project--claude-worktrees-strange-bardeen-4ae62e/3d6e6a2a-2672-42dc-8d40-11e1b4ab1a72/scratchpad/klines-cache";
mkdirSync(CACHE_DIR, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function cachePath(name) { return `${CACHE_DIR}/${name}.json`; }
function readCache(name, maxAgeMs = 24 * 3600 * 1000) {
  const p = cachePath(name);
  if (!existsSync(p)) return null;
  if (Date.now() - statSync(p).mtimeMs > maxAgeMs) return null;
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; }
}
function writeCache(name, data) { writeFileSync(cachePath(name), JSON.stringify(data)); }

/** 상장 이후 전체 klines (페이지네이션, 진행봉 포함 — caller 가 마지막 봉 제거) */
export async function fetchDeepKlines(symbol, interval, sinceMs = Date.parse("2019-09-01T00:00:00Z")) {
  const key = `${symbol}-${interval}`;
  const cached = readCache(key);
  if (cached) return cached;
  const out = [];
  let start = sinceMs;
  for (let page = 0; page < 60; page++) {
    let kl;
    try { kl = await getKlines({ symbol, interval, limit: 1500, startTime: start }); }
    catch (e) { await sleep(500); try { kl = await getKlines({ symbol, interval, limit: 1500, startTime: start }); } catch { break; } }
    if (!Array.isArray(kl) || kl.length === 0) break;
    out.push(...kl);
    if (kl.length < 1500) break; // 마지막 페이지
    start = Number(kl[kl.length - 1][0]) + 1;
    await sleep(80);
  }
  // 중복 제거 (openTime 기준)
  const seen = new Set(); const dedup = [];
  for (const k of out) { const t = Number(k[0]); if (!seen.has(t)) { seen.add(t); dedup.push(k); } }
  writeCache(key, dedup);
  return dedup;
}

/** 펀딩비 전체 히스토리 (8h 마다 1건) — [{fundingTime, fundingRate}] 오름차순 */
export async function fetchFundingHistory(symbol, sinceMs = Date.parse("2019-09-01T00:00:00Z")) {
  const key = `funding-${symbol}`;
  const cached = readCache(key);
  if (cached) return cached;
  const base = process.env.BINANCE_FAPI_BASE || "https://fapi.binance.com";
  const out = [];
  let start = sinceMs;
  for (let page = 0; page < 30; page++) {
    const url = `${base}/fapi/v1/fundingRate?symbol=${symbol}&limit=1000&startTime=${start}`;
    let rows;
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { "User-Agent": "Zepta/1.0" } });
      if (!resp.ok) break;
      rows = await resp.json();
    } catch { break; }
    if (!Array.isArray(rows) || rows.length === 0) break;
    for (const r of rows) out.push({ t: Number(r.fundingTime), rate: parseFloat(r.fundingRate) });
    if (rows.length < 1000) break;
    start = out[out.length - 1].t + 1;
    await sleep(80);
  }
  out.sort((a, b) => a.t - b.t);
  writeCache(key, out);
  return out;
}

/** klines 배열 → 지표 배열 + 각 봉의 '직전 확정 펀딩비'(있으면) 정렬 매핑 */
export function toArraysWithFunding(klines, funding = null) {
  const opens = [], highs = [], lows = [], closes = [], volumes = [], times = [];
  for (const k of klines) {
    const o = +k[1], h = +k[2], l = +k[3], c = +k[4];
    if (![o, h, l, c].every(Number.isFinite)) continue;
    opens.push(o); highs.push(h); lows.push(l); closes.push(c); volumes.push(+k[5]); times.push(+k[0]);
  }
  let fundingAt = null;
  if (Array.isArray(funding) && funding.length) {
    fundingAt = new Array(times.length).fill(null);
    let fi = 0;
    for (let i = 0; i < times.length; i++) {
      while (fi + 1 < funding.length && funding[fi + 1].t <= times[i]) fi++;
      if (funding[fi] && funding[fi].t <= times[i]) fundingAt[i] = funding[fi].rate;
    }
  }
  return { opens, highs, lows, closes, volumes, times, fundingAt };
}
