"use client";

import React, { useState } from "react";
import { toast } from "sonner";
import { TriangleAlert } from "lucide-react";

import { Button } from "@geiger/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@geiger/ui/dialog";
import { IconPicker } from "@geiger/ui/icon-picker";
import { Input } from "@geiger/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@geiger/ui/select";
import { Textarea } from "@geiger/ui/textarea";
import { Field } from "@/components/internal/shared/screen_kit";
import { EMBEDDING_MODELS } from "./constants";

const EMPTY_DRAFT = {
  name: "",
  description: "",
  icon: "Database",
  presetId: "",
  embeddingModel: EMBEDDING_MODELS[0]?.value || "",
};

// Create dialog for a new knowledge base. Preset and embedding model are
// chosen once here — the embedding model is immutable after creation, so the
// warning stays visible next to its select for the life of this dialog.
export function CreateKnowledgeBaseDialog({ open, onOpenChange, onCreate, presets = [] }) {
  const [draft, setDraft] = useState(EMPTY_DRAFT);

  const set = (key) => (value) => setDraft((d) => ({ ...d, [key]: value }));

  const reset = () => setDraft({ ...EMPTY_DRAFT, presetId: presets[0]?.id || "" });

  const submit = () => {
    if (!draft.name.trim()) {
      toast.error("Give your knowledge base a name first.");
      return;
    }
    if (!draft.presetId) {
      toast.error("Choose an ingestion preset first.");
      return;
    }
    onCreate({
      name: draft.name.trim(),
      description: draft.description.trim(),
      icon: draft.icon || "Database",
      presetId: draft.presetId,
      embeddingModel: draft.embeddingModel,
      status: "active",
    });
    reset();
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-lg bg-background">
        <DialogHeader>
          <DialogTitle>Create knowledge base</DialogTitle>
          <DialogDescription>
            Pick an ingestion preset and embedding model now — the embedding model
            can&apos;t be changed once sources start ingesting.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid grid-cols-[auto_1fr] gap-4">
            <Field label="Icon">
              <IconPicker value={draft.icon} onValueChange={set("icon")} className="w-24" />
            </Field>
            <Field label="Name" htmlFor="kb-name">
              <Input
                id="kb-name"
                value={draft.name}
                onChange={(e) => set("name")(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    submit();
                  }
                }}
                placeholder="e.g. Product documentation"
                autoFocus
              />
            </Field>
          </div>

          <Field label="Description" htmlFor="kb-description">
            <Textarea
              id="kb-description"
              value={draft.description}
              onChange={(e) => set("description")(e.target.value)}
              placeholder="What goes in this knowledge base?"
              rows={2}
            />
          </Field>

          <Field label="Ingestion preset">
            <Select value={draft.presetId} onValueChange={set("presetId")}>
              <SelectTrigger>
                <SelectValue placeholder="Select a preset" />
              </SelectTrigger>
              <SelectContent>
                {presets.map((preset) => (
                  <SelectItem key={preset.id} value={preset.id}>
                    {preset.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field
            label="Embedding model"
            hint="Locked after the knowledge base is created."
          >
            <Select value={draft.embeddingModel} onValueChange={set("embeddingModel")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EMBEDDING_MODELS.map((model) => (
                  <SelectItem key={model.value} value={model.value}>
                    {model.label} · {model.dims}d
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Changing the embedding model later requires creating a new knowledge base and
              re-ingesting everything into it.
            </span>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            className="border-border bg-transparent text-muted-foreground hover:bg-surface-active hover:text-foreground"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            className="bg-primary text-primary-foreground hover:bg-primary/90"
            onClick={submit}
          >
            Create knowledge base
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default CreateKnowledgeBaseDialog;
