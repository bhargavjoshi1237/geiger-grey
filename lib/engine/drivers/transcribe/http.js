// HTTP plumbing shared by the transcription drivers: abortable sleep, fetch with retries on
// network errors / 429 / 5xx (×3, honouring Retry-After up to 10 s), and provider-error mapping.
// Error messages never carry keys (redact) or URLs (signed media URLs hold tokens).
import { EngineError } from "../../errors.js";
import { isPrivateAddressError, providerFetch } from "../../net.js";
import { unsafeAddressError } from "../http.js";
import { redact } from "../../../grey/llm_errors.js";
import { cleanProviderMessage } from "../../../grey/transcript_normalize.js";

export const MESSAGES = {
  auth: "The transcription provider rejected the API key — update it in Model Providers.",
  rateLimited: "The transcription provider is rate limiting requests — try again shortly.",
  unavailable: "The transcription provider is unavailable — try again later.",
  tooLarge: "This file is too large for the selected transcription provider.",
  noSpeech: "No speech detected in this file.",
  timeout: "Transcription timed out.",
};

const MAX_RETRY_DELAY_MS = 10_000;

// Resolves after `ms`, or rejects with the signal's reason as soon as it aborts.
export function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function retryDelayMs(response, attempt) {
  const header = response?.headers?.get?.("retry-after");
  const seconds = header == null ? NaN : Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, MAX_RETRY_DELAY_MS);
  return Math.min(1000 * 2 ** attempt, MAX_RETRY_DELAY_MS);
}

// fetch() with up to `retries` retries on network errors, 429 and 5xx. Returns the last Response
// (any status — callers map it); throws only on abort or when the network never answers.
// `custom` (connectProvider()'s flag for a non-default base URL) sends the request through
// providerFetch: a redirect is an error and the connection is pinned to public addresses.
// `fetch` overrides the transport (tests).
export async function fetchWithRetry(url, init = {}, { signal, timeoutMs, retries = 3, custom = false, fetch: fetchImpl } = {}) {
  const send = fetchImpl ?? (custom ? providerFetch : globalThis.fetch);
  for (let attempt = 0; ; attempt += 1) {
    signal?.throwIfAborted();
    const signals = [signal, timeoutMs ? AbortSignal.timeout(timeoutMs) : null].filter(Boolean);
    let response;
    try {
      response = await send(url, {
        ...init,
        ...(custom ? { redirect: "error" } : {}),
        signal: signals.length ? AbortSignal.any(signals) : undefined,
      });
    } catch (error) {
      if (signal?.aborted) throw signal.reason ?? error;
      if (isPrivateAddressError(error)) throw unsafeAddressError();
      if (attempt >= retries) {
        throw new EngineError("provider_unavailable", MESSAGES.unavailable, { status: 503, retryable: true });
      }
      await sleep(retryDelayMs(null, attempt), signal);
      continue;
    }
    if ((response.status === 429 || response.status >= 500) && attempt < retries) {
      await response.body?.cancel().catch(() => {});
      await sleep(retryDelayMs(response, attempt), signal);
      continue;
    }
    return response;
  }
}

export async function readJson(response) {
  const text = await response.text().catch(() => "");
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

// The provider's own explanation, cleaned for display (no URLs, no key, capped).
export function providerDetail(payload, apiKey) {
  const raw = payload?.error?.message ?? payload?.error ?? payload?.message ?? payload?.detail ?? payload?.raw;
  return redact(cleanProviderMessage(typeof raw === "string" ? raw : JSON.stringify(raw ?? "")), apiKey);
}

// Maps a non-OK provider response to an EngineError.
export function providerError(response, payload, apiKey) {
  const status = response.status;
  if (status === 401 || status === 403) return new EngineError("provider_auth", MESSAGES.auth, { status: 401 });
  if (status === 413) return new EngineError("file_too_large", MESSAGES.tooLarge, { status: 413 });
  if (status === 429) return new EngineError("rate_limited", MESSAGES.rateLimited, { status: 429, retryable: true });
  if (status >= 500) return new EngineError("provider_unavailable", MESSAGES.unavailable, { status: 502, retryable: true });
  return new EngineError("transcription_failed", `Transcription failed: ${providerDetail(payload, apiKey)}`, { status: 502 });
}
