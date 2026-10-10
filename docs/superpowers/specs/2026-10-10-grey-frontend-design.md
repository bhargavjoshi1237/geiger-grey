# Geiger Grey frontend — design

Date: 2026-10-10. Status: approved in brainstorming (sections 1–2 explicitly; 3–4 accepted with "implement").

Grey is the suite's knowledge layer: users upload media into Knowledge Bases, pick ingestion presets, get chunks plus one project-wide knowledge graph, then query it in a Playground or serve it to their own LLM/apps through Pipelines, API keys, MCP servers and widgets. Background: `reports/RAG platform competitor research.md`.

## Scope

- Full frontend for every screen in the nav tree below, backed by real `grey` schema tables (migrations + `lib/supabase` data layer).
- Processing is stubbed: ingestion jobs are created `queued` and stay there; the chat API returns a labelled placeholder answer. A later backend phase (parsing, embeddings, retrieval, LLM serving, MCP/widget endpoints) replaces the stubs without UI changes.
- Out of scope: ingestion workers, pgvector, real LLM calls, MCP/widget runtime endpoints (return 501), billing/Stripe, external connectors (Drive/Notion).

## 1. Foundation (mirrors geiger-events)

**Packages.** Add `@geiger/ui` (pinned to the events SHA `00cac4f5…`), `@geiger/rbac` (events SHA `1835de37…`), `@geiger/orm` (`#master`), `@geiger/notify` (`file:../geiger-notify`), `sonner`. Remove `react-icons`, `@dnd-kit/*`, `vercel`, and the local `components/ui/*` (all imports move to `@geiger/ui`, barrel or subpath). Keep `react-force-graph-2d/3d`, `three`, `recharts`, `date-fns`.

**Config.** `next.config.mjs`: `basePath: isProd ? '/grey' : ''`, `NEXT_PUBLIC_BASE_PATH`, `transpilePackages: ["@geiger/ui", "@geiger/notify"]`. `app/globals.css` follows the @geiger/ui README: `tailwindcss`, `tw-animate-css`, `shadcn/tailwind.css`, `@geiger/ui/tokens.css`, `@source` for ui and notify; no local token copies. `public/logo1.svg` copied from events. Root files: `geiger-ui.config.js`, `geiger-rbac.config.js` (+ `geiger-rbac.config.test.js`), `geiger-orm.config.mjs` (`{ schema: "grey", url: process.env.STRING_URI }`). Scripts: `db:push|status|rollback|new|seed`, `ui:update`, `test` (`node --test`).

**Routes.**
- `app/page.js` → redirect `/project`.
- `app/project/page.js` → client resolver (last project in localStorage `geiger-grey:last-project`, else first, else NoProjects state with create dialog).
- `app/project/[projectId]/layout.js` (`dynamic = "force-static"`) → `workspace_layout.jsx`.
- `app/project/[projectId]/[[...rest]]/page.js` → `ScreenArea` rendering `getScreen(tab)` or `ComingSoonScreen`.
- `app/api/**` route handlers for server-only work (section 2.7).
- Removed: `app/[projectid]`, `app/pallet`, `app/palletw`, `components/internal/*` (old shell), old `context/*`, `utils/supabase/*`, `lib/supabase/{pfp,user}.js` replaced, `supabase/sqls/*` (Flow-owned legacy).

**Shell.** `workspace_layout.jsx`: `Suspense > ProjectProvider > RbacProvider > NavVisibilityProvider > WorkspaceShell`. `WorkspaceShell` = `SidebarProvider` (flex-col) → `Topbar` → row of `AppSidebar` + `SidebarInset > main.flex-1.overflow-y-auto.p-4.md:p-8`.
- `Topbar` wraps `@geiger/ui` `Topbar`: `label="Grey"`, `logoSrc={BASE_PATH + "/logo1.svg"}`, `searchNav={visibleNav}`, `searchRecentsKey="geiger:grey:search-recents"`, `notifications={<NotificationsBell app="grey"/>}`, `profile={<ProfileDropdown/>}`.
- `AppSidebar` uses `@geiger/ui` sidebar parts, `collapsible="icon"`, skeleton while `useNavLoading()`.
- Ported from events (renamed prefixes `geiger-grey:`): `lib/hooks/use-workspace-url.js`, `lib/workspace/tabs.js`, `lib/workspace/shell_cache.js`, `lib/hooks/use-visible-nav.js` (RBAC filter on top-level sections → `applyNavVisibility`), `components/internal/shared/{screen_kit,screen_wrappers,editor_shell,pagination}.jsx`, `context/{project,rbac,nav-visibility}-context.js`.
- Loading: `LoadingArea`/`LoadingScreen`/`LogoLoading` (no `name` prop) for blocks; `Loader2` only on buttons/inline.

