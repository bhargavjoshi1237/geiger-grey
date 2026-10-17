// Worker configuration from the environment (spec §5.6). No AI provider keys here — they come
// from Vault per project at call time. Local / private provider base URLs (Ollama, vLLM) are
// refused unless GREY_ALLOW_LOCAL_PROVIDERS=1 (or NODE_ENV=development); the engine reads that
// at call time (localProvidersAllowed in lib/grey/url_guard.js).
import os from "node:os";
import { randomUUID } from "node:crypto";

const int = (value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

export const REQUIRED_ENV = ["WORKER_DATABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];

// The transaction pooler (port 6543) can't LISTEN; the worker then falls back to polling.
export function isTransactionPooler(url) {
  try {
    return new URL(url).port === "6543";
  } catch {
    return false;
  }
}

export function readConfig(env = process.env) {
  const missing = REQUIRED_ENV.filter((name) => !String(env[name] || "").trim());
  const databaseUrl = String(env.WORKER_DATABASE_URL || "").trim();
  return {
    missing,
    databaseUrl,
    supabaseUrl: String(env.NEXT_PUBLIC_SUPABASE_URL || "").trim(),
    serviceRoleKey: String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim(),
    workerId: String(env.WORKER_ID || "").trim() || `${os.hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`,
    concurrency: int(env.WORKER_CONCURRENCY, 2, { max: 32 }),
    maxPerProject: int(env.WORKER_MAX_PER_PROJECT, 2, { max: 32 }),
    leaseSeconds: int(env.WORKER_LEASE_SECONDS, 120, { min: 30, max: 3600 }),
    evalLeaseSeconds: int(env.WORKER_EVAL_LEASE_SECONDS, 300, { min: 30, max: 3600 }),
    pollMs: int(env.WORKER_POLL_MS, 5000, { min: 250, max: 600_000 }),
    healthPort: int(env.PORT || env.WORKER_HEALTH_PORT, 8080, { min: 0, max: 65535 }),
    listen: !isTransactionPooler(databaseUrl),
    assetsUrl: String(env.ASSETS_INTERNAL_URL || "").trim().replace(/\/+$/, ""),
    internalToken: String(env.GEIGER_INTERNAL_TOKEN || "").trim(),
    maxMediaMinutes: int(env.GREY_MAX_MEDIA_MINUTES, 600, { min: 1, max: 100_000 }),
    ocrUrl: String(env.GREY_OCR_URL || "").trim(),
  };
}
