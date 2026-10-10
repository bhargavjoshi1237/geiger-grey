"use client";

import React from "react";
import { PanelRightClose, RotateCcw } from "lucide-react";

import { Button } from "@geiger/ui/button";
import { Badge } from "@geiger/ui/badge";
import { Slider } from "@geiger/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@geiger/ui/select";
import { Field } from "@/components/internal/shared/screen_kit";

// Right-hand "Run settings" panel: pipeline picker (locked once a conversation
// has started — the pipeline is fixed at creation), a read-only summary of
// that pipeline's model/KBs/retrieval config, and per-session overrides
// (temperature, topK) that only apply to this browser tab's requests.
export function RunSettingsPanel({
  pipelines = [],
  pipelineId,
  onPipelineChange,
  pipeline,
  knowledgeBaseNames = [],
  locked = false,
  overrides,
  onOverridesChange,
  onClose,
}) {
  const retrieval = pipeline?.retrieval || {};
  const baseTemperature = pipeline?.temperature ?? 0.2;
  const baseTopK = retrieval.topK ?? 5;
  const temperature = overrides?.temperature ?? baseTemperature;
  const topK = overrides?.topK ?? baseTopK;
  const overridden = overrides?.temperature !== undefined || overrides?.topK !== undefined;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-surface-subtle">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <p className="text-sm font-semibold text-foreground">Run settings</p>
        {onClose ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Close run settings"
            onClick={onClose}
            className="text-muted-foreground hover:bg-surface-active hover:text-foreground"
          >
            <PanelRightClose className="h-4 w-4" />
          </Button>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
        <Field label="Pipeline">
          <Select value={pipelineId || undefined} onValueChange={onPipelineChange} disabled={locked}>
            <SelectTrigger>
              <SelectValue placeholder="Choose a pipeline" />
            </SelectTrigger>
            <SelectContent>
              {pipelines.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {locked ? (
            <p className="mt-1 text-[11px] text-text-tertiary">
              Fixed for this conversation — start a new chat to change it.
            </p>
          ) : null}
        </Field>

        {pipeline ? (
          <div className="space-y-3 rounded-lg border border-border bg-surface-card p-3 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="text-text-secondary">Model</span>
              <span className="truncate font-medium text-foreground">{pipeline.model || "—"}</span>
            </div>
            <div>
              <p className="mb-1 text-text-secondary">Knowledge bases</p>
              <div className="flex flex-wrap gap-1">
                {knowledgeBaseNames.length ? (
                  knowledgeBaseNames.map((name) => (
                    <Badge key={name} variant="neutral">
                      {name}
                    </Badge>
                  ))
                ) : (
                  <span className="text-text-tertiary">None selected</span>
                )}
              </div>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-text-secondary">Top K</span>
              <span className="font-medium text-foreground">{baseTopK}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-text-secondary">Graph mode</span>
              <span className="font-medium capitalize text-foreground">
                {retrieval.graphMode || "off"}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-text-secondary">Citations</span>
              <span className="font-medium text-foreground">
                {retrieval.citations === false ? "Off" : "On"}
              </span>
            </div>
          </div>
        ) : null}

        <div className="space-y-4 border-t border-border pt-4">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-medium uppercase tracking-wider text-text-secondary">
              Session overrides
            </p>
            {overridden ? (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Reset overrides"
                onClick={() => onOverridesChange?.({})}
                className="text-muted-foreground hover:bg-surface-active hover:text-foreground"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </Button>
            ) : null}
          </div>

          <Field label={`Temperature — ${temperature.toFixed(1)}`}>
            <Slider
              value={[temperature]}
              min={0}
              max={2}
              step={0.1}
              onValueChange={([v]) => onOverridesChange?.({ ...overrides, temperature: v })}
            />
          </Field>

          <Field label={`Top K — ${topK}`}>
            <Slider
              value={[topK]}
              min={1}
              max={20}
              step={1}
              onValueChange={([v]) => onOverridesChange?.({ ...overrides, topK: v })}
            />
          </Field>

          <p className="text-[11px] text-text-tertiary">
            Overrides apply to this session only — they are not saved to the pipeline.
          </p>
        </div>
      </div>
    </div>
  );
}

export default RunSettingsPanel;