**Nav tree** (`components/internal/sidebar/sidebar_nav.jsx`, titles are the keys):

| Section | Sub-items |
|---|---|
| Overview | — |
| Knowledge Bases | All Knowledge Bases, Sources, Ingestion Jobs, Ingestion Presets |
| Knowledge Graph | Graph Explorer, Entities, Ontology |
| Playground | Chat, Conversations |
| Pipelines | All Pipelines, Model Providers |
| Delivery | API Keys, MCP Servers, Widgets |
| Quality | Evaluations, Feedback |
| Usage | Usage & Costs, Request Logs |
| Settings | General, Team & Members, Roles & Permissions, Navigation, Data Export |

**Nav config** (`geiger-ui.config.js`): `product: "grey"`, `locked: ["Overview", "Knowledge Bases", "All Knowledge Bases", "Settings", "Navigation"]`, dependencies: Knowledge Graph → Knowledge Bases; Playground → Pipelines; Evaluations → Pipelines; Request Logs → Pipelines; MCP Servers → API Keys; Widgets → API Keys.

## 2. Data model (`grey` schema)

All tables: `id uuid pk default gen_random_uuid()`, `project_id uuid references public.projects(id) on delete cascade`, `metadata jsonb default '{}'`, `created_by uuid`, `created_at`, `updated_at` (trigger `grey.touch_updated_at`), `deleted_at`. RLS enabled; policy `grey.can_access_project(project_id)` for `authenticated` (same membership chain as `events.can_access_project`). Data files never read soft-deleted rows.

### 2.1 Core, RBAC, team
- `grey.can_access_project(uuid)`, `grey.touch_updated_at()`; grants on schema to `anon, authenticated, service_role`.
- RBAC: `migrationSql("grey")` output (`grey.role_grants`, `grey.rbac_allows`) + owner backfill.
- Team (ported from events, schema renamed): `grey.project_members`, `grey.member_activity`, RPCs `grey.rbac_ensure_membership`, `grey.rbac_role_for_member`, `grey.sync_project_team`; write guards on roles/grants/members.
- `grey.user_nav_prefs` (`user_id`, `hidden jsonb`).

### 2.2 Ingestion
- `ingestion_presets`: `name`, `tier` (`fast|balanced|high|auto|custom`), `is_system bool`, `description`, `config jsonb`. System rows have `project_id null`, readable by all authenticated users. `config` shape:
  ```
  { parser: "text|layout|vlm|auto", ocr: bool, chunking: { strategy: "recursive|fixed|semantic|page", size: 512, overlap: 64, atomicTables: true, headingBreadcrumbs: true },
    enrichment: { contextual: bool, parentChild: bool }, media: { transcribe: bool, diarize: bool, keyframes: bool, windowSeconds: 45 },
    graph: { extract: bool }, prices: { perPage, perMediaMinute, perKeyframeMinute, perMillionTokensGraph, perMillionTokensContextual } }
  ```
  Seeds: Fast ($0.002/page), Balanced ($0.006/page, default), High accuracy ($0.02/page), Auto (routes; estimate shows Fast–High range). Media $0.006/min, keyframes $0.04/min, graph $0.50/M tokens, contextual $1.02/M tokens.
- `knowledge_bases`: `name`, `description`, `icon`, `status` (`active|archived`), `preset_id`, `embedding_model` (immutable after create; options `cohere-embed-5-pro`, `cohere-embed-5-fast`, `openai-text-embedding-3-large`, `voyage-3.5`), `chunk_config jsonb` (overrides), `retrieval_defaults jsonb`.
- `sources`: `kb_id`, `name`, `kind` (`document|audio|video|image|web|note`), `origin` (`upload|assets|notes|content|url`), `origin_ref`, `mime`, `bytes`, `page_count`, `duration_ms`, `storage_path`, `content_hash`, `status` (`pending|queued|processing|ready|failed`), `chunk_count`, `token_count`, `owner_id`, `review_due_at`, `verified_at`.
- `ingestion_jobs`: `kb_id`, `source_id`, `preset_snapshot jsonb`, `status` (`queued|running|succeeded|failed|cancelled`), `stage` (`parse|chunk|embed|graph`), `progress int`, `estimated_cost numeric`, `actual_cost numeric`, `error`, `started_at`, `finished_at`.
- `chunks`: `kb_id`, `source_id`, `ordinal`, `content`, `token_count`, `page`, `start_ms`, `end_ms`, `heading_path text[]`. (No vector yet.)
- Storage bucket `grey-sources` (private), path `<projectId>/<kbId>/<sourceId>/<filename>`, storage RLS via `grey.can_access_project((storage.foldername(name))[1]::uuid)`.

