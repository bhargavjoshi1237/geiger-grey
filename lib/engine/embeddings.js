// Embeddings interface (spec §6.6, §7.1): dispatches to the connection's embed
// driver (lib/engine/drivers/embed/<format>.js). Batches per model limits, keeps at
// most 3 requests in flight, retries 429/5xx (drivers/http.js), and rejects any
// vector whose length isn't the knowledge base's embedding_dims.
import { EngineError } from "./errors.js";
import { connectProvider } from "./secrets.js";
import {
  DEFAULT_REQUESTED_DIMS,
  MAX_DIMS,
  MIN_DIMS,
  acceptsDimensionParam,
  isValidDims,
  planBatches,
  resolveEmbeddingSpec,
} from "../grey/embedding_models.js";
import * as openai from "./drivers/embed/openai.js";
import * as cohere from "./drivers/embed/cohere.js";
import * as voyage from "./drivers/embed/voyage.js";
import * as google from "./drivers/embed/google.js";

export { toPgVector } from "../grey/embedding_models.js";

const DRIVERS = { openai, cohere, voyage, google };
const MAX_IN_FLIGHT = 3;
const TIMEOUT_MS = { document: 60_000, query: 15_000 };

function dimMismatch(got, expected) {
  return new EngineError(
    "EMBED_DIM_MISMATCH",
    `The model returned ${got}-dimension vectors but this knowledge base expects ${expected}.`,
    { status: 422, retryable: false },
  );
}

// Runs `worker` over `items` with at most `limit` in flight; the first failure
// aborts the rest (via `controller`) and is rethrown.
async function runPool(items, limit, controller, worker) {
  let next = 0;
  let failure = null;
  const lane = async () => {
    while (!failure && next < items.length) {
      const item = items[next++];
      try {
        await worker(item);
      } catch (err) {
        if (!failure) {
          failure = err;
          controller.abort();
        }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  if (failure) throw failure;
}

// One driver call on an already-connected provider (see connectProvider()).
// -> { vectors, tokens }
export async function embedWithConnection(conn, { model, texts, inputType = "document", dimensions, signal, timeoutMs, retries }) {
  const driver = DRIVERS[conn.format];
  if (!driver) throw new EngineError("capability_missing", "This connection's embedding format isn't supported.", { status: 422 });
  return driver.embed({
    baseUrl: conn.baseUrl,
    apiKey: conn.apiKey,
    model,
    texts,
    inputType,
    dimensions,
    signal,
    timeoutMs: timeoutMs ?? TIMEOUT_MS[inputType] ?? TIMEOUT_MS.document,
    retries,
    noRedirect: conn.custom,
  });
}

// kb: { id, embedding_provider_id, embedding_model, embedding_dims } (snake_case row)
// -> { vectors: number[][], tokens, dims }
export async function embedTexts({ admin, projectId, kb, texts, inputType = "document", signal }) {
  if (!kb?.embedding_provider_id) {
    throw new EngineError("no_embedding_provider", "Choose an embedding provider for this knowledge base.", { status: 422 });
  }
  const spec = resolveEmbeddingSpec(kb);
  if (!spec.model) {
    throw new EngineError("no_embedding_model", "Choose an embedding model for this knowledge base.", { status: 422 });
  }
  if (!isValidDims(spec.dims)) {
    throw new EngineError("no_embedding_dims", "Detect the embedding dimensions for this knowledge base first.", { status: 422 });
  }

  const conn = await connectProvider({ admin, projectId, providerId: kb.embedding_provider_id, capability: "embed" });
  if (spec.format && spec.format !== conn.format) {
    throw new EngineError(
      "capability_missing",
      `This knowledge base's embedding model needs a ${spec.format}-format connection.`,
      { status: 422 },
    );
  }

  const list = Array.isArray(texts) ? texts.map((t) => String(t ?? "")) : [];
  if (!list.length) return { vectors: [], tokens: 0, dims: spec.dims };

  const kind = inputType === "query" ? "query" : "document";
  const dimensions = acceptsDimensionParam(conn.format, spec.model) ? spec.dims : undefined;
  const vectors = new Array(list.length);
  let tokens = 0;

  const controller = new AbortController();
  const batchSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  try {
    await runPool(planBatches(list, { format: conn.format }), MAX_IN_FLIGHT, controller, async ({ start, end }) => {
      const out = await embedWithConnection(conn, {
        model: spec.model,
        texts: list.slice(start, end),
        inputType: kind,
        dimensions,
        signal: batchSignal,
      });
      out.vectors.forEach((vector, i) => {
        if (vector.length !== spec.dims) throw dimMismatch(vector.length, spec.dims);
        vectors[start + i] = vector;
      });
      tokens += out.tokens || 0;
    });
  } catch (err) {
    // A caller's abort wins over whatever the in-flight batches reported.
    if (signal?.aborted) throw new EngineError("aborted", "The request was cancelled.", { status: 499 });
    throw err;
  }

  return { vectors, tokens, dims: spec.dims };
}

// Embeds "ping" through the driver and reports the vector length. Drivers that take
// a dimension parameter are asked for `requestedDims` (default 1024).
// `model` may be a provider model id or a legacy Grey key. -> { dims }
export async function detectEmbeddingDims({ admin, projectId, providerId, model, requestedDims }) {
  const id = String(model || "").trim();
  if (!id) throw new EngineError("no_embedding_model", "Choose an embedding model first.", { status: 422 });
  const requested = requestedDims == null || requestedDims === "" ? DEFAULT_REQUESTED_DIMS : Number(requestedDims);
  if (!isValidDims(requested)) {
    throw new EngineError("bad_dims", `Dimensions must be a whole number between ${MIN_DIMS} and ${MAX_DIMS}.`, { status: 422 });
  }

  const conn = await connectProvider({ admin, projectId, providerId, capability: "embed" });
  const spec = resolveEmbeddingSpec({ embedding_model: id });
  if (spec.format && spec.format !== conn.format) {
    throw new EngineError("capability_missing", `This model needs a ${spec.format}-format connection.`, { status: 422 });
  }
  const dimensions = acceptsDimensionParam(conn.format, spec.model) ? requested : undefined;
  const { vectors } = await embedWithConnection(conn, {
    model: spec.model,
    texts: ["ping"],
    inputType: "document",
    dimensions,
    timeoutMs: TIMEOUT_MS.query,
    retries: 1,
  });
  const dims = vectors[0].length;
  if (!isValidDims(dims)) {
    throw new EngineError(
      "unsupported_dims",
      `This model returns ${dims}-dimension vectors; Grey supports ${MIN_DIMS}–${MAX_DIMS}.`,
      { status: 422 },
    );
  }
  return { dims };
}
