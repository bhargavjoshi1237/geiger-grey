"use client";

import React from "react";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@geiger/ui/accordion";
import { Badge } from "@geiger/ui/badge";
import { Input } from "@geiger/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@geiger/ui/select";
import { Switch } from "@geiger/ui/switch";
import { Field, SettingRow, SettingsList } from "@/components/internal/shared/screen_kit";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/grey/format";
import { SYSTEM_TIER_PRICES } from "@/lib/grey/cost";
import { CHUNK_STRATEGY_OPTIONS, PARSER_OPTIONS, PRESET_TIER_META } from "./constants";

// Tier cards for choosing an ingestion preset: the system fast/balanced/high/auto
// rows plus any project-defined custom presets. Price/page comes straight off
// each preset's own config; "auto" shows the fast-to-high range it routes across.
export function PresetPicker({ presets, value, onChange }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {(presets || []).map((preset) => {
        const meta = PRESET_TIER_META[preset.tier] || PRESET_TIER_META.custom;
        const isActive = value === preset.id;
        const perPage = preset.config?.prices?.perPage;
        const priceLabel =
          preset.tier === "auto"
            ? `${formatCurrency(SYSTEM_TIER_PRICES.fast, { precise: true })}–${formatCurrency(SYSTEM_TIER_PRICES.high, { precise: true })}/page`
            : perPage != null
              ? `${formatCurrency(perPage, { precise: true })}/page`
              : "Custom pricing";

        return (
          <button
            key={preset.id}
            type="button"
            onClick={() => onChange?.(preset.id)}
            aria-pressed={isActive}
            className={cn(
              "flex flex-col gap-1.5 rounded-xl border bg-surface-subtle p-4 text-left transition-colors",
              isActive ? "border-primary ring-1 ring-primary" : "border-border hover:bg-surface-active",
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-foreground">
                {preset.name || meta.label}
              </span>
              {!preset.isSystem ? <Badge variant="purple">Custom</Badge> : null}
            </div>
            <span className="text-xs font-medium text-muted-foreground">{priceLabel}</span>
            <p className="text-xs text-text-secondary">{preset.description || meta.description}</p>
          </button>
        );
      })}
    </div>
  );
}

// Shared ingestion settings editor: parser/OCR up top, everything else tucked
// into a collapsed "Advanced" accordion. Used by both the KB "Ingestion
// settings" section (showPrices=false — price basis belongs to the preset) and
// the preset editor Sheet (showPrices=true).
export function IngestionSettingsForm({ value, onChange, disabled = false, showPrices = true }) {
  const config = value || {};
  const chunking = config.chunking || {};
  const enrichment = config.enrichment || {};
  const media = config.media || {};
  const graph = config.graph || {};
  const prices = config.prices || {};

  const patchTop = (key, val) => onChange?.({ ...config, [key]: val });
  const patchSection = (section, key, val) =>
    onChange?.({ ...config, [section]: { ...(config[section] || {}), [key]: val } });

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Parser">
          <Select value={config.parser || "layout"} onValueChange={(v) => patchTop("parser", v)} disabled={disabled}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PARSER_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <SettingRow
          title="OCR"
          description="Run OCR on scanned pages."
          control={
            <Switch
              checked={!!config.ocr}
              onCheckedChange={(v) => patchTop("ocr", v)}
              disabled={disabled}
            />
          }
        />
      </div>

      <Accordion type="single" collapsible>
        <AccordionItem value="advanced">
          <AccordionTrigger className="text-sm font-medium text-foreground">
            Advanced
          </AccordionTrigger>
          <AccordionContent>
            <div className="space-y-6">
              <section className="space-y-3">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
                  Chunking
                </h4>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Strategy">
                    <Select
                      value={chunking.strategy || "recursive"}
                      onValueChange={(v) => patchSection("chunking", "strategy", v)}
                      disabled={disabled}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CHUNK_STRATEGY_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field
                    label="Chunk size (tokens)"
                    stepper
                    value={chunking.size ?? 512}
                    onValueChange={(v) => patchSection("chunking", "size", Number(v))}
                    step={32}
                    min={64}
                    max={4096}
                  >
                    <Input
                      type="number"
                      value={chunking.size ?? 512}
                      onChange={(e) => patchSection("chunking", "size", Number(e.target.value) || 0)}
                      disabled={disabled}
                    />
                  </Field>
                  <Field
                    label="Overlap (tokens)"
                    stepper
                    value={chunking.overlap ?? 64}
                    onValueChange={(v) => patchSection("chunking", "overlap", Number(v))}
                    step={16}
                    min={0}
                    max={1024}
                  >
                    <Input
                      type="number"
                      value={chunking.overlap ?? 64}
                      onChange={(e) => patchSection("chunking", "overlap", Number(e.target.value) || 0)}
                      disabled={disabled}
                    />
                  </Field>
                </div>
                <SettingsList>
                  <SettingRow
                    title="Atomic tables"
                    description="Keep whole tables together instead of splitting them across chunks."
                    control={
                      <Switch
                        checked={!!chunking.atomicTables}
                        onCheckedChange={(v) => patchSection("chunking", "atomicTables", v)}
                        disabled={disabled}
                      />
                    }
                  />
                  <SettingRow
                    title="Heading breadcrumbs"
                    description="Prefix each chunk with its section heading trail."
                    control={
                      <Switch
                        checked={!!chunking.headingBreadcrumbs}
                        onCheckedChange={(v) => patchSection("chunking", "headingBreadcrumbs", v)}
                        disabled={disabled}
                      />
                    }
                  />
                </SettingsList>
              </section>

              <section className="space-y-3">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
                  Enrichment
                </h4>
                <SettingsList>
                  <SettingRow
                    title="Contextual enrichment"
                    description="Prepend an LLM-written summary of neighbouring context to each chunk."
                    control={
                      <Switch
                        checked={!!enrichment.contextual}
                        onCheckedChange={(v) => patchSection("enrichment", "contextual", v)}
                        disabled={disabled}
                      />
                    }
                  />
                  <SettingRow
                    title="Parent-child chunking"
                    description="Retrieve small chunks, pass their larger parent chunk to the model."
                    control={
                      <Switch
                        checked={!!enrichment.parentChild}
                        onCheckedChange={(v) => patchSection("enrichment", "parentChild", v)}
                        disabled={disabled}
                      />
                    }
                  />
                </SettingsList>
              </section>

              <section className="space-y-3">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
                  Media
                </h4>
                <SettingsList>
                  <SettingRow
                    title="Transcribe"
                    description="Generate a transcript for audio and video sources."
                    control={
                      <Switch
                        checked={!!media.transcribe}
                        onCheckedChange={(v) => patchSection("media", "transcribe", v)}
                        disabled={disabled}
                      />
                    }
                  />
                  <SettingRow
                    title="Diarize"
                    description="Split the transcript by speaker."
                    control={
                      <Switch
                        checked={!!media.diarize}
                        onCheckedChange={(v) => patchSection("media", "diarize", v)}
                        disabled={disabled}
                      />
                    }
                  />
                  <SettingRow
                    title="Keyframes"
                    description="Extract and caption keyframes from video."
                    control={
                      <Switch
                        checked={!!media.keyframes}
                        onCheckedChange={(v) => patchSection("media", "keyframes", v)}
                        disabled={disabled}
                      />
                    }
                  />
                </SettingsList>
                <Field
                  label="Keyframe window (seconds)"
                  stepper
                  value={media.windowSeconds ?? 45}
                  onValueChange={(v) => patchSection("media", "windowSeconds", Number(v))}
                  step={5}
                  min={5}
                  max={300}
                  className="max-w-xs"
                >
                  <Input
                    type="number"
                    value={media.windowSeconds ?? 45}
                    onChange={(e) => patchSection("media", "windowSeconds", Number(e.target.value) || 0)}
                    disabled={disabled || !media.keyframes}
                  />
                </Field>
              </section>

              <section className="space-y-3">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
                  Graph
                </h4>
                <SettingsList>
                  <SettingRow
                    title="Extract entities and relations"
                    description="Feed this knowledge base into the project's knowledge graph."
                    control={
                      <Switch
                        checked={!!graph.extract}
                        onCheckedChange={(v) => patchSection("graph", "extract", v)}
                        disabled={disabled}
                      />
                    }
                  />
                </SettingsList>
              </section>

              {showPrices ? (
                <section className="space-y-3">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
                    Pricing
                  </h4>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Per page">
                      <Input
                        type="number"
                        step="0.001"
                        min="0"
                        value={prices.perPage ?? 0}
                        onChange={(e) => patchSection("prices", "perPage", Number(e.target.value) || 0)}
                        disabled={disabled}
                      />
                    </Field>
                    <Field label="Per media minute">
                      <Input
                        type="number"
                        step="0.001"
                        min="0"
                        value={prices.perMediaMinute ?? 0}
                        onChange={(e) => patchSection("prices", "perMediaMinute", Number(e.target.value) || 0)}
                        disabled={disabled}
                      />
                    </Field>
                    <Field label="Per keyframe minute">
                      <Input
                        type="number"
                        step="0.001"
                        min="0"
                        value={prices.perKeyframeMinute ?? 0}
                        onChange={(e) => patchSection("prices", "perKeyframeMinute", Number(e.target.value) || 0)}
                        disabled={disabled}
                      />
                    </Field>
                    <Field label="Per million graph tokens">
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        value={prices.perMillionTokensGraph ?? 0}
                        onChange={(e) =>
                          patchSection("prices", "perMillionTokensGraph", Number(e.target.value) || 0)
                        }
                        disabled={disabled}
                      />
                    </Field>
                    <Field label="Per million contextual tokens">
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        value={prices.perMillionTokensContextual ?? 0}
                        onChange={(e) =>
                          patchSection("prices", "perMillionTokensContextual", Number(e.target.value) || 0)
                        }
                        disabled={disabled}
                      />
                    </Field>
                  </div>
                </section>
              ) : null}
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}

export default IngestionSettingsForm;
