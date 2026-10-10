# Geiger Grey Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild Geiger Grey on the suite stack (@geiger/ui, @geiger/rbac, @geiger/orm, @geiger/notify) with every screen of the spec backed by real `grey` schema tables, processing stubbed.

**Architecture:** Mirror geiger-events: a force-static `/project/[projectId]/[[...rest]]` client shell, `SCREEN_REGISTRY` keyed by nav title, client data layer in `lib/supabase/*.js` pinned to schema `grey`, and `app/api/**` route handlers only for server-only work (Vault secrets, API key minting, chat stub).

**Tech Stack:** Next.js 16 App Router (JS), React 19, Tailwind v4, @geiger/ui, @geiger/rbac, @geiger/orm, @geiger/notify, Supabase (supabase-js, @supabase/ssr), sonner, recharts, react-force-graph-2d/3d, node:test.

**Spec:** `docs/superpowers/specs/2026-10-10-grey-frontend-design.md` — every task's UI/columns/behaviour detail lives there; read the referenced section before starting a task.

**Reference implementation:** `C:\Pro\geiger-events` (read-only). Port, don't reinvent: when a task says "port X", copy the file, rename `events` → `grey` (schema, keys, storage prefixes `geiger-events:` → `geiger-grey:`, label "Events" → "Grey", basePath `/events` → `/grey`), and drop event-specific branches.

## Global Constraints

