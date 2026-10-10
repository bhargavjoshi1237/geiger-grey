// Client-side entity duplicate detection: normalized-name/alias overlap within the same type.
const CORPORATE_SUFFIXES = new Set(["inc", "ltd", "llc", "corp", "co"]);

// Lowercase, strip diacritics/punctuation, collapse spaces, drop a trailing corporate suffix.
export function normalizeName(name) {
  if (!name) return "";
  const stripped = String(name)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = stripped.split(" ").filter(Boolean);
  while (words.length > 1 && CORPORATE_SUFFIXES.has(words[words.length - 1])) {
    words.pop();
  }
  return words.join(" ");
}

// Two entities match when they share a typeId and either their normalized names are equal,
// or one's normalized name appears among the other's normalized aliases.
function entitiesMatch(a, b) {
  if (a.typeId !== b.typeId) return false;
  const nameA = normalizeName(a.name);
  const nameB = normalizeName(b.name);
  if (nameA && nameA === nameB) return true;
  const aliasesA = new Set((a.aliases || []).map(normalizeName));
  const aliasesB = new Set((b.aliases || []).map(normalizeName));
  if (nameB && aliasesA.has(nameB)) return true;
  if (nameA && aliasesB.has(nameA)) return true;
  return false;
}

// Groups entities (size >= 2) that are likely duplicates, via union-find over pairwise matches.
// Merged entities (mergedInto set) are excluded entirely.
export function findDuplicateGroups(entities) {
  const active = (entities || []).filter((e) => !e.mergedInto);
  const parent = new Map(active.map((e) => [e.id, e.id]));

  function find(id) {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root);
    let cur = id;
    while (parent.get(cur) !== root) {
      const next = parent.get(cur);
      parent.set(cur, root);
      cur = next;
    }
    return root;
  }

  function union(a, b) {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent.set(rootA, rootB);
  }

  for (let i = 0; i < active.length; i += 1) {
    for (let j = i + 1; j < active.length; j += 1) {
      if (entitiesMatch(active[i], active[j])) union(active[i].id, active[j].id);
    }
  }

  const groups = new Map();
  for (const entity of active) {
    const root = find(entity.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(entity);
  }

  return [...groups.values()].filter((group) => group.length >= 2);
}
