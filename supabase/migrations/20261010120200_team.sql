-- Team & Members
--
-- Ported from geiger-events (schema events -> grey, key prefix events. ->
-- grey.):
--   20260726194123_team.sql              — project_members / member_groups /
--                                           member_activity tables (events.roles
--                                           is dropped: grey adopts
--                                           @geiger/rbac's public.roles from the
--                                           start, so there is no legacy roles
--                                           table to carry)
--   20260809133335_rbac_team_management.sql
--   20260809134349_rbac_claim_invitation.sql
--   20260809135817_rbac_org_role_mapping.sql  — final, suite-role-aware bodies
--                                                 of rbac_ensure_membership /
--                                                 sync_project_team are ported
--                                                 directly (the two intermediate
--                                                 events migrations only exist
--                                                 to show how those functions
--                                                 evolved; grey starts at the
--                                                 final version)
--   20261002091000_operations_role_write_guards.sql — only the roles / grants /
--                                                       members restrictive
--                                                       write guards; helper
--                                                       renamed
--                                                       events.ops_can_administer_roles
--                                                       -> grey.can_administer_roles
--
-- Owns:
--   grey.project_members   — per-project assignment overlay (role/status/groups)
--   grey.member_groups     — sub-teams within a project
--   grey.member_activity   — append-only audit feed
--   grey.rbac_role_for_member(uuid, uuid)   suite org role -> grey role id
--   grey.rbac_ensure_membership(uuid, uuid) the caller's own roster row + grant
--   grey.sync_project_team(uuid, uuid)      org -> roster + default grant
--   grey.can_administer_roles(uuid)         write-guard predicate
--
-- Role authority is grey.role_grants (adopted in the previous migration) and
-- nothing else; project_members is the display/invitation overlay only.

