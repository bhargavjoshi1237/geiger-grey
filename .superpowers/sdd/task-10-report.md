# Task 10 report — Knowledge Bases + Ingestion Presets screens

Worktree: `C:\Pro\geiger-grey\.claude\worktrees\agent-a5aa7af34ca7c9af5`
Branch: `worktree-agent-a5aa7af34ca7c9af5`
Commit: see bottom (added after this report is written and the commit is made).

## Status: Complete

All five steps from the brief are implemented under `components/internal/screens/knowledge/`:

- `constants.js` — `EMBEDDING_MODELS`, `EMBEDDING_MODEL_LABEL`, `KB_STATUS_MAP`, `JOB_STATUS_MAP`, `PRESET_TIER_META`, `PARSER_OPTIONS`, `CHUNK_STRATEGY_OPTIONS`, `DEFAULT_PRESET_CONFIG`.
- `ingestion_settings_form.jsx` — `PresetPicker({ presets, value, onChange })` (tier cards with price/page, "auto" shows the fast–high range) and `IngestionSettingsForm({ value, onChange, disabled, showPrices })` (parser/OCR up top, collapsed `Accordion` "Advanced" with chunking, enrichment, media, graph, and optional pricing fields).
- `kb_dialog.jsx` — `CreateKnowledgeBaseDialog`: name, description, icon (`IconPicker`), preset select, embedding model select with an amber "locked after creation" notice.
- `all_knowledge_bases.jsx` — `AllKnowledgeBasesScreen`: StatsBar, status filter + search, `DataTable` (name/icon, sources, chunks, preset, embedding model, status, updated), optimistic create, archive/restore row action, renders `KnowledgeBaseDetail` when `?kb=` is set.
- `knowledge_base_detail.jsx` — `KnowledgeBaseDetail`: `EditorShell` with sections Sources (delegates to `SourcesTable`), Chunks (`ChunkBrowser`), Ingestion settings (`PresetPicker` + `IngestionSettingsForm`, dirty-state amber notice, Save, "Re-ingest all" that snapshots the effective config onto a fresh job per source via `estimateFileCost`), Activity (jobs table with `Progress`), Danger zone (archive/restore, soft delete with confirm dialog). Each section is keyed by `kb.id` so a direct KB-to-KB URL jump (no unmount of the parent) resets local section state instead of leaking the previous KB's draft.
- `chunk_browser.jsx` — `ChunkBrowser`: server-paginated via `listChunks`, wired to `ListPagination`; derives its loading flag by comparing a query key instead of calling `setState` synchronously inside the fetch effect (the repo's `react-hooks/set-state-in-effect` lint rule flags that pattern).
- `ingestion_presets.jsx` — `IngestionPresetsScreen`: four system preset cards (read-only, "Duplicate" opens the Sheet pre-seeded) + custom presets `DataTable` (edit/duplicate/delete via `ActionMenu`).
- `preset_sheet.jsx` — `PresetSheet`: create/edit Sheet reusing `IngestionSettingsForm` with `showPrices`, plus a live cost preview via `estimateFileCost` for 100 pages and for one hour of media.

Permissions: `useCan("grey.kb.manage")` gates KB create/archive/delete and the Ingestion settings Save/preset pick; `useCan("grey.preset.manage")` gates preset New/Edit/Duplicate/Delete; `useCan("grey.ingestion.run")` gates "Re-ingest all". Gated primary actions are hidden (create buttons) or disabled with a `title` tooltip (Save/Re-ingest/Archive/Delete), per the list recipe.

## Verification

- `npx eslint components/internal/screens/knowledge` → **0 errors** (ran after creating the `node_modules` junction into the worktree per the parallel-execution setup step). No unresolved-import errors were reported for the as-yet-unwritten modules this task depends on (Tasks 5/6/7/9/11) — the configured ruleset (`eslint-config-next/core-web-vitals`) doesn't enforce import resolution, so this is not a signal those paths are wrong, just that lint can't check them yet.
- No `next build` / `next dev` run, per global constraints.
- No test runner invoked — this task has no pure-module interfaces of its own requiring `node --test` (the cost/format/duplicate pure modules belong to Tasks 9/12).

## Dependencies coded against (none of these files exist in this worktree yet — built strictly from the documented interfaces, no stubs created)

- Task 5: `useProject` (`@/context/project-context`), `useCan` (`@/context/rbac-context` — confirmed this exact import path against geiger-events' own `context/rbac-context.js`), `useWorkspaceUrl` (`@/lib/hooks/use-workspace-url`), reading the current KB id as `params.kb` and navigating via `openRecord("kb", id)` / `closeRecord("kb")` (confirmed against the coordinator's binding update on `useWorkspaceUrl`'s generic `params` object; this task never chains `setTab` with `openRecord`/`setParam` in one handler, so the atomic-nav note doesn't otherwise apply here).
- Task 6: `components/internal/shared/{screen_kit,screen_wrappers,editor_shell,pagination,filter_dropdown}.jsx`, `lib/grey/format.js` (`formatCurrency`, `formatRelative`, `formatDuration`).
- Task 7: `lib/supabase/{knowledge_bases,ingestion_presets,sources,ingestion_jobs,chunks}.js` — used exactly the exports listed in the plan's Task 7 interfaces block.
- Task 9: `lib/grey/cost.js` (`estimateFileCost`, `SYSTEM_TIER_PRICES`).
- Task 11: `@/components/internal/screens/sources/sources_table` → `SourcesTable({ projectId, kbId })`, per the brief's explicit fallback contract since Task 11 wasn't done yet in this worktree.

## Concerns / notes for the controller

1. **No migration seed to mirror.** The brief asks `DEFAULT_PRESET_CONFIG` to "mirror migration seed," but no `supabase/migrations/*` file defining the Balanced preset exists anywhere in the repo or worktree yet. I authored it directly from spec §2.2's prose (parser "layout", OCR on, recursive/512/64 chunking, contextual enrichment on, parent-child off, media transcribe on/diarize+keyframes off/45s window, graph extraction off, and the exact prices spec gives: $0.006/page, $0.006/media-min, $0.04/keyframe-min, $0.50/M graph tokens, $1.02/M contextual tokens). If a later migration task seeds different boolean defaults, reconcile `constants.js`'s `DEFAULT_PRESET_CONFIG` against it.
2. **Embedding model `dims`** values in `EMBEDDING_MODELS` (1024/384/3072/1024) are my best real-world estimates for Cohere Embed v5 Pro/Fast, OpenAI text-embedding-3-large, and Voyage 3.5 — not sourced from a spec table (none exists). Cosmetic only (shown as "model · Nd" in the create dialog); doesn't affect behavior.
3. **KB list source/chunk counts** are computed client-side by fetching all of the project's `sources` once and grouping by `kbId` (summing each source's `chunkCount`), rather than via a dedicated aggregate endpoint — `knowledge_bases.js`'s documented interface (`listKnowledgeBases(projectId)`) doesn't return joined counts, and `sources` already carries a denormalized `chunkCount` column per spec §2.2, so this avoids N+1 calls per KB.
4. **Permission-gated tooltip** uses the native `title` attribute rather than `@geiger/ui`'s Radix `Tooltip`/`TooltipProvider` — no existing usage of that component anywhere in the geiger-events reference app to confirm whether a `TooltipProvider` needs mounting at the root (Task 6 territory, out of this task's scope), so I avoided introducing an unverified runtime dependency.
5. Did not touch `components/internal/screens/registry.jsx` (binding rule in `parallel-context.md`) — screens export exactly `AllKnowledgeBasesScreen` and `IngestionPresetsScreen` as named + default exports per the registry contract table.