### 2.3 Graph
- `kg_types`: `kind` (`entity|relation`), `name`, `color` (chart token name `chart-1..5`), `description`, `is_default`. Default set seeded per project on first load (`ensureDefaultOntology`): entities Person, Organization, Product, Location, Event, Concept, Document, Other; relations works_at, part_of, mentions, related_to, located_in, created.
- `kg_entities`: `type_id`, `name`, `aliases text[]`, `description`, `properties jsonb`, `source_app` (`grey|forms|manual`), `confidence numeric`, `merged_into uuid`.
- `kg_relations`: `source_entity_id`, `target_entity_id`, `type_id`, `valid_from`, `valid_to`, `confidence`.
- `kg_mentions`: `entity_id`, `relation_id`, `source_id`, `chunk_id`, `page`, `start_ms`.
- Replaces `grey_knowledge_nodes` (never migrated).

### 2.4 Pipelines and chat
- `model_providers`: `name`, `provider` (`openai|anthropic|google|openrouter|openai_compatible|grey_hosted`), `base_url`, `secret_id uuid` (Vault), `key_last4`, `status` (`unverified|ok|error`), `last_checked_at`, `models text[]`.
- `pipelines`: `name`, `description`, `kb_ids uuid[]`, `provider_id`, `model`, `temperature`, `max_tokens`, `system_prompt`, `retrieval jsonb` (`topK`, `rerank`, `threshold`, `hybrid`, `graphMode: off|auto|always`, `citations`), `status` (`draft|live`), `current_version int`.
- `pipeline_versions`: `pipeline_id`, `version`, `config jsonb`, `note`, `published_by`.
- `conversations`: `pipeline_id`, `user_id`, `title`, `channel` (`playground|widget|api`).
- `messages`: `conversation_id`, `role` (`user|assistant`), `content`, `citations jsonb` (`[{sourceId, chunkId, title, page, startMs, snippet}]`), `feedback` (`up|down|null`), `feedback_note`, `unanswered bool`, `latency_ms`, `tokens_in`, `tokens_out`.

### 2.5 Delivery
- `api_keys`: `name`, `prefix` (`gk_live_xxxx`), `key_hash` (sha-256 hex), `scopes text[]` (`retrieve|chat|mcp`), `pipeline_ids uuid[]`, `rate_limit_per_min`, `last_used_at`, `expires_at`, `revoked_at`.
- `mcp_servers`: `name`, `kb_ids uuid[]`, `pipeline_id`, `api_key_id`, `tools jsonb` (`search`, `ask`, `get_entity`, `list_sources` toggles), `status` (`enabled|disabled`).
- `widgets`: `name`, `pipeline_id`, `api_key_id`, `allowed_domains text[]`, `theme jsonb` (`position`, `accent`, `title`, `greeting`, `placeholder`), `white_label bool`, `status`.

### 2.6 Quality and usage
- `eval_sets` (`name`, `description`), `eval_cases` (`eval_set_id`, `question`, `expected_answer`, `expected_source_ids uuid[]`), `eval_runs` (`eval_set_id`, `pipeline_id`, `pipeline_version`, `status` `queued|running|completed|failed`, `metrics jsonb` `{faithfulness, answerRelevance, contextPrecision, contextRecall}`), `eval_results` (`eval_run_id`, `eval_case_id`, `answer`, `scores jsonb`).
- `request_logs`: `pipeline_id`, `api_key_id`, `conversation_id`, `channel`, `query`, `status` (`ok|error|stub`), `latency_ms`, `retrieved jsonb`, `tokens_in`, `tokens_out`, `cost`.
- `usage_events`: `kind` (`page|media_minute|retrieval|llm_tokens|graph_tokens|contextual_tokens|storage_gb`), `quantity`, `unit_cost`, `cost`, `ref_type`, `ref_id`, `occurred_at`.
- `project_settings` (unique per project): `default_preset_id`, `default_embedding_model`, `monthly_soft_cap numeric`, `cap_behavior` (`alert|retrieval_only|pause_ingestion`), `alert_emails text[]`, `retention_days`, `log_queries bool`.