- JavaScript only (`.js`/`.jsx`), no TypeScript. Path alias `@/` = repo root (existing `jsconfig.json`).
- Read `node_modules/next/dist/docs/` for any Next 16 API you are unsure about (events AGENTS.md rule).
- UI comes from `@geiger/ui` (barrel or subpath, never both for one name in a file). No local `components/ui`. Bespoke components only when the library lacks one (dropzone, chat bubbles, copy block).
- Semantic token classes only (`bg-surface-subtle`, `text-muted-foreground`, `text-text-secondary`, `border-border`, `bg-primary`, `text-destructive-text`, `var(--chart-1..5)`); never hardcoded hex.
- Lucide icons only.
- Block loaders: `LoadingArea` (sections), `LoadingScreen` (route/gates), `LogoLoading` with no `name` prop and `aria-label` (not `label`). `Loader2` only in buttons/inline.
- Toasts: `import { toast } from "sonner"`; `<Toaster />` from `@geiger/ui` mounted once in root layout.
- Data functions never throw or toast; return `null | [] | false` and `console.error("[<module>.<fn>]", error)`.
- Every table query filters `deleted_at is null`; deletes are soft (`deleted_at = now()`), except join-free hard deletes explicitly noted.
- Comments: concise single-line style.
- Work on `main`. Commit at the end of each task (`git add -A` scoped to the task's files; message `feat(grey): <task summary>` ending with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`). Never push — the controller pushes once at the end.
- Do NOT run `next build` except in Task 18.
- Do NOT run `npm run db:push` (no `STRING_URI` in this repo yet).

---

## File structure

```
app/
  layout.js                         root: fonts, ThemeProvider, BannerProvider, GlobalBanner, Toaster
  page.js                           redirect("/project")
  globals.css
  project/page.js                   project resolver
  project/[projectId]/layout.js     force-static → WorkspaceLayout
  project/[projectId]/workspace_layout.jsx
  project/[projectId]/[[...rest]]/page.js
  api/providers/[id]/secret/route.js
  api/providers/[id]/test/route.js
  api/api-keys/route.js
  api/chat/route.js
  api/v1/[...path]/route.js         501
  api/mcp/[serverId]/route.js       501
components/
  theme-provider.jsx                (keep)
  internal/sidebar/{sidebar.jsx,sidebar_option.jsx,sidebar_nav.jsx,mobile_sidebar_header.jsx}
  internal/topbar/{topbar.jsx,profile_dropdown.jsx,notifications_bell.jsx}
  internal/workspace/{workspace_states.jsx,create_project_dialog.jsx}
  internal/shared/{screen_kit.jsx,screen_wrappers.jsx,editor_shell.jsx,pagination.jsx,copy_block.jsx,tag_input.jsx,dropzone.jsx,filter_dropdown.jsx}
  internal/screens/registry.jsx
  internal/screens/coming_soon.jsx
  internal/screens/overview/overview.jsx
  internal/screens/knowledge/{constants.js,all_knowledge_bases.jsx,knowledge_base_detail.jsx,kb_dialog.jsx,ingestion_settings_form.jsx,chunk_browser.jsx,ingestion_presets.jsx,preset_sheet.jsx}
  internal/screens/sources/{constants.js,sources.jsx,sources_table.jsx,upload_sources_dialog.jsx,source_sheet.jsx,freshness_dialog.jsx,ingestion_jobs.jsx}
  internal/screens/graph/{constants.js,graph_explorer.jsx,knowledge_graph.jsx,entity_panel.jsx,entities.jsx,entity_dialog.jsx,merge_dialog.jsx,ontology.jsx}
  internal/screens/playground/{constants.js,chat_kit.jsx,chat.jsx,run_settings.jsx,conversations.jsx,transcript_sheet.jsx}
  internal/screens/pipelines/{constants.js,all_pipelines.jsx,pipeline_detail.jsx,pipeline_dialog.jsx,model_providers.jsx,provider_dialog.jsx}
  internal/screens/delivery/{constants.js,api_keys.jsx,mcp_servers.jsx,widgets.jsx,widget_sheet.jsx}
  internal/screens/quality/{constants.js,evaluations.jsx,eval_set_sheet.jsx,feedback.jsx}
  internal/screens/usage/{constants.js,usage_costs.jsx,request_logs.jsx}
  internal/screens/settings/{constants.js,general.jsx,navigation_settings.jsx,data_export.jsx,roles_permissions.jsx,team_members.jsx,team/*}
context/{project-context.js,rbac-context.js,nav-visibility-context.js}
lib/
  utils.js                          re-export cn from @geiger/ui/lib/utils
  base_path.js                      BASE_PATH constant
  api.js                            apiFetch
  rbac.js                           navPermissionKey, tabPermissionKey, PERMISSION_GROUPS
  hooks/{use-workspace-url.js,use-visible-nav.js}
  workspace/{tabs.js,tabs.test.js,shell_cache.js}
  grey/{cost.js,cost.test.js,file_analysis.js,duplicates.js,duplicates.test.js,api_keys.js,api_keys.test.js,format.js}
  server/{auth.js,errors.js}
  supabase/{client.js,admin.js,config.js,repository.js,user.js,rbac.js,team.js,nav_prefs.js,
            knowledge_bases.js,ingestion_presets.js,sources.js,ingestion_jobs.js,chunks.js,graph.js,
            pipelines.js,model_providers.js,conversations.js,api_keys.js,mcp_servers.js,widgets.js,
            evals.js,usage.js,project_settings.js,suite_imports.js}
supabase/migrations/*.sql
geiger-ui.config.js, geiger-rbac.config.js, geiger-rbac.config.test.js, geiger-orm.config.mjs
public/logo1.svg
```

Deleted: `app/[projectid]/`, `app/pallet/`, `app/palletw/`, `components/ui/`, `components/grey/`, `components/internal/{banner,notfound,shared/deadlines.jsx,shared/iconbuttoncard.jsx,topbar/dialogue,sidebar/*}` (replaced), `context/banner-context.js`, `context/project-context.js` (replaced), `utils/`, `lib/supabase/pfp.js`, `lib/hooks/use-mobile.js`, `supabase/sqls/`.

---

### Task 1: Suite packages, config and styles

**Files:**
- Modify: `package.json`, `next.config.mjs`, `app/globals.css`, `app/layout.js`, `app/page.js`, `lib/utils.js`
- Create: `geiger-orm.config.mjs`, `geiger-ui.config.js` (stub replaced in Task 4), `lib/base_path.js`, `public/logo1.svg`
- Delete: `components/ui/`, `app/pallet/`, `app/palletw/`, `app/[projectid]/`, `supabase/sqls/`

**Interfaces:**
- Produces: `BASE_PATH` from `@/lib/base_path` (`process.env.NEXT_PUBLIC_BASE_PATH || ""`); `cn` from `@/lib/utils`.

- [ ] **Step 1: Dependencies.** Edit `package.json`: add `"@geiger/ui": "github:bhargavjoshi1237/geiger-ui#00cac4f5bc540cd910478abb0f240358cc653f08"`, `"@geiger/rbac": "github:bhargavjoshi1237/geiger-rbac#1835de3735cf9c86df5adebdbc7458dd4302e40d"`, `"@geiger/orm": "github:bhargavjoshi1237/geiger-orm#master"`, `"@geiger/notify": "file:../geiger-notify"`, `"sonner": "^2.0.7"`, `"vaul": "^1.1.2"`, `"react-hook-form": "^7.88.0"`; bump `next` to `^16.3.1`, `react`/`react-dom` to `19.2.4`, `eslint-config-next` to `16.2.6`. Remove `@dnd-kit/*`, `react-icons`, `vercel`, `@xyflow/react`. Scripts: add `"db:push": "geiger-orm push"`, `"db:status": "geiger-orm status"`, `"db:rollback": "geiger-orm rollback"`, `"db:new": "geiger-orm create"`, `"db:seed": "geiger-orm seed"`, `"ui:update": "npm update @geiger/ui"`, `"test": "node --test"`. Run `npm install` (expect success; peer warnings OK).
- [ ] **Step 2: next.config.mjs**
```js
const isProd = process.env.NODE_ENV === "production";

const nextConfig = {
  basePath: isProd ? "/grey" : "",
  allowedDevOrigins: ["127.0.0.1"],
  transpilePackages: ["@geiger/ui", "@geiger/notify"],
  env: { NEXT_PUBLIC_BASE_PATH: isProd ? "/grey" : "" },
};

export default nextConfig;
```
- [ ] **Step 3: globals.css** — replace whole file:
```css
@import "tailwindcss";
@import "tw-animate-css";
@import "shadcn/tailwind.css";
@import "@geiger/ui/tokens.css";

@source "../node_modules/@geiger/ui/src";
@source "../node_modules/@geiger/notify/src";
```
- [ ] **Step 4: root layout** — `app/layout.js`: keep Geist fonts + `ThemeProvider` (attribute class, defaultTheme system, enableSystem, disableTransitionOnChange); wrap with `BannerProvider` + `GlobalBanner` from `@geiger/ui`; render `<Toaster />` from `@geiger/ui`; metadata title "Grey — Geiger", description "Knowledge bases, graphs and RAG pipelines for your Geiger projects." `app/page.js`: `import { redirect } from "next/navigation"; export default function Home() { redirect("/project"); }`.
- [ ] **Step 5:** `lib/utils.js` → `export { cn } from "@geiger/ui/lib/utils";`. `lib/base_path.js` → `export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "";`. Copy `C:\Pro\geiger-events\public\logo1.svg` to `public/logo1.svg`. Create `geiger-orm.config.mjs`:
```js
// Migration config for @geiger/orm; Grey's tables and ledger live in the "grey" schema.
export default {
  schema: "grey",
  url: process.env.STRING_URI,
};
```
- [ ] **Step 6:** Delete the listed folders. Grep for `@/components/ui/` and `react-icons` — the only remaining hits must be in files deleted/rewritten by later tasks (old `components/internal/*`, `components/grey/*`); delete those now too (`components/internal`, `components/grey`, `context/banner-context.js`, `utils/`, `lib/supabase/pfp.js`, `lib/hooks/use-mobile.js`). Task 6 recreates the shell.
- [ ] **Step 7: Verify** `node -e "import('@geiger/rbac').then(m=>console.log(typeof m.evaluate))"` → `function`.

---

### Task 2: Supabase clients, repository helper, user, apiFetch

**Files:**
- Create: `lib/supabase/{config.js,client.js,admin.js,repository.js,user.js}`, `lib/api.js`

**Interfaces (produced, used by every data module):**
```js
// lib/supabase/config.js
export function isSupabaseConfigured(): boolean
// lib/supabase/client.js
export function createClient(): SupabaseClient // browser, db.schema "grey", singleton
// lib/supabase/admin.js (server only)
export function adminClient(): SupabaseClient | null // service role, db.schema "grey"
// lib/supabase/repository.js
export function toCamel(row): object            // snake→camel keys, recursive for plain objects? NO: top-level only
export function toSnakeRow(input, columns): object // only keys present in input AND listed in columns (camel names)
export function makeRepo({ table, columns, normalize = toCamel, order = "created_at", ascending = false }):
  { list(projectId, filters = {}) -> Promise<object[]>,   // filters: { [camelCol]: value | value[] }
    get(id) -> Promise<object|null>,
    create(projectId, input) -> Promise<object|null>,    // honours input.id
    update(id, patch) -> Promise<object|null>,
    remove(id) -> Promise<boolean> }                      // soft delete
// lib/supabase/user.js
export async function getUser(): Promise<{ id, name, email, avatar } | null> // 30s cache
// lib/api.js
export async function apiFetch(path, { method = "GET", body } = {}): Promise<{ data, error }>
```

- [ ] **Step 1:** `config.js`:
```js
export function isSupabaseConfigured() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}
```
- [ ] **Step 2:** `client.js`:
```js
import { createBrowserClient } from "@supabase/ssr";

let browserClient = null;

// Browser client pinned to the grey schema; use .schema("public") for suite tables.
export function createClient() {
  if (browserClient) return browserClient;
  browserClient = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { db: { schema: "grey" } },
  );
  return browserClient;
}
```
- [ ] **Step 3:** `admin.js`:
```js
import "server-only";
import { createClient } from "@supabase/supabase-js";

export function isAdminConfigured() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

// Service-role client for route handlers only.
export function adminClient() {
  if (!isAdminConfigured()) return null;
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    db: { schema: "grey" },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
```
(If `server-only` is not installed, add `"server-only": "^0.0.1"` to dependencies.)
- [ ] **Step 4:** `repository.js`:
```js
import { createClient } from "./client";
import { isSupabaseConfigured } from "./config";

const camel = (k) => k.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
const snake = (k) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

export function toCamel(row) {
  if (!row) return null;
  return Object.fromEntries(Object.entries(row).map(([k, v]) => [camel(k), v]));
}

export function toSnakeRow(input, columns) {
  const out = {};
  for (const key of columns) if (input[key] !== undefined) out[snake(key)] = input[key];
  return out;
}

// Generic CRUD over one grey table; soft deletes via deleted_at.
export function makeRepo({ table, columns, normalize = toCamel, order = "created_at", ascending = false }) {
  const tag = `[${table}`;
  return {
    async list(projectId, filters = {}) {
      if (!isSupabaseConfigured() || !projectId) return [];
      try {
        let q = createClient().from(table).select("*").eq("project_id", projectId).is("deleted_at", null);
        for (const [key, value] of Object.entries(filters)) {
          if (value === undefined || value === null || value === "all") continue;
          q = Array.isArray(value) ? q.in(snake(key), value) : q.eq(snake(key), value);
        }
        const { data, error } = await q.order(order, { ascending });
        if (error) throw error;
        return (data || []).map(normalize);
      } catch (error) {
        console.error(`${tag}.list]`, error);
        return [];
      }
    },
    async get(id) {
      if (!isSupabaseConfigured() || !id) return null;
      try {
        const { data, error } = await createClient().from(table).select("*").eq("id", id).is("deleted_at", null).maybeSingle();
        if (error) throw error;
        return data ? normalize(data) : null;
      } catch (error) {
        console.error(`${tag}.get]`, error);
        return null;
      }
    },
    async create(projectId, input) {
      if (!isSupabaseConfigured() || !projectId) return null;
      try {
        const row = { ...toSnakeRow(input, ["id", ...columns]), project_id: projectId };
        const { data, error } = await createClient().from(table).insert(row).select("*").single();
        if (error) throw error;
        return normalize(data);
      } catch (error) {
        console.error(`${tag}.create]`, error);
        return null;
      }
    },
    async update(id, patch) {
      if (!isSupabaseConfigured() || !id) return null;
      try {
        const { data, error } = await createClient().from(table).update(toSnakeRow(patch, columns)).eq("id", id).select("*").single();
        if (error) throw error;
        return normalize(data);
      } catch (error) {
        console.error(`${tag}.update]`, error);
        return null;
      }
    },
    async remove(id) {
      if (!isSupabaseConfigured() || !id) return false;
      try {
        const { error } = await createClient().from(table).update({ deleted_at: new Date().toISOString() }).eq("id", id);
        if (error) throw error;
        return true;
      } catch (error) {
        console.error(`${tag}.remove]`, error);
        return false;
      }
    },
  };
}
```
- [ ] **Step 5:** `user.js` — port `C:\Pro\geiger-events\lib\supabase\user.js` (`getUser()` from `auth.getSession()`, 30s cache, returns `{ id, name, email, avatar }` from `user_metadata.full_name|name`, `avatar_url`).
- [ ] **Step 6:** `lib/api.js`:
```js
import { BASE_PATH } from "@/lib/base_path";
import { createClient } from "@/lib/supabase/client";

// Calls a Grey route handler with the caller's Supabase access token.
export async function apiFetch(path, { method = "GET", body } = {}) {
  try {
    const { data: { session } } = await createClient().auth.getSession();
    const res = await fetch(`${BASE_PATH}/api${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { data: null, error: json.error || `HTTP ${res.status}` };
    return { data: json, error: null };
  } catch (error) {
    console.error("[api.fetch]", error);
    return { data: null, error: "network_error" };
  }
}
```

---

### Task 3: Migrations

**Files:** Create in `supabase/migrations/` (format: header comment, `-- @up`, body, `-- @down`, body; idempotent; schema-qualified):
1. `20261010120000_grey_core.sql` — `create extension if not exists pgcrypto; create schema if not exists grey; grant usage on schema grey to anon, authenticated, service_role; alter default privileges in schema grey grant select, insert, update, delete on tables to authenticated, service_role;` + `grey.touch_updated_at()` + `grey.can_access_project(uuid)` (copy body of `events.can_access_project` from `C:\Pro\geiger-events\supabase\migrations\20260726194134_project_access.sql`, schema renamed).
2. `20261010120100_adopt_rbac.sql` — output of `node -e "import('@geiger/rbac').then(m=>console.log(m.migrationSql('grey')))"` + owner backfill copied from events `20260804211527_adopt_rbac.sql` (schema renamed).
3. `20261010120200_team.sql` — port events `20260809133335_rbac_team_management.sql`, `20260809134349_rbac_claim_invitation.sql`, `20260809135817_rbac_org_role_mapping.sql`, `20261002091000_operations_role_write_guards.sql` (only the roles/grants/members guards; rename helper to `grey.can_administer_roles`), plus the `project_members`, `member_groups`, `member_activity` tables events created for them (find with `grep -l "project_members" C:\Pro\geiger-events\supabase\migrations`). Schema `events` → `grey`, key prefix `events.` → `grey.`.
4. (none — nav prefs use the suite-shared `public.user_nav_prefs` owned by geiger-dash; see spec §2.1)
5. `20261010120400_ingestion.sql` — `ingestion_presets`, `knowledge_bases`, `sources`, `ingestion_jobs`, `chunks` (spec §2.2) + system preset seed rows (fixed UUIDs `00000000-0000-4000-8000-00000000000{1..4}`, `on conflict (id) do nothing`) + storage bucket `grey-sources` and storage policies.
6. `20261010120500_graph.sql` — `kg_types`, `kg_entities`, `kg_relations`, `kg_mentions` (§2.3).
7. `20261010120600_pipelines.sql` — `model_providers`, `pipelines`, `pipeline_versions`, `conversations`, `messages` (§2.4) + `grey.set_provider_secret(p_provider uuid, p_secret text)` security definer (checks `grey.can_access_project` of the provider's project, creates or updates `vault` secret named `grey_provider_<id>`, writes `secret_id`, `key_last4`, `status='unverified'`), `revoke all ... from public, anon, authenticated; grant execute ... to service_role`.
8. `20261010120700_delivery.sql` — `api_keys`, `mcp_servers`, `widgets` (§2.5).
9. `20261010120800_quality_usage.sql` — `eval_sets`, `eval_cases`, `eval_runs`, `eval_results`, `request_logs`, `usage_events`, `project_settings` (unique `project_id`) (§2.6).

Table template (use for every table in 5–9; columns from the spec; `on delete cascade` for parent FKs inside grey; enum-like columns are `text` with `check (col in (...))`):
```sql
create table if not exists grey.knowledge_bases (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null,
  description text,
  icon text,
  status text not null default 'active' check (status in ('active','archived')),
  preset_id uuid references grey.ingestion_presets(id),
  embedding_model text not null default 'cohere-embed-5-pro',
  chunk_config jsonb not null default '{}'::jsonb,
  retrieval_defaults jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists knowledge_bases_project_idx on grey.knowledge_bases(project_id) where deleted_at is null;
drop trigger if exists knowledge_bases_touch on grey.knowledge_bases;
create trigger knowledge_bases_touch before update on grey.knowledge_bases for each row execute function grey.touch_updated_at();
alter table grey.knowledge_bases enable row level security;
drop policy if exists knowledge_bases_member_all on grey.knowledge_bases;
create policy knowledge_bases_member_all on grey.knowledge_bases for all to authenticated
  using (grey.can_access_project(project_id)) with check (grey.can_access_project(project_id));
```
`ingestion_presets.project_id` is nullable; its policy: `using (project_id is null or grey.can_access_project(project_id)) with check (project_id is not null and grey.can_access_project(project_id))`. `@down` drops tables in reverse order with `cascade`.

- [ ] **Step 1:** Write files 1–4 by porting (read each events source first).
- [ ] **Step 2:** Write files 5–9 from the spec.
- [ ] **Step 3: Verify** with `@geiger/orm`'s parser: `node -e "import('@geiger/orm').then(async m=>{const r=await m.discoverMigrations({migrationsDir:'supabase/migrations'});console.log(r.length)})"` (if `discoverMigrations` signature differs, read `node_modules/@geiger/orm/src/index.js` and use `parseMigration` on each file). Expected: 9 migrations parsed, each with non-empty up and down.

---

### Task 4: Nav tree, nav config, RBAC catalog, tab slugs

**Files:**
- Create: `components/internal/sidebar/sidebar_nav.jsx`, `geiger-ui.config.js`, `geiger-rbac.config.js`, `geiger-rbac.config.test.js`, `lib/rbac.js`, `lib/workspace/tabs.js`, `lib/workspace/tabs.test.js`

**Interfaces:**
```js
// sidebar_nav.jsx
export const workspaceNav // [{ title, icon, keywords?, subItems?: [{ title, icon, keywords? }] }] — exact titles from spec §1 table
// geiger-rbac.config.js
export function navSlug(title): string           // "Knowledge Bases" -> "knowledge_bases"
export function navPermissionKey(title): string  // -> "grey.knowledge_bases.view"
export const NAV_SECTIONS: string[]              // top-level titles
export default rbacConfig
// lib/rbac.js
export { navPermissionKey } ; export function tabPermissionKey(title): string // sub-item -> its section's key
export const PERMISSION_GROUPS // [{ group, permissions: [{ key, label }] }] built from config
export const ALL_PERMISSION_KEYS: string[]
// lib/workspace/tabs.js
export function tabToSlug(title): string          // lowercase, strip non-alphanumerics: "Usage & Costs" -> "usagecosts"
export const SLUG_TO_TAB: Record<string,string>
export function slugToTab(slug): string | null
export const DEFAULT_TAB = "Overview"
export function parentSectionOf(title): string | null
```
Nav icons (lucide): Overview `LayoutDashboard`; Knowledge Bases `Library` (All `Database`, Sources `FileStack`, Ingestion Jobs `ListChecks`, Ingestion Presets `SlidersHorizontal`); Knowledge Graph `Network` (Graph Explorer `Waypoints`, Entities `Shapes`, Ontology `Tags`); Playground `MessagesSquare` (Chat `MessageCircle`, Conversations `History`); Pipelines `Workflow` (All Pipelines `GitBranch`, Model Providers `Cpu`); Delivery `Send` (API Keys `KeyRound`, MCP Servers `Plug`, Widgets `PanelBottom`); Quality `ShieldCheck` (Evaluations `FlaskConical`, Feedback `ThumbsUp`); Usage `Gauge` (Usage & Costs `CircleDollarSign`, Request Logs `ScrollText`); Settings `Settings` (General `Settings2`, Team & Members `Users`, Roles & Permissions `ShieldUser`, Navigation `PanelLeft`, Data Export `Download`). If an icon name doesn't exist in installed lucide-react, pick the closest existing one.

- [ ] **Step 1: Write failing tests** `lib/workspace/tabs.test.js`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { tabToSlug, slugToTab, SLUG_TO_TAB, parentSectionOf } from "./tabs.js";
import { NAV_TREE } from "./nav_tree.js";

test("every nav title round-trips through its slug", () => {
  const titles = NAV_TREE.flatMap((s) => [s.title, ...(s.subItems || []).map((i) => i.title)]);
  for (const t of titles) assert.equal(slugToTab(tabToSlug(t)), t);
  assert.equal(new Set(titles.map(tabToSlug)).size, titles.length);
});

test("slug format", () => {
  assert.equal(tabToSlug("Usage & Costs"), "usagecosts");
  assert.equal(SLUG_TO_TAB.allknowledgebases, "All Knowledge Bases");
});

test("parent section lookup", () => {
  assert.equal(parentSectionOf("Entities"), "Knowledge Graph");
  assert.equal(parentSectionOf("Overview"), "Overview");
});
```
Node can't import `.jsx`, so the pure nav data (titles + lucide icon *names* as strings) lives in `lib/workspace/nav_tree.js` (`export const NAV_TREE = [{ title, icon: "LayoutDashboard", keywords?, subItems: [{ title, icon }] }]`); `sidebar_nav.jsx` builds `workspaceNav` from it with an explicit `{ LayoutDashboard, Library, ... }` icon map imported from `lucide-react`. Pure modules use ESM syntax in `.js` files; Node v24 (installed) auto-detects ESM, so leave `package.json` `"type"` unset. Pure modules imported by tests must use relative imports with `.js` extensions (no `@/` alias).
- [ ] **Step 2:** Run `node --test lib/workspace/tabs.test.js` → FAIL (module missing).
- [ ] **Step 3:** Implement `nav_tree.js`, `tabs.js`, `sidebar_nav.jsx`.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: RBAC catalog test first** — `geiger-rbac.config.test.js`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluate } from "@geiger/rbac";
import config, { navPermissionKey } from "./geiger-rbac.config.js";

