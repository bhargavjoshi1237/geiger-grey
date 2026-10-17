import { isUuid } from "@/lib/server/auth";
import { authenticateApiKey } from "@/lib/server/api_key_auth";
import { scheduleDeliveryLog } from "@/lib/server/delivery_log";
import { OpenAIError, handleOpenAI, openAIErrorResponse, openAIJson, toOpenAIError } from "@/lib/server/openai_format";
import { SSE_DONE, createEventStream, encodeSseData, sseResponse } from "@/lib/server/sse";
import { resolvePipelineConfig } from "@/lib/engine/pipeline_config";
import { runPipelineTurn } from "@/lib/engine/turn";
import { parseCitationIndices } from "@/lib/grey/citations";
import {
  chatCompletion,
  completionChunk,
  completionId,
  nowSeconds,
  parseChatRequest,
  pipelineModelId,
  toFinishReason,
  usageChunk,
} from "@/lib/grey/openai_frames";

export const runtime = "nodejs";
export const maxDuration = 300;

// Links the route's abort controller to the client connection.
function linkAbort(request, controller) {
  const onAbort = () => controller.abort();
  request.signal?.addEventListener?.("abort", onAbort, { once: true });
  return () => request.signal?.removeEventListener?.("abort", onAbort);
}

// Citations a partial (aborted/failed) reply already references.
function citedSubset(citations, text) {
  const byIndex = new Map((citations || []).map((c) => [c.index, c]));
  return parseCitationIndices(text).map((n) => byIndex.get(n)).filter(Boolean);
}

// SSE: first chunk = delta.role + citations (every context block, so markers resolve while
// streaming); content deltas; final chunk with finish_reason (+ the citations actually used);
// optional usage chunk; [DONE]. The first delta is awaited before the response starts, so a
// provider failure up front is a real HTTP error rather than an in-stream one.
async function streamCompletion({ turn, frame, includeUsage, headers, settle, abort, unlink }) {
  let first;
  try {
    first = await turn.textStream.next();
  } catch (error) {
    unlink();
    settle({ status: "error", turn, error: { code: error?.code || "internal_error" } });
    return openAIErrorResponse(error, headers);
  }

  const body = createEventStream(
    async (write) => {
      let text = "";
      try {
        write(encodeSseData(completionChunk({ ...frame, delta: { role: "assistant", content: "" }, extra: { citations: turn.citations ?? [] } })));
        if (!first.done && first.value) {
          text += first.value;
          write(encodeSseData(completionChunk({ ...frame, delta: { content: first.value } })));
        }
        if (!first.done) {
          for await (const delta of turn.textStream) {
            text += delta;
            if (!write(encodeSseData(completionChunk({ ...frame, delta: { content: delta } })))) abort.abort();
          }
        }
        const final = await turn.finalize();
        const aborted = Boolean(final.aborted) || abort.signal.aborted;
        write(
          encodeSseData(
            completionChunk({ ...frame, finishReason: toFinishReason(final.finishReason), extra: { citations: final.citations ?? [] } }),
          ),
        );
        if (includeUsage) write(encodeSseData(usageChunk({ ...frame, usage: final.usage })));
        write(SSE_DONE);
        settle({ status: "ok", turn, final, aborted });
      } catch (error) {
        if (abort.signal.aborted) {
          settle({ status: "ok", turn, final: { text, citations: citedSubset(turn.citations, text), model: turn.model }, aborted: true });
          return;
        }
        const { body: errorBody } = toOpenAIError(error);
        write(encodeSseData(errorBody));
        settle({ status: "error", turn, error: { code: errorBody.error.code } });
      } finally {
        unlink();
      }
    },
    { onCancel: () => abort.abort() },
  );
  return sseResponse(body, headers);
}

// OpenAI-compatible chat completions over a published pipeline. `model` is ignored and echoed
// as grey/<pipelineId>@v<n>; no conversations rows are written for API calls.
export const POST = handleOpenAI(async (request, { params }) => {
  const { pipelineId } = await params;
  const auth = await authenticateApiKey(request, { scope: "chat", pipelineId });
  const { admin, key, projectId, headers } = auth;

  try {
    if (!isUuid(pipelineId)) throw new OpenAIError(404, "pipeline_not_found", "Pipeline not found.");
    const body = await request.json().catch(() => undefined);
    if (body === undefined) throw new OpenAIError(400, "invalid_json", "We could not parse the JSON body of your request.");
    const parsed = parseChatRequest(body);
    if (!parsed.ok) {
      throw new OpenAIError(400, parsed.error.code, parsed.error.message, { param: parsed.error.param });
    }
    const input = parsed.value;

    const config = await resolvePipelineConfig({
      admin,
      projectId,
      pipelineId,
      channel: "api",
      overrides: { temperature: input.temperature, maxTokens: input.maxTokens },
    });
    const frame = { id: completionId(), created: nowSeconds(), model: pipelineModelId(pipelineId, config.version) };

    const settle = scheduleDeliveryLog({
      admin,
      projectId,
      pipelineId,
      pipelineVersion: config.version,
      apiKeyId: key.id,
      channel: "api",
      query: input.query,
      // One retrieval per completed turn; error outcomes are never charged.
      billed: true,
      refType: "api_key",
      refId: key.id,
      metadata: { endpoint: "chat.completions", stream: input.stream, ...(input.user ? { user: input.user } : {}) },
    });

    const abort = new AbortController();
    const unlink = linkAbort(request, abort);
    let turn;
    try {
      turn = await runPipelineTurn({
        admin,
        projectId,
        config,
        query: input.query,
        history: input.history,
        channel: "api",
        stream: input.stream,
        abortSignal: abort.signal,
      });
    } catch (error) {
      unlink();
      settle({ status: "error", error: { code: error?.code || "internal_error" } });
      throw error;
    }

    if (input.stream) {
      return streamCompletion({ turn, frame, includeUsage: input.includeUsage, headers, settle, abort, unlink });
    }

    unlink();
    settle({ status: "ok", turn, final: turn });
    return openAIJson(
      chatCompletion({ ...frame, text: turn.text, finishReason: turn.finishReason, usage: turn.usage, citations: turn.citations }),
      { headers },
    );
  } catch (error) {
    return openAIErrorResponse(error, headers);
  }
});
