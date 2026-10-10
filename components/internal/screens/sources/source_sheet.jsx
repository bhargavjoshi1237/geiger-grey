"use client";

import { useEffect, useState } from "react";
import {
  CalendarClock,
  Download,
  Loader2,
  RotateCw,
  ShieldCheck,
  Trash2,
} from "lucide-react";

import { Button } from "@geiger/ui/button";
import { Badge } from "@geiger/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@geiger/ui/sheet";
import { StatusPill } from "@/components/internal/shared/screen_kit";
import { cn } from "@/lib/utils";
import { listJobs } from "@/lib/supabase/ingestion_jobs";
import { listEntities, listMentions } from "@/lib/supabase/graph";
import { formatBytes, formatDuration, formatRelative } from "@/lib/grey/format";
import {
  FRESHNESS_MAP,
  JOB_STAGE_LABELS,
  JOB_STATUS_MAP,
  SOURCE_KIND_ICONS,
  SOURCE_KIND_LABELS,
  SOURCE_ORIGIN_LABELS,
  SOURCE_STATUS_MAP,
  describeSourceSize,
  freshnessOf,
} from "./constants";

function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 text-sm">
      <span className="text-text-secondary">{label}</span>
      <span className="truncate text-right font-medium text-foreground">{value}</span>
    </div>
  );
}

function useSourceDetail(source, projectId) {
  const sourceId = source?.id || null;
  // Reset to the "not ready" shape during render as soon as the sheet swaps
  // to a different source — the endorsed way to clear derived state on a
  // prop change, instead of an extra setState call inside the effect below.
  const [data, setData] = useState({ sourceId: null, jobs: [], mentions: [], ready: false });
  if (sourceId !== data.sourceId) {
    setData({ sourceId, jobs: [], mentions: [], ready: false });
  }

  useEffect(() => {
    if (!sourceId) return;
    let alive = true;
    Promise.all([
      listJobs(projectId, { sourceId }),
      listMentions(projectId, {}),
      listEntities(projectId),
    ]).then(([jobRows, mentionRows, entityRows]) => {
      if (!alive) return;
      const entitiesById = {};
      for (const e of entityRows ?? []) entitiesById[e.id] = e;
      const forSource = (mentionRows ?? [])
        .filter((m) => m.sourceId === sourceId)
        .map((m) => ({ ...m, entity: entitiesById[m.entityId] || null }));
      setData({ sourceId, jobs: jobRows ?? [], mentions: forSource, ready: true });
    });
    return () => {
      alive = false;
    };
  }, [sourceId, projectId]);

  return { jobs: data.jobs, mentions: data.mentions, loading: !!sourceId && !data.ready };
}

