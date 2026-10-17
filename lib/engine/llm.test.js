import { test } from "node:test";
import assert from "node:assert/strict";
import { generateText } from "ai";
import { getProcessingModel, resolveModel } from "./llm.js";
import { OTHER_PROJECT, PROJECT, fakeAdmin, jsonResponse, provider, stubFetch } from "./test_helpers.js";

// Local / custom provider URLs are opt-in (localProvidersAllowed); with the opt-in, custom
// URLs skip DNS and use the stubbed global fetch instead of the pinned transport.
process.env.GREY_ALLOW_LOCAL_PROVIDERS = "1";

const anthropic = provider(1, "anthropic", { models: ["claude-sonnet-5-5"] });
const openai = provider(2, "openai", { models: ["gpt-4.1"] });
const compat = provider(3, "openai_compatible", { base_url: "http://localhost:8000/v1", models: ["llama"] });
const cohere = provider(4, "cohere");
const bare = provider(5, "openai", { models: [] });
const foreign = provider(6, "openai", { project_id: OTHER_PROJECT, models: ["gpt-4.1"] });
const tables = {
  model_providers: [anthropic, openai, compat, cohere, bare, foreign],
  project_settings: [{ project_id: PROJECT, processing_provider_id: anthropic.id, processing_model: "claude-haiku-5-5", deleted_at: null }],
};
const secrets = { [anthropic.id]: "sk-ant", [openai.id]: "sk-oai", [cohere.id]: "co", [bare.id]: "sk-b", [foreign.id]: "sk-f" };
const admin = fakeAdmin({ tables, secrets });
const codeIs = (code) => (err) => err.code === code;

test("hosted pipelines fail while Grey hosted is switched off", async () => {
  await assert.rejects(resolveModel({ admin, projectId: PROJECT, config: { providerId: "grey-hosted", model: "grey-fast" } }), (err) => {
    assert.equal(err.code, "hosted_unavailable");
    assert.match(err.message, /choose one of your own providers/);
    return true;
  });
  await assert.rejects(
    resolveModel({ admin, projectId: PROJECT, config: { providerId: null, metadata: { hostedProvider: true } } }),
    codeIs("hosted_unavailable"),
  );
});

test("builds models per driver and reports temperature support", async () => {
  const claude = await resolveModel({ admin, projectId: PROJECT, config: { providerId: anthropic.id, model: "claude-sonnet-5-5" } });
  assert.equal(claude.modelId, "claude-sonnet-5-5");
  assert.equal(claude.model.modelId, "claude-sonnet-5-5");
  assert.equal(claude.providerKind, "anthropic");
  assert.equal(claude.hosted, false);
  assert.equal(claude.supportsTemperature, false);

  const gpt = await resolveModel({ admin, projectId: PROJECT, config: { providerId: openai.id } });
  assert.equal(gpt.modelId, "gpt-4.1", "falls back to the connection's first model");
  assert.equal(gpt.supportsTemperature, true);

  const local = await resolveModel({ admin, projectId: PROJECT, config: { providerId: compat.id, model: "llama" } });
  assert.equal(local.providerKind, "openai_compatible");
  assert.match(local.model.provider, /openai-compatible/);
});

test("resolution errors", async () => {
  await assert.rejects(resolveModel({ admin, projectId: PROJECT, config: {} }), codeIs("no_provider"));
  await assert.rejects(resolveModel({ admin, projectId: PROJECT, config: { providerId: foreign.id } }), codeIs("provider_not_found"));
  await assert.rejects(resolveModel({ admin, projectId: PROJECT, config: { providerId: cohere.id } }), codeIs("capability_missing"));
  await assert.rejects(resolveModel({ admin, projectId: PROJECT, config: { providerId: bare.id } }), codeIs("no_model"));
  const keyless = fakeAdmin({ tables });
  await assert.rejects(resolveModel({ admin: keyless, projectId: PROJECT, config: { providerId: anthropic.id } }), codeIs("no_key"));
});

test("processing model comes from project settings", async () => {
  const resolved = await getProcessingModel({ admin, projectId: PROJECT });
  assert.equal(resolved.modelId, "claude-haiku-5-5");
  assert.equal(await getProcessingModel({ admin, projectId: OTHER_PROJECT }), null);
});

test("custom base URLs send chat requests through providerFetch (redirect: error)", async () => {
  const completion = {
    id: "c1",
    object: "chat.completion",
    created: 0,
    model: "llama",
    choices: [{ index: 0, message: { role: "assistant", content: "pong" }, finish_reason: "stop" }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  };
  const stub = stubFetch(() => jsonResponse(completion));
  try {
    const { model } = await resolveModel({ admin, projectId: PROJECT, config: { providerId: compat.id, model: "llama" } });
    const out = await generateText({ model, prompt: "ping", maxRetries: 0 });
    assert.equal(out.text, "pong");
    assert.equal(stub.calls[0].url, "http://localhost:8000/v1/chat/completions");
    assert.equal(stub.calls[0].init.redirect, "error");
  } finally {
    stub.restore();
  }
});
