import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_RATE_LIMIT_PER_MIN,
  evaluateKey,
  extractBearerToken,
  isApiKeyFormat,
  keyRateLimit,
  parseRateLimitResult,
  rateLimitHeaders,
  retryAfterSeconds,
  shouldTouchLastUsed,
} from "./api_key_eval.js";

const NOW = Date.parse("2026-10-18T12:00:00Z");
const PROJECT = "11111111-1111-4111-8111-111111111111";
const PIPELINE = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";

const key = (overrides = {}) => ({
  id: "44444444-4444-4444-8444-444444444444",
  project_id: PROJECT,
  scopes: ["retrieve", "chat"],
  pipeline_ids: [],
  rate_limit_per_min: 60,
  expires_at: null,
  revoked_at: null,
  deleted_at: null,
  ...overrides,
});

test("bearer extraction", () => {
  assert.equal(extractBearerToken("Bearer gk_live_abc"), "gk_live_abc");
  assert.equal(extractBearerToken("bearer  gk_live_abc "), "gk_live_abc");
  assert.equal(extractBearerToken("Basic abc"), null);
  assert.equal(extractBearerToken("Bearer a b"), null);
  assert.equal(extractBearerToken(null), null);
});

test("api key format", () => {
  assert.equal(isApiKeyFormat(`gk_live_${"a".repeat(32)}`), true);
  assert.equal(isApiKeyFormat(`gk_live_${"a".repeat(31)}`), false);
  assert.equal(isApiKeyFormat("sk-123"), false);
});

test("a valid key with the scope passes", () => {
  assert.deepEqual(evaluateKey(key(), { scope: "chat", now: NOW }), { ok: true });
  assert.deepEqual(evaluateKey(key(), { now: NOW }), { ok: true });
});

test("unknown, revoked and expired keys are 401s", () => {
  assert.equal(evaluateKey(null, { now: NOW }).code, "invalid_api_key");
  assert.equal(evaluateKey(key({ deleted_at: "2026-01-01" }), { now: NOW }).code, "invalid_api_key");
  const revoked = evaluateKey(key({ revoked_at: "2026-10-01T00:00:00Z" }), { now: NOW });
  assert.equal(revoked.status, 401);
  assert.equal(revoked.code, "api_key_revoked");
  const expired = evaluateKey(key({ expires_at: "2026-10-18T11:59:59Z" }), { now: NOW });
  assert.equal(expired.status, 401);
  assert.equal(expired.code, "api_key_expired");
  assert.deepEqual(evaluateKey(key({ expires_at: "2026-10-19T00:00:00Z" }), { now: NOW }), { ok: true });
});

test("revocation wins over expiry", () => {
  const r = evaluateKey(key({ revoked_at: "2026-10-01", expires_at: "2026-10-02" }), { now: NOW });
  assert.equal(r.code, "api_key_revoked");
});

test("missing scope is a 403", () => {
  const r = evaluateKey(key({ scopes: ["retrieve"] }), { scope: "mcp", now: NOW });
  assert.equal(r.status, 403);
  assert.equal(r.code, "insufficient_scope");
});

test("project mismatch and pipelines outside the allow-list are 404s", () => {
  const wrongProject = evaluateKey(key(), { projectId: OTHER, scope: "chat", now: NOW });
  assert.equal(wrongProject.status, 404);
  const restricted = key({ pipeline_ids: [OTHER] });
  assert.equal(evaluateKey(restricted, { pipelineId: PIPELINE, now: NOW }).status, 404);
  assert.deepEqual(evaluateKey(restricted, { pipelineId: OTHER, now: NOW }), { ok: true });
  // An empty list means every pipeline in the project.
  assert.deepEqual(evaluateKey(key(), { pipelineId: PIPELINE, now: NOW }), { ok: true });
});

test("404 comes before scope so another project's key learns nothing", () => {
  const r = evaluateKey(key({ scopes: [] }), { projectId: OTHER, scope: "mcp", now: NOW });
  assert.equal(r.status, 404);
});

test("bound key mismatch is a 403", () => {
  const r = evaluateKey(key({ scopes: ["mcp"] }), { requiredKeyId: OTHER, scope: "mcp", now: NOW });
  assert.equal(r.status, 403);
  assert.equal(r.code, "key_not_bound");
  assert.deepEqual(evaluateKey(key({ scopes: ["mcp"] }), { requiredKeyId: key().id, scope: "mcp", now: NOW }), { ok: true });
});

test("rate limit defaults and last-used throttling", () => {
  assert.equal(keyRateLimit(key({ rate_limit_per_min: 120 })), 120);
  assert.equal(keyRateLimit(key({ rate_limit_per_min: null })), DEFAULT_RATE_LIMIT_PER_MIN);
  assert.equal(keyRateLimit(null), DEFAULT_RATE_LIMIT_PER_MIN);
  assert.equal(shouldTouchLastUsed(null, NOW), true);
  assert.equal(shouldTouchLastUsed(new Date(NOW - 30_000).toISOString(), NOW), false);
  assert.equal(shouldTouchLastUsed(new Date(NOW - 61_000).toISOString(), NOW), true);
});

test("rate-limit RPC results, headers and Retry-After", () => {
  const resetAt = "2026-10-18T12:01:00Z";
  const decision = parseRateLimitResult([{ allowed: false, hits: 61, remaining: 0, reset_at: resetAt }], 60);
  assert.deepEqual(decision, { allowed: false, limit: 60, remaining: 0, resetAt: Date.parse(resetAt) });
  assert.equal(parseRateLimitResult([], 60), null);
  assert.equal(parseRateLimitResult(null, 60), null);
  assert.deepEqual(rateLimitHeaders(decision), {
    "X-RateLimit-Limit": "60",
    "X-RateLimit-Remaining": "0",
    "X-RateLimit-Reset": String(Date.parse(resetAt) / 1000),
  });
  assert.deepEqual(rateLimitHeaders(null), {});
  assert.equal(retryAfterSeconds(Date.parse(resetAt), NOW), 60);
  assert.equal(retryAfterSeconds(NOW - 5, NOW), 1);
  assert.equal(retryAfterSeconds(null, NOW), 60);
});
