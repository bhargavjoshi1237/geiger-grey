import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  IMAGE_LIMITS,
  NEAR_DUPLICATE_BITS,
  hammingHex,
  imageDimensions,
  parseImageInput,
  sniffImageType,
  thumbnailPath,
  toDataUri,
} from "./image_input.js";

// Hand-built headers — just enough bytes for sniffing and dimensions.
const bytes = (...parts) => Uint8Array.from(parts.flat());
const text = (s) => [...s].map((c) => c.charCodeAt(0));
const u16le = (n) => [n & 0xff, (n >> 8) & 0xff];
const u16be = (n) => [(n >> 8) & 0xff, n & 0xff];
const u24le = (n) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff];
const u32be = (n) => [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];

const png = (w, h) => bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], u32be(13), text("IHDR"), u32be(w), u32be(h), [8, 2, 0, 0, 0], [0, 0, 0, 0]);
// APP0, a DHT (C4 — in the SOF range but not a frame), a fill byte, then SOF2.
const jpeg = (w, h) =>
  bytes(
    [0xff, 0xd8],
    [0xff, 0xe0], u16be(16), text("JFIF"), [0, 1, 1, 0, 0, 1, 0, 1, 0, 0],
    [0xff, 0xc4], u16be(4), [0, 0],
    [0xff, 0xff, 0xc2], u16be(17), [8], u16be(h), u16be(w), [3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1],
  );
const riff = (chunk, payload) => bytes(text("RIFF"), [0, 0, 0, 0], text("WEBP"), text(chunk), u24le(payload.length), [0], payload);
const webpLossy = (w, h) => riff("VP8 ", [0, 0, 0, 0x9d, 0x01, 0x2a, ...u16le(w), ...u16le(h)]);
const webpLossless = (w, h) => {
  const bits = (w - 1) | ((h - 1) << 14);
  return riff("VP8L", [0x2f, bits & 0xff, (bits >> 8) & 0xff, (bits >> 16) & 0xff, (bits >>> 24) & 0xff]);
};
const webpExtended = (w, h) => riff("VP8X", [0x10, 0, 0, 0, ...u24le(w - 1), ...u24le(h - 1)]);
const gif = (w, h) => bytes(text("GIF89a"), u16le(w), u16le(h), [0, 0, 0]);

const base64 = (b) => btoa(String.fromCharCode(...b));

test("sniffs the real type from magic bytes", () => {
  assert.equal(sniffImageType(png(1, 1)), "image/png");
  assert.equal(sniffImageType(jpeg(1, 1)), "image/jpeg");
  assert.equal(sniffImageType(webpLossy(1, 1)), "image/webp");
  assert.equal(sniffImageType(gif(1, 1)), "image/gif");
  assert.equal(sniffImageType(bytes(text("RIFF"), [0, 0, 0, 0], text("WAVE"))), null);
  assert.equal(sniffImageType(bytes(text("%PDF-1.4"))), null);
  assert.equal(sniffImageType(new Uint8Array()), null);
  assert.equal(sniffImageType("not bytes"), null);
});

test("reads dimensions for every supported header", () => {
  assert.deepEqual(imageDimensions(png(640, 480)), { width: 640, height: 480 });
  assert.deepEqual(imageDimensions(jpeg(1024, 768), "image/jpeg"), { width: 1024, height: 768 });
  assert.deepEqual(imageDimensions(webpLossy(300, 200)), { width: 300, height: 200 });
  assert.deepEqual(imageDimensions(webpLossless(16383, 9)), { width: 16383, height: 9 });
  assert.deepEqual(imageDimensions(webpLossless(1, 1)), { width: 1, height: 1 });
  assert.deepEqual(imageDimensions(webpExtended(5000, 70000)), { width: 5000, height: 70000 });
  assert.deepEqual(imageDimensions(gif(12, 34)), { width: 12, height: 34 });
});

test("unreadable or truncated headers have no dimensions", () => {
  assert.equal(imageDimensions(png(640, 480).subarray(0, 20)), null);
  assert.equal(imageDimensions(png(0, 480)), null);
  assert.equal(imageDimensions(bytes([0xff, 0xd8, 0xff, 0xda, 0, 2])), null); // scan before any frame header
  assert.equal(imageDimensions(jpeg(10, 10).subarray(0, 30)), null);
  assert.equal(imageDimensions(riff("VP8 ", [0, 0, 0, 1, 2, 3, 0, 0, 0, 0])), null); // bad start code
  assert.equal(imageDimensions(bytes([1, 2, 3])), null);
});

