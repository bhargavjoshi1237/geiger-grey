import { after } from "next/server";
import { handle, json, ApiError } from "@/lib/server/errors";
import { requirePermission, isUuid } from "@/lib/server/auth";
import { toCamel } from "@/lib/server/case";
import { EngineError } from "@/lib/engine/errors";
import { resolvePipelineConfig } from "@/lib/engine/pipeline_config";
import { runPipelineTurn } from "@/lib/engine/turn";
import { recordRequestLog, recordUsage, toRetrievedLog } from "@/lib/engine/usage";
import { parseCitationIndices } from "@/lib/grey/citations";
import { PRICE_PER_RETRIEVAL } from "@/lib/grey/cost";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_CONTENT_LENGTH = 8000;
const HISTORY_LIMIT = 12;

function toApiError(error) {
  if (error instanceof ApiError) return error;
  if (error instanceof EngineError) return new ApiError(error.code, error.status || 500, error.message);
  console.error("[api.chat]", error);
  return new ApiError("internal_error", 500, "Something went wrong.");
}

// Prior turns of an existing conversation, oldest first (the new user message isn't saved yet).
async function loadHistory(admin, projectId, conversationId) {
  const { data, error } = await admin.from("messages").select("role,content")
    .eq("project_id", projectId).eq("conversation_id", conversationId).is("deleted_at", null)
    .order("created_at", { ascending: false }).limit(HISTORY_LIMIT);
  if (error) {
    console.error("[api.chat.history]", error);
    return [];
  }
  return (data ?? []).reverse();
}

// A partial streamed reply: keep only the citations its text already references.
function partialAnswer(turn, text) {
  const byIndex = new Map((turn?.citations ?? []).map((c) => [c.index, c]));
  return {
    text,
    citations: parseCitationIndices(text).map((n) => byIndex.get(n)).filter(Boolean),
    usage: { tokensIn: 0, tokensOut: 0 },
    model: turn?.model ?? null,
    finishReason: null,
    noContext: false,
  };
}

// What the turn sent the model (passages, sizes, token budget) plus the retrieval counts behind
// it, for the Playground's context view. Undefined when no passage went in.
function turnContext(turn) {
  if (!turn?.context?.passages?.length) return undefined;
  return {
    ...turn.context,
    retrieved: turn.retrieved?.length ?? turn.context.passages.length,
    candidates: turn.retrievalMeta?.candidateCount ?? null,
  };
}

// How long the query embedding (model, ms, tokens) and the model's generation (ms, firstTokenMs)
// took, for the reply header. Embedding is known once retrieval is done, generation once it ends.
function turnStats(turn, final) {
  const meta = turn?.retrievalMeta;
  const stats = {};
  if (meta?.embedTokens && Number.isFinite(meta.timings?.embedMs)) {
    stats.embedding = { model: meta.embedModels?.join(", ") || null, ms: meta.timings.embedMs, tokens: meta.embedTokens };
  }
  if (final?.generation) stats.generation = final.generation;
  return Object.keys(stats).length ? stats : undefined;
}

async function saveAssistantMessage(ctx, turn, final, { aborted = false, errorCode = null } = {}) {
  const meta = turn?.retrievalMeta ?? {};
  const context = turnContext(turn);
  const stats = turnStats(turn, final);
  const metadata = {
    model: final.model?.id ?? null,
    provider: final.model?.provider ?? null,
    pipelineVersion: ctx.config.version,
    finishReason: final.finishReason ?? null,
    ...(final.noContext ? { noContext: true } : {}),
    ...(ctx.config.knowledgeOnly === false ? { knowledgeOnly: false } : {}),
    ...(turn?.retrievalOnly ? { retrievalOnly: true } : {}),
    ...(aborted ? { aborted: true } : {}),
    ...(errorCode ? { error: errorCode } : {}),
    ...(meta.degraded ? { degraded: meta.degraded } : {}),
    ...(context ? { context } : {}),
    ...(stats ? { stats } : {}),
  };
  const { data, error } = await ctx.admin.from("messages").insert({
    project_id: ctx.projectId,
    conversation_id: ctx.conversationId,
    role: "assistant",
    content: final.text,
    citations: final.citations ?? [],
    unanswered: Boolean(final.noContext),
    latency_ms: Date.now() - ctx.startedAt,
    tokens_in: final.usage?.tokensIn ?? null,
    tokens_out: final.usage?.tokensOut ?? null,
    metadata,
    created_by: ctx.user.id,
  }).select("*").maybeSingle();
  if (error || !data) {
    console.error("[api.chat.assistantMessage]", error);
    return null;
  }
  return data;
}

