// Queues the loop drains (spec §5.3): ingestion always; eval when lib/engine/eval_runner.js
// exists. The eval runner is imported dynamically so the worker boots (ingestion only) while it
// is missing or broken.
//
// Queue: { name, leaseMs, claim() -> job|null, run(job, { signal }), heartbeat(job) -> status, release(job) }
//
// Eval runner contract (lib/engine/eval_runner.js):
//   claimEvalRun({ admin, workerId, leaseSeconds }) -> eval_runs row | null   (optional; else grey.claim_eval_run)
//   runEvalRun({ admin, run, workerId, signal, log })                          (writes the run's terminal status)
import * as db from "./db.mjs";
import { errorFields } from "./log.mjs";
import { runIngestionJob } from "./ingest/run.mjs";

export function ingestionQueue({ pool, admin, config, log, run = runIngestionJob }) {
  const { workerId, leaseSeconds, maxPerProject } = config;
  return {
    name: "ingestion",
    leaseMs: leaseSeconds * 1000,
    claim: () => db.claimIngestionJob(pool, { workerId, leaseSeconds, maxPerProject }),
    heartbeat: (job) => db.heartbeatIngestionJob(pool, { jobId: job.id, workerId, leaseSeconds }),
    release: (job) => db.releaseIngestionJob(pool, { jobId: job.id, workerId, status: "queued", refundAttempt: true }),
    run: (job, { signal }) => run(job, { pool, admin, log, signal, workerId, config }),
  };
}

export async function evalQueue({ pool, admin, config, log, importRunner = () => import("../lib/engine/eval_runner.js") }) {
  let mod;
  try {
    mod = await importRunner();
  } catch (err) {
    log.info({ reason: err?.code || err?.name || "import_failed", ...(err?.code === "ERR_MODULE_NOT_FOUND" ? {} : errorFields(err)) }, "eval queue disabled");
    return null;
  }
  if (typeof mod?.runEvalRun !== "function") {
    log.info({ reason: "runEvalRun_missing" }, "eval queue disabled");
    return null;
  }
  const { workerId, evalLeaseSeconds: leaseSeconds } = config;
  const claim =
    typeof mod.claimEvalRun === "function"
      ? () => mod.claimEvalRun({ admin, workerId, leaseSeconds })
      : () => db.claimEvalRun(pool, { workerId, leaseSeconds });
  return {
    name: "eval",
    leaseMs: leaseSeconds * 1000,
    claim,
    heartbeat: (run) => db.heartbeatEvalRun(pool, { runId: run.id, workerId, leaseSeconds }),
    release: (run) => db.releaseEvalRun(pool, { runId: run.id, workerId }),
    run: async (run, { signal }) => {
      try {
        await mod.runEvalRun({ admin, run, workerId, signal, log: log.child({ evalRunId: run.id, projectId: run.project_id }) });
      } finally {
        // Shutdown hands the run back without counting the attempt (no-op if it already finished).
        if (signal.aborted && signal.reason?.code === "shutdown") {
          await db.releaseEvalRun(pool, { runId: run.id, workerId }).catch(() => {});
        }
      }
    },
  };
}

export async function createQueues(options) {
  const queues = [ingestionQueue(options)];
  const evals = await evalQueue(options);
  if (evals) queues.push(evals);
  return queues;
}