test("parseImageInput accepts bare base64 and data URIs, typed by the bytes", () => {
  const b = png(800, 600);
  const bare = parseImageInput({ data: base64(b) });
  assert.equal(bare.ok, true);
  assert.equal(bare.image.mimeType, "image/png");
  assert.equal(bare.image.width, 800);
  assert.equal(bare.image.height, 600);
  assert.equal(bare.image.byteLength, b.length);
  assert.equal(bare.image.data, base64(b));
  assert.deepEqual([...bare.image.bytes], [...b]);

  // A mismatching declared type is ignored.
  const uri = parseImageInput({ data: `data:image/jpeg;base64,${base64(b)}`, mimeType: "image/webp" });
  assert.equal(uri.ok, true);
  assert.equal(uri.image.mimeType, "image/png");
  assert.equal(uri.image.data, base64(b));

  // Line-wrapped and unpadded base64 is canonicalised.
  const wrapped = base64(jpeg(10, 20)).replace(/=+$/, "").replace(/(.{8})/g, "$1\n");
  const parsed = parseImageInput({ data: wrapped });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.image.mimeType, "image/jpeg");
  assert.equal(parsed.image.data, base64(jpeg(10, 20)));
  assert.equal(parseImageInput(base64(webpLossy(2, 3))).image.mimeType, "image/webp");
});

test("parseImageInput rejects with stable codes", () => {
  const code = (value) => parseImageInput(value).code;
  assert.equal(code(null), "invalid_image");
  assert.equal(code({ data: "" }), "invalid_image");
  assert.equal(code({ data: "not base64!" }), "invalid_image");
  assert.equal(code({ data: "data:image/png,rawtext" }), "invalid_image");
  assert.equal(code({ data: base64(png(10, 10).subarray(0, 12)) }), "invalid_image");
  assert.equal(code({ data: base64(gif(10, 10)) }), "unsupported_image_type");
  assert.equal(code({ data: base64(bytes(text("hello world"))) }), "unsupported_image_type");
  assert.equal(code({ data: base64(png(IMAGE_LIMITS.maxSide + 1, 10)) }), "image_dimensions_too_large");
  assert.equal(code({ data: base64(webpExtended(10, IMAGE_LIMITS.maxSide + 1)) }), "image_dimensions_too_large");
  assert.equal(parseImageInput({ data: base64(png(IMAGE_LIMITS.maxSide, IMAGE_LIMITS.maxSide)) }).ok, true);
  // The size is checked before decoding.
  assert.equal(code({ data: "A".repeat(Math.ceil((IMAGE_LIMITS.maxBytes * 4) / 3) + 8) }), "image_too_large");
  const rejected = parseImageInput({ data: base64(gif(1, 1)) });
  assert.equal(rejected.ok, false);
  assert.equal(typeof rejected.message, "string");
});

test("hammingHex counts differing bits", () => {
  assert.equal(hammingHex("0f0f0f0f0f0f0f0f", "0f0f0f0f0f0f0f0f"), 0);
  assert.equal(hammingHex("0", "f"), 4);
  assert.equal(hammingHex("00ff", "ff00"), 16);
  assert.equal(hammingHex("ABCD", "abcd"), 0);
  assert.equal(hammingHex("0000000000000000", "0000000000000007"), 3);
  assert.ok(hammingHex("0000000000000000", "000000000000003f") <= NEAR_DUPLICATE_BITS);
  assert.equal(hammingHex("00", "000"), null);
  assert.equal(hammingHex("zz", "00"), null);
  assert.equal(hammingHex(null, "00"), null);
  assert.equal(hammingHex("", ""), null);
});

test("paths and data URIs", () => {
  assert.equal(thumbnailPath({ projectId: "p1", kbId: "k1", sourceId: "s1" }), "p1/k1/s1/.thumb.jpg");
  assert.equal(toDataUri({ data: "AAAA", mimeType: "image/png" }), "data:image/png;base64,AAAA");
});

test("stays browser-safe (no Buffer)", () => {
  const source = readFileSync(new URL("./image_input.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\bBuffer\b/);
  assert.doesNotMatch(source, /^import /m);
});
