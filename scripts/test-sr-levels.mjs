// sr-levels 단위 테스트 — node scripts/test-sr-levels.mjs (실패 시 exit 1)
import { computeSRLevels, scaleSR } from "../api/_shared/sr-levels.js";

let fails = 0;
const ok = (cond, name, extra = "") => {
  console.log(`${cond ? "✅" : "❌"} ${name}${extra ? " — " + extra : ""}`);
  if (!cond) fails++;
};
const mk = (h, l, c) => ({ high: h, low: l, close: c });
// 잔잔한 베이스 캔들(스윙 안 만들게 미세 노이즈)
const flat = (n, p) => Array.from({ length: n }, (_, i) => mk(p * (1 + 0.001 * ((i % 3) - 1)), p * (1 - 0.001 * ((i % 3) - 1)), p));

// (a) 더블탑: 고점 100.0/100.3 두 번 + 현재가 95
{
  const c = [];
  c.push(...flat(20, 95));
  c.push(mk(96, 94, 95), mk(100.0, 95, 97), mk(96, 94, 95)); // 스윙 고점 1
  c.push(...flat(8, 95));
  c.push(mk(96, 94, 95), mk(100.3, 95, 97), mk(96, 94, 95)); // 스윙 고점 2 (0.3% 이내 → 병합)
  c.push(...flat(10, 95));
  c.push(mk(95.5, 94.5, 95)); // 진행 중 캔들
  const sr = computeSRLevels(c, 95);
  ok(sr && sr.r.length > 0, "(a) 더블탑 저항 검출");
  ok(sr && Math.abs(sr.r[0].p - 100.15) / 100.15 < 0.01, "(a) 병합 가중평균 ≈100.15", sr ? `r0=${sr.r[0].p}` : "null");
  ok(sr && sr.r[0].t >= 2, "(a) 터치 2회", sr ? `t=${sr.r[0].t}` : "");
  ok(sr && sr.r[0].d > 0, "(a) 저항 d 양수");
}
// (b) 계단식 상승 — 눌림목 지지 + d 음수
{
  const c = [];
  for (const base of [80, 84, 88, 92, 96]) {
    c.push(...flat(6, base));
    c.push(mk(base + 1, base - 2, base)); // 눌림(스윙 저점 후보)
    c.push(...flat(5, base + 2));
  }
  c.push(mk(97, 95, 96));
  const sr = computeSRLevels(c, 96);
  ok(sr && sr.s.length > 0 && sr.s.every((x) => x.d < 0), "(b) 상승추세 지지 d 음수", sr ? JSON.stringify(sr.s) : "null");
}
// (c) 완전 횡보(±0.3% 미만) → 클러스터가 버퍼 안 → pivot 폴백 또는 유효 결과
{
  const c = flat(70, 50);
  const sr = computeSRLevels(c, 50);
  ok(sr === null || sr.m === "pivot" || sr.m === "mixed", "(c) 횡보 폴백 동작", sr ? `m=${sr.m}` : "null(허용)");
}
// (d) 미세가격 0.00001234 — 유효숫자 보존 + 과병합 없음
{
  const p0 = 0.00001234;
  const c = [];
  c.push(...flat(20, p0));
  c.push(mk(p0 * 1.05, p0 * 0.99, p0), mk(p0 * 1.12, p0, p0 * 1.02), mk(p0 * 1.01, p0 * 0.97, p0)); // 스윙고점 p0*1.12
  c.push(...flat(15, p0));
  c.push(mk(p0, p0 * 0.9, p0 * 0.95)); // 진행 중
  const sr = computeSRLevels(c, p0);
  ok(sr && sr.r.length > 0 && sr.r[0].p > p0 && String(sr.r[0].p).length >= 7, "(d) 미세가격 precision 보존", sr ? `r0=${sr.r[0].p}` : "null");
}
// (e) 캔들 부족 — 6개(완결5) → pivotOnly / 2개(완결1) → null
{
  const c6 = [mk(101, 99, 100), mk(102, 100, 101), mk(103, 101, 102), mk(102, 100, 101), mk(104, 101, 103), mk(103, 102, 102.5)];
  const sr6 = computeSRLevels(c6, 102.5);
  ok(sr6 === null || sr6.m === "pivot", "(e) 완결5개 → pivotOnly", sr6 ? `m=${sr6.m}` : "null(허용)");
  const sr1 = computeSRLevels([mk(101, 99, 100)], 100);
  ok(sr1 === null, "(e) 완결 0~1개 → null");
}
// (f) scaleSR 1/1000 — s/r/piv/px 전부 환산, d 불변
{
  const sr = { s: [{ p: 32000, t: 3, d: -2.1 }], r: [{ p: 34000, t: 2, d: 4.0 }], piv: 33000, px: 32700, m: "cluster" };
  const sc = scaleSR(sr, 1 / 1000);
  ok(sc.s[0].p === 32 && sc.r[0].p === 34 && sc.piv === 33 && sc.px === 32.7, "(f) scaleSR 환산", JSON.stringify(sc));
  ok(sc.s[0].d === -2.1, "(f) d(%) 불변");
}
// (g) 마지막 캔들 스파이크 — 미확정 캔들이 스윙에서 제외되는지
{
  const c = [];
  c.push(...flat(40, 100));
  c.push(mk(101, 99, 100.2), mk(99.8, 98.5, 99), mk(101.2, 99.4, 100)); // 잔잔
  c.push(mk(150, 100, 148)); // ★ 진행 중 캔들의 비정상 스파이크
  const sr = computeSRLevels(c, 100);
  const spikeLeaked = sr && sr.r.some((x) => x.p > 140);
  ok(!spikeLeaked, "(g) 미확정 캔들 스파이크 제외", sr ? JSON.stringify(sr.r) : "null");
}

console.log(fails === 0 ? "\n전체 통과" : `\n${fails}건 실패`);
process.exit(fails === 0 ? 0 : 1);
