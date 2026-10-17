// Provider error mapping and secret redaction (spec §8.6). Pure. Works with AI SDK
// errors (APICallError / RetryError), fetch failures and the engine's own errors by
// duck typing, so it never imports the SDK. Raw provider text is never returned.

const MESSAGES = {
  provider_auth: "The model provider rejected the API key — update it in Model Providers.",
  model_not_found: "The model wasn't found on this provider — check the model id.",
  bad_request: "The provider rejected the request — check the model id and settings.",
  rate_limited: "The model provider is rate limiting requests — try again shortly.",
  provider_unavailable: "The model provider is unavailable right now — try again shortly.",
  timeout: "The model provider took too long to respond.",
  aborted: "The request was cancelled.",
  generation_failed: "The model couldn't generate a response.",
  unsafe_base_url: "This provider's base URL points to a private network address and can't be used.",
};

// HTTP status Grey answers with (an upstream 401 must never look like a Grey 401).
const STATUS = {
  provider_auth: 502,
  model_not_found: 502,
  bad_request: 502,
  rate_limited: 429,
  provider_unavailable: 502,
  timeout: 504,
  aborted: 499,
  generation_failed: 502,
  unsafe_base_url: 422,
};

const RETRYABLE = new Set(["rate_limited", "provider_unavailable", "timeout"]);

export const LLM_ERROR_CODES = Object.keys(MESSAGES);

const NETWORK_CODES = new Set([
  "ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "EAI_AGAIN", "EHOSTUNREACH", "ENETUNREACH", "EPIPE",
  "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_SOCKET", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT",
]);

function upstreamStatus(err) {
  const candidates = [err?.statusCode, err?.status, err?.response?.status, err?.lastError?.statusCode, err?.cause?.statusCode];
  for (const value of candidates) {
    const n = Number(value);
    if (Number.isInteger(n) && n >= 100 && n <= 599) return n;
  }
  return null;
}

function isTimeout(err) {
  const names = [err?.name, err?.cause?.name, err?.lastError?.name, err?.reason?.name];
  if (names.includes("TimeoutError")) return true;
  const code = err?.code || err?.cause?.code;
  return code === "ETIMEDOUT" || code === "UND_ERR_CONNECT_TIMEOUT" || code === "UND_ERR_HEADERS_TIMEOUT";
}

function isNetwork(err) {
  const code = err?.code || err?.cause?.code || err?.lastError?.cause?.code;
  if (code && NETWORK_CODES.has(code)) return true;
  if (err?.name === "TypeError" && /fetch failed|network/i.test(err?.message || "")) return true;
  // AI SDK APICallError without a status = the request never got a response.
  return err?.name === "AI_APICallError" && err?.statusCode == null && err?.isRetryable === true;
}

// The connect-time SSRF guard (lib/engine/net.js) tags its refusal with this code; AI SDK errors
// wrap it in their cause chain, so walk it rather than importing net.js into this pure module.
const PRIVATE_ADDRESS_CODE = "EPRIVATEADDR";
function isPrivateAddressRefusal(err) {
  for (let e = err, depth = 0; e && depth < 6; e = e.cause ?? e.lastError, depth += 1) {
    if (e.code === PRIVATE_ADDRESS_CODE) return true;
  }
  return false;
}

function result(code, providerStatus = null) {
  return {
    code,
    message: MESSAGES[code],
    status: STATUS[code],
    retryable: RETRYABLE.has(code),
    providerStatus,
    // provider_auth means the stored key is bad: the connection is marked `error`.
    markProviderError: code === "provider_auth",
  };
}

// -> { code, message, status, retryable, providerStatus, markProviderError }
export function mapLlmError(err) {
  if (err?.code && MESSAGES[err.code] && err?.name === "EngineError") return result(err.code, err.providerStatus ?? null);
  if (isTimeout(err)) return result("timeout");
  if (err?.name === "AbortError" || err?.cause?.name === "AbortError") return result("aborted");
  if (isPrivateAddressRefusal(err)) return result("unsafe_base_url");

  const status = upstreamStatus(err);
  if (status === 401 || status === 403) return result("provider_auth", status);
  if (status === 404) return result("model_not_found", status);
  if (status === 429) return result("rate_limited", status);
  if (status === 400 || status === 422) return result("bad_request", status);
  if (status === 408) return result("timeout", status);
  if (status != null && status >= 500) return result("provider_unavailable", status);
  if (status == null && isNetwork(err)) return result("provider_unavailable");
  return result("generation_failed", status);
}

const REDACTED = "[redacted]";
const PATTERNS = [
  [/sk-[A-Za-z0-9_-]{8,}/g, REDACTED],
  [/gk_live_[A-Za-z0-9]{8,}/g, REDACTED],
  [/AIza[0-9A-Za-z_-]{20,}/g, REDACTED],
  [/(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, `$1${REDACTED}`],
  [/((?:api[_-]?key|x-api-key|x-goog-api-key|authorization|access[_-]?token|key)["']?\s*[:=]\s*["']?)[^\s"'&,}]+/gi, `$1${REDACTED}`],
];

function stringify(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

// Strips the given secret and anything key-shaped, for logs and stored errors.
export function redact(value, secret) {
  let text = stringify(value);
  if (typeof secret === "string" && secret.length >= 4) text = text.split(secret).join(REDACTED);
  for (const [re, replacement] of PATTERNS) text = text.replace(re, replacement);
  return text;
}
