-- Worker queue — leases, staged chunks and the atomic swap
--
-- From backend spec sections 5.2–5.5 and 11. The jobs tables are the queue (no
-- pgmq): the worker LISTENs on "grey_jobs" and polls as a fallback.
--
-- Adds:
--   grey.ingestion_jobs / grey.eval_runs  attempts, max_attempts, run_after,
--                                         locked_by, locked_until (+ claim indexes)
--   grey.chunks                           job_id, state ('staged'|'live'), search_text
--                                         + unique (job_id, ordinal) for staged rows
--   grey.usage_events                     unique (ref_id, kind) for ingestion jobs
--   grey.notify_grey_jobs()               pg_notify('grey_jobs', ...) when a job is queued
--   triggers sources_scope_guard /        a source's KB is in its project and its
--            ingestion_jobs_scope_guard   storage_path under <project_id>/; a job's
--                                         source + KB are the job's project's. The
--                                         service-role worker trusts these ids, so a
--                                         member must not be able to point a job (or
--                                         a source's file) at another tenant's data.
--
-- Service-role functions (EXECUTE revoked from public/anon/authenticated):
--   grey.ingestion_paused(project)                  soft cap reached + pause_ingestion
--   grey.claim_ingestion_job(worker, lease, max)    lease one job (one statement)
--   grey.heartbeat_ingestion_job(job, worker, lease)
--   grey.release_ingestion_job(job, worker, status, error, delay, refund, metadata)
--   grey.swap_source_chunks(job, worker)            staged -> live, old live deleted
--   grey.claim_eval_run(worker, lease, max)
--   grey.heartbeat_eval_run(run, worker, lease)
--   grey.release_eval_run(run, worker, refund)
--
-- Every reader of grey.chunks must filter state = 'live'.
-- Depends on 20261018120000_providers_byo.sql for grey.project_month_spend().

-- @up

-- ---------------------------------------------------------------------------
-- Lease columns
-- ---------------------------------------------------------------------------
alter table grey.ingestion_jobs
  add column if not exists attempts integer not null default 0,
  add column if not exists max_attempts integer not null default 3,
  add column if not exists run_after timestamptz not null default now(),
  add column if not exists locked_by text,
  add column if not exists locked_until timestamptz;

create index if not exists ingestion_jobs_claim_idx
  on grey.ingestion_jobs (run_after, created_at) where deleted_at is null and status = 'queued';
create index if not exists ingestion_jobs_running_idx
  on grey.ingestion_jobs (project_id, locked_until) where deleted_at is null and status = 'running';

alter table grey.eval_runs
  add column if not exists attempts integer not null default 0,
  add column if not exists max_attempts integer not null default 3,
  add column if not exists run_after timestamptz not null default now(),
  add column if not exists locked_by text,
  add column if not exists locked_until timestamptz;

create index if not exists eval_runs_claim_idx
  on grey.eval_runs (run_after, created_at) where deleted_at is null and status = 'queued';
create index if not exists eval_runs_running_idx
  on grey.eval_runs (project_id, locked_until) where deleted_at is null and status = 'running';

-- ---------------------------------------------------------------------------
-- Tenant scope. RLS only checks that the writer can access the row's
-- project_id; nothing tied the row's other ids to that project. SECURITY
-- DEFINER so the checks see every row regardless of RLS (they only compare ids
-- and never return data). Soft-deleted rows still satisfy them — deletion is
-- handled by the queue, not here.
-- ---------------------------------------------------------------------------
create or replace function grey.guard_source_scope()
returns trigger
language plpgsql
security definer
set search_path = grey, public
as $$
begin
  if not exists (
    select 1 from grey.knowledge_bases k where k.id = new.kb_id and k.project_id = new.project_id
  ) then
    raise exception 'SOURCE_KB_MISMATCH' using errcode = 'check_violation',
      detail = 'The knowledge base does not belong to the source''s project.';
  end if;
  -- Uploads live at <project_id>/<kb_id>/<source_id>/<file> in grey-sources.
  if new.storage_path is not null
     and (not starts_with(new.storage_path, new.project_id::text || '/')
          or new.storage_path ~ '(^|/)\.\.?(/|$)') then
    raise exception 'SOURCE_STORAGE_PATH_INVALID' using errcode = 'check_violation',
      detail = 'storage_path must be inside the source''s project folder.';
  end if;
  return new;
end;
$$;

create or replace function grey.guard_ingestion_job_scope()
returns trigger
language plpgsql
security definer
set search_path = grey, public
as $$
begin
  if not exists (
    select 1
      from grey.sources s
      join grey.knowledge_bases k on k.id = s.kb_id and k.project_id = s.project_id
     where s.id = new.source_id and s.project_id = new.project_id and s.kb_id = new.kb_id
  ) then
    raise exception 'INGESTION_JOB_SCOPE_MISMATCH' using errcode = 'check_violation',
      detail = 'The job''s source and knowledge base must belong to the job''s project.';
  end if;
  return new;
end;
$$;

revoke all on function grey.guard_source_scope() from public, anon, authenticated;
revoke all on function grey.guard_ingestion_job_scope() from public, anon, authenticated;

drop trigger if exists sources_scope_guard on grey.sources;
create trigger sources_scope_guard
before insert or update of project_id, kb_id, storage_path on grey.sources
for each row execute function grey.guard_source_scope();

drop trigger if exists ingestion_jobs_scope_guard on grey.ingestion_jobs;
create trigger ingestion_jobs_scope_guard
before insert or update of project_id, kb_id, source_id on grey.ingestion_jobs
for each row execute function grey.guard_ingestion_job_scope();

-- ---------------------------------------------------------------------------
-- Staged chunks. A job inserts its chunks as 'staged' after each embed batch
-- (a retried job resumes from what is already staged), then swap_source_chunks
-- promotes them to 'live' in one transaction.
-- ---------------------------------------------------------------------------
alter table grey.chunks
  add column if not exists job_id uuid references grey.ingestion_jobs(id) on delete set null,
  add column if not exists state text not null default 'live',
  add column if not exists search_text text;

alter table grey.chunks drop constraint if exists chunks_state_check;
alter table grey.chunks add constraint chunks_state_check check (state in ('staged', 'live'));

create unique index if not exists chunks_job_staged_uniq
  on grey.chunks (job_id, ordinal) where state = 'staged';
create index if not exists chunks_source_live_idx
  on grey.chunks (source_id, ordinal) where deleted_at is null and state = 'live';
create index if not exists chunks_staged_job_idx
  on grey.chunks (job_id) where state = 'staged';

-- One usage row per (ingestion job, kind); the worker upserts into it.
create unique index if not exists usage_events_job_kind_uniq
  on grey.usage_events (ref_id, kind) where ref_type = 'ingestion_job';

-- ---------------------------------------------------------------------------
-- Wake the worker when a job becomes claimable. The payload is informational;
-- the worker treats any notification as "try to claim".
-- ---------------------------------------------------------------------------
create or replace function grey.notify_grey_jobs()
returns trigger
language plpgsql
set search_path = grey, public
as $$
begin
  perform pg_notify('grey_jobs', tg_argv[0] || ':' || new.id::text);
  return new;
end;
$$;

revoke all on function grey.notify_grey_jobs() from public, anon, authenticated;

drop trigger if exists ingestion_jobs_notify on grey.ingestion_jobs;
create trigger ingestion_jobs_notify
after insert or update of status on grey.ingestion_jobs
for each row when (new.status = 'queued' and new.deleted_at is null)
execute function grey.notify_grey_jobs('ingestion');

drop trigger if exists eval_runs_notify on grey.eval_runs;
create trigger eval_runs_notify
after insert or update of status on grey.eval_runs
for each row when (new.status = 'queued' and new.deleted_at is null)
execute function grey.notify_grey_jobs('eval');

-- ---------------------------------------------------------------------------
-- grey.ingestion_paused — soft cap reached with cap_behavior = 'pause_ingestion'.
-- ---------------------------------------------------------------------------
create or replace function grey.ingestion_paused(p_project uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = grey, public
as $$
declare
  v_cap numeric;
  v_behavior text;
begin
  select monthly_soft_cap, cap_behavior into v_cap, v_behavior
    from grey.project_settings
   where project_id = p_project and deleted_at is null;
  if v_cap is null or v_behavior is distinct from 'pause_ingestion' then
    return false;
  end if;
  return grey.project_month_spend(p_project) >= v_cap;
end;
$$;

-- ---------------------------------------------------------------------------
-- grey.claim_ingestion_job — leases one job. Claims are serialised with a
-- transaction-scoped advisory lock so the per-project limit and the
-- one-running-job-per-source rule (the graph stage relies on it) hold across
-- concurrent workers. Picks a job that is queued and due, or running with an
-- expired lease (a crashed worker), skipping paused projects, projects at
-- their running-job limit and sources that already have a live lease.
-- ---------------------------------------------------------------------------
create or replace function grey.claim_ingestion_job(
  p_worker text,
  p_lease_seconds integer default 120,
  p_max_per_project integer default 2
)
returns setof grey.ingestion_jobs
language plpgsql
security definer
set search_path = grey, public
as $$
declare
  v_id uuid;
  v_sources uuid[];
begin
  if coalesce(p_worker, '') = '' then
    raise exception 'WORKER_REQUIRED';
  end if;

  perform pg_advisory_xact_lock(hashtext('grey.claim_ingestion_job')::bigint);

  -- Expired leases that are out of attempts fail instead of looping forever.
  with exhausted as (
    update grey.ingestion_jobs j
       set status = 'failed',
           error = 'Processing stopped responding too many times.',
           finished_at = now(),
           locked_by = null,
           locked_until = null
     where j.status = 'running'
       and j.deleted_at is null
       and j.locked_until < now()
       and j.attempts >= j.max_attempts
    returning j.source_id
  )
  select array_agg(distinct e.source_id) into v_sources from exhausted e;

  -- Their sources were left 'processing' by the crashed worker: settle them
  -- (ready while live chunks remain, else failed) unless another job is still
  -- queued or running for the source.
  if v_sources is not null then
    update grey.sources s
       set status = case when exists (
             select 1 from grey.chunks c
              where c.source_id = s.id and c.project_id = s.project_id
                and c.state = 'live' and c.deleted_at is null
           ) then 'ready' else 'failed' end
     where s.id = any(v_sources)
       and s.deleted_at is null
       and s.status in ('queued', 'processing')
       and not exists (
         select 1 from grey.ingestion_jobs o
          where o.source_id = s.id and o.deleted_at is null and o.status in ('queued', 'running')
       );
  end if;

  -- Jobs whose source or knowledge base is gone (or no longer belongs to the
  -- job's project / KB) are cancelled, never claimed.
  update grey.ingestion_jobs j
     set status = 'cancelled',
         error = 'The source was deleted.',
         finished_at = now(),
         locked_by = null,
         locked_until = null
   where j.deleted_at is null
     and (j.status = 'queued' or (j.status = 'running' and j.locked_until < now()))
     and (
       not exists (
         select 1 from grey.sources s
          where s.id = j.source_id and s.project_id = j.project_id and s.kb_id = j.kb_id
            and s.deleted_at is null)
       or not exists (
         select 1 from grey.knowledge_bases k
          where k.id = j.kb_id and k.project_id = j.project_id and k.deleted_at is null)
     );

  with busy as (
    select r.project_id, count(*) as n
      from grey.ingestion_jobs r
     where r.status = 'running' and r.deleted_at is null and r.locked_until >= now()
     group by r.project_id
  ),
  ready_projects as (
    select distinct c.project_id
      from grey.ingestion_jobs c
     where c.deleted_at is null
       and ((c.status = 'queued' and c.run_after <= now())
            or (c.status = 'running' and c.locked_until < now()))
  ),
  open_projects as (
    select rp.project_id
      from ready_projects rp
      left join busy b on b.project_id = rp.project_id
     where coalesce(b.n, 0) < greatest(p_max_per_project, 1)
       and not grey.ingestion_paused(rp.project_id)
  )
  select j.id into v_id
    from grey.ingestion_jobs j
    join open_projects o on o.project_id = j.project_id
   where j.deleted_at is null
     and ((j.status = 'queued' and j.run_after <= now())
          or (j.status = 'running' and j.locked_until < now()))
     and exists (
       select 1 from grey.sources s
        where s.id = j.source_id and s.project_id = j.project_id and s.kb_id = j.kb_id
          and s.deleted_at is null)
     and not exists (
       select 1 from grey.ingestion_jobs r
        where r.source_id = j.source_id
          and r.id <> j.id
          and r.status = 'running'
          and r.deleted_at is null
          and r.locked_until >= now()
     )
   order by j.run_after, j.created_at
   limit 1
   for update of j skip locked;

  if v_id is null then
    return;
  end if;

  return query
  update grey.ingestion_jobs j
     set status = 'running',
         locked_by = p_worker,
         locked_until = now() + make_interval(secs => greatest(p_lease_seconds, 10)),
         attempts = j.attempts + 1,
         started_at = coalesce(j.started_at, now()),
         finished_at = null
   where j.id = v_id
  returning j.*;
end;
$$;

-- ---------------------------------------------------------------------------
-- grey.heartbeat_ingestion_job — extends the lease. Returns 'running' while the
-- caller still holds it; otherwise the job's status ('cancelled', ...), 'lost'
-- when another worker holds it, 'source_deleted', or 'missing'.
-- ---------------------------------------------------------------------------
create or replace function grey.heartbeat_ingestion_job(
  p_job uuid,
  p_worker text,
  p_lease_seconds integer default 120
)
returns text
language plpgsql
security definer
set search_path = grey, public
as $$
declare
  v_status text;
  v_locked_by text;
begin
  update grey.ingestion_jobs j
     set locked_until = now() + make_interval(secs => greatest(p_lease_seconds, 10))
   where j.id = p_job and j.locked_by = p_worker and j.status = 'running' and j.deleted_at is null
  returning j.status into v_status;

  if found then
    if not exists (
      select 1 from grey.ingestion_jobs j join grey.sources s on s.id = j.source_id and s.project_id = j.project_id
       where j.id = p_job and s.deleted_at is null
    ) then
      return 'source_deleted';
    end if;
    return 'running';
  end if;

  select j.status, j.locked_by into v_status, v_locked_by
    from grey.ingestion_jobs j where j.id = p_job and j.deleted_at is null;
  if v_status is null then
    return 'missing';
  end if;
  if v_status = 'running' then
    return 'lost';
  end if;
  return v_status;
end;
$$;

-- ---------------------------------------------------------------------------
-- grey.release_ingestion_job — every terminal/retry write, guarded on the
-- caller still holding the lease.
--   p_status 'queued'                          retry after p_delay_seconds; p_refund_attempt
--                                              un-counts the attempt (shutdown release)
--   p_status 'succeeded' | 'failed' | 'cancelled'  finished; actual_cost = sum of the job's usage
-- p_metadata is merged into ingestion_jobs.metadata. Returns false when the
-- lease was lost (or the job was cancelled meanwhile) and nothing was written.
-- ---------------------------------------------------------------------------
create or replace function grey.release_ingestion_job(
  p_job uuid,
  p_worker text,
  p_status text,
  p_error text default null,
  p_delay_seconds integer default 0,
  p_refund_attempt boolean default false,
  p_metadata jsonb default null
)
returns boolean
language plpgsql
security definer
set search_path = grey, public
as $$
begin
  if p_status not in ('queued', 'succeeded', 'failed', 'cancelled') then
    raise exception 'BAD_STATUS';
  end if;

  if p_status = 'queued' then
    update grey.ingestion_jobs j
       set status = 'queued',
           run_after = now() + make_interval(secs => greatest(coalesce(p_delay_seconds, 0), 0)),
           attempts = case when p_refund_attempt then greatest(j.attempts - 1, 0) else j.attempts end,
           locked_by = null,
           locked_until = null,
           error = p_error,
           metadata = j.metadata || coalesce(p_metadata, '{}'::jsonb)
     where j.id = p_job and j.locked_by = p_worker and j.status = 'running';
  else
    update grey.ingestion_jobs j
       set status = p_status,
           progress = case when p_status = 'succeeded' then 100 else j.progress end,
           finished_at = now(),
           locked_by = null,
           locked_until = null,
           error = p_error,
           metadata = j.metadata || coalesce(p_metadata, '{}'::jsonb),
           actual_cost = (
             select coalesce(sum(u.cost), 0)
               from grey.usage_events u
              where u.ref_type = 'ingestion_job' and u.ref_id = p_job and u.deleted_at is null
           )
     where j.id = p_job and j.locked_by = p_worker and j.status = 'running';
  end if;
  return found;
end;
$$;

-- ---------------------------------------------------------------------------
-- grey.swap_source_chunks — one transaction: hard-delete the source's live
-- chunks (derived data; their kg_mentions cascade) and promote the job's
-- staged chunks to live. Returns the number of live chunks. Everything is
-- scoped to the job's project + KB, and the source must belong to both.
-- ---------------------------------------------------------------------------
create or replace function grey.swap_source_chunks(p_job uuid, p_worker text)
returns integer
language plpgsql
security definer
set search_path = grey, public
as $$
declare
  v_source uuid;
  v_project uuid;
  v_kb uuid;
  v_count integer;
begin
  select j.source_id, j.project_id, j.kb_id into v_source, v_project, v_kb
    from grey.ingestion_jobs j
   where j.id = p_job and j.locked_by = p_worker and j.status = 'running' and j.deleted_at is null
   for update;
  if v_source is null then
    raise exception 'LEASE_LOST';
  end if;

  perform 1 from grey.sources s where s.id = v_source and s.project_id = v_project and s.kb_id = v_kb;
  if not found then
    raise exception 'SOURCE_SCOPE_MISMATCH' using errcode = 'check_violation';
  end if;

  delete from grey.chunks c
   where c.source_id = v_source and c.project_id = v_project and c.state = 'live';

  update grey.chunks c
     set state = 'live'
   where c.job_id = p_job and c.state = 'staged'
     and c.source_id = v_source and c.project_id = v_project and c.kb_id = v_kb;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Eval runs: same lease model (statuses queued | running | completed | failed).
-- ---------------------------------------------------------------------------
create or replace function grey.claim_eval_run(
  p_worker text,
  p_lease_seconds integer default 300,
  p_max_per_project integer default 1
)
returns setof grey.eval_runs
language plpgsql
security definer
set search_path = grey, public
as $$
declare
  v_id uuid;
begin
  if coalesce(p_worker, '') = '' then
    raise exception 'WORKER_REQUIRED';
  end if;

  perform pg_advisory_xact_lock(hashtext('grey.claim_eval_run')::bigint);

  update grey.eval_runs r
     set status = 'failed',
         metadata = r.metadata || jsonb_build_object('error', 'The evaluation stopped responding too many times.'),
         locked_by = null,
         locked_until = null
   where r.status = 'running'
     and r.deleted_at is null
     and r.locked_until < now()
     and r.attempts >= r.max_attempts;

  with busy as (
    select b.project_id, count(*) as n
      from grey.eval_runs b
     where b.status = 'running' and b.deleted_at is null and b.locked_until >= now()
     group by b.project_id
  )
  select r.id into v_id
    from grey.eval_runs r
    left join busy b on b.project_id = r.project_id
   where r.deleted_at is null
     and ((r.status = 'queued' and r.run_after <= now())
          or (r.status = 'running' and r.locked_until < now()))
     and coalesce(b.n, 0) < greatest(p_max_per_project, 1)
   order by r.run_after, r.created_at
   limit 1
   for update of r skip locked;

  if v_id is null then
    return;
  end if;

  return query
  update grey.eval_runs r
     set status = 'running',
         locked_by = p_worker,
         locked_until = now() + make_interval(secs => greatest(p_lease_seconds, 10)),
         attempts = r.attempts + 1
   where r.id = v_id
  returning r.*;
end;
$$;

create or replace function grey.heartbeat_eval_run(
  p_run uuid,
  p_worker text,
  p_lease_seconds integer default 300
)
returns text
language plpgsql
security definer
set search_path = grey, public
as $$
declare
  v_status text;
begin
  update grey.eval_runs r
     set locked_until = now() + make_interval(secs => greatest(p_lease_seconds, 10))
   where r.id = p_run and r.locked_by = p_worker and r.status = 'running' and r.deleted_at is null;
  if found then
    return 'running';
  end if;
  select r.status into v_status from grey.eval_runs r where r.id = p_run and r.deleted_at is null;
  if v_status is null then
    return 'missing';
  end if;
  if v_status = 'running' then
    return 'lost';
  end if;
  return v_status;
end;
$$;

-- Hands a still-running run back to the queue (worker shutdown or crash
-- recovery). No-op when the caller no longer holds the lease.
create or replace function grey.release_eval_run(
  p_run uuid,
  p_worker text,
  p_refund_attempt boolean default true
)
returns boolean
language plpgsql
security definer
set search_path = grey, public
as $$
begin
  update grey.eval_runs r
     set status = 'queued',
         attempts = case when p_refund_attempt then greatest(r.attempts - 1, 0) else r.attempts end,
         locked_by = null,
         locked_until = null
   where r.id = p_run and r.locked_by = p_worker and r.status = 'running';
  return found;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants: service role only.
-- ---------------------------------------------------------------------------
revoke all on function grey.ingestion_paused(uuid) from public, anon, authenticated;
revoke all on function grey.claim_ingestion_job(text, integer, integer) from public, anon, authenticated;
revoke all on function grey.heartbeat_ingestion_job(uuid, text, integer) from public, anon, authenticated;
revoke all on function grey.release_ingestion_job(uuid, text, text, text, integer, boolean, jsonb) from public, anon, authenticated;
revoke all on function grey.swap_source_chunks(uuid, text) from public, anon, authenticated;
revoke all on function grey.claim_eval_run(text, integer, integer) from public, anon, authenticated;
revoke all on function grey.heartbeat_eval_run(uuid, text, integer) from public, anon, authenticated;
revoke all on function grey.release_eval_run(uuid, text, boolean) from public, anon, authenticated;

grant execute on function grey.ingestion_paused(uuid) to service_role;
grant execute on function grey.claim_ingestion_job(text, integer, integer) to service_role;
grant execute on function grey.heartbeat_ingestion_job(uuid, text, integer) to service_role;
grant execute on function grey.release_ingestion_job(uuid, text, text, text, integer, boolean, jsonb) to service_role;
grant execute on function grey.swap_source_chunks(uuid, text) to service_role;
grant execute on function grey.claim_eval_run(text, integer, integer) to service_role;
grant execute on function grey.heartbeat_eval_run(uuid, text, integer) to service_role;
grant execute on function grey.release_eval_run(uuid, text, boolean) to service_role;

-- Chunks are derived data written only by the worker (service role). Members may read their
-- project's chunks but not write them, so a client can't plant rows pointing at another
-- project's source.
drop policy if exists chunks_member_all on grey.chunks;
drop policy if exists chunks_member_select on grey.chunks;
create policy chunks_member_select on grey.chunks for select to authenticated
  using (grey.can_access_project(project_id));

-- @down
drop policy if exists chunks_member_select on grey.chunks;
drop policy if exists chunks_member_all on grey.chunks;
create policy chunks_member_all on grey.chunks for all to authenticated
  using (grey.can_access_project(project_id)) with check (grey.can_access_project(project_id));
drop function if exists grey.release_eval_run(uuid, text, boolean);
drop function if exists grey.heartbeat_eval_run(uuid, text, integer);
drop function if exists grey.claim_eval_run(text, integer, integer);
drop function if exists grey.swap_source_chunks(uuid, text);
drop function if exists grey.release_ingestion_job(uuid, text, text, text, integer, boolean, jsonb);
drop function if exists grey.heartbeat_ingestion_job(uuid, text, integer);
drop function if exists grey.claim_ingestion_job(text, integer, integer);
drop function if exists grey.ingestion_paused(uuid);

drop trigger if exists eval_runs_notify on grey.eval_runs;
drop trigger if exists ingestion_jobs_notify on grey.ingestion_jobs;
drop function if exists grey.notify_grey_jobs();

drop trigger if exists ingestion_jobs_scope_guard on grey.ingestion_jobs;
drop trigger if exists sources_scope_guard on grey.sources;
drop function if exists grey.guard_ingestion_job_scope();
drop function if exists grey.guard_source_scope();

drop index if exists grey.usage_events_job_kind_uniq;

-- Staged rows would silently become readable once the state column is gone.
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'grey' and table_name = 'chunks' and column_name = 'state'
  ) then
    delete from grey.chunks where state = 'staged';
  end if;
end;
$$;
drop index if exists grey.chunks_staged_job_idx;
drop index if exists grey.chunks_source_live_idx;
drop index if exists grey.chunks_job_staged_uniq;
alter table grey.chunks drop constraint if exists chunks_state_check;
alter table grey.chunks
  drop column if exists search_text,
  drop column if exists state,
  drop column if exists job_id;

drop index if exists grey.eval_runs_running_idx;
drop index if exists grey.eval_runs_claim_idx;
alter table grey.eval_runs
  drop column if exists locked_until,
  drop column if exists locked_by,
  drop column if exists run_after,
  drop column if exists max_attempts,
  drop column if exists attempts;

drop index if exists grey.ingestion_jobs_running_idx;
drop index if exists grey.ingestion_jobs_claim_idx;
alter table grey.ingestion_jobs
  drop column if exists locked_until,
  drop column if exists locked_by,
  drop column if exists run_after,
  drop column if exists max_attempts,
  drop column if exists attempts;
