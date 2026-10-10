import { NAV_TREE } from "@/lib/workspace/nav_tree";

import { OverviewScreen } from "./overview/overview";
import { AllKnowledgeBasesScreen } from "./knowledge/all_knowledge_bases";
import { IngestionPresetsScreen } from "./knowledge/ingestion_presets";
import { SourcesScreen } from "./sources/sources";
import { IngestionJobsScreen } from "./sources/ingestion_jobs";
import { GraphExplorerScreen } from "./graph/graph_explorer";
import { EntitiesScreen } from "./graph/entities";
import { OntologyScreen } from "./graph/ontology";
import { ChatScreen } from "./playground/chat";
import { ConversationsScreen } from "./playground/conversations";
import { AllPipelinesScreen } from "./pipelines/all_pipelines";
import { ModelProvidersScreen } from "./pipelines/model_providers";
import { ApiKeysScreen } from "./delivery/api_keys";
import { McpServersScreen } from "./delivery/mcp_servers";
import { WidgetsScreen } from "./delivery/widgets";
import { EvaluationsScreen } from "./quality/evaluations";
import { FeedbackScreen } from "./quality/feedback";
import { UsageCostsScreen } from "./usage/usage_costs";
import { RequestLogsScreen } from "./usage/request_logs";
import { GeneralSettingsScreen } from "./settings/general";
import { TeamMembersScreen } from "./settings/team_members";
import { RolesPermissionsScreen } from "./settings/roles_permissions";
import { NavigationSettingsScreen } from "./settings/navigation_settings";
import { DataExportScreen } from "./settings/data_export";

// Nav title -> screen component; section titles resolve through firstSubItemOf.
export const SCREEN_REGISTRY = {
  Overview: OverviewScreen,
  "All Knowledge Bases": AllKnowledgeBasesScreen,
  Sources: SourcesScreen,
  "Ingestion Jobs": IngestionJobsScreen,
  "Ingestion Presets": IngestionPresetsScreen,
  "Graph Explorer": GraphExplorerScreen,
  Entities: EntitiesScreen,
  Ontology: OntologyScreen,
  Chat: ChatScreen,
  Conversations: ConversationsScreen,
  "All Pipelines": AllPipelinesScreen,
  "Model Providers": ModelProvidersScreen,
  "API Keys": ApiKeysScreen,
  "MCP Servers": McpServersScreen,
  Widgets: WidgetsScreen,
  Evaluations: EvaluationsScreen,
  Feedback: FeedbackScreen,
  "Usage & Costs": UsageCostsScreen,
  "Request Logs": RequestLogsScreen,
  General: GeneralSettingsScreen,
  "Team & Members": TeamMembersScreen,
  "Roles & Permissions": RolesPermissionsScreen,
  Navigation: NavigationSettingsScreen,
  "Data Export": DataExportScreen,
};

// Section title -> its first sub-item's title ("Knowledge Bases" -> "All Knowledge Bases").
export function firstSubItemOf(title) {
  const section = NAV_TREE.find((s) => s.title === title);
  return section?.subItems?.[0]?.title || null;
}

// A section title falls back to its first sub-item's screen; null renders ComingSoonScreen.
export function getScreen(title) {
  return SCREEN_REGISTRY[title] || SCREEN_REGISTRY[firstSubItemOf(title)] || null;
}

export default SCREEN_REGISTRY;
