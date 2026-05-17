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
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#737373] pointer-events-none" />
      <Input
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        className="!pl-9 !pr-4 !py-1.5 bg-[#1a1a1a] border-[#2a2a2a] text-white text-sm placeholder:text-[#737373] focus-visible:ring-0 focus-visible:border-[#474747]"
      />
      {value && value.length > 0 && (
        <button
          onClick={handleClear}
          className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#737373] hover:text-white transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

export default SearchBar;
