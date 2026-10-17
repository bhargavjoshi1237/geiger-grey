import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_QUERY_CHARS,
  chatCompletion,
  completionChunk,
  completionId,
  engineErrorToOpenAI,
  openAIErrorBody,
  parseChatRequest,
  pipelineModelId,
  toFinishReason,
  usageChunk,
} from "./openai_frames.js";

const user = (content) => ({ role: "user", content });

test("model id and completion id", () => {
  assert.equal(pipelineModelId("p1", 3), "grey/p1@v3");
  assert.match(completionId(), /^chatcmpl-[0-9a-f]{32}$/);
});

test("parses a plain conversation; system turns are ignored", () => {
  const r = parseChatRequest({
    model: "anything",
    messages: [
      { role: "system", content: "be nice" },
      user("Hi"),
      { role: "assistant", content: "Hello!" },
      user("  What is Grey?  "),
    ],
  });
  assert.equal(r.ok, true);
  assert.equal(r.value.query, "What is Grey?");
  assert.deepEqual(r.value.history, [user("Hi"), { role: "assistant", content: "Hello!" }]);
  assert.equal(r.value.stream, false);
  assert.equal(r.value.includeUsage, false);
  assert.equal(r.value.temperature, null);
  assert.equal(r.value.maxTokens, null);
});

test("text parts are joined; image parts are rejected", () => {
  const ok = parseChatRequest({ messages: [user([{ type: "text", text: "a" }, { type: "text", text: "b" }])] });
  assert.equal(ok.value.query, "ab");
  const bad = parseChatRequest({ messages: [user([{ type: "image_url", image_url: { url: "x" } }])] });
  assert.equal(bad.ok, false);
  assert.equal(bad.error.param, "messages[0].content");
});

test("tools, function calling and n > 1 are rejected", () => {
  assert.equal(parseChatRequest({ messages: [user("x")], tools: [{ type: "function" }] }).error.param, "tools");
  assert.equal(parseChatRequest({ messages: [user("x")], tool_choice: "auto" }).error.param, "tools");
  assert.equal(parseChatRequest({ messages: [user("x")], n: 2 }).error.param, "n");
  assert.equal(parseChatRequest({ messages: [user("x")], tools: [] }).ok, true);
  assert.equal(parseChatRequest({ messages: [user("x")], n: 1 }).ok, true);
});

test("the last message must be a non-empty user turn within the length limit", () => {
  assert.equal(parseChatRequest({ messages: [] }).ok, false);
  assert.equal(parseChatRequest({ messages: [{ role: "assistant", content: "x" }] }).ok, false);
  assert.equal(parseChatRequest({ messages: [user("   ")] }).ok, false);
  assert.equal(parseChatRequest({ messages: [user("a".repeat(MAX_QUERY_CHARS + 1))] }).ok, false);
  assert.equal(parseChatRequest({ messages: [{ role: "tool", content: "x" }, user("q")] }).ok, false);
  assert.equal(parseChatRequest(null).ok, false);
});

test("sampling and streaming options are validated", () => {
  const r = parseChatRequest({
    messages: [user("q")],
    stream: true,
    stream_options: { include_usage: true },
    temperature: 0.4,
    max_tokens: 100,
    max_completion_tokens: 50,
    user: "u-1",
  });
  assert.deepEqual(
    { ...r.value, history: undefined, query: undefined },
    { query: undefined, history: undefined, stream: true, includeUsage: true, temperature: 0.4, maxTokens: 50, user: "u-1" },
  );
  assert.equal(parseChatRequest({ messages: [user("q")], temperature: 3 }).error.param, "temperature");
  assert.equal(parseChatRequest({ messages: [user("q")], max_tokens: 0 }).error.param, "max_tokens");
  assert.equal(parseChatRequest({ messages: [user("q")], stream: "yes" }).error.param, "stream");
});

test("non-stream completion shape", () => {
  const body = chatCompletion({
    id: "chatcmpl-1",
    created: 10,
    model: "grey/p@v1",
    text: "Answer [1]",
    finishReason: "stop",
    usage: { tokensIn: 7, tokensOut: 3 },
    citations: [{ index: 1 }],
  });
  assert.equal(body.object, "chat.completion");
  assert.deepEqual(body.choices[0].message, { role: "assistant", content: "Answer [1]", refusal: null });
  assert.equal(body.choices[0].finish_reason, "stop");
  assert.deepEqual(body.usage, { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 });
  assert.deepEqual(body.citations, [{ index: 1 }]);
});

test("stream chunk framing", () => {
  const first = completionChunk({ id: "c", created: 1, model: "m", delta: { role: "assistant", content: "" }, extra: { citations: [] } });
  assert.equal(first.object, "chat.completion.chunk");
  assert.deepEqual(first.choices, [{ index: 0, delta: { role: "assistant", content: "" }, logprobs: null, finish_reason: null }]);
  assert.deepEqual(first.citations, []);
  const last = completionChunk({ id: "c", created: 1, model: "m", finishReason: "length" });
  assert.equal(last.choices[0].finish_reason, "length");
  assert.deepEqual(last.choices[0].delta, {});
  const usage = usageChunk({ id: "c", created: 1, model: "m", usage: { tokensIn: 1, tokensOut: 2 } });
  assert.deepEqual(usage.choices, []);
  assert.equal(usage.usage.total_tokens, 3);
});

test("finish reasons map onto OpenAI's", () => {
  assert.equal(toFinishReason("stop"), "stop");
  assert.equal(toFinishReason("length"), "length");
  assert.equal(toFinishReason("content-filter"), "content_filter");
  assert.equal(toFinishReason("no_context"), "stop");
  assert.equal(toFinishReason(null), "stop");
});

test("error bodies and engine error mapping", () => {
  assert.deepEqual(openAIErrorBody(401, "invalid_api_key", "Invalid API key."), {
    error: { message: "Invalid API key.", type: "authentication_error", code: "invalid_api_key", param: null },
  });
  assert.equal(openAIErrorBody(429, "rate_limited", "x").error.type, "rate_limit_error");
  assert.equal(openAIErrorBody(400, "invalid_request", "x", "messages").error.param, "messages");
  assert.equal(openAIErrorBody(502, "upstream_error", "x").error.type, "api_error");
  assert.deepEqual(engineErrorToOpenAI({ code: "provider_auth", status: 502, message: "raw" }), {
    status: 502,
    code: "upstream_error",
    message: "The pipeline's model provider rejected its API key.",
  });
  assert.deepEqual(engineErrorToOpenAI({ code: "pipeline_not_live", status: 409, message: "m" }), {
    status: 409,
    code: "pipeline_not_live",
    message: "m",
  });
  assert.equal(engineErrorToOpenAI({ code: "x", status: undefined, message: "m" }).status, 500);
});