### 2.7 Server-only route handlers (`app/api/**`)
All verify the Supabase session (cookie or bearer), load roles/grants, and `evaluate()` the permission server-side (port of events `lib/operations/server/access.js`) before using `adminClient()`.
- `POST /api/providers/[id]/secret` (`grey.provider.manage`): stores key via security-definer RPC `grey.set_provider_secret(provider_id, secret)` → `vault.create_secret`/`update_secret`; saves `key_last4`.
- `POST /api/providers/[id]/test` (`grey.provider.manage`): stub check, sets `status` (`ok` when a secret exists) and `last_checked_at`.
- `POST /api/api-keys` (`grey.apikey.manage`): generates `gk_live_<32 random>`, stores prefix+hash, returns plaintext once.
- `POST /api/chat` (`grey.playground.view`): inserts user message, builds placeholder answer ("Grey retrieval backend not connected yet — this is a placeholder answer.") with up to 3 citations from real `chunks` of the pipeline's KBs (else from `sources`), inserts assistant message, `request_logs` (`status: stub`) and one `usage_events` (`retrieval`, qty 1, cost 0).
- `GET|POST /api/v1/*` and `/api/mcp/[serverId]`: 501 `{ error: "not_implemented" }`.

## 3. Screens

All screens are `"use client"` named exports in `components/internal/screens/<area>/<name>.jsx`, registered in `components/internal/screens/registry.jsx` by nav title. List recipe: `MainScreenWrapper` → `ScreenHeader` → `StatsBar` → `Toolbar` (filters + `SearchInput`) → `LoadingArea` | `DataTable` with `StatusPill` cells and `ActionMenu` row actions | `EmptyState` (separate filtered-empty) → `ListPagination`. Detail = `EditorShell` with `?section=`. Create/edit = `Dialog` with a draft object + `set(key)` updater wrapped in `Field`. Mutations optimistic with `crypto.randomUUID()` ids, `toast.success`/`toast.error` + rollback. Status maps and option lists in `<area>/constants.js`. Actions hidden or disabled (with tooltip) when `useCan(key)` is false.

**Overview** — StatsBar (Knowledge bases, Sources, Entities, Queries 7d, Spend this month vs soft cap); recent ingestion jobs table; recent conversations; quick actions (New knowledge base, Upload sources, Open playground); setup checklist (create KB → upload → create pipeline → add provider → create API key) driven by real counts.

**All Knowledge Bases** — table (name, sources, chunks, preset, embedding model, status, updated). New KB dialog: name, description, icon (`IconPicker`), preset select, embedding model (warning: locked after creation). `?kb=` opens `KnowledgeBaseDetail` (`EditorShell`), sections:
- *Sources* — KB-scoped sources table + Upload.
- *Chunks* — paginated chunk browser (content preview, page/timestamp, heading path); empty state explains chunks appear after ingestion.
- *Ingestion settings* — preset picker cards (tier, price/page, description) + collapsed "Advanced" `Accordion` (chunk strategy/size/overlap, atomic tables, breadcrumbs, contextual enrichment, parent-child, media transcribe/diarize/keyframes window, graph extraction); embedding model shown read-only; amber notice when a change requires re-ingestion; Save + "Re-ingest all" (creates jobs).
- *Activity* — jobs for this KB.
- *Danger zone* — archive / delete.

**Sources** — cross-KB table (name, kind icon, KB, origin, size/pages/duration, status, freshness badge: Verified / Review due / Stale). Filters: KB, kind, status, origin. Upload flow = `UploadSourcesDialog`: KB select, drag-and-drop dropzone (bespoke, `border-dashed border-border`) + `FileInput` fallback; per-file analysis (PDF page count via `/Type /Page` scan, audio/video duration via media metadata, images = 1 page, text tokens ≈ chars/4); preset select; **cost estimate panel** (per file + total, Auto shows range) from `lib/grey/cost.js`; Start ingestion → uploads to storage with progress, inserts `sources` (`queued`) and `ingestion_jobs` (`queued`, `estimated_cost`). Import tab: from Assets (lists `assets` schema rows if readable, else EmptyState) and Notes (same), and "Add URL". Row actions: open, re-ingest, mark verified, set owner/review date (`Dialog`), download, delete. Row click → `SourceDetail` `Sheet` (metadata, jobs, chunks count, mentions).

