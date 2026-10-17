// Grey worker (spec §5): ingestion + eval runs. Plain Node 24, host-agnostic.
//   node --env-file=.env worker/index.mjs      (npm run worker)
// Boot: env check -> pg pool (WORKER_DATABASE_URL, session pooler) -> service-role Supabase
// client (schema grey) -> /healthz -> queue loop. SIGTERM/SIGINT: stop claiming, drain up to
// 25 s, release what's left, exit.
import http from "node:http";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { readConfig } from "./env.mjs";
import { createLogger, errorFields } from "./log.mjs";
import { createClient, createPool, deleteOrphanStagedChunks } from "./db.mjs";
import { createLoop, createPgListener } from "./loop.mjs";
import { createQueues } from "./queues.mjs";

const HEALTH_STALE_MS = 60_000;
const JANITOR_MS = 10 * 60_000;

const log = createLogger();
const config = readConfig();

if (config.missing.length) {
  log.fatal({ missing: config.missing }, "missing required environment variables");
  process.exit(1);
}
if (!config.listen) {
  log.warn("WORKER_DATABASE_URL uses the transaction pooler (port 6543), which can't LISTEN — polling only. Use the session pooler (port 5432).");
}

const pool = createPool(config.databaseUrl, { max: config.concurrency + 4 });
pool.on("error", (err) => log.error(errorFields(err), "idle database client error"));

const admin = createSupabaseClient(config.supabaseUrl, config.serviceRoleKey, {
  db: { schema: "grey" },
  auth: { persistSession: false, autoRefreshToken: false },
});

try {
  await pool.query("select 1");
} catch (err) {
  log.fatal(errorFields(err), "database unreachable");
  process.exit(1);
}

const queues = await createQueues({ pool, admin, config, log });

const loop = createLoop({
  queues,
  concurrency: config.concurrency,
  pollMs: config.pollMs,
  log,
  listen: config.listen ? createPgListener({ connect: () => createClient(config.databaseUrl), log }) : null,
  janitor: {
    intervalMs: JANITOR_MS,
    run: async () => {
      const deleted = await deleteOrphanStagedChunks(pool);
      if (deleted) log.info({ deleted }, "janitor removed staged chunks");
    },
  },
});

const withTimeout = (promise, ms) =>
  Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms).unref())]);

const server = http.createServer(async (req, res) => {
  if (req.method !== "GET" || !req.url?.startsWith("/healthz")) {
    res.writeHead(404).end();
    return;
  }
  const health = loop.health();
  let dbOk = false;
  try {
    await withTimeout(pool.query("select 1"), 2000);
    dbOk = true;
  } catch {
    dbOk = false;
  }
  const ticking = Date.now() - health.lastTickAt < HEALTH_STALE_MS;
  const ok = dbOk && ticking && !health.stopping;
  res.writeHead(ok ? 200 : 503, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify({ ok, db: dbOk, ticking, active: health.active, stopping: health.stopping }));
});
server.listen(config.healthPort, () => log.info({ port: server.address()?.port }, "health endpoint listening"));

await loop.start();
log.info({ workerId: config.workerId, concurrency: config.concurrency, queues: queues.map((q) => q.name), listen: config.listen }, "worker started");

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info({ signal }, "shutting down");
  try {
    await loop.stop({ drainMs: 25_000 });
  } catch (err) {
    log.error(errorFields(err), "shutdown error");
  }
  server.close();
  await pool.end().catch(() => {});
  log.info("worker stopped");
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("unhandledRejection", (err) => log.error(errorFields(err), "unhandled rejection"));
