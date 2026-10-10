"use client";

import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, ShieldCheck, Copy, Trash2, Pencil, Users, Lock, Check, Search, Info, SlidersHorizontal, Loader2 } from "lucide-react";
import { expandPatterns, matchesAny } from "@geiger/rbac";

import { MainScreenWrapper } from "@/components/internal/shared/screen_wrappers";
import {
  ScreenHeader,
  StatsBar,
  DataTable,
  EmptyState,
  SearchInput,
  Toolbar,
  Field,
} from "@/components/internal/shared/screen_kit";
import { Button } from "@geiger/ui/button";
import { Badge } from "@geiger/ui/badge";
import { Input } from "@geiger/ui/input";
import { Textarea } from "@geiger/ui/textarea";
import { Switch } from "@geiger/ui/switch";
import { ActionMenu } from "@geiger/ui/action-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@geiger/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@geiger/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@geiger/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@geiger/ui/sheet";
import FilterDropdown from "@/components/internal/shared/filter_dropdown";
import { cn } from "@/lib/utils";
import { ALL_PERMISSION_KEYS } from "@/lib/rbac";
import { useProject } from "@/context/project-context";
import { useRbac } from "@/context/rbac-context";
import { useWorkspaceUrl } from "@/lib/hooks/use-workspace-url";
import { getUser } from "@/lib/supabase/user";
import {
  createRole,
  updateRole,
  softDeleteRole,
  ensureSystemRoles,
  listGrants,
} from "@/lib/supabase/rbac";
import { logActivity } from "@/lib/supabase/team";
import { PERMISSION_GROUPS } from "./constants";

const EMPTY_DRAFT = {
  name: "",
  description: "",
  cloneFrom: "none",
};

const TABS = [
  { key: "roles", label: "Roles" },
  { key: "matrix", label: "Permission matrix" },
];

const TYPE_FILTER_OPTIONS = [
  { value: "all", label: "All Types" },
  { value: "system", label: "System" },
  { value: "custom", label: "Custom" },
];

const GROUP_FILTER_OPTIONS = [
  { value: "all", label: "All Groups" },
  ...PERMISSION_GROUPS.map(({ group }) => ({ value: group, label: group })),
];

// Owner is the one role the screen refuses to touch: its "*" is what keeps a
// project administrable, and it is the only permission list that keeps granting
// new keys as the catalog grows. Every other seeded role is a starting point the
// project owner is free to rewrite.
function isOwnerRole(role) {
  return role?.key === "owner" || (role?.permissions || []).includes("*");
}

// Does this role actually grant `key`? Roles store PATTERNS, so a literal
// includes() reports Owner as holding nothing at all.
function grantsKey(role, key) {
  return matchesAny(role?.permissions || [], key);
}

function grantedCount(role) {
  return ALL_PERMISSION_KEYS.filter((k) => grantsKey(role, k)).length;
}

// Filter the catalog down to what the toolbar/search asks for, dropping groups
// that end up empty so neither the matrix nor the drawer renders a bare header.
function filterGroups(query, group = "all") {
  const q = query.trim().toLowerCase();
  return PERMISSION_GROUPS.filter((g) => group === "all" || g.group === group)
    .map(({ group: name, permissions }) => ({
      group: name,
      permissions: q
        ? permissions.filter(
            (p) =>
              p.label.toLowerCase().includes(q) ||
              p.key.toLowerCase().includes(q),
          )
        : permissions,
    }))
    .filter((g) => g.permissions.length);
}

