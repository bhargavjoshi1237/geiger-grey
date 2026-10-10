// Nav title -> screen component. Populated incrementally as each area's
// screens land; the controller is the only one to edit this file directly
// once screen tasks start merging their own entries in.
export const SCREEN_REGISTRY = {};

// null falls back to ComingSoonScreen (see app/project/[projectId]/[[...rest]]/page.js).
export function getScreen(title) {
  return SCREEN_REGISTRY[title] || null;
}

export default SCREEN_REGISTRY;
