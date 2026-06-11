"use client";

import dynamic from "next/dynamic";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Maximize2, Minus, Plus, RotateCcw, Settings2 } from "lucide-react";
import { createClient } from "@/utils/supabase/client";

const ForceGraph2D = dynamic(
  () => import("react-force-graph-2d").then((mod) => mod.default),
  { ssr: false }
);

const ForceGraph3D = dynamic(
  () => import("react-force-graph-3d").then((mod) => mod.default),
  { ssr: false }
);

const PALETTE = {
  bg: "#161616",
  sidebar: "#1a1a1a",
  card: "#202020",
  accent: "#242424",
  hover: "#2a2a2a",
  border: "#333333",
  ring: "#474747",
  muted: "#737373",
  soft: "#a3a3a3",
  text: "#e7e7e7",
  white: "#ffffff",
};

const GROUP_COLORS = {
  Planning: "#e7e7e7",
  Research: "#cfcfcf",
  Decisions: "#b8b8b8",
  Delivery: "#a3a3a3",
  Risks: "#8f8f8f",
  People: "#737373",
};

const DEFAULT_FORCES = {
  center: 0.04,
  repel: 260,
  link: 0.22,
  distance: 118,
};

function seededRandom(seed) {
  let value = 0;
  for (let i = 0; i < seed.length; i += 1) value = (value * 31 + seed.charCodeAt(i)) >>> 0;
  return () => {
    value = (1664525 * value + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function buildFallbackGraph(projectId) {
  const rand = seededRandom(projectId || "demo");
  const labels = [
    ["Project brief", "Planning"],
    ["Customer interviews", "Research"],
    ["Jobs to be done", "Research"],
    ["Roadmap", "Planning"],
    ["Milestone plan", "Delivery"],
    ["Architecture notes", "Delivery"],
    ["Launch checklist", "Delivery"],
    ["Open risks", "Risks"],
    ["Auth decision", "Decisions"],
    ["Supabase session model", "Decisions"],
    ["Design system", "Planning"],
    ["Stakeholder map", "People"],
    ["Beta feedback", "Research"],
    ["Post-launch metrics", "Delivery"],
    ["Edge cases", "Risks"],
    ["Support playbook", "People"],
  ];

  const nodes = labels.map(([label, group], index) => ({
    id: `${projectId}-${index}`,
    label,
    group,
    tags: [group.toLowerCase(), index % 3 === 0 ? "pinned" : "note"],
    type: index % 5 === 0 ? "attachment" : "note",
    createdAt: Date.now() - index * 86400000,
    radius: 4 + Math.round(rand() * 7),
    val: 4 + Math.round(rand() * 7),
    x: Math.cos((Math.PI * 2 * index) / labels.length) * (160 + rand() * 110),
    y: Math.sin((Math.PI * 2 * index) / labels.length) * (150 + rand() * 100),
  }));

  const linkPairs = [
    [0, 1], [0, 3], [0, 8], [1, 2], [1, 12], [2, 3], [3, 4], [3, 10],
    [4, 5], [4, 6], [5, 9], [6, 13], [7, 8], [7, 14], [8, 9], [10, 11],
    [11, 15], [12, 13], [14, 6], [15, 6],
  ];

  const links = linkPairs.map(([sourceIndex, targetIndex], index) => ({
    id: `link-${index}`,
    source: nodes[sourceIndex].id,
    target: nodes[targetIndex].id,
    strength: index % 4 === 0 ? 1.5 : 1,
  }));

  return { nodes, links };
}

function normalizeGraph(rows, projectId) {
  if (!Array.isArray(rows) || rows.length === 0) return buildFallbackGraph(projectId);

  const nodes = rows.map((row, index) => ({
    id: row.id || row.slug || `${projectId}-${index}`,
    label: row.title || row.label || row.name || `Node ${index + 1}`,
    group: row.group || row.category || "Planning",
    tags: Array.isArray(row.tags) ? row.tags : [],
    type: row.type || "note",
    createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now() - index * 86400000,
    radius: Number(row.radius || row.weight || 6),
    val: Number(row.radius || row.weight || 6),
    x: Number(row.x || Math.cos(index) * 200),
    y: Number(row.y || Math.sin(index) * 200),
  }));

  const nodeIds = new Set(nodes.map((node) => node.id));
  const links = rows.flatMap((row, rowIndex) => {
    const source = row.id || row.slug || `${projectId}-${rowIndex}`;
    const targets = row.links || row.outgoing_links || row.references || [];
    return targets
      .filter((target) => nodeIds.has(typeof target === "string" ? target : target.id))
      .map((target, linkIndex) => ({
        id: `${source}-${linkIndex}`,
        source,
        target: typeof target === "string" ? target : target.id,
        strength: 1,
      }));
  });

  return { nodes, links };
}

function getNodeId(nodeOrId) {
  return typeof nodeOrId === "object" && nodeOrId !== null ? nodeOrId.id : nodeOrId;
}

function useGraphData(projectId) {
  const [graph, setGraph] = useState(() => buildFallbackGraph(projectId));
  const [source, setSource] = useState("demo");

  useEffect(() => {
    let cancelled = false;

    async function loadGraph() {
      try {
        const supabase = createClient();
        const { data, error } = await supabase
          .from("grey_knowledge_nodes")
          .select("*")
          .eq("project_id", projectId)
          .order("created_at", { ascending: true });

        if (!cancelled && !error && data?.length) {
          setGraph(normalizeGraph(data, projectId));
          setSource("supabase");
        }
      } catch {
        if (!cancelled) setSource("demo");
      }
    }

    loadGraph();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  return { graph, source };
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

export function KnowledgeGraph({ projectId, user }) {
  const fgRef = useRef(null);
  const wrapRef = useRef(null);
  const { width, height } = useElementSize(wrapRef);
  const [hovered, setHovered] = useState(null);
  const [selected, setSelected] = useState(null);
  const [graphMode, setGraphMode] = useState("3d");
  const [forcesOpen, setForcesOpen] = useState(false);
  const [forces, setForces] = useState(DEFAULT_FORCES);
  const { graph } = useGraphData(projectId);
  void user;

  const filteredGraph = useMemo(() => graph, [graph]);
  const hasGraphSize = width > 40 && height > 40;

  const adjacency = useMemo(() => {
    const map = new Map();
    filteredGraph.nodes.forEach((node) => map.set(node.id, new Set()));
    filteredGraph.links.forEach((link) => {
      const source = getNodeId(link.source);
      const target = getNodeId(link.target);
      map.get(source)?.add(target);
      map.get(target)?.add(source);
    });
    return map;
  }, [filteredGraph]);

  const selectedNode = useMemo(
    () => filteredGraph.nodes.find((node) => node.id === selected),
    [filteredGraph.nodes, selected]
  );

  const resetView = useCallback(() => {
    fgRef.current?.zoomToFit?.(450, 72);
  }, []);

  const zoomBy = useCallback((delta) => {
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
      180
    );
  }, [graphMode]);

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
  }, [forces, filteredGraph, graphMode]);

  useEffect(() => {
    const frame = requestAnimationFrame(resetView);
    return () => cancelAnimationFrame(frame);
  }, [filteredGraph.nodes.length, filteredGraph.links.length, resetView]);

  const isNodeActive = useCallback(
    (node) => {
      const active = hovered || selected;
      if (!active) return true;
      return node.id === active || adjacency.get(active)?.has(node.id);
    },
    [adjacency, hovered, selected]
  );

  const drawNode = useCallback(
    (node, ctx, globalScale) => {
      const active = hovered || selected;
      const isSelected = selected === node.id;
      const isHovered = hovered === node.id;
      const isActive = isNodeActive(node);
      const radius = 4.5 + Math.min(8, Number(node.radius || node.val || 5));
      const label = node.label || node.id;
      const color = GROUP_COLORS[node.group] || PALETTE.soft;
      const alpha = active && !isActive ? 0.28 : 1;

      ctx.save();
      ctx.globalAlpha = alpha;

      ctx.beginPath();
      ctx.arc(node.x, node.y, radius + (isSelected ? 8 : isHovered ? 5 : 2), 0, Math.PI * 2);
      ctx.fillStyle = isSelected ? "rgba(255,255,255,0.12)" : "rgba(231,231,231,0.07)";
      ctx.fill();

      ctx.beginPath();
      ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = (isSelected ? 2.2 : 1.1) / globalScale;
      ctx.strokeStyle = isSelected ? PALETTE.white : PALETTE.border;
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

        ctx.fillStyle = active && !isActive ? "rgba(22,22,22,0.35)" : "rgba(22,22,22,0.76)";
        ctx.strokeStyle = active && !isActive ? "rgba(51,51,51,0.2)" : "rgba(51,51,51,0.74)";
        ctx.lineWidth = 1 / globalScale;
        ctx.beginPath();
        ctx.roundRect(
          node.x - textWidth / 2 - padX,
          textY - fontSize / 2 - padY,
          textWidth + padX * 2,
          fontSize + padY * 2,
          4 / globalScale
        );
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = active && !isActive ? "rgba(163,163,163,0.42)" : PALETTE.text;
        ctx.fillText(label, node.x, textY);
      }

      ctx.restore();
    },
    [hovered, isNodeActive, selected]
  );

  return (
    <main className="relative flex h-full min-h-0 w-full overflow-hidden bg-background">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-10 opacity-70"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px)",
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
                ? "bg-surface-hover text-white"
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
              <span className="flex items-center gap-2 text-sm font-semibold text-white">
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
                  <span className="text-text-secondary">{Number(forces[key]).toFixed(key === "distance" || key === "repel" ? 0 : 3)}</span>
                </div>
                <input
                  type="range"
                  min={min}
                  max={max}
                  step={step}
                  value={forces[key]}
                  onChange={(event) => setForces((current) => ({ ...current, [key]: Number(event.target.value) }))}
                  className="w-full accent-white"
                />
              </label>
            ))}

            {selectedNode && (
              <div className="mt-4 rounded-md border border-border bg-background p-3">
                <div className="text-sm font-semibold text-white">{selectedNode.label}</div>
                <div className="mt-1 text-xs text-muted-foreground">{selectedNode.group}</div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {selectedNode.tags?.map((tag) => (
                    <span key={tag} className="rounded border border-border bg-surface-card px-2 py-1 text-[11px] text-muted-foreground">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </aside>

      <div className="absolute bottom-4 left-4 z-20 flex overflow-hidden rounded-lg border border-border bg-surface-subtle/95 shadow-xl">
        <button type="button" onClick={() => zoomBy(0.18)} className="p-2.5 text-muted-foreground hover:bg-surface-active hover:text-foreground">
          <Plus className="h-4 w-4" />
        </button>
        <button type="button" onClick={() => zoomBy(-0.18)} className="border-l border-border p-2.5 text-muted-foreground hover:bg-surface-active hover:text-foreground">
          <Minus className="h-4 w-4" />
        </button>
      </div>

      <div ref={wrapRef} className="h-full w-full">
        {!hasGraphSize ? null : graphMode === "2d" ? (
          <ForceGraph2D
            key="knowledge-graph-2d"
            ref={fgRef}
            width={width}
            height={height}
            graphData={filteredGraph}
            backgroundColor={PALETTE.bg}
            nodeId="id"
            nodeLabel={(node) => `${node.label}\n${node.group}`}
            nodeRelSize={4}
            nodeCanvasObject={drawNode}
            nodePointerAreaPaint={(node, color, ctx) => {
              ctx.fillStyle = color;
              ctx.beginPath();
              ctx.arc(node.x, node.y, 16 + Number(node.radius || node.val || 5), 0, Math.PI * 2);
              ctx.fill();
            }}
            linkColor={(link) => {
              const active = hovered || selected;
              if (!active) return "rgba(163,163,163,0.16)";
              const source = getNodeId(link.source);
              const target = getNodeId(link.target);
              return source === active || target === active ? "rgba(231,231,231,0.54)" : "rgba(115,115,115,0.06)";
            }}
            linkWidth={(link) => {
              const active = hovered || selected;
              if (!active) return 1;
              const source = getNodeId(link.source);
              const target = getNodeId(link.target);
              return source === active || target === active ? 1.8 : 0.6;
            }}
            linkDirectionalParticles={(link) => {
              const active = hovered || selected;
              const source = getNodeId(link.source);
              const target = getNodeId(link.target);
              return active && (source === active || target === active) ? 2 : 0;
            }}
            linkDirectionalParticleColor={() => PALETTE.text}
            linkDirectionalParticleWidth={1.4}
            cooldownTicks={140}
            warmupTicks={35}
            d3VelocityDecay={0.34}
            onNodeHover={(node) => setHovered(node?.id || null)}
            onNodeClick={(node) => {
              setSelected(node.id);
              fgRef.current?.centerAt?.(node.x, node.y, 450);
              fgRef.current?.zoom?.(1.55, 450);
            }}
            onBackgroundClick={() => setSelected(null)}
            enableNodeDrag
            enablePanInteraction
            enableZoomInteraction
          />
        ) : (
          <ForceGraph3D
            key="knowledge-graph-3d"
            ref={fgRef}
            width={width}
            height={height}
            graphData={filteredGraph}
            backgroundColor={PALETTE.bg}
            forceEngine="d3"
            numDimensions={3}
            nodeId="id"
            nodeLabel={(node) => `${node.label}\n${node.group}`}
            nodeVal={(node) => 3 + Number(node.radius || node.val || 5)}
            nodeColor={(node) => {
              const active = hovered || selected;
              if (!active) return GROUP_COLORS[node.group] || PALETTE.soft;
              return isNodeActive(node) ? PALETTE.text : PALETTE.ring;
            }}
            nodeOpacity={0.92}
            nodeResolution={24}
            linkColor={(link) => {
              const active = hovered || selected;
              if (!active) return "rgba(163,163,163,0.22)";
              const source = getNodeId(link.source);
              const target = getNodeId(link.target);
              return source === active || target === active ? "rgba(231,231,231,0.72)" : "rgba(115,115,115,0.08)";
            }}
            linkWidth={(link) => {
              const active = hovered || selected;
              if (!active) return 0.8;
              const source = getNodeId(link.source);
              const target = getNodeId(link.target);
              return source === active || target === active ? 1.8 : 0.35;
            }}
            linkOpacity={0.36}
            linkDirectionalParticles={(link) => {
              const active = hovered || selected;
              const source = getNodeId(link.source);
              const target = getNodeId(link.target);
              return active && (source === active || target === active) ? 2 : 0;
            }}
            linkDirectionalParticleColor={() => PALETTE.text}
            linkDirectionalParticleWidth={1.8}
            cooldownTicks={140}
            warmupTicks={35}
            d3VelocityDecay={0.34}
            onNodeHover={(node) => setHovered(node?.id || null)}
            onNodeClick={(node) => {
              setSelected(node.id);
              const distance = 180;
              const distRatio = 1 + distance / Math.hypot(node.x || 1, node.y || 1, node.z || 1);
              fgRef.current?.cameraPosition?.(
                {
                  x: (node.x || 0) * distRatio,
                  y: (node.y || 0) * distRatio,
                  z: (node.z || 0) * distRatio,
                },
                node,
                650
              );
            }}
            onBackgroundClick={() => setSelected(null)}
            enableNodeDrag
          />
        )}
      </div>
    </main>
  );
}
