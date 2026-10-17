// Outbound HTTP to user-supplied hosts (spec §14): custom provider base URLs and URL sources.
// lib/grey/url_guard.js checks a URL before the request; the request then resolves the host
// again, so the connections made here re-check every resolved address at connect time
// (resolvedAddressesArePublic) — a DNS answer that changed to a private address in between is
// refused. Plain Node (node:http/https, no dependencies): `undici` is only a transitive package
// here, so it isn't imported.
import { randomUUID } from "node:crypto";
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import { Readable, pipeline } from "node:stream";
import zlib from "node:zlib";
import { isIpAddress, isPrivateAddress, localProvidersAllowed, resolvedAddressesArePublic } from "../grey/url_guard.js";

export const PRIVATE_ADDRESS_CODE = "EPRIVATEADDR";

const privateAddressError = () =>
  Object.assign(new Error("This address points to a private network and can't be used."), { code: PRIVATE_ADDRESS_CODE });

// True when `err` (or an error in its cause chain) is the connect-time guard's refusal.
export function isPrivateAddressError(err) {
  for (let e = err, depth = 0; e && depth < 5; e = e.cause, depth += 1) {
    if (e.code === PRIVATE_ADDRESS_CODE) return true;
  }
  return false;
}

// -> a dns.lookup-compatible function that refuses any answer containing a private address.
export function guardedLookup(lookup = dns.lookup) {
  return function publicOnlyLookup(hostname, options, callback) {
    if (typeof options === "function") [callback, options] = [options, {}];
    const opts = typeof options === "number" ? { family: options } : options || {};
    lookup(hostname, { ...opts, all: true }, (err, addresses) => {
      if (err) return callback(err);
      const list = Array.isArray(addresses) ? addresses : [];
      if (!resolvedAddressesArePublic(list)) return callback(privateAddressError());
      if (opts.all) return callback(null, list);
      return callback(null, list[0].address, list[0].family);
    });
  };
}

export const publicOnlyLookup = guardedLookup();

// --- request bodies ------------------------------------------------------------

const escapeFormName = (value) => String(value).replace(/\n/g, "%0A").replace(/\r/g, "%0D").replace(/"/g, "%22");

// FormData -> one lazily read Blob (file parts stay on disk), so the request carries a
// Content-Length instead of a chunked body.
function multipart(form) {
  const boundary = `----GreyFormBoundary${randomUUID().replace(/-/g, "")}`;
  const parts = [];
  for (const [name, value] of form) {
    const disposition = `--${boundary}\r\nContent-Disposition: form-data; name="${escapeFormName(name)}"`;
    if (typeof value === "string") {
      parts.push(`${disposition}\r\n\r\n${value.replace(/\r\n|\r|\n/g, "\r\n")}\r\n`);
    } else {
      const type = value.type || "application/octet-stream";
      parts.push(`${disposition}; filename="${escapeFormName(value.name ?? "blob")}"\r\nContent-Type: ${type}\r\n\r\n`, value, "\r\n");
    }
  }
  parts.push(`--${boundary}--\r\n`);
  return { body: new Blob(parts), type: `multipart/form-data; boundary=${boundary}` };
}

// -> { body: Buffer | Blob | ReadableStream | null, type?: default content-type }
function encodeBody(body) {
  if (body == null) return { body: null };
  if (typeof body === "string") return { body: Buffer.from(body), type: "text/plain;charset=UTF-8" };
  if (body instanceof URLSearchParams) return { body: Buffer.from(body.toString()), type: "application/x-www-form-urlencoded;charset=UTF-8" };
  if (body instanceof FormData) return multipart(body);
  if (body instanceof Blob) return { body, type: body.type || undefined };
  if (body instanceof ArrayBuffer) return { body: Buffer.from(body) };
  if (ArrayBuffer.isView(body)) return { body: Buffer.from(body.buffer, body.byteOffset, body.byteLength) };
  if (body instanceof ReadableStream) return { body };
  return { body: Buffer.from(String(body)), type: "text/plain;charset=UTF-8" };
}

// --- responses -------------------------------------------------------------------

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);
const ZLIB_STREAMING = { flush: zlib.constants.Z_SYNC_FLUSH, finishFlush: zlib.constants.Z_SYNC_FLUSH };

function decoder(encoding) {
  switch (String(encoding || "").trim().toLowerCase()) {
    case "gzip":
    case "x-gzip":
      return zlib.createGunzip(ZLIB_STREAMING);
    case "deflate":
      return zlib.createInflate(ZLIB_STREAMING);
    case "br":
      return zlib.createBrotliDecompress();
    default:
      return null;
  }
}

function decodedBody(res) {
  const decode = decoder(res.headers["content-encoding"]);
  if (!decode) return res;
  pipeline(res, decode, () => {});
  return decode;
}

