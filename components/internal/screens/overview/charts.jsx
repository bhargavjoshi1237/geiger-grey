"use client";

import { useMemo, useState } from "react";
import { Radio, TrendingUp, Workflow } from "lucide-react";
import {
  CartesianGrid,
  Label,
  LabelList,
  Line,
  LineChart,
  Pie,
  PieChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  RadialBar,
  RadialBarChart,
  XAxis,
} from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@geiger/ui";

import { EmptyState } from "@/components/internal/shared/screen_kit";
import FilterDropdown from "@/components/internal/shared/filter_dropdown";
import { CHANNEL_LABELS } from "@/components/internal/screens/usage/constants";
import { formatLatency, formatNumber } from "@/lib/grey/format";
import {
  bucketWeekly,
  buildWeeklyBuckets,
  filterByScope,
  weekLabel,
} from "@/lib/grey/overview_metrics";
import {
  ACTIVITY_METRIC_OPTIONS,
  CHART_COLORS,
  CHART_SERIES_COLORS,
  TREND_WEEKS,
} from "./constants";
import { ScopeSelect, WidgetHeader, WidgetShell } from "./widget_kit";

const METRIC_FORMATTERS = {
  queries: (v) => v.toLocaleString("en-US"),
  tokens: (v) => formatNumber(v),
  latency: (v) => formatLatency(v),
};

function weeklySeries(metric, logs, weeks) {
  if (metric === "tokens") {
    return bucketWeekly(logs, weeks, "createdAt", (l) => (l.tokensIn || 0) + (l.tokensOut || 0));
  }
  if (metric === "latency") {
    const timed = logs.filter((l) => Number.isFinite(l.latencyMs));
    const sums = bucketWeekly(timed, weeks, "createdAt", (l) => l.latencyMs);
    const counts = bucketWeekly(timed, weeks, "createdAt");
    return sums.map((sum, i) => (counts[i] ? Math.round(sum / counts[i]) : 0));
  }
  return bucketWeekly(logs, weeks, "createdAt");
}

export function ActivityTrendWidget({ pending, asOf, pipelines, logs }) {
  const [metric, setMetric] = useState("queries");
  const [pipelineScope, setPipelineScope] = useState([]);
  const selected =
    ACTIVITY_METRIC_OPTIONS.find((o) => o.value === metric) || ACTIVITY_METRIC_OPTIONS[0];

  const weeks = useMemo(() => buildWeeklyBuckets(TREND_WEEKS, asOf), [asOf]);
  const scopedLogs = useMemo(
    () => filterByScope(logs, pipelineScope, "pipelineId"),
    [logs, pipelineScope],
  );
  const series = useMemo(() => weeklySeries(metric, scopedLogs, weeks), [metric, scopedLogs, weeks]);
  const data = series.map((value, i) => ({ label: weekLabel(weeks[i]), value }));
  const formatValue = METRIC_FORMATTERS[metric];

  const header = (
    <WidgetHeader
      title="Activity Over Time"
      subtitle={`${selected.label} per week across your pipelines.`}
      action={
        <div className="flex items-center gap-2">
          <ScopeSelect
            items={pipelines}
            selected={pipelineScope}
            onChange={setPipelineScope}
            icon={Workflow}
            allLabel="All Pipelines"
            noun="pipeline"
          />
          <FilterDropdown
            value={metric}
            onValueChange={setMetric}
            options={ACTIVITY_METRIC_OPTIONS}
            height="h-9"
          />
        </div>
      }
    />
  );

  // While the fetch is in flight the series is all zeros, so the line sits flat
  // on the baseline and animates up when the real numbers land.
  if (!pending && scopedLogs.length === 0) {
    return (
      <WidgetShell contentClassName="flex flex-col">
        {header}
        <div className="mt-4 flex min-h-0 flex-1 items-center justify-center">
          <EmptyState
            icon={TrendingUp}
            title="No queries yet"
            description="Questions asked in the Playground, a widget or the API will show up here."
          />
        </div>
      </WidgetShell>
    );
  }

  return (
    <WidgetShell contentClassName="flex flex-col">
      {header}
      <div className="mt-4 flex min-h-0 flex-1 items-center justify-center">
        <ChartContainer
          config={{ value: { label: selected.label, color: CHART_COLORS.primary } }}
          className="mx-auto h-full w-full"
        >
          <LineChart data={data} margin={{ top: 24, right: 16, left: 12, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--ov-grid)" strokeDasharray="3 3" />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              tick={{ fill: "#737373", fontSize: 11 }}
            />
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  indicator="line"
                  hideLabel
                  formatter={(value) => (
                    <span className="font-medium tabular-nums text-foreground">
                      {formatValue(value)}
                    </span>
                  )}
                />
              }
            />
            <Line
              dataKey="value"
              type="monotone"
              stroke={CHART_COLORS.primary}
              strokeWidth={2}
              dot={{ fill: CHART_COLORS.primary, r: 3 }}
              activeDot={{ r: 5 }}
              isAnimationActive={true}
            >
              <LabelList
                dataKey="value"
                position="top"
                offset={10}
                className="fill-foreground dark:fill-[#ededed]"
                fontSize={11}
                formatter={formatValue}
              />
            </Line>
          </LineChart>
        </ChartContainer>
      </div>
    </WidgetShell>
  );
}

