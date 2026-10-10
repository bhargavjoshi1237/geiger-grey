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
--   20260809135817_rbac_org_role_mapping.sql  — rbac_role_for_member
--   20261002091000_operations_role_write_guards.sql — ported as FINAL bodies,
--     not as the events "rename to ops_private_*, wrap in a public shim"
--     dance: that dance exists in events only to harden an already-deployed
--     function without breaking existing callers mid-migration. grey has no
--     prior deployment, so rbac_ensure_membership / sync_project_team are
--     defined once, directly, with the hardened (final) body:
--       - rbac_ensure_membership: locks the project row (for update) to
--         serialize concurrent onboarding; never trusts a caller-supplied
--         p_default_role (kept only for signature compatibility; unused) and
--         has no default-role fallback at all — no suite mapping + no valid
--         invite means no access; never promotes a "first joiner" to Owner;
--         always claims the caller's pending project_members row by
--         project+email (any status) in place, denies outright on a
--         'suspended' row, and only honours an 'invited' row's role while it
--         is still scoped to this project.
--       - sync_project_team: requires coalesce(auth.role(), '') =
--         'service_role', grey.can_administer_roles(project_id) or a
--         grey.team.assign grant; never trusts a caller-supplied default
--         role either — it resolves the project's own 'member' role
--         server-side; never re-adds a removed member (soft-deleted roster
--         row or revoked grant).
--       - grey.check_role_grant_project(): a trigger on grey.role_grants
--         enforcing that a grant's role actually belongs to the grant's
--         project (or is a null-project suite template) — closes the gap
--         where the role_id FK alone only checks the UUID exists, not that
--         it is scoped to the right project.
--     Every SECURITY DEFINER function below has EXECUTE revoked from
--     public/anon. What's granted to authenticated vs. service_role varies
--     per function: rbac_role_for_member and rbac_ensure_membership grant to
--     both (the app calls them as the signed-in user); sync_project_team
--     grants to both too but additionally gates itself on service_role OR an
--     administering caller; can_administer_roles grants to both (RLS calls it
--     as authenticated, admin tooling may call it as service_role);
--     check_role_grant_project is a trigger function and is granted to none
--     of them — Postgres invokes it directly as the trigger owner.
--
-- Owns:
--   grey.project_members   — per-project assignment overlay (role/status/groups)
--   grey.member_groups     — sub-teams within a project
--   grey.member_activity   — append-only audit feed (select+insert only; no
--                            update/delete policy — nothing may rewrite history)
--   grey.rbac_role_for_member(uuid, uuid)   suite org role -> grey role id
--   grey.rbac_ensure_membership(uuid, uuid) the caller's own roster row + grant
--   grey.sync_project_team(uuid, uuid)      org -> roster + default grant
--   grey.can_administer_roles(uuid)         write-guard predicate
--   grey.check_role_grant_project()         role_grants project-boundary trigger
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
-- member_activity — append-only audit feed. Only select + insert policies are
-- granted: there is deliberately no update/delete policy, so RLS denies any
-- attempt to rewrite or erase history even from an authenticated member.
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
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists member_activity_project_idx
  on grey.member_activity (project_id, created_at desc);

drop trigger if exists member_activity_touch on grey.member_activity;
create trigger member_activity_touch before update on grey.member_activity
for each row execute function grey.touch_updated_at();

alter table grey.member_activity enable row level security;
drop policy if exists member_activity_member_all on grey.member_activity;
drop policy if exists member_activity_member_select on grey.member_activity;
create policy member_activity_member_select on grey.member_activity for select to authenticated
  using (grey.can_access_project(project_id));
drop policy if exists member_activity_member_insert on grey.member_activity;
create policy member_activity_member_insert on grey.member_activity for insert to authenticated
  with check (grey.can_access_project(project_id));

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

