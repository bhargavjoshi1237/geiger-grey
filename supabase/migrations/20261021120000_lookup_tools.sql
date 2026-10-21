-- Lookup tools and visual search
--
-- From docs/superpowers/specs/2026-10-21-lookup-tools-design.md §3. Adds:
--   grey.chunks.modality      'text' | 'image' — an image source is indexed as one image chunk
--   grey.sources.labels       human-applied labels; classifier tools vote with them
--   grey.match_chunks_vector / grey.match_chunks_text — new signatures with modality and
--                             source filters, returning modality, source kind and image info
--   grey.source_label_counts  label → source count inside a set of knowledge bases
--   grey.tools / tool_versions / tool_runs / tool_messages — typed, versioned lookup tools,
--                             their run log and their builder chat
--   grey.api_keys.tool_ids    the tools a key may run (empty = none)
--   system-role permission backfill for the new Tools section and actions
--
-- Tool versions, runs and builder messages are written only by server routes under the
-- service role; members read them through RLS. Publishing fields on grey.tools are locked to
-- the service role by trigger, so grey.tool.manage alone can't mark a tool live.

-- @up

-- ---------------------------------------------------------------------------
-- Chunk modality and source labels
-- ---------------------------------------------------------------------------
alter table grey.chunks add column if not exists modality text not null default 'text';
alter table grey.chunks drop constraint if exists chunks_modality_check;
alter table grey.chunks add constraint chunks_modality_check check (modality in ('text', 'image'));

-- 1–60 characters each, at most 50 per source. Check constraints can't hold subqueries, so the
-- per-element rule lives in an immutable helper.
create or replace function grey.labels_valid(p_labels text[])
returns boolean
language sql
immutable
parallel safe
as $$
  select coalesce(pg_catalog.cardinality(p_labels), 0) <= 50
     and not exists (
       select 1 from pg_catalog.unnest(coalesce(p_labels, '{}'::text[])) as l(label)
        where l.label is null or pg_catalog.char_length(pg_catalog.btrim(l.label)) not between 1 and 60
     )
$$;

alter table grey.sources add column if not exists labels text[] not null default '{}';
alter table grey.sources drop constraint if exists sources_labels_check;
alter table grey.sources add constraint sources_labels_check check (grey.labels_valid(labels));
create index if not exists sources_labels_idx on grey.sources using gin (labels) where deleted_at is null;

-- ---------------------------------------------------------------------------
-- grey.match_chunks_vector — the return type changes, so the old signature is dropped first.
-- p_modality narrows to 'text' or 'image' chunks; p_source_ids keeps only those sources;
-- p_exclude_source_ids drops them (leave-one-out tests).
-- ---------------------------------------------------------------------------
drop function if exists grey.match_chunks_vector(uuid, uuid[], int, public.halfvec, int, real);
drop function if exists grey.match_chunks_vector(uuid, uuid[], int, public.halfvec, int, real, text, uuid[], uuid[]);
create or replace function grey.match_chunks_vector(
  p_project uuid,
  p_kb_ids uuid[],
  p_dims int,
  p_query public.halfvec,
  p_limit int default 50,
  p_min_similarity real default 0,
  p_modality text default null,
  p_source_ids uuid[] default null,
  p_exclude_source_ids uuid[] default null
)
returns table (
  chunk_id uuid,
  source_id uuid,
  source_name text,
  kb_id uuid,
  content text,
  page int,
  start_ms int,
  end_ms int,
  heading_path text[],
  score real,
  modality text,
  source_kind text,
  image jsonb
)
language plpgsql
stable
set search_path = grey, public
as $$
begin
  if p_dims is null or p_dims < 64 or p_dims > 4000 then
    raise exception 'BAD_DIMS';
  end if;
  if p_modality is not null and p_modality not in ('text', 'image') then
    raise exception 'BAD_MODALITY';
  end if;
  perform set_config('hnsw.iterative_scan', 'relaxed_order', true);
  perform set_config('hnsw.ef_search', '100', true);
  -- %s is a validated integer, so the cast expression matches the partial expression index.
  return query execute format($q$
    select * from (
      select c.id, c.source_id, s.name, c.kb_id, c.content, c.page, c.start_ms, c.end_ms, c.heading_path,
             (1 - (c.embedding::public.halfvec(%s) <=> $1::public.halfvec(%s)))::real as score,
             c.modality, s.kind, c.metadata -> 'image'
        from grey.chunks c
        join grey.sources s on s.id = c.source_id and s.project_id = c.project_id and s.deleted_at is null
        join grey.knowledge_bases k on k.id = c.kb_id and k.project_id = $2 and k.deleted_at is null
       where c.project_id = $2 and c.kb_id = any($3) and c.deleted_at is null
         and c.state = 'live' and c.embedding_dims = %s
         and ($6::text is null or c.modality = $6)
         and ($7::uuid[] is null or c.source_id = any($7))
         and ($8::uuid[] is null or not (c.source_id = any($8)))
       order by c.embedding::public.halfvec(%s) <=> $1::public.halfvec(%s)
       limit $4) r
    where r.score >= $5
    order by r.score desc$q$, p_dims, p_dims, p_dims, p_dims, p_dims)
  using p_query, p_project, p_kb_ids,
        greatest(1, least(coalesce(p_limit, 50), 200)), coalesce(p_min_similarity, 0),
        p_modality, p_source_ids, p_exclude_source_ids;
