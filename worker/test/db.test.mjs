// worker/db.mjs TLS configuration (WORKER_DATABASE_CA) and statement shapes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { insertStagedChunks, poolConfig, readCa } from "../db.mjs";

const REMOTE = "postgresql://u:p@aws-0-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require";
const PEM = "-----BEGIN CERTIFICATE-----\nMIIBfake\n-----END CERTIFICATE-----\n";

test("a CA given inline (with \\n escapes) verifies the server certificate", () => {
  const cfg = poolConfig(REMOTE, { ca: PEM.replace(/\n/g, "\\n") });
  assert.deepEqual(cfg.ssl, { ca: PEM, rejectUnauthorized: true });
  assert.ok(!cfg.connectionString.includes("sslmode"));
});

test("a CA given as a file path is read from disk", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "grey-ca-"));
  try {
    const file = path.join(dir, "ca.pem");
    await writeFile(file, PEM);
    assert.deepEqual(poolConfig(REMOTE, { ca: file }).ssl, { ca: PEM, rejectUnauthorized: true });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("an unreadable CA file fails loudly instead of silently skipping verification", () => {
  assert.throws(() => readCa(path.join(os.tmpdir(), "grey-missing-ca.pem")), /WORKER_DATABASE_CA/);
});

test("without a CA, TLS stays on but unverified; local databases skip TLS", () => {
  assert.deepEqual(poolConfig(REMOTE, { ca: "" }).ssl, { rejectUnauthorized: false });
  assert.equal(poolConfig("postgresql://u:p@localhost:54322/postgres", { ca: PEM }).ssl, false);
  assert.equal(readCa(undefined), null);
});

test("staged chunks write modality: image for image chunks, text for everything else", async () => {
  const queries = [];
  const db = { query: async (sql, values) => (queries.push({ sql, values }), { rowCount: 2 }) };
  const rows = [
    { ordinal: 0, content: "A pump.", modality: "image", metadata: { image: { dhash: "0" } }, embedding: "[1]", embedding_dims: 1, embedding_model: "m" },
    { ordinal: 1, content: "Text.", embedding: "[1]", embedding_dims: 1, embedding_model: "m" },
  ];
  assert.equal(await insertStagedChunks(db, { projectId: "p1", kbId: "k1", sourceId: "s1", jobId: "j1", rows }), 2);
  const [{ sql, values }] = queries;
  const columns = /insert into grey\.chunks \(([^)]+)\)/.exec(sql)[1].split(", ");
  assert.equal(columns.at(-1), "modality");
  assert.equal(values.length, columns.length * 2);
  assert.equal(values[columns.length - 1], "image");
  assert.equal(values[columns.length * 2 - 1], "text");
  assert.match(sql, /on conflict \(job_id, ordinal\) where state = 'staged' do nothing/);
});
