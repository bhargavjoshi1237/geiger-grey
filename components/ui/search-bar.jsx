"use client";

import React from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export function SearchBar({
  placeholder = "Search...",
  value,
  onChange,
  className,
  onClear,
}) {
  const handleClear = () => {
    if (onClear) {
      onClear();
    } else if (onChange) {
      onChange({ target: { value: "" } });
    }
  };
  
  return (
    <div className={cn("relative w-full", className)}>
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-secondary pointer-events-none" />
      <Input
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        className="!pl-9 !pr-4 !py-1.5 bg-surface-subtle border-border text-foreground text-sm placeholder:text-text-secondary focus-visible:ring-0 focus-visible:border-border-strong"
      />
      {value && value.length > 0 && (
        <button
          onClick={handleClear}
          className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-secondary hover:text-foreground transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

export default SearchBar;
