"use client";

import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, ScanSearch, TriangleAlert } from "lucide-react";

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
import { ModelIdSelect } from "@/components/internal/shared/model_id_select";
import { useProject } from "@/context/project-context";
import { useWorkspaceUrl } from "@/lib/hooks/use-workspace-url";
import { hasCapability, suggestedModelsFor } from "@/lib/grey/provider_kinds";
import { isIndexedDims } from "@/lib/grey/embedding_models";
import { listProviders } from "@/lib/supabase/model_providers";
import { detectEmbeddingDims } from "@/lib/supabase/knowledge_bases";
import { EMBEDDING_ERROR_MESSAGES } from "./constants";

const EMPTY_DRAFT = {
  name: "",
  description: "",
  icon: "Database",
  presetId: "",
  embeddingProviderId: "",
  embeddingModel: "",
  embeddingDims: null,
};

const firstSuggestion = (provider) => suggestedModelsFor(provider, "embed")[0]?.id || "";

// Create dialog for a new knowledge base. Preset and embedding settings are
// chosen once here — the embedding model and its dimensions are locked after
// creation, so the warning stays visible for the life of this dialog.
export function CreateKnowledgeBaseDialog({ open, onOpenChange, onCreate, presets = [] }) {
  const { projectId } = useProject();
  const { setTab } = useWorkspaceUrl();
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [providers, setProviders] = useState(null);
  const [detecting, setDetecting] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    let alive = true;
    listProviders(projectId).then((rows) => {
      if (!alive) return;
      const embedders = (rows || []).filter((p) => hasCapability(p, "embed"));
      setProviders(embedders);
      // Preselect the first embedding connection and its first suggested model.
      setDraft((d) =>
        d.embeddingProviderId || !embedders.length
          ? d
          : { ...d, embeddingProviderId: embedders[0].id, embeddingModel: firstSuggestion(embedders[0]), embeddingDims: null },
      );
    });
    return () => {
      alive = false;
    };
  }, [open, projectId]);

  const set = (key) => (value) => setDraft((d) => ({ ...d, [key]: value }));
  const selectedProvider = (providers || []).find((p) => p.id === draft.embeddingProviderId) || null;

  const reset = () => setDraft({ ...EMPTY_DRAFT, presetId: presets[0]?.id || "" });

  const pickProvider = (id) => {
    const next = (providers || []).find((p) => p.id === id);
    setDraft((d) => ({ ...d, embeddingProviderId: id, embeddingModel: firstSuggestion(next), embeddingDims: null }));
  };

  const pickModel = (model) => setDraft((d) => ({ ...d, embeddingModel: model || "", embeddingDims: null }));

  // -> detected dims, or null after showing why it failed.
  const detect = async () => {
    setDetecting(true);
    const { data, error } = await detectEmbeddingDims(projectId, {
      providerId: draft.embeddingProviderId,
      model: draft.embeddingModel.trim(),
    });
    setDetecting(false);
    if (error || !data?.dims) {
      toast.error(EMBEDDING_ERROR_MESSAGES[error] || "Couldn't detect the model's dimensions.");
      return null;
    }
    setDraft((d) => ({ ...d, embeddingDims: data.dims }));
    return data.dims;
  };

  const submit = async () => {
    if (!draft.name.trim()) {
      toast.error("Give your knowledge base a name first.");
      return;
    }
    if (!draft.presetId) {
      toast.error("Choose an ingestion preset first.");
      return;
    }
    if (!draft.embeddingProviderId || !draft.embeddingModel.trim()) {
      toast.error("Choose an embedding connection and model first.");
      return;
    }
    const dims = draft.embeddingDims || (await detect());
    if (!dims) return;
    onCreate({
      name: draft.name.trim(),
      description: draft.description.trim(),
      icon: draft.icon || "Database",
      presetId: draft.presetId,
      embeddingProviderId: draft.embeddingProviderId,
      embeddingModel: draft.embeddingModel.trim(),
      embeddingDims: dims,
      status: "active",
    });
    reset();
    onOpenChange(false);
  };

  const noEmbedders = providers !== null && !providers.length;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto bg-background">
        <DialogHeader>
          <DialogTitle>Create knowledge base</DialogTitle>
          <DialogDescription>
            Pick an ingestion preset and an embedding model now — the embedding model
            can&apos;t be changed once the knowledge base exists.
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

          <Field label="Embedding connection">
            {noEmbedders ? (
              <p className="rounded-lg border border-border bg-surface-card px-3 py-2 text-xs text-text-secondary">
                No connection can create embeddings yet.{" "}
                <button
                  type="button"
                  onClick={() => {
                    onOpenChange(false);
                    setTab("Model Providers");
                  }}
                  className="font-medium text-text-secondary underline-offset-2 hover:text-foreground hover:underline"
                >
                  Connect one in Model Providers
                </button>{" "}
                (OpenAI, Cohere, Voyage, Google or an OpenAI-compatible server).
              </p>
            ) : (
              <Select value={draft.embeddingProviderId} onValueChange={pickProvider} disabled={providers === null}>
                <SelectTrigger>
                  <SelectValue placeholder={providers === null ? "Loading connections…" : "Select a connection"} />
                </SelectTrigger>
                <SelectContent>
                  {(providers || []).map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Field>

          {selectedProvider ? (
            <>
              <Field label="Embedding model" htmlFor="kb-embedding-model">
                <ModelIdSelect
                  key={selectedProvider.id}
                  inputId="kb-embedding-model"
                  value={draft.embeddingModel}
                  onChange={pickModel}
                  suggestions={suggestedModelsFor(selectedProvider, "embed")}
                />
              </Field>

              <Field
                label="Dimensions"
                hint={
                  draft.embeddingDims && !isIndexedDims(draft.embeddingDims)
                    ? "No vector index exists for this size, so search is exact — fine for small and medium knowledge bases, slower on very large ones."
                    : "Detected from the model; models that support it are asked for 1024."
                }
              >
                <div className="flex items-center gap-2">
                  <Input
                    value={draft.embeddingDims ? `${draft.embeddingDims} dimensions` : ""}
                    placeholder="Not detected yet"
                    readOnly
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="border-border bg-transparent text-muted-foreground hover:bg-surface-active hover:text-foreground"
                    onClick={detect}
                    disabled={detecting || !draft.embeddingModel.trim()}
                  >
                    {detecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanSearch className="h-4 w-4" />}
                    Detect
                  </Button>
                </div>
              </Field>
            </>
          ) : null}

          <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              The embedding model and its dimensions are locked once created. Changing them
              later requires a new knowledge base and re-ingesting everything into it.
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
            disabled={detecting || noEmbedders}
          >
            {detecting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Create knowledge base
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default CreateKnowledgeBaseDialog;
