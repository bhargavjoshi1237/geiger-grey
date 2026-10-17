// Engine error: a stable `code` callers branch on, a user-safe `message`, the HTTP
// status a route should answer with, and whether a job may retry it.
// Shared by Next routes and the worker (plain Node — relative imports only).

export class EngineError extends Error {
  constructor(code, message, { status = 500, retryable = false } = {}) {
    super(message);
    this.name = "EngineError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

export function isEngineError(err) {
  return err instanceof EngineError || err?.name === "EngineError";
}
