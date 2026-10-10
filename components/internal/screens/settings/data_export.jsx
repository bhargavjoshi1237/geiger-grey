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
//
// Every loader returns { data, issues }: `issues` is a list of plain-English
// strings describing anything that came back short or failed, so the caller
// can toast a warning instead of a false "exported" success.

const CHUNK_PAGE_SIZE = 1000;
const MESSAGE_FETCH_CONCURRENCY = 5;

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

// Runs `fn` over `items` with at most `limit` in flight at once, instead of
// firing every request at the same time (unbounded Promise.all) — this one
// also tolerates a per-item throw instead of losing the whole export to it.
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await fn(items[index], index);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return results;
}

// Pages through every chunk rather than trusting one call's pageSize — and
// reports when fewer rows came back than the table says it has, instead of
// silently exporting a partial set as if it were everything.
async function fetchAllChunks(projectId) {
  let rows = [];
  let count = 0;
  let page = 1;
  // Bounded so a wrong/stuck `count` can't loop forever.
  const maxPages = 1000;
  while (page <= maxPages) {
    const result = await listChunks(projectId, { page, pageSize: CHUNK_PAGE_SIZE });
    const pageRows = result?.rows ?? [];
    count = result?.count ?? count;
    rows = rows.concat(pageRows);
    if (pageRows.length < CHUNK_PAGE_SIZE) break;
    if (count && rows.length >= count) break;
    page += 1;
  }
  const complete = count === 0 || rows.length >= count;
  return { rows, count, complete };
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
      return { data: { knowledgeBases: knowledgeBases ?? [], sources: sources ?? [] }, issues: [] };
    },
  },
  {
    key: "chunks",
    icon: Layers,
    title: "Chunks",
    description: "The chunk text, ordinal and position produced by ingestion.",
    filename: "grey-chunks.json",
    load: async (projectId) => {
      const { rows, count, complete } = await fetchAllChunks(projectId);
      const issues = complete ? [] : [`only fetched ${rows.length} of ${count} chunks`];
      return { data: { chunks: rows }, issues };
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
        data: {
          types: types ?? [],
          entities: entities ?? [],
          relations: relations ?? [],
          mentions: mentions ?? [],
        },
        issues: [],
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
      const issues = [];
      const withMessages = await mapWithConcurrency(
        conversations,
        MESSAGE_FETCH_CONCURRENCY,
        async (c) => {
          try {
            return { ...c, messages: (await listMessages(c.id)) ?? [] };
          } catch (error) {
            console.error("[data_export.conversations]", error);
            issues.push(`messages for "${c.title || c.id}" failed to load`);
            return { ...c, messages: [], messagesFailed: true };
          }
        },
      );
      return { data: { conversations: withMessages }, issues };
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
      return { data: { evalSets: withCases }, issues: [] };
    },
  },
];

function ExportCard({ card, canExport, busy, onExport }) {
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
              <TooltipContent>Needs the &quot;Run data exports&quot; permission.</TooltipContent>
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
      const { data, issues } = await card.load(projectId);
      downloadJson(card.filename, data);
      if (issues.length) {
        toast.warning(`${card.title} exported, but ${issues.join("; ")}.`);
      } else {
        toast.success(`${card.title} exported`);
      }
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
      const sections = await Promise.all(CARDS.map((card) => card.load(projectId)));
      const combined = Object.fromEntries(CARDS.map((card, i) => [card.key, sections[i].data]));
      const allIssues = CARDS.flatMap((card, i) =>
        sections[i].issues.map((msg) => `${card.title}: ${msg}`),
      );
      downloadJson("grey-full-export.json", combined);
      if (allIssues.length) {
        toast.warning(`Full export downloaded, but some parts are incomplete: ${allIssues.join("; ")}.`);
      } else {
        toast.success("Full export downloaded");
      }
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
                <TooltipContent>Needs the &quot;Run data exports&quot; permission.</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )
        }
      />

      <div className="grid gap-4 sm:grid-cols-2">
        {CARDS.map((card) => (
          <ExportCard key={card.key} card={card} canExport={canExport} busy={busy} onExport={runExport} />
        ))}
      </div>
    </MainScreenWrapper>
  );
}

export default DataExportScreen;
