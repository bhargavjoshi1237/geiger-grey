// Data access for grey.usage_events and grey.request_logs — billing/usage telemetry and per-request logs.
import { createClient } from "./client";
import { isSupabaseConfigured } from "./config";
import { toCamel, makeRepo } from "./repository";

const USAGE = "usage_events";
const LOGS = "request_logs";
const logColumns = [
  "pipelineId",
  "apiKeyId",
  "conversationId",
  "channel",
  "query",
  "status",
  "latencyMs",
  "retrieved",
  "tokensIn",
  "tokensOut",
  "cost",
  "metadata",
];

const logRepo = makeRepo({ table: LOGS, columns: logColumns });

// Usage events on/after `since` (defaults to all time), oldest first for charting.
export async function listUsageEvents(projectId, { since } = {}) {
  if (!isSupabaseConfigured() || !projectId) return [];
  try {
    let q = createClient().from(USAGE).select("*").eq("project_id", projectId).is("deleted_at", null);
    if (since) q = q.gte("occurred_at", since);
    const { data, error } = await q.order("occurred_at", { ascending: true });
    if (error) throw error;
    return (data || []).map(toCamel);
  } catch (error) {
    console.error("[usage.listUsageEvents]", error);
    return [];
  }
}

export const listRequestLogs = (projectId, filters = {}) => logRepo.list(projectId, filters);