end;
$$;

-- ---------------------------------------------------------------------------
-- grey.match_chunks_text — same filters and extra columns.
-- ---------------------------------------------------------------------------
drop function if exists grey.match_chunks_text(uuid, uuid[], text, int);
drop function if exists grey.match_chunks_text(uuid, uuid[], text, int, text, uuid[], uuid[]);
create or replace function grey.match_chunks_text(
  p_project uuid,
  p_kb_ids uuid[],
  p_query text,
  p_limit int default 50,
  p_modality text default null,
  p_source_ids uuid[] default null,
  p_exclude_source_ids uuid[] default null
)
returns table (
  chunk_id uuid,
  source_id uuid,
  source_name text,
  kb_id uuid,
  content text,
  page int,
  start_ms int,
  end_ms int,
  heading_path text[],
  score real,
  modality text,
  source_kind text,
  image jsonb
)
language plpgsql
stable
set search_path = grey, public
as $$
declare
  v_query tsquery := grey.or_tsquery(p_query);
begin
  if v_query is null then
    return;
  end if;
  if p_modality is not null and p_modality not in ('text', 'image') then
    raise exception 'BAD_MODALITY';
  end if;
  return query
    select c.id, c.source_id, s.name, c.kb_id, c.content, c.page, c.start_ms, c.end_ms, c.heading_path,
           ts_rank_cd(c.fts, v_query, 32)::real,
           c.modality, s.kind, c.metadata -> 'image'
      from grey.chunks c
      join grey.sources s on s.id = c.source_id and s.project_id = c.project_id and s.deleted_at is null
      join grey.knowledge_bases k on k.id = c.kb_id and k.project_id = p_project and k.deleted_at is null
     where c.project_id = p_project and c.kb_id = any(p_kb_ids) and c.deleted_at is null
       and c.state = 'live' and c.fts @@ v_query
       and (p_modality is null or c.modality = p_modality)
       and (p_source_ids is null or c.source_id = any(p_source_ids))
       and (p_exclude_source_ids is null or not (c.source_id = any(p_exclude_source_ids)))
     order by ts_rank_cd(c.fts, v_query, 32) desc, c.id
     limit greatest(1, least(coalesce(p_limit, 50), 200));
end;
$$;

revoke all on function grey.match_chunks_vector(uuid, uuid[], int, public.halfvec, int, real, text, uuid[], uuid[]) from public, anon, authenticated;
grant execute on function grey.match_chunks_vector(uuid, uuid[], int, public.halfvec, int, real, text, uuid[], uuid[]) to service_role;
revoke all on function grey.match_chunks_text(uuid, uuid[], text, int, text, uuid[], uuid[]) from public, anon, authenticated;
grant execute on function grey.match_chunks_text(uuid, uuid[], text, int, text, uuid[], uuid[]) to service_role;

