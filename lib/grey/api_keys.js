import { randomBytes, createHash } from "node:crypto";

const BASE62 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const KEY_LENGTH = 32;
const PREFIX_LENGTH = 12;

// Rejection sampling keeps the base62 alphabet unbiased (256 % 62 !== 0).
function randomBase62(length) {
  let out = "";
  while (out.length < length) {
    const bytes = randomBytes(length - out.length);
    for (const byte of bytes) {
      if (byte < 248) out += BASE62[byte % 62]; // 248 = 4 * 62, keeps the mapping uniform
      if (out.length === length) break;
    }
  }
  return out;
}

// "gk_live_" + 32 random base62 chars; prefix is the first 12 chars (stored for lookup/display).
export function generateApiKey() {
  const key = `gk_live_${randomBase62(KEY_LENGTH)}`;
  return { key, prefix: key.slice(0, PREFIX_LENGTH) };
}

export function hashApiKey(key) {
  return createHash("sha256").update(key).digest("hex");
}
