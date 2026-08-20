"use client";

import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";

import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/shared";
import type { ChartConfig } from "@heirs/ui";
import type { FunctionMetric, MetricsTimeseries, TenantUsage } from "@/types/metrics";

/**
 * The analytics charts.
 *
 * Every card here plots measures that do not share a unit — requests against a
 * percentage, latency against an error rate — and none of them uses a second y-axis
 * to do it. A dual axis lets the author place the crossing point anywhere, so two
 * series can be made to look correlated or not at will and the reader has no way to
 * tell which. Where the units differ, the card stacks two plots over one shared
 * x-axis instead: same information, no invented relationship.
 *
 * Colours come from the `--chart-*` tokens, which are defined per theme, so the dark
 * palette is its own set of steps rather than a flip of the light one. Only two of the
 * five slots ever appear in a single plot: slots 4 and 5 are indistinguishable under
 * deuteranopia (ΔE 3.7), so pairing them would encode a difference a colourblind
 * reader cannot see.
 */

const num = (n: number): string => n.toLocaleString();
const pct = (ratio: number): string => `${(ratio * 100).toFixed(1)}%`;
const ms = (n: number | null): string => (n === null ? "—" : `${num(n)} ms`);

/** Compact tick for a token count — 1.2M rather than 1,200,000 eating the axis. */
const compact = (n: number): string =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k` : String(n);

/** `TEXT_EXTRACTION` → `Text extraction`, then clipped. The tooltip keeps the full key. */
const fnLabel = (key: string): string => {
  const pretty = key.charAt(0) + key.slice(1).toLowerCase().replace(/_/g, " ");
  return pretty.length > 14 ? `${pretty.slice(0, 13)}…` : pretty;
};

/** Tenant ids are opaque and long; the tooltip carries the whole thing. */
const tenantLabel = (id: string): string => (id.length > 12 ? `${id.slice(0, 11)}…` : id);

/**
 * Tokens take a categorical slot rather than the `warning` status token: amber is the
 * only third hue that clears the colourblind check against teal and red, and tokens
 * are not a warning about anything. Same trio as the function chart in structure —
 * one neutral, one `destructive`, one categorical.
 */
const tenantConfig = {
  requests: { label: "Requests", color: "var(--chart-1)" },
  errors: { label: "Errors", color: "var(--destructive)" },
  tokens: { label: "Tokens", color: "var(--chart-4)" },
} satisfies ChartConfig;

/**
 * Three series need three hues that stay apart under protanopia and deuteranopia, and
 * no trio from `--chart-1..5` manages it — that ramp runs teal → green → amber →
 * orange with no cool or red end, so slots 4 and 5 collapse into one colour (ΔE 3.7)
 * and 1 and 3 fail the normal-vision floor in dark mode. The semantic tokens carry the
 * spread the chart ramp lacks, and carry the right meaning besides.
 */
const functionConfig = {
  requests: { label: "Requests", color: "var(--chart-1)" },
  errors: { label: "Errors", color: "var(--destructive)" },
  lowConfidence: { label: "Low confidence", color: "var(--warning)" },
} satisfies ChartConfig;

/** Recharts' default is a 1px hairline; 2px reads as a deliberate mark. */
const LINE = { strokeWidth: 2, dot: false, activeDot: { r: 4, strokeWidth: 2 } } as const;

/** Rounded data-end, anchored to the baseline. */
const BAR_RADIUS = [4, 4, 0, 0] as const;

const gridProps = { vertical: false, strokeDasharray: "3 3", className: "stroke-border/50" } as const;
const axisProps = { tickLine: false, axisLine: false, tickMargin: 8 } as const;

/** Reads the row's own key back out for the tooltip heading, not the truncated tick. */
const fullLabel =
  (field: "function" | "tenantId") =>
  (_: unknown, payload: readonly { payload?: Record<string, unknown> }[] | undefined) =>
    String(payload?.[0]?.payload?.[field] ?? "");

/** Fixed bar width, so a card with three functions looks like one with twelve. */
const BAR_SIZE = 24;

/**
 * Width one function's group needs: three bars, the 2px gaps between them, and
 * breathing room either side. Below this the plot is scrolled rather than squeezed —
 * bars that thin to a few pixels stop being comparable, which is the whole job here.
 */
const GROUP_WIDTH = BAR_SIZE * 3 + 2 * 2 + 28;

/**
 * Requests, errors and low-confidence results, grouped per function.
 *
 * All three are counts of requests, which is what lets them share one axis. The
 * low-confidence series is deliberately the **count** rather than the ratio the
 * summary also carries: that ratio is over `confidenceObservations`, so plotting it
 * here would put a 0–1 proportion against counts in the hundreds and flatten it onto
 * the baseline.
 *
 * Grouped rather than stacked — errors and low-confidence results are both subsets of
 * requests and overlap each other, so stacking them would add up to a total that does
 * not exist.
 *
 * Colours are the semantic tokens, not two more categorical slots: errors are
 * `destructive` and low confidence is `warning` because that is what they mean. It is
 * also the only three-way split that survives the colourblind check — every trio drawn
 * from `--chart-1..5` alone fails it in one theme or the other.
 */
export const FunctionVolumeChart = ({ data }: { data: FunctionMetric[] }) => (
  <div className="w-full overflow-x-auto">
    <div style={{ minWidth: data.length * GROUP_WIDTH }}>
      <ChartContainer config={functionConfig} className="aspect-auto h-72.5 w-full">
        <BarChart accessibilityLayer data={data} barGap={2} margin={{ left: 4, right: 8 }}>
          <CartesianGrid {...gridProps} />
          {/* Horizontal labels: the plot scrolls, so there is room for them and no
              need for the angled ticks that a squeezed axis forces. */}
          <XAxis dataKey="function" {...axisProps} tickFormatter={fnLabel} interval={0} height={28} />
          <YAxis {...axisProps} width={44} allowDecimals={false} tickFormatter={compact} />
          <ChartTooltip cursor={false} content={<ChartTooltipContent labelFormatter={fullLabel("function")} />} />
          <ChartLegend content={<ChartLegendContent />} />
          <Bar dataKey="requests" fill="var(--color-requests)" radius={[...BAR_RADIUS]} barSize={BAR_SIZE} />
          <Bar dataKey="errors" fill="var(--color-errors)" radius={[...BAR_RADIUS]} barSize={BAR_SIZE} />
          <Bar dataKey="lowConfidence" fill="var(--color-lowConfidence)" radius={[...BAR_RADIUS]} barSize={BAR_SIZE} />
        </BarChart>
      </ChartContainer>
    </div>
  </div>
);

/**
 * Requests, errors and tokens per tenant, grouped — the same shape as the function
 * chart, and on the same single axis.
 *
 * **Tokens dominate this plot.** They are counted per token and requests per call, so
 * a tenant with 20 requests and 300k tokens renders as one full-height token bar
 * beside two bars a pixel tall. That is arithmetic, not a bug: it is the reason this
 * series had its own strip before. If the request and error bars need to stay
 * readable next to it, the options are a log y-axis or splitting tokens back out —
 * a second linear axis would only hide the problem by letting the two scales be
 * placed wherever they happen to look agreeable.
 */
export const TenantVolumeChart = ({ data }: { data: TenantUsage[] }) => (
  <div className="w-full overflow-x-auto">
    <div style={{ minWidth: data.length * GROUP_WIDTH }}>
      <ChartContainer config={tenantConfig} className="aspect-auto h-72.5 w-full">
        <BarChart accessibilityLayer data={data} barGap={2} margin={{ left: 4, right: 8 }}>
          <CartesianGrid {...gridProps} />
          <XAxis dataKey="tenantId" {...axisProps} tickFormatter={tenantLabel} interval={0} height={28} />
          <YAxis {...axisProps} width={44} allowDecimals={false} tickFormatter={compact} />
          <ChartTooltip
            cursor={false}
            content={
              <ChartTooltipContent labelFormatter={fullLabel("tenantId")} formatter={(value) => num(Number(value))} />
            }
          />
          <ChartLegend content={<ChartLegendContent />} />
          <Bar dataKey="requests" fill="var(--color-requests)" radius={[...BAR_RADIUS]} barSize={BAR_SIZE} />
          <Bar dataKey="errors" fill="var(--color-errors)" radius={[...BAR_RADIUS]} barSize={BAR_SIZE} />
          <Bar dataKey="tokens" fill="var(--color-tokens)" radius={[...BAR_RADIUS]} barSize={BAR_SIZE} />
        </BarChart>
      </ChartContainer>
    </div>
  </div>
);

/** Hour buckets read as a clock, day buckets as a date. */
const tickTime = (bucket: MetricsTimeseries["bucket"]) => (value: string) => {
  const d = new Date(value);
  return bucket === "hour"
    ? d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

const fullTime = (value: unknown): string => new Date(String(value)).toLocaleString();

/**
 * p95 moves off `--chart-5` now that a red series shares the plot: orange and red sit
 * ΔE 12.9 apart under normal vision in dark mode, below the 15 floor. Teal / amber /
 * red clears every colourblind check in both themes.
 */
const latencyConfig = {
  p50Ms: { label: "p50", color: "var(--chart-1)" },
  p95Ms: { label: "p95", color: "var(--chart-4)" },
  errorRate: { label: "Error rate", color: "var(--destructive)" },
} satisfies ChartConfig;

/**
 * Latency and error rate on one grid.
 *
 * Latency is plotted as percentiles rather than a mean: a handful of slow OCR runs
 * pull an average away from anything a caller actually experienced.
 *
 * **This chart has two y-scales**, and that is worth being explicit about, because a
 * dual axis is not a neutral choice. Milliseconds and a 0–1 proportion have no common
 * scale, so where the two lines cross is decided by the axis ranges rather than by the
 * data — slide either range and the same numbers can be made to look like latency
 * drives errors, or the reverse, or nothing at all. Nothing here is wrong, but *no
 * relationship between the two lines can be read off this plot*; each line is only
 * legible against its own axis. Two things keep that honest: the right-hand axis is
 * drawn in the error colour so the mapping is unambiguous, and the error series keeps
 * a fixed 0–100% domain so its shape never rescales to look more dramatic than it is.
 */
export const LatencyErrorChart = ({ data }: { data: MetricsTimeseries }) => (
  <ChartContainer config={latencyConfig} className="aspect-auto h-72.5 w-full">
    <LineChart accessibilityLayer data={data.points} margin={{ left: 4, right: 4 }}>
      <CartesianGrid {...gridProps} />
      <XAxis dataKey="ts" {...axisProps} tickFormatter={tickTime(data.bucket)} minTickGap={24} />
      <YAxis yAxisId="latency" {...axisProps} width={52} tickFormatter={(v: number) => `${compact(v)}ms`} />
      <YAxis
        yAxisId="rate"
        orientation="right"
        {...axisProps}
        width={48}
        domain={[0, 1]}
        ticks={[0, 0.5, 1]}
        tickFormatter={pct}
        tick={{ fill: "var(--color-errorRate)" }}
      />
      <ChartTooltip
        content={
          <ChartTooltipContent
            labelFormatter={fullTime}
            formatter={(value, name) => (name === "errorRate" ? pct(Number(value)) : ms(Number(value)))}
          />
        }
      />
      <ChartLegend content={<ChartLegendContent />} />
      {/* connectNulls: a quiet bucket has no latency to report, and bridging that gap
          reads better than a line that shatters into fragments overnight. */}
      <Line yAxisId="latency" dataKey="p50Ms" stroke="var(--color-p50Ms)" connectNulls {...LINE} />
      <Line yAxisId="latency" dataKey="p95Ms" stroke="var(--color-p95Ms)" connectNulls {...LINE} />
      <Line yAxisId="rate" dataKey="errorRate" stroke="var(--color-errorRate)" {...LINE} />
    </LineChart>
  </ChartContainer>
);

/** One measure, one axis, no legend — the card title already names the series. */
export const RequestsOverTimeChart = ({ data }: { data: MetricsTimeseries }) => (
  <ChartContainer
    config={{ requests: { label: "Requests", color: "var(--chart-1)" } }}
    className="aspect-auto h-71.5 w-full"
  >
    <AreaChart accessibilityLayer data={data.points} margin={{ left: 4, right: 8 }}>
      <defs>
        <linearGradient id="requests-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--color-requests)" stopOpacity={0.28} />
          <stop offset="100%" stopColor="var(--color-requests)" stopOpacity={0.02} />
        </linearGradient>
      </defs>
      <CartesianGrid {...gridProps} />
      <XAxis dataKey="ts" {...axisProps} tickFormatter={tickTime(data.bucket)} minTickGap={24} />
      <YAxis {...axisProps} width={44} allowDecimals={false} tickFormatter={compact} />
      <ChartTooltip
        content={<ChartTooltipContent labelFormatter={fullTime} formatter={(value) => num(Number(value))} />}
      />
      <Area dataKey="requests" stroke="var(--color-requests)" fill="url(#requests-fill)" {...LINE} />
    </AreaChart>
  </ChartContainer>
);