const roles = config.systemRoles.map((r, i) => ({ id: `r${i}`, key: r.key, permissions: r.permissions }));
const decide = (roleKey, key) => {
  const role = roles.find((r) => r.key === roleKey);
  return evaluate(key, { config, roles, grants: [{ roleId: role.id, scope: {}, status: "active" }], actorId: "u1" }).allowed;
};

test("owner can do everything", () => {
  for (const p of config.permissions) assert.ok(decide("owner", p.key), p.key);
});
test("viewer is read-only", () => {
  assert.ok(decide("viewer", navPermissionKey("Knowledge Graph")));
  assert.equal(decide("viewer", "grey.kb.manage"), false);
  assert.equal(decide("viewer", navPermissionKey("Settings")), false);
});
test("member can upload but not manage pipelines or roles", () => {
  assert.ok(decide("member", "grey.source.upload"));
  assert.equal(decide("member", "grey.pipeline.manage"), false);
  assert.equal(decide("member", "grey.role.manage"), false);
});
test("manager cannot manage roles or providers", () => {
  assert.ok(decide("manager", "grey.pipeline.publish"));
  assert.equal(decide("manager", "grey.role.manage"), false);
  assert.equal(decide("manager", "grey.provider.manage"), false);
});
```
(Check `evaluate`'s exact role/grant shape in `node_modules/@geiger/rbac/src/evaluate.js` and events `geiger-rbac.config.test.js`; adjust the fixture, not the assertions.)
- [ ] **Step 6:** Run → FAIL. Implement `geiger-rbac.config.js` following `C:\Pro\geiger-events\geiger-rbac.config.js` (no addons) with the spec §4 catalog and roles; `lib/rbac.js` (port events `lib/rbac.js` + `components/internal/screens/settings/constants.js` PERMISSION_GROUPS logic). Run → PASS.
- [ ] **Step 7:** `geiger-ui.config.js`:
```js
import { defineNavConfig } from "@geiger/ui";

