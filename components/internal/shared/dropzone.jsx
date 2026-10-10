"use client";

import React, { useRef, useState } from "react";
import { UploadCloud } from "lucide-react";

import { cn } from "@/lib/utils";

// `accept` is a comma list of extensions (".pdf"), explicit MIME types
// ("application/pdf") or MIME wildcards ("audio/*") — same grammar as the
// native <input accept>, applied ourselves to dropped (non-input) files.
function matchesAccept(file, accept) {
  if (!accept) return true;
  const patterns = accept
    .split(",")
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);
  if (!patterns.length) return true;

  const name = (file.name || "").toLowerCase();
  const type = (file.type || "").toLowerCase();

  return patterns.some((pattern) => {
    if (pattern.startsWith(".")) return name.endsWith(pattern);
    if (pattern.endsWith("/*")) return type.startsWith(pattern.slice(0, -1));
    return type === pattern;
  });
}

// Dashed drop target + hidden file input. Used by the sources upload flow.
export function Dropzone({ onFiles, accept, disabled, hint, className }) {
  const inputRef = useRef(null);
  // Nested children fire dragenter/dragleave as the pointer crosses their
  // edges; a depth counter (rather than toggling on every event) keeps the
  // dashed border from flickering while dragging over the hint text/icon.
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);

  const emit = (fileList) => {
    const files = Array.from(fileList ?? []).filter((f) => matchesAccept(f, accept));
    if (files.length) onFiles?.(files);
  };

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      onClick={() => !disabled && inputRef.current?.click()}
      onKeyDown={(e) => {
        if (!disabled && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          inputRef.current?.click();
        }
      }}
      onDragEnter={(e) => {
        e.preventDefault();
        dragDepth.current += 1;
        if (!disabled) setDragging(true);
      }}
      onDragOver={(e) => {
        // Always prevent default so the browser doesn't open the file —
        // even disabled, with an explicit "no drop" cursor.
        e.preventDefault();
        if (disabled && e.dataTransfer) e.dataTransfer.dropEffect = "none";
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        if (disabled) return;
        emit(e.dataTransfer?.files);
      }}
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-surface-subtle px-6 py-10 text-center transition-colors",
        !disabled && "cursor-pointer hover:border-border-strong hover:bg-surface-card",
        dragging && "border-primary bg-surface-active",
        disabled && "opacity-60",
        className,
      )}
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-surface-card text-muted-foreground">
        <UploadCloud className="h-5 w-5" />
      </div>
      <p className="text-sm font-medium text-foreground">
        Drag files here or click to browse
      </p>
      {hint ? <p className="text-xs text-text-secondary">{hint}</p> : null}
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={accept}
        disabled={disabled}
        onChange={(e) => {
          emit(e.target.files);
          e.target.value = "";
        }}
        className="hidden"
      />
    </div>
  );
}

export default Dropzone;
