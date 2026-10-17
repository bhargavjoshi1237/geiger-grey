# Grey backend — implementation plan

**Spec:** `docs/superpowers/specs/2026-10-17-grey-backend-design.md` (read it first; this plan only adds ownership, contracts and order).
**Branch:** `grey-backend`. Implementers do **not** commit — the coordinator commits per phase after review.

## Ground rules (every implementer)

1. Plain JS, ESM. `lib/grey/` = pure (no I/O). `lib/engine/` = shared server runtime: **relative imports with explicit `.js` extensions, no `server-only`, no `next/*`, no `@/` alias** (the worker imports it under plain Node 24). `lib/server/` = route-only helpers (may use `@/`, `next/*`).
2. Engine functions take an `admin` Supabase service-role client (schema `grey`) as a parameter; never construct clients inside `lib/engine/`. Call service-role SQL functions with `admin.rpc(name, params)`. pgvector values are passed as strings `'[0.1,0.2,…]'`.
3. Never read provider keys from env. Keys come from `getProviderSecret()` (Vault) at call time; never log, cache or return them; pass error text through `redact()`.
4. Next.js 16: read the relevant guide in `node_modules/next/dist/docs/` before writing route handlers, streaming, or `after()`. Route `params` are Promises. Routes export `runtime = "nodejs"`; long routes `maxDuration = 300`. Match existing route style (`handle()`, `ApiError`, `requirePermission`, `toCamel`).
5. UI: reuse existing components and patterns (`@geiger/ui`, shadcn, lucide, `screen_kit`, existing dialogs/sheets). Keep UI edits minimal and consistent with neighbouring screens.
6. Migrations: geiger-orm style (`-- @up` / `-- @down`, schema `grey`, idempotent `if not exists` / `drop … if exists`, RLS conventions, revoke service-role functions from `public, anon, authenticated`). **Do not apply migrations and do not write to the database.** Read-only SQL against the DB to verify existing column/constraint names is allowed via a throwaway Node script using `pg` and `STRING_URI` from `.env` (delete the script afterwards).
7. Tests: `node --test`, one `*.test.js` beside each pure module (and `*.test.mjs` in `worker/`). Run `npm test` before finishing; all tests must pass. Lint changed files with `npx eslint <files>`. **Do not run `next build`.**
8. Do not edit files owned by another phase. If you need a change there, list it in your final report.
9. Do not run `npm install` in the repo root (shared deps are already installed: `ai@7.0.143`, `@ai-sdk/{anthropic@4.0.82,openai@4.0.96,google@4.0.99,openai-compatible@3.0.71}`, `zod@4.6.7`, `@modelcontextprotocol/server@2.3.1`). Worker-only deps go in `worker/package.json` (phase B installs inside `worker/`).

## Shared contracts (exact)

