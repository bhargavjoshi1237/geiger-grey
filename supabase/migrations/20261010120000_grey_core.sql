-- Grey core — schema, extension and shared helpers
--
-- Owns: the grey schema + grants, grey.touch_updated_at() and
-- grey.can_access_project(uuid). Self-contained and idempotent so every later
-- grey migration can assume the schema and these two helpers exist.
--
-- grey.can_access_project is ported from geiger-events
-- (events.can_access_project in 20260726194134_project_access.sql), schema
-- renamed events -> grey. Mirrors flow.can_access_project: a project is
-- reachable by its org's members, by whoever created it, or (transitional,
-- matching unowned demo project rows) when it has no organization at all.

-- @up
create extension if not exists pgcrypto;

create schema if not exists grey;
grant usage on schema grey to anon, authenticated, service_role;
alter default privileges in schema grey grant select, insert, update, delete on tables to authenticated, service_role;

create or replace function grey.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function grey.can_access_project(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public, grey, auth
as $$
  select exists (
    select 1
    from public.projects p
    where p.id = target
      and (
        p.organization_id is null
        or public.is_org_member(p.organization_id)
        or p.created_by = auth.uid()
      )
  );
$$;

grant execute on function grey.can_access_project(uuid) to anon, authenticated;

-- @down
drop function if exists grey.can_access_project(uuid);
drop function if exists grey.touch_updated_at();
drop schema if exists grey cascade;