const fetchFailed = (cause) => new TypeError("fetch failed", { cause });
const abortReason = (signal) => signal.reason ?? new DOMException("This operation was aborted", "AbortError");

// -> a fetch()-compatible function over node:http(s) whose connections only reach public
// addresses (`allowLocal` skips the address checks, for tests). Redirects are never followed:
// redirect "manual" returns the 3xx response, anything else rejects like fetch's redirect
// "error". Bodies: string, bytes, Blob, FormData, URLSearchParams or ReadableStream. The
// response is a real Response with a streamed body (gzip/deflate/br decoded) and `url` set.
// Rejections mirror fetch: the signal's reason on abort, else TypeError("fetch failed", { cause }).
export function createPinnedFetch({ allowLocal = false, lookup } = {}) {
  const connectLookup = allowLocal ? lookup : guardedLookup(lookup);
  // Dedicated pools: a kept-alive socket was always opened through the guarded lookup.
  const agentOptions = { keepAlive: true, scheduling: "lifo", timeout: 5000 };
  const agents = { "http:": new http.Agent(agentOptions), "https:": new https.Agent(agentOptions) };

  return async function pinnedFetch(input, init = {}) {
    if (input instanceof Request) {
      init = { method: input.method, headers: input.headers, body: input.body, signal: input.signal, redirect: input.redirect, ...init };
    }
    const url = new URL(input instanceof Request ? input.url : String(input));
    const { signal } = init;
    if (signal?.aborted) throw abortReason(signal);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw fetchFailed(new Error(`Unsupported protocol ${url.protocol}`));
    // Literal IPs never reach the lookup, so they are checked here.
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (!allowLocal && isIpAddress(host) && isPrivateAddress(host)) throw fetchFailed(privateAddressError());

    const method = String(init.method || "GET").toUpperCase();
    const headers = new Headers(init.headers);
    const { body, type } = encodeBody(init.body);
    if (type && !headers.has("content-type")) headers.set("content-type", type);
    if (body instanceof Blob) headers.set("content-length", String(body.size));
    if (!headers.has("accept")) headers.set("accept", "*/*");
    if (!headers.has("accept-encoding")) headers.set("accept-encoding", "gzip, br");
    if (!headers.has("user-agent")) headers.set("user-agent", "node");

    return new Promise((resolve, reject) => {
      let response = null;
      const req = (url.protocol === "https:" ? https : http).request(url, {
        method,
        headers: Object.fromEntries(headers),
        agent: agents[url.protocol],
        lookup: connectLookup,
      });
      const onAbort = () => {
        const reason = abortReason(signal);
        req.destroy(reason);
        response?.destroy(reason);
      };
      const cleanup = () => signal?.removeEventListener("abort", onAbort);
      signal?.addEventListener("abort", onAbort, { once: true });

      req.on("error", (err) => {
        if (response) return; // after the headers, errors surface on the body stream
        cleanup();
        reject(signal?.aborted ? abortReason(signal) : fetchFailed(err));
      });

      req.on("response", (res) => {
        response = res;
        res.on("close", cleanup);
        const status = res.statusCode || 0;
        if (REDIRECT_STATUSES.has(status) && init.redirect !== "manual") {
          res.resume();
          req.destroy();
          reject(fetchFailed(new Error("unexpected redirect")));
          return;
        }
        const responseHeaders = new Headers();
        for (let i = 0; i < res.rawHeaders.length; i += 2) responseHeaders.append(res.rawHeaders[i], res.rawHeaders[i + 1]);
        const empty = method === "HEAD" || NULL_BODY_STATUSES.has(status);
        if (empty) res.resume();
        try {
          const out = new Response(empty ? null : Readable.toWeb(decodedBody(res)), {
            status,
            statusText: res.statusMessage || "",
            headers: responseHeaders,
          });
          Object.defineProperty(out, "url", { value: url.href });
          resolve(out);
        } catch (err) {
          res.destroy();
          reject(fetchFailed(err));
        }
      });

      if (body == null) req.end();
      else if (Buffer.isBuffer(body)) req.end(body);
      else {
        pipeline(Readable.fromWeb(body instanceof Blob ? body.stream() : body), req, (err) => {
          if (err) req.destroy(err);
        });
      }
    });
  };
}

export const pinnedFetch = createPinnedFetch();

// fetch for custom provider base URLs (connectProvider()'s `custom`): a redirect is an error,
// and unless local providers are allowed (localProvidersAllowed) every connection is pinned to
// public addresses at connect time.
export function providerFetch(input, init = {}) {
  const request = { ...init, redirect: "error" };
  return localProvidersAllowed(process.env) ? globalThis.fetch(input, request) : pinnedFetch(input, request);
}
