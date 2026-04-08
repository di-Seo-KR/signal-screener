// AES-256-GCM 암호화 유틸 (바이낸스 API 키 보관용)
// 환경변수: ENCRYPTION_KEY (64자 hex = 32 bytes)
//
// 사용법:
//   import { encrypt, decrypt } from "../_shared/encryption.js";
//   const cipher = encrypt("my-secret");        // → "iv:tag:ciphertext" (hex)
//   const plain  = decrypt(cipher);             // → "my-secret"

import crypto from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_LEN = 12; // GCM 권장

function getKey() {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex) {
    throw new Error("ENCRYPTION_KEY env var is not set (64 hex chars required)");
  }
  if (hex.length !== 64) {
    throw new Error(`ENCRYPTION_KEY must be 64 hex chars (got ${hex.length})`);
  }
  return Buffer.from(hex, "hex");
}

export function encrypt(plaintext) {
  if (typeof plaintext !== "string" || plaintext.length === 0) {
    throw new Error("encrypt: plaintext must be a non-empty string");
  }
  const key = getKey();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${enc.toString("hex")}`;
}

export function decrypt(payload) {
  if (typeof payload !== "string") {
    throw new Error("decrypt: payload must be a string");
  }
  const parts = payload.split(":");
  if (parts.length !== 3) {
    throw new Error("decrypt: invalid payload format");
  }
  const key = getKey();
  const iv = Buffer.from(parts[0], "hex");
  const tag = Buffer.from(parts[1], "hex");
  const enc = Buffer.from(parts[2], "hex");
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return dec.toString("utf8");
}

// 키의 마지막 4자리만 노출 (UI 표시용)
export function maskKey(key) {
  if (typeof key !== "string" || key.length < 8) return "****";
  return `${key.slice(0, 4)}••••${key.slice(-4)}`;
}
