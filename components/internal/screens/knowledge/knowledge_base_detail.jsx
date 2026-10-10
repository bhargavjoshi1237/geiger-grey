"use client";

import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Activity as ActivityIcon,
  AlertTriangle,
  Archive,
  ArchiveRestore,
  Files,
  Layers,
  Loader2,
  RefreshCcw,
  SlidersHorizontal,
  TriangleAlert,
  Trash2,
} from "lucide-react";

import { EditorShell } from "@/components/internal/shared/editor_shell";
import {
  DataTable,
  EmptyState,
  LoadingArea,
  SectionCard,
  StatusPill,
} from "@/components/internal/shared/screen_kit";
import { Button } from "@geiger/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@geiger/ui/dialog";
import { Progress } from "@geiger/ui/progress";
import { useCan } from "@/context/rbac-context";
import { useWorkspaceUrl } from "@/lib/hooks/use-workspace-url";
import { listSources } from "@/lib/supabase/sources";
import { listJobs, createJobs } from "@/lib/supabase/ingestion_jobs";
import { updateKnowledgeBase, deleteKnowledgeBase } from "@/lib/supabase/knowledge_bases";
import { estimateFileCost } from "@/lib/grey/cost";
import { formatCurrency, formatRelative } from "@/lib/grey/format";
import { SourcesTable } from "@/components/internal/screens/sources/sources_table";
import { ChunkBrowser } from "./chunk_browser";
import { IngestionSettingsForm, PresetPicker } from "./ingestion_settings_form";
import { PermissionTooltip } from "./permission_tooltip";
import { DEFAULT_PRESET_CONFIG, EMBEDDING_MODEL_LABEL, JOB_STATUS_MAP, KB_STATUS_MAP } from "./constants";

const NAV = [
  { key: "sources", label: "Sources", icon: Files },
  { key: "chunks", label: "Chunks", icon: Layers },
  { key: "ingestion", label: "Ingestion settings", icon: SlidersHorizontal },
  { key: "activity", label: "Activity", icon: ActivityIcon },
  { key: "danger", label: "Danger zone", icon: AlertTriangle },
];

function presetConfigFor(presetId, presets) {
  return presets.find((p) => p.id === presetId)?.config || DEFAULT_PRESET_CONFIG;
}

// grey.knowledge_bases.chunk_config defaults to '{}'::jsonb — never null — so
// it is always "truthy" and can't be used as a sentinel for "no overrides
// yet". One level deep is as deep as the config shape goes (chunking,
// enrichment, media, graph, prices are all flat objects of leaves), so a
// shallow per-section merge is a full deep merge for this shape.
function mergeConfig(base, overrides) {
  const merged = { ...base };
  for (const [key, value] of Object.entries(overrides || {})) {
    if (value == null) continue;
    merged[key] =
      typeof value === "object" && !Array.isArray(value) && typeof base?.[key] === "object"
        ? { ...base[key], ...value }
        : value;
  }
  return merged;
}

function effectiveConfig(kb, presets) {
  return mergeConfig(presetConfigFor(kb.presetId, presets), kb.chunkConfig);
}

