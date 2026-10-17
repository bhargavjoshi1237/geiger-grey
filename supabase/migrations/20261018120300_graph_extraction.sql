-- Knowledge graph — extraction, entity resolution, graph retrieval, Forms push
--
-- From backend spec §10 and §15 item 4. Builds on 20261010120500_graph.sql
-- (kg_types / kg_entities / kg_relations / kg_mentions) and on
-- 20261018120100_worker_queue.sql (chunks.state 'staged' | 'live').
--
-- Owns:
--   extensions.unaccent (extension, installed in the `extensions` schema)
--   grey.normalize_entity_name(text) / grey.normalize_entity_names(text[])
--       immutable; same rules as normalizeName() in lib/grey/duplicates.js
--       (lowercase, strip diacritics + punctuation, collapse spaces, drop a
--       trailing inc/ltd/llc/corp/co). Letters outside a-z are kept, so names
--       in other scripts still normalise to something matchable.
--   kg_entities.name_norm, aliases_norm (generated) + trigram / alias / email
--       indexes
--   kg_relations.source_app ('grey' | 'forms' | 'manual', default 'manual':
--       every pre-existing relation was created by hand) + edge index
--   kg_mentions partial unique indexes (entity, chunk) / (relation, chunk)
--   grey.kg_form_links — Forms submission entity key -> entity id
--   grey.ensure_default_ontology(project)       authenticated + service_role
--   grey.kg_upsert_extracted(project, source, payload)            service_role
--   grey.kg_clear_source_mentions(project, source)                service_role
--   grey.kg_sweep_orphans(project, source)                        service_role
--   grey.kg_match_query_entities(project, kb_ids, query, limit)   service_role
--   grey.kg_expand(project, kb_ids, seed, exclude, hops, ents, chunks)
--                                                                 service_role
--   grey.kg_merge_entities(project, canonical, duplicates)   authenticated
--       (grey.graph.edit) + service_role
--   grey.upsert_form_entity(project, form, submission, entities, relations)
--                                                                 service_role
--   helpers grey.kg_type_id, kg_merge_aliases, kg_live_entity,
--       kg_entity_grounded, kg_relation_grounded                  service_role
--   trigger sources_kg_soft_delete: a source whose deleted_at becomes non-null
--       loses its mentions, then the project's orphans are swept.
--
-- Every write to the graph from extraction, sweeping and Forms runs under
-- pg_advisory_xact_lock(hashtext('grey.kg:' || project_id)), so concurrent
-- workers / Forms pushes resolve entities one batch at a time per project.
--
-- Retrieval boundary (spec §10.4, §14): graph matching and expansion only ever
-- touch entities with a live mention in a live chunk of the caller's knowledge
-- bases, only follow extracted (grey) relations that themselves have such a
-- mention, and never traverse Forms relations — Forms-only (CRM) entities and
-- facts, and facts extracted from other knowledge bases, cannot surface
-- through a public widget.
--
-- pg_trgm lives in `public` on the shared project (verified); it is created
-- there if missing. Functions that use trigram operators pin
-- search_path = grey, public.

-- @up
create extension if not exists unaccent with schema extensions;
create extension if not exists pg_trgm with schema public;

-- ---------------------------------------------------------------------------
-- Name normalisation. IMMUTABLE wrappers around unaccent (itself STABLE because
-- its dictionary could change) — the standard pattern for using it in
-- generated columns and indexes. Schema-qualified, so no search_path needed
-- and the body is never inlined into callers.
-- ---------------------------------------------------------------------------
create or replace function grey.normalize_entity_name(p_name text)
returns text
language sql
immutable
parallel safe
as $$
  select regexp_replace(
    btrim(regexp_replace(
      lower(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(p_name, ''))),
      '[^[:alnum:]]+', ' ', 'g')),
    '( (inc|ltd|llc|corp|co))+$', '')
$$;

create or replace function grey.normalize_entity_names(p_names text[])
returns text[]
language sql
immutable
parallel safe
as $$
  select coalesce(array_agg(distinct n order by n), '{}'::text[])
    from (select grey.normalize_entity_name(a) as n from unnest(coalesce(p_names, '{}'::text[])) as a) s
   where n <> ''
$$;

-- Executed by inserts/updates of kg_entities (generated columns), so the
-- roles that write that table need EXECUTE.
revoke all on function grey.normalize_entity_name(text) from public, anon;
revoke all on function grey.normalize_entity_names(text[]) from public, anon;
grant execute on function grey.normalize_entity_name(text) to authenticated, service_role;
grant execute on function grey.normalize_entity_names(text[]) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- kg_entities: normalised name + aliases.
-- ---------------------------------------------------------------------------
alter table grey.kg_entities
  add column if not exists name_norm text generated always as (grey.normalize_entity_name(name)) stored;
alter table grey.kg_entities
  add column if not exists aliases_norm text[] generated always as (grey.normalize_entity_names(aliases)) stored;

create index if not exists kg_entities_name_trgm_idx
  on grey.kg_entities using gin (name_norm public.gin_trgm_ops)
  where deleted_at is null and merged_into is null;
create index if not exists kg_entities_name_norm_idx
  on grey.kg_entities (project_id, name_norm) where deleted_at is null;
create index if not exists kg_entities_aliases_norm_idx
  on grey.kg_entities using gin (aliases_norm) where deleted_at is null;
create index if not exists kg_entities_email_idx
  on grey.kg_entities (project_id, lower(properties ->> 'email')) where deleted_at is null;

-- ---------------------------------------------------------------------------
-- kg_relations: provenance + edge lookup.
-- ---------------------------------------------------------------------------
alter table grey.kg_relations
  add column if not exists source_app text not null default 'manual'
  check (source_app in ('grey', 'forms', 'manual'));

create index if not exists kg_relations_edge_idx
  on grey.kg_relations (project_id, source_entity_id, target_entity_id, type_id) where deleted_at is null;

-- ---------------------------------------------------------------------------
-- kg_mentions: one live mention per (entity, chunk) and (relation, chunk), so
-- re-running extraction on the same chunks is idempotent.
-- ---------------------------------------------------------------------------
create unique index if not exists kg_mentions_entity_chunk_uniq
  on grey.kg_mentions (entity_id, chunk_id) where deleted_at is null;
create unique index if not exists kg_mentions_relation_chunk_uniq
  on grey.kg_mentions (relation_id, chunk_id) where deleted_at is null;

-- ---------------------------------------------------------------------------
-- kg_form_links — which entity a Forms submission's entity key resolved to.
-- Written only by upsert_form_entity (service role); members may read.
-- ---------------------------------------------------------------------------
create table if not exists grey.kg_form_links (
  project_id uuid not null references public.projects(id) on delete cascade,
  submission_id uuid not null,
  entity_key text not null,
  entity_id uuid not null references grey.kg_entities(id) on delete cascade,
  form_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (submission_id, entity_key)
);
create index if not exists kg_form_links_project_idx on grey.kg_form_links (project_id);
create index if not exists kg_form_links_entity_idx on grey.kg_form_links (entity_id);
drop trigger if exists kg_form_links_touch on grey.kg_form_links;
create trigger kg_form_links_touch before update on grey.kg_form_links
for each row execute function grey.touch_updated_at();
alter table grey.kg_form_links enable row level security;
revoke insert, update, delete on grey.kg_form_links from anon, authenticated;
drop policy if exists kg_form_links_member_select on grey.kg_form_links;
create policy kg_form_links_member_select on grey.kg_form_links for select to authenticated
  using (grey.can_access_project(project_id));

