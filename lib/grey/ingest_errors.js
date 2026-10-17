// Pure error model for ingestion jobs: JobError plus the retry/backoff rules (spec §5.4).
// A stage throws JobError(code, message, { retryable }). `message` is user-facing — it is
// written to ingestion_jobs.error — so it must never contain document content or provider keys.

export class JobError extends Error {
  constructor(code, message, { retryable = false, cause, details } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "JobError";
    this.code = code;
    this.retryable = Boolean(retryable);
    if (details !== undefined) this.details = details;
  }
}

export const BACKOFF_BASE_MS = 30_000;
export const BACKOFF_MAX_MS = 15 * 60_000;
const JITTER = 0.2;

// min(30s·2^attempts, 15 min) ± 20% jitter. `attempts` is the number of attempts already made.
export function retryDelayMs(attempts, { random = Math.random } = {}) {
  const n = Math.max(0, Number(attempts) || 0);
  const base = Math.min(BACKOFF_BASE_MS * 2 ** n, BACKOFF_MAX_MS);
  const jitter = base * JITTER * (random() * 2 - 1);
  return Math.max(1000, Math.round(base + jitter));
}

// Network-level failures that are worth retrying (Node/undici error codes).
const RETRYABLE_NET_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ECONNABORTED",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "EPIPE",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_SOCKET",
  "57P01", // postgres admin_shutdown
  "08006", // postgres connection_failure
  "08001", // postgres sqlclient_unable_to_establish_sqlconnection
  "40001", // postgres serialization_failure
  "40P01", // postgres deadlock_detected
]);

export function isRetryableStatus(status) {
  return status === 408 || status === 425 || status === 429 || (status >= 500 && status <= 599);
}

function networkCode(err) {
  return err?.code || err?.cause?.code || null;
}

// Engine codes that are transient whatever the throwing module said.
const RETRYABLE_ENGINE_CODES = new Set(["rate_limited", "provider_unavailable", "timeout", "service_unavailable", "settings_unavailable"]);

// Normalises anything thrown by a stage into a JobError. EngineError (lib/engine/errors.js)
// already carries `code`, a safe `message` and `retryable`, so it maps one-to-one.
export function toJobError(err) {
  if (err instanceof JobError) return err;
  const isEngineError = err?.name === "EngineError" || err?.constructor?.name === "EngineError";
  if (isEngineError && err.code) {
    return new JobError(err.code, err.message || "Processing failed.", {
      retryable: Boolean(err.retryable) || RETRYABLE_ENGINE_CODES.has(err.code),
      cause: err,
    });
  }
  if (err?.name === "AbortError" || err?.name === "TimeoutError") {
    return new JobError("timeout", "A processing step timed out.", { retryable: true, cause: err });
  }
  const status = Number(err?.status ?? err?.statusCode);
  if (Number.isFinite(status) && status > 0) {
    return new JobError(
      isRetryableStatus(status) ? "upstream_unavailable" : "upstream_error",
      isRetryableStatus(status)
        ? "A service this job depends on is temporarily unavailable."
        : "A service this job depends on rejected the request.",
      { retryable: isRetryableStatus(status), cause: err },
    );
  }
  const code = networkCode(err);
  if (code && RETRYABLE_NET_CODES.has(code)) {
    return new JobError("network", "A network error interrupted processing.", { retryable: true, cause: err });
  }
  if (err instanceof TypeError && /fetch failed/i.test(err.message || "")) {
    return new JobError("network", "A network error interrupted processing.", { retryable: true, cause: err });
  }
  return new JobError("internal", "Processing failed unexpectedly.", { retryable: false, cause: err });
}

// What the worker does with a failed attempt: retry later or fail for good.
export function retryDecision(err, { attempts, maxAttempts, random } = {}) {
  const jobError = toJobError(err);
  const canRetry = jobError.retryable && Number(attempts) < Number(maxAttempts);
  return canRetry
    ? { action: "retry", delayMs: retryDelayMs(attempts, { random }), error: jobError }
    : { action: "fail", error: jobError };
}
