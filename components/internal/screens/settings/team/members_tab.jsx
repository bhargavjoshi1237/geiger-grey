"use client";

import {
  Ban,
  CircleCheck,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";

import {
  DataTable,
  EmptyState,
  SearchInput,
  StatusPill,
  Toolbar,
} from "@/components/internal/shared/screen_kit";
import { Button } from "@geiger/ui/button";
import { ActionMenu } from "@geiger/ui/action-menu";
import FilterDropdown from "@/components/internal/shared/filter_dropdown";
import {
  MEMBER_STATUS_MAP,
  MEMBER_STATUS_FILTER_OPTIONS,
  formatDate,
  formatRelativeTime,
} from "../constants";
import { GroupChips, MemberCell, RolePill } from "./member_cells";

export default function MembersTab({
  members,
  total,
  roleById,
  roleIdOf,
  canAssign,
  groupById,
  roles,
  search,
  setSearch,
  statusFilter,
  setStatusFilter,
  roleFilter,
  setRoleFilter,
  groupFilter,
  setGroupFilter,
  roleFilterOptions,
  groupFilterOptions,
  onOpen,
  onChangeRole,
  onToggleSuspend,
  onRemove,
  onInvite,
}) {
  const columns = [
    {
      key: "member",
      header: "Member",
      render: (m) => <MemberCell member={m} />,
    },
    {
      key: "role",
      header: "Role",
      render: (m) => (
        <RolePill
          role={roleById[roleIdOf(m)]}
          roles={roles}
          disabled={!canAssign}
          onChange={(roleId) => onChangeRole(m, roleId)}
        />
      ),
    },
    {
      key: "groups",
      header: "Groups",
      render: (m) => <GroupChips ids={m.groupIds} groupById={groupById} />,
    },
    {
      key: "status",
      header: "Status",
      render: (m) => <StatusPill status={m.status} map={MEMBER_STATUS_MAP} />,
    },
    {
      key: "lastActive",
      header: "Last active",
      render: (m) => (
        <span className="text-xs text-text-secondary">
          {formatRelativeTime(m.lastActiveAt)}
        </span>
      ),
    },
    {
      key: "joined",
      header: "Joined",
      render: (m) => (
        <span className="text-xs text-text-secondary">{formatDate(m.joinedAt)}</span>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (m) => (
        <div className="flex justify-end">
          <ActionMenu
            label="Member actions"
            items={[
              { icon: Users, label: "Manage", onSelect: () => onOpen(m) },
              canAssign && {
                icon: m.status === "suspended" ? CircleCheck : Ban,
                label: m.status === "suspended" ? "Reactivate" : "Suspend",
                onSelect: () => onToggleSuspend(m),
              },
              { separator: true },
              canAssign && {
                icon: Trash2,
                label: "Remove",
                variant: "destructive",
                onSelect: () => onRemove(m),
              },
            ]}
          />
        </div>
      ),
    },
  ];

  const filtersActive =
    statusFilter !== "all" || roleFilter !== "all" || groupFilter !== "all" || !!search;

  return (
    <div className="space-y-4">
      <Toolbar>
        <div className="flex flex-wrap items-center gap-2">
          <FilterDropdown
            value={roleFilter}
            onValueChange={setRoleFilter}
            options={roleFilterOptions}
            placeholder="All Roles"
            height="h-9"
          />
          <FilterDropdown
            value={statusFilter}
            onValueChange={setStatusFilter}
            options={MEMBER_STATUS_FILTER_OPTIONS}
            placeholder="All Statuses"
            height="h-9"
          />
          <FilterDropdown
            value={groupFilter}
            onValueChange={setGroupFilter}
            options={groupFilterOptions}
            placeholder="All Groups"
            height="h-9"
          />
        </div>
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search name or email…"
        />
      </Toolbar>

      <DataTable
        columns={columns}
        data={members}
        getRowKey={(m) => m.id}
        onRowClick={onOpen}
        empty={
          total === 0 ? (
            <EmptyState
              icon={Users}
              title="No members yet"
              description="Invite teammates to collaborate on this project."
              action={
                <Button onClick={onInvite} className="bg-primary text-primary-foreground">
                  <UserPlus className="h-4 w-4" /> Invite people
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={Users}
              title="No matching members"
              description={filtersActive ? "Try clearing your filters." : "Nothing here."}
            />
          )
        }
      />
    </div>
  );
}
