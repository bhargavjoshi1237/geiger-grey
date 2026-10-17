"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  CalendarClock,
  Download,
  Eye,
  FileStack,
  Plus,
  RotateCw,
  ShieldCheck,
  Trash2,
} from "lucide-react";

import {
  DataTable,
  EmptyState,
  LoadingArea,
  SearchInput,
  StatusPill,
  Toolbar,
} from "@/components/internal/shared/screen_kit";
import { ListPagination, usePagination } from "@/components/internal/shared/pagination";
import { Button } from "@geiger/ui/button";
import { Badge } from "@geiger/ui/badge";
import { ActionMenu } from "@geiger/ui/action-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@geiger/ui/dialog";
import FilterDropdown from "@/components/internal/shared/filter_dropdown";
import { useCan } from "@/context/rbac-context";
import { useWorkspaceUrl } from "@/lib/hooks/use-workspace-url";
import { listKnowledgeBases, getKnowledgeBase } from "@/lib/supabase/knowledge_bases";
import { listPresets } from "@/lib/supabase/ingestion_presets";
import {
  listSources,
  updateSource,
  deleteSource,
  getSourceDownloadUrl,
} from "@/lib/supabase/sources";
import { createJobs } from "@/lib/supabase/ingestion_jobs";
import { estimateFileCost } from "@/lib/grey/cost";
import { formatBytes, formatDuration, formatRelative } from "@/lib/grey/format";

import { SourceSheet } from "./source_sheet";
import { FreshnessDialog } from "./freshness_dialog";
import { UploadSourcesDialog } from "./upload_sources_dialog";
import {
  FRESHNESS_MAP,
  SOURCE_KIND_FILTER_OPTIONS,
  SOURCE_KIND_ICONS,
  SOURCE_ORIGIN_FILTER_OPTIONS,
  SOURCE_ORIGIN_LABELS,
  SOURCE_STATUS_FILTER_OPTIONS,
  SOURCE_STATUS_MAP,
  buildQueuedJob,
  effectivePreset,
  describeSourceSize,
  freshnessOf,
} from "./constants";

