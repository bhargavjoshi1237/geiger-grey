"use client";

import { useEffect, useMemo, useState } from "react";
import { ExternalLink, ScrollText } from "lucide-react";

import { MainScreenWrapper } from "@/components/internal/shared/screen_wrappers";
import {
  ScreenHeader,
  DataTable,
  EmptyState,
  StatusPill,
  Toolbar,
} from "@/components/internal/shared/screen_kit";
import FilterDropdown from "@/components/internal/shared/filter_dropdown";
import { Button } from "@geiger/ui/button";
import { Badge } from "@geiger/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@geiger/ui/sheet";
import { LoadingArea } from "@geiger/ui";
import { usePagination, ListPagination } from "@/components/internal/shared/pagination";
import { useProject } from "@/context/project-context";
import { useWorkspaceUrl } from "@/lib/hooks/use-workspace-url";
import { listRequestLogs } from "@/lib/supabase/usage";
import { listPipelines } from "@/lib/supabase/pipelines";
import { listSources } from "@/lib/supabase/sources";
import { formatCurrency, formatNumber } from "@/lib/grey/format";
import { CHANNEL_FILTER_OPTIONS, CHANNEL_LABELS, REQUEST_STATUS_FILTER_OPTIONS, REQUEST_STATUS_MAP } from "./constants";

const VIA_LABELS = { vector: "Vector", text: "Text", hybrid: "Hybrid", graph: "Graph" };

// Retrieval arm(s) that surfaced a chunk; fused results join their arms ("vector+text").
function viaLabel(via) {
  if (!via) return null;
  return via.includes("+") ? VIA_LABELS.hybrid : VIA_LABELS[via] || via;
}

function formatScore(score) {
  return typeof score === "number" && Number.isFinite(score) ? score.toFixed(3) : "—";
}