export function RolesPermissionsScreen() {
  const { projectId } = useProject();
  const { params, openRecord, closeRecord, setTab: setWorkspaceTab } =
    useWorkspaceUrl();
  // This screen's open-role id lives under its own "role" name — Grey's
  // workspace URL keys records by name (kb, pipeline, entity, conversation,
  // role, …) rather than one generic ?record=.
  const recordId = params?.role || null;
  const { can, refresh: refreshRbac } = useRbac();

  const canManage = can("grey.role.manage");

  const [roles, setRoles] = useState([]);
  const [grants, setGrants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState(null);
  const [userName, setUserName] = useState("");

  const [tab, setTab] = useState("roles");
  // The roles list filters on its own terms; the permission catalog has its own
  // query, shared by the matrix and the drawer so a search survives the hop.
  const [roleSearch, setRoleSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [permQuery, setPermQuery] = useState("");
  const [groupFilter, setGroupFilter] = useState("all");

  // One dialog serves create + edit; `editing` holds the role being edited.
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [deleteTarget, setDeleteTarget] = useState(null);

  useEffect(() => {
    let alive = true;
    getUser().then((u) => {
      if (!alive) return;
      setUserId(u?.id || null);
      setUserName(u?.name || "");
    });
    (async () => {
      // Fill in whichever system roles this project is missing. The adopt_rbac
      // migration seeds only Owner (its "*" is stable); the rest are defined in
      // geiger-rbac.config.js, so seeding them here keeps the catalog their
      // single source of truth. Idempotent per key, so this is a no-op once the
      // project has them all.
      const rows = await ensureSystemRoles(projectId, null);
      if (!alive) return;
      setRoles(rows ?? []);
      setLoading(false);
    })();
    listGrants(projectId).then((rows) => alive && setGrants(rows ?? []));
    return () => {
      alive = false;
    };
  }, [projectId]);

  // Counted off grants, not the roster overlay — a grant is what authorizes, so
  // it is the only honest answer to "how many people hold this role".
  const memberCountByRole = useMemo(() => {
    const map = {};
    for (const g of grants) {
      if (g.roleId && g.status === "active") {
        map[g.roleId] = (map[g.roleId] || 0) + 1;
      }
    }
    return map;
  }, [grants]);

  // The open role lives in the URL (?role=<id>) so a refresh stays on it.
  const openedRole = useMemo(
    () => (recordId ? roles.find((r) => r.id === recordId) || null : null),
    [roles, recordId],
  );

  const filteredRoles = useMemo(() => {
    const q = roleSearch.trim().toLowerCase();
    return roles.filter((r) => {
      if (typeFilter === "system" && !r.isSystem) return false;
      if (typeFilter === "custom" && r.isSystem) return false;
      if (q && !`${r.name} ${r.description || ""}`.toLowerCase().includes(q))
        return false;
      return true;
    });
  }, [roles, roleSearch, typeFilter]);

  const stats = useMemo(() => {
    const system = roles.filter((r) => r.isSystem).length;
    const assigned = Object.values(memberCountByRole).reduce((a, b) => a + b, 0);
    const unheld = roles.filter((r) => !memberCountByRole[r.id]).length;
    return [
      {
        label: "Roles",
        value: String(roles.length),
        footer: `${system} system · ${roles.length - system} custom`,
      },
      {
        label: "People assigned",
        value: String(assigned),
        footer: "Across active grants",
      },
      {
        label: "Permissions",
        value: String(ALL_PERMISSION_KEYS.length),
        footer: `${PERMISSION_GROUPS.length} groups in the catalog`,
      },
      {
        label: "Unheld roles",
        value: String(unheld),
        footer: "Nobody holds them yet",
      },
    ];
  }, [roles, memberCountByRole]);

  // --- Permission toggles (optimistic + persist) ---------------------------

  const persistPermissions = async (role, permissions) => {
    setRoles((prev) =>
      prev.map((r) => (r.id === role.id ? { ...r, permissions } : r)),
    );
    const saved = await updateRole(role.id, { permissions });
    if (saved) {
      // The editor may be editing their own role; re-resolve so the nav and the
      // gates on this very screen reflect the change without a reload.
      refreshRbac();
    } else {
      setRoles((prev) =>
        prev.map((r) =>
          r.id === role.id ? { ...r, permissions: role.permissions } : r,
        ),
      );
      toast.error("Couldn't update permissions.");
    }
  };

  // Turning one key off inside a wildcard can't be expressed by removing a key,
  // so a role holding any pattern is first expanded to the concrete set it
  // currently reaches. What the user saw ticked is exactly what stays ticked.
  const concreteKeys = (role) =>
    (role.permissions || []).some((p) => p.includes("*"))
      ? expandPatterns(role.permissions, ALL_PERMISSION_KEYS)
      : [...(role.permissions || [])];

  const togglePermission = (role, key) => {
    if (!canManage || isOwnerRole(role)) return;
    const base = concreteKeys(role);
    const next = grantsKey(role, key)
      ? base.filter((k) => k !== key)
      : [...new Set([...base, key])];
    persistPermissions(role, next);
  };

  const toggleGroup = (role, keys, enable) => {
    if (!canManage || isOwnerRole(role)) return;
    const set = new Set(concreteKeys(role));
    keys.forEach((k) => (enable ? set.add(k) : set.delete(k)));
    persistPermissions(role, Array.from(set));
  };

  // --- Role CRUD -----------------------------------------------------------

  const openCreate = () => {
    setEditing(null);
    setDraft(EMPTY_DRAFT);
    setDialogOpen(true);
  };

  const openEdit = (role) => {
    setEditing(role);
    setDraft({
      name: role.name,
      description: role.description,
      cloneFrom: "none",
    });
    setDialogOpen(true);
  };

  const submitDialog = async () => {
    const name = draft.name.trim();
    if (!name) {
      toast.error("Give the role a name.");
      return;
    }

    if (editing) {
      const patch = { name, description: draft.description };
      setRoles((prev) =>
        prev.map((r) => (r.id === editing.id ? { ...r, ...patch } : r)),
      );
      setDialogOpen(false);
      const saved = await updateRole(editing.id, patch);
      if (saved) {
        logActivity({
          projectId,
          actorUserId: userId,
          actorName: userName,
          action: "role_updated",
          targetName: name,
        });
      } else {
        toast.error("Couldn't save the role.");
      }
      return;
    }

    const source = roles.find((r) => r.id === draft.cloneFrom);
    const id = crypto.randomUUID();
    const optimistic = {
      id,
      projectId,
      name,
      description: draft.description,
      // Cloning Owner would copy "*" into a custom role, quietly minting a
      // second unrestricted role. Expand it to the concrete catalog instead.
      permissions: source ? expandPatterns(source.permissions, ALL_PERMISSION_KEYS) : [],
      isSystem: false,
      sort: roles.length,
      createdBy: userId,
    };
    setRoles((prev) => [...prev, optimistic]);
    setDialogOpen(false);
    openRecord("role", id);
    const saved = await createRole(optimistic);
    if (saved) {
      setRoles((prev) => prev.map((r) => (r.id === id ? saved : r)));
      logActivity({
        projectId,
        actorUserId: userId,
        actorName: userName,
        action: "role_created",
        targetName: name,
      });
      toast.success("Role created");
    } else {
      setRoles((prev) => prev.filter((r) => r.id !== id));
      toast.error("Couldn't create the role.");
    }
  };

  const duplicateRole = async (role) => {
    const id = crypto.randomUUID();
    const optimistic = {
      id,
      projectId,
      name: `${role.name} copy`,
      description: role.description,
      permissions: expandPatterns(role.permissions, ALL_PERMISSION_KEYS),
      isSystem: false,
      sort: roles.length,
      createdBy: userId,
    };
    setRoles((prev) => [...prev, optimistic]);
    openRecord("role", id);
    const saved = await createRole(optimistic);
    if (saved) {
      setRoles((prev) => prev.map((r) => (r.id === id ? saved : r)));
      toast.success("Role duplicated");
    } else {
      setRoles((prev) => prev.filter((r) => r.id !== id));
      toast.error("Couldn't duplicate the role.");
    }
  };

  const confirmDelete = async () => {
    const role = deleteTarget;
    setDeleteTarget(null);
    if (!role) return;
    setRoles((prev) => prev.filter((r) => r.id !== role.id));
    if (recordId === role.id) closeRecord("role");
    const ok = await softDeleteRole(role.id);
    if (ok) {
      logActivity({
        projectId,
        actorUserId: userId,
        actorName: userName,
        action: "role_deleted",
        targetName: role.name,
      });
      toast.success("Role deleted");
    } else {
      setRoles((prev) => [...prev, role]);
      toast.error("Couldn't delete the role.");
    }
  };

  const goToTeam = (role) => {
    try {
      window.sessionStorage.setItem("team:roleFilter", role.id);
    } catch {
      // ignore storage failures
    }
    setWorkspaceTab("Team & Members");
  };

  const createAction = canManage ? (
    <Button onClick={openCreate} className="bg-primary text-primary-foreground">
      <Plus className="h-4 w-4" /> Create role
    </Button>
  ) : null;

  return (
    <MainScreenWrapper>
      <ScreenHeader
        title="Roles & Permissions"
        description="Define roles and control what each can access across the project."
        actions={createAction}
      />

      <StatsBar stats={stats} />

      {!canManage ? (
        <Notice icon={Lock}>
          You can see how access is set up here, but only someone with
          <span className="text-foreground"> Create and edit roles </span>
          can change it.
        </Notice>
      ) : null}

      <div className="flex items-center gap-1 border-b border-border">
        {TABS.map((t) => (
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
            <span className="ml-1.5 text-xs text-text-tertiary">
              {t.key === "roles" ? roles.length : ALL_PERMISSION_KEYS.length}
            </span>
            {tab === t.key ? (
              <span className="absolute inset-x-0 -bottom-px h-0.5 bg-primary" />
            ) : null}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-border bg-surface-subtle px-6 py-16 text-sm text-text-secondary">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading roles…
        </div>
      ) : tab === "roles" ? (
        <RolesTab
          roles={filteredRoles}
          total={roles.length}
          counts={memberCountByRole}
          canManage={canManage}
          search={roleSearch}
          setSearch={setRoleSearch}
          typeFilter={typeFilter}
          setTypeFilter={setTypeFilter}
          onOpen={(r) => openRecord("role", r.id)}
          onEdit={openEdit}
          onDuplicate={duplicateRole}
          onDelete={setDeleteTarget}
          onViewMembers={goToTeam}
          onCreate={openCreate}
        />
      ) : (
        <MatrixTab
          roles={roles}
          canManage={canManage}
          query={permQuery}
          setQuery={setPermQuery}
          groupFilter={groupFilter}
          setGroupFilter={setGroupFilter}
          onToggle={togglePermission}
          onOpenRole={(r) => openRecord("role", r.id)}
          onCreate={openCreate}
        />
      )}

      <RoleDrawer
        role={openedRole}
        canManage={canManage}
        memberCount={openedRole ? memberCountByRole[openedRole.id] || 0 : 0}
        query={permQuery}
        setQuery={setPermQuery}
        onOpenChange={(o) => !o && closeRecord("role")}
        onToggle={togglePermission}
        onToggleGroup={toggleGroup}
        onEdit={openEdit}
        onDuplicate={duplicateRole}
        onDelete={setDeleteTarget}
        onViewMembers={goToTeam}
      />

      <RoleDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
        draft={draft}
        setDraft={setDraft}
        roles={roles}
        onSubmit={submitDialog}
      />

      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete role</DialogTitle>
            <DialogDescription>
              {deleteTarget
                ? `Remove “${deleteTarget.name}”? Anyone holding it loses the access it granted.`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              className="bg-red-500/90 text-white hover:bg-red-500"
              onClick={confirmDelete}
            >
              Delete role
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainScreenWrapper>
  );
}

// --- Shared notice strip -----------------------------------------------------

function Notice({ icon: Icon = Info, children }) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-border bg-surface-card px-3.5 py-2.5 text-xs leading-relaxed text-text-secondary">
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-tertiary" />
      <p>{children}</p>
    </div>
  );
}

// --- Coverage bar ------------------------------------------------------------

// How much of the catalog a role reaches, read the same way as the sell-through
// bar on All Events.
function CoverageBar({ role, className }) {
  const owner = isOwnerRole(role);
  const total = ALL_PERMISSION_KEYS.length;
  const granted = owner ? total : grantedCount(role);
  const pct = total ? Math.round((granted / total) * 100) : 0;

  return (
    <div className={cn("w-[150px] space-y-1.5", className)}>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-hover">
        <div
          className="h-full rounded-full bg-primary"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-xs text-text-secondary">
        {owner ? "Every permission" : `${granted} of ${total} · ${pct}%`}
      </p>
    </div>
  );
}

// --- Roles tab ---------------------------------------------------------------

function RolesTab({
  roles,
  total,
  counts,
  canManage,
  search,
  setSearch,
  typeFilter,
  setTypeFilter,
  onOpen,
  onEdit,
  onDuplicate,
  onDelete,
  onViewMembers,
  onCreate,
}) {
  const columns = [
    {
      key: "name",
      header: "Role",
      render: (r) => (
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="font-medium text-foreground">{r.name}</span>
          <span className="line-clamp-1 text-xs text-text-secondary">
            {r.description || "No description"}
          </span>
        </div>
      ),
    },
    {
      key: "type",
      header: "Type",
      render: (r) => (
        <Badge variant={r.isSystem ? "neutral" : "info"}>
          {r.isSystem ? "System" : "Custom"}
        </Badge>
      ),
    },
    {
      key: "people",
      header: "People",
      render: (r) => {
        const count = counts[r.id] || 0;
        if (!count) return <span className="text-xs text-text-tertiary">—</span>;
        return (
          <div onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => onViewMembers(r)}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-text-secondary hover:text-foreground"
            >
              <Users className="h-3.5 w-3.5" />
              {count} {count === 1 ? "person" : "people"}
            </button>
          </div>
        );
      },
    },
    {
      key: "coverage",
      header: "Access",
      render: (r) => <CoverageBar role={r} />,
    },
    {
      key: "actions",
      header: "",
      align: "right",
      className: "text-right",
      render: (r) => {
        const owner = isOwnerRole(r);
        return (
          <div className="flex justify-end">
            <ActionMenu
              label="Role actions"
              items={[
                {
                  icon: SlidersHorizontal,
                  label: "Edit permissions",
                  onSelect: () => onOpen(r),
                },
                canManage && !owner && {
                  icon: Pencil,
                  label: "Rename",
                  onSelect: () => onEdit(r),
                },
                canManage && { icon: Copy, label: "Duplicate", onSelect: () => onDuplicate(r) },
                counts[r.id] && {
                  icon: Users,
                  label: "View in Team",
                  onSelect: () => onViewMembers(r),
                },
                { separator: true },
                canManage &&
                  !owner &&
                  !r.isSystem && {
                    icon: Trash2,
                    label: "Delete",
                    variant: "destructive",
                    onSelect: () => onDelete(r),
                  },
              ]}
            />
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-4">
      <Toolbar>
        <FilterDropdown
          value={typeFilter}
          onValueChange={setTypeFilter}
          options={TYPE_FILTER_OPTIONS}
          placeholder="All Types"
          height="h-9"
        />
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search roles…"
        />
      </Toolbar>

      <DataTable
        columns={columns}
        data={roles}
        getRowKey={(r) => r.id}
        onRowClick={onOpen}
        empty={
          <div className="rounded-xl border border-border bg-surface-subtle">
            <EmptyState
              icon={ShieldCheck}
              title={total ? "No roles match your filters" : "No roles yet"}
              description={
                total
                  ? "Try clearing the search or the type filter."
                  : "Create your first role to start controlling access."
              }
              action={
                canManage ? (
                  <Button
                    onClick={onCreate}
                    className="bg-primary text-primary-foreground"
                  >
                    <Plus className="h-4 w-4" /> Create role
                  </Button>
                ) : null
              }
            />
          </div>
        }
      />
    </div>
  );
}

// --- Permission matrix tab ---------------------------------------------------

// Every permission against every role at once. The single-role drawer is for
// composing one role; this is for answering "who can publish a pipeline?" —
// the question a grid answers and a stack of accordions never could.
function MatrixTab({
  roles,
  canManage,
  query,
  setQuery,
  groupFilter,
  setGroupFilter,
  onToggle,
  onOpenRole,
  onCreate,
}) {
  const groups = useMemo(
    () => filterGroups(query, groupFilter),
    [query, groupFilter],
  );

  if (!roles.length) {
    return (
      <div className="rounded-xl border border-border bg-surface-subtle">
        <EmptyState
          icon={ShieldCheck}
          title="No roles yet"
          description="Create a role and its column shows up here."
          action={
            canManage ? (
              <Button onClick={onCreate} className="bg-primary text-primary-foreground">
                <Plus className="h-4 w-4" /> Create role
              </Button>
            ) : null
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Toolbar>
        <FilterDropdown
          value={groupFilter}
          onValueChange={setGroupFilter}
          options={GROUP_FILTER_OPTIONS}
          placeholder="All Groups"
          height="h-9"
        />
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Search permissions…"
        />
      </Toolbar>

      {groups.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface-subtle">
          <EmptyState
            icon={Search}
            title="No matching permissions"
            description="Try a different search, or switch back to all groups."
          />
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-surface-subtle">
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="sticky left-0 z-20 min-w-[260px] bg-surface-subtle px-4">
                  Permission
                </TableHead>
                {roles.map((r) => (
                  <TableHead key={r.id} className="w-[132px] px-3 text-center">
                    <button
                      type="button"
                      onClick={() => onOpenRole(r)}
                      className="mx-auto flex w-full max-w-[116px] flex-col items-center gap-1 normal-case hover:text-foreground"
                    >
                      <span className="w-full truncate text-xs font-semibold tracking-normal text-foreground">
                        {r.name}
                      </span>
                      <span className="text-[10px] font-medium tracking-normal text-text-tertiary tabular-nums">
                        {isOwnerRole(r)
                          ? `all ${ALL_PERMISSION_KEYS.length}`
                          : `${grantedCount(r)}/${ALL_PERMISSION_KEYS.length}`}
                      </span>
                    </button>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map(({ group, permissions }) => (
                <React.Fragment key={group}>
                  <TableRow className="border-border hover:bg-transparent">
                    <TableCell
                      colSpan={roles.length + 1}
                      className="bg-surface-card px-4 py-2"
                    >
                      {/* The cell spans the table, so the label itself is what
                          pins — otherwise it scrolls away on a wide matrix. */}
                      <span className="sticky left-4 inline-block text-[11px] font-medium uppercase tracking-wider text-text-tertiary">
                        {group}
                        <span className="ml-2 normal-case tracking-normal text-text-tertiary/70">
                          {permissions.length}
                        </span>
                      </span>
                    </TableCell>
                  </TableRow>
                  {permissions.map((perm) => (
                    <TableRow key={perm.key} className="group border-border">
                      <TableCell className="sticky left-0 z-10 bg-surface-subtle px-4 py-3 transition-colors group-hover:bg-surface-active">
                        <span className="flex items-center gap-1.5">
                          <span className="text-sm text-foreground">
                            {perm.label}
                          </span>
                          {perm.scopeBy ? (
                            <span className="shrink-0 rounded border border-border bg-surface-card px-1 py-px text-[10px] text-text-tertiary">
                              per {perm.scopeBy}
                            </span>
                          ) : null}
                        </span>
                        <span className="block font-mono text-[10px] text-text-tertiary">
                          {perm.key}
                        </span>
                      </TableCell>
                      {roles.map((r) => (
                        <TableCell key={r.id} className="px-3 py-3 text-center">
                          <MatrixCell
                            checked={grantsKey(r, perm.key)}
                            locked={!canManage || isOwnerRole(r)}
                            label={`${perm.label} for ${r.name}`}
                            onClick={() => onToggle(r, perm.key)}
                          />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </React.Fragment>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

// Granted reads as a filled tick, locked-granted as a muted one (Owner, or a
// viewer without manage rights), and denied as an empty well that only hints at
// a tick on hover.
function MatrixCell({ checked, locked, label, onClick }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={checked}
      disabled={locked}
      onClick={onClick}
      className={cn(
        "mx-auto flex h-7 w-7 items-center justify-center rounded-md border transition-colors",
        checked && locked
          ? "border-border bg-surface-active text-text-secondary"
          : checked
            ? "border-primary/40 bg-primary/15 text-primary hover:bg-primary/25"
            : "border-border bg-surface-card text-transparent",
        !locked &&
          !checked &&
          "hover:border-border-strong hover:bg-surface-hover hover:text-text-tertiary",
        locked && "cursor-default",
      )}
    >
      <Check className="h-3.5 w-3.5" />
    </button>
  );
}

// --- Role drawer -------------------------------------------------------------

// Composing a single role: identity up top, then the whole catalog as one
// continuous divided list under sticky group headers. Deliberately flat — the
// old nested accordion-inside-a-card-inside-a-card was the boxiness.
function RoleDrawer({
  role,
  canManage,
  memberCount,
  query,
  setQuery,
  onOpenChange,
  onToggle,
  onToggleGroup,
  onEdit,
  onDuplicate,
  onDelete,
  onViewMembers,
}) {
  // Owner's list is read-only and unsearchable, so a query carried over from the
  // matrix must not silently hide half of it.
  const owner = isOwnerRole(role);
  const groups = useMemo(
    () => filterGroups(owner ? "" : query),
    [owner, query],
  );

  if (!role) return null;

  const locked = owner || !canManage;

  return (
    <Sheet open onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-lg">
        <SheetHeader className="shrink-0 gap-3 border-b border-border p-5 pr-12">
          <div className="flex min-w-0 items-center gap-2">
            <SheetTitle className="truncate text-lg">{role.name}</SheetTitle>
            <Badge variant={role.isSystem ? "neutral" : "info"}>
              {role.isSystem ? "System" : "Custom"}
            </Badge>
          </div>
          <SheetDescription>
            {role.description || "No description for this role yet."}
          </SheetDescription>

          <CoverageBar role={role} className="w-full" />

          <div className="flex flex-wrap items-center gap-2">
            {memberCount ? (
              <Button variant="outline" size="sm" onClick={() => onViewMembers(role)}>
                <Users className="h-3.5 w-3.5" />
                {memberCount} {memberCount === 1 ? "person" : "people"}
              </Button>
            ) : (
              <span className="text-xs text-text-tertiary">Nobody holds this role</span>
            )}
            <span className="flex-1" />
            {canManage ? (
              <Button variant="outline" size="sm" onClick={() => onDuplicate(role)}>
                <Copy className="h-3.5 w-3.5" /> Duplicate
              </Button>
            ) : null}
            {canManage && !owner ? (
              <Button variant="outline" size="sm" onClick={() => onEdit(role)}>
                <Pencil className="h-3.5 w-3.5" /> Rename
              </Button>
            ) : null}
            {canManage && !owner && !role.isSystem ? (
              <Button
                variant="outline"
                size="sm"
                aria-label="Delete role"
                className="text-red-400 hover:text-red-300"
                onClick={() => {
                  onOpenChange(false);
                  onDelete(role);
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            ) : null}
          </div>
        </SheetHeader>

        {owner ? (
          <div className="shrink-0 border-b border-border p-4">
            <Notice icon={Lock}>
              Owner holds every permission — including ones added to the product
              later. It is deliberately not editable, so a project always keeps
              at least one role that can administer it.
            </Notice>
          </div>
        ) : (
          <div className="relative shrink-0 border-b border-border p-4">
            <Search className="pointer-events-none absolute left-7 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-tertiary" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter permissions…"
              className="h-9 bg-surface-card pl-9 text-sm"
            />
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {groups.length === 0 ? (
            <p className="px-5 py-12 text-center text-sm text-text-tertiary">
              No permission matches “{query}”.
            </p>
          ) : (
            groups.map(({ group, permissions }) => {
              const keys = permissions.map((p) => p.key);
              const on = keys.filter((k) => grantsKey(role, k)).length;
              const allOn = on === keys.length;
              return (
                <section key={group}>
                  <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-surface-card px-5 py-2">
                    <span className="flex-1 truncate text-[11px] font-medium uppercase tracking-wider text-text-tertiary">
                      {group}
                    </span>
                    <span
                      className={cn(
                        "rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular-nums",
                        on ? "bg-primary/15 text-primary" : "text-text-tertiary",
                      )}
                    >
                      {on}/{keys.length}
                    </span>
                    {!locked ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-[11px] text-text-secondary"
                        onClick={() => onToggleGroup(role, keys, !allOn)}
                      >
                        {allOn ? "Clear" : "Select all"}
                      </Button>
                    ) : null}
                  </div>

                  <div className="divide-y divide-border px-5">
                    {permissions.map((perm) => (
                      <label
                        key={perm.key}
                        className={cn(
                          "flex items-center justify-between gap-4 py-3",
                          !locked && "cursor-pointer",
                        )}
                      >
                        <span className="min-w-0">
                          <span className="flex items-center gap-1.5">
                            <span className="truncate text-sm text-foreground">
                              {perm.label}
                            </span>
                            {perm.scopeBy ? (
                              <span className="shrink-0 rounded border border-border bg-surface-card px-1 py-px text-[10px] text-text-tertiary">
                                per {perm.scopeBy}
                              </span>
                            ) : null}
                          </span>
                          <span className="block truncate font-mono text-[10px] text-text-tertiary">
                            {perm.key}
                          </span>
                        </span>
                        <Switch
                          checked={grantsKey(role, perm.key)}
                          disabled={locked}
                          onCheckedChange={() => onToggle(role, perm.key)}
                        />
                      </label>
                    ))}
                  </div>
                </section>
              );
            })
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// --- Create / edit dialog ----------------------------------------------------

function RoleDialog({ open, onOpenChange, editing, draft, setDraft, roles, onSubmit }) {
  const set = (key) => (value) => setDraft((d) => ({ ...d, [key]: value }));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? "Edit role" : "Create role"}</DialogTitle>
          <DialogDescription>
            {editing
              ? "Update this role's details. Permissions are edited in the role's panel."
              : "Name the role and optionally start from an existing one."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <Field label="Name" htmlFor="role-name">
            <Input
              id="role-name"
              value={draft.name}
              onChange={(e) => set("name")(e.target.value)}
              placeholder="e.g. Pipeline Admin"
            />
          </Field>
          <Field label="Description" htmlFor="role-desc">
            <Textarea
              id="role-desc"
              value={draft.description}
              onChange={(e) => set("description")(e.target.value)}
              placeholder="What this role is for"
              rows={2}
            />
          </Field>
          {!editing ? (
            <Field
              label="Start from"
              hint="Copies that role's permissions as a starting point."
            >
              <Select value={draft.cloneFrom} onValueChange={set("cloneFrom")}>
                <SelectTrigger>
                  <SelectValue placeholder="Blank" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Blank (no permissions)</SelectItem>
                  {roles.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      Copy from {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button className="bg-primary text-primary-foreground" onClick={onSubmit}>
            {editing ? "Save Changes" : "Create role"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default RolesPermissionsScreen;
