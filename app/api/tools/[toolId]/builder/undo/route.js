import { handle, json, ApiError } from "@/lib/server/errors";
import { requirePermission, isUuid } from "@/lib/server/auth";
import { toCamel } from "@/lib/server/case";
import { hasBuilderEdits } from "@/lib/grey/tool_builder";
import { normalizeToolSpec } from "@/lib/grey/tool_spec";

export const runtime = "nodejs";

const TOOL_NOT_FOUND = "Tool not found.";
const MESSAGE_NOT_FOUND = "Message not found.";

const unavailable = (tag, error) => {
  console.error(`[api.tools.builder.undo.${tag}]`, error);
  return new ApiError("service_unavailable", 503, "The service is unavailable.");
};

const sameSpec = (a, b) => JSON.stringify(normalizeToolSpec(a)) === JSON.stringify(normalizeToolSpec(b));

// Undoes one builder reply: restores the draft it started from. Only the latest reply that changed
// the tool and isn't undone yet qualifies, and only while the draft is still exactly what that
// reply left — a later edit (the form, another reply) makes it a 409 rather than overwriting it.
export const POST = handle(async (request, { params }) => {
  const { toolId } = await params;
  const body = await request.json().catch(() => null);
  const projectId = body?.projectId;

  // Non-uuid/missing projectId resolves inside requirePermission -> 404 "Project not found."
  const { admin } = await requirePermission(request, projectId, "grey.tool.manage");
  if (!isUuid(toolId)) throw new ApiError("not_found", 404, TOOL_NOT_FOUND);
  const messageId = body?.messageId;
  if (!isUuid(messageId)) throw new ApiError("not_found", 404, MESSAGE_NOT_FOUND);

  const { data: tool, error: toolError } = await admin.from("tools").select("*")
    .eq("id", toolId).eq("project_id", projectId).is("deleted_at", null).maybeSingle();
  if (toolError) throw unavailable("tool", toolError);
  if (!tool) throw new ApiError("not_found", 404, TOOL_NOT_FOUND);

  const { data: message, error: messageError } = await admin.from("tool_messages").select("id,metadata,created_at")
    .eq("id", messageId).eq("tool_id", toolId).eq("project_id", projectId).eq("role", "assistant")
    .is("deleted_at", null).maybeSingle();
  if (messageError) throw unavailable("message", messageError);
  if (!message) throw new ApiError("not_found", 404, MESSAGE_NOT_FOUND);

  const meta = message.metadata ?? {};
  if (!hasBuilderEdits(meta) || !meta.specBefore) {
    throw new ApiError("not_undoable", 409, "This reply didn't change the tool.");
  }
  if (meta.undone === true) throw new ApiError("already_undone", 409, "This change was already undone.");

  // A newer reply with changes that are still in place has to be undone first.
  const { data: newer, error: newerError } = await admin.from("tool_messages")
    .select("id,edits:metadata->edits,undone:metadata->undone")
    .eq("tool_id", toolId).eq("project_id", projectId).eq("role", "assistant").is("deleted_at", null)
    .gt("created_at", message.created_at);
  if (newerError) throw unavailable("newer", newerError);
  if ((newer ?? []).some((row) => row.undone !== true && hasBuilderEdits({ edits: row.edits }))) {
    throw new ApiError("not_latest", 409, "Only the latest change can be undone.");
  }

  if (!sameSpec(tool.spec, meta.specAfter)) throw new ApiError("tool_changed", 409, "The tool changed since this turn.");

  // Name and description go back only when they still read what this reply set.
  const update = { spec: normalizeToolSpec(meta.specBefore) };
  if ("nameBefore" in meta && meta.nameBefore && meta.nameBefore !== meta.nameAfter && tool.name === meta.nameAfter) {
    update.name = meta.nameBefore;
  }
  if ("descriptionBefore" in meta && (meta.descriptionBefore ?? "") !== (meta.descriptionAfter ?? "")
    && (tool.description ?? "") === (meta.descriptionAfter ?? "")) {
    update.description = meta.descriptionBefore || null;
  }

  const { data: restored, error: restoreError } = await admin.from("tools").update(update)
    .eq("id", toolId).eq("project_id", projectId).is("deleted_at", null).select("*").maybeSingle();
  if (restoreError) throw unavailable("restore", restoreError);
  if (!restored) throw new ApiError("not_found", 404, TOOL_NOT_FOUND);

  const { error: markError } = await admin.from("tool_messages")
    .update({ metadata: { ...meta, undone: true, undoneAt: new Date().toISOString() } })
    .eq("id", messageId);
  if (markError) console.error("[api.tools.builder.undo.mark]", markError);

  return json({ tool: toCamel(restored) });
});
