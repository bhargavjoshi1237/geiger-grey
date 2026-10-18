// Data access for grey.usage_events and grey.request_logs — billing/usage telemetry and per-request logs.
import { makeRepo } from "./repository";

const USAGE = "usage_events";
const LOGS = "request_logs";
const usageColumns = ["kind", "quantity", "unitCost", "cost", "refType", "refId", "occurredAt", "metadata"];
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

const usageRepo = makeRepo({ table: USAGE, columns: usageColumns, order: "occurred_at", ascending: true });
const logRepo = makeRepo({ table: LOGS, columns: logColumns });
// Dashboard projection: drops the query text and retrieved chunks, which dominate row size.
const logStatsRepo = makeRepo({
  table: LOGS,
  columns: logColumns,
  select: "id, pipeline_id, channel, status, latency_ms, tokens_in, tokens_out, cost, created_at",
});

// Usage events on/after `since` (defaults to all time), oldest first for charting. Paged, so
// a busy month isn't silently cut off at PostgREST's 1000-row limit.
export const listUsageEvents = (projectId, { since } = {}) => usageRepo.list(projectId, {}, { since });

export const listRequestLogs = (projectId, filters = {}) => logRepo.list(projectId, filters);

// Slim request logs created on/after `since`, newest first — for charts and rates, not display.
export const listRequestLogStats = (projectId, { since } = {}) => logStatsRepo.list(projectId, {}, { since });
