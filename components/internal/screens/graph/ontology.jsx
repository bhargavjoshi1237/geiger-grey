"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@geiger/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  LoadingArea,
} from "@geiger/ui";
import { useProject } from "@/context/project-context";
import { useCan } from "@/context/rbac-context";
import { MainScreenWrapper } from "@/components/internal/shared/screen_wrappers";
import { ScreenHeader, SectionCard, EmptyState } from "@/components/internal/shared/screen_kit";
import {
  ensureDefaultOntology,
  listEntities,
  listRelations,
  deleteType,
} from "@/lib/supabase/graph";
import { TypeDialog } from "./type_dialog";

function TypeRow({ type, usageCount, canManage, onEdit, onDelete }) {
  const blocked = usageCount > 0;
  return (
    <div className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
      <div className="flex min-w-0 items-center gap-3">
        <span
          className="h-3 w-3 shrink-0 rounded-full"
          style={{ backgroundColor: `var(--${type.color || "chart-1"})` }}
        />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">{type.name}</p>
          {type.description ? (
            <p className="truncate text-xs text-text-secondary">{type.description}</p>
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <span className="text-xs text-text-tertiary">{usageCount} in use</span>
        {canManage ? (
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon-sm" aria-label={`Edit ${type.name}`} onClick={() => onEdit(type)}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            {blocked ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <Button variant="ghost" size="icon-sm" disabled aria-label={`Delete ${type.name}`}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>This type is used by {usageCount} record{usageCount === 1 ? "" : "s"}.</TooltipContent>
              </Tooltip>
            ) : (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Delete ${type.name}`}
                className="text-muted-foreground hover:bg-red-500/10 hover:text-red-300"
                onClick={() => onDelete(type)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function OntologyScreen() {
  const { projectId } = useProject();
  const canManage = useCan("grey.ontology.manage");

  const [loading, setLoading] = useState(true);
  const [types, setTypes] = useState([]);
  const [entityUsage, setEntityUsage] = useState(new Map());
  const [relationUsage, setRelationUsage] = useState(new Map());
  const [dialogState, setDialogState] = useState(null); // { kind, type? }
  const [deleteTarget, setDeleteTarget] = useState(null);

  const load = useCallback(() => {
    if (!projectId) return;
    Promise.all([ensureDefaultOntology(projectId), listEntities(projectId), listRelations(projectId)]).then(
      ([typeRows, entityRows, relationRows]) => {
        setTypes(typeRows ?? []);
        const entityCounts = new Map();
        for (const entity of entityRows ?? []) {
          if (entity.mergedInto) continue;
          entityCounts.set(entity.typeId, (entityCounts.get(entity.typeId) || 0) + 1);
        }
        const relationCounts = new Map();
        for (const relation of relationRows ?? []) {
          relationCounts.set(relation.typeId, (relationCounts.get(relation.typeId) || 0) + 1);
        }
        setEntityUsage(entityCounts);
        setRelationUsage(relationCounts);
        setLoading(false);
      },
    );
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  const entityTypes = useMemo(() => types.filter((t) => t.kind === "entity"), [types]);
  const relationTypes = useMemo(() => types.filter((t) => t.kind === "relation"), [types]);

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const ok = await deleteType(deleteTarget.id);
    setDeleteTarget(null);
    if (!ok) {
      toast.error("Couldn't delete the type.");
      return;
    }
    toast.success(`Deleted ${deleteTarget.name}.`);
    load();
  };

  if (loading) {
    return (
      <MainScreenWrapper>
        <ScreenHeader title="Ontology" description="The entity and relation types used across the knowledge graph." />
        <LoadingArea label="Loading ontology" />
      </MainScreenWrapper>
    );
  }

  return (
    <MainScreenWrapper>
      <ScreenHeader title="Ontology" description="The entity and relation types used across the knowledge graph." />

      <SectionCard
        title="Entity types"
        description="Classify the nodes of the graph."
        action={
          canManage ? (
            <Button
              size="sm"
              variant="outline"
              className="border-border bg-transparent text-muted-foreground hover:bg-surface-active hover:text-foreground"
              onClick={() => setDialogState({ kind: "entity" })}
            >
              <Plus className="h-4 w-4" /> Add type
            </Button>
          ) : undefined
        }
      >
        {entityTypes.length ? (
          <div className="divide-y divide-border">
            {entityTypes.map((type) => (
              <TypeRow
                key={type.id}
                type={type}
                usageCount={entityUsage.get(type.id) || 0}
                canManage={canManage}
                onEdit={(t) => setDialogState({ kind: "entity", type: t })}
                onDelete={setDeleteTarget}
              />
            ))}
          </div>
        ) : (
          <EmptyState title="No entity types yet" description="Add one to start classifying entities." />
        )}
      </SectionCard>

      <SectionCard
        title="Relation types"
        description="Classify the edges connecting entities."
        action={
          canManage ? (
            <Button
              size="sm"
              variant="outline"
              className="border-border bg-transparent text-muted-foreground hover:bg-surface-active hover:text-foreground"
              onClick={() => setDialogState({ kind: "relation" })}
            >
              <Plus className="h-4 w-4" /> Add type
            </Button>
          ) : undefined
        }
      >
        {relationTypes.length ? (
          <div className="divide-y divide-border">
            {relationTypes.map((type) => (
              <TypeRow
                key={type.id}
                type={type}
                usageCount={relationUsage.get(type.id) || 0}
                canManage={canManage}
                onEdit={(t) => setDialogState({ kind: "relation", type: t })}
                onDelete={setDeleteTarget}
              />
            ))}
          </div>
        ) : (
          <EmptyState title="No relation types yet" description="Add one to start classifying relations." />
        )}
      </SectionCard>

      <TypeDialog
        open={Boolean(dialogState)}
        onOpenChange={(open) => !open && setDialogState(null)}
        kind={dialogState?.kind}
        type={dialogState?.type}
        projectId={projectId}
        onSaved={load}
      />

      <Dialog open={Boolean(deleteTarget)} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete {deleteTarget?.name}?</DialogTitle>
            <DialogDescription>This type is unused and can be safely removed. This can&apos;t be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button className="bg-red-500/90 text-white hover:bg-red-500" onClick={confirmDelete}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainScreenWrapper>
  );
}

export default OntologyScreen;