-- @up
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- project_members — the assignment overlay. One row per person with access to
-- the project. user_id is a soft reference (no FK) so an invited-but-not-yet
-- registered person can hold a row keyed by email alone. name/email/avatar are
-- denormalized snapshots for display.
-- ---------------------------------------------------------------------------
create table if not exists grey.project_members (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid,
  role_id uuid references public.roles(id) on delete set null,
  status text not null default 'active' check (status in ('active', 'invited', 'suspended')),
  email text not null default '',
  name text not null default '',
  avatar_url text,
  group_ids uuid[] not null default '{}',
  invited_by uuid,
  invited_at timestamptz,
  joined_at timestamptz,
  last_active_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists project_members_project_idx
  on grey.project_members (project_id) where deleted_at is null;
create index if not exists project_members_groups_idx
  on grey.project_members using gin (group_ids);
create unique index if not exists project_members_user_uniq
  on grey.project_members (project_id, user_id) where user_id is not null and deleted_at is null;
create unique index if not exists project_members_email_uniq
  on grey.project_members (project_id, lower(email)) where email <> '' and deleted_at is null;

drop trigger if exists project_members_touch on grey.project_members;
create trigger project_members_touch before update on grey.project_members
for each row execute function grey.touch_updated_at();

alter table grey.project_members enable row level security;
drop policy if exists project_members_member_all on grey.project_members;
create policy project_members_member_all on grey.project_members for all to authenticated
  using (grey.can_access_project(project_id)) with check (grey.can_access_project(project_id));

-- ---------------------------------------------------------------------------
-- member_groups — sub-teams. Membership is stored as an array on the member
-- (project_members.group_ids), so no join table is needed.
-- ---------------------------------------------------------------------------
create table if not exists grey.member_groups (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null default 'Untitled group',
  description text not null default '',
  color text not null default 'slate',
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists member_groups_project_idx
  on grey.member_groups (project_id) where deleted_at is null;

drop trigger if exists member_groups_touch on grey.member_groups;
create trigger member_groups_touch before update on grey.member_groups
for each row execute function grey.touch_updated_at();

alter table grey.member_groups enable row level security;
drop policy if exists member_groups_member_all on grey.member_groups;
create policy member_groups_member_all on grey.member_groups for all to authenticated
  using (grey.can_access_project(project_id)) with check (grey.can_access_project(project_id));

-- ---------------------------------------------------------------------------
-- member_activity — append-only audit feed (no updated_at / soft delete).
-- action: invited | role_changed | status_changed | removed | group_changed |
--         role_created | role_updated | role_deleted | group_created
-- ---------------------------------------------------------------------------
create table if not exists grey.member_activity (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  actor_user_id uuid,
  actor_name text not null default '',
  target_member_id uuid,
  target_name text not null default '',
  action text not null,
  detail jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create index if not exists member_activity_project_idx
  on grey.member_activity (project_id, created_at desc);

alter table grey.member_activity enable row level security;
drop policy if exists member_activity_member_all on grey.member_activity;
create policy member_activity_member_all on grey.member_activity for all to authenticated
  using (grey.can_access_project(project_id)) with check (grey.can_access_project(project_id));

-- ---------------------------------------------------------------------------
-- The grey role a person should hold in a project, from their suite org role.
-- Returns null when they are not a member of the project's org and did not
-- create the project.
--
--   Owner                     -> owner    (holds "*")
--   ADMIN / Admin              -> admin
--   Manager                    -> manager
--   everything else            -> member
-- ---------------------------------------------------------------------------
create or replace function grey.rbac_role_for_member(
  p_project_id uuid,
  p_user uuid
)
returns uuid
language plpgsql
stable
security definer
set search_path = public, grey, auth
as $$
declare
  v_org uuid;
  v_creator uuid;
  v_org_role text;
  v_key text;
  v_role uuid;
begin
  if p_project_id is null or p_user is null then
    return null;
  end if;

  select organization_id, created_by
    into v_org, v_creator
    from public.projects
   where id = p_project_id;

  if v_org is not null then
    select lower(ou.role::text) into v_org_role
      from public.organization_users ou
     where ou."organization" = v_org
       and ou."user" = p_user
     limit 1;
  end if;

  v_key := case
    when v_org_role = 'owner' then 'owner'
    when v_org_role in ('admin') then 'admin'
    when v_org_role in ('manager') then 'manager'
    when v_org_role is not null then 'member'
    else null
  end;

  if v_key is null and v_creator = p_user then
    v_key := 'owner';
  end if;

  if v_key is null then
    return null;
  end if;

  select r.id into v_role
    from public.roles r
   where r.project_id = p_project_id
     and r.key = v_key
     and r.deleted_at is null
   limit 1;

  if v_role is null and v_key <> 'member' then
    select r.id into v_role
      from public.roles r
     where r.project_id = p_project_id
       and r.key = 'member'
       and r.deleted_at is null
     limit 1;
  end if;

  return v_role;
end;
$$;

grant execute on function grey.rbac_role_for_member(uuid, uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- The caller's own membership, suite-role aware, and claims a pending email
-- invitation in place rather than inserting a second roster row for it.
-- ---------------------------------------------------------------------------
create or replace function grey.rbac_ensure_membership(
  p_project_id uuid,
  p_default_role uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, grey, auth
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_name text;
  v_avatar text;
  v_role uuid;
  v_existing uuid;
  v_ever integer;
  v_invite grey.project_members%rowtype;
begin
  if p_project_id is null or v_uid is null then
    return null;
  end if;

  if not grey.can_access_project(p_project_id) then
    return null;
  end if;

  select
    coalesce(u.email, ''),
    coalesce(
      nullif(u.raw_user_meta_data ->> 'full_name', ''),
      nullif(u.raw_user_meta_data ->> 'name', ''),
      split_part(coalesce(u.email, ''), '@', 1)
    ),
    nullif(u.raw_user_meta_data ->> 'avatar_url', '')
    into v_email, v_name, v_avatar
    from auth.users u
   where u.id = v_uid;

  select role_id into v_existing
    from grey.role_grants
   where project_id = p_project_id
     and user_id = v_uid
     and deleted_at is null
     and status = 'active'
   limit 1;

  if v_existing is not null then
    return v_existing;
  end if;

  -- A revoked grant is a decision, not a gap. Never hand one back.
  select count(*) into v_ever
    from grey.role_grants
   where project_id = p_project_id
     and user_id = v_uid;

  if v_ever > 0 then
    return null;
  end if;

  select * into v_invite
    from grey.project_members
   where project_id = p_project_id
     and user_id is null
     and v_email <> ''
     and lower(email) = lower(v_email)
     and deleted_at is null
   limit 1;

  -- What their suite role entitles them to.
  v_role := grey.rbac_role_for_member(p_project_id, v_uid);

  -- Then an explicit invitation, then the caller's default.
  if v_role is null then
    v_role := coalesce(v_invite.role_id, p_default_role);
  end if;

  -- First person into a project nobody administers claims it, so an ownerless
  -- workspace can never deadlock.
  if v_role is null or not exists (
    select 1 from grey.role_grants
     where project_id = p_project_id and deleted_at is null and status = 'active'
  ) then
    select r.id into v_existing
      from public.roles r
     where r.project_id = p_project_id and r.key = 'owner' and r.deleted_at is null
     limit 1;
    v_role := coalesce(v_existing, v_role);
  end if;

  if v_role is null then
    select r.id into v_role
      from public.roles r
     where r.project_id = p_project_id and r.key = 'member' and r.deleted_at is null
     limit 1;
  end if;

  if v_role is null then
    return null;   -- roles not seeded yet; the next pass picks it up
  end if;

  insert into grey.role_grants (project_id, user_id, role_id, status)
  values (p_project_id, v_uid, v_role, 'active')
  on conflict do nothing;

  if v_invite.id is not null then
    update grey.project_members
       set user_id = v_uid,
           role_id = v_role,
           status = 'active',
           name = case when name = '' then v_name else name end,
           avatar_url = coalesce(avatar_url, v_avatar),
           joined_at = coalesce(joined_at, now())
     where id = v_invite.id;
  else
    insert into grey.project_members (
      project_id, user_id, role_id, status, email, name, avatar_url, joined_at
    )
    select p_project_id, v_uid, v_role, 'active', v_email, v_name, v_avatar, now()
    where not exists (
      select 1 from grey.project_members m
      where m.project_id = p_project_id
        and m.user_id = v_uid
        and m.deleted_at is null
    );
  end if;

  return v_role;
end;
$$;

grant execute on function grey.rbac_ensure_membership(uuid, uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Bulk sync: for each member of the project's owning organization (and its
-- creator) that lacks an overlay row, insert one with their suite-mapped role.
-- Exception-guarded: a shared-schema shape mismatch degrades to a no-op.
-- ---------------------------------------------------------------------------
create or replace function grey.sync_project_team(
  p_project_id uuid,
  p_default_role uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public, grey, auth
as $$
declare
  v_org uuid;
  v_creator uuid;
  v_count integer := 0;
begin
  if p_project_id is null then
    return 0;
  end if;

  select organization_id, created_by
    into v_org, v_creator
    from public.projects
   where id = p_project_id;

  if v_org is not null then
    insert into grey.project_members (
      project_id, user_id, role_id, status, email, name, avatar_url, joined_at
    )
    select
      p_project_id,
      u.id,
      coalesce(grey.rbac_role_for_member(p_project_id, u.id), p_default_role),
      'active',
      coalesce(u.email, ''),
      coalesce(
        nullif(u.raw_user_meta_data ->> 'full_name', ''),
        nullif(u.raw_user_meta_data ->> 'name', ''),
        split_part(coalesce(u.email, ''), '@', 1)
      ),
      nullif(u.raw_user_meta_data ->> 'avatar_url', ''),
      now()
    from public.organization_users ou
    join auth.users u on u.id = ou."user"
    where ou."organization" = v_org
      and not exists (
        select 1 from grey.project_members m
        where m.project_id = p_project_id
          and m.user_id = u.id
          and m.deleted_at is null
      );

    get diagnostics v_count = row_count;
  end if;

  if v_creator is not null then
    insert into grey.project_members (
      project_id, user_id, role_id, status, email, name, avatar_url, joined_at
    )
    select
      p_project_id, u.id,
      coalesce(grey.rbac_role_for_member(p_project_id, u.id), p_default_role),
      'active',
      coalesce(u.email, ''),
      coalesce(
        nullif(u.raw_user_meta_data ->> 'full_name', ''),
        nullif(u.raw_user_meta_data ->> 'name', ''),
        split_part(coalesce(u.email, ''), '@', 1)
      ),
      nullif(u.raw_user_meta_data ->> 'avatar_url', ''),
      now()
    from auth.users u
    where u.id = v_creator
      and not exists (
        select 1 from grey.project_members m
        where m.project_id = p_project_id
          and m.user_id = v_creator
          and m.deleted_at is null
      );
  end if;

  insert into grey.role_grants (project_id, user_id, role_id, status)
  select
    p_project_id,
    m.user_id,
    coalesce(grey.rbac_role_for_member(p_project_id, m.user_id), p_default_role),
    'active'
  from grey.project_members m
  where m.project_id = p_project_id
    and m.user_id is not null
    and m.deleted_at is null
    and coalesce(grey.rbac_role_for_member(p_project_id, m.user_id), p_default_role) is not null
    and not exists (
      select 1 from grey.role_grants g
      where g.project_id = p_project_id
        and g.user_id = m.user_id
    );

  return v_count;
exception
  when others then
    return 0;
end;
$$;

grant execute on function grey.sync_project_team(uuid, uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Write guards. Restrictive policies cooperate with the permissive policies
-- above: both must pass. Reads stay open to any project member; only writes to
-- roles / grants / the invitation roster require role-administration rights.
-- ---------------------------------------------------------------------------
create or replace function grey.can_administer_roles(p_project_id uuid)
returns boolean language sql stable security definer set search_path = public, grey, auth as $$
  select p_project_id is not null and exists (
    select 1 from public.projects p where p.id = p_project_id and (
      (p.organization_id is null and p.created_by = auth.uid()) or exists (
        select 1 from public.organization_users ou
        where ou."organization" = p.organization_id and ou."user" = auth.uid()
          and lower(ou.role::text) in ('owner', 'admin')
      )
    )
  );
$$;

revoke all on function grey.can_administer_roles(uuid) from public, anon;
grant execute on function grey.can_administer_roles(uuid) to authenticated, service_role;

drop policy if exists grey_roles_insert_guard on public.roles;
create policy grey_roles_insert_guard on public.roles as restrictive for insert to authenticated
  with check (grey.can_administer_roles(project_id));
drop policy if exists grey_roles_update_guard on public.roles;
create policy grey_roles_update_guard on public.roles as restrictive for update to authenticated
  using (grey.can_administer_roles(project_id)) with check (grey.can_administer_roles(project_id));
drop policy if exists grey_roles_delete_guard on public.roles;
create policy grey_roles_delete_guard on public.roles as restrictive for delete to authenticated
  using (grey.can_administer_roles(project_id));

drop policy if exists grey_grants_insert_guard on grey.role_grants;
create policy grey_grants_insert_guard on grey.role_grants as restrictive for insert to authenticated
  with check (grey.can_administer_roles(project_id));
drop policy if exists grey_grants_update_guard on grey.role_grants;
create policy grey_grants_update_guard on grey.role_grants as restrictive for update to authenticated
  using (grey.can_administer_roles(project_id)) with check (grey.can_administer_roles(project_id));
drop policy if exists grey_grants_delete_guard on grey.role_grants;
create policy grey_grants_delete_guard on grey.role_grants as restrictive for delete to authenticated
  using (grey.can_administer_roles(project_id));

-- Explicit onboarding invitations must be created by role administrators.
drop policy if exists grey_roster_insert_guard on grey.project_members;
create policy grey_roster_insert_guard on grey.project_members as restrictive for insert to authenticated
  with check (grey.can_administer_roles(project_id));
drop policy if exists grey_roster_update_guard on grey.project_members;
create policy grey_roster_update_guard on grey.project_members as restrictive for update to authenticated
  using (grey.can_administer_roles(project_id)) with check (grey.can_administer_roles(project_id));
drop policy if exists grey_roster_delete_guard on grey.project_members;
create policy grey_roster_delete_guard on grey.project_members as restrictive for delete to authenticated
  using (grey.can_administer_roles(project_id));

-- @down
drop policy if exists grey_roster_delete_guard on grey.project_members;
drop policy if exists grey_roster_update_guard on grey.project_members;
drop policy if exists grey_roster_insert_guard on grey.project_members;
drop policy if exists grey_grants_delete_guard on grey.role_grants;
drop policy if exists grey_grants_update_guard on grey.role_grants;
drop policy if exists grey_grants_insert_guard on grey.role_grants;
drop policy if exists grey_roles_delete_guard on public.roles;
drop policy if exists grey_roles_update_guard on public.roles;
drop policy if exists grey_roles_insert_guard on public.roles;
drop function if exists grey.can_administer_roles(uuid);
drop function if exists grey.sync_project_team(uuid, uuid);
drop function if exists grey.rbac_ensure_membership(uuid, uuid);
drop function if exists grey.rbac_role_for_member(uuid, uuid);
drop table if exists grey.member_activity cascade;
drop table if exists grey.member_groups cascade;
drop table if exists grey.project_members cascade;
