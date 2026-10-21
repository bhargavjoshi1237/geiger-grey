// Postgres access for the worker: a pool on WORKER_DATABASE_URL (session pooler, port 5432)
// and every SQL statement the worker runs. Queue state changes go through the service-role
// functions from supabase/migrations/20261018120100_worker_queue.sql; every write to a job is
// guarded on this worker still holding its lease.
import { readFileSync } from "node:fs";
import pg from "pg";
import { createLogger } from "./log.mjs";

let warnedUnverifiedTls = false;

// WORKER_DATABASE_CA: the database server's CA certificate (Supabase: Database settings → SSL
// certificate), as a PEM string (literal "\n" escapes allowed) or a path to a PEM file.
export function readCa(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (raw.includes("-----BEGIN")) return raw.replace(/\\n/g, "\n");
  try {
    return readFileSync(raw, "utf8");
  } catch (err) {
    throw new Error(`WORKER_DATABASE_CA: can't read the CA file (${err.code || "error"}).`);
  }
}

// With a CA the server certificate is verified; without one TLS still encrypts but doesn't
// verify (Supabase poolers have no public CA chain, matching geiger-orm) — warned once.
function tlsOptions(caValue) {
  const ca = readCa(caValue);
  if (ca) return { ca, rejectUnauthorized: true };
  if (!warnedUnverifiedTls) {
    warnedUnverifiedTls = true;
    createLogger().warn("WORKER_DATABASE_CA is not set: database TLS is encrypted but the server certificate isn't verified.");
  }
  return { rejectUnauthorized: false };
}

// pg lets sslmode in the URL override the explicit `ssl` option (and treats `require` as
// verify-full), so it's stripped and TLS is configured here.
export function poolConfig(url, { max = 10, ca = process.env.WORKER_DATABASE_CA } = {}) {
  const parsed = new URL(url);
  parsed.searchParams.delete("sslmode");
  const local = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  return {
    connectionString: parsed.toString(),
    ssl: local ? false : tlsOptions(ca),
    max,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    application_name: "grey-worker",
  };
}

export function createPool(url, options) {
  return new pg.Pool(poolConfig(url, options));
}

// Dedicated connection for LISTEN (a pooled client can't hold a subscription).
export function createClient(url) {
  const { connectionString, ssl, connectionTimeoutMillis } = poolConfig(url);
  return new pg.Client({ connectionString, ssl, connectionTimeoutMillis, application_name: "grey-worker-listen" });
}

const first = (result) => result.rows[0] || null;

// ---------------------------------------------------------------------------
// Queue functions
// ---------------------------------------------------------------------------

export async function claimIngestionJob(db, { workerId, leaseSeconds, maxPerProject }) {
  return first(await db.query("select * from grey.claim_ingestion_job($1, $2, $3)", [workerId, leaseSeconds, maxPerProject]));
}

export async function heartbeatIngestionJob(db, { jobId, workerId, leaseSeconds }) {
  return first(await db.query("select grey.heartbeat_ingestion_job($1, $2, $3) as status", [jobId, workerId, leaseSeconds]))?.status;
}

// status: queued | succeeded | failed | cancelled. -> true when written (lease still held).
export async function releaseIngestionJob(db, { jobId, workerId, status, error = null, delaySeconds = 0, refundAttempt = false, metadata = null }) {
  const row = first(
    await db.query("select grey.release_ingestion_job($1, $2, $3, $4, $5, $6, $7::jsonb) as ok", [
      jobId,
      workerId,
      status,
      error,
      Math.max(0, Math.round(delaySeconds)),
      refundAttempt,
      metadata ? JSON.stringify(metadata) : null,
    ]),
  );
  return Boolean(row?.ok);
}

export async function swapSourceChunks(db, { jobId, workerId }) {
  return Number(first(await db.query("select grey.swap_source_chunks($1, $2) as n", [jobId, workerId]))?.n || 0);
}

export async function claimEvalRun(db, { workerId, leaseSeconds, maxPerProject = 1 }) {
  return first(await db.query("select * from grey.claim_eval_run($1, $2, $3)", [workerId, leaseSeconds, maxPerProject]));
}

export async function heartbeatEvalRun(db, { runId, workerId, leaseSeconds }) {
  return first(await db.query("select grey.heartbeat_eval_run($1, $2, $3) as status", [runId, workerId, leaseSeconds]))?.status;
}

export async function releaseEvalRun(db, { runId, workerId, refundAttempt = true }) {
  return Boolean(first(await db.query("select grey.release_eval_run($1, $2, $3) as ok", [runId, workerId, refundAttempt]))?.ok);
}

// ---------------------------------------------------------------------------
// Job progress (guarded). Returns { ok, sourceDeleted }: ok=false means the lease was lost or
// the job was cancelled — the caller must stop.
// ---------------------------------------------------------------------------

