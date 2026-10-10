"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { useProject } from "@/context/project-context";
import { useRbac } from "@/context/rbac-context";
import { getUser } from "@/lib/supabase/user";
import {
  ensureSystemRoles,
  listGrants,
  revokeGrant,
  setMemberRole,
} from "@/lib/supabase/rbac";
import {
  listMembers,
  inviteMember,
  updateMember,
  softDeleteMember,
  listGroups,
  createGroup,
  listActivity,
  logActivity,
  syncTeam,
} from "@/lib/supabase/team";
import { DEFAULT_SEAT_LIMIT } from "../constants";

// Everything the Team & Members screen knows about the roster: the rows it
// loads, what it derives from them, and the writes that change them. The screen
// itself keeps only view state (tab, search, filters, which panel is open) and
// renders what this returns.
export function useTeam() {
  const { projectId } = useProject();
  const { can, userId: myUserId, refresh: refreshRbac } = useRbac();

  const canInvite = can("grey.team.invite");
  const canAssign = can("grey.team.assign");

  const [members, setMembers] = useState([]);
  const [roles, setRoles] = useState([]);
  // What @geiger/rbac actually reads. The roster above is display; these are the
  // rows that decide access.
  const [grants, setGrants] = useState([]);
  const [groups, setGroups] = useState([]);
  const [activity, setActivity] = useState([]);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState(null);
  const [userName, setUserName] = useState("");

  const seatLimit = DEFAULT_SEAT_LIMIT;

  useEffect(() => {
    let alive = true;
    getUser().then((u) => {
      if (!alive) return;
      setUserId(u?.id || null);
      setUserName(u?.name || "");
    });
    (async () => {
      // Fills any missing system role from geiger-rbac.config.js; a no-op once
      // the project has them all.
      const rolesList = (await ensureSystemRoles(projectId, null)) ?? [];
      const defaultRole =
        rolesList.find((r) => r.key === "member") ||
        rolesList[rolesList.length - 1] ||
        null;
      // Project real org members into the overlay, then read the roster.
      await syncTeam(projectId, defaultRole?.id ?? null);
      const memberRows = await listMembers(projectId);
      if (!alive) return;
      setRoles(rolesList);
      setMembers(memberRows ?? []);
      setLoading(false);
    })();
    listGroups(projectId).then((rows) => alive && setGroups(rows ?? []));
    listActivity(projectId).then((rows) => alive && setActivity(rows ?? []));
    listGrants(projectId).then((rows) => alive && setGrants(rows ?? []));
    return () => {
      alive = false;
    };
  }, [projectId]);

  // --- Derived -------------------------------------------------------------

  const roleById = useMemo(() => {
    const map = {};
    roles.forEach((r) => (map[r.id] = r));
    return map;
  }, [roles]);

  // A member's ACTIVE grant is the authority on what they can do; the roster's
  // own role_id is only a display fallback for an invited person who has no
  // account yet and so has nothing to grant to.
  const grantByUser = useMemo(() => {
    const map = {};
    for (const g of grants) {
      if (g.userId && g.status === "active" && !g.deletedAt) map[g.userId] = g;
    }
    return map;
  }, [grants]);

  const roleIdOf = useCallback(
    (member) =>
      (member.userId && grantByUser[member.userId]?.roleId) || member.roleId || null,
    [grantByUser],
  );

  // Owner is whichever role holds the wildcard. Demoting or removing the last
  // one would leave the workspace with nobody able to administer it.
  const ownerRoleIds = useMemo(
    () =>
      new Set(
        roles.filter((r) => (r.permissions || []).includes("*")).map((r) => r.id),
      ),
    [roles],
  );

  const ownerCount = useMemo(
    () =>
      Object.values(grantByUser).filter((g) => ownerRoleIds.has(g.roleId)).length,
    [grantByUser, ownerRoleIds],
  );

  const isLastOwner = useCallback(
    (member) => ownerRoleIds.has(roleIdOf(member)) && ownerCount <= 1,
    [ownerRoleIds, roleIdOf, ownerCount],
  );

  const groupById = useMemo(() => {
    const map = {};
    groups.forEach((g) => (map[g.id] = g));
    return map;
  }, [groups]);

  const memberCountByGroup = useMemo(() => {
    const map = {};
    members.forEach((m) =>
      (m.groupIds || []).forEach((id) => (map[id] = (map[id] || 0) + 1)),
    );
    return map;
  }, [members]);

  const activeMembers = useMemo(
    () => members.filter((m) => m.status !== "invited"),
    [members],
  );
  const invites = useMemo(
    () => members.filter((m) => m.status === "invited"),
    [members],
  );

  const seatsUsed = members.filter((m) => m.status !== "suspended").length;
  const seatsFull = seatsUsed >= seatLimit;

  const stats = useMemo(
    () => [
      { label: "Active members", value: String(activeMembers.length) },
      { label: "Pending invites", value: String(invites.length) },
      { label: "Seats used", value: `${seatsUsed} / ${seatLimit}` },
      { label: "Groups", value: String(groups.length) },
    ],
    [activeMembers.length, invites.length, seatsUsed, seatLimit, groups.length],
  );

  // --- Mutations -----------------------------------------------------------

  const audit = (action, target, detail) =>
    logActivity({
      projectId,
      actorUserId: userId,
      actorName: userName,
      targetMemberId: target?.id ?? null,
      targetName: target?.name || target?.email || "",
      action,
      detail: detail ?? {},
    }).then((row) => row && setActivity((prev) => [row, ...prev]));

  const patchMember = (id, patch) =>
    setMembers((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));

  // The grant is the write that matters — it is what @geiger/rbac and every RLS
  // policy read. project_members is updated alongside it purely so the roster
  // keeps showing the right role for an invited person who has no account yet
  // (and therefore nothing to grant to).
  const changeRole = async (member, roleId) => {
    if (!canAssign) {
      toast.error("You don't have permission to assign roles.");
      return;
    }
    const prevRole = roleIdOf(member);
    if (prevRole === roleId) return;
    if (isLastOwner(member) && !ownerRoleIds.has(roleId)) {
      toast.error(
        "This is the workspace's last owner — give someone else the Owner role first.",
      );
      return;
    }

    patchMember(member.id, { roleId });
    const saved = await updateMember(member.id, { roleId });
    if (!saved) {
      patchMember(member.id, { roleId: prevRole });
      toast.error("Couldn't change the role.");
      return;
    }

    if (member.userId) {
      const granted = await setMemberRole({
        projectId,
        userId: member.userId,
        roleId,
        grantedBy: userId,
        currentGrants: grants,
      });
      if (granted) {
        setGrants((prev) => [
          ...prev.filter((g) => g.userId !== member.userId),
          granted,
        ]);
        // Changing your own role changes your own nav.
        if (member.userId === myUserId) refreshRbac();
      } else {
        patchMember(member.id, { roleId: prevRole });
        await updateMember(member.id, { roleId: prevRole });
        toast.error("Couldn't change their access — the role is unchanged.");
        return;
      }
    }
    audit("role_changed", member, { role: roleById[roleId]?.name });
  };

  const toggleSuspend = async (member) => {
    const next = member.status === "suspended" ? "active" : "suspended";
    patchMember(member.id, { status: next });
    const saved = await updateMember(member.id, { status: next });
    if (saved) {
      audit(next === "suspended" ? "suspended" : "status_changed", member, {
        status: next,
      });
    } else {
      patchMember(member.id, { status: member.status });
      toast.error("Couldn't update the member.");
    }
  };

  const setMemberGroups = async (member, groupIds) => {
    patchMember(member.id, { groupIds });
    const saved = await updateMember(member.id, { groupIds });
    if (saved) audit("group_changed", member);
    else {
      patchMember(member.id, { groupIds: member.groupIds });
      toast.error("Couldn't update groups.");
    }
  };

  // Resolves true once the member is gone, so the caller can close whatever was
  // showing them.
  const removeMember = async (member) => {
    if (isLastOwner(member)) {
      toast.error(
        "This is the workspace's last owner — give someone else the Owner role first.",
      );
      return false;
    }
    setMembers((prev) => prev.filter((m) => m.id !== member.id));

    // Revoking the grant is the part that actually removes access; dropping the
    // roster row alone would leave them fully authorized but invisible. The
    // revoked row is also what stops the join bootstrap handing the role back.
    const grant = member.userId ? grantByUser[member.userId] : null;
    if (grant) {
      if (await revokeGrant(grant.id)) {
        setGrants((prev) => prev.filter((g) => g.id !== grant.id));
      } else {
        setMembers((prev) => [...prev, member]);
        toast.error("Couldn't revoke their access — nothing was removed.");
        return false;
      }
    }

    const ok = await softDeleteMember(member.id);
    if (ok) {
      audit("removed", member);
      toast.success("Member removed");
      return true;
    }
    setMembers((prev) => [...prev, member]);
    toast.error("Couldn't remove the member.");
    return false;
  };

  // Split from inviteMembers so the caller can close the dialog only once the
  // input is known good — and keep it open, with the typed emails, when it isn't.
  const parseInviteList = (emails) => {
    const list = emails
      .split(/[\s,;]+/)
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
    if (!list.length) {
      toast.error("Enter at least one email.");
      return null;
    }
    if (seatsUsed + list.length > seatLimit) {
      toast.error("Not enough seats for that many invites.");
      return null;
    }
    return list;
  };

  const inviteMembers = async (list, roleId, groupId, message) => {
    for (const email of list) {
      const id = crypto.randomUUID();
      const optimistic = {
        id,
        projectId,
        userId: null,
        roleId,
        status: "invited",
        email,
        name: "",
        avatarUrl: "",
        groupIds: groupId && groupId !== "none" ? [groupId] : [],
        invitedBy: userId,
        invitedAt: new Date().toISOString(),
        metadata: message ? { message } : {},
      };
      setMembers((prev) => [...prev, optimistic]);
      const saved = await inviteMember(optimistic);
      if (saved) {
        setMembers((prev) => prev.map((m) => (m.id === id ? saved : m)));
        audit("invited", optimistic, { email });
      } else {
        setMembers((prev) => prev.filter((m) => m.id !== id));
        toast.error(`Couldn't invite ${email}.`);
      }
    }
    toast.success(list.length === 1 ? "Invitation sent" : `${list.length} invitations sent`);
  };

  const revokeInvite = async (member) => {
    setMembers((prev) => prev.filter((m) => m.id !== member.id));
    const ok = await softDeleteMember(member.id);
    if (!ok) {
      setMembers((prev) => [...prev, member]);
      toast.error("Couldn't revoke the invite.");
    } else {
      toast.success("Invitation revoked");
    }
  };

  const addGroup = async (name, description) => {
    const id = crypto.randomUUID();
    const optimistic = {
      id,
      projectId,
      name: name.trim(),
      description,
      createdBy: userId,
    };
    setGroups((prev) => [...prev, optimistic]);
    const saved = await createGroup(optimistic);
    if (saved) {
      setGroups((prev) => prev.map((g) => (g.id === id ? saved : g)));
      audit("group_created", { name: optimistic.name });
      toast.success("Group created");
    } else {
      setGroups((prev) => prev.filter((g) => g.id !== id));
      toast.error("Couldn't create the group.");
    }
  };

  return {
    loading,
    canInvite,
    canAssign,
    // rows
    members,
    roles,
    groups,
    activity,
    // derived
    roleById,
    roleIdOf,
    grantByUser,
    groupById,
    memberCountByGroup,
    activeMembers,
    invites,
    isLastOwner,
    seatLimit,
    seatsUsed,
    seatsFull,
    stats,
    // mutations
    changeRole,
    setMemberGroups,
    toggleSuspend,
    removeMember,
    parseInviteList,
    inviteMembers,
    revokeInvite,
    addGroup,
  };
}

export default useTeam;
