# Geiger Grey: current capabilities inventory (internal primitives for non-chat knowledge features)

Every source below is a file in the Grey repository (C:/Pro/geiger-grey, `main` at 7e4ef34, read on 2026-10-21). Links point at the absolute file path; function or object names are given where they matter. Nothing was run. The findings come from reading migrations, engine, worker, routes, screens and docs.

## 1. Data model: what tables and key columns exist?

### Takeaway
Fourteen migrations define a `grey` schema of about 30 tables. They form a complete RAG data model: sources become chunks with vectors and full-text search, there is a provenance-tracked knowledge graph, pipelines have versioned snapshots, and there are delivery objects, evals, metering and a lease-based job queue. Nothing stores document-level derived data (summaries, labels, extracted fields, artifacts). The only job tables are `ingestion_jobs` and `eval_runs`. There are no outbound-integration tables (webhooks, schedules, subscriptions).

### Cited Findings
**Core and access**
- `grey` schema, `grey.touch_updated_at()`, and `grey.can_access_project(uuid)`: a project is reachable by org members, its creator, or anyone when it has no org. Every table uses RLS `using (grey.can_access_project(project_id))` — [20261010120000_grey_core.sql](C:/Pro/geiger-grey/supabase/migrations/20261010120000_grey_core.sql)
- RBAC comes from `@geiger/rbac`: `public.roles` (permissions text[], wildcard matching via `public.rbac_key_matches`), `grey.role_grants`, and `rbac_allows()`, which restrictive RLS policies call — [20261010120100_adopt_rbac.sql](C:/Pro/geiger-grey/supabase/migrations/20261010120100_adopt_rbac.sql)
- `grey.project_members` (role/status/groups overlay), `grey.member_groups`, and `grey.member_activity`, an "append-only audit feed (select+insert only)" — [20261010120200_team.sql](C:/Pro/geiger-grey/supabase/migrations/20261010120200_team.sql) (header only read)

**Ingestion** — [20261010120400_ingestion.sql](C:/Pro/geiger-grey/supabase/migrations/20261010120400_ingestion.sql)
- `ingestion_presets`: tier `fast|balanced|high|auto|custom`, `is_system`, and a `config` jsonb with `parser`, `ocr`, `chunking{strategy,size,overlap,atomicTables,headingBreadcrumbs}`, `enrichment{contextual,parentChild}`, `media{transcribe,diarize,keyframes,windowSeconds}`, `graph{extract}` and `prices`. Four system presets are seeded with fixed ids.
- `knowledge_bases`: name, description, icon, status `active|archived`, preset_id, `embedding_model` (immutable, enforced by trigger `lock_embedding_model`), `chunk_config`, `retrieval_defaults`, metadata.
- `sources`: `kind` in `document|audio|video|image|web|note`; `origin` in `upload|assets|notes|content|url`; origin_ref, mime, bytes, page_count, duration_ms, storage_path, content_hash; status `pending|queued|processing|ready|failed`; chunk_count, token_count; **owner_id, review_due_at, verified_at**; metadata.
- `ingestion_jobs`: preset_snapshot, status `queued|running|succeeded|failed|cancelled`, stage `parse|chunk|embed|graph` (check constraint), progress, estimated_cost, actual_cost, error, started_at/finished_at, metadata.
- `chunks`: ordinal, content, token_count, page, start_ms, end_ms, heading_path text[], metadata.
- Private storage bucket `grey-sources` at path `<projectId>/<kbId>/<sourceId>/<filename>`.

**Knowledge graph** — [20261010120500_graph.sql](C:/Pro/geiger-grey/supabase/migrations/20261010120500_graph.sql), [20261018120300_graph_extraction.sql](C:/Pro/geiger-grey/supabase/migrations/20261018120300_graph_extraction.sql)
- `kg_types` (kind `entity|relation`, name, color `chart-1..5`, description, is_default).
- `kg_entities` (type_id, name, aliases[], description, **properties jsonb**, `source_app` `grey|forms|manual`, confidence, merged_into), with generated `name_norm`/`aliases_norm` plus trigram, alias and email indexes.
- `kg_relations` (source/target entity, type_id, **valid_from/valid_to**, confidence, source_app).
- `kg_mentions` (entity_id or relation_id, source_id, chunk_id, page, start_ms), unique per (entity, chunk) and (relation, chunk).
- `kg_form_links` (submission_id, entity_key → entity_id, form_id).
- SQL functions: `ensure_default_ontology` (8 entity types Person…Other and 6 relation types works_at…created), `kg_upsert_extracted`, `kg_clear_source_mentions`, `kg_sweep_orphans`, `kg_merge_entities`, `kg_match_query_entities`, `kg_expand`, `upsert_form_entity`, and the trigger `kg_sources_soft_deleted`.

**Pipelines and chat** — [20261010120600_pipelines.sql](C:/Pro/geiger-grey/supabase/migrations/20261010120600_pipelines.sql)
- `model_providers`: provider kind, base_url, `secret_id` (Vault), key_last4, status `unverified|ok|error`, models[].
- `pipelines`: kb_ids[], provider_id, model, temperature, max_tokens, system_prompt, `retrieval` jsonb, status `draft|live`, current_version.
- `pipeline_versions`: version, `config` snapshot, note, published_by.
- `conversations`: pipeline_id, user_id, title, channel `playground|widget|api`.
- `messages`: role `user|assistant`, content, citations jsonb, **feedback `up|down`, feedback_note, unanswered**, latency_ms, tokens_in/out.

**Delivery** — [20261010120700_delivery.sql](C:/Pro/geiger-grey/supabase/migrations/20261010120700_delivery.sql)
- `api_keys`: prefix, key_hash (unique), scopes[], pipeline_ids[], rate_limit_per_min, last_used_at, expires_at, revoked_at.
- `mcp_servers`: kb_ids[], pipeline_id, api_key_id, `tools` jsonb, status.
- `widgets`: pipeline_id, api_key_id, allowed_domains[], theme jsonb, white_label, status.

**Quality and usage** — [20261010120800_quality_usage.sql](C:/Pro/geiger-grey/supabase/migrations/20261010120800_quality_usage.sql)
- `eval_sets`; `eval_cases` (question, expected_answer, expected_source_ids[]); `eval_runs` (eval_set_id, pipeline_id, pipeline_version, status `queued|running|completed|failed`, metrics jsonb); `eval_results` (eval_case_id, answer, scores jsonb).
- `request_logs` (pipeline_id, api_key_id, conversation_id, channel, query, status `ok|error|stub`, latency_ms, retrieved jsonb, tokens, cost).
- `usage_events`: kind in `page|media_minute|retrieval|llm_tokens|graph_tokens|contextual_tokens|storage_gb` (check constraint), quantity, unit_cost, cost, ref_type, ref_id, occurred_at.
- `project_settings`: default_preset_id, default_embedding_model, monthly_soft_cap, cap_behavior `alert|retrieval_only|pause_ingestion`, **alert_emails[]**, **retention_days**, log_queries.

**BYO providers** — [20261018120000_providers_byo.sql](C:/Pro/geiger-grey/supabase/migrations/20261018120000_providers_byo.sql); [20261018120500_nomic_provider.sql](C:/Pro/geiger-grey/supabase/migrations/20261018120500_nomic_provider.sql)
- Provider kinds: openai, anthropic, google, openrouter, openai_compatible, grey_hosted, cohere, voyage, assemblyai, nomic.
- `knowledge_bases.embedding_provider_id` and `embedding_dims`, with dims locked once set and only same-format provider moves allowed (trigger `guard_kb_embedding`).
- `project_settings.processing_provider_id/processing_model` and `transcription_provider_id/transcription_model`.
- `get_provider_secret`, `set_provider_secret`, and `project_month_spend`, all restricted to the service role.

**Worker queue** — [20261018120100_worker_queue.sql](C:/Pro/geiger-grey/supabase/migrations/20261018120100_worker_queue.sql)
- Lease columns (attempts, max_attempts, run_after, locked_by, locked_until) on `ingestion_jobs` and `eval_runs`.
- `chunks.job_id`, `state staged|live`, `search_text`.
- Trigger `notify_grey_jobs` → `pg_notify('grey_jobs', ...)`.
- Functions `claim_ingestion_job`, `heartbeat_ingestion_job`, `release_ingestion_job`, `swap_source_chunks`, `ingestion_paused`, `claim_eval_run`, `heartbeat_eval_run`, `release_eval_run`.
- Chunks become read-only for members (`chunks_member_select`).