-- ---------------------------------------------------------------------------
-- grey.source_label_counts — label → number of live sources carrying it, inside p_kb_ids
-- (null = the whole project). Service role only: it takes the project id as a parameter.
-- ---------------------------------------------------------------------------
create or replace function grey.source_label_counts(p_project uuid, p_kb_ids uuid[] default null)
returns table (label text, sources int)
language sql
stable
set search_path = grey, public
as $$
  select l.label, count(*)::int
    from grey.sources s
    cross join lateral pg_catalog.unnest(s.labels) as l(label)
   where s.project_id = p_project and s.deleted_at is null
     and (p_kb_ids is null or s.kb_id = any(p_kb_ids))
   group by l.label
   order by count(*) desc, l.label
   limit 200
$$;
revoke all on function grey.source_label_counts(uuid, uuid[]) from public, anon, authenticated;
grant execute on function grey.source_label_counts(uuid, uuid[]) to service_role;

-- ---------------------------------------------------------------------------
-- grey.tools — the draft spec lives here; published snapshots in grey.tool_versions.
-- ---------------------------------------------------------------------------
create table if not exists grey.tools (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  description text check (description is null or char_length(description) <= 500),
  spec jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft', 'live')),
  current_version integer not null default 0,
  test_report jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists tools_project_idx on grey.tools(project_id) where deleted_at is null;
drop trigger if exists tools_touch on grey.tools;
create trigger tools_touch before update on grey.tools for each row execute function grey.touch_updated_at();

-- status, current_version and test_report are set by the publish and test routes (service role).
create or replace function grey.tools_lock_server_fields()
returns trigger
language plpgsql
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' and (
       new.status is distinct from old.status
       or new.current_version is distinct from old.current_version
       or new.test_report is distinct from old.test_report
     ) then
    raise exception 'TOOL_SERVER_FIELDS_LOCKED';
  end if;
  return new;
end;
$$;
drop trigger if exists tools_lock_server_fields on grey.tools;
create trigger tools_lock_server_fields before update on grey.tools
for each row execute function grey.tools_lock_server_fields();

-- Inserts can't pre-set the server fields either.
create or replace function grey.tools_insert_defaults()
returns trigger
language plpgsql
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    new.status := 'draft';
    new.current_version := 0;
    new.test_report := null;
  end if;
  return new;
end;
$$;
drop trigger if exists tools_insert_defaults on grey.tools;
create trigger tools_insert_defaults before insert on grey.tools
for each row execute function grey.tools_insert_defaults();

alter table grey.tools enable row level security;
drop policy if exists tools_member_all on grey.tools;
create policy tools_member_all on grey.tools for all to authenticated
  using (grey.can_access_project(project_id)) with check (grey.can_access_project(project_id));
drop policy if exists tools_insert_guard on grey.tools;
create policy tools_insert_guard on grey.tools as restrictive for insert to authenticated
  with check (grey.rbac_allows('grey.tool.manage', project_id));
drop policy if exists tools_update_guard on grey.tools;
create policy tools_update_guard on grey.tools as restrictive for update to authenticated
  using (grey.rbac_allows('grey.tool.manage', project_id)) with check (grey.rbac_allows('grey.tool.manage', project_id));
drop policy if exists tools_delete_guard on grey.tools;
create policy tools_delete_guard on grey.tools as restrictive for delete to authenticated
  using (grey.rbac_allows('grey.tool.manage', project_id));

create table if not exists grey.tool_versions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  tool_id uuid not null references grey.tools(id) on delete cascade,
  version integer not null check (version >= 1),
  spec jsonb not null,
  note text,
  test_report jsonb,
  published_by uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists tool_versions_project_idx on grey.tool_versions(project_id) where deleted_at is null;
create unique index if not exists tool_versions_tool_version_uniq
  on grey.tool_versions(tool_id, version) where deleted_at is null;
