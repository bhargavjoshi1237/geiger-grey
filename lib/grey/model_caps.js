// Known-model capability table (spec §8.1). Pure. Current Claude models (the 4.7+
// and 5.x families) and OpenAI reasoning models reject a non-default temperature
// with a 400, so callers omit sampling params when supportsTemperature() is false.

// "anthropic/claude-sonnet-5" (OpenRouter-style) -> "claude-sonnet-5".
function normalizeModelId(modelId) {
  const id = String(modelId || "").trim().toLowerCase();
  const slash = id.lastIndexOf("/");
  return slash === -1 ? id : id.slice(slash + 1);
}

const NO_TEMPERATURE = [
  /^claude-[a-z]+-5/, // claude-opus-5-5, claude-sonnet-5, claude-haiku-5-5 …
  /^claude-[a-z]+-4-[7-9]/, // claude-opus-4-7, claude-opus-4-8 …
  /^gpt-5/, // gpt-5, gpt-5-mini, gpt-5.1 …
  /^o\d/, // o1, o3, o4-mini …
];

// providerKind is accepted for future per-provider rules; today model ids decide.
export function supportsTemperature(providerKind, modelId) {
  const id = normalizeModelId(modelId);
  if (!id) return true;
  return !NO_TEMPERATURE.some((re) => re.test(id));
}

// A provider 400 that names `temperature` — callers retry once without sampling
// params for models this table doesn't know yet.
export function isTemperatureRejection(err) {
  const status = err?.statusCode ?? err?.status ?? err?.lastError?.statusCode;
  if (status !== 400) return false;
  const text = `${err?.message || ""} ${err?.responseBody || ""} ${err?.lastError?.message || ""}`;
  return /temperature/i.test(text);
}