function buildChannelMix(logs) {
  const totals = new Map();
  for (const log of logs) {
    const key = log.channel || "other";
    totals.set(key, (totals.get(key) || 0) + 1);
  }
  return [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([key, value]) => ({ key, label: CHANNEL_LABELS[key] || "Other", value }));
}

export function ChannelMixWidget({ pending, logs }) {
  const mix = useMemo(() => buildChannelMix(logs), [logs]);
  const [selectedChannel, setSelectedChannel] = useState(null);
  const activeChannel = mix.some((item) => item.key === selectedChannel)
    ? selectedChannel
    : mix[0]?.key ?? null;

  const title = "Query Channels";
  const subtitle = `Where queries came from, last ${TREND_WEEKS} weeks.`;
  const total = mix.reduce((sum, item) => sum + item.value, 0);
  const chartData = mix.map((item, index) => ({
    ...item,
    fill: CHART_SERIES_COLORS[index % CHART_SERIES_COLORS.length],
  }));
  const selectedIndex = Math.max(
    chartData.findIndex((item) => item.key === activeChannel),
    0,
  );
  const selectedItem = chartData[selectedIndex] || chartData[0];
  const channelOptions = mix.map((item) => ({ value: item.key, label: item.label }));
  const chartConfig = Object.fromEntries(
    mix.map((item, index) => [
      item.key,
      { label: item.label, color: CHART_SERIES_COLORS[index % CHART_SERIES_COLORS.length] },
    ]),
  );

  // A donut has no zero shape to draw, so while the fetch is in flight it holds
  // an empty ring on the same geometry the chart will occupy.
  if (pending && !mix.length) {
    return (
      <WidgetShell contentClassName="flex flex-col">
        <WidgetHeader title={title} subtitle={subtitle} />
        <div className="relative mt-4 flex min-h-0 w-full flex-1 items-center justify-center">
          <div className="h-[156px] w-[156px] rounded-full border-[34px] border-border" />
          <div className="pointer-events-none absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center">
            <span className="text-3xl font-bold leading-none text-foreground">0</span>
            <span className="mt-1 text-xs font-medium text-muted-foreground">0% share</span>
          </div>
        </div>
        <p className="mt-2 text-center text-xs text-text-secondary">0 of 0 queries</p>
      </WidgetShell>
    );
  }

  if (!mix.length) {
    return (
      <WidgetShell contentClassName="flex flex-col">
        <WidgetHeader title={title} subtitle={subtitle} />
        <div className="mt-4 flex min-h-0 flex-1 items-center justify-center">
          <EmptyState
            icon={Radio}
            title="No queries yet"
            description="Ask in the Playground or embed a widget to see the channel mix."
          />
        </div>
      </WidgetShell>
    );
  }

  return (
    <WidgetShell contentClassName="flex flex-col">
      <WidgetHeader
        title={title}
        subtitle={subtitle}
        action={
          <FilterDropdown
            value={activeChannel}
            onValueChange={setSelectedChannel}
            options={channelOptions}
            height="h-9"
          />
        }
      />
      <div className="relative mt-4 flex min-h-0 w-full flex-1 items-center justify-center">
        <ChartContainer config={chartConfig} className="mx-auto h-[220px] w-[220px]">
          <PieChart>
            <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel nameKey="key" />} />
            <Pie
              data={chartData}
              dataKey="value"
              nameKey="key"
              cx="50%"
              cy="50%"
              innerRadius={44}
              outerRadius={78}
              activeIndex={selectedIndex}
              activeShape={{ outerRadius: 88 }}
              stroke={CHART_COLORS.appBackground}
              strokeWidth={2}
              isAnimationActive={true}
            />
          </PieChart>
        </ChartContainer>
        <div className="pointer-events-none absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center">
          <span className="text-3xl font-bold leading-none text-foreground">
            {formatNumber(selectedItem?.value)}
          </span>
          <span className="mt-1 text-xs font-medium text-muted-foreground">
            {total > 0 ? Math.round((selectedItem.value / total) * 100) : 0}% share
          </span>
        </div>
      </div>
      <p className="mt-2 text-center text-xs text-text-secondary">
        {selectedItem?.value.toLocaleString("en-US")} of {total.toLocaleString("en-US")} queries
      </p>
    </WidgetShell>
  );
}

