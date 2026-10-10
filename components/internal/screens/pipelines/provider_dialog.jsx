"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@geiger/ui/button";
import { Input } from "@geiger/ui/input";
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
import { TagInput } from "@/components/internal/shared/tag_input";
import { PROVIDERS } from "./constants";

const emptyDraft = () => ({
  provider: PROVIDERS[0].value,
  name: PROVIDERS[0].label,
  baseUrl: "",
  models: PROVIDERS[0].models || [],
});

// Create/edit a model provider connection. The secret never round-trips once
// saved — leaving the key field blank on an edit keeps the stored one.
export function ProviderDialog({ open, onOpenChange, provider, onSave, saving }) {
  const [draft, setDraft] = useState(emptyDraft());
  const [secret, setSecret] = useState("");
  const [seedKey, setSeedKey] = useState(null);

  // Re-seed the form from `provider` every time the dialog opens (or swaps
  // which row it's editing) — done during render, same as the editor screens'
  // seed-on-prop-change pattern, so it never fires a redundant effect render.
  const currentKey = open ? provider?.id || "new" : null;
  if (currentKey !== seedKey) {
    setSeedKey(currentKey);
    if (open) {
      setDraft(
        provider
          ? {
              provider: provider.provider,
              name: provider.name,
              baseUrl: provider.baseUrl || "",
              models: provider.models || [],
            }
          : emptyDraft(),
      );
      setSecret("");
    }
  }

  const set = (key) => (value) => setDraft((d) => ({ ...d, [key]: value }));

  const meta = PROVIDERS.find((p) => p.value === draft.provider);

  const pickProvider = (value) => {
    const nextMeta = PROVIDERS.find((p) => p.value === value);
    setDraft((d) => ({
      ...d,
      provider: value,
      name: d.name === meta?.label ? nextMeta?.label || d.name : d.name,
      models: d.models.length ? d.models : nextMeta?.models || [],
      baseUrl: nextMeta?.needsBaseUrl ? d.baseUrl : "",
    }));
  };

  const submit = () => {
    if (!draft.name.trim()) return;
    onSave({ ...draft, name: draft.name.trim() }, secret.trim());
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg bg-background">
        <DialogHeader>
          <DialogTitle>{provider ? "Edit provider" : "Add model provider"}</DialogTitle>
          <DialogDescription>
            Connect a model API so pipelines can call it. The key is stored in
            Vault — only the last 4 characters are ever shown again.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <Field label="Provider">
            <Select value={draft.provider} onValueChange={pickProvider} disabled={!!provider}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROVIDERS.map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Name" htmlFor="provider-name">
            <Input
              id="provider-name"
              value={draft.name}
              onChange={(e) => set("name")(e.target.value)}
              placeholder="e.g. Production OpenAI"
              autoFocus
            />
          </Field>

          {meta?.needsBaseUrl ? (
            <Field
              label="Base URL"
              htmlFor="provider-base-url"
              hint="OpenAI-compatible endpoint, e.g. https://api.your-host.com/v1"
            >
              <Input
                id="provider-base-url"
                value={draft.baseUrl}
                onChange={(e) => set("baseUrl")(e.target.value)}
                placeholder="https://"
              />
            </Field>
          ) : null}

          <Field
            label="API key"
            htmlFor="provider-secret"
            hint={
              provider
                ? "Leave blank to keep the current key."
                : "Stored securely; shown again only as •••• last4."
            }
          >
            <Input
              id="provider-secret"
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder="sk-…"
              autoComplete="off"
            />
          </Field>

          <Field label="Models" hint="Models this connection can serve.">
            <TagInput value={draft.models} onChange={set("models")} placeholder="Add a model id…" />
          </Field>
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
            disabled={saving}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {provider ? "Save changes" : "Add provider"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ProviderDialog;
