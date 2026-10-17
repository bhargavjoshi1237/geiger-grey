"use client";

import React, { useState } from "react";

import { Input } from "@geiger/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@geiger/ui/select";

const OTHER = "__other__";
const NONE = "__none__";

// Pick a suggested model id or type any other one. `noneLabel` adds an empty
// choice (value null), e.g. "Provider default". With no suggestions it is a plain
// input. Key it by connection so switching connections resets the "other" mode.
export function ModelIdSelect({
  value,
  onChange,
  suggestions = [],
  disabled,
  noneLabel,
  placeholder = "Select a model",
  inputId,
}) {
  const [otherPicked, setOtherPicked] = useState(false);
  const known = suggestions.some((m) => m.id === value);
  const custom = otherPicked || (!!value && !known);

  if (!suggestions.length) {
    return (
      <Input
        id={inputId}
        value={value || ""}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        placeholder={noneLabel ? `${noneLabel} — or type a model id` : "Type a model id"}
      />
    );
  }

  const selectValue = custom ? OTHER : value || (noneLabel ? NONE : "");

  return (
    <div className="grid gap-2">
      <Select
        value={selectValue}
        disabled={disabled}
        onValueChange={(next) => {
          if (next === OTHER) {
            setOtherPicked(true);
            onChange("");
            return;
          }
          setOtherPicked(false);
          onChange(next === NONE ? null : next);
        }}
      >
        <SelectTrigger>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {noneLabel ? <SelectItem value={NONE}>{noneLabel}</SelectItem> : null}
          {suggestions.map((m) => (
            <SelectItem key={m.id} value={m.id}>
              {m.label || m.id}
            </SelectItem>
          ))}
          <SelectItem value={OTHER}>Other model id…</SelectItem>
        </SelectContent>
      </Select>
      {custom ? (
        <Input
          id={inputId}
          value={value || ""}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Model id"
        />
      ) : null}
    </div>
  );
}

export default ModelIdSelect;
