// Grounded answer generation (spec §8.3–8.4, §8.6): numbered context blocks + grounding
// rules, the pipeline's own provider/model through the AI SDK, citations resolved from the
// [n] markers. Empty retrieval never calls the model.
import { generateText, streamText } from "ai";
import { resolveModel } from "./llm.js";
import { EngineError } from "./errors.js";
import { mapLlmError } from "../grey/llm_errors.js";
import { isTemperatureRejection } from "../grey/model_caps.js";
import { formatFacts } from "../grey/graph_router.js";
import { NO_CONTEXT_ANSWER, buildContextBlocks, buildSystemPrompt, windowHistory } from "../grey/prompt.js";
import { contextCitations, mapCitations } from "../grey/citations.js";

const FIRST_TOKEN_TIMEOUT_MS = 60_000;
const GENERATE_TIMEOUT_MS = 120_000;
const HOSTED_ID = "grey-hosted";

const toUsage = (usage) => ({ tokensIn: usage?.inputTokens ?? 0, tokensOut: usage?.outputTokens ?? 0 });

// A finished answer exposed through the stream contract: one delta, then finalize().
export function staticAnswerStream(result) {
  return {
    textStream: (async function* () {
      if (result.text) yield result.text;
    })(),
    citations: result.citations,
    model: result.model,
    finalize: async () => result,
  };
}

// provider_auth means the stored key is bad: flag the connection so Model Providers shows it.
async function markProviderError(admin, projectId, providerId) {
  if (!providerId || providerId === HOSTED_ID) return;
  try {
    const { error } = await admin
      .from("model_providers")
      .update({ status: "error", last_checked_at: new Date().toISOString() })
      .eq("id", providerId)
      .eq("project_id", projectId);
    if (error) console.error("[engine.answer.markProviderError]", error.message);
  } catch (error) {
    console.error("[engine.answer.markProviderError]", error?.message);
  }
}

// Any failure becomes an EngineError with a mapped code and a safe message — raw provider text
// never leaves this module.
async function toEngineError(error, { admin, projectId, config, abortSignal }) {
  if (error instanceof EngineError) return error;
  if (abortSignal?.aborted) return new EngineError("aborted", "The request was cancelled.", { status: 499 });
  const mapped = mapLlmError(error);
  console.error("[engine.answer]", mapped.code, mapped.providerStatus ?? "");
  if (mapped.markProviderError) await markProviderError(admin, projectId, config?.providerId);
  return new EngineError(mapped.code, mapped.message, { status: mapped.status ?? 502, retryable: Boolean(mapped.retryable) });
}

// Non-stream call; one retry without sampling params when the provider rejects `temperature`.
async function generateWithRetry(call, temperature) {
  try {
    return await generateText({ ...call, ...(temperature === undefined ? {} : { temperature }) });
  } catch (error) {
    if (temperature === undefined || !isTemperatureRejection(error)) throw error;
    return generateText(call);
  }
}

