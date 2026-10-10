-- User nav prefs
--
-- Ported from geiger-events 20260804070428_user_nav_prefs.sql (schema events
-- -> grey). Owns grey.user_nav_prefs — one row per (project, user) holding the
-- sidebar entries that user has hidden in Settings -> Navigation. Sidebar
-- curation is a personal preference, so it is keyed by user.
--
-- `hidden` is a jsonb array of exact sidebar titles. The rules about which
-- titles may be hidden live in geiger-ui.config.js / geiger-rbac.config.js and
-- are enforced by @geiger/ui; the database only records the choice.

-- @up
create table if not exists grey.user_nav_prefs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  -- Plain uuid, no FK: identity lives in auth.users. Null is the
  -- unauthenticated visitor, who gets one shared row per project.
  user_id uuid,
  hidden jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- The upsert target. `nulls not distinct` keeps the unauthenticated visitor on
-- a single row per project instead of accumulating one per write.
create unique index if not exists user_nav_prefs_project_user_idx
  on grey.user_nav_prefs (project_id, user_id) nulls not distinct
  where deleted_at is null;

create index if not exists user_nav_prefs_created_at_idx
  on grey.user_nav_prefs (created_at desc);

drop trigger if exists user_nav_prefs_touch on grey.user_nav_prefs;
create trigger user_nav_prefs_touch before update on grey.user_nav_prefs
for each row execute function grey.touch_updated_at();

alter table grey.user_nav_prefs enable row level security;
drop policy if exists user_nav_prefs_member_all on grey.user_nav_prefs;
create policy user_nav_prefs_member_all on grey.user_nav_prefs for all to authenticated
  using (grey.can_access_project(project_id)) with check (grey.can_access_project(project_id));

-- @down
drop table if exists grey.user_nav_prefs cascade;
