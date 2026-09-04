// ════════════════════════════════════════════════════════════════════
// score-shadow — 코인 종합 스코어 섀도 표본 영구 축적 + 자동 채점 (측정 전용)
// ────────────────────────────────────────────────────────────────────
// ★ 2026-09-04 (대표 지시 "코인별 시그널 스코어링 정밀화"):
//   기존 섀도 병기(ocShadow 2026-08-11 · h2Shadow 2026-08-17)는 표본을
//   di:signals:realtime-pool-mtf 에만 남겼는데, 이 풀은 4h cutoff + 200개
//   슬라이스로 잘려 표본이 4시간 만에 증발했습니다 — "홀드아웃 + p<0.05
//   통과 후 승급" 게이트에 필요한 누적이 3주째 0 인 구조적 공백.
//   이 모듈이 그 공백을 메웁니다:
//
//   ① 매 btc-cron 런에서 종합(MTF) 신호를 asset×시간당 1건 표본으로 적재
//      (ocShadow.adj / h2Shadow 상태 태그 동봉 — 요소별 대조군 포함).
//   ② +24h 성숙 표본을 그 asset 의 1h 캔들로 전방 수익률 채점(추가 API 0회 —
//      btc-cron 이 이미 들고 있는 캔들 재사용).
//   ③ 채점 결과를 집계 통계로 접어 영구 보존:
//      - byScoreBucket : 점수 구간별 실측 적중률 → 스코어 캘리브레이션 근거
//      - oc / h2       : 섀도 요소별 적중률 → 승급(점수 반영) 판단 근거
//
//   ■ 순수 측정 — 엔진·표시 어느 경로도 이 모듈의 산출물을 소비하지 않습니다.
//     점수 반영(승급)은 표본 누적 후 별도 사전등록 커밋 + 대표 승인으로만.
//   ■ 킬스위치 — ZEPTA_SCORE_SHADOW=0 이면 전체 무동작.
//
// KV:
//   di:score:shadow-samples → [{id, asset, side, score, ts, px, ocAdj, h2}]
//                              (미성숙 링 — 채점되면 제거, cap 2500)
//   di:score:shadow-stats   → { total, byScoreBucket, oc, h2, matured, expired,
//                               updatedAt } (영구 집계 — 표본은 접어서 보존)
// ════════════════════════════════════════════════════════════════════

const SAMPLES_KEY = "di:score:shadow-samples";
const STATS_KEY = "di:score:shadow-stats";
const MATURE_MS = 24 * 60 * 60 * 1000; // +24h 전방 수익률
const EXPIRE_MS = 72 * 60 * 60 * 1000; // 3일 내 채점 불가(유니버스 이탈 등) → 폐기
const SAMPLES_CAP = 2500;              // 미성숙 링 상한 (50종 × 24h × 시간당 1건 ≈ 1200)

export function scoreShadowEnabled() {
  return process.env.ZEPTA_SCORE_SHADOW !== "0";
}

/**
 * 이번 런의 표시 풀(MTF) 엔트리 → 섀도 표본 배열.
 * asset×시간당 1건 dedup(id) — 10분 크론 6회 중 첫 관측만 표본이 됩니다.
 *
 * @param {Array}  mtfEntries   newMtfEntries (히스테리시스·보정 적용 후)
 * @param {Object} oneHByAsset  { [asset]: { times:[sec], closes:[num] } }
 */
export function buildScoreShadowSamples(mtfEntries, oneHByAsset) {
  const out = [];
  for (const e of Array.isArray(mtfEntries) ? mtfEntries : []) {
    if (!e || !e.asset) continue;
    const side = e.side === "LONG" || e.side === "SHORT" ? e.side : null;
    if (!side) continue;
    const c = oneHByAsset?.[e.asset];
    const px = c?.closes?.length ? Number(c.closes[c.closes.length - 1]) : null;
    if (!(px > 0)) continue; // 기준가 없으면 채점 불가 표본 — 적재 안 함
    const ts = Number(e.ts) || Date.now();
    out.push({
      id: `cal:${e.asset}:${Math.floor(ts / 3600000)}`,
      asset: e.asset, side,
      score: Math.max(0, Math.min(100, Math.round(Number(e.score) || 0))),
      ts, px,
      // 요소 태그 — null 도 의미(그 요소 데이터 없던 표본, 분모에서 제외)
      ocAdj: Number.isFinite(e.ocShadow?.adj) ? e.ocShadow.adj : null,
      h2: e.h2Shadow ? (e.h2Shadow.cont ? "cont" : e.h2Shadow.active ? "active" : "inactive") : null,
    });
  }
  return out;
}

