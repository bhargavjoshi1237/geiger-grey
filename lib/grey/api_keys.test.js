import { test } from "node:test";
import assert from "node:assert/strict";
import { generateApiKey, hashApiKey } from "./api_keys.js";

test("key format and prefix", () => {
  const { key, prefix } = generateApiKey();
  assert.match(key, /^gk_live_[A-Za-z0-9]{32}$/);
  assert.equal(prefix, key.slice(0, 12));
});
test("keys are unique and hashes stable", () => {
  const a = generateApiKey().key, b = generateApiKey().key;
  assert.notEqual(a, b);
  assert.equal(hashApiKey(a), hashApiKey(a));
  assert.match(hashApiKey(a), /^[0-9a-f]{64}$/);
});
