import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluate } from "@geiger/rbac";
import config, { navPermissionKey } from "./geiger-rbac.config.js";

const roles = config.systemRoles.map((r, i) => ({ id: `r${i}`, key: r.key, permissions: r.permissions }));
const decide = (roleKey, key) => {
  const role = roles.find((r) => r.key === roleKey);
  return evaluate(key, { config, roles, grants: [{ roleId: role.id, scope: {}, status: "active" }], actorId: "u1" }).allowed;
};

test("owner can do everything", () => {
  for (const p of config.permissions) assert.ok(decide("owner", p.key), p.key);
});
test("viewer is read-only", () => {
  assert.ok(decide("viewer", navPermissionKey("Knowledge Graph")));
  assert.equal(decide("viewer", "grey.kb.manage"), false);
  assert.equal(decide("viewer", navPermissionKey("Settings")), false);
});
test("member can upload but not manage pipelines or roles", () => {
  assert.ok(decide("member", "grey.source.upload"));
  assert.equal(decide("member", "grey.pipeline.manage"), false);
  assert.equal(decide("member", "grey.role.manage"), false);
});
test("manager cannot manage roles or providers", () => {
  assert.ok(decide("manager", "grey.pipeline.publish"));
  assert.equal(decide("manager", "grey.role.manage"), false);
  assert.equal(decide("manager", "grey.provider.manage"), false);
});