function scoreBucket(score) {
  if (score >= 85) return "85+";
  if (score >= 75) return "75-84";
  if (score >= 65) return "65-74";
  if (score >= 55) return "55-64";
  return "<55";
}

function fold(bucketHost, key, ret) {
  const b = bucketHost[key] || (bucketHost[key] = { n: 0, win: 0, sumRet: 0 });
  b.n += 1;
  b.sumRet = Number((b.sumRet + ret).toFixed(6));
  if (ret > 0) b.win += 1;
}

/**
 * 표본 적재 + 성숙 채점 + 통계 접기 — btc-cron 런당 1회 호출.
 * 어떤 실패도 던지지 않고 로그만 남깁니다(크론 무영향).
 *
 * @param {object} args.kv           @vercel/kv
 * @param {Array}  args.newSamples   buildScoreShadowSamples 결과
 * @param {Object} args.oneHByAsset  { [asset]: { times:[sec], closes:[num] } }
 * @param {Function} [args.log]      진행 로그 콜백
 */
export async function processScoreShadow({ kv, newSamples = [], oneHByAsset = {}, log = () => {} }) {
  if (!scoreShadowEnabled()) return;
  try {
    let samples = (await kv.get(SAMPLES_KEY)) || [];
    if (!Array.isArray(samples)) samples = [];
    const known = new Set(samples.map((s) => s?.id).filter(Boolean));
    let added = 0;
    for (const s of newSamples) {
      if (!s?.id || known.has(s.id)) continue;
      samples.push(s); known.add(s.id); added++;
    }

    const stats = (await kv.get(STATS_KEY)) || {
      total: { n: 0, win: 0, sumRet: 0 },
      byScoreBucket: {}, oc: {}, h2: {},
      matured: 0, expired: 0,
    };

    const now = Date.now();
    const pending = [];
    let matured = 0, expired = 0;
    for (const s of samples) {
      const age = now - (Number(s?.ts) || 0);
      if (!s?.asset || !(s?.px > 0) || !Number.isFinite(age)) { continue; } // 형식 불량 폐기
      if (age < MATURE_MS) { pending.push(s); continue; }

      // +24h 시점 종가 — 그 asset 의 1h 캔들에서 target 을 포함하는 봉의 종가
      let px24 = null;
      const c = oneHByAsset?.[s.asset];
      if (Array.isArray(c?.times) && c.times.length) {
        const targetSec = (s.ts + MATURE_MS) / 1000;
        for (let i = c.times.length - 1; i >= 0; i--) {
          if (c.times[i] <= targetSec) {
            // 봉이 target 근방(±2h)이어야 진짜 +24h 채점 — 오래된 봉으로의 오채점 방지
            if (c.times[i] >= targetSec - 2 * 3600) px24 = Number(c.closes[i]);
            break;
          }
        }
      }
      if (!(px24 > 0)) {
        if (age > EXPIRE_MS) { expired++; stats.expired = (stats.expired || 0) + 1; }
        else pending.push(s); // 이번 런에 캔들 없음(유니버스 순환 등) — 다음 런 재시도
        continue;
      }

      const dir = s.side === "LONG" ? 1 : -1;
      const ret = dir * (px24 - s.px) / s.px;
      if (!Number.isFinite(ret)) { expired++; continue; }
      fold(stats, "total", ret);
      fold(stats.byScoreBucket, `${s.side}:${scoreBucket(s.score)}`, ret);
      if (s.ocAdj != null) fold(stats.oc, s.ocAdj > 0 ? "confirm" : s.ocAdj < 0 ? "penalty" : "zero", ret);
      if (s.h2) fold(stats.h2, s.h2, ret);
      matured++; stats.matured = (stats.matured || 0) + 1;
    }

    stats.updatedAt = new Date().toISOString();
    await kv.set(SAMPLES_KEY, pending.slice(-SAMPLES_CAP));
    await kv.set(STATS_KEY, stats);
    if (added || matured || expired) {
      log(`🧪 스코어 섀도: 신규 ${added} · 채점 ${matured} · 만료 ${expired} (미성숙 ${pending.length})`);
    }
  } catch (e) {
    log(`⚠️ 스코어 섀도 처리 실패(비치명): ${e?.message}`);
  }
}