```js
// lib/grey/provider_kinds.js (A) — pure
PROVIDER_KINDS            // { [kind]: { label, capabilities: string[] | 'user', formats: { [cap]: format }, baseUrl, baseUrlMode: 'fixed'|'editable'|'required', suggestedModels: { [cap]: [{ id, label, dims? }] } } }
PROVIDER_PRESETS          // [{ id, label, kind, baseUrl, capabilities }]
capabilitiesOf(providerRow)            // -> string[]  (openai_compatible reads metadata.capabilities, default ['chat'])
driverFormat(providerRow, capability)  // -> 'openai'|'anthropic'|'google'|'openai_compatible'|'cohere'|'voyage'|'assemblyai'|null
hasCapability(providerRow, capability) // -> boolean

// lib/engine/secrets.js (A)
getProviderSecret({ admin, projectId, providerId })            // -> string|null
loadProvider({ admin, projectId, providerId })                 // -> provider row (snake_case) | null   (project-scoped, not deleted)

// lib/engine/llm.js (A)
resolveModel({ admin, projectId, config })   // config: { providerId, model, temperature, maxTokens, metadata? }
  // -> { model /* AI SDK LanguageModel */, modelId, providerKind, hosted: false, supportsTemperature }
  // throws EngineError('hosted_unavailable' | 'no_provider' | 'provider_not_found' | 'no_key' | 'capability_missing')
getProcessingModel({ admin, projectId })     // -> same shape | null  (project_settings.processing_provider_id + processing_model)

// lib/engine/errors.js (A)
class EngineError extends Error { constructor(code, message, { status = 500, retryable = false } = {}) }

// lib/engine/embeddings.js (A)
embedTexts({ admin, projectId, kb, texts, inputType /* 'document'|'query' */, signal })
  // kb: { id, embedding_provider_id, embedding_model, embedding_dims }  (snake_case row)
  // -> { vectors: number[][], tokens: number, dims: number }
detectEmbeddingDims({ admin, projectId, providerId, model, requestedDims }) // -> { dims }
toPgVector(numbers)  // -> '[...]' string  (in lib/grey/embedding_models.js)

// lib/engine/rerank.js (A)
rerank({ admin, projectId, providerId, model, query, documents /* string[] */, topN, signal }) // -> [{ index, score }] sorted desc

// lib/engine/transcribe.js (F)
transcribe({ admin, projectId, providerId, model, fileUrl, filePath, config /* { diarize, language, tier } */, resumeId, onSubmitted, signal })
  // -> { provider, providerJobId, durationMs, language, segments: [{ startMs, endMs, speaker, text, words? }], raw }
resolveTranscriptionConnection({ admin, projectId }) // -> { providerId, model } | null
// lib/grey/chunk_transcript.js (F)
chunkTranscript(segments, { windowSeconds = 45, maxTokens = 512, overlapSeconds = 5 }) // -> [{ ordinal, content, startMs, endMs, tokenCount, speakers }]

// lib/engine/graph_extract.js (E)
extractGraph({ admin, projectId, sourceId, jobId, chunks /* live rows: { id, content, page, start_ms, token_count } */, config /* preset graph cfg */, signal })
  // -> { ok, entities, relations, tokens, warnings: [{ stage: 'graph', code, message }] }   never throws
sweepGraphOrphans({ admin, projectId, sourceId })   // -> void, never throws
// lib/engine/graph_retrieve.js (E)
expandWithGraph({ admin, projectId, kbIds, query, seedChunks, mode, signal }) // -> { chunks /* searchChunks chunk shape, via:'graph' */, facts: [{ subject, relation, object, confidence }], entities }
// lib/grey/graph_router.js (E)
shouldUseGraph(query, { mode, matchedCount }) // -> boolean ;  formatFacts(facts) -> string

// lib/engine/retrieval.js (C)
searchChunks({ admin, projectId, kbIds, query, topK, hybrid, rerank, rerankProviderId, rerankModel, threshold, graphMode, signal })
  // -> { chunks: [{ chunkId, sourceId, sourceName, kbId, content, score, page, startMs, endMs, headingPath, via }], meta }
// lib/engine/pipeline_config.js (C)
resolvePipelineConfig({ admin, projectId, pipelineId, channel /* playground|api|mcp|widget|eval */, version, overrides })
  // -> { pipelineId, version, kbIds, providerId, model, temperature, maxTokens, systemPrompt, retrieval, metadata, status }
// lib/engine/answer.js (C)
generateAnswer({ admin, projectId, config, messages, chunks, facts, stream, abortSignal })
  // non-stream -> { text, citations, usage: { tokensIn, tokensOut }, model: { id, provider }, finishReason, noContext }
  // stream     -> { textStream: AsyncIterable<string>, citations, finalize: () => Promise<non-stream shape> }
// lib/engine/turn.js (C)
runPipelineTurn({ admin, projectId, config, query, history, channel, stream, abortSignal })
  // -> { ...generateAnswer result, retrieved: searchChunks().chunks, retrievalMeta, timings, retrievalOnly }
// lib/engine/usage.js (C)
recordUsage({ admin, projectId, kind, quantity, unitCost, cost, refType, refId, metadata })
getCapState({ admin, projectId }) // -> { spend, cap, behavior, reached }
```

`lib/grey/cost.js` exports `PRICE_PER_RETRIEVAL = 0.001` (A adds it).

## Phases, ownership and order

**Wave 1 (parallel): A, B, C, E, F. Wave 2 (after C): D, G. Then a review pass.**

### A — Drivers and provider connections
Owns: `supabase/migrations/20261018120000_providers_byo.sql`; `lib/grey/{provider_kinds,embedding_models,model_caps,llm_errors,url_guard}.js` (+ tests); `lib/grey/cost.js` (add `PRICE_PER_RETRIEVAL`); `lib/engine/{errors,secrets,llm,embeddings,rerank}.js`; `lib/engine/drivers/embed/{openai,cohere,voyage,google}.js`; `lib/engine/drivers/rerank/{cohere,voyage}.js`; `app/api/providers/[id]/{test,secret}/route.js`; new `app/api/embeddings/detect/route.js`; `lib/supabase/{model_providers,knowledge_bases,project_settings}.js`; `components/internal/screens/pipelines/{constants.js,model_providers.jsx,provider_dialog.jsx,pipeline_dialog.jsx,all_pipelines.jsx}`; hosted-flag filtering in `pipeline_detail.jsx` **provider select only**; `components/internal/screens/knowledge/{constants.js,kb_dialog.jsx,knowledge_base_detail.jsx}`; `components/internal/screens/settings/general.jsx`.
Spec: §2 D7–D10, §4, §7.1, §8.1 (resolution + `model_caps`), §8.6 (`llm_errors`), §14 (url_guard).

