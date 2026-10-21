// Embedding models and wire formats (spec §4.3, §7.1; images: lookup-tools spec §5.4).
// Pure and browser-safe: request builders and response parsers per driver format
// (text and images), batch planning and the pgvector literal.
// The engine (lib/engine/drivers/embed/*) does the I/O.

export const EMBED_FORMATS = ["openai", "cohere", "voyage", "google", "nomic"];

export const MIN_DIMS = 64;
export const MAX_DIMS = 4000;
// Drivers that accept a dimension parameter are asked for this by default.
export const DEFAULT_REQUESTED_DIMS = 1024;
// Dimensions with a partial HNSW index (spec §7.2); others use exact search.
export const INDEXED_DIMS = [256, 384, 512, 768, 1024, 1536, 2048, 3072];

// Nomic documents no per-request cap, so it gets the conservative default.
export const BATCH_LIMITS = { openai: 256, cohere: 96, voyage: 128, google: 100, nomic: 96 };
// Keeps one request well under every provider's per-request token cap (~100k tokens).
export const MAX_BATCH_CHARS = 400_000;

// Image batches per request. Gemini folds every part of one request into a single
// vector, so it gets one image per call.
export const IMAGE_BATCH_LIMITS = { google: 1, voyage: 32, cohere: 16, nomic: 16 };

const TEXT = Object.freeze(["text"]);
const TEXT_IMAGE = Object.freeze(["text", "image"]);

