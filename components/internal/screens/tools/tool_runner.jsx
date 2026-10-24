"use client";

import React, { useMemo, useRef, useState } from "react";
import { Loader2, Play, ScanSearch } from "lucide-react";

import { LoadingArea } from "@geiger/ui";
import { Button } from "@geiger/ui/button";
import { Textarea } from "@geiger/ui/textarea";
import { Field, SectionCard } from "@/components/internal/shared/screen_kit";
import { cn } from "@/lib/utils";
import { TOOL_LIMITS, estimateRunCost, normalizeToolSpec } from "@/lib/grey/tool_spec";
import { runToolRequest } from "@/lib/supabase/tools";
import { runErrorMessage } from "./constants";
import { ImageInput } from "./image_input";
import { Notice, ToolResultView } from "./tool_result";

// "One search per run; at most one model call." — what a run of this spec can cost.
function describeCost(spec) {
  const { llmCalls } = estimateRunCost(spec);
  if (!llmCalls.max) return "One search per run, no model calls.";
  if (llmCalls.min === llmCalls.max) return "One search and one model call per run, on your own model.";
  return "One search per run; at most one model call, on your own model.";
}

const optionalTag = (mode) => (mode === "optional" ? " (optional)" : "");

/**
 * Runs a tool from a form generated from its spec's inputs. `version` 0 runs the saved draft;
 * a published version number runs that snapshot (pass that version's spec in `tool.spec`).
 * `compact` is the tighter layout used beside the builder chat.
 */
export function ToolRunner({ tool, projectId, version = 0, compact = false }) {
  const spec = useMemo(() => normalizeToolSpec(tool?.spec), [tool?.spec]);
  const [image, setImage] = useState(null);
  const [text, setText] = useState("");
  const [running, setRunning] = useState(false);
  const [outcome, setOutcome] = useState({ result: null, error: null });
  const [seedId, setSeedId] = useState(tool?.id);
  const requestRef = useRef(0);

  if (tool?.id !== seedId) {
    setSeedId(tool?.id);
    setImage(null);
    setText("");
    setRunning(false);
    setOutcome({ result: null, error: null });
  }

  if (!tool) return null;

  const imageMode = spec.input.image;
  const textMode = spec.input.text;
  const textLabel = spec.input.textLabel || (spec.template === "answer_similar" ? "Question" : "Text");
  const hasImage = imageMode !== "off" && Boolean(image);
  const hasText = textMode !== "off" && Boolean(text.trim());
  const noInputs = imageMode === "off" && textMode === "off";
  const ready =
    !noInputs &&
    (hasImage || hasText) &&
    !(imageMode === "required" && !hasImage) &&
    !(textMode === "required" && !hasText);

  const run = async () => {
    if (!ready || running) return;
    const request = ++requestRef.current;
    setRunning(true);
    setOutcome((prev) => ({ ...prev, error: null }));
    const { data, error, message } = await runToolRequest({
      projectId,
      toolId: tool.id,
      text: hasText ? text.trim() : undefined,
      image: hasImage ? { data: image.data, mimeType: image.mimeType } : undefined,
      version,
    });
    if (request !== requestRef.current) return;
    setRunning(false);
    if (error || !data?.result) {
      setOutcome({ result: null, error: runErrorMessage(error, message) });
      return;
    }
    setOutcome({ result: data.result, error: null });
  };

  const clear = () => {
    requestRef.current += 1;
    setImage(null);
    setText("");
    setRunning(false);
    setOutcome({ result: null, error: null });
  };

  const fields = noInputs ? (
    <Notice>This tool has no inputs turned on. Turn on image or text input in Configure.</Notice>
  ) : (
    <div className={cn("grid", compact ? "gap-3" : "gap-4")}>
      {imageMode !== "off" ? (
        <Field label={`Image${optionalTag(imageMode)}`}>
          <ImageInput value={image} onChange={setImage} disabled={running} compact={compact} />
        </Field>
      ) : null}
      {textMode !== "off" ? (
        <Field label={`${textLabel}${optionalTag(textMode)}`} htmlFor={`tool-run-text-${tool.id}`}>
          <Textarea
            id={`tool-run-text-${tool.id}`}
            value={text}
            maxLength={TOOL_LIMITS.textInputChars}
            rows={compact ? 2 : 3}
            disabled={running}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                run();
              }
            }}
            placeholder={spec.template === "answer_similar" ? "Ask a question about the item…" : "Describe the item…"}
          />
        </Field>
      ) : null}
    </div>
  );

  const actions = (
    <div className={cn("flex flex-wrap items-center gap-3", compact ? "justify-end" : "justify-between")}>
      {compact ? null : <p className="text-xs text-text-tertiary">{describeCost(spec)}</p>}
      <div className="flex items-center gap-2">
        {outcome.result || image || text ? (
          <Button variant="ghost" size={compact ? "sm" : "default"} onClick={clear} disabled={running}>
            Clear
          </Button>
        ) : null}
        <Button
          size={compact ? "sm" : "default"}
          className="bg-primary text-primary-foreground hover:bg-primary/90"
          onClick={run}
          disabled={!ready || running}
        >
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          {running ? "Running…" : "Run"}
        </Button>
      </div>
    </div>
  );

  const resultArea = outcome.result ? (
    <div className={cn("transition-opacity", running && "opacity-60")}>
      <ToolResultView result={outcome.result} compact={compact} />
    </div>
  ) : running ? (
    <LoadingArea label="Running the tool" size={compact ? 28 : 40} className={compact ? "py-8" : undefined} />
  ) : compact ? null : (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border px-6 py-10 text-center">
      <ScanSearch className="h-5 w-5 text-text-tertiary" />
      <p className="text-sm text-text-secondary">Run the tool to see what it returns.</p>
    </div>
  );

  if (compact) {
    return (
      <div className="space-y-3">
        {fields}
        {actions}
        {outcome.error ? <Notice tone="danger">{outcome.error}</Notice> : null}
        {resultArea}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <SectionCard
        title="Input"
        description={version ? `Runs published version ${version}.` : "Runs the saved draft. Unsaved changes aren't included."}
      >
        <div className="grid gap-4">
          {fields}
          {actions}
        </div>
      </SectionCard>
      {outcome.error ? <Notice tone="danger">{outcome.error}</Notice> : null}
      {resultArea}
    </div>
  );
}

export default ToolRunner;
