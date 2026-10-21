# Lookup tools and visual search — implementation plan

**Spec:** `docs/superpowers/specs/2026-10-21-lookup-tools-design.md` — read it first; this plan adds ownership, order and rules. Contracts in spec §5 are exact.
**Branch:** `feat/lookup-tools`. Implementers do **not** commit — the coordinator reviews and commits per wave.
**Already done by the coordinator:** the migration `supabase/migrations/20261021120000_lookup_tools.sql`, the RBAC/nav changes (`geiger-rbac.config.js`, `lib/workspace/nav_tree.js`, `components/internal/sidebar/sidebar_nav.jsx`), and stub exports so parallel work links (`embedImages`, `kbImageSupport` in `lib/engine/embeddings.js`; `searchByVector` in `lib/engine/retrieval.js`; stub files `lib/grey/image_input.js`, `lib/engine/media.js`). Owners replace the stubs.

## Ground rules (every implementer)

1. Plain JS, ESM. `lib/grey/` = pure (no I/O; may be imported by the browser unless the file says otherwise). `lib/engine/` = shared server runtime used by Next routes **and** the worker under plain Node 24: relative imports with explicit `.js` extensions, no `server-only`, no `next/*`, no `@/` alias. `lib/server/` = route-only helpers (may use `@/`, `next/*`).
2. Engine functions take the service-role `admin` Supabase client (schema `grey`); never construct clients in `lib/engine/`. pgvector values are strings `'[0.1,…]'` (`toPgVector`).
3. Never read provider keys from env; `connectProvider()` / `getProviderSecret()` at call time; never log, cache or return them.
4. Next.js 16: before writing a route handler, read the relevant guide in `node_modules/next/dist/docs/` (route params are Promises; `export const runtime = "nodejs"`; long routes `maxDuration`). Match existing route style: `handle()` / `ApiError` / `requirePermission` / `toCamel` for session routes, `handleApi` / `authenticateApiKey` for v1.
5. UI: reuse existing components and patterns (`@geiger/ui` incl. `@geiger/ui/<component>`, shadcn, lucide, `components/internal/shared/*`, the Pipelines editor and Playground chat as references). Keep copy short, sentence case, consistent with neighbouring screens.
6. Migrations: the coordinator owns them. If you need a schema change, stop and report it. **Never apply migrations or write to the database.**
7. Tests: `node --test`; one `*.test.js` beside each pure/engine module you add (`*.test.mjs` under `worker/test/`). Before finishing run `npm test` in the repo root **and** `npm test` in `worker/`; all must pass. Lint every file you touched: `npx eslint <files>`. **Do not run `next build`** and do not start the dev server.
8. Do not edit files owned by another task. If you need a change there, put it in your final report.
9. `npm install` only where your task says so (exact pins; root and worker must match for shared deps — `worker/test/deps_sync.test.mjs`).
10. Final report: files changed, contracts implemented (and any deviation, with reason), tests added, anything left for others.

## Wave 1 (parallel)

### B — Image embeddings
Owns: `lib/grey/embedding_models.js` (+ test), `lib/engine/embeddings.js` (+ test; replace the stubs), `lib/engine/drivers/embed/{google,voyage,cohere,nomic}.js`, `lib/grey/provider_kinds.js` (+ test) only for suggestion data, `components/internal/screens/knowledge/{kb_dialog.jsx,constants.js}` (a small "Text + images" hint for image-capable models).
Spec: §5.4. Note the gemini-embedding-2 text fix and the voyage-multimodal text path. Mock `fetch` in tests (drivers accept `fetch`).

### C — Image ingestion
Owns: `lib/grey/image_input.js` (+ test; replace the stub), `lib/engine/image.js` (+ test), `lib/engine/vision.js` (+ test), new `worker/ingest/image.mjs`, `worker/ingest/run.mjs`, `worker/db.mjs` (`modality` column in staged inserts), `worker/test/**` (new `image.test.mjs`; extend `run.test.mjs`), `lib/grey/ocr_routing.js` (+ test) comments/messages only, root `package.json` + `worker/package.json` (+ locks) for `sharp@0.35.5`.
Spec: §4, §5.1–5.3, §7. Images route to the new image branch before `prepareDocument`; the image chunk carries a precomputed vector when the KB model is multimodal (`kbImageSupport` + `embedImages`), otherwise the caption is text-embedded by the normal embed loop. Upload the thumbnail with `admin.storage.from("grey-sources").upload(thumbnailPath(…), bytes, { upsert: true, contentType: "image/jpeg" })`. Cache the caption result like the parse cache (key on content hash + vision model) so re-ingest doesn't re-pay. Bill one page (`pageUsage`). Record vision tokens as `byokUsage("contextual_tokens", …, { model, purpose: "image_caption" })`.

