"use client";

import React, { useId, useRef, useState } from "react";
import { UploadCloud } from "lucide-react";

import { cn } from "@/lib/utils";

// Dashed drop target + hidden file input. Used by the sources upload flow.
export function Dropzone({ onFiles, accept, disabled, hint, className }) {
  const inputId = useId();
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);

  const emit = (fileList) => {
    const files = Array.from(fileList ?? []);
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
      onDragOver={(e) => {
        if (disabled) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
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
        id={inputId}
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
