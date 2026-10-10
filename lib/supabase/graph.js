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
  const dedupedDuplicateIds = [...new Set(duplicateIds)];
  if (dedupedDuplicateIds.includes(canonicalId)) return false;
  try {
    const sb = createClient();
    const { data: rows, error: fetchError } = await sb
      .from(ENTITIES)
      .select("id, name, aliases")
      .eq("project_id", projectId)
      .is("deleted_at", null)
      .in("id", [canonicalId, ...dedupedDuplicateIds]);
    if (fetchError) {
      console.error("[graph.mergeEntities]", "fetch", fetchError);
      return false;
    }

    const canonical = rows?.find((r) => r.id === canonicalId);
    const duplicates = rows?.filter((r) => dedupedDuplicateIds.includes(r.id)) || [];
    if (!canonical || duplicates.length !== dedupedDuplicateIds.length) return false;

    // Not transactional (no cross-table RPC) — ordered so a partial failure leaves the graph consistent:
    // relations/mentions are re-pointed first, and the duplicates themselves stay live (still readable,
    // still pointed at by nothing stale) until the very last step soft-deletes them.
    const { error: sourceError } = await sb
      .from(RELATIONS)
      .update({ source_entity_id: canonicalId })
      .eq("project_id", projectId)
      .in("source_entity_id", dedupedDuplicateIds);
    if (sourceError) {
      console.error("[graph.mergeEntities]", "repoint relation sources", sourceError);
      return false;
    }

    const { error: targetError } = await sb
      .from(RELATIONS)
      .update({ target_entity_id: canonicalId })
      .eq("project_id", projectId)
      .in("target_entity_id", dedupedDuplicateIds);
    if (targetError) {
      console.error("[graph.mergeEntities]", "repoint relation targets", targetError);
      return false;
    }

    const { error: mentionError } = await sb
      .from(MENTIONS)
      .update({ entity_id: canonicalId })
      .eq("project_id", projectId)
      .in("entity_id", dedupedDuplicateIds);
    if (mentionError) {
      console.error("[graph.mergeEntities]", "repoint mentions", mentionError);
      return false;
    }

    // Relations that used to run between two duplicates (or a duplicate and the canonical itself) now
    // loop on the canonical entity at both ends — a meaningless self-relation, so drop it.
    const { error: selfLoopError } = await sb
      .from(RELATIONS)
      .update({ deleted_at: new Date().toISOString() }) // fixed column — merge-induced soft delete, not user input
      .eq("project_id", projectId)
      .eq("source_entity_id", canonicalId)
      .eq("target_entity_id", canonicalId);
    if (selfLoopError) {
      console.error("[graph.mergeEntities]", "drop self-loop relations", selfLoopError);
      return false;
    }

    const canonicalNameLower = (canonical.name || "").toLowerCase();
    const mergedAliases = [
      ...new Map(
        [...(canonical.aliases || []), ...duplicates.flatMap((d) => [d.name, ...(d.aliases || [])])]
          .filter(Boolean)
          .filter((alias) => alias.toLowerCase() !== canonicalNameLower)
          .map((alias) => [alias.toLowerCase(), alias]), // case-insensitive dedupe, first spelling wins
      ).values(),
    ];

    const { error: canonicalError } = await sb
      .from(ENTITIES)
      .update({ aliases: mergedAliases }) // fixed column — the only field a merge ever changes on the canonical row
      .eq("project_id", projectId)
      .eq("id", canonicalId);
    if (canonicalError) {
      console.error("[graph.mergeEntities]", "update canonical aliases", canonicalError);
      return false;
    }

    const { error: deleteError } = await sb
      .from(ENTITIES)
      .update({ merged_into: canonicalId, deleted_at: new Date().toISOString() }) // fixed columns — merge finalization
      .eq("project_id", projectId)
      .in("id", dedupedDuplicateIds);
    if (deleteError) {
      console.error("[graph.mergeEntities]", "soft-delete duplicates", deleteError);
      return false;
    }

    return true;
  } catch (error) {
    console.error("[graph.mergeEntities]", "unexpected", error);
    return false;
  }
}
