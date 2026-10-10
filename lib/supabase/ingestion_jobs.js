// Data access for grey.ingestion_jobs — per-source processing jobs, including bulk creation.
import { createClient } from "./client";
import { isSupabaseConfigured } from "./config";
import { toCamel, toSnakeRow, makeRepo } from "./repository";

const TABLE = "ingestion_jobs";
const columns = [
  "kbId",
  "sourceId",
  "presetSnapshot",
  "status",
  "stage",
  "progress",
  "estimatedCost",
  "actualCost",
  "error",
  "startedAt",
  "finishedAt",
  "metadata",
];

const repo = makeRepo({ table: TABLE, columns });

export const listJobs = (projectId, filters = {}) => repo.list(projectId, filters);

// Bulk-inserts one job per source (e.g. queuing a whole batch at once); returns the created rows.
export async function createJobs(projectId, jobs = []) {
  if (!isSupabaseConfigured() || !projectId || !jobs.length) return [];
  try {
    const rows = jobs.map((job) => ({ ...toSnakeRow(job, columns), project_id: projectId }));
    const { data, error } = await createClient().from(TABLE).insert(rows).select("*");
    if (error) throw error;
    return (data || []).map(toCamel);
  } catch (error) {
    console.error("[ingestion_jobs.createJobs]", error);
    return [];
  }
}

export const updateJob = (id, patch) => repo.update(id, patch);