-- ---------------------------------------------------------------------------
-- ensure_default_ontology — seeds the default entity/relation types once per
-- project (no-op while any live default type exists) and returns the
-- project's live types. Replaces the client-side seeding race between the
-- graph screens and the worker. created_at is staggered by a millisecond per
-- row so the existing `order by created_at desc` listing shows the defaults
-- in their canonical order.
-- ---------------------------------------------------------------------------
create or replace function grey.ensure_default_ontology(p_project uuid)
returns setof grey.kg_types
language plpgsql
security definer
set search_path = grey, public
as $$
begin
  if p_project is null then
    return;
  end if;
  if coalesce(auth.role(), '') <> 'service_role' and not grey.can_access_project(p_project) then
    raise exception 'Project access required' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext('grey.kg_ontology:' || p_project::text));

  if not exists (
    select 1 from grey.kg_types
     where project_id = p_project and is_default and deleted_at is null
  ) then
    insert into grey.kg_types (project_id, kind, name, color, is_default, created_at, updated_at)
    select p_project, d.kind, d.name, d.color, true,
           now() - d.ord * interval '1 millisecond', now()
      from (values
        ('entity', 'Person', 'chart-1', 0),
        ('entity', 'Organization', 'chart-2', 1),
        ('entity', 'Product', 'chart-3', 2),
        ('entity', 'Location', 'chart-4', 3),
        ('entity', 'Event', 'chart-5', 4),
        ('entity', 'Concept', 'chart-1', 5),
        ('entity', 'Document', 'chart-2', 6),
        ('entity', 'Other', 'chart-3', 7),
        ('relation', 'works_at', 'chart-1', 8),
        ('relation', 'part_of', 'chart-2', 9),
        ('relation', 'mentions', 'chart-3', 10),
        ('relation', 'related_to', 'chart-4', 11),
        ('relation', 'located_in', 'chart-5', 12),
        ('relation', 'created', 'chart-1', 13)
      ) as d(kind, name, color, ord)
     where not exists (
       select 1 from grey.kg_types t
        where t.project_id = p_project and t.kind = d.kind
          and lower(t.name) = lower(d.name) and t.deleted_at is null
     );
  end if;

  return query
    select t.* from grey.kg_types t
     where t.project_id = p_project and t.deleted_at is null
     order by t.created_at desc, t.id;
end;
$$;

