"use client";

import React, { useState } from "react";
import { X } from "lucide-react";

import { Badge } from "@geiger/ui/badge";
import { Input } from "@geiger/ui/input";
import { cn } from "@/lib/utils";

// Input that turns Enter/comma into removable Badge chips. Used for allowed
// domains, scopes and other free-form tag lists.
export function TagInput({ value = [], onChange, placeholder, validate, className }) {
  const [draft, setDraft] = useState("");

  const addTag = (raw) => {
    const tag = raw.trim();
    if (!tag) return;
    if (value.includes(tag)) {
      setDraft("");
      return;
    }
    if (validate && !validate(tag)) return;
    onChange?.([...value, tag]);
    setDraft("");
  };

  const removeTag = (tag) => {
    onChange?.(value.filter((t) => t !== tag));
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag(draft);
    } else if (e.key === "Backspace" && !draft && value.length) {
      removeTag(value[value.length - 1]);
    }
  };

  return (
    <div
      className={cn(
        "flex min-h-9 flex-wrap items-center gap-1.5 rounded-lg border border-border bg-surface-card px-2 py-1.5 focus-within:ring-2 focus-within:ring-ring/40",
        className,
      )}
    >
      {value.map((tag) => (
        <Badge key={tag} variant="neutral" className="gap-1 pr-1">
          {tag}
          <button
            type="button"
            aria-label={`Remove ${tag}`}
            onClick={() => removeTag(tag)}
            className="rounded-full p-0.5 text-muted-foreground hover:bg-surface-active hover:text-foreground"
          >
            <X className="h-3 w-3" />
          </button>
        </Badge>
      ))}
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => addTag(draft)}
        placeholder={value.length ? "" : placeholder}
        className="h-7 min-w-[8rem] flex-1 border-none bg-transparent px-1 shadow-none focus-visible:ring-0"
      />
    </div>
  );
}

export default TagInput;