drop trigger if exists tool_versions_touch on grey.tool_versions;
create trigger tool_versions_touch before update on grey.tool_versions for each row execute function grey.touch_updated_at();
alter table grey.tool_versions enable row level security;
drop policy if exists tool_versions_member_select on grey.tool_versions;
create policy tool_versions_member_select on grey.tool_versions for select to authenticated
  using (grey.can_access_project(project_id));

-- One row per run on any channel. input/output are summaries — never image bytes.
create table if not exists grey.tool_runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  tool_id uuid not null references grey.tools(id) on delete cascade,
  version integer not null default 0,
  channel text not null check (channel in ('playground', 'api', 'mcp', 'test')),
  status text not null check (status in ('ok', 'error')),
  input jsonb not null default '{}'::jsonb,
  output jsonb not null default '{}'::jsonb,
  usage jsonb not null default '{}'::jsonb,
  latency_ms integer,
  error_code text,
  api_key_id uuid references grey.api_keys(id) on delete set null,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists tool_runs_tool_idx on grey.tool_runs(tool_id, created_at desc);
create index if not exists tool_runs_project_idx on grey.tool_runs(project_id, created_at desc);
alter table grey.tool_runs enable row level security;
drop policy if exists tool_runs_member_select on grey.tool_runs;
create policy tool_runs_member_select on grey.tool_runs for select to authenticated
  using (grey.can_access_project(project_id));

