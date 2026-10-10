"use client";

import React, { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@geiger/ui/button";
import { cn } from "@/lib/utils";

// Read-only mono value or snippet with a copy button. Used for API keys,
// endpoint URLs, embed snippets and other copy-to-clipboard values.
export function CopyBlock({ value, label, multiline = false, className }) {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef(null);

  useEffect(
    () => () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    },
    [],
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value ?? "");
      setCopied(true);
      toast.success("Copied");
      if (resetTimer.current) clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => {
        resetTimer.current = null;
        setCopied(false);
      }, 1500);
    } catch (error) {
      console.error("[copy_block.copy]", error);
      toast.error("Couldn't copy");
    }
  };

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label ? (
        <span className="text-sm font-medium text-muted-foreground">{label}</span>
      ) : null}
      <div className="flex items-start gap-2 rounded-lg border border-border bg-surface-subtle px-3 py-2">
        <code
          className={cn(
            "min-w-0 flex-1 overflow-x-auto font-mono text-xs text-foreground",
            multiline ? "whitespace-pre-wrap break-all" : "whitespace-nowrap",
          )}
        >
          {value}
        </code>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Copy"
          onClick={copy}
          className="shrink-0 text-muted-foreground hover:bg-surface-active hover:text-foreground"
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-emerald-400" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </Button>
      </div>
    </div>
  );
}

export default CopyBlock;