revoke all on function grey.rbac_role_for_member(uuid, uuid) from public, anon;
grant execute on function grey.rbac_role_for_member(uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The caller's own membership — hardened final body (ported from events
-- 20261002091000_operations_role_write_guards.sql without the rename dance).
--
--   - Locks the project row (for update) to serialize concurrent onboarding
--     attempts for this project, so two simultaneous calls for the same
--     person can't both decide to insert a grant/roster row at once.
--   - Never promotes a first joiner to Owner. Ownership comes only from the
--     suite role mapping (grey.rbac_role_for_member) or an explicit grant.
--   - p_default_role is accepted for signature compatibility but IGNORED — a
--     caller-supplied role id is never trusted, and there is no fallback to
--     any project default role either: no suite mapping + no valid invite
--     means no access (mirrors events; no default-role widening).
--   - Always locates (for update) the caller's pending project_members row by
--     project+email, regardless of status, and claims it in place rather
--     than inserting a second row (project_members_email_uniq would reject
--     that). A 'suspended' row is an explicit denial (return null, no
--     grant). An 'invited' row's role is honoured only while it still points
--     at a role scoped to this project (not a null-project template, which
--     an invite should never use).
-- ---------------------------------------------------------------------------
create or replace function grey.rbac_ensure_membership(
  p_project_id uuid,
  p_default_role uuid default null -- unused; kept for call-site signature compatibility
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

  -- Serialize onboarding for this project; only canonical membership or a
  -- real admin-created invitation can establish a role.
  perform 1 from public.projects where id = p_project_id for update;
  if not found or not grey.can_access_project(p_project_id) then
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

  -- The caller's pending roster row, if any — located by project+email
  -- regardless of status and locked for the duration of this decision, so
  -- the claim below always lands on this row and never collides with
  -- project_members_email_uniq by inserting a second one.
  select * into v_invite
    from grey.project_members
   where project_id = p_project_id
     and user_id is null
     and v_email <> ''
     and lower(email) = lower(v_email)
     and deleted_at is null
   limit 1
   for update;

  -- A suspended invite is an explicit denial: never grant from it, and never
  -- fall through to the suite-role mapping either.
  if v_invite.id is not null and v_invite.status = 'suspended' then
    return null;
  end if;

  -- What their suite role entitles them to.
  v_role := grey.rbac_role_for_member(p_project_id, v_uid);

  -- Then an explicit invitation — only while it is still status='invited'
  -- and points at a role that actually belongs to this project (never a
  -- null-project template, which an invite should never use).
  if v_role is null
     and v_invite.id is not null
     and v_invite.status = 'invited'
     and exists (
       select 1 from public.roles r
        where r.id = v_invite.role_id and r.project_id = p_project_id and r.deleted_at is null
     )
  then
    v_role := v_invite.role_id;
  end if;

  -- Neither the suite mapping nor a valid invite yields a role: no access.
  -- There is deliberately no fallback to a project default role — that would
  -- silently widen access for anyone merely able to reach the project.
  if v_role is null then
    return null;
  end if;

  insert into grey.role_grants (project_id, user_id, role_id, status)
  values (p_project_id, v_uid, v_role, 'active')
  on conflict do nothing;

  if v_invite.id is not null then
    -- Claim the existing row in place rather than inserting a second one for
    -- this email. Only flip status to 'active' when it was 'invited' — any
    -- other status (there is no other reachable one here, 'suspended' having
    -- already returned) is left as-is.
    update grey.project_members
       set user_id = v_uid,
           role_id = v_role,
           status = case when status = 'invited' then 'active' else status end,
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

revoke all on function grey.rbac_ensure_membership(uuid, uuid) from public, anon;
grant execute on function grey.rbac_ensure_membership(uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- True when the user's access to the project was revoked: they hold a
-- soft-deleted grant and no live one. A live-only grant (e.g. the owner
-- backfill, which has no roster row yet) does not count, so sync still lists
-- that person.
-- ---------------------------------------------------------------------------
create or replace function grey.team_member_revoked(p_project_id uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = public, grey as $$
  select exists (
    select 1 from grey.role_grants g
    where g.project_id = p_project_id and g.user_id = p_user and g.deleted_at is not null
  ) and not exists (
    select 1 from grey.role_grants g
    where g.project_id = p_project_id and g.user_id = p_user and g.deleted_at is null
  );
$$;

revoke all on function grey.team_member_revoked(uuid, uuid) from public, anon, authenticated;
grant execute on function grey.team_member_revoked(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Bulk sync — hardened final body. Gated: only service_role or someone who
-- can already administer this project's roles may run it. The authorization
-- raise sits OUTSIDE the exception-guarded block below, so it is never
-- swallowed by the shared-schema-mismatch handler.
-- ---------------------------------------------------------------------------
create or replace function grey.sync_project_team(
  p_project_id uuid,
  p_default_role uuid default null -- unused; kept for call-site signature compatibility
)
returns integer
language plpgsql
security definer
set search_path = public, grey, auth
as $$
declare
  v_org uuid;
  v_creator uuid;
  v_member_role uuid;
  v_count integer := 0;
begin
  if p_project_id is null then
    return 0;
  end if;

  if coalesce(auth.role(), '') <> 'service_role'
     and not grey.can_administer_roles(p_project_id)
     and not grey.rbac_allows('grey.team.assign', p_project_id) then
    raise exception 'Project role administration required' using errcode = '42501';
  end if;

  begin
    select organization_id, created_by
      into v_org, v_creator
      from public.projects
     where id = p_project_id;

    -- Default role resolved server-side; a caller-supplied id is never used.
    select r.id into v_member_role
      from public.roles r
     where r.project_id = p_project_id and r.key = 'member' and r.deleted_at is null
     limit 1;

    if v_org is not null then
      insert into grey.project_members (
        project_id, user_id, role_id, status, email, name, avatar_url, joined_at
      )
      select
        p_project_id,
        u.id,
        coalesce(grey.rbac_role_for_member(p_project_id, u.id), v_member_role),
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
        -- Any roster row, live or soft-deleted: a removed member stays removed.
        and not exists (
          select 1 from grey.project_members m
          where m.project_id = p_project_id
            and m.user_id = u.id
        )
        and not grey.team_member_revoked(p_project_id, u.id);

      get diagnostics v_count = row_count;
    end if;

    if v_creator is not null then
      insert into grey.project_members (
        project_id, user_id, role_id, status, email, name, avatar_url, joined_at
      )
      select
        p_project_id, u.id,
        coalesce(grey.rbac_role_for_member(p_project_id, u.id), v_member_role),
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
        )
        and not grey.team_member_revoked(p_project_id, v_creator);
    end if;

    insert into grey.role_grants (project_id, user_id, role_id, status)
    select
      p_project_id,
      m.user_id,
      coalesce(grey.rbac_role_for_member(p_project_id, m.user_id), v_member_role),
      'active'
    from grey.project_members m
    where m.project_id = p_project_id
      and m.user_id is not null
      and m.deleted_at is null
      and coalesce(grey.rbac_role_for_member(p_project_id, m.user_id), v_member_role) is not null
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
end;
$$;

revoke all on function grey.sync_project_team(uuid, uuid) from public, anon;
grant execute on function grey.sync_project_team(uuid, uuid) to authenticated, service_role;

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

-- Each guard also admits a grey grant carrying the matching permission, so a
-- project Admin/Manager role works without an org owner/admin seat:
--   public.roles writes     -> grey.role.manage
--   role_grants writes      -> grey.team.assign
--   project_members insert  -> grey.team.invite (pending, account-less invites only)
--   project_members update  -> grey.team.assign, or grey.team.invite on pending invites (revoking one)
drop policy if exists grey_roles_insert_guard on public.roles;
create policy grey_roles_insert_guard on public.roles as restrictive for insert to authenticated
  with check (grey.can_administer_roles(project_id) or grey.rbac_allows('grey.role.manage', project_id));
drop policy if exists grey_roles_update_guard on public.roles;
create policy grey_roles_update_guard on public.roles as restrictive for update to authenticated
  using (grey.can_administer_roles(project_id) or grey.rbac_allows('grey.role.manage', project_id))
  with check (grey.can_administer_roles(project_id) or grey.rbac_allows('grey.role.manage', project_id));
drop policy if exists grey_roles_delete_guard on public.roles;
create policy grey_roles_delete_guard on public.roles as restrictive for delete to authenticated
  using (grey.can_administer_roles(project_id) or grey.rbac_allows('grey.role.manage', project_id));

drop policy if exists grey_grants_insert_guard on grey.role_grants;
create policy grey_grants_insert_guard on grey.role_grants as restrictive for insert to authenticated
  with check (grey.can_administer_roles(project_id) or grey.rbac_allows('grey.team.assign', project_id));
drop policy if exists grey_grants_update_guard on grey.role_grants;
create policy grey_grants_update_guard on grey.role_grants as restrictive for update to authenticated
  using (grey.can_administer_roles(project_id) or grey.rbac_allows('grey.team.assign', project_id))
  with check (grey.can_administer_roles(project_id) or grey.rbac_allows('grey.team.assign', project_id));
drop policy if exists grey_grants_delete_guard on grey.role_grants;
create policy grey_grants_delete_guard on grey.role_grants as restrictive for delete to authenticated
  using (grey.can_administer_roles(project_id) or grey.rbac_allows('grey.team.assign', project_id));

-- Explicit onboarding invitations must be created by role administrators, or
-- by an inviter, who may only create and revoke pending, account-less rows.
drop policy if exists grey_roster_insert_guard on grey.project_members;
create policy grey_roster_insert_guard on grey.project_members as restrictive for insert to authenticated
  with check (
    grey.can_administer_roles(project_id)
    or grey.rbac_allows('grey.team.assign', project_id)
    or (status = 'invited' and user_id is null and grey.rbac_allows('grey.team.invite', project_id))
  );
drop policy if exists grey_roster_update_guard on grey.project_members;
create policy grey_roster_update_guard on grey.project_members as restrictive for update to authenticated
  using (
    grey.can_administer_roles(project_id)
    or grey.rbac_allows('grey.team.assign', project_id)
    or (status = 'invited' and user_id is null and grey.rbac_allows('grey.team.invite', project_id))
  )
  with check (
    grey.can_administer_roles(project_id)
    or grey.rbac_allows('grey.team.assign', project_id)
    or (status = 'invited' and user_id is null and grey.rbac_allows('grey.team.invite', project_id))
  );
drop policy if exists grey_roster_delete_guard on grey.project_members;
create policy grey_roster_delete_guard on grey.project_members as restrictive for delete to authenticated
  using (grey.can_administer_roles(project_id) or grey.rbac_allows('grey.team.assign', project_id));

-- ---------------------------------------------------------------------------
-- grey.role_grants project-boundary trigger. The role_id FK alone only checks
-- that the uuid exists in public.roles — not that the role is scoped to the
-- grant's own project. Without this, a grant could be pointed at another
-- project's role. A null-project role (a suite-wide template) is still valid.
-- ---------------------------------------------------------------------------
create or replace function grey.check_role_grant_project()
returns trigger
language plpgsql
security definer
set search_path = public, grey
as $$
begin
  if new.project_id is null or not exists (
    select 1 from public.roles r where r.id = new.role_id
      and (r.project_id = new.project_id or r.project_id is null)
  ) then
    raise exception 'Role grant project mismatch' using errcode = '23503';
  end if;
  return new;
end;
$$;

revoke all on function grey.check_role_grant_project() from public, anon, authenticated;

drop trigger if exists role_grant_project_guard on grey.role_grants;
create trigger role_grant_project_guard before insert or update of project_id, role_id on grey.role_grants
  for each row execute function grey.check_role_grant_project();

-- @down
drop trigger if exists role_grant_project_guard on grey.role_grants;
drop function if exists grey.check_role_grant_project();
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
drop function if exists grey.team_member_revoked(uuid, uuid);
drop function if exists grey.rbac_ensure_membership(uuid, uuid);
drop function if exists grey.rbac_role_for_member(uuid, uuid);
drop table if exists grey.member_activity cascade;
drop table if exists grey.member_groups cascade;
drop table if exists grey.project_members cascade;
