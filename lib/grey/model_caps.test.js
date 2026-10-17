import { test } from "node:test";
import assert from "node:assert/strict";
import { isTemperatureRejection, supportsTemperature } from "./model_caps.js";

test("current Claude models reject temperature", () => {
  for (const id of ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-sonnet-5", "claude-opus-4-7", "claude-opus-4-8", "Claude-Haiku-5"]) {
    assert.equal(supportsTemperature("anthropic", id), false, id);
  }
  assert.equal(supportsTemperature("openrouter", "anthropic/claude-sonnet-5-5"), false);
});

test("OpenAI reasoning models reject temperature", () => {
  for (const id of ["gpt-5", "gpt-5-mini", "gpt-5.1", "o1", "o3", "o4-mini"]) {
    assert.equal(supportsTemperature("openai", id), false, id);
  }
  assert.equal(supportsTemperature("openrouter", "openai/gpt-5"), false);
});

test("older and unknown models keep temperature", () => {
  for (const [kind, id] of [
    ["anthropic", "claude-sonnet-4-5"],
    ["anthropic", "claude-haiku-4-5-20251001"],
    ["openai", "gpt-4.1"],
    ["openai", "gpt-4o-mini"],
    ["google", "gemini-3-pro"],
    ["openai_compatible", "llama-3.3-70b-versatile"],
    ["openai", ""],
  ]) {
    assert.equal(supportsTemperature(kind, id), true, id);
  }
});

test("detects a 400 that names temperature", () => {
  assert.equal(isTemperatureRejection({ statusCode: 400, message: "temperature is not supported with this model" }), true);
  assert.equal(isTemperatureRejection({ statusCode: 400, responseBody: '{"error":"`temperature` is deprecated"}' }), true);
  assert.equal(isTemperatureRejection({ lastError: { statusCode: 400, message: "Unsupported value: 'temperature'" } }), true);
  assert.equal(isTemperatureRejection({ statusCode: 400, message: "max_tokens too large" }), false);
  assert.equal(isTemperatureRejection({ statusCode: 500, message: "temperature" }), false);
  assert.equal(isTemperatureRejection(null), false);
});
