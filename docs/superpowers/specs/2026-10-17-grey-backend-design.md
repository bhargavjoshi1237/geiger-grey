# Grey backend — design spec

**Date:** 2026-10-17
**Status:** Draft for review
**Builds on:** `2026-10-10-grey-frontend-design.md` (that phase stubbed processing; this phase replaces the stubs)
**Research basis:** `reports/RAG platform competitor research.md`

## 1. Goal and scope

Turn Grey from a UI over empty tables into a working product: a file uploaded to a knowledge base becomes searchable chunks, the Playground answers with real citations, and every knowledge base can be served through the v1 API, an MCP server and an embeddable widget. A knowledge graph is extracted automatically and used during retrieval.

**In scope**

1. A background **worker** service (ingestion + eval runs).
2. **Ingestion**: fetch → parse (text engines) → chunk → embed → graph, with atomic chunk swaps and retries.
3. **Retrieval**: pgvector + full-text hybrid search, RRF fusion, optional rerank, graph expansion.
4. **Generation**: answers from the customer's own LLM provider, streaming in the Playground, citations.
5. **Delivery**: API-key auth with rate limits, `/api/v1` retrieve + OpenAI-compatible chat, MCP server, widget runtime.
6. **Knowledge graph**: LLM extraction, entity resolution, graph-aware retrieval, Forms push RPC.
7. **Media**: transcript-first audio/video via AssemblyAI, timestamp citations, Assets imports.
8. **Eval runner**: LLM-judged faithfulness / relevance / context precision / recall.

**Out of scope (this phase)**

- Grey-paid AI accounts and the "Grey hosted" provider (switched off behind a flag, §4.4).
- Layout-aware / OCR / vision parsing — waits for the self-hosted OCR service (§6.4 defines the adapter only).
- Choosing the worker's host (the worker ships host-agnostic, §5.6).
- Billing / Stripe; keyframe captioning; parent-child retrieval; `content` origin; external connectors (Drive, Notion); follow-up query rewriting; transcript write-back to Assets; Forms-side UI for entity mapping.

## 2. Decisions taken

| # | Decision | Choice |
|---|---|---|
| D1 | Build order | Everything in one spec, built in phases (§19) |
| D2 | Worker runtime | Plain Node 24 process in `worker/`, sharing code with the app. Not Go (no AI SDK; best PDF library is AGPL), not a second Next app |
| D3 | Worker host | Deferred. Ship a Dockerfile + `npm run worker`; no host-specific config |
| D4 | Who pays for AI | **The customer.** Every AI call (LLM, embeddings, rerank, transcription) uses a provider the project connected in Model Providers. Grey ships no platform AI keys |
| D5 | Layout/OCR parsing | Deferred to a self-hosted OCR model on our VPS. This phase: text engines only + adapter interface |
| D6 | Assets imports | Included, via a small internal endpoint added to `geiger-assets` |
| D7 | LLM client library | Vercel AI SDK v7 provider packages, called **directly** (never through Vercel AI Gateway — its BYOK fallback bills the platform account). The AI SDK fits a multi-provider BYO product; Claude is reached through `@ai-sdk/anthropic` |
| D8 | Embeddings/rerank/transcription clients | Plain `fetch` adapters (small, fixed contracts; avoids AI SDK gaps around `output_dimension`) |
| D9 | Model attachment | **Everything is user-attachable through drivers** (§4): one driver per capability × wire format (OpenAI format, Anthropic format, Gemini format, Cohere format, Voyage, AssemblyAI). A user connects a provider, picks or types a model id, and it works — including self-hosted OpenAI-compatible servers (Ollama, vLLM, LM Studio, TEI) |
| D10 | Plans and quotas | Later. Once Grey's own infrastructure exists, Grey-run connections and per-plan quotas plug into the same driver registry and the existing usage metering (§21) |

## 3. Architecture

```
 Browser / API clients / MCP clients / embedded widget
                │
                ▼
 Grey Next app (Vercel) ────────────────────┐
   /api/chat          streaming Playground  │        Supabase (shared suite project)
   /api/v1/...        retrieve + OpenAI chat │──────► grey.* tables, pgvector (halfvec),
   /api/mcp/:id       MCP tools              │        tsvector FTS, pg_trgm, Vault,
   /api/widget/:id    public widget          │        grey-sources storage
   /api/providers/... real key tests         │              ▲
                │                            │              │ LISTEN grey_jobs + claim RPCs
                └── lib/engine/ ◄────────────┼──── Grey worker (Node 24, host TBD)
                    (shared runtime code)    │       ingestion: fetch→parse→chunk→embed→graph
                                             │       eval runs
 Customer-owned provider accounts: OpenAI · Anthropic · Google · OpenRouter ·
 OpenAI-compatible · Cohere · Voyage · AssemblyAI        (+ future: self-hosted OCR)
```

### 3.1 Code layout

