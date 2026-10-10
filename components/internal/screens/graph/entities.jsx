"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Merge, Plus, Share2, Trash2, Pencil } from "lucide-react";
import { Button } from "@geiger/ui/button";
import { Badge } from "@geiger/ui/badge";
import { ActionMenu, LoadingArea } from "@geiger/ui";
import { useProject } from "@/context/project-context";
import { useCan } from "@/context/rbac-context";
import { useWorkspaceUrl } from "@/lib/hooks/use-workspace-url";
import { MainScreenWrapper } from "@/components/internal/shared/screen_wrappers";
import {
  ScreenHeader,
  StatsBar,
  Toolbar,
  SearchInput,
  SegmentedTabs,
  DataTable,
  EmptyState,
} from "@/components/internal/shared/screen_kit";
import { ListPagination, usePagination } from "@/components/internal/shared/pagination";
import { formatRelative } from "@/lib/grey/format";
import { findDuplicateGroups } from "@/lib/grey/duplicates";
import { ensureDefaultOntology, listEntities, listRelations, listMentions, deleteEntity } from "@/lib/supabase/graph";
import { EntityPanel } from "./entity_panel";
import { EntityDialog } from "./entity_dialog";
import { MergeDialog } from "./merge_dialog";
import { ConfirmDialog } from "./confirm_dialog";
import { SOURCE_APP_MAP, confidenceLabel } from "./constants";

