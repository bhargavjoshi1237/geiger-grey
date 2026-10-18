import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PROVIDER_KINDS,
  PROVIDER_PRESETS,
  capabilitiesOf,
  driverFormat,
  hasCapability,
  hasCustomBaseUrl,
  keyRequired,
  resolveBaseUrl,
  suggestedModelsFor,
  providerKindLabel,
} from "./provider_kinds.js";

const row = (provider, extra = {}) => ({ provider, metadata: {}, ...extra });

test("every kind declares a format for each fixed capability", () => {
  for (const [name, kind] of Object.entries(PROVIDER_KINDS)) {
    const caps = kind.capabilities === "user" ? kind.userCapabilities : kind.capabilities;
    for (const cap of caps) assert.ok(kind.formats[cap], `${name}.${cap} has no format`);
    assert.ok(["fixed", "editable", "required"].includes(kind.baseUrlMode), name);
  }
});

test("presets point at real kinds and capabilities", () => {
  for (const preset of PROVIDER_PRESETS) {
    const kind = PROVIDER_KINDS[preset.kind];
    assert.ok(kind, preset.id);
    const allowed = kind.capabilities === "user" ? kind.userCapabilities : kind.capabilities;
    for (const cap of preset.capabilities) assert.ok(allowed.includes(cap), `${preset.id}.${cap}`);
  }
});

test("capabilities per kind (spec §4.1)", () => {
  assert.deepEqual(capabilitiesOf(row("openai")), ["chat", "embed", "transcribe"]);
  assert.deepEqual(capabilitiesOf(row("anthropic")), ["chat"]);
  assert.deepEqual(capabilitiesOf(row("google")), ["chat", "embed"]);
  assert.deepEqual(capabilitiesOf(row("openrouter")), ["chat"]);
  assert.deepEqual(capabilitiesOf(row("cohere")), ["embed", "rerank"]);
  assert.deepEqual(capabilitiesOf(row("voyage")), ["embed", "rerank"]);
  assert.deepEqual(capabilitiesOf(row("nomic")), ["embed"]);
  assert.deepEqual(capabilitiesOf(row("assemblyai")), ["transcribe"]);
  assert.deepEqual(capabilitiesOf(row("grey_hosted")), []);
  assert.deepEqual(capabilitiesOf(row("nope")), []);
  assert.deepEqual(capabilitiesOf(null), []);
});

test("openai_compatible reads metadata.capabilities, default chat", () => {
  assert.deepEqual(capabilitiesOf(row("openai_compatible")), ["chat"]);
  assert.deepEqual(capabilitiesOf(row("openai_compatible", { metadata: { capabilities: [] } })), ["chat"]);
  assert.deepEqual(
    capabilitiesOf(row("openai_compatible", { metadata: { capabilities: ["embed", "rerank", "bogus"] } })),
    ["embed"],
  );
  assert.deepEqual(
    capabilitiesOf(row("openai_compatible", { metadata: { capabilities: ["chat", "embed", "transcribe"] } })),
    ["chat", "embed", "transcribe"],
  );
});

test("a preset can narrow a fixed kind (Jina reranks only)", () => {
  const jina = row("cohere", { metadata: { preset: "jina", capabilities: ["rerank"] } });
  assert.deepEqual(capabilitiesOf(jina), ["rerank"]);
  assert.equal(hasCapability(jina, "embed"), false);
  // An unrelated stored list never empties a fixed kind.
  assert.deepEqual(capabilitiesOf(row("voyage", { metadata: { capabilities: ["chat"] } })), ["embed", "rerank"]);
});