-- The builder chat. Assistant rows carry metadata.specBefore / specAfter / edits so a turn can
-- be undone.
create table if not exists grey.tool_messages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  tool_id uuid not null references grey.tools(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists tool_messages_tool_idx on grey.tool_messages(tool_id, created_at) where deleted_at is null;
drop trigger if exists tool_messages_touch on grey.tool_messages;
create trigger tool_messages_touch before update on grey.tool_messages for each row execute function grey.touch_updated_at();
alter table grey.tool_messages enable row level security;
drop policy if exists tool_messages_member_select on grey.tool_messages;
create policy tool_messages_member_select on grey.tool_messages for select to authenticated
  using (grey.can_access_project(project_id));

-- ---------------------------------------------------------------------------
-- API keys: the tools a key with the "tools" scope may run. Empty means none — unlike
-- pipeline_ids, where empty means every pipeline.
-- ---------------------------------------------------------------------------
alter table grey.api_keys add column if not exists tool_ids uuid[] not null default '{}';

-- ---------------------------------------------------------------------------
-- System roles: new permissions (geiger-rbac.config.js is the source of truth for new
-- projects; this fills in existing ones). Owner's "*" already covers them.
-- ---------------------------------------------------------------------------
update public.roles r
   set permissions = (
     select array(select distinct p from pg_catalog.unnest(r.permissions || grants.keys) as p order by p)
   )
  from (values
    ('admin', array['grey.tools.view', 'grey.tool.manage', 'grey.tool.publish']),
    ('manager', array['grey.tools.view', 'grey.tool.manage', 'grey.tool.publish']),
    ('member', array['grey.tools.view'])
  ) as grants(role_key, keys)
 where r.is_system and r.deleted_at is null and r.key = grants.role_key
   and not (r.permissions @> grants.keys);

-- @down
update public.roles r
   set permissions = array(
     select p from pg_catalog.unnest(r.permissions) as p
      where p not in ('grey.tools.view', 'grey.tool.manage', 'grey.tool.publish')
   )
 where r.is_system and r.deleted_at is null and r.key in ('admin', 'manager', 'member');

alter table grey.api_keys drop column if exists tool_ids;
drop table if exists grey.tool_messages cascade;
drop table if exists grey.tool_runs cascade;
drop table if exists grey.tool_versions cascade;
drop table if exists grey.tools cascade;
drop function if exists grey.tools_insert_defaults();
drop function if exists grey.tools_lock_server_fields();
drop function if exists grey.source_label_counts(uuid, uuid[]);

drop function if exists grey.match_chunks_text(uuid, uuid[], text, int, text, uuid[], uuid[]);
drop function if exists grey.match_chunks_vector(uuid, uuid[], int, public.halfvec, int, real, text, uuid[], uuid[]);

-- The previous signatures (20261018120200_retrieval.sql).
create or replace function grey.match_chunks_vector(
  p_project uuid,
  p_kb_ids uuid[],
  p_dims int,
  p_query public.halfvec,
  p_limit int default 50,
  p_min_similarity real default 0
)
returns table (
  chunk_id uuid,
  source_id uuid,
  source_name text,
  kb_id uuid,
  content text,
  page int,
  start_ms int,
  end_ms int,
  heading_path text[],
  score real
)
language plpgsql
stable
set search_path = grey, public
as $$
begin
  if p_dims is null or p_dims < 64 or p_dims > 4000 then
    raise exception 'BAD_DIMS';
  end if;
  perform set_config('hnsw.iterative_scan', 'relaxed_order', true);
  perform set_config('hnsw.ef_search', '100', true);
  return query execute format($q$
    select * from (
      select c.id, c.source_id, s.name, c.kb_id, c.content, c.page, c.start_ms, c.end_ms, c.heading_path,
             (1 - (c.embedding::public.halfvec(%s) <=> $1::public.halfvec(%s)))::real as score
        from grey.chunks c
        join grey.sources s on s.id = c.source_id and s.project_id = c.project_id and s.deleted_at is null
        join grey.knowledge_bases k on k.id = c.kb_id and k.project_id = $2 and k.deleted_at is null
       where c.project_id = $2 and c.kb_id = any($3) and c.deleted_at is null
         and c.state = 'live' and c.embedding_dims = %s
       order by c.embedding::public.halfvec(%s) <=> $1::public.halfvec(%s)
       limit $4) r
    where r.score >= $5
    order by r.score desc$q$, p_dims, p_dims, p_dims, p_dims, p_dims)
  using p_query, p_project, p_kb_ids,
        greatest(1, least(coalesce(p_limit, 50), 200)), coalesce(p_min_similarity, 0);
end;
$$;

create or replace function grey.match_chunks_text(
  p_project uuid,
  p_kb_ids uuid[],
  p_query text,
  p_limit int default 50
)
returns table (
  chunk_id uuid,
  source_id uuid,
  source_name text,
  kb_id uuid,
  content text,
  page int,
  start_ms int,
  end_ms int,
  heading_path text[],
  score real
)
language plpgsql
stable
set search_path = grey, public
as $$
declare
  v_query tsquery := grey.or_tsquery(p_query);
begin
  if v_query is null then
    return;
  end if;
  return query
    select c.id, c.source_id, s.name, c.kb_id, c.content, c.page, c.start_ms, c.end_ms, c.heading_path,
           ts_rank_cd(c.fts, v_query, 32)::real
      from grey.chunks c
      join grey.sources s on s.id = c.source_id and s.project_id = c.project_id and s.deleted_at is null
      join grey.knowledge_bases k on k.id = c.kb_id and k.project_id = p_project and k.deleted_at is null
     where c.project_id = p_project and c.kb_id = any(p_kb_ids) and c.deleted_at is null
       and c.state = 'live' and c.fts @@ v_query
     order by ts_rank_cd(c.fts, v_query, 32) desc, c.id
     limit greatest(1, least(coalesce(p_limit, 50), 200));
end;
$$;

revoke all on function grey.match_chunks_vector(uuid, uuid[], int, public.halfvec, int, real) from public, anon, authenticated;
grant execute on function grey.match_chunks_vector(uuid, uuid[], int, public.halfvec, int, real) to service_role;
revoke all on function grey.match_chunks_text(uuid, uuid[], text, int) from public, anon, authenticated;
grant execute on function grey.match_chunks_text(uuid, uuid[], text, int) to service_role;

drop index if exists grey.sources_labels_idx;
alter table grey.sources drop constraint if exists sources_labels_check;
alter table grey.sources drop column if exists labels;
drop function if exists grey.labels_valid(text[]);
alter table grey.chunks drop constraint if exists chunks_modality_check;
alter table grey.chunks drop column if exists modality;
