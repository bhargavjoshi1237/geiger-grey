# Task 11 report — Sources, Upload, Ingestion Jobs

**Worktree:** `C:\Pro\geiger-grey\.claude\worktrees\agent-a399baea31c11a033`
**Branch:** `worktree-agent-a399baea31c11a033`
**Note:** report written inside the worktree (per coordinator instruction) because `C:\Pro\geiger-grey\.superpowers\sdd\` is outside this worktree's sandbox.

## Status: Complete

## Files created
- `components/internal/screens/sources/constants.js` — `SOURCE_STATUS_MAP`, `SOURCE_KIND_ICONS`, `SOURCE_KIND_LABELS`, `SOURCE_ORIGIN_LABELS` (+ filter option lists), `FRESHNESS_MAP`, `freshnessOf(source)`, `JOB_STATUS_MAP`, `JOB_STAGE_LABELS` (+ filter options), `describeSourceSize`, `sourceRef`, `snapshotPreset`.
- `components/internal/screens/sources/sources_table.jsx` — `SourcesTable({ projectId, kbId })`: toolbar (status/kind/origin/KB filters + search), `DataTable`, upload button, row `ActionMenu` (open, re-ingest, mark verified, owner & review date, download, delete), delete-confirm `Dialog`, wires `SourceSheet`, `FreshnessDialog`, `UploadSourcesDialog`.
- `components/internal/screens/sources/source_sheet.jsx` — `SourceSheet`: read-only detail (metadata, ingestion jobs, mentioned entities) + footer actions (download/re-ingest/mark verified/review date/delete).
- `components/internal/screens/sources/freshness_dialog.jsx` — `FreshnessDialog`: owner (user ID) + review-due-date editor.
- `components/internal/screens/sources/upload_sources_dialog.jsx` — `UploadSourcesDialog({ open, onOpenChange, projectId, defaultKbId, onUploaded })`: Upload / Import / Add URL tabs, per-file `analyzeFile` + `estimateFileCost`/`estimateTotal` cost panel, `Dropzone` for drag-and-drop, Start ingestion flow exactly as specified (`uploadSourceFile` → `createSource` → `createJobs`), Import tab via `suite_imports.js` (Assets/Notes checklists), Add URL tab.
- `components/internal/screens/sources/sources.jsx` — `SourcesScreen` (registers "Sources"): `ScreenHeader` + `StatsBar` (Sources, Ready, In progress, Needs review) wrapping `SourcesTable`.
- `components/internal/screens/sources/ingestion_jobs.jsx` — `IngestionJobsScreen` (registers "Ingestion Jobs"): `StatsBar` (Queued, Running, Failed 7d, Est. spend 30d), inline `SectionCard` notice "Processing backend not connected — jobs stay queued.", status/KB filters, table (source, KB, preset tier, stage, `Progress`, status, est/actual cost, created), retry (new job) / cancel (queued→cancelled) row actions.

No files outside `components/internal/screens/sources/` were touched; `registry.jsx` was not edited.

## Binding-notice follow-ups applied
- Confirmed no imports from `@/components/ui/*`, `@/components/grey/*`, or the pre-rebuild `components/internal` shell — everything comes from `@geiger/ui`, `@/components/internal/shared/*` (interface paths per parallel-context, not files that exist yet in this worktree), `@/context/*`, `@/lib/*`.
- `SourcesTable` opens/closes the detail sheet via `useWorkspaceUrl().openRecord("source", id)` / `closeRecord("source")`, reading the open id from `url.params.source`, so `?source=<id>` (e.g. a Playground citation link) opens the sheet. Never paired with `setTab` in the same handler.
- `FilterDropdown` is imported from `@/components/internal/shared/filter_dropdown` (not the old `screens/overview/filter_dropdown` events path), matching the parallel-context mapping.

## Interfaces consumed (per parallel-context, not present in this worktree — expected)
`lib/supabase/{knowledge_bases,ingestion_presets,sources,ingestion_jobs,graph,suite_imports}.js`, `lib/grey/{cost,file_analysis,format}.js`, `components/internal/shared/{screen_kit,screen_wrappers,pagination,filter_dropdown,dropzone}.jsx`, `lib/hooks/use-workspace-url.js`, `context/{project-context,rbac-context}.js`, `@geiger/ui` (resolved live through the node_modules junction).

## Interfaces produced (binding, used by Task 10 and others)
```js
export function SourcesTable({ projectId, kbId })
export function UploadSourcesDialog({ open, onOpenChange, projectId, defaultKbId, onUploaded })
export const SOURCE_STATUS_MAP, SOURCE_KIND_ICONS
export function freshnessOf(source) // "verified" | "review_due" | "stale" | "none"
```

## Design decisions / assumptions (flagging for integration review)
1. **`presetSnapshot` shape** — stored as `{ id, name, tier, config }` (via `snapshotPreset(preset)` in constants.js) rather than just `preset.config`, so the Ingestion Jobs table can show "preset tier" without re-joining `ingestion_presets` (which may have since changed or been deleted). The brief's pseudocode said `presetSnapshot: preset`; this is the richer reading of that.
2. **`estimatedCost`** on created jobs is the midpoint of `estimateFileCost(...).low/.high` (handles the `auto` tier's range); for Import/Add-URL sources (no file analysis available) it's `null`.
3. **`listMentions(projectId, { entityId })`** — the Source Sheet needs mentions *for a source*, not *for an entity*. I call `listMentions(projectId, {})` (omitting `entityId`) and filter the returned rows client-side by `sourceId`. This assumes the data function tolerates a missing `entityId` and returns the full (soft-deleted-excluded) project list rather than throwing/returning null. If Task 7's implementation instead requires `entityId`, the Sheet's "Mentioned entities" section will just always show "No graph mentions yet." (non-fatal).
4. **Permission gating beyond the three named gates** — the brief only names `grey.source.upload`, `grey.source.delete`, `grey.ingestion.run`. "Mark verified" and "Owner & review date" aren't explicitly covered; I gated both under `grey.source.upload` as the closest "manage this source" permission. Download is ungated (implicit view-level access). Worth a second look during the permission-catalog pass.
5. **Freshness rule** (`freshnessOf`): `stale` if `reviewDueAt` is in the past; `review_due` if `reviewDueAt` is within the next 7 days; `verified` if `verifiedAt` is set and neither of the above; else `none`. Pure, exported, no hidden state.
6. **Owner field** — "set owner" in `FreshnessDialog` is a plain text input for a user ID (no team-member picker), since a people-picker component/interface wasn't in this task's dependency list (team.js is Task 5's file, not called out as an interface Task 11 may rely on).
7. **React-compiler lint rules** — this repo's eslint config enforces `react-hooks/set-state-in-effect` and `react-hooks/purity` (newer `eslint-plugin-react-hooks` rules). All data-fetch effects were written to only call `setState` inside the `.then()` continuation (never synchronously in the effect body), and "reset state when a prop changes" uses the React-endorsed render-time adjustment pattern (as in `events`' `ContactDrawer`/`OverviewTab`) instead of an effect. A derived `asOf` state (set when jobs are fetched) replaces a direct `Date.now()` call inside a `useMemo` in `ingestion_jobs.jsx`.

## Verification
- `npx eslint components/internal/screens/sources` → **0 errors, 0 warnings** (including `--max-warnings=0`).
- No `next dev`/`next build` run (not required — no significant UI build-verification trigger per AGENTS.md, and global-constraints forbid `next build` outside Task 18).
- No pure-module unit tests were required for this task's files (constants.js is pure but no test file was specified in the brief).
- Manually traced every call site against the Task 7/9 interface signatures given in `docs/superpowers/plans/2026-10-10-grey-frontend.md` (listSources/getSource/createSource/updateSource/deleteSource/uploadSourceFile/getSourceDownloadUrl, listJobs/createJobs/updateJob, listKnowledgeBases/getKnowledgeBase, listPresets, listEntities/listMentions, listImportableAssets/listImportableNotes, estimateFileCost/estimateTotal, analyzeFile, format helpers) — all argument shapes match.

## Concerns for the controller
- See assumptions 3 and 4 above — worth a quick cross-check once Task 7 (graph.js's `listMentions` signature) and the permission catalog are finalized.
- `SourcesTable` is fully self-contained (own data loading, toolbar, upload dialog) as required so Task 10 can embed it directly at `@/components/internal/screens/sources/sources_table` with `kbId` set.

## Fix round 1

Addressed the coordinator's review fixes:

1. **`createJobs` failure handling.** `createJobs` (the real module on main) returns `[]` on failure, so every call site now checks `!created?.length` (not just `!created`): `sources_table.jsx` `handleReingest`, and `upload_sources_dialog.jsx` `startUpload`/`startImport`/`startAddUrl`. When a source was already created but the job failed, the source is marked `status: "failed"` via `updateSource` (best effort) instead of being left "queued" with no job behind it. `startUpload`/`startImport` now track `queued` vs `failed` counts and report both in the summary toast (e.g. "2 sources queued, 1 failed.").
2. **Optimistic-update rollback.** `handleMarkVerified`, `handleSaveFreshness`, and `handleReingest` (`sources_table.jsx`) and `handleCancel` (`ingestion_jobs.jsx`) all capture the previous value(s) before the optimistic `setState`, and revert to them on failure (`handleSaveFreshness` reverts exactly the keys present in the patch, generically).
3. **Guards in `upload_sources_dialog.jsx`.** `startUpload` now null-guards `preset` before calling `estimateFileCost` (toasts and aborts if no preset is selected). `addFiles` wraps `analyzeFile` in try/catch — a failing file is marked `analysisError: true`, shown as "Couldn't analyze" with an `AlertTriangle` icon, and naturally excluded from upload (its `analysis` stays `null`, so the existing `files.filter((f) => f.analysis)` ready-list skips it). All three `start*` handlers now wrap their body in `try { ... } finally { setBusy(false); }` so `busy` always resets even if something throws.
4. **DRY.** Added `buildQueuedJob({ kbId, sourceId, preset, estimatedCost })` to `constants.js` (wraps `snapshotPreset` + the fixed `status/stage/progress` shape) and switched all four call sites (`sources_table.jsx` reingest; `upload_sources_dialog.jsx` startUpload/startImport/startAddUrl) to use it instead of repeating the job-object literal.
5. **Minor.** Delete-confirmation dialog's button icon in `sources_table.jsx` changed from `Ban` to `Trash2` (matching the row-action icon). `freshnessOf` in `constants.js` now reads a source as "Verified" when `verifiedAt >= reviewDueAt` (checked before the stale/review-due branches), so "Mark verified" visibly clears a "Stale"/"Review due" badge instead of leaving it behind an older review date.

Verification: `npx eslint components/internal/screens/sources --max-warnings 0` → 0 errors, 0 warnings.
