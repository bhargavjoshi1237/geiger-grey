# Geiger Grey readiness for (1) a chat-based tool builder and (2) image-input similarity search and answering

All code sources are files in the Grey repository (C:/Pro/geiger-grey, `main` at 7e4ef34, read on 2026-10-21) unless another repo is named. Links point at absolute file paths, with function names where they matter. Nothing was run. The notes build on [grey_current_capabilities.md](C:/Pro/geiger-grey/research_notes/Knowledge%20base%20uses%20beyond%20chat/grey_current_capabilities.md) and do not repeat its general inventory. External provider facts (what each embedding API accepts) are cited to vendor docs and are marked as such.

A note on the checkout: the root `node_modules` is not installed here, so AI SDK facts were read from `worker/node_modules/ai` (version 7.0.143). The root [package.json](C:/Pro/geiger-grey/package.json) pins the same `ai` 7.0.143 and the same `@ai-sdk/*` versions as [worker/package.json](C:/Pro/geiger-grey/worker/package.json).

## 1. Images today: how are image, video-keyframe and audio sources ingested, stored and served?

### Takeaway
Grey accepts image uploads and Assets imports as `kind='image'` sources, but the worker fails every image job before downloading it ("Image OCR isn't available yet.") unless `GREY_OCR_URL` points at an OCR service. Nothing in the code base embeds pixels: even with OCR, an image would become OCR text chunks with text embeddings. OCR is an interface only, planned as a self-hosted model on Grey's VPS. Video keyframe captioning is a disabled "Coming soon" switch, and audio/video are indexed only as transcripts. Image files sit in the private `grey-sources` bucket (or stay in Assets), and the only server route that signs media URLs refuses images.

### Cited Findings
**Image ingestion path**
- Upload dialog: classifies `image/*` files as kind `image`, and its dropzone hint says "PDF, images, audio, video, text, or office documents." — [upload_sources_dialog.jsx](C:/Pro/geiger-grey/components/internal/screens/sources/upload_sources_dialog.jsx) lines 55, 448.
- Browser-side analysis counts an image as 1 page for the cost estimate (`analyzeFile`, `detectKind`) — [lib/grey/file_analysis.js](C:/Pro/geiger-grey/lib/grey/file_analysis.js). `PAGE_KINDS` includes `image`, so it is priced per page — [lib/grey/cost.js](C:/Pro/geiger-grey/lib/grey/cost.js) line 12.
- Storage: the client uploads to the private `grey-sources` bucket at `<projectId>/<kbId>/<sourceId>/<safeName>` (`uploadSourceFile`) — [lib/supabase/sources.js](C:/Pro/geiger-grey/lib/supabase/sources.js). The storage RLS policy `grey_sources_storage_all` allows access when the first folder is a project the user can access (`grey.can_access_project`) — [20261010120400_ingestion.sql](C:/Pro/geiger-grey/supabase/migrations/20261010120400_ingestion.sql) lines 257–280.
- Assets imports: `listImportableAssets` maps `assets.type = 'image'` to kind `image` and also reads the asset's `thumbnail_url` (shown in the picker) — [lib/supabase/suite_imports.js](C:/Pro/geiger-grey/lib/supabase/suite_imports.js). Assets stores AVIF preview and mini thumbnails in its own bucket via `POST /api/storage/thumbnail` (`thumbnail_url`, `mini_thumbnail_url` columns) — [geiger-assets app/api/storage/thumbnail/route.js](C:/Pro/geiger-assets/app/api/storage/thumbnail/route.js).
- Worker routing: `runIngestionJob` → `execute()` sends any source that isn't audio/video to `prepareDocument`. When `detectFormat` returns `image`, it calls `routeDocument({ format: "image", ocrAvailable: Boolean(config.ocrUrl) })` and throws the routing error **before downloading** the file ("Image sources can't be parsed without OCR — fail before downloading them.") — [worker/ingest/run.mjs](C:/Pro/geiger-grey/worker/ingest/run.mjs) lines 160–166, 399–400.
- `routeDocument` returns `error: { code: "image_ocr_unavailable", message: "Image OCR isn't available yet." }` when OCR is unavailable, and `engine: "ocr"` when it is — [lib/grey/ocr_routing.js](C:/Pro/geiger-grey/lib/grey/ocr_routing.js). `detectFormat` maps `image/*` MIME, or kind `image`, to format `image` — [worker/ingest/parse/index.mjs](C:/Pro/geiger-grey/worker/ingest/parse/index.mjs).
- With OCR available, `parseDocument` calls `parseWithOcrService({ fileUrl, mime, signal, ocrUrl })`. That POSTs `{ fileUrl, mime, pages }` (fileUrl is a 1-hour signed URL from `sourceFileUrl`) and expects `{ pages: [{ page, markdown }] }`. Unset → `JobError("ocr_not_configured", "OCR isn't available yet.", { retryable: false })` — [worker/ingest/parse/ocr_service.mjs](C:/Pro/geiger-grey/worker/ingest/parse/ocr_service.mjs); [run.mjs](C:/Pro/geiger-grey/worker/ingest/run.mjs) lines 183–197.
- The OCR markdown then follows the normal document path: `markdownToBlocks` → `chunkDocument` → `embedTexts(... texts: search_text, inputType: "document")` → staged rows → `swapSourceChunks` — [run.mjs](C:/Pro/geiger-grey/worker/ingest/run.mjs) lines 204–211, 458–491. So **only text is ever embedded**.
- The office/HTML parsers drop embedded images and keep only alt text ("Never inline image data") — [worker/ingest/parse/html.mjs](C:/Pro/geiger-grey/worker/ingest/parse/html.mjs) lines 56–57; [office.mjs](C:/Pro/geiger-grey/worker/ingest/parse/office.mjs) lines 18–21.
- Status in docs: decision D5 says "Layout/OCR parsing: Deferred to a self-hosted OCR model on our VPS. This phase: text engines only + adapter interface"; §6.3 says "Image sources fail: 'Image OCR isn't available yet.'"; §1 lists "Layout-aware / OCR / vision parsing" as out of scope; §20 item 2 is the "OCR service on the VPS" — [2026-10-17-grey-backend-design.md](C:/Pro/geiger-grey/docs/superpowers/specs/2026-10-17-grey-backend-design.md) lines 26, 38, 237–246, 589. The capability table lists an `ocr` interface (`ocr.js` → `ocr()`) that is "Interface only this phase" (line 90), but no `lib/engine/ocr.js` exists (directory listing of [lib/engine](C:/Pro/geiger-grey/lib/engine)).
- UI: the preset parser vocabulary already has `{ value: "vlm", label: "Vision (VLM)" }`, and the "High accuracy" tier is described as "Layout- and vision-aware parsing" — [components/internal/screens/knowledge/constants.js](C:/Pro/geiger-grey/components/internal/screens/knowledge/constants.js) lines 57, 71. The seeded High preset says "vision-language parsing with OCR" — [20261010120400_ingestion.sql](C:/Pro/geiger-grey/supabase/migrations/20261010120400_ingestion.sql) line 230. Routing treats `vlm` like `layout`: OCR service when available, else the text engine with warning `layout_unavailable` (`LAYOUT_PARSERS`) — [ocr_routing.js](C:/Pro/geiger-grey/lib/grey/ocr_routing.js).

**Video keyframes and audio**
- `prepareMedia` handles audio and video only through transcription. If `preset.media.keyframes` is on, it warns `keyframes_unavailable` ("Keyframe captioning isn't available yet — only the transcript was indexed.") and sets `meta.keyframesSkipped` — [run.mjs](C:/Pro/geiger-grey/worker/ingest/run.mjs) lines 227–235.
- Transcript chunks carry `start_ms/end_ms` and `metadata { kind: "transcript", speakers }` — [run.mjs](C:/Pro/geiger-grey/worker/ingest/run.mjs) lines 311–322.
- The Keyframes switch is disabled with "Extract and caption keyframes from video." (Coming soon) — [ingestion_settings_form.jsx](C:/Pro/geiger-grey/components/internal/screens/knowledge/ingestion_settings_form.jsx) lines 274–276. A `perKeyframeMinute` price of 0.04 is seeded in presets and used by the cost estimate — [cost.js](C:/Pro/geiger-grey/lib/grey/cost.js) lines 41–45.
- The worker has no image or video processing dependency (no sharp, ffmpeg or similar). Its dependencies are AI SDK packages, readability, supabase-js, exceljs, gpt-tokenizer, linkedom, mammoth, marked, officeparser, pg, pino, turndown, unpdf and zod — [worker/package.json](C:/Pro/geiger-grey/worker/package.json).

**Serving**
- `GET /api/sources/[id]/media-url` authenticates, checks `grey.knowledge_bases.view` (404 on denial), and **rejects anything that isn't audio or video** (`MEDIA_KINDS = new Set(["audio", "video"])` → 422 `not_media`, "This source has no audio or video to play."). For uploads it signs a 1-hour URL in `grey-sources` after an `inProjectFolder` check. For Assets imports it calls Assets' internal `/api/internal/assets/{origin_ref}/read-url` with `GEIGER_INTERNAL_TOKEN` — [app/api/sources/[id]/media-url/route.js](C:/Pro/geiger-grey/app/api/sources/[id]/media-url/route.js).
- The only other file access is the client-side 60-second signed download URL (`getSourceDownloadUrl`) behind the Sources "Download" action — [lib/supabase/sources.js](C:/Pro/geiger-grey/lib/supabase/sources.js).
- No thumbnail or preview generation exists in Grey. A grep for `thumbnail` in lib/app/components/worker found only the Assets import picker — [suite_imports.js](C:/Pro/geiger-grey/lib/supabase/suite_imports.js).

