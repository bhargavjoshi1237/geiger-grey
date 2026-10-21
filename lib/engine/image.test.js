import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { dhash, normalizeImage } from "./image.js";
import { NEAR_DUPLICATE_BITS, hammingHex, imageDimensions, sniffImageType } from "../grey/image_input.js";

const solid = (width, height, background = "#3366cc", channels = 3) => sharp({ create: { width, height, channels, background } });

// A horizontal brightness ramp (left -> right brighter, or reversed).
function ramp(width, height, { reverse = false } = {}) {
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const v = Math.round((255 * (reverse ? width - 1 - x : x)) / (width - 1));
      pixels.fill(v, (y * width + x) * 3, (y * width + x) * 3 + 3);
    }
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } });
}

// Deterministic blocky pattern: enough structure for a meaningful dHash.
function blocks(width, height, seed = 7) {
  const pixels = Buffer.alloc(width * height * 3);
  let state = seed;
  const cells = [];
  for (let i = 0; i < 64; i += 1) {
    state = (state * 1103515245 + 12345) % 2 ** 31;
    cells.push(state % 256);
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const v = cells[Math.floor((y * 8) / height) * 8 + Math.floor((x * 8) / width)];
      pixels.fill(v, (y * width + x) * 3, (y * width + x) * 3 + 3);
    }
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } });
}

const isJpeg = (bytes) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;

test("fits inside maxSide whatever the orientation, never enlarging, as JPEG", async () => {
  const wide = await normalizeImage(await solid(3000, 1000).jpeg().toBuffer());
  assert.deepEqual([wide.image.width, wide.image.height], [1280, 427]);
  assert.equal(wide.image.mimeType, "image/jpeg");
  assert.ok(isJpeg(wide.image.bytes));
  assert.equal(wide.image.data, wide.image.bytes.toString("base64"));
  assert.deepEqual(wide.source, { width: 3000, height: 1000, format: "jpeg" });

  const tall = await normalizeImage(await solid(1000, 3000).png().toBuffer());
  assert.deepEqual([tall.image.width, tall.image.height], [427, 1280]);
  assert.equal(tall.source.format, "png");

  const small = await normalizeImage(await solid(200, 100).webp().toBuffer());
  assert.deepEqual([small.image.width, small.image.height], [200, 100]);
  assert.deepEqual([small.thumbnail.width, small.thumbnail.height], [200, 100]);

  const custom = await normalizeImage(await solid(500, 500).png().toBuffer(), { maxSide: 256, thumbSide: 64 });
  assert.deepEqual([custom.image.width, custom.image.height], [256, 256]);
  assert.deepEqual([custom.thumbnail.width, custom.thumbnail.height], [64, 64]);
});

test("makes a JPEG thumbnail inside thumbSide", async () => {
  const out = await normalizeImage(await solid(2000, 1500).jpeg().toBuffer());
  assert.equal(out.thumbnail.mimeType, "image/jpeg");
  assert.ok(isJpeg(out.thumbnail.bytes));
  assert.deepEqual([out.thumbnail.width, out.thumbnail.height], [384, 288]);
  assert.ok(out.thumbnail.bytes.length < out.image.bytes.length);
});

test("applies EXIF orientation and strips metadata", async () => {
  // Stored 3000×1000 with "rotate 90°" in EXIF: displayed (and normalised) as 1000×3000.
  const rotated = await solid(3000, 1000).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  assert.equal((await sharp(rotated).metadata()).orientation, 6);
  const out = await normalizeImage(rotated);
  assert.deepEqual([out.image.width, out.image.height], [427, 1280]);
  assert.deepEqual([out.source.width, out.source.height], [1000, 3000]);
  const meta = await sharp(out.image.bytes).metadata();
  assert.equal(meta.orientation, undefined);
  assert.equal(meta.exif, undefined);
});

test("flattens transparency onto white", async () => {
  const transparent = await solid(50, 50, { r: 0, g: 0, b: 0, alpha: 0 }, 4).png().toBuffer();
  const out = await normalizeImage(transparent);
  const { data, info } = await sharp(out.image.bytes).raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.channels, 3);
  assert.ok(data[0] > 245 && data[1] > 245 && data[2] > 245);
});

test("dHash: 16 hex chars, stable, direction-sensitive, robust to re-encoding", async () => {
  const left = await dhash(await ramp(90, 80).png().toBuffer());
  const right = await dhash(await ramp(90, 80, { reverse: true }).png().toBuffer());
  assert.match(left, /^[0-9a-f]{16}$/);
  assert.equal(left, "0000000000000000");
  assert.equal(right, "ffffffffffffffff");

  const original = await blocks(640, 480).png().toBuffer();
  const a = await dhash(original);
  assert.equal(await dhash(original), a);
  const reencoded = await sharp(original).resize(320).jpeg({ quality: 60 }).toBuffer();
  assert.ok(hammingHex(a, await dhash(reencoded)) <= NEAR_DUPLICATE_BITS);
  const other = await dhash(await blocks(640, 480, 99).png().toBuffer());
  assert.ok(hammingHex(a, other) > NEAR_DUPLICATE_BITS);

  const normalized = await normalizeImage(original);
  assert.equal(normalized.dhash, a);
});

test("undecodable bytes are invalid_image (422)", async () => {
  const check = (err) => err.name === "EngineError" && err.code === "invalid_image" && err.status === 422;
  await assert.rejects(normalizeImage(Buffer.from("definitely not an image")), check);
  await assert.rejects(normalizeImage(new Uint8Array()), check);
  await assert.rejects(dhash(Buffer.from([0xff, 0xd8, 0xff, 0x00])), check);
  const truncated = (await solid(100, 100).png().toBuffer()).subarray(0, 40);
  await assert.rejects(normalizeImage(truncated), check);
});

test("accepts a plain Uint8Array", async () => {
  const buffer = await solid(64, 32).png().toBuffer();
  const out = await normalizeImage(new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength));
  assert.deepEqual([out.image.width, out.image.height], [64, 32]);
});

test("image_input reads the headers sharp writes", async () => {
  const cases = [
    ["image/png", await solid(321, 123).png().toBuffer()],
    ["image/jpeg", await solid(321, 123).jpeg().toBuffer()],
    ["image/jpeg", await solid(321, 123).jpeg({ progressive: true }).toBuffer()],
    ["image/webp", await solid(321, 123).webp().toBuffer()],
    ["image/webp", await solid(321, 123).webp({ lossless: true }).toBuffer()],
    ["image/webp", await solid(321, 123, { r: 1, g: 2, b: 3, alpha: 0.5 }, 4).webp().toBuffer()],
    ["image/gif", await solid(321, 123).gif().toBuffer()],
  ];
  for (const [mime, bytes] of cases) {
    assert.equal(sniffImageType(bytes), mime);
    assert.deepEqual(imageDimensions(bytes), { width: 321, height: 123 }, mime);
  }
});
