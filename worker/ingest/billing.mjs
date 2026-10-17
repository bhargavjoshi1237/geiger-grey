// Ingestion metering writes (spec §11): one usage_events row per (job, kind). The pure rules
// (prices, BYOK, merge mode) live in lib/grey/billing.js; this only persists them.
import { USAGE_MERGE } from "../../lib/grey/billing.js";
import { upsertJobUsage } from "../db.mjs";

// event: from pageUsage() / byokUsage() / mediaUsage(); null is ignored.
export async function recordJobUsage(db, { projectId, jobId, event, upsert = upsertJobUsage }) {
  if (!event) return;
  await upsert(db, { projectId, jobId, event, merge: USAGE_MERGE[event.kind] || "first" });
}
