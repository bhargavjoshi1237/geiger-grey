// OpenAI-compatible request parsing and response framing for
// /api/v1/pipelines/:id/chat/completions (spec §12.2). Pure — the route and
// lib/server/openai_format.js do the I/O.

export const MAX_QUERY_CHARS = 8000;
const MAX_MESSAGES = 200;
const TEXT_PART_TYPES = new Set(["text", "input_text"]);
const CONVERSATION_ROLES = new Set(["user", "assistant"]);
// Instructions come from the pipeline's own prompt; client system turns are accepted and ignored.
const IGNORED_ROLES = new Set(["system", "developer"]);

// "grey/<pipelineId>@v<version>" — what `model` echoes back.
export function pipelineModelId(pipelineId, version) {
  return `grey/${pipelineId}@v${version}`;
}

export function completionId() {
  return `chatcmpl-${globalThis.crypto.randomUUID().replace(/-/g, "")}`;
}

export const nowSeconds = (now = Date.now()) => Math.floor(now / 1000);

const fail = (message, param = null, code = "invalid_request") => ({ ok: false, error: { message, param, code } });

// Message content -> text, or null when it carries non-text parts.
function contentText(content) {
  if (typeof content === "string") return content;
  if (content === null || content === undefined) return "";
  if (!Array.isArray(content)) return null;
  let text = "";
  for (const part of content) {
    if (typeof part === "string") {
      text += part;
      continue;
    }
    if (!part || !TEXT_PART_TYPES.has(part.type) || typeof part.text !== "string") return null;
    text += part.text;
  }
  return text;
}

const isPresent = (value) => value !== undefined && value !== null;

// Validates an OpenAI chat request body.
// -> { ok: true, value: { query, history, stream, includeUsage, temperature, maxTokens, user } }
//  | { ok: false, error: { message, param, code } }
export function parseChatRequest(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return fail("The request body must be a JSON object.");
  }
  if (Array.isArray(body.tools) ? body.tools.length > 0 : isPresent(body.tools)) {
    return fail("Tools aren't supported by Grey pipelines.", "tools", "unsupported_parameter");
  }
  if (isPresent(body.functions) || isPresent(body.tool_choice) || isPresent(body.function_call)) {
    return fail("Tools aren't supported by Grey pipelines.", "tools", "unsupported_parameter");
  }
  if (isPresent(body.n) && Number(body.n) !== 1) {
    return fail("Only n = 1 is supported.", "n", "unsupported_value");
  }

  const messages = body.messages;
  if (!Array.isArray(messages) || !messages.length) {
    return fail("messages must be a non-empty array.", "messages");
  }
  if (messages.length > MAX_MESSAGES) {
    return fail(`messages can hold at most ${MAX_MESSAGES} entries.`, "messages");
  }

  const turns = [];
  for (let i = 0; i < messages.length; i += 1) {
    const message = messages[i];
    const role = message?.role;
    if (IGNORED_ROLES.has(role)) continue;
    if (!CONVERSATION_ROLES.has(role)) {
      return fail(`messages[${i}].role must be one of system, developer, user or assistant.`, `messages[${i}].role`);
    }
    const text = contentText(message.content);
    if (text === null) {
      return fail("Only text content is supported.", `messages[${i}].content`, "unsupported_content");
    }
    turns.push({ role, content: text });
  }

  const last = turns.at(-1);
  const query = last?.role === "user" ? last.content.trim() : "";
  if (!query) return fail("The last message must be a non-empty user message.", "messages");
  if (query.length > MAX_QUERY_CHARS) {
    return fail(`The last user message can be at most ${MAX_QUERY_CHARS} characters.`, "messages");
  }
  const history = turns.slice(0, -1).filter((t) => t.content.trim());

  if (isPresent(body.stream) && typeof body.stream !== "boolean") return fail("stream must be a boolean.", "stream");
  const includeUsage = body.stream_options?.include_usage === true;

  let temperature = null;
  if (isPresent(body.temperature)) {
    const t = Number(body.temperature);
    if (typeof body.temperature !== "number" || !Number.isFinite(t) || t < 0 || t > 2) {
      return fail("temperature must be a number between 0 and 2.", "temperature");
    }
    temperature = t;
  }

  let maxTokens = null;
  const maxParam = isPresent(body.max_completion_tokens) ? "max_completion_tokens" : "max_tokens";
  if (isPresent(body[maxParam])) {
    const n = body[maxParam];
    if (!Number.isInteger(n) || n < 1) return fail(`${maxParam} must be a positive integer.`, maxParam);
    maxTokens = n;
  }

  let user = null;
  if (isPresent(body.user)) {
    if (typeof body.user !== "string") return fail("user must be a string.", "user");
    user = body.user.slice(0, 128) || null;
  }

  return {
    ok: true,
    value: { query, history, stream: body.stream === true, includeUsage, temperature, maxTokens, user },
  };
}

export function toOpenAIUsage(usage) {
  const prompt = Number(usage?.tokensIn) || 0;
  const completion = Number(usage?.tokensOut) || 0;
  return { prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion };
}

// AI SDK / engine finish reasons -> OpenAI's.
export function toFinishReason(reason) {
  if (reason === "length") return "length";
  if (reason === "content-filter" || reason === "content_filter") return "content_filter";
  return "stop";
}

export function chatCompletion({ id, created, model, text, finishReason, usage, citations }) {
  return {
    id,
    object: "chat.completion",
    created,
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: text ?? "", refusal: null },
        logprobs: null,
        finish_reason: toFinishReason(finishReason),
      },
    ],
    usage: toOpenAIUsage(usage),
    system_fingerprint: null,
    citations: citations ?? [],
  };
}

// One chat.completion.chunk. `extra` adds top-level fields (citations, usage).
export function completionChunk({ id, created, model, delta = {}, finishReason = null, extra } = {}) {
  return {
    id,
    object: "chat.completion.chunk",
    created,
    model,
    system_fingerprint: null,
    choices: [{ index: 0, delta, logprobs: null, finish_reason: finishReason }],
    ...(extra || {}),
  };
}

// The trailing usage chunk sent when stream_options.include_usage is true.
export function usageChunk({ id, created, model, usage }) {
  return { id, object: "chat.completion.chunk", created, model, system_fingerprint: null, choices: [], usage: toOpenAIUsage(usage) };
}

export function openAIErrorType(status) {
  if (status === 401) return "authentication_error";
  if (status === 403) return "permission_error";
  if (status === 429) return "rate_limit_error";
  if (status >= 500) return "api_error";
  return "invalid_request_error";
}

export function openAIErrorBody(status, code, message, param = null) {
  return { error: { message, type: openAIErrorType(status), code: code ?? null, param } };
}

// Engine error -> { status, code, message } for OpenAI clients. The pipeline's own
// provider rejecting its key is an upstream failure (502), never a Grey 401.
export function engineErrorToOpenAI({ code, status, message }) {
  if (code === "provider_auth") {
    return { status: 502, code: "upstream_error", message: "The pipeline's model provider rejected its API key." };
  }
  const n = Number(status);
  return { status: Number.isInteger(n) && n >= 400 && n <= 599 ? n : 500, code: code || "internal_error", message };
}