**Retrieval** — [20261018120200_retrieval.sql](C:/Pro/geiger-grey/supabase/migrations/20261018120200_retrieval.sql)
- `chunks.embedding public.halfvec` (no fixed dimension), embedding_dims, embedding_model.
- Generated `fts` tsvector: heading_path weighted A, search_text/content weighted B.
- Partial HNSW indexes for dims 256/384/512/768/1024/1536/2048/3072.
- `match_chunks_vector(p_project, p_kb_ids, p_dims, p_query, p_limit≤200, p_min_similarity)` and `match_chunks_text(p_project, p_kb_ids, p_query, p_limit)`, service role only.

**Delivery runtime** — [20261018120400_delivery_runtime.sql](C:/Pro/geiger-grey/supabase/migrations/20261018120400_delivery_runtime.sql)
- `request_logs.channel` gains `mcp`.
- Unlogged `rate_limit_windows` plus `rate_limit_hit(bucket, limit, window_seconds)`.

**Other facts**
- Embeddings live on `chunks`. There is no separate embeddings table and no source-level vector. Every table above has a `metadata jsonb` and soft-delete `deleted_at` — migrations above.
- `swap_source_chunks` **hard-deletes** a source's live chunks (their kg_mentions cascade) and promotes the staged ones, so chunk ids change on a re-ingest that re-chunks — [20261018120100_worker_queue.sql](C:/Pro/geiger-grey/supabase/migrations/20261018120100_worker_queue.sql) `grey.swap_source_chunks`. A re-ingest with an unchanged `chunkKey` reuses the live chunks and only redoes the graph — [worker/ingest/run.mjs](C:/Pro/geiger-grey/worker/ingest/run.mjs) `execute()`.

### Inferences
- `sources.owner_id/review_due_at/verified_at` and `messages.feedback/unanswered` are existing human-review primitives at source and answer level. `kg_entities.properties jsonb` with `source_app` and `confidence` is a ready slot for structured attributes on entities.
- Because chunk ids are not stable across re-chunking, any new chunk-level result (a label, a grid-cell citation, an artifact citation) needs to anchor on source_id + ordinal/page/time, or be recomputed after a swap.
- Several check constraints would need migrations for new features: `ingestion_jobs.stage`, `usage_events.kind`, `request_logs.channel`, `conversations.channel`.

### Gaps
- The team/RBAC migrations were read only at header level. `public.projects` is owned by another product and was not inspected.
- `retrieval_defaults` on knowledge_bases is a column in the data layer ([lib/supabase/knowledge_bases.js](C:/Pro/geiger-grey/lib/supabase/knowledge_bases.js)), but no engine code reads it (grep found only the data layer and the create dialog).

## 2. Ingestion: what happens to a source end to end, and what metadata is produced?

### Takeaway
The worker runs this sequence: fetch, then parse (cached) or transcribe (cached), chunk, optional contextual enrichment, embed into staged rows, swap atomically, update the source, extract the graph, sweep orphans. Each chunk gets position metadata (page, timestamps, heading path, speakers), an optional one-to-two-sentence "context", a vector and an FTS vector. Each source gets counts, a content hash and an ingest fingerprint. There is no classification, tagging, summarization or field extraction at any level; the graph's entities and relations are the only semantic derivation.

### Cited Findings
- The pipeline order and progress bands (parse 0–30, chunk/enrich 30–60, embed 60–90, graph 90–100) are stated in the header of [worker/ingest/run.mjs](C:/Pro/geiger-grey/worker/ingest/run.mjs) (`runIngestionJob`). Content-origin sources are rejected with "Content sources aren't supported yet."; a KB without `embedding_provider_id` fails before any paid work.
- Fetch by origin is defined in backend spec §6.1 and the worker code ([worker/ingest/fetch.mjs](C:/Pro/geiger-grey/worker/ingest/fetch.mjs)):
  - `upload`: from storage.
  - `notes`: `notes.project_boards` rendered to Markdown (`loadNotesBoard` in [worker/db.mjs](C:/Pro/geiger-grey/worker/db.mjs)).
  - `assets`: Assets' internal `read-url` endpoint with `GEIGER_INTERNAL_TOKEN`.
  - `url`: SSRF-guarded fetch plus Readability.
  - Spec: [2026-10-17-grey-backend-design.md](C:/Pro/geiger-grey/docs/superpowers/specs/2026-10-17-grey-backend-design.md) §6.1.
- Parsing uses text engines only: unpdf, mammoth+turndown, officeparser, exceljs, Readability. Layout, vlm and auto presets fall back to text with warning `layout_unavailable`, and images fail until an OCR service exists (`GREY_OCR_URL` adapter in [worker/ingest/parse/ocr_service.mjs](C:/Pro/geiger-grey/worker/ingest/parse/ocr_service.mjs)) — spec §6.2–6.4.
- Media is transcribed through the project's transcription connection (AssemblyAI or OpenAI format). Transcripts are cached and chunked in 45 s windows with 5 s overlap. Chunk metadata is `{ kind: "transcript", speakers: [] }` with start_ms/end_ms — `prepareMedia` in [worker/ingest/run.mjs](C:/Pro/geiger-grey/worker/ingest/run.mjs); [lib/engine/transcribe.js](C:/Pro/geiger-grey/lib/engine/transcribe.js).
- Document chunks are recursive by heading, with atomic tables and breadcrumbs. Each chunk carries `ordinal, content, heading_path, page, token_count, breadcrumb, search_text, metadata{pageEnd?, table?}`, and `search_text = breadcrumb + context + content` — [lib/grey/chunker.js](C:/Pro/geiger-grey/lib/grey/chunker.js) `chunkDocument`, `buildSearchText`.
- Contextual enrichment makes one call per chunk on the project processing model and returns a 1–2 sentence context stored in `chunk.metadata.context` and folded into `search_text`. It runs only when `enrichment.contextual` is on (High accuracy preset). Concurrency is 4 and output is at most 160 tokens; it never fails the job — [lib/engine/enrich.js](C:/Pro/geiger-grey/lib/engine/enrich.js) `enrichChunks`; [worker/ingest/run.mjs](C:/Pro/geiger-grey/worker/ingest/run.mjs).
- Embedding runs in batches of 128 (`EMBED_BATCH`) through the KB's own embedding connection. Staged rows store `embedding`, `embedding_dims` and `embedding_model` — [worker/ingest/run.mjs](C:/Pro/geiger-grey/worker/ingest/run.mjs); [lib/engine/embeddings.js](C:/Pro/geiger-grey/lib/engine/embeddings.js) `embedTexts`. Embed drivers: openai, cohere, voyage, google, nomic ([lib/engine/drivers/embed/](C:/Pro/geiger-grey/lib/engine/drivers/embed/)).
- Graph extraction:
  - Batches of ~6000 tokens, concurrency 3, capped at 300k tokens per source, minimum confidence 0.5.
  - Calls `generateText` with `Output.object({ schema: extractionSchema })`. The schema gives entities `{ref,name,type,aliases,description,confidence,chunks}` and relations `{source,target,type,confidence,chunk}`.
  - Results are stored via the RPC `kg_upsert_extracted` (entity resolution happens in SQL).
  - It never fails the job — warnings only.
  - Sources: [lib/engine/graph_extract.js](C:/Pro/geiger-grey/lib/engine/graph_extract.js) `extractGraph`; [lib/grey/graph_schema.js](C:/Pro/geiger-grey/lib/grey/graph_schema.js).
- Per-source output: status `ready`, chunk_count, token_count, page_count, duration_ms, content_hash, and `metadata.ingest {chunkKey, parseKey, jobId, engine, strategy, at}` — `finishSource` in [worker/db.mjs](C:/Pro/geiger-grey/worker/db.mjs).
- Per-job output: `metadata` holds warnings, parse {format, engine, cached}, transcript {provider, durationMs, language}, graph {ok, entities, relations}, embedTokens, chunks, tokens and elapsedMs; `actual_cost` is the sum of the job's usage events — [worker/ingest/run.mjs](C:/Pro/geiger-grey/worker/ingest/run.mjs); `release_ingestion_job` in [20261018120100_worker_queue.sql](C:/Pro/geiger-grey/supabase/migrations/20261018120100_worker_queue.sql).
- A grep for classify/category/tag/sentiment/summary across `lib`, `worker/ingest` and `app/api` found no classification, tagging or summarization code. The only "summar" hit is a regex cue that routes queries to the graph ([lib/grey/graph_router.js](C:/Pro/geiger-grey/lib/grey/graph_router.js)).
- Deferred, with warnings or "Coming soon": parent-child chunking, keyframe captioning, semantic chunking (falls back to recursive), and layout/OCR parsing — [worker/ingest/run.mjs](C:/Pro/geiger-grey/worker/ingest/run.mjs); [components/internal/screens/knowledge/ingestion_settings_form.jsx](C:/Pro/geiger-grey/components/internal/screens/knowledge/ingestion_settings_form.jsx) lines 130, 239–241, 274–276.

