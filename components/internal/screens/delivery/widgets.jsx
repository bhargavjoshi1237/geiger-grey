"use client";

import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { MessageCircle, Pencil, Plus, Power, Trash2 } from "lucide-react";

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
import { useProject } from "@/context/project-context";
import { useCan } from "@/context/rbac-context";
import { listWidgets, createWidget, updateWidget, deleteWidget } from "@/lib/supabase/widgets";
import { listPipelines } from "@/lib/supabase/pipelines";
import { listApiKeys } from "@/lib/supabase/api_keys";

import { WidgetSheet } from "./widget_sheet";
import { ConfirmDialog } from "./confirm_dialog";
import { GatedAction } from "./gated_action";
import { WIDGET_STATUS_MAP } from "./constants";

export function WidgetsScreen() {
  const { projectId } = useProject();
  const canManage = useCan("grey.widget.manage");

  const [widgets, setWidgets] = useState([]);
  const [pipelines, setPipelines] = useState([]);
  const [apiKeys, setApiKeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sheetState, setSheetState] = useState({ open: false, widget: null });
  const [deleteTarget, setDeleteTarget] = useState(null);

  useEffect(() => {
    let alive = true;
    Promise.all([listWidgets(projectId), listPipelines(projectId), listApiKeys(projectId)]).then(
      ([w, p, keys]) => {
        if (!alive) return;
        setWidgets(w ?? []);
        setPipelines(p ?? []);
        setApiKeys(keys ?? []);
        setLoading(false);
      },
    );
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
    if (!q) return widgets;
    return widgets.filter((w) => (w.name || "").toLowerCase().includes(q));
  }, [widgets, search]);

  const handleSave = async (payload) => {
    if (sheetState.widget) {
      const updated = await updateWidget(sheetState.widget.id, payload);
      if (!updated) {
        toast.error("Couldn't save the widget.");
        return false;
      }
      setWidgets((prev) => prev.map((w) => (w.id === updated.id ? updated : w)));
      toast.success("Widget updated.");
      return true;
    }
    const created = await createWidget(projectId, { status: "enabled", ...payload });
    if (!created) {
      toast.error("Couldn't create the widget.");
      return false;
    }
    setWidgets((prev) => [created, ...prev]);
    // Switch the sheet into edit mode for the new record instead of closing it,
    // so the embed snippet (which needs the widget's id) shows immediately.
    setSheetState({ open: true, widget: created });
    toast.success("Widget created.");
    return true;
  };

  const handleToggleStatus = async (widget) => {
    const nextStatus = widget.status === "enabled" ? "disabled" : "enabled";
    setWidgets((prev) => prev.map((w) => (w.id === widget.id ? { ...w, status: nextStatus } : w)));
    const updated = await updateWidget(widget.id, { status: nextStatus });
    if (!updated) {
      setWidgets((prev) => prev.map((w) => (w.id === widget.id ? widget : w)));
      toast.error("Couldn't update the widget's status.");
    }
  };

  const handleDelete = async (widget) => {
    setWidgets((prev) => prev.filter((w) => w.id !== widget.id));
    toast.success("Widget deleted.");
    const ok = await deleteWidget(widget.id);
    if (!ok) {
      setWidgets((prev) => [widget, ...prev]);
      toast.error("Couldn't delete the widget on the server.");
    }
  };

  const columns = [
    {
      key: "name",
      header: "Name",
      render: (w) => (
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-card text-muted-foreground">
            <MessageCircle className="h-4 w-4" />
          </div>
          <span className="font-medium text-foreground">{w.name || "Untitled"}</span>
        </div>
      ),
    },
    {
      key: "pipeline",
      header: "Pipeline",
      render: (w) => (
        <span className="text-sm text-text-secondary">{pipelineNames[w.pipelineId] || "—"}</span>
      ),
    },
    {
      key: "domains",
      header: "Domains",
      render: (w) => (
        <span className="text-sm text-text-secondary">
          {w.allowedDomains?.length ? w.allowedDomains.join(", ") : "Any"}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (w) => <StatusPill status={w.status} map={WIDGET_STATUS_MAP} />,
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (w) => (
        <ActionMenu
          label={`Actions for ${w.name}`}
          items={[
            {
              icon: Pencil,
              label: "Edit",
              disabled: !canManage,
              onSelect: () => setSheetState({ open: true, widget: w }),
            },
            {
              icon: Power,
              label: w.status === "enabled" ? "Disable" : "Enable",
              disabled: !canManage,
              onSelect: () => handleToggleStatus(w),
            },
            { separator: true },
            {
              icon: Trash2,
              label: "Delete",
              destructive: true,
              disabled: !canManage,
              onSelect: () => setDeleteTarget(w),
            },
          ]}
        />
      ),
    },
  ];

  return (
    <MainScreenWrapper>
      <ScreenHeader
        title="Widgets"
        description="Embed a chat bubble on your own site, scoped to a pipeline and the domains you allow."
        actions={
          <GatedAction allowed={canManage} reason="You don't have permission to manage widgets.">
            <Button onClick={() => setSheetState({ open: true, widget: null })}>
              <Plus className="h-4 w-4" /> New Widget
            </Button>
          </GatedAction>
        }
      />

      <Toolbar>
        <SearchInput value={search} onChange={setSearch} placeholder="Search widgets…" />
      </Toolbar>

      {loading ? (
        <LoadingArea panel label="Loading widgets" />
      ) : (
        <DataTable
          columns={columns}
          data={filtered}
          getRowKey={(w) => w.id}
          onRowClick={(w) => canManage && setSheetState({ open: true, widget: w })}
          empty={
            <div className="rounded-xl border border-border bg-surface-subtle">
              <EmptyState
                icon={MessageCircle}
                title={widgets.length ? "No widgets match your search" : "No widgets yet"}
                description={
                  widgets.length
                    ? "Try a different name."
                    : "Create one to embed a chat bubble on your own site."
                }
              />
            </div>
          }
        />
      )}

      <WidgetSheet
        open={sheetState.open}
        onOpenChange={(open) => setSheetState((d) => ({ ...d, open }))}
        pipelines={pipelines}
        apiKeys={apiKeys}
        initial={sheetState.widget}
        onSave={handleSave}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Delete Widget"
        description={
          <>
            Delete <span className="font-medium text-foreground">{deleteTarget?.name}</span>?
            The embed script will stop responding on any site using it. This can&apos;t be
            undone.
          </>
        }
        confirmLabel="Delete"
        icon={Trash2}
        onConfirm={() => {
          handleDelete(deleteTarget);
          setDeleteTarget(null);
        }}
      />
    </MainScreenWrapper>
  );
}

export default WidgetsScreen;
