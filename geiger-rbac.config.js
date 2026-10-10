import { defineRbacConfig, defineRole } from "@geiger/rbac";

export function navSlug(title) {
  return String(title || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function navPermissionKey(title) {
  return `grey.${navSlug(title)}.view`;
}

export const NAV_SECTIONS = [
  "Overview",
  "Knowledge Bases",
  "Knowledge Graph",
  "Playground",
  "Pipelines",
  "Delivery",
  "Quality",
  "Usage",
  "Settings",
];

const viewPermissions = NAV_SECTIONS.map((title) => ({
  key: navPermissionKey(title),
  label: title,
  group: "Workspace views",
}));

const actionPermissions = [
  { key: "grey.kb.manage", label: "Manage knowledge bases", group: "Knowledge" },
  { key: "grey.source.upload", label: "Upload sources", group: "Knowledge" },
  { key: "grey.source.delete", label: "Delete sources", group: "Knowledge" },
  { key: "grey.ingestion.run", label: "Run ingestion jobs", group: "Knowledge" },
  { key: "grey.preset.manage", label: "Manage ingestion presets", group: "Knowledge" },

  { key: "grey.graph.edit", label: "Edit the knowledge graph", group: "Graph" },
  { key: "grey.ontology.manage", label: "Manage the ontology", group: "Graph" },

  { key: "grey.pipeline.manage", label: "Manage pipelines", group: "Pipelines & delivery" },
  { key: "grey.pipeline.publish", label: "Publish pipelines", group: "Pipelines & delivery" },
  { key: "grey.provider.manage", label: "Manage model providers", group: "Pipelines & delivery" },
  { key: "grey.apikey.manage", label: "Manage API keys", group: "Pipelines & delivery" },
  { key: "grey.mcp.manage", label: "Manage MCP servers", group: "Pipelines & delivery" },
  { key: "grey.widget.manage", label: "Manage widgets", group: "Pipelines & delivery" },

  { key: "grey.eval.manage", label: "Manage evaluations", group: "Quality & usage" },
  { key: "grey.usage.manage", label: "Manage usage & costs", group: "Quality & usage" },
  { key: "grey.export.run", label: "Run data exports", group: "Quality & usage" },

  { key: "grey.team.invite", label: "Invite team members", group: "Team control" },
  { key: "grey.team.assign", label: "Assign roles to members", group: "Team control" },
  { key: "grey.role.manage", label: "Create and edit roles", group: "Team control" },

  { key: "grey.settings.manage", label: "Manage workspace settings", group: "Administration" },
];

const permissions = [...viewPermissions, ...actionPermissions];

const viewKeys = viewPermissions.map((p) => p.key);
const allKeys = permissions.map((p) => p.key);

const systemRoles = [
  defineRole({
    key: "owner",
    name: "Owner",
    description: "Full access to everything in the workspace.",
    color: "violet",
    permissions: ["*"],
    sort: 0,
  }),
  defineRole({
    key: "admin",
    name: "Admin",
    description: "Manage the whole workspace, team and roles.",
    color: "blue",
    permissions: allKeys,
    sort: 1,
  }),
  defineRole({
    key: "manager",
    name: "Manager",
    description: "Run knowledge bases, the graph and pipelines; can't manage roles, providers or delivery keys.",
    color: "emerald",
    permissions: [
      ...viewKeys,
      "grey.kb.manage",
      "grey.source.upload",
      "grey.source.delete",
      "grey.ingestion.run",
      "grey.preset.manage",
      "grey.graph.edit",
      "grey.ontology.manage",
      "grey.pipeline.manage",
      "grey.pipeline.publish",
      "grey.eval.manage",
      "grey.export.run",
      "grey.team.invite",
    ],
    sort: 2,
  }),
  defineRole({
    key: "member",
    name: "Member",
    description: "Day-to-day access: upload sources, run ingestion, edit the graph, run evaluations.",
    color: "amber",
    permissions: [
      ...viewKeys.filter((k) => k !== navPermissionKey("Settings")),
      "grey.source.upload",
      "grey.ingestion.run",
      "grey.graph.edit",
      "grey.eval.manage",
    ],
    sort: 3,
  }),
  defineRole({
    key: "viewer",
    name: "Viewer",
    description: "Read-only access to the overview, knowledge bases, knowledge graph and playground.",
    color: "slate",
    permissions: [
      navPermissionKey("Overview"),
      navPermissionKey("Knowledge Bases"),
      navPermissionKey("Knowledge Graph"),
      navPermissionKey("Playground"),
    ],
    sort: 4,
  }),
];

export default defineRbacConfig({
  product: "grey",
  permissions,
  systemRoles,
});
