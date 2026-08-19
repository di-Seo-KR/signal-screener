// ════════════════════════════════════════════════════════════════════
// C-2 검증 — 레짐-전략 매칭 가중 (사전등록 백테스트, 2026-08-19)
// ────────────────────────────────────────────────────────────────────
// 가설: Hurst>0.55(추세장)에서 추세계 전략(trend-follow·breakout·supertrend·
//   hurst-trend) 발화, Hurst<0.45(횡보)에서 회귀계(mean-revert·volatility-arb)
//   발화 = "레짐 정합(aligned)" 이 반대 레짐 발화("역행(opposed)")보다 우위.
//   → 통과 시 engine 랭킹 가중: 정합 ×1.15 / 역행 ×0.85 (그리드 고정 3값,
//      킬스위치 ZEPTA_STRATEGY_BLEND=0).
//
// 발화 재현: c0-strategy-fire-replay.mjs (실제 전략 9종 코드 + 프로덕션 봇
//   라우팅 + F3 미러). 레짐 = market-monitor 미러 avgHurst(BTC·ETH·SOL 일봉).
//
// 실행: node scripts/research/c0-strategy-fire-replay.mjs (선행)
//       node scripts/research/c2-regime-match.mjs
// 산출: scripts/research/c2-results.json (판정과 무관하게 항상 저장)
//
// ★★★ 사전등록 파라미터·판정 룰 (결과 본 뒤 변경 금지) ★★★
// ── 그리드 없음 — 가중 3값(1.15/1.15/0.85)·임계(0.55/0.45)·패밀리 목록 전부 고정 ──
const HURST_HI = 0.55;
const HURST_LO = 0.45;
const TREND_FAMS = ["trend-follow", "breakout", "supertrend", "hurst-trend"];
const MR_FAMS = ["mean-revert", "volatility-arb"];
// ── 판정 룰 ──
// "배포 후보" = 아래 모두 충족, 하나라도 미달 시 "기각":
//  (a) OOS·전심볼 풀링 PF_aligned > PF_opposed
//  (b) 순열검정 p < 0.05 (단측): OOS·전심볼 aligned∪opposed 유니버스에서
//      aligned 라벨을 심볼 내 셔플(개수 보존, N_PERM회, 시드 고정)
//  (c) aligned 트레이드 IS+OOS ≥ 30 AND opposed 트레이드 IS+OOS ≥ 10
const MIN_ALIGNED_TRADES = 30;
const MIN_OPPOSED_TRADES = 10;
const P_THRESHOLD = 0.05;
const N_PERM = 1000;
const PERM_SEED = 20260819;
// ════════════════════════════════════════════════════════════════════

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const IN_PATH = process.env.ZEPTA_C0_INPUT || join(__dirname, "c0-fire-trades.json");
const OUT_PATH = process.env.ZEPTA_C2_OUTPUT || join(__dirname, "c2-results.json");

const INSAMPLE_SYMBOLS = ["BTCUSDT", "ETHUSDT"];

// ── 통계 헬퍼 (h2/d1 승계 — c1 과 동일) ──
function metrics(rets) {
  const n = rets.length;
  if (n === 0) return { trades: 0, winRate: null, avgRetPct: null, medianRetPct: null, pf: null };
  const wins = rets.filter((r) => r > 0);
  const grossP = wins.reduce((s, r) => s + r, 0);
  const grossL = rets.filter((r) => r < 0).reduce((s, r) => s - r, 0);
  const sorted = [...rets].sort((a, b) => a - b);
  const med = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  return {
    trades: n,
    winRate: round4(wins.length / n),
    avgRetPct: round4((rets.reduce((s, r) => s + r, 0) / n) * 100),
    medianRetPct: round4(med * 100),
    pf: grossL > 1e-12 ? round4(grossP / grossL) : (grossP > 0 ? null : 0),
  };
}
function pfRaw(rets) {
  let grossP = 0, grossL = 0;
  for (const r of rets) { if (r > 0) grossP += r; else if (r < 0) grossL -= r; }
  return grossL > 1e-12 ? grossP / grossL : (grossP > 0 ? Infinity : 0);
}
function round4(x) { return x == null ? null : Math.round(x * 1e4) / 1e4; }
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function strHash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** 순열검정: universe = [{sym, label(bool=aligned), ret}] — 심볼 내 셔플, 단측 greater */
function permutationTest(universe, tag) {
  const bySym = new Map();
  for (const u of universe) {
    if (!bySym.has(u.sym)) bySym.set(u.sym, []);
    bySym.get(u.sym).push(u);
  }
  const obsRets = universe.filter((u) => u.label).map((u) => u.ret);
  const pfObs = pfRaw(obsRets);
  const rng = mulberry32(PERM_SEED ^ strHash(`C2|${tag}|OOS`));
  let ge = 0, permPfSum = 0, permPfN = 0;
  for (let p = 0; p < N_PERM; p++) {
    const permRets = [];
    for (const arr of bySym.values()) {
      const k = arr.reduce((s, u) => s + (u.label ? 1 : 0), 0);
      const idx = arr.map((_, j) => j);
      for (let j = 0; j < k; j++) {
        const r = j + Math.floor(rng() * (idx.length - j));
        [idx[j], idx[r]] = [idx[r], idx[j]];
        permRets.push(arr[idx[j]].ret);
      }
    }
    const pfP = pfRaw(permRets);
    if (pfP >= pfObs) ge++;
    if (Number.isFinite(pfP)) { permPfSum += pfP; permPfN++; }
  }
  return {
    pfObs: Number.isFinite(pfObs) ? round4(pfObs) : null,
    nObs: obsRets.length, nUniverse: universe.length,
    nPerm: N_PERM, seed: PERM_SEED,
    pValue: round4((1 + ge) / (1 + N_PERM)),
    permMeanPf: permPfN ? round4(permPfSum / permPfN) : null,
  };
}

