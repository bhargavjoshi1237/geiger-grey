-- Customer-owned providers (BYO) — drivers, embedding connections, project models
--
-- From the backend spec §4 (providers and accounts), §11 (spend) and §15 item 1:
--   * grey.model_providers.provider accepts cohere, voyage and assemblyai
--   * grey.knowledge_bases.embedding_provider_id + embedding_dims, guarded by a
--     trigger: dims go null -> value once and then lock; the provider may change
--     only to a same-project connection whose embed driver format matches the
--     original's (key rotation / account move). The embedding_model lock from the
--     ingestion migration stays as it is.
--   * grey.project_settings processing_* (graph, enrichment, eval judge) and
--     transcription_* connection + model
--   * grey.get_provider_secret() — service-role read of a provider key from Vault
--   * grey.set_provider_secret() redefined: only rotates a Vault secret that is
--     this provider's own (named grey_provider_<id>)
--   * trigger model_providers_secret_guard — secret_id / key_last4 are never
--     client-writable (a member could otherwise copy another project's secret_id)
--   * grey.project_month_spend() — service-role month-to-date cost
--
-- Driver formats mirror lib/grey/provider_kinds.js (formats.embed per kind).

-- @up

-- The inline check from 20261010120600_pipelines.sql is named model_providers_provider_check.
alter table grey.model_providers drop constraint if exists model_providers_provider_check;
alter table grey.model_providers add constraint model_providers_provider_check
  check (provider in ('openai', 'anthropic', 'google', 'openrouter', 'openai_compatible', 'grey_hosted', 'cohere', 'voyage', 'assemblyai'));

-- Embed driver format of a provider kind (openai_compatible speaks the OpenAI format).
create or replace function grey.embed_format_for_kind(p_kind text)
returns text
language sql
immutable
as $$
  select case p_kind
    when 'openai' then 'openai'
    when 'openai_compatible' then 'openai'
    when 'google' then 'google'
    when 'cohere' then 'cohere'
    when 'voyage' then 'voyage'
    else null
  end;
$$;

-- Embed format of a connection, honouring metadata.capabilities: openai_compatible
-- embeds only when 'embed' was picked; a preset may narrow a fixed kind (e.g. a
-- Jina connection is cohere-format rerank only). Mirrors capabilitiesOf().
create or replace function grey.provider_embed_format(p_kind text, p_metadata jsonb)
returns text
language plpgsql
immutable
as $$
declare
  v_format text := grey.embed_format_for_kind(p_kind);
  v_caps jsonb := case when jsonb_typeof(p_metadata -> 'capabilities') = 'array' then p_metadata -> 'capabilities' end;
  v_kind_caps text[] := case p_kind
    when 'openai' then array['chat', 'embed', 'transcribe']
    when 'google' then array['chat', 'embed']
    when 'cohere' then array['embed', 'rerank']
    when 'voyage' then array['embed', 'rerank']
  end;
begin
  if v_format is null then
    return null;
  end if;
  if p_kind = 'openai_compatible' then
    return case when coalesce(v_caps ? 'embed', false) then v_format end;
  end if;
  if v_caps is not null and v_caps ?| v_kind_caps and not (v_caps ? 'embed') then
    return null;
  end if;
  return v_format;
end;
$$;

alter table grey.knowledge_bases
  add column if not exists embedding_provider_id uuid references grey.model_providers(id) on delete set null;
alter table grey.knowledge_bases
  add column if not exists embedding_dims smallint check (embedding_dims between 64 and 4000);
create index if not exists knowledge_bases_embedding_provider_idx
  on grey.knowledge_bases(embedding_provider_id) where embedding_provider_id is not null;

-- Vectors already stored were produced with these settings, so: embedding_dims is
-- set once; the embedding connection must live in the KB's project, be able to
-- embed, and — once set — only move to a connection with the same embed format.
-- The old connection is looked up even when soft-deleted, so a deleted provider
-- can still only be replaced by a same-format one. Once dims are locked the
-- connection can't be cleared directly (that would skip the format check on the
-- next pick); only the FK's on-delete-set-null cascade (trigger depth > 1) may.
create or replace function grey.guard_kb_embedding()
returns trigger
language plpgsql
set search_path = public, grey
as $$
declare
  v_new grey.model_providers;
  v_new_format text;
  v_old_kind text;
