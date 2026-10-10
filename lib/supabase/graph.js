// Data access for grey.kg_types, grey.kg_entities, grey.kg_relations, grey.kg_mentions — the knowledge graph.
import { createClient } from "./client";
import { isSupabaseConfigured } from "./config";
import { toCamel, toSnakeRow, makeRepo } from "./repository";

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

const DEFAULT_ENTITY_TYPES = ["Person", "Organization", "Product", "Location", "Event", "Concept", "Document", "Other"];
const DEFAULT_RELATION_TYPES = ["works_at", "part_of", "mentions", "related_to", "located_in", "created"];

// Seeds the default ontology (entity + relation types) for a project on first load; a no-op once seeded.
export async function ensureDefaultOntology(projectId) {
  if (!isSupabaseConfigured() || !projectId) return [];
  try {
    const existing = await listTypes(projectId);
    if (existing.some((t) => t.isDefault)) return existing;
    const defaults = [
      ...DEFAULT_ENTITY_TYPES.map((name, i) => ({ kind: "entity", name, color: `chart-${(i % 5) + 1}`, isDefault: true })),
      ...DEFAULT_RELATION_TYPES.map((name, i) => ({ kind: "relation", name, color: `chart-${(i % 5) + 1}`, isDefault: true })),
    ];
    const rows = defaults.map((d) => ({ ...toSnakeRow(d, typeColumns), project_id: projectId }));
    const { data, error } = await createClient().from(TYPES).insert(rows).select("*");
    if (error) throw error;
    return [...existing, ...(data || []).map(toCamel)];
  } catch (error) {
    console.error("[graph.ensureDefaultOntology]", error);
    return [];
  }
}

export const listEntities = (projectId) => entityRepo.list(projectId);
export const createEntity = (projectId, input) => entityRepo.create(projectId, input);
export const updateEntity = (id, patch) => entityRepo.update(id, patch);
export const deleteEntity = (id) => entityRepo.remove(id);

export const listRelations = (projectId) => relationRepo.list(projectId);
export const createRelation = (projectId, input) => relationRepo.create(projectId, input);
export const deleteRelation = (id) => relationRepo.remove(id);

export const listMentions = (projectId, { entityId } = {}) => mentionRepo.list(projectId, { entityId });

// Folds duplicate entities into a canonical one: unions aliases (plus the duplicates' own names) onto the
// canonical entity, re-points every relation and mention that referenced a duplicate, then soft-deletes the
// duplicates and marks their merged_into. Returns true on success, false on any failure (never throws).
export async function mergeEntities(projectId, { canonicalId, duplicateIds } = {}) {
  if (!isSupabaseConfigured() || !projectId || !canonicalId || !duplicateIds?.length) return false;
  try {
    const sb = createClient();
    const { data: rows, error: fetchError } = await sb
      .from(ENTITIES)
      .select("id, name, aliases")
      .eq("project_id", projectId)
      .in("id", [canonicalId, ...duplicateIds]);
    if (fetchError) throw fetchError;

    const canonical = rows?.find((r) => r.id === canonicalId);
    if (!canonical) throw new Error("canonical entity not found");
    const duplicates = rows?.filter((r) => duplicateIds.includes(r.id)) || [];
    const mergedAliases = [
      ...new Set([...(canonical.aliases || []), ...duplicates.flatMap((d) => [d.name, ...(d.aliases || [])])].filter(Boolean)),
    ];

    const { error: canonicalError } = await sb.from(ENTITIES).update({ aliases: mergedAliases }).eq("id", canonicalId);
    if (canonicalError) throw canonicalError;

    const { error: sourceError } = await sb.from(RELATIONS).update({ source_entity_id: canonicalId }).in("source_entity_id", duplicateIds);
    if (sourceError) throw sourceError;
    const { error: targetError } = await sb.from(RELATIONS).update({ target_entity_id: canonicalId }).in("target_entity_id", duplicateIds);
    if (targetError) throw targetError;
    const { error: mentionError } = await sb.from(MENTIONS).update({ entity_id: canonicalId }).in("entity_id", duplicateIds);
    if (mentionError) throw mentionError;

    const { error: deleteError } = await sb
      .from(ENTITIES)
      .update({ merged_into: canonicalId, deleted_at: new Date().toISOString() })
      .in("id", duplicateIds);
    if (deleteError) throw deleteError;

    return true;
  } catch (error) {
    console.error("[graph.mergeEntities]", error);
    return false;
  }
}
