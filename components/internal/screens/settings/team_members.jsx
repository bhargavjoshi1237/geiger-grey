"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ShieldCheck, UserPlus } from "lucide-react";

import { MainScreenWrapper } from "@/components/internal/shared/screen_wrappers";
import {
  ScreenHeader,
  StatsBar,
  SectionCard,
} from "@/components/internal/shared/screen_kit";
import { Button } from "@geiger/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@geiger/ui/dialog";
import { cn } from "@/lib/utils";
import { useTeam } from "./team/use_team";
import MembersTab from "./team/members_tab";
import InvitationsTab from "./team/invitations_tab";
import GroupsTab from "./team/groups_tab";
import ActivityTab from "./team/activity_tab";
import MemberDrawer from "./team/member_drawer";
import InviteDialog from "./team/invite_dialog";
import GroupDialog from "./team/group_dialog";

import { LoadingArea } from "@geiger/ui";
const TABS = [
  { key: "members", label: "Members" },
  { key: "invitations", label: "Invitations" },
  { key: "groups", label: "Groups" },
  { key: "activity", label: "Activity" },
];

export function TeamMembersScreen() {
  // The roster, everything derived from it, and every write live in useTeam;
  // this component owns only view state and the layout.
  const {
    loading,
    canInvite,
    canAssign,
    members,
    roles,
    groups,
    activity,
    roleById,
    roleIdOf,
    groupById,
    memberCountByGroup,
    activeMembers,
    invites,
    isLastOwner,
    seatsFull,
    stats,
    changeRole,
    setMemberGroups,
    toggleSuspend,
    removeMember,
    parseInviteList,
    inviteMembers,
    revokeInvite,
    addGroup,
  } = useTeam();

  const [tab, setTab] = useState("members");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  // Deep-link from Roles & Permissions stashes a role id to pre-filter on. Read
  // it once as the initial value (client-only) and clear it so it doesn't stick.
  const [roleFilter, setRoleFilter] = useState(() => {
    if (typeof window === "undefined") return "all";
    try {
      const stashed = window.sessionStorage.getItem("team:roleFilter");
      if (stashed) {
        window.sessionStorage.removeItem("team:roleFilter");
        return stashed;
      }
    } catch {
      // ignore storage failures
    }
    return "all";
  });
  const [groupFilter, setGroupFilter] = useState("all");

  const [inviteOpen, setInviteOpen] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  const [openMemberId, setOpenMemberId] = useState(null);
  const [removeTarget, setRemoveTarget] = useState(null);

  const filteredMembers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return activeMembers.filter((m) => {
      if (statusFilter !== "all" && m.status !== statusFilter) return false;
      if (roleFilter !== "all" && roleIdOf(m) !== roleFilter) return false;
      if (groupFilter !== "all" && !(m.groupIds || []).includes(groupFilter))
        return false;
      if (q && !`${m.name} ${m.email}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [activeMembers, search, statusFilter, roleFilter, groupFilter, roleIdOf]);

  const openMember = useMemo(
    () => members.find((m) => m.id === openMemberId) || null,
    [members, openMemberId],
  );

  const confirmRemove = async () => {
    const member = removeTarget;
    setRemoveTarget(null);
    if (!member) return;
    const removed = await removeMember(member);
    if (removed && openMemberId === member.id) setOpenMemberId(null);
  };

  // Close the dialog only once the input is known good, so a bad list keeps the
  // typed emails on screen.
  const handleInvite = (emails, roleId, groupId, message) => {
    const list = parseInviteList(emails);
    if (!list) return;
    setInviteOpen(false);
    inviteMembers(list, roleId, groupId, message);
  };

  const handleCreateGroup = (name, description) => {
    if (!name.trim()) {
      toast.error("Name the group.");
      return;
    }
    setGroupOpen(false);
    addGroup(name, description);
  };

  const openInvite = () =>
    seatsFull ? toast.error("All seats are in use.") : setInviteOpen(true);

  const inviteAction = canInvite ? (
    <Button
      onClick={openInvite}
      className="bg-primary text-primary-foreground"
      disabled={seatsFull}
    >
      <UserPlus className="h-4 w-4" /> Invite people
    </Button>
  ) : null;

  const roleFilterOptions = [
    { value: "all", label: "All Roles" },
    ...roles.map((r) => ({ value: r.id, label: r.name })),
  ];
  const groupFilterOptions = [
    { value: "all", label: "All Groups" },
    ...groups.map((g) => ({ value: g.id, label: g.name })),
  ];

  return (
    <MainScreenWrapper>
      <ScreenHeader
        title="Team & Members"
        description="Manage who has access to this project and what they can do."
        actions={inviteAction}
      />

      <StatsBar stats={stats} />

      {!canAssign ? (
        <div className="flex items-start gap-2.5 rounded-lg border border-border bg-surface-card px-3.5 py-2.5 text-xs leading-relaxed text-text-secondary">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-tertiary" />
          <p>
            You can see who is on the team, but changing roles or access needs the
            <span className="text-foreground"> Assign roles </span>
            permission.
          </p>
        </div>
      ) : null}

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-border">
        {TABS.map((t) => {
          const count =
            t.key === "invitations"
              ? invites.length
              : t.key === "groups"
                ? groups.length
                : null;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={cn(
                "relative px-3 py-2 text-sm font-medium transition-colors",
                tab === t.key
                  ? "text-foreground"
                  : "text-text-secondary hover:text-foreground",
              )}
            >
              {t.label}
              {count ? (
                <span className="ml-1.5 text-xs text-text-tertiary">{count}</span>
              ) : null}
              {tab === t.key ? (
                <span className="absolute inset-x-0 -bottom-px h-0.5 bg-primary" />
              ) : null}
            </button>
          );
        })}
      </div>

      {loading ? (
        <SectionCard>
          <LoadingArea label="Loading team" />
        </SectionCard>
      ) : tab === "members" ? (
        <MembersTab
          members={filteredMembers}
          total={activeMembers.length}
          roleById={roleById}
          roleIdOf={roleIdOf}
          canAssign={canAssign}
          groupById={groupById}
          roles={roles}
          search={search}
          setSearch={setSearch}
          statusFilter={statusFilter}
          setStatusFilter={setStatusFilter}
          roleFilter={roleFilter}
          setRoleFilter={setRoleFilter}
          groupFilter={groupFilter}
          setGroupFilter={setGroupFilter}
          roleFilterOptions={roleFilterOptions}
          groupFilterOptions={groupFilterOptions}
          onOpen={(m) => setOpenMemberId(m.id)}
          onChangeRole={changeRole}
          onToggleSuspend={toggleSuspend}
          onRemove={setRemoveTarget}
          onInvite={() => setInviteOpen(true)}
        />
      ) : tab === "invitations" ? (
        <InvitationsTab
          invites={invites}
          roleById={roleById}
          canInvite={canInvite}
          onRevoke={revokeInvite}
          onInvite={openInvite}
        />
      ) : tab === "groups" ? (
        <GroupsTab
          groups={groups}
          counts={memberCountByGroup}
          onCreate={() => setGroupOpen(true)}
        />
      ) : (
        <ActivityTab activity={activity} />
      )}

      <InviteDialog
        key={inviteOpen ? "invite-open" : "invite-closed"}
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        roles={roles}
        groups={groups}
        onSubmit={handleInvite}
      />

      <GroupDialog
        key={groupOpen ? "group-open" : "group-closed"}
        open={groupOpen}
        onOpenChange={setGroupOpen}
        onSubmit={handleCreateGroup}
      />

      <MemberDrawer
        member={openMember}
        role={openMember ? roleById[roleIdOf(openMember)] : null}
        roles={roles}
        groups={groups}
        canAssign={canAssign}
        isLastOwner={openMember ? isLastOwner(openMember) : false}
        onOpenChange={(o) => !o && setOpenMemberId(null)}
        onChangeRole={changeRole}
        onSetGroups={setMemberGroups}
        onToggleSuspend={toggleSuspend}
        onRemove={setRemoveTarget}
      />

      <Dialog open={!!removeTarget} onOpenChange={(o) => !o && setRemoveTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove member</DialogTitle>
            <DialogDescription>
              {removeTarget
                ? `Remove ${removeTarget.name || removeTarget.email} from this project? They lose access immediately.`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRemoveTarget(null)}>
              Cancel
            </Button>
            <Button
              className="bg-red-500/90 text-white hover:bg-red-500"
              onClick={confirmRemove}
            >
              Remove member
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainScreenWrapper>
  );
}

export default TeamMembersScreen;
