import { test } from "node:test";
import assert from "node:assert/strict";
import { requestJson } from "./http.js";

const refused = () => new TypeError("fetch failed", { cause: Object.assign(new Error("private"), { code: "EPRIVATEADDR" }) });

test("requestJson: custom base URLs (noRedirect) refuse redirects", async () => {
  const seen = [];
  const mock = async (url, init) => {
    seen.push(init.redirect);
    return Response.json({ ok: true });
  };
  await requestJson("https://embed.example.com/v1/embeddings", {}, { noRedirect: true, fetch: mock });
  await requestJson("https://api.openai.com/v1/embeddings", {}, { fetch: mock });
  assert.deepEqual(seen, ["error", "follow"]);
});

test("requestJson: a connect-time private-address refusal is unsafe_base_url, never retried", async () => {
  let attempts = 0;
  const mock = async () => {
    attempts += 1;
    throw refused();
  };
  await assert.rejects(
    requestJson("https://rebind.example.com/v1/embeddings", {}, { noRedirect: true, retries: 3, fetch: mock }),
    (err) => err.code === "unsafe_base_url" && err.retryable === false,
  );
  assert.equal(attempts, 1);
});

test("requestJson: custom base URLs use the pinned transport when local providers aren't allowed", async () => {
  const previous = process.env.GREY_ALLOW_LOCAL_PROVIDERS;
  delete process.env.GREY_ALLOW_LOCAL_PROVIDERS;
  try {
    await assert.rejects(
      requestJson("http://169.254.169.254/latest/meta-data", {}, { noRedirect: true, retries: 0 }),
      (err) => err.code === "unsafe_base_url",
    );
  } finally {
    if (previous !== undefined) process.env.GREY_ALLOW_LOCAL_PROVIDERS = previous;
  }
});
