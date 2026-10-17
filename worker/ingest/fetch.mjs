// Fetch stage (spec §6.1), by sources.origin:
//   upload  grey-sources object -> temp file (media gets a 6 h signed URL instead)
//   notes   notes.project_boards row over pg
//   assets  Assets internal read-url route -> signed URL -> temp file
//   url     SSRF-guarded fetch (lib/grey/url_guard.js): http(s) only, private addresses blocked
//           and re-checked per redirect (max 5) and again at connect time (pinnedFetch,
//           lib/engine/net.js), 20 MB cap, 20 s timeout
//   content rejected
// The worker records content_hash = sha256 of the bytes.
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { once } from "node:events";
import path from "node:path";
import { Readable } from "node:stream";
import { JobError, isRetryableStatus } from "../../lib/grey/ingest_errors.js";
import { guardedFetch, UrlGuardError } from "../../lib/grey/url_guard.js";
import { isPrivateAddressError, pinnedFetch } from "../../lib/engine/net.js";
import { loadNotesBoard } from "../db.mjs";

export const BUCKET = "grey-sources";
export const MAX_DOCUMENT_BYTES = 200 * 1024 * 1024;
export const MAX_URL_BYTES = 20 * 1024 * 1024;
export const MAX_MEDIA_DOWNLOAD_BYTES = 2 * 1024 * 1024 * 1024;
export const URL_TIMEOUT_MS = 20_000;
export const MEDIA_URL_SECONDS = 6 * 60 * 60;
const DOWNLOAD_URL_SECONDS = 15 * 60;
const USER_AGENT = "GreyBot/1.0";

const tooLarge = (limitBytes) =>
  new JobError("file_too_large", `This file is larger than the ${Math.round(limitBytes / (1024 * 1024))} MB limit.`);

const withTimeout = (signal, ms) => {
  const timeout = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
};

// Streams a web ReadableStream to `filePath`, hashing as it goes. -> { bytes, contentHash }
export async function streamToFile(body, filePath, { maxBytes = MAX_DOCUMENT_BYTES } = {}) {
  if (!body) throw new JobError("empty_response", "The file was empty.", { retryable: false });
  const hash = createHash("sha256");
  const out = createWriteStream(filePath);
  let bytes = 0;
  try {
    for await (const chunk of Readable.fromWeb(body)) {
      bytes += chunk.length;
      if (bytes > maxBytes) throw tooLarge(maxBytes);
      hash.update(chunk);
      if (!out.write(chunk)) await once(out, "drain");
    }
    out.end();
    await once(out, "finish");
  } catch (err) {
    out.destroy();
    throw err;
  }
  return { bytes, contentHash: hash.digest("hex") };
}

// Plain fetch for trusted, already-signed URLs (Storage, Assets).
export async function downloadToFile(url, filePath, { signal, maxBytes = MAX_DOCUMENT_BYTES, timeoutMs = 10 * 60_000, fetchImpl = globalThis.fetch } = {}) {
  let res;
  try {
    res = await fetchImpl(url, { signal: withTimeout(signal, timeoutMs) });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new JobError("download_failed", "Couldn't download the file.", { retryable: true, cause: err });
  }
  if (!res.ok) {
    await res.body?.cancel?.().catch(() => {});
    if (res.status === 404 || res.status === 400) throw new JobError("missing_object", "The file is missing from storage.");
    throw new JobError("download_failed", `Couldn't download the file (HTTP ${res.status}).`, { retryable: isRetryableStatus(res.status) });
  }
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel?.().catch(() => {});
    throw tooLarge(maxBytes);
  }
  const { bytes, contentHash } = await streamToFile(res.body, filePath, { maxBytes });
  return { bytes, contentHash, mime: res.headers.get("content-type") || null };
}

// ---------------------------------------------------------------------------
// Storage (uploads)
// ---------------------------------------------------------------------------

export async function signedStorageUrl(admin, storagePath, seconds) {
  if (!storagePath) throw new JobError("missing_object", "This source has no uploaded file.");
  const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(storagePath, seconds);
  if (error || !data?.signedUrl) {
    const status = Number(error?.statusCode ?? error?.status);
    const missing = status === 404 || status === 400 || /not.?found/i.test(error?.message || "");
    throw new JobError(missing ? "missing_object" : "storage_unavailable", missing ? "The uploaded file is missing from storage." : "Storage is temporarily unavailable.", {
      retryable: !missing,
    });
  }
  return data.signedUrl;
}

// ---------------------------------------------------------------------------
// Assets (geiger-assets internal route, spec §9.4)
// ---------------------------------------------------------------------------

export async function assetReadUrl({ assetId, projectId, config, signal, fetchImpl = globalThis.fetch }) {
  if (!config.assetsUrl || !config.internalToken) {
    throw new JobError("assets_not_configured", "Assets imports aren't configured for this worker (ASSETS_INTERNAL_URL / GEIGER_INTERNAL_TOKEN).");
  }
  const url = `${config.assetsUrl}/api/internal/assets/${encodeURIComponent(assetId)}/read-url?projectId=${encodeURIComponent(projectId)}`;
  let res;
  try {
    res = await fetchImpl(url, { headers: { Authorization: `Bearer ${config.internalToken}` }, signal: withTimeout(signal, 30_000) });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new JobError("assets_unavailable", "Assets couldn't be reached.", { retryable: true, cause: err });
  }
  if (res.status === 404) throw new JobError("asset_missing", "This asset's file isn't available in Assets.");
  if (res.status === 401 || res.status === 403) throw new JobError("assets_unauthorized", "Grey isn't authorised to read from Assets.");
  if (!res.ok) throw new JobError("assets_unavailable", `Assets returned an error (HTTP ${res.status}).`, { retryable: isRetryableStatus(res.status) });
  const json = await res.json().catch(() => null);
  if (!json?.url) throw new JobError("asset_missing", "This asset's file isn't available in Assets.");
  return { url: json.url, mime: json.mimeType || null, name: json.filename || null, sizeBytes: json.sizeBytes ?? null };
}