revoke all on function grey.ensure_default_ontology(uuid) from public, anon;
grant execute on function grey.ensure_default_ontology(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Helpers (service role only).
-- ---------------------------------------------------------------------------

-- Live type id by name (case-insensitive; spaces/hyphens ≡ underscores), else
-- the fallback type's id, else null.
create or replace function grey.kg_type_id(p_project uuid, p_kind text, p_name text, p_fallback text default null)
returns uuid
language sql
stable
as $$
  select coalesce(
    (select t.id from grey.kg_types t
      where t.project_id = p_project and t.kind = p_kind and t.deleted_at is null
        and regexp_replace(lower(btrim(t.name)), '[\s-]+', '_', 'g')
          = regexp_replace(lower(btrim(coalesce(p_name, ''))), '[\s-]+', '_', 'g')
      order by t.is_default desc, t.created_at
      limit 1),
    (select t.id from grey.kg_types t
      where t.project_id = p_project and t.kind = p_kind and t.deleted_at is null
        and lower(t.name) = lower(p_fallback)
      order by t.is_default desc, t.created_at
      limit 1)
  )
$$;

-- Aliases for an entity called p_name: existing then new, trimmed, de-duplicated
-- by normalised form, never equal to the name itself, at most 50.
create or replace function grey.kg_merge_aliases(p_name text, p_existing text[], p_new text[])
returns text[]
language plpgsql
immutable
as $$
declare
  v_out text[] := '{}';
  v_seen text[] := array[grey.normalize_entity_name(p_name)];
  v_alias text;
  v_norm text;
begin
  foreach v_alias in array (coalesce(p_existing, '{}'::text[]) || coalesce(p_new, '{}'::text[])) loop
    v_alias := btrim(regexp_replace(coalesce(v_alias, ''), '\s+', ' ', 'g'));
    continue when v_alias = '' or length(v_alias) > 200;
    v_norm := grey.normalize_entity_name(v_alias);
    continue when v_norm = '' or v_norm = any(v_seen);
    exit when cardinality(v_out) >= 50;
    v_out := v_out || v_alias;
    v_seen := v_seen || v_norm;
  end loop;
  return v_out;
end;
$$;

-- Follows merged_into (≤ 5 hops) to the live survivor in the same project;
-- null when the chain ends on a deleted (not merged) entity.
create or replace function grey.kg_live_entity(p_project uuid, p_entity uuid)
returns uuid
language plpgsql
stable
as $$
declare
  v_id uuid := p_entity;
  v_row record;
begin
  for i in 0..5 loop
    select e.id, e.merged_into, e.deleted_at into v_row
      from grey.kg_entities e
     where e.id = v_id and e.project_id = p_project;
    if not found then
      return null;
    end if;
    if v_row.merged_into is null then
      return case when v_row.deleted_at is null then v_row.id end;
    end if;
    v_id := v_row.merged_into;
  end loop;
  return null;
end;
$$;

-- True when the entity has a live mention in a live chunk of one of the given
-- knowledge bases (callers pass KB ids already validated against the
-- project). Plain SQL without SET so the planner can inline it.
create or replace function grey.kg_entity_grounded(p_entity uuid, p_project uuid, p_kb_ids uuid[])
returns boolean
language sql
stable
as $$
  select exists (
    select 1
      from grey.kg_mentions m
      join grey.chunks c on c.id = m.chunk_id
      join grey.sources s on s.id = c.source_id
     where m.entity_id = p_entity and m.deleted_at is null
       and c.project_id = p_project and c.kb_id = any(p_kb_ids)
       and c.deleted_at is null and c.state = 'live'
       and s.deleted_at is null
  )
$$;

-- Same for a relation: an extracted relation is only as visible as the chunks
-- it was extracted from.
create or replace function grey.kg_relation_grounded(p_relation uuid, p_project uuid, p_kb_ids uuid[])
returns boolean
language sql
stable
as $$
  select exists (
    select 1
      from grey.kg_mentions m
      join grey.chunks c on c.id = m.chunk_id
      join grey.sources s on s.id = c.source_id
     where m.relation_id = p_relation and m.deleted_at is null
       and c.project_id = p_project and c.kb_id = any(p_kb_ids)
       and c.deleted_at is null and c.state = 'live'
       and s.deleted_at is null
  )
$$;

-- ---------------------------------------------------------------------------
-- kg_upsert_extracted — stores one extraction batch (spec §10.2).
--
-- p_payload: {
--   job_id?: uuid,
--   entities: [{ ref, name, type, aliases[], description, confidence,
--                mentions: [{ chunk_id, page, start_ms }] }],
--   relations: [{ source /* ref */, target /* ref */, type, confidence,
--                 mention: { chunk_id, page, start_ms } | null }]
-- }
-- Returns { "<ref>": "<entity uuid>", … } for every stored entity.
--
-- Resolution (live, not merged): exact name_norm or alias overlap (same type
-- preferred; cross-type only when one side is Other) → same-type trigram
-- similarity ≥ 0.6 for names ≥ 4 chars → a merged-away entity with that name,
-- followed to its survivor. On a match, forms/manual entities only gain
-- aliases; grey entities also fill an empty description, keep the max
-- confidence and upgrade from Other. No match → new 'grey' entity.
-- Relations dedupe on live (source, target, type) with valid_to null;
-- extraction never invalidates relations. Mentions always point at live
-- chunks of p_source (page/start_ms copied from the chunk row).
-- ---------------------------------------------------------------------------
create or replace function grey.kg_upsert_extracted(p_project uuid, p_source uuid, p_payload jsonb)
returns jsonb
language plpgsql
set search_path = grey, public
as $$
declare
  c_uuid constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_other uuid;
  v_meta jsonb;
  v_map jsonb := '{}'::jsonb;
  v_ent jsonb;
  v_rel jsonb;
  v_ref text;
  v_name text;
  v_norm text;
  v_aliases text[];
  v_alias_norms text[];
  v_type uuid;
  v_desc text;
  v_conf numeric;
  v_id uuid;
  v_candidate uuid;
  v_row grey.kg_entities%rowtype;
  v_new_aliases text[];
  v_new_desc text;
  v_new_conf numeric;
  v_new_type uuid;
  v_src uuid;
  v_tgt uuid;
  v_rtype uuid;
  v_rid uuid;
  v_rapp text;
  v_rconf numeric;
  v_chunk text;
begin
  if p_project is null or p_source is null then
    raise exception 'KG_BAD_ARGUMENTS';
  end if;
  perform 1 from grey.sources s where s.id = p_source and s.project_id = p_project;
  if not found then
    raise exception 'KG_SOURCE_NOT_FOUND';
  end if;

  perform pg_advisory_xact_lock(hashtext('grey.kg:' || p_project::text));
  perform set_config('pg_trgm.similarity_threshold', '0.6', true);

  v_other := grey.kg_type_id(p_project, 'entity', 'Other');
  v_meta := jsonb_build_object('origin', 'extraction')
    || case when coalesce(p_payload ->> 'job_id', '') ~ c_uuid
            then jsonb_build_object('jobId', p_payload ->> 'job_id') else '{}'::jsonb end;

  for v_ent in
    select e.v from jsonb_array_elements(
      case when jsonb_typeof(p_payload -> 'entities') = 'array' then p_payload -> 'entities' else '[]'::jsonb end
    ) as e(v)
    limit 100
  loop
    continue when jsonb_typeof(v_ent) <> 'object';
    v_ref := nullif(btrim(v_ent ->> 'ref'), '');
    v_name := left(nullif(btrim(regexp_replace(coalesce(v_ent ->> 'name', ''), '\s+', ' ', 'g')), ''), 200);
    continue when v_ref is null or v_name is null;
    v_norm := grey.normalize_entity_name(v_name);
    continue when v_norm = '';

    v_aliases := array(
      select a.v #>> '{}' from jsonb_array_elements(
        case when jsonb_typeof(v_ent -> 'aliases') = 'array' then v_ent -> 'aliases' else '[]'::jsonb end
      ) as a(v)
      where jsonb_typeof(a.v) = 'string'
      limit 20
    );
    v_alias_norms := array_remove(grey.normalize_entity_names(v_aliases), v_norm);
    v_type := coalesce(grey.kg_type_id(p_project, 'entity', v_ent ->> 'type', 'Other'), v_other);
    v_desc := left(nullif(btrim(v_ent ->> 'description'), ''), 1000);
    v_conf := case when jsonb_typeof(v_ent -> 'confidence') = 'number'
                   then least(greatest((v_ent ->> 'confidence')::numeric, 0), 1) end;
    v_id := null;

    -- 1. Exact name or alias overlap.
    select e.id into v_id
      from grey.kg_entities e
     where e.project_id = p_project and e.deleted_at is null and e.merged_into is null
       and (e.name_norm = v_norm
            or e.aliases_norm @> array[v_norm]
            or e.name_norm = any(v_alias_norms)
            or e.aliases_norm && v_alias_norms)
       and (e.type_id is not distinct from v_type
            or v_type is not distinct from v_other
            or e.type_id is null
            or e.type_id = v_other)
     order by (e.type_id is not distinct from v_type) desc,
              (e.name_norm = v_norm) desc,
              (e.source_app <> 'grey') desc,
              e.created_at
     limit 1;

    -- 2. Same-type fuzzy match on longer names (uses the trigram index).
    if v_id is null and length(v_norm) >= 4 then
      select e.id into v_id
        from grey.kg_entities e
       where e.project_id = p_project and e.deleted_at is null and e.merged_into is null
         and e.type_id is not distinct from v_type
         and length(e.name_norm) >= 4
         and e.name_norm % v_norm
         and similarity(e.name_norm, v_norm) >= 0.6
       order by similarity(e.name_norm, v_norm) desc, e.created_at
       limit 1;
    end if;

    -- 3. A merged-away duplicate with this name: follow it to the survivor.
    if v_id is null then
      for v_candidate in
        select e.id from grey.kg_entities e
         where e.project_id = p_project and e.merged_into is not null
           and (e.name_norm = v_norm or e.aliases_norm @> array[v_norm])
           and (e.type_id is not distinct from v_type
                or v_type is not distinct from v_other
                or e.type_id is null
                or e.type_id = v_other)
         order by e.updated_at desc
         limit 5
      loop
        v_id := grey.kg_live_entity(p_project, v_candidate);
        exit when v_id is not null;
      end loop;
    end if;

    if v_id is null then
      insert into grey.kg_entities (project_id, type_id, name, aliases, description, source_app, confidence, metadata)
      values (p_project, v_type, v_name, grey.kg_merge_aliases(v_name, '{}', v_aliases), v_desc, 'grey', v_conf,
              v_meta || jsonb_build_object('firstSourceId', p_source))
      returning id into v_id;
    else
      select * into v_row from grey.kg_entities where id = v_id for update;
      v_new_aliases := grey.kg_merge_aliases(v_row.name, v_row.aliases, array[v_name] || v_aliases);
      if v_row.source_app = 'grey' then
        v_new_desc := coalesce(nullif(btrim(v_row.description), ''), v_desc);
        v_new_conf := greatest(v_row.confidence, v_conf);
        v_new_type := case
          when (v_row.type_id is null or v_row.type_id is not distinct from v_other)
               and v_type is not null and v_type is distinct from v_other then v_type
          else v_row.type_id end;
      else
        v_new_desc := v_row.description;
        v_new_conf := v_row.confidence;
        v_new_type := v_row.type_id;
      end if;
      if (v_new_aliases, v_new_desc, v_new_conf, v_new_type)
         is distinct from (v_row.aliases, v_row.description, v_row.confidence, v_row.type_id) then
        update grey.kg_entities
           set aliases = v_new_aliases, description = v_new_desc,
               confidence = v_new_conf, type_id = v_new_type
         where id = v_id;
      end if;
    end if;

    insert into grey.kg_mentions (project_id, entity_id, source_id, chunk_id, page, start_ms, metadata)
    select p_project, v_id, c.source_id, c.id, c.page, c.start_ms, v_meta
      from grey.chunks c
     where c.id in (
             select (m.v ->> 'chunk_id')::uuid
               from jsonb_array_elements(
                 case when jsonb_typeof(v_ent -> 'mentions') = 'array' then v_ent -> 'mentions' else '[]'::jsonb end
               ) as m(v)
              where jsonb_typeof(m.v) = 'object' and coalesce(m.v ->> 'chunk_id', '') ~ c_uuid)
       and c.project_id = p_project and c.source_id = p_source
       and c.deleted_at is null and c.state = 'live'
    on conflict (entity_id, chunk_id) where deleted_at is null do nothing;

    v_map := v_map || jsonb_build_object(v_ref, v_id);
  end loop;

  for v_rel in
    select r.v from jsonb_array_elements(
      case when jsonb_typeof(p_payload -> 'relations') = 'array' then p_payload -> 'relations' else '[]'::jsonb end
    ) as r(v)
    limit 200
  loop
    continue when jsonb_typeof(v_rel) <> 'object';
    v_src := (v_map ->> (v_rel ->> 'source'))::uuid;
    v_tgt := (v_map ->> (v_rel ->> 'target'))::uuid;
    continue when v_src is null or v_tgt is null or v_src = v_tgt;
    v_rtype := grey.kg_type_id(p_project, 'relation', v_rel ->> 'type', 'related_to');
    v_conf := case when jsonb_typeof(v_rel -> 'confidence') = 'number'
                   then least(greatest((v_rel ->> 'confidence')::numeric, 0), 1) end;
    v_rid := null;

    select r.id, r.source_app, r.confidence into v_rid, v_rapp, v_rconf
      from grey.kg_relations r
     where r.project_id = p_project and r.source_entity_id = v_src and r.target_entity_id = v_tgt
       and r.type_id is not distinct from v_rtype
       and r.deleted_at is null and r.valid_to is null
     order by (r.source_app <> 'grey') desc, r.created_at
     limit 1;

    if v_rid is null then
      insert into grey.kg_relations (project_id, source_entity_id, target_entity_id, type_id, confidence, source_app, metadata)
      values (p_project, v_src, v_tgt, v_rtype, v_conf, 'grey', v_meta || jsonb_build_object('firstSourceId', p_source))
      returning id into v_rid;
    elsif v_rapp = 'grey' and v_conf is not null and (v_rconf is null or v_conf > v_rconf) then
      update grey.kg_relations set confidence = v_conf where id = v_rid;
    end if;

    v_chunk := case when jsonb_typeof(v_rel -> 'mention') = 'object' then v_rel -> 'mention' ->> 'chunk_id' end;
    if coalesce(v_chunk, '') ~ c_uuid then
      insert into grey.kg_mentions (project_id, relation_id, source_id, chunk_id, page, start_ms, metadata)
      select p_project, v_rid, c.source_id, c.id, c.page, c.start_ms, v_meta
        from grey.chunks c
       where c.id = v_chunk::uuid and c.project_id = p_project and c.source_id = p_source
         and c.deleted_at is null and c.state = 'live'
      on conflict (relation_id, chunk_id) where deleted_at is null do nothing;
    end if;
  end loop;

  return v_map;
