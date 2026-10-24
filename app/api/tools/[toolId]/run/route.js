import { handle, json, ApiError } from "@/lib/server/errors";
import { authenticate, authorize, isUuid } from "@/lib/server/auth";
import { adminClient } from "@/lib/supabase/admin";
import { isEngineError } from "@/lib/engine/errors";
import { loadToolForRun, recordToolRun } from "@/lib/engine/tool_runs";
import {
  SESSION_THUMBNAIL_SECONDS,
  checkContentLength,
  parseRunVersion,
  readJsonBody,
  runErrorCode,
  runToolForChannel,
  withThumbnailUrls,
} from "@/lib/server/tool_routes";

export const runtime = "nodejs";
export const maxDuration = 60;

function toApiError(error) {
  if (error instanceof ApiError) return error;
  if (isEngineError(error)) return new ApiError(error.code, error.status || 500, error.message);
  console.error("[api.tools.run]", error);
  return new ApiError("internal_error", 500, "Something went wrong.");
}

// Runs a tool from the workspace (Try it, the builder's quick try): the draft by default, or a
// published version. Body { projectId, text?, image?: { data, mimeType }, version? (0 = draft,
// a version number, or "live") }, at most 6 MB. -> { result (similar[].thumbnailUrl), runId }
export const POST = handle(async (request, { params }) => {
  const startedAt = Date.now();
  const { toolId } = await params;
  checkContentLength(request);
  const user = await authenticate(request);
  const body = await readJsonBody(request);
  const projectId = body?.projectId;

  const admin = adminClient();
  if (!admin) throw new ApiError("service_unavailable", 503, "The service is unavailable.");
  // Non-uuid/missing projectId -> 404 "Project not found."
  await authorize({ admin, user, projectId, key: "grey.tools.view" });

  if (!isUuid(toolId)) throw new ApiError("not_found", 404, "Tool not found.");
  const version = parseRunVersion(body.version, { fallback: 0, allowDraft: true });
  if (version === undefined) {
    throw new ApiError("invalid_input", 422, 'version must be 0 (the draft), a published version number or "live".');
  }

  const loaded = await loadToolForRun({ admin, projectId, toolId, version }).catch((error) => {
    throw toApiError(error);
  });

  const outcome = await runToolForChannel({
    admin,
    projectId,
    spec: loaded.spec,
    raw: { text: body.text, image: body.image },
    channel: "playground",
    signal: request.signal,
  });

  // recordToolRun never throws; awaited so the run id can go back to the Tools screen.
  const runId = await recordToolRun({
    admin,
    projectId,
    toolId,
    version: loaded.version,
    channel: "playground",
    status: outcome.ok ? "ok" : "error",
    input: outcome.input,
    result: outcome.result,
    error: outcome.ok ? null : { code: runErrorCode(outcome.error) },
    latencyMs: Date.now() - startedAt,
    createdBy: user.id,
  });
  if (!outcome.ok) throw toApiError(outcome.error);

  const result = await withThumbnailUrls({ admin, projectId, result: outcome.result, seconds: SESSION_THUMBNAIL_SECONDS });
  return json({ result, runId });
});
