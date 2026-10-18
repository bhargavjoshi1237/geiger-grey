-- Nomic embedding connections — the hosted Nomic Atlas API (nomic-embed-text-v1.5)
--
--   * grey.model_providers.provider accepts 'nomic'
--   * grey.embed_format_for_kind() / grey.provider_embed_format() know its 'nomic'
--     embed format, so a knowledge base can embed through a Nomic connection and
--     the same-format guard on knowledge_bases.embedding_provider_id covers it
--
-- Driver formats mirror lib/grey/provider_kinds.js (formats.embed per kind).

-- @up

alter table grey.model_providers drop constraint if exists model_providers_provider_check;
alter table grey.model_providers add constraint model_providers_provider_check
  check (provider in ('openai', 'anthropic', 'google', 'openrouter', 'openai_compatible', 'grey_hosted', 'cohere', 'voyage', 'assemblyai', 'nomic'));

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
    when 'nomic' then 'nomic'
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
    when 'nomic' then array['embed']
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

-- @down

-- Restoring the previous list fails while nomic connections exist — remove those
-- first; rolling back must not silently drop them.
alter table grey.model_providers drop constraint if exists model_providers_provider_check;
alter table grey.model_providers add constraint model_providers_provider_check
  check (provider in ('openai', 'anthropic', 'google', 'openrouter', 'openai_compatible', 'grey_hosted', 'cohere', 'voyage', 'assemblyai'));

-- Both functions as defined in 20261018120000_providers_byo.sql.
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
