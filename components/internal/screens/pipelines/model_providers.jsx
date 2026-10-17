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
import { CAPABILITY_LABELS, capabilitiesOf } from "@/lib/grey/provider_kinds";
import {
  createProvider,
  deleteProvider,
  GREY_HOSTED_ENABLED,
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

  const rows = useMemo(() => (GREY_HOSTED_ENABLED ? [GREY_HOSTED_PROVIDER, ...providers] : providers), [providers]);

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const openEdit = (row) => {
    setEditing(row);
    setDialogOpen(true);
  };

  // Saving a key also runs the connection test server-side; the response carries the tested row.
  const storeSecret = async (row, secret, failMessage) => {
    const { data, error } = await saveProviderSecret(row.id, secret);
    if (error) {
      toast.error(failMessage);
      return { row, tested: false };
    }
    const next = data?.provider
      ? { ...row, ...data.provider }
      : { ...row, keyLast4: data?.keyLast4 ?? row.keyLast4, status: data?.status ?? "unverified" };
    return { row: next, tested: true };
  };

  const announce = (row, verb, tested) => {
    if (tested && row.status === "error") {
      toast.error(`"${row.name}" ${verb}, but the connection test failed — ${row.metadata?.lastError?.message || "check the key."}`);
    } else if (tested && row.status === "ok") {
      toast.success(`"${row.name}" ${verb} and connected.`);
    } else {
      toast.success(`"${row.name}" ${verb}.`);
    }
  };

  const handleSave = async (draft, secret) => {
    setSaving(true);
    try {
      if (editing) {
        const saved = await updateProvider(editing.id, draft);
        if (!saved) {
          toast.error("Couldn't save the provider.");
          return;
        }
        const { row: next, tested } = secret
          ? await storeSecret(saved, secret, "Saved, but the key couldn't be stored.")
          : { row: saved, tested: false };
        setProviders((prev) => prev.map((p) => (p.id === next.id ? next : p)));
        announce(next, "updated", tested);
      } else {
        const created = await createProvider(projectId, draft);
        if (!created) {
          toast.error("Couldn't create the provider.");
          return;
        }
        const { row: next, tested } = secret
          ? await storeSecret(created, secret, "Created, but the key couldn't be stored.")
          : { row: created, tested: false };
        setProviders((prev) => [next, ...prev]);
        announce(next, "added", tested);
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
    if (data.status === "ok") toast.success(`"${row.name}" is connected.`);
    else if (data.status === "error") {
      toast.error(`"${row.name}" couldn't be verified — ${data.metadata?.lastError?.message || "check the key."}`);
    } else toast(`Nothing on "${row.name}" can be tested automatically yet.`);
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
          <span className="text-xs text-text-secondary">{providerLabel(row.provider, row.metadata?.preset)}</span>
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
      key: "capabilities",
      header: "Capabilities",
      render: (row) => (
        <div className="flex max-w-xs flex-wrap gap-1">
          {capabilitiesOf(row).map((c) => (
            <Badge key={c} variant="neutral">
              {CAPABILITY_LABELS[c]}
            </Badge>
          ))}
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => (
        <div className="flex flex-col items-start gap-1">
          <StatusPill status={row.status} map={PROVIDER_STATUS_MAP} />
          {row.status === "error" && row.metadata?.lastError?.message ? (
            <span className="line-clamp-2 max-w-56 text-xs text-destructive-text">{row.metadata.lastError.message}</span>
          ) : null}
        </div>
      ),
    },
    {
      key: "models",
      header: "Chat models",
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
      render: (row) =>
        // Grey hosted is metered and built-in — there's nothing to test, edit
        // or delete, so it gets no action menu at all.
        row.builtIn ? null : (
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
              {
                icon: Pencil,
                label: "Edit",
                onSelect: () => openEdit(row),
                disabled: !canManage,
              },
              { separator: true },
              {
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
        description="Connect your own provider accounts for chat, embeddings, rerank and transcription. Keys are stored in Vault — only the last 4 characters are ever shown again."
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
              description="Connect a provider account to generate answers, embed knowledge bases, rerank results or transcribe media."
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
            <Button variant="destructive" onClick={() => handleDelete(deleteTarget)}>
              <Trash2 className="h-4 w-4" /> Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainScreenWrapper>
  );
}

export default ModelProvidersScreen;
