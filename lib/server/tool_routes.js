// Shared by every channel that runs a lookup tool (spec §5.10): the session run route, the v1
// run route and the MCP lookup tools. Holds the run order every channel follows (input rules →
// image checks → dHash → runTool), the per-tool limits of the public channels, the request-body
// cap and the public shape of a result (signed thumbnail URLs, never storage paths).
// Relative imports only, so lib/server/mcp/tools.js stays loadable under plain node --test.
import { createHash } from "node:crypto";
import { EngineError, isEngineError } from "../engine/errors.js";
import { dhash } from "../engine/image.js";
import { withThumbnails } from "../engine/media.js";
import { runTool } from "../engine/tool_runtime.js";
import { monthlyRunCount } from "../engine/tool_runs.js";
import { IMAGE_LIMITS, parseImageInput } from "../grey/image_input.js";
import { normalizeToolInput, normalizeToolSpec } from "../grey/tool_spec.js";
import { ApiError } from "./errors.js";

// A 4 MB image is ~5.6 MB as base64, plus the JSON around it.
export const MAX_TOOL_BODY_BYTES = 6 * 1024 * 1024;
export const TOOL_RATE_LIMIT_PER_MIN = 60;
export const SESSION_THUMBNAIL_SECONDS = 60 * 60;
export const PUBLIC_THUMBNAIL_SECONDS = 10 * 60;

export const toolRateBucket = (toolId) => `tool:${toolId}`;

// SHA-256 (hex) of the normalised spec's JSON — stored with a test report so the Tools screen
// can tell whether the report still matches the draft.
export function toolSpecHash(spec) {
  return createHash("sha256").update(JSON.stringify(normalizeToolSpec(spec))).digest("hex");
}

const tooLarge = () =>
  new ApiError(
    "payload_too_large",
    413,
    `The request is too large — send an image of ${IMAGE_LIMITS.maxBytes / (1024 * 1024)} MB or less.`,
  );

// Rejects a request whose declared size is over the cap, before anything is read.
export function checkContentLength(request, maxBytes = MAX_TOOL_BODY_BYTES) {
  const declared = Number(request?.headers?.get?.("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw tooLarge();
}

/**
 * The JSON body, read with a hard size cap (the declared content-length first, then the bytes
 * actually received, so a chunked upload can't get past it). -> the parsed value, or null when
 * the body is empty or isn't JSON. Throws ApiError payload_too_large (413).
 */
export async function readJsonBody(request, { maxBytes = MAX_TOOL_BODY_BYTES } = {}) {
  checkContentLength(request, maxBytes);
  if (!request?.body) return null;
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      throw tooLarge();
    }
    chunks.push(value);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * "live", a published version number, or — where `allowDraft` — 0 for the draft. Absent ->
 * `fallback`. -> the version, or undefined when the value isn't one of those.
 */
export function parseRunVersion(value, { fallback, allowDraft = false }) {
  if (value === undefined || value === null) return fallback;
  if (value === "live") return "live";
  if (Number.isInteger(value) && value >= (allowDraft ? 0 : 1)) return value;
  return undefined;
}

const inputError = (code, message) => new EngineError(code, message, { status: 422 });

/**
 * A run's input, checked against the spec: required/off inputs and text length, then the image
 * (type sniffed from the bytes, size and dimension caps) with its dHash for near-duplicate flags.
 * -> { text: string|null, image: parsed image (+ dhash) | null }. Throws EngineError (422) with
 * the input rule's code (text_required, image_too_large, invalid_image, …).
 */
export async function prepareToolInput(spec, raw) {
  const normalized = normalizeToolInput(spec, raw);
  if (!normalized.ok) throw inputError(normalized.code, normalized.message);
  const { text, imageRaw } = normalized.input;
  if (!imageRaw) return { text, image: null };

  const parsed = parseImageInput(imageRaw);
  if (!parsed.ok) throw inputError(parsed.code, parsed.message);
  let hash;
  try {
    hash = await dhash(Buffer.from(parsed.image.bytes));
  } catch (error) {
    if (!isEngineError(error)) console.error("[lib/server/tool_routes.dhash]", error?.message || error);
    throw inputError("invalid_image", "This image couldn't be read.");
  }
  return { text, image: { ...parsed.image, dhash: hash } };
}

// An image-only query the tool's knowledge bases can't search returns nothing useful: answer
// 422 image_query_unsupported instead of an empty result (spec §7).
export function assertSearchable(result, input) {
  if (input?.text || result?.usage?.searched) return;
  const unsupported = (result?.warnings || []).find((w) => w.code === "image_query_unsupported");
  if (unsupported) throw inputError("image_query_unsupported", unsupported.message);
}

/**
 * The run order every channel follows. Never throws: -> { ok: true, input, result } |
 * { ok: false, input, result, error } so the caller can log the failed run before answering.
 * `deps` is passed to runTool (tests).
 */
export async function runToolForChannel({ admin, projectId, spec, raw, channel, signal, deps }) {
  let input = { text: null, image: null };
  let result = null;
  try {
    input = await prepareToolInput(spec, raw);
    result = await runTool({ admin, projectId, spec, input, channel, signal, deps });
    assertSearchable(result, input);
    return { ok: true, input, result };
  } catch (error) {
    return { ok: false, input, result, error };
  }
}

// The error code a failed run is logged with.
export const runErrorCode = (error) => (isEngineError(error) || error instanceof ApiError ? error.code : "internal_error");

/**
 * budget.monthlyRunLimit on the public channels: throws EngineError tool_run_limit (429) once
 * this month's successful runs reach it (and service_unavailable when they can't be counted —
 * the limit fails closed).
 */
export async function checkMonthlyRunLimit({ admin, projectId, toolId, spec }) {
  const limit = spec?.budget?.monthlyRunLimit;
  if (!limit) return;
  const used = await monthlyRunCount({ admin, projectId, toolId });
  if (used >= limit) {
    throw new EngineError("tool_run_limit", "This tool has reached its monthly run limit.", { status: 429 });
  }
}

// Images keep their size; the storage path never leaves the server.
const publicImage = (image) =>
  image && typeof image === "object" ? { width: image.width ?? null, height: image.height ?? null } : null;

/** The result without thumbnail storage paths (MCP structuredContent). */
export function withoutThumbPaths(result) {
  return {
    ...result,
    similar: (result?.similar || []).map(({ image, ...item }) => ({ ...item, image: publicImage(image) })),
  };
}

/** The result with `similar[].thumbnailUrl` (signed for `seconds`, null when none) and no storage paths. */
export async function withThumbnailUrls({ admin, projectId, result, seconds }) {
  const signed = await withThumbnails({ admin, projectId, items: result?.similar || [], seconds });
  return {
    ...result,
    similar: signed.map(({ image, ...item }) => ({ ...item, image: publicImage(image) })),
  };
}