export async function updateJobProgress(db, { jobId, workerId, stage, progress, metadata = null }) {
  const row = first(
    await db.query(
      `update grey.ingestion_jobs j
          set stage = coalesce($3, j.stage),
              progress = coalesce($4, j.progress),
              metadata = j.metadata || coalesce($5::jsonb, '{}'::jsonb)
        where j.id = $1 and j.locked_by = $2 and j.status = 'running'
       returning (select s.deleted_at is not null from grey.sources s where s.id = j.source_id) as source_deleted`,
      [jobId, workerId, stage ?? null, progress == null ? null : Math.max(0, Math.min(100, Math.round(progress))), metadata ? JSON.stringify(metadata) : null],
    ),
  );
  return { ok: Boolean(row), sourceDeleted: Boolean(row?.source_deleted) };
}

export async function setJobEstimatedCost(db, { jobId, workerId, estimatedCost }) {
  await db.query(
    `update grey.ingestion_jobs set estimated_cost = coalesce(estimated_cost, $3)
      where id = $1 and locked_by = $2 and status = 'running'`,
    [jobId, workerId, estimatedCost],
  );
}

// ---------------------------------------------------------------------------
// Sources and knowledge bases — every read and write is scoped to the job's project.
// ---------------------------------------------------------------------------

export async function loadSource(db, sourceId, projectId) {
  return first(await db.query("select * from grey.sources where id = $1 and project_id = $2", [sourceId, projectId]));
}

export async function loadKnowledgeBase(db, kbId, projectId) {
  return first(await db.query("select * from grey.knowledge_bases where id = $1 and project_id = $2", [kbId, projectId]));
}

export async function setSourceStatus(db, { sourceId, projectId, status }) {
  await db.query("update grey.sources set status = $3 where id = $1 and project_id = $2 and deleted_at is null", [sourceId, projectId, status]);
}

// After the swap: counts and provenance. `ingest` is merged into metadata.ingest.
export async function finishSource(db, { sourceId, projectId, chunkCount, tokenCount, pageCount, durationMs, contentHash, ingest }) {
  await db.query(
    `update grey.sources
        set status = 'ready',
            chunk_count = $3,
            token_count = $4,
            page_count = coalesce($5, page_count),
            duration_ms = coalesce($6, duration_ms),
            content_hash = coalesce($7, content_hash),
            metadata = metadata || jsonb_build_object('ingest', $8::jsonb)
      where id = $1 and project_id = $2 and deleted_at is null`,
    [sourceId, projectId, chunkCount, tokenCount, pageCount ?? null, durationMs ?? null, contentHash ?? null, JSON.stringify(ingest || {})],
  );
}

// Final source status when a job ends without a swap: ready while live chunks exist,
// otherwise `fallback` ('failed' after an error, 'pending' after a cancel).
export async function settleSourceStatus(db, { sourceId, projectId, fallback }) {
  await db.query(
    `update grey.sources s
        set status = case when exists (
              select 1 from grey.chunks c
               where c.source_id = s.id and c.project_id = s.project_id and c.state = 'live' and c.deleted_at is null
            ) then 'ready' else $3 end
      where s.id = $1 and s.project_id = $2 and s.deleted_at is null`,
    [sourceId, projectId, fallback],
  );
}

// Just the ids (no key) — enough to tell whether enrichment output would change.
export async function processingModelSettings(db, projectId) {
  const row = first(
    await db.query(
      "select processing_provider_id, processing_model from grey.project_settings where project_id = $1 and deleted_at is null",
      [projectId],
    ),
  );
  return row?.processing_provider_id ? { providerId: row.processing_provider_id, model: row.processing_model || null } : null;
}

export async function jobStatus(db, jobId) {
  return first(await db.query("select status from grey.ingestion_jobs where id = $1", [jobId]))?.status || null;
}

// ---------------------------------------------------------------------------
// Chunks
// ---------------------------------------------------------------------------

export async function stagedOrdinals(db, jobId) {
  const { rows } = await db.query("select ordinal from grey.chunks where job_id = $1 and state = 'staged'", [jobId]);
  return new Set(rows.map((r) => Number(r.ordinal)));
}

export async function deleteStagedChunks(db, jobId) {
  await db.query("delete from grey.chunks where job_id = $1 and state = 'staged'", [jobId]);
}

const CHUNK_COLUMNS = [
  "project_id",
  "kb_id",
  "source_id",
  "job_id",
  "state",
  "ordinal",
  "content",
  "token_count",
  "page",
  "start_ms",
  "end_ms",
  "heading_path",
  "metadata",
  "search_text",
  "embedding",
  "embedding_dims",
  "embedding_model",
  "modality",
];
const CHUNK_CASTS = { heading_path: "::text[]", metadata: "::jsonb", embedding: "::public.halfvec" };

