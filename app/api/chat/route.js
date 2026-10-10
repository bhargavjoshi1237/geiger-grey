import { handle, json, ApiError } from "@/lib/server/errors";
import { requirePermission } from "@/lib/server/auth";
import { toCamel } from "@/lib/supabase/repository";

export const runtime = "nodejs";

// Up to 3 chunks from the pipeline's knowledge bases, else up to 3 sources.
async function buildCitations(admin, kbIds) {
  if (!kbIds?.length) return [];

  const { data: chunkRows } = await admin.from("chunks")
    .select("id,source_id,content,page,start_ms")
    .in("kb_id", kbIds).is("deleted_at", null).order("created_at", { ascending: false }).limit(3);
  if (chunkRows?.length) {
    const sourceIds = [...new Set(chunkRows.map((row) => row.source_id))];
    const { data: sourceRows } = await admin.from("sources").select("id,name").in("id", sourceIds);
    const titleById = new Map((sourceRows ?? []).map((row) => [row.id, row.name]));
    return chunkRows.map((row) => ({
      sourceId: row.source_id,
      chunkId: row.id,
      title: titleById.get(row.source_id) ?? null,
      page: row.page ?? null,
      startMs: row.start_ms ?? null,
      snippet: row.content ? row.content.slice(0, 200) : null,
    }));
  }

  const { data: sourceRows } = await admin.from("sources").select("id,name")
    .in("kb_id", kbIds).is("deleted_at", null).limit(3);
  return (sourceRows ?? []).map((row) => ({
    sourceId: row.id, chunkId: null, title: row.name ?? null, page: null, startMs: null, snippet: null,
  }));
}

export const POST = handle(async (request) => {
  const body = await request.json().catch(() => null);
  const projectId = body?.projectId;
  if (!projectId) throw new ApiError("invalid_input", 422, "projectId is required.");

  const { admin, user } = await requirePermission(request, projectId, "grey.playground.view");

  const content = body?.content;
  const pipelineId = body?.pipelineId;
  if (!content || !pipelineId) throw new ApiError("invalid_input", 422, "content and pipelineId are required.");

  const { data: pipeline, error: pipelineError } = await admin.from("pipelines")
    .select("id,kb_ids").eq("id", pipelineId).eq("project_id", projectId).is("deleted_at", null).maybeSingle();
  if (pipelineError) throw new ApiError("service_unavailable", 503, "The service is unavailable.");
  if (!pipeline) throw new ApiError("not_found", 404, "Pipeline not found.");

  let conversationId = body?.conversationId ?? null;
  if (conversationId) {
    const { data: conversation, error: conversationError } = await admin.from("conversations")
      .select("id").eq("id", conversationId).eq("project_id", projectId).is("deleted_at", null).maybeSingle();
    if (conversationError) throw new ApiError("service_unavailable", 503, "The service is unavailable.");
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
    if (conversationError || !conversation) throw new ApiError("service_unavailable", 503, "Could not start the conversation.");
    conversationId = conversation.id;
  }

  const { data: userMessageRow, error: userMessageError } = await admin.from("messages").insert({
    project_id: projectId,
    conversation_id: conversationId,
    role: "user",
    content,
    created_by: user.id,
  }).select("*").maybeSingle();
  if (userMessageError || !userMessageRow) throw new ApiError("service_unavailable", 503, "Could not send the message.");

  const startedAt = Date.now();
  const citations = await buildCitations(admin, pipeline.kb_ids);
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
  if (assistantMessageError || !assistantMessageRow) throw new ApiError("service_unavailable", 503, "Could not generate a response.");

  await admin.from("request_logs").insert({
    project_id: projectId,
    pipeline_id: pipelineId,
    conversation_id: conversationId,
    channel: "playground",
    query: content,
    status: "stub",
    latency_ms: latencyMs,
    created_by: user.id,
  });
  await admin.from("usage_events").insert({
    project_id: projectId,
    kind: "retrieval",
    quantity: 1,
    cost: 0,
    ref_type: "conversation",
    ref_id: conversationId,
    created_by: user.id,
  });

  return json({
    conversationId,
    userMessage: toCamel(userMessageRow),
    assistantMessage: toCamel(assistantMessageRow),
  });
});
