-- Delivery — API keys, MCP servers, widgets
--
-- From spec section 2.5. Owns grey.api_keys, grey.mcp_servers, grey.widgets.

-- @up
create table if not exists grey.api_keys (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null,
  prefix text not null,
  key_hash text not null,
  scopes text[] not null default '{}',
  pipeline_ids uuid[] not null default '{}',
  rate_limit_per_min integer,
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists api_keys_project_idx on grey.api_keys(project_id) where deleted_at is null;
-- The prefix alone (gk_live_xxxx) is only a display hint, not a lookup key,
-- and isn't guaranteed globally unique across projects — key_hash is. A
-- unique prefix per project isn't needed either, so no index on prefix.
create unique index if not exists api_keys_key_hash_uniq on grey.api_keys(key_hash);
drop trigger if exists api_keys_touch on grey.api_keys;
create trigger api_keys_touch before update on grey.api_keys for each row execute function grey.touch_updated_at();
alter table grey.api_keys enable row level security;
-- No insert policy for authenticated: keys are minted (hashed) only by the
-- server route under the service role. Revoke/delete need grey.apikey.manage.
drop policy if exists api_keys_member_all on grey.api_keys;
drop policy if exists api_keys_member_select on grey.api_keys;
create policy api_keys_member_select on grey.api_keys for select to authenticated
  using (grey.can_access_project(project_id));
drop policy if exists api_keys_member_update on grey.api_keys;
create policy api_keys_member_update on grey.api_keys for update to authenticated
  using (grey.can_access_project(project_id)) with check (grey.can_access_project(project_id));
drop policy if exists api_keys_member_delete on grey.api_keys;
create policy api_keys_member_delete on grey.api_keys for delete to authenticated
  using (grey.can_access_project(project_id));
drop policy if exists api_keys_update_guard on grey.api_keys;
create policy api_keys_update_guard on grey.api_keys as restrictive for update to authenticated
  using (grey.rbac_allows('grey.apikey.manage', project_id)) with check (grey.rbac_allows('grey.apikey.manage', project_id));
drop policy if exists api_keys_delete_guard on grey.api_keys;
create policy api_keys_delete_guard on grey.api_keys as restrictive for delete to authenticated
  using (grey.rbac_allows('grey.apikey.manage', project_id));

create table if not exists grey.mcp_servers (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null,
  kb_ids uuid[] not null default '{}',
  pipeline_id uuid references grey.pipelines(id) on delete set null,
  api_key_id uuid references grey.api_keys(id) on delete set null,
  tools jsonb not null default '{}'::jsonb,
  status text not null default 'enabled' check (status in ('enabled', 'disabled')),
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists mcp_servers_project_idx on grey.mcp_servers(project_id) where deleted_at is null;
drop trigger if exists mcp_servers_touch on grey.mcp_servers;
create trigger mcp_servers_touch before update on grey.mcp_servers for each row execute function grey.touch_updated_at();
alter table grey.mcp_servers enable row level security;
drop policy if exists mcp_servers_member_all on grey.mcp_servers;
create policy mcp_servers_member_all on grey.mcp_servers for all to authenticated
  using (grey.can_access_project(project_id)) with check (grey.can_access_project(project_id));
drop policy if exists mcp_servers_insert_guard on grey.mcp_servers;
create policy mcp_servers_insert_guard on grey.mcp_servers as restrictive for insert to authenticated
  with check (grey.rbac_allows('grey.mcp.manage', project_id));
drop policy if exists mcp_servers_update_guard on grey.mcp_servers;
create policy mcp_servers_update_guard on grey.mcp_servers as restrictive for update to authenticated
  using (grey.rbac_allows('grey.mcp.manage', project_id)) with check (grey.rbac_allows('grey.mcp.manage', project_id));
drop policy if exists mcp_servers_delete_guard on grey.mcp_servers;
create policy mcp_servers_delete_guard on grey.mcp_servers as restrictive for delete to authenticated
  using (grey.rbac_allows('grey.mcp.manage', project_id));

create table if not exists grey.widgets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null,
  pipeline_id uuid references grey.pipelines(id) on delete set null,
  api_key_id uuid references grey.api_keys(id) on delete set null,
  allowed_domains text[] not null default '{}',
  theme jsonb not null default '{}'::jsonb,
  white_label boolean not null default false,
  status text not null default 'enabled' check (status in ('enabled', 'disabled')),
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists widgets_project_idx on grey.widgets(project_id) where deleted_at is null;
drop trigger if exists widgets_touch on grey.widgets;
create trigger widgets_touch before update on grey.widgets for each row execute function grey.touch_updated_at();
alter table grey.widgets enable row level security;
drop policy if exists widgets_member_all on grey.widgets;
create policy widgets_member_all on grey.widgets for all to authenticated
  using (grey.can_access_project(project_id)) with check (grey.can_access_project(project_id));
drop policy if exists widgets_insert_guard on grey.widgets;
create policy widgets_insert_guard on grey.widgets as restrictive for insert to authenticated
  with check (grey.rbac_allows('grey.widget.manage', project_id));
drop policy if exists widgets_update_guard on grey.widgets;
create policy widgets_update_guard on grey.widgets as restrictive for update to authenticated
  using (grey.rbac_allows('grey.widget.manage', project_id)) with check (grey.rbac_allows('grey.widget.manage', project_id));
drop policy if exists widgets_delete_guard on grey.widgets;
create policy widgets_delete_guard on grey.widgets as restrictive for delete to authenticated
  using (grey.rbac_allows('grey.widget.manage', project_id));

-- @down
drop table if exists grey.widgets cascade;
drop table if exists grey.mcp_servers cascade;
drop table if exists grey.api_keys cascade;
