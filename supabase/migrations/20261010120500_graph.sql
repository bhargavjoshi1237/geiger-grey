-- Knowledge graph — types, entities, relations, mentions
--
-- From spec section 2.3. Owns grey.kg_types, grey.kg_entities,
-- grey.kg_relations, grey.kg_mentions. Replaces grey_knowledge_nodes (never
-- migrated). The default entity/relation type set (Person, Organization,
-- Product, Location, Event, Concept, Document, Other / works_at, part_of,
-- mentions, related_to, located_in, created) is seeded per project on first
-- load by the app (ensureDefaultOntology), not by this migration.

-- @up
create table if not exists grey.kg_types (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  kind text not null check (kind in ('entity', 'relation')),
  name text not null,
  color text not null default 'chart-1' check (color in ('chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5')),
  description text,
  is_default boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists kg_types_project_idx on grey.kg_types(project_id) where deleted_at is null;
drop trigger if exists kg_types_touch on grey.kg_types;
create trigger kg_types_touch before update on grey.kg_types for each row execute function grey.touch_updated_at();
alter table grey.kg_types enable row level security;
drop policy if exists kg_types_member_all on grey.kg_types;
create policy kg_types_member_all on grey.kg_types for all to authenticated
  using (grey.can_access_project(project_id)) with check (grey.can_access_project(project_id));

create table if not exists grey.kg_entities (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  type_id uuid references grey.kg_types(id) on delete set null,
  name text not null,
  aliases text[] not null default '{}',
  description text,
  properties jsonb not null default '{}'::jsonb,
  source_app text not null default 'grey' check (source_app in ('grey', 'forms', 'manual')),
  confidence numeric,
  merged_into uuid references grey.kg_entities(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists kg_entities_project_idx on grey.kg_entities(project_id) where deleted_at is null;
create index if not exists kg_entities_type_idx on grey.kg_entities(type_id) where deleted_at is null;
drop trigger if exists kg_entities_touch on grey.kg_entities;
create trigger kg_entities_touch before update on grey.kg_entities for each row execute function grey.touch_updated_at();
alter table grey.kg_entities enable row level security;
drop policy if exists kg_entities_member_all on grey.kg_entities;
create policy kg_entities_member_all on grey.kg_entities for all to authenticated
  using (grey.can_access_project(project_id)) with check (grey.can_access_project(project_id));

create table if not exists grey.kg_relations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  source_entity_id uuid not null references grey.kg_entities(id) on delete cascade,
  target_entity_id uuid not null references grey.kg_entities(id) on delete cascade,
  type_id uuid references grey.kg_types(id) on delete set null,
  valid_from timestamptz,
  valid_to timestamptz,
  confidence numeric,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists kg_relations_project_idx on grey.kg_relations(project_id) where deleted_at is null;
create index if not exists kg_relations_source_idx on grey.kg_relations(source_entity_id) where deleted_at is null;
create index if not exists kg_relations_target_idx on grey.kg_relations(target_entity_id) where deleted_at is null;
drop trigger if exists kg_relations_touch on grey.kg_relations;
create trigger kg_relations_touch before update on grey.kg_relations for each row execute function grey.touch_updated_at();
alter table grey.kg_relations enable row level security;
drop policy if exists kg_relations_member_all on grey.kg_relations;
create policy kg_relations_member_all on grey.kg_relations for all to authenticated
  using (grey.can_access_project(project_id)) with check (grey.can_access_project(project_id));

create table if not exists grey.kg_mentions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  entity_id uuid references grey.kg_entities(id) on delete cascade,
  relation_id uuid references grey.kg_relations(id) on delete cascade,
  source_id uuid references grey.sources(id) on delete cascade,
  chunk_id uuid references grey.chunks(id) on delete cascade,
  page integer,
  start_ms integer,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists kg_mentions_project_idx on grey.kg_mentions(project_id) where deleted_at is null;
create index if not exists kg_mentions_entity_idx on grey.kg_mentions(entity_id) where deleted_at is null;
create index if not exists kg_mentions_relation_idx on grey.kg_mentions(relation_id) where deleted_at is null;
create index if not exists kg_mentions_source_idx on grey.kg_mentions(source_id) where deleted_at is null;
drop trigger if exists kg_mentions_touch on grey.kg_mentions;
create trigger kg_mentions_touch before update on grey.kg_mentions for each row execute function grey.touch_updated_at();
alter table grey.kg_mentions enable row level security;
drop policy if exists kg_mentions_member_all on grey.kg_mentions;
create policy kg_mentions_member_all on grey.kg_mentions for all to authenticated
  using (grey.can_access_project(project_id)) with check (grey.can_access_project(project_id));

-- @down
drop table if exists grey.kg_mentions cascade;
drop table if exists grey.kg_relations cascade;
drop table if exists grey.kg_entities cascade;
drop table if exists grey.kg_types cascade;