### Inferences
- `graphStage` in `run.mjs` is a clean hook for further per-source LLM stages such as classification or extraction. It runs after the swap on live chunks, is gated by a preset flag (`preset.graph.extract`), uses the processing model, records BYOK usage, and degrades to warnings. A `classify`/`extract` stage would follow the same shape, but the `stage` check constraint only allows `parse|chunk|embed|graph`.
- The cached parse (`parseCachePath`, gzip in storage) and `documentText` already give a whole-document text for document-level tasks without re-parsing.

### Gaps
- `chunk_transcript.js`, the parsers and `fetch.mjs` were not read line by line; their behaviour is taken from the spec and run.mjs call sites.

## 3. Retrieval: which knobs exist, and can retrieval run without an LLM?

### Takeaway
`searchChunks` is a self-contained hybrid search: one vector arm per embedding group, one FTS arm, optional graph expansion, RRF fusion and optional rerank. It needs only the KB's embedding connection (plus an optional rerank connection), so it already runs without any LLM. It is exposed through `/retrieve` and the MCP `search` tool. Its only filter is the knowledge-base set: there are no source, kind, date, tag or metadata filters.

### Cited Findings
- **Parameters.** `searchChunks({ admin, projectId, kbIds, query, topK=6 (1–50), hybrid=true, rerank=false, rerankProviderId, rerankModel, threshold=0.2 (0–1), graphMode='off'|'auto'|'always', signal })`.
- **Returned chunks.** Each has `chunkId, sourceId, sourceName, kbId, content, score, page, startMs, endMs, headingPath, via` (`vector|text|graph`).
- **Returned meta.** `scoreKind, embedTokens, embedModels, rerank, graph, facts, degraded, candidateCount, timings`.
- Source for the three bullets above: [lib/engine/retrieval.js](C:/Pro/geiger-grey/lib/engine/retrieval.js).
- **Arms.** KBs are grouped by (embedding provider, model, dims) and the query is embedded once per group. If a group's embedding fails, that group degrades to text-only search (`meta.degraded='vector_unavailable'`). RRF uses graph weight 0.5. Rerank has a 3 s timeout and falls back to the fused order — [lib/engine/retrieval.js](C:/Pro/geiger-grey/lib/engine/retrieval.js); [lib/grey/fusion.js](C:/Pro/geiger-grey/lib/grey/fusion.js); [lib/engine/rerank.js](C:/Pro/geiger-grey/lib/engine/rerank.js) (cohere and voyage drivers).
- **Graph expansion.**
  - Entity match: `kg_match_query_entities` returns up to 5 entities with word similarity ≥ 0.8.
  - Routing: `shouldUseGraph` — `auto` needs 2 or more matched entities, or 1 plus a relational cue.
  - Walk: `kg_expand` with hops 2 (max 3), at most 15 edges per entity per hop, 40 entities and 8 chunks.
  - Output: up to 20 `{subject, relation, object, confidence}` facts.
  - Boundary: only entities and relations grounded in live chunks of the caller's KBs; Forms relations are never used.
  - Sources: [lib/engine/graph_retrieve.js](C:/Pro/geiger-grey/lib/engine/graph_retrieve.js); [lib/grey/graph_router.js](C:/Pro/geiger-grey/lib/grey/graph_router.js); `kg_expand` in [20261018120300_graph_extraction.sql](C:/Pro/geiger-grey/supabase/migrations/20261018120300_graph_extraction.sql).
- **Filters.** `match_chunks_vector` / `match_chunks_text` take only `p_project` and `p_kb_ids` (plus query, limit, min similarity). There is no source-id, kind, date or metadata filter. Results are capped at 200 per arm — [20261018120200_retrieval.sql](C:/Pro/geiger-grey/supabase/migrations/20261018120200_retrieval.sql).
- **Pipeline config.**
  - `DEFAULT_RETRIEVAL = { topK: 6, hybrid: true, rerank: false, threshold: 0.2, graphMode: "auto", citations: true }`.
  - The Playground uses the draft; api/mcp/widget use the published snapshot; eval uses a pinned version (else the draft).
  - Overrides only narrow: temperature, topK, threshold, maxTokens, and kbIds as a subset.
  - Source: [lib/engine/pipeline_config.js](C:/Pro/geiger-grey/lib/engine/pipeline_config.js) `resolvePipelineConfig`, `applyOverrides`.
- **Knowledge-only mode.** With no chunks and `knowledgeOnly` (the default), `generateAnswer` returns `NO_CONTEXT_ANSWER` without calling the model. Only the Playground can set `knowledgeOnly: false`; every other channel stays knowledge-only — [lib/engine/answer.js](C:/Pro/geiger-grey/lib/engine/answer.js); [lib/engine/pipeline_config.js](C:/Pro/geiger-grey/lib/engine/pipeline_config.js).
- **Retrieval without an LLM.**
  - `POST /api/v1/pipelines/[id]/retrieve` calls `searchChunks` directly and returns chunks ([route](C:/Pro/geiger-grey/app/api/v1/pipelines/[pipelineId]/retrieve/route.js)).
  - The MCP `search` tool does the same, falling back to `normalizeRetrieval({})` defaults when the server has no pipeline but has its own `kb_ids` ([lib/server/mcp/tools.js](C:/Pro/geiger-grey/lib/server/mcp/tools.js) `searchTool`, `boundaryKbs`).
  - With `cap_behavior='retrieval_only'`, a turn returns passages without generation ([lib/engine/turn.js](C:/Pro/geiger-grey/lib/engine/turn.js) `passagesAnswer`).
- **Prompt context.** Up to 6000 tokens of numbered blocks, at most 1200 tokens per chunk; history is windowed to 6 turns / 2000 tokens — [lib/grey/prompt.js](C:/Pro/geiger-grey/lib/grey/prompt.js) `buildContextBlocks`, `windowHistory`.
- **Shared turn.** `runPipelineTurn` (cap check → `searchChunks` → `generateAnswer`) is used by the Playground, v1, MCP, widget and the eval runner — [lib/engine/turn.js](C:/Pro/geiger-grey/lib/engine/turn.js).

### Inferences
- Source-scoped retrieval (e.g. `p_source_ids uuid[]` on both match functions, passed through `searchChunks`) is the single most-needed retrieval change. It would serve document×question grids, per-document extraction, "similar to this document", and filtered search UIs.
- Cross-KB similarity only works within one embedding group, since KBs can use different models and dimensions (`groupKnowledgeBases`). Similarity, dedup and clustering features must operate per embedding group.
- Every public retrieval path today requires either a published pipeline (`/retrieve`) or an MCP server. No session-authenticated search route exists for workspace members other than `/api/chat`, which always runs a pipeline turn.

### Gaps
- `fusion.js` (RRF k constant, pool size) was not read in detail.

## 4. LLM layer: structured output, tool calls, batch calls, and BYO secrets

### Takeaway
LLM calls go directly through Vercel AI SDK v7 provider packages on the customer's own keys. Structured output (`Output.object` with zod) is already used internally for graph extraction and the eval judge. Tool calling is not supported anywhere and is explicitly rejected on the OpenAI-compatible endpoint. "Batch" exists only as in-process bounded concurrency, not provider batch APIs. Secrets live in Supabase Vault, readable only by the service role per project.

### Cited Findings
- **Model construction.** `buildLanguageModel(conn, modelId)` covers the openai (Responses, or chat for custom URLs), anthropic, google and openai_compatible (OpenRouter and others) formats.
- **Resolution.** `resolveModel({admin, projectId, config})` resolves a pipeline's model. `getProcessingModel` reads `project_settings.processing_provider_id/processing_model`; that model is used for graph extraction, contextual enrichment and the eval judge. Grey-hosted models throw `hosted_unavailable`.
- Source for both bullets: [lib/engine/llm.js](C:/Pro/geiger-grey/lib/engine/llm.js).
- **Capabilities per provider kind** are chat, embed, rerank and transcribe. Examples: openai has chat/embed/transcribe, anthropic chat only, cohere and voyage embed/rerank, nomic embed, assemblyai transcribe; openai_compatible capabilities are user-picked — [lib/grey/provider_kinds.js](C:/Pro/geiger-grey/lib/grey/provider_kinds.js).
- **Structured output.**
  - Graph extraction: `generateText({ output: Output.object({ schema: extractionSchema, name: "knowledge_graph" }) })`. On `NoObjectGeneratedError` it parses loose JSON from the raw text, then sanitizes — [lib/engine/graph_extract.js](C:/Pro/geiger-grey/lib/engine/graph_extract.js) `extractBatch`, `parseLooseJson`.
  - Eval judge: uses the same pattern (`Output.object`, name `eval_judgement`, `buildJudgeSchema`) at temperature 0 when the model supports it — [lib/engine/eval_runner.js](C:/Pro/geiger-grey/lib/engine/eval_runner.js) `judgeAnswer`; [lib/grey/eval_metrics.js](C:/Pro/geiger-grey/lib/grey/eval_metrics.js).
