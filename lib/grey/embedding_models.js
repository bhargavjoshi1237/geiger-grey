// Embedding models and wire formats (spec §4.3, §7.1). Pure: request builders and
// response parsers per driver format, batch planning and the pgvector literal.
// The engine (lib/engine/drivers/embed/*) does the I/O.

export const EMBED_FORMATS = ["openai", "cohere", "voyage", "google"];

export const MIN_DIMS = 64;
export const MAX_DIMS = 4000;
// Drivers that accept a dimension parameter are asked for this by default.
export const DEFAULT_REQUESTED_DIMS = 1024;
// Dimensions with a partial HNSW index (spec §7.2); others use exact search.
export const INDEXED_DIMS = [256, 384, 512, 768, 1024, 1536, 2048, 3072];

export const BATCH_LIMITS = { openai: 256, cohere: 96, voyage: 128, google: 100 };
// Keeps one request well under every provider's per-request token cap (~100k tokens).
export const MAX_BATCH_CHARS = 400_000;

// Suggested models per driver format. nativeDims is the model's default output;
// dimensionParam says whether the driver may ask for another size.
export const SUGGESTED_EMBEDDING_MODELS = {
  openai: [
    { id: "text-embedding-3-large", label: "OpenAI text-embedding-3-large", nativeDims: 3072, dimensionParam: true },
    { id: "text-embedding-3-small", label: "OpenAI text-embedding-3-small", nativeDims: 1536, dimensionParam: true },
    { id: "mistral-embed", label: "Mistral Embed", nativeDims: 1024, dimensionParam: false },
    { id: "nomic-embed-text", label: "Nomic Embed Text", nativeDims: 768, dimensionParam: false },
  ],
  cohere: [
    { id: "embed-v5.0-pro", label: "Cohere Embed v5 Pro", nativeDims: 1536, dimensionParam: true },
    { id: "embed-v5.0-fast", label: "Cohere Embed v5 Fast", nativeDims: 1536, dimensionParam: true },
    { id: "embed-v4.0", label: "Cohere Embed v4", nativeDims: 1536, dimensionParam: true },
  ],
  voyage: [
    { id: "voyage-3.5", label: "Voyage 3.5", nativeDims: 1024, dimensionParam: true },
    { id: "voyage-3.5-lite", label: "Voyage 3.5 Lite", nativeDims: 1024, dimensionParam: true },
    { id: "voyage-3-large", label: "Voyage 3 Large", nativeDims: 1024, dimensionParam: true },
  ],
  google: [
    { id: "gemini-embedding-001", label: "Gemini Embedding", nativeDims: 3072, dimensionParam: true },
  ],
};

// Knowledge bases created before BYO providers stored a Grey model key instead of
// the provider's model id; these map to driver + API model id + dims.
export const LEGACY_EMBEDDING_MODELS = {
  "cohere-embed-5-pro": { format: "cohere", model: "embed-v5.0-pro", dims: 1024, label: "Cohere Embed v5 Pro" },
  "cohere-embed-5-fast": { format: "cohere", model: "embed-v5.0-fast", dims: 1024, label: "Cohere Embed v5 Fast" },
  "openai-text-embedding-3-large": { format: "openai", model: "text-embedding-3-large", dims: 1024, label: "OpenAI text-embedding-3-large" },
  "voyage-3.5": { format: "voyage", model: "voyage-3.5", dims: 1024, label: "Voyage 3.5" },
};

const LABELS = (() => {
  const map = {};
  for (const list of Object.values(SUGGESTED_EMBEDDING_MODELS)) for (const m of list) map[m.id] = m.label;
  for (const [key, legacy] of Object.entries(LEGACY_EMBEDDING_MODELS)) map[key] = legacy.label;
  return map;
})();

export function embeddingModelLabel(value) {
  return LABELS[value] || value || "";
}

export function isLegacyEmbeddingModel(value) {
  return Object.prototype.hasOwnProperty.call(LEGACY_EMBEDDING_MODELS, value);
}

export function isValidDims(value) {
  return Number.isInteger(value) && value >= MIN_DIMS && value <= MAX_DIMS;
}

export function isIndexedDims(value) {
  return INDEXED_DIMS.includes(value);
}

