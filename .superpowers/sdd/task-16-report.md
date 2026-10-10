# Task 16: Quality (Evaluations, Feedback) — report

Worktree: `C:\Pro\geiger-grey\.claude\worktrees\agent-a4f20d0f358746352`
Branch: `worktree-agent-a4f20d0f358746352`
(Note: this worktree was created from pre-rebuild commit `8474e49`, not current `main`; see
`worktree-base-notice.md`. All files below were written fresh against `@geiger/ui` + the
documented Task 5/6/7 interfaces, not against the stale old shell present in this worktree.)

## Files created

- `components/internal/screens/quality/constants.js` — status maps (`EVAL_RUN_STATUS_MAP`,
  filter options), tab configs (`EVAL_TABS`, `FEEDBACK_TABS`), formatters (`formatDate`,
  `formatDateTime`, `truncate`, `formatMetric`), feedback helpers (`isResolved`,
  `matchesFeedbackTab`), and conversation helpers (`findPreviousUserMessage`,
  `citationSourceIds`).
- `components/internal/screens/quality/use_feedback_rows.js` — `useFeedbackRows(projectId)`
  hook: calls `listFeedbackMessages` + `listPipelines`, then `listMessages` per unique
  conversation to enrich each feedback row with `question` (the prior user turn, via
  `findPreviousUserMessage`). Shared by `feedback.jsx` and `eval_set_sheet.jsx`'s "Add from
  feedback" picker. Also exports `pipelineName(pipelines, id)`.
- `components/internal/screens/quality/eval_set_sheet.jsx` — exports `EvalSetSheet`. Sheet
  detail for one eval set: cases table (question/expected answer/source count/created/actions),
  Add/Edit case dialog (question, expected answer, `TagInput` for `expectedSourceIds`), delete
  confirm, and an "Add from feedback" dialog that lists open (unresolved, negative/unanswered)
  feedback and prefills a case draft from the picked message (question from the prior user
  turn, expected answer from the assistant content, source ids from citations).
- `components/internal/screens/quality/evaluations.jsx` — exports `EvaluationsScreen` (+
  default). `SegmentedTabs` Sets/Runs. Sets tab: table (name/description, case count, created,
  actions) + New/Edit/Delete set dialogs, row click opens `EvalSetSheet`. Runs tab: table (set,
  pipeline@version, status pill, faithfulness/relevance/precision/recall via `formatMetric`,
  created) + status filter + "Run evaluation" dialog (eval set + pipeline selects) that calls
  `createEvalRun` with `pipelineVersion: pipeline.currentVersion`, `status: "queued"`, plus a
  persistent info banner ("Runs execute when the backend is connected").
- `components/internal/screens/quality/feedback.jsx` — exports `FeedbackScreen` (+ default).
  `StatsBar` (Thumbs up/down, Unanswered, Satisfaction %) over all rows from `useFeedbackRows`.
  `SegmentedTabs` Negative/Unanswered/All (`matchesFeedbackTab`, resolved rows excluded from
  Negative/Unanswered, shown with a "Resolved" tag under All) + pipeline filter + search. Row
  actions: "Open conversation" → `openRecordInTab("Conversations", "conversation", id)`; "Add
  to eval set" → dialog prefilling question/expected answer/source ids, lets you pick an
  existing set or create one inline, then `createEvalCase`; "Resolve"/"Reopen" →
  `setMessageFeedback(id, { metadata: { ...m.metadata, resolved: true|false } })`.

No files outside `components/internal/screens/quality/` were touched. `registry.jsx` was left
untouched per the parallel rules — the nav titles these screens correspond to are `"Quality"`,
`"Evaluations"` (`evaluations.jsx` → `EvaluationsScreen`) and `"Feedback"`
(`feedback.jsx` → `FeedbackScreen`), matching the registry contract table exactly.

## Interface usage (consumed, not created)

- `lib/supabase/evals.js`: `listEvalSets/createEvalSet/updateEvalSet/deleteEvalSet`,
  `listEvalCases/createEvalCase/updateEvalCase/deleteEvalCase`,
  `listEvalRuns/createEvalRun`.
