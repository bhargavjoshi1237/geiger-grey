import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { assetReadUrl, fetchSourceFile, fetchUrlToFile, signedStorageUrl, streamToFile } from "../ingest/fetch.mjs";
import { publicOnlyLookup } from "../../lib/engine/net.js";

const tmp = () => mkdtemp(path.join(os.tmpdir(), "grey-fetch-test-"));
const stream = (...parts) => new ReadableStream({ start(c) { for (const p of parts) c.enqueue(new TextEncoder().encode(p)); c.close(); } });
const config = { assetsUrl: "https://suite.test/assets", internalToken: "tok" };

test("streamToFile hashes and writes", async () => {
  const dir = await tmp();
  try {
    const file = path.join(dir, "f");
    const out = await streamToFile(stream("hello ", "world"), file);
    assert.equal(out.bytes, 11);
    assert.equal(out.contentHash, createHash("sha256").update("hello world").digest("hex"));
    assert.equal(await readFile(file, "utf8"), "hello world");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("streamToFile enforces the size cap", async () => {
  const dir = await tmp();
  try {
    await assert.rejects(streamToFile(stream("12345", "6789"), path.join(dir, "f"), { maxBytes: 6 }), (e) => e.code === "file_too_large" && !e.retryable);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("URL sources: private and non-http targets are refused before any request", async () => {
  const dir = await tmp();
  let called = false;
  const fetchImpl = async () => {
    called = true;
    throw new Error("should not be called");
  };
  try {
    for (const url of ["http://127.0.0.1/admin", "http://169.254.169.254/latest/meta-data", "http://localhost:3000", "file:///etc/passwd", "http://[::1]/"]) {
      await assert.rejects(fetchUrlToFile(url, path.join(dir, "f"), { fetchImpl }), (e) => e.name === "JobError" && !e.retryable, url);
    }
    // a hostname that resolves to a private address
    await assert.rejects(
      fetchUrlToFile("https://evil.test/", path.join(dir, "f"), { fetchImpl, lookup: async () => [{ address: "10.0.0.5", family: 4 }] }),
      (e) => e.code === "private_address",
    );
    assert.equal(called, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("URL sources: redirects are re-checked per hop", async () => {
  const dir = await tmp();
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(url);
    return { status: 302, ok: false, headers: new Headers({ location: "http://192.168.1.1/" }), body: null };
  };
  try {
    await assert.rejects(
      fetchUrlToFile("https://public.test/start", path.join(dir, "f"), { fetchImpl, lookup: async () => [{ address: "93.184.216.34", family: 4 }] }),
      (e) => e.code === "blocked_host",
    );
    assert.deepEqual(seen, ["https://public.test/start"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("URL sources: HTTP errors map to retryable or permanent", async () => {
  const dir = await tmp();
  const lookup = async () => [{ address: "93.184.216.34", family: 4 }];
  const respond = (status) => async () => ({ status, ok: false, headers: new Headers(), body: null });
  try {
    await assert.rejects(fetchUrlToFile("https://public.test/", path.join(dir, "f"), { fetchImpl: respond(404), lookup }), (e) => e.code === "url_http_error" && !e.retryable);
    await assert.rejects(fetchUrlToFile("https://public.test/", path.join(dir, "f"), { fetchImpl: respond(503), lookup }), (e) => e.retryable);
    const ok = await fetchUrlToFile("https://public.test/page", path.join(dir, "f"), {
      lookup,
      fetchImpl: async (url) => ({ status: 200, ok: true, url, headers: new Headers({ "content-type": "text/html" }), body: stream("<p>hi</p>") }),
    });
    assert.equal(ok.mime, "text/html");
    assert.equal(ok.finalUrl, "https://public.test/page");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("URL sources: a connect-time refusal (DNS rebinding) is a permanent private_address", async () => {
  const dir = await tmp();
  const refused = Object.assign(new Error("This address points to a private network and can't be used."), { code: "EPRIVATEADDR" });
  try {
    await assert.rejects(
      fetchUrlToFile("https://rebind.test/", path.join(dir, "f"), {
        lookup: async () => [{ address: "93.184.216.34", family: 4 }],
        fetchImpl: async () => {
          throw new TypeError("fetch failed", { cause: refused });
        },
      }),
      (e) => e.code === "private_address" && !e.retryable,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("publicOnlyLookup refuses loopback at connect time", async () => {
  await new Promise((resolve) => {
    publicOnlyLookup("localhost", { all: true }, (err) => {
      assert.equal(err?.code, "EPRIVATEADDR");
      resolve();
    });
  });
});

test("Assets read-url: auth header, errors and shape", async () => {
  let request;
  const ok = await assetReadUrl({
    assetId: "a 1",
    projectId: "p",
    config,
    fetchImpl: async (url, init) => {
      request = { url, auth: init.headers.Authorization };
      return { ok: true, status: 200, json: async () => ({ url: "https://signed", mimeType: "audio/mpeg", filename: "a.mp3", sizeBytes: 10 }) };
    },
  });
  assert.deepEqual(request, { url: "https://suite.test/assets/api/internal/assets/a%201/read-url?projectId=p", auth: "Bearer tok" });
  assert.deepEqual(ok, { url: "https://signed", mime: "audio/mpeg", name: "a.mp3", sizeBytes: 10 });
  const status = (s) => async () => ({ ok: false, status: s, json: async () => ({}) });
  await assert.rejects(assetReadUrl({ assetId: "a", projectId: "p", config, fetchImpl: status(404) }), (e) => e.code === "asset_missing");
  await assert.rejects(assetReadUrl({ assetId: "a", projectId: "p", config, fetchImpl: status(502) }), (e) => e.retryable);
  await assert.rejects(assetReadUrl({ assetId: "a", projectId: "p", config: {} }), (e) => e.code === "assets_not_configured");
});

test("Storage: a missing object is permanent, an outage retryable", async () => {
  const admin = (error) => ({ storage: { from: () => ({ createSignedUrl: async () => ({ data: null, error }) }) } });
  await assert.rejects(signedStorageUrl(admin({ statusCode: "404", message: "Object not found" }), "p/k/s/f.pdf", 60), (e) => e.code === "missing_object" && !e.retryable);
  await assert.rejects(signedStorageUrl(admin({ statusCode: "500", message: "boom" }), "p/k/s/f.pdf", 60), (e) => e.retryable);
});

test("content origin is rejected; notes boards come from pg", async () => {
  await assert.rejects(fetchSourceFile({ source: { origin: "content" }, tmpDir: os.tmpdir() }), (e) => e.code === "content_unsupported");
  const db = { query: async () => ({ rows: [{ id: "b", name: "Board", description: null, nodes: [], edges: [] }] }) };
  const out = await fetchSourceFile({ source: { origin: "notes", origin_ref: "b", project_id: "p" }, db, tmpDir: os.tmpdir() });
  assert.equal(out.board.name, "Board");
  assert.match(out.contentHash, /^[0-9a-f]{64}$/);
  const missing = { query: async () => ({ rows: [] }) };
  await assert.rejects(fetchSourceFile({ source: { origin: "notes", origin_ref: "b", project_id: "p" }, db: missing, tmpDir: os.tmpdir() }), (e) => e.code === "note_missing");
});
