import { NAV_TREE } from "@/lib/workspace/nav_tree";

// Nav title -> screen component. Starts empty; the controller wires each
// area's screen in here directly as its task merges.
export const SCREEN_REGISTRY = {};

// Section title -> its first sub-item's title ("Knowledge Bases" -> "All
// Knowledge Bases"). Shared by getScreen's section fallback and by the
// sidebar/catch-all page's active-tab highlighting, so a section-level tab
// always resolves to the same leaf screen.
export function firstSubItemOf(title) {
  const section = NAV_TREE.find((s) => s.title === title);
  return section?.subItems?.[0]?.title || null;
}

// A section title (e.g. "Knowledge Bases") falls back to its first sub-item's
// screen; null falls back to ComingSoonScreen (see the catch-all page).
export function getScreen(title) {
  return SCREEN_REGISTRY[title] || SCREEN_REGISTRY[firstSubItemOf(title)] || null;
}

export default SCREEN_REGISTRY;