end;
$$;

-- ---------------------------------------------------------------------------
-- kg_clear_source_mentions — drops a source's mentions (derived data). Used
-- when a source is soft-deleted; chunk swaps remove mentions by cascade.
-- ---------------------------------------------------------------------------
create or replace function grey.kg_clear_source_mentions(p_project uuid, p_source uuid)
returns integer
language plpgsql
set search_path = grey, public
as $$
declare
  v_count integer;
begin
  perform pg_advisory_xact_lock(hashtext('grey.kg:' || p_project::text));
  delete from grey.kg_mentions m
   where m.project_id = p_project
     and (m.source_id = p_source
          or m.chunk_id in (select c.id from grey.chunks c where c.source_id = p_source and c.project_id = p_project));
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- kg_sweep_orphans — soft-deletes, project-wide (mentions removed by a swap
-- cascade can't be traced back to their source):
--   * grey relations with no live mention or a dead endpoint;
--   * grey entities with no live mention, unless a live relation ties them to
--     a forms/manual entity or is itself forms/manual (curated work is never
--     destroyed by a re-ingest);
--   * grey relations left with a dead endpoint by the step above.
-- Call it AFTER extraction for the source (re-extraction must see the old
-- entities to keep their ids). p_source is informational.
-- Returns { entities, relations } counts.
-- ---------------------------------------------------------------------------
create or replace function grey.kg_sweep_orphans(p_project uuid, p_source uuid default null)
returns jsonb
language plpgsql
set search_path = grey, public
as $$
declare
  v_relations integer := 0;
  v_entities integer := 0;
  v_more integer := 0;
  v_marker jsonb := jsonb_build_object('removedBy', 'orphan_sweep');
begin
  if p_project is null then
    return jsonb_build_object('entities', 0, 'relations', 0);
  end if;
  perform pg_advisory_xact_lock(hashtext('grey.kg:' || p_project::text));

  update grey.kg_relations r
     set deleted_at = now(), metadata = r.metadata || v_marker
   where r.project_id = p_project and r.deleted_at is null and r.source_app = 'grey'
     and (
       not exists (select 1 from grey.kg_mentions m where m.relation_id = r.id and m.deleted_at is null)
       or exists (
         select 1 from grey.kg_entities e
          where e.id in (r.source_entity_id, r.target_entity_id) and e.deleted_at is not null)
     );
  get diagnostics v_relations = row_count;

  update grey.kg_entities e
     set deleted_at = now(), metadata = e.metadata || v_marker
   where e.project_id = p_project and e.deleted_at is null and e.source_app = 'grey'
     and not exists (select 1 from grey.kg_mentions m where m.entity_id = e.id and m.deleted_at is null)
     and not exists (
       select 1
         from grey.kg_relations r
         join grey.kg_entities o
           on o.id = case when r.source_entity_id = e.id then r.target_entity_id else r.source_entity_id end
        where (r.source_entity_id = e.id or r.target_entity_id = e.id)
          and r.deleted_at is null and o.deleted_at is null
          and (o.source_app <> 'grey' or r.source_app <> 'grey')
     );
  get diagnostics v_entities = row_count;

  if v_entities > 0 then
    update grey.kg_relations r
       set deleted_at = now(), metadata = r.metadata || v_marker
     where r.project_id = p_project and r.deleted_at is null and r.source_app = 'grey'
       and exists (
         select 1 from grey.kg_entities e
          where e.id in (r.source_entity_id, r.target_entity_id) and e.deleted_at is not null);
    get diagnostics v_more = row_count;
  end if;

  return jsonb_build_object('entities', v_entities, 'relations', v_relations + v_more);
end;
$$;

-- ---------------------------------------------------------------------------
-- kg_merge_entities — folds duplicate entities into a canonical one in a single
-- transaction (the graph screens' Merge; lib/supabase/graph.js mergeEntities).
-- Members need project access + grey.graph.edit; the service role may call it
-- too. Runs under the project's graph lock:
--   * mentions: a duplicate's mention of a chunk the canonical — or another
--     duplicate — already mentions is dropped (one live mention per entity +
--     chunk); the rest move to the canonical;
--   * relations move to the canonical; resulting self-relations are
--     soft-deleted; live, current relations that now share (source, target,
--     type) keep one survivor (forms/manual first, then the oldest), which
--     takes over the others' mentions (one per chunk) and, when it's a grey
--     relation, their highest confidence; the others are soft-deleted;
--   * the canonical gains the duplicates' names and aliases as aliases;
--   * duplicates get merged_into + deleted_at; entities already merged into a
--     duplicate, and Forms links to one, now point at the canonical.
-- Returns { merged, mentions, relations }: duplicates folded, entity mentions
-- moved, relations removed.
-- ---------------------------------------------------------------------------
create or replace function grey.kg_merge_entities(p_project uuid, p_canonical uuid, p_duplicates uuid[])
returns jsonb
language plpgsql
security definer
set search_path = grey, public
as $$
declare
  v_dups uuid[];
  v_canonical grey.kg_entities%rowtype;
  v_found integer;
  v_names text[];
  v_mentions integer := 0;
  v_relations integer := 0;
  v_n integer;
  v_losers uuid[];
  v_keepers uuid[];
begin
  if p_project is null or p_canonical is null then
    raise exception 'KG_BAD_ARGUMENTS' using errcode = '22023';
  end if;
  if coalesce(auth.role(), '') <> 'service_role'
     and not (grey.can_access_project(p_project) and grey.rbac_allows('grey.graph.edit', p_project)) then
    raise exception 'Graph edit permission required' using errcode = '42501';
  end if;

  v_dups := array(select distinct d from unnest(coalesce(p_duplicates, '{}'::uuid[])) as d where d is not null);
  if cardinality(v_dups) = 0 or p_canonical = any(v_dups) then
    raise exception 'KG_BAD_ARGUMENTS' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('grey.kg:' || p_project::text));

  select * into v_canonical
    from grey.kg_entities e
   where e.id = p_canonical and e.project_id = p_project and e.deleted_at is null and e.merged_into is null
   for update;
  if not found then
    raise exception 'KG_ENTITY_NOT_FOUND' using errcode = 'P0002';
  end if;

  select count(*)::int into v_found
    from (
      select e.id from grey.kg_entities e
       where e.id = any(v_dups) and e.project_id = p_project and e.deleted_at is null
       for update
    ) x;
  if v_found <> cardinality(v_dups) then
    raise exception 'KG_ENTITY_NOT_FOUND' using errcode = 'P0002';
  end if;

  v_names := array(
    select v.n
      from grey.kg_entities e
      cross join lateral unnest(array[e.name] || e.aliases) with ordinality as v(n, i)
     where e.id = any(v_dups)
     order by e.created_at, e.id, v.i
  );

  -- Entity mentions (unique live (entity_id, chunk_id)).
  delete from grey.kg_mentions m
   where m.project_id = p_project and m.entity_id = any(v_dups)
     and m.deleted_at is null and m.chunk_id is not null
     and exists (
       select 1 from grey.kg_mentions k
        where k.entity_id = p_canonical and k.chunk_id = m.chunk_id and k.deleted_at is null);

  delete from grey.kg_mentions m
   using (
     select x.id, row_number() over (partition by x.chunk_id order by x.created_at, x.id) as rn
       from grey.kg_mentions x
      where x.project_id = p_project and x.entity_id = any(v_dups)
        and x.deleted_at is null and x.chunk_id is not null
   ) d
   where m.id = d.id and d.rn > 1;

  update grey.kg_mentions m
     set entity_id = p_canonical
   where m.project_id = p_project and m.entity_id = any(v_dups);
  get diagnostics v_mentions = row_count;

  -- Relations.
  update grey.kg_relations r
     set source_entity_id = p_canonical
   where r.project_id = p_project and r.source_entity_id = any(v_dups);
  update grey.kg_relations r
     set target_entity_id = p_canonical
   where r.project_id = p_project and r.target_entity_id = any(v_dups);

  update grey.kg_relations r
     set deleted_at = now(), metadata = r.metadata || jsonb_build_object('removedBy', 'merge')
   where r.project_id = p_project and r.deleted_at is null
     and r.source_entity_id = p_canonical and r.target_entity_id = p_canonical;
  get diagnostics v_relations = row_count;

  select coalesce(array_agg(d.id), '{}'::uuid[]), coalesce(array_agg(d.keep_id), '{}'::uuid[])
    into v_losers, v_keepers
    from (
      select r.id, first_value(r.id) over w as keep_id, row_number() over w as rn
        from grey.kg_relations r
       where r.project_id = p_project and r.deleted_at is null and r.valid_to is null
         and (r.source_entity_id = p_canonical or r.target_entity_id = p_canonical)
      window w as (partition by r.source_entity_id, r.target_entity_id, r.type_id
                   order by (r.source_app <> 'grey') desc, r.created_at, r.id)
    ) d
   where d.rn > 1;

  if cardinality(v_losers) > 0 then
    -- Relation mentions (unique live (relation_id, chunk_id)) move to the survivor.
    delete from grey.kg_mentions m
     using unnest(v_losers, v_keepers) as x(loser, keeper)
     where m.relation_id = x.loser and m.deleted_at is null and m.chunk_id is not null
       and exists (
         select 1 from grey.kg_mentions k
          where k.relation_id = x.keeper and k.chunk_id = m.chunk_id and k.deleted_at is null);

    delete from grey.kg_mentions m
     using (
       select mm.id, row_number() over (partition by x.keeper, mm.chunk_id order by mm.created_at, mm.id) as rn
         from grey.kg_mentions mm
         join unnest(v_losers, v_keepers) as x(loser, keeper) on mm.relation_id = x.loser
        where mm.deleted_at is null and mm.chunk_id is not null
     ) d
     where m.id = d.id and d.rn > 1;

    update grey.kg_mentions m
       set relation_id = x.keeper
      from unnest(v_losers, v_keepers) as x(loser, keeper)
     where m.relation_id = x.loser;

    update grey.kg_relations k
       set confidence = c.conf
      from (
        select x.keeper, max(r.confidence) as conf
          from unnest(v_losers, v_keepers) as x(loser, keeper)
          join grey.kg_relations r on r.id = x.loser
         group by x.keeper
      ) c
     where k.id = c.keeper and k.source_app = 'grey'
       and c.conf is not null and (k.confidence is null or c.conf > k.confidence);

    update grey.kg_relations r
       set deleted_at = now(),
           metadata = r.metadata || jsonb_build_object('removedBy', 'merge', 'mergedInto', x.keeper)
      from unnest(v_losers, v_keepers) as x(loser, keeper)
     where r.id = x.loser;
    get diagnostics v_n = row_count;
    v_relations := v_relations + v_n;
  end if;

  -- Entities.
  update grey.kg_entities e
     set aliases = grey.kg_merge_aliases(v_canonical.name, v_canonical.aliases, v_names)
   where e.id = p_canonical;

  update grey.kg_entities e
     set merged_into = p_canonical, deleted_at = now()
   where e.id = any(v_dups);

  update grey.kg_entities e
     set merged_into = p_canonical
   where e.project_id = p_project and e.merged_into = any(v_dups);

  update grey.kg_form_links l
     set entity_id = p_canonical
   where l.project_id = p_project and l.entity_id = any(v_dups);

  return jsonb_build_object('merged', cardinality(v_dups), 'mentions', v_mentions, 'relations', v_relations);
end;
$$;

-- ---------------------------------------------------------------------------
-- kg_match_query_entities — entities named in a query (spec §10.4 step 1):
-- word similarity of the normalised name or any alias within the normalised
-- query ≥ 0.8, restricted to entities with a live mention in a live chunk of
-- p_kb_ids (the KB set is the permission boundary).
-- ---------------------------------------------------------------------------
create or replace function grey.kg_match_query_entities(
  p_project uuid,
  p_kb_ids uuid[],
  p_query text,
  p_limit integer default 5
)
returns table (entity_id uuid, name text, type_name text, score real)
language plpgsql
stable
set search_path = grey, public
as $$
#variable_conflict use_column
declare
  v_query text := grey.normalize_entity_name(left(coalesce(p_query, ''), 2000));
  v_kbs uuid[];
begin
  if v_query = '' then
    return;
  end if;
  select coalesce(array_agg(k.id), '{}'::uuid[]) into v_kbs
    from grey.knowledge_bases k
   where k.project_id = p_project and k.id = any(coalesce(p_kb_ids, '{}'::uuid[])) and k.deleted_at is null;
  if cardinality(v_kbs) = 0 then
    return;
  end if;

  return query
    select s.id, s.name, t.name, s.sim::real
      from (
        select e.id, e.name, e.type_id, e.confidence,
               greatest(
                 word_similarity(e.name_norm, v_query),
                 coalesce((select max(word_similarity(a, v_query)) from unnest(e.aliases_norm) as a), 0)
               ) as sim
          from grey.kg_entities e
         where e.project_id = p_project and e.deleted_at is null and e.merged_into is null
           and e.name_norm <> ''
      ) s
      left join grey.kg_types t on t.id = s.type_id
     where s.sim >= 0.8
       and grey.kg_entity_grounded(s.id, p_project, v_kbs)
     order by s.sim desc, s.confidence desc nulls last, s.id
     limit least(greatest(coalesce(p_limit, 5), 1), 20);
end;
$$;

-- ---------------------------------------------------------------------------
-- kg_expand — graph neighbourhood of the seed entities (spec §10.4 step 3).
-- Recursive walk over live, current (valid_to null), non-Forms relations: at
-- most 15 edges per entity per hop (highest confidence first), only into
-- entities grounded in p_kb_ids. Extracted (grey) relations — in the walk and
-- in the facts — also need a live mention in a live chunk of p_kb_ids, so a
-- fact read from another knowledge base never leaks; manual relations need
-- both endpoints grounded; Forms relations are never used. Returns
--   { chunks: [{ chunk_id, source_id, source_name, kb_id, content, page,
--                start_ms, end_ms, heading_path, score }],   score Σ 1/(1+depth)
--     facts:  [{ subject, relation, object, confidence }] }   ≤ 20
-- ---------------------------------------------------------------------------
create or replace function grey.kg_expand(
  p_project uuid,
  p_kb_ids uuid[],
  p_seed uuid[],
  p_exclude_chunks uuid[] default '{}',
  p_hops integer default 2,
  p_max_entities integer default 40,
  p_max_chunks integer default 8
)
returns jsonb
language plpgsql
stable
set search_path = grey, public
as $$
declare
  v_hops integer := least(greatest(coalesce(p_hops, 2), 0), 3);
  v_max_entities integer := least(greatest(coalesce(p_max_entities, 40), 1), 200);
  v_max_chunks integer := least(greatest(coalesce(p_max_chunks, 8), 0), 50);
  v_exclude uuid[] := coalesce(p_exclude_chunks, '{}'::uuid[]);
  v_kbs uuid[];
  v_ids uuid[];
  v_depths integer[];
  v_chunks jsonb;
  v_facts jsonb;
begin
  select coalesce(array_agg(k.id), '{}'::uuid[]) into v_kbs
    from grey.knowledge_bases k
   where k.project_id = p_project and k.id = any(coalesce(p_kb_ids, '{}'::uuid[])) and k.deleted_at is null;
  if cardinality(v_kbs) = 0 or coalesce(cardinality(p_seed), 0) = 0 then
    return jsonb_build_object('chunks', '[]'::jsonb, 'facts', '[]'::jsonb);
  end if;

  with recursive walk (entity_id, depth) as (
    select e.id, 0
      from grey.kg_entities e
     where e.id = any(p_seed[1:20]) and e.project_id = p_project
       and e.deleted_at is null and e.merged_into is null
       and grey.kg_entity_grounded(e.id, p_project, v_kbs)
    union
    select n.other_id, w.depth + 1
      from walk w
      cross join lateral (
        select x.other_id
          from (
            select case when r.source_entity_id = w.entity_id then r.target_entity_id
                        else r.source_entity_id end as other_id
              from grey.kg_relations r
             where r.project_id = p_project and r.deleted_at is null and r.valid_to is null
               and r.source_app <> 'forms'
               and (r.source_entity_id = w.entity_id or r.target_entity_id = w.entity_id)
               and (r.source_app <> 'grey' or grey.kg_relation_grounded(r.id, p_project, v_kbs))
             order by r.confidence desc nulls last, r.id
             limit 15
          ) x
          join grey.kg_entities o
            on o.id = x.other_id and o.project_id = p_project and o.deleted_at is null and o.merged_into is null
         where grey.kg_entity_grounded(o.id, p_project, v_kbs)
      ) n
     where w.depth < v_hops
  )
  select array_agg(t.entity_id order by t.depth, t.paths desc, t.entity_id),
         array_agg(t.depth order by t.depth, t.paths desc, t.entity_id)
    into v_ids, v_depths
    from (
      select w.entity_id, min(w.depth) as depth, count(*) as paths
        from walk w
       group by w.entity_id
       order by min(w.depth), count(*) desc, w.entity_id
       limit v_max_entities
    ) t;

  if v_ids is null then
    return jsonb_build_object('chunks', '[]'::jsonb, 'facts', '[]'::jsonb);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'chunk_id', t.id, 'source_id', t.source_id, 'source_name', t.source_name, 'kb_id', t.kb_id,
           'content', t.content, 'page', t.page, 'start_ms', t.start_ms, 'end_ms', t.end_ms,
           'heading_path', t.heading_path, 'score', t.score
         ) order by t.score desc, t.id), '[]'::jsonb)
    into v_chunks
    from (
      select c.id, c.source_id, s.name as source_name, c.kb_id, c.content, c.page, c.start_ms, c.end_ms,
             c.heading_path, sum(1.0 / (1 + e.depth))::real as score
        from unnest(v_ids, v_depths) as e(entity_id, depth)
        join grey.kg_mentions m on m.entity_id = e.entity_id and m.deleted_at is null
        join grey.chunks c on c.id = m.chunk_id
        join grey.sources s on s.id = c.source_id and s.project_id = p_project and s.deleted_at is null
       where c.project_id = p_project and c.kb_id = any(v_kbs)
         and c.deleted_at is null and c.state = 'live'
         and not (c.id = any(v_exclude))
       group by c.id, s.name
       order by score desc, c.id
       limit v_max_chunks
    ) t;

  select coalesce(jsonb_agg(jsonb_build_object(
           'subject', f.subject, 'relation', f.relation, 'object', f.object, 'confidence', f.confidence
         ) order by f.depth, f.confidence desc nulls last, f.id), '[]'::jsonb)
    into v_facts
    from (
      select r.id, se.name as subject, coalesce(rt.name, 'related_to') as relation, te.name as object,
             r.confidence, least(a.depth, b.depth) as depth
        from grey.kg_relations r
        join unnest(v_ids, v_depths) as a(entity_id, depth) on a.entity_id = r.source_entity_id
        join unnest(v_ids, v_depths) as b(entity_id, depth) on b.entity_id = r.target_entity_id
        join grey.kg_entities se on se.id = r.source_entity_id and se.project_id = p_project
        join grey.kg_entities te on te.id = r.target_entity_id and te.project_id = p_project
        left join grey.kg_types rt on rt.id = r.type_id
       where r.project_id = p_project and r.deleted_at is null and r.valid_to is null
         and r.source_app <> 'forms'
         and (r.source_app <> 'grey' or grey.kg_relation_grounded(r.id, p_project, v_kbs))
       order by least(a.depth, b.depth), r.confidence desc nulls last, r.id
       limit 20
    ) f;

  return jsonb_build_object('chunks', v_chunks, 'facts', v_facts);
