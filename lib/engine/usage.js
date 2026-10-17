// Metering and caps (spec §11): usage_events rows, request_logs rows (honouring
// project_settings.log_queries) and the monthly soft-cap state checked before each turn.
// Every function here logs and swallows its own failures — metering never fails a request.

async function loadSettings(admin, projectId) {
  const { data, error } = await admin
    .from("project_settings")
    .select("monthly_soft_cap,cap_behavior,log_queries")
    .eq("project_id", projectId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// RPC scalars come back bare, but tolerate a one-row/one-column shape too.
function scalar(data) {
  if (Array.isArray(data)) data = data[0];
  if (data && typeof data === "object") data = Object.values(data)[0];
  const n = Number(data);
  return Number.isFinite(n) ? n : 0;
}

// One usage_events row. Returns true when written.
export async function recordUsage({
  admin,
  projectId,
  kind,
  quantity = 0,
  unitCost = 0,
  cost = 0,
  refType = null,
  refId = null,
  metadata = {},
  createdBy = null,
} = {}) {
  try {
    const { error } = await admin.from("usage_events").insert({
      project_id: projectId,
      kind,
      quantity,
      unit_cost: unitCost,
      cost,
      ref_type: refType,
      ref_id: refId,
      metadata: metadata || {},
      ...(createdBy ? { created_by: createdBy } : {}),
    });
    if (error) throw error;
    return true;
  } catch (error) {
    console.error("[engine.usage.recordUsage]", kind, error?.message);
    return false;
  }
}

// -> { spend, cap, behavior, reached }. spend is null when no cap is set (not computed);
// a failed check never blocks the turn (reached: false).
export async function getCapState({ admin, projectId }) {
  try {
    const settings = await loadSettings(admin, projectId);
    const behavior = settings?.cap_behavior || "alert";
    const cap = settings?.monthly_soft_cap === null || settings?.monthly_soft_cap === undefined
      ? null
      : Number(settings.monthly_soft_cap);
    if (cap === null || !Number.isFinite(cap)) return { spend: null, cap: null, behavior, reached: false };
    const { data, error } = await admin.rpc("project_month_spend", { p_project: projectId });
    if (error) throw error;
    const spend = scalar(data);
    return { spend, cap, behavior, reached: spend >= cap };
  } catch (error) {
    console.error("[engine.usage.getCapState]", error?.message);
    return { spend: null, cap: null, behavior: "alert", reached: false };
  }
}

// request_logs.retrieved entries — ids, scores and ranks only, never chunk content.
export function toRetrievedLog(chunks = []) {
  return (chunks || []).map((c, i) => ({
    chunkId: c.chunkId,
    sourceId: c.sourceId,
    score: c.score,
    rank: i + 1,
    via: c.via,
  }));
}

// One request_logs row. `query` and `retrieved` are dropped when the project turned
// log_queries off (pass logQueries to skip the settings read). Returns true when written.
export async function recordRequestLog({
  admin,
  projectId,
  pipelineId = null,
  conversationId = null,
  apiKeyId = null,
  channel,
  query = null,
  status = "ok",
  latencyMs = null,
  retrieved = [],
  tokensIn = null,
  tokensOut = null,
  cost = null,
  metadata = {},
  createdBy = null,
  logQueries,
} = {}) {
  try {
    let keepQuery = logQueries;
    if (typeof keepQuery !== "boolean") {
      try {
        keepQuery = (await loadSettings(admin, projectId))?.log_queries !== false;
      } catch (error) {
        console.error("[engine.usage.logQueries]", error?.message);
        keepQuery = false; // unknown preference: keep the log, drop the query text
      }
    }
    const { error } = await admin.from("request_logs").insert({
      project_id: projectId,
      pipeline_id: pipelineId,
      conversation_id: conversationId,
      api_key_id: apiKeyId,
      channel,
      query: keepQuery ? query : null,
      status,
      latency_ms: latencyMs,
      retrieved: keepQuery ? retrieved || [] : [],
      tokens_in: tokensIn,
      tokens_out: tokensOut,
      cost,
      metadata: metadata || {},
      ...(createdBy ? { created_by: createdBy } : {}),
    });
    if (error) throw error;
    return true;
  } catch (error) {
    console.error("[engine.usage.recordRequestLog]", error?.message);
    return false;
  }
}
