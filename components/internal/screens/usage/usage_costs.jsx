"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Gauge, Loader2, Save } from "lucide-react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  useBanner,
} from "@geiger/ui";

import { MainScreenWrapper } from "@/components/internal/shared/screen_wrappers";
import {
  ScreenHeader,
  StatGrid,
  SectionCard,
  EmptyState,
  Field,
} from "@/components/internal/shared/screen_kit";
import { Button } from "@geiger/ui/button";
import { Badge } from "@geiger/ui/badge";
import { Input } from "@geiger/ui/input";
import { Progress } from "@geiger/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@geiger/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@geiger/ui/select";
import { LoadingArea } from "@geiger/ui";
import { TagInput } from "@/components/internal/shared/tag_input";
import { useProject } from "@/context/project-context";
import { useCan } from "@/context/rbac-context";
import { listUsageEvents } from "@/lib/supabase/usage";
import { getProjectSettings, saveProjectSettings } from "@/lib/supabase/project_settings";
import { formatCurrency, formatNumber } from "@/lib/grey/format";
import { CAP_BEHAVIOR_HINT, CAP_BEHAVIOR_OPTIONS, USAGE_KIND_META } from "./constants";

const DAYS = 30;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Only the first 5 kinds get their own chart colour (the suite only defines
// --chart-1..5); anything beyond that folds into a single grey "Other" series
// instead of recycling a colour and reading as a second, confusing band.
const CHART_KIND_META = USAGE_KIND_META.slice(0, 5);
const CHART_KIND_KEYS = new Set(CHART_KIND_META.map((k) => k.key));
const OTHER_KIND_COLOR = "var(--muted-foreground)";

// Local-calendar-day bucketing (not UTC) — "today" and day boundaries follow
// the viewer's own clock, matching how the MTD/7d windows elsewhere are built.
function localDayKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function dayLabel(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function startOfLocalDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function buildDays(count) {
  const out = [];
  const today = startOfLocalDay(new Date());
  for (let i = count - 1; i >= 0; i -= 1) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    out.push(localDayKey(d));
  }
  return out;
}

function monthKeyOf(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

// Per project+month, so dismissing this month's warning doesn't silence next
// month's, and a different project never inherits another's dismissal.
function dismissStorageKey(projectId, date) {
  return `geiger-grey:usage-cap-dismissed:${projectId}:${monthKeyOf(date)}`;
}

export function UsageCostsScreen() {
  const { projectId } = useProject();
  const canManage = useCan("grey.usage.manage");
  const { banner, showBanner, hideBanner } = useBanner();
  const bannerShownRef = useRef(false);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [events, setEvents] = useState([]);
  const [settings, setSettings] = useState(null);
  // null settings after loading means the read failed (see
  // lib/supabase/project_settings.js) — distinct from "no row yet", which
  // comes back as a defaults object. Only the error case blocks editing.
  const [settingsError, setSettingsError] = useState(false);
  const [draft, setDraft] = useState({
    monthlySoftCap: "",
    capBehavior: "alert",
    alertEmails: [],
  });

  useEffect(() => {
    let alive = true;
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const thirtyDaysAgo = startOfLocalDay(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - (DAYS - 1));
    const since = new Date(Math.min(startOfMonth.getTime(), thirtyDaysAgo.getTime()));

    Promise.all([
      listUsageEvents(projectId, { since: since.toISOString() }),
      getProjectSettings(projectId),
    ]).then(([rows, settingsRow]) => {
      if (!alive) return;
      setEvents(rows ?? []);
      setSettings(settingsRow);
      setSettingsError(settingsRow === null);
      if (settingsRow) {
        setDraft({
          monthlySoftCap:
            settingsRow.monthlySoftCap !== undefined && settingsRow.monthlySoftCap !== null
              ? String(settingsRow.monthlySoftCap)
              : "",
          capBehavior: settingsRow.capBehavior || "alert",
          alertEmails: settingsRow.alertEmails || [],
        });
      }
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [projectId]);

  const now = useMemo(() => new Date(), []);
  const startOfMonth = useMemo(() => new Date(now.getFullYear(), now.getMonth(), 1), [now]);
  const days = useMemo(() => buildDays(DAYS), []);
  const thirtyDaysAgoMs = useMemo(() => {
    const [y, m, d] = days[0].split("-").map(Number);
    return new Date(y, m - 1, d).getTime();
  }, [days]);

  const last30 = useMemo(
    () => events.filter((e) => new Date(e.occurredAt).getTime() >= thirtyDaysAgoMs),
    [events, thirtyDaysAgoMs],
  );

  const chartData = useMemo(() => {
    const byDay = new Map(days.map((d) => [d, { date: d, label: dayLabel(d) }]));
    for (const e of last30) {
      const key = localDayKey(new Date(e.occurredAt));
      const row = byDay.get(key);
      if (!row) continue;
      const field = CHART_KIND_KEYS.has(e.kind) ? e.kind : "other";
      row[field] = (row[field] || 0) + (Number(e.cost) || 0);
    }
    return days.map((d) => byDay.get(d));
  }, [days, last30]);

  const chartConfig = useMemo(() => {
    const entries = CHART_KIND_META.map((k) => [k.key, { label: k.label, color: k.color }]);
    entries.push(["other", { label: "Other", color: OTHER_KIND_COLOR }]);
    return Object.fromEntries(entries);
  }, []);

  const breakdown = useMemo(
    () =>
      USAGE_KIND_META.map((k) => {
        const rows = last30.filter((e) => e.kind === k.key);
        const quantity = rows.reduce((sum, e) => sum + (Number(e.quantity) || 0), 0);
        const cost = rows.reduce((sum, e) => sum + (Number(e.cost) || 0), 0);
        const color = CHART_KIND_KEYS.has(k.key) ? k.color : OTHER_KIND_COLOR;
        return { ...k, color, quantity, cost };
      }).filter((row) => row.quantity > 0 || row.cost > 0),
    [last30],
  );

  const spendMtd = useMemo(
    () =>
      events
        .filter((e) => new Date(e.occurredAt).getTime() >= startOfMonth.getTime())
        .reduce((sum, e) => sum + (Number(e.cost) || 0), 0),
    [events, startOfMonth],
  );

  const sumKind = (kind) =>
    last30.filter((e) => e.kind === kind).reduce((sum, e) => sum + (Number(e.quantity) || 0), 0);

  const cap = settings?.monthlySoftCap ? Number(settings.monthlySoftCap) : null;
  const pct = cap ? Math.min(999, Math.round((spendMtd / cap) * 100)) : null;

  // Show/hide the soft-cap banner as spend crosses 80%, remembering a
  // per-project-per-month dismissal (localStorage) so closing it doesn't bring
  // it right back; always hidden on unmount, project change or once pct drops
  // back under 80%.
  useEffect(() => {
    if (!projectId || pct === null || pct < 80) {
      if (bannerShownRef.current) {
        hideBanner();
        bannerShownRef.current = false;
      }
      return undefined;
    }

    let dismissed = false;
    try {
      dismissed = window.localStorage.getItem(dismissStorageKey(projectId, now)) === "1";
    } catch {
      // ignore storage failures
    }

    if (dismissed) {
      if (bannerShownRef.current) {
        hideBanner();
        bannerShownRef.current = false;
      }
      return undefined;
    }

    showBanner({
      message:
        pct >= 100
          ? `This project is over its monthly soft cap (${formatCurrency(spendMtd)} of ${formatCurrency(cap)}).`
          : `This project has used ${pct}% of its monthly soft cap (${formatCurrency(spendMtd)} of ${formatCurrency(cap)}).`,
      type: "warning",
      dismissible: true,
    });
    bannerShownRef.current = true;

    return () => {
      if (bannerShownRef.current) {
        hideBanner();
        bannerShownRef.current = false;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pct, cap, projectId]);

  // The banner's own close button calls hideBanner() with no callback to us —
  // notice the visibility flip instead and persist the dismissal.
  useEffect(() => {
    if (bannerShownRef.current && !banner.isVisible) {
      bannerShownRef.current = false;
      try {
        window.localStorage.setItem(dismissStorageKey(projectId, now), "1");
      } catch {
        // ignore storage failures
      }
    }
  }, [banner.isVisible, projectId, now]);

  const stats = [
    { label: "Spend MTD", value: formatCurrency(spendMtd) },
    { label: "Soft cap", value: settingsError ? "—" : cap ? formatCurrency(cap) : "Not set" },
    { label: "Pages ingested · 30d", value: formatNumber(sumKind("page")) },
    { label: "Media minutes · 30d", value: formatNumber(sumKind("media_minute")) },
    { label: "Retrievals · 30d", value: formatNumber(sumKind("retrieval")) },
  ];

  const controlsDisabled = !canManage || settingsError;

  const setDraftField = (key) => (value) => setDraft((d) => ({ ...d, [key]: value }));

  const handleSave = async () => {
    if (settingsError) return;
    setSaving(true);
    const bad = draft.alertEmails.find((e) => !EMAIL_RE.test(e));
    if (bad) {
      toast.error(`"${bad}" isn't a valid email.`);
      setSaving(false);
      return;
    }
    const patch = {
      monthlySoftCap: draft.monthlySoftCap === "" ? null : Number(draft.monthlySoftCap),
      capBehavior: draft.capBehavior,
      alertEmails: draft.alertEmails,
    };
    const saved = await saveProjectSettings(projectId, patch);
    setSaving(false);
    if (saved) {
      setSettings(saved);
      toast.success("Usage settings saved");
    } else {
      toast.error("Couldn't save usage settings.");
    }
  };

  if (loading) {
    return (
      <MainScreenWrapper>
        <ScreenHeader title="Usage & Costs" description="Spend across ingestion, retrieval and the model providers you connect." />
        <LoadingArea label="Loading usage" />
      </MainScreenWrapper>
    );
  }

  return (
    <MainScreenWrapper>
      <ScreenHeader
        title="Usage & Costs"
        description="Spend across ingestion, retrieval and the model providers you connect."
      />

      <StatGrid stats={stats} columns={5} />

      <SectionCard title="Daily cost" description="Last 30 days, by usage kind.">
        {last30.length === 0 ? (
          <EmptyState
            icon={Gauge}
            title="No usage yet"
            description="Cost will show up here once sources are ingested or questions are asked."
          />
        ) : (
          <ChartContainer config={chartConfig} className="h-[280px] w-full">
            <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={24}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                width={48}
                tickFormatter={(v) => formatCurrency(v)}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    indicator="dot"
                    formatter={(value, name) => (
                      <span className="flex w-full items-center justify-between gap-3">
                        <span className="flex items-center gap-1.5 text-muted-foreground">
                          <span
                            className="h-2 w-2 shrink-0 rounded-[2px]"
                            style={{ backgroundColor: chartConfig[name]?.color }}
                          />
                          {chartConfig[name]?.label || name}
                        </span>
                        <span className="font-mono font-medium tabular-nums text-foreground">
                          {formatCurrency(value, { precise: true })}
                        </span>
                      </span>
                    )}
                  />
                }
              />
              {CHART_KIND_META.map((k) => (
                <Area
                  key={k.key}
                  dataKey={k.key}
                  type="monotone"
                  stackId="cost"
                  stroke={k.color}
                  fill={k.color}
                  fillOpacity={0.25}
                  isAnimationActive={false}
                />
              ))}
              <Area
                key="other"
                dataKey="other"
                type="monotone"
                stackId="cost"
                stroke={OTHER_KIND_COLOR}
                fill={OTHER_KIND_COLOR}
                fillOpacity={0.25}
                isAnimationActive={false}
              />
              <ChartLegend content={<ChartLegendContent />} />
            </AreaChart>
          </ChartContainer>
        )}
      </SectionCard>

      <SectionCard title="Breakdown by kind" bodyPadding={false}>
        {breakdown.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-text-tertiary">
            No usage recorded in the last 30 days.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="px-4">Kind</TableHead>
                <TableHead className="px-4 text-right">Quantity</TableHead>
                <TableHead className="px-4 text-right">Cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {breakdown.map((row) => (
                <TableRow key={row.key} className="border-border">
                  <TableCell className="px-4 py-3">
                    <span className="flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: row.color }}
                      />
                      {row.label}
                    </span>
                  </TableCell>
                  <TableCell className="px-4 py-3 text-right tabular-nums">
                    {formatNumber(row.quantity)}
                  </TableCell>
                  <TableCell className="px-4 py-3 text-right font-medium tabular-nums">
                    {formatCurrency(row.cost, { precise: true })}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </SectionCard>

      <SectionCard
        title="Monthly soft cap"
        description="Warn or slow down ingestion once spend reaches this amount."
      >
        {settingsError ? (
          <div className="mb-5 flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/10 px-3.5 py-2.5 text-xs leading-relaxed text-destructive-text">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <p>
              Couldn&apos;t load the current cap settings. Editing is disabled until this loads
              successfully — reload the page to try again.
            </p>
          </div>
        ) : null}

        {cap ? (
          <div className="mb-5 space-y-1.5">
            <Progress value={Math.min(100, pct ?? 0)} />
            <p className="flex items-center gap-1.5 text-xs text-text-secondary">
              {pct !== null && pct >= 80 ? (
                <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
              ) : null}
              {formatCurrency(spendMtd)} of {formatCurrency(cap)} this month ({pct}%)
            </p>
          </div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Monthly soft cap (USD)">
            <Input
              type="number"
              min="0"
              step="1"
              placeholder="No cap"
              disabled={controlsDisabled}
              value={draft.monthlySoftCap}
              onChange={(e) => setDraftField("monthlySoftCap")(e.target.value)}
            />
          </Field>
          <Field label="When the cap is reached">
            <Select
              value={draft.capBehavior}
              disabled={controlsDisabled}
              onValueChange={setDraftField("capBehavior")}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CAP_BEHAVIOR_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
        <p className="mt-1.5 text-xs text-text-secondary">
          {CAP_BEHAVIOR_HINT[draft.capBehavior]}
        </p>

        <div className="mt-4">
          <Field label="Alert emails" hint="Notified when spend crosses the cap.">
            {canManage ? (
              <TagInput
                value={draft.alertEmails}
                onChange={setDraftField("alertEmails")}
                placeholder="alerts@company.com"
                validate={(tag) => EMAIL_RE.test(tag)}
              />
            ) : draft.alertEmails.length ? (
              <div className="flex flex-wrap gap-1.5">
                {draft.alertEmails.map((email) => (
                  <Badge key={email} variant="neutral">
                    {email}
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-xs text-text-tertiary">No alert emails set.</p>
            )}
          </Field>
        </div>

        {canManage ? (
          <div className="mt-5 flex justify-end">
            <Button
              onClick={handleSave}
              disabled={saving || settingsError}
              className="bg-primary text-primary-foreground"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save changes
            </Button>
          </div>
        ) : null}
      </SectionCard>
    </MainScreenWrapper>
  );
}

export default UsageCostsScreen;