| Folder | Holds | Rules |
|---|---|---|
| `lib/grey/` | **Pure** functions (chunker, fusion, prompt building, citations, graph schema/router, domain matching, URL guard, billing, model specs). Each has a `.test.js` | No I/O, no `server-only`, relative imports. Importable by UI, routes, worker, tests |
| `lib/engine/` (new) | **Server runtime shared by Next routes and the worker**: embeddings, rerank, retrieval, LLM resolution, answer generation, pipeline turn, graph extraction/expansion, transcription, enrichment, eval runner, usage recording | Relative imports only; **no** `server-only`, **no** `next/*`, **no** `@/` alias (the worker is plain Node). Every function takes an `admin` Supabase client as a parameter — modules never construct clients |
| `lib/server/` | Route-only helpers (auth, API-key auth, OpenAI formatting, SSE, CORS, delivery logging) | May use `next/*` and `@/`; never imported by the worker |
| `worker/` | Worker process, queue loop, ingestion stages, parsers | Own `package.json` (the root's `file:../geiger-notify` breaks `npm ci` in Docker). Shared deps (`ai`, `@ai-sdk/*`, `zod`, `pg`) pinned identically in both; a test asserts they match |

Secrets are read only inside `lib/engine/` from Vault at call time (§4.2) — never cached beyond one request/job, never logged.

## 4. Providers and accounts (customer-owned)

### 4.1 Drivers and provider connections

Every AI capability is reached through a **driver**: a small module implementing one capability for one wire format. A **provider connection** (a `grey.model_providers` row: kind + optional base URL + Vault key + model ids) says which drivers it can use. Users attach connections in Model Providers; nothing is hard-wired to a vendor.

**Capabilities and drivers**

| Capability | Interface (`lib/engine/`) | Drivers (wire formats) |
|---|---|---|
| `chat` | `llm.js` → AI SDK `LanguageModel` | `openai` (`@ai-sdk/openai`), `anthropic` (`@ai-sdk/anthropic`; base URL overridable for Anthropic-format gateways), `google` (`@ai-sdk/google`), `openai_compatible` (`@ai-sdk/openai-compatible`; any OpenAI Chat Completions server) |
| `embed` | `embeddings.js` → `embedTexts()` | `openai` format (`POST /embeddings`; OpenAI, Mistral, Together, Fireworks, Jina, Ollama, vLLM, LM Studio…), `cohere` (`POST /v2/embed`), `voyage` (`POST /v1/embeddings`), `google` (`batchEmbedContents`) |
| `rerank` | `rerank.js` → `rerank()` | `cohere` format (`POST /v2/rerank`; also Jina, TEI, vLLM, Infinity via base URL), `voyage` (`POST /v1/rerank`) |
| `transcribe` | `transcribe.js` → `transcribe()` | `assemblyai` (async URL submit + poll), `openai` format (`POST /audio/transcriptions`; OpenAI, Groq, self-hosted Whisper servers — upload limit enforced by the server, 25 MB on OpenAI) |
| `ocr` | `ocr.js` → `ocr()` | Interface only this phase; first driver is the self-hosted VPS model (§6.4) |

Drivers live in `lib/engine/drivers/<capability>/<format>.js`; each capability's interface module dispatches by format. Adding a vendor that speaks an existing format needs no code (a preset); adding a new format is one driver file.

**Provider kinds** — `grey.model_providers.provider` gains `cohere`, `voyage`, `assemblyai`. The pure registry `lib/grey/provider_kinds.js` declares, per kind, its capabilities, the driver format per capability, the default base URL, whether the base URL is editable, and suggested models:

| Kind | Capabilities → driver format | Base URL |
|---|---|---|
| `openai` | chat→openai, embed→openai, transcribe→openai | `https://api.openai.com/v1` (editable, e.g. Azure-style proxies) |
| `anthropic` | chat→anthropic | `https://api.anthropic.com/v1` (editable) |
| `google` | chat→google, embed→google | Gemini API default |
| `openrouter` | chat→openai_compatible | `https://openrouter.ai/api/v1` (fixed) |
| `openai_compatible` | **user-selected** subset of chat / embed / transcribe → openai format (stored in `metadata.capabilities`, default `['chat']`) | required |
| `cohere` (new) | embed→cohere, rerank→cohere | `https://api.cohere.com` (editable — Cohere-compatible rerank servers) |
| `voyage` (new) | embed→voyage, rerank→voyage | `https://api.voyageai.com/v1` |
| `assemblyai` (new) | transcribe→assemblyai | `https://api.assemblyai.com` |
| `grey_hosted` | — | Reserved for Grey-run connections (§21); unused now |

**Presets** (UI templates that prefill a connection; stored as one of the kinds above): Groq, Together, Fireworks, Mistral, DeepSeek, xAI, Ollama (`http://localhost:11434/v1`), vLLM, LM Studio → `openai_compatible` with base URL and suggested capabilities; Jina → `cohere` kind for rerank with `https://api.jina.ai/v1` (its embeddings via an `openai_compatible` connection). Anthropic presets list `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5`.

**Models per capability** — chat model ids stay in `model_providers.models`. Embedding, rerank and transcription models are chosen where they're used (KB, pipeline, settings) from the kind's suggestions or typed free-form ("Other model id").

UI: `pipelines/constants.js` `PROVIDERS` is rebuilt from `provider_kinds.js` (kinds + presets + capabilities). The provider dialog shows capability chips, the base URL field when editable/required, and — for `openai_compatible` — capability checkboxes. Every model picker lists only connections with the needed capability.

### 4.2 Secrets

New service-role-only function (the existing `set_provider_secret` writes; this reads):

```sql
create or replace function grey.get_provider_secret(p_provider uuid, p_project uuid)
returns text language plpgsql stable security definer
set search_path = public, grey, vault as $$
declare v text;
begin
  select ds.decrypted_secret into v
    from grey.model_providers mp join vault.decrypted_secrets ds on ds.id = mp.secret_id
   where mp.id = p_provider and mp.project_id = p_project and mp.deleted_at is null;
  return v;
end; $$;
revoke all on function grey.get_provider_secret(uuid, uuid) from public, anon, authenticated;
grant execute on function grey.get_provider_secret(uuid, uuid) to service_role;
```

`lib/engine/secrets.js` → `getProviderSecret({ admin, projectId, providerId })`. The key lives only in a local variable for the call.

**Real provider test** (`app/api/providers/[id]/test/route.js`, same auth flow as today): one minimal call per capability — chat: 1-token `generateText` with a 15 s timeout; embed: embed `"ping"`; rerank: rerank two strings; transcribe: `GET /v2/transcript?limit=1`. Writes `status ok|error`, `last_checked_at`, `metadata.lastError` (mapped code + message, never raw provider text). The secret route runs the same test right after saving a key (health check on save). A chat provider with no model ids → `error` "Add a model id to test."

### 4.3 Where each capability's provider is chosen

| Capability | Chosen on | Schema |
|---|---|---|
| Answer generation | Pipeline (existing provider + model) | unchanged |
| Embeddings | Knowledge base, at creation | `knowledge_bases.embedding_provider_id` (new) |
| Rerank | Pipeline retrieval settings | `pipelines.retrieval.rerankProviderId` (jsonb key) |
| Processing model (graph extraction, contextual enrichment, eval judge) | Settings → General | `project_settings.processing_provider_id`, `processing_model` (new) |
| Transcription | Settings → General | `project_settings.transcription_provider_id`, `transcription_model` (new); if null and the project has exactly one transcribe-capable connection, that one is used |

**Embedding configuration.** A KB stores `embedding_provider_id` (new), `embedding_model` (now the raw model id, e.g. `text-embedding-3-large`, `embed-v5.0-pro`, `voyage-3.5`, `nomic-embed-text`) and `embedding_dims` (new). The KB dialog: pick an embed-capable connection → pick a suggested model or type one → **Detect** (server route embeds `"ping"` through the driver and reports the vector length; for drivers that accept a dimension parameter the default request is 1024). Allowed dimensions 64–4000. `embedding_model` and `embedding_dims` are locked once set (trigger; `embedding_dims` may go null → value once). `embedding_provider_id` may change later (key rotation, account move) but only to a connection whose embed driver format matches the original (trigger). Legacy KB values (`cohere-embed-5-pro`, `cohere-embed-5-fast`, `openai-text-embedding-3-large`, `voyage-3.5`) map to driver + API model id + 1024 dims through a legacy table in `lib/grey/embedding_models.js`. A KB with no provider fails ingestion with "Choose an embedding provider for this knowledge base."

**Missing-provider behaviour (never silent):**
- No embedding provider / key rejected → ingestion job fails with an actionable message; queries degrade to text-only search (`meta.degraded = 'vector_unavailable'`).
- No rerank provider while rerank is on → rerank skipped (`meta.rerank = 'not_configured'`); pipeline UI shows a hint. `DEFAULT_RETRIEVAL.rerank` becomes `false` for new pipelines.
- No processing model → graph stage and contextual enrichment are skipped with job warnings; eval runs fail with "Set a processing model in Settings → General."
- No transcription connection → media job fails "Connect a transcription provider (e.g. AssemblyAI) to transcribe audio and video."

### 4.4 Grey hosted is switched off

`lib/supabase/model_providers.js` gets `GREY_HOSTED_ENABLED = false`. While false: `GREY_HOSTED_PROVIDER` is excluded from every option list (pipeline dialog, pipeline detail, all pipelines, Model Providers list); the pipeline dialog defaults to no provider; existing pipelines flagged `metadata.hostedProvider` fail generation with `hosted_unavailable` → "Grey hosted models aren't available yet — choose one of your own providers." The resolver keeps the hosted code path (alias map `grey-fast/balanced/deep` → Haiku/Sonnet/Opus 5.5) so turning the flag on later is a config change plus env keys.

## 5. Worker service

### 5.1 Process

`worker/index.mjs` boots: env check, `pg` pool on `WORKER_DATABASE_URL`, service-role Supabase client (Storage), `/healthz` HTTP endpoint, signal handlers, then `loop.mjs`. Logging with `pino` JSON (`jobId`, `projectId`, `stage`); document content is never logged.

**`WORKER_DATABASE_URL` must use the session pooler (port 5432).** `STRING_URI` is the transaction pooler (port 6543), which cannot LISTEN.

### 5.2 Waking up

A trigger on `grey.ingestion_jobs` (`after insert or update of status`, when `new.status = 'queued'`) runs `pg_notify('grey_jobs', id)`. The worker LISTENs and also polls every `WORKER_POLL_MS` (default 5000) as a fallback. The Next app never calls the worker. pgmq is not needed — the jobs table is the queue.

### 5.3 Queues

`worker/queues.mjs` exports `[{ name: 'ingestion', claim, run, heartbeat, release }, { name: 'eval', claim: claimEvalRun, run: runEvalRun }]`. Concurrency `WORKER_CONCURRENCY` (default 2).

### 5.4 Job lifecycle

New columns on `ingestion_jobs`: `attempts int default 0`, `max_attempts int default 3`, `run_after timestamptz default now()`, `locked_by text`, `locked_until timestamptz`. Same lease columns on `eval_runs`.

- **Claim** — `grey.claim_ingestion_job(p_worker text, p_lease_seconds int default 120, p_max_per_project int default 2)`, one statement: fail expired-lease jobs that are out of attempts; then select one job `for update of j skip locked` that is `queued and run_after <= now()` **or** `running with locked_until < now()` (crashed worker), skipping: projects at their running-job limit, sources that already have a running job (one active job per source — the graph stage relies on this), and projects where `grey.ingestion_paused(project)` (soft cap reached with `cap_behavior = 'pause_ingestion'`). Sets `status running`, `locked_by`, `locked_until`, `attempts + 1`, `started_at` (if null).
- **Heartbeat** — every 30 s, `grey.heartbeat_ingestion_job(job, worker, lease)` extends the lease and returns current status. `cancelled` or a lost lease aborts the job via `AbortController`. Cancellation and source soft-deletion are also checked at every stage boundary. Every terminal write is guarded `where locked_by = $me and status = 'running'`.
- **Retry** — stages throw `JobError(code, message, { retryable })`. Retryable (network, 429, 5xx, lost lease) → `queued`, `run_after = now() + min(30s·2^attempts, 15 min) ± jitter`. Permanent (unsupported/corrupt file, missing object, provider not configured, key rejected) → `failed` immediately.
- **Shutdown** — on SIGTERM: stop claiming, drain up to 25 s, then release in-flight jobs to `queued` without counting the attempt.
- **Janitor** — every 10 min: delete `staged` chunks of failed/cancelled jobs.

### 5.5 Idempotency and the atomic swap

`chunks` gains `job_id uuid references ingestion_jobs on delete set null`, `state text default 'live' check (state in ('staged','live'))`, `search_text text`.

1. The embed stage inserts chunks as `state = 'staged', job_id = J` after each batch, with a unique `(job_id, ordinal) where state = 'staged'` index, so a retried job resumes from the last embedded ordinal.
2. `grey.swap_source_chunks(p_job uuid, p_worker text)`, one transaction: hard-delete the source's `live` chunks (derived data; their `kg_mentions` cascade) and promote job J's staged chunks to `live`.
3. **Every reader filters `state = 'live'`**: retrieval functions, the chunk browser (`lib/supabase/chunks.js`), citations, exports.

**Parse cache.** `parseKey = sha256(content_hash + engine + engineVersion + ocr + media flags)`; parsed pages stored gzipped at `grey-sources/{project}/{kb}/{source}/.parsed/{parseKey}.json.gz` (existence is the cache check). `chunkKey = sha256(parseKey + chunking + enrichment + embedding_model)` stored in `sources.metadata.ingest`; when a job's `chunkKey` matches the live chunks, the job skips to the graph stage (cheap retry after a graph failure). A cached parse is billed 0 pages.

### 5.6 Deployment (host-agnostic)

- `Dockerfile.worker`: `node:24-slim`, `npm ci --omit=dev` from `worker/package.json`, copy `worker/`, `lib/grey/`, `lib/engine/`; non-root user; `CMD ["node","worker/index.mjs"]`. Plus `.dockerignore`.
- Root `package.json`: `"worker": "node --env-file=.env worker/index.mjs"`; extend `test` glob to `worker/**/*.test.mjs` and `lib/engine/**/*.test.js`.
- `/healthz` → 200 when the DB is reachable and the loop ticked within 60 s.
- Env: `WORKER_DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `WORKER_CONCURRENCY`, `WORKER_MAX_PER_PROJECT`, `WORKER_LEASE_SECONDS`, `WORKER_POLL_MS`, `ASSETS_INTERNAL_URL`, `GEIGER_INTERNAL_TOKEN`, `GREY_MAX_MEDIA_MINUTES` (default 600), `GREY_OCR_URL` (future, unset). **No AI provider keys** — they come from Vault per project.
- Choosing the host (Railway / Fly / own VPS) is a later decision; nothing in this design depends on it.

## 6. Ingestion stages

Stage values stay `parse | chunk | embed | graph` (no UI change). Progress bands: parse 0–30, chunk/enrich 30–60, embed 60–90, graph 90–100. Transcription reports as stage `parse` with `metadata.substage = 'transcribe'`.

**Config.** `ingestion_jobs.preset_snapshot` drives every stage. Fix: the upload dialog's `buildQueuedJob` must snapshot the **merged** preset + KB `chunk_config` (today only the preset is snapshotted; "Re-ingest all" already merges).

### 6.1 Fetch (by `sources.origin`)

| Origin | Fetch |
|---|---|
| `upload` | Stream from `grey-sources` to a temp file; media gets a 6 h signed URL instead (§9) |
| `notes` | Read `notes.project_boards` nodes/edges over `pg`; render Markdown (board name → heading; node `data.label` / `text` / `url` → paragraphs; edges → "A → B" lines) |
| `assets` | `GET {ASSETS_INTERNAL_URL}/api/internal/assets/{id}/read-url?projectId=` with `Authorization: Bearer GEIGER_INTERNAL_TOKEN` → signed URL (§9.4) |
| `url` | SSRF-guarded fetch (§14): http(s) only, private/link-local IPs blocked and re-checked on each redirect (max 5), 20 MB cap, 20 s timeout; then Readability |
| `content` | Rejected: "Content sources aren't supported yet." |

The worker writes `sources.content_hash` (sha256 of bytes).

### 6.2 Parse (text engines)

Every engine returns `{ pages: [{ page, markdown }] }`; one `markdownToBlocks()` (`marked`) produces headings, paragraphs, lists, tables, code.

| Input | Library (licence) |
|---|---|
| PDF | `unpdf` (MIT), text per page |
| DOCX | `mammoth` (BSD-2) → `turndown` (MIT) |
| PPTX, ODF | `officeparser` (MIT) |
| XLSX | `exceljs` (MIT) → Markdown tables per sheet |
| HTML / URL | `@mozilla/readability` (Apache-2.0) + `linkedom` (ISC) → `turndown` |
| Markdown, TXT, CSV | read directly |
| Token counts | `gpt-tokenizer` (MIT) |

Avoid (licence traps): Marker, MinerU, PyMuPDF, UniPDF, Kreuzberg v4+, SheetJS npm.

### 6.3 Behaviour until the OCR service exists

- Preset `parser` of `layout`, `vlm` or `auto` → text engine; job warning `layout_unavailable` ("Layout-aware parsing isn't available yet — parsed as plain text"); pages billed at the Fast tier (tier actually used).
- PDF pages with < 200 characters of text layer are skipped with warning `ocr_unavailable`; a PDF with no text at all fails: "This PDF has no text layer; OCR isn't available yet."
- Image sources fail: "Image OCR isn't available yet."
- UI: one info line in `ingestion_settings_form.jsx` and `preset_sheet.jsx` — "Layout and OCR parsing are coming soon; documents are currently parsed as text."

### 6.4 OCR adapter (interface only)

`worker/ingest/parse/ocr_service.mjs` → `parseWithOcrService({ fileUrl, mime, pages, signal })` → `{ pages: [{ page, markdown }] }`, calling `GREY_OCR_URL`. Unset → throws `JobError('ocr_not_configured', …, { retryable: false })`. When the VPS model exists, routing switches `layout`/`vlm` to it and `auto` to: text layer ≥ 200 chars → text, else OCR service. The routing function is pure and unit-tested now.

### 6.5 Chunk

`lib/grey/chunker.js` → `chunkDocument(blocks, chunking, { countTokens })`:

- **recursive** (default): split into sections by heading level; pack blocks to `size` tokens; oversized blocks split recursively on paragraph → line → sentence → space; `overlap` tokens carried forward **within a section only**.
- **atomicTables**: tables never split; a table over 2× `size` is split by rows, repeating the header row.
- **fixed**: token windows. **page**: one chunk per page. **semantic**: falls back to recursive (recorded in metadata).
- Output per chunk: `ordinal, content, heading_path, page, start_ms, end_ms, token_count, search_text`, where `search_text = breadcrumb (if headingBreadcrumbs) + context (if enriched) + content`.
- Transcripts use `chunkTranscript` (§9.3).

**Contextual enrichment** (`enrichment.contextual`; on in the High accuracy preset): `lib/engine/enrich.js`, one call per chunk with the document prompt-cached, on the project **processing model**. Skipped with a warning if none is set. Tokens metered as `contextual_tokens` (§11).

**parentChild**: deferred; job warning; toggle shows "Coming soon".

### 6.6 Embed

`lib/engine/embeddings.js` → `embedTexts({ admin, projectId, kb, texts, inputType, signal })` → `{ vectors, tokens }`, using the KB's embedding provider key. Batches per model limits (§7.1), max 3 in flight, retries 429/5xx ×3 honouring `Retry-After` ≤ 10 s, 60 s timeout for ingestion / 15 s for queries, throws `EMBED_DIM_MISMATCH` unless every vector has the KB's `embedding_dims` values. Staged rows inserted after each batch; then the swap; then the source update (`status ready`, `chunk_count`, `token_count`, `page_count`, `duration_ms`).

### 6.7 Graph

If `graph.extract` and a processing model is set: `extractGraph(...)` (§10). A graph failure never fails the job: the job ends `succeeded`, the source stays `ready`, and the problem is recorded in `ingestion_jobs.metadata.warnings`. Orphan sweep runs after every swap regardless of whether extraction ran.

### 6.8 Final status

Source `ready` if live chunks exist; else `failed` (or `pending` if cancelled). Job `actual_cost` = sum of its usage events.

## 7. Retrieval

### 7.1 Embedding drivers

| Driver format | Request | Dimension param | Input type | Batch |
|---|---|---|---|---|
| `openai` | `POST {base}/embeddings` `{ model, input, dimensions? }` | `dimensions` (sent only when the model is known to support it, e.g. `text-embedding-3-*`) | — | 256 |
| `cohere` | `POST {base}/v2/embed` `{ model, texts, input_type, embedding_types: ["float"], output_dimension? }` | `output_dimension` | `search_document` / `search_query` | 96 |
| `voyage` | `POST {base}/embeddings` `{ model, input, input_type, output_dimension? }` | `output_dimension` | `document` / `query` | 128 |
| `google` | `POST …/models/{model}:batchEmbedContents` | `outputDimensionality` | `RETRIEVAL_DOCUMENT` / `RETRIEVAL_QUERY` | 100 |

`lib/grey/embedding_models.js` holds suggested models per driver (id, label, native dims, whether a dimension param is accepted), the legacy-value table, and pure request/response builders. Every returned vector must have exactly the KB's `embedding_dims` values, else `EMBED_DIM_MISMATCH` ("The model returned N-dimension vectors but this knowledge base expects M").

### 7.2 Storage and indexes

- `chunks.embedding public.halfvec` **without a fixed dimension**, plus `chunks.embedding_dims smallint` and `chunks.embedding_model text` (provenance). Each KB has exactly one model, so filtering by `kb_id` already guarantees query and chunk vectors come from the same model.
- **Partial expression HNSW indexes per common dimension**: for d in 256, 384, 512, 768, 1024, 1536, 2048, 3072 — `using hnsw ((embedding::public.halfvec(d)) public.halfvec_cosine_ops) with (m = 16, ef_construction = 64) where deleted_at is null and state = 'live' and embedding_dims = d`. Other dimensions (64–4000) work through exact search (correct, slower on very large KBs); the KB dialog notes this. halfvec keeps HNSW available up to 4000 dims and halves storage on the shared instance.
- `chunks.fts tsvector` generated: `setweight(to_tsvector('english', grey.join_text(heading_path)), 'A') || setweight(to_tsvector('english', coalesce(search_text, content, '')), 'B')`, GIN index. `grey.join_text(text[])` is a small immutable wrapper (`array_to_string` is not immutable).
- `chunks` is empty today, so stored generated columns rewrite nothing.

### 7.3 Search functions (service-role only, `SECURITY INVOKER`)

RLS cannot apply (API/MCP/widget callers have no `auth.uid()`), so routes authorize first and the functions take `project_id` explicitly and join `knowledge_bases` on it — a KB id from another project returns nothing.

```sql
-- p_kb_ids must all share one embedding model + dims (searchChunks groups KBs before calling).
create or replace function grey.match_chunks_vector(p_project uuid, p_kb_ids uuid[], p_dims int,
  p_query public.halfvec, p_limit int default 50, p_min_similarity real default 0)
returns table (chunk_id uuid, source_id uuid, source_name text, kb_id uuid, content text, page int,
  start_ms int, end_ms int, heading_path text[], score real)
language plpgsql stable set search_path = grey, public as $$
begin
  if p_dims is null or p_dims < 64 or p_dims > 4000 then raise exception 'BAD_DIMS'; end if;
  perform set_config('hnsw.iterative_scan','relaxed_order',true);
  perform set_config('hnsw.ef_search','100',true);
  -- %s is a validated integer, so the cast expression matches the partial expression index.
  return query execute format($q$
    select * from (
      select c.id, c.source_id, s.name, c.kb_id, c.content, c.page, c.start_ms, c.end_ms, c.heading_path,
             (1 - (c.embedding::public.halfvec(%s) <=> $1::public.halfvec(%s)))::real as score
      from grey.chunks c
      join grey.sources s on s.id = c.source_id and s.deleted_at is null
      join grey.knowledge_bases k on k.id = c.kb_id and k.project_id = $2 and k.deleted_at is null
      where c.project_id = $2 and c.kb_id = any($3) and c.deleted_at is null
        and c.state = 'live' and c.embedding_dims = %s
      order by c.embedding::public.halfvec(%s) <=> $1::public.halfvec(%s) limit $4) r
    where r.score >= $5 order by r.score desc$q$, p_dims, p_dims, p_dims, p_dims, p_dims)
  using p_query, p_project, p_kb_ids, p_limit, p_min_similarity;
end $$;
```

`grey.match_chunks_text(p_project, p_kb_ids, p_query, p_limit)`: same joins/filters; `c.fts @@ grey.or_tsquery(p_query)` ranked by `ts_rank_cd`. `or_tsquery` stems with `english`, ORs the terms, returns null when only stopwords remain (`plainto_tsquery` ANDs every word, which natural-language questions rarely satisfy).

### 7.4 `searchChunks`

`lib/engine/retrieval.js` → `searchChunks({ admin, projectId, kbIds, query, topK = 6, hybrid = true, rerank, rerankProviderId, threshold = 0.2, graphMode = 'off', signal })` → `{ chunks, meta }`.

1. Load active KBs in `projectId ∩ kbIds`; group by `(embedding_provider_id, embedding_model, embedding_dims)`. None → empty, `meta.reason = 'no_knowledge_bases'`.
2. Embed the query once per group (parallel) with the KB's provider key.
3. Run each group's vector arm + one text arm in parallel. Pool per arm: `min(max(topK·5, 30), 100)`. `threshold` applies to cosine similarity only (text hits pass — exact names/ids are why the text arm exists). `hybrid: false` → vector arms only.
4. Graph: if `graphMode = 'always'`, or `'auto'` and `shouldUseGraph(...)`, call `expandWithGraph` (§10.4).
5. Fuse all lists with RRF (`k = 60`; graph list weight 0.5) — `lib/grey/fusion.js`.
6. Rerank (if on and a provider is set) on the fused pool; 3 s timeout; failure falls back to fused order (`meta.rerank = 'failed'`).
7. Return top `topK`. Chunk: `{ chunkId, sourceId, sourceName, kbId, content, score, page, startMs, endMs, headingPath, via }`. Meta: `{ scoreKind, embedTokens, rerank, graph, facts, degraded, candidateCount, timings }`.

Rerank: `lib/engine/rerank.js` → `rerank({ admin, projectId, providerId, model, query, documents, topN, signal })` → `[{ index, score }]`, dispatching to the connection's rerank driver. The pipeline stores `retrieval.rerankProviderId` + `retrieval.rerankModel` (suggestions: Voyage `rerank-2.5-lite` / `rerank-2.5`; Cohere's current Rerank 4 id — verify; Jina `jina-reranker-v2-base-multilingual`; free-form allowed).

## 8. Generation

### 8.1 Model resolution

`lib/engine/llm.js` → `resolveModel({ admin, projectId, config })` → `{ model, modelId, providerKind, hosted }`:

- Hosted flag (provider id `grey-hosted` or `metadata.hostedProvider`) → `hosted_unavailable` while `GREY_HOSTED_ENABLED` is false (§4.4).
- Otherwise load the `model_providers` row (`project_id` match, not deleted), fetch the key (§4.2), build `createOpenAI` / `createAnthropic` / `createGoogleGenerativeAI` / `createOpenAICompatible({ name, baseURL, apiKey })`. `openai_compatible` base URLs pass `assertPublicBaseUrl` (§14).
- `getProcessingModel({ admin, projectId })` resolves the project processing model the same way (graph, enrichment, eval judge).

**Sampling parameters.** Current Claude models (Opus 5.5, Sonnet 5.5, Haiku 5.5, and the 4.7+ family) reject non-default `temperature` with a 400, as do OpenAI reasoning models. `lib/grey/model_caps.js` → `supportsTemperature(providerKind, modelId)` (known-model table); when false, `temperature` is omitted. For unknown models, a 400 whose message names `temperature` is retried once without sampling params. The pipeline UI shows "Not supported by this model" next to the slider for known non-supporting models.

### 8.2 Pipeline config

`lib/engine/pipeline_config.js` → `resolvePipelineConfig({ admin, projectId, pipelineId, channel, version })`:

- `playground`: draft pipeline row + clamped overrides (temperature 0–2, topK 1–50).
- `api` / `mcp` / `widget`: requires `status = 'live'`; loads `pipeline_versions.config` at `current_version`. Draft → 409 `pipeline_not_live`.
- `eval`: `eval_runs.pipeline_version` if that version exists, else the draft (the UI can write version 0).

### 8.3 Prompting and citations (pure, `lib/grey/prompt.js`, `lib/grey/citations.js`)

- `buildContextBlocks(chunks, { budgetTokens = 6000 })` → `[n] {title} — p. {page} | {mm:ss}\n{content}`; per-chunk cap ~1,200 tokens.
- `buildSystemPrompt({ systemPrompt, citations })`: grounding rules (answer only from context; cite `[n]` when citations on; say plainly when the context doesn't cover it) then the pipeline's prompt. `{{context}}` / `{{question}}` placeholders (already documented in the pipeline UI) are substituted when present; otherwise the final user turn is `Context:\n…\n\nQuestion: …`. Graph facts (if any) go in a "Known relationships" block.
- `windowHistory(messages, { turns: 6, budgetTokens: 2000 })`.
- `mapCitations(text, chunks)`: parses `[1]`, `[1, 2]`, `[1][2]`; de-dupes; first-appearance order; drops out-of-range; maps to the existing UI shape `{ index, sourceId, chunkId, title, page, startMs, snippet }`.
- **Empty retrieval** → no LLM call; fixed answer "I couldn't find anything about that in the connected knowledge bases."; message `unanswered = true`, `metadata.noContext = true`.

### 8.4 Shared turn engine

- `generateAnswer({ admin, projectId, config, messages, chunks, facts, stream, abortSignal })` → non-stream `{ text, citations, usage: { tokensIn, tokensOut }, model, finishReason, noContext }`; stream `{ textStream, finalize(): Promise<same> }`.
- `runPipelineTurn({ admin, projectId, config, query, history, channel, stream, abortSignal })` → cap check → `searchChunks` → `generateAnswer`; returns answer + `retrieved` + `timings`. Playground, v1, MCP, widget and eval runner all call it; each route keeps its own persistence.

### 8.5 Playground streaming

`/api/chat` streams NDJSON when the body has `stream: true` (JSON otherwise, as today): `{type:"start", conversationId, userMessage}`, `{type:"delta", text}`…, `{type:"done", assistantMessage}` | `{type:"error", code, message}`. Assistant message persisted before `done`; logs/usage written in `after()` (`next/server`); `request.signal` → `abortSignal` (partial reply saved with `metadata.aborted`). Routes export `maxDuration = 300`. Client: `apiStream()` in `lib/api.js`, `streamChat()` in `lib/supabase/conversations.js`, `chat.jsx` appends deltas to a pending assistant row. Remove the "Placeholder" badge path in `chat_kit.jsx` and the "backend not connected" copy in `evaluations.jsx`, ingestion jobs and pipeline endpoint sections.

### 8.6 Errors

`lib/grey/llm_errors.js` → `mapLlmError(err)`: 401/403 → `provider_auth` ("The model provider rejected the API key — update it in Model Providers"; sets provider status `error`), 404 → `model_not_found`, 429 → `rate_limited`, 5xx/network → `provider_unavailable`, 60 s without a first token → `timeout`, else `generation_failed`. Never return raw provider text. `redact(value, secret)` strips keys and `sk-…`-style tokens from logs.

## 9. Media (audio/video)

### 9.1 Drivers

The project's transcription connection (§4.3) picks the driver:

- **`assemblyai`** (recommended): Universal-2 for Fast/Balanced (≈ $0.17/hr with diarization), U3.5 Pro for High accuracy (≈ $0.23/hr). Accepts video containers directly from a URL → **no ffmpeg**. Limits 5 GB / 10 h.
- **`openai` format** (`POST {base}/audio/transcriptions`, multipart): OpenAI (`gpt-4o-transcribe`, `whisper-1`), Groq Whisper, self-hosted Whisper servers. The worker downloads the file and uploads it; `response_format: verbose_json` for segment timestamps. No diarization (speaker `null`). Files over the server's limit (25 MB on OpenAI) fail with "This file is too large for the selected transcription provider."
- Transcription model is set with the connection in Settings (`project_settings.transcription_model`, default per driver).

### 9.2 Interface

`lib/engine/transcribe.js` + `lib/engine/drivers/transcribe/{assemblyai,openai}.js` → `transcribe({ admin, projectId, providerId, model, fileUrl, filePath, config: { diarize, language, tier }, resumeId, onSubmitted, signal })` → `{ provider, providerId, durationMs, language, segments: [{ startMs, endMs, speaker, text, words? }], raw }`.

- AssemblyAI downloads the file from a signed URL; media never streams through the worker. The OpenAI-format driver needs `filePath` (the worker downloads to a temp file first).
- Poll every 5 s backing off to 15 s; timeout `max(30 min, 2 × duration)`.
- `onSubmitted(providerId)` saves `ingestion_jobs.metadata.providerJobId`; a restarted worker resumes polling the same transcript instead of paying twice.
- Raw JSON cached at `grey-sources/{project}/{kb}/{source}/transcript.json`; the provider transcript is then deleted at AssemblyAI.
- Keyframe captioning deferred: `media.keyframes` ignored with `metadata.keyframesSkipped`; toggle shows "Coming soon".

### 9.3 Transcript chunking (pure, `lib/grey/chunk_transcript.js`)

`chunkTranscript(segments, { windowSeconds = 45, maxTokens = 512, overlapSeconds = 5 })`: sort, drop empties; split oversized segments at word boundaries (sentence ends preferred; interpolate times without word timings); pack greedily within window and token limits, closing early at a speaker change once ≥ 50% of the window; merge same-speaker lines as `Speaker A: …` (no prefix without diarization); overlap carries trailing whole segments up to `overlapSeconds`. Chunks get `page null`, `heading_path null`, `start_ms`/`end_ms`, `metadata { kind: 'transcript', speakers }`; the source name is the embedding breadcrumb.

### 9.4 Assets imports (cross-repo)

- **geiger-assets** gets `app/api/internal/assets/[id]/read-url/route.js`: `GET ?projectId=`, `Authorization: Bearer GEIGER_INTERNAL_TOKEN`, returns `{ url, mimeType, filename, sizeBytes }` via `backendForRef(refFromAssetRow(row)).signRead()`; 404 when the asset isn't in that project or isn't stored. Used for documents and media alike.
- **Grey fix**: `lib/supabase/suite_imports.js` `listImportableAssets` selects `type, mime_type, size_bytes, storage_key, storage_status` and derives `kind` from `assets.type` (today `format` is mapped into `mime`, misclassifying audio/video).
- Env (both the worker and Grey's Next app): `ASSETS_INTERNAL_URL`, `GEIGER_INTERNAL_TOKEN`.

### 9.5 Metering and limits

Provider `durationMs` overwrites `sources.duration_ms`; `estimated_cost` back-filled via `estimateFileCost()` when null (imports); `GREY_MAX_MEDIA_MINUTES` checked before submitting when duration is known.

### 9.6 Playback

- `app/api/sources/[id]/media-url/route.js` (`grey.knowledge_bases.view`): 1 h signed URL (grey-sources for uploads, the Assets internal route for imports).
- `source_sheet.jsx`: `<audio controls>` / `<video controls>` above Metadata, seeking to `#t=` / `currentTime` on `loadedmetadata`.
- `chat_kit.jsx` `useOpenCitationSource`: `url.setTab("Sources", { source, t: floor(startMs/1000) })`.

Errors (job + source `failed`): no transcription provider; "Transcription failed: <provider message>"; "No speech detected in this file."; "File is longer than the 600-minute limit."; "This asset's file isn't available in Assets."; "Transcription timed out." Submit retries 429/5xx ×3.

## 10. Knowledge graph

### 10.1 Extraction

`lib/engine/graph_extract.js` → `extractGraph({ admin, projectId, sourceId, jobId, chunks, config })` → `{ ok, entities, relations, tokens, warnings }`; never throws.

- Model: the project **processing model** (Haiku-class models recommended in the UI hint; Claude Haiku 5.5 is $0.10/$0.50 per M tokens ≤ 100K-token prompts). Structured output via AI SDK `generateText` with an `Output.object` zod schema (exact v7 name verified at implementation).
- `batchByTokens(chunks, 6000)` (`lib/grey/batch.js`); skip chunks < 20 tokens; cap per source `graph.maxTokensPerSource` (default 300K, warning `graph_truncated`); up to 3 LLM calls in parallel, batches **resolved in order**; a "seen names" list (≤ 40) passed into later prompts for in-source consistency.
- Prompt (`buildExtractionPrompt(ontology, batch, seenNames)`, pure): types from `grey.kg_types`; listed types only, `Other` / `related_to` as escape hatches; ≤ 25 entities per batch; canonical names with aliases; chunks labelled `[c1]…`.
- Schema: `{ entities: [{ ref, name, type, aliases, description, confidence, chunks }], relations: [{ source, target, type, confidence, chunk }] }`.
- `sanitizeExtraction(raw, ontology, chunkRefMap)` (pure): unknown types → fallbacks; drop dangling refs and self-relations; clamp confidence; drop below `graph.minConfidence` (0.5); in-batch dedupe; map `cN` → `{ chunk_id, page, start_ms }`.
- `grey.ensure_default_ontology(p_project)` moves default-type seeding into SQL under an advisory lock (granted to `authenticated` with `can_access_project`); the client's `ensureDefaultOntology` calls it — removes the client/worker seeding race.

### 10.2 Entity resolution — `grey.kg_upsert_extracted(p_project, p_source, p_payload jsonb)`

One transaction per batch under `pg_advisory_xact_lock(hashtext('grey.kg:' || project_id))`.

- Generated `name_norm = grey.normalize_entity_name(name)` and `aliases_norm` (immutable; `unaccent`; same rules as `normalizeName` in `lib/grey/duplicates.js`).
- Match order (live, not merged): exact `name_norm` or alias overlap (same type preferred; cross-type only when one side is `Other`) → same-type `similarity(name_norm, n) >= 0.6` for names ≥ 4 chars → follow `merged_into` to the survivor (≤ 5 hops).
- On match: **forms/manual** entities only gain aliases; **grey** entities gain aliases, fill empty description, take max confidence, upgrade from `Other`.
- No match: insert `source_app 'grey'`.
- Relations dedupe on live `(source, target, type)` with `valid_to null`; extraction never invalidates relations. Mentions inserted with `metadata.origin = 'extraction'`, `on conflict do nothing`.
- No embedding-based resolution in this phase.

### 10.3 Re-ingestion and deletion

- The chunk swap cascades old mentions. After every swap, `grey.kg_sweep_orphans(project, source)` soft-deletes grey entities with no live mention and no live relation to a forms/manual entity, and grey relations with no live mention or a dead endpoint. Entity ids stay stable across re-ingests (re-extraction matches them).
- A trigger on `grey.sources` when `deleted_at` becomes non-null runs clear + sweep.
- `kg_relations` gains `source_app` (default `'manual'` — all existing rows were created by hand).

### 10.4 Graph-aware retrieval

`lib/engine/graph_retrieve.js` → `expandWithGraph({ admin, projectId, kbIds, query, seedChunks, mode })` → `{ chunks, facts, entities }`:

1. `grey.kg_match_query_entities(p_project, p_kb_ids, p_query, 5)`: word-similarity on `name_norm` (GIN trigram) + aliases ≥ 0.8, **restricted to entities with a live mention in a live chunk of `p_kb_ids`** (the KB set is the permission boundary).
2. `shouldUseGraph(query, { mode, matchedCount })` (pure, `lib/grey/graph_router.js`): `off` no; `always` yes if anything matched; `auto` yes when ≥ 2 entities matched, or 1 matched plus a relational/global cue (between, relationship, related, connect, linked, involved, works with/at, compare, all, every, list, across, overview, summar*, how many, depends, who… and which…).
3. `grey.kg_expand(p_project, p_kb_ids, p_seed, p_exclude_chunks, p_hops 2, p_max_entities 40, p_max_chunks 8)`: recursive CTE over live relations with a 15-edge fan-out cap per hop; returns chunks (score Σ 1/(1+depth)) and ≤ 20 facts `{ subject, relation, object, confidence }`. Target < 50 ms.
4. Forms-only entities never surface in retrieval (a public widget must not leak CRM data).

### 10.5 Forms push

`grey.upsert_form_entity(p_project_id, p_form_id, p_submission_id, p_entities jsonb, p_relations jsonb)`, **service_role only** (Forms writes server-side with the service role from `lib/server/side-effects.js`).

- Identity: link row in new `grey.kg_form_links (project_id, submission_id, entity_key, entity_id, form_id; pk (submission_id, entity_key))` → `lower(properties->>'email')` same type → `properties->>'domain'` for organizations → exact `name_norm` + type. No fuzzy matching.
- Matching a grey entity promotes it (`source_app 'forms'`, confidence 1, form name wins, old name → alias); forms entity: latest submission wins; manual: only adds missing aliases/properties.
- `replace: true` on a relation sets `valid_to = now()` on other live forms relations of that type from the same source entity.
- **Forms repo work (not this build):** an `entity_mapping` setting per form; call the RPC from `runSubmissionEffects` / `runEditEffects`; update `FEATURES_SUITE.md` §6.

## 11. Metering and caps

Rule: **Grey records quantities for everything; cost is non-zero only for work Grey itself performs.** Work done on the customer's provider accounts records quantity with `cost 0` and `metadata.byok = true`.

| Kind | Quantity | Cost |
|---|---|---|
| `page` | pages parsed (cached parse = 0) | preset `perPage` at the tier actually used |
| `retrieval` | 1 per retrieve / chat turn / MCP search or ask | `PRICE_PER_RETRIEVAL` = $0.001 (in `lib/grey/cost.js`) |
| `media_minute`, `contextual_tokens`, `graph_tokens`, `llm_tokens` | minutes / tokens | 0 (`byok`) |

- One `usage_events` row per (ingestion job, kind) — unique partial index `(ref_id, kind) where ref_type = 'ingestion_job'`.
- `request_logs`: `status ok|error` (no new `stub` rows), `retrieved [{ chunkId, sourceId, score, rank, via }]` (no content), tokens, cost; `query` null and `retrieved` `[]` when `project_settings.log_queries = false`. Evals write only `usage_events`.
- `grey.project_month_spend(p_project)` (service role): month-to-date cost. `cap_behavior`: `pause_ingestion` → worker stops claiming that project's jobs; `retrieval_only` → chat returns retrieved passages without generation ("Monthly budget reached — here are the most relevant passages"); `alert` → proceeds (sending alerts out of scope). Search itself is never blocked.
- The cost estimate UI keeps showing preset prices for media/graph; revisit when billing is designed.

## 12. Delivery

### 12.1 API-key auth

`lib/server/api_key_auth.js` → `authenticateApiKey(request, { scope, projectId?, pipelineId?, requiredKeyId? })`: Bearer `gk_live_…` → `hashApiKey` → lookup by `key_hash` (not deleted). Missing/unknown → 401 `invalid_api_key` (`WWW-Authenticate: Bearer realm="grey"`); revoked → 401 `api_key_revoked`; expired → 401 `api_key_expired`; scope missing → 403 `insufficient_scope`; project mismatch or pipeline outside a non-empty `pipeline_ids` → 404 (no existence leak; empty list = all pipelines); bound key mismatch → 403 `key_not_bound`. Rate limit via `grey.rate_limit_hit('key:'+id, rate_limit_per_min, 60)` → 429 `rate_limited` + `Retry-After`; every response carries `X-RateLimit-*`. `last_used_at` updated in `after()` at most once per 60 s. The decision logic is a pure `evaluateKey(row, ctx)` for tests.

Rate limiting is a fixed one-minute window in Postgres (unlogged `grey.rate_limit_windows`, atomic upsert, opportunistic cleanup) — correct across serverless instances, no new vendor.

### 12.2 v1 routes (explicit folders; `[...path]` becomes an OpenAI-style 404)

- `POST /api/v1/pipelines/[pipelineId]/retrieve` — `{ query (1–8000), topK? (1–50), threshold?, kbIds? (subset) }` → `{ object: "retrieval", pipelineId, version, query, chunks: [...] }`. Errors in the existing `{ error, message }` shape.
- `POST /api/v1/pipelines/[pipelineId]/chat/completions` — OpenAI-compatible: `messages` (text only; image parts → 400), `stream`, `stream_options.include_usage`, `temperature`, `max_tokens` / `max_completion_tokens` (clamped), `user`; `model` ignored and echoed as `grey/<pipelineId>@v<n>`; `tools` or `n > 1` → 400. Non-stream: standard `chat.completion` + `usage` + `citations` extension. Stream: SSE (`text/event-stream`, `no-cache, no-transform`, `X-Accel-Buffering: no`); first chunk carries `delta.role` + `citations`; content deltas; final chunk with `finish_reason`; optional usage chunk; `data: [DONE]`. Customer key rejected → 502 `upstream_error`. No `conversations` rows for API calls. Errors via `handleOpenAI(fn)` → `{ error: { message, type, code, param } }`.
- `GET /api/v1/pipelines/[pipelineId]/models` — one model entry, for clients that list models from a base URL.
- Setting an OpenAI SDK `baseURL` to `…/api/v1/pipelines/<id>` works unchanged. Production paths sit under `/grey`.

### 12.3 MCP server

- MCP spec 2026-07-28 (stateless). Official SDK `@modelcontextprotocol/server@2.3.1` with `createMcpHandler(factory, { legacy: 'stateless' })` (serves older 2025-era clients too); zod v4 (`zod@4.6.7`). `mcp-handler` not needed.
- `app/api/mcp/[serverId]/route.js`: load the server (not deleted; `disabled` → 403 `server_disabled`); `authenticateApiKey` with scope `mcp`, the server's project/pipeline, and `requiredKeyId = server.api_key_id` (null binding = any project key with `mcp`); build the handler per request (stateless transports can't be reused). No CORS (bearer auth).
- Tools (registered only if enabled in `server.tools`, all `readOnlyHint`, each returns text + `structuredContent`): `search { query, topK? ≤ 20 }`; `ask { question }` (published pipeline, non-stream); `get_entity { id | name }` (follows `merged_into`; mentions filtered to the server's KBs); `list_sources { kbId?, limit? ≤ 100, cursor? }`.
- Pipeline detail "Endpoints" currently shows `/api/mcp/<pipelineId>`, which doesn't match the per-server route: replace with a list of MCP servers bound to the pipeline and a "Create MCP server" button.

### 12.4 Widget runtime

- `public/widget.js` (vanilla, ~250 lines, no build): reads `data-widget`, derives the API origin from `document.currentScript.src`, renders bubble + panel in a Shadow DOM with the widget theme, "Powered by Grey" unless `white_label`; `visitorId` / `conversationId` in localStorage (try/catch); streams via fetch reader; citations as title + page labels (no links — storage is private).
- `app/api/widget/[widgetId]/config/route.js` (GET) and `…/chat/route.js` (POST), both with OPTIONS. Origin required; hostname must match an `allowed_domains` entry exactly or a `*.domain` wildcard (subdomains only), https unless localhost; empty list blocks all → 403 `domain_not_allowed`. CORS echoes allowed origins only, `Vary: Origin`, no credentials. Widget enabled + pipeline published; the bound API key is a server-side kill switch and rate-limit source, never sent to the browser.
- Chat `{ message ≤ 2000, visitorId uuid, conversationId? }`; conversations channel `widget`, `metadata { widgetId, visitorId, origin }`; reuse only when widget + channel + visitor match; last 10 messages as history; 50-turn cap. SSE events `meta` / `delta` / `done` / `error`.
- Limits: per widget = key's `rate_limit_per_min` (60 if unbound); per visitor 10/min keyed on `sha256(ip + widgetId)`. Only hashed visitor ids are stored, never raw IPs.

### 12.5 Logging

`lib/server/delivery_log.js` → `logDelivery(...)` in `after()`: `request_logs` (channel `api|mcp|widget`, `api_key_id`) and `usage_events` per §11. MCP logs `tools/call` only. `request_logs` channel constraint gains `mcp`; the Usage screen's `CHANNEL_LABELS` and filter gain "MCP".

## 13. Eval runner

`lib/engine/eval_runner.js`, dispatched by the worker's `eval` queue:

1. Claim `eval_runs` (`queued` → `running`, lease columns as ingestion).
2. Load `eval_cases`; run each through `runPipelineTurn` (channel `eval`, non-stream, 2 at a time; no `request_logs`).
3. Judge on the project **processing model** with structured output, scores 0–1: **faithfulness** (share of answer claims supported by context); **answerRelevance**; **contextPrecision** (rank-weighted share of retrieved chunks whose source is in `expected_source_ids`, else judge-labelled); **contextRecall** (share of `expected_source_ids` retrieved, else share of `expected_answer` statements supported, else null).
4. Write `eval_results { answer, scores, metadata { citations, retrieved, usage } }`; aggregate null-ignoring means into `eval_runs.metrics { faithfulness, answerRelevance, contextPrecision, contextRecall, cases, failed }` (keys `evaluations.jsx` already reads); `completed`, or `failed` if every case errored.
5. No processing model → run fails with "Set a processing model in Settings → General."

## 14. Security

- **Tenant isolation**: all engine SQL takes `project_id` explicitly and joins `knowledge_bases` on it; service-role functions have execute revoked from `public, anon, authenticated`. The KB set of the pipeline / MCP server / widget is the retrieval boundary, including graph expansion.
- **Secrets**: Vault only; `get_provider_secret` service-role only; keys never logged, cached, returned, or included in errors (`redact`).
- **SSRF**: `lib/grey/url_guard.js` for URL sources and `openai_compatible` base URLs — https in production, block localhost / private / link-local / `.internal` after DNS resolution, re-check on redirects. Dev allows `http://localhost` (Ollama/vLLM).
- **API keys**: hashed at rest (existing), looked up by hash, scopes + allow-lists, rate limits.
- **Widget**: origin allow-list + CORS + per-visitor limits; Forms entities excluded from retrieval.
- **Internal suite calls**: `GEIGER_INTERNAL_TOKEN` bearer on the Assets internal route.

## 15. Schema changes (migrations, in order)

All in the geiger-orm style (`-- @up` / `-- @down`, schema `grey`). Applying them to the shared Supabase project (`npm run db:push`) is done only with explicit confirmation at implementation time.

1. `20261018120000_providers_byo.sql` — provider check + `cohere, voyage, assemblyai`; `knowledge_bases.embedding_provider_id, embedding_dims` + lock/same-format triggers; `project_settings.processing_provider_id, processing_model, transcription_provider_id, transcription_model`; `get_provider_secret`; `project_month_spend`.
2. `20261018120100_worker_queue.sql` — ingestion_jobs / eval_runs lease columns; claim index; `chunks.job_id, state, search_text`; staged unique index; usage_events job-kind unique index; notify trigger; `claim_ingestion_job`, `heartbeat_ingestion_job`, `release_ingestion_job`, `swap_source_chunks`, `ingestion_paused`, `claim_eval_run`.
3. `20261018120200_retrieval.sql` — `chunks.embedding halfvec (no typmod), embedding_dims, embedding_model, fts`; `join_text`, `or_tsquery`; partial expression HNSW indexes for dims 256/384/512/768/1024/1536/2048/3072; GIN fts; `match_chunks_vector`, `match_chunks_text`.
4. `20261018120300_graph_extraction.sql` — `unaccent` extension; normalize functions; `kg_entities.name_norm, aliases_norm` + indexes; `kg_relations.source_app` + index; `kg_mentions` partial unique indexes; `kg_form_links`; `ensure_default_ontology`, `kg_upsert_extracted`, `kg_sweep_orphans`, `kg_match_query_entities`, `kg_expand`, `upsert_form_entity`; source soft-delete trigger.
5. `20261018120400_delivery_runtime.sql` — `request_logs` channel constraint + `mcp` (verify the inline constraint's name in `pg_constraint` first); `rate_limit_windows` + `rate_limit_hit`.

To verify against the live schema before writing SQL: `eval_runs` status values and columns, `request_logs` constraint name, `notes.project_boards` shape.

## 16. UI changes (minimal, following existing patterns)

- Model Providers: kinds + presets from the driver registry, capability chips, base URL field, `openai_compatible` capability checkboxes; hide Grey hosted while the flag is off.
- KB dialog + KB detail: embed-capable connection select, model suggestions + free-form id, **Detect** dimensions, locked model/dims display, inline connect link.
- Pipeline detail: rerank connection + model when rerank is on; temperature "not supported" hint; Endpoints section lists bound MCP servers; remove placeholder copy.
- Settings → General: processing model (connection + model), transcription connection + model.
- Ingestion settings / preset sheet: "Layout and OCR parsing are coming soon" line; keyframes + parent-child toggles disabled "Coming soon".
- Playground: streaming, placeholder badge removed.
- Sources: media player in the source sheet; timestamp deep links from citations.
- Usage: "MCP" channel label.
- Upload dialog: snapshot merged preset + KB chunk config.

## 17. Dependencies (verify exact versions at install time)

App + worker: `ai@7`, `@ai-sdk/anthropic@4`, `@ai-sdk/openai@4`, `@ai-sdk/google@4`, `@ai-sdk/openai-compatible@3`, `zod@4`. App only: `@modelcontextprotocol/server@2.3.1`. Worker only: `pg@8`, `unpdf`, `mammoth`, `turndown`, `officeparser`, `exceljs`, `@mozilla/readability`, `linkedom`, `marked`, `gpt-tokenizer`, `pino`. All permissively licensed.

## 18. Testing

- **Unit (`node --test`)**, one file per pure module: chunker (breadcrumbs, in-section overlap, atomic tables, row splits with header repeat, page/fixed strategies, budget never exceeded except atomic tables); `markdownToBlocks`; cache keys; url_guard (IPv4/IPv6 private ranges, redirects); billing; OCR routing function; `chunkTranscript`; AssemblyAI normalization fixture; `embedding_models` (1024 dims, request bodies, batch planning); fusion (dedupe, order, weights, normalisation); prompt + citations; model_caps; llm_errors + redact; graph schema sanitizer, `batchByTokens`, `shouldUseGraph`, `formatFacts`, name normalisation; `evaluateKey`; OpenAI chunk framing; domain matching; SSE encoding; MCP tool registry; eval metrics; provider_kinds; shared-dependency version sync.
- **Parsers** against small fixtures in `worker/test/fixtures` (PDF, DOCX, PPTX, XLSX, HTML).
- **Integration (opt-in, `GREY_IT=1`)** — run only against a local Supabase (`supabase start`) or a dedicated test project, **never the shared suite project**: chunks go live and usage rows are written; re-running a job doesn't duplicate; concurrent claims get different jobs; expired lease reclaimed; cancel aborts; wrong-project KB ids return nothing from search; graph re-ingest keeps entity ids; Forms push idempotent.
- No build is run for verification unless a significant UI change requires it (project rule).

## 19. Build phases (for the implementation plan)

| Phase | Delivers | Depends on |
|---|---|---|
| A. Foundations | Provider kinds + BYO schema (migration 1), secrets, real provider test, `lib/engine/` skeleton, AI SDK deps, hosted flag | — |
| B. Worker + ingestion | Migration 2, worker process, queue, fetch (upload/url/notes), text parsers, chunker, embeddings, swap, metering | A |
| C. Retrieval + generation | Migration 3, `searchChunks`, rerank, LLM resolution, prompts/citations, turn engine, Playground streaming | B |
| D. Delivery | Migration 5, API-key auth + rate limits, v1 routes, MCP server, widget runtime | C |
| E. Knowledge graph | Migration 4, extraction stage, resolution, sweep, graph retrieval, Forms RPC | B, C |
| F. Media + Assets | AssemblyAI transcription, transcript chunking, Assets internal endpoint (geiger-assets), playback | B |
| G. Eval runner | Eval queue + judge + metrics | C |

## 20. Open items (non-blocking; defaults in place)

1. Worker host — Railway / Fly / own VPS (D3).
2. OCR service on the VPS — interface defined (§6.4); routing switches on when `GREY_OCR_URL` is set.
3. Grey hosted + Grey-paid accounts — flag and alias map ready (§4.4).
4. Pricing of media/graph in the cost-estimate UI under BYO — revisit with billing.
5. Unverified external facts to confirm at implementation: Voyage-3.5 default dimension; Cohere Rerank 4 API id; AI SDK v7 structured-output API name; `@ai-sdk/*` `output_dimension` support (not relied on).
6. More driver formats (Azure OpenAI deployments, Amazon Bedrock, Vertex, Deepgram) — each is one driver file plus a registry entry.

## 21. Later: Grey-run connections and plan quotas

When Grey's own infrastructure exists (self-hosted OCR, embedding, rerank and LLM servers), it appears in the same registry as **`grey_hosted` connections** — one per capability — exposed to every project without a key. Plans then set **quotas per usage kind** (pages, media minutes, retrievals, tokens) enforced at the two existing choke points: the worker's job claim (`ingestion_paused` → plan quota check) and `runPipelineTurn`'s cap check. `usage_events` already records the quantities those quotas need, so no metering changes are required; billing and plan management are designed then.
