import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bucketWeekly,
  buildWeeklyBuckets,
  filterByScope,
  periodDelta,
  periodWindows,
  ratePct,
  startOfWeek,
  sumInWindow,
  trafficTrend,
} from "./overview_metrics.js";

test("startOfWeek lands on Monday midnight", () => {
  const d = startOfWeek(new Date(2026, 9, 18, 15, 30)); // Sun 18 Oct 2026
  assert.equal(d.getDay(), 1);
  assert.equal(d.getDate(), 12);
  assert.equal(d.getHours(), 0);
});

test("buildWeeklyBuckets is oldest first and ends on the current week", () => {
  const now = new Date(2026, 9, 14).getTime(); // Wed
  const buckets = buildWeeklyBuckets(3, now);
  assert.deepEqual(
    buckets.map((b) => b.getDate()),
    [28, 5, 12],
  );
});

test("bucketWeekly sums into the right week and drops older rows", () => {
  const buckets = buildWeeklyBuckets(2, new Date(2026, 9, 14).getTime());
  const rows = [
    { at: new Date(2026, 9, 1).toISOString(), n: 9 }, // before the first bucket
    { at: new Date(2026, 9, 6).toISOString(), n: 2 },
    { at: new Date(2026, 9, 13).toISOString(), n: 3 },
    { at: new Date(2026, 9, 14).toISOString(), n: 4 },
    { at: "not a date", n: 100 },
  ];
  assert.deepEqual(bucketWeekly(rows, buckets, "at", (r) => r.n), [2, 7]);
  assert.deepEqual(bucketWeekly(rows, buckets, "at"), [1, 2]);
});

test("sumInWindow is start-inclusive and end-exclusive", () => {
  const rows = [{ t: 10 }, { t: 20 }, { t: 30 }].map((r) => ({ at: new Date(r.t).toISOString() }));
  assert.equal(sumInWindow(rows, "at", () => 1, 10, 30), 2);
  assert.equal(sumInWindow(rows, "at", () => 1, 10), 3);
});

test("periodWindows splits back-to-back windows", () => {
  const day = 86400000;
  assert.deepEqual(periodWindows(100 * day, 30), { curStart: 70 * day, prevStart: 40 * day });
});

test("periodDelta", () => {
  assert.deepEqual(periodDelta(12, 10), { delta: "+20%", trend: "up" });
  assert.deepEqual(periodDelta(5, 10), { delta: "-50%", trend: "down" });
  assert.deepEqual(periodDelta(10, 10), { delta: "+0%", trend: "up" });
  assert.deepEqual(periodDelta(4, 0), { delta: null, trend: "up" });
});

test("ratePct clamps and handles an empty whole", () => {
  assert.equal(ratePct(1, 3), 33);
  assert.equal(ratePct(5, 4), 100);
  assert.equal(ratePct(3, 0), 0);
});

test("filterByScope treats an empty scope as everything", () => {
  const rows = [{ k: "a" }, { k: "b" }];
  assert.equal(filterByScope(rows, [], "k"), rows);
  assert.deepEqual(filterByScope(rows, ["b"], "k"), [{ k: "b" }]);
});

test("trafficTrend", () => {
  assert.equal(trafficTrend(0, 0), "idle");
  assert.equal(trafficTrend(3, 0), "growing");
  assert.equal(trafficTrend(11, 10), "growing");
  assert.equal(trafficTrend(10, 10), "steady");
  assert.equal(trafficTrend(9, 10), "declining");
  assert.equal(trafficTrend(0, 4), "declining");
});
