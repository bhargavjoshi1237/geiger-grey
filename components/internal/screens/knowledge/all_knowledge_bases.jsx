"use client";

import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Archive, ArchiveRestore, Database, FolderOpen, Plus } from "lucide-react";

import { MainScreenWrapper } from "@/components/internal/shared/screen_wrappers";
import {
  DataTable,
  EmptyState,
  LoadingArea,
  ScreenHeader,
  SearchInput,
  StatsBar,
  StatusPill,
  Toolbar,
} from "@/components/internal/shared/screen_kit";
import { ListPagination, usePagination } from "@/components/internal/shared/pagination";
import { Button } from "@geiger/ui/button";
import { ActionMenu } from "@geiger/ui/action-menu";
import { LucideIcon } from "@geiger/ui/icon-picker";
import FilterDropdown from "@/components/internal/shared/filter_dropdown";
import { useCan } from "@/context/rbac-context";
import { useProject } from "@/context/project-context";
import { useWorkspaceUrl } from "@/lib/hooks/use-workspace-url";
import {
  createKnowledgeBase,
  listKnowledgeBases,
  updateKnowledgeBase,
} from "@/lib/supabase/knowledge_bases";
import { listPresets } from "@/lib/supabase/ingestion_presets";
import { listSources } from "@/lib/supabase/sources";
import { formatRelative } from "@/lib/grey/format";
import { CreateKnowledgeBaseDialog } from "./kb_dialog";
import { KnowledgeBaseDetail } from "./knowledge_base_detail";
import { EMBEDDING_MODEL_LABEL, KB_STATUS_MAP } from "./constants";

const STATUS_FILTER_OPTIONS = [
  { value: "all", label: "All statuses" },
  { value: "active", label: "Active" },
  { value: "archived", label: "Archived" },
];

