// Lookup tool runs (spec §5.8): the run log and metering, the monthly run count behind
// budget.monthlyRunLimit, and loading the spec a run uses (draft or a published version).
// Shared server runtime: relative imports only; the caller passes the service-role `admin` client.
import { EngineError } from "./errors.js";
import { recordUsage } from "./usage.js";
import { PRICE_PER_RETRIEVAL } from "../grey/cost.js";
import { normalizeToolSpec } from "../grey/tool_spec.js";

const DRAFT_VERSION = 0;
const TOOL_COLUMNS = "id,project_id,name,description,spec,status,current_version,test_report,metadata,created_at,updated_at";

const serviceUnavailable = () =>
  new EngineError("service_unavailable", "The service is unavailable.", { status: 503, retryable: true });

// What was sent — never the text or the image bytes themselves.
function inputSummary(input) {
  const text = typeof input?.text === "string" ? input.text : "";
  const image = input?.image && typeof input.image === "object" ? input.image : null;
  const imageBytes = Number(image?.byteLength ?? image?.bytes?.length);
  return {
    hasText: Boolean(text.trim()),
    textChars: text.length,
    hasImage: Boolean(image),
    imageBytes: image && Number.isFinite(imageBytes) ? imageBytes : null,
    width: image?.width ?? null,
    height: image?.height ?? null,
  };
}

function outputSummary(result) {
  if (!result || typeof result !== "object") return {};
  const classification = result.classification || null;
  const answer = result.answer || null;
  return {
    label: classification?.label ?? null,
    confidence: classification?.confidence ?? null,
    decidedBy: classification?.decidedBy ?? null,
    similar: (result.similar || []).map((item) => ({ sourceId: item.sourceId, score: item.score })),
    answerChars: answer && !answer.abstained ? String(answer.text ?? "").length : 0,
    abstained: answer ? Boolean(answer.abstained) : null,
  };
}

/**
 * Logs one run (grey.tool_runs) and meters it: one "retrieval" usage event at
 * PRICE_PER_RETRIEVAL when the run searched, and "llm_tokens" at cost 0 (the customer's own
 * provider) when it used tokens. Never throws. -> the run id, or null when it couldn't be saved.
 */
export async function recordToolRun({
  admin,
  projectId,
  toolId,
  version = DRAFT_VERSION,
  channel,
  status = "ok",
  input,
  result = null,
  error = null,
  latencyMs = null,
  apiKeyId = null,
  createdBy = null,
} = {}) {
  const usage = result?.usage && typeof result.usage === "object" ? result.usage : {};
  const toolVersion = Number.isInteger(Number(version)) ? Number(version) : DRAFT_VERSION;
  let runId = null;
  try {
    const { data, error: insertError } = await admin
      .from("tool_runs")
      .insert({
        project_id: projectId,
        tool_id: toolId,
        version: toolVersion,
        channel,
        status,
        input: inputSummary(input),
        output: outputSummary(result),
        usage,
        latency_ms: latencyMs !== null && Number.isFinite(Number(latencyMs)) ? Math.round(Number(latencyMs)) : null,
        error_code: status === "error" ? (error?.code ?? "internal_error") : null,
        api_key_id: apiKeyId,
        created_by: createdBy,
      })
      .select("id")
      .maybeSingle();
    if (insertError) throw insertError;
    runId = data?.id ?? null;
  } catch (failure) {
    console.error("[engine.tool_runs.record]", failure?.code || failure?.message);
  }

  // recordUsage logs and swallows its own failures.
  const metadata = { channel, toolId, version: toolVersion };
  if (usage.searched) {
    await recordUsage({
      admin,
      projectId,
      kind: "retrieval",
      quantity: 1,
      unitCost: PRICE_PER_RETRIEVAL,
      cost: PRICE_PER_RETRIEVAL,
      refType: "tool",
      refId: toolId,
      metadata,
      createdBy,
    });
  }
  const tokensIn = Number(usage.tokensIn) || 0;
  const tokensOut = Number(usage.tokensOut) || 0;
  if (tokensIn + tokensOut > 0) {
    await recordUsage({
      admin,
      projectId,
      kind: "llm_tokens",
      quantity: tokensIn + tokensOut,
      unitCost: 0,
      cost: 0,
      refType: "tool",
      refId: toolId,
      metadata: { ...metadata, byok: true, tokensIn, tokensOut, model: usage.model ?? null, provider: usage.provider ?? null },
      createdBy,
    });
  }
  return runId;
}

// Start of the current calendar month in UTC.
export function monthStart(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

/**
 * Successful runs of a tool this calendar month (UTC), test runs excluded — what
 * budget.monthlyRunLimit is checked against. Throws EngineError when the count can't be read
 * (the limit fails closed).
 */
export async function monthlyRunCount({ admin, projectId, toolId, now = new Date() }) {
  const { count, error } = await admin
    .from("tool_runs")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId)
    .eq("tool_id", toolId)
    .eq("status", "ok")
    .neq("channel", "test")
    .gte("created_at", monthStart(now));
  if (error) {
    console.error("[engine.tool_runs.monthlyRunCount]", error.code || error.message);
    throw serviceUnavailable();
  }
  return Number(count) || 0;
}

/**
 * The tool and the spec a run uses. `version` 0 / null / undefined = the draft (tools.spec,
 * reported as version 0); a positive integer = that published version; "live" = the current
 * published version. Published versions need the tool to be live. The spec is normalised.
 * -> { tool (the grey.tools row, snake_case), spec, version }
 * Throws EngineError tool_not_found (404) | tool_not_live (409) | tool_version_not_found (404).
 */
export async function loadToolForRun({ admin, projectId, toolId, version = null }) {
  const { data: tool, error } = await admin
    .from("tools")
    .select(TOOL_COLUMNS)
    .eq("id", toolId)
    .eq("project_id", projectId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) {
    console.error("[engine.tool_runs.tool]", error.code || error.message);
    throw serviceUnavailable();
  }
  if (!tool) throw new EngineError("tool_not_found", "Tool not found.", { status: 404 });

  const live = version === "live" || version === "current";
  if (!live && (version === null || version === undefined || version === "" || Number(version) === DRAFT_VERSION)) {
    return { tool, spec: normalizeToolSpec(tool.spec), version: DRAFT_VERSION };
  }
  const pinned = Number(version);
  if (!live && (!Number.isInteger(pinned) || pinned < 1)) {
    throw new EngineError("tool_version_not_found", "That version of this tool doesn't exist.", { status: 404 });
  }

  const current = Number(tool.current_version) || 0;
  if (tool.status !== "live" || current < 1) {
    throw new EngineError("tool_not_live", "This tool isn't published yet.", { status: 409 });
  }
  const wanted = live ? current : pinned;
  const { data: snapshot, error: versionError } = await admin
    .from("tool_versions")
    .select("version,spec")
    .eq("project_id", projectId)
    .eq("tool_id", toolId)
    .eq("version", wanted)
    .is("deleted_at", null)
    .maybeSingle();
  if (versionError) {
    console.error("[engine.tool_runs.version]", versionError.code || versionError.message);
    throw serviceUnavailable();
  }
  if (!snapshot) {
    throw new EngineError("tool_version_not_found", `Version ${wanted} of this tool doesn't exist.`, { status: 404 });
  }
  return { tool, spec: normalizeToolSpec(snapshot.spec), version: wanted };
}
