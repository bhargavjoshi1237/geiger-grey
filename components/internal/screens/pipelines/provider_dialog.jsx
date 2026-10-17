"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import { Badge } from "@geiger/ui/badge";
import { Button } from "@geiger/ui/button";
import { Checkbox } from "@geiger/ui/checkbox";
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
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@geiger/ui/select";
import { Field } from "@/components/internal/shared/screen_kit";
import { TagInput } from "@/components/internal/shared/tag_input";
import { CAPABILITY_LABELS, PROVIDER_KINDS, capabilitiesOf } from "@/lib/grey/provider_kinds";
import { PROVIDERS } from "./constants";

const KIND_TEMPLATES = PROVIDERS.filter((p) => !p.preset);
const PRESET_TEMPLATES = PROVIDERS.filter((p) => p.preset);

const CAPABILITY_HINTS = {
  chat: "Answers in pipelines, plus the project's processing model.",
  embed: "Embeds knowledge base chunks and queries (/embeddings).",
  transcribe: "Transcribes audio and video (/audio/transcriptions).",
};

const findTemplate = (value) => PROVIDERS.find((p) => p.value === value) || PROVIDERS[0];

const draftFromTemplate = (template) => ({
  template: template.value,
  provider: template.kind,
  preset: template.preset,
  name: template.label,
  // Presets carry their server URL; kinds with an editable URL start blank (= default).
  baseUrl: template.preset ? template.baseUrl || "" : "",
  models: template.models,
  capabilities: template.capabilities,
});

const draftFromProvider = (provider) => ({
  template: provider.metadata?.preset ? `preset:${provider.metadata.preset}` : provider.provider,
  provider: provider.provider,
  preset: provider.metadata?.preset || null,
  name: provider.name,
  baseUrl: provider.baseUrl || "",
  models: provider.models || [],
  capabilities: capabilitiesOf(provider),
});

const sameList = (a = [], b = []) => a.length === b.length && a.every((x, i) => x === b[i]);

