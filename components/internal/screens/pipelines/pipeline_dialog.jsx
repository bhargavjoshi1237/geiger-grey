"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@geiger/ui/button";
import { Input } from "@geiger/ui/input";
import { Textarea } from "@geiger/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@geiger/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@geiger/ui/select";
import { Field } from "@/components/internal/shared/screen_kit";
import { GREY_HOSTED_PROVIDER } from "@/lib/supabase/model_providers";
import { DEFAULT_RETRIEVAL } from "./constants";

const emptyDraft = () => ({
  name: "",
  description: "",
  providerId: GREY_HOSTED_PROVIDER.id,
  model: GREY_HOSTED_PROVIDER.models[0],
});

// New pipeline dialog — only the essentials. Retrieval, prompt, and publishing
// are tuned afterwards from the pipeline's own EditorShell.
export function PipelineDialog({ open, onOpenChange, providers = [], onCreate }) {
  const [draft, setDraft] = useState(emptyDraft());

  const set = (key) => (value) => setDraft((d) => ({ ...d, [key]: value }));

  const options = [GREY_HOSTED_PROVIDER, ...providers];
  const selected = options.find((p) => p.id === draft.providerId) || options[0];

  const pickProvider = (value) => {
    const next = options.find((p) => p.id === value);
    setDraft((d) => ({ ...d, providerId: value, model: next?.models?.[0] || "" }));
  };

  const submit = () => {
    if (!draft.name.trim()) {
      toast.error("Give your pipeline a name first.");
      return;
    }
    onCreate({
      name: draft.name.trim(),
      description: draft.description.trim(),
      kbIds: [],
      providerId: draft.providerId,
      model: draft.model || selected?.models?.[0] || "",
      temperature: 0.3,
      maxTokens: 1024,
      systemPrompt: "",
      retrieval: DEFAULT_RETRIEVAL,
      status: "draft",
      currentVersion: 0,
    });
    setDraft(emptyDraft());
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg bg-background">
        <DialogHeader>
          <DialogTitle>Create pipeline</DialogTitle>
          <DialogDescription>
            Set the essentials now — retrieval, prompt, and publishing live in the pipeline&apos;s own editor.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <Field label="Pipeline name" htmlFor="pipeline-name">
            <Input
              id="pipeline-name"
              value={draft.name}
              onChange={(e) => set("name")(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submit();
                }
              }}
              placeholder="e.g. Support knowledge assistant"
              autoFocus
            />
          </Field>

          <Field label="Description" htmlFor="pipeline-description">
            <Textarea
              id="pipeline-description"
              value={draft.description}
              onChange={(e) => set("description")(e.target.value)}
              placeholder="What this pipeline is for"
              rows={2}
            />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Provider">
              <Select value={draft.providerId} onValueChange={pickProvider}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {options.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Model">
              <Select value={draft.model} onValueChange={set("model")}>
                <SelectTrigger>
                  <SelectValue placeholder="Select model" />
                </SelectTrigger>
                <SelectContent>
                  {(selected?.models || []).map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
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
          <Button className="bg-primary text-primary-foreground hover:bg-primary/90" onClick={submit}>
            Create pipeline
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default PipelineDialog;
