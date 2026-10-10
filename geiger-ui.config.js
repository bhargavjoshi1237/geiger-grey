import { defineNavConfig } from "@geiger/ui";

export default defineNavConfig({
  product: "grey",
  locked: ["Overview", "Knowledge Bases", "All Knowledge Bases", "Settings", "Navigation"],
  hiddenByDefault: [],
  dependencies: [
    { screen: "Knowledge Graph", requires: ["Knowledge Bases"], reason: "The graph is extracted from knowledge base sources." },
    { screen: "Playground", requires: ["Pipelines"], reason: "Chat runs through a pipeline." },
    { screen: "Evaluations", requires: ["Pipelines"], reason: "Evaluations score a pipeline version." },
    { screen: "Request Logs", requires: ["Pipelines"] },
    { screen: "MCP Servers", requires: ["API Keys"], reason: "MCP clients authenticate with an API key." },
    { screen: "Widgets", requires: ["API Keys"], reason: "Widgets call Grey with a publishable API key." },
  ],
});
