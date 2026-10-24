"use client";

import React, { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";

import { Badge } from "@geiger/ui/badge";
import { Button } from "@geiger/ui/button";
import { Checkbox } from "@geiger/ui/checkbox";
import { Input } from "@geiger/ui/input";
import { Slider } from "@geiger/ui/slider";
import { Textarea } from "@geiger/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@geiger/ui/select";
import { Field, SectionCard, SegmentedTabs, SettingRow } from "@/components/internal/shared/screen_kit";
import { ModelIdSelect } from "@/components/internal/shared/model_id_select";
import { useWorkspaceUrl } from "@/lib/hooks/use-workspace-url";
import { hasCapability, suggestedModelsFor } from "@/lib/grey/provider_kinds";
import {
  TEMPLATE_INFO,
  TOOL_LIMITS,
  applyToolPatch,
  normalizeLabels,
  normalizeToolSpec,
  validateToolSpec,
} from "@/lib/grey/tool_spec";
import {
  CLASSIFY_MODE_HINTS,
  CLASSIFY_MODE_TABS,
  INPUT_MODE_TABS,
  MODALITY_TABS,
  templateIcon,
} from "./constants";
import { Notice } from "./tool_result";

const PROJECT_MODEL = "__project__";

// A connection's own model ids first, then the kind's suggestions.
function chatSuggestions(provider) {
  if (!provider) return [];
  const own = (provider.models || []).map((id) => ({ id, label: id }));
  const seen = new Set(own.map((m) => m.id));
  return [...own, ...suggestedModelsFor(provider, "chat").filter((m) => !seen.has(m.id))];
}

const round2 = (n) => Math.round(n * 100) / 100;

function FieldError({ errors }) {
  if (!errors?.length) return null;
  return (
    <div className="space-y-0.5">
      {errors.map((e) => (
        <p key={`${e.path}-${e.message}`} className="text-xs text-destructive-text">
          {e.message}
        </p>
      ))}
    </div>
  );
}

// Text field over a spec value the patch trims (instructions, the text label): the raw text stays
// local while typing — so a trailing space survives — and the spec gets it trimmed.
function DraftText({ as: Component = Input, value, onCommit, ...props }) {
  const shown = value ?? "";
  const [text, setText] = useState(shown);
  const [synced, setSynced] = useState(shown);
  if (shown !== synced) {
    setSynced(shown);
    setText(shown);
  }
  return (
    <Component
      value={text}
      onChange={(e) => {
        const raw = e.target.value;
        setText(raw);
        setSynced(raw.trim());
        onCommit(raw);
      }}
      {...props}
    />
  );
}

// Number field that lets the value be cleared and retyped; commits every parseable value and
// snaps back to the saved one on blur. `allowEmpty` commits null for an empty field.
function NumberInput({ id, value, onCommit, onSettle, allowEmpty = false, ...props }) {
  const shown = value === null || value === undefined ? "" : String(value);
  const [text, setText] = useState(shown);
  const [synced, setSynced] = useState(shown);
  if (shown !== synced) {
    setSynced(shown);
    setText(shown);
  }
  return (
    <Input
      id={id}
      type="number"
      inputMode="numeric"
      value={text}
      onChange={(e) => {
        const raw = e.target.value;
        setText(raw);
        if (!raw.trim()) {
          if (allowEmpty) onCommit(null);
          return;
        }
        const n = Number(raw);
        if (Number.isFinite(n)) onCommit(n);
      }}
      onBlur={() => {
        setText(shown);
        onSettle?.();
      }}
      {...props}
    />
  );
}

const labelsKey = (labels) => JSON.stringify((labels || []).map((l) => [l.value, l.description]));

// Label rows (value + description). Rows are local so a blank row can exist while it's typed;
// the spec gets the normalised, non-empty list.
function LabelsEditor({ labels, onChange, disabled }) {
  const [rows, setRows] = useState(() => labels.map((l) => ({ value: l.value, description: l.description })));
  const [synced, setSynced] = useState(() => labelsKey(labels));
  const current = labelsKey(labels);
  if (current !== synced) {
    setSynced(current);
    setRows(labels.map((l) => ({ value: l.value, description: l.description })));
  }

  const commit = (next) => {
    setRows(next);
    const clean = normalizeLabels(next.filter((r) => r.value.trim()));
    setSynced(labelsKey(clean));
    onChange(clean);
  };

  const update = (i, field, value) => commit(rows.map((r, j) => (j === i ? { ...r, [field]: value } : r)));
  const remove = (i) => commit(rows.filter((_, j) => j !== i));
  const add = () => commit([...rows, { value: "", description: "" }]);

  const firstIndex = new Map();
  rows.forEach((r, i) => {
    const key = r.value.trim().toLowerCase();
    if (key && !firstIndex.has(key)) firstIndex.set(key, i);
  });

  return (
    <div className="space-y-3">
      {rows.length ? (
        <div className="space-y-2">
          {rows.map((row, i) => {
            const key = row.value.trim().toLowerCase();
            const duplicate = key && firstIndex.get(key) !== i;
            return (
              <div key={i} className="space-y-1">
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2 sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)_auto]">
                  <Input
                    value={row.value}
                    maxLength={TOOL_LIMITS.labelChars}
                    placeholder="Label"
                    aria-label={`Label ${i + 1}`}
                    disabled={disabled}
                    onChange={(e) => update(i, "value", e.target.value)}
                  />
                  <Input
                    value={row.description}
                    maxLength={TOOL_LIMITS.labelDescriptionChars}
                    placeholder="What it means (optional)"
                    aria-label={`Description for label ${i + 1}`}
                    disabled={disabled}
                    onChange={(e) => update(i, "description", e.target.value)}
                    className="col-start-1 row-start-2 sm:col-start-auto sm:row-start-auto"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove ${row.value.trim() || `label ${i + 1}`}`}
                    disabled={disabled}
                    onClick={() => remove(i)}
                    className="col-start-2 row-start-1 text-muted-foreground hover:bg-surface-active hover:text-foreground sm:col-start-auto sm:row-start-auto"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                {duplicate ? <p className="text-xs text-amber-400">Listed twice — only the first one counts.</p> : null}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="rounded-lg border border-border bg-surface-card px-3 py-3 text-sm text-text-tertiary">
          No labels yet. Add the labels this tool chooses from.
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-text-tertiary">
          {labels.length} of {TOOL_LIMITS.labelsMax}. They match the labels you give items in Sources; case doesn&apos;t matter.
        </p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="border-border bg-transparent text-muted-foreground hover:bg-surface-active hover:text-foreground"
          disabled={disabled || rows.length >= TOOL_LIMITS.labelsMax}
          onClick={add}
        >
          <Plus className="h-4 w-4" /> Add label
        </Button>
      </div>
    </div>
  );
}

function ModelSection({ spec, patchSpec, providers, canManage, errorsFor }) {
  const { setTab } = useWorkspaceUrl();
  const chatProviders = useMemo(() => providers.filter((p) => hasCapability(p, "chat")), [providers]);
  const providerId = spec.model?.providerId || null;
  const selected = chatProviders.find((p) => p.id === providerId) || null;

  return (
    <SectionCard title="Model" description="The model that decides or answers when this tool calls one. Always your own connection.">
      <div className="grid gap-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            label="Connection"
            hint={
              !chatProviders.length ? (
                <>
                  No chat-capable connection yet —{" "}
                  <button
                    type="button"
                    onClick={() => setTab("Model Providers")}
                    className="font-medium text-text-secondary underline-offset-2 hover:text-foreground hover:underline"
                  >
                    add one in Model Providers
                  </button>
                  . Until then the processing model is used.
                </>
              ) : !providerId ? (
                "Uses the processing model from Settings → General."
              ) : undefined
            }
          >
            <Select
              value={providerId || PROJECT_MODEL}
              disabled={!canManage}
              onValueChange={(value) =>
                patchSpec(value === PROJECT_MODEL ? { model: null } : { model: { providerId: value, model: null } })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={PROJECT_MODEL}>Project processing model</SelectItem>
                {chatProviders.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
                {providerId && !selected ? <SelectItem value={providerId}>Unknown connection</SelectItem> : null}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Model" htmlFor="tool-model-id">
            {selected ? (
              <ModelIdSelect
                key={selected.id}
                inputId="tool-model-id"
                value={spec.model?.model || ""}
                disabled={!canManage}
                noneLabel="Connection default"
                suggestions={chatSuggestions(selected)}
                onChange={(v) => patchSpec({ model: { providerId: selected.id, model: v || null } })}
              />
            ) : (
              <Input
                id="tool-model-id"
                value=""
                disabled
                placeholder={providerId ? "Choose a connection" : "Set in Settings → General"}
              />
            )}
          </Field>
        </div>
        <FieldError errors={errorsFor("model")} />
      </div>
    </SectionCard>
  );
}

/**
 * The tool's spec as a form. Every edit goes through applyToolPatch (so it is normalised the same
 * way the builder's are); its errors show beside the field, validateToolSpec's at the top.
 * `form` is { name, description, spec, … }; `onFormChange(nextForm)`.
 */
export function ToolConfigForm({ form, onFormChange, knowledgeBases = [], providers = [], canManage }) {
  const [patchErrors, setPatchErrors] = useState([]);
  const spec = useMemo(() => normalizeToolSpec(form.spec), [form.spec]);
  const activeKbs = useMemo(() => knowledgeBases.filter((kb) => kb.status !== "archived"), [knowledgeBases]);
  const validation = useMemo(
    () => validateToolSpec(spec, { kbIds: activeKbs.map((kb) => kb.id) }),
    [spec, activeKbs],
  );

  const patchSpec = (patch) => {
    if (!canManage) return;
    const res = applyToolPatch(form.spec, patch);
    setPatchErrors(res.errors);
    onFormChange({ ...form, spec: res.spec });
  };
  const setField = (key) => (value) => canManage && onFormChange({ ...form, [key]: value });
  const errorsFor = (prefix) => patchErrors.filter((e) => e.path === prefix || e.path.startsWith(`${prefix}.`));
  const settle = (prefix) => () => setPatchErrors((prev) => prev.filter((e) => !(e.path === prefix || e.path.startsWith(`${prefix}.`))));

  const TemplateIcon = templateIcon(spec.template);
  const info = TEMPLATE_INFO[spec.template];
  const kbIds = spec.scope.kbIds;
  const staleKbIds = kbIds.filter((id) => !activeKbs.some((kb) => kb.id === id));
  const kbName = (id) => knowledgeBases.find((kb) => kb.id === id)?.name;
  const toggleKb = (id, checked) =>
    patchSpec({ scope: { kbIds: checked ? [...kbIds, id] : kbIds.filter((x) => x !== id) } });
  const usesModel =
    spec.template === "answer_similar" || (spec.template === "classify" && spec.classify?.mode !== "knn");

  return (
    <div className="space-y-5">
      {!validation.ok ? (
        <Notice>
          <p className="font-medium">Fix these before publishing:</p>
          <ul className="mt-0.5 list-disc space-y-0.5 pl-4">
            {validation.errors.map((e) => (
              <li key={`${e.path}-${e.message}`}>{e.message}</li>
            ))}
          </ul>
        </Notice>
      ) : null}

      <SectionCard title="Details" description="How the tool is named in Grey, API keys and MCP servers.">
        <div className="grid gap-4">
          <Field label="Name" htmlFor="tool-name">
            <Input
              id="tool-name"
              value={form.name || ""}
              maxLength={TOOL_LIMITS.nameChars}
              disabled={!canManage}
              onChange={(e) => setField("name")(e.target.value)}
            />
          </Field>
          <Field label="Description" htmlFor="tool-description" hint="For your team. MCP clients get a description generated from the template.">
            <Textarea
              id="tool-description"
              value={form.description || ""}
              maxLength={TOOL_LIMITS.descriptionChars}
              rows={2}
              disabled={!canManage}
              onChange={(e) => setField("description")(e.target.value)}
              placeholder="What this tool is for"
            />
          </Field>
          <div className="flex items-start gap-3 rounded-lg border border-border bg-surface-card p-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-subtle text-muted-foreground">
              <TemplateIcon className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium text-foreground">{info.label}</p>
                <Badge variant="neutral">Template</Badge>
              </div>
              <p className="text-xs text-text-secondary">{info.description}</p>
              <p className="mt-1 text-xs text-text-tertiary">Ask the builder in Build to switch templates.</p>
            </div>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Inputs" description="What a run takes. At least one input must be on.">
        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Image">
              <SegmentedTabs
                tabs={INPUT_MODE_TABS}
                value={spec.input.image}
                onChange={(v) => patchSpec({ input: { image: v } })}
              />
            </Field>
            <Field label="Text">
              <SegmentedTabs
                tabs={INPUT_MODE_TABS}
                value={spec.input.text}
                onChange={(v) => patchSpec({ input: { text: v } })}
              />
            </Field>
          </div>
          {spec.input.text !== "off" ? (
            <Field label="Text field label" htmlFor="tool-text-label" hint="Shown above the text box, e.g. Question or Description.">
              <DraftText
                id="tool-text-label"
                value={spec.input.textLabel}
                maxLength={TOOL_LIMITS.textLabelChars}
                disabled={!canManage}
                placeholder="Text"
                onCommit={(raw) => patchSpec({ input: { textLabel: raw.trim() || null } })}
              />
            </Field>
          ) : null}
          <FieldError errors={errorsFor("input")} />
        </div>
      </SectionCard>

      <SectionCard title="Knowledge bases" description="The stored items this tool compares against.">
        <div className="grid gap-4">
          <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
            {activeKbs.length || staleKbIds.length ? (
              <>
                {activeKbs.map((kb) => (
                  <label key={kb.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-surface-subtle">
                    <Checkbox
                      checked={kbIds.includes(kb.id)}
                      disabled={!canManage}
                      onCheckedChange={(checked) => toggleKb(kb.id, Boolean(checked))}
                    />
                    <span className="text-sm text-foreground">{kb.name}</span>
                  </label>
                ))}
                {staleKbIds.map((id) => (
                  <label key={id} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-surface-subtle">
                    <Checkbox
                      checked
                      disabled={!canManage}
                      onCheckedChange={(checked) => toggleKb(id, Boolean(checked))}
                    />
                    <span className="text-sm text-text-secondary">{kbName(id) || "Deleted knowledge base"}</span>
                    <Badge variant="neutral">Unavailable</Badge>
                  </label>
                ))}
              </>
            ) : (
              <p className="px-2 py-1.5 text-sm text-text-tertiary">No knowledge bases yet.</p>
            )}
          </div>
          <Field label="Items to compare" hint="Images only suits photo lookups; text only skips images.">
            <SegmentedTabs
              tabs={MODALITY_TABS}
              value={spec.scope.modality}
              onChange={(v) => patchSpec({ scope: { modality: v } })}
            />
          </Field>
          <FieldError errors={errorsFor("scope")} />
        </div>
      </SectionCard>

      <SectionCard title="Search" description="How many similar items come back, and how alike they must be.">
        <div className="grid gap-5">
          <Field
            label="Similar items returned"
            htmlFor="tool-topk"
            stepper={canManage}
            value={spec.search.topK}
            min={1}
            max={TOOL_LIMITS.topKMax}
            onValueChange={(v) => patchSpec({ search: { topK: Number(v) } })}
          >
            <NumberInput
              id="tool-topk"
              value={spec.search.topK}
              min={1}
              max={TOOL_LIMITS.topKMax}
              disabled={!canManage}
              onCommit={(n) => patchSpec({ search: { topK: n } })}
              onSettle={settle("search.topK")}
            />
          </Field>
          <Field
            label={`Minimum similarity — ${spec.search.minScore.toFixed(2)}`}
            hint="Items below this score are left out. Image matches usually score lower than text matches."
          >
            <Slider
              value={[spec.search.minScore]}
              min={0}
              max={1}
              step={0.05}
              disabled={!canManage}
              aria-label="Minimum similarity"
              onValueChange={([v]) => patchSpec({ search: { minScore: round2(v) } })}
            />
          </Field>
          <FieldError errors={errorsFor("search")} />
        </div>
      </SectionCard>

      {spec.classify ? (
        <SectionCard title="Labels" description="The fixed set this tool picks one label from.">
          <div className="grid gap-5">
            <LabelsEditor
              labels={spec.classify.labels}
              disabled={!canManage}
              onChange={(labels) => patchSpec({ classify: { labels } })}
            />
            <Field label="How the label is decided" hint={CLASSIFY_MODE_HINTS[spec.classify.mode]}>
              <SegmentedTabs
                tabs={CLASSIFY_MODE_TABS}
                value={spec.classify.mode}
                onChange={(v) => patchSpec({ classify: { mode: v } })}
              />
            </Field>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field
                label="Neighbours that vote"
                htmlFor="tool-k"
                stepper={canManage}
                value={spec.classify.k}
                min={1}
                max={TOOL_LIMITS.kMax}
                onValueChange={(v) => patchSpec({ classify: { k: Number(v) } })}
              >
                <NumberInput
                  id="tool-k"
                  value={spec.classify.k}
                  min={1}
                  max={TOOL_LIMITS.kMax}
                  disabled={!canManage}
                  onCommit={(n) => patchSpec({ classify: { k: n } })}
                  onSettle={settle("classify.k")}
                />
              </Field>
              <Field
                label={`Minimum vote margin — ${spec.classify.minMargin.toFixed(2)}`}
                hint="How far the top label must lead before the vote counts as decided."
              >
                <Slider
                  value={[spec.classify.minMargin]}
                  min={0}
                  max={1}
                  step={0.05}
                  disabled={!canManage}
                  aria-label="Minimum vote margin"
                  onValueChange={([v]) => patchSpec({ classify: { minMargin: round2(v) } })}
                />
              </Field>
            </div>
            <FieldError errors={errorsFor("classify")} />
          </div>
        </SectionCard>
      ) : null}

      {spec.answer ? (
        <SectionCard title="Answer" description="How answers are written. Grey's own rules — cite, don't guess — always apply.">
          <div className="grid gap-5">
            <Field
              label="Instructions"
              htmlFor="tool-instructions"
              hint={`${spec.answer.instructions.length.toLocaleString("en-US")} / ${TOOL_LIMITS.instructionsChars.toLocaleString("en-US")} characters`}
            >
              <DraftText
                as={Textarea}
                id="tool-instructions"
                value={spec.answer.instructions}
                maxLength={TOOL_LIMITS.instructionsChars}
                rows={6}
                disabled={!canManage}
                placeholder="e.g. Answer in two short paragraphs. Name the closest matching case first."
                onCommit={(raw) => patchSpec({ answer: { instructions: raw } })}
              />
            </Field>
            <Field
              label="Max answer length (tokens)"
              htmlFor="tool-max-tokens"
              stepper={canManage}
              value={spec.answer.maxOutputTokens}
              step={50}
              min={TOOL_LIMITS.maxOutputTokensMin}
              max={TOOL_LIMITS.maxOutputTokensMax}
              onValueChange={(v) => patchSpec({ answer: { maxOutputTokens: Number(v) } })}
            >
              <NumberInput
                id="tool-max-tokens"
                value={spec.answer.maxOutputTokens}
                min={TOOL_LIMITS.maxOutputTokensMin}
                max={TOOL_LIMITS.maxOutputTokensMax}
                disabled={!canManage}
                onCommit={(n) => patchSpec({ answer: { maxOutputTokens: n } })}
                onSettle={settle("answer.maxOutputTokens")}
              />
            </Field>
            <SettingRow
              title="Show reference images to the model"
              description="When the question has an image, the similar items' thumbnails are sent too."
              checked={spec.answer.includeImages}
              onCheckedChange={(v) => patchSpec({ answer: { includeImages: v } })}
              control={
                canManage ? undefined : (
                  <span className="text-xs text-text-tertiary">{spec.answer.includeImages ? "On" : "Off"}</span>
                )
              }
            />
            <FieldError errors={errorsFor("answer")} />
          </div>
        </SectionCard>
      ) : null}

      {usesModel ? (
        <ModelSection spec={spec} patchSpec={patchSpec} providers={providers} canManage={canManage} errorsFor={errorsFor} />
      ) : null}

      <SectionCard title="Limits" description="Caps that keep every run's cost predictable.">
        <div className="grid gap-5 sm:grid-cols-2">
          {usesModel ? (
            <Field
              label="Model calls per run"
              htmlFor="tool-max-calls"
              stepper={canManage}
              value={spec.budget.maxLlmCalls}
              min={1}
              max={TOOL_LIMITS.maxLlmCallsMax}
              onValueChange={(v) => patchSpec({ budget: { maxLlmCalls: Number(v) } })}
            >
              <NumberInput
                id="tool-max-calls"
                value={spec.budget.maxLlmCalls}
                min={1}
                max={TOOL_LIMITS.maxLlmCallsMax}
                disabled={!canManage}
                onCommit={(n) => patchSpec({ budget: { maxLlmCalls: n } })}
                onSettle={settle("budget.maxLlmCalls")}
              />
            </Field>
          ) : null}
          <Field
            label="Monthly run limit"
            htmlFor="tool-monthly-limit"
            hint="Runs from API keys and MCP servers each calendar month. Leave empty for no limit."
          >
            <NumberInput
              id="tool-monthly-limit"
              value={spec.budget.monthlyRunLimit}
              min={1}
              max={TOOL_LIMITS.monthlyRunLimitMax}
              allowEmpty
              placeholder="No limit"
              disabled={!canManage}
              onCommit={(n) => patchSpec({ budget: { monthlyRunLimit: n } })}
              onSettle={settle("budget.monthlyRunLimit")}
            />
          </Field>
        </div>
        <div className="mt-3">
          <FieldError errors={errorsFor("budget")} />
        </div>
      </SectionCard>
    </div>
  );
}

export default ToolConfigForm;
