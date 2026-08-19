// ════════════════════════════════════════════════════════════════════
// C-1 검증 — 전략 합의 부스트 (사전등록 백테스트, 2026-08-19)
// ────────────────────────────────────────────────────────────────────
// 가설: 같은 심볼·같은 방향에 서로 다른 전략 패밀리 2개 이상이 T분 이내
//   동시 발화(합의)한 진입이, 단독 발화 진입보다 승률·PF 우위.
//   → 통과 시 engine 랭킹에 합의 가중 ×1.25 (킬스위치 ZEPTA_STRATEGY_BLEND=0).
//
// 발화 재현: c0-strategy-fire-replay.mjs (실제 전략 9종 코드 + 프로덕션 봇
//   라우팅 + F3 미러). 이 스크립트는 라벨링·판정만 수행.
//
// 실행: node scripts/research/c0-strategy-fire-replay.mjs (선행)
//       node scripts/research/c1-consensus-boost.mjs
// 산출: scripts/research/c1-results.json (판정과 무관하게 항상 저장)
//
// ★★★ 사전등록 파라미터·판정 룰 (결과 본 뒤 변경 금지) ★★★
// ── 그리드 (유일한 자유도 — 지시로 2개 고정, 추가 금지) ──
const T_GRID = [30, 60]; // 합의 판정 창(분)
// ── 판정 룰 ──
// bestT: IS·insample(BTC+ETH) 풀링에서 (PF_consensus − PF_solo) 최대인 T.
//   단, 그 T 의 IS·insample 합의 트레이드 ≥ 5 이고 양 PF 계산 가능해야 유효.
//   유효 T 없으면 "기각(선정 불가)".
// "배포 후보" = 아래 모두 충족, 하나라도 미달 시 "기각":
//  (a) OOS·전심볼 풀링 PF_consensus > PF_solo
//  (b) 순열검정 p < 0.05 (단측): OOS·전심볼에서 합의 라벨을 심볼 내 셔플
//      (개수 보존, N_PERM회, 시드 고정) → 무작위 부분집합 PF ≥ 관측 PF_consensus 비율
//  (c) 합의 트레이드 IS+OOS ≥ 30 AND 단독 트레이드 IS+OOS ≥ 10 (비교군 비퇴화)
const MIN_CONSENSUS_TRADES = 30;
const MIN_SOLO_TRADES = 10;
const P_THRESHOLD = 0.05;
const N_PERM = 1000;
const PERM_SEED = 20260819;
// ════════════════════════════════════════════════════════════════════

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const IN_PATH = process.env.ZEPTA_C0_INPUT || join(__dirname, "c0-fire-trades.json");
const OUT_PATH = process.env.ZEPTA_C1_OUTPUT || join(__dirname, "c1-results.json");

const INSAMPLE_SYMBOLS = ["BTCUSDT", "ETHUSDT"];

// ── 통계 헬퍼 (h2/d1 승계) ──
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

