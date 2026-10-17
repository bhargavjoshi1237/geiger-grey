-- Retrieval — vector + full-text search over chunks
--
-- From backend spec sections 7.2 and 7.3. Adds to grey.chunks:
--   embedding        public.halfvec with NO fixed dimension (each KB has one model;
--                    filtering by kb_id keeps query and chunk vectors comparable)
--   embedding_dims   smallint, the vector length (drives the partial HNSW indexes)
--   embedding_model  text, provenance
--   fts              generated tsvector over heading_path (A) + search_text/content (B)
-- plus one partial expression HNSW index per common dimension, a GIN index on
-- fts, and the service-role search functions grey.match_chunks_vector and
-- grey.match_chunks_text (SECURITY INVOKER — routes authorize first and pass
-- project_id explicitly; a KB id from another project returns nothing).
--
-- pgvector lives in schema public (public.halfvec, public.halfvec_cosine_ops).
-- Depends on 20261018120100_worker_queue.sql for chunks.state / chunks.search_text.
-- grey.chunks is empty today, so the stored generated column rewrites nothing.

-- @up

-- array_to_string is only STABLE, so generated columns can't call it directly.
create or replace function grey.join_text(p_parts text[])
returns text
language sql
immutable
parallel safe
as $$
  select coalesce(pg_catalog.array_to_string(p_parts, ' '), '')
$$;

alter table grey.chunks
  add column if not exists embedding public.halfvec,
  add column if not exists embedding_dims smallint,
  add column if not exists embedding_model text;

-- The expression indexes cast embedding to halfvec(embedding_dims); a row whose
-- vector length disagrees with embedding_dims would make that cast fail, so the
-- two are kept consistent here with a clear error instead. A vector with null
-- dims is rejected too (it would be invisible to every search).
alter table grey.chunks drop constraint if exists chunks_embedding_dims_check;
alter table grey.chunks add constraint chunks_embedding_dims_check check (
  embedding is null
  or (embedding_dims is not null and embedding_dims between 1 and 4000
      and public.vector_dims(embedding) = embedding_dims)
);

alter table grey.chunks add column if not exists fts tsvector generated always as (
  setweight(to_tsvector('english'::regconfig, grey.join_text(heading_path)), 'A')
  || setweight(to_tsvector('english'::regconfig, coalesce(search_text, content, '')), 'B')
) stored;

create index if not exists chunks_fts_idx on grey.chunks using gin (fts);

-- Partial expression HNSW indexes per common dimension. Other dimensions
-- (64–4000) still work through exact search in match_chunks_vector.
create index if not exists chunks_embedding_hnsw_256 on grey.chunks
  using hnsw ((embedding::public.halfvec(256)) public.halfvec_cosine_ops) with (m = 16, ef_construction = 64)
  where deleted_at is null and state = 'live' and embedding_dims = 256;
create index if not exists chunks_embedding_hnsw_384 on grey.chunks
  using hnsw ((embedding::public.halfvec(384)) public.halfvec_cosine_ops) with (m = 16, ef_construction = 64)
  where deleted_at is null and state = 'live' and embedding_dims = 384;
create index if not exists chunks_embedding_hnsw_512 on grey.chunks
  using hnsw ((embedding::public.halfvec(512)) public.halfvec_cosine_ops) with (m = 16, ef_construction = 64)
  where deleted_at is null and state = 'live' and embedding_dims = 512;
create index if not exists chunks_embedding_hnsw_768 on grey.chunks
  using hnsw ((embedding::public.halfvec(768)) public.halfvec_cosine_ops) with (m = 16, ef_construction = 64)
  where deleted_at is null and state = 'live' and embedding_dims = 768;
create index if not exists chunks_embedding_hnsw_1024 on grey.chunks
  using hnsw ((embedding::public.halfvec(1024)) public.halfvec_cosine_ops) with (m = 16, ef_construction = 64)
  where deleted_at is null and state = 'live' and embedding_dims = 1024;