- **Tool calls.** The OpenAI-compatible request parser rejects `tools`, `functions`, `tool_choice` and `function_call` with "Tools aren't supported by Grey pipelines." No answer path uses tools — [lib/grey/openai_frames.js](C:/Pro/geiger-grey/lib/grey/openai_frames.js) lines 51–55; [lib/engine/answer.js](C:/Pro/geiger-grey/lib/engine/answer.js).
- **response_format.** A grep for `response_format` in [lib/grey/openai_frames.js](C:/Pro/geiger-grey/lib/grey/openai_frames.js) found nothing, so JSON mode is not handled on `/chat/completions`.
- **Batching and concurrency.**
  - `batchByTokens` and `runOrdered` (ordered, bounded concurrency, stop on fatal) — [lib/grey/batch.js](C:/Pro/geiger-grey/lib/grey/batch.js).
  - Enrichment concurrency 4; graph 3; eval 2 cases at a time.
  - Embeddings at most 3 requests in flight, with retries on 429/5xx — [lib/engine/embeddings.js](C:/Pro/geiger-grey/lib/engine/embeddings.js).
  - No provider batch API (e.g. discounted async batch endpoints) is called anywhere in `lib/engine`.
- **Secrets.**
  - `grey.set_provider_secret` / `grey.get_provider_secret` store and read Vault secrets named `grey_provider_<id>`, scoped to the provider's project, service role only.
  - Trigger `model_providers_secret_guard` stops clients writing `secret_id`/`key_last4` ([20261018120000_providers_byo.sql](C:/Pro/geiger-grey/supabase/migrations/20261018120000_providers_byo.sql)).
  - `connectProvider` loads the row, checks the capability, SSRF-checks custom base URLs (`assertPublicBaseUrl`, `providerFetch`) and returns the key for one call only ([lib/engine/secrets.js](C:/Pro/geiger-grey/lib/engine/secrets.js)).
- **Errors.** `mapLlmError` maps provider errors to safe codes; `provider_auth` marks the provider `status='error'` — [lib/engine/answer.js](C:/Pro/geiger-grey/lib/engine/answer.js) `markProviderError`; [lib/grey/llm_errors.js](C:/Pro/geiger-grey/lib/grey/llm_errors.js).
- **Design decisions.** D4: "The customer" pays for every AI call. D7: the AI SDK is called directly, never through AI Gateway, because "its BYOK fallback bills the platform account" — [backend spec §2](C:/Pro/geiger-grey/docs/superpowers/specs/2026-10-17-grey-backend-design.md).

### Inferences
- The `extractBatch` pattern (structured output, loose-JSON fallback, sanitize, fatal-error short-circuit) is a ready template for classification and schema extraction. What's missing is dynamic, user-defined schemas: today's schemas are static zod objects in code.
- Any new LLM feature should default to the project processing model, as graph, enrichment and the judge do, and fail gracefully with "Set a processing model in Settings → General." when none is set.

### Gaps
- I did not verify which AI SDK v7 helper converts a user-supplied JSON Schema to an `Output.object` schema; the code only uses zod.

## 5. Delivery surfaces: what each endpoint accepts and returns, and the MCP tools

### Takeaway
There are five live surfaces: the session-authenticated Playground chat, three API-key v1 routes scoped to a published pipeline (retrieve, OpenAI chat/completions, models), a per-server MCP endpoint with four read-only tools, and a public widget (config and chat). Keys have only three scopes (`retrieve`, `chat`, `mcp`). Every surface is question→answer or query→chunks; none performs a task such as classify, extract or generate.

### Cited Findings
- **`POST /api/v1/pipelines/[pipelineId]/retrieve`**
  - Bearer key with scope `retrieve`.
  - Body: `{ query (1–8000), topK? (1–50), threshold? (0–1), kbIds? (subset of the pipeline's) }`.
  - Returns `{ object: "retrieval", pipelineId, version, query, chunks }`.
  - Logged to request_logs and billed one `retrieval`; maxDuration 60.
  - Source: [route.js](C:/Pro/geiger-grey/app/api/v1/pipelines/[pipelineId]/retrieve/route.js).
- **`POST /api/v1/pipelines/[pipelineId]/chat/completions`**
  - Scope `chat`; OpenAI-compatible `messages`, `stream`, `stream_options.include_usage`, `temperature`, `max_tokens`, `user`.
  - `model` is ignored and echoed as `grey/<pipelineId>@v<n>`.
  - Non-stream responses return `chat.completion` plus a `citations` extension. SSE streams send citations in the first and final chunk.
  - No conversations rows are written; maxDuration 300.
  - Source: [route.js](C:/Pro/geiger-grey/app/api/v1/pipelines/[pipelineId]/chat/completions/route.js).
- **`GET /api/v1/pipelines/[pipelineId]/models`** returns a single model entry ([route.js](C:/Pro/geiger-grey/app/api/v1/pipelines/[pipelineId]/models/route.js)). Any other `/api/v1/*` path returns an OpenAI-style 404 ([route.js](C:/Pro/geiger-grey/app/api/v1/[...path]/route.js)).
- **Key auth.** `authenticateApiKey(request, { scope, projectId, pipelineId, requiredKeyId })`: SHA hash lookup, `evaluateKey` (revoked, expired, scope, pipeline allow-list), a Postgres rate limit `key:<id>` per minute, and `X-RateLimit-*` headers — [lib/server/api_key_auth.js](C:/Pro/geiger-grey/lib/server/api_key_auth.js).
- **Key creation.** `POST /api/api-keys` allows only `ALLOWED_SCOPES = ["retrieve", "chat", "mcp"]`, pipelineIds, rateLimitPerMin 1–10000 (default 60) and expiresAt — [app/api/api-keys/route.js](C:/Pro/geiger-grey/app/api/api-keys/route.js).
- **`/api/mcp/[serverId]` (GET/POST/DELETE)**
  - Stateless MCP via `@modelcontextprotocol/server` 2.3.1 `createMcpHandler` (legacy stateless fallback); key scope `mcp`, optionally bound to `api_key_id`; `tools/call` logged as channel `mcp`.
  - Tools, registered only when enabled in `mcp_servers.tools`, all `readOnlyHint`, each returning text plus `structuredContent`:
    - `search { query, topK? ≤ 20 }` → `{ results: [chunk…] }`
    - `ask { question }` → `{ answer, citations, noContext, pipelineId, version }` (published pipeline, non-stream)
    - `get_entity { id | name }` → `{ entity: { id, name, type, mentions, relations } }` (aliases, description and properties deliberately withheld)
    - `list_sources { kbId?, limit? ≤ 100, cursor? }` → `{ sources, nextCursor }`
  - Sources: [app/api/mcp/[serverId]/route.js](C:/Pro/geiger-grey/app/api/mcp/[serverId]/route.js); [lib/server/mcp/server.js](C:/Pro/geiger-grey/lib/server/mcp/server.js); [lib/server/mcp/tools.js](C:/Pro/geiger-grey/lib/server/mcp/tools.js).
- **Widget**
  - `GET /api/widget/[widgetId]/config` returns the public theme, gated on domain allow-list, enabled widget, live key and published pipeline.
  - `POST /api/widget/[widgetId]/chat` takes `{ message ≤ 2000, visitorId uuid, conversationId? }` and streams SSE events `meta`/`delta`/`done`/`error`.
  - Limits: 10 messages of history, 50 turns, 10/min per visitor (hashed IP + widget).
  - Sources: [config/route.js](C:/Pro/geiger-grey/app/api/widget/[widgetId]/config/route.js); [chat/route.js](C:/Pro/geiger-grey/app/api/widget/[widgetId]/chat/route.js); `public/widget.js` per spec §12.4.
- **`POST /api/chat` (Playground)**
  - Requires `grey.playground.view`; body `{ projectId, pipelineId, content ≤ 8000, conversationId?, overrides }`.
  - Uses the draft pipeline config, stores conversations/messages (12-message history), and writes request_logs (channel `playground`) and usage.
  - Returns streamed events (e.g. `type: "start"`) or a non-stream reply.
  - Source: [app/api/chat/route.js](C:/Pro/geiger-grey/app/api/chat/route.js).
