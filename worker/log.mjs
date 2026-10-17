// pino JSON logger. Log lines carry ids (jobId, projectId, stage, code) — never document
// content, transcripts or provider keys; the redact list is a backstop, not the policy.
import pino from "pino";

const REDACT = [
  "apiKey",
  "*.apiKey",
  "key",
  "secret",
  "*.secret",
  "authorization",
  "*.authorization",
  "headers.authorization",
  "headers.Authorization",
  "content",
  "*.content",
  "text",
  "*.text",
  "markdown",
  "*.markdown",
  "transcript",
  "*.transcript",
];

export function createLogger({ level = process.env.LOG_LEVEL || "info", ...options } = {}) {
  return pino({
    level,
    base: { service: "grey-worker" },
    redact: { paths: REDACT, censor: "[redacted]" },
    ...options,
  });
}

// Error fields that are safe to log: code + message (JobError/EngineError messages are
// user-facing and redacted by construction) and the stack for unexpected errors only.
export function errorFields(err) {
  if (!err) return {};
  const out = { code: err.code || null, name: err.name || "Error", message: err.message || String(err) };
  if (err.name !== "JobError" && err.name !== "EngineError" && err.stack) out.stack = err.stack;
  return out;
}
