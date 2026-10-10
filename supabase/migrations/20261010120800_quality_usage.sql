-- Quality and usage
--
-- From spec section 2.6. Owns grey.eval_sets, grey.eval_cases, grey.eval_runs,
-- grey.eval_results, grey.request_logs, grey.usage_events, grey.project_settings.

-- @up
create table if not exists grey.eval_sets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null,
  description text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists eval_sets_project_idx on grey.eval_sets(project_id) where deleted_at is null;
drop trigger if exists eval_sets_touch on grey.eval_sets;
create trigger eval_sets_touch before update on grey.eval_sets for each row execute function grey.touch_updated_at();
alter table grey.eval_sets enable row level security;
drop policy if exists eval_sets_member_all on grey.eval_sets;
create policy eval_sets_member_all on grey.eval_sets for all to authenticated
  using (grey.can_access_project(project_id)) with check (grey.can_access_project(project_id));

create table if not exists grey.eval_cases (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  eval_set_id uuid not null references grey.eval_sets(id) on delete cascade,
  question text not null,
  expected_answer text,
  expected_source_ids uuid[] not null default '{}',
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists eval_cases_project_idx on grey.eval_cases(project_id) where deleted_at is null;
create index if not exists eval_cases_set_idx on grey.eval_cases(eval_set_id) where deleted_at is null;
drop trigger if exists eval_cases_touch on grey.eval_cases;
create trigger eval_cases_touch before update on grey.eval_cases for each row execute function grey.touch_updated_at();
alter table grey.eval_cases enable row level security;
drop policy if exists eval_cases_member_all on grey.eval_cases;
create policy eval_cases_member_all on grey.eval_cases for all to authenticated
  using (grey.can_access_project(project_id)) with check (grey.can_access_project(project_id));

create table if not exists grey.eval_runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  eval_set_id uuid not null references grey.eval_sets(id) on delete cascade,
  pipeline_id uuid references grey.pipelines(id) on delete set null,
  pipeline_version integer,
  status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'failed')),
  metrics jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists eval_runs_project_idx on grey.eval_runs(project_id) where deleted_at is null;
create index if not exists eval_runs_set_idx on grey.eval_runs(eval_set_id) where deleted_at is null;
drop trigger if exists eval_runs_touch on grey.eval_runs;
create trigger eval_runs_touch before update on grey.eval_runs for each row execute function grey.touch_updated_at();
alter table grey.eval_runs enable row level security;
drop policy if exists eval_runs_member_all on grey.eval_runs;
create policy eval_runs_member_all on grey.eval_runs for all to authenticated
  using (grey.can_access_project(project_id)) with check (grey.can_access_project(project_id));

create table if not exists grey.eval_results (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  eval_run_id uuid not null references grey.eval_runs(id) on delete cascade,
  eval_case_id uuid not null references grey.eval_cases(id) on delete cascade,
  answer text,
  scores jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists eval_results_project_idx on grey.eval_results(project_id) where deleted_at is null;
create index if not exists eval_results_run_idx on grey.eval_results(eval_run_id) where deleted_at is null;
drop trigger if exists eval_results_touch on grey.eval_results;
create trigger eval_results_touch before update on grey.eval_results for each row execute function grey.touch_updated_at();
alter table grey.eval_results enable row level security;
drop policy if exists eval_results_member_all on grey.eval_results;
create policy eval_results_member_all on grey.eval_results for all to authenticated
  using (grey.can_access_project(project_id)) with check (grey.can_access_project(project_id));

create table if not exists grey.request_logs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  pipeline_id uuid references grey.pipelines(id) on delete set null,
  api_key_id uuid references grey.api_keys(id) on delete set null,
  conversation_id uuid references grey.conversations(id) on delete set null,
  channel text,
  query text,
  status text not null default 'ok' check (status in ('ok', 'error', 'stub')),
  latency_ms integer,
  retrieved jsonb not null default '[]'::jsonb,
  tokens_in integer,
  tokens_out integer,
  cost numeric,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists request_logs_project_idx on grey.request_logs(project_id) where deleted_at is null;
create index if not exists request_logs_pipeline_idx on grey.request_logs(pipeline_id) where deleted_at is null;
drop trigger if exists request_logs_touch on grey.request_logs;
create trigger request_logs_touch before update on grey.request_logs for each row execute function grey.touch_updated_at();
alter table grey.request_logs enable row level security;
drop policy if exists request_logs_member_all on grey.request_logs;
create policy request_logs_member_all on grey.request_logs for all to authenticated
  using (grey.can_access_project(project_id)) with check (grey.can_access_project(project_id));

create table if not exists grey.usage_events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  kind text not null check (kind in ('page', 'media_minute', 'retrieval', 'llm_tokens', 'graph_tokens', 'contextual_tokens', 'storage_gb')),
  quantity numeric not null default 0,
  unit_cost numeric not null default 0,
  cost numeric not null default 0,
  ref_type text,
  ref_id uuid,
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists usage_events_project_idx on grey.usage_events(project_id) where deleted_at is null;
create index if not exists usage_events_occurred_idx on grey.usage_events(project_id, occurred_at) where deleted_at is null;
drop trigger if exists usage_events_touch on grey.usage_events;
create trigger usage_events_touch before update on grey.usage_events for each row execute function grey.touch_updated_at();
alter table grey.usage_events enable row level security;
drop policy if exists usage_events_member_all on grey.usage_events;
create policy usage_events_member_all on grey.usage_events for all to authenticated
  using (grey.can_access_project(project_id)) with check (grey.can_access_project(project_id));

create table if not exists grey.project_settings (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  default_preset_id uuid references grey.ingestion_presets(id),
  default_embedding_model text not null default 'cohere-embed-5-pro',
  monthly_soft_cap numeric,
  cap_behavior text not null default 'alert' check (cap_behavior in ('alert', 'retrieval_only', 'pause_ingestion')),
  alert_emails text[] not null default '{}',
  retention_days integer,
  log_queries boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index if not exists project_settings_project_uniq
  on grey.project_settings(project_id) where deleted_at is null;
drop trigger if exists project_settings_touch on grey.project_settings;
create trigger project_settings_touch before update on grey.project_settings for each row execute function grey.touch_updated_at();
alter table grey.project_settings enable row level security;
drop policy if exists project_settings_member_all on grey.project_settings;
create policy project_settings_member_all on grey.project_settings for all to authenticated
  using (grey.can_access_project(project_id)) with check (grey.can_access_project(project_id));

-- @down
drop table if exists grey.project_settings cascade;
drop table if exists grey.usage_events cascade;
drop table if exists grey.request_logs cascade;
drop table if exists grey.eval_results cascade;
drop table if exists grey.eval_runs cascade;
drop table if exists grey.eval_cases cascade;
drop table if exists grey.eval_sets cascade;