- **Other routes:** `/api/providers/[id]/secret` and `/test` (one real call per capability), `/api/embeddings/detect` (embeds "ping" to learn dims), `/api/sources/[id]/media-url` — [app/api/](C:/Pro/geiger-grey/app/api/).
- **Delivery logging.** `logDelivery` writes a `request_logs` row (no chunk content, only ids/scores/ranks), a `retrieval` usage event at `PRICE_PER_RETRIEVAL = 0.001` when billed, and an `llm_tokens` event at cost 0 (BYOK) — [lib/server/delivery_log.js](C:/Pro/geiger-grey/lib/server/delivery_log.js); [lib/grey/cost.js](C:/Pro/geiger-grey/lib/grey/cost.js).

### Inferences
- The MCP tool registry (a `TOOLS` map, enable switches stored in `mcp_servers.tools`, `wrap` error handling, `record` logging) makes adding tools cheap. New tools would need entries in `MCP_TOOL_NAMES` and in the Delivery UI's tool switch definitions.
- New task endpoints can copy the `/retrieve` route skeleton: `authenticateApiKey`, `resolvePipelineConfig` or a KB boundary, `scheduleDeliveryLog`, and JSON in and out. They would need new key scopes in `ALLOWED_SCOPES` / `evaluateKey`, plus a new `request_logs.channel` or `metadata.endpoint` value.

### Gaps
- The exact `/api/chat` stream framing (SSE vs NDJSON) and `public/widget.js` were not read in full.

## 6. Quality and usage tooling: what is measured and metered?

### Takeaway
Quality has two parts. Evals use LLM-judged faithfulness, answer relevance, context precision and context recall over versioned pipelines. Feedback consists of thumbs, notes and "unanswered" flags on messages, with resolve and promote-to-eval-case. Metering records quantities for every operation but charges only for Grey's own work (parsed pages and retrievals); BYOK model work is recorded at cost 0. A monthly soft cap can alert (stored only, nothing is sent), switch chat to retrieval-only, or pause ingestion.

### Cited Findings
- **Eval runs.** A run is claimed through the `eval` worker queue. Each case goes through `runPipelineTurn` (channel `eval`, non-stream, 2 at a time) and is judged on the processing model with structured output. Results go to `eval_results {answer, scores, metadata}`. `eval_runs.metrics` stores null-ignoring means of `faithfulness, answerRelevance, contextPrecision, contextRecall` plus cases/failed. Reclaimed runs resume from results already written (`loadResults`) — [lib/engine/eval_runner.js](C:/Pro/geiger-grey/lib/engine/eval_runner.js); [lib/grey/eval_metrics.js](C:/Pro/geiger-grey/lib/grey/eval_metrics.js) `METRIC_KEYS`, `judgePlan`, `scoreCase`.
- **Eval usage.** Evals record `llm_tokens` per stage (answer, judge) at cost 0 with `metadata { byok, purpose: "eval", stage, model, provider, pipelineId, evalSetId }` and write no request_logs — [lib/engine/eval_runner.js](C:/Pro/geiger-grey/lib/engine/eval_runner.js) `recordEvalUsage`.
- **Usage helpers.** `recordUsage`, `getCapState` (`{spend, cap, behavior, reached}` via `project_month_spend`), `recordRequestLog` (drops query and retrieved when `log_queries=false`), and `toRetrievedLog` — [lib/engine/usage.js](C:/Pro/geiger-grey/lib/engine/usage.js).
- **Ingestion metering.** `page` cost uses the per-tier price (fast 0.002 / balanced 0.006 / high 0.02); `media_minute`, `contextual_tokens`, `graph_tokens` and `llm_tokens` are BYOK kinds at cost 0. There is one usage row per (job, kind) with first/add merge rules — [lib/grey/billing.js](C:/Pro/geiger-grey/lib/grey/billing.js); [lib/grey/cost.js](C:/Pro/geiger-grey/lib/grey/cost.js).
- **Unused kind.** `storage_gb` is allowed by the `usage_events` check constraint and labelled in the Usage UI ([components/internal/screens/usage/constants.js](C:/Pro/geiger-grey/components/internal/screens/usage/constants.js)), but no writer was found in `lib`, `worker` or `app` (grep).
- **Caps.** `pause_ingestion` stops the worker claiming (`ingestion_paused` in `claim_ingestion_job`), and `retrieval_only` returns passages without generation. For `alert`, "sending alerts out of scope" — [backend spec §11](C:/Pro/geiger-grey/docs/superpowers/specs/2026-10-17-grey-backend-design.md); [20261018120100_worker_queue.sql](C:/Pro/geiger-grey/supabase/migrations/20261018120100_worker_queue.sql); [lib/engine/turn.js](C:/Pro/geiger-grey/lib/engine/turn.js).
- **Feedback.** `listFeedback`-style queries select assistant messages with `feedback not null or unanswered = true` ([lib/supabase/conversations.js](C:/Pro/geiger-grey/lib/supabase/conversations.js)). The Feedback screen offers Open conversation, Add to eval set, Resolve and Reopen ([components/internal/screens/quality/feedback.jsx](C:/Pro/geiger-grey/components/internal/screens/quality/feedback.jsx)).

### Inferences
- The eval data model (set → cases; run → results with `scores jsonb`; worker queue with resume) has the same shape as a document×question grid or a labelled-test-set for classifiers. It can be reused as a pattern, or extended with a `kind` column, rather than inventing a new job model.
- New features can meter without a migration by recording `llm_tokens` with `metadata.purpose` (as evals do). A distinct Grey-charged unit (like `retrieval`) would need the `usage_events.kind` check extended.

### Gaps
- `quality/evaluations.jsx` was skimmed only for labels; the full run-detail view (per-case results) was not inspected.

## 7. UI: which screens are "coming soon", and what does each let users do today?

### Takeaway
All 24 nav items map to a real screen, so the `ComingSoonScreen` fallback is currently unused. The only "Coming soon" markers are inside ingestion settings: parent-child chunking, keyframes, and layout/OCR parsing. Every screen manages ingestion, graph, pipelines, delivery, quality, usage or settings. None presents knowledge as anything other than chunks, a graph, or chat.

### Cited Findings
- **Nav and registry.** `NAV_TREE` has nine sections: Overview; Knowledge Bases (All Knowledge Bases, Sources, Ingestion Jobs, Ingestion Presets); Knowledge Graph (Graph Explorer, Entities, Ontology); Playground (Chat, Conversations); Pipelines (All Pipelines, Model Providers); Delivery (API Keys, MCP Servers, Widgets); Quality (Evaluations, Feedback); Usage (Usage & Costs, Request Logs); Settings (General, Team & Members, Roles & Permissions, Navigation, Data Export). `SCREEN_REGISTRY` maps every title, and `getScreen` returns null (→ ComingSoon) only for unmapped titles — [lib/workspace/nav_tree.js](C:/Pro/geiger-grey/lib/workspace/nav_tree.js); [components/internal/screens/registry.jsx](C:/Pro/geiger-grey/components/internal/screens/registry.jsx); [coming_soon.jsx](C:/Pro/geiger-grey/components/internal/screens/coming_soon.jsx).
- **In-screen "Coming soon".** The "Parent-child chunking" and "Keyframes" switches are disabled, with the info line "Layout and OCR parsing are coming soon; documents are currently parsed as text." — [ingestion_settings_form.jsx](C:/Pro/geiger-grey/components/internal/screens/knowledge/ingestion_settings_form.jsx).
- **Overview.** Stats, weekly charts, top pipelines and an attention card with the items `failedSources`, `providerErrors`, `unanswered`, `unhelpful`, `reviewDue` and `draftPipelines` — [overview/overview.jsx](C:/Pro/geiger-grey/components/internal/screens/overview/overview.jsx); [lib/grey/overview_metrics.js](C:/Pro/geiger-grey/lib/grey/overview_metrics.js).
- **Knowledge bases.** Create a KB (embedding connection and dims locked). The detail view has these sections: Sources, a Chunks browser (paginated by KB/source, **no search**: `listChunks` filters only kbId/sourceId), Ingestion settings with "Re-ingest all", Activity, and Danger zone — [knowledge_base_detail.jsx](C:/Pro/geiger-grey/components/internal/screens/knowledge/knowledge_base_detail.jsx); [lib/supabase/chunks.js](C:/Pro/geiger-grey/lib/supabase/chunks.js).
- **Sources.**
  - Cross-KB table with In progress / Needs review / Ready stats.
  - Freshness badges: Verified / Review due / Stale / Not verified, derived from `verified_at`/`review_due_at`.
  - Upload dialog: Upload, Import from Assets or Notes, Add URL, with a cost estimate.
  - Row actions: Open, Re-ingest, Mark verified, Owner & review date, Download, Delete.
  - Sources: [sources/sources.jsx](C:/Pro/geiger-grey/components/internal/screens/sources/sources.jsx); [sources_table.jsx](C:/Pro/geiger-grey/components/internal/screens/sources/sources_table.jsx); [constants.js](C:/Pro/geiger-grey/components/internal/screens/sources/constants.js) (freshness); [freshness_dialog.jsx](C:/Pro/geiger-grey/components/internal/screens/sources/freshness_dialog.jsx); [upload_sources_dialog.jsx](C:/Pro/geiger-grey/components/internal/screens/sources/upload_sources_dialog.jsx).