begin
  if tg_op = 'UPDATE' and old.embedding_dims is not null
     and new.embedding_dims is distinct from old.embedding_dims then
    raise exception 'EMBEDDING_DIMS_LOCKED' using errcode = 'check_violation';
  end if;

  if tg_op = 'UPDATE' and old.embedding_dims is not null
     and old.embedding_provider_id is not null and new.embedding_provider_id is null
     and pg_trigger_depth() = 1 then
    raise exception 'EMBEDDING_PROVIDER_REQUIRED' using errcode = 'check_violation';
  end if;

  if new.embedding_provider_id is not null
     and (tg_op = 'INSERT' or new.embedding_provider_id is distinct from old.embedding_provider_id) then
    select * into v_new
      from grey.model_providers
     where id = new.embedding_provider_id
       and project_id = new.project_id
       and deleted_at is null;
    if not found then
      raise exception 'EMBEDDING_PROVIDER_NOT_FOUND' using errcode = 'foreign_key_violation';
    end if;

    v_new_format := grey.provider_embed_format(v_new.provider, v_new.metadata);
    if v_new_format is null then
      raise exception 'EMBEDDING_PROVIDER_CANNOT_EMBED' using errcode = 'check_violation';
    end if;

    if tg_op = 'UPDATE' and old.embedding_provider_id is not null then
      select provider into v_old_kind from grey.model_providers where id = old.embedding_provider_id;
      if v_old_kind is not null and grey.embed_format_for_kind(v_old_kind) is distinct from v_new_format then
        raise exception 'EMBEDDING_PROVIDER_FORMAT_MISMATCH' using errcode = 'check_violation';
      end if;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists knowledge_bases_embedding_guard on grey.knowledge_bases;
create trigger knowledge_bases_embedding_guard before insert or update on grey.knowledge_bases
for each row execute function grey.guard_kb_embedding();

-- Project-wide models (spec §4.3). Null transcription connection = use the
-- project's only transcribe-capable connection when there is exactly one.
alter table grey.project_settings
  add column if not exists processing_provider_id uuid references grey.model_providers(id) on delete set null;
alter table grey.project_settings add column if not exists processing_model text;
alter table grey.project_settings
  add column if not exists transcription_provider_id uuid references grey.model_providers(id) on delete set null;
alter table grey.project_settings add column if not exists transcription_model text;

-- ---------------------------------------------------------------------------
-- secret_id / key_last4 are written only by grey.set_provider_secret (SECURITY
-- DEFINER, so current_user is its owner) and the service role. Client writes of
-- these columns are ignored rather than rejected, so UI saves that echo the row
-- back keep working. Without this a member could copy another project's
-- secret_id onto their own provider row.
-- ---------------------------------------------------------------------------
create or replace function grey.guard_provider_secret_columns()
returns trigger
language plpgsql
set search_path = grey, public
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      new.secret_id := null;
      new.key_last4 := null;
    else
      new.secret_id := old.secret_id;
      new.key_last4 := old.key_last4;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function grey.guard_provider_secret_columns() from public, anon, authenticated;

drop trigger if exists model_providers_secret_guard on grey.model_providers;
create trigger model_providers_secret_guard before insert or update on grey.model_providers
for each row execute function grey.guard_provider_secret_columns();

