// OpenAI-style responses and errors for the v1 chat routes (spec §12.2). Framing and
// request parsing are pure (lib/grey/openai_frames.js); this adds Response plumbing.
import { isEngineError } from "@/lib/engine/errors";
import { engineErrorToOpenAI, openAIErrorBody } from "@/lib/grey/openai_frames";
import { ApiError } from "./errors.js";

export class OpenAIError extends Error {
  constructor(status, code, message, { param = null, headers = {} } = {}) {
    super(message);
    this.name = "OpenAIError";
    this.status = status;
    this.code = code;
    this.param = param;
    this.headers = headers;
  }
}

// Any error -> { status, body: { error: { message, type, code, param } }, headers }.
export function toOpenAIError(error) {
  if (error instanceof OpenAIError) {
    return { status: error.status, body: openAIErrorBody(error.status, error.code, error.message, error.param), headers: error.headers };
  }
  if (error instanceof ApiError) {
    return { status: error.status, body: openAIErrorBody(error.status, error.code, error.message), headers: error.headers || {} };
  }
  if (isEngineError(error)) {
    const mapped = engineErrorToOpenAI(error);
    return { status: mapped.status, body: openAIErrorBody(mapped.status, mapped.code, mapped.message), headers: {} };
  }
  console.error("[lib/server/openai_format]", error);
  return { status: 500, body: openAIErrorBody(500, "internal_error", "Something went wrong."), headers: {} };
}

export function openAIErrorResponse(error, extraHeaders = {}) {
  const { status, body, headers } = toOpenAIError(error);
  return Response.json(body, { status, headers: { ...extraHeaders, ...headers } });
}

export function openAIJson(data, { status = 200, headers = {} } = {}) {
  return Response.json(data, { status, headers });
}

// Route wrapper: every failure answers in the OpenAI error shape.
export function handleOpenAI(fn) {
  return async (request, ctx) => {
    try {
      return await fn(request, ctx);
    } catch (error) {
      return openAIErrorResponse(error);
    }
  };
}