export function AllKnowledgeBasesScreen() {
  const { projectId } = useProject();
  const { params, openRecord, closeRecord } = useWorkspaceUrl();
  const canManage = useCan("grey.kb.manage");

  const [kbs, setKbs] = useState([]);
  const [presets, setPresets] = useState([]);
  const [sources, setSources] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);

  const kbId = params?.kb || null;

  useEffect(() => {
    let alive = true;
    Promise.all([listKnowledgeBases(projectId), listPresets(projectId), listSources(projectId)]).then(
      ([kbRows, presetRows, sourceRows]) => {
        if (!alive) return;
        setKbs(kbRows ?? []);
        setPresets(presetRows ?? []);
        setSources(sourceRows ?? []);
        setLoading(false);
      },
    );
    return () => {
      alive = false;
    };
  }, [projectId]);

  const presetsById = useMemo(() => Object.fromEntries(presets.map((p) => [p.id, p])), [presets]);

  const aggregatesByKb = useMemo(() => {
    const map = {};
    for (const source of sources) {
      const entry = map[source.kbId] || { sourceCount: 0, chunkCount: 0 };
      entry.sourceCount += 1;
      entry.chunkCount += source.chunkCount || 0;
      map[source.kbId] = entry;
    }
    return map;
  }, [sources]);

  const selectedKb = useMemo(() => (kbId ? kbs.find((k) => k.id === kbId) || null : null), [kbId, kbs]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return kbs.filter((kb) => {
      if (status !== "all" && kb.status !== status) return false;
      if (q && !`${kb.name} ${kb.description || ""}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [kbs, search, status]);

  const pager = usePagination(filtered, { resetKey: `${search}|${status}` });

  const stats = useMemo(() => {
    const active = kbs.filter((k) => k.status === "active").length;
    const totalSources = sources.length;
    const totalChunks = sources.reduce((sum, s) => sum + (s.chunkCount || 0), 0);
    return [
      { label: "Knowledge bases", value: String(kbs.length), footer: `${active} active` },
      { label: "Sources", value: String(totalSources), footer: "Across all knowledge bases" },
      { label: "Chunks", value: String(totalChunks), footer: "Indexed so far" },
      { label: "Presets", value: String(presets.length), footer: "System + custom" },
    ];
  }, [kbs, sources, presets]);

  const handleCreate = async (draft) => {
    const id = crypto.randomUUID();
    const optimistic = {
      id,
      ...draft,
      projectId,
      chunkConfig: null,
      retrievalDefaults: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setKbs((prev) => [optimistic, ...prev]);
    const saved = await createKnowledgeBase(projectId, { ...draft, id });
    if (!saved) {
      toast.error("Couldn't create the knowledge base.");
      setKbs((prev) => prev.filter((k) => k.id !== id));
      return;
    }
    setKbs((prev) => prev.map((k) => (k.id === id ? saved : k)));
    toast.success(`"${saved.name}" created.`);
  };

  const handleUpdate = (updated) => {
    setKbs((prev) => prev.map((k) => (k.id === updated.id ? updated : k)));
  };

  const handleDelete = (kb) => {
    setKbs((prev) => prev.filter((k) => k.id !== kb.id));
    closeRecord("kb");
  };

  const toggleArchive = async (kb) => {
    const next = kb.status === "archived" ? "active" : "archived";
    setKbs((prev) => prev.map((k) => (k.id === kb.id ? { ...k, status: next } : k)));
    const saved = await updateKnowledgeBase(kb.id, { status: next });
    if (!saved) {
      toast.error("Couldn't update the knowledge base's status.");
      setKbs((prev) => prev.map((k) => (k.id === kb.id ? kb : k)));
    }
  };

  if (selectedKb) {
    return (
      <KnowledgeBaseDetail
        projectId={projectId}
        kb={selectedKb}
        presets={presets}
        onBack={() => closeRecord("kb")}
        onUpdate={handleUpdate}
        onDelete={handleDelete}
      />
    );
  }

  const columns = [
    {
      key: "name",
      header: "Knowledge base",
      render: (kb) => (
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-card text-muted-foreground">
            <LucideIcon name={kb.icon || "Database"} className="h-4 w-4" />
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="font-medium text-foreground">{kb.name}</span>
            {kb.description ? (
              <span className="max-w-xs truncate text-xs text-text-secondary">{kb.description}</span>
            ) : null}
          </div>
        </div>
      ),
    },
    {
      key: "sources",
      header: "Sources",
      render: (kb) => (aggregatesByKb[kb.id]?.sourceCount ?? 0).toLocaleString("en-US"),
    },
    {
      key: "chunks",
      header: "Chunks",
      render: (kb) => (aggregatesByKb[kb.id]?.chunkCount ?? 0).toLocaleString("en-US"),
    },
    {
      key: "preset",
      header: "Preset",
      render: (kb) => presetsById[kb.presetId]?.name || "—",
    },
    {
      key: "embedding",
      header: "Embedding model",
      render: (kb) => EMBEDDING_MODEL_LABEL[kb.embeddingModel] || kb.embeddingModel || "—",
    },
    {
      key: "status",
      header: "Status",
      render: (kb) => <StatusPill status={kb.status} map={KB_STATUS_MAP} />,
    },
    {
      key: "updated",
      header: "Updated",
      align: "right",
      className: "text-right",
      render: (kb) => formatRelative(kb.updatedAt),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      className: "text-right",
      render: (kb) => (
        <ActionMenu
          label={`Actions for ${kb.name}`}
          items={[
            { icon: FolderOpen, label: "Open", onSelect: () => openRecord("kb", kb.id) },
            canManage && {
              icon: kb.status === "archived" ? ArchiveRestore : Archive,
              label: kb.status === "archived" ? "Restore" : "Archive",
              onSelect: () => toggleArchive(kb),
            },
          ]}
        />
      ),
    },
  ];

  return (
    <MainScreenWrapper>
      <ScreenHeader
        title="All Knowledge Bases"
        description="Every knowledge base in this project — upload sources, pick an ingestion preset, and query it from a pipeline."
        actions={
          canManage ? (
            <Button
              className="bg-primary text-primary-foreground hover:bg-primary/90"
              onClick={() => setCreateOpen(true)}
            >
              <Plus className="h-4 w-4" /> Create knowledge base
            </Button>
          ) : null
        }
      />

      <StatsBar stats={stats} />

      <Toolbar>
        <FilterDropdown value={status} onValueChange={setStatus} options={STATUS_FILTER_OPTIONS} height="h-9" />
        <SearchInput value={search} onChange={setSearch} placeholder="Search knowledge bases…" />
      </Toolbar>

      {loading ? (
        <LoadingArea label="Loading knowledge bases" panel />
      ) : (
        <div className="space-y-5">
          <DataTable
            columns={columns}
            data={pager.pageItems}
            getRowKey={(kb) => kb.id}
            onRowClick={(kb) => openRecord("kb", kb.id)}
            empty={
              <div className="rounded-xl border border-border bg-surface-subtle">
                <EmptyState
                  icon={Database}
                  title={kbs.length ? "No knowledge bases match your filters" : "No knowledge bases yet"}
                  description={
                    kbs.length
                      ? "Try clearing the search or status filter."
                      : "Create your first knowledge base to start uploading sources."
                  }
                  action={
                    canManage ? (
                      <Button
                        className="bg-primary text-primary-foreground hover:bg-primary/90"
                        onClick={() => setCreateOpen(true)}
                      >
                        <Plus className="h-4 w-4" /> Create knowledge base
                      </Button>
                    ) : null
                  }
                />
              </div>
            }
          />
          <ListPagination {...pager} itemLabel="knowledge bases" />
        </div>
      )}

      <CreateKnowledgeBaseDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreate={handleCreate}
        presets={presets}
      />
    </MainScreenWrapper>
  );
}

export default AllKnowledgeBasesScreen;
