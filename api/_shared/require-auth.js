// api/_shared/require-auth.js
// ════════════════════════════════════════════════════════════════════
// 서버측 인증 게이트 — 클라이언트가 보낸 userId 대신 *검증된* Supabase user id 사용.
//   레거시 감사 F-1 대응: 기존엔 모든 엔드포인트가 req.query/body 의 userId 를
//   무검증 신뢰 → 임의 UUID 로 남의 포지션 청산/주문 가능(IDOR). 이를 차단.
//
// 검증 방식: Supabase 액세스 토큰(JWT, HS256)을 SUPABASE_JWT_SECRET 으로 *로컬* 검증
//   (네트워크 호출 0, 빠름). 토큰은 클라이언트가 Authorization: Bearer 로 전송.
//
// ★ 안전 롤아웃 (대표 락아웃 방지):
//   - 기본 = soft 모드: 차단하지 않고 토큰 검증 결과만 로깅(현행 동작 100% 유지).
//   - ZEPTA_AUTH_ENFORCE=1 (+ SUPABASE_JWT_SECRET 설정) 시 hard 모드:
//       토큰 없음/검증실패 → 401, 토큰의 user 와 다른 userId 요청 → 403.
//   - 문제 시 ZEPTA_AUTH_ENFORCE 만 끄면 즉시 복구. 배포 자체는 무위험.
// ════════════════════════════════════════════════════════════════════

import crypto from "crypto";

const JWT_SECRET = process.env.SUPABASE_JWT_SECRET || "";
const ENFORCE = process.env.ZEPTA_AUTH_ENFORCE === "1";

function b64urlToBuf(s) {
  return Buffer.from(String(s).replace(/-/g, "+").replace(/_/g, "/"), "base64");
}
function b64url(buf) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Supabase 액세스 토큰 검증 → { id, role } 또는 null
export function verifyToken(token) {
  if (!token || !JWT_SECRET) return null;
  try {
    const parts = String(token).split(".");
    if (parts.length !== 3) return null;
    const [h, p, sig] = parts;
    const expected = b64url(crypto.createHmac("sha256", JWT_SECRET).update(`${h}.${p}`).digest());
    const a = Buffer.from(sig), b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null; // 서명 불일치
    const payload = JSON.parse(b64urlToBuf(p).toString("utf8"));
    if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) return null; // 만료
    return { id: payload.sub, role: payload.role };
  } catch { return null; }
}

function bearer(req) {
  const h = req.headers?.authorization || req.headers?.Authorization || "";
  return typeof h === "string" && h.startsWith("Bearer ") ? h.slice(7) : "";
}

/**
 * 엔드포인트 진입 가드.
 * @returns {string|false|undefined} 사용할 userId. false = 인증 거부(응답 이미 전송, 즉시 return).
 *   soft 모드에선 claimedId 를 그대로 반환(현행 유지).
 */
export function gateUser(req, res, claimedId) {
  const token = bearer(req);
  const verified = verifyToken(token);
  if (ENFORCE) {
    if (!verified?.id) {
      res.status(401).json({ error: "unauthorized — 유효한 세션 토큰이 필요합니다." });
      return false;
    }
    if (claimedId && claimedId !== verified.id) {
      res.status(403).json({ error: "forbidden — 토큰과 다른 userId 입니다." });
      return false;
    }
    return verified.id;
  }
  // soft 모드 — 차단 안 함. 토큰 흐름·검증 결과 로깅(enforce 전환 전 확인용).
  if (token) {
    console.log(`[auth] soft: ${verified?.id ? `verified ${verified.id}` : "verify FAILED"} (claimed=${claimedId || "none"})`);
  } else {
    console.log(`[auth] soft: no token (claimed=${claimedId || "none"})`);
  }
  return claimedId;
}

export default { verifyToken, gateUser };