- **Ingestion Jobs and Presets.** The jobs table shows stage, progress and estimated vs actual cost, with retry and cancel. Presets: four system presets plus custom ones — [sources/ingestion_jobs.jsx](C:/Pro/geiger-grey/components/internal/screens/sources/ingestion_jobs.jsx); [knowledge/ingestion_presets.jsx](C:/Pro/geiger-grey/components/internal/screens/knowledge/ingestion_presets.jsx).
- **Graph.**
  - Explorer: 2D/3D force graph with an entity panel that supports add/remove relation and "Ask about this", which opens the Playground prefilled.
  - Entities: CRUD plus a "Possible duplicates" tab with Merge (`kg_merge_entities`).
  - Ontology: CRUD for entity and relation types.
  - Sources: [graph/](C:/Pro/geiger-grey/components/internal/screens/graph/); [lib/supabase/graph.js](C:/Pro/geiger-grey/lib/supabase/graph.js); [lib/grey/duplicates.js](C:/Pro/geiger-grey/lib/grey/duplicates.js).
- **Playground.** Chat with a conversation rail; run settings show the pipeline and allow session overrides for temperature and topK; a context panel shows the passages sent and the token budget used; citations, thumbs and unanswered flags. Conversations shows read-only transcripts across channels — [playground/](C:/Pro/geiger-grey/components/internal/screens/playground/); [lib/grey/playground.js](C:/Pro/geiger-grey/lib/grey/playground.js).
- **Pipelines.** Detail sections: Model, Retrieval, Prompt, Versions (publish), Endpoints. Model Providers: connect, key, test — [pipelines/](C:/Pro/geiger-grey/components/internal/screens/pipelines/).
- **Delivery.** API Keys (create/reveal/revoke), MCP Servers (KBs, pipeline, key, tool switches, client snippets), Widgets (theme, domains, embed snippet) — [delivery/](C:/Pro/geiger-grey/components/internal/screens/delivery/).
- **Quality.** Evaluations (sets, cases, "Run evaluation", run metrics) and Feedback (resolve, add to eval set) — [quality/](C:/Pro/geiger-grey/components/internal/screens/quality/).
- **Usage.** Usage & Costs shows spend MTD, soft cap, behavior, alert emails, daily cost by kind, and a breakdown; Request Logs shows a per-request trace — [usage/](C:/Pro/geiger-grey/components/internal/screens/usage/).
- **Settings.**
  - General: Models (processing and transcription), Ingestion defaults, Retention & logging.
  - Team & Members, Roles & Permissions, Navigation.
  - Data Export: builds JSON client-side for KBs+sources, Chunks, Graph, Conversations and Eval sets.
  - Sources: [settings/](C:/Pro/geiger-grey/components/internal/screens/settings/); [data_export.jsx](C:/Pro/geiger-grey/components/internal/screens/settings/data_export.jsx).
- **RBAC.** Permission keys include `grey.kb.manage`, `grey.source.upload/delete`, `grey.ingestion.run`, `grey.preset.manage`, `grey.graph.edit`, `grey.ontology.manage`, `grey.pipeline.manage/publish`, `grey.provider.manage`, `grey.apikey.manage`, `grey.mcp.manage`, `grey.widget.manage`, `grey.eval.manage`, `grey.usage.manage`, `grey.export.run`, team keys and `grey.settings.manage` — [geiger-rbac.config.js](C:/Pro/geiger-grey/geiger-rbac.config.js).

### Inferences
- A new top-level area (e.g. "Tasks", "Labels", "Grids", "Reports") needs entries in `NAV_TREE`, `SCREEN_REGISTRY` and view permissions. The UI recipe (MainScreenWrapper → ScreenHeader → StatsBar → Toolbar → DataTable → Sheet/Dialog, optimistic mutations) is documented in the frontend spec §3.
- The Ontology screen (typed, colour-coded, CRUD, "blocked when in use") is the closest existing pattern for a label-set manager. The Evaluations sets/cases/runs screen is the closest pattern for grids.

### Gaps
- Several screens were inspected through label/toast greps rather than full reads (e.g. `source_sheet.jsx`, `request_logs.jsx`, `pipeline_detail.jsx`). Multi-row selection in `sources_table.jsx` was not verified.

## 8. Docs: roadmap, specs and plans that mention future features

### Takeaway
The docs consist of two specs, two plans and one competitor report. They describe only infrastructure and RAG future work: OCR, worker host, hosted models and quotas, more drivers, connectors, parent-child, keyframes, query rewriting, write-back of transcripts to Assets, and Forms-side UI. None of the non-chat feature families (classification, extraction, grids, artifacts, alerts, webhooks, workflows, batch jobs) appears in any Grey doc.

### Cited Findings
- **Backend spec §1, out of scope (this phase):**
  - Grey-paid AI and the hosted provider
  - layout/OCR/vision parsing
  - choosing the worker host
  - billing/Stripe
  - keyframe captioning
  - parent-child retrieval
  - `content` origin
  - external connectors (Drive, Notion)
  - follow-up query rewriting
  - transcript write-back to Assets
  - Forms-side UI for entity mapping
  - Source: [2026-10-17-grey-backend-design.md](C:/Pro/geiger-grey/docs/superpowers/specs/2026-10-17-grey-backend-design.md).
- **Backend spec §20, open items:**
  - worker host (Railway / Fly / own VPS)
  - OCR service on the VPS
  - Grey hosted
  - media/graph pricing in the estimate UI
  - unverified facts
  - more driver formats (Azure OpenAI, Bedrock, Vertex, Deepgram)
- **Backend spec §21, later:** `grey_hosted` connections per capability and "quotas per usage kind … enforced at the two existing choke points: the worker's job claim … and `runPipelineTurn`'s cap check."
- **Backend spec §10.5, Forms:** "Forms repo work (not this build): an `entity_mapping` setting per form; call the RPC from `runSubmissionEffects` / `runEditEffects`."
- **Backend spec §11:** cap `alert` → "proceeds (sending alerts out of scope)".
- **Frontend spec:** Grey is "the suite's knowledge layer … serve it to their own LLM/apps through Pipelines, API keys, MCP servers and widgets". Out of scope there: workers, pgvector, real LLM calls, MCP/widget runtime, billing/Stripe, external connectors — [2026-10-10-grey-frontend-design.md](C:/Pro/geiger-grey/docs/superpowers/specs/2026-10-10-grey-frontend-design.md).
- **Competitor report positioning (headings only):** "Sell suite context, not RAG plumbing"; "Buyers buy applications, and suites now give workspace Q&A away"; "Serve every knowledge base three ways…"; "The suite is the connector moat that RAG APIs cannot copy" — [reports/RAG platform competitor research.md](C:/Pro/geiger-grey/reports/RAG%20platform%20competitor%20research.md).
- **Worker hosting.** The worker ships host-agnostic (Dockerfile plus `npm run worker`); "Worker host: Deferred" (D3) — backend spec §2, §5.6; [Dockerfile.worker](C:/Pro/geiger-grey/Dockerfile.worker).

### Inferences
- The competitor report's "buyers buy applications" and "suite context" framing supports non-chat applications (grids, artifacts, workflow steps into Flow) as the differentiation path. No internal spec has started them.
- Every worker-based feature (batch, scheduled, extraction jobs) inherits the unresolved worker-host decision.

### Gaps
- The competitor report was skimmed only at heading level (as instructed). The plans (`plans/*.md`) were grepped for future items, not read in full.

## 9. Integration hooks: webhooks, events, notifications and cross-suite links

### Takeaway
Cross-suite integration is inbound only:
- Grey reads Assets files and Notes boards into sources.
- Forms can push entities into the graph through a service-role RPC, but the Forms side is not built.
- `@geiger/notify` is used only to display the suite notification bell.

There are no webhooks, no outbound events, no scheduler, no email sender and no Flow integration. `alert_emails` and `retention_days` are stored but nothing acts on them.

