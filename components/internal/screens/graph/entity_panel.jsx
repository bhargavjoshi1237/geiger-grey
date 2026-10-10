"use client";

// Sheet opened from a graph node (or the Entities table): entity details, relations
// (add/remove), mentions with a jump to their source, and quick actions.
//
// types/entities/relations/sources can be passed down from a parent screen that already has
// them loaded (Graph Explorer, Entities) to avoid a redundant fetch; any left out are fetched
// here instead. Mentions are always fetched — they're specific to the open entity and no parent
// keeps a project-wide copy.
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ExternalLink, MessageSquare, Pencil, Plus, Trash2 } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  LoadingArea,
} from "@geiger/ui";
import { Button } from "@geiger/ui/button";
import { Badge } from "@geiger/ui/badge";
import { useCan } from "@/context/rbac-context";
import { useWorkspaceUrl } from "@/lib/hooks/use-workspace-url";
import { listTypes, listEntities, listRelations, listMentions, createRelation, deleteRelation } from "@/lib/supabase/graph";
import { listSources } from "@/lib/supabase/sources";
import { SOURCE_APP_MAP, confidenceLabel } from "./constants";
import { EntityDialog } from "./entity_dialog";

export function EntityPanel({
  open,
  onOpenChange,
  entity,
  projectId,
  onChanged,
  types: typesProp,
  entities: entitiesProp,
  relations: relationsProp,
  sources: sourcesProp,
}) {
  const url = useWorkspaceUrl();
  const canEdit = useCan("grey.graph.edit");
  const [loading, setLoading] = useState(true);
  const [typesState, setTypesState] = useState([]);
  const [entitiesState, setEntitiesState] = useState([]);
  // Relations are mutated here (add/remove), so they always live in local state — seeded from
  // the prop when the caller has one, otherwise fetched below.
  const [relations, setRelations] = useState(relationsProp || []);
  const [mentions, setMentions] = useState([]);
  const [sourcesState, setSourcesState] = useState([]);
  const [editOpen, setEditOpen] = useState(false);
  const [newRelationTypeId, setNewRelationTypeId] = useState("");
  const [newTargetId, setNewTargetId] = useState("");
  const [savingRelation, setSavingRelation] = useState(false);

  const types = typesProp || typesState;
  const entities = entitiesProp || entitiesState;
  const sources = sourcesProp || sourcesState;

  // Reset to a loading state during render (not inside the fetch effect below) whenever the
  // panel opens for a different entity, so the fetch effect itself never calls setState
  // synchronously outside of its promise callback. Re-seed relations from the freshest prop too.
  const loadKey = open && entity?.id ? entity.id : null;
  const [loadedFor, setLoadedFor] = useState(loadKey);
  if (loadedFor !== loadKey) {
    setLoadedFor(loadKey);
    if (loadKey) {
      setLoading(true);
      if (relationsProp) setRelations(relationsProp);
    }
  }

  useEffect(() => {
    if (!open || !entity?.id || !projectId) return undefined;
    let alive = true;
    Promise.all([
      typesProp ? Promise.resolve(typesProp) : listTypes(projectId),
      entitiesProp ? Promise.resolve(entitiesProp) : listEntities(projectId),
      relationsProp ? Promise.resolve(relationsProp) : listRelations(projectId),
      listMentions(projectId, { entityId: entity.id }),
      sourcesProp ? Promise.resolve(sourcesProp) : listSources(projectId),
    ]).then(([typeRows, entityRows, relationRows, mentionRows, sourceRows]) => {
      if (!alive) return;
      if (!typesProp) setTypesState(typeRows ?? []);
      if (!entitiesProp) setEntitiesState(entityRows ?? []);
      if (!relationsProp) setRelations(relationRows ?? []);
      setMentions(mentionRows ?? []);
      if (!sourcesProp) setSourcesState(sourceRows ?? []);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [open, entity?.id, projectId, typesProp, entitiesProp, relationsProp, sourcesProp]);

  const typeById = useMemo(() => new Map(types.map((t) => [t.id, t])), [types]);
  const entityById = useMemo(() => new Map(entities.map((e) => [e.id, e])), [entities]);
  const sourceById = useMemo(() => new Map(sources.map((s) => [s.id, s])), [sources]);
  const relationTypes = useMemo(() => types.filter((t) => t.kind === "relation"), [types]);
  const entityTypes = useMemo(() => types.filter((t) => t.kind === "entity"), [types]);

  const entityRelations = useMemo(
    () => relations.filter((r) => r.sourceEntityId === entity?.id || r.targetEntityId === entity?.id),
    [relations, entity?.id],
  );

  const addRelation = async () => {
    if (!newRelationTypeId || !newTargetId) {
      toast.error("Choose a relation type and a target entity.");
      return;
    }
    const tempId = `temp-${crypto.randomUUID()}`;
    const typeId = newRelationTypeId;
    const targetEntityId = newTargetId;
    // Optimistic: show the relation immediately, swap in the real row (or roll back) once the
    // request settles — no refetch either way.
    setRelations((prev) => [...prev, { id: tempId, sourceEntityId: entity.id, targetEntityId, typeId }]);
    setNewRelationTypeId("");
    setNewTargetId("");
    setSavingRelation(true);
    try {
      const saved = await createRelation(projectId, { sourceEntityId: entity.id, targetEntityId, typeId });
      if (!saved) {
        setRelations((prev) => prev.filter((r) => r.id !== tempId));
        toast.error("Couldn't add the relation.");
        return;
      }
      setRelations((prev) => prev.map((r) => (r.id === tempId ? saved : r)));
      toast.success("Relation added.");
      onChanged?.();
    } finally {
      setSavingRelation(false);
    }
  };

  const removeRelation = async (relation) => {
    // Optimistic: drop it immediately, restore it on failure — no refetch either way.
    setRelations((prev) => prev.filter((r) => r.id !== relation.id));
    const ok = await deleteRelation(relation.id);
    if (!ok) {
      setRelations((prev) => [...prev, relation]);
      toast.error("Couldn't remove the relation.");
      return;
    }
    toast.success("Relation removed.");
    onChanged?.();
  };

  const askAboutThis = () => {
    if (!entity) return;
    url.setTab("Chat", { q: `What do we know about ${entity.name}?` });
  };

  const openSource = (sourceId) => {
    url.setTab("Sources", { source: sourceId });
  };

  if (!entity) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="w-full gap-0 p-0 sm:max-w-lg" />
      </Sheet>
    );
  }

  const type = typeById.get(entity.typeId);
  const sourceAppMeta = SOURCE_APP_MAP[entity.sourceApp] || SOURCE_APP_MAP.manual;

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-lg">
          <SheetHeader className="border-b border-border">
            <div className="flex items-center gap-2 pr-8">
              <SheetTitle className="truncate">{entity.name}</SheetTitle>
              {type ? (
                <Badge variant="neutral" className="shrink-0">
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: `var(--${type.color || "chart-1"})` }}
                  />
                  {type.name}
                </Badge>
              ) : null}
            </div>
            <SheetDescription className="truncate">
              {entity.description || "No description yet."}
            </SheetDescription>
          </SheetHeader>

          {loading ? (
            <LoadingArea label="Loading entity" />
          ) : (
            <div className="scrollbar-subtle min-h-0 flex-1 space-y-6 overflow-y-auto p-4">
              {entity.aliases?.length ? (
                <div>
                  <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-text-secondary">
                    Aliases
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {entity.aliases.map((alias) => (
                      <Badge key={alias} variant="neutral">
                        {alias}
                      </Badge>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="flex flex-wrap items-center gap-2 text-xs text-text-secondary">
                <Badge variant={sourceAppMeta.variant}>{sourceAppMeta.label}</Badge>
                <span>Confidence {confidenceLabel(entity.confidence)}</span>
              </div>

              <div>
                <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-text-secondary">
                  Relations
                </p>
                <div className="space-y-1.5">
                  {entityRelations.length ? (
                    entityRelations.map((relation) => {
                      const outgoing = relation.sourceEntityId === entity.id;
                      const otherId = outgoing ? relation.targetEntityId : relation.sourceEntityId;
                      const other = entityById.get(otherId);
                      const relType = typeById.get(relation.typeId);
                      return (
                        <div
                          key={relation.id}
                          className="flex items-center justify-between gap-2 rounded-lg border border-border bg-surface-card px-3 py-2"
                        >
                          <p className="min-w-0 truncate text-sm text-foreground">
                            <span className="text-text-secondary">{outgoing ? "→" : "←"}</span>{" "}
                            <span className="text-text-secondary">{relType?.name || "related_to"}</span>{" "}
                            {other?.name || "Unknown entity"}
                          </p>
                          {canEdit ? (
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label="Remove relation"
                              className="shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive-text"
                              onClick={() => removeRelation(relation)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          ) : null}
                        </div>
                      );
                    })
                  ) : (
                    <p className="text-sm text-text-tertiary">No relations yet.</p>
                  )}
                </div>

                {canEdit ? (
                  <div className="mt-2 flex gap-2">
                    <Select value={newRelationTypeId} onValueChange={setNewRelationTypeId}>
                      <SelectTrigger className="w-36 shrink-0">
                        <SelectValue placeholder="Relation" />
                      </SelectTrigger>
                      <SelectContent>
                        {relationTypes.map((t) => (
                          <SelectItem key={t.id} value={t.id}>
                            {t.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select value={newTargetId} onValueChange={setNewTargetId}>
                      <SelectTrigger className="min-w-0 flex-1">
                        <SelectValue placeholder="Target entity" />
                      </SelectTrigger>
                      <SelectContent>
                        {entities
                          .filter((e) => e.id !== entity.id && !e.mergedInto)
                          .map((e) => (
                            <SelectItem key={e.id} value={e.id}>
                              {e.name}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                    <Button
                      variant="outline"
                      size="icon"
                      disabled={savingRelation}
                      className="shrink-0 border-border bg-transparent text-muted-foreground hover:bg-surface-active hover:text-foreground"
                      onClick={addRelation}
                      aria-label="Add relation"
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                ) : null}
              </div>

              <div>
                <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-text-secondary">
                  Mentioned in
                </p>
                <div className="space-y-1.5">
                  {mentions.length ? (
                    mentions.map((mention) => {
                      const source = sourceById.get(mention.sourceId);
                      return (
                        <button
                          key={mention.id}
                          type="button"
                          onClick={() => openSource(mention.sourceId)}
                          className="flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-surface-card px-3 py-2 text-left hover:bg-surface-active"
                        >
                          <span className="min-w-0 truncate text-sm text-foreground">
                            {source?.name || "Unknown source"}
                            {mention.page ? (
                              <span className="text-text-tertiary"> · p.{mention.page}</span>
                            ) : null}
                          </span>
                          <ExternalLink className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
                        </button>
                      );
                    })
                  ) : (
                    <p className="text-sm text-text-tertiary">Not mentioned in any source yet.</p>
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between gap-2 border-t border-border p-4">
            <Button
              variant="outline"
              size="sm"
              className="border-border bg-transparent text-muted-foreground hover:bg-surface-active hover:text-foreground"
              onClick={askAboutThis}
            >
              <MessageSquare className="h-4 w-4" /> Ask about this
            </Button>
            {canEdit ? (
              <Button size="sm" variant="ghost" onClick={() => setEditOpen(true)}>
                <Pencil className="h-4 w-4" /> Edit
              </Button>
            ) : null}
          </div>
        </SheetContent>
      </Sheet>

      <EntityDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        entity={entity}
        types={entityTypes}
        projectId={projectId}
        onSaved={() => onChanged?.()}
      />
    </>
  );
}

export default EntityPanel;
