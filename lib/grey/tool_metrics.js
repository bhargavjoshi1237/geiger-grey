// Lookup tool test metrics (spec §5.7). Pure. The leave-one-out runner (lib/engine/tool_tests.js)
// produces the cases; these turn them into the report the Tests section shows.

const round = (n) => Math.round(n * 10000) / 10000;
const share = (part, whole) => (whole > 0 ? round(part / whole) : null);
const lower = (value) => String(value ?? "").trim().toLowerCase();

function labelList(labels) {
  const list = [];
  const seen = new Set();
  for (const item of Array.isArray(labels) ? labels : []) {
    const value = String(typeof item === "string" ? item : (item?.value ?? "")).trim();
    if (value && !seen.has(value.toLowerCase())) {
      seen.add(value.toLowerCase());
      list.push(value);
    }
  }
  return list;
}

/**
 * cases: [{ expected: string[], predicted: string|null }] (null = uncertain); labels: the tool's
 * labels (strings or { value }). Labels match case-insensitively and report in the tool's spelling.
 * A case is correct when the prediction is one of its expected labels. The confusion row is the
 * matched expected label, else the first expected one.
 * -> { total, decided, correct, accuracy, coverage, confusion: { [expected]: { [predicted|"uncertain"]: n } },
 *      perLabel: [{ label, support, precision, recall }] }
 */
export function classificationReport(cases, labels) {
  const canonical = new Map(labelList(labels).map((label) => [label.toLowerCase(), label]));
  const spell = (value) => canonical.get(lower(value)) ?? String(value ?? "").trim();
  const list = (Array.isArray(cases) ? cases : []).map((c) => ({
    expected: [...new Set((Array.isArray(c?.expected) ? c.expected : []).map(spell).filter(Boolean))],
    predicted: c?.predicted === null || c?.predicted === undefined || c?.predicted === "" ? null : spell(c.predicted),
  }));

  const confusion = {};
  let decided = 0;
  let correct = 0;
  for (const c of list) {
    const hit = c.predicted !== null && c.expected.includes(c.predicted);
    if (c.predicted !== null) decided += 1;
    if (hit) correct += 1;
    const row = hit ? c.predicted : (c.expected[0] ?? "unlabelled");
    const column = c.predicted ?? "uncertain";
    confusion[row] ||= {};
    confusion[row][column] = (confusion[row][column] || 0) + 1;
  }

  const perLabel = [...canonical.values()].map((label) => {
    const support = list.filter((c) => c.expected.includes(label)).length;
    const predicted = list.filter((c) => c.predicted === label).length;
    const truePositives = list.filter((c) => c.predicted === label && c.expected.includes(label)).length;
    return { label, support, precision: share(truePositives, predicted), recall: share(truePositives, support) };
  });

  return {
    total: list.length,
    decided,
    correct,
    accuracy: share(correct, list.length),
    coverage: share(decided, list.length),
    confusion,
    perLabel,
  };
}

/**
 * cases: [{ expected: string[], neighbors: string[][] }] — the labels of each returned neighbour,
 * in rank order. A hit is a neighbour sharing at least one expected label (case-insensitive).
 * -> { total, hitAtK, mrr } — hitAtK is the share of cases with a hit, mrr the mean reciprocal
 * rank of the first hit (0 for a case without one). Both are null when there are no cases.
 */
export function retrievalReport(cases) {
  const list = Array.isArray(cases) ? cases : [];
  let hits = 0;
  let reciprocal = 0;
  for (const c of list) {
    const expected = new Set((Array.isArray(c?.expected) ? c.expected : []).map(lower).filter(Boolean));
    const neighbors = Array.isArray(c?.neighbors) ? c.neighbors : [];
    const rank = neighbors.findIndex((labels) => (Array.isArray(labels) ? labels : []).some((label) => expected.has(lower(label))));
    if (rank >= 0) {
      hits += 1;
      reciprocal += 1 / (rank + 1);
    }
  }
  return { total: list.length, hitAtK: share(hits, list.length), mrr: share(reciprocal, list.length) };
}
