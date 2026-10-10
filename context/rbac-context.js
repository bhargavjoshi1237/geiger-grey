"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { can as rbacCan, evaluate as rbacEvaluate, resolveGrants } from "@geiger/rbac";

import rbacConfig from "@/geiger-rbac.config";
import { useOptionalProject } from "@/context/project-context";
import { useWorkspaceUrl } from "@/lib/hooks/use-workspace-url";
import { getUser } from "@/lib/supabase/user";
import {
  ensureMembership,
  ensureSystemRoles,
  listRoles,
  listUserGrants,
} from "@/lib/supabase/rbac";
import {
  usePaintFromShellCache,
  writeShellCache,
} from "@/lib/workspace/shell_cache";

const ALLOW_WHILE_LOADING = true;

const UNLOADED = Symbol("rbac:unloaded");

const CACHE = "rbac-grants";

const RbacContext = createContext(null);

const PERMISSIVE = Object.freeze({
  roles: Object.freeze([]),
  grants: Object.freeze([]),
  resolved: null,
  loading: false,
  available: false,
  userId: null,
  isOwner: false,
  can: () => true,
  decide: () => ({
    allowed: true,
    code: "no_provider",
    reason: "Authorization is not loaded on this surface.",
    via: null,
  }),
  refresh: async () => {},
});

export function RbacProvider({ children }) {
  const project = useOptionalProject();
  const { projectId: routeProjectId } = useWorkspaceUrl();
  const projectId = routeProjectId || project?.projectId || null;

  const [userId, setUserId] = useState(null);
  const [roles, setRoles] = useState([]);
  const [grants, setGrants] = useState([]);
  const [loadedFor, setLoadedFor] = useState(UNLOADED);

  usePaintFromShellCache(CACHE, projectId, (entry) => {
    if (!entry.value) return;
    setUserId(entry.userId ?? null);
    setRoles(entry.value.roles || []);
    setGrants(entry.value.grants || []);
    setLoadedFor(projectId);
  });

  const load = useCallback(async () => {
    const user = await getUser();
    const uid = user?.id ?? null;
    if (!projectId || !uid) {
      return { uid, roleRows: [], grantRows: [] };
    }
    let [roleRows, grantRows] = await Promise.all([
      listRoles(projectId),
      listUserGrants(projectId, uid),
    ]);

    if (grantRows && grantRows.length === 0) {
      const seeded = await ensureSystemRoles(projectId, uid);
      if (seeded?.length) roleRows = seeded;
      const fallback = (roleRows || []).find((r) => r.key === "member") || null;
      if (await ensureMembership(projectId, fallback?.id ?? null)) {
        grantRows = (await listUserGrants(projectId, uid)) ?? grantRows;
      }
    }

    return { uid, roleRows, grantRows };
  }, [projectId]);

  const apply = useCallback(
    ({ uid, roleRows, grantRows }) => {
      setUserId(uid);
      setLoadedFor(projectId);
      if (!roleRows || !grantRows) return;
      setRoles(roleRows);
      setGrants(grantRows);
      if (projectId) {
        writeShellCache(CACHE, projectId, uid, {
          roles: roleRows,
          grants: grantRows,
        });
      }
    },
    [projectId],
  );

  useEffect(() => {
    let alive = true;
    load().then((result) => {
      if (!alive) return;
      apply(result);
    });
    return () => {
      alive = false;
    };
  }, [load, apply]);

  const refresh = useCallback(async () => {
    apply(await load());
  }, [load, apply]);

  const loading = loadedFor !== projectId;

  const resolved = useMemo(
    () => resolveGrants({ config: rbacConfig, roles, grants }),
    [roles, grants],
  );

  const available = !loading;

  const value = useMemo(() => {
    const options = { config: rbacConfig, roles, grants, actorId: userId, resolved };

    const decide = (key, extra = {}) => {
      if (!available) {
        return {
          allowed: ALLOW_WHILE_LOADING,
          code: "loading",
          reason: "Still checking what you can do here.",
          via: null,
        };
      }
      return rbacEvaluate(key, { ...options, ...extra });
    };

    return {
      roles,
      grants,
      resolved,
      loading,
      available,
      userId,
      isOwner: roles.some(
        (r) =>
          grants.some((g) => g.roleId === r.id) &&
          (r.permissions || []).includes("*"),
      ),
      can: (key, extra) =>
        available ? rbacCan(key, { ...options, ...extra }) : ALLOW_WHILE_LOADING,
      decide,
      refresh,
    };
  }, [roles, grants, resolved, loading, available, userId, refresh]);

  return <RbacContext.Provider value={value}>{children}</RbacContext.Provider>;
}

export function useRbac() {
  return useContext(RbacContext) ?? PERMISSIVE;
}

export function useCan(key, extra) {
  const { can } = useRbac();
  return can(key, extra);
}