create index if not exists chunks_embedding_hnsw_1536 on grey.chunks
  using hnsw ((embedding::public.halfvec(1536)) public.halfvec_cosine_ops) with (m = 16, ef_construction = 64)
  where deleted_at is null and state = 'live' and embedding_dims = 1536;
create index if not exists chunks_embedding_hnsw_2048 on grey.chunks
  using hnsw ((embedding::public.halfvec(2048)) public.halfvec_cosine_ops) with (m = 16, ef_construction = 64)
  where deleted_at is null and state = 'live' and embedding_dims = 2048;
create index if not exists chunks_embedding_hnsw_3072 on grey.chunks
  using hnsw ((embedding::public.halfvec(3072)) public.halfvec_cosine_ops) with (m = 16, ef_construction = 64)
  where deleted_at is null and state = 'live' and embedding_dims = 3072;

-- ---------------------------------------------------------------------------
-- grey.or_tsquery — stems with 'english' and ORs the terms. plainto_tsquery ANDs
-- every word, which natural-language questions rarely satisfy. Returns null when
-- only stopwords remain. Lexemes are quoted (quotes and backslashes doubled) so
-- user punctuation can never become tsquery operators.
-- ---------------------------------------------------------------------------
create or replace function grey.or_tsquery(p_query text)
returns tsquery
language sql
immutable
parallel safe
as $$
  select (
    select pg_catalog.string_agg(
             '''' || replace(replace(t.lexeme, '\', '\\'), '''', '''''') || '''', ' | ')
      from (
        select lexeme
          from pg_catalog.unnest(to_tsvector('english'::regconfig, coalesce(p_query, '')))
         limit 64
      ) t
  )::tsquery
$$;

-- ---------------------------------------------------------------------------
-- grey.match_chunks_vector — p_kb_ids must all share one embedding model + dims
-- (searchChunks groups KBs before calling). p_dims is validated, then formatted
-- into the statement so the cast matches the partial expression index.
-- ---------------------------------------------------------------------------
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
  -- %s is a validated integer, so the cast expression matches the partial expression index.
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

-- ---------------------------------------------------------------------------
-- grey.match_chunks_text — same joins/filters; fts @@ or_tsquery ranked by
-- ts_rank_cd (normalised to 0..1 with flag 32).
-- ---------------------------------------------------------------------------
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

-- Service role only: API/MCP/widget callers have no auth.uid(), so RLS can't
-- apply — routes authorize first and these functions scope by p_project.
revoke all on function grey.match_chunks_vector(uuid, uuid[], int, public.halfvec, int, real) from public, anon, authenticated;
grant execute on function grey.match_chunks_vector(uuid, uuid[], int, public.halfvec, int, real) to service_role;
revoke all on function grey.match_chunks_text(uuid, uuid[], text, int) from public, anon, authenticated;
grant execute on function grey.match_chunks_text(uuid, uuid[], text, int) to service_role;

-- @down
drop function if exists grey.match_chunks_text(uuid, uuid[], text, int);
drop function if exists grey.match_chunks_vector(uuid, uuid[], int, public.halfvec, int, real);
drop function if exists grey.or_tsquery(text);
drop index if exists grey.chunks_embedding_hnsw_3072;
drop index if exists grey.chunks_embedding_hnsw_2048;
drop index if exists grey.chunks_embedding_hnsw_1536;
drop index if exists grey.chunks_embedding_hnsw_1024;
drop index if exists grey.chunks_embedding_hnsw_768;
drop index if exists grey.chunks_embedding_hnsw_512;
drop index if exists grey.chunks_embedding_hnsw_384;
drop index if exists grey.chunks_embedding_hnsw_256;
drop index if exists grey.chunks_fts_idx;
alter table grey.chunks drop column if exists fts;
alter table grey.chunks drop constraint if exists chunks_embedding_dims_check;
alter table grey.chunks
  drop column if exists embedding_model,
  drop column if exists embedding_dims,
  drop column if exists embedding;
drop function if exists grey.join_text(text[]);