// Ingestion settings: preset picker + advanced overrides, saved onto the KB's
// chunk_config override column. Re-ingest all snapshots the effective config
// onto a fresh job per source.
function IngestionSettingsSection({ projectId, kb, presets, canManage, canRun, onUpdate }) {
  const [presetId, setPresetId] = useState(kb.presetId || presets[0]?.id || "");
  const [config, setConfig] = useState(() => effectiveConfig(kb, presets));
  const [saving, setSaving] = useState(false);
  const [reingesting, setReingesting] = useState(false);

  const persisted = useMemo(
    () => ({ presetId: kb.presetId || "", config: effectiveConfig(kb, presets) }),
    [kb, presets],
  );
  const dirty =
    presetId !== persisted.presetId || JSON.stringify(config) !== JSON.stringify(persisted.config);

  const pickPreset = (id) => {
    setPresetId(id);
    setConfig(presetConfigFor(id, presets));
  };

  const save = async () => {
    setSaving(true);
    const saved = await updateKnowledgeBase(kb.id, { presetId, chunkConfig: config });
    setSaving(false);
    if (!saved) {
      toast.error("Couldn't save ingestion settings.");
      return;
    }
    onUpdate(saved);
    toast.success("Ingestion settings saved.");
  };

  const reingestAll = async () => {
    setReingesting(true);
    try {
      const sources = (await listSources(projectId, { kbId: kb.id })) || [];
      const selectedPreset = presets.find((p) => p.id === presetId);
      const jobs = sources.map((source) => {
        const estimate = estimateFileCost(
          {
            kind: source.kind,
            pageCount: source.pageCount,
            durationMs: source.durationMs,
            tokenCount: source.tokenCount,
          },
          { tier: selectedPreset?.tier || "custom", config },
        );
        return {
          kbId: kb.id,
          sourceId: source.id,
          presetSnapshot: { presetId, tier: selectedPreset?.tier, config },
          status: "queued",
          stage: "parse",
          progress: 0,
          estimatedCost: estimate?.low ?? 0,
        };
      });
      const created = jobs.length ? await createJobs(projectId, jobs) : [];
      if (jobs.length && !created) {
        toast.error("Couldn't queue re-ingestion jobs.");
        return;
      }
      toast.success(
        jobs.length
          ? `Queued ${jobs.length} source${jobs.length === 1 ? "" : "s"} for re-ingestion.`
          : "No sources to re-ingest yet.",
      );
    } catch (error) {
      console.error("[knowledge_base_detail.reingestAll]", error);
      toast.error("Couldn't queue re-ingestion jobs.");
    } finally {
      setReingesting(false);
    }
  };

  return (
    <div className="space-y-5">
      <SectionCard title="Preset" description="Pick a tier, then fine-tune under Advanced.">
        <PresetPicker presets={presets} value={presetId} onChange={canManage ? pickPreset : undefined} />
      </SectionCard>

      <SectionCard
        title="Settings"
        description={`Embedding model: ${EMBEDDING_MODEL_LABEL[kb.embeddingModel] || kb.embeddingModel} (locked)`}
      >
        <IngestionSettingsForm value={config} onChange={setConfig} disabled={!canManage} showPrices={false} />
      </SectionCard>

      {dirty ? (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Unsaved changes only apply to sources ingested after you save. Use
            &quot;Re-ingest all&quot; to apply them to existing sources.
          </span>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <PermissionTooltip
          disabled={!canManage}
          reason="You don't have permission to manage this knowledge base."
        >
          <Button
            className="bg-primary text-primary-foreground hover:bg-primary/90"
            onClick={save}
            disabled={!canManage || !dirty || saving}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Save
          </Button>
        </PermissionTooltip>
        <PermissionTooltip disabled={!canRun} reason="You don't have permission to run ingestion.">
          <Button
            variant="outline"
            className="border-border bg-transparent text-muted-foreground hover:bg-surface-active hover:text-foreground"
            onClick={reingestAll}
            disabled={!canRun || reingesting}
          >
            {reingesting ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
            Re-ingest all
          </Button>
        </PermissionTooltip>
      </div>
    </div>
  );
}

function ActivitySection({ projectId, kb }) {
  const [jobs, setJobs] = useState([]);
  const [sourceNames, setSourceNames] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    Promise.all([
      listJobs(projectId, { kbId: kb.id }),
      listSources(projectId, { kbId: kb.id }),
    ]).then(([jobRows, sourceRows]) => {
      if (!alive) return;
      setJobs(jobRows ?? []);
      const map = {};
      for (const s of sourceRows ?? []) map[s.id] = s.name;
      setSourceNames(map);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [projectId, kb.id]);

  if (loading) return <LoadingArea label="Loading activity" panel />;

  const columns = [
    {
      key: "source",
      header: "Source",
      render: (j) => sourceNames[j.sourceId] || "—",
    },
    { key: "stage", header: "Stage", render: (j) => <span className="capitalize">{j.stage}</span> },
    {
      key: "progress",
      header: "Progress",
      render: (j) => (
        <div className="w-28">
          <Progress value={j.progress ?? 0} />
        </div>
      ),
    },
    { key: "status", header: "Status", render: (j) => <StatusPill status={j.status} map={JOB_STATUS_MAP} /> },
    {
      key: "cost",
      header: "Est. / actual cost",
      align: "right",
      className: "text-right",
      render: (j) =>
        `${formatCurrency(j.estimatedCost ?? 0, { precise: true })} / ${
          j.actualCost != null ? formatCurrency(j.actualCost, { precise: true }) : "—"
        }`,
    },
    {
      key: "created",
      header: "Created",
      align: "right",
      className: "text-right",
      render: (j) => formatRelative(j.createdAt),
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={jobs}
      getRowKey={(j) => j.id}
      empty={
        <div className="rounded-xl border border-border bg-surface-subtle">
          <EmptyState
            icon={ActivityIcon}
            title="No ingestion jobs yet"
            description="Jobs appear here once sources are queued for this knowledge base."
          />
        </div>
      }
    />
  );
}

function DangerZoneSection({ kb, canManage, onUpdate, onDelete }) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const archived = kb.status === "archived";

  const toggleArchive = async () => {
    const saved = await updateKnowledgeBase(kb.id, { status: archived ? "active" : "archived" });
    if (!saved) {
      toast.error("Couldn't update the knowledge base's status.");
      return;
    }
    onUpdate(saved);
    toast.success(archived ? "Knowledge base restored." : "Knowledge base archived.");
  };

  const remove = async () => {
    setDeleteOpen(false);
    const ok = await deleteKnowledgeBase(kb.id);
    if (!ok) {
      toast.error("Couldn't delete the knowledge base.");
      return;
    }
    toast.success(`Deleted "${kb.name}".`);
    onDelete(kb);
  };

  return (
    <>
      <SectionCard
        title="Danger zone"
        description="Archiving hides this knowledge base from pipelines without deleting its data."
        className="border-red-500/20"
      >
        <div className="flex flex-wrap items-center gap-2">
          <PermissionTooltip
            disabled={!canManage}
            reason="You don't have permission to manage this knowledge base."
          >
            <Button
              variant="outline"
              className="border-border bg-transparent text-muted-foreground hover:bg-surface-active hover:text-foreground"
              onClick={toggleArchive}
              disabled={!canManage}
            >
              {archived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
              {archived ? "Restore" : "Archive"}
            </Button>
          </PermissionTooltip>
          <PermissionTooltip
            disabled={!canManage}
            reason="You don't have permission to manage this knowledge base."
          >
            <Button
              variant="outline"
              className="border-red-500/30 bg-transparent text-red-400 hover:bg-red-500/10 hover:text-red-300"
              onClick={() => setDeleteOpen(true)}
              disabled={!canManage}
            >
              <Trash2 className="h-4 w-4" /> Delete
            </Button>
          </PermissionTooltip>
        </div>
      </SectionCard>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete knowledge base</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete{" "}
              <span className="font-medium text-foreground">{kb.name}</span>? Its sources
              and chunks will no longer be retrievable. This action can&apos;t be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button className="bg-red-500/90 text-white hover:bg-red-500" onClick={remove}>
              <Trash2 className="h-4 w-4" /> Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function KnowledgeBaseDetail({ projectId, kb, presets, onBack, onUpdate, onDelete }) {
  const canManage = useCan("grey.kb.manage");
  const canRun = useCan("grey.ingestion.run");
  const { section: active, setSection: setActive } = useWorkspaceUrl();

  if (!kb) return null;

  return (
    <EditorShell
      back={{ label: "All Knowledge Bases", onClick: onBack }}
      title={kb.name}
      status={kb.status}
      statusMap={KB_STATUS_MAP}
      meta={kb.description || "No description yet"}
      nav={NAV}
      active={active}
      onActiveChange={setActive}
    >
      {({ active: section }) => {
        // Keyed by kb.id: the workspace can jump straight from one KB's detail
        // to another's (e.g. browser back/forward) without this shell
        // unmounting, so each section must reset its local state on that
        // switch rather than carry the previous KB's draft forward.
        if (section === "sources") {
          return <SourcesTable key={kb.id} projectId={projectId} kbId={kb.id} />;
        }
        if (section === "chunks") {
          return <ChunkBrowser key={kb.id} projectId={projectId} kbId={kb.id} />;
        }
        if (section === "ingestion") {
          return (
            <IngestionSettingsSection
              key={kb.id}
              projectId={projectId}
              kb={kb}
              presets={presets}
              canManage={canManage}
              canRun={canRun}
              onUpdate={onUpdate}
            />
          );
        }
        if (section === "activity") {
          return <ActivitySection key={kb.id} projectId={projectId} kb={kb} />;
        }
        return (
          <DangerZoneSection
            key={kb.id}
            kb={kb}
            canManage={canManage}
            onUpdate={onUpdate}
            onDelete={onDelete}
          />
        );
      }}
    </EditorShell>
  );
}

export default KnowledgeBaseDetail;
