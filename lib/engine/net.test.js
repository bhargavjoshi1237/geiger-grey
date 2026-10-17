import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { gzipSync } from "node:zlib";
import { createPinnedFetch, guardedLookup, isPrivateAddressError, pinnedFetch, providerFetch } from "./net.js";

// A local server for the transport tests (reached with allowLocal, or through a fake lookup).
let server;
let base;
const seen = [];

before(async () => {
  server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    seen.push({ method: req.method, url: req.url, headers: req.headers, body });
    if (req.url === "/json") {
      res.writeHead(201, { "content-type": "application/json", "x-test": "a" });
      res.end(JSON.stringify({ method: req.method, length: req.headers["content-length"], type: req.headers["content-type"], body: body.toString() }));
    } else if (req.url === "/form") {
      const form = await new Response(body, { headers: { "content-type": req.headers["content-type"] } }).formData();
      const file = form.get("file");
      res.end(JSON.stringify({ length: req.headers["content-length"], model: form.get("model"), file: await file.text(), name: file.name }));
    } else if (req.url === "/redirect") {
      res.writeHead(302, { location: "http://169.254.169.254/latest" }).end();
    } else if (req.url === "/gzip") {
      res.writeHead(200, { "content-encoding": "gzip" }).end(gzipSync("compressed hello"));
    } else if (req.url === "/empty") {
      res.writeHead(204).end();
    } else if (req.url === "/stream") {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write("data: first\n\n");
      req.socket.on("close", () => res.destroy());
    } else {
      res.writeHead(404).end("missing");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.closeAllConnections();
  server.close();
});

const local = createPinnedFetch({ allowLocal: true });
const lookupTo = (address, family = 4) => (hostname, options, callback) => callback(null, [{ address, family }]);

test("guarded lookup: any private answer is refused, public answers pass through", async () => {
  const lookupOnce = (fn, options) => new Promise((resolve) => fn("host.test", options, (err, ...rest) => resolve({ err, rest })));
  const refused = await lookupOnce(guardedLookup(lookupTo("10.0.0.5")), { all: true });
  assert.equal(refused.err.code, "EPRIVATEADDR");
  assert.equal(isPrivateAddressError(refused.err), true);
  const mixed = guardedLookup((h, o, cb) => cb(null, [{ address: "93.184.216.34", family: 4 }, { address: "::ffff:127.0.0.1", family: 6 }]));
  assert.equal((await lookupOnce(mixed, { all: true })).err.code, "EPRIVATEADDR");
  const ok = guardedLookup(lookupTo("93.184.216.34"));
  assert.deepEqual((await lookupOnce(ok, { all: true })).rest, [[{ address: "93.184.216.34", family: 4 }]]);
  assert.deepEqual((await lookupOnce(ok, {})).rest, ["93.184.216.34", 4]);
});

test("pinned fetch refuses private targets before and at connect time", async () => {
  const before = seen.length;
  for (const url of [`${base}/json`, "http://[::ffff:127.0.0.1]:9/", "http://169.254.169.254/latest"]) {
    await assert.rejects(pinnedFetch(url), (err) => err instanceof TypeError && isPrivateAddressError(err), url);
  }
  // A hostname that resolves (or re-resolves) to a private address never connects.
  const rebinding = createPinnedFetch({ lookup: lookupTo("127.0.0.1") });
  await assert.rejects(rebinding(`http://rebind.test:${server.address().port}/json`), (err) => isPrivateAddressError(err));
  assert.equal(seen.length, before, "no request reached the server");
  await assert.rejects(pinnedFetch("file:///etc/passwd"), TypeError);
});

test("pinned fetch sends string bodies with a length and returns a real Response", async () => {
  const res = await local(`${base}/json`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ a: 1 }) });
  assert.ok(res instanceof Response);
  assert.equal(res.status, 201);
  assert.equal(res.ok, true);
  assert.equal(res.headers.get("x-test"), "a");
  assert.equal(res.url, `${base}/json`);
  assert.deepEqual(await res.json(), { method: "POST", length: "7", type: "application/json", body: '{"a":1}' });
});

test("pinned fetch encodes FormData with a Content-Length", async () => {
  const form = new FormData();
  form.append("model", "whisper-1");
  form.append("file", new Blob(["audio-bytes"], { type: "audio/mpeg" }), "clip.mp3");
  const res = await local(`${base}/form`, { method: "POST", body: form });
  const out = await res.json();
  assert.equal(out.model, "whisper-1");
  assert.equal(out.file, "audio-bytes");
  assert.equal(out.name, "clip.mp3");
  assert.match(out.length, /^\d+$/);
});

test("redirects are errors unless redirect is manual", async () => {
  await assert.rejects(local(`${base}/redirect`, { redirect: "error" }), (err) => err instanceof TypeError && /redirect/.test(err.cause?.message));
  await assert.rejects(local(`${base}/redirect`), TypeError, "follow is never honoured");
  const manual = await local(`${base}/redirect`, { redirect: "manual" });
  assert.equal(manual.status, 302);
  assert.equal(manual.headers.get("location"), "http://169.254.169.254/latest");
});

test("gzip bodies are decoded and null-body statuses have no body", async () => {
  assert.equal(await (await local(`${base}/gzip`)).text(), "compressed hello");
  const empty = await local(`${base}/empty`);
  assert.equal(empty.status, 204);
  assert.equal(empty.body, null);
});

test("an abort stops a streamed body with the signal's reason", async () => {
  const controller = new AbortController();
  const res = await local(`${base}/stream`, { signal: controller.signal });
  const reader = res.body.getReader();
  const first = await reader.read();
  assert.equal(new TextDecoder().decode(first.value), "data: first\n\n");
  controller.abort();
  await assert.rejects(reader.read(), (err) => err.name === "AbortError");
  await assert.rejects(local(`${base}/json`, { signal: AbortSignal.abort() }), (err) => err.name === "AbortError");
});

test("providerFetch: redirects are errors; local providers bypass the pin only when allowed", async () => {
  const env = { NODE_ENV: process.env.NODE_ENV, GREY_ALLOW_LOCAL_PROVIDERS: process.env.GREY_ALLOW_LOCAL_PROVIDERS };
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, redirect: init.redirect });
    return new Response("ok");
  };
  try {
    delete process.env.NODE_ENV;
    process.env.GREY_ALLOW_LOCAL_PROVIDERS = "1";
    assert.equal(await (await providerFetch("http://localhost:11434/v1/models", { redirect: "follow" })).text(), "ok");
    assert.deepEqual(calls, [{ url: "http://localhost:11434/v1/models", redirect: "error" }]);

    delete process.env.GREY_ALLOW_LOCAL_PROVIDERS;
    await assert.rejects(providerFetch("http://127.0.0.1:11434/v1/models"), (err) => isPrivateAddressError(err));
    assert.equal(calls.length, 1, "strict mode never uses the global fetch");
  } finally {
    globalThis.fetch = original;
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
