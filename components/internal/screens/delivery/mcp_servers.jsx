"use client";

import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Pencil, Plus, Server, Trash2 } from "lucide-react";

import { MainScreenWrapper } from "@/components/internal/shared/screen_wrappers";
import {
  DataTable,
  EmptyState,
  ScreenHeader,
  SearchInput,
  StatusPill,
  Toolbar,
} from "@/components/internal/shared/screen_kit";
import { LoadingArea } from "@geiger/ui";
import { Button } from "@geiger/ui/button";
import { ActionMenu } from "@geiger/ui/action-menu";
import { Badge } from "@geiger/ui/badge";
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
import {
  listMcpServers,
  createMcpServer,
  updateMcpServer,
  deleteMcpServer,
} from "@/lib/supabase/mcp_servers";
import { listKnowledgeBases } from "@/lib/supabase/knowledge_bases";
import { listPipelines } from "@/lib/supabase/pipelines";
import { listApiKeys } from "@/lib/supabase/api_keys";

import { McpServerDialog } from "./mcp_server_dialog";
import { McpServerDetailSheet } from "./mcp_server_sheet";
import { GatedAction } from "./gated_action";
import { MCP_STATUS_MAP, MCP_TOOL_DEFS } from "./constants";

export function McpServersScreen() {
  const { projectId } = useProject();
  const canManage = useCan("grey.mcp.manage");

  const [servers, setServers] = useState([]);
  const [knowledgeBases, setKnowledgeBases] = useState([]);
  const [pipelines, setPipelines] = useState([]);
  const [apiKeys, setApiKeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [dialogState, setDialogState] = useState({ open: false, server: null });
  const [openId, setOpenId] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);

  useEffect(() => {
    let alive = true;
    Promise.all([
      listMcpServers(projectId),
      listKnowledgeBases(projectId),
      listPipelines(projectId),
      listApiKeys(projectId),
    ]).then(([s, kb, p, keys]) => {
      if (!alive) return;
      setServers(s ?? []);
      setKnowledgeBases(kb ?? []);
      setPipelines(p ?? []);
      setApiKeys(keys ?? []);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [projectId]);

  const kbNames = useMemo(() => {
    const map = {};
    for (const kb of knowledgeBases) map[kb.id] = kb.name;
    return map;
  }, [knowledgeBases]);

  const pipelineNames = useMemo(() => {
    const map = {};
    for (const p of pipelines) map[p.id] = p.name;
    return map;
  }, [pipelines]);

  const apiKeyLabels = useMemo(() => {
    const map = {};
    for (const k of apiKeys) map[k.id] = `${k.name} (${k.prefix}…)`;
    return map;
  }, [apiKeys]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return servers;
    return servers.filter((s) => (s.name || "").toLowerCase().includes(q));
  }, [servers, search]);

  const openServer = useMemo(
    () => (openId ? servers.find((s) => s.id === openId) || null : null),
    [openId, servers],
  );

  const handleSave = async (payload) => {
    if (dialogState.server) {
      const updated = await updateMcpServer(dialogState.server.id, payload);
      if (!updated) {
        toast.error("Couldn't save the server.");
        return false;
      }
      setServers((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
      toast.success("MCP server updated.");
      return true;
    }
    const created = await createMcpServer(projectId, { status: "enabled", ...payload });
    if (!created) {
      toast.error("Couldn't create the server.");
      return false;
    }
    setServers((prev) => [created, ...prev]);
    toast.success("MCP server created.");
    return true;
  };

  const handleToggleStatus = async (server) => {
    const nextStatus = server.status === "enabled" ? "disabled" : "enabled";
    setServers((prev) => prev.map((s) => (s.id === server.id ? { ...s, status: nextStatus } : s)));
    const updated = await updateMcpServer(server.id, { status: nextStatus });
    if (!updated) {
      setServers((prev) => prev.map((s) => (s.id === server.id ? server : s)));
      toast.error("Couldn't update the server's status.");
    }
  };

  const handleDelete = async (server) => {
    setServers((prev) => prev.filter((s) => s.id !== server.id));
    toast.success("MCP server deleted.");
    const ok = await deleteMcpServer(server.id);
    if (!ok) {
      setServers((prev) => [server, ...prev]);
      toast.error("Couldn't delete the server on the server.");
    }
  };

  const columns = [
    {
      key: "name",
      header: "Name",
      render: (s) => (
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-card text-muted-foreground">
            <Server className="h-4 w-4" />
          </div>
          <span className="font-medium text-foreground">{s.name || "Untitled"}</span>
        </div>
      ),
    },
    {
      key: "kbs",
      header: "Knowledge bases",
      render: (s) => (
        <span className="text-sm text-text-secondary">
          {s.kbIds?.length ? s.kbIds.map((id) => kbNames[id] || "—").join(", ") : "None"}
        </span>
      ),
    },
    {
      key: "pipeline",
      header: "Pipeline",
      render: (s) => (
        <span className="text-sm text-text-secondary">{pipelineNames[s.pipelineId] || "—"}</span>
      ),
    },
    {
      key: "tools",
      header: "Tools",
      render: (s) => (
        <div className="flex flex-wrap gap-1">
          {MCP_TOOL_DEFS.filter((t) => s.tools?.[t.key]).map((t) => (
            <Badge key={t.key} variant="outline">
              {t.label}
            </Badge>
          ))}
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (s) => <StatusPill status={s.status} map={MCP_STATUS_MAP} />,
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (s) => (
        <ActionMenu
          label={`Actions for ${s.name}`}
          items={[
            {
              icon: Pencil,
              label: "Edit",
              disabled: !canManage,
              onSelect: () => setDialogState({ open: true, server: s }),
            },
            { separator: true },
            {
              icon: Trash2,
              label: "Delete",
              destructive: true,
              disabled: !canManage,
              onSelect: () => setDeleteTarget(s),
            },
          ]}
        />
      ),
    },
  ];

  return (
    <MainScreenWrapper>
      <ScreenHeader
        title="MCP Servers"
        description="Expose a pipeline and its knowledge bases to MCP clients like Claude Desktop or Cursor."
        actions={
          <GatedAction allowed={canManage} reason="You don't have permission to manage MCP servers.">
            <Button onClick={() => setDialogState({ open: true, server: null })}>
              <Plus className="h-4 w-4" /> New MCP Server
            </Button>
          </GatedAction>
        }
      />

      <Toolbar>
        <SearchInput value={search} onChange={setSearch} placeholder="Search servers…" />
      </Toolbar>

      {loading ? (
        <LoadingArea panel label="Loading MCP servers" />
      ) : (
        <DataTable
          columns={columns}
          data={filtered}
          getRowKey={(s) => s.id}
          onRowClick={(s) => setOpenId(s.id)}
          empty={
            <div className="rounded-xl border border-border bg-surface-subtle">
              <EmptyState
                icon={Server}
                title={servers.length ? "No servers match your search" : "No MCP servers yet"}
                description={
                  servers.length
                    ? "Try a different name."
                    : "Create one to let MCP clients query a pipeline's knowledge bases."
                }
              />
            </div>
          }
        />
      )}

      <McpServerDialog
        open={dialogState.open}
        onOpenChange={(open) => setDialogState((d) => ({ ...d, open }))}
        knowledgeBases={knowledgeBases}
        pipelines={pipelines}
        apiKeys={apiKeys}
        initial={dialogState.server}
        onSave={handleSave}
      />

      <McpServerDetailSheet
        server={openServer}
        pipelineName={openServer ? pipelineNames[openServer.pipelineId] : ""}
        kbNames={openServer ? (openServer.kbIds || []).map((id) => kbNames[id] || "—") : []}
        apiKeyLabel={openServer ? apiKeyLabels[openServer.apiKeyId] : ""}
        canManage={canManage}
        onOpenChange={(o) => !o && setOpenId(null)}
        onToggleStatus={handleToggleStatus}
      />

      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete MCP Server</DialogTitle>
            <DialogDescription>
              Delete <span className="font-medium text-foreground">{deleteTarget?.name}</span>?
              Connected clients will stop working immediately. This can&apos;t be undone.
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
    </MainScreenWrapper>
  );
}

export default McpServersScreen;