export default defineNavConfig({
  product: "grey",
  locked: ["Overview", "Knowledge Bases", "All Knowledge Bases", "Settings", "Navigation"],
  hiddenByDefault: [],
  dependencies: [
    { screen: "Knowledge Graph", requires: ["Knowledge Bases"], reason: "The graph is extracted from knowledge base sources." },
    { screen: "Playground", requires: ["Pipelines"], reason: "Chat runs through a pipeline." },
    { screen: "Evaluations", requires: ["Pipelines"], reason: "Evaluations score a pipeline version." },
    { screen: "Request Logs", requires: ["Pipelines"] },
    { screen: "MCP Servers", requires: ["API Keys"], reason: "MCP clients authenticate with an API key." },
    { screen: "Widgets", requires: ["API Keys"], reason: "Widgets call Grey with a publishable API key." },
  ],
});
```

---

### Task 5: Contexts, hooks and suite data modules (rbac, team, nav prefs)

**Files:**
- Create: `context/project-context.js`, `context/rbac-context.js`, `context/nav-visibility-context.js`, `lib/hooks/use-workspace-url.js`, `lib/hooks/use-visible-nav.js`, `lib/workspace/shell_cache.js`, `lib/supabase/{rbac.js,team.js,nav_prefs.js}`

Port from `C:\Pro\geiger-events`: `context/project-context.js` (drop `events_project_id`; localStorage key `geiger-grey:last-project`), `context/rbac-context.js`, `context/nav-visibility-context.js`, `lib/hooks/use-workspace-url.js` (query params: `kb`, `pipeline`, `entity`, `conversation`, `section`, `q`; expose generic `setParam(name, value)` plus `openRecord(name, id)`/`closeRecord(name)` helpers in addition to `tab`/`setTab`/`section`/`setSection`), `lib/hooks/use-visible-nav.js` (no addons: `workspaceNav.filter(item => can(tabPermissionKey(item.title)))` then `applyNavVisibility(curatable, hidden, navConfig)`), `lib/workspace/shell_cache.js` (prefix `geiger-grey:shell:`), `lib/supabase/rbac.js`, `lib/supabase/team.js`, `lib/supabase/nav_prefs.js` (schema/key renames).

**Interfaces (produced):**
```js
useProject() -> { project, projects, projectId, loading, setProjectId, createProject(name), refresh }
useOptionalProject()
useRbac() -> { roles, grants, resolved, loading, userId, isOwner, can(key, extra?), decide(key, extra?), refresh }
useCan(key, extra?) -> boolean
useNavVisibility() -> { hidden, loading, setHidden(title, bool), reset() }
useWorkspaceUrl() -> { projectId, tab, setTab(title), section, setSection(id), params, setParam(name, value), openRecord(name, id), closeRecord(name) }
useVisibleNav() -> nav[] ; useCuratableNav() -> nav[] ; useNavLoading() -> boolean
```
- [ ] **Step 1:** Port each file, read source first, then rename. Keep events' behaviours: allow-while-loading, permissive outside provider, `ensureSystemRoles` + `ensureMembership` on first load.
- [ ] **Step 2:** `npx eslint context lib/hooks lib/workspace lib/supabase` → no errors.

---

### Task 6: Workspace shell, routes and shared kit

**Files:**
- Create: `app/project/page.js`, `app/project/[projectId]/layout.js`, `app/project/[projectId]/workspace_layout.jsx`, `app/project/[projectId]/[[...rest]]/page.js`, `components/internal/sidebar/{sidebar.jsx,sidebar_option.jsx,mobile_sidebar_header.jsx}`, `components/internal/topbar/{topbar.jsx,profile_dropdown.jsx,notifications_bell.jsx}`, `components/internal/workspace/{workspace_states.jsx,create_project_dialog.jsx}`, `components/internal/shared/{screen_kit.jsx,screen_wrappers.jsx,editor_shell.jsx,pagination.jsx,filter_dropdown.jsx,copy_block.jsx,tag_input.jsx,dropzone.jsx}`, `components/internal/screens/{registry.jsx,coming_soon.jsx}`, `lib/grey/format.js`

Port from events (same relative paths): sidebar files, topbar files (`label="Grey"`, recents key `geiger:grey:search-recents`, `app="grey"` on `NotificationBell`, help href `/docs`), `workspace_layout.jsx` (providers `Suspense > ProjectProvider > RbacProvider > NavVisibilityProvider > WorkspaceShell`), `layout.js` (`export const dynamic = "force-static"`), catch-all page, `app/project/page.js`, `workspace_states.jsx` (NoProjects + create dialog), shared `screen_kit.jsx` (incl. events' compact-number overrides), `screen_wrappers.jsx` (keep current Grey file content), `editor_shell.jsx`, `pagination.jsx` (`usePagination`, `ListPagination`), `screens/overview/filter_dropdown.jsx` → `shared/filter_dropdown.jsx`, `coming_soon.jsx`.

New bespoke shared components:
```jsx
// copy_block.jsx — read-only mono value/snippet with copy button (Button size="icon-sm", Copy→Check icon, toast "Copied")
export function CopyBlock({ value, label, multiline = false, className })
// tag_input.jsx — Input that turns Enter/comma into removable Badge chips
export function TagInput({ value = [], onChange, placeholder, validate }) // validate(tag) -> boolean
// dropzone.jsx — dashed drop target + hidden file input; accepts multiple
export function Dropzone({ onFiles, accept, disabled, hint }) // onFiles(File[])
```
`lib/grey/format.js`: `formatBytes(n)`, `formatDuration(ms)` ("1h 02m", "3m 05s"), `formatCurrency(n, { precise })` (USD, 2 dp; precise → up to 4 dp), `formatNumber(n)` (compact), `formatRelative(date)` (date-fns `formatDistanceToNowStrict` + " ago").

Registry: `SCREEN_REGISTRY` starts empty in this task; each later screen task adds its own titles. `getScreen(title) = SCREEN_REGISTRY[title] || null` (null → `ComingSoonScreen`). Section titles with sub-items (e.g. "Knowledge Bases") map to their first sub-item's screen.

- [ ] **Step 1:** Port and create files.
- [ ] **Step 2:** `npm run dev`, open `http://localhost:3000/project` — without Supabase env it should render the NoProjects/“Connect Supabase” state without crashing; with env, the shell renders with sidebar, topbar, ComingSoon screens. Stop the dev server.
- [ ] **Step 3:** `npx eslint app components lib` → clean.

