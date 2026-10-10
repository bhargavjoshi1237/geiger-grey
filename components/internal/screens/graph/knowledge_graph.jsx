"use client";

// Props-driven 2D/3D force graph for kg_entities/kg_relations. No fetching and no fallback
// demo data (the old components/grey/knowledge-graph.jsx had both) — the caller filters and
// passes entities/relations/types; this only renders and reports selection.
import dynamic from "next/dynamic";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "next-themes";
import { ChevronDown, Maximize2, Minus, Plus, RotateCcw, Settings2 } from "lucide-react";

const ForceGraph2D = dynamic(
  () => import("react-force-graph-2d").then((mod) => mod.default),
  { ssr: false },
);

const ForceGraph3D = dynamic(
  () => import("react-force-graph-3d").then((mod) => mod.default),
  { ssr: false },
);

const DEFAULT_FORCES = { center: 0.04, repel: 260, link: 0.22, distance: 118 };
const FALLBACK_TOKENS = {
  background: "#161616",
  foreground: "#e7e7e7",
  border: "#333333",
  muted: "#a3a3a3",
};

// Blends a resolved token colour with transparency via CSS color-mix() instead of hand-rolled
// rgba() math, which would otherwise assume the token is a hex/rgb value.
function mix(color, percent) {
  return `color-mix(in srgb, ${color} ${percent}%, transparent)`;
}

function getNodeId(nodeOrId) {
  return typeof nodeOrId === "object" && nodeOrId !== null ? nodeOrId.id : nodeOrId;
}

