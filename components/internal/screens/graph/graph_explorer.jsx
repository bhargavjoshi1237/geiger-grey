"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Share2, Upload } from "lucide-react";
import { Button } from "@geiger/ui/button";
import { LoadingArea } from "@geiger/ui";
import { useProject } from "@/context/project-context";
import { useCan } from "@/context/rbac-context";
import { useWorkspaceUrl } from "@/lib/hooks/use-workspace-url";
import { MainScreenWrapper } from "@/components/internal/shared/screen_wrappers";
import { ScreenHeader, SectionCard, Toolbar, SearchInput, EmptyState } from "@/components/internal/shared/screen_kit";
import FilterDropdown from "@/components/internal/shared/filter_dropdown";
import {
  ensureDefaultOntology,
  listEntities,
  listRelations,
  listMentions,
} from "@/lib/supabase/graph";
import { listKnowledgeBases } from "@/lib/supabase/knowledge_bases";
import { listSources } from "@/lib/supabase/sources";
import { KnowledgeGraph } from "./knowledge_graph";
import { EntityPanel } from "./entity_panel";
import { EntityDialog } from "./entity_dialog";

export function GraphExplorerScreen() {
  const { projectId } = useProject();
  const url = useWorkspaceUrl();
  const canEdit = useCan("grey.graph.edit");

  const [loading, setLoading] = useState(true);
  const [types, setTypes] = useState([]);
  const [entities, setEntities] = useState([]);
  const [relations, setRelations] = useState([]);
  const [knowledgeBases, setKnowledgeBases] = useState([]);
  const [sources, setSources] = useState([]);
  const [entityKbIds, setEntityKbIds] = useState(new Map());

  const [activeTypeIds, setActiveTypeIds] = useState(new Set());
  const [kbFilter, setKbFilter] = useState("");
  const [search, setSearch] = useState("");
  const [entityDialogOpen, setEntityDialogOpen] = useState(false);

  const selectedEntityId = url.params?.entity || null;

  const load = useCallback(() => {
    if (!projectId) return;
    Promise.all([
      ensureDefaultOntology(projectId),
      listEntities(projectId),
      listRelations(projectId),
      listKnowledgeBases(projectId),
      listSources(projectId),
      listMentions(projectId),
    ]).then(([typeRows, entityRows, relationRows, kbRows, sourceRows, mentionRows]) => {
      setTypes(typeRows ?? []);
      setEntities(entityRows ?? []);
      setRelations(relationRows ?? []);
      setKnowledgeBases(kbRows ?? []);
      setSources(sourceRows ?? []);

      const sourceById = new Map((sourceRows ?? []).map((s) => [s.id, s]));
      const nextEntityKbIds = new Map();
      for (const mention of mentionRows ?? []) {
        const source = sourceById.get(mention.sourceId);
        if (!source) continue;
        const set = nextEntityKbIds.get(mention.entityId) || new Set();
        set.add(source.kbId);
        nextEntityKbIds.set(mention.entityId, set);
      }
      setEntityKbIds(nextEntityKbIds);
      setLoading(false);
    });
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  const entityTypes = useMemo(() => types.filter((t) => t.kind === "entity"), [types]);
  const liveEntities = useMemo(() => entities.filter((e) => !e.mergedInto), [entities]);

  const filteredEntities = useMemo(() => {
    return liveEntities.filter((entity) => {
      if (activeTypeIds.size && !activeTypeIds.has(entity.typeId)) return false;
      if (kbFilter && !entityKbIds.get(entity.id)?.has(kbFilter)) return false;
      return true;
    });
  }, [liveEntities, activeTypeIds, kbFilter, entityKbIds]);

  const searchMatches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return filteredEntities
      .filter(
        (entity) =>
          entity.name?.toLowerCase().includes(q) ||
          entity.aliases?.some((alias) => alias.toLowerCase().includes(q)),
      )
      .slice(0, 8);
  }, [filteredEntities, search]);

  const selectedEntity = useMemo(
    () => entities.find((e) => e.id === selectedEntityId) || null,
    [entities, selectedEntityId],
  );

  const toggleType = (typeId) => {
    setActiveTypeIds((prev) => {
      const next = new Set(prev);
      if (next.has(typeId)) next.delete(typeId);
      else next.add(typeId);
      return next;
    });
  };

  const selectEntity = (id) => {
    if (id) url.openRecord("entity", id);
    else url.closeRecord("entity");
  };

  const kbOptions = [
    { value: "", label: "All knowledge bases" },
    ...knowledgeBases.map((kb) => ({ value: kb.id, label: kb.name })),
  ];

  return (
    <MainScreenWrapper className="lg:flex lg:h-full lg:flex-col lg:gap-6 lg:space-y-0 lg:overflow-hidden lg:py-0">
      <ScreenHeader
        title="Graph Explorer"
        description="Entities and relations extracted from your sources, visualized as a graph."
        actions={
          canEdit ? (
            <Button
              className="bg-primary text-primary-foreground hover:bg-primary/90"
              onClick={() => setEntityDialogOpen(true)}
            >
              <Plus className="h-4 w-4" /> Add entity
            </Button>
          ) : undefined
        }
        className="lg:shrink-0"
      />

      <div className="lg:shrink-0">
        <Toolbar>
          <div className="flex flex-wrap items-center gap-1.5">
            {entityTypes.map((type) => {
              const active = activeTypeIds.has(type.id);
              return (
                <button
                  key={type.id}
                  type="button"
                  onClick={() => toggleType(type.id)}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                    active
                      ? "border-primary bg-surface-card text-foreground"
                      : "border-border bg-surface-subtle text-text-secondary hover:bg-surface-card hover:text-foreground"
                  }`}
                >
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: `var(--${type.color || "chart-1"})` }}
                  />
                  {type.name}
                </button>
              );
            })}
            <FilterDropdown value={kbFilter} onValueChange={setKbFilter} options={kbOptions} placeholder="All knowledge bases" />
          </div>
          <SearchInput value={search} onChange={setSearch} placeholder="Search entities…" />
        </Toolbar>

        {search.trim() ? (
          <div className="mt-2 rounded-lg border border-border bg-surface-subtle p-2">
            {searchMatches.length ? (
              <div className="flex flex-wrap gap-1.5">
                {searchMatches.map((entity) => (
                  <button
                    key={entity.id}
                    type="button"
                    onClick={() => {
                      selectEntity(entity.id);
                      setSearch("");
                    }}
                    className="rounded-md border border-border bg-surface-card px-2.5 py-1 text-xs text-foreground hover:bg-surface-active"
                  >
                    {entity.name}
                  </button>
                ))}
              </div>
            ) : (
              <p className="px-1 py-0.5 text-xs text-text-tertiary">No entities match “{search}”.</p>
            )}
          </div>
        ) : null}
      </div>

      <SectionCard
        className="lg:min-h-0 lg:flex-1"
        bodyPadding={false}
        contentClassName="h-[560px] lg:h-full"
      >
        {loading ? (
          <LoadingArea label="Loading graph" />
        ) : filteredEntities.length === 0 ? (
          <EmptyState
            icon={Share2}
            title={liveEntities.length ? "No entities match these filters" : "No entities yet"}
            description={
              liveEntities.length
                ? "Clear the type or knowledge base filters to see the full graph."
                : "Entities appear automatically once sources are ingested with graph extraction on, or you can add them by hand."
            }
            action={
              liveEntities.length === 0 ? (
                <div className="flex flex-wrap justify-center gap-2">
                  {canEdit ? (
                    <Button
                      className="bg-primary text-primary-foreground hover:bg-primary/90"
                      onClick={() => setEntityDialogOpen(true)}
                    >
                      <Plus className="h-4 w-4" /> Add entity
                    </Button>
                  ) : null}
                  <Button
                    variant="outline"
                    className="border-border bg-transparent text-muted-foreground hover:bg-surface-active hover:text-foreground"
                    onClick={() => url.setTab("Sources")}
                  >
                    <Upload className="h-4 w-4" /> Upload sources
                  </Button>
                </div>
              ) : undefined
            }
          />
        ) : (
          <KnowledgeGraph
            entities={filteredEntities}
            relations={relations}
            types={types}
            selectedId={selectedEntityId}
            onSelect={selectEntity}
            height="100%"
          />
        )}
      </SectionCard>

      <EntityPanel
        open={Boolean(selectedEntity)}
        onOpenChange={(next) => !next && selectEntity(null)}
        entity={selectedEntity}
        projectId={projectId}
        types={types}
        entities={entities}
        relations={relations}
        sources={sources}
        onChanged={load}
      />

      <EntityDialog
        open={entityDialogOpen}
        onOpenChange={setEntityDialogOpen}
        types={entityTypes}
        projectId={projectId}
        onSaved={(saved) => {
          load();
          if (saved?.id) selectEntity(saved.id);
        }}
      />
    </MainScreenWrapper>
  );
}

export default GraphExplorerScreen;