// Suggested models per driver format. nativeDims is the model's default output;
// dimensionParam says whether the driver may ask for another size; modalities is
// what the model itself embeds (Nomic's text models stay "text": Grey pairs them
// with Nomic's vision models, see imageEmbeddingSpec).
export const SUGGESTED_EMBEDDING_MODELS = {
  openai: [
    { id: "text-embedding-3-large", label: "OpenAI text-embedding-3-large", nativeDims: 3072, dimensionParam: true, modalities: TEXT },
    { id: "text-embedding-3-small", label: "OpenAI text-embedding-3-small", nativeDims: 1536, dimensionParam: true, modalities: TEXT },
    { id: "mistral-embed", label: "Mistral Embed", nativeDims: 1024, dimensionParam: false, modalities: TEXT },
    { id: "nomic-embed-text", label: "Nomic Embed Text", nativeDims: 768, dimensionParam: false, modalities: TEXT },
  ],
  cohere: [
    { id: "embed-v5.0-pro", label: "Cohere Embed v5 Pro", nativeDims: 1536, dimensionParam: true, modalities: TEXT_IMAGE },
    { id: "embed-v5.0-fast", label: "Cohere Embed v5 Fast", nativeDims: 1536, dimensionParam: true, modalities: TEXT_IMAGE },
    { id: "embed-v4.0", label: "Cohere Embed v4", nativeDims: 1536, dimensionParam: true, modalities: TEXT_IMAGE },
  ],
  voyage: [
    { id: "voyage-3.5", label: "Voyage 3.5", nativeDims: 1024, dimensionParam: true, modalities: TEXT },
    { id: "voyage-3.5-lite", label: "Voyage 3.5 Lite", nativeDims: 1024, dimensionParam: true, modalities: TEXT },
    { id: "voyage-3-large", label: "Voyage 3 Large", nativeDims: 1024, dimensionParam: true, modalities: TEXT },
    { id: "voyage-multimodal-3.5", label: "Voyage Multimodal 3.5", nativeDims: 1024, dimensionParam: false, modalities: TEXT_IMAGE },
  ],
  google: [
    { id: "gemini-embedding-001", label: "Gemini Embedding", nativeDims: 3072, dimensionParam: true, modalities: TEXT },
    { id: "gemini-embedding-2", label: "Gemini Embedding 2", nativeDims: 3072, dimensionParam: true, modalities: TEXT_IMAGE },
  ],
  // Hosted Nomic Atlas API. v1.5 is Matryoshka: 64–768 dims, never above its native 768.
  nomic: [
    { id: "nomic-embed-text-v1.5", label: "Nomic Embed Text v1.5", nativeDims: 768, dimensionParam: true, modalities: TEXT },
    { id: "nomic-embed-text-v1", label: "Nomic Embed Text v1", nativeDims: 768, dimensionParam: false, modalities: TEXT },
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
  if (format === "nomic") return /^nomic-embed-text-v1\.5/.test(id);
  return false;
}

// Dimensions to ask a dimension-param model for when the caller doesn't say: the
// default, capped at the model's native size (Matryoshka models can't go above it).
export function defaultRequestedDims(format, model) {
  const id = stripModelsPrefix(model);
  const native = SUGGESTED_EMBEDDING_MODELS[format]?.find((m) => m.id === id)?.nativeDims;
  return native ? Math.min(DEFAULT_REQUESTED_DIMS, native) : DEFAULT_REQUESTED_DIMS;
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
  nomic: { document: "search_document", query: "search_query" },
};

// gemini-embedding-2 rejects taskType; the task goes in a text prefix instead.
const isGeminiEmbedding2 = (model) => /^gemini-embedding-2/.test(stripModelsPrefix(model).toLowerCase());
const GEMINI_2_PREFIX = { document: "title: none | text: ", query: "task: search result | query: " };

// Voyage's multimodal models take text through /multimodalembeddings too.
const isVoyageMultimodal = (model) => /^voyage-multimodal-/.test(String(model || "").toLowerCase());

const googleHeaders = (apiKey) => (apiKey ? { "x-goog-api-key": apiKey } : {});

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
    if (isVoyageMultimodal(model)) {
      url = joinUrl(baseUrl, "multimodalembeddings");
      body = { model, inputs: texts.map((text) => ({ content: [{ type: "text", text }] })), input_type: INPUT_TYPES.voyage[kind] };
    } else {
      url = joinUrl(baseUrl, "embeddings");
      body = { model, input: texts, input_type: INPUT_TYPES.voyage[kind] };
    }
    if (dimensions) body.output_dimension = dimensions;
    Object.assign(headers, bearer(apiKey));
  } else if (format === "google") {
    const id = stripModelsPrefix(model);
    const prefix = isGeminiEmbedding2(id) ? GEMINI_2_PREFIX[kind] : null;
    url = joinUrl(baseUrl, `models/${encodeURIComponent(id)}:batchEmbedContents`);
    body = {
      requests: texts.map((text) => {
        const req = prefix
          ? { model: `models/${id}`, content: { parts: [{ text: prefix + text }] } }
          : { model: `models/${id}`, content: { parts: [{ text }] }, taskType: INPUT_TYPES.google[kind] };
        if (dimensions) req.outputDimensionality = dimensions;
        return req;
      }),
    };
    Object.assign(headers, googleHeaders(apiKey));
  } else if (format === "nomic") {
    url = joinUrl(baseUrl, "embedding/text");
    body = { model, texts, task_type: INPUT_TYPES.nomic[kind] };
    if (dimensions) body.dimensionality = dimensions;
    Object.assign(headers, bearer(apiKey));
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
  } else if (format === "nomic") {
    vectors = Array.isArray(json?.embeddings) ? json.embeddings : null;
    tokens = json?.usage?.total_tokens ?? json?.usage?.prompt_tokens;
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

// --- Images -------------------------------------------------------------------

// Nomic's vision models share the space of these text models at their full 768 dims.
const NOMIC_VISION_MODELS = { "nomic-embed-text-v1.5": "nomic-embed-vision-v1.5", "nomic-embed-text-v1": "nomic-embed-vision-v1" };
const NOMIC_VISION_DIMS = 768;

// The model that embeds images into a knowledge base's vector space, or null when
// its text model has no image counterpart. -> { model } | null
export function imageEmbeddingSpec({ format, model, dims } = {}) {
  const id = stripModelsPrefix(model).trim().toLowerCase();
  if (!id) return null;
  if (format === "google") return /^gemini-embedding-2/.test(id) ? { model } : null;
  if (format === "voyage") return /^voyage-multimodal-/.test(id) ? { model } : null;
  if (format === "cohere") return /^embed-v[4-9]/.test(id) ? { model } : null;
  if (format === "nomic") {
    const vision = NOMIC_VISION_MODELS[id];
    return vision && Number(dims) === NOMIC_VISION_DIMS ? { model: vision } : null;
  }
  return null;
}

// UI helper: whether a connection format + model id embeds images. `dims` is the
// detected size, or null for the size Detect would ask for.
export function modelSupportsImages(format, model, dims = null) {
  const id = stripModelsPrefix(model);
  const expected = acceptsDimensionParam(format, id)
    ? defaultRequestedDims(format, id)
    : SUGGESTED_EMBEDDING_MODELS[format]?.find((m) => m.id === id)?.nativeDims ?? null;
  return imageEmbeddingSpec({ format, model, dims: dims ?? expected }) !== null;
}

// Images arrive as { data /* bare base64 */, mimeType }; a data URI is tolerated.
function imageParts(image) {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(String(image?.data || ""));
  const data = match ? match[2] : String(image?.data || "");
  const mimeType = String(image?.mimeType || match?.[1] || "");
  if (!data || !mimeType) throw new Error("An image needs base64 data and a MIME type.");
  return { data, mimeType };
}

const dataUri = ({ data, mimeType }) => `data:${mimeType};base64,${data}`;

// Decoded inside the function so the module stays browser-safe (no Buffer).
function imageBlob({ data, mimeType }) {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}

const IMAGE_EXTENSIONS = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };

// -> { url, init } for one image-embedding request (`model` is imageEmbeddingSpec().model).
// `dimensions` is sent only when given; Nomic's vision models have none.
export function buildImageEmbedRequest({ format, baseUrl, apiKey, model, images, inputType = "document", dimensions }) {
  const limit = IMAGE_BATCH_LIMITS[format];
  if (!limit) throw new Error(`The ${format} format can't embed images.`);
  const list = (images || []).map(imageParts);
  if (!list.length) throw new Error("Nothing to embed.");
  if (list.length > limit) throw new Error(`The ${format} format takes at most ${limit} images per request.`);
  const kind = inputType === "query" ? "query" : "document";
  const headers = { "Content-Type": "application/json" };
  let url;
  let body;
  if (format === "google") {
    const id = stripModelsPrefix(model);
    const [image] = list;
    url = joinUrl(baseUrl, `models/${encodeURIComponent(id)}:embedContent`);
    body = { model: `models/${id}`, content: { parts: [{ inline_data: { mime_type: image.mimeType, data: image.data } }] } };
    if (dimensions) body.outputDimensionality = dimensions;
    Object.assign(headers, googleHeaders(apiKey));
  } else if (format === "voyage") {
    url = joinUrl(baseUrl, "multimodalembeddings");
    body = {
      model,
      inputs: list.map((image) => ({ content: [{ type: "image_base64", image_base64: dataUri(image) }] })),
      input_type: INPUT_TYPES.voyage[kind],
    };
    if (dimensions) body.output_dimension = dimensions;
    Object.assign(headers, bearer(apiKey));
  } else if (format === "cohere") {
    url = cohereUrl(baseUrl, "embed");
    body = {
      model,
      inputs: list.map((image) => ({ content: [{ type: "image_url", image_url: { url: dataUri(image) } }] })),
      input_type: INPUT_TYPES.cohere[kind],
      embedding_types: ["float"],
    };
    if (dimensions) body.output_dimension = dimensions;
    Object.assign(headers, bearer(apiKey));
  } else if (format === "nomic") {
    // Multipart: fetch sets Content-Type (with the boundary) itself.
    const form = new FormData();
    form.append("model", model);
    list.forEach((image, i) => form.append("images", imageBlob(image), `image-${i + 1}.${IMAGE_EXTENSIONS[image.mimeType] || "bin"}`));
    return { url: joinUrl(baseUrl, "embedding/image"), init: { method: "POST", headers: bearer(apiKey), body: form } };
  }
  return { url, init: { method: "POST", headers, body: JSON.stringify(body) } };
}

const sumFinite = (...values) => {
  const finite = values.filter(Number.isFinite);
  return finite.length ? finite.reduce((a, b) => a + b, 0) : undefined;
};

// -> { vectors: number[][], tokens } ; throws when the payload doesn't hold `count`
// vectors. Providers that report no usage count 0 tokens (images have no length to estimate).
export function parseImageEmbedResponse(format, json, count) {
  let vectors;
  let tokens;
  if (format === "google") {
    const one = json?.embedding?.values ?? json?.embeddings?.[0]?.values;
    vectors = Array.isArray(one) ? [one] : null;
    tokens = json?.usageMetadata?.promptTokenCount ?? json?.usageMetadata?.totalTokenCount;
  } else if (format === "voyage") {
    vectors = Array.isArray(json?.data) ? byIndex(json.data).map((d) => d?.embedding) : null;
    tokens = json?.usage?.total_tokens;
  } else if (format === "cohere") {
    const emb = json?.embeddings;
    vectors = Array.isArray(emb?.float) ? emb.float : Array.isArray(emb) ? emb : null;
    const billed = json?.meta?.billed_units;
    tokens = sumFinite(billed?.input_tokens, billed?.image_tokens);
  } else if (format === "nomic") {
    vectors = Array.isArray(json?.embeddings) ? json.embeddings : null;
    tokens = json?.usage?.total_tokens ?? json?.usage?.prompt_tokens;
  } else {
    throw new Error(`The ${format} format can't embed images.`);
  }
  if (!vectors || vectors.some((v) => !Array.isArray(v) || !v.length)) {
    throw new Error("The embedding response had no vectors.");
  }
  if (Number.isInteger(count) && vectors.length !== count) {
    throw new Error(`Expected ${count} vectors, got ${vectors.length}.`);
  }
  return { vectors, tokens: Number.isFinite(tokens) ? tokens : 0 };
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
