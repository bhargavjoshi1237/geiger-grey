# Task 4 report: Nav tree, nav config, RBAC catalog, tab slugs

Worktree: `C:\Pro\geiger-grey\.claude\worktrees\agent-a6d91a03550540388`
Branch: `worktree-agent-a6d91a03550540388`

## Setup
- Worktree had no `node_modules`; created the junction per parallel-context.md:
  `New-Item -ItemType Junction -Path node_modules -Target C:\Pro\geiger-grey\node_modules`.
- `geiger-ui.config.js` did not exist in this worktree (its branch predates the Task 1 stub commit) — created fresh with the brief's content rather than replacing a stub.

## Files created / changed
- `lib/workspace/nav_tree.js` (new) — pure `NAV_TREE` data (titles + lucide icon name strings), no JSX, so Node can import it directly.
- `lib/workspace/tabs.js` (new) — `tabToSlug`, `SLUG_TO_TAB` (plain object), `slugToTab`, `DEFAULT_TAB = "Overview"`, `parentSectionOf`.
- `lib/workspace/tabs.test.js` (new) — brief's test verbatim.
- `geiger-rbac.config.js` (new) — `navSlug`, `navPermissionKey`, `NAV_SECTIONS`, default `defineRbacConfig` catalog (product `grey`): 9 view keys + 20 action keys (29 permissions total) and 5 system roles (owner/admin/manager/member/viewer) per spec §4.
- `geiger-rbac.config.test.js` (new) — brief's test verbatim.
- `lib/rbac.js` (new) — re-exports `navPermissionKey`; `tabPermissionKey(title)` (sub-item -> its parent section's view key, via `parentSectionOf`); `WORKSPACE_PERMISSIONS`, `ALL_PERMISSION_KEYS`, `SYSTEM_ROLE_SEED`, `normalizeRoleId`, `getRoleById` (ported from events `lib/rbac.js`); `PERMISSION_GROUPS` (ported from events `settings/constants.js` grouping logic — first-seen order by `group`).
- `geiger-ui.config.js` (new) — `defineNavConfig` with the brief's locked list, no hidden-by-default, and the 6 dependency rules (Knowledge Graph→Knowledge Bases, Playground/Evaluations/Request Logs→Pipelines, MCP Servers/Widgets→API Keys).
- `components/internal/sidebar/sidebar_nav.jsx` (replaced the Task-1 placeholder nav) — `workspaceNav` built from `NAV_TREE` via an explicit `{ LayoutDashboard, Library, ... }` lucide-react icon map (32 icons, all confirmed present in installed `lucide-react`).

## Permission catalog detail (`geiger-rbac.config.js`)
- View keys (`grey.<slug>.view`, group "Workspace views"): overview, knowledge_bases, knowledge_graph, playground, pipelines, delivery, quality, usage, settings.
- Action keys and groups: Knowledge (kb.manage, source.upload, source.delete, ingestion.run, preset.manage), Graph (graph.edit, ontology.manage), Pipelines & delivery (pipeline.manage, pipeline.publish, provider.manage, apikey.manage, mcp.manage, widget.manage), Quality & usage (eval.manage, usage.manage, export.run), Team control (team.invite, team.assign, role.manage), Administration (settings.manage).
- Roles: owner = `["*"]`; admin = every key explicitly; manager = all views + kb/source/ingestion/preset/graph/ontology/pipeline.manage/pipeline.publish/eval/export/team.invite (no role.manage, provider.manage, apikey/mcp/widget.manage, team.assign, settings.manage, usage.manage); member = all views except Settings + source.upload/ingestion.run/graph.edit/eval.manage; viewer = overview/knowledge_bases/knowledge_graph/playground views only.
- `grey.export.run` and `grey.usage.manage` were grouped under "Quality & usage" (not explicitly named in the 7-group list's wording but matching the group's intent; no other group fit better) — flagging as a judgment call, not a deviation from any explicit instruction.

## TDD record
**`lib/workspace/tabs.test.js`**
- RED: `node --test lib/workspace/tabs.test.js` → `ERR_MODULE_NOT_FOUND` for `./tabs.js` (module didn't exist yet).
- Implemented `nav_tree.js` + `tabs.js`.
- GREEN: `node --test lib/workspace/tabs.test.js` → 3/3 pass ("every nav title round-trips...", "slug format", "parent section lookup").

**`geiger-rbac.config.test.js`**
- RED: `node --test geiger-rbac.config.test.js` → `ERR_MODULE_NOT_FOUND` for `./geiger-rbac.config.js` (module didn't exist yet).
- Implemented `geiger-rbac.config.js`.
- GREEN: `node --test geiger-rbac.config.test.js` → 4/4 pass ("owner can do everything", "viewer is read-only", "member can upload but not manage pipelines or roles", "manager cannot manage roles or providers").

Combined final run: `node --test lib/workspace/tabs.test.js geiger-rbac.config.test.js` → 7/7 pass, 0 fail.

## Additional verification
- `npx eslint geiger-ui.config.js geiger-rbac.config.js geiger-rbac.config.test.js lib/rbac.js lib/workspace/nav_tree.js lib/workspace/tabs.js lib/workspace/tabs.test.js components/internal/sidebar/sidebar_nav.jsx` → 0 errors, 0 warnings.
- `lib/rbac.js` cannot be driven through `node --test` directly (it imports via the `@/` alias, which only webpack/Next resolves, and `geiger-ui.config.js` transitively pulls in `@geiger/ui`'s JSX files, which the plain Node ESM loader can't parse) — this matches the brief's design (only `tabs.test.js` and `geiger-rbac.config.test.js` run under `node --test`). To sanity-check `lib/rbac.js`'s logic anyway, I temporarily wrote a scratch script (same logic, relative imports, no JSX) inside the worktree, ran it, and deleted it before committing:
  - `tabPermissionKey("Overview")` → `grey.overview.view`; `tabPermissionKey("Entities")` → `grey.knowledge_graph.view` (parent section); `tabPermissionKey("Knowledge Graph")` → `grey.knowledge_graph.view` (own key); `tabPermissionKey("Usage & Costs")` → `grey.usage.view`.
  - `ALL_PERMISSION_KEYS.length === 29`; every permission has both `label` and `group`.
  - `PERMISSION_GROUPS` → `Workspace views(9), Knowledge(5), Graph(2), Pipelines & delivery(6), Quality & usage(3), Team control(3), Administration(1)` — all 7 required groups present, in first-seen order.
- Did not run `next build` or `next dev` (not required; not a significant UI modification per CLAUDE.md, and global-constraints forbids `next build` except Task 18).
- `npm run db:push` not run (not applicable to this task).

## Concerns / notes for the controller
- `geiger-ui.config.js` was **created**, not "replaced", because this worktree's branch (based on commit `8474e49`) predates the commit that added the Task-1 stub on `main`. When the controller merges, it should take this task's version (it matches the brief exactly) rather than treating it as a conflict with a stub it never actually diverged from in this branch's history.
- `components/internal/sidebar/sidebar_nav.jsx` previously held an unrelated placeholder nav (`Knowledge graph`, `Projects`, `Reporting`, `Inbox`, `Billing`, …) left over from an earlier pass; it has been fully replaced per the Interfaces contract.
- No changes made to `package.json`/`package-lock.json`, `components/internal/screens/registry.jsx`, or any file owned by another task.
- `node_modules` junction was created but not committed (confirmed not tracked by `git status`).

## Commit
(to be filled in after `git add -A` of task files + commit; see final message for the SHA)
