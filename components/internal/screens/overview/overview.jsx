"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Database, Workflow } from "lucide-react";

import { MainScreenWrapper } from "@/components/internal/shared/screen_wrappers";
import { RollingNumber, StatsBar } from "@/components/internal/shared/screen_kit";
import { freshnessOf } from "@/components/internal/screens/sources/constants";
import { cn } from "@/lib/utils";
import { useProject } from "@/context/project-context";
import { listKnowledgeBases } from "@/lib/supabase/knowledge_bases";
import { listSources } from "@/lib/supabase/sources";
import { listJobs } from "@/lib/supabase/ingestion_jobs";
import { listConversations, listFeedbackMessages } from "@/lib/supabase/conversations";
import { listPipelines } from "@/lib/supabase/pipelines";
import { listProviders } from "@/lib/supabase/model_providers";
import { listRequestLogStats, listUsageEvents } from "@/lib/supabase/usage";
import { formatCurrency } from "@/lib/grey/format";
import {
  buildWeeklyBuckets,
  filterByScope,
  periodDelta,
  periodWindows,
  ratePct,
  sumInWindow,
} from "@/lib/grey/overview_metrics";
import { ATTENTION_META, PERIOD_DAYS, TREND_WEEKS } from "./constants";
import {
  ActivityTrendWidget,
  ChannelMixWidget,
  GaugeWidget,
  IngestionFunnelWidget,
} from "./charts";
import { TopPipelinesTable } from "./top_pipelines";
import { AttentionCard } from "./attention_card";

const count = (n) => n.toLocaleString("en-US");
const plural = (n, word) => `${count(n)} ${word}${n === 1 ? "" : "s"}`;

