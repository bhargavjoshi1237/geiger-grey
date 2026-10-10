"use client";

import React, { useMemo, useState } from "react";
import { AlertTriangle, KeyRound, Loader2 } from "lucide-react";

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

const NAME_MAX = 80;
const RATE_MIN = 1;
const RATE_MAX = 10000;

// Tomorrow as a yyyy-mm-dd string — the server rejects an expiry that isn't
// strictly in the future, so "today" is never offered as the earliest pick.
function tomorrowDateString() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

// Create dialog — collects name, scopes, pipeline scoping, rate limit and an
// optional expiry, validated to match the `/api/api-keys` route exactly so a
// rejected submission is rare rather than the common case. The plaintext key
// never passes through here: the caller creates the record and hands the
// result to `RevealApiKeyDialog` instead.
export function CreateApiKeyDialog({ open, onOpenChange, pipelines, onCreate }) {
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const minExpiry = useMemo(() => tomorrowDateString(), []);

  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setDraft(EMPTY_DRAFT);
      setAttempted(false);
    }
  }

  const set = (key) => (value) => setDraft((d) => ({ ...d, [key]: value }));

  const toggleScope = (value, on) =>
    setDraft((d) => ({
      ...d,
      scopes: on ? [...d.scopes, value] : d.scopes.filter((s) => s !== value),
    }));

  const trimmedName = draft.name.trim();
  const nameError = !trimmedName
    ? "Name is required."
    : trimmedName.length > NAME_MAX
      ? `Name must be ${NAME_MAX} characters or fewer.`
      : "";
  const scopesError = draft.scopes.length === 0 ? "Pick at least one scope." : "";
  const rateLimitNum = Number(draft.rateLimitPerMin);
  const rateLimitError =
    draft.rateLimitPerMin === "" || !Number.isInteger(rateLimitNum) || rateLimitNum < RATE_MIN || rateLimitNum > RATE_MAX
      ? `Enter a whole number from ${RATE_MIN} to ${RATE_MAX}.`
      : "";
  const expiresAtError =
    draft.expiresAt && new Date(draft.expiresAt).getTime() <= new Date().getTime()
      ? "Expiry must be a future date."
      : "";
  const isValid = !nameError && !scopesError && !rateLimitError && !expiresAtError;

  const submit = async () => {
    setAttempted(true);
    if (!isValid) return;
    setSaving(true);
    const ok = await onCreate({
      name: trimmedName,
      scopes: draft.scopes,
      pipelineIds: draft.pipelineIds,
      rateLimitPerMin: rateLimitNum,
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
              maxLength={NAME_MAX}
              aria-invalid={attempted && !!nameError}
              autoFocus
            />
            {attempted && nameError ? (
              <p className="text-xs text-destructive-text">{nameError}</p>
            ) : null}
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
            {attempted && scopesError ? (
              <p className="text-xs text-destructive-text">{scopesError}</p>
            ) : null}
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
            <Field label="Rate limit (per minute)" htmlFor="apikey-rate-limit">
              <Input
                id="apikey-rate-limit"
                type="number"
                min={RATE_MIN}
                max={RATE_MAX}
                step={1}
                value={draft.rateLimitPerMin}
                onChange={(e) => set("rateLimitPerMin")(e.target.value)}
                aria-invalid={attempted && !!rateLimitError}
              />
              {attempted && rateLimitError ? (
                <p className="text-xs text-destructive-text">{rateLimitError}</p>
              ) : null}
            </Field>
            <Field label="Expires" htmlFor="apikey-expires" hint="Optional.">
              <Input
                id="apikey-expires"
                type="date"
                min={minExpiry}
                value={draft.expiresAt || ""}
                onChange={(e) => set("expiresAt")(e.target.value)}
                aria-invalid={attempted && !!expiresAtError}
              />
              {attempted && expiresAtError ? (
                <p className="text-xs text-destructive-text">{expiresAtError}</p>
              ) : null}
            </Field>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving || !isValid}>
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
