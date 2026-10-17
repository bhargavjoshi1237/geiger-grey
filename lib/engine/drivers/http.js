// JSON-over-HTTP transport for the fetch-based drivers (embed, rerank): per-attempt
// timeout, external AbortSignal, retries on 429/5xx/network honouring Retry-After
// up to 10 s, and provider failures mapped to EngineError (raw provider text is
// never surfaced).
import { EngineError } from "../errors.js";
import { isPrivateAddressError, providerFetch } from "../net.js";
import { mapLlmError } from "../../grey/llm_errors.js";

const MAX_RETRY_AFTER_MS = 10_000;

export function abortedError() {
  return new EngineError("aborted", "The request was cancelled.", { status: 499, retryable: false });
}

// A custom base URL whose host now resolves to a private address (refused at connect time).
export function unsafeAddressError() {
  return new EngineError("unsafe_base_url", "This connection's base URL points to a private network and can't be used.", {
    status: 422,
    retryable: false,
  });
}

export function providerError(err) {
  const mapped = mapLlmError(err);
  const error = new EngineError(mapped.code, mapped.message, { status: mapped.status, retryable: mapped.retryable });
  error.providerStatus = mapped.providerStatus;
  return error;
}

// Retry-After as seconds or an HTTP date -> ms, or null when absent/unparseable.
export function retryAfterMs(header, now = Date.now()) {
  if (header == null || header === "") return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(header);
  return Number.isFinite(at) ? Math.max(0, at - now) : null;
}

const backoffMs = (attempt) => 500 * 2 ** attempt + Math.floor(Math.random() * 250);

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortedError());
    const timer = setTimeout(() => {
      signal?.removeEventListener?.("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(abortedError());
    }
    signal?.addEventListener?.("abort", onAbort, { once: true });
  });
}

// -> parsed JSON body. `noRedirect` marks a custom base URL (connectProvider()'s `custom`,
// already checked by the SSRF guard): the request goes through providerFetch, so a redirect
// is an error and the connection is pinned to public addresses. `fetch` overrides (tests).
export async function requestJson(url, init = {}, { timeoutMs = 60_000, retries = 3, signal, noRedirect = false, fetch: fetchImpl } = {}) {
  const send = fetchImpl ?? (noRedirect ? providerFetch : globalThis.fetch);
  for (let attempt = 0; ; attempt++) {
    if (signal?.aborted) throw abortedError();
    const timeout = AbortSignal.timeout(timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const failed = (err) => {
      if (signal?.aborted) return abortedError();
      if (timeout.aborted) return providerError({ name: "TimeoutError" });
      return providerError(err);
    };

    let res;
    try {
      res = await send(url, { ...init, signal: combined, redirect: noRedirect ? "error" : "follow" });
    } catch (err) {
      if (!signal?.aborted && isPrivateAddressError(err)) throw unsafeAddressError();
      const error = failed(err);
      if (error.code === "provider_unavailable" && attempt < retries) {
        await sleep(backoffMs(attempt), signal);
        continue;
      }
      throw error;
    }

    if (res.ok) {
      try {
        return await res.json();
      } catch (err) {
        if (signal?.aborted || timeout.aborted) throw failed(err);
        throw new EngineError("bad_response", "The provider returned an unreadable response.", { status: 502, retryable: true });
      }
    }

    await res.text().catch(() => "");
    if ((res.status === 429 || res.status >= 500) && attempt < retries) {
      const wait = retryAfterMs(res.headers?.get?.("retry-after"));
      // A longer Retry-After fails fast; the job-level retry backs off instead.
      if (wait == null || wait <= MAX_RETRY_AFTER_MS) {
        await sleep(wait ?? backoffMs(attempt), signal);
        continue;
      }
    }
    throw providerError({ status: res.status });
  }
}
