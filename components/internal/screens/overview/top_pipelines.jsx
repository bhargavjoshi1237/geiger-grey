"use client";

import { useMemo, useState } from "react";
import { ArrowUpRight, Database, Workflow } from "lucide-react";
import { Button } from "@geiger/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@geiger/ui/table";

import { EmptyState, StatusPill } from "@/components/internal/shared/screen_kit";
import FilterDropdown from "@/components/internal/shared/filter_dropdown";
import { PIPELINE_STATUS_MAP } from "@/components/internal/screens/pipelines/constants";
import { useWorkspaceUrl } from "@/lib/hooks/use-workspace-url";
import { cn } from "@/lib/utils";
import { formatLatency } from "@/lib/grey/format";
import { periodWindows, ratePct, trafficTrend } from "@/lib/grey/overview_metrics";
import { PERIOD_DAYS, TOP_PIPELINES_SORT_OPTIONS, TRAFFIC_TREND_META } from "./constants";
import { ScopeSelect, WidgetHeader } from "./widget_kit";

// Per-pipeline traffic for the current and previous period, in one pass over the logs.
function pipelineTraffic(logs, asOf) {
  const { curStart, prevStart } = periodWindows(asOf, PERIOD_DAYS);
  const byPipeline = new Map();
  for (const log of logs) {
    if (!log.pipelineId) continue;
    const t = new Date(log.createdAt).getTime();
    if (!Number.isFinite(t) || t < prevStart) continue;
    let entry = byPipeline.get(log.pipelineId);
    if (!entry) {
      entry = { queries: 0, answered: 0, latencySum: 0, latencyCount: 0, previous: 0 };
      byPipeline.set(log.pipelineId, entry);
    }
    if (t < curStart) {
      entry.previous += 1;
      continue;
    }
    entry.queries += 1;
    if (log.status === "ok") entry.answered += 1;
    if (Number.isFinite(log.latencyMs)) {
      entry.latencySum += log.latencyMs;
      entry.latencyCount += 1;
    }
  }
  return byPipeline;
}

export function TopPipelinesTable({ pending, asOf, pipelines, knowledgeBases, logs }) {
  const [sortBy, setSortBy] = useState("queries");
  const [kbScope, setKbScope] = useState([]);
  const { openRecordInTab } = useWorkspaceUrl();

  const traffic = useMemo(() => pipelineTraffic(logs, asOf), [logs, asOf]);

  const rows = useMemo(() => {
    const scoped = kbScope.length
      ? pipelines.filter((p) => (p.kbIds || []).some((id) => kbScope.includes(id)))
      : pipelines;
    return scoped.map((p) => {
      const t = traffic.get(p.id);
      const queries = t?.queries || 0;
      return {
        id: p.id,
        name: p.name || "Untitled pipeline",
        model: p.model,
        status: p.status || "draft",
        queries,
        answered: t?.answered || 0,
        answerRate: ratePct(t?.answered || 0, queries),
        avgLatency: t?.latencyCount ? t.latencySum / t.latencyCount : null,
        trend: trafficTrend(queries, t?.previous || 0),
      };
    });
  }, [pipelines, traffic, kbScope]);

  const sorted = [...rows]
    .sort((a, b) =>
      sortBy === "queries" ? b.queries - a.queries : b.answerRate - a.answerRate || b.queries - a.queries,
    )
    .slice(0, 5);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <WidgetHeader
          title="Top Pipelines"
          subtitle={`Ranked by query volume and answer rate, last ${PERIOD_DAYS} days.`}
        />
        <div className="flex items-center gap-2">
          <ScopeSelect
            items={knowledgeBases}
            selected={kbScope}
            onChange={setKbScope}
            icon={Database}
            allLabel="All Knowledge Bases"
            noun="knowledge base"
          />
          <FilterDropdown
            value={sortBy}
            onValueChange={setSortBy}
            options={TOP_PIPELINES_SORT_OPTIONS}
            height="h-9"
          />
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-surface-card">
        {/* Mid-fetch the table keeps its header and no rows, rather than
            declaring the project has no pipelines. */}
        {sorted.length === 0 && !pending ? (
          <EmptyState
            icon={Workflow}
            title="No pipelines yet"
            description="Create a pipeline to see it ranked here."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="border-border">
                <TableHead>Pipeline</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-[180px]">Answer rate</TableHead>
                <TableHead className="text-right">Queries</TableHead>
                <TableHead>Trend</TableHead>
                <TableHead className="text-right"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((pipeline) => {
                const meta = TRAFFIC_TREND_META[pipeline.trend];
                const TrendIcon = meta.icon;
                return (
                  <TableRow key={pipeline.id} className="border-border">
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <span className="font-medium text-foreground">{pipeline.name}</span>
                        <p className="text-xs text-text-secondary">
                          {pipeline.model || "No model"}
                          {pipeline.avgLatency ? ` · ${formatLatency(pipeline.avgLatency)} avg` : ""}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <StatusPill status={pipeline.status} map={PIPELINE_STATUS_MAP} />
                    </TableCell>
                    <TableCell>
                      <div className="w-[140px] space-y-1.5">
                        <div className="h-1.5 overflow-hidden rounded-full bg-surface-hover">
                          <div
                            className="h-full rounded-full bg-foreground dark:bg-[#ededed]"
                            style={{ width: `${pipeline.answerRate}%` }}
                          />
                        </div>
                        <p className="text-xs text-text-secondary">
                          {pipeline.queries ? `${pipeline.answerRate}%` : "—"}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums text-foreground dark:text-white">
                      {pipeline.queries.toLocaleString("en-US")}
                    </TableCell>
                    <TableCell>
                      <span className={cn("inline-flex items-center gap-1.5 font-medium", meta.className)}>
                        <TrendIcon className="h-3.5 w-3.5" />
                        {meta.label}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={`Open ${pipeline.name}`}
                        className="text-muted-foreground hover:bg-surface-active hover:text-foreground"
                        onClick={() => openRecordInTab("All Pipelines", "pipeline", pipeline.id)}
                      >
                        <ArrowUpRight className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