export function EntitiesScreen() {
  const { projectId } = useProject();
  const url = useWorkspaceUrl();
  const canEdit = useCan("grey.graph.edit");

  const [loading, setLoading] = useState(true);
  const [types, setTypes] = useState([]);
  const [entities, setEntities] = useState([]);
  const [relations, setRelations] = useState([]);
  const [mentions, setMentions] = useState([]);
  const [search, setSearch] = useState("");
  const [tab, setLocalTab] = useState("all");
  const [entityDialogOpen, setEntityDialogOpen] = useState(false);
  const [editingEntity, setEditingEntity] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [mergeGroup, setMergeGroup] = useState(null);

  const selectedEntityId = url.params?.entity || null;

  const load = useCallback(() => {
    if (!projectId) return;
    Promise.all([
      ensureDefaultOntology(projectId),
      listEntities(projectId),
      listRelations(projectId),
      listMentions(projectId),
    ]).then(([typeRows, entityRows, relationRows, mentionRows]) => {
      setTypes(typeRows ?? []);
      setEntities(entityRows ?? []);
      setRelations(relationRows ?? []);
      setMentions(mentionRows ?? []);
      setLoading(false);
    });
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  const entityTypes = useMemo(() => types.filter((t) => t.kind === "entity"), [types]);
  const typeById = useMemo(() => new Map(types.map((t) => [t.id, t])), [types]);
  const liveEntities = useMemo(() => entities.filter((e) => !e.mergedInto), [entities]);

  const relationCounts = useMemo(() => {
    const map = new Map();
    for (const relation of relations) {
      map.set(relation.sourceEntityId, (map.get(relation.sourceEntityId) || 0) + 1);
      map.set(relation.targetEntityId, (map.get(relation.targetEntityId) || 0) + 1);
    }
    return map;
  }, [relations]);

  const mentionCounts = useMemo(() => {
    const map = new Map();
    for (const mention of mentions) map.set(mention.entityId, (map.get(mention.entityId) || 0) + 1);
    return map;
  }, [mentions]);

  const filteredEntities = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return liveEntities;
    return liveEntities.filter(
      (entity) =>
        entity.name?.toLowerCase().includes(q) || entity.aliases?.some((a) => a.toLowerCase().includes(q)),
    );
  }, [liveEntities, search]);

  const duplicateGroups = useMemo(() => findDuplicateGroups(liveEntities), [liveEntities]);

  const { pageItems, ...pagination } = usePagination(filteredEntities, { resetKey: `${search}-${tab}` });

  const selectedEntity = useMemo(
    () => entities.find((e) => e.id === selectedEntityId) || null,
    [entities, selectedEntityId],
  );

  const selectEntity = (id) => {
    if (id) url.openRecord("entity", id);
    else url.closeRecord("entity");
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    // Optimistic: remove it from the list immediately, roll back on failure — no refetch either way.
    setEntities((prev) => prev.filter((e) => e.id !== target.id));
    const ok = await deleteEntity(target.id);
    if (!ok) {
      setEntities((prev) => [...prev, target]);
      toast.error("Couldn't delete the entity.");
      return;
    }
    toast.success(`Deleted ${target.name}.`);
  };

  const stats = [
    { label: "Entities", value: String(liveEntities.length) },
    { label: "Entity types", value: String(entityTypes.length) },
    { label: "Relations", value: String(relations.length) },
    { label: "Possible duplicates", value: String(duplicateGroups.length) },
  ];

  const columns = [
    {
      key: "name",
      header: "Name",
      render: (row) => {
        const type = typeById.get(row.typeId);
        return (
          <div className="flex items-center gap-2">
            {type ? (
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: `var(--${type.color || "chart-1"})` }}
              />
            ) : null}
            <span className="truncate font-medium text-foreground">{row.name}</span>
          </div>
        );
      },
    },
    {
      key: "type",
      header: "Type",
      render: (row) => typeById.get(row.typeId)?.name || "—",
    },
    { key: "relations", header: "Relations", align: "right", render: (row) => relationCounts.get(row.id) || 0 },
    { key: "mentions", header: "Mentions", align: "right", render: (row) => mentionCounts.get(row.id) || 0 },
    {
      key: "sourceApp",
      header: "Source",
      render: (row) => {
        const meta = SOURCE_APP_MAP[row.sourceApp] || SOURCE_APP_MAP.manual;
        return <Badge variant={meta.variant}>{meta.label}</Badge>;
      },
    },
    { key: "confidence", header: "Confidence", align: "right", render: (row) => confidenceLabel(row.confidence) },
    {
      key: "updated",
      header: "Updated",
      render: (row) => (row.updatedAt ? formatRelative(row.updatedAt) : "—"),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (row) => (
        <ActionMenu
          label={`Actions for ${row.name}`}
          items={[
            canEdit && {
              icon: Pencil,
              label: "Edit",
              onSelect: () => {
                setEditingEntity(row);
                setEntityDialogOpen(true);
              },
            },
            canEdit && { separator: true },
            canEdit && {
              icon: Trash2,
              label: "Delete",
              destructive: true,
              onSelect: () => setDeleteTarget(row),
            },
          ]}
        />
      ),
    },
  ];

  return (
    <MainScreenWrapper>
      <ScreenHeader
        title="Entities"
        description="People, organizations and other nodes extracted from your sources."
        actions={
          canEdit ? (
            <Button
              className="bg-primary text-primary-foreground hover:bg-primary/90"
              onClick={() => {
                setEditingEntity(null);
                setEntityDialogOpen(true);
              }}
            >
              <Plus className="h-4 w-4" /> Add entity
            </Button>
          ) : undefined
        }
      />

      <StatsBar stats={stats} />

      <SegmentedTabs
        tabs={[
          { label: "All entities", value: "all" },
          { label: `Possible duplicates${duplicateGroups.length ? ` (${duplicateGroups.length})` : ""}`, value: "duplicates" },
        ]}
        value={tab}
        onChange={setLocalTab}
      />

      {tab === "all" ? (
        <>
          <Toolbar>
            <div />
            <SearchInput value={search} onChange={setSearch} placeholder="Search entities…" />
          </Toolbar>

          {loading ? (
            <LoadingArea label="Loading entities" />
          ) : (
            <DataTable
              columns={columns}
              data={pageItems}
              getRowKey={(row) => row.id}
              onRowClick={(row) => selectEntity(row.id)}
              empty={
                <EmptyState
                  icon={Share2}
                  title={search ? "No entities match your search" : "No entities yet"}
                  description={
                    search
                      ? "Try a different name or alias."
                      : "Entities appear once sources are ingested with graph extraction on."
                  }
                />
              }
            />
          )}

          <ListPagination {...pagination} itemLabel="entities" />
        </>
      ) : (
        <div className="space-y-3">
          {duplicateGroups.length ? (
            duplicateGroups.map((group) => (
              <div
                key={group.map((e) => e.id).join("-")}
                className="flex flex-col gap-3 rounded-xl border border-border bg-surface-subtle p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex flex-wrap items-center gap-2">
                  {group.map((entity) => (
                    <Badge key={entity.id} variant="neutral">
                      {entity.name}
                    </Badge>
                  ))}
                  <span className="text-xs text-text-tertiary">
                    same type · {typeById.get(group[0].typeId)?.name || "—"}
                  </span>
                </div>
                {canEdit ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-border bg-transparent text-muted-foreground hover:bg-surface-active hover:text-foreground"
                    onClick={() => setMergeGroup(group)}
                  >
                    <Merge className="h-4 w-4" /> Merge
                  </Button>
                ) : null}
              </div>
            ))
          ) : (
            <EmptyState
              icon={Merge}
              title="No likely duplicates"
              description="Entities with matching normalized names or aliases within the same type will show up here."
            />
          )}
        </div>
      )}

      <EntityPanel
        open={Boolean(selectedEntity)}
        onOpenChange={(next) => !next && selectEntity(null)}
        entity={selectedEntity}
        projectId={projectId}
        types={types}
        entities={entities}
        relations={relations}
        onChanged={load}
      />

      <EntityDialog
        open={entityDialogOpen}
        onOpenChange={setEntityDialogOpen}
        entity={editingEntity}
        types={entityTypes}
        projectId={projectId}
        onSaved={load}
      />

      <MergeDialog
        open={Boolean(mergeGroup)}
        onOpenChange={(open) => !open && setMergeGroup(null)}
        group={mergeGroup || []}
        projectId={projectId}
        onMerged={load}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={`Delete ${deleteTarget?.name}?`}
        description="This removes the entity from the graph. Relations and mentions pointing to it will be orphaned. This can't be undone."
        onCancel={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
      />
    </MainScreenWrapper>
  );
}

export default EntitiesScreen;
