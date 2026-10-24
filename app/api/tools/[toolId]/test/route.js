import { after } from "next/server";
import { handle, json, ApiError } from "@/lib/server/errors";
import { requirePermission, isUuid } from "@/lib/server/auth";
import { isEngineError } from "@/lib/engine/errors";
import { loadToolForRun } from "@/lib/engine/tool_runs";
import { runToolTests } from "@/lib/engine/tool_tests";
import { recordUsage } from "@/lib/engine/usage";
import { runErrorCode, toolSpecHash } from "@/lib/server/tool_routes";

export const runtime = "nodejs";
export const maxDuration = 300;

function toApiError(error) {
  if (error instanceof ApiError) return error;
  if (isEngineError(error)) return new ApiError(error.code, error.status || 500, error.message);
  console.error("[api.tools.test]", error);
  return new ApiError("internal_error", 500, "Something went wrong.");
}

// The headline numbers of a report, for the run log.
function reportSummary(report) {
  if (!report) return {};
  const metrics = report.report || {};
  return {
    kind: report.kind,
    cases: report.cases ?? 0,
    skippedReason: report.skippedReason ?? null,
    accuracy: metrics.accuracy ?? null,
    coverage: metrics.coverage ?? null,
    hitAtK: metrics.hitAtK ?? null,
    mrr: metrics.mrr ?? null,
  };
}

// One tool_runs row (channel "test") and the model tokens the test used, recorded at cost 0 on
// the customer's own provider. Tests search stored vectors only, so no retrieval is billed.
async function logTestRun({ admin, projectId, toolId, userId, includeLlm, report, error, latencyMs }) {
  const usage = report?.usage || {};
  const tokensIn = Number(usage.tokensIn) || 0;
  const tokensOut = Number(usage.tokensOut) || 0;
  const { error: insertError } = await admin.from("tool_runs").insert({
    project_id: projectId,
    tool_id: toolId,
    version: 0,
    channel: "test",
    status: error ? "error" : "ok",
    input: { includeLlm },
    output: reportSummary(report),
    usage: report
      ? { llmCalls: Number(usage.llmCalls) || 0, tokensIn, tokensOut, model: usage.model ?? null, provider: usage.provider ?? null }
      : {},
    latency_ms: latencyMs,
    error_code: error ? runErrorCode(error) : null,
    created_by: userId,
  });
  if (insertError) console.error("[api.tools.test.log]", insertError.code || insertError.message);

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
      metadata: {
        byok: true,
        channel: "tool_test",
        toolId,
        tokensIn,
        tokensOut,
        model: usage.model ?? null,
        provider: usage.provider ?? null,
      },
      createdBy: userId,
    });
  }
}

// Leave-one-out tests of the draft over the labelled items in its scope. The report (plus the
// hash of the spec it tested) is saved to tools.test_report — a service-role-only field.
// Body { projectId, includeLlm? }. -> { report }
export const POST = handle(async (request, { params }) => {
  const startedAt = Date.now();
  const { toolId } = await params;
  const body = await request.json().catch(() => null);
  const projectId = body?.projectId;

  // Non-uuid/missing projectId resolves inside requirePermission -> 404 "Project not found."
  const { admin, user } = await requirePermission(request, projectId, "grey.tool.manage");

  if (!isUuid(toolId)) throw new ApiError("not_found", 404, "Tool not found.");
  if (body.includeLlm !== undefined && typeof body.includeLlm !== "boolean") {
    throw new ApiError("invalid_input", 422, "includeLlm must be true or false.");
  }
  const includeLlm = body.includeLlm === true;

  const { spec } = await loadToolForRun({ admin, projectId, toolId, version: 0 }).catch((error) => {
    throw toApiError(error);
  });

  // The run is logged once the response has gone out.
  const log = (outcome) => {
    const latencyMs = Date.now() - startedAt;
    after(() => logTestRun({ admin, projectId, toolId, userId: user.id, includeLlm, latencyMs, ...outcome }));
  };

  let report;
  try {
    report = await runToolTests({ admin, projectId, spec, includeLlm, signal: request.signal });
  } catch (error) {
    log({ error });
    throw toApiError(error);
  }
  log({ report });

  const saved = { ...report, specHash: toolSpecHash(spec) };
  const { error: saveError } = await admin
    .from("tools")
    .update({ test_report: saved })
    .eq("id", toolId)
    .eq("project_id", projectId)
    .is("deleted_at", null);
  if (saveError) {
    console.error("[api.tools.test.save]", saveError.code || saveError.message);
    throw new ApiError("service_unavailable", 503, "Couldn't save the test report.");
  }
  return json({ report: saved });
});
