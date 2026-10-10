import rbacConfig, { navPermissionKey, navSlug } from "@/geiger-rbac.config";
import { parentSectionOf } from "@/lib/workspace/tabs";

export { navPermissionKey, navSlug };

export const WORKSPACE_PERMISSIONS = rbacConfig.permissions.map((p) => ({
  key: p.key,
  label: p.label,
  group: p.group,
  scopeBy: p.scopeBy,
  conditionText: p.conditionText,
}));

export const ALL_PERMISSION_KEYS = WORKSPACE_PERMISSIONS.map((p) => p.key);

export const SYSTEM_ROLE_SEED = rbacConfig.systemRoles;

export function normalizeRoleId(value) {
  return navSlug(value);
}

// A sub-item has no view permission of its own — it is gated by its parent
// section's view key (e.g. "Entities" -> navPermissionKey("Knowledge Graph")).
export function tabPermissionKey(title) {
  return navPermissionKey(parentSectionOf(title) || title);
}

export function getRoleById(roles, roleId) {
  return roles?.find((role) => role.id === roleId) || null;
}

// WORKSPACE_PERMISSIONS grouped by `group`, preserving first-seen order. Powers
// the permission matrix (one SettingRow per key, one section per group).
export const PERMISSION_GROUPS = (() => {
  const order = [];
  const byGroup = new Map();
  for (const perm of WORKSPACE_PERMISSIONS) {
    if (!byGroup.has(perm.group)) {
      byGroup.set(perm.group, []);
      order.push(perm.group);
    }
    byGroup.get(perm.group).push(perm);
  }
  return order.map((group) => ({ group, permissions: byGroup.get(group) }));
})();
