"use client";

import { Clock, UserPlus } from "lucide-react";

import {
  EmptyState,
  SectionCard,
  SettingsList,
} from "@/components/internal/shared/screen_kit";
import { Button } from "@geiger/ui/button";
import { Badge } from "@geiger/ui/badge";
import { Avatar, AvatarFallback } from "@geiger/ui/avatar";
import { formatRelativeTime, initialsOf } from "../constants";

export default function InvitationsTab({ invites, roleById, onRevoke, onInvite }) {
  if (!invites.length) {
    return (
      <SectionCard>
        <EmptyState
          icon={Clock}
          title="No pending invitations"
          description="Invited people who haven't joined yet appear here."
          action={
            <Button onClick={onInvite} className="bg-primary text-primary-foreground">
              <UserPlus className="h-4 w-4" /> Invite people
            </Button>
          }
        />
      </SectionCard>
    );
  }
  return (
    <SectionCard bodyPadding={false} contentClassName="p-2">
      <SettingsList className="px-3">
        {invites.map((m) => {
          const role = roleById[m.roleId];
          return (
            <div key={m.id} className="flex items-center justify-between gap-4 py-3.5">
              <div className="flex min-w-0 items-center gap-3">
                <Avatar className="h-8 w-8">
                  <AvatarFallback className="bg-surface-card text-xs text-text-secondary">
                    {initialsOf("", m.email)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{m.email}</p>
                  <p className="text-xs text-text-tertiary">
                    Invited {formatRelativeTime(m.invitedAt)}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Badge variant="neutral">{role?.name || "No role"}</Badge>
                <Button variant="outline" size="sm" onClick={() => onRevoke(m)}>
                  Revoke
                </Button>
              </div>
            </div>
          );
        })}
      </SettingsList>
    </SectionCard>
  );
}
