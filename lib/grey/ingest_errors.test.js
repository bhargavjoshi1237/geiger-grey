import { test } from "node:test";
import assert from "node:assert/strict";
import { JobError, retryDelayMs, retryDecision, toJobError, isRetryableStatus, BACKOFF_MAX_MS } from "./ingest_errors.js";

class EngineError extends Error {
  constructor(code, message, { retryable = false } = {}) {
    super(message);
    this.code = code;
    this.retryable = retryable;
  }
}

test("JobError carries code, message and retryable", () => {
  const e = new JobError("corrupt_file", "This file looks corrupt.");
  assert.equal(e.code, "corrupt_file");
  assert.equal(e.message, "This file looks corrupt.");
  assert.equal(e.retryable, false);
  assert.ok(e instanceof Error);
  assert.equal(new JobError("x", "y", { retryable: true }).retryable, true);
});

test("backoff doubles from 30s and caps at 15 minutes", () => {
  const mid = () => 0.5; // zero jitter
  assert.equal(retryDelayMs(0, { random: mid }), 30_000);
  assert.equal(retryDelayMs(1, { random: mid }), 60_000);
  assert.equal(retryDelayMs(3, { random: mid }), 240_000);
  assert.equal(retryDelayMs(20, { random: mid }), BACKOFF_MAX_MS);
});

test("backoff jitter stays within ±20%", () => {
  assert.equal(retryDelayMs(1, { random: () => 0 }), 48_000);
  assert.equal(retryDelayMs(1, { random: () => 1 }), 72_000);
});

test("EngineError maps one-to-one", () => {
  const mapped = toJobError(new EngineError("rate_limited", "Slow down", { retryable: true }));
  assert.equal(mapped.code, "rate_limited");
  assert.equal(mapped.retryable, true);
  const auth = toJobError(new EngineError("provider_auth", "Key rejected"));
  assert.equal(auth.retryable, false);
  // transient codes retry even when the thrower didn't flag them
  assert.equal(toJobError(new EngineError("provider_unavailable", "Down")).retryable, true);
  assert.equal(toJobError(new EngineError("rate_limited", "Slow")).retryable, true);
});

test("network and HTTP failures map to retryable/permanent", () => {
  assert.equal(toJobError(Object.assign(new Error("x"), { code: "ECONNRESET" })).retryable, true);
  assert.equal(toJobError(new TypeError("fetch failed")).retryable, true);
  assert.equal(toJobError(Object.assign(new Error("x"), { status: 503 })).retryable, true);
  assert.equal(toJobError(Object.assign(new Error("x"), { status: 404 })).retryable, false);
  assert.equal(toJobError(new Error("boom")).code, "internal");
  assert.equal(toJobError(new Error("boom")).retryable, false);
});

test("unknown errors never leak their raw message", () => {
  const mapped = toJobError(new Error("secret document text"));
  assert.ok(!mapped.message.includes("secret"));
});

test("retryable statuses", () => {
  for (const s of [408, 429, 500, 502, 503]) assert.equal(isRetryableStatus(s), true);
  for (const s of [400, 401, 403, 404, 422]) assert.equal(isRetryableStatus(s), false);
});

test("retry decision honours max attempts", () => {
  const err = new JobError("network", "n", { retryable: true });
  assert.equal(retryDecision(err, { attempts: 1, maxAttempts: 3 }).action, "retry");
  assert.equal(retryDecision(err, { attempts: 3, maxAttempts: 3 }).action, "fail");
  assert.equal(retryDecision(new JobError("bad", "b"), { attempts: 1, maxAttempts: 3 }).action, "fail");
});
