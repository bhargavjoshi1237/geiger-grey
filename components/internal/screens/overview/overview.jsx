"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Circle,
  History,
  ListChecks,
  MessagesSquare,
  Plus,
  Upload,
} from "lucide-react";

import { MainScreenWrapper } from "@/components/internal/shared/screen_wrappers";
import {
  ScreenHeader,
  StatGrid,
  SectionCard,
  EmptyState,
  StatusPill,
} from "@/components/internal/shared/screen_kit";
import { Button } from "@geiger/ui/button";
import { Badge } from "@geiger/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@geiger/ui/tooltip";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@geiger/ui/table";
import { LoadingArea } from "@geiger/ui";
import { useProject } from "@/context/project-context";
import { useCan } from "@/context/rbac-context";
import { useWorkspaceUrl } from "@/lib/hooks/use-workspace-url";
import { listKnowledgeBases } from "@/lib/supabase/knowledge_bases";
import { listSources } from "@/lib/supabase/sources";
import { listEntities } from "@/lib/supabase/graph";
import { listJobs } from "@/lib/supabase/ingestion_jobs";
import { listConversations } from "@/lib/supabase/conversations";
import { listPipelines } from "@/lib/supabase/pipelines";
import { listProviders } from "@/lib/supabase/model_providers";
import { listApiKeys } from "@/lib/supabase/api_keys";
import { listUsageEvents } from "@/lib/supabase/usage";
import { getProjectSettings } from "@/lib/supabase/project_settings";
import { formatCurrency, formatRelative } from "@/lib/grey/format";

// Mirrors sources/constants JOB_STATUS_MAP (that module isn't owned by this
// task yet, so this is a local copy rather than an import).
const JOB_STATUS_MAP = {
  queued: { label: "Queued", variant: "neutral", dotClass: "bg-[#737373]" },
  running: { label: "Running", variant: "info", dotClass: "bg-sky-400" },
  succeeded: { label: "Succeeded", variant: "success", dotClass: "bg-emerald-400" },
  failed: { label: "Failed", variant: "danger", dotClass: "bg-red-400" },
  cancelled: { label: "Cancelled", variant: "neutral", dotClass: "bg-[#737373]" },
};

const CHECKLIST = [
  { key: "kb", label: "Create a knowledge base", tab: "All Knowledge Bases" },
  { key: "sources", label: "Upload sources", tab: "Sources" },
  { key: "pipeline", label: "Create a pipeline", tab: "All Pipelines" },
  { key: "provider", label: "Add a model provider", tab: "Model Providers" },
  { key: "apiKey", label: "Create an API key", tab: "API Keys" },
];