// rows: [{ ordinal, content, token_count, page, start_ms, end_ms, heading_path, metadata, search_text, embedding /* pg vector string */, embedding_dims, embedding_model, modality? }]
// modality: 'image' for an image source's chunk, 'text' (the default) for everything else.
// Re-inserting an ordinal that is already staged for this job is a no-op (retry-safe).
export async function insertStagedChunks(db, { projectId, kbId, sourceId, jobId, rows }) {
  if (!rows.length) return 0;
  const values = [];
  const tuples = rows.map((row) => {
    const record = {
      project_id: projectId,
      kb_id: kbId,
      source_id: sourceId,
      job_id: jobId,
      state: "staged",
      ordinal: row.ordinal,
      content: row.content,
      token_count: row.token_count ?? null,
      page: row.page ?? null,
      start_ms: row.start_ms ?? null,
      end_ms: row.end_ms ?? null,
      heading_path: row.heading_path?.length ? row.heading_path : null,
      metadata: JSON.stringify(row.metadata || {}),
      search_text: row.search_text ?? null,
      embedding: row.embedding ?? null,
      embedding_dims: row.embedding_dims ?? null,
      embedding_model: row.embedding_model ?? null,
      modality: row.modality || "text",
    };
    const placeholders = CHUNK_COLUMNS.map((column) => {
      values.push(record[column]);
      return `$${values.length}${CHUNK_CASTS[column] || ""}`;
    });
    return `(${placeholders.join(", ")})`;
  });
  const result = await db.query(
    `insert into grey.chunks (${CHUNK_COLUMNS.join(", ")}) values ${tuples.join(", ")}
     on conflict (job_id, ordinal) where state = 'staged' do nothing`,
    values,
  );
  return result.rowCount || 0;
}

// Live chunk rows in the shape extractGraph() expects (the job's project only).
export async function liveChunks(db, sourceId, projectId) {
  const { rows } = await db.query(
    `select id, ordinal, content, page, start_ms, token_count
       from grey.chunks
      where source_id = $1 and project_id = $2 and state = 'live' and deleted_at is null
      order by ordinal`,
    [sourceId, projectId],
  );
  return rows;
}

export async function liveChunkStats(db, sourceId, projectId) {
  const row = first(
    await db.query(
      `select count(*)::int as n, coalesce(sum(token_count), 0)::int as tokens
         from grey.chunks where source_id = $1 and project_id = $2 and state = 'live' and deleted_at is null`,
      [sourceId, projectId],
    ),
  );
  return { count: row?.n || 0, tokens: row?.tokens || 0 };
}

// Janitor: staged chunks whose job ended (failed/cancelled/succeeded), was deleted, or is gone.
export async function deleteOrphanStagedChunks(db) {
  const result = await db.query(
    `delete from grey.chunks c
      where c.state = 'staged'
        and (
          c.job_id is null
          or exists (
            select 1 from grey.ingestion_jobs j
             where j.id = c.job_id
               and (j.status in ('failed', 'cancelled', 'succeeded') or j.deleted_at is not null)
          )
        )`,
  );
  return result.rowCount || 0;
}

// ---------------------------------------------------------------------------
// Usage (one row per job + kind; spec §11)
// ---------------------------------------------------------------------------

// merge: 'first' keeps the existing row, 'add' accumulates quantity and cost.
export async function upsertJobUsage(db, { projectId, jobId, event, merge = "first" }) {
  const conflict =
    merge === "add"
      ? `do update set quantity = grey.usage_events.quantity + excluded.quantity,
                       cost = grey.usage_events.cost + excluded.cost,
                       metadata = grey.usage_events.metadata || excluded.metadata`
      : "do nothing";
  await db.query(
    `insert into grey.usage_events (project_id, kind, quantity, unit_cost, cost, ref_type, ref_id, metadata)
     values ($1, $2, $3, $4, $5, 'ingestion_job', $6, $7::jsonb)
     on conflict (ref_id, kind) where ref_type = 'ingestion_job' ${conflict}`,
    [projectId, event.kind, event.quantity, event.unitCost ?? 0, event.cost ?? 0, jobId, JSON.stringify(event.metadata || {})],
  );
}

// ---------------------------------------------------------------------------
// Suite imports
// ---------------------------------------------------------------------------

export async function loadNotesBoard(db, { boardId, projectId }) {
  return first(
    await db.query(
      `select id, name, description, nodes, edges
         from notes.project_boards
        where id = $1 and project_id = $2 and deleted_at is null`,
      [boardId, projectId],
    ),
  );
}
