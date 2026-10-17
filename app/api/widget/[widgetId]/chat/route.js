import { isUuid } from "@/lib/server/auth";
import { apiError, handleApi } from "@/lib/server/api_key_auth";
import { scheduleDeliveryLog } from "@/lib/server/delivery_log";
import { createEventStream, encodeSseEvent, sseResponse } from "@/lib/server/sse";
import { resolvePipelineConfig } from "@/lib/engine/pipeline_config";
import { runPipelineTurn } from "@/lib/engine/turn";
import { keyRateLimit, rateLimitHeaders } from "@/lib/grey/api_key_eval";
import { parseCitationIndices } from "@/lib/grey/citations";
import { clientIp, sha256, widgetAccess, widgetError, widgetPreflight, widgetRateLimit } from "../widget_access.js";

export const runtime = "nodejs";
export const maxDuration = 300;

const METHODS = "POST, OPTIONS";
const MAX_MESSAGE_CHARS = 2000;
const HISTORY_MESSAGES = 10;
const MAX_TURNS = 50;
const VISITOR_LIMIT_PER_MIN = 10;

export const OPTIONS = handleApi(async (request, { params }) => {
  const { widgetId } = await params;
  return widgetPreflight(request, widgetId, METHODS);
});

function parseBody(body, cors) {
  const invalid = (message) => apiError("invalid_input", 400, message, cors);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw invalid("The request body must be a JSON object.");
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message || message.length > MAX_MESSAGE_CHARS) throw invalid(`message must be 1–${MAX_MESSAGE_CHARS} characters.`);
  if (!isUuid(body.visitorId)) throw invalid("visitorId must be a uuid.");
  const conversationId = body.conversationId ?? null;
  if (conversationId !== null && !isUuid(conversationId)) throw invalid("conversationId must be a uuid.");
  return { message, visitorId: body.visitorId, conversationId };
}

// Citation labels for visitors: title + page/time only (storage is private, no links or ids).
const publicCitations = (citations) =>
  (citations || []).map((c) => ({ index: c.index, title: c.title ?? null, page: c.page ?? null, startMs: c.startMs ?? null }));

function citedSubset(citations, text) {
  const byIndex = new Map((citations || []).map((c) => [c.index, c]));
  return parseCitationIndices(text).map((n) => byIndex.get(n)).filter(Boolean);
}

function dbFailure(tag, error, cors, message = "The service is unavailable.") {
  console.error(`[api.widget.chat.${tag}]`, error);
  return apiError("service_unavailable", 503, message, cors);
}

// Reuses a conversation only when widget, channel and (hashed) visitor all match.
async function findConversation(admin, widget, visitorHash, conversationId, cors) {
  if (!conversationId) return null;
  const { data, error } = await admin
    .from("conversations")
    .select("id")
    .eq("id", conversationId)
    .eq("project_id", widget.project_id)
    .eq("channel", "widget")
    .eq("metadata->>widgetId", widget.id)
    .eq("metadata->>visitorId", visitorHash)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw dbFailure("conversation", error, cors);
  if (!data) return null;
  const { count, error: countError } = await admin
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", data.id)
    .eq("role", "user")
    .is("deleted_at", null);
  if (countError) throw dbFailure("turns", countError, cors);
  if ((count ?? 0) >= MAX_TURNS) {
    throw apiError("conversation_limit", 409, "This conversation is too long — start a new one.", cors);
  }
  return data.id;
}

