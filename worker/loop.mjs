// Queue loop (spec §5.2–5.4): wakes on LISTEN grey_jobs and on a poll timer, keeps at most
// `concurrency` jobs in flight across queues (round-robin), heartbeats each job's lease and
// aborts it through its AbortController when the heartbeat says it was cancelled or lost.
// stop() stops claiming, drains for up to 25 s, then aborts what's left with reason 'shutdown'
// (each queue releases those jobs back to 'queued' without counting the attempt).
import { errorFields } from "./log.mjs";

export class JobAbort extends Error {
  constructor(code) {
    super(`Job aborted: ${code}`);
    this.name = "AbortError";
    this.code = code;
  }
}

// heartbeat status -> abort reason code
export function abortCodeFor(status) {
  if (status === "cancelled") return "cancelled";
  if (status === "source_deleted") return "source_deleted";
  return "lease_lost";
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms).unref?.());

export function createLoop({
  queues,
  concurrency = 2,
  pollMs = 5000,
  heartbeatMs = 30_000,
  log,
  listen = null, // async (onNotify) => stop()
  janitor = null, // { intervalMs, run: async () => void }
  now = Date.now,
}) {
  const active = new Map();
  let stopping = false;
  let started = false;
  let lastTickAt = 0;
  let ticking = false;
  let again = false;
  let scheduled = false;
  let cursor = 0;
  const timers = [];
  let unlisten = null;

  function schedule() {
    if (stopping || scheduled) return;
    scheduled = true;
    setImmediate(() => {
      scheduled = false;
      tick();
    });
  }

  async function claimNext() {
    for (let i = 0; i < queues.length; i += 1) {
      const index = (cursor + i) % queues.length;
      const queue = queues[index];
      let job = null;
      try {
        job = await queue.claim();
      } catch (err) {
        log.error({ queue: queue.name, ...errorFields(err) }, "claim failed");
        continue;
      }
      if (stopping) {
        // Claimed while shutting down: hand it straight back.
        if (job) await queue.release?.(job, "shutdown").catch(() => {});
        return false;
      }
      if (job) {
        cursor = (index + 1) % queues.length;
        start(queue, job);
        return true;
      }
    }
    return false;
  }

  async function tick() {
    if (ticking) {
      again = true;
      return;
    }
    ticking = true;
    try {
      do {
        again = false;
        lastTickAt = now();
        while (!stopping && active.size < concurrency) {
          if (!(await claimNext())) break;
        }
      } while (again && !stopping);
    } finally {
      ticking = false;
    }
  }

  async function beat(entry) {
    if (entry.beating || entry.controller.signal.aborted) return;
    entry.beating = true;
    try {
      const status = await entry.queue.heartbeat(entry.job);
      entry.lastBeatAt = now();
      if (status !== "running") {
        const code = abortCodeFor(status);
        log.info({ queue: entry.queue.name, jobId: entry.job.id, status, code }, "job aborted by heartbeat");
        entry.controller.abort(new JobAbort(code));
      }
    } catch (err) {
      log.warn({ queue: entry.queue.name, jobId: entry.job.id, ...errorFields(err) }, "heartbeat failed");
      // Without a successful heartbeat for a whole lease, another worker may own the job now.
      if (entry.queue.leaseMs && now() - entry.lastBeatAt > entry.queue.leaseMs) {
        entry.controller.abort(new JobAbort("lease_lost"));
      }
    } finally {
      entry.beating = false;
    }
  }

  function start(queue, job) {
    const key = `${queue.name}:${job.id}`;
    const controller = new AbortController();
    const entry = { queue, job, controller, lastBeatAt: now(), beating: false, timer: null, promise: null };
    if (queue.heartbeat) {
      entry.timer = setInterval(() => beat(entry), heartbeatMs);
      entry.timer.unref?.();
    }
    active.set(key, entry);
    entry.promise = Promise.resolve()
      .then(() => queue.run(job, { signal: controller.signal }))
      .catch((err) => log.error({ queue: queue.name, jobId: job.id, ...errorFields(err) }, "job runner threw"))
      .finally(() => {
        clearInterval(entry.timer);
        active.delete(key);
        schedule();
      });
  }

  return {
    async start() {
      if (started) return;
      started = true;
      const poll = setInterval(schedule, pollMs);
      poll.unref?.();
      timers.push(poll);
      if (janitor?.run) {
        const sweep = async () => {
          try {
            await janitor.run();
          } catch (err) {
            log.warn(errorFields(err), "janitor failed");
          }
        };
        const t = setInterval(sweep, janitor.intervalMs || 600_000);
        t.unref?.();
        timers.push(t);
        sweep();
      }
      if (listen) {
        try {
          unlisten = await listen(() => schedule());
        } catch (err) {
          log.warn(errorFields(err), "LISTEN unavailable — polling only");
        }
      }
      schedule();
    },

    async stop({ drainMs = 25_000, releaseMs = 10_000 } = {}) {
      stopping = true;
      for (const t of timers.splice(0)) clearInterval(t);
      try {
        await unlisten?.();
      } catch {
        // the listener connection may already be gone
      }
      const pending = () => Promise.allSettled([...active.values()].map((e) => e.promise));
      if (active.size) {
        log.info({ active: active.size }, "draining");
        await Promise.race([pending(), sleep(drainMs)]);
      }
      if (active.size) {
        log.warn({ active: active.size }, "drain timed out — releasing jobs");
        for (const entry of active.values()) entry.controller.abort(new JobAbort("shutdown"));
        await Promise.race([pending(), sleep(releaseMs)]);
      }
    },

    health() {
      return { lastTickAt, active: active.size, stopping };
    },

    // test hook
    tick,
  };
}

// LISTEN with automatic reconnect. connect() -> a fresh, unconnected pg.Client.
export function createPgListener({ connect, channel = "grey_jobs", log, minBackoffMs = 1000, maxBackoffMs = 30_000 }) {
  return async function listen(onNotify) {
    let client = null;
    let closed = false;
    let backoff = minBackoffMs;
    let timer = null;

    const reconnect = () => {
      if (closed || timer) return;
      timer = setTimeout(() => {
        timer = null;
        open();
      }, backoff);
      timer.unref?.();
      backoff = Math.min(backoff * 2, maxBackoffMs);
    };

    async function open() {
      if (closed) return;
      const next = connect();
      let dropped = false;
      const drop = () => {
        if (dropped) return;
        dropped = true;
        next.removeAllListeners("notification");
        if (client === next) client = null;
        next.end().catch(() => {});
        reconnect();
      };
      next.on("error", (err) => {
        log.warn(errorFields(err), "listener connection error");
        drop();
      });
      next.on("end", () => {
        if (!closed) drop();
      });
      next.on("notification", (msg) => {
        if (msg.channel === channel) onNotify(msg.payload);
      });
      try {
        await next.connect();
        await next.query(`listen ${channel}`);
        client = next;
        backoff = minBackoffMs;
        onNotify(null); // catch up on anything queued while disconnected
      } catch (err) {
        log.warn(errorFields(err), "listener connect failed");
        drop();
      }
    }

    await open();
    return async () => {
      closed = true;
      clearTimeout(timer);
      if (client) await client.end().catch(() => {});
    };
  };
}