end;
$$;

-- ---------------------------------------------------------------------------
-- upsert_form_entity — Forms pushes submission entities (spec §10.5). Called
-- server-side by Forms with the service role:
--   admin.schema('grey').rpc('upsert_form_entity', { p_project_id, p_form_id,
--     p_submission_id, p_entities, p_relations })
--
-- p_entities:  [{ key, type, name, aliases?[], description?, properties?{} }]
-- p_relations: [{ source /* key */, target /* key */, type, replace?: bool }]
-- Returns { entities: { "<key>": "<entity uuid>" }, relations: <count> }.
--
-- Identity (no fuzzy matching): this submission's link row → same-type
-- lower(properties.email) → properties.domain for organisations → exact
-- name_norm + type. A grey entity is promoted (source_app 'forms',
-- confidence 1, form name wins, old name kept as an alias); a forms entity
-- takes the latest submission; a manual entity only gains missing aliases
-- and properties. replace: true closes (valid_to = now()) the source entity's
-- other live Forms relations of that type.
-- ---------------------------------------------------------------------------
create or replace function grey.upsert_form_entity(
  p_project_id uuid,
  p_form_id uuid,
  p_submission_id uuid,
  p_entities jsonb,
  p_relations jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
set search_path = grey, public
as $$
declare
  v_org_type uuid;
  v_meta jsonb;
  v_map jsonb := '{}'::jsonb;
  v_relations integer := 0;
  v_ent jsonb;
  v_rel jsonb;
  v_key text;
  v_name text;
  v_norm text;
  v_type uuid;
  v_props jsonb;
  v_email text;
  v_domain text;
  v_aliases text[];
  v_desc text;
  v_id uuid;
  v_row grey.kg_entities%rowtype;
  v_src uuid;
  v_tgt uuid;
  v_rtype uuid;
  v_rid uuid;
  v_rapp text;
begin
  if p_project_id is null or p_submission_id is null then
    raise exception 'KG_BAD_ARGUMENTS';
  end if;
  perform 1 from public.projects p where p.id = p_project_id;
  if not found then
    raise exception 'KG_PROJECT_NOT_FOUND';
  end if;

  perform grey.ensure_default_ontology(p_project_id);
  perform pg_advisory_xact_lock(hashtext('grey.kg:' || p_project_id::text));

  v_org_type := grey.kg_type_id(p_project_id, 'entity', 'Organization');
  v_meta := jsonb_build_object('origin', 'forms', 'formId', p_form_id, 'submissionId', p_submission_id);

  for v_ent in
    select e.v from jsonb_array_elements(
      case when jsonb_typeof(p_entities) = 'array' then p_entities else '[]'::jsonb end
    ) as e(v)
    limit 50
  loop
    continue when jsonb_typeof(v_ent) <> 'object';
    v_key := nullif(btrim(v_ent ->> 'key'), '');
    v_name := left(nullif(btrim(regexp_replace(coalesce(v_ent ->> 'name', ''), '\s+', ' ', 'g')), ''), 200);
    continue when v_key is null or v_name is null;
    v_norm := grey.normalize_entity_name(v_name);
    continue when v_norm = '';

    v_type := grey.kg_type_id(p_project_id, 'entity', v_ent ->> 'type', 'Other');
    v_props := case when jsonb_typeof(v_ent -> 'properties') = 'object' then v_ent -> 'properties' else '{}'::jsonb end;
    v_email := lower(nullif(btrim(v_props ->> 'email'), ''));
    v_domain := lower(nullif(btrim(v_props ->> 'domain'), ''));
    v_aliases := array(
      select a.v #>> '{}' from jsonb_array_elements(
        case when jsonb_typeof(v_ent -> 'aliases') = 'array' then v_ent -> 'aliases' else '[]'::jsonb end
      ) as a(v)
      where jsonb_typeof(a.v) = 'string'
      limit 20
    );
    v_desc := left(nullif(btrim(v_ent ->> 'description'), ''), 1000);
    v_id := null;

    -- 1. This submission already resolved the key.
    select l.entity_id into v_id
      from grey.kg_form_links l
     where l.submission_id = p_submission_id and l.entity_key = v_key and l.project_id = p_project_id;
    if v_id is not null then
      v_id := grey.kg_live_entity(p_project_id, v_id);
    end if;

    -- 2. Same email, same type.
    if v_id is null and v_email is not null then
      select e.id into v_id
        from grey.kg_entities e
       where e.project_id = p_project_id and e.deleted_at is null and e.merged_into is null
         and e.type_id is not distinct from v_type
         and lower(e.properties ->> 'email') = v_email
       order by (e.source_app = 'forms') desc, e.created_at
       limit 1;
    end if;

    -- 3. Same domain, for organisations.
    if v_id is null and v_domain is not null and v_org_type is not null and v_type = v_org_type then
      select e.id into v_id
        from grey.kg_entities e
       where e.project_id = p_project_id and e.deleted_at is null and e.merged_into is null
         and e.type_id = v_org_type
         and lower(e.properties ->> 'domain') = v_domain
       order by (e.source_app = 'forms') desc, e.created_at
       limit 1;
    end if;

    -- 4. Exact normalised name, same type.
    if v_id is null then
      select e.id into v_id
        from grey.kg_entities e
       where e.project_id = p_project_id and e.deleted_at is null and e.merged_into is null
         and e.type_id is not distinct from v_type
         and e.name_norm = v_norm
       order by case e.source_app when 'forms' then 0 when 'manual' then 1 else 2 end, e.created_at
       limit 1;
    end if;

    if v_id is null then
      insert into grey.kg_entities (project_id, type_id, name, aliases, description, properties, source_app, confidence, metadata)
      values (p_project_id, v_type, v_name, grey.kg_merge_aliases(v_name, '{}', v_aliases), v_desc, v_props,
              'forms', 1, v_meta)
      returning id into v_id;
    else
      select * into v_row from grey.kg_entities where id = v_id for update;
      if v_row.source_app = 'manual' then
        update grey.kg_entities
           set aliases = grey.kg_merge_aliases(v_row.name, v_row.aliases, array[v_name] || v_aliases),
               properties = v_props || v_row.properties
         where id = v_id;
      else
        update grey.kg_entities
           set name = v_name,
               aliases = grey.kg_merge_aliases(v_name, v_row.aliases, array[v_row.name] || v_aliases),
               description = coalesce(v_desc, v_row.description),
               properties = v_row.properties || v_props,
               source_app = 'forms',
               confidence = 1,
               metadata = v_row.metadata || v_meta
         where id = v_id;
      end if;
    end if;

    insert into grey.kg_form_links (project_id, submission_id, entity_key, entity_id, form_id)
    values (p_project_id, p_submission_id, v_key, v_id, p_form_id)
    on conflict (submission_id, entity_key) do update
      set entity_id = excluded.entity_id, form_id = excluded.form_id
      where grey.kg_form_links.project_id = excluded.project_id;

    v_map := v_map || jsonb_build_object(v_key, v_id);
  end loop;

  for v_rel in
    select r.v from jsonb_array_elements(
      case when jsonb_typeof(p_relations) = 'array' then p_relations else '[]'::jsonb end
    ) as r(v)
    limit 100
  loop
    continue when jsonb_typeof(v_rel) <> 'object';
    v_src := (v_map ->> (v_rel ->> 'source'))::uuid;
    v_tgt := (v_map ->> (v_rel ->> 'target'))::uuid;
    continue when v_src is null or v_tgt is null or v_src = v_tgt;
    v_rtype := grey.kg_type_id(p_project_id, 'relation', v_rel ->> 'type', 'related_to');

    if v_rel -> 'replace' = 'true'::jsonb then
      update grey.kg_relations r
         set valid_to = now()
       where r.project_id = p_project_id and r.source_entity_id = v_src
         and r.type_id is not distinct from v_rtype
         and r.target_entity_id <> v_tgt
         and r.source_app = 'forms' and r.valid_to is null and r.deleted_at is null;
    end if;

    v_rid := null;
    select r.id, r.source_app into v_rid, v_rapp
      from grey.kg_relations r
     where r.project_id = p_project_id and r.source_entity_id = v_src and r.target_entity_id = v_tgt
       and r.type_id is not distinct from v_rtype
       and r.deleted_at is null and r.valid_to is null
     order by case r.source_app when 'forms' then 0 when 'manual' then 1 else 2 end, r.created_at
     limit 1;

    if v_rid is null then
      insert into grey.kg_relations (project_id, source_entity_id, target_entity_id, type_id, valid_from, confidence, source_app, metadata)
      values (p_project_id, v_src, v_tgt, v_rtype, now(), 1, 'forms', v_meta);
    elsif v_rapp = 'grey' then
      update grey.kg_relations r
         set source_app = 'forms', confidence = 1, metadata = r.metadata || v_meta
       where r.id = v_rid;
    end if;
    v_relations := v_relations + 1;
  end loop;

  return jsonb_build_object('entities', v_map, 'relations', v_relations);
