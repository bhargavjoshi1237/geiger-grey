-- Pipelines and chat
--
-- From spec section 2.4. Owns grey.model_providers, grey.pipelines,
-- grey.pipeline_versions, grey.conversations, grey.messages, plus
-- grey.set_provider_secret() which stores a provider's API key in Supabase
-- Vault rather than in a plain column.

-- @up
create table if not exists grey.model_providers (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null,
  provider text not null check (provider in ('openai', 'anthropic', 'google', 'openrouter', 'openai_compatible', 'grey_hosted')),
  base_url text,
  secret_id uuid,
  key_last4 text,
  status text not null default 'unverified' check (status in ('unverified', 'ok', 'error')),
  last_checked_at timestamptz,
  models text[] not null default '{}',
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists model_providers_project_idx on grey.model_providers(project_id) where deleted_at is null;
drop trigger if exists model_providers_touch on grey.model_providers;
create trigger model_providers_touch before update on grey.model_providers for each row execute function grey.touch_updated_at();
alter table grey.model_providers enable row level security;
drop policy if exists model_providers_member_all on grey.model_providers;
create policy model_providers_member_all on grey.model_providers for all to authenticated
  using (grey.can_access_project(project_id)) with check (grey.can_access_project(project_id));

create table if not exists grey.pipelines (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null,
  description text,
  kb_ids uuid[] not null default '{}',
  provider_id uuid references grey.model_providers(id) on delete set null,
  model text,
  temperature numeric,
  max_tokens integer,
  system_prompt text,
  retrieval jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft', 'live')),
  current_version integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists pipelines_project_idx on grey.pipelines(project_id) where deleted_at is null;
drop trigger if exists pipelines_touch on grey.pipelines;
create trigger pipelines_touch before update on grey.pipelines for each row execute function grey.touch_updated_at();
alter table grey.pipelines enable row level security;
drop policy if exists pipelines_member_all on grey.pipelines;
create policy pipelines_member_all on grey.pipelines for all to authenticated
  using (grey.can_access_project(project_id)) with check (grey.can_access_project(project_id));

create table if not exists grey.pipeline_versions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  pipeline_id uuid not null references grey.pipelines(id) on delete cascade,
  version integer not null,
  config jsonb not null default '{}'::jsonb,
  note text,
  published_by uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists pipeline_versions_project_idx on grey.pipeline_versions(project_id) where deleted_at is null;
create unique index if not exists pipeline_versions_pipeline_version_uniq
  on grey.pipeline_versions(pipeline_id, version) where deleted_at is null;
drop trigger if exists pipeline_versions_touch on grey.pipeline_versions;
create trigger pipeline_versions_touch before update on grey.pipeline_versions for each row execute function grey.touch_updated_at();
alter table grey.pipeline_versions enable row level security;
drop policy if exists pipeline_versions_member_all on grey.pipeline_versions;
create policy pipeline_versions_member_all on grey.pipeline_versions for all to authenticated
  using (grey.can_access_project(project_id)) with check (grey.can_access_project(project_id));

create table if not exists grey.conversations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  pipeline_id uuid references grey.pipelines(id) on delete set null,
  user_id uuid,
  title text,
  channel text not null default 'playground' check (channel in ('playground', 'widget', 'api')),
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists conversations_project_idx on grey.conversations(project_id) where deleted_at is null;
create index if not exists conversations_pipeline_idx on grey.conversations(pipeline_id) where deleted_at is null;
drop trigger if exists conversations_touch on grey.conversations;
create trigger conversations_touch before update on grey.conversations for each row execute function grey.touch_updated_at();
alter table grey.conversations enable row level security;
drop policy if exists conversations_member_all on grey.conversations;
create policy conversations_member_all on grey.conversations for all to authenticated
  using (grey.can_access_project(project_id)) with check (grey.can_access_project(project_id));

create table if not exists grey.messages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  conversation_id uuid not null references grey.conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text,
  citations jsonb not null default '[]'::jsonb,
  feedback text check (feedback in ('up', 'down')),
  feedback_note text,
  unanswered boolean not null default false,
  latency_ms integer,
  tokens_in integer,
  tokens_out integer,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists messages_project_idx on grey.messages(project_id) where deleted_at is null;
create index if not exists messages_conversation_idx on grey.messages(conversation_id, created_at) where deleted_at is null;
drop trigger if exists messages_touch on grey.messages;
create trigger messages_touch before update on grey.messages for each row execute function grey.touch_updated_at();
alter table grey.messages enable row level security;
drop policy if exists messages_member_all on grey.messages;
create policy messages_member_all on grey.messages for all to authenticated
  using (grey.can_access_project(project_id)) with check (grey.can_access_project(project_id));

-- ---------------------------------------------------------------------------
-- grey.set_provider_secret — stores/rotates a provider's API key in Supabase
-- Vault rather than a plain column. SECURITY DEFINER so it can write
-- vault.secrets. EXECUTE is granted to service_role only (revoked below) and
-- the server route authorizes the caller before ever calling this — auth.uid()
-- is null under service_role, so a grey.can_access_project() check here would
-- always fail; the function only confirms the provider row exists.
-- ---------------------------------------------------------------------------
create or replace function grey.set_provider_secret(p_provider uuid, p_secret text)
returns grey.model_providers
language plpgsql
security definer
set search_path = public, grey, vault
as $$
declare
  v_secret_id uuid;
  v_name text;
  v_last4 text;
  r grey.model_providers;
begin
  select secret_id into v_secret_id
    from grey.model_providers
   where id = p_provider and deleted_at is null;

  if not found then
    raise exception 'PROVIDER_NOT_FOUND' using errcode = 'P0002';
  end if;

  v_name := 'grey_provider_' || p_provider::text;
  v_last4 := right(coalesce(p_secret, ''), 4);

  if v_secret_id is not null then
    perform vault.update_secret(v_secret_id, p_secret, v_name);
  else
    v_secret_id := vault.create_secret(p_secret, v_name);
  end if;

  update grey.model_providers
     set secret_id = v_secret_id,
         key_last4 = v_last4,
         status = 'unverified'
   where id = p_provider
  returning * into r;

  return r;
end;
$$;

revoke all on function grey.set_provider_secret(uuid, text) from public, anon, authenticated;
grant execute on function grey.set_provider_secret(uuid, text) to service_role;

-- @down
drop function if exists grey.set_provider_secret(uuid, text);
drop table if exists grey.messages cascade;
drop table if exists grey.conversations cascade;
drop table if exists grey.pipeline_versions cascade;
drop table if exists grey.pipelines cascade;
drop table if exists grey.model_providers cascade;
