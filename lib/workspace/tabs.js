import { NAV_TREE } from "./nav_tree.js";

export function tabToSlug(title) {
  return String(title || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

export const SLUG_TO_TAB = (() => {
  const map = {};
  const add = (title) => {
    if (!title) return;
    const slug = tabToSlug(title);
    if (!(slug in map)) map[slug] = title;
  };
  for (const section of NAV_TREE) {
    add(section.title);
    for (const sub of section.subItems || []) add(sub.title);
  }
  return map;
})();

export function slugToTab(slug) {
  if (!slug) return null;
  return SLUG_TO_TAB[String(slug).toLowerCase()] || null;
}

export const DEFAULT_TAB = "Overview";

const PARENT_OF = (() => {
  const map = {};
  for (const section of NAV_TREE) {
    map[section.title] = section.title;
    for (const sub of section.subItems || []) map[sub.title] = section.title;
  }
  return map;
})();

export function parentSectionOf(title) {
  return PARENT_OF[title] || null;
}
