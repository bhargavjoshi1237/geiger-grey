import { test } from "node:test";
import assert from "node:assert/strict";
import { isTransactionPooler, readConfig } from "../env.mjs";
import { poolConfig } from "../db.mjs";

const base = {
  WORKER_DATABASE_URL: "postgresql://u:p@aws-0-eu.pooler.supabase.com:5432/postgres?sslmode=require",
  NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service",
};

test("defaults and required variables", () => {
  const cfg = readConfig(base);
  assert.deepEqual(cfg.missing, []);
  assert.equal(cfg.concurrency, 2);
  assert.equal(cfg.maxPerProject, 2);
  assert.equal(cfg.leaseSeconds, 120);
  assert.equal(cfg.pollMs, 5000);
  assert.equal(cfg.maxMediaMinutes, 600);
  assert.equal(cfg.listen, true);
  assert.equal(cfg.ocrUrl, "");
  assert.ok(cfg.workerId);
  assert.deepEqual(readConfig({}).missing, ["WORKER_DATABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]);
});

test("overrides are clamped and the Assets URL is normalised", () => {
  const cfg = readConfig({ ...base, WORKER_CONCURRENCY: "99", WORKER_POLL_MS: "10", ASSETS_INTERNAL_URL: "https://suite.test/assets/", GREY_MAX_MEDIA_MINUTES: "30" });
  assert.equal(cfg.concurrency, 32);
  assert.equal(cfg.pollMs, 250);
  assert.equal(cfg.assetsUrl, "https://suite.test/assets");
  assert.equal(cfg.maxMediaMinutes, 30);
});

test("the transaction pooler disables LISTEN", () => {
  assert.equal(isTransactionPooler("postgresql://u:p@host:6543/postgres"), true);
  assert.equal(readConfig({ ...base, WORKER_DATABASE_URL: "postgresql://u:p@host:6543/postgres" }).listen, false);
});

test("pool config strips sslmode and uses TLS without CA verification remotely", () => {
  const cfg = poolConfig(base.WORKER_DATABASE_URL);
  assert.ok(!cfg.connectionString.includes("sslmode"));
  assert.deepEqual(cfg.ssl, { rejectUnauthorized: false });
  assert.equal(poolConfig("postgresql://u:p@localhost:54322/postgres").ssl, false);
});
