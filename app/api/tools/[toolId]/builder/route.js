import { after } from "next/server";
import { handle, ApiError } from "@/lib/server/errors";
import { requirePermission, isUuid } from "@/lib/server/auth";
import { toCamel } from "@/lib/server/case";
import { EngineError } from "@/lib/engine/errors";
import { runBuilderTurn } from "@/lib/engine/tool_builder";
import { recordUsage } from "@/lib/engine/usage";
import { BUILDER_LIMITS } from "@/lib/grey/tool_builder";
import { normalizeToolSpec } from "@/lib/grey/tool_spec";

export const runtime = "nodejs";
export const maxDuration = 120;

const NOT_FOUND = "Tool not found.";

function toApiError(error) {
  if (error instanceof ApiError) return error;
  if (error instanceof EngineError || error?.name === "EngineError") {
    return new ApiError(error.code, error.status || 500, error.message);
  }
  console.error("[api.tools.builder]", error);
  return new ApiError("internal_error", 500, "Something went wrong.");
}

async function loadTool(admin, projectId, toolId) {
  const { data, error } = await admin.from("tools").select("*")
    .eq("id", toolId).eq("project_id", projectId).is("deleted_at", null).maybeSingle();
  if (error) {
    console.error("[api.tools.builder.tool]", error);
    throw new ApiError("service_unavailable", 503, "The service is unavailable.");
  }
  if (!data) throw new ApiError("not_found", 404, NOT_FOUND);
  return data;
}

// Earlier builder messages, oldest first (the new one isn't saved yet). Only the undone flag of
// the metadata is read — the stored specs stay in the database.
async function loadHistory(admin, projectId, toolId) {
  const { data, error } = await admin.from("tool_messages").select("role,content,undone:metadata->undone")
    .eq("project_id", projectId).eq("tool_id", toolId).is("deleted_at", null)
    .order("created_at", { ascending: false }).limit(BUILDER_LIMITS.historyMessages);
  if (error) {
    console.error("[api.tools.builder.history]", error);
    return [];
  }
  return (data ?? []).reverse();
}

// The turn as the route saw it through events — used when runBuilderTurn itself failed after
// streaming started, so edits that were already saved still land in the thread (and can be undone).
function turnFromProgress(ctx, progress, error) {
  return {
    text: progress.text.trim(),
    aborted: false,
    error,
    specBefore: normalizeToolSpec(ctx.tool.spec),
    specAfter: progress.spec ?? normalizeToolSpec(ctx.tool.spec),
    nameBefore: ctx.tool.name,
    nameAfter: progress.name ?? ctx.tool.name,
    descriptionBefore: ctx.tool.description ?? null,
    descriptionAfter: progress.edits.length ? (progress.description ?? null) : (ctx.tool.description ?? null),
    edits: progress.edits,
    tool: null,
    usage: { tokensIn: 0, tokensOut: 0, model: null, provider: null },
  };
}

async function saveAssistantMessage(ctx, turn, { aborted = false, errorCode = null } = {}) {
  const metadata = {
    specBefore: turn.specBefore,
    specAfter: turn.specAfter,
    nameBefore: turn.nameBefore,
    nameAfter: turn.nameAfter,
    descriptionBefore: turn.descriptionBefore,
    descriptionAfter: turn.descriptionAfter,
    edits: turn.edits,
    model: turn.usage?.model ?? null,
    provider: turn.usage?.provider ?? null,
    ...(aborted ? { aborted: true } : {}),
    ...(errorCode ? { error: errorCode } : {}),
  };
  const { data, error } = await ctx.admin.from("tool_messages").insert({
    project_id: ctx.projectId,
    tool_id: ctx.tool.id,
    role: "assistant",
    content: turn.text,
    metadata,
    created_by: ctx.user.id,
  }).select("*").maybeSingle();
  if (error || !data) {
    console.error("[api.tools.builder.assistantMessage]", error);
    return null;
  }
  return data;
}

// A turn that produced nothing and changed nothing is undone, so the thread doesn't carry an
// orphaned request.
async function rollbackTurn(ctx) {
  const { error } = await ctx.admin.from("tool_messages")
    .update({ deleted_at: new Date().toISOString() }).eq("id", ctx.userMessageRow.id);
  if (error) console.error("[api.tools.builder.rollback]", error);
}

// The builder runs on the customer's own provider: tokens are recorded at cost 0 (byok).
async function writeUsage(ctx, outcome) {
  const usage = outcome?.turn?.usage;
  const tokensIn = usage?.tokensIn ?? 0;
  const tokensOut = usage?.tokensOut ?? 0;
  if (tokensIn + tokensOut <= 0) return;
  await recordUsage({
    admin: ctx.admin,
    projectId: ctx.projectId,
    kind: "llm_tokens",
    quantity: tokensIn + tokensOut,
    unitCost: 0,
    cost: 0,
    refType: "tool",
    refId: ctx.tool.id,
    metadata: {
      byok: true,
      channel: "tool_builder",
      tokensIn,
      tokensOut,
      model: usage?.model ?? null,
      provider: usage?.provider ?? null,
    },
    createdBy: ctx.user.id,
  });
}