const stripModelsPrefix = (model) => String(model || "").replace(/^models\//, "");

// Whether the driver may send a dimension parameter for this model. OpenAI-format
// servers only get `dimensions` for models known to accept it (text-embedding-3-*).
export function acceptsDimensionParam(format, model) {
  const id = stripModelsPrefix(model).toLowerCase();
  if (format === "openai") return /^text-embedding-3-/.test(id);
  if (format === "cohere") return /^embed-v[4-9]/.test(id);
  if (format === "voyage") return /^voyage-(3\.5|3-large|code-3|context-3|[4-9])/.test(id);
  if (format === "google") return /^(gemini-embedding|text-embedding-00[4-9])/.test(id);
  return false;
}

// Model id + dims a knowledge base embeds with. Accepts snake_case or camelCase rows.
// Legacy keys resolve through the legacy table (their dims default to 1024).
export function resolveEmbeddingSpec(kb) {
  const stored = kb?.embedding_model ?? kb?.embeddingModel ?? null;
  const storedDims = kb?.embedding_dims ?? kb?.embeddingDims ?? null;
  const dims = storedDims == null ? null : Number(storedDims);
  const legacy = stored ? LEGACY_EMBEDDING_MODELS[stored] : null;
  if (legacy) return { model: legacy.model, dims: dims ?? legacy.dims, format: legacy.format, legacy: true };
  return { model: stored, dims, format: null, legacy: false };
}

export function joinUrl(base, path) {
  return `${String(base || "").replace(/\/+$/, "")}/${String(path || "").replace(/^\/+/, "")}`;
}

// Cohere-format servers (embed, rerank): the official API is versioned in the path
// (/v2/embed); compatible servers configured with a versioned base (…/v1) take the bare path.
export function cohereUrl(base, endpoint) {
  return /\/v\d+$/.test(String(base || "").replace(/\/+$/, ""))
    ? joinUrl(base, endpoint)
    : joinUrl(base, `v2/${endpoint}`);
}

const bearer = (apiKey) => (apiKey ? { Authorization: `Bearer ${apiKey}` } : {});

const INPUT_TYPES = {
  cohere: { document: "search_document", query: "search_query" },
  voyage: { document: "document", query: "query" },
  google: { document: "RETRIEVAL_DOCUMENT", query: "RETRIEVAL_QUERY" },
};

// -> { url, init } for one embedding request. `dimensions` is sent only when given;
// callers decide with acceptsDimensionParam().
export function buildEmbedRequest({ format, baseUrl, apiKey, model, texts, inputType = "document", dimensions }) {
  const headers = { "Content-Type": "application/json" };
  const kind = inputType === "query" ? "query" : "document";
  let url;
  let body;
  if (format === "openai") {
    url = joinUrl(baseUrl, "embeddings");
    body = { model, input: texts, encoding_format: "float" };
    if (dimensions) body.dimensions = dimensions;
    Object.assign(headers, bearer(apiKey));
  } else if (format === "cohere") {
    url = cohereUrl(baseUrl, "embed");
    body = { model, texts, input_type: INPUT_TYPES.cohere[kind], embedding_types: ["float"] };
    if (dimensions) body.output_dimension = dimensions;
    Object.assign(headers, bearer(apiKey));
  } else if (format === "voyage") {
    url = joinUrl(baseUrl, "embeddings");
    body = { model, input: texts, input_type: INPUT_TYPES.voyage[kind] };
    if (dimensions) body.output_dimension = dimensions;
    Object.assign(headers, bearer(apiKey));
  } else if (format === "google") {
    const id = stripModelsPrefix(model);
    url = joinUrl(baseUrl, `models/${encodeURIComponent(id)}:batchEmbedContents`);
    body = {
      requests: texts.map((text) => {
        const req = { model: `models/${id}`, content: { parts: [{ text }] }, taskType: INPUT_TYPES.google[kind] };
        if (dimensions) req.outputDimensionality = dimensions;
        return req;
      }),
    };
    if (apiKey) headers["x-goog-api-key"] = apiKey;
  } else {
    throw new Error(`Unknown embedding format: ${format}`);
  }
  return { url, init: { method: "POST", headers, body: JSON.stringify(body) } };
}

// Rough token estimate for providers that don't report usage (≈ 4 chars/token).
export function estimateTokens(texts) {
  return Math.ceil((texts || []).reduce((sum, t) => sum + String(t || "").length, 0) / 4);
}

function byIndex(items) {
  return [...items].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
}

// -> { vectors: number[][], tokens } ; throws when the payload has no vectors.
export function parseEmbedResponse(format, json, texts = []) {
  let vectors;
  let tokens;
  if (format === "openai") {
    vectors = Array.isArray(json?.data) ? byIndex(json.data).map((d) => d.embedding) : null;
    tokens = json?.usage?.total_tokens ?? json?.usage?.prompt_tokens;
  } else if (format === "cohere") {
    const emb = json?.embeddings;
    vectors = Array.isArray(emb) ? emb : Array.isArray(emb?.float) ? emb.float : null;
    tokens = json?.meta?.billed_units?.input_tokens;
  } else if (format === "voyage") {
    vectors = Array.isArray(json?.data) ? byIndex(json.data).map((d) => d.embedding) : null;
    tokens = json?.usage?.total_tokens;
  } else if (format === "google") {
    vectors = Array.isArray(json?.embeddings) ? json.embeddings.map((e) => e?.values) : null;
  } else {
    throw new Error(`Unknown embedding format: ${format}`);
  }
  if (!vectors || vectors.some((v) => !Array.isArray(v) || !v.length)) {
    throw new Error("The embedding response had no vectors.");
  }
  if (texts.length && vectors.length !== texts.length) {
    throw new Error(`Expected ${texts.length} vectors, got ${vectors.length}.`);
  }
  return { vectors, tokens: Number.isFinite(tokens) ? tokens : estimateTokens(texts) };
}

// Splits texts into [start, end) ranges within the format's batch size and a
// character budget. A single oversized text still gets its own batch.
export function planBatches(texts, { format, maxBatch, maxChars = MAX_BATCH_CHARS } = {}) {
  const limit = Math.max(1, maxBatch || BATCH_LIMITS[format] || 96);
  const batches = [];
  let start = 0;
  let chars = 0;
  for (let i = 0; i < texts.length; i++) {
    const len = String(texts[i] ?? "").length;
    const full = i - start >= limit || (i > start && chars + len > maxChars);
    if (full) {
      batches.push({ start, end: i });
      start = i;
      chars = 0;
    }
    chars += len;
  }
  if (texts.length > start) batches.push({ start, end: texts.length });
  return batches;
}

// '[0.1,0.2,…]' — the literal pgvector/halfvec columns accept.
export function toPgVector(numbers) {
  if (!Array.isArray(numbers) || !numbers.length) throw new Error("A vector needs at least one value.");
  for (const n of numbers) if (typeof n !== "number" || !Number.isFinite(n)) throw new Error("Vector values must be finite numbers.");
  return `[${numbers.join(",")}]`;
}