**Suite context**
- Geiger Assets' feature blueprint lists "AI auto-tagging — Object detection, scene recognition, text extraction (OCR)" and "Visual similarity search — Upload an image to find visually similar assets" — [geiger-assets DAM_FEATURES.md](C:/Pro/geiger-assets/DAM_FEATURES.md) lines 34–41. Its schema has `assets.duplicate_groups.match_type in ('exact','near','visual')` with seeded demo rows, but no vector columns turned up in a grep for `embedding|pgvector|halfvec` — [20260628204539_assets_modules.sql](C:/Pro/geiger-assets/supabase/migrations/20260628204539_assets_modules.sql) lines 141–153.

### Inferences
- The image path is blocked at a single point (`prepareDocument`'s early `routeDocument` check). An image branch, a `prepareImage` beside `prepareDocument`/`prepareMedia`, can slot into `execute()` without touching the staged-chunk, swap, graph or billing machinery.
- The spec plans OCR as Grey-run infrastructure (a self-hosted VPS model), which sits awkwardly with the user's BYO-only rule (memory note `byo-providers-only`: "Grey does not pay for or provide any AI account"). A BYO alternative that fits today's architecture is to caption or OCR images with the customer's own vision-capable chat model (the processing model), the way contextual enrichment and graph extraction already use it. The `vlm` parser value is a ready preset slot for that.
- Grey has no image URL route, so similarity results that show thumbnails need either an image-capable signing route (extend `media-url` to `image`, or add a sibling `preview-url`) or reuse of Assets' `thumbnail_url` for Assets-origin images.
- Video keyframes need frame extraction (ffmpeg or a provider that accepts video), which the worker has no dependency for. This is the largest of the media gaps.

### Gaps
- `worker/ingest/fetch.mjs` (`fetchSourceFile`, `sourceFileUrl`) was read only through its call sites, so the exact behaviour for image bytes from Assets was not verified.
- Assets' `read-url` contract (expiry, whether it can return thumbnails) was not inspected.

## 2. Embeddings: providers, image-embedding support, per-chunk model records, and coexistence of modalities

### Takeaway
Every embedding path in Grey is text only. Five raw-HTTP drivers (openai, cohere, voyage, google, nomic) send `texts` arrays to text endpoints, and the AI SDK's own `embed()` also takes only strings. Several of the customer's providers do offer image embeddings on separate or extended endpoints: Nomic `/v1/embedding/image`, Voyage `/v1/multimodalembeddings`, Cohere `embed-v4.0` image inputs, and Google `gemini-embedding-2`. Grey's driver pattern (one pure request builder plus one small driver file per format) makes these cheap to add. Each chunk records `embedding_dims` and `embedding_model`. But a KB has exactly one locked model and dimension set, the `chunks` table has a single `embedding` column, and `match_chunks_vector` filters only on dims and KB ids. So image vectors can safely coexist with text vectors only if they come from the KB's own model in one shared space; otherwise they need a separate vector table or column.

### Cited Findings
**Grey's embedding code**
- `embedTexts({ admin, projectId, kb, texts, inputType })` looks up the KB's connection (`connectProvider(..., capability: "embed")`), checks the driver format, batches with `planBatches`, keeps at most 3 requests in flight, and rejects any vector whose length isn't the KB's `embedding_dims` (`EMBED_DIM_MISMATCH`). `embedWithConnection` dispatches to `DRIVERS = { openai, cohere, voyage, google, nomic }` — [lib/engine/embeddings.js](C:/Pro/geiger-grey/lib/engine/embeddings.js).
- Request builders are text only (`buildEmbedRequest`):
  - openai: `POST {base}/embeddings` with `input: texts`.
  - cohere: `POST /v2/embed` with `texts`, `input_type search_document|search_query`, `embedding_types: ["float"]`.
  - voyage: `POST /embeddings` with `input: texts`.
  - google: `models/{id}:batchEmbedContents` with `content: { parts: [{ text }] }`.
  - nomic: `POST {base}/embedding/text` with `texts`, `task_type`.
  - Source: [lib/grey/embedding_models.js](C:/Pro/geiger-grey/lib/grey/embedding_models.js).
- Each driver file is 18 lines: build the request, call `requestJson` (timeouts, retries on 429/5xx, SSRF-pinned `providerFetch` for custom base URLs), then parse — [lib/engine/drivers/embed/nomic.js](C:/Pro/geiger-grey/lib/engine/drivers/embed/nomic.js) (same shape for the other four); [lib/engine/drivers/http.js](C:/Pro/geiger-grey/lib/engine/drivers/http.js).
- Suggested models are all text models: openai `text-embedding-3-large/small`, `mistral-embed`, `nomic-embed-text`; cohere `embed-v5.0-pro/fast`, `embed-v4.0`; voyage `voyage-3.5`, `voyage-3.5-lite`, `voyage-3-large`; google `gemini-embedding-001`; nomic `nomic-embed-text-v1.5`, `nomic-embed-text-v1` (`SUGGESTED_EMBEDDING_MODELS`). Dims must be 64–4000 (`MIN_DIMS`, `MAX_DIMS`). `INDEXED_DIMS = [256, 384, 512, 768, 1024, 1536, 2048, 3072]` — [embedding_models.js](C:/Pro/geiger-grey/lib/grey/embedding_models.js).
- The capability vocabulary is `CAPABILITIES = ["chat", "embed", "rerank", "transcribe"]`, with no image, vision or OCR capability. Nomic is `capabilities: ["embed"]`, `baseUrl: "https://api-atlas.nomic.ai/v1"` (fixed) — [lib/grey/provider_kinds.js](C:/Pro/geiger-grey/lib/grey/provider_kinds.js).
- The Nomic migration adds `'nomic'` to `model_providers_provider_check` and to `grey.embed_format_for_kind` / `grey.provider_embed_format`, which the KB guard uses to allow only same-format provider moves. It has no image endpoint or modality concept — [20261018120500_nomic_provider.sql](C:/Pro/geiger-grey/supabase/migrations/20261018120500_nomic_provider.sql).
- `POST /api/embeddings/detect { projectId, providerId, model, requestedDims? }` needs `grey.kb.manage` and calls `detectEmbeddingDims`, which embeds the text `"ping"` and reports the vector length — [app/api/embeddings/detect/route.js](C:/Pro/geiger-grey/app/api/embeddings/detect/route.js); [embeddings.js](C:/Pro/geiger-grey/lib/engine/embeddings.js) `detectEmbeddingDims`.
- In the installed AI SDK, `embed({ value: string })`, `embedMany({ values })` and the provider spec's `EmbeddingModelV4CallOptions.values: Array<string>` all take strings — [worker/node_modules/ai/dist/index.d.ts](C:/Pro/geiger-grey/worker/node_modules/ai/dist/index.d.ts) line 7713; [@ai-sdk/provider index.d.ts](C:/Pro/geiger-grey/worker/node_modules/@ai-sdk/provider/dist/index.d.ts) line 1746. Grey does not use AI SDK embeddings in any case: it uses its own drivers.

**Per-chunk records and the single vector column**
- `chunks.embedding public.halfvec` has no fixed dimension; `embedding_dims smallint` and `embedding_model text` are provenance. The check `chunks_embedding_dims_check` requires `vector_dims(embedding) = embedding_dims` — [20261018120200_retrieval.sql](C:/Pro/geiger-grey/supabase/migrations/20261018120200_retrieval.sql) lines 30–44.
- The worker writes `embedding`, `embedding_dims = vectors[k].length` and `embedding_model` on each staged row — [run.mjs](C:/Pro/geiger-grey/worker/ingest/run.mjs) lines 473–485.
- Partial HNSW indexes exist per dimension (`where deleted_at is null and state = 'live' and embedding_dims = N`, cast to `halfvec(N)`, cosine ops). Other dimensions fall back to exact search — [20261018120200_retrieval.sql](C:/Pro/geiger-grey/supabase/migrations/20261018120200_retrieval.sql) lines 53–78.
- The base `chunks` table has `content text`, `page`, `start_ms`, `end_ms`, `heading_path`, `metadata jsonb`, and no modality or type column — [20261010120400_ingestion.sql](C:/Pro/geiger-grey/supabase/migrations/20261010120400_ingestion.sql) lines 165–182. The only modality marker in use is `metadata.kind = "transcript"` — [run.mjs](C:/Pro/geiger-grey/worker/ingest/run.mjs) line 321.
- One model per KB: the `lock_embedding_model` trigger makes `knowledge_bases.embedding_model` immutable (earlier inventory §1). `grey.guard_kb_embedding` raises `EMBEDDING_DIMS_LOCKED` when dims change once set, and `EMBEDDING_PROVIDER_FORMAT_MISMATCH` on a cross-format provider move — [20261018120000_providers_byo.sql](C:/Pro/geiger-grey/supabase/migrations/20261018120000_providers_byo.sql) lines 89–140.
- `match_chunks_vector`'s comment says "p_kb_ids must all share one embedding model + dims (searchChunks groups KBs before calling)". Its `where` clause filters `c.kb_id = any($3) and c.embedding_dims = %s`, **not** `embedding_model` — [20261018120200_retrieval.sql](C:/Pro/geiger-grey/supabase/migrations/20261018120200_retrieval.sql) lines 104–155.

**What the customer's providers offer for images (external, vendor docs)**
- Nomic: `POST https://api-atlas.nomic.ai/v1/embedding/image`, `multipart/form-data` with `model` (`nomic-embed-vision-v1` or `nomic-embed-vision-v1.5`) and `images` (bytes) or `urls`, for PNG, JPEG or WebP. The response is `{ embeddings, usage, model }` — [Nomic API reference](https://docs.nomic.ai/reference/api/embed-image-v-1-embedding-image-post). Nomic says the vision encoder is aligned with its text embedding space, so text and image vectors are directly comparable — [Nomic blog](https://blog.nomic.ai/posts/nomic-embed-vision) (via search summary; page not fetched).
- Voyage: `voyage-multimodal-3.5` embeds text, images and video, alone or interleaved, through a `multimodalembeddings` endpoint whose `inputs[].content[]` types are `text`, `image_url`, `image_base64`, `video_url`, `video_base64`. Outputs are 2048/1024/512/256 dims (default 1024) — [Voyage docs](https://docs.voyageai.com/docs/multimodal-embeddings); [Azure catalog](https://ai.azure.com/catalog/models/voyage-multimodal-3.5) (via search summary).
- Cohere: `embed-v4.0` (and the v3 family) accept images, either with an image input type or through an `images` parameter; images must be PNG, JPEG, WebP or GIF up to 5 MB. v4 can combine text and image in one embedding and offers 256/512/1024/1536 Matryoshka dims — [Cohere embeddings docs](https://docs.cohere.com/docs/embeddings); [Cohere changelog](https://docs.cohere.com/v2/changelog/embed-multimodal-v4); [AWS Bedrock embed v4 parameters](https://docs.aws.amazon.com/bedrock/latest/userguide/model-parameters-embed-v4.md). The search summary noted that Cohere's page was inconsistent about the exact image field, so the live API reference should be checked.
- Google: `gemini-embedding-2` (stable) takes "Text, image, video, audio, PDF" inputs with flexible output dimensions of 128–3072 (recommended 768, 1536, 3072) and an 8,192-token input limit. `gemini-embedding-001` stays text only — [Gemini Embedding 2 model page](https://ai.google.dev/gemini-api/docs/models/gemini-embedding-2?hl=en). That page does not show the request shape.

### Inferences
- **Smallest path: a multimodal knowledge base.** If a KB's locked model is itself multimodal (Cohere `embed-v4.0`, Voyage `voyage-multimodal-3.5`, Google `gemini-embedding-2`, or the Nomic text/vision v1.5 pair), image vectors and text vectors live in one space. The existing single `embedding` column, `embedding_dims`, the per-dims HNSW indexes, `groupKnowledgeBases` and `match_chunks_vector` all work unchanged. An image becomes one chunk whose `content` is its caption or OCR text (for FTS, reranking and LLM context) and whose `embedding` comes from the pixels. This needs:
  - an image request builder and parser per format (`buildImageEmbedRequest`, Nomic multipart, Voyage `multimodalembeddings`, Cohere image inputs, Gemini parts with inline data)
  - an `embedImages()` beside `embedTexts()`
  - a per-model "modalities" flag in `SUGGESTED_EMBEDDING_MODELS`, so the KB dialog can say which models accept images
- **Nomic needs a model pair.** Text uses `nomic-embed-text-v1.5` and images use `nomic-embed-vision-v1.5`, but a KB stores one `embedding_model`. Nomic would need a vision-model mapping (e.g. in `metadata` or a static pair table).
- **Existing KBs.** KBs already on `embed-v4.0` (a suggested Cohere model) are, per Cohere's docs, already in a space that accepts images. Image chunks could be added to them without re-embedding their text. `embed-v5.0-*` multimodality was not verified (see Gaps).
- **Different models need a separate store.** If a customer wants a separate image model (e.g. a CLIP-style model) next to a text-only KB model, the single column cannot hold both. Today a second vector with the same dims would be silently mixed, because the match function doesn't filter on `embedding_model`. That design needs a `chunk_vectors(chunk_id, project_id, kb_id, space text, model, dims, embedding halfvec)` table (or a KB-level `image_embedding_*` config) with its own per-dims partial HNSW indexes, plus a match function keyed by space. The simpler alternative is a dedicated image KB.
- **Dimension compatibility.** All four providers' image dims (256–3072) fall inside `INDEXED_DIMS` and halfvec's 4000-dim HNSW limit, so no index work is needed for the multimodal-KB path.
- `detectEmbeddingDims` probes with the text "ping". For a multimodal model that is fine (same dims), but a vision-only endpoint (Nomic vision) would need an image probe.

### Gaps
- Whether Cohere `embed-v5.0-pro/fast` (the default Cohere suggestions in Grey) accept images was not found in the sources read.
- Exact Gemini Embedding 2 request shapes and image limits per request, and the exact Cohere v2 image field names, were not confirmed from primary API references.
- Per-image pricing of these providers was not verified (one third-party listing for Voyage was not confirmed). It doesn't affect Grey's billing, since BYOK usage is recorded at cost 0.

## 3. Retrieval: can search take a query vector directly, and can it return the source's media?

### Takeaway
The SQL layer already accepts a vector: `grey.match_chunks_vector(p_project, p_kb_ids, p_dims, p_query halfvec, ...)` takes a ready query vector. But the engine entry point `searchChunks` only accepts `query` text: it embeds the text per KB group, and an empty string returns `empty_query`. Results carry `sourceId`, `sourceName`, page and timestamps, but no source kind, MIME type, storage path or thumbnail. So image-to-image search needs a vector (or image) input on `searchChunks` and a media join or lookup for previews.

### Cited Findings
- `match_chunks_vector` signature: `(p_project uuid, p_kb_ids uuid[], p_dims int, p_query public.halfvec, p_limit int default 50, p_min_similarity real default 0)`. It returns `chunk_id, source_id, source_name, kb_id, content, page, start_ms, end_ms, heading_path, score`, joining `grey.sources` only for `s.name`. It is service role only — [20261018120200_retrieval.sql](C:/Pro/geiger-grey/supabase/migrations/20261018120200_retrieval.sql) lines 108–155, 204–207.
- `searchChunks({ admin, projectId, kbIds, query, topK, hybrid, rerank, rerankProviderId, rerankModel, threshold, graphMode, signal })`:
  - `text = String(query ?? "").trim()`; `if (!text) return finish([], { reason: "empty_query" })`.
  - Embeds per group with `embedGroup` → `embedTexts({ texts: [query], inputType: "query" })`.
  - The internal `matchVector({ admin, projectId, kbIds, dims, vector, limit, threshold })` already takes a vector, but it is not exported.
  - Source: [lib/engine/retrieval.js](C:/Pro/geiger-grey/lib/engine/retrieval.js).
- The text arm (`match_chunks_text`), graph expansion (`expandWithGraph` with `query: text`) and rerank (`rerankDocuments({ query: text, documents })`) all need query text — [retrieval.js](C:/Pro/geiger-grey/lib/engine/retrieval.js).
- Result shape (`shapeChunk`): `chunkId, sourceId, sourceName, kbId, content, score, page, startMs, endMs, headingPath, via`. There are no media fields — [retrieval.js](C:/Pro/geiger-grey/lib/engine/retrieval.js). Citations add an index and location but come from the same chunk fields (`contextCitations`, `toCitation`) — [lib/grey/citations.js](C:/Pro/geiger-grey/lib/grey/citations.js).
- The only filter is the KB set; there are no source, kind or metadata filters (earlier inventory §3).

### Inferences
- For image query → similar items, `searchChunks` needs:
  - an alternative input (`queryVector` + `queryDims`, or `queryImage` that it embeds through the new `embedImages` per group)
  - vector-only mode, with hybrid, graph and rerank off or driven by an optional caption text
  - an optional `kinds` filter (e.g. only image chunks), which needs a new `p_kinds` or metadata filter on the match function
- Exporting `matchVector` (or a thin `searchByVector`) is a small change. Item-level results (one row per similar source rather than per chunk) need a dedupe by `sourceId` after matching.
- Thumbnails: add `s.kind, s.mime, s.origin` (and possibly `s.metadata->'thumbnail'`) to the match function's return columns, or batch-load them after search. Then sign preview URLs through an image-capable route (Question 1).
- "What is in this image" with stored items: embed the image → vector match → pass the top items' captions/OCR text (and optionally their images) to a vision model. That is `runPipelineTurn`'s shape with an image-aware retrieval step and image parts in the prompt (Question 4).

### Gaps
- Whether HNSW iterative scan (`hnsw.iterative_scan = relaxed_order`, `ef_search 100`) gives good recall under an added kind filter was not tested.

## 4. LLM layer: can a turn send images to a vision model, and do the Playground or widget accept uploads?

### Takeaway
No. Every generation call sends text only. `generateAnswer` builds `messages: [...history, { role: "user", content: user }]`, where `user` is a prompt string. The OpenAI-compatible endpoint explicitly rejects image parts ("Only text content is supported."). The model capability table knows only temperature support, with no vision flag. The Playground composer is a bare textarea, the Playground API takes `content` as a string of at most 8000 characters, and the widget takes `message` as a string of at most 2000 characters. The installed AI SDK v7 does support image and file parts (`ImagePart`, `FilePart` in `UserContent`), so the gap is in Grey's code, not the SDK.

### Cited Findings
- `generateAnswer` builds the call as `{ model, instructions: system, messages: [...history, { role: "user", content: user }], maxOutputTokens, abortSignal, maxRetries: 2 }`, with `user` from `buildSystemPrompt` (string) — [lib/engine/answer.js](C:/Pro/geiger-grey/lib/engine/answer.js) lines 102–128. `runPipelineTurn` passes `messages: [...history, { role: "user", content: query }]` with `query` as text — [lib/engine/turn.js](C:/Pro/geiger-grey/lib/engine/turn.js).
- `buildLanguageModel` covers the openai (Responses API, or chat for custom URLs), anthropic, google and openai_compatible formats. `resolveModel` returns `{ model, modelId, providerKind, providerId, hosted: false, supportsTemperature }`, with no modality information — [lib/engine/llm.js](C:/Pro/geiger-grey/lib/engine/llm.js).
- `model_caps.js` holds only `supportsTemperature` and `isTemperatureRejection` — [lib/grey/model_caps.js](C:/Pro/geiger-grey/lib/grey/model_caps.js).
- `/chat/completions`: `contentText` returns null for any non-text part, and `parseChatRequest` then fails with "Only text content is supported." (`unsupported_content`). A test covers it: "text parts are joined; image parts are rejected" — [lib/grey/openai_frames.js](C:/Pro/geiger-grey/lib/grey/openai_frames.js) lines 30–80; [openai_frames.test.js](C:/Pro/geiger-grey/lib/grey/openai_frames.test.js) line 42. The spec says "`messages` (text only; image parts → 400)" — [backend spec](C:/Pro/geiger-grey/docs/superpowers/specs/2026-10-17-grey-backend-design.md) line 498.
- Playground API `POST /api/chat` takes `content` with `MAX_CONTENT_LENGTH = 8000` and a 12-message history read from `messages.role, content` (text) — [app/api/chat/route.js](C:/Pro/geiger-grey/app/api/chat/route.js). The client sends `{ projectId, conversationId, pipelineId, content, overrides, stream: true }` (`streamChat`) — [lib/supabase/conversations.js](C:/Pro/geiger-grey/lib/supabase/conversations.js) line 105.
- The Playground `Composer` is a controlled `<textarea>` with a `toolbar` slot (where the knowledge-only toggle sits) and a send/stop button. It has no file input or drop handling — [components/internal/screens/playground/chat_kit.jsx](C:/Pro/geiger-grey/components/internal/screens/playground/chat_kit.jsx) lines 436–525.
- Widget chat takes `{ message (≤ 2000 chars), visitorId, conversationId? }` only — [app/api/widget/[widgetId]/chat/route.js](C:/Pro/geiger-grey/app/api/widget/[widgetId]/chat/route.js) lines 15–33. A grep of [public/widget.js](C:/Pro/geiger-grey/public/widget.js) for `type="file"`, `FileReader` or `attachment` found nothing.
- `messages` rows store `content text` and `citations jsonb`, with no attachment column (earlier inventory §1; [20261010120600_pipelines.sql](C:/Pro/geiger-grey/supabase/migrations/20261010120600_pipelines.sql)).
- AI SDK v7.0.143 types: `type UserContent = string | Array<TextPart | ImagePart | FilePart>`. `ImagePart { type: 'image'; image: DataContent | URL | ProviderReference; mediaType? }`. `FilePart { type: 'file'; data; filename?; mediaType }` — [worker/node_modules/@ai-sdk/provider-utils/dist/index.d.ts](C:/Pro/geiger-grey/worker/node_modules/@ai-sdk/provider-utils/dist/index.d.ts) lines 195–240, 1816.
- A reusable upload control exists: `Dropzone({ onFiles, accept, disabled, hint })`, a dashed drop target plus hidden input with MIME-wildcard `accept`, used by the sources upload flow — [components/internal/shared/dropzone.jsx](C:/Pro/geiger-grey/components/internal/shared/dropzone.jsx).

### Inferences
- Vision answering needs:
  - an `images` (or `attachments`) argument on `generateAnswer`/`runPipelineTurn` that appends `{ type: "image", image, mediaType }` parts to the final user message
  - a vision-support check, either a `supportsVision(providerKind, modelId)` table in `model_caps.js` or a user-declared `vision` flag on the connection's models, plus graceful handling of provider 400s
  - an image input contract per channel:
    - multipart or base64 on `/api/chat`
    - `image_url` parts accepted in `parseChatRequest`
    - an `image` argument on MCP tools
    - an upload in the widget
- The Composer's `toolbar` slot is the natural place for an attach button, and `Dropzone`'s `matchesAccept` grammar can be reused for a drop-on-composer area.
- Query images should not need to persist: they can be embedded and passed to the model in-request. If they are kept for logs or eval cases, they need a storage path under the project folder, because the storage RLS keys on the first folder.

### Gaps
- Which of the customer's likely chat models accept image parts through each Grey driver format (e.g. OpenRouter models, or OpenAI-compatible self-hosted servers) was not verified. Behaviour varies by model.

## 5. Tool-builder building blocks: is there a declarative, versioned configuration an AI could fill in, and how are pipelines defined, tested and published?

### Takeaway
Pipelines are the one existing "declarative config + draft/published versions" object. There is a draft row; publishing snapshots fixed fields into `pipeline_versions.config` jsonb and advances `current_version`; `resolvePipelineConfig` serves the draft to the Playground, the published snapshot to API/MCP/widget, and a pinned version to evals; RBAC splits manage from publish. But a pipeline's shape is hard-wired to "retrieve then chat". Its columns are chat settings, `publishPipeline` snapshots only seven named fields (not `metadata`), and every delivery surface assumes a question→answer turn. A "tool" is better modelled as a sibling of pipelines that copies the draft/version/publish pattern and can call pipeline and retrieval steps. Structured output (`Output.object`), the eval harness, the MCP tool registry and the AI SDK v7 tool-calling primitives are all available to build on.

### Cited Findings
**Pipelines**
- Columns are `kb_ids[], provider_id, model, temperature, max_tokens, system_prompt, retrieval jsonb, status draft|live, current_version, metadata` (earlier inventory §1). RLS uses `can_access_project`, plus restrictive guards: insert/delete need `grey.pipeline.manage`, and update needs `grey.pipeline.manage` or `grey.pipeline.publish` — [20261010120600_pipelines.sql](C:/Pro/geiger-grey/supabase/migrations/20261010120600_pipelines.sql) lines 66–80.
- `pipeline_versions(pipeline_id, version, config jsonb, note, published_by, metadata)` is unique on (pipeline_id, version), and insert/update need `grey.pipeline.publish` — [20261010120600_pipelines.sql](C:/Pro/geiger-grey/supabase/migrations/20261010120600_pipelines.sql) lines 82–110.
- `publishPipeline(pipeline, note)` runs **client-side** (browser Supabase client under RLS):
  - It builds `snapshot = { kbIds, providerId, model, temperature, maxTokens, systemPrompt, retrieval }`.
  - It inserts version `currentVersion + 1`, then sets `status: "live", current_version`.
  - Source: [lib/supabase/pipelines.js](C:/Pro/geiger-grey/lib/supabase/pipelines.js) lines 79–123. The UI calls it from [pipeline_detail.jsx](C:/Pro/geiger-grey/components/internal/screens/pipelines/pipeline_detail.jsx) line 429.
- `resolvePipelineConfig({ admin, projectId, pipelineId, channel, version, overrides })`:
  - `CHANNELS = playground | eval | api | mcp | widget`.
  - Published channels require `status = 'live'` and `current_version ≥ 1`, and load the snapshot (`fromSnapshot`).
  - Eval loads a pinned version if it exists, else the draft.
  - `applyOverrides` only narrows (temperature, topK, threshold, maxTokens, kbIds subset).
  - `knowledgeOnly: false` is allowed only on the Playground.
  - `fromSnapshot` takes `metadata` from the live row, not the snapshot.
  - Source: [lib/engine/pipeline_config.js](C:/Pro/geiger-grey/lib/engine/pipeline_config.js).
- The pipeline editor uses `EditorShell` (section nav: Model, Retrieval, Prompt, Versions, Endpoints) — [pipeline_detail.jsx](C:/Pro/geiger-grey/components/internal/screens/pipelines/pipeline_detail.jsx); [components/internal/shared/editor_shell.jsx](C:/Pro/geiger-grey/components/internal/shared/editor_shell.jsx) (`EditorShell`, `EditorHeader`, `EditorSections`).

**Other config-like objects**
- `mcp_servers(kb_ids[], pipeline_id, api_key_id, tools jsonb, status)` and `widgets(pipeline_id, api_key_id, allowed_domains[], theme jsonb, white_label, status)`. Neither is versioned, and both bind to a pipeline — [20261010120700_delivery.sql](C:/Pro/geiger-grey/supabase/migrations/20261010120700_delivery.sql) lines 51–99.
- MCP tool registry:
  - `TOOLS = { search, ask, get_entity, list_sources }`, each `{ title, description, inputSchema: z.object(...), run }`.
  - `registerTools(mcp, ctx)` registers only the names enabled in `ctx.server.tools` (`enabledToolNames`), with `READ_ONLY` annotations and `wrap()` error/log handling.
  - `MCP_TOOL_NAMES` is a fixed list.
  - Source: [lib/server/mcp/tools.js](C:/Pro/geiger-grey/lib/server/mcp/tools.js) lines 24–36, 430–497.
  - The server declares `capabilities: { tools: {} }` and is built per request (`createGreyMcpServer`) — [lib/server/mcp/server.js](C:/Pro/geiger-grey/lib/server/mcp/server.js).
- Eval model:
  - `eval_cases(question text not null, expected_answer, expected_source_ids uuid[], metadata)` — [20261010120800_quality_usage.sql](C:/Pro/geiger-grey/supabase/migrations/20261010120800_quality_usage.sql) lines 26–38.
  - Runs claimed by the `eval` worker queue (`evalQueue` imports `runEvalRun` dynamically) — [worker/queues.mjs](C:/Pro/geiger-grey/worker/queues.mjs).
  - Metrics are RAG-specific: faithfulness, answerRelevance, contextPrecision, contextRecall (earlier inventory §6).
- Structured output: `extractBatch` uses `generateText({ output: Output.object({ schema, name }) })`, falls back to loose JSON on `NoObjectGeneratedError`, then sanitizes — [lib/engine/graph_extract.js](C:/Pro/geiger-grey/lib/engine/graph_extract.js). The schemas are static zod objects ([lib/grey/graph_schema.js](C:/Pro/geiger-grey/lib/grey/graph_schema.js)).

**AI SDK v7 primitives that are installed but unused**
- The installed `ai` 7.0.143 exports `jsonSchema` (JSON Schema → schema), `zodSchema`, `tool`, `dynamicTool`, `stepCountIs` (as `isStepCount`), `Experimental_Agent` (`ToolLoopAgent`), tool-approval types (`ToolApprovalRequest`, `ToolApprovalResponse`, `ToolApprovalConfiguration`), UI-message types (`UIMessage`, `ToolUIPart`, `DynamicToolUIPart`) and experimental batch APIs (`experimental_startBatch`, `experimental_getBatchResults`) — [worker/node_modules/ai/dist/index.d.ts](C:/Pro/geiger-grey/worker/node_modules/ai/dist/index.d.ts) lines 2, 10988; [@ai-sdk/provider-utils index.d.ts](C:/Pro/geiger-grey/worker/node_modules/@ai-sdk/provider-utils/dist/index.d.ts) line 880 (`jsonSchema`).
- No Grey code uses tools: `/chat/completions` rejects `tools`, `functions`, `tool_choice` and `function_call` ("Tools aren't supported by Grey pipelines.") — [openai_frames.js](C:/Pro/geiger-grey/lib/grey/openai_frames.js) lines 51–58.
- There is no code-execution sandbox: a grep for `sandbox|isolated-vm|quickjs|vm2|new Function(|node:vm` across lib, app, components and worker found nothing.

### Inferences
- **Why a sibling, not a new pipeline type:**
  - A type stored in `pipelines.metadata` would not be versioned, because `publishPipeline` doesn't snapshot metadata and `fromSnapshot` reads metadata from the live row.
  - The chat columns don't fit classifiers or similarity tools.
  - `/chat/completions`, `ask` and the widget all assume a chat turn.
  - So the case is for a sibling: `tools` (draft: `type`, `kb_ids`, `config jsonb`, `status`, `current_version`) and `tool_versions` (snapshot of the whole `config`). Both would carry the same RLS and RBAC split (`grey.tool.manage` / `grey.tool.publish`), and publishing should snapshot the full `config` jsonb, so new tool fields need no publish-code change.
- **Closed step vocabulary.** A "closed, contained environment" can be met without code execution: the builder fills a typed config for a fixed set of tool types (classifier, similarity search, extractor, grounded Q&A, image Q&A). A `runTool(config, input)` interpreter then composes existing engine calls (`searchChunks`/vector match, `embedTexts`/new `embedImages`, `generateText` + `Output.object` with an enum or JSON schema, `generateAnswer`). The AI SDK's `jsonSchema()` lets a stored JSON Schema drive `Output.object` without zod in code.
- **The draft→test→publish loop already exists.** A builder needs the same channel split as `resolvePipelineConfig` (draft for the builder's preview, snapshot for published surfaces), and evals pinning versions shows how to test a fixed version.
- **Tests are tool-type-specific.** Classifier accuracy or a confusion matrix, and top-k hit rate for similarity, need new metric code. `eval_cases.question text not null` cannot hold an image input without a schema change (an `input jsonb` or `input_media` reference).

### Gaps
- Whether `@modelcontextprotocol/server` 2.3.1's `registerTool` accepts a JSON Schema (rather than zod) for dynamically defined tools was not checked. Dynamic per-tool MCP registration depends on it, or on converting JSON Schema to zod.
- `pipeline_detail.jsx` was read only for the publish call, not in full.

## 6. Chat-building UX: existing conversational-configuration patterns in Grey and sibling apps, and reusable UI

### Takeaway
No suite app has an AI assistant that builds or edits configuration, and none uses tool calling or the AI SDK. Grey would be the first.
- **Notes** has the only live AI feature: a canvas "AI assistant" node making one non-streaming Anthropic call with a JSON-schema output, on a platform-owned key, which breaks the BYO rule.
- **Forms** shows "Describe a form … get a ready-to-edit draft" only as a Coming-soon screen waiting for a non-existent `@geiger/ai` package.
- **Reusable non-AI builder plumbing:** Forms' in-builder preview, publish dialog with pre-publish warnings, version table with diff/restore, whole-doc undo and autosave; Flow's side-by-side editor-plus-live-preview grid and its chat composer with file attachments.
- **Grey's own Playground** (three-pane chat frame, `chat_kit`, SSE plumbing) is the closest chat shell.
- **geiger-ui** has tabs, segmented tabs, sheets, drawers, scroll areas, a file input and the screen kit, but no chat/message, prompt-input, dropzone, resizable-panel, code-block or JSON-viewer components.

### Cited Findings
**Grey (no conversational configuration exists)**
- Grey has no assistant that edits settings: every configuration screen is a form (`EditorShell` sections, dialogs, sheets), and the only chat is the Playground's grounded Q&A — [components/internal/screens/registry.jsx](C:/Pro/geiger-grey/components/internal/screens/registry.jsx); [pipeline_detail.jsx](C:/Pro/geiger-grey/components/internal/screens/pipelines/pipeline_detail.jsx); [playground/chat.jsx](C:/Pro/geiger-grey/components/internal/screens/playground/chat.jsx).
- **Playground layout** (`chat.jsx`): a `MainScreenWrapper` + `ScreenHeader` page, holding one bordered container (`flex h-[78vh] … rounded-xl border border-border bg-surface-subtle lg:flex-1`) with three panes:
  - left: `ConversationRail`, which collapses to a left `Sheet` below lg
  - centre: a column with a 56 px header (pipeline `Select`, actions), `MessageList` and `Composer`
  - right: `RunSettingsPanel`, which becomes a right `Sheet` on small screens
  - Per-viewer toggles (knowledge-only, settings open) are kept in localStorage with an in-memory fallback (`usePersistentFlag`).
  - Source: [chat.jsx](C:/Pro/geiger-grey/components/internal/screens/playground/chat.jsx) lines 1–80, 700–790.
- **`chat_kit.jsx`** exports `useOpenSource`, `CitationChip`, `IconAction`, `TypingIndicator`, `MessageList` and `Composer`. Its header says "Layout follows geiger-flow's chat (grouped column, hover action pill, rounded composer box); assistant turns render as markdown prose rather than bubbles." `MessageList` renders text, citations and the context panel; it has no tool-call or structured-part rendering — [chat_kit.jsx](C:/Pro/geiger-grey/components/internal/screens/playground/chat_kit.jsx) lines 14–24, 340–440.
- **Other Playground parts:**
  - `ContextPanel` / `ContextToggle` (passages sent, token budget) — [context_panel.jsx](C:/Pro/geiger-grey/components/internal/screens/playground/context_panel.jsx).
  - `RunSettingsPanel` (override `Slider`s, `Badge`, close action) — [run_settings.jsx](C:/Pro/geiger-grey/components/internal/screens/playground/run_settings.jsx).
  - `Markdown` — [markdown.jsx](C:/Pro/geiger-grey/components/internal/screens/playground/markdown.jsx).
  - Pure helpers `replyMetrics`, `replySource`, `contextSummary` — [lib/grey/playground.js](C:/Pro/geiger-grey/lib/grey/playground.js).
- **Streaming plumbing:**
  - Server: `createEventStream`, `encodeSseEvent`, `sseResponse` — [lib/server/sse.js](C:/Pro/geiger-grey/lib/server/sse.js).
  - Client: `apiStream(path, { body, onEvent, signal })` — [lib/api.js](C:/Pro/geiger-grey/lib/api.js).
  - `/api/chat` emits events `start`, `retrieval`, `delta`, `done`, `error` — [app/api/chat/route.js](C:/Pro/geiger-grey/app/api/chat/route.js) lines 235–280.
- **Shared Grey components:** `EditorShell`, `Dropzone`, `CopyBlock` ("API keys, endpoint URLs, embed snippets"), `ScreenHeader`, `StatsBar`, `StatGrid`, `ModelIdSelect`, `TagInput`, `FilterDropdown`, `Pagination` — [components/internal/shared/](C:/Pro/geiger-grey/components/internal/shared/).
- **`@geiger/ui` imports in Grey, by count:** button 56, root 35 (`LoadingArea`, `LogoLoading`, …), badge 25, dialog 23, input 22, select 18, action-menu 15, textarea 13, sheet 10, tooltip 7, checkbox 7, sidebar 5, dropdown-menu 5, switch 4, progress 4, avatar 4, table 3, tabs 2, slider 2, skeleton 2, popover 2, icon-picker 2, card 2, toggle-group 1, accordion 1 (grep of `from "@geiger/ui…"` in components/app).
- A recent commit used `SegmentedTabs` from geiger-ui in the add-source dialog (git log `66448e0 fix(grey): use geiger-ui SegmentedTabs in the add-source dialog`).

**Sibling apps (read-only search of geiger-flow, geiger-forms, geiger-notes and geiger-ui by a delegated sub-search; key claims spot-checked)**
- **No AI SDK or tool calling anywhere.**
  - A search for imports of `ai`, `@ai-sdk/*`, `openai`, `@anthropic-ai/sdk` and `@google/genai` found none in Flow, Forms or Notes.
  - A search for `useChat|streamText|generateObject|generateText|Output.object|stopWhen|toolCall|UIMessage` also found none.
  - None of the three package.json files list `ai` or `@ai-sdk/*` — [geiger-flow package.json](C:/Pro/geiger-flow/package.json); [geiger-forms package.json](C:/Pro/geiger-forms/package.json); [geiger-notes package.json](C:/Pro/geiger-notes/package.json).
- **Notes AI node.**
  - `POST /api/ai/node` reads `process.env.ANTHROPIC_API_KEY` (503 "AI is not configured. Add ANTHROPIC_API_KEY to .env") and calls `https://api.anthropic.com/v1/messages` with `output_config: { effort: "low", format: { type: "json_schema", schema: OUTPUT_SCHEMA } }`. The schema is `{ text: string, items: string[] }`. The call is not streamed, and on a parse failure the route falls back to raw text — [geiger-notes app/api/ai/node/route.js](C:/Pro/geiger-notes/app/api/ai/node/route.js) lines 27–35, 46–47, 73–86.
  - The client node (`AiNode`, `AI_ACTIONS` summarize/cluster/brainstorm/actions/custom, `buildAiContext` capped at 20,000 chars) has a single prompt and a Run button, and spawns sticky notes from `items` — [geiger-notes components/internal/nodes/ai/AiNode.jsx](C:/Pro/geiger-notes/components/internal/nodes/ai/AiNode.jsx) (`run()` ~line 142, `spawnNotes()` ~line 177).
- **Forms AI is a placeholder.**
  - Nav items `ai.generate`, `ai.analysis`, `ai.assist` and `ai.moderation` exist — [geiger-forms sidebar_nav.js](C:/Pro/geiger-forms/components/internal/sidebar/sidebar_nav.js) lines 84–93.
  - The `ComingSoonScreen` says "AI features across the Geiger suite are delivered by one shared package, `@geiger/ai`" — [coming_soon_screen.jsx](C:/Pro/geiger-forms/components/internal/screens/forms/coming-soon/coming_soon_screen.jsx) lines 9–41.
  - The sub-search found no `@geiger/ai` package under C:/Pro.
- **Forms builder plumbing:**
  - `BuilderPreview({ doc, form, onExit })` runs the unsaved doc with the real logic and never saves answers. The editor swaps between edit and preview rather than showing them side by side — [builder-preview.jsx](C:/Pro/geiger-forms/components/forms/builder/builder-preview.jsx); [form-builder.jsx](C:/Pro/geiger-forms/components/forms/form-builder.jsx) lines 343–346.
  - Undo/redo: `useDocHistory` (whole-doc undo, 100 steps, keyed edits merged within 900 ms) — [doc-history.js](C:/Pro/geiger-forms/components/forms/builder/doc-history.js).
  - Autosave: `useAutosave` (1 s debounce, retry, beforeunload) — [use-autosave.js](C:/Pro/geiger-forms/components/forms/builder/use-autosave.js).
  - Checks and diffs: `collectWarnings` (pre-publish checks) and `diffDocs` (added/removed/changed/reordered) — [doc-checks.js](C:/Pro/geiger-forms/components/forms/builder/doc-checks.js).
  - Publishing: `PublishDialog` (Draft/Published switch, warnings with "Fix", "Publish anyway"), gated by `useCan("forms.form.publish")` — [publish-dialog.jsx](C:/Pro/geiger-forms/components/forms/publish-dialog.jsx).
  - Versions: `forms.versions(form_id, version, label, notes, schema jsonb, settings jsonb)`, unique per (form, version) — [20260711205608_collaboration.sql](C:/Pro/geiger-forms/supabase/migrations/20260711205608_collaboration.sql) line 13. `HistorySection` provides save-with-notes and restore-with-diff, and restoring first auto-saves a "Before restore of …" version — [history-section.jsx](C:/Pro/geiger-forms/components/forms/builder/history-section.jsx); [form-builder.jsx](C:/Pro/geiger-forms/components/forms/form-builder.jsx) lines 247–269.
  - Form document shape: `serializeBuilderDoc` → `{ title, description, schema: { fields }, settings }`, with `toCanonicalField` — [lib/forms/builder.js](C:/Pro/geiger-forms/lib/forms/builder.js); [lib/forms/schema.js](C:/Pro/geiger-forms/lib/forms/schema.js) line 40.
- **Flow live-preview layout.** Flow's form builder puts the editor left and a sticky live preview right, in `grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]`, with `saveForm("draft" | "published")` — [geiger-flow addons/forms/screens/form_builder_screen.jsx](C:/Pro/geiger-flow/addons/forms/screens/form_builder_screen.jsx) line 428.
- **Flow chat (human-to-human, Supabase realtime):**
  - `TwoPaneChat` (list + thread) and `ChatThread` (controlled `onSendMessage(text, replyTo, attachments)`, stick-to-bottom, history paging, side panel) — [two-pane-chat.jsx](C:/Pro/geiger-flow/components/internal/screens/projects/grounding/chat/two-pane-chat.jsx); [chat-thread.jsx](C:/Pro/geiger-flow/components/internal/screens/projects/grounding/chat/chat-thread.jsx).
  - `Composer` (hidden `type="file"` input via Plus/Paperclip, `MAX_FILE_BYTES = 25 MB`, attachment chips, "/" command menu, no drag-drop or paste) — [composer.jsx](C:/Pro/geiger-flow/components/internal/screens/projects/grounding/chat/composer.jsx) lines 10, 54, 210.
  - `buildOptimisticAttachments` / `uploadAttachments` / `revokeOptimistic` — [geiger-flow lib/chat/attachments.js](C:/Pro/geiger-flow/lib/chat/attachments.js).
- **Playground kits** for landing demos (`enterPlayground`, `interceptFetch`, in-memory supabase client, seeds) exist in Forms and Notes. Notes mocks `/api/ai/node` there. These are demo fixtures, not a tool test sandbox — [geiger-forms lib/playground/](C:/Pro/geiger-forms/lib/playground/); [geiger-notes lib/playground/api_routes.js](C:/Pro/geiger-notes/lib/playground/api_routes.js) lines 364–375.
- **geiger-ui** (`src/ui` listing):
  - Present: `tabs`, `segmented-tabs`, `toggle-group`, `sheet`, `drawer`, `dialog`, `scroll-area`, `textarea`, `file-input`, `resize-handle` (decorative only), `screen-kit` (`ScreenHeader, EditorSectionHeader, SectionCard, EmptyState, LoadingArea, Toolbar, StatusPill, SettingsList, SettingRow, Field, DataTable, StatsBar, SearchInput` …), `logo-loading`, `skeleton`, `command-palette`, `kbd`, `chart`, `popover`, `hover-card`, `sonner`, `badge`, `card`, `tooltip`.
  - Missing: no chat/message, prompt-input, dropzone, resizable-panels, code-block, JSON-viewer or markdown component.
  - Grey, Flow and Forms pin geiger-ui commit `258dd6a`; Notes is on `00cac4f`.
  - Sources: [C:/Pro/geiger-ui/src/ui](C:/Pro/geiger-ui/src/ui); [geiger-ui package.json](C:/Pro/geiger-ui/package.json); [geiger-grey package.json](C:/Pro/geiger-grey/package.json) line 27.
- The nearest local code-block is `CodeBlock({ code, label })` in [geiger-forms developer/code_block.jsx](C:/Pro/geiger-forms/components/internal/screens/forms/developer/code_block.jsx). Grey's own `CopyBlock` serves the same purpose ([copy_block.jsx](C:/Pro/geiger-grey/components/internal/shared/copy_block.jsx)).

### Inferences
- **Builder screen shape.** The builder can reuse the Playground's three-pane frame almost exactly: tools/sessions rail on the left, builder chat in the centre (reusing `MessageList`/`Composer`), and a live "tool preview / test" panel on the right in place of `RunSettingsPanel`. The right panel would render the draft config (type, labels, KBs, model, schema) plus a test input (text box, or `Dropzone` for an image) and results.
- **New rendering needed.** `MessageList` needs new part types for tool calls, proposed config diffs (accept/reject) and test results. AI SDK v7's `UIMessage`/`ToolUIPart` types and tool-approval flow are installed and match that need.

- **What the builder can borrow:**
  - From Forms, the draft-safety mechanics: apply each AI-proposed change to the draft as one undoable step (`useDocHistory`-style), autosave the draft, run `collectWarnings`-style checks before publish, and show `diffDocs`-style diffs between draft and published versions and on restore.
  - From Flow, the side-by-side "editor + sticky preview" grid, which is a better fit than Forms' edit/preview toggle when a chat drives the edits.
- **A suite-level conflict to settle.** The Forms placeholder promises a shared `@geiger/ai` package ("same models, privacy controls, and usage limits"), and Notes runs on a platform key. Grey's BYO-only, AI-SDK-direct stack (`buildLanguageModel`, Vault-held customer keys, no AI Gateway) is the only implemented model layer in the suite. A Grey tool builder would either set the pattern `@geiger/ai` adopts or diverge from it. This is a product decision, not a code fact.
- **Components Grey must build or port.** Because geiger-ui has no chat, prompt-input or dropzone components, a builder chat should reuse Grey's own `chat_kit` (`MessageList`, `Composer`, `TypingIndicator`), `Markdown` and `Dropzone`. Composer attachments can follow Flow's `Composer` + `attachments.js` (chips, object-URL previews, size limit). Draggable split panes would need a new dependency, since geiger-ui's `ResizeHandle` is visual only. The Playground's fixed rail/centre/panel layout avoids that need.

### Gaps
- The sub-search did not open `C:/Pro/docs/superpowers/playground-kit/`, named as the canonical playground kit.
- Geiger Assets, Content, Comms and other suite apps were not searched for AI chat patterns. Only Flow, Forms, Notes and geiger-ui were.

## 7. Containment: how project scoping, RLS, API-key scopes, rate limits and cost caps work today, and what a per-tool scope and budget would need

### Takeaway
Containment is layered and project-first:
- RLS on every table via `can_access_project`, plus restrictive `rbac_allows` guards.
- Service-role engine code that always passes `projectId` explicitly, with a KB-set boundary on every search.
- API keys with three scopes, an optional pipeline allow-list and a per-key per-minute rate limit.
- A monthly soft cap.

But the cap counts only Grey-priced work (pages, retrievals), because BYOK model usage is recorded at cost 0. So no budget on the customer's own model spend exists. Per-tool containment needs:
- a `tool` scope with a `tool_ids` allow-list on keys
- a `tool:<id>` rate-limit bucket (trivial with `rate_limit_hit`)
- a tool-level KB boundary
- a token-based or price-table-based budget, which is new

### Cited Findings
**Project and permissions**
- `authorize({ admin, user, projectId, key, notFoundOnDenied })` checks project membership (org users, or the creator when there is no org), loads `public.roles` and `grey.role_grants`, and evaluates the key with `@geiger/rbac` `evaluate`. `requirePermission` composes authenticate and authorize — [lib/server/auth.js](C:/Pro/geiger-grey/lib/server/auth.js) lines 60–110.
- Permission keys are view keys per nav section plus action keys such as `grey.pipeline.manage/publish`, `grey.apikey.manage`, `grey.mcp.manage`, `grey.widget.manage` and `grey.eval.manage`, with system roles seeded in the config — [geiger-rbac.config.js](C:/Pro/geiger-grey/geiger-rbac.config.js); [lib/rbac.js](C:/Pro/geiger-grey/lib/rbac.js).
- Search functions are service role only and scope by `p_project` ("routes authorize first and pass project_id explicitly; a KB id from another project returns nothing") — [20261018120200_retrieval.sql](C:/Pro/geiger-grey/supabase/migrations/20261018120200_retrieval.sql) header and grants. `searchChunks` re-selects active KBs in `projectId ∩ kbIds` ("the KB set is the retrieval boundary") — [retrieval.js](C:/Pro/geiger-grey/lib/engine/retrieval.js).
- The worker re-checks the job's source and KB against the job's project (`assertJobScope`) and only signs uploads in the project folder (`inProjectFolder`) — [run.mjs](C:/Pro/geiger-grey/worker/ingest/run.mjs) lines 72–86.

**API keys and rate limits**
- `authenticateApiKey(request, { scope, projectId, pipelineId, requiredKeyId })` hashes the bearer token, loads the key, calls `evaluateKey`, then calls `rateLimitHit({ bucket: "key:<id>", limit: keyRateLimit(key) })`. It fails open on limiter errors and adds `X-RateLimit-*` headers — [lib/server/api_key_auth.js](C:/Pro/geiger-grey/lib/server/api_key_auth.js).
- `evaluateKey` checks in this order: unknown, revoked, expired, project, pipeline allow-list ("must be in a non-empty pipeline_ids": an **empty list allows every pipeline**), bound key, scope (`'retrieve' | 'chat' | 'mcp'`) — [lib/grey/api_key_eval.js](C:/Pro/geiger-grey/lib/grey/api_key_eval.js).
- `grey.rate_limit_hit(p_bucket, p_limit, p_window_seconds)` is an atomic fixed-window upsert into the unlogged `rate_limit_windows`, service role only — [20261018120400_delivery_runtime.sql](C:/Pro/geiger-grey/supabase/migrations/20261018120400_delivery_runtime.sql) lines 6–76.

**Caps, metering and safety**
- `getCapState` reads `monthly_soft_cap`/`cap_behavior` and `project_month_spend` (sum of `usage_events.cost` this month). A failed check never blocks (`reached: false`) — [lib/engine/usage.js](C:/Pro/geiger-grey/lib/engine/usage.js); [20261018120000_providers_byo.sql](C:/Pro/geiger-grey/supabase/migrations/20261018120000_providers_byo.sql) lines 272–284.
- `recordUsage` takes `kind, quantity, unitCost, cost, refType, refId, metadata`. The only Grey-priced units are pages (per tier) and `PRICE_PER_RETRIEVAL = 0.001`, and there is no per-model token price table — [usage.js](C:/Pro/geiger-grey/lib/engine/usage.js); [lib/grey/cost.js](C:/Pro/geiger-grey/lib/grey/cost.js). BYOK kinds are recorded at cost 0 (earlier inventory §6).
- Grounding safety: knowledge-only is the default on every channel except a Playground override, and with no chunks `generateAnswer` returns `NO_CONTEXT_ANSWER` without calling the model — [answer.js](C:/Pro/geiger-grey/lib/engine/answer.js) lines 87–100; [pipeline_config.js](C:/Pro/geiger-grey/lib/engine/pipeline_config.js).
- Custom provider base URLs are SSRF-checked and pinned (`assertPublicBaseUrl`, `providerFetch`, `noRedirect`) — [lib/engine/secrets.js](C:/Pro/geiger-grey/lib/engine/secrets.js); [lib/engine/drivers/http.js](C:/Pro/geiger-grey/lib/engine/drivers/http.js).
- Channel check constraints:
  - `conversations.channel in ('playground','widget','api')` — [20261010120600_pipelines.sql](C:/Pro/geiger-grey/supabase/migrations/20261010120600_pipelines.sql) line 121
  - `request_logs.channel in ('playground','widget','api','mcp')` — [20261018120400_delivery_runtime.sql](C:/Pro/geiger-grey/supabase/migrations/20261018120400_delivery_runtime.sql) lines 17–19

### Inferences
- **Per-tool scope.** Add `tool` (and possibly `builder`) to `ALLOWED_SCOPES` and to `evaluateKey`'s documented scopes, plus `api_keys.tool_ids uuid[]` with the same "empty = all" semantics or, safer, "empty = none" for tools. Tools bound to a key (as MCP servers and widgets are) can reuse `requiredKeyId`.
- **Per-tool rate limit.** `rateLimitHit({ bucket: "tool:<id>", limit: tool.config.ratePerMin })` is a one-line addition beside the key bucket.
- **Per-tool data boundary.** Store `kb_ids` on the tool version and pass only those to `searchChunks` (as `scopeConfigToServer`/`boundaryKbs` do for MCP). Source-level or kind-level scoping additionally needs the `p_source_ids`/`p_kinds` filters (Question 3; earlier inventory §3).
- **Per-tool budget.** The soft cap can't budget customer model spend, because BYOK cost is 0. A per-tool budget would need either token and call quotas (sum `usage_events.quantity` for `llm_tokens` where `metadata.toolId = X`, enforced in `runTool` like `getCapState`) or a user-entered price per million tokens per model to compute an estimated cost. Either needs `usage_events` rows tagged with the tool id (`ref_type='tool'`, `ref_id`). That works without a migration because `ref_type`/`ref_id`/`metadata` already exist.
- **Builder agent containment.** The builder's own model calls run on the project's processing model (BYO). Its tools should only read project data through the same boundary functions and only write the tool's **draft** row. Publishing should stay a human action gated by `grey.tool.publish`, mirroring `grey.pipeline.publish`.
- New channels (`builder`, `tool`) need the two check constraints extended, or `metadata.endpoint` used instead.

### Gaps
- `public.projects` / org membership internals and the `@geiger/rbac` `evaluate` semantics for wildcards were not re-read (covered at header level in the earlier inventory).

## 8. Gap list: reusable pieces, missing pieces and relative size for each direction

### Takeaway
Direction 2 (image similarity and answering) is mostly additive engineering on solid foundations: provider drivers, one worker branch, an engine input, a preview route and composer attachments. The smallest credible slice is a "multimodal knowledge base" plus `searchByImage`, about medium overall. Direction 1 (chat-built tools) is larger. It needs a new versioned `tools` object, a closed-vocabulary tool runtime, a tool-calling builder agent (Grey's first use of tool calling), a builder screen, type-specific tests, and publishing on every surface. It is large overall but can reuse the pipeline draft/publish pattern, the Playground frame, the eval queue and the delivery auth stack.

### Cited Findings
(Every item below is backed by the findings in Questions 1–7. Paths are repeated here for convenience.)

**Direction 2 — reusable**
- Image sources and storage: `sources.kind='image'`, the `grey-sources` bucket and folder RLS, Assets imports with `thumbnail_url`, `Dropzone`, `analyzeFile` — [upload_sources_dialog.jsx](C:/Pro/geiger-grey/components/internal/screens/sources/upload_sources_dialog.jsx); [suite_imports.js](C:/Pro/geiger-grey/lib/supabase/suite_imports.js); [dropzone.jsx](C:/Pro/geiger-grey/components/internal/shared/dropzone.jsx).
- Worker job lifecycle: lease queue, staged chunks + `swapSourceChunks`, `EMBED_BATCH`, usage recording, and the `prepareDocument`/`prepareMedia` split — [run.mjs](C:/Pro/geiger-grey/worker/ingest/run.mjs).
- Driver pattern and transport: `buildEmbedRequest`/`parseEmbedResponse`, per-format driver files, `requestJson` — [embedding_models.js](C:/Pro/geiger-grey/lib/grey/embedding_models.js); [drivers/embed/](C:/Pro/geiger-grey/lib/engine/drivers/embed/); [drivers/http.js](C:/Pro/geiger-grey/lib/engine/drivers/http.js).
- Vector storage and search: untyped `halfvec`, per-dims HNSW, and `match_chunks_vector` taking `p_query halfvec` directly — [20261018120200_retrieval.sql](C:/Pro/geiger-grey/supabase/migrations/20261018120200_retrieval.sql).
- Processing-model pattern for captioning: `getProcessingModel`, `enrichChunks`-style per-chunk calls — [llm.js](C:/Pro/geiger-grey/lib/engine/llm.js); [enrich.js](C:/Pro/geiger-grey/lib/engine/enrich.js).
- `vlm` parser value and the OCR adapter/routing as preset and interface slots — [knowledge/constants.js](C:/Pro/geiger-grey/components/internal/screens/knowledge/constants.js); [ocr_routing.js](C:/Pro/geiger-grey/lib/grey/ocr_routing.js); [ocr_service.mjs](C:/Pro/geiger-grey/worker/ingest/parse/ocr_service.mjs).
- AI SDK `ImagePart`/`FilePart` for vision prompts — [provider-utils index.d.ts](C:/Pro/geiger-grey/worker/node_modules/@ai-sdk/provider-utils/dist/index.d.ts).
- Signed-URL route pattern (`inProjectFolder`, Assets `read-url`) — [media-url/route.js](C:/Pro/geiger-grey/app/api/sources/[id]/media-url/route.js).

**Direction 1 — reusable**
- Draft/version/publish pattern with RBAC split: `pipelines`, `pipeline_versions`, `publishPipeline`, `resolvePipelineConfig` channels — [pipelines.js](C:/Pro/geiger-grey/lib/supabase/pipelines.js); [pipeline_config.js](C:/Pro/geiger-grey/lib/engine/pipeline_config.js); [20261010120600_pipelines.sql](C:/Pro/geiger-grey/supabase/migrations/20261010120600_pipelines.sql).
- Engine steps a tool can compose: `searchChunks`, `runPipelineTurn`, `generateAnswer`, `extractBatch` structured output — [retrieval.js](C:/Pro/geiger-grey/lib/engine/retrieval.js); [turn.js](C:/Pro/geiger-grey/lib/engine/turn.js); [answer.js](C:/Pro/geiger-grey/lib/engine/answer.js); [graph_extract.js](C:/Pro/geiger-grey/lib/engine/graph_extract.js).
- AI SDK v7 `jsonSchema`, `tool`, `dynamicTool`, `stepCountIs`, `ToolLoopAgent`, tool approvals and UI message parts — [ai index.d.ts](C:/Pro/geiger-grey/worker/node_modules/ai/dist/index.d.ts).
- Playground frame and chat kit, SSE plumbing, `EditorShell`, `CopyBlock` — [playground/](C:/Pro/geiger-grey/components/internal/screens/playground/); [sse.js](C:/Pro/geiger-grey/lib/server/sse.js); [shared/](C:/Pro/geiger-grey/components/internal/shared/).
- Eval sets/runs/results and the worker eval queue — [queues.mjs](C:/Pro/geiger-grey/worker/queues.mjs); [eval_runner.js](C:/Pro/geiger-grey/lib/engine/eval_runner.js).
- Delivery stack: `authenticateApiKey`, `evaluateKey`, `rateLimitHit`, `handleApi`, `scheduleDeliveryLog`, MCP `TOOLS`/`registerTools`, widgets with domain allow-lists — [api_key_auth.js](C:/Pro/geiger-grey/lib/server/api_key_auth.js); [api_key_eval.js](C:/Pro/geiger-grey/lib/grey/api_key_eval.js); [mcp/tools.js](C:/Pro/geiger-grey/lib/server/mcp/tools.js); [delivery_log.js](C:/Pro/geiger-grey/lib/server/delivery_log.js).
- Builder mechanics from sibling apps (patterns to port, not shared code):
  - From Forms: `useDocHistory`, `useAutosave`, `collectWarnings`/`diffDocs`, `PublishDialog`, `forms.versions` + `HistorySection` — [geiger-forms components/forms/builder/](C:/Pro/geiger-forms/components/forms/builder/).
  - From Flow: the editor + sticky-preview grid and the attachment `Composer` — [form_builder_screen.jsx](C:/Pro/geiger-flow/addons/forms/screens/form_builder_screen.jsx); [composer.jsx](C:/Pro/geiger-flow/components/internal/screens/projects/grounding/chat/composer.jsx).
- No suite app has an AI builder, tool calling or AI SDK usage to reuse (Question 6).

### Inferences
**Direction 2 — missing pieces (size)**

| Piece | What it involves | Size |
|---|---|---|
| Image-embedding drivers | `buildImageEmbedRequest`/`parseImageEmbedResponse` for cohere (v4 image inputs), voyage (`multimodalembeddings`), google (`gemini-embedding-2` parts), nomic (`/embedding/image` multipart, vision/text model pair); `embedImages()` in `embeddings.js`; a `modalities` flag on suggested models; image probe in `detectEmbeddingDims` | Medium |
| KB modality config | A KB-level "accepts images" flag derived from the model (no migration if kept in `knowledge_bases.metadata`); UI in the create-KB dialog | Small |
| Worker image branch | `prepareImage` in `run.mjs`: fetch bytes, size/type checks (no sharp today, so either add it or rely on provider limits), caption/OCR via the BYO vision processing model (new `captionImage` beside `enrichChunks`), one chunk per image (`metadata.kind='image'`, content = caption), embed pixels via `embedImages`; replace the `image_ocr_unavailable` early failure; `parseKey`/`chunkKey` inputs for the caption model | Medium |
| Separate image vector store (only if image and text models differ) | `chunk_vectors` table or `image_embedding` columns, per-dims partial HNSW indexes, `match_chunk_vectors(p_space…)`, swap/cleanup in `swap_source_chunks` | Medium–Large (avoidable with the multimodal-KB path) |
| Retrieval by image/vector | `searchChunks({ queryVector | queryImage, kinds? })` or an exported `searchByVector`; vector-only mode; source-level dedupe; `p_kinds` filter in `match_chunks_vector`; return `kind/mime/origin` | Small–Medium |
| Media previews | Allow `image` in `media-url` (or a new `preview-url` with batch signing), use Assets `thumbnail_url` for Assets-origin images, optional thumbnail generation in the worker | Small (Medium with generated thumbnails) |
| Vision answering | `images` input on `generateAnswer`/`runPipelineTurn` (AI SDK image parts), `supportsVision` in `model_caps.js` or a user flag, prompt rules for "describe/identify using similar items", citations to image sources | Small–Medium |
| Input surfaces | `/api/chat` multipart or base64 attachments; `/api/v1/.../retrieve` image input; `parseChatRequest` accepting `image_url` parts; MCP `search_by_image`; widget upload; Composer attach button + preview chips; size limits; logging an image query without content (`request_logs.query` null + `metadata.input='image'`) | Medium |
| Video keyframes | Frame extraction (ffmpeg or a provider that embeds video, e.g. Voyage multimodal 3.5 / Gemini Embedding 2), keyframe chunks with `start_ms`, caption per frame; enables the "Coming soon" switch | Large |
| Metering | Image-embedding usage rows (BYOK, cost 0) via existing kinds + `metadata` or a new `usage_events.kind` (`image_embed`) needing the check-constraint migration | Small |
| Eval support | Image test cases (`eval_cases.input_media` or `metadata`), top-k hit metric | Small–Medium |

**Direction 1 — missing pieces (size)**

| Piece | What it involves | Size |
|---|---|---|
| Tool data model | `tools` (type, name, kb_ids, config jsonb, status draft/live, current_version, metadata) and `tool_versions` (full config snapshot, note, published_by); RLS + restrictive guards; RBAC keys `grey.tool.manage`/`grey.tool.publish` + a "Tools" view key | Medium |
| Tool config schema | Versioned JSON Schema per tool type (classifier: labels + descriptions + output enum; similarity: input modality, kinds, topK, threshold, result fields; extractor: output JSON Schema; Q&A: pipeline-like settings), validated server-side (zod or `jsonSchema()`) | Medium |
| Tool runtime | `runTool({ admin, projectId, toolVersion, input, channel })` composing existing engine calls; structured output via `Output.object` + `jsonSchema()`; knowledge-only rule; cap/budget check; per-tool usage tagging; no code execution | Medium–Large |
| Builder agent | `/api/tools/[id]/builder` streaming route using AI SDK tool calling (`streamText` + `tools` + `stopWhen: stepCountIs(n)`) on the project processing model; builder tools such as `list_knowledge_bases`, `sample_sources`, `set_tool_type`, `set_labels`, `set_output_schema`, `run_test`, `add_test_case`, each writing only the draft; diff/approval steps; session storage (new `builder_sessions`/messages, or `conversations` with a new `builder` channel and parts in `metadata`) | Large |
| Builder screen | New nav section and screen (`NAV_TREE`, `SCREEN_REGISTRY`, view permission); Playground-style frame with chat centre and live preview/test right panel; tool-call and diff rendering in `MessageList`; a tools list screen (DataTable recipe); tool detail editor (`EditorShell`: Config, Tests, Versions, Endpoints) | Medium–Large |
| Test harness | `tool_test_cases(input jsonb or media ref, expected jsonb)` and runs/results on the eval queue pattern; classifier accuracy/confusion and similarity hit@k metrics; "promote a test run to a version" | Medium |
| Publishing: REST | `POST /api/v1/tools/[toolId]/run` (JSON in/out, image input), `tool` key scope + `tool_ids` allow-list, `request_logs.channel` extension | Small–Medium |
| Publishing: MCP | Dynamic registration of published tools as MCP tools (input schema from tool config); `mcp_servers.tools` extended to tool ids; `MCP_TOOL_NAMES` no longer fixed | Medium |
| Publishing: widget | Widgets bound to `tool_id` as well as `pipeline_id`; `public/widget.js` renderer for form-style tools (input form, image upload, result list) rather than chat only | Medium |
| Publishing: internal screen | A runnable "app" view per tool inside Grey (input form from schema, results), possibly as a per-tool nav entry | Small–Medium |
| Budgets and limits | `tool:<id>` rate-limit bucket; token/call quotas per tool from `usage_events` tagged `ref_type='tool'`; optional user-entered model prices (BYOK cost is 0 today) | Small–Medium |

### Gaps
- No implementation estimate here was validated against a prototype. The sizes are relative judgements from the code read.
- Whether the user wants the builder agent to run on the project processing model or on a separate "builder model" setting is a product decision not covered by any doc.