// A turn that produced nothing is undone, so the conversation doesn't carry an orphaned question.
async function rollbackTurn(ctx) {
  const deletedAt = new Date().toISOString();
  const { error } = await ctx.admin.from("messages").update({ deleted_at: deletedAt }).eq("id", ctx.userMessageRow.id);
  if (error) console.error("[api.chat.rollback]", error);
  if (ctx.createdConversation) {
    const { error: conversationError } = await ctx.admin.from("conversations")
      .update({ deleted_at: deletedAt }).eq("id", ctx.conversationId);
    if (conversationError) console.error("[api.chat.rollbackConversation]", conversationError);
  }
}

// request_logs + usage_events, after the response. Retrieval is billed for completed turns;
// tokens on the customer's own provider are recorded at cost 0 (byok).
async function writeTurnLogs(ctx, outcome) {
  const { admin, projectId, pipelineId, conversationId, user, config } = ctx;
  const { status, turn, final, error, aborted } = outcome;
  const meta = turn?.retrievalMeta ?? {};
  const context = turnContext(turn);
  const billed = status === "ok" && Boolean(turn?.retrieved);
  const tokensIn = final?.usage?.tokensIn ?? null;
  const tokensOut = final?.usage?.tokensOut ?? null;

  await recordRequestLog({
    admin,
    projectId,
    pipelineId,
    conversationId,
    channel: "playground",
    query: ctx.content,
    status,
    latencyMs: outcome.latencyMs ?? Date.now() - ctx.startedAt,
    retrieved: toRetrievedLog(turn?.retrieved ?? []),
    tokensIn,
    tokensOut,
    cost: billed ? PRICE_PER_RETRIEVAL : 0,
    metadata: {
      pipelineVersion: config.version,
      model: final?.model?.id ?? null,
      provider: final?.model?.provider ?? null,
      finishReason: final?.finishReason ?? null,
      noContext: Boolean(final?.noContext),
      knowledgeOnly: config.knowledgeOnly !== false,
      retrievalOnly: Boolean(turn?.retrievalOnly),
      aborted: Boolean(aborted),
      ...(error ? { errorCode: error.code } : {}),
      scoreKind: meta.scoreKind ?? null,
      degraded: meta.degraded ?? null,
      rerank: meta.rerank ?? null,
      graph: meta.graph ?? null,
      candidateCount: meta.candidateCount ?? 0,
      context: context ? { passages: context.passages.length, tokens: context.tokens } : null,
      timings: {
        ...(meta.timings ?? {}),
        ...(turn?.timings ?? {}),
        ...(final?.generation ? { generationMs: final.generation.ms, firstTokenMs: final.generation.firstTokenMs } : {}),
      },
    },
    createdBy: user.id,
  });

  if (billed) {
    await recordUsage({
      admin,
      projectId,
      kind: "retrieval",
      quantity: 1,
      unitCost: PRICE_PER_RETRIEVAL,
      cost: PRICE_PER_RETRIEVAL,
      refType: "conversation",
      refId: conversationId,
      metadata: { channel: "playground", pipelineId },
      createdBy: user.id,
    });
  }

  const tokens = (tokensIn ?? 0) + (tokensOut ?? 0);
  if (tokens > 0) {
    await recordUsage({
      admin,
      projectId,
      kind: "llm_tokens",
      quantity: tokens,
      unitCost: 0,
      cost: 0,
      refType: "conversation",
      refId: conversationId,
      metadata: {
        byok: true,
        tokensIn,
        tokensOut,
        model: final?.model?.id ?? null,
        provider: final?.model?.provider ?? null,
        channel: "playground",
        pipelineId,
      },
      createdBy: user.id,
    });
  }
}

