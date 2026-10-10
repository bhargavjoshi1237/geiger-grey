"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  Database,
  Download,
  Layers,
  Loader2,
  MessageSquare,
  Network,
  Package,
} from "lucide-react";

import { MainScreenWrapper } from "@/components/internal/shared/screen_wrappers";
import { ScreenHeader, SectionCard } from "@/components/internal/shared/screen_kit";
import { Button } from "@geiger/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@geiger/ui/tooltip";
import { useProject } from "@/context/project-context";
import { useCan } from "@/context/rbac-context";
import { listKnowledgeBases } from "@/lib/supabase/knowledge_bases";
import { listSources } from "@/lib/supabase/sources";
import { listChunks } from "@/lib/supabase/chunks";
import { listTypes, listEntities, listRelations, listMentions } from "@/lib/supabase/graph";
import { listConversations, listMessages } from "@/lib/supabase/conversations";
import { listEvalSets, listEvalCases } from "@/lib/supabase/evals";

// Settings → Data Export. Every card builds its own JSON client-side and
// downloads it via a Blob — there is no server-side export job in this phase.
// "Full export" runs every card's loader and downloads one combined file.

function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const CARDS = [
  {
    key: "knowledge",
    icon: Database,
    title: "Knowledge bases & sources",
    description: "Every knowledge base and its source metadata (no file contents).",
    filename: "grey-knowledge-bases.json",
    load: async (projectId) => {
      const [knowledgeBases, sources] = await Promise.all([
        listKnowledgeBases(projectId),
        listSources(projectId),
      ]);
      return { knowledgeBases: knowledgeBases ?? [], sources: sources ?? [] };
    },
  },
  {
    key: "chunks",
    icon: Layers,
    title: "Chunks",
    description: "The chunk text, ordinal and position produced by ingestion.",
    filename: "grey-chunks.json",
    load: async (projectId) => {
      const { rows } = await listChunks(projectId, { page: 1, pageSize: 10000 });
      return { chunks: rows ?? [] };
    },
  },
  {
    key: "graph",
    icon: Network,
    title: "Knowledge graph",
    description: "Entity and relation types, entities, relations and mentions.",
    filename: "grey-graph.json",
    load: async (projectId) => {
      const [types, entities, relations, mentions] = await Promise.all([
        listTypes(projectId),
        listEntities(projectId),
        listRelations(projectId),
        listMentions(projectId, {}),
      ]);
      return {
        types: types ?? [],
        entities: entities ?? [],
        relations: relations ?? [],
        mentions: mentions ?? [],
      };
    },
  },
  {
    key: "conversations",
    icon: MessageSquare,
    title: "Conversations",
    description: "Playground, widget and API conversations with their messages.",
    filename: "grey-conversations.json",
    load: async (projectId) => {
      const conversations = (await listConversations(projectId)) ?? [];
      const withMessages = await Promise.all(
        conversations.map(async (c) => ({
          ...c,
          messages: (await listMessages(c.id)) ?? [],
        })),
      );
      return { conversations: withMessages };
    },
  },
  {
    key: "evals",
    icon: Package,
    title: "Eval sets",
    description: "Evaluation sets and their test cases.",
    filename: "grey-eval-sets.json",
    load: async (projectId) => {
      const sets = (await listEvalSets(projectId)) ?? [];
      const withCases = await Promise.all(
        sets.map(async (s) => ({
          ...s,
          cases: (await listEvalCases(projectId, s.id)) ?? [],
        })),
      );
      return { evalSets: withCases };
    },
  },
];

function ExportCard({ card, projectId, canExport, busy, onExport }) {
  const Icon = card.icon;
  const isBusy = busy === card.key;

  const button = (
    <Button
      variant="outline"
      size="sm"
      disabled={!canExport || Boolean(busy)}
      onClick={() => onExport(card)}
    >
      {isBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
      Export
    </Button>
  );

  return (
    <SectionCard>
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-card text-muted-foreground">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">{card.title}</p>
          <p className="mt-0.5 text-xs text-text-secondary">{card.description}</p>
        </div>
      </div>
      <div className="mt-4 flex justify-end">
        {canExport ? (
          button
        ) : (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span>{button}</span>
              </TooltipTrigger>
              <TooltipContent>Needs the Export data permission.</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>
    </SectionCard>
  );
}

export function DataExportScreen() {
  const { projectId } = useProject();
  const canExport = useCan("grey.export.run");
  const [busy, setBusy] = useState(null);

  const runExport = async (card) => {
    setBusy(card.key);
    try {
      const data = await card.load(projectId);
      downloadJson(card.filename, data);
      toast.success(`${card.title} exported`);
    } catch (error) {
      console.error("[data_export.export]", error);
      toast.error(`Couldn't export ${card.title.toLowerCase()}.`);
    } finally {
      setBusy(null);
    }
  };

  const runFullExport = async () => {
    setBusy("full");
    try {
      const sections = await Promise.all(
        CARDS.map(async (card) => [card.key, await card.load(projectId)]),
      );
      downloadJson("grey-full-export.json", Object.fromEntries(sections));
      toast.success("Full export downloaded");
    } catch (error) {
      console.error("[data_export.full]", error);
      toast.error("Couldn't build the full export.");
    } finally {
      setBusy(null);
    }
  };

  const fullExportButton = (
    <Button
      onClick={runFullExport}
      disabled={!canExport || Boolean(busy)}
      className="bg-primary text-primary-foreground"
    >
      {busy === "full" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
      Full export
    </Button>
  );

  return (
    <MainScreenWrapper>
      <ScreenHeader
        title="Data Export"
        description="Download this project's data as JSON. There is no server-side export job yet — everything is built in your browser."
        actions={
          canExport ? (
            fullExportButton
          ) : (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>{fullExportButton}</span>
                </TooltipTrigger>
                <TooltipContent>Needs the Export data permission.</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )
        }
      />

      <div className="grid gap-4 sm:grid-cols-2">
        {CARDS.map((card) => (
          <ExportCard
            key={card.key}
            card={card}
            projectId={projectId}
            canExport={canExport}
            busy={busy}
            onExport={runExport}
          />
        ))}
      </div>
    </MainScreenWrapper>
  );
}

export default DataExportScreen;