### B — Worker and ingestion
Owns: `supabase/migrations/20261018120100_worker_queue.sql`; `worker/**` (incl. `worker/package.json`, parsers, fixtures, tests); `lib/grey/{chunker,markdown_blocks,ingest_keys,billing,ingest_errors,ocr_routing}.js` (+ tests); `lib/engine/enrich.js`; `Dockerfile.worker`, `.dockerignore`; root `package.json` **scripts only** (`worker`, test glob); `lib/supabase/chunks.js` (live filter); `components/internal/screens/sources/{upload_sources_dialog.jsx,constants.js,ingestion_jobs.jsx}`; `components/internal/screens/knowledge/{ingestion_settings_form.jsx,preset_sheet.jsx}` (coming-soon lines; keyframes + parentChild toggles disabled).
Calls: `embedTexts` (A), `transcribe`/`resolveTranscriptionConnection`/`chunkTranscript` (F), `extractGraph`/`sweepGraphOrphans` (E), eval queue via **dynamic** `import('../lib/engine/eval_runner.js')` (G) so the worker boots before G exists. Writes chunk columns `embedding`, `embedding_dims`, `embedding_model` (created by C's migration).
Spec: §5, §6, §11 (ingestion metering).

### C — Retrieval and generation
Owns: `supabase/migrations/20261018120200_retrieval.sql`; `lib/grey/{fusion,prompt,citations}.js` (+ tests); `lib/engine/{retrieval,answer,turn,pipeline_config,usage}.js`; `app/api/chat/route.js`; `lib/api.js` (`apiStream`); `lib/supabase/conversations.js` (`streamChat`); `components/internal/screens/playground/{chat.jsx,chat_kit.jsx}` (streaming, placeholder removal, citation `t` deep link to Sources); `components/internal/screens/pipelines/pipeline_detail.jsx` **retrieval section** (rerank connection + model, temperature hint via `model_caps`, placeholder copy) — not the provider select (A) or Endpoints (D).
Calls: `embedTexts`, `rerank`, `resolveModel` (A); `expandWithGraph`, `shouldUseGraph`, `formatFacts` (E).
Spec: §7.2–7.4, §8.2–8.5, §11 (retrieval metering, caps).

### E — Knowledge graph
Owns: `supabase/migrations/20261018120300_graph_extraction.sql`; `lib/grey/{graph_schema,graph_router,batch}.js` (+ tests); `lib/engine/{graph_extract,graph_retrieve}.js`; `lib/supabase/graph.js` (`ensureDefaultOntology` → RPC); `lib/grey/duplicates.test.js` (normalisation cases).
Calls: `getProcessingModel` (A).
Spec: §10.

### F — Media and Assets
Owns: `lib/engine/transcribe.js`; `lib/engine/drivers/transcribe/{assemblyai,openai}.js`; `lib/grey/chunk_transcript.js` (+ tests, AssemblyAI normalisation fixture test); `app/api/sources/[id]/media-url/route.js`; `components/internal/screens/sources/source_sheet.jsx` (player + `t` seek); `lib/supabase/suite_imports.js` (kind fix); **`../geiger-assets/app/api/internal/assets/[id]/read-url/route.js`** (separate repo — create the file, do not commit there).
Calls: `getProviderSecret`, `loadProvider` (A).
Spec: §9.

### D — Delivery (wave 2)
Owns: `supabase/migrations/20261018120400_delivery_runtime.sql`; `lib/server/{api_key_auth,openai_format,sse,cors,delivery_log}.js`; `lib/server/mcp/{server,tools}.js`; `lib/grey/domains.js` (+ tests; pure `evaluateKey` lives in `lib/grey/api_key_eval.js` + test); `app/api/v1/**`; `app/api/mcp/[serverId]/route.js`; `app/api/widget/**`; `public/widget.js`; `components/internal/screens/usage/constants.js`; `pipeline_detail.jsx` **Endpoints section**.
Calls: `resolvePipelineConfig`, `runPipelineTurn`, `searchChunks`, `recordUsage` (C).
Spec: §12.

### G — Eval runner (wave 2)
Owns: `lib/engine/eval_runner.js` (`claimEvalRun`, `runEvalRun`); `lib/grey/eval_metrics.js` (+ test); `components/internal/screens/quality/evaluations.jsx` (copy only).
Calls: `runPipelineTurn`, `resolvePipelineConfig` (C); `getProcessingModel` (A); `claim_eval_run` SQL (B's migration).
Spec: §13.

## Review pass (coordinator)
After each wave: run `npm test`, lint changed files, cross-check contracts across phases, then a code-review pass over the whole diff before committing. Migrations are applied only after the user confirms (shared Supabase project).
