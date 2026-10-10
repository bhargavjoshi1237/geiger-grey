// Data access for grey.model_providers — provider configs; secrets and connection tests go through server routes.
import { apiFetch } from "@/lib/api";
import { makeRepo } from "./repository";

const columns = ["name", "provider", "baseUrl", "secretId", "keyLast4", "status", "lastCheckedAt", "models", "metadata"];

const repo = makeRepo({ table: "model_providers", columns });

export const listProviders = (projectId) => repo.list(projectId);
export const createProvider = (projectId, input) => repo.create(projectId, input);
export const updateProvider = (id, patch) => repo.update(id, patch);
export const deleteProvider = (id) => repo.remove(id);

// Stores the provider's API key server-side (Vault) and records its last 4 chars.
export const saveProviderSecret = (id, secret) =>
  apiFetch(`/providers/${id}/secret`, { method: "POST", body: { secret } });

// Verifies the stored secret still works and refreshes the provider's status.
export const testProvider = (id) => apiFetch(`/providers/${id}/test`, { method: "POST" });

// Built-in hosted option offered alongside configured providers — needs no row or secret.
export const GREY_HOSTED_PROVIDER = {
  id: "grey-hosted",
  name: "Grey hosted",
  provider: "grey_hosted",
  status: "ok",
  models: ["grey-fast", "grey-balanced", "grey-deep"],
  builtIn: true,
};
