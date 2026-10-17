// Server-Sent Events helpers for the streaming delivery routes (OpenAI-compatible chat,
// widget chat). No next/* or @/ imports, so the encoders are testable under node --test.

export const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  "X-Accel-Buffering": "no",
};

export const SSE_DONE = "data: [DONE]\n\n";

// JSON.stringify never emits raw newlines, so each payload is a single `data:` line.
export function encodeSseData(data) {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export function encodeSseEvent(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

// A byte stream driven by `run(write)`. `write(text)` returns false once the client has gone;
// the stream closes when `run` settles. `onCancel` fires when the client disconnects.
export function createEventStream(run, { onCancel } = {}) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      let open = true;
      const write = (text) => {
        if (!open) return false;
        try {
          controller.enqueue(encoder.encode(text));
          return true;
        } catch {
          open = false;
          return false;
        }
      };
      try {
        await run(write);
      } catch (error) {
        console.error("[lib/server/sse.run]", error?.message || error);
      } finally {
        open = false;
        try {
          controller.close();
        } catch {
          // already closed by a disconnected client
        }
      }
    },
    cancel(reason) {
      onCancel?.(reason);
    },
  });
}

export function sseResponse(body, headers = {}) {
  return new Response(body, { status: 200, headers: { ...SSE_HEADERS, ...headers } });
}
