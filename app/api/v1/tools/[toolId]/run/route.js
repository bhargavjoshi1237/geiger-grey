import { after } from "next/server";
import { isUuid } from "@/lib/server/auth";
import { ApiError } from "@/lib/server/errors";
import { apiError, assertWithinLimit, authenticateApiKey, handleApi, rateLimitHit } from "@/lib/server/api_key_auth";
import { isEngineError } from "@/lib/engine/errors";
import { loadToolForRun, recordToolRun } from "@/lib/engine/tool_runs";
import {
  PUBLIC_THUMBNAIL_SECONDS,
  TOOL_RATE_LIMIT_PER_MIN,
  checkMonthlyRunLimit,
  parseRunVersion,
  readJsonBody,
  runErrorCode,
  runToolForChannel,
  toolRateBucket,
  withThumbnailUrls,
} from "@/lib/server/tool_routes";

export const runtime = "nodejs";
export const maxDuration = 60;

function toApiError(error, headers) {
  if (error instanceof ApiError) return Object.assign(error, { headers: { ...headers, ...(error.headers || {}) } });
  if (isEngineError(error)) return apiError(error.code, error.status || 500, error.message, headers);
  console.error("[api.v1.tools.run]", error);
  return apiError("internal_error", 500, "Something went wrong.", headers);
}

// Runs a published lookup tool. API key with the "tools" scope whose tool_ids lists this tool.
// Body { text?, image?: { data (base64 or data: URI), mimeType? }, version? ("live" — the
// default — or a published version number) }, at most 6 MB. Limits: the key's own rate limit,
// 60 runs/min per tool across all callers, and the tool's monthly run limit (429 tool_run_limit).
// -> { object: "tool_run", toolId, version, result } — thumbnails as signed URLs (10 min).
export const POST = handleApi(async (request, { params }) => {
  const startedAt = Date.now();
  const { toolId } = await params;
  const auth = await authenticateApiKey(request, { scope: "tools", toolId });
  const { admin, key, projectId, headers } = auth;

  try {
    if (!isUuid(toolId)) throw new ApiError("tool_not_found", 404, "Tool not found.");
    const body = await readJsonBody(request);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new ApiError("invalid_input", 400, "The request body must be a JSON object.");
    }
    const version = parseRunVersion(body.version, { fallback: "live" });
    if (version === undefined) {
      throw new ApiError("invalid_input", 400, 'version must be "live" or a published version number.');
    }

    const toolLimit = await rateLimitHit({ admin, bucket: toolRateBucket(toolId), limit: TOOL_RATE_LIMIT_PER_MIN });
    assertWithinLimit(toolLimit, headers);

    const loaded = await loadToolForRun({ admin, projectId, toolId, version });
    await checkMonthlyRunLimit({ admin, projectId, toolId, spec: loaded.spec });

    const outcome = await runToolForChannel({
      admin,
      projectId,
      spec: loaded.spec,
      raw: { text: body.text, image: body.image },
      channel: "api",
      signal: request.signal,
    });
    const latencyMs = Date.now() - startedAt;
    // Logged and metered once the response has gone out.
    after(() =>
      recordToolRun({
        admin,
        projectId,
        toolId,
        version: loaded.version,
        channel: "api",
        status: outcome.ok ? "ok" : "error",
        input: outcome.input,
        result: outcome.result,
        error: outcome.ok ? null : { code: runErrorCode(outcome.error) },
        latencyMs,
        apiKeyId: key.id,
      }),
    );
    if (!outcome.ok) throw outcome.error;

    const result = await withThumbnailUrls({ admin, projectId, result: outcome.result, seconds: PUBLIC_THUMBNAIL_SECONDS });
    return Response.json({ object: "tool_run", toolId, version: loaded.version, result }, { headers });
  } catch (error) {
    throw toApiError(error, headers);
  }
});