// `stages` run widest to narrowest; the headline is the share of the first
// stage that reaches `headlineKey`.
export function IngestionFunnelWidget({ stages, headlineKey, headlineCaption }) {
  const top = stages[0]?.value || 0;
  const headline = stages.find((s) => s.key === headlineKey)?.value || 0;
  const overall = top > 0 ? Math.round((headline / top) * 100) : 0;

  const chartData = stages.map((stage) => ({
    ...stage,
    share: top > 0 ? Math.round((stage.value / top) * 100) : 0,
  }));

  return (
    <WidgetShell contentClassName="flex flex-col">
      <WidgetHeader
        title="Ingestion Funnel"
        subtitle="Share of sources reaching each step, from upload to verified."
        action={
          <div className="flex shrink-0 flex-col items-end">
            <span className="text-3xl font-bold leading-none text-foreground dark:text-white">
              {overall}%
            </span>
            <span className="mt-1 text-[11px] text-text-secondary">{headlineCaption}</span>
          </div>
        }
      />
      <div className="mt-1 flex min-h-0 flex-1 items-center justify-center">
        <ChartContainer
          config={{ share: { label: "Share of sources", color: CHART_COLORS.primary } }}
          className="mx-auto aspect-square h-full max-h-[210px]"
        >
          <RadarChart data={chartData} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  hideLabel
                  nameKey="key"
                  formatter={(value, name, item) => (
                    <span className="flex w-full items-center justify-between gap-3">
                      <span className="text-muted-foreground">{item.payload.label}</span>
                      <span className="font-medium tabular-nums text-foreground">
                        {item.payload.value.toLocaleString("en-US")} · {item.payload.share}%
                      </span>
                    </span>
                  )}
                />
              }
            />
            <PolarGrid stroke="var(--ov-grid)" />
            <PolarAngleAxis dataKey="short" tick={{ fill: "var(--ov-tick)", fontSize: 11 }} />
            <Radar
              dataKey="share"
              stroke={CHART_COLORS.primary}
              strokeWidth={2}
              fill={CHART_COLORS.primary}
              fillOpacity={0.5}
              dot={{
                r: 4,
                fill: CHART_COLORS.primary,
                fillOpacity: 1,
                stroke: CHART_COLORS.appBackground,
                strokeWidth: 1.5,
              }}
              isAnimationActive={true}
            />
          </RadarChart>
        </ChartContainer>
      </div>
    </WidgetShell>
  );
}

// `scope` configures the header's ScopeSelect ({ items, icon, allLabel, noun });
// `compute(selectedIds)` returns { pct, footnote } for the current selection.
export function GaugeWidget({ title, subtitle, caption, scope, compute }) {
  const [selected, setSelected] = useState([]);
  const { pct, footnote } = useMemo(() => compute(selected), [compute, selected]);

  const clamped = Math.max(0, Math.min(100, pct));
  const endAngle = 90 - (clamped / 100) * 360;
  const data = [{ name: caption, value: clamped, fill: CHART_COLORS.primary }];

  return (
    <WidgetShell contentClassName="flex flex-col">
      <WidgetHeader
        title={title}
        subtitle={subtitle}
        action={
          <ScopeSelect
            items={scope.items}
            selected={selected}
            onChange={setSelected}
            icon={scope.icon}
            allLabel={scope.allLabel}
            noun={scope.noun}
          />
        }
      />
      <div className="mt-1 flex min-h-0 flex-1 items-center justify-center">
        <ChartContainer
          config={{ value: { label: caption, color: CHART_COLORS.primary } }}
          className="mx-auto aspect-square h-full max-h-[190px]"
        >
          <RadialBarChart
            data={data}
            startAngle={90}
            endAngle={endAngle}
            innerRadius={72}
            outerRadius={104}
          >
            <PolarGrid
              gridType="circle"
              radialLines={false}
              stroke="none"
              polarRadius={[78, 66]}
              className="first:fill-[#f4f4f5] last:fill-[#fafafa] dark:first:fill-[#202020] dark:last:fill-[#1a1a1a]"
            />
            <RadialBar dataKey="value" cornerRadius={8} isAnimationActive={true} />
            <PolarRadiusAxis tick={false} tickLine={false} axisLine={false}>
              <Label
                content={({ viewBox }) => {
                  if (viewBox && "cx" in viewBox && "cy" in viewBox) {
                    return (
                      <text
                        x={viewBox.cx}
                        y={viewBox.cy}
                        textAnchor="middle"
                        dominantBaseline="middle"
                      >
                        <tspan
                          x={viewBox.cx}
                          y={viewBox.cy}
                          className="fill-foreground dark:fill-white text-3xl font-bold"
                        >
                          {clamped}%
                        </tspan>
                        <tspan
                          x={viewBox.cx}
                          y={(viewBox.cy || 0) + 22}
                          className="fill-muted-foreground text-xs font-medium"
                        >
                          {caption}
                        </tspan>
                      </text>
                    );
                  }
                }}
              />
            </PolarRadiusAxis>
          </RadialBarChart>
        </ChartContainer>
      </div>
      {footnote ? (
        <p className="mt-1 text-center text-xs text-text-secondary">{footnote}</p>
      ) : null}
    </WidgetShell>
  );
}