---

### Task 7: Domain data modules

**Files:** Create `lib/supabase/{knowledge_bases,ingestion_presets,sources,ingestion_jobs,chunks,graph,pipelines,model_providers,conversations,api_keys,mcp_servers,widgets,evals,usage,project_settings,suite_imports}.js`

Each module = header comment + `makeRepo` instances + named wrappers. Column lists are the camelCase of the spec §2 columns (excluding `id, project_id, created_at, updated_at, deleted_at`; including `metadata`). Exact exports:
```js
// knowledge_bases.js
listKnowledgeBases(projectId) ; getKnowledgeBase(id) ; createKnowledgeBase(projectId, input) ; updateKnowledgeBase(id, patch) ; deleteKnowledgeBase(id)
// ingestion_presets.js — list returns system presets (project_id null) + project presets, system first
listPresets(projectId) ; createPreset(projectId, input) ; updatePreset(id, patch) ; deletePreset(id) ; SYSTEM_PRESET_IDS = { fast, balanced, high, auto }
// sources.js
listSources(projectId, { kbId, status, kind, origin } = {}) ; getSource(id) ; createSource(projectId, input) ; updateSource(id, patch) ; deleteSource(id)
uploadSourceFile({ projectId, kbId, sourceId, file, onProgress }) -> Promise<string|null>  // storage path; bucket "grey-sources"; onProgress(0..100) best effort
getSourceDownloadUrl(storagePath) -> Promise<string|null> // signed URL 60s
// ingestion_jobs.js
listJobs(projectId, { kbId, sourceId, status } = {}) ; createJobs(projectId, jobs[]) -> Promise<object[]> ; updateJob(id, patch)
// chunks.js
listChunks(projectId, { kbId, sourceId, page = 1, pageSize = 25 }) -> Promise<{ rows, count }>
// graph.js
listTypes(projectId) ; createType(projectId, input) ; updateType(id, patch) ; deleteType(id) ; ensureDefaultOntology(projectId) -> Promise<object[]>
listEntities(projectId) ; createEntity(projectId, input) ; updateEntity(id, patch) ; deleteEntity(id)
listRelations(projectId) ; createRelation(projectId, input) ; deleteRelation(id)
listMentions(projectId, { entityId }) ; mergeEntities(projectId, { canonicalId, duplicateIds }) -> Promise<boolean>
  // merge: union aliases (+ duplicate names) into canonical, re-point kg_relations source/target and kg_mentions entity_id, set duplicates merged_into=canonical and deleted_at
// pipelines.js
listPipelines(projectId) ; getPipeline(id) ; createPipeline(projectId, input) ; updatePipeline(id, patch) ; deletePipeline(id)
listPipelineVersions(projectId, pipelineId) ; publishPipeline(pipeline, note) -> Promise<object|null> // inserts version current+1 with config snapshot, sets status "live", current_version
// model_providers.js
listProviders(projectId) ; createProvider(projectId, input) ; updateProvider(id, patch) ; deleteProvider(id)
saveProviderSecret(id, secret) -> apiFetch(`/providers/${id}/secret`, POST {secret}) ; testProvider(id) -> apiFetch(`/providers/${id}/test`, POST)
GREY_HOSTED_PROVIDER = { id: "grey-hosted", name: "Grey hosted", provider: "grey_hosted", status: "ok", models: ["grey-fast", "grey-balanced", "grey-deep"], builtIn: true }
// conversations.js
listConversations(projectId, { channel, pipelineId, userId } = {}) ; getConversation(id) ; createConversation(projectId, input) ; updateConversation(id, patch) ; deleteConversation(id)
listMessages(conversationId) -> ascending by created_at ; listFeedbackMessages(projectId) -> assistant messages with feedback or unanswered, joined conversation title/pipeline_id
setMessageFeedback(id, { feedback, feedbackNote, unanswered, metadata })
sendChat({ projectId, conversationId, pipelineId, content, overrides }) -> apiFetch("/chat", POST) -> { conversationId, userMessage, assistantMessage }
// api_keys.js
listApiKeys(projectId) ; createApiKey(projectId, input) -> apiFetch("/api-keys", POST {projectId, ...input}) -> { key, record } ; revokeApiKey(id) ; deleteApiKey(id) ; updateApiKey(id, patch)
// mcp_servers.js / widgets.js
listMcpServers/createMcpServer/updateMcpServer/deleteMcpServer ; listWidgets/createWidget/updateWidget/deleteWidget
// evals.js
listEvalSets/createEvalSet/updateEvalSet/deleteEvalSet ; listEvalCases(projectId, setId)/createEvalCase/updateEvalCase/deleteEvalCase ; listEvalRuns(projectId, { evalSetId })/createEvalRun
// usage.js
listUsageEvents(projectId, { since }) ; listRequestLogs(projectId, { channel, status, pipelineId } = {})
// project_settings.js
getProjectSettings(projectId) -> object (defaults when no row) ; saveProjectSettings(projectId, patch) -> upsert on project_id
// suite_imports.js — best effort reads of other suite schemas; [] when not readable
listImportableAssets(projectId) -> createClient().schema("assets").from("assets") rows {id,name,mime,bytes,url?}; listImportableNotes(projectId) -> schema("notes") boards/pages; inspect C:\Pro\geiger-assets and C:\Pro\geiger-notes migrations for real table/column names first
```
- [ ] **Step 1:** Implement all modules.
- [ ] **Step 2:** `npx eslint lib/supabase` → clean.