end;
$$;

-- ---------------------------------------------------------------------------
-- Source soft-delete → clear its mentions, then sweep the project's orphans.
-- Statement-level with transition tables, so a bulk delete sweeps once per
-- project. SECURITY DEFINER: the deleting user (authenticated) has no EXECUTE
-- on the service-role functions it calls.
-- ---------------------------------------------------------------------------
create or replace function grey.kg_sources_soft_deleted()
returns trigger
language plpgsql
security definer
set search_path = grey, public
as $$
declare
  v_group record;
begin
  for v_group in
    select n.project_id, array_agg(n.id) as source_ids
      from new_rows n
      join old_rows o on o.id = n.id
     where o.deleted_at is null and n.deleted_at is not null
     group by n.project_id
  loop
    perform grey.kg_clear_source_mentions(v_group.project_id, s.id)
       from unnest(v_group.source_ids) as s(id);
    perform grey.kg_sweep_orphans(v_group.project_id, null);
  end loop;
  return null;
end;
$$;

drop trigger if exists sources_kg_soft_delete on grey.sources;
create trigger sources_kg_soft_delete
after update on grey.sources
referencing old table as old_rows new table as new_rows
for each statement execute function grey.kg_sources_soft_deleted();

-- ---------------------------------------------------------------------------
-- Grants: everything except ensure_default_ontology, kg_merge_entities and the
-- normalisers is service-role only.
-- ---------------------------------------------------------------------------
revoke all on function grey.kg_type_id(uuid, text, text, text) from public, anon, authenticated;
revoke all on function grey.kg_merge_aliases(text, text[], text[]) from public, anon, authenticated;
revoke all on function grey.kg_live_entity(uuid, uuid) from public, anon, authenticated;
revoke all on function grey.kg_entity_grounded(uuid, uuid, uuid[]) from public, anon, authenticated;
revoke all on function grey.kg_relation_grounded(uuid, uuid, uuid[]) from public, anon, authenticated;
revoke all on function grey.kg_upsert_extracted(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function grey.kg_clear_source_mentions(uuid, uuid) from public, anon, authenticated;
revoke all on function grey.kg_sweep_orphans(uuid, uuid) from public, anon, authenticated;
revoke all on function grey.kg_match_query_entities(uuid, uuid[], text, integer) from public, anon, authenticated;
revoke all on function grey.kg_expand(uuid, uuid[], uuid[], uuid[], integer, integer, integer) from public, anon, authenticated;
revoke all on function grey.upsert_form_entity(uuid, uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
revoke all on function grey.kg_sources_soft_deleted() from public, anon, authenticated;

grant execute on function grey.kg_type_id(uuid, text, text, text) to service_role;
grant execute on function grey.kg_merge_aliases(text, text[], text[]) to service_role;
grant execute on function grey.kg_live_entity(uuid, uuid) to service_role;
grant execute on function grey.kg_entity_grounded(uuid, uuid, uuid[]) to service_role;
grant execute on function grey.kg_relation_grounded(uuid, uuid, uuid[]) to service_role;
grant execute on function grey.kg_upsert_extracted(uuid, uuid, jsonb) to service_role;
grant execute on function grey.kg_clear_source_mentions(uuid, uuid) to service_role;
grant execute on function grey.kg_sweep_orphans(uuid, uuid) to service_role;
grant execute on function grey.kg_match_query_entities(uuid, uuid[], text, integer) to service_role;
grant execute on function grey.kg_expand(uuid, uuid[], uuid[], uuid[], integer, integer, integer) to service_role;
grant execute on function grey.upsert_form_entity(uuid, uuid, uuid, jsonb, jsonb) to service_role;

-- kg_merge_entities checks project access + grey.graph.edit itself.
revoke all on function grey.kg_merge_entities(uuid, uuid, uuid[]) from public, anon;
grant execute on function grey.kg_merge_entities(uuid, uuid, uuid[]) to authenticated, service_role;

-- Mentions are written only by extraction, merges and the source soft-delete trigger (all
-- service-role or SECURITY DEFINER). Members read them but can't plant mentions that point at
-- another project's entities, chunks or sources.
drop policy if exists kg_mentions_member_all on grey.kg_mentions;
drop policy if exists kg_mentions_member_select on grey.kg_mentions;
create policy kg_mentions_member_select on grey.kg_mentions for select to authenticated
  using (grey.can_access_project(project_id));

-- @down
drop policy if exists kg_mentions_member_select on grey.kg_mentions;
drop policy if exists kg_mentions_member_all on grey.kg_mentions;
create policy kg_mentions_member_all on grey.kg_mentions for all to authenticated
  using (grey.can_access_project(project_id)) with check (grey.can_access_project(project_id));
drop trigger if exists sources_kg_soft_delete on grey.sources;
drop function if exists grey.kg_sources_soft_deleted();
drop function if exists grey.upsert_form_entity(uuid, uuid, uuid, jsonb, jsonb);
drop function if exists grey.kg_expand(uuid, uuid[], uuid[], uuid[], integer, integer, integer);
drop function if exists grey.kg_merge_entities(uuid, uuid, uuid[]);
drop function if exists grey.kg_match_query_entities(uuid, uuid[], text, integer);
drop function if exists grey.kg_sweep_orphans(uuid, uuid);
drop function if exists grey.kg_clear_source_mentions(uuid, uuid);
drop function if exists grey.kg_upsert_extracted(uuid, uuid, jsonb);
drop function if exists grey.kg_relation_grounded(uuid, uuid, uuid[]);
drop function if exists grey.kg_entity_grounded(uuid, uuid, uuid[]);
drop function if exists grey.kg_live_entity(uuid, uuid);
drop function if exists grey.kg_merge_aliases(text, text[], text[]);
drop function if exists grey.kg_type_id(uuid, text, text, text);
drop function if exists grey.ensure_default_ontology(uuid);
drop table if exists grey.kg_form_links cascade;
drop index if exists grey.kg_mentions_relation_chunk_uniq;
drop index if exists grey.kg_mentions_entity_chunk_uniq;
drop index if exists grey.kg_relations_edge_idx;
alter table grey.kg_relations drop column if exists source_app;
drop index if exists grey.kg_entities_email_idx;
drop index if exists grey.kg_entities_aliases_norm_idx;
drop index if exists grey.kg_entities_name_norm_idx;
drop index if exists grey.kg_entities_name_trgm_idx;
alter table grey.kg_entities drop column if exists aliases_norm;
alter table grey.kg_entities drop column if exists name_norm;
drop function if exists grey.normalize_entity_names(text[]);
drop function if exists grey.normalize_entity_name(text);
-- unaccent and pg_trgm stay installed: extensions are database-wide in the
-- shared suite project (grey_core likewise never drops pgcrypto).
