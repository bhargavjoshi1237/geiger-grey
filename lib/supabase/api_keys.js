// Data access for grey.api_keys — creation is server-side (hash + one-time plaintext); the rest is plain CRUD.
import { apiFetch } from "@/lib/api";
import { makeRepo } from "./repository";

const columns = [
  "name",
  "prefix",
  "scopes",
  "pipelineIds",
  "rateLimitPerMin",
  "lastUsedAt",
  "expiresAt",
  "revokedAt",
  "metadata",
];

// Explicit columns so key_hash never reaches the browser.
const SELECT =
  "id,project_id,name,prefix,scopes,pipeline_ids,rate_limit_per_min,last_used_at,expires_at,revoked_at,metadata,created_by,created_at,updated_at";

const repo = makeRepo({ table: "api_keys", columns, select: SELECT });

export const listApiKeys = (projectId) => repo.list(projectId);

// Server generates and hashes the key; returns { key, record } with the plaintext key once.
export const createApiKey = (projectId, input) =>
  apiFetch("/api-keys", { method: "POST", body: { projectId, ...input } });

export const revokeApiKey = (id) => repo.update(id, { revokedAt: new Date().toISOString() });
export const deleteApiKey = (id) => repo.remove(id);
export const updateApiKey = (id, patch) => repo.update(id, patch);
