-- Ingestion — presets, knowledge bases, sources, jobs, chunks
--
-- From spec section 2.2. Owns:
--   grey.ingestion_presets  — tiered ingestion config (system + custom)
--   grey.knowledge_bases    — a project's knowledge bases
--   grey.sources            — files/urls/notes feeding a knowledge base
--   grey.ingestion_jobs     — one run of a source through a preset
--   grey.chunks             — the chunked output of a source
-- plus the four system preset seed rows and the private "grey-sources" storage
-- bucket + its RLS policy.

-- @up

-- ---------------------------------------------------------------------------
-- ingestion_presets — project_id is nullable: system presets (is_system=true)
-- have project_id null and are readable by every authenticated user.
-- ---------------------------------------------------------------------------
create table if not exists grey.ingestion_presets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade,
  name text not null,
  tier text not null check (tier in ('fast', 'balanced', 'high', 'auto', 'custom')),
  is_system boolean not null default false,
  description text,
  config jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists ingestion_presets_project_idx
  on grey.ingestion_presets (project_id) where deleted_at is null;
drop trigger if exists ingestion_presets_touch on grey.ingestion_presets;
create trigger ingestion_presets_touch before update on grey.ingestion_presets
for each row execute function grey.touch_updated_at();
alter table grey.ingestion_presets enable row level security;
drop policy if exists ingestion_presets_member_all on grey.ingestion_presets;
create policy ingestion_presets_member_all on grey.ingestion_presets for all to authenticated
  using (project_id is null or grey.can_access_project(project_id))
  with check (project_id is not null and grey.can_access_project(project_id));

