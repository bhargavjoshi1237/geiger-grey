// Shared option lists and status maps for the Playground area (Chat + Conversations).
import { Globe, MessageCircle, Puzzle } from "lucide-react";

export const CHANNEL_MAP = {
  playground: { label: "Playground", icon: MessageCircle, variant: "neutral" },
  widget: { label: "Widget", icon: Globe, variant: "info" },
  api: { label: "API", icon: Puzzle, variant: "purple" },
};

export const CHANNEL_FILTER_OPTIONS = [
  { value: "all", label: "All channels" },
  { value: "playground", label: "Playground" },
  { value: "widget", label: "Widget" },
  { value: "api", label: "API" },
];

export const EXAMPLE_QUESTIONS = [
  "What sources are in this knowledge base?",
  "Summarize what's been ingested so far.",
  "What are the most frequently mentioned entities?",
];

export function pipelineOptions(pipelines = []) {
  return [
    { value: "all", label: "All pipelines" },
    ...pipelines.map((p) => ({ value: p.id, label: p.name })),
  ];
}