// ---------------------------------------------------------------------------
// URL sources
// ---------------------------------------------------------------------------

// guardedFetch checks each hop before the request (redirect "manual"); pinnedFetch re-checks
// the addresses its own lookup returns at connect time, closing the DNS-rebinding window.
export async function fetchUrlToFile(rawUrl, filePath, { signal, fetchImpl = pinnedFetch, lookup } = {}) {
  const requestSignal = withTimeout(signal, URL_TIMEOUT_MS);
  let res;
  try {
    res = await guardedFetch(
      rawUrl,
      {
        signal: requestSignal,
        headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml,application/pdf;q=0.9,text/plain;q=0.8,*/*;q=0.5" },
      },
      { fetch: fetchImpl, lookup, maxRedirects: 5, allowHttp: true, allowLocal: false },
    );
  } catch (err) {
    if (signal?.aborted) throw err;
    if (err instanceof UrlGuardError) throw new JobError(err.code, err.message, { cause: err });
    if (isPrivateAddressError(err)) throw new JobError("private_address", "This address points to a private network and can't be used.");
    if ((err?.code ?? err?.cause?.code) === "ENOTFOUND") throw new JobError("dns_failed", "Couldn't resolve this URL's host.");
    if (requestSignal.aborted) throw new JobError("url_timeout", "The page took too long to respond.", { retryable: true });
    throw new JobError("url_unreachable", "The page couldn't be reached.", { retryable: true, cause: err });
  }
  if (!res.ok) {
    await res.body?.cancel?.().catch(() => {});
    throw new JobError("url_http_error", `The page couldn't be fetched (HTTP ${res.status}).`, { retryable: isRetryableStatus(res.status) });
  }
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_URL_BYTES) {
    await res.body?.cancel?.().catch(() => {});
    throw tooLarge(MAX_URL_BYTES);
  }
  try {
    const { bytes, contentHash } = await streamToFile(res.body, filePath, { maxBytes: MAX_URL_BYTES });
    return { bytes, contentHash, mime: res.headers.get("content-type") || null, finalUrl: res.url || rawUrl };
  } catch (err) {
    if (err instanceof JobError || signal?.aborted) throw err;
    if (requestSignal.aborted) throw new JobError("url_timeout", "The page took too long to respond.", { retryable: true });
    throw new JobError("url_unreachable", "The page couldn't be read.", { retryable: true, cause: err });
  }
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

// Documents. -> { filePath?, board?, bytes, contentHash, mime, name, finalUrl? }
export async function fetchSourceFile({ source, admin, db, config, tmpDir, signal }) {
  const filePath = path.join(tmpDir, "source");
  switch (source.origin) {
    case "upload": {
      const url = await signedStorageUrl(admin, source.storage_path, DOWNLOAD_URL_SECONDS);
      const out = await downloadToFile(url, filePath, { signal, maxBytes: MAX_DOCUMENT_BYTES });
      return { filePath, ...out, mime: source.mime || out.mime, name: source.name };
    }
    case "assets": {
      const asset = await assetReadUrl({ assetId: source.origin_ref, projectId: source.project_id, config, signal });
      const out = await downloadToFile(asset.url, filePath, { signal, maxBytes: MAX_DOCUMENT_BYTES });
      return { filePath, ...out, mime: asset.mime || source.mime || out.mime, name: asset.name || source.name };
    }
    case "url": {
      const out = await fetchUrlToFile(source.origin_ref, filePath, { signal });
      return { filePath, ...out, name: new URL(out.finalUrl).pathname };
    }
    case "notes": {
      const board = await loadNotesBoard(db, { boardId: source.origin_ref, projectId: source.project_id });
      if (!board) throw new JobError("note_missing", "This Notes board no longer exists.");
      const serialized = JSON.stringify({ name: board.name, description: board.description, nodes: board.nodes, edges: board.edges });
      return {
        board,
        bytes: Buffer.byteLength(serialized),
        contentHash: createHash("sha256").update(serialized).digest("hex"),
        mime: "application/x-notes-board",
        name: board.name || source.name,
      };
    }
    case "content":
      throw new JobError("content_unsupported", "Content sources aren't supported yet.");
    default:
      throw new JobError("unsupported_origin", "This source type isn't supported.");
  }
}

// A URL an external service (transcription provider, OCR service) can download the file from —
// the bytes never stream through the worker. -> { url, mime, sizeBytes }
export async function sourceFileUrl({ source, admin, config, signal, seconds = MEDIA_URL_SECONDS, allowUrlOrigin = false }) {
  if (source.origin === "upload") {
    return { url: await signedStorageUrl(admin, source.storage_path, seconds), mime: source.mime, sizeBytes: source.bytes ?? null };
  }
  if (source.origin === "assets") {
    const asset = await assetReadUrl({ assetId: source.origin_ref, projectId: source.project_id, config, signal });
    return { url: asset.url, mime: asset.mime || source.mime, sizeBytes: asset.sizeBytes ?? source.bytes ?? null };
  }
  if (allowUrlOrigin && source.origin === "url") return { url: source.origin_ref, mime: source.mime, sizeBytes: null };
  throw new JobError("unsupported_origin", "Audio and video can only be ingested from uploads or Assets.");
}

// Media: a 6 h URL for the transcription provider.
export function mediaFileUrl({ source, admin, config, signal }) {
  return sourceFileUrl({ source, admin, config, signal, seconds: MEDIA_URL_SECONDS });
}