**Ingestion Jobs** — StatsBar (Queued, Running, Failed 7d, Estimated spend 30d); table (source, KB, preset tier, stage, `Progress`, status, est vs actual cost, created); filters status/KB; row actions retry (new job), cancel (queued → cancelled). Info banner: "Processing backend not connected — jobs stay queued."

**Ingestion Presets** — cards for the four system presets (read-only, "Duplicate") + custom presets table; preset editor `Sheet` with the same settings form as KB ingestion settings (shared component `IngestionSettingsForm`) and a live "cost per 100 pages / per hour of media" preview.

**Graph Explorer** — refactor `components/grey/knowledge-graph.jsx` to read `kg_entities`/`kg_relations`/`kg_types` (no fallback demo graph; EmptyState with "Add entity" / "Upload sources" when empty); colours from CSS tokens resolved at runtime (`getComputedStyle`) instead of hardcoded hex; existing 2D/3D toggle, forces panel, zoom kept; add type filter chips, search-to-focus, KB filter (via mentions); node click opens `EntityPanel` `Sheet` (name, type, aliases, description, relations list, "Mentioned in" with jump to source, `source_app` badge, confidence, Edit, "Ask about this" → Playground Chat with prefilled question). Restyle overlays with semantic tokens.

**Entities** — table (name, type pill, relations count, mentions, source app, confidence, updated); New entity dialog; edit; delete; "Possible duplicates" tab: groups by normalized-name/alias overlap computed client-side, Merge dialog (choose canonical, union aliases, re-point relations and mentions, set `merged_into`). Relations sub-table inside entity sheet with add/remove relation.

**Ontology** — two `SectionCard`s (Entity types, Relation types) with rows (colour chip, name, description, usage count) and add/edit/delete (blocked when in use, tooltip).

**Chat (Playground)** — layout: left `ScrollArea` list of this user's playground conversations, centre thread, right collapsible "Run settings" panel (pipeline select, shows model/KBs/retrieval, override temperature/topK for this session). Thread: message bubbles (bespoke `chat_kit` modelled on events `components/chat/chat_kit.jsx`), assistant messages show citation chips (source title + page/timestamp) opening a citation `Popover` with snippet and "Open source"; thumbs up/down with note; "Mark unanswered". Composer: `Textarea`, Enter to send, Shift+Enter newline, disabled while pending with `Loader2`. Calls `POST /api/chat`. Supports `?conversation=` and `?q=` (prefill from graph). Empty state with pipeline picker and example questions. Placeholder answers carry a `Badge` "Placeholder".

**Conversations** — table across channels (title, pipeline, channel, messages, feedback summary, user, last activity); filters channel/pipeline; row → transcript `Sheet` (read-only thread + citations).

**All Pipelines** — table (name, KBs, provider/model, status pill draft/live, version, updated). New pipeline dialog. `?pipeline=` → `PipelineDetail` `EditorShell` sections: *Model* (provider select incl. "Grey hosted", model, temperature `Slider`, max tokens), *Retrieval* (KB multi-select, topK stepper `Field`, rerank, hybrid, threshold slider, graph mode `SegmentedTabs`, citations switch), *Prompt* (system prompt `Textarea` with variables hint), *Versions* (list of `pipeline_versions`, "Publish" creates version and sets live, view snapshot), *Endpoints* (read-only copyable URLs: `POST {origin}/grey/api/v1/pipelines/<id>/chat/completions` OpenAI-compatible, `/retrieve`, MCP URL; code snippets curl/JS in `Tabs`, copy button), *Danger zone*.

**Model Providers** — cards/table (name, provider, key `•••• last4`, status pill, models, last checked); Add/Edit dialog (provider select, name, base URL for openai_compatible/openrouter, API key input type=password, models tags); Save → insert row then `POST /api/providers/[id]/secret`; "Test" → `/test`; delete. "Grey hosted" shown as a built-in non-deletable row (no key; metered).

**API Keys** — table (name, prefix, scopes, pipelines, rate limit, last used, expires, status); Create dialog → `POST /api/api-keys` → reveal dialog showing the plaintext once with copy + warning; revoke (sets `revoked_at`); delete.

**MCP Servers** — table (name, KBs, pipeline, tools, status); create/edit dialog (KB multi-select, pipeline, API key select, tool switches); detail `Sheet` with server URL and client config snippets (Claude Desktop JSON, Cursor) using copy blocks; enable/disable switch.

**Widgets** — table (name, pipeline, domains, status); editor `Sheet`: pipeline, API key, allowed domains (tag input), title, greeting, placeholder, position (`SegmentedTabs` left/right), white-label switch, live preview card rendering the bubble + panel with theme; embed snippet `<script src=".../grey/widget.js" data-widget="<id>">` with copy.

