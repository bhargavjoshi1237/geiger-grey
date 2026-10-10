"use client";

import React, { useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import { Button } from "@geiger/ui/button";
import { Input } from "@geiger/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@geiger/ui/sheet";
import { Textarea } from "@geiger/ui/textarea";
import { Field, SectionCard } from "@/components/internal/shared/screen_kit";
import { createPreset, updatePreset } from "@/lib/supabase/ingestion_presets";
import { estimateFileCost } from "@/lib/grey/cost";
import { formatCurrency } from "@/lib/grey/format";
import { IngestionSettingsForm } from "./ingestion_settings_form";
import { DEFAULT_PRESET_CONFIG } from "./constants";

const HUNDRED_PAGES = { kind: "document", pageCount: 100, tokenCount: 100 * 500 };
const ONE_HOUR_MEDIA = { kind: "video", durationMs: 3_600_000, tokenCount: 0 };

function priceLabel(estimate) {
  if (!estimate) return "—";
  return estimate.low === estimate.high
    ? formatCurrency(estimate.low)
    : `${formatCurrency(estimate.low)}–${formatCurrency(estimate.high)}`;
}

// Create/edit Sheet for a custom ingestion preset. `seed` prefills a new
// preset's fields (used by the "Duplicate" action on a system preset card);
// `preset` switches the Sheet into edit mode for an existing custom preset.
export function PresetSheet({ open, onOpenChange, projectId, preset, seed, onSaved }) {
  const isEdit = !!preset;
  const [name, setName] = useState(preset?.name || seed?.name || "");
  const [description, setDescription] = useState(preset?.description || seed?.description || "");
  const [config, setConfig] = useState(preset?.config || seed?.config || DEFAULT_PRESET_CONFIG);
  const [saving, setSaving] = useState(false);

  const per100Pages = estimateFileCost(HUNDRED_PAGES, { tier: "custom", config });
  const perHourMedia = estimateFileCost(ONE_HOUR_MEDIA, { tier: "custom", config });

  const save = async () => {
    if (!name.trim()) {
      toast.error("Give this preset a name first.");
      return;
    }
    setSaving(true);
    const payload = { name: name.trim(), description: description.trim(), tier: "custom", config };
    const saved = isEdit ? await updatePreset(preset.id, payload) : await createPreset(projectId, payload);
    setSaving(false);
    if (!saved) {
      toast.error("Couldn't save the preset.");
      return;
    }
    onSaved(saved);
    toast.success(isEdit ? "Preset updated." : "Preset created.");
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{isEdit ? "Edit preset" : "New preset"}</SheetTitle>
          <SheetDescription>
            Define parsing, chunking, and pricing. Pricing drives the cost estimate shown during
            upload.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-5 px-4">
          <Field label="Name" htmlFor="preset-name">
            <Input
              id="preset-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Legal contracts"
              autoFocus
            />
          </Field>
          <Field label="Description" htmlFor="preset-description">
            <Textarea
              id="preset-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this preset is tuned for"
              rows={2}
            />
          </Field>

          <IngestionSettingsForm value={config} onChange={setConfig} showPrices />

          <SectionCard title="Cost preview" description="Estimated cost at the prices above.">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-border bg-surface-card p-3">
                <p className="text-xs text-text-secondary">Per 100 pages</p>
                <p className="text-lg font-semibold text-foreground">{priceLabel(per100Pages)}</p>
              </div>
              <div className="rounded-lg border border-border bg-surface-card p-3">
                <p className="text-xs text-text-secondary">Per hour of media</p>
                <p className="text-lg font-semibold text-foreground">{priceLabel(perHourMedia)}</p>
              </div>
            </div>
          </SectionCard>
        </div>

        <SheetFooter className="mt-4">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            className="bg-primary text-primary-foreground hover:bg-primary/90"
            onClick={save}
            disabled={saving}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {isEdit ? "Save changes" : "Create preset"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

export default PresetSheet;
