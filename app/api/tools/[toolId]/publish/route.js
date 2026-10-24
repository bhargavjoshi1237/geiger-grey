import { handle, json, ApiError } from "@/lib/server/errors";
import { requirePermission, isUuid } from "@/lib/server/auth";
import { toCamel } from "@/lib/server/case";
import { isEngineError } from "@/lib/engine/errors";
import { loadToolForRun } from "@/lib/engine/tool_runs";
import { validateToolSpec } from "@/lib/grey/tool_spec";

export const runtime = "nodejs";

const NOTE_MAX = 500;
const TOOL_COLUMNS =
  "id,project_id,name,description,spec,status,current_version,test_report,metadata,created_by,created_at,updated_at";
const CONFLICT = "This tool was just published from somewhere else — reload it and try again.";

function toApiError(error) {
  if (error instanceof ApiError) return error;
  if (isEngineError(error)) return new ApiError(error.code, error.status || 500, error.message);
  console.error("[api.tools.publish]", error);
  return new ApiError("internal_error", 500, "Something went wrong.");
}

const unavailable = (tag, error, message = "The service is unavailable.") => {
  console.error(`[api.tools.publish.${tag}]`, error?.code || error?.message || error);
  return new ApiError("service_unavailable", 503, message);
};

async function activeKbIds(admin, projectId) {
  const { data, error } = await admin
    .from("knowledge_bases")
    .select("id")
    .eq("project_id", projectId)
    .eq("status", "active")
    .is("deleted_at", null);
  if (error) throw unavailable("kbs", error);
  return (data ?? []).map((kb) => kb.id);
}

function invalidSpecMessage(errors) {
  if (errors.length === 1) return `Fix this before publishing: ${errors[0].message}`;
  return `Fix these ${errors.length} things before publishing: ${errors.map((e) => e.message).join(" ")}`;
}

// Publishes the draft as the next version: validates it against the project's active knowledge
// bases, snapshots spec + note + the last test report into tool_versions, then marks the tool
// live at that version. status/current_version are service-role-only fields.
// Body { projectId, note? (≤ 500) }. -> { tool (camelCase), version (the new version number) }
// | 422 { error: "invalid_spec", message, errors: [{ path, message }] }
export const POST = handle(async (request, { params }) => {
  const { toolId } = await params;
  const body = await request.json().catch(() => null);
  const projectId = body?.projectId;

  // Non-uuid/missing projectId resolves inside requirePermission -> 404 "Project not found."
  const { admin, user } = await requirePermission(request, projectId, "grey.tool.publish");

  if (!isUuid(toolId)) throw new ApiError("not_found", 404, "Tool not found.");
  let note = null;
  if (body.note !== undefined && body.note !== null) {
    if (typeof body.note !== "string" || body.note.trim().length > NOTE_MAX) {
      throw new ApiError("invalid_input", 422, `note must be text of at most ${NOTE_MAX} characters.`);
    }
    note = body.note.trim() || null;
  }

  const { tool, spec } = await loadToolForRun({ admin, projectId, toolId, version: 0 }).catch((error) => {
    throw toApiError(error);
  });

  const check = validateToolSpec(spec, { kbIds: await activeKbIds(admin, projectId) });
  if (!check.ok) {
    return json({ error: "invalid_spec", message: invalidSpecMessage(check.errors), errors: check.errors }, 422);
  }

  const previous = Number(tool.current_version) || 0;
  const version = previous + 1;
  const { data: snapshot, error: versionError } = await admin
    .from("tool_versions")
    .insert({
      project_id: projectId,
      tool_id: toolId,
      version,
      spec,
      note,
      test_report: tool.test_report ?? null,
      published_by: user.id,
      created_by: user.id,
    })
    .select("id")
    .maybeSingle();
  if (versionError?.code === "23505") throw new ApiError("publish_conflict", 409, CONFLICT);
  if (versionError || !snapshot) throw unavailable("version", versionError, "Couldn't publish the tool.");

  // Guarded on the version this publish started from, so two publishes can't both advance it.
  const { data: updated, error: updateError } = await admin
    .from("tools")
    .update({ status: "live", current_version: version })
    .eq("id", toolId)
    .eq("project_id", projectId)
    .eq("current_version", previous)
    .is("deleted_at", null)
    .select(TOOL_COLUMNS)
    .maybeSingle();
  if (updateError || !updated) {
    // Undo the snapshot so version numbers stay in step with current_version.
    const { error: undoError } = await admin
      .from("tool_versions")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", snapshot.id);
    if (undoError) console.error("[api.tools.publish.undo]", undoError.code || undoError.message);
    if (updateError) throw unavailable("tool", updateError, "Couldn't publish the tool.");
    throw new ApiError("publish_conflict", 409, CONFLICT);
  }

  return json({ tool: toCamel(updated), version });
});