-- ---------------------------------------------------------------------------
-- grey.set_provider_secret — redefines 20261010120600_pipelines.sql's version:
-- the stored secret_id is rotated in place only when that Vault secret is this
-- provider's own (named grey_provider_<id>); otherwise this provider's named
-- secret is reused, or a fresh one created. Never update_secret()s a secret
-- that belongs to another provider.
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
   where id = p_provider and deleted_at is null
   for update;

  if not found then
    raise exception 'PROVIDER_NOT_FOUND' using errcode = 'P0002';
  end if;

  v_name := 'grey_provider_' || p_provider::text;
  v_last4 := right(coalesce(p_secret, ''), 4);

  if v_secret_id is not null
     and not exists (select 1 from vault.decrypted_secrets s where s.id = v_secret_id and s.name = v_name) then
    v_secret_id := null;
  end if;
  if v_secret_id is null then
    select s.id into v_secret_id from vault.decrypted_secrets s where s.name = v_name;
  end if;

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

-- ---------------------------------------------------------------------------
-- grey.get_provider_secret — the read side of set_provider_secret. SECURITY
-- DEFINER so it can read vault.decrypted_secrets; EXECUTE is service_role only.
-- Scoped by project so an engine call can never read another project's key,
-- and the secret must carry this provider's own name, so a secret_id copied
-- from another provider row resolves to nothing.
-- ---------------------------------------------------------------------------
create or replace function grey.get_provider_secret(p_provider uuid, p_project uuid)
returns text
language plpgsql
stable
security definer
set search_path = public, grey, vault
as $$
declare
  v text;
begin
  select ds.decrypted_secret into v
    from grey.model_providers mp
    join vault.decrypted_secrets ds
      on ds.id = mp.secret_id and ds.name = 'grey_provider_' || mp.id::text
   where mp.id = p_provider and mp.project_id = p_project and mp.deleted_at is null;
  return v;
end;
$$;

revoke all on function grey.get_provider_secret(uuid, uuid) from public, anon, authenticated;
grant execute on function grey.get_provider_secret(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- grey.project_month_spend — month-to-date (UTC) cost from usage_events, for the
-- soft-cap checks (cap_behavior). Service role only.
-- ---------------------------------------------------------------------------
create or replace function grey.project_month_spend(p_project uuid)
returns numeric
language sql
stable
set search_path = public, grey
as $$
  select coalesce(sum(cost), 0)::numeric
    from grey.usage_events
   where project_id = p_project
     and deleted_at is null
     and occurred_at >= (date_trunc('month', now() at time zone 'utc') at time zone 'utc');
$$;

revoke all on function grey.project_month_spend(uuid) from public, anon, authenticated;
grant execute on function grey.project_month_spend(uuid) to service_role;

-- @down
drop function if exists grey.project_month_spend(uuid);
drop function if exists grey.get_provider_secret(uuid, uuid);

-- set_provider_secret as defined in 20261010120600_pipelines.sql.
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
   where id = p_provider and deleted_at is null
   for update;

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

drop trigger if exists model_providers_secret_guard on grey.model_providers;
drop function if exists grey.guard_provider_secret_columns();

alter table grey.project_settings
  drop column if exists transcription_model,
  drop column if exists transcription_provider_id,
  drop column if exists processing_model,
  drop column if exists processing_provider_id;

drop trigger if exists knowledge_bases_embedding_guard on grey.knowledge_bases;
drop function if exists grey.guard_kb_embedding();
drop index if exists grey.knowledge_bases_embedding_provider_idx;
alter table grey.knowledge_bases
  drop column if exists embedding_dims,
  drop column if exists embedding_provider_id;
drop function if exists grey.provider_embed_format(text, jsonb);
drop function if exists grey.embed_format_for_kind(text);

-- Restoring the original list fails while cohere/voyage/assemblyai connections
-- exist — remove those first; rolling back must not silently drop them.
alter table grey.model_providers drop constraint if exists model_providers_provider_check;
alter table grey.model_providers add constraint model_providers_provider_check
  check (provider in ('openai', 'anthropic', 'google', 'openrouter', 'openai_compatible', 'grey_hosted'));