-- ---------------------------------------------------------------------------
-- knowledge_bases
-- ---------------------------------------------------------------------------
create table if not exists grey.knowledge_bases (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null,
  description text,
  icon text,
  status text not null default 'active' check (status in ('active', 'archived')),
  preset_id uuid references grey.ingestion_presets(id),
  embedding_model text not null default 'cohere-embed-5-pro',
  chunk_config jsonb not null default '{}'::jsonb,
  retrieval_defaults jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists knowledge_bases_project_idx on grey.knowledge_bases(project_id) where deleted_at is null;
drop trigger if exists knowledge_bases_touch on grey.knowledge_bases;
create trigger knowledge_bases_touch before update on grey.knowledge_bases for each row execute function grey.touch_updated_at();
alter table grey.knowledge_bases enable row level security;
drop policy if exists knowledge_bases_member_all on grey.knowledge_bases;
create policy knowledge_bases_member_all on grey.knowledge_bases for all to authenticated
  using (grey.can_access_project(project_id)) with check (grey.can_access_project(project_id));

-- ---------------------------------------------------------------------------
-- sources
-- ---------------------------------------------------------------------------
create table if not exists grey.sources (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  kb_id uuid not null references grey.knowledge_bases(id) on delete cascade,
  name text not null,
  kind text not null check (kind in ('document', 'audio', 'video', 'image', 'web', 'note')),
  origin text not null check (origin in ('upload', 'assets', 'notes', 'content', 'url')),
  origin_ref text,
  mime text,
  bytes bigint,
  page_count integer,
  duration_ms integer,
  storage_path text,
  content_hash text,
  status text not null default 'pending' check (status in ('pending', 'queued', 'processing', 'ready', 'failed')),
  chunk_count integer not null default 0,
  token_count integer not null default 0,
  owner_id uuid,
  review_due_at timestamptz,
  verified_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists sources_project_idx on grey.sources(project_id) where deleted_at is null;
create index if not exists sources_kb_idx on grey.sources(kb_id) where deleted_at is null;
drop trigger if exists sources_touch on grey.sources;
create trigger sources_touch before update on grey.sources for each row execute function grey.touch_updated_at();
alter table grey.sources enable row level security;
drop policy if exists sources_member_all on grey.sources;
create policy sources_member_all on grey.sources for all to authenticated
  using (grey.can_access_project(project_id)) with check (grey.can_access_project(project_id));

-- ---------------------------------------------------------------------------
-- ingestion_jobs
-- ---------------------------------------------------------------------------
create table if not exists grey.ingestion_jobs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  kb_id uuid not null references grey.knowledge_bases(id) on delete cascade,
  source_id uuid not null references grey.sources(id) on delete cascade,
  preset_snapshot jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  stage text check (stage in ('parse', 'chunk', 'embed', 'graph')),
  progress integer not null default 0,
  estimated_cost numeric,
  actual_cost numeric,
  error text,
  started_at timestamptz,
  finished_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists ingestion_jobs_project_idx on grey.ingestion_jobs(project_id) where deleted_at is null;
create index if not exists ingestion_jobs_kb_idx on grey.ingestion_jobs(kb_id) where deleted_at is null;
create index if not exists ingestion_jobs_source_idx on grey.ingestion_jobs(source_id) where deleted_at is null;
drop trigger if exists ingestion_jobs_touch on grey.ingestion_jobs;
create trigger ingestion_jobs_touch before update on grey.ingestion_jobs for each row execute function grey.touch_updated_at();
alter table grey.ingestion_jobs enable row level security;
drop policy if exists ingestion_jobs_member_all on grey.ingestion_jobs;
create policy ingestion_jobs_member_all on grey.ingestion_jobs for all to authenticated
  using (grey.can_access_project(project_id)) with check (grey.can_access_project(project_id));

-- ---------------------------------------------------------------------------
-- chunks — no vector column yet.
-- ---------------------------------------------------------------------------
create table if not exists grey.chunks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  kb_id uuid not null references grey.knowledge_bases(id) on delete cascade,
  source_id uuid not null references grey.sources(id) on delete cascade,
  ordinal integer not null default 0,
  content text,
  token_count integer,
  page integer,
  start_ms integer,
  end_ms integer,
  heading_path text[],
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists chunks_project_idx on grey.chunks(project_id) where deleted_at is null;
create index if not exists chunks_kb_idx on grey.chunks(kb_id) where deleted_at is null;
create index if not exists chunks_source_idx on grey.chunks(source_id, ordinal) where deleted_at is null;
drop trigger if exists chunks_touch on grey.chunks;
create trigger chunks_touch before update on grey.chunks for each row execute function grey.touch_updated_at();
alter table grey.chunks enable row level security;
drop policy if exists chunks_member_all on grey.chunks;
create policy chunks_member_all on grey.chunks for all to authenticated
  using (grey.can_access_project(project_id)) with check (grey.can_access_project(project_id));

-- ---------------------------------------------------------------------------
-- System preset seeds. Fixed ids so other seed/reference data (and tests) can
-- point at them reliably. Prices: perMediaMinute 0.006, perKeyframeMinute 0.04,
-- perMillionTokensGraph 0.5, perMillionTokensContextual 1.02 are constant
-- across tiers; only perPage varies (fast 0.002, balanced 0.006, high 0.02,
-- auto 0.006 — auto routes fast..high and shows that range in the UI estimate).
-- ---------------------------------------------------------------------------
insert into grey.ingestion_presets (id, project_id, name, tier, is_system, description, config)
values
  (
    '00000000-0000-4000-8000-000000000001', null, 'Fast', 'fast', true,
    'Cheapest and quickest: plain text extraction, no OCR, no graph extraction.',
    '{
      "parser": "text",
      "ocr": false,
      "chunking": {"strategy": "recursive", "size": 512, "overlap": 64, "atomicTables": true, "headingBreadcrumbs": true},
      "enrichment": {"contextual": false, "parentChild": false},
      "media": {"transcribe": false, "diarize": false, "keyframes": false, "windowSeconds": 45},
      "graph": {"extract": false},
      "prices": {"perPage": 0.002, "perMediaMinute": 0.006, "perKeyframeMinute": 0.04, "perMillionTokensGraph": 0.5, "perMillionTokensContextual": 1.02}
    }'::jsonb
  ),
  (
    '00000000-0000-4000-8000-000000000002', null, 'Balanced', 'balanced', true,
    'Default tier: layout-aware parsing with OCR, media transcription and graph extraction.',
    '{
      "parser": "layout",
      "ocr": true,
      "chunking": {"strategy": "recursive", "size": 512, "overlap": 64, "atomicTables": true, "headingBreadcrumbs": true},
      "enrichment": {"contextual": false, "parentChild": false},
      "media": {"transcribe": true, "diarize": true, "keyframes": false, "windowSeconds": 45},
      "graph": {"extract": true},
      "prices": {"perPage": 0.006, "perMediaMinute": 0.006, "perKeyframeMinute": 0.04, "perMillionTokensGraph": 0.5, "perMillionTokensContextual": 1.02}
    }'::jsonb
  ),
  (
    '00000000-0000-4000-8000-000000000003', null, 'High accuracy', 'high', true,
    'Highest fidelity: vision-language parsing with OCR and contextual chunk enrichment.',
    '{
      "parser": "vlm",
      "ocr": true,
      "chunking": {"strategy": "recursive", "size": 512, "overlap": 64, "atomicTables": true, "headingBreadcrumbs": true},
      "enrichment": {"contextual": true, "parentChild": false},
      "media": {"transcribe": true, "diarize": true, "keyframes": false, "windowSeconds": 45},
      "graph": {"extract": true},
      "prices": {"perPage": 0.02, "perMediaMinute": 0.006, "perKeyframeMinute": 0.04, "perMillionTokensGraph": 0.5, "perMillionTokensContextual": 1.02}
    }'::jsonb
  ),
  (
    '00000000-0000-4000-8000-000000000004', null, 'Auto', 'auto', true,
    'Routes each source between Fast and High accuracy; cost estimate shows the Fast-High range.',
    '{
      "parser": "auto",
      "ocr": true,
      "chunking": {"strategy": "recursive", "size": 512, "overlap": 64, "atomicTables": true, "headingBreadcrumbs": true},
      "enrichment": {"contextual": false, "parentChild": false},
      "media": {"transcribe": true, "diarize": true, "keyframes": false, "windowSeconds": 45},
      "graph": {"extract": true},
      "prices": {"perPage": 0.006, "perMediaMinute": 0.006, "perKeyframeMinute": 0.04, "perMillionTokensGraph": 0.5, "perMillionTokensContextual": 1.02}
    }'::jsonb
  )
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Storage: private bucket for source files, path
-- <projectId>/<kbId>/<sourceId>/<filename>.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('grey-sources', 'grey-sources', false)
on conflict (id) do nothing;

drop policy if exists grey_sources_storage_all on storage.objects;
create policy grey_sources_storage_all on storage.objects for all to authenticated
  using (bucket_id = 'grey-sources' and grey.can_access_project((storage.foldername(name))[1]::uuid))
  with check (bucket_id = 'grey-sources' and grey.can_access_project((storage.foldername(name))[1]::uuid));

-- @down
drop policy if exists grey_sources_storage_all on storage.objects;
delete from storage.buckets where id = 'grey-sources';
drop table if exists grey.chunks cascade;
drop table if exists grey.ingestion_jobs cascade;
drop table if exists grey.sources cascade;
drop table if exists grey.knowledge_bases cascade;
drop table if exists grey.ingestion_presets cascade;
