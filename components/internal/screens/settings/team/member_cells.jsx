"use client";

import { ChevronDown } from "lucide-react";

import { Badge } from "@geiger/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@geiger/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@geiger/ui/dropdown-menu";
import { initialsOf } from "../constants";

// The small cells the members table is built from.

// --- Role pill (inline picker) ----------------------------------------------

export function RolePill({ role, roles, onChange, disabled }) {
  return (
    <div onClick={(e) => e.stopPropagation()}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={disabled}>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-card px-2 py-1 text-xs font-medium text-foreground hover:bg-surface-hover disabled:opacity-60"
          >
            {role?.name || "No role"}
            {!disabled ? <ChevronDown className="h-3 w-3 text-text-tertiary" /> : null}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="border-border bg-surface-subtle">
          <DropdownMenuLabel className="text-xs text-text-tertiary">
            Assign role
          </DropdownMenuLabel>
          {roles.map((r) => (
            <DropdownMenuItem
              key={r.id}
              onClick={() => onChange(r.id)}
              className="cursor-pointer gap-2 focus:bg-surface-hover"
            >
              {r.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function GroupChips({ ids, groupById }) {
  if (!ids?.length) return <span className="text-xs text-text-tertiary">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {ids.map((id) => {
        const g = groupById[id];
        if (!g) return null;
        return (
          <Badge key={id} variant="neutral">
            {g.name}
          </Badge>
        );
      })}
    </div>
  );
}

export function MemberCell({ member }) {
  return (
    <div className="flex items-center gap-3">
      <Avatar className="h-8 w-8">
        {member.avatarUrl ? <AvatarImage src={member.avatarUrl} alt={member.name} /> : null}
        <AvatarFallback className="bg-surface-card text-xs text-text-secondary">
          {initialsOf(member.name, member.email)}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-foreground">
          {member.name || member.email.split("@")[0]}
        </p>
        <p className="truncate text-xs text-text-tertiary">{member.email}</p>
      </div>
    </div>
  );
}