// NDJSON: {type:"start"} → {type:"retrieval", context?, stats?} → {type:"delta"}… → {type:"done", assistantMessage}
// | {type:"error", code, message}. "retrieval" carries the passages sent to the model and the query
// embedding's timing as soon as search is done.
// The assistant message is saved before "done"; a client disconnect aborts generation and keeps
// any partial reply (metadata.aborted).
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

      send({ type: "start", conversationId: ctx.conversationId, userMessage: toCamel(ctx.userMessageRow) });

      let turn = null;
      let partial = "";
      try {
        turn = await runPipelineTurn({
          admin: ctx.admin,
          projectId: ctx.projectId,
          config: ctx.config,
          query: ctx.content,
          history,
          channel: "playground",
          stream: true,
          abortSignal: abort.signal,
        });
        send({ type: "retrieval", context: turnContext(turn), stats: turnStats(turn) });
        for await (const text of turn.textStream) {
          partial += text;
          send({ type: "delta", text });
        }
        const final = await turn.finalize();
        const aborted = Boolean(final.aborted) || abort.signal.aborted;
        if (aborted && !final.text) {
          settle({ status: "ok", turn, final, aborted: true });
          return;
        }
        const saved = await saveAssistantMessage(ctx, turn, final, { aborted });
        if (!saved) {
          send({ type: "error", code: "service_unavailable", message: "Could not save the response." });
          settle({ status: "error", turn, final, error: { code: "service_unavailable" } });
          return;
        }
        send({ type: "done", assistantMessage: toCamel(saved) });
        settle({ status: "ok", turn, final, aborted });
      } catch (error) {
        if (abort.signal.aborted) {
          if (partial) await saveAssistantMessage(ctx, turn, partialAnswer(turn, partial), { aborted: true });
          settle({ status: "ok", turn, aborted: true });
          return;
        }
        const apiError = toApiError(error);
        let saved = null;
        if (partial) saved = await saveAssistantMessage(ctx, turn, partialAnswer(turn, partial), { errorCode: apiError.code });
        else await rollbackTurn(ctx);
        send({
          type: "error",
          code: apiError.code,
          message: apiError.message,
          ...(saved ? { assistantMessage: toCamel(saved) } : {}),
        });
        settle({ status: "error", turn, error: apiError });
      } finally {
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

export const POST = handle(async (request) => {
  const body = await request.json().catch(() => null);
  const projectId = body?.projectId;

  // Non-uuid/missing projectId resolves inside requirePermission -> 404 "Project not found."
  const { admin, user } = await requirePermission(request, projectId, "grey.playground.view");

  const content = typeof body?.content === "string" ? body.content.trim() : "";
  const pipelineId = body?.pipelineId;
  if (!content || content.length > MAX_CONTENT_LENGTH || !isUuid(pipelineId)) {
    throw new ApiError("invalid_input", 422, "content and pipelineId are required.");
  }

  // Draft pipeline + clamped session overrides (404 when the pipeline isn't in this project).
  const config = await resolvePipelineConfig({
    admin, projectId, pipelineId, channel: "playground", overrides: body?.overrides,
  }).catch((error) => {
    throw toApiError(error);
  });

  let conversationId = body?.conversationId ?? null;
  let createdConversation = false;
  if (conversationId) {
    if (!isUuid(conversationId)) throw new ApiError("not_found", 404, "Conversation not found.");
    // Must belong to this project, this caller and the playground channel, else 404.
    const { data: conversation, error: conversationError } = await admin.from("conversations")
      .select("id").eq("id", conversationId).eq("project_id", projectId)
      .eq("user_id", user.id).eq("channel", "playground").is("deleted_at", null).maybeSingle();
    if (conversationError) {
      console.error("[api.chat.conversation]", conversationError);
      throw new ApiError("service_unavailable", 503, "The service is unavailable.");
    }
    if (!conversation) throw new ApiError("not_found", 404, "Conversation not found.");
  } else {
    const { data: conversation, error: conversationError } = await admin.from("conversations").insert({
      project_id: projectId,
      pipeline_id: pipelineId,
      user_id: user.id,
      title: content.slice(0, 60),
      channel: "playground",
      created_by: user.id,
    }).select("id").maybeSingle();
    if (conversationError || !conversation) {
      console.error("[api.chat.createConversation]", conversationError);
      throw new ApiError("service_unavailable", 503, "Could not start the conversation.");
    }
    conversationId = conversation.id;
    createdConversation = true;
  }

  const history = createdConversation ? [] : await loadHistory(admin, projectId, conversationId);

  const { data: userMessageRow, error: userMessageError } = await admin.from("messages").insert({
    project_id: projectId,
    conversation_id: conversationId,
    role: "user",
    content,
    created_by: user.id,
  }).select("*").maybeSingle();
  if (userMessageError || !userMessageRow) {
    console.error("[api.chat.userMessage]", userMessageError);
    throw new ApiError("service_unavailable", 503, "Could not send the message.");
  }

  const ctx = {
    admin, user, projectId, pipelineId, conversationId, createdConversation, userMessageRow, content, config,
    startedAt: Date.now(),
  };
  // Logs and usage are written once the turn settles, after the response has gone out.
  let settle;
  const outcome = new Promise((resolve) => {
    settle = (result) => resolve({ latencyMs: Date.now() - ctx.startedAt, ...result });
  });
  after(async () => writeTurnLogs(ctx, await outcome));

  if (body?.stream === true) return streamTurn(request, ctx, history, settle);

  let turn;
  try {
    turn = await runPipelineTurn({
      admin, projectId, config, query: content, history, channel: "playground", stream: false, abortSignal: request.signal,
    });
  } catch (error) {
    const apiError = toApiError(error);
    settle({ status: "error", error: apiError });
    await rollbackTurn(ctx);
    throw apiError;
  }

  const assistantMessageRow = await saveAssistantMessage(ctx, turn, turn);
  if (!assistantMessageRow) {
    settle({ status: "error", turn, final: turn, error: { code: "service_unavailable" } });
    await rollbackTurn(ctx);
    throw new ApiError("service_unavailable", 503, "Could not generate a response.");
  }
  settle({ status: "ok", turn, final: turn });

  return json({
    conversationId,
    userMessage: toCamel(userMessageRow),
    assistantMessage: toCamel(assistantMessageRow),
  });
});
