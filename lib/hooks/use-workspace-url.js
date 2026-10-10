"use client";

import { createContext, useCallback, useContext, useMemo } from "react";
import {
  useRouter,
  usePathname,
  useSearchParams,
  useParams,
} from "next/navigation";
import { tabToSlug, slugToTab } from "@/lib/workspace/tabs";

export const DEFAULT_TAB = "Overview";
export const DEFAULT_SECTION = "overview";

export const WorkspaceUrlContext = createContext(null);

export function useWorkspaceUrl() {
  const override = useContext(WorkspaceUrlContext);
  const router = useRouter();
  const pathname = usePathname();
  const routeParams = useParams();
  const searchParams = useSearchParams();

  const projectId = routeParams?.projectId || null;
  const rest = routeParams?.rest;
  const tabSlug = Array.isArray(rest) ? rest[0] : rest || null;
  const tab = (tabSlug && slugToTab(tabSlug)) || DEFAULT_TAB;

  const section = searchParams.get("section") || DEFAULT_SECTION;

  // Every query param except `section`, as a plain object — generic, so any domain (kb, pipeline, entity, conversation, q, ...) just works.
  const params = useMemo(() => {
    const out = {};
    for (const [key, value] of searchParams.entries()) {
      if (key === "section") continue;
      out[key] = value;
    }
    return out;
  }, [searchParams]);

  // Overlays `overrides` on the CURRENT query string: undefined keeps a key, null deletes it, anything else sets it.
  const buildUrl = useCallback(
    (overrides) => {
      const qp = new URLSearchParams(searchParams);
      for (const [key, value] of Object.entries(overrides)) {
        if (value === undefined) continue;
        if (value === null) qp.delete(key);
        else qp.set(key, value);
      }
      const qs = qp.toString();
      return qs ? `${pathname}?${qs}` : pathname;
    },
    [searchParams, pathname],
  );

  // Shallow query-only navigation (same path): skips the router so path-bearing layouts don't re-render.
  const apply = useCallback(
    (overrides, { replace = false } = {}) => {
      const url = buildUrl(overrides);
      if (replace) window.history.replaceState(null, "", url);
      else window.history.pushState(null, "", url);
    },
    [buildUrl],
  );

  // Fresh URL for a path change (project and/or tab): empty query, then `params` layered on top (null/undefined skipped).
  const buildFreshUrl = useCallback(
    (pid, nextTab, query = {}) => {
      const slug = nextTab && nextTab !== DEFAULT_TAB ? tabToSlug(nextTab) : "";
      let path = `/project/${pid}`;
      if (slug) path += `/${slug}`;
      const qp = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined || value === null) continue;
        qp.set(key, value);
      }
      const qs = qp.toString();
      return qs ? `${path}?${qs}` : path;
    },
    [],
  );

  const setProject = useCallback(
    (id) => router.push(buildFreshUrl(id, tab), { scroll: false }),
    [router, buildFreshUrl, tab],
  );

  // Atomic: moves to `next` tab and sets `params` in one push (clears the query when `params` is omitted).
  const setTab = useCallback(
    (next, tabParams) =>
      router.push(buildFreshUrl(projectId, next, tabParams || {}), {
        scroll: false,
      }),
    [router, buildFreshUrl, projectId],
  );

  const openRecordInTab = useCallback(
    (nextTab, name, id) => setTab(nextTab, { [name]: id }),
    [setTab],
  );

  const setSection = useCallback(
    (next) => apply({ section: next }, { replace: true }),
    [apply],
  );

  const setParam = useCallback(
    (name, value) => apply({ [name]: value === undefined ? null : value }),
    [apply],
  );

  const openRecord = useCallback(
    (name, id) => apply({ [name]: id, section: null }),
    [apply],
  );
  const closeRecord = useCallback(
    (name) => apply({ [name]: null, section: null }),
    [apply],
  );

  if (override) return override;

  return {
    projectId,
    tab,
    section,
    params,
    setProject,
    setTab,
    openRecordInTab,
    setSection,
    setParam,
    openRecord,
    closeRecord,
  };
}