// Create/edit a provider connection. The kind (or preset) decides its capabilities
// and base URL rules; the secret never round-trips once saved — leaving the key
// field blank on an edit keeps the stored one.
export function ProviderDialog({ open, onOpenChange, provider, onSave, saving }) {
  const [draft, setDraft] = useState(() => draftFromTemplate(PROVIDERS[0]));
  const [secret, setSecret] = useState("");
  const [seedKey, setSeedKey] = useState(null);

  // Re-seed the form from `provider` every time the dialog opens (or swaps
  // which row it's editing) — done during render, same as the editor screens'
  // seed-on-prop-change pattern, so it never fires a redundant effect render.
  const currentKey = open ? provider?.id || "new" : null;
  if (currentKey !== seedKey) {
    setSeedKey(currentKey);
    if (open) {
      setDraft(provider ? draftFromProvider(provider) : draftFromTemplate(PROVIDERS[0]));
      setSecret("");
    }
  }

  const set = (key) => (value) => setDraft((d) => ({ ...d, [key]: value }));

  const kind = PROVIDER_KINDS[draft.provider] || null;
  const userPicksCapabilities = kind?.capabilities === "user";
  const capabilities = capabilitiesOf({
    provider: draft.provider,
    metadata: { preset: draft.preset, capabilities: draft.capabilities },
  });
  const servesChat = capabilities.includes("chat");

  const pickTemplate = (value) => {
    const next = findTemplate(value);
    setDraft((d) => {
      const current = findTemplate(d.template);
      return {
        ...draftFromTemplate(next),
        // Keep what the user typed; replace only what still matches the old template.
        name: d.name === current.label ? next.label : d.name,
        models: !d.models.length || sameList(d.models, current.models) ? next.models : d.models,
      };
    });
  };

  const toggleCapability = (capability, checked) =>
    setDraft((d) => ({
      ...d,
      capabilities: checked
        ? [...new Set([...d.capabilities, capability])]
        : d.capabilities.filter((c) => c !== capability),
    }));

  const submit = () => {
    if (!draft.name.trim()) return;
    if (kind?.baseUrlMode === "required" && !draft.baseUrl.trim()) {
      toast.error("Add the server's base URL.");
      return;
    }
    if (userPicksCapabilities && !draft.capabilities.length) {
      toast.error("Pick at least one capability.");
      return;
    }
    const metadata = { ...(provider?.metadata || {}) };
    if (draft.preset) metadata.preset = draft.preset;
    else delete metadata.preset;
    if (userPicksCapabilities || draft.preset) metadata.capabilities = draft.capabilities;
    else delete metadata.capabilities;

    onSave(
      {
        provider: draft.provider,
        name: draft.name.trim(),
        baseUrl: kind?.baseUrlMode === "fixed" ? null : draft.baseUrl.trim() || null,
        models: servesChat ? draft.models : [],
        metadata,
      },
      secret.trim(),
    );
    // The raw key only ever needs to live in this field long enough to hand
    // it off — clear it immediately, whether onSave ends up succeeding or not.
    setSecret("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto bg-background">
        <DialogHeader>
          <DialogTitle>{provider ? "Edit provider" : "Add model provider"}</DialogTitle>
          <DialogDescription>
            Connect one of your provider accounts. Its capabilities decide where it can be used.
            The key is stored in Vault — only the last 4 characters are ever shown again.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <Field label="Provider">
            <Select value={draft.template} onValueChange={pickTemplate} disabled={!!provider}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>Providers</SelectLabel>
                  {KIND_TEMPLATES.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
                <SelectSeparator />
                <SelectGroup>
                  <SelectLabel>Presets</SelectLabel>
                  {PRESET_TEMPLATES.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            {!userPicksCapabilities ? (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {capabilities.map((c) => (
                  <Badge key={c} variant="neutral">
                    {CAPABILITY_LABELS[c]}
                  </Badge>
                ))}
              </div>
            ) : null}
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

          {kind && kind.baseUrlMode !== "fixed" ? (
            <Field
              label="Base URL"
              htmlFor="provider-base-url"
              hint={
                kind.baseUrlMode === "required"
                  ? "OpenAI-compatible endpoint, e.g. https://api.your-host.com/v1"
                  : `Leave blank to use ${kind.baseUrl}`
              }
            >
              <Input
                id="provider-base-url"
                value={draft.baseUrl}
                onChange={(e) => set("baseUrl")(e.target.value)}
                placeholder={kind.baseUrl || "https://"}
              />
            </Field>
          ) : null}

          {userPicksCapabilities ? (
            <Field label="Capabilities" hint="What this server can do. Each one appears in the matching pickers.">
              <div className="space-y-2 rounded-lg border border-border bg-surface-card p-3">
                {kind.userCapabilities.map((c) => (
                  <label key={c} className="flex items-start gap-3 text-sm">
                    <Checkbox
                      checked={draft.capabilities.includes(c)}
                      onCheckedChange={(v) => toggleCapability(c, !!v)}
                      className="mt-0.5"
                      aria-label={CAPABILITY_LABELS[c]}
                    />
                    <span>
                      <span className="block font-medium text-foreground">{CAPABILITY_LABELS[c]}</span>
                      <span className="block text-xs text-text-secondary">{CAPABILITY_HINTS[c]}</span>
                    </span>
                  </label>
                ))}
              </div>
            </Field>
          ) : null}

          <Field
            label="API key"
            htmlFor="provider-secret"
            hint={
              provider
                ? "Leave blank to keep the current key."
                : userPicksCapabilities
                  ? "Optional for local servers without auth. Shown again only as •••• last4."
                  : "Stored securely; shown again only as •••• last4."
            }
          >
            <Input
              id="provider-secret"
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder="Paste API key"
              autoComplete="off"
            />
          </Field>

          {servesChat ? (
            <Field label="Chat models" hint="Model ids pipelines and the processing model can call.">
              <TagInput value={draft.models} onChange={set("models")} placeholder="Add a model id…" />
            </Field>
          ) : null}
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
