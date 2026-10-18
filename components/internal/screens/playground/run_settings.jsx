"use client";

import React from "react";
import { ArrowUpRight, PanelRightClose, RotateCcw } from "lucide-react";

import { Badge } from "@geiger/ui/badge";
import { Slider } from "@geiger/ui/slider";
import { cn } from "@/lib/utils";
import { IconAction } from "./chat_kit";

const STATUS = { live: { label: "Live", variant: "success" }, draft: { label: "Draft", variant: "neutral" } };

function SectionLabel({ children, action }) {
  return (
    <div className="flex h-7 items-center justify-between">
      <p className="text-[11px] font-medium uppercase tracking-wide text-text-secondary">{children}</p>
      {action}
    </div>
  );
}

function Row({ label, children }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5 text-xs">
      <span className="shrink-0 text-text-secondary">{label}</span>
      <span className="min-w-0 text-right font-medium text-foreground">{children}</span>
    </div>
  );
}

function OverrideSlider({ label, value, display, min, max, step, onChange }) {
  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-text-secondary">{label}</span>
        <span className="font-medium tabular-nums text-foreground">{display}</span>
      </div>
      <Slider value={[value]} min={min} max={max} step={step} onValueChange={([v]) => onChange(v)} />
    </div>
  );
}

// Right-hand panel: what the conversation's pipeline is configured to do, a link to edit it,
// and per-session overrides (temperature, top K) that apply to this tab's requests only.
export function RunSettingsPanel({ pipeline, knowledgeBaseNames = [], overrides, onOverridesChange, onOpenPipeline, onClose, className }) {
  const retrieval = pipeline?.retrieval || {};
  const baseTemperature = pipeline?.temperature ?? 0.3;
  const baseTopK = retrieval.topK ?? 6;
  const temperature = overrides?.temperature ?? baseTemperature;
  const topK = overrides?.topK ?? baseTopK;
  const overridden = overrides?.temperature !== undefined || overrides?.topK !== undefined;
  const status = STATUS[pipeline?.status] || STATUS.draft;

  return (
    <div className={cn("flex h-full min-h-0 w-full flex-col", className)}>
      <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border px-4">
        <p className="text-sm font-semibold text-foreground">Run settings</p>
        {onClose ? (
          <IconAction label="Close run settings" onClick={onClose} className="h-8 w-8 [&_svg]:h-4 [&_svg]:w-4">
            <PanelRightClose />
          </IconAction>
        ) : null}
      </div>

      {pipeline ? (
        <div className="scrollbar-subtle min-h-0 flex-1 divide-y divide-border overflow-y-auto">
          <section className="space-y-3 px-4 py-4">
            <SectionLabel>Pipeline</SectionLabel>
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-sm font-medium text-foreground">{pipeline.name}</p>
              <Badge variant={status.variant}>{status.label}</Badge>
            </div>
            {onOpenPipeline ? (
              <button
                type="button"
                onClick={onOpenPipeline}
                className="inline-flex items-center gap-1 text-xs font-medium text-text-secondary transition-colors hover:text-foreground"
              >
                Edit pipeline <ArrowUpRight className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </section>

          <section className="px-4 py-4">
            <SectionLabel>Configuration</SectionLabel>
            <div className="mt-1">
              <Row label="Model">{pipeline.model || "—"}</Row>
              <Row label="Knowledge bases">
                {knowledgeBaseNames.length ? (
                  <span className="flex flex-wrap justify-end gap-1">
                    {knowledgeBaseNames.map((name) => (
                      <Badge key={name} variant="neutral">
                        {name}
                      </Badge>
                    ))}
                  </span>
                ) : (
                  <span className="text-amber-400">None attached</span>
                )}
              </Row>
              <Row label="Search">
                {retrieval.hybrid === false ? "Vector" : "Hybrid"} · top {baseTopK}
              </Row>
              <Row label="Min. similarity">{retrieval.threshold ?? 0.2}</Row>
              <Row label="Rerank">{retrieval.rerank ? "On" : "Off"}</Row>
              <Row label="Graph">
                <span className="capitalize">{retrieval.graphMode || "off"}</span>
              </Row>
              <Row label="Citations">{retrieval.citations === false ? "Off" : "On"}</Row>
              <Row label="Max tokens">{pipeline.maxTokens ? pipeline.maxTokens.toLocaleString("en-US") : "Provider default"}</Row>
            </div>
          </section>

          <section className="space-y-4 px-4 py-4">
            <SectionLabel
              action={
                overridden ? (
                  <IconAction label="Reset overrides" onClick={() => onOverridesChange?.({})}>
                    <RotateCcw />
                  </IconAction>
                ) : null
              }
            >
              Session overrides
            </SectionLabel>
            <OverrideSlider
              label="Temperature"
              value={temperature}
              display={temperature.toFixed(1)}
              min={0}
              max={2}
              step={0.1}
              onChange={(v) => onOverridesChange?.({ ...overrides, temperature: v })}
            />
            <OverrideSlider
              label="Passages (top K)"
              value={topK}
              display={topK}
              min={1}
              max={20}
              step={1}
              onChange={(v) => onOverridesChange?.({ ...overrides, topK: v })}
            />
            <p className="text-[11px] leading-4 text-text-tertiary">
              Overrides apply to this tab only and are never saved to the pipeline.
            </p>
          </section>
        </div>
      ) : (
        <p className="px-4 py-6 text-xs text-text-tertiary">Choose a pipeline to see its settings.</p>
      )}
    </div>
  );
}

export default RunSettingsPanel;