async function loadHistory(admin, projectId, conversationId) {
  const { data, error } = await admin
    .from("messages")
    .select("role,content")
    .eq("project_id", projectId)
    .eq("conversation_id", conversationId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(HISTORY_MESSAGES);
  if (error) {
    console.error("[api.widget.chat.history]", error);
    return [];
  }
  return (data ?? []).reverse().map((m) => ({ role: m.role, content: m.content ?? "" }));
}

async function saveAssistantMessage(ctx, turn, final, { aborted = false, errorCode = null } = {}) {
  const meta = turn?.retrievalMeta ?? {};
  const { data, error } = await ctx.admin
    .from("messages")
    .insert({
      project_id: ctx.projectId,
      conversation_id: ctx.conversationId,
      role: "assistant",
      content: final.text,
      citations: final.citations ?? [],
      unanswered: Boolean(final.noContext),
      latency_ms: Date.now() - ctx.startedAt,
      tokens_in: final.usage?.tokensIn ?? null,
      tokens_out: final.usage?.tokensOut ?? null,
      metadata: {
        model: final.model?.id ?? null,
        provider: final.model?.provider ?? null,
        pipelineVersion: ctx.config.version,
        finishReason: final.finishReason ?? null,
        widgetId: ctx.widget.id,
        ...(final.noContext ? { noContext: true } : {}),
        ...(turn?.retrievalOnly ? { retrievalOnly: true } : {}),
        ...(aborted ? { aborted: true } : {}),
        ...(errorCode ? { error: errorCode } : {}),
        ...(meta.degraded ? { degraded: meta.degraded } : {}),
      },
    })
    .select("id")
    .maybeSingle();
  if (error || !data) {
    console.error("[api.widget.chat.assistantMessage]", error);
    return null;
  }
  return data;
}

// A turn that produced nothing is undone, so the conversation doesn't keep an orphaned question.
async function rollbackTurn(ctx) {
  const deletedAt = new Date().toISOString();
  const { error } = await ctx.admin.from("messages").update({ deleted_at: deletedAt }).eq("id", ctx.userMessageId);
  if (error) console.error("[api.widget.chat.rollback]", error);
  if (ctx.createdConversation) {
    const { error: conversationError } = await ctx.admin
      .from("conversations")
      .update({ deleted_at: deletedAt })
      .eq("id", ctx.conversationId);
    if (conversationError) console.error("[api.widget.chat.rollbackConversation]", conversationError);
  }
}

// SSE events: meta { conversationId, citations } → delta { text }… → done { messageId, citations,
// noContext } | error { code, message }. A visitor disconnect aborts generation and keeps any
// partial reply (metadata.aborted).
function streamTurn(ctx, turn, abort, unlink, settle, headers) {
  const body = createEventStream(
    async (write) => {
      let text = "";
      try {
        write(encodeSseEvent("meta", { conversationId: ctx.conversationId, citations: publicCitations(turn.citations) }));
        for await (const delta of turn.textStream) {
          text += delta;
          if (!write(encodeSseEvent("delta", { text: delta }))) abort.abort();
        }
        const final = await turn.finalize();
        const aborted = Boolean(final.aborted) || abort.signal.aborted;
        if (aborted && !final.text) {
          await rollbackTurn(ctx);
          settle({ status: "ok", turn, final, aborted: true });
          return;
        }
        const saved = await saveAssistantMessage(ctx, turn, final, { aborted });
        if (!saved) {
          write(encodeSseEvent("error", { code: "service_unavailable", message: "Couldn't save the answer. Please try again." }));
          settle({ status: "error", turn, final, error: { code: "service_unavailable" } });
          return;
        }
        write(
          encodeSseEvent("done", {
            conversationId: ctx.conversationId,
            messageId: saved.id,
            citations: publicCitations(final.citations),
            noContext: Boolean(final.noContext),
          }),
        );
        settle({ status: "ok", turn, final, aborted });
      } catch (error) {
        const partial = { text, citations: citedSubset(turn.citations, text), model: turn.model, usage: null, noContext: false };
        if (abort.signal.aborted) {
          if (text) await saveAssistantMessage(ctx, turn, partial, { aborted: true });
          else await rollbackTurn(ctx);
          settle({ status: "ok", turn, final: partial, aborted: true });
          return;
        }
        const safe = widgetError(error, {});
        if (text) await saveAssistantMessage(ctx, turn, partial, { errorCode: safe.code });
        else await rollbackTurn(ctx);
        write(encodeSseEvent("error", { code: safe.code, message: safe.message }));
        settle({ status: "error", turn, error: { code: safe.code } });
      } finally {
        unlink();
      }
    },
    { onCancel: () => abort.abort() },
  );
  return sseResponse(body, headers);
}

export const POST = handleApi(async (request, { params }) => {
  const { widgetId } = await params;
  const { admin, widget, origin, cors, key } = await widgetAccess(request, widgetId, { methods: METHODS });
  const projectId = widget.project_id;

  try {
    const input = parseBody(await request.json().catch(() => null), cors);

    // Per widget (the bound key's limit, 60/min unbound) and per visitor (10/min on a hashed IP).
    // Both fail closed: a limiter outage refuses anonymous traffic.
    const widgetLimit = await widgetRateLimit({ admin, bucket: `widget:${widget.id}`, limit: keyRateLimit(key), cors });
    await widgetRateLimit({
      admin,
      bucket: `visitor:${sha256(`${clientIp(request)}:${widget.id}`)}`,
      limit: VISITOR_LIMIT_PER_MIN,
      cors,
    });
    const headers = { ...cors, ...rateLimitHeaders(widgetLimit) };

    const config = await resolvePipelineConfig({ admin, projectId, pipelineId: widget.pipeline_id, channel: "widget" });

    // Only a hash of the browser's visitor id is stored.
    const visitorHash = sha256(`${widget.id}:${input.visitorId}`);
    let conversationId = await findConversation(admin, widget, visitorHash, input.conversationId, cors);
    let createdConversation = false;
    if (!conversationId) {
      const { data, error } = await admin
        .from("conversations")
        .insert({
          project_id: projectId,
          pipeline_id: widget.pipeline_id,
          user_id: null,
          title: input.message.slice(0, 60),
          channel: "widget",
          metadata: { widgetId: widget.id, visitorId: visitorHash, origin },
        })
        .select("id")
        .maybeSingle();
      if (error || !data) throw dbFailure("createConversation", error, cors, "Couldn't start the conversation.");
      conversationId = data.id;
      createdConversation = true;
    }

    const history = createdConversation ? [] : await loadHistory(admin, projectId, conversationId);
    const { data: userMessage, error: userMessageError } = await admin
      .from("messages")
      .insert({ project_id: projectId, conversation_id: conversationId, role: "user", content: input.message })
      .select("id")
      .maybeSingle();
    if (userMessageError || !userMessage) throw dbFailure("userMessage", userMessageError, cors, "Couldn't send the message.");

    const ctx = {
      admin,
      widget,
      projectId,
      config,
      conversationId,
      createdConversation,
      userMessageId: userMessage.id,
      startedAt: Date.now(),
    };
    const settle = scheduleDeliveryLog({
      admin,
      projectId,
      pipelineId: widget.pipeline_id,
      pipelineVersion: config.version,
      apiKeyId: widget.api_key_id ?? null,
      conversationId,
      channel: "widget",
      query: input.message,
      // One retrieval per completed turn; error outcomes are never charged.
      billed: true,
      refType: "conversation",
      refId: conversationId,
      metadata: { widgetId: widget.id, origin },
    });

    const abort = new AbortController();
    const onAbort = () => abort.abort();
    request.signal?.addEventListener?.("abort", onAbort, { once: true });
    const unlink = () => request.signal?.removeEventListener?.("abort", onAbort);

    let turn;
    try {
      turn = await runPipelineTurn({
        admin,
        projectId,
        config,
        query: input.message,
        history,
        channel: "widget",
        stream: true,
        abortSignal: abort.signal,
      });
    } catch (error) {
      unlink();
      settle({ status: "error", error: { code: error?.code || "internal_error" } });
      await rollbackTurn(ctx);
      throw error;
    }
    return streamTurn(ctx, turn, abort, unlink, settle, headers);
  } catch (error) {
    throw widgetError(error, cors);
  }
});