// NDJSON: {type:"start", userMessage} → {type:"delta", text}… / {type:"edit", changed, spec, name,
// description, errors}… → {type:"done", userMessage, assistantMessage, tool} | {type:"error", code,
// message, assistantMessage?, tool?}. Every edit is saved to the draft as it happens; the assistant
// message (with specBefore/specAfter for undo) is saved before "done". A client disconnect aborts
// the model call and keeps any partial reply (metadata.aborted).
function streamTurn(request, ctx, history, settle) {
  const encoder = new TextEncoder();
  const abort = new AbortController();
  const onAbort = () => abort.abort();
  request.signal?.addEventListener?.("abort", onAbort, { once: true });

  const body = new ReadableStream({
    async start(controller) {
      let open = true;
      const send = (event) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          open = false;
        }
      };

      const userMessage = toCamel(ctx.userMessageRow);
      send({ type: "start", userMessage });

      const progress = { text: "", edits: [], spec: null, name: null, description: null };
      let turn = null;
      try {
        try {
          turn = await runBuilderTurn({
            admin: ctx.admin,
            projectId: ctx.projectId,
            tool: ctx.tool,
            history,
            message: ctx.content,
            signal: abort.signal,
            onEvent: (event) => {
              if (event.type === "delta") {
                progress.text += event.text;
                send({ type: "delta", text: event.text });
              } else if (event.type === "edit") {
                progress.edits.push({ changed: event.changed, errors: event.errors });
                Object.assign(progress, { spec: event.spec, name: event.name, description: event.description });
                send({
                  type: "edit",
                  changed: event.changed,
                  spec: event.spec,
                  name: event.name,
                  description: event.description,
                  errors: event.errors,
                });
              }
            },
          });
        } catch (error) {
          // Thrown before the model ran (no processing model, provider, context) — or a bug part-way.
          const apiError = abort.signal.aborted ? null : toApiError(error);
          turn = turnFromProgress(ctx, progress, apiError);
          if (abort.signal.aborted) turn.aborted = true;
        }

        const aborted = turn.aborted || abort.signal.aborted;
        const failure = turn.error ? toApiError(turn.error) : null;
        if (!turn.text && !turn.edits.length) {
          await rollbackTurn(ctx);
          if (!aborted) {
            send({
              type: "error",
              code: failure?.code || "empty_reply",
              message: failure?.message || "The builder didn't reply. Try again.",
            });
          }
          settle({ status: failure ? "error" : "ok", turn, aborted });
          return;
        }

        const saved = await saveAssistantMessage(ctx, turn, { aborted, errorCode: failure?.code ?? null });
        // The draft as it now stands: the last saved row, the loaded row when nothing changed, or
        // a fresh read when edits were tracked from events only.
        const latest = turn.tool
          ?? (turn.edits.length ? await loadTool(ctx.admin, ctx.projectId, ctx.tool.id).catch(() => null) : ctx.tool);
        const tool = toCamel(latest);
        if (!saved) {
          send({ type: "error", code: "service_unavailable", message: "Could not save the response.", ...(tool ? { tool } : {}) });
          settle({ status: "error", turn });
          return;
        }
        const assistantMessage = toCamel(saved);
        if (failure) {
          send({ type: "error", code: failure.code, message: failure.message, assistantMessage, ...(tool ? { tool } : {}) });
          settle({ status: "error", turn });
          return;
        }
        send({ type: "done", userMessage, assistantMessage, tool });
        settle({ status: "ok", turn, aborted });
      } finally {
        settle({ status: "error", turn }); // no-op once settled; never leaves after() waiting
        request.signal?.removeEventListener?.("abort", onAbort);
        open = false;
        try {
          controller.close();
        } catch {
          // already closed by a disconnected client
        }
      }
    },
    cancel() {
      abort.abort();
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

export const POST = handle(async (request, { params }) => {
  const { toolId } = await params;
  const body = await request.json().catch(() => null);
  const projectId = body?.projectId;

  // Non-uuid/missing projectId resolves inside requirePermission -> 404 "Project not found."
  const { admin, user } = await requirePermission(request, projectId, "grey.tool.manage");
  if (!isUuid(toolId)) throw new ApiError("not_found", 404, NOT_FOUND);

  const content = typeof body?.content === "string" ? body.content.trim() : "";
  if (!content || content.length > BUILDER_LIMITS.messageChars) {
    throw new ApiError("invalid_input", 422, `Write a message of 1–${BUILDER_LIMITS.messageChars.toLocaleString("en-US")} characters.`);
  }

  const tool = await loadTool(admin, projectId, toolId);
  const history = await loadHistory(admin, projectId, toolId);

  const { data: userMessageRow, error: userMessageError } = await admin.from("tool_messages").insert({
    project_id: projectId,
    tool_id: toolId,
    role: "user",
    content,
    created_by: user.id,
  }).select("*").maybeSingle();
  if (userMessageError || !userMessageRow) {
    console.error("[api.tools.builder.userMessage]", userMessageError);
    throw new ApiError("service_unavailable", 503, "Could not send the message.");
  }

  const ctx = { admin, user, projectId, tool, userMessageRow, content };
  // Usage is written once the turn settles, after the response has gone out.
  let settle;
  const outcome = new Promise((resolve) => {
    settle = resolve;
  });
  after(async () => writeUsage(ctx, await outcome));

  return streamTurn(request, ctx, history, settle);
});
