"use client";

import React, { useState } from "react";
import { AlertTriangle, KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Field } from "@/components/internal/shared/screen_kit";
import { CopyBlock } from "@/components/internal/shared/copy_block";
import { Button } from "@geiger/ui/button";
import { Input } from "@geiger/ui/input";
import { Checkbox } from "@geiger/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@geiger/ui/dialog";

import { MultiSelectList } from "./multi_select_list";
import { SCOPE_OPTIONS } from "./constants";

const EMPTY_DRAFT = {
  name: "",
  scopes: ["retrieve", "chat"],
  pipelineIds: [],
  rateLimitPerMin: "60",
  expiresAt: "",
};

// Create dialog — collects name, scopes, pipeline scoping, rate limit and an
// optional expiry. The plaintext key never passes through here: the caller
// creates the record and hands the result to `RevealApiKeyDialog` instead.
export function CreateApiKeyDialog({ open, onOpenChange, pipelines, onCreate }) {
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);

  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setDraft(EMPTY_DRAFT);
  }

  const set = (key) => (value) => setDraft((d) => ({ ...d, [key]: value }));

  const toggleScope = (value, on) =>
    setDraft((d) => ({
      ...d,
      scopes: on ? [...d.scopes, value] : d.scopes.filter((s) => s !== value),
    }));

  const submit = async () => {
    if (!draft.name.trim()) {
      toast.error("Give the key a name.");
      return;
    }
    setSaving(true);
    const ok = await onCreate({
      name: draft.name.trim(),
      scopes: draft.scopes,
      pipelineIds: draft.pipelineIds,
      rateLimitPerMin: Number(draft.rateLimitPerMin) || 60,
      expiresAt: draft.expiresAt || null,
    });
    setSaving(false);
    if (ok) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto bg-background">
        <DialogHeader>
          <DialogTitle>New API Key</DialogTitle>
          <DialogDescription>
            Keys authenticate retrieval, chat and MCP requests made outside the
            workspace. The plaintext value is shown once, right after creation.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Field label="Name" htmlFor="apikey-name">
            <Input
              id="apikey-name"
              value={draft.name}
              onChange={(e) => set("name")(e.target.value)}
              placeholder="e.g. Production server"
              autoFocus
            />
          </Field>

          <Field label="Scopes" hint="What this key is allowed to call.">
            <div className="space-y-2 rounded-lg border border-border bg-surface-card p-3">
              {SCOPE_OPTIONS.map((opt) => (
                <label key={opt.value} className="flex items-start gap-3 text-sm">
                  <Checkbox
                    checked={draft.scopes.includes(opt.value)}
                    onCheckedChange={(v) => toggleScope(opt.value, !!v)}
                    className="mt-0.5"
                    aria-label={opt.label}
                  />
                  <span>
                    <span className="block font-medium text-foreground">{opt.label}</span>
                    <span className="block text-xs text-text-secondary">{opt.description}</span>
                  </span>
                </label>
              ))}
            </div>
          </Field>

          <Field
            label="Pipelines"
            hint="Leave empty to allow this key on every pipeline in the project."
          >
            <MultiSelectList
              items={pipelines}
              value={draft.pipelineIds}
              onChange={set("pipelineIds")}
              emptyTitle="No pipelines yet"
              emptyHint="Create a pipeline first, or leave this key unscoped."
              summaryLabel="pipeline"
            />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field
              label="Rate limit (per minute)"
              stepper
              value={draft.rateLimitPerMin}
              onValueChange={set("rateLimitPerMin")}
              min={1}
              max={6000}
            >
              <Input
                type="number"
                min={1}
                value={draft.rateLimitPerMin}
                onChange={(e) => set("rateLimitPerMin")(e.target.value)}
              />
            </Field>
            <Field label="Expires" hint="Optional.">
              <Input
                type="date"
                value={draft.expiresAt || ""}
                onChange={(e) => set("expiresAt")(e.target.value)}
              />
            </Field>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
            Create Key
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Reveal-once dialog — the only place the plaintext key is ever shown. The
// caller drops its reference to the plaintext as soon as this closes, so
// closing (any way) is effectively "I saved it" or "I'm giving up on it".
export function RevealApiKeyDialog({ open, onOpenChange, plainKey, name }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg bg-background">
        <DialogHeader>
          <DialogTitle>{name || "API key"} created</DialogTitle>
          <DialogDescription>
            Copy this key now — it won&apos;t be shown again.
          </DialogDescription>
        </DialogHeader>

        <CopyBlock value={plainKey || ""} label="Plaintext key" />

        <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-400">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            This is the only time the full key is displayed. If you lose it,
            revoke it and create a new one — the server only ever stores a hash.
          </span>
        </div>

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
