// Data access for grey.model_providers — provider configs; secrets and connection tests go through server routes.
import { apiFetch } from "@/lib/api";
import { makeRepo } from "./repository";

// Writable columns only. secret_id and key_last4 are still read (select *) but written solely by
// grey.set_provider_secret through the secret route — the model_providers_secret_guard trigger
// ignores client writes to them.
const columns = ["name", "provider", "baseUrl", "status", "lastCheckedAt", "models", "metadata"];

const repo = makeRepo({ table: "model_providers", columns });

export const listProviders = (projectId) => repo.list(projectId);
export const createProvider = (projectId, input) => repo.create(projectId, input);
export const updateProvider = (id, patch) => repo.update(id, patch);
export const deleteProvider = (id) => repo.remove(id);

// Stores the provider's API key server-side (Vault), records its last 4 chars and runs the
// connection test right away -> { ok, keyLast4, status, provider }.
export const saveProviderSecret = (id, secret) =>
  apiFetch(`/providers/${id}/secret`, { method: "POST", body: { secret } });

// One minimal real call per capability; refreshes status, lastCheckedAt and metadata.lastError.
export const testProvider = (id) => apiFetch(`/providers/${id}/test`, { method: "POST" });

// Grey hosted stays switched off until Grey runs its own model accounts (spec §4.4):
// while false it's left out of every provider option list.
export { GREY_HOSTED_ENABLED } from "@/lib/grey/provider_kinds";

// Built-in hosted option offered alongside configured providers — needs no row or secret.
export const GREY_HOSTED_PROVIDER = {
  id: "grey-hosted",
  name: "Grey hosted",
  provider: "grey_hosted",
  status: "ok",
  models: ["grey-fast", "grey-balanced", "grey-deep"],
  builtIn: true,
};
