// Lookup tool specs (spec §5.6): the typed, versioned definition a tool runs from, drawn from a
// closed vocabulary of three templates. Pure and browser-safe — the Tools UI, the builder agent,
// the routes and the runtime all normalise, patch and validate through here. Nothing in a spec
// is code: the runtime (lib/engine/tool_runtime.js) interprets it.
import { IMAGE_LIMITS } from "./image_input.js";

export const TOOL_SCHEMA_VERSION = 1;
export const TOOL_TEMPLATES = ["find_similar", "classify", "answer_similar"];

export const TEMPLATE_INFO = {
  find_similar: {
    label: "Find similar",
    description: "Upload an image or describe something and get the most similar stored items.",
    icon: "Images",
  },
  classify: {
    label: "Classify",
    description: "Pick one label from a fixed set, backed by the stored items that look most alike.",
    icon: "Tags",
  },
  answer_similar: {
    label: "Answer from similar items",
    description: "Answer a question about an image or case from the most similar stored records, with citations.",
    icon: "MessageSquareQuote",
  },
};

export const TOOL_LIMITS = {
  nameChars: 80,
  descriptionChars: 500,
  labelsMin: 2,
  labelsMax: 20,
  labelChars: 60,
  labelDescriptionChars: 300,
  instructionsChars: 2000,
  textLabelChars: 60,
  textInputChars: 2000,
  topKMax: 20,
  kMax: 20,
  maxOutputTokensMin: 64,
  maxOutputTokensMax: 1500,
  maxLlmCallsMax: 2,
  monthlyRunLimitMax: 1_000_000,
};

export const INPUT_MODES = ["required", "optional", "off"];
export const SCOPE_MODALITIES = ["any", "image", "text"];
export const CLASSIFY_MODES = ["auto", "knn", "llm"];
export const SPEC_DEFAULTS = { topK: 8, minScore: 0.3, k: 7, minMargin: 0.15, maxOutputTokens: 600 };
// Output cap for the classify model call — the answer is one label, but reasoning models spend
// part of the budget thinking first.
export const CLASSIFY_MAX_OUTPUT_TOKENS = 1024;

const L = TOOL_LIMITS;
const SPEC_KEYS = ["schemaVersion", "template", "input", "scope", "search", "classify", "answer", "model", "budget"];
const PATCH_KEYS = ["name", "description", "template", "input", "scope", "search", "classify", "answer", "model", "budget"];

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isNumber = (value) => typeof value === "number" && Number.isFinite(value);
const isInt = (value) => Number.isInteger(value);
const pick = (value, list, fallback) => (list.includes(value) ? value : fallback);
const sameJson = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const formatCount = (n) => Number(n).toLocaleString("en-US");

