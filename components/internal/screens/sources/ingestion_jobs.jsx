"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Ban, Info, ListChecks, RotateCw } from "lucide-react";

import { MainScreenWrapper } from "@/components/internal/shared/screen_wrappers";
import {
  DataTable,
  EmptyState,
  LoadingArea,
  ScreenHeader,
  SectionCard,
  StatsBar,
  StatusPill,
  Toolbar,
} from "@/components/internal/shared/screen_kit";
import { ListPagination, usePagination } from "@/components/internal/shared/pagination";
import FilterDropdown from "@/components/internal/shared/filter_dropdown";
import { ActionMenu } from "@geiger/ui/action-menu";
import { Progress } from "@geiger/ui/progress";
import { useProject } from "@/context/project-context";
import { useCan } from "@/context/rbac-context";
import { listKnowledgeBases } from "@/lib/supabase/knowledge_bases";
import { listSources } from "@/lib/supabase/sources";
import { listJobs, createJobs, updateJob } from "@/lib/supabase/ingestion_jobs";
import { formatCurrency, formatRelative } from "@/lib/grey/format";
import {
  JOB_STAGE_LABELS,
  JOB_STATUS_FILTER_OPTIONS,
  JOB_STATUS_MAP,
} from "./constants";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export function IngestionJobsScreen() {
  const { projectId } = useProject();
  const [jobs, setJobs] = useState([]);
  const [sources, setSources] = useState([]);
  const [kbs, setKbs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [kbFilter, setKbFilter] = useState("all");
  // Snapshot of "now" taken when jobs were fetched — stats are computed from
  // this instead of calling Date.now() during render.
  const [asOf, setAsOf] = useState(() => Date.now());

  const canRun = useCan("grey.ingestion.run");

  const fetchAll = useCallback(
    () => Promise.all([listJobs(projectId), listSources(projectId), listKnowledgeBases(projectId)]),
    [projectId],
  );

  useEffect(() => {
    let alive = true;
    fetchAll().then(([jobRows, sourceRows, kbRows]) => {
      if (!alive) return;
      setJobs(jobRows ?? []);
      setSources(sourceRows ?? []);
      setKbs(kbRows ?? []);
      setAsOf(Date.now());
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [fetchAll]);

  const sourcesById = useMemo(() => {
    const map = {};
    for (const s of sources) map[s.id] = s;
    return map;
  }, [sources]);

  const kbsById = useMemo(() => {
    const map = {};
    for (const kb of kbs) map[kb.id] = kb;
    return map;
  }, [kbs]);

  const kbFilterOptions = useMemo(
    () => [
      { value: "all", label: "All knowledge bases" },
      ...kbs.map((kb) => ({ value: kb.id, label: kb.name })),
    ],
    [kbs],
  );

  const filtered = useMemo(
    () =>
      jobs.filter((j) => {
        if (statusFilter !== "all" && j.status !== statusFilter) return false;
        if (kbFilter !== "all" && j.kbId !== kbFilter) return false;
        return true;
      }),
    [jobs, statusFilter, kbFilter],
  );

  const pager = usePagination(filtered, { resetKey: `${statusFilter}|${kbFilter}` });

  const stats = useMemo(() => {
    const queued = jobs.filter((j) => j.status === "queued").length;
    const running = jobs.filter((j) => j.status === "running").length;
    const failed7d = jobs.filter(
      (j) => j.status === "failed" && j.createdAt && asOf - new Date(j.createdAt).getTime() <= SEVEN_DAYS_MS,
    ).length;
    const spend30d = jobs
      .filter((j) => j.createdAt && asOf - new Date(j.createdAt).getTime() <= THIRTY_DAYS_MS)
      .reduce((sum, j) => sum + Number(j.actualCost ?? j.estimatedCost ?? 0), 0);
    return [
      { label: "Queued", value: loading ? "" : String(queued) },
      { label: "Running", value: loading ? "" : String(running) },
      { label: "Failed (7d)", value: loading ? "" : String(failed7d) },
      { label: "Est. spend (30d)", value: loading ? "" : formatCurrency(spend30d) },
    ];
  }, [jobs, loading, asOf]);

  const handleRetry = async (job) => {
    const created = await createJobs(projectId, [
      {
        kbId: job.kbId,
        sourceId: job.sourceId,
        presetSnapshot: job.presetSnapshot ?? {},
        status: "queued",
        stage: "parse",
        progress: 0,
        estimatedCost: job.estimatedCost ?? null,
      },
    ]);
    if (created && created.length) {
      setJobs((prev) => [created[0], ...prev]);
      toast.success("A new ingestion job was queued.");
    } else {
      toast.error("Couldn't queue a retry.");
    }
  };

  const handleCancel = async (job) => {
    if (job.status !== "queued") return;
    const previousStatus = job.status;
    setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, status: "cancelled" } : j)));
    toast.success("Job cancelled.");
    const updated = await updateJob(job.id, { status: "cancelled" });
    if (!updated) {
      toast.error("Couldn't cancel the job on the server.");
      setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, status: previousStatus } : j)));
    }
  };

  const columns = [
    {
      key: "source",
      header: "Source",
      render: (j) => (
        <span className="truncate text-sm font-medium text-foreground">
          {sourcesById[j.sourceId]?.name || "—"}
        </span>
      ),
    },
    {
      key: "kb",
      header: "Knowledge base",
      render: (j) => <span className="text-sm text-text-secondary">{kbsById[j.kbId]?.name || "—"}</span>,
    },
    {
      key: "preset",
      header: "Preset tier",
      render: (j) => (
        <span className="text-sm text-text-secondary capitalize">
          {j.presetSnapshot?.tier || j.presetSnapshot?.name || "—"}
        </span>
      ),
    },
    {
      key: "stage",
      header: "Stage",
      render: (j) => (
        <span className="text-sm text-text-secondary">{JOB_STAGE_LABELS[j.stage] || j.stage}</span>
      ),
    },
    {
      key: "progress",
      header: "Progress",
      render: (j) => (
        <div className="flex items-center gap-2">
          <Progress value={j.progress || 0} className="h-1.5 w-20" />
          <span className="text-xs tabular-nums text-text-tertiary">{j.progress || 0}%</span>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (j) => <StatusPill status={j.status} map={JOB_STATUS_MAP} />,
    },
    {
      key: "cost",
      header: "Est. / actual cost",
      align: "right",
      className: "text-right tabular-nums",
      render: (j) => (
        <span className="text-sm text-text-secondary">
          {j.actualCost != null
            ? formatCurrency(j.actualCost, { precise: true })
            : j.estimatedCost != null
              ? `~${formatCurrency(j.estimatedCost, { precise: true })}`
              : "—"}
        </span>
      ),
    },
    {
      key: "created",
      header: "Created",
      align: "right",
      className: "text-right text-text-tertiary",
      render: (j) => <span className="text-xs">{j.createdAt ? formatRelative(new Date(j.createdAt)) : "—"}</span>,
    },
    {
      key: "actions",
      header: "",
      align: "right",
      className: "text-right",
      render: (j) => (
        <ActionMenu
          label="Job actions"
          items={[
            canRun && {
              icon: RotateCw,
              label: "Retry (new job)",
              onSelect: () => handleRetry(j),
            },
            canRun &&
              j.status === "queued" && {
                icon: Ban,
                label: "Cancel",
                destructive: true,
                onSelect: () => handleCancel(j),
              },
          ]}
        />
      ),
    },
  ];

  return (
    <MainScreenWrapper>
      <ScreenHeader
        title="Ingestion Jobs"
        description="Every parse, chunk, embed and graph job queued across your knowledge bases."
      />

      <StatsBar stats={stats} />

      <SectionCard bare className="flex items-start gap-3 rounded-xl border border-border bg-surface-subtle px-4 py-3">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-text-secondary" />
        <p className="text-sm text-text-secondary">
          Processing backend not connected — jobs stay queued.
        </p>
      </SectionCard>

      <Toolbar>
        <div className="flex flex-wrap items-center gap-2">
          <FilterDropdown
            value={statusFilter}
            onValueChange={setStatusFilter}
            options={JOB_STATUS_FILTER_OPTIONS}
            height="h-9"
          />
          <FilterDropdown
            value={kbFilter}
            onValueChange={setKbFilter}
            options={kbFilterOptions}
            height="h-9"
          />
        </div>
      </Toolbar>

      {loading ? (
        <LoadingArea panel label="Loading ingestion jobs" />
      ) : (
        <div className="space-y-5">
          <DataTable
            columns={columns}
            data={pager.pageItems}
            getRowKey={(j) => j.id}
            empty={
              <EmptyState
                icon={ListChecks}
                title={jobs.length ? "No jobs match your filters" : "No ingestion jobs yet"}
                description={
                  jobs.length
                    ? "Try clearing the filters."
                    : "Jobs appear here once sources are uploaded or re-ingested."
                }
              />
            }
          />
          <ListPagination {...pager} itemLabel="jobs" />
        </div>
      )}
    </MainScreenWrapper>
  );
}

export default IngestionJobsScreen;