### Cited Findings
- **Assets import.** `listImportableAssets` reads `assets.assets` (stored files) for the picker. The worker fetches bytes through Assets' internal `read-url` endpoint (`ASSETS_INTERNAL_URL`, `GEIGER_INTERNAL_TOKEN`) — [lib/supabase/suite_imports.js](C:/Pro/geiger-grey/lib/supabase/suite_imports.js); backend spec §6.1, §9.4.
- **Notes import.** `listImportableNotes` reads `notes.project_boards`. The worker renders board nodes and edges to Markdown (`loadNotesBoard`, [worker/ingest/parse/notes_board.mjs](C:/Pro/geiger-grey/worker/ingest/parse/notes_board.mjs)) — [lib/supabase/suite_imports.js](C:/Pro/geiger-grey/lib/supabase/suite_imports.js); [worker/db.mjs](C:/Pro/geiger-grey/worker/db.mjs).
- **Forms push.** `grey.upsert_form_entity(p_project_id, p_form_id, p_submission_id, p_entities, p_relations)` is service role only. It matches on identity (link row → email → domain → exact name); `replace` closes old Forms relations via `valid_to`; Forms entities never surface through retrieval — [20261018120300_graph_extraction.sql](C:/Pro/geiger-grey/supabase/migrations/20261018120300_graph_extraction.sql).
- **Notifications.** `@geiger/notify` is a dependency used in `NotificationsBell` (`NotificationBell` from `@geiger/notify/react`), which reads the `notify` schema owned by geiger-dash and hides itself when that schema isn't exposed. No Grey code writes notifications (grep for `geiger/notify|notif` outside node_modules) — [components/internal/topbar/notifications_bell.jsx](C:/Pro/geiger-grey/components/internal/topbar/notifications_bell.jsx); [package.json](C:/Pro/geiger-grey/package.json).
- **Internal events.** The only event mechanism is `pg_notify('grey_jobs', 'ingestion:<id>' | 'eval:<id>')`, which wakes the worker. The worker also runs a 10-minute janitor interval (orphan staged-chunk cleanup) — [20261018120100_worker_queue.sql](C:/Pro/geiger-grey/supabase/migrations/20261018120100_worker_queue.sql); [worker/index.mjs](C:/Pro/geiger-grey/worker/index.mjs) `JANITOR_MS`; [worker/loop.mjs](C:/Pro/geiger-grey/worker/loop.mjs) `createPgListener`.
- **Absences:**
  - A grep for `webhook` in application code found no implementation.
  - `alert_emails` is only stored and edited ([lib/supabase/project_settings.js](C:/Pro/geiger-grey/lib/supabase/project_settings.js); usage screen).
  - `retentionDays` appears only in the settings data layer (grep "retention").
  - A grep for "resend" in app/lib/worker code found nothing.
  - The only "geiger-flow" reference is a UI-pattern comment in [chat_kit.jsx](C:/Pro/geiger-grey/components/internal/screens/playground/chat_kit.jsx).
- **Graph Explorer "Ask about this"** links to the Playground with a prefilled question (`?q=`) — frontend spec §3; [entity_panel.jsx](C:/Pro/geiger-grey/components/internal/screens/graph/entity_panel.jsx).

### Inferences
- Alerts and notifications have a natural in-suite target: rows in the `notify` schema, which the bell already reads. This needs a server-side writer and confirmation of the `notify` table contract in geiger-notify/geiger-dash.
- The worker's janitor timer and LISTEN loop are the obvious place for a scheduler. A `schedules` table claimed with the same lease pattern would avoid a separate cron service.

### Gaps
- The `notify` schema's table structure and write API (owned by geiger-dash and geiger-notify) were not inspected. Whether Flow, Notes or Assets expose write APIs Grey could call was not checked; those repos are outside scope.

## 10. Gap mapping: what each candidate feature family reuses and what it needs

### Takeaway
Grey already has strong reusable primitives:
- a lease-based worker queue with resume and per-project concurrency
- an LLM-free hybrid `searchChunks`
- a structured-output extraction pattern on the processing model
- an eval set/run/result model shaped like a grid
- API-key auth with rate limiting and delivery logging
- an extensible MCP tool registry
- BYOK metering
- source-level verification fields

Four foundational pieces are missing across every family:
1. source- or metadata-scoped retrieval
2. a generic task/job table, with a worker queue, for typed LLM tasks over many sources
3. tables for derived outputs (labels, fields, artifacts) with provenance and review state
4. any outbound event, notification, schedule or webhook channel

### Cited Findings
- **Queue extension point.** A queue is `{ name, leaseMs, claim(), run(job, {signal}), heartbeat(job), release(job) }`, and `createQueues` assembles the ingestion and eval queues — [worker/queues.mjs](C:/Pro/geiger-grey/worker/queues.mjs). Claiming is done by SQL lease functions with advisory locks, attempts, run_after backoff, per-project limits and notify triggers — [20261018120100_worker_queue.sql](C:/Pro/geiger-grey/supabase/migrations/20261018120100_worker_queue.sql).
- **Bulk job creation.** `createJobs(projectId, jobs)` bulk-inserts ingestion jobs ([lib/supabase/ingestion_jobs.js](C:/Pro/geiger-grey/lib/supabase/ingestion_jobs.js)). It is used by "Re-ingest all" ([knowledge_base_detail.jsx](C:/Pro/geiger-grey/components/internal/screens/knowledge/knowledge_base_detail.jsx) `reingestAll`) and the upload dialog.
- **Filters.** Retrieval filters only by KB set ([20261018120200_retrieval.sql](C:/Pro/geiger-grey/supabase/migrations/20261018120200_retrieval.sql)).
- **Derived-output tables.** Beyond graph entities/relations and the per-chunk `metadata.context`, no tables exist for labels, fields or artifacts (migration list §1).
- **Write-back.** None to suite apps. "Transcript write-back to Assets" is explicitly out of scope (backend spec §1).

### Inferences

#### (a) Classification and labelling against a label set
- **Reuses:**
  - Processing model and graceful degrade — `getProcessingModel` in [lib/engine/llm.js](C:/Pro/geiger-grey/lib/engine/llm.js).
  - Structured output, loose-JSON fallback and token batching — `extractBatch` in [lib/engine/graph_extract.js](C:/Pro/geiger-grey/lib/engine/graph_extract.js); [lib/grey/batch.js](C:/Pro/geiger-grey/lib/grey/batch.js).
  - An ingestion-stage hook gated by a preset flag — `graphStage` in [worker/ingest/run.mjs](C:/Pro/geiger-grey/worker/ingest/run.mjs).
  - Typed, coloured, project-scoped vocabularies, as a pattern — `kg_types` plus the Ontology screen ([ontology.jsx](C:/Pro/geiger-grey/components/internal/screens/graph/ontology.jsx)).
  - Embedding similarity for zero/few-shot (label-description or exemplar vectors compared through `match_chunks_vector`).
  - BYOK usage rows — `byokUsage` in [lib/grey/billing.js](C:/Pro/geiger-grey/lib/grey/billing.js).
  - Evals as an accuracy harness pattern.
- **Needs:**
  - `label_sets`/`labels` tables.
  - An assignment table at source and/or chunk level (label_id, confidence, method, model, rationale/evidence chunk refs, review status, reviewed_by).
  - A new ingestion stage, or a separate task queue, and the `stage` check extension.
  - A preset config key such as `classify`.
  - Label filters/facets in `match_chunks_*` and `searchChunks`.
  - UI: a label-set manager, a label column and filter in Sources, a review queue.
  - API and MCP: a `classify` endpoint or tool with a new key scope.
  - Handling chunk-id churn on re-ingest (anchor labels at source level, or recompute after the swap).

#### (b) Schema extraction and document×question grids
- **Reuses:**
  - Structured output — [graph_extract.js](C:/Pro/geiger-grey/lib/engine/graph_extract.js).
  - Grounded per-question answers with `[n]` citations — `runPipelineTurn`/`generateAnswer`, `mapCitations` in [lib/grey/citations.js](C:/Pro/geiger-grey/lib/grey/citations.js).
  - Eval tables and runner as the grid pattern (rows = cases or sources, columns = questions, cells = `eval_results`-like rows with `scores`/`metadata`, resumable) — [eval_runner.js](C:/Pro/geiger-grey/lib/engine/eval_runner.js).
  - Whole-source chunk listing by `sourceId` — [lib/supabase/chunks.js](C:/Pro/geiger-grey/lib/supabase/chunks.js); `liveChunks` in [worker/db.mjs](C:/Pro/geiger-grey/worker/db.mjs).
  - The cached parse for full-document text.
  - `kg_entities.properties` for entity-level fields.
  - Data Export's client-side JSON download pattern.