**Evaluations** — tabs: *Sets* (table + create dialog; set detail `Sheet` with cases table, add/edit case, "Add from feedback"), *Runs* (table: set, pipeline@version, status, faithfulness/relevance/precision/recall, created); "Run evaluation" dialog creates `eval_runs` `queued` (banner: runs execute when the backend is connected).

**Feedback** — StatsBar (Thumbs up, Thumbs down, Unanswered, Satisfaction %); tabs Negative / Unanswered / All: rows (question, answer excerpt, pipeline, note, date); actions: open conversation, "Add to eval set" (creates `eval_cases`), resolve (sets `metadata.resolved`).

**Usage & Costs** — StatsBar (Spend MTD, Soft cap, Pages ingested, Media minutes, Retrievals); `ChartContainer` area chart of daily cost by kind (recharts) for 30 days; breakdown table by kind; soft-cap card (cap, behavior select, alert emails) writing `project_settings` (`grey.usage.manage`); `Progress` vs cap with warning banner at ≥80% via `useBanner`.

**Request Logs** — table (time, channel, pipeline, query, status pill incl. "Stub", latency, tokens, cost); filters channel/status/pipeline; row → `Sheet` trace (query, retrieved chunks list, answer link, timings).

**Settings / General** — `SettingsList`: default preset, default embedding model, retention days, log queries switch; project info.
**Settings / Team & Members**, **Roles & Permissions** — ported from events (`settings/team/*`, `roles_permissions.jsx`) with `grey` keys/groups.
**Settings / Navigation** — `NavVisibilitySettings` from `@geiger/ui` bound to `NavVisibilityProvider`.
**Settings / Data Export** — export cards (Knowledge bases + sources metadata, Chunks, Graph (entities/relations/mentions JSON), Conversations, Eval sets) each building a JSON file client-side and downloading via Blob; "Full export" zips nothing — downloads one combined JSON (`grey.export.run`).

## 4. Permissions, errors, testing

**Permission catalog** (`geiger-rbac.config.js`, product `grey`): view keys `grey.<slug>.view` for each top-level section (overview, knowledge_bases, knowledge_graph, playground, pipelines, delivery, quality, usage, settings); action keys: `grey.kb.manage`, `grey.source.upload`, `grey.source.delete`, `grey.ingestion.run`, `grey.preset.manage`, `grey.graph.edit`, `grey.ontology.manage`, `grey.pipeline.manage`, `grey.pipeline.publish`, `grey.provider.manage`, `grey.apikey.manage`, `grey.mcp.manage`, `grey.widget.manage`, `grey.eval.manage`, `grey.usage.manage`, `grey.export.run`, `grey.team.invite`, `grey.team.assign`, `grey.role.manage`, `grey.settings.manage`. No `scopeBy` in this phase.

**System roles** (keys match events so `rbac_role_for_member` org mapping works): owner `*`; admin = all keys; manager = all views + kb, source, ingestion, preset, graph, ontology, pipeline.manage/publish, eval, export, team.invite; member = views except settings + source.upload, ingestion.run, graph.edit, eval.manage; viewer = overview, knowledge_bases, knowledge_graph, playground views.

**Enforcement.** Client: nav filtered by view keys; action buttons via `useCan`. Server: every `app/api/**` handler evaluates the permission with `@geiger/rbac` before using the service-role client. Database: RLS by project membership on all tables; role/grant tables guarded as in events.

**Errors.** Data functions never throw or toast; return `null|[]|false` and `console.error("[module.fn]", err)`. Screens toast on failure and roll back optimistic state. Route handlers return JSON `{ error }` with 401/403/404/422/500/501. Missing Supabase env → `isSupabaseConfigured()` false → screens show EmptyState "Connect Supabase" instead of crashing.

**Testing.** `node --test`: `geiger-rbac.config.test.js` (role templates allow/deny), `lib/grey/cost.test.js` (estimates per tier, media, Auto range), `lib/workspace/tabs.test.js` (slug round-trip for every nav title), `lib/grey/duplicates.test.js` (entity duplicate grouping), `lib/grey/api_keys.test.js` (key format/hash). `npm run lint` clean. One `next build` at the end (significant UI change).

**Rollout.** Migrations are written, not pushed: running `npm run db:push` needs `STRING_URI` in `.env` and adding `grey` to Supabase exposed schemas, plus `SUPABASE_SERVICE_ROLE_KEY` for route handlers.