function SourceSheetBody({
  source,
  projectId,
  canRun,
  canUpload,
  canDelete,
  onReingest,
  onMarkVerified,
  onSetFreshness,
  onDownload,
  onDelete,
}) {
  const { jobs, mentions, loading } = useSourceDetail(source, projectId);
  const Icon = SOURCE_KIND_ICONS[source.kind] || SOURCE_KIND_ICONS.document;
  const freshness = freshnessOf(source);

  return (
    <div className="flex h-full flex-col">
      <SheetHeader className="border-b border-border">
        <div className="flex items-center gap-3 pr-8">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-card text-muted-foreground">
            <Icon className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <SheetTitle className="truncate">{source.name || "Untitled source"}</SheetTitle>
            <SheetDescription className="truncate">
              {SOURCE_KIND_LABELS[source.kind] || source.kind} ·{" "}
              {SOURCE_ORIGIN_LABELS[source.origin] || source.origin}
            </SheetDescription>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <StatusPill status={source.status} map={SOURCE_STATUS_MAP} />
          <Badge variant={FRESHNESS_MAP[freshness].variant}>
            {FRESHNESS_MAP[freshness].label}
          </Badge>
        </div>
      </SheetHeader>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="space-y-6">
          <section>
            <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-text-secondary">
              Metadata
            </p>
            <div className="divide-y divide-border rounded-lg border border-border bg-surface-card px-3">
              <Row label="Size" value={describeSourceSize(source, { formatBytes, formatDuration })} />
              <Row label="File size" value={source.bytes ? formatBytes(source.bytes) : "—"} />
              <Row label="Tokens" value={source.tokenCount ? source.tokenCount.toLocaleString("en-US") : "—"} />
              <Row label="Chunks" value={source.chunkCount ? String(source.chunkCount) : "0"} />
              <Row label="MIME" value={source.mime || "—"} />
              <Row
                label="Uploaded"
                value={source.createdAt ? formatRelative(new Date(source.createdAt)) : "—"}
              />
              <Row
                label="Verified"
                value={source.verifiedAt ? formatRelative(new Date(source.verifiedAt)) : "Not verified"}
              />
              <Row
                label="Review due"
                value={source.reviewDueAt ? new Date(source.reviewDueAt).toLocaleDateString() : "—"}
              />
              <Row label="Owner" value={source.ownerId || "—"} />
            </div>
          </section>

          <section>
            <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-text-secondary">
              Ingestion jobs
            </p>
            {loading ? (
              <div className="flex items-center justify-center gap-2 rounded-lg border border-border bg-surface-card py-6 text-sm text-text-secondary">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading jobs…
              </div>
            ) : jobs.length ? (
              <div className="space-y-2">
                {jobs.map((job) => (
                  <div
                    key={job.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-card px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">
                        {JOB_STAGE_LABELS[job.stage] || job.stage}
                      </p>
                      <p className="text-xs text-text-tertiary">
                        {job.createdAt ? formatRelative(new Date(job.createdAt)) : "—"}
                      </p>
                    </div>
                    <StatusPill status={job.status} map={JOB_STATUS_MAP} />
                  </div>
                ))}
              </div>
            ) : (
              <p className="rounded-lg border border-border bg-surface-card px-3 py-4 text-sm text-text-tertiary">
                No ingestion jobs yet.
              </p>
            )}
          </section>

          <section>
            <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-text-secondary">
              Mentioned entities
            </p>
            {mentions.length ? (
              <div className="flex flex-wrap gap-1.5">
                {mentions.map((m) => (
                  <Badge key={m.id} variant="neutral">
                    {m.entity?.name || "Unknown entity"}
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="rounded-lg border border-border bg-surface-card px-3 py-4 text-sm text-text-tertiary">
                No graph mentions yet.
              </p>
            )}
          </section>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border p-4">
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant="outline"
            className="border-border bg-transparent text-muted-foreground hover:bg-surface-active hover:text-foreground"
            onClick={() => onDownload(source)}
            disabled={!source.storagePath}
          >
            <Download className="h-4 w-4" /> Download
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="border-border bg-transparent text-muted-foreground hover:bg-surface-active hover:text-foreground"
            disabled={!canRun}
            title={canRun ? undefined : "You don't have permission to run ingestion."}
            onClick={() => onReingest(source)}
          >
            <RotateCw className="h-4 w-4" /> Re-ingest
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="border-border bg-transparent text-muted-foreground hover:bg-surface-active hover:text-foreground"
            disabled={!canUpload}
            title={canUpload ? undefined : "You don't have permission to verify sources."}
            onClick={() => onMarkVerified(source)}
          >
            <ShieldCheck className="h-4 w-4" /> Mark verified
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="border-border bg-transparent text-muted-foreground hover:bg-surface-active hover:text-foreground"
            disabled={!canUpload}
            onClick={() => onSetFreshness(source)}
          >
            <CalendarClock className="h-4 w-4" /> Review date
          </Button>
        </div>
        <Button
          size="sm"
          variant="ghost"
          className={cn(
            "text-red-300 hover:bg-red-500/10 hover:text-red-300",
            !canDelete && "pointer-events-none opacity-50",
          )}
          disabled={!canDelete}
          onClick={() => onDelete(source)}
        >
          <Trash2 className="h-4 w-4" /> Delete
        </Button>
      </div>
    </div>
  );
}

export function SourceSheet({
  source,
  projectId,
  canRun,
  canUpload,
  canDelete,
  onOpenChange,
  onReingest,
  onMarkVerified,
  onSetFreshness,
  onDownload,
  onDelete,
}) {
  return (
    <Sheet open={!!source} onOpenChange={(o) => !o && onOpenChange(false)}>
      <SheetContent className="w-full gap-0 p-0 sm:max-w-lg">
        {source ? (
          <SourceSheetBody
            source={source}
            projectId={projectId}
            canRun={canRun}
            canUpload={canUpload}
            canDelete={canDelete}
            onReingest={onReingest}
            onMarkVerified={onMarkVerified}
            onSetFreshness={onSetFreshness}
            onDownload={onDownload}
            onDelete={onDelete}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

export default SourceSheet;