---

### Task 8: Route handlers + API key lib

**Files:** Create `lib/server/{errors.js,auth.js}`, `lib/grey/api_keys.js`, `lib/grey/api_keys.test.js`, `app/api/providers/[id]/secret/route.js`, `app/api/providers/[id]/test/route.js`, `app/api/api-keys/route.js`, `app/api/chat/route.js`, `app/api/v1/[...path]/route.js`, `app/api/mcp/[serverId]/route.js`

**Interfaces:**
```js
// lib/server/errors.js
export class ApiError extends Error { constructor(code, status, message) }
export function json(data, status = 200) -> Response
export function handle(fn) -> (request, ctx) => Promise<Response> // catches ApiError → json({ error: code, message }, status); other → 500
// lib/server/auth.js
export async function requirePermission(request, projectId, key) -> { user, admin }
  // session: cookie via @supabase/ssr createServerClient(next/headers cookies) or Authorization Bearer; 401 if none
  // membership: public.projects + public.organization_users (port events lib/operations/server/access.js); 403 if not member
  // roles: admin.schema("public").from("roles") for project; grants: admin.from("role_grants") for user; camelCase-map; evaluate(key,{config,roles,grants,actorId}); 403 if !allowed
// lib/grey/api_keys.js (pure, node crypto)
export function generateApiKey() -> { key, prefix } // key "gk_live_" + 32 base62 chars; prefix = first 12 chars of key
export function hashApiKey(key) -> string           // sha256 hex
```
- [ ] **Step 1: Failing test** `lib/grey/api_keys.test.js`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateApiKey, hashApiKey } from "./api_keys.js";

test("key format and prefix", () => {
  const { key, prefix } = generateApiKey();
  assert.match(key, /^gk_live_[A-Za-z0-9]{32}$/);
  assert.equal(prefix, key.slice(0, 12));
});
test("keys are unique and hashes stable", () => {
  const a = generateApiKey().key, b = generateApiKey().key;
  assert.notEqual(a, b);
  assert.equal(hashApiKey(a), hashApiKey(a));
  assert.match(hashApiKey(a), /^[0-9a-f]{64}$/);
});
```
- [ ] **Step 2:** Run → FAIL. Implement with `crypto.randomBytes` + rejection sampling over base62 and `createHash("sha256")`. Run → PASS.
- [ ] **Step 3:** Route handlers (all `export const runtime = "nodejs"`):
  - `providers/[id]/secret` POST `{ secret }`: load provider via admin (404), `requirePermission(req, provider.project_id, "grey.provider.manage")`, 422 if secret empty, `admin.rpc("set_provider_secret", { p_provider: id, p_secret: secret })`, return `{ ok: true, keyLast4 }`.
  - `providers/[id]/test` POST: permission same; set `status = secret_id ? "ok" : "error"`, `last_checked_at = now()`; return provider row.
  - `api-keys` POST `{ projectId, name, scopes, pipelineIds, rateLimitPerMin, expiresAt }`: permission `grey.apikey.manage`; 422 without name; insert `{prefix, key_hash, ...}`; return `{ key, record }` (record normalized camelCase, no hash).
  - `chat` POST `{ projectId, conversationId?, pipelineId, content, overrides? }`: permission `grey.playground.view`; 422 without content/pipeline; create conversation (`channel: "playground"`, `title` = first 60 chars) if missing; insert user message; pick up to 3 chunks from pipeline `kb_ids` (else up to 3 sources) → citations `{ sourceId, chunkId, title, page, startMs, snippet }`; insert assistant message with content `"Grey retrieval backend not connected yet — this is a placeholder answer for: \"<content>\". Once ingestion and a model provider are connected, answers will be generated from your knowledge bases."`, `metadata: { placeholder: true }`, `latency_ms`; insert `request_logs` (`status: "stub"`, `channel: "playground"`) and `usage_events` (`kind: "retrieval"`, `quantity: 1`, `cost: 0`); return `{ conversationId, userMessage, assistantMessage }` camelCased.
  - `v1/[...path]` all methods and `mcp/[serverId]`: `json({ error: "not_implemented", message: "Grey serving endpoints arrive with the retrieval backend." }, 501)`.
- [ ] **Step 4:** `npx eslint app/api lib/server lib/grey` → clean.

---

### Task 9: Cost estimator + file analysis

**Files:** Create `lib/grey/cost.js`, `lib/grey/cost.test.js`, `lib/grey/file_analysis.js`

**Interfaces:**
```js
// cost.js (pure)
export const TIER_ORDER = ["fast", "balanced", "high"]
export function estimateFileCost(file, preset) -> { low, high, breakdown: [{ label, amount }] }
  // file: { kind, pageCount, durationMs, tokenCount }; preset: { tier, config }
  // document/image/web/note: pages * prices.perPage (auto: low = pages*fast price, high = pages*high price; uses SYSTEM_TIER_PRICES)
  // audio/video: minutes * perMediaMinute (+ keyframes minutes * perKeyframeMinute for video when media.keyframes)
  // graph.extract: tokens/1e6 * perMillionTokensGraph ; enrichment.contextual: tokens/1e6 * perMillionTokensContextual
