"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { GitBranch, Plus, Trash2 } from "lucide-react";

import { LoadingArea } from "@geiger/ui";
import { MainScreenWrapper } from "@/components/internal/shared/screen_wrappers";
import { ListPagination, usePagination } from "@/components/internal/shared/pagination";
import {
  DataTable,
  EmptyState,
  ScreenHeader,
  SearchInput,
  StatusPill,
  Toolbar,
} from "@/components/internal/shared/screen_kit";
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
import { useProject } from "@/context/project-context";
import { useCan } from "@/context/rbac-context";
import { useWorkspaceUrl } from "@/lib/hooks/use-workspace-url";
import { formatRelative } from "@/lib/grey/format";
import { createPipeline, deletePipeline, listPipelines } from "@/lib/supabase/pipelines";
import { GREY_HOSTED_ENABLED, GREY_HOSTED_PROVIDER, listProviders } from "@/lib/supabase/model_providers";
import { listKnowledgeBases } from "@/lib/supabase/knowledge_bases";
import { PIPELINE_STATUS_MAP } from "./constants";
import { PipelineDialog } from "./pipeline_dialog";
import { PipelineDetailScreen } from "./pipeline_detail";

export function AllPipelinesScreen() {
  const { projectId } = useProject();
  const canManage = useCan("grey.pipeline.manage");
  const { params, openRecord, closeRecord } = useWorkspaceUrl();
  const [pipelines, setPipelines] = useState([]);
  const [providers, setProviders] = useState([]);
  const [knowledgeBases, setKnowledgeBases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [loadedFor, setLoadedFor] = useState(null);

  if (projectId !== loadedFor) {
    setLoadedFor(projectId);
    setLoading(true);
  }

  useEffect(() => {
    let alive = true;
    Promise.all([listPipelines(projectId), listProviders(projectId), listKnowledgeBases(projectId)]).then(
      ([pipelineRows, providerRows, kbRows]) => {
        if (!alive) return;
        setPipelines(pipelineRows || []);
        setProviders(providerRows || []);
        setKnowledgeBases(kbRows || []);
        setLoading(false);
      },
    );
    return () => {
      alive = false;
    };
  }, [projectId]);

  const providerById = useMemo(() => {
    const all = GREY_HOSTED_ENABLED ? [GREY_HOSTED_PROVIDER, ...providers] : providers;
    return Object.fromEntries(all.map((p) => [p.id, p]));
  }, [providers]);
  const kbById = useMemo(() => Object.fromEntries(knowledgeBases.map((k) => [k.id, k])), [knowledgeBases]);

  const selected = useMemo(
    () => (params.pipeline ? pipelines.find((p) => p.id === params.pipeline) || null : null),
    [params.pipeline, pipelines],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return pipelines;
    return pipelines.filter((p) => `${p.name} ${p.description || ""}`.toLowerCase().includes(q));
  }, [pipelines, search]);

  const pager = usePagination(filtered, { resetKey: search });

  const handleCreate = async (input) => {
    const created = await createPipeline(projectId, input);
    if (!created) {
      toast.error("Couldn't create the pipeline.");
      return;
    }
    setPipelines((prev) => [created, ...prev]);
    toast.success(`"${created.name}" created as a draft.`);
    openRecord("pipeline", created.id);
  };

  const handleUpdate = (updated) => {
    setPipelines((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
  };

  const handleDelete = async (pipeline) => {
    setDeleteTarget(null);
    setPipelines((prev) => prev.filter((p) => p.id !== pipeline.id));
    const ok = await deletePipeline(pipeline.id);
    if (!ok) {
      toast.error("Couldn't delete the pipeline.");
      listPipelines(projectId).then((rows) => setPipelines(rows || []));
      return;
    }
    toast.success(`"${pipeline.name}" deleted.`);
    closeRecord("pipeline");
  };

  const columns = [
    {
      key: "name",
      header: "Pipeline",
      render: (p) => (
        <div className="flex flex-col gap-1">
          <span className="font-medium text-foreground">{p.name}</span>
          {p.description ? <span className="line-clamp-1 text-xs text-text-secondary">{p.description}</span> : null}
        </div>
      ),
    },
    {
      key: "kbs",
      header: "Knowledge bases",
      render: (p) => {
        const names = (p.kbIds || []).map((id) => kbById[id]?.name).filter(Boolean);
        if (!names.length) return <span className="text-xs text-text-tertiary">None</span>;
        return (
          <div className="flex max-w-xs flex-wrap gap-1">
            {names.slice(0, 2).map((n) => (
              <Badge key={n} variant="neutral">
                {n}
              </Badge>
            ))}
            {names.length > 2 ? <span className="text-xs text-text-tertiary">+{names.length - 2}</span> : null}
          </div>
        );
      },
    },
    {
      key: "model",
      header: "Provider / model",
      render: (p) => (
        <div className="flex flex-col gap-0.5">
          <span className="text-sm text-foreground">{providerById[p.providerId]?.name || "—"}</span>
          <span className="text-xs text-text-secondary">{p.model}</span>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (p) => <StatusPill status={p.status} map={PIPELINE_STATUS_MAP} />,
    },
    {
      key: "version",
      header: "Version",
      render: (p) => <span className="text-xs tabular-nums text-text-secondary">v{p.currentVersion || 0}</span>,
    },
    {
      key: "updated",
      header: "Updated",
      render: (p) => <span className="text-xs text-text-secondary">{p.updatedAt ? formatRelative(p.updatedAt) : "—"}</span>,
    },
    {
      key: "actions",
      header: "",
      align: "right",
      className: "text-right",
      render: (p) => (
        <ActionMenu
          label={`Actions for ${p.name}`}
          items={[
            canManage && {
              icon: Trash2,
              label: "Delete",
              variant: "destructive",
              onSelect: () => setDeleteTarget(p),
            },
          ]}
        />
      ),
    },
  ];

  if (selected) {
    return (
      <PipelineDetailScreen
        pipeline={selected}
        providers={providers}
        knowledgeBases={knowledgeBases}
        projectId={projectId}
        onBack={() => closeRecord("pipeline")}
        onUpdate={handleUpdate}
        onDelete={handleDelete}
      />
    );
  }

  return (
    <MainScreenWrapper>
      <ScreenHeader
        title="All Pipelines"
        description="RAG pipelines that serve your knowledge bases through chat, API keys, MCP servers and widgets."
        actions={
          canManage ? (
            <Button className="bg-primary text-primary-foreground hover:bg-primary/90" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" /> Create pipeline
            </Button>
          ) : null
        }
      />

      <Toolbar>
        <SearchInput value={search} onChange={setSearch} placeholder="Search pipelines…" />
      </Toolbar>

      {loading ? (
        <LoadingArea panel label="Loading pipelines" />
      ) : (
        <div className="space-y-5">
          <DataTable
            columns={columns}
            data={pager.pageItems}
            getRowKey={(p) => p.id}
            onRowClick={(p) => openRecord("pipeline", p.id)}
            empty={
              <EmptyState
                icon={GitBranch}
                title={pipelines.length ? "No pipelines match your search" : "No pipelines yet"}
                description={
                  pipelines.length
                    ? "Try a different search term."
                    : "Create a pipeline to connect a model provider and your knowledge bases."
                }
                action={
                  canManage ? (
                    <Button className="bg-primary text-primary-foreground hover:bg-primary/90" onClick={() => setCreateOpen(true)}>
                      <Plus className="h-4 w-4" /> Create pipeline
                    </Button>
                  ) : null
                }
              />
            }
          />
          <ListPagination {...pager} itemLabel="pipelines" />
        </div>
      )}

      <PipelineDialog open={createOpen} onOpenChange={setCreateOpen} providers={providers} onCreate={handleCreate} />

      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete pipeline</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete{" "}
              <span className="font-medium text-foreground">{deleteTarget?.name}</span>? API keys, MCP
              servers and widgets that use it will stop working.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => handleDelete(deleteTarget)}>
              <Trash2 className="h-4 w-4" /> Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainScreenWrapper>
  );
}

export default AllPipelinesScreen;
