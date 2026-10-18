// Pure aggregation helpers for the Overview dashboard: weekly buckets, rolling
// windows, period-over-period deltas and rates. No React, no Supabase.

const DAY_MS = 86400000;

// Monday 00:00 (local) of the week containing `date`.
export function startOfWeek(date) {
  const d = new Date(date);
  const day = (d.getDay() + 6) % 7;
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - day);
  return d;
}

// `count` week starts, oldest first, ending with the week containing `now`.
export function buildWeeklyBuckets(count, now = Date.now()) {
  const end = startOfWeek(now);
  const buckets = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const start = new Date(end);
    start.setDate(start.getDate() - i * 7);
    buckets.push(start);
  }
  return buckets;
}

export function weekLabel(date) {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// Sums valueFn(row) into the week each row's `dateKey` falls in. Rows before
// the first bucket (or with an unparseable date) are dropped.
export function bucketWeekly(rows, buckets, dateKey, valueFn = () => 1) {
  const totals = buckets.map(() => 0);
  for (const row of rows) {
    const t = new Date(row[dateKey]).getTime();
    if (!Number.isFinite(t)) continue;
    for (let i = buckets.length - 1; i >= 0; i -= 1) {
      if (t >= buckets[i].getTime()) {
        totals[i] += valueFn(row);
        break;
      }
    }
  }
  return totals;
}

// Sum of valueFn(row) for rows whose `dateKey` is in [startMs, endMs).
export function sumInWindow(rows, dateKey, valueFn, startMs, endMs = Infinity) {
  let total = 0;
  for (const row of rows) {
    const t = new Date(row[dateKey]).getTime();
    if (Number.isFinite(t) && t >= startMs && t < endMs) total += valueFn(row);
  }
  return total;
}

// Start of the current `days`-long window and of the equal window before it.
export function periodWindows(now, days) {
  const curStart = now - days * DAY_MS;
  return { curStart, prevStart: curStart - days * DAY_MS };
}

// "+12%" / "-3%" vs the previous period; no delta when there's nothing to compare against.
export function periodDelta(current, previous) {
  if (previous <= 0) return { delta: null, trend: "up" };
  const pct = Math.round(((current - previous) / previous) * 100);
  return { delta: `${pct >= 0 ? "+" : ""}${pct}%`, trend: pct >= 0 ? "up" : "down" };
}

// Whole-number percentage of `part` in `whole`, clamped to 0..100.
export function ratePct(part, whole) {
  return whole > 0 ? Math.max(0, Math.min(100, Math.round((part / whole) * 100))) : 0;
}

// Empty scope means "everything".
export function filterByScope(rows, scope, key) {
  return scope.length ? rows.filter((r) => scope.includes(r[key])) : rows;
}

// "growing" | "steady" | "declining" | "idle" — volume this period vs the last.
export function trafficTrend(current, previous) {
  if (current === 0 && previous === 0) return "idle";
  if (previous === 0) return "growing";
  const change = (current - previous) / previous;
  if (change >= 0.1) return "growing";
  if (change <= -0.1) return "declining";
  return "steady";
}
