"use client";

import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Ban, KeyRound, Plus, Trash2 } from "lucide-react";

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
import { listApiKeys, createApiKey, revokeApiKey, deleteApiKey } from "@/lib/supabase/api_keys";
import { listPipelines } from "@/lib/supabase/pipelines";

import { CreateApiKeyDialog, RevealApiKeyDialog } from "./api_key_dialog";
import { GatedAction } from "./gated_action";
import {
  API_KEY_STATUS_MAP,
  computeApiKeyStatus,
  formatDate,
  lastUsedLabel,
} from "./constants";

export function ApiKeysScreen() {
  const { projectId } = useProject();
  const canManage = useCan("grey.apikey.manage");

  const [keys, setKeys] = useState([]);
  const [pipelines, setPipelines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [reveal, setReveal] = useState(null); // { name, plainKey }
  const [revokeTarget, setRevokeTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);

  useEffect(() => {
    let alive = true;
    Promise.all([listApiKeys(projectId), listPipelines(projectId)]).then(([k, p]) => {
      if (!alive) return;
      setKeys(k ?? []);
      setPipelines(p ?? []);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [projectId]);

  const pipelineNames = useMemo(() => {
    const map = {};
    for (const p of pipelines) map[p.id] = p.name;
    return map;
  }, [pipelines]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return keys;
    return keys.filter((k) => `${k.name} ${k.prefix}`.toLowerCase().includes(q));
  }, [keys, search]);

  const handleCreate = async (input) => {
    const result = await createApiKey(projectId, input);
    if (!result?.record) {
      toast.error("Couldn't create the API key.");
      return false;
    }
    setKeys((prev) => [result.record, ...prev]);
    setReveal({ name: result.record.name, plainKey: result.key });
    toast.success("API key created.");
    return true;
  };

  const applyRevoke = (id, revokedAt) => {
    setKeys((prev) => prev.map((k) => (k.id === id ? { ...k, revokedAt } : k)));
  };

  const handleRevoke = async (key) => {
    const prior = key.revokedAt;
    const now = new Date().toISOString();
    applyRevoke(key.id, now);
    toast.success("Key revoked.");
    const ok = await revokeApiKey(key.id);
    if (!ok) {
      applyRevoke(key.id, prior);
      toast.error("Couldn't revoke the key on the server.");
    }
  };

  const handleDelete = async (key) => {
    setKeys((prev) => prev.filter((k) => k.id !== key.id));
    toast.success("API key deleted.");
    const ok = await deleteApiKey(key.id);
    if (!ok) {
      setKeys((prev) => [key, ...prev]);
      toast.error("Couldn't delete the key on the server.");
    }
  };

  const columns = [
    {
      key: "name",
      header: "Name",
      render: (k) => (
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-card text-muted-foreground">
            <KeyRound className="h-4 w-4" />
          </div>
          <div className="flex flex-col gap-1">
            <span className="font-medium text-foreground">{k.name || "Untitled"}</span>
            <span className="font-mono text-xs text-text-secondary">{k.prefix}…</span>
          </div>
        </div>
      ),
    },
    {
      key: "scopes",
      header: "Scopes",
      render: (k) => (
        <div className="flex flex-wrap gap-1">
          {(k.scopes || []).map((s) => (
            <Badge key={s} variant="outline">
              {s}
            </Badge>
          ))}
        </div>
      ),
    },
    {
      key: "pipelines",
      header: "Pipelines",
      render: (k) => (
        <span className="text-sm text-text-secondary">
          {k.pipelineIds?.length
            ? k.pipelineIds.map((id) => pipelineNames[id] || "—").join(", ")
            : "All pipelines"}
        </span>
      ),
    },
    {
      key: "rateLimit",
      header: "Rate limit",
      render: (k) => (
        <span className="text-sm text-text-secondary">{k.rateLimitPerMin || 60}/min</span>
      ),
    },
    {
      key: "lastUsed",
      header: "Last used",
      render: (k) => <span className="text-sm text-text-secondary">{lastUsedLabel(k.lastUsedAt)}</span>,
    },
    {
      key: "expires",
      header: "Expires",
      render: (k) => (
        <span className="text-sm text-text-secondary">
          {k.expiresAt ? formatDate(k.expiresAt) : "Never"}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (k) => <StatusPill status={computeApiKeyStatus(k)} map={API_KEY_STATUS_MAP} />,
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (k) => (
        <ActionMenu
          label={`Actions for ${k.name}`}
          items={[
            {
              icon: Ban,
              label: "Revoke",
              disabled: !canManage || !!k.revokedAt,
              onSelect: () => setRevokeTarget(k),
            },
            { separator: true },
            {
              icon: Trash2,
              label: "Delete",
              destructive: true,
              disabled: !canManage,
              onSelect: () => setDeleteTarget(k),
            },
          ]}
        />
      ),
    },
  ];

  return (
    <MainScreenWrapper>
      <ScreenHeader
        title="API Keys"
        description="Issue keys for retrieval, chat and MCP access from outside the workspace. Each plaintext value is shown once, right after creation."
        actions={
          <GatedAction allowed={canManage} reason="You don't have permission to manage API keys.">
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" /> New API Key
            </Button>
          </GatedAction>
        }
      />

      <Toolbar>
        <SearchInput value={search} onChange={setSearch} placeholder="Search name or prefix…" />
      </Toolbar>

      {loading ? (
        <LoadingArea panel label="Loading API keys" />
      ) : (
        <DataTable
          columns={columns}
          data={filtered}
          getRowKey={(k) => k.id}
          empty={
            <div className="rounded-xl border border-border bg-surface-subtle">
              <EmptyState
                icon={KeyRound}
                title={keys.length ? "No keys match your search" : "No API keys yet"}
                description={
                  keys.length
                    ? "Try a different name or prefix."
                    : "Create a key to let your own apps call retrieval, chat or MCP endpoints."
                }
              />
            </div>
          }
        />
      )}

      <CreateApiKeyDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        pipelines={pipelines}
        onCreate={handleCreate}
      />

      <RevealApiKeyDialog
        open={!!reveal}
        onOpenChange={(o) => !o && setReveal(null)}
        plainKey={reveal?.plainKey}
        name={reveal?.name}
      />

      <Dialog open={!!revokeTarget} onOpenChange={(o) => !o && setRevokeTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Revoke API Key</DialogTitle>
            <DialogDescription>
              Revoke{" "}
              <span className="font-medium text-foreground">{revokeTarget?.name}</span>? Any
              requests using this key will start failing immediately. This can&apos;t be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRevokeTarget(null)}>
              Cancel
            </Button>
            <Button
              className="bg-red-500/90 text-white hover:bg-red-500"
              onClick={() => {
                handleRevoke(revokeTarget);
                setRevokeTarget(null);
              }}
            >
              <Ban className="h-4 w-4" /> Revoke Key
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete API Key</DialogTitle>
            <DialogDescription>
              Delete{" "}
              <span className="font-medium text-foreground">{deleteTarget?.name}</span>{" "}
              permanently from the list? This can&apos;t be undone.
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

export default ApiKeysScreen;