export function RequestLogsScreen() {
  const { projectId } = useProject();
  const { openRecordInTab } = useWorkspaceUrl();

  const [loading, setLoading] = useState(true);
  const [logs, setLogs] = useState([]);
  const [pipelines, setPipelines] = useState([]);
  const [sources, setSources] = useState([]);
  const [channelFilter, setChannelFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [pipelineFilter, setPipelineFilter] = useState("all");
  const [openLogId, setOpenLogId] = useState(null);

  useEffect(() => {
    let alive = true;
    Promise.all([listRequestLogs(projectId), listPipelines(projectId), listSources(projectId)]).then(
      ([logRows, pipelineRows, sourceRows]) => {
        if (!alive) return;
        setLogs(logRows ?? []);
        setPipelines(pipelineRows ?? []);
        setSources(sourceRows ?? []);
        setLoading(false);
      },
    );
    return () => {
      alive = false;
    };
  }, [projectId]);

  const pipelineById = useMemo(() => {
    const map = {};
    pipelines.forEach((p) => (map[p.id] = p));
    return map;
  }, [pipelines]);

  // request_logs.retrieved keeps ids only (never chunk content), so names come from the live sources.
  const sourceNameById = useMemo(() => {
    const map = {};
    sources.forEach((s) => (map[s.id] = s.name || "Untitled source"));
    return map;
  }, [sources]);

  const filtered = useMemo(() => {
    return logs.filter((l) => {
      if (channelFilter !== "all" && l.channel !== channelFilter) return false;
      if (statusFilter !== "all" && l.status !== statusFilter) return false;
      if (pipelineFilter !== "all" && l.pipelineId !== pipelineFilter) return false;
      return true;
    });
  }, [logs, channelFilter, statusFilter, pipelineFilter]);

  const { pageItems, ...pagination } = usePagination(filtered, {
    resetKey: `${channelFilter}:${statusFilter}:${pipelineFilter}`,
  });

  const openLog = useMemo(
    () => logs.find((l) => l.id === openLogId) || null,
    [logs, openLogId],
  );

  const pipelineFilterOptions = [
    { value: "all", label: "All Pipelines" },
    ...pipelines.map((p) => ({ value: p.id, label: p.name })),
  ];

  const clearFilters = () => {
    setChannelFilter("all");
    setStatusFilter("all");
    setPipelineFilter("all");
  };
  const filtersActive = channelFilter !== "all" || statusFilter !== "all" || pipelineFilter !== "all";

  const columns = [
    {
      key: "time",
      header: "Time",
      render: (l) => (
        <span className="whitespace-nowrap text-xs text-text-secondary">
          {l.createdAt ? new Date(l.createdAt).toLocaleString() : "—"}
        </span>
      ),
    },
    {
      key: "channel",
      header: "Channel",
      render: (l) => (
        <Badge variant="neutral">{CHANNEL_LABELS[l.channel] || l.channel || "—"}</Badge>
      ),
    },
    {
      key: "pipeline",
      header: "Pipeline",
      render: (l) => (
        <span className="text-sm text-foreground">
          {pipelineById[l.pipelineId]?.name || "—"}
        </span>
      ),
    },
    {
      key: "query",
      header: "Query",
      render: (l) => (
        <span className="block max-w-[320px] truncate text-sm text-foreground">
          {l.query || "—"}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (l) => <StatusPill status={l.status} map={REQUEST_STATUS_MAP} />,
    },
    {
      key: "latency",
      header: "Latency",
      render: (l) => (
        <span className="text-xs tabular-nums text-text-secondary">
          {l.latencyMs ? `${formatNumber(l.latencyMs)}ms` : "—"}
        </span>
      ),
    },
    {
      key: "tokens",
      header: "Tokens",
      render: (l) => (
        <span className="text-xs tabular-nums text-text-secondary">
          {formatNumber((l.tokensIn || 0) + (l.tokensOut || 0))}
        </span>
      ),
    },
    {
      key: "cost",
      header: "Cost",
      align: "right",
      render: (l) => (
        <span className="text-right text-sm font-medium tabular-nums text-foreground">
          {formatCurrency(l.cost || 0, { precise: true })}
        </span>
      ),
    },
  ];

  if (loading) {
    return (
      <MainScreenWrapper>
        <ScreenHeader title="Request Logs" description="Every query served through a pipeline, API key or the playground." />
        <LoadingArea label="Loading request logs" />
      </MainScreenWrapper>
    );
  }

  return (
    <MainScreenWrapper>
      <ScreenHeader
        title="Request Logs"
        description="Every query served through a pipeline, API key or the playground."
      />

      <Toolbar>
        <div className="flex flex-wrap items-center gap-2">
          <FilterDropdown
            value={channelFilter}
            onValueChange={setChannelFilter}
            options={CHANNEL_FILTER_OPTIONS}
            placeholder="All Channels"
            height="h-9"
          />
          <FilterDropdown
            value={statusFilter}
            onValueChange={setStatusFilter}
            options={REQUEST_STATUS_FILTER_OPTIONS}
            placeholder="All Statuses"
            height="h-9"
          />
          <FilterDropdown
            value={pipelineFilter}
            onValueChange={setPipelineFilter}
            options={pipelineFilterOptions}
            placeholder="All Pipelines"
            height="h-9"
          />
        </div>
      </Toolbar>

      <DataTable
        columns={columns}
        data={pageItems}
        getRowKey={(l) => l.id}
        onRowClick={(l) => setOpenLogId(l.id)}
        empty={
          <EmptyState
            icon={ScrollText}
            title={logs.length ? "No matching requests" : "No requests yet"}
            description={
              logs.length
                ? "Try clearing the filters."
                : "Queries from the playground, widgets and the API show up here."
            }
            action={
              logs.length && filtersActive ? (
                <Button variant="outline" size="sm" onClick={clearFilters}>
                  Clear filters
                </Button>
              ) : null
            }
          />
        }
      />

      <ListPagination {...pagination} itemLabel="requests" />

      <Sheet open={!!openLog} onOpenChange={(o) => !o && setOpenLogId(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>Request trace</SheetTitle>
            <SheetDescription>
              {openLog?.createdAt ? new Date(openLog.createdAt).toLocaleString() : ""}
            </SheetDescription>
          </SheetHeader>

          {openLog ? (
            <div className="space-y-5 px-4 pb-6">
              <div className="flex items-center gap-2">
                <StatusPill status={openLog.status} map={REQUEST_STATUS_MAP} />
                <Badge variant="neutral">
                  {CHANNEL_LABELS[openLog.channel] || openLog.channel}
                </Badge>
              </div>

              <div>
                <p className="mb-1 text-sm font-medium text-muted-foreground">Query</p>
                <p className="rounded-lg border border-border bg-surface-card p-3 text-sm text-foreground">
                  {openLog.query || "—"}
                </p>
              </div>

              <div>
                <p className="mb-1 text-sm font-medium text-muted-foreground">
                  Retrieved chunks
                </p>
                {Array.isArray(openLog.retrieved) && openLog.retrieved.length ? (
                  <ul className="space-y-2">
                    {openLog.retrieved.map((entry, i) => (
                      <li
                        key={entry.chunkId || i}
                        className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-card p-3"
                      >
                        <p className="min-w-0 truncate text-xs font-medium text-foreground">
                          <span className="tabular-nums text-text-tertiary">#{entry.rank ?? i + 1}</span>{" "}
                          {sourceNameById[entry.sourceId] || "Deleted source"}
                        </p>
                        <div className="flex shrink-0 items-center gap-2">
                          {viaLabel(entry.via) ? (
                            <Badge variant="neutral" title={entry.via}>
                              {viaLabel(entry.via)}
                            </Badge>
                          ) : null}
                          <span className="text-xs tabular-nums text-text-secondary" title="Retrieval score">
                            {formatScore(entry.score)}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-text-tertiary">No chunks were retrieved.</p>
                )}
              </div>

              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="rounded-lg border border-border bg-surface-card p-3">
                  <p className="text-[10px] uppercase tracking-wider text-text-tertiary">
                    Latency
                  </p>
                  <p className="mt-1 text-sm font-semibold text-foreground">
                    {openLog.latencyMs ? `${formatNumber(openLog.latencyMs)}ms` : "—"}
                  </p>
                </div>
                <div className="rounded-lg border border-border bg-surface-card p-3">
                  <p className="text-[10px] uppercase tracking-wider text-text-tertiary">
                    Tokens
                  </p>
                  <p className="mt-1 text-sm font-semibold text-foreground">
                    {formatNumber((openLog.tokensIn || 0) + (openLog.tokensOut || 0))}
                  </p>
                </div>
                <div className="rounded-lg border border-border bg-surface-card p-3">
                  <p className="text-[10px] uppercase tracking-wider text-text-tertiary">
                    Cost
                  </p>
                  <p className="mt-1 text-sm font-semibold text-foreground">
                    {formatCurrency(openLog.cost || 0, { precise: true })}
                  </p>
                </div>
              </div>

              {openLog.conversationId ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setOpenLogId(null);
                    openRecordInTab("Conversations", "conversation", openLog.conversationId);
                  }}
                >
                  <ExternalLink className="h-3.5 w-3.5" /> Open conversation
                </Button>
              ) : null}
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </MainScreenWrapper>
  );
}

export default RequestLogsScreen;
