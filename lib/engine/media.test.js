import { test } from "node:test";
import assert from "node:assert/strict";
import { inProjectFolder, signStoragePaths, withThumbnails } from "./media.js";
import { OTHER_PROJECT, PROJECT, uuid } from "./test_helpers.js";

const KB = uuid(1);
const thumb = (n, project = PROJECT) => `${project}/${KB}/${uuid(n)}/.thumb.jpg`;

// storage.from(bucket).createSignedUrls stand-in. `respond(paths)` overrides the default answer
// (every path signed as https://storage.test/<path>).
function fakeStorage(respond) {
  const calls = [];
  const admin = {
    storage: {
      from(bucket) {
        return {
          async createSignedUrls(paths, seconds) {
            calls.push({ bucket, paths, seconds });
            if (respond) return respond(paths);
            return {
              data: paths.map((path) => ({ path, error: null, signedURL: `/sign/${path}`, signedUrl: `https://storage.test/${path}` })),
              error: null,
            };
          },
        };
      },
    },
  };
  return { admin, calls };
}

test("inProjectFolder keeps paths inside the project folder without dot segments", () => {
  assert.equal(inProjectFolder(thumb(1), PROJECT), true);
  assert.equal(inProjectFolder(`${PROJECT}/${KB}/src/photo.final.jpg`, PROJECT), true);
  for (const path of [
    thumb(1, OTHER_PROJECT),
    `${PROJECT}/../${OTHER_PROJECT}/a.jpg`,
    `${PROJECT}/${KB}/./a.jpg`,
    `${PROJECT}/${KB}/..`,
    `${PROJECT}`,
    `${PROJECT}x/a.jpg`,
    `x/${PROJECT}/a.jpg`,
    "",
    null,
    42,
  ]) {
    assert.equal(inProjectFolder(path, PROJECT), false, String(path));
  }
  assert.equal(inProjectFolder(thumb(1), ""), false);
  assert.equal(inProjectFolder(thumb(1), null), false);
});

test("signStoragePaths signs only project paths, once each, in one request", async () => {
  const { admin, calls } = fakeStorage();
  const urls = await signStoragePaths({
    admin,
    projectId: PROJECT,
    paths: [thumb(1), thumb(1), thumb(2), thumb(3, OTHER_PROJECT), `${PROJECT}/../${OTHER_PROJECT}/x.jpg`, null, undefined, 7],
  });
  assert.deepEqual(calls, [{ bucket: "grey-sources", paths: [thumb(1), thumb(2)], seconds: 3600 }]);
  assert.ok(urls instanceof Map);
  assert.deepEqual([...urls.entries()], [
    [thumb(1), `https://storage.test/${thumb(1)}`],
    [thumb(2), `https://storage.test/${thumb(2)}`],
  ]);
});

test("signStoragePaths passes the expiry and skips paths the bucket couldn't sign", async () => {
  const { admin, calls } = fakeStorage((paths) => ({
    data: [
      { path: paths[0], error: "Either the object does not exist or you do not have access to it", signedURL: null, signedUrl: null },
      { path: paths[1], error: null, signedURL: "/sign/b", signedUrl: "https://storage.test/b" },
      { path: thumb(9, OTHER_PROJECT), error: null, signedURL: "/sign/x", signedUrl: "https://storage.test/x" },
    ],
    error: null,
  }));
  const urls = await signStoragePaths({ admin, projectId: PROJECT, paths: [thumb(1), thumb(2)], seconds: 600 });
  assert.equal(calls[0].seconds, 600);
  assert.deepEqual([...urls.entries()], [[thumb(2), "https://storage.test/b"]], "only requested, signed paths");

  const fallback = fakeStorage();
  await signStoragePaths({ admin: fallback.admin, projectId: PROJECT, paths: [thumb(1)], seconds: "soon" });
  assert.equal(fallback.calls[0].seconds, 3600);
});

test("signStoragePaths never throws and makes no request without signable paths", async (t) => {
  const logged = t.mock.method(console, "error", () => {});
  const failed = fakeStorage(() => ({ data: null, error: { message: "storage down" } }));
  assert.equal((await signStoragePaths({ admin: failed.admin, projectId: PROJECT, paths: [thumb(1)] })).size, 0);

  const threw = fakeStorage(() => {
    throw new Error("network");
  });
  assert.equal((await signStoragePaths({ admin: threw.admin, projectId: PROJECT, paths: [thumb(1)] })).size, 0);
  assert.equal(logged.mock.callCount(), 2);

  const idle = fakeStorage();
  assert.equal((await signStoragePaths({ admin: idle.admin, projectId: PROJECT, paths: [thumb(1, OTHER_PROJECT)] })).size, 0);
  assert.equal((await signStoragePaths({ admin: idle.admin, projectId: PROJECT, paths: "not-an-array" })).size, 0);
  assert.equal((await signStoragePaths({ admin: idle.admin, projectId: null, paths: [thumb(1)] })).size, 0);
  assert.equal((await signStoragePaths({ admin: null, projectId: PROJECT, paths: [thumb(1)] })).size, 0);
  assert.equal(idle.calls.length, 0);
});

test("withThumbnails adds thumbnailUrl from image.thumbPath (null when missing)", async () => {
  const { admin, calls } = fakeStorage();
  const items = [
    { sourceId: "a", image: { thumbPath: thumb(1), width: 10 } },
    { sourceId: "b", image: null },
    { sourceId: "c" },
    { sourceId: "d", image: { thumbPath: thumb(4, OTHER_PROJECT) } },
    { sourceId: "e", image: { thumbPath: thumb(1) } },
  ];
  const out = await withThumbnails({ admin, projectId: PROJECT, items, seconds: 600 });
  assert.deepEqual(calls, [{ bucket: "grey-sources", paths: [thumb(1)], seconds: 600 }]);
  assert.deepEqual(out.map((item) => [item.sourceId, item.thumbnailUrl]), [
    ["a", `https://storage.test/${thumb(1)}`],
    ["b", null],
    ["c", null],
    ["d", null],
    ["e", `https://storage.test/${thumb(1)}`],
  ]);
  assert.deepEqual(out[0].image, { thumbPath: thumb(1), width: 10 }, "other fields are kept");
  assert.equal(items[0].thumbnailUrl, undefined, "the input is not mutated");
  assert.deepEqual(await withThumbnails({ admin, projectId: PROJECT, items: null }), []);
});
