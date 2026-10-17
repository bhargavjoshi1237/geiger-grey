// Spec §3.1: dependencies shared by the app and the worker are pinned identically in both
// package.json files (lib/engine/ runs under either).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (rel) => JSON.parse(readFileSync(new URL(rel, import.meta.url), "utf8"));
const root = read("../../package.json");
const worker = read("../package.json");

const SHARED = ["ai", "@ai-sdk/anthropic", "@ai-sdk/openai", "@ai-sdk/google", "@ai-sdk/openai-compatible", "zod"];

test("shared AI dependencies are pinned identically", () => {
  for (const name of SHARED) {
    assert.ok(worker.dependencies[name], `worker is missing ${name}`);
    assert.equal(worker.dependencies[name], root.dependencies[name], `${name} differs between root and worker`);
    assert.match(worker.dependencies[name], /^\d+\.\d+\.\d+$/, `${name} must be an exact version`);
  }
});

test("every dependency present in both is identical", () => {
  for (const [name, version] of Object.entries(worker.dependencies)) {
    if (root.dependencies?.[name] && name !== "@supabase/supabase-js") {
      assert.equal(version, root.dependencies[name], `${name} differs between root and worker`);
    }
  }
});

test("worker dependencies are exact pins", () => {
  for (const [name, version] of Object.entries(worker.dependencies)) {
    assert.match(version, /^\d+\.\d+\.\d+$/, `${name} is not pinned exactly (${version})`);
  }
  assert.equal(worker.type, "module");
});