- `lib/supabase/conversations.js`: `listFeedbackMessages`, `listMessages`,
  `setMessageFeedback`.
- `lib/supabase/pipelines.js`: `listPipelines` (for `pipeline.currentVersion` and name
  lookups).
- `context/project-context.js` (`useProject`), `context/rbac-context.js` (`useCan`),
  `lib/hooks/use-workspace-url.js` (`useWorkspaceUrl` → `openRecordInTab`, per the
  coordinator's binding mid-task interface update — `setTab` + `openRecord` in the same
  handler would have dropped the param).
- Shared kit: `components/internal/shared/{screen_kit,screen_wrappers,pagination,
  filter_dropdown,tag_input}.jsx` (re-exported `@geiger/ui` primitives + bespoke
  `FilterDropdown`/`TagInput`), plus `LoadingArea` imported directly from `@geiger/ui` (not
  re-exported by the shared kit's documented interface) and `@geiger/ui/{button,action-menu,
  input,textarea,badge,select,dialog,sheet}` subpaths — all consistent with the
  geiger-events reference screens read for this task (`orders/all_orders.jsx`,
  `guests/segments.jsx`, `guests/data_requests.jsx`, `messages/organiser_inbox.jsx`).

## Gating

`grey.eval.manage` via `useCan` gates: New/Edit/Delete eval set, Add/Edit/Delete case, "Add
from feedback", "Run evaluation", "Add to eval set", and Resolve/Reopen. Ungated: viewing lists,
opening a set's sheet, opening a conversation. Gated actions are hidden (not just disabled) when
the permission is absent, since `ActionMenu` items have no tooltip affordance for a disabled
entry — hiding keeps the UI honest about what the user can actually do.

## Verification

- `npx eslint components/internal/screens/quality` → **0 errors, 0 warnings** (run twice, after
  fixing three `react-hooks/set-state-in-effect` errors — this project's eslint config now
  flags any `setState` called synchronously inside a `useEffect` body, including the common
  `setLoading(true)` reset pattern used throughout the sibling screens I read for reference
  (confirmed the same error reproduces in an already-written sibling task's file, e.g.
  `pipelines/all_pipelines.jsx`'s `setLoading(true)` at the top of its load effect — this is a
  repo-wide issue other tasks will likely hit too, not something specific to Quality). Fixed in
  my files by deferring the synchronous reset into a `Promise.resolve().then(...)` microtask —
  verified this pattern clears the rule with a throwaway test file before applying it) — and one
  `react-hooks/exhaustive-deps` warning (fixed by memoizing `pipelineName`/`setName` id→name
  maps with `useMemo` instead of closing over the raw arrays).
- No `node --test` suites apply to this task (no pure-module logic outside tiny pass-through
  helpers already covered by the lint/parse pass).
- Did not run `next dev`/`next build` (not required by this task; a cross-cutting
  `npm run build` happens in Task 18) and did not run a react-hooks runtime check — Tasks 5–7's
  files (`context/project-context.js`, `context/rbac-context.js`,
  `lib/hooks/use-workspace-url.js`, `lib/supabase/{evals,conversations,pipelines}.js`,
  `components/internal/shared/*`) don't exist in this worktree yet, so the screens can't
  actually render here; they were written strictly against the documented interfaces in
  `parallel-context.md` and the plan's Task 5/6/7 Interfaces blocks.

## Concerns / notes for the controller

- `listEvalCases(projectId, setId)` is called once per eval set (via `Promise.all`) just to
  show a case count on the Sets table row. Fine for the expected small N of eval sets in this
  phase; flag if Task 7's real implementation makes that call expensive.
- The "cases count" and the sheet's own case list are fetched independently (not cached/shared)
  — intentional, keeps the list screen and the detail sheet decoupled, at the cost of one extra
  fetch when a set is opened right after the list loads.
- `useFeedbackRows` fetches `listMessages` once per unique conversation among the feedback rows
  to recover "the previous user message" (the brief's required question source), since
  `listFeedbackMessages`'s documented join only guarantees conversation title/pipeline id, not
  the question text. This is an N calls (N = distinct conversations with feedback), acceptable
  for the stub-era data volumes but worth revisiting if `listFeedbackMessages` is later extended
  to return the question directly.
- Spec line for Evaluations ("set detail Sheet with cases table, add/edit case, 'Add from
  feedback'") was implemented in full even though the task brief's own step list only mentioned
  "cases CRUD" — the "Add from feedback" entry point reuses the same `useFeedbackRows` hook as
  the Feedback screen's own "Add to eval set" dialog, so there's one shared enrichment path for
  both directions of that flow.

## Fix round 1

Addressed the coordinator's review of the initial implementation. Confirmed call shapes against
the real data modules now on `main` (`lib/supabase/evals.js`, `lib/supabase/conversations.js`,
`lib/supabase/repository.js`'s `makeRepo`): `create`/`update`/`setMessageFeedback` resolve to the
row or `null` on any failure (there is no separate `false` branch for those — only `remove`
returns a plain boolean). My original `if (saved === null) return;` guards on create/update were
therefore dead code that silently swallowed every failure instead of rolling back.

1. **Rollback on every failed mutation.** `handleSaveCase`/`handleSaveSet` (create: remove the
   optimistic row on `!saved`; update: capture `previous` before the optimistic patch and restore
   it on `!saved`), `handleDelete`/`handleDeleteSet` (capture the row's index before removing it,
   splice it back in at that index on `!ok`), `handleCreateRun` (remove the optimistic run on
   `!saved`), `handleResolve` (capture `previousMetadata` before the optimistic flip, restore it
   on `!saved`). All now check truthiness (`!saved`/`!ok`) rather than `=== false`, matching the
   real modules' actual null-on-failure behavior. Every rollback path also fires a
   `toast.error(...)` so the revert is visible, not silent.
2. **Destructive buttons / Badge.** `evaluations.jsx`'s "Delete eval set" and
   `eval_set_sheet.jsx`'s "Delete case" confirm buttons now use `<Button variant="destructive">`
   instead of raw `bg-red-500/90` classes. `feedback.jsx`'s "Resolved" tag is now
   `<Badge variant="success">Resolved</Badge>` instead of a raw `text-emerald-400` span.
   Status-dot `dotClass` values in `constants.js` (`bg-emerald-400`, `bg-[#737373]`, etc.) were
   left as-is per the review note — those are the suite's established `StatusPill` convention.
3. **Removed all `Promise.resolve().then()` setState deferrals.**
   - `use_feedback_rows.js`: extracted the fetch+enrich logic into a state-free async
     `fetchFeedbackRows(projectId)` helper; the effect now uses a per-run `let alive = true`
     closure (no more shared `aliveRef`) and calls that helper directly — since nothing inside
     the effect's synchronous body calls `setState` anymore (all state is set inside the
     `.then()`), the `react-hooks/set-state-in-effect` rule no longer fires and no deferral is
     needed. `loading` is now derived as `loadedKey !== projectId`, set only inside `.then()`.
   - `eval_set_sheet.jsx`: same treatment — `loading` is `!evalSet?.id || loadedSetId !== evalSet.id`,
     with `setLoadedSetId(evalSet.id)` set only inside the fetch's `.then()`; effect keeps a
     per-run `let alive = true` closure.
   - `evaluations.jsx`'s `RunEvaluationDialog`: replaced the effect with the render-time
     "reset on key change" pattern already used by `CaseEditorDialog`/`SetEditorDialog` in this
     task (a `seeded` flag flipped in the render body, not inside `useEffect`) — resets the
     eval-set/pipeline selects once per dialog open without touching `useEffect` at all.
4. **N+1 comment.** Added a one-line comment in `use_feedback_rows.js` above the per-conversation
   `listMessages` fan-out explaining the N+1 and why it's acceptable at this phase's volumes.
   `listEvalCases` per set in `evaluations.jsx` is unchanged, per the review note.

Verification: `npx eslint components/internal/screens/quality --max-warnings 0` → clean (ran
twice, after the edits above).

Commit: `fix(grey): quality review fixes` on this worktree's branch.
