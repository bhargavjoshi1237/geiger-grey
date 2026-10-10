import { handle, json, ApiError } from "@/lib/server/errors";
import { requirePermission, isUuid } from "@/lib/server/auth";
import { toCamel } from "@/lib/server/case";

export const runtime = "nodejs";

const MAX_CONTENT_LENGTH = 8000;

// Up to 3 chunks from the pipeline's knowledge bases, else up to 3 sources. Never throws —
// a citation lookup failure degrades to [] instead of failing the reply.
async function buildCitations(admin, projectId, kbIds) {
  if (!kbIds?.length) return [];

  try {
    const chunksResult = await admin.from("chunks")
      .select("id,source_id,content,page,start_ms")
      .eq("project_id", projectId).in("kb_id", kbIds).is("deleted_at", null)
      .order("created_at", { ascending: false }).limit(3);
    if (chunksResult.error) throw chunksResult.error;
    const chunkRows = chunksResult.data ?? [];

    if (chunkRows.length) {
      const sourceIds = [...new Set(chunkRows.map((row) => row.source_id))];
      const sourcesResult = await admin.from("sources").select("id,name")
        .eq("project_id", projectId).in("id", sourceIds).is("deleted_at", null);
      if (sourcesResult.error) throw sourcesResult.error;
      const titleById = new Map((sourcesResult.data ?? []).map((row) => [row.id, row.name]));
      return chunkRows.map((row) => ({
        sourceId: row.source_id,
        chunkId: row.id,
        title: titleById.get(row.source_id) ?? null,
        page: row.page ?? null,
        startMs: row.start_ms ?? null,
        snippet: row.content ? row.content.slice(0, 200) : null,
      }));
    }

    const sourcesResult = await admin.from("sources").select("id,name")
      .eq("project_id", projectId).in("kb_id", kbIds).is("deleted_at", null).limit(3);
    if (sourcesResult.error) throw sourcesResult.error;
    return (sourcesResult.data ?? []).map((row) => ({
      sourceId: row.id, chunkId: null, title: row.name ?? null, page: null, startMs: null, snippet: null,
    }));
  } catch (error) {
    console.error("[api.chat.citations]", error);
    return [];
  }
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

  const { data: pipeline, error: pipelineError } = await admin.from("pipelines")
    .select("id,kb_ids").eq("id", pipelineId).eq("project_id", projectId).is("deleted_at", null).maybeSingle();
  if (pipelineError) {
    console.error("[api.chat.pipeline]", pipelineError);
    throw new ApiError("service_unavailable", 503, "The service is unavailable.");
  }
  if (!pipeline) throw new ApiError("not_found", 404, "Pipeline not found.");

  let conversationId = body?.conversationId ?? null;
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
  }

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

  const startedAt = Date.now();
  const citations = await buildCitations(admin, projectId, pipeline.kb_ids);
  const latencyMs = Date.now() - startedAt;

  const assistantContent = `Grey retrieval backend not connected yet — this is a placeholder answer for: "${content}". Once ingestion and a model provider are connected, answers will be generated from your knowledge bases.`;

  const { data: assistantMessageRow, error: assistantMessageError } = await admin.from("messages").insert({
    project_id: projectId,
    conversation_id: conversationId,
    role: "assistant",
    content: assistantContent,
    citations,
    metadata: { placeholder: true },
    latency_ms: latencyMs,
    created_by: user.id,
  }).select("*").maybeSingle();
  if (assistantMessageError || !assistantMessageRow) {
    console.error("[api.chat.assistantMessage]", assistantMessageError);
    // Roll back the user message so the conversation doesn't carry an orphaned turn.
    const { error: rollbackError } = await admin.from("messages")
      .update({ deleted_at: new Date().toISOString() }).eq("id", userMessageRow.id);
    if (rollbackError) console.error("[api.chat.rollback]", rollbackError);
    throw new ApiError("service_unavailable", 503, "Could not generate a response.");
  }

  const { error: requestLogError } = await admin.from("request_logs").insert({
    project_id: projectId,
    pipeline_id: pipelineId,
    conversation_id: conversationId,
    channel: "playground",
    query: content,
    status: "stub",
    latency_ms: latencyMs,
    created_by: user.id,
  });
  if (requestLogError) console.error("[api.chat.requestLog]", requestLogError);

  const { error: usageEventError } = await admin.from("usage_events").insert({
    project_id: projectId,
    kind: "retrieval",
    quantity: 1,
    cost: 0,
    ref_type: "conversation",
    ref_id: conversationId,
    created_by: user.id,
  });
  if (usageEventError) console.error("[api.chat.usageEvent]", usageEventError);

  return json({
    conversationId,
    userMessage: toCamel(userMessageRow),
    assistantMessage: toCamel(assistantMessageRow),
  });
});
