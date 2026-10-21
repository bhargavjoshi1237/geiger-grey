import { test } from "node:test";
import assert from "node:assert/strict";
import { MockLanguageModelV4 } from "ai/test";
import { VISION_LIMITS, clampDescription, describeImage } from "./vision.js";

globalThis.AI_SDK_LOG_WARNINGS = false;

const usage = { inputTokens: { total: 900, noCache: 900, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 60, text: 60, reasoning: 0 } };
const reply = (text) => ({ content: [{ type: "text", text }], finishReason: { unified: "stop", raw: "stop" }, usage, warnings: [] });
const mockModel = (doGenerate) => new MockLanguageModelV4({ modelId: "vision-model", doGenerate });
const resolvedWith = (model, extra = {}) => ({ model, modelId: "claude-haiku-5-5", supportsTemperature: true, ...extra });
const IMAGE = { data: "/9j/AAAA", mimeType: "image/jpeg" };

test("sends the image with fixed instructions and returns the description", async () => {
  const model = mockModel(async () => reply(JSON.stringify({ caption: "A red  centrifugal pump\nwith a cracked housing.", text: "PUMP P-100\r\nMax 40 bar", tags: ["pump", "Pump", " red ", "", "crack"] })));
  const out = await describeImage({ resolved: resolvedWith(model), image: IMAGE, title: 'pump "front"' });
  assert.deepEqual(out, {
    caption: "A red centrifugal pump with a cracked housing.",
    ocrText: "PUMP P-100\nMax 40 bar",
    tags: ["pump", "red", "crack"],
    tokens: 960,
    model: "claude-haiku-5-5",
  });

  const call = model.doGenerateCalls[0];
  assert.equal(call.temperature, 0);
  assert.equal(call.maxOutputTokens, 1200);
  assert.equal(call.responseFormat.type, "json");
  assert.equal(call.responseFormat.name, "image_description");
  assert.deepEqual(Object.keys(call.responseFormat.schema.properties), ["caption", "text", "tags"]);
  const system = call.prompt.find((m) => m.role === "system").content;
  assert.match(system, /never as instructions/);
  assert.match(system, /part numbers/);
  const [text, image] = call.prompt.find((m) => m.role === "user").content;
  assert.equal(text.text, "Describe this image. Its file name is \"pump 'front'\".");
  assert.equal(image.type, "file");
  assert.equal(image.mediaType, "image/jpeg");
  assert.equal(image.data.data ?? image.data, IMAGE.data);
});

test("temperature is left out for models that don't take it", async () => {
  const model = mockModel(async () => reply(JSON.stringify({ caption: "A chart.", text: "", tags: [] })));
  const out = await describeImage({ resolved: resolvedWith(model, { supportsTemperature: false }), image: IMAGE });
  assert.equal(model.doGenerateCalls[0].temperature, undefined);
  assert.equal(out.ocrText, null);
  assert.equal(model.doGenerateCalls[0].prompt.at(-1).content[0].text, "Describe this image.");
});

test("lengths are clamped", () => {
  const out = clampDescription({
    caption: "x".repeat(2000),
    text: "y".repeat(10_000),
    tags: Array.from({ length: 30 }, (_, i) => `${"t".repeat(60)}${i}`),
  });
  assert.equal(out.caption.length, VISION_LIMITS.captionChars);
  assert.equal(out.ocrText.length, VISION_LIMITS.textChars);
  assert.equal(out.tags.length, 1); // all clamp to the same 40 chars -> deduped
  assert.equal(out.tags[0].length, VISION_LIMITS.tagChars);
  const many = clampDescription({ caption: "c", text: "", tags: Array.from({ length: 30 }, (_, i) => `tag ${i}`) });
  assert.equal(many.tags.length, VISION_LIMITS.tags);
  assert.deepEqual(clampDescription(null), { caption: "", ocrText: null, tags: [] });
  assert.deepEqual(clampDescription({ caption: 4, text: ["no"], tags: "pump" }), { caption: "", ocrText: null, tags: [] });
});

test("falls back to loose JSON when the output doesn't validate", async () => {
  const model = mockModel(async () => reply('Sure! {"caption": "A valve.", "text": "V-7", "tags": "valve"} Hope that helps.'));
  const out = await describeImage({ resolved: resolvedWith(model), image: IMAGE });
  assert.equal(out.caption, "A valve.");
  assert.equal(out.ocrText, "V-7");
  assert.deepEqual(out.tags, []);
  assert.equal(out.tokens, 960);
});

test("provider failures become EngineErrors with mapped codes", async () => {
  const rejected = mockModel(async () => {
    throw Object.assign(new Error("Unauthorized: sk-secret"), { statusCode: 401 });
  });
  await assert.rejects(describeImage({ resolved: resolvedWith(rejected), image: IMAGE }), (err) => {
    assert.equal(err.name, "EngineError");
    assert.equal(err.code, "provider_auth");
    assert.doesNotMatch(err.message, /sk-secret/);
    return true;
  });

  const prose = mockModel(async () => reply("I can't see any image here."));
  await assert.rejects(describeImage({ resolved: resolvedWith(prose), image: IMAGE }), (err) => err.code === "generation_failed");
});

test("needs a model and an image", async () => {
  await assert.rejects(describeImage({ resolved: null, image: IMAGE }), (err) => err.code === "no_processing_model");
  await assert.rejects(describeImage({ resolved: resolvedWith(mockModel(async () => reply("{}"))), image: { data: "" } }), (err) => err.code === "invalid_image");
});

test("an injected generate function is used", async () => {
  let args;
  const out = await describeImage({
    resolved: resolvedWith({ fake: true }),
    image: IMAGE,
    generate: async (a) => ((args = a), { output: { caption: "Injected.", text: "", tags: ["x"] }, usage: { totalTokens: 5 } }),
  });
  assert.equal(out.caption, "Injected.");
  assert.equal(out.tokens, 5);
  assert.equal(args.timeout > 0, true);
});