// Full Sources list UI: toolbar (search + filters), table, upload dialog and
// the detail Sheet. Used standalone (Sources screen) and embedded, scoped to
// one KB, inside the Knowledge Base detail editor — `kbId` hides the KB
// column/filter and scopes both the query and uploads to that KB.
export function SourcesTable({ projectId, kbId }) {
  const [sources, setSources] = useState([]);
  const [kbs, setKbs] = useState([]);
  const [presets, setPresets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [kindFilter, setKindFilter] = useState("all");
  const [originFilter, setOriginFilter] = useState("all");
  const [kbFilter, setKbFilter] = useState("all");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [freshnessTarget, setFreshnessTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const canUpload = useCan("grey.source.upload");
  const canDelete = useCan("grey.source.delete");
  const canRun = useCan("grey.ingestion.run");

  const url = useWorkspaceUrl();
  const openSourceId = url.params?.source || null;

  const fetchAll = useCallback(
    () =>
      Promise.all([
        listSources(projectId, kbId ? { kbId } : {}),
        kbId ? getKnowledgeBase(kbId).then((kb) => (kb ? [kb] : [])) : listKnowledgeBases(projectId),
        listPresets(projectId),
      ]),
    [projectId, kbId],
  );

  const refresh = () => {
    fetchAll().then(([sourceRows, kbRows, presetRows]) => {
      setSources(sourceRows ?? []);
      setKbs(kbRows ?? []);
      setPresets(presetRows ?? []);
    });
  };

  useEffect(() => {
    let alive = true;
    fetchAll().then(([sourceRows, kbRows, presetRows]) => {
      if (!alive) return;
      setSources(sourceRows ?? []);
      setKbs(kbRows ?? []);
      setPresets(presetRows ?? []);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [fetchAll]);

  const kbsById = useMemo(() => {
    const map = {};
    for (const kb of kbs) map[kb.id] = kb;
    return map;
  }, [kbs]);

  const presetsById = useMemo(() => {
    const map = {};
    for (const p of presets) map[p.id] = p;
    return map;
  }, [presets]);

  const kbFilterOptions = useMemo(
    () => [
      { value: "all", label: "All knowledge bases" },
      ...kbs.map((kb) => ({ value: kb.id, label: kb.name })),
    ],
    [kbs],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sources.filter((s) => {
      if (statusFilter !== "all" && s.status !== statusFilter) return false;
      if (kindFilter !== "all" && s.kind !== kindFilter) return false;
      if (originFilter !== "all" && s.origin !== originFilter) return false;
      if (!kbId && kbFilter !== "all" && s.kbId !== kbFilter) return false;
      if (q && !`${s.name} ${kbsById[s.kbId]?.name || ""}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [sources, search, statusFilter, kindFilter, originFilter, kbFilter, kbId, kbsById]);

  const pager = usePagination(filtered, {
    resetKey: `${search}|${statusFilter}|${kindFilter}|${originFilter}|${kbFilter}`,
  });

  const openSource = useMemo(
    () => (openSourceId ? sources.find((s) => s.id === openSourceId) || null : null),
    [openSourceId, sources],
  );

  // The KB's preset merged with the KB's own chunk-config overrides, so a single-source
  // re-ingest runs with the same settings as "Re-ingest all" and new uploads.
  const resolvePreset = (source) => {
    const kb = kbsById[source.kbId];
    const preset =
      presetsById[kb?.presetId] ||
      presets.find((p) => p.tier === "balanced") ||
      presets[0] ||
      null;
    return effectivePreset(preset, kb);
  };

  const handleReingest = async (source) => {
    const previousStatus = source.status;
    setSources((prev) => prev.map((s) => (s.id === source.id ? { ...s, status: "queued" } : s)));
    const preset = resolvePreset(source);
    const estimate = preset
      ? estimateFileCost(
          {
            kind: source.kind,
            pageCount: source.pageCount,
            durationMs: source.durationMs,
            tokenCount: source.tokenCount,
          },
          preset,
        )
      : null;
    const estimatedCost = estimate ? Number(((estimate.low + estimate.high) / 2).toFixed(6)) : null;
    const [updated, created] = await Promise.all([
      updateSource(source.id, { status: "queued" }),
      createJobs(projectId, [
        buildQueuedJob({ kbId: source.kbId, sourceId: source.id, preset, estimatedCost }),
      ]),
    ]);
    if (updated && created?.length) {
      toast.success("Re-ingestion queued.");
      return;
    }
    // No job exists to back the optimistic "queued" state — revert it (and
    // the server row, best effort) rather than leave the source stuck
    // showing "queued" with nothing actually running.
    toast.error("Couldn't queue re-ingestion.");
    setSources((prev) => prev.map((s) => (s.id === source.id ? { ...s, status: previousStatus } : s)));
    await updateSource(source.id, { status: previousStatus });
  };

  const handleMarkVerified = async (source) => {
    const previousVerifiedAt = source.verifiedAt ?? null;
    const now = new Date().toISOString();
    setSources((prev) => prev.map((s) => (s.id === source.id ? { ...s, verifiedAt: now } : s)));
    toast.success("Marked verified.");
    const updated = await updateSource(source.id, { verifiedAt: now });
    if (!updated) {
      toast.error("Couldn't save verification.");
      setSources((prev) =>
        prev.map((s) => (s.id === source.id ? { ...s, verifiedAt: previousVerifiedAt } : s)),
      );
    }
  };

  const handleSaveFreshness = async (id, patch) => {
    const previous = sources.find((s) => s.id === id);
    const previousPatch = previous
      ? Object.fromEntries(Object.keys(patch).map((key) => [key, previous[key] ?? null]))
      : null;
    setSources((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
    const updated = await updateSource(id, patch);
    if (updated) {
      toast.success("Saved.");
    } else {
      toast.error("Couldn't save owner/review date.");
      if (previousPatch) {
        setSources((prev) => prev.map((s) => (s.id === id ? { ...s, ...previousPatch } : s)));
      }
    }
  };

  const handleDownload = async (source) => {
    if (!source.storagePath) return;
    const link = await getSourceDownloadUrl(source.storagePath);
    if (link) window.open(link, "_blank", "noopener,noreferrer");
    else toast.error("Couldn't get a download link.");
  };

  const handleDelete = async (source) => {
    setSources((prev) => prev.filter((s) => s.id !== source.id));
    if (openSourceId === source.id) url.closeRecord("source");
    toast.success("Source deleted.");
    const ok = await deleteSource(source.id);
    if (!ok) {
      toast.error("Couldn't delete the source on the server.");
      setSources((prev) => [source, ...prev]);
    }
  };

  const columns = [
    {
      key: "name",
      header: "Source",
      render: (s) => {
        const Icon = SOURCE_KIND_ICONS[s.kind] || FileStack;
        return (
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-card text-muted-foreground">
              <Icon className="h-4 w-4" />
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <span className="truncate font-medium text-foreground">{s.name || "Untitled"}</span>
              <span className="text-xs text-text-secondary">
                {SOURCE_ORIGIN_LABELS[s.origin] || s.origin}
              </span>
            </div>
          </div>
        );
      },
    },
    ...(kbId
      ? []
      : [
          {
            key: "kb",
            header: "Knowledge base",
            render: (s) => (
              <span className="text-sm text-text-secondary">
                {kbsById[s.kbId]?.name || "—"}
              </span>
            ),
          },
        ]),
    {
      key: "size",
      header: "Size",
      render: (s) => (
        <span className="text-sm text-text-secondary">
          {describeSourceSize(s, { formatBytes, formatDuration })}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (s) => <StatusPill status={s.status} map={SOURCE_STATUS_MAP} />,
    },
    {
      key: "freshness",
      header: "Freshness",
      render: (s) => {
        const key = freshnessOf(s);
        return <Badge variant={FRESHNESS_MAP[key].variant}>{FRESHNESS_MAP[key].label}</Badge>;
      },
    },
    {
      key: "created",
      header: "Added",
      align: "right",
      className: "text-right text-text-tertiary",
      render: (s) => <span className="text-xs">{s.createdAt ? formatRelative(new Date(s.createdAt)) : "—"}</span>,
    },
    {
      key: "actions",
      header: "",
      align: "right",
      className: "text-right",
      render: (s) => (
        <ActionMenu
          label={`Actions for ${s.name || "source"}`}
          items={[
            { icon: Eye, label: "Open", onSelect: () => url.openRecord("source", s.id) },
            canRun && {
              icon: RotateCw,
              label: "Re-ingest",
              onSelect: () => handleReingest(s),
            },
            canUpload && {
              icon: ShieldCheck,
              label: "Mark verified",
              onSelect: () => handleMarkVerified(s),
            },
            canUpload && {
              icon: CalendarClock,
              label: "Owner & review date",
              onSelect: () => setFreshnessTarget(s),
            },
            { separator: true },
            {
              icon: Download,
              label: "Download",
              disabled: !s.storagePath,
              onSelect: () => handleDownload(s),
            },
            canDelete && { separator: true },
            canDelete && {
              icon: Trash2,
              label: "Delete",
              destructive: true,
              onSelect: () => setDeleteTarget(s),
            },
          ]}
        />
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <Toolbar>
        <div className="flex flex-wrap items-center gap-2">
          <FilterDropdown
            value={statusFilter}
            onValueChange={setStatusFilter}
            options={SOURCE_STATUS_FILTER_OPTIONS}
            height="h-9"
          />
          <FilterDropdown
            value={kindFilter}
            onValueChange={setKindFilter}
            options={SOURCE_KIND_FILTER_OPTIONS}
            height="h-9"
          />
          <FilterDropdown
            value={originFilter}
            onValueChange={setOriginFilter}
            options={SOURCE_ORIGIN_FILTER_OPTIONS}
            height="h-9"
          />
          {kbId ? null : (
            <FilterDropdown
              value={kbFilter}
              onValueChange={setKbFilter}
              options={kbFilterOptions}
              height="h-9"
            />
          )}
        </div>
        <div className="flex items-center gap-2">
          <SearchInput value={search} onChange={setSearch} placeholder="Search sources…" />
          <Button
            size="sm"
            className="bg-primary text-primary-foreground hover:bg-primary/90"
            disabled={!canUpload}
            title={canUpload ? undefined : "You don't have permission to upload sources."}
            onClick={() => setUploadOpen(true)}
          >
            <Plus className="h-4 w-4" /> Upload
          </Button>
        </div>
      </Toolbar>

      {loading ? (
        <LoadingArea panel label="Loading sources" />
      ) : (
        <div className="space-y-5">
          <DataTable
            columns={columns}
            data={pager.pageItems}
            getRowKey={(s) => s.id}
            onRowClick={(s) => url.openRecord("source", s.id)}
            empty={
              <EmptyState
                icon={FileStack}
                title={sources.length ? "No sources match your filters" : "No sources yet"}
                description={
                  sources.length
                    ? "Try clearing the search or filters."
                    : "Upload files or import from the suite to start ingestion."
                }
                action={
                  sources.length || !canUpload ? null : (
                    <Button
                      size="sm"
                      className="bg-primary text-primary-foreground hover:bg-primary/90"
                      onClick={() => setUploadOpen(true)}
                    >
                      <Plus className="h-4 w-4" /> Upload sources
                    </Button>
                  )
                }
              />
            }
          />
          <ListPagination {...pager} itemLabel="sources" />
        </div>
      )}

      <SourceSheet
        source={openSource}
        projectId={projectId}
        canRun={canRun}
        canUpload={canUpload}
        canDelete={canDelete}
        onOpenChange={(o) => !o && url.closeRecord("source")}
        onReingest={handleReingest}
        onMarkVerified={handleMarkVerified}
        onSetFreshness={(s) => setFreshnessTarget(s)}
        onDownload={handleDownload}
        onDelete={(s) => setDeleteTarget(s)}
      />

      <FreshnessDialog
        open={!!freshnessTarget}
        onOpenChange={(o) => !o && setFreshnessTarget(null)}
        source={freshnessTarget}
        onSave={handleSaveFreshness}
      />

      <UploadSourcesDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        projectId={projectId}
        defaultKbId={kbId || null}
        onUploaded={() => {
          setUploadOpen(false);
          refresh();
        }}
      />

      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete source</DialogTitle>
            <DialogDescription>
              Delete{" "}
              <span className="font-medium text-foreground">{deleteTarget?.name}</span>? Its
              chunks and ingestion history are removed from retrieval. This can&apos;t be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              className="bg-red-500/90 text-white hover:bg-red-500"
              onClick={() => {
                handleDelete(deleteTarget);
                setDeleteTarget(null);
              }}
            >
              <Trash2 className="h-4 w-4" /> Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default SourcesTable;
