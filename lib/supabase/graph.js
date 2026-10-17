// Data access for grey.kg_types, grey.kg_entities, grey.kg_relations, grey.kg_mentions — the knowledge graph.
import { createClient } from "./client";
import { isSupabaseConfigured } from "./config";
import { toCamel, makeRepo } from "./repository";

const TYPES = "kg_types";
const ENTITIES = "kg_entities";
const RELATIONS = "kg_relations";
const MENTIONS = "kg_mentions";

const typeColumns = ["kind", "name", "color", "description", "isDefault", "metadata"];
const entityColumns = ["typeId", "name", "aliases", "description", "properties", "sourceApp", "confidence", "mergedInto", "metadata"];
const relationColumns = ["sourceEntityId", "targetEntityId", "typeId", "validFrom", "validTo", "confidence", "metadata"];
const mentionColumns = ["entityId", "relationId", "sourceId", "chunkId", "page", "startMs", "metadata"];

const typeRepo = makeRepo({ table: TYPES, columns: typeColumns });
const entityRepo = makeRepo({ table: ENTITIES, columns: entityColumns });
const relationRepo = makeRepo({ table: RELATIONS, columns: relationColumns });
const mentionRepo = makeRepo({ table: MENTIONS, columns: mentionColumns });

export const listTypes = (projectId) => typeRepo.list(projectId);
export const createType = (projectId, input) => typeRepo.create(projectId, input);
export const updateType = (id, patch) => typeRepo.update(id, patch);
export const deleteType = (id) => typeRepo.remove(id);

// Seeds the default ontology (entity + relation types) for a project on first load — a no-op once
// seeded — and returns the project's types. Seeding runs in SQL (grey.ensure_default_ontology, under an
// advisory lock) so the graph screens and the worker can't race each other into duplicate defaults.
export async function ensureDefaultOntology(projectId) {
  if (!isSupabaseConfigured() || !projectId) return [];
  try {
    const { data, error } = await createClient().rpc("ensure_default_ontology", { p_project: projectId });
    if (error) throw error;
    return (data || []).map(toCamel);
  } catch (error) {
    console.error("[graph.ensureDefaultOntology]", error);
    return listTypes(projectId);
  }
}

export const listEntities = (projectId) => entityRepo.list(projectId);

// Live entities by id, fetched in chunks so a long id list never overflows the request URL.
const IDS_PER_REQUEST = 100;
export async function listEntitiesByIds(projectId, ids = []) {
  const unique = [...new Set((ids || []).filter(Boolean))];
  if (!projectId || !unique.length) return [];
  const batches = [];
  for (let i = 0; i < unique.length; i += IDS_PER_REQUEST) batches.push(unique.slice(i, i + IDS_PER_REQUEST));
  const results = await Promise.all(batches.map((batch) => entityRepo.list(projectId, { id: batch })));
  return results.flat();
}

export const createEntity = (projectId, input) => entityRepo.create(projectId, input);
export const updateEntity = (id, patch) => entityRepo.update(id, patch);
export const deleteEntity = (id) => entityRepo.remove(id);

export const listRelations = (projectId) => relationRepo.list(projectId);
export const createRelation = (projectId, input) => relationRepo.create(projectId, input);
export const deleteRelation = (id) => relationRepo.remove(id);

// Mentions of the project, optionally narrowed to one entity and/or one source.
export const listMentions = (projectId, { entityId, sourceId } = {}) => mentionRepo.list(projectId, { entityId, sourceId });

// Folds duplicate entities into a canonical one in a single transaction (grey.kg_merge_entities, which
// checks project access + grey.graph.edit): duplicate mentions of the same chunk collapse to one, relations
// and mentions move to the canonical entity, relations that become self-loops or duplicates are dropped,
// the duplicates' names and aliases become the canonical's aliases, and the duplicates are soft-deleted
// with merged_into set. Returns true on success, false on any failure (never throws).
export async function mergeEntities(projectId, { canonicalId, duplicateIds } = {}) {
  if (!isSupabaseConfigured() || !projectId || !canonicalId || !duplicateIds?.length) return false;
  const dedupedDuplicateIds = [...new Set(duplicateIds)];
  if (dedupedDuplicateIds.includes(canonicalId)) return false;
  try {
    const { error } = await createClient().rpc("kg_merge_entities", {
      p_project: projectId,
      p_canonical: canonicalId,
      p_duplicates: dedupedDuplicateIds,
    });
    if (error) throw error;
    return true;
  } catch (error) {
    console.error("[graph.mergeEntities]", error);
    return false;
  }
}
