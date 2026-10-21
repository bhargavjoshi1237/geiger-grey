# Lookup tools and visual search — design

**Status:** approved for implementation (2026-10-21). **Research:** `reports/AI tool builder and visual search.md` (verdict, market, BYO economics, safety) and `reports/Knowledge base uses beyond chat.md` (the "typed task" this generalises).

## 1. What ships

A project member opens **Tools**, picks one of three templates and shapes the tool in a chat with a builder agent (or a form). The tool is a **typed, versioned spec drawn from a closed vocabulary**; Grey's own interpreter runs it against the project's knowledge bases. It never generates code, never fetches URLs and has no outbound action.

| Template | Input | Output |
|---|---|---|
| `find_similar` | image and/or text | ranked stored items with thumbnails, scores, labels, near-duplicate flags |
| `classify` | image and/or text | one label from a fixed set + confidence + the stored items that justify it (nearest-neighbour vote, optional LLM fallback) |
| `answer_similar` | image and/or text (a question) | a cited answer from the most similar stored items, or an abstention |

To make this possible, **images become searchable**: image sources are ingested as one image chunk (caption/OCR text + a pixel vector when the knowledge base's embedding model is multimodal), retrieval accepts an image as the query, and sources carry human-applied **labels** that classifiers vote with.

Published tools are served on an internal page, a REST endpoint (`POST /api/v1/tools/{id}/run`, API-key scope `tools`) and as MCP tools on any MCP server that enables them.

**Out of scope (later):** public widget, index-side region vectors, video/audio queries, generated code steps, write-back into Flow/Forms, webhooks, a separate media-embeddings table, approving LLM decisions into labelled examples.

## 2. Principles (non-negotiable)

1. **BYO only.** Every model call uses a provider the customer attached (embedding: the KB's connection; vision/LLM: the tool's model or the project processing model). Grey hosts no model.
2. **The spec is the boundary.** Project id, knowledge-base ids and provider connections come from the server-side tool row, never from the model or the runtime input. RLS is a second wall.
3. **No outbound path.** The only network calls go to the project's configured provider endpoints (existing SSRF-guarded drivers). No URL fetching, no webhooks, no rendering of model-emitted URLs. Thumbnails load from Grey storage by path the server derived.
4. **Constrained outputs.** LLM steps get no tools and must return an enum (classify) or plain text with `[n]` citations whose indices are checked against the real result set (answer). Uploaded content is untrusted.
5. **Images are capped, not silently downscaled server-side.** The browser downsizes before upload (≤ 1280 px long side) and shows exactly what is sent; the server rejects anything over the limits (§5.1).
6. **Cost is bounded by construction.** Every step declares its calls; per-run caps (`budget.maxLlmCalls`, `answer.maxOutputTokens`), a per-tool API rate-limit bucket and an optional monthly run limit. Similar/vote paths make no generative call.

## 3. Data model — `supabase/migrations/20261021120000_lookup_tools.sql` (written)

- `grey.chunks.modality text not null default 'text'` — `'text' | 'image'`.
- `grey.sources.labels text[] not null default '{}'` — 1–60 chars each, ≤ 50 (`grey.labels_valid`), GIN index.
- `grey.match_chunks_vector(p_project, p_kb_ids, p_dims, p_query, p_limit, p_min_similarity, p_modality text = null, p_source_ids uuid[] = null, p_exclude_source_ids uuid[] = null)` and `grey.match_chunks_text(p_project, p_kb_ids, p_query, p_limit, p_modality, p_source_ids, p_exclude_source_ids)`. Both now also return `modality text, source_kind text, image jsonb` (`image` = `chunks.metadata->'image'`).
- `grey.source_label_counts(p_project, p_kb_ids = null) -> (label, sources)` — service role.
- `grey.tools (id, project_id, name, description, spec jsonb /* draft */, status 'draft'|'live', current_version, test_report jsonb, metadata, …)`. Members with `grey.tool.manage` insert/update/delete via RLS; **`status`, `current_version`, `test_report` are writable only by the service role** (trigger `TOOL_SERVER_FIELDS_LOCKED`).
- `grey.tool_versions (tool_id, version ≥ 1, spec, note, test_report, published_by)` — service-role writes, member reads.
- `grey.tool_runs (tool_id, version /* 0 = draft */, channel 'playground'|'api'|'mcp'|'test', status 'ok'|'error', input, output, usage jsonb, latency_ms, error_code, api_key_id, created_by, created_at)` — service-role writes, member reads. `input`/`output` are summaries, never image bytes.
- `grey.tool_messages (tool_id, role, content, metadata)` — the builder chat; assistant rows carry `metadata.specBefore`, `metadata.specAfter`, `metadata.edits`. Service-role writes, member reads.
- `grey.api_keys.tool_ids uuid[] not null default '{}'` — **empty = no tools** (unlike `pipeline_ids`).
- System roles backfilled: admin and manager get `grey.tools.view`, `grey.tool.manage`, `grey.tool.publish`; member gets `grey.tools.view`.

RBAC (`geiger-rbac.config.js`, done): nav section **Tools** (`grey.tools.view`, between Playground and Pipelines, icon `ScanSearch`); actions `grey.tool.manage` ("Build and edit tools") and `grey.tool.publish` ("Publish tools").

## 4. Image chunk shape (worker writes, everything else reads)

One chunk per image source: `ordinal 0`, `modality 'image'`, `page null`, `content` = caption (+ `"\n\nText in the image:\n" + ocrText` when present; fallback `"Image: <title>"`), `search_text` = `buildSearchText({ breadcrumb: title, content })`, and

```js
metadata.image = {
  thumbPath,          // "<project>/<kb>/<source>/.thumb.jpg" in bucket grey-sources (always under the project folder)
  width, height,      // of the normalised image that was embedded/captioned
  dhash,              // 16 hex chars (64-bit difference hash) — near-duplicate checks
  caption,            // string | null (vision model)
  ocrText,            // string | null
  tags,               // string[] — model-suggested, NOT labels
  embedded,           // 'pixels' (multimodal model embedded the image) | 'caption' (text model embedded the caption)
  model,              // vision model id used for the caption, or null
}
```

The source row gets `page_count 1`, `metadata.image = { width, height, dhash, thumbPath }` merged in by `finishSource` (via `ingest`), unchanged otherwise.

## 5. Contracts (exact — implementers must match names and shapes)

### 5.1 `lib/grey/image_input.js` (pure; safe to import client-side — no top-level Buffer use)
```js
export const IMAGE_LIMITS = { maxBytes: 4 * 1024 * 1024, maxSide: 2048, maxPixels: 4_200_000, mimeTypes: ["image/jpeg", "image/png", "image/webp"], clientMaxSide: 1280 };
sniffImageType(bytes /* Uint8Array */)          // -> "image/jpeg"|"image/png"|"image/webp"|"image/gif"|null
imageDimensions(bytes, mimeType)                 // -> { width, height } | null  (PNG IHDR, JPEG SOFn, WebP VP8/VP8L/VP8X, GIF)
parseImageInput(value)                           // value: { data: base64 | "data:<mime>;base64,…", mimeType? }
  // -> { ok: true, image: { data /* bare base64 */, mimeType, bytes /* Uint8Array */, width, height, byteLength } }
  //  | { ok: false, code: "invalid_image"|"unsupported_image_type"|"image_too_large"|"image_dimensions_too_large", message }
  // mimeType is taken from the sniffed bytes (a mismatching declared type is ignored); gif is rejected.
toDataUri({ data, mimeType })                    // -> "data:<mime>;base64,<data>"
hammingHex(a, b)                                 // -> number of differing bits between two equal-length hex strings, or null
NEAR_DUPLICATE_BITS = 6                          // dhash distance at or below this = near duplicate
thumbnailPath({ projectId, kbId, sourceId })     // -> `${projectId}/${kbId}/${sourceId}/.thumb.jpg`
```

### 5.2 `lib/engine/image.js` (sharp; server + worker; `import sharp from "sharp"` lazily inside functions)
```js
normalizeImage(bytes /* Buffer|Uint8Array */, { maxSide = 1280, thumbSide = 384, quality = 85 } = {})
  // auto-orient (EXIF), strip metadata, fit inside maxSide (never enlarge), flatten alpha onto white, JPEG.
  // -> { image: { bytes: Buffer, data /* base64 */, mimeType: "image/jpeg", width, height },
  //      thumbnail: { bytes: Buffer, mimeType: "image/jpeg", width, height },
  //      dhash /* 16 hex */, source: { width, height, format } }
  // throws EngineError("invalid_image", …, { status: 422 }) when sharp can't decode it.
dhash(bytes)            // -> 16 hex chars (grayscale 9×8, row-wise left>right bits)
```
`sharp` is pinned `0.35.5` in **both** root and `worker/package.json` (deps_sync test).

### 5.3 `lib/engine/vision.js`
```js
describeImage({ resolved /* resolveModel()/getProcessingModel() result */, image /* { data, mimeType } */, title, signal })
  // generateText + Output.object({ caption ≤ 600 chars, text ≤ 4000 (verbatim visible text, "" if none), tags ≤ 10 × ≤ 40 chars })
  // -> { caption, ocrText /* null when empty */, tags, tokens, model /* resolved.modelId */ }
  // throws EngineError (mapLlmError codes) — callers decide whether that fails the job.
```

### 5.4 Embeddings — `lib/grey/embedding_models.js` + `lib/engine/embeddings.js` + `lib/engine/drivers/embed/*`
```js
// pure
SUGGESTED_EMBEDDING_MODELS[format][i].modalities   // ["text"] (default) or ["text", "image"]
// add: google "gemini-embedding-2" (3072, dimensionParam), voyage "voyage-multimodal-3.5" (1024, no dimension param),
// mark cohere embed-v4.0 / embed-v5.0-pro / embed-v5.0-fast as text+image.
imageEmbeddingSpec({ format, model, dims })   // -> { model } | null
  //  google  /^gemini-embedding-2/        -> same model
  //  voyage  /^voyage-multimodal-/        -> same model
  //  cohere  /^embed-v[4-9]/              -> same model
  //  nomic   nomic-embed-text-v1.5 (dims 768 only) -> "nomic-embed-vision-v1.5"; nomic-embed-text-v1 (768) -> "nomic-embed-vision-v1"
  //  anything else -> null
buildImageEmbedRequest({ format, baseUrl, apiKey, model, images /* [{ data, mimeType }] */, inputType, dimensions }) // -> { url, init }
parseImageEmbedResponse(format, json, count)   // -> { vectors, tokens }
IMAGE_BATCH_LIMITS = { google: 1, voyage: 32, cohere: 16, nomic: 16 }
// Wire formats (verified against provider docs 2026-10-21):
//  google : POST {base}/models/{id}:embedContent
//           { model: "models/{id}", content: { parts: [{ inline_data: { mime_type, data } }] }, outputDimensionality? }
//           -> json.embedding.values (accept json.embeddings[0].values too). gemini-embedding-2 rejects taskType.
//  voyage : POST {base}/multimodalembeddings
//           { model, inputs: [{ content: [{ type: "image_base64", image_base64: "data:<mime>;base64,<data>" }] }], input_type: "document"|"query" }
//           -> data[].embedding (by index); usage.total_tokens
//  cohere : POST cohereUrl(base, "embed")
//           { model, inputs: [{ content: [{ type: "image_url", image_url: { url: dataUri } }] }], input_type: "search_document"|"search_query", embedding_types: ["float"], output_dimension? }
//           -> embeddings.float ; meta.billed_units
//  nomic  : POST {base}/embedding/image, multipart/form-data: model=<vision model>, images=<blob> (repeatable)
//           -> embeddings ; usage.total_tokens.  Do not set Content-Type (fetch adds the boundary).
// Text-path fixes in buildEmbedRequest:
//  google gemini-embedding-2: omit taskType; prefix query texts "task: search result | query: " and document texts "title: none | text: ".
//  voyage voyage-multimodal-*: send text through {base}/multimodalembeddings with inputs [{ content: [{ type: "text", text }] }].

// engine
embedImages({ admin, projectId, kb, images, inputType = "document", signal })  // -> { vectors, tokens, dims }
  // throws EngineError("images_unsupported", "This knowledge base's embedding model can't embed images.", { status: 422 })
  // rejects vectors whose length isn't kb.embedding_dims (same EMBED_DIM_MISMATCH as embedTexts)
kbImageSupport({ admin, projectId, kb })        // -> { supported: boolean, model: string|null, format: string|null }
// each driver file (google, voyage, cohere, nomic) exports embedImages({ baseUrl, apiKey, model, images, inputType, dimensions, signal, timeoutMs, retries, noRedirect, fetch })
```

### 5.5 Retrieval — `lib/engine/retrieval.js`
```js
searchChunks({ admin, projectId, kbIds, query, queryImage /* { data, mimeType } */, modality /* "text"|"image"|null */,
               sourceIds, excludeSourceIds, topK, hybrid, rerank, rerankProviderId, rerankModel, threshold, graphMode, signal })
  // Needs a text query OR a queryImage (else reason "empty_query").
  // queryImage: per KB group with image support -> embedImages(inputType "query") -> one vector arm; groups without image
  //   support are skipped and listed in meta.imageSkippedKbIds. With text too, the text arms run as today and RRF fuses.
  //   Rerank and graph expansion only use the text query (skipped when there is none).
  // chunk shape gains: modality, sourceKind, image /* metadata.image or null */.
  // meta gains: queryModes (["text"] | ["image"] | ["text","image"]), imageSkippedKbIds, embedCalls.
searchByVector({ admin, projectId, kbIds, dims, vector, limit, threshold, modality, sourceIds, excludeSourceIds, signal })
  // -> chunks (same shape, via "vector") — raw vector arm for leave-one-out tests (no embedding call).
```
`lib/engine/media.js`:
```js
signStoragePaths({ admin, projectId, paths /* string[] */, seconds = 3600 }) // -> Map(path -> signedUrl); skips paths outside `${projectId}/`
withThumbnails({ admin, projectId, items /* [{ image: { thumbPath } }] */, seconds }) // -> items with thumbnailUrl (null when none)
```
`app/api/sources/[id]/media-url` also serves `kind === "image"`: `{ url /* original */, thumbnailUrl, mime, kind }`.

### 5.6 Tool spec — `lib/grey/tool_spec.js` (pure)
```js
export const TOOL_TEMPLATES = ["find_similar", "classify", "answer_similar"];
export const TEMPLATE_INFO = { [t]: { label, description, icon /* lucide name */ } };
export const TOOL_LIMITS = { nameChars: 80, descriptionChars: 500, labelsMin: 2, labelsMax: 20, labelChars: 60,
  labelDescriptionChars: 300, instructionsChars: 2000, textLabelChars: 60, textInputChars: 2000, topKMax: 20,
  kMax: 20, maxOutputTokensMin: 64, maxOutputTokensMax: 1500, maxLlmCallsMax: 2, monthlyRunLimitMax: 1_000_000 };
// Spec (schemaVersion 1):
{
  schemaVersion: 1,
  template,                                             // one of TOOL_TEMPLATES
  input: { image: "required"|"optional"|"off", text: "required"|"optional"|"off", textLabel: string|null },
  scope: { kbIds: string[], modality: "any"|"image"|"text" },
  search: { topK /* 1..20, default 8 */, minScore /* 0..1, default 0.3 */ },
  classify: { labels: [{ value, description }], mode: "auto"|"knn"|"llm", k /* 1..20, default 7 */, minMargin /* 0..1, default 0.15 */ } | null,
  answer: { instructions, maxOutputTokens /* 64..1500, default 600 */, includeImages /* default true */ } | null,
  model: { providerId, model } | null,                 // null -> project processing model
  budget: { maxLlmCalls /* 0..2 */, monthlyRunLimit /* positive int | null */ },
}
defaultToolSpec(template, { kbIds = [] } = {})     // find_similar: image required, text off, modality "image";
                                                   // classify: image required, text off, mode "auto", labels [], maxLlmCalls 1;
                                                   // answer_similar: image optional, text required (textLabel "Question"), answer.instructions "", maxLlmCalls 1
normalizeToolSpec(raw)                             // never throws; coerces, clamps, dedupes labels (case-insensitive), forces template invariants
validateToolSpec(spec, { kbIds /* project's active KB ids, optional */ } = {})  // -> { ok, errors: [{ path, message }] }
  // classify needs ≥ 2 labels; answer_similar needs answer; ≥ 1 input not "off"; scope.kbIds non-empty and ⊂ kbIds when given;
  // knn mode forces budget.maxLlmCalls 0 (normalise), auto/llm/answer need ≥ 1.
applyToolPatch(spec, patch)                        // -> { spec, changed: string[], errors }  (builder + form edits)
  // patch keys (all optional): name, description (returned in `meta`, not spec), template, input, scope, search,
  // classify, answer, model, budget — partial objects merged, then normalised. Unknown keys -> error.
summarizeToolSpec(spec, { kbNames } = {})          // -> short multi-line text (builder context, publish dialog)
estimateRunCost(spec)                              // -> { embedCalls: 0|1|2, llmCalls: { min, max }, maxOutputTokens }
toolInputJsonSchema(spec)                          // -> JSON Schema object for { text?, image? { data, mimeType } } honouring required/off
normalizeToolInput(spec, raw)                      // raw { text?, image? } -> { ok, input: { text|null, imageRaw|null }, code?, message? }
                                                   // checks required/off and text length; image is parsed later by parseImageInput
```

### 5.7 `lib/grey/knn_vote.js` and `lib/grey/tool_metrics.js` (pure)
```js
voteLabels(neighbors /* [{ sourceId, score, labels }] sorted desc */, allowed /* string[] */, { k = 7, minScore = 0, minMargin = 0.15 } = {})
  // Uses the top k neighbours with score ≥ minScore that carry ≥ 1 allowed label (case-insensitive match, returns canonical
  // `allowed` spelling); a neighbour with n allowed labels adds score/n to each.
  // -> { label|null, confidence /* winner / total */, margin /* (w1 - w2) / total */, decided, reason: "ok"|"no_labeled_neighbors"|"low_margin",
  //      votes: [{ label, weight, count }] desc, evidence: sourceIds that voted for the winner }
classificationReport(cases /* [{ expected: string[], predicted: string|null }] */, labels)
  // -> { total, decided, correct, accuracy /* correct / total */, coverage /* decided / total */, confusion: { [exp]: { [pred|"uncertain"]: n } }, perLabel: [{ label, support, precision, recall }] }
retrievalReport(cases /* [{ expected: string[], neighbors: string[][] /* labels per rank */ }] */)
  // -> { total, hitAtK, mrr }  (a hit = a neighbour sharing ≥ 1 expected label)
```

### 5.8 Tool runtime — `lib/engine/tool_runtime.js`
```js
runTool({ admin, projectId, spec, input /* { text: string|null, image: parsed image (5.1) | null } */, channel, signal,
          capState /* optional getCapState() result */, queryVector /* { vector, dims, kbIds } for tests */, excludeSourceIds, deps })
// deps (tests): { searchChunks, searchByVector, resolveModel, getProcessingModel, generateText, loadSourceLabels }
// -> ToolResult:
{
  template,
  similar: [{ index /* 1-based */, chunkId, sourceId, sourceName, kbId, sourceKind, modality, score, snippet /* ≤ 600 */,
              page, startMs, image /* metadata.image subset: thumbPath, width, height */, labels, nearDuplicate }],
  classification: { label, confidence, margin, decidedBy: "knn"|"llm"|null, uncertain, reason, votes, evidenceIndexes } | null,
  answer: { text, citations: [{ index, sourceId, sourceName }], abstained, reason } | null,
  usage: { searched, embedCalls, llmCalls, tokensIn, tokensOut, model, provider },
  timings: { totalMs, searchMs, llmMs },
  warnings: [{ code, message }],
}
// Scope: spec.scope.kbIds ∩ the project's active KBs (re-read here). modality "any" -> null filter.
// Classify: votes over neighbour labels (sources.labels, project-scoped read). mode "knn": never calls a model.
//   "auto": calls the model only when !decided and budget allows; "llm": always (budget ≥ 1). The model sees the labels with
//   descriptions, the query (text + image when present) and up to 6 numbered neighbours (snippet + labels + thumbnail image when
//   includeImages-equivalent is possible: query had an image and the neighbour has a thumbnail), and must answer with
//   Output.choice / an enum of labels + "uncertain". A cap reached with behaviour "retrieval_only" skips every LLM step (warning).
// Answer: abstains without a model call when no neighbour ≥ minScore. Otherwise one call with a fixed Grey system prompt,
//   spec.answer.instructions, the question, the query image, numbered references (snippet + thumbnail when includeImages);
//   maxOutputTokens from the spec; citations = [n] indices present in the text that exist in `similar`.
// nearDuplicate: hammingHex(query dhash, neighbour image.dhash) ≤ NEAR_DUPLICATE_BITS (query dhash from input.image.dhash).
```
`lib/engine/tool_tests.js`:
```js
runToolTests({ admin, projectId, spec, includeLlm = false, limit = 25, signal, deps })
  // Leave-one-out over labelled sources in scope (modality filter applied): each case uses the source's own live chunk vector
  // (ordinal 0; no embedding call) as the query with that source excluded.
  // classify -> classificationReport (LLM fallback only when includeLlm, max 10 LLM cases); find_similar -> retrievalReport;
  // answer_similar -> { kind: "none", reason: "no_automatic_tests" }.
  // -> { kind: "classification"|"retrieval"|"none", report, samples: [{ sourceId, sourceName, expected, predicted, confidence, decidedBy }],
  //      cases, skippedReason, ranAt, llmCalls }
```
`lib/engine/tool_runs.js`:
```js
recordToolRun({ admin, projectId, toolId, version, channel, status, input /* { text, image } */, result, error, latencyMs, apiKeyId, createdBy })
  // inserts grey.tool_runs (input summary: { hasText, textChars, hasImage, imageBytes, width, height }; output summary: label,
  // confidence, decidedBy, similar [{ sourceId, score }], answerChars, abstained) and usage_events: one "retrieval" at
  // PRICE_PER_RETRIEVAL when result.usage.searched (ref_type "tool", ref_id toolId, metadata { channel, toolId, version }),
  // and "llm_tokens" at cost 0 (byok) when tokens > 0. Never throws (logs).
monthlyRunCount({ admin, projectId, toolId })      // -> number of ok runs this calendar month (UTC), excluding channel "test"
loadToolForRun({ admin, projectId, toolId, version /* 0|null = draft */ })
  // -> { tool, spec, version } ; throws EngineError tool_not_found (404) | tool_not_live (409) | tool_version_not_found (404)
```

### 5.9 Builder — `lib/grey/tool_builder.js` (pure) + `lib/engine/tool_builder.js`
```js
BUILDER_INSTRUCTIONS                                // system prompt: role, closed vocabulary, never invent KB ids/labels, ask when unsure,
                                                    // keep replies short, call update_tool for every change, never claim tests ran
builderPatchSchema                                  // zod schema for update_tool's input (mirrors applyToolPatch keys)
formatBuilderContext({ tool, spec, kbs, labels, processingModel }) // -> text block given to the model each turn
// engine
loadBuilderContext({ admin, projectId, tool })     // -> { kbs: [{ id, name, imageSupport, sources, imageSources }], labels: [{ label, sources }], processingModel: bool }
runBuilderTurn({ admin, projectId, tool, history, message, signal, onEvent })
  // streamText on the project processing model with one tool update_tool (applyToolPatch; saves the draft after each accepted patch);
  // stopWhen stepCountIs(6). onEvent({ type: "delta", text } | { type: "edit", changed, spec, name, description, errors }).
  // -> { text, specBefore, specAfter, nameAfter, descriptionAfter, edits, usage }
```

### 5.10 Routes
| Route | Auth | Body | Returns |
|---|---|---|---|
| `POST /api/tools/[toolId]/run` | session, `grey.tools.view` | `{ projectId, text?, image?, version? }` (version 0/absent = draft) | `{ result /* similar[].thumbnailUrl added */, runId }` |
| `POST /api/tools/[toolId]/test` | `grey.tool.manage` | `{ projectId, includeLlm? }` | `{ report }` (also saved to `tools.test_report`) |
| `POST /api/tools/[toolId]/publish` | `grey.tool.publish` | `{ projectId, note? }` | `{ tool, version }` (validates spec first; 422 with errors) |
| `POST /api/tools/[toolId]/builder` | `grey.tool.manage` | `{ projectId, content }` | NDJSON `start` → `delta`… / `edit`… → `done { userMessage, assistantMessage, tool }` \| `error` |
| `POST /api/tools/[toolId]/builder/undo` | `grey.tool.manage` | `{ projectId, messageId }` | `{ tool }` (restores that turn's specBefore; only the latest edited turn) |
| `POST /api/v1/tools/[toolId]/run` | API key scope `tools`, `tool_ids` must list the tool | `{ text?, image?, version? }` | `{ object: "tool_run", toolId, version, result }` with signed thumbnail URLs (600 s) |

API keys: `evaluateKey(row, { scope: "tools", toolId })` denies (404) unless `row.tool_ids` includes `toolId`. Per-tool rate-limit bucket `tool:<id>` (60/min) on the v1 and MCP paths; `budget.monthlyRunLimit` enforced on api/mcp (429 `tool_run_limit`).

MCP: an MCP server's `tools` jsonb may enable published tools as `"tool:<uuid>": true`. Each becomes an MCP tool named `tool_<slug(name)>` (deduped with `_2`…), title = tool name, description generated from the template (`TEMPLATE_INFO`) and labels — never the member-written description — inputSchema from the spec, read-only annotations, structuredContent = ToolResult without thumbnails.

### 5.11 UI (follow pipelines + playground patterns; `@geiger/ui`, shadcn, lucide)
- **Tools** screen (`components/internal/screens/tools/`): list (`DataTable`, template + status pills, version, updated) with a create dialog that picks a template (three cards) and a name; detail via `EditorShell` with sections **Build** (builder chat left, live spec summary + quick try right), **Try it** (input form generated from the spec: image dropzone with preview + optional drag-to-crop, client downscale to `clientMaxSide`; text field; result view), **Configure** (form editor over the same spec, Save = updateTool), **Tests** (run tests, report, confusion table, samples), **Versions** (publish dialog showing summary + last test report; version list), **Endpoints** (REST URL, curl/JS snippets, MCP hint), **Danger zone**.
- Result view: classification card (label, confidence bar, decided-by, votes), answer card (markdown + citation chips that point at similar items), grid of similar items (thumbnail or kind icon, name, score, labels, near-duplicate badge, open source).
- Sources sheet: image preview (thumbnail/original via media-url) and a **Labels** editor (`TagInput`, gated by `grey.source.upload`).
- API key dialog: a **Tools** scope with a tool multi-select (published tools). MCP server dialog: toggles for published tools.

## 6. Pricing and metering
Grey charges what it does today: one retrieval (`PRICE_PER_RETRIEVAL`) per run that searched; ingestion bills an image as one page. Customer model usage is recorded at cost 0 (`llm_tokens`, byok). The builder's tokens are recorded as `llm_tokens` with `metadata.channel = "tool_builder"`.

## 7. Failure behaviour
- KB model can't embed images + no vision processing model → image sources fail with `image_needs_vision` ("Set a vision-capable processing model in Settings → General, or use a multimodal embedding model for this knowledge base.").
- Vision caption fails but pixels embedded → warning `caption_failed`, chunk content falls back to `Image: <title>`.
- Query image on a tool whose KBs can't embed images → result warning `image_query_unsupported`; text input (if any) still runs; with neither → 422 `image_query_unsupported`.
- No processing/tool model for an LLM step → `classify` falls back to the vote (warning `llm_unavailable`); `answer` returns `abstained: true, reason: "no_model"`.
