import { test } from "node:test";
import assert from "node:assert/strict";
import { abortCodeFor, createLoop } from "../loop.mjs";

const silent = { info() {}, warn() {}, error() {}, child() { return this; } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (check, ms = 2000) => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out");
    await wait(5);
  }
};

function fakeQueue(name, jobs, { run, heartbeat } = {}) {
  const pending = jobs; // shared, so a test can enqueue later
  return {
    name,
    leaseMs: 60_000,
    claimed: [],
    released: [],
    claim: async function () {
      const job = pending.shift() || null;
      if (job) this.claimed.push(job.id);
      return job;
    },
    release: async function (job) {
      this.released.push(job.id);
    },
    heartbeat,
    run: run || (async () => {}),
  };
}

test("heartbeat statuses map to abort codes", () => {
  assert.equal(abortCodeFor("cancelled"), "cancelled");
  assert.equal(abortCodeFor("source_deleted"), "source_deleted");
  assert.equal(abortCodeFor("lost"), "lease_lost");
  assert.equal(abortCodeFor("missing"), "lease_lost");
});

test("never runs more than `concurrency` jobs at once and drains the queue", async () => {
  let running = 0;
  let peak = 0;
  let done = 0;
  const queue = fakeQueue("ingestion", [1, 2, 3, 4, 5].map((id) => ({ id })), {
    run: async () => {
      running += 1;
      peak = Math.max(peak, running);
      await wait(15);
      running -= 1;
      done += 1;
    },
  });
  const loop = createLoop({ queues: [queue], concurrency: 2, pollMs: 1000, log: silent });
  await loop.start();
  await until(() => done === 5);
  assert.equal(peak, 2);
  assert.ok(loop.health().lastTickAt > 0);
  await loop.stop();
});

test("queues are served round-robin", async () => {
  const order = [];
  const a = fakeQueue("a", [{ id: "a1" }, { id: "a2" }], { run: async (job) => order.push(job.id) });
  const b = fakeQueue("b", [{ id: "b1" }, { id: "b2" }], { run: async (job) => order.push(job.id) });
  const loop = createLoop({ queues: [a, b], concurrency: 1, pollMs: 1000, log: silent });
  await loop.start();
  await until(() => order.length === 4);
  assert.deepEqual(order, ["a1", "b1", "a2", "b2"]);
  await loop.stop();
});

test("a heartbeat that reports 'cancelled' aborts the job", async () => {
  let reason = null;
  const queue = fakeQueue("ingestion", [{ id: "j" }], {
    heartbeat: async () => "cancelled",
    run: (_job, { signal }) =>
      new Promise((resolve) => {
        signal.addEventListener("abort", () => {
          reason = signal.reason;
          resolve();
        });
      }),
  });
  const loop = createLoop({ queues: [queue], concurrency: 1, pollMs: 1000, heartbeatMs: 10, log: silent });
  await loop.start();
  await until(() => reason);
  assert.equal(reason.code, "cancelled");
  await loop.stop();
});

test("a failed claim is logged and the loop keeps going", async () => {
  let calls = 0;
  const errors = [];
  const queue = {
    name: "ingestion",
    claim: async () => {
      calls += 1;
      if (calls === 1) throw new Error("db down");
      return null;
    },
    run: async () => {},
  };
  const log = { ...silent, error: (fields) => errors.push(fields) };
  const loop = createLoop({ queues: [queue], concurrency: 1, pollMs: 20, log });
  await loop.start();
  await until(() => calls >= 3);
  assert.equal(errors[0].message, "db down");
  await loop.stop();
});

test("stop drains, then aborts leftovers with 'shutdown'", async () => {
  const reasons = [];
  const queue = fakeQueue("ingestion", [{ id: "slow" }], {
    run: (_job, { signal }) =>
      new Promise((resolve) => {
        signal.addEventListener("abort", () => {
          reasons.push(signal.reason.code);
          resolve();
        });
      }),
  });
  const loop = createLoop({ queues: [queue], concurrency: 1, pollMs: 1000, log: silent });
  await loop.start();
  await until(() => queue.claimed.length === 1);
  await loop.stop({ drainMs: 30, releaseMs: 500 });
  assert.deepEqual(reasons, ["shutdown"]);
  assert.equal(loop.health().active, 0);
  assert.equal(loop.health().stopping, true);
});

test("notifications wake the loop", async () => {
  let notify = null;
  const jobs = [];
  const queue = fakeQueue("ingestion", jobs);
  const loop = createLoop({
    queues: [queue],
    concurrency: 1,
    pollMs: 60_000,
    log: silent,
    listen: async (onNotify) => {
      notify = onNotify;
      return async () => {};
    },
  });
  await loop.start();
  await wait(20);
  jobs.push({ id: "late" });
  notify("ingestion:late");
  await until(() => queue.claimed.includes("late"));
  await loop.stop();
});