export function estimateTotal(files, preset) -> { low, high }
export const SYSTEM_TIER_PRICES = { fast: 0.002, balanced: 0.006, high: 0.02 }
// file_analysis.js (browser)
export async function analyzeFile(file) -> { kind, mime, bytes, pageCount, durationMs, tokenCount }
  // pdf: count /Type\s*\/Page[^s] in text decode; image: 1 page; audio/video: <audio>/<video> loadedmetadata duration; text/markdown/csv/json: tokens = chars/4, pages = ceil(tokens/500); office docs: pages = max(1, round(bytes/50_000)), tokens = pages*500; tokens for pdf = pages*500
```
- [ ] **Step 1: Failing test** `lib/grey/cost.test.js`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { estimateFileCost, estimateTotal } from "./cost.js";

const preset = (tier, extra = {}) => ({
  tier,
  config: {
    media: { keyframes: false }, graph: { extract: false }, enrichment: { contextual: false },
    prices: { perPage: { fast: 0.002, balanced: 0.006, high: 0.02, auto: 0.006 }[tier], perMediaMinute: 0.006, perKeyframeMinute: 0.04, perMillionTokensGraph: 0.5, perMillionTokensContextual: 1.02 },
    ...extra,
  },
});
const doc = { kind: "document", pageCount: 100, tokenCount: 50_000 };

test("document priced per page", () => {
  const r = estimateFileCost(doc, preset("balanced"));
  assert.equal(r.low, 0.6); assert.equal(r.high, 0.6);
});
test("auto gives a fast-to-high range", () => {
  const r = estimateFileCost(doc, preset("auto"));
  assert.equal(r.low, 0.2); assert.equal(r.high, 2);
});
test("video with keyframes adds visual cost", () => {
  const p = preset("balanced", { media: { keyframes: true } });
  const r = estimateFileCost({ kind: "video", durationMs: 600_000, tokenCount: 0 }, p);
  assert.equal(Number(r.low.toFixed(4)), 0.46);
});
test("graph extraction priced on tokens", () => {
  const p = preset("fast", { graph: { extract: true } });
  const r = estimateFileCost({ kind: "document", pageCount: 10, tokenCount: 2_000_000 }, p);
  assert.equal(Number(r.low.toFixed(4)), 1.02);
});
test("total sums low and high", () => {
  const t = estimateTotal([doc, doc], preset("auto"));
  assert.equal(t.low, 0.4); assert.equal(t.high, 4);
});
```
- [ ] **Step 2:** Run → FAIL. Implement (round amounts to 6 dp internally, `Number(x.toFixed(6))`). Run → PASS.
- [ ] **Step 3:** Implement `file_analysis.js` (browser-only, guarded by `typeof window`).

---

### Task 10: Knowledge Bases + Ingestion Presets screens (spec §3 "All Knowledge Bases", "Ingestion Presets")

**Files:** `components/internal/screens/knowledge/*` per file structure; register `"All Knowledge Bases"`, `"Knowledge Bases"`, `"Ingestion Presets"` in registry.

**Interfaces:**
```jsx
export function IngestionSettingsForm({ value, onChange, disabled, showPrices = true }) // value = preset config object; collapsed Advanced Accordion
export function PresetPicker({ presets, value, onChange }) // tier cards with price/page
export const DEFAULT_PRESET_CONFIG // balanced config (mirror migration seed)
export const EMBEDDING_MODELS = [{ value, label, dims }]
export const KB_STATUS_MAP, JOB_STATUS_MAP
```
- [ ] **Step 1:** Constants + `IngestionSettingsForm` + `PresetPicker`.
- [ ] **Step 2:** `all_knowledge_bases.jsx` list + `kb_dialog.jsx`; `?kb=` → `knowledge_base_detail.jsx` (EditorShell sections Sources, Chunks, Ingestion settings, Activity, Danger zone). The Sources section reuses `SourcesTable` from Task 11 — if Task 11 isn't done, import path `@/components/internal/screens/sources/sources_table` is the contract: `export function SourcesTable({ projectId, kbId })`.
- [ ] **Step 3:** `chunk_browser.jsx` (uses `listChunks`, `ListPagination`).
- [ ] **Step 4:** `ingestion_presets.jsx` + `preset_sheet.jsx` with cost preview (`estimateFileCost` for 100 pages / 60 media minutes).
- [ ] **Step 5:** `npx eslint components/internal/screens/knowledge` → clean.

---

### Task 11: Sources, Upload, Ingestion Jobs (spec §3 "Sources", "Ingestion Jobs")

**Files:** `components/internal/screens/sources/*`; register `"Sources"`, `"Ingestion Jobs"`.

**Interfaces:**
```jsx
export function SourcesTable({ projectId, kbId }) // full list UI incl. toolbar; kbId hides KB filter
export function UploadSourcesDialog({ open, onOpenChange, projectId, defaultKbId, onUploaded })
export const SOURCE_STATUS_MAP, SOURCE_KIND_ICONS, freshnessOf(source) -> "verified"|"review_due"|"stale"|"none"
```
Upload flow per spec: analyze files (`analyzeFile`), estimate (`estimateFileCost`/`estimateTotal`), on Start: for each file `id = crypto.randomUUID()`, `uploadSourceFile` → `createSource({ id, kbId, name, kind, origin: "upload", mime, bytes, pageCount, durationMs, tokenCount, storagePath, status: "queued" })` → `createJobs([{ kbId, sourceId: id, presetSnapshot: preset, status: "queued", stage: "parse", progress: 0, estimatedCost }])`. Import tab via `suite_imports.js`; "Add URL" creates `kind: "web", origin: "url", originRef: url`.
- [ ] **Step 1:** constants, `SourcesTable`, `source_sheet.jsx`, `freshness_dialog.jsx`.
- [ ] **Step 2:** `upload_sources_dialog.jsx` with `Dropzone`.
- [ ] **Step 3:** `sources.jsx` screen (wraps SourcesTable with ScreenHeader + StatsBar), `ingestion_jobs.jsx` (retry = new job, cancel = status cancelled; `GlobalBanner`-style inline notice via `SectionCard` note, not the global banner).
- [ ] **Step 4:** eslint clean.

---

### Task 12: Knowledge Graph (spec §3 "Graph Explorer", "Entities", "Ontology")

**Files:** `components/internal/screens/graph/*`; register `"Knowledge Graph"`, `"Graph Explorer"`, `"Entities"`, `"Ontology"`. Source for the explorer: `git show HEAD:components/grey/knowledge-graph.jsx` (deleted in Task 1).

**Interfaces:**
```js
// lib/grey/duplicates.js (pure)
export function normalizeName(name) -> string // lowercase, strip punctuation/diacritics, collapse spaces, drop corporate suffixes (inc, ltd, llc, corp, co)
export function findDuplicateGroups(entities) -> Array<Array<entity>> // same typeId AND (normalized name equal OR name∈other's aliases); groups of ≥2; merged entities (mergedInto) excluded
```
```jsx
export function KnowledgeGraph({ entities, relations, types, onSelect, selectedId, height })
export function EntityPanel({ open, onOpenChange, entity, projectId, onChanged })
```
- [ ] **Step 1: Failing test** `lib/grey/duplicates.test.js`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { findDuplicateGroups, normalizeName } from "./duplicates.js";

