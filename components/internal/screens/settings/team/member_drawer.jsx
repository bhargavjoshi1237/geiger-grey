"use client";

import { ShieldCheck, Trash2 } from "lucide-react";
import { matchesAny } from "@geiger/rbac";

import {
  Field,
  SettingsList,
  SettingRow,
  StatusPill,
} from "@/components/internal/shared/screen_kit";
import { Button } from "@geiger/ui/button";
import { Badge } from "@geiger/ui/badge";
import { Checkbox } from "@geiger/ui/checkbox";
import { Avatar, AvatarFallback, AvatarImage } from "@geiger/ui/avatar";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@geiger/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@geiger/ui/select";
import { PERMISSION_GROUPS, MEMBER_STATUS_MAP, initialsOf } from "../constants";

// --- Member drawer ----------------------------------------------------------
//
// Ported from events' member_drawer with the per-event ScopeSection dropped —
// Grey has no scopeBy permissions in this phase, so access is project-wide.

export default function MemberDrawer({
  member,
  role,
  roles,
  groups,
  canAssign,
  isLastOwner,
  onOpenChange,
  onChangeRole,
  onSetGroups,
  onToggleSuspend,
  onRemove,
}) {
  if (!member) return null;
  // Roles store PATTERNS — Owner's "*" grants everything, so a literal
  // includes() would report the most powerful role as granting nothing.
  const grantedGroups = PERMISSION_GROUPS.map(({ group, permissions }) => ({
    group,
    granted: permissions.filter((p) => matchesAny(role?.permissions || [], p.key)),
  })).filter((g) => g.granted.length);

  const memberGroupIds = member.groupIds || [];
  const toggleGroup = (id, on) => {
    const next = on ? [...memberGroupIds, id] : memberGroupIds.filter((g) => g !== id);
    onSetGroups(member, next);
  };

  return (
    <Sheet open={!!member} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <div className="flex items-center gap-3">
            <Avatar className="h-11 w-11">
              {member.avatarUrl ? <AvatarImage src={member.avatarUrl} alt={member.name} /> : null}
              <AvatarFallback className="bg-surface-card text-sm text-text-secondary">
                {initialsOf(member.name, member.email)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <SheetTitle className="truncate">
                {member.name || member.email.split("@")[0]}
              </SheetTitle>
              <SheetDescription className="truncate">{member.email}</SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <div className="space-y-6 px-4 pb-6">
          <div className="flex items-center gap-2">
            <StatusPill status={member.status} map={MEMBER_STATUS_MAP} />
          </div>

          <Field
            label="Role"
            hint={
              isLastOwner
                ? "The workspace's last owner — hand Owner to someone else before changing this."
                : undefined
            }
          >
            <Select
              value={role?.id || ""}
              disabled={!canAssign || isLastOwner}
              onValueChange={(v) => onChangeRole(member, v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Assign a role" />
              </SelectTrigger>
              <SelectContent>
                {roles.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          {groups.length ? (
            <div>
              <p className="mb-2 text-sm font-medium text-muted-foreground">Groups</p>
              <SettingsList>
                {groups.map((g) => (
                  <SettingRow
                    key={g.id}
                    title={g.name}
                    description={g.description || undefined}
                    control={
                      <Checkbox
                        checked={memberGroupIds.includes(g.id)}
                        disabled={!canAssign}
                        onCheckedChange={(v) => toggleGroup(g.id, !!v)}
                      />
                    }
                  />
                ))}
              </SettingsList>
            </div>
          ) : null}

          <div>
            <p className="mb-2 flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
              <ShieldCheck className="h-4 w-4" /> What {role?.name || "this role"} can do
            </p>
            {grantedGroups.length ? (
              <div className="space-y-3 rounded-lg border border-border bg-surface-card p-3">
                {grantedGroups.map(({ group, granted }) => (
                  <div key={group}>
                    <p className="text-[11px] font-medium uppercase tracking-wider text-text-tertiary">
                      {group}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {granted.map((p) => (
                        <Badge key={p.key} variant="neutral">
                          {p.label}
                        </Badge>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-text-tertiary">
                This role grants no permissions yet.
              </p>
            )}
          </div>

          {canAssign && !isLastOwner ? (
            <div className="space-y-2 border-t border-border pt-4">
              <p className="text-sm font-medium text-muted-foreground">Danger zone</p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => onToggleSuspend(member)}>
                  {member.status === "suspended" ? "Reactivate" : "Suspend"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                  onClick={() => {
                    onOpenChange(false);
                    onRemove(member);
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" /> Remove
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