- **Needs:**
  - Source-scoped retrieval (a `p_source_ids` filter).
  - User-defined schemas: a JSON Schema to AI SDK schema bridge, plus a `extraction_schemas` table.
  - `grids`, `grid_columns` (question or field, type, instructions) and `grid_cells` (value jsonb, citations, confidence, status, verified_by) tables.
  - A worker queue for grid runs, with cost preview.
  - CSV/XLSX export.
  - A grid UI screen with the citation popover from `chat_kit`.
  - A strategy for long documents beyond the 6000-token context budget (map-reduce over chunks).

#### (c) Generated artifacts and templates (briefs, FAQs, quizzes)
- **Reuses:**
  - Pipelines as the template carrier (system_prompt, model, retrieval config, publish/versioning) — [pipeline_config.js](C:/Pro/geiger-grey/lib/engine/pipeline_config.js).
  - Grounded non-stream generation with citations and the knowledge-only guard — [answer.js](C:/Pro/geiger-grey/lib/engine/answer.js).
  - Graph facts for entity briefs — `kg_expand` facts; the `get_entity` tool.
  - Conversations/messages storage, Feedback and evals for quality.
  - Source `updated_at` and `metadata.ingest.at` for staleness detection.
- **Needs:**
  - `artifact_templates` and `artifacts` tables (type, inputs, content, citations, source set, status, version, stale flag).
  - Multi-step or map-reduce generation over many chunks or sources (today: topK ≤ 50 and a 6000-token context).
  - A worker job type for long generations.
  - Renderers and exports (Markdown, PDF, DOCX) and write-back to Notes or Assets.
  - An artifacts UI.
  - A regenerate-on-source-change trigger.

#### (d) Search UI, similarity, dedup, clustering and analytics
- **Reuses:**
  - LLM-free `searchChunks` with hybrid search, rerank and graph — [retrieval.js](C:/Pro/geiger-grey/lib/engine/retrieval.js).
  - HNSW and FTS indexes.
  - `sources.content_hash` for exact-duplicate detection.
  - Entity dedup (`duplicates.js`, the trigram index, `kg_merge_entities`).
  - Query analytics data: `request_logs.query` and `retrieved` (chunk/source ids, ranks, via), plus `messages.unanswered`/`feedback`.
  - Aggregation helpers and charts — [overview_metrics.js](C:/Pro/geiger-grey/lib/grey/overview_metrics.js); [overview/charts.jsx](C:/Pro/geiger-grey/components/internal/screens/overview/charts.jsx).
- **Needs:**
  - A member-facing search route (session auth, no pipeline required) and a Search screen with facets (KB, kind, origin, date, labels) and source preview.
  - Source-level vectors or centroids for "similar documents".
  - Near-duplicate detection jobs.
  - Clustering jobs with `clusters`/`cluster_members` tables and LLM cluster naming. pgvector has no clustering, so this would be worker-side and per embedding group.
  - Content and coverage analytics: top-retrieved sources, never-retrieved sources, unanswered-topic clustering.
  - The constraint that all of this is per embedding group, since dims and models differ across KBs.

#### (e) Alerts, webhooks and scheduled jobs
- **Reuses:**
  - The `pg_notify` trigger pattern and the worker LISTEN loop; the janitor interval as a scheduler seed — [worker/index.mjs](C:/Pro/geiger-grey/worker/index.mjs); [worker/loop.mjs](C:/Pro/geiger-grey/worker/loop.mjs).
  - `project_settings.alert_emails` and `cap_behavior='alert'`.
  - Freshness fields (`review_due_at`) and the Overview "reviewDue" attention item.
  - The `@geiger/notify` bell, display only.
  - `url`-origin sources, which can be re-fetched.
  - The rate limiter (`rate_limit_hit`).
- **Needs:**
  - Webhook subscription tables (url, secret, events) with signing.
  - An outbox or event table fed by triggers on jobs, sources, eval runs and messages.
  - A delivery worker queue with retries.
  - A `schedules` table (cron, task type, next_run_at) claimed by the worker.
  - Saved-search or "watch" alerts evaluated after each chunk swap.
  - An email sender (none in code) and/or a writer into the `notify` schema.
  - Scheduled URL re-crawl.
  - Retention enforcement (`retention_days` is unenforced).
  - Cap-alert sending (out of scope per spec §11).

#### (f) Workflow-step / "task endpoint" APIs and richer MCP tools
- **Reuses:**
  - `authenticateApiKey` (scopes, pipeline allow-list, rate limit) — [api_key_auth.js](C:/Pro/geiger-grey/lib/server/api_key_auth.js).
  - `handleApi` and the `scheduleDeliveryLog` logging and billing — [delivery_log.js](C:/Pro/geiger-grey/lib/server/delivery_log.js).
  - Published, versioned pipeline snapshots for reproducibility.
  - The `/retrieve` route skeleton.
  - The MCP `TOOLS` registry, `enabledToolNames`, `structuredContent` and `wrap` — [lib/server/mcp/tools.js](C:/Pro/geiger-grey/lib/server/mcp/tools.js).
  - Structured output.
- **Needs:**
  - Task endpoints (classify, extract, summarize, compare, generate) returning typed JSON with citations.
  - Key scopes beyond `retrieve|chat|mcp` — [app/api/api-keys/route.js](C:/Pro/geiger-grey/app/api/api-keys/route.js).
  - `response_format` / JSON-mode support on chat/completions (currently unhandled) and possibly tool calling (currently rejected).
  - Async task submit and poll for work beyond `maxDuration` (60 s for retrieve, 300 s for chat/MCP).
  - Idempotency keys.
  - MCP write tools (add source, apply label, create artifact), plus MCP resources/prompts (only tools are declared: `capabilities: { tools: {} }` in [lib/server/mcp/server.js](C:/Pro/geiger-grey/lib/server/mcp/server.js)).
  - A Flow-side step or connector (no Flow integration exists).

#### (g) Batch operations over many sources
- **Reuses:**
  - Bulk job insert (`createJobs`) and "Re-ingest all".
  - Lease queue features: per-project concurrency (`p_max_per_project` default 2 for ingestion, 1 for eval), retries with backoff, heartbeat-driven cancellation, shutdown release.
  - Resumability (staged chunks; eval `loadResults`).
  - Per-job usage rows and `actual_cost`, plus the ingestion cost estimate — [lib/grey/cost.js](C:/Pro/geiger-grey/lib/grey/cost.js) `estimateFileCost`.
  - Cap enforcement at claim time (`ingestion_paused`) and the Ingestion Jobs progress UI.
- **Needs:**
  - A generic `task_runs`/`task_items` model (type, input jsonb, source selection, parent batch, aggregate progress and cost), since `ingestion_jobs` is tied to one source and `eval_runs` to one eval set.
  - Pre-run cost and token estimates for LLM tasks.
  - Batch API endpoints and selection UI.
  - Optional use of provider batch APIs for cheaper bulk LLM work (not used today).
  - Quota hooks per spec §21.

#### (h) Write-back and human verification
- **Reuses:**
  - Source verification: `owner_id`, `review_due_at`, `verified_at`, Mark verified, FreshnessDialog, the Overview attention item.
  - Answer feedback: thumbs, notes, unanswered, resolve, promote to eval case.
  - Manual graph curation: entity CRUD, relation add/remove, merge, `source_app='manual'`, `confidence`, temporal `valid_from/valid_to`.
  - The `member_activity` audit table.
  - The Forms push RPC as a precedent for another app writing structured facts in.
  - RBAC keys such as `grey.graph.edit`.
- **Needs:**
  - Review state (pending/approved/rejected, reviewer, timestamp, edited value) on every new derived output (labels, cells, artifacts).
  - A review-queue UI.
  - Corrections that survive re-ingest. Chunks are member read-only and hard-replaced by `swap_source_chunks`, so corrections must live outside `chunks`.
  - An entity verified flag.
  - Writing verification events to `member_activity`.
  - Outbound write-back to suite apps (create Notes boards, Assets files, Flow issues, Forms updates), none of which exists; Forms-side mapping is "not this build".
  - Using human-verified outputs as eval ground truth.

### Gaps
- I did not check whether the Flow, Notes, Assets or Forms repos expose write APIs or internal endpoints Grey could call for write-back or workflow steps.
- Whether the AI SDK v7 version pinned here (`ai` 7.0.143) supports provider batch APIs or JSON-Schema-defined `Output.object` was not verified in this research.
- Hosting constraints for long-running or scheduled work depend on the undecided worker host (spec D3, §20.1).