test("normalizeName strips suffixes and punctuation", () => {
  assert.equal(normalizeName("Acme, Inc."), "acme");
  assert.equal(normalizeName("  Zoë   Smith "), "zoe smith");
});
test("groups by normalized name within a type", () => {
  const e = [
    { id: "1", typeId: "org", name: "Acme Inc", aliases: [] },
    { id: "2", typeId: "org", name: "ACME", aliases: [] },
    { id: "3", typeId: "person", name: "Acme", aliases: [] },
    { id: "4", typeId: "org", name: "Globex", aliases: ["Acme Corp"] },
  ];
  const groups = findDuplicateGroups(e).map((g) => g.map((x) => x.id).sort());
  assert.deepEqual(groups, [["1", "2", "4"]]);
});
test("ignores merged entities", () => {
  const e = [{ id: "1", typeId: "t", name: "A", aliases: [] }, { id: "2", typeId: "t", name: "a", aliases: [], mergedInto: "1" }];
  assert.deepEqual(findDuplicateGroups(e), []);
});
```
- [ ] **Step 2:** Run → FAIL; implement with union-find; Run → PASS.
- [ ] **Step 3:** `knowledge_graph.jsx`: port old component; props-driven (no fetching, no fallback graph); colours via `getComputedStyle(document.documentElement).getPropertyValue("--chart-N")` keyed by type colour, background `--background`, text `--foreground`, borders `--border`; re-resolve on theme change (`useTheme().resolvedTheme` dependency); overlays use token classes.
- [ ] **Step 4:** `graph_explorer.jsx` (loads types via `ensureDefaultOntology`, entities, relations; type filter chips, KB filter via mentions, search-to-focus, EmptyState) + `entity_panel.jsx` (Sheet; relations add/remove; mentions; "Ask about this" → `setTab("Chat")` + `setParam("q", "What do we know about <name>?")`).
- [ ] **Step 5:** `entities.jsx` (+ `entity_dialog.jsx`, `merge_dialog.jsx`, Duplicates tab via `SegmentedTabs`), `ontology.jsx`.
- [ ] **Step 6:** eslint clean.

---

### Task 13: Playground (spec §3 "Chat", "Conversations")

**Files:** `components/internal/screens/playground/*`; register `"Playground"`, `"Chat"`, `"Conversations"`.

**Interfaces:**
```jsx
// chat_kit.jsx — model on C:\Pro\geiger-events\components\chat\chat_kit.jsx styling
export function MessageList({ messages, renderActions, emptyState })
export function MessageBubble({ message, actions }) // user right/primary, assistant left/surface; citations row
export function CitationChip({ citation, onOpenSource }) // Popover with snippet
export function Composer({ value, onChange, onSubmit, disabled, placeholder })
```
Chat behaviour per spec; optimistic user message (temp id) replaced by server response; `?conversation=` selection; `?q=` prefill then clear param; feedback via `setMessageFeedback`.
- [ ] **Step 1:** chat_kit + run_settings.
- [ ] **Step 2:** chat.jsx.
- [ ] **Step 3:** conversations.jsx + transcript_sheet.jsx.
- [ ] **Step 4:** eslint clean.

---

### Task 14: Pipelines + Model Providers (spec §3)

**Files:** `components/internal/screens/pipelines/*`; register `"Pipelines"`, `"All Pipelines"`, `"Model Providers"`.

Constants: `PROVIDERS = [{ value: "openai", label: "OpenAI", models: ["gpt-5", "gpt-5-mini"] }, { value: "anthropic", label: "Anthropic", models: ["claude-opus-5-5", "claude-sonnet-5", "claude-haiku-4-5-20251001"] }, { value: "google", label: "Google", models: ["gemini-3-pro", "gemini-3-flash"] }, { value: "openrouter", label: "OpenRouter", needsBaseUrl: false }, { value: "openai_compatible", label: "OpenAI-compatible", needsBaseUrl: true }]`, `DEFAULT_RETRIEVAL = { topK: 6, rerank: true, hybrid: true, threshold: 0.2, graphMode: "auto", citations: true }`, `PIPELINE_STATUS_MAP`. Endpoints section builds URLs from `window.location.origin + BASE_PATH`.
- [ ] **Step 1:** model_providers.jsx + provider_dialog.jsx (save row → `saveProviderSecret` when key entered → toast; Test button).
- [ ] **Step 2:** all_pipelines.jsx + pipeline_dialog.jsx + pipeline_detail.jsx (EditorShell sections Model, Retrieval, Prompt, Versions, Endpoints, Danger zone; Publish gated by `grey.pipeline.publish`).
- [ ] **Step 3:** eslint clean.

---

### Task 15: Delivery (spec §3 "API Keys", "MCP Servers", "Widgets")

**Files:** `components/internal/screens/delivery/*`; register `"Delivery"`, `"API Keys"`, `"MCP Servers"`, `"Widgets"`.
- [ ] **Step 1:** api_keys.jsx (create → reveal-once dialog with `CopyBlock`; revoke; delete; status derived: revoked/expired/active).
- [ ] **Step 2:** mcp_servers.jsx (dialog + detail Sheet with server URL `${origin}${BASE_PATH}/api/mcp/<id>` and Claude Desktop / Cursor JSON snippets in `Tabs` + `CopyBlock`).
- [ ] **Step 3:** widgets.jsx + widget_sheet.jsx (TagInput domains validated as hostnames, live preview, embed snippet).
- [ ] **Step 4:** eslint clean.

---

### Task 16: Quality (spec §3 "Evaluations", "Feedback")

**Files:** `components/internal/screens/quality/*`; register `"Quality"`, `"Evaluations"`, `"Feedback"`.
- [ ] **Step 1:** evaluations.jsx (SegmentedTabs Sets/Runs; run dialog creates queued run with `pipelineVersion = pipeline.currentVersion`) + eval_set_sheet.jsx (cases CRUD).
- [ ] **Step 2:** feedback.jsx (`listFeedbackMessages`; Add to eval set dialog → `createEvalCase` with question from previous user message, answer as expected draft; resolve → `setMessageFeedback(id, { metadata: { ...m.metadata, resolved: true } })`).
- [ ] **Step 3:** eslint clean.

---

### Task 17: Usage, Request Logs, Overview, Settings screens (spec §3)

**Files:** `components/internal/screens/usage/*`, `overview/overview.jsx`, `settings/*`; register `"Usage"`, `"Usage & Costs"`, `"Request Logs"`, `"Overview"`, `"Settings"`, `"General"`, `"Team & Members"`, `"Roles & Permissions"`, `"Navigation"`, `"Data Export"`.
- [ ] **Step 1:** usage_costs.jsx (30-day daily cost by kind via `ChartContainer` + recharts `AreaChart`, colours `var(--chart-N)`; cap card → `saveProjectSettings`; `useBanner().showBanner` when spend ≥ 80% of cap) + request_logs.jsx.
- [ ] **Step 2:** overview.jsx (stats + recent jobs + recent conversations + quick actions + setup checklist; all from data modules).
- [ ] **Step 3:** settings: port events `settings/team_members.jsx` + `settings/team/*` and `settings/roles_permissions.jsx` + `settings/navigation_settings.jsx` (renames; remove event-scope UI from member drawer); write `general.jsx` and `data_export.jsx` (Blob JSON download, gated `grey.export.run`).
- [ ] **Step 4:** eslint clean.

---

### Task 18: Verification

- [ ] **Step 1:** `npm test` → all suites pass (tabs, rbac config, cost, duplicates, api_keys).
- [ ] **Step 2:** `npm run lint` → 0 errors.
- [ ] **Step 3:** Every nav title in `NAV_TREE` resolves in `SCREEN_REGISTRY` (quick node check or grep) — no ComingSoon left.
- [ ] **Step 4:** `npm run build` → succeeds.
- [ ] **Step 5:** `npm run dev`, load `/project/<any-uuid>/overview` and click through every sidebar item; no runtime errors in the terminal/browser console (empty states expected without DB).