// A quick action that explains itself (via tooltip) instead of silently doing
// nothing when this account can't perform it.
function QuickAction({ canDo, onClick, icon: Icon, children, primary }) {
  const button = (
    <Button
      variant={primary ? undefined : "outline"}
      className={primary ? "bg-primary text-primary-foreground" : undefined}
      disabled={!canDo}
      onClick={onClick}
    >
      <Icon className="h-4 w-4" /> {children}
    </Button>
  );
  if (canDo) return button;
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span>{button}</span>
        </TooltipTrigger>
        <TooltipContent>You don&apos;t have permission for this.</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function OverviewScreen() {
  const { projectId } = useProject();
  const { setTab, openRecordInTab } = useWorkspaceUrl();
  const canCreateKb = useCan("grey.kb.manage");
  const canUploadSources = useCan("grey.source.upload");
  const canUsePlayground = useCan("grey.playground.view");

  const [loading, setLoading] = useState(true);
  const [knowledgeBases, setKnowledgeBases] = useState([]);
  const [sources, setSources] = useState([]);
  const [entities, setEntities] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [pipelines, setPipelines] = useState([]);
  const [providers, setProviders] = useState([]);
  const [apiKeys, setApiKeys] = useState([]);
  const [usageEvents, setUsageEvents] = useState([]);
  const [settings, setSettings] = useState(null);

  useEffect(() => {
    let alive = true;
    const now = new Date();
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const since = new Date(Math.min(sevenDaysAgo.getTime(), startOfMonth.getTime()));

    Promise.all([
      listKnowledgeBases(projectId),
      listSources(projectId),
      listEntities(projectId),
      listJobs(projectId),
      listConversations(projectId),
      listPipelines(projectId),
      listProviders(projectId),
      listApiKeys(projectId),
      listUsageEvents(projectId, { since: since.toISOString() }),
      getProjectSettings(projectId),
    ]).then(
      ([
        kbRows,
        sourceRows,
        entityRows,
        jobRows,
        conversationRows,
        pipelineRows,
        providerRows,
        apiKeyRows,
        usageRows,
        settingsRow,
      ]) => {
        if (!alive) return;
        setKnowledgeBases(kbRows ?? []);
        setSources(sourceRows ?? []);
        setEntities(entityRows ?? []);
        setJobs(jobRows ?? []);
        setConversations(conversationRows ?? []);
        setPipelines(pipelineRows ?? []);
        setProviders(providerRows ?? []);
        setApiKeys(apiKeyRows ?? []);
        setUsageEvents(usageRows ?? []);
        // null here means the settings read failed, not "no cap set" — the
        // stat below shows "—" rather than guessing.
        setSettings(settingsRow);
        setLoading(false);
      },
    );
    return () => {
      alive = false;
    };
  }, [projectId]);

  const kbById = useMemo(() => {
    const map = {};
    knowledgeBases.forEach((kb) => (map[kb.id] = kb));
    return map;
  }, [knowledgeBases]);

  const sourceById = useMemo(() => {
    const map = {};
    sources.forEach((s) => (map[s.id] = s));
    return map;
  }, [sources]);

  const pipelineById = useMemo(() => {
    const map = {};
    pipelines.forEach((p) => (map[p.id] = p));
    return map;
  }, [pipelines]);

  const stats = useMemo(() => {
    const now = new Date();
    const sevenDaysAgo = now.getTime() - 7 * 86400000;
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const queries7d = usageEvents.filter(
      (e) => e.kind === "retrieval" && new Date(e.occurredAt).getTime() >= sevenDaysAgo,
    ).length;
    const spendMonth = usageEvents
      .filter((e) => new Date(e.occurredAt).getTime() >= startOfMonth)
      .reduce((sum, e) => sum + (Number(e.cost) || 0), 0);
    const settingsError = settings === null;
    const cap = settings?.monthlySoftCap ? Number(settings.monthlySoftCap) : null;

    return [
      { label: "Knowledge bases", value: String(knowledgeBases.length) },
      { label: "Sources", value: String(sources.length) },
      { label: "Entities", value: String(entities.length) },
      { label: "Queries · 7d", value: String(queries7d) },
      {
        label: "Spend (MTD)",
        value: formatCurrency(spendMonth),
        hint: settingsError ? "—" : cap ? `of ${formatCurrency(cap)} cap` : "No soft cap set",
      },
    ];
  }, [knowledgeBases, sources, entities, usageEvents, settings]);

  const recentJobs = useMemo(() => jobs.slice(0, 5), [jobs]);
  const recentConversations = useMemo(() => conversations.slice(0, 5), [conversations]);

  const checklistState = useMemo(
    () => ({
      kb: knowledgeBases.length > 0,
      sources: sources.length > 0,
      pipeline: pipelines.length > 0,
      provider: providers.length > 0,
      apiKey: apiKeys.length > 0,
    }),
    [knowledgeBases, sources, pipelines, providers, apiKeys],
  );

  if (loading) {
    return (
      <MainScreenWrapper>
        <ScreenHeader title="Overview" description="Everything about this project's knowledge base, at a glance." />
        <LoadingArea label="Loading overview" />
      </MainScreenWrapper>
    );
  }

  return (
    <MainScreenWrapper>
      <ScreenHeader
        title="Overview"
        description="Everything about this project's knowledge base, at a glance."
      />

      <StatGrid stats={stats} columns={5} />

      <div className="flex flex-wrap items-center gap-2">
        <QuickAction canDo={canCreateKb} onClick={() => setTab("All Knowledge Bases")} icon={Plus} primary>
          New knowledge base
        </QuickAction>
        <QuickAction canDo={canUploadSources} onClick={() => setTab("Sources")} icon={Upload}>
          Upload sources
        </QuickAction>
        <QuickAction canDo={canUsePlayground} onClick={() => setTab("Chat")} icon={MessagesSquare}>
          Open playground
        </QuickAction>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SectionCard
          title="Recent ingestion jobs"
          action={
            <Button variant="ghost" size="sm" onClick={() => setTab("Ingestion Jobs")}>
              View all
            </Button>
          }
          bodyPadding={false}
        >
          {recentJobs.length === 0 ? (
            <EmptyState
              icon={ListChecks}
              title="No ingestion jobs yet"
              description="Jobs appear here once you upload sources to a knowledge base."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead className="px-4">Source</TableHead>
                  <TableHead className="px-4">Knowledge base</TableHead>
                  <TableHead className="px-4">Status</TableHead>
                  <TableHead className="px-4 text-right">Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentJobs.map((job) => (
                  <TableRow key={job.id} className="border-border">
                    <TableCell className="px-4 py-3 text-sm text-foreground">
                      {sourceById[job.sourceId]?.name || "—"}
                    </TableCell>
                    <TableCell className="px-4 py-3 text-sm text-text-secondary">
                      {kbById[job.kbId]?.name || "—"}
                    </TableCell>
                    <TableCell className="px-4 py-3">
                      <StatusPill status={job.status} map={JOB_STATUS_MAP} />
                    </TableCell>
                    <TableCell className="px-4 py-3 text-right text-xs text-text-tertiary">
                      {job.createdAt ? formatRelative(new Date(job.createdAt)) : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </SectionCard>

        <SectionCard
          title="Recent conversations"
          action={
            <Button variant="ghost" size="sm" onClick={() => setTab("Conversations")}>
              View all
            </Button>
          }
          bodyPadding={false}
        >
          {recentConversations.length === 0 ? (
            <EmptyState
              icon={History}
              title="No conversations yet"
              description="Ask something in the Playground to start one."
            />
          ) : (
            <Table>
              <TableBody>
                {recentConversations.map((c) => (
                  <TableRow
                    key={c.id}
                    className="cursor-pointer border-border"
                    onClick={() => openRecordInTab("Conversations", "conversation", c.id)}
                  >
                    <TableCell className="px-4 py-3">
                      <p className="truncate text-sm font-medium text-foreground">
                        {c.title || "Untitled conversation"}
                      </p>
                      <p className="text-xs text-text-tertiary">
                        {pipelineById[c.pipelineId]?.name || "No pipeline"} · {c.channel}
                      </p>
                    </TableCell>
                    <TableCell className="px-4 py-3 text-right text-xs text-text-tertiary">
                      {c.createdAt ? formatRelative(new Date(c.createdAt)) : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </SectionCard>
      </div>

      <SectionCard
        title="Setup checklist"
        description="Get this project from empty to answering questions."
      >
        <ol className="divide-y divide-border">
          {CHECKLIST.map((item) => {
            const done = checklistState[item.key];
            const Icon = done ? CheckCircle2 : Circle;
            return (
              <li key={item.key} className="flex items-center justify-between gap-3 py-3">
                <div className="flex min-w-0 items-center gap-2.5">
                  <Icon className="h-4 w-4 shrink-0 text-text-tertiary" />
                  <span className={done ? "text-sm text-text-secondary line-through" : "text-sm text-foreground"}>
                    {item.label}
                  </span>
                </div>
                {done ? (
                  <Badge variant="success">Done</Badge>
                ) : (
                  <Button variant="ghost" size="sm" onClick={() => setTab(item.tab)}>
                    Go
                  </Button>
                )}
              </li>
            );
          })}
        </ol>
      </SectionCard>
    </MainScreenWrapper>
  );
}

export default OverviewScreen;
