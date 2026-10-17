import { test } from "node:test";
import assert from "node:assert/strict";
import { SSE_DONE, createEventStream, encodeSseData, encodeSseEvent, sseResponse } from "./sse.js";

test("data and named-event framing", () => {
  assert.equal(encodeSseData({ a: 1 }), 'data: {"a":1}\n\n');
  assert.equal(encodeSseEvent("delta", { text: "line1\nline2" }), 'event: delta\ndata: {"text":"line1\\nline2"}\n\n');
  assert.equal(SSE_DONE, "data: [DONE]\n\n");
});

test("createEventStream writes frames then closes", async () => {
  const stream = createEventStream(async (write) => {
    assert.equal(write(encodeSseData({ n: 1 })), true);
    write(SSE_DONE);
  });
  const text = await new Response(stream).text();
  assert.equal(text, 'data: {"n":1}\n\ndata: [DONE]\n\n');
});

test("a failing producer still closes the stream", async () => {
  const original = console.error;
  console.error = () => {};
  try {
    const stream = createEventStream(async (write) => {
      write("data: 1\n\n");
      throw new Error("boom");
    });
    assert.equal(await new Response(stream).text(), "data: 1\n\n");
  } finally {
    console.error = original;
  }
});

test("cancel reaches onCancel and later writes report false", async () => {
  let cancelled = false;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let laterWrite;
  const stream = createEventStream(
    async (write) => {
      await gate;
      laterWrite = write("data: late\n\n");
    },
    { onCancel: () => (cancelled = true) },
  );
  await stream.cancel("bye");
  release();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(cancelled, true);
  assert.equal(laterWrite, false);
});

test("sseResponse sets streaming headers", () => {
  const res = sseResponse("x", { "X-Test": "1" });
  assert.equal(res.headers.get("content-type"), "text/event-stream; charset=utf-8");
  assert.equal(res.headers.get("cache-control"), "no-cache, no-transform");
  assert.equal(res.headers.get("x-accel-buffering"), "no");
  assert.equal(res.headers.get("x-test"), "1");
});