// generateAnswer → non-stream { text, citations, usage: { tokensIn, tokensOut }, model: { id, provider },
// finishReason, noContext } | stream { textStream, citations, model, finalize(): Promise<non-stream (+ aborted)> }.
// `messages` is the conversation ending with the user's question.
export async function generateAnswer({
  admin,
  projectId,
  config,
  messages = [],
  chunks = [],
  facts = [],
  stream = false,
  abortSignal,
} = {}) {
  const list = Array.isArray(messages) ? messages : [];
  const last = list.at(-1);
  const question = last?.role === "user" ? String(last.content ?? "") : "";
  const history = windowHistory(last?.role === "user" ? list.slice(0, -1) : list);
  const citationsOn = config?.retrieval?.citations !== false;

  if (!chunks?.length) {
    const result = {
      text: NO_CONTEXT_ANSWER,
      citations: [],
      usage: { tokensIn: 0, tokensOut: 0 },
      model: { id: config?.model ?? null, provider: null },
      finishReason: "no_context",
      noContext: true,
    };
    return stream ? staticAnswerStream(result) : result;
  }

  const context = buildContextBlocks(chunks);
  const { system, user } = buildSystemPrompt({
    systemPrompt: config?.systemPrompt,
    citations: citationsOn,
    context: context.text,
    question,
    facts: facts?.length ? formatFacts(facts) : "",
  });

  const resolved = await resolveModel({ admin, projectId, config });
  const model = { id: resolved.modelId, provider: resolved.providerKind };
  // Omitted (provider default) when the model rejects sampling params or none is set.
  const temperature =
    resolved.supportsTemperature !== false && typeof config?.temperature === "number" && Number.isFinite(config.temperature)
      ? config.temperature
      : undefined;
  const maxOutputTokens = Number(config?.maxTokens) > 0 ? Math.round(Number(config.maxTokens)) : undefined;
  const call = {
    model: resolved.model,
    instructions: system,
    messages: [...history, { role: "user", content: user }],
    ...(maxOutputTokens ? { maxOutputTokens } : {}),
    abortSignal,
    maxRetries: 2,
  };
  const answer = (text, usage, finishReason) => ({
    text,
    citations: citationsOn ? mapCitations(text, context.chunks) : [],
    usage: toUsage(usage),
    model,
    finishReason: finishReason ?? null,
    noContext: false,
  });
  const fail = (error) => toEngineError(error, { admin, projectId, config, abortSignal });

  if (!stream) {
    try {
      const result = await generateWithRetry({ ...call, timeout: { totalMs: GENERATE_TIMEOUT_MS } }, temperature);
      return answer(result.text, result.usage, result.finishReason);
    } catch (error) {
      throw await fail(error);
    }
  }

  // Streaming: read the full event stream (textStream hides errors). A caller abort ends the
  // stream quietly with `aborted`; the SDK's first-token timeout surfaces as an `abort` part
  // too, so an abort the caller didn't ask for is a timeout.
  const state = { started: false, text: "", usage: null, finishReason: null, aborted: false, error: null };
  let markDone;
  const done = new Promise((resolve) => {
    markDone = resolve;
  });

  async function* produce() {
    state.started = true;
    let sampling = temperature;
    try {
      for (;;) {
        const result = streamText({
          ...call,
          ...(sampling === undefined ? {} : { temperature: sampling }),
          timeout: { firstChunkMs: FIRST_TOKEN_TIMEOUT_MS },
          onError: () => {}, // errors arrive as `error` parts; the default handler logs raw provider text
        });
        try {
          for await (const part of result.stream) {
            if (part.type === "text-delta" && part.text) {
              state.text += part.text;
              yield part.text;
            } else if (part.type === "finish") {
              state.usage = part.totalUsage;
              state.finishReason = part.finishReason;
            } else if (part.type === "error") {
              throw part.error;
            } else if (part.type === "abort" && !abortSignal?.aborted) {
              throw Object.assign(new Error(part.reason || "The model took too long to respond."), { name: "TimeoutError" });
            }
          }
          if (abortSignal?.aborted) state.aborted = true;
          return;
        } catch (error) {
          if (abortSignal?.aborted) {
            state.aborted = true;
            return;
          }
          if (sampling !== undefined && !state.text && isTemperatureRejection(error)) {
            sampling = undefined;
            continue;
          }
          throw error;
        }
      }
    } catch (error) {
      state.error = await fail(error);
      throw state.error;
    } finally {
      markDone();
    }
  }

  const textStream = produce();
  return {
    textStream,
    citations: citationsOn ? contextCitations(context.chunks) : [],
    model,
    finalize: async () => {
      if (!state.started) {
        // Nobody consumed the stream: drain it so the answer still completes.
        while (!(await textStream.next()).done) {
          // discard deltas
        }
      }
      await done;
      if (state.error) throw state.error;
      return { ...answer(state.text, state.usage, state.finishReason), aborted: state.aborted };
    },
  };
}
