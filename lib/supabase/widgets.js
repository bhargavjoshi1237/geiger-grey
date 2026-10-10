// Data access for grey.widgets — embeddable chat widget configs.
import { makeRepo } from "./repository";

const columns = ["name", "pipelineId", "apiKeyId", "allowedDomains", "theme", "whiteLabel", "status", "metadata"];

const repo = makeRepo({ table: "widgets", columns });

export const listWidgets = (projectId) => repo.list(projectId);
export const createWidget = (projectId, input) => repo.create(projectId, input);
export const updateWidget = (id, patch) => repo.update(id, patch);
export const deleteWidget = (id) => repo.remove(id);
