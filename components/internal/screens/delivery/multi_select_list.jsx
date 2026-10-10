"use client";

import React from "react";
import { Inbox } from "lucide-react";

import { Checkbox } from "@geiger/ui/checkbox";
import { cn } from "@/lib/utils";

// Inline scrolling checklist for picking several rows from a short reference
// list (knowledge bases, pipelines) — mirrors the events discount-code picker
// so every "pick a few of these" control in the suite reads the same way.
export function MultiSelectList({
  items,
  value,
  onChange,
  getId = (item) => item.id,
  getLabel = (item) => item.name,
  getDescription,
  emptyTitle = "Nothing to pick from yet",
  emptyHint,
  summaryLabel = "item",
  className,
}) {
  const list = Array.isArray(items) ? items : [];
  const selected = (Array.isArray(value) ? value : []).map(String);

  const toggle = (id, on) => {
    const next = on ? [...selected, id] : selected.filter((x) => x !== id);
    onChange(next);
  };

  if (!list.length) {
    return (
      <div
        className={cn(
          "flex flex-col items-center gap-1.5 rounded-lg border border-dashed border-border bg-surface-subtle px-4 py-6 text-center",
          className,
        )}
      >
        <Inbox className="h-5 w-5 text-text-tertiary" />
        <p className="text-sm text-text-secondary">{emptyTitle}</p>
        {emptyHint ? <p className="text-xs text-text-tertiary">{emptyHint}</p> : null}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface-card",
        className,
      )}
    >
      <div className="max-h-52 divide-y divide-border overflow-y-auto">
        {list.map((item) => {
          const id = String(getId(item));
          const on = selected.includes(id);
          return (
            <label
              key={id}
              className={cn(
                "flex cursor-pointer items-start gap-3 px-3 py-2.5 transition-colors",
                on ? "bg-surface-hover" : "hover:bg-surface-active",
              )}
            >
              <Checkbox
                checked={on}
                onCheckedChange={(v) => toggle(id, !!v)}
                className="mt-0.5"
                aria-label={`Select ${getLabel(item)}`}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-foreground">
                  {getLabel(item)}
                </span>
                {getDescription ? (
                  <span className="mt-0.5 block truncate text-xs text-text-secondary">
                    {getDescription(item)}
                  </span>
                ) : null}
              </span>
            </label>
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-2 bg-surface-subtle px-3 py-2">
        <span className="text-xs text-text-secondary">
          {selected.length
            ? `${selected.length} ${summaryLabel}${selected.length > 1 ? "s" : ""} selected`
            : `No ${summaryLabel}s selected`}
        </span>
        {selected.length ? (
          <button
            type="button"
            onClick={() => onChange([])}
            className="shrink-0 text-xs font-medium text-text-secondary underline-offset-2 hover:text-foreground hover:underline"
          >
            Clear
          </button>
        ) : null}
      </div>
    </div>
  );
}

export default MultiSelectList;
