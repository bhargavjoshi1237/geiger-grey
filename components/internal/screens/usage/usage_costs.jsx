"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Loader2, Save } from "lucide-react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, useBanner } from "@geiger/ui";

import { MainScreenWrapper } from "@/components/internal/shared/screen_wrappers";
import {
  ScreenHeader,
  StatsBar,
  SectionCard,
  Field,
} from "@/components/internal/shared/screen_kit";
import { Button } from "@geiger/ui/button";
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

function dayKey(date) {
  return date.toISOString().slice(0, 10);
}

function dayLabel(key) {
  const d = new Date(`${key}T00:00:00Z`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function buildDays(count) {
  const out = [];
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  for (let i = count - 1; i >= 0; i -= 1) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    out.push(dayKey(d));
  }
  return out;
}

export function UsageCostsScreen() {
  const { projectId } = useProject();
  const canManage = useCan("grey.usage.manage");
  const { showBanner } = useBanner();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [events, setEvents] = useState([]);
  const [settings, setSettings] = useState(null);
  const [draft, setDraft] = useState({
    monthlySoftCap: "",
    capBehavior: "alert",
    alertEmails: [],
  });

  useEffect(() => {
    let alive = true;
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - (DAYS - 1));
    thirtyDaysAgo.setHours(0, 0, 0, 0);
    const since = new Date(Math.min(startOfMonth.getTime(), thirtyDaysAgo.getTime()));

    Promise.all([
      listUsageEvents(projectId, { since: since.toISOString() }),
      getProjectSettings(projectId),
    ]).then(([rows, settingsRow]) => {
      if (!alive) return;
      setEvents(rows ?? []);
      setSettings(settingsRow ?? null);
      setDraft({
        monthlySoftCap:
          settingsRow?.monthlySoftCap !== undefined && settingsRow?.monthlySoftCap !== null
            ? String(settingsRow.monthlySoftCap)
            : "",
        capBehavior: settingsRow?.capBehavior || "alert",
        alertEmails: settingsRow?.alertEmails || [],
      });
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
    const d = new Date(`${days[0]}T00:00:00Z`);
    return d.getTime();
  }, [days]);

  const last30 = useMemo(
    () => events.filter((e) => new Date(e.occurredAt).getTime() >= thirtyDaysAgoMs),
    [events, thirtyDaysAgoMs],
  );

  const chartData = useMemo(() => {
    const byDay = new Map(days.map((d) => [d, { date: d }]));
    for (const e of last30) {
      const key = dayKey(new Date(e.occurredAt));
      const row = byDay.get(key);
      if (!row) continue;
      row[e.kind] = (row[e.kind] || 0) + (Number(e.cost) || 0);
    }
    return days.map((d) => {
      const row = byDay.get(d);
      return { ...row, label: dayLabel(d) };
    });
  }, [days, last30]);

  const chartConfig = useMemo(
    () =>
      Object.fromEntries(
        USAGE_KIND_META.map((k) => [k.key, { label: k.label, color: k.color }]),
      ),
    [],
  );

  const breakdown = useMemo(
    () =>
      USAGE_KIND_META.map((k) => {
        const rows = last30.filter((e) => e.kind === k.key);
        const quantity = rows.reduce((sum, e) => sum + (Number(e.quantity) || 0), 0);
        const cost = rows.reduce((sum, e) => sum + (Number(e.cost) || 0), 0);
        return { ...k, quantity, cost };
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

  useEffect(() => {
    if (pct !== null && pct >= 80) {
      showBanner({
        message:
          pct >= 100
            ? `This project is over its monthly soft cap (${formatCurrency(spendMtd)} of ${formatCurrency(cap)}).`
            : `This project has used ${pct}% of its monthly soft cap (${formatCurrency(spendMtd)} of ${formatCurrency(cap)}).`,
        type: "warning",
        dismissible: true,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pct, cap]);

  const stats = [
    { label: "Spend MTD", value: formatCurrency(spendMtd) },
    { label: "Soft cap", value: cap ? formatCurrency(cap) : "Not set" },
    { label: "Pages ingested", value: formatNumber(sumKind("page")) },
    { label: "Media minutes", value: formatNumber(sumKind("media_minute")) },
    { label: "Retrievals", value: formatNumber(sumKind("retrieval")) },
  ];

  const setDraftField = (key) => (value) => setDraft((d) => ({ ...d, [key]: value }));

  const handleSave = async () => {
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

      <StatsBar stats={stats} columns={5} />

      <SectionCard title="Daily cost" description="Last 30 days, by usage kind.">
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
              content={<ChartTooltipContent indicator="dot" labelKey="label" />}
            />
            {USAGE_KIND_META.map((k) => (
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
          </AreaChart>
        </ChartContainer>
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
        {cap ? (
          <div className="mb-5 space-y-1.5">
            <Progress value={Math.min(100, pct ?? 0)} />
            <p className="flex items-center gap-1.5 text-xs text-text-secondary">
              {pct !== null && pct >= 80 ? (
                <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
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
              disabled={!canManage}
              value={draft.monthlySoftCap}
              onChange={(e) => setDraftField("monthlySoftCap")(e.target.value)}
            />
          </Field>
          <Field label="When the cap is reached">
            <Select
              value={draft.capBehavior}
              disabled={!canManage}
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
            <TagInput
              value={draft.alertEmails}
              onChange={setDraftField("alertEmails")}
              placeholder="alerts@company.com"
              validate={(tag) => EMAIL_RE.test(tag)}
              disabled={!canManage}
            />
          </Field>
        </div>

        {canManage ? (
          <div className="mt-5 flex justify-end">
            <Button onClick={handleSave} disabled={saving} className="bg-primary text-primary-foreground">
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