function toNumber(value) {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function clampInt(value, min, max, fallback) {
  const n = toNumber(value);
  return n === null ? fallback : Math.min(max, Math.max(min, Math.round(n)));
}

function clampNumber(value, min, max, fallback) {
  const n = toNumber(value);
  return n === null ? fallback : Math.min(max, Math.max(min, n));
}

const cleanText = (value, max) => (typeof value === "string" ? value.trim().slice(0, max).trim() : "");

function cleanIds(value) {
  const ids = (Array.isArray(value) ? value : []).filter((id) => typeof id === "string").map((id) => id.trim());
  return [...new Set(ids.filter(Boolean))];
}

// Labels as [{ value, description }]: strings or objects accepted, trimmed, 1–60 characters,
// de-duplicated case-insensitively (first spelling wins), at most 20.
export function normalizeLabels(raw) {
  const labels = [];
  const seen = new Set();
  for (const item of Array.isArray(raw) ? raw : []) {
    const value = cleanText(typeof item === "string" ? item : (item?.value ?? item?.label), L.labelChars);
    if (!value || seen.has(value.toLowerCase())) continue;
    seen.add(value.toLowerCase());
    labels.push({ value, description: isObject(item) ? cleanText(item.description, L.labelDescriptionChars) : "" });
    if (labels.length >= L.labelsMax) break;
  }
  return labels;
}

function normalizeMonthlyLimit(value) {
  const n = toNumber(value);
  if (n === null || n < 1) return null;
  return Math.min(L.monthlyRunLimitMax, Math.round(n));
}

function normalizeModel(value) {
  if (!isObject(value) || typeof value.providerId !== "string" || !value.providerId.trim()) return null;
  const model = typeof value.model === "string" && value.model.trim() ? value.model.trim() : null;
  return { providerId: value.providerId.trim(), model };
}

// Template invariants: which sections exist and how many model calls a run may make.
function withInvariants(spec) {
  const next = { ...spec, budget: { ...spec.budget } };
  if (next.template === "find_similar") {
    next.classify = null;
    next.answer = null;
    next.budget.maxLlmCalls = 0;
  } else if (next.template === "classify") {
    next.answer = null;
    next.budget.maxLlmCalls = next.classify.mode === "knn" ? 0 : Math.max(1, next.budget.maxLlmCalls);
  } else {
    next.classify = null;
    next.budget.maxLlmCalls = Math.max(1, next.budget.maxLlmCalls);
  }
  return next;
}

/**
 * A fresh spec for `template` (unknown templates fall back to find_similar).
 *   find_similar   — image required, text off, image items only, no model calls
 *   classify       — image required, text off, mode auto, no labels yet, one model call allowed
 *   answer_similar — image optional, question text required, one model call
 */
export function defaultToolSpec(template, { kbIds = [] } = {}) {
  const t = pick(template, TOOL_TEMPLATES, "find_similar");
  const spec = {
    schemaVersion: TOOL_SCHEMA_VERSION,
    template: t,
    input: { image: "required", text: "off", textLabel: null },
    scope: { kbIds: cleanIds(kbIds), modality: t === "find_similar" ? "image" : "any" },
    search: { topK: SPEC_DEFAULTS.topK, minScore: SPEC_DEFAULTS.minScore },
    classify: null,
    answer: null,
    model: null,
    budget: { maxLlmCalls: t === "find_similar" ? 0 : 1, monthlyRunLimit: null },
  };
  if (t === "classify") {
    spec.classify = { labels: [], mode: "auto", k: SPEC_DEFAULTS.k, minMargin: SPEC_DEFAULTS.minMargin };
  }
  if (t === "answer_similar") {
    spec.input = { image: "optional", text: "required", textLabel: "Question" };
    spec.answer = { instructions: "", maxOutputTokens: SPEC_DEFAULTS.maxOutputTokens, includeImages: true };
  }
  return spec;
}

/**
 * Any value (null, junk, an older shape) -> a valid-shaped spec. Never throws: coerces types,
 * clamps numbers, falls back to the template's defaults for anything missing or unusable, dedupes
 * labels and forces the template invariants. It does not check the semantics validateToolSpec
 * reports (labels ≥ 2, knowledge bases chosen, at least one input on).
 */
export function normalizeToolSpec(raw) {
  const src = isObject(raw) ? raw : {};
  const template = pick(src.template, TOOL_TEMPLATES, "find_similar");
  const base = defaultToolSpec(template);
  const input = isObject(src.input) ? src.input : {};
  const scope = isObject(src.scope) ? src.scope : {};
  const search = isObject(src.search) ? src.search : {};
  const budget = isObject(src.budget) ? src.budget : {};

  const spec = {
    schemaVersion: TOOL_SCHEMA_VERSION,
    template,
    input: {
      image: pick(input.image, INPUT_MODES, base.input.image),
      text: pick(input.text, INPUT_MODES, base.input.text),
      textLabel: input.textLabel === undefined ? base.input.textLabel : cleanText(input.textLabel, L.textLabelChars) || null,
    },
    scope: {
      kbIds: cleanIds(scope.kbIds),
      modality: pick(scope.modality, SCOPE_MODALITIES, base.scope.modality),
    },
    search: {
      topK: clampInt(search.topK, 1, L.topKMax, SPEC_DEFAULTS.topK),
      minScore: clampNumber(search.minScore, 0, 1, SPEC_DEFAULTS.minScore),
    },
    classify: null,
    answer: null,
    model: normalizeModel(src.model),
    budget: {
      maxLlmCalls: clampInt(budget.maxLlmCalls, 0, L.maxLlmCallsMax, base.budget.maxLlmCalls),
      monthlyRunLimit: normalizeMonthlyLimit(budget.monthlyRunLimit),
    },
  };

  if (template === "classify") {
    const c = isObject(src.classify) ? src.classify : {};
    spec.classify = {
      labels: normalizeLabels(c.labels),
      mode: pick(c.mode, CLASSIFY_MODES, base.classify.mode),
      k: clampInt(c.k, 1, L.kMax, SPEC_DEFAULTS.k),
      minMargin: clampNumber(c.minMargin, 0, 1, SPEC_DEFAULTS.minMargin),
    };
  }
  if (template === "answer_similar") {
    const a = isObject(src.answer) ? src.answer : {};
    spec.answer = {
      instructions: typeof a.instructions === "string" ? a.instructions.trim().slice(0, L.instructionsChars) : "",
      maxOutputTokens: clampInt(a.maxOutputTokens, L.maxOutputTokensMin, L.maxOutputTokensMax, SPEC_DEFAULTS.maxOutputTokens),
      includeImages: a.includeImages !== false,
    };
  }
  return withInvariants(spec);
}

/**
 * Checks a spec before it is published or run. `kbIds` (optional) is the project's active
 * knowledge-base ids; every scope id must be one of them.
 * -> { ok, errors: [{ path, message }] }
 */
export function validateToolSpec(spec, { kbIds } = {}) {
  const errors = [];
  const add = (path, message) => errors.push({ path, message });
  if (!isObject(spec)) return { ok: false, errors: [{ path: "", message: "The tool has no settings yet." }] };

  const template = spec.template;
  if (!TOOL_TEMPLATES.includes(template)) add("template", "Choose a template: find similar, classify or answer from similar items.");

  const input = isObject(spec.input) ? spec.input : {};
  for (const key of ["image", "text"]) {
    if (!INPUT_MODES.includes(input[key])) add(`input.${key}`, `Set the ${key} input to required, optional or off.`);
  }
  if (input.image === "off" && input.text === "off") add("input", "Turn on image or text input — a tool needs at least one.");
  if (input.textLabel !== null && input.textLabel !== undefined) {
    if (typeof input.textLabel !== "string" || input.textLabel.trim().length > L.textLabelChars) {
      add("input.textLabel", `Keep the text field's label to ${L.textLabelChars} characters.`);
    }
  }

  const scope = isObject(spec.scope) ? spec.scope : {};
  const scopeIds = Array.isArray(scope.kbIds) ? scope.kbIds : [];
  if (!scopeIds.length) {
    add("scope.kbIds", "Choose at least one knowledge base to search.");
  } else if (Array.isArray(kbIds)) {
    const active = new Set(kbIds);
    const missing = scopeIds.filter((id) => !active.has(id)).length;
    if (missing) {
      add("scope.kbIds", missing === 1
        ? "One of the chosen knowledge bases no longer exists or is archived — remove it."
        : `${missing} of the chosen knowledge bases no longer exist or are archived — remove them.`);
    }
  }
  if (!SCOPE_MODALITIES.includes(scope.modality)) add("scope.modality", "Set which items to search: any, images or text.");

  const search = isObject(spec.search) ? spec.search : {};
  if (!isInt(search.topK) || search.topK < 1 || search.topK > L.topKMax) {
    add("search.topK", `Return between 1 and ${L.topKMax} similar items.`);
  }
  if (!isNumber(search.minScore) || search.minScore < 0 || search.minScore > 1) {
    add("search.minScore", "Set the minimum similarity between 0 and 1.");
  }

  if (template === "classify") validateClassify(spec.classify, add);
  if (template === "answer_similar") validateAnswer(spec.answer, add);

  if (spec.model !== null && spec.model !== undefined) {
    if (!isObject(spec.model) || typeof spec.model.providerId !== "string" || !spec.model.providerId.trim()) {
      add("model", "Choose a model provider, or use the project's processing model.");
    }
  }

  const budget = isObject(spec.budget) ? spec.budget : {};
  const calls = budget.maxLlmCalls;
  if (!isInt(calls) || calls < 0 || calls > L.maxLlmCallsMax) {
    add("budget.maxLlmCalls", `Allow between 0 and ${L.maxLlmCallsMax} model calls per run.`);
  } else if (template === "find_similar" && calls !== 0) {
    add("budget.maxLlmCalls", "Find similar tools make no model calls — set the model call budget to 0.");
  } else if (template === "classify" && spec.classify?.mode === "knn" && calls !== 0) {
    add("budget.maxLlmCalls", "Nearest-neighbour mode makes no model calls — set the model call budget to 0.");
  } else if (template === "classify" && ["auto", "llm"].includes(spec.classify?.mode) && calls < 1) {
    add("budget.maxLlmCalls", "This classify mode needs at least one model call per run.");
  } else if (template === "answer_similar" && calls < 1) {
    add("budget.maxLlmCalls", "Answering needs at least one model call per run.");
  }
  const limit = budget.monthlyRunLimit;
  if (limit !== null && limit !== undefined && (!isInt(limit) || limit < 1 || limit > L.monthlyRunLimitMax)) {
    add("budget.monthlyRunLimit", `Set the monthly run limit between 1 and ${formatCount(L.monthlyRunLimitMax)}, or remove it.`);
  }

  return { ok: errors.length === 0, errors };
}

function validateClassify(classify, add) {
  if (!isObject(classify)) {
    add("classify", "Add the labels this tool chooses from.");
    return;
  }
  const labels = Array.isArray(classify.labels) ? classify.labels : [];
  if (labels.length < L.labelsMin) add("classify.labels", `Add at least ${L.labelsMin} labels to choose from.`);
  if (labels.length > L.labelsMax) add("classify.labels", `Use at most ${L.labelsMax} labels.`);
  const seen = new Set();
  labels.forEach((label, i) => {
    const value = typeof label?.value === "string" ? label.value.trim() : "";
    if (!value || value.length > L.labelChars) {
      add(`classify.labels.${i}`, `Each label needs 1–${L.labelChars} characters.`);
    } else if (seen.has(value.toLowerCase())) {
      add(`classify.labels.${i}`, `"${value}" is listed twice.`);
    }
    seen.add(value.toLowerCase());
    if (typeof label?.description === "string" && label.description.length > L.labelDescriptionChars) {
      add(`classify.labels.${i}.description`, `Keep label descriptions to ${L.labelDescriptionChars} characters.`);
    }
  });
  if (!CLASSIFY_MODES.includes(classify.mode)) add("classify.mode", "Set how the label is decided: auto, knn or llm.");
  if (!isInt(classify.k) || classify.k < 1 || classify.k > L.kMax) {
    add("classify.k", `Let between 1 and ${L.kMax} neighbours vote.`);
  }
  if (!isNumber(classify.minMargin) || classify.minMargin < 0 || classify.minMargin > 1) {
    add("classify.minMargin", "Set the vote margin between 0 and 1.");
  }
}

function validateAnswer(answer, add) {
  if (!isObject(answer)) {
    add("answer", "Set up how the tool answers.");
    return;
  }
  if (typeof answer.instructions !== "string" || answer.instructions.length > L.instructionsChars) {
    add("answer.instructions", `Keep the answer instructions to ${formatCount(L.instructionsChars)} characters.`);
  }
  const max = answer.maxOutputTokens;
  if (!isInt(max) || max < L.maxOutputTokensMin || max > L.maxOutputTokensMax) {
    add("answer.maxOutputTokens", `Set the answer length between ${L.maxOutputTokensMin} and ${formatCount(L.maxOutputTokensMax)} tokens.`);
  }
}

// --- applyToolPatch -------------------------------------------------------------------------

const ok = (value) => ({ value });
const fail = (message) => ({ error: message });

const enumRule = (list, message) => (value) => (list.includes(value) ? ok(value) : fail(message));
const intRule = (min, max, message) => (value) => (isInt(value) && value >= min && value <= max ? ok(value) : fail(message));
const numberRule = (min, max, message) => (value) => (isNumber(value) && value >= min && value <= max ? ok(value) : fail(message));

// Labels replace the whole list. Bad entries are reported and dropped; the rest apply.
function labelsRule(value, path) {
  if (!Array.isArray(value)) return fail("Send the labels as a list.");
  const errors = [];
  const valid = [];
  value.forEach((item, i) => {
    const raw = typeof item === "string" ? item : isObject(item) ? item.value : null;
    const label = typeof raw === "string" ? raw.trim() : "";
    if (!label || label.length > L.labelChars) {
      errors.push({ path: `${path}.${i}`, message: `Each label needs 1–${L.labelChars} characters.` });
      return;
    }
    const description = isObject(item) && typeof item.description === "string" ? item.description.trim() : "";
    if (description.length > L.labelDescriptionChars) {
      errors.push({ path: `${path}.${i}.description`, message: `Keep label descriptions to ${L.labelDescriptionChars} characters.` });
      return;
    }
    valid.push({ value: label, description });
  });
  if (new Set(valid.map((label) => label.value.toLowerCase())).size > L.labelsMax) {
    errors.push({ path, message: `Use at most ${L.labelsMax} labels — only the first ${L.labelsMax} were kept.` });
  }
  return { value: valid, errors };
}

const FIELD_RULES = {
  input: {
    image: enumRule(INPUT_MODES, "Set the image input to required, optional or off."),
    text: enumRule(INPUT_MODES, "Set the text input to required, optional or off."),
    textLabel: (value) =>
      value === null || (typeof value === "string" && value.trim().length <= L.textLabelChars)
        ? ok(value === null ? null : value.trim() || null)
        : fail(`Keep the text field's label to ${L.textLabelChars} characters.`),
  },
  scope: {
    kbIds: (value) =>
      Array.isArray(value) && value.every((id) => typeof id === "string")
        ? ok(value)
        : fail("Send the knowledge base ids as a list."),
    modality: enumRule(SCOPE_MODALITIES, "Set which items to search: any, image or text."),
  },
  search: {
    topK: intRule(1, L.topKMax, `Return between 1 and ${L.topKMax} similar items.`),
    minScore: numberRule(0, 1, "Set the minimum similarity between 0 and 1."),
  },
  classify: {
    labels: labelsRule,
    mode: enumRule(CLASSIFY_MODES, "Set how the label is decided: auto, knn or llm."),
    k: intRule(1, L.kMax, `Let between 1 and ${L.kMax} neighbours vote.`),
    minMargin: numberRule(0, 1, "Set the vote margin between 0 and 1."),
  },
  answer: {
    instructions: (value) =>
      typeof value === "string" && value.trim().length <= L.instructionsChars
        ? ok(value.trim())
        : fail(`Keep the answer instructions to ${formatCount(L.instructionsChars)} characters.`),
    maxOutputTokens: intRule(
      L.maxOutputTokensMin,
      L.maxOutputTokensMax,
      `Set the answer length between ${L.maxOutputTokensMin} and ${formatCount(L.maxOutputTokensMax)} tokens.`,
    ),
    includeImages: (value) => (typeof value === "boolean" ? ok(value) : fail("Set includeImages to true or false.")),
  },
  model: {
    providerId: (value) =>
      typeof value === "string" && value.trim() ? ok(value.trim()) : fail("Choose a model provider."),
    model: (value) =>
      value === null || typeof value === "string" ? ok(value === null ? null : value.trim() || null) : fail("Send the model id as text."),
  },
  budget: {
    maxLlmCalls: intRule(0, L.maxLlmCallsMax, `Allow between 0 and ${L.maxLlmCallsMax} model calls per run.`),
    monthlyRunLimit: (value) =>
      value === null || (isInt(value) && value >= 1 && value <= L.monthlyRunLimitMax)
        ? ok(value)
        : fail(`Set the monthly run limit between 1 and ${formatCount(L.monthlyRunLimitMax)}, or null for none.`),
  },
};

// Dotted paths that differ between two normalised specs ("template", "input.image", "classify", …).
function diffSpecs(before, after) {
  const changed = [];
  for (const key of SPEC_KEYS) {
    const a = before[key];
    const b = after[key];
    if (isObject(a) && isObject(b)) {
      for (const field of new Set([...Object.keys(a), ...Object.keys(b)])) {
        if (!sameJson(a[field], b[field])) changed.push(`${key}.${field}`);
      }
    } else if (!sameJson(a, b)) {
      changed.push(key);
    }
  }
  return changed;
}

// A template switch keeps what carries over (knowledge bases, search settings, model, monthly
// limit) and takes the new template's defaults for everything else.
function switchTemplate(spec, template) {
  const fresh = defaultToolSpec(template, { kbIds: spec.scope.kbIds });
  return {
    ...fresh,
    scope: { ...spec.scope },
    search: { ...spec.search },
    model: spec.model,
    budget: { ...fresh.budget, monthlyRunLimit: spec.budget.monthlyRunLimit },
  };
}

/**
 * Applies a builder or form edit. `patch` keys (all optional): name, description (tool-row
 * fields, returned in `meta` — never stored in the spec), template, input, scope, search,
 * classify, answer, model, budget. Section objects are merged field by field; invalid or unknown
 * keys are reported in `errors` and skipped while the valid ones still apply; the result is
 * normalised. `model: null` returns to the project's processing model.
 * -> { spec, meta: { name?, description? }, changed: string[], errors: [{ path, message }] }
 */
export function applyToolPatch(spec, patch) {
  const before = normalizeToolSpec(spec);
  const meta = {};
  const errors = [];
  const add = (path, message) => errors.push({ path, message });
  if (!isObject(patch)) {
    return { spec: before, meta, changed: [], errors: [{ path: "", message: "Send the changes as an object." }] };
  }

  for (const key of Object.keys(patch)) {
    if (!PATCH_KEYS.includes(key)) add(key, `Unknown setting "${key}".`);
  }

  if ("name" in patch) {
    const name = typeof patch.name === "string" ? patch.name.trim() : "";
    if (name && name.length <= L.nameChars) meta.name = name;
    else add("name", `Give the tool a name of 1–${L.nameChars} characters.`);
  }
  if ("description" in patch) {
    if (patch.description === null) meta.description = "";
    else if (typeof patch.description === "string" && patch.description.trim().length <= L.descriptionChars) {
      meta.description = patch.description.trim();
    } else add("description", `Keep the description to ${L.descriptionChars} characters.`);
  }

  let next = before;
  if ("template" in patch) {
    if (!TOOL_TEMPLATES.includes(patch.template)) {
      add("template", "Choose a template: find_similar, classify or answer_similar.");
    } else if (patch.template !== before.template) {
      next = switchTemplate(before, patch.template);
    }
  }

  for (const section of ["input", "scope", "search", "classify", "answer", "model", "budget"]) {
    if (!(section in patch)) continue;
    const value = patch[section];
    if (section === "model" && value === null) {
      next = { ...next, model: null };
      continue;
    }
    if (section === "classify" && next.template !== "classify") {
      add(section, "Only classify tools have labels.");
      continue;
    }
    if (section === "answer" && next.template !== "answer_similar") {
      add(section, "Only answer-from-similar-items tools have answer settings.");
      continue;
    }
    if (!isObject(value)) {
      add(section, `Send ${section} as an object of the settings to change.`);
      continue;
    }
    const merged = { ...(next[section] || {}) };
    for (const [field, fieldValue] of Object.entries(value)) {
      const rule = FIELD_RULES[section][field];
      const path = `${section}.${field}`;
      if (!rule) {
        add(path, `Unknown setting "${path}".`);
        continue;
      }
      const result = rule(fieldValue, path);
      if (result.error) add(path, result.error);
      for (const error of result.errors || []) errors.push(error);
      if ("value" in result) merged[field] = result.value;
    }
    if (section === "model" && !merged.providerId) {
      add("model.providerId", "Choose a model provider for the model.");
      continue;
    }
    next = { ...next, [section]: merged };
  }

  const after = normalizeToolSpec(next);
  const changed = [
    ...("name" in meta ? ["name"] : []),
    ...("description" in meta ? ["description"] : []),
    ...diffSpecs(before, after),
  ];
  return { spec: after, meta, changed, errors };
}

// --- Summaries, cost and input --------------------------------------------------------------

function kbName(kbNames, id) {
  if (kbNames instanceof Map) return kbNames.get(id);
  if (Array.isArray(kbNames)) return kbNames.find((kb) => kb?.id === id)?.name;
  if (isObject(kbNames)) return kbNames[id];
  return undefined;
}

function describeInput(input) {
  const parts = [];
  if (input.image !== "off") parts.push(`image ${input.image}`);
  if (input.text !== "off") parts.push(`${input.textLabel ? `text "${input.textLabel}"` : "text"} ${input.text}`);
  return parts.length ? parts.join(", ") : "none";
}

const MODALITY_NOTE = { image: " (images only)", text: " (text items only)", any: "" };

function describeDecision(classify) {
  const vote = `a vote of the ${classify.k} closest labelled items (margin ${classify.minMargin})`;
  if (classify.mode === "knn") return `Decides by ${vote}; no model calls.`;
  if (classify.mode === "llm") return `The model decides, with the ${classify.k} closest labelled items as evidence.`;
  return `Decides by ${vote}; the model decides when the vote is unclear.`;
}

/** Short multi-line description of a spec (builder context, publish dialog). */
export function summarizeToolSpec(spec, { kbNames } = {}) {
  const s = normalizeToolSpec(spec);
  const info = TEMPLATE_INFO[s.template];
  const kbs = s.scope.kbIds.map((id) => kbName(kbNames, id) || "Unknown knowledge base");
  const lines = [
    `${info.label}: ${info.description}`,
    `Input: ${describeInput(s.input)}.`,
    `Searches: ${kbs.length ? kbs.join(", ") : "no knowledge bases chosen"}${MODALITY_NOTE[s.scope.modality]}.`,
    `Returns up to ${s.search.topK} similar items (minimum similarity ${s.search.minScore}).`,
  ];
  if (s.classify) {
    const labels = s.classify.labels.map((l) => l.value);
    lines.push(labels.length ? `Labels (${labels.length}): ${labels.join(", ")}.` : "Labels: none yet.");
    lines.push(describeDecision(s.classify));
  }
  if (s.answer) {
    lines.push(`Answers in up to ${formatCount(s.answer.maxOutputTokens)} tokens${s.answer.includeImages ? ", looking at reference images" : ""}.`);
    const instructions = s.answer.instructions.replace(/\s+/g, " ").trim();
    lines.push(instructions
      ? `Owner instructions: "${instructions.length > 160 ? `${instructions.slice(0, 159).trimEnd()}…` : instructions}"`
      : "Owner instructions: none.");
  }
  if (s.budget.maxLlmCalls > 0) {
    lines.push(`Model: ${s.model ? `${s.model.model || "provider default"} (tool's own provider)` : "project processing model"}; up to ${s.budget.maxLlmCalls} model call${s.budget.maxLlmCalls === 1 ? "" : "s"} per run.`);
  }
  lines.push(s.budget.monthlyRunLimit ? `Monthly run limit: ${formatCount(s.budget.monthlyRunLimit)}.` : "No monthly run limit.");
  return lines.join("\n");
}

/**
 * What one run can cost in calls: query embeddings (one per input kind that's on) and model
 * calls (classify and answer make at most one each, bounded by the budget).
 * -> { embedCalls: 0|1|2, llmCalls: { min, max }, maxOutputTokens }
 */
export function estimateRunCost(spec) {
  const s = normalizeToolSpec(spec);
  const embedCalls = (s.input.image !== "off" ? 1 : 0) + (s.input.text !== "off" ? 1 : 0);
  const allowed = Math.min(1, s.budget.maxLlmCalls);
  let llmCalls = { min: 0, max: 0 };
  let maxOutputTokens = 0;
  if (s.template === "classify" && s.classify.mode !== "knn" && allowed) {
    llmCalls = { min: s.classify.mode === "llm" ? allowed : 0, max: allowed };
    maxOutputTokens = CLASSIFY_MAX_OUTPUT_TOKENS;
  } else if (s.template === "answer_similar") {
    // No call when nothing similar enough was found.
    llmCalls = { min: 0, max: allowed };
    maxOutputTokens = s.answer.maxOutputTokens;
  }
  return { embedCalls, llmCalls, maxOutputTokens };
}

/** JSON Schema for a run's input ({ text?, image? }), honouring required / optional / off. */
export function toolInputJsonSchema(spec) {
  const s = normalizeToolSpec(spec);
  const properties = {};
  const required = [];
  if (s.input.text !== "off") {
    properties.text = {
      type: "string",
      ...(s.input.text === "required" ? { minLength: 1 } : {}),
      maxLength: L.textInputChars,
      description: s.input.textLabel || (s.template === "answer_similar" ? "The question to answer." : "Text describing the item."),
    };
    if (s.input.text === "required") required.push("text");
  }
  if (s.input.image !== "off") {
    const types = IMAGE_LIMITS.mimeTypes.map((type) => type.replace("image/", "").toUpperCase()).join(", ");
    properties.image = {
      type: "object",
      description: `An image (${types}), at most ${Math.round(IMAGE_LIMITS.maxBytes / (1024 * 1024))} MB and ${IMAGE_LIMITS.maxSide} px on the long side.`,
      properties: {
        data: { type: "string", description: "Base64-encoded image bytes, or a data: URI." },
        mimeType: { type: "string", enum: [...IMAGE_LIMITS.mimeTypes] },
      },
      required: ["data"],
      additionalProperties: false,
    };
    if (s.input.image === "required") required.push("image");
  }
  return { type: "object", properties, required, additionalProperties: false };
}

const inputError = (code, message) => ({ ok: false, input: { text: null, imageRaw: null }, code, message });

/**
 * Checks a run's raw input against the spec's input rules (required / optional / off, text
 * length). The image itself is validated later by parseImageInput.
 * -> { ok: true, input: { text: string|null, imageRaw: { data, mimeType? }|null } } | { ok: false, input, code, message }
 */
export function normalizeToolInput(spec, raw) {
  const s = normalizeToolSpec(spec);
  const src = isObject(raw) ? raw : {};
  const label = s.input.textLabel || "text";

  let text = null;
  if (src.text !== null && src.text !== undefined) {
    if (typeof src.text !== "string") return inputError("invalid_input", "Text input must be a string.");
    text = src.text.trim() || null;
  }
  let imageRaw = null;
  if (src.image !== null && src.image !== undefined && src.image !== "") {
    if (typeof src.image === "string") imageRaw = { data: src.image };
    else if (isObject(src.image) && typeof src.image.data === "string") {
      imageRaw = src.image.data ? { data: src.image.data, ...(typeof src.image.mimeType === "string" ? { mimeType: src.image.mimeType } : {}) } : null;
    } else return inputError("invalid_input", "Send the image as { data, mimeType } with base64 data.");
  }

  if (text && s.input.text === "off") return inputError("text_not_accepted", "This tool doesn't take text input.");
  if (imageRaw && s.input.image === "off") return inputError("image_not_accepted", "This tool doesn't take an image.");
  if (text && text.length > L.textInputChars) {
    return inputError("text_too_long", `Keep the ${label.toLowerCase()} to ${formatCount(L.textInputChars)} characters.`);
  }
  if (!imageRaw && s.input.image === "required") return inputError("image_required", "Add an image.");
  if (!text && s.input.text === "required") return inputError("text_required", `Enter the ${label.toLowerCase()}.`);
  if (!text && !imageRaw) {
    return inputError("input_required", s.input.image === "off" ? `Enter the ${label.toLowerCase()}.` : s.input.text === "off" ? "Add an image." : "Add an image or enter text.");
  }
  return { ok: true, input: { text, imageRaw } };
}