// ── 라벨링 (사전등록 정의) ──
function regimeOf(hurst) {
  if (hurst == null) return "unknown";
  if (hurst > HURST_HI) return "trend";
  if (hurst < HURST_LO) return "range";
  return "neutral";
}
function famGroupOf(family) {
  if (TREND_FAMS.includes(family)) return "trend";
  if (MR_FAMS.includes(family)) return "mr";
  return "neutral";
}
/** aligned / opposed / neutral */
function labelOf(t) {
  const r = regimeOf(t.hurst);
  const g = famGroupOf(t.family);
  if (r === "trend" && g === "trend") return "aligned";
  if (r === "range" && g === "mr") return "aligned";
  if (r === "trend" && g === "mr") return "opposed";
  if (r === "range" && g === "trend") return "opposed";
  return "neutral";
}

// ── 메인 ──
function main() {
  const c0 = JSON.parse(readFileSync(IN_PATH, "utf8"));
  const trades = (c0.trades || []).map((t) => ({ ...t, c2label: labelOf(t) }));
  console.log(`C-2 레짐-전략 매칭 — 트레이드 ${trades.length}건 로드`);

  // 풀링 집계
  const pooled = [];
  for (const seg of ["IS", "OOS"]) {
    for (const grp of ["insample", "crossval", "all"]) {
      const sub = trades.filter((t) =>
        t.seg === seg && (grp === "all" || (grp === "insample") === INSAMPLE_SYMBOLS.includes(t.sym)));
      pooled.push({
        segment: seg, group: grp,
        all: metrics(sub.map((t) => t.ret)),
        aligned: metrics(sub.filter((t) => t.c2label === "aligned").map((t) => t.ret)),
        opposed: metrics(sub.filter((t) => t.c2label === "opposed").map((t) => t.ret)),
        neutral: metrics(sub.filter((t) => t.c2label === "neutral").map((t) => t.ret)),
      });
    }
  }
  // 진단: 레짐 × 패밀리군 교차표 + 패밀리별 성과
  const crosstab = {};
  const byFamily = {};
  for (const t of trades) {
    const key = `${regimeOf(t.hurst)}|${famGroupOf(t.family)}`;
    crosstab[key] = (crosstab[key] || 0) + 1;
    if (!byFamily[t.family]) byFamily[t.family] = [];
    byFamily[t.family].push(t.ret);
  }
  const familyMetrics = Object.fromEntries(
    Object.entries(byFamily).map(([f, rets]) => [f, metrics(rets)]));

  const perSymbol = [];
  for (const sym of [...new Set(trades.map((t) => t.sym))]) {
    for (const seg of ["IS", "OOS"]) {
      const sub = trades.filter((t) => t.sym === sym && t.seg === seg);
      perSymbol.push({
        symbol: sym, segment: seg,
        aligned: metrics(sub.filter((t) => t.c2label === "aligned").map((t) => t.ret)),
        opposed: metrics(sub.filter((t) => t.c2label === "opposed").map((t) => t.ret)),
        neutral: metrics(sub.filter((t) => t.c2label === "neutral").map((t) => t.ret)),
      });
    }
  }

  // ── 순열검정 (OOS·전심볼, aligned∪opposed 유니버스) ──
  const uni = trades.filter((t) => t.seg === "OOS" && t.c2label !== "neutral")
    .map((t) => ({ sym: t.sym, label: t.c2label === "aligned", ret: t.ret }));
  const permutation = uni.length ? permutationTest(uni, "alignedVsOpposed") : null;

  // ── 판정 (무손실 부분군 PF=∞ 도 유효 비교 — pfRaw 직접 사용) ──
  const oosSub = trades.filter((t) => t.seg === "OOS");
  const isSub = trades.filter((t) => t.seg === "IS");
  const oosAligned = oosSub.filter((t) => t.c2label === "aligned").map((t) => t.ret);
  const oosOpposed = oosSub.filter((t) => t.c2label === "opposed").map((t) => t.ret);
  const pfAliRaw = pfRaw(oosAligned), pfOppRaw = pfRaw(oosOpposed);
  const pfImproves = oosAligned.length > 0 && oosOpposed.length > 0 && pfAliRaw > pfOppRaw;
  const permPass = !!(permutation && permutation.pValue != null && permutation.pValue < P_THRESHOLD);
  const alignedTotal = oosAligned.length + isSub.filter((t) => t.c2label === "aligned").length;
  const opposedTotal = oosOpposed.length + isSub.filter((t) => t.c2label === "opposed").length;
  const enough = alignedTotal >= MIN_ALIGNED_TRADES && opposedTotal >= MIN_OPPOSED_TRADES;
  const disp = (x) => (Number.isFinite(x) ? round4(x) : (x === Infinity ? "inf" : null));
  const verdict = {
    candidate: pfImproves && permPass && enough,
    label: (pfImproves && permPass && enough) ? "배포 후보" : "기각",
    reasons: {
      oosPfImproves: pfImproves,
      oosPfAligned: disp(pfAliRaw), oosPfOpposed: disp(pfOppRaw),
      oosPfNeutral: disp(pfRaw(oosSub.filter((t) => t.c2label === "neutral").map((t) => t.ret))),
      oosPfAll: disp(pfRaw(oosSub.map((t) => t.ret))),
      permutationPass: permPass, permutationP: permutation?.pValue ?? null,
      alignedTradesTotal: alignedTotal, minRequired: MIN_ALIGNED_TRADES,
      opposedTradesTotal: opposedTotal, minOpposedRequired: MIN_OPPOSED_TRADES,
    },
  };

  const results = {
    hypothesis: "C-2 — 레짐 정합 발화(추세장×추세계 / 횡보장×회귀계)가 역행 발화보다 우위 → 랭킹 가중 정합 ×1.15 / 역행 ×0.85",
    source: "대표 지시 2026-08-19 — 스코어 단독이 아닌 전략 결합 자동매매 (사전등록 백테스트)",
    preregistered: {
      hurstHi: HURST_HI, hurstLo: HURST_LO,
      trendFamilies: TREND_FAMS, meanRevertFamilies: MR_FAMS,
      weightsIfPass: { aligned: 1.15, opposed: 0.85 },
      regimeSource: "avgHurst = BTC·ETH·SOL 완결 일봉 종가 100개 R/S Hurst 평균 (market-monitor 미러, 일별) — c0 하네스 산출",
      candidateRule: `OOS·전심볼 PF_aligned > PF_opposed AND 순열검정 p<${P_THRESHOLD} (aligned∪opposed 심볼 층화 셔플 ${N_PERM}회, 단측) AND aligned IS+OOS ≥ ${MIN_ALIGNED_TRADES} AND opposed IS+OOS ≥ ${MIN_OPPOSED_TRADES}`,
      permutationSeed: PERM_SEED,
      harness: "c0-strategy-fire-replay.mjs (실제 전략 코드 실행 — 프록시 흉내 아님). 규약·caveat 은 c0-fire-trades.json preregistered 블록 참조",
      caveats: [
        "8심볼 봇 라우팅상 top 발화 패밀리는 ensemble·trend-follow·momentum-rotation·volatility-arb·defi-momentum — 추세계=trend-follow, 회귀계=volatility-arb 만 관측됨 (breakout·supertrend·hurst-trend·mean-revert 는 단독 top 미등장, 프로덕션 실태 그대로)",
      ],
    },
    generatedAt: new Date().toISOString(),
    harnessGeneratedAt: c0.generatedAt,
    harnessDiag: c0.diag,
    permutation,
    verdict,
    pooled,
    regimeFamilyCrosstab: crosstab,
    familyMetrics,
    perSymbol,
  };

  writeFileSync(OUT_PATH, JSON.stringify(results, null, 2));
  console.log(`저장: ${OUT_PATH}`);
  console.log(`판정=${verdict.label}`);
  console.log("근거:", JSON.stringify(verdict.reasons));
}

main();
