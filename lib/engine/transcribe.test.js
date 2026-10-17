import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { transcribe } from "./transcribe.js";
import { fetchWithRetry } from "./drivers/transcribe/http.js";
import { PROJECT, fakeAdmin, jsonResponse, provider } from "./test_helpers.js";

// Local / custom provider URLs are opt-in (localProvidersAllowed); with the opt-in, custom
// URLs skip DNS and use the stubbed global fetch instead of the pinned transport.
process.env.GREY_ALLOW_LOCAL_PROVIDERS = "1";

const openai = provider(1, "openai");
const whisper = provider(2, "openai_compatible", { base_url: "http://localhost:9000/v1", metadata: { capabilities: ["transcribe"] } });
const admin = fakeAdmin({ tables: { model_providers: [openai, whisper] }, secrets: { [openai.id]: "sk-openai-test" } });
const verbose = { text: "hello there", language: "en", duration: 1.5, segments: [{ start: 0, end: 1.5, text: "hello there" }] };

let dir;
let filePath;
before(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "grey-transcribe-test-"));
  filePath = path.join(dir, "clip.mp3");
  await writeFile(filePath, "fake-audio");
});
after(() => rm(dir, { recursive: true, force: true }));

// Replaces the global fetch for one test; records url + redirect mode (bodies are FormData).
function stubGlobalFetch(respond) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), redirect: init.redirect });
    return respond(String(url), init);
  };
  return { calls, restore: () => (globalThis.fetch = original) };
}

test("fetchWithRetry: custom base URLs refuse redirects; default URLs keep fetch's behaviour", async () => {
  const seen = [];
  const mock = async (url, init) => {
    seen.push(init.redirect);
    return new Response("{}");
  };
  await fetchWithRetry("https://whisper.example.com/v1/audio/transcriptions", { method: "POST" }, { custom: true, fetch: mock });
  await fetchWithRetry("https://api.openai.com/v1/audio/transcriptions", { method: "POST" }, { custom: false, fetch: mock });
  assert.deepEqual(seen, ["error", undefined]);
});

test("fetchWithRetry: a connect-time private-address refusal fails at once with unsafe_base_url", async () => {
  let attempts = 0;
  const refused = Object.assign(new Error("private"), { code: "EPRIVATEADDR" });
  const mock = async () => {
    attempts += 1;
    throw new TypeError("fetch failed", { cause: refused });
  };
  await assert.rejects(
    fetchWithRetry("https://rebind.example.com/v2/transcript", {}, { custom: true, fetch: mock, retries: 3 }),
    (err) => err.code === "unsafe_base_url" && err.retryable === false,
  );
  assert.equal(attempts, 1, "not retried");
});

test("transcribe threads the connection's custom flag into the driver (redirect: error)", async () => {
  const stub = stubGlobalFetch(() => jsonResponse(verbose));
  try {
    const out = await transcribe({ admin, projectId: PROJECT, providerId: whisper.id, filePath, config: {} });
    assert.equal(out.segments[0].text, "hello there");
    assert.deepEqual(stub.calls, [{ url: "http://localhost:9000/v1/audio/transcriptions", redirect: "error" }]);
  } finally {
    stub.restore();
  }
});

test("transcribe on a provider's default URL leaves redirects to fetch", async () => {
  const stub = stubGlobalFetch(() => jsonResponse(verbose));
  try {
    await transcribe({ admin, projectId: PROJECT, providerId: openai.id, filePath, config: {} });
    assert.deepEqual(stub.calls, [{ url: "https://api.openai.com/v1/audio/transcriptions", redirect: undefined }]);
  } finally {
    stub.restore();
  }
});
