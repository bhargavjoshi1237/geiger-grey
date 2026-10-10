"use client";

import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Copy, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";

import { MainScreenWrapper } from "@/components/internal/shared/screen_wrappers";
import {
  DataTable,
  EmptyState,
  LoadingArea,
  ScreenHeader,
  SectionCard,
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
import { useCan } from "@/context/rbac-context";
import { useProject } from "@/context/project-context";
import { deletePreset, listPresets } from "@/lib/supabase/ingestion_presets";
import { SYSTEM_TIER_PRICES } from "@/lib/grey/cost";
import { formatCurrency, formatRelative } from "@/lib/grey/format";
import { PresetSheet } from "./preset_sheet";
import { PermissionTooltip } from "./permission_tooltip";
import { PRESET_TIER_META } from "./constants";

// "Auto" routes across tiers, so its price is the fast-to-high range rather
// than a single config.prices.perPage figure.
function presetPriceLabel(preset) {
  if (preset.tier === "auto") {
    return `${formatCurrency(SYSTEM_TIER_PRICES.fast, { precise: true })}–${formatCurrency(SYSTEM_TIER_PRICES.high, { precise: true })}/page`;
  }
  const perPage = preset.config?.prices?.perPage;
  return perPage != null ? `${formatCurrency(perPage, { precise: true })}/page` : "—";
}

export function IngestionPresetsScreen() {
  const { projectId } = useProject();
  const canManage = useCan("grey.preset.manage");

  const [presets, setPresets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sheetState, setSheetState] = useState(null); // { preset? , seed? } | null
  const [deleteTarget, setDeleteTarget] = useState(null);

  useEffect(() => {
    let alive = true;
    listPresets(projectId).then((rows) => {
      if (!alive) return;
      setPresets(rows ?? []);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [projectId]);

  const systemPresets = useMemo(() => presets.filter((p) => p.isSystem), [presets]);
  const customPresets = useMemo(() => presets.filter((p) => !p.isSystem), [presets]);

  const upsertPreset = (saved) => {
    setPresets((prev) => {
      const exists = prev.some((p) => p.id === saved.id);
      return exists ? prev.map((p) => (p.id === saved.id ? saved : p)) : [...prev, saved];
    });
  };

  const duplicate = (preset) => {
    setSheetState({
      seed: { name: `${preset.name} (copy)`, description: preset.description, config: preset.config },
    });
  };

  const remove = async () => {
    const preset = deleteTarget;
    setDeleteTarget(null);
    setPresets((prev) => prev.filter((p) => p.id !== preset.id));
    const ok = await deletePreset(preset.id);
    if (!ok) {
      toast.error("Couldn't delete the preset.");
      setPresets((prev) => [...prev, preset]);
      return;
    }
    toast.success(`Deleted "${preset.name}".`);
  };

  const columns = [
    { key: "name", header: "Name", render: (p) => <span className="font-medium text-foreground">{p.name}</span> },
    { key: "tier", header: "Tier", render: () => <Badge variant="purple">Custom</Badge> },
    { key: "price", header: "Price / page", render: presetPriceLabel },
    {
      key: "description",
      header: "Description",
      render: (p) => <span className="text-text-secondary">{p.description || "—"}</span>,
    },
    {
      key: "updated",
      header: "Updated",
      align: "right",
      className: "text-right",
      render: (p) => formatRelative(p.updatedAt),
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
            canManage && { icon: Pencil, label: "Edit", onSelect: () => setSheetState({ preset: p }) },
            canManage && { icon: Copy, label: "Duplicate", onSelect: () => duplicate(p) },
            canManage && { separator: true },
            canManage && {
              icon: Trash2,
              label: "Delete",
              destructive: true,
              onSelect: () => setDeleteTarget(p),
            },
          ]}
        />
      ),
    },
  ];

  return (
    <MainScreenWrapper>
      <ScreenHeader
        title="Ingestion Presets"
        description="Presets bundle a parser, chunking strategy, and pricing. Pick one when creating a knowledge base, or define your own."
        actions={
          canManage ? (
            <Button
              className="bg-primary text-primary-foreground hover:bg-primary/90"
              onClick={() => setSheetState({})}
            >
              <Plus className="h-4 w-4" /> New preset
            </Button>
          ) : null
        }
      />

      {loading ? (
        <LoadingArea label="Loading presets" panel />
      ) : (
        <>
          <SectionCard title="System presets" description="Built in, read-only — duplicate one to customize it.">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {systemPresets.map((preset) => {
                const meta = PRESET_TIER_META[preset.tier] || PRESET_TIER_META.custom;
                return (
                  <div
                    key={preset.id}
                    className="flex flex-col gap-2 rounded-xl border border-border bg-surface-subtle p-4"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-foreground">{preset.name || meta.label}</span>
                      <Sparkles className="h-3.5 w-3.5 text-text-tertiary" />
                    </div>
                    <span className="text-xs font-medium text-muted-foreground">{presetPriceLabel(preset)}</span>
                    <p className="flex-1 text-xs text-text-secondary">{preset.description || meta.description}</p>
                    <PermissionTooltip
                      disabled={!canManage}
                      reason="You don't have permission to manage presets."
                    >
                      <Button
                        variant="outline"
                        size="sm"
                        className="self-start border-border bg-transparent text-muted-foreground hover:bg-surface-active hover:text-foreground"
                        onClick={() => duplicate(preset)}
                        disabled={!canManage}
                      >
                        <Copy className="h-3.5 w-3.5" /> Duplicate
                      </Button>
                    </PermissionTooltip>
                  </div>
                );
              })}
            </div>
          </SectionCard>

          <SectionCard title="Custom presets" description="Your project's own ingestion presets.">
            <DataTable
              columns={columns}
              data={customPresets}
              getRowKey={(p) => p.id}
              empty={
                <div className="rounded-xl border border-border bg-surface-subtle">
                  <EmptyState
                    icon={Sparkles}
                    title="No custom presets yet"
                    description="Duplicate a system preset or create one from scratch."
                    action={
                      canManage ? (
                        <Button
                          className="bg-primary text-primary-foreground hover:bg-primary/90"
                          onClick={() => setSheetState({})}
                        >
                          <Plus className="h-4 w-4" /> New preset
                        </Button>
                      ) : null
                    }
                  />
                </div>
              }
            />
          </SectionCard>
        </>
      )}

      {sheetState ? (
        <PresetSheet
          key={sheetState.preset?.id || "new"}
          open
          onOpenChange={(open) => !open && setSheetState(null)}
          projectId={projectId}
          preset={sheetState.preset}
          seed={sheetState.seed}
          onSaved={upsertPreset}
        />
      ) : null}

      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete preset</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete{" "}
              <span className="font-medium text-foreground">{deleteTarget?.name}</span>? Knowledge
              bases using it keep their current settings. This action can&apos;t be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button className="bg-red-500/90 text-white hover:bg-red-500" onClick={remove}>
              <Trash2 className="h-4 w-4" /> Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainScreenWrapper>
  );
}

export default IngestionPresetsScreen;