export function OverviewScreen() {
  const { projectId } = useProject();

  const [knowledgeBases, setKnowledgeBases] = useState([]);
  const [sources, setSources] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [pipelines, setPipelines] = useState([]);
  const [providers, setProviders] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [logs, setLogs] = useState([]);
  const [usageEvents, setUsageEvents] = useState([]);
  const [feedback, setFeedback] = useState([]);
  const [loading, setLoading] = useState(true);
  // Every window on the page is measured from this instant, so figures stay
  // consistent with each other between renders.
  const [asOf, setAsOf] = useState(() => Date.now());

  useEffect(() => {
    let alive = true;
    const now = Date.now();
    const { prevStart } = periodWindows(now, PERIOD_DAYS);
    const logsSince = Math.min(buildWeeklyBuckets(TREND_WEEKS, now)[0].getTime(), prevStart);

    Promise.all([
      listKnowledgeBases(projectId),
      listSources(projectId),
      listJobs(projectId),
      listPipelines(projectId),
      listProviders(projectId),
      listConversations(projectId),
      listRequestLogStats(projectId, { since: new Date(logsSince).toISOString() }),
      listUsageEvents(projectId, { since: new Date(prevStart).toISOString() }),
      listFeedbackMessages(projectId),
    ]).then(([kb, src, job, pipe, prov, conv, log, usage, fb]) => {
      if (!alive) return;
      setKnowledgeBases(kb ?? []);
      setSources(src ?? []);
      setJobs(job ?? []);
      setPipelines(pipe ?? []);
      setProviders(prov ?? []);
      setConversations(conv ?? []);
      setLogs(log ?? []);
      setUsageEvents(usage ?? []);
      setFeedback(fb ?? []);
      setAsOf(Date.now());
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [projectId]);

  const workspaceSummary = useMemo(() => {
    const chunks = sources.reduce((sum, s) => sum + (s.chunkCount || 0), 0);
    return [
      { label: "Knowledge Bases", value: count(knowledgeBases.length) },
      { label: "Sources", value: count(sources.length) },
      { label: "Chunks", value: count(chunks) },
    ];
  }, [knowledgeBases, sources]);

  const stats = useMemo(() => {
    const { curStart, prevStart } = periodWindows(asOf, PERIOD_DAYS);
    const one = () => 1;
    const stat = (label, rows, dateKey, valueFn, format) => {
      const current = sumInWindow(rows, dateKey, valueFn, curStart);
      const previous = sumInWindow(rows, dateKey, valueFn, prevStart, curStart);
      return {
        label: `${label} · ${PERIOD_DAYS}d`,
        value: format(current),
        ...periodDelta(current, previous),
        footer: "VS Last Period",
      };
    };
    return [
      stat("Queries", logs, "createdAt", one, count),
      stat("Spend", usageEvents, "occurredAt", (e) => Number(e.cost) || 0, formatCurrency),
      stat("Sources Added", sources, "createdAt", one, count),
      stat("Conversations", conversations, "createdAt", one, count),
    ];
  }, [asOf, logs, usageEvents, sources, conversations]);

  const funnelStages = useMemo(
    () => [
      { key: "added", label: "Sources added", short: "Added", value: sources.length },
      {
        key: "processed",
        label: "Processed",
        short: "Processed",
        value: sources.filter((s) => s.status === "ready").length,
      },
      {
        key: "indexed",
        label: "Indexed into chunks",
        short: "Indexed",
        value: sources.filter((s) => (s.chunkCount || 0) > 0).length,
      },
      {
        key: "verified",
        label: "Verified fresh",
        short: "Verified",
        value: sources.filter((s) => freshnessOf(s) === "verified").length,
      },
    ],
    [sources],
  );

  const ingestionSuccessCompute = useCallback(
    (kbIds) => {
      const finished = filterByScope(jobs, kbIds, "kbId").filter(
        (j) => j.status === "succeeded" || j.status === "failed",
      );
      const succeeded = finished.filter((j) => j.status === "succeeded").length;
      return {
        pct: ratePct(succeeded, finished.length),
        footnote: `${count(succeeded)} of ${count(finished.length)} Jobs Succeeded`,
      };
    },
    [jobs],
  );

  const answerRateCompute = useCallback(
    (pipelineIds) => {
      const scoped = filterByScope(logs, pipelineIds, "pipelineId");
      const answered = scoped.filter((l) => l.status === "ok").length;
      return {
        pct: ratePct(answered, scoped.length),
        footnote: `${count(answered)} of ${count(scoped.length)} Queries Answered`,
      };
    },
    [logs],
  );

  const attentionItems = useMemo(() => {
    const failed = sources.filter((s) => s.status === "failed");
    const failedKbs = new Set(failed.map((s) => s.kbId)).size;
    const providerErrors = providers.filter((p) => p.status === "error").length;
    const open = feedback.filter((m) => !m.metadata?.resolved);
    const unanswered = open.filter((m) => m.unanswered).length;
    const unhelpful = open.filter((m) => m.feedback === "down").length;
    const freshness = sources.map(freshnessOf);
    const stale = freshness.filter((f) => f === "stale").length;
    const reviewDue = stale + freshness.filter((f) => f === "review_due").length;
    const drafts = pipelines.filter((p) => p.status !== "live").length;

    const item = (key, value, hint) => ({ key, ...ATTENTION_META[key], value: count(value), hint });
    return [
      item("failedSources", failed.length, failedKbs ? `Across ${plural(failedKbs, "knowledge base")}` : "Nothing failing"),
      item("providerErrors", providerErrors, providerErrors ? "Last connection test failed" : "All connections healthy"),
      item("unanswered", unanswered, "No grounded answer found"),
      item("unhelpful", unhelpful, "Rated thumbs down, unresolved"),
      item("reviewDue", reviewDue, stale ? `${count(stale)} past due` : "Due within 7 days"),
      item("draftPipelines", drafts, "Not yet published live"),
    ];
  }, [sources, providers, feedback, pipelines]);

  // No skeleton: the page lays out immediately with every figure at zero and
  // fills in once the fetch lands. Widgets that would otherwise state "nothing
  // here" get `pending` while the data is in flight so they don't jump to a verdict.
  return (
    <MainScreenWrapper>
      <div className="mt-2">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
          <div>
            <div className="flex w-full items-center justify-center gap-3 text-center md:w-auto md:justify-start md:text-left">
              <h1 className="text-2xl font-bold text-foreground dark:text-white tracking-tight">
                Knowledge Overview
              </h1>
            </div>
            <p className="mt-1 text-center text-sm text-muted-foreground md:text-left">
              Track ingestion, queries, answer quality and spend across your knowledge bases.
            </p>
          </div>
          <div className="w-full md:w-auto">
            <div className="flex w-full md:w-auto md:gap-0">
              {workspaceSummary.map((stat, i) => {
                const last = i === workspaceSummary.length - 1;
                return (
                  <div
                    key={stat.label}
                    className={cn(
                      "flex flex-1 flex-col items-center md:flex-none",
                      i === 0 && "md:pr-8",
                      i > 0 && "border-l border-border",
                      i > 0 && !last && "md:px-8",
                      last && i > 0 && "md:pl-8",
                    )}
                  >
                    <span className="text-text-secondary text-[11px] uppercase tracking-wider font-medium">
                      {stat.label}
                    </span>
                    <RollingNumber
                      value={stat.value}
                      className="mt-0.5 text-2xl font-bold text-foreground dark:text-white"
                    />
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <StatsBar stats={stats} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 h-[360px]">
          <ActivityTrendWidget pending={loading} asOf={asOf} pipelines={pipelines} logs={logs} />
        </div>
        <div className="h-[360px]">
          <ChannelMixWidget pending={loading} logs={logs} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="h-[300px]">
          <IngestionFunnelWidget
            stages={funnelStages}
            headlineKey="indexed"
            headlineCaption="added → indexed"
          />
        </div>
        <div className="h-[300px]">
          <GaugeWidget
            title="Ingestion Success"
            subtitle="Jobs succeeded vs. finished."
            caption="Succeeded"
            scope={{
              items: knowledgeBases,
              icon: Database,
              allLabel: "All Knowledge Bases",
              noun: "knowledge base",
            }}
            compute={ingestionSuccessCompute}
          />
        </div>
        <div className="h-[300px]">
          <GaugeWidget
            title="Answer Rate"
            subtitle={`Answered vs. received, last ${TREND_WEEKS} weeks.`}
            caption="Answered"
            scope={{
              items: pipelines,
              icon: Workflow,
              allLabel: "All Pipelines",
              noun: "pipeline",
            }}
            compute={answerRateCompute}
          />
        </div>
      </div>

      <TopPipelinesTable
        pending={loading}
        asOf={asOf}
        pipelines={pipelines}
        knowledgeBases={knowledgeBases}
        logs={logs}
      />

      <AttentionCard items={attentionItems} />
    </MainScreenWrapper>
  );
}

export default OverviewScreen;
