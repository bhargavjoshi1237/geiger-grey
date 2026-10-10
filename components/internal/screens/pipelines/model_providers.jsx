"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Cpu, Loader2, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";

import { LoadingArea } from "@geiger/ui";
import { MainScreenWrapper } from "@/components/internal/shared/screen_wrappers";
import { DataTable, EmptyState, ScreenHeader, StatusPill } from "@/components/internal/shared/screen_kit";
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
import { formatRelative } from "@/lib/grey/format";
import {
  createProvider,
  deleteProvider,
  GREY_HOSTED_PROVIDER,
  listProviders,
  saveProviderSecret,
  testProvider,
  updateProvider,
} from "@/lib/supabase/model_providers";
import { PROVIDER_STATUS_MAP, providerLabel } from "./constants";
import { ProviderDialog } from "./provider_dialog";

export function ModelProvidersScreen() {
  const { projectId } = useProject();
  const canManage = useCan("grey.provider.manage");
  const [providers, setProviders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [loadedFor, setLoadedFor] = useState(null);

  if (projectId !== loadedFor) {
    setLoadedFor(projectId);
    setLoading(true);
  }

  useEffect(() => {
    let alive = true;
    listProviders(projectId).then((rows) => {
      if (!alive) return;
      setProviders(rows || []);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [projectId]);

  const rows = useMemo(() => [GREY_HOSTED_PROVIDER, ...providers], [providers]);

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const openEdit = (row) => {
    setEditing(row);
    setDialogOpen(true);
  };

  const handleSave = async (draft, secret) => {
    setSaving(true);
    try {
      let next;
      if (editing) {
        const saved = await updateProvider(editing.id, draft);
        if (!saved) {
          toast.error("Couldn't save the provider.");
          return;
        }
        next = saved;
        if (secret) {
          const { data, error } = await saveProviderSecret(editing.id, secret);
          if (error) toast.error("Saved, but the key couldn't be stored.");
          else next = { ...saved, keyLast4: data?.keyLast4 ?? saved.keyLast4, status: "unverified" };
        }
        setProviders((prev) => prev.map((p) => (p.id === next.id ? next : p)));
        toast.success(`"${next.name}" updated.`);
      } else {
        const created = await createProvider(projectId, draft);
        if (!created) {
          toast.error("Couldn't create the provider.");
          return;
        }
        next = created;
        if (secret) {
          const { data, error } = await saveProviderSecret(created.id, secret);
          if (error) toast.error("Created, but the key couldn't be stored.");
          else next = { ...created, keyLast4: data?.keyLast4 ?? created.keyLast4, status: "unverified" };
        }
        setProviders((prev) => [next, ...prev]);
        toast.success(`"${next.name}" added.`);
      }
      setDialogOpen(false);
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async (row) => {
    setTestingId(row.id);
    const { data, error } = await testProvider(row.id);
    setTestingId(null);
    if (error || !data) {
      toast.error("Test failed — check the provider's key.");
      return;
    }
    setProviders((prev) => prev.map((p) => (p.id === row.id ? { ...p, ...data } : p)));
    toast[data.status === "ok" ? "success" : "error"](
      data.status === "ok" ? `"${row.name}" is connected.` : `"${row.name}" couldn't be verified.`,
    );
  };

  const handleDelete = async (row) => {
    setDeleteTarget(null);
    setProviders((prev) => prev.filter((p) => p.id !== row.id));
    const ok = await deleteProvider(row.id);
    if (!ok) {
      toast.error("Couldn't delete the provider.");
      listProviders(projectId).then((r) => setProviders(r || []));
      return;
    }
    toast.success(`"${row.name}" removed.`);
  };

  const columns = [
    {
      key: "name",
      header: "Name",
      render: (row) => (
        <div className="flex flex-col gap-1">
          <span className="font-medium text-foreground">{row.name}</span>
          <span className="text-xs text-text-secondary">{providerLabel(row.provider)}</span>
        </div>
      ),
    },
    {
      key: "key",
      header: "Key",
      render: (row) =>
        row.builtIn ? (
          <Badge variant="info">Metered</Badge>
        ) : row.keyLast4 ? (
          <span className="font-mono text-xs text-text-secondary">•••• {row.keyLast4}</span>
        ) : (
          <span className="text-xs text-text-tertiary">Not connected</span>
        ),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => <StatusPill status={row.status} map={PROVIDER_STATUS_MAP} />,
    },
    {
      key: "models",
      header: "Models",
      render: (row) => (
        <div className="flex max-w-xs flex-wrap gap-1">
          {(row.models || []).slice(0, 3).map((m) => (
            <Badge key={m} variant="neutral">
              {m}
            </Badge>
          ))}
          {(row.models || []).length > 3 ? (
            <span className="text-xs text-text-tertiary">+{row.models.length - 3}</span>
          ) : null}
        </div>
      ),
    },
    {
      key: "lastChecked",
      header: "Last checked",
      render: (row) => (
        <span className="text-xs text-text-secondary">
          {row.lastCheckedAt ? formatRelative(row.lastCheckedAt) : "Never"}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      className: "text-right",
      render: (row) => (
        <ActionMenu
          label={`Actions for ${row.name}`}
          items={[
            {
              icon: testingId === row.id ? Loader2 : RefreshCw,
              label: "Test",
              onSelect: () => handleTest(row),
              disabled: !canManage || testingId === row.id,
              spin: testingId === row.id,
            },
            !row.builtIn && {
              icon: Pencil,
              label: "Edit",
              onSelect: () => openEdit(row),
              disabled: !canManage,
            },
            !row.builtIn && { separator: true },
            !row.builtIn && {
              icon: Trash2,
              label: "Delete",
              variant: "destructive",
              onSelect: () => setDeleteTarget(row),
              disabled: !canManage,
            },
          ]}
        />
      ),
    },
  ];

  return (
    <MainScreenWrapper>
      <ScreenHeader
        title="Model Providers"
        description="Connect the model APIs your pipelines call. Keys are stored in Vault — only the last 4 characters are ever shown again."
        actions={
          canManage ? (
            <Button className="bg-primary text-primary-foreground hover:bg-primary/90" onClick={openCreate}>
              <Plus className="h-4 w-4" /> Add provider
            </Button>
          ) : null
        }
      />

      {loading ? (
        <LoadingArea panel label="Loading providers" />
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          getRowKey={(row) => row.id}
          empty={
            <EmptyState
              icon={Cpu}
              title="No model providers yet"
              description="Add a provider so pipelines have a model to call."
              action={
                canManage ? (
                  <Button className="bg-primary text-primary-foreground hover:bg-primary/90" onClick={openCreate}>
                    <Plus className="h-4 w-4" /> Add provider
                  </Button>
                ) : null
              }
            />
          }
        />
      )}

      <ProviderDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        provider={editing}
        onSave={handleSave}
        saving={saving}
      />

      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete provider</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete{" "}
              <span className="font-medium text-foreground">{deleteTarget?.name}</span>? Pipelines using
              it will stop being able to serve requests.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button className="bg-red-500/90 text-white hover:bg-red-500" onClick={() => handleDelete(deleteTarget)}>
              <Trash2 className="h-4 w-4" /> Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainScreenWrapper>
  );
}

export default ModelProvidersScreen;