test("driver format per capability", () => {
  assert.equal(driverFormat(row("openai"), "chat"), "openai");
  assert.equal(driverFormat(row("openai"), "embed"), "openai");
  assert.equal(driverFormat(row("openai"), "rerank"), null);
  assert.equal(driverFormat(row("anthropic"), "chat"), "anthropic");
  assert.equal(driverFormat(row("google"), "embed"), "google");
  assert.equal(driverFormat(row("openrouter"), "chat"), "openai_compatible");
  assert.equal(driverFormat(row("cohere"), "rerank"), "cohere");
  assert.equal(driverFormat(row("voyage"), "embed"), "voyage");
  assert.equal(driverFormat(row("nomic"), "embed"), "nomic");
  assert.equal(driverFormat(row("nomic"), "chat"), null);
  assert.equal(driverFormat(row("assemblyai"), "transcribe"), "assemblyai");
  const compat = row("openai_compatible", { metadata: { capabilities: ["chat", "embed", "transcribe"] } });
  assert.equal(driverFormat(compat, "chat"), "openai_compatible");
  assert.equal(driverFormat(compat, "embed"), "openai");
  assert.equal(driverFormat(compat, "transcribe"), "openai");
  assert.equal(driverFormat(row("openai_compatible"), "embed"), null);
});

test("base URL resolution by mode", () => {
  assert.equal(resolveBaseUrl(row("openai")), "https://api.openai.com/v1");
  assert.equal(resolveBaseUrl(row("openai", { base_url: "https://proxy.example.com/v1/" })), "https://proxy.example.com/v1");
  assert.equal(resolveBaseUrl(row("openai", { baseUrl: "https://camel.example.com/v1" })), "https://camel.example.com/v1");
  assert.equal(resolveBaseUrl(row("voyage", { base_url: "https://evil.example.com" })), "https://api.voyageai.com/v1");
  assert.equal(resolveBaseUrl(row("nomic", { base_url: "https://evil.example.com" })), "https://api-atlas.nomic.ai/v1");
  assert.equal(resolveBaseUrl(row("openai_compatible")), null);
  assert.equal(resolveBaseUrl(row("openai_compatible", { base_url: " http://localhost:11434/v1 " })), "http://localhost:11434/v1");
  assert.equal(hasCustomBaseUrl(row("openai")), false);
  assert.equal(hasCustomBaseUrl(row("openai", { base_url: "https://api.openai.com/v1/" })), false);
  assert.equal(hasCustomBaseUrl(row("cohere", { base_url: "https://api.jina.ai/v1" })), true);
  assert.equal(hasCustomBaseUrl(row("openai_compatible", { base_url: "https://x.example.com/v1" })), true);
});

test("keys are optional only for openai-compatible servers", () => {
  assert.equal(keyRequired(row("openai_compatible")), false);
  assert.equal(keyRequired(row("anthropic")), true);
});

test("suggested models combine preset and kind", () => {
  const anthropic = suggestedModelsFor(row("anthropic"), "chat").map((m) => m.id);
  assert.deepEqual(anthropic, ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"]);
  const jina = row("cohere", { base_url: "https://api.jina.ai/v1", metadata: { preset: "jina", capabilities: ["rerank"] } });
  assert.deepEqual(suggestedModelsFor(jina, "rerank").map((m) => m.id), ["jina-reranker-v2-base-multilingual"]);
  assert.deepEqual(suggestedModelsFor(jina, "embed"), []);
  const ollama = row("openai_compatible", { base_url: "http://localhost:11434/v1", metadata: { preset: "ollama", capabilities: ["chat", "embed"] } });
  assert.deepEqual(suggestedModelsFor(ollama, "embed").map((m) => m.id), ["nomic-embed-text"]);
  assert.deepEqual(suggestedModelsFor(row("nomic"), "embed")[0], { id: "nomic-embed-text-v1.5", label: "Nomic Embed Text v1.5", dims: 768 });
});

test("labels prefer the preset", () => {
  assert.equal(providerKindLabel("openai_compatible", "groq"), "Groq");
  assert.equal(providerKindLabel("anthropic"), "Anthropic");
  assert.equal(providerKindLabel("mystery"), "mystery");
});

test("transcription suggestions keep timestamps first", () => {
  assert.equal(suggestedModelsFor(row("openai"), "transcribe")[0].id, "whisper-1");
  assert.deepEqual(suggestedModelsFor(row("assemblyai"), "transcribe").map((m) => m.id), ["universal-2", "universal-3-5-pro"]);
  assert.equal(PROVIDER_KINDS.assemblyai.defaultModelLabel.transcribe, "Auto (by preset tier)");
});
