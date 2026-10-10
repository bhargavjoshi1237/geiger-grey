// Data access for grey.knowledge_bases — project-scoped KB records (plain CRUD).
import { makeRepo } from "./repository";

const columns = [
  "name",
  "description",
  "icon",
  "status",
  "presetId",
  "embeddingModel",
  "chunkConfig",
  "retrievalDefaults",
  "metadata",
];

const repo = makeRepo({ table: "knowledge_bases", columns });

export const listKnowledgeBases = (projectId) => repo.list(projectId);
export const getKnowledgeBase = (id) => repo.get(id);
export const createKnowledgeBase = (projectId, input) => repo.create(projectId, input);
export const updateKnowledgeBase = (id, patch) => repo.update(id, patch);
export const deleteKnowledgeBase = (id) => repo.remove(id);