### D — Retrieval and media
Owns: `lib/engine/retrieval.js` (replace the `searchByVector` stub; add `retrieval.test.js` with a fake `admin.rpc`/`from`), `lib/engine/media.js` (+ test; replace the stub), `app/api/sources/[id]/media-url/route.js`.
Spec: §5.5. Pass the new SQL params by name (`p_modality`, `p_source_ids`, `p_exclude_source_ids`); keep every existing behaviour and meta field.

### E — Tool core
Owns: `lib/grey/tool_spec.js`, `lib/grey/knn_vote.js`, `lib/grey/tool_metrics.js`, `lib/engine/tool_runtime.js`, `lib/engine/tool_tests.js`, `lib/engine/tool_runs.js` (+ a test for each).
Spec: §5.6–5.8. Inject `deps` for everything with I/O so tests run without a database or a model. Use `generateText` + `Output.choice`/`Output.object` from `ai@7` (see `lib/engine/graph_extract.js` for the call pattern, `NoObjectGeneratedError` handling and `mapLlmError`), and image parts `{ type: "image", image: <base64>, mediaType }`.

## Wave 2 (parallel, after wave 1 is reviewed)

### F — Routes and delivery
Owns: `app/api/tools/[toolId]/{run,test,publish}/route.js`, `app/api/v1/tools/[toolId]/run/route.js`, `lib/grey/api_key_eval.js` (+ test), `lib/server/api_key_auth.js`, `app/api/api-keys/route.js`, `lib/server/mcp/tools.js` (+ test), `app/api/mcp/[serverId]/route.js` (only if needed), `lib/supabase/{api_keys,mcp_servers}.js`, `components/internal/screens/delivery/{constants.js,api_key_dialog.jsx,api_keys.jsx,mcp_server_dialog.jsx,mcp_server_sheet.jsx,mcp_servers.jsx}`.
Spec: §5.10.

### G — Tools UI and source labels
Owns: `lib/supabase/tools.js` (client contract below), `components/internal/screens/tools/*` except `tool_builder.jsx`, `components/internal/screens/registry.jsx` (register "Tools"), `components/internal/screens/sources/{source_sheet.jsx,constants.js}`, `lib/supabase/sources.js` (labels).
Exports H relies on: `ToolRunner({ tool, projectId, version = 0, compact = false })` from `tool_runner.jsx`, `ToolResultView({ result, onOpenSource })` from `tool_result.jsx`; `tool_detail.jsx` renders `<ToolBuilderPanel tool projectId canManage onToolChange />` from `./tool_builder` in the **Build** section.

### H — Builder
Owns: `lib/grey/tool_builder.js` (+ test), `lib/engine/tool_builder.js`, `app/api/tools/[toolId]/builder/route.js`, `app/api/tools/[toolId]/builder/undo/route.js`, `components/internal/screens/tools/tool_builder.jsx` (exports `ToolBuilderPanel`).
Spec: §5.9. Reuse `MessageList`/`Composer` from `components/internal/screens/playground/chat_kit.jsx`.

### Client contract — `lib/supabase/tools.js` (G implements, H consumes)
```js
listTools(projectId)                                   // -> Tool[] camelCase (id, name, description, spec, status, currentVersion, testReport, updatedAt, …)
getTool(id)                                            // -> Tool | null
createTool(projectId, { name, description, spec })     // -> Tool | null
updateTool(id, { name, description, spec })            // -> Tool | null (only given keys)
deleteTool(id)                                         // -> boolean (soft delete)
listToolVersions(projectId, toolId)                    // -> Version[] newest first
listToolMessages(projectId, toolId)                    // -> Message[] oldest first
listToolRuns(projectId, toolId, { limit = 20 } = {})   // -> Run[] newest first
runToolRequest({ projectId, toolId, text, image, version })   // apiFetch -> { data: { result, runId }, error, message }
runToolTestsRequest({ projectId, toolId, includeLlm })        // apiFetch -> { data: { report } }
publishToolRequest({ projectId, toolId, note })               // apiFetch -> { data: { tool, version } }
streamBuilderTurn({ projectId, toolId, content, onEvent, signal }) // apiStream
undoBuilderTurn({ projectId, toolId, messageId })             // apiFetch -> { data: { tool } }
```

## Review pass (coordinator)
After each wave: `npm test` (root + worker), lint changed files, cross-check contracts, a code-review pass over the wave's diff, fix, commit. After wave 2: one `next build` (this is a significant UI addition) and a final review. Migrations are applied only after the user confirms.