/** 순열검정: universe = [{sym, label(bool), ret}]. 심볼 내 라벨 셔플(개수 보존), 단측 greater */
function permutationTest(universe, tag) {
  const bySym = new Map();
  for (const u of universe) {
    if (!bySym.has(u.sym)) bySym.set(u.sym, []);
    bySym.get(u.sym).push(u);
  }
  const obsRets = universe.filter((u) => u.label).map((u) => u.ret);
  const pfObs = pfRaw(obsRets);
  const rng = mulberry32(PERM_SEED ^ strHash(`C1|${tag}|OOS`));
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

// ── 메인 ──
function main() {
  const c0 = JSON.parse(readFileSync(IN_PATH, "utf8"));
  const trades = c0.trades || [];
  console.log(`C-1 전략 합의 부스트 — 트레이드 ${trades.length}건 로드`);

  const isConsensus = (t, T) => (T === 30 ? t.fams30 : t.fams60).length >= 2;

  // 풀링 집계: {T, segment, group} → {cons: [], solo: []}
  const pooled = [];
  const perSymbol = [];
  const bucket = (T, seg, grp) => trades.filter((t) =>
    t.seg === seg && (grp === "all" || (grp === "insample") === INSAMPLE_SYMBOLS.includes(t.sym))
    && true);
  for (const T of T_GRID) {
    for (const seg of ["IS", "OOS"]) {
      for (const grp of ["insample", "crossval", "all"]) {
        const sub = bucket(T, seg, grp);
        const cons = sub.filter((t) => isConsensus(t, T)).map((t) => t.ret);
        const solo = sub.filter((t) => !isConsensus(t, T)).map((t) => t.ret);
        pooled.push({
          T, segment: seg, group: grp,
          all: metrics(sub.map((t) => t.ret)),
          consensus: metrics(cons),
          solo: metrics(solo),
          consensusRate: sub.length ? round4(cons.length / sub.length) : null,
        });
      }
    }
    for (const sym of [...new Set(trades.map((t) => t.sym))]) {
      for (const seg of ["IS", "OOS"]) {
        const sub = trades.filter((t) => t.sym === sym && t.seg === seg);
        perSymbol.push({
          symbol: sym, T, segment: seg,
          consensus: metrics(sub.filter((t) => isConsensus(t, T)).map((t) => t.ret)),
          solo: metrics(sub.filter((t) => !isConsensus(t, T)).map((t) => t.ret)),
        });
      }
    }
  }

  // ── bestT 선정 (사전등록: IS·insample PF_cons − PF_solo 최대, 합의 n≥5) ──
  //   무손실 부분군 PF=∞ 는 비교 위해 1e6 캡 (JSON metrics 의 null 표기와 별개 — 유효 처리)
  const capPf = (x) => (Number.isFinite(x) ? x : (x === Infinity ? 1e6 : null));
  const tScore = new Map();
  for (const T of T_GRID) {
    const isSub = trades.filter((t) => t.seg === "IS" && INSAMPLE_SYMBOLS.includes(t.sym));
    const cons = isSub.filter((t) => isConsensus(t, T)).map((t) => t.ret);
    const solo = isSub.filter((t) => !isConsensus(t, T)).map((t) => t.ret);
    const pfc = capPf(pfRaw(cons)), pfs = capPf(pfRaw(solo));
    const valid = cons.length >= 5 && solo.length > 0 && pfc != null && pfs != null;
    tScore.set(T, valid ? round4(Math.max(-1e6, Math.min(1e6, pfc - pfs))) : null);
  }
  let bestT = null, bestScore = -Infinity;
  for (const [T, s] of tScore.entries()) {
    if (s != null && s > bestScore) { bestScore = s; bestT = T; }
  }

  // ── 순열검정 (OOS·전심볼 — 두 T 모두 산출하되 판정은 bestT) ──
  const permutation = {};
  for (const T of T_GRID) {
    const uni = trades.filter((t) => t.seg === "OOS")
      .map((t) => ({ sym: t.sym, label: isConsensus(t, T), ret: t.ret }));
    permutation[String(T)] = uni.length ? permutationTest(uni, `T${T}`) : null;
  }

  // ── 판정 ──
  let verdict = { candidate: false, label: "기각", bestT, reasons: {} };
  if (bestT != null) {
    const oosSub = trades.filter((t) => t.seg === "OOS");
    const isSub = trades.filter((t) => t.seg === "IS");
    const oosCons = oosSub.filter((t) => isConsensus(t, bestT)).map((t) => t.ret);
    const oosSolo = oosSub.filter((t) => !isConsensus(t, bestT)).map((t) => t.ret);
    const pfConsRaw = pfRaw(oosCons), pfSoloRaw = pfRaw(oosSolo);
    const pfImproves = oosCons.length > 0 && oosSolo.length > 0 && pfConsRaw > pfSoloRaw; // ∞-safe 비교
    const perm = permutation[String(bestT)];
    const permPass = !!(perm && perm.pValue != null && perm.pValue < P_THRESHOLD);
    const consTotal = oosCons.length + isSub.filter((t) => isConsensus(t, bestT)).length;
    const soloTotal = oosSolo.length + isSub.filter((t) => !isConsensus(t, bestT)).length;
    const enough = consTotal >= MIN_CONSENSUS_TRADES && soloTotal >= MIN_SOLO_TRADES;
    const disp = (x) => (Number.isFinite(x) ? round4(x) : (x === Infinity ? "inf" : null));
    verdict = {
      candidate: pfImproves && permPass && enough,
      label: (pfImproves && permPass && enough) ? "배포 후보" : "기각",
      bestT,
      reasons: {
        oosPfImproves: pfImproves,
        oosPfConsensus: disp(pfConsRaw), oosPfSolo: disp(pfSoloRaw),
        oosPfAll: disp(pfRaw(oosSub.map((t) => t.ret))),
        permutationPass: permPass, permutationP: perm?.pValue ?? null,
        consensusTradesTotal: consTotal, minRequired: MIN_CONSENSUS_TRADES,
        soloTradesTotal: soloTotal, minSoloRequired: MIN_SOLO_TRADES,
      },
    };
  } else {
    verdict.label = "기각(선정 불가)";
    verdict.reasons = { error: "유효한 bestT 없음 (IS insample 합의 트레이드 <5 또는 PF 계산 불가)", tScore: Object.fromEntries(tScore) };
  }

  const results = {
    hypothesis: "C-1 — 같은 심볼·같은 방향에 서로 다른 전략 패밀리 2+개가 T분 이내 동시 발화(합의)한 진입이 단독 발화보다 승률·PF 우위 → 랭킹 합의 가중 ×1.25",
    source: "대표 지시 2026-08-19 — 스코어 단독이 아닌 전략 결합 자동매매 (사전등록 백테스트)",
    preregistered: {
      tGridMinutes: T_GRID,
      boostIfPass: 1.25,
      consensusDef: "발화(F3 통과 풀 적재) 스트림에서 같은 심볼·같은 방향, [t−T, t] 창 내 서로 다른 family ≥ 2 (진입 발화 포함)",
      bestTRule: "IS·insample(BTC+ETH) 풀링 (PF_consensus − PF_solo) 최대 T (합의 n≥5, 양 PF 유효)",
      candidateRule: `OOS·전심볼 PF_consensus > PF_solo AND 순열검정 p<${P_THRESHOLD} (심볼 층화 라벨 셔플 ${N_PERM}회, 단측) AND 합의 IS+OOS ≥ ${MIN_CONSENSUS_TRADES} AND 단독 IS+OOS ≥ ${MIN_SOLO_TRADES}`,
      permutationSeed: PERM_SEED,
      harness: "c0-strategy-fire-replay.mjs (실제 전략 코드 실행 — 프록시 흉내 아님). 규약·caveat 은 c0-fire-trades.json preregistered 블록 참조",
    },
    generatedAt: new Date().toISOString(),
    harnessGeneratedAt: c0.generatedAt,
    harnessDiag: c0.diag,
    tScoreIS: Object.fromEntries([...tScore.entries()].map(([k, v]) => [String(k), v])),
    bestT,
    permutation,
    verdict,
    pooled: pooled.sort((a, b) =>
      a.group.localeCompare(b.group) || a.T - b.T || a.segment.localeCompare(b.segment)),
    perSymbol,
  };

  writeFileSync(OUT_PATH, JSON.stringify(results, null, 2));
  console.log(`저장: ${OUT_PATH}`);
  console.log(`bestT=${bestT}, 판정=${verdict.label}`);
  console.log("근거:", JSON.stringify(verdict.reasons));
}

main();