// Resolves the semantic CSS tokens (background/foreground/border/muted + per-type chart colour)
// at runtime via getComputedStyle, re-reading whenever the type list or the resolved theme changes.
function useGraphTokens(types) {
  const { resolvedTheme } = useTheme();
  const [tokens, setTokens] = useState(FALLBACK_TOKENS);
  const [typeColors, setTypeColors] = useState({});

  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") return undefined;
    let cancelled = false;

    // Deferred a frame so the resolved values land in a microtask rather than synchronously
    // inside the effect body — the tokens still only ever reflect the latest types/theme.
    const frame = requestAnimationFrame(() => {
      if (cancelled) return;
      const style = getComputedStyle(document.documentElement);
      const read = (name, fallback) => style.getPropertyValue(name).trim() || fallback;

      setTokens({
        background: read("--background", FALLBACK_TOKENS.background),
        foreground: read("--foreground", FALLBACK_TOKENS.foreground),
        border: read("--border", FALLBACK_TOKENS.border),
        muted: read("--muted-foreground", FALLBACK_TOKENS.muted),
      });

      const nextTypeColors = {};
      for (const type of types || []) {
        const varName = `--${type.color || "chart-1"}`;
        nextTypeColors[type.id] = read(varName, FALLBACK_TOKENS.muted);
      }
      setTypeColors(nextTypeColors);
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [types, resolvedTheme]);

  return { tokens, typeColors };
}

function useElementSize(ref) {
  const [size, setSize] = useState({ width: 1200, height: 800 });

  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const observer = new ResizeObserver(([entry]) => {
      setSize({
        width: Math.max(1, Math.floor(entry.contentRect.width)),
        height: Math.max(1, Math.floor(entry.contentRect.height)),
      });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return size;
}

export function KnowledgeGraph({ entities = [], relations = [], types = [], onSelect, selectedId, height }) {
  const fgRef = useRef(null);
  const wrapRef = useRef(null);
  const { width, height: measuredHeight } = useElementSize(wrapRef);
  const [hovered, setHovered] = useState(null);
  const [graphMode, setGraphMode] = useState("3d");
  const [forcesOpen, setForcesOpen] = useState(false);
  const [forces, setForces] = useState(DEFAULT_FORCES);
  const { tokens, typeColors } = useGraphTokens(types);

  const typesById = useMemo(() => new Map((types || []).map((t) => [t.id, t])), [types]);

  const graph = useMemo(() => {
    const nodes = entities.map((entity) => ({
      id: entity.id,
      label: entity.name,
      typeId: entity.typeId,
      typeName: typesById.get(entity.typeId)?.name || "",
    }));
    const nodeIds = new Set(nodes.map((n) => n.id));
    const links = relations
      .filter((rel) => nodeIds.has(rel.sourceEntityId) && nodeIds.has(rel.targetEntityId))
      .map((rel) => ({
        id: rel.id,
        source: rel.sourceEntityId,
        target: rel.targetEntityId,
        typeId: rel.typeId,
      }));
    return { nodes, links };
  }, [entities, relations, typesById]);

  const hasGraphSize = width > 40 && measuredHeight > 40;

  const adjacency = useMemo(() => {
    const map = new Map();
    graph.nodes.forEach((node) => map.set(node.id, new Set()));
    graph.links.forEach((link) => {
      const source = getNodeId(link.source);
      const target = getNodeId(link.target);
      map.get(source)?.add(target);
      map.get(target)?.add(source);
    });
    return map;
  }, [graph]);

  const degreeById = useMemo(() => {
    const map = new Map();
    adjacency.forEach((set, id) => map.set(id, set.size));
    return map;
  }, [adjacency]);

  const selectedNode = useMemo(
    () => graph.nodes.find((node) => node.id === selectedId),
    [graph.nodes, selectedId],
  );

  const resetView = useCallback(() => {
    fgRef.current?.zoomToFit?.(450, 72);
  }, []);

  const zoomBy = useCallback(
    (delta) => {
      const graphRef = fgRef.current;
      if (!graphRef) return;

      if (graphMode === "2d") {
        const currentZoom = graphRef.zoom();
        graphRef.zoom(Math.min(3, Math.max(0.25, currentZoom + delta)), 180);
        return;
      }

      const camera = graphRef.camera?.();
      if (!camera) return;
      const factor = delta > 0 ? 0.82 : 1.22;
      graphRef.cameraPosition?.(
        {
          x: camera.position.x * factor,
          y: camera.position.y * factor,
          z: camera.position.z * factor,
        },
        undefined,
        180,
      );
    },
    [graphMode],
  );

  useEffect(() => {
    const graphRef = fgRef.current;
    if (!graphRef) return;

    const frame = requestAnimationFrame(() => {
      const charge = graphRef.d3Force?.("charge");
      const link = graphRef.d3Force?.("link");
      const center = graphRef.d3Force?.("center");

      charge?.strength?.(-forces.repel);
      link?.distance?.(forces.distance)?.strength?.(forces.link);
      center?.strength?.(forces.center);
      graphRef.d3ReheatSimulation?.();
    });

    return () => cancelAnimationFrame(frame);
  }, [forces, graph, graphMode]);

  useEffect(() => {
    const frame = requestAnimationFrame(resetView);
    return () => cancelAnimationFrame(frame);
  }, [graph.nodes.length, graph.links.length, resetView]);

  // Centers/zooms onto the selected node whenever selection changes from outside (search,
  // deep link, panel open) as well as from an in-canvas click.
  useEffect(() => {
    if (!selectedId) return undefined;
    const node = graph.nodes.find((n) => n.id === selectedId);
    if (!node) return undefined;

    const frame = requestAnimationFrame(() => {
      if (graphMode === "2d") {
        fgRef.current?.centerAt?.(node.x, node.y, 450);
        fgRef.current?.zoom?.(1.55, 450);
      } else {
        const distance = 180;
        const distRatio = 1 + distance / Math.hypot(node.x || 1, node.y || 1, node.z || 1);
        fgRef.current?.cameraPosition?.(
          { x: (node.x || 0) * distRatio, y: (node.y || 0) * distRatio, z: (node.z || 0) * distRatio },
          node,
          650,
        );
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [selectedId, graphMode, graph.nodes]);

  const isNodeActive = useCallback(
    (node) => {
      const active = hovered || selectedId;
      if (!active) return true;
      return node.id === active || adjacency.get(active)?.has(node.id);
    },
    [adjacency, hovered, selectedId],
  );

  const drawNode = useCallback(
    (node, ctx, globalScale) => {
      const active = hovered || selectedId;
      const isSelected = selectedId === node.id;
      const isHovered = hovered === node.id;
      const isActive = isNodeActive(node);
      const degree = degreeById.get(node.id) || 0;
      const radius = 4.5 + Math.min(8, degree);
      const label = node.label || node.id;
      const color = typeColors[node.typeId] || tokens.muted;
      const alpha = active && !isActive ? 0.28 : 1;

      ctx.save();
      ctx.globalAlpha = alpha;

      ctx.beginPath();
      ctx.arc(node.x, node.y, radius + (isSelected ? 8 : isHovered ? 5 : 2), 0, Math.PI * 2);
      ctx.fillStyle = isSelected ? mix(tokens.foreground, 12) : mix(tokens.foreground, 7);
      ctx.fill();

      ctx.beginPath();
      ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = (isSelected ? 2.2 : 1.1) / globalScale;
      ctx.strokeStyle = isSelected ? tokens.foreground : tokens.border;
      ctx.stroke();

      if (globalScale > 0.55 || isHovered || isSelected) {
        const fontSize = Math.max(9, 12 / globalScale);
        ctx.font = `${fontSize}px Inter, ui-sans-serif, system-ui`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const textWidth = ctx.measureText(label).width;
        const textY = node.y + radius + 14 / globalScale;
        const padX = 5 / globalScale;
        const padY = 3 / globalScale;

        ctx.fillStyle = active && !isActive ? mix(tokens.background, 35) : mix(tokens.background, 76);
        ctx.strokeStyle = active && !isActive ? mix(tokens.border, 20) : mix(tokens.border, 74);
        ctx.lineWidth = 1 / globalScale;
        ctx.beginPath();
        ctx.roundRect(
          node.x - textWidth / 2 - padX,
          textY - fontSize / 2 - padY,
          textWidth + padX * 2,
          fontSize + padY * 2,
          4 / globalScale,
        );
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = active && !isActive ? mix(tokens.muted, 42) : tokens.foreground;
        ctx.fillText(label, node.x, textY);
      }

      ctx.restore();
    },
    [degreeById, hovered, isNodeActive, selectedId, tokens, typeColors],
  );

  return (
    <main
      className="relative flex w-full min-h-0 overflow-hidden bg-background"
      style={{ height: height || "100%" }}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-10 opacity-70"
        style={{
          backgroundImage: `linear-gradient(${mix(tokens.foreground, 3.5)} 1px, transparent 1px), linear-gradient(90deg, ${mix(tokens.foreground, 3.5)} 1px, transparent 1px)`,
          backgroundSize: "80px 80px",
          backgroundPosition: "center center",
        }}
      />

      <button
        type="button"
        onClick={resetView}
        className="absolute right-4 top-4 z-20 rounded-md border border-border bg-surface-subtle/95 p-2 text-muted-foreground shadow-xl backdrop-blur transition-colors hover:bg-surface-active hover:text-foreground"
        title="Fit graph"
      >
        <Maximize2 className="h-4 w-4" />
      </button>

      <div className="absolute left-4 top-4 z-20 flex overflow-hidden rounded-lg border border-border bg-surface-subtle/95 shadow-xl backdrop-blur">
        {["2d", "3d"].map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => setGraphMode(mode)}
            className={`px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] transition-colors ${
              graphMode === mode
                ? "bg-surface-hover text-foreground"
                : "text-text-secondary hover:bg-surface-card hover:text-foreground"
            } ${mode === "3d" ? "border-l border-border" : ""}`}
          >
            {mode}
          </button>
        ))}
      </div>

      <aside
        className={`absolute bottom-4 right-4 z-20 overflow-hidden rounded-lg border border-border bg-surface-subtle/95 shadow-2xl backdrop-blur ${
          forcesOpen ? "w-80" : "w-auto"
        }`}
      >
        <button
          type="button"
          onClick={() => setForcesOpen((open) => !open)}
          className={`flex w-full items-center justify-between text-left transition-colors hover:bg-surface-card ${
            forcesOpen ? "p-4" : "p-2.5"
          }`}
          aria-expanded={forcesOpen}
          title="Graph forces"
        >
          {forcesOpen ? (
            <>
              <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Settings2 className="h-4 w-4 text-muted-foreground" />
                Graph forces
              </span>
              <ChevronDown className="h-4 w-4 rotate-180 text-muted-foreground transition-transform" />
            </>
          ) : (
            <Settings2 className="h-4 w-4 text-muted-foreground" />
          )}
        </button>

        {forcesOpen && (
          <div className="border-t border-border p-4">
            <div className="mb-4 flex justify-end">
              <button
                type="button"
                onClick={() => setForces(DEFAULT_FORCES)}
                className="rounded-md p-1.5 text-text-secondary hover:bg-surface-active hover:text-foreground"
                title="Restore force defaults"
              >
                <RotateCcw className="h-4 w-4" />
              </button>
            </div>

            {[
              ["Center force", "center", 0, 0.12, 0.005],
              ["Repel force", "repel", 40, 700, 5],
              ["Link force", "link", 0.02, 0.8, 0.01],
              ["Link distance", "distance", 45, 220, 1],
            ].map(([label, key, min, max, step]) => (
              <label key={key} className="mb-3 block text-xs text-muted-foreground">
                <div className="mb-1 flex justify-between">
                  <span>{label}</span>
                  <span className="text-text-secondary">
                    {Number(forces[key]).toFixed(key === "distance" || key === "repel" ? 0 : 3)}
                  </span>
                </div>
                <input
                  type="range"
                  min={min}
                  max={max}
                  step={step}
                  value={forces[key]}
                  onChange={(event) => setForces((current) => ({ ...current, [key]: Number(event.target.value) }))}
                  className="w-full accent-foreground"
                />
              </label>
            ))}

            {selectedNode && (
              <div className="mt-4 rounded-md border border-border bg-background p-3">
                <div className="text-sm font-semibold text-foreground">{selectedNode.label}</div>
                <div className="mt-1 text-xs text-muted-foreground">{selectedNode.typeName}</div>
              </div>
            )}
          </div>
        )}
      </aside>

      <div className="absolute bottom-4 left-4 z-20 flex overflow-hidden rounded-lg border border-border bg-surface-subtle/95 shadow-xl">
        <button
          type="button"
          onClick={() => zoomBy(0.18)}
          className="p-2.5 text-muted-foreground hover:bg-surface-active hover:text-foreground"
        >
          <Plus className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => zoomBy(-0.18)}
          className="border-l border-border p-2.5 text-muted-foreground hover:bg-surface-active hover:text-foreground"
        >
          <Minus className="h-4 w-4" />
        </button>
      </div>

      <div ref={wrapRef} className="h-full w-full">
        {!hasGraphSize ? null : graphMode === "2d" ? (
          <ForceGraph2D
            key="knowledge-graph-2d"
            ref={fgRef}
            width={width}
            height={measuredHeight}
            graphData={graph}
            backgroundColor={tokens.background}
            nodeId="id"
            nodeLabel={(node) => `${node.label}\n${node.typeName}`}
            nodeRelSize={4}
            nodeCanvasObject={drawNode}
            nodePointerAreaPaint={(node, color, ctx) => {
              ctx.fillStyle = color;
              ctx.beginPath();
              ctx.arc(node.x, node.y, 16 + (degreeById.get(node.id) || 0), 0, Math.PI * 2);
              ctx.fill();
            }}
            linkColor={(link) => {
              const active = hovered || selectedId;
              if (!active) return mix(tokens.muted, 16);
              const source = getNodeId(link.source);
              const target = getNodeId(link.target);
              return source === active || target === active ? mix(tokens.foreground, 54) : mix(tokens.muted, 6);
            }}
            linkWidth={(link) => {
              const active = hovered || selectedId;
              if (!active) return 1;
              const source = getNodeId(link.source);
              const target = getNodeId(link.target);
              return source === active || target === active ? 1.8 : 0.6;
            }}
            linkDirectionalParticles={(link) => {
              const active = hovered || selectedId;
              const source = getNodeId(link.source);
              const target = getNodeId(link.target);
              return active && (source === active || target === active) ? 2 : 0;
            }}
            linkDirectionalParticleColor={() => tokens.foreground}
            linkDirectionalParticleWidth={1.4}
            cooldownTicks={140}
            warmupTicks={35}
            d3VelocityDecay={0.34}
            onNodeHover={(node) => setHovered(node?.id || null)}
            onNodeClick={(node) => onSelect?.(node.id)}
            onBackgroundClick={() => onSelect?.(null)}
            enableNodeDrag
            enablePanInteraction
            enableZoomInteraction
          />
        ) : (
          <ForceGraph3D
            key="knowledge-graph-3d"
            ref={fgRef}
            width={width}
            height={measuredHeight}
            graphData={graph}
            backgroundColor={tokens.background}
            forceEngine="d3"
            numDimensions={3}
            nodeId="id"
            nodeLabel={(node) => `${node.label}\n${node.typeName}`}
            nodeVal={(node) => 3 + (degreeById.get(node.id) || 0)}
            nodeColor={(node) => {
              const active = hovered || selectedId;
              if (!active) return typeColors[node.typeId] || tokens.muted;
              return isNodeActive(node) ? tokens.foreground : tokens.border;
            }}
            nodeOpacity={0.92}
            nodeResolution={24}
            linkColor={(link) => {
              const active = hovered || selectedId;
              if (!active) return mix(tokens.muted, 22);
              const source = getNodeId(link.source);
              const target = getNodeId(link.target);
              return source === active || target === active ? mix(tokens.foreground, 72) : mix(tokens.muted, 8);
            }}
            linkWidth={(link) => {
              const active = hovered || selectedId;
              if (!active) return 0.8;
              const source = getNodeId(link.source);
              const target = getNodeId(link.target);
              return source === active || target === active ? 1.8 : 0.35;
            }}
            linkOpacity={0.36}
            linkDirectionalParticles={(link) => {
              const active = hovered || selectedId;
              const source = getNodeId(link.source);
              const target = getNodeId(link.target);
              return active && (source === active || target === active) ? 2 : 0;
            }}
            linkDirectionalParticleColor={() => tokens.foreground}
            linkDirectionalParticleWidth={1.8}
            cooldownTicks={140}
            warmupTicks={35}
            d3VelocityDecay={0.34}
            onNodeHover={(node) => setHovered(node?.id || null)}
            onNodeClick={(node) => onSelect?.(node.id)}
            onBackgroundClick={() => onSelect?.(null)}
            enableNodeDrag
          />
        )}
      </div>
    </main>
  );
}

export default KnowledgeGraph;
