import { test } from "node:test";
import assert from "node:assert/strict";
import { evalQueue, ingestionQueue } from "../queues.mjs";
import { JobAbort } from "../loop.mjs";

const silent = { info() {}, warn() {}, error() {}, child() { return this; } };
const config = { workerId: "w1", leaseSeconds: 120, maxPerProject: 2, evalLeaseSeconds: 300 };

test("ingestion queue claims through grey.claim_ingestion_job with the worker's lease settings", async () => {
  const queries = [];
  const pool = { query: async (sql, params) => (queries.push({ sql, params }), { rows: [{ id: "j1" }] }) };
  const q = ingestionQueue({ pool, admin: {}, config, log: silent });
  assert.equal(q.name, "ingestion");
  assert.equal(q.leaseMs, 120_000);
  assert.deepEqual(await q.claim(), { id: "j1" });
  assert.match(queries[0].sql, /grey\.claim_ingestion_job\(\$1, \$2, \$3\)/);
  assert.deepEqual(queries[0].params, ["w1", 120, 2]);
});

test("a missing eval runner disables the eval queue instead of failing boot", async () => {
  const q = await evalQueue({ pool: {}, admin: {}, config, log: silent, importRunner: async () => { throw Object.assign(new Error("nope"), { code: "ERR_MODULE_NOT_FOUND" }); } });
  assert.equal(q, null);
  const noRun = await evalQueue({ pool: {}, admin: {}, config, log: silent, importRunner: async () => ({}) });
  assert.equal(noRun, null);
});

test("eval queue uses the runner's claim and releases on shutdown", async () => {
  const calls = [];
  const pool = { query: async (sql, params) => (calls.push({ sql, params }), { rows: [{ ok: true, status: "running" }] }) };
  const runner = {
    claimEvalRun: async (args) => (calls.push({ claim: args }), { id: "e1", project_id: "p1" }),
    runEvalRun: async ({ signal }) => {
      calls.push({ run: true });
      return { status: signal.aborted ? "aborted" : "completed" };
    },
  };
  const q = await evalQueue({ pool, admin: { a: 1 }, config, log: silent, importRunner: async () => runner });
  const run = await q.claim();
  assert.deepEqual(calls[0].claim, { admin: { a: 1 }, workerId: "w1", leaseSeconds: 300 });
  const controller = new AbortController();
  controller.abort(new JobAbort("shutdown"));
  await q.run(run, { signal: controller.signal });
  assert.match(calls.at(-1).sql, /grey\.release_eval_run/);
  assert.equal(await q.heartbeat(run), "running");
});
