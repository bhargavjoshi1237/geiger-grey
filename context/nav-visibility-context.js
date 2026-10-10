"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { canToggleNavItem, defaultHiddenNav, sanitizeHidden } from "@geiger/ui";

import navConfig from "@/geiger-ui.config";
import { workspaceNav } from "@/components/internal/sidebar/sidebar_nav";
import { useOptionalProject } from "@/context/project-context";
import { useWorkspaceUrl } from "@/lib/hooks/use-workspace-url";
import { getNavPrefs, saveNavPrefs } from "@/lib/supabase/nav_prefs";
import { getUser } from "@/lib/supabase/user";
import {
  sameStringList,
  usePaintFromShellCache,
  writeShellCache,
} from "@/lib/workspace/shell_cache";

const CACHE = "nav-hidden";

const NavVisibilityContext = createContext(null);

const ALL_VISIBLE = Object.freeze({
  hidden: Object.freeze([]),
  loading: false,
  available: false,
  config: navConfig,
  setHidden: async () => ({ ok: false, reason: "" }),
  reset: async () => false,
});

export function NavVisibilityProvider({ children }) {
  const project = useOptionalProject();
  const { projectId: routeProjectId } = useWorkspaceUrl();
  const projectId = routeProjectId || project?.projectId || null;

  const [hidden, setHiddenState] = useState(() => defaultHiddenNav(navConfig));
  const [userId, setUserId] = useState(null);
  const [loading, setLoading] = useState(true);

  usePaintFromShellCache(CACHE, projectId, (entry) => {
    setHiddenState(sanitizeHidden(entry.value, workspaceNav, navConfig));
    setLoading(false);
  });

  useEffect(() => {
    let alive = true;
    (async () => {
      const user = await getUser();
      const prefs = projectId ? await getNavPrefs(projectId, user?.id ?? null) : null;
      if (!alive) return;
      setUserId(user?.id ?? null);
      setLoading(false);
      if (!prefs) return;
      const next = sanitizeHidden(prefs.hidden, workspaceNav, navConfig);
      setHiddenState((prev) => (sameStringList(prev, next) ? prev : next));
      writeShellCache(CACHE, projectId, user?.id ?? null, next);
    })();
    return () => {
      alive = false;
    };
  }, [projectId]);

  const persist = useCallback(
    async (next, previous) => {
      setHiddenState(next);
      if (!projectId) return true;
      const ok = await saveNavPrefs(projectId, userId, next);
      if (!ok) {
        setHiddenState(previous);
        return false;
      }
      writeShellCache(CACHE, projectId, userId, next);
      return true;
    },
    [projectId, userId],
  );

  const setHidden = useCallback(
    async (title, nextHidden) => {
      const check = canToggleNavItem(title, {
        nav: workspaceNav,
        hidden,
        config: navConfig,
        nextHidden,
      });
      if (!check.allowed) return { ok: false, reason: check.reason };

      const next = nextHidden
        ? hidden.concat(title)
        : hidden.filter((t) => t !== title);
      const ok = await persist(next, hidden);
      return { ok, reason: ok ? "" : "Couldn't save your navigation settings." };
    },
    [hidden, persist],
  );

  const reset = useCallback(
    () => (hidden.length === 0 ? Promise.resolve(true) : persist([], hidden)),
    [hidden, persist],
  );

  const value = useMemo(
    () => ({
      hidden,
      loading,
      available: true,
      config: navConfig,
      setHidden,
      reset,
    }),
    [hidden, loading, setHidden, reset],
  );

  return (
    <NavVisibilityContext.Provider value={value}>
      {children}
    </NavVisibilityContext.Provider>
  );
}

export function useNavVisibility() {
  return useContext(NavVisibilityContext) ?? ALL_VISIBLE;
}
