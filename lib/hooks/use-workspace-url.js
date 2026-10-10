"use client";

import { createContext, useCallback, useContext, useMemo } from "react";
import { useRouter, useSearchParams, useParams } from "next/navigation";
import { tabToSlug, slugToTab } from "@/lib/workspace/tabs";

export const DEFAULT_TAB = "Overview";
export const DEFAULT_SECTION = "overview";

// Query params the workspace recognizes beyond tab/section: the open-record
// ids for each domain plus the free-text search query. Opening/closing a
// record resets section (a fresh record view starts at its own top);
// setParam leaves section alone, since it's also used for things like the
// search box that shouldn't jump the user out of where they are.
const RECORD_PARAMS = ["kb", "pipeline", "entity", "conversation"];
const PARAM_NAMES = [...RECORD_PARAMS, "q"];

export const WorkspaceUrlContext = createContext(null);

export function useWorkspaceUrl() {
  const override = useContext(WorkspaceUrlContext);
  const router = useRouter();
  const routeParams = useParams();
  const searchParams = useSearchParams();

  const projectId = routeParams?.projectId || null;
  const rest = routeParams?.rest;
  const tabSlug = Array.isArray(rest) ? rest[0] : rest || null;
  const tab = (tabSlug && slugToTab(tabSlug)) || DEFAULT_TAB;

  const section = searchParams.get("section") || DEFAULT_SECTION;

  const params = useMemo(() => {
    const out = {};
    for (const name of PARAM_NAMES) out[name] = searchParams.get(name) || null;
    return out;
  }, [searchParams]);

  const buildUrl = useCallback(
    (next) => {
      const pid = next.project !== undefined ? next.project : projectId;
      const nextTab = next.tab !== undefined ? next.tab : tab;
      const slug =
        nextTab && nextTab !== DEFAULT_TAB ? tabToSlug(nextTab) : "";
      let path = `/project/${pid}`;
      if (slug) path += `/${slug}`;

      const qp = new URLSearchParams();
      const sec = next.section !== undefined ? next.section : section;
      if (sec && sec !== DEFAULT_SECTION) qp.set("section", sec);
      for (const name of PARAM_NAMES) {
        const value = next[name] !== undefined ? next[name] : params[name];
        if (value) qp.set(name, value);
      }

      const qs = qp.toString();
      return qs ? `${path}?${qs}` : path;
    },
    [projectId, tab, section, params],
  );

  const apply = useCallback(
    (next, { replace = false } = {}) => {
      const url = buildUrl(next);
      const movesPath =
        next.project !== undefined || next.tab !== undefined || !projectId;
      if (movesPath) {
        router.push(url, { scroll: false });
        return;
      }
      const at = url.indexOf("?");
      const href = `${window.location.pathname}${at === -1 ? "" : url.slice(at)}`;
      if (replace) window.history.replaceState(null, "", href);
      else window.history.pushState(null, "", href);
    },
    [router, buildUrl, projectId],
  );

  const setProject = useCallback(
    (id) => {
      const clear = Object.fromEntries(PARAM_NAMES.map((name) => [name, null]));
      return apply({ project: id, section: null, ...clear });
    },
    [apply],
  );

  const setTab = useCallback(
    (next) => {
      const clear = Object.fromEntries(PARAM_NAMES.map((name) => [name, null]));
      return apply({ tab: next, section: null, ...clear });
    },
    [apply],
  );

  const setSection = useCallback(
    (next) => apply({ section: next }, { replace: true }),
    [apply],
  );

  const setParam = useCallback(
    (name, value) => apply({ [name]: value }, { replace: true }),
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
    setSection,
    setParam,
    openRecord,
    closeRecord,
  };
}
